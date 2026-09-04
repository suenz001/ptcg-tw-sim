/**
 * ⭐⭐⭐ 線上休閒 setup 的**共享房間模型**（test-v6309 ／ test-v6310 共用；抽出來是為了能跑「兩端不同版本」）。
 *
 * 模型（與線上休閒一致）：
 *   ・兩端各自 applyAction 後把整份盤面 push；push **在途、可亂序落地**；落地時走**推送者那一端**的推送端規則
 *     （shouldSkipStalePush → mergeForSetupPush）寫進**共享房間**
 *   ・poll 拿到的是房間現況（含自己的 echo；小機率拿到晚到的較舊房間版本）→ **該端**的 resolveRoomUpdate
 *   ・`runRoom(M, …)`：M 可以是單一模組（新×新），或 `[M0, M1]`（兩端各自的打包；主機 seat0 用 M0 建局）
 *
 * ⚠ 決定性：引擎的 shuffle 走全域 `Math.random`。這裡把它換成種子 PRNG，而且 **每一局開跑前都重設**
 *   （`resetEngineRng(k)`）—— 不重設的話狀態會跨局累積，「BASE 上 N/300」這種數字就不可重現、
 *   兩臂（新×舊 vs 舊×舊）也對不齊（v6.309 審查者第一版因此跑出假警報）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TAG = `.x-srm${process.pid}`;
const S = join(ROOT, `${TAG}-s.js`);
process.on('exit', () => {
  for (const f of readdirSync(ROOT)) if (f.startsWith(TAG)) { try { unlinkSync(join(ROOT, f)); } catch { /* ignore */ } }
});
writeFileSync(S, 'export const base="";export const assets="";');

export const SRC = {
  guards: readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8'),
  engine: readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'),
  oracle: readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8'),
  fire: readFileSync(join(ROOT, 'src/lib/game/room.ts'), 'utf8'),
  page: readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'),
};

let bundleSeq = 0;
/** 打包引擎＋守衛；`mut(contents, 'guards'|'engine')` 可對 sync-guards.ts／engine.ts 的內容做突變（esbuild onLoad 攔截）。 */
export async function bundle(mut) {
  const id = ++bundleSeq;
  const E = join(ROOT, `${TAG}-e${id}.ts`), O = join(ROOT, `${TAG}-o${id}.mjs`);
  writeFileSync(E, "export { createGame, applyAction, tryAdvanceToPlaying, isOpeningInProgress, canBeInitialActiveCard, ensureOpeningFinalized } from './src/lib/game/engine';\n"
    + "export * as G from './src/lib/game/sync-guards';\nimport './src/lib/game/effects';");
  const plugin = {
    name: 'srm-mut',
    setup(b) {
      b.onLoad({ filter: /src[\\/]lib[\\/]game[\\/](sync-guards|engine)\.ts$/ }, (args) => {
        const which = /sync-guards\.ts$/.test(args.path) ? 'guards' : 'engine';
        let contents = SRC[which];
        if (mut) contents = mut(contents, which);
        return { contents, loader: 'ts' };
      });
    },
  };
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error', plugins: [plugin] });
  const m = await import(pathToFileURL(O).href + '?v=' + id);
  return { ...m, ...m.G };
}

// ── 卡池 ──────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
export const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
export const BURST = '13974', BASIC = '19174', ENERGY = '14128';
assert.ok(pool.get(BURST)?.abilities?.some((a) => a.name === '瞬間爆發力'), '前提：13974 有「瞬間爆發力」');
assert.ok(pool.get(BASIC)?.subtype === 'Basic', '前提：19174 是基礎寶可夢');
export const LEGACY_THIN = [{ cardId: BASIC, count: 2 }, { cardId: ENERGY, count: 58 }];   // 常常重抽 ⇒ 常有補抽
export const LEGACY_FAT = [{ cardId: BASIC, count: 12 }, { cardId: ENERGY, count: 48 }];
export const MIXED = [{ cardId: BURST, count: 4 }, { cardId: BASIC, count: 2 }, { cardId: ENERGY, count: 54 }];
export const BURST_ONLY = [{ cardId: BURST, count: 4 }, { cardId: ENERGY, count: 56 }];

