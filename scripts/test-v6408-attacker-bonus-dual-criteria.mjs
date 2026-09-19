// v6.408 守衛：「攻擊方傷害加成」的判準**現在有兩份**，本守衛證明兩份**逐項等價**。
//
// 【問題】IRON_RULES Rule 38／安慰劑型態 11：同一個判準寫在兩個地方。
//   ① `engine.ts` 的攻擊主管線 —— inline 的 11 段 if
//   ② `effects.ts` 的 `applyAttackerActiveDamageBonuses()` —— 中央 helper
//   兩者靠 `state._attackerActiveBonusDone` 互斥：一般攻擊由 ① 套並設旗標，
//   ② 只在「baseDamage = 0 的延後／狙擊路徑」補套。
//   ⇒ 任何針對其中一份寫的守衛，都測不到另一份；兩份會無聲分岔。
//   （v6.202 的 `_isFestivalDanceFirstAttackLocal` 註解就明說過「否則兩份會分岔」。）
//
// 【本守衛的定位】這是 v6.409「把 ① 改成呼叫 ②」**收斂前的安全網**：
//   先用行為端差分證明兩份現在真的等價，收斂才有基準可比。
//   ⚠⚠ v6.409 收斂之後，這一支的 A~L 會變成恆真式（只剩一份實作，當然一樣）
//     ⇒ **收斂的那一版必須把本檔改造成「靜態：engine.ts 不得再有第二份」＋
//        「行為端：11 項的傷害數字逐項釘住」**，不可以原封不動留著當綠燈。
//     這句話寫在這裡，是為了讓下一版的人看得到。
//
// 【做法】對 11 個加成因子各造一個盤面，兩條路徑各跑一次、比對 formula：
//   路徑①：完整 `applyAction` ⇒ 從 log 末端的「【…】」公式字串抽出各項
//   路徑②：直呼 `applyAttackerActiveDamageBonuses(state, 0, 基礎傷害, pool)` ⇒ 取 formula
//   兩者的「攻擊方加成項」必須**逐項相同（含順序）**。
//
// 【防空真】每一組都斷言「預期的那個 label 真的出現了」——
//   否則盤面沒搭起來時兩邊都是空陣列，比對恆成立（安慰劑型態 4）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x408-s.js'), E = join(ROOT, '.x408-e.ts'), O = join(ROOT, '.x408-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE, TOOL_ATTACK_BONUS, PASSIVE_ATTACK_BONUS } from './src/lib/game/effects/_shared';\n"
  + "export { applyAction } from './src/lib/game/engine';\n"
  + "export { applyAttackerActiveDamageBonuses } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);
const { applyAction, applyAttackerActiveDamageBonuses: central } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const cards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '')) cards.push(c);
  }
}
const named = (n) => { const c = cards.find((x) => x.name === n); assert.ok(c, `找不到 H/I/J 印刷：${n}`); return c; };

// ⭐ 一律動態挑卡（不 pin 任何卡 id：pin 死 id 的守衛換印刷就靜默失效）
const isPure = (a) => !(a.effect || '').trim() && /^\d+$/.test(String(a.damage || '').trim());
function pickPure(pred, costOk = () => true, minDmg = 50) {
  // ⚠ minDmg：招致削傷 -N 會把小傷害打成 0 ⇒ engine 連「造成 N 點傷害」都不印、也就沒有公式
  //   （composeAttackFormula 在只剩一項時回空字串）。挑基礎傷害夠大的招式才測得到減項。
  for (const c of cards) {
    if (c.supertype !== 'Pokemon' || !pred(c)) continue;
    const i = (c.attacks || []).findIndex((a) => isPure(a) && Number(a.damage) >= minDmg && costOk(a.cost || []));
    if (i >= 0) return { card: c, ai: i, dmg: Number(c.attacks[i].damage) };
  }
  return null;
}
const costWithin = (types, max = 3) => (cost) => cost.length <= max && cost.every((x) => types.includes(x));

