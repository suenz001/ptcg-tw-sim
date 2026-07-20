// v5.996 HEAD-FAIL 守衛:opp-bench-choose 的 filter 欄被 UI/AI 忽略 → helper 須改用 validIids。
//   閃電急襲(限ex)/嗡嗡榍石(限基礎)否則可打非ex/非基礎備戰。HEAD 無 validIids → 本檔 FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.bf-s.js'),E=join(ROOT,'.bf-e.ts'),O=join(ROOT,'.bf-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const ZERAORA='14715',ALOLA_EGGEX='17008',EEVEE_EX='19383',CHIKORITA='14084',FLORAGATO='19379',LIGHTNING='11176';
let n=0;
const inst=(cid,e=[])=>({iid:'i'+(++n),cardId:String(cid),damage:0,energyAttached:e,toolAttached:null});
const en=(cid)=>({iid:'e'+(++n),cardId:String(cid)});
const mk=(a0,b0,a1,b1)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'A',active:a0,bench:b0,hand:[],deck:[],discard:[],prizes:[]},{name:'B',active:a1,bench:b1,hand:[],deck:[],discard:[],prizes:[]}]});
let pass=0,fail=0; const T=(nm,f)=>{try{f();console.log('PASS',nm);pass++}catch(e){console.log('FAIL',nm,'::',e.message);fail++}};

// 閃電急襲:限【ex】
T('閃電急襲:opp備戰[ex,非ex]→validIids僅ex', () => {
  const eevee=inst(EEVEE_EX), chiko=inst(CHIKORITA);
  const st=mk(inst(ZERAORA,[en(LIGHTNING),en(LIGHTNING),en(LIGHTNING)]),[],inst(CHIKORITA),[eevee,chiko]);
  const s=ATTACK_POST.get('捷拉奧拉|閃電急襲')(st,0,pool,{});
  assert.equal(s.pendingSelection?.type,'opp-bench-choose','應開opp-bench-choose');
  const vi=s.pendingSelection?.params?.validIids??[];
  assert.deepEqual(vi,[eevee.iid],'validIids應僅ex(伊布ex),排除菊草葉');
});
T('閃電急襲:opp備戰全非ex→不開picker', () => {
  const st=mk(inst(ZERAORA,[en(LIGHTNING),en(LIGHTNING),en(LIGHTNING)]),[],inst(CHIKORITA),[inst(CHIKORITA),inst(FLORAGATO)]);
  const s=ATTACK_POST.get('捷拉奧拉|閃電急襲')(st,0,pool,{});
  assert.ok(s.pendingSelection==null,'全非ex應不開picker');
});
// 嗡嗡榍石:反面限基礎
T('嗡嗡榍石:反面 opp備戰[基礎,一階]→validIids僅基礎', () => {
  const chiko=inst(CHIKORITA), flora=inst(FLORAGATO);
  const st=mk(inst(ALOLA_EGGEX),[],inst(FLORAGATO),[chiko,flora]);
  st._retryInjectedFlipsQueue=['反面'];
  const s=ATTACK_POST.get('阿羅拉 椰蛋樹ex|嗡嗡榍石')(st,0,pool,{});
  assert.equal(s.pendingSelection?.type,'opp-bench-choose','反面應開opp-bench-choose');
  const vi=s.pendingSelection?.params?.validIids??[];
  assert.deepEqual(vi,[chiko.iid],'validIids應僅基礎(菊草葉),排除蒂蕾喵一階');
});
console.log(`\nopp-bench-choose filter→validIids 守衛：PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
