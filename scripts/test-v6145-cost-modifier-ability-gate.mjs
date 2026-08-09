// v6.145 守衛：「改寫招式所需能量」的**特性**，必須先過特性生效閘（isAbilityHolderEffective）。
//
// 事故（Wilson 回報「狙射樹梟ex 特性發動疑似有誤」時掃出的整族缺口）：
//   canAffordAttack 內 7 個費用改寫點——狙擊手之眼／化身團結／喧鬧競技／事先準備／
//   老練招式／反等離子／原始根——全部只比對卡名或特性名，**沒有問特性此刻有沒有被消除**。
//   行為端實測：把持有者標上 abilityNullifiedThisTurn（招式版暗夜羽擊）後 7/7 照樣減費／加費。
//   同檔的被動最大HP(v5.999)、大竺葵繁茂(v5.601)、撤退費歸零(v6.070) 早就走中央閘，
//   費用改寫是漏網的一族。
//
// 這張網分兩層：
//   A. 行為端 7 案（正對照 + 消除對照）—— 直接問 canAffordAttack，不看實作字串。
//   B. 靜態枚舉守衛 —— 從 static/cards 枚舉所有 H/I/J live 的「改寫招式能量」特性，
//      要求每一個都在 engine.ts 的 abilityOn(...) 或 effects.ts 的 ABILITY_COLORLESS_COST_ZERO
//      裡出現；新卡帶新特性卻忘了接閘就會紅。掃描器本身附自我驗證（Rule 25）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6145-s.js'), E = join(ROOT, '.v6145-e.ts'), O = join(ROOT, '.v6145-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { canAffordAttack } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { canAffordAttack } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const allCards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id != null) { pool.set(String(c.id), c); allCards.push(c); }
  }
}
let pass = 0, fail = 0, seq = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const ZH = { Fire: '火', Water: '水', Grass: '草', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const basicEnergy = (t) => allCards.find((c) => c.name === `基本【${ZH[t]}】能量`);
const inst = (id, iid, x = {}) => ({ iid, cardId: String(id), damage: 0, energyAttached: [], toolAttached: null,
  extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, evolvedFromStack: [], ...x });
/** 只給「非【無】」的部分 + keepC 個雜能量 → 只有減費生效時才付得出來 */
const energiesFor = (cost, keepC) => {
  const out = []; let c = 0;
  for (const t of cost) {
    if (t === 'Colorless') { if (c < keepC) { out.push(inst(basicEnergy('Grass').id, 'e' + (seq++))); c++; } }
    else out.push(inst(basicEnergy(t).id, 'e' + (seq++)));
  }
  return out;
};
const mkState = (A, B) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
  log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null,
  players: [
    { name: 'A', active: A.active, bench: A.bench ?? [], hand: A.hand ?? [], deck: [], discard: A.discard ?? [], prizes: A.prizes ?? [] },
    { name: 'B', active: B.active, bench: B.bench ?? [], hand: B.hand ?? [], deck: [], discard: B.discard ?? [], prizes: B.prizes ?? [] },
  ],
});
const cardByName = (n, pred) => { const c = allCards.find((x) => x.name === n && (!pred || pred(x))); assert.ok(c, `找不到卡：${n}`); return c; };
const filler = (k, pre) => Array.from({ length: k }, (_, i) => inst(cardByName('基本【草】能量').id, pre + i));

