// v6.071 守衛(M6 批次9)：化身團結×4（AND 判定）／綠寶石風暴（火雷聯集）／母親的誘引。
//   ⭐正對照：狙射樹梟ex｜狙擊手之眼（同一 ABILITY_COLORLESS_COST_ZERO registry 的既有成員）、
//     鐵掌力士｜大力捕捉器（特性版 gust 的既有正確卡）。
//   ⭐反向斷言：化身團結只湊到 3 種時**不得**生效（AND 不可退化成 OR）；
//     綠寶石風暴的多屬性能量**不得**被重複計數。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.m6w9-s.js'),E=join(ROOT,'.m6w9-e.ts'),O=join(ROOT,'.m6w9-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame, canAffordAttack } from './src/lib/game/engine';\n"
 +"export { ABILITY_EFFECTS } from './src/lib/game/effects/_shared';\n"
 +"export { ABILITY_COLORLESS_COST_ZERO } from './src/lib/game/effects';\n"
 +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const { applyAction, createGame, canAffordAttack, ABILITY_EFFECTS }=M;
// ⚠ 用 fail-safe 取值：舊版沒有這個 export 時要顯示成一條清楚的 FAIL，而不是整個 test crash
//   （crash 的輸出跟「測試檔自己寫壞」長得一樣，會誤導 HEAD-FAIL 的判讀）。
const ABILITY_COLORLESS_COST_ZERO = M.ABILITY_COLORLESS_COST_ZERO ?? new Map();
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const all=[];
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){ if(c?.id==null)continue; pool.set(String(c.id),c); all.push(c); } }
const byAb=(ab,nm)=>all.find(c=>['H','I','J'].includes(c.regulationMark)&&(!nm||c.name===nm)&&(c.abilities||[]).some(a=>a.name===ab));
const byName=(nm)=>all.find(c=>['H','I','J'].includes(c.regulationMark)&&c.name===nm);
const eByName=(nm)=>all.find(c=>c.name===nm);
let n=0; const inst=(cid,e={})=>({iid:`c${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,x='')=>{ if(c)pass++; else{fail++;console.log('  ❌',t,x??'');} };
const PLAIN=all.filter(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&!(c.abilities||[]).length&&!/ex$/.test(c.name)).sort((a,b)=>b.hp-a.hp)[0];
function mk(o={}){
  const s0=createGame({name:'P1',entries:[{cardId:String(PLAIN.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(PLAIN.id),count:1}]},pool);
  return {...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,activeStadium:o.stadium?inst(o.stadium):null,
    activeStadiumOwnerIdx:0,pendingSelection:null,log:[],
    players:[{...s0.players[0],active:o.a??inst(PLAIN.id),bench:o.ab??[],hand:o.hand??[],
              deck:o.deck??[inst(PLAIN.id)],discard:[],prizes:Array.from({length:6},()=>inst(PLAIN.id))},
             {...s0.players[1],active:o.d??inst(PLAIN.id),bench:o.db??[],hand:o.oppHand??[],
              deck:[inst(PLAIN.id)],discard:[],prizes:Array.from({length:6},()=>inst(PLAIN.id))}]};
}
const logs=(r)=>(r?.log||[]).map(x=>x.message||'');

// ── 1) 化身團結：AND 判定（四種都要在場）────────────────────────────────────
{
  chk('化身團結 已登錄中央 ABILITY_COLORLESS_COST_ZERO', ABILITY_COLORLESS_COST_ZERO.has('化身團結'));
  chk('既有 狙擊手之眼 仍在同一 registry(正對照)', ABILITY_COLORLESS_COST_ZERO.has('狙擊手之眼'));
  const four=['龍捲雲','雷電雲','土地雲','眷戀雲'].map(nm=>byAb('化身團結',nm));
  chk('四張化身團結卡都找得到', four.every(Boolean), four.map((c,i)=>c?'o':'x').join(''));
  if(four.every(Boolean)){
    const holder=four[0];   // 龍捲雲（M6）：螺旋俯衝 cost = 3【無】
    const ai=holder.attacks.findIndex(a=>(a.cost||[]).every(t=>t==='Colorless')&&(a.cost||[]).length>0);
    chk('harness 前置：龍捲雲有全【無】cost 的招式', ai>=0);
    if(ai>=0){
      const A=inst(holder.id);   // 身上 0 能量
      const stAll =mk({a:A, ab: four.slice(1).map(c=>inst(c.id))});          // 四種到齊
      const stThree=mk({a:A, ab: four.slice(1,3).map(c=>inst(c.id))});       // 只有 3 種
      const stOne  =mk({a:A, ab: []});                                       // 只有自己 1 種
      chk('化身團結：四種到齊 → 0 能量也付得起全【無】招式',
          canAffordAttack(stAll.players[0].active, holder.attacks[ai].cost, pool, stAll, 0, '螺旋俯衝')===true);
      // ⚠ 反向斷言：AND 不可退化成 OR
      chk('化身團結：只有 3 種在場 → **不得**生效（AND 不可退化成 OR）',
          canAffordAttack(stThree.players[0].active, holder.attacks[ai].cost, pool, stThree, 0, '螺旋俯衝')===false);
      chk('化身團結：只有自己 1 種在場 → 不得生效',
          canAffordAttack(stOne.players[0].active, holder.attacks[ai].cost, pool, stOne, 0, '螺旋俯衝')===false);
      // ⚠ 龍捲雲是【無】屬性 → 火箭隊的監視塔在場時特性被消除
      const tower=all.find(c=>c.name==='火箭隊的監視塔');
      if(tower){
        const stTower=mk({a:A, ab: four.slice(1).map(c=>inst(c.id)), stadium: tower.id});
        chk('化身團結：火箭隊的監視塔在場 → 【無】屬性的龍捲雲特性被消除，不得生效',
            canAffordAttack(stTower.players[0].active, holder.attacks[ai].cost, pool, stTower, 0, '螺旋俯衝')===false);
      }
    }
  }
  // 正對照：狙擊手之眼 對手手牌恰為 4 張才生效（=== 4，不是 >= 4）
  const deci=byAb('狙擊手之眼');
  if(deci){
    const ai=deci.attacks.findIndex(a=>(a.cost||[]).includes('Colorless'));
    if(ai>=0){
      const need=(deci.attacks[ai].cost||[]).filter(t=>t!=='Colorless');
      const A=inst(deci.id); A.energyAttached=need.map(t=>inst(eByName(`基本【草】能量`).id));
      const h4=Array.from({length:4},()=>inst(PLAIN.id));
      const h5=Array.from({length:5},()=>inst(PLAIN.id));
      const st4=mk({a:A,oppHand:h4}), st5=mk({a:A,oppHand:h5});
      chk('狙擊手之眼：對手手牌恰 4 張 → 【無】消除(既有正對照)',
          canAffordAttack(st4.players[0].active, deci.attacks[ai].cost, pool, st4, 0, deci.attacks[ai].name)===true);
      chk('狙擊手之眼：對手手牌 5 張 → 不消除（恰為 4 是 === 不是 >=）',
          canAffordAttack(st5.players[0].active, deci.attacks[ai].cost, pool, st5, 0, deci.attacks[ai].name)===false);
    }
  }
}

// ── 2) 綠寶石風暴：【火】與【雷】能量「聯集」計數 ───────────────────────────
{
  const c=byName('超級烈空坐ex');
  const fire=eByName('基本【火】能量'), ltng=eByName('基本【雷】能量'), water=eByName('基本【水】能量');
  const ancient=all.find(x=>x.name==='古舊能量');
  if(!c||!fire||!ltng) chk('綠寶石風暴 harness 前置',false);
  else{
    const ai=c.attacks.findIndex(a=>a.name==='綠寶石風暴');
    const mkA=(en)=>{ const A=inst(c.id); A.energyAttached=[...(c.attacks[ai].cost||[]).map(t=>inst({Fire:fire.id,Lightning:ltng.id}[t]??water.id)), ...en.map(id=>inst(id))]; return A; };
    const run=(en,bench=[])=>applyAction(mk({a:mkA(en),ab:bench}),{type:'ATTACK',attackIndex:ai},pool);
    // cost 本身就是 火1 雷1 無1(填水) → 基礎聯集 = 2
    const r0=run([]);
    chk('綠寶石風暴：只有招式費用(火1雷1水1) → 聯集 2 個', logs(r0).some(m=>/能量 2 個 × 50/.test(m)), logs(r0).filter(m=>/綠寶石風暴/.test(m))[0]);
    const r1=run([fire.id,ltng.id]);
    chk('綠寶石風暴：再加 火1雷1 → 4 個', logs(r1).some(m=>/能量 4 個 × 50/.test(m)), logs(r1).filter(m=>/綠寶石風暴/.test(m))[0]);
    const r2=run([water.id]);
    chk('綠寶石風暴：加一張【水】不計入 → 仍 2 個', logs(r2).some(m=>/能量 2 個 × 50/.test(m)), logs(r2).filter(m=>/綠寶石風暴/.test(m))[0]);
    if(ancient){
      const r3=run([ancient.id]);
      // ⭐Wilson 裁定：同一張能量只算一次 → 古舊能量算 1（不是火1+雷1=2）
      chk('綠寶石風暴：古舊能量(全屬性)只算 1 個（聯集，非火+雷相加）',
          logs(r3).some(m=>/能量 3 個 × 50/.test(m)), logs(r3).filter(m=>/綠寶石風暴/.test(m))[0]);
    }
    // 備戰上的火/雷也要算（卡面「自己的**所有**寶可夢」）
    const b=inst(PLAIN.id); b.energyAttached=[inst(fire.id)];
    const r4=applyAction(mk({a:mkA([]),ab:[b]}),{type:'ATTACK',attackIndex:ai},pool);
    chk('綠寶石風暴：備戰身上的【火】能量也計入 → 3 個',
        logs(r4).some(m=>/能量 3 個 × 50/.test(m)), logs(r4).filter(m=>/綠寶石風暴/.test(m))[0]);
  }
}

// ── 3) 尼多后｜母親的誘引：擲幣正面 → C-05 gust ────────────────────────────
{
  const c=byAb('母親的誘引');
  const proto=byAb('大力捕捉器');   // 鐵掌力士（既有正確的特性版 gust）
  if(!c) chk('母親的誘引 找得到持有卡',false);
  else{
    const fn=ABILITY_EFFECTS.get(`${c.name}|0`);
    chk('母親的誘引 有註冊 handler', !!fn);
    if(fn){
      const src=inst(c.id);
      const st=mk({a:src,db:[inst(PLAIN.id),inst(PLAIN.id)]});
      const orig=Math.random;
      Math.random=()=>0.1;  // 正面
      const rH=fn(st,0,pool,src);
      Math.random=()=>0.9;  // 反面
      const rT=fn(st,0,pool,src);
      Math.random=orig;
      chk('母親的誘引：正面 → 開 opp-bench-choose', rH?.pendingSelection?.type==='opp-bench-choose', rH?.pendingSelection?.type);
      chk('母親的誘引：正面 → 復用中央 gust-opp resolver', rH?.pendingSelection?.effectKey==='gust-opp');
      chk('母親的誘引：反面 → 不開 picker、明確寫進 log',
          !rT?.pendingSelection && logs(rT).some(m=>/反面/.test(m)), logs(rT).slice(-1)[0]);
      // 對手無備戰 → 不開 picker
      const rNo=fn(mk({a:src,db:[]}),0,pool,src);
      chk('母親的誘引：對手無備戰 → 不開 picker', !rNo?.pendingSelection);
    }
  }
  if(proto){
    const fn2=ABILITY_EFFECTS.get(`${proto.name}|0`);
    if(fn2){
      const src2=inst(proto.id);
      const r=fn2(mk({a:src2,db:[inst(PLAIN.id)]}),0,pool,src2);
      chk('鐵掌力士｜大力捕捉器 仍正常開 gust picker(既有正對照)',
          r?.pendingSelection?.type==='opp-bench-choose' && r?.pendingSelection?.effectKey==='gust-opp');
    }
  }
}
console.log(`m6-wave9:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
