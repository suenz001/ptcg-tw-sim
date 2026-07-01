/** v5.821 謝米|親送花朵:從牌庫選「任意能量卡」(含特殊)附於備戰區【草】寶可夢。
 *  先前誤限基本草能量、目標未限草。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sm-s.js'),E=join(ROOT,'.sm-e.ts'),O=join(ROOT,'.sm-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const POKE='14443'/*含羞苞 草*/, LAP='14085'/*拉普拉斯ex 水*/, PRISM='14852'/*稜鏡能量 special*/, FIRE='14428'/*基本火*/;
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const mk=()=>{
  const prism=inst(PRISM,{iid:'e_prism'}), fire=inst(FIRE,{iid:'e_fire'});
  const gb=inst(POKE,{iid:'gb'}), wb=inst(LAP,{iid:'wb'});
  return {st:{phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(POKE,{iid:'act'}),bench:[gb,wb],hand:[],deck:[prism,fire],discard:[],prizes:[1]},
             {name:'P2',active:inst(LAP,{iid:'o'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]}};
};
T('★POST:validIids含特殊能量、benchTargets只草(gb)', () => {
  const {st}=mk();
  const r=mod.ATTACK_POST.get('謝米|親送花朵')(st,0,pool,{});
  const ps=r.pendingSelection;
  assert.ok(ps,'應開 deck-search');
  assert.ok(ps.params.validIids.includes('e_prism'),'特殊能量應可選(任意能量)');
  assert.ok(ps.params.validIids.includes('e_fire'),'基本火也可選');
  assert.deepStrictEqual(ps.params.benchTargets,['gb'],'目標只限草寶可夢 gb');
});
T('★選稜鏡(特殊)→附到草備戰 gb(唯一目標直接套)', () => {
  const {st}=mk();
  let s=mod.ATTACK_POST.get('謝米|親送花朵')(st,0,pool,{});
  s=mod.applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:['e_prism']},pool);
  const gb=s.players[0].bench.find(b=>b.iid==='gb');
  const wb=s.players[0].bench.find(b=>b.iid==='wb');
  assert.ok(gb.energyAttached.some(e=>e.iid==='e_prism'),'稜鏡應附到草寶可夢 gb');
  assert.strictEqual(wb.energyAttached.length,0,'水寶可夢不應被附加');
});
console.log('\n謝米親送花朵(v5.821):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
