// v5.753:上場時特性(金屬之路)在對手暗夜羽擊時不可發動(tryPromptPromoteActive gate isAbilityHolderEffective)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.s-pa.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.e-pa.ts'); const O=join(ROOT,'.e-pa.mjs');
// import engine 觸發 effects 載入(setAbilityHolderEffectiveFn 注入)
writeFileSync(E,`import './src/lib/game/engine';export { tryPromptPromoteActive } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { tryPromptPromoteActive }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const COBAL='18482'; // 勾帕路翁ex 金屬之路
const FLUTTER='9803'; // 振翼髮 暗夜羽擊
const enMetal=(()=>{for(const[id,c]of pool)if(c.supertype==='Energy'&&/鋼|金屬|Metal/.test(c.name||''))return id; for(const[id,c]of pool)if(c.supertype==='Energy')return id;})();
const anyB=(()=>{for(const[id,c]of pool)if(c.supertype==='Pokemon'&&(c.subtype==='Basic'||c.stage==='Basic'))return id;})();
let pass=0,fail=0;const T=(n,f)=>{try{f();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function gs(oppActive){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,log:[],pendingSelection:null,
    players:[{name:'A',hand:[],deck:[],discard:[],prizes:[],bench:[inst(anyB,{energyAttached:[inst(enMetal)]})],active:inst(COBAL,{movedToActiveThisTurn:true})},
             {name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:oppActive}]};
}
T('對手振翼髮暗夜羽擊→勾帕路翁ex金屬之路上場不提示(被消除)',()=>{
  const st=gs(inst(FLUTTER));
  const r=tryPromptPromoteActive(st, 0, pool);
  assert.ok(!r.pendingSelection,'應不提示金屬之路,實際='+(r.pendingSelection?.effectKey??r.pendingSelection?.type));
});
T('對照:對手非振翼髮→金屬之路上場正常提示',()=>{
  const st=gs(inst(anyB));
  const r=tryPromptPromoteActive(st, 0, pool);
  assert.ok(r.pendingSelection,'無消除時應提示金屬之路');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);process.exit(fail?1:0);
