// ⭐⭐v6.494 守衛：特性的「時機」與「有沒有事可做」（站長裁定 2026-10-06）
//
// 裁定 3（逐字）：「[特性]振翅高飛『上場時可使用 1 次』錯過時機『錯過就不能用』，但如果遠古巨蜓ex上場後，
//   玩家又用寶可夢交替將其換下場，然後又再用寶可夢交替將遠古巨蜓ex換上戰鬥場，則又會再觸發一次特性，
//   因此應該再詢問一次要不要使用」
//   ・P1 換上場 ⇒ 詢問；選「不使用」⇒ 之後沒有按鈕、USE_ABILITY 也無效
//   ・P2 換下再換上 ⇒ 再詢問一次（即使上一次已經用過）
//   ・P3 牌庫 0 ⇒ 不詢問（沒有事可做）
//   ・P4 官方 L2113：自己的回合，自己的寶可夢昏厥後從備戰區放上戰鬥場 ⇒ 可以使用（詢問）
//   ・P5 對手回合被打倒後補場 ⇒ 不詢問
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6494-s.mjs'), E = join(ROOT, '.v6494-e.ts'), O = join(ROOT, '.v6494-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, getUsableAbilities } from './src/lib/game/engine';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, getUsableAbilities } = await import(pathToFileURL(O).href);
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
const YANMEGA = need('14663', '遠古巨蜓ex'), SWITCH = need('18587', '寶可夢交替'), KOKO = need('12116', '卡璞・鳴鳴ex');
const CARVANHA = need('14422', '利牙魚'), DEF = '13163';
const TALONFLAME = need('17991', '烈箭鷹'), LILIGANT_LIKE = need('10899', '搖籃百合'), FROSMOTH_LIKE = need('14668', '毒粉蛾');
const BOSS = need('14124', '老大的指令'), RUSH = need('11275', '急進開關');
const NIDOQUEEN = need('19593', '尼多后'), TINK = need('14005', '小鍛匠'), TINKATUFF = need('14006', '巧鍛匠');
const basicE = (t) => String([...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name === `基本【${t}】能量`)?.id);
const GRASS = basicE('草'), DARK = basicE('惡');
let nn = 0; const inst = (cid, x = {}) => ({ iid: 'v94_' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function board(p0, p1) {
  const s = createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5, log: [],
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(GRASS), inst(GRASS), inst(GRASS), inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), bench: [], ...p0 },
      // ⭐v6.516（Rule 40）：對手預設要有戰鬥寶可夢——原本省略 ⇒ 「對手戰鬥場空、備戰有寶可夢」，v6.516 起引擎會先等對手補位、擋下我方動作；
      //   本守衛要驗的是特性時機，與對手戰鬥場無關 ⇒ 補一隻（各條自己指定 p1.active 時照舊覆寫）
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(KOKO), bench: [inst(KOKO)], ...p1 }] };
}
const isPrompt = (s) => s.pendingSelection?.effectKey === 'resolve-promote-active-ability-prompt';
const answer = (s, yes) => applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: [yes ? 'yes' : 'no'] }, pool);
// 打出寶可夢交替並選 benchIid 換上來
function doSwitch(s, benchIid) {
  const card = inst(SWITCH);
  s = { ...s, players: [{ ...s.players[0], hand: [...s.players[0].hand, card] }, s.players[1]] };
  s = applyAction(s, { type: 'PLAY_TRAINER', iid: card.iid }, pool);
  if (s.pendingSelection && !isPrompt(s)) {
    s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: [benchIid] }, pool);
  }
  return s;
}
const withHeadsU = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };
const hasButton = (s, iid) => getUsableAbilities(s, pool).some(u => u.iid === iid);

