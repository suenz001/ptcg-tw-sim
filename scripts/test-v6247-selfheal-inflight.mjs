#!/usr/bin/env node
/**
 * v6.247 守衛：休閒線上「推送還在途中就 force-adopt」＝盤面退回攻擊前。
 *
 * ── 這一版在修什麼 ────────────────────────────────────────────────────────
 * v6.212 用 `_unpushedState` 當「本地領先伺服器」的證據，但它只在 push **確定失敗之後**
 * 才被設定。push 還在飛的那段時間它仍是 null ⇒ 25 秒的 `decideStuckSelfHeal` 拿到
 * `hasUnpushedLocal:false` ⇒ 直接 `_forceAdoptNext = true` ⇒ handleRoomUpdate 繞過全部
 * stale 守衛採用伺服器那份（＝攻擊前）⇒ 玩家看到回合被退回。
 * v6.246 把 48KB 封包的預算放寬到 120 秒之後，「在途窗口」從 30 秒變成最長 120 秒，
 * 而且那些推送**真的會送到**（以前 30 秒就被砍掉）⇒ 這個回捲變得更常發生。
 *
 * ── 這支守衛怎麼驗（不是只驗字串存在）────────────────────────────────────
 * 直接從 `src/routes/game/+page.svelte` **抽出真的原始碼**（5 秒 interval 的 callback、
 * `pushWithRetry`、`isWaitingOnOpponent`）＋ room-oracle 的 `_waitingOnOpp`，
 * 用 esbuild 轉成 JS、用 `with(state)` 綁上模擬狀態，配**虛擬時鐘**實跑。
 *   [HEAD-FAIL] 標記的條目：把改動還原成 v6.246 重跑會 FAIL。
 *   [硬約束]    force-adopt 不得在「我的回合中途」觸發。
 *   [正對照]    健康對局：這段 interval 一發請求都不送、盤面一次都不動。
 *   [突變]      故意把修法／既有守衛拿掉，斷言**紅在指定的那一條**（不是無差別 try/catch）。
 *
 * ⭐⭐⭐v6.248 更新說明：在途標記的實作已收斂到中央的 pushTracked()／pushUndoTracked()，
 *   並改成「每一發各記自己的起始時刻」＋上限換成 oracleTx 的真實最壞總時長。
 *   ⇒ 這支守衛裡**只有「字面」斷言與模擬狀態的欄位名**跟著搬家（下方標 v6.248 的那幾條），
 *     行為端斷言（HEAD-FAIL①②③、硬約束、正對照）的情境與期望值一個字都沒有改。
 *     ⚠ 對 v6.246 的原始碼跑：抽取器在「找不到中央 helper」時**直接丟例外中止**（exit 1，
 *       不是靜默 SKIP）——這是刻意的 fail-closed，見 Rule 25。
 *     新增的問題另見 scripts/test-v6248-selfheal-followups.mjs。
 *
 * Run: node scripts/test-v6247-selfheal-inflight.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { transform } from 'esbuild';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GP = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const RO = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const TA = async (n, f) => { try { await f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ══════════════════════════════════════════════════════════════════════════
// 0. 抽取器（Rule 25：掃描器自身先驗）
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
const IV_ANCHOR = 'const iv = setInterval(() => {';
const ivStart = GP.indexOf(IV_ANCHOR);
if (ivStart < 0) throw new Error('抽不到 5 秒 interval —— 守衛不可 fail-open，直接中止');
const [ivOpen, ivClose] = blockAfter(GP, ivStart + IV_ANCHOR.length - 1);
const IV_BODY = GP.slice(ivOpen + 1, ivClose - 1);
const PWR_SRC = fnSrc(GP, 'async function pushWithRetry(');
const IWO_SRC = fnSrc(GP, 'function isWaitingOnOpponent(');
const WOO_SRC = fnSrc(RO, 'function _waitingOnOpp(');
// ⭐v6.248 在途標記已收斂到這幾支中央 helper（原本散在 pushWithRetry / 自癒重推裡）
const HELPER_ANCHORS = [
  'function _beginPushTrack(', 'function _endPushTrack(', 'function hasFreshPushInFlight(',
  'function oldestPushInFlightAgeMs(', 'function _resetPushTracking(',
  'async function pushTracked(', 'async function pushUndoTracked(',
];
const HELPERS_SRC = HELPER_ANCHORS.map((a) => fnSrc(GP, a)).join('\n');
const SG_SRC = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
const CRG_SRC = ['RESYNC_BASE_MS', 'RESYNC_FULL_RATE_ROUNDS', 'RESYNC_MAX_MS']
  .map((k) => new RegExp('export const ' + k + ' = \\d+;').exec(SG_SRC)[0].replace(/^export /, '')).join('\n')
  + '\n' + fnSrc(SG_SRC, 'export function casualResyncGapMs(').replace(/^export /, '');

T('[自我驗證] 抽取器真的抽到東西（抽爆／抽半截就不可以放行）', () => {
  assert.ok(IV_BODY.length > 1500, 'interval body 只有 ' + IV_BODY.length + ' 字元');
  assert.ok(PWR_SRC.length > 800, 'pushWithRetry 只有 ' + PWR_SRC.length + ' 字元');
  assert.ok(IWO_SRC.length > 700 && IWO_SRC.trimEnd().endsWith('}'), 'isWaitingOnOpponent 抽壞');
  assert.ok(WOO_SRC.length > 500 && WOO_SRC.trimEnd().endsWith('}'), '_waitingOnOpp 抽壞');
  // 抽到的必須是「真的那一段」——三個只出現在該段的錨點
  assert.ok(IV_BODY.includes('decideStuckSelfHeal({'), 'interval body 裡沒有自癒決策');
  assert.ok(IV_BODY.includes('oppInactivityWarn ='), 'interval body 裡沒有閒置 banner');
  assert.ok(PWR_SRC.includes('_unpushedState = st;'), 'pushWithRetry 抽到的不是那一支');
  assert.ok(HELPERS_SRC.length > 600, 'v6.248 的中央 helper 只抽到 ' + HELPERS_SRC.length + ' 字元');
  assert.ok(CRG_SRC.includes('RESYNC_FULL_RATE_ROUNDS'), 'casualResyncGapMs 抽到的不是那一支');
});
T('[自我驗證/反對照] 抽取器抓錯錨點時會丟例外（不是靜默回空字串）', () => {
  assert.throws(() => fnSrc(GP, 'function 這個函式不存在('), /找不到錨點/);
});

const ts = async (c) => (await transform(c, { loader: 'ts', format: 'cjs', target: 'node20' })).code;
function loadFn(cjs) { const m = { exports: {} }; new Function('module', 'exports', cjs)(m, m.exports); return m.exports._f; }
const isWaitingOnOpponent = loadFn(await ts('export const _f = (' + IWO_SRC.replace(/^function\s+\w+/, 'function') + ');'));
const casualResyncGapMs = loadFn(await ts('export const _f = (() => {\n' + CRG_SRC + '\nreturn casualResyncGapMs; })();'));
const waitingOnOppServer = loadFn(await ts('export const _f = (' + WOO_SRC.replace(/^function\s+\w+/, 'function') + ');'));

/** 把 interval / pushWithRetry 的原始碼編成可實跑的函式。mutate() 可先改原始碼（突變測試用）。 */
async function buildRunners(mutate) {
  const ivSrc = mutate ? mutate(IV_BODY, 'interval') : IV_BODY;
  const pwrSrc = mutate ? mutate(PWR_SRC, 'push') : PWR_SRC;
  const helperSrc = mutate ? mutate(HELPERS_SRC, 'helpers') : HELPERS_SRC;
  return {
    runInterval: new Function('S', 'with (S) {\n' + (await ts(ivSrc)) + '\n}'),
    mkPushWithRetry: new Function('S', 'with (S) {\n' + (await ts(pwrSrc)) + '\nreturn pushWithRetry; }'),
    // ⭐v6.248 推送的在途標記已收斂到中央 helper，模擬世界也要用**真的那幾支**
    mkHelpers: new Function('S', 'with (S) {\n' + (await ts(helperSrc))
      + '\nreturn { pushTracked, pushUndoTracked, hasFreshPushInFlight, oldestPushInFlightAgeMs, _resetPushTracking }; }'),
  };
}
const REAL = await buildRunners(null);

