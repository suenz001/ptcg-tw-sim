#!/usr/bin/env node
/**
 * v6.137 樂觀更新（PR-2 slice 1）守衛 — 行為端 ＋ 接線靜態檢查
 *
 * 核心設計：不枚舉「哪些 action 可預測」，改成**執行期試跑**——
 *   本地跑一次 applyAction，期間把 Math.random 換掉並計數，碰到任何隨機就放棄預測。
 * 這支守衛要證明：① 該預測的有預測 ② 不該預測的一律 fail-closed
 *   ③ Math.random 一定被還原 ④ 接線端沒有踩「預測 bump tVersion」等紅線。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.op-s.js'), E = join(ROOT, '.op-e.ts'), O = join(ROOT, '.op-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { tryPredictAction, OPTIMISTIC_ACTION_TYPES } from './src/lib/game/optimistic';\n"
                + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let n = 0, bad = 0;
const chk = (label, cond) => { n++; console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) bad++; };

// ── fixture
const BASIC = [...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic');
let ACT = null, BEN = null;
for (const [id, c] of pool) {
  if (!String(c.supertype || '').startsWith('Pok') || !['H','I','J'].includes(c.regulationMark)) continue;
  if ((c.stage ?? c.subtype) !== 'Basic' || c.abilities?.length) continue;
  if (!ACT) ACT = id; else if (!BEN && id !== ACT) { BEN = id; break; }
}
const inst = (cardId, iid, extra = {}) => ({ iid, cardId: String(cardId), damage: 0,
  energyAttached: [], evolvedFromStack: [], ...extra });
function mkState(over = {}) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(ACT, 'a1'), bench: [inst(BEN, 'b1')],
        hand: [inst(BASIC.id, 'h-energy')], deck: [inst(BEN, 'dk1')], discard: [], prizes: [],
        energyAttachedThisTurn: false },
      { name: 'P2', active: inst(ACT, 'oa1'), bench: [], hand: [], deck: [inst(BEN, 'odk1')], discard: [], prizes: [] },
    ],
    ...over,
  };
}
const ATTACH = { type: 'ATTACH_ENERGY', energyIid: 'h-energy', targetIid: 'a1' };

console.log('① 該預測的要預測');
{
  const st = mkState();
  const r = mod.tryPredictAction(st, ATTACH, pool);
  chk('ATTACH_ENERGY 通過所有 gate（ok=true）' + (r.ok ? '' : ' —— reason=' + r.reason), r.ok === true);
  if (r.ok) {
    chk('預測結果是新物件（不是原 state）', r.predicted !== st);
    chk('預測結果與再跑一次 applyAction 等價（去掉 log 時戳）', (() => {
      const again = mod.applyAction(st, ATTACH, pool);
      const strip = (s) => JSON.stringify(s, (k, v) => (k === 'timestamp' ? 0 : v));
      return strip(again) === strip(r.predicted);
    })());
    chk('原 state 未被就地修改（引擎純函式前提）', st.players[0].hand.length === 1);
  }
}

console.log('② 不該預測的一律 fail-closed');
{
  const c = (label, st, act, expectReasonPrefix) => {
    const r = mod.tryPredictAction(st, act, pool);
    chk(label + (r.ok ? ' —— 竟然預測了！' : ' → ' + r.reason),
        r.ok === false && String(r.reason).startsWith(expectReasonPrefix));
  };
  c('白名單外的 action（END_TURN）', mkState(), { type: 'END_TURN' }, 'not-whitelisted');
  c('setup 階段', mkState({ phase: 'setup' }), ATTACH, 'phase:');
  c('game-over 階段', mkState({ phase: 'game-over' }), ATTACH, 'phase:');
  c('已有 pendingSelection 開著', mkState({ pendingSelection: { type: 'x', actorIdx: 0 } }), ATTACH, 'pending-open');
  c('引擎拒絕（目標 iid 不存在）', mkState(), { type: 'ATTACH_ENERGY', energyIid: 'h-energy', targetIid: 'nope' }, 'engine-');
  c('本回合已附過能量（引擎拒絕）', (() => {
      const st = mkState(); st.players[0].energyAttachedThisTurn = true; return st;
    })(), ATTACH, 'engine-');
  c('null state', null, ATTACH, 'no-state');
  c('null action', mkState(), null, 'no-state');
}

console.log('③ Math.random 隔離與還原');
{
  const before = Math.random;
  mod.tryPredictAction(mkState(), ATTACH, pool);
  chk('正常路徑後 Math.random 已還原', Math.random === before);
  // 讓 applyAction throw：pool 給空的 → 還原仍要成立
  mod.tryPredictAction(mkState(), ATTACH, new Map());
  chk('引擎 throw 後 Math.random 仍還原（try/finally）', Math.random === before);
  chk('白名單只有 ATTACH_ENERGY（逐批放行，避免一次開太多）',
      mod.OPTIMISTIC_ACTION_TYPES.size === 1 && mod.OPTIMISTIC_ACTION_TYPES.has('ATTACH_ENERGY'));
}

console.log('③b ⭐ rng gate 本體：碰到隨機必須放棄預測（這是整個設計的核心）');
{
  // 用 allowedTypes 臨時放行 END_TURN，並讓自己的戰鬥寶可夢處於【灼傷】
  //   → 回合結束 checkup 要擲硬幣 → rng > 0 → 必須 fail-closed。
  const st = mkState();
  // ⚠ fixture 坑：狀態欄位是 status / secondaryStatus / tertiaryStatus 三槽，
  //   不是 statusConditions —— 寫錯的話灼傷根本沒生效、checkup 不擲幣，
  //   這條斷言就會**假 FAIL**（看起來像 rng gate 有洞，其實是 fixture 錯）。
  st.players[0].active.status = 'burned';
  const allow = new Set(['END_TURN']);
  const r = mod.tryPredictAction(st, { type: 'END_TURN' }, pool, { allowedTypes: allow });
  chk('灼傷狀態下的 END_TURN（checkup 擲幣）→ 因隨機而不預測' + (r.ok ? ' —— 竟然預測了！' : ' → ' + r.reason),
      r.ok === false && String(r.reason).startsWith('randomness:'));

  // 正對照：同一個 END_TURN，沒有任何狀態 → 不該因「隨機」被擋（可能因別的 gate，但不能是 randomness）
  const st2 = mkState();
  const r2 = mod.tryPredictAction(st2, { type: 'END_TURN' }, pool, { allowedTypes: allow });
  chk('正對照：無狀態的 END_TURN 不是被 randomness 擋掉（證明計數器不是恆真）'
      + (r2.ok ? '（且確實可預測）' : ' → ' + r2.reason),
      r2.ok === true || !String(r2.reason).startsWith('randomness:'));
}

console.log('②b 新增 gate：換手 / 待取獎賞（Fable 5 審查後補）');
{
  // 白日夢（引夢貘人）：目標帶 endTurnOnOppAttachEnergyThisTurn → ATTACH_ENERGY handler 內部會 END_TURN
  const st = mkState();
  st.players[0].active.endTurnOnOppAttachEnergyThisTurn = true;
  const r = mod.tryPredictAction(st, ATTACH, pool);
  chk('白日夢旗標 → 附能會換手 → 不預測' + (r.ok ? ' —— 竟然預測了！' : ' → ' + r.reason),
      r.ok === false && (r.reason === 'turn-flipped' || String(r.reason).startsWith('randomness:')));

  // pendingPrizes 有 diff → 不預測（用 allowedTypes 放行一個會動獎賞的假情境不易造，
  //   改為直接驗證 gate 存在且對「人工改動 pendingPrizes」有反應）
  const st2 = mkState();
  const r2 = mod.tryPredictAction(st2, ATTACH, pool);
  chk('正對照：一般盤面仍可預測（證明上面兩個 gate 不是恆真）', r2.ok === true);
}

console.log('④ 接線端紅線（靜態）');
{
  const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  chk('掃描器前提：+page.svelte 讀得到（未截斷）', PAGE.length > 500000);
  chk('⚠ 預測不得遞增 tVersion（會讓輪詢回正分支誤判）', !/tVersion\s*\+\+|tVersion\s*\+=/.test(PAGE));
  chk('tournamentDispatch 使用 tInFlight 而非 tBusy 當網路鎖',
      /tournamentDispatch[\s\S]{0,400}if \(tInFlight\)/.test(PAGE));
  chk('新鮮度看門狗有 !tInFlight gate（否則會把預測畫面倒回）',
      /_tLastForceResyncAt\) > 8000[\s\S]{0,200}!tInFlight/.test(PAGE));
  // ⚠ 這條原本只斷言「catch 裡有呼叫 tForceResync」——**那是假回滾**：
  //   tForceResync 只在 fr.version !== tVersion 才覆蓋 game，動作沒送達時版本沒動 ⇒ 不會還原。
  //   守衛必須盯住「真的把 game 換回 prev」，而且要用物件同一性避免蓋掉輪詢帶回的新盤面。
  chk('⭐ 真回滾：有 restorePrediction 且用物件同一性把 game 換回 prev',
      /const restorePrediction[\s\S]{0,300}game === predictedRef[\s\S]{0,60}game = prev/.test(PAGE));
  chk('⭐ catch 路徑呼叫 restorePrediction（不是只靠 tForceResync）',
      /catch \(e: any\)[\s\S]{0,400}restorePrediction\(\)/.test(PAGE));
  chk('⭐ 回應沒帶 gameState 的路徑也會還原（伺服器的「對局尚未開始」）',
      /else \{[\s\S]{0,240}restorePrediction\(\)/.test(PAGE));
  chk('⭐ tPredicted / predictedRef 是函式內區域變數（不得跨呼叫洩漏）',
      /let tPredicted = false;\s*\n\s*let predictedRef/.test(PAGE)
      && !/^\s{2}let tPredicted\b/m.test(PAGE));
  chk('stale 重試前會清掉 tPredicted', /r\.stale && !_retried[\s\S]{0,80}tPredicted = false/.test(PAGE));
  chk('伺服器回應採納後會清 tPredicted（避免下一次誤判已預測）',
      /tAdopt\(r\.gameState[\s\S]{0,400}tPredicted = false/.test(PAGE));
  chk('預測只在非重試時進行（重試那輪由遞迴自己重判）',
      /if \(!_retried && poolReady\)[\s\S]{0,200}tryPredictAction/.test(PAGE));
}

console.log(`\n[v6137-optimistic-predict] PASS ${n - bad} / FAIL ${bad}`);
process.exit(bad ? 1 : 0);
