#!/usr/bin/env node
/**
 * v6.354 守衛：「禁止恢復 HP」中央閘 + 伊裴爾塔爾｜生命制約（M6a 079/103，id 19991）
 *
 * 卡面逐字（static/cards/M6a.json，id 19991 的 `abilities[].effect`）：
 *   「只要這隻寶可夢在場上，對手的戰鬥寶可夢的HP無法恢復。」
 *
 * ⭐ 全部**行為端**：真的建盤面 → 跑 PLAY_TRAINER / ATTACK / USE_STADIUM / USE_ABILITY /
 *   END_TURN → 看盤面上的 damage 數字。被動特性沒有 handler，「registry 有沒有 key」
 *   完全不能當覆蓋率（Rule 33）。
 * ⭐ 每一條效果斷言都配哨兵：同一盤面的對照組數字必須是「沒有這個特性時的值」，
 *   證明差異真的來自這個特性，而不是那張卡／那一招根本沒跑（假綠）。
 * ⚠ 禁止恆真斷言：每一條都能被 __m6a/mutcheck_v6354.mjs 的某一個突變打紅。
 *
 * ⚠ 官方裁定（PTCG RULES/PTCG_RULES.md）：
 *   §17.3.H L779「改附傷害指示物不屬於恢復體力。」          → 【G】
 *   §17.3.I L818「可以使用（野餐籃）。但是，寶可夢無法恢復體力。」→ 【H】
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6354-s.js'), E = join(ROOT, '.v6354-e.ts'), O = join(ROOT, '.v6354-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, getUsableAbilities, markHealsByDamageDecrease } from './src/lib/game/engine';\n"
  + "export { isHealBlockedFor, hasEffectiveLifeRestraintOnSide } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, getUsableAbilities, markHealsByDamageDecrease,
  isHealBlockedFor, hasEffectiveLifeRestraintOnSide } = M;

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
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('fixture 找不到 id ' + id); return c; };
const byName = (n) => { const c = all.find((x) => x.name === n); if (!c) throw new Error('fixture 找不到 ' + n); return c; };
const findAb = (n, ab) => {
  const h = all.filter((c) => c.name === n && (c.abilities || []).some((a) => a.name === ab));
  if (!h.length) throw new Error(`fixture 找不到 ${n}｜${ab}`);
  return h.find((c) => String(c.setCode) === 'M6a') ?? h[0];
};

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
  name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [],
  abilityNamesUsedThisTurn: [], ...o,
});
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P(p0), P(p1)], ...extra,
});

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
/** heads=false ⇒ 擲幣反面 */
const act = (st, a, heads = true) => {
  const o = Math.random; Math.random = () => (heads ? 0.1 : 0.9);
  try { return applyAction(st, a, pool); }
  catch (e) { return { __err: e.message, log: [], players: st.players }; }
  finally { Math.random = o; }
};
const atkIdx = (c, n) => (c.attacks || []).findIndex((a) => a.name === n);
const eCost = (c, n) => ((c.attacks || []).find((a) => a.name === n)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));
const A0 = (r) => r?.players?.[0]?.active, B0 = (r) => r?.players?.[0]?.bench;
const A1 = (r) => r?.players?.[1]?.active;
const L = (r) => (r?.log ?? []).map((x) => String(x?.message ?? '')).join(' | ');
const findInst = (p, iid) => (p.active?.iid === iid ? p.active : p.bench.find((b) => b.iid === iid));

// ── fixtures ────────────────────────────────────────────────────────────────
const YVEL   = findAb('伊裴爾塔爾', '生命制約');   // M6a 079/103（id 19991）
const SNOR   = findAb('卡比獸', '好眠');           // M6a 095/103（id 20007，HP160）
const APE    = findAb('願增猿', '腎上腺腦力');     // 改放傷害指示物（§17.3.H）
const POTION = byName('傷藥');                     // Item：heal-target → healResolver
const CHEF   = byName('西餐廚師');                 // Supporter：effects.ts inline，戰鬥寶可夢回 70
const HALL   = byName('居民會館');                 // Stadium：engine.ts inline，自己全體回 10
const TRENCH = byName('傳說的海溝');               // Stadium：恢復的HP改為 2 倍（v6.077）
const PIKA   = byId(19933);                        // 皮卡丘｜小憩（M6a）：selfHealPost(30)
const LARV   = all.find((c) => c.name === '蘭螳花ex' && (c.attacks || []).some((a) => a.name === '活潑刀'));
/** 乾淨對照靶：Basic／無特性／非太晶／非 ex／【無】屬性／HP≥120 */
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 120 && c.pokemonType === 'Colorless'
  && c.subtype !== 'ex' && !/ex$/i.test(c.name));
