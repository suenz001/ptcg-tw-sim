// ══════════════════════════════════════════════════════════════════════════════
// v6.262 效能量測（IRON RULES Rule 32：效能數字必須附量測腳本）
//
// 量什麼：支援者免疫述詞 `isImmuneToOppSupporter` 的熱路徑。本版在它**最前面**加了
//   一行「來源必須是『從手牌使出』」的早退判斷（`source ?? getSupporterEffectSource()`），
//   常見情況（玩家從手牌打支援者）＝一次模組層級變數讀取 + 一次字串比較後直接往下走
//   ⇒ Rule 31「新增呼叫 ≠ 變慢」，增量在雜訊以下。
//   同時 supporters_gust 少了一次內聯的 `pool.get()` + 卡名字串比對（**變快**）。
//
// 沙盒 BASE(12162345) vs v6.262 並排實測（腳本 /tmp/finperf/perf.mjs，各跑 3 輪）：
//   gate 老大的指令(備戰含化石)：0.0058 / 0.0049 / 0.0067 → 0.0048 / 0.0066 / 0.0047 ms
//   gate 老大的指令(無化石)    ：0.0030 / 0.0019 / 0.0029 → 0.0022 / 0.0023 / 0.0025 ms
//   applyAction PLAY_TRAINER   ：0.0629 / 0.0730 / 0.0676 → 0.0630 / 0.0636 / 0.0603 ms
//   ⇒ 無退化（含化石那條略快，因為少了一次內聯卡名比對）。
//
// ⚠ CI 只有單一版本 ⇒ 斷言是**絕對上限**（抓數量級退化），不是精密比較。
// ══════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.p6262-s.js'), E = join(ROOT, '.p6262-e.ts'), O = join(ROOT, '.p6262-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export { TRAINER_GUARDS } from './src/lib/game/effects';\n"
  + "export { isImmuneToOppSupporter } from './src/lib/game/effects/cards/v3080_deferred_wave_c';\n"
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
const idOf = (n) => { for (const c of pool.values()) if (c.name === n) return String(c.id); return null; };
const GUST = idOf('老大的指令'), FIN = '18046', WATER = idOf('基本【水】能量');
const BASIC = (() => { for (const c of pool.values())
  if (c.supertype === 'Pokemon' && c.stage === 'Basic' && !c.evolvesFrom && c.subtype !== 'ex'
      && (c.hp | 0) >= 100 && c.regulationMark === 'H') return String(c.id); })();
assert.ok(GUST && WATER && BASIC && pool.get(FIN)?.name === '陳舊的鰭之化石', 'fixture 卡片查不到');

let n = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
function mk(withFossil) {
  const b = [inst(BASIC), inst(BASIC), inst(BASIC), inst(BASIC)];
  if (withFossil) b.push(inst(FIN, { fossilOnField: true }));
  const sup = inst(GUST);
  return { st: {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, activeStadium: null, supporterUsedThisTurn: [false, false],
    supporterTagsUsedThisTurn: { p1: [], p2: [] },
    players: [
      { name: 'A', active: inst(BASIC, { energyAttached: [inst(WATER)] }), bench: [inst(BASIC)], hand: [sup],
        deck: Array.from({ length: 20 }, () => inst(BASIC)), discard: [], prizes: Array.from({ length: 6 }, () => inst(BASIC)) },
      { name: 'B', active: inst(BASIC), bench: b, hand: [],
        deck: Array.from({ length: 20 }, () => inst(BASIC)), discard: [], prizes: Array.from({ length: 6 }, () => inst(BASIC)) },
    ] }, iid: sup.iid };
}
// ⚠ 正對照：fixture 真的走到免疫路徑（否則量測是安慰劑）
{
  const withF = mk(true), noF = mk(false);
  assert.strictEqual(mod.TRAINER_GUARDS.get('老大的指令')(noF.st, 0, pool), true, 'fixture(無化石) 應可使用');
  const fossilInst = withF.st.players[1].bench[4];
  assert.strictEqual(mod.isImmuneToOppSupporter(withF.st, 1, fossilInst, pool), true, 'fixture 的化石沒被判成免疫 ⇒ 安慰劑');
  const out = mod.applyAction(withF.st, { type: 'PLAY_TRAINER', iid: withF.iid }, pool);
  assert.ok(out.pendingSelection && !(out.pendingSelection.params?.validIids ?? []).includes(fossilInst.iid),
    'fixture 的 picker 沒排除化石 ⇒ 安慰劑');
}
const bench = (fn, N = 3000) => { for (let i = 0; i < 200; i++) fn();
  const t0 = process.hrtime.bigint(); for (let i = 0; i < N; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / N; };

const fx1 = mk(true), fx2 = mk(false);
const gF = bench(() => mod.TRAINER_GUARDS.get('老大的指令')(fx1.st, 0, pool));
const gN = bench(() => mod.TRAINER_GUARDS.get('老大的指令')(fx2.st, 0, pool));
const act = bench(() => mod.applyAction(fx1.st, { type: 'PLAY_TRAINER', iid: fx1.iid }, pool), 1200);
console.log(`gate(含化石) ${gF.toFixed(4)}ms / gate(無化石) ${gN.toFixed(4)}ms / applyAction 支援者 ${act.toFixed(4)}ms`);
assert.ok(gF < 0.5, `支援者免疫 gate（含化石）退化：${gF.toFixed(4)}ms（門檻 0.5）`);
assert.ok(gN < 0.5, `支援者免疫 gate（無化石）退化：${gN.toFixed(4)}ms（門檻 0.5）`);
assert.ok(act < 3.0, `applyAction PLAY_TRAINER 退化：${act.toFixed(4)}ms（門檻 3.0）`);
console.log('✅ v6.262 效能量測通過（無數量級退化）');
