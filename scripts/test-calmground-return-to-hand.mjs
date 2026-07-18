// 回歸測試 v5.985：美納斯｜平穩境地「場上卡→手牌」中央述詞方向(依官方Q&A)
// 判準：被回手卡的「持有者」的對手側有生效平穩境地 → 擋。與誰發動無關。棄牌區→手牌不受限。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.x-s-cg.js'),E=join(ROOT,'.x-e-cg.ts'),O=join(ROOT,'.x-o-cg.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,
  "export { ATTACK_POST, RESOLVERS } from './src/lib/game/effects/_shared';\n"+
  "export { isReturnToHandBlockedByCalmGround, hasEffectiveCalmGroundOnSide } from './src/lib/game/effects/cards/v3080_deferred_wave_c';\n"+
  "import './src/lib/game/effects';");
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
let menasId=null;
for(const [id,c] of pool) if(c.name==='美納斯'&&(c.abilities||[]).some(a=>a.name==='平穩境地')){menasId=id;break;}
assert(menasId,'找不到美納斯|平穩境地');
let baseId=null,evoId=null;
for(const [id,c] of pool){if((c.supertype||'').startsWith('Pok')&&c.evolvesFrom){
  for(const [bid,bc] of pool)if((bc.supertype||'').startsWith('Pok')&&bc.name===c.evolvesFrom){baseId=bid;evoId=id;break;}
  if(baseId)break;}}
const mk=(cid,o={})=>({iid:o.iid??('i'+cid),cardId:String(cid),damage:0,energyAttached:[],
  status:null,secondaryStatus:null,tertiaryStatus:null,toolAttached:null,extraTools:[],...o});
const evolved=(o={})=>mk(evoId,{evolvedFromStack:[{iid:'bc',cardId:String(baseId)}],...o});
function st(p0,p1){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,
    log:[],pendingSelection:null,setupDone:[true,true],activeStadium:null,
    players:[{name:'A',bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1],...p0},
             {name:'B',bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1],...p1}]};
}
let pass=0,fail=0; const ck=(n,c)=>{if(c)pass++;else{fail++;console.log('  ✗',n);}};

