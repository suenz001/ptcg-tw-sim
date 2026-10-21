#!/usr/bin/env node
/**
 * v6.555 守衛（站長回報：沒有點選能量，藍桌墊備戰區卡片上卻一直有 ⚡）：
 *   對戰頁點選附能的 selectedEnergyIid 在「那張卡已不在手牌／這回合已經附過能量」時要自動清掉（v6555-stale-energy-pick）。
 *   判準唯一來源 handCardOps（getHandCardOps 的 'energy' 操作）：A 段驗述詞行為、B 段驗頁面接線。
 * 【H】BASE（v6.554）：NEW 紅、正對照綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.554。
const BASE_SHA = '6b6f2443';
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
const ID = { filler: '19178', W: byName('基本【水】能量') };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(String(v))).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6555-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport { getHandCardOps } from '${p('src/lib/game/hand-card-ops')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function pageWiring(srcRoot) {
  const src = readFileSync(join(srcRoot, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const iDef = src.indexOf('const handCardOps = $derived.by');
  const a = src.indexOf('// >>> v6555-stale-energy-pick'), b = src.indexOf('// <<< v6555-stale-energy-pick');
  const blk = a >= 0 && b > a ? src.slice(a, b) : '';
  return { present: !!blk, afterDef: iDef >= 0 && a > iDef,
    clears: /\$effect\(\(\) => \{\s*if \(selectedEnergyIid && !\(handCardOps\.get\(selectedEnergyIid\)\?\.has\('energy'\)\)\) selectedEnergyIid = null;\s*\}\);/.test(blk) };
}

// 對戰頁手牌 onclick 的本體（與 test-v6200 同一個抽取法），實際執行
function handOnClick(srcRoot) {
  const src = readFileSync(join(srcRoot, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const key = 'onclick={()=>{if(actionBusy){tActSay(TACT_BLOCKED_MSG,5000);return;}';
  const i = src.indexOf(key); if (i < 0) return null;
  const j = src.indexOf('{', i + 'onclick='.length - 1);
  let depth = 0, k = j;
  while (k < src.length) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) break; } k++; }
  const expr = src.slice(j + 1, k); const b = expr.indexOf('{');
  const body = expr.slice(b + 1, expr.lastIndexOf('}'));
  // eslint-disable-next-line no-new-func
  const fn = new Function('actionBusy', 'tActSay', 'TACT_BLOCKED_MSG', 'canEnergy', 'dragging', 'selectedEnergyIid', 'inst', '_suppressHandClickIid',
    'canHandActivate', 'triggerHandActivateAbility', `(() => {${body}})(); return selectedEnergyIid;`);
  return (suppress) => fn(false, () => {}, 'x', true, null, null, { iid: 'E1' }, suppress, false, () => {});
}
function pointerUpSetsSuppress(srcRoot) {
  const src = readFileSync(join(srcRoot, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf('async function onWindowPointerUp(e: PointerEvent) {');
  const blk = i >= 0 ? src.slice(i, i + 700) : '';
  return /dragging = null;\s*if \(d\.moved\) \{[^}]*_suppressHandClickIid = d\.iid;/.test(blk);
}

function scenarios(M, srcRoot) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = (p0 = {}) => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s0.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s0.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler) },
      ] };
  };
  const ops = (st, iid) => [...(M.getHandCardOps(st, 0, pool, { isMyTurn: true }).get(iid) ?? [])];
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // A1 正對照：手牌能量、這回合還沒附 ⇒ 有 'energy'（點選有效）
  T('PRED_CAN', () => { const e = inst(ID.W); return { has: ops(mk({ hand: [e] }), e.iid).includes('energy') }; });
  // A2 正對照：這回合已附過能量 ⇒ 沒有 'energy'（選取要清掉）
  T('PRED_ATTACHED', () => { const e = inst(ID.W); return { has: ops(mk({ hand: [e], energyAttachedThisTurn: true }), e.iid).includes('energy') }; });
  // A3 正對照：那張卡已不在手牌（附上去、被丟棄）⇒ 查無 ⇒ 選取要清掉
  T('PRED_GONE', () => { const e = inst(ID.W); const st = mk({ hand: [] }); return { has: ops(st, e.iid).includes('energy') }; });
  // B 頁面接線：handCardOps 之後有一個 $effect 依同一份判準清掉 selectedEnergyIid
  T('PAGE_WIRING', () => pageWiring(srcRoot));
  // C 審查 P1（Chromium 實測：拖曳放開後瀏覽器補發 click）：剛拖完的那張 ⇒ 這次 click 不可以把它點選起來；一般點擊照常點選
  T('CLICK_AFTER_DRAG', () => { const run = handOnClick(srcRoot); if (!run) return 'NOBODY';
    let afterDrag, normal; try { afterDrag = run('E1'); } catch (e) { afterDrag = 'ERR'; } try { normal = run(null); } catch (e) { normal = 'ERR'; }
    return { afterDrag, normal, pointerUp: pointerUpSetsSuppress(srcRoot) }; });
  return out;
}

const judge = (r) => ({
  PRED_CAN: !!r.PRED_CAN && r.PRED_CAN.has === true,
  PRED_ATTACHED: !!r.PRED_ATTACHED && r.PRED_ATTACHED.has === false,
  PRED_GONE: !!r.PRED_GONE && r.PRED_GONE.has === false,
  CLICK_AFTER_DRAG: !!r.CLICK_AFTER_DRAG && r.CLICK_AFTER_DRAG.afterDrag === null && r.CLICK_AFTER_DRAG.normal === 'E1' && r.CLICK_AFTER_DRAG.pointerUp === true,
  PAGE_WIRING: !!r.PAGE_WIRING && r.PAGE_WIRING.present === true && r.PAGE_WIRING.afterDef === true && r.PAGE_WIRING.clears === true,
});
const LABEL = {
  PRED_CAN: '★ 正對照：手牌能量、這回合還沒附 ⇒ 判準允許附能（選取保留）',
  PRED_ATTACHED: '★ 正對照：這回合已附過能量 ⇒ 判準不允許（選取會被清掉）',
  PRED_GONE: '★ 正對照：選取的卡已不在手牌 ⇒ 查無（選取會被清掉）',
  CLICK_AFTER_DRAG: '★★★ 拖曳放開後瀏覽器補發的 click 不會把拖過的能量點選起來；一般點擊照常點選（審查 P1）',
  PAGE_WIRING: '★★★ 對戰頁：handCardOps 之後有 $effect，選取的能量不能附（不在手牌／已附過）就清掉 selectedEnergyIid（站長回報的 ⚡ 殘留）',
};
const NEW = ['PAGE_WIRING', 'CLICK_AFTER_DRAG'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM, ROOT), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6555b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src", "scripts", "static/cards"], tmp);
    linkBaseModules(ROOT, tmp);
    const BM = await load(tmp);
    const B = scenarios(BM, tmp), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.554：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.554：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6555 H', '需要 v6.554 commit');

console.log(`\n=== v6.555 過期的附能選取自動清掉：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
