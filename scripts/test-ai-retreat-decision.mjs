// 守衛：AI 撤退決策（v6.039 批次 4c）。
//
// 在此之前 AI **從不撤退** —— canRetreat 被 import 進 ai.ts 卻一次都沒用過，
// 戰鬥位打不出招時唯一的選擇是 END_TURN，站在原地被打死。
//
// 新分支刻意放在瀑布的**最後**（攻擊之後、END_TURN 之前），所以：
//   「能走到撤退判斷」本身就等於「這回合打不出任何招」。
//   行為變更因此被限制在「原本會結束回合」的那些回合，其餘決策一律不受影響。
//
// 本檔要同時釘住正反兩面 —— 只會撤退的 AI 跟從不撤退的一樣笨：
//   ① 打不出招 + 備戰有能打的 → 要撤退
//   ② 備戰沒有人打得出傷害 → 不可撤退（白丟撤退費換一隻同樣打不動的）
//   ③ 撤退費過高 → 不撤退
//   ④ ⭐評估用的引擎試打**不可以消耗真實對局的隨機序列**
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-rtd-s.js'), E = join(ROOT, '.x-rtd-e.ts'), O = join(ROOT, '.x-rtd-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, canRetreat } from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + "export { estimateIfPromoted, withIsolatedRandom } from './src/lib/game/ai-eval';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, canRetreat, getAIAction, estimateIfPromoted, withIsolatedRandom }
  = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const liveC = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveC.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 卡面查證自 static/cards（台灣官方中文卡面）：
//   18031 超級盔甲鳥ex — 基礎 / HP260 / 撤退費 0 /
//         招式「音波拆裂」cost【鋼】【鋼】【無】→ 附「基本【水】能量」湊不出【鋼】= 打不出招，
//         但撤退費用任何能量都能付 → 造得出「打不動卻撤得起」這個關鍵場面。
//   19245 小鋸鱷 — 基礎 / HP70 / 招式「咬緊」cost【水】傷害 10 → 附 1 顆基本水就能打。
//   18519 基本【水】能量、14104 基本【鬥】能量
const CID = { skarmory: '18031', croc: '19245', water: '18519', fight: '14104', def: '13163' };

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const base = () => createGame({ name: 'P1', entries: [{ cardId: CID.def, count: 1 }] },
                              { name: 'P2', entries: [{ cardId: CID.def, count: 1 }] }, pool);
/** 造一個「我方回合、主階段、手牌空（不會被別的分支搶先）」的盤面。 */
function mk(activeInst, bench) {
  const s = base();
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(CID.def)], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(CID.def)),
        active: activeInst, bench, retreatedThisTurn: false, energyAttachedThisTurn: true },
      { ...s.players[1], hand: [], deck: [inst(CID.def)], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(CID.def)),
        active: inst(CID.def), bench: [] }] };
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：超級盔甲鳥ex 附基本水湊不出【鋼】→ 確實打不出招，但撤得起', () => {
  const st = mk(inst(CID.skarmory, [en(CID.water), en(CID.water), en(CID.water)]),
                [inst(CID.croc, [en(CID.water)])]);
  assert.equal(canRetreat(st, pool), true, '撤退費 0，應該撤得起');
});

T('⭐⭐打不出招 + 備戰有打得動的 → AI 應該撤退換人（舊版只會 END_TURN）', () => {
  const croc = inst(CID.croc, [en(CID.water)]);
  const st = mk(inst(CID.skarmory, [en(CID.water), en(CID.water), en(CID.water)]), [croc]);
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'RETREAT',
    `應該撤退換上打得動的小鋸鱷，實際回了 ${act?.type}`);
  assert.equal(act.newActiveIid, croc.iid);
  // 動作要真的被引擎接受（不是發一個會被拒的動作）
  const after = applyAction(st, act, pool);
  assert.notEqual(after, st, '撤退動作不可被引擎拒絕');
  assert.equal(after.players[0].active?.iid, croc.iid);
});

T('⭐⭐備戰沒有人打得出傷害 → 不可撤退（只會白丟資源、換一隻同樣打不動的）', () => {
  // 備戰那隻沒有能量 → 打不出任何招 → 換上去毫無意義
  const st = mk(inst(CID.skarmory, [en(CID.water), en(CID.water), en(CID.water)]),
                [inst(CID.croc, [])]);
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'END_TURN',
    `備戰換上去也打不動，應結束回合而不是撤退，實際回了 ${act?.type}`);
});

T('⭐撤退費過高（>2）→ 不撤退（為了換人丟一大堆能量通常不划算）', () => {
  const croc = inst(CID.croc, [en(CID.water)]);
  // retreatCostIncreaseThisTurn 把撤退費推到 3；能量夠付，所以擋下它的是 AI 的判斷而非規則
  const st = mk(inst(CID.skarmory, [en(CID.water), en(CID.water), en(CID.water)],
                     { retreatCostIncreaseThisTurn: 3 }), [croc]);
  assert.equal(canRetreat(st, pool), true, '規則上撤得起（能量 3 ≥ 費用 3），才測得到 AI 的取捨');
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'END_TURN', `撤退費 3 應放棄換人，實際回了 ${act?.type}`);
});

T('⭐有招可打時不會被撤退搶走（撤退分支在攻擊之後）', () => {
  // 小鋸鱷在戰鬥位、附水能量 → 打得出「咬緊」→ 應該攻擊而不是撤退
  const st = mk(inst(CID.croc, [en(CID.water)]), [inst(CID.croc, [en(CID.water)])]);
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', `有招可打就該打，實際回了 ${act?.type}`);
});

T('⭐⭐引擎試打不可以消耗真實對局的隨機序列（否則 AI 想得多寡會影響洗牌）', () => {
  const st = mk(inst(CID.skarmory, [en(CID.water), en(CID.water), en(CID.water)]),
                [inst(CID.croc, [en(CID.water)])]);
  const orig = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return orig(); };
  let act;
  try { act = getAIAction(st, pool, 0); } finally { Math.random = orig; }
  assert.equal(act?.type, 'RETREAT', '前提：這個場面本來就會做評估');
  assert.equal(calls, 0,
    `評估期間外部 Math.random 被呼叫了 ${calls} 次 —— 模擬必須用隔離的 PRNG，`
    + '否則「AI 多想幾步」就會改變牌堆與擲幣結果');
});

T('⭐withIsolatedRandom 一定還原 Math.random（即使中途 throw）', () => {
  const orig = Math.random;
  assert.throws(() => withIsolatedRandom(() => { throw new Error('boom'); }), /boom/);
  assert.equal(Math.random, orig,
    '⚠沒還原的話，整場對局的隨機來源會被換成模擬用的固定 PRNG —— '
    + '症狀是「洗牌怪怪的」，幾乎不可能被聯想到 AI 評估');
});

T('⭐estimateIfPromoted 不得改動傳入的盤面（只能在複本上模擬）', () => {
  const croc = inst(CID.croc, [en(CID.water)]);
  const st = mk(inst(CID.skarmory, [en(CID.water)]), [croc]);
  const snapshot = JSON.stringify(st);
  const o = estimateIfPromoted(st, 0, croc, pool);
  assert.ok(o.ok, '小鋸鱷附水能量應打得出咬緊');
  assert.equal(JSON.stringify(st), snapshot, '傳入的 state 必須原封不動');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
