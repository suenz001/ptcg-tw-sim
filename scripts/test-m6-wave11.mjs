// v6.078 守衛（M6 批次11）：蟲蟲恐慌×4、覺醒型直接進化、引誘出來/配樂之笛
//   ⭐ 每個機制都配「否定對照」＋「既有同措辭卡正對照」——沒有正對照時 harness 自壞會全綠。
//   ⚠ 一律走完整 ATTACK → RESOLVE_SELECTION 流程（手刻 ATTACK_POST 測不出 gate/pending）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.w11-s.js'),E=join(ROOT,'.w11-e.ts'),O=join(ROOT,'.w11-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame } from './src/lib/game/engine';\n"
              +"export { TRAINER_EFFECTS } from './src/lib/game/effects/_shared';\n"
              +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M = await import(pathToFileURL(O).href);
const { applyAction, createGame } = M;
const TRAINER_EFFECTS = M.TRAINER_EFFECTS ?? new Map(); // HEAD-FAIL 安全：舊版缺 export 時不整支炸

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const card=(id)=>pool.get(String(id));
const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
const EID={}; for(const [id,c] of pool){ if(c.supertype!=='Energy')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !EID[k]) EID[k]=id; }
EID.Colorless=EID.Water;
let n=0; const inst=(cid,e={})=>({iid:`w${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };
const logText=(l)=>String(l?.message ?? l?.text ?? l);
const strip=(s)=>logText(s).replace(/\[\[card:[^\]]*\]\]/g,'');

function mkState(atkId, defId, over={}, attackName=null) {
  const s0=createGame({name:'P1',entries:[{cardId:String(atkId),count:1}]},
                      {name:'P2',entries:[{cardId:String(defId),count:1}]},pool);
  const A=inst(atkId), D=inst(defId);
  // ⚠ 能量一律依「要打的那一招」的 cost 給（給錯 → canAffordAttack 失敗 → ATTACK 靜默 return → 假 FAIL）
  const atk=card(atkId);
  const theAtk = attackName ? (atk.attacks||[]).find(a=>a.name===attackName) : atk.attacks?.[0];
  const cost=(theAtk?.cost)||[];
  A.energyAttached=cost.map(t=>inst(EID[t]??EID.Water));
  return {...s0, phase:'playing', turnPhase:'main', turn:5, activePlayerIndex:0, firstPlayerIdx:0,
    isFirstTurn:false, setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    coinFlippedThisAttack:false, _attackerActiveBonusDone:false, activeStadium:null,
    pendingSelection:null, log:[],
    players:[{...s0.players[0], active:A, bench:[], hand:[], deck:[], discard:[], prizes:s0.players[0].prizes},
             {...s0.players[1], active:D, bench:[], hand:[], deck:[], discard:[], prizes:s0.players[1].prizes}],
    ...over};
}
const atkIndexOf=(cid,name)=>(card(cid).attacks||[]).findIndex(a=>a.name===name);

// ══ 1. 蟲蟲恐慌（雨翅蛾 19553 / 三蜜蜂 19556 / 圓絲蛛 19594 / 燒火蚣 19152 正對照）══
// 卡面：牌庫下方7張翻正面，×50 依「持有招式蟲蟲恐慌的寶可夢卡」張數；寶可夢洗回、其餘丟棄。
const BUG = [['雨翅蛾',19553],['三蜜蜂',19556],['圓絲蛛',19594],['燒火蚣',19152]];
for (const [nm,id] of BUG) {
  // 牌庫：頂 3 張雜卡 + 底 7 張（2 張蟲蟲恐慌寶可夢 + 1 張非蟲蟲恐慌寶可夢 + 4 張能量）
  const deck=[inst(EID.Water),inst(EID.Water),inst(EID.Water),
              inst(19556),inst(19594),inst(19585),
              inst(EID.Fire),inst(EID.Fire),inst(EID.Fire),inst(EID.Fire)];
  let st=mkState(id, 19583, {}, '蟲蟲恐慌');
  st.players[0].deck=deck;
  st.players[1].bench=[inst(19583)]; // 避免 KO → 遊戲結束短路後續 log
  const ai=atkIndexOf(id,'蟲蟲恐慌');
  const r=applyAction(st,{type:'ATTACK',attackIndex:ai,actorIdx:0},pool);
  // ⚠ 斷言「基礎傷害」而非最終 damage 欄（弱點/抵抗力會放大，且 KO 後 active 會被換掉）
  const preLog=r.log.map(logText).find(t=>t.includes('擁有「蟲蟲恐慌」招式的寶可夢'));
  chk(`${nm}|蟲蟲恐慌 2 張 → 100 基礎傷害`, !!preLog && preLog.includes('2 × 50 = 100'), preLog);
  chk(`${nm} 3 張寶可夢洗回牌庫`, r.players[0].deck.length===6, `deck=${r.players[0].deck.length}`);
  chk(`${nm} 4 張非寶可夢進棄牌`, r.players[0].discard.length===4, `discard=${r.players[0].discard.length}`);
  const revealed=r.log.filter(l=>strip(l).includes('翻為正面 7 張'));
  chk(`${nm} 公開揭示 7 張`, revealed.length===1);
}
// 否定對照：底 7 張全無蟲蟲恐慌卡 → 0 傷害
{
  let st=mkState(19553,19583,{},'蟲蟲恐慌');
  st.players[1].bench=[inst(19583)];
  st.players[0].deck=[inst(19585),...Array.from({length:7},()=>inst(EID.Fire))];
  const r=applyAction(st,{type:'ATTACK',attackIndex:atkIndexOf(19553,'蟲蟲恐慌'),actorIdx:0},pool);
  const t=r.log.map(logText).find(x=>x.includes('擁有「蟲蟲恐慌」招式的寶可夢'));
  chk('否定對照：底7張無蟲蟲恐慌卡 → 0 傷害', !!t && t.includes('0 × 50 = 0'), t);
}
// 否定對照：牌庫為空 → 0 傷害且不崩
{
  let st=mkState(19553,19583,{},'蟲蟲恐慌'); st.players[1].bench=[inst(19583)]; st.players[0].deck=[];
  const r=applyAction(st,{type:'ATTACK',attackIndex:atkIndexOf(19553,'蟲蟲恐慌'),actorIdx:0},pool);
  chk('否定對照：牌庫空 → 0 傷害', r.log.map(logText).some(x=>x.includes('牌庫為空 → 0 傷害')));
}

// ══ 2. 覺醒型直接進化（穿山鼠 19585 新 / 石居蟹 M2a 正對照）══
{
  let st=mkState(19585,19585,{},'覺醒');
  st.players[0].active.damage=20;
  const savedIid=st.players[0].active.iid;
  st.players[0].deck=[inst(19586), inst(EID.Fire), inst(EID.Fire)]; // 穿山王 M6
  const r1=applyAction(st,{type:'ATTACK',attackIndex:atkIndexOf(19585,'覺醒'),actorIdx:0},pool);
  const ps=r1.pendingSelection;
  chk('穿山鼠|覺醒 開 deck-search', ps?.type==='deck-search' && ps?.effectKey==='sandshrew-awaken-evolve',
      JSON.stringify(ps?.type)+'/'+ps?.effectKey);
  const valid=ps?.params?.validIids ?? [];
  chk('validIids 只含 evolvesFrom=穿山鼠 的卡', valid.length===1 && valid[0]===st.players[0].deck[0].iid);
  const r2=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:valid,actorIdx:0},pool);
  const act=r2.players[0].active;
  chk('進化成穿山王', card(act.cardId)?.name==='穿山王', card(act?.cardId)?.name);
  chk('進化保留 base iid', act.iid===savedIid);
  chk('進化保留傷害 20', (act.damage??0)===20, String(act?.damage));
  chk('進化卡已離開牌庫', r2.players[0].deck.length===2);
}
// 否定對照：牌庫無進化卡 → resolve 0 張，只重洗，active 不變
{
  let st=mkState(19585,19585,{},'覺醒');
  st.players[0].deck=[inst(EID.Fire),inst(EID.Fire)];
  const r1=applyAction(st,{type:'ATTACK',attackIndex:atkIndexOf(19585,'覺醒'),actorIdx:0},pool);
  chk('否定對照：無進化卡仍開 picker', r1.pendingSelection?.type==='deck-search');
  chk('否定對照：validIids 為空', (r1.pendingSelection?.params?.validIids??[]).length===0);
  const r2=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:[],actorIdx:0},pool);
  chk('否定對照：active 仍是穿山鼠', card(r2.players[0].active.cardId)?.name==='穿山鼠');
  chk('否定對照：牌庫張數不變', r2.players[0].deck.length===2);
}
// 正對照：石居蟹|覺醒（收斂後仍運作，effectKey 未變）
{
  const crab=[...pool.values()].find(c=>c.name==='石居蟹'&&(c.attacks||[]).some(a=>a.name==='覺醒'));
  const crabEvo=[...pool.values()].find(c=>c.evolvesFrom==='石居蟹');
  let st=mkState(crab.id, 19585, {}, '覺醒');
  st.players[0].deck=[inst(crabEvo.id)];
  const r1=applyAction(st,{type:'ATTACK',attackIndex:atkIndexOf(crab.id,'覺醒'),actorIdx:0},pool);
  chk('正對照 石居蟹|覺醒 effectKey 未變', r1.pendingSelection?.effectKey==='crab-awaken-evolve', r1.pendingSelection?.effectKey);
  const r2=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:[st.players[0].deck[0].iid],actorIdx:0},pool);
  chk('正對照 石居蟹進化成功', card(r2.players[0].active.cardId)?.evolvesFrom==='石居蟹');
}

// ══ 3. 引誘出來（勾魂眼 19596）/ 配樂之笛（正對照）══
function oppTop5State(atkId){
  let st=mkState(atkId, 19585, {}, atkId===19596?'引誘出來':null);
  // 對手牌庫頂 5 張：2 基礎寶可夢 + 1 進化寶可夢 + 2 能量
  st.players[1].deck=[inst(19585),inst(19594),inst(19586),inst(EID.Fire),inst(EID.Fire),
                      inst(EID.Water),inst(EID.Water)];
  return st;
}
{
  let st=oppTop5State(19596);
  const r1=applyAction(st,{type:'ATTACK',attackIndex:atkIndexOf(19596,'引誘出來'),actorIdx:0},pool);
  const ps=r1.pendingSelection;
  chk('引誘出來 開 deck-search', ps?.type==='deck-search' && ps?.effectKey==='sableye-lure-out', ps?.effectKey);
  chk('引誘出來 sourcePlayerIdx=對手', ps?.sourcePlayerIdx===1, String(ps?.sourcePlayerIdx));
  chk('引誘出來 filter=Basic:TOP5', ps?.filter==='Basic:TOP5', ps?.filter);
  const basics=[st.players[1].deck[0].iid, st.players[1].deck[1].iid];
  const r2=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:basics,actorIdx:0},pool);
  chk('對手備戰 +2', r2.players[1].bench.length===2, String(r2.players[1].bench.length));
  chk('放置的是 justPlaced', r2.players[1].bench.every(b=>b.justPlaced===true));
  chk('剩餘 3 張洗回對手牌庫', r2.players[1].deck.length===5, String(r2.players[1].deck.length));
  // ⭐ 公平性自驗：送進化寶可夢的 iid（非【基礎】）→ 不得放進備戰
  const r3=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:[st.players[1].deck[2].iid],actorIdx:0},pool);
  chk('公平性：非基礎寶可夢不放備戰', r3.players[1].bench.length===0, String(r3.players[1].bench.length));
  // ⭐ 公平性自驗：送不在翻開 5 張內的 iid（第 6 張）→ 不得放進備戰
  const r4=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:[st.players[1].deck[5].iid],actorIdx:0},pool);
  chk('公平性：翻開範圍外的卡不放備戰', r4.players[1].bench.length===0, String(r4.players[1].bench.length));
}
// 否定對照：對手備戰已滿 → 選了也放不進
{
  let st=oppTop5State(19596);
  st.players[1].bench=Array.from({length:5},()=>inst(19585));
  const r1=applyAction(st,{type:'ATTACK',attackIndex:atkIndexOf(19596,'引誘出來'),actorIdx:0},pool);
  const r2=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:[st.players[1].deck[0].iid],actorIdx:0},pool);
  chk('否定對照：對手備戰滿 → 不增加', r2.players[1].bench.length===5, String(r2.players[1].bench.length));
}
// 正對照：配樂之笛（Item）收斂後行為一致
{
  const flute=[...pool.values()].find(c=>c.name==='配樂之笛');
  let st=oppTop5State(19585);
  st.players[0].hand=[inst(flute.id)];
  const fn=TRAINER_EFFECTS.get('配樂之笛');
  chk('正對照 配樂之笛 handler 存在', typeof fn==='function');
  if (typeof fn==='function') {
    const r1=fn(st,0,pool,st.players[0].hand[0]);
    chk('正對照 配樂之笛 effectKey 未變', r1.pendingSelection?.effectKey==='melody-flute-place', r1.pendingSelection?.effectKey);
    const r2=applyAction(r1,{type:'RESOLVE_SELECTION',selectedIids:[st.players[1].deck[0].iid],actorIdx:0},pool);
    chk('正對照 配樂之笛 放 1 隻到對手備戰', r2.players[1].bench.length===1, String(r2.players[1].bench.length));
  }
}

console.log(`test-m6-wave11: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
