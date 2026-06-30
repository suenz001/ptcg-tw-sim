/** v5.806 對手戰鬥位 debuff 中央收斂(applyOppActiveDebuffPost,含免疫gate)
 *  朽木妖詛咒根(cantAttachEnergyNextTurn)/轟擂金剛猩鼓擊(增費)/引夢貘人白日夢(endTurnOnOppAttach)
 *  原手刻漏免疫gate→化隱對手仍被施加。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.od-s.js'),E=join(ROOT,'.od-e.ts'),O=join(ROOT,'.od-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='14443', HIDDEN='19149';
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const mk=(oppCid)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:inst(oppCid),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});
const CASES=[
  ['朽木妖|詛咒根','cantAttachEnergyNextTurn'],
  ['轟擂金剛猩|鼓擊','retreatCostIncreaseNextTurn'],
  ['引夢貘人|白日夢','endTurnOnOppAttachEnergyNextTurn'],
];
for(const [key,flag] of CASES){
  T(`★${key}:化隱對手不應被施 ${flag}`, () => {
    const out=ATTACK_POST.get(key)(mk(HIDDEN),0,pool);
    assert.ok(!out.players[1].active[flag], `化隱應免疫,實得 ${flag}=${out.players[1].active[flag]}`);
  });
  T(`對照:${key} 普通對手正常施 ${flag}`, () => {
    const out=ATTACK_POST.get(key)(mk(POKE),0,pool);
    assert.ok(out.players[1].active[flag], `普通對手應被施 ${flag}`);
  });
}
console.log('\n對手debuff免疫收斂(v5.806):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