// ── 亂數 ──────────────────────────────────────────────────────────────────
let engineA = 0x9E3779B9;
Math.random = () => { engineA = (engineA + 0x6D2B79F5) >>> 0; let t = engineA; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** ⭐ 每局開跑前重設引擎的 PRNG（同一個 k ⇒ 同一副洗牌，不論之前跑過幾局、哪個 bundle）。 */
export function resetEngineRng(k) { engineA = (0x9E3779B9 + Math.imul(k | 0, 0x85EBCA6B)) >>> 0; }
let seed = 1;
export const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
export const setSeed = (v) => { seed = v; };
export const clone = (s) => JSON.parse(JSON.stringify(s));
export const CTX = (me) => ({ myPlayerIndex: me, roomRestartCount: 0, lastAdoptedRestartCount: 0, roomLastUndoApplyAt: 0, lastSeenUndoApplyAt: 0 });
export const board = (p) => (p.hand?.length ?? 0) + (p.bench?.length ?? 0) + (p.active ? 1 : 0);

/** 參考實作（守衛自己的一份，不依賴出貨碼）：與 sync-guards.setupSeatRank 的定義逐字對照。 */
export function refRank(s, i) {
  if (s.openingFlow === 'interactive') {
    const done = !!((s.openingDone ?? [true, true])[i] || s.setupDone?.[i]);
    if (!done) return 0;
    if (!s.openingFinalized) return 1;
  }
  const decided = (s.pendingMulliganDraw?.[i] ?? 0) === 0;
  return 2 + (s.setupDone?.[i] ? 1 : 0) + (s.mulliganRevealConfirmed?.[i] ? 1 : 0)
    + (decided ? 1 : 0) + (decided && !(s.mulliganPostBenchOpen?.[i] ?? false) ? 1 : 0);
}

const asPair = (M) => (Array.isArray(M) ? M : [M, M]);
const pushMerge = (Mi) => (typeof Mi.mergeForSetupPush === 'function' ? Mi.mergeForSetupPush : ((mine) => mine));   // BASE：整份覆蓋

// ═══════════════════════════════════════════════════════════════════════
// 共享房間模型
// ═══════════════════════════════════════════════════════════════════════
/**
 * @param M 打包出來的模組，或 [M0, M1]（兩端各自的版本；主機 seat0 用 M0 建局）
 * @param o { decks:[a,b], interactive:boolean, steps, trace? }
 * @returns { skipped } 或 { viol:{I8,I9,I10,I11,C2,C1}, why, clients, room, logLoss }
 */
export function runRoom(M, o) {
  const [M0, M1] = asPair(M);
  const Ms = [M0, M1];
  const rank = typeof M0.setupSeatRank === 'function' ? M0.setupSeatRank : refRank;
  const base = M0.createGame({ name: 'P1', entries: o.decks[0] }, { name: 'P2', entries: o.decks[1] }, pool,
    { firstChoicePreferences: ['random', 'random'] });
  if (o.interactive && base.openingFlow !== 'interactive') return { skipped: true };
  if (!o.interactive && base.openingFlow === 'interactive') return { skipped: true };
  const viol = { I8: 0, I9: 0, I10: 0, I11: 0, C2: 0, C1: 0 };
  const why = [];
  const note = (k, msg) => { viol[k]++; if (why.length < 6) why.push(k + ' ' + msg); };
  const room = { gs: clone(base), hist: [clone(base)] };
  const cl = [{ local: clone(base) }, { local: clone(base) }];
  const inflight = [];   // {seat, snap}
  /** ⭐ 歸因：每一次落地讓房間裡某座位的 rank 退回、或把 phase 從 playing 洗回 setup，記下是**誰推的**（test-v6310 C 節用） */
  const regress = [];
  const pickPlaceable = (hand) => hand.find((c) => M0.canBeInitialActiveCard(pool.get(c.cardId)));
  const pickBasic = (hand) => hand.find((c) => pool.get(c.cardId)?.subtype === 'Basic' && pool.get(c.cardId)?.supertype === 'Pokemon');
  /** 兩端動作實際產生的 log 行（多重集合；收斂後房間 log 該全部都有 —— 見 test-v6310 log 不變式） */
  const produced = new Map();
  const noteProduced = (before, after) => { for (let i = before.log.length; i < after.log.length; i++) { const k = JSON.stringify(after.log[i]); produced.set(k, (produced.get(k) ?? 0) + 1); } };

  const act = (i) => {
    const Mi = Ms[i];
    const { applyAction, isOpeningInProgress } = Mi;
    const s = cl[i].local;
    if (s.phase !== 'setup') return false;
    let n = s, ok = false;   // ok＝這個動作**真的**發生了（引擎被 gate 擋住時會回同一狀態或只多一行 log）
    if (s.openingFlow === 'interactive' && s.openingChoicePending?.[i]) {
      n = applyAction(s, { type: rnd() < 0.3 ? 'OPENING_MULLIGAN' : 'OPENING_KEEP', senderIdx: i }, pool);
      ok = !n.openingChoicePending?.[i] || (n.mulliganCounts?.[i] ?? 0) > (s.mulliganCounts?.[i] ?? 0);
    } else if (isOpeningInProgress(s)) {
      return false;
    } else if (!s.mulliganRevealConfirmed?.[i]) {
      n = applyAction(s, { type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx: i }, pool); ok = !!n.mulliganRevealConfirmed?.[i];
    } else if ((s.pendingMulliganDraw?.[i] ?? 0) > 0) {
      n = applyAction(s, { type: 'MULLIGAN_DRAW_DECISION', count: s.pendingMulliganDraw[i], senderIdx: i }, pool);   // 一律全領（I11 才算得準）
      ok = (n.pendingMulliganDraw?.[i] ?? 0) === 0;
    } else if (!s.players[i].active) {
      const c = pickPlaceable(s.players[i].hand);
      if (c) { n = applyAction(s, { type: 'PLACE_ACTIVE', iid: c.iid, senderIdx: i }, pool); ok = !!n.players[i].active; }
    } else if (!s.setupDone?.[i]) {
      const b = pickBasic(s.players[i].hand);
      if (b && rnd() < 0.4) { n = applyAction(s, { type: 'BENCH_POKEMON', iid: b.iid, senderIdx: i }, pool); ok = n.players[i].bench.length > s.players[i].bench.length; }
      else { n = applyAction(s, { type: 'FINISH_SETUP', senderIdx: i }, pool); ok = !!n.setupDone?.[i]; }
    } else if (s.mulliganPostBenchOpen?.[i]) {
      const b = pickBasic(s.players[i].hand);
      if (b && rnd() < 0.5) { n = applyAction(s, { type: 'BENCH_POKEMON', iid: b.iid, senderIdx: i }, pool); ok = n.players[i].bench.length > s.players[i].bench.length; }
      else { n = applyAction(s, { type: 'FINISH_MULLIGAN_POST_BENCH', senderIdx: i }, pool); ok = !n.mulliganPostBenchOpen?.[i]; }
    }
    if (!ok) return false;
    noteProduced(s, n);
    cl[i].local = n;
    inflight.push({ seat: i, snap: clone(n) });
    if (o.trace) o.trace('ACT', i, n);
    return true;
  };
  const land = (k) => {
    const { seat, snap } = inflight.splice(k, 1)[0];
    const Mi = Ms[seat];
    if (Mi.shouldSkipStalePush(snap, room.gs)) return;
    const before = room.gs;
    const rb = [rank(before, 0), rank(before, 1)];
    room.gs = clone(pushMerge(Mi)(snap, room.gs, seat));
    for (const s of [0, 1]) { const ra = rank(room.gs, s); if (ra < rb[s]) regress.push({ by: seat, seat: s, kind: 'rank', from: rb[s], to: ra }); }
    if (before.phase === 'playing' && room.gs.phase === 'setup') regress.push({ by: seat, seat: null, kind: 'phase' });
    room.hist.push(clone(room.gs));
    if (room.hist.length > 4) room.hist.shift();
    if (o.trace) o.trace('LAND', seat, room.gs);
  };
  const checkEnterPlaying = (tag, g) => {
    for (const i of [0, 1]) {
      const truth = cl[i].local.players[i];   // 該座位本人當下的本地
      const p = g.players[i];
      if (p.deck.length > truth.deck.length || p.hand.length < truth.hand.length) {
        note('I9', `${tag} 座位${i} 進 playing 時倒退：deck ${truth.deck.length}→${p.deck.length} hand ${truth.hand.length}→${p.hand.length}`);
      }
    }
    if (g.openingFlow === 'interactive' && !g.openingFinalized) note('I10', `${tag} 互動式進 playing 但未結算`);
  };
  const poll = (i, incoming) => {
    const Mi = Ms[i];
    const before = cl[i].local;
    const d = Mi.resolveRoomUpdate(before, clone(incoming), CTX(i));
    if (o.trace) o.trace('POLL', i, d.game, d.kind, incoming === room.gs);
    if (!d.game) return;
    if (d.kind === 'merge-setup') {
      if (d.game.phase === 'setup') {
        if (JSON.stringify(d.game.players[i]) !== JSON.stringify(before.players[i])) note('I8', `端${i} 己側盤面被合併改寫（v6.058 R1：放上場的寶可夢被洗回手牌）`);
        for (const s of [0, 1]) {
          const rb = rank(before, s), ra = rank(d.game, s);
          const pb = before.players[s], pa = d.game.players[s];
          if (ra < rb) note('I8', `座位${s} rank ${rb}→${ra}（端${i}）`);
          if (pa.deck.length > pb.deck.length) note('I8', `座位${s} deck ${pb.deck.length}→${pa.deck.length}（端${i} 牌被洗回牌庫）`);
          if (board(pa) < board(pb)) note('I8', `座位${s} 場上＋手牌 ${board(pb)}→${board(pa)}（端${i}）`);
        }
      } else {
        checkEnterPlaying(`端${i} merge-advance`, d.game);
        inflight.push({ seat: i, snap: clone(d.game) });
      }
      cl[i].local = d.game;
    } else if (d.kind === 'adopt' || d.kind === 'merge-prize') {
      if (before.phase === 'setup' && d.game.phase === 'playing') checkEnterPlaying(`端${i} adopt`, d.game);
      cl[i].local = d.game;
    }
  };
  for (let step = 0; step < o.steps; step++) {
    const r = rnd();
    if (r < 0.35) act(rnd() < 0.5 ? 0 : 1);
    else if (r < 0.65) { if (inflight.length) land(Math.floor(rnd() * inflight.length)); }
    else {
      const i = rnd() < 0.5 ? 0 : 1;
      const stale = rnd() < 0.15 && room.hist.length > 1;
      poll(i, stale ? room.hist[Math.floor(rnd() * (room.hist.length - 1))] : room.gs);
    }
  }
  // 收斂：把剩下的動作做完、在途全部落地、雙方輪詢到穩定
  for (let r = 0; r < 60 && !(cl[0].local.phase === 'playing' && cl[1].local.phase === 'playing'); r++) {
    for (const i of [0, 1]) while (act(i)) { /* 做到沒事可做 */ }
    while (inflight.length) land(0);
    for (const i of [0, 1]) poll(i, room.gs);
    while (inflight.length) land(0);
    for (const i of [0, 1]) poll(i, room.gs);
  }
  const [a, b] = [cl[0].local, cl[1].local];
  if (a.phase !== 'playing' || b.phase !== 'playing') {
    note('C2', `收斂後仍未進 playing：端0=${a.phase} 端1=${b.phase} room=${room.gs.phase} `
      + JSON.stringify({ sd: [a.setupDone, b.setupDone], pmd: [a.pendingMulliganDraw, b.pendingMulliganDraw], mpb: [a.mulliganPostBenchOpen, b.mulliganPostBenchOpen] }));
  } else {
    // 兩端最後都 adopt／merge 到同一局；再同步一次讓 log 追平
    for (const i of [0, 1]) poll(i, room.gs);
    const fa = a.players.map((p) => p.hand.map((c) => c.iid).join(',') + '|' + p.deck.length).join('#');
    const fb = b.players.map((p) => p.hand.map((c) => c.iid).join(',') + '|' + p.deck.length).join('#');
    if (a.id !== b.id || fa !== fb) note('C1', `兩端盤面不一致 ${fa} vs ${fb}`);
    const [m1, m2] = a.mulliganCounts;
    const net = [Math.max(0, m2 - m1), Math.max(0, m1 - m2)];
    for (const i of [0, 1]) {
      const exp = 60 - 7 - a.players[i].prizes.length - net[i] - (i === a.firstPlayerIdx ? 1 : 0);
      if (a.players[i].deck.length !== exp) note('I11', `座位${i} deck ${a.players[i].deck.length} ≠ 應為 ${exp}（NET ${net[i]}，重抽 ${m1}/${m2}）`);
    }
  }
  // log 流失：兩端動作產生過、收斂後房間 log 裡卻沒有的行（多重集合差）
  const inRoom = new Map();
  for (const e of room.gs.log ?? []) { const k = JSON.stringify(e); inRoom.set(k, (inRoom.get(k) ?? 0) + 1); }
  let lost = 0, lostDraw = 0, total = 0;
  for (const [k, n] of produced) { total += n; const miss = Math.max(0, n - (inRoom.get(k) ?? 0)); lost += miss; if (miss && /選擇補抽|張重抽懲罰補抽/.test(k)) lostDraw += miss; }
  return { viol, why, clients: cl, room, regress, logLoss: { lost, lostDraw, total } };
}

/**
 * 跑 n 局；每局用 `k` 重設引擎 PRNG 與交錯序列的 seed ⇒ 決定性、可跨臂對齊（同一個 k 在任何 M 組合下都是同一副洗牌）。
 * @returns { ran, bad, tot, firstWhy, label, badSet:Set<k>, stuckSet:Set<k>, logLoss, regressBy:[n0,n1], stuckRegressBy:[n0,n1] }
 *   regressBy[i]＝座位 i 的 client 推送落地時讓房間退回（某座位 rank 下降／playing 洗回 setup）的次數；stuckRegressBy 只算卡局的局。
 */
export function runMany(M, label, decks, interactive, n, steps = 70) {
  const tot = { I8: 0, I9: 0, I10: 0, I11: 0, C2: 0, C1: 0 };
  let ran = 0, bad = 0, firstWhy = null;
  const badSet = new Set(), stuckSet = new Set();
  const logLoss = { lost: 0, lostDraw: 0, total: 0, games: 0 };
  const regressBy = [0, 0], stuckRegressBy = [0, 0];
  for (let k = 0; k < n; k++) {
    setSeed(k * 7919 + 101);
    resetEngineRng(k);
    const r = runRoom(M, { decks, interactive, steps });
    if (r.skipped) continue;
    ran++;
    let any = false;
    for (const key of Object.keys(tot)) { tot[key] += r.viol[key]; if (r.viol[key]) any = true; }
    if (any) { bad++; badSet.add(k); if (!firstWhy) firstWhy = `#${k} ` + r.why.join(' ; '); }
    if (r.viol.C2) stuckSet.add(k);
    for (const e of r.regress) { regressBy[e.by]++; if (r.viol.C2) stuckRegressBy[e.by]++; }
    logLoss.lost += r.logLoss.lost; logLoss.lostDraw += r.logLoss.lostDraw; logLoss.total += r.logLoss.total;
    if (r.logLoss.lost) logLoss.games++;
  }
  return { ran, bad, tot, firstWhy, label, badSet, stuckSet, logLoss, regressBy, stuckRegressBy };
}
export const fmt = (r) => `${r.label}: ${r.bad}/${r.ran} 局出事 ` + JSON.stringify(r.tot) + (r.firstWhy ? '\n   例：' + r.firstWhy : '');

// ═══════════════════════════════════════════════════════════════════════
// 決定性六步重現（玩家回報序列；legacy）
// ═══════════════════════════════════════════════════════════════════════
/** 造一局 legacy、seat0（Vic）重抽 2 次 ⇒ seat1（哭啦）可補抽 2 張。 */
export function makeLegacyPending2(M) {
  let g = null;
  resetEngineRng(4242);
  for (let k = 0; k < 400 && !g; k++) {
    const c = M.createGame({ name: 'Vic', entries: LEGACY_THIN }, { name: '哭啦', entries: LEGACY_FAT }, pool, { firstChoicePreferences: ['random', 'random'] });
    if (c.mulliganCounts[0] === 2 && c.mulliganCounts[1] === 0) g = c;
  }
  assert.ok(g, '前提：造得出「seat0 重抽 2 次、seat1 0 次」的 legacy 局');
  assert.deepEqual(g.pendingMulliganDraw, [0, 2]);
  assert.deepEqual(g.mulliganRevealConfirmed, [true, false]);
  return g;
}
/**
 * 玩家回報的六步（Vic＝seat0 重抽 2 次；哭啦＝seat1 補抽 2 張）。
 *   房間的每一次寫入都走推送端規則（mergeForSetupPush；BASE 沒有 ⇒ 整份覆蓋）。
 */
export function sixSteps(M) {
  const { applyAction, resolveRoomUpdate, shouldSkipStalePush, canBeInitialActiveCard } = M;
  const mergeForSetupPush = pushMerge(M);
  const g0 = makeLegacyPending2(M);
  const place = (s, i) => { const c = s.players[i].hand.find((x) => canBeInitialActiveCard(pool.get(x.cardId))); return applyAction(s, { type: 'PLACE_ACTIVE', iid: c.iid, senderIdx: i }, pool); };
  // 哭啦（seat1，較少重抽）先擺場＋確認揭示＋按準備；Vic 才能擺場
  let k = applyAction(g0, { type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx: 1 }, pool);
  k = place(k, 1);
  k = applyAction(k, { type: 'FINISH_SETUP', senderIdx: 1 }, pool);
  assert.deepEqual(k.setupDone, [false, true]);
  // ① 房間＝哭啦推送落地後的快照；Vic 收到後擺場＋按準備 ⇒ S_v2
  let room = clone(mergeForSetupPush(k, clone(g0), 1));
  let vic = resolveRoomUpdate(clone(g0), clone(room), CTX(0)).game;
  vic = place(vic, 0);
  vic = applyAction(vic, { type: 'FINISH_SETUP', senderIdx: 0 }, pool);
  const S_v2 = clone(vic);
  assert.equal(S_v2.phase, 'setup'); assert.deepEqual(S_v2.setupDone, [true, true]); assert.deepEqual(S_v2.pendingMulliganDraw, [0, 2]);
  assert.equal(S_v2.players[1].hand.length, 6); assert.equal(S_v2.players[1].deck.length, 47);
  // ② Vic 的 push 落地
  room = clone(mergeForSetupPush(S_v2, room, 0));
  // ③ 哭啦收到 S_v2，補抽 2 張 ⇒ S_k3；push 落地
  let ku = resolveRoomUpdate(k, clone(room), CTX(1)).game;
  ku = applyAction(ku, { type: 'MULLIGAN_DRAW_DECISION', count: 2, senderIdx: 1 }, pool);
  const S_k3 = clone(ku);
  assert.equal(S_k3.players[1].hand.length, 8); assert.equal(S_k3.players[1].deck.length, 45);
  assert.deepEqual(S_k3.pendingMulliganDraw, [0, 0]); assert.deepEqual(S_k3.mulliganPostBenchOpen, [false, true]);
  if (!shouldSkipStalePush(S_k3, room)) room = clone(mergeForSetupPush(S_k3, room, 1));
  assert.equal(room.players[1].hand.length, 8, '③ 房間應有哭啦補抽後的 8 張');
  const roomAfter3 = clone(room);
  // ④ Vic 收到哭啦補抽
  const d4 = resolveRoomUpdate(vic, clone(room), CTX(0));
  assert.equal(d4.kind, 'merge-setup'); vic = d4.game;
  assert.equal(vic.players[1].hand.length, 8, '④ Vic 端應看到哭啦 8 張');
  // ⑤ Vic 的【舊 echo】：S_v2 因 409 重試晚一步落地（推送端）；接著 Vic poll 到房間
  const roomBefore5 = clone(room);
  if (!shouldSkipStalePush(S_v2, room)) room = clone(mergeForSetupPush(S_v2, room, 0));
  const d5 = resolveRoomUpdate(vic, clone(room), CTX(0));
  const vicAfter5 = d5.game ?? vic;
  // ⑤' 收端獨立驗證：晚到的舊房間版本（＝原封不動的 S_v2）直接送到 Vic 端（推送端合併救不到這條路）
  const d5b = resolveRoomUpdate(vic, clone(S_v2), CTX(0));
  const vicEcho = d5b.game ?? vic;
  // ⑥ 哭啦 poll 到房間（或 Vic 推進後的 playing）
  if (vicAfter5.phase === 'playing') room = clone(vicAfter5);   // Vic 推 playing（setup×playing 不會被 skip）
  const d6 = resolveRoomUpdate(ku, clone(room), CTX(1));
  const kuAfter6 = d6.game ?? ku;
  return { g0, S_v2, S_k3, roomAfter3, roomBefore5, roomAfter5: room, vic: vicAfter5, vicEcho, ku: kuAfter6, d5, d6 };
}