/** 活潑刀（60+200，【草】）打不死的靶：HP≥270 且對【草】既不弱也不抗 */
const TOUGH = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 270
  && c.weakness?.type !== 'Grass' && c.resistance?.type !== 'Grass');
const SIDE = (o) => ({ deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), ...o });

// ── 共用情境 ────────────────────────────────────────────────────────────────
/** p0 的戰鬥寶可夢受傷 dmg，打出「傷藥」回自己的戰鬥寶可夢；p1 場上放 p1Active/p1Bench。 */
const potionOnOwnActive = (p1ActiveCard, p1BenchCards, dmg = 60, p1ActExtra = {}, stadium = null) => {
  const hurt = inst(PLAIN.id, { damage: dmg });
  const pot = inst(POTION.id);
  const st = mk(
    SIDE({ active: hurt, hand: [pot] }),
    SIDE({ active: inst(p1ActiveCard.id, p1ActExtra), bench: p1BenchCards.map((c) => inst(c.id)) }),
    stadium ? { activeStadium: inst(stadium.id), activeStadiumOwnerIdx: 0, stadiumUsedThisTurn: [false, false] } : {});
  const r1 = act(st, { type: 'PLAY_TRAINER', iid: pot.iid });
  const r2 = act(r1, { type: 'RESOLVE_SELECTION', selectedIids: [hurt.iid], senderIdx: 0 });
  return { r1, r2, hurtIid: hurt.iid };
};

console.log('\n【0】fixture 自驗 ＋ 卡面逐字錨');
{
  chk('0a 抓到 M6a 的伊裴爾塔爾（079/103）', String(YVEL.id) === '19991' && String(YVEL.setCode) === 'M6a',
    `${YVEL.id}/${YVEL.setCode}`);
  chk('0b ⭐卡面逐字錨（卡面改版／抓錯卡就紅）',
    (YVEL.abilities || []).find((a) => a.name === '生命制約')?.effect
      === '只要這隻寶可夢在場上，對手的戰鬥寶可夢的HP無法恢復。',
    String((YVEL.abilities || [])[0]?.effect));
  chk('0c 卡面基本資料：Basic／HP120／【惡】／J 標',
    YVEL.stage === 'Basic' && Number(YVEL.hp) === 120 && YVEL.pokemonType === 'Darkness' && YVEL.regulationMark === 'J',
    `${YVEL.stage}/${YVEL.hp}/${YVEL.pokemonType}/${YVEL.regulationMark}`);
  chk('0d 對照靶／回血卡／競技場卡都抓得到',
    !!PLAIN && !!TOUGH && POTION.subtype === 'Item' && CHEF.subtype === 'Supporter'
      && HALL.subtype === 'Stadium' && TRENCH.subtype === 'Stadium' && !!PIKA && !!LARV && !!APE && !!SNOR,
    `${PLAIN?.name}/${TOUGH?.name}/${POTION.subtype}/${CHEF.subtype}/${HALL.subtype}/${TRENCH.subtype}`);
  // ⭐ 純被動 ⇒ 絕不可以出現在「可使用的特性」清單（否則 UI 會亮一顆按不下去的按鈕）
  const stv = mk(SIDE({ active: inst(PLAIN.id) }), SIDE({ active: inst(YVEL.id) }), { activePlayerIndex: 1 });
  chk('0e ⭐反安慰劑：生命制約是純被動 ⇒ 不會混進 getUsableAbilities',
    !getUsableAbilities(stv, pool).some((u) => u.abilityName === '生命制約'));
}

