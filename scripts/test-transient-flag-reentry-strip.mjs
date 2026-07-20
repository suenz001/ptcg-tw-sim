/**
 * v5.993 transient 回合旗標「離場→非場區→再入場」外洩守衛
 *
 * 真實案例(瑞士制假日賽-26 R4 dump matches[203]):黑夜魔靈用特性「咒詛炸彈」自爆KO
 * (棄牌卡帶 abilityUsedThisTurn:true)→ 聖灰放回牌庫(未裸化)→ 搜牌回手 → 神奇糖果
 * 進化第二隻黑夜魔靈 → buildEvolvedInstance spread ...evoInst 繼承 stale 旗標
 * → getUsableAbilities 被 abilityUsedThisTurn gate 擋 → 當回合咒詛炸彈按鈕不出現。
 *
 * 守衛面(全部 HEAD-FAIL @ v5.992):
 *  A. 完整根因鏈:第二隻糖果進化當回合咒詛炸彈必須可用
 *  B. 入場端白名單裸化:rare-candy / engine EVOLVE / PLAY_BASIC / placedBenchInstance
 *     對污染卡(abilityUsedThisTurn/cantAttackThisTurn/healedThisTurn/movedToActiveThisTurn/
 *     immuneToAllAttackNextTurn)一律 strip(含「殘留免疫」作弊向)
 *  C. 離場端裸化:聖灰(discard→deck)回牌庫的卡不得帶 transient 旗標
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.tfr-s.js'), E = join(ROOT,'.tfr-e.ts'), O = join(ROOT,'.tfr-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, getUsableAbilities } from './src/lib/game/engine';\nimport './src/lib/game/effects';\nexport { placedBenchInstance } from './src/lib/game/effects/_shared';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, getUsableAbilities, placedBenchInstance } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const YOMA='14732'/*夜巡靈*/, SAMA='14733'/*彷徨夜靈*/, YONO='14734'/*黑夜魔靈(H) 咒詛炸彈*/;
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const mk=()=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,activeStadium:null,
  players:[{name:'P1',active:inst(YOMA,{iid:'act'}),bench:[inst(YOMA,{iid:'b1'}),inst(YOMA,{iid:'b2'})],hand:[],deck:[inst(YOMA)],discard:[],prizes:[inst(YOMA),inst(YOMA),inst(YOMA),inst(YOMA),inst(YOMA),inst(YOMA)]},
           {name:'P2',active:inst(YOMA,{iid:'oa'}),bench:[inst(YOMA,{iid:'ob'})],hand:[],deck:[inst(YOMA)],discard:[],prizes:[inst(YOMA),inst(YOMA),inst(YOMA),inst(YOMA),inst(YOMA),inst(YOMA)]}]});
const rcPending=(stage2Iid,targetIid)=>({type:'heal-target',actorIdx:0,sourcePlayerIdx:0,minCount:1,maxCount:1,filter:'',effectKey:'rare-candy-evolve',params:{stage2Iid,validIids:[targetIid]}});
const TRANSIENTS=['abilityUsedThisTurn','cantAttackThisTurn','healedThisTurn','movedToActiveThisTurn','immuneToAllAttackNextTurn'];
const dirty=()=>Object.fromEntries(TRANSIENTS.map(k=>[k,true]));
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★A 根因鏈:糖果進化→咒詛炸彈自爆→聖灰回牌庫→回手→糖果進化第二隻,咒詛炸彈當回合可用', () => {
  let st = mk(); st.players[0].hand=[inst(YONO,{iid:'h1'})];
  st.pendingSelection = rcPending('h1','b1');
  st = applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['b1']},pool);
  assert.equal(getUsableAbilities(st,pool).filter(u=>u.iid==='b1').length,1,'第一隻咒詛炸彈應可用');
  st = applyAction(st,{type:'USE_ABILITY',iid:'b1',abilityIndex:0},pool);
  assert.equal(st.pendingSelection?.effectKey,'cursed-bomb','應開咒詛炸彈選目標');
  st = applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['oa']},pool);
  const dead = st.players[0].discard.find(c=>c.cardId===YONO);
  assert.ok(dead,'自爆後黑夜魔靈應在棄牌區');
  // 聖灰放回牌庫
  st.pendingSelection={type:'heal-target',actorIdx:0,sourcePlayerIdx:0,minCount:0,maxCount:5,filter:'',effectKey:'sacred-ash-discard-to-deck',params:{validIids:[dead.iid]}};
  st = applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:[dead.iid]},pool);
  const back = st.players[0].deck.find(c=>c.iid===dead.iid);
  assert.ok(back,'聖灰後應在牌庫');
  // 搜牌回手(鬥子等搜牌路徑 deck→hand 不轉換,等價直移)
  st = structuredClone(st);
  st.players[0].deck = st.players[0].deck.filter(c=>c.iid!==back.iid);
  st.players[0].hand = [...st.players[0].hand, back];
  // 第二隻糖果進化
  st.pendingSelection = rcPending(back.iid,'b2');
  st = applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['b2']},pool);
  const ev2 = st.players[0].bench.find(b=>b.iid==='b2');
  assert.equal(ev2?.cardId,YONO,'第二隻應已進化為黑夜魔靈');
  assert.ok(!ev2.abilityUsedThisTurn,`進化體不得繼承 abilityUsedThisTurn(=${ev2.abilityUsedThisTurn})`);
  const u = getUsableAbilities(st,pool).filter(x=>x.iid==='b2');
  assert.equal(u.length,1,'第二隻咒詛炸彈當回合必須可用(dump matches[203] 實戰 bug)');
});

