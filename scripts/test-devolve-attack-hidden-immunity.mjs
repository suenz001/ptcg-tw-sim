/** v5.808 招式退化受化隱免疫(奧密之眼/退化光線/阿賽斯特萊石);奇異時鐘物品卡不擋(不測)。
 *  化隱進化寶可夢(來悲粗茶 Stage1)不應被招式退化。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.dh-s.js'),E=join(ROOT,'.dh-e.ts'),O=join(ROOT,'.dh-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='14443', SUMACHA='19149'/*斯魔茶Basic化隱*/, LAIBI='19150'/*來悲粗茶Stage1化隱*/;
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// 對手 active = 化隱進化(來悲粗茶 Stage1, stack=[斯魔茶])
const hiddenEvo=()=>({ iid:'oppAct', cardId:LAIBI, damage:0, energyAttached:[], evolvedFromStack:[{iid:'oppBase',cardId:SUMACHA,damage:0,energyAttached:[]}] });
const mk=()=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,activeStadium:null,
  players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:hiddenEvo(),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});

T('★退化光線:化隱進化寶可夢不被退化', () => {
  const out=ATTACK_POST.get('念力土偶|退化光線')(mk(),0,pool);
  assert.equal(out.players[1].active.cardId, LAIBI, `化隱應免疫退化(留來悲粗茶),實得 ${out.players[1].active.cardId}`);
});
T('★阿賽斯特萊石:化隱進化寶可夢不被退化', () => {
  const out=ATTACK_POST.get('太陽伊布ex|阿賽斯特萊石')(mk(),0,pool);
  assert.equal(out.players[1].active.cardId, LAIBI, `化隱應免疫退化,實得 ${out.players[1].active.cardId}`);
});
T('★奧密之眼:化隱進化寶可夢不被退化(選到也擋)', () => {
  let st=ATTACK_POST.get('超能豔鴕|奧密之眼')(mk(),0,pool);
  if(st.pendingSelection) st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['oppAct']},pool);
  assert.equal(st.players[1].active.cardId, LAIBI, `化隱應免疫退化,實得 ${st.players[1].active.cardId}`);
});
console.log('\n招式退化化隱免疫(v5.808):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
