// v6.015（Fable P1-1 批4 Foundation）：中央 selection filter 求值器擴 hand-discard + discard-search
//   兩 zone 的行為等價守衛 + 收斂等價機械證明。
//   對全現役卡池，逐卡驗 evaluateSelectionFilter(zone, F, ...) === 獨立 golden（= UI inline canonical）。
//   關鍵收斂證明：
//     ① discard-search 'Basic'：evaluator 用 isBasicPokemonCard、golden 用 UI 手刻式
//        (Pokemon && !evolvesFrom && !Stage1/2) → 逐卡等價 ⇒ 收斂零行為變更（F6：現役無 Pokemon+Other）。
//     ② discard-search 'BasicEnergy:<T>'：evaluator 用 isBasicEnergyOfType、golden 用 UI 內嵌 zhMap → 逐卡等價。
//   + 資料契約哨兵：現役 DB 無 supertype=Pokemon+subtype=Other（'Basic' 收斂前提）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sfb4-s.js'); const E=join(ROOT,'.sfb4-e.ts'); const O=join(ROOT,'.sfb4-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { evaluateSelectionFilter, isKnownSelectionFilter } from './src/lib/game/selection-filter';\nexport { isBasicPokemonCard, getBasicEnergyType, isBasicEnergyOfType } from './src/lib/game/engine';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const { evaluateSelectionFilter:ev, isKnownSelectionFilter:known, isBasicPokemonCard, getBasicEnergyType, isBasicEnergyOfType }=M;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const cards=[];
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)cards.push(c);}
const P='Pokemon',En='Energy',Tr='Trainer';

