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
// 【本守衛的定位】v6.407a 寫它時是「收斂前的安全網」；**v6.408 已經收斂完成**
//   （engine 那一份刪掉、改呼叫中央 helper）⇒ 各段現在守的是不同的東西，讀之前先看清楚：
//     ・【A】【B】的**差分**比對：收斂後不是恆真式 —— 它守的是「engine 真的有接上中央 helper」
//       （沒接上的話 engine 的 formula 會是空的、直呼中央的不空 ⇒ 紅），但**測不到順序與數值**。
//     ・【A】【B】的**絕對量**斷言（⑤ 與 B1 的 label 順序）才是收斂後守數值與順序的那一半。
//     ・【D】只驗比對器自己，收斂後沒有第二份可比 ⇒ 它守的是「比對器不是恆真／恆假」。
//     ・【E】【G】是行為端：旗標消耗／削傷 ≥ 基礎時的 clamp 行為。
//     ・【F】守「engine 不得再長出第二份」。
//   ⚠ 新增加成項時：【C】會逼你補一組【A】，B1 的順序陣列也要跟著改。
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
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
// ⚠ 站長的工作樹是 CRLF、CI checkout 是 LF ⇒ 多行錨點一律先 normEol（v6.377 C-9 的規範）。
import { normEol } from './lib/eol-agnostic.mjs';

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
function diff(mk, ai, baseDmg, want, expectDelta) {
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
  // ⑤ ⭐⭐ 絕對判準：engine 這一條路徑打出來的傷害，減去基礎，必須等於卡面規定的加成量。
  //   ⚠ 這一條**不是**差分 —— 它在「兩份收斂成一份」之後仍然在守（差分那時只證明兩邊一致，
  //     絕對量才證明「一致在正確的數字上」）。釘的是卡面數值（+50／-30…），不是某張卡的基礎
  //     傷害，所以卡池換印刷不會誤紅。
  const dm = texts.map((t) => /造成 (\d+) 點傷害/.exec(t)).filter(Boolean).pop();
  assert.ok(dm, `log 裡找不到「造成 N 點傷害」：\n    ${texts.join('\n    ')}`);
  assert.strictEqual(Number(dm[1]) - baseDmg, expectDelta,
    `加成量不對：基礎 ${baseDmg} → 實際 ${dm[1]}（差 ${Number(dm[1]) - baseDmg}），應該差 ${expectDelta}`);
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
  diff(() => mkState({ atkCard: P_L.card, atkEnergy: [VOLT, VOLT, BL] }), P_L.ai, P_L.dmg, ['伏特【雷】能量'], 40);
});

// ── A2 攻擊道具（活力頭帶：無條件 +10）────────────────────────────────────
await T('A2 攻擊道具 TOOL_ATTACK_BONUS（極限腰帶 +50，defender = ex）', () => {
  assert.ok(TANK_EX, '找不到「無弱點無抵抗無特性」的 ex 靶');
  diff(() => mkState({ atkCard: P_L.card, atkEnergy: [BL, BL, BL], atkTool: BELT, defCard: TANK_EX }),
    P_L.ai, P_L.dmg, ['極限腰帶'], 50);
});

// ── A3 被動特性（比克提尼｜勝利聲援：自己【火】進化寶可夢 +10）──────────────
const P_FIRE_EVO = pickPure((c) => c.pokemonType === 'Fire' && !!c.evolvesFrom, costWithin(['Fire', 'Colorless'], 3));
assert.ok(P_FIRE_EVO, '找不到【火】進化寶可夢的純傷害招式');
const BFire = named('基本【火】能量');
await T(`A3 被動特性 PASSIVE_ATTACK_BONUS（勝利聲援 +10；${P_FIRE_EVO.card.name}）`, () => {
  diff(() => mkState({
    atkCard: P_FIRE_EVO.card, atkEnergy: [BFire, BFire, BFire], benchCards: [VICTINI],
  }), P_FIRE_EVO.ai, P_FIRE_EVO.dmg, ['勝利聲援'], 10);
});

