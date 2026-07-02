// v5.838 驗證:夠讚狗|算帳「上個對手回合對手獲得的獎賞卡張數×60」須用對手獎賞堆減少量
//   (含 ex 雙倍/特性 KO),非招式 KO 次數近似(漏 ex 雙倍與特性 KO)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
function run(before,after,attackKO){
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    oppPrizesAtMyLastTurnEnd:[before,6], oppPrizesAtMyTurnStart:[after,6],
    oppAttackKOdMeInLastOppTurn:[attackKO,0],
    players:[{name:'A',active:inst('14758'),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'B',active:inst('14086'),bench:[],hand:[],deck:[],discard:[],prizes:Array.from({length:after},()=>inst('14086'))}]};
  return mod.ATTACK_PRE.get('夠讚狗|算帳')(st,0,pool,{}).damage;
}
T('對手上回合KO我的ex(獎賞6→4,得2張) → 80 + 2×60 = 200',()=>{
  const d=run(6,4,1); // 招式KO次數=1(ex算1次)但實得2張
  assert.equal(d,200,'應200(得2張),實際 '+d);
});
T('對手特性KO(咒詛炸彈,得1張,attackKO=0) → 80 + 1×60 = 140',()=>{
  const d=run(6,5,0); // 招式KO=0(特性KO),實得1張
  assert.equal(d,140,'應140(特性KO得1張),實際 '+d);
});
T('對照:對手沒取獎賞 → 80',()=>{
  assert.equal(run(6,6,0),80);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
