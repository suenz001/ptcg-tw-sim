// 守衛：卡面「在給對手看過後加入手牌」的特性/招式，須走公開揭示卡名的 resolver。
// 哈克龍|進化指引 原自訂 resolver 最終 log「選 N 張」漏卡名(違反 Iron Rule 8)，
// 收斂到 search-generic-to-hand(公開 message 揭示 ${names})。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.eg-s.js'), E = join(ROOT, '.eg-e.ts'), O = join(ROOT, '.eg-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { getAbilityFn } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const gaf = mod.getAbilityFn;
assert(typeof gaf === 'function', 'getAbilityFn 不可用');
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const DRAGONAIR = '14785', VAN = '14443';
let uid = 0;
const inst = (cid, e = []) => ({ iid: `i${++uid}`, cardId: String(cid), damage: 0, energyAttached: e, extraTools: [], toolAttached: null, evolvedFromStack: [] });
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('哈克龍|進化指引 → 走公開揭示 resolver(search-generic-to-hand)', () => {
  const fn = gaf('哈克龍', '進化指引', 0);
  assert(typeof fn === 'function', '進化指引 handler 未註冊');
  const energy = inst('14443'); // 隨意當能量佔位(進化指引 gate 只看 energyAttached.length)
  const active = inst(DRAGONAIR, [energy]);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active, bench: [], hand: [], deck: [inst(DRAGONAIR)], discard: [], prizes: [inst(VAN)] },
      { name: 'P2', active: inst(VAN), bench: [], hand: [], deck: [inst(VAN)], discard: [], prizes: [inst(VAN)] },
    ],
  };
  const r = fn(st, 0, pool);
  assert.equal(r.pendingSelection?.effectKey, 'search-generic-to-hand',
    'HEAD 用自訂 dragonair-evolution-guide(漏卡名)→應收斂到公開揭示 search-generic-to-hand');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
