// v5.973 HEAD-FAIL:「擲幣正面→選1個對手能量丟棄」型收斂中央 discardOppActiveEnergyPost(選擇 picker+免疫 gate)
//   取代自動丟末張。對手 active 有 2 張能量→應開 active-energy-discard picker(actorIdx=攻擊方,2張皆候選)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-s.js'), E = join(ROOT, '.x-e.ts'), O = join(ROOT, '.x-o.mjs');
process.on('exit', () => { for (const p of [S,E,O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if (c?.id!=null) pool.set(String(c.id), c); }

const origRandom = Math.random;
function inst(cardId, extra={}) { return { iid:'p'+Math.random().toString(36).slice(2), cardId:String(cardId), energyAttached:[], damage:0, ...extra }; }
function mkState(attCardId, defEnergies) {
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true],
    players:[
      { name:'P0', active:inst(attCardId), bench:[], hand:[], deck:[], discard:[], prizes:[] },
      { name:'P1', active:inst('16912', { energyAttached:defEnergies }), bench:[], hand:[], deck:[], discard:[], prizes:[] },
    ] };
}

let pass=0;
function testCard(key, attCardId) {
  const post = mod.ATTACK_POST.get(key);
  assert.ok(post, '找不到 ATTACK_POST '+key);
  const energies=[{iid:'e1',cardId:'900001',energyAttached:[],damage:0},{iid:'e2',cardId:'900002',energyAttached:[],damage:0}];
  const st = mkState(attCardId, energies);
  Math.random = () => 0.1; // 正面
  let after;
  try { after = post(st, 0, pool, {}); } finally { Math.random = origRandom; }
  const ps = after.pendingSelection;
  assert.ok(ps && ps.type==='active-energy-discard', `${key} 正面應開 active-energy-discard picker,實得 ${ps && ps.type}`);
  assert.strictEqual(ps.actorIdx, 0, `${key} picker actorIdx 應為攻擊方 0`);
  const vi = ps.params?.validIids || [];
  assert.ok(vi.includes('e1') && vi.includes('e2'), `${key} 兩張能量都應可選,實得 ${JSON.stringify(vi)}`);
  // 對手能量此時尚未丟(等 resolve)
  assert.strictEqual(after.players[1].active.energyAttached.length, 2, `${key} picker 開啟時尚不丟能量`);
  console.log(`  ✅ ${key} 正面→開 picker(2張候選,actorIdx=攻擊方,尚未丟)`); pass++;
}
testCard('幼基拉斯|咬碎', '12509');       // 個別 outlier
testCard('鬼斯|神秘光束', '16912');       // 共用 coinHeadsOppDiscardEnergyPost
testCard('鐵蟻|咬碎', '16522');           // v2750 outlier
testCard('藍鱷|咬碎', '16638');
testCard('敏捷蟲|酸液炸彈', '13366');

// 反面→無效果(無回歸)
{
  const post=mod.ATTACK_POST.get('幼基拉斯|咬碎');
  const st=mkState('12509',[{iid:'e1',cardId:'900001',energyAttached:[],damage:0}]);
  Math.random=()=>0.9; let after; try{after=post(st,0,pool,{});}finally{Math.random=origRandom;}
  assert.strictEqual(after.pendingSelection,null,'反面不應開 picker');
  assert.strictEqual(after.players[1].active.energyAttached.length,1,'反面不丟能量');
  console.log('  ✅ 反面→不丟不開 picker(無回歸)'); pass++;
}
console.log(`\nPASS ${pass}/6 — opp-energy-discard-pick`);
