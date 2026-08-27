#!/usr/bin/env node
/**
 * v6.248 守衛：獨立審查者複驗 v6.247 後找到的六個問題。
 *
 * ── 這一版在修什麼（每一條都對應一個實測，不是讀碼推論）──────────────────────
 * 【1】自癒仍留在 `isWaitingOnOpponent` gate 底下 —— **刻意不拆**，理由量過（見下方現況鎖）。
 * 【2】v6.247 的在途上限用 `ORACLE_API_TIMEOUT_MAX_MS`（120 秒）＝**假陰性**。
 *      120 秒是**單一發 HTTP 請求**的預算，而一發 pushGameState 走 `oracleTx`
 *      （最多 5 輪 GET＋PUT，每一發還可能因 401 再重登重送一次）
 *      ⇒ 真實最壞總時長是 `ORACLE_TX_MAX_TOTAL_MS`。
 *      實測 pushMs=150s：舊上限在 t=120s 放行 force-adopt ⇒ `11→10`（回捲）、`10→11`（翻覆）。
 * 【3】`_pushInFlightSince` 只在 0→1 時更新 ⇒ 重疊推送凍結時間戳、保護靜默過期。
 * 【4】全站 5 個盤面推送呼叫點，v6.247 只標記了 2 個 ⇒ 收斂到 pushTracked()/pushUndoTracked()。
 * 【5】換局的 $effect 沒有重設在途追蹤 ⇒ 上一局的在途會壓住新局。
 * 【7】卡住期間的重訂閱每次都讓 oraclePollRoom 全量重抓 ⇒ 加退避（但**不可**削弱脫困能力）。
 *
 * ── 怎麼驗（不是只驗字串存在）──────────────────────────────────────────────
 * 從 `src/routes/game/+page.svelte` 抽出**真的原始碼**（5 秒 interval、pushWithRetry、
 * isWaitingOnOpponent、在途追蹤的六支 helper），從 `sync-guards.ts` 抽出真的
 * `decideStuckSelfHeal` / `casualResyncGapMs`，用 esbuild 轉成 JS、`with(state)` 綁模擬狀態，
 * 配**虛擬時鐘**實跑。
 *   [HEAD-FAIL] 對 v6.247 的原始碼跑必定紅。
 *   [硬約束]    force-adopt 不得在「我的回合中途」觸發（行為端）。
 *   [現況鎖]    棄權誤判、以及「自癒仍在 gate 底下」＝**站長裁定的現狀**，不是待辦。
 *   [突變]      斷言「紅在指定的那一條」；⚠ 只捕捉 assert.AssertionError，其它例外照丟。
 *
 * Run: node scripts/test-v6248-selfheal-followups.mjs
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
const SG = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
const CL = readFileSync(join(ROOT, 'static/changelog.html'), 'utf8');
const AR = readFileSync(join(ROOT, 'static/changelog-archive.html'), 'utf8');

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const TA = async (n, f) => { try { await f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ══════════════════════════════════════════════════════════════════════════
// 0. 抽取器（Rule 25：掃描器自身先驗，抽不到一律中止，禁 fail-open）
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
const HELPER_ANCHORS = [
  'function _beginPushTrack(', 'function _endPushTrack(', 'function hasFreshPushInFlight(',
  'function oldestPushInFlightAgeMs(', 'function _resetPushTracking(',
  'async function pushTracked(', 'async function pushUndoTracked(',
];
const HELPERS_SRC = HELPER_ANCHORS.map((a) => fnSrc(GP, a)).join('\n');
const DSH_SRC = fnSrc(SG, 'export function decideStuckSelfHeal(').replace(/^export /, '');
const CRG_CONSTS = ['RESYNC_BASE_MS', 'RESYNC_FULL_RATE_ROUNDS', 'RESYNC_MAX_MS'].map((k) => {
  const m = new RegExp('export const ' + k + ' = \\d+;').exec(SG);
  if (!m) throw new Error('抽不到常數 ' + k + ' —— 守衛不可 fail-open');
  return m[0].replace(/^export /, '');
}).join('\n');
const CRG_SRC = CRG_CONSTS + '\n' + fnSrc(SG, 'export function casualResyncGapMs(').replace(/^export /, '');
// 換局 $effect 裡「重設基準」那一段（【5】）
const NEWGAME_SEG = (() => {
  const i = GP.indexOf('if (gid !== _prevGameId) {');
  if (i < 0) throw new Error('抽不到換局重設區塊');
  const [o, c] = blockAfter(GP, i + 'if (gid !== _prevGameId)'.length);
  return GP.slice(o, c);
})();

T('[自我驗證] 抽取器真的抽到東西（抽爆／抽半截就不可以放行）', () => {
  assert.ok(IV_BODY.length > 2000, 'interval body 只有 ' + IV_BODY.length + ' 字元');
  assert.ok(PWR_SRC.length > 800, 'pushWithRetry 只有 ' + PWR_SRC.length + ' 字元');
  assert.ok(IWO_SRC.length > 700 && IWO_SRC.trimEnd().endsWith('}'), 'isWaitingOnOpponent 抽壞');
  assert.ok(HELPERS_SRC.length > 600, '在途追蹤 helper 只抽到 ' + HELPERS_SRC.length + ' 字元');
  assert.ok(DSH_SRC.includes("kind: 'repush'"), 'decideStuckSelfHeal 抽到的不是那一支');
  assert.ok(CRG_SRC.includes('RESYNC_FULL_RATE_ROUNDS'), 'casualResyncGapMs 抽到的不是那一支');
  assert.ok(NEWGAME_SEG.includes('_prevLogLen = logLen;'), '換局區塊抽到的不是那一段');
  assert.ok(IV_BODY.includes('decideStuckSelfHeal({'), 'interval body 裡沒有自癒決策');
  assert.ok(IV_BODY.includes('oppInactivityWarn ='), 'interval body 裡沒有閒置 banner');
  assert.ok(PWR_SRC.includes('_unpushedState = st;'), 'pushWithRetry 抽到的不是那一支');
});
T('[自我驗證/反對照] 抽取器抓錯錨點時會丟例外（不是靜默回空字串）', () => {
  assert.throws(() => fnSrc(GP, 'function 這個函式不存在('), /找不到錨點/);
  assert.throws(() => fnSrc(SG, 'export function 也不存在('), /找不到錨點/);
});

const ts = async (c) => (await transform(c, { loader: 'ts', format: 'cjs', target: 'node20' })).code;
function loadFn(cjs) { const m = { exports: {} }; new Function('module', 'exports', cjs)(m, m.exports); return m.exports._f; }
const isWaitingOnOpponent = loadFn(await ts('export const _f = (' + IWO_SRC.replace(/^function\s+\w+/, 'function') + ');'));
const decideStuckSelfHeal = loadFn(await ts('export const _f = (' + DSH_SRC.replace(/^function\s+\w+/, 'function') + ');'));
const wrapGap = (src) => 'export const _f = (() => {\n' + src + '\nreturn casualResyncGapMs; })();';
const casualResyncGapMs = loadFn(await ts(wrapGap(CRG_SRC)));

// ══════════════════════════════════════════════════════════════════════════
// 1. 【2】上限的推導（掃 oracleTx / oracleApi 的真原始碼，改了就紅）
// ══════════════════════════════════════════════════════════════════════════
function num(src, re, what) {
  const m = re.exec(src);
  assert.ok(m, '抽不到「' + what + '」—— 掃描器壞了或原始碼改寫了，不可 fail-open');
  return Number(m[1]);
}
T('[HEAD-FAIL①/掃描器] ORACLE_TX_MAX_TOTAL_MS 必須等於 oracleTx 真原始碼推導出來的最壞總時長', () => {
  // ① oracleTx 的輪數
  const attempts = num(RO, /for \(let attempt = 0; attempt < (\d+); attempt\+\+\)/, 'oracleTx 的迴圈上限');
  // ② 409 退避：`50 * (attempt + 1)`，逐輪加總
  const bo = /setTimeout\(r, (\d+) \* \(attempt \+ 1\)\)/.exec(RO);
  assert.ok(bo, '抽不到 409 退避');
  let backoff = 0;
  for (let a = 0; a < attempts; a++) backoff += Number(bo[1]) * (a + 1);
  // ③ oracleApi 的 401 遞迴重試（一次）
  assert.ok(/if \(res\.status === 401 && _retry\)/.test(OC), 'oracleApi 的 401 重試判斷不見了');
  assert.ok(/return oracleApi<T>\(path, options, false\);/.test(OC), '401 重試不再是「只遞迴一次」');
  const authRetries = 1;
  // ④ 每輪 = GET（無 body ⇒ 基底預算）＋ PUT（大 body ⇒ 上限預算）
  const base = num(OC, /export const ORACLE_API_TIMEOUT_MS = (\d+);/, '基底預算');
  const max = num(OC, /export const ORACLE_API_TIMEOUT_MAX_MS = (\d+);/, '上限預算');
  const expect = attempts * (base + max) * (1 + authRetries) + backoff;
  const declared = num(OC, /export const ORACLE_TX_MAX_TOTAL_MS[\s\S]{0,400}?/.source
    ? /export const ORACLE_TX_MAX_ATTEMPTS = (\d+);/ : null, 'ORACLE_TX_MAX_ATTEMPTS');
  assert.equal(declared, attempts, 'ORACLE_TX_MAX_ATTEMPTS 與 oracleTx 的迴圈上限不一致');
  const declBackoff = num(OC, /export const ORACLE_TX_CONFLICT_BACKOFF_TOTAL_MS = (\d+);/, '退避總和');
  assert.equal(declBackoff, backoff, '宣告的退避總和 ' + declBackoff + ' ≠ 實際 ' + backoff);
  const declAuth = num(OC, /export const ORACLE_API_MAX_AUTH_RETRIES = (\d+);/, '401 重試次數');
  assert.equal(declAuth, authRetries);
  assert.equal(attempts * (base + max) * (1 + declAuth) + declBackoff, expect);
  assert.ok(expect > max, '推導出來的上限竟然沒有比單發預算大 ⇒ 又退回 v6.247 的假陰性');
  console.log('   推導：' + attempts + ' 輪 ×（GET ' + base + ' + PUT ' + max + '）×（1+' + authRetries
    + ' 次 401 重登）+ 退避 ' + backoff + ' = ' + expect + ' ms（' + (expect / 60000).toFixed(2) + ' 分鐘）');
});
T('[HEAD-FAIL②] +page.svelte 的在途上限接到新常數，而且是「有限值」（fail-safe，不可無限大）', () => {
  assert.ok(/import\s*\{[^}]*\bORACLE_TX_MAX_TOTAL_MS\b[^}]*\}\s*from\s*'\$lib\/game\/oracle-client'/.test(GP),
    '沒有從 oracle-client import ORACLE_TX_MAX_TOTAL_MS');
  assert.ok(/const PUSH_INFLIGHT_FAILSAFE_MS = Math\.max\(ORACLE_TX_MAX_TOTAL_MS, ORACLE_API_TIMEOUT_MAX_MS\);/.test(GP),
    '在途上限不是由 ORACLE_TX_MAX_TOTAL_MS 推出來的');
  const h = fnSrc(GP, 'function hasFreshPushInFlight(');
  assert.ok(/\(now - m\.at\) < PUSH_INFLIGHT_FAILSAFE_MS/.test(h),
    '在途判定沒有帶時間上限 ⇒ 標記一旦沒還原就永遠不自癒（fail-open）');
  assert.ok(!/Infinity|Number\.MAX/.test(h), '上限不可以是無限大');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. 虛擬時鐘 ＋ 模擬世界
// ══════════════════════════════════════════════════════════════════════════
async function buildRunners(mutate) {
  const mut = (s, kind) => (mutate ? mutate(s, kind) : s);
  const helpers = mut(HELPERS_SRC, 'helpers');
  return {
    runInterval: new Function('S', 'with (S) {\n' + (await ts(mut(IV_BODY, 'interval'))) + '\n}'),
    mkPushWithRetry: new Function('S', 'with (S) {\n' + (await ts(mut(PWR_SRC, 'push'))) + '\nreturn pushWithRetry; }'),
    mkHelpers: new Function('S', 'with (S) {\n' + (await ts(helpers))
      + '\nreturn { pushTracked, pushUndoTracked, hasFreshPushInFlight, oldestPushInFlightAgeMs, _resetPushTracking }; }'),
    gapFn: mutate ? loadFn(await ts(wrapGap(mut(CRG_SRC, 'gap')))) : casualResyncGapMs,
    newGameSeg: mut(NEWGAME_SEG, 'newgame'),
  };
}
const REAL = await buildRunners(null);

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
function mkWorld(o = {}) {
  const clk = mkClock();
  const W = { clk, server: { gs: mkGS({ logLen: 10 }), version: 5 }, log: [], pushCalls: 0,
    pushOutcome: o.pushOutcome ?? 'ok', pushMs: o.pushMs ?? 200 };
  W.pushGameState = (code, st) => new Promise((res, rej) => {
    const snap = clone(st); W.pushCalls++;
    const outcome = W.pushOutcome, ms = W.pushMs;
    clk.setTimeout(() => {
      if (outcome === 'ok') {
        if (!(snap.log.length < W.server.gs.log.length)) W.server = { gs: snap, version: W.server.version + 1 };
        res();
      } else {
        const e = new Error('連線逾時'); e.oracleTimeout = true; rej(e);
      }
    }, ms);
  });
  W.pushUndoRollback = (code, st) => W.pushGameState(code, st);
  return W;
}
function mkClient(W, seat, o = {}, runners = REAL) {
  const clk = W.clk;
  const S = {
    roomCode: 'ROOM1', game: o.game === undefined ? clone(W.server.gs) : o.game,
    mySeatIdx: seat, myPlayerIndex: seat, roomData: { idleTimeoutSec: o.idleTimeoutSec ?? 180 },
    oppInactivityWarn: false, _lastActionAt: clk.now, _lastSyncAt: clk.now, _lastResyncAt: 0,
    _resyncStreak: 0, _forceAdoptNext: false, _unpushedState: null, _repushAttempts: 0,
    _pushInFlightMarks: [],
    PUSH_INFLIGHT_FAILSAFE_MS: o.failsafeMs ?? 1500750,
    unsubRoom: null, casualWaitingSelfInput: () => false, PUSH_RETRY_MAX: 3,
    Date: clk.Date, setTimeout: (f, ms) => clk.setTimeout(f, ms), Math,
    console: { warn: (...a) => W.log.push('WARN ' + a.join(' ')), error: (...a) => W.log.push('ERR ' + a.join(' ')), log: () => {} },
    isWaitingOnOpponent, decideStuckSelfHeal, casualResyncGapMs: runners.gapFn,
    pushGameState: (c, st) => W.pushGameState(c, st),
    pushUndoRollback: (c, st) => W.pushUndoRollback(c, st),
    isOracleTimeout: (e) => !!(e && e.oracleTimeout === true),
    subscribeRoom: () => { S._resubs++; S._resubAt.push(clk.now); return () => {}; },
    handleRoomUpdate: () => {}, _resubs: 0, _resubAt: [], _adopts: 0,
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
  S.tick = () => runners.runInterval(S);
  return S;
}
async function runSlowPush({ pushOutcome, pushMs, endTurn = true, runners = REAL, totalMs = 320000, failsafeMs }) {
  const W = mkWorld({ pushOutcome, pushMs });
  const me = mkClient(W, 0, { failsafeMs }, runners);
  const g = clone(me.game); g.log.push({ msg: 'attack' });
  if (endTurn) g.activePlayerIndex = 1;
  me.setGame(g); me.pushWithRetry('ROOM1', g);
  const peak = g.log.length; let low = peak; const timeline = []; let prev = peak;
  let adoptsEarly = 0;
  for (let e = 0; e <= totalMs; e += 1000) {
    await W.clk.advance(1000);
    if (e % 5000 === 0) { me.tick(); const before = me._adopts; me.poll(); if (e < pushMs && me._adopts > before) adoptsEarly++; }
    const L = me.game?.log?.length ?? -1;
    if (L !== prev) { timeline.push('t=' + e / 1000 + 's ' + prev + '->' + L); prev = L; }
    if (L < low) low = L;
  }
  return { rolledBack: low < peak, low, peak, timeline, adopts: me._adopts, adoptsEarly,
    pushCalls: W.pushCalls, resubs: me._resubs, resubAt: me._resubAt, finalLocal: me.game.log.length,
    serverLen: W.server.gs.log.length, me, W };
}

// ══════════════════════════════════════════════════════════════════════════
// 3. 【2】⭐核心：>120 秒的在途，盤面也不得被退回（v6.247 對這一段零覆蓋）
// ══════════════════════════════════════════════════════════════════════════
for (const sec of [150, 200, 300]) {
  await TA('[HEAD-FAIL③] 推送 ' + sec + ' 秒才送達（>120 秒）⇒ 本地盤面全程不退回', async () => {
    const r = await runSlowPush({ pushOutcome: 'ok', pushMs: sec * 1000, totalMs: sec * 1000 + 60000 });
    assert.equal(r.rolledBack, false,
      '盤面被退回了（' + r.low + '<' + r.peak + '），時間軸：' + (r.timeline.join(' , ') || '(無)'));
    assert.equal(r.adoptsEarly, 0, 'force-adopt 在推送還在途中時發動了 ' + r.adoptsEarly + ' 次');
    assert.equal(r.serverLen, r.peak, '推送最後沒有送達伺服器');
  });
}
await TA('[回歸] v6.247 已治好的 87 秒案例仍然不退回（金絲雀：base 抓錯會在這裡先亮）', async () => {
  const r = await runSlowPush({ pushOutcome: 'ok', pushMs: 87000 });
  assert.equal(r.rolledBack, false, '時間軸：' + (r.timeline.join(' , ') || '(無)'));
});
await TA('[正對照/不可退化] 推送逾時且重推額度用完 ⇒ 仍會 force-adopt（自癒不可變成永不同步）', async () => {
  const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 30000, totalMs: 300000 });
  assert.ok(r.adopts >= 1, '額度用完之後竟然完全不 force-adopt ⇒ 會永遠不同步（adopts=' + r.adopts + '）');
});

// ══════════════════════════════════════════════════════════════════════════
// 4. 【3】重疊推送不得凍結時間戳（保護不可靜默過期）
// ══════════════════════════════════════════════════════════════════════════
await TA('[HEAD-FAIL④] 兩發重疊推送：舊那發超過上限後，新那發仍要撐住保護（不是靜默過期）', async () => {
  const W = mkWorld({ pushOutcome: 'ok', pushMs: 10 ** 9 });   // 永遠不落地
  const me = mkClient(W, 0, { failsafeMs: 120000 });           // 故意用 v6.247 的 120 秒上限
  me.pushTracked('ROOM1', me.game);                            // A：t=0 起飛
  await W.clk.advance(100000);
  me.pushTracked('ROOM1', me.game);                            // B：t=100s 起飛
  await W.clk.advance(50000);                                  // t=150s：A 已 150s（過期）、B 才 50s
  assert.equal(me.hasFreshPushInFlight(), true,
    'A 過期就把整個保護關掉了 ⇒ B 明明還在飛，force-adopt 卻被放行（＝ v6.247 的凍結時間戳）');
  assert.equal(me.oldestPushInFlightAgeMs(), 150000, '最舊那一發的年齡算錯：' + me.oldestPushInFlightAgeMs());
  await W.clk.advance(80000);                                  // t=230s：B 也 130s > 120s
  assert.equal(me.hasFreshPushInFlight(), false,
    '兩發都超過上限了還說在途 ⇒ 變成 fail-open（永遠不自癒）');
});
T('[HEAD-FAIL⑤] 起始時刻是「每一發各記一次」，不是只在 0→1 時記一次', () => {
  const beg = fnSrc(GP, 'function _beginPushTrack(');
  assert.ok(/_pushInFlightMarks\.push\(m\)/.test(beg), '_beginPushTrack 沒有逐發記錄起始時刻');
  assert.ok(!/=== 1\)/.test(beg), '還留著「只有 0→1 才更新時間戳」的寫法（＝【問題3】）');
  assert.ok(!/_pushInFlightSince/.test(stripComments(GP)), '_pushInFlightSince 還在程式碼裡 ⇒ 舊的凍結時間戳沒有真的移除');
});

// ══════════════════════════════════════════════════════════════════════════
// 5. 【4】全站枚舉：所有盤面推送都必須走中央的 pushTracked/pushUndoTracked
// ══════════════════════════════════════════════════════════════════════════
function barePushSites(src) {
  const stripped = stripComments(src);
  const re = /(?<![\w.])(pushGameState|pushUndoRollback)\s*\(/g;
  const out = []; let m;
  while ((m = re.exec(stripped))) out.push({ name: m[1], idx: m.index, line: stripped.slice(0, m.index).split('\n').length });
  return out;
}
T('[HEAD-FAIL⑥/掃描器先驗] 掃描器抓得到「多出來的裸呼叫」（正對照，否則是安慰劑）', () => {
  const injected = GP.replace('  let _prevLogLen = -1;', '  let _prevLogLen = -1;\n  pushGameState(roomCode, game);');
  assert.equal(barePushSites(injected).length, barePushSites(GP).length + 1,
    '掃描器對「新插進去的一發裸呼叫」完全沒反應');
  assert.equal(barePushSites('// pushGameState(a, b)\nconst x = 1;').length, 0, '掃描器把註解裡的呼叫也算進去了');
  assert.equal(barePushSites('foo.pushGameState(a);').length, 0, '掃描器把 `obj.pushGameState()` 也算進去了');
});
T('[HEAD-FAIL⑥] +page.svelte 只剩兩個裸呼叫，且都在中央 helper 裡面', () => {
  const sites = barePushSites(GP);
  assert.equal(sites.length, 2, '裸呼叫有 ' + sites.length + ' 處（應為 2，只允許在兩支中央 helper 內）：'
    + sites.map((s) => s.name + '@L' + s.line).join('、'));
  const pt = fnSrc(GP, 'async function pushTracked(');
  const pu = fnSrc(GP, 'async function pushUndoTracked(');
  assert.ok(/try \{ await pushGameState\(code, st\); \} finally \{ _endPushTrack\(m\); \}/.test(pt),
    'pushTracked 沒有用 finally 還原標記（拋錯就永久留著）');
  assert.ok(/try \{ await pushUndoRollback\(code, st\); \} finally \{ _endPushTrack\(m\); \}/.test(pu),
    'pushUndoTracked 沒有用 finally 還原標記');
  // 四個呼叫端都必須走中央 helper
  for (const need of [
    'await pushTracked(code, st);',                                    // pushWithRetry
    'pushTracked(roomCode, _st)',                                      // 自癒重推
    'pushTracked(roomCode, decision.game)',                            // merge-setup advance
    'pushTracked(roomCode, _festPromoted)',                            // 祭典樂舞 promote
    'await pushUndoTracked(roomCode, snap);',                          // 悔棋 rollback
  ]) assert.ok(GP.includes(need), '這個呼叫端沒有走中央 helper：' + need);
});

// ══════════════════════════════════════════════════════════════════════════
// 6. 【5】換局要清掉上一局的在途追蹤
// ══════════════════════════════════════════════════════════════════════════
T('[HEAD-FAIL⑦] 換局的 $effect 有重設在途追蹤與重訂閱退避', () => {
  assert.ok(/_resetPushTracking\(\);/.test(NEWGAME_SEG), '換局沒有清掉上一局的在途標記（【問題5】）');
  assert.ok(/_resyncStreak = 0;/.test(NEWGAME_SEG), '換局沒有重設重訂閱退避');
  assert.ok(/_unpushedState = null;/.test(NEWGAME_SEG) && /_repushAttempts = 0;/.test(NEWGAME_SEG),
    'v6.212 原有的兩個重設被弄丟了');
});
await TA('[HEAD-FAIL⑦b/行為] 上一局的在途推送不得壓住新局的自癒', async () => {
  const W = mkWorld({ pushOutcome: 'ok', pushMs: 10 ** 9 });
  const me = mkClient(W, 0);
  me.pushTracked('ROOM1', me.game);                       // 上一局的推送，永遠不落地
  assert.equal(me.hasFreshPushInFlight(), true, '情境沒建立起來');
  me._resetPushTracking();                                // ← 換局 $effect 做的事
  assert.equal(me.hasFreshPushInFlight(), false, '換局後上一局的在途還壓著新局');
  // 而且那一發真的落地時，_endPushTrack 找不到自己 ⇒ no-op，不會弄壞新局的標記
  const m2 = me.pushTracked('ROOM1', me.game);            // 新局的推送
  assert.equal(me.hasFreshPushInFlight(), true, '新局自己的推送標記不見了');
  void m2;
});

// ══════════════════════════════════════════════════════════════════════════
// 7. 【7】重訂閱退避：省得到，但**不可以**削弱脫困能力
// ══════════════════════════════════════════════════════════════════════════
T('[純函式] casualResyncGapMs：前 3 次維持 8 秒，之後退避且夾在 60 秒以內', () => {
  assert.deepEqual([0, 1, 2].map(casualResyncGapMs), [8000, 8000, 8000], '前 3 次不再是 8 秒 ⇒ 救援窗口被改掉了');
  assert.equal(casualResyncGapMs(3), 16000);
  assert.equal(casualResyncGapMs(4), 32000);
  assert.equal(casualResyncGapMs(5), 60000);
  assert.equal(casualResyncGapMs(50), 60000, '沒有夾在上限內');
  assert.equal(casualResyncGapMs(NaN), 8000, 'NaN 沒有退回基底 ⇒ 比較永遠 false ⇒ 再也不重訂閱');
  assert.equal(casualResyncGapMs(-5), 8000);
});
await TA('[HEAD-FAIL⑧] 卡住 300 秒的重訂閱次數要明顯下降，但**前三次的時刻逐字不變**', async () => {
  const r = await runSlowPush({ pushOutcome: 'ok', pushMs: 87000, totalMs: 300000 });
  const rel = r.resubAt.map((t) => (t - (r.resubAt[0] - 10000)) / 1000);
  assert.ok(r.resubs <= 12, '300 秒內仍重訂閱 ' + r.resubs + ' 次（v6.247 是 30 次）');
  assert.ok(r.resubs >= 3, '重訂閱只有 ' + r.resubs + ' 次 ⇒ 脫困能力被砍掉了');
  assert.deepEqual(rel.slice(0, 3), [10, 20, 30],
    '前三次重訂閱的時刻變了（v5.360 的救援窗口必須逐字不變）：' + rel.slice(0, 3).join(','));
  console.log('   重訂閱時刻（秒）：' + rel.join(', ') + '（共 ' + r.resubs + ' 次）');
});
await TA('[正對照] 健康對局：0 次推送 / 0 次 force-adopt / 0 次重訂閱（請求數逐字不變）', async () => {
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
  assert.equal(me._resyncStreak, 0, '健康對局的退避 streak 竟然被累加');
});
await TA('[正對照] 短暫卡 30 秒後恢復：重訂閱一樣是 3 次，退避完全不介入', async () => {
  const W = mkWorld({}); const me = mkClient(W, 0, { game: mkGS({ active: 1 }) });
  for (let e = 0; e < 35000; e += 5000) { await W.clk.advance(5000); me.tick(); }
  const stuckResubs = me._resubs;
  const g = clone(W.server.gs); g.log.push({ msg: 'opp' }); g.activePlayerIndex = 1;
  W.server = { gs: g, version: W.server.version + 1 }; me.setGame(clone(g));   // 對手動了
  await W.clk.advance(5000); me.tick();
  assert.equal(stuckResubs, 3, '卡住 30 秒的重訂閱不是 3 次而是 ' + stuckResubs + ' 次');
  assert.equal(me._resyncStreak, 0, '同步恢復後 streak 沒有歸零 ⇒ 下次卡住時第一發重訂閱會被延後');
});

// ══════════════════════════════════════════════════════════════════════════
// 8. ⭐硬約束：force-adopt 不得在「我的回合中途」觸發
// ══════════════════════════════════════════════════════════════════════════
await TA('[硬約束①] 我的回合中途推送失敗／很慢 ⇒ 全程不得 force-adopt、不得退回', async () => {
  for (const [outcome, ms] of [['timeout', 30000], ['ok', 87000], ['ok', 200000]]) {
    const r = await runSlowPush({ pushOutcome: outcome, pushMs: ms, endTurn: false, totalMs: 320000 });
    assert.equal(r.adopts, 0, '(' + outcome + '/' + ms + ') 我方回合中途竟然 force-adopt 了 ' + r.adopts + ' 次');
    assert.equal(r.rolledBack, false, '(' + outcome + '/' + ms + ') 我方回合中途盤面被退回');
  }
});
T('[硬約束②] force-adopt 的唯一防線 isWaitingOnOpponent 語意逐字不變', () => {
  assert.equal(isWaitingOnOpponent(mkGS({ active: 0 }), 0), false, '我的回合竟然判成等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 0, a0: null }), 0), false, '我要補位時竟然判成等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 1, pendingSelection: { actorIdx: 0 } }), 0), false,
    '對手回合但輪到我選，竟然判成等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 1 }), 0), true, '對手回合竟然判成不等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 0, a1: null }), 0), true, '對手要補位時應算等對手');
  assert.equal(isWaitingOnOpponent(mkGS({ active: 0, pendingPrizes: [0, 1] }), 0), true, '對手待拿獎賞應算等對手');
});

// ══════════════════════════════════════════════════════════════════════════
// 9. 現況鎖（站長裁定：**不修**，這裡只是鎖住「現在就是這樣」）
// ══════════════════════════════════════════════════════════════════════════
T('[現況鎖/【1】] 自癒仍留在 isWaitingOnOpponent gate 底下 —— 刻意不拆', () => {
  assert.ok(IV_BODY.includes('if (!isWaitingOnOpponent(game, mySeatIdx)) { oppInactivityWarn = false; return; }'),
    '那一行被改掉了 —— 拆 gate 之前請先看 pushWithRetry 上方 v6.248 的量測結論');
  const i = IV_BODY.indexOf('if (!isWaitingOnOpponent(game, mySeatIdx))');
  assert.ok(IV_BODY.indexOf('>= 8000') > i, '8 秒重訂閱跑到 gate 前面了 ⇒ 我方回合中途會多打伺服器');
  assert.ok(IV_BODY.indexOf('_forceAdoptNext = true') > i, 'force-adopt 跑到 gate 前面了 ⇒ 違反硬約束');
});
T('[現況鎖/棄權] 棄權相關三處逐字不變（站長裁定「塞住的是他，也有責任」）', () => {
  assert.ok(/const thresholdMs = Math\.min\(300, Math\.max\(60, roomData\?\.idleTimeoutSec \?\? 180\)\) \* 1000;/.test(IV_BODY),
    '棄權門檻的算法被改了');
  assert.ok(/oppInactivityWarn = \(Date\.now\(\) - _lastActionAt\) >= thresholdMs;/.test(IV_BODY),
    '棄權提示的觸發條件被改了');
  assert.ok(/const granted = await claimOpponentForfeit\(roomCode, mySeatIdx as 0 \| 1\);/.test(GP),
    '伺服器端棄權再驗證的呼叫被改了');
});
await TA('[現況鎖/棄權行為] 對手真的掛機 3 分鐘 ⇒ 棄權提示照跳', async () => {
  const W = mkWorld({});
  const me = mkClient(W, 0, { game: mkGS({ active: 1 }) });
  for (let e = 0; e <= 200000; e += 5000) { await W.clk.advance(5000); me.tick(); }
  assert.equal(me.oppInactivityWarn, true, '對手掛機超過門檻竟然不跳棄權提示');
});
T('[回歸] 25 秒門檻／8 秒判定／5 秒 interval 三個既有行為的字面都還在', () => {
  assert.ok(/\(Date\.now\(\) - _lastSyncAt\) >= 25000/.test(GP), '25 秒門檻不見了');
  assert.ok(/\(Date\.now\(\) - _lastSyncAt\) >= 8000/.test(GP), '8 秒判定不見了');
  assert.ok(/setInterval\(\(\) => \{[\s\S]{200,}?\}, 5000\);/.test(GP), 'interval 不是 5 秒了（跳動頻率不可變）');
});
T('[回歸] v6.212 的既有不變量沒被動到', () => {
  const B0 = GP.indexOf('v6.212 SELFHEAL DIRECTION BLOCK BEGIN');
  const B1 = GP.indexOf('v6.212 SELFHEAL DIRECTION BLOCK END');
  assert.ok(B0 > 0 && B1 > B0, '自癒方向區塊定位不到');
  const seg = GP.slice(B0, B1);
  assert.equal((seg.match(/_forceAdoptNext\s*=\s*true/g) || []).length, 1, '區塊內 _forceAdoptNext = true 不再只有一次');
  assert.ok(/decideStuckSelfHeal\(\{/.test(seg), '不再走中央決策');
  assert.ok(/_repushAttempts\+\+/.test(seg), '重推不再計次 ⇒ 上限形同虛設');
});

// ══════════════════════════════════════════════════════════════════════════
// 10. 【6】首頁 changelog 的歸因更正
// ══════════════════════════════════════════════════════════════════════════
T('[HEAD-FAIL⑨] v6.247 那則不可以再宣稱問題是「上一版起」才有的', () => {
  const m = /<details[^>]*>\s*<summary><span class="ver-badge">v6\.247<\/span>[\s\S]*?<\/details>/.exec(CL);
  assert.ok(m, '找不到 v6.247 那一則');
  assert.ok(!/上一版起，資料量較大的盤面/.test(m[0]), '錯誤的歸因（「上一版起」）還在');
  assert.ok(/並不是上一版才出現/.test(m[0]) && /早就存在/.test(m[0]), '沒有把「這個現象一直都在」講清楚');
});
T('[HEAD-FAIL⑩] 首頁維持 50 則、v6.248 在最上面、最舊那一則已進封存', () => {
  assert.equal((CL.match(/class="ver-badge"/g) || []).length, 50, '首頁則數不是 50');
  assert.ok(/^<details open>\s*<summary><span class="ver-badge">v6\.248<\/span>/.test(CL.trim()),
    'v6.248 不在最上面／不是展開的那一則');
  assert.equal((CL.match(/<details/g) || []).length, (CL.match(/<\/details>/g) || []).length, 'details 開合不符');
  assert.equal((CL.match(/ver-badge">v6\.181</g) || []).length, 0, 'v6.181 還留在首頁');
  assert.equal((AR.match(/ver-badge">v6\.181</g) || []).length, 1, 'v6.181 沒有進封存頁（＝紀錄被刪掉了）');
  assert.ok(CL.includes('__BASE__/changelog-archive.html'), '封存連結不見了');
  // 規格：Svelte 模板裡的裸 < > { } 會讓 build 失敗
  const entries = CL.slice(0, CL.indexOf('changelog-archive-link'));
  assert.ok(!/[{}]/.test(entries.replace(/<[^>]*>/g, '')), 'changelog 內文出現裸的大括號');
  assert.ok(!/\*\*/.test(CL), 'changelog 出現 markdown 粗體（以 HTML 插入會顯示成星號）');
});

