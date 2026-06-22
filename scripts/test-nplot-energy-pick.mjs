// N的謀劃:備戰多屬性能量必須讓玩家選哪張(非自動取末張) — v5.663
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.np-s.mjs'), E = join(ROOT, '.np-e.ts'), O = join(ROOT, '.np-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const NPLOT='17172', DEF='13163', DARK='14430', W='18519';
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
function mk() {
  const s=createGame({name:'P1',entries:[{cardId:NPLOT,count:1}]},{name:'P2',entries:[{cardId:DEF,count:1}]},pool);
  const dark=inst(DARK), water=inst(W);
  const benchPoke=inst(DEF,{energyAttached:[dark,water]});  // 末張=水
  const ncard=inst(NPLOT);
  return { st:{...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:1,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {...s.players[0],hand:[ncard],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),active:inst(DEF),bench:[benchPoke],supporterPlayedThisTurn:false},
      {...s.players[1],hand:[],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),active:inst(DEF),bench:[]}]},
    nIid:ncard.iid, darkIid:dark.iid, waterIid:water.iid, benchPid:benchPoke.iid };
}
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★出N的謀劃 → 開能量picker且含【惡】【水】兩張(玩家可選,非自動取末張)', () => {
  const {st,nIid,darkIid,waterIid}=mk();
  const a=applyAction(st,{type:'PLAY_TRAINER',iid:nIid},pool);
  assert.equal(a.pendingSelection?.type,'active-energy-discard','應開能量picker');
  assert.equal(a.pendingSelection?.effectKey,'n-plot-energy-move');
  const valid=a.pendingSelection?.params?.validIids||[];
  assert.ok(valid.includes(darkIid)&&valid.includes(waterIid),'picker候選須含惡+水兩張');
});

T('★玩家選【水】→ 水移到active、惡留在備戰(非系統幫選惡)', () => {
  const {st,nIid,darkIid,waterIid,benchPid}=mk();
  let a=applyAction(st,{type:'PLAY_TRAINER',iid:nIid},pool);
  a=applyAction(a,{type:'RESOLVE_SELECTION',senderIdx:0,actorIdx:0,effectKey:a.pendingSelection.effectKey,selectedIids:[waterIid]},pool);
  const active=a.players[0].active, bench=a.players[0].bench.find(b=>b.iid===benchPid);
  assert.ok(active.energyAttached.some(e=>e.iid===waterIid),'水應移到戰鬥場');
  assert.ok(bench.energyAttached.some(e=>e.iid===darkIid),'惡應留在備戰(未被自動移走)');
  assert.ok(!bench.energyAttached.some(e=>e.iid===waterIid),'水已離開備戰');
});

T('★可選2張(惡+水都移到active)', () => {
  const {st,nIid,darkIid,waterIid,benchPid}=mk();
  let a=applyAction(st,{type:'PLAY_TRAINER',iid:nIid},pool);
  a=applyAction(a,{type:'RESOLVE_SELECTION',senderIdx:0,actorIdx:0,effectKey:a.pendingSelection.effectKey,selectedIids:[darkIid,waterIid]},pool);
  const active=a.players[0].active, bench=a.players[0].bench.find(b=>b.iid===benchPid);
  assert.equal(active.energyAttached.length,2,'兩張都應移到戰鬥場');
  assert.equal(bench.energyAttached.length,0,'備戰能量清空');
});

console.log('\nN的謀劃 能量選擇:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
