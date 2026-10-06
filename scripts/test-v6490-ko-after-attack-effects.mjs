// ⭐⭐⭐v6.490 守衛：「招式的傷害＋效果全部結束後，才判定昏厥」中央管線（站長回報：狙射樹梟ex｜粉碎箭）
//
// 官方（PTCG RULES/PTCG_RULES.md）：L389「…全部結束後」／L2290「在招式的處理全部結束後…[昏厥]」／
//   L1594-1595 吼叫尾ex｜咬碎丟掉古舊能量並打昏對手 ⇒ 獎賞卡不會減少／L1132-1133 受傷的寶可夢被效果換到備戰區後在備戰區昏厥。
//
// G1 粉碎箭（選擇視窗路徑）：選古舊能量 ⇒ 獎賞 2、古舊旗標不寫；選另一張 ⇒ 獎賞 1、旗標寫入；log 順序「丟棄 → 擊倒」，不再出現「沒有能量」
// G2 吼叫尾ex｜咬碎（官方判例本尊，同步路徑：只有 1 個能量）：獎賞不減少
// G3 推倒（[由對手選擇]）：受傷的寶可夢被換到備戰區後在備戰區昏厥；戰鬥場是對手選的那隻；攻擊方照拿獎賞
// G4 「這個招式讓對手昏厥」的效果（具甲武者｜要害斬）：昏厥才觸發、沒昏厥不觸發
// G5 沒有招式效果的招式：當場結算（_pendingAttackKo 從未出現）
// G6 _pendingAttackKo 不殘留：每個 action 結束且沒有待選視窗時必為 undefined
// G7 中央殭屍判準：sanityKOSweep 不可在選擇視窗還開著時先把受害者用簡化版掃掉（行為面：G1 選水時仍是 1 張）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6490-s.mjs'), E = join(ROOT, '.v6490-e.ts'), O = join(ROOT, '.v6490-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const need = (id, name) => { assert.equal(pool.get(id)?.name, name, `fixture：${id} 應為 ${name}`); return id; };
const DECIDUEYE = need('17989', '狙射樹梟ex'), KOKO = need('12116', '卡璞・鳴鳴ex'), ANC = need('17212', '古舊能量');
const ROAR = need('16824', '吼叫尾ex'), CACNEA = need('13698', '沙鈴仙人掌'), RAMPARDOS = need('19186', '頭蓋龍');
const SAMUROTT = need('18446', '具甲武者');
const GRASS = '14102', W = '18519', DEF = '13163';
const anyBasicEnergy = (t) => [...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name === `基本【${t}】能量`)?.id;
const PSY = String(anyBasicEnergy('超')), FIGHT = String(anyBasicEnergy('鬥')), WATER = String(anyBasicEnergy('水'));
let nn = 0; const inst = (cid, x = {}) => ({ iid: 'v90_' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function board(p0, p1) {
  const s = createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5, log: [],
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(DEF), inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), bench: [], ...p0 },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), bench: [inst(KOKO)], ...p1 }] };
}
const noLinger = (s, tag) => { if (!s.pendingSelection) assert.equal(s._pendingAttackKo, undefined, `${tag}：_pendingAttackKo 殘留`); };
const taken = (s) => 6 - s.players[0].prizes.length;
const resolve = (s, who, ids) => applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: who, actorIdx: who, effectKey: s.pendingSelection.effectKey, selectedIids: ids }, pool);

