/** v5.810 丟對手能量/道具招式對化隱(招式效果免疫)不生效。
 *  腐蝕液/火焰咒詛(全場)、割除衝刺(active)。化隱寶可夢的特殊能量不應被丟。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.de-s.js'),E=join(ROOT,'.de-e.ts'),O=join(ROOT,'.de-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST, ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='14443', HID='19149'/*斯魔茶 化隱*/, PRISM='14852'/*稜鏡能量 special*/;
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const sp=()=>inst(PRISM);
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const mk=(oppActive,oppBench)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:oppActive,bench:oppBench,hand:[],deck:[],discard:[],prizes:[1]}]});
const hasEnergy=(p)=>p && p.energyAttached.length>0;

T('★腐蝕液(全場):化隱 active+bench 特殊能量保留', () => {
  const ha=inst(HID,{iid:'hidA',energyAttached:[sp()]});
  const hb=inst(HID,{iid:'hidB',energyAttached:[sp()]});
  const nb=inst(POKE,{iid:'normB',energyAttached:[sp()]});
  let st=mk(ha,[hb,nb]);
  st=mod.ATTACK_POST.get('超級毒藻龍ex|腐蝕液')(st,0,pool,{});
  assert.ok(hasEnergy(st.players[1].active),'化隱 active 稜鏡應留');
  assert.ok(hasEnergy(st.players[1].bench.find(b=>b.iid==='hidB')),'化隱 bench 稜鏡應留');
  assert.ok(!hasEnergy(st.players[1].bench.find(b=>b.iid==='normB')),'一般 bench 稜鏡應被丟(對照)');
});
T('★火焰咒詛(全場特殊能量):化隱保留、一般丟棄', () => {
  const ha=inst(HID,{iid:'hidA',energyAttached:[sp()]});
  const nb=inst(POKE,{iid:'normB',energyAttached:[sp()]});
  let st=mk(ha,[nb]);
  st=mod.ATTACK_POST.get('蒼炎刃鬼|火焰咒詛')(st,0,pool,{});
  assert.ok(hasEnergy(st.players[1].active),'化隱 active 特殊能量應留');
  assert.ok(!hasEnergy(st.players[1].bench.find(b=>b.iid==='normB')),'一般 bench 特殊能量應丟(對照)');
});
T('★割除衝刺(active):化隱 active 特殊能量保留', () => {
  const ha=inst(HID,{iid:'hidA',energyAttached:[sp()]});
  let st=mk(ha,[]);
  const r=mod.ATTACK_PRE.get('切割洛托姆|割除衝刺')(st,0,pool,{});
  assert.ok(hasEnergy(r.state.players[1].active),'化隱 active 稜鏡應留(割除衝刺)');
});
console.log('\n丟對手能量化隱免疫(v5.810):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
