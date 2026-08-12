#!/usr/bin/env node
/**
 * v6.159 守衛：client 端效能量測儀器化（**只加量測，不做任何效能修正**）
 *
 * 背景 —— 錦標賽的「卡」修了十幾版都沒中，因為每一版都在修伺服器，
 *   而伺服器端指標一直是全綠的。新診斷（Fable 5）指向 client 端主執行緒：
 *     ① `tAdopt` 每次同步把**整棵全新 JSON 樹**指給 `game` ⇒ 物件同一性全換
 *        ⇒ Svelte 無法細粒度更新 ⇒ 每次版本變動＝整個盤面全量重繪。
 *        本機對戰因引擎結構共享沒這問題，**只有錦標賽路徑缺這優勢**。
 *     ② v6.151 的 `rtt` 是從 `tApi` 進函式起算的 —— **包含**
 *        `await firebaseUser.getIdToken()`、`res.json()` 解析、以及 await 續行
 *        還要排隊等主執行緒空檔 ⇒ 它從來就不是純網路時間，我們一直誤讀它。
 *
 * 這一版的紀律：**不重構 tAdopt、不改輪詢、不改 Svelte 結構**，
 *   只讓下一場賽事的數據能決定性地分辨「網路慢」vs「主執行緒慢」。
 *
 * ⚠⚠ 這份守衛刻意**不只驗字串存在**（v6.154 的教訓：22 條守衛全綠、分頁卻打不開）。
 *   ・新加的量測函式一律用 esbuild 轉出來**實際執行**，驗它產出的資料結構；
 *   ・admin 顯示端餵一份**沒有新欄位的舊 payload**，斷言不 throw、不空白、欄數對得上。
 *   ・否定型掃描一律先**剝除註解**，並且每一條都自我驗證（餵反例確認抓得到）。
 *
 * Run: node scripts/test-v6159-client-perf-instrumentation.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 工具：剝註解（否定型掃描一律先剝，否則註解裡的字會讓掃描永遠假綠） ──────
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}
const BARE = stripComments(PAGE);
ok('★掃描器自我驗證：剝註解真的有作用（有剝掉、但沒把程式碼一起剝光）',
  BARE.length < PAGE.length && BARE.length > PAGE.length * 0.5,
  `${PAGE.length} → ${BARE.length}`);
ok('★掃描器自我驗證：剝註解會吃掉註解內容',
  !stripComments('const a = 1; // _ltSupported = true;').includes('_ltSupported'));

// ── 工具：抽函式（簽章可能含 `{}`（回傳型別），所以從「簽章那一行的最後一個 {」開始配對） ──
function grabFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const nl = src.indexOf('\n', i);
  const open = src.lastIndexOf('{', nl);
  if (open < 0) return null;
  let d = 0, j = open;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
ok('★掃描器自我驗證：grabFn 對「回傳型別含大括號」的簽章也抓得到完整函式',
  (() => {
    const s = grabFn('function f(a: number): { x: number } | null {\n  return null;\n}\n', 'f');
    return !!s && s.endsWith('}') && s.includes('return null;');
  })());

// ══════════════════════════════════════════════════════════════════════════
// 1. tApi 四段拆分（token / 網路 / JSON 解析 / 總計）
// ══════════════════════════════════════════════════════════════════════════
{
  const i = BARE.indexOf('async function tApi(path: string');
  ok('tApi 找得到', i > 0);
  const seg = BARE.slice(i, i + 3000);
  ok('① 進函式就取起點 _segT0', /const _segT0 = _pnow\(\);/.test(seg));
  // ⚠ v6.167 起 `getIdToken()` 包在 `Promise.race` 的 6 秒逾時裡（原本是單行）——
  //   那是為了修「token 取不回來 ⇒ tApi 永不 resolve ⇒ tBusy 永久 true ⇒ 大廳所有按鈕
  //   （含報到）永久 disabled」。這條的**意圖**沒變：`_segT1` 必須緊接在 token 段之後，
  //   中間不可以再有別的 await（有的話那一段就不只是 token 了，量測會失真）。
  //   ⇒ 改成判斷意圖，不是判斷當時那一行長什麼樣子。
  ok('② getIdToken 之後立刻切 _segT1（token 段），中間沒有別的 await', (() => {
    const gi = seg.indexOf('getIdToken()');
    const s1 = seg.indexOf('_segT1 = _pnow();');
    if (gi < 0 || s1 < 0 || s1 < gi) return false;
    const between = seg.slice(gi + 'getIdToken()'.length, s1);
    return between.length < 400 && !/await\s/.test(between);
  })());
  ok('③ fetch 回來（response header）立刻切 _segT2（網路段）',
    /signal: _ac\.signal,\s*\n\s*\}\);\s*\n\s*_segT2 = _pnow\(\);/.test(seg));
  // ⚠⚠ Fable 5 審查抓到：`fetch` 在 **header** 到達就 resolve，body 還沒下載
  //   ⇒ 把 `res.json()` 整段當「解析」，行動網路 + 大盤面時「解析」欄會被**下載時間**灌爆，
  //     而「網路」欄反而很小 ⇒ 會做出**與事實相反**的結論。必須拆成「下載」與「純 parse」。
  ok('★★④ body 下載自成一段（res.text()），不可以和 JSON.parse 混在一起',
    /const _txt = await res\.text\(\);\s*\n\s*const _segT3 = _pnow\(\);/.test(seg));
  ok('★★⑤ JSON.parse 之後才記錄（純 CPU 段要含在裡面）',
    /const _json = JSON\.parse\(_txt\);\s*\n\s*_tRecordApiSegments\(path, _segT0, _segT1, _segT2, _segT3, _pnow\(\)\);/.test(seg)
    && /_tMarkServerAlive\(\);\s*\n\s*return _json;/.test(seg));   // v6.172 記錄之後、return 之前多一行連線健康錨點
  ok('★★不得再用 res.json()（那會把 body 下載算進「解析」）', !/await res\.json\(\)/.test(seg));

  // ★★ 只記成功的往返 —— 與 v6.151 的 rtt 同一條紀律（逾時是 12 秒，記進去會扭曲統計）
  const iCatch = seg.indexOf('} catch (e: any) {');
  const iRec = seg.indexOf('_tRecordApiSegments(path, _segT0');
  ok('★★只記成功的往返：記錄點在 try 內、catch 之前', iRec > 0 && iCatch > iRec);
  ok('★★catch／finally 區段不得記錄（否則 12 秒逾時會被算成「網路很慢」）',
    !/finally \{ clearTimeout\(_to\); _tRecordApiSegments/.test(seg)
    && seg.slice(iCatch).indexOf('_tRecordApiSegments') < 0);
  // 自我驗證：把記錄搬進 finally 的樣本必須被抓到
  ok('★掃描器自我驗證：搬進 finally 的寫法會被抓到',
    /finally \{ clearTimeout\(_to\); _tRecordApiSegments/
      .test('} finally { clearTimeout(_to); _tRecordApiSegments(0,0,0,0); }'));

  ok('五段各有自己的樣本陣列', ['_segTok', '_segNet', '_segDl', '_segParse', '_segTotal']
    .every((v) => new RegExp('let ' + v + ': number\\[\\] = \\[\\];').test(PAGE)));
  // ⚠⚠⚠ Fable 5 審查抓到的致命污染源：長輪詢 `/state?…&wait=1` 伺服器**刻意掛起最多 25 秒**
  //   ⇒ 記進去 `net` 的 p95 會 by design 變成 ~25 秒，「網路欄大＝網路慢」直接變假訊號。
  const rec = grabFn(BARE, '_tRecordApiSegments');
  ok('★★★長輪詢（wait=1）一律不記', /if \(path\.indexOf\('wait=1'\) >= 0\) return;/.test(rec));
  ok('★★★只記對戰熱路徑 /action 與 /state（大廳端點混進來只會稀釋）',
    /if \(!\(path\.indexOf\('\/action'\) === 0 \|\| path\.indexOf\('\/state'\) === 0\)\) return;/.test(rec));
}

// ══════════════════════════════════════════════════════════════════════════
// 2. tAdopt 採納耗時 + 重繪代理
// ══════════════════════════════════════════════════════════════════════════
{
  const i = BARE.indexOf('function tAdopt(state: any, version: number');
  ok('tAdopt 找得到', i > 0);
  const body = grabFn(BARE, 'tAdopt');
  ok('採納耗時：進函式（拒收 stale 之後）就取起點',
    /version < tVersion\) return;\s*\n\s*const _adoptT0 = _pnow\(\);/.test(body));
  ok('★採納耗時：記錄必須是函式的最後一行（否則量不到整個函式的成本）',
    /_tRecordAdopt\(_adoptT0\);\s*\n\}$/.test(body.trim()) || /_tRecordAdopt\(_adoptT0\);\s*\n\s*\}$/.test(body));
  ok('★重繪代理走 requestAnimationFrame（不是 setTimeout —— 那量的是計時器排隊不是重繪）',
    /requestAnimationFrame\(\(\) => \{/.test(grabFn(BARE, '_tRecordAdopt')));

  // ★★「量測本身不可以變成負擔」——rAF 必須防重入
  const ra = grabFn(BARE, '_tRecordAdopt');
  ok('★★rAF 有防重入（同時只掛一個）', /if \(_paintPending\) return;/.test(ra) && /_paintPending = true;/.test(ra));
  ok('★★背景頁籤不排 rAF（背景時 rAF 根本不 fire）',
    /document\.visibilityState !== 'visible'\) return;/.test(ra));
  ok('★★跨越可見性變動的樣本要丟棄（否則量到的是「切回前景的等待時間」）',
    /const _seq = _visSeq;/.test(ra) && /if \(_seq !== _visSeq\) return;/.test(ra));
  ok('可見性代次真的有人在遞增', /_visSeq\+\+;/.test(BARE));
}

// ══════════════════════════════════════════════════════════════════════════
// 3. longtask —— 共用既有 observer + Safari feature-detect
// ══════════════════════════════════════════════════════════════════════════
{
  // ⚠ v6.170 新增第二顆 observer（`resource`，量「這一發有沒有重新建連線」）。
  //   原意是「不要無節制地多開」而不是「永遠只能有一顆」⇒ 上限改成 2，並釘住這兩顆分別是誰，
  //   多冒出第三顆一樣會紅。resource 的回呼只做幾次算術與計數，沒有配置也沒有 DOM 存取。
  ok('★★PerformanceObserver 最多兩顆（longtask + resource），不得再多開',
    (BARE.match(/new PerformanceObserver\(/g) || []).length === 2,
    String((BARE.match(/new PerformanceObserver\(/g) || []).length));
  ok('★★這兩顆分別是 longtask 與 resource（不是同一種開兩次）',
    /entryTypes: \['longtask'\]/.test(BARE) && /type: 'resource', buffered: false/.test(BARE));
  ok('longtask entry 有累積進滾動窗', /_ltSamples\.push\(\{ t: Date\.now\(\), d: e\.duration \}\);/.test(BARE));
  ok('滾動窗有上限（診斷資料會無限累積）', /_ltSamples\.length > 200/.test(BARE));
  // ★★ Safari/iOS 有 PerformanceObserver 但沒有 longtask，而 observe() 對不支援的
  //    entryType **不會 throw** ⇒ 用「observe 沒爆」當支援判據會把 Safari 誤記成「主執行緒很順」。
  ok('★★支援判據用 supportedEntryTypes（不是「observe 沒 throw」）',
    /supportedEntryTypes/.test(BARE)
    && /_ltSupported = Array\.isArray\(_sup\) && _sup\.indexOf\('longtask'\) >= 0;/.test(BARE));
  ok('★★不得用「observe 沒 throw」當支援判據',
    !/obs\.observe\(\{ entryTypes: \['longtask'\] \}\);\s*\n\s*_ltSupported = true;/.test(BARE));
  ok('★掃描器自我驗證：「observe 沒 throw 就當支援」的寫法會被抓到',
    /obs\.observe\(\{ entryTypes: \['longtask'\] \}\);\s*\n\s*_ltSupported = true;/
      .test("      obs.observe({ entryTypes: ['longtask'] });\n      _ltSupported = true;\n"));
  ok('observer 卸載時把支援旗標歸零', /_ltSupported = false; try \{ obs\?\.disconnect\(\)/.test(BARE));
}

// ══════════════════════════════════════════════════════════════════════════
// 4. 診斷 payload / 裝置資訊 / 跨場殘留
// ══════════════════════════════════════════════════════════════════════════
{
  ok('payload 有 perf 區塊（五段都在）', /perf: \{\s*\n\s*api: \{ tok: _sampleStats\(_segTok\), net: _sampleStats\(_segNet\), dl: _sampleStats\(_segDl\), parse: _sampleStats\(_segParse\), total: _sampleStats\(_segTotal\) \},/.test(BARE));
  ok('payload 有採納／重繪／longtask',
    /adopt: _sampleStats\(_adoptSamples\), paint: _sampleStats\(_paintSamples\),/.test(BARE) && /lt: _longTaskStats\(\),/.test(BARE));
  ok('★v6.151 的 rtt 沒被拆掉（金絲雀：這一版不准動既有量測）', BARE.includes('rtt: _rttStats(),'));
  ok('★v6.151 的動作往返記錄點沒被動到（金絲雀）', BARE.includes('_tRecordRtt(Date.now() - _rttT0);'));
  ok('★★裝置資訊都有 feature-detect（拿不到回 null，絕不 throw）',
    /typeof \(navigator as any\)\.hardwareConcurrency === 'number' \? \(navigator as any\)\.hardwareConcurrency : null/.test(BARE)
    && /typeof \(navigator as any\)\.deviceMemory === 'number' \? \(navigator as any\)\.deviceMemory : null/.test(BARE));
  ok('既有的 w/h/ua 保留', /w: \(typeof window !== 'undefined' \? window\.innerWidth : 0\)/.test(BARE) && /ua: \(typeof navigator !== 'undefined'/.test(BARE));
  ok('★跨場殘留清乾淨（v6.151 的教訓：樣本混到上一場，判讀會掛在錯誤的場次上）',
    /_segTok = \[\]; _segNet = \[\]; _segDl = \[\]; _segParse = \[\]; _segTotal = \[\];/.test(BARE)
    && /_adoptSamples = \[\]; _paintSamples = \[\]; _paintPending = false;/.test(BARE));
  ok('★這一版沒有新增任何自動回報觸發（不製造新的診斷噪音）',
    (BARE.match(/_tSendClientDiag\('/g) || []).length === (BARE.match(/_tSendClientDiag\('/g) || []).length
    && !/_longTaskStats\(\)[\s\S]{0,200}_tSendClientDiag/.test(BARE));
}

// ══════════════════════════════════════════════════════════════════════════
// 5. ★★★ 行為端：把新加的量測函式**實際跑起來**驗資料結構
//    （斷言「有呼叫某函式」≠「那件事發生了」）
// ══════════════════════════════════════════════════════════════════════════
// ⚠ 行為端整段包 try/catch：抽不到／轉不出來也要記成 FAIL，不能讓整支守衛崩潰
//   （崩潰會讓後面的區塊完全沒跑，HEAD-FAIL 的證據就不完整）。
try {
  const names = ['_sampleStats', '_pushSample', '_pnow', '_rttStats', '_tRecordApiSegments', '_tRecordAdopt', '_longTaskStats'];
  const grabbed = names.map((n) => grabFn(PAGE, n));
  ok('★七個量測函式都抽得出來', grabbed.every(Boolean),
    names.filter((n, k) => !grabbed[k]).join(','));

  const PRELUDE = `
    let _rttSamples = [], _segTok = [], _segNet = [], _segDl = [], _segParse = [], _segTotal = [];
    let _adoptSamples = [], _paintSamples = [], _paintPending = false, _visSeq = 0;
    let _ltSamples = [], _ltSupported = false;
    let isTournament = true, isTournSpectator = false;
    const __raf = [];
    function requestAnimationFrame(cb) { __raf.push(cb); return __raf.length; }
    const document = { visibilityState: 'visible' };
  `;
  const EXPORTS = `
    return {
      _sampleStats, _pushSample, _pnow, _rttStats, _tRecordApiSegments, _tRecordAdopt, _longTaskStats,
      get: (k) => ({ _rttSamples, _segTok, _segNet, _segDl, _segParse, _segTotal, _adoptSamples, _paintSamples, _paintPending, __raf })[k],
      set: (k, v) => { if (k === '_ltSupported') _ltSupported = v; else if (k === '_ltSamples') _ltSamples = v;
        else if (k === 'isTournSpectator') isTournSpectator = v; else if (k === 'isTournament') isTournament = v;
        else if (k === 'hidden') document.visibilityState = v ? 'hidden' : 'visible';
        else if (k === '_visSeq') _visSeq = v; else if (k === '_rttSamples') _rttSamples = v; },
      bumpVis: () => { _visSeq++; },
      flushRaf: () => { const q = __raf.splice(0, __raf.length); for (const f of q) f(); return q.length; },
      rafLen: () => __raf.length,
    };
  `;
  const TS = PRELUDE + grabbed.join('\n') + EXPORTS;
  const js = (await transform(TS, { loader: 'ts', target: 'node20' })).code;
  const H = new Function(js)();

  // ── 5a. _sampleStats：p50/p95/max 樣式與 rtt 完全一致 ──
  ok('行為：沒有樣本回 null（不是回 0 —— 0 會被誤讀成「很順」）', H._sampleStats([]) === null);
  ok('行為：單一樣本', eq(H._sampleStats([5]), { n: 1, p50: 5, p95: 5, max: 5 }));
  ok('行為：p50/p95/max 與既有 rtt 同一套公式',
    eq(H._sampleStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { n: 10, p50: 6, p95: 10, max: 10 }));
  ok('行為：亂序輸入會先排序', eq(H._sampleStats([10, 1, 5]), H._sampleStats([1, 5, 10])));
  ok('行為：performance.now 的小數會被 round（欄位一律整數毫秒）',
    eq(H._sampleStats([1.4, 1.6]), { n: 2, p50: 2, p95: 2, max: 2 }));

  // ── 5b. _pushSample：沿用 rtt 的 30 筆滾動窗 ──
  {
    const a = [];
    for (let i = 0; i < 40; i++) H._pushSample(a, i);
    ok('行為：滾動窗 30 筆（沿用既有 rtt 的節流樣式）', a.length === 30 && a[0] === 10 && a[29] === 39);
    const b = [];
    H._pushSample(b, NaN); H._pushSample(b, Infinity); H._pushSample(b, -1); H._pushSample(b, undefined); H._pushSample(b, '5');
    ok('行為：NaN／Infinity／負數／非數字一律不記（壞樣本會毒死整份統計）', b.length === 0, JSON.stringify(b));
    H._pushSample(b, 0);
    ok('行為：0 是合法樣本（token 命中快取就是 0）', b.length === 1);
  }

  // ── 5c. _pnow：高解析且不會 throw ──
  {
    const t1 = H._pnow(), t2 = H._pnow();
    ok('行為：_pnow 回有限數且單調不減', Number.isFinite(t1) && Number.isFinite(t2) && t2 >= t1);
  }

  // ── 5d. _rttStats 仍讀既有的 _rttSamples（金絲雀） ──
  {
    H.set('_rttSamples', [100, 200, 300]);
    ok('行為：_rttStats 仍是既有 rtt 的統計（沒被新東西蓋掉）',
      eq(H._rttStats(), { n: 3, p50: 200, p95: 300, max: 300 }));
  }

  // ── 5e. _longTaskStats：Safari 回 null，支援時回四欄 ──
  {
    H.set('_ltSupported', false);
    let threw = false;
    let r = null;
    try { r = H._longTaskStats(); } catch { threw = true; }
    ok('★★行為：不支援 longtask（Safari/iOS）回 null 且**絕不 throw**', !threw && r === null);

    H.set('_ltSupported', true);
    H.set('_ltSamples', []);
    ok('★★行為：支援但沒有長任務 → 回 0 而不是 null（要分得出「不支援」與「很順」）',
      eq(H._longTaskStats(), { win: 60, n: 0, total: 0, max: 0 }));

    const now = Date.now();
    H.set('_ltSamples', [{ t: now - 5000, d: 120 }, { t: now - 1000, d: 305.7 }, { t: now - 90000, d: 9999 }]);
    ok('★行為：只算最近 N 秒（窗外那筆 9999ms 必須被濾掉）',
      eq(H._longTaskStats(), { win: 60, n: 2, total: 426, max: 306 }), JSON.stringify(H._longTaskStats()));
    ok('行為：窗長可調', eq(H._longTaskStats(120000), { win: 120, n: 3, total: 10425, max: 9999 }));
  }

  // ── 5f. _tRecordApiSegments：四段各自入帳 + 範圍守衛 ──
  {
    H._tRecordApiSegments('/action', 0, 10, 120, 300, 340);
    ok('★行為：五段各自入帳（token 10 / 網路 110 / 下載 180 / 解析 40 / 總計 340）',
      eq([H.get('_segTok'), H.get('_segNet'), H.get('_segDl'), H.get('_segParse'), H.get('_segTotal')],
         [[10], [110], [180], [40], [340]]),
      JSON.stringify([H.get('_segTok'), H.get('_segNet'), H.get('_segDl'), H.get('_segParse'), H.get('_segTotal')]));
    H._tRecordApiSegments('/state?room=x&v=3', 0, 1, 2, 3, 4);
    ok('★行為：短輪詢 /state 有記（那是對戰熱路徑）', H.get('_segTok').length === 2);
    // ★★★ 長輪詢：伺服器刻意掛起最多 25 秒，記進去會讓「網路欄」永遠是假的紅燈
    H._tRecordApiSegments('/state?room=x&v=3&wait=1', 0, 1, 25000, 25010, 25020);
    ok('★★★行為：長輪詢（wait=1）完全不記', H.get('_segTok').length === 2 && H.get('_segNet').indexOf(24999) < 0);
    for (const pp of ['/chat?since=1', '/event', '/bracket?eventId=x', '/clientdiag', '/leaderboard']) {
      H._tRecordApiSegments(pp, 0, 1, 2, 3, 4);
    }
    ok('★★行為：大廳端點一律不記（混進來只會稀釋對戰熱路徑的統計）', H.get('_segTok').length === 2);
    H.set('isTournSpectator', true);
    H._tRecordApiSegments('/action', 0, 1, 2, 3, 4);
    ok('★行為：觀戰者不記（與 rtt 同一個範圍守衛）', H.get('_segTok').length === 2);
    H.set('isTournSpectator', false);
    H.set('isTournament', false);
    H._tRecordApiSegments('/action', 0, 1, 2, 3, 4);
    ok('★行為：非錦標賽不記', H.get('_segTok').length === 2);
    H.set('isTournament', true);
  }

  // ── 5g. _tRecordAdopt：採納耗時 + rAF 重繪代理 + 防重入 + 可見性 ──
  {
    const t0 = H._pnow();
    H._tRecordAdopt(t0);
    ok('★行為：採納耗時有入帳', H.get('_adoptSamples').length === 1 && H.get('_adoptSamples')[0] >= 0);
    ok('★★行為：排了一個 rAF', H.rafLen() === 1);
    H._tRecordAdopt(H._pnow());
    ok('★★行為：rAF 未 flush 前再呼叫，**不會**再排一個（量測不可自己製造負擔）',
      H.rafLen() === 1 && H.get('_adoptSamples').length === 2);
    H.flushRaf();
    ok('★行為：rAF 觸發後重繪樣本入帳', H.get('_paintSamples').length === 1);
    ok('★行為：flush 後 _paintPending 解除（否則之後永遠不再取樣）', H.get('_paintPending') === false);

    // 可見性代次：期間切過背景 ⇒ 那筆丟棄
    H._tRecordAdopt(H._pnow());
    H.bumpVis();
    H.flushRaf();
    ok('★★行為：跨越可見性變動的樣本被丟棄（否則量到的是「切回前景的等待時間」）',
      H.get('_paintSamples').length === 1);

    // 背景頁籤不排 rAF
    H.set('hidden', true);
    const before = H.rafLen();
    const nAdopt = H.get('_adoptSamples').length;
    H._tRecordAdopt(H._pnow());
    ok('★★行為：背景頁籤完全不排 rAF（背景時 rAF 根本不 fire）', H.rafLen() === before);
    ok('★行為：背景時採納耗時照記（那是同步的，與 rAF 無關）', H.get('_adoptSamples').length === nAdopt + 1);
    H.set('hidden', false);

    // 觀戰者不記
    H.set('isTournSpectator', true);
    const n0 = H.get('_adoptSamples').length;
    H._tRecordAdopt(H._pnow());
    ok('★行為：觀戰者不記採納耗時', H.get('_adoptSamples').length === n0);
    H.set('isTournSpectator', false);
  }
} catch (e) { ok('★★★行為端（量測函式實跑）整段可執行', false, String(e && e.message || e)); }

// ══════════════════════════════════════════════════════════════════════════
// 6. ★★★ admin 顯示端：餵一份**沒有新欄位的舊 payload**，實際跑
// ══════════════════════════════════════════════════════════════════════════
try {
  const monMs = grabFn(ADMIN, 'monMs');
  const monStat = grabFn(ADMIN, 'monStat');
  const monPerfCells = grabFn(ADMIN, 'monPerfCells');
  ok('★admin 的顯示 helper 都抽得出來', !!monMs && !!monStat && !!monPerfCells);
  const M = new Function(monMs + '\n' + monStat + '\n' + monPerfCells + '\nreturn { monMs, monStat, monPerfCells };')();

  ok('行為：monMs 對 undefined／null／非數字回「—」',
    M.monMs(undefined) === '—' && M.monMs(null) === '—' && M.monMs('8') === '—' && M.monMs(NaN) === '—');
  ok('行為：monMs 對 0 回「0 ms」（0 是真資料，不可以變成「—」）', M.monMs(0) === '0 ms');
  ok('行為：monMs 小於 1 秒用 ms、超過用秒', M.monMs(306.7) === '307 ms' && M.monMs(6789) === '6.8 秒');
  ok('行為：monStat 對 undefined 容器回 null（不 throw）',
    M.monStat(undefined, 'p95') === null && M.monStat(null, 'p95') === null && M.monStat({}, 'p95') === null
    && M.monStat({ p95: 12 }, 'p95') === 12);

  const CELLS = 13;  // v6.179 再加「排隊／傳輸／SW／續行」四欄：
  //   連線／網路／排隊／傳輸／SW／續行／下載／權杖／解析／採納／重繪／長任務／裝置
  // ★★ 舊 client（v6.158 以前）的 payload：完全沒有 perf / hc / dm
  const LEGACY = { ts: 1786512345678, email: 'a@b.c', p50: 1234, p95: 6789, max: 12345, n: 30 };
  let out = null, threw = null;
  try { out = M.monPerfCells(LEGACY); } catch (e) { threw = e; }
  ok('★★★行為：舊 payload（沒有新欄位）不會 throw', !threw, threw && threw.message);
  ok('★★★行為：舊 payload 仍然畫得出完整一列（不空白）',
    typeof out === 'string' && out.length > 0 && (out.match(/<td/g) || []).length === CELLS,
    String(out && (out.match(/<td/g) || []).length));
  ok('★★★行為：舊 payload 的每一格都是「—」，不會出現 undefined／NaN',
    !!out && !/undefined|NaN|null/.test(out) && out.includes('—'));
  // ⚠ Fable 5 審查抓到：舊 client 原本長任務欄也顯示「不支援」，與說明「不支援＝iPhone/Safari」
  //   直接衝突 ⇒ 站長會把舊版 client 誤讀成 Safari 裝置。
  ok('★★★行為：舊 client（整包沒有 perf）長任務欄是「—」而**不是**「不支援」',
    !!out && !out.includes('不支援'));
  ok('★★★行為：新 client 但瀏覽器不給 longtask（perf.lt = null）才顯示「不支援」',
    M.monPerfCells({ ...LEGACY, perf: { api: {}, lt: null } }).includes('不支援'));

  // 伺服器把缺欄正規化成 null 的情形
  for (const bad of [{ ...LEGACY, perf: null, hc: null, dm: null },
                     { ...LEGACY, perf: {} },
                     { ...LEGACY, perf: { api: {} } },
                     { ...LEGACY, perf: { api: { net: {} }, lt: null } },
                     { ...LEGACY, perf: { api: null, adopt: 'x', paint: 3, lt: 'y' }, hc: 'x', dm: null }]) {
    let t = null, s = null;
    try { s = M.monPerfCells(bad); } catch (e) { t = e; }
    ok('★★行為：半殘 payload 也不 throw 且欄數不變 — ' + JSON.stringify(bad.perf),
      !t && typeof s === 'string' && (s.match(/<td/g) || []).length === CELLS, t && t.message);
  }
  ok('★行為：完全沒有參數也不 throw（防禦到底）',
    (() => { try { return (M.monPerfCells().match(/<td/g) || []).length === CELLS; } catch { return false; } })());

  // 新 payload：數字要真的顯示出來
  const st = (p95) => ({ n: 30, p50: 1, p95, max: p95 });
  const FRESH = { ...LEGACY, hc: 4, dm: 8,
    perf: { api: { tok: st(0), net: st(120), dl: st(880), parse: st(430), total: st(6789) },
            adopt: st(310), paint: st(2400), lt: { win: 60, n: 18, total: 4200, max: 980 } } };
  const f = M.monPerfCells(FRESH);
  ok('★行為：新 payload 的五段／採納／重繪都顯示得出來',
    f.includes('120 ms') && f.includes('880 ms') && f.includes('430 ms') && f.includes('310 ms')
    && f.includes('2.4 秒') && f.includes('0 ms'));
  ok('★行為：長任務顯示次數與總時長', f.includes('18 次') && f.includes('4.2 秒') && f.includes('980 ms'));
  ok('★行為：裝置資訊顯示核心數與記憶體', f.includes('4 核') && f.includes('8 GB'));
  ok('★行為：只有核心數沒有記憶體（iOS 不給 deviceMemory）也畫得出來',
    M.monPerfCells({ ...LEGACY, hc: 6 }).includes('6 核'));

  // ★★ 欄數對帳：表頭 <th> 的新增數必須等於資料列 <td> 的新增數，否則整張表格會錯位/爆版
  const iTbl = ADMIN.indexOf("'<div style=\"font-weight:700;margin-bottom:4px;\">⏱️ 動作往返時間");
  ok('往返時間表格找得到', iTbl > 0);
  // ⚠ v6.179：表格上方的判讀規則變長了，3500 字元切不到表頭那一列 ⇒ 會數出偏少的欄數（假紅）。
  const tbl = ADMIN.slice(iTbl, iTbl + 8000);
  const ths = (tbl.slice(0, tbl.indexOf('</tr>')).match(/<th /g) || []).length;
  ok('★★表頭欄數 = 既有 5 欄 + 新增 ' + CELLS + ' 欄（欄數不對＝整張表格錯位）',
    ths === 5 + CELLS, '實際 ' + ths);
  ok('★欄位變多 → 表格要能橫向捲（否則窄螢幕爆版）',
    /overflow-x:auto;">'/.test(ADMIN) && /min-width:1360px;">'/.test(ADMIN)
    && ADMIN.includes("html += '</table></div></div>';"));
  ok('★資料列有接上 monPerfCells（有 helper 沒接＝白寫）', /\+ monPerfCells\(r\)/.test(ADMIN));
  ok('★有寫給站長的判讀規則（數字沒人看得懂等於沒量）',
    ADMIN.includes('卡在網路，還是卡在那台裝置本身') && ADMIN.includes('再怎麼修伺服器都不會有效果'));
  ok('★★判讀規則有警告「網路欄大也可能是裝置忙」（不可只看一欄下決定性結論）',
    ADMIN.includes('要同時看「長任務」和「重繪」'));
  ok('★判讀規則有講清楚左右兩區的統計範圍不同（不可直接相減）', ADMIN.includes('不能直接相減'));
  ok('★有講清楚「不支援」不等於「很順」', ADMIN.includes('<b>不是</b>代表它很順'));
  ok('★有講清楚「—」代表玩家還是舊版', ADMIN.includes('那位玩家的畫面還是舊版本'));
} catch (e) { ok('★★★admin 顯示端整段可執行', false, String(e && e.message || e)); }

// ══════════════════════════════════════════════════════════════════════════
// 7. 伺服器端：把 perf / 裝置資訊帶給 admin（含舊 payload 正規化）
// ══════════════════════════════════════════════════════════════════════════
try {
  const i = SRV.indexOf("app.get('/api/tournament/admin/clientdiag'");
  ok('clientdiag 讀取端點還在（金絲雀）', i > 0);
  const seg = SRV.slice(i, i + 3200);
  ok('perf 有帶給 admin', /perf: \(d && d\.perf\) \|\| null,/.test(seg));
  ok('裝置資訊有帶且 typeof 檢查', /hc: \(d && d\.env && typeof d\.env\.hc === 'number'\) \? d\.env\.hc : null,/.test(seg)
    && /dm: \(d && d\.env && typeof d\.env\.dm === 'number'\) \? d\.env\.dm : null,/.test(seg));
  ok('既有五欄沒被動掉（金絲雀）', /p50: rt\.p50, p95: rt\.p95, max: rt\.max, n: rt\.n/.test(seg));

  // ★ 實際跑那段 push：舊 diag（沒有 perf）必須正規化成 null，而不是留 undefined
  const m = seg.match(/if \(rt && typeof rt\.p95 === 'number'\) p95s\.push\(\{[\s\S]*?\n\s*\}\);/);
  ok('★抓得到 push 那段', !!m);
  const runner = new Function('r', 'rt', 'd', 'const p95s = [];\n' + m[0] + '\nreturn p95s[0];');
  const rt = { n: 30, p50: 1, p95: 6789, max: 9999 };
  const legacy = runner({ ts: 1, email: 'a@b.c' }, rt, { poll: { rtt: rt }, env: { vis: 'visible' } });
  ok('★★行為：舊 client 的 diag → perf/hc/dm 一律是 null（不是 undefined）',
    legacy.perf === null && legacy.hc === null && legacy.dm === null);
  ok('★★行為：JSON 往返後欄位不會消失（undefined 會被 stringify 整個吃掉，顯示端就分不出舊 client）',
    'perf' in JSON.parse(JSON.stringify(legacy)) && 'hc' in JSON.parse(JSON.stringify(legacy)));
  const fresh = runner({ ts: 1, email: 'a@b.c' }, rt,
    { poll: { rtt: rt }, perf: { api: { net: { p95: 12 } } }, env: { hc: 8, dm: 4 } });
  ok('★行為：新 client 的 perf/hc/dm 有被帶出來',
    fresh.perf && fresh.perf.api && fresh.perf.api.net.p95 === 12 && fresh.hc === 8 && fresh.dm === 4);
  ok('★行為：hc 為 0 也要保留（0 是真資料）', runner({ ts: 1 }, rt, { env: { hc: 0 } }).hc === 0);
} catch (e) { ok('★★★伺服器端 push 正規化整段可執行', false, String(e && e.message || e)); }

console.log(`\nv6.159 client 效能量測儀器化：${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
