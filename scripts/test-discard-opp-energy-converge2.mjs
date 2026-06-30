/** v5.801 重複helper收斂:v2500本地版刪除+鴨寶寶消火typed host-aware
 *  ① 浮潛鼬|潮旋(v2500表格):2能量→開picker(HEAD用本地auto-pick版,無pending)
 *  ② 鴨寶寶|消火:對手只附古舊能量→可丟(host-aware,古舊視為火);HEAD靜態漏古舊→"無火能量可棄"
 *  ③ 鴨寶寶|消火:基本火+古舊→2候選開picker(HEAD只認基本火) */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.d2-s.js'),E=join(ROOT,'.d2-e.ts'),O=join(ROOT,'.d2-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='14443', FIRE='14428', WATER='18519', ANCIENT='17212';
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const mk=(oppE)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:inst(POKE,{energyAttached:oppE}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});

T('★浮潛鼬|潮旋(v2500):對手2能量→開picker(HEAD本地auto-pick無pending)', () => {
  const out=ATTACK_POST.get('浮潛鼬|潮旋')(mk([inst(FIRE),inst(WATER)]),0,pool);
  assert.ok(out.pendingSelection,'應開picker');
  assert.equal(out.pendingSelection.effectKey,'discard-opp-active-energy-pick');
});
T('★鴨寶寶|消火:對手只附古舊能量→可丟(host-aware視為火)', () => {
  const a=inst(ANCIENT);
  const out=ATTACK_POST.get('鴨寶寶|消火')(mk([a]),0,pool);
  assert.equal(out.players[1].active.energyAttached.length,0,'古舊應被丟(視為火);HEAD靜態漏→不丟');
  assert.ok(out.players[1].discard.some(c=>c.cardId===ANCIENT),'古舊進棄牌');
});
T('★鴨寶寶|消火:基本火+古舊→2候選開picker(host-aware)', () => {
  const out=ATTACK_POST.get('鴨寶寶|消火')(mk([inst(FIRE),inst(ANCIENT)]),0,pool);
  assert.ok(out.pendingSelection,'2火候選(基本火+古舊)應開picker');
  assert.equal(out.pendingSelection.params.validIids.length,2,'兩張都該是候選');
});
T('鴨寶寶|消火:基本火+水→只1火候選直接丟火(留水)', () => {
  const out=ATTACK_POST.get('鴨寶寶|消火')(mk([inst(FIRE),inst(WATER)]),0,pool);
  assert.ok(!out.pendingSelection,'1火候選不開picker');
  const left=out.players[1].active.energyAttached.map(e=>e.cardId);
  assert.deepEqual(left,[WATER],`應只剩水,實得${JSON.stringify(left)}`);
});
console.log('\n重複helper收斂+typed host-aware(v5.801):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
