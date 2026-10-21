#!/usr/bin/env node
/**
 * v6.546 守衛（小問題批次第 9、11 項，非規則改動）：
 *   「火箭隊的寶可夢」判準 9 處散寫收斂到中央 isRocketTeamPokemonCard（＋lint Check Z 擋回流）；
 *   超級基格爾德ex｜虛無歸零全部反面時的 log。
 * 【H】BASE（v6.545）：三條全紅。
 */
import { extractBaseArchive, linkBaseModules } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.545。
const BASE_SHA = '981b61c3';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const HIJ = (c) => 'HIJ'.includes(c.regulationMark || '?');
const byName = (n) => { for (const c of pool.values()) if (c.name === n && HIJ(c)) return String(c.id); return null; };
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const EN = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Colorless: '水' };
const ID = { filler: '19178', W: byName('基本【水】能量'), F: byName('基本【鬥】能量'),
  zyg: withAttack('超級基格爾德ex', '虛無歸零'), rocketTrainer: [...pool.values()].find((c) => HIJ(c) && c.supertype === 'Trainer' && c.name.startsWith('火箭隊的'))?.id,
  rocketMon: [...pool.values()].find((c) => HIJ(c) && c.supertype === 'Pokemon' && c.name.startsWith('火箭隊的'))?.id };
for (const k of ['rocketTrainer', 'rocketMon']) if (ID[k] != null) ID[k] = String(ID[k]);
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);
const LINT = (root) => { try { execFileSync('node', [join(root, 'scripts/anti-pattern-lint.mjs')], { cwd: root, stdio: 'pipe' }); return 'green'; } catch (e) { return String(e.stdout ?? '') ; } };

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6546-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getAvailableAttacks } from '${p('src/lib/game/engine')}';\nexport { evaluateSelectionFilter, isKnownSelectionFilter } from '${p('src/lib/game/selection-filter')}';\nexport { RESOLVERS } from '${p('src/lib/game/effects/_shared')}';\nexport * as SH from '${p('src/lib/game/effects/_shared')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M, root) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = (p0 = {}, p1 = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 20), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 20), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p1 },
      ] };
  };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // ── 「火箭隊的寶可夢」中央判準：卡名以「火箭隊的」開頭的訓練家不是寶可夢
  T('ROCKET_PRED', () => ({ trainer: M.SH.isRocketTeamPokemonCard(pool.get(ID.rocketTrainer)), mon: M.SH.isRocketTeamPokemonCard(pool.get(ID.rocketMon)) }));
  // ── 虛無歸零全部反面 ⇒ 不寫「各受到 150 傷害」
  T('COIN_ALL_TAILS', () => {
    const z = pool.get(ID.zyg); const ai = z.attacks.findIndex((a) => a.name === '虛無歸零');
    const cost = (z.attacks[ai].cost ?? []).length;
    const r0 = Math.random; Math.random = () => 0.9;
    try {
      const s = M.applyAction(mk({ active: inst(ID.zyg, { energyAttached: many(ID.F, Math.max(cost, 4)) }) }), { type: 'ATTACK', attackIndex: ai }, pool);
      const msgs = s.log.map((l) => l.message ?? '');
      return { tails: msgs.some((m) => m.includes('全部反面')), wrong: msgs.some((m) => m.includes('各受到 150 傷害')), dmg: s.players[1].bench.reduce((t, b) => t + b.damage, 0) };
    } finally { Math.random = r0; }
  });
  // ── lint Check Z：散寫 startsWith('火箭隊的') 會被擋（root 的 lint 有 Z 且目前綠）
  T('LINT_Z', () => {
    const L = readFileSync(join(root, 'scripts/anti-pattern-lint.mjs'), 'utf8');
    return { hasZ: /\[Z\] /.test(L), green: LINT(root) === 'green' };
  });
  return out;
}

const judge = (r) => ({
  ROCKET_PRED: !!r.ROCKET_PRED && r.ROCKET_PRED.trainer === false && r.ROCKET_PRED.mon === true,
  COIN_ALL_TAILS: !!r.COIN_ALL_TAILS && r.COIN_ALL_TAILS.tails && !r.COIN_ALL_TAILS.wrong && r.COIN_ALL_TAILS.dmg === 0,
  LINT_Z: !!r.LINT_Z && r.LINT_Z.hasZ && r.LINT_Z.green,
});
const LABEL = {
  ROCKET_PRED: '★★★ 中央 isRocketTeamPokemonCard：卡名以「火箭隊的」開頭的訓練家不算寶可夢，火箭隊的寶可夢算',
  COIN_ALL_TAILS: '★★ 虛無歸零全部反面 ⇒ log 寫「全部反面」，不再寫「各受到 150 傷害」',
  LINT_Z: '★★★ anti-pattern-lint Check Z 存在且目前全站無散寫（9 處已收斂）',
};
const NEW = ['ROCKET_PRED', 'COIN_ALL_TAILS', 'LINT_Z'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM, ROOT), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6546b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src", "scripts", "static/cards"], tmp);
    linkBaseModules(ROOT, tmp);
    const BM = await load(tmp);
    const B = scenarios(BM, tmp), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.545：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.545：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6546 H', '需要 v6.545 commit');

console.log(`\n=== v6.546 火箭隊的寶可夢判準收斂、虛無歸零文案：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
