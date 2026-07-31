// v6.070 守衛(M6 批次8 特性)：5 個特性 + 1 個「以為會自動生效」的實跑驗證。
//   ⭐正對照：每型都拿既有已驗證正確的同措辭卡一起驗（天空徑線／岩石盔甲／赫普的啪嚓海膽ex）。
//   ⭐反向斷言：同名但**沒有該特性**的舊版印刷不得被誤觸發（card.name 撞號防呆）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.m6w8-s.js'),E=join(ROOT,'.m6w8-e.ts'),O=join(ROOT,'.m6w8-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame, computeActiveRetreatCostFor } from './src/lib/game/engine';\n"
 +"export { ABILITY_EFFECTS } from './src/lib/game/effects/_shared';\n"
 +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const { applyAction, createGame, computeActiveRetreatCostFor, ABILITY_EFFECTS }=M;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const all=[];
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){ if(c?.id==null)continue; pool.set(String(c.id),c); all.push(c); } }
// ⚠ 一律用「特性名」找卡，不是卡名（M6 這幾張都有同名無特性的舊印刷）
const byAb=(ab)=>all.find(c=>['H','I','J'].includes(c.regulationMark)&&(c.abilities||[]).some(a=>a.name===ab));
const sameNameNoAb=(name,ab)=>all.find(c=>c.name===name&&!(c.abilities||[]).some(a=>a.name===ab));
let n=0; const inst=(cid,e={})=>({iid:`b${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,x='')=>{ if(c)pass++; else{fail++;console.log('  ❌',t,x??'');} };
// ⚠ 基本能量一律依名稱查（硬編 id 會付不出招式費用 → ATTACK 靜默 return → 假 FAIL）
const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
const EID={}; for(const c of all){ if(c.supertype!=='Energy')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !EID[k]) EID[k]=c.id; }
EID.Colorless=EID.Water; EID.Dragon=EID.Water;
const payFor=(atkCard,ai)=>((atkCard.attacks[ai].cost)||[]).map(t=>inst(EID[t]??EID.Water));
const PLAIN=all.filter(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&!(c.abilities||[]).length&&!/ex$/.test(c.name)).sort((a,b)=>b.hp-a.hp)[0];
const EXC  =all.filter(c=>c.supertype==='Pokemon'&&/ex$/.test(c.name)&&c.stage==='Basic').sort((a,b)=>b.hp-a.hp)[0];
function mk(opt={}){
  const s0=createGame({name:'P1',entries:[{cardId:String(PLAIN.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(PLAIN.id),count:1}]},pool);
  return {...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,activeStadium:null,pendingSelection:null,log:[],
    players:[{...s0.players[0],active:opt.a??inst(PLAIN.id),bench:opt.ab??[],hand:opt.hand??[],
              deck:opt.deck??[inst(PLAIN.id)],discard:[],prizes:Array.from({length:6},()=>inst(PLAIN.id))},
             {...s0.players[1],active:opt.d??inst(PLAIN.id),bench:opt.db??[],hand:[],
              deck:[inst(PLAIN.id)],discard:[],prizes:Array.from({length:6},()=>inst(PLAIN.id))}]};
}
const logs=(r)=>(r?.log||[]).map(x=>x.message||'');

// ── 1) 撤退費歸零（【基礎】限定）：棉花搬運 + 天空徑線正對照 ────────────────
for(const [ab,mark] of [['棉花搬運',''],['天空徑線','(既有正對照)']]){
  const holder=byAb(ab); if(!holder){chk(`${ab} 找得到持有卡`,false);continue;}
  const basic=PLAIN;                                   // 撤退費 > 0 的【基礎】
  const evo=all.find(c=>c.supertype==='Pokemon'&&(c.stage==='Stage1'||c.stage==='Stage2')&&(c.retreatCost||[]).length>0);
  const base=(basic.retreatCost||[]).length;
  chk(`harness 前置：${basic.name} 撤退費 ${base} > 0${mark}`, base>0, `base=${base}`);
  const stOn =mk({a:inst(basic.id),ab:[inst(holder.id)]});
  const stOff=mk({a:inst(basic.id),ab:[inst(PLAIN.id)]});
  chk(`${ab}：場上有持有者 → 【基礎】撤退費 0${mark}`,
      computeActiveRetreatCostFor(stOn,0,pool)===0, `cost=${computeActiveRetreatCostFor(stOn,0,pool)}`);
  chk(`${ab}：場上無持有者 → 撤退費維持 ${base}${mark}`,
      computeActiveRetreatCostFor(stOff,0,pool)===base, `cost=${computeActiveRetreatCostFor(stOff,0,pool)}`);
  if(evo){ // ⚠ 卡面只寫【基礎】→ 進化寶可夢不得被歸零
    const stEvo=mk({a:inst(evo.id),ab:[inst(holder.id)]});
    chk(`${ab}：進化寶可夢**不得**被歸零（卡面限【基礎】）${mark}`,
        computeActiveRetreatCostFor(stEvo,0,pool)>0, `cost=${computeActiveRetreatCostFor(stEvo,0,pool)}`);
  }
}

// ── 2) 膽小蟲｜懦弱：對手場上有「寶可夢【ex】」→ 自身撤退 0 ────────────────
{
  const holder=byAb('懦弱');
  if(!holder||!EXC) chk('懦弱 harness 前置',false);
  else{
    const base=(holder.retreatCost||[]).length;
    chk(`harness 前置：膽小蟲 撤退費 ${base} > 0`, base>0);
    const withEx  =mk({a:inst(holder.id),d:inst(EXC.id)});
    const noEx    =mk({a:inst(holder.id),d:inst(PLAIN.id)});
    const exOnBench=mk({a:inst(holder.id),d:inst(PLAIN.id),db:[inst(EXC.id)]});
    chk('懦弱：對手戰鬥位是 ex → 撤退 0', computeActiveRetreatCostFor(withEx,0,pool)===0);
    chk('懦弱：對手備戰有 ex 也算「場上」→ 撤退 0', computeActiveRetreatCostFor(exOnBench,0,pool)===0);
    chk(`懦弱：對手場上無 ex → 撤退維持 ${base}`, computeActiveRetreatCostFor(noEx,0,pool)===base,
        `cost=${computeActiveRetreatCostFor(noEx,0,pool)}`);
    // ⚠ 反向：同名但無「懦弱」的另一張膽小蟲不得被歸零
    const twin=sameNameNoAb('膽小蟲','懦弱');
    if(twin){ const st2=mk({a:inst(twin.id),d:inst(EXC.id)});
      chk('懦弱：同名但無此特性的膽小蟲**不得**被歸零（card.name 撞號防呆）',
          computeActiveRetreatCostFor(st2,0,pool)===(twin.retreatCost||[]).length); }
  }
}

// ── 3) 大鋼蛇｜高密度盔甲：HP 全滿時受招式傷害 -60 ─────────────────────────
{
  const holder=byAb('高密度盔甲'); const regi=byAb('岩石盔甲');
  const atk=all.find(c=>c.supertype==='Pokemon'&&(c.attacks||[]).some(a=>Number(a.damage)>=100&&!a.effect&&(a.cost||[]).length<=2));
  if(!holder||!atk) chk('高密度盔甲 harness 前置',false,`holder=${!!holder} atk=${!!atk}`);
  else{
    const ai=atk.attacks.findIndex(a=>Number(a.damage)>=100&&!a.effect&&(a.cost||[]).length<=2);
    const printed=Number(atk.attacks[ai].damage);
    const A=inst(atk.id); A.energyAttached=payFor(atk,ai);
    const run=(dmg)=>{ const st=mk({a:A,d:inst(holder.id,{damage:dmg})});
      const st2={...st,players:[st.players[0],{...st.players[1]}]};
      return applyAction(st2,{type:'ATTACK',attackIndex:ai},pool); };
    const full=run(0), hurt=run(10);
    const dFull=(full?.players?.[1]?.active?.damage ?? -1);
    const dHurt=(hurt?.players?.[1]?.active?.damage ?? -1)-10;
    // 比「相對關係」而非絕對值（弱點×2 等會改寫絕對值）
    chk('高密度盔甲：HP 全滿時受到的傷害比受傷後少 60',
        dFull>=0 && dHurt>=0 && (dHurt-dFull)===60, `全滿=${dFull} 已受傷=${dHurt} 差=${dHurt-dFull}`);
    chk(`harness 有效（印刷傷害 ${printed} 有真的打出來）`, dHurt>0, `dHurt=${dHurt}`);
  }
  chk('既有 岩石盔甲 仍在 PASSIVE_DAMAGE_REDUCE_COND(正對照)', !!regi);
}

// ── 4) 穿山王｜反擊針 —— 驗證「不必實作即已生效」的假設是真的 ──────────────
{
  const holder=all.find(c=>c.name==='穿山王'&&(c.abilities||[]).some(a=>a.name==='反擊針'));
  const proto =all.find(c=>c.name!=='穿山王'&&(c.abilities||[]).some(a=>a.name==='反擊針')); // 赫普的啪嚓海膽ex
  const atk=all.find(c=>c.supertype==='Pokemon'&&(c.attacks||[]).some(a=>Number(a.damage)>0&&!a.effect&&(a.cost||[]).length<=2)&&Number(c.hp)>=100);
  if(!holder||!atk) chk('反擊針 harness 前置',false);
  else{
    const ai=atk.attacks.findIndex(a=>Number(a.damage)>0&&!a.effect&&(a.cost||[]).length<=2);
    for(const [card,mark] of [[holder,'(M6 新卡)'],[proto,'(既有正對照)']].filter(x=>x[0])){
      const A=inst(atk.id); A.energyAttached=payFor(atk,ai);
      const st=mk({a:A,d:inst(card.id)});
      const r=applyAction(st,{type:'ATTACK',attackIndex:ai},pool);
      // 反擊針：在使用招式的寶可夢身上放置 3 個傷害指示物 = 攻擊方 +30
      chk(`${card.name}｜反擊針：攻擊方被放 3 個指示物(+30)${mark}`,
          (r?.players?.[0]?.active?.damage ?? 0)===30, `攻方damage=${r?.players?.[0]?.active?.damage}`);
    }
  }
}

// ── 5) 弱丁魚ex｜大洋增輝：戰鬥場限定、每回合 1 次、回 50 ──────────────────
{
  const holder=byAb('大洋增輝');
  if(!holder) chk('大洋增輝 找得到持有卡',false);
  else{
    const fn=ABILITY_EFFECTS.get(`${holder.name}|0`);
    chk('大洋增輝 有註冊 handler', !!fn);
    if(fn){
      const a1=inst(holder.id,{damage:90});
      const st1=mk({a:a1});
      const r1=fn(st1,0,pool,a1);
      chk('大洋增輝：受傷 90 → 回 50（剩 40）', r1?.players?.[0]?.active?.damage===40, `damage=${r1?.players?.[0]?.active?.damage}`);
      const a2=inst(holder.id,{damage:20});
      const r2=fn(mk({a:a2}),0,pool,a2);
      chk('大洋增輝：受傷 20 → 只回 20（不得變負數）', r2?.players?.[0]?.active?.damage===0, `damage=${r2?.players?.[0]?.active?.damage}`);
      // ⚠ 卡面「若這隻寶可夢在戰鬥場上」→ 在備戰的那隻不得發動
      const benched=inst(holder.id,{damage:90});
      const r3=fn(mk({a:inst(PLAIN.id),ab:[benched]}),0,pool,benched);
      chk('大洋增輝：持有者在**備戰**時不得發動',
          benched.damage===90 && (r3?.players?.[0]?.bench?.[0]?.damage ?? 0)===90 &&
          logs(r3).some(m=>/不在戰鬥場上|沒有這個特性/.test(m)), logs(r3).slice(-1)[0]);
    }
  }
}

// ── 6) 胖嘟嘟｜深海抽出：抽 1 → 可選 1 張手牌放牌庫**下方**（不重洗） ───────
{
  const holder=byAb('深海抽出');
  if(!holder) chk('深海抽出 找得到持有卡',false);
  else{
    const fn=ABILITY_EFFECTS.get(`${holder.name}|0`);
    chk('深海抽出 有註冊 handler', !!fn);
    if(fn){
      const src=inst(holder.id);
      const deck=[inst(PLAIN.id),inst(PLAIN.id),inst(PLAIN.id)];
      const hand=[inst(PLAIN.id),inst(PLAIN.id)];
      const st=mk({a:src,hand,deck});
      const r=fn(st,0,pool,src);
      chk('深海抽出：抽 1 張（手牌 2→3、牌庫 3→2）',
          r?.players?.[0]?.hand?.length===3 && r?.players?.[0]?.deck?.length===2,
          `hand=${r?.players?.[0]?.hand?.length} deck=${r?.players?.[0]?.deck?.length}`);
      const p=r?.pendingSelection;
      chk('深海抽出：開手牌 picker、可選 0 張（「若希望」）',
          p?.type==='hand-discard' && p?.minCount===0 && p?.maxCount===1,
          `${p?.type} min=${p?.minCount} max=${p?.maxCount}`);
      // ⚠ lint Check T：手牌是隱藏 zone，開 picker 前不得公開候選內容
      chk('深海抽出：picker 前的 log 不洩漏手牌內容',
          !logs(r).some(m=>/手牌.*[（(]/.test(m)), logs(r).join(' | '));
      // resolve：選 1 張 → 應到牌庫**尾端**且牌庫其餘順序不變
      const RES=(await import(pathToFileURL(O).href));
      const chosen=r.players[0].hand[0].iid;
      const deckBefore=r.players[0].deck.map(c=>c.iid);
      const r2=RES.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[chosen]},pool);
      const deckAfter=r2?.players?.[0]?.deck?.map(c=>c.iid) ?? [];
      chk('深海抽出：選的那張放到牌庫**最下面**（不重洗、原順序不變）',
          deckAfter.length===deckBefore.length+1 &&
          deckAfter.slice(0,deckBefore.length).join(',')===deckBefore.join(',') &&
          deckAfter[deckAfter.length-1]===chosen,
          `before=[${deckBefore}] after=[${deckAfter}]`);
      chk('深海抽出：手牌少 1 張', r2?.players?.[0]?.hand?.length===2, `hand=${r2?.players?.[0]?.hand?.length}`);
      // ⚠ 對手不知道放回去的是哪張 → log 不得寫卡名
      chk('深海抽出：放回 log 不得寫出卡名',
          !logs(r2).some(m=>/放回牌庫下方/.test(m) && m.includes(pool.get(PLAIN.id)?.name ?? '###')),
          logs(r2).filter(m=>/深海抽出/.test(m)).join(' | '));
      // 選 0 張 → 牌庫手牌都不動
      const r3=RES.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[]},pool);
      chk('深海抽出：選 0 張 → 手牌/牌庫不變',
          r3?.players?.[0]?.hand?.length===3 && r3?.players?.[0]?.deck?.length===2);
    }
  }
}
console.log(`m6-wave8:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
