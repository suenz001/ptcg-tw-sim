// v6.361 守衛 —— 站長裁定 D-10／D-11：先結算 on-KO 特性再判勝負 ＋ 引入「平手」
//
// 站長裁定逐字（2026-09-12）：
//   「應該先結算死亡宣告再判勝負，有可能雙方一起昏厥(剛好都是場上最後一隻寶可夢)，
//     就判定為平手請另開一版處理」
//
// 官方規則（PTCG RULES/PTCG_RULES.md，逐字）：
//   L455 「勝敗判定規則如下：1.拿完所有獎賞卡的玩家獲勝2.無法放置寶可夢至戰鬥場時，
//         則沒有寶可夢的玩家敗北 ／ 3.在自己的回合的最開始無法從牌庫抽卡時，無法抽卡的玩家敗北」
//   L622／L728／L894／L1668（四處一致）：
//         「可以從備戰區放置寶可夢至戰鬥場上的玩家獲勝。若雙方皆可以放置，或雙方皆不可放置，則為平手。」
//   L1460「（雙方皆為1隻備戰寶可夢都沒有時…）A: 為平手。」
//   L2404「（雙方的獎賞卡剩餘張數都為1張時，雙方各自獲得1張…）A: 為平手。」
//
// ⚠ 禁止恆真斷言（安慰劑 #27）；旗標層斷言（isDraw）一律**與盤面／log 併列**，不單獨成立（安慰劑 #28）。
//   主判準一律看 phase / winner / players[] 盤面 / log 次數。
// ⚠ 平手的表示法＝「game-over 但 winner 這個 key 不存在」——**不是本版發明的**，是全站既有慣例
//   （server_admin_patch.js casualSideResult / onMatchGameOver / 統計聚合、前端錦標賽「等待管理員裁定」）。
//   【F】節用行為端 ＋ HEAD-FAIL 錨把「錦標賽計分維持現行行為」這個決定釘住（Rule 41）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6361-s.js'), E = join(ROOT, '.v6361-e.ts'), O = join(ROOT, '.v6361-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, judgeEndgameV6361 } from './src/lib/game/engine';\n"
  + "export { buildSwissPlayersFromMatches, computeStandings } from './src/lib/tournament/swiss';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, judgeEndgameV6361, buildSwissPlayersFromMatches, computeStandings } = M;

// ── 卡池 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) all.push(c);
}
const pool = new Map(all.map((c) => [String(c.id), c]));
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };
const GENG = byId('19988');   // 耿鬼ex M6a 076/103 HP280 Stage2【惡】｜死亡宣告
const ICE = byId('19924');    // 急凍鳥 M6a HP120 Basic【水】非 ex（1 張獎賞）｜冰雹（全體 30）
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;

let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({
  name: 'P', active: null, bench: [], hand: [], deck: [], discard: [],
  prizes: [], abilityNamesUsedThisTurn: [], ...o,
});
const prizes = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const deck3 = () => [inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)];
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P({ name: 'A', deck: deck3(), prizes: prizes(6), ...p0 }),
            P({ name: 'B', deck: deck3(), prizes: prizes(6), ...p1 })],
  ...extra,
});

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

