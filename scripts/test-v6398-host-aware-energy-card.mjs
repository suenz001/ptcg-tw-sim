#!/usr/bin/env node
/**
 * v6.398 守衛：「寶可夢**身上附加的【X】能量卡**」一律走中央 host-aware 述詞（Rule 38）。
 *
 * 【起因】站長回報：超級噴火龍Xex｜烈獄狂火X **丟不掉新衝天能量**。
 *   卡面（static/cards 逐字查證）：
 *     「將自己的場上寶可夢身上附加的任意數量的【火】能量卡丟棄，造成其張數×90點傷害。」
 *   新衝天能量 rulesText：「只要這張卡附於寶可夢身上，視為提供1個【無】能量。
 *     若附於【2階進化】寶可夢身上，則視為提供2個所有屬性的能量。」
 *   超級噴火龍Xex 是 Stage2 ⇒ 它身上的新衝天能量**就是一張【火】能量卡**，必須丟得掉。
 *
 * 【根因】picker 端（+page.svelte 的 getDiscardableEnergies）自 v6.349 起已經走 host-aware 的
 *   preDiscardEnergyEligible，但**手寫的 regPre**（不走 registerSelfDiscardMultiply 的卡）
 *   各自留著一份「pokemonType === 'X' 或卡名含【X】」⇒ 玩家勾得到、引擎不認：丟 0 張、傷害 0。
 *   全站 audit 找到同型六處（烈獄狂火X／傾瀉茶／極降駕／放電／凍原堡壘×2／腎上腺力量／
 *   腎上腺費洛蒙／火焰軍團），一次收斂到 hostEnergyCardsOfType ─ energyProvidesType。
 *
 * ⚠⚠ 站長裁示的**單位**維度：卡面寫的是「能量**卡**」「其**張數**」⇒ 新衝天能量雖然視為提供
 *   **2 個**能量，但只算 **1 張卡**、只加 **1 倍**（同型：火箭隊的超夢ex｜擦除球）。
 *   A1/A1b 就是釘這件事：只選新衝天必須是 90 而**不是** 180。
 *
 * ⚠ 卡面寫「**基本**【X】能量」的不在本維度內（基本能量沒有 host-aware 問題）⇒ C1 白名單。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-398g-s.js'), E = join(ROOT, '.x-398g-e.ts'), O = join(ROOT, '.x-398g-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, getEffectiveHP } from './src/lib/game/engine';\n"
  + "export { ATTACK_PRE, ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects/_shared';\n"
  + "export { getBasicEnergyType } from './src/lib/game/selection-filter';\n"
  + "export { preDiscardEnergyEligible, hostEnergyCardsOfType, hostHasEnergyType, PASSIVE_COIN_AVOID } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { createGame, applyAction, ATTACK_PRE, ATTACK_PRE_DISCARD_CHOICE, getBasicEnergyType } = M;
/**
 * ⚠ Rule 41：本版新增的中央述詞在 BASE 上**不存在** —— 直接呼叫會 TypeError，
 *   守衛會在第一條就整支炸掉、後面幾十條永遠跑不到（＝只證明了第一條）。
 *   用哨兵包起來，讓每一條各自誠實翻紅。
 */
const MISSING = Symbol('missing');
const F = (n) => (typeof M?.[n] === 'function' ? M[n] : () => MISSING);
const getEffectiveHP = F('getEffectiveHP');
const preDiscardEnergyEligible = F('preDiscardEnergyEligible');
const hostEnergyCardsOfType = F('hostEnergyCardsOfType');
const hostHasEnergyType = F('hostHasEnergyType');
const PASSIVE_COIN_AVOID = M?.PASSIVE_COIN_AVOID ?? new Map();

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const idByName = (n, pred) => { for (const [id, c] of pool) if (c?.name === n && (!pred || pred(c))) return id; return null; };

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + ' :: ' + e.message); fail++; } };