// ══════════════════════════════════════════════════════════════════════════
// 1. 虛擬時鐘 ＋ 模擬世界（伺服器 / 我方 client / 對手 client）
// ══════════════════════════════════════════════════════════════════════════
function mkClock() {
  let now = 1000000; const timers = []; let seq = 0;
  return {
    get now() { return now; }, Date: { now: () => now },
    setTimeout(fn, ms) { const h = { at: now + (ms || 0), fn, id: ++seq }; timers.push(h); return h.id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        if (timers.length && timers[0].at <= target) {
          const t = timers.shift(); now = t.at; t.fn();
          for (let i = 0; i < 20; i++) await Promise.resolve();
        } else { now = target; break; }
      }
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
function mkGS(o = {}) {
  return {
    id: o.id ?? 'G1', createdAt: 1000, phase: o.phase ?? 'playing',
    log: Array.from({ length: o.logLen ?? 10 }, (_, i) => ({ msg: 'l' + i })),
    setupDone: o.setupDone ?? [true, true], pendingPrizes: o.pendingPrizes ?? [0, 0],
    pendingSelection: o.pendingSelection ?? null, firstPlayerIdx: 0, activePlayerIndex: o.active ?? 0,
    players: [
      { name: 'P0', active: o.a0 === null ? null : {}, bench: [{}], prizes: [], deck: [] },
      { name: 'P1', active: o.a1 === null ? null : {}, bench: [{}], prizes: [], deck: [] },
    ],
  };
}
/**
 * @param o.pushOutcome 'ok' | 'timeout'  這一發推送最後會怎樣
 * @param o.pushMs      這一發推送要花多久（虛擬毫秒）
 */
function mkWorld(o = {}) {
  const clk = mkClock();
  const W = { clk, server: { gs: mkGS({ logLen: 10 }), version: 5 }, log: [], pushCalls: 0,
    pushOutcome: o.pushOutcome ?? 'ok', pushMs: o.pushMs ?? 200 };
  W.pushGameState = (code, st) => new Promise((res, rej) => {
    const snap = clone(st); W.pushCalls++;
    const outcome = W.pushOutcome, ms = W.pushMs;
    clk.setTimeout(() => {
      if (outcome === 'ok') {
        // 推端 shouldSkipStalePush 的等價（同局 playing 且 log 嚴格較短才略過）
        if (!(snap.log.length < W.server.gs.log.length)) W.server = { gs: snap, version: W.server.version + 1 };
        res();
      } else {
        const e = new Error('連線逾時'); e.oracleTimeout = true; rej(e);
      }
    }, ms);
  });
  return W;
}
function mkClient(W, seat, o = {}, runners = REAL) {
  const clk = W.clk;
  const S = {
    roomCode: 'ROOM1', game: o.game === undefined ? clone(W.server.gs) : o.game,
    mySeatIdx: seat, myPlayerIndex: seat, roomData: { idleTimeoutSec: o.idleTimeoutSec ?? 180 },
    oppInactivityWarn: false, _lastActionAt: clk.now, _lastSyncAt: clk.now, _lastResyncAt: 0,
    _forceAdoptNext: false, _unpushedState: null, _repushAttempts: 0,
    // ⭐v6.248：逐發計時的標記陣列（取代 v6.247 的 _pushInFlight / _pushInFlightSince）
    _pushInFlightMarks: [], _resyncStreak: 0,
    PUSH_INFLIGHT_FAILSAFE_MS: o.failsafeMs ?? 1500750, casualResyncGapMs,
    ORACLE_API_TIMEOUT_MAX_MS: 120000,
    unsubRoom: null, casualWaitingSelfInput: () => false, PUSH_RETRY_MAX: 3,
    Date: clk.Date, setTimeout: (f, ms) => clk.setTimeout(f, ms), Math,
    console: { warn: (...a) => W.log.push('WARN ' + a.join(' ')), error: (...a) => W.log.push('ERR ' + a.join(' ')), log: () => {} },
    isWaitingOnOpponent,
    decideStuckSelfHeal: (ctx) => {
      const max = ctx.maxRepushAttempts ?? 2;
      return (ctx.hasUnpushedLocal && ctx.repushAttempts < max) ? { kind: 'repush' } : { kind: 'force-adopt' };
    },
    pushGameState: (c, st) => W.pushGameState(c, st),
    pushUndoRollback: (c, st) => W.pushGameState(c, st),
    isOracleTimeout: (e) => !!(e && e.oracleTimeout === true),
    subscribeRoom: () => { S._resubs++; return () => {}; },
    handleRoomUpdate: () => {}, _resubs: 0, _adopts: 0,
  };
  Object.assign(S, runners.mkHelpers(S));
  S.pushWithRetry = runners.mkPushWithRetry(S);
  S.setGame = (g) => {                                  // $effect(1) 的等價
    const prev = S.game?.log?.length ?? -1; S.game = g; const n = g?.log?.length ?? 0;
    if (n !== prev) { S._lastSyncAt = clk.Date.now(); if (n > prev) { S._lastActionAt = clk.Date.now(); S.oppInactivityWarn = false; } }
  };
  S.poll = () => {                                      // oraclePollRoom + handleRoomUpdate 的等價
    const inc = W.server.gs;
    if (S._forceAdoptNext) {
      S._forceAdoptNext = false;
      if (inc.phase !== 'setup' && (!S.game || S.game.id === inc.id)) { S._adopts++; S.setGame(clone(inc)); return 'force-adopt'; }
    }
    if (!S.game) return 'no-local';
    if ((inc.log?.length ?? 0) < (S.game.log?.length ?? 0)) return 'reject';
    if ((inc.log?.length ?? 0) === (S.game.log?.length ?? 0)) return 'equal';
    S.setGame(clone(inc)); return 'adopt';
  };
  S.localAct = (n, mut) => { const g = clone(S.game); for (let i = 0; i < n; i++) g.log.push({ msg: 'x' }); if (mut) mut(g); S.setGame(g); return g; };
  S.tick = () => runners.runInterval(S);
  return S;
}

/**
 * 場景：我攻擊（本地回合結束）→ 推送很慢 → 觀察本地盤面有沒有被退回。
 * @returns { rolledBack, timeline, adopts, pushCalls, resubs, finalLocal, serverLen }
 */
async function runSlowPush({ pushOutcome, pushMs, endTurn = true, runners = REAL, totalMs = 200000, failsafeMs }) {
  const W = mkWorld({ pushOutcome, pushMs });
  const me = mkClient(W, 0, { failsafeMs }, runners);
  const g = clone(me.game); g.log.push({ msg: 'attack' });
  if (endTurn) g.activePlayerIndex = 1;
  me.setGame(g); me.pushWithRetry('ROOM1', g);
  const peak = g.log.length; let low = peak; const timeline = []; let prev = peak;
  let adoptsEarly = 0;   // ⭐「這一發推送還沒落地就發生的 force-adopt」＝會把玩家的手退回去的那些
  for (let e = 0; e <= totalMs; e += 1000) {
    await W.clk.advance(1000);
    if (e % 5000 === 0) { me.tick(); const before = me._adopts; me.poll(); if (e < pushMs && me._adopts > before) adoptsEarly++; }
    const L = me.game?.log?.length ?? -1;
    if (L !== prev) { timeline.push('t=' + e / 1000 + 's ' + prev + '->' + L); prev = L; }
    if (L < low) low = L;
  }
  return { rolledBack: low < peak, low, peak, timeline, adopts: me._adopts, adoptsEarly, pushCalls: W.pushCalls,
    resubs: me._resubs, finalLocal: me.game.log.length, serverLen: W.server.gs.log.length, me };
}

// ══════════════════════════════════════════════════════════════════════════
// 2. ⭐核心 [HEAD-FAIL]：推送在途時盤面不得被退回
// ══════════════════════════════════════════════════════════════════════════
await TA('[HEAD-FAIL①] 48KB 推送 87 秒後成功（v6.245 實測案例）⇒ 本地盤面全程不退回', async () => {
  const r = await runSlowPush({ pushOutcome: 'ok', pushMs: 87000 });
  assert.equal(r.rolledBack, false,
    '盤面被退回了（' + r.low + '<' + r.peak + '），時間軸：' + (r.timeline.join(' , ') || '(無)'));
  assert.equal(r.adoptsEarly, 0, 'force-adopt 竟然在推送還在途中時發動了 ' + r.adoptsEarly + ' 次');
  assert.equal(r.serverLen, r.peak, '推送最後沒有送達伺服器');
});
await TA('[HEAD-FAIL②] 4KB 推送 40 秒後成功 ⇒ 同樣不退回（30 秒預算也在 25 秒門檻之後）', async () => {
  const r = await runSlowPush({ pushOutcome: 'ok', pushMs: 40000 });
  assert.equal(r.rolledBack, false, '時間軸：' + (r.timeline.join(' , ') || '(無)'));
  assert.equal(r.adoptsEarly, 0, 'adoptsEarly=' + r.adoptsEarly);
});
await TA('[HEAD-FAIL③] 推送真的逾時（120 秒預算）⇒ v6.212 的重推**這次真的發動得了**', async () => {
  const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 120000, totalMs: 300000 });
  assert.ok(r.me._repushAttempts > 0 || r.pushCalls > 1,
    '推送落地後仍沒有走到重推（pushCalls=' + r.pushCalls + '）—— v6.212 的保護還是沒發動');
});
await TA('[正對照/不可退化] 推送逾時且重推額度用完 ⇒ 仍會 force-adopt（自癒不可變成永不同步）', async () => {
  const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 30000, totalMs: 300000 });
  assert.ok(r.adopts >= 1, '額度用完之後竟然完全不 force-adopt ⇒ 會永遠不同步（adopts=' + r.adopts + '）');
});

