// v6.148 守衛：①輪詢節奏中央化（活躍期加密／防自我壅塞）②預測前的 pool 完整性 gate。
//
// ① 為什麼加密：對手動作到我看到，最壞是一整個輪詢間隔（1.2s）+ RTT；
//    pendingSelection 的一來一往會疊成 2~3 秒。改成「盤面 15 秒內有變動＝雙方正在你來我往
//    → 600ms」，長考/掛機自動退回 1.2 秒，所以不會變成常態負載。
// ② 為什麼防壅塞：setInterval **不等前一發完成**，RTT 飆高時會一直疊送、在隧道排隊，
//    延遲雪上加霜。v6.135 只修了亂序的**正確性**（reqV 守衛），沒防壅塞本身。
// ③ pool gate（Fable 5 實測）：引擎讀對手特性用 `pool.get(cardId)`，卡包沒載入會拿到
//    undefined 而**靜默當成沒有那個特性** ⇒ 本該擋下預測的情境（對手黏美龍｜黏滑失足 撤退要擲幣）
//    會被誤放行 → 畫面閃爍。依 fail-closed 原則，盤面有卡不在 pool 就不預測。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6148-s.js'), E = join(ROOT, '.v6148-e.ts'), O = join(ROOT, '.v6148-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { tryPredictAction } from './src/lib/game/optimistic';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { tryPredictAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) all.push(c);
}
const fullPool = new Map(all.map((c) => [String(c.id), c]));
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const inst = (id, iid, x = {}) => ({ iid, cardId: String(id), damage: 0, energyAttached: [], toolAttached: null,
  extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, evolvedFromStack: [], ...x });
const basic = all.find((c) => c.stage === 'Basic' && HIJ(c) && !(c.abilities || []).length && (c.attacks || []).length > 0);
const grass = all.find((c) => c.name === '基本【草】能量');
const goodra = all.find((c) => c.name === '黏美龍' && (c.abilities ?? []).some((a) => a.name === '黏滑失足'));
const mkState = () => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
  log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null, pendingPrizes: [],
  players: [
    { name: 'A', active: inst(basic.id, 'A1', { energyAttached: [inst(grass.id, 'E1')] }),
      bench: [inst(basic.id, 'B1')], hand: [], deck: [inst(grass.id, 'D1')], discard: [], prizes: [] },
    { name: 'B', active: inst(basic.id, 'X1'), bench: [inst(goodra.id, 'G1')], hand: [], deck: [], discard: [], prizes: [] },
  ],
});

T('前提：對手【黏美龍】｜黏滑失足在場時，full pool 下撤退必須因擲幣而不預測（正對照）', () => {
  assert.ok(goodra, '找不到帶「黏滑失足」的黏美龍 —— 錨點過期');
  const r = tryPredictAction(mkState(), { type: 'RETREAT', newActiveIid: 'B1' }, fullPool);
  assert.equal(r.ok, false);
  assert.ok(/randomness/.test(r.reason), `理由不對：${r.reason}`);
});
T('⭐⭐pool 缺對手卡時**不得**預測（否則引擎讀不到對手特性會靜默當成沒有 → 誤放行）', () => {
  const partial = new Map(fullPool);
  partial.delete(String(goodra.id));
  const r = tryPredictAction(mkState(), { type: 'RETREAT', newActiveIid: 'B1' }, partial);
  assert.equal(r.ok, false, '對手卡包沒載入還照樣預測 —— 這正是 v6.148 修的缺口');
  assert.ok(/pool-incomplete/.test(r.reason), `應該被 pool gate 擋下，實際：${r.reason}`);
});
T('⭐pool 完整時不得被這道新 gate 誤擋（否則預測會全面失效＝白做）', () => {
  const st = mkState();
  st.players[1].bench = [];   // 拿掉黏美龍，撤退變成確定性
  const r = tryPredictAction(st, { type: 'RETREAT', newActiveIid: 'B1' }, fullPool);
  assert.equal(r.ok, true, `pool 完整卻被擋：${r.reason}`);
});
T('⭐對手**手牌/牌庫**的卡不在 pool 不該擋（那是隱藏區，client 本來就拿不到完整資料）', () => {
  const st = mkState();
  st.players[1].bench = [];
  st.players[1].hand = [inst('__不存在的卡__', 'OH1')];
  st.players[1].deck = [inst('__不存在的卡2__', 'OD1')];
  const r = tryPredictAction(st, { type: 'RETREAT', newActiveIid: 'B1' }, fullPool);
  assert.equal(r.ok, true, `隱藏區的未知卡不該擋下預測：${r.reason}`);
});

// ── 靜態：輪詢節奏 ─────────────────────────────────────────────────────────
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const RAW = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const P = stripComments(RAW);
T('掃描器自我驗證：註解確實被剝掉', () => {
  assert.equal(RAW.length, P.length);
  assert.ok(RAW.includes('把「對手動作到我看到」的'), '前提：被測檔應含本版註解');
  assert.ok(!P.includes('把「對手動作到我看到」的'), '註解沒被剝掉 → 斷言不可信');
});
T('⭐⭐活躍期間加密：盤面最近有變動就縮短輪詢間隔（長考/掛機要自動退回，不能變常態負載）', () => {
  const i = P.indexOf('function tPollDesiredMs(');
  assert.ok(i > 0, '找不到中央節奏述詞');
  const fn = P.slice(i, P.indexOf('function startTournamentPoll()', i));
  assert.ok(/_tLastStateChangeAt[^\n]*15000/.test(fn), '沒有「最近有變動」的時間窗判定');
  assert.ok(/return 800;/.test(fn), '活躍期間的加密值不見了（⚠ base tick 400ms，寫 600 會被量化成 800）');
  assert.ok(/return 1200;/.test(fn), '閒置時必須退回 1.2 秒（否則變成常態高頻負載）');
  assert.ok(/phase === 'playing'/.test(fn), '快檔沒有限定 playing（setup 有自己的 3.5 秒看門狗，同時開局會變尖峰）');
  assert.ok(/_waitingOpp/.test(fn), '快檔沒有限定「等對手」—— 自己回合走 dispatch 本來就即時，快 poll 是白費');
});
T('⭐⭐⭐anchor 只能在盤面**真的**變動時更新（否則看門狗每 8 秒推一次，快檔變常態）', () => {
  const i = P.indexOf('async function tForceResync()');
  assert.ok(i > 0, '找不到 tForceResync');
  const body = P.slice(i, P.indexOf('\n  function ', i + 10));
  const iIf = body.indexOf('fr.version !== tVersion');
  const iAnchor = body.indexOf('_tLastStateChangeAt = Date.now();');
  assert.ok(iIf >= 0 && iAnchor > iIf, 'anchor 更新必須在「版本不同」的分支內');
  const branch = body.slice(iIf, iAnchor);
  assert.ok(!/^\s*\}/m.test(branch.split('\n').slice(1).join('\n')) || branch.includes('tStep'),
    'anchor 看起來又跑到 if 外面了');
});
T('⭐base tick 必須比最短間隔小（否則節奏 gate 形同虛設）', () => {
  const bodies = ['function startTournamentPoll()', 'function startSpectatePoll()'].map((a) => {
    const i = P.indexOf(a); return P.slice(i, P.indexOf('}, 400);', i) + 8);
  });
  for (const b of bodies) assert.ok(/\}, 400\);$/.test(b.trim()), 'base tick 不是 400ms');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