// ── A. 行為端：7 個費用改寫點 ────────────────────────────────────────────
//   ⚠ 判準用 canAffordAttack（付不付得出招式費用），不是「state 有沒有變」——
//     後者在修正前的 HEAD 也會 PASS（假綠）。
const OWL = cardByName('狙射樹梟ex');
const DUMMY = cardByName('龍捲雲');
const behaviour = [
  ['狙射樹梟ex｜狙擊手之眼（對手手牌恰4張 → 全消【無】）', (nul) => {
    const atk = OWL.attacks[0];
    return { cost: atk.cost, name: atk.name, state: mkState(
      { active: inst(OWL.id, 'a1', { energyAttached: energiesFor(atk.cost, 0), abilityNullifiedThisTurn: nul || undefined }), hand: filler(7, 'm') },
      { active: inst(DUMMY.id, 'b1'), hand: filler(4, 'o') }) };
  }],
  ['龍捲雲｜化身團結（四化身雲齊聚 → 全消【無】）', (nul) => {
    const t = cardByName('龍捲雲', (c) => (c.abilities ?? []).some((a) => a.name === '化身團結'));
    const atk = t.attacks[0];
    return { cost: atk.cost, name: atk.name, state: mkState(
      { active: inst(t.id, 'a1', { energyAttached: energiesFor(atk.cost, 0), abilityNullifiedThisTurn: nul || undefined }),
        bench: ['雷電雲', '土地雲', '眷戀雲'].map((n, i) => inst(cardByName(n, (c) => (c.abilities ?? []).some((a) => a.name === '化身團結')).id, 'bn' + i)) },
      { active: inst(cardByName('好勝毛蟹').id, 'x1') }) };
  }],
  ['熾焰咆哮虎ex｜喧鬧競技（對手備戰4隻 → 減4【無】）', (nul) => {
    const t = cardByName('熾焰咆哮虎ex'); const atk = t.attacks[0];
    return { cost: atk.cost, name: atk.name, state: mkState(
      { active: inst(t.id, 'a1', { energyAttached: energiesFor(atk.cost, 0), abilityNullifiedThisTurn: nul || undefined }) },
      { active: inst(cardByName('好勝毛蟹').id, 'x1'), bench: [0, 1, 2, 3].map((i) => inst(cardByName('好勝毛蟹').id, 'y' + i)) }) };
  }],
  ['好勝毛蟹｜事先準備（棄牌區4張海岱 → 減4【無】）', (nul) => {
    const t = cardByName('好勝毛蟹'); const atk = t.attacks[0]; const hai = cardByName('海岱');
    return { cost: atk.cost, name: atk.name, state: mkState(
      { active: inst(t.id, 'a1', { energyAttached: energiesFor(atk.cost, 0), abilityNullifiedThisTurn: nul || undefined }),
        discard: [0, 1, 2, 3].map((i) => inst(hai.id, 'h' + i)) },
      { active: inst(DUMMY.id, 'x1') }) };
  }],
  ['月月熊 赫月ex｜老練招式（對手已取3張獎賞 → 減3【無】）', (nul) => {
    const t = cardByName('月月熊 赫月ex'); const atk = t.attacks[0];
    return { cost: atk.cost, name: atk.name, state: mkState(
      { active: inst(t.id, 'a1', { energyAttached: energiesFor(atk.cost, 2), abilityNullifiedThisTurn: nul || undefined }), prizes: filler(6, 'p') },
      { active: inst(DUMMY.id, 'x1'), prizes: filler(3, 'q') }) };
  }],
  ['酋雷姆｜反等離子（對手棄牌區有阿克羅瑪 → cost 改為1【無】）', (nul) => {
    const t = cardByName('酋雷姆'); const atk = t.attacks[0];
    const ac = allCards.find((c) => (c.name ?? '').includes('阿克羅瑪'));
    assert.ok(ac, '找不到「阿克羅瑪」相關卡');
    return { cost: atk.cost, name: atk.name, state: mkState(
      { active: inst(t.id, 'a1', { energyAttached: [inst(basicEnergy('Grass').id, 'e' + (seq++))], abilityNullifiedThisTurn: nul || undefined }) },
      { active: inst(DUMMY.id, 'x1'), discard: [inst(ac.id, 'd0')] }) };
  }],
];
for (const [label, mk] of behaviour) {
  T(`⭐${label}：特性有效→打得出來；特性被消除→打不出來`, () => {
    const on = mk(false), off = mk(true);
    assert.equal(canAffordAttack(on.state.players[0].active, on.cost, pool, on.state, 0, on.name), true,
      '正對照：條件成立且特性有效時應該付得出費用（fixture 壞掉會讓下一條變成假綠）');
    assert.equal(canAffordAttack(off.state.players[0].active, off.cost, pool, off.state, 0, off.name), false,
      '⭐特性被暗夜羽擊消除後仍套用減費 —— 這就是 v6.145 修的 bug');
  });
}
T('⭐陳舊的根狀化石｜原始根（對手【基礎】+1【無】）：特性被消除後不該再加費', () => {
  const foss = cardByName('陳舊的根狀化石'), att = cardByName('龍捲雲', (c) => (c.attacks ?? []).length > 0);
  const atk = att.attacks[0];
  const A = { active: inst(att.id, 'a1', { energyAttached: energiesFor(atk.cost, atk.cost.length) }) };
  const st = (nul) => mkState(A, { active: inst(foss.id, 'f1', { fossilOnField: true, abilityNullifiedThisTurn: nul || undefined }) });
  assert.equal(canAffordAttack(A.active, atk.cost, pool, st(false), 0, atk.name), false, '正對照：原始根有效時應被 +1【無】卡住');
  assert.equal(canAffordAttack(A.active, atk.cost, pool, st(true), 0, atk.name), true, '⭐原始根被消除後仍加費 —— v6.145 修的 bug');
});

