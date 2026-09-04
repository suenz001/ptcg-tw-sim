#!/usr/bin/env node
/**
 * ⭐⭐⭐v6.309 開局 setup 合併：**共享房間 ＋ 自己的舊 echo ＋ 推送延遲**（legacy 與互動式都跑）。
 *
 * 玩家回報（休閒對戰 v6.306 房 W8FB）：「補抽的牌他原本有抽到，又被系統放回去，下回合依序又把那兩張抽回來」
 * ＝ 領到的補抽被洗回牌庫頂。
 *
 * 既有的 scripts/test-opening-sync-fuzz.mjs 為什麼一直是綠的（三個盲點，本檔逐一補上）：
 *   ① 第一行 `if (base.openingFlow !== 'interactive') return null` ⇒ legacy 開局一局都沒跑過
 *   ② 模型裡沒有「共享房間」也沒有「自己的舊 echo」：收端只從對手的 outbox 取快照 ⇒ 模擬不出
 *      「我的舊 push 晚一步落地、把房間裡對手較新的那一半蓋回去、然後兩端都 poll 到它」
 *   ③ checkInvariants 一進 playing 就 return，而本 bug 的**終態正是 playing**；I7 只斷言 players[me]
 *
 * 模型（與線上休閒一致）：
 *   ・兩端各自 applyAction 後把整份盤面 push；push **在途、可亂序落地**；落地時走推送端規則
 *     （shouldSkipStalePush → mergeForSetupPush）寫進**共享房間**
 *   ・poll 拿到的是房間現況（含自己的 echo；小機率拿到晚到的較舊房間版本）→ resolveRoomUpdate
 *
 * 不變式：
 *   I8  merge-setup 後每個座位 setupSeatRank 不減；deck 不增；hand＋bench＋active 不減（＝沒有任何一張牌被洗回）
 *   I9  任一端進 playing（merge-advance 或 adopt）時，每座位 deck ≤ 該座位本人當下的本地 deck、
 *       hand ≥ 該座位本人當下的本地 hand（adopt 路徑也納入）
 *   I10 openingFlow==='interactive' 進 playing 時必 openingFinalized===true
 *   I11 收斂後 deck 張數＝60 − 7 − 6 獎賞 − 官方 NET 補抽 − 先手首抽（補抽一律全領 ⇒ 少一張就是被吃掉）
 *   C2  收斂後雙方都在 playing（不卡死）、同一局、雙方看到的盤面手牌相同
 *
 * 另有：決定性六步重現（玩家回報的那一序列）、根因 B（互動式建局即雙定案 → 從未結算）、
 *       tryAdvanceToPlaying level-triggered、推送端 phase 倒退、接線（room-oracle／room.ts／+page）、
 *       HEAD-FAIL（改過的每個檔各自還原 BASE blob）與 ≥8 個突變（各紅在預期斷言）。
 *
 * Run: node scripts/test-v6309-setup-merge-room-echo.mjs
 *   ⚠ v6.310：模型本體在 scripts/lib/setup-room-model.mjs（可跑兩端不同版本）；推送端多了 log 合併（test-v6310）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
// ⭐v6.310 共享房間模型抽到 scripts/lib/setup-room-model.mjs（test-v6310 的混版模型共用同一支；每局重設引擎 PRNG）
import {
  ROOT, SRC, bundle, pool, LEGACY_THIN, LEGACY_FAT, MIXED, BURST_ONLY,
  rnd, setSeed, clone, CTX, refRank, runMany, fmt, sixSteps,
} from './lib/setup-room-model.mjs';

let pass = 0, fail = 0;
const T = async (n, f) => { try { await f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ═══════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════
const M = await bundle(null);

await T('[F1] sync-guards 匯出 setupSeatRank，且與參考實作在 2000 個隨機盤面上逐一相同（含互動式 0/1 階）', () => {
  assert.equal(typeof M.setupSeatRank, 'function', 'sync-guards 沒有 export setupSeatRank');
  assert.equal(M.SETUP_SEAT_RANK_MAX, 6);
  setSeed(7);
  for (let k = 0; k < 2000; k++) {
    const inter = rnd() < 0.5;
    const s = {
      openingFlow: inter ? 'interactive' : undefined,
      openingDone: inter ? [rnd() < 0.5, rnd() < 0.5] : undefined,
      openingFinalized: inter ? rnd() < 0.5 : undefined,
      setupDone: [rnd() < 0.5, rnd() < 0.5],
      mulliganRevealConfirmed: [rnd() < 0.5, rnd() < 0.5],
      pendingMulliganDraw: [rnd() < 0.5 ? 0 : 2, rnd() < 0.5 ? 0 : 1],
      mulliganPostBenchOpen: [rnd() < 0.5, rnd() < 0.5],
    };
    for (const i of [0, 1]) assert.equal(M.setupSeatRank(s, i), refRank(s, i), '#' + k + ' seat' + i + ' ' + JSON.stringify(s));
  }
  // 階梯的邊界值
  const legacy0 = { setupDone: [false, false], mulliganRevealConfirmed: [false, false], pendingMulliganDraw: [2, 0], mulliganPostBenchOpen: [false, false] };
  assert.equal(M.setupSeatRank(legacy0, 0), 2); assert.equal(M.setupSeatRank(legacy0, 1), 4);
  const top = { setupDone: [true, true], mulliganRevealConfirmed: [true, true], pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, true] };
  assert.equal(M.setupSeatRank(top, 0), 6); assert.equal(M.setupSeatRank(top, 1), 5);
  const inter = { openingFlow: 'interactive', openingDone: [false, true], openingFinalized: false, setupDone: [false, false], mulliganRevealConfirmed: [true, true], pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, false] };
  assert.equal(M.setupSeatRank(inter, 0), 0); assert.equal(M.setupSeatRank(inter, 1), 1);
});

await T('[F1] mergeSetupMonotonic：對手側整組同源（rank 較高者），己側恆本地；非互動式對 incoming 不舊時逐欄位＝v6.308 規則', () => {
  const g = M.createGame({ name: 'A', entries: LEGACY_FAT }, { name: 'B', entries: LEGACY_FAT }, pool);
  assert.equal(g.openingFlow, undefined);
  const mk = (o) => Object.assign(clone(g), o);
  // 對手（seat1）較舊的 incoming：本地已看到對手補抽（pending 0、mpb 開），incoming 還在補抽前
  const L = mk({ setupDone: [true, true], mulliganRevealConfirmed: [true, true], pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, true] });
  L.players[1] = { ...L.players[1], hand: [...L.players[1].hand, ...L.players[1].deck.slice(0, 2)], deck: L.players[1].deck.slice(2) };
  const I = mk({ setupDone: [true, true], mulliganRevealConfirmed: [true, true], pendingMulliganDraw: [0, 2], mulliganPostBenchOpen: [false, false] });
  const m = M.mergeSetupMonotonic(L, I, 0);
  assert.equal(m.players[1].hand.length, L.players[1].hand.length, '對手補抽後的手牌被舊 incoming 洗回');
  assert.deepEqual(m.pendingMulliganDraw, [0, 0]); assert.deepEqual(m.mulliganPostBenchOpen, [false, true], 'post-bench 視窗被舊 echo 關掉');
  // 同源：不可以出現「pending 是新的、手牌是舊的」
  const m2 = M.mergeSetupMonotonic(I, L, 0);   // 反向：本地舊、incoming 新 ⇒ 採 incoming 那一半
  assert.equal(m2.players[1].hand.length, L.players[1].hand.length); assert.deepEqual(m2.mulliganPostBenchOpen, [false, true]);
  // 己側恆本地（即使 incoming 聲稱我更前進）
  const m3 = M.mergeSetupMonotonic(I, L, 1);
  assert.equal(m3.players[1].hand.length, I.players[1].hand.length, '己側不可以被 incoming 改寫');
  assert.deepEqual(m3.pendingMulliganDraw, [0, 2]);
  // 非互動式、incoming 不舊：逐欄位＝v6.308 的 OR／MIN／per-player
  const legacyMerge = (local, incoming, me) => ({
    ...incoming,
    players: (me === 0 ? [local.players[0], (local.setupDone[1] && !incoming.setupDone[1]) ? local.players[1] : incoming.players[1]]
      : [(local.setupDone[0] && !incoming.setupDone[0]) ? local.players[0] : incoming.players[0], local.players[1]]),
    setupDone: [local.setupDone[0] || incoming.setupDone[0], local.setupDone[1] || incoming.setupDone[1]],
    mulliganRevealConfirmed: [local.mulliganRevealConfirmed[0] || incoming.mulliganRevealConfirmed[0], local.mulliganRevealConfirmed[1] || incoming.mulliganRevealConfirmed[1]],
    pendingMulliganDraw: [Math.min(local.pendingMulliganDraw[0], incoming.pendingMulliganDraw[0]), Math.min(local.pendingMulliganDraw[1], incoming.pendingMulliganDraw[1])],
    mulliganPostBenchOpen: (me === 0 ? [local.mulliganPostBenchOpen[0], incoming.mulliganPostBenchOpen[1]] : [incoming.mulliganPostBenchOpen[0], local.mulliganPostBenchOpen[1]]),
  });
  // 同一座位的快照必在同一條鏈上：列舉「鏈上」的狀態（里程碑只增），本地取鏈上任一點、incoming 對手側取 ≥ 本地的點
  const chain = [
    { sd: false, mrc: false, pmd: 2, mpb: false }, { sd: true, mrc: false, pmd: 2, mpb: false }, { sd: true, mrc: true, pmd: 2, mpb: false },
    { sd: true, mrc: true, pmd: 0, mpb: true }, { sd: true, mrc: true, pmd: 0, mpb: false },
  ];
  let n = 0;
  for (const me of [0, 1]) for (let a = 0; a < chain.length; a++) for (let b = a; b < chain.length; b++) for (let c = 0; c < chain.length; c++) for (let d = 0; d <= c; d++) {
    const opp = 1 - me;
    const set = (o, i, st) => { o.setupDone[i] = st.sd; o.mulliganRevealConfirmed[i] = st.mrc; o.pendingMulliganDraw[i] = st.pmd; o.mulliganPostBenchOpen[i] = st.mpb; };
    const Lx = mk({ setupDone: [false, false], mulliganRevealConfirmed: [false, false], pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, false] });
    const Ix = clone(Lx);
    set(Lx, opp, chain[a]); set(Ix, opp, chain[b]);      // 對手側：incoming ≥ 本地
    set(Lx, me, chain[c]); set(Ix, me, chain[d]);        // 己側：本地 ≥ incoming
    assert.deepEqual(M.mergeSetupMonotonic(Lx, Ix, me), legacyMerge(Lx, Ix, me), `me=${me} a=${a} b=${b} c=${c} d=${d}`);
    n++;
  }
  assert.ok(n >= 400, '矩陣太小 ' + n);
});

await T('[F2] mergeForSetupPush：同局 setup×setup 才合併；不同局／非 setup／不知座位 ⇒ 原樣', () => {
  assert.equal(typeof M.mergeForSetupPush, 'function', 'sync-guards 沒有 export mergeForSetupPush');
  const g = M.createGame({ name: 'A', entries: LEGACY_FAT }, { name: 'B', entries: LEGACY_FAT }, pool);
  const mine = Object.assign(clone(g), { setupDone: [true, false], pendingMulliganDraw: [0, 0] });
  const cur = Object.assign(clone(g), { setupDone: [false, true], pendingMulliganDraw: [0, 0] });
  const out = M.mergeForSetupPush(mine, cur, 0);
  assert.deepEqual(out.setupDone, [true, true], '房間裡對手較新的那一半沒有保住');
  assert.strictEqual(M.mergeForSetupPush(mine, cur, null), mine);
  assert.strictEqual(M.mergeForSetupPush(mine, null, 0), mine);
  assert.strictEqual(M.mergeForSetupPush(mine, { ...cur, id: 'other' }, 0), mine);
  assert.strictEqual(M.mergeForSetupPush({ ...mine, phase: 'playing' }, cur, 0).phase, 'playing');
});

await T('[F2] 推送端：自己兩發 push 亂序落地（BENCH 晚於 FINISH_MULLIGAN_POST_BENCH），房間不得退回 rank 5', () => runOwnOutOfOrder(M));
await T('[F2] shouldSkipStalePush：同局房間已 playing、我還推 setup ⇒ skip（鏡射收端 rule 6）', () => {
  const g = M.createGame({ name: 'A', entries: LEGACY_FAT }, { name: 'B', entries: LEGACY_FAT }, pool);
  const setupS = clone(g), playingS = Object.assign(clone(g), { phase: 'playing', log: [] });
  assert.equal(M.shouldSkipStalePush(setupS, playingS), true, '同局 playing→setup 倒退沒有被推送端擋住');
  assert.equal(M.shouldSkipStalePush(playingS, setupS), false, '正對照：setup→playing 前進不可以被擋');
  assert.equal(M.shouldSkipStalePush(setupS, setupS), false, '正對照：setup×setup 不擋');
});

await T('⭐⭐⭐[決定性重現] 玩家回報的六步序列：舊 echo 不得把補抽洗回、不得推進到 playing、哭啦不得少 2 張', () => {
  const r = sixSteps(M);
  assert.equal(r.roomAfter5.players[1].hand.length, 8, '⑤ 推送端：Vic 的舊 echo 把房間裡哭啦的補抽蓋回 6 張');
  assert.notEqual(r.vic.phase, 'playing', '⑤ Vic 端不得因舊 echo 推進到 playing');
  assert.equal(r.vic.players[1].hand.length, 8, '⑤ Vic 端哭啦手牌被洗回');
  assert.notEqual(r.vicEcho.phase, 'playing', '⑤\' 收端：晚到的舊房間版本讓 Vic 推進到 playing');
  assert.equal(r.vicEcho.players[1].hand.length, 8, '⑤\' 收端：晚到的舊房間版本把哭啦手牌洗回');
  assert.deepEqual(r.vicEcho.mulliganPostBenchOpen, [false, true], '⑤\' 收端：舊 echo 關掉了哭啦的補抽後視窗');
  assert.equal(r.ku.phase, 'setup'); assert.equal(r.ku.players[1].hand.length, 8, '⑥ 哭啦被 adopt 成少 2 張');
  assert.deepEqual(r.ku.mulliganPostBenchOpen, [false, true], '哭啦補抽後放備戰的視窗必須還開著（維持現狀）');
  // 之後哭啦關視窗 ⇒ 房間 ⇒ 雙方進 playing，8 張保住
  let ku = M.applyAction(r.ku, { type: 'FINISH_MULLIGAN_POST_BENCH', senderIdx: 1 }, pool);
  let room = clone(M.mergeForSetupPush(ku, r.roomAfter5, 1));
  const dv = M.resolveRoomUpdate(r.vic, clone(room), CTX(0));
  assert.equal(dv.game?.phase, 'playing', 'Vic 端收到後應推進');
  assert.ok(dv.game.players[1].hand.length >= 8);
  assert.equal(dv.game.players[1].deck.length, 45 - (dv.game.firstPlayerIdx === 1 ? 1 : 0), '進 playing 後哭啦牌庫張數（45 − 先手首抽）');
  const dk = M.resolveRoomUpdate(ku, clone(dv.game), CTX(1));
  assert.equal(dk.kind, 'adopt'); assert.equal(dk.game.players[1].deck.length, dv.game.players[1].deck.length);
});

await T('⭐⭐⭐[fuzz legacy] 共享房間＋舊 echo＋推送延遲，300 局隨機交錯：I8/I9/I11/C1/C2 全部 0', () => {
  const r = runMany(M, 'legacy', [LEGACY_THIN, LEGACY_THIN], false, 300);
  console.log('   ' + fmt(r));
  assert.ok(r.ran >= 250, '實際跑到的局數太少 ' + r.ran);
  assert.equal(r.bad, 0, fmt(r));
});
await T('⭐⭐⭐[fuzz 互動式] 同一模型，300 局（含建局即雙定案 → 從未結算的根因 B）：I8/I9/I10/I11/C1/C2 全部 0', () => {
  const r = runMany(M, 'interactive', [MIXED, BURST_ONLY], true, 300);
  console.log('   ' + fmt(r));
  assert.ok(r.ran >= 250, '實際跑到的局數太少 ' + r.ran);
  assert.equal(r.bad, 0, fmt(r));
});

await T('[F3 根因 B] 互動式建局當下雙方就定案（有自動重抽）⇒ createGame 直接結算：openingFinalized 且補抽＝NET', () => {
  let found = 0;
  for (let k = 0; k < 600 && found < 5; k++) {
    const g = M.createGame({ name: 'A', entries: MIXED }, { name: 'B', entries: MIXED }, pool);
    if (g.openingFlow !== 'interactive') continue;
    if (g.openingChoicePending[0] || g.openingChoicePending[1]) continue;
    if (g.mulliganCounts[0] === 0 && g.mulliganCounts[1] === 0) continue;
    found++;
    const [m1, m2] = g.mulliganCounts;
    assert.equal(g.openingFinalized, true, '建局即雙定案卻沒結算（log 寫「可選擇多抽」但 pending 是 [0,0]）');
    assert.deepEqual(g.pendingMulliganDraw, [Math.max(0, m2 - m1), Math.max(0, m1 - m2)]);
    assert.deepEqual(g.mulliganRevealConfirmed, [m2 === 0, m1 === 0]);
  }
  assert.ok(found >= 3, '前提：造不出「建局即雙定案且有重抽」的局 ' + found);
});

await T('[F3] tryAdvanceToPlaying level-triggered：雙定案未結算 ⇒ 先結算（補抽 NET）、不推進；結算後才照原規則推進', () => {
  let g = null;
  for (let k = 0; k < 50 && !g; k++) { const c = M.createGame({ name: 'A', entries: LEGACY_FAT }, { name: 'B', entries: LEGACY_FAT }, pool); if (c.mulliganCounts[0] === 0 && c.mulliganCounts[1] === 0) g = c; }
  assert.ok(g, '前提：造得出雙方都沒重抽的 legacy 局');
  const place = (s, i) => { const c = s.players[i].hand.find((x) => M.canBeInitialActiveCard(pool.get(x.cardId))); return M.applyAction(s, { type: 'PLACE_ACTIVE', iid: c.iid, senderIdx: i }, pool); };
  let s = place(place(g, 0), 1);
  s = M.applyAction(s, { type: 'FINISH_SETUP', senderIdx: 0 }, pool);
  s = M.applyAction(s, { type: 'FINISH_SETUP', senderIdx: 1 }, pool);
  assert.equal(s.phase, 'playing', '正對照：legacy 雙準備直接開打');
  const stuck = Object.assign(clone(s), { phase: 'setup', openingFlow: 'interactive', openingDone: [true, true], openingFinalized: false,
    mulliganCounts: [1, 0], mulliganRevealedHands: { p1: ['x'], p2: [] }, pendingMulliganDraw: [0, 0], mulliganRevealConfirmed: [true, true] });
  const out = M.tryAdvanceToPlaying(stuck);
  assert.equal(out.phase, 'setup', '未結算就推進 ⇒ seat1 的 1 張補抽被吃掉');
  assert.equal(out.openingFinalized, true, '沒有 level-triggered 結算');
  assert.deepEqual(out.pendingMulliganDraw, [0, 1]);
  assert.deepEqual(out.mulliganRevealConfirmed, [true, false]);
  // 領完補抽＋確認 ⇒ 推進
  let t = M.applyAction(out, { type: 'MULLIGAN_DRAW_DECISION', count: 1, senderIdx: 1 }, pool);
  t = M.applyAction(t, { type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx: 1 }, pool);
  t = M.applyAction(t, { type: 'FINISH_MULLIGAN_POST_BENCH', senderIdx: 1 }, pool);
  assert.equal(t.phase, 'playing');
  // 反向：未定案的互動式仍不推進（不會反向卡死也不會誤推）
  const notDone = Object.assign(clone(stuck), { openingDone: [false, true], setupDone: [false, true] });
  assert.equal(M.tryAdvanceToPlaying(notDone).phase, 'setup');
});

// ── 接線（推送端兩個後端＋前端座位＋診斷指紋）───────────────────────────────
function fnBody(src, header, open) {
  const a = src.indexOf(header); assert.ok(a >= 0, '找不到 ' + header.slice(0, 40));
  let i = open ? src.indexOf(open, a) + open.length - 1 : src.indexOf('{', a), d = 0;
  assert.ok(i >= a, '找不到函式本體起點');
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(a, i + 1); } }
  throw new Error('括號不平衡');
}
await T('[F2 接線] room-oracle.ts 與 room.ts 的 pushGameState 都寫入 mergeForSetupPush 的結果、都收 opts.mySeat', () => {
  for (const [name, src] of [['room-oracle.ts', SRC.oracle], ['room.ts', SRC.fire]]) {
    assert.ok(/import \{ shouldSkipStalePush, mergeForSetupPush \} from '\.\/sync-guards';/.test(src), name + ' 沒 import mergeForSetupPush');
    const body = fnBody(src, 'export async function pushGameState(', '): Promise<void> {');
    assert.ok(/opts\?: \{ mySeat\?: 0 \| 1 \| null \}/.test(body), name + ' pushGameState 沒有 opts.mySeat');
    assert.ok(/const toWrite = (?:\(typeof mergeForSetupPush === 'function'\) \? )?mergeForSetupPush\(gameState, cur, opts\?\.mySeat\)/.test(body), name + ' 沒有走 mergeForSetupPush');
    assert.ok(/gameState: JSON\.parse\(JSON\.stringify\(toWrite\)\)/.test(body), name + ' 寫進房間的不是合併結果');
    assert.ok(!/gameState: JSON\.parse\(JSON\.stringify\(gameState\)\)/.test(body), name + ' 仍在寫未合併的 gameState');
    assert.ok(body.indexOf('shouldSkipStalePush(gameState, cur)') < body.indexOf('mergeForSetupPush('), name + ' 合併必須在防舊判定之後');
  }
});
await T('[F2 接線] +page.svelte 中央 pushTracked 把 myPlayerIndex 當座位傳給 pushGameState', () => {
  assert.ok(/try \{ await pushGameState\(code, st, \{ mySeat: \(typeof myPlayerIndex === 'number' \? myPlayerIndex : null\) \}\); _ok = true; \} finally \{ _endPushTrack\(m\);/.test(SRC.page),
    'pushTracked 沒有把座位傳給 pushGameState ⇒ 推送端永遠不合併（mergeForSetupPush 收到 undefined 直接原樣）');
});
await T('[F4 行為端] _casualNoteSetupAdoptLoss：setup→playing 的 adopt 讓我方倒退才送 casual-setup-adopt-loss，沒倒退 0 發', () => {
  assert.ok(/const CASUAL_DIAG_REASONS = \[[^\n]*'casual-setup-adopt-loss'[^\n]*\];/.test(SRC.page), 'CASUAL_DIAG_REASONS 沒有 casual-setup-adopt-loss（單行）');
  assert.ok(/_casualNoteSetupAdoptLoss\(decision\.kind, _sfxPrevGame, incoming\)/.test(SRC.page), 'adopt 路徑沒有接線');
  assert.ok(/setupLoss: \(reason === 'casual-setup-adopt-loss' \? _casualSetupLoss : null\)/.test(SRC.page), 'payload 沒帶 setupLoss');
  const body = fnBody(SRC.page, 'function _casualNoteSetupAdoptLoss(');
  const sent = [];
  const make = (myPlayerIndex) => new Function('myPlayerIndex', 'setupSeatRank', '_tSendClientDiag',
    'let _casualSetupLossSent = false; let _casualSetupLoss = null;\n'
    + body.replace(/: GameState \| null \| undefined/g, '').replace(/kind: string/g, 'kind').replace(/: void/g, '')
    + '\nreturn { f: _casualNoteSetupAdoptLoss, get sent() { return _casualSetupLossSent; }, get loss() { return _casualSetupLoss; } };')(myPlayerIndex, M.setupSeatRank, (r) => sent.push(r));
  const g = M.createGame({ name: 'A', entries: LEGACY_FAT }, { name: 'B', entries: LEGACY_FAT }, pool);
  const local = Object.assign(clone(g), { setupDone: [true, true], mulliganRevealConfirmed: [true, true], pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, false] });
  local.players[1] = { ...local.players[1], hand: [...local.players[1].hand, ...local.players[1].deck.slice(0, 2)], deck: local.players[1].deck.slice(2) };
  const good = Object.assign(clone(local), { phase: 'playing' });
  const bad = Object.assign(clone(g), { phase: 'playing', setupDone: [true, true], mulliganRevealConfirmed: [true, true], pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, false] });   // 我方 seat1 手牌少 2
  const h1 = make(1); h1.f('adopt', local, good); assert.equal(sent.length, 0, '沒倒退也送');
  h1.f('merge-setup', local, bad); assert.equal(sent.length, 0, '非 adopt 也送');
  h1.f('adopt', local, bad); assert.deepEqual(sent, ['casual-setup-adopt-loss']); assert.equal(h1.loss.handL, 9); assert.equal(h1.loss.handI, 7);
  h1.f('adopt', local, bad); assert.equal(sent.length, 1, '每頁一次');
  const h0 = make(0); h0.f('adopt', local, bad); assert.equal(sent.length, 1, 'seat0 沒倒退也送');
  const hs = make(null); hs.f('adopt', local, bad); assert.equal(sent.length, 1, '觀戰者也送');
});

// ═══════════════════════════════════════════════════════════════════════
// 突變（各紅在預期斷言；只捕捉 AssertionError，其餘照丟）
// ═══════════════════════════════════════════════════════════════════════
async function expectRed(name, expectRe, mut, run) {
  await T('[突變] ' + name, async () => {
    const MM = await bundle(mut);
    let msg = null;
    try { await run(MM); } catch (e) { if (!(e instanceof assert.AssertionError)) throw e; msg = e.message; }
    assert.ok(msg !== null, '突變沒有翻紅（守衛是安慰劑）');
    assert.ok(expectRe.test(msg), '紅的不是預期那一條：' + msg.slice(0, 200));
  });
}
const mutG = (a, b) => (src, which) => { if (which !== 'guards') return src; assert.ok(src.includes(a), '突變字串不在出貨碼裡：' + a.slice(0, 60)); return src.replace(a, b); };
const mutE = (a, b) => (src, which) => { if (which !== 'engine') return src; assert.ok(src.includes(a), '突變字串不在出貨碼裡：' + a.slice(0, 60)); return src.replace(a, b); };
const runSix = (MM) => { const r = sixSteps(MM); assert.equal(r.roomAfter5.players[1].hand.length, 8, '⑤ 推送端：舊 echo 蓋回'); assert.notEqual(r.vic.phase, 'playing', '⑤ 推進'); assert.equal(r.vic.players[1].hand.length, 8, '⑤ 洗回'); assert.notEqual(r.vicEcho.phase, 'playing', '⑤\' 收端推進'); assert.equal(r.vicEcho.players[1].hand.length, 8, '⑤\' 收端洗回'); assert.equal(r.ku.players[1].hand.length, 8, '⑥ 少 2 張'); };
/** 我自己的兩發 push 亂序落地：BENCH（rank 5）那發晚於 FINISH_MULLIGAN_POST_BENCH（rank 6）落地，房間不得退回 rank 5。 */
function runOwnOutOfOrder(MM) {
  const r = sixSteps(MM);
  // 哭啦：post-bench 開著、手牌 8；把 Vic 設回「尚未按準備」讓 FINISH_MULLIGAN_POST_BENCH 不會直接開打（只驗推送端）
  const ku = Object.assign(clone(r.ku), { setupDone: [false, true] });
  const roomBase = Object.assign(clone(r.roomAfter5), { setupDone: [false, true] });
  const b = ku.players[1].hand.find((c) => pool.get(c.cardId)?.subtype === 'Basic');
  const withBench = b ? MM.applyAction(ku, { type: 'BENCH_POKEMON', iid: b.iid, senderIdx: 1 }, pool) : ku;
  const finished = MM.applyAction(withBench, { type: 'FINISH_MULLIGAN_POST_BENCH', senderIdx: 1 }, pool);
  assert.equal(finished.mulliganPostBenchOpen[1], false);
  assert.equal(finished.phase, 'setup');
  let room = clone(MM.mergeForSetupPush(finished, roomBase, 1));     // 較新的那發先落地
  assert.equal(room.mulliganPostBenchOpen[1], false);
  room = clone(MM.mergeForSetupPush(withBench, room, 1));                 // 較舊的那發晚落地
  assert.equal(room.mulliganPostBenchOpen[1], false, '自己較舊的 push 亂序落地把房間裡自己較新的一階蓋回去');
  assert.equal(room.players[1].bench.length, finished.players[1].bench.length);
}
const runFuzzLegacy = (MM) => { const r = runMany(MM, 'legacy', [LEGACY_THIN, LEGACY_THIN], false, 80); assert.equal(r.bad, 0, fmt(r)); };
const runFuzzInter = (MM) => { const r = runMany(MM, 'interactive', [MIXED, BURST_ONLY], true, 80); assert.equal(r.bad, 0, fmt(r)); };

