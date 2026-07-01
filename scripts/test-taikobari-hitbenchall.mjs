// v5.832 驗證：護城龍|太古防壁(對手能量≤2→自己所有寶可夢不受招式傷害)在「打全體對手備戰」
//   (hitBenchAll:天空波/大地斷裂)也生效。原 hitBenchAll 走 inline guard 漏此檢查(漏網)。
//   收斂:中央述詞 taikoBariBlocksAttackDamage 4 路徑共用。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const EMOLGA='10456'/*電飛鼠 天空波 cost 1無 打雙方全備戰10*/, MOAT='19204'/*護城龍 太古防壁*/,
      MUNNA='14086'/*願增猿 HP110 bench target*/, LAPRAS='14085', WATER='11175';
let iid=0;const inst=(cid,e={})=>({iid:`x${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

// P0 電飛鼠(nEnergy) 用天空波打; P1 active=拉普拉斯ex, bench=[護城龍, 願增猿(觀察)]
function run(nEnergy){
  const target=inst(MUNNA);
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[
      {name:'A',active:inst(EMOLGA,{energyAttached:Array.from({length:nEnergy},()=>inst(WATER))}),bench:[],hand:[],deck:[],discard:[],prizes:[]},
      {name:'B',active:inst(LAPRAS),bench:[inst(MOAT),target],hand:[],deck:[],discard:[],prizes:[]},
    ],_targetIid:target.iid};
  const r=mod.applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  const t=r.players[1].bench.find(b=>b.iid===st._targetIid);
  return t? t.damage : 'KO/null';
}
T('A. 攻擊方能量2個 → 太古防壁擋,對手備戰願增猿不受傷(damage=0)',()=>{
  const d=run(2);
  assert.equal(d,0,'應 0(太古防壁擋≤2),實際 '+d);
});
T('B. 攻擊方能量3個 → 太古防壁不適用,對手備戰願增猿受10',()=>{
  const d=run(3);
  assert.equal(d,10,'應 10(能量3>2 可打),實際 '+d);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