// ── 卡 id（全部走卡名查，不 pin 數字 id：新印刷／換檔不會讓守衛靜默失效） ──────
const CHARIZ_X = idByName('超級噴火龍Xex');           // Stage2 / Fire
const NEW_SKY  = idByName('新衝天能量');               // 特殊：Stage2 host ⇒ 2 個所有屬性
const ANCIENT  = idByName('古舊能量');                 // 特殊：1 個所有屬性
const PRISM    = idByName('稜鏡能量');                 // 特殊：Basic host ⇒ 1 個所有屬性
const MEWTWO_R = idByName('火箭隊的超夢ex');           // Basic（當「附在基礎身上」的對照 host）
const SPIDER   = idByName('電蜘蛛', (c) => (c.attacks ?? []).some((a) => a.name === '放電'));
const TEA      = idByName('來悲粗茶', (c) => (c.attacks ?? []).some((a) => a.name === '傾瀉茶'));
const DRUM     = idByName('猛雷鼓ex');
const GOODDOG  = idByName('夠讚狗', (c) => (c.abilities ?? []).some((a) => a.name === '腎上腺力量'));
const PHEASANT = idByName('吉雉雞');

const energyByType = new Map();
let anyEnergyId = null;
for (const [id, c] of pool) {
  if (c?.supertype !== 'Energy' || c?.subtype !== 'Basic') continue;
  if (anyEnergyId === null) anyEnergyId = id;
  const t = getBasicEnergyType(c);
  if (t && !energyByType.has(t)) energyByType.set(t, id);
}
/** ⚠ 現役基本能量卡的 pokemonType 多為 null ⇒ 一定要走中央 getBasicEnergyType，自己寫會挑錯 ⇒ 招式打不出來。 */
const energyIdFor = (costType) => energyByType.get(costType) ?? anyEnergyId;

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });

/**
 * 挑高血靶。wantWeakTo=false ⇒ 對 atkType **中立**（弱點與抵抗力都不是它）。
 * ⚠⚠ 必須排除有特性／有 rulesText 的（被動減傷或免疫會把傷害整個吃掉，看起來像收斂壞了）。
 */
function pickTarget(atkType, wantWeakTo) {
  for (const [id, c] of pool) {
    if (c?.supertype !== 'Pokemon' || (c.hp ?? 0) < 300) continue;
    if ((c.abilities ?? []).length > 0) continue;
    if (c.rulesText) continue;
    const w = c.weakness?.type, r = c.resistance?.type;
    if (wantWeakTo) { if (w === atkType) return id; continue; }
    if (w === atkType || r === atkType) continue;
    return id;
  }
  return null;
}
const tName = (id) => (pool.get(String(id))?.name ?? '?') + '#' + id;

/**
 * 通用行為端：讓 attackerCid 用 attackName 打一個中立高血靶。
 * @param energies 出招者身上**額外**附加的能量 cardId 陣列（cost 另外自動補齊）
 * @param pickIdx  要丟的能量在 energies 裡的索引（送進 action.discardedEnergyIids）
 * @param benchEnergies 備戰第一隻身上附加的能量（測「host 不同 ⇒ 判定不同」）
 */
function attack(attackerCid, attackName, energies, pickIdx, opts = {}) {
  const card = pool.get(String(attackerCid));
  assert.ok(card, '卡池裡沒有 ' + attackerCid);
  const ai = (card.attacks ?? []).findIndex((a) => a.name === attackName);
  assert.ok(ai >= 0, card.name + ' 找不到招式 ' + attackName);
  const cost = card.attacks[ai].cost ?? [];
  const tgt = opts.targetId ?? pickTarget(card.pokemonType, false);
  assert.ok(tgt, '挑不到對 ' + card.pokemonType + ' 中立的高血靶');
  const s0 = createGame({ name: 'P1', entries: [{ cardId: tgt, count: 1 }] },
                        { name: 'P2', entries: [{ cardId: tgt, count: 1 }] }, pool);
  const costEns = cost.map((t) => inst(energyIdFor(t)));
  const extraEns = energies.map((cid) => inst(cid));
  const me = inst(attackerCid, [...costEns, ...extraEns]);
  const bench = [];
  if (opts.benchCid) bench.push(inst(opts.benchCid, (opts.benchEnergies ?? []).map((cid) => inst(cid))));
  const defBench = [];
  if (opts.defBenchCid) defBench.push(inst(opts.defBenchCid));
  const defActive = inst(opts.defActiveCid ?? tgt, (opts.defActiveEnergies ?? []).map((cid) => inst(cid)));
  const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    players: [
      { ...s0.players[0], hand: [], deck: [inst(tgt)], discard: [], prizes: Array.from({ length: 6 }, () => inst(tgt)),
        active: me, bench, energyAttachedThisTurn: true },
      { ...s0.players[1], hand: [], deck: [inst(tgt)], discard: [], prizes: Array.from({ length: 6 }, () => inst(tgt)),
        active: defActive, bench: defBench }] };
  const allExtraIids = [...extraEns.map((e) => e.iid), ...(bench[0]?.energyAttached ?? []).map((e) => e.iid)];
  const chosen = (pickIdx ?? []).map((i) => allExtraIids[i]).filter(Boolean);
  const action = { type: 'ATTACK', attackIndex: ai };
  if (pickIdx) action.discardedEnergyIids = chosen;
  const after = applyAction(st, action, pool);
  assert.ok(after && after !== st, attackName + ' 沒有被引擎接受（cost／前提不成立）');
  assert.ok(after.players[1].active, attackName + ' 打完之後對手戰鬥位不見了（靶被秒殺，換血更厚的）');
  return {
    dealt: after.players[1].active?.damage ?? -1,
    leftActive: after.players[0].active?.energyAttached?.length ?? -1,
    leftBench: after.players[0].bench?.[0]?.energyAttached?.length ?? -1,
    discardIds: (after.players[0].discard ?? []).map((c) => String(c.cardId)),
    logs: (after.log ?? []).map((l) => String(l?.message ?? l?.text ?? l)),
  };
}