// ══════════════════════════════════════════════════════════════════════════
// 3. ⭐硬約束：force-adopt 不得在「我的回合中途」觸發
// ══════════════════════════════════════════════════════════════════════════
await TA('[硬約束①] 我的回合中途（不結束回合）推送失敗 ⇒ 全程不得 force-adopt、不得退回', async () => {
  for (const outcome of ['timeout', 'ok']) {
    const r = await runSlowPush({ pushOutcome: outcome, pushMs: outcome === 'timeout' ? 30000 : 87000,
      endTurn: false, totalMs: 300000 });
    assert.equal(r.adopts, 0, '(' + outcome + ') 我方回合中途竟然 force-adopt 了 ' + r.adopts + ' 次');
    assert.equal(r.rolledBack, false, '(' + outcome + ') 我方回合中途盤面被退回');
  }
});
T('[硬約束②] isWaitingOnOpponent 在「我的回合、我在操作」時必須是 false（force-adopt 的唯一防線）', () => {
  assert.equal(isWaitingOnOpponent(mkGS({ active: 0 }), 0), false, '我的回合竟然判成等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 0, a0: null }), 0), false, '我要補位時竟然判成等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 1, pendingSelection: { actorIdx: 0 } }), 0), false,
    '對手回合但輪到我選，竟然判成等對手');
  // 正對照：真的在等對手時必須是 true，否則自癒整條失效
  assert.equal(isWaitingOnOpponent(mkGS({ active: 1 }), 0), true, '對手回合竟然判成不等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 0, a1: null }), 0), true, '對手要補位時應算等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 0, pendingPrizes: [0, 1] }), 0), true, '對手待拿獎賞應算等對手');
});

