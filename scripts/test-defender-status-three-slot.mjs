// v5.834 驗證:讀取對手/自身特殊狀態的條件招式須跨三槽(status/secondary/tertiary)。
//   狀態自 v5.295 三槽:麻痺(行動)佔主格時,中毒/灼傷落 secondary/tertiary。
//   4 個漏槽 reader → 中央 hasStatusInAnySlot / countSpecialConditions。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const D='14086';
let iid=0;const inst=(e={})=>({iid:`x${++iid}`,cardId:D,damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
// 對手戰鬥位 3 狀態:麻痺(主)+中毒(次)+灼傷(三)
function stDef(defStatus){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'A',active:inst(),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'B',active:inst(defStatus),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
}
const THREE={status:'paralyzed',secondaryStatus:'poisoned',tertiaryStatus:'burned'};
T('搖籃百合|瘴氣之風:3 狀態 → 3×100 = 300',()=>{
  const d=mod.ATTACK_PRE.get('搖籃百合|瘴氣之風')(stDef(THREE),0,pool,{}).damage;
  assert.equal(d,300,'應300,實際 '+d);
});
T('火箭隊的臭臭泥|毒液危害:3 狀態 → 3×100 = 300',()=>{
  const d=mod.ATTACK_PRE.get('火箭隊的臭臭泥|毒液危害')(stDef(THREE),0,pool,{}).damage;
  assert.equal(d,300,'應300,實際 '+d);
});
T('熔岩蟲|炙燒:灼傷在第三格 → 10+40 = 50',()=>{
  const d=mod.ATTACK_PRE.get('熔岩蟲|炙燒')(stDef(THREE),0,pool,{}).damage;
  assert.equal(d,50,'應50(灼傷在tertiary),實際 '+d);
});
T('青木的姆克鷹|硬撐:自身灼傷在第三格 → 160',()=>{
  const st=stDef({}); st.players[0].active={...st.players[0].active,status:'paralyzed',tertiaryStatus:'burned'};
  const d=mod.ATTACK_PRE.get('青木的姆克鷹|硬撐')(st,0,pool,{}).damage;
  assert.equal(d,160,'應160(自身灼傷在tertiary),實際 '+d);
});
T('對照:無狀態 → 搖籃百合 0 / 熔岩蟲 10',()=>{
  assert.equal(mod.ATTACK_PRE.get('搖籃百合|瘴氣之風')(stDef({}),0,pool,{}).damage,0);
  assert.equal(mod.ATTACK_PRE.get('熔岩蟲|炙燒')(stDef({}),0,pool,{}).damage,10);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