await expectRed('① 對手側一律採 incoming（＝v6.308 的 players 規則）⇒ 決定性重現紅在「收端洗回／推進」', /收端/,
  mutG("  const oppSrc: GameState = aheadSeat(L, I, opp) ?? I;", "  const oppSrc: GameState = I;"), runSix);
await expectRed('② setupSeatRank 常數（分不出前後）⇒ 決定性重現紅在收端', /收端/,
  mutG("export function setupSeatRank(s: GameState, i: 0 | 1): number {\n", "export function setupSeatRank(s: GameState, i: 0 | 1): number {\n  if (s) return 2;\n"),
  runSix);
await expectRed('③ 收端己側也走 rank pick 且平手採 incoming（不再恆本地）⇒ legacy fuzz I8 紅在「己側被改寫」', /己側盤面被合併改寫/,
  mutG("  const mySrc: GameState = mode === 'receive' ? L : (aheadSeat(L, I, me) ?? L);", "  const mySrc: GameState = (aheadSeat(L, I, me) ?? I);"),
  runFuzzLegacy);
await expectRed('③b 推端己側不走 rank pick（＝整份覆蓋）⇒ 自己兩發亂序落地時房間被蓋回 rank 5', /亂序/,
  mutG("  const mySrc: GameState = mode === 'receive' ? L : (aheadSeat(L, I, me) ?? L);", "  const mySrc: GameState = L;"),
  runOwnOutOfOrder);
