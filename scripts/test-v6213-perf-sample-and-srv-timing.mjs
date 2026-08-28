#!/usr/bin/env node
/**
 * v6.213 守衛 ②③：低頻無條件取樣（健康對照組）＋ 伺服器端 per-request 處理時間
 *
 * ② 這一版在補什麼
 * ──────────────────────────────────────────────────────────────────────────
 *   v6.198 把 stale-version 的送出判準收緊之後，**網路正常的人不再送任何回報**
 *   ⇒ tournamentClientDiag 的母體只剩病人，「往後有沒有變慢」原則上答不出來。
 *   ⇒ 每一場錦標賽對戰進場時擲一次骰子（1%），中籤者在累積 20 發成功往返後
 *     送一發 reason='perf-sample' 的快照，走**既有** /clientdiag 管線與既有節流。
 *   ⚠ 取樣與異常回報必須**在 dump 與 admin 都分開統計**，否則所有既有數字失真。
 *
 * ③ 這一版在補什麼
 * ──────────────────────────────────────────────────────────────────────────
 *   `perf.api.net` 把「隧道／CF 慢」與「Node 處理慢」綁死。伺服器改在
 *   /api/tournament/* 的回應帶 `X-Srv-Ms`（純處理時間），client 寫進 `perf.srv`。
 *
 * 這支守衛怎麼避免「自己在說謊」
 * ──────────────────────────────────────────────────────────────────────────
 *   [HEAD-FAIL] 還原成 v6.212 會 FAIL。
 *   [行為]      client 的取樣／srv 記錄函式、伺服器中介層、dump 的分帳函式
 *               **全部抽出來實跑**（斷言「有呼叫某函式」≠「那件事發生了」）。
 *   [統計]      用固定種子的 RNG 跑 200000 場，實測中籤率必須落在 1% 的信賴區間內
 *               （只斷言「不是 0、不是 100%、而且就在 1% 附近」）。
 *   [分母污染]  專門一條：離場不清旗標的話，機率會隨場次累積 —— 用行為端證明會清。
 *   [正對照]    每一條否定型斷言都配一條「這個 pattern 在檔案裡確實找得到」。
 *
 * Run: node scripts/test-v6213-perf-sample-and-srv-timing.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require_ = createRequire(import.meta.url);
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const DUMPSRC = readFileSync(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'), 'utf8');
const DUMP = require_(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' — ' + extra : '')); } };

// 抽出一支函式的完整原始碼（大括號配對）。
function grabFn(src, name) {
  const re = new RegExp('function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index + m[0].length - 1);
  if (i < 0) return null;
  let d = 0;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(m.index, k + 1); }
  }
  return null;
}

console.log('0) 前提：抽得到東西（抽不到的話後面每一條都是假綠）');
const fnRecSeg = grabFn(PAGE, '_tRecordApiSegments');
const fnRecSrv = grabFn(PAGE, '_tRecordSrvSample');
const fnMaybe = grabFn(PAGE, '_tMaybePerfSample');
ok('[前提] 三支 client 函式都抽得出來', !!fnRecSeg && !!fnRecSrv && !!fnMaybe,
  [!fnRecSeg && '_tRecordApiSegments', !fnRecSrv && '_tRecordSrvSample', !fnMaybe && '_tMaybePerfSample'].filter(Boolean).join(','));

// ══════════════════════════════════════════════════════════════════════════
// 1. ② 取樣：機率、觸發點、跨場清乾淨
// ══════════════════════════════════════════════════════════════════════════
console.log('\n1) ② 低頻無條件取樣');
ok('[HEAD-FAIL／核心②] 機率常數就是每場 10%（PERF_SAMPLE_RATE = 0.1，v6.214④ 站長裁定由 1% 調高）',
  /const PERF_SAMPLE_RATE = 0\.1;/.test(PAGE));
ok('[核心②] 樣本門檻是常數而不是魔術數字（20 發成功往返才送）',
  /const PERF_SAMPLE_MIN_CALLS = 20;/.test(PAGE));
ok('[HEAD-FAIL／核心②] 骰子以房號當鍵、每場只擲一次（不是每個動作／每次輪詢都擲）',
  /if \(_perfSampleRoom !== tActiveRoom\) \{\s*\n\s*_perfSampleRoom = tActiveRoom;\s*\n\s*_perfSampleArmed = Math\.random\(\) < PERF_SAMPLE_RATE;/.test(PAGE));
ok('[HEAD-FAIL／核心②] 全檔只有**一處** Math.random 與取樣有關（第二處＝機率不再是 1%）',
  (PAGE.match(/_perfSampleArmed = Math\.random\(\)/g) || []).length === 1);
{
  // ⚠ 分母污染的關鍵：Math.random() 只能出現在進場那一行。若還有第二處（例如每發都擲），
  //   實際機率就不是 1%，而且完全不會有人發現（送出來的資料看起來一模一樣）。
  const armLines = (PAGE.match(/_perfSampleArmed = /g) || []).length;
  ok('[HEAD-FAIL／分母污染] `_perfSampleArmed` 全檔只有 3 處：宣告 + 擲骰 + 離場清乾淨',
    armLines === 3
    && /let _perfSampleArmed = false;/.test(PAGE)
    && /_perfSampleArmed = Math\.random\(\) < PERF_SAMPLE_RATE;/.test(PAGE)
    && /_perfSampleRoom = ''; _perfSampleArmed = false; _perfSampleSent = false;/.test(PAGE),
    '實際 ' + armLines + ' 處');
}
ok('[HEAD-FAIL／分母污染] 離場一定要清旗標與房號（不清 ⇒ 下一場沿用上一場的中籤結果）',
  /_perfSampleRoom = ''; _perfSampleArmed = false; _perfSampleSent = false;/.test(PAGE));
ok('[核心②] srv 樣本與計數器也跨場清乾淨（母體要與 net 一致）',
  /_segSrv = \[\]; _srvHdrN = 0; _srvHdrMiss = 0;/.test(PAGE));
ok('[HEAD-FAIL／核心②] 用的是**既有** /clientdiag 管線', /_tSendClientDiag\('perf-sample'\)/.test(PAGE));
{
  // ⚠ v6.213 第二輪審查：原本的否定式是「沒有 tApi('/perfsample')」—— 換個名字就繞過。
  //   ⇒ 改成**白名單**：全檔 tApi 的端點字面量必須都在既有清單內（新端點會直接紅）。
  const KNOWN = ['/clientdiag', '/checkin', '/champions', '/leaderboard', '/profile', '/unregister',
    '/cancel-proposal', '/event', '/bracket', '/chat', '/register', '/register-and-checkin', '/drop',
    '/match/enter', '/match/forfeit', '/propose', '/replay', '/champion-bracket', '/spectate/list',
    '/action', '/state', '/spectate/state', '/still-here', '/forfeit', '/undo',
    '/join', '/reset', '/push/selftest'];
  const lits = [...new Set([...PAGE.matchAll(/tApi\(\s*'([^'`]+)'/g)].map((m) => m[1].split('?')[0]))];
  ok('[自我驗證] 抓得到 tApi 的端點字面量（抓到 0 個 ⇒ 下面那條沒有意義）', lits.length >= 8, String(lits.length));
  const unknown = lits.filter((x) => !KNOWN.includes(x));
  ok('★★[HEAD-FAIL／核心②] 沒有新增任何端點（tApi 的端點字面量都在既有白名單內）',
    unknown.length === 0, JSON.stringify(unknown));
  ok('[HEAD-FAIL／核心②] 伺服器端也沒有新增取樣專用端點',
    !/app\.(get|post)\('\/api\/tournament\/(perfsample|sample|perf)'/.test(SRV));
}
ok('[核心②] 取樣不佔「每頁 3 發」的異常配額（取樣把真異常擠靜音會比沒有對照組更糟）',
  /_isExempt = _isManual \|\| reason === 'stale-board-drop' \|\| reason === 'perf-sample';/.test(PAGE));
{
  // 正對照：上面那條否定型（沒有另開端點）不是恆真 —— 檔案裡確實有 tApi('/clientdiag' 這種寫法。
  ok('[正對照] 「沒有另開端點」不是恆真式：檔案裡確實有 tApi(\'/clientdiag\' 的寫法',
    /tApi\('\/clientdiag'/.test(PAGE));
}

// ── 1b. 行為端：把三支函式實際跑起來 ──────────────────────────────────────
console.log('\n1b) ② 行為端（把 client 的取樣邏輯真的跑起來）');
try {
  const PRELUDE = `
    let isTournament = true, isTournSpectator = false;
    let _segTok = [], _segNet = [], _segDl = [], _segParse = [], _segTotal = [], _segSrv = [];
    let _srvHdrN = 0, _srvHdrMiss = 0;
    let _perfSampleRoom = '__none__', _perfSampleArmed = false, _perfSampleSent = false;
    let tActiveRoom = 'ROOM-1';
    let __forceRnd = null;
    const Math = Object.create(globalThis.Math);
    Math.random = () => (__forceRnd === null ? globalThis.Math.random() : __forceRnd);
    const PERF_SAMPLE_MIN_CALLS = 20;
    const PERF_SAMPLE_RATE = 0.1;    // v6.214④（0.99 仍 > 0.1、0.001 仍 < 0.1，下方兩條命中/不命中的固定骰不受影響）
    const __sent = [];
    function _tSendClientDiag(reason) { __sent.push(reason); }
    function _pushSample(arr, ms) { if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return; arr.push(ms); if (arr.length > 30) arr.shift(); }
  `;
  const EXPORTS = `
    return {
      _tRecordApiSegments, _tRecordSrvSample, _tMaybePerfSample,
      sent: () => __sent.slice(),
      get: (k) => ({ _segTotal, _segSrv, _srvHdrN, _srvHdrMiss, _perfSampleArmed, _perfSampleSent, _perfSampleRoom })[k],
      set: (k, v) => { if (k === '_perfSampleArmed') _perfSampleArmed = v;
        else if (k === '_perfSampleSent') _perfSampleSent = v;
        else if (k === '_perfSampleRoom') _perfSampleRoom = v;
        else if (k === 'tActiveRoom') tActiveRoom = v;
        else if (k === 'rnd') __forceRnd = v;
        else if (k === 'isTournament') isTournament = v;
        else if (k === 'isTournSpectator') isTournSpectator = v; },
      reset: () => { _segTotal = []; _segSrv = []; _srvHdrN = 0; _srvHdrMiss = 0; __sent.length = 0; },
    };
  `;
  const TS = PRELUDE + [fnRecSeg, fnRecSrv, fnMaybe].join('\n') + EXPORTS;
  const js = (await transform(TS, { loader: 'ts', target: 'node20' })).code;
  const H = new Function(js)();

  const feed = (n, path = '/action', srv = 3) => { for (let i = 0; i < n; i++) { H._tRecordApiSegments(path, 0, 1, 2, 3, 4); H._tRecordSrvSample(path, srv); } };

  // ① 沒中籤 ⇒ 一輩子都不送（骰子固定 0.99 > 0.01）
  H.reset(); H.set('rnd', 0.99); H.set('_perfSampleRoom', '__none__'); H.set('tActiveRoom', 'R1');
  feed(200);
  ok('★行為②：沒中籤的那 99% 完全不送（也不會有任何額外成本）', H.sent().length === 0, JSON.stringify(H.sent()));

  // ② 中籤但樣本不足 ⇒ 不送（骰子固定 0.001 < 0.01）
  H.reset(); H.set('rnd', 0.001); H.set('_perfSampleRoom', '__none__'); H.set('tActiveRoom', 'R2');
  feed(19);
  ok('★★行為②：中籤但只有 19 發往返 ⇒ 還不送（太早送等於只量到開局那幾發）', H.sent().length === 0);
  feed(1);
  ok('★★★行為②：滿 20 發就送出一發 perf-sample', H.sent().length === 1 && H.sent()[0] === 'perf-sample', JSON.stringify(H.sent()));
  feed(500);
  ok('★★★行為②：一整場只送一發（不論之後又跑了幾百發往返）', H.sent().length === 1, '實際 ' + H.sent().length + ' 發');

  // ②b 換房＝新的一場：旗標要重擲、也要重新可送
  H.reset(); H.set('rnd', 0.001); H.set('tActiveRoom', 'R3');
  feed(20);
  ok('★★★行為②：換到新的一場（房號變）⇒ 重新擲骰、重新可以送一發',
    H.sent().length === 1 && H.get('_perfSampleRoom') === 'R3', JSON.stringify([H.sent(), H.get('_perfSampleRoom')]));
  // ②c 同一場內骰子只擲一次：中途把假骰子改成「不中」也不影響已中籤的這一場
  H.reset(); H.set('rnd', 0.001); H.set('tActiveRoom', 'R4');
  feed(5); H.set('rnd', 0.99); feed(20);
  ok('★★★行為②：同一場內不重擲（房號沒變 ⇒ 中途改骰子也不影響）', H.sent().length === 1, JSON.stringify(H.sent()));

  // ③ 範圍守衛：與 _tRecordApiSegments 完全一致
  H.reset(); H.set('rnd', 0.001); H.set('_perfSampleRoom', '__none__'); H.set('tActiveRoom', 'R5');
  for (let i = 0; i < 50; i++) H._tRecordSrvSample('/state?room=x&v=1&wait=1', 25000);
  ok('★★★行為②③：長輪詢（wait=1）完全不記、也不會觸發取樣（否則 srv 會 by design 變成 25 秒）',
    H.get('_segSrv').length === 0 && H.get('_srvHdrN') === 0 && H.get('_srvHdrMiss') === 0 && H.sent().length === 0);
  for (const pp of ['/chat?since=1', '/event', '/bracket?eventId=x', '/clientdiag', '/leaderboard']) {
    for (let i = 0; i < 30; i++) H._tRecordSrvSample(pp, 5);
  }
  ok('★★行為③：大廳端點一律不記（母體必須與 perf.api.* 逐字相同，才能相減）',
    H.get('_segSrv').length === 0 && H.sent().length === 0);
  H.set('isTournSpectator', true);
  for (let i = 0; i < 30; i++) H._tRecordSrvSample('/action', 5);
  ok('★行為③：觀戰者不記', H.get('_segSrv').length === 0);
  H.set('isTournSpectator', false);
  H.set('isTournament', false);
  for (let i = 0; i < 30; i++) H._tRecordSrvSample('/action', 5);
  ok('★行為③：非錦標賽不記', H.get('_segSrv').length === 0);
  H.set('isTournament', true);

  // ④ srv 標頭：有值 vs 沒帶，必須分得出來
  H.reset(); H.set('rnd', 0.99);
  for (let i = 0; i < 5; i++) H._tRecordSrvSample('/action', 7);
  for (let i = 0; i < 3; i++) H._tRecordSrvSample('/action', null);
  ok('★★★行為③：有帶標頭記進 srv、沒帶的只加 miss（「舊伺服器」與「伺服器很快」必須分得出來）',
    H.get('_segSrv').length === 5 && H.get('_srvHdrN') === 5 && H.get('_srvHdrMiss') === 3,
    JSON.stringify([H.get('_segSrv').length, H.get('_srvHdrN'), H.get('_srvHdrMiss')]));
  H.reset(); H.set('rnd', 0.99);
  H._tRecordSrvSample('/action', 0);
  ok('★★行為③：0 ms 是**合法樣本**（伺服器真的很快），不可以被當成「沒帶」',
    H.get('_segSrv').length === 1 && H.get('_srvHdrN') === 1 && H.get('_srvHdrMiss') === 0);
  for (const bad of [NaN, Infinity, -1, undefined, '5']) H._tRecordSrvSample('/action', bad);
  ok('★★行為③：NaN／Infinity／負數／字串一律算「沒帶」，不會毒死統計',
    H.get('_segSrv').length === 1 && H.get('_srvHdrMiss') === 5, JSON.stringify([H.get('_segSrv'), H.get('_srvHdrMiss')]));
} catch (e) { ok('★★★② 行為端整段可執行', false, String((e && e.message) || e)); }

// ── 1c. 機率：實際擲 200000 次 ────────────────────────────────────────────
console.log('\n1c) ② 機率實測：把**真的那一行**跑 200000 場');
{
  // ⚠ v6.213 第二輪 opus 審查抓到：這一節原本是「自己寫一個 LCG、自己擲 20 萬次」——
  //   跟產品程式碼零關係，等同於 `0.01 === 0.01`（placebo）。
  //   ⇒ 改成把 `_tRecordSrvSample` 裡**真正那一段擲骰程式碼**抽出來跑 20 萬「場」
  //     （每一場換一個房號），亂數由外面注入以便重現。
  const RATE = Number((/const PERF_SAMPLE_RATE = ([0-9.]+);/.exec(PAGE) || [])[1]);
  ok('[核心②] 機率常數抓得出來且等於 0.1（v6.214④）', RATE === 0.1, String(RATE));
  const armSrc = /if \(_perfSampleRoom !== tActiveRoom\) \{[\s\S]*?\n    \}/.exec(fnRecSrv || '');
  ok('[前提] 抽得到真正的擲骰區塊（抽不到 ⇒ 下面那條沒有意義）', !!armSrc);
  if (armSrc) {
    const ARM = armSrc[0];
    const runner = new Function('PERF_SAMPLE_RATE', 'rndSeq', [
      "let _perfSampleRoom = '', _perfSampleArmed = false, _perfSampleSent = false;",
      "let tActiveRoom = '';",
      'let i = 0, hit = 0, rolls = 0;',
      'const Math = { random: () => { rolls++; return rndSeq[i]; } };',
      'for (i = 0; i < rndSeq.length; i++) {',
      "  tActiveRoom = 'ROOM-' + i;",
      '  ' + ARM,
      '  if (_perfSampleArmed) hit++;',
      '  for (let k = 0; k < 5; k++) { ' + ARM + ' }',   // 同一場再問 5 次：不可以重擲
      '}',
      'return { hit, rolls, n: rndSeq.length };',
    ].join('\n'));
    // ⚠ 亂數來源用 xorshift32（固定種子、可重現）並取**全部 32 位元**除以 2^32。
    //   一開始用 `(LCG % 1e6)/1e6` 量到 1.18% —— 那是 LCG **低位元週期很短**造成的，
    //   不是產品程式碼的問題。這件事本身就是「量測工具要先自我驗證」的例子。
    const N = 200000;
    const seq = new Array(N);
    let x = 2463534242;
    for (let k = 0; k < N; k++) {
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      seq[k] = x / 4294967296;
    }
    {
      // 量測工具的自我驗證：這串亂數本身要夠均勻，否則上面那條斷言在驗的是亂數不是程式碼。
      let lo = 0;
      for (const v of seq) if (v < RATE) lo++;
      const selfRate = lo / N;
      // ⚠ 門檻用 RATE 算出來（±5σ），不是寫死的數字 —— 寫死的話下次再調機率又要手改一次。
      const _sig = Math.sqrt(RATE * (1 - RATE) / N);
      ok('[自我驗證] 亂數來源本身是均勻的（< RATE 的比例就是 RATE）',
        Math.abs(selfRate - RATE) < 5 * _sig, (selfRate * 100).toFixed(4) + '%');
    }
    const r = runner(RATE, seq);
    const obs = r.hit / r.n;
    console.log('  真碼實測中籤率 ' + (obs * 100).toFixed(3) + '%（' + r.hit + ' / ' + r.n + '），共擲 ' + r.rolls + ' 次骰');
    ok('★★★[核心②] 用**真的那一行**跑 20 萬場，中籤率就是 RATE（不是 0、不是 100%）',
      Math.abs(obs - RATE) < 5 * Math.sqrt(RATE * (1 - RATE) / r.n), (obs * 100).toFixed(4) + '%');
    ok('★★★[核心②／分母污染] 每場只擲**一次**骰子（同一場多問 5 次都不會重擲）',
      r.rolls === r.n, '擲了 ' + r.rolls + ' 次／' + r.n + ' 場');
    console.log('  ⇒ 產能估算（給站長看的誠實數字）：一場 30 人 × 5 輪 ≈ 150 場對戰，'
      + (RATE * 100).toFixed(0) + '% ⇒ 每場賽事約 ' + (150 * RATE).toFixed(1) + ' 筆取樣。');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 2. ③ 伺服器端：中介層
// ══════════════════════════════════════════════════════════════════════════
console.log('\n2) ③ 伺服器 per-request 處理時間');
ok('[HEAD-FAIL／核心③] 有一支只掛在 /api/tournament 的中介層',
  /app\.use\('\/api\/tournament', function _srvTimingMw\(req, res, next\)/.test(SRV));
ok('[核心③] 標頭名稱是常數（client 端與 admin 說明都靠它）', /const SRV_MS_HEADER = 'X-Srv-Ms';/.test(SRV));
{
  // ⚠ Express 依註冊順序走 layer（v1.11 gzip 掛在 stack 尾端永遠輪不到的事故）。
  const iMw = SRV.indexOf("app.use('/api/tournament', function _srvTimingMw");
  const iFirstRoute = Math.min(
    ...['app.get(\'/api/tournament', 'app.post(\'/api/tournament']
      .map((k) => { const v = SRV.indexOf(k); return v < 0 ? Number.MAX_SAFE_INTEGER : v; }));
  ok('★★★[核心③] 中介層註冊在**所有** /api/tournament 路由之前（否則永遠輪不到）',
    iMw > 0 && iFirstRoute < Number.MAX_SAFE_INTEGER && iMw < iFirstRoute,
    'mw@' + iMw + ' firstRoute@' + iFirstRoute);
}
{
  const mw = grabFn(SRV, '_srvTimingMw');
  ok('[前提] 中介層抽得出來', !!mw);
  if (mw) {
    // ★★★ 只加量測、不動業務邏輯：整支不可以有 await / DB / 回應內容的改動。
    ok('★★★[核心③] 中介層裡沒有 await、沒有 DB、沒有任何回應內容的改寫',
      !/\bawait\b/.test(mw) && !/db\.|collection\(|findOne|insertOne|updateOne/.test(mw)
      && !/res\.json\(|res\.send\(|res\.status\(/.test(mw));
    ok('[正對照] 上一條不是恆真式：這些 pattern 在同一個檔案裡到處都是',
      /\bawait\b/.test(SRV) && /res\.json\(/.test(SRV) && /insertOne/.test(SRV));
    // ⚠ 否定型斷言必須先剝註解 —— 這支中介層的註解裡就寫著 `res.on('finish')` 這幾個字，
    //   不剝的話會被自己的說明文字誤判（v6.157 的教訓）。
    const mwCode = mw.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    ok('[自我驗證] 剝註解後中介層本體還在（不是剝爆了）', /res\.writeHead = function/.test(mwCode) && mwCode.length > 200);
    ok('★[核心③] 用包 writeHead 而不是 res.on(\'finish\')（finish 時 header 早就寫死了）',
      /res\.writeHead = function/.test(mwCode) && !/res\.on\('finish'/.test(mwCode));
    ok('[正對照] 上一條不是恆真式：未剝註解的原文裡確實找得到 res.on(\'finish\') 這串字',
      /res\.on\('finish'/.test(mw));
    ok('★[核心③] setHeader 前有 headersSent 檢查、整段包 try/catch（量測絕不影響回應）',
      /if \(!res\.headersSent\)/.test(mw) && /catch \(e\) \{ \/\* 量測絕不影響回應 \*\/ \}/.test(mw));

    // ── 行為端：真的跑一次中介層 ──
    try {
      // ⚠ SRV_MS_HEADER 是中介層外面的 const ⇒ 一定要餵進來，否則整段會靜默走進 catch
      //   （然後這條斷言就會變成「量了個寂寞」）。
      const HDR = (/const SRV_MS_HEADER = '([^']+)';/.exec(SRV) || [])[1];
      ok('[前提] 抓得到標頭常數', HDR === 'X-Srv-Ms', String(HDR));
      const factory = new Function('process', 'SRV_MS_HEADER', 'return (' + mw.replace(/^function _srvTimingMw/, 'function') + ');');
      const fakeProc = { hrtime: { bigint: (() => { let t = 0n; return () => (t += 1500000n); })() } };
      const run = factory(fakeProc, HDR);
      const headers = {};
      let whCalls = 0, nextCalls = 0;
      const res = {
        headersSent: false,
        setHeader: (k, v) => { headers[k] = v; },
        writeHead: function () { whCalls++; return this; },
      };
      run({ url: '/api/tournament/action' }, res, () => { nextCalls++; });
      ok('★★★行為③：中介層一定會呼叫 next()（擋住任何一發請求就是災難）', nextCalls === 1);
      ok('★★★行為③：writeHead 之前還沒有設標頭（不可以無條件先寫）', Object.keys(headers).length === 0);
      res.writeHead(200);
      ok('★★★行為③：writeHead 時才寫 X-Srv-Ms，而且是毫秒數字字串',
        typeof headers['X-Srv-Ms'] === 'string' && Number(headers['X-Srv-Ms']) === 1.5,
        JSON.stringify(headers));
      ok('★★★行為③：原本的 writeHead 一定要被呼叫到（吞掉＝整個回應送不出去）', whCalls === 1);

      // headersSent 已經是 true（例如 SSE 已經開頭）⇒ 不可以 throw
      const headers2 = {};
      let wh2 = 0, next2 = 0;
      const res2 = { headersSent: true, setHeader: () => { throw new Error('不該被呼叫'); }, writeHead: function () { wh2++; return this; } };
      const run2 = factory(fakeProc, HDR);
      run2({ url: '/api/tournament/state' }, res2, () => { next2++; });
      let threw = false;
      try { res2.writeHead(200); } catch { threw = true; }
      ok('★★★行為③：headersSent 已為 true 時完全不碰 header 也不 throw', !threw && wh2 === 1 && next2 === 1);

      // setHeader 自己爆掉也不能影響回應
      let wh3 = 0, next3 = 0;
      const res3 = { headersSent: false, setHeader: () => { throw new Error('boom'); }, writeHead: function () { wh3++; return this; } };
      factory(fakeProc, HDR)({ url: '/api/tournament/state' }, res3, () => { next3++; });
      let threw3 = false;
      try { res3.writeHead(200); } catch { threw3 = true; }
      ok('★★★行為③：setHeader 爆掉時仍然照常送出回應（量測絕不影響對戰）', !threw3 && wh3 === 1 && next3 === 1);

      // ── 負擔量測（印數字，不當斷言）──
      const realFactory = new Function('SRV_MS_HEADER', 'return (' + mw.replace(/^function _srvTimingMw/, 'function') + ');');
      const realRun = realFactory(HDR);
      const N = 200000;
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < N; i++) {
        const r = { headersSent: false, setHeader: () => {}, writeHead: function () { return this; } };
        realRun({ url: '/api/tournament/action' }, r, () => {});
        r.writeHead(200);
      }
      const us = Number(process.hrtime.bigint() - t0) / 1000 / N;
      console.log('  中介層負擔實測：' + us.toFixed(3) + ' µs/req（含本測試自己造的假 res 物件）');
      ok('★[核心③] 負擔遠低於 100 µs/req（實測值見上一行；50 人對戰約 42 req/s）', us < 100, us.toFixed(3) + ' µs');
    } catch (e) { ok('★★★③ 中介層行為端整段可執行', false, String((e && e.message) || e)); }
  }
}
console.log('\n2b) ③ client 端接線');
ok('[HEAD-FAIL／核心③] tApi 有讀 X-Srv-Ms 這個回應標頭', /res\.headers\.get\('X-Srv-Ms'\)/.test(PAGE));
ok('[核心③] 讀完真的傳給記錄函式（有讀沒接＝白寫）', /_tRecordSrvSample\(path, _srvMs\);/.test(PAGE));
{
  // ⭐⭐⭐ v6.213 第二輪審查補：上面兩條都只是「原始檔有這串字」。
  //   把 tApi 裡讀標頭那一段**真的跑起來**，證明 header → _srvMs 這條線是通的。
  const mm = /let _srvMs: number \| null = null;[\s\S]*?\} catch \{ \/\* 量測絕不影響對戰 \*\/ \}/.exec(PAGE);
  ok('[前提] 抽得到 tApi 讀標頭那一段', !!mm);
  if (mm) {
    const js2 = (await transform(mm[0], { loader: 'ts', target: 'node20' })).code;
    const run = new Function('res', js2 + '; return _srvMs;');
    ok('★★★行為③：標頭有值 ⇒ _srvMs 拿到數字', run({ headers: { get: () => '12.5' } }) === 12.5);
    ok('★★★行為③：標頭缺席（舊伺服器）⇒ _srvMs 是 null（不是 0）', run({ headers: { get: () => null } }) === null);
    ok('★★行為③：標頭是垃圾字串 ⇒ null（不會毒死統計）', run({ headers: { get: () => 'abc' } }) === null);
    ok('★★行為③：標頭是負數 ⇒ null', run({ headers: { get: () => '-3' } }) === null);
    ok('★★行為③：標頭是 "0" ⇒ 0（伺服器真的很快，是合法樣本）', run({ headers: { get: () => '0' } }) === 0);
    ok('★★★行為③：res 完全沒有 headers ⇒ 不 throw、回 null',
      (() => { try { return run({}) === null; } catch { return false; } })());
  }
}
ok('[HEAD-FAIL／核心③] 診斷 payload 真的帶出 perf.srv 與 perf.srvHdr',
  /srv: _sampleStats\(_segSrv\), srvHdr: \{ n: _srvHdrN, miss: _srvHdrMiss \}/.test(PAGE));
{
  // ★★★ 母體一致：srv 與 net 的範圍守衛必須逐字相同，否則 `net - srv` 這個減法沒有意義。
  const gate = (fn) => (fn || '').split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('if (!isTournament') || l.startsWith("if (path.indexOf('wait=1')") || l.startsWith('if (!(path.indexOf('));
  const a = gate(fnRecSeg), b = gate(fnRecSrv);
  ok('[前提] 兩支函式都抓得到三行範圍守衛', a.length === 3 && b.length === 3, JSON.stringify([a.length, b.length]));
  ok('★★★[核心③] srv 與 net 的範圍守衛**逐字相同**（母體不同就不能相減）',
    JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b));
}

// ══════════════════════════════════════════════════════════════════════════
// 3. ② 分帳：dump 腳本
// ══════════════════════════════════════════════════════════════════════════
console.log('\n3) ② dump 腳本：取樣與異常分開統計');
ok('[HEAD-FAIL] dump 匯出了分帳用的述詞與函式（守衛要實跑，不是只驗字串）',
  typeof DUMP.isSampleReason === 'function' && typeof DUMP.splitDiagRows === 'function'
  && typeof DUMP.sampleSummary === 'function' && Array.isArray(DUMP.SAMPLE_REASONS));
{
  // ⭐v6.261 原本兩邊都寫死 `['perf-sample']`。休閒批加入 'casual-perf-sample' 之後那個寫死值過期，
  //   ⚠ **判準沒有放寬**：改成「把伺服器那份清單真的解析出來，跟 dump 的逐項比對」——
  //   比原本的寫死更強（原本只要有人同時改兩邊成錯的值也照樣綠）。
  const m = /const SAMPLE_REASONS = (\[[^\]]*\]);/.exec(SRV);
  ok('[前提] 從 server_admin_patch.js 解析得出 SAMPLE_REASONS 字面量', !!m, m ? m[1] : '(抓不到)');
  const srvList = m ? JSON.parse(m[1].replace(/'/g, '"')) : null;
  ok('[核心②] 指紋清單與 server_admin_patch.js 逐字相同（改一邊沒改另一邊 ⇒ 兩張表兜不起來）',
    !!srvList && JSON.stringify(DUMP.SAMPLE_REASONS) === JSON.stringify(srvList),
    JSON.stringify([DUMP.SAMPLE_REASONS, srvList]));
  ok('[核心②] 錦標賽的健康對照組指紋 perf-sample 仍在清單內（不可被休閒批換掉）',
    !!srvList && srvList.indexOf('perf-sample') >= 0);
  ok('★v6.261 休閒批的健康對照組也必須是「取樣」（否則會被算進休閒的異常次數）',
    !!srvList && srvList.indexOf('casual-perf-sample') >= 0);
}
{
  const P = DUMP.isSampleReason;
  ok('★行為②：述詞認得取樣、不會把異常誤判成取樣',
    P('perf-sample') === true && P('slow-rtt') === false && P('stale-version') === false
    && P('') === false && P(undefined) === false && P(null) === false);
  // ⚠ 原型鏈地雷（admin.html 踩過同一顆）
  ok('★行為②：`constructor` / `__proto__` 這種 reason 不會被誤判',
    P('constructor') === false && P('__proto__') === false);
}
{
  // ★★★ 真的跑分流：混一批資料進去，兩邊的筆數與內容都要對。
  const rows = [
    { reason: 'slow-rtt', uid: 'u1', diag: '{}' },
    { reason: 'perf-sample', uid: 'u2', diag: '{}' },
    { reason: 'stale-version', uid: 'u1', diag: '{}' },
    { reason: 'perf-sample', uid: 'u3', diag: '{}' },
    { reason: '', uid: 'u4', diag: '{}' },
  ];
  const sp = DUMP.splitDiagRows(rows);
  ok('★★★行為②：分流把 5 筆切成「異常 3／取樣 2」，而且一筆都沒掉、也沒有重複',
    sp.anomaly.length === 3 && sp.sample.length === 2
    && sp.anomaly.length + sp.sample.length === rows.length
    && sp.anomaly.every((r) => r.reason !== 'perf-sample')
    && sp.sample.every((r) => r.reason === 'perf-sample'),
    JSON.stringify([sp.anomaly.length, sp.sample.length]));
  ok('★行為②：空輸入不會炸', DUMP.splitDiagRows(null).anomaly.length === 0 && DUMP.splitDiagRows([]).sample.length === 0);
}
{
  // ★★★ sampleSummary 實跑：分母只算取樣列。
  const mk = (uid, ver, srvP95, netP95, hasHdr) => ({
    ts: Date.now(), uid: uid, email: uid + '@x', room: 'R', reason: 'perf-sample',
    diag: JSON.stringify({
      reason: 'perf-sample', ver: ver,
      poll: { rtt: { n: 30, p50: 100, p95: 200, max: 300 } },
      perf: {
        api: { net: { n: 30, p50: 1, p95: netP95, max: netP95 }, dl: { n: 30, p50: 1, p95: 5, max: 5 },
               tok: { n: 30, p50: 0, p95: 0, max: 0 }, parse: { n: 30, p50: 1, p95: 2, max: 2 } },
        adopt: { n: 30, p50: 1, p95: 3, max: 3 }, paint: { n: 30, p50: 1, p95: 40, max: 40 },
        srv: srvP95 === null ? null : { n: 30, p50: 1, p95: srvP95, max: srvP95 },
        srvHdr: hasHdr ? { n: 30, miss: 0 } : { n: 0, miss: 30 },
        lt: null,
      },
      env: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', hc: 4, dm: 4 },
    }),
  });
  const s = DUMP.sampleSummary([mk('a', '6.213', 4, 900, true), mk('b', '6.213', 6, 1100, true), mk('c', '6.213', null, 800, false)]);
  ok('★★★行為②：sampleSummary 的分母只有取樣列（3 筆 / 3 人）', s.rows === 3 && s.players === 3, JSON.stringify([s.rows, s.players]));
  ok('★★★行為②：健康樣本的 RTT 有算出來（這就是「有沒有變慢」的對照數字）',
    s.rtt.n === 3 && s.rtt.p50 === 200, JSON.stringify(s.rtt));
  ok('★★★行為③：srv 有收進來，而且「伺服器沒部署」那一筆是算進 without、不是算成 0ms',
    s.perf.srv.length === 2 && s.srvHdr.withHeader === 2 && s.srvHdr.without === 1,
    JSON.stringify([s.perf.srv, s.srvHdr]));
  ok('★行為②：平台／版本分佈是**取樣者自己的**（不是異常回報者的）',
    s.byPlatform.length === 1 && s.byPlatform[0].platform === 'iOS / Safari 系' && s.byPlatform[0].n === 3
    && s.byVersion.length === 1 && s.byVersion[0].ver === '6.213' && s.byVersion[0].n === 3,
    JSON.stringify([s.byPlatform, s.byVersion]));
  ok('★行為②：一筆取樣都沒有時回 0 而不是炸掉', DUMP.sampleSummary([]).rows === 0 && DUMP.sampleSummary(null).rows === 0);
}
{
  // ★★ 接線：main() 真的走 splitDiagRows，而且既有統計吃的是 `raw`（＝異常）。
  const strip = DUMPSRC.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  ok('[自我驗證] 剝註解後檔案還在（不是剝爆了）', strip.length > 8000, String(strip.length));
  ok('★★[HEAD-FAIL／接線] main() 真的呼叫 splitDiagRows（有 helper 沒接＝白寫）',
    /const _split = splitDiagRows\(rawAll\);/.test(strip)
    && /const rawSample = _split\.sample;/.test(strip) && /const raw = _split\.anomaly;/.test(strip));
  ok('★★[HEAD-FAIL／分母污染] byReason 也把取樣濾掉（aggregate 是對整個時間窗算的）',
    /\.filter\(function \(a\) \{ return !isSampleReason\(a\._id\); \}\)/.test(strip));
  ok('★★[HEAD-FAIL] main() 有把取樣彙總算出來並寫進 JSON', /const sample = sampleSummary\(rawSample\);/.test(strip)
    && /sample: sample,/.test(strip));
  ok('★[核心②] 摘要文字明講「兩批不可以相加」（數字沒人看得懂等於沒量）',
    DUMPSRC.includes('永遠不可以相加') && DUMPSRC.includes('健康對照組'));
  ok('★[核心②] 取樣為 0 時明講「這不是大家都很順」（假綠最會誤導人）',
    DUMPSRC.includes('這**不是**「大家都很順」'));
}

// ══════════════════════════════════════════════════════════════════════════
// 4. ② 分帳：後端端點 + admin 顯示
// ══════════════════════════════════════════════════════════════════════════
console.log('\n4) ② 後端端點與 admin 顯示也要分開');
{
  const i = SRV.indexOf("app.get('/api/tournament/admin/clientdiag'");
  const seg = SRV.slice(i, i + 6800);
  ok('★★[HEAD-FAIL] byReason 只留異常（既有數字語義不變，可以跟舊 dump 對帳）',
    /\.filter\(function \(a\) \{ return !isSampleReason\(a\._id\); \}\)/.test(seg));
  ok('★★[HEAD-FAIL] 取樣走**獨立**的一份查詢（不是共用 slow-rtt 那份）',
    /reason: \{ \$in: SAMPLE_REASONS \}/.test(seg));
  ok('★★[HEAD-FAIL／分母污染] 最近 120 筆明細預設排除取樣（否則真異常會被擠出畫面）',
    /q\.reason = \{ \$nin: SAMPLE_REASONS \};/.test(seg));
  ok('★[核心②] 回應真的帶出 sample 區塊（含 n / players / perf）',
    /sample: \{/.test(seg) && /n: sampleTotals\.n,/.test(seg) && /perf: samplePerf,/.test(seg));
}
{
  ok('★★[HEAD-FAIL] admin 有一塊**獨立**的取樣區塊（不是混在異常表裡）',
    /function monSampleBlock\(dg\)/.test(ADMIN) && ADMIN.includes('⚖️ 低頻取樣（健康對照組）'));
  ok('★★[接線] 兩條路徑都會畫取樣區塊（有異常時、以及一則異常都沒有時）',
    (ADMIN.match(/html \+= monSampleBlock\(dg\);/g) || []).length === 2);
  ok('★[核心②] admin 明講「不可以跟異常次數相加」', ADMIN.includes('絕不可以跟上面的異常次數相加'));
  ok('★[核心②] 取樣 0 筆時 admin 明講「這不是大家都很順」', ADMIN.includes('這<b>不是</b>「大家都很順」'));
  ok('★[核心②] 伺服器是舊版時 admin 明講，而不是顯示成「沒有取樣」', ADMIN.includes('這不代表沒有取樣'));
  // ★★★ 行為端：把 monSampleBlock 抽出來實跑（餵舊 payload / 空 payload / 正常 payload）
  try {
    const fn = grabFn(ADMIN, 'monSampleBlock');
    ok('[前提] monSampleBlock 抽得出來', !!fn);
    const run = new Function('escapeHtml', 'monMs', 'monPerfCells',
      'return (' + fn.replace(/^function monSampleBlock/, 'function') + ');')(
      (x) => String(x == null ? '' : x), (v) => (typeof v === 'number' ? v + ' ms' : '—'), () => '<td>x</td>');
    const oldSrv = run({ hours: 24, byReason: [] });
    ok('★★★行為②：伺服器是舊版（沒有 sample 欄位）⇒ 不 throw、而且講明是「伺服器還是舊版」',
      typeof oldSrv === 'string' && oldSrv.includes('伺服器還是舊版') && oldSrv.includes('這不代表沒有取樣'));
    const zero = run({ sample: { n: 0, players: 0, perf: [] } });
    ok('★★★行為②：取樣 0 筆 ⇒ 不 throw，而且明講「不是大家都很順」',
      zero.includes('0 筆 / 0 人') && zero.includes('不</b>是') === false && zero.includes('大家都很順'));
    const some = run({ sample: { n: 2, players: 2, perf: [{ ts: Date.now(), email: 'a@b', p50: 100, p95: 200, max: 300 }] } });
    ok('★★★行為②：有取樣 ⇒ 畫得出表格（而且是**獨立**一張，不是塞進異常表）',
      some.includes('2 筆 / 2 人') && some.includes('<table'));
    for (const bad of [null, undefined, {}, { sample: null }, { sample: { n: 'x', perf: 'y' } }]) {
      let t = null;
      try { run(bad); } catch (e) { t = e; }
      ok('★★行為②：壞掉的 payload 也不 throw — ' + JSON.stringify(bad), !t, t && t.message);
    }
  } catch (e) { ok('★★★admin 取樣區塊行為端整段可執行', false, String((e && e.message) || e)); }
}

console.log('\n=== v6.213 ②③ 取樣分帳／伺服器處理時間: ' + pass + ' PASS / ' + fail + ' FAIL ===');
console.log('=== SCRIPT-END v6213-perf-sample-and-srv-timing ===');
if (fail) process.exit(1);
