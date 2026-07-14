// v5.950 守衛:西獅海壬|全滿旋律 進化時應自動彈窗詢問(on-evolve prompt,類殺手鐧捕捉)。
//   原漏收 ON_EVOLVE_FROM_HAND_ABILITIES→進化不彈窗、時好時壞。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.ws-e.ts'),O=join(ROOT,'.ws-o.mjs'),S=join(ROOT,'.ws-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;
  for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))pool.set(String(c.id),c);}
let nn=0;
const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:cid,damage:0,energyAttached:[],...x});
const HANAYO='19162'; // 花漾海獅 Stage1
const WESTSEA='19163'; // 西獅海壬 Stage2 evolvesFrom 花漾海獅 (全滿旋律)
function mk() {
  const base = inst(HANAYO, { damage: 50 });  // 受傷→進化後有 heal 目標
  const evo = inst(WESTSEA);
  return { state:{
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active: base, bench:[], hand:[evo], deck:Array.from({length:5},()=>inst(HANAYO)), discard:[], prizes:Array.from({length:6},()=>inst(HANAYO)), name:'P0' },
      { active: inst(HANAYO), bench:[], hand:[], deck:Array.from({length:5},()=>inst(HANAYO)), discard:[], prizes:Array.from({length:6},()=>inst(HANAYO)), name:'P1' },
    ] }, base, evo };
}
const { state, base, evo } = mk();
let st = applyAction(state, { type:'EVOLVE', fromIid: base.iid, toIid: evo.iid, actorIdx:0 }, pool);
// 斷言1:進化後應自動彈窗詢問是否使用全滿旋律(HEAD 因不在 set→無彈窗 pendingSelection null)
const ps = st.pendingSelection;
assert.ok(ps && ps.effectKey==='resolve-play-ability-prompt',
  `進化後應開全滿旋律詢問彈窗(得 pendingSelection=${ps ? ps.effectKey : 'null'})`);
assert.strictEqual(ps.params?.abilityName, '全滿旋律', `彈窗特性名應為全滿旋律(得 ${ps.params?.abilityName})`);
// 斷言2:確認場上是西獅海壬(進化成功)
assert.strictEqual(st.players[0].active?.cardId, WESTSEA, '進化後 active 應為西獅海壬');
console.log('✅ 西獅海壬全滿旋律 on-evolve 彈窗守衛全過');
