// v5.526：敏捷蟲|褪殼猛毒「將對手戰鬥寶可夢中毒+混亂；將這隻寶可夢與備戰互換」。
//   self-swap-active-bench resolver 先前未註冊→選了備戰卻不互換（玩家回報）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-ss.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-ss.ts'); const O = join(ROOT, '.ent-ss.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const NINJASK='12471', GRASS='14102';
let BASIC=null; for(const[id,c]of pool){if(c.supertype==='Pokemon'&&c.stage==='Basic'&&c.subtype!=='ex'&&c.hp>=60&&c.hp<=120&&!(c.abilities||[]).length){BASIC=id;break;}}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 褪殼猛毒：攻擊後 bench-choose 選備戰 → 真的互換(備戰升戰鬥、敏捷蟲退備戰)＋對手中毒混亂',()=>{
  const s=createGame({name:'P1',entries:[{cardId:NINJASK,count:1}]},{name:'P2',entries:[{cardId:BASIC,count:1}]},pool);
  const ninjask=inst(NINJASK,{energyAttached:[inst(GRASS),inst(GRASS)]});
  const benchMon=inst(BASIC);
  const oppActive=inst('16639'); // 大力鱷 hp180 存活
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(NINJASK)],discard:[],prizes:Array.from({length:6},()=>inst(NINJASK)),bench:[benchMon],active:ninjask},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst('16639')),bench:[],active:oppActive}]};
  let n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  // 應開 bench-choose pending
  assert.equal(n.pendingSelection?.type,'bench-choose','褪殼猛毒應開 bench-choose 互換 modal，實際='+JSON.stringify(n.pendingSelection?.type));
  assert.equal(n.pendingSelection?.effectKey,'self-swap-active-bench','effectKey 應為 self-swap-active-bench');
  // 對手中毒+混亂(招式效果)
  const oppStatuses=[n.players[1].active?.status,n.players[1].active?.secondaryStatus];
  assert(oppStatuses.includes('poisoned'),'對手應中毒，實際='+JSON.stringify(oppStatuses));
  assert(oppStatuses.includes('confused'),'對手應混亂，實際='+JSON.stringify(oppStatuses));
  // RESOLVE_SELECTION 選備戰 → 真互換
  n=applyAction(n,{type:'RESOLVE_SELECTION',selectedIids:[benchMon.iid]},pool);
  assert.equal(n.players[0].active?.iid,benchMon.iid,'★ 選的備戰寶可夢應升為戰鬥位，實際 active='+n.players[0].active?.iid);
  assert(n.players[0].bench.some(c=>c.iid===ninjask.iid),'敏捷蟲應退到備戰，bench='+JSON.stringify(n.players[0].bench.map(c=>c.iid)));
  assert(!n.pendingSelection,'互換後不應殘留 pending');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
