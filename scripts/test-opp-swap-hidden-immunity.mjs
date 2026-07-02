// v5.837 驗證:inline 換位(強制換位/gust)招式須對齊中央 forceOppSwapPost/oppSwapDmgPost 的
//   免疫 gate — 化隱/純樸等免疫招式效果的對手 active 不被換位(v5.388/v5.333 既定規則)。
//   駒刀小兵|推倒(v2401)/巨金怪|彈回(effects)/流氓熊貓|拉扯(v2750 gust)/沙河馬|推倒(v2750)。
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
const HIDDEN='19176'/*詛咒娃娃 化隱*/, PLAIN='14086'/*願增猿*/, ATK='14085';
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function st(defActiveId){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'A',active:inst(ATK),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'B',active:inst(defActiveId),bench:[inst(PLAIN)],hand:[],deck:[],discard:[],prizes:[]}]};
}
for(const key of ['駒刀小兵|推倒','巨金怪|彈回','流氓熊貓|拉扯','沙河馬|推倒']){
  T(`${key}: 化隱 active → 不開換位 picker(不被換位)`,()=>{
    const r=mod.ATTACK_POST.get(key)(st(HIDDEN),0,pool);
    assert(!r.pendingSelection,'化隱 active 不應開換位 picker,實際 pendingSelection='+JSON.stringify(r.pendingSelection?.effectKey));
    assert.equal(r.players[1].active.cardId,HIDDEN,'化隱 active 應維持不變');
  });
}
T('對照:一般 active → 正常開換位 picker',()=>{
  const r=mod.ATTACK_POST.get('駒刀小兵|推倒')(st(PLAIN),0,pool);
  assert(r.pendingSelection,'一般 active 應正常開 picker');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
