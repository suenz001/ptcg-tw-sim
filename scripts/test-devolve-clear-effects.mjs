// 退化清除特殊狀態+附加效果(收斂 clearActiveEffects):退化光線/奇異時鐘/阿賽斯特萊石 — v5.672
// 原只清 7 旗標,漏 takeExtraDamageNextTurn 等效果旗標;PDF §II-C-13 應全清(保留 damage/能量/道具)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.dv-s.mjs'),E=join(ROOT,'.dv-e.ts'),O=join(ROOT,'.dv-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { createGame, applyAction } from './src/lib/game/engine';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const MUKU='18467'/*念力土偶 退化光線*/, FIGHT='14104', EVOLVED='14465'/*土龍節節 Stage1*/, BASE='13163', W='18519';
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
const benchE=inst(W);
const oppActive=inst(EVOLVED,{
  evolvedFromStack:[inst(BASE)], energyAttached:[benchE], damage:10,
  status:'asleep',                    // 行動類狀態(在原7清單,控制組)
  takeExtraDamageNextTurn:20,         // ★效果旗標,原7清單沒清 → 應被清
  weaknessOverrideTypeNextTurn:'Fire',// ★另一效果旗標
});
const s=createGame({name:'P1',entries:[{cardId:MUKU,count:1}]},{name:'P2',entries:[{cardId:EVOLVED,count:1}]},pool);
const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
  setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
  players:[
    {...s.players[0],hand:[],deck:[inst(BASE)],discard:[],prizes:Array.from({length:6},()=>inst(BASE)),active:inst(MUKU,{energyAttached:[inst(FIGHT)]}),bench:[]},
    {...s.players[1],hand:[],deck:[inst(BASE)],discard:[],prizes:Array.from({length:6},()=>inst(BASE)),active:oppActive,bench:[]}]};
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

const out=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
const opp=out.players[1].active;

T('★退化光線後對手已退化(cardId 變回基礎)', () => {
  assert.ok(opp!==null,'對手不應為 null');
  assert.notEqual(opp.cardId, EVOLVED, '應已退化(非土龍節節)');
});
T('★退化清掉 takeExtraDamageNextTurn(原 7 清單漏的效果旗標)', () => {
  assert.equal(opp.takeExtraDamageNextTurn, undefined, 'takeExtraDamageNextTurn 應被清(原碼會殘留)');
});
T('★退化清掉 weaknessOverrideTypeNextTurn', () => {
  assert.equal(opp.weaknessOverrideTypeNextTurn, undefined);
});
T('退化清掉 status(控制:原本就清)', () => {
  assert.equal(opp.status, undefined);
});
T('退化保留能量(PDF:保留能量/道具/傷害)', () => {
  assert.ok(opp.energyAttached.some(e=>e.iid===benchE.iid),'水能量應保留');
  assert.ok(opp.damage>0,'傷害應保留(退化前10+退化光線50)');
});

console.log('\n退化清除效果:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
