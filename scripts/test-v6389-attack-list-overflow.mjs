#!/usr/bin/env node
/**
 * v6.389 守衛：招式清單溢出（玩家回報「夢幻ex｜記憶螺旋 後面的招式按不下去」）
 *
 * ⚠ 根因不是「清單長」，是 Fable 版（桌機 ≥1024px 的**預設**版面）只釘死 3 個招式槽
 *   （`.atk-slot:nth-of-type(1|2|3){ grid-row:1|2|3 }`），第 4 個以後被 CSS Grid 排到
 *   「悔棋」按鈕**下方**，再被 `.playmat.layout-fable{overflow:hidden}` ＋
 *   `.battle-root{overflow:hidden}` **實體裁掉** —— 不是被蓋住，是根本沒被畫出來，整頁還捲不動。
 * ⚠ 這不是記憶螺旋專屬：古空棘魚｜潛入記憶（v3.08 起）配 2 階進化就有 7 招。
 *
 * 【A】行為層 —— 真的 bundle 引擎跑 getEffectiveAttacks（不是比字串）
 * 【B】index 對齊 —— 把 UI 的 groupAttacksBySource **抽出來實跑**
 *      ⚠⚠ 這是本版最嚴重的風險：i 是 getEffectiveAttacks() 的 index，initiateAttack(i) 直接吃它。
 *         分組時排序或過濾 ⇒ **打錯招式**。
 * 【C】接線層 —— markup／CSS 契約（HEAD-FAIL：對 BASE 的 +page.svelte 跑同一組必須紅）
 * 【D】在 npm test chain 裡
 *
 * ⚠ 誠實聲明：這支守衛**不驗 hit-testing**（沒有瀏覽器，做不了 elementFromPoint）。
 *   「會不會被卡片蓋住」是用**設計**消滅的 —— picker 走 .selection-modal（position:fixed ＋ 高 z-index），
 *   結構上就不可能被 .playmat 的 overflow:hidden 裁掉、也不可能被 bench 卡片蓋住。
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'scripts/test-v6389-attack-list-overflow.mjs';
// ⚠ BASE_SHA 必須是留在 main 上的那一顆（IRON_RULES Rule 45）：
//   驗法 `git branch -a --contains 6d715d5f` 要印得出 main。
const BASE_SHA = '6d715d5f3a759a4cfa899b112cccbcb34694d931';   // v6.388g（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS ' + name); return true; }
  fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
  return false;
};

const PAGE = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, PAGE), 'utf8');

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}

// ── 引擎 bundle ─────────────────────────────────────────────────────────────
async function bundleEngine() {
  const S = join(ROOT, '.v6389-s.js'), E = join(ROOT, '.v6389-e.ts'), O = join(ROOT, '.v6389-o.mjs');
  process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, "export { getEffectiveAttacks, getBenchLimit } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  return import(pathToFileURL(O).href);
}
const ENG = await bundleEngine();

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【0】fixture 自驗');
// ═══════════════════════════════════════════════════════════════════════════
// ⚠ 每張卡最多幾招是**掃出來的**，不是寫死 —— 日後出了 4 招的卡，上界會自己跟上。
const MAX_ATK_PER_CARD = all.reduce((m, c) => Math.max(m, (c.attacks || []).length), 0);
chk('0a ★ 掃得出「單張卡最多幾招」（下限斷言：至少要有 2）', MAX_ATK_PER_CARD >= 2, String(MAX_ATK_PER_CARD));
const MEW = all.find((c) => (c.abilities || []).some((a) => a.name === '記憶螺旋'));
chk('0b ★ 找得到帶「記憶螺旋」的卡（夢幻ex）', !!MEW, JSON.stringify({ n: MEW?.name, id: MEW?.id }));
// 挑一張「卡面招式數 = MAX_ATK_PER_CARD」的基礎寶可夢當備戰肉
const FAT = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && (c.attacks || []).length === MAX_ATK_PER_CARD)
  || all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && (c.attacks || []).length >= 2);
chk('0c ★ 找得到招式數最多的基礎寶可夢當備戰樣本', !!FAT,
  JSON.stringify({ n: FAT?.name, atk: (FAT?.attacks || []).length }));

// ── 盤面 helper ─────────────────────────────────────────────────────────────
const mon = (cid, iid, o = {}) => ({ iid, cardId: String(cid), damage: 0, energyAttached: [], ...o });
const PL = (name, o = {}) => ({ name, active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...o });
const ST = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [p0, p1], ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】行為層：記憶螺旋真的會把招式清單撐爆');
// ═══════════════════════════════════════════════════════════════════════════
const benchOf = (n) => Array.from({ length: n }, (_, k) => mon(FAT.id, 'b' + k));
{
  const st = ST(PL('P0', { active: mon(MEW.id, 'atk'), bench: benchOf(5) }), PL('P1', { active: mon(FAT.id, 'd') }));
  const eff = ENG.getEffectiveAttacks(st, st.players[0].active, pool);
  const expect = (MEW.attacks || []).length + 5 * (FAT.attacks || []).length;
  chk('A1 ⭐⭐⭐ 備戰 5 隻（每隻 ' + (FAT.attacks || []).length + ' 招）⇒ 招式數 = 自己 + 5×每隻（公式算，不是寫死）',
    eff.length === expect, JSON.stringify({ got: eff.length, expect }));
  chk('A1b ⭐⭐ 而且它**超過**行動列的內嵌上限（＝這個 bug 真的會發生）',
    eff.length > 3, String(eff.length));
}
{
  // ★ 正對照：拿掉記憶螺旋 ⇒ 只剩自己的卡面招式（證明 A1 不是恆真）
  const noAbil = { ...MEW, abilities: [] };
  const pool2 = new Map(pool); pool2.set(String(MEW.id), noAbil);
  const st = ST(PL('P0', { active: mon(MEW.id, 'atk'), bench: benchOf(5) }), PL('P1', { active: mon(FAT.id, 'd') }));
  const eff = ENG.getEffectiveAttacks(st, st.players[0].active, pool2);
  chk('A2 ★★ 正對照：拿掉「記憶螺旋」⇒ 招式數掉回自己的卡面數',
    eff.length === (MEW.attacks || []).length, String(eff.length));
}
{
  // 備戰上限走真函式（不硬寫 5／8）
  const st = ST(PL('P0', { active: mon(MEW.id, 'atk'), bench: [] }), PL('P1', { active: mon(FAT.id, 'd') }));
  const lim = ENG.getBenchLimit(st, 0, pool);
  chk('A3 ★ 備戰上限走真函式 getBenchLimit（理論上界 = 自己 + 上限×每張最多招式數）',
    typeof lim === 'number' && lim >= 5,
    JSON.stringify({ benchLimit: lim, upperBound: (MEW.attacks || []).length + lim * MAX_ATK_PER_CARD }));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐⭐ index 對齊：把 UI 的 groupAttacksBySource 抽出來**實跑**');
// ═══════════════════════════════════════════════════════════════════════════
// ⚠ i 是 getEffectiveAttacks() 的 index，initiateAttack(i) 直接吃它。
//   分組時排序或過濾 ⇒ 打錯招式。這是本版最嚴重的風險。
function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  // ⚠ 不可以直接 indexOf('{', at) —— 參數的**型別註記**裡就有 `{`
  //   （function f(eff: { atk: any }[]) …），那樣大括號平衡一開始就錯。
  //   先用小括號平衡找到參數列表的結尾，再從那之後找 body 的 `{`。
  let pd = 0, close = -1;
  for (let k = src.indexOf('(', at); k < src.length; k++) {
    if (src[k] === '(') pd++;
    else if (src[k] === ')') { pd--; if (pd === 0) { close = k; break; } }
  }
  if (close < 0) return null;
  const i = src.indexOf('{', close);
  if (i < 0) return null;
  let d = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(at, k + 1); }
  }
  return null;
}
{
  const fnSrc = extractFn(SRC, 'groupAttacksBySource');
  // ★ 抽取器自驗：抽出來的必須是完整的函式（不是被型別註記截斷的半截）
  if (!chk('B0 ⭐ 抽得出 groupAttacksBySource 的**完整**原始碼（抽取器自驗）',
      !!fnSrc && fnSrc.trimEnd().endsWith('}') && fnSrc.includes('return out;'),
      JSON.stringify({ len: fnSrc?.length ?? 0, tail: (fnSrc || '').trimEnd().slice(-20) }))) {
    // 抽不出來就不要假裝下面幾條通過
  } else {
    const js = transformSync(fnSrc, { loader: 'ts' }).code;
    // eslint-disable-next-line no-new-func
    const group = new Function(js + '\nreturn groupAttacksBySource;')();
    const st = ST(PL('P0', { active: mon(MEW.id, 'atk'), bench: benchOf(5) }), PL('P1', { active: mon(FAT.id, 'd') }));
    const eff = ENG.getEffectiveAttacks(st, st.players[0].active, pool);
    const groups = group(eff);
    const flat = groups.flatMap((g) => g.items);
    chk('B1 ⭐⭐⭐ 分組後攤平的**張數**與原本一模一樣（不得過濾掉任何招式）',
      flat.length === eff.length, JSON.stringify({ flat: flat.length, eff: eff.length }));
    chk('B2 ⭐⭐⭐ 每一項的 i 都指回**同一個** atk 物件（不得排序 ⇒ 打錯招式）',
      flat.every((it) => eff[it.i] && eff[it.i].atk === it.atk),
      JSON.stringify(flat.filter((it) => !(eff[it.i] && eff[it.i].atk === it.atk)).slice(0, 3).map((it) => it.i)));
    chk('B3 ⭐⭐ i 的集合恰好是 0..n-1（不重、不漏）',
      new Set(flat.map((it) => it.i)).size === eff.length
      && flat.every((it) => Number.isInteger(it.i) && it.i >= 0 && it.i < eff.length),
      JSON.stringify(flat.map((it) => it.i).slice(0, 8)));
    chk('B4 ⭐ 分組真的有分（備戰借來的招式不會全部擠在同一組）',
      groups.length >= 2, JSON.stringify(groups.map((g) => g.label)));
    // ★ 突變自檢：把同一份輸入排序過再餵，B2 必須抓得到
    const shuffled = groups.map((g) => ({ ...g, items: [...g.items].reverse() }));
    const flatShuf = shuffled.flatMap((g) => g.items);
    chk('B5 ★★ 判準自檢：把 items 反轉後，「i 指回同一個 atk」仍成立（證明 B2 驗的是 i↔atk 綁定，不是順序）',
      flatShuf.every((it) => eff[it.i] && eff[it.i].atk === it.atk));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】接線層：markup／CSS 契約（HEAD-FAIL 對 BASE 必紅）');
// ═══════════════════════════════════════════════════════════════════════════
const CONTRACTS = [
  ['C1 ⭐⭐ 招式清單有「內嵌 vs picker」的分支，且閾值走單一來源常數',
    (s) => /\{#if\s+eff\.length\s*<=\s*ATTACK_LIST_INLINE_MAX\}/.test(s)],
  ['C2 ⭐⭐ 常數是 import 進來的（不是就地寫一個數字）',
    (s) => /import\s*\{\s*ATTACK_LIST_INLINE_MAX\s*\}\s*from\s*'\$lib\/ui-limits'/.test(s)],
  ['C3 ⭐⭐ 超過閾值時開的是 attackListPicker（不是繼續往行動列塞）',
    (s) => /attackListPicker\s*=\s*\{\s*eff\s*\}/.test(s)],
  ['C4 ⭐⭐⭐ picker 走 .selection-modal（position:fixed ＋ 高 z-index ⇒ 結構上不可能被卡片蓋住／被裁掉）',
    (s) => /\{#if attackListPicker\}[\s\S]{0,400}selection-modal/.test(s)],
  ['C5 ⭐⭐ picker 的清單掛了 scroll-list（可捲）',
    (s) => /copy-attack-list scroll-list/.test(s)],
  ['C6 ⭐⭐ .scroll-list 真的有 overflow-y:auto ＋ max-height',
    (s) => /\.scroll-list\{[\s\S]{0,400}overflow-y:auto[\s\S]{0,400}max-height:var\(--scroll-list-max/.test(s)],
  ['C7 ⭐⭐⭐ 收合鈕在 Fable 版佔 grid-row:1（不指定就會吃 .btn-act.primary 的 grid-row:4，跟「跳過攻擊」搶格）',
    (s) => /\.action-btns\s*>\s*\.btn-act\.atk-overflow\{\s*grid-row:1;\s*\}/.test(s)],
];
for (const [name, f] of CONTRACTS) chk(name, f(SRC));

// ★★★ HEAD-FAIL：對 BASE（v6.388g）的 +page.svelte 跑同一組契約，**每一條都必須紅**
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6.389【C】HEAD-FAIL', '需要歷史 commit');
} else {
  const b = readBaseBlob(ROOT, BASE_SHA, PAGE);
  if (!b.ok) chk('C8 ⭐⭐⭐ HEAD-FAIL：讀得到 BASE 的 +page.svelte', false, 'readBaseBlob 失敗');
  else {
    const reds = CONTRACTS.filter(([, f]) => !f(b.out)).length;
    chk('C8 ⭐⭐⭐ HEAD-FAIL：BASE(v6.388g) 的 +page.svelte **每一條契約都不成立**',
      reds === CONTRACTS.length, JSON.stringify({ red: reds, total: CONTRACTS.length }));
    // ★ 哨兵：BASE 的檔案是活的（不是讀成空字串讓上面那條恆真）
    chk('C8b ★ 哨兵：BASE 的 +page.svelte 讀得到內容且含招式渲染區塊',
      b.out.length > 100000 && b.out.includes('getEffectiveAttacks(game, activePlayer.active, pool)'),
      String(b.out.length));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】在 npm test chain 裡');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const chain = String(pkg.scripts?.test || '').split('&&').map((s) => s.trim()).filter(Boolean);
  chk('D1 ⭐ scripts.test 裡**恰好**有本檔一次',
    chain.filter((s) => s === 'node ' + SELF).length === 1,
    String(chain.filter((s) => s === 'node ' + SELF).length));
}

console.log(`\n=== v6.389 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
