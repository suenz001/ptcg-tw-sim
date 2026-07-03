// v5.855 下場清狀態：戰鬥位→備戰時三狀態槽(睡眠+中毒+灼傷)全清。
//   中央防線 scrubBenchStatus 原只清 status+secondaryStatus,漏第三槽 tertiaryStatus;
//   AZ的平和(az-peace-swap)不走 clearActiveEffects、靠 sweep 兜底→第三槽灼傷洩到備戰。
//   修:scrubBenchStatus 補 tertiaryStatus(中央) + az-peace-swap 收斂 clearActiveEffects。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const cid=(nm)=>{for(const[id,c]of pool)if(c.name===nm)return id;return null;};
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...e});
const AZ=cid('AZ的平和'), VAN=cid('願增猿');
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

T('AZ的平和 換場：舊 active 三狀態槽(睡眠+中毒+灼傷)全清 [HEAD FAIL:tertiary 灼傷洩到備戰]', ()=>{
  const oldA=inst(VAN,{status:'asleep', secondaryStatus:'poisoned', tertiaryStatus:'burned'});
  const benchMon=inst(VAN);
  const st={ phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null,
    players:[ {name:'A',active:oldA,bench:[benchMon],hand:[inst(AZ)],deck:[inst(VAN)],discard:[],prizes:[inst(VAN)],supporterPlayedThisTurn:false}, {name:'B',active:inst(VAN),bench:[],hand:[],deck:[inst(VAN)],discard:[],prizes:[inst(VAN)]} ]};
  const o1=applyAction(st,{type:'PLAY_TRAINER',iid:st.players[0].hand[0].iid},pool);
  assert.equal(o1.pendingSelection?.effectKey,'az-peace-swap','應開 az-peace-swap');
  const o2=applyAction(o1,{type:'RESOLVE_SELECTION',selectedIids:[benchMon.iid]},pool);
  const onBench=o2.players[0].bench.find(b=>b.iid===oldA.iid);
  assert(onBench,'舊 active 應在備戰');
  assert.equal(onBench.status,undefined,'status 應清');
  assert.equal(onBench.secondaryStatus,undefined,'secondaryStatus 應清');
  assert.equal(onBench.tertiaryStatus,undefined,'tertiaryStatus(第三槽)應清');
});

T('中央防線 scrubBenchStatus：備戰若殘留三槽狀態,任一 action 後被抹除 [HEAD FAIL]', ()=>{
  // 直接構造備戰殘留 tertiaryStatus(模擬任何漏清路徑),跑一個 action 觸發 sweep
  const benchLeaked=inst(VAN,{tertiaryStatus:'burned'});
  const st={ phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null,
    players:[ {name:'A',active:inst(VAN),bench:[benchLeaked],hand:[],deck:[inst(VAN)],discard:[],prizes:[inst(VAN)]}, {name:'B',active:inst(VAN),bench:[],hand:[],deck:[inst(VAN)],discard:[],prizes:[inst(VAN)]} ]};
  const o=applyAction(st,{type:'ATTACH_ENERGY',iid:'nonexistent'},pool); // no-op action,仍走 applyAction wrapper 的 sweep
  const b=o.players[0].bench.find(x=>x.iid===benchLeaked.iid);
  assert.equal(b.tertiaryStatus,undefined,'備戰殘留的 tertiaryStatus 應被中央 sweep 抹除');
});

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`); process.exit(fail?1:0);