console.log('\n【A】基準：沒有伊裴爾塔爾時，三種不同回血管線都正常（哨兵）');
{
  // A1 healResolver 型（傷藥 → pending heal-target → healResolver）
  const a1 = potionOnOwnActive(PLAIN, [PLAIN]);
  chk('A1 healResolver 型（傷藥）：60 → 30', A0(a1.r2)?.damage === 30, String(A0(a1.r2)?.damage));
  chk('A1b 哨兵：healedThisTurn 真的被標起來', A0(a1.r2)?.healedThisTurn === true, String(A0(a1.r2)?.healedThisTurn));

  // A2 selfHealPost 型（皮卡丘｜小憩：將這隻寶可夢恢復「30」HP）
  const pk = inst(PIKA.id, { damage: 60, energyAttached: eCost(PIKA, '小憩') });
  const a2 = act(mk(SIDE({ active: pk }), SIDE({ active: inst(PLAIN.id), bench: [inst(PLAIN.id)] })),
    { type: 'ATTACK', attackIndex: atkIdx(PIKA, '小憩') });
  chk('A2 selfHealPost 型（皮卡丘｜小憩）：60 → 30', A0(a2)?.damage === 30, String(A0(a2)?.damage));

  // A3 engine.ts inline 型（居民會館：自己寶可夢各回 10）
  const h = inst(PLAIN.id, { damage: 50 }), b = inst(PLAIN.id, { damage: 50 });
  const a3 = act(mk(SIDE({ active: h, bench: [b], supporterPlayedThisTurn: true }),
    SIDE({ active: inst(PLAIN.id), bench: [inst(PLAIN.id)] }),
    { activeStadium: inst(HALL.id), activeStadiumOwnerIdx: 0, stadiumUsedThisTurn: [false, false] }),
  { type: 'USE_STADIUM' });
  chk('A3 engine inline 型（居民會館）：戰鬥場 50 → 40、備戰 50 → 40',
    A0(a3)?.damage === 40 && B0(a3)?.[0]?.damage === 40,
    `${A0(a3)?.damage}/${B0(a3)?.[0]?.damage}`);

  // A4 effects.ts inline 型（西餐廚師：戰鬥寶可夢回 70）
  const h4 = inst(PLAIN.id, { damage: 100 }), c4 = inst(CHEF.id);
  const a4 = act(mk(SIDE({ active: h4, hand: [c4] }), SIDE({ active: inst(PLAIN.id) })),
    { type: 'PLAY_TRAINER', iid: c4.iid });
  chk('A4 effects inline 型（西餐廚師）：100 → 30', A0(a4)?.damage === 30, String(A0(a4)?.damage));
}

console.log('\n【B】⭐⭐伊裴爾塔爾在對手**備戰** ⇒ 對手戰鬥寶可夢完全不回血');
{
  const b1 = potionOnOwnActive(PLAIN, [YVEL]);
  chk('B1 傷藥：damage 一點都沒少（60）', A0(b1.r2)?.damage === 60, String(A0(b1.r2)?.damage));
  chk('B1b 哨兵：傷藥真的執行了（pending 開出來且 log 寫了回復 30 HP）',
    b1.r1.pendingSelection?.effectKey === 'heal-30' && L(b1.r2).includes('回復 30 HP'),
    `${b1.r1.pendingSelection?.effectKey} | ${L(b1.r2)}`);

  const pk = inst(PIKA.id, { damage: 60, energyAttached: eCost(PIKA, '小憩') });
  const b2 = act(mk(SIDE({ active: pk }), SIDE({ active: inst(PLAIN.id), bench: [inst(YVEL.id)] })),
    { type: 'ATTACK', attackIndex: atkIdx(PIKA, '小憩') });
  chk('B2 selfHealPost（小憩）：60 → 60', A0(b2)?.damage === 60, String(A0(b2)?.damage));
  chk('B2b 哨兵：小憩真的使出了（log 有「小憩」）', L(b2).includes('小憩'), L(b2));

  const h4 = inst(PLAIN.id, { damage: 100 }), c4 = inst(CHEF.id);
  const b3 = act(mk(SIDE({ active: h4, hand: [c4] }), SIDE({ active: inst(PLAIN.id), bench: [inst(YVEL.id)] })),
    { type: 'PLAY_TRAINER', iid: c4.iid });
  chk('B3 effects inline（西餐廚師）：100 → 100', A0(b3)?.damage === 100, String(A0(b3)?.damage));

  const h = inst(PLAIN.id, { damage: 50 });
  const b4 = act(mk(SIDE({ active: h, supporterPlayedThisTurn: true }),
    SIDE({ active: inst(PLAIN.id), bench: [inst(YVEL.id)] }),
    { activeStadium: inst(HALL.id), activeStadiumOwnerIdx: 0, stadiumUsedThisTurn: [false, false] }),
  { type: 'USE_STADIUM' });
  chk('B4 engine inline（居民會館）：50 → 50', A0(b4)?.damage === 50, String(A0(b4)?.damage));

  chk('B5 ⭐中央揭示 log：「生命制約：…的HP無法恢復」', L(b1.r2).includes('的HP無法恢復')
    && L(b1.r2).includes('生命制約'), L(b1.r2));
}

