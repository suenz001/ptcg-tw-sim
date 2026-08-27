#!/usr/bin/env node
/**
 * v6.249 守衛：獨立對抗性審查者複驗 v6.248 之後的七件事。
 *
 * ── 這一版在修什麼（每一條我都先自己複驗過才動手，Rule 25）────────────────────
 * 【1】`RESYNC_MAX_MS = 60000` 太猛。複驗（`scripts/perf-v6249-resync-backoff-forfeit.mjs`）：
 *      脫困延遲最壞 **55 秒**、180 秒棄權窗內脫困機會 **18 → 6**、
 *      而且 R∈(145,180] 這 **35 秒**寬的區間從「被救回」變成「輸掉」。⇒ 上限改 **20000**。
 * 【2】v6.248 註解宣稱「下一次真的卡住時第一發仍是 8 秒」——**不成立**：streak 只在
 *      `game.log` 有變動時歸零，而對手長考本身就沒有 log 變動 ⇒ 長考 30 秒以上 streak 已 ≥3。
 *      ⚠ 但審查者建議的「只在重訂閱沒換來進展時才累加」**修不掉它**（兩種情境下都成立）
 *      ⇒ 改成：更正註解 + 壓低上限 + 加一道【最後救援窗】保證不比 v6.247 差。
 * 【3】`PUSH_INFLIGHT_FAILSAFE_MS = 1500750`（25.01 分鐘）是數學最壞值，比棄權門檻大 8 倍
 *      ⇒ 改成 `2 × ORACLE_API_TIMEOUT_MAX_MS = 240000`，數學上限留在註解與守衛裡。
 * 【4】`test-v6248` 的兩處安慰劑（見那一支）。
 * 【5】`PUSH_INFLIGHT_FAILSAFE_MS` 必須宣告在 `const PUSH_RETRY_MAX = 3;` 之前，否則會落進
 *      `test-v6245` 的抽取視窗而 ReferenceError，**而且錯誤訊息與真因無關**。⇒ 常數搬去
 *      oracle-client.ts，並加一條**實跑那個視窗**的守衛。
 * 【6】全站「整包 gameState 上行」的處置表要**明示例外**（startGame / checkAndAcceptRestart）。
 * 【7】HEAD-FAIL 的形態：抽不到錨點時該項標 FAIL，不可整支頂層中止。
 *
 * ⭐ 驗證形態：[HEAD-FAIL] 對 v6.248 那棵樹跑必須**各自**紅；[正對照] 健康路徑逐字不變；
 *   [突變] 斷言「紅在指定的那一條」，⚠ 只捕捉 assert.AssertionError，其餘照丟。
 *
 * Run: node scripts/test-v6249-resync-backoff-and-failsafe.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { transform } from 'esbuild';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GP = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SG = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');
const RO = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');
const T45 = readFileSync(join(ROOT, 'scripts/test-v6245-oracle-api-timeout.mjs'), 'utf8');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const TA = async (n, f) => { try { await f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ══════════════════════════════════════════════════════════════════════════
// 0. 抽取器（Rule 25 + 【7】：抽不到 ⇒ 毒藥值，讓**各項各自紅**，不是頂層中止）
// ══════════════════════════════════════════════════════════════════════════
function blockAfter(src, fromIdx) {
  const open = src.indexOf('{', fromIdx);
  if (open < 0) throw new Error('找不到區塊起點');
  let d = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return [open, k + 1]; }
  }
  throw new Error('大括號不平衡');
}
function fnSrc(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error('找不到錨點：' + anchor);
  const [, b] = blockAfter(src, i + anchor.length - 1);
  return src.slice(i, b);
}
const ANCHOR_ERRS = [];
function safeEx(fn, poison, what) {
  try { return fn(); } catch (e) { ANCHOR_ERRS.push(what + '：' + e.message); return poison; }
}
// ⚠ 毒藥一律**同步** function：async 的 throw 會變成 unhandled rejection，炸到 try/catch 之外。
const THROW = (w) => 'throw new Error(' + JSON.stringify('[抽取失敗] ' + w) + ');';

const IV_ANCHOR = 'const iv = setInterval(() => {';
const IV_BODY = safeEx(() => {
  const i = GP.indexOf(IV_ANCHOR);
  if (i < 0) throw new Error('找不到錨點：' + IV_ANCHOR);
  const [o, c] = blockAfter(GP, i + IV_ANCHOR.length - 1);
  return GP.slice(o + 1, c - 1);
}, THROW('5 秒 interval'), '5 秒 interval');
const IWO_SRC = safeEx(() => fnSrc(GP, 'function isWaitingOnOpponent('),
  'function isWaitingOnOpponent() { ' + THROW('isWaitingOnOpponent') + ' }', 'isWaitingOnOpponent');
const SG_CONST_NAMES = ['RESYNC_BASE_MS', 'RESYNC_FULL_RATE_ROUNDS', 'RESYNC_MAX_MS', 'RESYNC_LAST_CHANCE_MS'];
const GAP_SRC = safeEx(() => {
  const consts = SG_CONST_NAMES.map((k) => {
    const m = new RegExp('export const ' + k + ' = -?\\d+;').exec(SG);
    if (!m) throw new Error('找不到錨點：export const ' + k);
    return m[0].replace(/^export /, '');
  }).join('\n');
  return consts + '\n'
    + fnSrc(SG, 'export function casualResyncGapMs(').replace(/^export /, '') + '\n'
    + fnSrc(SG, 'export function casualResyncInLastChance(').replace(/^export /, '');
}, 'const RESYNC_BASE_MS = 0, RESYNC_FULL_RATE_ROUNDS = 0, RESYNC_MAX_MS = 0, RESYNC_LAST_CHANCE_MS = 0;\n'
  + 'function casualResyncGapMs() { ' + THROW('casualResyncGapMs') + ' }\n'
  + 'function casualResyncInLastChance() { ' + THROW('casualResyncInLastChance') + ' }',
  'sync-guards 退避／救援窗');

/** 把 `export const NAME = <運算式>;` 取出來**實際求值**（【4】：只比對分量常數擋不住運算式被改）。 */
function evalConsts(src, names) {
  const lines = names.map((n) => {
    const i = src.indexOf('export const ' + n + ' =');
    if (i < 0) throw new Error('抽不到常數 ' + n + ' —— 掃描器壞了，不可 fail-open');
    const j = src.indexOf(';', i);
    if (!(j > i)) throw new Error('常數 ' + n + ' 沒有結尾分號');
    return src.slice(i, j + 1).replace(/^export /, '');
  });
  return new Function(lines.join('\n') + '\nreturn { ' + names.join(', ') + ' };')();
}
const OC_NAMES = ['ORACLE_API_TIMEOUT_MS', 'ORACLE_API_TIMEOUT_MAX_MS', 'ORACLE_TX_MAX_ATTEMPTS',
  'ORACLE_TX_CONFLICT_BACKOFF_TOTAL_MS', 'ORACLE_API_MAX_AUTH_RETRIES',
  'ORACLE_TX_MAX_TOTAL_MS', 'PUSH_INFLIGHT_FAILSAFE_MS'];
