/** v5.807 奧密之眼(退化對手)對齊中央退化模式:保留場上iid + clearActiveEffects(§II-C-13)
 *  HEAD:改 iid 為 newTop.iid + 保留狀態/效果(漏 clearActiveEffects)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.dv-s.js'),E=join(ROOT,'.dv-e.ts'),O=join(ROOT,'.dv-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='14443', YOMAWARU='14732', SAMAYOURU='14733'/*彷徨夜靈 Stage1*/;
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★奧密之眼退化對手:保留場上iid + 清除特殊狀態(中毒)', () => {
  // 對手 active = 彷徨夜靈(Stage1) iid=oppAct, 中毒 + 30傷, evolvedFromStack=[夜巡靈裸]
  const base={ iid:'oppBase', cardId:YOMAWARU, damage:0, energyAttached:[] };
  const oppAct={ iid:'oppAct', cardId:SAMAYOURU, damage:30, status:'poisoned', energyAttached:[], evolvedFromStack:[base] };
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,activeStadium:null,
    players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:oppAct,bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
  st=ATTACK_POST.get('超能豔鴕|奧密之眼')(st,0,pool);
  assert.ok(st.pendingSelection,'應開 picker');
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['oppAct']},pool);
  const a=st.players[1].active;
  assert.equal(a.cardId, YOMAWARU, '應退化成夜巡靈');
  assert.equal(a.iid, 'oppAct', `應保留場上 iid 'oppAct'(同退化光線),HEAD 改成 base iid 'oppBase'`);
  assert.ok(!a.status, `退化應清除中毒(§II-C-13),HEAD 殘留 status=${a.status}`);
  assert.equal(a.damage, 30, '退化保留傷害指示物');
});
console.log('\n退化對手清效果+穩定iid(v5.807):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