console.log('\n【C】⭐伊裴爾塔爾在**戰鬥場**也生效');
{
  const c1 = potionOnOwnActive(YVEL, []);
  chk('C1 持有者在戰鬥場：60 → 60', A0(c1.r2)?.damage === 60, String(A0(c1.r2)?.damage));
  chk('C1b 哨兵：同盤面把伊裴爾塔爾換成無特性寶可夢 ⇒ 照樣回到 30',
    A0(potionOnOwnActive(PLAIN, []).r2)?.damage === 30,
    String(A0(potionOnOwnActive(PLAIN, []).r2)?.damage));
}

console.log('\n【D】⭐⭐只擋戰鬥位：同一次全體回血中，對手的**備戰**照樣回血');
{
  const h = inst(PLAIN.id, { damage: 50 }), b = inst(PLAIN.id, { damage: 50 });
  const d1 = act(mk(SIDE({ active: h, bench: [b], supporterPlayedThisTurn: true }),
    SIDE({ active: inst(PLAIN.id), bench: [inst(YVEL.id)] }),
    { activeStadium: inst(HALL.id), activeStadiumOwnerIdx: 0, stadiumUsedThisTurn: [false, false] }),
  { type: 'USE_STADIUM' });
  chk('D1 居民會館：戰鬥場被擋（50），但**備戰照回**（40）',
    A0(d1)?.damage === 50 && B0(d1)?.[0]?.damage === 40, `${A0(d1)?.damage}/${B0(d1)?.[0]?.damage}`);

  // D2 傷藥直接指定備戰 ⇒ 完全不受影響
  const act2 = inst(PLAIN.id, { damage: 60 }), ben = inst(PLAIN.id, { damage: 60 }), pot = inst(POTION.id);
  const st = mk(SIDE({ active: act2, bench: [ben], hand: [pot] }),
    SIDE({ active: inst(PLAIN.id), bench: [inst(YVEL.id)] }));
  const d2 = act(act(st, { type: 'PLAY_TRAINER', iid: pot.iid }),
    { type: 'RESOLVE_SELECTION', selectedIids: [ben.iid], senderIdx: 0 });
  chk('D2 傷藥指定**備戰** ⇒ 照樣回血（60 → 30）',
    findInst(d2.players[0], ben.iid)?.damage === 30, String(findInst(d2.players[0], ben.iid)?.damage));
  chk('D2b 哨兵：同一盤面的戰鬥寶可夢沒被動到（仍是 60）', A0(d2)?.damage === 60, String(A0(d2)?.damage));
}

console.log('\n【E】⭐⭐只擋對手：伊裴爾塔爾持有者**自己的**戰鬥寶可夢照樣回血');
{
  const hurt = inst(PLAIN.id, { damage: 60 }), pot = inst(POTION.id);
  const st = mk(SIDE({ active: inst(PLAIN.id) }),
    SIDE({ active: hurt, bench: [inst(YVEL.id)], hand: [pot] }), { activePlayerIndex: 1 });
  const e1 = act(act(st, { type: 'PLAY_TRAINER', iid: pot.iid }),
    { type: 'RESOLVE_SELECTION', selectedIids: [hurt.iid], senderIdx: 1, actorIdx: 1 });
  chk('E1 持有者自己的戰鬥寶可夢：60 → 30（不自己擋自己）', A1(e1)?.damage === 30, String(A1(e1)?.damage));
  chk('E1b 哨兵：鏡像盤面（換成 p0 打傷藥回 p0）就會被擋 ⇒ 差異真的來自「哪一側」',
    A0(potionOnOwnActive(PLAIN, [YVEL]).r2)?.damage === 60);
}