// ══════════════════════════════════════════════════════════════════════════
// 11. ⭐突變測試 —— 每一個都要「紅在指定的那一條」；⚠ 只捕捉 AssertionError
// ══════════════════════════════════════════════════════════════════════════
async function mutantCheck(mutate, probe) {
  const runners = await buildRunners(mutate);
  try { await probe(runners); return { passed: true }; }
  catch (e) {
    if (e instanceof assert.AssertionError) return { passed: false, why: e.message };
    throw e;                    // 工具鏈壞掉不可以被當成「突變被抓到」
  }
}
const probeNoRollback150 = async (runners) => {
  const r = await runSlowPush({ pushOutcome: 'ok', pushMs: 150000, totalMs: 210000, runners });
  assert.equal(r.rolledBack, false, 'rolledBack@150s');
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
const probeFirstThreeResyncs = async (runners) => {
  const r = await runSlowPush({ pushOutcome: 'ok', pushMs: 87000, totalMs: 300000, runners });
  const rel = r.resubAt.map((t) => (t - (r.resubAt[0] - 10000)) / 1000);
  assert.deepEqual(rel.slice(0, 3), [10, 20, 30], '前三次重訂閱時刻=' + rel.slice(0, 3).join(','));
};
const mutOnce = (needle, repl) => (src) => (src.includes(needle) ? src.replace(needle, repl) : src);

await TA('[突變1] 在途上限改回 v6.247 的 120 秒 ⇒ 150 秒那條必須翻紅（證明【2】不是裝飾）', async () => {
  const m = (s, kind) => (kind === 'helpers'
    ? s.replace('(now - m.at) < PUSH_INFLIGHT_FAILSAFE_MS', '(now - m.at) < 120000') : s);
  const a = await mutantCheck(m, probeNoRollback150);
  assert.equal(a.passed, false, '把上限改回 120 秒，150 秒的推送竟然還是不回捲 ⇒ 這條守衛是安慰劑');
  assert.ok(/rolledBack@150s|adoptsEarly/.test(a.why), '紅的不是預期那一條：' + a.why);
  const b = await mutantCheck(m, probeStillAdoptsEventually);
  assert.equal(b.passed, true, '突變1 連不相干的斷言也弄紅了 ⇒ 定位不準：' + b.why);
});
await TA('[突變2] 拿掉 `&& !_pushStillInFlight` ⇒ 150 秒那條必須翻紅', async () => {
  const m = mutOnce('(Date.now() - _lastSyncAt) >= 25000 && !_pushStillInFlight',
                    '(Date.now() - _lastSyncAt) >= 25000');
  const a = await mutantCheck(m, probeNoRollback150);
  assert.equal(a.passed, false, '修法拿掉了核心斷言卻還是綠的');
  assert.ok(/rolledBack@150s|adoptsEarly/.test(a.why), '紅的不是預期那一條：' + a.why);
});
await TA('[突變3] 把在途標記改成「只在第一發時記時間」（＝【問題3】）⇒ 重疊情境必須翻紅', async () => {
  const m = (s, kind) => (kind === 'helpers'
    ? s.replace('_pushInFlightMarks.push(m);', 'if (_pushInFlightMarks.length === 0) _pushInFlightMarks.push(m); else _pushInFlightMarks.push({ at: _pushInFlightMarks[0].at });')
    : s);
  const runners = await buildRunners(m);
  const W = mkWorld({ pushOutcome: 'ok', pushMs: 10 ** 9 });
  const me = mkClient(W, 0, { failsafeMs: 120000 }, runners);
  me.pushTracked('ROOM1', me.game);
  await W.clk.advance(100000);
  me.pushTracked('ROOM1', me.game);
  await W.clk.advance(50000);
  assert.equal(me.hasFreshPushInFlight(), false,
    '凍結時間戳的突變版竟然還撐得住保護 ⇒ 【問題3】的斷言其實測不到東西');
});
await TA('[突變4] 拿掉 isWaitingOnOpponent 這道 gate ⇒ 硬約束必須翻紅', async () => {
  const m = mutOnce('if (!isWaitingOnOpponent(game, mySeatIdx)) { oppInactivityWarn = false; return; }',
                    'if (false) { oppInactivityWarn = false; return; }');
  const a = await mutantCheck(m, probeMidTurnNoAdopt);
  assert.equal(a.passed, false, 'gate 被拿掉，我方回合中途卻還是不會 force-adopt ⇒ 硬約束守衛是假的');
  assert.ok(/中途 force-adopt/.test(a.why), '紅的不是預期那一條：' + a.why);
});
await TA('[突變5] 讓退避從第一次就生效（60 秒）⇒ 「前三次逐字不變」必須翻紅', async () => {
  const m = (s, kind) => (kind === 'gap' ? s.replace('if (s < RESYNC_FULL_RATE_ROUNDS) return RESYNC_BASE_MS;', '') : s);
  const a = await mutantCheck(m, probeFirstThreeResyncs);
  assert.equal(a.passed, false, '退避提前生效卻沒被抓到 ⇒ 脫困能力可能被悄悄砍掉');
  assert.ok(/前三次重訂閱時刻/.test(a.why), '紅的不是預期那一條：' + a.why);
  const b = await mutantCheck(m, probeNoRollback150);
  assert.equal(b.passed, true, '突變5 連不相干的斷言也弄紅了 ⇒ 定位不準：' + b.why);
});
await TA('[突變6] 把 pushTracked 的 finally 還原拿掉（標記洩漏）⇒ 上限仍讓自癒恢復（fail-safe 不是裝飾）', async () => {
  const m = (s, kind) => (kind === 'helpers'
    ? s.replace('try { await pushGameState(code, st); } finally { _endPushTrack(m); }', 'await pushGameState(code, st);') : s);
  const a = await mutantCheck(m, async (runners) => {
    const r = await runSlowPush({ pushOutcome: 'timeout', pushMs: 30000, totalMs: 300000, runners, failsafeMs: 40000 });
    assert.ok(r.adopts >= 1, 'adopts=' + r.adopts);
  });
  assert.equal(a.passed, true, '標記洩漏後就永遠不自癒了 ⇒ 上限沒有發揮 fail-safe 作用：' + a.why);
  const b = await mutantCheck(m, async (runners) => {
    const W = mkWorld({ pushOutcome: 'ok', pushMs: 1000 });
    const me = mkClient(W, 0, {}, runners);
    const p = me.pushTracked('ROOM1', me.game).catch(() => {});
    await W.clk.advance(3000);
    await p;
    assert.equal(me._pushInFlightMarks.length, 0, 'marks=' + me._pushInFlightMarks.length);
  });
  assert.equal(b.passed, false, '突變6 根本沒改到程式碼（標記居然還是清乾淨的）');
});

console.log('\n=== v6.248 在途上限／逐發計時／中央收斂／重訂閱退避: ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
