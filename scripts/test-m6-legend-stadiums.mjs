// v6.077 守衛：M6 傳說競技場三個場地效果（批2 — 效果 hook，機制尚未上線）
//
// ⚠ 此時三張仍在 PENDING_STADIUMS（fail-closed，不可打出）→ 正常對局不會出現，
//   所以測試直接構造 state.activeStadium 驗證效果本身。
// ⭐ 每個效果都配**否定對照**：沒有該場地時不得觸發（否則就是誤傷全站）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.lg-s.js'),E=join(ROOT,'.lg-e.ts'),O=join(ROOT,'.lg-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`
export { applyAction, createGame, markHealsByDamageDecrease } from './src/lib/game/engine';
export { hasAnyEffectiveAbility, isAbilityHolderEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';
export { koPrizesAdjusted } from './src/lib/game/effects';
export { hasLegendStadiumInPlay, legendPeakPrizeReduction, LEGEND_STADIUM_NAMES } from './src/lib/game/effects/_shared';
export { STATIC_PASSIVE_STADIUMS } from './src/lib/game/effects/cards/stadiums';
import './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M0=await import(pathToFileURL(O).href);
// ⚠ fail-safe 取值：HEAD-FAIL 時舊版沒有這些 export，直接取用會讓整個 test **crash**，
//   而 crash 的輸出跟「測試檔自己寫壞」長得一樣，會誤導 HEAD-FAIL 判讀（v6.071 已痛過一次）。
const M = {
  ...M0,
  LEGEND_STADIUM_NAMES: M0.LEGEND_STADIUM_NAMES ?? new Set(),
  STATIC_PASSIVE_STADIUMS: M0.STATIC_PASSIVE_STADIUMS ?? new Set(),
  hasLegendStadiumInPlay: M0.hasLegendStadiumInPlay ?? (() => false),
  legendPeakPrizeReduction: M0.legendPeakPrizeReduction ?? (() => 0),
  markHealsByDamageDecrease: M0.markHealsByDamageDecrease ?? ((_p, n) => n),
};
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const all=[];
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){ if(c?.id==null)continue; pool.set(String(c.id),c); all.push(c); } }
const byName=(n)=>all.find(c=>c.name===n);
let n=0; const inst=(cid,e={})=>({iid:`L${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,x='')=>{ if(c)pass++; else{fail++;console.log('  ❌',t,x??'');} };
const TRENCH=byName('傳說的海溝'), PEAK=byName('傳說的山頂'), CAVE=byName('傳說的熔岩洞');
const OTHER=byName('N的城堡') ?? all.find(c=>c.subtype==='Stadium'&&!/傳說/.test(c.name));
const PLAIN=all.filter(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&!/ex$/.test(c.name)).sort((a,b)=>b.hp-a.hp)[0];
chk('harness 前置：三張傳說競技場都在卡池', !!TRENCH&&!!PEAK&&!!CAVE);
chk('harness 前置：找得到一張非傳說競技場當對照', !!OTHER, OTHER?.name);

// ── 0) 註冊面：三張都在 STATIC_PASSIVE_STADIUMS（stadiums.ts L244 鐵律）────
for(const nm of ['傳說的海溝','傳說的山頂','傳說的熔岩洞'])
  chk(`${nm} 已註冊 STATIC_PASSIVE_STADIUMS`, M.STATIC_PASSIVE_STADIUMS.has(nm));
chk('LEGEND_STADIUM_NAMES 三張齊全', M.LEGEND_STADIUM_NAMES.size===3);

function mk(stadiumId, o={}){
  const s0=M.createGame({name:'P1',entries:[{cardId:String(PLAIN.id),count:1}]},
                        {name:'P2',entries:[{cardId:String(PLAIN.id),count:1}]},pool);
  return {...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,pendingSelection:null,log:[],
    activeStadium: stadiumId? inst(stadiumId) : null, activeStadiumOwnerIdx: stadiumId?0:undefined,
    players:[{...s0.players[0],active:o.a??inst(PLAIN.id),bench:o.ab??[],hand:[],deck:[inst(PLAIN.id)],
              discard:[],prizes:Array.from({length:6},()=>inst(PLAIN.id))},
             {...s0.players[1],active:o.d??inst(PLAIN.id),bench:o.db??[],hand:[],deck:[inst(PLAIN.id)],
              discard:[],prizes:Array.from({length:6},()=>inst(PLAIN.id))}]};
}

// ── 1) 傳說的海溝：恢復的 HP ×2 ───────────────────────────────────────────
{
  const heal=(stadiumId, before, after, opts={})=>{
    const a=inst(PLAIN.id,{damage:before});
    const prev=mk(stadiumId,{a});
    const next={...prev, players:[{...prev.players[0], active:{...a, damage:after}}, prev.players[1]],
                ...(opts.moved? {_counterMoveSrcIids:[a.iid]} : {})};
    const out=M.markHealsByDamageDecrease(prev,next,pool);
    return out.players[0].active.damage;
  };
  chk('海溝：受傷 100 恢復 30 → 實際恢復 60（剩 40）', heal(TRENCH?.id,100,70)===40, `damage=${heal(TRENCH?.id,100,70)}`);
  chk('海溝：恢復量超過剩餘傷害時下限 0', heal(TRENCH?.id,50,20)===0, `damage=${heal(TRENCH?.id,50,20)}`);
  // ⭐否定對照：沒有海溝／換成別的競技場 → 一律不得加倍
  chk('否定對照：沒有競技場 → 恢復 30 就是 30（剩 70）', heal(null,100,70)===70, `damage=${heal(null,100,70)}`);
  chk('否定對照：其他競技場 → 不得加倍', heal(OTHER?.id,100,70)===70, `damage=${heal(OTHER?.id,100,70)}`);
  // ⭐否定對照：移動傷害指示物不是「恢復」→ 即使有海溝也不得加倍（v5.947）
  chk('否定對照：移動傷害指示物(非恢復) 有海溝也不得加倍',
      heal(TRENCH?.id,100,70,{moved:true})===70, `damage=${heal(TRENCH?.id,100,70,{moved:true})}`);
  // 傷害增加（受傷）不得被當成恢復
  chk('否定對照：傷害增加時不動', heal(TRENCH?.id,20,60)===60, `damage=${heal(TRENCH?.id,20,60)}`);
}

// ── 2) 傳說的山頂：【無】被對手招式傷害 KO → 獎賞 −1 ──────────────────────
{
  const colorless=all.find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Colorless'&&!/ex$/.test(c.name));
  const nonColorless=all.find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Fire'&&!/ex$/.test(c.name));
  chk('harness 前置：找得到【無】與非【無】寶可夢', !!colorless&&!!nonColorless);
  const red=(stadiumId, card, byAtk)=>M.legendPeakPrizeReduction(mk(stadiumId), card, pool, byAtk);
  chk('山頂：【無】被招式傷害 KO → −1', red(PEAK?.id, colorless, true)===-1);
  // ⭐否定對照 ×3
  chk('否定對照：非【無】寶可夢 → 不減', red(PEAK?.id, nonColorless, true)===0);
  chk('否定對照：效果KO（非招式傷害）→ 不減', red(PEAK?.id, colorless, false)===0);
  chk('否定對照：沒有山頂 → 不減', red(null, colorless, true)===0);
  chk('否定對照：其他競技場 → 不減', red(OTHER?.id, colorless, true)===0);
  // 走中央 koPrizesAdjusted（涵蓋 18+ KO 路徑）也要生效
  if(colorless){
    const ko=inst(colorless.id);
    const withPeak=M.koPrizesAdjusted(mk(PEAK?.id), ko, colorless, 0, 1, pool, true);
    const noPeak =M.koPrizesAdjusted(mk(null),      ko, colorless, 0, 1, pool, true);
    chk('山頂：koPrizesAdjusted 也少 1 張（涵蓋狙擊等 18+ KO 路徑）',
        withPeak.prizes === Math.max(0, noPeak.prizes - 1), `有山頂=${withPeak.prizes} 無=${noPeak.prizes}`);
    const effKO=M.koPrizesAdjusted(mk(PEAK?.id), ko, colorless, 0, 1, pool, false);
    chk('否定對照：koPrizesAdjusted 效果KO 不減', effKO.prizes === noPeak.prizes, `效果KO=${effKO.prizes}`);
  }
}

// ── 3) 傳說的熔岩洞：進化寶可夢特性全消 ───────────────────────────────────
{
  const evoWithAb=all.find(c=>c.supertype==='Pokemon'&&(c.stage==='Stage1'||c.stage==='Stage2')&&(c.abilities||[]).length>0);
  const basicWithAb=all.find(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&(c.abilities||[]).length>0);
  chk('harness 前置：找得到有特性的進化卡與基礎卡', !!evoWithAb&&!!basicWithAb,
      `evo=${evoWithAb?.name} basic=${basicWithAb?.name}`);
  const eff=(stadiumId, card)=>{
    const i=inst(card.id);
    return M.hasAnyEffectiveAbility(mk(stadiumId,{a:i}), i, card, 0, 'active', pool);
  };
  if(evoWithAb&&basicWithAb){
    chk('熔岩洞：進化寶可夢的特性被消除', eff(CAVE?.id, evoWithAb)===false);
    // ⭐否定對照 ×3
    chk('否定對照：**基礎**寶可夢的特性不受影響（卡面只寫進化）', eff(CAVE?.id, basicWithAb)===true);
    chk('否定對照：沒有競技場 → 進化寶可夢特性正常', eff(null, evoWithAb)===true);
    chk('否定對照：其他競技場 → 進化寶可夢特性正常', eff(OTHER?.id, evoWithAb)===true);
  }
}

// ── 4) 「名稱中有『傳說』的競技場」述詞（批4 三張連動卡要用）──────────────
{
  chk('hasLegendStadiumInPlay：海溝 → true', M.hasLegendStadiumInPlay(mk(TRENCH?.id), pool)===true);
  chk('hasLegendStadiumInPlay：山頂 → true', M.hasLegendStadiumInPlay(mk(PEAK?.id), pool)===true);
  chk('hasLegendStadiumInPlay：熔岩洞 → true', M.hasLegendStadiumInPlay(mk(CAVE?.id), pool)===true);
  chk('否定對照：其他競技場 → false', M.hasLegendStadiumInPlay(mk(OTHER?.id), pool)===false, OTHER?.name);
  chk('否定對照：沒有競技場 → false', M.hasLegendStadiumInPlay(mk(null), pool)===false);
}
console.log(`m6-legend-stadiums:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
