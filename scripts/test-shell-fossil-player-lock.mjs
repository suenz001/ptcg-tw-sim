// v5.930 陳舊的背蓋化石「不受招式效果影響」只保護該寶可夢;海之影「對手無法使物品卡」是玩家層級
//   效果→仍該生效。原 engine blanket skip 整個 POST 誤擋。同時驗:寶可夢向效果(中毒)仍免疫。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sf-s.js'),E=join(ROOT,'.sf-e.ts'),O=join(ROOT,'.sf-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards'); const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const HAIYING='13398'/*輕飄飄 海之影*/,DUZHEN='10483'/*車輪毬 毒陣*/,SHELL='10986'/*陳舊的背蓋化石*/,PSY='11177',DARK='14152',FILL='14319';
let nn=0;const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
function attack(p0active,p0energy,atk){
  const s0=createGame({name:'P0',entries:[{cardId:p0active,count:1}]},{name:'P1',entries:[{cardId:FILL,count:1}]},pool);
  const st={...s0,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:3,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s0.players[0],hand:[],deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[],active:inst(p0active,{energyAttached:p0energy.map(e=>inst(e))})},
             {...s0.players[1],hand:[],deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[inst(FILL)],active:inst(SHELL,{fossilOnField:true})}]};
  return applyAction(st,{type:'ATTACK',attackIndex:atk},pool);
}
let pass=0,fail=0;const T=(n,c)=>{try{c();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// ① 海之影(玩家層級item-lock) vs 背蓋化石 → 仍生效
T('海之影 item-lock 對背蓋化石防守者仍生效(玩家層級效果)', ()=>{
  const r=attack(HAIYING,[PSY],0);
  if(!r.players[1].cantPlayItemNextTurn) throw new Error('背蓋化石防守者:海之影item-lock未生效(blanket skip誤擋玩家層級)');
});
// ② 毒陣(寶可夢向:中毒防守者) vs 背蓋化石 → 仍免疫(不回歸)
T('毒陣 中毒對背蓋化石仍免疫(寶可夢向效果不回歸)', ()=>{
  const r=attack(DUZHEN,[DARK],0);
  const st=r.players[1].active?.status;
  if(st==='poisoned') throw new Error('背蓋化石被中毒(寶可夢向效果免疫回歸破功)');
});
console.log(`\n=== 背蓋化石 玩家層級lock vs 寶可夢向免疫: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
