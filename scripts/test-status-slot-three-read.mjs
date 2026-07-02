/** v5.842 讀傷害狀態(灼傷)跨三槽 — 焦黑吐息/火神蛾原只讀 status 主格漏 secondary/tertiary。
 *  焚焰蚣|焦黑吐息:對手灼傷則 180 否則失敗。灼傷在 tertiary(睡眠+中毒+灼傷)時,HEAD 讀主格→誤判失敗(0)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.ss-s.js'),E=join(ROOT,'.ss-e.ts'),O=join(ROOT,'.ss-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_PRE }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const ATK='14443', DEF='14443';
let nn=0; const inst=(cid,st={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[{cardId:'e',iid:'e'+nn}],status:null,secondaryStatus:null,tertiaryStatus:null,...st});
const mk=(defStatus)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(ATK),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:inst(DEF,defStatus),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const dmg=(defStatus)=>ATTACK_PRE.get('焚焰蚣|焦黑吐息')(mk(defStatus),0,pool).damage;
T('焦黑吐息:灼傷在主格 → 180', () => assert.equal(dmg({status:'burned'}), 180));
T('★焦黑吐息:灼傷在 secondary → 180(原漏)', () => assert.equal(dmg({status:'asleep',secondaryStatus:'burned'}), 180));
T('★焦黑吐息:灼傷在 tertiary → 180(原漏)', () => assert.equal(dmg({status:'asleep',secondaryStatus:'poisoned',tertiaryStatus:'burned'}), 180));
T('焦黑吐息:未灼傷 → 0(招式失敗)', () => assert.equal(dmg({status:'poisoned'}), 0));
console.log('\n讀傷害狀態跨三槽(v5.842):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
