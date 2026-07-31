// v6.072 守衛：M6 訓練家批次10（美味飯糰／冒險提燈／基利／訂製背心）
//   ＋ ⭐tools.ts 檔尾遺失的「Tool 自動 TRAINER_GUARD」回歸守衛（v2.264 → v6.072 復原）。
//   ⭐正對照：阿克羅瑪的執著（兩步式搜尋）、渾厚鱗片（既有道具減傷）、既有 Tool 的 guard。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.m6wA-s.js'),E=join(ROOT,'.m6wA-e.ts'),O=join(ROOT,'.m6wA-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { createGame, getPlayableTrainers, applyAction } from './src/lib/game/engine';\n"
 +"export { TRAINER_EFFECTS, TRAINER_GUARDS } from './src/lib/game/effects/_shared';\n"
 +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const { createGame, getPlayableTrainers, applyAction, TRAINER_EFFECTS, TRAINER_GUARDS }=M;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const all=[];
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){ if(c?.id==null)continue; pool.set(String(c.id),c); all.push(c); } }
const byName=(n)=>all.find(c=>c.name===n&&['H','I','J'].includes(c.regulationMark));
let n=0; const inst=(cid,e={})=>({iid:`w${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,x='')=>{ if(c)pass++; else{fail++;console.log('  ❌',t,x??'');} };
const PLAIN=all.filter(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&!(c.abilities||[]).length&&!/ex$/.test(c.name)).sort((a,b)=>b.hp-a.hp)[0];
const logs=(r)=>(r?.log||[]).map(x=>x.message||'');
function mk(o={}){
  const s0=createGame({name:'P1',entries:[{cardId:String(PLAIN.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(PLAIN.id),count:1}]},pool);
  return {...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,activeStadium:null,pendingSelection:null,log:[],
    supporterPlayedThisTurn:false,
    players:[{...s0.players[0],active:o.a??inst(PLAIN.id),bench:o.ab??[],hand:o.hand??[],
              deck:o.deck??[inst(PLAIN.id)],discard:o.discard??[],prizes:Array.from({length:6},()=>inst(PLAIN.id))},
             {...s0.players[1],active:o.d??inst(PLAIN.id),bench:o.db??[],hand:[],
              deck:[inst(PLAIN.id)],discard:[],prizes:Array.from({length:6},()=>inst(PLAIN.id))}]};
}

// ── ⭐ A) Tool 自動 TRAINER_GUARD 回歸（v6.072 復原檔尾遺失的整段）─────────
{
  const tool=all.find(c=>c.supertype==='Trainer'&&c.subtype==='PokemonTool'&&['H','I','J'].includes(c.regulationMark));
  chk('harness 前置：找得到一張 Tool', !!tool, tool?.name);
  if(tool){
    const t1=inst(tool.id);
    // 場面：唯一的寶可夢已附道具 → 沒有任何可附加目標
    const stFull=mk({a:inst(PLAIN.id,{toolAttached:inst(tool.id)}),hand:[t1]});
    const playableFull=getPlayableTrainers(stFull,pool) ?? [];
    chk(`${tool.name}：全場都不能附道具時**不得**列為可打出（v2.264 guard 遺失回歸）`,
        !playableFull.includes(t1.iid), JSON.stringify(playableFull));
    const r=applyAction(stFull,{type:'PLAY_TRAINER',iid:t1.iid},pool);
    chk(`${tool.name}：引擎也拒絕打出（不會留下「回到手牌」的零變化循環）`,
        !logs(r).some(m=>/回到手牌/.test(m)), logs(r).slice(-1)[0]);
    // ⭐正對照：有可附加目標時**必須**列得出來（否則是 guard 過嚴，同樣是 bug）
    const t2=inst(tool.id);
    const stFree=mk({a:inst(PLAIN.id),hand:[t2]});
    const playableFree=getPlayableTrainers(stFree,pool) ?? [];
    chk(`${tool.name}：有可附加目標時仍列為可打出（正對照，防 guard 過嚴）`,
        playableFree.includes(t2.iid), JSON.stringify(playableFree));
  }
  // 檔案完整性：tools.ts 尾段整段遺失過一次 → 直接驗「有沒有註冊 guard」
  const toolNames=all.filter(c=>c.supertype==='Trainer'&&c.subtype==='PokemonTool').map(c=>c.name);
  const guarded=toolNames.filter(nm=>TRAINER_GUARDS.has(nm));
  chk('Tool 卡有被自動註冊 TRAINER_GUARD（>=20 張）', guarded.length>=20, `guarded=${guarded.length}/${new Set(toolNames).size}`);
}

// ── B) 美味飯糰：回 30 ＋ 棄牌區每張同名卡 +30（這張卡除外）──────────────
{
  const c=byName('美味飯糰');
  if(!c) chk('美味飯糰 存在',false);
  else{
    const run=(dmg,nInDiscard)=>{
      const card=inst(c.id);
      const st=mk({a:inst(PLAIN.id,{damage:dmg}),hand:[card],
                   discard:Array.from({length:nInDiscard},()=>inst(c.id))});
      return applyAction(st,{type:'PLAY_TRAINER',iid:card.iid},pool);
    };
    // ⚠ 受傷量必須 < 受方 HP，否則引擎的 sanity KO sweep 會直接擊倒 → active=null、讀不到 damage
    const D0 = Math.min(100, Number(PLAIN.hp) - 20);
    const r0=run(D0,0), r1=run(D0,1), r2=run(D0,2);
    const left=(r)=>r?.players?.[0]?.active?.damage;
    chk('美味飯糰：棄牌區 0 張 → 回 30', left(r0)===D0-30, `damage=${left(r0)} 期望=${D0-30}`);
    chk('美味飯糰：棄牌區 1 張 → 回 60', left(r1)===D0-60, `damage=${left(r1)} 期望=${D0-60}`);
    chk('美味飯糰：棄牌區 2 張 → 回 90', left(r2)===D0-90, `damage=${left(r2)} 期望=${D0-90}`);
    // ⚠「這張卡除外」：打出的那張自己不得被算進去（否則 0 張時會變成回 60）
    chk('美味飯糰：打出的這張自己不算（棄牌區 0 張時不得回 60）', left(r0)!==D0-60, `damage=${left(r0)}`);
    // 不得回超過已受傷害
    const rSmall=run(10,3);
    chk('美味飯糰：受傷 10 時只回 10（damage 不得為負）', left(rSmall)===0, `damage=${left(rSmall)}`);
  }
}

// ── C) 冒險提燈：兩步式（火 → 雷），公開揭示，最後才重洗 ──────────────────
{
  const c=byName('冒險提燈');
  const fire=all.find(x=>x.name==='基本【火】能量'), ltng=all.find(x=>x.name==='基本【雷】能量');
  const akuroma=byName('阿克羅瑪的執著');
  if(!c||!fire||!ltng) chk('冒險提燈 harness 前置',false);
  else{
    const card=inst(c.id);
    const f=inst(fire.id), l=inst(ltng.id);
    const st=mk({hand:[card],deck:[f,l,inst(PLAIN.id)]});
    const r1=applyAction(st,{type:'PLAY_TRAINER',iid:card.iid},pool);
    const p1=r1?.pendingSelection;
    chk('冒險提燈：步驟1 開 deck-search filter=Energy:Fire',
        p1?.type==='deck-search' && p1?.filter==='Energy:Fire' && p1?.maxCount===1,
        `${p1?.type} filter=${p1?.filter} max=${p1?.maxCount}`);
    const r2=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:[f.iid]},pool);
    const p2=r2?.pendingSelection;
    chk('冒險提燈：步驟2 開 deck-search filter=Energy:Lightning',
        p2?.type==='deck-search' && p2?.filter==='Energy:Lightning',
        `${p2?.type} filter=${p2?.filter}`);
    chk('冒險提燈：步驟1 公開揭示卡名（卡面「給對手看過」）',
        logs(r2).some(m=>/搜到.*基本【火】能量.*加入手牌/.test(m)), logs(r2).filter(m=>/冒險提燈/.test(m)).join(' | '));
    const r3=applyAction(r2,{type:'RESOLVE_SELECTION',selectedIids:[l.iid]},pool);
    const hand=(r3?.players?.[0]?.hand ?? []).map(x=>x.iid);
    chk('冒險提燈：兩張能量都進手牌', hand.includes(f.iid) && hand.includes(l.iid), JSON.stringify(hand));
    chk('冒險提燈：兩張都離開牌庫',
        !(r3?.players?.[0]?.deck ?? []).some(x=>x.iid===f.iid||x.iid===l.iid));
    // 牌庫沒有目標能量時要能 Pass（不卡死）
    const card2=inst(c.id);
    const stNo=mk({hand:[card2],deck:[inst(PLAIN.id)]});
    const q1=applyAction(stNo,{type:'PLAY_TRAINER',iid:card2.iid},pool);
    const q2=applyAction(q1,{type:'RESOLVE_SELECTION',selectedIids:[]},pool);
    const q3=applyAction(q2,{type:'RESOLVE_SELECTION',selectedIids:[]},pool);
    chk('冒險提燈：牌庫沒有對應能量時可 Pass 走完（不卡 pending）', !q3?.pendingSelection, q3?.pendingSelection?.type);
  }
  chk('既有 阿克羅瑪的執著 仍有 handler（同型兩步式正對照）', !!akuroma && TRAINER_EFFECTS.has('阿克羅瑪的執著'));
}

// ── D) 基利：支援者＋競技場「合計」最多 3 張（單一 picker 混選）────────────
{
  const c=byName('基利');
  const sup=all.find(x=>x.supertype==='Trainer'&&x.subtype==='Supporter'&&x.name!=='基利');
  const sta=all.find(x=>x.supertype==='Trainer'&&x.subtype==='Stadium');
  const item=all.find(x=>x.supertype==='Trainer'&&x.subtype==='Item');
  if(!c||!sup||!sta) chk('基利 harness 前置',false);
  else{
    const card=inst(c.id);
    const st=mk({hand:[card],deck:[inst(sup.id),inst(sta.id),inst(item.id)]});
    const r=applyAction(st,{type:'PLAY_TRAINER',iid:card.iid},pool);
    const p=r?.pendingSelection;
    chk('基利：開 deck-search、最多 3 張', p?.type==='deck-search' && p?.maxCount===3,
        `${p?.type} max=${p?.maxCount}`);
    chk('基利：filter 同時涵蓋支援者與競技場（合計，非各 3 張）',
        p?.filter==='SupporterOrStadium', `filter=${p?.filter}`);
  }
}

// ── E) 訂製背心：受 Mega ex 招式傷害 -60，持有者自己是 Mega ex 則不減 ──────
{
  const vest=byName('訂製背心');
  // 挑「傷害最低」的 Mega ex 招式，讓受方撐得住（KO 後 active=null → damage 讀成 -1 假 FAIL）
  const megaCands=all.filter(x=>x.supertype==='Pokemon'&&x.subtype==='ex'&&x.name.startsWith('超級')
                       &&(x.attacks||[]).some(a=>Number(a.damage)>0&&!a.effect&&(a.cost||[]).length<=4));
  megaCands.sort((a,b)=>{
    const la=Math.min(...a.attacks.filter(x=>Number(x.damage)>0&&!x.effect).map(x=>Number(x.damage)));
    const lb=Math.min(...b.attacks.filter(x=>Number(x.damage)>0&&!x.effect).map(x=>Number(x.damage)));
    return la-lb;
  });
  const mega=megaCands[0];
  if(!vest||!mega) chk('訂製背心 harness 前置',false,`vest=${!!vest} mega=${!!mega}`);
  else{
    const lowest=Math.min(...mega.attacks.filter(x=>Number(x.damage)>0&&!x.effect).map(x=>Number(x.damage)));
    const ai=mega.attacks.findIndex(a=>Number(a.damage)===lowest&&!a.effect);
    const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
    const eid={}; for(const x of all){ if(x.supertype!=='Energy')continue;
      for(const [k,z] of Object.entries(ZH)) if(x.name===`基本【${z}】能量`&&!eid[k]) eid[k]=x.id; }
    const A=inst(mega.id); A.energyAttached=(mega.attacks[ai].cost||[]).map(t=>inst(eid[t]??eid.Water));
    const hitFor=(defCardId,withVest)=>{
      const D=inst(defCardId, withVest?{toolAttached:inst(vest.id)}:{});
      const st={...mk({a:A,d:D})};
      const r=applyAction(st,{type:'ATTACK',attackIndex:ai},pool);
      return r?.players?.[1]?.active?.damage ?? -1;
    };
    // ⚠ 受方 HP 要撐得住這一擊，否則 KO 後 active=null、damage 讀成 -1（假 FAIL）
    const printed=Number(mega.attacks[ai].damage);
    // ⚠ 受方還要**不弱攻方屬性**（弱點×2 會把 -60 的相對差放大／改寫，讀不出乾淨的 60）
    const TOUGH=all.filter(x=>x.supertype==='Pokemon'&&!x.name.startsWith('超級')
                            &&x.weakness?.type!==mega.pokemonType&&Number(x.hp)>=printed+70)
                   .sort((a,b)=>Number(b.hp)-Number(a.hp))[0];
    chk(`harness 前置：找得到撐得住 ${printed} 傷害、且不弱${mega.pokemonType}的受方`,
        !!TOUGH, `mega=${mega.name} 印刷=${printed} tough=${TOUGH?.name}(${TOUGH?.hp})`);
    if(!TOUGH) throw new Error('harness 找不到合適受方');
    const noVest=hitFor(TOUGH.id,false), withVest=hitFor(TOUGH.id,true);
    chk('訂製背心：受 Mega ex 招式傷害 -60',
        noVest>0 && withVest>=0 && (noVest-withVest)===60, `無背心=${noVest} 有背心=${withVest}`);
    // 持有者自己是 Mega ex → 卡面「超級進化寶可夢【ex】除外」→ 不減
    const megaDef=all.find(x=>x.supertype==='Pokemon'&&x.subtype==='ex'&&x.name.startsWith('超級')&&Number(x.hp)>=250);
    if(megaDef){
      const a=hitFor(megaDef.id,false), b=hitFor(megaDef.id,true);
      chk('harness 前置：Mega ex 受方沒被一擊 KO', a>0, `damage=${a} (${megaDef.name} hp=${megaDef.hp})`);
      chk('訂製背心：持有者自己是 Mega ex → **不**減傷（卡面「…除外」）', a===b, `無背心=${a} 有背心=${b}`);
    }
    // 攻擊方不是 Mega ex → 不減
    const normal=all.find(x=>x.supertype==='Pokemon'&&!x.name.startsWith('超級')
      &&x.pokemonType===mega.pokemonType
      &&(x.attacks||[]).some(a=>Number(a.damage)>0&&Number(a.damage)<=printed&&!a.effect&&(a.cost||[]).length<=3));
    if(normal){
      const ni=normal.attacks.findIndex(a=>Number(a.damage)>0&&Number(a.damage)<=printed&&!a.effect&&(a.cost||[]).length<=3);
      const NA=inst(normal.id); NA.energyAttached=(normal.attacks[ni].cost||[]).map(t=>inst(eid[t]??eid.Water));
      const hit2=(withVest)=>{
        const D=inst(TOUGH.id, withVest?{toolAttached:inst(vest.id)}:{});
        return applyAction(mk({a:NA,d:D}),{type:'ATTACK',attackIndex:ni},pool)?.players?.[1]?.active?.damage ?? -1;
      };
      chk('harness 前置：非 Mega ex 攻擊有真的打出傷害', hit2(false)>0, `damage=${hit2(false)}`);
      chk('訂製背心：攻擊方不是 Mega ex → 不減傷', hit2(false)===hit2(true), `${hit2(false)} vs ${hit2(true)}`);
    }
  }
}
// ── F) 希嘉娜的信賴：互換 ＋ 選 1 個能量改附 ─────────────────────────────
{
  const c=byName('希嘉娜的信賴');
  const rush=byName('急進開關');   // 同型範本（差別：那張是「任意數量」）
  const en=all.find(x=>x.name==='基本【水】能量');
  if(!c||!en) chk('希嘉娜的信賴 harness 前置',false);
  else{
    const card=inst(c.id);
    const A=inst(PLAIN.id); A.energyAttached=[inst(en.id),inst(en.id)];
    const B=inst(PLAIN.id);
    const st=mk({a:A,ab:[B],hand:[card]});
    const r1=applyAction(st,{type:'PLAY_TRAINER',iid:card.iid},pool);
    chk('希嘉娜的信賴：先開 bench-choose 選換入的備戰', r1?.pendingSelection?.type==='bench-choose', r1?.pendingSelection?.type);
    const r2=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:[B.iid]},pool);
    chk('希嘉娜的信賴：互換完成（B 上戰鬥場）', r2?.players?.[0]?.active?.iid===B.iid, r2?.players?.[0]?.active?.iid);
    const p2=r2?.pendingSelection;
    chk('希嘉娜的信賴：接著開能量 picker、且**只能選 1 個**（卡面「1個」非任意數量）',
        p2?.type==='active-energy-discard' && p2?.minCount===1 && p2?.maxCount===1,
        `${p2?.type} min=${p2?.minCount} max=${p2?.maxCount}`);
    const eIid=A.energyAttached[0].iid;
    const r3=applyAction(r2,{type:'RESOLVE_SELECTION',selectedIids:[eIid]},pool);
    chk('希嘉娜的信賴：能量移到新戰鬥寶可夢',
        (r3?.players?.[0]?.active?.energyAttached ?? []).some(e=>e.iid===eIid),
        JSON.stringify((r3?.players?.[0]?.active?.energyAttached ?? []).map(e=>e.iid)));
    chk('希嘉娜的信賴：換下去那隻少 1 張能量',
        (r3?.players?.[0]?.bench?.find(b=>b.iid===A.iid)?.energyAttached ?? []).length===1);
    // ⚠ client 送 2 個 iid 也只能移 1 張（引擎不驗 maxCount → resolver 自己夾）
    const r3b=applyAction(r2,{type:'RESOLVE_SELECTION',selectedIids:A.energyAttached.map(e=>e.iid)},pool);
    chk('希嘉娜的信賴：client 送 2 個也只移 1 張（resolver 自行夾上限）',
        (r3b?.players?.[0]?.active?.energyAttached ?? []).length===1,
        `${(r3b?.players?.[0]?.active?.energyAttached ?? []).length}`);
    // 換下去那隻沒能量 → 只互換、不開 picker
    const card2=inst(c.id);
    const A2=inst(PLAIN.id), B2=inst(PLAIN.id);
    const q=applyAction(mk({a:A2,ab:[B2],hand:[card2]}),{type:'PLAY_TRAINER',iid:card2.iid},pool);
    const q2=applyAction(q,{type:'RESOLVE_SELECTION',selectedIids:[B2.iid]},pool);
    chk('希嘉娜的信賴：換下的沒能量 → 只互換不開 picker',
        !q2?.pendingSelection && q2?.players?.[0]?.active?.iid===B2.iid, q2?.pendingSelection?.type);
  }
  chk('既有 急進開關 仍有 handler（同型正對照）', !!rush && TRAINER_EFFECTS.has('急進開關'));
}
console.log(`m6-wave10:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
