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

const MISMAGIUS='14354'; // 夢妖魔ex 漩渦言靈
const RUSH='17117';       // 急進開關
let energy=null; for(const[id,c]of pool){ if(c.supertype==='Energy'&&c.subtype==='Basic'){energy=id;break;} }
const s=createGame({name:'P1',entries:[{cardId:'14086',count:1}]},{name:'P2',entries:[{cardId:'14086',count:1}]},pool);
// p0 = 夢妖魔ex owner(active). p1 = active player, plays 急進開關.
const rushInst=inst(RUSH);
const p1old=inst('14086'); // 舊 active,無能量(避免能量轉移 picker)
const p1bench=inst('17976');
const st={ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:1, isFirstTurn:false, turn:3,
  setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
  players:[
    { ...s.players[0], active:inst(MISMAGIUS), bench:[], hand:[], deck:[inst('14086')], discard:[], prizes:[inst('14086')] },
    { ...s.players[1], active:p1old, bench:[p1bench], hand:[rushInst], deck:[inst('14086')], discard:[], prizes:[inst('14086')] },
  ]};
T('急進開關 self-swap → 中央偵測觸發漩渦言靈,新上場混亂 [HEAD FAIL:rush-switch 漏呼叫]', ()=>{
  const o1=applyAction(st,{type:'PLAY_TRAINER',iid:rushInst.iid,senderIdx:1},pool);
  assert.equal(o1.pendingSelection?.effectKey,'rush-switch-pick-bench','應開急進開關 bench 選擇');
  const o2=applyAction(o1,{type:'RESOLVE_SELECTION',selectedIids:[p1bench.iid],senderIdx:1},pool);
  const na=o2.players[1].active;
  assert.equal(na.iid,p1bench.iid,'新 active 應為原備戰');
  assert.equal(na.status,'confused','新上場應被漩渦言靈混亂');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`); process.exit(fail?1:0);
