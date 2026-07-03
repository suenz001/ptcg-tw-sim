// 弱點/抵抗力 skip 旗標對齊卡面守衛(跨卡維度 audit 固化)。
// 卡面「這個招式的傷害不計算弱點」→ 僅 skipWeakness;「不計算抵抗力」→ 僅 skipResistance;
// 「不計算弱點・抵抗力」→ skipWeakRes(或兩者皆設)。此類曾出真 bug(v4.495 激怒咒詛誤用 skipWeakRes→抵抗力誤跳)。
// 驅動 ATTACK_PRE,提供滿足條件的 state,斷言回傳的 skip 旗標與卡面一致。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...e});
function cardIdByName(nm){ for(const[id,c]of pool){ if(c.name===nm) return id; } return null; }
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// 各招式:提供能滿足「傷害>0」條件的 attacker state,取 PRE 回傳旗標
function runPre(cardName, atkName, buildActive){
  const cid=cardIdByName(cardName); assert(cid, 'card not found: '+cardName);
  const active=buildActive(cid);
  const st={ phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null,
    players:[ {name:'A',active,bench:[],hand:[],deck:[],discard:[],prizes:[]}, {name:'B',active:inst(cardIdByName('願增猿')||cid),bench:[],hand:[],deck:[],discard:[],prizes:[]} ] };
  const fn=ATTACK_PRE.get(cardName+'|'+atkName); assert(fn,'no ATTACK_PRE for '+cardName+'|'+atkName);
  return fn(st,0,pool,{});
}
const GRASS=cardIdByName('基本【草】能量')||cardIdByName('基本【火】能量');
const FIGHT=cardIdByName('基本【鬥】能量')||GRASS;

// 僅抵抗力 → skipResistance true, skipWeakRes/skipWeakness 不設
for(const [cn,an] of [['師父鼬','衝天粉碎'],['雷吉洛克','毀壞者金勾臂'],['樹才怪','岩石投擲']]){
  T(`${cn}|${an} 卡面「不計算抵抗力」→ 僅 skipResistance`, ()=>{
    const r=runPre(cn,an,(cid)=>inst(cid,{energyAttached:[inst(FIGHT),inst(FIGHT),inst(FIGHT)]}));
    assert.equal(!!r.skipResistance,true,'應 skipResistance');
    assert.equal(!!r.skipWeakRes,false,'不應 skipWeakRes(會誤跳弱點)');
    assert.equal(!!r.skipWeakness,false,'不應 skipWeakness');
  });
}
// 弱點+抵抗力 → skipWeakRes (或兩者)
T('恰雷姆ex|瑜伽踢 卡面「不計算弱點・抵抗力」→ skipWeakRes', ()=>{
  const r=runPre('恰雷姆ex','瑜伽踢',(cid)=>inst(cid,{energyAttached:[inst(FIGHT),inst(FIGHT)]}));
  assert(!!r.skipWeakRes || (!!r.skipWeakness && !!r.skipResistance),'應跳弱點與抵抗力');
});
// 僅弱點 → skipWeakness, 不 skipResistance
T('沙鐵皮|磁場炸裂 卡面「不計算弱點」(能量≥3分支)→ 僅 skipWeakness', ()=>{
  const r=runPre('沙鐵皮','磁場炸裂',(cid)=>inst(cid,{energyAttached:[inst(GRASS),inst(GRASS),inst(GRASS)]}));
  assert.equal(!!r.skipWeakness,true,'應 skipWeakness');
  assert.equal(!!r.skipWeakRes,false,'不應 skipWeakRes(會誤跳抵抗力)');
  assert.equal(!!r.skipResistance,false,'不應 skipResistance');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`); process.exit(fail?1:0);
