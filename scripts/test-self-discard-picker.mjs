// v5.499 自身丟能量招式改 picker（玩家選丟哪個能量，非自動丟最後一張）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-sd.ts'); const O=join(ROOT,'.ent-sd.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';
export { ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects/_shared';
import './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction, ATTACK_PRE_DISCARD_CHOICE }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const RESHIRAM='14689', FIRE='14428';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(FIRE));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// ① 8 招都已註冊 picker
const keys=['萊希拉姆ex|火爆發','長尾火狐|噴射火焰','雷丘|強力伏特','倫琴貓|強力伏特','頓甲|粉碎頭擊','鳳王|紅蓮之翼','大朝北鼻|鼻衝撞','火恐龍|大字爆炎'];
T('8 招都註冊 ATTACK_PRE_DISCARD_CHOICE(UI 會提示選能量)', ()=>{
  for(const k of keys){
    const spec=ATTACK_PRE_DISCARD_CHOICE.get(k);
    assert(spec, k+' 未註冊 picker');
    assert(spec.max>=1, k+' max<1');
  }
});
T('屬性過濾: 鳳王=Fire / 雷丘=Lightning', ()=>{
  assert.equal(ATTACK_PRE_DISCARD_CHOICE.get('鳳王|紅蓮之翼').energyTypeFilter,'Fire');
  assert.equal(ATTACK_PRE_DISCARD_CHOICE.get('雷丘|強力伏特').energyTypeFilter,'Lightning');
});
T('火爆發 picker min=max=1', ()=>{
  const sp=ATTACK_PRE_DISCARD_CHOICE.get('萊希拉姆ex|火爆發');
  assert.equal(sp.min,1); assert.equal(sp.max,1);
});

// ② 火爆發整合：丟玩家選中的能量(非最後一張)
T('火爆發: 丟玩家選的能量(指定第1張)而非自動丟最後', ()=>{
  const e1=inst(FIRE), e2=inst(FIRE), e3=inst(FIRE), e4=inst(FIRE);
  const resh=inst(RESHIRAM,{energyAttached:[e1,e2,e3,e4]});
  const s=createGame({name:'P1',entries:[{cardId:RESHIRAM,count:1}]},{name:'P2',entries:[{cardId:RESHIRAM,count:1}]},pool);
  const st={...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:[inst(FIRE)], discard:[], prizes:prize(6), bench:[], active:resh },
      { ...s.players[1], hand:[], deck:[inst(FIRE)], discard:[], prizes:prize(6), bench:[inst(RESHIRAM)], active:inst(RESHIRAM) },
    ] };
  // 玩家選第 1 張能量(e1)丟棄
  const out=applyAction(st, { type:'ATTACK', attackIndex:1, discardedEnergyIids:[e1.iid] }, pool);
  const remIids=(out.players[0].active?.energyAttached||[]).map(e=>e.iid);
  assert(!remIids.includes(e1.iid), 'e1(玩家選的)應被丟，實際 remaining='+JSON.stringify(remIids));
  assert(out.players[0].discard.some(c=>c.iid===e1.iid), 'e1 應進棄牌');
  assert.equal(remIids.length, 3, '應剩 3 張能量');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
