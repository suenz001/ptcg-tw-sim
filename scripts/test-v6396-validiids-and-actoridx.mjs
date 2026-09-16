#!/usr/bin/env node
/**
 * v6.396 守衛：站長裁示的兩件事，各自用**行為端**判準釘住。
 *
 * 【A】heal-target 的 validIids 真的接上中央消毒閘
 *   v6.396 之前：`healOneOwnPokemonPending`（甜點之禮／發酵果汁／激動治癒／分享歡樂 4 張共用）
 *   把 validIids 寫在 pending **頂層**，而 engine 的 sanitizeSelectedIids 讀的是
 *   `pending.params?.validIids` ⇒ 那條白名單從來沒被讀到。
 *   ⚠ 當時玩家端沒有差別，因為閘在「沒宣告」時會用 fieldPickerBaseIids 兜底算出
 *     「自己場上全部」，與那條白名單逐項相同 —— 所以**不能**用「送對手的 iid 會被擋」
 *     當判準（兜底也會擋，兩版都綠＝安慰劑）。
 *   正確判準：讓宣告的白名單**比兜底更窄**（只含戰鬥位），再送備戰的 iid：
 *     ・讀 params 的版本會濾掉（A2）
 *     ・只有兜底的版本會放行（A3 反證：把同一份白名單寫在頂層就真的放行了）
 *
 * 【B】AI 估值的 actorIdx 真的落到假想盤面上
 *   引擎的行動方一律讀 `state.activePlayerIndex`，action 物件沒有任何欄位可以指定。
 *   v6.396 之前 simulateAttack／evaluateAttack 收了 actorIdx 卻沒有寫進盤面 ⇒
 *   傳一個不等於 activePlayerIndex 的 actorIdx 時會**靜默模擬錯人**。
 *   判準：盤面 activePlayerIndex=0，呼叫 simulateAttack(state, 1, …)，
 *   對 player 0 的傷害必須 > 0（修正前恆為 0）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';   // v6.377 C-9：多行錨點一律先正規化行尾

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-396-s.js'), E = join(ROOT, '.x-396-e.ts'), O = join(ROOT, '.x-396-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, sanitizeSelectedIids } from './src/lib/game/engine';\n"
  + "export { healOneOwnPokemonPending } from './src/lib/game/effects/_shared';\n"
  + "export { simulateAttack, evaluateAttack } from './src/lib/game/ai-eval';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, sanitizeSelectedIids, healOneOwnPokemonPending, simulateAttack, evaluateAttack }
  = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const liveC = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveC.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 卡面查證自 static/cards（台灣官方中文卡面）：
//   13986 超級路卡利歐ex — 招式[?]「超級勇氣」cost【鬥】【鬥】270
//   14104 基本【鬥】能量／13163 噴火龍ex（HP330，當靶）
const CID = { lucario: '13986', fight: '14104', def: '13163' };
const LUCARIO = pool.get(CID.lucario);
const IDX_BRAVE = (LUCARIO?.attacks ?? []).findIndex((a) => a.name === '超級勇氣');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + ' :: ' + e.message); fail++; } };

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const base = () => createGame({ name: 'P1', entries: [{ cardId: CID.def, count: 1 }] },
                              { name: 'P2', entries: [{ cardId: CID.def, count: 1 }] }, pool);

/** 雙方戰鬥位都是滿能量的超級路卡利歐ex；activePlayerIndex 可指定。 */
function mkBoth(activeIdx) {
  const s = base();
  const mkSide = (i) => ({ ...s.players[i], hand: [], deck: [inst(CID.def)], discard: [],
    prizes: Array.from({ length: 6 }, () => inst(CID.def)),
    active: inst(CID.lucario, [en(CID.fight), en(CID.fight)]),
    bench: [inst(CID.def), inst(CID.def)], energyAttachedThisTurn: true });
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: activeIdx, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, players: [mkSide(0), mkSide(1)] };
}

console.log('【0】前提');
T('F0 ★ 哨兵：卡池載得到超級路卡利歐ex 且找得到「超級勇氣」（招式改名就要立刻發現）', () => {
  assert.ok(LUCARIO, '找不到 13986');
  assert.ok(IDX_BRAVE >= 0, '找不到「超級勇氣」');
  assert.strictEqual(LUCARIO.attacks[IDX_BRAVE].damage, '270');
});
T('F0b ★ 哨兵：四個受測的 export 都拿得到', () => {
  for (const [n, f] of [['sanitizeSelectedIids', sanitizeSelectedIids], ['healOneOwnPokemonPending', healOneOwnPokemonPending],
                        ['simulateAttack', simulateAttack], ['evaluateAttack', evaluateAttack]]) {
    assert.strictEqual(typeof f, 'function', n + ' 不是函式');
  }
});

console.log('\n【A】⭐⭐⭐ heal-target 的 validIids 真的接上中央消毒閘');
T('A1 ⭐⭐ healOneOwnPokemonPending 把白名單寫進 **params**（不是 pending 頂層）', () => {
  const st = mkBoth(0);
  const out = healOneOwnPokemonPending(st, 0, 30, 'v6396-probe', '測試');
  const sel = out.pendingSelection;
  assert.ok(sel, '沒有開出 pending');
  assert.strictEqual(sel.type, 'heal-target');
  assert.ok(Array.isArray(sel.params?.validIids), 'params.validIids 不是陣列 —— 白名單沒有接上閘');
  assert.strictEqual(sel.validIids, undefined, 'pending 頂層不可以再有 validIids（沒有人讀）');
  const own = [st.players[0].active.iid, ...st.players[0].bench.map((b) => b.iid)];
  assert.deepStrictEqual([...sel.params.validIids].sort(), [...own].sort(),
    '白名單應該是「自己場上全部」（卡面：自己的 1 隻寶可夢）');
});

