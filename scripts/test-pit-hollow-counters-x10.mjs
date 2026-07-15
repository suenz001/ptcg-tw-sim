// v5.951 守衛:火箭隊的三地鼠|凹洞 放2個傷害指示物=20傷害(非2)。原漏×10只扣2滴。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.pit-e.ts'),O=join(ROOT,'.pit-o.mjs'),S=join(ROOT,'.pit-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`export { applyOppActiveReturnedToBenchTriggers } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyOppActiveReturnedToBenchTriggers } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;
  for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))pool.set(String(c.id),c);}
let nn=0;
const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:cid,damage:0,energyAttached:[],...x});
const MOLE='14743';  // 火箭隊的三地鼠 凹洞
const NORMAL='10605'; // 不良蛙
// moverIdx=0 退場,ownerIdx=1 有凹洞
const retreated = inst(NORMAL);       // P0 退場的寶可夢(在 P0 bench)
const newActive = inst(NORMAL);
function mk() {
  return {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active: newActive, bench:[retreated], hand:[], deck:[], discard:[], prizes:[], name:'P0' },
      { active: inst(MOLE), bench:[], hand:[], deck:[], discard:[], prizes:[], name:'P1(凹洞)' },  // P1 有凹洞
    ] };
}
const st = applyOppActiveReturnedToBenchTriggers(mk(), 0, retreated, newActive, pool);
const tgt = st.players[0].bench.find(b=>b.iid===retreated.iid);
// 斷言:凹洞放2個指示物=20傷害(HEAD 漏×10只加2)
assert.strictEqual(tgt.damage, 20, `凹洞放2指示物應=20傷害(得 ${tgt.damage})`);
console.log('✅ 凹洞指示物×10守衛過(2指示物=20傷害)');
