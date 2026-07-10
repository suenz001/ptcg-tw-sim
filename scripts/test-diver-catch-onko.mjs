// v5.918 守衛:獵斑魚|潛者捕捉 — 自方【水】寶可夢(戰鬥場或備戰)受對手招式傷害昏厥時,
//   身上「基本【水】能量」可放回手牌(確認modal,可選)。多隻→一組組問(chain)。獵斑魚自身昏厥也觸發。
//   HEAD-FAIL:HEAD 僅戰鬥位直接KO觸發;備戰狙擊/多隻chain/自身備戰昏厥皆漏。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dc-s.js'), E = join(ROOT, '.dc-e.ts'), O = join(ROOT, '.dc-o.mjs');
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
const MELEE='11079'/*毛頭小鷹 30傷 2無色 非水*/, SNIPE='11050'/*拉帝歐斯 直擊飛行 atk0 選1隻50*/;
const MULTI='12585'/*大吾盔甲鳥 atk1 雙音波 2隻×50 cost鋼鋼無*/;
const DIVER='12774'/*獵斑魚 HP110 潛者捕捉 Water*/, SEA='10592'/*墨海馬 HP60 Water basic*/;
const WATER='17221', METAL='14434', BENCH='14319';
let PSYE=null; for(const [id,c] of pool){ if(c.supertype==='Energy'&&c.subtype==='Basic'&&(c.name||'').includes('【超】')){PSYE=id;break;} }
assert(pool.get(DIVER)?.abilities?.some(a=>a.name==='潛者捕捉'),'獵斑魚應有潛者捕捉');
assert.notEqual(pool.get(MELEE)?.pokemonType,'Water','毛頭小鷹應非水(負面案例用)');
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const wcount=(arr)=>arr.filter(c=>c.cardId===WATER).length;
function base(p0active,p0bench,p1active,p1bench){
  const s=createGame({name:'A',entries:[{cardId:MELEE,count:1}]},{name:'B',entries:[{cardId:DIVER,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s.players[0],hand:[],deck:[inst(BENCH)],discard:[],prizes:Array.from({length:6},()=>inst(BENCH)),bench:p0bench,active:p0active},
             {...s.players[1],hand:[],deck:[inst(BENCH)],discard:[],prizes:Array.from({length:6},()=>inst(BENCH)),bench:p1bench,active:p1active}]};
}
// A: active 獵斑魚 被 melee KO → modal → yes → 2水回手 (engine 主管線)
T('A. active獵斑魚被招式KO→modal→是→2水回手', () => {
  const atk=inst(MELEE,{energyAttached:[inst(WATER),inst(WATER)]});
  const diver=inst(DIVER,{damage:90,energyAttached:[inst(WATER),inst(WATER)]});
  let r=applyAction(base(atk,[],diver,[inst(BENCH)]),{type:'ATTACK',attackIndex:0},pool);
  assert.equal(r.pendingSelection?.effectKey,'diver-catch-confirm','A應開modal');
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'diver-catch-confirm',selectedIids:['yes'],actorIdx:1},pool);
  assert.equal(wcount(r.players[1].hand),2,'A應2水回手;實際='+wcount(r.players[1].hand));
});
// B: 備戰墨海馬被狙擊KO(獵斑魚在active) → modal → 是 → 2水回手 (effects fireDefenderOnKO)
T('B. 備戰水被狙擊KO(獵斑魚在active)→modal→是→2水回手', () => {
  const rad=inst(SNIPE,{energyAttached:[inst(PSYE),inst(WATER)]});
  const diver=inst(DIVER);
  const sea=inst(SEA,{damage:20,energyAttached:[inst(WATER),inst(WATER)]});
  let r=applyAction(base(rad,[],diver,[sea]),{type:'ATTACK',attackIndex:0},pool);
  if(r.pendingSelection && r.pendingSelection.effectKey!=='diver-catch-confirm')
    r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[sea.iid],actorIdx:0},pool);
  assert.equal(r.pendingSelection?.effectKey,'diver-catch-confirm','B備戰KO應開modal;實際='+(r.pendingSelection?.effectKey||'none'));
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'diver-catch-confirm',selectedIids:['yes'],actorIdx:1},pool);
  assert.equal(wcount(r.players[1].hand),2,'B應2水回手;實際='+wcount(r.players[1].hand));
});
// B2: 選「否」→ 水進棄牌
T('B2. 備戰水被狙擊KO→modal→否→2水進棄牌(不回手)', () => {
  const rad=inst(SNIPE,{energyAttached:[inst(PSYE),inst(WATER)]});
  const diver=inst(DIVER);
  const sea=inst(SEA,{damage:20,energyAttached:[inst(WATER),inst(WATER)]});
  let r=applyAction(base(rad,[],diver,[sea]),{type:'ATTACK',attackIndex:0},pool);
  if(r.pendingSelection && r.pendingSelection.effectKey!=='diver-catch-confirm')
    r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[sea.iid],actorIdx:0},pool);
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'diver-catch-confirm',selectedIids:['no'],actorIdx:1},pool);
  assert.equal(wcount(r.players[1].hand),0,'B2不應回手');
  assert.equal(wcount(r.players[1].discard),2,'B2應2水進棄牌;實際='+wcount(r.players[1].discard));
});
// C: 雙音波KO兩隻備戰水(獵斑魚active存活)→ chain 兩個modal 一組組問 → 各是 → 共4水回手
T('C. 多隻備戰水同時KO→一組組問(chain2)→皆是→共4水回手', () => {
  const atk=inst(MULTI,{energyAttached:[inst(METAL),inst(METAL),inst(WATER)]});
  const diver=inst(DIVER);
  const s1=inst(SEA,{damage:20,energyAttached:[inst(WATER),inst(WATER)]});
  const s2=inst(SEA,{damage:20,energyAttached:[inst(WATER),inst(WATER)]});
  let r=applyAction(base(atk,[],diver,[s1,s2]),{type:'ATTACK',attackIndex:1},pool);
  // 雙音波開2目標picker
  if(r.pendingSelection && r.pendingSelection.effectKey!=='diver-catch-confirm')
    r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[s1.iid,s2.iid],actorIdx:0},pool);
  assert.equal(r.pendingSelection?.effectKey,'diver-catch-confirm','C第1個modal;實際='+(r.pendingSelection?.effectKey||'none'));
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'diver-catch-confirm',selectedIids:['yes'],actorIdx:1},pool);
  assert.equal(r.pendingSelection?.effectKey,'diver-catch-confirm','C第2個modal(chain)應接續;實際='+(r.pendingSelection?.effectKey||'none'));
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'diver-catch-confirm',selectedIids:['yes'],actorIdx:1},pool);
  assert.equal(wcount(r.players[1].hand),4,'C應共4水回手;實際='+wcount(r.players[1].hand));
});
// D: 獵斑魚自身在備戰被狙擊KO → 自身潛者捕捉觸發(引用官方判例)
T('D. 獵斑魚自身備戰被狙擊KO→自身特性觸發modal', () => {
  const rad=inst(SNIPE,{energyAttached:[inst(PSYE),inst(WATER)]});
  const tank=inst(MELEE); // 非水 active,無關
  const diverBench=inst(DIVER,{damage:100,energyAttached:[inst(WATER),inst(WATER)]}); // 100+50=150>=110 KO
  let r=applyAction(base(rad,[],tank,[diverBench]),{type:'ATTACK',attackIndex:0},pool);
  if(r.pendingSelection && r.pendingSelection.effectKey!=='diver-catch-confirm')
    r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[diverBench.iid],actorIdx:0},pool);
  assert.equal(r.pendingSelection?.effectKey,'diver-catch-confirm','D獵斑魚自身備戰昏厥應觸發;實際='+(r.pendingSelection?.effectKey||'none'));
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:'diver-catch-confirm',selectedIids:['yes'],actorIdx:1},pool);
  assert.equal(wcount(r.players[1].hand),2,'D應2水回手;實際='+wcount(r.players[1].hand));
});
// E(負面): 非水寶可夢被KO不觸發(即使獵斑魚在場)
T('E. 非水寶可夢被狙擊KO不觸發diver(獵斑魚在active)', () => {
  const rad=inst(SNIPE,{energyAttached:[inst(PSYE),inst(WATER)]});
  const diver=inst(DIVER);
  const nonwater=inst(MELEE,{damage:40,energyAttached:[inst(WATER),inst(WATER)]}); // HP? melee基礎 40+50 KO
  let r=applyAction(base(rad,[],diver,[nonwater]),{type:'ATTACK',attackIndex:0},pool);
  if(r.pendingSelection && r.pendingSelection.effectKey!=='diver-catch-confirm')
    r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[nonwater.iid],actorIdx:0},pool);
  assert.notEqual(r.pendingSelection?.effectKey,'diver-catch-confirm','E非水不應觸發diver');
});
console.log(`\n=== 潛者捕捉 on-KO 中央收斂(v5.918): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
