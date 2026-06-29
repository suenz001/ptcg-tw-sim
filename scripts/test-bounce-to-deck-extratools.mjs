/**
 * bounce 寶可夢到牌庫 — 連同「全部道具(toolAttached + extraTools)」一起進牌庫（v5.781）
 * 對手 bounce 路徑(h-wave2-bounce-opp-bench：奧密迴旋/慢芬香)原手刻只取 toolAttached 漏 extraTools。
 * 收斂中央 bareCardsForReturn(走 getAllAttachedTools)。驗 HEAD FAIL：未修版 extraTools 不進牌庫。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.bd-s.js'), E = join(ROOT, '.bd-e.ts'), O = join(ROOT, '.bd-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { bareCardsForReturn } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, bareCardsForReturn } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const POKE = '14086', TOOL_A = '14089', TOOL_B = '14467', ENERGY = '14102';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(ENERGY));
function mkState() {
  const eC = { iid: 'eC', cardId: ENERGY, damage: 0, energyAttached: [] };
  const target = inst(POKE, { toolAttached: { iid: 'tA', cardId: TOOL_A }, extraTools: [{ iid: 'tB', cardId: TOOL_B }], energyAttached: [eC] });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(POKE), bench: [], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
      { name: 'P2', active: inst(POKE), bench: [target], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
    ],
    pendingSelection: { type: 'opp-bench-choose', actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: 1, effectKey: 'h-wave2-bounce-opp-bench' },
  };
}
const RESOLVE = (iids) => ({ type: 'RESOLVE_SELECTION', selectedIids: iids });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
T('bareCardsForReturn 含主體+能量+全部道具', () => {
  const eC = { iid: 'eC', cardId: ENERGY, damage: 0, energyAttached: [] };
  const target = inst(POKE, { toolAttached: { iid: 'tA', cardId: TOOL_A }, extraTools: [{ iid: 'tB', cardId: TOOL_B }], energyAttached: [eC] });
  const ids = bareCardsForReturn(target).map(c => c.iid);
  assert.ok(ids.includes(target.iid) && ids.includes('eC') && ids.includes('tA') && ids.includes('tB'), 'extraTools 也要在');
});
T('★奧密迴旋/慢芬香 bounce：extraTools 一起進對手牌庫', () => {
  const st = mkState();
  const targetIid = st.players[1].bench[0].iid;
  const out = applyAction(st, RESOLVE([targetIid]), pool);
  const deckIids = new Set(out.players[1].deck.map(c => c.iid));
  assert.ok(!out.players[1].bench.some(b => b.iid === targetIid), '寶可夢應已離開備戰');
  assert.ok(deckIids.has('tA'), '主道具應進牌庫');
  assert.ok(deckIids.has('tB'), 'extraTools 額外道具應進牌庫（HEAD 漏此項）');
  assert.ok(deckIids.has('eC') && deckIids.has(targetIid), '能量+主體應進牌庫');
  for (const c of out.players[1].deck) assert.ok(!c.toolAttached && !(c.extraTools && c.extraTools.length), '牌庫卡應全裸化');
});
console.log('\nbounce 到牌庫含 extraTools(v5.781):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
