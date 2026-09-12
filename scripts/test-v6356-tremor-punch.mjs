// v6.356 守衛 —— 蟾蜍王｜撼盪拳（M6a 070/103，id 19982）
//
// 卡面逐字（static/cards/M6a.json，台灣官方中文，attacks[].effect）：
//   「在下個對手的回合，每次對手從手牌使出訓練家卡時，使用前擲1次硬幣。
//     若為反面，則不算使用過那張卡，將其丟棄。」
//
// ⚠ 禁止恆真斷言（安慰劑 #27）；⚠ 跨回合旗標「只驗旗標值不驗行為」也是安慰劑（#28）——
//   本檔的主判準一律是「那張訓練家卡的效果到底有沒有發生」（牌庫／手牌／棄牌／場地的**數字**），
//   旗標層／靜態層的斷言只當補充，而且每一條都有對應突變（__m6a/mutcheck_v6356.mjs）證明有牙齒。
// ⚠ 每一組都附「正對照」：同一盤面**沒有**撼盪拳時的結果，證明數字不是 harness 自己生出來的。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6356-s.js'), E = join(ROOT, '.v6356-e.ts'), O = join(ROOT, '.v6356-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, getPlayableTrainers, getPlayableFossils } from './src/lib/game/engine';\n"
  + "export { tryPredictAction, OPTIMISTIC_ACTION_TYPES } from './src/lib/game/optimistic';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, getPlayableTrainers, tryPredictAction, OPTIMISTIC_ACTION_TYPES } = M;

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

const TOAD = byId('19982');   // 蟾蜍王   M6a 070/103 HP160 Stage2【鬥】｜撼盪拳 60 ／ 百萬噸重拳 180
const GAI = byId('19549');    // 蓋伊       支援者：從牌庫抽 3 張（無 picker、無亂數）
const HEI = byId('18380');    // 黑連       支援者：抽 3 張（第二張支援者，用來證明「額度沒被吃掉」）
const SHOVEL = byId('14088'); // 開洞之鏟   物品：將自己牌庫上方 2 張丟棄（無 picker、無亂數）
const POKEBALL = all.find((c) => c.name === '精靈球');   // 物品：自己擲 1 次幣（用來驗「不汙染擲幣副資料」）
const FOSSIL = byId('13947'); // 陳舊的背蓋化石（Item 化石，走 PLAY_FOSSIL）

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;

/** 中立填充卡（Basic／無特性／非太晶／【無】） */
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');
/** 挨打的靶：HP 夠高（撐得住 百萬噸重拳 180）、不弱【鬥】、沒有特性 */
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

const withCoin = (heads, fn) => {
  const orig = Math.random;
  Math.random = () => (heads ? 0.1 : 0.9);
  try { return fn(); } finally { Math.random = orig; }
};
const act = (st, a, heads = true) => withCoin(heads, () => applyAction(st, a, pool));
const LOGS = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l?.text ?? l));
const nLog = (r, s) => LOGS(r).filter((x) => x.includes(s)).length;
/** 這一次 action 期間新增的「擲硬幣」log 行數（撼盪拳專屬那一種） */
const tremorFlips = (before, after) =>
  LOGS(after).slice(LOGS(before).length).filter((x) => /^撼盪拳（.+）：擲硬幣 — /.test(x)).length;
const HAND = (r, i) => r.players[i].hand.length;
const DECK = (r, i) => r.players[i].deck.length;
const DISC = (r, i) => r.players[i].discard.length;
const hasIn = (r, i, key, cardId) => r.players[i][key].some((c) => String(c.cardId) === String(cardId));

const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const I_TREMOR = atkIdx(TOAD, '撼盪拳');
const I_MEGA = atkIdx(TOAD, '百萬噸重拳');

// ══════════════════════════════════════════════════════════════════════════════
// 共用盤面：A（idx0）的 蟾蜍王 出招 → END_TURN ⇒ 輪到 B（idx1），B 身上帶著旗標
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @param mode 'tremor' = 用撼盪拳（旗標會上）／'mega' = 用百萬噸重拳（反對照，旗標不該上）／
 *             'none'   = A 完全不出招（正對照）
 */
