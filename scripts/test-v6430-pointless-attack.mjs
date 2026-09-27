// ⭐v6.430 守衛：AI 對戰強化 批次 C —「打不動」偵測（ai-eval 中央 isPointlessAttack／attackBoardChangeKeys ＋ ai.ts 攻擊分支出口）
//
// 背景：ai.ts 的攻擊分支用 reduce 選招，一定選得出一招 ⇒ 舊版只要有招可發就一定 return ATTACK。
//   對手完全免疫、或招式本身失敗（例：太陽岩｜宇宙光束 備戰沒有月石）時，AI 會一直空打、永遠走不到下面的撤退換人。
// 新版：**每一招**都「引擎接受、沒擊倒、沒拿獎賞、對手零傷害、盤面沒有任何其他變化、也沒用到亂數」⇒ 不出招，
//   落到撤退換人；撤退也不成立才結束回合。
//
// 守的東西：
//   P1  打不動 ⇒ 不送 ATTACK（沒有備戰 ⇒ 結束回合）
//   P2  打不動、備戰有打得倒的 ⇒ 撤退換人
//   P3  零傷害但會附加效果（菊草葉｜叫聲）⇒ 照樣出招（正對照）
//   P4  零傷害但會抽牌（青銅鐘｜三重抽出）⇒ 照樣出招（正對照）
//   P5  擲幣招（阿羅拉 地鼠｜偷襲）：3 次試打剛好全反面時平均是 0 ⇒ 也不可以誤擋（64 個起點都要出招）
//   P6  中央述詞 isPointlessAttack：每一個條件各自拿掉都要翻成 false（Rule 39：一次只改一個欄位）
//   P7  盤面指紋 attackBoardChangeKeys：簿記欄位不算、undefined 與不存在視為相同；狀態／牌庫順序／備戰變化要抓得到
//   P8  有傷害的招照舊出招（零回歸）
//   P9  兩招一有傷害一零傷害 ⇒ 出有傷害的那招
//   P10 兩招一打不動一有傷害 ⇒ 只看「全部」（every，不是 some）
//   P11 usedRandom 量得到（擲幣 true／不擲幣 false）
//   P12 選中的那招打不動、另一招有效果 ⇒ 改出有效果的那招（fable 審查 A①）
//   P13 公平性：出不出招不可以取決於對手手牌內容（fable 審查 D）
//   P14 shuffleHiddenZonesForSim 的遮蔽範圍（自己手牌不動、對手手牌與雙方蓋著的獎賞卡重發）
//   P15／P16 零傷害的恢復招、附能量招：條件成立出招、不成立不出（fable 審查 F 的正對照）
//   P17 換招不換到負分的招（只丟能量沒有收益）
//   ⚠ P5 的行為層同時被兩道判準撐住（擲幣招會寫擲幣簿記欄位 ⇒ sideEffectKeys 非空），所以「忽略 usedRandom」只有 P6 會紅；
//     usedRandom 這一道留著，是給「用到亂數但沒有寫任何簿記」的效果（例：隨機選卡但剛好沒有作用）。
// 卡片事實一律取自 static/cards（台灣官方卡面）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6430-s.js'), E = join(ROOT, '.x-v6430-e.ts'), O = join(ROOT, '.x-v6430-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, [
  "export * as ENG from './src/lib/game/engine';",
  "export { getAIAction } from './src/lib/game/ai';",
  "export * as EVAL from './src/lib/game/ai-eval';",
  "import './src/lib/game/effects';",
].join('\n'));
// 每條測試開頭把 ai-eval 的試打亂數種子歸零（與 scripts/lib/ai-sim-harness.mjs 同一招：只在本打包附加，不改 src/）
const seedResetPlugin = { name: 'sim-seed-reset', setup(b) {
  b.onLoad({ filter: /[\\/]ai-eval\.ts$/ }, (args) => {
    const src = readFileSync(args.path, 'utf8');
    const m = /let _simSeed = (0x[0-9a-fA-F]+|\d+);/.exec(src);
    if (!m) throw new Error('ai-eval.ts 找不到 `let _simSeed = …;`（改名了？請更新本守衛）');
    return { contents: src + `\nexport function __testResetSimSeed(k = 0) { _simSeed = (${m[1]} + k * 0x9e3779b9) >>> 0; }\n`, loader: 'ts' };
  });
} };
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', plugins: [seedResetPlugin],
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, getAIAction, EVAL } = await import(pathToFileURL(O).href);
const { createGame, applyAction } = ENG;
// ⚠ Rule 41：本版新增的中央述詞在 BASE 上不存在 ⇒ 用哨兵包起來，讓每一條各自誠實翻紅
const MISSING = Symbol('missing');
const F = (n) => (typeof EVAL?.[n] === 'function' ? EVAL[n] : () => MISSING);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const C = { solrock: '14747', chikorita: '16487', bronzong: '14378', diglett: '11256', kangaskhan: '14071',
  snorlax: '17038', slowking: '10934', darmanitan: '14688', fire: '17216', trubbish: '10956', rotom: '16719', dark: '17214', lightning: '17218', whimsicott: '14356', regirock: '16845', zeraora: '14715', fight: '17215', grass: '17217', psy: '17220', tablet: '17133' };
