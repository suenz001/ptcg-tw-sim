// v5.573：沙鈴仙人掌 特性「炸裂針」(PASSIVE_KO_RETALIATION) — 在戰鬥位「受招式傷害昏厥」時對攻擊方放 6 指示物(60)。
//   玩家回報：被 KO 時沒放指示物。根因：原只在引擎主管線觸發；走中央 helper dealAttackDamageToTarget
//   (玩偶捕捉等) / inline 傷害 resolver KO 它時漏。收斂進 fireDefenderOnKO(三類 on-KO 共用)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.bs-e.ts'), O = join(ROOT, '.bs-o.mjs'), S = join(ROOT, '.bs-s.mjs');
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

const DOLL = '19176' /*詛咒娃娃|玩偶捕捉 80(走中央 helper)*/, PSY = '14103',
      SABO_BURST = '12468' /*沙鈴仙人掌 炸裂針 HP110*/, SABO_PLAIN = '13698' /*沙鈴仙人掌 無炸裂針 HP100*/,
      FILLER = '14319' /*走路草(備戰)*/;
let iid = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++iid), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++iid), cardId: String(cid), damage: 0, energyAttached: [] });

function mk(defId, defDmg) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null, setupDone: [true, true],
    players: [
      { active: inst(DOLL, [en(PSY), en(PSY), en(PSY)]), bench: [], hand: [], deck: Array.from({ length: 10 }, () => en(PSY)), discard: [], prizes: Array.from({ length: 6 }, () => en(PSY)), name: 'P0' },
      { active: inst(defId, [], { damage: defDmg }), bench: [inst(FILLER)], hand: [], deck: Array.from({ length: 10 }, () => en(PSY)), discard: [], prizes: Array.from({ length: 6 }, () => en(PSY)), name: 'P1' },
    ],
  };
}
let pass = 0, fail = 0;
const ck = (label, cond, extra) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label, extra || ''); } };

console.log('1) 玩偶捕捉(中央 helper) 80 KO 沙鈴仙人掌(炸裂針,HP110,已40) → 攻擊方詛咒娃娃 +60 (6指示物)');
{
  const s = applyAction(mk(SABO_BURST, 40), { type: 'ATTACK', attackIndex: 0, discardedEnergyIids: [] }, pool);
  const koed = s.players[1].active === null || s.players[1].active.cardId !== SABO_BURST;
  const atkDmg = s.players[0].active ? s.players[0].active.damage : -1;
  ck('沙鈴仙人掌應被 KO', koed);
  ck('攻擊方應 +60 傷害（炸裂針 6 指示物，經中央 helper）', atkDmg === 60, '實際攻擊方 damage=' + atkDmg);
}
console.log('2) 對照：玩偶捕捉 KO 無炸裂針的沙鈴仙人掌(HP100,已40) → 攻擊方不受傷');
{
  const s = applyAction(mk(SABO_PLAIN, 40), { type: 'ATTACK', attackIndex: 0, discardedEnergyIids: [] }, pool);
  const atkDmg = s.players[0].active ? s.players[0].active.damage : -1;
  ck('攻擊方 damage 應 0（無炸裂針不反擊）', atkDmg === 0, '實際=' + atkDmg);
}
console.log('\n炸裂針 on-KO 收斂 PASS ' + pass + ' / FAIL ' + fail);
process.exitCode = fail ? 1 : 0;
