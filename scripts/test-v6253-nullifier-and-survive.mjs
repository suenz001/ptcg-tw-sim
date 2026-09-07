/**
 * v6.253 守衛：
 *   A. 「特性消除源」自身必須處於生效狀態 —— 中央述詞 isNullifierAbilityEffective。
 *      站長回報：振翼髮｜暗夜羽擊 消除了對手戰鬥場鐵荊棘ex 的全部特性，但備戰的
 *      拉帝亞斯ex｜天空徑線 仍被「初始化」壓著（0 能量撤退不了）。
 *      根因：isInitializeNullified 只問「場上有沒有印著初始化的卡」。
 *   B. 「這一擊之後還在場上」＝ 受到傷害但未昏厥 —— 中央述詞 defenderSurvivedAttack。
 *      站長回報：岩殿居蟹｜結實 擋下昏厥後，身上的手持循環扇沒有觸發。
 *      根因：engine ATTACK 主管線 `if(!preventedKO && wouldBeKO){…} else if(!preventedKO){…}`
 *            ⇒ preventedKO 時兩個分支都不跑，TOOL_ON_DAMAGED 整批靜默漏掉。
 *
 * 官方依據（PTCG RULES/PTCG_RULES.md）：
 *   L1935 / L2733 / L2818「特性『初始化』**處於生效狀態**的鐵荊棘ex」
 *   L1594 / L2505「特性『暗夜羽擊』**處於有效狀態**的振翼髮」
 *   L1899 / L1901（勤奮之心）、L2650（堅忍之軀）：以剩餘 HP 10 留在場上 ⇒ 沒有昏厥。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked, stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.v6253-e.ts'), O = join(ROOT, '.v6253-o.mjs'), S = join(ROOT, '.v6253-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction, getRetreatCost, getUsableAbilities } from './src/lib/game/engine';
export { isAbilityHolderEffective, isInitializeNullified, isAbilityNullifiedBySticky, isNullifierAbilityEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';
export { TOOL_ON_DAMAGED, SPECIAL_ENERGY_ON_DAMAGED, PASSIVE_PREVENT_KO, TOOL_PREVENT_KO } from './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, getRetreatCost, getUsableAbilities,
        isAbilityHolderEffective, isInitializeNullified, isAbilityNullifiedBySticky, isNullifierAbilityEffective,
        TOOL_ON_DAMAGED, SPECIAL_ENERGY_ON_DAMAGED, PASSIVE_PREVENT_KO, TOOL_PREVENT_KO } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
const liveCards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark)) liveCards.push(c);
  }
}

const ID = {
  MOON: '11597',   // 振翼髮（暗夜羽擊）
  THORN: '16753',  // 鐵荊棘ex（初始化・未來）
  LATEX: '14735',  // 拉帝亞斯ex（天空徑線）
  UBO: '17976',    // 帕底亞 烏波（HP60・無特性 Basic）
  LATI: '16782',   // 拉帝亞斯（無特性 Basic）
  CRAB: '13741',   // 岩殿居蟹 SV11B（結實・HP150・Stage1）
  PIKA: '14704',   // 皮卡丘ex（勤奮之心・HP200）
  HAWL: '14754',   // 超級摔角鷹人ex（堅忍之軀・HP250）
  ORAN: '19183',   // 棄世猴（不朽身軀・HP150・Stage2）
  SEA: '11246',    // 海兔獸（黏著束縛・Stage1）
  GOLD: '14693',   // 哥達鴨（濕氣・Stage1）
  MAGNE: '14706',  // 三合一磁怪（過度放電・Stage1）
  FAN: '10509',    // 手持循環扇
  HELM: '10307',   // 幸運頭盔（抽 2）
  SURV: '10306',   // 倖存鍛鍊器
  SMASH: '12562',  // 扣殺能量（受傷 → 攻擊方 +2 指示物）
  DIALGA: '11072', // 帝牙盧卡（光炮尾 160，attackIndex=1）
  EEVEE: '17037',  // 伊布ex（石英閃耀 200，attackIndex=0）
  CAVE: '19623',   // 傳說的熔岩洞
  WATCH: '14849',  // 火箭隊的監視塔
  eGrass: '14102', eP: '14103', eF: '14104', eFire: '14428', eDark: '14430',
  eMetal: '14434', eWater: '18519', eLight: '18520',
};

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkP = (name, active, bench = []) => ({ name, active, bench, hand: [],
  deck: Array.from({ length: 12 }, () => en(ID.eP)), discard: [],
  prizes: Array.from({ length: 6 }, () => en(ID.eP)) });
const mkS = (p0, p1, stadium = null) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 5,
  isFirstTurn: false, firstPlayerIdx: 0, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], log: [], pendingSelection: null,
  activeStadium: stadium ? inst(stadium) : null, players: [p0, p1] });
const logHas = (s, t) => s.log.some(l => (l.message ?? '').includes(t));

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const ORND = Math.random;
const heads = () => { Math.random = () => 0.1; };
const rstRnd = () => { Math.random = ORND; };

// ══════════════════════════════════════════════════════════════════════
console.log('A. 特性消除源自身必須處於生效狀態');
const bug1 = (p0Active, p1Active, stadium = null) =>
  mkS(mkP('P0', inst(p0Active), [inst(ID.LATEX), inst(ID.LATI)]), mkP('P1', inst(p1Active), [inst(ID.UBO)]), stadium);

T('A1 前提：暗夜羽擊確實消除了鐵荊棘ex 的「初始化」', () => {
  const s = bug1(ID.MOON, ID.THORN);
  assert.equal(isAbilityHolderEffective(s, s.players[1].active, pool.get(ID.THORN), 1, '初始化', 'active', pool), false);
});
T('A2 ⭐消除源失效 ⇒ isInitializeNullified(拉帝亞斯ex)=false', () => {
  const s = bug1(ID.MOON, ID.THORN);
  assert.equal(isInitializeNullified(s, pool.get(ID.LATEX), pool), false);
});
T('A3 ⭐天空徑線恢復 ⇒ getRetreatCost=0', () => {
  assert.equal(getRetreatCost(bug1(ID.MOON, ID.THORN), pool), 0);
});
T('A4 ⭐0 能量真的撤退得了（行為端 applyAction）', () => {
  const s = bug1(ID.MOON, ID.THORN);
  const r = applyAction(s, { type: 'RETREAT', newActiveIid: s.players[0].bench[1].iid }, pool);
  assert.equal(r.players[0].active?.cardId, ID.LATI);
});
T('A5 正對照：沒有振翼髮 ⇒ 初始化照常壓制，撤退費回到 1', () => {
  const s = bug1(ID.LATI, ID.THORN);
  assert.equal(isInitializeNullified(s, pool.get(ID.LATEX), pool), true);
  assert.equal(getRetreatCost(s, pool), 1);
  const r = applyAction(s, { type: 'RETREAT', newActiveIid: s.players[0].bench[1].iid }, pool);
  assert.equal(r.players[0].active?.cardId, ID.LATI, '0 能量不該撤退成功');
});
T('A6 正對照：沒有鐵荊棘ex ⇒ 天空徑線本來就有效，撤退費 0', () => {
  assert.equal(getRetreatCost(bug1(ID.MOON, ID.UBO), pool), 0);
});
T('A7 招式版消除（abilityNullifiedThisTurn）也讓初始化失效', () => {
  const s = mkS(mkP('P0', inst(ID.LATI), [inst(ID.LATEX), inst(ID.LATI)]),
                mkP('P1', inst(ID.THORN, [], { abilityNullifiedThisTurn: true }), [inst(ID.UBO)]));
  assert.equal(isInitializeNullified(s, pool.get(ID.LATEX), pool), false);
  assert.equal(getRetreatCost(s, pool), 0);
});
T('A8 不得過度修：鐵荊棘ex 是「未來」⇒ 對手的鐵荊棘ex 打不到它，初始化仍生效', () => {
  const s = bug1(ID.THORN, ID.THORN);
  assert.equal(isInitializeNullified(s, pool.get(ID.LATEX), pool), true);
  assert.equal(getRetreatCost(s, pool), 4, '鐵荊棘ex 撤退費 4');
});
T('A9 遞迴防護：雙方各有消除源時不得無窮遞迴（實跑不得拋 RangeError）', () => {
  const s = mkS(mkP('P0', inst(ID.MOON), [inst(ID.LATEX), inst(ID.SEA)]),
                mkP('P1', inst(ID.THORN), [inst(ID.SEA), inst(ID.ORAN)]), ID.CAVE);
  assert.equal(typeof isInitializeNullified(s, pool.get(ID.LATEX), pool), 'boolean');
  assert.equal(typeof isAbilityNullifiedBySticky(s, s.players[1].bench[1], pool.get(ID.ORAN), true, pool), 'boolean');
  assert.equal(typeof getRetreatCost(s, pool), 'number');
});
T('A10 黏著束縛：熔岩洞消除海兔獸（1階進化）的黏著束縛 ⇒ 不再壓制備戰 2 階', () => {
  const withCave = mkS(mkP('P0', inst(ID.LATI), [inst(ID.SEA), inst(ID.ORAN)]), mkP('P1', inst(ID.UBO)), ID.CAVE);
  assert.equal(isAbilityNullifiedBySticky(withCave, withCave.players[0].bench[1], pool.get(ID.ORAN), true, pool), false);
  const noCave = mkS(mkP('P0', inst(ID.LATI), [inst(ID.SEA), inst(ID.ORAN)]), mkP('P1', inst(ID.UBO)));
  assert.equal(isAbilityNullifiedBySticky(noCave, noCave.players[0].bench[1], pool.get(ID.ORAN), true, pool), true,
    '正對照：沒有熔岩洞時黏著束縛照常壓制');
});
T('A11 中央述詞本身：isNullifierAbilityEffective 對「有效／被消除」兩態都答得出來', () => {
  const nul = bug1(ID.MOON, ID.THORN);
  assert.equal(isNullifierAbilityEffective(nul, nul.players[1].active, pool.get(ID.THORN), 1, '初始化', 'active', pool), false);
  const eff = bug1(ID.LATI, ID.THORN);
  assert.equal(isNullifierAbilityEffective(eff, eff.players[1].active, pool.get(ID.THORN), 1, '初始化', 'active', pool), true);
});

// ══════════════════════════════════════════════════════════════════════
console.log('B. 防 KO 成功 ＝「受到傷害但未昏厥」，受傷觸發必須照跑');
// 攻擊方：帝牙盧卡 光炮尾（attackIndex=1，160）／伊布ex 石英閃耀（attackIndex=0，200）
const atkDialga = () => inst(ID.DIALGA, [en(ID.eP), en(ID.eMetal), en(ID.eP)]);
const atkEevee = () => inst(ID.EEVEE, [en(ID.eFire), en(ID.eWater), en(ID.eLight)]);

function runAttack(defInst, attacker, attackIndex) {
  const s = mkS(mkP('P0', attacker, [inst(ID.UBO)]), mkP('P1', defInst, [inst(ID.UBO)]));
  return applyAction(s, { type: 'ATTACK', attackIndex }, pool);
}

T('B1 ⭐結實（滿血防 KO）→ 手持循環扇照常觸發', () => {
  const r = runAttack(inst(ID.CRAB, [], { damage: 0, toolAttached: inst(ID.FAN) }), atkDialga(), 1);
  assert.equal(r.players[1].active?.damage, 140, '結實留 10HP');
  assert.equal(r.pendingSelection?.effectKey, 'cycle-fan-step1-pick-energy');
  assert.ok(logHas(r, '手持循環扇'));
});
T('B2 ⭐勤奮之心（皮卡丘ex 滿血防 KO）→ 幸運頭盔照常抽 2 張', () => {
  const r = runAttack(inst(ID.PIKA, [], { damage: 0, toolAttached: inst(ID.HELM) }), atkEevee(), 0);
  assert.equal(r.players[1].active?.damage, 190, '勤奮之心留 10HP');
  assert.ok(logHas(r, '幸運頭盔'));
  assert.equal(r.players[1].hand.length, 2, '恰好抽 2 張（不得重複觸發成 4 張）');
});
T('B3 ⭐堅忍之軀（擲幣正面防 KO）→ 幸運頭盔照常觸發', () => {
  heads();
  try {
    const r = runAttack(inst(ID.HAWL, [], { damage: 150, toolAttached: inst(ID.HELM) }), atkDialga(), 1);
    assert.equal(r.players[1].active?.damage, 240, '堅忍之軀留 10HP');
    assert.ok(logHas(r, '幸運頭盔'));
    assert.equal(r.players[1].hand.length, 2);
  } finally { rstRnd(); }
});
T('B4 ⭐不朽身軀（擲幣正面防 KO）→ 幸運頭盔照常觸發', () => {
  heads();
  try {
    const r = runAttack(inst(ID.ORAN, [], { damage: 20, toolAttached: inst(ID.HELM) }), atkDialga(), 1);
    assert.equal(r.players[1].active?.damage, 140, '不朽身軀留 10HP');
    assert.ok(logHas(r, '幸運頭盔'));
  } finally { rstRnd(); }
});
T('B5 ⭐倖存鍛鍊器（道具防 KO）→ 扣殺能量（特殊能量受傷觸發）照常對攻擊方放指示物', () => {
  const r = runAttack(inst(ID.UBO, [en(ID.SMASH)], { damage: 0, toolAttached: inst(ID.SURV) }), atkDialga(), 1);
  assert.equal(r.players[1].active?.damage, 50, '烏波 HP60 → 留 10HP');
  assert.ok(r.players[0].active.damage >= 20, `扣殺能量該讓攻擊方 +20（實際 ${r.players[0].active.damage}）`);
});
T('B6 正對照：防 KO 生效時 damage 必須是 leaveHP，不得被蓋回致死值', () => {
  const r = runAttack(inst(ID.CRAB, [], { damage: 0, toolAttached: inst(ID.FAN) }), atkDialga(), 1);
  assert.equal(r.players[1].active?.cardId, ID.CRAB, '不得被打死');
  assert.equal(r.players[1].active?.damage, 140);
  assert.equal(r.pendingPrizes?.[0] ?? 0, 0, '沒有昏厥 ⇒ 對手不得獲得獎賞');
});
T('B7 正對照：沒有防 KO 時的 KO 行為不變（扇子走 KO 鏡射，只觸發一次）', () => {
  const r = runAttack(inst(ID.UBO, [], { damage: 0, toolAttached: inst(ID.HELM) }), atkDialga(), 1);
  assert.equal(r.players[1].active, null, '烏波應被 KO');
  assert.equal(r.players[1].hand.length, 2, '幸運頭盔恰好 2 張');
});
T('B8 正對照：一般「受傷但沒死」（沒有任何防 KO）行為不變', () => {
  // 帝牙盧卡 160 vs 皮卡丘ex HP200 ⇒ 不致命，勤奮之心根本不會被叫到
  const r = runAttack(inst(ID.PIKA, [], { damage: 0, toolAttached: inst(ID.HELM) }), atkDialga(), 1);
  assert.equal(r.players[1].active?.damage, 160, '一般受傷 ⇒ damage = 實際傷害');
  assert.equal(r.players[1].hand.length, 2, '幸運頭盔恰好 2 張');
  assert.ok(!logHas(r, '勤奮之心'), '沒到致命線就不該叫防 KO');
});
T('B9 正對照：防 KO 後 damageTakenLastOppTurn 有累計（重裝角擊追蹤）', () => {
  // ⭐v6.255 站長裁定「改成實際扣到的」：岩殿居蟹 HP150 被 160 打、結實留 HP10
  //   ⇒ 身上指示物 = 140（官方 PTCG_RULES.md L1933-1934 同型：HP−10，不是招式全額）。
  //   v6.253/6.254 這裡記 160（全額 baseDamage）⇒ 重裝角擊會多打 20。
  const r = runAttack(inst(ID.CRAB, [], { damage: 0, toolAttached: inst(ID.FAN) }), atkDialga(), 1);
  assert.equal(r.players[1].active?.damage, 140, '結實留 HP10 ⇒ 指示物 140');
  assert.equal(r.players[1].active?.damageTakenLastOppTurn, 140,
    '防 KO 時「受到的傷害」＝實際扣到的 140，不是招式全額 160');
});

// ══════════════════════════════════════════════════════════════════════
console.log('C. 枚舉守衛（下限斷言 ＋ 正對照）');
T('C1 卡面枚舉：live H/I/J 的「不會昏厥／留在場上」來源全部有實裝', () => {
  const found = [];
  for (const c of liveCards) {
    for (const ab of (c.abilities ?? [])) {
      if (/不會【昏厥】/.test(ab.effect ?? '')) found.push({ kind: 'ability', name: ab.name });
    }
    if (/不會【昏厥】/.test(c.rulesText ?? '')) found.push({ kind: 'tool', name: c.name });
  }
  const abNames = new Set(found.filter(f => f.kind === 'ability').map(f => f.name));
  const toolNames = new Set(found.filter(f => f.kind === 'tool').map(f => f.name));
  // ⭐v6.325：下限自 4 收緊到 4（實測 4；已在實測值上、slack 0，再收就是誤紅）。
  assert.ok(abNames.size >= 4, `掃描器下限：特性型防 KO 應 ≥4（實得 ${abNames.size}）— 掃不到＝掃描器壞了`);
  assert.ok(toolNames.size >= 1, `掃描器下限：道具型防 KO 應 ≥1（實得 ${toolNames.size}）`);
  for (const n of abNames) assert.ok(PASSIVE_PREVENT_KO.has(n), `特性「${n}」卡面寫不會昏厥但沒進 PASSIVE_PREVENT_KO`);
  for (const n of toolNames) assert.ok(TOOL_PREVENT_KO.has(n), `道具「${n}」卡面寫不會昏厥但沒進 TOOL_PREVENT_KO`);
});
T('C2 下限斷言：「受到傷害時」的道具／特殊能量登錄數不得歸零', () => {
  assert.ok(TOOL_ON_DAMAGED.size >= 7, `TOOL_ON_DAMAGED 應 ≥7（實得 ${TOOL_ON_DAMAGED.size}）`);
  assert.ok(SPECIAL_ENERGY_ON_DAMAGED.size >= 1, `SPECIAL_ENERGY_ON_DAMAGED 應 ≥1（實得 ${SPECIAL_ENERGY_ON_DAMAGED.size}）`);
});

// ── lint：靜態樣式檢查（各配「抓得到」的正對照） ──────────────────────
// ⚠ 一律先剝註解再比對 —— 否則「說明這個違規寫法」的註解本身會被自己的 lint 抓到
//   （本檔第一版就踩了這個雷；同 IRON_RULES Rule 25.4）。
// ⭐v6.325 批2：區塊註解剝除改走中央 helper（scripts/lib/strip-comments.mjs 的行級狀態機）。
//   ⚠ 原本的 `/\/\*[\s\S]*?\*\//g` 會被**行註解裡的** `cards/*.ts` 這種字樣騙開假區塊：
//     effects.ts 有兩處（:27 的 `effects/cards/*.ts` 吃到 :147、:7905 的 `cards/*.ts` 吃到 :8203），
//     合計把 273 行真程式碼變成空白 ⇒ 掃在那段裡的違規一律靜默漏掉。
//   ⚠ 一律用**等長留白**版（不是刪行版）：本檔靠行號／位移回報，刪行會讓行號整體位移。
//   ⚠ 行尾 `//` 的處理**保留在這裡** —— 中央 helper 只剝行首 `//`，正向斷言目標若落在
//     行尾註解裡會假綠。行尾正則是單行、不跨行 ⇒ 不會像區塊正則那樣開洞。
const stripComments = (s, label = '') => stripCommentsBlankChecked(s, { label }).replace(/\/\/.*$/gm, '');
// ⚠ 合成片段（下面 C3-正對照的三個字串）走**無護欄**的純函式版：護欄①是「整份吐空」
//   偵測器，對「整行都是註解」的合成樣本必然誤炸 —— 那不是放寬，是護欄不適用的場景。
const stripSnippet = (s) => stripCommentsBlank(s).replace(/\/\/.*$/gm, '');
const srcEngine = stripComments(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'), 'engine.ts');
const srcW3 = stripComments(readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8'), 'v3001_g3_wave3.ts');
const BAD_ELSE_RE = /\}\s*else if \(!preventedKO\)\s*\{/;
T('C3 lint：ATTACK 主管線不得再用 `else if (!preventedKO)`（會讓防 KO 掉進無人分支）', () => {
  assert.ok(!BAD_ELSE_RE.test(srcEngine), 'engine.ts 又出現 `} else if (!preventedKO) {`');
  assert.ok(/const defenderSurvivedAttack = !wouldBeKO \|\| preventedKO;/.test(srcEngine), '中央述詞不見了');
  assert.ok(/\}\s*else if \(defenderSurvivedAttack\)\s*\{/.test(srcEngine), '非 KO 分支沒有接上中央述詞');
});
T('C3-正對照：lint 樣式真的抓得到違規寫法（否則它是恆真安慰劑）', () => {
  assert.ok(BAD_ELSE_RE.test(stripSnippet('    } else if (!preventedKO) {\n')), 'lint regex 抓不到已知違規樣本');
  assert.ok(!BAD_ELSE_RE.test(stripSnippet('    } else if (defenderSurvivedAttack) {\n')), 'lint regex 誤報修好的寫法');
  assert.ok(!BAD_ELSE_RE.test(stripSnippet('    // } else if (!preventedKO) { 這只是註解\n')), '剝註解沒生效＝會被自己的說明誤報');
});
const NULLIFIER_SITES = ['初始化', '黏著束縛'];
T('C4 lint：兩個特性型消除源都必須問過持有者有效性（isNullifierAbilityEffective）', () => {
  for (const n of NULLIFIER_SITES) {
    const re = new RegExp(`isNullifierAbilityEffective\\([^)]*'${n}'`);
    assert.ok(re.test(srcW3), `消除源「${n}」沒有接上 isNullifierAbilityEffective`);
  }
  assert.ok(/const _nullifierVisiting = new Set<string>\(\);/.test(srcW3), '遞迴防護集合不見了');
});
T('C4-正對照：C4 的樣式在缺 gate 的樣本上會失敗', () => {
  const fake = "if (ac?.abilities?.some(ab => ab.name === '初始化')) return true;";
  assert.ok(!new RegExp("isNullifierAbilityEffective\\([^)]*'初始化'").test(fake), 'C4 樣式恆真＝安慰劑');
});
// ⭐⭐⭐ v6.255 換掉舊 C5（Fable 5 抓到的**恆真安慰劑**）：
//   舊場景把【傳說的熔岩洞】放在場上，但 三合一磁怪 自己也是【1階進化】
//   ⇒ 過度放電 先被熔岩洞消除 ⇒ listed 恆為 false ⇒ `!(listed && blocked)` 恆真、
//   **不管實作怎麼壞都不可能紅**（Fable 實測 listed=false）。
//   新版改成「同一組卡、兩個方向都真的到得了」的正對照對：
//     ・無消除源 ⇒ 濕氣有效 ⇒ 不列出 **且** 擋下
//     ・我方戰鬥場放振翼髮（暗夜羽擊消除對手戰鬥位特性）⇒ 濕氣失效 ⇒ 列出 **且** 不擋
//   斷言改成 `listed === !blocked`（同一答案）＋兩個方向各自的絕對值，
//   任何一邊壞掉都會紅（突變測試：見 docs/changelog-internal.md v6.255）。
const c5Scene = (moonInPlay) => mkS(
  // P0 戰鬥位：振翼髮（消除源的消除源）或 無特性的拉帝亞斯
  // P0 備戰：三合一磁怪（過度放電；棄牌區要有基本能量才有東西可附）
  mkP('P0', inst(moonInPlay ? ID.MOON : ID.LATI), [inst(ID.MAGNE, [en(ID.eLight)])]),
  // P1 戰鬥位：哥達鴨（濕氣 — 消除「將自己【昏厥】的效果的特性」，過度放電正是這種）
  mkP('P1', inst(ID.GOLD), []));
const c5Run = (moonInPlay) => {
  const s = c5Scene(moonInPlay);
  s.players[0].discard = [en(ID.eP), en(ID.eP)];
  const magne = s.players[0].bench[0];
  const listed = getUsableAbilities(s, pool)
    .some(u => u.iid === magne.iid && u.abilityName === '過度放電');
  const r = applyAction(s, { type: 'USE_ABILITY', iid: magne.iid, abilityIndex: 0 }, pool);
  return { listed, blocked: logHas(r, '濕氣') };
};
T('C5 濕氣（正對照 A）：消除源有效 ⇒ 按鈕不列出 **且** 派發被擋', () => {
  const { listed, blocked } = c5Run(false);
  assert.equal(blocked, true, '哥達鴨的濕氣有效時，過度放電必須被擋（這條紅＝正對照觸發不了）');
  assert.equal(listed, false, '被濕氣消除卻仍列在可用清單 ⇒ 兩份實作分歧');
  assert.equal(listed, !blocked, 'UI 清單與 USE_ABILITY 派發答案不一致');
});
T('C5 濕氣（正對照 B）：消除源自己被暗夜羽擊消除 ⇒ 按鈕列出 **且** 派發不擋', () => {
  const { listed, blocked } = c5Run(true);
  assert.equal(blocked, false, '哥達鴨的濕氣已被暗夜羽擊消除，過度放電不該再被擋（v6.253 的修正）');
  assert.equal(listed, true, '濕氣已失效卻沒把過度放電列回可用清單');
  assert.equal(listed, !blocked, 'UI 清單與 USE_ABILITY 派發答案不一致');
});

console.log(`\n=== v6.253 消除源有效性 ＋ 存活受傷觸發：PASS ${pass} / FAIL ${fail} ===`);
process.exitCode = fail ? 1 : 0;