await expectRed('④ 互動式未結算不壓在階梯底（佔位 [0,0] 被當成已領）⇒ 互動式 fuzz 紅', /I8|I9|I11|C1|C2/,
  mutG("    if (!s.openingFinalized) return 1;\n", "    if (!s.openingFinalized) { /* 突變 */ }\n"), runFuzzInter);
await expectRed('⑤ 拿掉「恰一端結算 ⇒ 整組採該端」（pending 各座位自取）⇒ 互動式 fuzz 紅', /I8|I9|I11|C1|C2/,
  mutG("  const finSrc: GameState | null = fL === fI ? null : (fL ? L : I);", "  const finSrc: GameState | null = null;"), runFuzzInter);
await expectRed('⑥ 推送端 mergeForSetupPush 原樣回傳（＝v6.308 整份覆蓋）⇒ 決定性重現紅在推送端', /推送端/,
  mutG("  const out = mergeSetupSeats(mine, cur, mySeat, 'push');", "  return mine; const out = mine;"), runSix);
await expectRed('⑦ 拿掉推送端 phase 倒退 skip ⇒ [F2] shouldSkipStalePush 紅', /倒退沒有被推送端擋住/,
  mutG("  if (current.phase === 'playing' && incoming.phase === 'setup') return true;\n  // 同局：playing×playing", "  // 同局：playing×playing"),
  (MM) => { const g = MM.createGame({ name: 'A', entries: LEGACY_FAT }, { name: 'B', entries: LEGACY_FAT }, pool); assert.equal(MM.shouldSkipStalePush(clone(g), Object.assign(clone(g), { phase: 'playing', log: [] })), true, '同局 playing→setup 倒退沒有被推送端擋住'); });
