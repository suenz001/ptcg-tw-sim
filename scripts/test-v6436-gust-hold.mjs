// 守衛 v6.436：電腦對手「老大的指令」（Gust 系支援者）的保留邏輯＋拉誰上來；借招冷卻的對戰紀錄說明
//
// 【問題】訓練家階段「支援者一律先打、同是支援者照手牌順序」⇒ 老大的指令排在前面就會打出去；
//   拉誰上來是「剩餘 HP 最少」的那隻，不管自己打不打得倒、打不打得動牠。
//   診斷（scripts/diag-ai-gust.mjs，52 副含老大的指令的預組、312 局）：打出 454 次，拉上來的那隻這回合
//   被打倒只有 27.5%，**59.9% 完全沒受到傷害**；其中 205 次手上明明還有別的支援者。
// 【修法】src/lib/game/ai-gust.ts（打不打＝planGust、拉誰＝gustTargetOutcomes，同一把尺：引擎實打 evaluateAttack）
//   ① 拉上來能多拿獎賞、或 ② 原本打不動而拉上來打得動 ⇒ 先打它（比其他支援者優先）；否則保留。
//   魔靈多龍預組有自己調過的用法，不走這裡。
// 【順帶】v6.435 fable 審查建議：借招時被冷卻排除的招式，在對戰紀錄說明（copyAttackCooldownNote）。
//
// HEAD-FAIL（BASE＝v6.435 8a165679）：結果寫在報告與 commit 訊息（Rule 41：缺席的東西用哨兵）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6436-s.js'), E = join(ROOT, '.x-v6436-e.ts'), O = join(ROOT, '.x-v6436-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
const hasGustMod = existsSync(join(ROOT, 'src/lib/game/ai-gust.ts'));
writeFileSync(E, "export * as ENG from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + (hasGustMod ? "export * as GUST from './src/lib/game/ai-gust';\n" : 'export const GUST = null;\n')
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, getAIAction, GUST } = await import(pathToFileURL(O).href);
const { createGame, applyAction } = ENG;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
// 卡片事實一律取自 static/cards（台灣官方卡面）
const SANDY = '11236';     // 沙丘娃（H，基礎，HP90）：沙沫［無無無］50，無附加效果
const SNORLAX = '17038';   // 卡比獸（基礎，HP160）
const TOGEPI = '11225';    // 波克比（基礎，HP50）
const RESHI = '13045';     // 萊希拉姆ex（基礎，HP230，2 張獎賞）
const BOSS = '14124';      // 老大的指令（支援者）：「選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換。」
const GUY = '17173';       // 蓋伊（支援者）：「從自己的牌庫抽出3張卡。」
const PSY = '14103';       // 基本超能量
const SYLVEON = '16770', CLEFABLE = '16757';
assert.equal(pool.get(SANDY).attacks[0].damage, '50');
assert.ok(/選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換/.test(pool.get(BOSS).rulesText), '老大的指令卡面變了');
assert.ok(/從自己的牌庫抽出3張卡/.test(pool.get(GUY).rulesText), '蓋伊卡面變了');

let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'g' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
/**
 * 我方：戰鬥位沙丘娃（3 個能量，打得出 50）、手牌依 hand 順序；本回合能量已附。
 * 對手：戰鬥位 oppActive、備戰 oppBench。
 */
function mk({ hand, oppActive = inst(SNORLAX), oppBench = [], deckExtra = [] }) {
  const s = createGame({ name: 'P1', entries: [{ cardId: SNORLAX, count: 1 }] }, { name: 'P2', entries: [{ cardId: SNORLAX, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: hand.map((c) => inst(c)), deck: [...deckExtra.map((c) => inst(c)), ...Array.from({ length: 12 }, () => inst(SNORLAX))], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(SNORLAX)),
        active: inst(SANDY, { energyAttached: [inst(PSY), inst(PSY), inst(PSY)] }), bench: [inst(SNORLAX)],
        energyAttachedThisTurn: true, supporterPlayedThisTurn: false },
      { ...s.players[1], hand: [inst(SNORLAX)], deck: Array.from({ length: 12 }, () => inst(SNORLAX)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(SNORLAX)), active: oppActive, bench: oppBench }] };
}
const nameOfHand = (st, iid) => pool.get(st.players[0].hand.find((h) => h.iid === iid)?.cardId ?? '')?.name;
/** AI 這一步打出的訓練家名稱（不是 PLAY_TRAINER ⇒ 動作型別） */
const aiTrainer = (st) => { const a = getAIAction(st, pool, 0); return a?.type === 'PLAY_TRAINER' ? nameOfHand(st, a.iid) : a?.type; };
/** 打出老大的指令，讓 AI 解選擇視窗，回傳被拉上來的那隻 iid */
function aiGustPick(st) {
  const bossIid = st.players[0].hand.find((h) => h.cardId === BOSS).iid;
  const p = applyAction(st, { type: 'PLAY_TRAINER', iid: bossIid }, pool);
  assert.equal(p.pendingSelection?.effectKey, 'gust-opp', '前提：老大的指令沒有開出選擇視窗');
  const a = getAIAction(p, pool, 0);
  assert.equal(a?.type, 'RESOLVE_SELECTION');
  return a.selectedIids[0];
}

