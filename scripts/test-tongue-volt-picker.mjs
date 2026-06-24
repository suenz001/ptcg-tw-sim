// v5.708 回歸:①大舌頭舌引揭示對手手牌+選最多2基礎(原自動放未揭示);②鐵荊棘ex伏特旋風改附備戰
//   能量讓玩家選哪個(原自動取末張、不能選不同屬性)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.stub-tv.js'); writeFileSync(S,'export const base="";export const assets="";');
const E=join(ROOT,'.ent-tv.ts'); const O=join(ROOT,'.ent-tv.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const TONGUE='9894', IRON='16753', BUD='14443';
const ELE='18520', GRASS='14102', PSY='14103';
let nn=0; const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,extraTools:[],...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
function base(p0active, p1active, p0bench, p1hand){
  const s=createGame({name:'P1',entries:[{cardId:BUD,count:1}]},{name:'P2',entries:[{cardId:BUD,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
    players:[ {...s.players[0], active:p0active, bench:p0bench, hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]},
      {...s.players[1], active:p1active, bench:[], hand:p1hand, deck:[inst(BUD)], discard:[], prizes:[inst(BUD)]} ] };
}
T('舌引:揭示對手手牌→hand-choose picker(不自動放)[驗HEAD FAIL]', ()=>{
  const oppBud1=inst(BUD), oppBud2=inst(BUD);
  const st=base(inst(TONGUE,[en(PSY)]), inst(BUD), [], [oppBud1, oppBud2, inst('14428')/*火能量*/]);
  const out=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert(out.pendingSelection, '應開 picker(讓玩家選),而非自動放');
  assert.equal(out.pendingSelection.type, 'hand-choose', '應為 hand-choose(揭示對手手牌)');
  const vi=out.pendingSelection.params?.validIids||[];
  assert(vi.includes(oppBud1.iid)&&vi.includes(oppBud2.iid), 'validIids 應含對手手牌的基礎寶可夢');
  assert.equal(out.players[1].bench.length, 0, '尚未自動放(等玩家選)');
});
T('伏特旋風:多能量→active-energy-discard 選哪個能量(不自動末張)[驗HEAD FAIL]', ()=>{
  const st=base(inst(IRON,[en(ELE),en(GRASS),en(PSY)]), inst(IRON), [inst(BUD)], []);
  const out=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert(out.pendingSelection, '應開 picker');
  assert.equal(out.pendingSelection.type, 'active-energy-discard', '應為 active-energy-discard(選來源能量),原自動取末張+bench-choose');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
