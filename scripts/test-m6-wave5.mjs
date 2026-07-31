// v6.067 守衛(M6 批次5)：5 招，用完整 ATTACK 流程驗證。
//   ⭐每型都配「既有同措辭卡」正對照 —— 批次1 的教訓：沒有正對照，harness 自己壞掉時會全綠。
//   ⚠ 基本能量 id 一律依名稱查（硬編 id 會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.m6w5-s.js'),E=join(ROOT,'.m6w5-e.ts'),O=join(ROOT,'.m6w5-o.mjs');
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
  if(opt.defEnergy) D.energyAttached=Array.from({length:opt.defEnergy},()=>inst(FILL));
  const s0=createGame({name:'P1',entries:[{cardId:String(atk.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(def.id),count:1}]},pool);
  const bench=(opt.oppBench??1); const oppBench=Array.from({length:bench},()=>inst(def.id));
  const selfBench=Array.from({length:opt.selfBench??0},()=>inst(atk.id));
  const st={...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,
    activeStadium:opt.stadium?inst(opt.stadium.id):null, activeStadiumOwnerIdx:0,
    pendingSelection:null,log:[],
    players:[{...s0.players[0],active:A,bench:selfBench,hand:[],
              // ⚠ 牌庫預設放**基礎**寶可夢：呼朋引伴族會先預掃「牌庫有無基礎寶可夢」，
              //   放 Stage1 會讓它直接 log 跳過、不開 picker（正對照就是這樣抓到的）。
              deck:Array.from({length:opt.deckN??1},()=>inst(opt.deckCard?.id ?? PLAIN.id)),discard:[],
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

// ── 批次5 ────────────────────────────────────────────────────────────────
const cnt=(z)=>z?.length??0;
// 1 呼朋引伴：牌庫選最多2張基礎放備戰（M6 電擊獸 + 既有毒電嬰正對照，兩張共用中央 helper）
for(const [cn,mark] of [['電擊獸',''],['毒電嬰','(既有正對照)']]){
  const c=find(cn,'呼朋引伴'); if(!c){chk(`${cn}|呼朋引伴 存在`,false);continue;}
  const r=run('呼朋引伴',c,EVO,{deckN:6});
  const p=r?.pendingSelection;
  chk(`${cn}｜呼朋引伴 開 deck-search picker${mark}`, p?.type==='deck-search', p?.type);
  chk(`${cn}｜呼朋引伴 filter=BasicPokemon、最多2張、可選0張`,
      p?.filter==='BasicPokemon' && p?.minCount===0 && p?.maxCount===2,
      `filter=${p?.filter} min=${p?.minCount} max=${p?.maxCount}`);
}
// 2 卡蒂狗｜吼叫：由對手選擇的換位（既有 月桂葉｜推倒 正對照）
for(const [cn,an,mark] of [['卡蒂狗','吼叫',''],['月桂葉','推倒','(既有正對照)']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{oppBench:2});
  // forceOppSwapPost 會開「由對手選」的 picker，或在只有 1 隻備戰時直接換
  const swapped = r?.players?.[1]?.active?.cardId !== String(EVO.id);
  chk(`${cn}｜${an} 觸發對手換位(picker 或直接換)${mark}`, !!r?.pendingSelection || swapped,
      `pending=${r?.pendingSelection?.type} active=${r?.players?.[1]?.active?.cardId}`);
}
// 3 土地雲｜蓋亞粉碎：丟場上競技場
{ const c=find('土地雲','蓋亞粉碎');
  const stad=[...pool.values()].find(x=>x.subtype==='Stadium');
  const r=run('蓋亞粉碎',c,EVO,{stadium:stad});
  chk('土地雲｜蓋亞粉碎 場上競技場被丟棄', !r?.activeStadium, JSON.stringify(r?.activeStadium));
  const r0=run('蓋亞粉碎',c,EVO);
  chk('土地雲｜蓋亞粉碎 場上沒競技場時不當掉、傷害照常110', dmgOf(r0)===110 || dmgOf(r0)===220, dmgOf(r0)); }
// 4 熔蟻獸｜破壞火：擲幣正面才丟對手 1 能量（正反對照）
{ const c=find('熔蟻獸','破壞火');
  const eOf=(r)=>cnt(r?.players?.[1]?.active?.energyAttached);
  const rH=run('破壞火',c,EVO,{heads:true,defEnergy:2});
  const rT=run('破壞火',c,EVO,{heads:false,defEnergy:2});
  chk('熔蟻獸｜破壞火 正面→開能量 picker 或已丟 1 個',
      !!rH?.pendingSelection || eOf(rH)===1, `pending=${rH?.pendingSelection?.type} energy=${eOf(rH)}`);
  chk('⭐熔蟻獸｜破壞火 反面→完全不動對手能量(仍 2 個、不開 picker)',
      !rT?.pendingSelection && eOf(rT)===2, `pending=${rT?.pendingSelection?.type} energy=${eOf(rT)}`); }
// 5 雷公ex｜力量猛攻：擲幣反面才鎖自己下回合全部招式（正反對照）
{ const c=find('雷公ex','力量猛攻');
  const rH=run('力量猛攻',c,EVO,{heads:true});
  const rT=run('力量猛攻',c,EVO,{heads:false});
  chk('雷公ex｜力量猛攻 正面→不鎖招', rH?.players?.[0]?.active?.cantAttackPending!==true);
  chk('雷公ex｜力量猛攻 反面→自身 cantAttackPending(全部招式)', rT?.players?.[0]?.active?.cantAttackPending===true); }
console.log(`m6-wave5:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