console.log('\n【F】⭐特性被消除 ⇒ 回血恢復正常');
{
  const f1 = potionOnOwnActive(YVEL, [], 60, { abilityNullifiedThisTurn: true });
  chk('F1 伊裴爾塔爾特性被消除（abilityNullifiedThisTurn）⇒ 60 → 30',
    A0(f1.r2)?.damage === 30, String(A0(f1.r2)?.damage));
  const f2 = potionOnOwnActive(YVEL, [], 60);
  chk('F1b 正對照：同盤面不消除 ⇒ 仍然被擋（60）', A0(f2.r2)?.damage === 60, String(A0(f2.r2)?.damage));
}

console.log('\n【G】⭐⭐移動傷害指示物不算恢復（官方 §17.3.H L779）');
{
  const hurt = inst(PLAIN.id, { damage: 30 });
  const ape = inst(APE.id, { energyAttached: [inst(EID.Darkness)] });
  const oppA = inst(PLAIN.id);
  const st = mk(SIDE({ active: hurt, bench: [ape] }), SIDE({ active: oppA, bench: [inst(YVEL.id)] }));
  let g = act(st, { type: 'USE_ABILITY', iid: ape.iid, abilityIndex: 0 });
  g = act(g, { type: 'RESOLVE_SELECTION', selectedIids: [hurt.iid], senderIdx: 0 });
  g = act(g, { type: 'RESOLVE_SELECTION', selectedIids: ['3'], senderIdx: 0 });
  g = act(g, { type: 'RESOLVE_SELECTION', selectedIids: [oppA.iid], senderIdx: 0 });
  chk('G1 被擋方仍然可以把自己戰鬥位的指示物**移走**（30 → 0）',
    A0(g)?.damage === 0, String(A0(g)?.damage));
  chk('G1b 哨兵：指示物真的搬到對手身上（對手戰鬥位 +30）', A1(g)?.damage === 30, String(A1(g)?.damage));
  chk('G1c ⭐移動不算恢復 ⇒ 不可以標 healedThisTurn（v5.947 既有判準沒被破壞）',
    A0(g)?.healedThisTurn !== true, String(A0(g)?.healedThisTurn));
}

console.log('\n【H】⭐⭐卡照樣能打出（官方 §17.3.I L818「可以使用。但是，寶可夢無法恢復體力。」）');
{
  const h = potionOnOwnActive(PLAIN, [YVEL]);
  chk('H1 傷藥仍然被使用掉：手牌 0、棄牌區 1',
    h.r2.players[0].hand.length === 0 && h.r2.players[0].discard.length === 1,
    `hand=${h.r2.players[0].hand.length} discard=${h.r2.players[0].discard.length}`);
  chk('H2 棄牌區裡就是那張傷藥（不是別張）',
    pool.get(h.r2.players[0].discard[0]?.cardId)?.name === '傷藥',
    String(pool.get(h.r2.players[0].discard[0]?.cardId)?.name));
  chk('H3 ⭐絕對不是「gate 住不能使用」：picker 有開、效果有跑，只是恢復量變 0',
    h.r1.pendingSelection?.type === 'heal-target' && A0(h.r2)?.damage === 60,
    `${h.r1.pendingSelection?.type}/${A0(h.r2)?.damage}`);
}

