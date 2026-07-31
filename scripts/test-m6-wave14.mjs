// v6.081 守衛（M6 批次13-B）：拍檔提升 / 鱗片律動 / 霸者咆哮 / 德爾塔之禮
//   ⭐ 否定對照：目標不在卡面指名範圍不可附、火/雷各最多1張、非基本能量不可選、
//      沒有附帽子的寶可夢時不附加。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.w14-s.js'),E=join(ROOT,'.w14-e.ts'),O=join(ROOT,'.w14-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\n"
              +"export { getAbilityFn, ATTACK_POST, RESOLVERS } from './src/lib/game/effects/_shared';\n"
              +"export { ON_PLAY_FROM_HAND_ABILITIES } from './src/lib/game/effects';\n"
              +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M = await import(pathToFileURL(O).href);
const getAbilityFn = M.getAbilityFn ?? (() => undefined);
const ATTACK_POST = M.ATTACK_POST ?? new Map();
const RESOLVERS = M.RESOLVERS ?? new Map();
const ON_PLAY = M.ON_PLAY_FROM_HAND_ABILITIES ?? new Set();

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
const EID={}; for(const [id,c] of pool){ if(c.supertype!=='Energy')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !EID[k]) EID[k]=id; }
const SPECIAL=[...pool.values()].find(c=>c.supertype==='Energy'&&c.subtype!=='Basic');
const byName=(n,p2)=>[...pool.values()].find(c=>c.name===n && (!p2||p2(c)));
let n=0; const inst=(cid,e={})=>({iid:`z${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };
const logText=(l)=>String(l?.message ?? l?.text ?? l);
const mk=(me,opp={}) => ({ phase:'playing', turnPhase:'main', turn:5, activePlayerIndex:0, firstPlayerIdx:0,
  isFirstTurn:false, setupDone:[true,true], log:[], pendingSelection:null, activeStadium:null,
  players:[{name:'P1',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...me},
           {name:'P2',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...opp}] });

const ELEKIBLE = byName('電擊魔獸', c=>(c.abilities||[]).length>=0 && c.id==19573) ?? byName('電擊魔獸');
const MAGMAR   = byName('鴨嘴炎獸', c=>(c.abilities||[]).some(a=>a.name==='拍檔提升'));
const TYRANT   = byName('杖尾鱗甲龍', c=>(c.abilities||[]).some(a=>a.name==='鱗片律動'));
const RAYQ     = byName('超級烈空坐ex', c=>(c.abilities||[]).some(a=>a.name==='霸者咆哮'));
const HAT      = byName('超級烈空坐帽子');

// ══ 1. 鴨嘴炎獸｜拍檔提升 ══
{
  const fn = getAbilityFn('鴨嘴炎獸','拍檔提升',0);
  chk('拍檔提升：有註冊', typeof fn==='function');
  if (typeof fn==='function') {
    const f1=inst(EID.Fire), f2=inst(EID.Fire), l1=inst(EID.Lightning), w=inst(EID.Water);
    const self=inst(MAGMAR.id), eleki=inst(ELEKIBLE.id), other=inst(TYRANT.id);
    const st=mk({ active:self, bench:[eleki, other], hand:[f1,f2,l1,w] });
    const r=fn(st,0,pool,self);
    const ps=r.pendingSelection;
    chk('拍檔提升：開手牌 picker', ps?.type==='hand-discard' && ps?.effectKey==='m6-partner-boost-pick', ps?.effectKey);
    const valid=new Set(ps?.params?.validIids ?? []);
    chk('拍檔提升：候選只含基本火/雷（不含水）', valid.has(f1.iid)&&valid.has(l1.iid)&&!valid.has(w.iid));
    const targets=new Set(ps?.params?.targetIids ?? []);
    chk('拍檔提升：目標只含電擊魔獸/鴨嘴炎獸（不含杖尾鱗甲龍）',
        targets.has(self.iid)&&targets.has(eleki.iid)&&!targets.has(other.iid), JSON.stringify([...targets]));
    // ⭐ 否定對照：兩張火 → 只認 1 張（卡面「各最多 1 張」）
    const rz=RESOLVERS.get('m6-partner-boost-pick');
    chk('拍檔提升：有 resolver', typeof rz==='function');
    if (typeof rz==='function') {
      const r2=rz(r,0,[f1.iid,f2.iid],ps.params,pool);
      const chainPending=r2.pendingSelection;
      chk('否定對照：兩張基本火只吃 1 張（chain 只剩 1 張要分配）',
          !!chainPending, JSON.stringify(chainPending?.effectKey));
      chk('否定對照：另一張火留在手牌', r2.players[0].hand.some(c=>c.iid===f2.iid),
          JSON.stringify(r2.players[0].hand.map(c=>c.iid)));
    }
  }
}

// ══ 2. 杖尾鱗甲龍｜鱗片律動 ══
{
  const fn = getAbilityFn('杖尾鱗甲龍','鱗片律動',0);
  chk('鱗片律動：有註冊', typeof fn==='function');
  if (typeof fn==='function') {
    const self=inst(TYRANT.id);
    const deck=[inst(EID.Fire),inst(SPECIAL.id),inst(EID.Water),inst(MAGMAR.id),inst(EID.Grass),inst(EID.Metal),inst(EID.Psychic)];
    const st=mk({ active:self, bench:[], hand:[], deck });
    const r=fn(st,0,pool,self);
    const ps=r.pendingSelection;
    chk('鱗片律動：開 deck-search TOP6', ps?.type==='deck-search' && ps?.filter==='TOP6', `${ps?.type}/${ps?.filter}`);
    chk('鱗片律動：接中央 energy-chain', ps?.effectKey==='v158-energy-chain-start', ps?.effectKey);
    chk('鱗片律動：翻開的是牌庫頂 6 張', (ps?.params?.top6Iids??[]).length===6);
    const valid=new Set(ps?.params?.validIids ?? []);
    chk('鱗片律動：可勾的只有基本能量（特殊能量不可勾）',
        valid.has(deck[0].iid)&&!valid.has(deck[1].iid)&&!valid.has(deck[3].iid), JSON.stringify([...valid]));
    chk('鱗片律動：第 7 張不在候選（只看上方 6 張）', !valid.has(deck[6].iid));
    chk('鱗片律動：目標限【龍】', JSON.stringify(ps?.params?.targetIids)===JSON.stringify([self.iid]),
        JSON.stringify(ps?.params?.targetIids));
    // ⭐ 否定對照：場上沒有【龍】
    const st2=mk({ active:inst(MAGMAR.id), bench:[], hand:[], deck });
    const r2=fn(st2,0,pool,inst(TYRANT.id));
    chk('否定對照：場上無【龍】→ 不開 picker', !r2.pendingSelection,
        r2.log.map(logText).slice(-1)[0]);
  }
}

// ══ 3. 超級烈空坐ex｜霸者咆哮 ══
{
  chk('霸者咆哮：登記在「從手牌放備戰時」觸發清單', ON_PLAY.has?.('霸者咆哮')===true);
  const fn = getAbilityFn('超級烈空坐ex','霸者咆哮',0);
  chk('霸者咆哮：有註冊', typeof fn==='function');
  if (typeof fn==='function') {
    const self=inst(RAYQ.id);
    const deck=[inst(EID.Fire),inst(MAGMAR.id),inst(EID.Water),inst(SPECIAL.id),inst(EID.Grass)];
    const st=mk({ active:null, bench:[self], hand:[], deck });
    const r=fn(st,0,pool,self);
    const ps=r.pendingSelection;
    chk('霸者咆哮：開 deck-search TOP4', ps?.type==='deck-search' && ps?.filter==='TOP4', `${ps?.type}/${ps?.filter}`);
    chk('霸者咆哮：最多 1 張', ps?.maxCount===1, String(ps?.maxCount));
    const valid=new Set(ps?.params?.validIids ?? []);
    chk('霸者咆哮：候選只含前 4 張裡的基本能量',
        valid.has(deck[0].iid)&&valid.has(deck[2].iid)&&!valid.has(deck[3].iid)&&!valid.has(deck[4].iid),
        JSON.stringify([...valid]));
    const rz=RESOLVERS.get('m6-overlord-roar');
    if (typeof rz==='function') {
      const r2=rz(r,0,[deck[0].iid],ps.params,pool);
      chk('霸者咆哮：能量附到發動的那隻', (r2.players[0].bench[0]?.energyAttached??[]).some(e=>e.iid===deck[0].iid),
          JSON.stringify(r2.players[0].bench[0]?.energyAttached));
      chk('霸者咆哮：剩餘 3 張放回牌庫下方（總數 5→4，且第 1 張是原第 5 張）',
          r2.players[0].deck.length===4 && r2.players[0].deck[0].iid===deck[4].iid,
          JSON.stringify(r2.players[0].deck.map(c=>c.iid)));
      // ⭐ 否定對照：送非基本能量的 iid → 不附加
      const r3=rz(r,0,[deck[3].iid],ps.params,pool);
      chk('否定對照：特殊能量不可附', (r3.players[0].bench[0]?.energyAttached??[]).length===0);
    } else chk('霸者咆哮：有 resolver', false);
  }
}

// ══ 4. 超級烈空坐帽子｜德爾塔之禮 ══
{
  const fn = ATTACK_POST.get('超級烈空坐帽子|德爾塔之禮');
  chk('德爾塔之禮：有註冊', typeof fn==='function');
  if (typeof fn==='function') {
    const hat1=inst(HAT.id), hat2=inst(HAT.id);
    const a=inst(MAGMAR.id,{toolAttached:hat1});
    const b=inst(TYRANT.id,{extraTools:[hat2]});   // ⚠ 多重轉接：道具在 extraTools
    const c=inst(ELEKIBLE.id);                     // 沒帽子
    const deck=[inst(EID.Fire),inst(EID.Water),inst(SPECIAL.id)];
    const st=mk({ active:a, bench:[b,c], hand:[], deck });
    const r=fn(st,0,pool);
    const ps=r.pendingSelection;
    chk('德爾塔之禮：為第 1 隻開 picker', ps?.effectKey==='m6-delta-gift-step', ps?.effectKey);
    chk('德爾塔之禮：hostIids 含 extraTools 的那隻（2 隻）',
        (ps?.params?.hostIids??[]).length===2, JSON.stringify(ps?.params?.hostIids));
    const valid=new Set(ps?.params?.validIids ?? []);
    chk('德爾塔之禮：候選只有基本能量', valid.has(deck[0].iid)&&valid.has(deck[1].iid)&&!valid.has(deck[2].iid));
    const rz=RESOLVERS.get('m6-delta-gift-step');
    if (typeof rz==='function') {
      // ⚠ 直接呼叫 resolver 時要自己清掉 pendingSelection —— 正式流程由 engine 的
      //   RESOLVE_SELECTION 清除；不清的話下一步 withPending 會被既有 pending 卡住（假 FAIL）。
      const clr=(s)=>({...s, pendingSelection:null});
      const r2=rz(clr(r),0,[deck[0].iid],ps.params,pool);
      chk('德爾塔之禮：第 1 隻拿到能量', (r2.players[0].active?.energyAttached??[]).some(e=>e.iid===deck[0].iid));
      chk('德爾塔之禮：接著為第 2 隻開 picker', r2.pendingSelection?.effectKey==='m6-delta-gift-step',
          r2.pendingSelection?.effectKey);
      const r3=rz(clr(r2),0,[deck[1].iid],r2.pendingSelection.params,pool);
      chk('德爾塔之禮：第 2 隻拿到能量', (r3.players[0].bench[0]?.energyAttached??[]).some(e=>e.iid===deck[1].iid));
      chk('德爾塔之禮：沒附帽子的那隻沒拿到', (r3.players[0].bench[1]?.energyAttached??[]).length===0);
      chk('德爾塔之禮：全部處理完 → 收掉 picker', !r3.pendingSelection);
    } else chk('德爾塔之禮：有 resolver', false);
    // ⭐ 否定對照：場上沒有附帽子的寶可夢
    const st2=mk({ active:inst(MAGMAR.id), bench:[], hand:[], deck });
    const r4=fn(st2,0,pool);
    chk('否定對照：沒人附帽子 → 不開 picker', !r4.pendingSelection,
        r4.log.map(logText).slice(-1)[0]);
  }
}

console.log(`test-m6-wave14: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
