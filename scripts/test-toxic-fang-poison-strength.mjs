/** v5.819 叉字蝠|劇毒牙:中毒指示物改為2個=每次檢查20傷害(先前用普通中毒10)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.tf-s.js'),E=join(ROOT,'.tf-e.ts'),O=join(ROOT,'.tf-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const POKE='14443', LAP='14085';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('★劇毒牙:對手中毒 + poisonDamagePerCheckup=20', () => {
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(POKE,{iid:'atk'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(LAP,{iid:'def'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
  const r=ATTACK_POST.get('叉字蝠|劇毒牙')(st,0,pool,{});
  const d=r.players[1].active;
  assert.strictEqual(d.status,'poisoned','應中毒');
  assert.strictEqual(d.poisonDamagePerCheckup,20,`每次檢查應20,實際${d.poisonDamagePerCheckup}`);
});
console.log('\n劇毒牙變強中毒(v5.819):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
