// Bug1: 沉重接力棒(吼鯨王ex) 走中央 helper KO → 觸發 TOOL_ON_KO（heavy-baton picker）
// Bug2: 閃焰渦輪 牌庫無基本能量 → 仍開 deck-search view-picker（filter:any, maxCount:0）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-paths.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-onko.ts'); const O = join(ROOT, '.ent-onko.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';
export { dealAttackDamageToTarget, koTargetByAttackEffect } from './src/lib/game/effects';
export { ATTACK_POST } from './src/lib/game/effects/_shared';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { dealAttackDamageToTarget, koTargetByAttackEffect, createGame, ATTACK_POST } = await import(pathToFileURL(O).href);

const dir = join(ROOT,'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }

const WAILORD='19159', BATON='9907', FLAREON='13974';
const waterE=[...pool].find(([,c])=>c.supertype==='Energy'&&c.subtype==='Basic'&&/水|Water/.test(c.name+c.pokemonType))?.[0]
  || [...pool].find(([,c])=>c.supertype==='Energy'&&c.subtype==='Basic')?.[0];
const anyItem=[...pool].find(([,c])=>c.supertype==='Trainer')?.[0];
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(anyItem));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// ── Bug1: 中央 helper KO 吼鯨王ex(附沉重接力棒+5水能量) ──
function batonState(){
  const s=createGame({name:'P1',entries:[{cardId:WAILORD,count:1}]},{name:'P2',entries:[{cardId:WAILORD,count:1}]},pool);
  // P0=attacker, P1=defender(吼鯨王ex active 附 baton + 5 水能量 + 1 備戰)
  const wailord=inst(WAILORD,{ damage:0, toolAttached:inst(BATON),
    energyAttached:[inst(waterE),inst(waterE),inst(waterE),inst(waterE),inst(waterE)] });
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:[inst(WAILORD)], discard:[], prizes:prize(6), bench:[], active:inst(WAILORD,{energyAttached:[inst(waterE),inst(waterE),inst(waterE)]}) },
      { ...s.players[1], hand:[], deck:[inst(WAILORD)], discard:[], prizes:prize(6), bench:[inst(WAILORD)], active:wailord },
    ] };
}
T('Bug1 中央helper傷害KO吼鯨王ex → 觸發沉重接力棒 picker', ()=>{
  const st=batonState();
  const tIid=st.players[1].active.iid;
  const out=dealAttackDamageToTarget(st, 0, tIid, 400, pool); // 400≥330 KO
  assert(out.players[1].active===null, '吼鯨王ex 應被 KO');
  assert(out.pendingSelection && out.pendingSelection.effectKey==='heavy-baton-pick-energies',
    '應開沉重接力棒 picker，實際 pending='+(out.pendingSelection?.effectKey||'無'));
});
T('Bug1 候選為被KO寶可夢的基本水能量(最多3)', ()=>{
  const st=batonState();
  const out=dealAttackDamageToTarget(st, 0, st.players[1].active.iid, 400, pool);
  const valid=out.pendingSelection?.params?.validIids||[];
  assert.equal(valid.length, 3, '應 3 張候選基本能量，實際'+valid.length);
});
T('Bug1 效果昏厥(koTargetByAttackEffect)不觸發接力棒(卡面限傷害昏厥)', ()=>{
  const st=batonState();
  const out=koTargetByAttackEffect(st, 0, st.players[1].active, true, pool, '測試效果KO');
  assert(!out.pendingSelection || out.pendingSelection.effectKey!=='heavy-baton-pick-energies',
    '效果昏厥不該觸發接力棒');
});

// ── Bug2: 閃焰渦輪 牌庫無基本能量 → 開 view-picker ──
function flareonState(deckCards){
  const s=createGame({name:'P1',entries:[{cardId:FLAREON,count:1}]},{name:'P2',entries:[{cardId:FLAREON,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:deckCards.map(c=>inst(c)), discard:[], prizes:prize(6), bench:[inst(FLAREON)], active:inst(FLAREON,{energyAttached:[inst(waterE),inst(waterE)]}) },
      { ...s.players[1], hand:[], deck:[inst(FLAREON)], discard:[], prizes:prize(6), bench:[], active:inst(FLAREON) },
    ] };
}
const flarePost = ATTACK_POST.get('閃焰王牌|閃焰渦輪');
assert(flarePost, '找不到閃焰渦輪 ATTACK_POST');
T('Bug2 牌庫無基本能量(有其他卡) → 開 deck-search view-picker', ()=>{
  const out=flarePost(flareonState([anyItem,anyItem,anyItem]), 0, pool);
  assert(out.pendingSelection && out.pendingSelection.type==='deck-search',
    '應開 deck-search view-picker，實際='+(out.pendingSelection?.type||'無(被略過)'));
  assert.equal(out.pendingSelection.filter, 'any', 'filter 應為 any(顯示全牌庫)');
  assert.equal(out.pendingSelection.maxCount, 0, 'maxCount 應 0(僅檢視)');
});
T('Bug2 牌庫有基本能量 → 正常 BasicEnergy picker(可選)', ()=>{
  const out=flarePost(flareonState([waterE,waterE,anyItem]), 0, pool);
  assert(out.pendingSelection?.type==='deck-search' && out.pendingSelection.filter==='BasicEnergy' && out.pendingSelection.maxCount>0,
    '有能量應開可選 BasicEnergy picker');
});
T('Bug2 牌庫全空 → 略過(無可檢視)', ()=>{
  const out=flarePost(flareonState([]), 0, pool);
  assert(!out.pendingSelection, '牌庫空應略過不開 picker');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
