// 守衛：選招場面評估 evaluateAttack（v6.040 批次 4d）。
//
// 這支釘的是三個**實際發生過**的錯誤 —— 全都不會報錯、只會讓 AI 安靜地選錯招：
//
//   ① 獎賞有兩條路徑：沒有正面朝上的獎賞卡時是**直接取走**（自己的 prizes 堆變短），
//      只有需要玩家挑時才留在 pendingPrizes。第一版只讀 pendingPrizes，
//      「明明擊倒了對手卻算出 prizes=0」→ 擊倒的招分數輸給沒擊倒的招。
//   ② 傷害不能用「場上指示物總和的前後差」：被擊倒的那隻直接離場，牠身上的傷害
//      跟著消失，差值塌陷成 0。必須逐隻比對 iid，已離場的算牠被打前的剩餘 HP。
//   ③ 欄位名必須查證：`cantAttackPending` 才是對的。第一版寫成 cantAttackNextTurn／
//      mustRechargeNextTurn（兩個都不存在）→ TypeScript 不報錯、值恆 undefined，
//      「下回合不能攻擊」這個代價完全不被計入。
//
// ⚠關於弱點：weakness 確實從未被舊 AI 讀過，但選招是在**同一隻寶可夢的招式之間**比，
//   弱點倍率對牠所有招式相同 → 不會反轉排序。真正會反轉的是免疫／減傷／副作用代價，
//   別把「有讀弱點」當成這批的賣點。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-ae-s.js'), E = join(ROOT, '.x-ae-e.ts'), O = join(ROOT, '.x-ae-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, getEffectiveHP } from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + "export { evaluateAttack, PRIZE_SCORE_UNIT } from './src/lib/game/ai-eval';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, getAIAction, evaluateAttack, PRIZE_SCORE_UNIT }
  = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const liveC = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveC.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 卡面查證自 static/cards（台灣官方中文卡面）：
//   13986 超級路卡利歐ex — 基礎 / 招式[0]「波動突刺」cost【鬥】130（效果會開選擇視窗：
//         從棄牌區選最多3張基本【鬥】能量附給備戰）／招式[1]「超級勇氣」cost【鬥】【鬥】270
//         （效果：下個自己的回合這隻無法使用「超級勇氣」）
//   ⭐這張是完美的測試素材：一招會開選擇視窗、一招不會，正好測到兩條評分路徑。
//   14104 基本【鬥】能量
//   13163 噴火龍ex — 2階 / HP330 / **ex**（擊倒它應給 2 張獎賞，正好驗獎賞計算）
//   ⚠HP330 > 270，所以要測「擊倒」必須先讓它受傷，否則超級勇氣打不死。
const CID = { lucario: '13986', fight: '14104', def: '13163' };
const LUCARIO = pool.get(CID.lucario);
const IDX_WAVE = (LUCARIO.attacks ?? []).findIndex((a) => a.name === '波動突刺');
const IDX_BRAVE = (LUCARIO.attacks ?? []).findIndex((a) => a.name === '超級勇氣');

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const base = () => createGame({ name: 'P1', entries: [{ cardId: CID.def, count: 1 }] },
                              { name: 'P2', entries: [{ cardId: CID.def, count: 1 }] }, pool);
/** 我方戰鬥位＝滿能量的超級路卡利歐ex；對手戰鬥位可指定卡與已受傷害。 */
function mk(oppCardId, oppDamage, oppBench = []) {
  const s = base();
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(CID.def)], discard: [inst(CID.fight), inst(CID.fight)],
        prizes: Array.from({ length: 6 }, () => inst(CID.def)),
        active: inst(CID.lucario, [en(CID.fight), en(CID.fight)]),
        bench: [inst(CID.def)], energyAttachedThisTurn: true },
      { ...s.players[1], hand: [], deck: [inst(CID.def)], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(CID.def)),
        active: inst(oppCardId, [], { damage: oppDamage }), bench: oppBench }] };
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：找得到超級路卡利歐ex 的兩招（招式索引改動時要立刻發現）', () => {
  assert.ok(IDX_WAVE >= 0 && IDX_BRAVE >= 0, '應找得到「波動突刺」與「超級勇氣」');
  assert.equal(LUCARIO.attacks[IDX_WAVE].damage, '130');
  assert.equal(LUCARIO.attacks[IDX_BRAVE].damage, '270');
});

T('⭐⭐①擊倒對手時 prizes 必須 > 0（獎賞「直接取走」那條路徑不可漏算）', () => {
  // 噴火龍ex HP330，先讓牠受 150 → 剩 180，超級勇氣 270 一定打得死
  const st = mk(CID.def, 150);
  const ev = evaluateAttack(st, 0, IDX_BRAVE, pool);
  assert.ok(ev.ok, '這招應該打得出來');
  assert.ok(ev.ko, '270 傷害應擊倒對手');
  assert.ok(ev.prizes >= 2,
    `擊倒 ex 應得 2 張獎賞，實得 ${ev.prizes} —— 獎賞沒有經過 pendingPrizes 而是直接取走，`
    + '兩條路徑都要算，否則「能擊倒」的招分數會輸給沒擊倒的招');
  console.log(`   （擊倒噴火龍ex → prizes=${ev.prizes}，ex 值 2 張，計算涵蓋兩條路徑）`);
});

