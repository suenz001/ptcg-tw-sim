// ⭐ v6.196 —【傳說的熔岩洞】「雙方場上所有進化寶可夢的特性全部消除。」
//   玩家回報：熔岩洞沒有消除【護城龍｜太古防壁】（護城龍 stage=Stage2 = 進化寶可夢 ⇒ 應消除）。
//
// 真因（v6.145 的翻版：「中央述詞寫好 ≠ 消費點有接」）：
//   isAbilityHolderEffective 判得完全正確（回 false），但這一整族 **passive 特性的消費點**
//   一律只手刻 `card.abilities?.some(a => a.name === 'X')`，從來沒問過中央述詞：
//     ・defense.ts  taikoBariBlocksAttackDamage — 太古防壁(護城龍 Stage2)
//     ・defense.ts  canApplyEffectToTarget 1.    — 光之翼(超級皮可西ex Stage1+ex 規則)
//     ・engine.ts ×3 / effects.ts ×2             — 光之翼(攻擊方免疫對手特性反擊)
//     ・v3000_g3_wave2.ts local hasAbilityOnSide/hasAbilityOnActive
//         → 球形盾牌(蟲甲聖 Stage1)／潛者捕捉(獵斑魚 Stage1)／奇跡之吻(波克基斯 Stage2)／
//           熔岩波動(鴨嘴炎獸 Stage1)
//     ・v3001_g3_wave3.ts local hasAbilityOnSide + hasAbilityOnActive(只接了暗夜羽擊一個來源)
//         → 爆大身軀(大王銅象 Stage1)／瞪眼效用(火箭隊的阿柏怪 Stage1)／海之詛咒(胖嘟嘟ex)／
//           熔岩地域(熔岩蝸牛 Stage1)／漩渦言靈(夢妖魔ex)／凹洞(火箭隊的三地鼠 Stage1)／
//           黑暗脈衝(火箭隊的電龍 Stage2)
//
// 收斂：全部改走中央 hasEffectiveAbilityByInst / hasAbilityOnSide(帶 gate) /
//       hasAbilityOnActive(改接 isAbilityHolderEffective)。
// ⚠ 回歸保護：無熔岩洞時行為必須與舊版完全相同；且 v6.145 的化石豁免不得回捲。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x6196-s.js'),E=join(ROOT,'.x6196-e.ts'),O=join(ROOT,'.x6196-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n"
+ "export { taikoBariBlocksAttackDamage, canApplyEffectToTarget, hasEffectiveAbilityByInst } from './src/lib/game/defense';\n"
+ "export { hasBugAegislashShield } from './src/lib/game/effects/cards/v3000_g3_wave2';\n"
+ "export { isOppStadiumPlayBlocked, isOppItemPlayBlocked, hasRocketAmpharosDarkPulse,\n"
+ "         isAbilityHolderEffective, hasAbilityOnSide, countEffectiveAbilityOnSide,\n"
+ "         hasRocketTyranitarSandstorm, getOppRetreatTriggers } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
+ "export { magmarFlowingBurnBonus, canTogekissMiracleKissTrigger } from './src/lib/game/effects/cards/v3000_g3_wave2';\n"
+ "export { applyMiracleKissOnOppActiveKO } from './src/lib/game/effects';\n"
+ "import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const findId=(name,pred)=>{for(const [id,c] of pool) if(c.name===name && (!pred||pred(c))) return id; return null;};
const ab=n=>c=>c.abilities?.some(a=>a.name===n);

let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// ── 卡面事實錨（掃描器下限斷言：卡池變動導致抓不到卡時要紅，而不是靜默全綠）──
const CAVE='19623';           // 傳說的熔岩洞 075/076
const CAVE2='19626';          // 傳說的熔岩洞 076/076（兩張合一的另一半，rulesText 相同）
const MOAT=findId('護城龍', ab('太古防壁'));
const BUG=findId('蟲甲聖', ab('球形盾牌'));
const PIXY=findId('超級皮可西ex', ab('光之翼'));
const DONPHAN=findId('大王銅象', ab('爆大身軀'));
const AMPHAROS=findId('火箭隊的電龍', ab('黑暗脈衝'));
const EMOLGA='10456', MUNNA='14086', LAPRAS='14085', WATER='11175';

