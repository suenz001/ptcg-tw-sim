/** v5.811 name-based 每回合限1次特性(支配鎖鏈/音速搜索/裝酷重抽)補白名單。
 *  若該特性名已在 abilityNamesUsedThisTurn,則同名第二張的 USE_ABILITY 應被擋(特性不觸發)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.so-s.js'),E=join(ROOT,'.so-e.ts'),O=join(ROOT,'.so-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const PEACH='14137'/*桃歹郎ex 支配鎖鏈*/, POKE='14443';

T('★支配鎖鏈:該回合已使出過(abilityNamesUsedThisTurn)→第二張被擋(特性不觸發)', () => {
  const holder=inst(PEACH,{iid:'peach2'});
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:holder,bench:[inst(POKE,{iid:'b1'})],hand:[],deck:[],discard:[],prizes:[1],abilityNamesUsedThisTurn:['支配鎖鏈']},
             {name:'P2',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
  const before=(st.log||[]).length;
  const r=applyAction(st,{type:'USE_ABILITY',iid:'peach2',abilityIndex:0},pool);
  // 被擋:gate 在 effect fn 前 return state → 不開 pendingSelection、且不新增任何 log。
  // (HEAD 未列白名單 → 特性觸發 → 新增「使用特性」等 log,log 數量 > before。)
  assert.ok(r.pendingSelection==null, '不應開啟 pendingSelection(應被白名單擋下)');
  assert.strictEqual((r.log||[]).length, before, '被擋時不應新增任何 log(HEAD 會觸發而新增)');
});
console.log('\nname-based once/turn白名單(v5.811):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