let nn = 0;
const inst = (cid, e = [], extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...extra });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const tool = (cid) => ({ iid: 't' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });

const VOLT = named('伏特【雷】能量'), BL = named('基本【雷】能量'), BF = named('基本【鬥】能量'), BD = named('基本【惡】能量');
const BELT = named('極限腰帶');         // TOOL_ATTACK_BONUS：對對手戰鬥場的「寶可夢【ex】」+50
//   ⚠ 「活力頭帶」（無條件 +10）看似更乾淨，但它只有 G 標印刷 ⇒ 不在我們維護的卡池裡。
// ⭐ 挑「真的印著『勝利聲援』特性」的那個印刷 —— 同名卡有多個印刷，拿第一個會挑到沒有該特性的那張
const VICTINI = cards.find((c) => c.name === '比克提尼' && (c.abilities || []).some((a) => a.name === '勝利聲援'));
assert.ok(VICTINI, '找不到印著「勝利聲援」的比克提尼');

// 靶：⭐ 無弱點、無抵抗力、HP 夠高、沒有特性 ⇒ engine 的公式裡除了「基礎」不會多出任何項
function pickTank(extra = () => true) {
  return cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 300
    && !(c.weakness?.type ?? c.weakness) && !(c.resistance?.type ?? c.resistance)
    && !(c.abilities || []).length && extra(c));
}
const TANK = pickTank();
assert.ok(TANK, '找不到「無弱點、無抵抗力、無特性、HP≥300」的靶 ⇒ 盤面會混進別的公式項');
const TANK_EX = pickTank((c) => c.subtype === 'ex');   // 空手道王演練／烏栗要 defender 是 ex

/** 從 log 末端的「【…】」抽出公式各項。⚠ label 內含「【雷】」⇒ 一定要貪婪匹配到最後一個 】 */
function engineTerms(texts) {
  const m = texts.map((t) => /【(.+)】\s*$/.exec(t)).filter(Boolean).pop();
  if (!m) return null;
  return [...m[1].matchAll(/([+\-×])(\d+)\(([^)]+)\)/g)].map((x) => ({ sign: x[1], value: +x[2], label: x[3] }));
}
const j = (x) => JSON.stringify(x);
/** ⭐ 比對器只有**一份**（Rule 38）：正式斷言與 D 段的自檢呼叫的是同一支函式。 */
function sameFormula(a, b) { return j(a) === j(b); }

let pass = 0, fail = 0;
const T = (n, f) => {
  try { f(); console.log('  OK  ', n); pass++; }
  // ⚠ 只捕捉 AssertionError：打錯字／模組壞掉必須直接炸掉，不可被吞成一行 FAIL
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};

/**
 * 跑一組差分比對。
 * @param mk      () => state（每次都要**重新**造，兩條路徑不可以共用同一個物件）
 * @param ai      招式 index
 * @param baseDmg 招式的基礎傷害（傳給中央 helper）
 * @param want    這一組**必須**出現的 label（子字串比對；防「盤面沒搭起來 ⇒ 兩邊都空 ⇒ 恆等」）
 */
function diff(mk, ai, baseDmg, want) {
  const out = applyAction(mk(), { type: 'ATTACK', attackIndex: ai }, pool);
  const st = out?.state ?? out;
  const texts = (st?.log || []).map((l) => (typeof l === 'string' ? l : l.message || ''));
  const eTerms = engineTerms(texts);
  assert.ok(eTerms, `engine 沒有印出公式（招式沒打出去？）log=\n    ${texts.join('\n    ')}`);
  const c = central(mk(), 0, baseDmg, pool);
  // ① engine 的第一項一定是「基礎」，不算攻擊方加成
  const eBonus = eTerms.filter((t) => t.label !== '基礎');
  // ② 兩邊逐項相同（含順序）
  assert.ok(sameFormula(eBonus, c.formula),
    `兩份判準分岔了：\n    engine  = ${j(eBonus)}\n    central = ${j(c.formula)}`);
  // ③ 防空真：預期的 label 真的出現
  for (const w of want) {
    assert.ok(eBonus.some((t) => t.label.includes(w)),
      `盤面沒搭起來：公式裡找不到「${w}」⇒ 這一組是空真（兩邊都空當然相等）。實際 = ${j(eBonus)}`);
  }
  // ④ 中央 helper 的最終傷害 = 基礎 + 各項（證明它不是只回 formula 不算數）
  const expect = c.formula.reduce((a, t) => (t.sign === '+' ? a + t.value : t.sign === '-' ? Math.max(0, a - t.value) : a), baseDmg);
  assert.strictEqual(c.damage, expect, `中央 helper 的 damage 與自己的 formula 對不起來：${c.damage} vs ${expect}`);
  return eBonus;
}

