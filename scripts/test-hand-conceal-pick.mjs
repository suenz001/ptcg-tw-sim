// v6.065 守衛：「在不看正面的情況下，從對手的手牌**選擇**N張」全維度必須走 concealed picker（不得隨機）。
//   ⭐每型都配「既有同措辭卡」正對照 —— 批次1 的教訓：沒有正對照，harness 自己壞掉時會全綠。
//   ⚠ 基本能量 id 一律依名稱查（硬編 id 會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.hcp-s.js'),E=join(ROOT,'.hcp-e.ts'),O=join(ROOT,'.hcp-o.mjs');
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

// ── 全維度：卡面寫「選擇」→ 必須開 concealed picker（hand-discard + params.concealed）──────
//   ⚠ 正對照＝已被 v3.9998/v2590 驗證正確的兩張（太陽伊布ex 丟棄型、火箭隊的喵喵 放回牌庫型）。
//   ⚠ 反面意義：只要哪張被改回「隨機直接執行」，picker 就不會出現 → 該行 FAIL。
const cnt=(z)=>z?.length??0;
// [卡名, 招式名, 期望張數(數字) 或 'dyn', 說明]
const DISCARD=[['太陽伊布ex','精神出局',1,'(既有正對照)'],['好啦魷','拍落',1,''],
  ['功夫鼬','拍落',1,''],['滑滑小子','拍落',1,''],['酷豹','拍落',1,''],
  ['班基拉斯ex','暴君粉碎',1,''],['南瓜怪人ex','幽靈之觸',1,''],['禿鷹娜ex','禿鷹爪',1,''],
  ['火箭隊的鈴鐺響','鈴鈴吵鬧',1,''],['超級頭巾混混ex','不法之足',1,'']];
const RETURN =[['火箭隊的喵喵','占為己有',1,'(既有正對照)'],['雪童子','驚嚇',1,''],
  ['洛托姆','驚嚇',1,''],['長尾怪手','驚嚇',1,'']];
for(const [cn,an,n,mark] of [...DISCARD,...RETURN]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{oppHand:4});
  const p=r?.pendingSelection;
  chk(`${cn}｜${an} 開 concealed picker${mark}`,
      p?.type==='hand-discard' && p?.params?.concealed===true,
      `type=${p?.type} concealed=${p?.params?.concealed}`);
  chk(`${cn}｜${an} 選剛好 ${n} 張`, p?.minCount===n && p?.maxCount===n, `${p?.minCount}/${p?.maxCount}`);
  chk(`${cn}｜${an} 未選完前對手手牌不動(4 張)`, cnt(r?.players?.[1]?.hand)===4, cnt(r?.players?.[1]?.hand));
}
// 動態張數：巨牙鯊(擲3幣全正面→3) / 墓揚犬(擲幣直到反面) / 雙尾怪手特性(擲2幣→2) / 多麗米亞(手牌-5)
{ const c=find('巨牙鯊','咬棄');
  const rH=run('咬棄',c,EVO,{oppHand:6,heads:true});
  chk('巨牙鯊｜咬棄 三正面→選 3 張', rH?.pendingSelection?.minCount===3, rH?.pendingSelection?.minCount);
  const rT=run('咬棄',c,EVO,{oppHand:6,heads:false});
  chk('巨牙鯊｜咬棄 全反面→不開 picker', !rT?.pendingSelection, rT?.pendingSelection?.type); }
{ const c=find('多麗米亞','手部造型');
  const r8=run('手部造型',c,EVO,{oppHand:8});
  chk('多麗米亞｜手部造型 手牌8→選 3 張(8−5)', r8?.pendingSelection?.minCount===3, r8?.pendingSelection?.minCount);
  const r5=run('手部造型',c,EVO,{oppHand:5});
  chk('多麗米亞｜手部造型 手牌5→無效果、不開 picker', !r5?.pendingSelection, r5?.pendingSelection?.type); }
// resolver 落地：丟棄型 → 手牌−1、棄牌+1；放回型 → 手牌−1、牌庫+1
for(const [cn,an,kind] of [['好啦魷','拍落','discard'],['雪童子','驚嚇','deck']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{oppHand:4,oppDeckN:3});
  const pick=(r?.pendingSelection?.params?.validIids||[])[0];
  let done=null; try{ done=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[pick]},pool);}catch(e){done={__err:e.message};}
  const okHand=cnt(done?.players?.[1]?.hand)===3;
  const okDest = kind==='discard' ? cnt(done?.players?.[1]?.discard)===1 : cnt(done?.players?.[1]?.deck)===4;
  chk(`${cn}｜${an} resolve 後 手牌4→3、${kind==='discard'?'棄牌+1':'牌庫+1'}`, okHand&&okDest,
      `hand=${cnt(done?.players?.[1]?.hand)} discard=${cnt(done?.players?.[1]?.discard)} deck=${cnt(done?.players?.[1]?.deck)} err=${done?.__err}`);
}
console.log(`hand-conceal-pick:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
