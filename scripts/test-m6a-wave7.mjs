// v6.347 守衛（M6a 批次7｜**特性**）：實裝 11 個特性 + 4 個待站長裁示的卡面逐字錨，
//   一律走**完整 applyAction 行為端**驗證。
//
// ⚠ 特性與招式不同，覆蓋率**不能**用「registry 有沒有這個 key」判斷（被動特性根本沒有 handler）。
//   ⇒ 本檔一律用「真的建盤面 → 跑 USE_ABILITY / ATTACK / END_TURN → 看盤面結果」。
//
// ⭐ 每一條效果斷言都配哨兵：
//     ・主動特性：`abilityUsedThisTurn` 真的被標記（特性沒跑 ⇒ 效果斷言會是空真）；
//     ・被動特性：同一盤面的「對照組」數字必須是未套用時的值（證明差異來自這個特性）。
// ⭐ 正反對照：擲幣正／反、前提成立／不成立、持有者在戰鬥場／備戰、特性被消除／未被消除。
// ⚠ 靶一律挑「對出招者屬性中立」的（弱點×2／抵抗-20 會把數字打歪）。
// ⚠ 基本能量 id 依名稱查（硬編會付不出費用 → ATTACK 靜默 return → 假綠）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.m6aw7-s.js'), E = join(ROOT, '.m6aw7-e.ts'), O = join(ROOT, '.m6aw7-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, createGame, getUsableAbilities, getEffectiveHP, getEffectiveAttacks } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, createGame, getUsableAbilities, getEffectiveHP, getEffectiveAttacks } = M;

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
/** 依「卡名＋特性名」抓印刷（優先 M6a —— 本批要驗的就是 M6a 那一張）。 */
const findAb = (n, ab) => {
  const hits = all.filter((c) => c.name === n && (c.abilities || []).some((a) => a.name === ab));
  if (!hits.length) throw new Error(`fixture 找不到 ${n}｜${ab}`);
  return hits.find((c) => String(c.setCode) === 'M6a') ?? hits[0];
};
const findAtk = (n, a) => {
  const hits = all.filter((c) => c.name === n && (c.attacks || []).some((x) => x.name === a));
  if (!hits.length) throw new Error(`fixture 找不到 ${n}｜${a}`);
  return hits.find((c) => String(c.setCode) === 'M6a') ?? hits[0];
};
const byName = (n) => { const c = all.find((x) => x.name === n); if (!c) throw new Error('fixture 找不到 ' + n); return c; };

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

const withCoin = (heads, fn) => {
  const orig = Math.random;
  Math.random = () => (heads ? 0.1 : 0.9);
  try { return fn(); } finally { Math.random = orig; }
};
const act = (st, a, heads) => withCoin(heads !== false, () => {
  try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [] }; }
});
const useAb = (st, iid, abIdx = 0, heads) => act(st, { type: 'USE_ABILITY', iid, abilityIndex: abIdx }, heads);
const resolve = (st, iids, actorIdx = 0, heads) =>
  act(st, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx }, heads);
const listed = (st, ab) => getUsableAbilities(st, pool).some((u) => u.abilityName === ab);
const logHas = (r, s) => (r?.log ?? []).some((l) => String(l?.message ?? l?.text ?? l).includes(s));
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const findInst = (p, iid) => (p.active?.iid === iid ? p.active : p.bench.find((b) => b.iid === iid));

// ── fixtures ────────────────────────────────────────────────────────────────
const EXEGG = findAb('阿羅拉 椰蛋樹', '一長再長');          // 002/103
const VIVI  = findAb('彩粉蝶', '指引之舞');                  // 005/103
const MOLT  = findAb('火焰鳥', '燃燒羽擊');                  // 006/103
const ARTI  = findAb('急凍鳥', '嚴寒羽擊');                  // 012/103（同卡有招式「冰雹」）
const ZAPD  = findAb('閃電鳥', '濺射羽擊');                  // 049/103（同卡有招式「雷轟」）
const PIKA_LONELY = findAb('皮卡丘', '寂寞眼神');            // 022/103
const PIKA_HIDE   = findAb('皮卡丘', '躲起來');              // 027/103
const NIDO  = findAb('尼多娜', '分享歡樂');                  // 074/103
const GENG  = findAb('耿鬼ex', '死亡宣告');                  // 076/103
const SOLG  = findAb('索爾迦雷歐', '日出');                  // 084/103
const SNOR  = findAb('卡比獸', '好眠');                      // 095/103
const MEW   = findAb('夢幻ex', '記憶螺旋');                  // 057/103
const PYRO  = findAb('火炎獅', '威嚇之牙');                  // 正對照：active-only -30
const SINIS = findAb('斯魔茶', '藏隱');                      // 正對照：備戰完全免疫
const LAVA  = byName('傳說的熔岩洞');                        // 場地：雙方場上進化寶可夢特性全消除
const DISC  = byName('核心記憶碟');                          // 有 attacks 的寶可夢道具（L2059 反對照）
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');

