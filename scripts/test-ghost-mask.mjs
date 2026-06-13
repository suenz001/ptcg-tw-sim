// 鬼之假面：棄牌厄鬼椪ex ↔ 場上厄鬼椪ex 互換,保留附加物,換下裸牌進棄牌
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.gm-e.ts'),O=join(ROOT,'.gm-o.mjs'),S=join(ROOT,'.gm-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const {applyAction}=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const liveCodes=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!liveCodes.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let MASK=null; const exs=[];
for(const [id,c] of pool){
  if(!MASK && c.name==='鬼之假面') MASK=id;
  if(c.supertype==='Pokemon' && c.subtype==='ex' && (c.name||'').includes('厄鬼椪')) exs.push(id);
}
const A=exs[0], B=exs.find(x=>x!==A);
const PSY='14103', WATER='18519';
if(!MASK||!A||!B){ console.log('找不到卡 MASK='+MASK+' A='+A+' B='+B); process.exit(1); }
console.log('鬼之假面='+MASK+' | 場上厄鬼椪ex A='+A+'('+pool.get(A).name+') | 棄牌厄鬼椪ex B='+B+'('+pool.get(B).name+')');
let iid=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0; const ck=(l,c,e)=>{if(c){pass++;console.log('  PASS',l);}else{fail++;console.log('  FAIL',l,e||'');}};

function mk(){
  const maskInst=inst(MASK); const discB=inst(B);
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active:inst(A,[en(WATER),en(WATER)],{damage:60, status:'burned'}), bench:[inst('14319')],
        hand:[maskInst], deck:Array.from({length:5},()=>en(PSY)), discard:[discB], prizes:Array.from({length:6},()=>en(PSY)), name:'P0' },
      { active:inst('14319'), bench:[], hand:[], deck:Array.from({length:5},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P1' },
    ] , _maskIid:maskInst.iid, _discBIid:discB.iid };
}

console.log('1) 打鬼之假面 → 選棄牌B → 選場上A → 互換');
{
  let s=mk(); const maskIid=s._maskIid, discBIid=s._discBIid; const fieldAIid=s.players[0].active.iid;
  s=applyAction(s,{type:'PLAY_TRAINER',iid:maskIid},pool);
  ck('打出後開啟棄牌 picker', s.pendingSelection && s.pendingSelection.type==='discard-search', 'pend='+JSON.stringify(s.pendingSelection&&s.pendingSelection.type));
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[discBIid]},pool);
  ck('step2 開啟場上 picker', s.pendingSelection && s.pendingSelection.type==='heal-target', 'pend='+JSON.stringify(s.pendingSelection&&s.pendingSelection.type));
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[fieldAIid]},pool);
  const act=s.players[0].active;
  ck('場上底牌換成 B', act && act.cardId===B, 'active.cardId='+(act&&act.cardId));
  ck('場上 instance iid 保留(同一隻)', act && act.iid===fieldAIid, 'iid='+(act&&act.iid));
  ck('附加能量保留(2)', act && act.energyAttached.length===2, 'eg='+(act&&act.energyAttached.length));
  ck('傷害保留(60)', act && act.damage===60, 'dmg='+(act&&act.damage));
  ck('特殊狀態保留(burned)', act && act.status==='burned', 'status='+(act&&act.status));
  const disc=s.players[0].discard.map(c=>c.cardId);
  ck('棄牌含換下的 A', disc.includes(A), 'disc='+JSON.stringify(disc));
  ck('棄牌不再有 B(已上場)', !disc.includes(B), 'disc='+JSON.stringify(disc));
  ck('鬼之假面本身已打出進棄牌', disc.includes(MASK), 'disc='+JSON.stringify(disc));
}
console.log('2) guard：棄牌無厄鬼椪ex → 不可打(PLAY_TRAINER 應被拒,state 不變)');
{
  let s=mk(); s.players[0].discard=[en(PSY)]; const maskIid=s._maskIid;
  const before=JSON.stringify(s.players[0].active);
  s=applyAction(s,{type:'PLAY_TRAINER',iid:maskIid},pool);
  ck('無棄牌厄鬼椪ex → 不開 picker / 不互換', !s.pendingSelection || s.pendingSelection.type!=='discard-search' || JSON.stringify(s.players[0].active)===before, 'pend='+(s.pendingSelection&&s.pendingSelection.type));
}
console.log('\n鬼之假面 PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
