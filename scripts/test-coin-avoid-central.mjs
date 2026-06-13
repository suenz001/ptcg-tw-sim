// v5.599 受招式傷害「擲幣免傷」中央收斂(躲藏高手/腎上腺費洛蒙 PASSIVE_COIN_AVOID)
//   原只 engine 主管線(active一般攻擊)有 → snipe-multi/中央 dealAttackDamageToTarget/備戰全漏。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.ca-e.ts'),O=join(ROOT,'.ca-o.mjs'),S=join(ROOT,'.ca-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const {applyAction}=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
// 動態找吉雉雞(腎上腺費洛蒙) + 基本惡能量
let JICHI=null, DARK=null;
for(const [id,c] of pool){
  if(!JICHI && (c.abilities||[]).some(a=>a.name==='腎上腺費洛蒙')) JICHI=id;
  if(!DARK && c.supertype==='Energy' && c.subtype==='Basic' && /【惡】/.test(c.name||'')) DARK=id;
}
const KYUREM='10629' /*三重冰霜 snipe-multi 110*/, DOLL='19176' /*玩偶捕捉 中央helper 80*/, PSY='14103', WATER='18519', METAL='14434', FILLER='14319';
if(!JICHI||!DARK){ console.log('找不到吉雉雞或基本惡能量 (JICHI='+JICHI+' DARK='+DARK+')'); process.exit(1); }
console.log('吉雉雞 id='+JICHI+' | 基本惡能量 id='+DARK);
let iid=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0;
const ck=(l,c,e)=>{ if(c){pass++;console.log('  PASS',l);}else{fail++;console.log('  FAIL',l,e||'');} };
const ORND=Math.random; const setR=v=>{Math.random=()=>v;}; const rstR=()=>{Math.random=ORND;};

// snipe(三重冰霜) 打備戰吉雉雞(附惡能量)
function mkSnipe(jichiEnergy){
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active:inst(KYUREM,[en(WATER),en(WATER),en(METAL),en(METAL),en(WATER)]), bench:[], hand:[], deck:Array.from({length:10},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P0' },
      { active:inst(FILLER), bench:[inst(JICHI, jichiEnergy)], hand:[], deck:Array.from({length:10},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P1' },
    ] };
}
// 玩偶捕捉(中央helper) 打戰鬥場吉雉雞(附惡能量)
function mkDoll(jichiEnergy){
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active:inst(DOLL,[en(PSY),en(PSY),en(PSY)]), bench:[], hand:[], deck:Array.from({length:10},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P0' },
      { active:inst(JICHI, jichiEnergy), bench:[inst(FILLER)], hand:[], deck:Array.from({length:10},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P1' },
    ] };
}

console.log('1) 三重冰霜(snipe-multi) 打備戰吉雉雞(附惡能量) → 正面免傷(damage=0仍在場)');
{
  let s=mkSnipe([en(DARK)]); const jId=s.players[1].bench[0].iid;
  s=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  setR(0.1); // 正面
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[jId]},pool); rstR();
  const j=s.players[1].bench.find(c=>c.cardId===JICHI);
  ck('正面：吉雉雞仍在備戰且 damage=0(免傷)', j && j.damage===0, 'bench='+JSON.stringify(s.players[1].bench.map(c=>({id:c.cardId,d:c.damage}))));
}
console.log('2) 對照：三重冰霜 反面 → 正常受傷(KO離場)');
{
  let s=mkSnipe([en(DARK)]); const jId=s.players[1].bench[0].iid;
  s=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  setR(0.9); // 反面
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[jId]},pool); rstR();
  const j=s.players[1].bench.find(c=>c.cardId===JICHI);
  ck('反面：吉雉雞受傷(damage>0 或已 KO 離場)', !j || j.damage>0, 'j='+JSON.stringify(j&&{d:j.damage}));
}
console.log('3) 玩偶捕捉(中央 dealAttackDamageToTarget) 打戰鬥場吉雉雞(附惡能量) → 正面免傷');
{
  setR(0.1);
  let s=applyAction(mkDoll([en(DARK)]),{type:'ATTACK',attackIndex:0,discardedEnergyIids:[]},pool); rstR();
  const a=s.players[1].active;
  ck('正面：中央 helper 路徑也免傷(吉雉雞在場 damage=0)', a && a.cardId===JICHI && a.damage===0, 'active='+JSON.stringify(a&&{id:a.cardId,d:a.damage}));
}
console.log('4) 對照：吉雉雞「沒附惡能量」→ 條件不符,不擲幣,正常受傷');
{
  setR(0.1); // 即使正面,沒惡能量也不該觸發
  let s=applyAction(mkDoll([]),{type:'ATTACK',attackIndex:0,discardedEnergyIids:[]},pool); rstR();
  const a=s.players[1].active;
  ck('無惡能量：不擲幣,吉雉雞受傷(damage>0 或 KO)', !a || a.cardId!==JICHI || a.damage>0, 'active='+JSON.stringify(a&&{id:a.cardId,d:a.damage}));
}
console.log('\n腎上腺費洛蒙 擲幣免傷收斂 PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
