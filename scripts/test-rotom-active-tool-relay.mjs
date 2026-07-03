// v5.851 洛托姆ex｜多重轉接：洛托姆ex 自身在「戰鬥場」且已附 1 張道具、又是唯一可附目標時，
//   第 2 張道具仍應可打出並進 extraTools。
//   根因：自動 TRAINER_GUARD 舊版只認「無 toolAttached」目標、漏多重轉接 → 卡片被判不可玩、
//   道具附不上（撤退到備戰有其他無道具寶可夢時 guard 才巧合放行）。收斂中央 toolAttachableTargets。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-paths.js'), E = join(ROOT, '.ent-rotomtool.ts'), O = join(ROOT, '.ent-rotomtool.mjs');
process.on('exit', () => { for (const p of [S, E, O]) try { unlinkSync(p); } catch { /* noop */ } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let bal = null, hel = null;
for (const [id, c] of pool) { if (c.name === '氣球') bal = id; if (c.name === '龐克頭盔') hel = id; }
const ROTOMEX = '14347', VAN = '14443';
let iid = 0;
const inst = (cid, e = {}) => ({ iid: `a${++iid}`, cardId: String(cid), damage: 0, energyAttached: [], extraTools: [], ...e });
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

function baseState(activeP0, benchP0) {
  const s = createGame({ name: 'P1', entries: [{ cardId: VAN, count: 1 }] }, { name: 'P2', entries: [{ cardId: VAN, count: 1 }] }, pool);
  return {
    ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { ...s.players[0], hand: [inst(hel)], deck: [inst(VAN)], discard: [], prizes: [inst(VAN)], active: activeP0, bench: benchP0 },
      { ...s.players[1], hand: [], deck: [inst(VAN)], discard: [], prizes: [inst(VAN)], active: inst(VAN), bench: [] },
    ],
  };
}

T('洛托姆ex 在戰鬥場(唯一可附目標,已附1道具)→ 第2張道具 guard 放行 + picker 開啟 + 進 extraTools', () => {
  const rotom = inst(ROTOMEX, { toolAttached: inst(bal) });
  const st = baseState(rotom, []);
  const hi = st.players[0].hand[0].iid;
  const o1 = applyAction(st, { type: 'PLAY_TRAINER', iid: hi }, pool);
  // HEAD(修前): guard 擋掉 → PLAY_TRAINER 直接 return state → 無 pendingSelection、道具仍在手牌
  assert.equal(o1.pendingSelection?.effectKey, 'attach-tool', '應開 attach-tool picker(修前 guard 擋掉→無 picker)');
  assert(o1.pendingSelection.params.validIids.includes(rotom.iid), 'validIids 應含戰鬥場洛托姆ex');
  const o2 = applyAction(o1, { type: 'RESOLVE_SELECTION', selectedIids: [rotom.iid] }, pool);
  assert.equal(o2.players[0].active.extraTools.length, 1, '戰鬥場洛托姆ex 應有 1 張 extraTools(第2道具)');
  assert(o2.players[0].active.toolAttached, '第1張 toolAttached 仍在');
});

T('控制組：一般寶可夢在戰鬥場已附道具且無其他目標 → 第2張道具 guard 擋下(不可打)', () => {
  const van = inst(VAN, { toolAttached: inst(bal) });
  const st = baseState(van, []);
  const hi = st.players[0].hand[0].iid;
  const o1 = applyAction(st, { type: 'PLAY_TRAINER', iid: hi }, pool);
  assert(!o1.pendingSelection, '無多重轉接、無其他目標 → 不應開 picker');
  assert.equal(o1.players[0].hand.length, 1, '道具應仍在手牌(不可打)');
});

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
