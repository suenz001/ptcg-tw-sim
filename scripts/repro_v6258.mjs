// v6.258 重現腳本：PASSIVE_ATTACK_BONUS「自指型被動」只用招式/卡名 gate → 同名不同印刷誤加成
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rp-s.js'), E = join(ROOT, '.rp-e.ts'), O = join(ROOT, '.rp-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);

const DIR = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
console.log('pool', pool.size);

let seq = 0;
const I = (cardId, extra = {}) => ({ iid: 'i' + (++seq), cardId, damage: 0, energyAttached: [], ...extra });
const EN = id => ({ iid: 'e' + (++seq), cardId: id });
const mk = (p0, p1, prizesB = 6) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null,
  players: [
    { name: 'A', active: p0.active, bench: p0.bench ?? [], hand: [], deck: [], discard: [], prizes: Array.from({ length: 6 }, (_, i) => 'a' + i) },
    { name: 'B', active: p1.active, bench: p1.bench ?? [], hand: [], deck: [], discard: [], prizes: Array.from({ length: prizesB }, (_, i) => 'b' + i) },
  ],
});

const DARK = '14430', PSY = '14103';
const WALL = '16577'; // 比克提尼 MC 無特性、無弱點? 用它當靶

function run(label, st) {
  const before = st.players[1].active.damage;
  const after = applyAction(st, { type: 'ATTACK', attackIndex: 0 }, pool);
  const d = (after.players[1].active?.damage ?? 999) - before;
  const ko = !after.players[1].active;
  const logs = after.log.slice(-8).map(l => (typeof l === 'string' ? l : l.text ?? JSON.stringify(l)));
  console.log(`\n### ${label}\n  傷害=${d}  KO=${ko}`);
  for (const l of logs) console.log('    ' + l);
  return { d, ko };
}

const target = () => I(WALL);

console.log('=== 案例1：仆斬將軍 MC 16944（無「大將」）肘擊 40 ===');
run('1a 只有 MC 印刷（正確應為 40）', mk(
  { active: I('16944', { energyAttached: [EN(DARK)] }), bench: [] },
  { active: target() }, 4));
run('1b 備戰放 M2a 14778（有「大將」）— BUG 應變 100', mk(
  { active: I('16944', { energyAttached: [EN(DARK)] }), bench: [I('14778')] },
  { active: target() }, 4));
run('1c【正對照】M2a 14778 自己攻擊（雙刃斬 180 + 60 = 240）', mk(
  { active: I('14778', { energyAttached: [EN('14434'), EN('14434')] }), bench: [] },
  { active: target() }, 4));

console.log('\n=== 案例2：棄世猴 M5 19183（無「憤怒穴」）幽靈打擊 100 ===');
run('2a 只有 M5 印刷、身上 2 指示物（正確應為 100）', mk(
  { active: I('19183', { damage: 20, energyAttached: [EN(PSY), EN(PSY)] }), bench: [] },
  { active: target() }, 6));
run('2b 備戰放 SV10 12797（有「憤怒穴」）— BUG 應變 220', mk(
  { active: I('19183', { damage: 20, energyAttached: [EN(PSY), EN(PSY)] }), bench: [I('12797')] },
  { active: target() }, 6));

console.log('\n=== 案例3：電蜘蛛 SV11W 13388（無「複眼」）放電 ===');
run('3a 只有 SV11W 印刷（無複眼）', mk(
  { active: I('13388', { energyAttached: [EN('18520')] }), bench: [] },
  { active: I('16832') }, 6));  // 鐵頭殼ex 有特性 → 複眼條件成立
run('3b 備戰放 SV6a 10584（有「複眼」）— 是否誤 +50', mk(
  { active: I('13388', { energyAttached: [EN('18520')] }), bench: [I('10584')] },
  { active: I('16832') }, 6));
