// 振翼髮|暗夜羽擊(我方戰鬥場) 應消除對手 桃歹郎|劇毒支配(+50中毒)。玩家報沒擋住。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-mt.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-mt.ts'); const O = join(ROOT, '.ent-mt.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const MOON='16826' /*振翼髮 暗夜羽擊*/, TOXIC='16961' /*桃歹郎 劇毒支配*/, PLAIN='14326' /*蓋諾賽克特 無特性*/;
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(myActiveId){
  const s=createGame({name:'P1',entries:[{cardId:myActiveId,count:1}]},{name:'P2',entries:[{cardId:TOXIC,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(myActiveId)],discard:[],prizes:Array.from({length:6},()=>inst(myActiveId)),bench:[inst(myActiveId)],active:inst(myActiveId,{status:'poisoned'})},
             {...s.players[1],hand:[],deck:[inst(TOXIC)],discard:[],prizes:Array.from({length:6},()=>inst(TOXIC)),bench:[inst(TOXIC)],active:inst(TOXIC)}]};
}
const dmgAfter=s=>{ const n=applyAction(s,{type:'END_TURN'},pool); return {dmg:n.players[0].active?.damage, log:n.log.filter(l=>String(l.message).includes('中毒')).map(l=>l.message)}; };
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 我方振翼髮(暗夜羽擊)中毒 + 對手桃歹郎(劇毒支配) → 劇毒支配被消除，中毒僅 10',()=>{
  const r=dmgAfter(mk(MOON));
  assert.equal(r.dmg,10,'暗夜羽擊應消除劇毒支配，中毒應 10，實際'+r.dmg+' | '+r.log.join(';'));
});
T('② regression：我方無特性寶可夢中毒 + 對手桃歹郎(劇毒支配) → +50，中毒 60',()=>{
  const r=dmgAfter(mk(PLAIN));
  assert.equal(r.dmg,60,'劇毒支配應 +50，中毒應 60，實際'+r.dmg+' | '+r.log.join(';'));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
