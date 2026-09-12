// v6.360 守衛 —— 站長裁定 E-14：「要卡片真的有使出的時候才要擲硬幣」
//
// 站長裁定（逐字）：
//   「要卡片真的有使出的時候才要擲硬幣，我有點看不懂你在說甚麼」
//
// 卡面逐字（static/cards/M6a.json，台灣官方中文，蟾蜍王 id 19982 attacks[].effect）：
//   「在下個對手的回合，每次對手從手牌使出訓練家卡時，使用前擲1次硬幣。
//     若為反面，則不算使用過那張卡，將其丟棄。」
//
// 本版修的是：v6.356 把撼盪拳的中央閘放在 canPlayTrainer 之後、卡片離手之前，但
// PLAY_TRAINER handler 的 Stadium 分支裡還留著兩個「在閘之後才擋」的場地規則
// （① 每回合 1 張競技場 ② 同名競技場不可覆蓋）⇒ 一個引擎最終會判定為非法、
// 根本不會生效的打出，仍然會消耗一次擲幣（反面時還會把那張卡丟進棄牌區）。
// v6.360 把那兩條收斂成中央述詞 stadiumPlacementBlock，並排到擲幣之前；
// getPlayableTrainers（UI 黃框／AI 清單）與 handler 共用**同一份**判準（Rule 38）。
//
// ⚠ 禁止恆真斷言（安慰劑 #27）：每一組都有「正對照／哨兵」證明數字不是 harness 自己生的。
// ⚠ 旗標層斷言只當補充（安慰劑 #28）：主判準一律是「有沒有擲幣 log／卡在哪裡／盤面有沒有動」。
// ⚠ 突變自驗：__m6a/mutcheck_v6360.mjs（未達標必須 0）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6360-s.js'), E = join(ROOT, '.v6360-e.ts'), O = join(ROOT, '.v6360-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, getPlayableTrainers, getPlayableFossils } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, getPlayableTrainers, getPlayableFossils } = M;

// ── 卡池 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c); all.push(c);
  }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };

const TOAD = byId('19982');   // 蟾蜍王 M6a 070/103｜撼盪拳
const GAI = byId('19549');    // 蓋伊   支援者：抽 3（無 picker、無亂數）
const FOSSIL = byId('13947'); // 陳舊的背蓋化石（Item 化石，走 PLAY_FOSSIL）

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;

const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');
const TARGET = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 190 && c.weakness?.type !== 'Fighting' && c.resistance?.type !== 'Fighting');

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
const deckN = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 7,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P({ name: 'A', deck: deckN(30), prizes: deckN(6), ...p0 }),
            P({ name: 'B', deck: deckN(30), prizes: deckN(6), ...p1 })],
  ...extra,
});

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

/**
 * ⚠⚠ 亂數計數是本檔的**關鍵**斷言之一：
 *   「先擲幣、事後還原」那種做法會讓 log 與盤面都看不出破綻（還原掉了），
 *   但 Math.random **已經被消耗掉**了 —— 那正是站長裁定要禁止的東西
 *   （而且線上樂觀更新的 randomness gate 也會因此誤判）。
 *   所以每一組非法打出都要另外斷言「這次 action 消耗 0 次 Math.random」。
 */
let randCalls = 0;
const withCoin = (heads, fn) => {
  const orig = Math.random;
  Math.random = () => { randCalls++; return heads ? 0.1 : 0.9; };
  try { return fn(); } finally { Math.random = orig; }
};
const act = (st, a, heads = true) => withCoin(heads, () => applyAction(st, a, pool));
/** 回傳 { r, rand }：rand ＝ 這一次 action 期間 Math.random 被呼叫的次數 */
const actCount = (st, a, heads = true) => {
  const b = randCalls; const r = act(st, a, heads); return { r, rand: randCalls - b };
};
const LOGS = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l?.text ?? l));
/** 這一次 action 期間新增的「撼盪拳」相關 log 行數（擲幣 ＋ 正／反面判定，全部算） */
const tremorLines = (before, after) =>
  LOGS(after).slice(LOGS(before).length).filter((x) => x.includes('撼盪拳')).length;
const tremorFlips = (before, after) =>
  LOGS(after).slice(LOGS(before).length).filter((x) => /^撼盪拳（.+）：擲硬幣 — /.test(x)).length;
const inHand = (r, i, iid) => r.players[i].hand.some((c) => c.iid === iid);
const inDisc = (r, i, iid) => r.players[i].discard.some((c) => c.iid === iid);
/**
 * 盤面（不含 log、不含「本回合動作流水帳」）逐字比對。
 * ⚠ currentTurnActions 是 applyAction 外層的動作流水帳：只要回傳的 state 有變（哪怕只多一行
 *   規則 log），這一筆「play_hand」就會被記上去 —— 這是 HEAD 本來就有的行為，與擲幣無關，
 *   所以比對盤面時要把它normalize 掉，另外用 J 系列斷言單獨釘住「有／沒有撼盪拳時它完全一樣」。
 */