const withCoin = (heads, fn) => {
  const orig = Math.random;
  Math.random = () => (heads ? 0.1 : 0.9);
  try { return fn(); } finally { Math.random = orig; }
};
const act = (st, a, heads) => withCoin(heads !== false, () => {
  try { return applyAction(st, a, pool); }
  catch (e) { return { __err: e.message, log: [], players: [P(), P()] }; }
});
const LOGS = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l?.text ?? l));
const nLog = (r, s) => LOGS(r).filter((x) => x.includes(s)).length;
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const BN = (r, i) => r?.players?.[i]?.bench?.length;
const PZ = (r, i) => r?.players?.[i]?.prizes?.length;
const HASWIN = (r) => Object.prototype.hasOwnProperty.call(r ?? {}, 'winner') && r.winner != null;
const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const energyFor = (card, atkName) =>
  ((card.attacks || []).find((a) => a.name === atkName)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

/** 攻擊方＝急凍鳥（冰雹 30，全體）；防守方戰鬥位＝耿鬼ex（差 30 就昏厥） */
const board = ({ b0 = 0, b1 = 0, pz0 = 6, pz1 = 6, defPlain = false } = {}) => mk(
  { active: inst(ICE.id, { energyAttached: energyFor(ICE, '冰雹') }),
    bench: Array.from({ length: b0 }, () => inst(PLAIN.id)), prizes: prizes(pz0) },
  { active: defPlain ? inst(PLAIN.id, { damage: Number(PLAIN.hp) - 30 })
                     : inst(GENG.id, { damage: Number(GENG.hp) - 30 }),
    bench: Array.from({ length: b1 }, () => inst(PLAIN.id)), prizes: prizes(pz1) });
const run = (st, heads) => act(st, { type: 'ATTACK', attackIndex: atkIdx(ICE, '冰雹') }, heads);

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】harness 自驗（fixture 抓錯 ⇒ 後面全是假綠）');
{
  chk('0a 耿鬼ex = M6a、HP280、Stage2、【惡】、有特性「死亡宣告」',
    String(GENG.setCode) === 'M6a' && Number(GENG.hp) === 280 && GENG.stage === 'Stage2'
    && GENG.pokemonType === 'Darkness',
    JSON.stringify([GENG?.setCode, GENG?.hp, GENG?.stage]));
  chk('0b 死亡宣告卡面逐字（台灣官方 static/cards）',
    (GENG.abilities || []).find((a) => a.name === '死亡宣告')?.effect
    === '這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，自己擲1次硬幣。若為正面，則將使用招式的寶可夢【昏厥】。',
    String((GENG.abilities || []).find((a) => a.name === '死亡宣告')?.effect));
  chk('0c 急凍鳥（非 ex）｜冰雹、PLAIN 是無特性無效果的基礎【無】寶可夢 HP≥60',
    ICE.subtype !== 'ex' && Number(PLAIN.hp) >= 60 && PLAIN.pokemonType === 'Colorless',
    JSON.stringify([ICE?.subtype, PLAIN?.hp, PLAIN?.name]));
  chk('0d 哨兵：冰雹 30 真的把差 30 昏厥的耿鬼ex 打昏厥（正／反面都一樣）',
    D0(run(board({ b0: 1, b1: 1 }))) == null && D0(run(board({ b0: 1, b1: 1 }), false)) == null);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐⭐⭐站長裁定主情境：耿鬼ex 是自己最後一隻 ⇒ 死亡宣告**仍然結算**，再判勝負');
{
  const H = run(board({ b0: 1, b1: 0 }));            // 耿鬼ex 是 B 的最後一隻
  chk('A1 ⭐⭐⭐硬幣真的有擲、死亡宣告恰好啟動 1 次（HEAD：終局先判掉 ⇒ 0 次）',
    nLog(H, '「死亡宣告」啟動') === 1, LOGS(H).filter((x) => x.includes('死亡宣告')).join(' / '));
  chk('A2 ⭐⭐⭐攻擊方（急凍鳥）真的昏厥離場（HEAD：仍在場）',
    A0(H) == null && H.players[0].discard.some((c) => String(c.cardId) === String(ICE.id)),
    JSON.stringify([!!A0(H), H.players[0].discard.map((c) => c.cardId)]));
  chk('A3 ⭐死亡宣告結算完才判勝負：B 沒有可上場的寶可夢、A 還有備戰 ⇒ A 獲勝',
    H.phase === 'game-over' && H.winner === 0 && H.isDraw === undefined
    && BN(H, 0) === 1 && D0(H) == null && BN(H, 1) === 0,
    JSON.stringify([H.phase, H.winner, H.isDraw, BN(H, 0), BN(H, 1)]));
  chk('A4 ⭐獎賞順序不變：攻擊方先取 2 張（耿鬼ex 是 ex）⇒ 6−2=4；之後耿鬼ex 那側取 1 張 ⇒ 6−1=5',
    PZ(H, 0) === 4 && PZ(H, 1) === 5, JSON.stringify([PZ(H, 0), PZ(H, 1)]));

  const T = run(board({ b0: 1, b1: 0 }), false);     // 反對照：只差擲幣結果
  chk('A5 ⭐反對照（反面）：攻擊方完好留在場上、也有反面 log',
    !!A0(T) && A0(T).damage === 0 && nLog(T, '硬幣反面') === 1,
    JSON.stringify([!!A0(T), A0(T)?.damage, nLog(T, '硬幣反面')]));
  chk('A6 ⭐反對照（反面）：勝負與 HEAD 相同 —— A 獲勝、不是平手',
    T.phase === 'game-over' && T.winner === 0 && T.isDraw === undefined,
    JSON.stringify([T.phase, T.winner, T.isDraw]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐⭐平手：雙方都只剩最後一隻、且互相昏厥');
{
  const H = run(board({ b0: 0, b1: 0 }));
  chk('B1 ⭐⭐⭐雙方戰鬥場與備戰區都空了（真的互相昏厥，不是只判旗標）',
    A0(H) == null && BN(H, 0) === 0 && D0(H) == null && BN(H, 1) === 0,
    JSON.stringify([!!A0(H), BN(H, 0), !!D0(H), BN(H, 1)]));
  chk('B2 ⭐⭐⭐終局但**沒有勝方** ⇒ 平手（winner 這個 key 不存在，不是 0 也不是 1）',
    H.phase === 'game-over' && !HASWIN(H)
    && !Object.prototype.hasOwnProperty.call(H, 'winner'),
    JSON.stringify([H.phase, H.winner, Object.prototype.hasOwnProperty.call(H, 'winner')]));
  chk('B3 ⭐平手旗標與 log（補充斷言，不單獨成立）',
    H.isDraw === true && nLog(H, '本局平手') === 1 && String(H.winReason).includes('雙方'),
    JSON.stringify([H.isDraw, nLog(H, '本局平手'), H.winReason]));
  chk('B4 ⭐死亡宣告在平手情境照樣結算（硬幣有擲）',
    nLog(H, '「死亡宣告」啟動') === 1, LOGS(H).filter((x) => x.includes('死亡宣告')).join(' / '));

  const T = run(board({ b0: 0, b1: 0 }), false);
  chk('B5 ⭐⭐反對照（同一盤面只差擲幣）：反面 ⇒ 只有 B 沒有寶可夢 ⇒ A 獲勝，**不是**平手',
    T.phase === 'game-over' && T.winner === 0 && T.isDraw === undefined && !!A0(T),
    JSON.stringify([T.phase, T.winner, T.isDraw, !!A0(T)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】反對照：只有一方沒有可上場的寶可夢 ⇒ 該方敗北（不是平手）');
{
  // 防守方換成無特性的 PLAIN ⇒ 完全沒有 on-KO 佇列 ⇒ 走的是**完全沒被本版動到**的既有路徑
  const R = run(board({ b0: 1, b1: 0, defPlain: true }));
  chk('C1 ⭐無 on-KO 特性的一般 KO：B 場上空了 ⇒ A 獲勝、沒有平手旗標',
    R.phase === 'game-over' && R.winner === 0 && R.isDraw === undefined
    && D0(R) == null && BN(R, 1) === 0 && !!A0(R),
    JSON.stringify([R.phase, R.winner, R.isDraw, !!A0(R)]));
  chk('C2 ⭐同一條路徑的獎賞不變（PLAIN 非 ex ⇒ 取 1 張，6−1=5）',
    PZ(R, 0) === 5, String(PZ(R, 0)));
}

console.log('\n【D】反對照：雙方**都**還有備戰 ⇒ 不終局');
{
  const H = run(board({ b0: 1, b1: 1 }));
  chk('D1 ⭐雙方戰鬥位都昏厥、但兩邊都還有備戰 ⇒ phase 仍是 playing（不可誤判終局／平手）',
    H.phase === 'playing' && H.isDraw === undefined && !HASWIN(H)
    && A0(H) == null && BN(H, 0) === 1 && D0(H) == null && BN(H, 1) === 1,
    JSON.stringify([H.phase, H.winner, H.isDraw, BN(H, 0), BN(H, 1)]));
  chk('D2 ⭐這一條路徑死亡宣告一樣有結算（證明 D1 的 playing 不是「整支沒跑」）',
    nLog(H, '「死亡宣告」啟動') === 1 && H.players[0].discard.some((c) => String(c.cardId) === String(ICE.id)),
    JSON.stringify([nLog(H, '「死亡宣告」啟動'), !!A0(H)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】「取完所有獎賞獲勝」那條路徑不可被本版弄壞');
{
  // E1：完全沒有 on-KO 佇列的既有路徑（addPendingPrize 內部判終局）
  const R = run(board({ b0: 1, b1: 1, pz0: 1, defPlain: true }));
  chk('E1 ⭐取完最後 1 張獎賞 ⇒ 取獎方獲勝（既有路徑逐字不變、沒有平手旗標）',
    R.phase === 'game-over' && R.winner === 0 && R.isDraw === undefined && PZ(R, 0) === 0
    && nLog(R, '取得所有獎賞卡') >= 1,
    JSON.stringify([R.phase, R.winner, R.isDraw, PZ(R, 0)]));

  // E2：延後重判的路徑上，§14-① 仍然「只有一方取完 ⇒ 該方獲勝」（不可因為引入平手就變平手）
  const H = run(board({ b0: 1, b1: 1, pz0: 2 }));
  chk('E2 ⭐⭐攻擊方取完所有獎賞 ＋ 死亡宣告仍然結算 ⇒ 仍然是**攻擊方獲勝**（不是平手）',
    H.phase === 'game-over' && H.winner === 0 && H.isDraw === undefined
    && PZ(H, 0) === 0 && A0(H) == null && nLog(H, '「死亡宣告」啟動') === 1,
    JSON.stringify([H.phase, H.winner, H.isDraw, PZ(H, 0), !!A0(H), nLog(H, '「死亡宣告」啟動')]));

  // E3：雙方同時取完、且雙方都放得出戰鬥寶可夢 ⇒ 平手（PTCG_RULES L622 逐字）
  const D = run(board({ b0: 1, b1: 1, pz0: 1, pz1: 1 }));
  chk('E3 ⭐⭐⭐雙方同時取完所有獎賞、且都還有備戰 ⇒ **平手**（L622「若雙方皆可以放置…則為平手」）',
    D.phase === 'game-over' && !HASWIN(D) && D.isDraw === true
    && PZ(D, 0) === 0 && PZ(D, 1) === 0 && A0(D) == null,
    JSON.stringify([D.phase, D.winner, D.isDraw, PZ(D, 0), PZ(D, 1), !!A0(D)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【G】中央判定函式 judgeEndgameV6361 直接單元測（官方 §14 的編號順序）');
{
  const st = (a0, b0, a1, b1, pz0, pz1) => ({
    players: [
      { name: 'A', active: a0 ? inst(PLAIN.id) : null, bench: Array.from({ length: b0 }, () => inst(PLAIN.id)), prizes: prizes(pz0) },
      { name: 'B', active: a1 ? inst(PLAIN.id) : null, bench: Array.from({ length: b1 }, () => inst(PLAIN.id)), prizes: prizes(pz1) },
    ],
  });
  const J = (s, w) => judgeEndgameV6361(s, w);
  chk('G1 §14-② 雙方同時取完、雙方皆可放置 ⇒ 平手（winner=null）',
    J(st(1, 1, 1, 1, 0, 0), true).over === true && J(st(1, 1, 1, 1, 0, 0), true).winner === null);
  chk('G2 §14-② 雙方同時取完、只有一方放得出 ⇒ 放得出的那方獲勝',
    J(st(0, 0, 1, 1, 0, 0), true).winner === 1 && J(st(1, 1, 0, 0, 0, 0), true).winner === 0);
  chk('G3 §14-② 雙方同時取完、雙方都放不出 ⇒ 平手',
    J(st(0, 0, 0, 0, 0, 0), true).winner === null);
  chk('G4 ⭐§14-① 只有一方取完 ⇒ 該方獲勝（即使該方場上已空，也**不是**平手／不是對手贏）',
    J(st(0, 0, 1, 1, 0, 3), true).winner === 0 && J(st(1, 1, 1, 1, 3, 0), true).winner === 1,
    JSON.stringify([J(st(0, 0, 1, 1, 0, 3), true), J(st(1, 1, 1, 1, 3, 0), true)]));
  chk('G5 §14-③ 沒人取完、雙方都沒有可上場 ⇒ 平手（L1460）',
    J(st(0, 0, 0, 0, 3, 3), false).winner === null && J(st(0, 0, 0, 0, 3, 3), true).winner === null);
  chk('G6 §14-③ 沒人取完、只有一方沒有可上場 ⇒ 對手獲勝',
    J(st(0, 0, 1, 0, 3, 3), false).winner === 1 && J(st(1, 0, 0, 0, 3, 3), false).winner === 0);
  chk('G7 ⭐都還有寶可夢、也沒人取完 ⇒ over:false（一般 dispatch 末端不可誤判終局）',
    J(st(1, 0, 1, 0, 3, 3), false).over === false && J(st(1, 0, 1, 0, 3, 3), true).over === false);
  chk('G8 ⭐withPrizeRule=false 時**不**看獎賞（一般 dispatch 末端刻意不新增「獎賞 0 就終局」的路徑）',
    J(st(1, 0, 1, 0, 0, 0), false).over === false,
    JSON.stringify(J(st(1, 0, 1, 0, 0, 0), false)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】下游消費端：平手不可丟例外、不可算出負分（＋維持現行行為的 HEAD-FAIL 錨 Rule 41）');
{
  const regs = [{ uid: 'u1', name: 'P1' }, { uid: 'u2', name: 'P2' }];
  // F1 行為端：平手的對局在 TMATCH 會停在 status='playing'（onMatchGameOver 的 wSeat==null 早退）
  //    ⇒ 瑞士輪重建 standings 時「未結束 ⇒ 跳過」，雙方 0 分、無 W/L、不丟例外。
  let F1ok = true, F1err = '';
  let pl = [];
  try {
    pl = buildSwissPlayersFromMatches(
      [{ round: 1, p1uid: 'u1', p2uid: 'u2', winnerUid: null, status: 'playing' }], regs);
  } catch (e) { F1ok = false; F1err = e.message; }
  chk('F1 ⭐⭐平手（無 winner、match 未 done）餵進瑞士輪計分：不丟例外、雙方 0 分、無勝負紀錄',
    F1ok && pl.length === 2 && pl.every((p) => p.matchPoints === 0 && p.results.length === 0),
    F1err || JSON.stringify(pl.map((p) => [p.uid, p.matchPoints, p.results])));
  // F2 正對照：同一支函式，有勝方時照樣 +3（證明 F1 不是「整支沒跑」）
  const pl2 = buildSwissPlayersFromMatches(
    [{ round: 1, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1', status: 'done' }], regs);
  chk('F2 ⭐正對照：有勝方 ⇒ 勝方 +3 記 W、敗方 0 分記 L',
    pl2.find((p) => p.uid === 'u1').matchPoints === 3 && pl2.find((p) => p.uid === 'u1').results[0] === 'W'
    && pl2.find((p) => p.uid === 'u2').matchPoints === 0 && pl2.find((p) => p.uid === 'u2').results[0] === 'L',
    JSON.stringify(pl2.map((p) => [p.uid, p.matchPoints, p.results])));
  // F3 管理員把平手場裁定成 done（無 winner）⇒ 現行行為＝雙方記 L、0 分。**不可為負**。
  const pl3 = buildSwissPlayersFromMatches(
    [{ round: 1, p1uid: 'u1', p2uid: 'u2', winnerUid: null, status: 'done' }], regs);
  chk('F3 ⭐⭐已裁定為 done 但無 winner ⇒ 雙方記 L、分數 0（**絕不可為負**）',
    pl3.every((p) => p.matchPoints === 0 && p.results[0] === 'L'),
    JSON.stringify(pl3.map((p) => [p.uid, p.matchPoints, p.results])));
  // F4 standings 計算也不可丟例外／不可產生 NaN
  let F4ok = true, F4err = '';
  let stz = [];
  try { stz = computeStandings(pl3); } catch (e) { F4ok = false; F4err = e.message; }
  chk('F4 ⭐平手場進 computeStandings：不丟例外、OWP/OOWP 不是 NaN、名次是正整數',
    F4ok && stz.length === 2 && stz.every((s) => Number.isFinite(s.owp) && Number.isFinite(s.oowp) && s.rank >= 1),
    F4err || JSON.stringify(stz.map((s) => [s.uid, s.matchPoints, s.owp, s.oowp, s.rank])));

  // ── HEAD-FAIL 錨（Rule 41）：本版**刻意不動**的消費端，逐字釘住現況 ────────────
  const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
  chk('F5 ⭐⭐錨：錦標賽對局結束沒有勝方時 **不結算**（等管理員裁定）—— 本版刻意維持現行行為',
    SRV.includes("const wSeat = (gs.winner === 0 || gs.winner === 1) ? gs.winner : null;")
    && SRV.includes('      if (wSeat == null) return;'),
    '找不到 onMatchGameOver 的 wSeat 早退');
  chk('F6 ⭐⭐錨：休閒戰績「無 winner ⇒ draw」的判定逐字還在',
    SRV.includes("      if (winner === null || winner === undefined) return 'draw';"),
    '找不到 casualSideResult 的 draw 分支');
  chk('F7 ⭐⭐錨：統計聚合逐字排除平局（winner 必須是 0/1）',
    SRV.includes("const baseMatch = { winner: { $in: [0, 1] } };  // 只算分出勝負的場（排除平局）"),
    '找不到統計聚合的排除平局條件');
  const SW = readFileSync(join(ROOT, 'src/lib/tournament/swiss.ts'), 'utf8');
  chk('F8 ⭐⭐錨：瑞士輪計分**不容許平手**的宣告逐字還在（本版沒有改動錦標賽計分）',
    SW.includes('不容許平手：有 winner → 勝方+3記W、敗方記L；Bye → +3記BYE；無 winner(雙未進場) → 雙方記L不得分。'),
    '找不到 swiss.ts 的計分宣告');
  const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  chk('F9 ⭐錦標賽既有的「平手待管理員裁定」返回列逐字還在（不可被本版蓋掉）',
    PAGE.includes("{#if isTournament && game && game.phase === 'game-over' && (game.winner === null || game.winner === undefined)}")
    && PAGE.includes('本場平手，等待管理員裁定'),
    '找不到錦標賽平手返回列');
  chk('F10 ⭐非錦標賽的平手結算視窗（本版新增；沒有它單機／休閒平手會看起來卡住）',
    PAGE.includes('>>> v6361-draw-modal') && PAGE.includes('<<< v6361-draw-modal')
    && PAGE.includes("{#if game.phase === 'game-over' && (game.winner === null || game.winner === undefined) && !isTournament}")
    && PAGE.includes('本局平手！'),
    '找不到 v6361 平手視窗');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【H】結構／中央性（哨兵、單一判定點、v6.355 架構未動、Firestore 巢狀陣列禁令）');
{
  const ENG = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const TYP = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
  const cnt = (s, re) => (s.match(re) || []).length;
  chk('H1 ⭐engine.ts 的 v6361 哨兵成對（四段：import／中央判定／延後／重判）',
    cnt(ENG, />>> v6361-/g) === 4 && cnt(ENG, /<<< v6361-/g) === 4,
    JSON.stringify([cnt(ENG, />>> v6361-/g), cnt(ENG, /<<< v6361-/g)]));
  chk('H2 ⭐⭐中央終局判定**只有一個呼叫點**（applyActionImpl 末端）',
    cnt(ENG, /judgeEndgameV6361\(next,/g) === 1 && cnt(ENG, /applyEndgameVerdictV6361\(next,/g) === 1,
    JSON.stringify([cnt(ENG, /judgeEndgameV6361\(next,/g), cnt(ENG, /applyEndgameVerdictV6361\(next,/g)]));
  chk('H3 ⭐⭐v6.355 的「全站唯一 drain 點」架構一個字沒動（engine.ts 仍然只有 1 個呼叫點）',
    cnt(ENG, /drainOnKoAfterPrize\(/g) === 1
    && ENG.includes('  state = drainOnKoAfterPrize(state, pool);'),
    String(cnt(ENG, /drainOnKoAfterPrize\(/g)));
  chk('H4 ⭐⭐延後只在「本次 action 才判出終局 ＋ 佇列非空 ＋ 沒有 pendingSelection」時發生',
    ENG.includes("  if (next.phase === 'game-over' && state.phase === 'playing'")
    && ENG.includes("      && !next.pendingSelection && (next._onKoAfterPrize?.length ?? 0) > 0) {"),
    '延後條件被改寬了');
  chk('H5 ⭐⭐v2.135 防禦層逐字保留（本版不動它，test-v6265 F4 只需剝哨兵）',
    ENG.includes("        const winner = (1 - idx) as 0 | 1;")
    && ENG.includes("          winReason: `${p.name} 沒有可上場的寶可夢`,")
    && ENG.includes("  // v2.135 防禦層：若任一玩家在 'playing' 階段沒 active 也沒 bench → game-over"),
    'v2.135 防禦層被動過了');
  chk('H6 ⭐⭐Firestore 禁令：isDraw 是**純量布林**，不是 per-player 陣列（v6.056／v6.359 事故）',
    /\n  isDraw\?: boolean;/.test(TYP.replace(/\r\n/g, '\n'))
    && !/isDraw\?:\s*(\[|boolean\[\])/.test(TYP),
    'types.ts 的 isDraw 型別不對');
  chk('H7 ⭐平手時 winner 這個 key 是被 delete 掉的（不是寫 undefined —— Firestore 會對 undefined 丟例外）',
    ENG.includes("    delete (dr as { winner?: 0 | 1 }).winner;"),
    '找不到 delete winner');
  const EFF = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  chk('H8 ⭐⭐drain 不可以再「遇到 game-over 就 break」（那等於判勝負優先於結算，站長裁定反過來）',
    !EFF.includes("    if (s.phase === 'game-over') break;")
    && EFF.includes('    s = liftEndgameForOnKoV6361(s);'),
    'drain 的順序被退回去了');
  chk('H9 ⭐⭐收回終局的 helper 只有一份（effects.ts），engine 只 import 不重寫',
    cnt(EFF, /export function liftEndgameForOnKoV6361\(/g) === 1
    && cnt(ENG, /export function liftEndgameForOnKoV6361\(/g) === 0
    && cnt(ENG, /liftEndgameForOnKoV6361\(next\)/g) === 1,
    JSON.stringify([cnt(EFF, /export function liftEndgameForOnKoV6361\(/g), cnt(ENG, /liftEndgameForOnKoV6361\(next\)/g)]));
  chk('H10 ⭐⭐⭐行為端：三個暫存旗標絕不可以留在回傳盤面上（會被推上 Firestore／Mongo）',
    [run(board({ b0: 1, b1: 0 })), run(board({ b0: 0, b1: 0 })), run(board({ b0: 1, b1: 1, pz0: 2 })),
     run(board({ b0: 1, b1: 1, pz0: 1, pz1: 1 })), run(board({ b0: 1, b1: 1 })),
     run(board({ b0: 1, b1: 0, defPlain: true }))]
      .every((r) => r._v6361NeedsVerdict === undefined && r._v6361LiftedWinner === undefined
        && r._v6361LiftedReason === undefined
        && !Object.prototype.hasOwnProperty.call(r, '_v6361NeedsVerdict')),
    '暫存旗標外洩');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【I】HEAD-FAIL：BASE（v6.359, 35eea58f）的 engine.ts 逐字比對（歷史性斷言；淺複製跳過）');
{
  let base = null;
  try {
    base = execFileSync('git', ['-C', ROOT, 'show', '35eea58fd2a9c5131572d840d3f7817e93d0f4e3:src/lib/game/engine.ts'],
      { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch { base = null; }
  if (!base) {
    console.log('  ⚠ SKIP：拿不到 BASE blob（淺複製）—— 守 HEAD 的是 【A】~【H】與 __m6a/mutcheck_v6361.mjs');
  } else {
    chk('I1 ⭐⭐⭐HEAD-FAIL：BASE 完全沒有中央終局判定（⇒【A】【B】【E3】在 BASE 必紅）',
      !base.includes('judgeEndgameV6361') && !base.includes('v6361-'),
      'BASE 竟然已經有 v6361 的東西');
    let baseEff = null;
    try {
      baseEff = execFileSync('git', ['-C', ROOT, 'show', '35eea58fd2a9c5131572d840d3f7817e93d0f4e3:src/lib/game/effects.ts'],
        { encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch { baseEff = null; }
    chk('I2 ⭐⭐⭐HEAD-FAIL：BASE 的 drain「遇到 game-over 就 break」（＝判勝負優先於結算，'
      + '耿鬼ex 是最後一隻時死亡宣告整支不會跑 ⇒【A】【B】在 BASE 必紅）',
      !!baseEff && baseEff.includes("    if (s.phase === 'game-over') break;   // 已經分出勝負 ⇒ 後面的 on-KO 效果不再結算")
      && !baseEff.includes('liftEndgameForOnKoV6361'),
      'BASE 的 drain 不是預期的樣子');
    chk('I2b ⭐⭐BASE 的 dispatcher 末端 sweep 被 game-over gate 掉（終局後整條收斂線都不跑）',
      base.includes("  if (next.phase === 'playing' && !next.pendingSelection) {"),
      'BASE 的 sweep gate 不是預期的樣子');
    chk('I3 ⭐⭐⭐HEAD-FAIL：BASE 的唯一終局兜底是「第一個沒寶可夢的人就判對手贏」＋ break'
      + '（雙方皆空時必然誤判 winner=1，而不是平手 ⇒【B】在 BASE 必紅）',
      base.includes('        const winner = (1 - idx) as 0 | 1;') && base.includes('        break;'),
      'BASE 的 v2.135 防禦層不是預期的樣子');
  }
}

console.log(`\nv6.361 守衛：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
