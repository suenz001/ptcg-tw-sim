// v5.745：放寶可夢到備戰一律設 justPlaced(同回合不可進化)。中央 placedBenchInstance。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.s-pb.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.e-pb.ts'); const O=join(ROOT,'.e-pb.mjs');
writeFileSync(E,`import './src/lib/game/engine';
export { RESOLVERS, placedBenchInstance } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { RESOLVERS, placedBenchInstance }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const anyId=byName.get([...byName.keys()][0]);
const basic=(()=>{for(const[id,c]of pool)if(c.supertype==='Pokemon'&&(c.subtype==='Basic'||c.stage==='Basic'))return id;return anyId;})();
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
// 單元:helper
T('placedBenchInstance:設justPlaced+裸化(damage0/energy[])',()=>{
  const r=placedBenchInstance({iid:'x',cardId:basic,damage:50,energyAttached:[inst(anyId)],status:'asleep'});
  assert.equal(r.justPlaced,true); assert.equal(r.damage,0);
  assert.equal(r.energyAttached.length,0); assert.ok(!r.status);
});
function gs(deck){return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,log:[],
  players:[{name:'A',hand:[],deck,discard:[],prizes:[],bench:[],active:inst(basic)},{name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyId)}]};}
// end-to-end:三個放場 resolver
for(const [key,nm] of [['m5-screwdriller-call-allies','呼喚同伴'],['m5-litwick-enlight','增光'],['m5-flamigo-delivery','親送挑戰']]){
  T(`${nm}: 放到備戰的基礎設 justPlaced(同回合不可進化)`,()=>{
    const fn=RESOLVERS.get(key); assert.ok(fn,'無 '+key);
    // 增光需特定卡(燈火幽靈);若無則用任意 basic 但 resolver 可能 filter 掉→跳過
    let cid=basic;
    if(nm==='增光'){ const lid=byName.get('燈火幽靈'); if(!lid){console.log('  (無燈火幽靈跳過)');return;} cid=lid; }
    const deckCard=inst(cid);
    let st=gs([deckCard]);
    st=fn(st,0,[deckCard.iid],{benchLimitAtPick:5},pool);
    const placed=st.players[0].bench.find(b=>b.cardId===String(cid));
    assert.ok(placed,`${nm} 應放到備戰(bench=${st.players[0].bench.length})`);
    assert.equal(placed.justPlaced,true,`${nm} 放的基礎應 justPlaced=true,實際=`+placed.justPlaced);
  });
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
