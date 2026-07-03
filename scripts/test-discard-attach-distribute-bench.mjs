// 守衛：從棄牌區「以任意方式附於備戰」的招式，須走 startEnergyChain(v158-energy-chain-start)
// 逐張分散選目標，而非 h-wave2-pickup(選1隻塞全部)。「附於1隻備戰」型(能量支援)維持單目標。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dad-s.js'), E = join(ROOT, '.dad-e.ts'), O = join(ROOT, '.dad-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let fightId = null, anyBasicId = null;
for (const [id, c] of pool) {
  if (c.supertype === 'Energy' && c.subtype === 'Basic') {
    if (anyBasicId == null) anyBasicId = id;
    if (c.name && c.name.includes('鬥') && fightId == null) fightId = id;
  }
}
assert(fightId && anyBasicId, '找不到基本能量卡');
const VAN = '14443';
let uid = 0;
const inst = (cid) => ({ iid: `i${++uid}`, cardId: String(cid), damage: 0, energyAttached: [], extraTools: [], toolAttached: null, evolvedFromStack: [] });
function state(attackerCid, discardEnergyIds) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(attackerCid), bench: [inst(VAN), inst(VAN)], hand: [], deck: [inst(VAN)],
        discard: discardEnergyIds.map(inst), prizes: [inst(VAN)] },
      { name: 'P2', active: inst(VAN), bench: [], hand: [], deck: [inst(VAN)], discard: [], prizes: [inst(VAN)] },
    ],
  };
}
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('渦輪刀鋒「以任意方式」→ 走 v158-energy-chain-start(分散)', () => {
  const post = mod.ATTACK_POST.get('鬃岩狼人|渦輪刀鋒');
  const r = post(state('10058', [fightId, fightId]), 0, pool);
  assert.equal(r.pendingSelection?.effectKey, 'v158-energy-chain-start',
    'HEAD 塞1隻(h-wave2)→應改走 v158 分散管線');
  assert.equal(r.pendingSelection?.params?.scope, 'bench-only', 'scope 應 bench-only');
  assert.equal(r.pendingSelection?.params?.source, 'discard', 'source 應 discard(不重洗/不觸發手牌反應)');
});
T('能量寫生「以任意方式」(擲幣後) → 走 v158-energy-chain-start', () => {
  const post = mod.ATTACK_POST.get('圖圖犬|能量寫生');
  const orig = Math.random; Math.random = () => 0.1;
  let r;
  try { r = post(state('14386', [anyBasicId, anyBasicId, anyBasicId]), 0, pool); }
  finally { Math.random = orig; }
  assert.equal(r.pendingSelection?.effectKey, 'v158-energy-chain-start', 'HEAD 塞1隻→應改走 v158 分散');
});
T('能量支援「附於1隻備戰」→ 維持單目標(h-wave2-pickup)', () => {
  const post = mod.ATTACK_POST.get('花舞鳥|能量支援');
  const r = post(state('11098', [anyBasicId, anyBasicId]), 0, pool);
  assert.equal(r.pendingSelection?.effectKey, 'h-wave2-pickup-energy-to-bench-stage1',
    '能量支援卡面「1隻」不應改成分散');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
