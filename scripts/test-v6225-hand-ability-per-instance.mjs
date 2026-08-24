// v6.225 守衛：「每回合限 1 次」的追蹤鍵 —— 手牌特性必須 per-instance（iid），
// SHARED_ONCE_PER_TURN_ABILITY_NAMES（卡面明寫「使用了其他的『XX』的回合無法使用」）
// 仍維持特性名共享。
//
// 站長回報（2026-08-24）：戰鬥場超級袋獸ex＋手牌 2 張烈箭鷹ex（激動俯衝），
// 回合中只能放 1 隻到場上 —— 真因是 getHandActivatableAbilities / USE_HAND_ABILITY
// 用「特性名」記在玩家層級（與 v2.91→v2.93 土龍節節事故同型，手牌路徑當年漏修）。
//
// 卡面（static/cards 台灣官方）：
//   烈箭鷹ex M6#19612（J）激動俯衝：「在自己的回合，若手牌有**這張卡**，且自己的場上有
//     【無】屬性的「超級進化寶可夢【ex】」，則可使用1次。將這張卡放置於備戰區。」
//   齒輪怪 SV7#10964（H）緊急迴轉：「在自己的回合，若手牌有**這張卡**，且對手的場上有
//     【2階進化】寶可夢，則可使用1次。將這張卡放置於備戰區。」
//   ⇒ 主詞「這張卡」= per-instance，兩張各可用一次。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6225-s.js'), E = join(ROOT, '.x6225-e.ts'), O = join(ROOT, '.x6225-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, getHandActivatableAbilities, getUsableAbilities, SHARED_ONCE_PER_TURN_ABILITY_NAMES, isHandAbilityOncePerTurnUsed, markHandAbilityUsed } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
  }
}

// 主角卡（id 寫死＝卡面查證過的那幾張）
const MEGA_KANGA = '14071';  // 超級袋獸ex（I，Colorless Mega ex）
const TALONFLAME = '19612';  // 烈箭鷹ex（J）激動俯衝
const KLINK      = '10964';  // 齒輪怪（H）緊急迴轉
const MOONSTONE  = '16842';  // 月石（I）月光循環 —— SHARED 白名單正對照
const SUNROCK    = [...pool.values()].find((c) => c.name === '太陽岩' && ['H','I','J'].includes(c.regulationMark));
const FIGHT_E    = [...pool.values()].find((c) => c.name === '基本【鬥】能量');
const STAGE2_OPP = [...pool.values()].find((c) => c.supertype === 'Pokemon' && c.stage === 'Stage2'
  && ['H','I','J'].includes(c.regulationMark));
const PLAIN = [...pool.values()].find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && ['H','I','J'].includes(c.regulationMark) && !(c.abilities ?? []).length);

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

const inst = (iid, cardId) => ({ iid, cardId: String(cardId), damage: 0,
  energyAttached: [], evolvedFromStack: [], toolAttached: null });

function mkState({ myActive, myBench = [], myHand = [], oppActive, oppBench = [] }) {
  const side = (i, act, bench, hand) => ({
    name: 'p' + i, active: act, bench, hand,
    deck: Array.from({ length: 10 }, (_, k) => inst(`d${i}${k}`, PLAIN.id)),
    discard: [], prizes: [inst('z' + i, PLAIN.id)],
    retreatedThisTurn: false,
  });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, pendingChainQueue: [],
    setupDone: [true, true], pendingPrizes: [0, 0],
    players: [
      side(0, myActive, myBench, myHand),
      side(1, oppActive, oppBench, []),
    ],
  };
}

console.log('[test-v6225] 手牌特性「每回合限1次」追蹤鍵守衛');

