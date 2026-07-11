// 驗證:胡地|手之力量(招式放指示物效果KO=koTargetByAttackEffect)KO我方active後,不公印章可用
//   (上個對手回合自己寶可夢昏厥→recordOppKO('attack')→END_TURN快照→oppAttackKOdMeInLastOppTurn)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.us-s.js'), E = join(ROOT, '.us-e.ts'), O = join(ROOT, '.us-o.mjs');
process.on('exit', () => { for (const p of [S,E,O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nexport { TRAINER_GUARDS } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { createGame, applyAction, TRAINER_GUARDS } = await import(pathToFileURL(O).href);
const dir = join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for (const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const PSY='11177'; const ALAKAZAM='14058'/*胡地 手之力量 atk0*/, KADABRA='14056'/*凱西 basic*/, STAMP='10300'/*不公印章*/, FILL='14319';
assert.equal(pool.get(ALAKAZAM)?.attacks?.[0]?.name,'手之力量','胡地atk0=手之力量');
assert(TRAINER_GUARDS.get('不公印章'),'不公印章 regG 應註冊');
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('胡地手之力量效果KO我方active → 我方回合不公印章可用', () => {
  const s0=createGame({name:'P0',entries:[{cardId:ALAKAZAM,count:1}]},{name:'P1',entries:[{cardId:KADABRA,count:1}]},pool);
  const alaHand=Array.from({length:6},()=>inst(FILL)); // 手牌6張→手之力量12指示物=120傷
  const state={...s0,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:3,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s0.players[0],hand:alaHand,deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[],active:inst(ALAKAZAM,{energyAttached:[inst(PSY)]})},
             {...s0.players[1],hand:[inst(STAMP)],deck:[inst(FILL)],discard:[],prizes:Array.from({length:6},()=>inst(FILL)),bench:[inst(KADABRA)],active:inst(KADABRA)}]};
  // 胡地手之力量攻擊(atk0)
  let r=applyAction(state,{type:'ATTACK',attackIndex:0},pool);
  // 若開了picker(理論上手之力量對active不需選)先resolve
  let guard=0;
  while(r.pendingSelection && guard++<3){
    const ps=r.pendingSelection;
    // 我方(P1)active被KO→需補位SEND_NEW_ACTIVE
    if(ps.type==='select-active'||ps.effectKey==='send-new-active'||(r.players[1].active===null)) break;
    r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[]},pool);
  }
  // P1 active 應已被KO(null)→補位
  if(!r.players[1].active){
    const benchIid=r.players[1].bench[0]?.iid;
    r=applyAction(r,{type:'SEND_NEW_ACTIVE',iid:benchIid,senderIdx:1},pool);
  }
  console.log('    KO後 oppAttackKOdMeThisTurn=',JSON.stringify(r.oppAttackKOdMeThisTurn),'P1 active=',r.players[1].active?.cardId);
  // P0 END_TURN(快照 thisTurn→InLastOppTurn)
  r=applyAction(r,{type:'END_TURN'},pool);
  console.log('    END_TURN後 oppAttackKOdMeInLastOppTurn=',JSON.stringify(r.oppAttackKOdMeInLastOppTurn),'activePlayer=',r.activePlayerIndex);
  const usable=TRAINER_GUARDS.get('不公印章')(r,1,pool);
  assert.ok(usable,'我方(P1)回合不公印章應可用;InLastOppTurn='+JSON.stringify(r.oppAttackKOdMeInLastOppTurn));
});
console.log(`\n=== 不公印章 effect-KO 可用性: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