/** 造一個乾淨盤面。 */
function mkState({ atkCard, atkEnergy = [], atkTool = null, atkExtra = {}, playerExtra = {}, benchCards = [], defCard = TANK, stadium = null }) {
  const a = inst(atkCard.id, atkEnergy.map((c) => en(c.id)), atkExtra);
  if (atkTool) a.toolAttached = tool(atkTool.id);
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null,
    activeStadium: stadium ? { iid: 'sd1', cardId: String(stadium.id), damage: 0, energyAttached: [] } : null,
    players: [
      { name: 'P1', active: a, bench: benchCards.map((c) => inst(c.id)), hand: [], deck: [inst(TANK.id)], discard: [], prizes: [], ...playerExtra },
      { name: 'P2', active: inst(defCard.id), bench: [inst(TANK.id)], hand: [], deck: [inst(TANK.id)], discard: [], prizes: [] },
    ],
  };
}

// ⭐ A 段的組數：與中央 helper 的 formula.push 數量綁在一起（見【C】），
//   新增一個加成項卻沒加差分組，C1 會紅。
const A_GROUPS = 11;
console.log('\n【A】11 個加成因子逐一差分（engine inline vs 中央 helper）');
// ── A1 伏特【雷】能量（+20/張）────────────────────────────────────────────
const P_L = pickPure((c) => c.pokemonType === 'Lightning', costWithin(['Lightning', 'Colorless'], 3));
assert.ok(P_L, '找不到【雷】屬性的純傷害招式');
await T(`A1 伏特【雷】能量 ×2（${P_L.card.name}｜${P_L.card.attacks[P_L.ai].name}）`, () => {
  diff(() => mkState({ atkCard: P_L.card, atkEnergy: [VOLT, VOLT, BL] }), P_L.ai, P_L.dmg, ['伏特【雷】能量']);
});

// ── A2 攻擊道具（活力頭帶：無條件 +10）────────────────────────────────────
await T('A2 攻擊道具 TOOL_ATTACK_BONUS（極限腰帶 +50，defender = ex）', () => {
  assert.ok(TANK_EX, '找不到「無弱點無抵抗無特性」的 ex 靶');
  diff(() => mkState({ atkCard: P_L.card, atkEnergy: [BL, BL, BL], atkTool: BELT, defCard: TANK_EX }),
    P_L.ai, P_L.dmg, ['極限腰帶']);
});

// ── A3 被動特性（比克提尼｜勝利聲援：自己【火】進化寶可夢 +10）──────────────
const P_FIRE_EVO = pickPure((c) => c.pokemonType === 'Fire' && !!c.evolvesFrom, costWithin(['Fire', 'Colorless'], 3));
assert.ok(P_FIRE_EVO, '找不到【火】進化寶可夢的純傷害招式');
const BFire = named('基本【火】能量');
await T(`A3 被動特性 PASSIVE_ATTACK_BONUS（勝利聲援 +10；${P_FIRE_EVO.card.name}）`, () => {
  diff(() => mkState({
    atkCard: P_FIRE_EVO.card, atkEnergy: [BFire, BFire, BFire], benchCards: [VICTINI],
  }), P_FIRE_EVO.ai, P_FIRE_EVO.dmg, ['勝利聲援']);
});