console.log('【0】前提哨兵');
T('F0 ★ 本版動到的卡全部找得到（改名／退場要立刻發現，不可靜默 SKIP）', () => {
  const need = { CHARIZ_X, NEW_SKY, ANCIENT, PRISM, MEWTWO_R, SPIDER, TEA, DRUM, GOODDOG, PHEASANT };
  for (const [k, v] of Object.entries(need)) assert.ok(v, '卡池裡找不到 ' + k);
});
T('F0b ★ 卡面逐字查證（本守衛所有斷言的依據；措辭變了就要重新判讀）', () => {
  const atkEffect = (cid, n) => (pool.get(String(cid))?.attacks ?? []).find((a) => a.name === n)?.effect;
  const abEffect = (cid, n) => (pool.get(String(cid))?.abilities ?? []).find((a) => a.name === n)?.effect;
  assert.strictEqual(atkEffect(CHARIZ_X, '烈獄狂火X'),
    '將自己的場上寶可夢身上附加的任意數量的【火】能量卡丟棄，造成其張數×90點傷害。');
  assert.strictEqual(atkEffect(SPIDER, '放電'),
    '將這隻寶可夢身上附加的【雷】能量卡全部丟棄，造成其張數×50點傷害。');
  assert.strictEqual(atkEffect(TEA, '傾瀉茶'),
    '將最多3張自己的場上寶可夢身上附加的【草】能量卡丟棄，造成其張數×70點傷害。');
  assert.strictEqual(atkEffect(DRUM, '極降駕'),
    '將自己的場上寶可夢身上附加的任意數量的基本能量卡丟棄，造成其張數×70點傷害。');
  assert.ok(String(abEffect(GOODDOG, '腎上腺力量')).startsWith('若這隻寶可夢身上附有【惡】能量卡'));
  assert.ok(String(abEffect(PHEASANT, '腎上腺費洛蒙')).startsWith('若這隻寶可夢身上附有【惡】能量卡'));
  // 新衝天能量：本守衛整組斷言的物理基礎
  assert.ok(String(pool.get(String(NEW_SKY))?.rulesText).includes('若附於【2階進化】寶可夢身上，則視為提供2個所有屬性的能量'));
  assert.strictEqual(pool.get(String(CHARIZ_X))?.stage, 'Stage2', '超級噴火龍Xex 不是 Stage2 的話整組前提要重判');
  assert.strictEqual(pool.get(String(MEWTWO_R))?.stage, 'Basic');
});