for (const [k, id] of Object.entries(C)) assert.ok(pool.get(id), `找不到 ${k} ${id}（卡池變了？）`);
const atkOf = (cid, name) => pool.get(cid).attacks.find((a) => a.name === name);
const idxOf = (cid, name) => pool.get(cid).attacks.findIndex((a) => a.name === name);
// 卡面前提（變了就要重新查證）
assert.ok(/若自己的備戰區沒有「月石」，則這個招式失敗/.test(atkOf(C.solrock, '宇宙光束')?.effect ?? ''), '太陽岩｜宇宙光束卡面變了');
assert.ok(/受到這個招式的寶可夢使用招式的傷害「-20」點/.test(atkOf(C.chikorita, '叫聲')?.effect ?? '') && atkOf(C.chikorita, '叫聲').damage === '', '菊草葉｜叫聲卡面變了');
assert.ok(/從自己的牌庫抽出3張卡/.test(atkOf(C.bronzong, '三重抽出')?.effect ?? ''), '青銅鐘｜三重抽出卡面變了');
assert.ok(/造成對手的棄牌區的基本能量卡的張數×30點傷害/.test(atkOf(C.darmanitan, '復燃')?.effect ?? '') && atkOf(C.darmanitan, '火人加農炮')?.damage === '90', 'N的達摩狒狒卡面變了');
assert.ok(atkOf(C.trubbish, '口水')?.damage === '10' && !atkOf(C.trubbish, '口水').effect && /將對手的戰鬥寶可夢【中毒】/.test(atkOf(C.trubbish, '毒之氣息')?.effect ?? ''), '溶食獸卡面變了');
assert.ok(/查看對手的手牌，將其中的「物品」卡與「寶可夢道具」卡全部丟棄/.test(atkOf(C.rotom, '粉碎脈衝')?.effect ?? '') && atkOf(C.rotom, '粉碎脈衝').damage === '', '洛托姆｜粉碎脈衝卡面變了');
assert.ok(/將自己的1隻備戰寶可夢的HP全部恢復/.test(atkOf(C.whimsicott, '治癒棉絮')?.effect ?? '') && atkOf(C.whimsicott, '治癒棉絮').damage === '', '風妖精｜治癒棉絮卡面變了');
assert.ok(/從自己的棄牌區選擇最多2張「基本【鬥】能量」卡，附於這隻寶可夢身上/.test(atkOf(C.regirock, '雷吉充能')?.effect ?? ''), '雷吉洛克ex｜雷吉充能卡面變了');
assert.ok(atkOf(C.zeraora, '抓')?.damage === '20' && !atkOf(C.zeraora, '抓').effect
  && /將這隻寶可夢身上附加的能量卡全部丟棄，對手的備戰區的1隻「寶可夢【ex】」受到210點傷害/.test(atkOf(C.zeraora, '閃電急襲')?.effect ?? ''), '捷拉奧拉卡面變了');
