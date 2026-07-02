/** v5.845 移動自身能量放回手牌改 picker — 狡猾天狗/古劍豹能量閉環、逆火、裹蜜蟲
 *  原 returnSelfActiveEnergyPost toHand / selfReturnNTypeEnergyToHandPost 自動取末端。
 *  多能量時玩家選要放回哪個,應放選的、留其餘。HEAD 自動取末端 → 放錯 FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.rh-s.js'),E=join(ROOT,'.rh-e.ts'),O=join(ROOT,'.rh-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map(); let basic={};
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id!=null){pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);if(c.supertype==='Energy'&&c.subtype==='Basic'){const t=(c.name.match(/【(.)】/)||[])[1];if(t&&!basic[t])basic[t]=String(c.id);}}}}
const en=(iid,cid)=>({cardId:cid,iid});
function mk(cardName,es){const card=byName.get(cardName);return{phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:{iid:'A',cardId:String(card.id),damage:0,status:null,energyAttached:es},bench:[{iid:'BN',cardId:String(card.id),damage:0,energyAttached:[]}],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
           {name:'P2',active:{iid:'B',cardId:String(card.id),damage:0,energyAttached:[]},bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]};}
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function pickHand(key,cardName,es,pick){
  let st=mk(cardName,es);
  st=ATTACK_POST.get(key)(st,0,pool,{})||st;
  if(st.pendingSelection){ st=applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:pick},pool); }
  return {rem:st.players[0].active.energyAttached.map(e=>e.iid).sort(), hand:st.players[0].hand.map(e=>e.iid).sort()};
}
const C=basic['雷']||basic['水']||Object.values(basic)[0];
T('★狡猾天狗|能量閉環:選 e1 放回 → 留 e2,e3', () => {
  const {rem,hand}=pickHand('狡猾天狗|能量閉環','狡猾天狗',[en('e1',C),en('e2',C),en('e3',C)],['e1']);
  assert.deepEqual(rem,['e2','e3'],`留 ${rem}`); assert.ok(hand.includes('e1'),`手牌 ${hand}`);
});
T('★波爾凱尼恩|逆火:3火選 e1,e2 放回 → 留 e3', () => {
  const F=basic['火']; const {rem}=pickHand('波爾凱尼恩|逆火','波爾凱尼恩',[en('e1',F),en('e2',F),en('e3',F)],['e1','e2']);
  assert.deepEqual(rem,['e3'],`留 ${rem}`);
});
console.log('\n移能量放回手牌 picker(v5.845):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
