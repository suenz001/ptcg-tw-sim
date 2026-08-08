#!/usr/bin/env node
/**
 * v6.136 行為端守衛：沉重接力棒「【撤退】所需的能量為4個」條件
 *
 * 直接跑引擎的 fireDefenderOnKO，驗證三種盤面：
 *   A. 撤退費 2（拉普拉斯ex）＋沉重接力棒 → **不觸發**（舊實作會誤觸發＝玩家回報的 bug）
 *   B. 撤退費 4（大岩蛇）＋沉重接力棒     → **觸發**（開 discard-search pending）
 *   C. 撤退費 1（喵喵）＋3 張重力之玉(+3)＋沉重接力棒 → **觸發**
 *      ← 官方裁定：判定基準是「昏厥當下的有效撤退費」，不是卡面印刷值
 *   D. 撤退費 4 但備戰為空 → 不觸發（既有行為，回歸保護）
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.hb-s.js'), E = join(ROOT, '.hb-e.ts'), O = join(ROOT, '.hb-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { fireDefenderOnKO } from './src/lib/game/effects';\n"
                + "export { computeRetreatCostForKOedActive } from './src/lib/game/engine';\n"
                + "import './src/lib/game/effects';");
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
const BATON = [...pool.values()].find(c => c.name === '沉重接力棒');
const GRAV  = [...pool.values()].find(c => c.name === '重力之玉');
const BASIC = [...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic');
if (!BATON || !GRAV || !BASIC) { console.log('FAIL 前提卡找不到'); process.exit(1); }

let n = 0;
const inst = (cardId, iid, extra = {}) => ({
  cardId: String(cardId), iid, damage: 0, energyAttached: [], tools: [],
  statusConditions: [], ...extra,
});
function mk(holderId, gravCount = 0, benchCount = 1) {
  // ⚠ fixture 坑：道具欄位是 toolAttached（主）＋ extraTools（溢出），不是 tools —— 
  //   寫錯的話 getAllAttachedTools 讀不到，沉重接力棒根本不會被觸發，
  //   於是「不觸發」的斷言會**假 PASS**。這裡逐欄對齊 types.ts。
  const extraTools = [];
  for (let i = 0; i < gravCount; i++) extraTools.push(inst(GRAV.id, 'tool-grav' + i));
  const active = inst(holderId, 'ko-holder', {
    toolAttached: inst(BATON.id, 'tool-baton'),
    extraTools,
    energyAttached: [inst(BASIC.id, 'e1'), inst(BASIC.id, 'e2')],
  });
  const bench = [];
  for (let i = 0; i < benchCount; i++) bench.push(inst('17977', 'bench' + i));
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 1, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: null,
    players: [
      { name: 'P1', active, bench, hand: [], deck: [], discard: [], prizes: [] },
      { name: 'P2', active: inst('17976', 'opp-act'), bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ],
  };
}
// 模擬中央 KO 結算：active 先被清空，再呼叫 fireDefenderOnKO
function fire(st) {
  const koInst = st.players[0].active;
  const players = [...st.players];
  players[0] = { ...players[0], active: null, discard: [...players[0].discard] };
  return mod.fireDefenderOnKO({ ...st, players }, 0, 1, pool, koInst, true, true);
}


const chk = (label, cond) => { n++; console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) process.exitCode = 1; };
// 先驗中央 helper 本身（active 已 null 也要算得出來）
// ⚠ 包 try：HEAD-FAIL 時 helper 尚不存在，要記成 FAIL 而不是整支 crash
//   （crash 會讓後面「舊實作誤觸發」那幾條根本跑不到，HEAD-FAIL 證明力就不完整）
const safe = (label, fn) => { try { fn(); } catch (e) { chk(label + ' —— 例外：' + (e?.message ?? e), false); } };
safe('中央 helper 存在且可呼叫', () => {
  const st = mk('13979');                       // 大岩蛇 撤退 4
  const koInst = st.players[0].active;
  const players = [...st.players]; players[0] = { ...players[0], active: null };
  const cost = mod.computeRetreatCostForKOedActive({ ...st, players }, 0, koInst, pool);
  chk(`中央 helper：active 已 null 時仍算得出撤退費（大岩蛇 = 4，實得 ${cost}）`, cost === 4);
});
safe('中央 helper 重力之玉案例', () => {
  const st = mk('17977', 3);                    // 喵喵 撤退 1 + 重力之玉 ×3
  const koInst = st.players[0].active;
  const players = [...st.players]; players[0] = { ...players[0], active: null };
  const cost = mod.computeRetreatCostForKOedActive({ ...st, players }, 0, koInst, pool);
  chk(`中央 helper：喵喵(1) + 重力之玉×3 = 4（實得 ${cost}）— 官方裁定基準`, cost === 4);
});

// A. 撤退 2 → 不得觸發
{
  const r = fire(mk('14085'));
  chk('A 撤退費 2（拉普拉斯ex）→ 不開 pending（舊實作會誤觸發）', !r.pendingSelection);
}
// B. 撤退 4 → 必須觸發
{
  const r = fire(mk('13979'));
  chk('B 撤退費 4（大岩蛇）→ 開 discard-search pending',
      !!r.pendingSelection && r.pendingSelection.effectKey === 'heavy-baton-pick-energies');
}
// C. 撤退 1 + 重力之玉 ×3 = 4 → 必須觸發（官方裁定）
{
  const r = fire(mk('17977', 3));
  chk('C 撤退費 1 + 重力之玉×3 → 開 pending（有效撤退費，非印刷值）',
      !!r.pendingSelection && r.pendingSelection.effectKey === 'heavy-baton-pick-energies');
}
// C2. 撤退 1 + 重力之玉 ×2 = 3 → 不得觸發（邊界）
{
  const r = fire(mk('17977', 2));
  chk('C2 撤退費 1 + 重力之玉×2 = 3 → 不觸發（邊界：必須剛好 4）', !r.pendingSelection);
}
// D. 撤退 4 但備戰為空 → 不觸發（既有行為回歸）
{
  const r = fire(mk('13979', 0, 0));
  chk('D 撤退費 4 但備戰為空 → 不觸發（既有行為）', !r.pendingSelection);
}
console.log(`\n[v6136-heavy-baton-behavior] ${n} 項，exitCode=${process.exitCode ?? 0}`);
