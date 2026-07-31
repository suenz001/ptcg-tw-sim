// v6.062 守衛(M6 批次3)：8 招，用完整 ATTACK 流程驗證。
//   ⭐每型都配「既有同措辭卡」正對照 —— 批次1 的教訓：沒有正對照，harness 自己壞掉時會全綠。
//   ⚠ 基本能量 id 一律依名稱查（硬編 id 會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.m6w3-s.js'),E=join(ROOT,'.m6w3-e.ts'),O=join(ROOT,'.m6w3-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, createGame } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){ if(c?.id==null)continue; pool.set(String(c.id),c);
    if(!byName.has(c.name)) byName.set(c.name,[]); byName.get(c.name).push(c); } }
const find=(n,a)=>(byName.get(n)||[]).find(c=>(c.attacks||[]).some(x=>x.name===a));
const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
const EID={}; for(const [id,c] of pool){ if(c.supertype!=='Energy')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !EID[k]) EID[k]=id; }
EID.Colorless=EID.Water; const FILL=EID.Water;
let n=0; const inst=(cid,e={})=>({iid:`w${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c)pass++; else{fail++;console.log('  ❌',t,extra);} };

function run(atkName, atk, def, opt={}){
  const ai=(atk.attacks||[]).findIndex(a=>a.name===atkName);
  const A=inst(atk.id,opt.atkPatch||{}); A.energyAttached=((atk.attacks[ai].cost)||[]).map(t=>inst(EID[t]??FILL));
  const D=inst(def.id, opt.defPatch||{});
  const s0=createGame({name:'P1',entries:[{cardId:String(atk.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(def.id),count:1}]},pool);
  const bench=(opt.oppBench??1); const oppBench=Array.from({length:bench},()=>inst(def.id));
  const selfBench=Array.from({length:opt.selfBench??0},()=>inst(atk.id));
  const st={...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,activeStadium:null,pendingSelection:null,log:[],
    players:[{...s0.players[0],active:A,bench:selfBench,hand:[],
              deck:Array.from({length:opt.deckN??1},()=>inst(def.id)),discard:[],
              prizes:Array.from({length:6},()=>inst(def.id))},
             {...s0.players[1],active:D,bench:oppBench,hand:Array.from({length:opt.oppHand??0},()=>inst(def.id)),
              deck:Array.from({length:opt.oppDeckN??1},()=>inst(def.id)),discard:[],
              prizes:Array.from({length:opt.oppPrizes??6},()=>inst(def.id))}]};
  const orig=Math.random; Math.random=()=> (opt.heads===false?0.9:0.1);
  let out; try{ out=applyAction(st,{type:'ATTACK',attackIndex:ai},pool); }
  catch(e){ out={__err:e.message}; } finally{ Math.random=orig; }
  return out;
}
const dmgOf=(r)=>r?.players?.[1]?.active?.damage ?? -1;
// 受方：一隻高 HP、非 ex、非進化的普通寶可夢（避免被打死 / 誤觸條件）
const pick=(f)=>{ const a=[...pool.values()].filter(f); a.sort((x,y)=>Number(y.hp)-Number(x.hp)); return a[0]; };
const isEx=(c)=>/ex$/.test(c.name||'');
const PLAIN=pick(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&!(c.abilities||[]).length&&!isEx(c));
const EVO  =pick(c=>c.supertype==='Pokemon'&&(c.stage==='Stage1'||c.stage==='Stage2')&&!(c.abilities||[]).length&&!isEx(c));
const EXP  =pick(c=>c.supertype==='Pokemon'&&isEx(c)&&c.stage==='Basic');
for(const [n,c] of [['PLAIN',PLAIN],['EVO',EVO],['EXP',EXP]]) if(!c) throw new Error('harness 找不到 '+n+' 測試用寶可夢');
console.log(`harness 受方：PLAIN=${PLAIN.name}(${PLAIN.hp}) EVO=${EVO.name}(${EVO.hp}) EX=${EXP.name}(${EXP.hp})`);

// ── 批次3 ────────────────────────────────────────────────────────────────
const cnt=(z)=>z?.length??0;
// 1 抽牌 drawNPost（正對照：拉魯拉絲｜呼喚 抽1）
for(const [cn,an,n] of [['赫拉克羅斯','扣殺抽出',2],['拉魯拉絲','呼喚',1]]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,PLAIN,{deckN:8});
  chk(`${cn}｜${an} 抽 ${n} 張${cn==='拉魯拉絲'?'(既有正對照)':''}`, cnt(r?.players?.[0]?.hand)===n, cnt(r?.players?.[0]?.hand));
}
// 2 恢復自身 30（先給自己 50 傷 → 應剩 20）
{ const c=find('巨翅飛魚','泡沫吸取');
  const r=run('泡沫吸取',c,PLAIN,{atkPatch:{damage:50}});
  chk('巨翅飛魚｜泡沫吸取 自身 50→20', r?.players?.[0]?.active?.damage===20, r?.players?.[0]?.active?.damage); }
// 3 單招 recharge：只鎖該招、不鎖整隻（正對照：利歐路｜加速突刺）
for(const [cn,an] of [['煤炭龜','烈焰爆'],['利歐路','加速突刺']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO);
  const a=r?.players?.[0]?.active;
  chk(`${cn}｜${an} 鎖住「${an}」${cn==='利歐路'?'(既有正對照)':''}`,
      (a?.blockedAttackNamesNextTurn||[]).includes(an), JSON.stringify(a?.blockedAttackNamesNextTurn));
  chk(`${cn}｜${an} 不鎖整隻(cantAttackPending 不得為 true)`, a?.cantAttackPending!==true);
}
// 4 skipDefEffects：對手掛減傷 30 仍應打滿 90
{ const c=find('雷電雲','雷電刀鋒');
  // ⚠ 不能直接斷言 90：受方若對【雷】有弱點會 ×2。這裡驗的重點是「減傷不生效」→ 比對兩者相等；
  //   另用引擎 log 的「N(基礎)」驗基礎傷害，不受弱點影響。
  const baseOf=(r)=>{ for(const l of (r?.log||[])){ const m=/【(\d+)\(基礎\)/.exec(l?.message??''); if(m) return Number(m[1]); } return null; };
  const rPlain=run('雷電刀鋒',c,EVO);
  const rGuard=run('雷電刀鋒',c,EVO,{defPatch:{damageReduceNextHit:30}});
  chk('雷電雲｜雷電刀鋒 基礎=90', baseOf(rPlain)===90, baseOf(rPlain));
  chk('⭐雷電雲｜雷電刀鋒 對手掛減傷30 → 傷害不變(不計附加效果)',
      dmgOf(rGuard)===dmgOf(rPlain) && dmgOf(rPlain)>0, `plain=${dmgOf(rPlain)} guard=${dmgOf(rGuard)}`); }
// 5 skipResistance：受方對攻方屬性有抵抗力時，傷害不得被扣
{ const c=find('大鋼蛇','重重橫掃');
  // ⚠ 卡資料的欄位是 `resistance`（單數物件 {type,value}），不是 `resistances` 陣列 —— 
  //   猜錯欄位名會找不到任何受方、讓本條驗不出東西。
  const resist=[...pool.values()].find(x=>x.supertype==='Pokemon'&&Number(x.hp)>=250
    && x.resistance?.type===c.pokemonType);
  // ⚠ 找不到「對攻方屬性有抵抗力」的受方時，這條驗不出 skipResistance → 明確標示而不是假 PASS。
  chk('大鋼蛇｜重重橫掃 harness 找得到有抵抗力的受方(否則本條無效)', !!resist, resist?.name);
  const r=run('重重橫掃',c,resist||EVO);
  chk(`大鋼蛇｜重重橫掃 =150 不被抵抗力扣(受方 ${resist?resist.name:'—'})`, dmgOf(r)===150, dmgOf(r)); }
// 6 丟對手牌庫頂 1 張（正對照：花岩怪｜崩山）
for(const [cn,an] of [['穿山王','挖洞爪'],['花岩怪','崩山']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{oppDeckN:5});
  chk(`${cn}｜${an} 對手牌庫 5→4、棄牌 +1${cn==='花岩怪'?'(既有正對照)':''}`,
      cnt(r?.players?.[1]?.deck)===4 && cnt(r?.players?.[1]?.discard)===1,
      `deck=${cnt(r?.players?.[1]?.deck)} discard=${cnt(r?.players?.[1]?.discard)}`);
}
// 7 自身與備戰互換（自己要有備戰）
{ const c=find('青綿鳥','雀躍');
  // ⚠ 不可斷言「bench 有 1 隻」—— 那是 harness 自己放的，未實裝時也成立（曾寫成這樣＝假 PASS）。
  //   要斷言「真的發生了互換」：開了選備戰的 picker，或戰鬥位已不是青綿鳥本身。
  const r=run('雀躍',c,PLAIN,{selfBench:1});
  const swapped = r?.players?.[0]?.active?.cardId !== String(c.id);
  chk('青綿鳥｜雀躍 真的互換(開 picker 或戰鬥位已換人)', !!r?.pendingSelection || swapped,
      `pending=${r?.pendingSelection?.type} active=${r?.players?.[0]?.active?.cardId}`); }
// 8 擲幣正面 → immuneToAllAttackNextTurn（正反對照 + 既有雪吞蟲正對照）
for(const [cn,an] of [['電海燕','高速移動'],['雪吞蟲','躲藏']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const rH=run(an,c,EVO,{heads:true}), rT=run(an,c,EVO,{heads:false});
  chk(`${cn}｜${an} 正面→完全免疫${cn==='雪吞蟲'?'(既有正對照)':''}`,
      rH?.players?.[0]?.active?.immuneToAllAttackNextTurn===true);
  chk(`${cn}｜${an} 反面→不免疫`, rT?.players?.[0]?.active?.immuneToAllAttackNextTurn!==true);
}
console.log(`m6-wave3:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