// ── A4 力量蛋白飲（本回合自己【鬥】寶可夢 +N）──────────────────────────────
const P_F = pickPure((c) => c.pokemonType === 'Fighting', costWithin(['Fighting', 'Colorless'], 3));
assert.ok(P_F, '找不到【鬥】屬性的純傷害招式');
await T(`A4 力量蛋白飲（+30；${P_F.card.name}）`, () => {
  diff(() => mkState({
    atkCard: P_F.card, atkEnergy: [BF, BF, BF], playerExtra: { damageBoostFightingThisTurn: 30 },
  }), P_F.ai, P_F.dmg, ['力量蛋白飲'], 30);
});

// ── A5 夠讚狗｜腎上腺力量（自身附【惡】能量 +100）──────────────────────────
const HOUND = named('夠讚狗');
const HOUND_AI = (HOUND.attacks || []).findIndex((a) => isPure(a));
await T('A5 夠讚狗｜腎上腺力量（+100）', () => {
  assert.ok(HOUND_AI >= 0, '夠讚狗沒有純傷害招式（卡池換印刷了？）');
  diff(() => mkState({ atkCard: HOUND, atkEnergy: [BF, BF, BD] }), HOUND_AI, Number(HOUND.attacks[HOUND_AI].damage), ['腎上腺力量'], 100);
});

// ── A6 化朗鎮（赫普的寶可夢 +30）──────────────────────────────────────────
const HELO = pickPure((c) => (c.name || '').startsWith('赫普的'), costWithin(['Colorless'], 3));
const HUALANG = named('化朗鎮');
assert.ok(HELO, '找不到「赫普的…」的純傷害招式');
await T(`A6 化朗鎮（+30；${HELO.card.name}）`, () => {
  diff(() => mkState({
    atkCard: HELO.card, atkEnergy: [BL, BL, BL], stadium: HUALANG,
  }), HELO.ai, HELO.dmg, ['化朗鎮'], 30);
});

// ── A7 空手道王的演練（對對手戰鬥位 ex +40）───────────────────────────────
await T('A7 空手道王的演練（+40，defender = ex）', () => {
  assert.ok(TANK_EX, '找不到「無弱點無抵抗無特性」的 ex 靶');
  diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], playerExtra: { karateKingBonusThisTurn: true }, defCard: TANK_EX,
  }), P_L.ai, P_L.dmg, ['空手道王'], 40);
});

// ── A8 烏栗（對對手戰鬥位 ex/V +30）───────────────────────────────────────
await T('A8 烏栗（+30，defender = ex）', () => {
  assert.ok(TANK_EX, '找不到「無弱點無抵抗無特性」的 ex 靶');
  diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], playerExtra: { unrudaBonusThisTurn: true }, defCard: TANK_EX,
  }), P_L.ai, P_L.dmg, ['烏栗'], 30);
});

// ── A9 回合加傷（消耗型：damageBonusThisTurn）──────────────────────────────
await T('A9 回合加傷（+50，消耗型）', () => {
  diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], atkExtra: { damageBonusThisTurn: 50 },
  }), P_L.ai, P_L.dmg, ['回合加傷'], 50);
});

// ── A10 招致削傷（消耗型：nextOwnAttackPenalty，唯一的「減」項）──────────────
await T('A10 招致削傷（-30，消耗型；唯一的減項）', () => {
  const t = diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], atkExtra: { nextOwnAttackPenalty: 30 },
  }), P_L.ai, P_L.dmg, ['招致削傷'], -30);
  assert.ok(t.some((x) => x.sign === '-'), '招致削傷應該是「-」號項（兩邊的 sign 也必須一致）');
});

// ── A11 格拉吉歐的決戰（非規則寶可夢 +80）─────────────────────────────────
const P_NONRULE = pickPure((c) => c.subtype !== 'ex' && !c.rule && c.pokemonType === 'Lightning',
  costWithin(['Lightning', 'Colorless'], 3));
await T(`A11 格拉吉歐的決戰（+80，非規則寶可夢；${P_NONRULE?.card?.name}）`, () => {
  assert.ok(P_NONRULE, '找不到非規則的【雷】純傷害招式');
  diff(() => mkState({
    atkCard: P_NONRULE.card, atkEnergy: [BL, BL, BL], playerExtra: { gladionDuelBonusThisTurn: true },
  }), P_NONRULE.ai, P_NONRULE.dmg, ['格拉吉歐'], 80);
});

