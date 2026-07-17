// v5.975 HEAD-FAIL:① 鎖對手招式(無理取鬧/記憶之鎖)補招式效果免疫 gate(薄霧能量等不受鎖)
//                   ② 凍結獠牙「能量2個以下」改 totalEnergyUnits(火箭隊能量=2單位)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.xl-s.js'),E=join(ROOT,'.xl-e.ts'),O=join(ROOT,'.xl-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const byName=(n)=>{for(const[id,c]of pool)if(c.name===n)return id;throw new Error('找不到卡:'+n);};
const MIST=byName('薄霧能量'), ROCKET=byName('火箭隊能量');
let basic=null; for(const[id,c]of pool){if(c.supertype==='Energy'&&c.subtype==='Basic'){basic=id;break;}}
assert.ok(basic,'需要一張基本能量');
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0;

// ① 無理取鬧 對薄霧能量防守方 → gate 擋,不鎖
{
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
    players:[{name:'P0',active:inst('16950'),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'P1',active:inst('16661',{energyAttached:[en(MIST)]}),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  const a=mod.ATTACK_POST.get('流氓熊貓|無理取鬧')(st,0,pool,{});
  assert.strictEqual(a.players[1].active.blockedAttackNamesNextTurn,undefined,'薄霧能量防守方不應被鎖招');
  assert.strictEqual(a.pendingSelection,null,'免疫→不應開選招 modal');
  console.log('  ✅ ① 無理取鬧 vs 薄霧能量→gate 擋不鎖'); pass++;
}
// ② 記憶之鎖 收斂後同樣 gate 擋
{
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
    players:[{name:'P0',active:inst('18035'),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'P1',active:inst('16661',{energyAttached:[en(MIST)]}),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  const a=mod.ATTACK_POST.get('鑰圈兒|記憶之鎖')(st,0,pool,{});
  assert.strictEqual(a.players[1].active.blockedAttackNamesNextTurn,undefined,'記憶之鎖 vs 薄霧能量不應鎖');
  assert.strictEqual(a.pendingSelection,null);
  console.log('  ✅ ② 記憶之鎖(收斂)vs 薄霧能量→gate 擋不鎖'); pass++;
}
// ③ 無回歸:無免疫防守方→照常鎖(fast path 或開 modal)
{
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
    players:[{name:'P0',active:inst('16950'),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'P1',active:inst('16661'),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  const a=mod.ATTACK_POST.get('流氓熊貓|無理取鬧')(st,0,pool,{});
  const locked=(a.players[1].active.blockedAttackNamesNextTurn?.length>0)||(a.pendingSelection?.effectKey==='unreasonable-lock-attack');
  assert.ok(locked,'無免疫防守方應正常鎖招或開選招 modal');
  console.log('  ✅ ③ 無免疫→照常鎖(無回歸)'); pass++;
}
// ④ 凍結獠牙 units:火箭隊能量(2單位)+基本(1)=3單位 >2 → 不鎖
{
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
    lowEnergyCantAttackThisTurn:[true,false],
    players:[{name:'P0',active:inst('16950',{energyAttached:[en(ROCKET),en(basic)]}),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'P1',active:inst('16661'),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  const a=mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  const locked=(a.log||[]).some(l=>(typeof l==='string'?l:(l?.message||l?.text||'')).includes('凍結獠牙'));
  assert.ok(!locked,'火箭隊能量(2)+基本(1)=3單位 >2,不應被凍結獠牙鎖');
  console.log('  ✅ ④ 凍結獠牙 3單位>2→不鎖(units 非張數)'); pass++;
}
console.log(`\nPASS ${pass}/4 — opp-attack-lock-immune`);
