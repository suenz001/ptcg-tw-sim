#!/usr/bin/env node
/**
 * ⭐⭐⭐v6.310 推送端 setup 合併：log 回歸修正 ＋ 混版歸因（v6.309 的獨立審查抓到兩條；v6.309 尚未部署，本版是部署前提）。
 *
 * 【⚠1 log 整段丟失 — 成立，本版修】mergeSetupSeats 的基底是房間現況（`...I`）；push 模式下 I＝房間 ⇒ 除了逐座位覆寫的
 *   欄位外一律採房間的值 —— setup 期間會變的只有 `log` ⇒ 推送端把自己這一筆的 log 整段丟掉，收端再 `...incoming`
 *   ⇒ 整個 setup 階段的紀錄（含「選擇補抽 2 張」）對雙方都消失。
 *   修：`mergeSetupLogs`＝共同前綴 ＋ 房間的尾 ＋ 我的尾（多重集合差去掉已落地的同一行）。
 *   ⚠ 審查者建議「取較長者」—— 平長不同尾（我 [a,b,c,e]、房間 [a,b,c,d]）會把我的 e 永久丟掉，A1 有正對照。
 *
 * 【⚠2 混版新增卡局 — 不成立，本版不加逃生口】審查者用「同一個 k 的新×舊 vs 舊×舊」逐局配對，算出 3/300 新增卡局。
 *   本檔重跑（surrogate 舊 client 與真 v6.308 blob 兩種，四臂數字逐一相同）：那三局（#11／#37／#183）在
 *   「有逃生口」與「沒有逃生口」下**完全相同**，trace 顯示成因全是舊 client 自己三筆亂序整份覆蓋、把房間從 playing
 *   洗回 setup（舊×舊也有的型態；v6.309 F2b 就是修這個）。新 client 拒寫自己的舊 echo（正向）之後兩臂**軌跡分歧**，
 *   逐局配對從那一刻起就不是同一局 —— 「新增」是配對假象，不是回歸。
 *   ⇒ 判準改成**歸因**（C 節）：每一次落地若讓房間裡某座位 rank 退回／把 playing 洗回 setup，記下是誰推的。
 *   新 client 的推送端合併只取 rank 高者、playing→setup 有 skip ⇒ **新 client 的退回次數必為 0**（含卡局的局）；
 *   統計上混版卡局 37→15／25（舊×舊 → 新×舊／舊×新），從沒變多。C2 反面對照：把新 client 的推送端合併拿掉
 *   （＝v6.308 推送），退回次數立刻 > 0 —— 模型量得到新 client 造成的退回，C 節不是安慰劑。
 *   ⚠ 混版仍有「兩邊都壞」的局（只有雙方都升到新版才真的修好）—— 首頁 changelog 已提醒。
 *
 * 【模型】scripts/lib/setup-room-model.mjs（與 test-v6309 共用）；舊 client＝對 HEAD 的 sync-guards 做三處突變
 *   （推送端整份覆蓋、沒有 playing→setup skip、收端換回 v6.308 的 OR／MIN／對手側採 incoming）；legacy 局的引擎與
 *   resolveRoomUpdate 本體 v6.309 沒動 ⇒ 等價。沙盒給 V6310_BASE_OLD=<v6.308 sha> 時用真 blob 對跑（C3）驗 surrogate。
 *   ⚠ 引擎洗牌走全域 Math.random ⇒ 模型每局重設 PRNG，四臂同一個 k 是同一副洗牌（審查者第一版沒對齊跑出假警報）。
 *
 * Run: node scripts/test-v6310-setup-merge-escape-hatch.mjs
 *   沙盒：V6310_BASE=<v6.309 sha> V6310_BASE_OLD=<v6.308 sha> V6310_REPO=<repo> 多跑 HEAD-FAIL 與真舊碼對照。
 */
