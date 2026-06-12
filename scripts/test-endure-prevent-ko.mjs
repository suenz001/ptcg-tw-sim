// v5.594：超級摔角鷹人ex|堅忍之軀(PASSIVE_PREVENT_KO,受招式傷害昏厥擲幣正面留10HP)在走中央 helper /
//   snipe-multi 的招式 KO 時沒發動。收斂 applyPreventKOToVictim 接三條 KO 路徑。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.ek-e.ts'), O = join(ROOT, '.ek-o.mjs'), S = join(ROOT, '.ek-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const HAWLUCHA='14754' /*超級摔角鷹人ex HP250 堅忍之軀*/, KYUREM='10629' /*三重冰霜 snipe-multi 110*/,
      DOLL='19176' /*詛咒娃娃 玩偶捕捉 80 走中央 helper*/, PSY='14103', WATER='18519', METAL='14434', FILLER='14319';
let iid=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++iid),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++iid),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0;
const ck=(l,c,e)=>{ if(c){pass++;console.log('  PASS',l);}else{fail++;console.log('  FAIL',l,e||'');} };
const ORND=Math.random;
const setRnd=(v)=>{ Math.random=()=>v; };
const rstRnd=()=>{ Math.random=ORND; };

function mkSnipe(hawDmg){
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active:inst(KYUREM,[en(WATER),en(WATER),en(METAL),en(METAL),en(WATER)]), bench:[], hand:[], deck:Array.from({length:10},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P0' },
      { active:inst(HAWLUCHA,[],{damage:hawDmg}), bench:[inst(FILLER)], hand:[], deck:Array.from({length:10},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P1' },
    ] };
}
function mkDoll(hawDmg){
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:3, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active:inst(DOLL,[en(PSY),en(PSY),en(PSY)]), bench:[], hand:[], deck:Array.from({length:10},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P0' },
      { active:inst(HAWLUCHA,[],{damage:hawDmg}), bench:[inst(FILLER)], hand:[], deck:Array.from({length:10},()=>en(PSY)), discard:[], prizes:Array.from({length:6},()=>en(PSY)), name:'P1' },
    ] };
}

console.log('1) 三重冰霜(snipe-multi) 對已 200 傷的摔角鷹人ex(HP250) → 310 應 KO；堅忍之軀正面 → 留 10HP');
{
  let s=mkSnipe(200); const hawIid=s.players[1].active.iid;
  s=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  setRnd(0.1); // 正面(<0.5)
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[hawIid]},pool); rstRnd();
  const a=s.players[1].active;
  ck('正面：摔角鷹人ex 未昏厥仍在戰鬥場', a && a.cardId===HAWLUCHA, 'active='+(a&&a.cardId));
  ck('正面：剩餘 HP=10（damage=240）', a && a.damage===240, 'damage='+(a&&a.damage));
}
console.log('2) 對照：三重冰霜 反面 → 正常 KO');
{
  let s=mkSnipe(200); const hawIid=s.players[1].active.iid;
  s=applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  setRnd(0.9); // 反面
  s=applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[hawIid]},pool); rstRnd();
  const koed=s.players[1].active===null || s.players[1].active.cardId!==HAWLUCHA;
  ck('反面：摔角鷹人ex 被 KO', koed, 'active='+(s.players[1].active&&s.players[1].active.cardId));
}
console.log('3) 玩偶捕捉(中央 dealAttackDamageToTarget,80) 對已 180 傷 → 260 應 KO；堅忍之軀正面 → 留 10HP');
{
  setRnd(0.1);
  let s=applyAction(mkDoll(180),{type:'ATTACK',attackIndex:0,discardedEnergyIids:[]},pool); rstRnd();
  const a=s.players[1].active;
  ck('正面：中央 helper 路徑也防 KO，剩餘 HP=10', a && a.cardId===HAWLUCHA && a.damage===240, 'active='+(a&&a.cardId)+' damage='+(a&&a.damage));
}
console.log('\n堅忍之軀 prevent-KO 收斂 PASS '+pass+' / FAIL '+fail);
process.exitCode=fail?1:0;