let pass = 0, fail = 0;
const failed = [];
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n); } };

// ── G：打不打 ──────────────────────────────────────────────────────────────────
T('G1 ⭐ 備戰有打得倒的（波克比 50），戰鬥位打不倒 ⇒ 先打老大的指令（即使蓋伊排在手牌前面）', () => {
  const st = mk({ hand: [GUY, BOSS], oppBench: [inst(TOGEPI)] });
  assert.equal(aiTrainer(st), '老大的指令');
});
T('G2 ⭐ 保留：拉誰上來都打不倒、戰鬥位本來就打得出傷害 ⇒ 不打老大的指令（即使它排在手牌前面），改打蓋伊', () => {
  const st = mk({ hand: [BOSS, GUY], oppBench: [inst(RESHI)] });
  assert.equal(aiTrainer(st), '蓋伊');
});
T('G3 ⭐ 保留（手上只有老大的指令）⇒ 這回合不打它（直接出招）', () => {
  const st = mk({ hand: [BOSS], oppBench: [inst(RESHI)] });
  const a = getAIAction(st, pool, 0);
  assert.ok(!(a?.type === 'PLAY_TRAINER' && nameOfHand(st, a.iid) === '老大的指令'), '仍打出老大的指令：' + JSON.stringify(a));
  assert.equal(a?.type, 'ATTACK', '應該直接出招：' + JSON.stringify(a));
});
T('G4 ⭐ 打不動：對手戰鬥位這回合不受招式傷害，備戰的萊希拉姆ex 打得動 ⇒ 打老大的指令', () => {
  const st = mk({ hand: [GUY, BOSS], oppActive: inst(SNORLAX, { immuneToAttackDamageThisTurn: true }), oppBench: [inst(RESHI)] });
  assert.equal(aiTrainer(st), '老大的指令');
});
T('G5 正對照：沒有老大的指令時照舊打蓋伊（支援者照原本的順序）', () => {
  assert.equal(aiTrainer(mk({ hand: [GUY], oppBench: [inst(TOGEPI)] })), '蓋伊');
});

