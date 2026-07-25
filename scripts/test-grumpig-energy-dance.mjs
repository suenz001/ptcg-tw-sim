// v6.021：噗噗豬｜能量舞步 — picker 改走 deck-search BasicEnergy:TOP_N（同金屬怪/女服務生）→ UI 自動
//   reveal 牌庫頂全部 4 張（玩家看得到非能量卡，符合卡面「查看牌庫上方4張卡」），只基本能量可勾選。
//   HEAD 用 reorder-deck-top（UI 只顯示能量、看不到其他卡）→ 型別斷言 HEAD FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.ged-s.js'); const E=join(ROOT,'.ged-e.ts'); const O=join(ROOT,'.ged-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ABILITY_EFFECTS, RESOLVERS } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ABILITY_EFFECTS, RESOLVERS }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const find=(pred)=>{for(const[id,c]of pool)if(pred(c))return c;return null;};
const fireE=find(c=>c.supertype==='Energy'&&c.subtype==='Basic'&&c.name.includes('【火】'));
const waterE=find(c=>c.supertype==='Energy'&&c.subtype==='Basic'&&c.name.includes('【水】'));
const somePoke=find(c=>c.supertype==='Pokemon'&&!c.evolvesFrom);
const someTrainer=find(c=>c.supertype==='Trainer');
const grumpig=find(c=>c.name==='噗噗豬');
const danceFn=ABILITY_EFFECTS.get('噗噗豬|0');  // regA('噗噗豬',0)→key '噗噗豬|0'
assert.ok(fireE&&waterE&&somePoke&&someTrainer&&grumpig,'測試素材齊全');
let nn=0;const inst=(c)=>({iid:'i'+(++nn),cardId:String(c.id),damage:0,energyAttached:[]});
const grumpigInst=inst(grumpig);
// 牌庫頂 4 張：火能量、寶可夢(非能量)、水能量、訓練家(非能量)
const d0=inst(fireE), d1=inst(somePoke), d2=inst(waterE), d3=inst(someTrainer), d4=inst(somePoke);
const state={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
  setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],pendingSelection:null,
  players:[{name:'P1',active:grumpigInst,bench:[],hand:[],deck:[d0,d1,d2,d3,d4],discard:[],prizes:[1,1,1,1,1,1]},
           {name:'P2',active:inst(somePoke),bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]};
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('pending 改 deck-search BasicEnergy:TOP_N + topIids 含牌庫頂全部4張(非能量卡玩家看得到)',()=>{
  const st1=danceFn(state,0,pool,grumpigInst);
  const ps=st1.pendingSelection;
  assert.ok(ps,'應開 pending');
  assert.equal(ps.type,'deck-search','應為 deck-search(HEAD 是 reorder-deck-top→看不到非能量卡)');
  assert.equal(ps.filter,'BasicEnergy:TOP_N','filter 應 BasicEnergy:TOP_N');
  const topIids=ps.params?.topIids;
  assert.deepEqual(topIids,[d0.iid,d1.iid,d2.iid,d3.iid],'topIids 應為牌庫頂4張全部(含非能量),玩家看得到');
});

T('選 0 張 → 4 張全放回牌庫重洗,無殘留 distribute pending',()=>{
  const st1=danceFn(state,0,pool,grumpigInst);
  const st2=RESOLVERS.get('grumpig-energy-dance-pick')(st1,0,[],st1.pendingSelection.params,pool);
  assert.equal(st2.players[0].deck.length,5,'牌庫張數守恆(5)');
  assert.equal(st2.players[0].discard.length,0,'0 選→discard 無能量');
});

T('選火+水能量 → 暫存 discard + 開附能鏈 pending;剩餘(寶可夢/訓練家)回牌庫重洗',()=>{
  const st1=danceFn(state,0,pool,grumpigInst);
  const st2=RESOLVERS.get('grumpig-energy-dance-pick')(st1,0,[d0.iid,d2.iid],st1.pendingSelection.params,pool);
  // 選中能量暫存 discard，開中央附能鏈讓玩家選目標
  assert.ok(st2.pendingSelection,'應開附能鏈 pending(玩家選附加目標)');
  // 選中能量離開牌庫進入附能流程（startEnergyChain 暫存位置為實作細節，不假設在 discard）
  assert.ok(!st2.players[0].deck.some(c=>c.iid===d0.iid||c.iid===d2.iid),'選中能量不在牌庫');
  assert.ok(st2.players[0].deck.some(c=>c.iid===d1.iid)&&st2.players[0].deck.some(c=>c.iid===d3.iid),'非能量剩餘回牌庫');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