const atkIndexOf = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const energyForCost = (card, atkName) =>
  ((card.attacks || []).find((a) => a.name === atkName)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

console.log('\n【0】harness 自驗');
{
  chk('0a 抓得到 M6a 的 12 張目標卡',
    [EXEGG, VIVI, MOLT, ARTI, ZAPD, PIKA_LONELY, PIKA_HIDE, NIDO, GENG, SOLG, SNOR, MEW]
      .every((c) => String(c.setCode) === 'M6a'),
    [EXEGG, VIVI, MOLT, ARTI, ZAPD, PIKA_LONELY, PIKA_HIDE, NIDO, GENG, SOLG, SNOR, MEW].map((c) => c.setCode).join(','));
  chk('0b 兩張同名皮卡丘是不同印刷（寂寞眼神 / 躲起來）',
    String(PIKA_LONELY.id) !== String(PIKA_HIDE.id));
  chk('0c 基本能量 id 都查到', ['Grass', 'Fire', 'Water', 'Lightning', 'Metal'].every((k) => EID[k]));
  chk('0d 有乾淨的【無】屬性對照靶', !!PLAIN, String(PLAIN?.name));
  // ⭐反安慰劑：純被動特性（伊裴爾塔爾｜生命制約，⭐v6.354 已實裝）不該出現在可用清單
  //   —— 被動特性沒有 handler，混進去就會變成「按鈕亮著卻按不下去」。
  const yv = findAb('伊裴爾塔爾', '生命制約');
  const stv = mk({ active: inst(yv.id) }, { active: inst(PLAIN.id) });
  chk('0e ⭐反安慰劑：純被動特性不會混進 getUsableAbilities', !listed(stv, '生命制約'));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【1】002 阿羅拉 椰蛋樹｜一長再長 — 6 個以上【草】能量 ⇒ 最大 HP +250');
{
  const base = Number(EXEGG.hp);
  const mkEgg = (n) => inst(EXEGG.id, { energyAttached: Array.from({ length: n }, () => inst(EID.Grass)) });
  const e6 = mkEgg(6), e5 = mkEgg(5);
  const st6 = mk({ active: inst(PLAIN.id) }, { active: e6 });
  const st5 = mk({ active: inst(PLAIN.id) }, { active: e5 });
  chk(`1a 附 6 個【草】⇒ 有效 HP = ${base}+250`, getEffectiveHP(e6, pool, st6) === base + 250,
    String(getEffectiveHP(e6, pool, st6)));
  chk(`1b ⭐反對照：附 5 個【草】⇒ 有效 HP 仍是 ${base}`, getEffectiveHP(e5, pool, st5) === base,
    String(getEffectiveHP(e5, pool, st5)));
  const e6f = inst(EXEGG.id, { energyAttached: Array.from({ length: 6 }, () => inst(EID.Fire)) });
  const stf = mk({ active: inst(PLAIN.id) }, { active: e6f });
  chk('1c ⭐反對照：附 6 個【火】（不是【草】）⇒ 不加成', getEffectiveHP(e6f, pool, stf) === base,
    String(getEffectiveHP(e6f, pool, stf)));
  // ⭐特性消除：傳說的熔岩洞（雙方場上所有進化寶可夢的特性全部消除）；椰蛋樹是 Stage1
  const stL = mk({ active: inst(PLAIN.id) }, { active: e6 },
    { activeStadium: inst(LAVA.id), activeStadiumOwnerIdx: 0 });
  chk('1d ⭐特性被消除（傳說的熔岩洞）⇒ +250 不生效', getEffectiveHP(e6, pool, stL) === base,
    String(getEffectiveHP(e6, pool, stL)));
  // ⭐行為端：KO 判定真的用有效 HP —— 閃電鳥｜雷轟 210 點（椰蛋樹弱點是【火】，對【雷】中立）
  const run = (n) => {
    const z = inst(ZAPD.id, { energyAttached: energyForCost(ZAPD, '雷轟') });
    const egg = mkEgg(n);
    const st = mk({ active: z, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: egg, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ZAPD, '雷轟') });
  };
  const r6 = run(6), r5 = run(5);
  chk('1e ⭐行為端：附 6 個【草】時受 210 點仍存活（400HP）',
    !!D0(r6) && D0(r6).damage === 210, JSON.stringify([!!D0(r6), D0(r6)?.damage]));
  chk('1f ⭐行為端反對照：附 5 個【草】時受 210 點被擊倒（150HP）',
    D0(r5) === null || D0(r5) === undefined, JSON.stringify(D0(r5)?.damage));
  chk('1g 哨兵：雷轟真的結算了（攻擊方自傷 60）',
    A0(r6)?.damage === 60 && A0(r6)?.attackUsedThisTurn === '雷轟',
    JSON.stringify([A0(r6)?.damage, A0(r6)?.attackUsedThisTurn]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【2】022 皮卡丘｜寂寞眼神 — 只要在**戰鬥場**，對手戰鬥寶可夢的招式傷害 -20');
{
  // 急凍鳥｜冰雹：「對手的所有寶可夢各受到30點傷害。」⇒ 一次同時驗戰鬥場與備戰
  const runHail = (defActive, defBench) => {
    const a = inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') });
    const st = mk({ active: a, deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(defActive.id), bench: [inst(defBench.id)], deck: [inst(PLAIN.id)],
        prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') });
  };
  const ctrl = runHail(PLAIN, PLAIN);
  chk('2a ⭐對照組：無特性的靶，戰鬥場與備戰各受 30', D0(ctrl)?.damage === 30 && ctrl.players[1].bench[0].damage === 30,
    JSON.stringify([D0(ctrl)?.damage, ctrl.players[1].bench[0]?.damage]));
  const r = runHail(PIKA_LONELY, PIKA_LONELY);
  chk('2b 皮卡丘（寂寞眼神）在**戰鬥場** ⇒ 30-20 = 10', D0(r)?.damage === 10, String(D0(r)?.damage));
  chk('2c ⭐位置對照：同一張卡在**備戰** ⇒ 仍是 30（不得 -20）',
    r.players[1].bench[0].damage === 30, String(r.players[1].bench[0]?.damage));
  chk('2d 哨兵：冰雹真的跑過', A0(r)?.attackUsedThisTurn === '冰雹', String(A0(r)?.attackUsedThisTurn));
  // ⭐正對照：既有同措辭卡 火炎獅｜威嚇之牙 -30（Fire 對 Water 是弱點 ⇒ 30×2=60，再 -30 = 30）
  const rp = runHail(PYRO, PYRO);
  chk('2e ⭐正對照：火炎獅｜威嚇之牙 戰鬥場 60-30 = 30（同一支表、不同數字）',
    D0(rp)?.damage === 30, String(D0(rp)?.damage));
  chk('2f ⭐正對照位置：火炎獅在備戰 ⇒ 30（備戰不計弱抗、也不吃 -30）',
    rp.players[1].bench[0].damage === 30, String(rp.players[1].bench[0]?.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【3】027 皮卡丘｜躲起來 — 只要在備戰區，不受對手招式的傷害與效果');
{
  const runHail = (benchCard, activeCard) => {
    const a = inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') });
    const st = mk({ active: a, deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(activeCard.id), bench: [inst(benchCard.id)], deck: [inst(PLAIN.id)],
        prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') });
  };
  const r = runHail(PIKA_HIDE, PLAIN);
  chk('3a 皮卡丘（躲起來）在備戰 ⇒ 冰雹打不到（0）', r.players[1].bench[0].damage === 0,
    String(r.players[1].bench[0]?.damage));
  chk('3b 哨兵：同一次冰雹，戰鬥場的靶確實吃了 30', D0(r)?.damage === 30, String(D0(r)?.damage));
  const rs = runHail(SINIS, PLAIN);
  chk('3c ⭐正對照：既有「斯魔茶｜藏隱」同樣是 0（同一支述詞）',
    rs.players[1].bench[0].damage === 0, String(rs.players[1].bench[0]?.damage));
  const rc = runHail(PLAIN, PLAIN);
  chk('3d ⭐反對照：無特性的備戰靶會吃 30', rc.players[1].bench[0].damage === 30,
    String(rc.players[1].bench[0]?.damage));
  const ra = runHail(PLAIN, PIKA_HIDE);
  chk('3e ⭐位置對照：躲起來在**戰鬥場**時不免疫（吃 30）', D0(ra)?.damage === 30, String(D0(ra)?.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【4】⚠ 本批**未實裝**的 1 個特性 —— 卡面逐字錨（待站長裁示；卡面若改版這裡會紅）');
{
  // ⚠ 這一段**不是**「宣告永遠不做」。它只做兩件事：
  //   ① 把待裁示卡的 abilities[].effect 逐字釘住（卡面改版／抓錯卡時會紅）；
  //   ② 讓交接的人一眼看到「哪一個沒做、為什麼」。實作了之後把該條移到自己的章節即可。
  // ⭐ v6.352：原本的第 4 張「弱丁魚｜群聚反擊」已實裝（field-wide 受傷反擊收斂成中央
  //   FIELD_WIDE_RETALIATION + fireFieldWideRetaliation 之後就做得到了），卡面逐字錨
  //   已移交 scripts/test-v6352-field-wide-retaliation.mjs 的 C2 段。
  // ⭐ v6.353：原本的第 1 張「甜甜螢｜絕佳費洛蒙」已實裝（弱點**倍率**參數化成中央述詞
  //   WEAKNESS_MULTIPLIER_ABILITIES + weaknessMultiplier 之後就做得到了），卡面逐字錨
  //   已移交 scripts/test-v6353-weakness-multiplier.mjs 的 C1 段。
  // ⭐ v6.354：原本的「伊裴爾塔爾｜生命制約」已實裝（「禁止恢復HP」收斂成中央閘
  //   v3001_g3_wave3.isHealBlockedFor，唯一消費點 engine.markHealsByDamageDecrease 之後就做得到了），
  //   卡面逐字錨已移交 scripts/test-v6354-heal-block.mjs 的【0】段。
  const FACE = [
    ['耿鬼ex', '死亡宣告',
      '這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，自己擲1次硬幣。若為正面，則將使用招式的寶可夢【昏厥】。',
      'PASSIVE_ON_KO 在兩條 KO 管線中相對 addPendingPrize 的順序相反（v6.259 已記載）；'
      + '而本特性的效果會發獎賞＋清掉攻擊方 active ⇒ 實測兩條管線不等價'
      + '（test-v6259 的 C4：主管線攻擊方取 2 張獎賞、中央 helper 取 0 張）'],
  ];
  for (const [cn, an, eff] of FACE) {
    const c = findAb(cn, an);
    const got = (c.abilities || []).find((a) => a.name === an)?.effect;
    chk(`4 待裁示｜${cn}｜${an} 卡面逐字錨`, got === eff, String(got));
  }
  // ⭐ 反安慰劑：若有人把被動特性偷偷掛上 regA（主動特性），這裡會抓到。
  //   ⭐v6.354 生命制約已實裝，但它是**純被動**（沒有 handler）⇒ 這條的守備價值反而更高。
  const y = findAb('伊裴爾塔爾', '生命制約');
  const sty = mk({ active: inst(y.id), deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
  chk('4z ⭐反安慰劑：生命制約沒有被誤登記成主動特性', !listed(sty, '生命制約'));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【4B】⚠⚠ 待裁示特性「目前確實沒有作用」＋ 已實裝特性「卡面要求真的做到了」—— 一律用**行為端數字**釘住');
{
  // ⚠ 這一段取代原本的 `chk(..., true)` ＝ 恆真安慰劑（把整個實作拆掉也不會紅）。
  //   Rule 33：斷言必須落到行為層。以下每條都配哨兵（證明「該發生的事真的發生了」），
  //   並且會在該特性**被實作的那一天主動變紅**，逼實作者把它搬到自己的章節。
  //   ⇒ 「待裁示」不再是靠註解宣告，而是靠可量測的數字。
  const runHail = (p1Active, p1Bench, actExtra = {}) => {
    const a = inst(ARTI.id, { energyAttached: energyForCost(ARTI, '冰雹') });
    const st = mk(
      { active: a, deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(p1Active.id, actExtra), bench: p1Bench.map((c) => inst(c.id)),
        deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    return act(st, { type: 'ATTACK', attackIndex: atkIndexOf(ARTI, '冰雹') });
  };

  // ── (a) 甜甜螢｜絕佳費洛蒙：⭐v6.353 **已實裝**（弱點倍率參數化成中央述詞之後）────
  //    這一條原本釘的是「弱點仍以 ×2 結算（60）⇒ 絕佳費洛蒙目前確實無作用」的 HEAD-FAIL 錨，
  //    v6.353 實作後主動翻紅 —— 依 Rule 40 把判準**上移到意圖層**：現在釘「卡面要求的
  //    ×3 真的算出來了（30×3 = 90）」＋反對照（前提不成立時回到 ×2）。倍率改成 2 或 4 照樣紅，
  //    前提被拿掉也照樣紅 ⇒ 這是收緊，不是放寬。完整守備（雙方／戰鬥場／備戰／特性消除／
  //    不誤套備戰／預估一致／中央性）由 scripts/test-v6353-weakness-multiplier.mjs 接管。
  //    靶用程式挑：Basic／無特性／弱點是【水】且倍率是「×2」／HP≥120（吃 90 不會昏厥）。
  const WEAK_W = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
    && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
    && c.weakness?.type === 'Water' && c.weakness?.value === '×2' && Number(c.hp) >= 120);
  const ILLUM = findAb('甜甜螢', '絕佳費洛蒙');   // M6a（唯一有特性的印刷）
  const VOLBE = byName('電螢蟲');                 // 卡面前提：自己場上要有「電螢蟲」
  const ctlW = runHail(WEAK_W, [PLAIN]);
  const pheW = runHail(WEAK_W, [ILLUM, VOLBE]);
  const noVo = runHail(WEAK_W, [ILLUM, PLAIN]);   // 有甜甜螢、沒有電螢蟲
  chk(`4B-a 哨兵：靶（${WEAK_W?.name}）對【水】是弱點 ⇒ 沒有甜甜螢時 冰雹 30 ×2 = 60`,
    D0(ctlW)?.damage === 60, String(D0(ctlW)?.damage));
  chk('4B-a 哨兵：甜甜螢與電螢蟲真的都在對手場上（各吃了備戰的 30）',
    pheW.players[1].bench.length === 2 && pheW.players[1].bench.every((b) => b.damage === 30),
    JSON.stringify(pheW.players[1].bench.map((b) => b.damage)));
  chk('4B-a ⭐行為端（v6.353 已實裝）：同場有甜甜螢＋電螢蟲 ⇒ 弱點以 ×3 結算（30×3 = 90）',
    D0(pheW)?.damage === 90, String(D0(pheW)?.damage));
  chk('4B-a ⭐反對照：只有甜甜螢、場上沒有「電螢蟲」⇒ 前提不成立，回到 ×2（60）',
    D0(noVo)?.damage === 60, String(D0(noVo)?.damage));

  // ── (b) 弱丁魚｜群聚反擊：⭐v6.352 **已實裝**（field-wide 受傷反擊收斂成中央管線之後）──
  //    這一條原本釘的是「目前確實無作用（0 點）」的 HEAD-FAIL 錨，v6.352 實作後主動翻紅 ——
  //    依 Rule 40 把判準**上移到意圖層**：現在釘「卡面要求的 3 個傷害指示物真的放上去了」，
  //    數字改錯照樣紅。完整守備（戰鬥場／備戰／弱丁魚ex／雙持有者／KO 分支／特性消除／
  //    光之翼／中央性）由 scripts/test-v6352-field-wide-retaliation.mjs 接管。
  const FEEBAS = findAb('弱丁魚', '群聚反擊');   // M6a 唯一印刷，HP30
  const rFe = runHail(FEEBAS, []);
  chk('4B-b 哨兵：弱丁魚（HP30）確實被冰雹的 30 點打到昏厥', D0(rFe) == null, JSON.stringify(D0(rFe)));
  chk('4B-b ⭐行為端（v6.352 已實裝）：攻擊方（急凍鳥）身上 3 個傷害指示物 ＝ 30 點',
    A0(rFe)?.damage === 30, String(A0(rFe)?.damage));
  chk('4B-b ⭐反對照：換成沒有「群聚反擊」的寶可夢 ⇒ 攻擊方 0 點',
    (A0(runHail(PLAIN, []))?.damage ?? -1) === 0, String(A0(runHail(PLAIN, []))?.damage));
  // ⭐正對照：站上唯一同型「花岩怪｜怨恨旋渦」在**同一支管線**上真的會反擊。
  //   兩個分支都測，證明這支 harness 偵測得到 KO／非 KO 兩條 KO 管線的反擊。
  const GEODE = findAb('花岩怪', '怨恨旋渦');
  const rGeoAlive = runHail(GEODE, []);
  const rGeoKO = runHail(GEODE, [], { damage: Number(GEODE.hp) - 30 });
  chk('4B-b ⭐正對照（非 KO 分支）：花岩怪存活時攻擊方確實吃到反擊',
    !!D0(rGeoAlive) && (A0(rGeoAlive)?.damage ?? 0) > 0,
    JSON.stringify([D0(rGeoAlive)?.damage, A0(rGeoAlive)?.damage]));
  chk('4B-b ⭐正對照（KO 分支）：花岩怪昏厥時攻擊方一樣吃到反擊',
    D0(rGeoKO) == null && (A0(rGeoKO)?.damage ?? 0) > 0, String(A0(rGeoKO)?.damage));

  // ── (c) 耿鬼ex｜死亡宣告：卡面要「擲幣正面則讓攻擊方昏厥」；現況攻擊方毫髮無傷 ──
  //    act() 預設把 Math.random 釘在正面 ⇒ 若哪天實作了，這條一定會紅。
  const rGen = runHail(GENG, [], { damage: Number(GENG.hp) - 30 });
  chk('4B-c 哨兵：耿鬼ex 確實因招式傷害昏厥', D0(rGen) == null, JSON.stringify(D0(rGen)));
  chk('4B-c ⭐行為端：擲幣固定正面下，攻擊方（急凍鳥）仍在場且 0 點'
    + ' ⇒ 死亡宣告目前確實無作用', !!A0(rGen) && A0(rGen).damage === 0,
    JSON.stringify([!!A0(rGen), A0(rGen)?.damage]));

  // ── (d) 伊裴爾塔爾｜生命制約：⭐v6.354 **已實裝**（「禁止恢復HP」收斂成中央閘之後）────
  //    這一條原本釘的是「**仍然**回到 30 ⇒ 生命制約目前確實無作用」的 HEAD-FAIL 錨，
  //    v6.354 實作後主動翻紅 —— 依 Rule 40 把判準**上移到意圖層**：現在釘「卡面要求的
  //    『無法恢復』真的發生了（damage 一點都沒少，仍是 60）」＋反對照（沒有伊裴爾塔爾時
  //    照樣回到 30）。回捲寫成 0 照樣紅、閘整個拿掉照樣紅、連備戰一起擋照樣紅
  //    ⇒ 這是收緊，不是放寬。完整守備（三種回血管線／只擋戰鬥位／只擋對手／特性消除／
  //    移動指示物不算恢復／卡照樣能打出／healedThisTurn 不誤標／海溝順序／中央性）
  //    由 scripts/test-v6354-heal-block.mjs 接管（60 條行為端斷言）。
  //    用同批次的「尼多娜｜分享歡樂」（自己的 1 隻恢復 30）當回血來源，
  //    伊裴爾塔爾放在**對手**（p1）的戰鬥場 ⇒ 受制的正是 p0 的戰鬥寶可夢。
  const YVEL = findAb('伊裴爾塔爾', '生命制約');
  const runHeal = (p1ActiveCard) => {
    const nido = inst(NIDO.id);
    const hurt = inst(PLAIN.id, { damage: 60 });
    const st = mk({ active: hurt, bench: [nido], deck: [inst(PLAIN.id)] },
      { active: inst(p1ActiveCard.id), deck: [inst(PLAIN.id)] });
    const r1 = useAb(st, nido.iid);
    return { r2: resolve(r1, [hurt.iid]), nidoIid: nido.iid };
  };
  const hCtl = runHeal(PLAIN), hYve = runHeal(YVEL);
  chk('4B-d 哨兵：分享歡樂真的跑完了（特性權被標記）',
    findInst(hYve.r2.players[0], hYve.nidoIid)?.abilityUsedThisTurn === true,
    JSON.stringify(findInst(hYve.r2.players[0], hYve.nidoIid)?.abilityUsedThisTurn));
  chk('4B-d 哨兵：對照組（對手戰鬥場無特性）自己的戰鬥寶可夢 60 → 30',
    A0(hCtl.r2)?.damage === 30, String(A0(hCtl.r2)?.damage));
  chk('4B-d ⭐行為端（v6.354 已實裝）：對手場上有伊裴爾塔爾 ⇒ 自己的戰鬥寶可夢**完全不回血**（仍是 60）',
    A0(hYve.r2)?.damage === 60, String(A0(hYve.r2)?.damage));
  chk('4B-d ⭐反對照：同一盤面沒有伊裴爾塔爾 ⇒ 照樣回到 30（差異真的來自這個特性）',
    A0(hCtl.r2)?.damage === 30, String(A0(hCtl.r2)?.damage));
  chk('4B-d ⭐被擋下時不可以標 healedThisTurn（活潑刀家族的「本回合恢復過HP」條件）',
    A0(hYve.r2)?.healedThisTurn !== true, String(A0(hYve.r2)?.healedThisTurn));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【5】057 夢幻ex｜記憶螺旋 — 可使用自己備戰寶可夢**持有**的所有招式');
{
  const mew = inst(MEW.id, { energyAttached: [inst(EID.Lightning), inst(EID.Lightning)] });
  const benchPika = inst(PIKA_LONELY.id);
  const st = mk({ active: mew, bench: [benchPika], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
    { active: inst(PLAIN.id), bench: [], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
  const eff = getEffectiveAttacks(st, mew, pool);
  const names = eff.map((e) => e.atk.name);
  chk('5a 夢幻ex 的可用招式包含自己的「瞬間移動突擊」', names.includes('瞬間移動突擊'), names.join(','));
  chk('5b 夢幻ex 的可用招式包含備戰皮卡丘的「皮卡球」', names.includes('皮卡球'), names.join(','));
  chk('5c sourceCardName 是招式原持有者的卡名（effectKey 才不會串味）',
    eff.find((e) => e.atk.name === '皮卡球')?.sourceCardName === '皮卡丘');
  // ⭐反對照：沒有備戰寶可夢時只剩自己的招式
  const stNone = mk({ active: mew, bench: [], deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
  chk('5d ⭐反對照：備戰空 ⇒ 只有自己的招式',
    getEffectiveAttacks(stNone, mew, pool).length === (MEW.attacks || []).length,
    String(getEffectiveAttacks(stNone, mew, pool).length));
  // ⭐反對照：對手的備戰不算
  const stOpp = mk({ active: mew, bench: [], deck: [inst(PLAIN.id)] },
    { active: inst(PLAIN.id), bench: [inst(PIKA_LONELY.id)] });
  chk('5e ⭐反對照：**對手**的備戰寶可夢招式不算',
    !getEffectiveAttacks(stOpp, mew, pool).map((e) => e.atk.name).includes('皮卡球'));
  // ⭐⭐ 官方 L2059~2060：道具賦予的招式不屬於「持有的招式」
  const benchWithTool = inst(PIKA_LONELY.id, { toolAttached: inst(DISC.id) });
  const stTool = mk({ active: mew, bench: [benchWithTool], deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
  const toolAtkName = (DISC.attacks || [])[0]?.name;
  chk('5f ⭐⭐L2059：備戰寶可夢**道具上**的招式不可借（' + toolAtkName + ' 不得出現）',
    !getEffectiveAttacks(stTool, mew, pool).map((e) => e.atk.name).includes(toolAtkName),
    getEffectiveAttacks(stTool, mew, pool).map((e) => e.atk.name).join(','));
  chk('5g ⭐哨兵：同一盤面，**那隻備戰皮卡丘自己**的可用招式確實含道具招式（證明 5f 不是空真）',
    getEffectiveAttacks(stTool, benchWithTool, pool).map((e) => e.atk.name).includes(toolAtkName));
  // ⭐⭐特性被消除：鐵荊棘ex｜初始化「只要這隻寶可夢在戰鬥場上，雙方場上『擁有規則的寶可夢』
  //   （『未來』寶可夢除外）的特性全部消除。」—— 夢幻ex 是 ex（規則寶可夢）且沒有「未來」tag ⇒ 打得到。
  {
    const iron = all.find((c) => (c.abilities || []).some((a) => a.name === '初始化'));
    chk('5k0 fixture：抓得到「鐵荊棘ex｜初始化」', !!iron, String(iron?.name));
    const mew2 = inst(MEW.id, { energyAttached: [inst(EID.Lightning), inst(EID.Lightning)] });
    const stIron = mk({ active: mew2, bench: [inst(PIKA_LONELY.id)], deck: [inst(PLAIN.id)] },
      { active: inst(iron.id), bench: [] });
    chk('5k ⭐⭐特性被消除（對手戰鬥場 鐵荊棘ex｜初始化）⇒ 借不到備戰的招式',
      !getEffectiveAttacks(stIron, mew2, pool).map((e) => e.atk.name).includes('皮卡球'),
      getEffectiveAttacks(stIron, mew2, pool).map((e) => e.atk.name).join(','));
    chk('5k2 ⭐哨兵：同一盤面，夢幻ex 自己的招式仍在（不是整個清單爆掉）',
      getEffectiveAttacks(stIron, mew2, pool).map((e) => e.atk.name).includes('瞬間移動突擊'));
  }
  const bi = getEffectiveAttacks(st, mew, pool).findIndex((e) => e.atk.name === '皮卡球');
  const r = act(st, { type: 'ATTACK', attackIndex: bi });
  const pikaDmg = Number((PIKA_LONELY.attacks || []).find((a) => a.name === '皮卡球')?.damage ?? 0);
  chk('5h ⭐行為端：夢幻ex 真的打得出借來的「皮卡球」並造成卡面傷害 ' + pikaDmg,
    D0(r)?.damage === pikaDmg, String(D0(r)?.damage));
  chk('5i 哨兵：attackUsedThisTurn 記到借來的招式名', A0(r)?.attackUsedThisTurn === '皮卡球',
    String(A0(r)?.attackUsedThisTurn));
  // ⭐反對照：沒有記憶螺旋的寶可夢（用同一盤面換成一般寶可夢）借不到
  const plainActive = inst(PLAIN.id, { energyAttached: [inst(EID.Lightning), inst(EID.Lightning)] });
  const stPlain = mk({ active: plainActive, bench: [inst(PIKA_LONELY.id)], deck: [inst(PLAIN.id)] },
    { active: inst(PLAIN.id) });
  chk('5j ⭐反對照：沒有「記憶螺旋」的寶可夢借不到備戰的招式',
    !getEffectiveAttacks(stPlain, plainActive, pool).map((e) => e.atk.name).includes('皮卡球'));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【6】005 彩粉蝶｜指引之舞 — 擲幣正面則從牌庫選 1 張寶可夢卡（公開）加手牌 + 重洗');
{
  const mkSt = (deckCards) => {
    const v = inst(VIVI.id);
    return { v, st: mk({ active: v, bench: [], hand: [], deck: deckCards, prizes: [] },
      { active: inst(PLAIN.id) }) };
  };
  const deck = [inst(PLAIN.id), inst(EID.Grass), inst(PLAIN.id)];
  const { v, st } = mkSt(deck);
  chk('6a 牌庫非空 ⇒ 列入可用特性清單', listed(st, '指引之舞'));
  const rH = useAb(st, v.iid, 0, true);
  chk('6b 正面 ⇒ 開 deck-search picker（filter=Pokemon, 最多 1 張）',
    rH.pendingSelection?.type === 'deck-search' && rH.pendingSelection?.filter === 'Pokemon'
      && rH.pendingSelection?.maxCount === 1,
    JSON.stringify(rH.pendingSelection && { t: rH.pendingSelection.type, f: rH.pendingSelection.filter, m: rH.pendingSelection.maxCount }));
  chk('6c 哨兵：特性權真的被消耗（abilityUsedThisTurn）', A0(rH)?.abilityUsedThisTurn === true);
  const picked = deck[0].iid;
  const rR = resolve(rH, [picked]);
  chk('6d ⭐真的解掉 picker：選到的寶可夢卡進手牌、牌庫少 1 張',
    rR.players[0].hand.length === 1 && rR.players[0].hand[0].iid === picked
      && rR.players[0].deck.length === 2,
    JSON.stringify([rR.players[0].hand.length, rR.players[0].deck.length]));
  chk('6e ⭐公開揭示（卡面「在給對手看過後」）⇒ log 出現卡名',
    logHas(rR, pool.get(String(PLAIN.id)).name), (rR.log || []).slice(-3).map((l) => l.message).join(' | '));
  const rT = useAb(st, v.iid, 0, false);
  chk('6f ⭐擲幣反對照：反面 ⇒ 不開 picker、手牌不變',
    !rT.pendingSelection && rT.players[0].hand.length === 0, JSON.stringify(!!rT.pendingSelection));
  chk('6g ⭐反面仍消耗特性權（卡面沒有補償）', A0(rT)?.abilityUsedThisTurn === true);
  const { v: v2, st: st2 } = mkSt([]);
  chk('6h ⭐gate：牌庫為空 ⇒ 不列入清單', !listed(st2, '指引之舞'));
  const r2 = useAb(st2, v2.iid, 0, true);
  chk('6i ⭐gate：牌庫為空按下去 = 完全 no-op（特性權不被吃掉）',
    r2.players[0].active.abilityUsedThisTurn === false && r2.log.length === st2.log.length,
    JSON.stringify([r2.players[0].active.abilityUsedThisTurn, r2.log.length]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【7】006/012/049 三神鳥｜燃燒／嚴寒／濺射羽擊 — 前提兩隻 + 從手牌附 1 張指定屬性基本能量');
{
  const SPECS = [
    { card: MOLT, ab: '燃燒羽擊', partners: [ARTI, ZAPD], type: 'Fire', zh: '火' },
    { card: ARTI, ab: '嚴寒羽擊', partners: [MOLT, ZAPD], type: 'Water', zh: '水' },
    { card: ZAPD, ab: '濺射羽擊', partners: [MOLT, ARTI], type: 'Lightning', zh: '雷' },
  ];
  for (const s of SPECS) {
    const holder = inst(s.card.id);
    const hand = [inst(EID[s.type]), inst(EID.Grass)];   // 1 張對的 + 1 張錯的
    const st = mk({ active: holder, bench: s.partners.map((c) => inst(c.id)), hand,
      deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
    chk(`7 ${s.card.name}｜${s.ab}：兩隻夥伴都在場 + 手牌有基本【${s.zh}】能量 ⇒ 列入清單`,
      listed(st, s.ab));
    const r = useAb(st, holder.iid, 0);
    chk(`7 ${s.ab}：開 hand-discard picker（filter=BasicEnergy:${s.type}）`,
      r.pendingSelection?.type === 'hand-discard' && r.pendingSelection?.filter === `BasicEnergy:${s.type}`,
      JSON.stringify(r.pendingSelection && { t: r.pendingSelection.type, f: r.pendingSelection.filter }));
    chk(`7 ${s.ab}：⭐picker 候選只含對的屬性（validIids 長度 1）`,
      (r.pendingSelection?.params?.validIids ?? []).length === 1
      && r.pendingSelection.params.validIids[0] === hand[0].iid,
      JSON.stringify(r.pendingSelection?.params?.validIids));
    const rr = resolve(r, [hand[0].iid]);
    const h2 = A0(rr);
    chk(`7 ${s.ab}：⭐解掉 picker 後，能量真的附到持有者身上（且是【${s.zh}】）`,
      h2?.energyAttached?.length === 1
      && pool.get(h2.energyAttached[0].cardId)?.name === `基本【${s.zh}】能量`,
      JSON.stringify(h2?.energyAttached?.map((e) => pool.get(e.cardId)?.name)));
    chk(`7 ${s.ab}：手牌少 1 張（能量離開手牌）`, rr.players[0].hand.length === 1);
    chk(`7 ${s.ab}：哨兵 abilityUsedThisTurn`, h2?.abilityUsedThisTurn === true);
    // ⭐前提反對照：少一隻夥伴
    const holder2 = inst(s.card.id);
    const stMiss = mk({ active: holder2, bench: [inst(s.partners[0].id)], hand: [inst(EID[s.type])],
      deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
    chk(`7 ${s.ab}：⭐前提反對照 — 只有 1 隻夥伴 ⇒ 不列入清單`, !listed(stMiss, s.ab));
    const rm = useAb(stMiss, holder2.iid, 0);
    chk(`7 ${s.ab}：⭐前提不成立時按下去 = 完全 no-op（特性權不被吃掉）`,
      rm.players[0].active.abilityUsedThisTurn === false && rm.log.length === stMiss.log.length);
    // ⭐屬性反對照：手牌只有別的屬性
    const holder3 = inst(s.card.id);
    const wrong = s.type === 'Grass' ? 'Fire' : 'Grass';
    const stWrong = mk({ active: holder3, bench: s.partners.map((c) => inst(c.id)),
      hand: [inst(EID[wrong])], deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
    chk(`7 ${s.ab}：⭐屬性反對照 — 手牌沒有基本【${s.zh}】能量 ⇒ 不列入清單`, !listed(stWrong, s.ab));
  }
  // ⭐交叉反對照：三隻同時在場時，每一支特性各自只吃自己那個屬性（證明屬性沒被寫死成同一個）
  {
    const molt = inst(MOLT.id);
    const st = mk({ active: molt, bench: [inst(ARTI.id), inst(ZAPD.id)],
      hand: [inst(EID.Water)], deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
    chk('7x ⭐交叉反對照：手牌只有基本【水】時，火焰鳥｜燃燒羽擊 不可用（要【火】）',
      !listed(st, '燃燒羽擊'));
    chk('7x ⭐交叉正對照：同一盤面，備戰急凍鳥｜嚴寒羽擊 可用（它要的就是【水】）',
      listed(st, '嚴寒羽擊'));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【8】074 尼多娜｜分享歡樂 — 將自己的 1 隻寶可夢恢復 30 HP');
{
  const n = inst(NIDO.id);
  const hurt = inst(PLAIN.id, { damage: 50 });
  const st = mk({ active: n, bench: [hurt], deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
  chk('8a 列入可用清單', listed(st, '分享歡樂'));
  const r = useAb(st, n.iid, 0);
  chk('8b 開 heal-target picker（healAmount=30）',
    r.pendingSelection?.type === 'heal-target' && r.pendingSelection?.params?.healAmount === 30,
    JSON.stringify(r.pendingSelection && { t: r.pendingSelection.type, h: r.pendingSelection.params?.healAmount }));
  const rr = resolve(r, [hurt.iid]);
  chk('8c ⭐解掉 picker 後真的回 30（50 → 20）', rr.players[0].bench[0].damage === 20,
    String(rr.players[0].bench[0]?.damage));
  chk('8d 哨兵 abilityUsedThisTurn', A0(rr)?.abilityUsedThisTurn === true);
  // ⭐數字反對照：回復量不超過實際傷害
  const hurt2 = inst(PLAIN.id, { damage: 10 });
  const n2 = inst(NIDO.id);
  const st2 = mk({ active: n2, bench: [hurt2], deck: [inst(PLAIN.id)] }, { active: inst(PLAIN.id) });
  const rr2 = resolve(useAb(st2, n2.iid, 0), [hurt2.iid]);
  chk('8e ⭐邊界：只受 10 傷時回到 0（不會變負）', rr2.players[0].bench[0].damage === 0,
    String(rr2.players[0].bench[0]?.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【9】084 索爾迦雷歐｜日出 — **在備戰區**才可用；牌庫選最多 2 張基本【鋼】能量附於自己');
{
  const s1 = inst(SOLG.id);
  const deck = [inst(EID.Metal), inst(EID.Metal), inst(EID.Metal), inst(PLAIN.id)];
  const st = mk({ active: inst(PLAIN.id), bench: [s1], deck, hand: [] }, { active: inst(PLAIN.id) });
  chk('9a 在備戰區 ⇒ 列入可用清單', listed(st, '日出'));
  const r = useAb(st, s1.iid, 0);
  chk('9b 開 deck-search picker（filter=BasicEnergy:Metal, 最多 2 張）',
    r.pendingSelection?.type === 'deck-search' && r.pendingSelection?.filter === 'BasicEnergy:Metal'
      && r.pendingSelection?.maxCount === 2 && r.pendingSelection?.minCount === 0,
    JSON.stringify(r.pendingSelection && { f: r.pendingSelection.filter, mx: r.pendingSelection.maxCount, mn: r.pendingSelection.minCount }));
  const rr = resolve(r, [deck[0].iid, deck[1].iid]);
  const holder = rr.players[0].bench[0];
  chk('9c ⭐解掉 picker 後真的附 2 張【鋼】到索爾迦雷歐身上',
    holder.energyAttached.length === 2
      && holder.energyAttached.every((e) => pool.get(e.cardId)?.name === '基本【鋼】能量'),
    JSON.stringify(holder.energyAttached.map((e) => pool.get(e.cardId)?.name)));
  chk('9d 牌庫少 2 張（4 → 2）', rr.players[0].deck.length === 2, String(rr.players[0].deck.length));
  chk('9e 哨兵 abilityUsedThisTurn', holder.abilityUsedThisTurn === true);
  // ⭐位置反對照：在戰鬥場不可用
  const s2 = inst(SOLG.id);
  const st2 = mk({ active: s2, bench: [], deck: [inst(EID.Metal)] }, { active: inst(PLAIN.id) });
  chk('9f ⭐位置反對照：在**戰鬥場** ⇒ 不列入清單', !listed(st2, '日出'));
  const r2 = useAb(st2, s2.iid, 0);
  chk('9g ⭐在戰鬥場按下去 = 完全 no-op（特性權不被吃掉）',
    r2.players[0].active.abilityUsedThisTurn === false && r2.log.length === st2.log.length);
  // ⭐牌庫空 gate
  const s3 = inst(SOLG.id);
  const st3 = mk({ active: inst(PLAIN.id), bench: [s3], deck: [] }, { active: inst(PLAIN.id) });
  chk('9h ⭐gate：牌庫為空 ⇒ 不列入清單', !listed(st3, '日出'));
  // ⭐「最多 2 張」＝ 可以選 0：仍重洗、能量留在牌庫
  const s4 = inst(SOLG.id);
  const deck4 = [inst(EID.Metal), inst(PLAIN.id)];
  const st4 = mk({ active: inst(PLAIN.id), bench: [s4], deck: deck4 }, { active: inst(PLAIN.id) });
  const rr4 = resolve(useAb(st4, s4.iid, 0), []);
  chk('9i ⭐可以選 0 張（卡面「最多2張」）：牌庫張數不變、身上沒有能量',
    rr4.players[0].deck.length === 2 && rr4.players[0].bench[0].energyAttached.length === 0,
    JSON.stringify([rr4.players[0].deck.length, rr4.players[0].bench[0].energyAttached.length]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【10】095 卡比獸｜好眠 — 寶可夢檢查中沒有從【睡眠】恢復 ⇒ HP 全部恢復');
{
  const mkEnd = (card, heads, damage = 100) => {
    const p = inst(card.id, { status: 'asleep', damage });
    const st = mk(
      { active: p, bench: [inst(PLAIN.id)], deck: Array.from({ length: 5 }, () => inst(PLAIN.id)),
        hand: [], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(PLAIN.id), bench: [inst(PLAIN.id)], deck: Array.from({ length: 5 }, () => inst(PLAIN.id)),
        hand: [], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    return { p, r: act(st, { type: 'END_TURN' }, heads) };
  };
  const { r: rT } = mkEnd(SNOR, false);      // 反面 = 沒醒
  const sleeper = rT.players[0].active;
  chk('10a 反面（沒從睡眠恢復）⇒ HP 全部恢復（damage 100 → 0）', sleeper?.damage === 0,
    String(sleeper?.damage));
  chk('10b 哨兵：仍然是【睡眠】（卡面只回血，不解除狀態）', sleeper?.status === 'asleep',
    String(sleeper?.status));
  chk('10c log 有「好眠」', logHas(rT, '好眠'));
  const { r: rH } = mkEnd(SNOR, true);       // 正面 = 醒了
  const woke = rH.players[0].active;
  chk('10d ⭐擲幣反對照：正面（醒來）⇒ 不回血（damage 仍 100）',
    woke?.damage === 100 && !woke?.status, JSON.stringify([woke?.damage, woke?.status]));
  // ⚠ 對照靶的 HP 比卡比獸小很多 ⇒ damage 用 30（用 100 會被 sanityKOSweep 直接判昏厥，
  //   active 變 null、斷言讀到 undefined ＝ 假 FAIL）。
  const { r: rP } = mkEnd(PLAIN, false, 30);
  chk('10e ⭐反對照：沒有「好眠」的寶可夢反面時不回血',
    rP.players[0].active?.damage === 30, String(rP.players[0].active?.damage));
  // ⭐特性消除：火箭隊的監視塔（雙方場上【無】屬性寶可夢的特性全部消除）—— 卡比獸是【無】
  const TOWER = all.find((c) => c.name === '火箭隊的監視塔');
  if (TOWER) {
    const p = inst(SNOR.id, { status: 'asleep', damage: 100 });
    const st = mk(
      { active: p, bench: [inst(PLAIN.id)], deck: Array.from({ length: 5 }, () => inst(PLAIN.id)),
        prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(PLAIN.id), bench: [inst(PLAIN.id)], deck: Array.from({ length: 5 }, () => inst(PLAIN.id)),
        prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { activeStadium: inst(TOWER.id), activeStadiumOwnerIdx: 1 });
    const r = act(st, { type: 'END_TURN' }, false);
    chk('10f ⭐特性被消除（火箭隊的監視塔對【無】）⇒ 不回血',
      r.players[0].active?.damage === 100, String(r.players[0].active?.damage));
  } else {
    chk('10f fixture 找不到「火箭隊的監視塔」', false);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