import { execFileSync } from 'node:child_process';
import { transformSync } from 'esbuild';
import assert from 'node:assert';
import {
  ROOT, SRC, bundle, LEGACY_THIN, MIXED, BURST_ONLY,
  clone, runMany, fmt, sixSteps,
} from './lib/setup-room-model.mjs';

let pass = 0, fail = 0;
const T = async (n, f) => { try { await f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const mutG = (a, b) => (src, which) => { if (which !== 'guards') return src; assert.ok(src.includes(a), '突變字串不在出貨碼裡：' + a.slice(0, 70)); return src.replace(a, b); };
const chain = (...ms) => (src, which) => ms.reduce((s, m) => m(s, which), src);

// ═══════════════════════════════════════════════════════════════════════
// 舊 client（v6.308）的 surrogate：三處突變
// ═══════════════════════════════════════════════════════════════════════
const OLD_RECEIVE = `  const base: GameState = {
    ...incoming,
    players: (me === 0
      ? [local.players[0], (local.setupDone[1] && !incoming.setupDone[1]) ? local.players[1] : incoming.players[1]]
      : [(local.setupDone[0] && !incoming.setupDone[0]) ? local.players[0] : incoming.players[0], local.players[1]]) as GameState['players'],
    setupDone: [local.setupDone[0] || incoming.setupDone[0], local.setupDone[1] || incoming.setupDone[1]] as [boolean, boolean],
    mulliganRevealConfirmed: [local.mulliganRevealConfirmed[0] || incoming.mulliganRevealConfirmed[0], local.mulliganRevealConfirmed[1] || incoming.mulliganRevealConfirmed[1]] as [boolean, boolean],
    pendingMulliganDraw: [Math.min(local.pendingMulliganDraw?.[0] ?? 0, incoming.pendingMulliganDraw?.[0] ?? 0), Math.min(local.pendingMulliganDraw?.[1] ?? 0, incoming.pendingMulliganDraw?.[1] ?? 0)] as [number, number],
    mulliganPostBenchOpen: (me === 0
      ? [local.mulliganPostBenchOpen?.[0] ?? false, incoming.mulliganPostBenchOpen?.[1] ?? false]
      : [incoming.mulliganPostBenchOpen?.[0] ?? false, local.mulliganPostBenchOpen?.[1] ?? false]) as [boolean, boolean],
  };
  if (local.openingFlow === 'interactive' || incoming.openingFlow === 'interactive') throw new Error('surrogate 只模擬 legacy 局');
  return base;
`;
const OLD_PUSH = "  if (mySeat !== 0 && mySeat !== 1) return mine;\n  if (!cur || cur.id !== mine.id) return mine;\n";
const oldClientMut = chain(
  mutG("  return mergeSetupSeats(local, incoming, me, 'receive');\n", OLD_RECEIVE),
  mutG(OLD_PUSH, "  return mine;\n"),
  mutG("  if (current.phase === 'playing' && incoming.phase === 'setup') return true;\n", ""),
);
const GITDIR = process.env.V6310_REPO || ROOT;
const blobOf = (sha, p) => { try { return execFileSync('git', ['-C', GITDIR, 'cat-file', '-p', sha + ':' + p], { maxBuffer: 1 << 26 }).toString('utf8'); } catch { return null; } };

const M = await bundle(null);
const MOLD = await bundle(oldClientMut);
const L = (...xs) => xs.map((x) => ({ turn: 0, playerIndex: null, message: x }));
const drawLine = (g) => (g.log ?? []).some((e) => /選擇補抽 2 張/.test(e.message ?? ''));

// ═══════════════════════════════════════════════════════════════════════
// A. log 合併的單元
// ═══════════════════════════════════════════════════════════════════════
await T('A1 mergeSetupLogs：共同前綴＋房間尾＋我的尾；多重集合差；平長不同尾不丟行（審查者「取較長者」的反例）', () => {
  assert.equal(typeof M.mergeSetupLogs, 'function', 'sync-guards 沒有 export mergeSetupLogs');
  assert.deepEqual(M.mergeSetupLogs(L('a', 'b', 'c', 'x', 'y'), L('a', 'b', 'c', 'x')), L('a', 'b', 'c', 'x', 'y'), '我的尾含已落地的 x ⇒ 只補 y');
  assert.deepEqual(M.mergeSetupLogs(L('a', 'b', 'c', 'e'), L('a', 'b', 'c', 'd')), L('a', 'b', 'c', 'd', 'e'), '平長不同尾：取較長者會把 e 永久丟掉');
  assert.deepEqual(M.mergeSetupLogs(L('a', 'b', 'c', 'x', 'y'), L('a', 'b', 'c', 'd', 'x')), L('a', 'b', 'c', 'd', 'x', 'y'), '房間尾先、我的尾去重後接上');
  assert.deepEqual(M.mergeSetupLogs(L('a', 'x', 'x'), L('a', 'x')), L('a', 'x', 'x'), '多重集合：兩張同名卡放備戰是兩行相同文字，第二行是真的');
  assert.deepEqual(M.mergeSetupLogs(L('a', 'x', 'x'), L('a', 'd', 'x')), L('a', 'd', 'x', 'x'), '多重集合（尾段有房間行）：兩張同名卡的第二行是真的');
  assert.deepEqual(M.mergeSetupLogs(L('a', 'b'), L('a', 'b', 'c')), L('a', 'b', 'c'), '我比房間短（本地被輪詢覆蓋前的快照）⇒ 房間的全留');
  assert.deepEqual(M.mergeSetupLogs(undefined, L('a')), L('a'));
});

// ═══════════════════════════════════════════════════════════════════════
// B. 行為端：真引擎六步，房間 log 必須留著「選擇補抽」那一行；fuzz 新×新 log 零流失
// ═══════════════════════════════════════════════════════════════════════
await T('B1 六步：哭啦補抽落地後房間 log 有「選擇補抽 2 張」；Vic 舊 echo 落地後仍在；兩端最後都看得到', () => {
  const r = sixSteps(M);
  assert.ok(drawLine(r.S_k3), '前提：哭啦本地 log 有補抽那一行');
  assert.ok(drawLine(r.roomAfter3), '③ 推送端把哭啦自己的 log 整段丟掉（房間停在 createGame 那幾行）');
  assert.ok(drawLine(r.roomAfter5), '⑤ Vic 舊 echo 落地後房間 log 沒了補抽那一行');
  assert.ok(r.roomAfter5.log.length >= r.S_k3.log.length, `房間 log ${r.roomAfter5.log.length} < 哭啦本地 ${r.S_k3.log.length}`);
  assert.ok(drawLine(r.vic), '⑤ Vic 端 poll 之後看不到補抽那一行');
  assert.ok(drawLine(r.ku), '⑥ 哭啦端 poll 之後自己的補抽那一行不見了');
});
/**
 * ⚠ 不要求 100%：剩下 1~2% 的流失來自「對手已進 playing、我最後一筆 setup 動作被 F2b 正確 skip」—— 那是 skip 的既有語義
 *   （v6.308 同樣丟），不為了 log 改 skip。v6.309 是「幾乎全丟」（HEAD-FAIL 用同一條紅），所以上界 3% 不是安慰劑。
 */
const checkLogLoss = (r, label) => {
  assert.equal(r.logLoss.lostDraw, 0, `${label} 補抽那一行有流失 ${r.logLoss.lostDraw}`);
  assert.ok(r.logLoss.lost <= r.logLoss.total * 0.03, `${label} log 流失 ${r.logLoss.lost}/${r.logLoss.total}（補抽行 ${r.logLoss.lostDraw}）`);
};
await T('B2 fuzz 新×新 300 局 legacy＋300 局互動式：「選擇補抽」行零流失、setup 動作的 log 流失 ≤ 3%（v6.309 幾乎全丟），且 0 違規', () => {
  for (const [label, decks, inter] of [['legacy', [LEGACY_THIN, LEGACY_THIN], false], ['interactive', [MIXED, BURST_ONLY], true]]) {
    const r = runMany(M, label, decks, inter, 300);
    console.log(`   ${label} log：產生 ${r.logLoss.total} 行、流失 ${r.logLoss.lost}（補抽行 ${r.logLoss.lostDraw}）、有流失的局 ${r.logLoss.games}/${r.ran}`);
    assert.equal(r.bad, 0, fmt(r));
    checkLogLoss(r, label);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// C. 混版消融 ＋ 歸因（本版對 ⚠2 的裁定）
// ═══════════════════════════════════════════════════════════════════════
const N = 300;
const diff = (a, b) => [...a].filter((k) => !b.has(k));
const OO_CACHE = new Map();   // 舊×舊只跟 MO 有關 ⇒ 每個 MO 跑一次（突變只換 MN）
function ablation(MN, MO, tag, { skipNN = false } = {}) {
  if (!OO_CACHE.has(MO)) OO_CACHE.set(MO, runMany([MO, MO], tag + ' 舊×舊', [LEGACY_THIN, LEGACY_THIN], false, N));
  const OO = OO_CACHE.get(MO);
  const NO = runMany([MN, MO], tag + ' 新×舊', [LEGACY_THIN, LEGACY_THIN], false, N);
  const ON = runMany([MO, MN], tag + ' 舊×新', [LEGACY_THIN, LEGACY_THIN], false, N);
  const NN = skipNN ? null : runMany([MN, MN], tag + ' 新×新', [LEGACY_THIN, LEGACY_THIN], false, N);
  const row = (x, newSeat) => ({
    bad: x.bad, stuck: x.stuckSet.size,
    pairedNewStuck: diff(x.stuckSet, OO.stuckSet), pairedNewBad: diff(x.badSet, OO.badSet).length, fixed: diff(OO.badSet, x.badSet).length,
    regressNew: x.regressBy[newSeat], regressOld: x.regressBy[1 - newSeat], stuckRegressNew: x.stuckRegressBy[newSeat], stuckRegressOld: x.stuckRegressBy[1 - newSeat],
  });
  const out = { OO: { bad: OO.bad, stuck: OO.stuckSet.size, ran: OO.ran, regress: OO.regressBy }, NO: row(NO, 0), ON: row(ON, 1), NN: NN ? row(NN, 0) : null };
  console.log(`   ${tag} 舊×舊 ${OO.bad}/${OO.ran} 出事（卡局 ${OO.stuckSet.size}；退回事件 ${OO.regressBy.join('/')}）`);
  for (const [k, r] of [['新×舊', out.NO], ['舊×新', out.ON], ['新×新', out.NN]]) {
    if (!r) continue;
    console.log(`   ${tag} ${k}：出事 ${r.bad} 卡局 ${r.stuck} ｜ 逐局配對：新增卡局 ${r.pairedNewStuck.length}${r.pairedNewStuck.length ? ' ' + JSON.stringify(r.pairedNewStuck) : ''} 新增違規 ${r.pairedNewBad} 修好 ${r.fixed} ｜ 退回事件 新 ${r.regressNew} 舊 ${r.regressOld}（卡局內 新 ${r.stuckRegressNew} 舊 ${r.stuckRegressOld}）`);
  }
  return out;
}
let ABL = null;
await T(`C1 ⭐⭐⭐ 混版歸因 ${N} 局 legacy：新 client 的落地**從不**讓房間退回（rank 下降／playing 洗回 setup）＝ 0；混版卡局／違規總數 ≤ 舊×舊；新×新 0 違規`, () => {
  ABL = ablation(M, MOLD, 'HEAD');
  assert.ok(ABL.OO.bad > 20, '舊×舊竟然（幾乎）全綠 ⇒ 模型沒有重現得出來');
  for (const k of ['NO', 'ON']) {
    assert.equal(ABL[k].regressNew, 0, k + ' 新 client 的推送讓房間退回了（這才是「新版製造卡局」的證據）');
    assert.ok(ABL[k].stuck <= ABL.OO.stuck, `${k} 混版卡局 ${ABL[k].stuck} > 舊×舊 ${ABL.OO.stuck}`);
    assert.ok(ABL[k].bad <= ABL.OO.bad, `${k} 混版出事 ${ABL[k].bad} > 舊×舊 ${ABL.OO.bad}`);
    // 逐局配對的「新增卡局」只是軌跡分歧後碰到的舊 client 既有卡局：那些局裡所有退回事件都是舊 client 推的
    assert.equal(ABL[k].stuckRegressNew, 0, k + ' 卡局的局裡有新 client 造成的退回');
  }
  assert.equal(ABL.NN.bad, 0, '新×新有違規');
  assert.equal(ABL.NN.regressNew + ABL.NN.regressOld, 0, '新×新竟有退回事件');
  assert.equal(ABL.NN.fixed, ABL.OO.bad, '新×新沒有把舊×舊出事的局全部修好');
});
await T('C2 反面對照：新 client 的推送端合併拿掉（＝v6.308 推送）⇒ 同一模型量到新 client 造成的退回 > 0（C1 不是安慰劑）', async () => {
  const MNOPUSH = await bundle(mutG(OLD_PUSH, "  return mine;\n"));
  const r = ablation(MNOPUSH, MOLD, '推送端不合併', { skipNN: true });
  assert.ok(r.NO.regressNew + r.ON.regressNew > 0, '推送端不合併也量不到新 client 的退回 ⇒ 歸因量測壞了');
});
{
  const OLD = process.env.V6310_BASE_OLD || '';
  if (!OLD) console.log('ℹ C3 真舊碼對照需要 V6310_BASE_OLD=<v6.308 sha>（沙盒手動跑）；CI 淺複製沒有歷史 ⇒ 略過');
  else {
    const og = blobOf(OLD, 'src/lib/game/sync-guards.ts'), oe = blobOf(OLD, 'src/lib/game/engine.ts');
    if (!og || !oe) console.log('⚠⚠ SHALLOW-SKIP C3：拿不到 v6.308 的 blob');
    else await T('C3 [真舊碼] 以 v6.308 的 sync-guards.ts＋engine.ts 當舊 client 重跑 C1：結論相同，且 surrogate 的四臂數字與真舊碼逐一相同', async () => {
      const MREAL = await bundle((src, which) => (which === 'guards' ? og : oe));
      const r = ablation(M, MREAL, '真舊碼');
      for (const k of ['NO', 'ON']) { assert.equal(r[k].regressNew, 0, k + ' 真舊碼：新 client 造成退回'); assert.ok(r[k].stuck <= r.OO.stuck); }
      assert.ok(ABL, '前提：C1 已跑');
      for (const k of ['OO', 'NO', 'ON']) {
        assert.equal(r[k].bad, ABL[k].bad, `${k} surrogate 出事 ${ABL[k].bad} ≠ 真舊碼 ${r[k].bad} ⇒ surrogate 不等價`);
        assert.equal(r[k].stuck, ABL[k].stuck, `${k} surrogate 卡局 ${ABL[k].stuck} ≠ 真舊碼 ${r[k].stuck}`);
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// D. 接線行為端（不是字串比對）：room-oracle.ts／room.ts 的 pushGameState **實跑**，寫進假伺服器的必須是合併結果＋log
// ═══════════════════════════════════════════════════════════════════════
function loadCjs(srcText, stubs) {
  const code = transformSync(srcText, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
  const mod = { exports: {} };
  const req = (id) => { if (!(id in stubs)) throw new Error('未預期的 import：' + id); return stubs[id]; };
  const f = new Function('module', 'exports', 'require', 'console', 'setTimeout', code + '\nreturn module.exports;');
  return f(mod, mod.exports, req, { warn() {}, error() {}, log() {} }, (fn) => fn());
}
function oracleStubs(server, G) {
  return {
    './oracle-client': {
      oracleAuth: async () => ({ uid: 'U1' }), oracleApi: async () => ({}),
      oracleGetRoom: async (c) => server.get(c),
      oracleUpsertRoom: async (c, d, v) => server.put(c, d, v),
      oracleDeleteRoom: async () => {}, oracleListRooms: async () => [],
      oraclePollRoom: () => () => {}, oracleListMessages: async () => [],
      oracleCurrentUid: () => 'U1', oracleListRoomsCombined: async () => [],
      ROOMS_UNCHANGED: Symbol('u'), ROOMS_COMBINED_UNSUPPORTED: Symbol('c'),
      isOracleTimeout: () => false, isOracleUploadBudgetTimeout: () => false, ORACLE_SIDEEFFECT_TIMEOUT_MS: 60000,
    },
    '$lib/firebase': { auth: { currentUser: null } },
    './engine': { createGame: () => { throw new Error('不該建局'); } },
    './sync-guards': G,
    '$lib/ui/stale-keep': { adoptOrKeep: (p, n) => ({ data: n ?? p, stale: n == null }) },
    './room': {
      SEAT_LAYOUT_VERSION: 1, TOTAL_SEATS: 10, SPECTATOR_SEATS: 8, HEARTBEAT_STALE_MS: 1,
      generateRoomCode: () => 'AAAA', findMySeatIdx: () => 0, countDeckCards: () => 60,
      bothPlayersReady: () => true, isSeatStale: () => false,
      LOBBY_HOST_AWAY_MS: 1, LOBBY_HOST_STALE_MS: 1, hostPresence: () => 'ok',
      isLobbyHostDead: () => false, isLobbyTooOld: () => false,
    },
  };
}
function fakeOracle(cur) {
  let doc = { code: 'ROOM', status: 'playing', seats: [], gameState: cur, _version: 5 };
  return { doc: () => doc, get: async () => ({ ...doc }), put: async (c, data) => { doc = { ...data, _version: doc._version + 1 }; return { ok: true, room: doc }; } };
}
function firestoreStubs(server, G) {
  const tx = { get: async () => ({ exists: () => true, data: () => ({ gameState: server.doc().gameState }) }), update: (ref, data) => { server.update(data); } };
  const fs = { doc: () => ({}), setDoc: async () => {}, updateDoc: async () => {}, onSnapshot: () => () => {}, getDoc: async () => ({ exists: () => false }), getDocs: async () => ({ docs: [] }),
    serverTimestamp: () => 0, collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}), orderBy: () => ({}), addDoc: async () => {}, deleteDoc: async () => {}, deleteField: () => null,
    runTransaction: async (db, fn) => fn(tx) };
  return { 'firebase/firestore': fs, '$lib/firebase': { db: {}, auth: { currentUser: null } }, './engine': { createGame: () => { throw new Error('不該建局'); } }, './sync-guards': G };
}
/** 六步的 ⑤：房間＝哭啦補抽後，Vic 推它的舊 echo S_v2 ⇒ 寫進去的必須保住 8 張、log 含補抽行 */
async function pushViaOracle(G, oracleSrc) {
  const r = sixSteps(M);
  const server = fakeOracle(clone(r.roomBefore5));
  const RO = loadCjs(oracleSrc, oracleStubs(server, G));
  await RO.pushGameState('ROOM', clone(r.S_v2), { mySeat: 0 });
  return { written: server.doc().gameState, r };
}
const assertMerged = (written, r, who) => {
  assert.equal(written.players[1].hand.length, 8, who + ' 寫進房間的是未合併的 gameState（哭啦補抽被舊 echo 蓋回 6 張）');
  assert.ok(drawLine(written), who + ' log 沒有補抽那一行');
  assert.equal(written.id, r.S_v2.id);
};
await T('D1 room-oracle.ts pushGameState 實跑：寫進假伺服器的 gameState 是合併結果（8 張）＋log', async () => {
  const { written, r } = await pushViaOracle(M, SRC.oracle);
  assertMerged(written, r, 'room-oracle');
});
await T('D2 room.ts（Firestore）pushGameState 實跑：tx.update 寫入的 gameState 同樣是合併結果＋log', async () => {
  const r = sixSteps(M);
  let updated = null;
  const server = { doc: () => ({ gameState: clone(r.roomBefore5) }), update: (d) => { updated = d; } };
  const RF = loadCjs(SRC.fire, firestoreStubs(server, M));
  await RF.pushGameState('ROOM', clone(r.S_v2), { mySeat: 0 });
  assert.ok(updated, 'room.ts 沒有呼叫 tx.update');
  assertMerged(updated.gameState, r, 'room.ts');
});
await T('D3 觀戰者／不知座位（mySeat null）：原樣寫入（不合併）', async () => {
  const r = sixSteps(M);
  const server = fakeOracle(clone(r.roomBefore5));
  const RO = loadCjs(SRC.oracle, oracleStubs(server, M));
  await RO.pushGameState('ROOM', clone(r.S_v2), { mySeat: null });
  assert.equal(server.doc().gameState.players[1].hand.length, 6);
});

// ═══════════════════════════════════════════════════════════════════════
// E. 突變（各紅在預期斷言；只捕 AssertionError）
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
const runAbl = (MM) => { const r = ablation(MM, MOLD, '突變', { skipNN: true }); for (const k of ['NO', 'ON']) { assert.equal(r[k].regressNew, 0, k + ' 新 client 的推送讓房間退回了'); assert.ok(r[k].stuck <= r.OO.stuck, k + ' 混版卡局變多'); } };
const runB1 = (MM) => { const r = sixSteps(MM); assert.ok(drawLine(r.roomAfter3), '③ 推送端把哭啦自己的 log 整段丟掉'); assert.ok(drawLine(r.roomAfter5), '⑤ Vic 舊 echo 落地後房間 log 沒了補抽那一行'); };
const runB2 = (MM) => { const r = runMany(MM, 'legacy', [LEGACY_THIN, LEGACY_THIN], false, 300); assert.equal(r.bad, 0, fmt(r)); checkLogLoss(r, 'legacy'); };

await expectRed('① log 不合併（沿用 mergeSetupSeats 的房間 log ＝ v6.309）⇒ B1 紅在「推送端把哭啦自己的 log 整段丟掉」', /log 整段丟掉/,
  mutG("  return { ...out, log: mergeSetupLogs(mine.log, cur.log) };", "  return out;"), runB1);
await expectRed('② log 改「取較長者」（審查者的建議）⇒ A1 紅在「平長不同尾」', /平長不同尾/,
  mutG("  const a = mine ?? [], b = cur ?? [];\n  const key = (e: T): string => JSON.stringify(e);", "  const a = mine ?? [], b = cur ?? [];\n  if (a.length <= b.length) return b.slice(0); if (a.length > b.length) return a.slice(0);\n  const key = (e: T): string => JSON.stringify(e);"),
  (MM) => { assert.deepEqual(MM.mergeSetupLogs(L('a', 'b', 'c', 'e'), L('a', 'b', 'c', 'd')), L('a', 'b', 'c', 'd', 'e'), '平長不同尾：取較長者會把 e 永久丟掉'); });
await expectRed('③ log 多重集合差改成集合（同文字只留一行）⇒ A1 紅在「兩張同名卡」', /兩張同名卡/,
  mutG("    if (n > 0) { seen.set(s, n - 1); continue; }", "    if (n > 0) { continue; }"),
  (MM) => { assert.deepEqual(MM.mergeSetupLogs(L('a', 'x', 'x'), L('a', 'd', 'x')), L('a', 'd', 'x', 'x'), '多重集合（尾段有房間行）：兩張同名卡的第二行是真的'); });
await expectRed('④ log 只取我的（丟掉房間的尾）⇒ B2 紅在 log 流失', /log 流失|補抽那一行有流失/,
  mutG("  return { ...out, log: mergeSetupLogs(mine.log, cur.log) };", "  return { ...out, log: mine.log };"), runB2);
await expectRed('⑤ 推送端不合併（＝v6.308 推送）⇒ C1 紅在「新 client 的推送讓房間退回了」', /新 client 的推送讓房間退回了/,
  mutG(OLD_PUSH, "  return mine;\n"), runAbl);
await expectRed('⑥ 推送端己側不走 rank pick（整份覆蓋己側）⇒ C1 紅在「新 client 的推送讓房間退回了」', /新 client 的推送讓房間退回了/,
  mutG("  const mySrc: GameState = mode === 'receive' ? L : (aheadSeat(L, I, me) ?? L);", "  const mySrc: GameState = L;"), runAbl);
await expectRed('⑦ 拿掉 playing→setup skip ⇒ C1 紅（新 client 把房間從 playing 洗回 setup 也算退回）', /新 client 的推送讓房間退回了/,
  mutG("  if (current.phase === 'playing' && incoming.phase === 'setup') return true;\n", ""), runAbl);
await expectRed('⑧ setup→playing 那一筆不接房間的 setup 尾段 log（＝v6.309）⇒ B2 紅在 log 流失', /log 流失|補抽那一行有流失/,
  mutG("  if (mine.phase === 'playing' && cur.phase === 'setup') return { ...mine, log: mergeSetupLogs(mine.log, cur.log) };\n", ""), runB2);
await T('[突變] ⑨ 接線：room-oracle.ts 的 import 少了 mergeForSetupPush（typeof 防衛讓它變靜默 no-op）⇒ D1 紅（行為端，不是字串比對）', async () => {
  const src = SRC.oracle.replace("import { shouldSkipStalePush, mergeForSetupPush } from './sync-guards';", "import { shouldSkipStalePush } from './sync-guards';");
  assert.notEqual(src, SRC.oracle, '突變字串不在出貨碼裡');
  const { shouldSkipStalePush } = M;
  let msg = null;
  try { const { written, r } = await pushViaOracle({ shouldSkipStalePush }, src); assertMerged(written, r, 'room-oracle'); }
  catch (e) { if (!(e instanceof assert.AssertionError)) throw e; msg = e.message; }
  assert.ok(msg && /未合併/.test(msg), '靜默 no-op 沒被抓到：' + msg);
});

// ═══════════════════════════════════════════════════════════════════════
// F. HEAD-FAIL（拿得到歷史時才跑；淺複製 ⇒ 出聲 SKIP，不 fail-open）
// ═══════════════════════════════════════════════════════════════════════
{
  const BASE = process.env.V6310_BASE || '';
  if (!BASE) console.log('ℹ HEAD-FAIL 需要 V6310_BASE=<v6.309 sha>（沙盒手動跑）；CI 淺複製沒有歷史 ⇒ 略過（上面的突變已各自證明非安慰劑）');
  else {
    const bg = blobOf(BASE, 'src/lib/game/sync-guards.ts');
    if (!bg) console.log('⚠⚠ SHALLOW-SKIP HEAD-FAIL：拿不到 v6.309 的 sync-guards.ts');
    else {
      const asBase = (src, which) => (which === 'guards' ? bg : src);
      await expectRed('[HEAD-FAIL sync-guards.ts=v6.309] B1 紅（log 整段丟掉）', /log 整段丟掉/, asBase, runB1);
      await expectRed('[HEAD-FAIL sync-guards.ts=v6.309] B2 紅（log 流失）', /log 流失|補抽那一行有流失/, asBase, runB2);
      await T('[HEAD-FAIL sync-guards.ts=v6.309] C1 在 v6.309 上**綠**：v6.309 的推送端合併本來就不製造混版退回（⚠2 不成立的直接證據）', async () => {
        const MB = await bundle(asBase);
        runAbl(MB);
      });
    }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