// ── P：拉誰上來 ───────────────────────────────────────────────────────────────
T('P1 ⭐ 兩隻都打得倒：先比獎賞 —— 拉 2 張獎賞的萊希拉姆ex（剩 40，只受 40 傷害），不拉 1 張的波克比（剩 50，受 50 傷害）', () => {
  // ⚠（fable 審查 v6.436 Z5）兩隻的「傷害」與「獎賞」排序必須相反，否則「只比傷害」的突變也會選對（第一版就是這樣的安慰劑）
  const togepi = inst(TOGEPI), reshi = inst(RESHI, { damage: 190 });
  const st = mk({ hand: [BOSS], oppBench: [togepi, reshi] });
  assert.equal(aiGustPick(st), reshi.iid);
});
T('P3 ⭐ 選擇器沿用 planGust 的結論（同一次試算、不重抽）：決定打出之後盤面若被改成別隻更好，仍拉當初預計的那隻', () => {
  assert.ok(GUST && typeof GUST.plannedGustTarget === 'function', 'plannedGustTarget 不存在');
  const togepi = inst(TOGEPI), reshi = inst(RESHI);
  const st = mk({ hand: [BOSS], oppBench: [togepi, reshi] });
  const bossIid = st.players[0].hand[0].iid;
  const plan = GUST.planGust(st, 0, pool, bossIid);
  assert.equal(plan?.targetIid, togepi.iid, '前提：只有波克比打得倒');
  let p = applyAction(st, { type: 'PLAY_TRAINER', iid: bossIid }, pool);
  // 把萊希拉姆ex 改成打得倒（2 張）——重新試算會改選它；沿用結論則仍拉波克比
  p = { ...p, players: [p.players[0], { ...p.players[1], bench: p.players[1].bench.map((b) => (b.iid === reshi.iid ? { ...b, damage: 190 } : b)) }] };
  assert.deepEqual(getAIAction(p, pool, 0)?.selectedIids, [togepi.iid]);
});
T('P4 正對照：預計的目標已經不是合法選項 ⇒ 不硬選它，改成重新試算', () => {
  const togepi = inst(TOGEPI), reshi = inst(RESHI, { damage: 190 });
  const st = mk({ hand: [BOSS], oppBench: [togepi, reshi] });
  const bossIid = st.players[0].hand[0].iid;
  assert.equal(GUST.planGust(st, 0, pool, bossIid)?.targetIid, reshi.iid);
  let p = applyAction(st, { type: 'PLAY_TRAINER', iid: bossIid }, pool);
  p = { ...p, pendingSelection: { ...p.pendingSelection, params: { ...(p.pendingSelection.params ?? {}), validIids: [togepi.iid] } } };
  assert.deepEqual(getAIAction(p, pool, 0)?.selectedIids, [togepi.iid]);
});
T('P5 ⭐ 別的來源開的 gust-opp 視窗（老大的指令還在手上）⇒ 不沿用 planGust 的結論，重新試算', () => {
  const togepi = inst(TOGEPI), reshi = inst(RESHI);
  const st = mk({ hand: [BOSS], oppBench: [togepi, reshi] });
  const bossIid = st.players[0].hand[0].iid;
  assert.equal(GUST.planGust(st, 0, pool, bossIid)?.targetIid, togepi.iid, '前提');
  const played = applyAction(st, { type: 'PLAY_TRAINER', iid: bossIid }, pool);
  // 同一個選擇視窗，但老大的指令仍在手上（例：寶可夢捕捉器之類別張卡開的），而萊希拉姆ex 此時打得倒（2 張）
  const p = { ...st, pendingSelection: played.pendingSelection,
    players: [st.players[0], { ...st.players[1], bench: [togepi, { ...reshi, damage: 190 }] }] };
  assert.deepEqual(getAIAction(p, pool, 0)?.selectedIids, [reshi.iid]);
});
T('P2 ⭐ 打得倒的優先於「剩餘 HP 最少、但這回合不受招式傷害」的那隻（舊判準只看剩餘 HP）', () => {
  const shielded = inst(SNORLAX, { damage: 120, immuneToAttackDamageThisTurn: true });   // 剩 40，但不受招式傷害
  const togepi = inst(TOGEPI);                                                         // 剩 50，打得倒
  const st = mk({ hand: [BOSS], oppBench: [shielded, togepi] });
  assert.equal(aiGustPick(st), togepi.iid);
});

T('P6 ⭐ 跨回合不沿用：上個自己的回合值得拉波克比；這回合別的來源開 gust-opp、波克比打不動、萊希拉姆ex 打得倒 ⇒ 重算選萊希拉姆ex', () => {
  // fable 複審 Ya：拿掉 plannedGustTarget 的 turn 檢查時其他守衛全綠、實際會拉錯隻
  const togepi = inst(TOGEPI), reshi = inst(RESHI);
  const st = mk({ hand: [BOSS], oppBench: [togepi, reshi] });
  const bossIid = st.players[0].hand[0].iid;
  assert.equal(GUST.planGust(st, 0, pool, bossIid)?.targetIid, togepi.iid, '前提');
  const played = applyAction(st, { type: 'PLAY_TRAINER', iid: bossIid }, pool);
  // 兩回合後：老大的指令早已不在手上；同一個選擇視窗（模擬別張卡開的），盤面已變
  const st7 = mk({ hand: [SNORLAX], oppBench: [{ ...togepi, immuneToAttackDamageThisTurn: true }, { ...reshi, damage: 190 }] });
  const p = { ...st7, turn: st.turn + 2, pendingSelection: played.pendingSelection };
  assert.deepEqual(getAIAction(p, pool, 0)?.selectedIids, [reshi.iid]);
});
T('W1 ⭐ 值不值得打（純函式 gustWorth，直接餵數字）：擲幣招平均 0.33 張不算、0.67 張算；純傷害整數張照算；打不動 → 打得動才算', () => {
  assert.ok(GUST && typeof GUST.gustWorth === 'function', 'gustWorth 不存在');
  const w = (bp, bd, gp, gd) => GUST.gustWorth({ prizes: bp, oppDamage: bd }, { prizes: gp, oppDamage: gd });
  assert.equal(w(0, 50, 1 / 3, 40), false, '3 次裡 1 次擊倒不算值得');
  assert.equal(w(0, 50, 2 / 3, 40), true, '3 次裡 2 次擊倒算值得');
  assert.equal(w(2 / 3, 60, 1, 50), false, '只多 0.33 張不算值得');
  assert.equal(w(0, 50, 1, 50), true, '純傷害招多拿 1 張');
  assert.equal(w(1, 50, 2, 40), true, '1 張 → 2 張');
  assert.equal(w(1, 50, 1, 200), false, '獎賞一樣多、只是傷害多 ⇒ 不值得（保留支援者額度）');
  assert.equal(w(0, 0, 0, 30), true, '打不動 → 打得動');
  assert.equal(w(0, 10, 0, 300), false, '原本打得動（即使很少）⇒ 條件②不成立');
  assert.equal(w(0, 0, 0, 0), false, '拉上來也打不動');
});