console.log('\n【B】疊加（順序也必須一致 —— 兩份的先後排列不同就會在這裡紅）');
await T('B1 四項同時：回合加傷＋招致削傷＋伏特×2＋極限腰帶', () => {
  const t = diff(() => mkState({
    atkCard: P_L.card, atkEnergy: [VOLT, VOLT, BL], atkTool: BELT, defCard: TANK_EX,
    atkExtra: { damageBonusThisTurn: 50, nextOwnAttackPenalty: 30 },
  }), P_L.ai, P_L.dmg, ['回合加傷', '招致削傷', '伏特【雷】能量', '極限腰帶'], 110);
  assert.strictEqual(t.length, 4, `應該剛好 4 項，實際 ${t.length}：${j(t)}`);
  // ⭐⭐ 順序本身是行為（見【G】：有減項時，先減後加與先加後減會給出不同的 clamp 結果）。
  //   收斂之後只剩一份實作 ⇒ 差分測不到順序了，改在這裡**逐字釘住**。
  assert.deepStrictEqual(t.map((x) => x.label),
    ['回合加傷', '招致削傷', '伏特【雷】能量×2', '極限腰帶'],
    '11 項的套用順序被改動了（順序在有減項時會改變結果）');
});

console.log('\n【C】涵蓋率自檢：中央 helper 加了新的加成項，A 段就必須跟著加一組');
await T('C1 ⭐⭐ applyAttackerActiveDamageBonuses 裡的 formula.push 數 === A 段的組數', () => {
  const src = normEol(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
  // 結構 anchor：從函式簽章往後找到下一個頂層 `\nexport ` 為止
  const i = src.indexOf('export function applyAttackerActiveDamageBonuses(');
  assert.ok(i > 0, '找不到 applyAttackerActiveDamageBonuses（改名了？anchor 要跟著改）');
  const jEnd = src.indexOf('\nexport ', i + 10);
  assert.ok(jEnd > i, '截不到函式結尾');
  const body = src.slice(i, jEnd);
  assert.ok(body.length < 14000, `截出來 ${body.length} 字元，anchor 可能失效`);
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

console.log('\n【E】⭐⭐⭐ v6.408 修掉的真 bug：兩個消耗型旗標同時存在時，回合加傷也必須被消耗');
// 舊的 inline 版：「回合加傷」與「招致削傷」兩段各自 `const newAtk = { ...attacker.active }`
//   （同一份**原始快照**）再整份寫回 ⇒ 第二段把第一段刪掉的 damageBonusThisTurn **又帶回來**。
//   ⇒ 我方用了「彗星拳／風力充能」（下次 +N）而對手用了「吠／咆哮／叫聲」（下次 -N）時，
//     回合加傷這個旗標**永遠消耗不掉**，之後每一次攻擊都會繼續 +N。
function attackAndReadFlags(extra, energy = [BL, BL, BL], defCard = TANK) {
  const out = applyAction(mkState({ atkCard: P_L.card, atkEnergy: energy, atkExtra: extra, defCard }),
    { type: 'ATTACK', attackIndex: P_L.ai }, pool);
  const st = out?.state ?? out;
  const a = st.players[0].active;
  const texts = (st.log || []).map((l) => (typeof l === 'string' ? l : l.message || ''));
  const dm = texts.map((t) => /造成 (\d+) 點傷害/.exec(t)).filter(Boolean).pop();
  return {
    bonus: a.damageBonusThisTurn, penalty: a.nextOwnAttackPenalty,
    flip: a.attackFailureFlipCountThisTurn,
    dmg: dm ? Number(dm[1]) : null, defDamage: st.players[1].active.damage,
  };
}
await T('E1 ⭐ 前提／正對照：只有回合加傷時，攻擊後旗標本來就會被消耗', () => {
  const r = attackAndReadFlags({ damageBonusThisTurn: 50 });
  assert.strictEqual(r.dmg, P_L.dmg + 50, `只有回合加傷時傷害不對：${r.dmg}`);
  assert.strictEqual(r.bonus, undefined, '⚠ 連「只有回合加傷」都沒消耗 ⇒ E2 測不到本版修的那件事');
});
await T('E2 ⭐⭐⭐ 兩個旗標同時 ⇒ 回合加傷仍必須被消耗（v6.408 修正；BASE 上這一條必紅）', () => {
  const r = attackAndReadFlags({ damageBonusThisTurn: 50, nextOwnAttackPenalty: 30 });
  assert.strictEqual(r.dmg, P_L.dmg + 50 - 30, `兩個旗標同時的傷害不對：${r.dmg}`);
  assert.strictEqual(r.bonus, undefined,
    '⚠⚠ 回合加傷沒有被消耗（下次攻擊還會再 +N）⇒ 兩段各自從同一份原始快照複製、後者覆蓋前者');
  assert.strictEqual(r.penalty, undefined, '招致削傷也必須被消耗');
});

await T('E3 ⭐⭐⭐ 干擾命中判定的旗標不得被「復活」（潑沙／墨汁噴射；BASE 上這一條必紅）', () => {
  // ⚠⚠ 這一條才是本版**玩家真的看得到**的修正：
  //   BASE 的 inline 版在消耗回合加傷／招致削傷時，是把攻擊方**快照**整份寫回 state；
  //   而 attackFailureFlipCountThisTurn（潑沙／墨汁噴射留下的「下次出招要先擲硬幣」）
  //   在 ATTACK 開頭就已經被消耗掉了，快照上卻還活著 ⇒ 被寫回去＝**復活**。
  //   ⚠ 這個旗標 END_TURN **不清**（回合加傷會清）⇒ 下一個自己的回合出招還要再擲一次，
  //     擲到反面就直接失敗。實測 __m6a/_probe_revive.mjs。
  // ⚠ 干擾命中判定用的是 Math.random()，沒有注入點 ⇒ 重試到「全部正面、招式成功」為止。
  //   flipCount = 1 ⇒ 每次 50%，40 次都失敗的機率 < 1e-12（不是靠運氣的確定性）。
  let r = null;
  for (let i = 0; i < 40; i++) {
    const t = attackAndReadFlags({ attackFailureFlipCountThisTurn: 1, damageBonusThisTurn: 50 });
    if (t.dmg !== null) { r = t; break; }
  }
  assert.ok(r, '40 次都沒擲出正面 ⇒ 擲幣或盤面壞了（不是本版的回歸）');
  assert.strictEqual(r.dmg, P_L.dmg + 50, `傷害不對：${r.dmg}`);
  assert.strictEqual(r.flip, undefined,
    '⚠⚠ attackFailureFlipCountThisTurn 被復活了（下一個自己的回合還要再擲一次硬幣）');
});

await T('E4 ⭐⭐ _attackerActiveBonusDone 真的有被設（否則同一次攻擊會被重複套一遍）', () => {
  // ⚠ 這個旗標是「engine 主管線已經套過加成」的唯一訊號；中央 helper（dealAttackDamageToTarget
  //   那條延後／狙擊路徑）靠它早退。收斂之後設定端只剩**一處**（中央 helper 尾端），
  //   而它沒有任何行為守衛 —— 目前卡池裡沒有「主傷害 > 0 又在 POST 再打一次戰鬥位」的卡，
  //   所以行為端測不出來 ⇒ 這裡用**直呼兩次**把契約釘住（v6.408 獨立審查 🟡4）。
  const st = mkState({ atkCard: P_L.card, atkEnergy: [VOLT, VOLT, BL] });
  const r1 = central(st, 0, P_L.dmg, pool);
  assert.strictEqual(r1.formula.length, 1, `第一次應該套到伏特一項，實際 ${j(r1.formula)}`);
  assert.strictEqual(r1.state._attackerActiveBonusDone, true, '⚠⚠ 套完加成之後沒有設 _attackerActiveBonusDone');
  const r2 = central(r1.state, 0, P_L.dmg, pool);
  assert.deepStrictEqual(r2.formula, [], `第二次必須完全早退，實際 ${j(r2.formula)}`);
  assert.strictEqual(r2.damage, P_L.dmg, `第二次不該再加傷：${r2.damage}`);
});
await T('E5 ⭐ 反安慰劑：E4 不是恆真（旗標為 false 時第二次會再套一次）', () => {
  const st = mkState({ atkCard: P_L.card, atkEnergy: [VOLT, VOLT, BL] });
  const r1 = central(st, 0, P_L.dmg, pool);
  const cleared = { ...r1.state };
  delete cleared._attackerActiveBonusDone;
  const r2 = central(cleared, 0, P_L.dmg, pool);
  assert.strictEqual(r2.formula.length, 1,
    '⚠ 把旗標拿掉之後第二次竟然還是早退 ⇒ E4 守的不是旗標（可能是別的早退條件）');
});

console.log('\n【G】⭐⭐⭐ 攻擊方的加減**先算完、最後才不能低於 0**（v6.409 站長裁定）');
// ⭐ 站長 2026-09-20 裁定，逐字：「傷害應該是 50+40-100=-10 然後等於 0」。
//   ⇒ 中途**不**夾 0：招致削傷之後即使變成負的，後面的加項照樣累加，最後才 clamp。
//   ⚠ v6.408 之前（含 engine 的 inline 版）是「中途 clamp、之後的加項全部不套」，
//     兩者只在「減項 ≥ 基礎，但加總之後 > 0」時會給出不同答案 —— 那正是 G4 守的那一格。
//   ⚠ PTCG_RULES.md §18.E／§17.2.H 只講到減項本身，沒有這一條的明文 ⇒ 判準來源是站長裁定，
//     不是官方原文。改判準的話要連這段註解一起改。
await T('G1 ⭐⭐ 加總之後仍 ≤ 0 ⇒ 0（50 − 100 + 40 = −10 ⇒ 0，沒有造成傷害）', () => {
  const r = attackAndReadFlags({ nextOwnAttackPenalty: P_L.dmg + 50 }, [VOLT, VOLT, BL]);
  assert.strictEqual(r.dmg, null, `應該完全沒有造成傷害（沒有「造成 N 點傷害」那一行），實際 ${r.dmg}`);
  assert.strictEqual(r.defDamage, 0, `對手不該受到傷害，實際 ${r.defDamage}`);
});
await T('G2 ⭐⭐⭐ 加總之後 > 0 ⇒ 照給（50 − 60 + 40 = 30）—— 這一格是 v6.409 改掉的那個', () => {
  // ⚠⚠ 這是整個【G】段唯一測得到本版改動的一條：
  //   舊行為 50−60 ⇒ 夾成 0 ⇒ 逐段閘擋掉伏特 ⇒ **0**；新行為 ⇒ **30**。
  const pen = P_L.dmg + 10;                       // 比基礎多 10 ⇒ 中途一定是負的
  const r = attackAndReadFlags({ nextOwnAttackPenalty: pen }, [VOLT, VOLT, BL]);
  const want = P_L.dmg - pen + 40;                // = 30
  assert.ok(want > 0, `測資設計壞了：期望值 ${want} 不是正數`);
  assert.strictEqual(r.dmg, want,
    `應該是 ${P_L.dmg} − ${pen} + 40 = ${want}，實際 ${r.dmg}（舊行為會是 0 ⇒ 中途夾 0 的寫法回來了）`);
});
await T('G3 ⭐⭐ 邊界：加總之後**正好 0** ⇒ 沒有造成傷害', () => {
  const pen = P_L.dmg + 40;                       // 50 − 90 + 40 = 0
  const r = attackAndReadFlags({ nextOwnAttackPenalty: pen }, [VOLT, VOLT, BL]);
  assert.strictEqual(r.dmg, null, `正好 0 應該不造成傷害，實際 ${r.dmg}`);
  assert.strictEqual(r.defDamage, 0, `對手不該受到傷害，實際 ${r.defDamage}`);
});
await T('G4 ⭐⭐ 道具加成也一樣參與加總（多一項就會露餡）', () => {
  const pen = P_L.dmg + 10;
  const out = applyAction(mkState({
    atkCard: P_L.card, atkEnergy: [BL, BL, BL], atkTool: BELT, defCard: TANK_EX,
    atkExtra: { nextOwnAttackPenalty: pen },
  }), { type: 'ATTACK', attackIndex: P_L.ai }, pool);
  const st = out?.state ?? out;
  assert.strictEqual(st.players[1].active.damage, P_L.dmg - pen + 50,
    `應該是 ${P_L.dmg} − ${pen} + 50 = ${P_L.dmg - pen + 50}，實際 ${st.players[1].active.damage}`);
});
await T('G5 ⭐ 正對照：沒有減項時數字不變（G1~G4 不是「永遠算錯」的恆真式）', () => {
  const r = attackAndReadFlags({ nextOwnAttackPenalty: 10 }, [VOLT, VOLT, BL]);
  assert.strictEqual(r.dmg, P_L.dmg - 10 + 40, `削傷 10 ＋ 伏特×2 應該是 ${P_L.dmg - 10 + 40}，實際 ${r.dmg}`);
});
await T('G6 ⭐⭐ 中央 helper 對外保證：回傳的 damage 永遠 ≥ 0（呼叫端不必自己再夾）', () => {
  const st = mkState({ atkCard: P_L.card, atkEnergy: [VOLT, VOLT, BL],
    atkExtra: { nextOwnAttackPenalty: P_L.dmg + 999 } });
  const r = central(st, 0, P_L.dmg, pool, { attackerSnapshot: st.players[0] });
  assert.strictEqual(r.damage, 0, `回傳的 damage 應該被夾成 0，實際 ${r.damage}`);
});

console.log('\n【F】⭐⭐ 靜態：engine.ts 不得再留著第二份 inline 實作');
/** 判準只有一份（Rule 38）：F1 的正式斷言與 F2 的正對照呼叫的是同一支。 */
function inlineBonusHits(engineSrc) {
  // ⚠ 先剝註解再掃 —— 本版的哨兵註解裡就寫著「伏特【雷】能量／化朗鎮／烏栗」這些字，
  //   不剝會自己把自己掃成違規（安慰劑型態 6 的反面：假紅）。
  const clean = engineSrc.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const marks = [
    "label: '回合加傷'", "label: '招致削傷'", "label: '格拉吉歐的決戰'",
    '伏特【雷】能量×', 'TOOL_ATTACK_BONUS.get(', 'collectPassiveAttackBonuses(',
    "label: '力量蛋白飲'", "label: '腎上腺力量'", "label: '化朗鎮'",
    "label: '空手道王演練'", "label: '烏栗'",
  ];
  return marks.filter((m) => clean.includes(m));
}
await T('F1 ⭐⭐⭐ 本版的 engine.ts 一個 inline 加成點都不剩', () => {
  const src = normEol(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  const hits = inlineBonusHits(src);
  assert.deepStrictEqual(hits, [],
    `engine.ts 還留著第二份加成實作：${hits.join('、')}\n    ⇒ 收斂沒做完，兩份判準的問題還在。`);
});
await T('F2 ⭐⭐⭐ 正對照／HEAD-FAIL：BASE 的 engine.ts 餵給**同一支判準**必須抓到一整排', () => {
  // ⚠ 沒有這一條，F1 可能只是「判準抓不到任何東西」（安慰劑型態 4：空集合空真）。
  const BASE_SHA = '41444a45030d17a2f13bb9bad53c2cc4cd5c5e35';   // v6.407a
  // ⚠ IRON_RULES Rule 45：BASE_SHA 必須是留在 main 上的那一顆
  //   （驗法：`git branch -a --contains <sha>` 要印得出 main）。
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('F2 對 BASE engine.ts 的正對照', 'F1 的結構斷言仍在守（但正對照這一半沒跑到）');
    return;
  }
  const r = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/engine.ts');
  assert.ok(r.ok, `讀不到 BASE 的 engine.ts：${r.err || '(無訊息)'}`);
  const hits = inlineBonusHits(r.out);
  assert.ok(hits.length >= 10,
    `BASE 的 engine.ts 只抓到 ${hits.length} 個 inline 加成點（預期 ≥ 10）⇒ 判準壞了，F1 是空真。實際：${hits.join('、')}`);
});

console.log(`\n=== v6.408 攻擊方加成的兩份判準差分：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
