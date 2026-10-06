// ⭐v6.489 守衛：被動特性不給「使用特性」按鈕（站長回報：狙射樹梟ex｜狙擊手之眼）＋ 愛管侍｜悉心治癒改回放置觸發
//   ＋「特殊狀態恢復1個」由玩家選（愛管侍／密阿雷格雷派餅共用中央 healActiveAndCureOneCondition）。
//
// A. 中央判準 isManuallyActivatableAbilityText 單元（含零寬字元、可不限次數使用）
// B. 全卡池掃描：已註冊 regA 的特性中，卡面沒有「可使用」字樣的，getUsableAbilities 一律不列（下限＋正對照）
// C. ⭐反安慰劑：守衛自己替狙射樹梟ex 補一個 noop regA（模擬日後又有人為了稽核命中而註冊）⇒ 仍不得出現按鈕，
//    USE_ABILITY 也必須 no-op（不寫「狙擊手之眼」log）——證明擋住的是中央判準，不只是「本版刪掉了 regA」。
// D. 愛管侍：不在手動清單；從手牌放到備戰區 ⇒ 彈確認 ⇒ 回 30 ＋ 兩個特殊狀態時讓玩家選要恢復哪個
// E. 戰鬥寶可夢無傷害也無特殊狀態 ⇒ 不彈窗（效果完全無法執行 ⇒ 不能使用）
// F. 密阿雷格雷派餅：1 個狀態直接恢復；2 個狀態開選單
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6489-s.mjs'), E = join(ROOT, '.v6489-e.ts'), O = join(ROOT, '.v6489-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, getUsableAbilities } from './src/lib/game/engine';\n"
  + "export { ABILITY_EFFECTS, hasAbilityFn } from './src/lib/game/effects/_shared';\n"
  + "export * as EFF from './src/lib/game/effects';\n"
  // ⚠ Rule 41：BASE 沒有這支 leaf ⇒ 不 export（讓 A 段逐條翻紅，而不是整支 build 失敗）
  + (existsSync(join(ROOT, 'src/lib/game/ability-activation.ts')) ? "export * as ACT from './src/lib/game/ability-activation';\n" : ''));
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { createGame, applyAction, getUsableAbilities, ABILITY_EFFECTS, hasAbilityFn, EFF } = M;
const MISSING = () => { throw new assert.AssertionError({ message: '中央述詞不存在（BASE？）' }); };
const isAct = typeof M.ACT?.isManuallyActivatableAbilityText === 'function' ? M.ACT.isManuallyActivatableAbilityText : MISSING;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
let nn = 0; const inst = (cid, x = {}) => ({ iid: 'v89_' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const DEF = '13163';
function board(p0, p1 = {}) {
  const s = createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(DEF), inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(DEF), bench: [], ...p0 },
      { ...s.players[1], hand: [inst(DEF), inst(DEF), inst(DEF), inst(DEF)], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(DEF), bench: [], ...p1 }] };
}

console.log('── A. 中央判準 ──');
T('A1 被動卡面（狙擊手之眼）⇒ false', () => assert.equal(isAct('若對手的手牌為4張，則這隻寶可夢使用招式所需的【無】能量全部消除。'), false));
T('A2「可使用1次」⇒ true', () => assert.equal(isAct('在自己的回合時，可使用1次。從自己的牌庫抽出2張卡。'), true));
T('A3「可不限次數使用」⇒ true', () => assert.equal(isAct('在自己的回合時，可不限次數使用。選擇1個…'), true));
T('A4 零寬字元夾在字中間仍判得出來', () => assert.equal(isAct('在自己的回合時，可​使用1次。'), true));
T('A5 undefined／null ⇒ false', () => { assert.equal(isAct(undefined), false); assert.equal(isAct(null), false); });

