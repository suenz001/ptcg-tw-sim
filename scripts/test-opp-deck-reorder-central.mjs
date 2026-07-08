// v5.903 驗證：看對手牌庫上方N張並重排(天眼/攪亂雷達)收斂到中央 reorder-deck-top-apply(targetIdx=對手)。
//   卡面「查看對手的牌庫上方5張卡，以任意順序排列，放回牌庫上方」。原 UI 讀 actorIdx 牌庫→看不到對手牌;
//   local wave15 resolver 已移除,改中央 resolver 支援 targetIdx。
//   HEAD-FAIL：HEAD 的 pending effectKey='wave15-opp-deck-reorder'(非中央),且中央 resolver 無 targetIdx→
//   若走中央會排到攻擊方自己牌庫(corrupt)。修後 effectKey='reorder-deck-top-apply' targetIdx=對手,正確排對手。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.odr-s.js'), E = join(ROOT, '.odr-e.ts'), O = join(ROOT, '.odr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const FUMO='16795'/*哥德小童 天眼*/, RADAR_C='12793'/*火箭隊的天罩蟲 攪亂雷達*/, GRASS='11173';
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function mk(){
  // P0 攻擊方 active + 自己牌庫5張(a0..a4); P1 對手 active + 對手牌庫5張(b0..b4)
  const selfDeck=[0,1,2,3,4].map(i=>inst(GRASS));
  const oppDeck=[0,1,2,3,4].map(i=>inst(GRASS));
  return { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ME',active:inst(FUMO),bench:[],hand:[],deck:selfDeck,discard:[],prizes:[inst(GRASS)]},
             {name:'OP',active:inst(GRASS),bench:[],hand:[],deck:oppDeck,discard:[],prizes:[inst(GRASS)]}] };
}
function drive(attackerCid, key){
  const st=mk();
  st.players[0].active=inst(attackerCid);
  const selfBefore=st.players[0].deck.map(c=>c.iid);
  const oppBefore=st.players[1].deck.map(c=>c.iid);
  const post=mod.ATTACK_POST.get(key);
  assert(post,'找不到 ATTACK_POST '+key);
  const s1=post(st,0,pool);
  const sel=s1.pendingSelection;
  assert(sel && sel.type==='reorder-deck-top','應開 reorder-deck-top pending');
  // ★HEAD-FAIL 點:收斂到中央 effectKey + targetIdx=對手
  assert.equal(sel.effectKey,'reorder-deck-top-apply','effectKey 應收斂中央(HEAD=wave15→FAIL)');
  assert.equal(sel.params.targetIdx,1,'targetIdx 應=對手(1)');
  assert.equal(sel.sourcePlayerIdx,1,'sourcePlayerIdx 應=對手(1)');
  // 玩家把對手牌庫頂5張反序排列
  const reordered=[...oppBefore].reverse();
  const s2=mod.applyAction(s1,{type:'RESOLVE_SELECTION',effectKey:sel.effectKey,selectedIids:reordered,actorIdx:0},pool);
  const oppAfter=s2.players[1].deck.slice(0,5).map(c=>c.iid);
  const selfAfter=s2.players[0].deck.map(c=>c.iid);
  assert.deepEqual(oppAfter,reordered,'對手牌庫頂5張應反序;實際 '+oppAfter);
  assert.deepEqual(selfAfter,selfBefore,'攻擊方自己牌庫不應被動到');
  return true;
}
T('① 哥德小童|天眼:排對手牌庫頂5張(中央 targetIdx,攻擊方牌庫不動)',()=>drive(FUMO,'哥德小童|天眼'));
T('② 火箭隊的天罩蟲|攪亂雷達:同上',()=>drive(RADAR_C,'火箭隊的天罩蟲|攪亂雷達'));
console.log(`\n=== 對手牌庫重排收斂(v5.903): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
