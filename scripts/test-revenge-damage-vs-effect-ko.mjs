// v5.926 復仇家族「因招式的傷害而昏厥」只算傷害KO,不算效果KO(放/移指示物/直接昏厥)
//  負向:胡地手之力量(效果放指示物KO)→復仇刀鋒 +0  |  正向:肯泰羅角撞(傷害KO)→復仇刀鋒 +60
//  HEAD-FAIL:修前效果KO也進 attack bucket→負向會出現+60(FAIL)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.rd-s.js'),E=join(ROOT,'.rd-e.ts'),O=join(ROOT,'.rd-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const ALA='14058',UXIE='11228',TAURO='18375',KAD='14056',TETSU='10254',GRASS='13128',PSY='11177',FILL='14319';
let nn=0;const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
function run(oppActive, oppEnergy, oppAtkIdx, myActivePre){
  const s0=createGame({name:'P0',entries:[{cardId:oppActive,count:1}]},{name:'P1',entries:[{cardId:TETSU,count:1}]},pool);
  const st={...s0,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:3,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s0.players[0],hand:Array.from({length:6},()=>inst(FILL)),deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[],active:inst(oppActive,{energyAttached:oppEnergy.map(e=>inst(e))})},
             {...s0.players[1],hand:[],deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[inst(TETSU,{energyAttached:[inst(GRASS),inst(PSY),inst(PSY)]})],active:inst(KAD,{damage:myActivePre})}]};
  let r=applyAction(st,{type:'ATTACK',attackIndex:oppAtkIdx},pool);
  const koed=!r.players[1].active; // 補位前先記錄是否被KO
  if(koed){ r=applyAction(r,{type:'SEND_NEW_ACTIVE',iid:r.players[1].bench[0].iid,senderIdx:1},pool); }
  r=applyAction(r,{type:'END_TURN'},pool);
  r=applyAction(r,{type:'ATTACK',attackIndex:1},pool); // 鐵斑葉 復仇刀鋒 atk1
  const plus60=(r.log||[]).some(l=>String(l.message||l.text||l).includes('+60'));
  return {koed, plus60, myKOd:koed};
}
let pass=0,fail=0;const T=(n,c)=>{try{c();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// 負向:胡地手之力量(atk0 效果KO,手牌6→12指示物=120≥50)
T('效果KO(手之力量)→復仇刀鋒 不+60', ()=>{
  const r=run(ALA,[PSY,PSY],0,0);
  if(!r.myKOd) throw new Error('前置:我方未被KO');
  if(r.plus60) throw new Error('效果KO誤觸發復仇+60');
});
// 正向:肯泰羅角撞(atk0 30傷害),我方KAD HP50 預傷40→70≥50 傷害KO
T('傷害KO(肯泰羅角撞)→復仇刀鋒 +60', ()=>{
  const r=run(TAURO,[PSY],0,40);
  if(!r.myKOd) throw new Error('前置:我方未被傷害KO');
  if(!r.plus60) throw new Error('傷害KO應觸發復仇+60卻沒有');
});
T('效果KO(由克希痛楚記憶放指示物)→復仇刀鋒 不+60', ()=>{
  const r=run(UXIE,[PSY],0,40); // KAD HP50 預傷40 +20指示物=60≥50 效果KO
  if(!r.myKOd) throw new Error('前置:我方未被效果KO');
  if(r.plus60) throw new Error('痛楚記憶效果KO誤觸發復仇+60(6789/6827漏改)');
});
console.log(`\n=== 復仇 damage-vs-effect KO: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
