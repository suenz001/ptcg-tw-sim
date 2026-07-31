// v6.060 守衛(M6 批次1)：11 招純類推實裝，逐招用**完整 ATTACK 流程**驗證效果真的落地。
//   ⭐每組都配「正對照」：既有 H/I 標同措辭卡也跑一次，證明 harness 判準本身有效
//     （否則欄位名寫錯就會全綠假象）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.m6w1-s.js'),E=join(ROOT,'.m6w1-e.ts'),O=join(ROOT,'.m6w1-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, createGame } = await import(pathToFileURL(O).href);

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){ if(c?.id==null)continue;
    pool.set(String(c.id),c);
    // 同名多張時保留「有該招式」的那張由 findCard 再篩
    if(!byName.has(c.name)) byName.set(c.name,[]); byName.get(c.name).push(c); } }
const findCard=(name,atk)=>(byName.get(name)||[]).find(c=>(c.attacks||[]).some(a=>a.name===atk));

let n=0; const inst=(cid,e={})=>({iid:`t${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const chk=(t,c)=>{ if(c)pass++; else{fail++;console.log('  ❌',t);} };

// 打出招式：把攻擊方能量灌滿(用【無】通用不可行→直接灌該招 cost 對應的基本能量)
// ⚠ 基本能量 id 必須從卡池**依名稱查**，不可硬編（曾硬編猜錯 id → 付不出招式費用、
//   ATTACK 靜默 return、log 全空，看起來像效果沒實裝）。
const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
const ENERGY_ID={};
for(const [id,c] of pool){ if(c.supertype!=='Energy')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !ENERGY_ID[k]) ENERGY_ID[k]=id; }
ENERGY_ID.Colorless=ENERGY_ID.Water;  // 【無】費用可用任何能量支付
const FILLER=ENERGY_ID.Water;
function runAttack(atkName, atkCard, defCard, {heads=true}={}){
  const ai=(atkCard.attacks||[]).findIndex(a=>a.name===atkName);
  const cost=(atkCard.attacks[ai].cost)||[];
  const A=inst(atkCard.id); A.energyAttached=cost.map(t=>inst(ENERGY_ID[t]??FILLER));
  const D=inst(defCard.id);
  // ⭐用 createGame 產生完整 state 再覆蓋 —— 手刻 state 會缺 pendingMulliganDraw /
  //   coinFlippedThisAttack / _attackerActiveBonusDone 等欄位，導致 ATTACK 靜默不執行(log 全空)。
  const s0=createGame({name:'P1',entries:[{cardId:String(atkCard.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(defCard.id),count:1}]},pool);
  const st={...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,activeStadium:null,pendingSelection:null,log:[],
    players:[{...s0.players[0],active:A,bench:[],hand:[],deck:[inst(defCard.id)],discard:[],
              prizes:Array.from({length:6},()=>inst(defCard.id))},
             {...s0.players[1],active:D,bench:[inst(FILLER)],hand:[],deck:[inst(defCard.id)],discard:[],
              prizes:Array.from({length:6},()=>inst(defCard.id))}]};
  const orig=Math.random; Math.random=()=> (heads?0.1:0.9);
  let out; try{ out=applyAction(st,{type:'ATTACK',attackIndex:ai},pool); }
  catch(e){ out={__err:e.message}; } finally { Math.random=orig; }
  return out;
}
// 受方用一隻無免疫、HP 高的普通寶可夢：找 HP>=200 的【無】基礎
const DEF = [...pool.values()].find(c=>c.supertype==='Pokemon'&&Number(c.hp)>=250&&!(c.abilities||[]).length)
        || [...pool.values()].find(c=>c.supertype==='Pokemon'&&Number(c.hp)>=200);

// ── 各組:[卡名, 招式名, 檢查函式, 說明] ──────────────────────────────────
const STATUS=[['煤炭龜','灼燒','burned'],['引夢貘人','催眠波動','asleep'],
  ['圓絲蛛','毒針','poisoned'],['超級烏賊王ex','不祥波動','confused']];
for(const [cn,an,want] of STATUS){
  const c=findCard(cn,an); if(!c){chk(`${cn}|${an} 卡存在`,false);continue;}
  const r=runAttack(an,c,DEF);
  chk(`${cn}｜${an} → 對手【${want}】`, r?.players?.[1]?.active?.status===want);
}
{ // 擲幣麻痺:正面中、反面不中(反面對照證明真的讀了硬幣)
  const c=findCard('電擊魔獸','泰山壓頂');
  const rH=runAttack('泰山壓頂',c,DEF,{heads:true});
  const rT=runAttack('泰山壓頂',c,DEF,{heads:false});
  chk('電擊魔獸｜泰山壓頂 正面→【麻痺】', rH?.players?.[1]?.active?.status==='paralyzed');
  chk('電擊魔獸｜泰山壓頂 反面→不麻痺(對照)', rT?.players?.[1]?.active?.status!=='paralyzed');
}
for(const [cn,an] of [['超級具甲武者ex','四爪控制'],['火箭雀','緊抓'],['小鋸鱷','咬緊']]){
  const c=findCard(cn,an); if(!c){chk(`${cn}|${an} 卡存在`,false);continue;}
  const r=runAttack(an,c,DEF);
  chk(`${cn}｜${an} → 對手 cantRetreatNextTurn${cn==='小鋸鱷'?'(既有正對照)':''}`,
      r?.players?.[1]?.active?.cantRetreatNextTurn===true);
}
{
  const c=findCard('雨翅蛾','恐怖花紋');
  const r=runAttack('恐怖花紋',c,DEF);
  chk('雨翅蛾｜恐怖花紋 → 對手 cantAttackPending', r?.players?.[1]?.active?.cantAttackPending===true);
}
for(const [cn,an,mark] of [['尼多后','終極衝擊',''],['巨石丁','潛力','(既有正對照)']]){
  const c=findCard(cn,an); if(!c){chk(`${cn}|${an} 卡存在`,false);continue;}
  const r=runAttack(an,c,DEF);
  chk(`${cn}｜${an} → 自身 cantAttackPending${mark}`, r?.players?.[0]?.active?.cantAttackPending===true);
}
for(const [cn,an,mark] of [['大岩蛇','防守壓制',''],['心鱗寶','硬頭',''],['橡實果','硬化','(既有正對照)']]){
  const c=findCard(cn,an); if(!c){chk(`${cn}|${an} 卡存在`,false);continue;}
  const r=runAttack(an,c,DEF);
  chk(`${cn}｜${an} → 自身 damageReduceNextHit=30${mark}`, r?.players?.[0]?.active?.damageReduceNextHit===30);
}
console.log(`m6-wave1:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
