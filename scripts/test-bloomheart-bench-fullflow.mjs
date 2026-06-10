// v5.529：大力鱷|奔流之心 在【備戰區】發動設 damageBonusThisTurn=120，scrubBenchStatus 不該清掉
//   (原誤把加傷 buff 當鎖清除)；換位到戰鬥場後攻擊駭浪應 160+120=280。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-bh.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-bh.ts'); const O = join(ROOT, '.ent-bh.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const FERA='16639', WATER='18519';
let BIGBASIC=null; for(const[id,c]of pool){if(c.supertype==='Pokemon'&&c.stage==='Basic'&&c.subtype!=='ex'&&c.hp>=200&&!(c.abilities||[]).length){BIGBASIC=id;break;}}
if(!BIGBASIC){for(const[id,c]of pool){if(c.supertype==='Pokemon'&&c.stage==='Basic'&&c.subtype!=='ex'&&c.hp>=120&&!(c.abilities||[]).length){BIGBASIC=id;break;}}}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 備戰大力鱷 USE_ABILITY 奔流之心 → buff 不被 scrub 清掉(damageBonusThisTurn=120 留在備戰)',()=>{
  const s=createGame({name:'P1',entries:[{cardId:FERA,count:1}]},{name:'P2',entries:[{cardId:BIGBASIC,count:1}]},pool);
  const fera=inst(FERA,{energyAttached:[inst(WATER),inst(WATER)]});
  const filler=inst(BIGBASIC,{energyAttached:[inst(WATER),inst(WATER),inst(WATER),inst(WATER)]});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(FERA)],discard:[],prizes:Array.from({length:6},()=>inst(FERA)),bench:[fera],active:filler},
             {...s.players[1],hand:[],deck:[inst(BIGBASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BIGBASIC)),bench:[],active:inst(BIGBASIC)}]};
  const n=applyAction(st,{type:'USE_ABILITY',iid:fera.iid,abilityIndex:0},pool);
  const fb=n.players[0].bench.find(c=>c.iid===fera.iid);
  assert.equal(fb?.damage,50,'5指示物應放上(damage=50)');
  assert.equal(fb?.damageBonusThisTurn,120,'★ 奔流之心 +120 buff 應留在備戰(不被scrub)，實際='+fb?.damageBonusThisTurn);
});

T('②★ 完整流程：備戰用奔流之心 → 撤退換位到戰鬥場 → 攻擊駭浪 = 160+120 = 280',()=>{
  const s=createGame({name:'P1',entries:[{cardId:FERA,count:1}]},{name:'P2',entries:[{cardId:BIGBASIC,count:1}]},pool);
  const fera=inst(FERA,{energyAttached:[inst(WATER),inst(WATER)]});
  const filler=inst(BIGBASIC,{energyAttached:[inst(WATER),inst(WATER),inst(WATER),inst(WATER)]});
  const oppA=inst(BIGBASIC); // 高HP存活
  let n={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(FERA)],discard:[],prizes:Array.from({length:6},()=>inst(FERA)),bench:[fera],active:filler},
             {...s.players[1],hand:[],deck:[inst(BIGBASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BIGBASIC)),bench:[],active:oppA}]};
  n=applyAction(n,{type:'USE_ABILITY',iid:fera.iid,abilityIndex:0},pool);   // 備戰發動
  n=applyAction(n,{type:'RETREAT',newActiveIid:fera.iid},pool);             // 撤退換位
  assert.equal(n.players[0].active?.iid,fera.iid,'大力鱷應換位到戰鬥場，實際='+n.players[0].active?.cardId);
  assert.equal(n.players[0].active?.damageBonusThisTurn,120,'換位後 buff 應保留，實際='+n.players[0].active?.damageBonusThisTurn);
  n=applyAction(n,{type:'ATTACK',attackIndex:0},pool);                      // 駭浪
  // 280 會打死對手→改用 log 驗證 +120 實際套用(讀到 buff)；並確認基礎傷害日誌
  const logs=(n.log||[]).map(l=>l.message||l).join('\n');
  assert(/招式傷害 \+120（回合加傷效果）/.test(logs),'★ 駭浪應套用 +120 回合加傷(buff被讀到)，logs尾='+(n.log||[]).slice(-6).map(l=>l.message||l).join(' | '));
  assert(!/下回合加傷/.test(logs),'log 不該再有「下」字');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