T('0. 卡面錨：熔岩洞兩張 rulesText 皆為「雙方場上所有進化寶可夢的特性全部消除。」',()=>{
  for (const id of [CAVE,CAVE2]) {
    const c=pool.get(id); assert.ok(c,'找不到熔岩洞 '+id);
    assert.equal(c.name,'傳說的熔岩洞');
    assert.equal(c.rulesText,'雙方場上所有進化寶可夢的特性全部消除。','rulesText 變了：'+c.rulesText);
  }
});
T('0b. 卡面錨：護城龍 stage=Stage2（=進化寶可夢）且特性為 太古防壁',()=>{
  assert.ok(MOAT,'找不到護城龍');
  const c=pool.get(MOAT);
  assert.equal(c.stage,'Stage2');
  assert.equal(c.evolvesFrom,'盾甲龍');
  assert.ok(c.abilities.some(a=>a.name==='太古防壁'
    && a.effect==='只要這隻寶可夢在備戰區，自己的所有寶可夢不會受到對手身上附加的能量為2個以下的寶可夢招式的傷害。'),
    '太古防壁 effect 逐字不符：'+JSON.stringify(c.abilities));
});
T('0c. 掃描器下限：本測試依賴的 5 張卡都要抓得到（抓不到＝安慰劑綠燈）',()=>{
  const missing=Object.entries({MOAT,BUG,PIXY,DONPHAN,AMPHAROS}).filter(([,v])=>!v).map(([k])=>k);
  assert.equal(missing.length,0,'抓不到：'+missing.join(','));
});

let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],toolsAttached:[],...e});
const mkState=(caveId,p0,p1)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,
  isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  activeStadium: caveId?{cardId:caveId,ownerIdx:0}:null,
  players:[p0,p1]});

// ══ 1. 太古防壁（玩家回報本體）— 完整 ATTACK 流程 ══
function runSkyWave(caveId){
  const target=inst(MUNNA);
  const st=mkState(caveId,
    {name:'A',active:inst(EMOLGA,{energyAttached:[inst(WATER)]}),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[inst(MOAT),target],hand:[],deck:[],discard:[],prizes:[]});
  st._targetIid=target.iid;
  const r=mod.applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  const t=r.players[1].bench.find(b=>b.iid===target.iid);
  return t?t.damage:'KO/null';
}
T('1a.〔核心 bug〕熔岩洞在場 → 護城龍(Stage2)太古防壁被消除 → 備戰仍受 10 傷害',()=>{
  const d=runSkyWave(CAVE);
  assert.equal(d,10,'熔岩洞應消除太古防壁(護城龍是進化寶可夢)，備戰應受 10，實際 '+d);
});
T('1b.〔核心 bug〕熔岩洞另一半(076/076) 同樣消除太古防壁',()=>{
  const d=runSkyWave(CAVE2);
  assert.equal(d,10,'兩張合一的另一半 rulesText 相同，應同樣消除，實際 '+d);
});
T('1c.〔回歸〕沒有熔岩洞 → 太古防壁照常擋住備戰傷害(damage=0)',()=>{
  const d=runSkyWave(null);
  assert.equal(d,0,'無熔岩洞時太古防壁應照擋，實際 '+d);
});
T('1d. 中央述詞層：taikoBariBlocksAttackDamage 有/無熔岩洞 → false/true',()=>{
  const mk=cave=>{const s=mkState(cave,
    {name:'A',active:inst(EMOLGA),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[inst(MOAT)],hand:[],deck:[],discard:[],prizes:[]});
    s._attackTimeAttackerEnergyUnits=1;return s;};
  assert.equal(mod.taikoBariBlocksAttackDamage(mk(null),0,pool),true,'無熔岩洞應擋');
  assert.equal(mod.taikoBariBlocksAttackDamage(mk(CAVE),0,pool),false,'有熔岩洞應不擋');
});

// ══ 2. 球形盾牌（蟲甲聖 Stage1）— v3000 local helper 家族 ══
T('2. 球形盾牌(蟲甲聖 Stage1)：熔岩洞在場 → hasBugAegislashShield 應為 false',()=>{
  const mk=cave=>mkState(cave,
    {name:'A',active:inst(EMOLGA),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[inst(BUG)],hand:[],deck:[],discard:[],prizes:[]});
  assert.equal(mod.hasBugAegislashShield(mk(null),1,pool),true,'無熔岩洞應有球形盾牌');
  assert.equal(mod.hasBugAegislashShield(mk(CAVE),1,pool),false,'熔岩洞應消除球形盾牌');
});

