// v5.947 守衛:移動傷害指示物(非治療)不誤標 healedThisTurn(蘭螳花ex活潑刀/活潑鮮花/活潑針 條件)
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.xh-s.js'), E = join(ROOT, '.xh-e.ts'), O = join(ROOT, '.xh-o.mjs');
process.on('exit', () => { for (const p of [S,E,O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { markHealsByDamageDecrease } from './src/lib/game/engine';\n" +
  "export { markDamageCounterMovedFrom } from './src/lib/game/effects/_shared';\n" +
  "import './src/lib/game/effects';");
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node',
  target:'node20', alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const mod = await import(pathToFileURL(O).href);

function mkState(activeDmg) {
  return {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5,
    isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true],
    players:[
      { name:'P0', active:{iid:'a', cardId:'x', damage:activeDmg, energyAttached:[], evolvedFromStack:[]}, bench:[], hand:[], deck:[], discard:[], prizes:[] },
      { name:'P1', active:{iid:'b', cardId:'y', damage:0, energyAttached:[], evolvedFromStack:[]}, bench:[], hand:[], deck:[], discard:[], prizes:[] },
    ],
  };
}
const prev = mkState(100);

// (1) 移動指示物:active 從 100→70,標記為 counter-move 來源 → 不該 healedThisTurn
let moved = mkState(70);
moved = mod.markDamageCounterMovedFrom(moved, 'a');
assert.ok(Array.isArray(moved._counterMoveSrcIids) && moved._counterMoveSrcIids.includes('a'), 'tag 應寫入 _counterMoveSrcIids');
const rMove = mod.markHealsByDamageDecrease(prev, moved);
assert.strictEqual(!!rMove.players[0].active.healedThisTurn, false, '移動指示物來源不該被標 healedThisTurn');
assert.strictEqual(rMove._counterMoveSrcIids, undefined, '_counterMoveSrcIids 應被消費清除');

// (2) 真回血:active 100→70 無 tag → 應 healedThisTurn=true(確認修正不破壞真回血)
const heal = mkState(70);
const rHeal = mod.markHealsByDamageDecrease(prev, heal);
assert.strictEqual(rHeal.players[0].active.healedThisTurn, true, '真回血(無 tag)仍應標 healedThisTurn');

// (3) 多來源移動(勾魂眼/奇異駭入型):兩隻同 action 移動,都不標
let multi = mkState(70);
multi.players[1].active = { iid:'b', cardId:'y', damage:20, energyAttached:[], evolvedFromStack:[] };  // b 也減(prev b=0→這裡設 prev 需對齊)
// 用 prev2:a=100,b=50
const prev2 = mkState(100); prev2.players[1].active.damage = 50;
let multi2 = mkState(70); multi2.players[1].active.damage = 30;
multi2 = mod.markDamageCounterMovedFrom(multi2, 'a', 'b');
const rMulti = mod.markHealsByDamageDecrease(prev2, multi2);
assert.strictEqual(!!rMulti.players[0].active.healedThisTurn, false, '多來源:a 不標');
assert.strictEqual(!!rMulti.players[1].active.healedThisTurn, false, '多來源:b 不標');

console.log('✅ 移動指示物非治療守衛全過(移動不標/真回血仍標/多來源/tag清除)');