// ── A4 力量蛋白飲（本回合自己【鬥】寶可夢 +N）──────────────────────────────
const P_F = pickPure((c) => c.pokemonType === 'Fighting', costWithin(['Fighting', 'Colorless'], 3));
assert.ok(P_F, '找不到【鬥】屬性的純傷害招式');
await T(`A4 力量蛋白飲（+30；${P_F.card.name}）`, () => {
  diff(() => mkState({
    atkCard: P_F.card, atkEnergy: [BF, BF, BF], playerExtra: { damageBoostFightingThisTurn: 30 },
  }), P_F.ai, P_F.dmg, ['力量蛋白飲']);
});

// ── A5 夠讚狗｜腎上腺力量（自身附【惡】能量 +100）──────────────────────────
const HOUND = named('夠讚狗');
const HOUND_AI = (HOUND.attacks || []).findIndex((a) => isPure(a));
await T('A5 夠讚狗｜腎上腺力量（+100）', () => {
  assert.ok(HOUND_AI >= 0, '夠讚狗沒有純傷害招式（卡池換印刷了？）');
  diff(() => mkState({ atkCard: HOUND, atkEnergy: [BF, BF, BD] }), HOUND_AI, Number(HOUND.attacks[HOUND_AI].damage), ['腎上腺力量']);
});

// ── A6 化朗鎮（赫普的寶可夢 +30）──────────────────────────────────────────
const HELO = pickPure((c) => (c.name || '').startsWith('赫普的'), costWithin(['Colorless'], 3));
const HUALANG = named('化朗鎮');
assert.ok(HELO, '找不到「赫普的…」的純傷害招式');
await T(`A6 化朗鎮（+30；${HELO.card.name}）`, () => {
  diff(() => mkState({
    atkCard: HELO.card, atkEnergy: [BL, BL, BL], stadium: HUALANG,
  }), HELO.ai, HELO.dmg, ['化朗鎮']);
});

// ── A7 空手道王的演練（對對手戰鬥位 ex +40）───────────────────────────────
await T('A7 空手道王的演練（+40，defender = ex）', () => {
  assert.ok(TANK_EX, '找不到「無弱點無抵抗無特性」的 ex 靶');
  diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], playerExtra: { karateKingBonusThisTurn: true }, defCard: TANK_EX,
  }), P_L.ai, P_L.dmg, ['空手道王']);
});

// ── A8 烏栗（對對手戰鬥位 ex/V +30）───────────────────────────────────────
await T('A8 烏栗（+30，defender = ex）', () => {
  assert.ok(TANK_EX, '找不到「無弱點無抵抗無特性」的 ex 靶');
  diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], playerExtra: { unrudaBonusThisTurn: true }, defCard: TANK_EX,
  }), P_L.ai, P_L.dmg, ['烏栗']);
});

// ── A9 回合加傷（消耗型：damageBonusThisTurn）──────────────────────────────
await T('A9 回合加傷（+50，消耗型）', () => {
  diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], atkExtra: { damageBonusThisTurn: 50 },
  }), P_L.ai, P_L.dmg, ['回合加傷']);
});

// ── A10 招致削傷（消耗型：nextOwnAttackPenalty，唯一的「減」項）──────────────
await T('A10 招致削傷（-30，消耗型；唯一的減項）', () => {
  const t = diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], atkExtra: { nextOwnAttackPenalty: 30 },
  }), P_L.ai, P_L.dmg, ['招致削傷']);
  assert.ok(t.some((x) => x.sign === '-'), '招致削傷應該是「-」號項（兩邊的 sign 也必須一致）');
});

// ── A11 格拉吉歐的決戰（非規則寶可夢 +80）─────────────────────────────────
const P_NONRULE = pickPure((c) => c.subtype !== 'ex' && !c.rule && c.pokemonType === 'Lightning',
  costWithin(['Lightning', 'Colorless'], 3));