console.log('\n【I】⭐⭐healedThisTurn 不可以被誤標（活潑刀家族）');
{
  const runLarv = (p1BenchCards) => {
    const lar = inst(LARV.id, { damage: 60, energyAttached: eCost(LARV, '活潑刀') });
    const pot = inst(POTION.id);
    const st = mk(SIDE({ active: lar, hand: [pot] }),
      SIDE({ active: inst(TOUGH.id), bench: p1BenchCards.map((c) => inst(c.id)) }));
    const r1 = act(act(st, { type: 'PLAY_TRAINER', iid: pot.iid }),
      { type: 'RESOLVE_SELECTION', selectedIids: [lar.iid], senderIdx: 0 });
    return { r1, r2: act(r1, { type: 'ATTACK', attackIndex: atkIdx(LARV, '活潑刀') }) };
  };
  const iy = runLarv([YVEL]), ic = runLarv([PLAIN]);
  chk('I1 被擋下的回血**不算**恢復過 ⇒ healedThisTurn 沒被標',
    A0(iy.r1)?.healedThisTurn !== true, String(A0(iy.r1)?.healedThisTurn));
  chk('I2 ⭐行為端：活潑刀只打 60（不是 60+200）', A1(iy.r2)?.damage === 60, String(A1(iy.r2)?.damage));
  chk('I3 哨兵／反對照：沒有伊裴爾塔爾時 healedThisTurn=true 且活潑刀打 260',
    A0(ic.r1)?.healedThisTurn === true && A1(ic.r2)?.damage === 260,
    `${A0(ic.r1)?.healedThisTurn}/${A1(ic.r2)?.damage}`);
}

console.log('\n【J】⭐傷害指示物完全不變（不是清 0、也不是多加）');
{
  for (const d of [10, 60, 110]) {
    const j = potionOnOwnActive(PLAIN, [YVEL], d);
    chk(`J(${d}) damage 精確等於原值 ${d}（不是 0、不是 ${d + 30}、不是 ${Math.max(0, d - 30)}）`,
      A0(j.r2)?.damage === d, String(A0(j.r2)?.damage));
  }
}

console.log('\n【K】卡比獸｜好眠（v6.347）的時序：回血發生在 action **內部**，閘在出口回捲');
{
  const endTurn = (st) => act(st, { type: 'END_TURN' }, false);   // 反面 ⇒ 沒醒來 ⇒ 好眠觸發
  const runSleep = (p1BenchCards, dmg, extra = {}) => {
    const sn = inst(SNOR.id, { damage: dmg, status: 'asleep', ...extra });
    return endTurn(mk(SIDE({ active: sn, bench: [inst(PLAIN.id)] }),
      SIDE({ active: inst(PLAIN.id), bench: p1BenchCards.map((c) => inst(c.id)) })));
  };
  const ky = runSleep([YVEL], 100), kc = runSleep([PLAIN], 100);
  chk('K1 ⭐對手有伊裴爾塔爾 ⇒ 睡著的卡比獸**沒有**回滿血（damage 仍 100）',
    A0(ky)?.damage === 100, String(A0(ky)?.damage));
  chk('K1b 哨兵：好眠真的觸發了（log 有「HP 全部恢復」）', L(ky).includes('HP 全部恢復'), L(ky));
  chk('K2 哨兵／反對照：沒有伊裴爾塔爾時好眠照樣回滿（damage 0）',
    A0(kc)?.damage === 0, String(A0(kc)?.damage));
  chk('K2b 被擋時不標 healedThisTurn', A0(ky)?.healedThisTurn !== true, String(A0(ky)?.healedThisTurn));

  // K3：「靠被禁止的回血逃過 KO」—— 中毒在睡眠區**之前**結算，KO 時 active 已 null，
  //   好眠根本進不來 ⇒ 兩側都必須 KO（實測結論：出口回捲不會讓誰「復活」）。
  const koY = runSleep([YVEL], 155, { secondaryStatus: 'poisoned' });
  const koC = runSleep([PLAIN], 155, { secondaryStatus: 'poisoned' });
  chk('K3 ⭐⭐damage155＋中毒（160HP）⇒ 有／無伊裴爾塔爾**都**被中毒擊倒（沒有靠回血逃過 KO）',
    A0(koY) == null && A0(koC) == null, `${A0(koY)?.damage}/${A0(koC)?.damage}`);
  chk('K3b 哨兵：兩側都真的走了中毒 KO 那條路', L(koY).includes('被中毒傷害擊倒') && L(koC).includes('被中毒傷害擊倒'));

  // K4 ⚠⚠ 已知偏差（列入待站長裁示，不是安慰劑：改了會紅）：
  //   diff 式中央閘只看 prev→next 的淨差 ⇒ 回捲會回到「這個 action 開始時」的 damage，
  //   而不是「恢復發生前」的 damage。同一個 END_TURN 內先中毒 +10 再被擋下好眠：
  //   理論上應停在 110（中毒照算、只是不恢復），實際停在 100（中毒那 10 點被一起回捲掉）。
  //   ⇒ 對被擋方有利 10 點。要修的話得把閘下放到各 heal 站點（違反 Rule 38 的單一中央出口），
  //   因此本版**記錄現況**並等站長裁示。這條釘的是現況數字，任何一端改變都會紅。
  const kp = runSleep([YVEL], 100, { secondaryStatus: 'poisoned' });
  const kpc = runSleep([PLAIN], 100, { secondaryStatus: 'poisoned' });
  chk('K4 ⚠已知偏差（待裁示）：中毒+10 後被擋下的好眠 ⇒ 現況回捲到 100（理論值 110）',
    A0(kp)?.damage === 100, String(A0(kp)?.damage));
  chk('K4b 哨兵：同一盤面沒有伊裴爾塔爾時是 0（中毒 +10 後被好眠清光）',
    A0(kpc)?.damage === 0, String(A0(kpc)?.damage));
}