/** 人造一個「比兜底更窄」的 heal-target pending：白名單只含戰鬥位。 */
function narrowPending(st, where) {
  const own = st.players[0].active.iid;
  const p = { type: 'heal-target', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1,
    effectKey: 'v6396-narrow', params: { healAmount: 30 } };
  if (where === 'params') p.params.validIids = [own];
  else p.validIids = [own];     // 舊寫法（頂層）
  return p;
}

T('A2 ⭐⭐⭐ 行為端：白名單寫在 params 時，**備戰的 iid 會被閘濾掉**（宣告比兜底更窄才驗得出來）', () => {
  const st = mkBoth(0);
  const benchIid = st.players[0].bench[0].iid;
  const out = sanitizeSelectedIids(st, narrowPending(st, 'params'), [benchIid], pool);
  assert.deepStrictEqual(out, [],
    '備戰 iid 不在 params.validIids 裡，中央閘必須濾掉 —— 實得 ' + JSON.stringify(out));
});
T('A2b ★ 正對照：白名單裡的戰鬥位 iid 必須放行（不是把所有東西都濾光）', () => {
  const st = mkBoth(0);
  const activeIid = st.players[0].active.iid;
  const out = sanitizeSelectedIids(st, narrowPending(st, 'params'), [activeIid], pool);
  assert.deepStrictEqual(out, [activeIid]);
});
T('A3 ⭐⭐⭐ 反證：同一份白名單寫在**頂層**時，備戰 iid 會被放行（證明舊寫法真的無效）', () => {
  const st = mkBoth(0);
  const benchIid = st.players[0].bench[0].iid;
  const out = sanitizeSelectedIids(st, narrowPending(st, 'top'), [benchIid], pool);
  assert.deepStrictEqual(out, [benchIid],
    '頂層 validIids 不會被閘讀到，這裡應該原封放行（走 fieldPickerBaseIids 兜底）'
    + ' —— 若這一條也被濾掉，代表 A2 的綠可能來自別的機制');
});
T('A4 ⭐ 型別層：PendingSelection **不得**有 validIids 欄位（有的話頂層寫法就不會被 tsc 抓到）', () => {
  // ⚠ 工作樹是 CRLF、git blob 是 LF ⇒ 多行錨點（這裡的 '\n}'）必須先 normEol，
  //   否則本機切不出區塊（test-v6377 C-9 在掃這件事）。
  const t = normEol(readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8'));
  const i = t.indexOf('export interface PendingSelection {');
  assert.ok(i > 0, '找不到 PendingSelection');
  const block = t.slice(i, t.indexOf('\n}', i));
  assert.ok(!/^\s*validIids\??:/m.test(block),
    'PendingSelection 又有 validIids 欄位了 —— 移除它，頂層寫法才會被 tsc 擋下來（test-v6394 A1 在守 tsc 零錯）');
  // ★ 正對照：偵測器對人造的欄位宣告必須命中
  assert.ok(/^\s*validIids\??:/m.test('  validIids?: string[];'), '偵測器失效');
});

console.log('\n【B】⭐⭐⭐ AI 估值的 actorIdx 真的落到假想盤面上');
T('B0 ★ 哨兵：盤面確實是 activePlayerIndex=0，而且兩邊戰鬥位都打得出「超級勇氣」', () => {
  const st = mkBoth(0);
  assert.strictEqual(st.activePlayerIndex, 0);
  const o = simulateAttack(st, 0, IDX_BRAVE, pool);
  assert.ok(o.ok, '出招方（0）應該打得出來');
  assert.ok(o.dealt > 0, '正對照：actorIdx 等於盤面行動方時必須真的打到人');
});
T('B1 ⭐⭐⭐ 行為端：盤面 activePlayerIndex=0，simulateAttack(state, **1**, …) 必須真的由 1 出手', () => {
  const st = mkBoth(0);
  const o = simulateAttack(st, 1, IDX_BRAVE, pool);
  assert.ok(o.ok, 'actorIdx=1 應該打得出來');
  assert.ok(o.dealt > 0,
    'actorIdx=1 時對 player 0 的傷害是 ' + o.dealt + ' —— actorIdx 沒有落到假想盤面上，'
    + '實際出手的還是盤面上的 activePlayerIndex（0），於是模擬了錯的人');
});
T('B2 ⭐⭐ evaluateAttack 同樣要由傳入的 actorIdx 出手', () => {
  const st = mkBoth(0);
  const ev = evaluateAttack(st, 1, IDX_BRAVE, pool);
  assert.ok(ev.ok, 'actorIdx=1 應該打得出來');
  assert.ok((ev.oppDamage ?? 0) > 0 || ev.ko === true,
    'evaluateAttack 用 actorIdx=1 時應該對 player 0 造成傷害／擊倒，實得 '
    + JSON.stringify({ ko: ev.ko, oppDamage: ev.oppDamage }));
});

console.log('\n【C】chain');
T('C1 本守衛已掛進 npm test chain', () => {
  assert.ok(readFileSync(join(ROOT, 'package.json'), 'utf8').includes('test-v6396-validiids-and-actoridx.mjs'));
});

console.log('\n=== v6.396 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);