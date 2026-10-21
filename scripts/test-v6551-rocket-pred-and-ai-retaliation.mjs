#!/usr/bin/env node
/**
 * v6.551 守衛（前幾版審查留下的「之後處理」）：
 *   ①「火箭隊的寶可夢」判準：10 處 `name.includes('火箭隊的')` 收斂到中央 isRocketTeamPokemonCard（定義搬到 selection-filter.ts，_shared re-export），
 *     anti-pattern-lint Check Z 擴及 includes。
 *   ② AI 試打停在對手要解的選擇視窗時，受傷反擊（_pendingOnDamaged）估進 selfDamage（v6.533 審查 P3-4）。
 * 【H】BASE（v6.550）：NEW 紅、正對照綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.550。
const BASE_SHA = '2853e0d0';
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
const ID = { filler: '19178', G: byName('基本【草】能量'), deerling: '13364', punk: byName('龐克頭盔'),
  rocketBasic: [...pool.values()].find((c) => c.supertype === 'Pokemon' && !c.evolvesFrom && (c.name ?? '').startsWith('火箭隊的') && HIJ(c))?.id,
  rocketTrainer: [...pool.values()].find((c) => c.supertype === 'Trainer' && (c.name ?? '').startsWith('火箭隊的') && HIJ(c))?.id,
  dark: [...pool.values()].find((c) => c.supertype === 'Pokemon' && !c.evolvesFrom && (c.types || [c.pokemonType]).includes('Darkness') && Number(c.hp) >= 120 && HIJ(c))?.id };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(String(v))).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6551-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport { evaluateAttack } from '${p('src/lib/game/ai-eval')}';\nexport { evaluateSelectionFilter } from '${p('src/lib/game/selection-filter')}';\nexport * as SF from '${p('src/lib/game/selection-filter')}';\nexport * as SH from '${p('src/lib/game/effects/_shared')}';\nimport '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// 靜態：src 底下 `.includes('火箭隊的')`／`.startsWith('火箭隊的')` 的出現處（剝 // 與 /* */ 註解；中央定義那一行除外）
function scatterCount(srcRoot) {
  let n = 0;
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) {
    const fp = join(d, f.name);
    if (f.isDirectory()) walk(fp);
    else if (/\.(ts|svelte)$/.test(f.name)) {
      const t = readFileSync(fp, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const line of t.split('\n')) if (/\.(?:includes|startsWith)\(\s*['"]火箭隊的['"]\s*\)/.test(line) && !/card\?\.supertype === 'Pokemon' && !!card\.name\?\.startsWith/.test(line)) n++;
    } } };
  walk(join(srcRoot, 'src'));
  return n;
}

function scenarios(M, srcRoot) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // ② 萌芽鹿｜推倒（對手選擇換上場的寶可夢 ⇒ 試打停在對手的視窗）打附龐克頭盔的【惡】寶可夢 ⇒ selfDamage 要算進反擊的 40
  T('AI_SELF_DAMAGE', () => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s0.players[0], hand: [], deck: many(ID.G, 10), discard: [], prizes: many(ID.G, 6), bench: [inst(ID.filler)], active: inst(ID.deerling, { energyAttached: many(ID.G, 2) }) },
        { ...s0.players[1], hand: [], deck: many(ID.G, 10), discard: [], prizes: many(ID.G, 6), bench: [inst(ID.filler), inst(ID.filler)], active: inst(ID.dark, { toolAttached: inst(ID.punk) }) },
      ] };
    return { selfDamage: M.evaluateAttack(st, 0, 0, pool).selfDamage };
  });
  // 正對照：沒有頭盔 ⇒ 0
  T('AI_SELF_DAMAGE_NONE', () => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s0.players[0], hand: [], deck: many(ID.G, 10), discard: [], prizes: many(ID.G, 6), bench: [inst(ID.filler)], active: inst(ID.deerling, { energyAttached: many(ID.G, 2) }) },
        { ...s0.players[1], hand: [], deck: many(ID.G, 10), discard: [], prizes: many(ID.G, 6), bench: [inst(ID.filler), inst(ID.filler)], active: inst(ID.dark) },
      ] };
    return { selfDamage: M.evaluateAttack(st, 0, 0, pool).selfDamage };
  });
  // ① RocketBasic 篩選（正對照：兩版行為相同）
  T('ROCKET_FILTER', () => {
    const f = (cid) => M.evaluateSelectionFilter('deck-search', 'RocketBasic', inst(cid), pool.get(String(cid)), {});
    return { rb: f(ID.rocketBasic), tr: f(ID.rocketTrainer), other: f(ID.filler) };
  });
  // ① 判準只有一份：selection-filter 有定義、_shared 的同名匯出是同一個函式
  T('ROCKET_ONE_DEF', () => ({ sf: typeof M.SF.isRocketTeamPokemonCard === 'function', same: M.SF.isRocketTeamPokemonCard === M.SH.isRocketTeamPokemonCard }));
  // ① 散寫 0 處
  T('ROCKET_NO_SCATTER', () => ({ n: scatterCount(srcRoot) }));
  return out;
}

const judge = (r) => ({
  AI_SELF_DAMAGE: !!r.AI_SELF_DAMAGE && r.AI_SELF_DAMAGE.selfDamage === 40,
  AI_SELF_DAMAGE_NONE: !!r.AI_SELF_DAMAGE_NONE && r.AI_SELF_DAMAGE_NONE.selfDamage === 0,
  ROCKET_FILTER: !!r.ROCKET_FILTER && r.ROCKET_FILTER.rb === true && r.ROCKET_FILTER.tr === false && r.ROCKET_FILTER.other === false,
  ROCKET_ONE_DEF: !!r.ROCKET_ONE_DEF && r.ROCKET_ONE_DEF.sf === true && r.ROCKET_ONE_DEF.same === true,
  ROCKET_NO_SCATTER: !!r.ROCKET_NO_SCATTER && r.ROCKET_NO_SCATTER.n === 0,
});
const LABEL = {
  AI_SELF_DAMAGE: '★★★ AI 試打停在對手的選擇視窗時，龐克頭盔的反擊（40）估進 selfDamage（v6.533 審查 P3-4）',
  AI_SELF_DAMAGE_NONE: '★ 正對照：沒有頭盔 ⇒ selfDamage 0',
  ROCKET_FILTER: '★ 正對照（零回歸）：RocketBasic 篩選 火箭隊的基礎寶可夢 ✓、火箭隊的訓練家 ✗、其他 ✗',
  ROCKET_ONE_DEF: '★★★ 「火箭隊的寶可夢」判準定義在 selection-filter、_shared 的同名匯出是同一個函式',
  ROCKET_NO_SCATTER: '★★★ src 裡不再有 includes／startsWith(\'火箭隊的\') 散寫（中央定義除外）',
};
const NEW = ['AI_SELF_DAMAGE', 'ROCKET_ONE_DEF', 'ROCKET_NO_SCATTER'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM, ROOT), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6551b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src", "scripts", "static/cards"], tmp);
    linkBaseModules(ROOT, tmp);
    const BM = await load(tmp);
    const B = scenarios(BM, tmp), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.550：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.550：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6551 H', '需要 v6.550 commit');

console.log(`\n=== v6.551 火箭隊判準收斂＋AI 反擊估算：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