// ══ 3. 光之翼（超級皮可西ex Stage1 + ex 規則寶可夢）══
T('3. 光之翼：熔岩洞在場 → canApplyEffectToTarget(ability-effect) 不再免疫',()=>{
  const mk=cave=>mkState(cave,
    {name:'A',active:inst(EMOLGA),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(PIXY),bench:[],hand:[],deck:[],discard:[],prizes:[]});
  const chk=cave=>{const s=mk(cave);
    return mod.canApplyEffectToTarget(s,0,s.players[1].active,pool.get(PIXY),'ability-effect',pool,{isBench:false}).blocked;};
  assert.equal(chk(null),true,'無熔岩洞時光之翼應免疫特性效果');
  assert.equal(chk(CAVE),false,'熔岩洞應消除光之翼(超級皮可西ex 是 Stage1 進化)');
});

// ══ 4. hasAbilityOnActive / hasAbilityOnSide 家族（v3001）══
T('4a. 爆大身軀(大王銅象 Stage1)：熔岩洞在場 → 對手可以使出競技場',()=>{
  const mk=cave=>mkState(cave,
    {name:'A',active:inst(EMOLGA),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(DONPHAN),bench:[],hand:[],deck:[],discard:[],prizes:[]});
  assert.equal(mod.isOppStadiumPlayBlocked(mk(null),0,pool),true,'無熔岩洞應擋');
  assert.equal(mod.isOppStadiumPlayBlocked(mk(CAVE),0,pool),false,'熔岩洞應消除爆大身軀');
});
T('4b. 黑暗脈衝(火箭隊的電龍 Stage2)：熔岩洞在場 → 不再放 4 個指示物',()=>{
  const mk=cave=>mkState(cave,
    {name:'A',active:inst(EMOLGA),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[inst(AMPHAROS)],hand:[],deck:[],discard:[],prizes:[]});
  assert.equal(mod.hasRocketAmpharosDarkPulse(mk(null),0,pool),true,'無熔岩洞應觸發');
  assert.equal(mod.hasRocketAmpharosDarkPulse(mk(CAVE),0,pool),false,'熔岩洞應消除黑暗脈衝');
});

// ══ 5. v6.145 回歸：化石在場上是【基礎】寶可夢 → 熔岩洞不得消除其特性 ══
T('5.〔v6.145 回歸〕熔岩洞不得消除化石(fossilOnField)的特性',()=>{
  const fossil=findId('陳舊的羽毛化石')??findId('陳舊的頭蓋化石');
  assert.ok(fossil,'找不到化石卡（掃描器下限）');
  const fCard=pool.get(fossil);
  const fInst=inst(fossil,{fossilOnField:true});
  const s=mkState(CAVE,
    {name:'A',active:inst(EMOLGA),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[fInst],hand:[],deck:[],discard:[],prizes:[]});
  const abName=(fCard.abilities?.[0]?.name)??'羽毛守護';
  assert.equal(mod.isAbilityHolderEffective(s,fInst,fCard,1,abName,'bench',pool),true,
    '化石在場上是【基礎】寶可夢，熔岩洞不該消除（v6.145）');
});