// ── B. 靜態枚舉守衛 ─────────────────────────────────────────────────────
const engineSrc = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
const effectsSrc = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
/** 卡面「改寫**招式**所需能量」的特性名（撤退費那一族走另一條中央管線，不在此網範圍） */
function enumerateCostAbilityNames() {
  const out = new Set();
  for (const c of allCards) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of c.abilities ?? []) {
      // ⚠ 先剝掉方括號內的**提醒文**（如古空棘魚｜潛入記憶的「[需要有足夠使用招式的能量。]」）——
      //   那不是效果本體，會讓加寬後的措辭比對產生假陽性。
      const e = (a.effect ?? '').replace(/[[［][^\]］]*[\]］]/g, '');
      if (!e.includes('能量')) continue;
      if (!(e.includes('所需') || e.includes('必要') || e.includes('需要'))) continue;  // v6.145 加寬：涵蓋「只需要/不需要」型措辭
      if (e.includes('【撤退】')) continue;   // 撤退費族：computeActiveRetreatCostFor 已走中央閘
      out.add(a.name);
    }
  }
  return [...out];
}
const COST_ABILITIES = enumerateCostAbilityNames();
const isGated = (name) =>
  engineSrc.includes(`abilityOn('${name}')`) ||
  engineSrc.includes(`isCostModifierAbilityEffective(state, defActive, defCard, dIdx, '${name}'`) ||
  effectsSrc.includes(`['${name}', (`);          // ABILITY_COLORLESS_COST_ZERO 成員 → 由 abilityEffective 逐名判定

