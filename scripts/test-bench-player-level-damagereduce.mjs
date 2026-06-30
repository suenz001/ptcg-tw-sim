/** v5.815 玩家層級「對手回合」減傷(鐵之防禦強化/阿蜜的目光)也套到備戰寶可夢。
 *  先前 bench 走 _applyBenchAbilityReduce 漏 metalShieldThisTurn/flatDamageReduceThisTurn。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.bp-s.js'),E=join(ROOT,'.bp-e.ts'),O=join(ROOT,'.bp-o.mjs');
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
const ATK='14443'/*含羞苞 attacker*/, METAL='14004'/*帝牙盧卡 鋼 basic*/, NONMETAL='14085'/*拉普拉斯ex 水 HP210*/;
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// defender(player1) 持玩家層級旗標; attacker=player0 snipe bench
const dmgTo=(benchInst, defFlags)=>{
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(ATK,{iid:'atk'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(NONMETAL,{iid:'oppAct'}),bench:[benchInst],hand:[],deck:[],discard:[],prizes:[1],...defFlags}]};
  const r=dealAttackDamageToTarget(st,0,benchInst.iid,50,pool,{kind:'attack-damage',label:'狙擊',noWeakness:true});
  return r.players[1].bench.find(b=>b.iid===benchInst.iid)?.damage ?? 0;
};
T('★鐵之防禦強化:備戰【鋼】受50→-30=20', () => {
  const d=dmgTo(inst(METAL,{iid:'mb'}), {metalShieldThisTurn:1});
  assert.strictEqual(d,20,`應為20(50-30),實際${d}`);
});
T('★鐵之防禦強化 2張:備戰【鋼】受50→-60=0', () => {
  const d=dmgTo(inst(METAL,{iid:'mb2'}), {metalShieldThisTurn:2});
  assert.strictEqual(d,0,`應為0(50-60 clamp),實際${d}`);
});
T('★鐵之防禦強化:非鋼備戰不減傷(受50)', () => {
  const d=dmgTo(inst(NONMETAL,{iid:'gb'}), {metalShieldThisTurn:1});
  assert.strictEqual(d,50,`非鋼不應減,實際${d}`);
});
T('★阿蜜的目光:任意備戰受50→-30=20', () => {
  const d=dmgTo(inst(NONMETAL,{iid:'gb2'}), {flatDamageReduceThisTurn:30});
  assert.strictEqual(d,20,`應為20(50-30),實際${d}`);
});
console.log('\nbench玩家層級減傷(v5.815):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
