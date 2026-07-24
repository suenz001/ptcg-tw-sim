// v6.012（Fable P1-1 批1）:中央 selection filter 求值器 selection-filter.ts 的行為等價守衛。
//   對全現役卡池,逐卡驗 evaluateSelectionFilter('deck-search', F, ...) === 獨立 golden 定義(UI canonical
//   語義)。+ 邊界卡斷言(基本能量 pokemonType=null→DistinctTypes true、特殊能量→BasicXxx false、ex stage
//   雙軌、MegaEx 名前綴、unknown filter→null)。批1 零 consumer,此為模組正確性單元測試。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sf-s.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.sf-e.ts'); const O=join(ROOT,'.sf-o.mjs');
writeFileSync(E,"export { evaluateSelectionFilter, isKnownSelectionFilter, sanitizeSelectionSet } from './src/lib/game/selection-filter';\nexport { isBasicPokemonCard, isRulePokemon, getBasicEnergyType } from './src/lib/game/engine';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const { evaluateSelectionFilter:ev, isKnownSelectionFilter:known, sanitizeSelectionSet:sanSet, isBasicPokemonCard, isRulePokemon, getBasicEnergyType }=M;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const cards=[];
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)cards.push(c);}
const P='Pokemon',En='Energy',Tr='Trainer';
// 獨立 golden 定義(逐字對齊 +page.svelte UI canonical)
const GOLDEN={
  'Basic': c=>isBasicPokemonCard(c),
  'Basic:HP70': c=>isBasicPokemonCard(c)&&(c.hp??0)<=70,
  'BasicNonRule': c=>isBasicPokemonCard(c)&&!isRulePokemon(c),
  'PokemonNonRule': c=>c.supertype===P&&!isRulePokemon(c),
  'Stage1': c=>c.supertype===P&&(c.stage??c.subtype)==='Stage1',
  'Stage2': c=>c.supertype===P&&(c.stage??c.subtype)==='Stage2',
  'PsychicBasic': c=>c.supertype===P&&!c.evolvesFrom&&c.pokemonType==='Psychic',
  'Resistance:Fighting': c=>c.supertype===P&&c.resistance?.type==='Fighting',
  'ex': c=>c.supertype===P&&c.subtype==='ex',
  'MegaEx': c=>c.supertype===P&&c.subtype==='ex'&&c.name.startsWith('超級'),
  'TeraPokemon': c=>c.supertype===P&&!!c.tags?.includes('太晶'),
  'ColorlessPokeHP100': c=>c.supertype===P&&c.pokemonType==='Colorless'&&(c.hp??999)<=100,
  'Energy': c=>c.supertype===En,
  'BasicEnergy': c=>c.supertype===En&&c.subtype==='Basic',
  'BasicEnergy:DistinctTypes': c=>c.supertype===En&&c.subtype==='Basic'&&!!getBasicEnergyType(c),
  'Item': c=>c.supertype===Tr&&c.subtype==='Item',
  'Supporter': c=>c.supertype===Tr&&c.subtype==='Supporter',
  'Tool': c=>c.supertype===Tr&&c.subtype==='PokemonTool',
  'PokemonTool': c=>c.supertype===Tr&&c.subtype==='PokemonTool',
  'Stadium': c=>c.supertype===Tr&&c.subtype==='Stadium',
  'Trainer': c=>c.supertype===Tr,
  'AnyTrainer': c=>c.supertype===Tr,
  'CynthiaPokemon': c=>c.supertype===P&&c.name.includes('竹蘭的'),
  'MarniePokemon': c=>c.supertype===P&&c.name.startsWith('瑪俐的'),
  'ErikaPokemon': c=>c.supertype===P&&c.name.startsWith('莉佳的'),
  'RocketSupporter': c=>c.supertype===Tr&&c.subtype==='Supporter'&&c.name.includes('火箭隊'),
  'RocketBasic': c=>c.supertype===P&&!c.evolvesFrom&&c.name.includes('火箭隊的'),
};
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('全 26 predicate 對全卡池逐卡與 golden 等價',()=>{
  let checked=0,covered=0;
  for(const [f,g] of Object.entries(GOLDEN)){
    assert.ok(known('deck-search',f),`${f} 應被收錄`);
    let posSeen=false;
    for(const c of cards){
      const got=ev('deck-search',f,{iid:'x'},c,{});
      const want=g(c);
      assert.equal(got,want,`filter '${f}' 卡 ${c.id}(${c.name}) evaluator=${got} golden=${want}`);
      if(want)posSeen=true; checked++;
    }
    if(posSeen)covered++;
  }
  console.log('   逐卡比對',checked,'次全等價;有正例的 filter',covered+'/'+Object.keys(GOLDEN).length);
});

