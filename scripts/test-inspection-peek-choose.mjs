// v6.002:步哨鼠|臨檢 卡面「擲3次硬幣,若正面則查看對手手牌,從其中選擇與正面數相同的卡放回牌庫重洗」=
//   玩家看+選(同暗槓/突刺目光),非自動取前N張。修:開 hand-discard picker(sourcePlayerIdx=對手)。
//   HEAD(自動取前N張,無pending)→FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-ip.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-ip.ts'); const O=join(ROOT,'.ent-ip.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const SENTRY='18489',PSY='14103',BASIC='14093';
let iid=0;const inst=(cid,e={})=>({iid:'p'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const realRandom=Math.random;

T('臨檢(強制3正面):開 hand-discard picker 查看對手手牌讓玩家選3張(非自動取前3)',()=>{
  Math.random=()=>0; // 全正面 → 3 heads
  try{
    const s=createGame({name:'A',entries:[{cardId:SENTRY,count:1}]},{name:'B',entries:[{cardId:BASIC,count:1}]},pool);
    // 對手手牌4張(可辨識iid),牌庫預留
    const oppHand=[inst(BASIC),inst(BASIC),inst(BASIC),inst(BASIC)];
    const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:5,
      setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
      players:[{...s.players[0],hand:[],deck:[inst(SENTRY)],discard:[],prizes:Array.from({length:6},()=>inst(SENTRY)),bench:[],active:inst(SENTRY,{energyAttached:[inst(PSY)]})},
               {...s.players[1],hand:oppHand,deck:[inst(BASIC),inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)}]};
    let r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
    console.log('   ATTACK後 pending=',r.pendingSelection?.effectKey,' maxCount=',r.pendingSelection?.maxCount,' sourcePlayerIdx=',r.pendingSelection?.sourcePlayerIdx);
    assert.ok(r.pendingSelection,'應開 picker(pendingSelection),HEAD自動無pending');
    assert.equal(r.pendingSelection.effectKey,'inspection-to-deck-shuffle','effectKey應為臨檢resolver');
    assert.equal(r.pendingSelection.maxCount,3,'3正面應選3張');
    assert.equal(r.pendingSelection.sourcePlayerIdx,1,'看的是對手(P1)手牌');
    // 對手手牌此時尚未被移走
    assert.equal(r.players[1].hand.length,4,'選之前對手手牌仍4張');
    // 玩家選「後3張」(iid索引1,2,3)→證明可自選(非自動前3)
    const chosen=[oppHand[1].iid,oppHand[2].iid,oppHand[3].iid];
    r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:chosen},pool);
    const remain=r.players[1].hand;
    console.log('   RESOLVE後 對手剩手牌iid=',remain.map(c=>c.iid),' (應只剩oppHand[0]=',oppHand[0].iid,')');
    assert.equal(remain.length,1,'選3張後對手手牌應剩1張');
    assert.equal(remain[0].iid,oppHand[0].iid,'剩下的應是未選的第1張(證明玩家自選非自動取前3)');
    assert.ok(r.players[1].deck.some(c=>c.iid===oppHand[3].iid),'選中的卡應放回對手牌庫');
  } finally { Math.random=realRandom; }
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
