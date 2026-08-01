// v6.088 守衛（Wilson 實測回報兩項）
//   1. 傳說的熔岩洞在場 → 進化寶可夢的特性被消除（多龍奇｜偵查指令 不可用）
//      根因：USE_ABILITY handler 與 getUsableAbilities 都沒接中央 isAbilityHolderEffective
//   2. 庫瑟洛斯奇的企圖：對手手牌 ≤3 張時不可打出（打了也沒效果，白吃支援者權）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.v88-s.js'),E=join(ROOT,'.v88-e.ts'),O=join(ROOT,'.v88-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, getUsableAbilities, getPlayableTrainers } from './src/lib/game/engine';\n"
              +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, getUsableAbilities, getPlayableTrainers } = await import(pathToFileURL(O).href);

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const byName=(n,p2)=>[...pool.values()].find(c=>c.name===n && (!p2||p2(c)));
let n=0; const inst=(cid,e={})=>({iid:`v${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };
const logText=(l)=>String(l?.message ?? l?.text ?? l);

const DRAGONAIR = byName('多龍奇', c=>(c.abilities||[]).some(a=>a.name==='偵查指令'));
const CAVE      = byName('傳說的熔岩洞');
const NORMALST  = [...pool.values()].find(c=>c.subtype==='Stadium' && !c.name.includes('傳說') && ['H','I','J'].includes(c.regulationMark));
const BASICMON  = [...pool.values()].find(c=>c.supertype==='Pokemon' && (c.stage==='Basic') && (c.abilities||[]).length===0 && ['H','I','J'].includes(c.regulationMark));
const KUCEROSK  = byName('庫瑟洛斯奇的企圖');

function mk(over={}) {
  return { phase:'playing', turnPhase:'main', turn:5, activePlayerIndex:0, firstPlayerIdx:0,
    isFirstTurn:false, setupDone:[true,true], log:[], pendingSelection:null,
    activeStadium:undefined, activeStadiumPartner:undefined, activeStadiumOwnerIdx:undefined,
    stadiumPlayedThisTurn:[false,false], stadiumUsedThisTurn:[false,false],
    players:[{name:'P1',active:inst(DRAGONAIR.id),bench:[],hand:[],deck:[inst(BASICMON.id),inst(BASICMON.id),inst(BASICMON.id)],discard:[],prizes:[]},
             {name:'P2',active:inst(BASICMON.id),bench:[],hand:[],deck:[],discard:[],prizes:[]}], ...over };
}
const abIdxOf = (card, name) => (card.abilities||[]).findIndex(a=>a.name===name);

// ══ 1. 傳說的熔岩洞：進化寶可夢的特性被消除 ══
{
  chk('找得到多龍奇（偵查指令）與傳說的熔岩洞', !!DRAGONAIR && !!CAVE);
  // 1a. 沒有熔岩洞 → 可用（正對照）
  const st0 = mk();
  const usable0 = getUsableAbilities(st0, pool);
  chk('無熔岩洞：偵查指令在可用清單', usable0.some(u=>u.iid===st0.players[0].active.iid),
      JSON.stringify(usable0.map(u=>u.abilityName ?? u)));
  const r0 = applyAction(st0,{type:'USE_ABILITY',iid:st0.players[0].active.iid,
    abilityIndex:abIdxOf(DRAGONAIR,'偵查指令'),actorIdx:0},pool);
  chk('無熔岩洞：偵查指令可發動（開 picker 或改變盤面）',
      !!r0.pendingSelection || r0.log.length > st0.log.length, JSON.stringify(r0.pendingSelection?.effectKey));

  // 1b. ⭐ 熔岩洞在場 → 不可用（Wilson 回報的 bug）
  const st1 = mk({ activeStadium: inst(CAVE.id), activeStadiumPartner: inst(CAVE.id), activeStadiumOwnerIdx: 0 });
  const usable1 = getUsableAbilities(st1, pool);
  chk('⭐ 熔岩洞在場：偵查指令**不在**可用清單', !usable1.some(u=>u.iid===st1.players[0].active.iid),
      JSON.stringify(usable1.map(u=>u.abilityName ?? u)));
  const r1 = applyAction(st1,{type:'USE_ABILITY',iid:st1.players[0].active.iid,
    abilityIndex:abIdxOf(DRAGONAIR,'偵查指令'),actorIdx:0},pool);
  chk('⭐ 熔岩洞在場：引擎端拒絕發動（不開 picker）', !r1.pendingSelection, JSON.stringify(r1.pendingSelection?.effectKey));
  chk('⭐ 熔岩洞在場：log 說明被消除',
      r1.log.map(logText).some(t=>t.includes('被消除')), r1.log.map(logText).slice(-1)[0]);

  // 1c. ⭐ 對手打出的熔岩洞也算（卡面「雙方場上」）
  const st2 = mk({ activeStadium: inst(CAVE.id), activeStadiumPartner: inst(CAVE.id), activeStadiumOwnerIdx: 1 });
  chk('⭐ 對手的熔岩洞也消除我方進化寶可夢特性',
      !getUsableAbilities(st2, pool).some(u=>u.iid===st2.players[0].active.iid));

  // 1d. 否定對照：普通競技場不消除
  const st3 = mk({ activeStadium: inst(NORMALST.id), activeStadiumOwnerIdx: 0 });
  chk('否定對照：普通競技場 → 偵查指令仍可用',
      getUsableAbilities(st3, pool).some(u=>u.iid===st3.players[0].active.iid), NORMALST.name);
}

// ══ 2. 庫瑟洛斯奇的企圖：對手手牌 ≤3 張 → 不可打出 ══
{
  chk('找得到庫瑟洛斯奇的企圖', !!KUCEROSK);
  const mkK = (oppHandN) => {
    const card = inst(KUCEROSK.id);
    const st = mk();
    st.players[0].hand = [card];
    st.players[1].hand = Array.from({length: oppHandN}, () => inst(BASICMON.id));
    return { st, card };
  };
  for (const n2 of [0, 1, 2, 3]) {
    const { st, card } = mkK(n2);
    chk(`⭐ 對手手牌 ${n2} 張（≤3）→ 不在可打出清單`, !getPlayableTrainers(st, pool).includes(card.iid),
        JSON.stringify(getPlayableTrainers(st, pool)));
    const r = applyAction(st,{type:'PLAY_TRAINER',iid:card.iid,actorIdx:0},pool);
    chk(`⭐ 對手手牌 ${n2} 張 → 引擎不讓打出（卡還在手牌）`,
        r.players[0].hand.some(c=>c.iid===card.iid), String(r.players[0].hand.length));
  }
  // 正對照：對手手牌 4 張 → 可打出且要丟 1 張
  const { st, card } = mkK(4);
  chk('正對照：對手手牌 4 張 → 在可打出清單', getPlayableTrainers(st, pool).includes(card.iid));
  const r = applyAction(st,{type:'PLAY_TRAINER',iid:card.iid,actorIdx:0},pool);
  chk('正對照：對手手牌 4 張 → 開對手的棄牌 picker（丟 1 張）',
      r.pendingSelection?.type==='hand-discard' && r.pendingSelection?.minCount===1,
      `${r.pendingSelection?.type}/${r.pendingSelection?.minCount}`);
}

console.log(`test-v6088-lavacave-ability-gate: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
