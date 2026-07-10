// v5.919 守衛:①火箭隊能量 附於非「火箭隊的寶可夢」→中央sweep丟棄(涵蓋效果移動,非只手動附加)
//   ②反擊增幅器 多重轉接附2張→各減1無色(原break只減1,配件秀CC費落後時應可減到0)
// HEAD-FAIL:HEAD 效果移動的火箭隊能量不丟棄;HEAD 2張反擊增幅器只減1無色→配件秀仍需1能量
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.re-s.js'), E = join(ROOT, '.re-e.ts'), O = join(ROOT, '.re-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { createGame, applyAction, canAffordAttack } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, canAffordAttack } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const ROTOM='14736'/*洛托姆 atk1配件秀 CC*/, ROTOMEX='14347'/*洛托姆ex 多重轉接*/, AMP='14821'/*反擊增幅器*/;
const RKMON='14742'/*火箭隊的地鼠 basic*/, RKENERGY='14853'/*火箭隊能量*/, BENCH='14319';
assert(pool.get(RKENERGY)?.name==='火箭隊能量'&&pool.get(RKENERGY)?.subtype==='Special','火箭隊能量特殊能量');
assert(pool.get(RKMON)?.name?.includes('火箭隊的'),'火箭隊的地鼠');
assert.equal(pool.get(ROTOM)?.attacks?.[1]?.name,'配件秀','洛托姆 atk1=配件秀');
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],toolAttached:undefined,extraTools:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function base(p0active,p0bench,p1active,p1bench,p0prizes=6,p1prizes=6){
  const s=createGame({name:'A',entries:[{cardId:ROTOM,count:1}]},{name:'B',entries:[{cardId:RKMON,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s.players[0],hand:[],deck:[inst(BENCH)],discard:[],prizes:Array.from({length:p0prizes},()=>inst(BENCH)),bench:p0bench,active:p0active},
             {...s.players[1],hand:[],deck:[inst(BENCH)],discard:[],prizes:Array.from({length:p1prizes},()=>inst(BENCH)),bench:p1bench,active:p1active}]};
}
// A: 火箭隊能量 附於非火箭隊寶可夢(備戰) → 任一dispatch末端 sweep 丟棄
T('A. 火箭隊能量在非火箭隊寶可夢→dispatch後被丟棄', () => {
  const rkE=inst(RKENERGY);
  const nonRocket=inst(ROTOM,{energyAttached:[rkE]}); // 洛托姆非火箭隊
  const s=base(inst(RKMON),[nonRocket],inst(RKMON),[inst(BENCH)]);
  let r=applyAction(s,{type:'END_TURN'},pool);
  const stillOn=[r.players[0].active,...r.players[0].bench].some(c=>c&&c.energyAttached.some(e=>e.cardId===RKENERGY));
  const inDiscard=r.players[0].discard.some(c=>c.cardId===RKENERGY);
  assert.ok(!stillOn,'A非火箭隊身上不應還有火箭隊能量');
  assert.ok(inDiscard,'A火箭隊能量應進棄牌;discard='+r.players[0].discard.map(c=>c.cardId));
});
// B(guard): 火箭隊能量 在火箭隊的寶可夢身上 → 不被丟棄
T('B. 火箭隊能量在火箭隊的寶可夢→保留不丟棄', () => {
  const rkE=inst(RKENERGY);
  const rocketMon=inst(RKMON,{energyAttached:[rkE]});
  const s=base(inst(RKMON),[rocketMon],inst(RKMON),[inst(BENCH)]);
  let r=applyAction(s,{type:'END_TURN'},pool);
  const stillOn=[r.players[0].active,...r.players[0].bench].some(c=>c&&c.energyAttached.some(e=>e.cardId===RKENERGY));
  assert.ok(stillOn,'B火箭隊寶可夢應保留火箭隊能量');
  assert.ok(!r.players[0].discard.some(c=>c.cardId===RKENERGY),'B不應誤丟');
});
// C(bug1): 洛托姆active 0能量 + 2張反擊增幅器 + 落後獎賞(p0=6>p1=3) → 配件秀(CC)可用(減到0)
T('C. 2張反擊增幅器+落後獎賞→配件秀CC減到0可用', () => {
  const amp1=inst(AMP), amp2=inst(AMP);
  const rotom=inst(ROTOM,{energyAttached:[],toolAttached:amp1,extraTools:[amp2]});
  const s=base(rotom,[inst(ROTOMEX)],inst(RKMON),[inst(BENCH)],6,3); // p0落後(6>3)
  const cost=pool.get(ROTOM).attacks[1].cost; // [Colorless,Colorless]
  const ok=canAffordAttack(s.players[0].active,cost,pool,s,0,'配件秀');
  assert.ok(ok,'C 2張反擊增幅器應把CC減到0→0能量可用配件秀');
});
// D(guard): 只1張反擊增幅器+落後 → 只減1 → 配件秀仍需1能量 → 0能量不可用
T('D. 1張反擊增幅器+落後→只減1→配件秀0能量不可用', () => {
  const amp1=inst(AMP);
  const rotom=inst(ROTOM,{energyAttached:[],toolAttached:amp1,extraTools:[]});
  const s=base(rotom,[],inst(RKMON),[inst(BENCH)],6,3);
  const cost=pool.get(ROTOM).attacks[1].cost;
  const ok=canAffordAttack(s.players[0].active,cost,pool,s,0,'配件秀');
  assert.ok(!ok,'D 1張只減1→仍需1能量→0能量不可用');
});
// E(guard): 2張反擊增幅器但領先獎賞(不落後) → 不減 → 配件秀需2能量
T('E. 2張反擊增幅器但領先獎賞→不減費', () => {
  const amp1=inst(AMP), amp2=inst(AMP);
  const rotom=inst(ROTOM,{energyAttached:[],toolAttached:amp1,extraTools:[amp2]});
  const s=base(rotom,[],inst(RKMON),[inst(BENCH)],3,6); // p0領先(3<6)
  const cost=pool.get(ROTOM).attacks[1].cost;
  const ok=canAffordAttack(s.players[0].active,cost,pool,s,0,'配件秀');
  assert.ok(!ok,'E領先不減費→0能量不可用');
});
console.log(`\n=== 火箭隊能量sweep+反擊增幅器疊加(v5.919): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
