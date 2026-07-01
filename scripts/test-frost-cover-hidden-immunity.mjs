// v5.829 驗證：N的雙倍多多冰|覆雪 = 放置傷害指示物(招式效果)使對手所有寶可夢指示物變2倍，
//   化隱等免疫者不被放置(原直接 *2 漏 gate)。收斂走中央 applyDamageToAllOpp(per-target amount)。
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
const FUSUI='14699', HIDDEN='19176'/*詛咒娃娃 化隱 HP80*/, PLAIN='14085'/*拉普拉斯ex HP210*/;
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function run(){
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[
      {name:'A',active:inst(FUSUI),bench:[],hand:[],deck:[],discard:[],prizes:[]},
      {name:'B',active:inst(HIDDEN,{damage:30}),bench:[inst(PLAIN,{damage:30})],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst(PLAIN))},
    ]};
  return mod.ATTACK_POST.get('N的雙倍多多冰|覆雪')(st,0,pool);
}
T('覆雪：化隱對手戰鬥位不被放置(指示物維持30)；一般備戰倍化(30→60)',()=>{
  const r=run();
  assert(r.players[1].active,'化隱寶可夢應存活');
  assert.equal(r.players[1].active.damage,30,'化隱 active 指示物應維持 30(不被放置),實際 '+r.players[1].active.damage);
  const bench=r.players[1].bench[0];
  assert(bench,'一般備戰應存活');
  assert.equal(bench.damage,60,'一般備戰應倍化 30→60,實際 '+bench.damage);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
