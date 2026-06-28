// v5.744：下石鳥|親送挑戰 備戰區已滿時不可放置(否則超過上限)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.s-fl.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.e-fl.ts'); const O=join(ROOT,'.e-fl.mjs');
writeFileSync(E,`import './src/lib/game/engine';
export { ATTACK_POST, RESOLVERS } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, RESOLVERS }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const anyId=byName.get([...byName.keys()][0]);
const basicPoke=(()=>{for(const[id,c]of pool)if(c.supertype==='Pokemon'&&(c.subtype==='Basic'||c.stage==='Basic'))return id;return anyId;})();
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const realRandom=Math.random;
T('親送挑戰:備戰滿(5)+2正面→不放置不超過上限',()=>{
  const fn=ATTACK_POST.get('下石鳥|親送挑戰'); assert.ok(fn,'無 親送挑戰 regPost');
  Math.random=()=>0; // 全正面(heads)
  const bench=[inst(basicPoke),inst(basicPoke),inst(basicPoke),inst(basicPoke),inst(basicPoke)]; // 滿5
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,log:[],
    players:[{name:'A',hand:[],deck:[inst(basicPoke),inst(basicPoke)],discard:[],prizes:[],bench,active:inst(basicPoke)},
             {name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyId)}]};
  st=fn(st,0,pool);
  Math.random=realRandom;
  // fixed:不開 picker(bench 滿 gate);若仍開了 picker 就驅動 resolver 看是否超限
  if(st.pendingSelection && st.pendingSelection.effectKey==='m5-flamigo-delivery'){
    const r=RESOLVERS.get('m5-flamigo-delivery');
    const pickIid=st.players[0].deck[0].iid;
    st=r(st,0,[pickIid],st.pendingSelection.params||{},pool);
  }
  assert.ok(st.players[0].bench.length<=5, '備戰不應超過5,實際='+st.players[0].bench.length);
});
T('親送挑戰:備戰未滿(3)+2正面→可放置(回歸,picker開)',()=>{
  const fn=ATTACK_POST.get('下石鳥|親送挑戰');
  Math.random=()=>0;
  const bench=[inst(basicPoke),inst(basicPoke),inst(basicPoke)];
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,log:[],
    players:[{name:'A',hand:[],deck:[inst(basicPoke),inst(basicPoke)],discard:[],prizes:[],bench,active:inst(basicPoke)},
             {name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyId)}]};
  st=fn(st,0,pool);
  Math.random=realRandom;
  assert.ok(st.pendingSelection && st.pendingSelection.effectKey==='m5-flamigo-delivery','未滿應開picker放置');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
