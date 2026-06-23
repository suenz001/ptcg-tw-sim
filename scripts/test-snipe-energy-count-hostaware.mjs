/**
 * snipe-choose「對手1隻受 自身能量數×N」傷害 — host-aware 計數（v5.689）
 * 對手投射版的能量計數漏網（自身版 v5.688 已修）：
 *   金魚王|水炮射：卡面「【水】能量的數量×30」原誤用 energyAttached.length(數全部) → 改 countEnergyTypeHostAware('Water')
 *   堅果啞鈴|強力鞭打 / 猛雷鼓|落雷風暴：卡面「能量的數量×N」原用 .length / countOneEnergy('all')(每張1) → 改 countAttachedEnergyAsUnits(火箭隊2/燃火進化3)
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.sn-s.mjs'), E = join(ROOT, '.sn-e.ts'), O = join(ROOT, '.sn-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const WATER='18519', FIRE='14428', ROCKET='14853', DEF='14705';
const SEAKING='19157', POLTEAGEIST=null; // 金魚王
const KNUCKLE='13421' /*堅果啞鈴*/, MARK='10970' /*猛雷鼓*/;
let nn=0;const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
function mkState(atkCid, energyIds, oppBench, defCid=DEF){
  const s=createGame({name:'P1',entries:[{cardId:atkCid,count:1}]},{name:'P2',entries:[{cardId:DEF,count:1}]},pool);
  return { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:1, isFirstTurn:false,
    setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:[0,0], pendingSelection:null,
    players:[
      { ...s.players[0], active: inst(atkCid,{energyAttached:energyIds.map(e=>inst(e))}), bench:[], deck:[inst(DEF)], discard:[], hand:[], prizes:Array.from({length:6},()=>inst(DEF)) },
      { ...s.players[1], active: inst(defCid), bench:oppBench, deck:[inst(DEF)], discard:[], hand:[], prizes:Array.from({length:6},()=>inst(DEF)) }] };
}
let pass=0,fail=0;
const T=(nm,f)=>{try{f();console.log('  OK',nm);pass++;}catch(e){console.log('  FAIL',nm,'::',e.message);fail++;}};

// 金魚王 走 pending → 讀 params.damage
T('★金魚王|水炮射：[水,火] 應只數水=1 → 30 (HEAD數全部=2→60)', () => {
  const out = ATTACK_POST.get('金魚王|水炮射')(mkState(SEAKING,[WATER,FIRE],[inst(DEF)]), 0, pool);
  assert.equal(out.pendingSelection?.params?.damage, 30);
});
T('★金魚王|水炮射：[水,火箭隊] 火箭隊非水→水=1 → 30 (HEAD=2→60)', () => {
  const out = ATTACK_POST.get('金魚王|水炮射')(mkState(SEAKING,[WATER,ROCKET],[inst(DEF)]), 0, pool);
  assert.equal(out.pendingSelection?.params?.damage, 30);
});
// 強力鞭打 走 pending → params.amount；火箭隊=2單位
T('★堅果啞鈴|強力鞭打：[火箭隊]=2單位 → 40 (HEAD .length=1→20)', () => {
  const out = ATTACK_POST.get('堅果啞鈴|強力鞭打')(mkState(KNUCKLE,[ROCKET],[inst(DEF)]), 0, pool);
  assert.equal(out.pendingSelection?.params?.amount, 40);
});
// 落雷風暴 對手無備戰 → 直接打 active.damage；火箭隊=2單位
T('★猛雷鼓|落雷風暴：[火箭隊]=2單位 → 對手active受60 (HEAD countOneEnergy=1→30)', () => {
  const out = ATTACK_POST.get('猛雷鼓|落雷風暴')(mkState(MARK,[ROCKET],[],'14425'), 0, pool);
  assert.equal(out.players[1].active.damage, 60);
});
// baseline 純基本水
T('baseline 金魚王 [水,水] → 60', () => {
  const out = ATTACK_POST.get('金魚王|水炮射')(mkState(SEAKING,[WATER,WATER],[inst(DEF)]), 0, pool);
  assert.equal(out.pendingSelection?.params?.damage, 60);
});

console.log('\nsnipe 能量計數 host-aware:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
