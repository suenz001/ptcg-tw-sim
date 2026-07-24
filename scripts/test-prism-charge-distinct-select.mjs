// v6.008:太樂巴戈斯|稜鏡充能「從牌庫選最多3張各不同屬性的基本能量」在 UI/AI 端完全選不到——
//   現役 68 張基本能量卡 pokemonType 全為 null,但 DistinctTypes filter(UI +page.svelte)與 AI 去重
//   (ai.ts)都直接讀 card.pokemonType 判屬性 → 恒 null 全被濾掉,玩家「選不了基礎能量」。
//   中央收斂:engine 新增 getBasicEnergyType(pokemonType 或卡名【X】推),UI+AI 共用。
//   本測試用 AI 決策路徑(getAIAction)驗:稜鏡充能 deck-search 應選 3 張各不同屬性;HEAD 選 0 → FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.pc-s.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.pc-e.ts'); const O=join(ROOT,'.pc-o.mjs');
writeFileSync(E,"export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { getAIAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0;const inst=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
// 基本能量各屬性 id
const FIRE='14428',WATER='18519',GRASS='14102',LIGHT='18520',PSY='14103';
const typeOf=(cid)=>{const m=/【(.+?)】/.exec(pool.get(cid)?.name||'');return m?m[1]:'?';};
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('稜鏡充能 AI:牌庫多屬性基本能量 → 選3張各不同屬性(HEAD pokemonType=null→選0)',()=>{
  // 牌庫:火×2、水、草、雷(5張,4種屬性)
  const deck=[inst(FIRE),inst(FIRE),inst(WATER),inst(GRASS),inst(LIGHT)];
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
    setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],
    pendingSelection:{type:'deck-search',actorIdx:0,sourcePlayerIdx:0,filter:'BasicEnergy:DistinctTypes',minCount:0,maxCount:3,effectKey:'v311-deck-energy-to-tagged-stage1',params:{}},
    players:[{name:'AI',active:inst(PSY),bench:[],hand:[],deck,discard:[],prizes:[1,1,1,1,1,1]},
             {name:'P2',active:inst(PSY),bench:[],hand:[],deck:[inst(PSY)],discard:[],prizes:[1,1,1,1,1,1]}]};
  const act=getAIAction(st,pool,0);
  console.log('   AI action:',act?.type,'selected:',(act?.selectedIids||[]).map(i=>{const d=deck.find(c=>c.iid===i);return typeOf(d?.cardId);}));
  assert.equal(act?.type,'RESOLVE_SELECTION','應回 RESOLVE_SELECTION');
  const sel=act.selectedIids||[];
  assert.equal(sel.length,3,'應選 3 張(min(max3,4種屬性)),HEAD 因 pokemonType=null 選 0');
  // 3 張屬性互異
  const types=sel.map(i=>typeOf(deck.find(c=>c.iid===i)?.cardId));
  assert.equal(new Set(types).size,3,'3 張須各不同屬性,實得='+types.join(','));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
