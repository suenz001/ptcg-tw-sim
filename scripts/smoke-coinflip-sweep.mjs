import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-smoke-entry.ts');
const OUT = join(ROOT, '.tmp-smoke-bundle.mjs');
const SHIM = join(ROOT, '.tmp-smoke-shim.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });
writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY, `export { applyAction } from './src/lib/game/engine';`);
await build({ entryPoints:[ENTRY], outfile:OUT, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':SHIM }, logLevel:'error' });
const { applyAction } = await import(pathToFileURL(OUT).href);

const pool = new Map();
for (const f of readdirSync(join(ROOT,'static/cards'))) {
  if (!f.endsWith('.json')||f==='index.json') continue;
  for (const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8'))) pool.set(String(c.id), c);
}
const eid = (n) => { for (const [id,c] of pool) if (c.name===n) return id; return '?'; };
const E = {
  Colorless: eid('基本【無】能量') !== '?' ? eid('基本【無】能量') : eid('基本【惡】能量'),
  Water: eid('基本【水】能量'), Grass: eid('基本【草】能量'), Lightning: eid('基本【雷】能量'),
  Fighting: eid('基本【鬥】能量'), Darkness: eid('基本【惡】能量'), Fire: eid('基本【火】能量'),
};
const TANKY = '12167'; // 洛奇亞ex 220HP as defender (high HP, won't die in 1 hit usually)
let nn = 0;
const inst = (cid, e=[], x={}) => ({ iid:'i'+(++nn), cardId:cid, damage:0, energyAttached:e, ...x });
const en = (cid) => ({ iid:'e'+(++nn), cardId:cid, damage:0, energyAttached:[] });

function energyForCost(costArr) {
  // attach 6 of each distinct type in cost, plus 6 colorless generic
  const types = [...new Set(costArr)];
  const out = [];
  for (const t of types) for (let i=0;i<6;i++) out.push(en(E[t] ?? E.Darkness));
  for (let i=0;i<6;i++) out.push(en(E.Darkness)); // generic spare
  return out;
}

function mkState(attackerId) {
  const card = pool.get(attackerId);
  const atks = card.attacks ?? [];
  // build energy union over all attacks (so any attackIndex works)
  const cost = [].concat(...atks.map(a=>a.cost ?? []));
  const att = inst(attackerId, energyForCost(cost), { movedToActiveThisTurn:false });
  return {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, activePlayerIdx:0, turnCount:3, turn:3,
    firstPlayerIdx:0, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null,
    players:[
      { active:att, bench:[inst('10605')], hand:[], deck:Array.from({length:12},()=>en(E.Darkness)),
        discard:[], prizes:Array.from({length:6},()=>en(E.Darkness)), setupDone:true, name:'P0' },
      { active:inst(TANKY, [en(E.Darkness)]), bench:[inst('10605'), inst('10605')], hand:[],
        deck:Array.from({length:12},()=>en(E.Darkness)), discard:[],
        prizes:Array.from({length:6},()=>en(E.Darkness)), setupDone:true, name:'P1' },
    ],
  };
}

// [card name|attack, cardId, file/pattern, atkName]
const CASES = [
  ['波爾凱尼恩|強力蒸汽','18063','v2360 flip1(multi)','強力蒸汽'],
  ['派拉斯特|橫掃剪','16476','v2620 for-loop','橫掃剪'],
  ['霹靂電球ex|百裂球','16704','v2346 flipUntilTails','百裂球'],
  ['洛奇亞ex|破壞潮旋','12167','v155 while-until-tails regPost','破壞潮旋'],
  ['光電傘蜥|強大伏特','14713','v2306 multi-flip','強大伏特'],
  ['長毛豬|上衝','14342','v2346 inline single','上衝'],
  ['頭巾混混|無賴攻擊','13412','v2630 for-loop','無賴攻擊'],
  ['火箭隊的拉達|顧前不顧後','17027','v2510 paired regPost','顧前不顧後'],
  ['雪吞蟲|躲藏','14044','v2560 single regPost','躲藏'],
  ['超級袋獸ex|機關槍合擊','14071','slowking machine-gun','機關槍合擊'],
  ['火箭隊的地鼠|狂潛','14742','v2630 while-until-tails regPost','狂潛'],
  ['巴大蝶|鱗粉颶風','12465','v2540 multi+status','鱗粉颶風'],
  ['蒂蕾喵|魔法葉','16537','v2540 魔法葉 pre store flag','魔法葉'],
  ['焚焰蚣|緊束粉碎','14033','v2560 paired regPost','緊束粉碎'],
  ['雙倍多多冰|雙重冰凍','16672','v2540 multiply(B helper)','雙重冰凍'],
];

let pass=0, fail=0;
for (const [label, cid, where, atkName] of CASES) {
  const card = pool.get(cid);
  const idx = (card.attacks ?? []).findIndex(a=>a.name===atkName);
  if (idx < 0) { console.log(`SKIP ${label} (atk not found)`); continue; }
  let ok=false, note='';
  try {
    let st = mkState(cid);
    st = applyAction(st, { type:'ATTACK', attackIndex:idx, actorIdx:0 }, pool);
    const flagged = st.coinFlippedThisAttack === true;
    const pend = !!st.pendingSelection;
    if (flagged || pend) { ok=true; note = flagged ? 'coinFlippedThisAttack=true' : `pendingSelection=${st.pendingSelection?.type}`; }
    else note = 'flag NOT set & no pending';
  } catch(e) { note = 'THROW: '+e.message; }
  if (ok) { pass++; console.log(`PASS ${label.padEnd(24)} [${where}] → ${note}`); }
  else { fail++; console.log(`FAIL ${label.padEnd(24)} [${where}] → ${note}`); }
}
console.log(`\n擲幣 smoke：PASS ${pass} / FAIL ${fail}`);
process.exit(fail>0?1:0);
