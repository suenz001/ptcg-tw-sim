#!/usr/bin/env node
/**
 * v6.249 量測腳本（Rule 32：效能／取捨數字必須附量測腳本，否則審查者一律自行實測）。
 *
 * 量什麼：卡住期間「重建房間訂閱」的時刻，以及它換算成的三個玩家可感指標
 *   ① churn：300 秒內重訂閱幾次（每一次 = 一趟**全量**房間 GET）。
 *   ② 脫困延遲：卡住在 t=R 解除時，第一次能救回來的重訂閱落在什麼時候（對照 v6.247）。
 *   ③ **致命區間**：R 落在哪些秒數時，v6.247 來得及在棄權門檻前脫困、這一版來不及
 *      —— 站長已裁定「卡住方判負」，所以那等於「從被救回變成輸掉」。
 *
 * 怎麼量：從 `src/routes/game/+page.svelte` 抽出**真的 5 秒 interval body**、
 * 從 `src/lib/game/sync-guards.ts` 抽出**真的** `casualResyncGapMs` /
 * `casualResyncInLastChance`，用 esbuild 轉成 JS、`with(state)` 綁模擬狀態，配虛擬時鐘實跑。
 * 對照組（v6.247 固定 8 秒／v6.248 上限 60 秒／拿掉最後救援窗）都是**對同一份原始碼做字串突變**，
 * 不是另外手寫一份模型 —— 這樣三組跑的是同一條程式路徑。
 *
 * Run: node scripts/perf-v6249-resync-backoff-forfeit.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { transform } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GP = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SG = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');

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
const IV_ANCHOR = 'const iv = setInterval(() => {';
const ivStart = GP.indexOf(IV_ANCHOR);
if (ivStart < 0) throw new Error('抽不到 5 秒 interval —— 量測腳本不可 fail-open');
const [ivO, ivC] = blockAfter(GP, ivStart + IV_ANCHOR.length - 1);
const IV_BODY = GP.slice(ivO + 1, ivC - 1);
const CONST_SRC = ['RESYNC_BASE_MS', 'RESYNC_FULL_RATE_ROUNDS', 'RESYNC_MAX_MS', 'RESYNC_LAST_CHANCE_MS']
  .map((k) => {
    const m = new RegExp('export const ' + k + ' = \\d+;').exec(SG);
    if (!m) throw new Error('抽不到常數 ' + k);
    return m[0].replace(/^export /, '');
  }).join('\n');
const GAP_SRC = CONST_SRC + '\n'
  + fnSrc(SG, 'export function casualResyncGapMs(').replace(/^export /, '') + '\n'
  + fnSrc(SG, 'export function casualResyncInLastChance(').replace(/^export /, '');
const IWO_SRC = fnSrc(GP, 'function isWaitingOnOpponent(');

const ts = async (c) => (await transform(c, { loader: 'ts', format: 'cjs', target: 'node20' })).code;
function loadFn(cjs) { const m = { exports: {} }; new Function('module', 'exports', cjs)(m, m.exports); return m.exports._f; }
const isWaitingOnOpponent = loadFn(await ts('export const _f = (' + IWO_SRC.replace(/^function\s+\w+/, 'function') + ');'));

function mkGame(active) {
  return { id: 'G1', phase: 'playing', log: [{ msg: 'l0' }], setupDone: [true, true],
    pendingPrizes: [0, 0], pendingSelection: null, activePlayerIndex: active,
    players: [{ active: {}, bench: [{}] }, { active: {}, bench: [{}] }] };
}

/**
 * 跑一次「從 t=0 起再也收不到任何同步」的情境，回傳重訂閱時刻（秒）。
 * @param mutate  對抽出來的原始碼做字串突變（做對照組用）
 * ⚠ 不要用「一開始就把 _resyncStreak 設高」來模擬長考：interval 第一格就會因為
 *   `(now - _lastSyncAt) < 8000` 把它歸零（實測過）。長考與卡住是**同一段連續視窗**，
 *   正確做法是照樣從 t=0 跑，再看「第 L 秒之後的第一發重訂閱」。
 */
