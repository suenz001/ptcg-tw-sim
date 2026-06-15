// 從手牌丟棄為效果/代價的卡,對戰 log 要顯示丟棄的卡名(沐淨/交易/徹底丟棄/插入抽出/手部修剪器)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-dh.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-dh.ts'); const O = join(ROOT, '.ent-dh.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const GASTLY='14129'/*鬼斯 非規則基礎*/, EN='18520', SUP='14019'/*隨便支援者占位*/;
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const logStr=n=>(n.log||[]).map(l=>typeof l==='string'?l:(l.message||'')).join('\n');
const nameOf=cid=>pool.get(cid).name;
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

function baseState(hand,deck=[]){
  const s=createGame({name:'P1',entries:[{cardId:SUP,count:1}]},{name:'P2',entries:[{cardId:SUP,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',turn:2,activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand,deck,discard:[],prizes:Array.from({length:6},()=>inst(SUP)),bench:[],active:inst(SUP)},
             {...s.players[1],hand:[],deck:[inst(SUP)],discard:[],prizes:Array.from({length:6},()=>inst(SUP)),bench:[],active:inst(SUP)}]};
}
function resolve(state, sel, selectedIids){
  state={...state, pendingSelection: sel};
  return applyAction(state,{type:'RESOLVE_SELECTION',selectedIids},pool);
}

T('① 沐淨：丟棄的非規則寶可夢卡名顯示在 log',()=>{
  const g1=inst(GASTLY), keep=inst(EN);
  const st=baseState([g1,keep],[inst(EN),inst(EN),inst(EN),inst(EN)]);
  const n=resolve(st,{type:'hand-discard',actorIdx:0,sourcePlayerIdx:0,minCount:1,maxCount:2,effectKey:'m5-trainer-mokujou'},[g1.iid]);
  const lg=logStr(n);
  assert(lg.includes('沐淨')&&lg.includes(nameOf(GASTLY)),'沐淨 log 應含丟棄卡名「'+nameOf(GASTLY)+'」，log='+lg.split('\n').slice(-3).join(' | '));
});
T('② 交易：丟棄 2 張的卡名顯示在 log',()=>{
  const a=inst(GASTLY), b=inst(EN), c=inst(EN);
  const st=baseState([a,b,c],[inst(EN),inst(EN)]);
  const n=resolve(st,{type:'hand-discard',actorIdx:0,sourcePlayerIdx:0,minCount:2,maxCount:2,effectKey:'trade-draw-2'},[a.iid,b.iid]);
  const lg=logStr(n);
  assert(lg.includes('交易')&&lg.includes(nameOf(GASTLY)),'交易 log 應含丟棄卡名，log='+lg.split('\n').slice(-3).join(' | '));
});
T('③ 徹底丟棄(呆呆獸)：丟棄卡名顯示在 log',()=>{
  const a=inst(GASTLY), b=inst(EN);
  const st=baseState([a,b],[inst(EN),inst(EN)]);
  const n=resolve(st,{type:'hand-discard',actorIdx:0,sourcePlayerIdx:0,minCount:0,maxCount:2,effectKey:'m5-slowpoke-discard-all'},[a.iid]);
  const lg=logStr(n);
  assert(lg.includes('徹底丟棄')&&lg.includes(nameOf(GASTLY)),'徹底丟棄 log 應含卡名，log='+lg.split('\n').slice(-3).join(' | '));
});
T('④ 插入抽出(鑰圈兒)：丟棄卡名顯示在 log',()=>{
  const a=inst(GASTLY);
  const st=baseState([a],[inst(EN),inst(EN),inst(EN)]);
  const n=resolve(st,{type:'hand-discard',actorIdx:0,sourcePlayerIdx:0,minCount:1,maxCount:1,effectKey:'insert-and-draw-discard'},[a.iid]);
  const lg=logStr(n);
  assert(lg.includes('插入抽出')&&lg.includes(nameOf(GASTLY)),'插入抽出 log 應含卡名，log='+lg.split('\n').slice(-3).join(' | '));
});
T('⑤ 精神出局(太陽伊布ex)：丟棄對手手牌的卡名顯示在 log',()=>{
  const g=inst(GASTLY);
  const st=baseState([],[]);
  st.players[1]={...st.players[1],hand:[g]};
  const n=resolve(st,{type:'hand-discard',actorIdx:0,sourcePlayerIdx:1,minCount:1,maxCount:1,effectKey:'sunny-eevee-mental-out'},[g.iid]);
  const lg=logStr(n);
  // 對手手牌少了那張卡
  assert(n.players[1].hand.length===0,'對手手牌應被丟棄');
  assert(n.players[1].discard.some(c=>c.iid===g.iid),'卡應進對手棄牌區');
  // log 公開顯示卡名
  assert(lg.includes('精神出局')&&lg.includes(nameOf(GASTLY)),'精神出局 log 應含丟棄卡名「'+nameOf(GASTLY)+'」，log='+lg.split('\n').slice(-3).join(' | '));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
