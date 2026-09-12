// v6.349 守衛：三項收斂的**行為端**驗證（不驗字串存在、不驗註解）
//
//  ② registerSelfDiscardMultiply —— picker 端（+page.svelte 用的中央述詞 preDiscardEnergyEligible）
//     與 regPre 端（實際丟棄＋倍率）必須是**同一個判準**。
//     收斂前實測（__m6a/probe_energy_2.mjs）：picker 是 host-aware、regPre 只認 pokemonType／卡名【X】
//       ・鳳王｜紅蓮之翼 只選古舊能量 ⇒ 「丟棄 0 個能量」，能量沒被丟、130 照給
//       ・巨鉗螳螂ex｜十字破壞 古舊＋基本【鋼】兩張都選 ⇒ 只丟 1 張、傷害 120（該是 240）
//  ③ 能量撢子 ←→ 伊布｜叼去藏 —— 卡面除了「能量卡／物品卡」四個字以外逐字相同 ⇒ pending 形狀必須一致
//     （官方判準：「選擇1張」＝必選 ⇒ minCount 1；「可以選擇／最多N張」才可選 0）。
//  ④ 倫琴貓｜猛力進攻 / 寶寶暴龍｜勃然大怒 —— 傷害預估 breakdown 收斂到中央 helper 之後，
//     傷害數字與對戰紀錄**逐字不變**。
//
// ⭐ 每一條都有哨兵（招式／物品卡真的結算了），禁恆真斷言。
// ⚠ 靶一律用 neutralFor(atk)（對出招者屬性既不弱也不抗），否則弱點×2／抵抗−20 會把數字打歪。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6349-s.js'), E = join(ROOT, '.v6349-e.ts'), O = join(ROOT, '.v6349-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, createGame } from './src/lib/game/engine';\n"
  + "export { TRAINER_EFFECTS, ATTACK_PRE_DISCARD_CHOICE, RESOLVERS, preDiscardEnergyEligible } from './src/lib/game/effects';\n"
  + "export { OPTIONAL_SELECTION_EFFECT_KEYS, selectionAllowsSkip } from './src/lib/game/selection-ui';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, createGame, TRAINER_EFFECTS, ATTACK_PRE_DISCARD_CHOICE, RESOLVERS,
        preDiscardEnergyEligible, OPTIONAL_SELECTION_EFFECT_KEYS, selectionAllowsSkip } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const byName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
}
const find = (n, a) => (byName.get(n) || []).find((c) => (c.attacks || []).some((x) => x.name === a));
const firstNamed = (n) => (byName.get(n) || [])[0];
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const [id, c] of pool) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = id;
}
EID.Colorless = EID.Water; EID.Dragon = EID.Water; const FILL = EID.Water;
const ANCIENT = firstNamed('古舊能量');   // 全屬性（ACE SPEC）
const PRISM = firstNamed('稜鏡能量');     // 附於[基礎] = 全屬性；附於進化 = 僅【無】

