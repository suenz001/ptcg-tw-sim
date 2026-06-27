// 卡面「下個自己回合無法使用『X』」(特定招式)=只擋該招,多招式寶可夢下回合仍能用其他招。
//   4 張多招式卡(炎熱喵/閃焰王牌ex/自爆磁怪電磁炮/雙劍鞘)誤用 selfCantAttackNextPost(全擋cantAttackPending)
//   →誤鎖其他招。應 selfBlockSpecificAttackNextPost(只設 blockedAttackNamesNextTurn:[該招])。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-sr.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-sr.ts'); const O=join(ROOT,'.ent-sr.mjs');
writeFileSync(E,`import './src/lib/game/engine';export { ATTACK_POST } from './src/lib/game/effects/_shared';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const idx=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const byName=new Map(); const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!idx.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id==null)continue;pool.set(String(c.id),c);if(!byName.has(c.name))byName.set(c.name,c);}}
let iid=0;const inst=(cid,e={})=>({iid:`r${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function runPost(nm,atk){
  const card=byName.get(nm); const fn=M.ATTACK_POST.get(`${nm}|${atk}`);
  const act=inst(card.id);
  const st={players:[{active:act,bench:[],hand:[],deck:[],discard:[],prizes:[]},{active:inst('12702'),bench:[],hand:[],deck:[],discard:[],prizes:[]}],log:[],activePlayerIndex:0};
  return fn(st,0,pool).players[0].active;
}
// 4 個應特定擋:不可設 cantAttackPending,應 blockedAttackNamesNextTurn=[該招]
for(const [nm,atk] of [['炎熱喵','閃焰強襲'],['自爆磁怪','電磁炮'],['閃焰王牌ex','閃焰強襲'],['雙劍鞘','猛擊在地']]){
  T(`${nm}|${atk} 只擋該招(非全擋)`,()=>{
    const a=runPost(nm,atk);
    assert.ok(!a.cantAttackPending, '不應全擋cantAttackPending(會誤鎖其他招)');
    assert.deepEqual(a.blockedAttackNamesNextTurn,[atk], `應只擋[${atk}],實際=`+JSON.stringify(a.blockedAttackNamesNextTurn));
  });
}
// 對照:卡面「無法使用招式」(全部)應維持全擋
T('對照 瑪力露麗|力量衝撞(卡面全部) → 維持全擋cantAttackPending',()=>{
  const a=runPost('瑪力露麗','力量衝撞');
  assert.ok(a.cantAttackPending, '卡面「無法使用招式」應全擋');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
