/** v5.843 莉佳的臭臭花|噴毒 直接中毒(卡面無擲幣) — 原誤用 coinStatusFn 需擲幣正面才中毒,
 *  且正確 key 版被尖括號 key(<莉佳的>臭臭花)死碼掩蓋。強制擲幣反面,仍應中毒。HEAD:反面→不中毒 FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sf-s.js'),E=join(ROOT,'.sf-e.ts'),O=join(ROOT,'.sf-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const ATK='14443', DEF='14443';
let nn=0; const inst=(cid)=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null});
const mk=()=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(ATK),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:inst(DEF),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});
const orig=Math.random;
const poisoned=(a)=>a.status==='poisoned'||a.secondaryStatus==='poisoned'||a.tertiaryStatus==='poisoned';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('★噴毒:擲幣反面 對手仍中毒(直接中毒,非擲幣)', () => {
  Math.random=()=>0.9; // 反面
  const out=ATTACK_POST.get('莉佳的臭臭花|噴毒')(mk(),0,pool);
  Math.random=orig;
  assert.ok(poisoned(out.players[1].active), '對手應中毒(卡面無擲幣)');
});
T('噴毒:key 正確存在(非尖括號)', () => {
  assert.ok(ATTACK_POST.has('莉佳的臭臭花|噴毒'), '正確 key 應存在');
  assert.ok(!ATTACK_POST.has('<莉佳的>臭臭花|噴毒'), '尖括號死碼 key 應已移除');
});
console.log('\n噴毒直接中毒(v5.843):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
