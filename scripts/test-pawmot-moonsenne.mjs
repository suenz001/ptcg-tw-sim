// harness：啪咚猴|衝衝鼓 條件「自己 active 有祭典樂舞」應併查暗夜羽擊消除
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-pm-entry.ts'), OUT = join(ROOT, '.tmp-pm-bundle.mjs'), SHIM = join(ROOT, '.tmp-pm-shim.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });
writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY, `export { createGame, applyAction } from './src/lib/game/engine';\n`);
await build({ entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': SHIM }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(OUT).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const CID = { goldeen:'12339', pawmot:'10423', mononokunne:'16826', defender:'13163', anyCard:'12339' };
let iid = 0;
const inst = (cardId, extra = {}) => ({ iid: `p${++iid}`, cardId: String(cardId), damage: 0, energyAttached: [], ...extra });
function st(opp1Active) {
  const pawmot = inst(CID.pawmot);
  const s = createGame({ name:'P1', entries:[{cardId:CID.defender,count:1}] }, { name:'P2', entries:[{cardId:CID.defender,count:1}] }, pool);
  return { state: { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:1, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:0,
    players: [
      { ...s.players[0], name:'P1', hand:[], deck:[inst(CID.defender)], discard:[], prizes:[], bench:[pawmot], active: inst(CID.goldeen) },
      { ...s.players[1], name:'P2', hand:[], deck:[], discard:[], prizes:[], bench:[], active: opp1Active },
    ] }, pawmot };
}
let passed=0, failed=0;
const test=(n,fn)=>{try{fn();console.log(`  ✅ ${n}`);passed++;}catch(e){console.log(`  ❌ ${n}: ${e.message}`);failed++;}};

test('對手有振翼髮(暗夜羽擊) → 衝衝鼓不可用(active 祭典樂舞被消除)', () => {
  const { state, pawmot } = st(inst(CID.mononokunne));
  const next = applyAction(state, { type:'USE_ABILITY', iid: pawmot.iid, abilityIndex: 0 }, pool);
  assert.ok(!next.pendingSelection, '不應開 deck-search（祭典樂舞被暗夜羽擊消除，衝衝鼓條件失敗）');
});
test('對照：對手無振翼髮 → 衝衝鼓正常可用', () => {
  const { state, pawmot } = st(inst(CID.defender));
  const next = applyAction(state, { type:'USE_ABILITY', iid: pawmot.iid, abilityIndex: 0 }, pool);
  assert.ok(next.pendingSelection, '應開 deck-search（active 祭典樂舞有效）');
});
console.log(`\nPawmot moonsenne: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
