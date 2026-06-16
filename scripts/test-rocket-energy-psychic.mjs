// v5.616：火箭隊能量「視為提供 2 個【超】【惡】2 種屬性的能量」→ 數【超】能量數的傷害計算(超級交響樂)應計 2，非 1。
//   收斂：超級交響樂改用 countEnergyTypeHostAware(型別計數中央 helper，火箭隊能量=2超)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.rk-e.ts'), O = join(ROOT, '.rk-o.mjs'), S = join(ROOT, '.rk-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
let PSY = null;
for (const [id, c] of pool) { if (c.supertype === 'Energy' && c.subtype === 'Basic' && (c.pokemonType === 'Psychic' || /【超】/.test(c.name))) { PSY = id; break; } }
const GARDE = '14062', CROBAT = '14761', ROCKETE = '14853', KANGA = '14071';
let i = 0;
const inst = (cid, e = []) => ({ iid: 'i' + (++i), cardId: String(cid), damage: 0, energyAttached: e });
const en = (cid) => ({ iid: 'e' + (++i), cardId: String(cid), damage: 0, energyAttached: [] });
let pass = 0, fail = 0;
const ck = (l, c, e) => { if (c) { pass++; console.log('  PASS', l); } else { fail++; console.log('  FAIL', l, e || ''); } };
function symphonyDamage(ownBench) {
  let s = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false, pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null, setupDone: [true, true],
    players: [
      { active: inst(GARDE, [en(PSY)]), bench: ownBench, hand: [], deck: Array.from({ length: 10 }, () => en(PSY)), discard: [], prizes: Array.from({ length: 6 }, () => en(PSY)), name: '攻' },
      { active: inst(KANGA), bench: [], hand: [], deck: Array.from({ length: 10 }, () => en(PSY)), discard: [], prizes: Array.from({ length: 6 }, () => en(PSY)), name: '守' },
    ] };
  s = applyAction(s, { type: 'ATTACK', attackIndex: 1 }, pool);  // 超級交響樂 = index 1
  let g = 0; while (s.pendingSelection && g++ < 4) { const ps = s.pendingSelection; s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool); if (s.pendingSelection === ps) break; }
  const def = s.players[1].active; return def ? def.damage : 9999;
}
console.log('火箭隊能量 rulesText 含「2個」:', /2個/.test(pool.get(ROCKETE).rulesText || ''));
console.log('1) ★超級交響樂：active 1 基本超 + 備戰火箭隊的叉字蝠ex 帶 1 張火箭隊能量(=2超) → 3×50=150');
ck('傷害 150（火箭隊能量計 2 超，舊碼=100）', symphonyDamage([inst(CROBAT, [en(ROCKETE)])]) === 150, '實際=' + symphonyDamage([inst(CROBAT, [en(ROCKETE)])]));
console.log('2) 對照：active 1 基本超 + 備戰火箭隊的叉字蝠ex 無能量 → 1×50=50');
ck('傷害 50', symphonyDamage([inst(CROBAT)]) === 50, '實際=' + symphonyDamage([inst(CROBAT)]));
console.log('\n火箭隊能量×超級交響樂 PASS ' + pass + ' / FAIL ' + fail);
process.exitCode = fail ? 1 : 0;