console.log('\n【M】⭐⭐順序：禁止恢復必須**優先於**【傳說的海溝】恢復量 ×2');
{
  const my = potionOnOwnActive(PLAIN, [YVEL], 60, {}, TRENCH);
  const mc = potionOnOwnActive(PLAIN, [PLAIN], 60, {}, TRENCH);
  chk('M1 海溝在場＋伊裴爾塔爾 ⇒ 完全不回血（60），不是 30、更不是 0',
    A0(my.r2)?.damage === 60, String(A0(my.r2)?.damage));
  chk('M1b 哨兵：同盤面沒有伊裴爾塔爾 ⇒ 海溝把 30 變 60（60 → 0）',
    A0(mc.r2)?.damage === 0, String(A0(mc.r2)?.damage));
  chk('M1c ⭐被擋下時不可以留下海溝的加倍 log（沒有恢復就沒有加倍）',
    !L(my.r2).includes('傳說的海溝：恢復的HP改為 2 倍'), L(my.r2));
  chk('M1d 哨兵：對照組**有**海溝的加倍 log', L(mc.r2).includes('傳說的海溝：恢復的HP改為 2 倍'), L(mc.r2));
}

console.log('\n【N】⭐同一 action 內「戰鬥位換人」的判準＝**next 端**（結算後誰在戰鬥場）');
{
  // 直接對 applyAction 的唯一出口 markHealsByDamageDecrease 下手（與 test-counter-move-not-heal 同一範式）
  const X = inst(PLAIN.id, { damage: 60 }), Y = inst(PLAIN.id), yv = inst(YVEL.id);
  const opp = () => SIDE({ active: inst(PLAIN.id), bench: [yv] });
  // (1) prev 在戰鬥場、next 已回備戰，且 damage 變少 ⇒ next 端是備戰 ⇒ 不擋
  const o1 = markHealsByDamageDecrease(
    mk(SIDE({ active: X, bench: [Y] }), opp()),
    mk(SIDE({ active: Y, bench: [{ ...X, damage: 30 }] }), opp()), pool);
  chk('N1 換到備戰之後才回血 ⇒ 不擋（30）',
    o1.players[0].bench.find((b) => b.iid === X.iid)?.damage === 30,
    String(o1.players[0].bench.find((b) => b.iid === X.iid)?.damage));
  // (2) prev 在備戰、next 已上戰鬥場，且 damage 變少 ⇒ next 端是戰鬥場 ⇒ 擋
  const o2 = markHealsByDamageDecrease(
    mk(SIDE({ active: Y, bench: [X] }), opp()),
    mk(SIDE({ active: { ...X, damage: 30 }, bench: [Y] }), opp()), pool);
  chk('N2 換上戰鬥場之後才回血 ⇒ 擋（回到 60）',
    o2.players[0].active?.damage === 60, String(o2.players[0].active?.damage));
  chk('N2b 被擋時仍然不標 healedThisTurn', o2.players[0].active?.healedThisTurn !== true);
  // (3) 述詞層直驗：同一個 iid，在 active 時回 true、在 bench 時回 false
  const stA = mk(SIDE({ active: X, bench: [Y] }), opp());
  const stB = mk(SIDE({ active: Y, bench: [X] }), opp());
  chk('N3 述詞 isHealBlockedFor：同一隻在戰鬥場 true、在備戰 false',
    isHealBlockedFor(stA, 0, X.iid, pool) === true && isHealBlockedFor(stB, 0, X.iid, pool) === false);
}

