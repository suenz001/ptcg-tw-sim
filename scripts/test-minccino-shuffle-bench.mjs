// 小灰怪|挪動一下 完整流程:對手 active 無能量、bench 有能量 → 能選 bench 能量並改附(回歸+診斷)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.mv-s.mjs'), E = join(ROOT, '.mv-e.ts'), O = join(ROOT, '.mv-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const MINC='13731', PSY='14103', DEF='13163', W='18519';
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
function mk() {
  const s=createGame({name:'P1',entries:[{cardId:MINC,count:1}]},{name:'P2',entries:[{cardId:DEF,count:1}]},pool);
  const benchE=inst(W);
  const benchPoke=inst(DEF,{energyAttached:[benchE]});
  return { st:{...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {...s.players[0],hand:[],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),active:inst(MINC,{energyAttached:[inst(PSY)]}),bench:[]},
      {...s.players[1],hand:[],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),active:inst(DEF),bench:[benchPoke]}]},
    benchEid:benchE.iid, benchPid:benchPoke.iid };
}
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★對手active無能量、bench有能量 → 挪動一下開picker(非直接結束回合)', () => {
  const {st}=mk();
  const a=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert.equal(a.pendingSelection?.effectKey,'minccino-shuffle-pick-energy-anywhere','應開能量picker');
});

T('★完整流程:選bench能量→改附到對手active(能量真的移動)', () => {
  const {st,benchEid,benchPid}=mk();
  let a=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  // stage1 選 bench 能量
  a=applyAction(a,{type:'RESOLVE_SELECTION',senderIdx:0,actorIdx:0,effectKey:a.pendingSelection.effectKey,selectedIids:[benchEid]},pool);
  assert.equal(a.pendingSelection?.effectKey,'minccino-shuffle-attach-anywhere','應開選目標picker');
  // stage2 目標 = 對手 active(無能量那隻)
  const oppActiveIid=a.players[1].active.iid;
  a=applyAction(a,{type:'RESOLVE_SELECTION',senderIdx:0,actorIdx:0,effectKey:a.pendingSelection.effectKey,selectedIids:[oppActiveIid]},pool);
  const benchNow=a.players[1].bench.find(b=>b.iid===benchPid);
  const activeNow=a.players[1].active;
  assert.ok(!benchNow.energyAttached.some(e=>e.iid===benchEid),'bench 能量應已移走');
  assert.ok(activeNow.energyAttached.some(e=>e.iid===benchEid),'對手 active 應收到該能量');
});

console.log('\n挪動一下 bench 能量:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
