#!/usr/bin/env node
/**
 * v6.473 守衛：站長 2026-10-04 兩條裁定（v6.471 audit 提出的問題）
 *
 *   裁定 1（維持現狀、鎖住）：「多餘花粉」的寶可夢被中毒、灼傷的寶可夢檢查擊倒，或被揚沙擊倒，**不**多拿獎賞卡 ——
 *     「揚沙、中毒、灼傷的昏厥，是在寶可夢檢查階段，不屬於任何回合」（卡面「在下個自己的回合…昏厥時」不成立）。
 *   裁定 2（修正）：脫殼忍者「脆弱蛻殼」讓對手拿不到獎賞卡時，古舊能量的「每場 1 次」**不算用掉** ——
 *     「那是觸發脫殼忍者的特性，而不是觸發古舊能量效果」。v6.472 以前 engine 主傷害 KO 分支照樣寫成已生效
 *     （effects 側 koPrizesAdjusted 本來就不寫 ⇒ 兩條管線不一致）。
 *
 * 判準（實跑本版與 BASE＝v6.472 的引擎）：
 *   A 主傷害 KO：拉普拉斯ex 擊倒附古舊能量的脫殼忍者 ⇒ 0 張、古舊能量旗標仍是 false  ★HEAD-FAIL
 *   B effects 側（koPrizesAdjusted）同一盤面 ⇒ 旗標同樣是 false（兩條管線一致）
 *   C 對照：一般寶可夢附古舊能量被擊倒 ⇒ 旗標照樣變 true（沒有把古舊能量整個關掉）
 *   D 裁定 1：中毒檢查擊倒帶「多餘花粉 +2」的寶可夢 ⇒ 只拿基本張數、不寫多餘花粉
 *   E 裁定 1：灼傷檢查擊倒同上
 *
 * Run: node scripts/test-v6473-ko-prize-rulings.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.472
const BASE_SHA = 'edeadf8b';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const tmps = [];
process.on('exit', () => { for (const p of tmps) { try { rmSync(p, { recursive: true, force: true }); } catch {} } });
/** 把 srcRoot 底下的引擎打包成可 import 的模組 */
async function bundle(srcRoot, tag) {
  const d = mkdtempSync(join(tmpdir(), 'v6473-' + tag + '-')); tmps.push(d);
  const S = join(d, 's.js'), E = join(d, 'e.ts'), O = join(d, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, `export { applyAction } from '${join(srcRoot, 'src/lib/game/engine').replace(/\\/g, '/')}';\nexport { koPrizesAdjusted } from '${join(srcRoot, 'src/lib/game/effects').replace(/\\/g, '/')}';`);
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  return import(pathToFileURL(O).href);
}

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }


