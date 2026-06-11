// v5.562：妖精領域(莉莉艾的皮皮ex)弱點覆寫，走中央 dealAttackDamageToTarget 的招式也要套。
//   玩家回報：詛咒娃娃|玩偶捕捉(走中央 helper) 在己方有皮皮ex 時打龍系(多龍巴魯托ex)沒 ×2。
//   收斂：弱點計算抽 getEffectiveWeaknessType/getAttackerEffectiveTypes，引擎主管線 + 中央 helper 共用。
// Run: node scripts/test-fairyzone-central-weakness.mjs
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.fz-e.ts'), O = join(ROOT, '.fz-o.mjs'), S = join(ROOT, '.fz-s.mjs');
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

const DOLL = '19176', DRAGAPULT = '14794', CLEFAIRY = '14720', PSY = '14103';
let iid = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++iid), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++iid), cardId: String(cid), damage: 0, energyAttached: [] });

function mk(withClefairy) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null, setupDone: [true, true],
    players: [
      { active: inst(DOLL, [en(PSY), en(PSY), en(PSY)]), bench: withClefairy ? [inst(CLEFAIRY)] : [], hand: [], deck: Array.from({ length: 10 }, () => en(PSY)), discard: [], prizes: Array.from({ length: 6 }, () => en(PSY)), name: 'P0' },
      { active: inst(DRAGAPULT), bench: [], hand: [], deck: Array.from({ length: 10 }, () => en(PSY)), discard: [], prizes: Array.from({ length: 6 }, () => en(PSY)), name: 'P1' },
    ],
  };
}
let pass = 0, fail = 0;
const ck = (label, cond, extra) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label, extra || ''); } };

console.log('1) 詛咒娃娃|玩偶捕捉(中央 helper) 打 多龍巴魯托ex(龍) + 己方皮皮ex -> 妖精領域龍弱超 -> 80x2=160');
{
  const s = applyAction(mk(true), { type: 'ATTACK', attackIndex: 0, discardedEnergyIids: [] }, pool);
  const dmg = s.players[1].active ? s.players[1].active.damage : -1;
  ck('傷害應 160 (妖精領域 x2 經中央 helper)', dmg === 160, '實際=' + dmg);
}
console.log('2) 對照 無皮皮ex -> 龍本無弱點 -> 80');
{
  const s = applyAction(mk(false), { type: 'ATTACK', attackIndex: 0, discardedEnergyIids: [] }, pool);
  const dmg = s.players[1].active ? s.players[1].active.damage : -1;
  ck('傷害應 80 (無妖精領域 龍無弱點)', dmg === 80, '實際=' + dmg);
}
console.log('\n妖精領域中央弱點 PASS ' + pass + ' / FAIL ' + fail);
process.exitCode = fail ? 1 : 0;
