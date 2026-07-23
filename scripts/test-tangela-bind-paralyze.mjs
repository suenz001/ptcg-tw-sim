// v6.004:莉佳的蔓藤怪|綁緊 官方卡面「擲1次硬幣若為正面,則對手【麻痺】」,原誤實裝 cantRetreatNextFn
//   (無法撤退)=前AI誤讀卡文。改中央 coinStatusPost('paralyzed')。
//   + 匯入放寬:去【】/空白正規化,基本能量「基本火能量」/「基本【火】能量」皆可匹配。
//   HEAD:綁緊設 cantRetreatNextTurn 非 paralyzed / 匯入「基本火能量」匹配不到 → FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-tb.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-tb.ts'); const O=join(ROOT,'.ent-tb.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const TAN='16485',BASIC='14093',GRASS='14102',PSY='14103';
let iid=0;const inst=(cid,e={})=>({iid:'t'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const realRandom=Math.random;

T('① 綁緊(強制正面): 對手【麻痺】(非無法撤退)',()=>{
  Math.random=()=>0; // 正面
  try{
    const s=createGame({name:'A',entries:[{cardId:TAN,count:1}]},{name:'B',entries:[{cardId:BASIC,count:1}]},pool);
    const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:5,
      setupDone:[true,true],pendingSelection:null,pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
      players:[{...s.players[0],hand:[],deck:[inst(TAN)],discard:[],prizes:Array.from({length:6},()=>inst(TAN)),bench:[],active:inst(TAN,{energyAttached:[inst(GRASS),inst(PSY)]})},
               {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)}]};
    const r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
    const opp=r.players[1].active;
    console.log('   對手 status=',opp?.status,' cantRetreatNextTurn=',opp?.cantRetreatNextTurn);
    assert.equal(opp?.status,'paralyzed','對手應【麻痺】,實際 status='+opp?.status);
    assert.ok(!opp?.cantRetreatNextTurn,'不應設無法撤退(那是誤實裝),實際='+opp?.cantRetreatNextTurn);
  } finally { Math.random=realRandom; }
});

// ② 匯入放寬:正規化比對邏輯(複製 decks/+page.svelte 修法),對真實卡池驗
//   Wilson明確要求:「基本【火】能量」與「基本火能量」皆須匹配到基本【火】能量。
//   (「火能量」不測:無此卡名且與特殊能量「燃火能量」歧義,非放寬範圍)
T('② 匯入正規化比對: 基本【火】能量 / 基本火能量 皆匹配到基本【火】能量',()=>{
  const all=[...pool.values()];
  const normNm=(s)=>String(s||'').replace(/[【】\[\]\s]/g,'');
  const matchRelaxed=(name)=>{
    const exact=all.filter(c=>c.name===name);
    if(exact.length) return exact[0];
    const nn=normNm(name);
    const relaxed=nn?all.filter(c=>normNm(c.name)===nn):[];
    if(relaxed.length) return relaxed[0];
    return all.find(c=>String(c.name).includes(name)) ?? (nn?all.find(c=>normNm(c.name).includes(nn)):undefined);
  };
  for(const q of ['基本【火】能量','基本火能量']){
    const c=matchRelaxed(q);
    console.log('   輸入「%s」→ %s',q,c?.name);
    assert.ok(c && c.supertype==='Energy' && c.subtype==='Basic' && /火/.test(c.name),'「'+q+'」應匹配到基本【火】能量,實際='+c?.name);
  }
  // HEAD 舊邏輯(exact + includes)對「基本火能量」應匹配不到(證明放寬有效)
  const oldMatch=(name)=>{const exact=all.filter(c=>c.name===name);if(exact.length)return exact[0];return all.find(c=>String(c.name).includes(name));};
  assert.ok(!oldMatch('基本火能量'),'HEAD舊邏輯「基本火能量」應匹配不到(證明需放寬)');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
