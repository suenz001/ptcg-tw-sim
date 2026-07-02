/** v5.848 自動選目標→picker:貫通鑽(選受傷對手備戰)、龍之猛暴(選龍寶可夢附火能量) */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.tp-s.js'),E=join(ROOT,'.tp-e.ts'),O=join(ROOT,'.tp-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map(); let fireE=null, anyPoke=null;
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id!=null){pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);if(!fireE&&c.supertype==='Energy'&&c.subtype==='Basic'&&(c.pokemonType==='Fire'||/【火】/.test(c.name||'')))fireE=String(c.id);if(!anyPoke&&(c.supertype==='Pokémon'||c.supertype==='Pokemon'))anyPoke=String(c.id);}}}
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('★貫通鑽:2隻受傷選 w2 → w2 受60(w1不動)', () => {
  const drill=byName.get('龍頭地鼠ex'); assert.ok(drill);
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:{iid:'A',cardId:String(drill.id),damage:0,energyAttached:[]},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
             {name:'P2',active:{iid:'B',cardId:anyPoke,damage:0,energyAttached:[]},bench:[{iid:'w1',cardId:anyPoke,damage:10,energyAttached:[]},{iid:'w2',cardId:anyPoke,damage:20,energyAttached:[]}],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]};
  st=ATTACK_POST.get('龍頭地鼠ex|貫通鑽')(st,0,pool,{})||st;
  assert.ok(st.pendingSelection && st.pendingSelection.type==='opp-bench-choose', `應開 opp-bench-choose,實 ${st.pendingSelection&&st.pendingSelection.type}`);
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['w2']},pool);
  const bn=st.players[1].bench;
  assert.equal(bn.find(b=>b.iid==='w2').damage,80,`w2 應80,實 ${bn.find(b=>b.iid==='w2').damage}`);
  assert.equal(bn.find(b=>b.iid==='w1').damage,10,`w1 應10不動`);
});
T('★龍之猛暴:2隻龍選備戰龍 d2 → d2 附火能量', () => {
  const rd=byName.get('赤面龍'); assert.ok(rd && pool.get(String(rd.id)).pokemonType==='Dragon');
  let st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:{iid:'A',cardId:String(rd.id),damage:0,energyAttached:[]},bench:[{iid:'d2',cardId:String(rd.id),damage:0,energyAttached:[]}],hand:[],deck:[],discard:[{cardId:fireE,iid:'fE'}],prizes:[1,1,1,1,1,1]},
             {name:'P2',active:{iid:'B',cardId:anyPoke,damage:0,energyAttached:[]},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]};
  st=ATTACK_POST.get('赤面龍|龍之猛暴')(st,0,pool,{})||st;
  assert.ok(st.pendingSelection && st.pendingSelection.type==='heal-target', `應開 heal-target,實 ${st.pendingSelection&&st.pendingSelection.type}`);
  st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:['d2']},pool);
  const d2=st.players[0].bench.find(b=>b.iid==='d2');
  assert.equal(d2.energyAttached.length,1,`d2 應附1火能量,實 ${d2.energyAttached.length}`);
  assert.equal(st.players[0].active.energyAttached.length,0,`戰鬥場不應被附(玩家選d2)`);
});
console.log('\n自動選目標→picker(v5.848):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
