// 守衛：「傷害指示物剛好 N 個才昏厥」exact-count 不變量（===N，非 >=N）。
// 官方查證(ポケモンWiki SV8a + 公式Q&A)：
//   冰伊布ex|藍柱石(ユークレース)「ダメカンが6個のっている」=「ちょうど6個」，7個以上不能昏厥。
//   超級阿勃梭魯ex|死亡終局 卡面「傷害指示物為6個」= 剛好6個(Wilson 裁定，與官方一致)。
// 若未來有人誤把 === 6 改成 >= 6(誤讀「6個」為「6個以上」)，本測試會 FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.xdc-s.js'), E = join(ROOT, '.xdc-e.ts'), O = join(ROOT, '.xdc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\n"
             + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const ABSOL = '13995';   // 超級阿勃梭魯ex｜死亡終局
const GLACEON = '11566'; // 冰伊布ex｜藍柱石
const VAN = '14443';     // 一般寶可夢當墊背/防 game-over
let uid = 0;
const inst = (cid, dmg = 0) => ({ iid: `i${++uid}`, cardId: String(cid), damage: dmg, energyAttached: [], extraTools: [], toolAttached: null, evolvedFromStack: [] });
function state(attackerCid, defActive, defBench) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(attackerCid), bench: [], hand: [], deck: [inst(VAN)], discard: [], prizes: [inst(VAN), inst(VAN)] },
      { name: 'P2', active: defActive, bench: defBench, hand: [], deck: [inst(VAN)], discard: [], prizes: [inst(VAN), inst(VAN)] },
    ],
  };
}
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const deathEnd = mod.ATTACK_POST.get('超級阿勃梭魯ex|死亡終局');
const bluePillar = mod.ATTACK_POST.get('冰伊布ex|藍柱石');
assert(deathEnd && bluePillar, 'handler 未註冊');
T('死亡終局 對手active剛好6個指示物(60) → 昏厥', () => {
  const s = state(ABSOL, inst(VAN, 60), [inst(VAN)]);
  const r = deathEnd(s, 0, pool);
  assert.equal(r.players[1].active, null, '應昏厥(active→null)');
});
T('死亡終局 對手active 7個指示物(70) → 不昏厥(exact,非>=)', () => {
  const s = state(ABSOL, inst(VAN, 70), [inst(VAN)]);
  const r = deathEnd(s, 0, pool);
  assert(r.players[1].active && r.players[1].active.damage === 70, '7個不應昏厥(若>=6會誤KO)');
});
T('死亡終局 對手active 5個指示物(50) → 不昏厥', () => {
  const s = state(ABSOL, inst(VAN, 50), [inst(VAN)]);
  const r = deathEnd(s, 0, pool);
  assert(r.players[1].active && r.players[1].active.damage === 50, '5個不應昏厥');
});
T('藍柱石 對手active剛好6個(60,唯一候選) → 直接昏厥', () => {
  const s = state(GLACEON, inst(VAN, 60), [inst(VAN, 20)]);
  const r = bluePillar(s, 0, pool);
  assert.equal(r.players[1].active, null, '6個那隻應被KO');
});
T('藍柱石 對手全部7個指示物(70) → 無候選、無效(exact)', () => {
  const s = state(GLACEON, inst(VAN, 70), [inst(VAN, 70)]);
  const r = bluePillar(s, 0, pool);
  assert(r.players[1].active && r.players[1].active.damage === 70, '7個不應成為候選(若>=6會誤KO)');
  assert(!r.pendingSelection, '不應開 picker');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