console.log('── G1 粉碎箭（選擇視窗路徑）──');
function shatter(pick) {
  const anc = inst(ANC), water = inst(W);
  let s = board({ active: inst(DECIDUEYE, { energyAttached: [inst(GRASS), inst(GRASS), inst(GRASS), inst(GRASS)] }) },
                { active: inst(KOKO, { energyAttached: [anc, water] }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(s.pendingSelection?.effectKey, 'shatter-arrow-discard', '前置：應開能量選擇');
  assert.equal(taken(s), 0, '選擇能量之前不可以先取獎賞（昏厥要等效果結束）');
  s = resolve(s, 0, [pick === 'anc' ? anc.iid : water.iid]);
  noLinger(s, 'G1');
  return { s, anc, water };
}
T('G1a 丟掉古舊能量 ⇒ 獎賞 2 張（官方 L1594：不會減少）、古舊「每場 1 次」未用掉', () => {
  const { s, anc } = shatter('anc');
  assert.equal(taken(s), 2);
  assert.equal((s.ancientEnergyMinusOneUsed ?? [false, false])[1], false);
  assert.ok(s.players[1].discard.some(c => c.iid === anc.iid), '古舊能量應在棄牌區');
  assert.ok(!s.log.some(l => /沒有能量/.test(l.message)), '不可再出現「對手戰鬥寶可夢沒有能量」');
});
T('G1b 丟掉另一張 ⇒ 古舊能量仍在身上昏厥 ⇒ 獎賞 1 張、旗標寫入', () => {
  const { s } = shatter('water');
  assert.equal(taken(s), 1);
  assert.equal((s.ancientEnergyMinusOneUsed ?? [false, false])[1], true);
});
T('G1c log 順序：先「丟棄」、後「被擊倒」', () => {
  const { s } = shatter('anc');
  const iDis = s.log.findIndex(l => /粉碎箭：丟棄/.test(l.message));
  const iKo = s.log.findIndex(l => /被擊倒/.test(l.message));
  assert.ok(iDis >= 0 && iKo >= 0 && iDis < iKo, `丟棄 ${iDis}／擊倒 ${iKo}`);
});

console.log('── G2 吼叫尾ex｜咬碎（官方判例本尊）──');
T('G2 只有古舊能量 1 張 ⇒ 被丟掉後才昏厥 ⇒ 獎賞 1 張（基礎 1、不減少）', () => {
  const anc = inst(ANC);
  let s = board({ active: inst(ROAR, { energyAttached: [inst(PSY), inst(PSY), inst(PSY)] }) },
                { active: inst(CACNEA, { energyAttached: [anc] }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: 1 }, pool);
  if (s.pendingSelection) s = resolve(s, 0, [anc.iid]);
  noLinger(s, 'G2');
  assert.equal(taken(s), 1, '沙鈴仙人掌基本 1 張，古舊能量已丟 ⇒ 不減少');
  assert.ok(s.players[1].discard.some(c => c.iid === anc.iid));
});

console.log('── G3 推倒（受傷的寶可夢換到備戰後昏厥）──');
T('G3 對手選的那隻上戰鬥場；受害者在備戰區昏厥；攻擊方拿獎賞；不需要再補位', () => {
  const victim = inst(CACNEA, { damage: 40 });   // 剩 60，推倒 70 ⇒ 致死
  const keep = inst(KOKO);
  let s = board({ active: inst(RAMPARDOS, { energyAttached: [inst(FIGHT), inst(FIGHT)] }) },
                { active: victim, bench: [keep, inst(KOKO)] });
  s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(s.pendingSelection?.actorIdx, 1, '前置：應由對手選擇要換上的寶可夢');
  assert.equal(taken(s), 0, '換位之前不可以先昏厥');
  s = resolve(s, 1, [keep.iid]);
  noLinger(s, 'G3');
  assert.equal(s.players[1].active?.iid, keep.iid, '戰鬥場應為對手選的那隻');
  assert.ok(!s.players[1].bench.some(b => b.iid === victim.iid), '受害者應已昏厥離場');
  assert.ok(s.players[1].discard.some(c => c.iid === victim.iid), '受害者應在棄牌區');
  assert.equal(taken(s), 1);
});

console.log('── G4 「這個招式讓對手昏厥」的效果 ──');
T('G4a 具甲武者｜要害斬 打昏 ⇒ 下個對手回合免疫旗標', () => {
  let s = board({ active: inst(SAMUROTT, { energyAttached: [inst(WATER)] }) }, { active: inst(CACNEA, { damage: 80 }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
  noLinger(s, 'G4a');
  assert.equal(taken(s), 1);
  assert.equal(s.players[0].active.immuneToAllAttackNextTurn, true);
});
T('G4b 要害斬 沒打昏 ⇒ 不設旗標', () => {
  let s = board({ active: inst(SAMUROTT, { energyAttached: [inst(WATER)] }) }, { active: inst(CACNEA) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(taken(s), 0);
  assert.ok(!s.players[0].active.immuneToAllAttackNextTurn);
});

console.log('── G5 沒有招式效果的招式 ──');
T('G5 致死但沒有招式效果（沙鈴仙人掌｜突刺 50，卡面無效果文字）⇒ 當場結算，不走延後', () => {
  const card = pool.get(CACNEA);
  assert.equal(card.attacks[1].name, '突刺');
  assert.ok(!(card.attacks[1].effect ?? '').trim(), 'fixture：突刺應沒有效果文字');
  const s = board({ active: inst(CACNEA, { energyAttached: [inst(GRASS), inst(GRASS)] }) }, { active: inst(CACNEA, { damage: 60 }) });
  const s1 = applyAction(s, { type: 'ATTACK', attackIndex: 1 }, pool);
  assert.equal(s1._pendingAttackKo, undefined, '沒有招式效果 ⇒ 不應走延後');
  assert.equal(s1.players[1].active, null, '應已昏厥');
  assert.equal(taken(s1), 1);
});

console.log('── G6～G10 fable 審查抓到的四個洞（v6.490 內修好）──');
const NINJA = need('14028', '鐵面忍者'), HELMET = need('12211', '凸凸頭盔');
const LUCKY = String([...pool.values()].find(c => c.name === '幸運頭盔').id);
T('G6 粉碎箭 × 防守方 retaliateCountersOnNextHit:12 ⇒ 攻擊方只吃一次（120，不是 240）', () => {
  const anc = inst(ANC), water = inst(W);
  let s = board({ active: inst(DECIDUEYE, { energyAttached: [inst(GRASS), inst(GRASS), inst(GRASS), inst(GRASS)] }) },
                { active: inst(KOKO, { energyAttached: [anc, water], retaliateCountersOnNextHit: 12 }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
  if (s.pendingSelection) s = resolve(s, 0, [water.iid]);
  assert.equal(s.players[0].active.damage, 120);
});
T('G7 鐵面忍者｜急速折返（自身換到備戰）打死附凸凸頭盔的對手 ⇒ +20 打在鐵面忍者，不是換上來的那隻', () => {
  const atk = inst(NINJA, { energyAttached: [inst(GRASS), inst(GRASS)] });
  const mate = inst(CACNEA);
  let s = board({ active: atk, bench: [mate] }, { active: inst(CACNEA, { damage: 20, toolAttached: inst(HELMET) }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
  if (s.pendingSelection) s = resolve(s, 0, [mate.iid]);
  noLinger(s, 'G7');
  const all = [s.players[0].active, ...s.players[0].bench];
  assert.equal(all.find(c => c.iid === atk.iid)?.damage, 20, '鐵面忍者應受 20');
  assert.equal(all.find(c => c.iid === mate.iid)?.damage ?? 0, 0, '換上來的那隻不應受傷');
  assert.equal(taken(s), 1);
});
T('G8 推倒 打死附幸運頭盔／凸凸頭盔的對手（換到備戰後才昏厥）⇒「在戰鬥場受到傷害時」仍觸發', () => {
  for (const tool of [LUCKY, HELMET]) {
    const victim = inst(CACNEA, { damage: 40, toolAttached: inst(tool) });
    const keep = inst(KOKO);
    let s = board({ active: inst(RAMPARDOS, { energyAttached: [inst(FIGHT), inst(FIGHT)] }) },
                  { active: victim, bench: [keep, inst(KOKO)], deck: [inst(DEF), inst(DEF), inst(DEF)] });
    s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
    if (s.pendingSelection?.actorIdx === 1) s = resolve(s, 1, [keep.iid]);
    noLinger(s, 'G8');
    if (tool === HELMET) assert.equal(s.players[0].active.damage, 20, '凸凸頭盔：攻擊方 +20');
    else assert.equal(s.players[1].hand.length, 2, '幸運頭盔：對手抽 2 張');
    assert.equal(taken(s), 1);
  }
});
T('G9 索羅亞克｜欺詐 借 鐵臂膀ex｜感激放大 打昏 ⇒ 多獲得 1 張（借來的 ATTACK_AFTER_KO 也要跑）', () => {
  const zoro = [...pool.values()].find(c => c.name === '索羅亞克' && c.attacks?.some(a => a.name === '欺詐'));
  const iron = [...pool.values()].find(c => c.name === '鐵臂膀ex' && c.attacks?.some(a => a.name === '感激放大'));
  assert.ok(zoro && iron, 'fixture');
  const ai = zoro.attacks.findIndex(a => a.name === '欺詐');
  const en = ['草', '火', '水', '雷', '超', '鬥', '惡', '鋼'].map(anyBasicEnergy).filter(Boolean).flatMap(id => [inst(id), inst(id), inst(id)]);
  let s = board({ active: inst(zoro.id, { energyAttached: en }) }, { active: inst(iron.id, { damage: Number(iron.hp) - 120 }) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: ai, copyAttackChoice: { pokeIid: s.players[1].active.iid, attackIndex: iron.attacks.findIndex(a => a.name === '感激放大') } }, pool);
  for (let g = 0; g < 4 && s.pendingSelection; g++) s = resolve(s, s.pendingSelection.actorIdx ?? 0, (s.pendingSelection.params?.validIids ?? []).slice(0, 1));
  noLinger(s, 'G9');
  assert.ok(s.log.some(l => /感激放大：擊倒對手/.test(l.message)), '應有感激放大加碼');
  assert.equal(taken(s), 3);
});
T('G10 鐵面忍者｜急速折返 打死 耿鬼ex（死亡宣告正面）⇒ 被昏厥的是鐵面忍者，不是換上來的那隻', () => {
  const gengar = [...pool.values()].find(c => c.name === '耿鬼ex' && c.abilities?.some(a => a.name === '死亡宣告'));
  assert.ok(gengar, 'fixture');
  const atk = inst(NINJA, { energyAttached: [inst(GRASS), inst(GRASS)] });
  const mate = inst(CACNEA);
  let s = board({ active: atk, bench: [mate] }, { active: inst(gengar.id, { damage: Number(gengar.hp) - 90 }) });
  const orig = Math.random; Math.random = () => 0.1;   // 正面
  try {
    s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
    if (s.pendingSelection) s = resolve(s, 0, [mate.iid]);
  } finally { Math.random = orig; }
  const p0 = s.players[0];
  assert.ok(p0.discard.some(c => c.iid === atk.iid), '鐵面忍者應被死亡宣告昏厥');
  assert.ok([p0.active, ...p0.bench].some(c => c?.iid === mate.iid), '換上來的那隻應還在場上');
});

console.log(`\nv6490 招式效果結束後才判定昏厥：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
