/** v5.805 defCantAttackNextPost v2590本地版收斂中央(含免疫gate)
 *  化隱對手→「下回合無法使用招式」不應施加(cantAttackPending)。HEAD:v2590本地漏gate→仍施加。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.ca-s.js'),E=join(ROOT,'.ca-e.ts'),O=join(ROOT,'.ca-o.mjs');
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
for(const key of ['N的多多冰|絕對零度','凍原熊|絕對零度','噴嚏熊|渾身鼻水']){
  T(`★${key}:化隱對手不應被禁招`, () => {
    const out=ATTACK_POST.get(key)(mk(HIDDEN),0,pool);
    assert.ok(!out.players[1].active.cantAttackPending, `化隱應免疫,實得 ${out.players[1].active.cantAttackPending}`);
  });
}
T('對照:普通對手→絕對零度正常禁招', () => {
  const out=ATTACK_POST.get('N的多多冰|絕對零度')(mk(POKE),0,pool);
  assert.ok(out.players[1].active.cantAttackPending, '普通對手應被禁招');
});
console.log('\n禁招免疫收斂(v5.805):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
