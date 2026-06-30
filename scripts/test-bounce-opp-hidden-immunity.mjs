/** v5.809 bounce 對手寶可夢受化隱免疫(招式效果);奇異時鐘等物品不受此測。
 *  化隱寶可夢(斯魔茶)被選中放回時不應被放回(留場上)。直接驅動 4 個 bounce resolver。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.bo-s.js'),E=join(ROOT,'.bo-e.ts'),O=join(ROOT,'.bo-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='14443', HIDDEN='19149'/*斯魔茶 Basic 化隱*/;
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// 通用:player0 active=POKE; player1(對手) bench 自訂; pending 由 caller 設
const base=(oppBench, pend)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
  pendingSelection: pend,
  players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:inst(POKE,{iid:'oppAct'}),bench:oppBench,hand:[],deck:[inst(POKE)],discard:[],prizes:[1]}]});
const benchHidden=()=>inst(HIDDEN,{iid:'hidBench'});

T('★慢芬香/奧密迴旋(h-wave2-bounce-opp-bench):化隱備戰不被放回', () => {
  const h=benchHidden();
  let st=base([h], {type:'opp-bench-choose',actorIdx:0,sourcePlayerIdx:1,minCount:1,maxCount:1,effectKey:'h-wave2-bounce-opp-bench'});
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['hidBench']},pool);
  assert.ok(st.players[1].bench.some(b=>b.iid==='hidBench'), '化隱應留在備戰(不被放回)');
});
T('★天仙石(sylveon):選化隱+一般→化隱留、一般放回', () => {
  const h=benchHidden(); const n=inst(POKE,{iid:'normalBench'});
  let st=base([h,n], {type:'opp-bench-choose',actorIdx:0,sourcePlayerIdx:1,minCount:2,maxCount:2,effectKey:'sylveon-skystone-bounce'});
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['hidBench','normalBench']},pool);
  assert.ok(st.players[1].bench.some(b=>b.iid==='hidBench'), '化隱應留');
  assert.ok(!st.players[1].bench.some(b=>b.iid==='normalBench'), '一般應被放回');
});
T('★陣風返(wave17-bounce-opp):化隱備戰不被放回', () => {
  const h=benchHidden();
  let st=base([h], {type:'opp-poke-choose',actorIdx:0,sourcePlayerIdx:1,minCount:1,maxCount:1,effectKey:'wave17-bounce-opp'});
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['hidBench']},pool);
  assert.ok(st.players[1].bench.some(b=>b.iid==='hidBench'), '化隱應留');
});
T('★驅趕龍捲風(non-selected):化隱未選也不被放回(強制留)', () => {
  // 對手 bench: 3 一般(選留) + 1 化隱(未選) → 化隱應留(免疫),其餘未選一般放回
  const k1=inst(POKE,{iid:'k1'}),k2=inst(POKE,{iid:'k2'}),k3=inst(POKE,{iid:'k3'}),h=benchHidden(),extra=inst(POKE,{iid:'extra'});
  let st=base([k1,k2,k3,h,extra], {type:'opp-bench-choose',actorIdx:0,sourcePlayerIdx:1,minCount:3,maxCount:3,effectKey:'h-wave2-bounce-non-selected'});
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['k1','k2','k3']},pool);
  assert.ok(st.players[1].bench.some(b=>b.iid==='hidBench'), '化隱未選也應留(免疫)');
  assert.ok(!st.players[1].bench.some(b=>b.iid==='extra'), '一般未選應被放回');
});
console.log('\nbounce對手化隱免疫(v5.809):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
