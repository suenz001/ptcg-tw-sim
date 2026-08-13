#!/usr/bin/env node
/**
 * v6.179 守衛：把 `perf.api.net` 用 PerformanceResourceTiming 拆成 queue / wire / sw / lag
 *   （**只加量測，不改任何效能邏輯**），並修掉 v6.171 的 `svelteWarn` 假零。
 *
 * 背景 —— v6.159 已經把範圍縮到一點上：`net`（送出 → 第一個位元組）中位 1.3 秒 / 最大 14.9 秒，
 *   而 `dl` 只有 27ms、`parse` 1ms、`adopt` 3ms、`paint` 50ms、`lt` 中位 0
 *   ⇒ 時間**全在等第一個位元組**。伺服器與隧道實測無罪（node 3.7ms、繞 CF 一圈 65ms）。
 *
 * ⚠⚠⚠ 本輪最重要的更正（守在這裡，避免下一個人重走）：
 *   規範上 `workerStart` **早於** `fetchStart`（Resource Timing §3.3：workerStart 取 fetch
 *   timing info 的 final service worker start time、fetchStart 取 post-redirect start time；
 *   MDN 的官方範例逐字寫 `entry.fetchStart - entry.workerStart`）。
 *   ⇒ **Service Worker 派送成本不在 `queue = requestStart - fetchStart` 裡**。
 *     把它算進 queue 會做出與事實**完全相反**的結論，所以 `sw` 必須是獨立一欄。
 *
 * 釘住六件事（每一條都是**行為端實跑**，不是驗字串）：
 *   ① queue / wire 真的從 Resource Timing 取得，且切點正確；
 *   ② SW 派送成本落在 `sw`（fetchStart - workerStart），**不在 queue**；
 *   ③ 對不上 fetch 時間窗的 entry 被**丟棄且計入 seg.bad**（絕不硬湊）；
 *   ④ 不支援 / 拿不到 ⇒ 填 null 且不 throw；
 *   ⑤ admin 對缺欄位的舊 payload 不爆版（欄數對得上、每格「—」）；
 *   ⑥ 量測本身不新增長任務（不多開 observer、環形有上限、對齊路徑無 DOM 存取）。
 *   ＋ svelteWarn 計數器搬到 window 層級（/game 重掛載後仍讀得到）。
 *
 * Run: node scripts/test-v6179-net-queue-wire-split.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

// ── 工具：剝註解（否定型掃描一律先剝，否則註解裡的字讓掃描永遠假綠） ──────────
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}
const BARE = stripComments(PAGE);
ok('★掃描器自我驗證：剝註解真的有作用（有剝掉、但沒把程式碼一起剝光）',
  BARE.length < PAGE.length && BARE.length > PAGE.length * 0.5, `${PAGE.length} → ${BARE.length}`);
ok('★掃描器自我驗證：剝註解會吃掉註解內容',
  !stripComments('const a = 1; // _rtQueueMs.push(1);').includes('_rtQueueMs'));

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
ok('★掃描器自我驗證：grabFn 對「回傳型別含大括號」的簽章也抓得到完整函式', (() => {
  const s = grabFn('function f(a: number): { x: number } | null {\n  return null;\n}\n', 'f');
  return !!s && s.endsWith('}') && s.includes('return null;');
})());

// ══════════════════════════════════════════════════════════════════════════
// ①②③④ 行為端：把量測函式**實際跑起來**
// ══════════════════════════════════════════════════════════════════════════
let H = null;
try {
  const names = ['_sampleStats', '_pushSample', '_tResetResSeg', '_tResWinOpen', '_tRecordResEntry', '_resTimingStats'];
  const grabbed = names.map((n) => grabFn(PAGE, n));
  ok('★★六個函式都抽得出來（`_tResWinOpen` 是本版新增 ⇒ HEAD 會在這裡就紅）',
    grabbed.every(Boolean), names.filter((n, k) => !grabbed[k]).join(','));
  if (!grabbed.every(Boolean)) throw new Error('抽不到：' + names.filter((n, k) => !grabbed[k]).join(','));

  const PRELUDE = `
    let _rtSupported = true, _rtN = 0, _rtBad = 0, _rtReuse = 0, _rtFresh = 0, _rtSw = 0;
    const _rtProto = {}; let _rtConnMs = [], _rtDnsMs = [], _rtTlsMs = [];
    let _rtSegN = 0, _rtSegBad = 0, _rtSegAbort = 0, _rtSwN = 0, _rtSwOdd = 0, _rtLagNeg = 0;
    let _rtQueueMs = [], _rtWireMs = [], _rtSwMs = [], _rtLagMs = [], _rtPreMs = [];
    let _rtWins = [];
    let isTournament = true, isTournSpectator = false;
    const T_API = '/api/tournament';
  `;
  const EXPORTS = `
    return {
      _tResWinOpen, _tRecordResEntry, _resTimingStats, _tResetResSeg,
      wins: () => _rtWins,
      setSupported: (v) => { _rtSupported = v; },
      setScope: (t, s) => { isTournament = t; isTournSpectator = s; },
      reset: () => { _rtN = 0; _rtBad = 0; _rtReuse = 0; _rtFresh = 0; _rtSw = 0; _tResetResSeg(); },
    };
  `;
  const js = (await transform(PRELUDE + grabbed.join('\n') + EXPORTS, { loader: 'ts', target: 'node20' })).code;
  H = new Function(js)();
} catch (e) { ok('★★★行為端（量測函式實跑）整段可執行', false, String((e && e.message) || e)); }

const ORIGIN = 'https://www.ptcg-tw-sim.com';
const mkEntry = (o) => Object.assign({
  name: ORIGIN + '/api/tournament/state?room=R&v=3&s=0',
  startTime: 1001, workerStart: 0, fetchStart: 1060,
  domainLookupStart: 1060, domainLookupEnd: 1060,
  connectStart: 1060, connectEnd: 1060, secureConnectionStart: 0,
  requestStart: 1100, responseStart: 1330, responseEnd: 1340,
  nextHopProtocol: 'h2',
}, o || {});

if (H) {
  // ── ① queue / wire 的切點 ────────────────────────────────────────────
  {
    H.reset();
    const w = H._tResWinOpen('/state?room=R&v=3&s=0', 1000);
    ok('★開窗成功（對戰熱路徑）', !!w && w.t1 === 1000 && w.t2 === 0 && w.used === false);
    w.t2 = 1350;   // header 回來（tApi 會做的事）
    H._tRecordResEntry(mkEntry({ workerStart: 1005 }));
    const st = H._resTimingStats();
    const sg = st && st.seg;
    ok('★★★① queue = requestStart - fetchStart（1100-1060 = 40）',
      !!sg && sg.queue && sg.queue.max === 40, JSON.stringify(sg && sg.queue));
    ok('★★★① wire = responseStart - requestStart（1330-1100 = 230）',
      !!sg && sg.wire && sg.wire.max === 230, JSON.stringify(sg && sg.wire));
    // ★★★ 本輪的核心更正
    ok('★★★② SW 派送 = fetchStart - workerStart（1060-1005 = 55），**獨立一欄**',
      !!sg && sg.sw && sg.sw.max === 55 && sg.swN === 1, JSON.stringify(sg && sg.sw));
    ok('★★★② SW 那 55ms **沒有**被算進 queue（算進去 queue 就會是 95，結論會完全相反）',
      !!sg && sg.queue.max === 40 && sg.queue.max !== 95);
    ok('★★① lag = JS 量的 net(350) − (responseStart − startTime)(329) = 21',
      !!sg && sg.lag && sg.lag.max === 21, JSON.stringify(sg && sg.lag));
    ok('★① 對齊成功計入 seg.n，且沒有誤計 bad', !!sg && sg.n === 1 && sg.bad === 0);
    ok('★① 這一發同時仍走既有 v6.170 的統計（不是另開管線）', st.n === 1 && st.reuse === 1);
    // ⭐ Fable 5 審查抓到：startTime → workerStart 本來沒人承接 ⇒ 五欄加起來對不上 net
    ok('★★★① pre = startTime → workerStart（1005-1001 = 4）',
      !!sg && sg.pre && sg.pre.max === 4, JSON.stringify(sg && sg.pre));
    ok('★★★① 逐筆 pre + sw + queue + wire + lag **恰好等於** net（4+55+40+230+21 = 350 = 1350-1000）',
      !!sg && (sg.pre.max + sg.sw.max + sg.queue.max + sg.wire.max + sg.lag.max) === 350,
      String(sg && (sg.pre.max + sg.sw.max + sg.queue.max + sg.wire.max + sg.lag.max)));
    ok('★① 正常情況 lagNeg 為 0（不為 0 ＝ 算式或時鐘有問題，要看得見）', !!sg && sg.lagNeg === 0);
  }

  // ── ⭐ Fable 5 審查：觀戰輪詢不可以污染 seg.bad ────────────────────────
  {
    H.reset();
    // `/spectate/state?…` 會通過 entry 端 **substring** 的 `/state` 判斷，
    //   但開窗端是 **prefix**（`/state` 開頭）⇒ 兩端母體不一致就會無上限累積假 bad。
    H._tRecordResEntry(mkEntry({ name: ORIGIN + '/api/tournament/spectate/state?room=R&v=3' }));
    ok('★★★觀戰輪詢（/spectate/state）完全不進統計（否則先觀戰再上場的人 bad 爆表＝假警報）',
      H._resTimingStats() === null, JSON.stringify(H._resTimingStats()));
    ok('★★★觀戰輪詢也不開窗（開窗端是 prefix ⇒ 本來就不開；兩端一致）',
      H._tResWinOpen('/spectate/state?room=R&v=3', 1) === null);
  }

  // ── ⭐ Fable 5 審查：逾時／abort 與「對齊失敗」必須分開記 ──────────────
  {
    H.reset();
    const w = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w.t2 = 1350;
    H._tRecordResEntry(mkEntry({ responseStart: 0 }));
    const sg = H._resTimingStats().seg;
    ok('★★★逾時／abort（responseStart === 0）記進 seg.abort，**不是** seg.bad',
      sg.abort === 1 && sg.bad === 0 && sg.n === 0, JSON.stringify(sg));
    ok('★★★（否則網路最爛的那群人 bad 天然偏高，而規則教站長「bad 大＝不可採信」⇒ 自我否定）',
      sg.abort === 1);
  }

  // ── ⭐ Fable 5 審查：lag 的微小負值 clamp 成 0（直接丟會讓分布系統性偏高） ──
  {
    H.reset();
    const w = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w.t2 = 1329;   // net 比瀏覽器的還小 1ms
    H._tRecordResEntry(mkEntry({ workerStart: 1005 }));
    let sg = H._resTimingStats().seg;
    ok('★★★lag 的微小負值 clamp 成 0（不是丟掉 ⇒ 分布不會被系統性拉高）',
      sg.n === 1 && sg.lag && sg.lag.max === 0 && sg.lagNeg === 0, JSON.stringify(sg && sg.lag));
    H.reset();
    const w2 = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w2.t2 = 1100;   // 明顯負值
    H._tRecordResEntry(mkEntry({ workerStart: 1005 }));
    sg = H._resTimingStats().seg;
    ok('★★★lag 明顯負值（< -2ms）要**看得見**（記進 lagNeg），不是靜靜丟掉',
      sg.lagNeg === 1, JSON.stringify(sg));
  }

  // ── 歸零收斂：tLeaveMatch 與 tLeaveSpectate 共用同一支 ─────────────────
  {
    H.reset();
    const w = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w.t2 = 1350;
    H._tRecordResEntry(mkEntry({ workerStart: 1005 }));
    ok('★歸零前有資料', H._resTimingStats().seg.n === 1);
    H._tResetResSeg();
    ok('★★_tResetResSeg 真的把 seg 全部歸零（含 window ring）',
      H._resTimingStats().seg === null && H.wins().length === 0);
  }

  // ── ③ 對不上就丟棄並計入 seg.bad（絕不硬湊） ─────────────────────────
  {
    H.reset();
    const w = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w.t2 = 1350;
    // startTime 落在窗外（早於 t1-2）
    H._tRecordResEntry(mkEntry({ startTime: 900 }));
    let sg = H._resTimingStats().seg;
    ok('★★★③ startTime 落在窗外 ⇒ 丟棄並計入 seg.bad（不硬湊給最近的窗）',
      sg.n === 0 && sg.bad === 1 && sg.queue === null && sg.wire === null, JSON.stringify(sg));

    H.reset();
    const w2 = H._tResWinOpen('/action', 1000); w2.t2 = 1350;
    // 名稱對不上（同一時間窗、不同端點）
    H._tRecordResEntry(mkEntry({ startTime: 1001 }));
    sg = H._resTimingStats().seg;
    ok('★★★③ 名稱對不上（/state 的 entry 配 /action 的窗）⇒ 丟棄並計入 bad',
      sg.n === 0 && sg.bad === 1, JSON.stringify(sg));

    H.reset();
    H._tResWinOpen('/state?room=R&v=3&s=0', 1000);   // 逾時／abort ⇒ 永遠不會關窗（t2 = 0）
    H._tRecordResEntry(mkEntry({}));
    sg = H._resTimingStats().seg;
    ok('★★★③ 沒關窗的（逾時／abort）不可被認領 ⇒ 丟棄計入 bad（只記成功的往返）',
      sg.n === 0 && sg.bad === 1, JSON.stringify(sg));

    H.reset();
    const w3 = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w3.t2 = 1350;
    H._tRecordResEntry(mkEntry({}));
    H._tRecordResEntry(mkEntry({}));   // 同一個窗被第二筆 entry 想再認領
    sg = H._resTimingStats().seg;
    ok('★★★③ 一對一：同一個窗不可以被兩筆 entry 認領（第二筆丟棄計 bad）',
      sg.n === 1 && sg.bad === 1, JSON.stringify(sg));

    H.reset();
    const a = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); a.t2 = 1200;
    const b = H._tResWinOpen('/state?room=R&v=3&s=0', 1210); b.t2 = 1400;
    H._tRecordResEntry(mkEntry({ startTime: 1215, fetchStart: 1220, requestStart: 1230, responseStart: 1390 }));
    ok('★★★③ 兩發同 URL 併行時，靠 startTime 認回**正確**的那一發（不是最舊的那個）',
      a.used === false && b.used === true, `a.used=${a.used} b.used=${b.used}`);

    // 時戳自我驗證：不單調 ⇒ 不可信 ⇒ 丟棄
    H.reset();
    const c = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); c.t2 = 1350;
    H._tRecordResEntry(mkEntry({ responseStart: 1090 }));   // responseStart < requestStart
    sg = H._resTimingStats().seg;
    ok('★★③ 時戳不單調（responseStart < requestStart）⇒ 丟棄計 bad，不硬算出負數',
      sg.n === 0 && sg.bad === 1 && c.used === false, JSON.stringify(sg));

    H.reset();
    const d = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); d.t2 = 1350;
    H._tRecordResEntry(mkEntry({ fetchStart: 0 }));
    sg = H._resTimingStats().seg;
    ok('★★③ fetchStart 為 0（timing 被閹割）⇒ 丟棄計 bad，不會算出 queue = 1100',
      sg.n === 0 && sg.bad === 1, JSON.stringify(sg));
  }

  // ── ② SW 欄的誠實度 ────────────────────────────────────────────────
  {
    H.reset();
    const w = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w.t2 = 1350;
    H._tRecordResEntry(mkEntry({ workerStart: 0 }));
    let sg = H._resTimingStats().seg;
    ok('★★② 沒有經過 SW（workerStart = 0）⇒ swN = 0 且 sw 為 **null**（不是 0）',
      sg.swN === 0 && sg.sw === null && sg.swOdd === 0, JSON.stringify(sg));

    H.reset();
    const w2 = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w2.t2 = 1350;
    H._tRecordResEntry(mkEntry({ workerStart: 1070 }));   // workerStart > fetchStart（不照規範順序）
    sg = H._resTimingStats().seg;
    ok('★★★② 瀏覽器不照規範順序填（workerStart > fetchStart）⇒ 記進 swOdd，**不記假數字**',
      sg.swN === 1 && sg.swOdd === 1 && sg.sw === null, JSON.stringify(sg));
  }

  // ── 範圍守衛：與 _tRecordApiSegments 逐字一致 ────────────────────────
  {
    H.reset();
    ok('★★★長輪詢（wait=1，伺服器 by design 掛起 8~25 秒）不開窗',
      H._tResWinOpen('/state?room=R&v=3&wait=1', 1) === null);
    for (const p of ['/chat?since=1', '/event', '/bracket?eventId=x', '/clientdiag', '/leaderboard']) {
      ok('★大廳端點不開窗 — ' + p, H._tResWinOpen(p, 1) === null);
    }
    H.setScope(true, true);
    ok('★觀戰者不開窗', H._tResWinOpen('/action', 1) === null);
    H.setScope(false, false);
    ok('★非錦標賽不開窗', H._tResWinOpen('/action', 1) === null);
    H.setScope(true, false);
    ok('★開完這些之後一個窗都沒留下', H.wins().length === 0);
  }

  // ── ⑥ 量測本身不可以變成負擔：環形有上限 ─────────────────────────────
  {
    H.reset();
    for (let i = 0; i < 40; i++) H._tResWinOpen('/state?room=R&v=' + i, 1000 + i);
    ok('★★⑥ fetch 時間窗是環形且有上限 16（診斷資料不可無限累積）',
      H.wins().length === 16, String(H.wins().length));
  }

  // ── ④ 不支援 / 沒資料 ⇒ null 且不 throw ─────────────────────────────
  {
    H.reset();
    H.setSupported(false);
    let threw = false, r = null;
    try { r = H._resTimingStats(); } catch { threw = true; }
    ok('★★★④ 不支援 PerformanceObserver ⇒ 整包回 null 且不 throw', !threw && r === null);
    H.setSupported(true);
    const w = H._tResWinOpen('/state?room=R&v=3&s=0', 1000); w.t2 = 1350;
    H._tRecordResEntry(mkEntry({ requestStart: 0, connectStart: 0, connectEnd: 0 }));
    const sg = H._resTimingStats();
    ok('★★★④ v6.170 的閹割判定仍在最前面（requestStart===0 ⇒ res.bad，不會誤入 seg）',
      sg.n === 0 && sg.bad === 1 && sg.seg === null, JSON.stringify(sg && sg.seg));
    ok('★④ 一筆 seg 都沒有時 seg 為 null（不是一堆恆為 0 的欄位）', sg.seg === null);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ⑥ 量測不新增主執行緒負擔（否定型掃描，先剝註解、每條自我驗證）
// ══════════════════════════════════════════════════════════════════════════
{
  ok('★★★⑥ 沒有多開 PerformanceObserver（仍然只有 longtask + resource 兩顆）',
    (BARE.match(/new PerformanceObserver\(/g) || []).length === 2,
    String((BARE.match(/new PerformanceObserver\(/g) || []).length));
  const rec = grabFn(BARE, '_tRecordResEntry');
  ok('_tRecordResEntry 抽得到（剝註解後）', !!rec);
  ok('★★★⑥ 對齊路徑不得碰 DOM（observer 回呼裡做版面查詢＝直接製造長任務）',
    !!rec && !/document\.|querySelector|getBoundingClientRect|innerHTML/.test(rec));
  ok('★掃描器自我驗證：對齊路徑若出現 querySelector 會被抓到',
    /document\.|querySelector/.test('const n = document.querySelectorAll("x").length;'));
  ok('★★⑥ 對齊不得用 getEntriesByType（預設 250 筆 buffer 滿了會靜默不收錄）',
    !!rec && !/getEntriesByType/.test(rec));
  ok('★★⑥ 對齊用 endsWith 字尾比對（不配置字串），不是 new URL()／split／slice',
    !!rec && /e\.name\.endsWith\(cand\.u\)/.test(rec)
    && !/new URL\(/.test(rec) && !/e\.name\.slice\(/.test(rec));
  const wo = grabFn(BARE, '_tResWinOpen');
  ok('_tResWinOpen 抽得到（剝註解後）', !!wo);
  ok('★★⑥ 開窗整支包在 try 裡且失敗回 null（診斷絕不影響對戰）',
    !!wo && /try \{/.test(wo) && /catch \{ return null; \}/.test(wo));
  ok('★★⑥ 開窗的範圍守衛與 _tRecordApiSegments 逐字一致（母體不同 ⇒「對不上」變假訊號）',
    !!wo && /if \(path\.indexOf\('wait=1'\) >= 0\) return null;/.test(wo)
    && /if \(!\(path\.indexOf\('\/action'\) === 0 \|\| path\.indexOf\('\/state'\) === 0\)\) return null;/.test(wo));
}

// ══════════════════════════════════════════════════════════════════════════
// 接線層：tApi 真的有開窗／關窗，且切點與 _segT1／_segT2 完全對齊
// ══════════════════════════════════════════════════════════════════════════
{
  const i = BARE.indexOf('async function tApi(path: string');
  ok('tApi 找得到', i > 0);
  const seg = BARE.slice(i, i + 3500);
  ok('★★★開窗緊接在 _segT1（token 段結束、fetch 即將送出）之後 —— lag 才對得上 `net`',
    /_segT1 = _pnow\(\);\s*\n\s*const _rtWin = _tResWinOpen\(path, _segT1\);/.test(seg));
  ok('★★★關窗緊接在 _segT2（header 回來）之後', /_segT2 = _pnow\(\);\s*\n\s*if \(_rtWin\) _rtWin\.t2 = _segT2;/.test(seg));
  const iCatch = seg.indexOf('} catch (e: any) {');
  const iClose = seg.indexOf('if (_rtWin) _rtWin.t2 = _segT2;');
  ok('★★關窗在 try 內、catch 之前（逾時的那一發不可以被當成成功的往返）',
    iClose > 0 && iCatch > iClose);
  ok('★★★v6.159 的四段拆分沒被動掉（金絲雀：這一版不准改既有量測）',
    BARE.includes('_tRecordApiSegments(path, _segT0, _segT1, _segT2, _segT3, _pnow());')
    && BARE.includes('rtt: _rttStats(),'));
  // ⚠ 站上本來就有兩個 /clientdiag 送出點（_tSendClientDiag ＋ 另一支輕量的）。
  //   這一條釘的是「**沒有變成三個**」——本版不准另開管線。
  ok('★★新欄位接進**既有**的 /clientdiag（送出點沒有變多 ⇒ 沒有另開管線）',
    /res: _resTimingStats\(\),/.test(BARE) && (BARE.match(/tApi\('\/clientdiag'/g) || []).length === 2,
    String((BARE.match(/tApi\('\/clientdiag'/g) || []).length));
  ok('★★★跨場殘留：歸零只有**一份**判準（各寫一套必然漂移）',
    (BARE.match(/_rtSegN = 0;/g) || []).length === 1
    && /function _tResetResSeg\(\): void \{/.test(BARE));
  ok('★★★對戰離場與**觀戰離場**都要呼叫（Fable 5 審查：觀戰殘留會揹到自己那一場）',
    (BARE.match(/_tResetResSeg\(\);/g) || []).length === 2
    && /function tLeaveMatch\(\)[\s\S]*?_tResetResSeg\(\);/.test(BARE)
    && /function tLeaveSpectate\(\)[\s\S]*?_tResetResSeg\(\);/.test(BARE));
}

// ══════════════════════════════════════════════════════════════════════════
// ⑤ admin 顯示端：舊 payload 不爆版 + 新欄位真的畫得出來
// ══════════════════════════════════════════════════════════════════════════
try {
  // ⚠ monPerfCells 有 res 資料時會呼叫 escapeHtml（顯示協定名）⇒ 一起抽出來，
  //   不可以用假的替身：那會讓「顯示端真的跑得起來」變成假綠。
  const esc = grabFn(ADMIN, 'escapeHtml');
  ok('★admin 的 escapeHtml 抽得出來', !!esc);
  const M = new Function(esc + '\n' + grabFn(ADMIN, 'monMs') + '\n' + grabFn(ADMIN, 'monStat') + '\n'
    + grabFn(ADMIN, 'monPerfCells') + '\nreturn { monMs, monStat, monPerfCells };')();
  const CELLS = 13;
  const LEGACY = { ts: 1786512345678, email: 'a@b.c', p50: 1234, p95: 6789, max: 30 };
  let out = null, threw = null;
  try { out = M.monPerfCells(LEGACY); } catch (e) { threw = e; }
  ok('★★★⑤ 舊 payload（完全沒有 perf）不 throw', !threw, threw && threw.message);
  ok('★★★⑤ 舊 payload 仍畫得出完整一列（' + CELLS + ' 格）',
    !!out && (out.match(/<td/g) || []).length === CELLS, String(out && (out.match(/<td/g) || []).length));
  ok('★★★⑤ 舊 payload 每格都是「—」，不會出現 undefined／NaN',
    !!out && !/undefined|NaN/.test(out) && out.includes('—'));

  // v6.170 有 res 但**沒有 seg**（v6.170~v6.178 的 client）
  const V170 = { ...LEGACY, perf: { api: { net: { n: 30, p50: 1300, p95: 4400, max: 14900 } },
    lt: null, res: { n: 30, bad: 0, proto: { h2: 30 }, sw: 30, reuse: 28, fresh: 2, freshPct: 7,
      conn: null, dns: null, tls: null } } };
  let o2 = null, t2 = null;
  try { o2 = M.monPerfCells(V170); } catch (e) { t2 = e; }
  ok('★★★⑤ v6.170~178 的 client（有 res、沒有 res.seg）不 throw 且欄數不變',
    !t2 && !!o2 && (o2.match(/<td/g) || []).length === CELLS, t2 && t2.message);
  ok('★★★⑤ 沒有 seg 的三欄顯示「—」（不是 0 ms）', !!o2 && (o2.match(/—/g) || []).length >= 3);

  for (const bad of [{ ...LEGACY, perf: { api: {}, res: null } },
                     { ...LEGACY, perf: { api: {}, res: { n: 1, bad: 0, proto: {}, seg: null } } },
                     { ...LEGACY, perf: { api: {}, res: { n: 1, bad: 0, proto: {}, seg: {} } } },
                     { ...LEGACY, perf: { api: {}, res: { n: 1, bad: 0, proto: {}, seg: { queue: 'x', wire: null, sw: 3, swN: 'y', bad: null } } } }]) {
    let t = null, s = null;
    try { s = M.monPerfCells(bad); } catch (e) { t = e; }
    ok('★★⑤ 半殘 payload 也不 throw 且欄數不變 — ' + JSON.stringify(bad.perf.res),
      !t && typeof s === 'string' && (s.match(/<td/g) || []).length === CELLS, t && t.message);
  }

  const st = (p95) => ({ n: 30, p50: 1, p95, max: p95 });
  const FRESH = { ...LEGACY, hc: 4, dm: 4,
    perf: { api: { tok: st(0), net: st(1300), dl: st(27), parse: st(1), total: st(1400) },
      adopt: st(3), paint: st(50), lt: { win: 60, n: 0, total: 0, max: 0 },
      res: { n: 30, bad: 0, proto: { h2: 30 }, sw: 30, reuse: 28, fresh: 2, freshPct: 7,
        conn: null, dns: null, tls: null,
        seg: { n: 28, bad: 2, abort: 1, pre: st(3), queue: st(90), wire: st(760),
        sw: st(410), swN: 28, swOdd: 0, lag: st(40), lagNeg: 0 } } } };
  const f = M.monPerfCells(FRESH);
  ok('★★★⑤ 新 payload：排隊／傳輸／SW 三欄真的顯示得出來',
    f.includes('90 ms') && f.includes('760 ms') && f.includes('410 ms') && f.includes('40 ms'), f);
  ok('★★★⑤ SW 欄帶樣本數（分得出「沒經過 SW」與「經過但很快」）', f.includes('(28)'));
  ok('★★★⑤ 對不上的筆數會警示（seg.bad = 2 ⇒ ⚠2）', f.includes('⚠2'));
  ok('★★⑤ 經過 SW 的樣本數為 0 時顯示「未經 SW」而不是 0 ms',
    M.monPerfCells({ ...LEGACY, perf: { api: {}, res: { n: 1, bad: 0, proto: {},
      seg: { n: 1, bad: 0, abort: 0, pre: null, queue: st(5), wire: st(9),
        sw: null, swN: 0, swOdd: 0, lag: null, lagNeg: 0 } } } }).includes('未經 SW'));

  // ★★ 欄數對帳：表頭 <th> 數 = 5 + CELLS，否則整張表格錯位
  const iTbl = ADMIN.indexOf("'<div style=\"font-weight:700;margin-bottom:4px;\">⏱️ 動作往返時間");
  ok('往返時間表格找得到', iTbl > 0);
  const tbl = ADMIN.slice(iTbl, iTbl + 6000);
  const ths = (tbl.slice(0, tbl.indexOf('</tr>')).match(/<th /g) || []).length;
  ok('★★★⑤ 表頭欄數 = 既有 5 欄 + ' + CELLS + ' 欄（不對＝整張表格錯位）', ths === 5 + CELLS, '實際 ' + ths);
  ok('★★⑤ 欄位變多 ⇒ min-width 要跟著放寬（否則窄螢幕爆版）', ADMIN.includes("min-width:1360px;\">'"));
  ok('★⑤ 四個新表頭都在',
    tbl.includes('>排隊</th>') && tbl.includes('>傳輸</th>') && tbl.includes('>SW</th>') && tbl.includes('>續行</th>'));
  ok('★★★⑤ `lag`（續行）也要上表 —— 只放在原始 JSON 裡等於沒量（Fable 5 審查）',
    ADMIN.includes('const lagTxt = hasSeg') && ADMIN.includes("+ lagTxt + '</td>'"));
  ok('★★★判讀規則：續行大 ⇒ 不是網路，是主執行緒忙',
    ADMIN.includes('那 1.3 秒<b>不是網路</b>'));

  // 判讀規則（數字沒人看得懂等於沒量）
  ok('★★★判讀規則：排隊大 ⇒ 請求還沒送出去之前', ADMIN.includes('卡在<b>請求還沒送出去之前</b>'));
  ok('★★★判讀規則：傳輸大 ⇒ 真網路／CF／隧道',
    ADMIN.includes('卡在<b>真正的往返</b>') && ADMIN.includes('Cloudflare／隧道／VM'));
  ok('★★★判讀規則：有寫清楚 SW 那一段**不含**在排隊裡（本輪最容易誤讀的一點）',
    ADMIN.includes('這一段不包含在「排隊」裡'));
  ok('★★★判讀規則：⚠N 代表對不上（已丟棄），**不是**「很順」',
    ADMIN.includes('不可採信') && ADMIN.includes('<b>不是</b>「很順」'));
  ok('★判讀規則：三欄是「—」代表玩家還是舊版畫面', ADMIN.includes('那位玩家還是 v6.178 以前的畫面'));
  // ⭐v6.180：原本寫死 '6.179'，下一版一 bump 就假紅（v6.171 已經在 test-v6170 修過同一型）。
  //   意圖是「admin 的對照值有跟著站點版本走」⇒ 改成「≥ 6.179 且與 version.ts 一致」。
  {
    const _am = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(ADMIN);
    const _vm = /VERSION = '([\d.]+)'/.exec(
      readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'));
    ok('★admin 版本提示有 bump（≥ 6.179 且與 version.ts 一致）',
      !!_am && !!_vm && parseFloat(_am[1]) >= 6.179 && _am[1] === _vm[1], _am && _am[1]);
  }
} catch (e) { ok('★★★⑤ admin 顯示端整段可執行', false, String((e && e.message) || e)); }

// ══════════════════════════════════════════════════════════════════════════
// ⑦ svelteWarn 假零：計數器必須與 hook 同生命週期（window 層級）
// ══════════════════════════════════════════════════════════════════════════
try {
  const start = PAGE.indexOf('const _svelteWarn:');
  const endMark = '\n  }\n  // ⭐⭐v6.171 假說驗證用';
  const end = PAGE.indexOf(endMark, start);
  ok('★★⑦ 抓得到 window 層級的容器＋hook 本體（HEAD 是元件實例變數 ⇒ 這裡就會紅）',
    start > 0 && end > start);
  if (start > 0 && end > start) {
    const code = PAGE.slice(start, end + 4)
      .replace(/: \{ counts: Record<string, number>; first: string\[\]; lastPointerAt: number \}/g, '')
      .replace(/\(window as \{[^}]*\}\)/g, 'window')
      .replace(/\(window as any\)/g, 'window')
      .replace(/\.\.\.args: unknown\[\]/g, '...args')
      .replace(/\.\.\.\(args as \[\]\)/g, '...args');
    // 同一個 fakeWindow ＝ 同一個分頁；跑兩次 ＝ /game 掛載兩次（第二次 hook 不會重裝）
    const fakeWindow = { addEventListener: () => {} };
    const calls = [];
    const realWarn = (...a) => { calls.push(a); };
    const mount = (consoleObj) => new Function('window', 'console', 'Date',
      code + '\n; return { store: _svelteWarn, warn: console.warn };')(fakeWindow, consoleObj, Date);

    const c1 = { warn: realWarn };
    const m1 = mount(c1);
    m1.warn('https://svelte.dev/e/derived_inert');
    ok('★⑦ 第一次掛載：hook 有計數', m1.store.counts.derived_inert === 1, JSON.stringify(m1.store.counts));

    // 第二次掛載：__ptcgSvelteWarnHook 已經是 true ⇒ 不重裝 hook，
    //   但**新實例讀到的容器必須是同一個**（v6.171 的假零就在這裡）。
    const c2 = { warn: c1.warn };   // 分頁上的 console.warn 仍然是第一次包裝過的那一份
    const m2 = mount(c2);
    ok('★★★⑦ 第二次掛載不會重裝 hook（沿用 v6.171 的防重裝旗標）',
      fakeWindow.__ptcgSvelteWarnHook === true && m2.warn === c1.warn);
    ok('★★★⑦ 新實例讀到的是**同一個**容器（HEAD 是各自獨立 ⇒ 這裡會拿到空的＝假零）',
      m2.store === m1.store && m2.store.counts.derived_inert === 1, JSON.stringify(m2.store.counts));
    // 重掛載之後再發生的 warning，新實例也要看得到
    c1.warn('https://svelte.dev/e/derived_inert');
    ok('★★★⑦ 重掛載後新產生的 warning，新實例讀得到（這正是 v6.171 漏掉的那條路）',
      m2.store.counts.derived_inert === 2, JSON.stringify(m2.store.counts));
    ok('★⑦ 容器掛在 window.__ptcgSvelteWarn（與 hook 同一個生命週期）',
      fakeWindow.__ptcgSvelteWarn === m1.store);
    ok('★⑦ 原始 console.warn 仍被 call through（不吞任何一則）', calls.length === 2);
    ok('★⑦ lastPointerAt 也在容器裡（HEAD 的 _lastPointerAt 同樣是實例變數）',
      typeof m1.store.lastPointerAt === 'number');
    ok('★★⑦ payload 讀的是 window 層級容器，不是元件實例變數',
      BARE.includes('counts: { ..._svelteWarn.counts }')
      && !/const _svelteWarnCounts: Record<string, number> = \{\};/.test(BARE));
  }
} catch (e) { ok('★★★⑦ svelteWarn 區段整段可執行', false, String((e && e.message) || e)); }

console.log(`\nv6.179 net 拆成 queue/wire/sw/lag：${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
