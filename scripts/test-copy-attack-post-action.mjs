// v5.722 回歸:copy-attack regPost 轉接被借招式 ATTACK_POST 時必須傳 action,否則 borrowed 招式
//   regPost option 效果(若希望洗回/丟棄)收 action=undefined → 預設 yes → 玩家選否仍強制執行。
//   玩家報:耀閃挑戰借蚊香泳士跳躍衝天(若希望回牌庫)選否仍被洗回。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-cp.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-cp.ts'); const O = join(ROOT, '.ent-cp.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { ATTACK_PRE, ATTACK_POST } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':S }, logLevel:'error' });
const { ATTACK_PRE, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const SLOWKING='10934', POLIWRATH='10439', BUD='14443', WAILORD='19159';
let nn=0;
const inst=(cid,e=[])=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e});
const mkState=()=>{
  const poliwrath=inst(POLIWRATH);
  return { state:{ phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null, pendingCopyAttackKey:undefined,
    players:[
      { name:'P1', active:inst(SLOWKING), bench:[inst(BUD)], hand:[], deck:[poliwrath,inst(BUD)], discard:[], prizes:[] },
      { name:'P2', active:inst(WAILORD), bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[] },
    ],
  }, poliwrathIid: poliwrath.iid };
};
const pre=ATTACK_PRE.get('呆呆王|耀閃挑戰'), post=ATTACK_POST.get('呆呆王|耀閃挑戰');
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

T('耀閃挑戰借跳躍衝天「選否」→呆呆王不洗回(留戰鬥位) [驗HEAD無傳action強制洗回FAIL]', () => {
  const {state, poliwrathIid}=mkState();
  const action={type:'ATTACK',attackIndex:0,copyAttackChoice:{pokeIid:poliwrathIid,attackIndex:1},discardedEnergyIids:[]};
  const pr=pre(state,0,pool,action);
  assert.equal(pr.damage,120,`選否傷害應120(自身留場),實${pr.damage}`);
  const po=post(pr.state,0,pool,action);
  // 呆呆王應仍在戰鬥位(沒被跳躍衝天洗回牌庫)
  assert(po.players[0].active && po.players[0].active.cardId===SLOWKING, '呆呆王應留戰鬥位(選否不洗回)');
});
T('耀閃挑戰借跳躍衝天「選是」→呆呆王洗回牌庫(active清空)', () => {
  const {state, poliwrathIid}=mkState();
  const action={type:'ATTACK',attackIndex:0,copyAttackChoice:{pokeIid:poliwrathIid,attackIndex:1},discardedEnergyIids:['yes-token']};
  const pr=pre(state,0,pool,action);
  assert.equal(pr.damage,240,`選是傷害應240,實${pr.damage}`);
  const po=post(pr.state,0,pool,action);
  // 呆呆王應被洗回(active 不再是呆呆王)
  assert(!po.players[0].active || po.players[0].active.cardId!==SLOWKING, '呆呆王應洗回牌庫(選是)');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
