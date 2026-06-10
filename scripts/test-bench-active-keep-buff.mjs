// v5.525/5.527：bench→active 升場不清狀態(保留奔流之心 damageBonusThisTurn buff)；
//   v5.527 收斂 m5ClearTurnFlags→中央 clearActiveEffects → m5 換場(介秒迴轉)的 active→bench
//   現在完整清 v5.443 後新增的鎖(blockedAttackNamesNextTurn 等)，不再漏到備戰。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-bk.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-bk.ts'); const O = join(ROOT, '.ent-bk.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const FERA='16639', ZERAORA='19170', LIGHTNING='18520';
let BASIC=null; for(const[id,c]of pool){if(c.supertype==='Pokemon'&&c.stage==='Basic'&&c.subtype!=='ex'&&c.hp>=60&&c.hp<=120&&!(c.abilities||[]).length){BASIC=id;break;}}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ SEND_NEW_ACTIVE 補位：備戰大力鱷帶奔流之心 buff(damageBonusThisTurn=120) 升場後 buff 保留',()=>{
  const s=createGame({name:'P1',entries:[{cardId:FERA,count:1}]},{name:'P2',entries:[{cardId:BASIC,count:1}]},pool);
  const benchFera=inst(FERA,{damageBonusThisTurn:120});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(FERA)],discard:[],prizes:Array.from({length:6},()=>inst(FERA)),bench:[benchFera],active:null},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)}]};
  const n=applyAction(st,{type:'SEND_NEW_ACTIVE',iid:benchFera.iid},pool);
  assert.equal(n.players[0].active?.iid,benchFera.iid,'大力鱷應升戰鬥位');
  assert.equal(n.players[0].active?.damageBonusThisTurn,120,'★ 奔流之心 +120 buff 應保留，實際='+n.players[0].active?.damageBonusThisTurn);
  assert.equal(n.players[0].active?.movedToActiveThisTurn,true,'自己回合補位設 movedToActiveThisTurn');
});

T('②★ m5 介秒迴轉換場(收斂後)：active→備戰完整清 v5.443 新鎖(blockedAttackNamesNextTurn)，incoming 保留 buff',()=>{
  const s=createGame({name:'P1',entries:[{cardId:ZERAORA,count:1}]},{name:'P2',entries:[{cardId:ZERAORA,count:1}]},pool);
  // 攻擊方 active=超級捷拉奧拉ex 帶 LLL + 一個 v5.443 鎖(原 m5ClearTurnFlags 漏清)
  const zerActive=inst(ZERAORA,{energyAttached:[inst(LIGHTNING),inst(LIGHTNING),inst(LIGHTNING)], blockedAttackNamesNextTurn:['介秒迴轉']});
  const benchMon=inst(BASIC); // incoming 備戰
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(ZERAORA)],discard:[],prizes:Array.from({length:6},()=>inst(ZERAORA)),bench:[benchMon],active:zerActive},
             {...s.players[1],hand:[],deck:[inst(ZERAORA)],discard:[],prizes:Array.from({length:6},()=>inst(ZERAORA)),bench:[],active:inst(ZERAORA)}]};
  let n=applyAction(st,{type:'ATTACK',attackIndex:1},pool); // 介秒迴轉 idx1
  assert.equal(n.pendingSelection?.effectKey,'m5-zeraora-teleport','介秒迴轉應開換場 picker，實際='+JSON.stringify(n.pendingSelection));
  n=applyAction(n,{type:'RESOLVE_SELECTION',selectedIids:[benchMon.iid]},pool);
  // incoming(benchMon)升戰鬥位，buff 保留
  assert.equal(n.players[0].active?.iid,benchMon.iid,'選的備戰應升戰鬥位');
  // ★ 關鍵：outgoing(zerActive)退備戰，blockedAttackNamesNextTurn 應被【完整清】
  //   (收斂前 m5ClearTurnFlags 只清15欄、漏掉這個 v5.443 鎖→會殘留到備戰)
  const benchedZer=n.players[0].bench.find(c=>c.iid===zerActive.iid);
  assert(benchedZer,'捷拉奧拉應退到備戰');
  assert(!benchedZer.blockedAttackNamesNextTurn,'★ active→備戰應完整清 blockedAttackNamesNextTurn(收斂中央)，實際='+JSON.stringify(benchedZer.blockedAttackNamesNextTurn));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
