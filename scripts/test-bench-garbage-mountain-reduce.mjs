/** v5.817 灰塵山|垃圾洩氣(場上有灰塵山+攻擊者附道具→-20)備戰也套用(先前只戰鬥位)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.gm-s.js'),E=join(ROOT,'.gm-e.ts'),O=join(ROOT,'.gm-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { dealAttackDamageToTarget } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { dealAttackDamageToTarget }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const ATK='14443', NONMETAL='14085'/*拉普拉斯ex HP210*/, GARBAGE='18475', TOOL='14467'/*氣球 PokemonTool*/;
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// defender(P2) 持灰塵山 + 攻擊者(P1 active)附道具,狙擊 P2 備戰
const run=(atkHasTool, defHasGarbage)=>{
  const atk=inst(ATK,{iid:'atk', toolAttached: atkHasTool ? inst(TOOL) : undefined});
  const benchT=inst(NONMETAL,{iid:'bt'});
  const defBench=[benchT];
  if (defHasGarbage) defBench.push(inst(GARBAGE,{iid:'gm'}));
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:atk,bench:[],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(NONMETAL,{iid:'oppAct'}),bench:defBench,hand:[],deck:[],discard:[],prizes:[1]}]};
  const r=dealAttackDamageToTarget(st,0,'bt',50,pool,{kind:'attack-damage',label:'狙擊',noWeakness:true});
  return r.players[1].bench.find(b=>b.iid==='bt')?.damage ?? -1;
};
T('★灰塵山在場+攻擊者附道具:備戰受50→-20=30', () => assert.strictEqual(run(true,true),30));
T('★攻擊者無道具:備戰受50(不減,對照)', () => assert.strictEqual(run(false,true),50));
T('★無灰塵山:備戰受50(不減,對照)', () => assert.strictEqual(run(true,false),50));
console.log('\nbench垃圾洩氣(v5.817):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