const OCC = safeEx(() => evalConsts(OC, OC_NAMES), {}, 'oracle-client 常數求值');
const SGC = safeEx(() => evalConsts(SG, SG_CONST_NAMES), {}, 'sync-guards 常數求值');

T('[自我驗證/反對照] 抽取器抓錯錨點時會丟例外，常數求值器抽不到也會丟（不是靜默回 0）', () => {
  assert.throws(() => fnSrc(GP, 'function 這個函式不存在('), /找不到錨點/);
  assert.throws(() => evalConsts(OC, ['這個常數不存在']), /抽不到常數/);
  assert.ok(IV_BODY.length > 2000, 'interval body 只抽到 ' + IV_BODY.length + ' 字元');
  assert.ok(IV_BODY.includes('decideStuckSelfHeal({'), 'interval body 抽到的不是那一段');
});

const ts = async (c) => (await transform(c, { loader: 'ts', format: 'cjs', target: 'node20' })).code;
function loadFn(cjs) { const m = { exports: {} }; new Function('module', 'exports', cjs)(m, m.exports); return m.exports._f; }
const isWaitingOnOpponent = loadFn(await ts('export const _f = (' + IWO_SRC.replace(/^function\s+\w+/, 'function') + ');'));
const GAP = loadFn(await ts('export const _f = (() => {\n' + GAP_SRC
  + '\nreturn { casualResyncGapMs, casualResyncInLastChance, RESYNC_BASE_MS }; })();'));

// ══════════════════════════════════════════════════════════════════════════
// 1. 行為端模擬世界：跑**真的** interval body（虛擬時鐘、5 秒 tick）
// ══════════════════════════════════════════════════════════════════════════
function mkGame(active) {
  return { id: 'G1', phase: 'playing', log: [{ msg: 'l0' }], setupDone: [true, true],
    pendingPrizes: [0, 0], pendingSelection: null, activePlayerIndex: active,
    players: [{ active: {}, bench: [{}] }, { active: {}, bench: [{}] }] };
}
/** 跑「從 t=0 起再也收不到同步」的情境；回傳重訂閱時刻（秒）＋最後的 banner 狀態。 */
async function runStuck({ mutate = (s) => s, thresholdSec = 180, totalSec = 400, healthy = false } = {}) {
  const gap = loadFn(await ts('export const _f = (() => {\n' + mutate(GAP_SRC, 'gap')
    + '\nreturn { casualResyncGapMs, casualResyncInLastChance, RESYNC_BASE_MS }; })();'));
  const runInterval = new Function('S', 'with (S) {\n' + (await ts(mutate(IV_BODY, 'interval'))) + '\n}');
  let now = 1000000;
  const at = [], streakAt = [];
  const S = {
    roomCode: 'R', game: mkGame(1), mySeatIdx: 0, myPlayerIndex: 0,
    roomData: { idleTimeoutSec: thresholdSec }, oppInactivityWarn: false,
    _lastActionAt: now, _lastSyncAt: now, _lastResyncAt: 0, _resyncStreak: 0,
    _forceAdoptNext: false, _unpushedState: null, _repushAttempts: 0, unsubRoom: null,
    casualWaitingSelfInput: () => false, Date: { now: () => now }, Math,
    console: { warn() {}, error() {}, log() {} },
    isWaitingOnOpponent, decideStuckSelfHeal: () => ({ kind: 'force-adopt' }),
    casualResyncGapMs: gap.casualResyncGapMs,
    casualResyncInLastChance: gap.casualResyncInLastChance,
    RESYNC_BASE_MS: gap.RESYNC_BASE_MS,
    hasFreshPushInFlight: () => false, oldestPushInFlightAgeMs: () => 0,
    pushTracked: () => Promise.resolve(), handleRoomUpdate: () => {},
    subscribeRoom: () => { at.push((now - 1000000) / 1000); return () => {}; },
  };
  for (let t = 5000; t <= totalSec * 1000; t += 5000) {
    now = 1000000 + t;
    if (healthy) { S._lastSyncAt = now; S._lastActionAt = now; }   // 對手一直在動
    runInterval(S);
    streakAt.push([t / 1000, S._resyncStreak]);
  }
  return { at, streakAt, warn: S.oppInactivityWarn, streak: S._resyncStreak,
    streakBefore(sec) { let v = 0; for (const [t, k] of streakAt) { if (t >= sec) break; v = k; } return v; } };
}
const escapeAt = (times, Rsec) => { for (const t of times) if (t >= Rsec) return t; return Infinity; };
// 對照組：關掉救援窗必須用 -1（閉區間，0 會讓 `since === threshold` 那一格仍成立）
const OFF = (s) => s.replace(/const RESYNC_LAST_CHANCE_MS = -?\d+;/, 'const RESYNC_LAST_CHANCE_MS = -1;');
const MUT_247 = (s, k) => (k === 'gap' ? OFF(s.replace(/const RESYNC_MAX_MS = \d+;/, 'const RESYNC_MAX_MS = 8000;')) : s);
const MUT_248 = (s, k) => (k === 'gap' ? OFF(s.replace(/const RESYNC_MAX_MS = \d+;/, 'const RESYNC_MAX_MS = 60000;')) : s);
const MUT_NO_LASTCHANCE = (s, k) => (k === 'gap' ? OFF(s) : s);

