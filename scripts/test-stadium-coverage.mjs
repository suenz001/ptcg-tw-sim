// v5.962 守衛(場地卡涵蓋度):防未來新增 live+HIJ 競技場沒掛任何 hook(v3.68 鐵律 stadiums.ts:
//   「名字在 set ≠ 已實裝」的自動化版本)。斷言每張 live HIJ 競技場名字 ∈ PASSIVE_STADIUMS(被動)
//   或 ∈ 已知 ACTIVE 觸發型清單(12 張,各有 resolver/TRAINER_EFFECTS,Fable 5 v5.961 輪逐一 audit 過)。
//   新增競技場若沒進兩個集合之一 → FAIL(根絕 v3.67「中立中心 名字在 set 卻無 hook」silent stub 回歸)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.stc-e.ts'),O=join(ROOT,'.stc-o.mjs'),S=join(ROOT,'.stc-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { PASSIVE_STADIUMS, PENDING_STADIUMS } from './src/lib/game/effects';\n"
  + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { PASSIVE_STADIUMS, PENDING_STADIUMS, applyAction } = await import(pathToFileURL(O).href);

// 12 張 active 觸發型競技場(每回合可用1次/放備戰/搜尋型;Fable 5 audit 已確認實裝)
const ACTIVE_STADIUMS = new Set([
  '化石採掘場','壯偉碩木','夜間學院','密阿雷市','尖釘鎮道館','居民會館',
  '慶祝開場樂','火箭隊的工廠','神秘花園','稜鏡塔','衝浪海灘','釀光市',
]);

// 枚舉 live HIJ 競技場
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const stadiums=new Set();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))
    if(c?.subtype==='Stadium' && ['H','I','J'].includes(c.regulationMark)) stadiums.add(c.name); }

let pass=0,fail=0; const chk=(n,c)=>{if(c)pass++;else{fail++;console.log('  ❌',n);}};
chk('至少枚舉到 competitive 競技場(>=20)', stadiums.size>=20);
chk('PASSIVE_STADIUMS 非空', PASSIVE_STADIUMS.size>0);

// 核心:每張 live HIJ 競技場 ∈ PASSIVE ∪ ACTIVE
const uncovered=[...stadiums].filter(n=> !PASSIVE_STADIUMS.has(n) && !ACTIVE_STADIUMS.has(n) && !PENDING_STADIUMS.has(n));
chk('每張 live HIJ 競技場都有掛 hook(∈ PASSIVE 或 ACTIVE 或 PENDING)', uncovered.length===0);
if(uncovered.length) console.log('   未涵蓋(新增競技場請掛 hook 並加進對應 set):', uncovered.join('、'));

// ── v6.059：PENDING_STADIUMS 不是白名單漏洞 ──────────────────────────────────
// 放進 PENDING 的競技場「必須真的打不出來」(fail-closed)。若只是加進集合卻沒被 engine 擋，
// 玩家仍能放上場而毫無效果 = 原守衛要根絕的 silent stub 換個地方出現。
// 故此處用**行為**驗證：實跑 PLAY_TRAINER，斷言卡片仍留在手牌、且沒有變成 activeStadium。
const cardByName=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null && !cardByName.has(c.name)) cardByName.set(c.name,c); }
const poolAll=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) poolAll.set(String(c.id),c); }
let n=0; const mk=(cid)=>({iid:`s${++n}`,cardId:String(cid),damage:0,energyAttached:[]});
const playStadium=(card)=>{
  const stad=mk(card.id);
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,
    log:[],pendingSelection:null,setupDone:[true,true],activeStadium:null,stadiumPlayedThisTurn:[false,false],
    players:[{name:'P1',active:mk('12702'),bench:[],hand:[stad],deck:[],discard:[],prizes:[]},
             {name:'P2',active:mk('12702'),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  let after; try{ after=applyAction(st,{type:'PLAY_TRAINER',iid:stad.iid},poolAll); }catch(e){ return {err:e.message,st}; }
  return { after, stad };
};
// ⭐正對照:一張「已實裝」的被動競技場必須真的打得出來 —— 否則本 harness 恆綠、
//   後面的 PENDING 斷言就毫無意義(HEAD-FAIL 驗證時抓到過這個假綠)。
{
  const ctrlName=[...PASSIVE_STADIUMS].find(n=>cardByName.has(n) && !PENDING_STADIUMS.has(n));
  const ctrl=ctrlName?cardByName.get(ctrlName):null;
  const r=ctrl?playStadium(ctrl):null;
  chk(`正對照:已實裝競技場「${ctrlName}」可正常打出(harness 有效性)`,
      !!r && !r.err && !!r.after?.activeStadium);
}
for(const name of PENDING_STADIUMS){
  const card=cardByName.get(name);
  if(!card){ chk(`PENDING「${name}」存在於 live 卡池`, false); continue; }
  const r=playStadium(card);
  const stillInHand = !r.err && (r.after?.players?.[0]?.hand??[]).some(c=>c.iid===r.stad.iid);
  const notOnField  = !r.err && !r.after?.activeStadium;
  chk(`PENDING「${name}」確實無法打出(仍在手牌)`, stillInHand);
  chk(`PENDING「${name}」確實沒進場上競技場區`, notOnField);
}


console.log(`stadium-coverage:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