T('★B1 rare-candy:污染 stage2 在手 → 進化體全旗標清除', () => {
  let st=mk(); st.players[0].hand=[{iid:'h1',cardId:YONO,damage:0,energyAttached:[],...dirty()}];
  st.pendingSelection = rcPending('h1','b1');
  st = applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['b1']},pool);
  const ev=st.players[0].bench.find(b=>b.iid==='b1');
  const leaked=TRANSIENTS.filter(k=>ev?.[k]);
  assert.deepEqual(leaked,[],'外洩旗標:'+leaked.join(','));
});
T('★B2 engine EVOLVE:污染 stage1 在手 → 進化體全旗標清除', () => {
  let st=mk(); st.players[0].hand=[{iid:'h2',cardId:SAMA,damage:0,energyAttached:[],...dirty()}];
  st = applyAction(st,{type:'EVOLVE',fromIid:'b1',toIid:'h2'},pool);
  const ev=st.players[0].bench.find(b=>b.iid==='b1');
  assert.equal(ev.cardId,SAMA,'應進化');
  const leaked=TRANSIENTS.filter(k=>ev?.[k]);
  assert.deepEqual(leaked,[],'外洩旗標:'+leaked.join(','));
});
T('★B3 PLAY_BASIC:污染 basic 在手 → 上場全旗標清除(含殘留免疫作弊向)', () => {
  let st=mk(); st.players[0].hand=[{iid:'h3',cardId:YOMA,damage:0,energyAttached:[],...dirty()}];
  st = applyAction(st,{type:'PLAY_BASIC',iid:'h3'},pool);
  const pl=st.players[0].bench.find(b=>b.iid==='h3');
  assert.ok(pl,'應上備戰');
  const leaked=TRANSIENTS.filter(k=>pl?.[k]);
  assert.deepEqual(leaked,[],'外洩旗標:'+leaked.join(','));
});
T('★B4 placedBenchInstance:污染卡 → 白名單裸化 + justPlaced', () => {
  const r=placedBenchInstance({iid:'x',cardId:YOMA,damage:50,energyAttached:[inst(YOMA)],...dirty()});
  const leaked=TRANSIENTS.filter(k=>r?.[k]);
  assert.deepEqual(leaked,[],'外洩旗標:'+leaked.join(','));
  assert.equal(r.justPlaced,true); assert.equal(r.damage,0); assert.equal(r.energyAttached.length,0);
});
T('★C 聖灰:回牌庫的卡一律裸化(不帶 transient 旗標)', () => {
  let st=mk();
  st.players[0].discard=[{iid:'d1',cardId:YONO,damage:170,energyAttached:[],...dirty()}];
  st.pendingSelection={type:'heal-target',actorIdx:0,sourcePlayerIdx:0,minCount:0,maxCount:5,filter:'',effectKey:'sacred-ash-discard-to-deck',params:{validIids:['d1']}};
  st = applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['d1']},pool);
  const back=st.players[0].deck.find(c=>c.iid==='d1');
  assert.ok(back,'應回牌庫');
  const leaked=TRANSIENTS.filter(k=>back?.[k]);
  assert.deepEqual(leaked,[],'外洩旗標:'+leaked.join(','));
  assert.equal(back.damage,0,'damage 應歸零');
});

console.log(`\ntransient旗標再入場守衛(v5.993):PASS ${pass} / FAIL ${fail}`);
process.exit(fail?1:0);