async function run({ mutate = (s) => s, thresholdSec = 180, totalSec = 400 } = {}) {
  const gap = loadFn(await ts('export const _f = (() => {\n' + mutate(GAP_SRC, 'gap')
    + '\nreturn { casualResyncGapMs, casualResyncInLastChance, RESYNC_BASE_MS }; })();'));
  const runInterval = new Function('S', 'with (S) {\n' + (await ts(mutate(IV_BODY, 'interval'))) + '\n}');
  let now = 1000000;
  const at = [];
  const S = {
    roomCode: 'R', game: mkGame(1), mySeatIdx: 0, myPlayerIndex: 0,
    roomData: { idleTimeoutSec: thresholdSec }, oppInactivityWarn: false,
    _lastActionAt: now, _lastSyncAt: now, _lastResyncAt: 0, _resyncStreak: 0,
    _forceAdoptNext: false, _unpushedState: null, _repushAttempts: 0, unsubRoom: null,
    casualWaitingSelfInput: () => false,
    Date: { now: () => now }, Math,
    console: { warn() {}, error() {}, log() {} },
    isWaitingOnOpponent, decideStuckSelfHeal: () => ({ kind: 'force-adopt' }),
    casualResyncGapMs: gap.casualResyncGapMs,
    casualResyncInLastChance: gap.casualResyncInLastChance,
    RESYNC_BASE_MS: gap.RESYNC_BASE_MS,
    hasFreshPushInFlight: () => false, oldestPushInFlightAgeMs: () => 0,
    pushTracked: () => Promise.resolve(), handleRoomUpdate: () => {},
    subscribeRoom: () => { at.push((now - 1000000) / 1000); return () => {}; },
  };
  const streakAt = [];
  for (let t = 5000; t <= totalSec * 1000; t += 5000) {
    now = 1000000 + t; runInterval(S); streakAt.push([t / 1000, S._resyncStreak]);
  }
  at.streakAt = streakAt;
  at.streakBefore = (sec) => {            // 進入「第 sec 秒」之前 streak 已經是多少
    let v = 0;
    for (const [t, k] of streakAt) { if (t >= sec) break; v = k; }
    return v;
  };
  return at;
}

const escape = (times, Rsec) => { for (const t of times) if (t >= Rsec) return t; return Infinity; };
function score(name, times, baseTimes, thresholdSec = 180) {
  let worst = 0, worstR = 0, fatal = 0;
  for (let R = 1; R <= 300; R++) {
    const eh = escape(times, R), eb = escape(baseTimes, R);
    if (eh - eb > worst) { worst = eh - eb; worstR = R; }
    if (eb <= thresholdSec && eh > thresholdSec) fatal++;
  }
  const n300 = times.filter((t) => t <= 300).length;
  const n180 = times.filter((t) => t <= thresholdSec).length;
  console.log('  ' + name.padEnd(30)
    + ' 300s重訂閱=' + String(n300).padStart(2)
    + '  門檻內=' + String(n180).padStart(2)
    + '  最壞慢=' + String(worst).padStart(2) + 's(R=' + worstR + 's)'
    + '  致命區間=' + fatal + 's');
  console.log('     時刻(s): ' + times.filter((t) => t <= 300).join(', '));
}

// ── 對照組：都是對同一份原始碼做突變 ────────────────────────────────────────
// ⚠ 關掉救援窗要用 **-1**，不是 0：`casualResyncInLastChance` 是閉區間
//   [threshold - LAST_CHANCE, threshold]，LAST_CHANCE=0 時 `since === threshold` 那一格仍然成立
//   （實測會憑空多一次 t=180s 的重訂閱，把對照組的致命區間洗成 0）。
const OFF = (s) => s.replace(/const RESYNC_LAST_CHANCE_MS = \d+;/, 'const RESYNC_LAST_CHANCE_MS = -1;');
const mutFixed8 = (s, k) => (k === 'gap' ? OFF(s.replace(/const RESYNC_MAX_MS = \d+;/, 'const RESYNC_MAX_MS = 8000;')) : s);
const mut248 = (s, k) => (k === 'gap' ? OFF(s.replace(/const RESYNC_MAX_MS = \d+;/, 'const RESYNC_MAX_MS = 60000;')) : s);
const mutNoLastChance = (s, k) => (k === 'gap' ? OFF(s) : s);

