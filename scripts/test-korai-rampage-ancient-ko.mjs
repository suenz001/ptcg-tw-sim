// v5.911 守衛：故勒頓|輪番狂攻(30+，「在上個自己的回合，若這隻寶可夢以外的『古代』寶可夢
//   使用了招式，則增加150點傷害」)。舊實作只掃『場上』古代 instance→古代被KO離場就漏算。
//   改用遊戲層級 ancientAttackedIidsLastSelfTurn(存活至KO後)。
//   ① 讀取：故勒頓 active(場上無其他古代)，但上回合有『別隻』古代使過招(已離場,只在遊戲層級陣列)
//      → 輪番狂攻 = 180(30+150)。HEAD 只掃場上→30 → HEAD-FAIL。
//   ② 引擎記錄+promote：古代寶可夢使招→ancientAttackedIidsThisTurn[p1|p2] 記其iid；END_TURN→LastSelfTurn。
//   ⚠v6.056：形狀由 [string[],string[]] 改為 {p1,p2} —— Firestore 不支援巢狀陣列，舊形狀
//     會讓整份線上盤面寫不進房間（見 scripts/test-firestore-nested-array.mjs）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.kr-s.js'), E = join(ROOT, '.kr-e.ts'), O = join(ROOT, '.kr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const KORAI='11249'/*故勒頓 古代 輪番狂攻(idx0,CC,30+) 頭突(idx1)*/, HIGHHP='14794'/*HP320 no fighting weak*/, ANY='14319';
assert(pool.get(KORAI)?.tags?.includes('古代'),'故勒頓應有古代tag');
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function base(){
  const s=createGame({name:'A',entries:[{cardId:KORAI,count:1}]},{name:'B',entries:[{cardId:HIGHHP,count:1}]},pool);
  const korai=inst(KORAI,{energyAttached:[inst('18383'),inst('18383')]}); // 2 能量付 CC
  return {korai, s:{...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s.players[0],hand:[],deck:[inst(ANY)],discard:[],prizes:Array.from({length:6},()=>inst(ANY)),bench:[],active:korai},
             {...s.players[1],hand:[],deck:[inst(ANY)],discard:[],prizes:Array.from({length:6},()=>inst(ANY)),bench:[],active:inst(HIGHHP)}]}};
}
T('① 上回合別隻古代使過招(已離場,只在遊戲層級) → 輪番狂攻=180', () => {
  const {s}=base();
  // 模擬:上個自己的回合有別隻古代(ghostIid,現已離場)使過招
  const st={...s, ancientAttackedIidsLastSelfTurn:{p1:['ghost-ancient-iid'],p2:[]}, ancientAttackedIidsThisTurn:{p1:[],p2:[]}};
  const r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  const dmg=r.players[1].active?.damage ?? 0;
  assert.equal(dmg,180,'應為 30+150=180(古代已離場仍算);實際 '+dmg);
});
T('② 場上/遊戲層級都無其他古代使招 → 輪番狂攻=30', () => {
  const {s}=base();
  const r=applyAction({...s,ancientAttackedIidsLastSelfTurn:{p1:[],p2:[]},ancientAttackedIidsThisTurn:{p1:[],p2:[]}},{type:'ATTACK',attackIndex:0},pool);
  assert.equal(r.players[1].active?.damage ?? 0,30,'無古代使招應=30');
});
T('③ 只有故勒頓自己上回合使招(同iid,排除) → 輪番狂攻=30', () => {
  const {s,korai}=base();
  const r=applyAction({...s,ancientAttackedIidsLastSelfTurn:{p1:[korai.iid],p2:[]},ancientAttackedIidsThisTurn:{p1:[],p2:[]}},{type:'ATTACK',attackIndex:0},pool);
  assert.equal(r.players[1].active?.damage ?? 0,30,'「這隻寶可夢以外」→自身iid應排除=30');
});
T('④ 引擎記錄:古代使招→ancientAttackedIidsThisTurn.p1 記其iid', () => {
  const {s,korai}=base();
  const r=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  const arr=r.ancientAttackedIidsThisTurn?.p1 ?? [];
  assert(arr.includes(korai.iid),'古代故勒頓使招後應記錄其iid;實際 '+JSON.stringify(arr));
});
console.log(`\n=== 輪番狂攻 古代KO離場仍增傷(v5.911): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