console.log('\n【A】⭐⭐⭐ 行為端：站長回報的 bug 與同型五處');
T('A1 ⭐⭐⭐ 烈獄狂火X：只丟「新衝天能量」⇒ 90（可以丟得掉，且只算 1 **張**）', () => {
  const r = attack(CHARIZ_X, '烈獄狂火X', [NEW_SKY], [0]);
  assert.strictEqual(r.dealt, 90,
    '實得 ' + r.dealt + '：0 = 還是丟不掉（本版的 bug）；180 = 誤把「2 個能量」當成 2 張卡（站長裁示的單位是**卡**）');
  assert.ok(r.discardIds.includes(String(NEW_SKY)), '新衝天能量沒有真的進棄牌區');
});
T('A1b 烈獄狂火X：基本【火】+ 新衝天 兩張都丟 ⇒ 180（2 張 × 90）', () => {
  const r = attack(CHARIZ_X, '烈獄狂火X', [energyIdFor('Fire'), NEW_SKY], [0, 1]);
  assert.strictEqual(r.dealt, 180, '實得 ' + r.dealt);
});
T('A1c 烈獄狂火X：古舊能量（視為 1 個所有屬性）⇒ 90', () => {
  const r = attack(CHARIZ_X, '烈獄狂火X', [ANCIENT], [0]);
  assert.strictEqual(r.dealt, 90, '實得 ' + r.dealt);
});
T('A1d ★★ 反向：同一張新衝天附在**備戰的【基礎】**身上 ⇒ 只視為【無】⇒ 丟不得、0 傷害', () => {
  const r = attack(CHARIZ_X, '烈獄狂火X', [], [0], { benchCid: MEWTWO_R, benchEnergies: [NEW_SKY] });
  assert.strictEqual(r.dealt, 0,
    '實得 ' + r.dealt + ' —— 若這裡有傷害，代表改成了「無條件放行」而不是 host-aware（A1 的綠就沒有意義）');
  assert.strictEqual(r.leftBench, 1, '備戰身上的新衝天不該被丟掉');
});
T('A2 電蜘蛛｜放電：身上 1 張古舊能量 ⇒ 50（張數×50），且古舊真的被丟棄', () => {
  const r = attack(SPIDER, '放電', [ANCIENT], null);
  // cost 的那 1 張基本【雷】本來就算【雷】能量卡 ⇒ 連同古舊共 2 張 = 100
  assert.strictEqual(r.dealt, 100, '實得 ' + r.dealt + '（cost 的基本【雷】1 張 + 古舊 1 張 = 2 張 × 50）');
  assert.ok(r.discardIds.includes(String(ANCIENT)), '古舊能量沒有被丟棄（PRE 算了、POST 卻沒丟＝兩份判準漂移）');
  assert.strictEqual(r.leftActive, 0, '【雷】能量卡應該全部丟光');
});
T('A3 來悲粗茶｜傾瀉茶：基本【草】+ 古舊 + 基本【超】三張全選 ⇒ 只丟 2 張 = 140', () => {
  const r = attack(TEA, '傾瀉茶', [energyIdFor('Grass'), ANCIENT, energyIdFor('Psychic')], [0, 1, 2]);
  assert.strictEqual(r.dealt, 140,
    '實得 ' + r.dealt + '：70 = 古舊沒被認成【草】（本版的 bug）；210 = 連基本【超】都丟了（filter 破了）');
});
T('A4 ⭐ 冰雪巨龍｜凍原堡壘：受害者是【2階進化】且附新衝天 ⇒ 視為附有【水】能量卡 ⇒ -50', () => {
  const FROST = idByName('冰雪巨龍');
  assert.ok(FROST, '卡池裡找不到冰雪巨龍');
  // 受害者：Stage2、無特性、無 rulesText、弱點不是【鬥】（攻擊者夠讚狗是【鬥】）
  let victim = null;
  for (const [id, c] of pool) {
    if (c?.supertype !== 'Pokemon' || c.stage !== 'Stage2') continue;
    if ((c.abilities ?? []).length > 0 || c.rulesText) continue;
    if ((c.hp ?? 0) < 200) continue;
    if (c.weakness?.type === 'Fighting' || c.resistance?.type === 'Fighting') continue;
    victim = id; break;
  }
  assert.ok(victim, '挑不到合適的【2階進化】受害者');
  const base = attack(GOODDOG, '好拳', [], null, { defActiveCid: victim, defBenchCid: FROST });
  const withE = attack(GOODDOG, '好拳', [], null, { defActiveCid: victim, defBenchCid: FROST, defActiveEnergies: [NEW_SKY] });
  assert.strictEqual(base.dealt, 70, '對照組（沒附能量）應為 70，實得 ' + base.dealt + '（靶＝' + tName(victim) + '）');
  assert.strictEqual(withE.dealt, 20,
    '附新衝天後應該被凍原堡壘減 50 ⇒ 20，實得 ' + withE.dealt + '（＝判準還不是 host-aware）');
});
// ⚠ 誠實標註：A5 在 BASE 上也是綠的（BASE 的 inline 判準剛好已經把古舊／稜鏡／火箭隊列齊了）
//   ⇒ 這一條是**零回歸**斷言，不是 HEAD-FAIL。收斂它的理由是 Rule 38（同一判準不可以有兩份：
//   engine 這份與中央 energyProvidesType 各一份，新特殊能量只會被加進其中一邊），
//   零回歸斷言就是用來保證「收斂沒有改壞既有行為」。
T('A5 夠讚狗｜腎上腺力量：身上 1 張古舊能量 ⇒ 最大 HP +100（零回歸：BASE 也綠）', () => {
  const card = pool.get(String(GOODDOG));
  const baseHp = Number(card.hp);
  const bare = getEffectiveHP(inst(GOODDOG, []), pool);
  const withAncient = getEffectiveHP(inst(GOODDOG, [inst(ANCIENT)]), pool);
  assert.notStrictEqual(bare, MISSING, 'getEffectiveHP 缺席（BASE 沙盒）');
  assert.strictEqual(bare, baseHp, '沒附【惡】能量時不該加成，實得 ' + bare);
  assert.strictEqual(withAncient, baseHp + 100, '實得 ' + withAncient + '（古舊能量視為 1 個所有屬性 ⇒ 含【惡】）');
});
T('A6 吉雉雞｜腎上腺費洛蒙：身上 1 張古舊能量 ⇒ 擲幣免傷條件成立', () => {
  const fn = PASSIVE_COIN_AVOID.get('腎上腺費洛蒙');
  assert.ok(typeof fn === 'function', 'PASSIVE_COIN_AVOID 缺「腎上腺費洛蒙」');
  const card = pool.get(String(PHEASANT));
  assert.strictEqual(fn(inst(PHEASANT, [inst(ANCIENT)]), card, pool), true, '古舊能量應視為【惡】能量卡');
  assert.strictEqual(fn(inst(PHEASANT, [inst(energyIdFor('Water'))]), card, pool), false, '基本【水】不該算【惡】');
});
T('A7 ⭐ picker 端的 spec 也吃同一組 filter（原本 registerFieldDiscardMultiply 完全沒傳）', () => {
  const tea = ATTACK_PRE_DISCARD_CHOICE.get('來悲粗茶|傾瀉茶');
  const drum = ATTACK_PRE_DISCARD_CHOICE.get('猛雷鼓ex|極降駕');
  assert.ok(tea && drum, 'spec 不見了');
  assert.strictEqual(tea.energyTypeFilter, 'Grass', '傾瀉茶的 picker 沒有限定【草】⇒ 玩家勾得到、引擎丟不掉');
  assert.strictEqual(drum.basicEnergyOnly, true, '極降駕的 picker 沒有限定基本能量');
  assert.strictEqual(drum.energyTypeFilter, undefined, 'basic 不是屬性，不該塞進 energyTypeFilter');
});

