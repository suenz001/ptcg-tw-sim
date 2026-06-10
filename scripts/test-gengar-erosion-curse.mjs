// v5.536 耿鬼ex 侵蝕詛咒：對手從手牌附能量到寶可夢→在那隻(對手)寶可夢放2個指示物(20傷)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-gec.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-gec.ts'); const O = join(ROOT,'.ent-gec.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const GENGAR='9817',WAIL='19159',PSY='11177',GARC='12702',ODDISH='14319';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
// P0=附能方(對手), P1=耿鬼ex侵蝕詛咒擁有者
function mk(p0activeId){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:GENGAR,count:1}]},pool);
  const energy=inst(PSY);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[energy],deck:Array.from({length:8},()=>inst(GARC)),discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[inst(p0activeId)],active:inst(p0activeId)},
             {...s.players[1],hand:[],deck:[inst(GENGAR)],discard:[],prizes:Array.from({length:6},()=>inst(GENGAR)),bench:[],active:inst(GENGAR)}],
    _energyIid:energy.iid};
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① 對手active附能→耿鬼ex侵蝕詛咒在那隻放20傷',()=>{
  const st=mk(WAIL);
  const eIid=st._energyIid, tIid=st.players[0].active.iid;
  const r=applyAction(st,{type:'ATTACH_ENERGY',energyIid:eIid,targetIid:tIid},pool);
  assert.equal(r.players[0].active?.damage,20,'附能那隻應+20傷，實際='+r.players[0].active?.damage);
  assert.equal(r.players[0].active?.energyAttached?.length,1,'能量應已附上');
});
T('② 對手備戰附能→那隻備戰放20傷',()=>{
  const st=mk(WAIL);
  const eIid=st._energyIid, bIid=st.players[0].bench[0].iid;
  const r=applyAction(st,{type:'ATTACH_ENERGY',energyIid:eIid,targetIid:bIid},pool);
  assert.equal(r.players[0].bench[0]?.damage,20,'備戰那隻應+20傷，實際='+r.players[0].bench[0]?.damage);
});
T('③ 低HP對手active附能被20KO→耿鬼方拿獎',()=>{
  const st=mk(ODDISH); // 走路草50hp; 但要被20KO需先有30傷。設35傷→+20=55≥50 KO
  st.players[0].active.damage=35;
  const eIid=st._energyIid, tIid=st.players[0].active.iid;
  const r=applyAction(st,{type:'ATTACH_ENERGY',energyIid:eIid,targetIid:tIid},pool);
  assert(!r.players[0].active || r.players[0].active.cardId!==ODDISH,'走路草應被侵蝕詛咒KO');
  assert.equal(r.players[1].prizes.length,5,'耿鬼方應拿1獎(6→5)，實際='+r.players[1].prizes.length);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
