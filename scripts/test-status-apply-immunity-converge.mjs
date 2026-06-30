/** 施對手狀態收斂中央(gate 祭典會場/化隱等免疫) v5.797
 * 天蠍王|毒陣、火箭隊的尼多王ex|惡劣角擊、鴨嘴炎獸|灼燒 原手刻 secondaryStatus 繞過免疫。
 * 驗:對手 active 附能量 + 祭典會場在場 → 三招不應施加狀態(中央 applier 擋)。
 * HEAD:手刻直接寫 secondaryStatus → 仍中毒/灼傷 → FAIL。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.si-s.js'), E = join(ROOT,'.si-e.ts'), O = join(ROOT,'.si-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const GRASS='14102', POKE='14443', FESTIVAL='10513';
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// 對手 active 附 1 能量(祭典會場條件) + 祭典會場在場
const mk=()=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  activeStadium: inst(FESTIVAL),
  players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:inst(POKE,{energyAttached:[inst(GRASS)]}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});
const oppStatuses = (st) => { const a=st.players[1].active; return [a.status,a.secondaryStatus,a.tertiaryStatus].filter(Boolean); };

T('★天蠍王|毒陣:祭典會場下對手不中毒', () => {
  const out=ATTACK_POST.get('天蠍王|毒陣')(mk(),0,pool);
  assert.deepEqual(oppStatuses(out), [], `不應施加狀態,實得 ${JSON.stringify(oppStatuses(out))}`);
});
T('★火箭隊的尼多王ex|惡劣角擊:祭典會場下對手不中毒', () => {
  const out=ATTACK_POST.get('火箭隊的尼多王ex|惡劣角擊')(mk(),0,pool);
  assert.deepEqual(oppStatuses(out), [], `不應施加狀態,實得 ${JSON.stringify(oppStatuses(out))}`);
});
T('★鴨嘴炎獸|灼燒(強制正面):祭典會場下對手不灼傷', () => {
  const _r=Math.random; Math.random=()=>0; // 正面
  try { const out=ATTACK_POST.get('鴨嘴炎獸|灼燒')(mk(),0,pool);
    assert.deepEqual(oppStatuses(out), [], `不應施加狀態,實得 ${JSON.stringify(oppStatuses(out))}`);
  } finally { Math.random=_r; }
});
// 對照:無祭典會場時應正常施加(確保沒誤殺)
T('對照:無免疫時天蠍王毒陣正常中毒', () => {
  const st=mk(); st.activeStadium=null;
  const out=ATTACK_POST.get('天蠍王|毒陣')(st,0,pool);
  assert.ok(oppStatuses(out).includes('poisoned'), `應中毒,實得 ${JSON.stringify(oppStatuses(out))}`);
});
console.log('\n施狀態免疫收斂(v5.797):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
