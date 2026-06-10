// v5.537 N的城堡「撤退費全部消除」應為最後硬覆蓋(蓋過鼓擊/咒縛之炎/重力之玉等+撤退)，同天空徑線
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-nc.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-nc.ts'); const O=join(ROOT,'.ent-nc.mjs');
writeFileSync(E,`export { createGame, computeActiveRetreatCostFor } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, computeActiveRetreatCostFor } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const NCASTLE='12559', NPOKE='12477' /*N的火紅不倒翁 retreat2*/, WAIL='19159', GARC='12702';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(activeId, stadiumId, activeExtra={}){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:GARC,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,
    activeStadium: stadiumId? inst(stadiumId): undefined,
    players:[{...s.players[0],bench:[inst(GARC)],active:inst(activeId,activeExtra)},
             {...s.players[1],bench:[inst(GARC)],active:inst(GARC)}]};
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① N的城堡 + N的寶可夢 + 鼓擊(+2) → 撤退費 0(全部消除蓋過+撤退)',()=>{
  const st=mk(NPOKE, NCASTLE, {retreatCostIncreaseThisTurn:2});
  assert.equal(computeActiveRetreatCostFor(st,0,pool),0,'應0，實際='+computeActiveRetreatCostFor(st,0,pool));
});
T('② N的城堡 + N的寶可夢(無+撤退) → 0',()=>{
  const st=mk(NPOKE, NCASTLE);
  assert.equal(computeActiveRetreatCostFor(st,0,pool),0);
});
T('③ N的城堡 + 非N寶可夢(吼鯨王ex) → 不受影響(照常撤退費)',()=>{
  const st=mk(WAIL, NCASTLE);
  const base=(pool.get(WAIL).retreatCost||[]).length;
  assert.equal(computeActiveRetreatCostFor(st,0,pool),base,'非N不該被消除，base='+base);
});
T('④ 無N的城堡 + N的寶可夢 + 鼓擊+2 → 2+2=4(正常加)',()=>{
  const st=mk(NPOKE, null, {retreatCostIncreaseThisTurn:2});
  assert.equal(computeActiveRetreatCostFor(st,0,pool),4,'應4，實際='+computeActiveRetreatCostFor(st,0,pool));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
