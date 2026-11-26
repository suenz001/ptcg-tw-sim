#!/usr/bin/env node
/**
 * v6.672 守衛：擴充包 M7「波導探求者」上架（78 張，J 標）＋新機制實跑。
 *
 * 【A】資料：78 張都在現役卡池、檔案 M7、card-set-map、index.json 張數三欄、兩份 regulation 表都有 M7: 'J'
 * 【C】覆蓋：有效果的招式全部以「卡名|招式名」註冊、主動特性已註冊、訓練家不會 fail-closed
 * 【B】新機制實跑（applyAction 完整流程）
 *   B1 蜥蜴王ex｜刺殺利刃：對手中毒＋灼傷 ⇒ 160＋2×50＝260
 *   B2 九尾｜障眼法：自己手牌剛好 5 張 ⇒ 被打倒對手拿不到獎賞卡；4 張 ⇒ 照常（正對照）
 *   B3 水箭龜｜增水泵：自己【水】寶可夢對對手備戰的傷害 +30（幾何雪花｜冰雹 備戰 20 → 50）；沒有水箭龜 20
 *   B4 象徵鳥ex｜超級護身：超級進化寶可夢ex 的招式傷害 0；非超級的攻擊方照常（正對照）
 *   B5 超級阿勃梭魯Zex｜血紅恐懼：下個對手的回合不能從手牌附特殊能量、不能打出競技場；基本能量照常（正對照）
 *   B6 巴布土撥｜二連打：同一招可以用第 2 次（站長裁定：比照祭典樂舞）
 *   B7 大食花｜酸液陷阱：有自己的競技場 ⇒ 可用、對手中毒＋灼傷；沒有競技場 ⇒ 不給按鈕
 *   B8 貓老大｜招財進寶：場上 2 隻持有「聚寶功」⇒ 可用、抽 2；只有 1 隻 ⇒ 不給按鈕
 *   B9 列陣兵｜團結之陣：從牌庫附給備戰的列陣兵各 1 張基本【鬥】能量
 *   B10 戰鬥體育場：自己非規則寶可夢各恢復 20、ex 不恢復；沒有可恢復的 ⇒ 使用權退回
 *   B11 吉憲的熱血：備戰【水】寶可夢連同附加的卡放回牌庫
 *   B12 記者：抽 2、查看對手手牌、之後查看對手牌庫上方 1 張（排隊）
 *   B13 可爾妮的全力：超級進化寶可夢ex 的招式 +20×對手已獲得的獎賞卡；非超級不加（正對照）
 *   B14 連擊武道熊師｜水流連打（「這個情況下」型，站長裁定）：付【水】能量 ⇒ 備戰各 40；不付 ⇒ 0
 *   B15 摔角鷹人｜振奮聲援：「奮勇戰鬥」少 1 個【無】⇒ 戰舞郎 1 個能量就能使出
 *   B16 天然鳥｜能量躍遷：對手手牌的能量卡附到對手的寶可夢身上
 *   B17 托戈德瑪爾ex｜雙重屬性＝【雷】＋【鋼】；變隱龍｜同步之軀＝【無】＋備戰的屬性
 *   B18 牽絆披帶：超級進化寶可夢ex 被招式打倒 ⇒ 持有方從牌庫任意選 1 張；非超級 ⇒ 沒有（正對照）
 *   B19 超級晶光花ex｜毒晶寶石：對手 2 隻寶可夢剩餘 HP 都變成 60
 *   B20 超音波幼蟲｜震顫翅（不放置型手牌特性；test-v6200 的完備性斷言指名這裡）
 * 【D】同版一起收的官方新印刷 19 張（M-P 特典 234～248、M6a 119／128／129／131）＋ BASE blob 逐字比對（index／card-set-map／兩個卡表檔）
 * 【H】HEAD-FAIL：BASE（v6.671）的引擎在同一份卡池上 C／B 新機制全部紅、正對照綠
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip, readBaseBlob } from './lib/base-blob.mjs';
import { V6672_M7_IDS, V6672_EXTRA_IDS, revertV6672Index, revertV6672Map, revertV6672Cards } from './lib/revert-v6672-m7.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ BASE_SHA 必須是留在 main 上的那一顆（IRON_RULES Rule 45）：v6.671。
const BASE_SHA = '7a98371d';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const live = new Set(index.map((e) => e.code));
const pool = new Map(); const fileOf = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) { pool.set(String(c.id), c); fileOf.set(String(c.id), f.slice(0, -5)); all.push(c); }
}
const setMap = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));
const M7 = JSON.parse(readFileSync(join(dir, 'M7.json'), 'utf8'));
const id = (name) => String(M7.find((c) => c.name === name)?.id);

console.log('【A】資料');
ok('A1 M7 共 78 張、id 20128～20205 連號、全部 J 標', M7.length === 78 && M7.every((c, i) => String(c.id) === String(20128 + i) && c.regulationMark === 'J'), M7.length);
ok('A2 每張都在現役卡池、檔案 M7、card-set-map 指向 M7', M7.every((c) => pool.has(String(c.id)) && fileOf.get(String(c.id)) === 'M7' && setMap[String(c.id)] === 'M7'));
const e7 = index.find((e) => e.code === 'M7');
const cnt = {}; for (const c of M7) cnt[c.supertype] = (cnt[c.supertype] ?? 0) + 1;
ok('A3 index.json：M7 張數三欄＝實際檔案、發售日 2026-12-04、標記 J', !!e7 && e7.cardCount === 78 && e7.count === 78 && e7.releaseDate === '2026-12-04'
  && JSON.stringify(Object.entries(e7.supertypeCounts).sort()) === JSON.stringify(Object.entries(cnt).sort()), JSON.stringify(e7));
for (const p of ['src/lib/cards/regulation.ts', 'scripts/regulation.js']) {
  ok(`A4 ${p} 有 M7: 'J'`, /\bM7:\s*'J'/.test(readFileSync(join(ROOT, p), 'utf8')));
}

const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const KANJI = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {}; for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(KANJI)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;
const SPECIAL = String(all.find((c) => c.name === '薄霧能量')?.id);
const PLAIN = all.filter((c) => HIJ(c) && c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && !/ex$/.test(c.name)).sort((a, b) => b.hp - a.hp)[0];
// 靶：合成卡（HP 400、無弱點／抵抗、無特性、非 ex／非超級）——量到的就是招式本身的傷害
const TARGET = { ...PLAIN, id: 'v6672-T', name: '測試靶', hp: '400', weakness: null, resistance: null, abilities: [], attacks: [], tags: [] };
pool.set(TARGET.id, TARGET);
// ex 靶：擁有規則的寶可夢（戰鬥體育場不恢復）
const TARGET_EX = all.find((c) => HIJ(c) && c.supertype === 'Pokemon' && c.stage === 'Basic' && /ex$/.test(c.name) && !(c.abilities || []).length && !c.name.includes('超級'));
const NONMEGA_ATK = all.find((c) => HIJ(c) && c.supertype === 'Pokemon' && c.stage === 'Basic' && !c.name.includes('超級') && !(c.abilities || []).length
  && (c.attacks || []).some((a) => Number(a.damage) >= 100 && !a.effect && (a.cost || []).length <= 3));

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6672-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getUsableAbilities } from '${p('src/lib/game/engine')}';\n`
    + `export { TRAINER_EFFECTS, hasAbilityFn, ATTACK_PRE, ATTACK_POST } from '${p('src/lib/game/effects/_shared')}';\n`
    + `export { getEffectivePokemonTypes, isTrainerPendingImplementation } from '${p('src/lib/game/effects')}';\n`
    + `export { getHandActivatableAbilities } from '${p('src/lib/game/engine')}';\n`
    + `export { getAIAction } from '${p('src/lib/game/ai')}';\n`
    + `export * as HCO from '${p('src/lib/game/hand-card-ops')}';\n`
    + `import '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const en = (t) => inst(EID[t] ?? EID.Water);
  const ens = (card, ai) => (card.attacks[ai].cost || []).map(en);
  const mk = (p0 = {}, p1 = {}, x = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: String(PLAIN.id), count: 1 }] }, { name: 'P2', entries: [{ cardId: String(PLAIN.id), count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, activeStadium: null, log: [],
      players: [
        { ...s.players[0], hand: [], deck: Array.from({ length: 8 }, () => inst(PLAIN.id)), discard: [], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)], active: inst(PLAIN.id), ...p0 },
        { ...s.players[1], hand: [], deck: Array.from({ length: 8 }, () => inst(PLAIN.id)), discard: [], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)], active: inst(PLAIN.id), ...p1 },
      ], ...x };
  };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + String(e?.message ?? e).split('\n')[0]; } };
  const act = (st, a) => { const o = M.applyAction(st, a, pool); return o?.state ?? o; };
  const atkIdx = (name, atk) => pool.get(id(name)).attacks.findIndex((a) => a.name === atk);
  const abUsable = (st, iid) => M.getUsableAbilities(st, pool).some((u) => u.iid === iid);

  // ── C 覆蓋 ──
  T('C1', () => {
    const miss = []; let k = 0;
    for (const c of M7) for (const a of c.attacks || []) { if (!a.effect) continue; k++; const key = `${c.name}|${a.name}`; if (!M.ATTACK_PRE.has(key) && !M.ATTACK_POST.has(key)) miss.push(key); }
    return { k, miss: miss.join(',') };
  });
  T('C2', () => ['大食花|酸液陷阱', '列陣兵|團結之陣', '超級路卡利歐Zex|波導探求者', '貓老大|招財進寶', '天然鳥|能量躍遷']
    .filter((x) => { const [pn, an] = x.split('|'); const c = pool.get(id(pn)); const ai = c.abilities.findIndex((a) => a.name === an); return !M.hasAbilityFn(pn, an, ai); }).join(','));
  T('C3', () => M7.filter((c) => c.supertype === 'Trainer' && c.subtype !== 'Stadium' && M.isTrainerPendingImplementation(c.name, c.subtype)).map((c) => c.name).join(','));

  // ── B1 刺殺利刃 ──
  T('B1', () => {
    const c = pool.get(id('蜥蜴王ex')), ai = atkIdx('蜥蜴王ex', '刺殺利刃');
    const st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }) }, { active: inst(TARGET.id, { status: 'poisoned', secondaryStatus: 'burned' }) });
    return act(st, { type: 'ATTACK', attackIndex: ai }).players[1].active?.damage;
  });
  // ── B2 障眼法 ──
  const blind = (handN) => {
    const ac = NONMEGA_ATK, ai = ac.attacks.findIndex((a) => Number(a.damage) >= 100 && !a.effect && (a.cost || []).length <= 3);
    const fox = inst(id('九尾'), { damage: 100 });
    const st = mk({ active: inst(ac.id, { energyAttached: ens(ac, ai) }) }, { active: fox, hand: Array.from({ length: handN }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)] });
    const r = act(st, { type: 'ATTACK', attackIndex: ai });
    const ko = !r.players[1].active || r.players[1].active.iid !== fox.iid;
    const owed = (r.pendingPrizes?.[0] ?? 0) + (6 - r.players[0].prizes.length) + (r.pendingSelection?.effectKey?.includes('prize') ? 1 : 0);
    return { ko, owed };
  };
  T('B2', () => blind(5));
  T('B2c', () => blind(4));
  // ── B3 增水泵 ──
  const pump = (withBlastoise) => {
    const c = pool.get(id('幾何雪花')), ai = atkIdx('幾何雪花', '冰雹');
    const bench = withBlastoise ? [inst(id('水箭龜'))] : [];
    const victim = inst(TARGET.id);
    const st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }), bench }, { active: inst(TARGET.id), bench: [victim] });
    const r = act(st, { type: 'ATTACK', attackIndex: ai });
    return r.players[1].bench.find((b) => b.iid === victim.iid)?.damage;
  };
  T('B3', () => ({ yes: pump(true), no: pump(false) }));
  // ── B4 超級護身 ──
  const shield = (mega) => {
    const ac = mega ? pool.get(id('超級阿勃梭魯Zex')) : NONMEGA_ATK;
    const ai = mega ? atkIdx('超級阿勃梭魯Zex', '血紅恐懼') : ac.attacks.findIndex((a) => Number(a.damage) >= 100 && !a.effect && (a.cost || []).length <= 3);
    const st = mk({ active: inst(ac.id, { energyAttached: ens(ac, ai) }) }, { active: inst(id('象徵鳥ex')) });
    return act(st, { type: 'ATTACK', attackIndex: ai }).players[1].active?.damage;
  };
  T('B4', () => ({ mega: shield(true), plain: shield(false) }));
  // ── B5 血紅恐懼 ──
  T('B5', () => {
    const c = pool.get(id('超級阿勃梭魯Zex')), ai = atkIdx('超級阿勃梭魯Zex', '血紅恐懼');
    const sp = inst(SPECIAL), basic = inst(EID.Water), stad = inst(id('戰鬥體育場'));
    let st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }) }, { active: inst(TARGET.id), hand: [sp, basic, stad] });
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    if (st.activePlayerIndex === 0) st = act(st, { type: 'END_TURN' });
    if (st.activePlayerIndex !== 1) return 'turn?';
    st = { ...st, turnPhase: 'main' };
    const tgt = st.players[1].active.iid;
    const a1 = act(st, { type: 'ATTACH_ENERGY', energyIid: sp.iid, targetIid: tgt });
    const a2 = act(st, { type: 'ATTACH_ENERGY', energyIid: basic.iid, targetIid: tgt });
    const a3 = act(st, { type: 'PLAY_TRAINER', iid: stad.iid });
    return { special: a1.players[1].hand.some((h) => h.iid === sp.iid), basic: a2.players[1].hand.some((h) => h.iid === basic.iid), stadium: a3.players[1].hand.some((h) => h.iid === stad.iid) };
  });
  // ── B6 二連打 ──
  T('B6', () => {
    const c = pool.get(id('巴布土撥')), ai = atkIdx('巴布土撥', '音速伏特');
    let st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }) }, { active: inst(TARGET.id) });
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    const d1 = st.players[1].active?.damage, pend = !!st.festivalDancePendingSecondAttack;
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    return { d1, pend, d2: st.players[1].active?.damage };
  });
  // ── B7 酸液陷阱 ──
  const acid = (stadium) => {
    const holder = inst(id('大食花'));
    const st = mk({ bench: [holder] }, {}, stadium ? { activeStadium: inst(id('戰鬥體育場')), activeStadiumOwnerIdx: 0 } : {});
    const usable = abUsable(st, holder.iid);
    if (!usable) return { usable };
    const r = act(st, { type: 'USE_ABILITY', iid: holder.iid, abilityIndex: 0 });
    const a = r.players[1].active; const ss = [a.status, a.secondaryStatus, a.tertiaryStatus];
    return { usable, poison: ss.includes('poisoned'), burn: ss.includes('burned') };
  };
  T('B7', () => ({ yes: acid(true), no: acid(false) }));
  // ── B8 招財進寶 ──
  const coin = (meowths) => {
    const holder = inst(id('貓老大'));
    const st = mk({ active: holder, bench: Array.from({ length: meowths }, () => inst(id('喵喵'))) });
    const usable = abUsable(st, holder.iid);
    if (!usable) return { usable };
    const r = act(st, { type: 'USE_ABILITY', iid: holder.iid, abilityIndex: 0 });
    return { usable, drew: r.players[0].hand.length };
  };
  T('B8', () => ({ two: coin(2), one: coin(1) }));
  // ── B9 團結之陣 ──
  T('B9', () => {
    const holder = inst(id('列陣兵')), b1 = inst(id('列陣兵')), b2 = inst(id('列陣兵')), other = inst(PLAIN.id);
    const es = [inst(EID.Fighting), inst(EID.Fighting), inst(EID.Fighting)];
    let st = mk({ active: holder, bench: [b1, b2, other], deck: [...es, inst(PLAIN.id)] });
    if (!abUsable(st, holder.iid)) return 'not-usable';
    st = act(st, { type: 'USE_ABILITY', iid: holder.iid, abilityIndex: 0 });
    if (st.pendingSelection?.type !== 'deck-search') return 'no-pending ' + st.pendingSelection?.type;
    st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: [es[0].iid, es[1].iid], pendingToken: st.pendingSelection.token });
    const e = (iid) => st.players[0].bench.find((b) => b.iid === iid)?.energyAttached.length;
    return { b1: e(b1.iid), b2: e(b2.iid), other: e(other.iid), deck: st.players[0].deck.length };
  });
  // ── B10 戰鬥體育場 ──
  T('B10', () => {
    const plainHurt = inst(PLAIN.id, { damage: 30 }), exHurt = inst(TARGET_EX.id, { damage: 30 });
    const st = mk({ active: plainHurt, bench: [exHurt] }, {}, { activeStadium: inst(id('戰鬥體育場')), activeStadiumOwnerIdx: 1 });
    const r = act(st, { type: 'USE_STADIUM' });
    const st2 = mk({ active: inst(PLAIN.id), bench: [inst(TARGET_EX.id, { damage: 30 })] }, {}, { activeStadium: inst(id('戰鬥體育場')), activeStadiumOwnerIdx: 0 });
    const r2 = act(st2, { type: 'USE_STADIUM' });
    return { plain: r.players[0].active.damage, ex: r.players[0].bench[0].damage, usedNoTarget: !!(r2.stadiumUsedThisTurn ?? [])[0] };
  });
  // ── B11 吉憲的熱血 ──
  T('B11', () => {
    const tr = inst(id('吉憲的熱血')), sq = inst(id('傑尼龜'), { energyAttached: [inst(EID.Water)] });
    let st = mk({ hand: [tr], bench: [sq], deck: [] });
    st = act(st, { type: 'PLAY_TRAINER', iid: tr.iid });
    if (!st.pendingSelection) return 'no-pending';
    st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: [sq.iid], pendingToken: st.pendingSelection.token });
    return { bench: st.players[0].bench.length, deck: st.players[0].deck.length };
  });
  // ── B12 記者 ──
  T('B12', () => {
    const tr = inst(id('記者'));
    let st = mk({ hand: [tr] }, { hand: [inst(PLAIN.id)] });
    st = act(st, { type: 'PLAY_TRAINER', iid: tr.iid });
    const drew = st.players[0].hand.length, k1 = st.pendingSelection?.effectKey;
    st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: [], pendingToken: st.pendingSelection?.token });
    return { drew, k1, k2: st.pendingSelection?.effectKey, src2: st.pendingSelection?.sourcePlayerIdx };
  });
  // ── B13 可爾妮的全力 ──
  const korrina = (mega) => {
    const ac = mega ? pool.get(id('超級阿勃梭魯Zex')) : NONMEGA_ATK;
    const ai = mega ? atkIdx('超級阿勃梭魯Zex', '血紅恐懼') : ac.attacks.findIndex((a) => Number(a.damage) >= 100 && !a.effect && (a.cost || []).length <= 3);
    const tr = inst(id('可爾妮的全力'));
    let st = mk({ active: inst(ac.id, { energyAttached: ens(ac, ai) }), hand: [tr] }, { active: inst(TARGET.id), prizes: [inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)] });
    st = act(st, { type: 'PLAY_TRAINER', iid: tr.iid });
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    return { dmg: st.players[1].active?.damage, base: Number(ac.attacks[ai].damage) };
  };
  T('B13', () => ({ mega: korrina(true), plain: korrina(false) }));
  // ── B14 水流連打 ──
  const flow = (pay) => {
    const c = pool.get(id('連擊武道熊師')), ai = atkIdx('連擊武道熊師', '水流連打');
    const w = inst(EID.Water);
    const v = inst(TARGET.id);
    let st = mk({ active: inst(c.id, { energyAttached: [...ens(c, ai), w] }) }, { active: inst(TARGET.id), bench: [v] });
    st = act(st, { type: 'ATTACK', attackIndex: ai, discardedEnergyIids: pay ? [w.iid] : [] });
    return { bench: st.players[1].bench.find((b) => b.iid === v.iid)?.damage, active: st.players[1].active?.damage, waterLeft: st.players[0].active?.energyAttached.some((e) => e.iid === w.iid) };
  };
  T('B14', () => ({ pay: flow(true), skip: flow(false) }));
  // ── B15 振奮聲援 ──
  const cheer = (withHawlucha) => {
    const c = pool.get(id('戰舞郎')), ai = atkIdx('戰舞郎', '奮勇戰鬥');
    const st = mk({ active: inst(c.id, { energyAttached: [inst(EID.Fighting)] }), bench: withHawlucha ? [inst(id('摔角鷹人'))] : [] }, { active: inst(TARGET.id) });
    return act(st, { type: 'ATTACK', attackIndex: ai }).players[1].active?.damage;
  };
  T('B15', () => ({ yes: cheer(true), no: cheer(false) }));
  // ── B16 能量躍遷 ──
  T('B16', () => {
    // 完整流程：從手牌進化（天然雀 → 天然鳥）→ 詢問是否使用 → 選對手手牌的能量 → 選對手的寶可夢
    const natu = inst(id('天然雀')), bird = inst(id('天然鳥')), e = inst(EID.Fire);
    let st = mk({ bench: [natu], hand: [bird] }, { hand: [e, inst(PLAIN.id)] });
    st = act(st, { type: 'EVOLVE', fromIid: natu.iid, toIid: bird.iid });
    if (st.pendingSelection?.effectKey === 'resolve-play-ability-prompt') {
      st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: ['yes'], pendingToken: st.pendingSelection.token });
    }
    if (st.pendingSelection?.effectKey !== 'm7-energy-leap-pick') return 'p1 ' + st.pendingSelection?.effectKey;
    st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: [e.iid], pendingToken: st.pendingSelection.token });
    const tgt = st.players[1].active.iid;
    st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: [tgt], pendingToken: st.pendingSelection?.token });
    return { attached: st.players[1].active.energyAttached.some((x) => x.iid === e.iid), inHand: st.players[1].hand.some((x) => x.iid === e.iid) };
  });
  // ── B17 雙重屬性／同步之軀 ──
  T('B17', () => {
    const tog = inst(id('托戈德瑪爾ex'));
    const st = mk({ active: tog });
    const kec = inst(id('變隱龍'));
    const st2 = mk({ active: kec, bench: [inst(id('傑尼龜'))] });
    return { tog: M.getEffectivePokemonTypes(st, 0, tog, pool.get(id('托戈德瑪爾ex')), pool).sort().join('+'),
      kec: M.getEffectivePokemonTypes(st2, 0, kec, pool.get(id('變隱龍')), pool).sort().join('+') };
  });
  // ── B18 牽絆披帶 ──
  const sash = (mega) => {
    const ac = NONMEGA_ATK, ai = ac.attacks.findIndex((a) => Number(a.damage) >= 100 && !a.effect && (a.cost || []).length <= 3);
    const holderCard = mega ? pool.get(id('超級路卡利歐Zex')) : PLAIN;
    const holder = inst(holderCard.id, { damage: Number(holderCard.hp) - 10, toolAttached: inst(id('牽絆披帶')) });
    const st = mk({ active: inst(ac.id, { energyAttached: ens(ac, ai) }) }, { active: holder, bench: [inst(PLAIN.id)] });
    const r = act(st, { type: 'ATTACK', attackIndex: ai });
    const q = [r.pendingSelection, ...(r.pendingChainQueue ?? [])].filter(Boolean);
    return { ko: r.players[1].active?.iid !== holder.iid, search: q.some((x) => x.effectKey === 'search-to-hand-reshuffle' && x.actorIdx === 1) };
  };
  T('B18', () => ({ mega: sash(true), plain: sash(false) }));
  // ── B19 毒晶寶石 ──
  T('B19', () => {
    const c = pool.get(id('超級晶光花ex')), ai = atkIdx('超級晶光花ex', '毒晶寶石');
    const a = inst(TARGET.id), b = inst(TARGET.id);
    let st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }) }, { active: a, bench: [b] });
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    if (!st.pendingSelection) return 'no-pending';
    st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: [a.iid, b.iid], pendingToken: st.pendingSelection.token });
    const hp = Number(TARGET.hp);
    const rem = (iid) => { const x = [st.players[1].active, ...st.players[1].bench].find((y) => y?.iid === iid); return x ? hp - x.damage : null; };
    return { a: rem(a.iid), b: rem(b.iid) };
  });
  // ── B20 超音波幼蟲｜震顫翅（不放置型手牌特性；test-v6200 指名本段）──
  const HAND_NOPLACE_FIXTURE = {};
  HAND_NOPLACE_FIXTURE['超音波幼蟲'] = (deckN) => {
    const c = inst(id('超音波幼蟲'));
    return { st: mk({ hand: [c], deck: Array.from({ length: deckN }, () => inst(PLAIN.id)) }), c };
  };
  T('B20', () => {
    const { st, c } = HAND_NOPLACE_FIXTURE['超音波幼蟲'](3);
    const set = M.HCO?.getHandCardOps?.(st, 0, pool, { isMyTurn: true })?.get(c.iid);
    const op = set ? M.HCO.handOpForDropTarget(set, 'playmat') : null;
    const meta = (M.getHandActivatableAbilities(st, 0, pool) ?? []).find((a) => a.iid === c.iid);
    const r = act(st, { type: 'USE_HAND_ABILITY', cardIid: c.iid, abilityIndex: meta?.abilityIndex ?? 0 });
    const bad = HAND_NOPLACE_FIXTURE['超音波幼蟲'](0);
    const setBad = M.HCO?.getHandCardOps?.(bad.st, 0, pool, { isMyTurn: true })?.get(bad.c.iid);
    const rBad = act(bad.st, { type: 'USE_HAND_ABILITY', cardIid: bad.c.iid, abilityIndex: 0 });
    return { op, places: meta?.placesToBench, discarded: r.players[0].discard.some((d) => d.iid === c.iid), bench: r.players[0].bench.length,
      view: r.pendingSelection?.type, deck: r.players[0].deck.length,
      badOp: !!setBad?.has('hand-ability-use'), badHand: rBad.players[0].hand.length };
  });
  // ── B21 障眼法 × 奇跡之吻（寶可夢檢查的昏厥；審查 P2-1）──
  const kiss = (handN) => {
    const fox = inst(id('九尾'), { damage: 100, status: 'poisoned' });
    let st = mk({ bench: [inst('11227')] }, { active: fox, hand: Array.from({ length: handN }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)] });
    const orig = Math.random; Math.random = () => 0.1;
    try { st = act(st, { type: 'END_TURN' }); } finally { Math.random = orig; }
    const ko = !st.players[1].active || st.players[1].active.iid !== fox.iid;
    return { ko, got: 6 - st.players[0].prizes.length + (st.pendingPrizes?.[0] ?? 0), leak: st._blindKoNoPrize !== undefined };
  };
  T('B21', () => ({ blind: kiss(5), plain: kiss(4) }));
  // ── B29 障眼法 × 奇跡之吻（混亂自傷昏厥；走 per-action 記號那條路）──
  const confused = (handN) => {
    const fc = pool.get(id('九尾')), ai = atkIdx('九尾', '灼燒');
    const fox = inst(fc.id, { damage: 80, status: 'confused', energyAttached: ens(fc, ai) });
    let st = mk({ active: fox, bench: [inst(PLAIN.id)], hand: Array.from({ length: handN }, () => inst(PLAIN.id)) }, { bench: [inst('11227')] });
    const seq = [0.9, 0.1, 0.1, 0.1]; let k = 0;   // 混亂擲幣反面 → 自傷昏厥；奇跡之吻正面
    const orig = Math.random; Math.random = () => seq[Math.min(k++, seq.length - 1)];
    try { st = act(st, { type: 'ATTACK', attackIndex: ai }); } finally { Math.random = orig; }
    return { ko: st.players[0].active?.iid !== fox.iid, got: 6 - st.players[1].prizes.length + (st.pendingPrizes?.[1] ?? 0) };
  };
  T('B29', () => ({ blind: confused(5), plain: confused(4) }));
  // ── B30 同名同招不同印刷：喵喵｜聚寶功（M7 10／M6a 30）各打自己卡面的傷害、都抽 1 ──
  T('B30', () => {
    const run = (cid) => {
      const c = pool.get(cid), ai = c.attacks.findIndex((a) => a.name === '聚寶功');
      const st = mk({ active: inst(cid, { energyAttached: ens(c, ai) }) }, { active: inst(TARGET.id) });
      const r = act(st, { type: 'ATTACK', attackIndex: ai });
      return { dmg: r.players[1].active?.damage, hand: r.players[0].hand.length };
    };
    return { m7: run(id('喵喵')), m6a: run('20004') };
  });
  // ── B22 障眼法 × KO 時多拿獎賞的招式（審查 P2-2）──
  T('B22', () => {
    const ac = pool.get('11579'); if (!ac) return 'no-card';
    const ai = ac.attacks.findIndex((a) => a.name === '感激放大');
    const run = (handN) => {
      const fox = inst(id('九尾'), { damage: 100 });
      const st = mk({ active: inst(ac.id, { energyAttached: ens(ac, ai) }) }, { active: fox, hand: Array.from({ length: handN }, () => inst(PLAIN.id)), bench: [inst(PLAIN.id)] });
      const r = act(st, { type: 'ATTACK', attackIndex: ai });
      return 6 - r.players[0].prizes.length + (r.pendingPrizes?.[0] ?? 0);
    };
    return { blind: run(5), plain: run(4) };
  });
  // ── B23 潛入補給：送 3 張基本【鋼】能量只附 1 張（中央消毒去重＋夾上限；審查 P2-3）──
  T('B23', () => {
    const c = pool.get(id('拖拖蚓')), ai = atkIdx('拖拖蚓', '潛入補給');
    const me = inst(c.id, { energyAttached: ens(c, ai) });
    const m = [inst(EID.Metal), inst(EID.Metal), inst(EID.Metal)];
    let st = mk({ active: me, bench: [inst(PLAIN.id)], discard: m }, { active: inst(TARGET.id) });
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    // 依序解：換位選備戰 → 選棄牌區的鋼能量（送 3 張＋重複）→ 能量鏈選目標（只能是自己）
    const seen = [];
    for (let k = 0; k < 5 && st.pendingSelection && st.pendingSelection.actorIdx === 0; k++) {
      const pd = st.pendingSelection; seen.push(pd.type + ':' + pd.effectKey);
      let sel;
      if (pd.type === 'discard-search') sel = [m[0].iid, m[0].iid, m[1].iid, m[2].iid];
      else { const vi = pd.params?.validIids ?? pd.params?.targetIids ?? st.players[0].bench.map((b) => b.iid); sel = vi.includes(me.iid) ? [me.iid] : vi.slice(0, 1); }
      st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: sel, pendingToken: pd.token });
    }
    out.B23seen = seen.join(' > ');
    const mine = [st.players[0].active, ...st.players[0].bench].find((x) => x?.iid === me.iid);
    return { onBench: st.players[0].bench.some((b) => b.iid === me.iid), metal: mine ? mine.energyAttached.filter((e) => m.some((x) => x.iid === e.iid)).length : -1, left: st.players[0].discard.filter((d) => m.some((x) => x.iid === d.iid)).length };
  });
  // ── B24 沙漠之風：放回對手牌庫（dest 'deck'）、送 3 個只收 2 個（審查 P2-3、P3-1）──
  T('B24', () => {
    const c = pool.get(id('沙漠蜻蜓')), ai = atkIdx('沙漠蜻蜓', '沙漠之風');
    const es = [inst(EID.Water), inst(EID.Fire), inst(EID.Grass)];
    let st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }) }, { active: inst(TARGET.id, { energyAttached: es }) });
    const deck0 = st.players[1].deck.length;
    st = act(st, { type: 'ATTACK', attackIndex: ai, discardedEnergyIids: ['yes'] });
    for (let k = 0; k < 3 && st.pendingSelection && st.pendingSelection.actorIdx === 0; k++) {
      const pd = st.pendingSelection;
      const sel = pd.effectKey === 'discard-opp-active-energy-pick' ? es.map((e) => e.iid) : (pd.type === 'modal-choice' ? ['yes'] : []);
      st = act(st, { type: 'RESOLVE_SELECTION', selectedIids: sel, pendingToken: pd.token });
    }
    return { left: st.players[1].active.energyAttached.length, deck: st.players[1].deck.length - deck0, discard: st.players[1].discard.length };
  });
  // ── B25 熱血頭擊（「這個情況下」手牌揭示型）：不給看 20、給看 1 張 140、送 2 張仍只算 1 張 ──
  T('B25', () => {
    const c = pool.get(id('沼王')), ai = atkIdx('沼王', '熱血頭擊');
    const run = (pick) => {
      const h = [inst(id('吉憲的熱血')), inst(id('吉憲的熱血'))];
      const st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }), hand: h }, { active: inst(TARGET.id) });
      return act(st, { type: 'ATTACK', attackIndex: ai, discardedEnergyIids: h.slice(0, pick).map((x) => x.iid) }).players[1].active?.damage;
    };
    return { none: run(0), one: run(1), two: run(2) };
  });
  // ── B26 增水泵：兩隻水箭龜仍只 +30、不加到戰鬥寶可夢 ──
  T('B26', () => {
    const c = pool.get(id('幾何雪花')), ai = atkIdx('幾何雪花', '冰雹');
    const v = inst(TARGET.id), a = inst(TARGET.id);
    const st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }), bench: [inst(id('水箭龜')), inst(id('水箭龜'))] }, { active: a, bench: [v] });
    const base = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }) }, { active: inst(TARGET.id), bench: [inst(TARGET.id)] });
    const r = act(st, { type: 'ATTACK', attackIndex: ai }), r0 = act(base, { type: 'ATTACK', attackIndex: ai });
    return { bench: r.players[1].bench.find((b) => b.iid === v.iid)?.damage, active: r.players[1].active?.damage, active0: r0.players[1].active?.damage };
  });
  // ── B27 血紅恐懼的鎖只到對手那個回合結束（再下一個對手回合可以附特殊能量）──
  T('B27', () => {
    const c = pool.get(id('超級阿勃梭魯Zex')), ai = atkIdx('超級阿勃梭魯Zex', '血紅恐懼');
    const sp = inst(SPECIAL);
    let st = mk({ active: inst(c.id, { energyAttached: ens(c, ai) }) }, { active: inst(TARGET.id), hand: [sp] });
    st = act(st, { type: 'ATTACK', attackIndex: ai });
    if (st.activePlayerIndex === 0) st = act(st, { type: 'END_TURN' });
    st = act({ ...st, turnPhase: 'main' }, { type: 'END_TURN' });   // 對手（被鎖）的回合結束
    st = act({ ...st, turnPhase: 'main' }, { type: 'END_TURN' });   // 我方回合結束
    if (st.activePlayerIndex !== 1) return 'turn?';
    st = { ...st, turnPhase: 'main', players: [st.players[0], { ...st.players[1], hand: [...st.players[1].hand.filter((h) => h.iid !== sp.iid), sp], energyAttachedThisTurn: false }] };
    const r = act(st, { type: 'ATTACH_ENERGY', energyIid: sp.iid, targetIid: st.players[1].active.iid });
    return { attached: !r.players[1].hand.some((h) => h.iid === sp.iid) };
  });
  // ── B28 AI：被血紅恐懼鎖住時不會送出「附特殊能量」（審查 P2-5）──
  T('B28', () => {
    const sp = inst(SPECIAL);
    const st = mk({ active: inst(PLAIN.id), hand: [sp], cantAttachSpecialEnergyFromHandThisTurn: true });
    const a = M.getAIAction(st, pool, 0);
    const st2 = mk({ active: inst(PLAIN.id), hand: [sp] });
    const a2 = M.getAIAction(st2, pool, 0);
    return { locked: a?.type === 'ATTACH_ENERGY' && a.energyIid === sp.iid, free: a2?.type === 'ATTACH_ENERGY' && a2.energyIid === sp.iid };
  });
  return out;
}

const LABEL = {
  C1: '★★★ C1 M7 有效果的招式全部以「卡名|招式名」註冊',
  C2: '★★★ C2 M7 五個主動特性都已以卡名註冊',
  C3: '★★★ C3 M7 物品／支援者／道具都有效果（不會 fail-closed 打不出來）',
  B1: '★★ B1 刺殺利刃：對手中毒＋灼傷 ⇒ 260',
  B2: '★★★ B2 障眼法：手牌剛好 5 張 ⇒ 九尾被打倒，對手拿不到獎賞卡',
  B2c: '★ B2c 正對照：手牌 4 張 ⇒ 照常拿獎賞',
  B3: '★★★ B3 增水泵：備戰 20 → 50；沒有水箭龜 20',
  B4: '★★★ B4 超級護身：超級進化寶可夢ex 的招式傷害 0；非超級照常',
  B5: '★★★ B5 血紅恐懼：下個對手的回合特殊能量、競技場都留在手牌；基本能量照常附上',
  B6: '★★★ B6 二連打：同一招可以使用第 2 次（100 → 200）',
  B7: '★★★ B7 酸液陷阱：有自己的競技場 ⇒ 中毒＋灼傷；沒有 ⇒ 不給按鈕',
  B8: '★★★ B8 招財進寶：2 隻「聚寶功」⇒ 抽 2；1 隻 ⇒ 不給按鈕',
  B9: '★★★ B9 團結之陣：備戰 2 隻列陣兵各 1 張、其他寶可夢 0、牌庫重洗少 2 張',
  B10: '★★★ B10 戰鬥體育場：非規則寶可夢 30 → 10、ex 不變；沒有可恢復的 ⇒ 使用權退回',
  B11: '★★★ B11 吉憲的熱血：備戰傑尼龜連同 1 張能量放回牌庫（牌庫 2 張）',
  B12: '★★★ B12 記者：抽 2、先查看對手手牌、再查看對手牌庫上方 1 張',
  B13: '★★★ B13 可爾妮的全力：對手已獲得 3 張 ⇒ 超級進化ex 160+60；非超級不加',
  B14: '★★★ B14 水流連打：付【水】能量 ⇒ 備戰 40；不付 ⇒ 0（站長裁定「這個情況下」）',
  B15: '★★★ B15 振奮聲援：戰舞郎 1 個【鬥】能量就能使出奮勇戰鬥（60）；沒有摔角鷹人 ⇒ 使不出',
  B16: '★★★ B16 能量躍遷：對手手牌的能量卡附到對手的戰鬥寶可夢身上',
  B17: '★★★ B17 托戈德瑪爾ex＝雷＋鋼；變隱龍＝無＋水',
  B18: '★★★ B18 牽絆披帶：超級進化ex 被打倒 ⇒ 持有方牌庫任意選 1 張；非超級 ⇒ 沒有',
  B19: '★★★ B19 毒晶寶石：對手 2 隻寶可夢剩餘 HP 都是 60',
  B21: '★★★ B21 障眼法 × 奇跡之吻（寶可夢檢查昏厥）：手牌 5 張 ⇒ 正面也不加獎賞；4 張 ⇒ 1＋1（正對照）；記號不外洩',
  B29: '★★★ B29 障眼法 × 奇跡之吻（混亂自傷昏厥）：手牌 5 張 ⇒ 0；4 張 ⇒ 1＋1（正對照）',
  B30: '★★ B30 喵喵｜聚寶功 同名不同印刷：M7 打 10、M6a 打 30，都抽 1',
  B22: '★★★ B22 障眼法 × 感激放大：手牌 5 張 ⇒ 0；4 張 ⇒ 1＋1＝2（正對照）',
  B23: '★★★ B23 潛入補給：換到備戰、送 3 張（含重複）基本【鋼】只附 1 張',
  B24: '★★★ B24 沙漠之風：送 3 個只放回 2 個、進對手牌庫（不是棄牌區）',
  B25: '★★★ B25 熱血頭擊：不給看 20、給看 1 張 140、送 2 張仍是 140',
  B26: '★★ B26 增水泵：兩隻水箭龜備戰仍 50（不重複）、戰鬥寶可夢不加',
  B27: '★★ B27 血紅恐懼的鎖只到對手那個回合結束',
  B28: '★★★ B28 AI 被鎖住時不送「附特殊能量」；沒鎖時會附（正對照）',
  B20: '★★★ B20 震顫翅：拖到桌墊發動、這張卡進棄牌區、不上備戰、看牌庫上方 1 張；牌庫 0 張 ⇒ 不能發動',
};
const judge = (r) => ({
  C1: r.C1?.k >= 40 && r.C1.miss === '',
  C2: r.C2 === '',
  C3: r.C3 === '',
  B1: r.B1 === 260,
  B2: r.B2?.ko === true && r.B2.owed === 0,
  B2c: r.B2c?.ko === true && r.B2c.owed >= 1,
  B3: r.B3?.yes === 50 && r.B3.no === 20,
  B4: r.B4?.mega === 0 && r.B4.plain > 0,
  B5: r.B5?.special === true && r.B5.stadium === true && r.B5.basic === false,
  B6: r.B6?.d1 === 100 && r.B6.pend === true && r.B6.d2 === 200,
  B7: r.B7?.yes?.usable === true && r.B7.yes.poison && r.B7.yes.burn && r.B7.no?.usable === false,
  B8: r.B8?.two?.usable === true && r.B8.two.drew === 2 && r.B8.one?.usable === false,
  B9: r.B9?.b1 === 1 && r.B9.b2 === 1 && r.B9.other === 0 && r.B9.deck === 2,
  B10: r.B10?.plain === 10 && r.B10.ex === 30 && r.B10.usedNoTarget === false,
  B11: r.B11?.bench === 0 && r.B11.deck === 2,
  B12: r.B12?.drew === 2 && r.B12.k1 === 'peek-opp-hand-view-only' && r.B12.k2 === 'reorder-deck-top-apply' && r.B12.src2 === 1,
  B13: r.B13?.mega?.dmg === 220 && r.B13.plain?.dmg === r.B13.plain?.base,
  B14: r.B14?.pay?.bench === 40 && r.B14.pay.waterLeft === false && r.B14.skip?.bench === 0 && r.B14.skip.waterLeft === true,
  B15: r.B15?.yes === 60 && r.B15.no === 0,
  B16: r.B16?.attached === true && r.B16.inHand === false,
  B17: r.B17?.tog === 'Lightning+Metal' && r.B17.kec === 'Colorless+Water',
  B18: r.B18?.mega?.ko === true && r.B18.mega.search === true && r.B18.plain?.ko === true && r.B18.plain.search === false,
  B19: r.B19?.a === 60 && r.B19.b === 60,
  B21: r.B21?.blind?.ko === true && r.B21.blind.got === 0 && r.B21.blind.leak === false && r.B21.plain?.ko === true && r.B21.plain.got === 2,
  B29: r.B29?.blind?.ko === true && r.B29.blind.got === 0 && r.B29.plain?.ko === true && r.B29.plain.got === 2,
  B30: r.B30?.m7?.dmg === 10 && r.B30.m7.hand === 1 && r.B30.m6a?.dmg === 30 && r.B30.m6a.hand === 1,
  B22: r.B22?.blind === 0 && r.B22.plain === 2,
  B23: r.B23?.onBench === true && r.B23.metal === 1 && r.B23.left === 2,
  B24: r.B24?.left === 1 && r.B24.deck === 2 && r.B24.discard === 0,
  B25: r.B25?.none === 20 && r.B25.one === 140 && r.B25.two === 140,
  B26: r.B26?.bench === 50 && r.B26.active === r.B26.active0,
  B27: r.B27?.attached === true,
  B28: r.B28?.locked === false && r.B28.free === true,
  B20: r.B20?.op === 'hand-ability-use' && r.B20.places === false && r.B20.discarded === true && r.B20.bench === 1 && r.B20.view === 'reorder-deck-top'
    && r.B20.deck === 3 && r.B20.badOp === false && r.B20.badHand === 1,
});
const POSITIVE = ['B2c', 'B27', 'B30'];   // B27：BASE 沒有鎖 ⇒ 本來就附得上   // 正對照：BASE 也必須綠

console.log('\n【B】效果實跑');
ok('B0 harness 前置：靶／ex 靶／非超級攻擊方／特殊能量都找得到', !!TARGET && !!TARGET_EX && !!NONMEGA_ATK && !!PLAIN && SPECIAL !== 'undefined', `${TARGET?.name} ${TARGET_EX?.name} ${NONMEGA_ATK?.name}`);
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【D】同版一起收的官方新印刷 19 張＋既有資料逐字未動（BASE blob）');
{
  // 卡圖實印（2026-11-26 逐張看過 mark-montage）：M-P 234～245 印 J、246～248 基本能量印 PROMO 無標（比照既有特典基本能量收 M-P-J）；M6a 四張印 J
  const EX = [...V6672_EXTRA_IDS['M-P-J'].map((x) => [x, 'M-P-J']), ...V6672_EXTRA_IDS['M6a'].map((x) => [x, 'M6a'])];
  ok('D0 同版新增 19 張（M-P-J 15＋M6a 4）', EX.length === 19, EX.length);
  ok('D1 19 張都在現役卡池、J 標、檔案／setCode／card-set-map 一致', EX.every(([x, code]) => { const c = pool.get(x); return !!c && c.regulationMark === 'J' && fileOf.get(x) === code && setMap[x] === code && c.setCode === code; }),
    JSON.stringify(EX.filter(([x, code]) => { const c = pool.get(x); return !(c && c.regulationMark === 'J' && fileOf.get(x) === code && setMap[x] === code && c.setCode === code); })));
  ok('D1b M-P 超級路卡利歐Zex 從利歐路進化（ex 不從同名非 ex）、波導探求者以卡名註冊（C2 同一份）', pool.get('20220')?.evolvesFrom === '利歐路');
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    const rb = (pth) => { const b = readBaseBlob(ROOT, BASE_SHA, pth); if (!b.ok) throw new Error('BASE 缺 ' + pth); return JSON.parse(b.out); };
    for (const code of ['M-P-J', 'M6a']) {
      const b = rb(`static/cards/${code}.json`), c = JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8'));
      ok(`D2 ${code}：BASE 的 ${b.length} 張逐字保留在最前面，尾端正好是本版的 ${V6672_EXTRA_IDS[code].length} 張`,
        JSON.stringify(revertV6672Cards(code, c)) === JSON.stringify(b) && c.length === b.length + V6672_EXTRA_IDS[code].length);
    }
    ok('D3 index.json：拿掉 M7、兩筆張數回 v6.671 後逐字等於 BASE', JSON.stringify(revertV6672Index(index)) === JSON.stringify(rb('static/cards/index.json')));
    let d4 = false, d4x = '';
    try { d4 = JSON.stringify(revertV6672Map(setMap)) === JSON.stringify(rb('static/card-set-map.json')); } catch (e) { d4x = String(e?.message ?? e).split('\n')[0]; }
    ok('D4 card-set-map.json：拿掉本版 97 筆後逐字等於 BASE（鍵順序也一樣）', d4 && V6672_M7_IDS.length === 78, d4x);
    for (const code of ['M-P-J', 'M6a']) {
      const e = index.find((x) => x.code === code), c = JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8'));
      const cn = {}; for (const x of c) cn[x.supertype] = (cn[x.supertype] ?? 0) + 1;
      ok(`D5 index.json ${code} 張數三欄＝實際檔案`, e.cardCount === c.length && e.count === c.length && JSON.stringify(Object.entries(e.supertypeCounts).sort()) === JSON.stringify(Object.entries(cn).sort()));
    }
  } else shallowSkip('v6672 D2～D5', '需要 v6.671 commit');
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6672b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    const reds = [];
    for (const k of Object.keys(LABEL)) {
      if (POSITIVE.includes(k)) ok(`★[H 正對照] v6.671：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
      else { ok(`★★★[H] v6.671：${k} 紅`, BJ[k] === false, JSON.stringify(B[k])); if (BJ[k] === false) reds.push(k); }
    }
    console.log('  （BASE 紅：' + reds.join(' ') + '）');
  } catch (e) { ok('★★★[H] BASE 可打包', false, String(e?.message ?? e).split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6672 H', '需要 v6.671 commit');

console.log(`\n=== v6.672 M7 波導探求者上架：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
