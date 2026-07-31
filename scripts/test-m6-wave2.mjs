// v6.061 守衛(M6 批次2)：12 招條件加傷/狙擊/擲幣型，用完整 ATTACK 流程驗證。
//   ⭐每型都配「既有同措辭卡」正對照 —— 批次1 的教訓：沒有正對照，harness 自己壞掉時會全綠。
//   ⚠ 基本能量 id 一律依名稱查（硬編 id 會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.m6w2-s.js'),E=join(ROOT,'.m6w2-e.ts'),O=join(ROOT,'.m6w2-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, createGame } = await import(pathToFileURL(O).href);
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
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c)pass++; else{fail++;console.log('  ❌',t,extra);} };

function run(atkName, atk, def, opt={}){
  const ai=(atk.attacks||[]).findIndex(a=>a.name===atkName);
  const A=inst(atk.id,opt.atkPatch||{}); A.energyAttached=((atk.attacks[ai].cost)||[]).map(t=>inst(EID[t]??FILL));
  const D=inst(def.id, opt.defPatch||{});
  const s0=createGame({name:'P1',entries:[{cardId:String(atk.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(def.id),count:1}]},pool);
  const bench=(opt.oppBench??1); const oppBench=Array.from({length:bench},()=>inst(def.id));
  const st={...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    coinFlippedThisAttack:false,_attackerActiveBonusDone:false,activeStadium:null,pendingSelection:null,log:[],
    players:[{...s0.players[0],active:A,bench:[],hand:[],deck:[inst(def.id)],discard:[],
              prizes:Array.from({length:6},()=>inst(def.id))},
             {...s0.players[1],active:D,bench:oppBench,hand:Array.from({length:opt.oppHand??0},()=>inst(def.id)),
              deck:[inst(def.id)],discard:[],
              prizes:Array.from({length:opt.oppPrizes??6},()=>inst(def.id))}]};
  const orig=Math.random; Math.random=()=> (opt.heads===false?0.9:0.1);
  let out; try{ out=applyAction(st,{type:'ATTACK',attackIndex:ai},pool); }
  catch(e){ out={__err:e.message}; } finally{ Math.random=orig; }
  return out;
}
const dmgOf=(r)=>r?.players?.[1]?.active?.damage ?? -1;
// 受方：一隻高 HP、非 ex、非進化的普通寶可夢（避免被打死 / 誤觸條件）
const pick=(f)=>{ const a=[...pool.values()].filter(f); a.sort((x,y)=>Number(y.hp)-Number(x.hp)); return a[0]; };
const isEx=(c)=>/ex$/.test(c.name||'');
const PLAIN=pick(c=>c.supertype==='Pokemon'&&c.stage==='Basic'&&!(c.abilities||[]).length&&!isEx(c));
const EVO  =pick(c=>c.supertype==='Pokemon'&&(c.stage==='Stage1'||c.stage==='Stage2')&&!(c.abilities||[]).length&&!isEx(c));
const EXP  =pick(c=>c.supertype==='Pokemon'&&isEx(c)&&c.stage==='Basic');
for(const [n,c] of [['PLAIN',PLAIN],['EVO',EVO],['EXP',EXP]]) if(!c) throw new Error('harness 找不到 '+n+' 測試用寶可夢');
console.log(`harness 受方：PLAIN=${PLAIN.name}(${PLAIN.hp}) EVO=${EVO.name}(${EVO.hp}) EX=${EXP.name}(${EXP.hp})`);

// A 對手為進化 → 加傷（M6 + 既有正對照）
for(const [cn,an,base,bonus] of [['蜂女王','俐落一擊',80,80],['肯泰羅','俐落一擊',null,null]]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const rEvo=run(an,c,EVO), rPlain=run(an,c,PLAIN);
  chk(`${cn}｜${an} 對進化 > 對非進化`, dmgOf(rEvo)>dmgOf(rPlain), `evo=${dmgOf(rEvo)} plain=${dmgOf(rPlain)}`);
  if(base) chk(`蜂女王｜俐落一擊 非進化=${base} / 進化=${base+bonus}`,
               dmgOf(rPlain)===base && dmgOf(rEvo)===base+bonus, `${dmgOf(rPlain)}/${dmgOf(rEvo)}`);
}
// B 對手有指示物 → 加傷
{ const c=find('超級具甲武者ex','致命刺擊');
  // ⚠ 加傷後 220 > PLAIN 的 HP 會直接 KO(active=null → 讀不到 damage)，高傷案例一律用高 HP 受方
  const r0=run('致命刺擊',c,EVO), r1=run('致命刺擊',c,EVO,{defPatch:{damage:10}});
  chk('超級具甲武者ex｜致命刺擊 無指示物=60',dmgOf(r0)===60,dmgOf(r0));
  chk('超級具甲武者ex｜致命刺擊 有指示物=10+220',dmgOf(r1)===10+220,dmgOf(r1)); }
// C 對手剩餘獎賞 ≤4 → 加傷（M6 門檻 4；既有蒼響門檻 3 當對照）
{ const c=find('風速狗','活力獠牙');
  const r5=run('活力獠牙',c,EVO,{oppPrizes:5}), r4=run('活力獠牙',c,EVO,{oppPrizes:4});
  chk('風速狗｜活力獠牙 對手獎賞5張=90',dmgOf(r5)===90,dmgOf(r5));
  chk('風速狗｜活力獠牙 對手獎賞4張=180(門檻是4非3)',dmgOf(r4)===180,dmgOf(r4)); }
// D 對手為 ex → 加傷
{ const c=find('眷戀雲','上升之心');
  const rEx=run('上升之心',c,EXP), rNo=run('上升之心',c,PLAIN);
  chk('眷戀雲｜上升之心 非ex=100',dmgOf(rNo)===100,dmgOf(rNo));
  chk('眷戀雲｜上升之心 對ex=200',dmgOf(rEx)===200,dmgOf(rEx)); }
// E 擲幣正面加傷（正反兩面對照）
{ const c=find('刺球仙人掌','擊飛');
  chk('刺球仙人掌｜擊飛 正面=20',dmgOf(run('擊飛',c,PLAIN,{heads:true}))===20);
  chk('刺球仙人掌｜擊飛 反面=10',dmgOf(run('擊飛',c,PLAIN,{heads:false}))===10); }
// F 對手手牌數×20
{ const c=find('引夢貘人','意志統治者');
  chk('引夢貘人｜意志統治者 手牌3張=60',dmgOf(run('意志統治者',c,PLAIN,{oppHand:3}))===60);
  chk('引夢貘人｜意志統治者 手牌0張=0',dmgOf(run('意志統治者',c,PLAIN,{oppHand:0}))===0); }
// G 對手備戰數×70（0 備戰 → 0）
{ const c=find('超級烏賊王ex','精神傀儡');
  chk('超級烏賊王ex｜精神傀儡 備戰2=140',dmgOf(run('精神傀儡',c,PLAIN,{oppBench:2}))===140);
  chk('超級烏賊王ex｜精神傀儡 備戰0=0',dmgOf(run('精神傀儡',c,PLAIN,{oppBench:0}))===0); }
// H 狙擊「1隻寶可夢」→ 開 picker（含戰鬥位）；既有皮卡丘正對照
for(const [cn,an] of [['夢歌仙人掌','直擊彈'],['皮卡丘','電磁電光']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,PLAIN,{oppBench:2});
  const p=r?.pendingSelection;
  chk(`${cn}｜${an} 開 opp-poke-choose picker${cn==='皮卡丘'?'(既有正對照)':''}`,
      p?.type==='opp-poke-choose', JSON.stringify(p?.type)); }
// I 「1隻備戰寶可夢也受到30」→ 開 opp-bench-choose；既有凱路迪歐正對照
for(const [cn,an] of [['摩托蜥','突圍'],['凱路迪歐','穿通']]){
  const c=find(cn,an); if(!c){chk(`${cn}|${an} 存在`,false);continue;}
  const r=run(an,c,PLAIN,{oppBench:2});
  chk(`${cn}｜${an} 開 opp-bench-choose picker${cn==='凱路迪歐'?'(既有正對照)':''}`,
      r?.pendingSelection?.type==='opp-bench-choose', JSON.stringify(r?.pendingSelection?.type));
  if(cn==='摩托蜥') chk('摩托蜥｜突圍 戰鬥位仍吃印刷 110', dmgOf(r)===110, dmgOf(r)); }
// J 擲2幣×70（全正面=140）
{ const c=find('鱗甲龍','雙重粉碎');
  chk('鱗甲龍｜雙重粉碎 兩正面=140',dmgOf(run('雙重粉碎',c,PLAIN,{heads:true}))===140);
  chk('鱗甲龍｜雙重粉碎 兩反面=0',dmgOf(run('雙重粉碎',c,PLAIN,{heads:false}))===0); }
// K 擲幣反面則失敗
{ const c=find('小箭雀','偷襲');
  chk('小箭雀｜偷襲 正面=30',dmgOf(run('偷襲',c,PLAIN,{heads:true}))===30);
  chk('小箭雀｜偷襲 反面=0',dmgOf(run('偷襲',c,PLAIN,{heads:false}))===0); }
// L 本回合從「電海燕」進化 +90；⭐並驗證「卡面 evolvesFrom 恆真」的舊 bug 不再發生
{ const c=find('大電海燕','襲擊'); const src=find('電海燕','高速移動')||byName.get('電海燕')?.[0];
  const noEvo=run('襲擊',c,PLAIN);
  chk('大電海燕｜襲擊 未進化=30',dmgOf(noEvo)===30,dmgOf(noEvo));
  if(src){ const r=run('襲擊',c,PLAIN,{atkPatch:{evolvedThisTurn:true,evolvedFromStack:[inst(src.id)]}});
    chk('大電海燕｜襲擊 本回合從電海燕進化=120',dmgOf(r)===120,dmgOf(r)); }
  // 糖果跳級對照：evolvedThisTurn 但來源不是電海燕 → 不得加傷
  const r2=run('襲擊',c,PLAIN,{atkPatch:{evolvedThisTurn:true,evolvedFromStack:[inst(PLAIN.id)]}});
  chk('大電海燕｜襲擊 進化來源非電海燕→不加傷=30',dmgOf(r2)===30,dmgOf(r2)); }
// ⭐衝天電光 bug 回歸：糖果從小磁怪跳級 → 不得 +120
//   ⚠ 這裡斷言 **log 的「N(基礎)」** 而非最終 damage：自爆磁怪是【雷】，高 HP 受方多半弱雷 →
//     ×2 後直接 KO(active=null，damage 讀成 -1)。基礎傷害寫在引擎結算 log，不受弱點/KO 影響。
//   ⚠ log 元素的欄位是 `message`（不是 text）—— 讀錯欄位會得到空字串、全 FAIL 的假象。
{ const c=find('自爆磁怪','衝天電光'); const magneton=byName.get('三合一磁怪')?.[0]; const magnemite=byName.get('小磁怪')?.[0];
  const baseOf=(r)=>{ for(const l of (r?.log||[])){ const m=/【(\d+)\(基礎\)/.exec(l?.message??''); if(m) return Number(m[1]); } return null; };
  if(c&&magneton&&magnemite){
    const rOk=run('衝天電光',c,EVO,{atkPatch:{evolvedThisTurn:true,evolvedFromStack:[inst(magneton.id)]}});
    const rCandy=run('衝天電光',c,EVO,{atkPatch:{evolvedThisTurn:true,evolvedFromStack:[inst(magnemite.id)]}});
    chk('自爆磁怪｜衝天電光 從三合一磁怪進化 → 基礎 170', baseOf(rOk)===170, baseOf(rOk));
    chk('⭐自爆磁怪｜衝天電光 神奇糖果從小磁怪跳級 → 基礎 50(不加傷)', baseOf(rCandy)===50, baseOf(rCandy));
  } else chk('衝天電光 bug 回歸案所需卡齊全',false); }
console.log(`m6-wave2:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
