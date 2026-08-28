// ══════════════════════════════════════════════════════════════════════════════
// v6.257 效能量測（IRON RULES Rule 32：子代理報的效能數字也會說謊 ⇒ 必附量測腳本）
//
// 量什麼：`getEvolvableTargets`（每次盤面 render 都會呼叫，UI 熱路徑）
//         與 EVOLVE handler（applyAction）。
//
// v6.257 動了什麼：
//   ・新增中央 producer `getEvolveTimingBypass`（一次 call 產生三個 bypass 旗標）
//   ・鬥志戰吼從 `card.name === '勒克貓'`（極便宜）改成
//     `hasEffectiveAbilityByInst(...,'鬥志戰吼')`，但**左邊先短路** `oppActiveIsEx`，
//     且該述詞第一件事是 `card.abilities?.some(...)` ⇒ 沒有特性的卡直接 false、0 配置。
//   ・EVOLVE handler 原本呼叫 `hasShellinkEvolveBypass` **兩次**（同值），收斂成一次
//     ⇒ 每次 EVOLVE 少一次掃全場 ⇒ 淨變化為負。
//
// ⚠ 這支腳本本身**不做 BASE 對照**（CI 只有單一版本），它斷言的是「絕對上限」，
//   用來抓數量級退化。BASE↔HEAD 的並排數字寫在 docs/changelog-internal.md。
// ══════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.p6257-s.js'), E = join(ROOT, '.p6257-e.ts'), O = join(ROOT, '.p6257-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, getEvolvableTargets } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const CARDS_DIR = join(ROOT, 'static/cards');
const LIVE = new Set(JSON.parse(readFileSync(join(CARDS_DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const hij = [];
for (const f of readdirSync(CARDS_DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !LIVE.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(CARDS_DIR, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark)) hij.push(c);
  }
}
const BASIC = hij.filter(c => c.supertype === 'Pokemon' && c.stage === 'Basic');
const EVOS = hij.filter(c => c.supertype === 'Pokemon' && c.evolvesFrom);
assert.ok(BASIC.length > 50 && EVOS.length > 50, `卡池下限失敗 basic=${BASIC.length} evo=${EVOS.length}`);
const inst = (iid, cid, x = {}) => ({ iid, cardId: String(cid), damage: 0, energyAttached: [], extraTools: [], ...x });

/** 典型盤面：自己 active + 5 備戰滿場、手牌 7 張（含 3 張進化卡）、對手 active + 5 備戰 */
function typicalState() {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 9, isFirstTurn: false, log: [], pendingSelection: null,
    setupDone: [true, true], activeStadium: null,
    players: [
      {
        name: 'P1', active: inst('a0', BASIC[0].id),
        bench: Array.from({ length: 5 }, (_, i) => inst(`ab${i}`, BASIC[i + 1].id)),
        hand: [...Array.from({ length: 3 }, (_, i) => inst(`h${i}`, EVOS[i].id)),
          ...Array.from({ length: 4 }, (_, i) => inst(`hb${i}`, BASIC[i + 10].id))],
        deck: Array.from({ length: 40 }, (_, i) => inst(`d${i}`, BASIC[i % 20].id)),
        discard: [], prizes: Array.from({ length: 6 }, (_, i) => inst(`p${i}`, BASIC[i].id)),
      },
      {
        name: 'P2', active: inst('b0', BASIC[20].id),
        bench: Array.from({ length: 5 }, (_, i) => inst(`bb${i}`, BASIC[i + 21].id)),
        hand: [], deck: Array.from({ length: 40 }, (_, i) => inst(`e${i}`, BASIC[i % 20].id)),
        discard: [], prizes: Array.from({ length: 6 }, (_, i) => inst(`q${i}`, BASIC[i].id)),
      },
    ],
  };
}

function bench(label, n, fn) {
  for (let i = 0; i < Math.max(200, n / 10); i++) fn();           // warmup
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  const t1 = process.hrtime.bigint();
  const per = Number(t1 - t0) / 1e6 / n;
  console.log(`  ${label}: ${n} 次 / ${(Number(t1 - t0) / 1e6).toFixed(1)} ms ⇒ ${per.toFixed(5)} ms/call`);
  return per;
}

const st = typicalState();
console.log('── v6.257 效能量測（典型滿場盤面）──────────────────────────────────────');
const perUI = bench('getEvolvableTargets（UI 熱路徑）', 20000, () => mod.getEvolvableTargets(st, pool));
const perEvo = bench('applyAction EVOLVE（會被 gate 擋下的路徑）', 5000,
  () => mod.applyAction(st, { type: 'EVOLVE', fromIid: 'a0', toIid: 'h0' }, pool));

// 絕對上限（抓數量級退化，不是精密比較）：
//   實測 BASE 與 v6.257 都在 0.01 ms/call 量級；門檻放 20 倍以吸收 CI 機器抖動。
assert.ok(perUI < 0.5, `getEvolvableTargets 退化：${perUI.toFixed(5)} ms/call（門檻 0.5）`);
assert.ok(perEvo < 2.0, `applyAction EVOLVE 退化：${perEvo.toFixed(5)} ms/call（門檻 2.0）`);
console.log('\n✅ v6.257 效能量測通過（無數量級退化）');