// ── M：快取不可以過期 ──────────────────────────────────────────────────────────
T('M1 ⭐ planGust 的快取：盤面變了（備戰萊希拉姆ex 被打到剩 50）就要重算，結論從保留變成值得打', () => {
  assert.ok(GUST && typeof GUST.planGust === 'function', 'ai-gust.ts 不存在');
  const reshi = inst(RESHI);
  const st = mk({ hand: [BOSS], oppBench: [reshi] });
  const bossIid = st.players[0].hand[0].iid;
  assert.equal(GUST.planGust(st, 0, pool, bossIid), null, '前提：打不倒時應該保留');
  const st2 = { ...st, players: [st.players[0], { ...st.players[1], bench: [{ ...reshi, damage: 180 }] }] };
  const r = GUST.planGust(st2, 0, pool, bossIid);
  assert.ok(r && r.targetIid === reshi.iid, '快取過期：盤面變了仍回傳舊結論 ' + JSON.stringify(r));
});

// ── D：魔靈多龍預組不走這裡（它有自己調過的老大的指令用法）────────────────────
T('D1 魔靈多龍預組（牌裡有多龍巴魯托ex＋黑夜魔靈＋含羞苞）⇒ 保留邏輯不套用：老大的指令排在前面就照舊先打', () => {
  const ids = {};
  for (const [id, c] of pool) if (['多龍巴魯托ex', '黑夜魔靈', '含羞苞'].includes(c.name) && ['H', 'I', 'J'].includes(c.regulationMark) && !ids[c.name]) ids[c.name] = id;
  assert.equal(Object.keys(ids).length, 3, '找不到魔靈多龍指紋卡');
  const st = mk({ hand: [BOSS, GUY], oppBench: [inst(RESHI)], deckExtra: Object.values(ids) });
  assert.equal(aiTrainer(st), '老大的指令');
});

