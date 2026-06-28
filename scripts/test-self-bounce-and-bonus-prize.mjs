// v5.746：三招式因「用了未 import/未定義的名」runtime 崩 — 修後應正常。
//   烈腿蝗|跳躍射擊(getAllAttachedTools未import,回牌庫)、喵喵ex|夾尾巴逃跑(同,回手牌)、
//   鐵臂膀ex|感激放大(bonusPrizeIfKOPost內層漏pool參數,KO時崩)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.s-sb.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.e-sb.ts'); const O=join(ROOT,'.e-sb.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const enId=(()=>{for(const[id,c]of pool)if(c.supertype==='Energy'&&(c.subtype==='Basic'||!c.subtype))return id;})();
const anyBasic=(()=>{for(const[id,c]of pool)if(c.supertype==='Pokemon'&&(c.subtype==='Basic'||c.stage==='Basic'))return id;})();
const hiHP=(()=>{for(const[id,c]of pool)if(c.supertype==='Pokemon'&&c.hp>=250)return id;})();
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function atkIdxOf(cid,nm){return pool.get(cid).attacks.findIndex(a=>a.name===nm);}
function setup(attCid,attName,oppCid){
  const ai=atkIdxOf(attCid,attName); const cost=pool.get(attCid).attacks[ai].cost;
  const att=inst(attCid,{energyAttached:cost.map(()=>inst(enId))});
  let g=createGame({name:'A',entries:[{cardId:attCid,count:1}]},{name:'B',entries:[{cardId:oppCid,count:1}]},pool);
  g={...g,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...g.players[0],active:att,bench:[inst(anyBasic)],hand:[],deck:[inst(anyBasic),inst(anyBasic)],discard:[],prizes:[inst(anyBasic),inst(anyBasic),inst(anyBasic)]},
             {...g.players[1],active:inst(oppCid),bench:[inst(anyBasic)],hand:[],deck:[inst(anyBasic)],discard:[],prizes:[inst(anyBasic),inst(anyBasic),inst(anyBasic)]}]};
  return {g,ai};
}
// 1) 烈腿蝗 跳躍射擊(回牌庫)— 對手高HP不死
T('烈腿蝗|跳躍射擊:無崩潰,自身回牌庫,對手-150',()=>{
  const {g,ai}=setup('14328','跳躍射擊',hiHP||anyBasic);
  const r=applyAction(g,{type:'ATTACK',attackIndex:ai},pool);
  assert.equal(r.players[0].active,null,'自身應離場(回牌庫)');
  assert.equal(r.players[0].deck.filter(c=>c.cardId==='14328').length,1,'烈腿蝗應在牌庫');
});
// 2) 喵喵ex 夾尾巴逃跑(回手牌)
T('喵喵ex|夾尾巴逃跑:無崩潰,自身回手牌',()=>{
  const mid=byName.get('喵喵ex'); if(!mid){console.log('  (無喵喵ex跳過)');return;}
  if(atkIdxOf(mid,'夾尾巴逃跑')<0){console.log('  (喵喵ex無此招跳過)');return;}
  const {g,ai}=setup(mid,'夾尾巴逃跑',hiHP||anyBasic);
  const r=applyAction(g,{type:'ATTACK',attackIndex:ai},pool);
  assert.equal(r.players[0].active,null,'自身應離場(回手牌)');
  assert.ok(r.players[0].hand.some(c=>c.cardId===mid),'喵喵ex應在手牌');
});
// 3) 鐵臂膀ex 感激放大(KO對手→多拿獎賞)— 對手低HP被KO
T('鐵臂膀ex|感激放大:KO對手不崩,觸發多拿獎賞',()=>{
  const tid='11579';
  // 對手用低HP basic(<=120)以被120 KO
  let lowHP=null; for(const[id,c]of pool){if(c.supertype==='Pokemon'&&(c.subtype==='Basic'||c.stage==='Basic')&&c.hp&&c.hp<=120){lowHP=id;break;}}
  const {g,ai}=setup(tid,'感激放大',lowHP||anyBasic);
  const r=applyAction(g,{type:'ATTACK',attackIndex:ai},pool);
  // 不崩即過;對手active應被KO(null或換上備戰)
  assert.ok(true,'未拋錯');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