console.log('── P 上場時特性（振翅高飛）──');
T('P1 換上場 ⇒ 詢問；選「不使用」⇒ 沒有按鈕、USE_ABILITY 無效（錯過就不能用）', () => {
  const y = inst(YANMEGA), x = inst(KOKO);
  let s = board({ active: x, bench: [y] }, {});
  s = doSwitch(s, y.iid);
  assert.equal(s.players[0].active?.iid, y.iid, '前置：遠古巨蜓ex 應在戰鬥場');
  assert.ok(isPrompt(s), '應詢問是否使用振翅高飛');
  s = answer(s, false);
  assert.equal(s.pendingSelection ?? null, null);
  assert.ok(!hasButton(s, y.iid), '錯過後不可以有手動按鈕');
  const before = s.players[0].active.energyAttached.length;
  const r = applyAction(s, { type: 'USE_ABILITY', iid: y.iid, abilityIndex: 0 }, pool);
  assert.equal(r.players[0].active.energyAttached.length, before, 'USE_ABILITY 不可以補用');
  assert.ok(!r.pendingSelection, 'USE_ABILITY 不可以開出選擇視窗');
});
T('P2 用過一次後換下、再換上 ⇒ 再詢問一次（裁定 3）', () => {
  const y = inst(YANMEGA), x = inst(KOKO);
  let s = board({ active: x, bench: [y] }, {});
  s = doSwitch(s, y.iid);
  assert.ok(isPrompt(s), '第一次上場應詢問');
  s = answer(s, true);
  if (s.pendingSelection) s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey,
    selectedIids: s.players[0].deck.filter(c => c.cardId === GRASS).map(c => c.iid).slice(0, 1) }, pool);
  assert.equal(s.players[0].active.energyAttached.length, 1, '前置：第一次使用應附上 1 張草能量');
  s = doSwitch(s, x.iid);            // 換下
  assert.equal(s.players[0].active?.iid, x.iid);
  assert.ok(!isPrompt(s), '換下時不詢問');
  s = doSwitch(s, y.iid);            // 再換上
  assert.equal(s.players[0].active?.iid, y.iid);
  assert.ok(isPrompt(s), '再次從備戰區放上戰鬥場應再詢問一次');
});
T('P3 牌庫 0 ⇒ 不詢問（沒有事可做）', () => {
  const y = inst(YANMEGA), x = inst(KOKO);
  let s = board({ active: x, bench: [y], deck: [] }, {});
  s = doSwitch(s, y.iid);
  assert.equal(s.players[0].active?.iid, y.iid);
  assert.ok(!isPrompt(s));
});
T('P4 官方 L2113：自己的回合，反噬昏厥後放上遠古巨蜓ex ⇒ 詢問', () => {
  const y = inst(YANMEGA);
  const c = inst(CARVANHA, { damage: Number(pool.get(CARVANHA).hp) - 10, energyAttached: [inst(DARK)] });
  let s = board({ active: c, bench: [y] }, { active: inst(KOKO) });
  s = applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.equal(s.players[0].active, null, '前置：利牙魚應反噬昏厥');
  s = applyAction(s, { type: 'SEND_NEW_ACTIVE', senderIdx: 0, iid: y.iid }, pool);
  assert.equal(s.players[0].active?.iid, y.iid);
  assert.ok(isPrompt(s), '應詢問是否使用振翅高飛');
});
T('P5 對手回合被打倒後補場 ⇒ 不詢問', () => {
  const y = inst(YANMEGA);
  let s = board({ active: null, bench: [y] }, { active: inst(KOKO) });
  s = { ...s, activePlayerIndex: 1 };
  s = applyAction(s, { type: 'SEND_NEW_ACTIVE', senderIdx: 0, iid: y.iid }, pool);
  assert.equal(s.players[0].active?.iid, y.iid);
  assert.ok(!isPrompt(s));
});

