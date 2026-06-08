// 重試徽章 gate（v5.513）：只有「我方攻擊招式自己擲幣」(aIdx===activePlayerIndex) 才設 coinFlippedThisAttack
//   → 才會在 ATTACK 末端觸發重試徽章 modal。對手防守特性擲幣(奇諾栗鼠ex 順滑大衣 / 變隱龍 躲藏高手 /
//   吉雉雞 腎上腺費洛蒙，皆 dIdx)、或招式讓對手擲幣(備戰區操縱 dIdx) 都不該觸發。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-rb.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-rb.ts'); const O = join(ROOT, '.ent-rb.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nexport { flipCoinsWithLog } from './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, flipCoinsWithLog } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const NULL2='19211' /*屬性：空 力量刀鋒40 無擲幣 無屬性 cost[無無]*/, KINO='18491' /*奇諾栗鼠ex 順滑大衣*/,
      ZIG='14387' /*蛇紋熊 偷襲(有擲幣)*/, DUMMY='10634' /*童偶熊 無防守特性*/, BADGE='19218', EN='18520';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const logStr=n=>(n.log||[]).map(l=>typeof l==='string'?l:(l.message||'')).join('\n');
function attack(atkCid, atkIdx, atkInst, defCid, ne){
  const s=createGame({name:'P1',entries:[{cardId:atkCid,count:1}]},{name:'P2',entries:[{cardId:defCid,count:1}]},pool);
  const atk=inst(atkCid,{energyAttached:Array.from({length:ne},()=>inst(EN)),...atkInst});
  const st={...s,phase:'playing',turnPhase:'main',turn:2,activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],coinFlippedThisAttack:false,
    players:[{...s.players[0],hand:[],deck:[inst(atkCid)],discard:[],prizes:Array.from({length:6},()=>inst(atkCid)),bench:[],active:atk},
             {...s.players[1],hand:[],deck:[inst(defCid)],discard:[],prizes:Array.from({length:6},()=>inst(defCid)),bench:[inst(defCid)],active:inst(defCid)}]};
  return applyAction(st,{type:'ATTACK',attackIndex:atkIdx},pool);
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 無擲幣招(力量刀鋒)+重試徽章 打 順滑大衣 → 防守方擲幣但不觸發重試徽章 modal',()=>{
  const n=attack(NULL2,0,{toolAttached:inst(BADGE)},KINO,2);
  const lg=logStr(n);
  assert(/順滑大衣/.test(lg),'防守方順滑大衣應確實擲幣(否則此案無意義)，log='+lg.slice(-160));
  assert(n.coinFlippedThisAttack!==true,'防守方(dIdx)擲幣不該設 coinFlippedThisAttack');
  assert(n.pendingSelection?.effectKey!=='m5-retry-badge-decide','不該開重試徽章 modal，pending='+n.pendingSelection?.effectKey);
});

T('② 正向對照：會擲幣招(偷襲)+重試徽章 → 重試徽章 modal 正常開啟(合法路徑沒壞)',()=>{
  const n=attack(ZIG,0,{toolAttached:inst(BADGE)},DUMMY,1);
  assert(n.pendingSelection?.effectKey==='m5-retry-badge-decide','我方攻擊自己擲幣應開重試徽章 modal，pending='+JSON.stringify(n.pendingSelection?.effectKey));
});

T('③ gate 單元：aIdx === activePlayerIndex(我方攻擊自己擲) → 設旗標',()=>{
  const s=createGame({name:'P1',entries:[{cardId:NULL2,count:1}]},{name:'P2',entries:[{cardId:KINO,count:1}]},pool);
  const r=flipCoinsWithLog({...s,activePlayerIndex:0,coinFlippedThisAttack:false},1,'測試招式',0);
  assert(r.state.coinFlippedThisAttack===true,'我方攻擊自己擲幣應設旗標');
});
T('④ gate 單元：aIdx !== activePlayerIndex(防守方擲) → 不設旗標',()=>{
  const s=createGame({name:'P1',entries:[{cardId:NULL2,count:1}]},{name:'P2',entries:[{cardId:KINO,count:1}]},pool);
  const r=flipCoinsWithLog({...s,activePlayerIndex:0,coinFlippedThisAttack:false},1,'順滑大衣',1);
  assert(r.state.coinFlippedThisAttack!==true,'防守方擲幣不該設旗標');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
