// v5.916 守衛:奧利瓦ex|油之機關槍(選6次×20傷,不計弱抗=attack-damage)打 席多藍恩(灼熱之軀:戰鬥位受
//   招式傷害→灼傷攻擊方)。olive-oil-distribute 自跑傷害迴圈,原漏對 active 呼叫中央 fireDefenderOnDamaged
//   → 攻擊方沒被灼傷。修:對手 active 受傷時 KO 前呼叫 fireDefenderOnDamaged。
//   HEAD-FAIL:HEAD 攻擊方 status 非 burned。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.oo-s.js'), E = join(ROOT, '.oo-e.ts'), O = join(ROOT, '.oo-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const OLIVE='16542'/*奧利瓦ex 油之機關槍(idx0,cost草)*/, HEATRAN='10490'/*席多藍恩 HP140 灼熱之軀*/, GRASS='17217'/*基本草*/, BENCH='14319';
assert(pool.get(HEATRAN)?.abilities?.some(a=>a.name==='灼熱之軀'),'席多藍恩應有灼熱之軀');
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function mk(){
  const s=createGame({name:'A',entries:[{cardId:OLIVE,count:1}]},{name:'B',entries:[{cardId:HEATRAN,count:1}]},pool);
  const olive=inst(OLIVE,{energyAttached:[inst(GRASS)]});
  return {olive, s:{...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s.players[0],hand:[],deck:[inst(BENCH)],discard:[],prizes:Array.from({length:6},()=>inst(BENCH)),bench:[],active:olive},
             {...s.players[1],hand:[],deck:[inst(BENCH)],discard:[],prizes:Array.from({length:6},()=>inst(BENCH)),bench:[inst(BENCH)],active:inst(HEATRAN)}]}};
}
T('油之機關槍打席多藍恩(active,灼熱之軀) → 攻擊方奧利瓦ex 被灼傷', () => {
  const {s,olive}=mk();
  let r=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  assert.equal(r.pendingSelection?.effectKey,'olive-oil-distribute','應開分配 picker');
  const heatIid=r.players[1].active.iid;
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'olive-oil-distribute',selectedIids:Array.from({length:6},()=>heatIid),actorIdx:0},pool);
  assert.equal(r.players[1].active?.damage,120,'席多藍恩應受 6×20=120 傷(HP140 不昏厥);實際 '+(r.players[1].active?.damage));
  assert.equal(r.players[0].active?.status,'burned','攻擊方奧利瓦ex 應被灼熱之軀灼傷;實際 status='+(r.players[0].active?.status));
});
console.log(`\n=== 油之機關槍×灼熱之軀 灼傷攻擊方(v5.916): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
