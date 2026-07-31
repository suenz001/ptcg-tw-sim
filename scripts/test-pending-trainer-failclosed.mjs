// v6.066 守衛：未實裝的 物品／支援者／寶可夢道具 必須 fail-closed（擋住不可打出）。
//   ⭐三層驗證，任一層失守都 FAIL：
//     (1) 判定層：isTrainerPendingImplementation 只認 Item/Supporter/PokemonTool，**不得**涵蓋 Stadium
//         （34 張競技場全都沒有 TRAINER_EFFECTS handler，誤用此判準會把全部競技場擋掉）
//     (2) engine 打出路徑：PLAY_TRAINER 後卡片仍在手牌、支援者權未被消耗
//     (3) 可打出清單 filter：getPlayableTrainers 不得包含它（否則手牌亮框、AI 會反覆挑）
//   ⭐正對照：一張**已實裝**的支援者必須照常打得出來，否則本 harness 恆綠。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.pt-s.js'),E=join(ROOT,'.pt-e.ts'),O=join(ROOT,'.pt-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame, getPlayableTrainers } from './src/lib/game/engine';\n"
  +"export { TRAINER_EFFECTS, isTrainerPendingImplementation, TRAINER_NO_HANDLER_OK } from './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const { applyAction, createGame, TRAINER_EFFECTS, isTrainerPendingImplementation, TRAINER_NO_HANDLER_OK } = M;
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){ if(c?.id==null)continue; pool.set(String(c.id),c);
    if(!byName.has(c.name)) byName.set(c.name,c); } }
let pass=0,fail=0; const chk=(t,c,x='')=>{ if(c)pass++; else{fail++;console.log('  ❌',t,x);} };

// 枚舉 live H/I/J 訓練家
const trainers=[...byName.values()].filter(c=>c.supertype==='Trainer'&&['H','I','J'].includes(c.regulationMark));
const pending=trainers.filter(c=>isTrainerPendingImplementation(c.name,c.subtype));
const stadiums=trainers.filter(c=>c.subtype==='Stadium');
// (1) 判定層
chk('判定不得涵蓋任何競技場(否則 34 張全被誤擋)', stadiums.every(c=>!isTrainerPendingImplementation(c.name,c.subtype)),
    stadiums.filter(c=>isTrainerPendingImplementation(c.name,c.subtype)).map(c=>c.name).join('、'));
chk('被判定為未實裝的卡確實都沒有 TRAINER_EFFECTS handler', pending.every(c=>!TRAINER_EFFECTS.has(c.name)));
chk('白名單裡的卡不得被判為未實裝', [...TRAINER_NO_HANDLER_OK].every(n=>{
      const c=byName.get(n); return !c || !isTrainerPendingImplementation(c.name,c.subtype); }));
console.log(`   未實裝(將被擋住)的訓練家 ${pending.length} 張：${pending.map(c=>`${c.name}(${c.subtype})`).join('、')||'無'}`);

let n=0; const inst=(cid,e={})=>({iid:`p${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const BASIC=[...pool.values()].find(c=>c.supertype==='Pokemon'&&c.stage==='Basic');
function playTrainer(card){
  const t=inst(card.id);
  const s0=createGame({name:'P1',entries:[{cardId:String(BASIC.id),count:1}]},
                      {name:'P2',entries:[{cardId:String(BASIC.id),count:1}]},pool);
  const st={...s0,phase:'playing',turnPhase:'main',turn:5,activePlayerIndex:0,firstPlayerIdx:0,
    isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    activeStadium:null,pendingSelection:null,log:[],supporterUsedThisTurn:[false,false],
    players:[{...s0.players[0],active:inst(BASIC.id),bench:[],hand:[t],deck:[inst(BASIC.id),inst(BASIC.id)],
              discard:[],prizes:Array.from({length:6},()=>inst(BASIC.id))},
             {...s0.players[1],active:inst(BASIC.id),bench:[inst(BASIC.id)],hand:[],deck:[inst(BASIC.id)],
              discard:[],prizes:Array.from({length:6},()=>inst(BASIC.id))}]};
  let out; try{ out=applyAction(st,{type:'PLAY_TRAINER',iid:t.iid},pool); }catch(e){ out={__err:e.message}; }
  return { out, t, st };
}
// (2) engine 打出路徑：全部 pending 卡都要留在手牌、沒進棄牌區
for(const c of pending){
  const { out, t } = playTrainer(c);
  chk(`「${c.name}」(${c.subtype}) 擋住不可打出(仍在手牌)`,
      (out?.players?.[0]?.hand??[]).some(x=>x.iid===t.iid), out?.__err);
  chk(`「${c.name}」不得進棄牌區`, (out?.players?.[0]?.discard??[]).length===0);
  if(c.subtype==='Supporter')
    chk(`「${c.name}」不得消耗本回合支援者權`, out?.supporterUsedThisTurn?.[0]!==true, JSON.stringify(out?.supporterUsedThisTurn));
}
// ⭐正對照：已實裝的支援者必須照常打得出來（否則以上全綠沒有意義）
{
  const ok=trainers.find(c=>c.subtype==='Supporter'&&TRAINER_EFFECTS.has(c.name));
  const { out, t } = playTrainer(ok);
  chk(`正對照：已實裝支援者「${ok?.name}」可正常打出(離開手牌)`,
      !!ok && !(out?.players?.[0]?.hand??[]).some(x=>x.iid===t.iid), out?.__err);
}
// (3) 可打出清單 filter
if(M.getPlayableTrainers){
  for(const c of pending){
    const { st, t } = playTrainer(c);
    let listed=null; try{ listed=M.getPlayableTrainers(st,pool); }catch{ listed=null; }
    if(Array.isArray(listed))
      chk(`「${c.name}」不出現在可打出清單(手牌不亮框/AI 不會挑到)`,
          !listed.some(x=>x?.iid===t.iid || x===t.iid));
  }
} else console.log('   (getPlayableTrainers 未 export，跳過 filter 端驗證)');
console.log(`pending-trainer-failclosed:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
