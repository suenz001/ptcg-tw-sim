// v6.013（P1-1 批2）:ai.ts deck-search 接中央 selection-filter 求值器,修掉 Fable 盤點的 AI 真漂移:
//   ①`Pokemon:NamePrefix=X`/`Pokemon:NameContains=X` 在 ai.ts 是死碼——generic `f.startsWith('Pokemon:')`
//     排在前面,把它們當「屬性=NamePrefix=X」比對恒 false → AI 候選全空(選不到任何寶可夢)。
//   ②`GrassBasicOrGrassEnergy` ai.ts 殘留 `!card.evolvesFrom`(UI 已按 Bug#20 移除)→ 進化階段草寶可夢
//     被 AI 誤排除。中央求值器優先 → 兩者修正。
//   HEAD:①AI 對 Pokemon:NamePrefix= 候選空 → 選不到;修後選到符合前綴的寶可夢。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.afd-s.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.afd-e.ts'); const O=join(ROOT,'.afd-o.mjs');
writeFileSync(E,"export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { getAIAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const findCard=(pred)=>{for(const[id,c]of pool)if(pred(c))return c;return null;};
const marnie=findCard(c=>c.supertype==='Pokemon'&&c.name.startsWith('瑪俐的')); // 具名前綴寶可夢
const evolvedGrass=findCard(c=>c.supertype==='Pokemon'&&c.pokemonType==='Grass'&&c.evolvesFrom); // 進化草寶可夢
const BASICPOKE=findCard(c=>c.supertype==='Pokemon'&&!c.evolvesFrom&&c.subtype!=='ex'&&c.pokemonType!=='Grass');
let nn=0;const inst=(cid)=>({iid:'d'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function mkDeckSearch(filter, deckCards){
  const deck=deckCards.map(c=>inst(c.id));
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
    setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],
    pendingSelection:{type:'deck-search',actorIdx:0,sourcePlayerIdx:0,filter,minCount:1,maxCount:1,effectKey:'x-generic',params:{}},
    players:[{name:'AI',active:inst(BASICPOKE.id),bench:[],hand:[],deck,discard:[],prizes:[1,1,1,1,1,1]},
             {name:'P2',active:inst(BASICPOKE.id),bench:[],hand:[],deck:[inst(BASICPOKE.id)],discard:[],prizes:[1,1,1,1,1,1]}]};
  const act=getAIAction(st,pool,0);
  const sel=(act&&act.selectedIids)||[];
  return sel.map(i=>{const d=deck.find(c=>c.iid===i);return pool.get(d?.cardId);});
}

T("Pokemon:NamePrefix=瑪俐的:AI 從[非瑪俐寶可夢×2,瑪俐的寶可夢×1]應選瑪俐的(HEAD 死碼→候選空選不到)",()=>{
  assert.ok(marnie,'應有瑪俐的寶可夢');
  const picked=mkDeckSearch('Pokemon:NamePrefix=瑪俐的',[BASICPOKE,BASICPOKE,marnie]);
  console.log('   選到:',picked.map(c=>c?.name));
  assert.equal(picked.length,1,'應選1張(HEAD ai 死碼→候選空→length 0)');
  assert.ok(picked[0]?.name.startsWith('瑪俐的'),'應選瑪俐的寶可夢,實際='+picked[0]?.name);
});

T("GrassBasicOrGrassEnergy:AI 應能選到進化階段草寶可夢(HEAD ai 殘留 !evolvesFrom→排除)",()=>{
  if(!evolvedGrass){ console.log('   (無進化草寶可夢可測,略過)'); return; }
  const picked=mkDeckSearch('GrassBasicOrGrassEnergy',[BASICPOKE,evolvedGrass]);
  console.log('   選到:',picked.map(c=>c?.name+'/'+(c?.evolvesFrom?'進化':'基礎')));
  assert.ok(picked.some(c=>c?.id===evolvedGrass.id)||picked[0]?.pokemonType==='Grass','應可選到進化草寶可夢(HEAD !evolvesFrom 排除)');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
