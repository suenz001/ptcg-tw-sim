// v6.080 守衛（M6 批次13-A）：超級泥偶巨人ex|啟動限制、烈箭鷹ex|激動俯衝
//   + 手牌特性中央 gate（getHandActivatableAbilities）三端一致
//   ⭐ 否定對照：手牌 9 張不能打 / 場上沒有【無】超級進化ex 不能發動 / 每回合 1 次 / 備戰滿
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.w13-s.js'),E=join(ROOT,'.w13-e.ts'),O=join(ROOT,'.w13-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame, getAvailableAttacks, getHandActivatableAbilities } from './src/lib/game/engine';\n"
              +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M = await import(pathToFileURL(O).href);
const { applyAction, createGame, getAvailableAttacks } = M;
const getHandActivatable = M.getHandActivatableAbilities ?? (() => []);  // HEAD-FAIL 安全

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const card=(id)=>pool.get(String(id));
const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
const EID={}; for(const [id,c] of pool){ if(c.supertype!=='Energy')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !EID[k]) EID[k]=id; }
let n=0; const inst=(cid,e={})=>({iid:`y${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };
const logText=(l)=>String(l?.message ?? l?.text ?? l);

const GOLURK = 19583;   // 超級泥偶巨人ex（啟動限制 / Stage1 / 350HP）
const RAYQ   = 19608;   // 超級烈空坐ex（Basic / Colorless / 超級進化ex）
const TALON  = 19612;   // 烈箭鷹ex（Stage2 / Colorless / 激動俯衝）

function mkState(activeId, over={}) {
  const s0=createGame({name:'P1',entries:[{cardId:String(activeId),count:1}]},
                      {name:'P2',entries:[{cardId:String(RAYQ),count:1}]},pool);
  const A=inst(activeId);
  const atk=card(activeId);
  A.energyAttached=((atk.attacks?.[0]?.cost)||[]).map(t=>inst(EID[t]??EID.Water));
  return {...s0, phase:'playing', turnPhase:'main', turn:5, activePlayerIndex:0, firstPlayerIdx:0,
    isFirstTurn:false, setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    coinFlippedThisAttack:false, _attackerActiveBonusDone:false, activeStadium:null,
    pendingSelection:null, log:[],
    players:[{...s0.players[0], active:A, bench:[], hand:[], deck:[], discard:[]},
             {...s0.players[1], active:inst(RAYQ), bench:[], hand:[], deck:[], discard:[]}],
    ...over};
}

// ══ 1. 超級泥偶巨人ex｜啟動限制 —— 手牌 ≥10 張才可使用招式 ══
{
  const filler = () => inst(EID.Water);
  // 手牌 10 張 → 可以打
  let st=mkState(GOLURK);
  st.players[0].hand=Array.from({length:10},filler);
  chk('啟動限制：手牌 10 張 → 招式可用', getAvailableAttacks(st,pool).length>0,
      String(getAvailableAttacks(st,pool).length));
  // ⭐ 否定對照：手牌 9 張 → 不可用（UI 反白）
  let st9={...st, players:[{...st.players[0], hand:Array.from({length:9},filler)}, st.players[1]]};
  chk('否定對照：手牌 9 張 → 招式反白', getAvailableAttacks(st9,pool).length===0,
      String(getAvailableAttacks(st9,pool).length));
  // ⭐ 引擎端也必須擋（兩端一致：UI 反白 + 後端拒絕）
  const r=applyAction(st9,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  chk('否定對照：手牌 9 張 → 引擎拒絕並寫入原因',
      r.log.map(logText).some(t=>t.includes('啟動限制')), r.log.map(logText).slice(-1)[0]);
  chk('否定對照：手牌 9 張 → 對手沒受傷', (r.players[1].active?.damage??0)===0);
}

// ══ 2. 烈箭鷹ex｜激動俯衝 —— 手牌有這張 + 自己場上有【無】超級進化ex ══
{
  // 場上有 超級烈空坐ex（Colorless Mega ex）→ 可發動
  let st=mkState(RAYQ);
  const talonInHand=inst(TALON);
  st.players[0].hand=[talonInHand];
  const list=getHandActivatable(st,0,pool);
  chk('激動俯衝：條件成立 → 列為可發動', list.some(a=>a.iid===talonInHand.iid && a.abilityName==='激動俯衝'),
      JSON.stringify(list));
  const ai=list.find(a=>a.iid===talonInHand.iid);
  const r=applyAction(st,{type:'USE_HAND_ABILITY',cardIid:talonInHand.iid,abilityIndex:ai?.abilityIndex??0,actorIdx:0},pool);
  chk('激動俯衝：烈箭鷹ex 上備戰', r.players[0].bench.some(b=>b.cardId===String(TALON)),
      JSON.stringify(r.players[0].bench.map(b=>b.cardId)));
  chk('激動俯衝：手牌少一張', r.players[0].hand.length===0, String(r.players[0].hand.length));
  chk('激動俯衝：放上去的標 justPlaced', r.players[0].bench[0]?.justPlaced===true);
  // ⭐ 每回合 1 次
  chk('激動俯衝：用過後不再列出', getHandActivatable(r,0,pool).length===0,
      JSON.stringify(getHandActivatable(r,0,pool)));

  // ⭐ 否定對照：場上沒有【無】超級進化ex（改成 超級泥偶巨人ex＝【超】屬性）→ 不可發動
  let st2=mkState(GOLURK);
  const t2=inst(TALON); st2.players[0].hand=[t2];
  chk('否定對照：場上的超級進化ex 是【超】屬性 → 不可發動',
      getHandActivatable(st2,0,pool).length===0, JSON.stringify(getHandActivatable(st2,0,pool)));
  const r2=applyAction(st2,{type:'USE_HAND_ABILITY',cardIid:t2.iid,abilityIndex:0,actorIdx:0},pool);
  chk('否定對照：引擎端也拒絕（手牌張數不變）', r2.players[0].hand.length===1, String(r2.players[0].hand.length));

  // ⭐ 否定對照：備戰滿 → 不可發動
  let st3=mkState(RAYQ);
  const t3=inst(TALON); st3.players[0].hand=[t3];
  st3.players[0].bench=Array.from({length:5},()=>inst(RAYQ));
  chk('否定對照：備戰滿 → 不可發動', getHandActivatable(st3,0,pool).length===0);
}

// ══ 3. 齒輪怪｜緊急迴轉 正對照（收斂後行為不變）══
{
  const kling=[...pool.values()].find(c=>c.name==='齒輪怪'&&(c.abilities||[]).some(a=>a.name==='緊急迴轉'));
  const stage2=[...pool.values()].find(c=>c.supertype==='Pokemon'&&c.stage==='Stage2');
  chk('正對照：找得到緊急迴轉版齒輪怪與 Stage2 卡', !!kling && !!stage2);
  if (kling && stage2) {
    let st=mkState(RAYQ);
    const k=inst(kling.id); st.players[0].hand=[k];
    st.players[1].active=inst(stage2.id);
    const list=getHandActivatable(st,0,pool);
    chk('正對照：對手有 Stage2 → 緊急迴轉可發動', list.some(a=>a.abilityName==='緊急迴轉'), JSON.stringify(list));
    // 否定對照：對手沒有 Stage2
    let st2={...st, players:[st.players[0], {...st.players[1], active:inst(RAYQ)}]};
    chk('正對照的否定面：對手無 Stage2 → 不可發動',
        !getHandActivatable(st2,0,pool).some(a=>a.abilityName==='緊急迴轉'));
  }
}

console.log(`test-m6-wave13: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