const noLog = (s) => JSON.stringify({
  ...s, log: null,
  players: [{ ...s.players[0], currentTurnActions: null }, { ...s.players[1], currentTurnActions: null }],
});
const journal = (s, i) => JSON.stringify(s.players[i].currentTurnActions ?? []);

const I_TREMOR = (TOAD.attacks || []).findIndex((a) => a.name === '撼盪拳');

/**
 * A（idx0）的蟾蜍王出招 → END_TURN ⇒ 輪到 B（idx1），B 身上帶著撼盪拳旗標。
 * @param mode 'tremor' = 用撼盪拳（旗標會上）／'none' = A 完全不出招（反對照）
 */
const setup = (bHand, mode = 'tremor', bExtra = {}, aHand = []) => {
  const toad = inst(TOAD.id, {
    energyAttached: [inst(EID.Fighting), inst(EID.Colorless), inst(EID.Colorless), inst(EID.Colorless)],
  });
  let s = mk(
    { active: toad, bench: [inst(PLAIN.id)], hand: aHand },
    { active: inst(TARGET.id), bench: [inst(PLAIN.id)], hand: bHand, deck: deckN(30), ...bExtra },
  );
  // A 先在**自己的回合**合法打出 aHand 裡的訓練家卡（例如先放一張競技場上去）
  for (const h of aHand) s = act(s, { type: 'PLAY_TRAINER', iid: h.iid }, true);
  if (mode === 'tremor') s = act(s, { type: 'ATTACK', attackIndex: I_TREMOR });
  if (s.activePlayerIndex === 0) s = act(s, { type: 'END_TURN' });
  return s;
};

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】fixture 自驗');
// ══════════════════════════════════════════════════════════════════════════════
/** 動態 fixture：能乾淨落地（不開 picker、不動獎賞）的競技場 */
const probeStadium = (card) => {
  const c = inst(card.id);
  const base = mk({ active: inst(PLAIN.id) }, { active: inst(PLAIN.id), hand: [c] }, { activePlayerIndex: 1 });
  let out;
  try { out = withCoin(true, () => applyAction(base, { type: 'PLAY_TRAINER', iid: c.iid }, pool)); }
  catch { return false; }
  return out !== base && !out.pendingSelection
    && String(out.activeStadium?.cardId ?? '') === String(card.id)
    && out.players[0].prizes.length === 6 && out.players[1].prizes.length === 6;
};
let STAD1 = null, STAD2 = null;
for (const card of all) {
  if (card.subtype !== 'Stadium') continue;
  if (STAD1 && card.name === STAD1.name) continue;
  if (!probeStadium(card)) continue;
  if (!STAD1) STAD1 = card; else if (!STAD2) { STAD2 = card; break; }
}
chk('0a 找得到兩張不同名、可乾淨落地的競技場（動態 fixture）',
  !!STAD1 && !!STAD2 && STAD1.name !== STAD2.name, JSON.stringify([STAD1?.name, STAD2?.name]));