T('邊界:基本能量 pokemonType=null → DistinctTypes/BasicEnergy true;特殊能量 → false',()=>{
  const basicE=cards.find(c=>c.supertype===En&&c.subtype==='Basic');
  assert.ok(basicE,'應有基本能量'); assert.equal(basicE.pokemonType??null,null,'基本能量 pokemonType 應 null');
  assert.equal(ev('deck-search','BasicEnergy',{iid:'x'},basicE,{}),true);
  assert.equal(ev('deck-search','BasicEnergy:DistinctTypes',{iid:'x'},basicE,{}),true);
  const specialE=cards.find(c=>c.supertype===En&&c.subtype!=='Basic');
  if(specialE){ assert.equal(ev('deck-search','BasicEnergy',{iid:'x'},specialE,{}),false,'特殊能量不算基本能量');
    assert.equal(ev('deck-search','BasicEnergy:DistinctTypes',{iid:'x'},specialE,{}),false); }
});

T('DistinctTypes excludeEnergyTypes:排除已選屬性',()=>{
  const fireE=cards.find(c=>c.supertype===En&&c.subtype==='Basic'&&getBasicEnergyType(c)==='Fire');
  assert.ok(fireE,'應有基本火能量');
  assert.equal(ev('deck-search','BasicEnergy:DistinctTypes',{iid:'x'},fireE,{excludeEnergyTypes:new Set(['Fire'])}),false,'已選火→火被排除');
  assert.equal(ev('deck-search','BasicEnergy:DistinctTypes',{iid:'x'},fireE,{excludeEnergyTypes:new Set(['Water'])}),true,'已選水→火仍可選');
});

T('sanitizeSelectionSet DistinctTypes:同屬性只留首見',()=>{
  const pool=new Map(cards.map(c=>[String(c.id),c]));
  const F=cards.find(c=>c.supertype===En&&c.subtype==='Basic'&&getBasicEnergyType(c)==='Fire');
  const W=cards.find(c=>c.supertype===En&&c.subtype==='Basic'&&getBasicEnergyType(c)==='Water');
  const insts=[{iid:'a',cardId:String(F.id)},{iid:'b',cardId:String(F.id)},{iid:'c',cardId:String(W.id)}];
  const out=sanSet('deck-search','BasicEnergy:DistinctTypes',insts,pool);
  assert.deepEqual(out,['a','c'],'火首見留a、火重複b濾、水留c');
});

T('unknown filter(批1未收錄)→ null(caller fallback)',()=>{
  assert.equal(ev('deck-search','TOP6',{iid:'x'},cards[0],{}),null);
  assert.equal(ev('deck-search','',{iid:'x'},cards[0],{}),null);
  assert.equal(ev('deck-search','Evolution',{iid:'x'},cards[0],{}),null,'Evolution(validIids交集)批2才收');
  assert.equal(ev('hand-discard','BasicEnergy',{iid:'x'},cards[0],{}),null,'hand-discard 批4才收');
  assert.equal(known('deck-search','TOP6'),false);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