await expectRed('⑧ createGame 不結算建局即雙定案的互動式局 ⇒ [F3 根因 B] 紅', /沒結算|openingFinalized|deepStrictEqual|pendingMulliganDraw/,
  mutE("    ? finalizeOpening(state) : state;\n  let st = addLog(stateSettled,", "    ? state : state;\n  let st = addLog(stateSettled,"),
  (MM) => {
    for (let k = 0; k < 600; k++) {
      const g = MM.createGame({ name: 'A', entries: MIXED }, { name: 'B', entries: MIXED }, pool);
      if (g.openingFlow !== 'interactive' || g.openingChoicePending[0] || g.openingChoicePending[1] || (g.mulliganCounts[0] === 0 && g.mulliganCounts[1] === 0)) continue;
      assert.equal(g.openingFinalized, true, '建局即雙定案卻沒結算'); return;
    }
    throw new Error('造不出局');
  });
await expectRed('⑨ tryAdvanceToPlaying 拿掉 level-triggered 結算 ⇒ [F3] 紅在「未結算就推進」', /未結算就推進|level-triggered/,
  mutE("  const state = ensureOpeningFinalized(input);\n", "  const state = input;\n"),
  (MM) => {
    const g = MM.createGame({ name: 'A', entries: LEGACY_FAT }, { name: 'B', entries: LEGACY_FAT }, pool);
    const stuck = Object.assign(clone(g), { setupDone: [true, true], openingFlow: 'interactive', openingDone: [true, true], openingFinalized: false,
      mulliganCounts: [1, 0], pendingMulliganDraw: [0, 0], mulliganRevealConfirmed: [true, true] });
    const out = MM.tryAdvanceToPlaying(stuck);
    assert.equal(out.phase, 'setup', '未結算就推進'); assert.equal(out.openingFinalized, true, '沒有 level-triggered 結算');
  });