// ── N：借招冷卻的對戰紀錄說明（v6.435 fable 審查建議）─────────────────────────
T('N1 ⭐ 揮指：天仙石冷卻中 ⇒ 對戰紀錄寫明「天仙石」冷卻中不能借（正對照：沒冷卻時不寫）', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: SNORLAX, count: 1 }] }, { name: 'P2', entries: [{ cardId: SNORLAX, count: 1 }] }, pool);
  const base = (cool) => ({ ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    attackNamesUsedLastSelfTurn: { p1: cool, p2: [] },
    players: [{ ...s.players[0], hand: [], deck: Array.from({ length: 8 }, () => inst(SNORLAX)), discard: [], prizes: Array.from({ length: 6 }, () => inst(SNORLAX)),
      active: inst(CLEFABLE, { energyAttached: [inst(PSY), inst(PSY)] }), bench: [], energyAttachedThisTurn: true },
    { ...s.players[1], hand: [], deck: Array.from({ length: 8 }, () => inst(SNORLAX)), discard: [], prizes: Array.from({ length: 6 }, () => inst(SNORLAX)),
      active: inst(SYLVEON), bench: [inst(SNORLAX), inst(SNORLAX)] }] });
  const logOf = (st) => (st.log ?? []).map((l) => l.message).join('\n');
  const n1 = applyAction(base(['天仙石']), { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.ok(/揮指：「天仙石」在上個自己的回合已經使出過（冷卻中）/.test(logOf(n1)), '沒有說明：' + logOf(n1).slice(-300));
  const n0 = applyAction(base([]), { type: 'ATTACK', attackIndex: 0 }, pool);
  assert.ok(!/冷卻中/.test(logOf(n0)), '沒冷卻卻寫了說明');
});
T('N2 ⭐ 其他借招卡也真的寫進對戰紀錄（欺詐／技能大盜／耀閃挑戰翻到騎拉帝納）', () => {
  const s0 = createGame({ name: 'P1', entries: [{ cardId: SNORLAX, count: 1 }] }, { name: 'P2', entries: [{ cardId: SNORLAX, count: 1 }] }, pool);
  const mkc = (atk, energies, { cool, hand = [inst(SNORLAX)], deckTop = null }) => ({ ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    attackNamesUsedLastSelfTurn: { p1: cool, p2: [] },
    players: [{ ...s0.players[0], hand, deck: [...(deckTop ? [inst(deckTop)] : []), ...Array.from({ length: 8 }, () => inst(SNORLAX))], discard: [],
      prizes: Array.from({ length: 6 }, () => inst(SNORLAX)), active: inst(atk, { energyAttached: energies.map(() => inst(PSY)) }), bench: [], energyAttachedThisTurn: true },
    { ...s0.players[1], hand: [], deck: Array.from({ length: 8 }, () => inst(SNORLAX)), discard: [], prizes: Array.from({ length: 6 }, () => inst(SNORLAX)),
      active: inst(SYLVEON), bench: [inst(SNORLAX), inst(SNORLAX)] }] });
  const logOf = (st) => (st.log ?? []).map((l) => l.message).join('\n');
  const idxOf = (id, name) => pool.get(id).attacks.findIndex((a) => a.name === name);
  const cases = [
    ['欺詐', mkc('16939', [1, 1, 1], { cool: ['天仙石'] }), idxOf('16939', '欺詐'), /欺詐：「天仙石」在上個自己的回合已經使出過（冷卻中）/],
    ['技能大盜', mkc('19196', [1, 1], { cool: ['天仙石'], hand: [] }), idxOf('19196', '技能大盜'), /技能大盜：「天仙石」在上個自己的回合已經使出過（冷卻中）/],
    ['耀閃挑戰', mkc('10934', [1, 1], { cool: ['渾沌匍匐'], deckTop: '19581' }), idxOf('10934', '耀閃挑戰'), /耀閃挑戰：「渾沌匍匐」在上個自己的回合已經使出過（冷卻中）/],
  ];
  for (const [n, st, idx, re] of cases) {
    assert.ok(idx >= 0, n + ' 招式索引');
    const nx = applyAction(st, { type: 'ATTACK', attackIndex: idx }, pool);
    assert.ok(re.test(logOf(nx)), n + ' 沒有寫出冷卻說明：' + logOf(nx).slice(-240));
  }
});
T('N3 ⭐ 每一張借招卡的出招處理都「呼叫同一個說明函式、並把結果寫進對戰紀錄」（接線 pattern；下限 8 處）', () => {
  const files = ['src/lib/game/effects.ts', ...readdirSync(join(ROOT, 'src/lib/game/effects/cards')).map((f) => 'src/lib/game/effects/cards/' + f)];
  let sites = 0; const miss = [];
  for (const f of files) {
    if (!f.endsWith('.ts')) continue;
    const src = stripCommentsBlankChecked(readFileSync(join(ROOT, f), 'utf8'));
    for (const m of src.matchAll(/copyAttackCandidates\('([^']+)'/g)) {
      sites++;
      const k = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 兩種接線：`const _cdNote = copyAttackCooldownNote('K', X, …); if (_cdNote) X = addLog(X, _cdNote, …)`
      //           或 `const _cdNoteT = copyAttackCooldownNote('K', X, …); const rs = _cdNoteT ? addLog(X, _cdNoteT, …) : X;`
      const re1 = new RegExp(`const (_cdNote\\w*) = copyAttackCooldownNote\\('${k}',[^;]*\\);\\s*(if \\(\\1\\) \\w+ = addLog\\([\\w.]+, \\1,|const \\w+ = \\1 \\? addLog\\([\\w.]+, \\1,)`);
      if (!re1.test(src)) miss.push(m[1]);
    }
  }
  assert.ok(sites >= 8, `只掃到 ${sites} 處借招（掃描器壞了？）`);
  assert.deepEqual(miss, [], '沒有把冷卻說明寫進對戰紀錄的借招：' + miss.join('、'));
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail) { console.log('紅：' + failed.join('、')); process.exit(1); }
