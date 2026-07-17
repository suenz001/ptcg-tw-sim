// v5.979 HEAD-FAIL:受傷反擊 payload ① 強大猛擊 9999→mirror(放與實際受傷相同數值,非99990必死)
//   ② 毒刺/灼熱之軀 走中央三槽(攻擊方已有其他狀態仍中毒/灼傷)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.xrt-s.js'),E=join(ROOT,'.xrt-e.ts'),O=join(ROOT,'.xrt-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { ATTACK_POST, fireDefenderOnDamaged, PASSIVE_RETALIATION } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const byName=(n)=>{for(const[id,c]of pool)if(c.name===n)return id;throw new Error('找不到:'+n);};
const ZAMA=byName('藏瑪然特'), ROSE=byName('毒薔薇');
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
const mk=(p0,p1)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'P0',active:p0,bench:[],hand:[],deck:[],discard:[],prizes:[]},{name:'P1',active:p1,bench:[],hand:[],deck:[],discard:[],prizes:[]}]});
let pass=0;

// ① 強大猛擊:藏瑪然特設旗標後被打120 → 攻擊方 +120(mirror),非 99990
{
  let st=mk(inst(ZAMA),inst(ROSE)); // 藏瑪然特 aIdx=0 用強大猛擊設旗標
  st=mod.ATTACK_POST.get('藏瑪然特|強大猛擊')(st,0,pool,{});
  // 現在 players[0]=藏瑪然特(帶旗標)當防守方,players[1]=攻擊方打它 120
  const after=mod.fireDefenderOnDamaged(st,0,1,120,pool);
  const logStr=(after.log||[]).map(l=>typeof l==='string'?l:(l.message||l.text||'')).join('\n');
  assert.ok(logStr.includes('12 個傷害指示物（120 點傷害）'),`強大猛擊 mirror 受傷120應放12指示物(120傷),實得 log:\n${logStr.split('\n').slice(-3).join(' | ')}`);
  assert.ok(!logStr.includes('99990'),'不應出現 99990(9999哨兵 bug)');
  console.log('  ✅ ① 強大猛擊 mirror→放12指示物(120傷,非99990)'); pass++;
}
// ② 毒刺:攻擊方已【混亂】仍應中毒(三槽共存)
{
  const st=mk(inst(ROSE),inst(ZAMA,{status:'confused'})); // 毒刺 holder=P0, 攻擊方=P1 已混亂
  const after=mod.PASSIVE_RETALIATION.get('毒刺')(st,0,pool);
  const a=after.players[1].active;
  const slots=[a.status,a.secondaryStatus,a.tertiaryStatus];
  assert.ok(slots.includes('confused'),'原混亂應保留');
  assert.ok(slots.includes('poisoned'),`攻擊方已有狀態仍應中毒,實得槽 ${JSON.stringify(slots)}`);
  console.log('  ✅ ② 毒刺→攻擊方已混亂仍中毒(三槽共存)'); pass++;
}
// ③ 灼熱之軀同理
{
  const SIDO=byName('席多藍恩');
  const st=mk(inst(SIDO),inst(ZAMA,{status:'asleep'}));
  const after=mod.PASSIVE_RETALIATION.get('灼熱之軀')(st,0,pool);
  const a=after.players[1].active;
  const slots=[a.status,a.secondaryStatus,a.tertiaryStatus];
  assert.ok(slots.includes('asleep')&&slots.includes('burned'),`已睡眠仍應灼傷,實得 ${JSON.stringify(slots)}`);
  console.log('  ✅ ③ 灼熱之軀→已睡眠仍灼傷(三槽共存)'); pass++;
}
console.log(`\nPASS ${pass}/3 — retaliation-payload-converge`);
