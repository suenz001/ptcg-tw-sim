import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const OUT = 'E:/ptcg-tw-sim/.tmp-test.mjs';
const ENTRY = 'E:/ptcg-tw-sim/.tmp-test-entry.ts';
writeFileSync(ENTRY, `
  export { createGame, applyAction, isBasicPokemonCard } from './src/lib/game/engine';
  export { GameActions } from './src/lib/game/actions';
`);
await build({
  entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm',
  platform: 'node', target: 'node20',
  alias: { '$lib': 'E:/ptcg-tw-sim/src/lib', '$app/paths': 'E:/ptcg-tw-sim/scripts/shim-app-paths.mjs' },
  logLevel: 'warning',
});
unlinkSync(ENTRY);
const mod = await import(pathToFileURL(OUT).href);
const { createGame, applyAction, GameActions, isBasicPokemonCard } = mod;
const pool = new Map();
const dir = 'E:/ptcg-tw-sim/static/cards';
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) pool.set(String(c.id), c);
}
const mbg = { name: 'MBG', entries: [
  ['14129',4],['14130',2],['14151',1],['14131',2],['14132',2],['14133',1],
  ['14134',2],['14135',1],['14136',1],['14137',1],['14138',1],
  ['14139',3],['14140',4],['14141',3],['14142',1],['14143',1],['14144',1],
  ['14145',1],['14146',2],['14147',2],['14148',4],['14149',2],['14150',4],
  ['14152',14],
].map(([cardId, count]) => ({ cardId, count })) };

let successes = 0, fails = 0, noBasic = 0;
for (let trial = 0; trial < 100; trial++) {
  let s = createGame(mbg, mbg, pool);
  for (const pIdx of [0, 1]) {
    const p = s.players[pIdx];
    const basics = p.hand.filter(c => isBasicPokemonCard(pool.get(c.cardId)));
    if (basics.length === 0) break;
    s = applyAction(s, GameActions.placeActive(basics[0].iid, pIdx), pool);
    // 刻意只放 1 隻 bench，留更多 basic 手牌
    if (basics.length > 1) s = applyAction(s, GameActions.benchPokemon(basics[1].iid, pIdx), pool);
    s = applyAction(s, GameActions.finishSetup(pIdx), pool);
  }
  if (s.phase !== 'playing') continue;
  const me = s.players[s.activePlayerIndex];
  const basicInHand = me.hand.find(c => isBasicPokemonCard(pool.get(c.cardId)));
  if (!basicInHand) { noBasic++; continue; }
  const before = s;
  s = applyAction(s, GameActions.playBasic(basicInHand.iid), pool);
  if (s === before) {
    console.log(`❌ Trial ${trial}: 拒絕 name=${pool.get(basicInHand.cardId)?.name}`);
    console.log(`   turnPhase=${before.turnPhase} bench=${me.bench.length} active=${me.active?.cardId} firstTurn=${before.isFirstTurn}`);
    fails++;
    if (fails >= 3) break;
  } else successes++;
}
console.log(`\n✅ 成功 ${successes} · ❌ 拒絕 ${fails} · 手牌無基礎 ${noBasic}`);
try { unlinkSync(OUT); } catch {}
