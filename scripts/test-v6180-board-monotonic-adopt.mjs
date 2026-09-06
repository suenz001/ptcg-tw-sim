#!/usr/bin/env node
/**
 * v6.180 守衛：**盤面不得倒退**（玩家回報「一直跳回上一步」）
 *
 * ## 事故
 * 錦標賽同步有 4 個地方會把 `game` 指成伺服器盤面，而版本守衛只有 1 個（`tAdopt`）。
 * 另外 3 個（輪詢停擺救援 v5.593／`tForceResync` v5.618／主輪詢的 `version < tVersion` 分支）
 * 都刻意「繞過版本檢查」，而它們的 `?v=-1` 請求與主輪詢（`setInterval`，不等前一發完成）
 * **並行** ⇒ 舊回應晚到就把盤面指回上一版 ＝ 玩家看到的「跳回上一步」。
 * 另一條是 v6.173 造成的：`shareStateIdentity` 在「伺服器盤面與本地預測逐位元組相同」時
 * 會**原封回傳 prev 物件**，於是 v6.137 樂觀更新回滾那道「物件同一性」守衛形同虛設
 * ⇒ 伺服器其實已經確認了動作（版本已前進），POST 回應丟了就把畫面還原＝跳回上一步。
 *
 * ## ⚠ 這份守衛刻意不只驗字串
 *   A 純函式判準（含合法版本重置的**正對照**：修成「畫面永遠不更新」比原 bug 更糟）
 *   B **行為端實跑** `tAdopt`（真 `shareStateIdentity`）：亂序舊回應不得改變盤面
 *   C **行為端實跑** `tForceResync`（假 tApi 製造真正的亂序時序）：盤面不得倒退，
 *     且「client 真的超前」時仍然要回正（正對照）
 *   D **行為端實跑** 樂觀更新回滾 × 結構共享的交互（v6.173 破掉的那道守衛）
 *   E 接線層：四個採納點一個都不剩地走 tAdopt（AST/來源掃描，先剝註解）
 *   F 休閒線上路徑：輪詢是序列化的（結構上不會亂序）＋ 收端 stale 守衛仍在（實跑）
 *   G 掃描器自我驗證：把閘拿掉／把判準寫反，B/C/D 必須紅
 *
 * Run: node scripts/test-v6180-board-monotonic-adopt.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { transform, build } from 'esbuild';
import { stripCommentsChecked } from './lib/strip-comments.mjs';   // ⭐v6.323 區塊註解走中央行級狀態機

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const GUARDS = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
const ORACLE = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 從原始碼抽一支函式（簽章可能含 `{}` 型別 ⇒ 括號配對後找第一個 `{`）。 */
function grabFn(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let k = src.indexOf('(', i), d = 0;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '(') d++;
    else if (c === ')') { d--; if (d === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return null;
  d = 0;
  let j = open;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) break; }
  }
  return src.slice(i, j + 1);
}
/** 剝掉行註解與區塊註解（否則「否定型掃描」會被註解裡的示例騙過去）。
 *  ⭐v6.323：區塊註解改走中央行級狀態機（本檔的區塊正則會把 game 頁 :208～:384 整段吃掉 ⇒ 洞內第二個
 *  decideBoardAdopt( 或 `game = fr.gameState` 都掃不到）。行尾 // 仍在本檔剝（單行、不跨行）。 */