console.log('\n═══ ① 卡住期間的重訂閱時刻（t=0 是最後一次 log 變動；棄權門檻 180 秒）═══');
const BASE247 = await run({ mutate: mutFixed8 });
score('v6.247 固定 8 秒（基準）', BASE247, BASE247);
score('v6.248 上限 60 秒', await run({ mutate: mut248 }), BASE247);
score('v6.249 上限 20 秒（無救援窗）', await run({ mutate: mutNoLastChance }), BASE247);
const SHIP = await run();
const SHIP_STREAK = SHIP;
score('v6.249 出貨（20 秒＋救援窗）', SHIP, BASE247);

console.log('\n═══ ② ⭐【問題2】對手長考 L 秒之後才斷線 ⇒ 救援是從 streak≥3 起跑的 ═══');
console.log('  ⚠ v6.248 的註解說「streak 會歸零，所以下次卡住第一發仍是 8 秒」——不成立：');
console.log('    歸零條件是「game.log 有變動」，而**對手長考本身就沒有 log 變動**。');
console.log('    L = 對手已經長考幾秒；斷線後在 t=R 恢復；「第一次救援」= 第一個 >= R 的重訂閱。');
const T248 = await run({ mutate: mut248 });
for (const L of [0, 20, 40, 100, 140]) {
  const st = SHIP_STREAK.streakBefore(L === 0 ? 1 : L);
  const R = L + 1;   // 長考尾聲斷線、隨即恢復 ⇒ 最壞情況是剛好錯過上一發
  console.log('  L=' + String(L).padStart(3) + 's（此時 streak=' + st + '）'
    + '  v6.247 第一次救援=' + escape(BASE247, R) + 's'
    + ' | v6.248=' + escape(T248, R) + 's'
    + ' | v6.249=' + escape(SHIP, R) + 's');
}

console.log('\n═══ ③ ⭐【問題2】審查者建議的 streak 語意換上去之後，時間軸有沒有變 ═══');
console.log('  建議：「只在**真的做了重訂閱卻沒有換來進展**時才累加」。');
console.log('  但在「卡住／對手長考」這兩種情境下，重訂閱都**不會**換來進展（房間版本一樣）');
console.log('  ⇒ 條件恆為真 ⇒ 與現況等價。實跑對照：');
const mutStreakSemantics = (s, k) => (k === 'interval'
  // 「重訂閱後沒有換來進展才累加」＝ 把 _resyncStreak++ 換成「這一發重訂閱之後 _lastSyncAt 沒動才 ++」。
  //   模擬世界裡重訂閱抓回來的是同一個版本 ⇒ _lastSyncAt 不動 ⇒ 恆為真。
  ? s.replace('_resyncStreak++;', 'const _before = _lastSyncAt; if (_before === _lastSyncAt) _resyncStreak++;')
  : s);
const alt = await run({ mutate: mutStreakSemantics });
console.log('  現況        : ' + SHIP.filter((t) => t <= 300).join(', '));
console.log('  換上建議語意: ' + alt.filter((t) => t <= 300).join(', '));
console.log('  逐格相同？  : ' + (JSON.stringify(SHIP) === JSON.stringify(alt) ? '是 ⇒ 審查者的修法對這個情境無效' : '否'));

console.log('\n═══ ④ 房主把棄權門檻調成 60 秒 / 300 秒時 ═══');
for (const sec of [60, 300]) {
  const b = await run({ mutate: mutFixed8, thresholdSec: sec });
  const h = await run({ thresholdSec: sec });
  let fatal = 0;
  for (let R = 1; R <= 300; R++) if (escape(b, R) <= sec && escape(h, R) > sec) fatal++;
  console.log('  門檻 ' + String(sec).padStart(3) + 's：v6.249 重訂閱 ' + h.filter((t) => t <= 300).length
    + ' 次（v6.247 是 ' + b.filter((t) => t <= 300).length + ' 次），致命區間=' + fatal + 's');
  console.log('     時刻(s): ' + h.filter((t) => t <= 300).join(', '));
}
console.log('');
