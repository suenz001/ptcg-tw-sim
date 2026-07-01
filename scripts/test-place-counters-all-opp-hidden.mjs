/** v5.820 放置傷害指示物(applyDamageToAllOpp:由克希痛楚記憶/伊裴爾塔爾侵蝕之風)對化隱免疫。
 *  化隱寶可夢(招式效果免疫)不被放置指示物;戰鬥位與備戰位皆須擋(先前 active 漏)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.pc-s.js'),E=join(ROOT,'.pc-e.ts'),O=join(ROOT,'.pc-o.mjs');
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
const POKE='14443', HID='19149'/*斯魔茶 化隱*/, LAP='14085';
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('★痛楚記憶:化隱在戰鬥位不被放指示物、一般備戰被放', () => {
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(POKE,{iid:'atk'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(HID,{iid:'hidAct'}),bench:[inst(LAP,{iid:'nb'})],hand:[],deck:[],discard:[],prizes:[1]}]};
  const r=ATTACK_POST.get('由克希|痛楚記憶')(st,0,pool,{});
  assert.strictEqual(r.players[1].active.damage,0,'化隱戰鬥位不應被放指示物');
  assert.strictEqual(r.players[1].bench.find(b=>b.iid==='nb').damage,20,'一般備戰應被放20');
});
T('★痛楚記憶:一般戰鬥位正常被放20(對照)', () => {
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(POKE,{iid:'atk'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(LAP,{iid:'na'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]};
  const r=ATTACK_POST.get('由克希|痛楚記憶')(st,0,pool,{});
  assert.strictEqual(r.players[1].active.damage,20,'一般戰鬥位應被放20');
});
console.log('\n放置指示物化隱免疫(v5.820):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
