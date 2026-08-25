// v6.228 守衛：火箭隊的阿柏怪｜瞪眼效用 必須擋住「手牌特性放備戰」路徑（USE_HAND_ABILITY）
//
// 站長回報（2026-08-25）：對手戰鬥場有 火箭隊的阿柏怪（瞪眼效用）時，
// 仍然可以從手牌用 烈箭鷹ex｜激動俯衝 把自己放到備戰區。
// 真因：v6.080 新增的手牌特性中央 gate（getHandActivatableAbilities）沒有接
// 「從手牌放置到場上」的共通述詞（isOppEvilEyeBlocking）——PLAY_BASIC／EVOLVE／
// 神奇糖果都有接，唯獨這條新路徑漏了。
//
// 卡面（static/cards 台灣官方，逐字）：
//   火箭隊的阿柏怪 SV10#12807（I）瞪眼效用：「只要這隻寶可夢在戰鬥場上，對手不可從手牌將
//     擁有特性的寶可夢（「火箭隊的寶可夢」除外）放置於場上。」
//   烈箭鷹ex M6#19612（J）激動俯衝：「…則可使用1次。將這張卡放置於備戰區。」（有特性、非火箭隊）
//   齒輪怪 SV7#10964（H）緊急迴轉：「…則可使用1次。將這張卡放置於備戰區。」（有特性、非火箭隊）
//   火箭隊的急凍鳥 #14694（I）抵抗之幕：火箭隊的寶可夢 ⇒ 卡面明文除外，不受瞪眼效用阻擋。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6228-s.js'), E = join(ROOT, '.x6228-e.ts'), O = join(ROOT, '.x6228-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, getHandActivatableAbilities, getPlayableBasics } from './src/lib/game/engine';\n"
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
const ARBOK      = '12807';  // 火箭隊的阿柏怪（I）瞪眼效用
const MEGA_KANGA = '14071';  // 超級袋獸ex（I，Colorless Mega ex）—— 激動俯衝的啟動條件
const TALONFLAME = '19612';  // 烈箭鷹ex（J）激動俯衝 —— 有特性、非火箭隊 ⇒ 應被擋
const KLINK      = '10964';  // 齒輪怪（H）緊急迴轉 —— 有特性、非火箭隊 ⇒ 應被擋（同時當對手 Stage2）
const RKT_BIRD   = '14694';  // 火箭隊的急凍鳥（I）抵抗之幕 —— 「火箭隊的」⇒ 明文除外，不擋
const NULLIFIER  = '16826';  // 振翼髮（I）passive 暗夜羽擊 —— 消除對手戰鬥位特性
const PLAIN = [...pool.values()].find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && ['H', 'I', 'J'].includes(c.regulationMark) && !(c.abilities ?? []).length);
const AB_BASIC = [...pool.values()].find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && ['H', 'I', 'J'].includes(c.regulationMark) && (c.abilities ?? []).length
  && !c.name.startsWith('火箭隊的') && c.name !== '海豚俠ex');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

const inst = (iid, cardId, extra = {}) => ({ iid, cardId: String(cardId), damage: 0,
  energyAttached: [], evolvedFromStack: [], toolAttached: null, ...extra });

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

console.log('[test-v6228] 瞪眼效用 × 手牌特性放備戰（激動俯衝／緊急迴轉）守衛');

// ── ① 站長情境：對手戰鬥場 阿柏怪 → 烈箭鷹ex｜激動俯衝 不可發動、不可放上場 ──
T('激動俯衝：對手戰鬥場有瞪眼效用 → 按鈕不列出、USE_HAND_ABILITY 也放不上', () => {
  const s0 = mkState({
    myActive: inst('kanga', MEGA_KANGA),
    myHand: [inst('tf1', TALONFLAME)],
    oppActive: inst('arbok', ARBOK),
  });
  const acts = mod.getHandActivatableAbilities(s0, 0, pool);
  ok(acts.length === 0, `getHandActivatableAbilities 應為空（不亮按鈕），實得 ${acts.length}`);
  const s1 = mod.applyAction(s0, { type: 'USE_HAND_ABILITY', cardIid: 'tf1', abilityIndex: 0 }, pool);
  ok(s1.players[0].bench.length === 0, '烈箭鷹ex 不應被放到備戰區（瞪眼效用）');
  ok(s1.players[0].hand.some(c => c.iid === 'tf1'), '烈箭鷹ex 應留在手牌');
});

// ── ② 齒輪怪｜緊急迴轉 同型（對手備戰放一隻 Stage2 齒輪怪滿足發動條件） ──────
T('緊急迴轉：對手戰鬥場有瞪眼效用 → 齒輪怪也不可從手牌放上場', () => {
  const s0 = mkState({
    myActive: inst('me', PLAIN.id),
    myHand: [inst('k1', KLINK)],
    oppActive: inst('arbok', ARBOK),
    oppBench: [inst('os2', KLINK)],   // 對手場上有 2 階（緊急迴轉的發動條件成立，唯瞪眼要擋）
  });
  ok(mod.getHandActivatableAbilities(s0, 0, pool).length === 0, '不應列出緊急迴轉');
  const s1 = mod.applyAction(s0, { type: 'USE_HAND_ABILITY', cardIid: 'k1', abilityIndex: 0 }, pool);
  ok(s1.players[0].bench.length === 0, '齒輪怪不應被放到備戰區（瞪眼效用）');
});