const setup = (bHand, mode = 'tremor') => {
  const toad = inst(TOAD.id, {
    energyAttached: [inst(EID.Fighting), inst(EID.Colorless), inst(EID.Colorless), inst(EID.Colorless)],
  });
  let s = mk(
    { active: toad, bench: [inst(PLAIN.id)] },
    { active: inst(TARGET.id), bench: [inst(PLAIN.id)], hand: bHand, deck: deckN(30) },
  );
  if (mode === 'tremor') s = act(s, { type: 'ATTACK', attackIndex: I_TREMOR });
  if (mode === 'mega') s = act(s, { type: 'ATTACK', attackIndex: I_MEGA });
  if (s.activePlayerIndex === 0) s = act(s, { type: 'END_TURN' });
  return s;
};
/** 回到「B 的下一個回合」（B 結束 → A 結束 → 回到 B） */
const nextBTurn = (s, aAttack = null) => {
  s = act(s, { type: 'END_TURN' });                 // B 結束 ⇒ A 的回合
  if (aAttack != null) s = act(s, { type: 'ATTACK', attackIndex: aAttack });
  if (s.activePlayerIndex === 0) s = act(s, { type: 'END_TURN' });
  return s;
};

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】fixture 自驗＋卡面逐字錨（抓錯卡／卡面改版 ⇒ 後面全是假綠）');
{
  chk('0a 蟾蜍王 = M6a／id 19982／HP160／Stage2／【鬥】',
    String(TOAD.setCode) === 'M6a' && Number(TOAD.hp) === 160 && TOAD.stage === 'Stage2'
    && TOAD.pokemonType === 'Fighting',
    JSON.stringify([TOAD.setCode, TOAD.hp, TOAD.stage, TOAD.pokemonType]));
  chk('0b ⭐卡面逐字錨（attacks[].effect）',
    (TOAD.attacks || [])[I_TREMOR]?.effect
      === '在下個對手的回合，每次對手從手牌使出訓練家卡時，使用前擲1次硬幣。若為反面，則不算使用過那張卡，將其丟棄。',
    String((TOAD.attacks || [])[I_TREMOR]?.effect));
  chk('0c ⭐卡面費用／傷害逐字錨：撼盪拳 [鬥] 60；百萬噸重拳 [鬥][無][無][無] 180（無效果）',
    JSON.stringify(TOAD.attacks[I_TREMOR].cost) === '["Fighting"]'
    && String(TOAD.attacks[I_TREMOR].damage) === '60'
    && JSON.stringify(TOAD.attacks[I_MEGA].cost) === '["Fighting","Colorless","Colorless","Colorless"]'
    && String(TOAD.attacks[I_MEGA].damage) === '180'
    && !(TOAD.attacks[I_MEGA].effect || '').trim(),
    JSON.stringify(TOAD.attacks));
  chk('0d ⭐同名不同印刷：全卡庫「蟾蜍王」不只一張，但招式「撼盪拳」只有 M6a 這一張（鍵不會撞）',
    all.filter((c) => c.name === '蟾蜍王').length > 1
    && all.filter((c) => (c.attacks || []).some((a) => a.name === '撼盪拳')).length === 1,
    JSON.stringify(all.filter((c) => c.name === '蟾蜍王').map((c) => [c.setCode, c.id])));
  chk('0e 訓練家 fixture：蓋伊／黑連（支援者·抽3）、開洞之鏟（物品·棄牌庫頂2）、精靈球（物品·自己擲幣）、陳舊的背蓋化石（化石）',
    GAI.subtype === 'Supporter' && HEI.subtype === 'Supporter' && GAI.name !== HEI.name
    && SHOVEL.subtype === 'Item' && POKEBALL?.subtype === 'Item' && FOSSIL.subtype === 'Item',
    JSON.stringify([GAI.name, HEI.name, SHOVEL.name, POKEBALL?.name, FOSSIL.name]));
  chk('0f 靶（HP≥190、不弱【鬥】、無特性）與中立填充卡抓得到',
    !!TARGET && !!PLAIN && Number(TARGET.hp) >= 190,
    JSON.stringify([TARGET?.name, TARGET?.hp, TARGET?.weakness, PLAIN?.name]));
  chk('0g 能量 id 依名稱查得到（硬編會付不出費用 → ATTACK 靜默 return → 假綠）',
    !!EID.Fighting && !!EID.Colorless, JSON.stringify(EID));

  const s = setup([]);
  chk('0h 哨兵：撼盪拳真的結算了（靶身上 60 點，且輪到 B、turnPhase=main）',
    s.players[1].active?.damage === 60 && s.activePlayerIndex === 1 && s.turnPhase === 'main',
    JSON.stringify([s.players[1].active?.damage, s.activePlayerIndex, s.turnPhase]));
  const m = setup([], 'mega');
  chk('0i 哨兵：百萬噸重拳也真的結算了（靶身上 180 點）⇒ 反對照組不是「招式沒跑」',
    m.players[1].active?.damage === 180 && m.activePlayerIndex === 1,
    JSON.stringify([m.players[1].active?.damage, m.activePlayerIndex]));
}