// ── ① 站長情境：超級袋獸ex 在場 + 手牌 3 張烈箭鷹ex → 三隻都放得下 ─────────
T('激動俯衝：3 張烈箭鷹ex 同回合各可用一次（per-instance）', () => {
  let s = mkState({
    myActive: inst('kanga', MEGA_KANGA),
    myHand: [inst('tf1', TALONFLAME), inst('tf2', TALONFLAME), inst('tf3', TALONFLAME)],
    oppActive: inst('oa', PLAIN.id),
  });
  let acts = mod.getHandActivatableAbilities(s, 0, pool);
  ok(acts.length === 3, `初始應列出 3 張，實得 ${acts.length}`);
  for (const iid of ['tf1', 'tf2', 'tf3']) {
    const before = s.players[0].bench.length;
    s = mod.applyAction(s, { type: 'USE_HAND_ABILITY', cardIid: iid, abilityIndex: 0 }, pool);
    ok(s.players[0].bench.length === before + 1,
      `${iid} 應放到備戰（放前 ${before} → 放後 ${s.players[0].bench.length}）—— 第 2/3 張被擋＝name-based 舊 bug`);
  }
  ok(s.players[0].hand.length === 0, '3 張都應離手');
});

// ── ② 齒輪怪｜緊急迴轉（H）同型 ─────────────────────────────────────────────
T('緊急迴轉：2 張齒輪怪同回合各可用一次', () => {
  let s = mkState({
    myActive: inst('me', PLAIN.id),
    myHand: [inst('k1', KLINK), inst('k2', KLINK)],
    oppActive: inst('opp2', STAGE2_OPP.id),
  });
  ok(mod.getHandActivatableAbilities(s, 0, pool).length === 2, '初始應列出 2 張');
  s = mod.applyAction(s, { type: 'USE_HAND_ABILITY', cardIid: 'k1', abilityIndex: 0 }, pool);
  ok(s.players[0].bench.length === 1, '第 1 張應放到備戰');
  const acts2 = mod.getHandActivatableAbilities(s, 0, pool);
  ok(acts2.length === 1 && acts2[0].iid === 'k2', '第 2 張仍應可發動');
  s = mod.applyAction(s, { type: 'USE_HAND_ABILITY', cardIid: 'k2', abilityIndex: 0 }, pool);
  ok(s.players[0].bench.length === 2, '第 2 張也應放到備戰');
});

// ── ③ 正對照：SHARED 白名單（月光循環）不可因本次改動放寬 ───────────────────
T('月光循環：2 顆月石同回合仍共享 1 次（name-based 白名單不放寬）', () => {
  ok(mod.SHARED_ONCE_PER_TURN_ABILITY_NAMES.has('月光循環'), '月光循環必須在 SHARED 白名單');
  let s = mkState({
    myActive: inst('ms1', MOONSTONE),
    myBench: [inst('ms2', MOONSTONE), inst('sun', SUNROCK.id)],
    myHand: [inst('fe1', FIGHT_E.id), inst('fe2', FIGHT_E.id)],
    oppActive: inst('oa', PLAIN.id),
  });
  const u1 = mod.getUsableAbilities(s, pool);
  ok(u1.some((u) => u.iid === 'ms1' && u.abilityName === '月光循環'), '第 1 顆月石應可用');
  s = mod.applyAction(s, { type: 'USE_ABILITY', iid: 'ms1', abilityIndex: 0 }, pool);
  ok((s.players[0].abilityNamesUsedThisTurn ?? []).includes('月光循環'), '使用後應記入特性名（shared）');
  const u2 = mod.getUsableAbilities(s, pool);
  ok(!u2.some((u) => u.abilityName === '月光循環'),
    '第 2 顆月石同回合不得再用（卡面明寫「使用了其他的『月光循環』的回合無法使用」）');
  const s2 = mod.applyAction(s, { type: 'USE_ABILITY', iid: 'ms2', abilityIndex: 0 }, pool);
  ok(s2.players[0].hand.length === s.players[0].hand.length
    && s2.players[0].deck.length === s.players[0].deck.length, '第 2 顆強行派發必須 no-op');
});