console.log('── C 擲幣型特性：正面也沒事可做 ⇒ 不能按（裁定 4）──');
const btn = (s, iid) => getUsableAbilities(s, pool).some(u => u.iid === iid);
T('C1 烈箭鷹｜穹天狩獵：對手手牌 0 張 ⇒ 不能按；1 張 ⇒ 可以按', () => {
  const t = inst(TALONFLAME);
  const s0 = board({ active: inst(KOKO), bench: [t] }, { active: inst(KOKO), hand: [] });
  assert.ok(!btn(s0, t.iid), '對手手牌 0 張');
  const s1 = board({ active: inst(KOKO), bench: [t] }, { active: inst(KOKO), hand: [inst(DEF)] });
  assert.ok(btn(s1, t.iid), '對手手牌 1 張');
  // 後端也擋（USE_ABILITY 以按鈕清單為準）
  const r = applyAction(s0, { type: 'USE_ABILITY', iid: t.iid, abilityIndex: 0 }, pool);
  assert.ok(!r.players[0].bench.find(b => b.iid === t.iid).abilityUsedThisTurn, '不可以吃掉特性權');
});
T('C2 搖籃百合｜任選黏液：對手已中毒＋灼傷＋混亂 ⇒ 不能按；只中毒 ⇒ 可以按', () => {
  const l = inst(LILIGANT_LIKE);
  const full = inst(KOKO, { status: 'confused', secondaryStatus: 'poisoned', tertiaryStatus: 'burned' });
  assert.ok(!btn(board({ active: inst(KOKO), bench: [l] }, { active: full }), l.iid));
  assert.ok(btn(board({ active: inst(KOKO), bench: [l] }, { active: inst(KOKO, { secondaryStatus: 'poisoned' }) }), l.iid));
});
T('C3 既有四張收斂後行為不變：微風吹拂（對手戰鬥位無能量 ⇒ 不能按）／母親的誘引（對手沒備戰 ⇒ 不能按）', () => {
  const f = inst(FROSMOTH_LIKE), n = inst(NIDOQUEEN);
  assert.ok(!btn(board({ active: inst(KOKO), bench: [f] }, { active: inst(KOKO) }), f.iid));
  assert.ok(btn(board({ active: inst(KOKO), bench: [f] }, { active: inst(KOKO, { energyAttached: [inst(DARK)] }) }), f.iid));
  assert.ok(!btn(board({ active: inst(KOKO), bench: [n] }, { active: inst(KOKO), bench: [] }), n.iid));
  assert.ok(btn(board({ active: inst(KOKO), bench: [n] }, { active: inst(KOKO), bench: [inst(KOKO)] }), n.iid));
});
T('C4 巧鍛匠｜臨場之錘（進化時觸發）：對手戰鬥位沒有能量 ⇒ 不詢問；有能量 ⇒ 詢問', () => {
  const mk = (oppEnergy) => {
    const base = inst(TINK), evo = inst(TINKATUFF);
    let s = board({ active: inst(KOKO), bench: [base], hand: [evo] }, { active: inst(KOKO, { energyAttached: oppEnergy ? [inst(DARK)] : [] }) });
    return applyAction(s, { type: 'EVOLVE', fromIid: base.iid, toIid: evo.iid }, pool);
  };
  const s0 = mk(false), s1 = mk(true);
  assert.ok(s0.players[0].bench.some(b => b.cardId === TINKATUFF), '前置：應已進化');
  assert.ok(!s0.pendingSelection, '對手戰鬥位沒有能量 ⇒ 不詢問');
  assert.ok(s1.pendingSelection, '有能量 ⇒ 詢問');
});

console.log('── U USE_ABILITY 不可以補用觸發型特性 ──');
T('U1 巧鍛匠進化時選「不使用」⇒ 之後送 USE_ABILITY 無效（錯過就不能用）', () => {
  const base = inst(TINK), evo = inst(TINKATUFF);
  const oppE = inst(DARK);
  let s = board({ active: inst(KOKO), bench: [base], hand: [evo] }, { active: inst(KOKO, { energyAttached: [oppE] }) });
  s = applyAction(s, { type: 'EVOLVE', fromIid: base.iid, toIid: evo.iid }, pool);
  assert.ok(s.pendingSelection, '前置：應詢問');
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: ['no'] }, pool);
  const evolved = s.players[0].bench.find(b => b.cardId === TINKATUFF);
  const r = withHeadsU(() => applyAction(s, { type: 'USE_ABILITY', iid: evolved.iid, abilityIndex: 0 }, pool));
  assert.ok(!r.log.slice(s.log.length).some(l => /臨場之錘/.test(l.message)), '不可以發動');
  assert.equal(r.players[1].active.energyAttached.length, 1);
});

