// v5.830 驗證：波克基斯|奇跡之吻(對手戰鬥寶可夢昏厥時擲幣+1獎賞)須在「非招式主傷害」KO 也觸發：
//   (A) 黑夜魔靈|咒詛炸彈(特性放13指示物)KO 對手戰鬥位 → 奇跡之吻擲幣(玩家回報漏)
//   (B) 中央 dealAttackDamageToTarget(狙擊/延後傷害)KO 對手戰鬥位 → 奇跡之吻擲幣
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
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
const TOGE='14726'/*波克基斯 奇跡之吻*/, DUSK='14734'/*黑夜魔靈 咒詛炸彈13*/, MUNNA='14086'/*願增猿 HP110*/, LAPRAS='14085';
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const kissLog=(r)=>r.log.some(l=>(typeof l==='string'?l:(l.text||l.msg||JSON.stringify(l))).includes('奇跡之吻'));

// (A) 咒詛炸彈特性 KO 對手戰鬥位
T('A. 咒詛炸彈(特性13指示物)KO對手戰鬥位 → 奇跡之吻觸發',()=>{
  const dusk=inst(DUSK);
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
    pendingSelection:{type:'opp-poke-choose',actorIdx:0,sourcePlayerIdx:1,minCount:1,maxCount:1,
      effectKey:'cursed-bomb',params:{label:'咒詛炸彈',userIid:dusk.iid,includeActive:true,counters:13}},
    players:[
      {name:'A',active:dusk,bench:[inst(TOGE)],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst(TOGE))},
      {name:'B',active:inst(MUNNA,{damage:0}),bench:[inst(LAPRAS)],hand:[],deck:[],discard:[],prizes:[]},
    ]};
  const oldR=Math.random; Math.random=()=>0.1; // 正面
  let r; try{ r=mod.applyAction(st,{type:'RESOLVE_SELECTION',effectKey:'cursed-bomb',selectedIids:[st.players[1].active.iid],actorIdx:0},pool);}finally{Math.random=oldR;}
  assert(!r.players[1].active,'對手戰鬥位應被KO(active=null),實際 '+JSON.stringify(r.players[1].active));
  assert(kissLog(r),'應觸發奇跡之吻(log 未見)，log尾:'+JSON.stringify(r.log.slice(-4)));
});

// (B) 狙擊 dealAttackDamageToTarget KO 對手戰鬥位
T('B. 狙擊(dealAttackDamageToTarget)KO對手戰鬥位 → 奇跡之吻觸發',()=>{
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[
      {name:'A',active:inst(LAPRAS),bench:[inst(TOGE)],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst(TOGE))},
      {name:'B',active:inst(MUNNA,{damage:100}),bench:[inst(LAPRAS)],hand:[],deck:[],discard:[],prizes:[]},
    ]};
  const oldR=Math.random; Math.random=()=>0.1;
  let r; try{ r=mod.dealAttackDamageToTarget(st,0,st.players[1].active.iid,30,pool,{kind:'attack-damage',label:'狙擊'});}finally{Math.random=oldR;}
  assert(!r.players[1].active,'對手戰鬥位應被KO,實際 '+JSON.stringify(r.players[1].active));
  assert(kissLog(r),'應觸發奇跡之吻(log 未見)，log尾:'+JSON.stringify(r.log.slice(-4)));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