// ── ④ 手牌路徑的 SHARED 分支（防未來）：假想白名單特性走 name 共享 ────────────
T('中央述詞：SHARED 名單內的手牌特性以名共享、名單外以 iid 各自計次', () => {
  // 直接驗 getHandActivatableAbilities 讀的是哪個鍵：
  //   把 iid=tfX 記進 handAbilityUsedIidsThisTurn → 只有那張消失，其他同名仍在。
  let s = mkState({
    myActive: inst('kanga', MEGA_KANGA),
    myHand: [inst('tfA', TALONFLAME), inst('tfB', TALONFLAME)],
    oppActive: inst('oa', PLAIN.id),
  });
  s.players[0].handAbilityUsedIidsThisTurn = ['tfA'];
  const acts = mod.getHandActivatableAbilities(s, 0, pool);
  ok(acts.length === 1 && acts[0].iid === 'tfB',
    `iid=tfA 已用過時應只列 tfB，實得 ${JSON.stringify(acts.map((a) => a.iid))}`);
  // name 記錄（abilityNamesUsedThisTurn）對**非白名單**手牌特性不得有擋人效果
  let s2 = mkState({
    myActive: inst('kanga', MEGA_KANGA),
    myHand: [inst('tfC', TALONFLAME)],
    oppActive: inst('oa', PLAIN.id),
  });
  s2.players[0].abilityNamesUsedThisTurn = ['激動俯衝'];
  ok(mod.getHandActivatableAbilities(s2, 0, pool).length === 1,
    '非白名單特性不得被 abilityNamesUsedThisTurn（名共享）擋 —— 擋了＝退回舊 bug');
  // 中央 helper 單元斷言（若未來有白名單特性走手牌路徑，SHARED 分支必須以名共享）：
  const pl0 = { abilityNamesUsedThisTurn: undefined, handAbilityUsedIidsThisTurn: undefined };
  const plShared = mod.markHandAbilityUsed(pl0, '月光循環', 'iidX');
  ok(mod.isHandAbilityOncePerTurnUsed(plShared, '月光循環', 'iidY') === true,
    'SHARED 名單內：mark iidX 後其他 iid 也必須被擋（以名共享）—— 白名單被旁路＝突變');
  const plInst = mod.markHandAbilityUsed(pl0, '激動俯衝', 'iidX');
  ok(mod.isHandAbilityOncePerTurnUsed(plInst, '激動俯衝', 'iidY') === false,
    '名單外：mark iidX 不得擋 iidY（per-instance）');
  ok(mod.isHandAbilityOncePerTurnUsed(plInst, '激動俯衝', 'iidX') === true,
    '名單外：同 iid 必須被擋');
});

// ── ⑤ END_TURN 清理：per-iid 紀錄不得跨回合殘留 ───────────────────────────────
T('END_TURN 清除 handAbilityUsedIidsThisTurn', () => {
  let s = mkState({
    myActive: inst('kanga', MEGA_KANGA),
    myHand: [inst('tf1', TALONFLAME)],
    oppActive: inst('oa', PLAIN.id),
  });
  s = mod.applyAction(s, { type: 'USE_HAND_ABILITY', cardIid: 'tf1', abilityIndex: 0 }, pool);
  ok((s.players[0].handAbilityUsedIidsThisTurn ?? []).includes('tf1'), '使用後應記入 iid');
  s = mod.applyAction(s, { type: 'END_TURN' }, pool);
  ok(!s.players[0].handAbilityUsedIidsThisTurn || s.players[0].handAbilityUsedIidsThisTurn.length === 0,
    'END_TURN 後 per-iid 紀錄必須清空');
});

// ── ⑥ 備戰滿仍要擋（本次改動不得弄壞 getBenchLimit gate） ─────────────────────
T('備戰滿 5 隻時不得再放（gate 不因 per-iid 化而消失）', () => {
  const s = mkState({
    myActive: inst('kanga', MEGA_KANGA),
    myBench: Array.from({ length: 5 }, (_, k) => inst('b' + k, PLAIN.id)),
    myHand: [inst('tf1', TALONFLAME)],
    oppActive: inst('oa', PLAIN.id),
  });
  ok(mod.getHandActivatableAbilities(s, 0, pool).length === 0, '備戰滿應回空陣列');
  const s2 = mod.applyAction(s, { type: 'USE_HAND_ABILITY', cardIid: 'tf1', abilityIndex: 0 }, pool);
  ok(s2.players[0].bench.length === 5, '強行派發必須 no-op');
});

console.log(`\n[test-v6225] ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