console.log('\n【B】⭐⭐ 反安慰劑／零回歸');
T('B1 ★★ 反安慰劑：同一招打**弱點靶**必須兩倍（證明 A 組的靶真的有避開弱點）', () => {
  const weak = pickTarget(pool.get(String(CHARIZ_X))?.pokemonType, true);
  assert.ok(weak, '挑不到弱【火】的高血靶');
  const r = attack(CHARIZ_X, '烈獄狂火X', [NEW_SKY], [0], { targetId: weak });
  assert.strictEqual(r.dealt, 180, '弱點靶應吃兩倍（180），實得 ' + r.dealt + ' ⇒ A 組的「中立」判斷失效');
});
T('B2 中央述詞 preDiscardEnergyEligible：同一張新衝天，host 不同答案就不同', () => {
  const onStage2 = { cardId: String(CHARIZ_X), energyAttached: [] };
  const onBasic = { cardId: String(MEWTWO_R), energyAttached: [] };
  assert.strictEqual(preDiscardEnergyEligible(onStage2, { cardId: String(NEW_SKY) }, pool, { type: 'Fire' }), true);
  assert.strictEqual(preDiscardEnergyEligible(onBasic, { cardId: String(NEW_SKY) }, pool, { type: 'Fire' }), false);
  // 稜鏡能量剛好相反（附【基礎】才是全屬性）⇒ 兩條方向相反，證明不是「一律 true」
  assert.strictEqual(preDiscardEnergyEligible(onBasic, { cardId: String(PRISM) }, pool, { type: 'Fire' }), true);
  assert.strictEqual(preDiscardEnergyEligible(onStage2, { cardId: String(PRISM) }, pool, { type: 'Fire' }), false);
});
T('B3 零回歸：basicOnly 與 type 正交 —— 新衝天在 Stage2 上算【火】，但它不是**基本**能量卡', () => {
  const onStage2 = { cardId: String(CHARIZ_X), energyAttached: [] };
  assert.strictEqual(preDiscardEnergyEligible(onStage2, { cardId: String(NEW_SKY) }, pool, { basicOnly: true }), false);
  assert.strictEqual(preDiscardEnergyEligible(onStage2, { cardId: String(NEW_SKY) }, pool, { basicOnly: true, type: 'Fire' }), false);
  assert.strictEqual(preDiscardEnergyEligible(onStage2, { cardId: String(energyIdFor('Fire')) }, pool, { basicOnly: true, type: 'Fire' }), true);
});
T('B4 ⭐⭐ Rule 38：hostHasEnergyType 必須呼叫 hostEnergyCardsOfType，不可以自己再寫一次 some(', () => {
  const src = normEol(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
  const i = src.indexOf('export function hostHasEnergyType(');
  assert.ok(i > 0, '找不到 hostHasEnergyType');
  const body = src.slice(i, src.indexOf('\n}', i));
  assert.ok(body.includes('hostEnergyCardsOfType('), 'hostHasEnergyType 沒有委派給 hostEnergyCardsOfType');
  assert.ok(!/\.some\(/.test(body), 'hostHasEnergyType 裡自己寫了 some( ⇒ 判準又變成兩份');
  assert.ok(body.length < 400, '抓到的 body 太長（anchor 失效）：' + body.length);
  // 行為端再確認一次兩者一致（靜態＋行為雙保險）
  const host = { cardId: String(CHARIZ_X), energyAttached: [{ iid: 'x', cardId: String(NEW_SKY) }] };
  assert.strictEqual(hostHasEnergyType(host, 'Fire', pool), hostEnergyCardsOfType(host, 'Fire', pool).length > 0);
});

console.log('\n【C】⭐⭐ 靜態掃描：不准再有第二份「附加能量的屬性判準」');
/**
 * ⚠ 掃描器本身要先被驗證會不會漏（本 skill 連續三版踩到的坑）：
 *   ・不只掃字面，先把「body 裡寫了 naive 屬性判準」的 **local helper 名字**掃出來，
 *     再把它們加進偵測集 —— 否則 `providesFireEnergy(...)` 這種包一層的寫法會整個逃掉
 *     （v6.398 第一版掃描器就是這樣漏掉站長回報的那張卡的）。
 *   ・下限斷言：掃到的 energyAttached 視窗數必須夠多，否則是掃描器壞了。
 *   ・正對照：人造的違規樣本必須被抓到。
 *
 * ⚠⚠ 誠實標註這支掃描器的**已知盲點**（它是啟發式，主防線是上面的 A 組行為端）：
 *   三個豁免（走中央／卡面寫「基本」／按卡名精確比對）都是**視窗級**的 ——
 *   同一個 ±8 行視窗裡若 basic 判準與非 basic 判準混寫，後者會跟著被放行。
 *   實例：G 標 v2999_g3_wave1.ts 的 gearCoatingReduce（第一條是 basic【鋼】、第二條是裸的
 *   pokemonType === 'Metal'）就是這樣被遮住的 —— 它是 G 標，本來就不在處理範圍，
 *   但這代表**「C1 綠」不等於「全站沒有第二份判準」**，只等於「沒有整段都在裸寫的」。
 *   改成行級豁免試過：跨行寫的 const isBasicGrass = ... 與「寶可夢」的 pokemonType 會大量誤報，
 *   反而逼人去加白名單（型態 7 的溫床）⇒ 維持視窗級，盲點寫在這裡讓後人看得到。
 */
const SCAN_DIRS = ['src/lib/game', 'src/lib/game/effects', 'src/lib/game/effects/cards', 'src/routes/game'];
const BASE_NAIVE = "energyMatchesType|isEnergyOfType|pokemonType\\s*===\\s*'|name\\.includes\\('【|/【.】/\\.test";
/** host-aware 的中央出口（視窗裡出現其一 ⇒ 這段已經走中央）。 */
const HOST_RE = /energyProvidesType|energyTypeUnitsHostAware|preDiscardEnergyEligible|countEnergyTypeHostAware|hostEnergyCardsOfType|hostHasEnergyType|getEnergyDiscardUnits|totalEnergyUnits|countOneEnergy|countAttachedEnergyAsUnits|countEnergy\(/;
/** 卡面寫「**基本**【X】能量」⇒ 基本能量沒有 host-aware 問題，naive 判準是對的。 */
const BASIC_ONLY_RE = /subtype\s*[!=]==\s*'Basic'/;
/** 按**卡名**精確比對（薄霧能量／伏特【雷】能量…）⇒ 不是屬性判準。 */
const BY_NAME_RE = /\.name\s*===\s*'/;

/**
 * 白名單：每一條都必須附「為什麼安全」。
 * ⚠⚠ 型態 7 的教訓：白名單判錯一次就放行了 KO 級的傷害 bug ⇒ 理由要寫到可被複查。
 */
const C1_ALLOW = [
  { file: 'src/lib/game/ai.ts', needle: '_canDragapultPhantomStrike',
    why: 'AI 估值啟發式（「多龍巴魯托ex 身上有沒有火與超」只用來決定 AI 要不要考慮這一招），不是卡面判準；算少了只會讓 AI 保守一點，不影響對戰結果正確性。' },
  { file: 'src/lib/game/ai.ts', needle: 'maxFightNeed',
    why: 'AI 估值啟發式（估「這隻身上的鬥能量夠不夠打」）；同上，不是卡面判準。' },
  { file: 'src/lib/game/ai.ts', needle: 'const countOn = (inst: CardInstance',
    why: 'AI 估值啟發式（估「這隻身上火／超／惡各幾個」來決定 AI 把手牌能量附給誰）；不是卡面判準，估少了只會讓 AI 的附能選擇略差，不影響對戰結果。' },
  { file: 'src/lib/game/effects/cards/v2660_i_wave16_misc9.ts', needle: '龍之猛暴',
    why: '偵測器的已知誤報：這個視窗裡命中的 pokemonType === \'Dragon\' 判的是**寶可夢**的屬性（場上有沒有【龍】寶可夢），不是能量的屬性；龍之猛暴附的是從棄牌區撿回的基本【火】能量，整段不涉及「附加能量的屬性篩選」。' },
];

function scanNaive() {
  const files = [];
  for (const d of SCAN_DIRS) {
    for (const f of readdirSync(join(ROOT, d))) {
      const p = join(ROOT, d, f);
      if (!statSync(p).isFile()) continue;
      if (!f.endsWith('.ts') && !f.endsWith('.svelte')) continue;
      files.push([d + '/' + f, p]);
    }
  }
  const srcs = new Map();
  for (const [rel, p] of files) {
    const raw = normEol(readFileSync(p, 'utf8'));
    let s; try { s = stripCommentsBlankChecked(raw, rel); } catch { s = raw; }
    srcs.set(rel, s);
  }
  // 第一輪：local naive helper 名稱（語義擴張）
  const helperNames = new Set();
  for (const [, s] of srcs) {
    const fnRe = /function\s+([A-Za-z0-9_$]+)\s*\(/g;
    let m;
    while ((m = fnRe.exec(s))) {
      const start = s.indexOf('{', m.index + m[0].length - 1);
      if (start < 0) continue;
      let d = 0, end = -1;
      for (let i = start; i < s.length && i < start + 3000; i++) {
        if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } }
      }
      if (end < 0) continue;
      const body = s.slice(start, end);
      if (new RegExp(BASE_NAIVE).test(body) && !HOST_RE.test(body)
          && !BASIC_ONLY_RE.test(body) && !BY_NAME_RE.test(body)) helperNames.add(m[1]);
    }
  }
  const extra = [...helperNames].filter((n) => !/^(isEnergyOfType|energyMatchesType)$/.test(n));
  const NAIVE = new RegExp(BASE_NAIVE + (extra.length ? '|' + extra.map((n) => '\\b' + n + '\\s*\\(').join('|') : ''));
  const hits = [];
  let windows = 0;
  for (const [rel, s] of srcs) {
    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/energyAttached/.test(lines[i])) continue;
      windows++;
      const lo = Math.max(0, i - 8), hi = Math.min(lines.length, i + 9);
      const win = lines.slice(lo, hi).join('\n');
      if (!NAIVE.test(win)) continue;
      if (HOST_RE.test(win) || BASIC_ONLY_RE.test(win) || BY_NAME_RE.test(win)) continue;
      hits.push({ rel, line: i + 1, win });
    }
  }
  return { hits, windows, extra, NAIVE };
}

