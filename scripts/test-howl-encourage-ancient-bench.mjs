// v5.929 吼叫尾|唱歌鼓勵 卡面「備戰區的1隻『古代』寶可夢」→ picker 須限古代備戰
//   HEAD:heal-target 無 validIids→前端列 active+全備戰,可治非法目標(戰鬥位/非古代)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.hw-s.js'),E=join(ROOT,'.hw-e.ts'),O=join(ROOT,'.hw-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards'); const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const HOWL='10056',ANCIENT='9803'/*振翼髮 古代*/,NONANC='18360'/*凱羅斯 非古代*/,PSY='11177',FILL='14319';
let nn=0;const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0;const T=(n,c)=>{try{c();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('唱歌鼓勵 picker 只列備戰古代(排除戰鬥位+非古代備戰)', ()=>{
  const ancientB=inst(ANCIENT,{damage:60}), nonAncB=inst(NONANC,{damage:60}), act=inst(HOWL,{damage:40,energyAttached:[inst(PSY)]});
  const s0=createGame({name:'P0',entries:[{cardId:HOWL,count:1}]},{name:'P1',entries:[{cardId:FILL,count:1}]},pool);
  const st={...s0,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:3,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s0.players[0],hand:[],deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[ancientB,nonAncB],active:act},
             {...s0.players[1],hand:[],deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[],active:inst(FILL)}]};
  const r=applyAction(st,{type:'ATTACK',attackIndex:0},pool); // 唱歌鼓勵
  const ps=r.pendingSelection;
  if(!ps) throw new Error('唱歌鼓勵未開 picker');
  const vi=ps.params?.validIids;
  if(!Array.isArray(vi)) throw new Error('picker 無 validIids → 前端會列 active+全備戰(可治非法目標)');
  if(vi.includes(act.iid)) throw new Error('validIids 含戰鬥位(卡面限備戰區)');
  if(vi.includes(nonAncB.iid)) throw new Error('validIids 含非古代備戰(卡面限古代)');
  if(!vi.includes(ancientB.iid)) throw new Error('validIids 未含古代備戰');
  if(vi.length!==1) throw new Error('validIids 應只有1個古代備戰,實際='+vi.length);
});
console.log(`\n=== 唱歌鼓勵 picker 限備戰古代: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
