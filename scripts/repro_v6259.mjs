// v6.259 複驗：走中央 dealAttackDamageToTarget 的 KO 是否觸發 PASSIVE_ON_KO（鬆口氣）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.r-s.js'),E=join(ROOT,'.r-e.ts'),O=join(ROOT,'.r-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nexport { dealAttackDamageToTarget } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const LUCARIO='13986', MUNNA_EX='11628', MOMO_EX='11630', PIDGEY='14797', E_FIGHT='14104';
let seq=0;
const I=(cardId,extra={})=>({iid:'i'+(++seq),cardId,damage:0,energyAttached:[],...extra});
const EN=id=>({iid:'e'+(++seq),cardId:id});
const strip=s=>String(s).replace(/[^-]*/g,m=>m);
const L=r=>r.log.map(l=>(typeof l==='string'?l:(l.message??''))).map(x=>x.replace(/[-]/g,''));

function mk(handN, preDmg){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,
    log:[],pendingSelection:null,setupDone:[true,true],activeStadium:null,
    players:[
      {name:'A',active:I(LUCARIO,{energyAttached:[EN(E_FIGHT),EN(E_FIGHT)]}),bench:[],
       hand:Array.from({length:handN},()=>I(PIDGEY)),deck:[],discard:[],
       prizes:Array.from({length:6},()=>I(PIDGEY))},
      {name:'B',active:I(MUNNA_EX,{damage:preDmg}),bench:[I(MOMO_EX)],hand:[],deck:[],discard:[],
       prizes:Array.from({length:6},()=>I(PIDGEY))},
    ]};
}
function run(name, handN, attackIndex, preDmg){
  const st=mk(handN,preDmg);
  const handBefore=st.players[0].hand.map(c=>c.iid);
  let r=mod.applyAction(st,{type:'ATTACK',attackIndex,actorIdx:0},pool);
  let g=0;
  while(r.pendingSelection && g++<6){
    const ps=r.pendingSelection;
    r=mod.applyAction(r,{type:'RESOLVE_SELECTION',effectKey:ps.effectKey,selectedIids:[],actorIdx:ps.actorIdx},pool);
  }
  const logs=L(r);
  console.log(`\n===== ${name} (hand=${handN}, attackIndex=${attackIndex}, preDmg=${preDmg}) =====`);
  logs.forEach(x=>console.log('  |',x));
  console.log('  >> 鬆口氣 log?', logs.some(x=>x.includes('鬆口氣')));
  console.log('  >> 對手 active =', r.players[1].active?r.players[1].active.cardId:'null(已KO)');
  console.log('  >> 攻擊方 prizes 剩', r.players[0].prizes.length, '| hand', r.players[0].hand.length);
  const handAfter=r.players[0].hand.map(c=>c.iid);
  const lost=handBefore.filter(x=>!handAfter.includes(x));
  console.log('  >> 原手牌被拿走的 iid =', JSON.stringify(lost));
  console.log('  >> 攻擊方 prizes 底部 iid =', r.players[0].prizes.length?r.players[0].prizes[r.players[0].prizes.length-1].iid:'-');
  return r;
}
console.log('卡池檢核：', ['LUCARIO','MUNNA_EX','MOMO_EX','PIDGEY','E_FIGHT'].map((k,i)=>{
  const v=[LUCARIO,MUNNA_EX,MOMO_EX,PIDGEY,E_FIGHT][i]; return k+'='+(pool.get(v)?.name??'❌MISSING');}).join(', '));

run('A 波動突刺(中央 dealAttackDamageToTarget)', 3, 0, 100);
run('B 超級勇氣(引擎主管線)',                   3, 1, 0);
run('C 波動突刺(中央) 手牌0',                   0, 0, 100);
run('D 超級勇氣(引擎主管線) 手牌0',             0, 1, 0);
