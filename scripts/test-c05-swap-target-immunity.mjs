// v5.995 HEAD-FAIL 守衛:C-05「選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換」免疫方向 +
//   可怕的哥哥 道具/特殊能量 picker。
// 官方依據:PTCG_RULES.md §17.3.D 判例(催眠貘|強行入眠 可選「不眠」烏鴉頭頭互換)—
//   C-05 效果對象是【被選的備戰寶可夢】:原戰鬥位「不受招式/特性效果」不擋互換;
//   免疫效果的「備戰」不可被選為互換目標。C-04(對手選)gate 原戰鬥位不變。
// HEAD(v5.994)FAIL 點:①oppSwapDmgPost 誤 gate 原戰鬥位 ②備戰目標無免疫過濾
//   ③「新上場受N傷害」inline 不計弱點/不走傷害免疫 ④可怕的哥哥自動丟末張特殊能量。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.c5-s.js'),E=join(ROOT,'.c5-e.ts'),O=join(ROOT,'.c5-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { createGame, applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const HIDDEN='19176'/*詛咒娃娃 化隱(備戰也免疫)*/, PLAIN='14086'/*願增猿*/, DOG='14348'/*來電汪 弱鬥70HP*/;
const CREEPY='12557', SP1='11094'/*富裕能量*/, SP2='17207'/*燃火能量*/, TOOL1='10639', TOOL2='10640', ROTOM='14347';
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function base(){const s=mod.createGame({name:'P1',entries:[{cardId:PLAIN,count:1}]},{name:'P2',entries:[{cardId:PLAIN,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0]};}
function st(attCid,defActiveCid,benchCids,extra={}){
  const b=base(); const bench=benchCids.map(c=>inst(c));
  return {state:{...b,players:[{...b.players[0],active:inst(attCid),bench:[],hand:[],deck:[inst(PLAIN)],discard:[],prizes:[inst(PLAIN)],...extra},
    {...b.players[1],active:inst(defActiveCid),bench,hand:[],deck:[inst(PLAIN)],discard:[],prizes:[inst(PLAIN)]}]},bench};
}
const orig=Math.random;
// ── A. 全部 C-05 招式:化隱 active → 仍開 picker;化隱備戰 → validIids 排除 ──
const C05=[['皮皮|看我嘛',false],['大嘴娃|誘導敲詐',false],['裹蜜蟲|蜜糖捕捉器',false],['勇士雄鷹|拖出',false],
  ['火爆猴|拖出',false],['幾何雪花|拖出',false],['派帕的陸地水母|拉扯',false],['流氓熊貓|拉扯',false],['飄飄球|拉扯',true]];
for(const [key,coin] of C05){
  T(`${key}: 化隱 active → 仍開 picker + 化隱備戰被 validIids 排除`,()=>{
    const {state,bench}=st(PLAIN,HIDDEN,[HIDDEN,PLAIN]);
    if(coin)Math.random=()=>0.1;
    let r; try{ r=mod.ATTACK_POST.get(key)(state,0,pool,{}); } finally { Math.random=orig; }
    assert(r.pendingSelection,'C-05 化隱 active 應照常開 picker(HEAD 誤擋)');
    assert.equal(r.pendingSelection.effectKey,'opp-swap-dmg','應收斂中央 opp-swap-dmg');
    const v=r.pendingSelection.params?.validIids;
    assert(Array.isArray(v),'應帶 validIids(HEAD 無)');
    assert(!v.includes(bench[0].iid),'化隱備戰不可為互換目標');
    assert(v.includes(bench[1].iid),'一般備戰應可選');
  });
}
T('勾結觸手: 已使出庫瑟洛斯奇的企圖 → C-05 gust(化隱 active 不擋)',()=>{
  const {state}=st(PLAIN,HIDDEN,[PLAIN],{kuceroskPlayedThisTurn:true});
  const r=mod.ATTACK_POST.get('烏賊王|勾結觸手')(state,0,pool,{});
  assert(r.pendingSelection,'條件成立應開 gust picker');
  assert.equal(r.pendingSelection.params?.damage,120,'新上場傷害 120');
});
T('勾結觸手: 未使出 → 招式失敗(不開 picker)',()=>{
  const {state}=st(PLAIN,PLAIN,[PLAIN]);
  const r=mod.ATTACK_POST.get('烏賊王|勾結觸手')(state,0,pool,{});
  assert(!r.pendingSelection,'條件不成立不應開 picker');
});
// ── B. 備戰全免疫 → 不開 picker(無合法目標) ──
T('皮皮|看我嘛: 備戰全化隱 → 不開 picker,不互換',()=>{
  const {state}=st(PLAIN,PLAIN,[HIDDEN]);
  const r=mod.ATTACK_POST.get('皮皮|看我嘛')(state,0,pool,{});
  assert(!r.pendingSelection,'備戰全免疫不應開 picker');
  assert.equal(r.players[1].active.cardId,PLAIN,'active 不變');
});
// ── C. resolver fail-safe:強選化隱備戰 → 不互換 ──
T('resolver fail-safe: 強選化隱備戰 → 不互換',()=>{
  const {state,bench}=st(PLAIN,PLAIN,[HIDDEN,PLAIN]);
  let r=mod.ATTACK_POST.get('皮皮|看我嘛')(state,0,pool,{});
  r=mod.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[bench[0].iid],actorIdx:0},pool);
  assert.equal(r.players[1].active.cardId,PLAIN,'化隱備戰被強選也不互換(fail-safe)');
});
// ── D. 傷害走中央:換上弱鬥70HP來電汪 → 30 基礎 ×2 弱點 = 60 ──
T('火爆猴|拖出: 新上場傷害走中央(弱鬥×2=60,HEAD inline=30)',()=>{
  const {state,bench}=st('19185',PLAIN,[DOG]);
  let r=mod.ATTACK_POST.get('火爆猴|拖出')(state,0,pool,{});
  r=mod.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[bench[0].iid],actorIdx:0},pool);
  assert.equal(r.players[1].active.cardId,DOG,'來電汪應上場');
  assert.equal(r.players[1].active.damage,60,'30×弱點2=60(HEAD=30)');
});
// ── E. C-04 對照(不回歸):化隱 active → 擋 ──
for(const key of ['駒刀小兵|推倒','巨金怪|彈回','沙河馬|推倒']){
  T(`${key}(C-04 對手選): 化隱 active → 仍被擋(不回歸)`,()=>{
    const {state}=st(PLAIN,HIDDEN,[PLAIN]);
    const r=mod.ATTACK_POST.get(key)(state,0,pool,{});
    assert(!r.pendingSelection,'C-04 化隱 active 應擋');
  });
}
// ── F. 可怕的哥哥:2 特殊能量 → picker 且丟玩家選的那張;洛托姆ex 2 道具 → modal ──
T('可怕的哥哥: 2 特殊能量 → 開 picker,丟玩家選的那張(HEAD 自動丟末張)',()=>{
  const b=base(); const e1=inst(SP1),e2=inst(SP2);
  const tgt=inst(PLAIN,{energyAttached:[e1,e2]}); const sup=inst(CREEPY);
  let s={...b,players:[{...b.players[0],active:inst(PLAIN),bench:[],hand:[sup],deck:[inst(PLAIN)],discard:[],prizes:[]},
    {...b.players[1],active:tgt,bench:[],hand:[],deck:[inst(PLAIN)],discard:[],prizes:[]}]};
  let r=mod.applyAction(s,{type:'PLAY_TRAINER',iid:sup.iid},pool);
  r=mod.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[tgt.iid],actorIdx:0},pool);
  assert.equal(r.pendingSelection?.effectKey,'creepy-bro-pick-energy','2張特殊能量應開 picker(HEAD 自動丟末張)');
  r=mod.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[e1.iid],actorIdx:0},pool);
  assert(r.players[1].discard.some(c=>c.iid===e1.iid),'應丟玩家選的富裕能量');
  assert(r.players[1].active.energyAttached.some(c=>c.iid===e2.iid),'燃火能量應留著');
});
T('可怕的哥哥: 洛托姆ex 2 道具(含 extraTools) → modal 選 1 丟 1',()=>{
  const b=base(); const t1=inst(TOOL1),t2=inst(TOOL2);
  const tgt=inst(ROTOM,{toolAttached:t1,extraTools:[t2]}); const sup=inst(CREEPY);
  let s={...b,players:[{...b.players[0],active:inst(PLAIN),bench:[],hand:[sup],deck:[inst(PLAIN)],discard:[],prizes:[]},
    {...b.players[1],active:tgt,bench:[],hand:[],deck:[inst(PLAIN)],discard:[],prizes:[]}]};
  let r=mod.applyAction(s,{type:'PLAY_TRAINER',iid:sup.iid},pool);
  r=mod.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[tgt.iid],actorIdx:0},pool);
  assert.equal(r.pendingSelection?.effectKey,'creepy-bro-pick-tool','2張道具應開 modal(HEAD 只丟 toolAttached)');
  r=mod.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[t2.iid],actorIdx:0},pool);
  assert(r.players[1].discard.some(c=>c.iid===t2.iid),'應丟玩家選的道具');
  assert.equal(r.players[1].active.toolAttached?.iid,t1.iid,'另一張道具留著');
});
// ── G. 除蟲噴霧(Item C-04):緊張感 active(不受對手物品)→ 擋;化隱(只擋招式/特性)→ 不擋 ──
T('除蟲噴霧: 緊張感 active → 擋(HEAD 漏 gate);化隱 active → 不擋(trainer 不受化隱影響)',()=>{
  const SPRAY=[...pool.values()].find(c=>c.name==='除蟲噴霧');
  const AXEW='17013';
  const run=(cid)=>{const b=base(); const sp=inst(String(SPRAY.id));
    const s={...b,players:[{...b.players[0],active:inst(PLAIN),bench:[],hand:[sp],deck:[inst(PLAIN)],discard:[],prizes:[]},
      {...b.players[1],active:inst(cid),bench:[inst(PLAIN)],hand:[],deck:[inst(PLAIN)],discard:[],prizes:[]}]};
    return mod.applyAction(s,{type:'PLAY_TRAINER',iid:sp.iid},pool);};
  assert(!run(AXEW).pendingSelection,'緊張感 active 應擋除蟲噴霧');
  assert(run(HIDDEN).pendingSelection,'化隱不擋 trainer → 應開對手 bench-choose');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
