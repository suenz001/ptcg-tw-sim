// 回歸測試 v5.984：退化子維度中央管線 buildDevolvedInstance
// Bug2 奧密之眼 dup-iid + 憑空複製卡 + validIids；Bug3 原始之翼 ability-gate + 清全旗標；
// Bug4 暈眩山谷「就算進化・退化，【混亂】也不會恢復」全退化站例外。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s-dv.js'),E=join(ROOT,'.x-e-dv.ts'),O=join(ROOT,'.x-o-dv.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,
  "export { ATTACK_POST, RESOLVERS, ABILITIES } from './src/lib/game/effects/_shared';\n"+
  "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){
  if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);
}
const byName=n=>{for(const [id,c] of pool)if(c.name===n)return id;return null;};
// 找 base+evo 對
let baseId=null,evoId=null;
for(const [id,c] of pool){if((c.supertype||'').startsWith('Pok')&&c.evolvesFrom){
  for(const [bid,bc] of pool)if((bc.supertype||'').startsWith('Pok')&&bc.name===c.evolvesFrom){baseId=bid;evoId=id;break;}
  if(baseId)break;}}
assert(baseId&&evoId,'找不到 base+evo');
const stadiumId=byName('暈眩山谷'); assert(stadiumId,'找不到暈眩山谷');
const mk=(cid,o={})=>({iid:o.iid??('i'+cid),cardId:String(cid),damage:0,energyAttached:[],
  status:null,secondaryStatus:null,tertiaryStatus:null,toolAttached:null,extraTools:[],...o});
// 已進化的實體(evolvedFromStack 有 base)
const evolvedInst=(o={})=>mk(evoId,{evolvedFromStack:[{iid:'basecard',cardId:String(baseId)}],...o});
function st(oppActive,extra={}){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,
    log:[],pendingSelection:null,setupDone:[true,true],activeStadium:null,
    players:[{name:'A',active:mk(baseId,{iid:'atk'}),bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
      {name:'B',active:oppActive,bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}],...extra};
}
let pass=0,fail=0; const ck=(n,c)=>{if(c)pass++;else{fail++;console.log('  ✗',n);}};

// ── Bug2 奧密之眼 ──
{
  const post=mod.ATTACK_POST.get('超能豔鴕|奧密之眼');
  ck('奧密之眼 有註冊',!!post);
  if(post){
    const out=post(st(evolvedInst({iid:'oppAct'})),0,pool,{});
    const ps=out.pendingSelection;
    ck('Bug2 pending 帶 validIids(禁選基礎→杜絕憑空複製卡)',Array.isArray(ps?.params?.validIids)&&ps.params.validIids.includes('oppAct'));
  }
  const r=mod.RESOLVERS?.get?.('h-wave3-devolve');
  ck('奧密之眼 resolver 存在',!!r);
  if(r){
    const s0=st(evolvedInst({iid:'oppAct',damage:20}));
    const out=r(s0,0,['oppAct'],{},pool);
    const d=out.players[1].active, hand=out.players[1].hand;
    ck('Bug2 退化後保留場上 iid',d.iid==='oppAct');
    ck('Bug2 退化後保留 damage',d.damage===20);
    ck('Bug2 回手牌 1 張',hand.length===1);
    ck('Bug2 回手卡 iid 不與場上撞(dup-iid已修)',hand[0]?.iid!==d.iid);
    // 基礎寶可夢目標 → 不得憑空複製卡
    const s1=st(mk(baseId,{iid:'oppBasic'}));
    const o1=r(s1,0,['oppBasic'],{},pool);
    ck('Bug2 選基礎→不憑空複製卡進手牌',o1.players[1].hand.length===0);
  }
}
// ── Bug4 暈眩山谷:退化保留混亂(奧密之眼為例) ──
{
  const r=mod.RESOLVERS?.get?.('h-wave3-devolve');
  if(r){
    const noStad=r(st(evolvedInst({iid:'oppAct',status:'confused'})),0,['oppAct'],{},pool);
    ck('無暈眩山谷→退化清混亂',noStad.players[1].active.status!=='confused');
    const withStad=r(st(evolvedInst({iid:'oppAct',status:'confused'}),
      {activeStadium:{iid:'std',cardId:String(stadiumId)}}),0,['oppAct'],{},pool);
    ck('Bug4 暈眩山谷在場→退化仍保留【混亂】',withStad.players[1].active.status==='confused');
  }
}
// ── Bug3 原始之翼: 清全旗標(手刻7旗標漏的) ──
{
  const r=mod.RESOLVERS?.get?.('archeops-primal-wing');
  ck('原始之翼 resolver 存在',!!r);
  if(r){
    const tgt=evolvedInst({iid:'oppAct',takeExtraDamageNextTurn:30,weaknessOverrideTypeNextTurn:'Fire',retaliateCountersOnNextHit:5});
    const out=r(st(tgt),0,['oppAct'],{},pool);
    const d=out.players[1].active;
    ck('Bug3a 退化清 takeExtraDamageNextTurn(手刻7旗標漏)',!d.takeExtraDamageNextTurn);
    ck('Bug3a 退化清 weaknessOverrideTypeNextTurn',!d.weaknessOverrideTypeNextTurn);
    ck('Bug3a 退化清 retaliateCountersOnNextHit',!d.retaliateCountersOnNextHit);
    ck('Bug3a 回手卡 iid 唯一',out.players[1].hand[0]?.iid!==d.iid);
  }
}
console.log(`\nv5.984 退化中央管線測試：PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