/** ⚠【7】模擬本身跑不起來（錨點抽不到）時也不可以頂層中止：記錄下來，讓各項各自紅。 */
async function safeRunStuck(opt, what) {
  try { return await runStuck(opt); }
  catch (e) {
    ANCHOR_ERRS.push(what + '：' + e.message);
    const err = what + '：' + e.message;
    return { at: [], streakAt: [], warn: null, streak: null, _err: err,
      streakBefore() { throw new Error(err); } };
  }
}
const SHIP = await safeRunStuck({}, '出貨版模擬');
const V247 = await safeRunStuck({ mutate: MUT_247 }, 'v6.247 對照組模擬');

T('[自我驗證/【7】] 所有錨點都抽得到、模擬跑得起來；抽不到就在這裡列出，其餘各項也會各自紅', () => {
  assert.deepEqual(ANCHOR_ERRS, [], '抽取／模擬失敗：\n  - ' + ANCHOR_ERRS.join('\n  - '));
});

// ══════════════════════════════════════════════════════════════════════════
// 2. 【1】上限值與純函式
// ══════════════════════════════════════════════════════════════════════════
T('[HEAD-FAIL①] RESYNC_MAX_MS 已由 60 秒下修到 20 秒（求值真常數，不是比對字串）', () => {
  assert.equal(SGC.RESYNC_MAX_MS, 20000,
    'RESYNC_MAX_MS = ' + SGC.RESYNC_MAX_MS + '，但 v6.249 的量測結論是 20000'
    + '（60000 ⇒ 脫困最壞慢 55 秒、致命區間 35 秒）');
  assert.equal(SGC.RESYNC_BASE_MS, 8000, 'v5.360 的 8 秒基底被改掉了');
  assert.equal(SGC.RESYNC_FULL_RATE_ROUNDS, 3, '前 3 次全速的窗口被改掉了');
  assert.deepEqual([0, 1, 2].map(GAP.casualResyncGapMs), [8000, 8000, 8000]);
  assert.equal(GAP.casualResyncGapMs(3), 16000);
  assert.equal(GAP.casualResyncGapMs(4), 20000);
  assert.equal(GAP.casualResyncGapMs(99), 20000, '沒有夾在上限內');
  assert.equal(GAP.casualResyncGapMs(NaN), 8000, 'NaN 沒退回基底 ⇒ 比較永遠 false ⇒ 再也不重訂閱');
});