// ── 找兩張「打得出去、會落地、不開 picker」的競技場（動態 fixture，含自驗）──────
let STAD1 = null, STAD2 = null;
{
  const probe = (card) => {
    const c = inst(card.id);
    const base = mk({ active: inst(PLAIN.id) }, { active: inst(PLAIN.id), hand: [c] },
      { activePlayerIndex: 1 });
    let out;
    try { out = withCoin(true, () => applyAction(base, { type: 'PLAY_TRAINER', iid: c.iid }, pool)); }
    catch { return false; }
    return out !== base && !out.pendingSelection
      && String(out.activeStadium?.cardId ?? '') === String(card.id)
      && out.players[0].prizes.length === 6 && out.players[1].prizes.length === 6;
  };
  for (const card of all) {
    if (card.subtype !== 'Stadium') continue;
    if (STAD1 && card.name === STAD1.name) continue;
    if (!probe(card)) continue;
    if (!STAD1) STAD1 = card; else if (!STAD2) { STAD2 = card; break; }
  }
  chk('0j 動態 fixture：找得到兩張不同名、可正常落地的競技場',
    !!STAD1 && !!STAD2 && STAD1.name !== STAD2.name,
    JSON.stringify([STAD1?.name, STAD2?.name]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】正面 ⇒ 訓練家卡照常生效（＋「沒有撼盪拳」與「用別的招式」兩組正／反對照）');
{
  const play = (mode, heads) => {
    const g = inst(GAI.id);
    const s0 = setup([g, inst(PLAIN.id)], mode);
    const s1 = act(s0, { type: 'PLAY_TRAINER', iid: g.iid }, heads);
    return { s0, s1, g };
  };
  const H = play('tremor', true);
  const N = play('none', true);
  const G = play('mega', true);

  chk('A1 ⭐正面 ⇒ 蓋伊的效果真的發生了：牌庫 −3',
    DECK(H.s1, 1) === DECK(H.s0, 1) - 3, JSON.stringify([DECK(H.s0, 1), DECK(H.s1, 1)]));
  chk('A1 ⭐正面 ⇒ 手牌 −1（打出的那張）+3（抽到的）',
    HAND(H.s1, 1) === HAND(H.s0, 1) - 1 + 3, JSON.stringify([HAND(H.s0, 1), HAND(H.s1, 1)]));
  chk('A1 ⭐正面 ⇒ 蓋伊進了棄牌區、且不在手牌',
    hasIn(H.s1, 1, 'discard', GAI.id) && !H.s1.players[1].hand.some((c) => c.iid === H.g.iid));
  chk('A1 ⭐正面 ⇒ 支援者額度**有**被吃掉（＝「算使用過」）',
    H.s1.players[1].supporterPlayedThisTurn === true,
    String(H.s1.players[1].supporterPlayedThisTurn));
  chk('A2 ⭐⭐正對照：同一盤面**沒有**撼盪拳時，牌庫／手牌／棄牌的數字完全一樣',
    DECK(H.s1, 1) - DECK(H.s0, 1) === DECK(N.s1, 1) - DECK(N.s0, 1)
    && HAND(H.s1, 1) - HAND(H.s0, 1) === HAND(N.s1, 1) - HAND(N.s0, 1)
    && DISC(H.s1, 1) - DISC(H.s0, 1) === DISC(N.s1, 1) - DISC(N.s0, 1),
    JSON.stringify([DECK(H.s0, 1), DECK(H.s1, 1), DECK(N.s0, 1), DECK(N.s1, 1)]));
  chk('A3 ⭐⭐反對照：A 改用**百萬噸重拳**（同一隻蟾蜍王、同一盤面）⇒ 完全不擲幣',
    tremorFlips(G.s0, G.s1) === 0 && DECK(G.s1, 1) === DECK(G.s0, 1) - 3,
    JSON.stringify([tremorFlips(G.s0, G.s1), DECK(G.s0, 1), DECK(G.s1, 1)]));
  chk('A4 補充：撼盪拳那一組確實擲了 1 次幣（正對照兩組都是 0 次）',
    tremorFlips(H.s0, H.s1) === 1 && tremorFlips(N.s0, N.s1) === 0,
    JSON.stringify([tremorFlips(H.s0, H.s1), tremorFlips(N.s0, N.s1)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】反面 ⇒ 卡進棄牌區、效果完全沒發生、額度**沒有**被吃掉');
{
  const g = inst(GAI.id);
  const s0 = setup([g, inst(PLAIN.id)]);
  const s1 = act(s0, { type: 'PLAY_TRAINER', iid: g.iid }, false);

  chk('B1 ⭐反面 ⇒ 蓋伊的效果**完全沒有發生**：牌庫一張都沒少',
    DECK(s1, 1) === DECK(s0, 1), JSON.stringify([DECK(s0, 1), DECK(s1, 1)]));
  chk('B1 ⭐反面 ⇒ 手牌只少了那一張（沒有抽到任何卡）',
    HAND(s1, 1) === HAND(s0, 1) - 1, JSON.stringify([HAND(s0, 1), HAND(s1, 1)]));
  chk('B1 ⭐反面 ⇒ 那張卡**確實進了棄牌區**（不是留在手牌 ⇒ 不會無限重擲）',
    hasIn(s1, 1, 'discard', GAI.id) && !s1.players[1].hand.some((c) => c.iid === g.iid)
    && DISC(s1, 1) === DISC(s0, 1) + 1,
    JSON.stringify([DISC(s0, 1), DISC(s1, 1), s1.players[1].hand.map((c) => c.cardId)]));
  chk('B2 ⭐⭐反面 ⇒ 支援者額度**沒有**被吃掉（卡面「不算使用過那張卡」）',
    s1.players[1].supporterPlayedThisTurn !== true,
    String(s1.players[1].supporterPlayedThisTurn));

  // ⭐⭐ 行為端證明（不是只看旗標）：同一回合再打第二張支援者，它的效果必須真的發生
  const h = inst(HEI.id);
  const s0b = setup([g, h, inst(PLAIN.id)]);
  const t1 = act(s0b, { type: 'PLAY_TRAINER', iid: g.iid }, false);   // 蓋伊：反面 ⇒ 丟棄
  const t2 = act(t1, { type: 'PLAY_TRAINER', iid: h.iid }, true);     // 黑連：正面 ⇒ 應該抽 3
  chk('B3 ⭐⭐⭐行為端：反面丟掉一張支援者後，同一回合**還可以**再打一張支援者，且效果真的發生（牌庫 −3）',
    DECK(t2, 1) === DECK(t1, 1) - 3 && HAND(t2, 1) === HAND(t1, 1) - 1 + 3,
    JSON.stringify([DECK(t1, 1), DECK(t2, 1), HAND(t1, 1), HAND(t2, 1)]));

  // 反對照：第一張若是**正面**（算使用過），第二張就打不出去 ⇒ 證明 B3 不是空真
  const u1 = act(s0b, { type: 'PLAY_TRAINER', iid: g.iid }, true);
  const u2 = act(u1, { type: 'PLAY_TRAINER', iid: h.iid }, true);
  chk('B4 ⭐⭐反對照：第一張正面（算使用過）⇒ 第二張支援者被引擎擋下（手牌／牌庫完全沒變）',
    DECK(u2, 1) === DECK(u1, 1) && HAND(u2, 1) === HAND(u1, 1)
    && u1.players[1].supporterPlayedThisTurn === true,
    JSON.stringify([DECK(u1, 1), DECK(u2, 1), HAND(u1, 1), HAND(u2, 1)]));

  // 競技場：同一組證明（額度 stadiumPlayedThisTurn）
  if (STAD1 && STAD2) {
    const c1 = inst(STAD1.id), c2 = inst(STAD2.id);
    const v0 = setup([c1, c2]);
    const v1 = act(v0, { type: 'PLAY_TRAINER', iid: c1.iid }, false);
    const v2 = act(v1, { type: 'PLAY_TRAINER', iid: c2.iid }, true);
    chk('B5 ⭐反面 ⇒ 競技場**沒有**放到場上，卡進棄牌區',
      v1.activeStadium == null && hasIn(v1, 1, 'discard', STAD1.id),
      JSON.stringify([v1.activeStadium, v1.players[1].discard.map((c) => c.cardId)]));
    chk('B6 ⭐反面 ⇒ 競技場額度沒被吃掉（stadiumPlayedThisTurn 仍是 false）',
      !(v1.stadiumPlayedThisTurn ?? [false, false])[1],
      JSON.stringify(v1.stadiumPlayedThisTurn));
    chk('B7 ⭐⭐⭐行為端：反面丟掉一張競技場後，同一回合**還可以**放上另一張競技場（真的落地）',
      String(v2.activeStadium?.cardId ?? '') === String(STAD2.id),
      JSON.stringify([v2.activeStadium?.cardId, STAD2.id]));
    const w1 = act(v0, { type: 'PLAY_TRAINER', iid: c1.iid }, true);
    const w2 = act(w1, { type: 'PLAY_TRAINER', iid: c2.iid }, true);
    chk('B8 ⭐⭐反對照：第一張競技場正面落地後，同一回合第二張被擋 ⇒ 場上仍是第一張',
      String(w1.activeStadium?.cardId ?? '') === String(STAD1.id)
      && String(w2.activeStadium?.cardId ?? '') === String(STAD1.id),
      JSON.stringify([w1.activeStadium?.cardId, w2.activeStadium?.cardId]));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】「每次」⇒ 同一回合的每一張訓練家卡都要各擲 1 次');
{
  const g = inst(GAI.id), sh = inst(SHOVEL.id);
  const s0 = setup([g, sh, inst(PLAIN.id)]);
  const c1 = act(s0, { type: 'PLAY_TRAINER', iid: g.iid }, false);    // 支援者：反面
  const c2 = act(c1, { type: 'PLAY_TRAINER', iid: sh.iid }, false);   // 物品：反面
  chk('C1 ⭐第二張（物品·開洞之鏟）也擲了幣（本回合共 2 次撼盪拳擲幣）',
    tremorFlips(s0, c2) === 2, String(tremorFlips(s0, c2)));
  chk('C2 ⭐第二張反面 ⇒ 開洞之鏟的效果沒發生（牌庫沒有被丟掉 2 張），卡進棄牌區',
    DECK(c2, 1) === DECK(c1, 1) && hasIn(c2, 1, 'discard', SHOVEL.id)
    && HAND(c2, 1) === HAND(c1, 1) - 1,
    JSON.stringify([DECK(c1, 1), DECK(c2, 1)]));

  const g2 = inst(GAI.id), sh2 = inst(SHOVEL.id);
  const d0 = setup([g2, sh2, inst(PLAIN.id)]);
  const d1 = act(d0, { type: 'PLAY_TRAINER', iid: g2.iid }, true);    // 支援者：正面 ⇒ 抽 3
  const d2 = act(d1, { type: 'PLAY_TRAINER', iid: sh2.iid }, true);   // 物品：正面 ⇒ 棄牌庫頂 2
  chk('C3 ⭐⭐混合：第一張正面（抽 3）、第二張正面（牌庫頂 −2 進棄牌）⇒ 兩張效果都真的發生',
    DECK(d1, 1) === DECK(d0, 1) - 3 && DECK(d2, 1) === DECK(d1, 1) - 2
    && DISC(d2, 1) === DISC(d1, 1) + 1 + 2,
    JSON.stringify([DECK(d0, 1), DECK(d1, 1), DECK(d2, 1), DISC(d1, 1), DISC(d2, 1)]));
  chk('C4 補充：混合那一組同樣是各擲 1 次，共 2 次',
    tremorFlips(d0, d2) === 2, String(tremorFlips(d0, d2)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】只持續「下一個」對手回合 —— 再下一個回合不再擲幣');
{
  const g1 = inst(GAI.id), g2 = inst(GAI.id);
  const s0 = setup([g1, g2, inst(PLAIN.id)]);
  const t1 = act(s0, { type: 'PLAY_TRAINER', iid: g1.iid }, false);   // B 第一個回合：反面 ⇒ 被丟棄
  chk('D0 哨兵：B 的第一個回合確實有擲幣且反面生效（牌庫沒動）',
    tremorFlips(s0, t1) === 1 && DECK(t1, 1) === DECK(s0, 1),
    JSON.stringify([tremorFlips(s0, t1), DECK(s0, 1), DECK(t1, 1)]));

  const s2 = nextBTurn(t1);          // B 結束 → A 什麼都不做結束 → 回到 B 的第二個回合
  chk('D1 哨兵：確實回到 B 的回合',
    s2.activePlayerIndex === 1 && s2.turnPhase === 'main',
    JSON.stringify([s2.activePlayerIndex, s2.turnPhase]));
  const t2 = act(s2, { type: 'PLAY_TRAINER', iid: g2.iid }, false);   // 擲幣若還在，反面就會被丟掉
  chk('D2 ⭐⭐再下一個回合**不再擲幣**：同樣的「反面」亂數，蓋伊照樣生效（牌庫 −3）',
    DECK(t2, 1) === DECK(s2, 1) - 3 && HAND(t2, 1) === HAND(s2, 1) - 1 + 3,
    JSON.stringify([DECK(s2, 1), DECK(t2, 1), HAND(s2, 1), HAND(t2, 1)]));
  chk('D3 ⭐再下一個回合完全沒有撼盪拳的擲幣 log',
    tremorFlips(s2, t2) === 0, String(tremorFlips(s2, t2)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】蟾蜍王被 KO／被換下場 ⇒ 效果仍然生效（旗標掛在對手玩家身上，不是掛在卡上）');
{
  const mkE = (mutate) => {
    const g = inst(GAI.id);
    let s = setup([g, inst(PLAIN.id)]);
    s = mutate(s);
    return { s0: s, s1: act(s, { type: 'PLAY_TRAINER', iid: g.iid }, false), g };
  };
  // ① 蟾蜍王被 KO：整張離場進棄牌區，戰鬥場換成中立卡
  const ko = mkE((s) => {
    const p0 = s.players[0];
    const toad = p0.active;
    return { ...s, players: [{ ...p0, active: inst(PLAIN.id), discard: [...p0.discard, toad] }, s.players[1]] };
  });
  chk('E1 ⭐⭐蟾蜍王已被 KO（離場進棄牌區）⇒ 反面照樣把訓練家卡丟掉、效果沒發生',
    DECK(ko.s1, 1) === DECK(ko.s0, 1) && hasIn(ko.s1, 1, 'discard', GAI.id)
    && tremorFlips(ko.s0, ko.s1) === 1,
    JSON.stringify([DECK(ko.s0, 1), DECK(ko.s1, 1), tremorFlips(ko.s0, ko.s1)]));
  chk('E1 哨兵：蟾蜍王確實不在攻擊方場上了',
    ko.s0.players[0].active?.cardId !== String(TOAD.id)
    && !ko.s0.players[0].bench.some((c) => String(c.cardId) === String(TOAD.id)),
    JSON.stringify([ko.s0.players[0].active?.cardId]));
  // ② 蟾蜍王被換下場（退到備戰）
  const sw = mkE((s) => {
    const p0 = s.players[0];
    const toad = p0.active, other = p0.bench[0];
    return { ...s, players: [{ ...p0, active: other, bench: [toad] }, s.players[1]] };
  });
  chk('E2 ⭐蟾蜍王被換到備戰區 ⇒ 反面照樣生效',
    DECK(sw.s1, 1) === DECK(sw.s0, 1) && hasIn(sw.s1, 1, 'discard', GAI.id)
    && tremorFlips(sw.s0, sw.s1) === 1,
    JSON.stringify([DECK(sw.s0, 1), DECK(sw.s1, 1)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】兩回合連續使用撼盪拳 ⇒ 不疊加（仍然只擲 1 次）');
{
  const g1 = inst(GAI.id), g2 = inst(GAI.id);
  let s = setup([g1, g2, inst(PLAIN.id)]);          // B 第 1 個回合（旗標已上）
  s = nextBTurn(s, I_TREMOR);                       // B 結束 → A 再用一次撼盪拳 → 回到 B 第 2 個回合
  chk('F0 哨兵：確實回到 B 的回合，而且靶身上累積了 120 點（60×2 ⇒ A 真的打了第二次）',
    s.activePlayerIndex === 1 && s.players[1].active?.damage === 120,
    JSON.stringify([s.activePlayerIndex, s.players[1].active?.damage]));
  const f1 = act(s, { type: 'PLAY_TRAINER', iid: g2.iid }, false);
  chk('F1 ⭐⭐連續兩回合使用 ⇒ 一張訓練家卡仍然只擲 **1** 次（不是 2 次）',
    tremorFlips(s, f1) === 1, String(tremorFlips(s, f1)));
  chk('F2 ⭐行為端不變：反面 ⇒ 卡進棄牌、效果沒發生',
    DECK(f1, 1) === DECK(s, 1) && hasIn(f1, 1, 'discard', GAI.id),
    JSON.stringify([DECK(s, 1), DECK(f1, 1)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【G】化石走 PLAY_FOSSIL（化石在手牌中視為「物品」卡 ⇒ 涵蓋在「訓練家卡」裡）');
{
  const mkG = (mode) => {
    const f = inst(FOSSIL.id);
    const s0 = setup([f, inst(PLAIN.id)], mode);
    return { f, s0 };
  };
  const T = mkG('tremor');
  const tail = act(T.s0, { type: 'PLAY_FOSSIL', iid: T.f.iid }, false);
  const head = act(T.s0, { type: 'PLAY_FOSSIL', iid: T.f.iid }, true);
  const N = mkG('none');
  const ctrl = act(N.s0, { type: 'PLAY_FOSSIL', iid: N.f.iid }, false);

  chk('G0 哨兵：沒有撼盪拳時，化石照常上備戰區（備戰 +1、手牌 −1）',
    ctrl.players[1].bench.length === N.s0.players[1].bench.length + 1
    && HAND(ctrl, 1) === HAND(N.s0, 1) - 1
    && ctrl.players[1].bench.some((c) => String(c.cardId) === String(FOSSIL.id)),
    JSON.stringify([N.s0.players[1].bench.length, ctrl.players[1].bench.length]));
  chk('G1 ⭐正面 ⇒ 化石照常上場（備戰 +1）',
    head.players[1].bench.length === T.s0.players[1].bench.length + 1
    && head.players[1].bench.some((c) => String(c.cardId) === String(FOSSIL.id))
    && tremorFlips(T.s0, head) === 1,
    JSON.stringify([T.s0.players[1].bench.length, head.players[1].bench.length]));
  chk('G2 ⭐⭐反面 ⇒ 化石**沒有**上場（備戰不變）、卡進棄牌區、手牌 −1',
    tail.players[1].bench.length === T.s0.players[1].bench.length
    && hasIn(tail, 1, 'discard', FOSSIL.id)
    && HAND(tail, 1) === HAND(T.s0, 1) - 1
    && tremorFlips(T.s0, tail) === 1,
    JSON.stringify([T.s0.players[1].bench.length, tail.players[1].bench.length,
      HAND(T.s0, 1), HAND(tail, 1)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【H】不得汙染「重試徽章」專用的擲幣副資料（coinFlippedThisAttack／_machineGunLastFlips）');
{
  // H1：本身不擲幣的訓練家卡（蓋伊）—— 打完之後兩個欄位都要維持打之前的值
  const g = inst(GAI.id);
  const s0 = setup([g, inst(PLAIN.id)]);
  const s1 = act(s0, { type: 'PLAY_TRAINER', iid: g.iid }, true);
  chk('H1 ⭐coinFlippedThisAttack 不被撼盪拳的擲幣設起來（打之前是什麼，打之後就是什麼）',
    s1.coinFlippedThisAttack === s0.coinFlippedThisAttack && s1.coinFlippedThisAttack !== true,
    JSON.stringify([s0.coinFlippedThisAttack, s1.coinFlippedThisAttack]));
  chk('H1 ⭐_machineGunLastFlips 不被撼盪拳的擲幣累加',
    (s1._machineGunLastFlips ?? []).length === (s0._machineGunLastFlips ?? []).length,
    JSON.stringify([s0._machineGunLastFlips, s1._machineGunLastFlips]));

  // H2 ⭐⭐行為端：改用「卡片自己也會擲幣」的精靈球 ——
  //   重試徽章 modal 顯示給玩家看的就是 _machineGunLastFlips。
  //   汙染的話這裡會變成 2 筆（多出撼盪拳那一次），玩家會看到不屬於這張卡的擲幣結果。
  const pb = inst(POKEBALL.id);
  const p0 = setup([pb, inst(PLAIN.id)]);
  const p1 = act(p0, { type: 'PLAY_TRAINER', iid: pb.iid }, true);
  const pb2 = inst(POKEBALL.id);
  const q0 = setup([pb2, inst(PLAIN.id)], 'none');
  const q1 = act(q0, { type: 'PLAY_TRAINER', iid: pb2.iid }, true);
  chk('H2 ⭐⭐精靈球（自己會擲幣）打完後，擲幣副資料只有**它自己那 1 次**',
    (p1._machineGunLastFlips ?? []).length === 1,
    JSON.stringify(p1._machineGunLastFlips));
  chk('H2 ⭐⭐正對照：沒有撼盪拳時也是 1 次（數量完全相同 ⇒ 撼盪拳沒有偷加）',
    (p1._machineGunLastFlips ?? []).length === (q1._machineGunLastFlips ?? []).length,
    JSON.stringify([p1._machineGunLastFlips, q1._machineGunLastFlips]));
  chk('H3 哨兵：那一組 log 裡確實同時有「撼盪拳（精靈球）」與「精靈球」各 1 次擲幣',
    tremorFlips(p0, p1) === 1 && nLog(p1, '精靈球：擲硬幣') === 1,
    JSON.stringify(LOGS(p1).slice(LOGS(p0).length)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【I】線上樂觀更新：擲幣路徑必須被判定為「不可預測」，強制走伺服器');
{
  const f1 = inst(FOSSIL.id);
  const withFlag = setup([f1, inst(PLAIN.id)]);
  const f2 = inst(FOSSIL.id);
  const noFlag = setup([f2, inst(PLAIN.id)], 'none');
  const r1 = tryPredictAction(withFlag, { type: 'PLAY_FOSSIL', iid: f1.iid }, pool);
  const r2 = tryPredictAction(noFlag, { type: 'PLAY_FOSSIL', iid: f2.iid }, pool);
  chk('I1 ⭐⭐有撼盪拳旗標時，PLAY_FOSSIL **不可**被樂觀預測（gate ④ randomness）',
    r1.ok === false && String(r1.reason).startsWith('randomness'), JSON.stringify(r1.reason ?? r1.ok));
  chk('I2 ⭐⭐正對照：沒有旗標時，同一個 PLAY_FOSSIL **可以**被預測（證明 I1 不是恆假）',
    r2.ok === true, JSON.stringify(r2.reason ?? r2.ok));
  chk('I3 補充：PLAY_TRAINER 本來就不在樂觀白名單裡（永遠走伺服器）',
    !OPTIMISTIC_ACTION_TYPES.has('PLAY_TRAINER'), JSON.stringify([...OPTIMISTIC_ACTION_TYPES]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【J】中央性（靜態接線）：一個閘、兩個呼叫點，而且兩個都在「從手牌使出訓練家卡」的 handler 裡');
{
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const defs = eng.split('function tremorPunchTrainerGate(').length - 1;
  const calls = eng.split('tremorPunchTrainerGate(state, aIdx,').length - 1;
  chk('J1 ⭐中央閘只有 1 份定義', defs === 1, String(defs));
  chk('J2 ⭐⭐呼叫點恰好 2 個（PLAY_TRAINER ＋ PLAY_FOSSIL）', calls === 2, String(calls));
  const iFossil = eng.indexOf("action.type === 'PLAY_FOSSIL'");
  const iTrainer = eng.indexOf("action.type === 'PLAY_TRAINER'", iFossil);
  const iCallF = eng.indexOf('tremorPunchTrainerGate(state, aIdx,', iFossil);
  const iCallT = eng.indexOf('tremorPunchTrainerGate(state, aIdx,', iTrainer);
  chk('J3 ⭐第 1 個呼叫點落在 PLAY_FOSSIL handler 內（在 PLAY_TRAINER 之前）',
    iFossil > 0 && iCallF > iFossil && iCallF < iTrainer, JSON.stringify([iFossil, iCallF, iTrainer]));
  chk('J4 ⭐第 2 個呼叫點落在 PLAY_TRAINER handler 內，且在「移出手牌」之前',
    iCallT > iTrainer && iCallT < eng.indexOf('attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);', iTrainer),
    String(iCallT));
  chk('J5 ⭐⭐反安慰劑：「本回合要擲幣嗎」這個判斷全站只讀 1 次（就在中央閘裡）',
    (eng.split('players[aIdx].trainerCoinFlipThisTurn').length - 1) === 1,
    String(eng.split('players[aIdx].trainerCoinFlipThisTurn').length - 1));
  chk('J5b ⭐旗標在 engine.ts 只出現 4 次：閘的讀取 ＋ END_TURN 的清除條件／delete ＋ promote 的賦值',
    (eng.split('.trainerCoinFlipThisTurn').length - 1) === 4,
    String(eng.split('.trainerCoinFlipThisTurn').length - 1));
  const eff = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  chk('J6 ⭐招式只登記在一處，而且用的是家族 helper',
    (eff.split("regPost('蟾蜍王|撼盪拳'").length - 1) === 1
    && eff.includes("regPost('蟾蜍王|撼盪拳', oppTrainerCoinFlipNextPost('撼盪拳'))"),
    String(eff.split("regPost('蟾蜍王|撼盪拳'").length - 1));
  chk('J7 ⭐反安慰劑：撼盪拳**沒有**自己寫死傷害（60 由引擎讀卡面）',
    !eff.includes("regPre('蟾蜍王|撼盪拳'"));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n═══ v6.356 撼盪拳守衛：PASS ${pass} / FAIL ${fail} ═══`);
process.exit(fail === 0 ? 0 : 1);
