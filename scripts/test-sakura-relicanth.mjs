// 回歸測試網：櫻花魚|漸強波(傷害前可附手牌基本水) + 獵斑魚|潛者捕捉(昏厥確認選單→水能量回手/棄牌) v5.464
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.vf-e.ts'),O=join(ROOT,'.vf-o.mjs'),S=join(ROOT,'.vf-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const CID={sakura:'12775',relicanth:'12774',onix:'13979',waterE:'18519',charz:'13163'};
let iid=0;const inst=(cid,e={})=>({iid:`v${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const base=()=>createGame({name:'P1',entries:[{cardId:CID.charz,count:1}]},{name:'P2',entries:[{cardId:CID.charz,count:1}]},pool);
let pass=0,fail=0;const T=(n,f)=>{try{f();console.log('  ✅',n);pass++;}catch(e){console.log('  ❌',n+':',e.message);fail++;}};
const wE=()=>inst(CID.waterE);

console.log('=== 漸強波（修後）===');
function setupJQ(handWater, attachedWater){
  const s=base();
  const sakura=inst(CID.sakura,{energyAttached:Array.from({length:attachedWater},wE)});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:1,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:Array.from({length:handWater},wE),deck:[inst(CID.charz)],discard:[],prizes:[inst(CID.charz)],bench:[],active:sakura},
             {...s.players[1],hand:[],deck:[inst(CID.charz)],discard:[],prizes:[inst(CID.charz)],bench:[],active:inst(CID.charz)}]};
  return st;
}
T('附手牌2水→自身3水×30×2(火龍水弱)=180', ()=>{
  const st=setupJQ(2,1);
  let n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert.equal(n.pendingSelection?.effectKey,'sakura-crescendo-attach','應開 hand-choose');
  const handIids=n.players[0].hand.map(c=>c.iid);
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'sakura-crescendo-attach',selectedIids:handIids,actorIdx:0},pool);
  assert.equal(n.players[1].active.damage,180,'3水×30×2='+n.players[1].active.damage);
  assert.equal(n.players[0].active.energyAttached.length,3,'自身應有3水');
  assert.equal(n.players[0].hand.length,0,'手牌水應清空');
});
T('選0(不選)→自身1水×30×2=60，手牌2水保留', ()=>{
  const st=setupJQ(2,1);
  let n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'sakura-crescendo-attach',selectedIids:[],actorIdx:0},pool);
  assert.equal(n.players[1].active.damage,60,'1水×30×2=60 實際'+n.players[1].active.damage);
  assert.equal(n.players[0].hand.length,2,'手牌2水保留');
});
T('手牌無水→直接1水×30×2=60(無picker)', ()=>{
  const st=setupJQ(0,1);
  let n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert.ok(!n.pendingSelection,'手牌無水不應開picker');
  assert.equal(n.players[1].active.damage,60,'1水×30×2=60');
});

console.log('=== 潛者捕捉（修後）===');
function setupQZ(){
  const s=base();
  const sakura=inst(CID.sakura,{energyAttached:[wE(),wE()]});  // 我方水寶可夢 2基本水
  const relicanth=inst(CID.relicanth);
  const onix=inst(CID.onix,{energyAttached:[wE(),wE(),wE(),wE()]});
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:1,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(CID.charz)],discard:[],prizes:[inst(CID.charz)],bench:[relicanth,inst(CID.charz)],active:sakura},
             {...s.players[1],hand:[],deck:[inst(CID.charz)],discard:[],prizes:Array.from({length:6},()=>inst(CID.charz)),bench:[],active:onix}]};
}
const onixAtk=pool.get(CID.onix).attacks.findIndex(a=>a.name==='怪力');
T('KO水寶可夢→開確認選單(actorIdx=0防守方)', ()=>{
  const st=setupQZ();
  const n=applyAction(st,{type:'ATTACK',attackIndex:onixAtk},pool);
  assert.equal(n.pendingSelection?.effectKey,'diver-catch-confirm','應開確認選單');
  assert.equal(n.pendingSelection?.actorIdx,0,'確認選單給防守方(0)');
  assert.equal(n.players[0].discard.filter(c=>String(c.cardId)===CID.waterE).length,0,'水暫不進棄牌(held)');
  assert.equal(n.players[0].hand.filter(c=>String(c.cardId)===CID.waterE).length,0,'水暫不進手牌(held)');
});
T('確認「是」→2水回手 + 獎賞/補位序列正常', ()=>{
  const st=setupQZ();
  let n=applyAction(st,{type:'ATTACK',attackIndex:onixAtk},pool);
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'diver-catch-confirm',selectedIids:['yes'],actorIdx:0},pool);
  assert.equal(n.players[0].hand.filter(c=>String(c.cardId)===CID.waterE).length,2,'2水回手');
  assert.equal(n.players[0].discard.filter(c=>String(c.cardId)===CID.waterE).length,0,'棄牌無水');
  assert.ok(!n.pendingSelection,'確認後pending清除');
  assert.ok((n.pendingPrizes?.[1]??0)>=1,'攻擊方有待領獎賞 '+JSON.stringify(n.pendingPrizes));
  assert.equal(n.players[0].active,null,'我方active昏厥待補位');
  // 補位序列：攻擊方領獎賞 + 防守方補位 不卡死
  let m=applyAction(n,{type:'TAKE_PRIZES',count:1,playerIdx:1,senderIdx:1},pool);
  m=applyAction(m,{type:'SEND_NEW_ACTIVE',iid:m.players[0].bench[0].iid,senderIdx:0},pool);
  assert.ok(m.players[0].active,'補位後我方有active(序列不卡死)');
  assert.ok(!m.pendingSelection,'序列完成無殘留pending');
});
T('確認「否」→2水進棄牌', ()=>{
  const st=setupQZ();
  let n=applyAction(st,{type:'ATTACK',attackIndex:onixAtk},pool);
  n=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'diver-catch-confirm',selectedIids:['no'],actorIdx:0},pool);
  assert.equal(n.players[0].hand.filter(c=>String(c.cardId)===CID.waterE).length,0,'手牌無水');
  assert.equal(n.players[0].discard.filter(c=>String(c.cardId)===CID.waterE).length,2,'2水進棄牌');
});

console.log(`\n結果：${pass} pass / ${fail} fail`);
process.exit(fail?1:0);
