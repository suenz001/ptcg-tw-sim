#!/usr/bin/env node
/**
 * ⭐v6.248 量測腳本（Rule 32：效能數字必須附量測腳本）。
 *
 * 量兩件事，兩件都用**虛擬時鐘實跑 +page.svelte 的真原始碼**（不是讀碼推論）：
 *   ① 推送很慢時，本地盤面會不會被 force-adopt 退回（列出時間軸）。
 *   ② 卡住期間 5 秒 interval 觸發了幾次「重建房間訂閱」——
 *      每一次都會讓 oraclePollRoom 把 lastVersion 歸 -1 ＝ 多一發**全量**房間 GET。
 *
 * 在 v6.246 / v6.247 / v6.248 三棵樹上各跑一次即可對照（腳本讀的是所在樹的原始碼）。
 * 實測（沙盒 node 22）：
 *   pushMs=150s 回捲：v6.246 t=30s、v6.247 t=120s、v6.248 **無**。
 *   卡住 300 秒的重訂閱：v6.246 24 次 / v6.247 30 次 / v6.248 8 次（前三次時刻皆為 10/20/30 秒）。
 *
 * Run: node scripts/perf-v6248-resync-and-inflight.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { transform } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GP = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SG = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
function blockAfter(src, i) {
  const o = src.indexOf('{', i); let d = 0;
  for (let k = o; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return [o, k + 1]; } }
  throw new Error('大括號不平衡');
}
function fnSrc(src, a) { const i = src.indexOf(a); if (i < 0) throw new Error('找不到錨點：' + a); const [, b] = blockAfter(src, i + a.length - 1); return src.slice(i, b); }
const IVA = 'const iv = setInterval(() => {';
const s0 = GP.indexOf(IVA); const [o, c] = blockAfter(GP, s0 + IVA.length - 1);
const IV_BODY = GP.slice(o + 1, c - 1);
const PWR = fnSrc(GP, 'async function pushWithRetry(');
const IWO = fnSrc(GP, 'function isWaitingOnOpponent(');
const HAS_TRACK = GP.includes('function _beginPushTrack(');     // v6.248 之後才有
const HELPERS = HAS_TRACK ? ['function _beginPushTrack(', 'function _endPushTrack(', 'function hasFreshPushInFlight(',
  'function oldestPushInFlightAgeMs(', 'function _resetPushTracking(', 'async function pushTracked(',
  'async function pushUndoTracked('].map((a) => fnSrc(GP, a)).join('\n') : '';
const HAS_GAP = SG.includes('export function casualResyncGapMs(');
const CRG = HAS_GAP ? (['RESYNC_BASE_MS', 'RESYNC_FULL_RATE_ROUNDS', 'RESYNC_MAX_MS']
  .map((k) => new RegExp('export const ' + k + ' = \\d+;').exec(SG)[0].replace(/^export /, '')).join('\n')
  + '\n' + fnSrc(SG, 'export function casualResyncGapMs(').replace(/^export /, '')) : '';

const ts = async (x) => (await transform(x, { loader: 'ts', format: 'cjs', target: 'node20' })).code;
function loadFn(j) { const m = { exports: {} }; new Function('module', 'exports', j)(m, m.exports); return m.exports._f; }
const isWaitingOnOpponent = loadFn(await ts('export const _f = (' + IWO.replace(/^function\s+\w+/, 'function') + ');'));
const runInterval = new Function('S', 'with (S) {\n' + (await ts(IV_BODY)) + '\n}');
const mkPWR = new Function('S', 'with (S) {\n' + (await ts(PWR)) + '\nreturn pushWithRetry; }');
const mkHelpers = HAS_TRACK ? new Function('S', 'with (S) {\n' + (await ts(HELPERS))
  + '\nreturn { pushTracked, pushUndoTracked, hasFreshPushInFlight, oldestPushInFlightAgeMs, _resetPushTracking }; }') : null;
const casualResyncGapMs = HAS_GAP ? loadFn(await ts('export const _f = (() => {\n' + CRG + '\nreturn casualResyncGapMs; })();')) : null;

function mkClock() {
  let now = 1000000; const t = []; let q = 0;
  return { get now() { return now; }, Date: { now: () => now },
    setTimeout(f, ms) { const h = { at: now + (ms || 0), fn: f, id: ++q }; t.push(h); return h.id; },
    clearTimeout(id) { const i = t.findIndex((x) => x.id === id); if (i >= 0) t.splice(i, 1); },
    async advance(ms) { const tg = now + ms;
      for (;;) { t.sort((a, b) => a.at - b.at || a.id - b.id);
        if (t.length && t[0].at <= tg) { const x = t.shift(); now = x.at; x.fn(); for (let i = 0; i < 20; i++) await Promise.resolve(); }
        else { now = tg; break; } }
      for (let i = 0; i < 20; i++) await Promise.resolve(); } };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const mkGS = (o = {}) => ({ id: 'G1', createdAt: 1000, phase: 'playing',
  log: Array.from({ length: o.logLen ?? 10 }, (_, i) => ({ msg: 'l' + i })), setupDone: [true, true],
  pendingPrizes: [0, 0], pendingSelection: null, firstPlayerIdx: 0, activePlayerIndex: o.active ?? 0,
  players: [{ name: 'P0', active: {}, bench: [{}], prizes: [], deck: [] }, { name: 'P1', active: {}, bench: [{}], prizes: [], deck: [] }] });
function mkWorld(o = {}) {
  const clk = mkClock();
  const W = { clk, server: { gs: mkGS({ logLen: 10 }), version: 5 }, pushCalls: 0,
    pushOutcome: o.pushOutcome ?? 'ok', pushMs: o.pushMs ?? 200 };
  W.pushGameState = (code, st) => new Promise((res, rej) => {
    const snap = clone(st); W.pushCalls++; const oc = W.pushOutcome, ms = W.pushMs;
    clk.setTimeout(() => { if (oc === 'ok') { if (!(snap.log.length < W.server.gs.log.length)) W.server = { gs: snap, version: W.server.version + 1 }; res(); }
      else { const e = new Error('連線逾時'); e.oracleTimeout = true; rej(e); } }, ms); });
  W.pushUndoRollback = W.pushGameState;
  return W;
}
function mkClient(W, seat) {
  const clk = W.clk;
  const S = { roomCode: 'ROOM1', game: clone(W.server.gs), mySeatIdx: seat, myPlayerIndex: seat,
    roomData: { idleTimeoutSec: 180 }, oppInactivityWarn: false, _lastActionAt: clk.now, _lastSyncAt: clk.now,
    _lastResyncAt: 0, _resyncStreak: 0, _forceAdoptNext: false, _unpushedState: null, _repushAttempts: 0,
    _pushInFlight: 0, _pushInFlightSince: 0, _pushInFlightMarks: [],
    ORACLE_API_TIMEOUT_MAX_MS: 120000, PUSH_INFLIGHT_FAILSAFE_MS: 1500750, casualResyncGapMs,
    unsubRoom: null, casualWaitingSelfInput: () => false, PUSH_RETRY_MAX: 3,
    Date: clk.Date, setTimeout: (f, ms) => clk.setTimeout(f, ms), Math,
    console: { warn: () => {}, error: () => {}, log: () => {} }, isWaitingOnOpponent,
    decideStuckSelfHeal: (ctx) => ((ctx.hasUnpushedLocal && ctx.repushAttempts < (ctx.maxRepushAttempts ?? 2)) ? { kind: 'repush' } : { kind: 'force-adopt' }),
    pushGameState: (c, st) => W.pushGameState(c, st), pushUndoRollback: (c, st) => W.pushUndoRollback(c, st),
    isOracleTimeout: (e) => !!(e && e.oracleTimeout === true),
    subscribeRoom: () => { S._resubs++; S._resubAt.push(clk.now); return () => {}; },
    handleRoomUpdate: () => {}, _resubs: 0, _resubAt: [], _adopts: 0 };
  if (mkHelpers) Object.assign(S, mkHelpers(S));
  S.pushWithRetry = mkPWR(S);
  S.setGame = (g) => { const p = S.game?.log?.length ?? -1; S.game = g; const n = g?.log?.length ?? 0;
    if (n !== p) { S._lastSyncAt = clk.Date.now(); if (n > p) { S._lastActionAt = clk.Date.now(); S.oppInactivityWarn = false; } } };
  S.poll = () => { const inc = W.server.gs;
    if (S._forceAdoptNext) { S._forceAdoptNext = false; if (inc.phase !== 'setup' && (!S.game || S.game.id === inc.id)) { S._adopts++; S.setGame(clone(inc)); return 'fa'; } }
    if (!S.game) return 'n';
    if ((inc.log?.length ?? 0) < (S.game.log?.length ?? 0)) return 'r';
    if ((inc.log?.length ?? 0) === (S.game.log?.length ?? 0)) return 'e';
    S.setGame(clone(inc)); return 'a'; };
  S.tick = () => runInterval(S);
  return S;
}
async function run({ pushOutcome, pushMs, totalMs }) {
  const W = mkWorld({ pushOutcome, pushMs }); const me = mkClient(W, 0);
  const g = clone(me.game); g.log.push({ msg: 'attack' }); g.activePlayerIndex = 1;
  me.setGame(g); me.pushWithRetry('ROOM1', g);
  const peak = g.log.length; const tl = []; let prev = peak;
  for (let e = 0; e <= totalMs; e += 1000) {
    await W.clk.advance(1000);
    if (e % 5000 === 0) { me.tick(); me.poll(); }
    const L = me.game?.log?.length ?? -1;
    if (L !== prev) { tl.push('t=' + e / 1000 + 's ' + prev + '→' + L); prev = L; }
  }
  return { tl, resubs: me._resubs, resubAt: me._resubAt.map((t) => (t - (me._resubAt[0] - 10000)) / 1000), pushCalls: W.pushCalls };
}
console.log('在途追蹤：' + (HAS_TRACK ? 'v6.248（逐發計時）' : 'v6.247 以前（單一時間戳）')
  + '　重訂閱退避：' + (HAS_GAP ? '有' : '無'));
console.log('\n① 推送很慢時的盤面時間軸（空白＝全程沒有被退回）');
for (const ms of [87, 120, 150, 200, 300]) {
  const r = await run({ pushOutcome: 'ok', pushMs: ms * 1000, totalMs: ms * 1000 + 60000 });
  console.log('   pushMs=' + ms + 's  ' + (r.tl.join(' , ') || '(無變動)'));
}
console.log('\n② 卡住 300 秒的重訂閱次數（每次＝一發全量房間 GET）');
for (const [n, o] of [['推送逾時 30s', { pushOutcome: 'timeout', pushMs: 30000 }], ['推送 87 秒才送達', { pushOutcome: 'ok', pushMs: 87000 }]]) {
  const r = await run({ ...o, totalMs: 300000 });
  console.log('   ' + n + '：' + r.resubs + ' 次，時刻（秒）= ' + r.resubAt.join(', '));
}