// ── 中央述詞方向 ──
{
  const B=mod.isReturnToHandBlockedByCalmGround;
  ck('中央述詞 exported',typeof B==='function');
  // 我方(0)有美納斯 → 對手(1)的卡不能回手；我方(0)自己的卡不受影響
  const s=st({active:mk(menasId,{iid:'menas'})},{active:mk(baseId,{iid:'d'})});
  ck('持有者0有美納斯→卡主1被擋',B(s,1,pool)===true);
  ck('持有者0有美納斯→卡主0不被擋(只保護對手側)',B(s,0,pool)===false);
  ck('無美納斯→都不擋',B(st({active:mk(baseId)},{active:mk(baseId)}),0,pool)===false);
}
// ── Q&A 1：自己的美納斯擋自己的奧密之眼(被回手的是對手的卡) ──
{
  const post=mod.ATTACK_POST.get('超能豔鴕|奧密之眼');
  ck('奧密之眼 有註冊',!!post);
  if(post){
    // aIdx=0 使用奧密之眼；我方(0)自己有美納斯在備戰 → 應被擋
    const blocked=post(st({active:mk(baseId,{iid:'atk'}),bench:[mk(menasId,{iid:'myMenas'})]},
                          {active:evolved({iid:'oppAct'})}),0,pool,{});
    ck('QA1 自己有美納斯→奧密之眼被擋(無pending)',!blocked.pendingSelection);
    // 對手(1)有美納斯 → 被回手的是對手的卡,守方應是我方(0);對手自己的美納斯不保護自己 → 不擋
    const ok=post(st({active:mk(baseId,{iid:'atk'})},
                     {active:evolved({iid:'oppAct'}),bench:[mk(menasId,{iid:'oppMenas'})]}),0,pool,{});
    ck('QA1 對手有美納斯→奧密之眼照常(開pending)',!!ok.pendingSelection);
  }
}
// ── Q&A 2 類推：自己能量回手被「對手」美納斯擋(returnSelfActiveEnergyPost toHand) ──
{
  // 找一張走 returnSelfActiveEnergyPost toHand 的招式：狡猾天狗|能量閉環
  const post=mod.ATTACK_POST.get('狡猾天狗|能量閉環');
  if(post){
    const en=[{iid:'e1',cardId:'99991'}];
    const s2=st({active:mk(baseId,{iid:'atk',energyAttached:en})},
                {active:mk(baseId,{iid:'d'}),bench:[mk(menasId,{iid:'oppMenas'})]});

    const withOpp=post(st({active:mk(baseId,{iid:'atk',energyAttached:en})},
                          {active:mk(baseId,{iid:'d'}),bench:[mk(menasId,{iid:'oppMenas'})]}),0,pool,{});
    const logs=JSON.stringify(withOpp.log||[]);
    ck('QA2 對手有美納斯→自己能量無法回手',logs.includes('平穩境地'));
    const noMenas=post(st({active:mk(baseId,{iid:'atk',energyAttached:en})},
                          {active:mk(baseId,{iid:'d'})}),0,pool,{});
    ck('QA2 無美納斯→照常回手(不含平穩境地log)',!JSON.stringify(noMenas.log||[]).includes('平穩境地'));
  } else { ck('狡猾天狗|能量閉環 有註冊',false); }
}
// ── v5.986 手刻站收斂驗證 ──
{
  const L=o=>JSON.stringify(o.log||[]);
  const oppMenas=()=>({active:mk(baseId,{iid:'d'}),bench:[mk(menasId,{iid:'oppMenas'})]});
  const myMenas=()=>({active:mk(baseId,{iid:'atk'}),bench:[mk(menasId,{iid:'myMenas'})]});
  // 電飛鼠|天空迴旋(收斂到中央 selfReturnToHandPost)
  const p1=mod.ATTACK_POST.get('電飛鼠|天空迴旋');
  ck('電飛鼠|天空迴旋 有註冊',!!p1);
  if(p1){
    const blocked=p1(st({active:mk(baseId,{iid:'atk'})},oppMenas()),0,pool,{});
    ck('v5.986 電飛鼠:對手美納斯→自身無法回手',L(blocked).includes('平穩境地')&&!!blocked.players[0].active);
  }
  // 土地雲|螺旋關節
  const p2=mod.ATTACK_POST.get('土地雲|螺旋關節');
  if(p2){
    const b=p2(st({active:mk(baseId,{iid:'atk',energyAttached:[{iid:'e1',cardId:'99991'}]})},oppMenas()),0,pool,{});
    ck('v5.986 土地雲:對手美納斯→能量無法回手',L(b).includes('平穩境地'));
  }
  // 心蝙蝠|幸福迴旋
  const p3=mod.ATTACK_POST.get('心蝙蝠|幸福迴旋');
  if(p3){
    const b=p3(st({active:mk(baseId,{iid:'atk'}),bench:[mk(baseId,{iid:'b1'})]},oppMenas()),0,pool,{});
    ck('v5.986 心蝙蝠:對手美納斯→備戰無法回手',L(b).includes('平穩境地'));
  }
  // 章魚桶|水流清洗(A類原完全漏gate) — 我方有美納斯應擋
  const p4=mod.ATTACK_POST.get('章魚桶|水流清洗');
  ck('章魚桶|水流清洗 有註冊',!!p4);
  if(p4){
    const b=p4(st(myMenas(),{active:mk(baseId,{iid:'d',energyAttached:[{iid:'e2',cardId:'99992'}]})}),0,pool,{});
    ck('v5.986 章魚桶:我方美納斯→對手能量無法回手(原漏gate)',L(b).includes('平穩境地'));
  }
}

// ── v5.987 attack-time snapshot：美納斯被同招 KO 仍依宣告當時判定(比照花之帷幔) ──
{
  const B=mod.isReturnToHandBlockedByCalmGround;
  // 盤面已無美納斯(結算過程中被 KO 移除)，但 snapshot 記得宣告當時 guard 側(1)有 → 仍擋卡主0的卡
  const s=st({active:mk(baseId,{iid:'atk'})},{active:mk(baseId,{iid:'d'})}); // 兩邊都無美納斯
  s._attackTimeCalmGround=[false,true];
  ck('v5.987 盤面無美納斯但snapshot[guard=1]=true→卡主0仍被擋',B(s,0,pool)===true);
  ck('v5.987 snapshot 只擋對應guard側(卡主1不被擋)',B(s,1,pool)===false);
  // 對照:無 snapshot 且盤面無美納斯 → 不擋
  const s2=st({active:mk(baseId,{iid:'atk'})},{active:mk(baseId,{iid:'d'})});
  ck('v5.987 無snapshot+盤面無美納斯→不擋',B(s2,0,pool)===false);
  // exported helper 存在
  ck('v5.987 hasEffectiveCalmGroundOnSide exported',typeof mod.hasEffectiveCalmGroundOnSide==='function');
  const s3=st({active:mk(menasId,{iid:'m'})},{active:mk(baseId,{iid:'d'})});
  ck('v5.987 helper:當下盤面0有美納斯→side0 true',mod.hasEffectiveCalmGroundOnSide(s3,0,pool)===true);
}

console.log(`\nv5.985/986 平穩境地回手中央收斂測試：PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
