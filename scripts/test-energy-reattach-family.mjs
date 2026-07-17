// v5.976 HEAD-FAIL:「場上能量改附」族 ① 阻礙之翼補招式效果免疫 gate ② 高溫旋風/暴風 選能量 picker(取代自動取末端) + 暴風 basic-only filter
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.xr-s.js'),E=join(ROOT,'.xr-e.ts'),O=join(ROOT,'.xr-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const byName=(n)=>{for(const[id,c]of pool)if(c.name===n)return id;throw new Error('找不到:'+n);};
const MIST=byName('薄霧能量'); let basic=null,basic2=null;
for(const[id,c]of pool){if(c.supertype==='Energy'&&c.subtype==='Basic'){if(!basic)basic=id;else if(c.name!==pool.get(basic).name){basic2=id;break;}}}
assert.ok(basic&&basic2,'需要兩種基本能量');
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
const st=(p0act,p0b,p1act,p1b)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'P0',active:p0act,bench:p0b||[],hand:[],deck:[],discard:[],prizes:[]},{name:'P1',active:p1act,bench:p1b||[],hand:[],deck:[],discard:[],prizes:[]}]});
let pass=0;

// ① 阻礙之翼 vs 薄霧能量對手→gate 擋,不搬
{
  const s=st(inst('12783'),[],inst('16661',{energyAttached:[en(MIST),en(basic)]}),[inst('16661')]);
  const a=mod.ATTACK_POST.get('火箭隊的閃電鳥|阻礙之翼')(s,0,pool,{});
  assert.strictEqual(a.pendingSelection,null,'薄霧能量對手→不應開改附 picker');
  assert.strictEqual(a.players[1].active.energyAttached.length,2,'能量原位不動');
  console.log('  ✅ ① 阻礙之翼 vs 薄霧能量→gate 擋不搬'); pass++;
}
// ② 阻礙之翼 無免疫→照常開 picker(無回歸)
{
  const s=st(inst('12783'),[],inst('16661',{energyAttached:[en(basic),en(basic2)]}),[inst('16661')]);
  const a=mod.ATTACK_POST.get('火箭隊的閃電鳥|阻礙之翼')(s,0,pool,{});
  assert.ok(a.pendingSelection&&a.pendingSelection.type==='active-energy-discard','無免疫→應開對手能量 picker');
  console.log('  ✅ ② 阻礙之翼 無免疫→照常開 picker(無回歸)'); pass++;
}
// ③ 高溫旋風 自身2能量→開選能量 picker(非直接 bench-choose)
{
  const s=st(inst('16600',{energyAttached:[en(basic),en(basic2)]}),[inst('16600')],inst('16661'),[]);
  const a=mod.ATTACK_POST.get('波爾凱尼恩ex|高溫旋風')(s,0,pool,{});
  const ps=a.pendingSelection;
  assert.ok(ps&&ps.type==='active-energy-discard','高溫旋風2能量應先開選能量 picker,實得'+(ps&&ps.type));
  assert.strictEqual((ps.params?.validIids||[]).length,2,'2能量皆候選');
  console.log('  ✅ ③ 高溫旋風 2能量→開選能量 picker'); pass++;
}
// ④ 暴風 自身2基本能量→選能量 picker;混特殊能量時只列基本
{
  const s=st(inst('17081',{energyAttached:[en(basic),en(basic2),en(MIST)]}),[inst('17081')],inst('16661'),[]);
  const a=mod.ATTACK_POST.get('龍捲雲|暴風')(s,0,pool,{});
  const ps=a.pendingSelection;
  assert.ok(ps&&ps.type==='active-energy-discard','暴風多基本能量應開 picker');
  assert.strictEqual((ps.params?.validIids||[]).length,2,'只列2張基本能量(薄霧特殊不列)');
  console.log('  ✅ ④ 暴風 basicOnly→picker 只列基本能量'); pass++;
}
console.log(`\nPASS ${pass}/4 — energy-reattach-family`);
