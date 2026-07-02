// v5.835 驗證:「寶可夢道具的數量×N」須含多重轉接(extraTools)。洛托姆|配件秀 + 青銅鐘|道具擊落
//   原只讀 toolAttached 少算 → 收斂中央 getAllAttachedTools(與切割/加熱/清洗洛托姆一致)。
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
const ROTOM='14736', BRONZONG='14378', T1='14089', T2='14466';
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function stSelf(active){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'A',active,bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'B',active:inst(ROTOM),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
}
T('洛托姆|配件秀:自身2道具(多重轉接) → 2×30 = 60',()=>{
  const a=inst(ROTOM,{toolAttached:inst(T1),extraTools:[inst(T2)]});
  const d=mod.ATTACK_PRE.get('洛托姆|配件秀')(stSelf(a),0,pool,{}).damage;
  assert.equal(d,60,'應60(2道具),實際 '+d);
});
T('青銅鐘|道具擊落:自身2道具 → 2×40 = 80',()=>{
  const a=inst(ROTOM,{toolAttached:inst(T1),extraTools:[inst(T2)]});
  const d=mod.ATTACK_PRE.get('青銅鐘|道具擊落')(stSelf(a),0,pool,{}).damage;
  assert.equal(d,80,'應80(2道具),實際 '+d);
});
T('對照:1道具 → 配件秀30 / 道具擊落40',()=>{
  const a=inst(ROTOM,{toolAttached:inst(T1)});
  assert.equal(mod.ATTACK_PRE.get('洛托姆|配件秀')(stSelf(a),0,pool,{}).damage,30);
  assert.equal(mod.ATTACK_PRE.get('青銅鐘|道具擊落')(stSelf(a),0,pool,{}).damage,40);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
