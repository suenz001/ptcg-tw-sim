// v6.084 守衛：傳說競技場「兩張合一」出牌機制 + 連動三卡
//   ⭐ 公平性核心：卡片守恆（兩張一起上場、一起離場，不複製也不蒸發）
//   ⭐ 否定對照：普通競技場（單張）行為零變化
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.lg-s.js'),E=join(ROOT,'.lg-e.ts'),O=join(ROOT,'.lg-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, getPlayableTrainers } from './src/lib/game/engine';\n"
              +"export { ATTACK_PRE, ATTACK_POST, TRAINER_EFFECTS, discardActiveStadium, PENDING_STADIUMS } from './src/lib/game/effects/_shared';\n"
              +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M = await import(pathToFileURL(O).href);
const { applyAction } = M;
const getPlayableTrainers = M.getPlayableTrainers ?? (() => []);
const ATTACK_PRE = M.ATTACK_PRE ?? new Map();
const ATTACK_POST = M.ATTACK_POST ?? new Map();
const TRAINER_EFFECTS = M.TRAINER_EFFECTS ?? new Map();
const PENDING = M.PENDING_STADIUMS ?? new Set();

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const byName=(n,p2)=>[...pool.values()].find(c=>c.name===n && (!p2||p2(c)));
const ZH={Water:'水',Fighting:'鬥'};
const EID={}; for(const [id,c] of pool){ if(c.supertype!=='Energy'||c.subtype!=='Basic')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !EID[k]) EID[k]=id; }
let n=0; const inst=(cid,e={})=>({iid:`L${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };
const logText=(l)=>String(l?.message ?? l?.text ?? l);

const TRENCH = byName('傳說的海溝');
const PEAK   = byName('傳說的山頂');
const NORMAL = [...pool.values()].find(c=>c.subtype==='Stadium' && !c.name.includes('傳說') && ['H','I','J'].includes(c.regulationMark));
const KYOGRE = byName('蓋歐卡', c=>(c.attacks||[]).some(a=>a.name==='狂暴漩渦'));
const GROUDON= byName('固拉多', c=>(c.attacks||[]).some(a=>a.name==='狂暴大地'));
const TRAIN  = byName('小楓與小南的修行');

chk('PENDING_STADIUMS 已清空（三張傳說競技場開放）', PENDING.size===0, String(PENDING.size));

function mk(me={}, opp={}, extra={}) {
  return { phase:'playing', turnPhase:'main', turn:5, activePlayerIndex:0, firstPlayerIdx:0,
    isFirstTurn:false, setupDone:[true,true], log:[], pendingSelection:null,
    activeStadium:undefined, activeStadiumPartner:undefined, activeStadiumOwnerIdx:undefined,
    stadiumPlayedThisTurn:[false,false], stadiumUsedThisTurn:[false,false],
    players:[{name:'P1',active:inst(KYOGRE.id),bench:[],hand:[],deck:[],discard:[],prizes:[],...me},
             {name:'P2',active:inst(GROUDON.id),bench:[],hand:[],deck:[],discard:[],prizes:[],...opp}],
    ...extra };
}
const totalCards=(s)=>s.players.reduce((a,p)=>a+p.hand.length+p.deck.length+p.discard.length+p.prizes.length
  +(p.active?1:0)+p.bench.length,0) + (s.activeStadium?1:0) + (s.activeStadiumPartner?1:0);

// ══ 1. 雙持 gate（兩端一致）══
{
  const one=inst(TRENCH.id);
  const st1=mk({ hand:[one] });
  chk('手牌只有 1 張 → 不在可打出清單', !getPlayableTrainers(st1,pool).includes(one.iid),
      JSON.stringify(getPlayableTrainers(st1,pool)));
  const r1=applyAction(st1,{type:'PLAY_TRAINER',iid:one.iid,actorIdx:0},pool);
  chk('手牌只有 1 張 → 引擎擋下並說明原因',
      !r1.activeStadium && r1.log.map(logText).some(t=>t.includes('兩張實體卡')),
      r1.log.map(logText).slice(-1)[0]);
  chk('手牌只有 1 張 → 卡片沒消失', r1.players[0].hand.length===1);

  const a=inst(TRENCH.id), b=inst(TRENCH.id);
  const st2=mk({ hand:[a,b] });
  chk('手牌有 2 張 → 在可打出清單', getPlayableTrainers(st2,pool).includes(a.iid));
  const before=totalCards(st2);
  const r2=applyAction(st2,{type:'PLAY_TRAINER',iid:a.iid,actorIdx:0},pool);
  chk('打出後 activeStadium 設定', r2.activeStadium?.cardId===String(TRENCH.id));
  chk('打出後 activeStadiumPartner 設定', r2.activeStadiumPartner?.cardId===String(TRENCH.id),
      JSON.stringify(r2.activeStadiumPartner));
  chk('兩張都離開手牌', r2.players[0].hand.length===0, String(r2.players[0].hand.length));
  chk('⭐ 卡片守恆（總數不變）', totalCards(r2)===before, `${totalCards(r2)} vs ${before}`);
  chk('ownerIdx 標記', r2.activeStadiumOwnerIdx===0);

  // 2. 被覆蓋 → 兩張一起進棄牌
  const st3={...r2, stadiumPlayedThisTurn:[false,false],
    players:[{...r2.players[0], hand:[inst(NORMAL.id)]}, r2.players[1]]};
  const b4=totalCards(st3);
  const r3=applyAction(st3,{type:'PLAY_TRAINER',iid:st3.players[0].hand[0].iid,actorIdx:0},pool);
  chk('被覆蓋 → 兩張都進棄牌（+2）', r3.players[0].discard.filter(c=>c.cardId===String(TRENCH.id)).length===2,
      String(r3.players[0].discard.length));
  chk('被覆蓋 → partner 清空', r3.activeStadiumPartner===undefined);
  chk('⭐ 卡片守恆（覆蓋後）', totalCards(r3)===b4, `${totalCards(r3)} vs ${b4}`);
}

// ══ 3. 中央 discardActiveStadium（象牙豬摧毀型走這條）══
{
  const a=inst(TRENCH.id), b=inst(TRENCH.id);
  const st=mk({}, {}, { activeStadium:a, activeStadiumPartner:b, activeStadiumOwnerIdx:0 });
  const before=totalCards(st);
  const r=M.discardActiveStadium(st,0);
  chk('中央離場：兩張都進棄牌', r.players[0].discard.length===2, String(r.players[0].discard.length));
  chk('中央離場：partner 清空', r.activeStadiumPartner===undefined);
  chk('⭐ 卡片守恆（中央離場）', totalCards(r)===before, `${totalCards(r)} vs ${before}`);
  // 否定對照：普通競技場（無 partner）行為不變
  const st2=mk({}, {}, { activeStadium:inst(NORMAL.id), activeStadiumOwnerIdx:0 });
  const r2=M.discardActiveStadium(st2,0);
  chk('否定對照：普通競技場離場只丟 1 張', r2.players[0].discard.length===1);
}

// ══ 4. 否定對照：普通競技場單張仍可正常打出 ══
{
  const one=inst(NORMAL.id);
  const st=mk({ hand:[one] });
  chk('否定對照：普通競技場 1 張就可打出（清單）', getPlayableTrainers(st,pool).includes(one.iid));
  const r=applyAction(st,{type:'PLAY_TRAINER',iid:one.iid,actorIdx:0},pool);
  chk('否定對照：普通競技場正常上場', r.activeStadium?.cardId===String(NORMAL.id));
  chk('否定對照：普通競技場沒有 partner', r.activeStadiumPartner===undefined);
}

// ══ 5. 連動三卡 ══
{
  // 狂暴大地：有/無傳說競技場 = 270 / 100
  const pre=ATTACK_PRE.get('固拉多|狂暴大地');
  chk('狂暴大地 有 regPre', typeof pre==='function');
  if (typeof pre==='function') {
    const noSt=mk();
    chk('狂暴大地：無傳說競技場 → 100', pre(noSt,0,pool,{}).damage===100, String(pre(noSt,0,pool,{}).damage));
    const withSt=mk({},{},{ activeStadium:inst(PEAK.id), activeStadiumPartner:inst(PEAK.id), activeStadiumOwnerIdx:0 });
    chk('狂暴大地：有傳說競技場 → 270', pre(withSt,0,pool,{}).damage===270, String(pre(withSt,0,pool,{}).damage));
    // ⭐ 對手打出的傳說競技場也算（卡面是「場上」不分擁有者）
    const oppSt={...withSt, activeStadiumOwnerIdx:1};
    chk('狂暴大地：對手的傳說競技場也算', pre(oppSt,0,pool,{}).damage===270);
    // 否定對照：普通競技場不算
    const normalSt=mk({},{},{ activeStadium:inst(NORMAL.id), activeStadiumOwnerIdx:0 });
    chk('否定對照：普通競技場 → 100', pre(normalSt,0,pool,{}).damage===100);
  }
  // 狂暴漩渦：對手備戰各 50（僅在有傳說競技場時）
  const post=ATTACK_POST.get('蓋歐卡|狂暴漩渦');
  if (typeof post==='function') {
    const mkB=(extra)=>mk({}, { bench:[inst(GROUDON.id), inst(GROUDON.id)] }, extra);
    const noSt=mkB({});
    const r0=post(noSt,0,pool);
    chk('狂暴漩渦：無傳說競技場 → 備戰 0 傷害',
        r0.players[1].bench.every(b=>(b.damage??0)===0), JSON.stringify(r0.players[1].bench.map(b=>b.damage)));
    const withSt=mkB({ activeStadium:inst(TRENCH.id), activeStadiumPartner:inst(TRENCH.id), activeStadiumOwnerIdx:0 });
    const r1=post(withSt,0,pool);
    chk('狂暴漩渦：有傳說競技場 → 對手備戰各 50',
        r1.players[1].bench.every(b=>(b.damage??0)===50), JSON.stringify(r1.players[1].bench.map(b=>b.damage)));
    chk('狂暴漩渦：不打自己的備戰', (r1.players[0].bench??[]).length===0);
  } else chk('狂暴漩渦 有 regPost', false);
  // 小楓與小南的修行
  const fn=TRAINER_EFFECTS.get('小楓與小南的修行');
  chk('小楓與小南的修行 有註冊', typeof fn==='function');
  if (typeof fn==='function') {
    const self=inst(TRAIN.id);
    const deck=[inst(EID.Water),inst(EID.Water),inst(EID.Water)];
    // 引擎流程：卡已進棄牌區才跑效果
    const withSt=mk({ deck, discard:[self] }, {},
      { activeStadium:inst(TRENCH.id), activeStadiumPartner:inst(TRENCH.id), activeStadiumOwnerIdx:0 });
    const r=fn(withSt,0,pool,self);
    chk('小楓與小南：抽 2 張', r.players[0].hand.filter(c=>c.cardId!==String(TRAIN.id)).length===2,
        String(r.players[0].hand.length));
    chk('小楓與小南：有傳說競技場 → 自己回手牌', r.players[0].hand.some(c=>c.iid===self.iid));
    chk('小楓與小南：自己不在棄牌區', !r.players[0].discard.some(c=>c.iid===self.iid));
    // 否定對照：沒有傳說競技場 → 留在棄牌區
    const noSt=mk({ deck:[inst(EID.Water),inst(EID.Water),inst(EID.Water)], discard:[self] });
    const r2=fn(noSt,0,pool,self);
    chk('否定對照：無傳說競技場 → 自己留在棄牌區', r2.players[0].discard.some(c=>c.iid===self.iid));
    chk('否定對照：無傳說競技場 → 不在手牌', !r2.players[0].hand.some(c=>c.iid===self.iid));
  }
}

console.log(`test-legend-stadium-two-card: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