console.log('\n【L】中央性（Rule 38：同一個判準只能有一份）');
{
  const walk = (d, out = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p, out); continue; }
      if (/\.(ts|svelte|js)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = walk(join(ROOT, 'src'));
  const rel = (p) => p.slice(join(ROOT, 'src').length + 1).replace(/\\/g, '/');
  const callers = [], literal = [];
  for (const p of files) {
    const s = readFileSync(p, 'utf8');
    const nCall = (s.match(/isHealBlockedFor\s*\(/g) || []).length;
    // 扣掉定義本身（`export function isHealBlockedFor(`）
    const nDef = (s.match(/export function isHealBlockedFor\s*\(/g) || []).length;
    if (nCall - nDef > 0) callers.push(rel(p) + '×' + (nCall - nDef));
    if (s.includes('生命制約')) literal.push(rel(p));
  }
  chk('L1 ⭐⭐`isHealBlockedFor(` 的消費點只有 engine.ts 一處（唯一出口）',
    callers.length === 1 && callers[0].startsWith('lib/game/engine.ts×1'), callers.join(','));
  chk('L2 ⭐「生命制約」字面只出現在 3 個檔（述詞／engine 的 log＋註解／卡檔檔頭註解）',
    literal.length === 3
      && literal.includes('lib/game/effects/cards/v3001_g3_wave3.ts')
      && literal.includes('lib/game/engine.ts')
      && literal.includes('lib/game/effects/cards/m6a_wave7.ts'),
    literal.join(','));
  // L3：述詞本身必須過特性消除閘（靜態＋行為端 F1 雙保險）
  const pred = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8');
  const seg = pred.slice(pred.indexOf('export function hasEffectiveLifeRestraintOnSide'));
  chk('L3 述詞有問 isAbilityHolderEffective（特性消除中央閘）',
    /isAbilityHolderEffective\(state, inst, card, holderIdx, '生命制約', loc, pool\)/.test(seg));
  // L4：閘必須寫在【傳說的海溝】那一行**之前**（順序＝行為端 M1 的靜態對照）
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const iGate = eng.indexOf('if (isHealBlockedFor(next, idx, c.iid, pool))');
  const iTrench = eng.indexOf('const dmgAfter = legendTrench ?');
  chk('L4 ⭐⭐禁止恢復閘在原始碼上排在【傳說的海溝】加倍之前',
    iGate > 0 && iTrench > 0 && iGate < iTrench, `${iGate}/${iTrench}`);
  // L5：全卡庫只有這一張「無法恢復」（有第二張就要先確認能不能共用這支閘）
  const hits = all.filter((c) => /無法恢復|不能恢復/.test(JSON.stringify(c)));
  chk('L5 全卡庫「無法恢復／不能恢復」只有 M6a 19991 一筆',
    hits.length === 1 && String(hits[0].id) === '19991', hits.map((c) => c.id + ':' + c.name).join(','));
  // L6：hasEffectiveLifeRestraintOnSide 真的掃備戰（不是只掃戰鬥場）
  const sOnly = mk(SIDE({ active: inst(PLAIN.id) }), SIDE({ active: inst(PLAIN.id), bench: [inst(YVEL.id)] }));
  chk('L6 hasEffectiveLifeRestraintOnSide：持有者在備戰也算在場上',
    hasEffectiveLifeRestraintOnSide(sOnly, 1, pool) === true
      && hasEffectiveLifeRestraintOnSide(sOnly, 0, pool) === false);
}

console.log(`\n=== v6.354 禁止恢復HP 中央閘（伊裴爾塔爾｜生命制約）：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
