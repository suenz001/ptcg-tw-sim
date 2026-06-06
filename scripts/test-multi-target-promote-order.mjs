// 回歸測試網：多目標傷害招式(戰鬥場+備戰)「全部傷害處理完才輪到對手補位」(v5.468)。
// picker 型(opp-bench-choose)→pendingSelection gate 對手不能補位；synchronous 型(各受所有備戰)→regPost 原子完成。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.mt-e.ts'),O=join(ROOT,'.mt-o.mjs'),S=join(ROOT,'.mt-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const CID={dama:'14688',oki:'16695',regi:'16662',muma:'14728',mary:'15991',ubo:'17976',def:'13163',
  W:'18519',P:'14103',D:'14430',F:'14428',mena:'12687',saru:'19183'};
let iid=0;const inst=(cid,e={})=>({iid:`t${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const base=()=>createGame({name:'P1',entries:[{cardId:CID.def,count:1}]},{name:'P2',entries:[{cardId:CID.def,count:1}]},pool);
const atkIdx=(cid,nm)=>pool.get(cid).attacks.findIndex(a=>a.name===nm);
let pass=0,fail=0;const T=(n,f)=>{try{f();console.log('  ✅',n);pass++;}catch(e){console.log('  ❌',n+':',e.message);fail++;}};
function mk(atkCid,energy,defActiveExtra={}){
  const s=base();
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(CID.def)],discard:[],prizes:Array.from({length:6},()=>inst(CID.def)),bench:[],active:inst(atkCid,{energyAttached:energy.map(e=>inst(e))})},
             {...s.players[1],hand:[],deck:[inst(CID.def)],discard:[],prizes:Array.from({length:6},()=>inst(CID.def)),bench:[inst(CID.ubo),inst(CID.ubo)],active:inst(CID.ubo,defActiveExtra)}]};
}
// picker 型通用驗證：active KO → pending 開 → 對手補位被擋 → 解picker → 才可補位
function checkPicker(name,atkCid,atkName,energy,effectKey,defExtra={},needDiscardEnergy=false){
  T(`${name}(picker)：active KO 後 pending gate 對手補位`, ()=>{
    const st=mk(atkCid,energy,defExtra);
    const atkAction={type:'ATTACK',attackIndex:atkIdx(atkCid,atkName)};
    if(needDiscardEnergy) atkAction.discardedEnergyIids=st.players[0].active.energyAttached.map(e=>e.iid);
    let n=applyAction(st,atkAction,pool);
    assert.equal(n.players[1].active,null,'防守方active被KO');
    assert.equal(n.pendingSelection?.effectKey,effectKey,`bench picker(${effectKey})已開 實際`+(n.pendingSelection?.effectKey??'-'));
    const b0=n.players[1].bench[0].iid;
    const blocked=applyAction(n,{type:'SEND_NEW_ACTIVE',iid:b0,senderIdx:1},pool);
    assert.equal(blocked.players[1].active,null,'pending時補位被擋(仍null)');
    let r=applyAction(n,{type:'RESOLVE_SELECTION',effectKey,selectedIids:[b0],actorIdx:0},pool);
    assert.ok(!r.pendingSelection,'解picker後無殘留pending');
    const bench=r.players[1].bench[0]?.iid;
    if(bench){let k=applyAction(r,{type:'SEND_NEW_ACTIVE',iid:bench,senderIdx:1},pool);assert.ok(k.players[1].active,'全傷害完才補位成功');}
    else assert.ok(r.phase==='game-over'||r.players[1].bench.length===0,'備戰被清/終局');
  });
}
checkPicker('火人加農炮',CID.dama,'火人加農炮',[CID.F,CID.F,CID.F],'fire-cannon-90');
checkPicker('激流水泵',CID.oki,'激流水泵',[CID.W,CID.W,CID.W],'bench-hit-N',{},true);
checkPicker('暗影子彈',CID.mary,'暗影子彈',[CID.D,CID.D],'snipe-variable');

// 通用 gated 檢查：active KO 後，若有 pending(picker) → 對手補位被擋直到解完；不寫死 effectKey
function checkGated(name,atkCid,atkName,energy){
  T(`${name}：active KO 後若有 picker 則 gate 對手補位`, ()=>{
    const st=mk(atkCid,energy);
    let n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(atkCid,atkName)},pool);
    assert.equal(n.players[1].active,null,'active被KO');
    if(n.pendingSelection){
      const ek=n.pendingSelection.effectKey;
      const b0=n.players[1].bench[0].iid;
      const blocked=applyAction(n,{type:'SEND_NEW_ACTIVE',iid:b0,senderIdx:1},pool);
      assert.equal(blocked.players[1].active,null,`${ek} pending時補位被擋`);
      let r=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:ek,selectedIids:[b0],actorIdx:0},pool);
      // 解完後(可能再有連鎖pending就再解一次)
      let guard=0;while(r.pendingSelection&&r.pendingSelection.effectKey===ek&&guard++<8){const bb=r.players[1].bench[0]?.iid;if(!bb)break;r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:ek,selectedIids:[bb],actorIdx:0},pool);}
      const bench=r.players[1].bench[0]?.iid;
      if(bench&&!r.pendingSelection){let k=applyAction(r,{type:'SEND_NEW_ACTIVE',iid:bench,senderIdx:1},pool);assert.ok(k.players[1].active,'全傷害完才補位成功');}
    } else {
      // synchronous：備戰已受傷、可直接補位
      const k=applyAction(n,{type:'SEND_NEW_ACTIVE',iid:n.players[1].bench[0].iid,senderIdx:1},pool);
      assert.ok(k.players[1].active,'synchronous全傷害完→補位');
    }
  });
}
checkGated('竹蘭的美納斯水分岔(2備戰)',CID.mena,'水分岔',[CID.W,CID.W]);
checkGated('棄世猴幽靈打擊(放5指示物)',CID.saru,'幽靈打擊',[CID.P,CID.P]);

T('雷吉艾斯暴風雪(synchronous所有備戰)：active KO + 備戰各受10 原子完成→可直接補位', ()=>{
  const st=mk(CID.regi,[CID.W,CID.W,CID.W]);
  let n=applyAction(st,{type:'ATTACK',attackIndex:atkIdx(CID.regi,'暴風雪')},pool);
  assert.equal(n.players[1].active,null,'active被90 KO');
  assert.ok(!n.pendingSelection,'無picker(synchronous)');
  assert.equal(n.players[1].bench[0].damage,10,'備戰已同步受10傷害');
  assert.equal(n.players[1].bench[1].damage,10,'備戰2也受10');
  const k=applyAction(n,{type:'SEND_NEW_ACTIVE',iid:n.players[1].bench[0].iid,senderIdx:1},pool);
  assert.ok(k.players[1].active,'全傷害完→補位成功');
});
console.log(`\n結果：${pass} pass / ${fail} fail`);
process.exit(fail?1:0);
