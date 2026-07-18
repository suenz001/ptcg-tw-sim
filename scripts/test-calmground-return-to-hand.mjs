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
  "export { isReturnToHandBlockedByCalmGround } from './src/lib/game/effects/cards/v3080_deferred_wave_c';\n"+
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
console.log(`\nv5.985 平穩境地回手方向測試：PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