// ── ③ 正對照：阿柏怪不在戰鬥場（在備戰區）→ 照常可發動 ─────────────────────
T('正對照：阿柏怪在對手備戰區（非戰鬥場）→ 激動俯衝照常可用', () => {
  const s0 = mkState({
    myActive: inst('kanga', MEGA_KANGA),
    myHand: [inst('tf1', TALONFLAME)],
    oppActive: inst('oa', PLAIN.id),
    oppBench: [inst('arbok', ARBOK)],
  });
  ok(mod.getHandActivatableAbilities(s0, 0, pool).length === 1, '應列出激動俯衝');
  const s1 = mod.applyAction(s0, { type: 'USE_HAND_ABILITY', cardIid: 'tf1', abilityIndex: 0 }, pool);
  ok(s1.players[0].bench.length === 1, '烈箭鷹ex 應成功放到備戰區');
});

// ── ④ 正對照：阿柏怪特性被消除 → 照常可發動（兩種消除來源各驗一次） ──────────
T('正對照：阿柏怪 abilityNullifiedThisTurn（招式版暗夜羽擊）→ 激動俯衝照常可用', () => {
  const s0 = mkState({
    myActive: inst('kanga', MEGA_KANGA),
    myHand: [inst('tf1', TALONFLAME)],
    oppActive: inst('arbok', ARBOK, { abilityNullifiedThisTurn: true }),
  });
  ok(mod.getHandActivatableAbilities(s0, 0, pool).length === 1, '特性被消除時應列出激動俯衝');
  const s1 = mod.applyAction(s0, { type: 'USE_HAND_ABILITY', cardIid: 'tf1', abilityIndex: 0 }, pool);
  ok(s1.players[0].bench.length === 1, '特性被消除時烈箭鷹ex 應成功放到備戰區');
});
T('正對照：我方戰鬥場 振翼髮（passive 暗夜羽擊消除對手戰鬥位特性）→ 激動俯衝照常可用', () => {
  const s0 = mkState({
    myActive: inst('moon', NULLIFIER),          // 振翼髮在我方戰鬥場 → 阿柏怪特性被消除
    myBench: [inst('kanga', MEGA_KANGA)],       // 激動俯衝啟動條件（無屬性 Mega ex）
    myHand: [inst('tf1', TALONFLAME)],
    oppActive: inst('arbok', ARBOK),
  });
  ok(mod.getHandActivatableAbilities(s0, 0, pool).length === 1,
    '振翼髮消除阿柏怪特性 → 應列出激動俯衝（isAbilityHolderEffective 生效）');
  const s1 = mod.applyAction(s0, { type: 'USE_HAND_ABILITY', cardIid: 'tf1', abilityIndex: 0 }, pool);
  ok(s1.players[0].bench.length === 2, '烈箭鷹ex 應成功放到備戰區');
});

// ── ⑤ 正對照：「火箭隊的」寶可夢（卡面明文除外）→ PLAY_BASIC 照常可放 ────────
T('正對照：火箭隊的急凍鳥（有特性、火箭隊）→ 瞪眼效用不擋 PLAY_BASIC', () => {
  const s0 = mkState({
    myActive: inst('me', PLAIN.id),
    myHand: [inst('rb1', RKT_BIRD)],
    oppActive: inst('arbok', ARBOK),
  });
  ok(mod.getPlayableBasics(s0, pool).includes('rb1'), '火箭隊的急凍鳥應可打出');
  const s1 = mod.applyAction(s0, { type: 'PLAY_BASIC', iid: 'rb1' }, pool);
  ok(s1.players[0].bench.length === 1, '火箭隊的急凍鳥應成功放到備戰區');
});

// ── ⑥ 正對照：沒有特性的寶可夢 → 照常可放 ────────────────────────────────────
T('正對照：無特性基礎寶可夢 → 瞪眼效用不擋 PLAY_BASIC', () => {
  const s0 = mkState({
    myActive: inst('me', PLAIN.id),
    myHand: [inst('p1', PLAIN.id)],
    oppActive: inst('arbok', ARBOK),
  });
  ok(mod.getPlayableBasics(s0, pool).includes('p1'), '無特性基礎應可打出');
  const s1 = mod.applyAction(s0, { type: 'PLAY_BASIC', iid: 'p1' }, pool);
  ok(s1.players[0].bench.length === 1, '無特性基礎應成功放到備戰區');
});

// ── ⑦ 迴歸：PLAY_BASIC 的既有瞪眼 gate 不因收斂而鬆動 ────────────────────────
T('迴歸：有特性、非火箭隊的基礎寶可夢 → PLAY_BASIC 仍被瞪眼效用擋下', () => {
  ok(AB_BASIC, '卡池中應找得到「有特性、非火箭隊」的 H/I/J 基礎寶可夢');
  const s0 = mkState({
    myActive: inst('me', PLAIN.id),
    myHand: [inst('ab1', AB_BASIC.id)],
    oppActive: inst('arbok', ARBOK),
  });
  ok(!mod.getPlayableBasics(s0, pool).includes('ab1'), `${AB_BASIC.name} 不應可打出`);
  const s1 = mod.applyAction(s0, { type: 'PLAY_BASIC', iid: 'ab1' }, pool);
  ok(s1.players[0].bench.length === 0, `${AB_BASIC.name} 不應被放到備戰區`);
});

console.log(`\n[test-v6228] ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