// ══════════════════════════════════════════════════════════════════════════
// 4. ⭐正對照：健康對局 —— 這段 interval 一發請求都不送、盤面一次都不動
// ══════════════════════════════════════════════════════════════════════════
await TA('[正對照] 對手每 20 秒動一次的健康對局：0 次推送 / 0 次 force-adopt / 0 次重訂閱', async () => {
  const W = mkWorld({}); const me = mkClient(W, 0);
  for (let e = 0; e <= 300000; e += 5000) {
    await W.clk.advance(5000);
    if (e % 20000 === 0) { const g = clone(W.server.gs); g.log.push({ msg: 'opp' }); W.server = { gs: g, version: W.server.version + 1 }; }
    me.tick(); me.poll();
  }
  assert.equal(W.pushCalls, 0, 'interval 竟然自己發了 ' + W.pushCalls + ' 次推送');
  assert.equal(me._adopts, 0, '健康對局竟然 force-adopt');
  assert.equal(me._resubs, 0, '健康對局竟然重訂閱 ' + me._resubs + ' 次（＝多打伺服器）');
  assert.equal(me.oppInactivityWarn, false, '健康對局竟然跳棄權提示');
});
await TA('[正對照] 對手真的掛機 3 分鐘 ⇒ 棄權提示照跳（棄權語意一字不可變）', async () => {
  const W = mkWorld({});
  const me = mkClient(W, 0, { game: mkGS({ active: 1 }) });
  for (let e = 0; e <= 200000; e += 5000) { await W.clk.advance(5000); me.tick(); }
  assert.equal(me.oppInactivityWarn, true, '對手掛機超過門檻竟然不跳棄權提示');
});
T('[正對照] 25 秒門檻／8 秒重訂閱／棄權門檻讀房間設定，三個既有行為的字面都還在', () => {
  assert.ok(/\(Date\.now\(\) - _lastSyncAt\) >= 25000/.test(GP), '25 秒門檻不見了');
  assert.ok(/\(Date\.now\(\) - _lastSyncAt\) >= 8000/.test(GP), '8 秒重訂閱門檻不見了');
  assert.ok(/setInterval\(\(\) => \{[\s\S]{200,}?\}, 5000\);/.test(GP), 'interval 不是 5 秒了（跳動頻率不可變）');
  assert.ok(/roomData\?\.idleTimeoutSec \?\? 180/.test(GP), '棄權門檻不再讀房間設定');
});

