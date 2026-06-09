// v5.517 收斂：攻擊方加成(力量蛋白飲/烏栗等) 對「主傷害走中央 helper」的招式(波動突刺)也要生效。
//   單一函式 applyAttackerActiveDamageBonuses 供引擎+中央 helper 共用,guard 防雙套。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-ab.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-ab.ts'); const O = join(ROOT, '.ent-ab.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nexport { dealAttackDamageToTarget } from './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, dealAttackDamageToTarget } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
let FIGHT_EN=null;
for (const [id,c] of pool) { if (c.name==='基本【鬥】能量') { FIGHT_EN=id; break; } }
const LUCARIO='14752' /*超級路卡利歐ex 鬥 波動突刺130*/, TAUROS='14360' /*帕底亞肯泰羅 鬥 捨身衝撞70 #1*/,
      KING='10594' /*刺龍王ex 水 310hp 弱雷*/;
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function base(p0,p1){
  const s=createGame({name:'P1',entries:[{cardId:LUCARIO,count:1}]},{name:'P2',entries:[{cardId:KING,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',turn:2,activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],coinFlippedThisAttack:false,_attackerActiveBonusDone:false,
    players:[{...s.players[0],hand:[],deck:[inst(LUCARIO)],discard:[],prizes:Array.from({length:6},()=>inst(LUCARIO)),bench:[],...p0},
             {...s.players[1],hand:[],deck:[inst(KING)],discard:[],prizes:Array.from({length:6},()=>inst(KING)),bench:[],...p1}]};
}
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 中央 helper：超級路卡利歐ex(鬥)+力量蛋白飲 → 波動突刺 130 變 160',()=>{
  const def=inst(KING);
  const st=base({active:inst(LUCARIO),damageBoostFightingThisTurn:30},{active:def});
  const n=dealAttackDamageToTarget(st,0,def.iid,130,pool,{kind:'attack-damage',label:'波動突刺'});
  assert.equal(n.players[1].active.damage,160,'應 130+30=160，實際 '+n.players[1].active.damage);
});
T('② 中央 helper：無力量蛋白飲時 → 130(不亂加)',()=>{
  const def=inst(KING);
  const st=base({active:inst(LUCARIO)},{active:def});
  const n=dealAttackDamageToTarget(st,0,def.iid,130,pool,{kind:'attack-damage',label:'波動突刺'});
  assert.equal(n.players[1].active.damage,130,'無加成應 130，實際 '+n.players[1].active.damage);
});
T('③ 引擎真 ATTACK：帕底亞肯泰羅(鬥)捨身衝撞70 + 力量蛋白飲 → 對手 100(引擎照常套一次)',()=>{
  assert(FIGHT_EN,'找不到基本鬥能量');
  const st=base({active:inst(TAUROS,{energyAttached:[inst(FIGHT_EN),inst(FIGHT_EN)]}),damageBoostFightingThisTurn:30},{active:inst(KING)});
  const n=applyAction(st,{type:'ATTACK',attackIndex:1},pool);
  assert.equal(n.players[1].active.damage,100,'應 70+30=100(引擎不雙套)，實際 '+n.players[1].active.damage);
});
T('④ 中央 helper：烏栗 對 ex 防守 +30 (50→80)',()=>{
  const def=inst(KING); // 刺龍王ex 是 ex
  const st=base({active:inst(LUCARIO),unrudaBonusThisTurn:true},{active:def});
  const n=dealAttackDamageToTarget(st,0,def.iid,50,pool,{kind:'attack-damage',label:'測試'});
  assert.equal(n.players[1].active.damage,80,'烏栗對ex應 50+30=80，實際 '+n.players[1].active.damage);
});
T('⑤ guard 防雙套：state._attackerActiveBonusDone=true 時中央 helper 不再加',()=>{
  const def=inst(KING);
  const st=base({active:inst(LUCARIO),damageBoostFightingThisTurn:30},{active:def});
  st._attackerActiveBonusDone=true; // 模擬引擎已套
  const n=dealAttackDamageToTarget(st,0,def.iid,130,pool,{kind:'attack-damage',label:'波動突刺'});
  assert.equal(n.players[1].active.damage,130,'已套過應不重複 → 130，實際 '+n.players[1].active.damage);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
