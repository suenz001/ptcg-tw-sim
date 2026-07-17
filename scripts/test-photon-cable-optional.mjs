// v5.977 HEAD-FAIL:密勒頓|光子纜線「最多2張」可選 0~2(可不選、可只選1)。統一走能量 picker minCount:0
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.xp-s.js'),E=join(ROOT,'.xp-e.ts'),O=join(ROOT,'.xp-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { PASSIVE_ON_KO } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { PASSIVE_ON_KO }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
// 找基本雷能量
let lb=null; for(const[id,c]of pool){if(c.supertype==='Energy'&&c.subtype==='Basic'&&(c.pokemonType==='Lightning'||/【雷】/.test(c.name||''))){lb=id;break;}}
assert.ok(lb,'需要基本雷能量');
// 找密勒頓 M5#19171
let mireton=null; for(const[id,c]of pool){if(c.name==='密勒頓'){mireton=id;break;}}
assert.ok(mireton,'需要密勒頓');
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
const en=()=>({iid:'e'+(++nn),cardId:String(lb),damage:0,energyAttached:[]});
const fn=PASSIVE_ON_KO.get('光子纜線');
assert.ok(fn,'找不到光子纜線 on-KO handler');
function run(nEnergy){
  const koE=Array.from({length:nEnergy},()=>en());
  const defInst={iid:'mko',cardId:String(mireton),damage:200,energyAttached:koE};
  // KO sweep 後:active=null,能量已進 discard(模擬)
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:1,firstPlayerIdx:0,turn:5,log:[],pendingSelection:null,setupDone:[true,true],
    players:[{name:'P0',active:inst('19171'),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'P1',active:null,bench:[inst('19171')],hand:[],deck:[],discard:[...koE],prizes:[]}]};
  return fn(st,1,0,pool,pool.get(String(mireton)),defInst);
}
let pass=0;
// ① 3 張基本雷 → 能量 picker minCount:0(可不選),非強制2
{
  const a=run(3); const ps=a.pendingSelection;
  assert.ok(ps&&ps.type==='discard-search'&&ps.effectKey==='photon-code-pick-energy','3張應開能量 picker');
  assert.strictEqual(ps.minCount,0,`「最多2張」應可不選 minCount:0,實得 ${ps.minCount}`);
  assert.strictEqual(ps.maxCount,2,'最多2張');
  console.log('  ✅ ① 3張基本雷→能量 picker minCount:0 maxCount:2(可不選)'); pass++;
}
// ② 2 張基本雷 → 也開能量 picker(可選0/1/2),非直接 bench-choose 全移
{
  const a=run(2); const ps=a.pendingSelection;
  assert.ok(ps&&ps.type==='discard-search'&&ps.effectKey==='photon-code-pick-energy','2張也應開能量 picker(可選少於2)');
  assert.strictEqual(ps.minCount,0); assert.strictEqual(ps.maxCount,2);
  console.log('  ✅ ② 2張基本雷→能量 picker minCount:0 maxCount:2(可選0/1/2)'); pass++;
}
// ③ 1 張基本雷 → 能量 picker maxCount:1
{
  const a=run(1); const ps=a.pendingSelection;
  assert.ok(ps&&ps.type==='discard-search','1張應開能量 picker');
  assert.strictEqual(ps.minCount,0); assert.strictEqual(ps.maxCount,1);
  console.log('  ✅ ③ 1張基本雷→能量 picker minCount:0 maxCount:1'); pass++;
}
console.log(`\nPASS ${pass}/3 — photon-cable-optional`);
