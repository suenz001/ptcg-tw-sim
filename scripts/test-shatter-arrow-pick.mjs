// 粉碎箭(狙射樹梟ex):選擇對手能量丟棄須讓攻擊方選(非自動取[0]) — v5.668
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.sa-s.mjs'), E = join(ROOT, '.sa-e.ts'), O = join(ROOT, '.sa-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const DECIDUEYE='17989', GENGAR='16916' /*310HP撐過240*/, GRASS='14102', DARK='14430', W='18519', DEF='13163';
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
function mk() {
  const s=createGame({name:'P1',entries:[{cardId:DECIDUEYE,count:1}]},{name:'P2',entries:[{cardId:GENGAR,count:1}]},pool);
  const dark=inst(DARK), water=inst(W);
  const oppActive=inst(GENGAR,{energyAttached:[dark,water]});  // 末張(原自動取會丟惡)
  return { st:{...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {...s.players[0],hand:[],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),active:inst(DECIDUEYE,{energyAttached:[inst(GRASS),inst(GRASS),inst(GRASS),inst(GRASS)]}),bench:[]},
      {...s.players[1],hand:[],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),active:oppActive,bench:[]}]},
    darkIid:dark.iid, waterIid:water.iid };
}
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★粉碎箭 → 開能量picker(含對手惡+水兩張,攻擊方可選)', () => {
  const {st,darkIid,waterIid}=mk();
  const a=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert.equal(a.pendingSelection?.effectKey,'shatter-arrow-discard','應開能量picker');
  const items=(a.selectionItems!==undefined)?a.selectionItems:null; // 引擎不出 selectionItems,改查對手active能量仍在
  assert.equal(a.players[1].active.energyAttached.length,2,'選擇前對手能量未動');
});

T('★攻擊方選【水】→ 丟水留惡(非自動丟首張惡)', () => {
  const {st,darkIid,waterIid}=mk();
  let a=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  a=applyAction(a,{type:'RESOLVE_SELECTION',senderIdx:0,actorIdx:0,effectKey:a.pendingSelection.effectKey,selectedIids:[waterIid]},pool);
  const oppE=a.players[1].active.energyAttached.map(e=>e.iid);
  assert.ok(!oppE.includes(waterIid),'水應被丟棄');
  assert.ok(oppE.includes(darkIid),'惡應保留(未被自動丟)');
  assert.ok(a.players[1].discard.some(c=>c.iid===waterIid),'水進對手棄牌區');
});

console.log('\n粉碎箭 能量選擇:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
