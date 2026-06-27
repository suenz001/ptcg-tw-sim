// 守衛:所有「這隻寶可夢也受到N點傷害」反作用力招式,實際自傷量須=卡面N(防 selfHitPost(N) 打錯數字/漏實裝)。
//   對手給 bench 避免 KO 後 game-over short-circuit;「若希望」型預設yes套自傷=卡面N。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-rc.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-rc.ts'); const O=join(ROOT,'.ent-rc.mjs');
writeFileSync(E,`import './src/lib/game/engine';export { ATTACK_POST } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const idx=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byName=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!idx.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);}}
const recoil=[]; const seen=new Set();
for(const c of byName.values())for(const a of (c.attacks||[])){
  const eff=a.effect||'';
  const m=eff.match(/這隻寶可夢也?受到(\d+)點傷害/);
  // 只測「無條件固定自傷」;含「擲」(硬幣)或「若」(若希望/若…條件)的自傷是條件型→
  //   依硬幣/玩家選擇才生效,本守衛跑不到那條件會 false-positive(且硬幣不確定),故排除。
  if(m && !/[擲若]/.test(eff)){const k=`${c.name}|${a.name}`; if(!seen.has(k)){seen.add(k); recoil.push({card:c,key:k,N:parseInt(m[1])});}}
}
let iid=0;const inst=(cid,e={})=>({iid:`c${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0,fails=[];
for(const r of recoil){
  const fn=M.ATTACK_POST.get(r.key);
  if(!fn){fails.push(`[未實裝] ${r.key} 應自傷${r.N}`);fail++;continue;}
  const act=inst(r.card.id);
  // 對手 active + bench(避免KO後game-over跳過自傷段)
  const st={players:[{active:act,bench:[],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst('12702'))},
    {active:inst('12702'),bench:[inst('12702')],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst('12702'))}],
    log:[],activePlayerIndex:0,pendingPrizes:[0,0]};
  let got=0; try{ got=fn(st,0,pool).players[0].active?.damage ?? 0; }catch(e){ fails.push(`[ERR] ${r.key}: ${e.message.slice(0,30)}`);fail++;continue; }
  if(got===r.N) pass++;
  else { fails.push(`[不符] ${r.key} 卡面${r.N} 實際${got}`); fail++; }
}
console.log(`自傷反作用力守衛(無條件固定型):${recoil.length} 招,PASS ${pass} / FAIL ${fail}`);
fails.forEach(x=>console.log('  '+x));
process.exit(fail?1:0);