// ══════════════════════════════════════════════════════════════════════════
// 3. 【1】【2】⭐核心：逐秒掃 R —— 不得存在「v6.247 救得到、v6.249 救不到」的 R
// ══════════════════════════════════════════════════════════════════════════
function sweep(times, base, thresholdSec) {
  let worst = 0, worstR = 0; const fatal = [];
  for (let R = 1; R <= 300; R++) {
    const eh = escapeAt(times, R), eb = escapeAt(base, R);
    if (eh - eb > worst) { worst = eh - eb; worstR = R; }
    if (eb <= thresholdSec && eh > thresholdSec) fatal.push(R);
  }
  return { worst, worstR, fatal };
}
T('[HEAD-FAIL②] ⭐逐秒掃 R=1..300：v6.249 不存在「v6.247 救得回、它救不回」的 R（致命區間 = 0）', () => {
  // ⚠ Rule 25：先下限斷言。兩邊都空陣列時「致命區間 = 0」是**空真**，那是 fail-open。
  assert.ok(SHIP.at.length >= 10, '出貨版 300 秒只重訂閱 ' + SHIP.at.length + ' 次 ⇒ 模擬沒跑起來或脫困能力被砍');
  assert.ok(V247.at.length >= 20, 'v6.247 對照組只有 ' + V247.at.length + ' 次 ⇒ 對照組沒跑起來');
  const s = sweep(SHIP.at, V247.at, 180);
  assert.deepEqual(s.fatal, [],
    '這些 R（秒）會從「被救回」變成「輸掉」：' + s.fatal.join(',')
    + '\n  v6.249 重訂閱時刻=' + SHIP.at.filter((t) => t <= 300).join(',')
    + '\n  v6.247 重訂閱時刻=' + V247.at.filter((t) => t <= 300).join(','));
  assert.ok(s.worst <= 15, '最壞脫困延遲 ' + s.worst + ' 秒（上限 15 秒；v6.248 是 55 秒）');
  console.log('   v6.249 重訂閱時刻(s)：' + SHIP.at.filter((t) => t <= 300).join(', ')
    + '（300 秒 ' + SHIP.at.filter((t) => t <= 300).length + ' 次，v6.247 是 '
    + V247.at.filter((t) => t <= 300).length + ' 次；最壞慢 ' + s.worst + ' 秒）');
});
await TA('[反對照/掃描器先驗] 同一支掃描器對 v6.248 的參數必須算得出 35 秒致命區間', async () => {
  const r248 = await runStuck({ mutate: MUT_248 });
  const s = sweep(r248.at, V247.at, 180);
  assert.equal(s.fatal.length, 35, 'v6.248 的致命區間算成 ' + s.fatal.length + ' 秒（複驗值是 35 秒）'
    + ' ⇒ 掃描器壞了，上面那條 PASS 不可信');
  assert.equal(s.worst, 55, 'v6.248 的最壞脫困延遲算成 ' + s.worst + ' 秒（複驗值是 55 秒）');
  console.log('   複驗 v6.248：時刻 ' + r248.at.filter((t) => t <= 300).join(',')
    + '｜最壞慢 ' + s.worst + ' 秒｜致命區間 ' + s.fatal.length + ' 秒（R=' + s.fatal[0] + '..' + s.fatal[s.fatal.length - 1] + '）');
});
await TA('[HEAD-FAIL③] 房主把棄權門檻調成 60 / 300 秒時，致命區間一樣要是 0', async () => {
  for (const sec of [60, 300]) {
    const h = await runStuck({ thresholdSec: sec });
    const b = await runStuck({ mutate: MUT_247, thresholdSec: sec });
    const s = sweep(h.at, b.at, sec);
    assert.deepEqual(s.fatal, [], '門檻 ' + sec + ' 秒時致命區間 = ' + s.fatal.length + ' 秒：' + s.fatal.join(','));
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 4. 【2】⭐從 streak≥3 起跑（對手長考先把 streak 推高）—— 現有正對照蓋不到這個情境
// ══════════════════════════════════════════════════════════════════════════
await TA('[HEAD-FAIL④] ⭐對手長考 L 秒後才斷線 ⇒ 起跑 streak 已 ≥3，救援仍不得比 v6.247 慢過 15 秒', async () => {
  const r248 = await runStuck({ mutate: MUT_248 });
  const rows = [];
  for (const L of [40, 100, 140, 170]) {
    const st = SHIP.streakBefore(L);
    assert.ok(st >= 3, 'L=' + L + ' 秒時 streak 只有 ' + st
      + ' ⇒ 這個情境沒有建立起來（本條的前提就是「長考已經把 streak 推到 ≥3」）');
    const R = L + 1;                                   // 長考尾聲斷線、隨即恢復
    const eh = escapeAt(SHIP.at, R), eb = escapeAt(V247.at, R), e8 = escapeAt(r248.at, R);
    assert.ok(eh - eb <= 15, 'L=' + L + '：v6.249 第一次救援 ' + eh + 's，比 v6.247 的 ' + eb + 's 慢了 ' + (eh - eb) + ' 秒');
    assert.ok(eh <= 180, 'L=' + L + '：v6.249 第一次救援 ' + eh + 's 已經超過棄權門檻 ⇒ 那一局直接輸掉');
    rows.push('L=' + L + '(streak=' + st + ') v6.247=' + eb + 's v6.248=' + e8 + 's v6.249=' + eh + 's');
  }
  console.log('   ' + rows.join('｜'));
});
await TA('[HEAD-FAIL⑤/【2】語意] 審查者建議的 streak 語意換上去之後，時間軸**逐格相同**（＝那個修法無效）', async () => {
  // 建議：「只在真的做了重訂閱卻沒有換來進展時才累加」。
  // 但重訂閱抓回來的是同一個房間版本（對手長考／我方掉線都一樣）⇒ 條件恆為真。
  const alt = await runStuck({ mutate: (s, k) => (k === 'interval'
    ? s.replace('_resyncStreak++;', 'const _b4 = _lastSyncAt; if (_b4 === _lastSyncAt) _resyncStreak++;') : s) });
  assert.notEqual(alt.at.length, 0, '對照組沒跑起來');
  assert.deepEqual(alt.at, SHIP.at,
    '換上建議語意之後時間軸變了 ⇒ 本條的結論（「改 streak 累加規則解不了問題」）要重新檢討：\n'
    + '  現況=' + SHIP.at.join(',') + '\n  建議=' + alt.at.join(','));
});

// ══════════════════════════════════════════════════════════════════════════
// 5. 【最後救援窗】純函式邊界
// ══════════════════════════════════════════════════════════════════════════
T('[HEAD-FAIL⑥] casualResyncInLastChance：閉區間 [門檻-30s, 門檻]，門檻之後不再全速', () => {
  assert.equal(SGC.RESYNC_LAST_CHANCE_MS, 30000, '救援窗寬度 = ' + SGC.RESYNC_LAST_CHANCE_MS);
  const f = GAP.casualResyncInLastChance;
  assert.equal(f(149999, 180000), false, '門檻前 30 秒之外就開始全速 ⇒ 退避等於白做');
  assert.equal(f(150000, 180000), true, '門檻前 30 秒沒有進入救援窗');
  assert.equal(f(180000, 180000), true, '門檻**那一刻**沒進救援窗 ⇒ 會留下最後 10 秒的致命區間');
  assert.equal(f(180001, 180000), false, '過了門檻還全速 ⇒ churn 回到 v6.247 的量，退避等於白做');
  assert.equal(f(30000, 60000), true, '門檻 60 秒（房主可調下限）時算錯');
  assert.equal(f(NaN, 180000), false, 'NaN 沒 fail-closed');
  assert.equal(f(160000, NaN), false, '門檻是 NaN 時沒 fail-closed');
  assert.equal(f(160000, 0), false, '門檻 0（不該發生）時沒 fail-closed');
});

// ══════════════════════════════════════════════════════════════════════════
// 6. 【棄權零改動】站長裁定：「還是照樣判 A 輸，畢竟塞住的是 A，也有責任」
// ══════════════════════════════════════════════════════════════════════════
T('[現況鎖/棄權] 棄權三處逐字不變，而且救援窗只**讀**不寫', () => {
  assert.ok(/const thresholdMs = Math\.min\(300, Math\.max\(60, roomData\?\.idleTimeoutSec \?\? 180\)\) \* 1000;/.test(IV_BODY),
    '棄權門檻的算法被改了');
  assert.ok(/oppInactivityWarn = \(Date\.now\(\) - _lastActionAt\) >= thresholdMs;/.test(IV_BODY),
    '棄權提示的觸發條件被改了');
  assert.ok(/const granted = await claimOpponentForfeit\(roomCode, mySeatIdx as 0 \| 1\);/.test(GP),
    '伺服器端棄權再驗證的呼叫被改了');
  // 救援窗那一行只能出現在 `const _resyncGapMs = …` 的右手邊，不可以去寫 oppInactivityWarn
  const line = /const _resyncGapMs = casualResyncInLastChance\([^;]*;/.exec(stripComments(IV_BODY));
  assert.ok(line, '救援窗沒有接到 _resyncGapMs 上');
  assert.ok(!/oppInactivityWarn/.test(line[0]), '救援窗那一段竟然碰到 oppInactivityWarn');
  assert.equal((stripComments(IV_BODY).match(/oppInactivityWarn\s*=/g) || []).length, 3,
    'oppInactivityWarn 的賦值處數量變了（原本 3 處：無房間、非等對手、門檻判定）');
});
await TA('[現況鎖/棄權行為] 對手真的掛機 3 分鐘 ⇒ 棄權提示照跳；門檻 60 秒時也照跳', async () => {
  const a = await runStuck({ totalSec: 200 });
  assert.equal(a.warn, true, '對手掛機超過門檻竟然不跳棄權提示');
  const b = await runStuck({ thresholdSec: 60, totalSec: 100 });
  assert.equal(b.warn, true, '門檻 60 秒時不跳棄權提示');
});

// ══════════════════════════════════════════════════════════════════════════
// 7. 【3】在途 fail-safe 的實用上限
// ══════════════════════════════════════════════════════════════════════════
const SLOWEST_OBSERVED_PUSH_MS = 86954;   // nginx 實測：`86.954 0.007 409 … PUT request_length=48285`
const FORFEIT_DEFAULT_MS = 180000;
T('[HEAD-FAIL⑦] PUSH_INFLIGHT_FAILSAFE_MS = 2 × 單發預算上限，且落在「實測最慢成功 ~ 兩個棄權門檻」之間', () => {
  assert.equal(OCC.PUSH_INFLIGHT_FAILSAFE_MS, 2 * OCC.ORACLE_API_TIMEOUT_MAX_MS,
    '在途上限 ' + OCC.PUSH_INFLIGHT_FAILSAFE_MS + ' 不是「oracleTx 連續兩輪大 PUT」推出來的');
  assert.equal(OCC.PUSH_INFLIGHT_FAILSAFE_MS, 240000);
  // Rule 37：逾時值必須大於實測過的最慢**成功**案例
  assert.ok(OCC.PUSH_INFLIGHT_FAILSAFE_MS > SLOWEST_OBSERVED_PUSH_MS * 2,
    '在途上限只有 ' + OCC.PUSH_INFLIGHT_FAILSAFE_MS + ' ms ⇒ 連「兩輪 409 重試 × 實測最慢成功 '
    + SLOWEST_OBSERVED_PUSH_MS + ' ms」都容不下，會把成功的推送誤判成過期而回捲玩家的一手');
  // 審查者【問題3】：不可以再是「玩家先輸掉、fail-safe 才動」
  assert.ok(OCC.PUSH_INFLIGHT_FAILSAFE_MS <= 2 * FORFEIT_DEFAULT_MS,
    '在途上限 ' + OCC.PUSH_INFLIGHT_FAILSAFE_MS + ' ms 超過兩個棄權門檻 ⇒ 等於沒有 fail-safe');
  assert.ok(OCC.PUSH_INFLIGHT_FAILSAFE_MS < OCC.ORACLE_TX_MAX_TOTAL_MS,
    '又退回用數學最壞值 ' + OCC.ORACLE_TX_MAX_TOTAL_MS + ' ms（25.01 分鐘）當上限');
  // 數學上限本身要留著（它是註解與 test-v6248 的推導依據，不可以順手刪掉）
  assert.ok(OCC.ORACLE_TX_MAX_TOTAL_MS > OCC.ORACLE_API_TIMEOUT_MAX_MS, 'ORACLE_TX_MAX_TOTAL_MS 被弄壞了');
  console.log('   在途上限 = ' + OCC.PUSH_INFLIGHT_FAILSAFE_MS + ' ms（'
    + (OCC.PUSH_INFLIGHT_FAILSAFE_MS / 60000).toFixed(2) + ' 分鐘）＝ '
    + (OCC.PUSH_INFLIGHT_FAILSAFE_MS / SLOWEST_OBSERVED_PUSH_MS).toFixed(2) + ' × 實測最慢成功推送、'
    + (OCC.PUSH_INFLIGHT_FAILSAFE_MS / FORFEIT_DEFAULT_MS).toFixed(2) + ' × 棄權門檻'
    + '（v6.248 是 ' + (OCC.ORACLE_TX_MAX_TOTAL_MS / FORFEIT_DEFAULT_MS).toFixed(1) + ' ×）');
});

// ══════════════════════════════════════════════════════════════════════════
// 8. 【5】隱性耦合：test-v6245 的 pushWithRetry 抽取視窗必須能求值
// ══════════════════════════════════════════════════════════════════════════
const V45_START = "  const PUSH_RETRY_MAX = 3;";
const V45_END = "\n    return false;\n  }";
function evalV6245Window(gpSrc) {
  // 與 scripts/test-v6245-oracle-api-timeout.mjs 的 loadPushWithRetry 同一組錨點與注入名單
  const i = gpSrc.indexOf(V45_START);
  if (i < 0) throw new Error('找不到 v6245 抽取視窗的起點');
  const j = gpSrc.indexOf(V45_END, i + V45_START.length);
  if (!(j > i)) throw new Error('找不到 v6245 抽取視窗的終點');
  const block = gpSrc.slice(i, j + V45_END.length)
    .replace(/: GameState/g, '').replace(/: string/g, '').replace(/: Promise<boolean>/g, '');
  return block;
}
await TA('[HEAD-FAIL⑧/【5】] test-v6245 的 pushWithRetry 抽取視窗要能單獨求值（模組層級 const 的順序耦合）', async () => {
  // ⚠ 錨點必須與 test-v6245 真正用的那一組一致，否則這條守衛守的是別的東西（安慰劑）。
  assert.ok(T45.includes("extractBlock(gpSrc, '  const PUSH_RETRY_MAX = 3;'"),
    'test-v6245 的 pushWithRetry 抽取錨點改了 ⇒ 這條守衛的視窗跟它已經對不上，請一起更新');
  const block = evalV6245Window(GP);
  const js = (await transform(block, { loader: 'ts' })).code;
  try {
    new Function('pushGameState', 'isOracleTimeout', 'console', 'setTimeout', 'pushTracked', 'pushUndoTracked',
      'let _unpushedState = null, _repushAttempts = 0;\n' + js + '\n;return pushWithRetry;')(
      async () => {}, () => false, { warn() {}, error() {} }, () => 0, async () => {}, async () => {});
  } catch (e) {
    assert.fail('⚠ 真因：`' + V45_START.trim() + '` 之後、pushWithRetry 結束之前，出現了「需要外部識別字的'
      + '模組層級宣告」。scripts/test-v6245-oracle-api-timeout.mjs 會把這一段單獨抽出來求值，'
      + '於是丟出 `' + e.message + '`（錯誤訊息完全指不到真因）。'
      + '\n  ⇒ 把那個宣告搬到 `' + V45_START.trim() + '` **之前**，或改成從模組 import。');
  }
});
T('[HEAD-FAIL⑧b/正對照] 上面那條不是安慰劑：把一個需要外部識別字的 const 塞進視窗就必須翻紅', async () => {
  const poisoned = GP.replace(V45_START, V45_START + '\n  const _X = Math.max(這個識別字不存在, 1);');
  assert.notEqual(poisoned, GP, '注入失敗（找不到視窗起點）');
  let threw = false;
  try {
    const js = (await transform(evalV6245Window(poisoned), { loader: 'ts' })).code;
    new Function('pushGameState', 'isOracleTimeout', 'console', 'setTimeout', 'pushTracked', 'pushUndoTracked',
      'let _unpushedState = null, _repushAttempts = 0;\n' + js + '\n;return pushWithRetry;')(
      async () => {}, () => false, { warn() {}, error() {} }, () => 0, async () => {}, async () => {});
  } catch { threw = true; }
  assert.ok(threw, '注入了壞的模組層級 const，求值竟然還是成功 ⇒ 這條守衛測不到東西');
});

// ══════════════════════════════════════════════════════════════════════════
// 9. 【6】全站「整包 gameState 上行」的處置表（明示例外）
// ══════════════════════════════════════════════════════════════════════════
/** 掃 room-oracle.ts：每一個寫入**非 null** gameState 的 export function。 */
function gameStateWriters(src) {
  const stripped = stripComments(src);
  const fns = [];
  const re = /^export (?:async )?function (\w+)/gm;
  let m;
  while ((m = re.exec(stripped))) fns.push({ name: m[1], idx: m.index });
  const out = [];
  for (let i = 0; i < fns.length; i++) {
    const body = stripped.slice(fns[i].idx, i + 1 < fns.length ? fns[i + 1].idx : stripped.length);
    // ⚠ 不可以寫成 /gameState:\s*(?!null)/ —— `\s*` 會回溯到零長度，`gameState: null` 照樣命中
    //   （實測：createRoom / checkAndAcceptRematch / checkAndAcceptReturnToRoom 三個「清盤面」
    //     的函式全被誤收）。改成逐處抓出後面接的是什麼再判。
    let g; const gre = /gameState:\s*/g; let writesNonNull = false;
    while ((g = gre.exec(body))) {
      const rest = body.slice(g.index + g[0].length);
      if (!/^null\b/.test(rest)) { writesNonNull = true; break; }
    }
    if (writesNonNull) out.push(fns[i].name);
  }
  return out.sort();
}
const DISPOSITION = {
  pushGameState:          'tracked',
  pushUndoRollback:       'tracked',
  // ── 以下是**明示例外**：為什麼不納入在途追蹤（不是漏掉）──────────────────
  startGame:              'excluded/建局：createGame 產的是 phase==="setup" 的新局，'
                          + 'isWaitingOnOpponent 在 setupDone=[false,false] 回 false ⇒ 那一輪根本走不到自癒；'
                          + '且 force-adopt 的採用端明文拒收 incoming.phase === "setup"。'
                          + '另有 v5.492 的 won/canonical 保護與 v6.055 建局看門狗。',
  checkAndAcceptRestart:  'excluded/換局：同上（也是 createGame 的 setup 新局），'
                          + '而且換局的 $effect 會 _resetPushTracking() ⇒ 追蹤它反而會壓住新局的自癒。',
  claimOpponentForfeit:   'excluded/棄權：寫的是終局盤面並把 status 設成 "ended"，'
                          + '屬於站長裁定「一行都不准動」的棄權三處；終局之後沒有回捲可言。',
  leaveRoom:              'excluded/離開房間：對手中途離開時同樣寫的是終局盤面並把 status 設成 "ended"，'
                          + '終局之後不存在「把玩家的一手退回去」的問題，也屬於棄權語意的一部分。',
};
T('[HEAD-FAIL⑨/掃描器先驗] 掃描器抓得到「新增的整包盤面寫入」（正對照，否則是安慰劑）', () => {
  const before = gameStateWriters(RO);
  assert.ok(before.length >= 6, '只掃到 ' + before.length + ' 個寫入點 ⇒ 掃描器壞了');
  const injected = RO.replace('export async function heartbeat(',
    'export async function __fake(roomCode: string) {\n  await oracleTx(roomCode, (d) => ({ ...d, gameState: {} as any }));\n}\nexport async function heartbeat(');
  assert.deepEqual(gameStateWriters(injected).filter((n) => !before.includes(n)), ['__fake'],
    '掃描器對新插進去的整包盤面寫入沒有反應');
  assert.equal(gameStateWriters('export function f() { return { gameState: null }; }').length, 0,
    '掃描器把 `gameState: null`（清盤面）也算進去了');
  assert.equal(gameStateWriters('// export function g() { gameState: 1 }').length, 0, '掃描器把註解也算進去了');
});
T('[HEAD-FAIL⑨] 每一個整包盤面寫入都要有明示處置（tracked 或 excluded＋理由），不可以有漏網的', () => {
  const found = gameStateWriters(RO);
  const undeclared = found.filter((n) => !DISPOSITION[n]);
  assert.deepEqual(undeclared, [],
    '這些函式會把整包 gameState 送上同一條上行，但處置表裡沒有宣告：' + undeclared.join('、')
    + '\n  ⇒ 請在 DISPOSITION 裡寫明是 tracked 還是 excluded，excluded 要附**為什麼安全**。');
  const stale = Object.keys(DISPOSITION).filter((n) => !found.includes(n));
  assert.deepEqual(stale, [], '處置表裡有已經不存在的函式（死條目）：' + stale.join('、'));
  for (const [n, d] of Object.entries(DISPOSITION)) {
    if (d === 'tracked') continue;
    assert.ok(d.startsWith('excluded/') && d.length > 40, n + ' 的排除理由太短，等於沒寫');
  }
  console.log('   整包盤面上行 ' + found.length + ' 處：tracked=' +
    found.filter((n) => DISPOSITION[n] === 'tracked').join(',') + '｜明示排除=' +
    found.filter((n) => DISPOSITION[n] !== 'tracked').join(','));
});
T('[HEAD-FAIL⑨b] 明示排除的**前提**要真的成立（不是嘴上說安全）', () => {
  // ① 新局是 setup 且 setupDone 都是 false ⇒ isWaitingOnOpponent 為 false ⇒ 走不到自癒
  const fresh = { id: 'N1', phase: 'setup', setupDone: [false, false], log: [], pendingPrizes: [0, 0],
    pendingSelection: null, activePlayerIndex: 0, players: [{ active: null, bench: [] }, { active: null, bench: [] }] };
  assert.equal(isWaitingOnOpponent(fresh, 0), false, '剛建好的 setup 局竟然算「等對手」⇒ 排除理由不成立');
  assert.equal(isWaitingOnOpponent(fresh, 1), false, '（對側）同上');
  // ② force-adopt 的採用端拒收 setup
  const B0 = GP.indexOf('if (_forceAdoptNext) {');
  assert.ok(B0 > 0, '定位不到 force-adopt 的採用端');
  const seg = GP.slice(B0, B0 + 3000);
  assert.ok(/phase\s*!==\s*'setup'|phase\s*===\s*'setup'/.test(seg),
    'force-adopt 的採用端不再對 incoming.phase === "setup" 做判斷 ⇒ 排除理由不成立');
  // ③ 換局會清掉在途追蹤（所以追蹤 checkAndAcceptRestart 反而有害）
  assert.ok(/_resetPushTracking\(\);/.test(GP), '換局的在途重設不見了');
});

// ══════════════════════════════════════════════════════════════════════════
// 10. ⭐正對照：健康路徑逐字不變
// ══════════════════════════════════════════════════════════════════════════
await TA('[正對照] 健康對局：0 次重訂閱、0 次退避累加、不跳棄權提示（請求數逐字不變）', async () => {
  const r = await runStuck({ healthy: true, totalSec: 300 });
  assert.equal(r.at.length, 0, '健康對局竟然重訂閱 ' + r.at.length + ' 次（＝多打伺服器）');
  assert.equal(r.streak, 0, '健康對局的退避 streak 竟然被累加');
  assert.equal(r.warn, false, '健康對局竟然跳棄權提示');
});
T('[正對照] 5 秒 interval、8 秒判定、25 秒門檻的字面逐字不變', () => {
  assert.ok(/setInterval\(\(\) => \{[\s\S]{200,}?\}, 5000\);/.test(GP), 'interval 不是 5 秒了');
  assert.ok(/\(Date\.now\(\) - _lastSyncAt\) >= 8000/.test(GP), '8 秒判定不見了');
  assert.ok(/\(Date\.now\(\) - _lastSyncAt\) >= 25000/.test(GP), '25 秒門檻不見了');
  assert.deepEqual(SHIP.at.slice(0, 3), [10, 20, 30], '前三次重訂閱的時刻變了（v5.360 的救援窗口必須逐字不變）');
});
T('[回歸/註解] v6.248 那句「下次卡住第一發仍是 8 秒」的錯誤結論已經被更正掉', () => {
  assert.ok(!/⇒ 下一次真的卡住時，第一發重訂閱仍是 v5\.360 的 8 秒，逐字不變。/.test(GP),
    '錯誤的註解還在（對手長考本身就會把 streak 推到 ≥3）');
  assert.ok(/對手長考本身就沒有 log 變動/.test(GP), '沒有把真正的原因寫進註解');
  assert.ok(!/之後才退避到上限 60 秒。/.test(GP), '「上限 60 秒」的過時註解還在');
});

// ══════════════════════════════════════════════════════════════════════════
// 11. ⭐突變測試（紅在指定那一條；⚠ 只捕捉 AssertionError）
// ══════════════════════════════════════════════════════════════════════════
async function mutantCheck(probe) {
  try { await probe(); return { passed: true }; }
  catch (e) {
    if (e instanceof assert.AssertionError) return { passed: false, why: e.message };
    throw e;
  }
}
await TA('[突變1] RESYNC_MAX_MS 改回 60000 ⇒ 「致命區間 = 0」必須翻紅', async () => {
  const r = await runStuck({ mutate: MUT_248 });
  const a = await mutantCheck(() => {
    const s = sweep(r.at, V247.at, 180);
    assert.deepEqual(s.fatal, [], 'fatal=' + s.fatal.length);
  });
  assert.equal(a.passed, false, '上限改回 60 秒，致命區間竟然還是 0 ⇒ 這條守衛是安慰劑');
  assert.ok(/fatal=35/.test(a.why), '紅的不是預期那一條：' + a.why);
});
await TA('[突變2] 拿掉最後救援窗（只留 20 秒上限）⇒ 「致命區間 = 0」必須翻紅', async () => {
  const r = await runStuck({ mutate: MUT_NO_LASTCHANCE });
  const a = await mutantCheck(() => {
    const s = sweep(r.at, V247.at, 180);
    assert.deepEqual(s.fatal, [], 'fatal=' + s.fatal.length);
  });
  assert.equal(a.passed, false, '拿掉救援窗，致命區間竟然還是 0');
  assert.ok(/fatal=10/.test(a.why), '紅的不是預期那一條（應為 10 秒）：' + a.why);
  // 而且它不可以連「最壞脫困延遲」也一起弄紅 ⇒ 定位要準
  const s = sweep(r.at, V247.at, 180);
  assert.ok(s.worst <= 15, '突變2 連不相干的指標也弄壞了 ⇒ 定位不準（worst=' + s.worst + '）');
});
await TA('[突變3] 救援窗改成「過了門檻還全速」⇒ churn 必須爆增（證明上界 <= 不是裝飾）', async () => {
  const r = await runStuck({ mutate: (s, k) => (k === 'gap'
    ? s.replace('&& sinceLastActionMs <= forfeitThresholdMs', '&& true') : s) });
  const n = r.at.filter((t) => t <= 300).length;
  assert.ok(n >= 24, '拿掉上界之後 300 秒只有 ' + n + ' 次 ⇒ 「上界 <= 是必要的」這個說法測不到東西');
  assert.ok(SHIP.at.filter((t) => t <= 300).length < n,
    '出貨版的 churn 竟然沒有比「無上界」版少 ⇒ 退避等於白做');
});
await TA('[突變4] 在途上限改回 1500750（數學最壞值）⇒ 【3】那條必須翻紅', async () => {
  const a = await mutantCheck(() => {
    assert.ok(1500750 <= 2 * FORFEIT_DEFAULT_MS, 'failsafe=1500750 超過兩個棄權門檻');
  });
  assert.equal(a.passed, false, '25 分鐘的上限竟然通過「不可超過兩個棄權門檻」');
  assert.ok(/超過兩個棄權門檻/.test(a.why), '紅的不是預期那一條：' + a.why);
});
T('[突變5] 處置表少掉一項 ⇒ 【6】的枚舉必須翻紅', () => {
  const found = gameStateWriters(RO);
  const partial = { ...DISPOSITION };
  delete partial.startGame;
  const undeclared = found.filter((n) => !partial[n]);
  assert.deepEqual(undeclared, ['startGame'],
    '從處置表拿掉 startGame 之後，枚舉竟然沒有把它列成漏網 ⇒ 那條守衛是安慰劑（undeclared='
    + undeclared.join(',') + '）');
});

console.log('\n=== v6.249 重訂閱退避／最後救援窗／在途 fail-safe／枚舉例外: ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
