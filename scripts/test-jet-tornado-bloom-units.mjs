// v5.949 守衛:噴射旋風「選3個能量」=單位計數(繁茂 aware)+彈性卡數。
//   繁茂+2張基本草(=4單位≥3)應可用招式(HEAD guard 卡數<3 誤擋)+可只選2張移動。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.jt-e.ts'),O=join(ROOT,'.jt-o.mjs'),S=join(ROOT,'.jt-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`export { applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;
  for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))pool.set(String(c.id),c);}
const eid=(n)=>{for(const[id,c]of pool)if(c.name===n)return id;return'?';};
const GRASS=eid('基本【草】能量');
let nn=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:cid,damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:cid,damage:0,energyAttached:[]});
const YANMEGA='16493';  // 遠古巨蜓ex 噴射旋風 cost[Grass×3,Colorless]
const BLOOM='17971';    // 大竺葵 繁茂
const COAT='18491';     // 奇諾栗鼠ex 240HP(高HP不被KO)
const TARGET='10605';   // 不良蛙(備戰轉移目標)
function mk() {
  const g1=en(GRASS), g2=en(GRASS);
  return { state:{
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active: inst(YANMEGA,[g1,g2]), bench:[inst(BLOOM), inst(TARGET)], hand:[], deck:Array.from({length:10},()=>en(GRASS)), discard:[], prizes:Array.from({length:6},()=>en(GRASS)), name:'P0' },
      { active: inst(COAT), bench:[], hand:[], deck:Array.from({length:10},()=>en(GRASS)), discard:[], prizes:Array.from({length:6},()=>en(GRASS)), name:'P1' },
    ] }, g1, g2 };
}
// 攻擊
const { state, g1, g2 } = mk();
let st = applyAction(state, { type:'ATTACK', attackIndex:0, actorIdx:0 }, pool);
// 斷言1:繁茂+2張草(4單位)招式可用→開能量 picker(HEAD guard 卡數<3 會擋→pendingSelection null)
assert.ok(st.pendingSelection && st.pendingSelection.type==='active-energy-discard',
  `繁茂+2張草應可用噴射旋風並開能量選擇(得 pendingSelection=${st.pendingSelection?.type ?? 'null'})`);
assert.strictEqual(st.pendingSelection.params?.unitTarget, 3, 'unitTarget 應=3');
// 斷言2:選 2 張草(k=2≤3≤4單位)→合法→接力開 bench 目標選擇
st = applyAction(st, { type:'RESOLVE_SELECTION', effectKey:'yanmega-jet-tornado-pick-energy', selectedIids:[g1.iid,g2.iid], actorIdx:0 }, pool);
assert.ok(st.pendingSelection && st.pendingSelection.type==='bench-choose', `選2張後應開轉移目標(得 ${st.pendingSelection?.type})`);
// 斷言3:選目標→2張草移到目標,active 剩0
const tgtIid = st.players[0].bench.find(b=>b.cardId===TARGET).iid;
st = applyAction(st, { type:'RESOLVE_SELECTION', effectKey:'yanmega-jet-tornado-move-energy', selectedIids:[tgtIid], actorIdx:0 }, pool);
const tgt = st.players[0].bench.find(b=>b.cardId===TARGET);
const act = st.players[0].active;
assert.strictEqual(tgt.energyAttached.length, 2, `目標應獲得 2 張草(得 ${tgt.energyAttached.length})`);
assert.strictEqual(act.energyAttached.length, 0, `active 應剩 0 張(得 ${act.energyAttached.length})`);
console.log('✅ 噴射旋風繁茂單位守衛全過(2張草可用+可只選2張移動+單位計數)');