console.log('── B. 全卡池掃描 ──');
const seen = new Map();
for (const c of pool.values()) {
  if (!Array.isArray(c.abilities) || c.supertype !== 'Pokemon') continue;
  c.abilities.forEach((ab, i) => { const k = c.name + '|' + ab.name; if (!seen.has(k)) seen.set(k, { c, ab, i }); });
}
const trig = (n) => EFF.ON_PLAY_FROM_HAND_ABILITIES.has(n) || EFF.ON_EVOLVE_FROM_HAND_ABILITIES.has(n) || EFF.ON_RETREAT_TO_BENCH_ABILITIES.has(n);
let registered = 0, listedAct = 0; const bad = [];
for (const { c, ab, i } of seen.values()) {
  if (!hasAbilityFn(c.name, ab.name, i)) continue;
  registered++;
  const st = board({ active: inst(c.id), bench: [] });
  let u = [];
  try { u = getUsableAbilities(st, pool); } catch { u = []; }
  const listed = u.some(x => x.abilityName === ab.name);
  const actText = /可(?:不限次數)?使用|可以使用/.test((ab.effect ?? '').replace(/[​-‍﻿]/g, ''));
  if (listed && actText) listedAct++;
  if (listed && !actText) bad.push(`${c.name}｜${ab.name}`);
  if (listed && trig(ab.name)) bad.push(`觸發型卻在手動清單：${c.name}｜${ab.name}`);
}
T(`B0 掃描下限（已註冊特性 ${registered} 個 > 100）`, () => assert.ok(registered > 100, '掃描器壞了？'));
T(`B1 正對照：卡面寫「可使用」的特性仍會出現在手動清單（${listedAct} 個 > 20）`, () => assert.ok(listedAct > 20));
T('B2 卡面沒有「可使用」字樣的特性一律不出現在手動清單', () => assert.deepEqual(bad, []));
T('B3 四個被動特性逐一不列（狙擊手之眼／光之翼／整人擊落／雙重屬性）', () => {
  const got = [];
  for (const [cn, an] of [['狙射樹梟ex', '狙擊手之眼'], ['超級皮可西ex', '光之翼'], ['堅果啞鈴', '整人擊落'], ['小碎鑽', '雙重屬性']]) {
    const card = [...pool.values()].find(c => c.name === cn && c.abilities?.some(a => a.name === an));
    assert.ok(card, `fixture：找不到 ${cn}`);
    const u = getUsableAbilities(board({ active: inst(card.id) }), pool);
    if (u.some(x => x.abilityName === an)) got.push(an);
  }
  assert.deepEqual(got, []);
});

