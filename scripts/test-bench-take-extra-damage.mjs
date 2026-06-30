/** v5.816 備戰寶可夢帶 takeExtraDamageThisTurn(受招式傷害+N)被狙擊也要 +N。
 *  先前 bench 路徑漏(engine block A 只讀 active)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.bx-s.js'),E=join(ROOT,'.bx-e.ts'),O=join(ROOT,'.bx-o.mjs');
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
const ATK='14443', NONMETAL='14085'/*拉普拉斯ex HP210*/, METAL='14004'/*帝牙盧卡*/;
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const dmgTo=(benchInst, defFlags)=>{
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(ATK,{iid:'atk'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(NONMETAL,{iid:'oppAct'}),bench:[benchInst],hand:[],deck:[],discard:[],prizes:[1],...defFlags}]};
  const r=dealAttackDamageToTarget(st,0,benchInst.iid,50,pool,{kind:'attack-damage',label:'狙擊',noWeakness:true});
  return r.players[1].bench.find(b=>b.iid===benchInst.iid)?.damage ?? -1;
};
T('★備戰帶 takeExtra+100 受50→150', () => {
  const d=dmgTo(inst(NONMETAL,{iid:'b1',takeExtraDamageThisTurn:100}), {});
  assert.strictEqual(d,150,`應150(50+100),實際${d}`);
});
T('★無 takeExtra 備戰受50→50(對照)', () => {
  const d=dmgTo(inst(NONMETAL,{iid:'b2'}), {});
  assert.strictEqual(d,50,`應50,實際${d}`);
});
T('★takeExtra 與鐵之防禦同存:鋼備戰 50 -30 +100 =120', () => {
  const d=dmgTo(inst(METAL,{iid:'b3',takeExtraDamageThisTurn:100}), {metalShieldThisTurn:1});
  assert.strictEqual(d,120,`應120(50-30+100),實際${d}`);
});
console.log('\nbench受傷+N(v5.816):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
