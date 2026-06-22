// applyWeakRes 中央弱點/抵抗力(effective types):雙屬性/弱點失效/抵抗力收斂 — v5.673
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.wr-s.mjs'),E=join(ROOT,'.wr-e.ts'),O=join(ROOT,'.wr-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { createGame } from './src/lib/game/engine';\nexport { applyWeakRes } from './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyWeakRes } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const XIAO='16871'/*小碎鑽 雙屬性 鬥+超*/, WEAKFIGHT='14465'/*土龍節節 弱鬥*/, WEAKPSY='17975'/*超級艾路雷朵ex 弱超*/, RESFIGHT='17974'/*胡地 抗鬥-30*/;
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
function stWith(attCid){
  const s=createGame({name:'P1',entries:[{cardId:attCid,count:1}]},{name:'P2',entries:[{cardId:WEAKFIGHT,count:1}]},pool);
  return {...s,players:[{...s.players[0],active:inst(attCid)},{...s.players[1]}]};
}
const tgt=(cid,x={})=>{const t=inst(cid,x); return {t, card:pool.get(cid)};};
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('baseline:小碎鑽(鬥)打弱鬥 → ×2 (50→100)', () => {
  const {t,card}=tgt(WEAKFIGHT);
  assert.equal(applyWeakRes(stWith(XIAO),0,t,card,50,pool),100);
});
T('★弱點失效:打弱鬥+weaknessDisabledThisTurn → 不×2 (50)', () => {
  const {t,card}=tgt(WEAKFIGHT,{weaknessDisabledThisTurn:true});
  assert.equal(applyWeakRes(stWith(XIAO),0,t,card,50,pool),50);
});
T('★雙屬性:小碎鑽(鬥+超)打弱超 → ×2 (50→100) [raw pokemonType=鬥 會漏]', () => {
  const {t,card}=tgt(WEAKPSY);
  assert.equal(applyWeakRes(stWith(XIAO),0,t,card,50,pool),100);
});
T('抵抗力:小碎鑽(鬥)打抗鬥-30 → 80-30=50', () => {
  const {t,card}=tgt(RESFIGHT);
  assert.equal(applyWeakRes(stWith(XIAO),0,t,card,80,pool),50);
});
T('掌握弱點override:打土龍節節但 weaknessOverrideThisTurn=超 + 小碎鑽含超 → ×2', () => {
  const {t,card}=tgt(WEAKFIGHT,{weaknessOverrideTypeThisTurn:'Psychic'});
  assert.equal(applyWeakRes(stWith(XIAO),0,t,card,50,pool),100);
});

console.log('\napplyWeakRes 中央弱抗:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