T('掃描器自我驗證：枚舉不得為空，且必須抓到已知成員（否則整條 B 是假綠）', () => {
  assert.ok(COST_ABILITIES.length >= 6, `只枚舉到 ${COST_ABILITIES.length} 個：${COST_ABILITIES.join('、')}`);
  for (const known of ['狙擊手之眼', '化身團結', '喧鬧競技', '事先準備', '老練招式', '反等離子', '原始根']) {
    assert.ok(COST_ABILITIES.includes(known), `枚舉漏掉已知的 ${known} —— 掃描條件太窄`);
  }
  console.log('   枚舉到：' + COST_ABILITIES.join('、'));
});
T('掃描器自我驗證：不存在的特性名必須被判為「沒接閘」（證明 isGated 不是恆真）', () => {
  assert.equal(isGated('__這個特性不存在__'), false, 'isGated 恆真 → 整條 B 是假綠');
});
T('⭐⭐每個「改寫招式所需能量」的特性都必須接上特性生效閘', () => {
  const bad = COST_ABILITIES.filter((n) => !isGated(n));
  assert.deepEqual(bad, [], '以下特性沒有走 isCostModifierAbilityEffective／ABILITY_COLORLESS_COST_ZERO：\n  ' + bad.join('\n  '));
});
T('⭐黏美龍｜黏滑失足（撤退擲幣）也必須問特性生效性（同一輪的鄰居缺口）', () => {
  const i = engineSrc.indexOf('const hasStickFoot');
  assert.ok(i > 0, '找不到 hasStickFoot —— 錨點過期，這條規則已失效');
  const seg = engineSrc.slice(i, i + 900);
  assert.ok(seg.includes("isAbilityHolderEffective"), '黏滑失足只比對特性名，沒問特性有沒有被消除');
});
T('⭐getDecidueyeSnipeEffectiveCost 的生效述詞必須是**必填**（忘了傳要編譯錯，不能靜默退回舊行為）', () => {
  const i = effectsSrc.indexOf('export function getDecidueyeSnipeEffectiveCost');
  assert.ok(i > 0, '找不到 getDecidueyeSnipeEffectiveCost');
  const sig = effectsSrc.slice(i, effectsSrc.indexOf('{', effectsSrc.indexOf('EnergyType[] {', i)) + 1);
  assert.ok(/abilityEffective: \(abilityName: string\) => boolean,/.test(sig), '述詞參數不見了');
  assert.ok(!/abilityEffective[^,)]*=\s*\(/.test(sig), '述詞不得有預設值（有預設值＝忘了傳就靜默無 gate）');
});

// ── C. 化石特性 × 特性消除場地（v6.145 Fable 5 審查抓到的新回歸）────────────
//   化石卡 rulesText 明文：「這張卡可作為 HP60 的【無】屬性的【基礎】寶可夢放置於場上。」
//   → 傳說的熔岩洞（消除**進化**寶可夢特性）**不該**碰它；
//     火箭隊的監視塔（消除**【無】**寶可夢特性）**應該**消除它。
//   原本 isNullifiedByLegendCave 讀 `stage ?? subtype`＝'Item' → 誤判成進化；
//   isNullifiedByRocketWatchtower 讀 card.pokemonType（化石為 null）→ 漏消除。
//   ⚠ 這兩條在 v6.145 把原始根接上閘之前是「看不出來」的，因為原本根本沒問特性有效性。
function stadiumCase(stadiumName) {
  const foss = cardByName('陳舊的根狀化石'), att = cardByName('龍捲雲', (c) => (c.attacks ?? []).length > 0);
  const atk = att.attacks[0];
  const A = { active: inst(att.id, 'a1', { energyAttached: energiesFor(atk.cost, atk.cost.length) }) };
  const st = mkState(A, { active: inst(foss.id, 'f1', { fossilOnField: true }) });
  if (stadiumName) st.activeStadium = inst(cardByName(stadiumName).id, 'st1');
  // 只給「剛好等於原始費用」的能量 → 原始根有效時付不出來（false），被消除時付得出來（true）
  return canAffordAttack(A.active, atk.cost, pool, st, 0, atk.name);
}
T('⭐【傳說的熔岩洞】只消除**進化**寶可夢特性 → 化石的「原始根」仍然生效', () => {
  assert.equal(stadiumCase(null), false, '正對照：無場地時原始根有效（+1【無】卡住）');
  assert.equal(stadiumCase('傳說的熔岩洞'), false,
    '化石卡面明寫是【基礎】寶可夢，熔岩洞不該消除它的特性（stage ?? subtype 取到 Item 的誤判）');
});
T('⭐【火箭隊的監視塔】消除**【無】**寶可夢特性 → 化石的「原始根」應失效', () => {
  assert.equal(stadiumCase('火箭隊的監視塔'), true,
    '化石在場上是【無】屬性寶可夢，監視塔應消除原始根（card.pokemonType 為 null 的漏判）');
});


console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
