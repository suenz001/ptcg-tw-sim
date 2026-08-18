// ⭐⭐⭐ v6.209 大吾的小碎鑽｜岩石宮殿 — 特性消除閘（結束 v6.202 vs v6.208 的判讀衝突）
//
// 卡面（static/cards/SVOD.json id 12583，特性讀 abilities[].effect）：
//   「只要這隻寶可夢在備戰區，自己的所有「大吾的寶可夢」受到對手的寶可夢招式的傷害「-30」點。
//     無論有多少隻擁有這個特性的寶可夢，這個效果也不會重複。」
//   持有者屬性：supertype=Pokemon / stage=subtype='Basic' / pokemonType='Psychic' /
//              tags=['訓練家冠名']（非規則寶可夢）⇒ location 恆為 'bench'。
//
// 本測試分三段：
//   A) 現行六種特性消除來源**逐一行為端實跑**（完整 ATTACK），確認一個都打不到岩石宮殿
//      —— 且每一項都附**正對照**：同一盤面下用該來源**打得到**的真卡查中央閘，必須回 false
//      （否則「delta 仍是 30」可能只是那個來源根本沒被接上，是安慰劑）。
//   B) ★絆線／HEAD-FAIL：用「合成持有者」（把小碎鑽改成【無】／2階／規則寶可夢）反向證明
//      新加的 isAbilityHolderEffective 那一行**真的會擋**，不是永遠 true 的死碼。
//      HEAD（無閘）時 B 段全紅。
//   C) 反安慰劑對照：同樣的合成持有者、但**不放**消除來源 → 必須仍 -30
//      （排除「合成卡本身壞掉才變 0」的假紅）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.sp-e.ts'), O = join(ROOT, '.sp-o.mjs'), S = join(ROOT, '.sp-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';\n`
  + `export { isAbilityHolderEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';\n`
  + `import './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, isAbilityHolderEffective } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const basePool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) basePool.set(String(c.id), c); }

const W = '18519', L = '18520';
const MILK = '14011';   // 大奶罐（Colorless 基礎）｜撞擊 60（attackIndex 1，無效果）
const SKARM = '16965';  // 大吾的盔甲鳥（Metal 基礎 HP120，無特性）— 受惠者/備戰填充
const GEM = '12583';    // 大吾的小碎鑽｜岩石宮殿
const IRON = '16753';   // 鐵荊棘ex｜初始化（伏特旋風 140，Lightning 費）
const MOON = '16826';   // 振翼髮｜暗夜羽擊（passive）｜飛來橫禍 90
const SEA = '11246';    // 海兔獸｜黏著束縛
const TOWER = '14849';  // 火箭隊的監視塔
const CAVE = '19623';   // 傳說的熔岩洞
const DEDENNE = '19627';// 探探鼠（Colorless 基礎，有特性）— 監視塔/暗夜羽擊 正對照
const GALAR = '17971';  // 大竺葵（Stage2，有特性）— 熔岩洞/黏著束縛 正對照
const GRENI = '18516';  // 超級甲賀忍蛙ex（規則寶可夢，有特性）— 初始化 正對照
const BIG = '15993';    // 大吾的巨金怪ex（HP340）— 高傷來源時當受惠者避免 KO

let pass = 0, fail = 0;
const ck = (l, c, e) => { if (c) { pass++; console.log('  PASS', l); } else { fail++; console.log('  FAIL', l, e ?? ''); } };

// 掃描器下限：確認 fixture 卡都真的存在且卡面條件沒被改掉
for (const [id, nm] of [[GEM, '大吾的小碎鑽'], [IRON, '鐵荊棘ex'], [MOON, '振翼髮'], [SEA, '海兔獸'],
                        [TOWER, '火箭隊的監視塔'], [CAVE, '傳說的熔岩洞'], [DEDENNE, '探探鼠'],
                        [GALAR, '大竺葵'], [GRENI, '超級甲賀忍蛙ex'], [BIG, '大吾的巨金怪ex']]) {
  ck(`fixture ${nm} 存在於現役卡池`, basePool.get(id)?.name === nm, '實際=' + basePool.get(id)?.name);
}
{
  const g = basePool.get(GEM);
  ck('岩石宮殿持有者仍是【基礎】【超】非規則寶可夢（卡面前提未變）',
    (g.stage ?? g.subtype) === 'Basic' && g.pokemonType === 'Psychic'
    && g.subtype === 'Basic' && !(g.name.endsWith('ex') || g.name.endsWith('EX')),
    JSON.stringify([g.stage, g.subtype, g.pokemonType]));
  ck('岩石宮殿卡面仍寫「在備戰區」', (g.abilities ?? []).some(a => a.name === '岩石宮殿' && a.effect.includes('在備戰區')));
}

let n = 0;
const I = (cid, e = 0, ec = W, x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0,
  energyAttached: Array.from({ length: e }, () => ({ iid: 'e' + (++n), cardId: ec, damage: 0, energyAttached: [] })), ...x });
const D = () => ({ iid: 'd' + (++n), cardId: W, damage: 0, energyAttached: [] });
function mk({ att, attE = 3, attEc = W, stadium = null, defActive = SKARM, defBench = [] }) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, setupDone: [true, true],
    stadiumUsedThisTurn: [true, true],
    activeStadium: stadium ? { iid: 'st', cardId: stadium } : null,
    players: [
      { name: 'A', active: I(att, attE, attEc), bench: [], hand: [], deck: Array.from({ length: 12 }, D), discard: [], prizes: Array.from({ length: 6 }, D) },
      { name: 'D', active: I(defActive), bench: defBench, hand: [], deck: Array.from({ length: 12 }, D), discard: [], prizes: Array.from({ length: 6 }, D) },
    ] };
}
function runDmg(opts, ai, P) {
  let s = mk(opts); const vid = s.players[1].active.iid;
  s = applyAction(s, { type: 'ATTACK', attackIndex: ai }, P);
  let g = 0;
  while (s.pendingSelection && g++ < 6) { const p = s.pendingSelection; s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [] }, P); if (s.pendingSelection === p) break; }
  const v = s.players[1].active;
  return (v && v.iid === vid) ? v.damage : 'KO';
}
/** 量測「備戰有無小碎鑽」造成的傷害差 → 岩石宮殿生效時必為 30，被消除時為 0 */
function delta(opts, ai, gemCid = GEM, gemX = {}, P = basePool) {
  const without = runDmg({ ...opts, defBench: [...(opts.defBench ?? []), I(SKARM)] }, ai, P);
  const with_ = runDmg({ ...opts, defBench: [...(opts.defBench ?? []), I(gemCid, 0, W, gemX)] }, ai, P);
  return { without, with_, d: (typeof without === 'number' && typeof with_ === 'number') ? without - with_ : null };
}
/** 正對照：同一盤面下，該來源**打得到**的真卡，中央閘必須回 false */
function control(opts, probeCid, loc, P = basePool) {
  const s = mk({ ...opts, defBench: [...(opts.defBench ?? []), I(GEM)] });
  const pc = P.get(probeCid);
  const holder = loc === 'active' ? s.players[1].active : s.players[1].bench[s.players[1].bench.length - 1];
  const probeInst = { ...holder, cardId: probeCid };
  return isAbilityHolderEffective(s, probeInst, pc, 1, pc.abilities[0].name, loc, P);
}

console.log('\nA) 六種特性消除來源逐一行為端驗證（每項附正對照）');
const A = [
  ['① 鐵荊棘ex｜初始化（只消規則寶可夢）', { att: IRON, attEc: L, defActive: BIG }, 0, GRENI, 'bench'],
  ['② 火箭隊的監視塔（只消【無】）',        { att: MILK, stadium: TOWER }, 1, DEDENNE, 'bench'],
  ['③ 傳說的熔岩洞（只消進化）',            { att: MILK, stadium: CAVE }, 1, GALAR, 'bench'],
  ['④ 招式版暗夜羽擊（限 active 旗標）',    { att: MILK }, 1, null, null],
  ['⑤ passive 振翼髮｜暗夜羽擊（限對手戰鬥場）', { att: MOON }, 0, DEDENNE, 'active'],
  ['⑥ 海兔獸｜黏著束縛（只消備戰2階）',    { att: MILK, defBench: [I(SEA)] }, 1, GALAR, 'bench'],
];
for (const [label, opts, ai, probe, loc] of A) {
  const gemX = label.startsWith('④') ? { abilityNullifiedThisTurn: true } : {};
  const r = delta(opts, ai, GEM, gemX);
  ck(`${label} → 岩石宮殿仍生效（delta=30）`, r.d === 30, `無=${r.without} 有=${r.with_} delta=${r.d}`);
  if (probe) {
    ck(`${label} 正對照：該來源在同一盤面確實會消除它打得到的卡`, control(opts, probe, loc) === false,
      'effective=' + control(opts, probe, loc));
  } else {
    // ④ 沒有「打得到的真卡」可放備戰（旗標限 active）→ 正對照改測 active 位帶旗標必被消除
    const s = mk(opts);
    const act = { ...s.players[1].active, cardId: DEDENNE, abilityNullifiedThisTurn: true };
    ck(`${label} 正對照：active 帶 abilityNullifiedThisTurn 的卡確實被消除`,
      isAbilityHolderEffective(s, act, basePool.get(DEDENNE), 1, '監視之眼', 'active', basePool) === false);
  }
}

console.log('\nB) ★絆線／HEAD-FAIL：合成持有者證明新加的中央閘真的會擋（HEAD 無閘 → 全紅）');
const gem = basePool.get(GEM);
// ⚠ isStage2(v3001_g3_wave3) 的判準是「evolvesFrom 指向的那張卡自己也有 evolvesFrom」，
//   不是直接讀 stage 欄位 ⇒ 合成 2 階必須 evolvesFrom 一張真的 Stage1（大吾的念力土偶）。
const SYN = {
  colorless: { ...gem, id: '9800001', pokemonType: 'Colorless' },
  stage2:    { ...gem, id: '9800002', stage: 'Stage2', subtype: 'Stage2', evolvesFrom: '大吾的念力土偶' },
  rulebox:   { ...gem, id: '9800003', subtype: 'ex' },
};
const P2 = new Map(basePool);
for (const k of Object.keys(SYN)) P2.set(SYN[k].id, SYN[k]);
const B = [
  ['B1 合成【無】小碎鑽 + 火箭隊的監視塔', { att: MILK, stadium: TOWER }, 1, SYN.colorless.id],
  ['B2 合成2階小碎鑽 + 傳說的熔岩洞',      { att: MILK, stadium: CAVE }, 1, SYN.stage2.id],
  ['B3 合成2階小碎鑽 + 海兔獸黏著束縛',    { att: MILK, defBench: [I(SEA)] }, 1, SYN.stage2.id],
  ['B4 合成規則小碎鑽 + 鐵荊棘ex初始化',   { att: IRON, attEc: L, defActive: BIG }, 0, SYN.rulebox.id],
];
for (const [label, opts, ai, cid] of B) {
  const r = delta(opts, ai, cid, {}, P2);
  // ⚠ 只斷言 delta===0 是弱斷言（「整條 palace reduce 死掉」也會是 0）；一併斷言
  //   with_ 等於「沒有小碎鑽時的傷害」且該值是有效數字 ⇒ 排除「兩邊都 KO/都 0」的假綠。
  //   真正把「整條死掉」擋掉的是下面 C 段（同樣的合成持有者、無來源 → 必須仍 -30）。
  ck(`${label} → 特性被消除，不再 -30（delta=0）`, r.d === 0, `無=${r.without} 有=${r.with_} delta=${r.d}`);
  ck(`${label} → 有/無小碎鑽的傷害完全相同且為有效數字`,
    typeof r.without === 'number' && r.without > 0 && r.with_ === r.without,
    `無=${r.without} 有=${r.with_}`);
}

console.log('\nC) 反安慰劑：同樣的合成持有者、但不放消除來源 → 必須仍 -30（證明 B 段的 0 不是合成卡壞掉）');
for (const [label, cid] of [['C1 合成【無】', SYN.colorless.id], ['C2 合成2階', SYN.stage2.id], ['C3 合成規則', SYN.rulebox.id]]) {
  const r = delta({ att: MILK }, 1, cid, {}, P2);
  ck(`${label} 無消除來源 → 仍 -30`, r.d === 30, `無=${r.without} 有=${r.with_} delta=${r.d}`);
}

console.log('\nD) 基準：無任何來源 → -30；受惠者非「大吾的」→ 不減傷');
{
  const r = delta({ att: MILK }, 1);
  ck('D1 基準 delta=30', r.d === 30, JSON.stringify(r));
  const r2 = delta({ att: MILK, defActive: DEDENNE }, 1);
  ck('D2 受惠者為探探鼠（非「大吾的」）→ delta=0', r2.d === 0, JSON.stringify(r2));
}

// ════════════════════════════════════════════════════════════════════════════
// E) ⭐ 備戰／場域消費端（effects.ts `_applyBenchAbilityReduce` 內的 steelixPalaceReduce）
//    ⚠ 第二輪審查抓到：A~D 段全部只走 engine.ts 戰鬥位那條消費端，把 effects.ts 那條
//      整條打死時測試仍 100% 綠（零覆蓋）。本段用 snipe-multi（酋雷姆｜三重冰霜，
//      「對手的3隻寶可夢各受到110點傷害」）打**備戰**的大吾的盔甲鳥，補上那條線。
// ════════════════════════════════════════════════════════════════════════════
console.log('\nE) 備戰/場域消費端（狙擊備戰的「大吾的」寶可夢）');
const KYUREM = '10629';   // 酋雷姆｜三重冰霜（snipe-multi，備戰不計弱抗）
const MET = '14434';      // 基本【鋼】能量
function benchSnipe(holderInst, P = basePool) {
  let n2 = 0;
  const J = (cid, e = []) => ({ iid: 'k' + (++n2), cardId: String(cid), damage: 0, energyAttached: e });
  const KE = (cid) => ({ iid: 'ke' + (++n2), cardId: String(cid), damage: 0, energyAttached: [] });
  const victim = J(SKARM);                       // 備戰的大吾的盔甲鳥＝受惠者
  let s = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, setupDone: [true, true],
    stadiumUsedThisTurn: [true, true], activeStadium: null,
    players: [
      { name: 'A', active: J(KYUREM, [KE(W), KE(W), KE(MET), KE(MET), KE(W)]), bench: [], hand: [],
        deck: Array.from({ length: 12 }, () => KE(W)), discard: [], prizes: Array.from({ length: 6 }, () => KE(W)) },
      { name: 'D', active: J(SKARM), bench: [victim, holderInst(J)], hand: [],
        deck: Array.from({ length: 12 }, () => KE(W)), discard: [], prizes: Array.from({ length: 6 }, () => KE(W)) },
    ] };
  s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, P);
  if (!s.pendingSelection || s.pendingSelection.effectKey !== 'snipe-multi') {
    return { err: 'snipe-multi 沒開：' + JSON.stringify(s.pendingSelection?.effectKey) };
  }
  s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [victim.iid] }, P);
  const v = s.players[1].bench.find(c => c.iid === victim.iid);
  return { dmg: v ? v.damage : 'KO' };
}
{
  const noGem = benchSnipe(J => J(SKARM));
  const withGem = benchSnipe(J => J(GEM));
  ck('E0 snipe-multi 流程正常', !noGem.err && !withGem.err, (noGem.err ?? '') + (withGem.err ?? ''));
  ck('E1 ★備戰受惠者：有小碎鑽 → 備戰傷害 -30（effects.ts 消費端）',
    typeof noGem.dmg === 'number' && noGem.dmg > 0 && withGem.dmg === noGem.dmg - 30,
    `無=${noGem.dmg} 有=${withGem.dmg}`);
  // 六來源中對「備戰消費端」最可能混淆的一個：熔岩洞（真卡下必須仍 -30）
  const P3 = new Map(basePool);
  for (const k of Object.keys(SYN)) P3.set(SYN[k].id, SYN[k]);
  const synNo = benchSnipe(J => J(SKARM), P3);
  const synWith = benchSnipe(J => J(SYN.colorless.id), P3);
  ck('E2 反安慰劑：合成【無】小碎鑽、無消除來源 → 備戰仍 -30',
    typeof synNo.dmg === 'number' && synWith.dmg === synNo.dmg - 30, `無=${synNo.dmg} 有=${synWith.dmg}`);
}

console.log('\n岩石宮殿特性消除閘 PASS ' + pass + ' / FAIL ' + fail);
console.log('SCRIPT_END_MARKER test-steelix-palace-ability-nullify-gate');
process.exitCode = fail ? 1 : 0;