const PRISM = all.find((c) => c.name === '稜鏡塔');
const AONZHU = all.find((c) => c.name === '昂主花葉蒂');
chk('0b 卡池裡有 稜鏡塔 與 昂主花葉蒂（v3.851 例外的 fixture）',
  !!PRISM && !!AONZHU, JSON.stringify([PRISM?.id, AONZHU?.id]));
{
  const g = inst(GAI.id);
  const s0 = setup([g]);
  chk('0c 共用盤面自驗：撼盪拳旗標真的掛在 B（idx1）身上',
    s0.activePlayerIndex === 1 && s0.players[1].trainerCoinFlipThisTurn === true,
    JSON.stringify([s0.activePlayerIndex, s0.players[1].trainerCoinFlipThisTurn]));
  const s1 = act(s0, { type: 'PLAY_TRAINER', iid: g.iid }, true);
  chk('0d 共用盤面自驗：合法的訓練家卡在這個盤面上確實會擲 1 次幣',
    tremorFlips(s0, s1) === 1, String(tremorFlips(s0, s1)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐⭐⭐站長裁定主情境 ①：本回合已放過競技場 ⇒ 第二張是非法打出 ⇒ 一次幣都不擲');
// ══════════════════════════════════════════════════════════════════════════════
const mkQuota = (mode = 'tremor') => {
  const c1 = inst(STAD1.id), c2 = inst(STAD2.id), g = inst(GAI.id);
  const v0 = setup([c1, c2, g], mode);
  const v1 = act(v0, { type: 'PLAY_TRAINER', iid: c1.iid }, true);   // 第一張：合法、正面 ⇒ 落地
  return { c1, c2, g, v0, v1 };
};
{
  const Q = mkQuota();
  chk('A0 哨兵：第一張競技場確實落地、額度確實被吃掉（非法情境成立）',
    String(Q.v1.activeStadium?.cardId ?? '') === String(STAD1.id)
    && (Q.v1.stadiumPlayedThisTurn ?? [false, false])[1] === true,
    JSON.stringify([Q.v1.activeStadium?.cardId, Q.v1.stadiumPlayedThisTurn]));
  chk('A0b 哨兵：UI/AI 的可打出清單**沒有**列出第二張（＝引擎確實視為非法）',
    !getPlayableTrainers(Q.v1, pool).includes(Q.c2.iid),
    JSON.stringify(getPlayableTrainers(Q.v1, pool)));

  for (const [label, heads] of [['反面亂數', false], ['正面亂數', true]]) {
    const r = act(Q.v1, { type: 'PLAY_TRAINER', iid: Q.c2.iid }, heads);
    chk(`A1 ⭐⭐⭐（${label}）非法的第二張競技場：log 裡一個「撼盪拳」字樣都沒有（＝完全沒擲幣）`,
      tremorLines(Q.v1, r) === 0,
      JSON.stringify(LOGS(r).slice(LOGS(Q.v1).length)));
    chk(`A2 ⭐⭐（${label}）那張卡還在手牌，而且沒有被丟進棄牌區`,
      inHand(r, 1, Q.c2.iid) && !inDisc(r, 1, Q.c2.iid),
      JSON.stringify([inHand(r, 1, Q.c2.iid), inDisc(r, 1, Q.c2.iid)]));
    chk(`A3 ⭐⭐⭐（${label}）盤面一個字都沒動（連 log 都沒多一行 ⇒ 回傳的就是同一個 state）`,
      r === Q.v1, JSON.stringify([noLog(r) === noLog(Q.v1), LOGS(r).length - LOGS(Q.v1).length]));
  }

  // 哨兵：同一個盤面送出一張**合法**的訓練家卡 ⇒ 確實有擲幣（證明閘沒有被整支關掉）
  const legal = act(Q.v1, { type: 'PLAY_TRAINER', iid: Q.g.iid }, true);
  chk('A4 ⭐⭐哨兵：同一盤面的**合法**支援者照樣擲 1 次幣，而且效果真的發生（牌庫 −3）',
    tremorFlips(Q.v1, legal) === 1 && legal.players[1].deck.length === Q.v1.players[1].deck.length - 3,
    JSON.stringify([tremorFlips(Q.v1, legal), Q.v1.players[1].deck.length, legal.players[1].deck.length]));
  chk('A4b ⭐哨兵：那張合法支援者本來就在可打出清單裡（＝A4 不是靠繞過判準達成的）',
    getPlayableTrainers(Q.v1, pool).includes(Q.g.iid));

  // ⚠⚠ 反「先擲幣、事後還原」：非法打出必須連 Math.random 都沒有被消耗
  const illegalRand = actCount(Q.v1, { type: 'PLAY_TRAINER', iid: Q.c2.iid }, false).rand;
  const legalRand = actCount(Q.v1, { type: 'PLAY_TRAINER', iid: Q.g.iid }, true).rand;
  chk('A5 ⭐⭐⭐反安慰劑：非法的第二張競技場**一次 Math.random 都沒消耗**（不是「先擲幣再還原」）',
    illegalRand === 0, String(illegalRand));
  chk('A5b ⭐⭐哨兵：同一盤面的合法支援者確實消耗了亂數（證明 A5 不是恆真）',
    legalRand >= 1, String(legalRand));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐⭐站長裁定主情境 ②：場上已有同名競技場 ⇒ 覆蓋是非法打出 ⇒ 一次幣都不擲');
// ══════════════════════════════════════════════════════════════════════════════
/**
 * 場上已有 STAD1 —— 由**對手 A 在自己的回合合法放上去**（不是 harness 硬塞，
 * 否則競技場的進場效果會在 B 的第一個 action 才補跑，汙染「盤面有沒有動」的比對）。
 * ⇒ B 的每回合額度還是 false ⇒ 只會踩「同名不可覆蓋」這一條。
 */
const mkDup = (mode = 'tremor') => {
  const c = inst(STAD1.id), g = inst(GAI.id);
  const v1 = setup([c, g], mode, {}, [inst(STAD1.id)]);
  return { c, g, v1 };
};
{
  const D = mkDup();
  chk('B0 哨兵：非法情境成立 —— 場上已有同名競技場，但 B 的每回合額度**還沒**被吃掉',
    String(D.v1.activeStadium?.cardId ?? '') === String(STAD1.id)
    && !(D.v1.stadiumPlayedThisTurn ?? [false, false])[1],
    JSON.stringify([D.v1.activeStadium?.cardId, D.v1.stadiumPlayedThisTurn]));
  chk('B0b 哨兵：UI/AI 的可打出清單**沒有**列出它',
    !getPlayableTrainers(D.v1, pool).includes(D.c.iid));

  for (const [label, heads] of [['反面亂數', false], ['正面亂數', true]]) {
    const r = act(D.v1, { type: 'PLAY_TRAINER', iid: D.c.iid }, heads);
    chk(`B1 ⭐⭐⭐（${label}）同名覆蓋：log 裡一個「撼盪拳」字樣都沒有（＝完全沒擲幣）`,
      tremorLines(D.v1, r) === 0, JSON.stringify(LOGS(r).slice(LOGS(D.v1).length)));
    chk(`B2 ⭐⭐（${label}）那張卡還在手牌、沒進棄牌區、場上競技場沒被換掉`,
      inHand(r, 1, D.c.iid) && !inDisc(r, 1, D.c.iid)
      && r.activeStadium?.iid === D.v1.activeStadium.iid,
      JSON.stringify([inHand(r, 1, D.c.iid), inDisc(r, 1, D.c.iid), r.activeStadium?.iid]));
    chk(`B3 ⭐⭐⭐（${label}）除了那一行規則 log 之外，盤面逐字沒動`,
      noLog(r) === noLog(D.v1)
      && LOGS(r).length === LOGS(D.v1).length + 1
      && LOGS(r)[LOGS(r).length - 1] === `規則：場上已有相同名稱的競技場（${STAD1.name}），無法重複打出`,
      JSON.stringify([noLog(r) === noLog(D.v1), LOGS(r).slice(LOGS(D.v1).length)]));
  }

  // 哨兵：同一種盤面但場上換成**不同名**的競技場 ⇒ 同一張卡就打得出去，而且確實擲了 1 次幣
  const altC = inst(STAD1.id);
  const alt = setup([altC], 'tremor', {}, [inst(STAD2.id)]);
  const ok = act(alt, { type: 'PLAY_TRAINER', iid: altC.iid }, true);
  chk('B4 ⭐⭐哨兵：場上是不同名競技場 ⇒ 同一張卡落地成功，且確實擲 1 次幣（證明 B1 不是把閘關掉）',
    String(alt.activeStadium?.cardId ?? '') === String(STAD2.id)
    && String(ok.activeStadium?.cardId ?? '') === String(STAD1.id) && tremorFlips(alt, ok) === 1,
    JSON.stringify([alt.activeStadium?.cardId, ok.activeStadium?.cardId, tremorFlips(alt, ok)]));

  // ⚠⚠ 反「先擲幣、事後還原」
  const dupRand = actCount(D.v1, { type: 'PLAY_TRAINER', iid: D.c.iid }, false).rand;
  const okRand = actCount(alt, { type: 'PLAY_TRAINER', iid: altC.iid }, true).rand;
  chk('B5 ⭐⭐⭐反安慰劑：同名覆蓋的非法打出**一次 Math.random 都沒消耗**',
    dupRand === 0, String(dupRand));
  chk('B5b ⭐⭐哨兵：同一張卡在合法盤面上確實消耗了亂數（證明 B5 不是恆真）',
    okRand >= 1, String(okRand));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】反對照：**沒有**撼盪拳旗標時，同樣的非法打出行為與 HEAD 逐字相同（零副作用）');
// ══════════════════════════════════════════════════════════════════════════════
{
  const Qn = mkQuota('none');
  const Qt = mkQuota('tremor');
  chk('C0 哨兵：反對照那一組身上真的沒有撼盪拳旗標',
    Qn.v1.players[1].trainerCoinFlipThisTurn !== true
    && Qt.v1.players[1].trainerCoinFlipThisTurn === true,
    JSON.stringify([Qn.v1.players[1].trainerCoinFlipThisTurn, Qt.v1.players[1].trainerCoinFlipThisTurn]));
  const rn = act(Qn.v1, { type: 'PLAY_TRAINER', iid: Qn.c2.iid }, false);
  chk('C1 ⭐⭐①沒旗標時：`return state` 的語意逐字保留（回傳同一個 state 物件、零 log）',
    rn === Qn.v1, JSON.stringify([rn === Qn.v1, LOGS(rn).length - LOGS(Qn.v1).length]));
  const rt = act(Qt.v1, { type: 'PLAY_TRAINER', iid: Qt.c2.iid }, false);
  chk('C2 ⭐⭐⭐①有／沒有旗標，非法打出的結果**完全同型**（有旗標那組沒有多出任何擲幣副作用）',
    (rt === Qt.v1) === (rn === Qn.v1)
    && LOGS(rt).length - LOGS(Qt.v1).length === LOGS(rn).length - LOGS(Qn.v1).length,
    JSON.stringify([rt === Qt.v1, rn === Qn.v1]));

  const Dn = mkDup('none'), Dt = mkDup('tremor');
  const dn = act(Dn.v1, { type: 'PLAY_TRAINER', iid: Dn.c.iid }, false);
  const dt = act(Dt.v1, { type: 'PLAY_TRAINER', iid: Dt.c.iid }, false);
  chk('C3 ⭐⭐②沒旗標時：只多一行原本的規則 log，盤面逐字不動',
    noLog(dn) === noLog(Dn.v1) && LOGS(dn).length === LOGS(Dn.v1).length + 1
    && LOGS(dn)[LOGS(dn).length - 1] === `規則：場上已有相同名稱的競技場（${STAD1.name}），無法重複打出`,
    JSON.stringify(LOGS(dn).slice(LOGS(Dn.v1).length)));
  chk('C4 ⭐⭐⭐②有／沒有旗標，非法打出新增的 log **逐字相同**（＝擲幣完全沒有發生過）',
    JSON.stringify(LOGS(dt).slice(LOGS(Dt.v1).length)) === JSON.stringify(LOGS(dn).slice(LOGS(Dn.v1).length)),
    JSON.stringify([LOGS(dt).slice(LOGS(Dt.v1).length), LOGS(dn).slice(LOGS(Dn.v1).length)]));
  // 動作流水帳（HEAD 本來就會記一筆被退回的 play_hand）：有／沒有旗標必須完全一樣
  chk('C5 ⭐⭐②有／沒有旗標，applyAction 的動作流水帳增量**完全相同**（沒有多出擲幣造成的副作用）',
    journal(dt, 1) === journal(dn, 1)
    && JSON.parse(journal(dt, 1)).length === JSON.parse(journal(Dt.v1, 1)).length + 1,
    JSON.stringify([journal(dt, 1), journal(dn, 1)]));
  chk('C6 ⭐①有／沒有旗標，非法打出都是「原封不動回傳」（流水帳也一筆都沒記）',
    journal(rt, 1) === journal(Qt.v1, 1) && journal(rn, 1) === journal(Qn.v1, 1),
    JSON.stringify([journal(rt, 1), journal(rn, 1)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】PLAY_FOSSIL 側：非法的化石打出同樣一次幣都不擲');
// ══════════════════════════════════════════════════════════════════════════════
{
  // ① 備戰區已滿（5 隻）⇒ PLAY_FOSSIL 非法
  const f1 = inst(FOSSIL.id);
  const full = setup([f1], 'tremor', { bench: [inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)] });
  chk('D0 哨兵：非法情境成立 —— 備戰已滿，可放置化石清單是空的',
    full.players[1].bench.length === 5 && getPlayableFossils(full, pool).length === 0,
    JSON.stringify([full.players[1].bench.length, getPlayableFossils(full, pool)]));
  const r1 = act(full, { type: 'PLAY_FOSSIL', iid: f1.iid }, false);
  chk('D1 ⭐⭐備戰滿：log 裡一個「撼盪拳」字樣都沒有，化石還在手牌、沒進棄牌',
    tremorLines(full, r1) === 0 && inHand(r1, 1, f1.iid) && !inDisc(r1, 1, f1.iid),
    JSON.stringify([tremorLines(full, r1), inHand(r1, 1, f1.iid), inDisc(r1, 1, f1.iid)]));

  // ② 玩家級物品鎖（含羞苞癢癢花粉家族）⇒ PLAY_FOSSIL 非法
  const f2 = inst(FOSSIL.id);
  const locked = setup([f2], 'tremor', { cantPlayItemThisTurn: true });
  chk('D2 哨兵：非法情境成立 —— 物品鎖生效，可放置化石清單是空的',
    getPlayableFossils(locked, pool).length === 0, JSON.stringify(getPlayableFossils(locked, pool)));
  const r2 = act(locked, { type: 'PLAY_FOSSIL', iid: f2.iid }, false);
  chk('D3 ⭐⭐物品鎖：完全沒擲幣，化石還在手牌',
    tremorLines(locked, r2) === 0 && inHand(r2, 1, f2.iid),
    JSON.stringify([tremorLines(locked, r2), LOGS(r2).slice(LOGS(locked).length)]));

  // 哨兵：同一盤面把鎖拿掉 ⇒ 化石打得出去，而且確實擲 1 次幣
  const open = { ...locked, players: [locked.players[0], { ...locked.players[1], cantPlayItemThisTurn: undefined }] };
  const r3 = act(open, { type: 'PLAY_FOSSIL', iid: f2.iid }, true);
  chk('D4 ⭐⭐哨兵：拿掉鎖之後同一張化石上場成功，且確實擲 1 次幣（證明 D1/D3 不是把閘關掉）',
    r3.players[1].bench.length === open.players[1].bench.length + 1 && tremorFlips(open, r3) === 1,
    JSON.stringify([open.players[1].bench.length, r3.players[1].bench.length, tremorFlips(open, r3)]));

  const lockRand = actCount(locked, { type: 'PLAY_FOSSIL', iid: f2.iid }, false).rand;
  const openRand = actCount(open, { type: 'PLAY_FOSSIL', iid: f2.iid }, true).rand;
  chk('D5 ⭐⭐⭐反安慰劑：非法的化石打出**一次 Math.random 都沒消耗**（哨兵：合法那一組有消耗）',
    lockRand === 0 && openRand >= 1, JSON.stringify([lockRand, openRand]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】合法路徑零變更（收斂不可以把既有規則改壞）');
// ══════════════════════════════════════════════════════════════════════════════
{
  // E1 第一張競技場照常落地、額度吃掉（沒有撼盪拳的純規則面）
  const c1 = inst(STAD1.id), c2 = inst(STAD2.id);
  const s0 = setup([c1, c2], 'none');
  const s1 = act(s0, { type: 'PLAY_TRAINER', iid: c1.iid }, true);
  const s2 = act(s1, { type: 'PLAY_TRAINER', iid: c2.iid }, true);
  chk('E1 ⭐第一張競技場照常落地、額度被吃掉；同回合第二張被擋（場上仍是第一張）',
    String(s1.activeStadium?.cardId ?? '') === String(STAD1.id)
    && (s1.stadiumPlayedThisTurn ?? [false, false])[1] === true
    && String(s2.activeStadium?.cardId ?? '') === String(STAD1.id),
    JSON.stringify([s1.activeStadium?.cardId, s1.stadiumPlayedThisTurn, s2.activeStadium?.cardId]));

  // E2 v3.851 例外：打過稜鏡塔的回合可以再放昂主花葉蒂（同回合第 2 張 Stadium）
  if (PRISM && AONZHU) {
    const p = inst(PRISM.id), a = inst(AONZHU.id);
    const e0 = setup([p, a], 'none');
    const e1 = act(e0, { type: 'PLAY_TRAINER', iid: p.iid }, true);
    chk('E2a 哨兵：稜鏡塔落地、prismTowerPlayedThisTurn 起來、競技場額度也被吃掉',
      String(e1.activeStadium?.cardId ?? '') === String(PRISM.id)
      && (e1.prismTowerPlayedThisTurn ?? [false, false])[1] === true
      && (e1.stadiumPlayedThisTurn ?? [false, false])[1] === true,
      JSON.stringify([e1.activeStadium?.cardId, e1.prismTowerPlayedThisTurn, e1.stadiumPlayedThisTurn]));
    chk('E2b ⭐⭐v3.851 例外仍在：昂主花葉蒂出現在可打出清單裡',
      getPlayableTrainers(e1, pool).includes(a.iid), JSON.stringify(getPlayableTrainers(e1, pool)));
    const e2 = act(e1, { type: 'PLAY_TRAINER', iid: a.iid }, true);
    chk('E2c ⭐⭐⭐v3.851 例外仍在（行為端）：昂主花葉蒂真的變成場上的競技場',
      String(e2.activeStadium?.cardId ?? '') === String(AONZHU.id),
      JSON.stringify([e2.activeStadium?.cardId, AONZHU.id]));
    // 反對照：沒打稜鏡塔（改打別的競技場）⇒ 昂主花葉蒂就打不出去
    const p2 = inst(STAD1.id), a2 = inst(AONZHU.id);
    const n0 = setup([p2, a2], 'tremor');
    const n1 = act(n0, { type: 'PLAY_TRAINER', iid: p2.iid }, true);
    const n2 = act(n1, { type: 'PLAY_TRAINER', iid: a2.iid }, false);
    chk('E2d ⭐⭐反對照：沒有稜鏡塔時，昂主花葉蒂是非法第二張 ⇒ 不在清單、被擋、而且不擲幣',
      !getPlayableTrainers(n1, pool).includes(a2.iid)
      && String(n2.activeStadium?.cardId ?? '') === String(STAD1.id)
      && tremorLines(n1, n2) === 0 && inHand(n2, 1, a2.iid),
      JSON.stringify([getPlayableTrainers(n1, pool).includes(a2.iid), n2.activeStadium?.cardId,
        tremorLines(n1, n2), inHand(n2, 1, a2.iid)]));
  }

  // E3 v6.356 的「靠早退達成不算使用過」結構沒壞：反面丟掉一張競技場後同回合還能放另一張
  const d1 = inst(STAD1.id), d2 = inst(STAD2.id);
  const t0 = setup([d1, d2], 'tremor');
  const t1 = act(t0, { type: 'PLAY_TRAINER', iid: d1.iid }, false);   // 反面 ⇒ 丟棄、額度不吃
  const t2 = act(t1, { type: 'PLAY_TRAINER', iid: d2.iid }, true);    // 還可以放第二張
  chk('E3 ⭐⭐⭐v6.356 的早退結構沒被破壞：反面丟掉一張競技場後，同回合另一張真的落地',
    t1.activeStadium == null && inDisc(t1, 1, d1.iid)
    && !(t1.stadiumPlayedThisTurn ?? [false, false])[1]
    && String(t2.activeStadium?.cardId ?? '') === String(STAD2.id),
    JSON.stringify([t1.activeStadium, t1.stadiumPlayedThisTurn, t2.activeStadium?.cardId]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】靜態：判準只有一份，而且完全排在擲幣之前');
// ══════════════════════════════════════════════════════════════════════════════
{
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const defs = eng.split('function stadiumPlacementBlock(').length - 1;
  const calls = eng.split('stadiumPlacementBlock(state, ').length - 1;
  chk('F1 ⭐中央述詞只有 1 份定義', defs === 1, String(defs));
  chk('F2 ⭐⭐呼叫點恰好 2 個（PLAY_TRAINER handler ＋ getPlayableTrainers）', calls === 2, String(calls));

  // ⚠ `if (action.type === 'PLAY_TRAINER') {` 在檔案前段的 action 分類表也出現過 ——
  //   要抓的是 handler，所以從 PLAY_FOSSIL handler 之後開始找（與 test-v6356 的 J3/J4 同一種切法）。
  const iFossil = eng.indexOf("action.type === 'PLAY_FOSSIL'");
  const iTrainer = eng.indexOf("if (action.type === 'PLAY_TRAINER') {", iFossil);
  const iCallSb = eng.indexOf('stadiumPlacementBlock(state, aIdx, trainerCard, pool)', iTrainer);
  const iGate = eng.indexOf('tremorPunchTrainerGate(state, aIdx, trainerInst', iTrainer);
  const iHandOut = eng.indexOf('attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);', iTrainer);
  chk('F3 ⭐⭐⭐順序：場地規則判準排在**擲幣閘之前**，而擲幣閘又排在卡片離手之前',
    iFossil > 0 && iTrainer > iFossil && iCallSb > iTrainer && iGate > iCallSb && iHandOut > iGate,
    JSON.stringify([iFossil, iTrainer, iCallSb, iGate, iHandOut]));

  // 述詞本體的範圍（用哨兵框住）
  const pStart = eng.indexOf('// >>> v6360-stadium-legality');
  const pEnd = eng.indexOf('// <<< v6360-stadium-legality', pStart);
  chk('F3b 哨兵：抓得到中央述詞的哨兵區塊', pStart > 0 && pEnd > pStart, JSON.stringify([pStart, pEnd]));
  const inPred = (i) => i > pStart && i < pEnd;

  const nAonzhu = eng.split('isAonzhuExempt').length - 1;
  chk('F4 ⭐⭐⭐「每回合 1 張」的判準全站只剩 1 份，而且就在中央述詞裡（不在擲幣閘後面）',
    nAonzhu === 2 && inPred(eng.indexOf('isAonzhuExempt')) && inPred(eng.lastIndexOf('isAonzhuExempt')),
    JSON.stringify([nAonzhu, eng.indexOf('isAonzhuExempt'), pStart, pEnd]));
  const nDup = eng.split('無法重複打出').length - 1;
  chk('F5 ⭐⭐⭐「同名不可覆蓋」的判準全站只剩 1 份，而且就在中央述詞裡',
    nDup === 1 && inPred(eng.indexOf('無法重複打出')),
    JSON.stringify([nDup, eng.indexOf('無法重複打出'), pStart, pEnd]));

  // 擲幣閘之後的 Stadium 分支：不可以再出現任何「合法性判斷」
  const iGateEnd = eng.indexOf('// <<< v6356-tremor-punch-play-trainer', iTrainer);
  const iStadiumCommit = eng.indexOf('activeStadium: trainerInst,', iGateEnd);
  const tailSeg = eng.slice(iGateEnd, iStadiumCommit);
  chk('F6 ⭐⭐⭐擲幣閘之後的 Stadium 分支裡，兩條場地規則的判斷都不見了',
    iGateEnd > 0 && iStadiumCommit > iGateEnd
    && !tailSeg.includes('isAonzhuExempt') && !tailSeg.includes('無法重複打出')
    && !/if \(played\[aIdx\][^)]*\) return state;/.test(tailSeg),
    JSON.stringify([iGateEnd, iStadiumCommit, tailSeg.length]));

  // getPlayableTrainers 不再有自己的那份鏡射
  const iGPT = eng.indexOf('export function getPlayableTrainers(');
  const iGPTEnd = eng.indexOf('\nexport function ', iGPT + 1);
  const gptSeg = eng.slice(iGPT, iGPTEnd);
  chk('F7 ⭐⭐⭐getPlayableTrainers 改問同一份中央述詞（不再自己判 stadiumPlayedThisTurn／同名覆蓋）',
    (gptSeg.split('stadiumPlacementBlock(').length - 1) === 1
    && !gptSeg.includes('stadiumPlayedThisTurn')
    && !gptSeg.includes('activeStadium'),
    JSON.stringify([gptSeg.split('stadiumPlacementBlock(').length - 1,
      gptSeg.includes('stadiumPlayedThisTurn'), gptSeg.includes('activeStadium')]));

  // ⚠⚠ 反安慰劑：不可以是「先擲幣、事後還原」
  const iPredCall = eng.indexOf('// >>> v6360-stadium-legality-before-flip', iTrainer);
  chk('F8 ⭐⭐反安慰劑：前移的判準區塊在擲幣閘之前，而且區塊內沒有任何亂數／狀態還原',
    iPredCall > 0 && iPredCall < eng.indexOf('// >>> v6356-tremor-punch-play-trainer', iTrainer)
    && !eng.slice(iPredCall, iGate).includes('Math.random')
    && !eng.slice(iPredCall, iGate).includes('prevCoinFlag'),
    JSON.stringify([iPredCall, iGate]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【G】⭐⭐⭐判準一致（行為端，逐張跑全卡池）：清單沒列出來的訓練家卡，handler 一律拒絕且不擲幣');
// ══════════════════════════════════════════════════════════════════════════════
{
  const TR = all.filter((c) => c.supertype === 'Trainer');
  // 三種盤面：基準／本回合已放過競技場（踩判準①）／場上已有同名競技場（踩判準②）
  const BOARDS = [
    ['基準盤面', setup([inst(PLAIN.id)], 'tremor')],
    ['本回合已放過競技場', (() => {
      const c = inst(STAD1.id);
      return act(setup([c], 'tremor'), { type: 'PLAY_TRAINER', iid: c.iid }, true);
    })()],
    ['場上已有同名競技場', setup([inst(PLAIN.id)], 'tremor', {}, [inst(STAD1.id)])],
  ];
  let nListed = 0, nNotListed = 0, nThrow = 0;
  const flippedButIllegal = [], acceptedButIllegal = [], listedButNoFlip = [];
  const perBoardNotListed = [];
  for (const [bname, board] of BOARDS) {
    let notListedHere = 0;
    for (const card of TR) {
      const h = inst(card.id);
      // 把一張訓練家卡塞進 B 的手牌（其餘盤面完全不動）
      const s = { ...board, players: [board.players[0], { ...board.players[1], hand: [h, inst(PLAIN.id)] }] };
      const listed = getPlayableTrainers(s, pool).includes(h.iid);
      let r;
      try { r = act(s, { type: 'PLAY_TRAINER', iid: h.iid }, false); }
      catch { nThrow++; continue; }
      const flips = tremorFlips(s, r);
      if (listed) {
        nListed++;
        if (flips !== 1) listedButNoFlip.push([bname, card.id, card.name, card.subtype, flips]);
      } else {
        nNotListed++; notListedHere++;
        if (flips !== 0) flippedButIllegal.push([bname, card.id, card.name, card.subtype, flips]);
        if (!inHand(r, 1, h.iid) || inDisc(r, 1, h.iid)) acceptedButIllegal.push([bname, card.id, card.name, card.subtype]);
      }
    }
    perBoardNotListed.push([bname, notListedHere]);
  }
  chk('G0 哨兵：三種盤面都跑到，而且「列得出來／列不出來」兩邊都非空（⇒ G1/G2 不是空真）',
    nListed > 0 && nNotListed > 0 && nThrow === 0
    && perBoardNotListed.every(([, n]) => n > 0)
    && perBoardNotListed[1][1] > perBoardNotListed[0][1],   // 已放過競技場那盤，非法張數必須更多
    JSON.stringify([TR.length, nListed, nNotListed, nThrow, perBoardNotListed]));
  chk('G1 ⭐⭐⭐凡是 getPlayableTrainers 沒列出來的訓練家卡，handler 一次幣都不擲',
    flippedButIllegal.length === 0,
    JSON.stringify(flippedButIllegal.slice(0, 10)));
  chk('G2 ⭐⭐⭐而且 handler 一律拒絕：那張卡仍在手牌、沒進棄牌區',
    acceptedButIllegal.length === 0,
    JSON.stringify(acceptedButIllegal.slice(0, 10)));
  chk('G3 ⭐⭐哨兵（反方向）：清單**有**列出來的訓練家卡，每一張都確實擲了 1 次幣',
    listedButNoFlip.length === 0,
    JSON.stringify(listedButNoFlip.slice(0, 10)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n═══ v6.360 「卡片真的有使出時才擲硬幣」守衛：PASS ${pass} / FAIL ${fail} ═══`);
process.exit(fail === 0 ? 0 : 1);
