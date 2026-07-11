// v5.928 ①浸蝕污泥卡面「全部丟棄」(非昏厥)→我方END_TURN丟棄,對手不獲獎賞
//        ②一力反攻「阿響的寶可夢因傷害昏厥」→只計阿響家族(非阿響KO不觸發)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.sd-s.js'),E=join(ROOT,'.sd-e.ts'),O=join(ROOT,'.sd-o.mjs');
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
const MUK='12817',KAROSU='14661',SUDOWOODO='12699',KAD='14056',TAURO='18375',DARK='14152',PSY='11177',GRASS='13128',FILL='14319';
let nn=0;const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
function baseState(p0active,p0energy,p1active,p1bench){
  const s0=createGame({name:'P0',entries:[{cardId:p0active,count:1}]},{name:'P1',entries:[{cardId:p1active,count:1}]},pool);
  return {...s0,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:3,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s0.players[0],hand:[],deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[],active:inst(p0active,{energyAttached:p0energy.map(e=>inst(e))})},
             {...s0.players[1],hand:[],deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:p1bench,active:p1active}]};
}
let pass=0,fail=0;const T=(n,c)=>{try{c();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

// ① 浸蝕污泥:對手臭泥用招→我方END_TURN丟棄active,對手不獲獎賞
T('浸蝕污泥→我方END_TURN丟棄active,對手不獲獎賞', ()=>{
  const myActive=inst(KAD);
  let r=baseState(MUK,[DARK,PSY],'x',[inst(KAD)]); // bench 一隻備戰,丟棄後可補位
  r={...r,players:[r.players[0],{...r.players[1],active:myActive}]};
  r=applyAction(r,{type:'ATTACK',attackIndex:0},pool); // 浸蝕污泥(atk0,傷害0,設丟棄旗標)
  r=applyAction(r,{type:'END_TURN'},pool); // P0結束→我方回合
  r=applyAction(r,{type:'END_TURN'},pool); // 我方END_TURN→丟棄旗標消費
  const inDiscard = r.players[1].discard.some(c=>c.iid===myActive.iid);
  const p0PrizeLeft = r.players[0].prizes.length; // 昏厥會讓對手扣獎賞(6→5);純丟棄應維持6
  if(!inDiscard) throw new Error('我方active未被丟棄到棄牌區');
  if(p0PrizeLeft!==6) throw new Error('對手不該拿獎賞卻 prizes.length='+p0PrizeLeft+'(丟棄≠昏厥,應維持6)');
});
// ② 一力反攻 negative:非阿響(凱西)被傷害KO→不+100
T('非阿響寶可夢被傷害KO→一力反攻不+100', ()=>{
  let r=baseState(TAURO,[PSY],KAD,[inst(KAROSU,{energyAttached:[inst(PSY),inst(PSY),inst(PSY)]})]);
  r={...r,players:[r.players[0],{...r.players[1],active:inst(KAD,{damage:40})}]}; // KAD HP50 預傷40
  r=applyAction(r,{type:'ATTACK',attackIndex:0},pool); // 肯泰羅角撞30→KAD KO
  if(r.players[1].active) throw new Error('前置:KAD未被KO');
  r=applyAction(r,{type:'SEND_NEW_ACTIVE',iid:r.players[1].bench[0].iid,senderIdx:1},pool); // 補位阿響凱羅斯
  r=applyAction(r,{type:'END_TURN'},pool);
  r=applyAction(r,{type:'ATTACK',attackIndex:1},pool); // 一力反攻
  const plus100=(r.log||[]).some(l=>String(l.message||l.text||l).includes('+100'));
  if(plus100) throw new Error('非阿響KO誤觸發一力反攻+100');
});
// ③ 一力反攻 positive:阿響的樹才怪被傷害KO→+100
T('阿響的寶可夢被傷害KO→一力反攻+100', ()=>{
  let r=baseState(TAURO,[PSY],SUDOWOODO,[inst(KAROSU,{energyAttached:[inst(PSY),inst(PSY),inst(PSY)]})]);
  r={...r,players:[r.players[0],{...r.players[1],active:inst(SUDOWOODO,{damage:90})}]}; // 樹才怪HP110 預傷90
  r=applyAction(r,{type:'ATTACK',attackIndex:0},pool); // 角撞30→樹才怪120≥110 KO
  if(r.players[1].active) throw new Error('前置:阿響樹才怪未被KO');
  r=applyAction(r,{type:'SEND_NEW_ACTIVE',iid:r.players[1].bench[0].iid,senderIdx:1},pool);
  r=applyAction(r,{type:'END_TURN'},pool);
  r=applyAction(r,{type:'ATTACK',attackIndex:1},pool);
  const plus100=(r.log||[]).some(l=>String(l.message||l.text||l).includes('+100'));
  if(!plus100) throw new Error('阿響KO應觸發一力反攻+100卻沒有');
});
console.log(`\n=== 浸蝕污泥丟棄 + 一力反攻阿響過濾: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
