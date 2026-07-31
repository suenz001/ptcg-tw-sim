// v6.069 守衛(M6 批次7)：12 招 + 4 張既有卡收斂 + 「能量數量」繁茂 host-aware 修正。
//   ⭐每型都配「既有同措辭卡」正對照 —— 沒有正對照，harness 自己壞掉時會全綠。
//   ⭐反向斷言：放指示物不得退化成 attack-damage、只免傷害不得升級成全免疫、
//     「基本能量卡」的既有卡不得被「能量卡」擴充波及。
//   ⚠ 基本能量 id 一律依名稱查；state 一律由 createGame 產生再覆蓋。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.m6w7-s.js'),E=join(ROOT,'.m6w7-e.ts'),O=join(ROOT,'.m6w7-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame } from './src/lib/game/engine';\n"
 +"export { ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects/_shared';\n"
 +"export { FIRST_TURN_USABLE_ATTACKS } from './src/lib/game/effects/cards/v3000_g3_wave2';\n"
 +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, createGame, ATTACK_PRE_DISCARD_CHOICE: PRE_CHOICE, FIRST_TURN_USABLE_ATTACKS: FIRST_TURN } = await import(pathToFileURL(O).href);
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
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c)pass++; else{fail++;console.log('  ❌',t,extra??'');} };

