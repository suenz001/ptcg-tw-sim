/** v5.879 火箭隊的妨礙機器人：選對手 1 張反面獎賞翻到正面(維持到對戰結束)、盲選對手 1 手牌、可互換。
 *  卡面「在對戰結束前，那張獎賞卡維持正面朝上」→ 沿用 v5.878 faceUp 機制。
 *  HEAD-FAIL:HEAD 只揭示 log 不 set faceUp。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rj-s.js'), E = join(ROOT, '.rj-e.ts'), O = join(ROOT, '.rj-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { TRAINER_EFFECTS } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const POKE = '14319', WATER_E = '18519', GRASS_E = '18518';
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk() {
  return {
    id:'t', phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, setupDone: [true, true], pendingPrizes:[0,0],
    players: [
      { name: 'ATK', active: inst(POKE), bench: [], hand: [], deck: [], discard: [], prizes: [inst(POKE)] },
      { name: 'OPP', active: inst(POKE), bench: [], hand: [inst(GRASS_E)], deck: [], discard: [], prizes: [inst(WATER_E), inst(POKE)] },
    ],
  };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const forceRandom0 = () => { const o = Math.random; Math.random = () => 0; return () => { Math.random = o; }; };

// 1) 出卡 → 選中對手獎賞[0]設 faceUp + 開 modal-choice
T('★出卡 → 對手獎賞[0] faceUp + 開互換 modal-choice', () => {
  const restore = forceRandom0();
  const out = mod.TRAINER_EFFECTS.get('火箭隊的妨礙機器人')(mk(), 0, pool);
  restore();
  assert.ok(out.pendingSelection, '應開 pending');
  assert.equal(out.pendingSelection.effectKey, 'tr-disrupt-bot-swap-decide');
  assert.ok(out.players[1].prizes[0].faceUp, '對手獎賞[0]設 faceUp（維持到對戰結束）');
});

// 2) 選「不互換」→ 獎賞維持 faceUp、手牌不變
T('★不互換 → 獎賞維持 faceUp', () => {
  const restore = forceRandom0();
  let out = mod.TRAINER_EFFECTS.get('火箭隊的妨礙機器人')(mk(), 0, pool);
  restore();
  out = mod.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: ['no'] }, pool);
  assert.ok(out.players[1].prizes[0].faceUp, '不互換：原獎賞維持 faceUp');
  assert.equal(pool.get(out.players[1].prizes[0].cardId)?.name, pool.get(WATER_E)?.name);
  assert.equal(out.players[1].hand.length, 1, '手牌不變');
});

// 3) 選「互換」→ 手牌換進獎賞格且 faceUp、原獎賞進手牌無 faceUp
T('★互換 → 換進獎賞格的手牌 faceUp、原獎賞進手牌剝 faceUp', () => {
  const restore = forceRandom0();
  let out = mod.TRAINER_EFFECTS.get('火箭隊的妨礙機器人')(mk(), 0, pool);
  restore();
  out = mod.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: ['yes'] }, pool);
  const p1 = out.players[1];
  assert.equal(pool.get(p1.prizes[0].cardId)?.name, pool.get(GRASS_E)?.name, '獎賞格換成原手牌(草)');
  assert.ok(p1.prizes[0].faceUp, '換進獎賞格的維持 faceUp');
  const movedToHand = p1.hand.find(c => pool.get(c.cardId)?.name === pool.get(WATER_E)?.name);
  assert.ok(movedToHand, '原獎賞(水)進手牌');
  assert.ok(!movedToHand.faceUp, '進手牌的剝除 faceUp');
});

console.log('\n火箭隊的妨礙機器人 獎賞翻面(v5.879):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
