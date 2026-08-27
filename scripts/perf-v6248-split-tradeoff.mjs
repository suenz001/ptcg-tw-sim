#!/usr/bin/env node
/**
 * ⭐v6.248 量測腳本（Rule 32）：【要不要把「卡住自癒」從 isWaitingOnOpponent gate 底下拆出來】。
 *
 * 背景：v6.246 的註解指出「回合中途自己的動作推失敗時，那條復原路徑根本不會執行」——
 * 字面上成立，於是一直有人想把自癒拆出來。這支腳本用**虛擬時鐘實跑真原始碼**把兩邊都量完。
 *
 * 實測結論（沙盒 node 22）：
 *   E1 我方回合中途推送失敗 300 秒 —— 在 v6.248 樹上量：
 *      現況(有 gate)  force-adopt=0  回捲=false 重訂閱=0 推送=1 伺服器log=10 本地log=11
 *      拆掉 gate      force-adopt=5  回捲=true  重訂閱=12 推送=3 ← **違反硬約束（盤面被退回）**
 *      謹慎版拆法     force-adopt=0  回捲=false 重訂閱=8  推送=3 伺服器log=10（**仍然沒追上**）
 *      （在 v6.247 樹上量同一組：拆掉 gate 是 20/30，謹慎版是 0/30 —— 差別只在有沒有重訂閱退避，
 *        結論一樣。）
 *      ⇒ 拆出來的收益＝0（重推同樣被塞住的上行砍掉，伺服器盤面停在 log=10 沒動），
 *        成本＝多出來的全量房間 GET（約 375KB 下行）＋2 發 48KB 重送，
 *        全壓在**已經塞住的那條線**上 ⇒ 違反「絕不可讓玩家端變慢」。
 *   E2 真正會傷害玩家的是「攻擊完、結束回合」那一手，而那時 isWaitingOnOpponent 已經是 true
 *      ⇒ **gate 本來就是開的**，拆不拆都一樣。
 *   E3 回合中途推失敗後，下一個動作的推送送的是**更新**的盤面，一發成功就自然覆蓋。
 *   ⇒ 決定：**不拆**。並由 scripts/test-v6248-selfheal-followups.mjs 的現況鎖釘住。
 *
 * Run: node scripts/perf-v6248-split-tradeoff.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const GP = readFileSync(ROOT + '/src/routes/game/+page.svelte', 'utf8');
function blockAfter(src, fromIdx){const open=src.indexOf('{',fromIdx);let d=0;for(let k=open;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)return[open,k+1];}}throw new Error('unbal');}
function fnSrc(src,a){const i=src.indexOf(a);if(i<0)throw new Error('no '+a);const[,b]=blockAfter(src,i+a.length-1);return src.slice(i,b);}
const IV_ANCHOR='const iv = setInterval(() => {';
const s0=GP.indexOf(IV_ANCHOR);const[o,c]=blockAfter(GP,s0+IV_ANCHOR.length-1);
const IV_BODY=GP.slice(o+1,c-1);
const PWR=fnSrc(GP,'async function pushWithRetry(');
const IWO=fnSrc(GP,'function isWaitingOnOpponent(');
const HELPERS=['function _beginPushTrack(','function _endPushTrack(','function hasFreshPushInFlight(','function oldestPushInFlightAgeMs(','function _resetPushTracking(','async function pushTracked(','async function pushUndoTracked('].map(a=>fnSrc(GP,a)).join('\n');
const SG=readFileSync(ROOT+'/src/lib/game/sync-guards.ts','utf8');
const CRG=['RESYNC_BASE_MS','RESYNC_FULL_RATE_ROUNDS','RESYNC_MAX_MS'].map(k=>new RegExp('export const '+k+' = \\d+;').exec(SG)[0].replace(/^export /,'')).join('\n')+'\n'+fnSrc(SG,'export function casualResyncGapMs(').replace(/^export /,'');
const ts=async c=>(await transform(c,{loader:'ts',format:'cjs',target:'node20'})).code;
function loadFn(j){const m={exports:{}};new Function('module','exports',j)(m,m.exports);return m.exports._f;}
const isWaitingOnOpponent=loadFn(await ts('export const _f=('+IWO.replace(/^function\s+\w+/,'function')+');'));
const casualResyncGapMs=loadFn(await ts('export const _f = (() => {\n'+CRG+'\nreturn casualResyncGapMs; })();'));
async function build(mut){const iv=mut?mut(IV_BODY,'interval'):IV_BODY;const pw=mut?mut(PWR,'push'):PWR;
 return{runInterval:new Function('S','with (S) {\n'+(await ts(iv))+'\n}'),mkPWR:new Function('S','with (S) {\n'+(await ts(pw))+'\nreturn pushWithRetry; }'),mkHelpers:new Function('S','with (S) {\n'+(await ts(HELPERS))+'\nreturn { pushTracked, pushUndoTracked, hasFreshPushInFlight, oldestPushInFlightAgeMs, _resetPushTracking }; }')};}
function mkClock(){let now=1e6;const t=[];let q=0;return{get now(){return now;},Date:{now:()=>now},setTimeout(f,ms){const h={at:now+(ms||0),fn:f,id:++q};t.push(h);return h.id;},clearTimeout(id){const i=t.findIndex(x=>x.id===id);if(i>=0)t.splice(i,1);},async advance(ms){const tg=now+ms;for(;;){t.sort((a,b)=>a.at-b.at||a.id-b.id);if(t.length&&t[0].at<=tg){const x=t.shift();now=x.at;x.fn();for(let i=0;i<20;i++)await Promise.resolve();}else{now=tg;break;}}for(let i=0;i<20;i++)await Promise.resolve();}};}
const clone=x=>JSON.parse(JSON.stringify(x));
function mkGS(o={}){return{id:'G1',createdAt:1000,phase:'playing',log:Array.from({length:o.logLen??10},(_,i)=>({msg:'l'+i})),setupDone:[true,true],pendingPrizes:[0,0],pendingSelection:null,firstPlayerIdx:0,activePlayerIndex:o.active??0,players:[{name:'P0',active:{},bench:[{}],prizes:[],deck:[]},{name:'P1',active:{},bench:[{}],prizes:[],deck:[]}]};}
function mkWorld(o={}){const clk=mkClock();const W={clk,server:{gs:mkGS({logLen:10}),version:5},log:[],pushCalls:0,pushBytes:0,getBytes:0,pushOutcome:o.pushOutcome??'ok',pushMs:o.pushMs??200};
 W.pushGameState=(code,st)=>new Promise((res,rej)=>{const snap=clone(st);W.pushCalls++;W.pushBytes+=48000;const oc=W.pushOutcome,ms=W.pushMs;
  clk.setTimeout(()=>{if(oc==='ok'){if(!(snap.log.length<W.server.gs.log.length))W.server={gs:snap,version:W.server.version+1};res();}else{const e=new Error('to');e.oracleTimeout=true;rej(e);}},ms);});
 return W;}
function mkClient(W,seat,R,o={}){const clk=W.clk;
 const S={roomCode:'ROOM1',game:o.game===undefined?clone(W.server.gs):o.game,mySeatIdx:seat,myPlayerIndex:seat,roomData:{idleTimeoutSec:180},
  oppInactivityWarn:false,_lastActionAt:clk.now,_lastSyncAt:clk.now,_lastResyncAt:0,_forceAdoptNext:false,_unpushedState:null,_repushAttempts:0,
  _pushInFlightMarks:[],_resyncStreak:0,PUSH_INFLIGHT_FAILSAFE_MS:1500750,casualResyncGapMs,ORACLE_API_TIMEOUT_MAX_MS:120000,unsubRoom:null,casualWaitingSelfInput:()=>false,PUSH_RETRY_MAX:3,
  Date:clk.Date,setTimeout:(f,ms)=>clk.setTimeout(f,ms),Math,
  console:{warn:()=>{},error:()=>{},log:()=>{}},isWaitingOnOpponent,
  decideStuckSelfHeal:ctx=>((ctx.hasUnpushedLocal&&ctx.repushAttempts<(ctx.maxRepushAttempts??2))?{kind:'repush'}:{kind:'force-adopt'}),
  pushGameState:(c,st)=>W.pushGameState(c,st),pushUndoRollback:(c,st)=>W.pushGameState(c,st),isOracleTimeout:e=>!!(e&&e.oracleTimeout===true),
  subscribeRoom:()=>{S._resubs++;W.getBytes+=48000;return()=>{};},handleRoomUpdate:()=>{},_resubs:0,_adopts:0};
 Object.assign(S,R.mkHelpers(S));
 S.pushWithRetry=R.mkPWR(S);
 S.setGame=g=>{const p=S.game?.log?.length??-1;S.game=g;const n=g?.log?.length??0;if(n!==p){S._lastSyncAt=clk.Date.now();if(n>p){S._lastActionAt=clk.Date.now();S.oppInactivityWarn=false;}}};
 S.poll=()=>{const inc=W.server.gs;if(S._forceAdoptNext){S._forceAdoptNext=false;if(inc.phase!=='setup'&&(!S.game||S.game.id===inc.id)){S._adopts++;S.setGame(clone(inc));return 'fa';}}
  if(!S.game)return 'n';if((inc.log?.length??0)<(S.game.log?.length??0))return 'r';if((inc.log?.length??0)===(S.game.log?.length??0))return 'e';S.setGame(clone(inc));return 'a';};
 S.tick=()=>R.runInterval(S);return S;}

const REAL=await build(null);
// 「拆出來」的模擬：把 gate 移除（自癒不再受 isWaitingOnOpponent 限制）
const SPLIT=await build(s=>s.replace('if (!isWaitingOnOpponent(game, mySeatIdx)) { oppInactivityWarn = false; return; }',
                                     'if (!isWaitingOnOpponent(game, mySeatIdx)) { oppInactivityWarn = false; }'));
// 「謹慎版拆法」：gate 拆掉，但 force-adopt 那一支額外自己判 isWaitingOnOpponent（硬約束）
const SPLIT_SAFE=await build(s=>{
  let t=s.replace('if (!isWaitingOnOpponent(game, mySeatIdx)) { oppInactivityWarn = false; return; }',
                  'if (!isWaitingOnOpponent(game, mySeatIdx)) { oppInactivityWarn = false; }');
  t=t.replace('_forceAdoptNext = true;','if (isWaitingOnOpponent(game, mySeatIdx)) _forceAdoptNext = true;');
  return t;
});

async function midTurnStuck(R,label){
  const W=mkWorld({pushOutcome:'timeout',pushMs:30000});const me=mkClient(W,0,R);
  const g=clone(me.game);g.log.push({msg:'我方回合中途的一個動作'});   // 不結束回合
  me.setGame(g);me.pushWithRetry('ROOM1',g);
  const peak=g.log.length;let low=peak;
  for(let e=0;e<=300000;e+=1000){await W.clk.advance(1000);if(e%5000===0){me.tick();me.poll();}
    const L=me.game?.log?.length??-1;if(L<low)low=L;}
  console.log(`${label}: force-adopt=${me._adopts} 回捲=${low<peak} 重訂閱=${me._resubs} 推送次數=${W.pushCalls} 上行位元組=${(W.pushBytes/1024)|0}KB 下行(重訂閱全量)=${(W.getBytes/1024)|0}KB 伺服器log=${W.server.gs.log.length} 本地log=${me.game.log.length}`);
  return {adopts:me._adopts,rolledBack:low<peak,resubs:me._resubs,pushes:W.pushCalls};
}
console.log('=== E1：我方回合中途推送失敗（300 秒）===');
await midTurnStuck(REAL,'  現況(有 gate)');
await midTurnStuck(SPLIT,'  拆掉 gate ');
await midTurnStuck(SPLIT_SAFE,'  謹慎版拆法');

console.log('\n=== E2：真正會傷害玩家的情境（結束回合後）gate 本來就是開的 ===');
{
  const g0=mkGS({active:0});           // 我的回合
  const g1=mkGS({active:1});           // 我打完攻擊、回合換給對手
  console.log('  攻擊前(我的回合) isWaitingOnOpponent =', isWaitingOnOpponent(g0,0));
  console.log('  結束回合後        isWaitingOnOpponent =', isWaitingOnOpponent(g1,0), ' ⇒ 自癒 gate 已開，不需要拆');
}

console.log('\n=== E3：中途推失敗後，下一個動作的推送就自然覆蓋（不需自癒）===');
{
  const W=mkWorld({pushOutcome:'timeout',pushMs:30000});const me=mkClient(W,0,REAL);
  const g=clone(me.game);g.log.push({msg:'a1'});me.setGame(g);const p0=me.pushWithRetry('ROOM1',g);
  for(let i=0;i<120;i++){await W.clk.advance(1000);}
  await p0;
  console.log('  第一發失敗後 伺服器log=',W.server.gs.log.length,' 本地log=',me.game.log.length,' _unpushedState=',me._unpushedState?('log'+me._unpushedState.log.length):'null');
  W.pushOutcome='ok';W.pushMs=200;
  const g2=clone(me.game);g2.log.push({msg:'a2'});me.setGame(g2);const p=me.pushWithRetry('ROOM1',g2);
  for(let i=0;i<10;i++){await W.clk.advance(1000);}
  await p;
  console.log('  第二發成功後 伺服器log=',W.server.gs.log.length,' 本地log=',me.game.log.length,' ⇒ 自然收斂，且送的是**最新**盤面（不是重送舊的那包）');
}