const LION = '18508', LAPRAS = '14085', WATER = '18519', ENERGY = '14102', MILTANK = '14011', SHEDINJA = '14063', ANCIENT = '17212';
for (const [n, id] of Object.entries({ LION, LAPRAS, WATER, MILTANK, SHEDINJA, ANCIENT })) ok(`[前提] 卡庫有 ${n}（${id}）`, pool.has(id), pool.get(id)?.name);
const hpOf = (cid) => Number(pool.get(cid)?.hp ?? 0);
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = (n) => Array.from({ length: n }, () => inst(ENERGY));
function mk({ atk, def }) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], ancientEnergyMinusOneUsed: [false, false],
    players: [
      { name: 'P1', active: atk, bench: [inst(MILTANK)], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
      { name: 'P2', active: def, bench: [inst(MILTANK)], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
    ] };
}
const lapras = () => inst(LAPRAS, { energyAttached: [inst(WATER), inst(WATER), inst(WATER)] });
const taken = (out) => (6 - out.players[0].prizes.length) + (out.pendingPrizes?.[0] ?? 0);
const logText = (s) => (s.log || []).map((l) => (typeof l === 'string' ? l : l.text ?? l.message ?? '')).join('\n');
function runAll(M) {
  nn = 0;
  const r = {};
  let st = mk({ atk: lapras(), def: inst(SHEDINJA, { damage: hpOf(SHEDINJA) - 10, energyAttached: [inst(ANCIENT)] }) });
  let out = M.applyAction(st, { type: 'ATTACK', attackIndex: 1 }, pool);
  r.A = { taken: taken(out), flag: out.ancientEnergyMinusOneUsed?.[1] };
  st = mk({ atk: lapras(), def: inst(SHEDINJA, { damage: hpOf(SHEDINJA) - 10, energyAttached: [inst(ANCIENT)] }) });
  const fx = M.koPrizesAdjusted(st, st.players[1].active, pool.get(SHEDINJA), 0, 1, pool, true);
  r.B = { prizes: fx.prizes, flag: fx.state.ancientEnergyMinusOneUsed?.[1] };
  st = mk({ atk: lapras(), def: inst(MILTANK, { damage: hpOf(MILTANK) - 10, energyAttached: [inst(ANCIENT)] }) });
  out = M.applyAction(st, { type: 'ATTACK', attackIndex: 1 }, pool);
  r.C = { taken: taken(out), flag: out.ancientEnergyMinusOneUsed?.[1] };
  for (const [k, status] of [['D', 'poisoned'], ['E', 'burned']]) {
    st = mk({ atk: inst(LION, { energyAttached: [inst(ENERGY)] }), def: inst(MILTANK, { damage: hpOf(MILTANK) - 10, status, deferredPrizeBonusThisTurn: 2 }) });
    out = M.applyAction(st, { type: 'END_TURN' }, pool);
    r[k] = { ko: out.players[1].discard.some((c) => c.cardId === MILTANK), taken: taken(out), pollen: /多餘花粉/.test(logText(out)) };
  }
  return r;
}

const CUR = await bundle(ROOT, 'cur');
const c = runAll(CUR);
console.log('【本版】' + JSON.stringify(c));
ok('★★★[A] 主傷害 KO 脫殼忍者（附古舊能量）：0 張、古舊能量旗標不消耗', c.A.taken === 0 && c.A.flag === false, JSON.stringify(c.A));
ok('★★[B] effects 側同一盤面：0 張、旗標不消耗（兩條管線一致）', c.B.prizes === 0 && c.B.flag === false, JSON.stringify(c.B));
ok('★★[C] 對照：一般寶可夢附古舊能量被擊倒 ⇒ 少 1 張、旗標照樣用掉', c.C.taken === 0 && c.C.flag === true, JSON.stringify(c.C));
ok('★★[D] 裁定 1：中毒檢查擊倒「多餘花粉 +2」的寶可夢 ⇒ 只拿 1 張、不寫多餘花粉', c.D.ko && c.D.taken === 1 && !c.D.pollen, JSON.stringify(c.D));
ok('★★[E] 裁定 1：灼傷檢查擊倒同上', c.E.taken === 1 && !c.E.pollen, JSON.stringify(c.E));

console.log('\n【H】同一批盤面餵 BASE（v6.472）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6473 H', '需要 v6.472 commit');
else {
  const bd = mkdtempSync(join(tmpdir(), 'v6473-basesrc-')); tmps.push(bd);
  const tar = execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', BASE_SHA, 'src'], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', bd], { input: tar });
  const b = runAll(await bundle(bd, 'base'));
  console.log('【BASE】' + JSON.stringify(b));
  ok('★★★[HEAD-FAIL A] v6.472：脆弱蛻殼歸 0 時古舊能量旗標被用掉', b.A.taken === 0 && b.A.flag === true, JSON.stringify(b.A));
  ok('★★[F] 其餘張數與 v6.472 相同（B／C／D／E）', b.B.prizes === c.B.prizes && b.C.taken === c.C.taken && b.D.taken === c.D.taken && b.E.taken === c.E.taken, JSON.stringify({ b, c }));
}

console.log(`\n=== v6.473 獎賞裁定（多餘花粉／脆弱蛻殼＋古舊能量）: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6473-ko-prize-rulings ===');
process.exit(fail ? 1 : 0);
