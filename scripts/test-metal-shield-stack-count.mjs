/**
 * v5.766 §17.40.E:鐵之防禦強化(metalShield)用 2 張 → 【鋼】寶可夢下個對手回合受傷 -60(每張-30累加)。
 * 原本 metalShieldNextTurn/ThisTurn 是布林,消費端固定 -30 → 用2張仍-30(bug)。改計數,減傷=30×count。
 * (1) 無回歸:metalShieldThisTurn=1 → -30。(2)★count=2 → -60(HEAD布林固定=-30 → FAIL)。(3) 無=不減。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.ms-s.js'),E=join(ROOT,'.ms-e.ts'),O=join(ROOT,'.ms-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const GENE='13011',METAL='14434',GARC='12702';
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(shieldCount){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:GARC,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:undefined,
    players:[{...s.players[0],hand:[],deck:[inst(GARC)],bench:[inst(GARC)],active:inst(GENE,{energyAttached:[inst(METAL),inst(METAL),inst(METAL)]})},
             {...s.players[1],...(shieldCount?{metalShieldThisTurn:shieldCount}:{}),hand:[],deck:[inst(GARC)],bench:[inst(GARC)],active:inst(GENE,{energyAttached:[inst(METAL),inst(METAL),inst(METAL)]})}]};
}
const dmg=c=>applyAction(mk(c),{type:'ATTACK',attackIndex:0},pool).players[1].active?.damage;
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const base=dmg(0);
T('基準(無 metalShield)取得 base damage='+base,()=>{ assert.ok(base>60,'base 應 >60 以利驗證,實得 '+base); });
T('無回歸:1 張鐵之防禦強化 → -30',()=>{ assert.equal(dmg(1),base-30,'應 '+(base-30)+',實得 '+dmg(1)); });
T('★2 張鐵之防禦強化 → -60(HEAD 布林固定=-30 會 FAIL)',()=>{ assert.equal(dmg(2),base-60,'應 '+(base-60)+',實得 '+dmg(2)); });
console.log('\n鐵之防禦強化 count 疊加:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
