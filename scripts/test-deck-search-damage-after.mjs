// v5.534 忍之利刃/玩偶捕捉/鉤爪搜尋「傷害+牌庫搜尋加手牌」效果先於傷害收斂
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-dsa.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-dsa.ts'); const O = join(ROOT, '.ent-dsa.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const GRENINJA='10292', DOLL='19176', NOCTOWL='9825';
const WATER='11175', PSY='11177', GARC='12702';
const ODDISH='14319', WAIL='19159';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(atkId, energies, defId){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:defId,count:1}]},pool);
  const en = energies.map(e=>inst(e));
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:Array.from({length:10},()=>inst(GARC)),discard:[],
              prizes:Array.from({length:6},()=>inst(GARC)),bench:[inst(GARC)],active:inst(atkId,{energyAttached:en})},
             {...s.players[1],hand:[],deck:[inst(defId)],discard:[],
              prizes:Array.from({length:6},()=>inst(defId)),bench:[inst(defId)],active:inst(defId)}]};
}
const atk=(st,idx,extra={})=>applyAction(st,{type:'ATTACK',attackIndex:idx,...extra},pool);
const resolve=(st,iids)=>applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:iids},pool);
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① 忍之利刃 KO情境：ATTACK後傷害延後→對手未KO+未拿獎+開搜尋picker',()=>{
  const a=atk(mk(GRENINJA,[WATER],ODDISH),0);
  assert(a.pendingSelection,'應開 pending');
  assert.equal(a.pendingSelection.type,'deck-search','pending 應 deck-search');
  assert(a.players[1].active && a.players[1].active.cardId===ODDISH,'傷害延後對手未KO，實='+a.players[1].active?.cardId);
  assert.equal(a.players[0].prizes.length,6,'未拿獎仍6，實='+a.players[0].prizes.length);
});
T('② 忍之利刃 RESOLVE選1張→搜到加手牌+才造170KO+拿1獎',()=>{
  const a=atk(mk(GRENINJA,[WATER],ODDISH),0);
  const pick=a.players[0].deck[0].iid;
  const r=resolve(a,[pick]);
  assert(!r.players[1].active || r.players[1].active.cardId!==ODDISH,'走路草應KO');
  assert.equal(r.players[0].prizes.length,5,'取1獎6→5，實='+r.players[0].prizes.length);
  assert(r.players[0].hand.some(c=>c.iid===pick),'搜到的卡應在手牌');
});
T('③ 忍之利刃 非KO：吼鯨王ex RESOLVE([])→170不KO+無獎+搜0',()=>{
  const a=atk(mk(GRENINJA,[WATER],WAIL),0);
  const r=resolve(a,[]);
  assert.equal(r.players[1].active?.damage,170,'吼鯨王受170，實='+r.players[1].active?.damage);
  assert.equal(r.players[0].prizes.length,6,'非KO無獎仍6');
  assert.equal(r.players[0].hand.length,0,'搜0手牌仍0');
});
T('④ 忍之利刃 選否(discardedEnergyIids:[])→不開picker直接造170',()=>{
  const a=atk(mk(GRENINJA,[WATER],WAIL),0,{discardedEnergyIids:[]});
  assert(!a.pendingSelection,'選否不開pending');
  assert.equal(a.players[1].active?.damage,170,'選否直接170，實='+a.players[1].active?.damage);
});
T('⑤ 玩偶捕捉(80)KO：ATTACK延後→RESOLVE才KO+拿獎',()=>{
  const a=atk(mk(DOLL,[PSY],ODDISH),0);
  assert(a.pendingSelection?.type==='deck-search','應開搜尋picker');
  assert(a.players[1].active?.cardId===ODDISH,'傷害延後未KO');
  const r=resolve(a,[]);
  assert(!r.players[1].active || r.players[1].active.cardId!==ODDISH,'80應KO走路草');
  assert.equal(r.players[0].prizes.length,5,'拿1獎');
});
T('⑥ 鉤爪搜尋(70)：吼鯨王ex RESOLVE([])→70傷害+maxCount2',()=>{
  const a=atk(mk(NOCTOWL,[WATER,WATER],WAIL),0);
  assert(a.pendingSelection?.type==='deck-search','應開搜尋picker');
  assert.equal(a.pendingSelection.maxCount,2,'鉤爪maxCount=2');
  const r=resolve(a,[]);
  assert.equal(r.players[1].active?.damage,70,'吼鯨王受70，實='+r.players[1].active?.damage);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
