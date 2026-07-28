#!/usr/bin/env node
/**
 * 守衛：互動式開局（閃焰王牌｜瞬間爆發力）在**線上雙端各自結算**下的合併正確性。
 * v6.053 批3／批4。
 *
 * 為什麼需要這一網：休閒線上不是伺服器權威 —— 兩端各自 `applyAction` 後推**整份盤面**，
 * 收端靠 `resolveRoomUpdate` → `mergeSetupMonotonic` 決定要保留誰的哪一半。
 * 互動式開局是第一個「setup 階段雙方都會改自己那半的 mulliganCounts／手牌／揭示」的機制，
 * 而既有 merge 規則是在「legacy 開局的 mulliganCounts 由 createGame 一次寫定、之後不變」
 * 的前提下寫的 → 直接套用會出現覆蓋、回朔、卡死、甚至補抽重發。
 *
 * ⭐最高優先的守衛是**等價性**：沒有這張卡的對局（全站絕大多數）合併結果必須逐欄位不變。
 *
 * Run: node scripts/test-opening-online-sync.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-oos-s.js'), E = join(ROOT, '.x-oos-e.ts'), O = join(ROOT, '.x-oos-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { createGame, applyAction, isOpeningInProgress, tryAdvanceToPlaying, effectiveOpeningDone, ensureOpeningFinalized } from './src/lib/game/engine';\n"
  + "export { resolveRoomUpdate, mergeSetupMonotonic, shouldSkipStalePush } from './src/lib/game/sync-guards';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const {
  createGame, applyAction, isOpeningInProgress, tryAdvanceToPlaying, effectiveOpeningDone,
  resolveRoomUpdate, mergeSetupMonotonic, shouldSkipStalePush,
} = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

const BURST = '13974';   // 閃焰王牌（M1L, I 標）｜瞬間爆發力
const BASIC = '19174';   // 迷唇姐（基礎）
const ENERGY = '14128';  // 基本【超】能量（湊牌用）

function withSeed(seed, fn) {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
}
const deck = (entries) => ({ name: 'P', entries });
/** 沒有基礎、只有閃焰王牌 → 一定停在選擇點。 */
const burstOnly = [{ cardId: BURST, count: 4 }, { cardId: ENERGY, count: 56 }];
const noBurst = [{ cardId: BASIC, count: 8 }, { cardId: ENERGY, count: 52 }];

const CTX = (me) => ({ myPlayerIndex: me, roomRestartCount: 0, lastAdoptedRestartCount: 0,
  roomLastUndoApplyAt: 0, lastSeenUndoApplyAt: 0 });
/** 深拷貝，避免測試之間互相汙染。 */
const clone = (s) => JSON.parse(JSON.stringify(s));
/** 兩端互相合併一次（模擬雙方都收到對方的 push）。 */
function crossMerge(a, b) {
  return [
    resolveRoomUpdate(a, clone(b), CTX(0)).game,
    resolveRoomUpdate(b, clone(a), CTX(1)).game,
  ];
}
/** 開局結果指紋（兩端必須一致的欄位）。 */
const fp = (s) => JSON.stringify({
  counts: s.mulliganCounts, draw: s.pendingMulliganDraw, conf: s.mulliganRevealConfirmed,
  done: s.openingDone, pend: s.openingChoicePending, fin: !!s.openingFinalized,
  rev: s.mulliganRevealedHands,
  hands: s.players.map((p) => p.hand.map((c) => c.cardId)),
});

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

/**
 * P2 重抽一次之後改用閃焰王牌開局（counts=[0,1]、done[1]=true）。
 * ⚠不能只送一次 OPENING_MULLIGAN 就假設會定案 —— burstOnly 牌組重抽後仍然只有閃焰王牌，
 *   會再次停在選擇點；一路重抽下去是無限迴圈。第二步明確送 KEEP 才可控。
 */
function mulliganThenKeep(g, idx) {
  let s = applyAction(clone(g), { type: 'OPENING_MULLIGAN', senderIdx: idx }, pool);
  if (s.openingChoicePending?.[idx]) s = applyAction(s, { type: 'OPENING_KEEP', senderIdx: idx }, pool);
  assert.ok(s.openingDone?.[idx], '前提：該側已定案');
  assert.ok(s.mulliganCounts[idx] >= 1, '前提：重抽次數 +1');
  return s;
}

