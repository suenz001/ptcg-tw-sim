// v5.640 洛托姆ex|多重轉接：名稱含「洛托姆」的自方寶可夢可附 2 張道具(picker validIids 缺口修正)
//   + 特性消除(洛托姆ex 離場)→ reconcile 丟棄多附的道具
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-mtr.ts'); const O = join(ROOT,'.ent-mtr.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nexport { reconcileMultiToolRelay } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { createGame, applyAction, reconcileMultiToolRelay } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let bal=null,hel=null; for(const[id,c]of pool){if(c.name==='氣球')bal=id;if(c.name==='龐克頭盔')hel=id;}
const ROTOMEX='14347', WASH='12778', VAN='14443';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...e});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

function mk(withEx){
  const s=createGame({name:'P1',entries:[{cardId:VAN,count:1}]},{name:'P2',entries:[{cardId:VAN,count:1}]},pool);
  const wash=inst(WASH,{toolAttached:inst(bal)});  // 清洗洛托姆 已附 氣球
  return { wash, st:{ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[inst(hel)], deck:[inst(VAN)], discard:[], prizes:[inst(VAN)], active:wash, bench: withEx?[inst(ROTOMEX)]:[] },
      { ...s.players[1], hand:[], deck:[inst(VAN)], discard:[], prizes:[inst(VAN)], active:inst(VAN), bench:[] },
    ] } };
}

T('有洛托姆ex：第2張道具 picker validIids 含已附道具的清洗洛托姆', ()=>{
  const {wash,st}=mk(true); const hi=st.players[0].hand[0].iid;
  const out=applyAction(st,{type:'PLAY_TRAINER',iid:hi},pool);
  assert.equal(out.pendingSelection?.effectKey,'attach-tool','應開 attach-tool picker');
  assert(out.pendingSelection.params.validIids.includes(wash.iid),'validIids 應含清洗洛托姆(已附1道具)');
});
T('有洛托姆ex：resolve → 第2張道具進 extraTools', ()=>{
  const {wash,st}=mk(true); const hi=st.players[0].hand[0].iid;
  const o1=applyAction(st,{type:'PLAY_TRAINER',iid:hi},pool);
  const o2=applyAction(o1,{type:'RESOLVE_SELECTION',selectedIids:[wash.iid]},pool);
  assert.equal(o2.players[0].active.extraTools.length,1,'清洗洛托姆 應有1張 extraTools(第2道具)');
  assert(o2.players[0].active.toolAttached,'第1張 toolAttached 仍在');
});
T('控制組：無洛托姆ex → picker validIids 不含已附道具者(仍1道具上限)', ()=>{
  const {wash,st}=mk(false); const hi=st.players[0].hand[0].iid;
  const out=applyAction(st,{type:'PLAY_TRAINER',iid:hi},pool);
  // 沒有可附對象(active已有道具、無其他)→ 道具退回手牌或無 picker
  const vi=out.pendingSelection?.params?.validIids ?? [];
  assert(!vi.includes(wash.iid),'無多重轉接時 validIids 不應含已附道具的清洗洛托姆');
});
T('特性消除：洛托姆ex 離場 → reconcile 丟棄多附道具', ()=>{
  const {wash,st}=mk(true); const hi=st.players[0].hand[0].iid;
  const o1=applyAction(st,{type:'PLAY_TRAINER',iid:hi},pool);
  const o2=applyAction(o1,{type:'RESOLVE_SELECTION',selectedIids:[wash.iid]},pool);
  assert.equal(o2.players[0].active.extraTools.length,1,'前置:應已有 extraTool');
  // 移除洛托姆ex(bench 清空)後跑 reconcile
  const removed={...o2, players:[{...o2.players[0], bench:[]}, o2.players[1]]};
  const rec=reconcileMultiToolRelay(removed,pool);
  assert.equal(rec.players[0].active.extraTools.length,0,'多重轉接消除後 extraTools 應清空');
  assert(rec.players[0].discard.length > o2.players[0].discard.length,'多附道具應進棄牌');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