await expectRed('⑩ 平手改採本地（對手同階內的放備戰永遠看不到）⇒ [F1] 逐欄位＝v6.308 的矩陣紅', /deepStrictEqual|Expected values to be/,
  mutG("  const oppSrc: GameState = aheadSeat(L, I, opp) ?? I;", "  const oppSrc: GameState = aheadSeat(L, I, opp) ?? L;"),
  (MM) => {
    const g = MM.createGame({ name: 'A', entries: LEGACY_FAT }, { name: 'B', entries: LEGACY_FAT }, pool);
    const L = clone(g), I = clone(g);
    I.players[1] = { ...I.players[1], bench: [I.players[1].hand[0]], hand: I.players[1].hand.slice(1) };   // 對手同階內放了備戰
    assert.deepEqual(MM.mergeSetupMonotonic(L, I, 0).players[1], I.players[1]);
  });

// ═══════════════════════════════════════════════════════════════════════
// HEAD-FAIL：改過的每個檔各自還原成 BASE blob（拿得到歷史時才跑；淺複製 ⇒ 出聲 SKIP，不 fail-open）
// ═══════════════════════════════════════════════════════════════════════
{
  const BASE = process.env.V6309_BASE || '';
  if (!BASE) {
    console.log('ℹ HEAD-FAIL 對照需要 V6309_BASE=<sha>（沙盒手動跑）；CI 淺複製沒有歷史 ⇒ 略過這一節（上面的突變已各自證明非安慰劑）');
  } else {
    const GITDIR = process.env.V6309_REPO || ROOT;   // 沙盒的工作樹不是 git repo 時可指向 mount 的 repo
    const blob = (p) => { try { return execFileSync('git', ['-C', GITDIR, 'cat-file', '-p', BASE + ':' + p], { maxBuffer: 1 << 26 }).toString('utf8'); } catch { return null; } };
    const bg = blob('src/lib/game/sync-guards.ts'), be = blob('src/lib/game/engine.ts');
    if (!bg || !be) console.log('⚠⚠ SHALLOW-SKIP HEAD-FAIL：拿不到 BASE blob');
    else {
      await expectRed('[HEAD-FAIL sync-guards.ts=BASE] 決定性重現紅', /洗回|蓋回|推進|少 2 張/, (src, which) => (which === 'guards' ? bg : src), runSix);
      await expectRed('[HEAD-FAIL engine.ts=BASE] 根因 B 紅', /沒結算/, (src, which) => (which === 'engine' ? be : src), (MM) => {
        for (let k = 0; k < 600; k++) {
          const g = MM.createGame({ name: 'A', entries: MIXED }, { name: 'B', entries: MIXED }, pool);
          if (g.openingFlow !== 'interactive' || g.openingChoicePending[0] || g.openingChoicePending[1] || (g.mulliganCounts[0] === 0 && g.mulliganCounts[1] === 0)) continue;
          assert.equal(g.openingFinalized, true, '建局即雙定案卻沒結算'); return;
        }
        throw new Error('造不出局');
      });
      await T('[HEAD-FAIL sync-guards.ts=BASE] legacy fuzz 300 局的紅數（主證明：BASE ≫ 0，修後 0）', async () => {
        const MB = await bundle((src, which) => (which === 'guards' ? bg : src));
        const r = runMany(MB, 'legacy@BASE', [LEGACY_THIN, LEGACY_THIN], false, 300);
        console.log('   ' + fmt(r));
        const r2 = runMany(MB, 'interactive@BASE', [MIXED, BURST_ONLY], true, 300);
        console.log('   ' + fmt(r2));
        // ⚠ 區間而非等於：這個數字在 v6.309 之前不可重現（引擎洗牌走全域 Math.random、狀態跨局累積），
        //   實作者自報的「99/300、87/300」與審查者跑出的「119/300、83/300」都只是當時的一次採樣。
        //   v6.310 起每局重設 PRNG 才可重現，但守衛仍只斷言「BASE 明顯 > 0、HEAD == 0」。
        assert.ok(r.bad > 20 && r2.bad > 20, 'BASE 竟然（幾乎）全綠 ⇒ fuzz 模型沒有重現得出來');
      });
    }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
