// v5.583：爆炸頭水牛｜捲牆 (-60 對【無】基礎) 屬「特性傷害減免」，非弱抗 → 備戰被招式傷害(三重冰霜 snipe-multi)仍要減傷。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.cw-e.ts'), O = join(ROOT, '.cw-o.mjs'), S = join(ROOT, '.cw-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const KYUREM='10629', BUFFALO='14800', SNORLAX='18039', WATER='18519', METAL='14434';
let iid=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
function mk(benchDef){return{phase:'playing',turnPhase:'main',activePlayerIndex:0,turn:3,isFirstTurn:false,
  pendingPrizes:[0,0],log:[],pendingSelection:null,activeStadium:null,setupDone:[true,true],
  players:[
    {active:inst(KYUREM,[en(WATER),en(WATER),en(METAL),en(METAL),en(WATER)]),bench:[],hand:[],deck:Array.from({length:10},()=>en(WATER)),discard:[],prizes:Array.from({length:6},()=>en(WATER)),name:'P0'},
    {active:inst(SNORLAX),bench:benchDef,hand:[],deck:Array.from({length:10},()=>en(WATER)),discard:[],prizes:Array.from({length:6},()=>en(WATER)),name:'P1'},
  ]};}
let pass=0,fail=0;
const ck=(l,c,e)=>{if(c){pass++;console.log('  PASS',l);}else{fail++;console.log('  FAIL',l,e||'');}};
function snipeBench(benchDef,vIdx){
  let s=mk(benchDef); const vIid=s.players[1].bench[vIdx].iid;
  s=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  if(!s.pendingSelection||s.pendingSelection.effectKey!=='snipe-multi') return {err:'no snipe-multi pending: '+JSON.stringify(s.pendingSelection?.effectKey)};
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[vIid]},pool);
  return {state:s,victim:s.players[1].bench.find(c=>c.iid===vIid)};
}
console.log('1) 三重冰霜 打備戰卡比獸，場上 2 隻爆炸頭水牛(捲牆) → 110-60=50');
{ const r=snipeBench([inst(BUFFALO),inst(BUFFALO),inst(SNORLAX)],2);
  ck('無 err',!r.err,r.err);
  ck('備戰受 50 傷害（捲牆 -60 生效）',r.victim&&r.victim.damage===50,'實際='+(r.victim&&r.victim.damage)); }
console.log('2) 對照：只有 1 隻爆炸頭水牛 → 捲牆不滿足(≥2) → 受 110');
{ const r=snipeBench([inst(BUFFALO),inst(SNORLAX)],1);
  ck('無 err',!r.err,r.err);
  ck('備戰受 110 傷害（無減傷）',r.victim&&r.victim.damage===110,'實際='+(r.victim&&r.victim.damage)); }
console.log('\n捲牆備戰減傷收斂 PASS '+pass+' / FAIL '+fail);
process.exitCode=fail?1:0;