await T(`A11 格拉吉歐的決戰（+80，非規則寶可夢；${P_NONRULE?.card?.name}）`, () => {
  assert.ok(P_NONRULE, '找不到非規則的【雷】純傷害招式');
  diff(() => mkState({
    atkCard: P_NONRULE.card, atkEnergy: [BL, BL, BL], playerExtra: { gladionDuelBonusThisTurn: true },
  }), P_NONRULE.ai, P_NONRULE.dmg, ['格拉吉歐']);
});

console.log('\n【B】疊加（順序也必須一致 —— 兩份的先後排列不同就會在這裡紅）');
await T('B1 四項同時：回合加傷＋招致削傷＋伏特×2＋極限腰帶', () => {
  const t = diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [VOLT, VOLT, BL], atkTool: BELT, defCard: TANK_EX,
    atkExtra: { damageBonusThisTurn: 50, nextOwnAttackPenalty: 30 },
  }), P_L.ai, P_L.dmg, ['回合加傷', '招致削傷', '伏特【雷】能量', '極限腰帶']);
  assert.strictEqual(t.length, 4, `應該剛好 4 項，實際 ${t.length}：${j(t)}`);
});

console.log('\n【C】涵蓋率自檢：中央 helper 加了新的加成項，A 段就必須跟著加一組');
await T('C1 ⭐⭐ applyAttackerActiveDamageBonuses 裡的 formula.push 數 === A 段的組數', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  // 結構 anchor：從函式簽章往後找到下一個頂層 `\nexport ` 為止
  const i = src.indexOf('export function applyAttackerActiveDamageBonuses(');
  assert.ok(i > 0, '找不到 applyAttackerActiveDamageBonuses（改名了？anchor 要跟著改）');
  const jEnd = src.indexOf('\nexport ', i + 10);
  assert.ok(jEnd > i, '截不到函式結尾');
  const body = src.slice(i, jEnd);
  assert.ok(body.length < 8000, `截出來 ${body.length} 字元，anchor 可能失效`);
  // ⚠ 先剝註解再數（註解裡提到 formula.push 會灌水 —— 安慰劑型態 6）
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const pushes = (clean.match(/formula\.push\(/g) || []).length;
  assert.strictEqual(pushes, A_GROUPS,
    `中央 helper 有 ${pushes} 個加成項，但 A 段只測了 ${A_GROUPS} 組。\n`
    + '    ⇒ 新增／刪除加成項時，A 段必須同步增減一組差分，否則新的那一項的兩份判準沒有人在比。');
});

console.log('\n【D】反安慰劑：比對器本身要抓得到差異（用的是與正式斷言同一支 sameFormula）');
await T('D1 值不同 ⇒ 抓得到', () => {
  assert.ok(!sameFormula([{ sign: '+', value: 40, label: 'X' }], [{ sign: '+', value: 30, label: 'X' }]),
    '⚠⚠ 比對器對「值不同」回 true ⇒ A 段全部是恆真式');
});
await T('D2 ⭐ 順序不同 ⇒ 也要抓得到（兩份判準的先後排列分岔，結果一樣但過程不同）', () => {
  const a = [{ sign: '+', value: 10, label: 'X' }, { sign: '+', value: 20, label: 'Y' }];
  const b = [{ sign: '+', value: 20, label: 'Y' }, { sign: '+', value: 10, label: 'X' }];
  assert.ok(!sameFormula(a, b), '⚠ 比對器忽略順序 ⇒ 兩份的套用順序分岔時測不到');
});
await T('D3 少一項 ⇒ 抓得到', () => {
  assert.ok(!sameFormula([{ sign: '+', value: 10, label: 'X' }], []), '⚠ 比對器對「少一項」回 true');
});
await T('D4 ⭐ 相同 ⇒ 必須回 true（負對照：比對器不是恆假）', () => {
  assert.ok(sameFormula([{ sign: '+', value: 10, label: 'X' }], [{ sign: '+', value: 10, label: 'X' }]),
    '⚠ 比對器恆假 ⇒ A 段會全部誤紅');
});

console.log(`\n=== v6.408 攻擊方加成的兩份判準差分：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