console.log('── C. 反安慰劑：守衛自己補 noop regA ──');
const DECI = [...pool.values()].find(c => c.name === '狙射樹梟ex' && c.abilities?.[0]?.name === '狙擊手之眼');
T('C1 補了 noop regA 之後，狙擊手之眼仍不出現按鈕、USE_ABILITY 也不執行', () => {
  const key = '狙射樹梟ex|0';
  const had = ABILITY_EFFECTS.get(key);
  ABILITY_EFFECTS.set(key, (st) => ({ ...st, log: [...st.log, { turn: st.turn, playerIndex: 0, message: '狙擊手之眼：被動效果（測試注入）' }] }));
  try {
    const me = inst(DECI.id);
    const st = board({ active: me });
    assert.ok(hasAbilityFn('狙射樹梟ex', '狙擊手之眼', 0), '前置：注入的 regA 應已註冊');
    const u = getUsableAbilities(st, pool);
    assert.ok(!u.some(x => x.iid === me.iid), '不應出現按鈕');
    const after = applyAction(st, { type: 'USE_ABILITY', iid: me.iid, abilityIndex: 0 }, pool);
    assert.ok(!after.log.some(l => /狙擊手之眼/.test(l.message)), '不應寫出特性 log');
    assert.ok(!after.players[0].active.abilityUsedThisTurn, '不應吃掉本回合特性權');
  } finally { if (had) ABILITY_EFFECTS.set(key, had); else ABILITY_EFFECTS.delete(key); }
});
T('C2 狙擊手之眼的被動效果照常（對手手牌 4 張時【無】cost 消除，可使出粉碎箭）', () => {
  const st = board({ active: inst(DECI.id, { energyAttached: [inst('14102')] }) });
  const a = applyAction(st, { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.ok(a.log.some(l => /粉碎箭/.test(l.message)), '應能使出粉碎箭');
});

console.log('── D/E. 愛管侍｜悉心治癒 ──');
const SHIN = '11238';
assert.equal(pool.get(SHIN)?.name, '愛管侍', 'fixture：11238 應為愛管侍');
T('D1 愛管侍在場上不出現手動按鈕', () => {
  const u = getUsableAbilities(board({ bench: [inst(SHIN)] }), pool);
  assert.ok(!u.some(x => x.abilityName === '悉心治癒'));
});
T('D2 放到備戰 ⇒ 彈確認；選使用 ⇒ 回 30，兩個特殊狀態時開選單、選灼傷只恢復灼傷', () => {
  const card = inst(SHIN);
  const act = inst(DEF, { damage: 50, secondaryStatus: 'poisoned', tertiaryStatus: 'burned' });
  let s = board({ hand: [card], active: act });
  s = applyAction(s, { type: 'PLAY_BASIC', iid: card.iid }, pool);
  assert.equal(s.pendingSelection?.effectKey, 'resolve-play-ability-prompt', '應彈確認');
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: ['yes'] }, pool);
  assert.equal(s.players[0].active.damage, 20, '應回 30');
  assert.equal(s.pendingSelection?.effectKey, 'v6489-cure-one-condition', '兩個狀態應開選單');
  const opts = s.pendingSelection.params.options.map(o => o.id).sort();
  assert.deepEqual(opts, ['secondaryStatus', 'tertiaryStatus']);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: ['tertiaryStatus'] }, pool);
  assert.equal(s.players[0].active.tertiaryStatus, undefined, '灼傷應恢復');
  assert.equal(s.players[0].active.secondaryStatus, 'poisoned', '中毒應保留');
});
T('E1 戰鬥寶可夢無傷害也無特殊狀態 ⇒ 放到備戰不彈窗', () => {
  const card = inst(SHIN);
  let s = board({ hand: [card] });
  s = applyAction(s, { type: 'PLAY_BASIC', iid: card.iid }, pool);
  assert.ok(s.players[0].bench.some(b => b.iid === card.iid), '前置：應已放到備戰');
  assert.notEqual(s.pendingSelection?.effectKey, 'resolve-play-ability-prompt');
});

console.log('── F. 密阿雷格雷派餅 ──');
const PIE = [...pool.values()].find(c => c.name === '密阿雷格雷派餅');
T('F1 一個特殊狀態 ⇒ 直接恢復、回 20', () => {
  const card = inst(PIE.id);
  let s = board({ hand: [card], active: inst(DEF, { damage: 30, status: 'confused' }) });
  s = applyAction(s, { type: 'PLAY_TRAINER', iid: card.iid }, pool);
  assert.equal(s.pendingSelection, null);
  assert.equal(s.players[0].active.status, undefined);
  assert.equal(s.players[0].active.damage, 10);
});
T('F2 兩個特殊狀態 ⇒ 開選單讓玩家選（不再自動挑主格）', () => {
  const card = inst(PIE.id);
  let s = board({ hand: [card], active: inst(DEF, { damage: 0, status: 'asleep', secondaryStatus: 'poisoned' }) });
  s = applyAction(s, { type: 'PLAY_TRAINER', iid: card.iid }, pool);
  assert.equal(s.pendingSelection?.effectKey, 'v6489-cure-one-condition');
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: ['secondaryStatus'] }, pool);
  assert.equal(s.players[0].active.status, 'asleep');
  assert.equal(s.players[0].active.secondaryStatus, undefined);
});

console.log(`\nv6489 被動特性按鈕／悉心治癒：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