// ══════════════════════════════════════════════════════════════════════════
// 5. 接線（有寫 ≠ 接上了）
// ══════════════════════════════════════════════════════════════════════════
T('[HEAD-FAIL④] ORACLE_API_TIMEOUT_MAX_MS 真的 import 了（漏 import ＝ runtime ReferenceError）', () => {
  assert.ok(/import\s*\{[^}]*\bORACLE_API_TIMEOUT_MAX_MS\b[^}]*\}\s*from\s*'\$lib\/game\/oracle-client'/.test(GP),
    '沒有從 oracle-client import ORACLE_API_TIMEOUT_MAX_MS');
  assert.ok(/export const ORACLE_API_TIMEOUT_MAX_MS\s*=/.test(OC), 'oracle-client 沒有匯出這個常數');
});
await TA('[HEAD-FAIL④b] 三個新識別字真的在**模組層級**有繫結（acorn 掃 scope，不是字串比對）', async () => {
  const acorn = await import('acorn');
  const esbuild = await import('esbuild');
  const m = GP.match(/<script lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, '抽不到 <script lang="ts"> 區塊');
  const js = esbuild.transformSync(m[1], { loader: 'ts' }).code;
  const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
  const top = new Set();
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') for (const sp of n.specifiers) top.add(sp.local.name);
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') top.add(d.id.name);
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) top.add(n.id.name);
  }
  // ⭐v6.248 改名：_pushInFlight/_pushInFlightSince → _pushInFlightMarks（逐發計時）
  for (const id of ['ORACLE_API_TIMEOUT_MAX_MS', '_pushInFlightMarks', 'pushTracked']) {
    assert.ok(top.has(id), id + ' 在模組層級沒有繫結 ⇒ 執行時會 ReferenceError（tsc -p 掃不到 .svelte）');
  }
  // 正對照：這個掃描抓得到「不存在的名字」，不是恆真
  assert.equal(top.has('這個名字絕對不存在'), false, '正對照失效');
});
T('[HEAD-FAIL⑤/v6.248 搬家] 中央 pushTracked 的標記還原寫在 finally（否則拋錯就永久留著）', () => {
  assert.ok(/try \{ await pushGameState\(code, st\); \} finally \{ _endPushTrack\(m\); \}/.test(HELPERS_SRC),
    'pushTracked 沒有用 finally 還原在途標記');
  assert.ok(/await pushTracked\(code, st\);/.test(PWR_SRC), 'pushWithRetry 沒有走中央 pushTracked');
});
T('[HEAD-FAIL⑥/v6.248 搬家] 自癒重推也走中央 pushTracked（否則會併發送兩份 48KB）', () => {
  assert.ok(/pushTracked\(roomCode, _st\)/.test(IV_BODY), '重推分支沒有走中央 pushTracked');
  assert.ok(!/(?<![\w.])pushGameState\s*\(/.test(IV_BODY), 'interval 裡還有裸的 pushGameState 呼叫（漏標在途）');
});
T('[HEAD-FAIL⑦/v6.248 搬家] 在途判定有上限（fail-safe）：不可寫成無條件延後', () => {
  assert.ok(/const _pushStillInFlight = hasFreshPushInFlight\(\);/.test(IV_BODY),
    '在途判定不是走中央述詞 hasFreshPushInFlight()');
  const h = fnSrc(GP, 'function hasFreshPushInFlight(');
  assert.ok(/\(now - m\.at\) < PUSH_INFLIGHT_FAILSAFE_MS/.test(h),
    '在途判定沒有帶時間上限 ⇒ 標記一旦沒還原就永遠不自癒（fail-open）');
  assert.ok(!/Infinity|Number\.MAX/.test(h), '上限不可以是無限大');
});
T('[回歸] v6.212 的既有不變量沒被動到', () => {
  const B0 = GP.indexOf('v6.212 SELFHEAL DIRECTION BLOCK BEGIN');
  const B1 = GP.indexOf('v6.212 SELFHEAL DIRECTION BLOCK END');
  assert.ok(B0 > 0 && B1 > B0, '自癒方向區塊定位不到');
  const seg = GP.slice(B0, B1);
  assert.equal((seg.match(/_forceAdoptNext\s*=\s*true/g) || []).length, 1,
    '區塊內 _forceAdoptNext = true 不再只有一次');
  assert.ok(/decideStuckSelfHeal\(\{/.test(seg), '不再走中央決策');
  assert.ok(/_repushAttempts\+\+/.test(seg), '重推不再計次 ⇒ 上限形同虛設');
});

// ══════════════════════════════════════════════════════════════════════════
// 6. ⭐突變測試 —— 每一個都要「紅在指定的那一條」，不可用無差別 try/catch
// ══════════════════════════════════════════════════════════════════════════
/** 跑一個突變版，回傳指定檢查的結果（true=通過）。⚠ 只捕捉 assert.AssertionError，其它照樣往上丟。 */
async function mutantCheck(mutate, probe) {
  const runners = await buildRunners(mutate);
  try { await probe(runners); return { passed: true }; }
  catch (e) {
    if (e instanceof assert.AssertionError) return { passed: false, why: e.message };
    throw e;                    // 工具鏈壞掉不可以被當成「突變被抓到」
  }
}
const mutOnce = (needle, repl) => (src) => {
  if (!src.includes(needle)) return src;
  return src.replace(needle, repl);
};
const probeNoRollback = async (runners) => {
  const r = await runSlowPush({ pushOutcome: 'ok', pushMs: 87000, runners });
  assert.equal(r.rolledBack, false, 'rolledBack');
  assert.equal(r.adoptsEarly, 0, 'adoptsEarly=' + r.adoptsEarly);
};
const probeMidTurnNoAdopt = async (runners) => {
  const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 30000, endTurn: false, totalMs: 300000, runners });
  assert.equal(r.adopts, 0, '我方回合中途 force-adopt 了');
};
const probeStillAdoptsEventually = async (runners) => {
  const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 30000, totalMs: 300000, runners });
  assert.ok(r.adopts >= 1, 'adopts=' + r.adopts);
};

