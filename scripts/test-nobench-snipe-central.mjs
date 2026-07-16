// v5.960 守衛:狙擊/傷害型招式「對手無備戰」的 fallback 也要走中央 dealAttackDamageToTarget
//   (原 inline 用 base/有效HP 但漏 active 弱點×2/免疫/prevent-KO/反擊)。以電磁電光為 exemplar:
//   ①無備戰+弱雷 active → 10×2=20(HEAD inline 無弱點→只有10) ②無備戰+非弱雷 → 10(無回歸)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.nbs-e.ts'),O=join(ROOT,'.nbs-o.mjs'),S=join(ROOT,'.nbs-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;
  for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const live=new Set(JSON.parse(readFileSync(join(ROOT,'static/cards/index.json'),'utf8')).map(e=>e.code));
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
const LGT='basic-lightning';  // 用真實基本雷能量 id? 直接放一個 energy inst,countAttachedEnergyAsUnits 只對電磁電光不需要
// 電磁電光 dmg=10 固定,不需能量數;但招式 cost 檢查不在 POST。直接呼叫 POST。
function mkState(defCid){
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,
    log:[],pendingSelection:null,setupDone:[true,true],pendingPrizes:[0,0],
    players:[
      {name:'P0',active:inst('19246'),bench:[],hand:[],deck:[],discard:[],prizes:[]},   // 皮卡丘(雷)
      {name:'P1',active:inst(defCid),bench:[],hand:[],deck:[],discard:[],prizes:[]},     // 目標,無備戰
    ]};
}
let pass=0,fail=0; const chk=(n,c)=>{if(c)pass++;else{fail++;console.log('  ❌',n);}};

// ① 無備戰 + 弱雷 active(小鋸鱷19245 HP70) → 20(×2)
let out=ATTACK_POST.get('皮卡丘|電磁電光')(mkState('19245'),0,pool);
chk('①無備戰弱雷 active 受 20(=10×2)', out.players[1].active && out.players[1].active.damage===20);

// ② 無備戰 + 非弱雷 active(願增猿14086 HP110) → 10(無回歸)
out=ATTACK_POST.get('皮卡丘|電磁電光')(mkState('14086'),0,pool);
chk('②無備戰非弱雷 active 受 10(無回歸)', out.players[1].active && out.players[1].active.damage===10);

console.log(`nobench-snipe-central:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
