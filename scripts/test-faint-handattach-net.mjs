// 豐收漁網 gate + 瑪機雅娜自動治癒(從手牌附能) + 效果昏厥用有效maxHP(竹蘭力量負重) 回歸網
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-paths.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-fh.ts'); const O = join(ROOT, '.ent-fh.mjs');
writeFileSync(E, `export { createGame, applyAction, getEffectiveHP } from './src/lib/game/engine';
export { canPlayTrainer } from './src/lib/game/effects/_shared';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, getEffectiveHP, canPlayTrainer } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const CID = { net: '18493', water: '14085', waterE: '18519',
  magearna: '14780', oricorio: '14336', fireMega: '14425', charm: '14416', fireE: '14428',
  voltorb: '16706', garchomp: '14750', weight: '14822', lightE: '18520' };
let iid = 0; const inst = (cid, e = {}) => ({ iid: `a${++iid}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ① 豐收漁網 gate
function netState(discardCards) {
  const s = createGame({ name: 'P1', entries: [{ cardId: CID.charm, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.charm, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(CID.charm), hand: [inst(CID.net)], discard: discardCards.map(c => inst(c)) },
      { ...s.players[1], active: inst(CID.charm) }] };
}
T('豐收漁網：棄牌區無水寶可夢/水能量 → 不可使用', () => {
  assert.equal(canPlayTrainer('豐收漁網', netState([CID.charm, CID.fireE]), 0, pool), false);
});
T('豐收漁網：棄牌區有水能量 → 可使用', () => {
  assert.equal(canPlayTrainer('豐收漁網', netState([CID.waterE]), 0, pool), true);
});
T('豐收漁網：棄牌區有水寶可夢 → 可使用', () => {
  assert.equal(canPlayTrainer('豐收漁網', netState([CID.water]), 0, pool), true);
});

// ② 自動治癒：激動渦輪 從手牌附火能到備戰小火龍 → 瑪機雅娜在戰鬥場 → 小火龍 +90
T('自動治癒：激動渦輪附能備戰小火龍 → 治癒90', () => {
  const s = createGame({ name: 'P1', entries: [{ cardId: CID.charm, count: 1 }] },
    { name: 'P2', entries: [{ cardId: CID.charm, count: 1 }] }, pool);
  const fireEnergy = inst(CID.fireE);
  const charmTarget = inst(CID.charm, { damage: 70 });
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    pendingSelection: { type: 'bench-choose', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1,
      effectKey: 'exciting-turbo-commit', params: { energyIid: fireEnergy.iid, validIids: [charmTarget.iid] } },
    players: [
      { ...s.players[0], active: inst(CID.magearna, { damage: 0 }), hand: [fireEnergy],
        bench: [inst(CID.oricorio), inst(CID.fireMega), charmTarget] },
      { ...s.players[1], active: inst(CID.charm) }] };
  const n = applyAction(st, { type: 'RESOLVE_SELECTION', effectKey: 'exciting-turbo-commit', selectedIids: [charmTarget.iid], actorIdx: 0 }, pool);
  const tgt = n.players[0].bench.find(b => b.cardId === CID.charm);
  assert(tgt.energyAttached.length === 1, '火能量應已附上，實際' + tgt.energyAttached.length);
  assert.equal(tgt.damage, 0, '小火龍應被自動治癒 70→0，實際 damage=' + tgt.damage);
});

// ③ 效果昏厥用有效maxHP：怦怦炸彈正面 KO 附竹蘭力量負重(+70)的烈咬陸鯊ex
T('怦怦炸彈正面 → KO 附竹蘭力量負重的烈咬陸鯊ex(330+70=400)', () => {
  const orig = Math.random; Math.random = () => 0; // 正面
  try {
    const s = createGame({ name: 'P1', entries: [{ cardId: CID.charm, count: 1 }] },
      { name: 'P2', entries: [{ cardId: CID.charm, count: 1 }] }, pool);
    const garchomp = inst(CID.garchomp, { toolAttached: inst(CID.weight) });
    assert.equal(getEffectiveHP(garchomp, pool, s), 400, '有效HP應400，實際' + getEffectiveHP(garchomp, pool, s));
    const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
      players: [
        { ...s.players[0], active: inst(CID.voltorb, { energyAttached: [inst(CID.lightE), inst(CID.lightE)] }), bench: [inst(CID.charm)], prizes: Array.from({length:6},()=>inst(CID.charm)), deck: [inst(CID.charm)] },
        { ...s.players[1], active: garchomp, bench: [inst(CID.charm)], prizes: Array.from({length:6},()=>inst(CID.charm)), deck: [inst(CID.charm)] }] };
    const atkIdx = pool.get(CID.voltorb).attacks.findIndex(a => a.name === '怦怦炸彈');
    const n = applyAction(st, { type: 'ATTACK', attackIndex: atkIdx }, pool);
    const oppActive = n.players[1].active;
    assert(oppActive === null || oppActive.cardId !== CID.garchomp, '烈咬陸鯊ex 應被昏厥(active清空或補位)，實際仍在=' + (oppActive && oppActive.cardId));
  } finally { Math.random = orig; }
});

unlinkSync(E); unlinkSync(O); unlinkSync(S);
console.log(`\n結果：${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