let n = 0; const inst = (cid, e = {}) => ({ iid: `v${++n}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

const pick = (f) => { const a = [...pool.values()].filter(f); a.sort((x, y) => Number(y.hp) - Number(x.hp)); return a[0]; };
const isEx = (c) => /ex$/.test(c.name || '');
const BASE_OK = (c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && !isEx(c);
const PLAIN = pick(BASE_OK);
const typeOf = (c) => c?.pokemonType ?? null;
const neutral = (x, t) => !t || (x.weakness?.type !== t && x.resistance?.type !== t);
const neutralFor = (atk) => pick((x) => BASE_OK(x) && neutral(x, typeOf(atk))) ?? PLAIN;
/** 大傷害的靶：HP 要夠高，否則被打死 → active=null → 讀不到 damage ＝ 假 FAIL。 */
const bigTargetFor = (atk, minHp) => pick((x) => x.supertype === 'Pokemon' && Number(x.hp) >= minHp
  && !(x.abilities || []).length && neutral(x, typeOf(atk)));

/**
 * 完整 ATTACK 流程。opt.extraEnergy = 額外附在攻擊方身上的能量 cardId 陣列。
 * opt.chooseEnergyNames = 要送進 discardedEnergyIids 的能量**卡名**（依序、從 picker 合法候選裡挑）。
 */
function run(atkName, atk, opt = {}) {
  const def = opt.def ?? neutralFor(atk);
  const ai = (atk.attacks || []).findIndex((a) => a.name === atkName);
  if (ai < 0) return { __err: '找不到招式 ' + atkName };
  const A = inst(atk.id, opt.atkPatch || {});
  A.energyAttached = [
    ...((atk.attacks[ai].cost) || []).map((t) => inst(EID[t] ?? FILL)),
    ...((opt.extraEnergy || []).map((cid) => inst(cid))),
  ];
  const D = inst(def.id, opt.defPatch || {});
  const s0 = createGame({ name: 'P1', entries: [{ cardId: String(atk.id), count: 1 }] },
    { name: 'P2', entries: [{ cardId: String(def.id), count: 1 }] }, pool);
  const st = {
    ...s0, phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
    activeStadium: null, activeStadiumOwnerIdx: 0, pendingSelection: null, pendingChainQueue: [], log: [],
    players: [
      { ...s0.players[0], active: A, bench: [],
        hand: (opt.handCards || []).map((cid) => inst(cid)),
        deck: Array.from({ length: 3 }, () => inst(atk.id)),
        discard: [], prizes: Array.from({ length: opt.prizeN ?? 6 }, () => inst(def.id)) },
      { ...s0.players[1], active: D, bench: [inst(def.id)],
        hand: (opt.oppHandCards || []).map((cid) => inst(cid)),
        deck: (opt.oppDeckCards || Array.from({ length: 3 }, () => def.id)).map((cid) => inst(cid)),
        discard: [], prizes: Array.from({ length: 6 }, () => inst(def.id)) },
    ],
  };
  // picker 端候選：與 +page.svelte getDiscardableEnergies 的屬性／基本兩層用**同一支**中央述詞。
  const spec = ATTACK_PRE_DISCARD_CHOICE.get(`${atk.name}|${atkName}`);
  const pickerValid = A.energyAttached.filter((e) => !spec || preDiscardEnergyEligible(A, e, pool, {
    basicOnly: spec.basicEnergyOnly,
    type: spec.energyTypeFilter ?? null,
  }));
  let chosen;
  if (opt.chooseEnergyNames) {
    const used = new Set(); chosen = [];
    for (const want of opt.chooseEnergyNames) {
      const hit = pickerValid.find((e) => (pool.get(String(e.cardId))?.name === want) && !used.has(e.iid));
      if (hit) { used.add(hit.iid); chosen.push(hit.iid); }
    }
  } else if (opt.chooseAllAttachedNames) {
    // 反安慰劑用：**不管 picker 認不認**，直接把某些卡名送進去
    const used = new Set(); chosen = [];
    for (const want of opt.chooseAllAttachedNames) {
      const hit = A.energyAttached.find((e) => (pool.get(String(e.cardId))?.name === want) && !used.has(e.iid));
      if (hit) { used.add(hit.iid); chosen.push(hit.iid); }
    }
  }
  const orig = Math.random; Math.random = () => 0.1;
  let out;
  try {
    out = applyAction(st, chosen === undefined
      ? { type: 'ATTACK', attackIndex: ai }
      : { type: 'ATTACK', attackIndex: ai, discardedEnergyIids: chosen }, pool);
  } catch (e) { out = { __err: e.message }; }
  finally { Math.random = orig; }
  out.__pickerValid = pickerValid;
  out.__chosen = chosen ?? [];
  return out;
}
const P0 = (r) => r?.players?.[0];
const P1 = (r) => r?.players?.[1];
const dmgOf = (r) => P1(r)?.active?.damage ?? -1;
const pend = (r) => r?.pendingSelection ?? null;
const resolveAs = (r, iids, actor = 0) => applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: actor }, pool);
const pubMsg = (l) => (typeof l === 'string' ? l : (l?.message || ''));
const privMsg = (l) => (typeof l === 'string' ? '' : (l?.privateMessage || ''));
const pubLines = (r) => (r?.log || []).map(pubMsg).filter(Boolean);
const privLines = (r) => (r?.log || []).map(privMsg).filter(Boolean);
const pubHas = (r, t) => pubLines(r).some((m) => m.includes(t));
const privHas = (r, t) => privLines(r).some((m) => m.includes(t));
/** ⭐ 哨兵：招式真的被引擎跑完（否則下面全是空真）。 */
const ran = (r, atkName) => P0(r)?.active?.attackUsedThisTurn === atkName;
const nameOf = (i) => pool.get(String(i.cardId))?.name ?? '?';
const namesOf = (arr) => (arr || []).map(nameOf);
const countName = (arr, nm) => namesOf(arr).filter((x) => x === nm).length;

console.log('\n【0】harness 自驗（沒有這一段，下面全部可能是空真）');
{
  chk('0a fixture：抓得到 古舊能量／稜鏡能量／各色基本能量',
    !!ANCIENT && !!PRISM && !!EID.Metal && !!EID.Lightning && !!EID.Grass && !!EID.Fire,
    `${ANCIENT?.id}/${PRISM?.id}`);
  const c = find('巨鉗螳螂ex', '十字破壞');
  chk('0b fixture：巨鉗螳螂ex｜十字破壞 卡面是 120×（數字改了這支守衛就該重寫）',
    !!c && String((c.attacks || []).find((a) => a.name === '十字破壞')?.damage) === '120×',
    String((c?.attacks || []).find((a) => a.name === '十字破壞')?.damage));
  chk('0c ⭐反安慰劑：不存在的招式名會回 __err（run() 不會默默成功）', !!run('這招不存在', c).__err);
  const big = bigTargetFor(c, 300);
  chk('0d fixture：找得到 HP≥300 的中立靶（240 不會把它打死）', !!big && Number(big.hp) >= 300, `${big?.name}/${big?.hp}`);
}

console.log('\n【A】② 中央述詞 preDiscardEnergyEligible 本身（picker 與 regPre 共用的那一支）');
{
  const stage1Host = { cardId: String(find('巨鉗螳螂ex', '十字破壞').id) };   // Stage1
  const basicHost = { cardId: String(find('四季鹿', '落葉衝撞').id) };        // Basic
  const metalE = { cardId: String(EID.Metal) };
  const fireE = { cardId: String(EID.Fire) };
  const anc = { cardId: String(ANCIENT.id) };
  const prism = { cardId: String(PRISM.id) };
  chk('A1 基本【鋼】能量 對 type=Metal ⇒ 是候選',
    preDiscardEnergyEligible(stage1Host, metalE, pool, { type: 'Metal' }) === true);
  chk('A2 ⭐反對照：基本【火】能量 對 type=Metal ⇒ 不是候選',
    preDiscardEnergyEligible(stage1Host, fireE, pool, { type: 'Metal' }) === false);
  chk('A3 ⭐古舊能量（視為全屬性）對 type=Metal ⇒ 是候選（host-aware 的核心）',
    preDiscardEnergyEligible(stage1Host, anc, pool, { type: 'Metal' }) === true);
  chk('A4 ⭐稜鏡能量附於[基礎]（視為全屬性）對 type=Grass ⇒ 是候選',
    preDiscardEnergyEligible(basicHost, prism, pool, { type: 'Grass' }) === true);
  chk('A5 ⭐反對照：同一張稜鏡能量附於**進化**寶可夢 對 type=Grass ⇒ 不是候選（只視為【無】）',
    preDiscardEnergyEligible(stage1Host, prism, pool, { type: 'Grass' }) === false);
  chk('A6 basicOnly（卡面「基本能量卡」）⇒ 古舊能量不是候選、基本【鋼】是',
    preDiscardEnergyEligible(stage1Host, anc, pool, { basicOnly: true }) === false
    && preDiscardEnergyEligible(stage1Host, metalE, pool, { basicOnly: true }) === true);
  chk('A7 ⭐兩條件正交：basicOnly + type=Metal ⇒ 基本【火】false、基本【鋼】true、古舊 false',
    preDiscardEnergyEligible(stage1Host, fireE, pool, { basicOnly: true, type: 'Metal' }) === false
    && preDiscardEnergyEligible(stage1Host, metalE, pool, { basicOnly: true, type: 'Metal' }) === true
    && preDiscardEnergyEligible(stage1Host, anc, pool, { basicOnly: true, type: 'Metal' }) === false);
  chk('A8 沒有任何條件（卡面只寫「能量」）⇒ 一律是候選（維持 typeFilter=all 的既有行為）',
    preDiscardEnergyEligible(stage1Host, anc, pool, {}) === true
    && preDiscardEnergyEligible(stage1Host, fireE, pool, {}) === true);
}

console.log('\n【B】② 巨鉗螳螂ex｜十字破壞（【鋼】能量卡 ×120，最多 2 張）— picker 與倍率一致');
{
  const c = find('巨鉗螳螂ex', '十字破壞');
  const big = bigTargetFor(c, 300);
  // B-a：身上 1 張古舊 + 1 張基本【鋼】（再加費用的 2 張基本【鋼】）
  const r = run('十字破壞', c, { def: big, extraEnergy: [ANCIENT.id, EID.Metal],
    chooseEnergyNames: ['古舊能量', '基本【鋼】能量'] });
  chk('B1 ⭐哨兵：招式真的跑完了', ran(r, '十字破壞'), String(P0(r)?.active?.attackUsedThisTurn));
  chk('B2 picker 端：古舊能量在合法候選裡（host-aware 把它視為【鋼】）',
    namesOf(r.__pickerValid).includes('古舊能量'), namesOf(r.__pickerValid).join('/'));
  chk('B3 ⭐一致性：picker 認的 2 張真的都被丟到棄牌區（收斂前古舊會被 regPre 濾掉、只丟 1 張）',
    r.__chosen.length === 2 && countName(P0(r).discard, '古舊能量') === 1
    && countName(P0(r).discard, '基本【鋼】能量') === 1,
    `chosen=${r.__chosen.length} discard=${namesOf(P0(r).discard).join('/')}`);
  chk('B4 ⭐⭐倍率也一致：2 張 ×120 = 240（收斂前是 120）', dmgOf(r) === 240, String(dmgOf(r)));
  chk('B5 被丟掉的古舊能量真的不在身上了',
    countName(P0(r).active.energyAttached, '古舊能量') === 0,
    namesOf(P0(r).active.energyAttached).join('/'));

  // B-b：反對照 —— 不加那張特殊能量，改成兩張基本【鋼】
  const r2 = run('十字破壞', c, { def: big, extraEnergy: [EID.Metal, EID.Metal],
    chooseEnergyNames: ['基本【鋼】能量', '基本【鋼】能量'] });
  chk('B6 ⭐反對照（不加古舊，改 2 張基本【鋼】）：同樣 240 —— 證明 B4 的 240 不是靠古舊特判',
    ran(r2, '十字破壞') && dmgOf(r2) === 240, String(dmgOf(r2)));

  // B-c：反對照 —— 只選 1 張，倍率必須跟著掉
  const r3 = run('十字破壞', c, { def: big, extraEnergy: [ANCIENT.id, EID.Metal],
    chooseEnergyNames: ['古舊能量'] });
  chk('B7 ⭐反對照（只選古舊 1 張）：丟 1 張 ×120 = 120（證明數字真的跟張數連動）',
    ran(r3, '十字破壞') && r3.__chosen.length === 1 && dmgOf(r3) === 120
    && countName(P0(r3).discard, '古舊能量') === 1, String(dmgOf(r3)));

  // B-d：負向 —— 非【鋼】的基本能量，picker 不認、硬送也不該被丟
  const r4 = run('十字破壞', c, { def: big, extraEnergy: [EID.Fire],
    chooseAllAttachedNames: ['基本【火】能量'] });
  chk('B8 ⭐負向：基本【火】能量不在 picker 候選裡',
    !namesOf(r4.__pickerValid).includes('基本【火】能量'), namesOf(r4.__pickerValid).join('/'));
  chk('B9 ⭐負向：硬把基本【火】能量送進 discardedEnergyIids，regPre 也不丟、倍率 0',
    ran(r4, '十字破壞') && r4.__chosen.length === 1
    && countName(P0(r4).discard, '基本【火】能量') === 0 && dmgOf(r4) === 0,
    `discard=${namesOf(P0(r4).discard).join('/')} dmg=${dmgOf(r4)}`);
}

console.log('\n【C】② 密勒頓｜閃電猛衝（選 2 個【雷】能量丟棄，140 固定）— 代價也要付得出來');
{
  const c = find('密勒頓', '閃電猛衝');
  const r = run('閃電猛衝', c, { extraEnergy: [ANCIENT.id, EID.Lightning],
    chooseEnergyNames: ['古舊能量', '基本【雷】能量'] });
  chk('C1 ⭐哨兵：招式跑完 + 卡面 140 照結算', ran(r, '閃電猛衝') && dmgOf(r) === 140,
    `${P0(r)?.active?.attackUsedThisTurn}/${dmgOf(r)}`);
  chk('C2 picker 端：古舊能量是合法候選', namesOf(r.__pickerValid).includes('古舊能量'));
  chk('C3 ⭐一致性：兩張都真的被丟（收斂前只丟基本【雷】那 1 張＝少付一個代價）',
    countName(P0(r).discard, '古舊能量') === 1 && countName(P0(r).discard, '基本【雷】能量') === 1,
    namesOf(P0(r).discard).join('/'));
  const r2 = run('閃電猛衝', c, { extraEnergy: [EID.Lightning, EID.Lightning],
    chooseEnergyNames: ['基本【雷】能量', '基本【雷】能量'] });
  chk('C4 ⭐反對照（不加古舊，兩張基本【雷】）：同樣丟 2 張、140',
    ran(r2, '閃電猛衝') && countName(P0(r2).discard, '基本【雷】能量') === 2 && dmgOf(r2) === 140,
    namesOf(P0(r2).discard).join('/'));
}

console.log('\n【D】② 四季鹿｜落葉衝撞（選 1 個【草】能量丟棄）＋ 電擊魔獸｜電壓錘（基本能量卡）正對照');
{
  const c = find('四季鹿', '落葉衝撞');
  const r = run('落葉衝撞', c, { extraEnergy: [PRISM.id], chooseEnergyNames: ['稜鏡能量'] });
  chk('D1 ⭐哨兵 + 一致性：稜鏡能量（附於[基礎]四季鹿 ⇒ 視為【草】）真的被丟、卡面 40 照給',
    ran(r, '落葉衝撞') && countName(P0(r).discard, '稜鏡能量') === 1 && dmgOf(r) === 40,
    `${namesOf(P0(r).discard).join('/')} dmg=${dmgOf(r)}`);
  const c2 = find('電擊魔獸', '電壓錘');
  const r2 = run('電壓錘', c2, { extraEnergy: [ANCIENT.id, EID.Lightning],
    chooseAllAttachedNames: ['古舊能量', '基本【雷】能量'] });
  chk('D2 ⭐正對照（卡面寫「**基本**能量卡」）：古舊能量不是候選、硬送也丟不掉，只丟到 1 張 ×60',
    ran(r2, '電壓錘') && !namesOf(r2.__pickerValid).includes('古舊能量')
    && countName(P0(r2).discard, '古舊能量') === 0
    && countName(P0(r2).discard, '基本【雷】能量') === 1 && dmgOf(r2) === 60,
    `picker=${namesOf(r2.__pickerValid).join('/')} discard=${namesOf(P0(r2).discard).join('/')} dmg=${dmgOf(r2)}`);
}

console.log('\n【E】③ 能量撢子（Item）←→ 伊布｜叼去藏 —— 同措辭 ⇒ pending 形狀一致');
const ITEM_X = pick((c) => c.supertype === 'Trainer' && c.subtype === 'Item' && c.name !== '能量撢子');
const SUP_X = pick((c) => c.supertype === 'Trainer' && c.subtype === 'Supporter');
const BASIC_E = pool.get(String(EID.Water));
const SPECIAL_E = pick((c) => c.supertype === 'Energy' && c.subtype !== 'Basic');

/** 打出「能量撢子」：回傳打完（還沒解 picker）的 state。 */
function playDuster(oppHandCardIds) {
  const me = PLAIN, you = PLAIN;
  const s0 = createGame({ name: 'P1', entries: [{ cardId: String(me.id), count: 1 }] },
    { name: 'P2', entries: [{ cardId: String(you.id), count: 1 }] }, pool);
  const st = {
    ...s0, phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    activeStadium: null, activeStadiumOwnerIdx: 0, pendingSelection: null, pendingChainQueue: [], log: [],
    players: [
      { ...s0.players[0], active: inst(me.id), bench: [], hand: [], deck: [inst(me.id)], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(you.id)) },
      { ...s0.players[1], active: inst(you.id), bench: [],
        hand: oppHandCardIds.map((cid) => inst(cid)),
        deck: Array.from({ length: 3 }, () => inst(you.id)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(you.id)) },
    ],
  };
  const fn = TRAINER_EFFECTS.get('能量撢子');
  if (!fn) return { __err: '能量撢子 沒有註冊 TRAINER_EFFECTS' };
  return fn(st, 0, pool);
}
{
  const d = playDuster([SPECIAL_E.id, ITEM_X.id, BASIC_E.id]);
  chk('E1 ⭐哨兵：能量撢子真的結算了（私訊寫出查看了對手手牌 3 張）',
    privHas(d, '能量撢子：查看對手手牌（3 張）'), JSON.stringify(privLines(d)));
  chk('E2 ⭐Check T：picker 之前**不可以**用公開 log 印出對手手牌內容',
    !pubHas(d, SPECIAL_E.name) && !pubHas(d, ITEM_X.name),
    JSON.stringify(pubLines(d)));

  const e = find('伊布', '叼去藏');
  const r = run('叼去藏', e, { oppHandCards: [SPECIAL_E.id, ITEM_X.id, BASIC_E.id] });
  chk('E3 ⭐哨兵：伊布｜叼去藏 招式跑完，且卡面 damage 為空 ⇒ 對手一點傷害都不該多出來',
    ran(r, '叼去藏') && dmgOf(r) === 0 && (P1(r).bench[0]?.damage ?? 0) === 0,
    `${P0(r)?.active?.attackUsedThisTurn}/${dmgOf(r)}`);

  const shape = (p) => p && [p.type, p.actorIdx, p.sourcePlayerIdx, p.minCount, p.maxCount, p.effectKey].join('|');
  chk('E4 ⭐⭐兩張卡的 pending 形狀完全一致（type／actor／來源／minCount／maxCount／effectKey）',
    !!pend(d) && shape(pend(d)) === shape(pend(r)), `撢子=${shape(pend(d))}  叼去藏=${shape(pend(r))}`);
  chk('E5 ⭐卡面「選擇1張」＝必選 ⇒ minCount 1（收斂前能量撢子是 minCount 0，可以整個跳過）',
    pend(d)?.minCount === 1 && pend(d)?.maxCount === 1,
    `${pend(d)?.minCount}/${pend(d)?.maxCount}`);
  chk('E6 走的是同一支中央 resolver 家族', pend(d)?.effectKey === 'peek-pick-to-deck-bottom'
    && pend(r)?.effectKey === 'peek-pick-to-deck-bottom', `${pend(d)?.effectKey}`);
  chk('E7 filter 依卡面各自不同（能量卡 / 物品卡）',
    pend(d)?.filter === 'Energy' && pend(r)?.filter === 'Item', `${pend(d)?.filter}/${pend(r)?.filter}`);
  chk('E8 ⭐候選集合依卡面：能量撢子認得**特殊**能量（官方 Q&A：可以選特殊能量卡），不認物品卡',
    (pend(d)?.params?.validIids || []).length === 2
    && !(pend(d)?.params?.validIids || []).includes(P1(d).hand.find((h) => String(h.cardId) === String(ITEM_X.id))?.iid),
    JSON.stringify(namesOf(P1(d).hand.filter((h) => (pend(d)?.params?.validIids || []).includes(h.iid)))));

  // 正常路徑
  const pickIid = P1(d).hand.find((h) => String(h.cardId) === String(SPECIAL_E.id)).iid;
  const a = resolveAs(d, [pickIid]);
  chk('E9 ⭐正常路徑：對手手牌少 1 張、那張卡真的躺在對手牌庫**最下面**（keep-order，不重洗）',
    P1(a).hand.length === 2 && String(P1(a).deck[P1(a).deck.length - 1].cardId) === String(SPECIAL_E.id)
    && P1(a).deck.length === 4,
    `hand=${P1(a).hand.length} deckTail=${nameOf(P1(a).deck[P1(a).deck.length - 1])}`);
  chk('E10 被放回的那一張是雙方明知的資訊 ⇒ 公開 log 有卡名', pubHas(a, SPECIAL_E.name),
    JSON.stringify(pubLines(a).slice(-2)));

  // 不合法 iid 被擋
  const badIid = P1(d).hand.find((h) => String(h.cardId) === String(ITEM_X.id)).iid;
  const b = resolveAs(d, [badIid]);
  chk('E11 ⭐送不合法 iid（物品卡）：被擋下，對手手牌／牌庫都不動',
    P1(b).hand.length === 3 && P1(b).deck.length === 3
    && String(P1(b).deck[P1(b).deck.length - 1].cardId) !== String(ITEM_X.id),
    `hand=${P1(b).hand.length} deck=${P1(b).deck.length}`);
  // ⭐ 引擎的消毒閘擋掉之後，resolver 自己那一層 re-validate（v6.009）也必須還在 ——
  //   只靠 applyAction 驗證不到它（消毒閘已經先把壞 iid 拿掉了，resolver 收到的是空陣列）。
  {
    const fn = RESOLVERS.get('peek-pick-to-deck-bottom');
    const b2 = fn(d, 0, [badIid], pend(d).params, pool);
    chk('E11b ⭐⭐直接餵 resolver 一個不在 validIids 裡的 iid：它要自己擋下來（防繞過消毒閘）',
      typeof fn === 'function' && P1(b2).hand.length === 3 && P1(b2).deck.length === 3,
      `hand=${P1(b2).hand.length} deck=${P1(b2).deck.length}`);
    const b3 = fn(d, 0, [P1(d).hand.find((h) => String(h.cardId) === String(SPECIAL_E.id)).iid], pend(d).params, pool);
    chk('E11c ⭐正對照：同一支 resolver 餵合法 iid 就會動作（證明 E11b 不是因為 resolver 根本沒作用）',
      P1(b3).hand.length === 2 && String(P1(b3).deck[P1(b3).deck.length - 1].cardId) === String(SPECIAL_E.id),
      `hand=${P1(b3).hand.length}`);
  }

  // 對手手牌無能量卡 ⇒ 純檢視
  const d2 = playDuster([ITEM_X.id, SUP_X.id]);
  chk('E12 ⭐對手手牌沒有能量卡 ⇒ 純檢視 picker（min 0 / max 0 / 候選空），不是「玩家可以選 0」',
    pend(d2)?.minCount === 0 && pend(d2)?.maxCount === 0
    && (pend(d2)?.params?.validIids || []).length === 0
    && privHas(d2, '能量撢子：查看對手手牌（2 張）'),
    `${pend(d2)?.minCount}/${pend(d2)?.maxCount}/${(pend(d2)?.params?.validIids || []).length}`);

  // 舊 effectKey 相容別名
  chk('E13 ⭐⭐舊 effectKey「energy-duster-pick」的 resolver 仍註冊（部署瞬間停在舊 pending 的玩家不可卡死）',
    typeof RESOLVERS.get('energy-duster-pick') === 'function');
  {
    const oldFn = RESOLVERS.get('energy-duster-pick');
    const d3 = playDuster([SPECIAL_E.id, ITEM_X.id]);
    const oldPick = P1(d3).hand.find((h) => String(h.cardId) === String(SPECIAL_E.id)).iid;
    // 舊 pending 的 params 只有 { validIids, titleOverride }（沒有 label/targetDesc）
    const z = oldFn(d3, 0, [oldPick], { validIids: [oldPick], titleOverride: '舊視窗' }, pool);
    chk('E14 ⭐舊 key 真的能把卡放回對手牌庫下方，且 log 寫「能量撢子」（不是 fallback 的「叼去藏」）',
      P1(z).hand.length === 1
      && String(P1(z).deck[P1(z).deck.length - 1].cardId) === String(SPECIAL_E.id)
      && pubHas(z, '能量撢子') && !pubHas(z, '叼去藏'),
      JSON.stringify(pubLines(z).slice(-2)));
  }
  chk('E15 ⭐白名單衛生：energy-duster-pick 已從 OPTIONAL_SELECTION_EFFECT_KEYS 移除（收斂後是死條目）',
    !OPTIONAL_SELECTION_EFFECT_KEYS.has('energy-duster-pick'));
  chk('E16 ⭐minCount 1 ⇒ UI 不給【不選】鈕（與 叼去藏 同一個判準）',
    selectionAllowsSkip({ type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 1,
      effectKey: 'peek-pick-to-deck-bottom', minCount: 1 }) === false
    && selectionAllowsSkip({ type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 1,
      effectKey: 'peek-pick-to-deck-bottom', minCount: 0 }) === true);
}

console.log('\n【F】④ 傷害預估 breakdown 收斂 —— 傷害數字與對戰紀錄逐字不變');
/** 這一招在對戰紀錄裡留下的那一行（引擎寫的「使出「X」…」）。 */
const atkLine = (r, atkName) => pubLines(r).filter((m) => m.includes(`使出「${atkName}」`));
// ⚠ composeAttackFormula 只有在 term ≥ 2 時才印【公式】（單一基礎項沒有公式可言）⇒
//   要看到 breakdown 的標籤，盤面必須至少再有一個 modifier。這裡用「回合加傷 +10」
//   （damageBonusThisTurn）當那個 modifier：它與屬性無關、完全可控，不會被弱點／抵抗力污染。
{
  const c = find('倫琴貓', '猛力進攻');
  const big = bigTargetFor(c, 320);
  // 獎賞剩 2 張 ⇒ 已取 4 張 ⇒ 4×70 = 280
  const r = run('猛力進攻', c, { def: big, prizeN: 2 });
  chk('F1 ⭐哨兵：招式跑完', ran(r, '猛力進攻'), String(P0(r)?.active?.attackUsedThisTurn));
  chk('F2 ⭐傷害數字不變：已取 4 張獎賞 × 70 = 280', dmgOf(r) === 280, String(dmgOf(r)));
  chk('F3 ⭐收斂前 regPre 一行 log 都不寫 ⇒ 收斂後也不可以多出「猛力進攻：…」那種行，'
    + '且這一招只留下引擎那一行',
    pubLines(r).length === 1
    && pubLines(r)[0] === 'P1 的 倫琴貓 使出「猛力進攻」，造成 280 點傷害！',
    JSON.stringify(pubLines(r)));
  // 加一個與屬性無關的 modifier，讓引擎把公式印出來
  const rB = run('猛力進攻', c, { def: big, prizeN: 2, atkPatch: { damageBonusThisTurn: 10 } });
  chk('F4 ⭐⭐breakdown 真的出現在公式裡，而且**逐字**是收斂前那一串',
    atkLine(rB, '猛力進攻').length === 1
    && atkLine(rB, '猛力進攻')[0]
       === 'P1 的 倫琴貓 使出「猛力進攻」，造成 290 點傷害！【280(已取獎賞 4×70) +10(回合加傷) = 290】',
    JSON.stringify(atkLine(rB, '猛力進攻')));
  // 反對照：一張獎賞都沒取 ⇒ 0 傷害、連公式都沒有
  const r0 = run('猛力進攻', c, { def: big, prizeN: 6 });
  chk('F5 ⭐反對照（獎賞 0 張）：0 傷害、沒有任何公式（證明 F4 的字串不是恆真）',
    ran(r0, '猛力進攻') && dmgOf(r0) === 0
    && atkLine(r0, '猛力進攻')[0] === 'P1 的 倫琴貓 使出「猛力進攻」！',
    JSON.stringify(atkLine(r0, '猛力進攻')));
}
{
  const c = find('寶寶暴龍', '勃然大怒');
  const big = bigTargetFor(c, 200);
  // 自身 60 點傷害 ⇒ 6 個指示物 ⇒ 6×20 = 120
  const r = run('勃然大怒', c, { def: big, atkPatch: { damage: 60 } });
  chk('F6 ⭐哨兵：招式跑完', ran(r, '勃然大怒'), String(P0(r)?.active?.attackUsedThisTurn));
  chk('F7 ⭐傷害數字不變：自身 6 個指示物 × 20 = 120', dmgOf(r) === 120, String(dmgOf(r)));
  chk('F8 ⭐收斂後也不可以多出「勃然大怒：…」的 log 行',
    pubLines(r).length === 1
    && pubLines(r)[0] === 'P1 的 寶寶暴龍 使出「勃然大怒」，造成 120 點傷害！',
    JSON.stringify(pubLines(r)));
  const rB = run('勃然大怒', c, { def: big, atkPatch: { damage: 60, damageBonusThisTurn: 10 } });
  chk('F9 ⭐⭐breakdown 逐字不變',
    atkLine(rB, '勃然大怒').length === 1
    && atkLine(rB, '勃然大怒')[0]
       === 'P1 的 寶寶暴龍 使出「勃然大怒」，造成 130 點傷害！【120(自身指示物 6×20) +10(回合加傷) = 130】',
    JSON.stringify(atkLine(rB, '勃然大怒')));
  const r0 = run('勃然大怒', c, { def: big });
  chk('F10 ⭐反對照（自身 0 個指示物）：0 傷害、沒有公式',
    ran(r0, '勃然大怒') && dmgOf(r0) === 0
    && atkLine(r0, '勃然大怒')[0] === 'P1 的 寶寶暴龍 使出「勃然大怒」！',
    JSON.stringify(atkLine(r0, '勃然大怒')));
}
{
  // ⭐⭐正對照：同一支中央 helper 的**既有**卡（沒有 breakdownLabel）必須維持原本的「(基礎)」＋自己的 log。
  //   這一組就是「改壞 breakdown 會紅」的反對照 —— 若有人把 breakdownLabel 改成無條件開啟／
  //   把標籤寫錯，F4/F9 與這裡會同時抓到（標籤字串是逐字比對的）。
  const c = find('呆火鱷ex', '心情好火焰');
  const big = bigTargetFor(c, 320);
  const r = run('心情好火焰', c, { def: big, prizeN: 2, atkPatch: { damageBonusThisTurn: 10 } });
  chk('F11 ⭐正對照：呆火鱷ex｜心情好火焰 走同一支 prizesTakenMultiplyPre，4×70=280 且**仍然寫自己的 log**',
    ran(r, '心情好火焰') && dmgOf(r) === 290
    && pubHas(r, '心情好火焰：自己已取獎賞 4 張 → 造成 280 點傷害'),
    `${dmgOf(r)} / ${JSON.stringify(pubLines(r))}`);
  chk('F12 ⭐⭐正對照：它沒有 breakdownLabel ⇒ 公式第一項是「280(基礎)」不是「280(已取獎賞 4×70)」'
    + '（證明 breakdown 是逐卡開關，不是把整支 helper 的行為改掉）',
    atkLine(r, '心情好火焰')[0]
      === 'P1 的 呆火鱷ex 使出「心情好火焰」，造成 290 點傷害！【280(基礎) +10(回合加傷) = 290】',
    JSON.stringify(atkLine(r, '心情好火焰')));
  const c2 = find('皮卡丘', '氣沖沖伏特');
  const big2 = bigTargetFor(c2, 200);
  const r2 = run('氣沖沖伏特', c2, { def: big2, atkPatch: { damage: 30, damageBonusThisTurn: 10 } });
  chk('F13 ⭐正對照：皮卡丘｜氣沖沖伏特 走 selfCountersMultiplyPre（10 + 3×10 = 40），'
    + 'log 與公式都維持「(基礎)」形狀',
    ran(r2, '氣沖沖伏特') && dmgOf(r2) === 50
    && pubHas(r2, '氣沖沖伏特：自身傷害指示物 3 個 × 10 → 40')
    && atkLine(r2, '氣沖沖伏特')[0]
       === 'P1 的 皮卡丘 使出「氣沖沖伏特」，造成 50 點傷害！【40(基礎) +10(回合加傷) = 50】',
    `${dmgOf(r2)} / ${JSON.stringify(atkLine(r2, '氣沖沖伏特'))}`);
}

console.log('\n【G】② picker 端（+page.svelte）真的走同一支中央述詞');
// ⚠ 這是全檔唯一的原始碼層斷言 —— getDiscardableEnergies 是 Svelte 元件內的區域函式，
//   node 端沒有辦法把它叫起來跑。但「picker 與 regPre 必須同一份」正是本版要修的病，
//   所以這一段一定要有人守：若有人把那兩層過濾抄回元件裡，就會紅在這裡。
{
  const src = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const a = src.indexOf('function getDiscardableEnergies');
  const b = src.indexOf('function computePickedAmount');
  const body = a >= 0 && b > a ? src.slice(a, b) : '';
  chk('G1 抓得到 getDiscardableEnergies 的函式本體（抓不到 ⇒ 下面兩條是空真）',
    body.length > 500, `a=${a} b=${b} len=${body.length}`);
  chk('G2 ⭐它呼叫中央 preDiscardEnergyEligible', body.includes('preDiscardEnergyEligible('));
  chk('G3 ⭐⭐它**不可以**自己再寫一份：直接呼叫 energyProvidesType、或自己判 subtype===\'Basic\'，'
    + '都是「picker 一份、regPre 另一份」那個病復發',
    !body.includes('energyProvidesType(') && !/subtype\s*===\s*'Basic'/.test(body),
    body.includes('energyProvidesType(') ? 'energyProvidesType 又出現了' : "subtype === 'Basic' 又出現了");
}

console.log('\n=== v6.349 收斂殘留守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
