// v5.967 HEAD-FAIL 回歸：「上個自己回合用過某招」readers 收斂中央 attackUsedLastSelfTurn
//   ① 仙子伊布ex|天仙石 玩家層級冷卻(engine gate 掃全場)——第二張同名卡在備戰用過→戰鬥位這張也禁用
//   ② 托戈德瑪爾ex|尖尖回轉 per-instance +80 改讀中央(撤退再回也保留,不再被 pointySpin exit-clear 漏)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-s.js'), E = join(ROOT, '.x-e.ts'), O = join(ROOT, '.x-o.mjs');
process.on('exit', () => { for (const p of [S,E,O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\n"
              + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node',
  target:'node20', alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if (c?.id!=null) pool.set(String(c.id), c); }

let pass=0;
function inst(cardId, extra={}) { return { iid:'i'+Math.random().toString(36).slice(2), cardId:String(cardId), energyAttached:[], damage:0, ...extra }; }

// ---- ① 天仙石 玩家層級冷卻:備戰的第二張仙子伊布ex上個自己回合用過天仙石 → 戰鬥位這張也不能用 ----
{
  const SYLVEON='16770'; // MC 仙子伊布ex, 天仙石=atkIndex1
  const activeB = inst(SYLVEON); // 剛上場,無 flag
  const benchA  = inst(SYLVEON, { attackUsedLastSelfTurn:'天仙石' }); // 上個自己回合用過
  const state = {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5,
    isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true],
    players:[
      { name:'P0', active:activeB, bench:[benchA], hand:[], deck:[], discard:[], prizes:[] },
      { name:'P1', active:inst('16985'), bench:[inst('16985'), inst('16985')], hand:[], deck:[], discard:[], prizes:[] },
    ],
  };
  const after = mod.applyAction(state, { type:'ATTACK', attackIndex:1, actorIdx:0 }, pool);
  const blocked = (after.log||[]).some(l => typeof l==='string' ? l.includes('上個自己的回合已使用過「天仙石」') : (l?.text||l?.message||'').includes('上個自己的回合已使用過「天仙石」'));
  assert.ok(blocked, '天仙石應被玩家層級冷卻禁用(備戰第二張用過)');
  assert.strictEqual(after.pendingSelection, null, '被禁用→不應開啟 opp-bench-choose');
  console.log('  ✅ ① 天仙石 玩家層級冷卻:備戰同名卡用過→戰鬥位禁用'); pass++;
}

// ---- ② 尖尖回轉 讀中央 attackUsedLastSelfTurn(撤退再回也保留 +80) ----
{
  const TOGE='16985';
  // 模擬:撤退再回戰鬥位→pointySpin 已被 exit-clear(undefined),但中央 attackUsedLastSelfTurn 保留
  const active = inst(TOGE, { attackUsedLastSelfTurn:'尖尖回轉' });
  const state = {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5,
    isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true],
    players:[
      { name:'P0', active, bench:[], hand:[], deck:[], discard:[], prizes:[] },
      { name:'P1', active:inst('16770'), bench:[], hand:[], deck:[], discard:[], prizes:[] },
    ],
  };
  const pre = mod.ATTACK_PRE.get('托戈德瑪爾ex|尖尖回轉');
  assert.ok(pre, '找不到 尖尖回轉 ATTACK_PRE');
  const r = pre(state, 0, pool, {});
  assert.strictEqual(r.damage, 160, `尖尖回轉 撤退再回應讀中央保留 +80 → 160,實得 ${r.damage}`);
  console.log('  ✅ ② 尖尖回轉 讀中央保留 +80 → 160'); pass++;

  // 未用過 → 80 (無回歸)
  const active2 = inst(TOGE, {});
  const st2 = { ...state, players:[{ ...state.players[0], active:active2 }, state.players[1]] };
  const r2 = pre(st2, 0, pool, {});
  assert.strictEqual(r2.damage, 80, `尖尖回轉 未用過應 80,實得 ${r2.damage}`);
  console.log('  ✅ ② 尖尖回轉 未用過 → 80(無回歸)'); pass++;
}

console.log(`\nPASS ${pass}/3 — self-attack-cooldown`);
