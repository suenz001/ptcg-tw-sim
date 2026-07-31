// v6.063 守衛(M6 批次4)：3 招，用完整 ATTACK 流程驗證。
//   ⭐每型都配「既有同措辭卡」正對照 —— 批次1 的教訓：沒有正對照，harness 自己壞掉時會全綠。
//   ⚠ 基本能量 id 一律依名稱查（硬編 id 會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.m6w4-s.js'),E=join(ROOT,'.m6w4-e.ts'),O=join(ROOT,'.m6w4-o.mjs');
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
  const A=inst(atk.id,opt.atkPatch||{});
  A.energyAttached=[...((atk.attacks[ai].cost)||[]).map(t=>inst(EID[t]??FILL)),
                    ...Array.from({length:opt.extraEnergy??0},()=>inst(FILL))];
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

// ── 批次4 ────────────────────────────────────────────────────────────────
const cnt=(z)=>z?.length??0;
// 1 強制丟自身 2 個能量（既有正對照：千面避役｜水射擊 也是 per=0 強制型）
for(const [cn,an,need] of [['加熱洛托姆ex','強力閃焰',2],['千面避役','水射擊',1]]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{extraEnergy:4});
  const p=r?.pendingSelection;
  const ok = p?.type==='active-energy-discard' || cnt(r?.players?.[0]?.discard)>0;
  chk(`${cn}｜${an} 觸發丟自身能量(picker 或已丟)${cn==='千面避役'?'(既有正對照)':''}`, ok,
      `pending=${p?.type} min=${p?.minCount} max=${p?.maxCount} discard=${cnt(r?.players?.[0]?.discard)}`);
  if(cn==='加熱洛托姆ex' && p) chk('⭐加熱洛托姆ex｜強力閃焰 強制剛好 2 個(min=max=2)',
      p.minCount===2 && p.maxCount===2, `min=${p.minCount} max=${p.maxCount}`);
}
// 2 隨機丟對手手牌 1 張（既有正對照：滑滑小子｜拍落）
for(const [cn,an] of [['好啦魷','拍落'],['滑滑小子','拍落']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{oppHand:3});
  chk(`${cn}｜${an} 對手手牌 3→2、棄牌 +1${cn==='滑滑小子'?'(既有正對照)':''}`,
      cnt(r?.players?.[1]?.hand)===2 && cnt(r?.players?.[1]?.discard)===1,
      `hand=${cnt(r?.players?.[1]?.hand)} discard=${cnt(r?.players?.[1]?.discard)}`);
}
// 3 中毒 + 每次檢查傷害改為 40（＝卡面「4 個指示物」×10）
//   ⚠ 單位是傷害點數不是個數；既有範本 致死猛毒 卡面 16 個 → 實作傳 160，故此處應為 40。
for(const [cn,an,want] of [['阿利多斯','劇痛毒',40],['超級毒藻龍ex','致死猛毒',160]]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO);
  const d=r?.players?.[1]?.active;
  chk(`${cn}｜${an} 對手中毒${cn==='超級毒藻龍ex'?'(既有正對照)':''}`, d?.status==='poisoned', d?.status);
  chk(`⭐${cn}｜${an} poisonDamagePerCheckup=${want}(卡面 ${want/10} 個指示物)`,
      d?.poisonDamagePerCheckup===want, d?.poisonDamagePerCheckup);
}
console.log(`m6-wave4:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
