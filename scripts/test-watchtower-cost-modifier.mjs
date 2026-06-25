// v5.723 回歸:火箭隊的監視塔(雙方場上【無】寶可夢特性全消除)在場時,老練招式(月月熊赫月ex【無】特性,
//   減血月【無】能量需求)+音波龍調諧迴響(【無】特性,減恐慌嚎鳴需求)應被消除→cost 不減。
//   原 canAffordAttack 的 cost-modifier 沒查監視塔 → 監視塔在場仍減 cost(玩家報老練招式)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-wt.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-wt.ts'); const O = join(ROOT, '.ent-wt.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { canAffordAttack } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':S }, logLevel:'error' });
const { canAffordAttack } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const URSALUNA='17096', SONIDO='17086', WATCHTOWER='14849', GRASS='11173', BUD='14443';
let nn=0;
const inst=(cid,e=[])=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
// 對手取3獎賞(prizes剩3)→血月5無減3=2無;音波龍恐慌嚎鳴3無減3=0無
const mkState=(stadium)=>({
  phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null,
  activeStadium: stadium ? inst(stadium) : null,
  players:[
    { name:'P1', active:null, bench:[], hand:[], deck:[], discard:[], prizes:[inst(BUD),inst(BUD),inst(BUD),inst(BUD),inst(BUD),inst(BUD)] },
    { name:'P2', active:inst(BUD), bench:[], hand:[], deck:[], discard:[], prizes:[inst(BUD),inst(BUD),inst(BUD)] }, // 剩3=已取3
  ],
});
const blood5 = ['Colorless','Colorless','Colorless','Colorless','Colorless'];
const panic3 = ['Colorless','Colorless','Colorless'];
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

T('老練招式:無監視塔+對手取3獎賞→血月5無減到2無,給2草→可負擔', () => {
  const st=mkState(null); st.players[0].active=inst(URSALUNA,[en(GRASS),en(GRASS)]);
  assert.equal(canAffordAttack(st.players[0].active, blood5, pool, st, undefined, '血月'), true, '無監視塔老練生效應可負擔');
});
T('★老練招式:有監視塔→特性消除,血月維持5無,給2草→不可負擔 [驗HEAD仍減FAIL]', () => {
  const st=mkState(WATCHTOWER); st.players[0].active=inst(URSALUNA,[en(GRASS),en(GRASS)]);
  assert.equal(canAffordAttack(st.players[0].active, blood5, pool, st, undefined, '血月'), false, '監視塔消除老練→5無→2草不夠');
});
T('★音波龍調諧迴響:有監視塔→特性消除,恐慌嚎鳴維持3無,給2草→不可負擔', () => {
  const st=mkState(WATCHTOWER); st.players[0].active=inst(SONIDO,[en(GRASS),en(GRASS)]);
  assert.equal(canAffordAttack(st.players[0].active, panic3, pool, st, undefined, '恐慌嚎鳴'), false, '監視塔消除調諧迴響→3無→2草不夠');
});
T('音波龍:無監視塔+對手取3→恐慌嚎鳴3無減3=0,給0能量→可負擔', () => {
  const st=mkState(null); st.players[0].active=inst(SONIDO,[]);
  assert.equal(canAffordAttack(st.players[0].active, panic3, pool, st, undefined, '恐慌嚎鳴'), true, '無監視塔調諧生效→0無');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
