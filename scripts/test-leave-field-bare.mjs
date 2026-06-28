// v5.740：離場/進化時實體必須走中央裸化(toBareCard 白名單),不可手動黑名單漏旗標。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-lf.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-lf.ts'); const O=join(ROOT,'.ent-lf.mjs');
writeFileSync(E,`import './src/lib/game/engine';
export { ATTACK_POST, ABILITY_EFFECTS, RESOLVERS } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, ABILITY_EFFECTS, RESOLVERS }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);
    if(!byName.has(c.name))byName.set(c.name,String(c.id));}}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const basicEnergyId=(()=>{for(const[id,c]of pool)if(c.supertype==='Energy'&&(c.subtype==='Basic'||!c.subtype)&&/雷|電/.test(c.name||''))return id;
  for(const[id,c]of pool)if(c.supertype==='Energy')return id;return null;})();
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const anyId=byName.get([...byName.keys()][0]);
function baseState(active0){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    activeStadium:null,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],log:[],
    players:[
      {name:'A',hand:[],deck:[inst(anyId)],discard:[],prizes:[],bench:[],active:active0,energyZoneUsedThisTurn:false},
      {name:'B',hand:[],deck:[],discard:[],prizes:[],bench:[],active:inst(anyId),energyZoneUsedThisTurn:false},
    ]};
}
T('電飛鼠|天空迴旋:回手牌主體清三層狀態+damage歸0+能量分離',()=>{
  const fn=ATTACK_POST.get('電飛鼠|天空迴旋'); assert.ok(fn,'找不到 天空迴旋 regPost');
  const eId=byName.get('電飛鼠'); assert.ok(eId,'pool無電飛鼠');
  const active=inst(eId,{status:'asleep',secondaryStatus:'poisoned',tertiaryStatus:'burned',damage:50,
    energyAttached:[inst(basicEnergyId)], immune:true, weaknessOverride:'Fire'});
  let st=baseState(active); st=fn(st,0,pool);
  const hand=st.players[0].hand;
  const body=hand.find(c=>c.cardId===String(eId)); assert.ok(body,'電飛鼠主體應回手牌');
  assert.ok(!body.status&&!body.secondaryStatus&&!body.tertiaryStatus,'三層狀態應清,實際='+[body.status,body.secondaryStatus,body.tertiaryStatus]);
  assert.equal(body.damage,0,'damage應歸0,實際='+body.damage);
  assert.ok(!body.immune&&!body.weaknessOverride,'效果旗標應清');
  assert.equal(body.energyAttached.length,0,'主體能量應清空');
  assert.ok(hand.some(c=>c.cardId===String(basicEnergyId)),'附加能量應分離回手牌');
});
T('土龍節節|逃跑抽出:回牌庫主體清三層狀態+damage歸0+能量分離',()=>{
  const fn=ABILITY_EFFECTS.get('土龍節節|0'); assert.ok(fn,'找不到 逃跑抽出 regA');
  const tId=byName.get('土龍節節'); assert.ok(tId,'pool無土龍節節');
  const active=inst(tId,{status:'confused',secondaryStatus:'poisoned',damage:30,energyAttached:[inst(basicEnergyId)],takeExtraDamage:20});
  let st=baseState(active); st=fn(st,0,pool,active);
  const deck=st.players[0].deck;
  const body=deck.find(c=>c.cardId===String(tId)); assert.ok(body,'土龍節節主體應回牌庫');
  assert.ok(!body.status&&!body.secondaryStatus&&!body.tertiaryStatus,'三層狀態應清,實際='+[body.status,body.secondaryStatus,body.tertiaryStatus]);
  assert.equal(body.damage,0,'damage應歸0,實際='+body.damage);
  assert.ok(!body.takeExtraDamage,'效果旗標應清');
  assert.ok(deck.some(c=>c.cardId===String(basicEnergyId)),'附加能量應分離回牌庫');
});
T('賽吉 sage-evolve:進化體清除特殊狀態+保留傷害能量',()=>{
  const fn=RESOLVERS.get('sage-evolve'); assert.ok(fn,'找不到 sage-evolve resolver');
  let evoId=null, baseName=null;
  for(const[id,c]of pool){ if(c.supertype==='Pokemon'&&c.subtype==='Stage1'&&c.evolvesFrom&&byName.has(c.evolvesFrom)){evoId=id;baseName=c.evolvesFrom;break;} }
  assert.ok(evoId,'找不到 Stage1+basic 配對');
  const baseId=byName.get(baseName);
  const base=inst(baseId,{status:'asleep',secondaryStatus:'poisoned',damage:20,energyAttached:[inst(basicEnergyId)]});
  const evo=inst(evoId);
  let st=baseState(base); st.players[0].deck=[evo];
  st=fn(st,0,[evo.iid],{},pool);
  const a=st.players[0].active;
  assert.equal(a.cardId,String(evoId),'應已進化');
  assert.ok(!a.status,'進化應清睡眠,實際status='+a.status);
  assert.equal(a.damage,20,'進化應保留傷害,實際='+a.damage);
  assert.equal(a.energyAttached.length,1,'進化應保留能量');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