/** 建一局「雙方都停在選擇點」的互動式開局。 */
function bothPending() {
  const g = withSeed(9911, () => createGame(deck(burstOnly), deck(burstOnly), pool));
  assert.equal(g.openingFlow, 'interactive');
  assert.ok(g.openingChoicePending?.[0] && g.openingChoicePending?.[1], '前提：雙方都停在選擇點');
  return g;
}

// == 1-3：雙方「同時」各做一次選擇（Wilson 裁定不互等）=====================
T('*同時 KEEP x KEEP：合併後結算完成、兩端逐欄位一致', () => {
  const g = bothPending();
  const a = applyAction(clone(g), { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  const b = applyAction(clone(g), { type: 'OPENING_KEEP', senderIdx: 1 }, pool);
  assert.ok(!a.openingFinalized && !b.openingFinalized, '前提：單邊選擇不該結算');
  const [ma, mb] = crossMerge(a, b);
  for (const [who, m] of [['P1', ma], ['P2', mb]]) {
    assert.deepEqual(m.openingDone, [true, true], who + ' done');
    assert.ok(m.openingFinalized, who + ' 必須完成結算（否則開局卡住）');
    assert.deepEqual(m.pendingMulliganDraw, [0, 0], who + ' 補抽');
    assert.deepEqual(m.openingChoicePending, [false, false], who + ' pending');
  }
  assert.equal(fp(ma), fp(mb), '兩端必須收斂到同一個開局結果');
});

T('*同時 KEEP x MULLIGAN：重抽方的次數不被抹、對手拿得到補抽', () => {
  const g = bothPending();
  const a = applyAction(clone(g), { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  const b = mulliganThenKeep(g, 1);
  assert.ok(!a.openingFinalized && !b.openingFinalized, '前提：兩端本地都沒結算');
  const [ma, mb] = crossMerge(a, b);
  const m2 = mb.mulliganCounts[1];
  for (const [who, m] of [['P1', ma], ['P2', mb]]) {
    assert.equal(m.mulliganCounts[0], 0, who + ' P1 次數');
    assert.equal(m.mulliganCounts[1], m2, who + ' P2 次數不可被覆蓋回 0');
    assert.ok(m.openingFinalized, who + ' 結算');
    assert.equal(m.pendingMulliganDraw[0], m2, who + ' P1 應可多抽（MIN 合併會吃掉）');
    assert.equal(m.pendingMulliganDraw[1], 0, who + ' P2 不補抽');
    assert.equal(m.mulliganRevealConfirmed[0], false, who + ' P1 必須看過 P2 的揭示（OR 會復活 stale true）');
    assert.equal(m.mulliganRevealConfirmed[1], true, who + ' P2 無需確認');
    assert.ok((m.mulliganRevealedHands && m.mulliganRevealedHands.p2 || []).length >= 1, who + ' P2 的揭示手牌不可遺失');
  }
  assert.equal(fp(ma), fp(mb), '兩端收斂');
});

T('*同時 MULLIGAN x MULLIGAN：次數與手牌必須同源', () => {
  const g = bothPending();
  const a = applyAction(clone(g), { type: 'OPENING_MULLIGAN', senderIdx: 0 }, pool);
  const b = applyAction(clone(g), { type: 'OPENING_MULLIGAN', senderIdx: 1 }, pool);
  const [ma, mb] = crossMerge(a, b);
  for (const m of [ma, mb]) {
    assert.equal(m.mulliganCounts[0], a.mulliganCounts[0], 'P1 次數保留');
    assert.equal(m.mulliganCounts[1], b.mulliganCounts[1], 'P2 次數保留');
    assert.deepEqual(m.players[0].hand.map((c) => c.cardId), a.players[0].hand.map((c) => c.cardId),
      'P1 重抽後的手牌必須與它的次數同源');
    assert.deepEqual(m.players[1].hand.map((c) => c.cardId), b.players[1].hand.map((c) => c.cardId),
      'P2 重抽後的手牌必須與它的次數同源');
  }
  assert.equal(fp(ma), fp(mb), '兩端收斂');
});

// == 4：亂序 / stale snapshot ============================================
T('*較舊的 snapshot 晚到，不得讓對手的開局進度回朔', () => {
  const g = bothPending();
  const stale = clone(g);
  const b1 = applyAction(clone(g), { type: 'OPENING_MULLIGAN', senderIdx: 1 }, pool);
  let p1 = resolveRoomUpdate(clone(g), clone(b1), CTX(0)).game;
  const afterFresh = fp(p1);
  p1 = resolveRoomUpdate(p1, stale, CTX(0)).game;
  assert.equal(p1.mulliganCounts[1], b1.mulliganCounts[1], 'P2 次數被 stale 倒退');
  assert.deepEqual(p1.players[1].hand.map((c) => c.cardId), b1.players[1].hand.map((c) => c.cardId),
    'P2 手牌被 stale 倒退');
  assert.equal(fp(p1), afterFresh, 'stale 不得造成任何欄位變化');
});

// == 5-6：結算之後的動作 vs stale =========================================
T('*結算後領完補抽，stale 進來不得讓補抽重新發一次（作弊面）', () => {
  const g = bothPending();
  const a = applyAction(clone(g), { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  const b = mulliganThenKeep(g, 1);
  let p1 = crossMerge(a, b)[0];
  const n = p1.pendingMulliganDraw[0];
  assert.ok(n >= 1, '前提：P1 有補抽可領');
  const handBefore = p1.players[0].hand.length;
  p1 = applyAction(p1, { type: 'MULLIGAN_DRAW_DECISION', count: n, senderIdx: 0 }, pool);
  assert.equal(p1.pendingMulliganDraw[0], 0, '領完');
  assert.equal(p1.players[0].hand.length, handBefore + n, '手牌 +N');
  const merged = resolveRoomUpdate(p1, clone(b), CTX(0)).game;
  assert.equal(merged.pendingMulliganDraw[0], 0, '補抽被重新發放＝可重複領（openingFinalized 旗標的作用）');
  assert.equal(merged.players[0].hand.length, handBefore + n, '手牌不得再被加一次');
});

T('結算後確認過揭示，stale 不得把確認狀態洗掉', () => {
  const g = bothPending();
  const a = applyAction(clone(g), { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  const b = mulliganThenKeep(g, 1);
  let p1 = crossMerge(a, b)[0];
  p1 = applyAction(p1, { type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx: 0 }, pool);
  assert.equal(p1.mulliganRevealConfirmed[0], true, '前提：已確認');
  const merged = resolveRoomUpdate(p1, clone(b), CTX(0)).game;
  assert.equal(merged.mulliganRevealConfirmed[0], true, '確認狀態被 stale 洗掉');
});

// == 7-8：版本 skew（漸進部署期一定會發生）================================
T('*舊版 client（不認得 opening）直接完成 setup → 視同 KEEP，不得死結', () => {
  const g = bothPending();
  const oldSide = clone(g);
  oldSide.setupDone = [false, true];
  assert.equal(oldSide.openingDone[1], false);
  assert.equal(oldSide.openingChoicePending[1], true);
  assert.ok(effectiveOpeningDone(oldSide)[1], '逃生規則：已按準備 → 視為定案');
  const a = applyAction(clone(g), { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  const merged = resolveRoomUpdate(a, oldSide, CTX(0)).game;
  assert.ok(!isOpeningInProgress(merged), '新端不得被自己的 opening gate 永久擋死（setup 沒有自癒）');
  assert.ok(merged.openingFinalized, '應照常結算');
  assert.equal(merged.mulliganCounts[1], 0, '隱式 KEEP 不增加重抽次數');
});

T('*開局未定案時，tryAdvanceToPlaying 絕不推進（補抽被靜默吃掉＝公平性 bug）', () => {
  const g = bothPending();
  const bad = Object.assign(clone(g), { setupDone: [true, false], openingDone: [false, false],
    openingChoicePending: [true, true] });
  assert.ok(isOpeningInProgress(bad), '前提');
  assert.equal(tryAdvanceToPlaying(bad).phase, 'setup', '不得推進');
});

// == 9：重整續局 =========================================================
T('重整後本地無局 → 直接採用，opening 欄位原封（選擇視窗會重新出現）', () => {
  const g = bothPending();
  const d = resolveRoomUpdate(null, clone(g), CTX(0));
  assert.equal(d.kind, 'adopt');
  assert.deepEqual(d.game.openingChoicePending, g.openingChoicePending);
  assert.equal(d.game.openingFlow, 'interactive');
});

// == 10：legacy 零 diff（最重要）==========================================
T('**沒有這張卡的對局：新舊 merge 規則逐欄位 0 diff', () => {
  const g = withSeed(31337, () => createGame(deck(noBurst), deck(noBurst), pool));
  assert.equal(g.openingFlow, undefined, '前提：不走互動式');
  const legacyMerge = (local, incoming, me) => ({
    ...incoming,
    players: (me === 0
      ? [local.players[0], (local.setupDone[1] && !incoming.setupDone[1]) ? local.players[1] : incoming.players[1]]
      : [(local.setupDone[0] && !incoming.setupDone[0]) ? local.players[0] : incoming.players[0], local.players[1]]),
    setupDone: [local.setupDone[0] || incoming.setupDone[0], local.setupDone[1] || incoming.setupDone[1]],
    mulliganRevealConfirmed: [
      local.mulliganRevealConfirmed[0] || incoming.mulliganRevealConfirmed[0],
      local.mulliganRevealConfirmed[1] || incoming.mulliganRevealConfirmed[1]],
    pendingMulliganDraw: [
      Math.min(local.pendingMulliganDraw?.[0] ?? 0, incoming.pendingMulliganDraw?.[0] ?? 0),
      Math.min(local.pendingMulliganDraw?.[1] ?? 0, incoming.pendingMulliganDraw?.[1] ?? 0)],
    mulliganPostBenchOpen: (me === 0
      ? [local.mulliganPostBenchOpen?.[0] ?? false, incoming.mulliganPostBenchOpen?.[1] ?? false]
      : [incoming.mulliganPostBenchOpen?.[0] ?? false, local.mulliganPostBenchOpen?.[1] ?? false]),
  });
  let n = 0;
  for (const sdL of [[false, false], [true, false], [false, true], [true, true]]) {
    for (const sdI of [[false, false], [true, false], [false, true], [true, true]]) {
      for (const pmdL of [[0, 0], [2, 0], [0, 1]]) {
        for (const mrcI of [[false, false], [true, false], [true, true]]) {
          for (const me of [0, 1]) {
            const L = Object.assign(clone(g), { setupDone: sdL, pendingMulliganDraw: pmdL,
              mulliganPostBenchOpen: [true, false] });
            const I = Object.assign(clone(g), { setupDone: sdI, pendingMulliganDraw: [0, 0],
              mulliganRevealConfirmed: mrcI, mulliganPostBenchOpen: [false, true] });
            assert.deepEqual(mergeSetupMonotonic(L, I, me), legacyMerge(L, I, me),
              'me=' + me + ' sdL=' + sdL + ' sdI=' + sdI);
            n++;
          }
        }
      }
    }
  }
  assert.ok(n >= 200, '矩陣太小：' + n);
});

// == 11-12：其他分支不受干擾 ==============================================
T('setup 期間的推送不會被 log 長度防舊守衛擋掉（兩端 log 本來就會分歧）', () => {
  const g = bothPending();
  const a = mulliganThenKeep(g, 0);   // 兩個動作 → log 較長
  const b = applyAction(clone(g), { type: 'OPENING_KEEP', senderIdx: 1 }, pool);
  assert.notEqual(a.log.length, b.log.length, '前提：log 長度分歧');
  assert.equal(shouldSkipStalePush(a, b), false);
  assert.equal(shouldSkipStalePush(b, a), false);
});

T('opening 期間仍走 merge-setup，不被 undo / phantom / phase-rollback 分支誤殺', () => {
  const g = bothPending();
  const b = applyAction(clone(g), { type: 'OPENING_KEEP', senderIdx: 1 }, pool);
  const d = resolveRoomUpdate(clone(g), clone(b), Object.assign(CTX(0), { roomLastUndoApplyAt: 99 }));
  assert.equal(d.kind, 'merge-setup', '實際走了 ' + d.kind);
});

// == 13-15：錦標賽 / 前後端同步 / 呼叫端 ===================================
T('**錦標賽閒置判定：開局選擇期間不得把「已選完在等」的一方判成該動作者', () => {
  const seat = (gs) => {
    const sd0 = !!(gs.setupDone && gs.setupDone[0]), sd1 = !!(gs.setupDone && gs.setupDone[1]);
    const oc = gs.openingChoicePending;
    const oPend0 = !!(oc && oc[0]) && !sd0;
    const oPend1 = !!(oc && oc[1]) && !sd1;
    if (oPend0 || oPend1) { if (oPend0 && !oPend1) return 0; if (oPend1 && !oPend0) return 1; return -1; }
    const pmd = gs.pendingMulliganDraw || [0, 0];
    const mrc = gs.mulliganRevealConfirmed || [true, true];
    const mpb = gs.mulliganPostBenchOpen || [false, false];
    const p0mpb = !!mpb[0], p1mpb = !!mpb[1];
    if (p0mpb || p1mpb) { if (p0mpb && !p1mpb) return sd1 ? 0 : -1; if (p1mpb && !p0mpb) return sd0 ? 1 : -1; return -1; }
    if (!(sd0 && sd1)) {
      const m0 = (gs.mulliganCounts && gs.mulliganCounts[0]) || 0;
      const m1 = (gs.mulliganCounts && gs.mulliganCounts[1]) || 0;
      if (m0 === m1) { if (!sd0 && !sd1) return -1; return !sd0 ? 0 : 1; }
      const lessIdx = m0 < m1 ? 0 : 1;
      if (!(lessIdx === 0 ? sd0 : sd1)) return lessIdx;
      const moreIdx = 1 - lessIdx;
      if (!(moreIdx === 0 ? sd0 : sd1)) return moreIdx;
    }
    const owes = (i) => (Number(pmd[i]) > 0) || !mrc[i];
    if (owes(0) || owes(1)) { const b0 = owes(0), b1 = owes(1); if (b0 && !b1) return 0; if (b1 && !b0) return 1; return -1; }
    return -1;
  };
  const base = { setupDone: [false, false], mulliganPostBenchOpen: [false, false],
    pendingMulliganDraw: [0, 0], mulliganRevealConfirmed: [true, true] };
  assert.equal(seat(Object.assign({}, base, { mulliganCounts: [1, 0], openingChoicePending: [true, false] })), 0,
    'counts 不相等時必須指向「還要選」的那一側');
  assert.equal(seat(Object.assign({}, base, { mulliganCounts: [0, 1], openingChoicePending: [false, true] })), 1);
  assert.equal(seat(Object.assign({}, base, { mulliganCounts: [0, 0], openingChoicePending: [true, true] })), -1,
    '雙方都要選 → 不單判任一方');
  assert.equal(seat(Object.assign({}, base, { setupDone: [false, true], mulliganCounts: [0, 0],
    openingChoicePending: [true, true] })), 0, '舊 client 已 setupDone 就不算欠動作');
  assert.equal(seat(Object.assign({}, base, { mulliganCounts: [0, 0] })), -1);
  assert.equal(seat(Object.assign({}, base, { setupDone: [true, false], mulliganCounts: [0, 0] })), 1);
});

T('*前端 setupActorSeat 與伺服器 currentActorSeat 逐行同步（含 opening 分支）', () => {
  const pg = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const sv = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
  for (const pair of [['前端', pg, '_oPend0'], ['伺服器', sv, 'oPend0']]) {
    const name = pair[0], src = pair[1], pend = pair[2];
    const i = src.indexOf('const ' + pend + ' = !!(');
    assert.ok(i > 0, name + ' 缺少 opening 分支');
    const j = src.indexOf('lessIdx', i);
    assert.ok(j > i, name + ' opening 分支必須排在 mulligan 次數比較之前');
  }
});

T('*線上／錦標賽的 createGame 呼叫端都已放行（漏一處＝開新房互動、再來一局 legacy）', () => {
  for (const f of ['src/routes/game/+page.svelte', 'src/lib/game/room.ts',
    'src/lib/game/room-oracle.ts', 'oracle-admin/server_admin_patch.js']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    // 只看真正的程式碼行（註解裡提到欄位名不算）
    const bad = src.split('\n').filter((ln) => ln.includes('forceLegacyOpening: true')
      && !/^\s*(\/\/|\*|\/\*)/.test(ln));
    assert.equal(bad.length, 0, f + ' 仍鎖著 forceLegacyOpening：' + bad.join(' | '));
  }
});

console.log('\n=== ' + pass + ' PASS, ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
