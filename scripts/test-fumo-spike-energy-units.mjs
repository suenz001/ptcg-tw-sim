// v5.833 驗證：怖納噬草|強力尖刺「擲與能量數相同次數硬幣，正面×80」— 能量數=host-aware 單位
//   (火箭隊能量=2單位)，非逐張。原 countOneEnergy('all') 少擲。與姊妹卡收斂 countAttachedEnergyAsUnits。
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
const FUMO='16544'/*怖納噬草 強力尖刺*/, ROCKET='17213'/*火箭隊能量=2單位*/, PSY='11177'/*基本超能量*/;
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function dmg(energyCards){
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'A',active:inst(FUMO,{energyAttached:energyCards.map(c=>inst(c))}),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'B',active:inst(FUMO),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  const old=Math.random; Math.random=()=>0.1; // 全正面
  try{ return mod.ATTACK_PRE.get('怖納噬草|強力尖刺')(st,0,pool,{}).damage; } finally { Math.random=old; }
}
T('A. 1張火箭隊能量(=2單位) → 擲2次全正 → 2×80 = 160',()=>{
  const d=dmg([ROCKET]);
  assert.equal(d,160,'應160(2單位),實際 '+d);
});
T('B. 對照:2張基本超能量(=2單位) → 160',()=>{
  const d=dmg([PSY,PSY]);
  assert.equal(d,160,'應160,實際 '+d);
});
T('C. 對照:1張基本超能量(=1單位) → 80',()=>{
  const d=dmg([PSY]);
  assert.equal(d,80,'應80,實際 '+d);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
