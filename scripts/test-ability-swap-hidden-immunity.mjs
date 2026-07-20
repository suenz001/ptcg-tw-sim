// v5.839 驗證:特性換對手位置(gust/force)須套 ability-effect 免疫 gate — 化隱/光之翼的對手 active
//   不被換下(對齊招式版 v5.837)。大力捕捉器/挑戰角擊/媚惑引誘(gust)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { getAbilityFn } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const HIDDEN='19176'/*詛咒娃娃 化隱*/, PLAIN='14086';
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
// 特性使用者(P0) active=該寶可夢; 對手(P1) active=化隱, bench=[一般]
function runAbility(userCardId, cardName, abName, defActiveId){
  const user=inst(userCardId);
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'A',active:user,bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'B',active:inst(defActiveId),bench:[inst(PLAIN)],hand:[],deck:[],discard:[],prizes:[]}]};
  const fn=mod.getAbilityFn(cardName, abName, 0);
  assert(fn, `找不到特性 ${cardName}|${abName}`);
  const old=Math.random; Math.random=()=>0.1; // 媚惑引誘擲幣正面
  try{ return fn(st,0,pool,user); } finally { Math.random=old; }
}
// v5.995 C-05 方向修正:「選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換」效果對象=備戰
//   → 化隱 active 不擋互換(官方判例 §17.3.D 強行入眠)；化隱「備戰」才要從候選排除。
for(const [uid,cn,an] of [['13982','鐵掌力士','大力捕捉器'],['14802','赫普的毛毛角羊','挑戰角擊'],['16801','花潔夫人','媚惑引誘']]){
  T(`${cn}|${an}(C-05): 化隱對手 active → 仍開換位 picker(原戰鬥位免疫不擋)`,()=>{
    const r=runAbility(uid,cn,an,HIDDEN);
    assert(r.pendingSelection,`C-05 化隱 active 應照常開 picker(HEAD 誤擋),實際無 pending`);
    const v=r.pendingSelection.params?.validIids;
    assert(Array.isArray(v)&&v.length===1,'validIids 應含一般備戰');
  });
  T(`${cn}|${an}: 一般對手 active → 正常開 picker(對照)`,()=>{
    const r=runAbility(uid,cn,an,PLAIN);
    assert(r.pendingSelection,'一般 active 應開 picker');
  });
  T(`${cn}|${an}(C-05): 備戰全化隱 → 不開 picker(無合法目標)`,()=>{
    const user=inst(uid);
    const st2={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
      players:[{name:'A',active:user,bench:[],hand:[],deck:[],discard:[],prizes:[]},
               {name:'B',active:inst(PLAIN),bench:[inst(HIDDEN)],hand:[],deck:[],discard:[],prizes:[]}]};
    const fn=mod.getAbilityFn(cn,an,0);
    const old=Math.random; Math.random=()=>0.1;
    let r; try{ r=fn(st2,0,pool,user); } finally { Math.random=old; }
    assert(!r.pendingSelection,'備戰唯一候選是化隱 → 不應開 picker');
    assert.equal(r.players[1].active.cardId,PLAIN,'active 應維持');
  });
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
