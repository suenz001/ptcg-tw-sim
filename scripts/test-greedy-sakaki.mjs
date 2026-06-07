// 三首惡龍ex｜貪婪食客（KO 對手基礎寶可夢 +1 獎賞，含基礎 ex）+ 火箭隊的坂木 官方 Q&A 回歸網
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-paths.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-gs.ts'); const O = join(ROOT, '.ent-gs.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';
export { canPlayTrainer } from './src/lib/game/effects/_shared';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, canPlayTrainer } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

pool.set('RKT1', { id: 'RKT1', name: '火箭隊的測試喵', supertype: 'Pokemon', subtype: 'Basic', hp: '70', retreatCost: 1 });
pool.set('RKT2', { id: 'RKT2', name: '火箭隊的測試喵B', supertype: 'Pokemon', subtype: 'Basic', hp: '70', retreatCost: 1 });

const CID = { greedy: '16949', meow: '18038', sakaki: '14838', yamask: '14354' };
let basicNonEx, stageNonEx;
for (const [, c] of pool) {
  if (c.supertype !== 'Pokemon' || Number(c.hp) > 160) continue;
  if (!basicNonEx && c.subtype === 'Basic' && !c.evolvesFrom && !String(c.name).includes('ex')) basicNonEx = c.id;
  if (!stageNonEx && c.evolvesFrom && (c.subtype === 'Stage1' || c.subtype === 'Stage2') && !String(c.name).includes('ex')) stageNonEx = c.id;
}
assert(basicNonEx && stageNonEx, `找不到對照卡 basic=${basicNonEx} stage=${stageNonEx}`);

let iid = 0; const inst = (cid, e = {}) => ({ iid: `a${++iid}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prizeOf = n => Array.from({ length: n }, () => inst(CID.meow));
const darkE = pool.get('14430') ? '14430' : [...pool].find(([, c]) => c.supertype === 'Energy')?.[0];
const greedyAtk = pool.get(CID.greedy).attacks.findIndex(a => a.name === '暗黑啃咬');
assert(greedyAtk >= 0, '找不到暗黑啃咬');

function mk(defActive, defBench = []) {
  const s = createGame({ name: 'P1', entries: [{ cardId: CID.meow, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.meow, count: 1 }] }, pool);
  const atk = inst(CID.greedy, { energyAttached: [inst(darkE), inst(darkE), inst(darkE), inst(darkE), inst(darkE)] });
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { ...s.players[0], hand: [], deck: [inst(CID.meow)], discard: [], prizes: prizeOf(6), bench: [], active: atk },
      { ...s.players[1], hand: [], deck: [inst(CID.meow)], discard: [], prizes: prizeOf(6), bench: defBench, active: defActive },
    ] };
}

let pass = 0; const T = (n, fn) => { fn(); console.log('PASS', n); pass++; };

T('貪婪食客 KO 基礎ex喵喵ex → 取3獎賞(6→3)〔修正核心〕', () => {
  const n = applyAction(mk(inst(CID.meow)), { type: 'ATTACK', attackIndex: greedyAtk }, pool);
  assert.equal(n.players[0].prizes.length, 3, '應取3，實取' + (6 - n.players[0].prizes.length));
});
T('貪婪食客 KO 基礎非ex → 取2獎賞(6→4)', () => {
  const n = applyAction(mk(inst(basicNonEx)), { type: 'ATTACK', attackIndex: greedyAtk }, pool);
  assert.equal(n.players[0].prizes.length, 4, '應取2，實取' + (6 - n.players[0].prizes.length));
});
T('貪婪食客 KO 演化非基礎 → 不+1，取1獎賞(6→5)', () => {
  const n = applyAction(mk(inst(stageNonEx)), { type: 'ATTACK', attackIndex: greedyAtk }, pool);
  assert.equal(n.players[0].prizes.length, 5, '應取1(無+1)，實取' + (6 - n.players[0].prizes.length));
});

function sakakiState(myActiveCid, myBenchCids, oppBenchCids) {
  const s = createGame({ name: 'P1', entries: [{ cardId: CID.meow, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.meow, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [
      { ...s.players[0], active: myActiveCid ? inst(myActiveCid) : null, bench: myBenchCids.map(c => inst(c)), hand: [inst(CID.sakaki)] },
      { ...s.players[1], active: inst(CID.meow), bench: oppBenchCids.map(c => inst(c)) },
    ] };
}
T('坂木：火箭隊 active+bench + 對手備戰 → 可使用', () => {
  assert.equal(canPlayTrainer('火箭隊的坂木', sakakiState('RKT1', ['RKT2'], [CID.meow]), 0, pool), true);
});
T('坂木：場上無火箭隊寶可夢 → 不可使用', () => {
  assert.equal(canPlayTrainer('火箭隊的坂木', sakakiState(CID.meow, [CID.meow], [CID.meow]), 0, pool), false);
});
T('坂木：備戰區無火箭隊（僅 active 是）→ 不可使用', () => {
  assert.equal(canPlayTrainer('火箭隊的坂木', sakakiState('RKT1', [CID.meow], [CID.meow]), 0, pool), false);
});
T('坂木：active 非火箭隊（僅 bench 是）→ 不可使用', () => {
  assert.equal(canPlayTrainer('火箭隊的坂木', sakakiState(CID.meow, ['RKT2'], [CID.meow]), 0, pool), false);
});

T('坂木/gust 互換對手 → 夢妖魔ex 漩渦言靈不觸發(新 active 不混亂)', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: CID.meow, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.meow, count: 1 }] }, pool);
  const yam = inst(CID.yamask);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    pendingSelection: { type: 'opp-bench-choose', actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: 1, effectKey: 'gust-opp' },
    players: [
      { ...s.players[0], active: inst(CID.meow), bench: [] },
      { ...s.players[1], active: inst(CID.meow), bench: [yam] },
    ] };
  const n = applyAction(st, { type: 'RESOLVE_SELECTION', effectKey: 'gust-opp', selectedIids: [yam.iid], actorIdx: 0 }, pool);
  const oppActive = n.players[1].active;
  assert.equal(pool.get(oppActive.cardId)?.name, '夢妖魔ex', '夢妖魔ex 應已換到對手戰鬥場');
  assert.notEqual(oppActive.status, 'confused', '夢妖魔ex 不應被自己的漩渦言靈混亂');
  assert.notEqual(oppActive.secondaryStatus, 'confused', '夢妖魔ex 不應被混亂(次要狀態)');
});

unlinkSync(E); unlinkSync(O); unlinkSync(S);
console.log(`\n全部 ${pass}/8 通過`);
