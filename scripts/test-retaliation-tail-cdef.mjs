// v5.980 HEAD-FAIL:受傷反擊尾巴 C(快掃拳返 anywhere 備戰被狙擊也反擊) + E(招式旗標型一擊KO仍觸發)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.xtd-s.js'),E=join(ROOT,'.xtd-e.ts'),O=join(ROOT,'.xtd-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { dealAttackDamageToTarget } from './src/lib/game/effects';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const byName=(n)=>{for(const[id,c]of pool)if(c.name===n)return id;throw new Error(n);};
const TUDU=byName('拖拖蚓ex'), METAL=byName('基本【鋼】能量'), ZAMA=byName('藏瑪然特');
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
const mk=(p0,p1,p1b)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'P0',active:p0,bench:[],hand:[],deck:[],discard:[],prizes:[]},{name:'P1',active:p1,bench:p1b||[],hand:[],deck:[],discard:[],prizes:[]}]});
let pass=0;

// C: 備戰拖拖蚓ex(附2鋼)被狙擊30 → 攻擊方+40(2鋼×2=4指示物)
{
  const tudu=inst(TUDU,{energyAttached:[en(METAL),en(METAL)]});
  const st=mk(inst(ZAMA),inst(ZAMA),[tudu]); // P1 備戰有拖拖蚓ex
  const after=mod.dealAttackDamageToTarget(st,0,tudu.iid,30,pool,{kind:'attack-damage',label:'狙擊'});
  const atkDmg=after.players[0].active.damage;
  assert.strictEqual(atkDmg,40,`備戰拖拖蚓ex被狙擊應反擊+40(2鋼×2),實得 ${atkDmg}`);
  console.log('  ✅ C 備戰拖拖蚓ex被狙擊→反擊+40(anywhere)'); pass++;
}
// E: 帶旗標(還擊斧8)的防守方被一擊KO → 攻擊方仍+80
{
  const zc=pool.get(String(ZAMA));
  const atkIdx=(zc.attacks||[]).findIndex(a=>a.name==='強大猛擊');
  assert.ok(atkIdx>=0,'找不到強大猛擊');
  // 防守方:低HP(damage=hp-10,剩10)+旗標8;攻擊方藏瑪然特強大猛擊70→KO
  const defHp=zc.hp?parseInt(zc.hp):190;
  const defender=inst(ZAMA,{damage:defHp-10,retaliateCountersOnNextHit:8});
  const attacker=inst(ZAMA,{energyAttached:[en(METAL),en(METAL),en(METAL)]}); // 付強大猛擊 cost[Metal,Metal,Colorless]
  const st=mk(attacker,defender);
  const after=mod.applyAction(st,{type:'ATTACK',attackIndex:atkIdx,actorIdx:0},pool);
  const p1ko=after.players[1].active===null||after.phase==='game-over';
  const atkDmg=after.players[0].active?after.players[0].active.damage:-1;
  assert.ok(p1ko,'防守方應被KO');
  assert.strictEqual(atkDmg,80,`旗標型防守方被一擊KO仍應反擊+80,實得 ${atkDmg}`);
  console.log('  ✅ E 旗標型(還擊斧8)被一擊KO→攻擊方仍+80'); pass++;
}
console.log(`\nPASS ${pass}/2 — retaliation-tail-cdef`);
