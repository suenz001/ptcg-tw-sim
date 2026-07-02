/** v5.849 泡沫栗鼠|掃除 選對手道具改 picker(原自動選前2) — 卡面「選擇最多2張對手道具丟棄」。
 *  玩家選 t2,t3 應丟 t2,t3、留 t1。化隱對手道具不列 options。HEAD 自動丟前2不開 picker FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sc-s.js'),E=join(ROOT,'.sc-e.ts'),O=join(ROOT,'.sc-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map(); let anyPoke=null;
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id!=null){pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);if(!anyPoke&&(c.supertype==='Pokémon'||c.supertype==='Pokemon')&&!/ex$/.test(c.name))anyPoke=String(c.id);}}}
const tool=(iid)=>({cardId:'tool99',iid});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function mk(oppActiveCid){const sc=byName.get('泡沫栗鼠');return{phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:{iid:'A',cardId:String(sc.id),damage:0,energyAttached:[]},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
    {name:'P2',active:{iid:'B',cardId:oppActiveCid,damage:0,energyAttached:[],toolAttached:tool('t1')},
      bench:[{iid:'b2',cardId:anyPoke,damage:0,energyAttached:[],toolAttached:tool('t2')},{iid:'b3',cardId:anyPoke,damage:0,energyAttached:[],toolAttached:tool('t3')}],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]};}
T('★掃除:選 t2,t3 → 丟 t2,t3、留 t1', () => {
  let st=mk(anyPoke);
  st=ATTACK_POST.get('泡沫栗鼠|掃除')(st,0,pool,{})||st;
  assert.ok(st.pendingSelection && st.pendingSelection.type==='modal-choice', `應開 modal-choice,實 ${st.pendingSelection&&st.pendingSelection.type}`);
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['1:b2:t2']},pool);
  assert.ok(st.pendingSelection && st.pendingSelection.effectKey==='scavenge-tool-pick', `應開第2張,實 ${st.pendingSelection&&st.pendingSelection.effectKey}`);
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['1:b3:t3']},pool);
  const p1=st.players[1];
  assert.ok(p1.active.toolAttached && p1.active.toolAttached.iid==='t1', `active t1 應留`);
  assert.ok(!p1.bench[0].toolAttached, `b2 道具應丟`);
  assert.ok(!p1.bench[1].toolAttached, `b3 道具應丟`);
  const disc=p1.discard.map(c=>c.iid).sort();
  assert.deepEqual(disc,['t2','t3'],`棄牌應 t2,t3,實 ${disc}`);
});
T('★掃除:化隱對手 active 道具不列 options(免疫)', () => {
  let st=mk('19149'); // 斯魔茶 化隱
  st=ATTACK_POST.get('泡沫栗鼠|掃除')(st,0,pool,{})||st;
  // active(化隱)的 t1 不應在 options;只有 b2,b3
  const opts=st.pendingSelection.params.options.map(o=>o.id);
  assert.ok(!opts.some(o=>o.includes(':A:')), `化隱 active 道具不應列,實 ${opts}`);
  assert.ok(opts.some(o=>o.includes('t2'))&&opts.some(o=>o.includes('t3')), `b2,b3 道具應列`);
});
console.log('\n掃除選道具 picker(v5.849):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