// ══ 6. 否定型守衛 + 正對照：v3000 不得再持有 local hasAbilityOnSide/hasAbilityOnActive 定義 ══
T('6. v3000_g3_wave2 不得再有 local helper 遮蔽中央版（含正對照自我驗證）',()=>{
  const strip=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/[​-‍﻿]/g,'');
  const src=strip(readFileSync(join(ROOT,'src/lib/game/effects/cards/v3000_g3_wave2.ts'),'utf8'));
  const RE=/function\s+hasAbilityOn(Side|Active)\s*\(/g;
  assert.equal((src.match(RE)||[]).length,0,'v3000 又出現 local hasAbilityOnSide/hasAbilityOnActive 定義');
  assert.ok(/import\s*\{[\s\S]*?hasAbilityOnSide[\s\S]*?\}\s*from\s*'\.\/v3001_g3_wave3'/.test(src),
    'v3000 必須從 v3001 import 中央帶 gate 版');
  // 正對照：判準必須抓得到違規樣本，否則這條守衛是永遠綠的安慰劑
  const bad='function hasAbilityOnSide(state, ownerIdx, pool, abilityName) { return true; }';
  assert.equal((strip(bad).match(/function\s+hasAbilityOn(Side|Active)\s*\(/g)||[]).length,1,'判準抓不到違規樣本');
});


// ══ 7. Fable/子代理審查抓到的同維度漏網（全部自行查證卡面 stage 後修正）══
//   ⚠ 這一批的重點是 7a：同一張波克基斯，招式-KO 路徑有 gate、其他 6 條 KO 路徑沒有
//     → 熔岩洞在場時「誰把對手 KO 的」會給出不同答案（split-brain，直接影響獎賞卡數）。
const TOGEKISS=findId('波克基斯', ab('奇跡之吻'));
const MAGMAR=findId('鴨嘴炎獸', ab('熔岩波動'));
const TTAR=findId('火箭隊的班基拉斯', ab('揚沙'));
const DUGTRIO=findId('火箭隊的三地鼠', ab('凹洞'));
T('7z. 掃描器下限：第二批依賴的 4 張卡都要抓得到',()=>{
  const missing=Object.entries({TOGEKISS,MAGMAR,TTAR,DUGTRIO}).filter(([,v])=>!v).map(([k])=>k);
  assert.equal(missing.length,0,'抓不到：'+missing.join(','));
});
T('7a.〔split-brain〕奇跡之吻(波克基斯 Stage2)：兩條 KO 路徑對熔岩洞必須給同一答案',()=>{
  const mk=cave=>mkState(cave,
    {name:'A',active:inst(EMOLGA),bench:[inst(TOGEKISS)],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[],hand:[],deck:[],discard:[],prizes:[]});
  // 路徑①（招式KO）：canTogekissMiracleKissTrigger
  assert.equal(mod.canTogekissMiracleKissTrigger(mk(null),0,pool),true);
  assert.equal(mod.canTogekissMiracleKissTrigger(mk(CAVE),0,pool),false,'熔岩洞應消除奇跡之吻');
  // 路徑②（效果KO 等 6 條）：applyMiracleKissOnOppActiveKO — 觸發時會擲幣並寫 log
  const fired=cave=>{const before=mk(cave); const after=mod.applyMiracleKissOnOppActiveKO(before,0,pool);
    return after.log.length>before.log.length;};
  assert.equal(fired(null),true,'無熔岩洞時效果KO路徑應觸發');
  assert.equal(fired(CAVE),false,'熔岩洞在場時效果KO路徑也必須不觸發（否則兩路徑分岔）');
});
T('7b. 熔岩波動(鴨嘴炎獸 Stage1)：熔岩洞在場 → 灼傷加成 0（原本自己跑 inline 計數迴圈）',()=>{
  const mk=cave=>mkState(cave,
    {name:'A',active:inst(MAGMAR),bench:[inst(MAGMAR)],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[],hand:[],deck:[],discard:[],prizes:[]});
  assert.equal(mod.magmarFlowingBurnBonus(mk(null),0,pool),60,'2 隻應 +60');
  assert.equal(mod.magmarFlowingBurnBonus(mk(CAVE),0,pool),0,'熔岩洞應消除熔岩波動');
});
T('7c. 揚沙(火箭隊的班基拉斯 Stage2)：熔岩洞在場 → 不觸發',()=>{
  const mk=cave=>mkState(cave,
    {name:'A',active:inst(TTAR),bench:[],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[],hand:[],deck:[],discard:[],prizes:[]});
  assert.equal(mod.hasRocketTyranitarSandstorm(mk(null),0,pool),true);
  assert.equal(mod.hasRocketTyranitarSandstorm(mk(CAVE),0,pool),false,'熔岩洞應消除揚沙');
});
T('7d. 凹洞(火箭隊的三地鼠 Stage1) 逐隻計數：熔岩洞在場 → 0 個指示物',()=>{
  const mk=cave=>mkState(cave,
    {name:'A',active:inst(EMOLGA),bench:[inst(DUGTRIO),inst(DUGTRIO)],hand:[],deck:[],discard:[],prizes:[]},
    {name:'B',active:inst(LAPRAS),bench:[],hand:[],deck:[],discard:[],prizes:[]});
  assert.equal(mod.countEffectiveAbilityOnSide(mk(null),0,pool,'凹洞'),2,'2 隻三地鼠');
  assert.equal(mod.countEffectiveAbilityOnSide(mk(CAVE),0,pool,'凹洞'),0,'熔岩洞應消除凹洞');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
