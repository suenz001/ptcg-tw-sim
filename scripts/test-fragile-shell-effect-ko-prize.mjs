// 脆弱蛻殼(脫殼忍者):卡面「就算受到對手寶可夢【ex】招式的『傷害』而昏厥,對手也無法獲得獎賞卡」=只限招式傷害KO。
//   koPrizesAdjusted 原把 PASSIVE_PREVENT_PRIZE→0 放在 if(koByAttackDamage) 外→效果KO(放指示物)也誤歸0。
//   應只在 koByAttackDamage=true 才歸0;效果KO(false)對手正常拿獎賞。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-fs.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-fs.ts'); const O=join(ROOT,'.ent-fs.mjs');
writeFileSync(E,`import './src/lib/game/engine';
export { koPrizesAdjusted } from './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { koPrizesAdjusted }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const liveSet=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!liveSet.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);
    if(!byName.has(c.name))byName.set(c.name,c);}}
const shell=byName.get('脫殼忍者');           // 脆弱蛻殼 持有者(非ex,1獎賞)
// 找一張 ex 當攻擊方active
let exCard=null; for(const c of pool.values()){ if(c.supertype==='Pokemon'&&c.subtype==='ex'){exCard=c;break;} }
let iid=0;const inst=(cid,e={})=>({iid:`f${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const koInst=inst(shell.id);
const st={players:[{active:inst(exCard.id),bench:[],hand:[],deck:[],discard:[],prizes:[]},
                   {active:koInst,bench:[],hand:[],deck:[],discard:[],prizes:[]}],
  log:[],activePlayerIndex:0, ancientEnergyMinusOneUsed:[false,false], activeStadium:null};
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
T('① 招式傷害KO(koByAttackDamage=true)+攻方ex → 脆弱蛻殼歸0',()=>{
  const r=koPrizesAdjusted(st,koInst,shell,0,1,pool,true);
  assert.equal(r.prizes,0,'招式KO應歸0,實際='+r.prizes);
});
T('② 效果KO(koByAttackDamage=false)+攻方ex → 不歸0(對手正常拿1張)',()=>{
  const r=koPrizesAdjusted(st,koInst,shell,0,1,pool,false);
  assert.equal(r.prizes,1,'效果KO脆弱蛻殼不該觸發,應base 1,實際='+r.prizes);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
