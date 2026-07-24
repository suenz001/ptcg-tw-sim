// v6.009 防作弊:引擎 RESOLVE_SELECTION 不驗 client 傳來 selectedIids 的 filter/min/max/重複。
//   Fable 事後審查揪出:①暗碼迷|cipher-geek-arrange-top 原封 map iids→傳 [A,A] 複製卡、傳整副→疊牌。
//   ②稜鏡充能|v311-deck-energy-to-tagged-stage1 原封傳給 startEnergyChain→可塞任意卡/重複/超量進能量。
//   修:兩 resolver 端都對 iids 去重+夾上限,稜鏡另驗「只留基本能量、各不同屬性」。公平性→不寫首頁changelog。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.af-s.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.af-e.ts'); const O=join(ROOT,'.af-o.mjs');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0;const inst=(cid,e={})=>({iid:'a'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const FIRE='14428',WATER='18519',POKE='14804'/*太樂巴戈斯(非能量,當惡意塞入卡)*/;
// 只計實體卡區(active/bench/hand/deck/discard);prizes 在本測試不變且用整數佔位,不納入守恆比對
function allIids(st){const o=[];for(const p of st.players)for(const c of [p.active,...(p.bench||[]),...(p.hand||[]),...(p.deck||[]),...(p.discard||[])]){if(!c)continue;o.push(c.iid);for(const e of (c.energyAttached||[]))o.push(e.iid);}return o;}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① 暗碼迷 cipher-geek-arrange-top:client 傳整副5張(疊牌向量,超量) → 只夾2張放頂、其餘重洗',()=>{
  const A=inst(POKE),B=inst(POKE),C=inst(POKE),D=inst(POKE),Ecard=inst(POKE);
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],
    pendingSelection:{type:'deck-search',actorIdx:0,sourcePlayerIdx:0,filter:'Any',minCount:2,maxCount:2,effectKey:'cipher-geek-arrange-top',params:{}},
    players:[{name:'P0',active:inst(POKE),bench:[],hand:[],deck:[A,B,C,D,Ecard],discard:[],prizes:[1,1,1,1,1,1]},
             {name:'P1',active:inst(POKE),bench:[],hand:[],deck:[inst(POKE)],discard:[],prizes:[1,1,1,1,1,1]}]};
  const before=allIids(st).length;
  // 惡意 client 傳整副 5 張(選取序 A,B,C,D,E) → 若不夾上限,整副照序堆疊、rest 空不重洗(疊牌作弊)
  const r=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[A.iid,B.iid,C.iid,D.iid,Ecard.iid]},pool);
  const after=allIids(r).length; const d=r.players[0].deck;
  console.log('   total',before,'->',after,'| deckLen',d.length,'| top2',d.slice(0,2).map(c=>c.iid),'| 底3集合',new Set(d.slice(2).map(c=>c.iid)).size);
  assert.equal(after,before,'總卡數守恆');
  assert.equal(d.length,5,'牌庫仍 5 張');
  assert.equal(new Set(d.map(c=>c.iid)).size,5,'無重複');
  // 夾到2張:先選A=上方第2位、後選B=最上方 → 只有 B,A 是玩家掌控的頂2張;其餘 C,D,E 為重洗底部
  assert.equal(d[0].iid,B.iid,'最上方=後選B(HEAD 不夾會變成最後選的E堆在最上)');
  assert.equal(d[1].iid,A.iid,'上方第2位=先選A');
  const bottom=new Set(d.slice(2).map(c=>c.iid));
  assert.ok(bottom.has(C.iid)&&bottom.has(D.iid)&&bottom.has(Ecard.iid),'C/D/E 應在重洗底部(HEAD 會被玩家指定順序堆在牌庫上方=疊牌)');
});

T('② 稜鏡充能 v311-stage1:client 傳 [火,火,水,非能量卡] → 只附火+水2張(去重+剔非能量)',()=>{
  const target=inst(POKE); // 太晶目標(taggedIids 指定)
  const F1=inst(FIRE),F2=inst(FIRE),W=inst(WATER),BADPOKE=inst(POKE);
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],
    pendingSelection:{type:'deck-search',actorIdx:0,sourcePlayerIdx:0,filter:'BasicEnergy:DistinctTypes',minCount:0,maxCount:3,effectKey:'v311-deck-energy-to-tagged-stage1',
      params:{label:'稜鏡充能',tagName:'太晶',taggedIids:[target.iid],maxN:3,distinctTypes:true}},
    players:[{name:'P0',active:target,bench:[],hand:[],deck:[F1,F2,W,BADPOKE],discard:[],prizes:[1,1,1,1,1,1]},
             {name:'P1',active:inst(POKE),bench:[],hand:[],deck:[inst(POKE)],discard:[],prizes:[1,1,1,1,1,1]}]};
  const before=allIids(st).length;
  const r=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[F1.iid,F2.iid,W.iid,BADPOKE.iid]},pool);
  const after=allIids(r).length;
  // 目標(可能已被 startEnergyChain 附能)找回
  const tgt=[r.players[0].active,...r.players[0].bench].find(c=>c&&c.iid===target.iid);
  const att=(tgt?.energyAttached||[]);
  const attCids=att.map(e=>e.cardId);
  console.log('   附上能量數',att.length,'| cardIds',attCids,'| total',before,'->',after,'| pending',r.pendingSelection?.effectKey??'null');
  assert.equal(after,before,'總卡數守恆');
  assert.equal(att.length,2,'只附 2 張(火去重+水;剔除第2張火與非能量卡),HEAD 會附 4 張');
  assert.ok(!attCids.includes(POKE),'非能量卡不可被附上(HEAD 會把寶可夢卡塞進 energyAttached)');
  const fireCnt=attCids.filter(c=>c===FIRE).length, waterCnt=attCids.filter(c=>c===WATER).length;
  assert.ok(fireCnt===1 && waterCnt===1,'各不同屬性:火1水1(HEAD 火2)');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
