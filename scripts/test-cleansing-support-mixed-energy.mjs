// v5.907 驗證：潔淨支援(拉帝歐斯)/金屬之路(勾帕路翁ex)「選任意數量能量卡改附」收斂到
//   active-energy-discard(scope=all-own) 個別能量 picker——可跨屬性自由勾選(1火1超),移到戰鬥/自身。
//   共用 swiftcursor-energy-pick resolver。原潔淨支援=鏈式 bench-choose+stepper 取末端N張(無法1火1超);
//   金屬之路=每次搬1張鋼+engine限1次(實際只搬1張)。
//   HEAD-FAIL：HEAD pending 是 bench-choose/heal-target(非 active-energy-discord+swiftcursor)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.cse-s.js'), E = join(ROOT, '.cse-e.ts'), O = join(ROOT, '.cse-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const RADIAS='14069', LATIOS='14070', FIRE='18518', PSY='11177', GRASS='14319', COBALION='18482', METAL='19240';
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const base={id:'t',phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],pendingPrizes:[0,0]};

T('① 潔淨支援：備戰 2火2超 → 可選 1火1超改附戰鬥寶可夢', () => {
  const em=inst(GRASS,{energyAttached:[inst(FIRE),inst(FIRE),inst(PSY),inst(PSY)]});
  const st={...base,players:[
    {name:'P0',active:inst(RADIAS,{movedToActiveThisTurn:true}),bench:[inst(LATIOS),em],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]},
    {name:'P1',active:inst(GRASS),bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]}]};
  const latiosIid=st.players[0].bench[0].iid;
  let r=applyAction(st,{type:'USE_ABILITY',iid:latiosIid,abilityIndex:0},pool);
  assert(r.pendingSelection,'應開 picker');
  assert.equal(r.pendingSelection.type,'active-energy-discard','應為能量實例 picker(HEAD=bench-choose→FAIL)');
  assert.equal(r.pendingSelection.effectKey,'swiftcursor-energy-pick','應共用 swiftcursor(HEAD=cleansing-support-pick-bench)');
  const emNow=r.players[0].bench[1];
  const fireIid=emNow.energyAttached.find(e=>e.cardId===FIRE).iid;
  const psyIid=emNow.energyAttached.find(e=>e.cardId===PSY).iid;
  r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[fireIid,psyIid],actorIdx:0},pool);
  const act=r.players[0].active.energyAttached.map(e=>e.cardId).sort();
  assert.deepEqual(act,[FIRE,PSY].sort(),'戰鬥位應得 1火1超;實際 '+act);
  const emAfter=r.players[0].bench[1].energyAttached.map(e=>e.cardId).sort();
  assert.deepEqual(emAfter,[FIRE,PSY].sort(),'備戰應留 1火1超;實際 '+emAfter);
});

T('② 金屬之路：備戰 2鋼 → 一次搬 2 鋼到勾帕路翁ex(非只1張)', () => {
  const em=inst(GRASS,{energyAttached:[inst(METAL),inst(METAL)]});
  const st={...base,players:[
    {name:'P0',active:inst(COBALION,{movedToActiveThisTurn:true}),bench:[em],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]},
    {name:'P1',active:inst(GRASS),bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]}]};
  const cobIid=st.players[0].active.iid;
  let r=applyAction(st,{type:'USE_ABILITY',iid:cobIid,abilityIndex:0},pool);
  assert(r.pendingSelection,'應開 picker');
  assert.equal(r.pendingSelection.type,'active-energy-discard','應為能量實例 picker(HEAD=heal-target→FAIL)');
  assert.equal(r.pendingSelection.effectKey,'swiftcursor-energy-pick','應共用 swiftcursor(HEAD=cobalion-metal-path)');
  const m=r.players[0].bench[0].energyAttached.map(e=>e.iid);
  r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:m,actorIdx:0},pool);
  const act=r.players[0].active.energyAttached.filter(e=>e.cardId===METAL).length;
  assert.equal(act,2,'勾帕路翁ex應得 2 鋼(HEAD 只搬1張=1);實際 '+act);
});
console.log(`\n=== 潔淨支援/金屬之路 個別選能量(v5.907): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