function stripComments(src, opt = {}) {
  return stripCommentsChecked(src, { label: 'probe', minRatio: 0.2, ...opt }).split('\n').map((l) => {
    const i = l.indexOf('//');
    if (i < 0) return l;
    // 粗略避開字串／網址裡的 //：只在 // 前沒有奇數個引號時才截斷
    const head = l.slice(0, i);
    const q = (head.match(/'/g) || []).length + (head.match(/"/g) || []).length + (head.match(/`/g) || []).length;
    return q % 2 === 0 ? head : l;
  }).join('\n');
}
const PAGE_CODE = stripComments(PAGE, { label: 'game/+page.svelte', minRatio: 0.5, mustKeep: ['decideBoardAdopt(', 'function tAdopt(state: any, version: number'] });

// ── 打包中央判準 + 結構共享（真貨，不是複製一份）──────────────────────────
const E = join(ROOT, '.v6180-e.ts'), O = join(ROOT, '.v6180-o.mjs'), S = join(ROOT, '.v6180-s.js');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch { /* ignore */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, [
  "export { decideBoardAdopt, resolveRoomUpdate } from './src/lib/game/sync-guards';",
  "export { shareStateIdentity } from './src/lib/game/state-share';",
].join('\n'));
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const _mod = await import(pathToFileURL(O).href);
const { resolveRoomUpdate, shareStateIdentity } = _mod;
// ⚠ v6.180 之前這個 export 不存在 ⇒ 在 HEAD 上必須是「計數為紅 + exit 1」，不是整支腳本 crash
//   （crash 的話後面每一節都不會跑，看不出到底缺了幾件事）。
const decideBoardAdopt = typeof _mod.decideBoardAdopt === 'function'
  ? _mod.decideBoardAdopt
  : () => { throw new Error('decideBoardAdopt 不存在（v6.180 之前的樹）'); };

// ══════════════════════════════════════════════════════════════════════════
console.log('\nA. 中央判準 decideBoardAdopt（純函式）');
// ══════════════════════════════════════════════════════════════════════════
try {
  const d = (l, i, e) => decideBoardAdopt({ localVersion: l, incomingVersion: i, expectVersion: e });
  ok('★★★較新版本 ⇒ 採納', d(10, 11).kind === 'adopt');
  ok('★同版本 ⇒ 採納（忠實沿用 v6.048 起「只擋嚴格較舊」的行為）', d(10, 10).kind === 'adopt');
  ok('★★★較舊版本、期間已採納過別的盤面（亂序）⇒ 丟棄',
    d(12, 11, 10).kind === 'drop' && d(12, 11, 10).reason === 'out-of-order');
  ok('★★★較舊版本、且沒有提供 expectVersion ⇒ 丟棄（沒有證據就不許倒退）', d(12, 11).kind === 'drop');
  // ↓↓ 正對照：這幾條若擋掉，症狀是「畫面永遠不更新」，比原 bug 更糟
  ok('★★★【正對照】換房間／再來一局（tVersion=-1）⇒ 一定採納', d(-1, 3).kind === 'adopt' && d(-1, 3).reason === 'first');
  ok('★★★【正對照】client 真的超前（送出到現在本地沒採納過東西）⇒ 放行回正',
    d(12, 11, 12).kind === 'adopt' && d(12, 11, 12).reason === 'client-ahead');
  ok('★★【正對照】伺服器沒給版本（舊端點／測試房）⇒ fail-open 照收', d(12, undefined).kind === 'adopt');
  ok('★★【正對照】版本是 NaN ⇒ fail-open 照收（絕不因為髒資料就永遠不更新）', d(12, NaN).kind === 'adopt');
} catch (e) {
  fail++; console.log('  FAIL ★★★A 節整個爆掉（中央判準不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nB. 行為端實跑 tAdopt：較舊版本的回應晚到，盤面不得倒退');
// ══════════════════════════════════════════════════════════════════════════
const mkAdopt = async (src) => {
  const out = await transform(src, { loader: 'ts' });
  const pre = `
    let tVersion = -1, game = null, tStep = 'lobby', _tLastStateChangeAt = 0, _freshWatchdogFires = 0;
    const diag = [];
    const _pnow = () => 0;
    const _tRecordAdopt = () => {};
    const untrack = (fn) => fn();
    const ensurePoolForStateIds = () => {};
    const playSfxEvents = (evs) => { sfx.push(...(evs || [])); };
    const computeSfxEvents = () => ['sfx'];
    const sfx = [];
    const pool = new Map(); const mode = 'online'; const myPlayerIndex = 0; const aiPlayerIndex = null;
    const _tSendClientDiag = (r) => { diag.push(r); };
  `;
  return new Function('decideBoardAdopt', 'shareStateIdentity',
    pre + out.code
    + '; return { tAdopt, get v(){return tVersion;}, get game(){return game;}, set game(x){game=x;},'
    + ' set v(x){tVersion=x;}, get diag(){return diag;}, get sfx(){return sfx;}, get step(){return tStep;},'
    + ' get anchor(){return _tLastStateChangeAt;} };')(decideBoardAdopt, shareStateIdentity);
};
let adoptSrc = null;
try {
  adoptSrc = [grabFn(PAGE, '_tNoteStaleAdoptDrop'), grabFn(PAGE, 'tAdopt')].filter(Boolean).join('\n');
  ok('★★★中央閘與診斷都抽得到（v6.180 之前 `_tNoteStaleAdoptDrop` 不存在 ⇒ HEAD-FAIL）',
    /_tNoteStaleAdoptDrop/.test(adoptSrc) && /function tAdopt/.test(adoptSrc));
  const declSrc = (PAGE.match(/let _staleAdoptDrops = 0;[\s\S]{0,900}?const STALE_ADOPT_DIAG_MIN = \d+;/) || [''])[0];
  const A = await mkAdopt(declSrc + '\n' + adoptSrc);
  const st = (v) => ({ id: 'g1', phase: 'playing', log: new Array(v).fill('x'), players: [{}, {}] });

  A.tAdopt(st(12), 12, { reason: 'poll' });
  ok('★正常前進：v12 被採納', A.v === 12 && A.game.log.length === 12);
  // ⭐核心：一發「較舊版本」晚到（期間已經採納過 v12 ⇒ expectV=10 ≠ tVersion=12）
  A.tAdopt(st(11), 11, { expectV: 10, reason: 'resync' });
  ok('★★★【真因釘死】晚到的 v11 被丟棄 —— 盤面**沒有**倒退（HEAD：`tForceResync` 會直接蓋成 v11）',
    A.v === 12 && A.game.log.length === 12);
  ok('★★偶發 1 次亂序**不**回報（那是守衛正常工作，不該排擠真異常指紋 — Fable 5 審查）',
    A.diag.length === 0, JSON.stringify(A.diag));
  const anchorBefore = A.anchor;
  A.tAdopt(st(9), 9, { expectV: 3, reason: 'poll-stall' });
  ok('★★被丟棄時**不推進**「盤面最近變過」的錨點（否則輪詢節奏會被假訊號帶著跑，v6.148 教訓）',
    A.anchor === anchorBefore);
  A.tAdopt(st(8), 8, { expectV: 3, reason: 'poll' });
  ok('★★★累積 3 次亂序 ⇒ 送出診斷指紋 stale-board-drop（走既有 /clientdiag）',
    A.diag.length === 1 && A.diag[0] === 'stale-board-drop', JSON.stringify(A.diag));
  // 正對照 1：client 真的超前 ⇒ 必須放行（不可以修成永遠不更新）
  A.tAdopt(st(11), 11, { expectV: 12, reason: 'poll-stall' });
  ok('★★★【正對照】client 超前伺服器（expectV === tVersion）⇒ 仍然回正到 v11',
    A.v === 11 && A.game.log.length === 11);
  // 正對照 2：換房間
  const B = await mkAdopt(declSrc + '\n' + adoptSrc);
  B.v = 40; B.game = st(40);
  B.v = -1;                    // ← 離場／進場時的 tVersion = -1
  B.tAdopt(st(2), 2, { reason: 'poll' });
  ok('★★★【正對照】換房間後（tVersion=-1）新房間的 v2 一定採納，畫面不會凍在上一場',
    B.v === 2 && B.game.log.length === 2 && B.step === 'playing');
  // 音效：client-ahead 不播（倒退的 diff 會播出沒發生過的事件）
  const C = await mkAdopt(declSrc + '\n' + adoptSrc);
  C.tAdopt(st(5), 5); C.tAdopt(st(6), 6);
  const sfxN = C.sfx.length;
  C.tAdopt(st(4), 4, { expectV: 6 });
  ok('★★回正（client-ahead）時不播音效', C.sfx.length === sfxN);
} catch (e) {
  fail++; console.log('  FAIL ★★★B 節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nC. 行為端實跑 tForceResync：真正的亂序時序（回應晚於輪詢）');
// ══════════════════════════════════════════════════════════════════════════
try {
  const src = [
    (PAGE.match(/let _staleAdoptDrops = 0;[\s\S]{0,900}?const STALE_ADOPT_DIAG_MIN = \d+;/) || [''])[0],
    grabFn(PAGE, '_tNoteStaleAdoptDrop'), grabFn(PAGE, 'tAdopt'), grabFn(PAGE, 'tForceResync'),
  ].filter(Boolean).join('\n');
  ok('★tForceResync 抽得到', /async function tForceResync/.test(src));
  const out = await transform(src, { loader: 'ts' });
  const mk = (apiImpl) => {
    const pre = `
      let tVersion = -1, game = null, tStep = 'lobby', _tLastStateChangeAt = 0, _freshWatchdogFires = 0;
      let tLastActionAt = 0, tServerActorSeat = null, tLongPollReady = false, tClockOffset = 0, tNow = 0;
      let tAuthLost = false, _tLastPollOkAt = 0, tPollGen = 0;
      const isTournament = true, isTournSpectator = false, tActiveRoom = 'R1', mySeatIdx = 0;
      const diag = [];
      const _pnow = () => 0; const _tRecordAdopt = () => {}; const untrack = (fn) => fn();
      const ensurePoolForStateIds = () => {}; const playSfxEvents = () => {}; const computeSfxEvents = () => [];
      const pool = new Map(); const mode = 'online'; const myPlayerIndex = 0; const aiPlayerIndex = null;
      const _tSendClientDiag = (r) => { diag.push(r); };
      const tApi = __api;
    `;
    return new Function('decideBoardAdopt', 'shareStateIdentity', '__api',
      pre + out.code
      + '; return { tForceResync, tAdopt, get v(){return tVersion;}, get game(){return game;}, get diag(){return diag;},'
      + ' leave(){ tPollGen++; game = null; tVersion = -1; tStep = \'lobby\'; } };')(
      decideBoardAdopt, shareStateIdentity, apiImpl);
  };
  const st = (v) => ({ id: 'g1', phase: 'playing', log: new Array(v).fill('x'), players: [{}, {}] });

  // ①「看門狗／玩家點 🔄」發出 resync（伺服器當下 v20），回應慢 60ms；
  //    期間主輪詢帶回 v21（對手動作）並被採納 ⇒ resync 的舊回應絕不可以把畫面拉回 v20。
  {
    const M = mk(async () => { await sleep(60); return { gameState: st(20), version: 20 }; });
    M.tAdopt(st(20), 20);                       // 進場時的盤面
    const p = M.tForceResync();                 // 送出（此刻 tVersion=20）
    await sleep(10);
    M.tAdopt(st(21), 21, { expectV: 20, reason: 'poll' });   // 主輪詢先回來（對手動作）
    ok('★輪詢先帶回 v21', M.v === 21 && M.game.log.length === 21);
    await p;
    ok('★★★【真因釘死・行為端】resync 的舊回應（v20）晚到 ⇒ 盤面仍是 v21，**沒有跳回上一步**',
      M.v === 21 && M.game.log.length === 21, 'v=' + M.v);
    ok('★★單發亂序不吵（門檻 3 次；`staleAdopt` 計數仍會跟著每一發診斷回報）',
      !M.diag.includes('stale-board-drop'));
  }
  // ①b 離場／換房後晚到的回應（版本閘天生擋不住：離場時 tVersion 歸 -1 ⇒ 會走 first 照收）
  {
    const M = mk(async () => { await sleep(40); return { gameState: st(20), version: 20 }; });
    M.tAdopt(st(20), 20);
    const p = M.tForceResync();
    M.leave();               // ← tLeaveMatch：tPollGen++、game=null、tVersion=-1
    await p;
    ok('★★★離開對戰後晚到的 v=-1 回應**不得**把 game 復活（否則玩家被彈回已結束的對戰）',
      M.game === null && M.v === -1, 'v=' + M.v);
  }
  // ②【正對照】沒有亂序：client 超前（伺服器被重置回較小版本）⇒ resync 必須真的回正
  {
    const M = mk(async () => { await sleep(10); return { gameState: st(7), version: 7 }; });
    M.tAdopt(st(30), 30);
    await M.tForceResync();
    ok('★★★【正對照】期間沒有採納過任何盤面 ⇒ 伺服器權威回正到 v7（治「本地領先型卡死」的能力沒少）',
      M.v === 7 && M.game.log.length === 7);
  }
  // ③【正對照】一般情形：resync 帶回更新的盤面 ⇒ 照樣採納
  {
    const M = mk(async () => ({ gameState: st(33), version: 33 }));
    M.tAdopt(st(30), 30);
    await M.tForceResync();
    ok('★★【正對照】resync 帶回更新的盤面 ⇒ 正常採納（自癒能力沒被閘擋掉）', M.v === 33);
  }
} catch (e) {
  fail++; console.log('  FAIL ★★★C 節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nD. 樂觀更新回滾 × v6.173 結構共享：伺服器已確認的動作不得被還原');
// ══════════════════════════════════════════════════════════════════════════
try {
  // 先證明「破口真的存在」：伺服器盤面與預測逐位元組相同時，shareStateIdentity 回傳 prev 本人。
  const predicted = { id: 'g1', phase: 'playing', log: ['a', 'b'], players: [{ hand: [] }, { hand: [] }] };
  const fromServer = JSON.parse(JSON.stringify(predicted));
  ok('★★★破口存在：伺服器盤面與預測內容相同時，shareStateIdentity **原封回傳 prev 物件** ⇒ v6.137 的物件同一性守衛失效',
    shareStateIdentity(predicted, fromServer) === predicted);
  ok('★反向釘住：內容有變 ⇒ 一定是新物件（否則畫面不會更新）',
    shareStateIdentity(predicted, { ...fromServer, log: ['a', 'b', 'c'] }) !== predicted);
} catch (e) {
  fail++; console.log('  FAIL ★★★D-1 破口證明爆掉 — ' + ((e && e.message) || e));
}
try {
  // ⚠⚠⚠ 這一節的模擬**必須帶 Svelte 深層 $state 的 proxy 包裝**，否則測到的是假語義：
  //   編譯產物是 `$.set(game, pr.predicted, true)`（should_proxy=true）⇒ 讀回來的 `game`
  //   是 `proxy(pr.predicted)`，**不等於** `pr.predicted`。v6.137 那道 `game === ctx.predictedRef`
  //   因此從上線至今是死碼（Fable 5 審查抓到，已用真 svelte proxy 實跑證實）。
  let realProxy = null;
  try {
    const m = await import(pathToFileURL(join(ROOT, 'node_modules/svelte/src/internal/client/proxy.js')).href);
    realProxy = m.proxy;
  } catch { /* 內部路徑改了就退回模擬版，不讓守衛因為 svelte 內部結構而假紅 */ }
  if (realProxy) {
    const raw = { a: 1 };
    const wrapped = realProxy(raw);
    ok('★★★真 svelte：proxy(raw) !== raw（深層 $state 賦值後讀回來不是原物件）', wrapped !== raw);
    ok('★★真 svelte：proxy(已是 proxy) 原樣回傳 ⇒ v6.173 的結構共享沿用 prev 時 identity 成立',
      realProxy(wrapped) === wrapped);
  }
  const wrap = realProxy || ((v) => (v && v.__w ? v : { __w: true, v }));
  ok('★★★接線：樂觀更新存的是**讀回來的** game（`ctx.predictedRef = game`），不是原始的 pr.predicted',
    /ctx\.predictedRef = game;/.test(PAGE_CODE) && !/ctx\.predictedRef = pr\.predicted;/.test(PAGE_CODE));

  const src = grabFn(PAGE, '_tRestorePrediction');
  const out = await transform(src, { loader: 'ts' });
  const mk = (v) => new Function('__v',
    'let tVersion = __v; let game = null;' + out.code
    + '; return { _tRestorePrediction, set game(x){game=x;}, get game(){return game;} };')(v);
  const prev = wrap({ id: 'g1', phase: 'playing', log: ['a'], players: [{}, {}] });
  const predicted = wrap({ id: 'g1', phase: 'playing', log: ['a', 'b'], players: [{}, {}] });
  {
    const M = mk(9);
    M.game = predicted;   // ← tAdopt 因結構共享沿用了同一個物件（game === predictedRef）
    M._tRestorePrediction({ predicted: true, predictedRef: predicted, prev, baseV: 8 });
    ok('★★★伺服器版本已前進（8→9）⇒ **不得**還原（否則把伺服器已確認的動作洗掉＝跳回上一步）',
      M.game === predicted);
  }
  {
    const M = mk(8);
    M.game = predicted;
    M._tRestorePrediction({ predicted: true, predictedRef: predicted, prev, baseV: 8 });
    ok('★★★【正對照】伺服器版本一步都沒動（動作真的沒送到）⇒ 必須還原，否則畫面留著幽靈動作'
      + '（v6.179 因為 predictedRef 存錯物件，這條**從來沒有發生過**：紅字說「畫面已還原」是騙人的）',
      M.game === prev);
  }
  {
    const M = mk(8);
    const other = { id: 'g1', phase: 'playing', log: ['a', 'z'], players: [{}, {}] };
    M.game = other;
    M._tRestorePrediction({ predicted: true, predictedRef: predicted, prev, baseV: 8 });
    ok('★【正對照】畫面上已經不是我的預測 ⇒ 不動它（v6.137 既有語義不變）', M.game === other);
  }
  ok('★★★回滾判準真的讀了版本（不是只留註解）', /tVersion === ctx\.baseV/.test(stripComments(src)));
} catch (e) {
  fail++; console.log('  FAIL ★★★D 節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nE. 接線：錦標賽的每一個盤面採納點都經過中央閘（否定型掃描，已剝註解）');
// ══════════════════════════════════════════════════════════════════════════
{
  // 錦標賽側「直接指派伺服器盤面」的舊寫法必須一條都不剩
  const badPatterns = [
    /game = fr\.gameState/g,
    /game = r\.gameState/g,
  ];
  for (const re of badPatterns) {
    const hits = PAGE_CODE.match(re) || [];
    ok('★★★程式碼裡沒有繞過中央閘的 `' + String(re).slice(1, -2) + '`（剝註解後掃描）',
      hits.length === 0, '還有 ' + hits.length + ' 處');
  }
  ok('★★★三條「繞過版本檢查」的路徑都帶了 expectV（poll／resync／poll-stall）',
    /reason: 'poll'/.test(PAGE_CODE) && /reason: 'resync'/.test(PAGE_CODE) && /reason: 'poll-stall'/.test(PAGE_CODE)
    && (PAGE_CODE.match(/expectV:/g) || []).length >= 3);
  ok('★★★中央閘只有一份（decideBoardAdopt 在 +page.svelte 只被呼叫 1 次，就在 tAdopt 裡）',
    (PAGE_CODE.match(/decideBoardAdopt\(/g) || []).length === 1);
  ok('★★★換房間會重設版本（tEnterMatch／tSpectate 都有 tVersion = -1）—— 否則新中央閘會凍住新的一場',
    /tActiveRoom = r\.roomId; tVersion = -1;/.test(PAGE_CODE) && /tSpectateRoom = roomId; tVersion = -1;/.test(PAGE_CODE));
  ok('★判準寫在中央模組、有匯出（不是躺在元件裡）', /export function decideBoardAdopt/.test(GUARDS));
  ok('★★★兩條 `v=-1` 路徑都帶了代次/房間快照（版本閘擋不住跨房與離場後的在途回應 — Fable 5 審查）',
    (PAGE_CODE.match(/_rGen !== tPollGen \|\| _rRoom !== tActiveRoom/g) || []).length === 2);
  ok('★★觀戰輪詢也走同一個中央閘（觀戰者沒有 resync／看門狗可以自救）',
    /reason: 'spectate'/.test(PAGE_CODE));
  ok('★★房間重置時一併作廢在途回應（tournamentReset 有 tPollGen++）',
    /tPollGen\+\+;\s*\/\/[^\n]*v6\.180|tActAbortAll\('房間已重置'\);[\s\S]{0,200}?tPollGen\+\+;/.test(PAGE));
  ok('★★★進場一律重設版本：tEnterMatch／tSpectate／tournamentJoin 三個入口都有 tVersion = -1',
    (PAGE_CODE.match(/tVersion = -1/g) || []).length >= 7);
  // 掃描器自我驗證：把閘拿掉，E 節的否定型斷言必須抓得到
  const mutated = PAGE_CODE.replace(/if \(fr\.version !== tVersion\) tAdopt\(fr\.gameState[^\n]*/,
    'if (fr.version !== tVersion) { game = fr.gameState; tVersion = fr.version; }');
  ok('★★★掃描器自我驗證：把 tForceResync 改回舊寫法，否定型掃描必須抓到',
    (mutated.match(/game = fr\.gameState/g) || []).length === 1);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nF. 休閒線上（room-oracle）：結構上不會亂序 ＋ 收端 stale 守衛仍在（實跑）');
// ══════════════════════════════════════════════════════════════════════════
{
  const poll = grabFn(ORACLE, 'oraclePollRoom') || '';
  const pc = stripComments(poll);
  ok('★★★休閒房輪詢是**序列化**的（回應處理完才排下一發）⇒ 不存在錦標賽那種同時多發並行的亂序',
    /timer = setTimeout\(tick, _d\)/.test(pc) && !/setInterval/.test(pc));
  // ⭐v6.212：閘從「不等於」收緊成**單調**（較舊的 _version 不再遞送給收端）。
  //   舊寫法讓舊 snapshot 有機會走到 handleRoomUpdate，而 v5.587 的強制自癒是刻意繞過
  //   stale 守衛的 ⇒ 兩者疊起來就是玩家看到的「跳回上一手」。
  ok('★★★休閒房只在版本**變新**時才回呼（v6.212 起單調）',
     /shouldDeliverRoomPoll\(room, \{ version: lastVersion, createdAt: lastCreatedAt \}\)/.test(pc));
  ok('★★★單調閘的判準是嚴格大於（不是不等於）',
     /incoming\._version > last\.version/.test(stripComments(ORACLE))
     && !/room\._version !== lastVersion/.test(pc));
  ok('★【正對照】房間被刪後重建（_version 從 1 重來）不可被單調閘永遠擋掉',
     /createdAt \?\? 0\) !== last\.createdAt/.test(stripComments(ORACLE)));
  // 收端 stale 守衛（log 長度單調）真的跑一次
  const g = (n, phase = 'playing') => ({
    id: 'g1', phase, log: new Array(n).fill('x'), createdAt: 1,
    players: [{ prizes: [1, 2], hand: [] }, { prizes: [1, 2], hand: [] }],
    setupDone: [true, true], mulliganRevealConfirmed: [true, true], pendingMulliganDraw: [0, 0],
    pendingPrizes: [0, 0],
  });
  const ctx = { myPlayerIndex: 0, roomLastUndoApplyAt: 0, lastSeenUndoApplyAt: 0 };
  ok('★★★休閒線上：較舊 snapshot（log 較短）仍被拒收',
    resolveRoomUpdate(g(20), g(19), ctx).kind === 'reject');
  ok('★★【正對照】休閒線上：較新 snapshot 照常採用',
    ['adopt', 'merge-prize'].includes(resolveRoomUpdate(g(20), g(21), ctx).kind));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\nG. 版本標示');
// ══════════════════════════════════════════════════════════════════════════
{
  const VER = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
  const m = VER.match(/VERSION = '([\d.]+)'/);
  ok('★版本已 bump 到 >= 6.180', !!m && parseFloat(m[1]) >= 6.18, m && m[1]);
  const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  const am = ADMIN.match(/SITE_VERSION_HINT\s*=\s*'([\d.]+)'/);
  ok('★admin 的 SITE_VERSION_HINT 與版本一致', !!am && !!m && am[1] === m[1], am && am[1]);
}

console.log('\n──────────────────────────────');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
