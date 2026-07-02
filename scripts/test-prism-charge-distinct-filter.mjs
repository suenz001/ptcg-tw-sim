// v5.836 驗證:太樂巴戈斯|稜鏡充能「各不同屬性的基本能量」須發出前端可辨識的 filter
//   'BasicEnergy:DistinctTypes'(冒號版,伊布|鮮豔捕捉同,前端動態排除已選屬性);
//   原 'BasicEnergyDistinctTypes'(無冒號)不被辨識→各不同屬性限制失效。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const TERAPAGOS='14804', TERA_PIKA='14704'/*皮卡丘ex 太晶*/, FIRE='14428';
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
T('稜鏡充能:發出 BasicEnergy:DistinctTypes filter(前端可辨識→各不同屬性生效)',()=>{
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'A',active:inst(TERAPAGOS),bench:[inst(TERA_PIKA)],hand:[],deck:[inst(FIRE),inst(FIRE),inst(FIRE)],discard:[],prizes:[]},
             {name:'B',active:inst(TERAPAGOS),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  const r=mod.ATTACK_POST.get('太樂巴戈斯|稜鏡充能')(st,0,pool);
  assert(r.pendingSelection,'應開 picker');
  assert.equal(r.pendingSelection.filter,'BasicEnergy:DistinctTypes','filter 應為冒號版,實際 '+r.pendingSelection.filter);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
