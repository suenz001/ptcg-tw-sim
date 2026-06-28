// v5.743：沙河馬|推倒 等強制 active↔備戰互換,舊 active 退備戰必須清特殊狀態(PTCG 規則)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.s-fs.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.e-fs.ts'); const O=join(ROOT,'.e-fs.mjs');
writeFileSync(E,`import './src/lib/game/engine';export { RESOLVERS } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { RESOLVERS }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const anyId=byName.get([...byName.keys()][0]);
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const fn=RESOLVERS.get('h-wave2-force-opp-swap-by-self'); 
T('推倒:對手active(中毒+灼傷)被強制換到備戰→清除特殊狀態',()=>{
  assert.ok(fn,'無 h-wave2-force-opp-swap-by-self');
  const oldActive=inst(anyId,{status:'asleep',secondaryStatus:'poisoned',tertiaryStatus:'burned',
    cantRetreatNextTurn:true, energyAttached:[inst(anyId)], damage:30});
  const benchPoke=inst(anyId);
  // dIdx=1(對手被換),actorIdx 在 resolver 是 dIdx;直接以 dIdx=0 驅動(p=players[0])
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:1,firstPlayerIdx:1,isFirstTurn:false,activeStadium:null,log:[],
    players:[{name:'A',hand:[],deck:[],discard:[],prizes:[],bench:[benchPoke],active:oldActive},
             {name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyId)}]};
  st=fn(st,0,[benchPoke.iid],{},pool);
  // benchPoke 應成 active;oldActive 應在 bench 且清狀態
  const newActive=st.players[0].active;
  const demoted=st.players[0].bench.find(b=>b.cardId===oldActive.cardId && b.iid===oldActive.iid);
  assert.equal(newActive.iid, benchPoke.iid, '備戰寶可夢應上場');
  assert.ok(demoted,'舊 active 應在備戰');
  assert.ok(!demoted.status && !demoted.secondaryStatus && !demoted.tertiaryStatus,
    '舊 active 退備戰應清三層狀態,實際='+[demoted.status,demoted.secondaryStatus,demoted.tertiaryStatus]);
  assert.ok(!demoted.cantRetreatNextTurn, 'active-only 旗標應清');
  assert.equal(demoted.damage, 30, '傷害應保留(非特殊狀態)');
  assert.equal(demoted.energyAttached.length, 1, '能量應保留');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
