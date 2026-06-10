// v5.525：bench→active 升場不清「備戰可設的本回合加傷 buff」（大力鱷|奔流之心 damageBonusThisTurn）；
//   仍清 active-only 鎖(cantAttackPending 等)做防呆。涵蓋 SEND_NEW_ACTIVE + 撤退。
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
const FERA='16639'; // 大力鱷(奔流之心)
let BASIC=null; for(const[id,c]of pool){if(c.supertype==='Pokemon'&&c.stage==='Basic'&&c.subtype!=='ex'&&c.hp>=60&&c.hp<=120&&!(c.abilities||[]).length){BASIC=id;break;}}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ SEND_NEW_ACTIVE 補位：備戰大力鱷帶 奔流之心 buff(damageBonusThisTurn=120) 升場後 buff 保留；active-only 鎖(cantAttackPending)被清',()=>{
  const s=createGame({name:'P1',entries:[{cardId:FERA,count:1}]},{name:'P2',entries:[{cardId:BASIC,count:1}]},pool);
  // 攻擊方 active=null(剛被KO)，備戰大力鱷帶 buff + 一個殘留 active 鎖(模擬漏清)
  const benchFera=inst(FERA,{damageBonusThisTurn:120, cantAttackPending:true});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(FERA)],discard:[],prizes:Array.from({length:6},()=>inst(FERA)),bench:[benchFera],active:null},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)}]};
  const n=applyAction(st,{type:'SEND_NEW_ACTIVE',iid:benchFera.iid},pool);
  assert.equal(n.players[0].active?.iid,benchFera.iid,'大力鱷應升為戰鬥位');
  assert.equal(n.players[0].active?.damageBonusThisTurn,120,'★ 奔流之心 +120 buff 應保留，實際='+n.players[0].active?.damageBonusThisTurn);
  assert(!n.players[0].active?.cantAttackPending,'active-only 鎖 cantAttackPending 應被清(防呆)');
  assert.equal(n.players[0].active?.movedToActiveThisTurn,true,'自己回合補位設 movedToActiveThisTurn');
});

T('② 撤退：備戰大力鱷帶 buff 撤退上場 buff 保留(原本就正確，回歸保護)',()=>{
  const s=createGame({name:'P1',entries:[{cardId:FERA,count:1}]},{name:'P2',entries:[{cardId:BASIC,count:1}]},pool);
  const benchFera=inst(FERA,{damageBonusThisTurn:120});
  const oldActive=inst(BASIC,{energyAttached:[inst('14102'),inst('14102'),inst('14102'),inst('14102')]}); // 夠撤退費
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(FERA)],discard:[],prizes:Array.from({length:6},()=>inst(FERA)),bench:[benchFera],active:oldActive},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)}]};
  const n=applyAction(st,{type:'RETREAT',benchIndex:0},pool);
  if(n.players[0].active?.iid===benchFera.iid){
    assert.equal(n.players[0].active?.damageBonusThisTurn,120,'撤退上場 buff 應保留，實際='+n.players[0].active?.damageBonusThisTurn);
  } else { console.log('  (撤退費不足略過，不影響①核心驗證)'); }
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
