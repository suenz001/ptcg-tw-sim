// v5.747:葉伊布|嫩葉之恩等 benchHandAttachFullHeal 當「恰1隻合法備戰」自動選定分支
//   原漏傳 pool → applyBenchAttachFullHeal 末尾 fireOnHandEnergyAttached(undefined) pool.get 崩。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.s-bf.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.e-bf.ts'); const O=join(ROOT,'.e-bf.mjs');
writeFileSync(E,`import './src/lib/game/engine';export { RESOLVERS } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { RESOLVERS }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const enId=(()=>{for(const[id,c]of pool)if(c.supertype==='Energy'&&(c.subtype==='Basic'||!c.subtype))return id;})();
const anyBasic=(()=>{for(const[id,c]of pool)if(c.supertype==='Pokemon'&&(c.subtype==='Basic'||c.stage==='Basic'))return id;})();
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
T('嫩葉之恩 resolver:恰1隻備戰自動選定,不崩,能量附上+回復',()=>{
  const fn=RESOLVERS.get('bench-hand-attach-fullheal-pick-energy'); assert.ok(fn,'無 resolver');
  const energyHand=inst(enId);
  const bench1=inst(anyBasic,{damage:50}); // 1 隻備戰,有傷可驗回復
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,log:[],
    players:[{name:'A',hand:[energyHand],deck:[],discard:[],prizes:[],bench:[bench1],active:inst(anyBasic)},
             {name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyBasic)}]};
  // iids=選的能量;params 不帶 benchValidIids → 預設 1 隻 bench → 自動選定分支(原崩點)
  st=fn(st,0,[energyHand.iid],{label:'嫩葉之恩'},pool);
  const b=st.players[0].bench[0];
  assert.equal(b.energyAttached.length,1,'能量應附到備戰');
  assert.equal(b.damage,0,'應全回復(damage 0)');
  assert.ok(!st.players[0].hand.some(c=>c.iid===energyHand.iid),'能量應離開手牌');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
