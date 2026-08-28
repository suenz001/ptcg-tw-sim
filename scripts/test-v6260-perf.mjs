// ══════════════════════════════════════════════════════════════════════════════
// v6.260 效能量測（IRON RULES Rule 32：效能數字必須附量測腳本）
//
// 量什麼：備戰 KO 熱路徑。本版在四條傷害 KO 路徑（hitBenchAll／bench-hit-N／
//   snipe-60-ex／olive-oil-distribute）補了 applyPreventKOToVictim 與 fireDefenderOnKO，
//   但兩者都在 `newDmg >= hp` 的 **KO 分支內** ⇒ 未 KO 時呼叫增量＝0（Rule 31 早退）。
//   KO 時增量＝每隻 1 次 preventKO 掃描（無道具/特性即早退）＋1 次 fireDefenderOnKO
//   （無 on-KO 效果時為幾次 Map.get）。
//
// 沙盒實測（BASE e9157fe2 vs v6.260 並排，腳本 /tmp/f5v6260/perf.mjs）：
//   hitBenchAll 無KO：0.0613 → 0.0613 ms（Δ 0.0%）
//   hitBenchAll 雙KO：0.0127 → 0.0112 ms（雜訊級）
//   dealAttackDamageToTarget 備戰KO：0.0346 → 0.0384 ms（+0.004ms，微秒級）
//
// ⚠ CI 只有單一版本 ⇒ 斷言是**絕對上限**（抓數量級退化），不是精密比較。
// ══════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.p6260-s.js'), E = join(ROOT, '.p6260-e.ts'), O = join(ROOT, '.p6260-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { hitBenchAllForCard, dealAttackDamageToTarget } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const DIR = join(ROOT, 'static/cards');
const LIVE = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !LIVE.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const mkFix = (dmg) => {
  let IID = 0;
  const inst = (id, o = {}) => ({ iid: 'i' + (++IID), cardId: String(id), damage: 0, energyAttached: [], ...o });
  const f = () => inst('14704');
  const m1 = inst('16961', { damage: dmg }), m2 = inst('16961', { damage: dmg });  // 桃歹郎(HP70,無 on-KO)
  return {
    st: { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      log: [], pendingSelection: null, setupDone: [true, true], players: [
      { name: 'A', active: f(), bench: [], hand: [], deck: [f(), f()], discard: [], prizes: [f(), f()] },
      { name: 'B', active: f(), bench: [m1, m2], hand: [], deck: [f(), f()], discard: [], prizes: [f()] }] },
    iid: m1.iid,
  };
};
// 正對照：fixture 真的會 KO（否則量測是安慰劑）
{
  const { st } = mkFix(75);
  const chk = mod.hitBenchAllForCard(st, 0, 1, 10, pool, '天空波');
  assert.strictEqual(chk.players[1].bench.length, 0, 'fixture 沒把兩隻備戰打死 ⇒ 安慰劑');
}
const bench = (fn, n = 1500) => {
  fn(); fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / n;
};
const noKo = bench(() => { const { st } = mkFix(0); mod.hitBenchAllForCard(st, 0, 1, 10, pool, '天空波'); });
const ko = bench(() => { const { st } = mkFix(75); mod.hitBenchAllForCard(st, 0, 1, 10, pool, '天空波'); });
const snipeKo = bench(() => { const { st, iid } = mkFix(75); mod.dealAttackDamageToTarget(st, 0, iid, 30, pool, { kind: 'attack-damage', label: '狙' }); });
console.log(`hitBenchAll 無KO ${noKo.toFixed(4)}ms / 雙KO ${ko.toFixed(4)}ms / 中央狙擊KO ${snipeKo.toFixed(4)}ms`);
assert.ok(noKo < 1.0, `hitBenchAll 無KO 退化：${noKo.toFixed(4)}ms（門檻 1.0）`);
assert.ok(ko < 2.0, `hitBenchAll KO 退化：${ko.toFixed(4)}ms（門檻 2.0）`);
assert.ok(snipeKo < 2.0, `狙擊 KO 退化：${snipeKo.toFixed(4)}ms（門檻 2.0）`);
console.log('=== v6260-perf: PASS ===');
