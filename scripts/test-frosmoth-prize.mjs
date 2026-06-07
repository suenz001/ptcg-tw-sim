// v5.498 雪妖女|冰冷之帳 checkup KO 對手寶可夢 → 雪妖女owner應取得獎賞卡(先前被後續clearTurnFlags覆蓋)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-fp.ts'); const O=join(ROOT,'.ent-fp.mjs');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine'; import './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const FROSMOTH='10447', ABILITY_POKE='18513', VANILLA='14443'; // 雪妖女 / 小木靈(HP70,特性) / 含羞苞(HP30,無特性)
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(VANILLA));
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

// P0(aIdx=0,結束回合) active=含羞苞(無特性不被打)+bench[雪妖女]; P1 active=小木靈(特性,damage60→+10=70 KO)
function mk(){
  const s=createGame({name:'P1',entries:[{cardId:VANILLA,count:1}]},{name:'P2',entries:[{cardId:VANILLA,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0],
    players:[
      { ...s.players[0], hand:[], deck:[inst(VANILLA),inst(VANILLA)], discard:[], prizes:prize(6),
        bench:[inst(FROSMOTH)], active:inst(VANILLA) },
      { ...s.players[1], hand:[], deck:[inst(VANILLA),inst(VANILLA)], discard:[], prizes:prize(6),
        bench:[inst(ABILITY_POKE,{damage:60})], active:inst(VANILLA) },
    ] };
}
T('冰冷之帳 checkup KO 對手小木靈 → 該寶可夢被擊倒(進棄牌)', ()=>{
  const out=applyAction(mk(), { type:'END_TURN' }, pool);
  assert(!out.players[1].bench.some(b=>b.cardId===ABILITY_POKE),
    '備戰小木靈應被KO，實際 bench='+JSON.stringify(out.players[1].bench.map(b=>b.cardId)));
});
T('冰冷之帳 KO 對手 → 雪妖女owner(P0) 取得 1 張獎賞卡(6→5)〔核心bug〕', ()=>{
  const out=applyAction(mk(), { type:'END_TURN' }, pool);
  assert.equal(out.players[0].prizes.length, 5,
    'P0 應取1獎賞(6→5)，實際剩 '+out.players[0].prizes.length+' 張');
  assert.equal(out.players[0].hand.length, 1, 'P0 手牌應+1(取得的獎賞卡)，實際 '+out.players[0].hand.length);
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
