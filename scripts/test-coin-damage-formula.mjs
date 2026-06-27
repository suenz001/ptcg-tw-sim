// 守衛:擲硬幣傷害招式公式對照卡面(防倍率/基礎打錯)。強制全正面(Math.random=0)→確定性。
//   涵蓋「造成正面次數×M」(純N×M)、「增加正面次數×M」(base+N×M)、「擲1硬幣若正面+X」(base+X)。
//   排除「擲硬幣直到反面」(無上限/不確定)與依盤面條件的(本守衛只測純硬幣公式)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-cf.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-cf.ts'); const O=join(ROOT,'.ent-cf.mjs');
writeFileSync(E,`import './src/lib/game/engine';export { ATTACK_PRE } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const idx=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!idx.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);}}
const baseDmg=(d)=>{ if(d==null)return 0; const m=String(d).match(/(\d+)/); return m?parseInt(m[1]):0; };
const list=[]; const seen=new Set();
for(const c of byName.values())for(const a of (c.attacks||[])){
  const eff=a.effect||''; if(!/擲.*硬幣/.test(eff)) continue; if(/直到.*反面|一直擲/.test(eff)) continue;
  const k=`${c.name}|${a.name}`; if(seen.has(k))continue; let exp=null,m;
  if(m=eff.match(/擲(\d+)次硬幣.{0,6}造成正面出現的次數\s*×\s*(\d+)點/)) exp=parseInt(m[1])*parseInt(m[2]);
  else if(m=eff.match(/擲(\d+)次硬幣.{0,6}增加正面出現的次數\s*×\s*(\d+)點/)) exp=baseDmg(a.damage)+parseInt(m[1])*parseInt(m[2]);
  else if(m=eff.match(/擲1次硬幣.{0,6}(?:若為?正面|正面).{0,8}增加\s*(\d+)點/)) exp=baseDmg(a.damage)+parseInt(m[1]);
  if(exp==null) continue; seen.add(k); list.push({card:c,key:k,exp});
}
const orig=Math.random; Math.random=()=>0;
let iid=0;const inst=(cid,e={})=>({iid:`f${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0,fails=[];
for(const r of list){
  const fn=M.ATTACK_PRE.get(r.key);
  if(!fn){fails.push(`[未實裝] ${r.key} 期望${r.exp}`);fail++;continue;}
  const act=inst(r.card.id);
  const st={players:[{active:act,bench:[],hand:[],deck:[],discard:[],prizes:[]},{active:inst('12702'),bench:[],hand:[],deck:[],discard:[],prizes:[]}],log:[],activePlayerIndex:0};
  let got; try{ got=fn(st,0,pool).damage; }catch(e){fails.push(`[ERR] ${r.key}: ${e.message.slice(0,30)}`);fail++;continue;}
  if(got===r.exp) pass++; else {fails.push(`[不符] ${r.key} 全正面期望${r.exp} 實際${got}`);fail++;}
}
Math.random=orig;
console.log(`硬幣傷害公式守衛(全正面):${list.length} 招 PASS ${pass} / FAIL ${fail}`);
fails.forEach(x=>console.log('  '+x));
process.exit(fail?1:0);
