// v5.948 守衛:「放置傷害指示物直到剩X HP」=招式效果,不觸發順滑大衣(擲幣免傷)/弱抗
//   蜈蚣王|偏道一回(剩10) 打 奇諾栗鼠ex|順滑大衣 → 即使擲幣正面也應正常放指示物(非傷害不受擲幣免傷)
import { build } from 'esbuild';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-pc-e.ts'), OUT = join(ROOT, '.tmp-pc-o.mjs'), SHIM = join(ROOT, '.tmp-pc-s.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });
writeFileSync(SHIM, 'export const base="";');
import { writeFileSync } from 'node:fs';
writeFileSync(SHIM, 'export const base="";');
writeFileSync(ENTRY, `export { applyAction } from './src/lib/game/engine';`);
await build({ entryPoints:[ENTRY], outfile:OUT, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': SHIM }, logLevel:'error' });
const { applyAction } = await import(pathToFileURL(OUT).href);
const pool = new Map();
for (const f of readdirSync(join(ROOT,'static/cards'))) { if (!f.endsWith('.json')||f==='index.json') continue;
  for (const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8'))) pool.set(String(c.id), c); }
const eid = (n) => { for (const [id,c] of pool) if (c.name===n) return id; return '?'; };
const DARK = eid('基本【惡】能量');
let nn=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:cid,damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:cid,damage:0,energyAttached:[]});
const CENTIPEDE='16933';  // 蜈蚣王|偏道一回(剩10),需 [惡,無]
const COAT='18491';       // 奇諾栗鼠ex|順滑大衣 hp=240

function mkState() {
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active: inst(CENTIPEDE,[en(DARK),en(DARK)]), bench:[], hand:[], deck:Array.from({length:10},()=>en(DARK)), discard:[], prizes:Array.from({length:6},()=>en(DARK)), name:'P0' },
      { active: inst(COAT), bench:[], hand:[], deck:Array.from({length:10},()=>en(DARK)), discard:[], prizes:Array.from({length:6},()=>en(DARK)), name:'P1' },
    ] };
}
function attackWithCoin(headsForced) {
  const orig=Math.random;
  Math.random = () => headsForced ? 0.1 : 0.9;  // <0.5=正面
  try {
    let st=mkState();
    st=applyAction(st, { type:'ATTACK', attackIndex:0, actorIdx:0 }, pool);
    const opp=st.players[1].active;
    return opp ? opp.damage : 'KO';
  } finally { Math.random=orig; }
}
// 奇諾栗鼠ex hp=240,剩10 → 放 230 傷害指示物
// 斷言1:擲幣正面(headsForced)——放指示物是效果,不受順滑大衣擲幣免傷→仍放 230
const dmgHeads = attackWithCoin(true);
assert.strictEqual(dmgHeads, 230, `擲幣正面時偏道一回應照放 230(得 ${dmgHeads}) — 放指示物非傷害不受順滑大衣擋`);
// 斷言2:擲幣反面——同樣 230(一致)
const dmgTails = attackWithCoin(false);
assert.strictEqual(dmgTails, 230, `擲幣反面時也應 230(得 ${dmgTails})`);
console.log('✅ 放置指示物直到剩X HP 守衛全過(偏道一回不受順滑大衣擲幣免傷,穩定 230)');
