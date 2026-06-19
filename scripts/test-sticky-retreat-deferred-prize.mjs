// v5.638 兩修：①黏美龍|黏滑失足 撤退反面失敗仍消耗「本回合撤退」(修無限重擲 exploit)
//                ②多餘花粉 deferredPrizeBonusThisTurn 收斂進 koPrizesAdjusted → 效果/特性KO(咒詛炸彈)也+N
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-paths.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-srdp.ts'); const O = join(ROOT, '.ent-srdp.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nexport { koPrizesAdjusted } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, koPrizesAdjusted } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const GOODRA = '18505';   // 黏美龍（特性 黏滑失足）
const VANILLA = '14443';  // 含羞苞（HP30 基礎、撤退費 0、無特性、1 獎賞）
let iid = 0; const inst = (cid, e = {}) => ({ iid: `a${++iid}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(VANILLA));
let pass = 0, fail = 0; const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

function mk() {
  const s = createGame({ name: 'P1', entries: [{ cardId: VANILLA, count: 1 }] }, { name: 'P2', entries: [{ cardId: VANILLA, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { ...s.players[0], hand: [], deck: [inst(VANILLA)], discard: [], prizes: prize(6), retreatedThisTurn: false, active: inst(VANILLA), bench: [inst(VANILLA)] },
      { ...s.players[1], hand: [], deck: [inst(VANILLA)], discard: [], prizes: prize(6), active: inst(GOODRA), bench: [] },
    ] };
}
const _rand = Math.random;
function withCoin(isHeads, fn) { Math.random = () => (isHeads ? 0.0 : 0.99); try { return fn(); } finally { Math.random = _rand; } }

T('反面：撤退失敗（active 不變）', () => {
  const s = mk(); const a0 = s.players[0].active.iid; const benchIid = s.players[0].bench[0].iid;
  const out = withCoin(false, () => applyAction(s, { type: 'RETREAT', newActiveIid: benchIid }, pool));
  assert.equal(out.players[0].active.iid, a0, '反面撤退應失敗、active 不變');
});
T('反面：仍消耗本回合撤退（retreatedThisTurn=true）〔核心 exploit 修正〕', () => {
  const s = mk(); const benchIid = s.players[0].bench[0].iid;
  const out = withCoin(false, () => applyAction(s, { type: 'RETREAT', newActiveIid: benchIid }, pool));
  assert.equal(out.players[0].retreatedThisTurn, true, '反面後應已設 retreatedThisTurn（不可再按撤退重擲）');
});
T('反面後再按撤退：被擋（active 仍不變，即使第二次擲正面）', () => {
  const s = mk(); const a0 = s.players[0].active.iid; const benchIid = s.players[0].bench[0].iid;
  const out1 = withCoin(false, () => applyAction(s, { type: 'RETREAT', newActiveIid: benchIid }, pool));
  const out2 = withCoin(true, () => applyAction(out1, { type: 'RETREAT', newActiveIid: benchIid }, pool));
  assert.equal(out2.players[0].active.iid, a0, '第二次撤退應被擋（active 仍是原本的）');
});
T('正面：撤退成功（active 換成備戰）', () => {
  const s = mk(); const benchIid = s.players[0].bench[0].iid;
  const out = withCoin(true, () => applyAction(s, { type: 'RETREAT', newActiveIid: benchIid }, pool));
  assert.equal(out.players[0].active.iid, benchIid, '正面撤退應成功換上備戰');
});
T('koPrizesAdjusted：deferredPrizeBonusThisTurn=2 → 效果KO(koByAttackDamage=false) 仍 +2', () => {
  const s = mk();
  const r = koPrizesAdjusted(s, inst(VANILLA, { deferredPrizeBonusThisTurn: 2 }), pool.get(VANILLA), 0, 1, pool, false);
  assert.equal(r.prizes, 3, `基礎1+多餘花粉2 應=3，實際 ${r.prizes}`);
});
T('koPrizesAdjusted 控制組：無 deferred 旗標 → 基礎 1', () => {
  const s = mk();
  const r = koPrizesAdjusted(s, inst(VANILLA), pool.get(VANILLA), 0, 1, pool, false);
  assert.equal(r.prizes, 1, `應=1，實際 ${r.prizes}`);
});

console.log(`\n結果：${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
