// v6.011（Fable P1-2）:基本能量屬性資料契約。現役全部基本能量卡(supertype Energy + subtype Basic)
//   的屬性都要能被 getBasicEnergyType 判定(pokemonType 或卡名【X】推)。這把「基本能量屬性判定」
//   鎖在資料層——未來新收能量卡命名異常(如漏【X】、用怪字)→契約測試立刻紅,不會等到玩家「選不到」
//   才發現(v6.008 稜鏡充能事故的資料級守衛)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.be-s.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.be-e.ts'); const O=join(ROOT,'.be-o.mjs');
writeFileSync(E,"export { getBasicEnergyType } from './src/lib/game/engine';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { getBasicEnergyType }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const VALID=new Set(['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Fairy','Dragon']);
let total=0,bad=[];
for(const f of readdirSync(dir)){
  if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){
    if(!(c&&c.supertype==='Energy'&&c.subtype==='Basic'))continue;
    total++;
    const t=getBasicEnergyType(c);
    if(!t||!VALID.has(t)) bad.push({id:c.id,name:c.name,set:c.setCode,type:t});
  }
}
console.log('現役基本能量卡:',total,'| getBasicEnergyType 判不出:',bad.length);
if(bad.length) bad.slice(0,15).forEach(b=>console.log('  ❌',b.id,b.name,b.set,'→',b.type));
assert.ok(total>=8,'應至少涵蓋 8 種基本能量,實際 total='+total);
assert.equal(bad.length,0,'所有現役基本能量卡屬性都須可由 getBasicEnergyType 判定(卡名【X】或pokemonType);判不出='+bad.length);
// 涵蓋度:8 種常見屬性(草火水雷超鬥惡鋼)至少各有一張
const covered=new Set();
for(const f of readdirSync(dir)){
  if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){
    if(c&&c.supertype==='Energy'&&c.subtype==='Basic'){const t=getBasicEnergyType(c);if(t)covered.add(t);}
  }
}
for(const need of ['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal']){
  assert.ok(covered.has(need),'應有基本【'+need+'】能量,covered='+[...covered].join(','));
}
console.log('基本能量屬性資料契約:PASS（'+total+' 張全可判定，屬性涵蓋 '+[...covered].sort().join('/')+'）');
process.exit(0);
