// 古舊能量：附有它的寶可夢「受到對手招式的【傷害】而昏厥」才減1獎賞。
//   效果KO（放傷害指示物：幻影奇襲/咒詛炸彈/悄聲加害）不該觸發。玩家報幻影奇襲放6指示物昏厥誤-1。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-ae.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-ae.ts'); const O = join(ROOT, '.ent-ae.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';
export { koPrizesAdjusted } from './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, koPrizesAdjusted } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const ANCIENT='17212', DRAGA='17019' /*多龍巴魯托ex 幻影奇襲#1*/, WAIL='19159' /*吼鯨王ex 380*/,
      ODDISH='14319' /*走路草 50hp 1獎賞*/, FIRE='18518', PSY='11177';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// ── 單元：koPrizesAdjusted 直接測 gate ──
function baseState(){
  const s=createGame({name:'P1',entries:[{cardId:DRAGA,count:1}]},{name:'P2',entries:[{cardId:WAIL,count:1}]},pool);
  return {...s,phase:'playing',ancientEnergyMinusOneUsed:[false,false],
    players:[{...s.players[0],active:inst(DRAGA)},{...s.players[1],active:inst(WAIL)}]};
}
T('① 單元 傷害KO(koByAttackDamage=true)：古舊能量持有者 base2 → 1 (有 -1)',()=>{
  const koInst=inst(WAIL,{energyAttached:[inst(ANCIENT)]});  // 吼鯨王ex base 2 獎賞
  const r=koPrizesAdjusted(baseState(),koInst,pool.get(WAIL),0,1,pool,true);
  assert.equal(r.prizes,1,'傷害KO應 2-1=1，實際'+r.prizes);
});
T('②★ 單元 效果KO(koByAttackDamage=false)：古舊能量不觸發 → 2 (無 -1)',()=>{
  const koInst=inst(WAIL,{energyAttached:[inst(ANCIENT)]});
  const r=koPrizesAdjusted(baseState(),koInst,pool.get(WAIL),0,1,pool,false);
  assert.equal(r.prizes,2,'效果KO不應 -1，應 2，實際'+r.prizes);
});
T('③ 單元 無古舊能量：true/false 都 base2',()=>{
  const koInst=inst(WAIL);
  assert.equal(koPrizesAdjusted(baseState(),koInst,pool.get(WAIL),0,1,pool,true).prizes,2);
  assert.equal(koPrizesAdjusted(baseState(),koInst,pool.get(WAIL),0,1,pool,false).prizes,2);
});

// ── 整合：幻影奇襲 放6指示物 KO 古舊能量備戰 → 獎賞不減 ──
T('④★ 整合 幻影奇襲6指示物 KO 走路草(古舊能量) → P0 取 1 獎賞(非0,效果KO不-1)',()=>{
  const s=createGame({name:'P1',entries:[{cardId:DRAGA,count:1}]},{name:'P2',entries:[{cardId:WAIL,count:1}]},pool);
  const oddish=inst(ODDISH,{energyAttached:[inst(ANCIENT)]});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],ancientEnergyMinusOneUsed:[false,false],
    players:[{...s.players[0],hand:[],deck:[inst(DRAGA)],discard:[],prizes:Array.from({length:6},()=>inst(DRAGA)),bench:[inst(DRAGA)],active:inst(DRAGA,{energyAttached:[inst(FIRE),inst(PSY)]})},
             {...s.players[1],hand:[],deck:[inst(WAIL)],discard:[],prizes:Array.from({length:6},()=>inst(WAIL)),bench:[oddish],active:inst(WAIL)}]};
  let n=applyAction(st,{type:'ATTACK',attackIndex:1},pool);
  assert(n.pendingSelection,'幻影奇襲應開 damage-distribute pending，實際無 pending');
  // 6 個指示物全放 走路草 (60≥50 KO)
  n=applyAction(n,{type:'RESOLVE_SELECTION',selectedIids:Array.from({length:6},()=>oddish.iid)},pool);
  // 吼鯨王ex(active)存活(200<380)，走路草被KO；P0 取走路草獎賞(base1)，效果KO不-1 → prizes 6→5
  assert(!n.players[1].bench.some(c=>c.cardId===ODDISH),'走路草應被KO');
  assert.equal(n.players[0].prizes.length,5,'P0 應取 1 張獎賞(6→5；若誤-1會是0→留6)，實際 prizes='+n.players[0].prizes.length);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
