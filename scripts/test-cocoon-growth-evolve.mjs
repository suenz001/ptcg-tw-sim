// v5.588：甲殼繭|增長繭 — ①進化時自動彈「是否使用」modal ②放置的繭設 justPlaced→同回合不可再進化。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.cg-e.ts'), O = join(ROOT, '.cg-o.mjs'), S = join(ROOT, '.cg-s.mjs');
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
const WURMPLE='14664', CASCOON='14665', SILCOON='14667', DUSTOX='14668', PSY='14103';
let iid=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
function mk(){
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active:inst(WURMPLE), bench:[], hand:[inst(CASCOON), inst(DUSTOX)],
        deck:[inst(SILCOON), ...Array.from({length:8},()=>en(PSY))], discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P0' },
      { active:inst(WURMPLE), bench:[], hand:[], deck:Array.from({length:8},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P1' },
    ] };
}
let pass=0,fail=0;
const ck=(l,c,e)=>{ if(c){pass++;console.log('  PASS',l);}else{fail++;console.log('  FAIL',l,e||'');} };

let s=mk();
const wurmpleIid=s.players[0].active.iid;
const cascoonHandIid=s.players[0].hand[0].iid;
const dustoxHandIid=s.players[0].hand[1].iid;

console.log('1) EVOLVE 刺尾蟲→甲殼繭 → 自動彈「增長繭 是否使用」modal');
s=applyAction(s,{type:'EVOLVE',fromIid:wurmpleIid,toIid:cascoonHandIid},pool);
ck('進化成功(active=甲殼繭)', s.players[0].active?.cardId===CASCOON, 'active='+s.players[0].active?.cardId);
ck('自動彈使用特性 modal', s.pendingSelection?.effectKey==='resolve-play-ability-prompt', 'pending='+JSON.stringify(s.pendingSelection?.effectKey));

console.log('2) 選「使用特性」→ 開牌庫搜尋甲殼繭/盾甲繭 picker');
s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:['yes']},pool);
ck('開 deck-search (silcoon-growth-cocoon)', s.pendingSelection?.effectKey==='silcoon-growth-cocoon', 'pending='+JSON.stringify(s.pendingSelection?.effectKey));

console.log('3) 從牌庫選 盾甲繭 放備戰 → 應設 justPlaced');
const silcoonDeckIid=s.players[0].deck.find(c=>c.cardId===SILCOON)?.iid;
s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[silcoonDeckIid]},pool);
const placed=s.players[0].bench.find(c=>c.cardId===SILCOON);
ck('盾甲繭已放到備戰', !!placed, 'bench='+JSON.stringify(s.players[0].bench.map(c=>c.cardId)));
ck('放置的盾甲繭 justPlaced===true', placed && placed.justPlaced===true, 'justPlaced='+(placed&&placed.justPlaced));

console.log('4) 同回合試圖 EVOLVE 盾甲繭→毒粉蛾 → 應被擋(剛上場不可進化)');
{
  const before=JSON.stringify(s.players[0].bench);
  const s2=applyAction(s,{type:'EVOLVE',fromIid:placed.iid,toIid:dustoxHandIid},pool);
  const stillSilcoon=s2.players[0].bench.find(c=>c.iid===placed.iid)?.cardId===SILCOON;
  const noDustox=!s2.players[0].bench.some(c=>c.cardId===DUSTOX) && s2.players[0].active?.cardId!==DUSTOX;
  ck('進化被擋(盾甲繭仍在備戰、未變毒粉蛾)', stillSilcoon && noDustox, 'bench='+JSON.stringify(s2.players[0].bench.map(c=>c.cardId)));
}
console.log('\n增長繭 進化提示+justPlaced PASS '+pass+' / FAIL '+fail);
process.exitCode=fail?1:0;
