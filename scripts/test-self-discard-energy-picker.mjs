/** v5.844 丟棄自身 N 能量改 picker(玩家選丟哪些) — 炎獄狂爆Y/羽毛強襲/烏鴉頭頭狙擊羽毛
 *  原用 discardActiveEnergy/slice(-N) 自動取末端 → 收斂 SELF_DISCARD_UNITS_BATCH picker。
 *  玩家選前 N 個能量,應丟選的、留末端。HEAD 版自動丟末端 → 留的不對 FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sd-s.js'),E=join(ROOT,'.sd-e.ts'),O=join(ROOT,'.sd-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_PRE }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map(); let basicE=null;
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id!=null){pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);if(!basicE&&c.supertype==='Energy'&&c.subtype==='Basic')basicE=String(c.id);}}}
let nn=0; const en=(iid)=>({cardId:basicE,iid});
const mk=(cardName,eIids)=>{const card=byName.get(cardName);return{card,state:{phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:{iid:'A',cardId:String(card.id),damage:0,status:null,energyAttached:eIids.map(en)},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
           {name:'P2',active:{iid:'B',cardId:String(card.id),damage:0,status:null,energyAttached:[]},bench:[{iid:'BB',cardId:String(card.id),damage:0,energyAttached:[]}],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]}};};
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function remainAfter(cardName, eIids, pick){
  const {state}=mk(cardName,eIids);
  const r=ATTACK_PRE.get(`${cardName}|${state.players[0].active&&''}`); // dummy
  return null;
}
function run(key, cardName, eIids, pick){
  const {state}=mk(cardName,eIids);
  const r=ATTACK_PRE.get(key)(state,0,pool,{discardedEnergyIids:pick});
  const rem=(r.state||state).players[0].active.energyAttached.map(e=>e.iid).sort();
  return {rem, dmg:r.damage};
}
T('★羽毛強襲:選 e1,e2 丟 → 留 e3(非末端;主傷害150)', () => {
  const {rem,dmg}=run('青木的姆克鷹|羽毛強襲','青木的姆克鷹',['e1','e2','e3'],['e1','e2']);
  assert.deepEqual(rem, ['e3'], `應留 e3,實留 ${rem}`);
  assert.equal(dmg, 150, `主傷害應150,實 ${dmg}`);
});
T('★烏鴉頭頭狙擊羽毛:選 e1,e2 丟 → 留 e3', () => {
  const {rem}=run('烏鴉頭頭|狙擊羽毛','烏鴉頭頭',['e1','e2','e3'],['e1','e2']);
  assert.deepEqual(rem, ['e3'], `應留 e3,實留 ${rem}`);
});
T('★炎獄狂爆Y:選 e1,e2,e3 丟 → 留 e4', () => {
  const {rem}=run('超級噴火龍Yex|炎獄狂爆Y','超級噴火龍Yex',['e1','e2','e3','e4'],['e1','e2','e3']);
  assert.deepEqual(rem, ['e4'], `應留 e4,實留 ${rem}`);
});
console.log('\n丟自身能量 picker(v5.844):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