function run(atkName, atk, def, opt={}){
  const ai=(atk.attacks||[]).findIndex(a=>a.name===atkName);
  const A=inst(atk.id,opt.atkPatch||{});
  A.energyAttached=[...((atk.attacks[ai].cost)||[]).map(t=>inst(EID[t]??FILL)),
                    ...Array.from({length:opt.extraEnergy??0},()=>inst(FILL))];
  const D=inst(def.id, opt.defPatch||{});
  if(opt.defEnergyCards) D.energyAttached=opt.defEnergyCards.map(id=>inst(id));
  else if(opt.defEnergy)  D.energyAttached=Array.from({length:opt.defEnergy},()=>inst(FILL));
  const s0=createGame({name:'P1',entries:[{cardId:String(atk.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(def.id),count:1}]},pool);
  const oppBench = opt.oppBenchCards ? opt.oppBenchCards.map(id=>inst(id))
                 : Array.from({length:opt.oppBench??1},()=>inst(def.id));
  const selfBench= opt.selfBenchCards ? opt.selfBenchCards.map(id=>inst(id))
                 : Array.from({length:opt.selfBench??0},()=>inst(atk.id));
  const deck = opt.deckCards ? opt.deckCards.map(id=>inst(id))
             : Array.from({length:opt.deckN??1},()=>inst(opt.deckCard?.id ?? PLAIN.id));
  const st={...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,
    activeStadium:opt.stadium?inst(opt.stadium.id):null, activeStadiumOwnerIdx:0,
    pendingSelection:null,log:[],
    players:[{...s0.players[0],active:A,bench:selfBench,hand:[],deck,
              discard:opt.discard??[],prizes:Array.from({length:6},()=>inst(def.id))},
             {...s0.players[1],active:D,bench:oppBench,hand:Array.from({length:opt.oppHand??0},()=>inst(def.id)),
              deck:Array.from({length:opt.oppDeckN??1},()=>inst(def.id)),discard:[],
              prizes:Array.from({length:opt.oppPrizes??6},()=>inst(def.id))}]};
  const orig=Math.random; Math.random=()=> (opt.heads===false?0.9:0.1);
  let out; try{ out=applyAction(st,{type:'ATTACK',attackIndex:ai},pool); }
  catch(e){ out={__err:e.message}; } finally{ Math.random=orig; }
  return out;
}
const dmgOf=(r)=>r?.players?.[1]?.active?.damage ?? -1;
const pick=(f)=>{ const a=[...pool.values()].filter(f); a.sort((x,y)=>Number(y.hp)-Number(x.hp)); return a[0]; };
const isEx=(c)=>/ex$/.test(c.name||'');
const PLAIN=pick(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&!(c.abilities||[]).length&&!isEx(c));
const EVO  =pick(c=>c.supertype==='Pokemon'&&(c.stage==='Stage1'||c.stage==='Stage2')&&!(c.abilities||[]).length&&!isEx(c));
for(const [nm,c] of [['PLAIN',PLAIN],['EVO',EVO]]) if(!c) throw new Error('harness 找不到 '+nm);
console.log(`harness 受方：PLAIN=${PLAIN.name}(${PLAIN.hp}) EVO=${EVO.name}(${EVO.hp})`);
const cnt=(z)=>z?.length??0;
// ── 批次7 ────────────────────────────────────────────────────────────────
const logs=(r)=>(r?.log||[]).map(x=>x.message||'');
const has=(r,re)=>logs(r).some(m=>re.test(m));

// 1) 牌庫指名放備戰（M6 溜溜糖球 + 既有 燈火幽靈 正對照，兩張都要走中央 helper）
for(const [cn,an,name,max,mark] of [
  ['溜溜糖球','增長','溜溜糖球',2,''], ['燈火幽靈','亮光增長','燈火幽靈',3,'(既有正對照)']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{deckN:6,deckCard:c});   // 牌庫放同名卡當候選
  const p=r?.pendingSelection;
  chk(`${cn}｜${an} 開 deck-search picker${mark}`, p?.type==='deck-search', p?.type);
  chk(`${cn}｜${an} filter=Name:${name}、最多 ${max}${mark}`,
      p?.filter===`Name:${name}` && p?.maxCount===max, `filter=${p?.filter} max=${p?.maxCount}`);
  chk(`${cn}｜${an} 可選 0 張(minCount=0)${mark}`, p?.minCount===0, `min=${p?.minCount}`);
  // 備戰已滿 → 不開 picker、但仍重洗（卡面「並且重洗牌庫」）
  const rFull=run(an,c,EVO,{deckN:6,deckCard:c,selfBench:5});
  chk(`${cn}｜${an} 備戰滿→不開 picker 仍重洗${mark}`,
      !rFull?.pendingSelection && has(rFull,/備戰區已滿/), rFull?.pendingSelection?.type);
}

// 2) 棄牌區基本能量張數×N（M6 再次加熱 + 既有 蓋歐卡逆流 正對照）
for(const [cn,an,zh,per,mark] of [
  ['加熱洛托姆ex','再次加熱','火',30,''], ['蓋歐卡','逆流','水',20,'(既有正對照)']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const eid=[...pool.values()].find(x=>x.name===`基本【${zh}】能量`)?.id;
  const other=[...pool.values()].find(x=>x.name==='基本【超】能量')?.id;
  const disc=[inst(eid),inst(eid),inst(eid),inst(other)];   // 3 張對的 + 1 張別屬性
  const r=run(an,c,EVO,{discard:disc});
  chk(`${cn}｜${an} 3 張 × ${per} = ${3*per}${mark}`, has(r,new RegExp(`3 張 × ${per} → ${3*per}`)),
      logs(r).filter(m=>/棄牌區/.test(m))[0]);
  chk(`${cn}｜${an} 3 張放回牌庫、別屬性留在棄牌區${mark}`,
      r?.players?.[0]?.discard?.length===1 && has(r,/放回牌庫並重洗/),
      `discard=${r?.players?.[0]?.discard?.length}`);
}

// 3) 放置 N 個傷害指示物（M6 不祥之眼 5 個 + 既有 悄聲加害 2 個/1 個 正對照）
for(const [cn,an,ctr,mark] of [
  ['勾魂眼','不祥之眼',5,''], ['綿綿泡芙','悄聲加害',2,'(既有正對照)'], ['納噬草','悄聲加害',1,'(既有正對照)']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{oppBench:1});
  const p=r?.pendingSelection;
  chk(`${cn}｜${an} 開 opp-poke-choose(含戰鬥位)${mark}`,
      p?.type==='opp-poke-choose' && p?.params?.includeActive===true, p?.type);
  chk(`${cn}｜${an} 放 ${ctr} 個指示物＝${ctr*10} 點、kind=attack-effect${mark}`,
      p?.params?.damage===ctr*10 && p?.params?.kind==='attack-effect',
      `dmg=${p?.params?.damage} kind=${p?.params?.kind}`);
  // ⚠ 反向斷言：放置指示物是招式「效果」，絕不可退化成 attack-damage（會計弱點/被太晶擋）
  chk(`${cn}｜${an} 不得用 attack-damage${mark}`, p?.params?.kind!=='attack-damage');
  // 對手無備戰 → 不開 picker，直接打戰鬥位
  const rNo=run(an,c,EVO,{oppBench:0});
  chk(`${cn}｜${an} 對手無備戰→直接打戰鬥位${mark}`,
      !rNo?.pendingSelection && dmgOf(rNo)===ctr*10, `pending=${rNo?.pendingSelection?.type} dmg=${dmgOf(rNo)}`);
}

// 4) 對手全場能量「數量」= host-aware 單位（啪嚓海膽 + 繁茂修正）
{
  const c=find('啪嚓海膽','能量粉碎');
  const rocket=[...pool.values()].find(x=>x.name==='火箭隊能量');
  if(!c) chk('啪嚓海膽|能量粉碎 存在',false);
  else{
    const r=run('能量粉碎',c,EVO,{defEnergy:2});
    chk('啪嚓海膽｜能量粉碎 2 個基本能量 → 40', dmgOf(r)===40 || has(r,/能量 2 .*40/), `dmg=${dmgOf(r)}`);
    if(rocket){
      const r2=run('能量粉碎',c,EVO,{defEnergyCards:[rocket.id]});
      // 火箭隊能量 = 2 個單位（禁逐張算 1）
      chk('啪嚓海膽｜能量粉碎 火箭隊能量算 2 個 → 40', has(r2,/能量 2 /), logs(r2).filter(m=>/能量粉碎/.test(m))[0]);
    }
  }
}
// 4b) ⭐繁茂 host-aware 修正的 HEAD-FAIL 核心案：同措辭的兩張卡必須算出同一個數
{
  const bloom=[...pool.values()].find(x=>x.name==='大竺葵'&&(x.abilities||[]).some(a=>a.name==='繁茂'));
  const grass=[...pool.values()].find(x=>x.name==='基本【草】能量');
  const pairs=[['優雅貓','能量粉碎','(v2353 版：本來就正確)'],
               ['塗標客','能量塗鴉','(effects.ts oppAll 版：v6.069 修)'],
               ['霏歐納','能量壓制','(effects.ts defActive 版：v6.069 修)']];
  const got={};
  for(const [cn,an,mark] of pairs){
    const c=find(cn,an); if(!c||!bloom||!grass){chk(`${cn}|${an} harness 前置`,false);continue;}
    const a=run(an,c,EVO,{defEnergyCards:[grass.id,grass.id]});
    const b=run(an,c,EVO,{defEnergyCards:[grass.id,grass.id],oppBenchCards:[bloom.id]});
    got[cn]={no:dmgOf(a),yes:dmgOf(b)};
    chk(`${cn}｜${an} 對手側有繁茂→基本草各算 2 個(傷害翻倍)${mark}`,
        dmgOf(b)>dmgOf(a) && dmgOf(b)===dmgOf(a)*2, `無繁茂=${dmgOf(a)} 有繁茂=${dmgOf(b)}`);
  }
  // 正對照本來就對；若 harness 壞掉三張會一起 FAIL（分辨「實作壞」vs「測試壞」）
  chk('繁茂案 harness 有效（正對照 優雅貓 有算出傷害）', (got['優雅貓']?.no ?? 0) > 0, JSON.stringify(got['優雅貓']));
}

// 5) 若希望：抽到手牌 6 張（龍捲雲）＋ 牌庫任選 2 張（烈箭鷹ex）— 皆有既有正對照
for(const [cn,an,mark] of [['龍捲雲','螺旋俯衝',''],['竹蘭的烈咬陸鯊ex','螺旋俯衝','(既有正對照)']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{deckN:12});
  chk(`${cn}｜${an} 抽到手牌滿 6 張${mark}`, cnt(r?.players?.[0]?.hand)===6, `hand=${cnt(r?.players?.[0]?.hand)}`);
}
for(const [cn,an,dmg,mark] of [['烈箭鷹ex','鉤爪搜尋',150,''],['貓頭夜鷹','鉤爪搜尋',70,'(既有正對照)']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{deckN:8});
  const p=r?.pendingSelection;
  chk(`${cn}｜${an} 開牌庫任選 picker(最多 2 張)${mark}`,
      p?.type==='deck-search' && p?.maxCount===2, `${p?.type} max=${p?.maxCount}`);
}
// 5b) 兩張都要有 binary-yes-no 前置選擇 spec（卡面「若希望」）
chk('龍捲雲｜螺旋俯衝 有「若希望」前置選擇 spec', PRE_CHOICE.has('龍捲雲|螺旋俯衝'));
chk('烈箭鷹ex｜鉤爪搜尋 有「若希望」前置選擇 spec', PRE_CHOICE.has('烈箭鷹ex|鉤爪搜尋'));
chk('竹蘭的烈咬陸鯊ex｜螺旋俯衝 前置選擇 spec 仍在(既有正對照)', PRE_CHOICE.has('竹蘭的烈咬陸鯊ex|螺旋俯衝'));

// 6) 對手場上「擁有特性」的寶可夢數 ×50（夢歌仙人掌）
{
  const c=find('夢歌仙人掌','懲罰尖刺');
  const withAb=[...pool.values()].find(x=>x.supertype==='Pokemon'&&x.stage==='Basic'&&(x.abilities||[]).length>0&&Number(x.hp)>=100);
  if(!c||!withAb) chk('夢歌仙人掌 harness 前置',false);
  else{
    const r0=run('懲罰尖刺',c,EVO,{oppBench:0});                    // 受方 EVO 無特性
    const r2=run('懲罰尖刺',c,EVO,{oppBenchCards:[withAb.id,withAb.id]});
    chk('夢歌仙人掌｜懲罰尖刺 對手 0 隻有特性 → 10', has(r0,/0 隻 × 50 \+ 10 → 10/), logs(r0).filter(m=>/懲罰尖刺/.test(m))[0]);
    chk('夢歌仙人掌｜懲罰尖刺 對手 2 隻有特性 → 110', has(r2,/2 隻 × 50 \+ 10 → 110/), logs(r2).filter(m=>/懲罰尖刺/.test(m))[0]);
  }
}

// 7) 牌庫選 1 能量附備戰（露力麗）— 既有 謝米 正對照
for(const [cn,an,mark] of [['露力麗','蹦蹦充能',''],['謝米','親送花朵','(既有正對照)']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const en=[...pool.values()].find(x=>x.name==='基本【草】能量');
  const gr=[...pool.values()].find(x=>x.supertype==='Pokemon'&&x.pokemonType==='Grass'&&x.stage==='Basic');
  const r=run(an,c,EVO,{deckCards:[en.id,en.id],selfBenchCards:[gr?.id ?? PLAIN.id]});
  const p=r?.pendingSelection;
  chk(`${cn}｜${an} 開 deck-search filter=Energy${mark}`,
      p?.type==='deck-search' && p?.filter==='Energy', `${p?.type} filter=${p?.filter}`);
}

// 8) 拖出：選對手備戰互換 + 新上場受 40（赤面龍）— 既有 勇士雄鷹 正對照
for(const [cn,an,dmg,mark] of [['赤面龍','拖出',40,''],['勇士雄鷹','拖出',40,'(既有正對照)']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,EVO,{oppBench:2});
  const p=r?.pendingSelection;
  chk(`${cn}｜${an} 開 opp-bench-choose${mark}`, p?.type==='opp-bench-choose', p?.type);
  chk(`${cn}｜${an} 互換後新上場受 ${dmg}${mark}`, p?.params?.damage===dmg, `dmg=${p?.params?.damage}`);
}

// 9) 掀起波浪：雙方手牌回牌庫重洗 + 各抽 4
{
  const c=find('巨翅飛魚','掀起波浪');
  if(!c) chk('巨翅飛魚|掀起波浪 存在',false);
  else{
    const r=run('掀起波浪',c,EVO,{deckN:10,oppDeckN:10,oppHand:7});
    chk('巨翅飛魚｜掀起波浪 自己手牌 = 4', cnt(r?.players?.[0]?.hand)===4, `hand=${cnt(r?.players?.[0]?.hand)}`);
    chk('巨翅飛魚｜掀起波浪 對手手牌 = 4（原 7 張回庫）', cnt(r?.players?.[1]?.hand)===4, `oppHand=${cnt(r?.players?.[1]?.hand)}`);
  }
}

// 10) 雷公ex｜雷霆纏身：先攻首回合可用 + 牌庫選「能量卡」(含特殊)
{
  const c=find('雷公ex','雷霆纏身');
  const special=[...pool.values()].find(x=>x.supertype==='Energy'&&x.subtype!=='Basic');
  if(!c) chk('雷公ex|雷霆纏身 存在',false);
  else{
    chk('雷公ex｜雷霆纏身 在先攻首回合白名單', FIRST_TURN.has('雷霆纏身'));
    chk('既有 信使鳥｜急速之禮 仍在白名單(正對照)', FIRST_TURN.has('急速之禮'));
    const r=run('雷霆纏身',c,EVO,{deckCards:[special?.id ?? EID.Lightning, EID.Lightning]});
    const p=r?.pendingSelection;
    chk('雷公ex｜雷霆纏身 filter=Energy(非 BasicEnergy)', p?.filter==='Energy', `filter=${p?.filter}`);
    // 反向：既有 穿著熊｜力量充能 卡面寫「基本能量卡」→ 必須維持 BasicEnergy
    const bc=find('穿著熊','力量充能');
    if(bc){ const rb=run('力量充能',bc,EVO,{deckCards:[EID.Fighting,EID.Fighting]});
      chk('穿著熊｜力量充能 維持 BasicEnergy(既有正對照，不得被擴充波及)',
          rb?.pendingSelection?.filter==='BasicEnergy', `filter=${rb?.pendingSelection?.filter}`); }
  }
}

// 11) 騎拉帝納｜渾沌匍匐：只免傷害、玩家層級冷卻
{
  const c=find('騎拉帝納','渾沌匍匐');
  if(!c) chk('騎拉帝納|渾沌匍匐 存在',false);
  else{
    const r=run('渾沌匍匐',c,EVO);
    const a=r?.players?.[0]?.active;
    chk('騎拉帝納｜渾沌匍匐 設 immuneToAttackDamageNextTurn', a?.immuneToAttackDamageNextTurn===true);
    // ⚠ 反向斷言：卡面只寫「不會受到招式的傷害」，不得升級成傷害+效果全免疫
    chk('騎拉帝納｜渾沌匍匐 不得誤設 immuneToAllAttackNextTurn', a?.immuneToAllAttackNextTurn!==true);
    
    
    // 上個自己回合用過 → 本回合禁用
    const r2=run('渾沌匍匐',c,EVO,{atkPatch:{attackUsedLastSelfTurn:'渾沌匍匐'}});
    chk('騎拉帝納｜渾沌匍匐 上個自己回合用過→本回合被擋',
        has(r2,/上個自己的回合已使用過/) && r2?.players?.[0]?.active?.immuneToAttackDamageNextTurn!==true,
        logs(r2).slice(-1)[0]);
  }
}
console.log(`m6-wave7:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