assert.ok(/擲1次硬幣若為反面，則這個招式失敗/.test(atkOf(C.diglett, '偷襲')?.effect ?? '') && atkOf(C.diglett, '偷襲').cost.length === 0, '阿羅拉 地鼠｜偷襲卡面變了');

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'p' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => inst(cid);
const fill = (n, cid = C.tablet) => Array.from({ length: n }, () => inst(cid));
/** 我方 active／bench 自訂；對手：戰鬥位卡比獸（160 HP）＋備戰 2 隻卡比獸。 */
function mk({ active, bench = [], hand = [], deck = fill(12), oppHand = [], oppDeck = null, oppActiveX = {} }) {
  const s = createGame({ name: 'P1', entries: [{ cardId: C.snorlax, count: 1 }] },
    { name: 'P2', entries: [{ cardId: C.snorlax, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, activeStadium: null, stadiumUsedThisTurn: [false, false],
    players: [
      { ...s.players[0], hand, deck, discard: [], prizes: fill(6, C.snorlax), active, bench, energyAttachedThisTurn: true, supporterPlayedThisTurn: false },
      { ...s.players[1], hand: oppHand, deck: oppDeck ?? fill(20, C.snorlax), discard: [], prizes: fill(6, C.snorlax),
        active: inst(C.snorlax, [], oppActiveX), bench: [inst(C.snorlax), inst(C.snorlax)] }] };
}

let pass = 0, fail = 0; const failed = [];
const T = (n, f) => { try { EVAL.__testResetSimSeed?.(0); f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n.split(' ')[0]); } };

// ── 行為 ─────────────────────────────────────────────────────────────────────
T('P1 ⭐ 太陽岩｜宇宙光束（備戰沒有月石 ⇒ 招式失敗）、沒有備戰 ⇒ 不送 ATTACK，結束回合', () => {
  const st = mk({ active: inst(C.solrock, [en(C.fight)]) });
  // 前置條件：這一招確實「打不動」（否則下面的否定斷言是空真）
  const ev = EVAL.evaluateAttack(st, 0, idxOf(C.solrock, '宇宙光束'), pool);
  assert.ok(ev.ok && ev.oppDamage === 0 && ev.prizes === 0, '前置條件：宇宙光束應該打得出去但零傷害：' + JSON.stringify(ev));
  const act = getAIAction(st, pool, 0);
  assert.notEqual(act?.type, 'ATTACK', '打不動還出招：' + JSON.stringify(act));
  assert.equal(act?.type, 'END_TURN', JSON.stringify(act));
});

T('P2 ⭐ 同上、備戰有打得倒對手的超級袋獸ex、撤退費付得起 ⇒ 撤退換人（舊版永遠走不到這裡）', () => {
  const st = mk({ active: inst(C.solrock, [en(C.fight)]), bench: [inst(C.kangaskhan, [en(C.psy), en(C.psy), en(C.psy)])] });
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'RETREAT', '應該撤退換超級袋獸ex：' + JSON.stringify(act));
  assert.equal(act.newActiveIid, st.players[0].bench[0].iid);
});

T('P3 ⭐ 正對照：菊草葉｜叫聲（零傷害，但對手下回合招式傷害 -20）⇒ 照樣出招', () => {
  const st = mk({ active: inst(C.chikorita, [en(C.grass)]) });
  const ev = EVAL.evaluateAttack(st, 0, idxOf(C.chikorita, '叫聲'), pool);
  assert.ok(ev.ok && ev.oppDamage === 0, '前置條件：叫聲應為零傷害：' + JSON.stringify(ev));
  assert.ok(Array.isArray(ev.sideEffectKeys) && ev.sideEffectKeys.some((k) => /^p1\.戰鬥位\./.test(k)),
    '應偵測到對手戰鬥寶可夢身上的效果：' + JSON.stringify(ev.sideEffectKeys));
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', JSON.stringify(act));
});

T('P4 ⭐ 正對照：青銅鐘｜三重抽出（零傷害，但抽 3 張）⇒ 照樣出招', () => {
  const st = mk({ active: inst(C.bronzong, [en(C.psy)]) });
  const ev = EVAL.evaluateAttack(st, 0, idxOf(C.bronzong, '三重抽出'), pool);
  assert.ok(ev.ok && ev.oppDamage === 0, '前置條件：三重抽出應為零傷害');
  assert.ok(Array.isArray(ev.sideEffectKeys) && ev.sideEffectKeys.includes('p0.hand') && ev.sideEffectKeys.includes('p0.deck'),
    '應偵測到手牌與牌庫變化：' + JSON.stringify(ev.sideEffectKeys));
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', JSON.stringify(act));
});

T('P5 ⭐ 擲幣招不誤擋：阿羅拉 地鼠｜偷襲（反面失敗）—— 3 次試打剛好全反面時平均是 0，64 個起點都要出招', () => {
  const st = mk({ active: inst(C.diglett) });
  const K = 64;
  let allTails = 0, attacked = 0; const seen = [];
  for (let k = 0; k < K; k++) {
    EVAL.__testResetSimSeed(k);
    if (EVAL.evaluateAttack(st, 0, 0, pool).oppDamage === 0) allTails++;
    EVAL.__testResetSimSeed(k);
    const a = getAIAction(st, pool, 0);
    if (a?.type === 'ATTACK') attacked++; else seen.push(k + ':' + a?.type);
  }
  // 前置條件：危險情況（3 次全反面）確實出現過，否則這一條證明不了任何事
  assert.ok(allTails >= 2, `64 個起點裡「3 次試打全反面」只出現 ${allTails} 次（前置條件不成立）`);
  assert.equal(attacked, K, '擲幣招被誤當成打不動：' + seen.join(','));
});

T('P8 零回歸：有傷害的招照舊出招（呆呆王｜超念力 打卡比獸）', () => {
  const st = mk({ active: inst(C.slowking, [en(C.psy), en(C.psy), en(C.psy)]) });
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', JSON.stringify(act));
});

// ── 中央述詞（直呼：避免被外層流程遮蔽；Rule 39：每一條只改一個欄位） ──────────────────
const isPointless = F('isPointlessAttack');
const PURE = { ok: true, ko: false, dealt: 0, unresolved: false, prizes: 0, oppDamage: 0, selfEnergyLost: 0, selfDamage: 0,
  gameWon: false, score: 0, sideEffectKeys: [], usedRandom: false };
T('P6 ⭐ isPointlessAttack：純粹打不動 ⇒ true；任何一個條件不成立 ⇒ false', () => {
  assert.equal(isPointless(PURE), true, '純粹打不動應為 true');
  const flips = {
    ok: { ok: false }, unresolved: { unresolved: true }, ko: { ko: true }, gameWon: { gameWon: true },
    prizes: { prizes: 0.34 }, oppDamage: { oppDamage: 3.3 }, sideEffectKeys: { sideEffectKeys: ['p1.戰鬥位.status'] }, usedRandom: { usedRandom: true },
  };
  for (const [k, patch] of Object.entries(flips)) assert.equal(isPointless({ ...PURE, ...patch }), false, `${k} 不成立時仍判為打不動`);
  assert.equal(isPointless(null), false, 'null（借招路徑）不可當成打不動');
  assert.equal(isPointless(undefined), false, 'undefined 不可當成打不動');
});

T('P7 ⭐ attackBoardChangeKeys：簿記欄位與 undefined／不存在不算；狀態、牌庫順序、備戰、道具要抓得到', () => {
  const keys = F('attackBoardChangeKeys');
  const st = mk({ active: inst(C.slowking, [en(C.psy)]), deck: fill(6) });
  const clone = () => structuredClone(st);
  const r0 = keys(clone(), clone());
  assert.notEqual(r0, MISSING, 'attackBoardChangeKeys 不存在');
  assert.deepEqual(r0, [], '同一個盤面應為空');
  // 簿記：每次攻擊都會變的欄位
  const b1 = clone();
  Object.assign(b1, { turnPhase: 'end', log: [...(b1.log ?? []), { message: 'x' }], lastDealtDamage: 0, attackDamageToDefActive: 0,
    attackNamesUsedThisTurn: { p1: ['超念力'] }, coinFlippedThisAttack: false, _koDefenderSnapshot: null, _attackerActiveBonusDone: false,
    _attackSelfPenalty: undefined, _retryInjectedFlipsQueue: undefined, _pendingSeq: (b1._pendingSeq ?? 0) + 2 });
  b1.players[0] = { ...b1.players[0], currentTurnActions: [{ t: 'atk' }], active: { ...b1.players[0].active, attackUsedThisTurn: true } };
  assert.deepEqual(keys(clone(), b1), [], '簿記欄位不應算成效果：' + JSON.stringify(keys(clone(), b1)));
  // 效果：對手戰鬥位狀態
  const b2 = clone(); b2.players[1] = { ...b2.players[1], active: { ...b2.players[1].active, status: 'asleep' } };
  assert.deepEqual(keys(clone(), b2), ['p1.戰鬥位.status']);
  // 效果：牌庫只換順序（張數不變）也要抓到
  const b3 = clone(); const d = [...b3.players[0].deck]; [d[0], d[1]] = [d[1], d[0]]; b3.players[0] = { ...b3.players[0], deck: d };
  assert.deepEqual(keys(clone(), b3), ['p0.deck']);
  // 效果：對手備戰被換上戰鬥位
  const b4 = clone(); const p1 = b4.players[1];
  b4.players[1] = { ...p1, active: p1.bench[0], bench: [p1.active, p1.bench[1]] };
  const k4 = keys(clone(), b4);
  assert.ok(k4.includes('p1.activeIid') && k4.includes('p1.benchIids'), JSON.stringify(k4));
  // 效果：遊戲層級（競技場被丟棄）
  const b5 = clone(); b5.activeStadium = inst(C.tablet);
  assert.deepEqual(keys(clone(), b5), ['state.activeStadium']);
  // 刻意不排除：古代寶可夢「使出了招式」的紀錄（下回合輪番狂攻會讀）⇒ 要算成盤面變化
  const b6 = clone(); b6.ancientAttackedIidsThisTurn = { p1: [b6.players[0].active.iid], p2: [] };
  assert.deepEqual(keys(clone(), b6), ['state.ancientAttackedIidsThisTurn']);
  // 效果：備戰寶可夢身上的變化、自己戰鬥位的能量與傷害（fable 審查 F：這三類之前沒有正對照）
  const b7 = clone(); const ob = b7.players[1].bench; b7.players[1] = { ...b7.players[1], bench: [{ ...ob[0], status: 'poisoned' }, ob[1]] };
  assert.deepEqual(keys(clone(), b7), ['p1.備戰.status']);
  const b8 = clone(); b8.players[0] = { ...b8.players[0], active: { ...b8.players[0].active, energyAttached: [] } };
  assert.deepEqual(keys(clone(), b8), ['p0.戰鬥位.energyAttached']);
  const b9 = clone(); b9.players[0] = { ...b9.players[0], active: { ...b9.players[0].active, damage: 30 } };
  assert.deepEqual(keys(clone(), b9), ['p0.戰鬥位.damage']);
});

T('P9 兩招一有傷害一零傷害 ⇒ 出有傷害的那招（呆呆王：耀閃挑戰翻到物品卡／超念力 120）', () => {
  // 呆呆王｜耀閃挑戰：牌庫頂是物品卡 ⇒ 丟棄後沒有招可借（零傷害，但牌庫／棄牌區有變化）；超念力 120 ⇒ 選超念力
  //   ⚠ 自己蓋著的獎賞卡也要是物品卡：v6.430 起試打時蓋著的獎賞卡與牌庫合起來重發（自己也不知道哪幾張被放進獎賞卡），
  //     獎賞卡若是卡比獸，牌庫頂就「可能」是卡比獸而借得到招 —— 那是正確的資訊模型，不是這一條要測的東西。
  const st = mk({ active: inst(C.slowking, [en(C.psy), en(C.psy), en(C.psy)]) });
  st.players[0].prizes = fill(6);
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK');
  assert.equal(act.attackIndex, idxOf(C.slowking, '超念力'), JSON.stringify(act));
});

T('P10 ⭐ 兩招一打不動一有傷害 ⇒ 只看「全部」：N的達摩狒狒（復燃：對手棄牌區沒有基本能量 ⇒ 0；火人加農炮 90）⇒ 出火人加農炮', () => {
  const st = mk({ active: inst(C.darmanitan, [en(C.fire), en(C.fire), en(C.fire)]) });
  // 前置條件：復燃確實是「打不動」
  const ev = EVAL.evaluateAttack(st, 0, idxOf(C.darmanitan, '復燃'), pool);
  assert.equal(F('isPointlessAttack')(ev), true, '前置條件：復燃應為打不動：' + JSON.stringify(ev));
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', '只有一招打不動就不出招（應該是「全部」都打不動才不出）：' + JSON.stringify(act));
  assert.equal(act.attackIndex, idxOf(C.darmanitan, '火人加農炮'), JSON.stringify(act));
});

T('P11 ⭐ usedRandom 量得到：擲幣招為 true、不擲幣的招為 false（兩個值都要驗）', () => {
  const coin = EVAL.evaluateAttack(mk({ active: inst(C.diglett) }), 0, 0, pool);
  assert.equal(coin.usedRandom, true, '阿羅拉 地鼠｜偷襲（擲幣）應為 usedRandom=true：' + JSON.stringify(coin));
  const plain = EVAL.evaluateAttack(mk({ active: inst(C.solrock, [en(C.fight)]) }), 0, 0, pool);
  assert.equal(plain.usedRandom, false, '太陽岩｜宇宙光束（不擲幣）應為 usedRandom=false：' + JSON.stringify(plain));
});

T('P12 ⭐ 選中的那招打不動、另一招有效果 ⇒ 改出有效果的那招（溶食獸 對 本回合不受傷害的對手：口水 0 分、毒之氣息 0 分但會中毒）', () => {
  const st = mk({ active: inst(C.trubbish, [en(C.dark), en(C.dark), en(C.dark)]), oppActiveX: { immuneToAttackDamageThisTurn: true } });
  const e0 = EVAL.evaluateAttack(st, 0, idxOf(C.trubbish, '口水'), pool), e1 = EVAL.evaluateAttack(st, 0, idxOf(C.trubbish, '毒之氣息'), pool);
  // 前置條件：口水打不動、毒之氣息零傷害但有效果（兩招分數都是 0，reduce 平手會選第一招）
  assert.ok(F('isPointlessAttack')(e0) === true && F('isPointlessAttack')(e1) === false && e1.oppDamage === 0,
    '前置條件不成立：' + JSON.stringify({ e0: [e0.oppDamage, e0.sideEffectKeys], e1: [e1.oppDamage, e1.sideEffectKeys] }));
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', JSON.stringify(act));
  assert.equal(act.attackIndex, idxOf(C.trubbish, '毒之氣息'), '仍空打口水：' + JSON.stringify(act));
});

T('P13 ⭐ 公平性：試打看不到對手手牌——洛托姆｜粉碎脈衝的出招與否，不可以取決於對手手牌「剛好有沒有物品卡」', () => {
  // 兩個盤面看不到的卡完全相同（對手手牌＋牌庫＋蓋著的獎賞卡合起來是同一堆），只差「寶可平板在手牌還是牌庫」
  const mkR = (tabletInHand) => mk({ active: inst(C.rotom, [en(C.lightning)]), oppActiveX: { immuneToAttackDamageThisTurn: true },
    oppHand: tabletInHand ? [inst(C.snorlax), inst(C.tablet), inst(C.snorlax)] : [inst(C.snorlax), inst(C.snorlax), inst(C.snorlax)],
    oppDeck: tabletInHand ? fill(20, C.snorlax) : [inst(C.tablet), ...fill(19, C.snorlax)] });
  const K = 24; const cnt = { true: 0, false: 0 };
  for (const inHand of [true, false]) {
    const st = mkR(inHand);
    for (let k = 0; k < K; k++) { EVAL.__testResetSimSeed(k); if (getAIAction(st, pool, 0)?.type === 'ATTACK') cnt[inHand]++; }
  }
  // 偷看對手手牌時會是 24 比 0；看不到時兩邊是同一個分布（差距在亂數範圍內）
  assert.ok(Math.abs(cnt.true - cnt.false) <= 10, `出招次數取決於對手手牌內容：手牌有物品 ${cnt.true}/${K}、沒有 ${cnt.false}/${K}`);
  // 看不到時「寶可平板剛好被發到對手手牌」的機率只有 3/29（3 次試打聯集約 28%）⇒ 手牌真的有物品卡的那一邊也不該過半
  assert.ok(cnt.true < K / 2, `手牌有物品卡時出招 ${cnt.true}/${K} 次，過半 ⇒ 仍看得到對手手牌`);
});

T('P14 ⭐ shuffleHiddenZonesForSim：自己的手牌不動；對手手牌、雙方蓋著的獎賞卡與牌庫合起來重發（張數與卡片集合不變）；正面朝上的獎賞卡不動', () => {
  const st0 = mk({ active: inst(C.slowking), hand: [inst(C.psy), inst(C.fire)], deck: fill(10),
    oppHand: [inst(C.tablet), inst(C.tablet)], oppDeck: fill(15, C.snorlax) });
  st0.players[1].prizes[2] = { ...st0.players[1].prizes[2], faceUp: true };
  const ids = (arr) => arr.map((c) => c.iid);
  const bag = (p) => [...p.hand, ...p.deck, ...p.prizes.filter((c) => !c.faceUp)].map((c) => c.iid).sort().join(',');
  let oppHandChanged = 0, myPrizeChanged = 0;
  for (let t = 0; t < 40; t++) {
    const sim = EVAL.withIsolatedRandom(() => EVAL.shuffleHiddenZonesForSim(structuredClone(st0), 0));
    assert.deepEqual(ids(sim.players[0].hand), ids(st0.players[0].hand), '自己的手牌不可以被動到');
    assert.equal(sim.players[1].hand.length, 2); assert.equal(sim.players[1].prizes.length, 6); assert.equal(sim.players[1].deck.length, 15);
    assert.equal(sim.players[1].prizes[2].iid, st0.players[1].prizes[2].iid, '正面朝上的獎賞卡不可以被換掉');
    assert.equal(bag(sim.players[1]), bag(st0.players[1]), '對手看不到的卡片集合必須不變');
    assert.equal(bag(sim.players[0]), bag(st0.players[0]), '自己看不到的卡片集合必須不變');
    if (ids(sim.players[1].hand).join() !== ids(st0.players[1].hand).join()) oppHandChanged++;
    if (ids(sim.players[0].prizes).join() !== ids(st0.players[0].prizes).join()) myPrizeChanged++;
  }
  assert.ok(oppHandChanged >= 30, `對手手牌應該被重發（40 次只有 ${oppHandChanged} 次變了）`);
  assert.ok(myPrizeChanged >= 30, `自己蓋著的獎賞卡也看不到，應該被重發（40 次只有 ${myPrizeChanged} 次變了）`);
});

T('P15 ⭐ 零傷害的恢復招：風妖精｜治癒棉絮——備戰有受傷 ⇒ 出招；備戰都沒受傷 ⇒ 打不動（兩個值都要驗）', () => {
  // 用基本【鬥】能量（只當【無】）：另一招 急速折返 要【超】，這樣可用的只有治癒棉絮
  const build = (dmg) => mk({ active: inst(C.whimsicott, [en(C.fight)]), bench: [inst(C.snorlax, [], { damage: dmg })] });
  const hurt = build(50);
  const ev = EVAL.evaluateAttack(hurt, 0, idxOf(C.whimsicott, '治癒棉絮'), pool);
  assert.ok(Array.isArray(ev.sideEffectKeys) && ev.sideEffectKeys.includes('p0.備戰.damage'), '應偵測到備戰恢復：' + JSON.stringify(ev.sideEffectKeys));
  assert.equal(getAIAction(hurt, pool, 0)?.type, 'ATTACK', '備戰受傷時應該出治癒棉絮');
  const fine = build(0);
  assert.notEqual(getAIAction(fine, pool, 0)?.type, 'ATTACK', '備戰都沒受傷時治癒棉絮沒有作用，不應出招');
});

T('P16 ⭐ 零傷害的附能量招：雷吉洛克ex｜雷吉充能——棄牌區有基本【鬥】能量 ⇒ 出招；沒有 ⇒ 打不動', () => {
  const build = (withEnergy) => {
    const st = mk({ active: inst(C.regirock, [en(C.psy)]) });
    st.players[0].discard = withEnergy ? [en(C.fight), en(C.fight)] : [];
    return st;
  };
  const yes = build(true);
  const ev = EVAL.evaluateAttack(yes, 0, idxOf(C.regirock, '雷吉充能'), pool);
  assert.ok(Array.isArray(ev.sideEffectKeys) && ev.sideEffectKeys.includes('p0.戰鬥位.energyAttached'), '應偵測到能量附加：' + JSON.stringify(ev.sideEffectKeys));
  assert.equal(getAIAction(yes, pool, 0)?.type, 'ATTACK', '棄牌區有鬥能量時應該出雷吉充能');
  assert.notEqual(getAIAction(build(false), pool, 0)?.type, 'ATTACK', '棄牌區沒有鬥能量時雷吉充能沒有作用，不應出招');
});

T('P17 選中的那招打不動、另一招有效果但評分是負的 ⇒ 不換過去（捷拉奧拉：抓 0 分；閃電急襲 對手備戰沒有 ex ⇒ 只丟掉全部能量，-150 分）', () => {
  const st = mk({ active: inst(C.zeraora, [en(C.lightning), en(C.lightning), en(C.lightning)]), oppActiveX: { immuneToAttackDamageThisTurn: true } });
  const e1 = EVAL.evaluateAttack(st, 0, idxOf(C.zeraora, '閃電急襲'), pool);
  assert.ok(F('isPointlessAttack')(e1) === false && e1.score < 0, '前置條件：閃電急襲應為「有盤面變化但負分」：' + JSON.stringify({ k: e1.sideEffectKeys, s: e1.score }));
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', JSON.stringify(act));
  assert.equal(act.attackIndex, idxOf(C.zeraora, '抓'), '換到負分的閃電急襲（白白丟掉全部能量）：' + JSON.stringify(act));
});

console.log(`\n=== v6.430 打不動偵測：PASS ${pass} / FAIL ${fail} ===`);
if (fail) { console.log('紅的：' + failed.join('、')); process.exit(1); }