T('C1 ⭐⭐⭐ 全站掃描：對 energyAttached 的屬性判準，只剩白名單裡那幾條', () => {
  const { hits, windows, extra } = scanNaive();
  assert.ok(windows > 120, '只掃到 ' + windows + ' 個 energyAttached 視窗 ⇒ 掃描器壞了（下限斷言）');
  const left = hits.filter((h) => !C1_ALLOW.some((a) => a.file === h.rel && h.win.includes(a.needle)));
  assert.strictEqual(left.length, 0,
    '有 ' + left.length + ' 處沒走中央 host-aware 述詞：\n'
    + left.map((h) => '  ' + h.rel + ':' + h.line + '\n' + h.win.split('\n').map((t) => '      ' + t.trim()).filter((t) => t.trim()).join('\n')).join('\n'));
  // 白名單不得有死條目（對應的程式碼被刪了還留著 ⇒ 下次有人新增同名的就白白放行）
  for (const a of C1_ALLOW) {
    assert.ok(hits.some((h) => h.rel === a.file && h.win.includes(a.needle)),
      '白名單死條目：' + a.file + ' / ' + a.needle + '（已經沒有對應的違規了，請刪掉）');
  }
  console.log('        （掃了 ' + windows + ' 個視窗，語義擴張出的 local helper ' + extra.length + ' 個，白名單 ' + C1_ALLOW.length + ' 條）');
});
T('C1b ★★ 正對照：人造的違規樣本必須被同一支偵測器抓到（否則 C1 是空真）', () => {
  const { NAIVE } = scanNaive();
  const bad = "for (const e of pk.energyAttached) {\n  const ec = pool.get(e.cardId);\n  if (ec.pokemonType === 'Fire') n++;\n}";
  assert.ok(NAIVE.test(bad), '偵測器對明顯的違規樣本沒反應');
  assert.ok(!HOST_RE.test(bad) && !BASIC_ONLY_RE.test(bad) && !BY_NAME_RE.test(bad), '三個豁免條件誤放行了違規樣本');
  // 反向：走中央的寫法必須被放行
  const good = "for (const e of hostEnergyCardsOfType(pk, 'Fire', pool)) ids.add(e.iid);";
  assert.ok(HOST_RE.test(good), '走中央的寫法被誤判為違規');
});
T('C2 ⭐ 本版收斂掉的 local 述詞真的不見了（不是留在原地沒人用）', () => {
  const gone = [
    ['src/lib/game/effects/cards/m2_dragon_charizard_batch.ts', 'function providesFireEnergy'],
    ['src/lib/game/effects/cards/m5_preview.ts', 'function providesFireEnergy'],
    ['src/lib/game/effects/cards/v2660_i_wave16_misc9.ts', 'function _isLightningEnergy'],
  ];
  for (const [rel, needle] of gone) {
    const src = normEol(readFileSync(join(ROOT, rel), 'utf8'));
    assert.ok(!src.includes(needle), rel + ' 還留著 ' + needle + '（Rule 38：判準留兩份＝守衛必然是安慰劑）');
  }
});

console.log('\n【D】chain');
T('D1 本守衛已掛進 npm test chain', () => {
  assert.ok(readFileSync(join(ROOT, 'package.json'), 'utf8').includes('test-v6398-host-aware-energy-card.mjs'));
});

console.log('\n=== v6.398 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