T('⭐⭐②擊倒時 oppDamage 不可塌陷成 0（被擊倒者離場，指示物總和差會失真）', () => {
  const st = mk(CID.def, 150);
  const ev = evaluateAttack(st, 0, IDX_BRAVE, pool);
  assert.ok(ev.ko, '前提：這一擊應該擊倒對手');
  assert.ok(ev.oppDamage > 0,
    `擊倒對手卻算出 oppDamage=${ev.oppDamage} —— 必須逐隻比對 iid，`
    + '已離場的算牠被打前的剩餘 HP，不能只比場上指示物總和');
});

T('⭐⭐能擊倒的招分數必須高於不能擊倒的招（漏 KO 是最嚴重的退化）', () => {
  // 對手剩餘 HP 落在 130 與 270 之間 → 只有超級勇氣打得死
  const oppHp = pool.get(CID.def)?.hp ?? 0;
  const dmg = Math.max(0, oppHp - 200);   // 讓對手剩約 200
  const st = mk(CID.def, dmg);
  const evBrave = evaluateAttack(st, 0, IDX_BRAVE, pool);
  const evWave = evaluateAttack(st, 0, IDX_WAVE, pool);
  if (evBrave.ko && !evWave.ko) {
    assert.ok(evBrave.score > evWave.score,
      `能擊倒的「超級勇氣」score=${evBrave.score} 竟不高於「波動突刺」score=${evWave.score}`);
  }
  // AI 的實際選擇也要一致
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK');
  if (evBrave.ko && !evWave.ko) {
    assert.equal(act.attackIndex, IDX_BRAVE, 'AI 應選能擊倒的那一招');
  }
});

T('⭐③會開選擇視窗的招要被標為 unresolved（否則它的傷害會被當成 0）', () => {
  // 「波動突刺」的效果是從棄牌區選能量附給備戰 → 打完會停在選擇視窗
  const st = mk(CID.def, 0);
  const ev = evaluateAttack(st, 0, IDX_WAVE, pool);
  assert.ok(ev.ok, '這招應該打得出來');
  assert.ok(ev.unresolved,
    '波動突刺打完應停在選擇視窗；沒被標記的話，呼叫端不會走保底估值，'
    + '這招的傷害就會被當成 0 而永遠不被選');
});

T('⭐③欄位名 cantAttackPending 必須存在於引擎（寫錯名字不會報錯，代價會靜默歸零）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/ai-eval.ts'), 'utf8');
  assert.ok(/selfNow\.cantAttackPending/.test(src), 'ai-eval 應讀 cantAttackPending');
  // ⚠只比對「實際的屬性存取」，不要連註解一起抓 —— 註解裡刻意記錄了寫錯的名字
  //   以免日後有人再犯，第一版的 regex 太寬把自己的註解也判成違規。
  assert.ok(!/\.(cantAttackNextTurn|mustRechargeNextTurn)\b/.test(src),
    '這兩個欄位在 types.ts 裡不存在 —— 用了它們代價會恆為 0 且毫無徵兆');
  const types = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
  assert.ok(/cantAttackPending\?:/.test(types), 'types.ts 應真的有這個欄位');
});

T('⭐評估不得改動傳入的盤面', () => {
  const st = mk(CID.def, 0);
  const snap = JSON.stringify(st);
  evaluateAttack(st, 0, IDX_BRAVE, pool);
  assert.equal(JSON.stringify(st), snap, '傳入的 state 必須原封不動');
});

T('⭐⭐評估不得消耗真實對局的隨機序列', () => {
  const st = mk(CID.def, 0);
  const orig = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return orig(); };
  try { evaluateAttack(st, 0, IDX_BRAVE, pool); } finally { Math.random = orig; }
  assert.equal(calls, 0, `評估期間外部 Math.random 被呼叫 ${calls} 次 —— 必須用隔離的 PRNG`);
});

T('⭐保底估值的尺度不可超過真正試打出來的擊倒分數', () => {
  // 一張獎賞的份量是共用常數；呼叫端保底時用它換算，兩條路徑才可比。
  assert.equal(typeof PRIZE_SCORE_UNIT, 'number');
  assert.ok(PRIZE_SCORE_UNIT > 300,
    '獎賞的份量必須壓過任何單次傷害數字，否則「能擊倒」會輸給「傷害高但沒擊倒」');
  const ai = readFileSync(join(ROOT, 'src/lib/game/ai.ts'), 'utf8');
  assert.ok(/return \(_oppRem > 0 && est >= _oppRem\) \? PRIZE_SCORE_UNIT : est;/.test(ai),
    '保底判定「打得死」時只該補一張獎賞的份量，不可再加上估計傷害 —— '
    + '那會超過真正擊倒（可能值 2~3 張獎賞）的分數，AI 反而放掉能擊倒的招');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