// ---- golden（逐字對齊 UI inline canonical）----
const GOLDEN_HD={
  'Energy':              c=>c.supertype===En,
  'BasicEnergy':         c=>c.supertype===En&&c.subtype==='Basic',
  'BasicPsychicEnergy':  c=>c.supertype===En&&c.subtype==='Basic'&&c.name.includes('【超】'),
  'BasicFightingEnergy': c=>c.supertype===En&&c.subtype==='Basic'&&c.name.includes('【鬥】'),
  'Item':                c=>c.supertype===Tr&&c.subtype==='Item',
};
const GOLDEN_DS={
  'PokemonOrEnergy':      c=>c.supertype===P||c.supertype===En,
  'PokemonOrBasicEnergy': c=>c.supertype===P||(c.supertype===En&&c.subtype==='Basic'),
  'PokemonNonExOrBasicEnergy': c=>(c.supertype===P&&c.subtype!=='ex')||(c.supertype===En&&c.subtype==='Basic'),
  'WaterPokemonOrBasicWaterEnergy': c=>(c.supertype===P&&c.pokemonType==='Water')||(c.supertype===En&&c.subtype==='Basic'&&(c.pokemonType==='Water'||c.name.includes('【水】'))),
  'FightingPokemonOrBasicFightingEnergy': c=>(c.supertype===P&&c.pokemonType==='Fighting')||(c.supertype===En&&c.subtype==='Basic'&&c.name.includes('【鬥】')),
  'BasicEnergy':          c=>c.supertype===En&&c.subtype==='Basic',
  'BasicPsychicEnergy':   c=>c.supertype===En&&c.subtype==='Basic'&&c.name.includes('【超】'),
  'BasicFightingEnergy':  c=>c.supertype===En&&c.subtype==='Basic'&&c.name.includes('【鬥】'),
  'Energy':               c=>c.supertype===En,
  'Pokemon':              c=>c.supertype===P,
  // 'Basic' golden = UI 手刻式（證明 evaluator 的 isBasicPokemonCard 收斂等價）
  'Basic':                c=>c.supertype===P&&!c.evolvesFrom&&c.subtype!=='Stage1'&&c.subtype!=='Stage2',
  'Trainer':              c=>c.supertype===Tr,
  'Supporter':            c=>c.supertype===Tr&&c.subtype==='Supporter',
  'Item':                 c=>c.supertype===Tr&&c.subtype==='Item',
  'ColorlessPokeHP100':   c=>c.supertype===P&&c.pokemonType==='Colorless'&&(c.hp??999)<=100,
  'Any':                  ()=>true,
};
// discard-search BasicEnergy:<T> golden = UI 內嵌 zhMap（證明 evaluator 的 isBasicEnergyOfType 收斂等價）
const zhMap={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼',Dragon:'龍',Colorless:'無'};
const goldenDS_BasicEnergyT=(c,t)=>{ if(c.supertype!==En||c.subtype!=='Basic')return false; const zh=zhMap[t]; if(!zh)return false; if(c.pokemonType===t)return true; if(c.name.includes('【'+zh+'】'))return true; return false; };
const ALL_TYPES=['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Dragon','Colorless'];

let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('資料契約哨兵：現役 DB 無 supertype=Pokemon + subtype=Other（Basic 收斂前提）',()=>{
  const bad=cards.filter(c=>c.supertype===P&&c.subtype==='Other');
  assert.equal(bad.length,0,'發現 Pokemon+Other：'+bad.map(c=>c.id+'/'+c.name).join(','));
});

T('hand-discard predicate 逐卡與 golden 等價',()=>{
  let n=0;
  for(const [f,g] of Object.entries(GOLDEN_HD)){
    assert.ok(known('hand-discard',f),f+' 應被收錄');
    for(const c of cards){ assert.equal(ev('hand-discard',f,{iid:'x'},c,{}), g(c), `HD '${f}' 卡 ${c.id}(${c.name})`); n++; }
  }
  console.log('   hand-discard 逐卡',n,'次等價');
});

T('discard-search predicate 逐卡與 golden 等價（含 Basic 收斂 isBasicPokemonCard）',()=>{
  let n=0;
  for(const [f,g] of Object.entries(GOLDEN_DS)){
    assert.ok(known('discard-search',f),f+' 應被收錄');
    for(const c of cards){ assert.equal(ev('discard-search',f,{iid:'x'},c,{}), g(c), `DS '${f}' 卡 ${c.id}(${c.name})`); n++; }
  }
  console.log('   discard-search 逐卡',n,'次等價');
});

T('收斂證明：discard-search Basic evaluator(isBasicPokemonCard) === UI 手刻式，全卡池',()=>{
  for(const c of cards){
    const uiHand=c.supertype===P&&!c.evolvesFrom&&c.subtype!=='Stage1'&&c.subtype!=='Stage2';
    assert.equal(isBasicPokemonCard(c), uiHand, `Basic 收斂差異 卡 ${c.id}(${c.name}) isBasicPokemonCard=${isBasicPokemonCard(c)} 手刻=${uiHand}`);
  }
});

T('前綴 BasicEnergy:<T> / Energy:<T> 逐卡×10屬性等價（HD=isBasicEnergyOfType；DS=收斂 isBasicEnergyOfType===UI zhMap）',()=>{
  let n=0;
  for(const t of ALL_TYPES){
    for(const c of cards){
      // hand-discard：evaluator 與 golden 都 isBasicEnergyOfType（trivial，鎖回歸）
      assert.equal(ev('hand-discard','BasicEnergy:'+t,{iid:'x'},c,{}), isBasicEnergyOfType(c,t), `HD BasicEnergy:${t} ${c.id}`);
      assert.equal(ev('hand-discard','Energy:'+t,{iid:'x'},c,{}), isBasicEnergyOfType(c,t), `HD Energy:${t} ${c.id}`);
      // discard-search：evaluator(isBasicEnergyOfType) === UI zhMap golden（收斂證明）
      assert.equal(ev('discard-search','BasicEnergy:'+t,{iid:'x'},c,{}), goldenDS_BasicEnergyT(c,t), `DS BasicEnergy:${t} 收斂差異 ${c.id}(${c.name})`);
      assert.equal(ev('discard-search','Energy:'+t,{iid:'x'},c,{}), isBasicEnergyOfType(c,t), `DS Energy:${t} ${c.id}`);
      n+=4;
    }
  }
  console.log('   前綴能量規則逐卡×屬性',n,'次等價');
});

T('discard-search Pokemon:Types= / Pokemon:<T> 前綴（specific 先於 generic）',()=>{
  const poke=cards.find(c=>c.supertype===P&&c.pokemonType);
  const t=poke.pokemonType;
  for(const c of cards){
    // Pokemon:Types=A,B
    assert.equal(ev('discard-search','Pokemon:Types='+t+',Fire',{iid:'x'},c,{}), c.supertype===P&&c.pokemonType!=null&&new Set([t,'Fire']).has(c.pokemonType), 'Types= '+c.id);
    // Pokemon:<T>（generic，不可被 Types= 吃掉）
    assert.equal(ev('discard-search','Pokemon:'+t,{iid:'x'},c,{}), c.supertype===P&&c.pokemonType===t, 'Pokemon:<T> '+c.id);
  }
});

T('unknown filter → null（caller fallback）；hand-discard Pokemon 未收錄→null',()=>{
  assert.equal(ev('hand-discard','Pokemon',{iid:'x'},cards[0],{}),null,'hand-discard Pokemon 延後未收錄→null（維持現行 fallthrough）');
  assert.equal(ev('discard-search','ZZUnknown',{iid:'x'},cards[0],{}),null);
  assert.equal(known('hand-discard','Pokemon'),false);
  assert.equal(known('discard-search','ZZUnknown'),false);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
