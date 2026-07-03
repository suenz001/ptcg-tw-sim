import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-paths.js'),E=join(ROOT,'.ent-t2.ts'),O=join(ROOT,'.ent-t2.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { createGame, applyAction } from './src/lib/game/engine';\nexport { resolveBenchGuard } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod = await import(pathToFileURL(O).href);
const { createGame, applyAction, resolveBenchGuard } = mod;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...e});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

const FEATHER='17128'; // 陳舊的羽毛化石
const s=createGame({name:'P1',entries:[{cardId:'14086',count:1}]},{name:'P2',entries:[{cardId:'14086',count:1}]},pool);
const st={ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, players:[
  { ...s.players[0], active:inst('14086') },
  { ...s.players[1], active:inst('14086'), bench:[inst(FEATHER,{fossilOnField:true})] },
]};
const featherCard=pool.get(FEATHER);
T('羽毛化石(備戰) attack-damage → 擋(免傷,卡面「不會受到招式的傷害」)', ()=>{
  const r=resolveBenchGuard(st,pool,0,featherCard,'attack-damage');
  assert.equal(r.blocked,true,'attack-damage 應被擋');
});
T('羽毛化石(備戰) attack-effect(放指示物/狀態) → 不擋(卡面只寫傷害) [HEAD FAIL:HEAD擋]', ()=>{
  const r=resolveBenchGuard(st,pool,0,featherCard,'attack-effect');
  assert.equal(r.blocked,false,'attack-effect 不應被擋(來悲粗茶抹茶旋濺放指示物應生效)');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`); process.exit(fail?1:0);