console.log('── Q 同一次放置只問一次（v6.496，Fable 審查發現 1／3）──');
// 打出「老大的指令」：選對手備戰換上來（自方戰鬥位不變）
function doBoss(s) {
  const card = inst(BOSS);
  s = { ...s, players: [{ ...s.players[0], hand: [...s.players[0].hand, card] }, s.players[1]] };
  s = applyAction(s, { type: 'PLAY_TRAINER', iid: card.iid }, pool);
  assert.ok(s.pendingSelection && !isPrompt(s), '前置：老大的指令應開對手備戰選擇');
  return applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: [s.players[1].bench[0].iid] }, pool);
}
const sixGrass = () => Array.from({ length: 6 }, () => inst(GRASS));
T('Q1 用過振翅高飛之後打老大的指令（只換對手）⇒ 不可以再問、能量不會變兩倍', () => {
  const y = inst(YANMEGA), x = inst(KOKO);
  let s = board({ active: x, bench: [y], deck: sixGrass() }, { active: inst(KOKO), bench: [inst(KOKO)] });
  s = doSwitch(s, y.iid);
  assert.ok(isPrompt(s));
  s = answer(s, true);
  if (s.pendingSelection) s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey,
    selectedIids: s.players[0].deck.filter(c => c.cardId === GRASS).map(c => c.iid).slice(0, 3) }, pool);
  const n = s.players[0].active.energyAttached.length;
  assert.equal(n, 3, '前置：第一次附 3 張');
  s = doBoss(s);
  assert.ok(!isPrompt(s), '自方戰鬥位沒有換 ⇒ 不是新的放置 ⇒ 不可以再問');
  assert.equal(s.players[0].active.energyAttached.length, n);
});
T('Q2 詢問時選「不使用」之後打老大的指令 ⇒ 不再問（錯過就不能用）', () => {
  const y = inst(YANMEGA), x = inst(KOKO);
  let s = board({ active: x, bench: [y], deck: sixGrass() }, { active: inst(KOKO), bench: [inst(KOKO)] });
  s = doSwitch(s, y.iid);
  s = answer(s, false);
  s = doBoss(s);
  assert.ok(!isPrompt(s));
});
T('Q3 選「不使用」之後換下再換上 ⇒ 新的一次放置 ⇒ 再問', () => {
  const y = inst(YANMEGA), x = inst(KOKO);
  let s = board({ active: x, bench: [y], deck: sixGrass() }, {});
  s = doSwitch(s, y.iid); s = answer(s, false);
  s = doSwitch(s, x.iid); s = doSwitch(s, y.iid);
  assert.ok(isPrompt(s));
});
T('Q4 急進開關：舊戰鬥寶可夢沒有能量也要詢問（原本這條出口漏掉）', () => {
  const y = inst(YANMEGA), x = inst(KOKO);
  let s = board({ active: x, bench: [y], deck: sixGrass() }, {});
  const card = inst(RUSH);
  s = { ...s, players: [{ ...s.players[0], hand: [card] }, s.players[1]] };
  s = applyAction(s, { type: 'PLAY_TRAINER', iid: card.iid }, pool);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: [y.iid] }, pool);
  assert.equal(s.players[0].active?.iid, y.iid);
  assert.ok(isPrompt(s));
});

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.494 特性時機：${pass} 通過、${fail} 失敗`);
if (fail) process.exit(1);