await TA('[突變1] 拿掉 `&& !_pushStillInFlight` ⇒ [HEAD-FAIL①] 必須翻紅（其它條不受影響）', async () => {
  const m = mutOnce('(Date.now() - _lastSyncAt) >= 25000 && !_pushStillInFlight',
                    '(Date.now() - _lastSyncAt) >= 25000');
  const a = await mutantCheck(m, probeNoRollback);
  assert.equal(a.passed, false, '把修法拿掉了，核心斷言卻還是綠的 ⇒ 這支守衛是安慰劑');
  assert.ok(/rolledBack|adoptsEarly/.test(a.why), '紅的不是預期那一條，而是：' + a.why);
  // 同一個突變**不該**害到「最終仍會 force-adopt」那一條（證明突變是點狀的）
  const b = await mutantCheck(m, probeStillAdoptsEventually);
  assert.equal(b.passed, true, '突變1 連不相干的斷言也弄紅了 ⇒ 定位不準：' + b.why);
});
await TA('[突變2] 拿掉 isWaitingOnOpponent 這道 gate ⇒ [硬約束①] 必須翻紅', async () => {
  const m = mutOnce('if (!isWaitingOnOpponent(game, mySeatIdx)) { oppInactivityWarn = false; return; }',
                    'if (false) { oppInactivityWarn = false; return; }');
  const a = await mutantCheck(m, probeMidTurnNoAdopt);
  assert.equal(a.passed, false, 'gate 被拿掉，我方回合中途卻還是不會 force-adopt ⇒ 硬約束守衛是假的');
  assert.ok(/中途 force-adopt/.test(a.why), '紅的不是預期那一條：' + a.why);
});
await TA('[突變3/v6.248 搬家] 把 pushTracked 的 finally 還原拿掉（標記洩漏）⇒ 上限仍讓自癒恢復', async () => {
  const m = (src, kind) => (kind === 'helpers'
    ? src.replace('try { await pushGameState(code, st); } finally { _endPushTrack(m); }', 'await pushGameState(code, st);')
    : src);
  // ⚠ v6.248 起真實上限是 ORACLE_TX_MAX_TOTAL_MS（約 25 分鐘，＝ oracleTx 的真實最壞總時長），
  //   遠大於這個 300 秒的模擬窗口 ⇒ 這裡把模擬的上限縮成 40 秒，驗的是**機制**（上限一到就恢復自癒），
  //   上限「是有限值而且大於單發預算」另有字面斷言（HEAD-FAIL⑦）與 v6.248 守衛把關。
  const a = await mutantCheck(m, async (runners) => {
    const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 30000, totalMs: 300000, runners, failsafeMs: 40000 });
    assert.ok(r.adopts >= 1, 'adopts=' + r.adopts);
  });
  assert.equal(a.passed, true,
    '標記洩漏後就永遠不自癒了 ⇒ 上限沒有發揮 fail-safe 作用：' + a.why);
  // 而且標記洩漏**確實**發生了（證明這個突變真的生效，不是沒改到）
  const b = await mutantCheck(m, async (runners) => {
    const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 30000, totalMs: 300000, runners });
    assert.equal(r.me._pushInFlightMarks.length, 0, 'marks=' + r.me._pushInFlightMarks.length);
  });
  assert.equal(b.passed, false, '突變3 根本沒改到程式碼（標記居然還是清乾淨的）');
});
await TA('[突變4/v6.248 搬家] 把在途判定的時間上限改成無條件 ⇒ 「最終仍會 force-adopt」必須翻紅', async () => {
  // 這個突變要配「標記會洩漏」才看得出差別 ⇒ 兩個突變一起上
  const m2 = (src, kind) => {
    if (kind !== 'helpers') return src;
    return src
      .replace('(now - m.at) < PUSH_INFLIGHT_FAILSAFE_MS', 'true')
      .replace('try { await pushGameState(code, st); } finally { _endPushTrack(m); }', 'await pushGameState(code, st);');
  };
  const a = await mutantCheck(m2, async (runners) => {
    const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 30000, totalMs: 300000, runners, failsafeMs: 40000 });
    assert.ok(r.adopts >= 1, 'adopts=' + r.adopts);
  });
  assert.equal(a.passed, false, '拿掉上限＋標記洩漏之後竟然還會自癒 ⇒ 上限那一段根本沒接上');
  assert.ok(/adopts=0/.test(a.why), '紅的不是預期那一條：' + a.why);
});

// ══════════════════════════════════════════════════════════════════════════
// 7. 已知缺口的現況鎖（不是修，是記錄「現在就是這樣」）
// ══════════════════════════════════════════════════════════════════════════
await TA('[現況鎖] 中途推送失敗期間，伺服器端的棄權再驗證會核准 —— 這條缺口仍在（v6.247 未修）', async () => {
  const W = mkWorld({ pushOutcome: 'timeout', pushMs: 30000 });
  const me = mkClient(W, 0); const opp = mkClient(W, 1);
  const st = me.localAct(1); me.pushWithRetry('ROOM1', st);
  for (let e = 0; e <= 200000; e += 5000) { await W.clk.advance(5000); me.tick(); opp.tick(); opp.poll(); }
  assert.equal(opp.oppInactivityWarn, true, '對手端沒有跳出棄權提示（情境沒建立起來）');
  assert.equal(waitingOnOppServer(W.server.gs, 1), true,
    '伺服器端再驗證改成會擋了 —— 那是好事，但這條現況鎖要一併更新');
});

console.log('\n=== v6.247 自癒在途延後 / force-adopt 硬約束: ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
