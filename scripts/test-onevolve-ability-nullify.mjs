// v5.751:on-evolve/on-play 自動觸發特性也要受對手「特性消除」影響。
//   玩家報:我方振翼髮|暗夜羽擊(消除對手戰鬥場特性)時,對手胡地進化的「精神抽出」仍觸發。
//   promptPlayAbilities 原入口只 gate 監視塔+初始化,漏暗夜羽擊→改逐特性 isAbilityHolderEffective。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.s-oe.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.e-oe.ts'); const O=join(ROOT,'.e-oe.mjs');
writeFileSync(E,`import './src/lib/game/engine';export { promptPlayAbilities } from './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { promptPlayAbilities }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const FLUTTER='9803';   // 振翼髮(暗夜羽擊)
const ALAKAZAM='14058'; // 胡地(精神抽出)
const ABRA=(()=>{for(const[id,c]of pool)if(c.name==='凱西')return id;return '10463';})();
let pass=0,fail=0;const T=(n,f)=>{try{f();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function gs(p0active){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:1,firstPlayerIdx:0,isFirstTurn:false,activeStadium:null,log:[],pendingSelection:null,
    players:[{name:'A',hand:[],deck:[],discard:[],prizes:[],bench:[],active:p0active},
             {name:'B',hand:[],deck:[inst(ABRA),inst(ABRA),inst(ABRA),inst(ABRA)],discard:[],prizes:[],bench:[],active:inst(ALAKAZAM,{evolvedThisTurn:true})}]};
}
const alaCard=pool.get(ALAKAZAM);
T('對手振翼髮暗夜羽擊在場→胡地進化精神抽出被擋(不開提示)',()=>{
  const st0=gs(inst(FLUTTER)); // 我方(player0)active=振翼髮暗夜羽擊
  const r=promptPlayAbilities(st0, 1, alaCard, st0.players[1].active, pool, true);
  assert.ok(!r.pendingSelection,'應不開精神抽出提示(被暗夜羽擊消除),實際pendingSelection='+(r.pendingSelection?.effectKey??r.pendingSelection?.type));
});
T('對照:對手非振翼髮→胡地進化精神抽出正常開提示',()=>{
  const st0=gs(inst(ABRA)); // 我方active=凱西(無暗夜羽擊)
  const r=promptPlayAbilities(st0, 1, alaCard, st0.players[1].active, pool, true);
  assert.ok(r.pendingSelection,'無消除時應開精神抽出提示');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);process.exit(fail?1:0);
