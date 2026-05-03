#!/usr/bin/env node
/** Regression: preset AI should not produce no-op actions in 太陽伊布 vs 青銅鐘多龍.
 * Covers duplicate-iid bugs from EVOLVE + devolution return-to-deck flow.
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-test-evolve-iid-bundle.mjs');
const ENTRY = join(REPO_ROOT, '.tmp-test-evolve-iid-entry.ts');
function safeUnlink(p){ try{ unlinkSync(p); }catch{} }
process.on('exit',()=>{ safeUnlink(OUT); safeUnlink(ENTRY); });
writeFileSync(ENTRY, `
export { createGame, applyAction } from './src/lib/game/engine';
export { getAIAction } from './src/lib/game/ai';
export { PRESET_DECKS } from './src/lib/decks/presets';
`);
await build({entryPoints:[ENTRY], outfile:OUT, bundle:true, format:'esm', platform:'node', target:'node20', alias:{'$lib':join(REPO_ROOT,'src/lib'), '$app/paths':join(REPO_ROOT,'scripts/shim-app-paths.mjs')}, logLevel:'silent'});
const {createGame, applyAction, getAIAction, PRESET_DECKS} = await import(new URL(OUT,'file://').href);
const pool = new Map();
for (const f of readdirSync(join(REPO_ROOT,'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(REPO_ROOT,'static/cards',f),'utf8'))) pool.set(String(c.id), c);
}
const A = PRESET_DECKS.find(d => d.name === '太陽伊布');
const B = PRESET_DECKS.find(d => d.name === '青銅鐘多龍');
if (!A || !B) throw new Error('preset deck missing');
function rng(seed){ let s=seed>>>0; return ()=>{ s=(1664525*s+1013904223)>>>0; return s/2**32; }; }
function chooseActor(state){
  if (state.phase === 'setup') { for (const i of [0,1]) if (!state.setupDone[i] || (state.pendingMulliganDraw?.[i] ?? 0)>0) return i; }
  if (state.pendingPrizes > 0) return state.activePlayerIndex;
  if (state.pendingSelection) return state.pendingSelection.actorIdx;
  if (state.players[0].active === null && state.players[0].bench.length > 0) return 0;
  if (state.players[1].active === null && state.players[1].bench.length > 0) return 1;
  return state.activePlayerIndex;
}
for (let seed=1; seed<=1000; seed++) {
  Math.random = rng(seed);
  let state = createGame({name:A.name, entries:A.entries}, {name:B.name, entries:B.entries}, pool);
  for (let n=0; n<5000; n++) {
    const actor = chooseActor(state);
    const action = getAIAction(state, pool, actor);
    if (!action) break;
    const before = JSON.stringify(state);
    state = applyAction(state, action, pool);
    if (JSON.stringify(state) === before) {
      throw new Error(`no-op action seed=${seed} step=${n}: ${JSON.stringify(action)}`);
    }
    if (state.phase === 'game-over') break;
  }
}
console.log('✅ evolve iid regression passed (1000 deterministic seeds)');
