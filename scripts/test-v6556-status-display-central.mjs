#!/usr/bin/env node
/**
 * v6.556 守衛：特殊狀態的圖示與用詞收斂到 src/lib/game/status-display.ts（唯一出口）。
 *   起因：v6.555 調查 ⚡ 殘留時發現備戰區狀態小標籤「不認得的值」一律顯示 ⚡（和附能提示長得一樣）；
 *   一併找到：①介面寫「燒傷」，台灣官方卡面一律「灼傷」；②手機版第二狀態槽寫成
 *   「secondary==='poisoned' || tertiary==='poisoned'」⇒ 灼傷＋中毒時第二個標籤也顯示中毒；③放大檢視漏第三狀態槽。
 *
 *   A 段：中央模組的單元行為。
 *   B 段：把對戰頁／手機版「所有狀態標籤」裡的 {運算式} 抽出來實際求值（餵假的寶可夢），斷言輸出。
 *   C 段：對戰紀錄（引擎寶可夢檢查的灼傷、擲幣附加狀態）用官方用詞。
 * 【H】BASE（v6.555）：A／B1／B2／B4／B5／C 紅、B3 正對照綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.555。
const BASE_SHA = 'a779f628';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const FIVE = ['poisoned', 'burned', 'asleep', 'confused', 'paralyzed'];
const ICON = { poisoned: '☠️', burned: '🔥', asleep: '💤', confused: '😵', paralyzed: '⚡' };
const NAME = { poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺' };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6556-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const assets="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  const hasLeaf = existsSync(join(srcRoot, 'src/lib/game/status-display.ts'));
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\n`
    + `export { coinStatusPost } from '${p('src/lib/game/effects')}';\n`
    + (hasLeaf ? `export * as SD from '${p('src/lib/game/status-display')}';\n` : 'export const SD = null;\n'));
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// ── 從 svelte 原始碼抽出所有「狀態標籤」元素裡的 {運算式}（大括號配對） ──
const CHIP_CLASS = /class="(status-chip-sm|status-chip|mp-status|mp-pick-status|retreat-status|status-piece)\b[^"]*"[^>]*>/g;
function chipExprs(src) {
  const out = [];
  let m;
  CHIP_CLASS.lastIndex = 0;
  while ((m = CHIP_CLASS.exec(src))) {
    const start = m.index + m[0].length;
    const endTag = src.slice(start).search(/<\/(div|span)>/);
    if (endTag < 0) continue;
    const body = src.slice(start, start + endTag);
    const exprs = [];
    // 取 body 內最外層的 {…}（跳過 svelte 區塊標記 {#…}{/…}{:…}{@…}）
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== '{') continue;
      if ('#/:@'.includes(body[i + 1])) continue;
      let d = 0, k = i;
      for (; k < body.length; k++) { if (body[k] === '{') d++; else if (body[k] === '}') { d--; if (d === 0) break; } }
      if (k >= body.length) break;
      exprs.push(body.slice(i + 1, k).trim());
      i = k;
    }
    // 一個標籤元素＝一筆（裡面可能有多個 {…}，求值時串起來看整個標籤顯示什麼）
    // 標籤自己宣告的槽（class 裡的 status-{X.secondaryStatus} 之類）：比「運算式讀了哪些槽」可靠——
    //   BASE 手機版第二槽的運算式同時讀 secondary 與 tertiary，靠運算式判斷會把它跳過（安慰劑）。
    const tagSlot = (m[0].match(/-\{[\w.]*?\b(secondaryStatus|tertiaryStatus|status)\}/) || [])[1] || null;
    if (exprs.some((x) => /status|Status|\bzs\b/.test(x))) out.push({ cls: m[1], exprs, tagSlot });
  }
  return out;
}
const VARS = ['b', 'item', 'inst', 'tinst', 'zoomInst', 'zs', 'oppPlayer', 'myPlayer', 'statusIcon', 'statusLabel', 'statusSlots'];
function evalExpr(e, fakeInst, zsVal, SD) {
  return e.exprs.map((x) => evalOne(x, fakeInst, zsVal, SD)).join(' ');
}
function evalOne(expr, fakeInst, zsVal, SD) {
  // eslint-disable-next-line no-new-func
  const fn = new Function(...VARS, `return (${expr});`);
  return String(fn(fakeInst, fakeInst, fakeInst, fakeInst, fakeInst, zsVal, { active: fakeInst }, { active: fakeInst },
    SD?.statusIcon, SD?.statusLabel, SD?.statusSlots));
}
// 這個運算式讀的是哪一個狀態槽（只讀一個時才回傳）
function slotOf(expr) {
  const s = new Set();
  for (const m of expr.matchAll(/\b(secondaryStatus|tertiaryStatus|status)\b/g)) s.add(m[1]);
  return s.size === 1 ? [...s][0] : null;
}

async function scenarios(M, srcRoot) {
  const r = {};
  const SD = M.SD;
  // A：中央模組
  r.A1 = !!SD && FIVE.every((s) => SD.statusIcon(s) === ICON[s]);
  r.A2 = !!SD && SD.statusIcon('weird') === '❓' && !SD.statusIcon('weird').includes('⚡') && SD.statusIcon(undefined) === '';
  r.A3 = !!SD && FIVE.every((s) => SD.statusLabel(s) === `${ICON[s]} ${NAME[s]}`);
  r.A4 = !!SD && SD.statusLabel('weird') === '❓ weird' && SD.statusLabel(null) === '';
  r.A5 = !!SD && JSON.stringify(SD.statusSlots({ status: 'asleep', secondaryStatus: 'burned', tertiaryStatus: 'poisoned' })) === '["asleep","burned","poisoned"]'
    && JSON.stringify(SD.statusSlots({ status: 'burned', secondaryStatus: 'burned' })) === '["burned"]'
    && JSON.stringify(SD.statusSlots({ secondaryStatus: 'confused' })) === '["confused"]'
    && JSON.stringify(SD.statusSlots(null)) === '[]';

  // B：介面標籤實際求值
  const files = ['src/routes/game/+page.svelte', 'src/routes/game/MobilePortraitBattle.svelte'];
  const all = [];
  for (const f of files) {
    const src = readFileSync(join(srcRoot, f), 'utf8').replace(/\r\n/g, '\n');
    for (const e of chipExprs(src)) all.push({ ...e, f });
  }
  const nPage = all.filter((e) => e.f.endsWith('+page.svelte')).length, nMob = all.length - nPage;
  // 下限＋逐槽必備（審查 P2：只有總數下限時刪掉一顆標籤不會紅）：戰鬥位 status-chip 雙方 × 三槽各 2 顆、手機三槽各 2 顆
  const cnt = (f, cls, slot) => all.filter((e) => e.f.endsWith(f) && e.cls === cls && e.tagSlot === slot).length;
  const slotsOk = ['status', 'secondaryStatus', 'tertiaryStatus'].every((s) => cnt('+page.svelte', 'status-chip', s) >= 2 && cnt('MobilePortraitBattle.svelte', 'mp-status', s) >= 2)
    && cnt('+page.svelte', 'status-chip-sm', 'status') >= 2;
  r.B0 = nPage >= 11 && nMob >= 8 && slotsOk; r.B0n = `page=${nPage} mobile=${nMob} slotsOk=${slotsOk}`;
  const weird = { status: 'weird', secondaryStatus: 'weird', tertiaryStatus: 'weird' };
  const bad1 = [], bad2 = [], bad3 = [], bad4 = [], bad7 = [];
  let nNoSlot = 0;
  for (const e of all) {
    let w; try { w = evalExpr(e, weird, 'weird', SD); } catch (err) { bad1.push(e.cls + ':throw ' + err.message); continue; }
    if (w.includes('⚡')) bad1.push(`${e.f.split('/').pop()} .${e.cls} → ${w}`);
    for (const s of FIVE) {
      const fake = { status: s, secondaryStatus: s, tertiaryStatus: s };
      const v = evalExpr(e, fake, s, SD);
      if (v.includes(s)) bad7.push(`${e.f.split('/').pop()} .${e.cls}(${s}) → ${v}`);
      if (v.includes('燒傷')) bad2.push(`${e.cls}:${v}`);
      if (!v.includes(ICON[s])) bad3.push(`${e.f.split('/').pop()} .${e.cls}(${s}) → ${v}`);
    }
    // 三個槽各放不同狀態：只讀單一槽的標籤必須顯示「那個槽」的狀態
    // 沒有在 class 宣告槽的標籤（撤退視窗、手機選擇視窗）：必須把三個槽全部列出來
    //   （審查 P2：原本退回用「運算式自己讀的槽」驗它自己＝安慰劑）。放大檢視的 status-piece 由 B5 負責。
    if (!e.tagSlot && e.cls !== 'status-piece') {
      nNoSlot++;
      const mixed = { status: 'asleep', secondaryStatus: 'burned', tertiaryStatus: 'poisoned' };
      const v = evalExpr(e, mixed, null, SD);
      if (!['asleep', 'burned', 'poisoned'].every((x) => v.includes(ICON[x]))) bad4.push(`${e.f.split('/').pop()} .${e.cls}[全部槽] → ${v}`);
      continue;
    }
    const slot = e.tagSlot;
    if (slot) {
      const mixed = { status: 'asleep', secondaryStatus: 'burned', tertiaryStatus: 'poisoned' };
      const v = evalExpr(e, mixed, mixed[slot], SD);
      if (!v.includes(ICON[mixed[slot]])) bad4.push(`${e.f.split('/').pop()} .${e.cls}[${slot}] → ${v}`);
    }
  }
  r.B1 = all.length > 0 && bad1.length === 0; r.B1n = bad1.slice(0, 4).join(' | ');
  r.B2 = all.length > 0 && bad2.length === 0; r.B2n = bad2.slice(0, 4).join(' | ');
  r.B3 = all.length > 0 && bad3.length === 0; r.B3n = bad3.slice(0, 4).join(' | ');
  const nSlotChecked = all.filter((e) => (e.tagSlot || slotOf(e.exprs.join(' '))) && e.f.endsWith('MobilePortraitBattle.svelte') && /secondary|tertiary/.test(e.tagSlot || '')).length;
  r.B4 = all.length > 0 && bad4.length === 0 && nSlotChecked >= 4 && nNoSlot >= 4; r.B4n = `手機第二/三槽檢查數=${nSlotChecked} 未宣告槽標籤數=${nNoSlot} ` + bad4.slice(0, 4).join(' | ');
  r.B7 = all.length > 0 && bad7.length === 0; r.B7n = bad7.slice(0, 4).join(' | ');
  // B5：放大檢視列出三個槽（用 statusSlots 迭代）
  const page = readFileSync(join(srcRoot, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const zi = page.indexOf('<span class="state-k">異常</span>');
  const zblk = zi >= 0 ? page.slice(Math.max(0, zi - 400), zi + 400) : '';
  r.B5 = /\{#if statusSlots\(zoomInst\)\.length > 0\}/.test(zblk) && /\{#each statusSlots\(zoomInst\) as zs, zi\}/.test(zblk) && /statusLabel\(zs\)/.test(zblk);
  // B6：兩支檔案都沒有再就地寫「⚡ 麻痺」三元式（唯一出口）
  r.B6 = files.every((f) => !/'paralyzed'\s*\?\s*'⚡/.test(readFileSync(join(srcRoot, f), 'utf8')));

  // C：對戰紀錄用詞
  const BIG = '10619', DEF = '13163';
  let nn = 0;
  const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const s0 = M.createGame({ name: 'P1', entries: [{ cardId: BIG, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s0.players[0], hand: [], deck: [inst(BIG)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(BIG, { status: 'burned' }), bench: [inst(DEF)] },
      { ...s0.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(DEF), bench: [inst(DEF)] }] };
  const orig = Math.random; Math.random = () => 0.9;
  let out; try { out = M.applyAction(st, { type: 'END_TURN' }, pool); } finally { Math.random = orig; }
  const L = (s) => (s.log || []).map((x) => (typeof x === 'string' ? x : x.message ?? x.text ?? JSON.stringify(x))).join('\n');
  const lg = L(out);
  r.C0 = /受到 20 傷害/.test(lg); // 前置：灼傷真的結算了（正對照）
  r.C1 = /灼傷：/.test(lg) && /灼傷判定/.test(lg) && /反面：灼傷持續/.test(lg) && !/燒傷/.test(lg);
  const runBurn = (rand, dmg) => {
    const s1 = { ...st, players: [{ ...st.players[0], active: inst(BIG, { status: 'burned', damage: dmg }) }, st.players[1]] };
    const o = Math.random; Math.random = () => rand;
    try { return L(M.applyAction(s1, { type: 'END_TURN' }, pool)); } finally { Math.random = o; }
  };
  const lgHeads = runBurn(0, 0), lgKo = runBurn(0.9, 200);
  r.C3 = /正面：灼傷解除/.test(lgHeads) && !/燒傷/.test(lgHeads);
  r.C4 = /因灼傷傷害昏厥/.test(lgKo) && !/燒傷/.test(lgKo);   // v6.571（Rule 40）：「被灼傷傷害擊倒」→「因灼傷傷害昏厥」
  r.C4n = (lgKo.match(/.*昏厥.*/) || [''])[0];
  Math.random = () => 0;
  let o2; try { o2 = M.coinStatusPost('burned')(st, 1, pool); } finally { Math.random = orig; }
  const l2 = L(o2);
  r.C2 = /正面！對手灼傷/.test(l2) && !/燒傷/.test(l2);
  // D1：就地的狀態名稱對照表全部收斂（掃 src 全部 .ts/.svelte）
  //   （複審 P3：原本只認單引號 ⇒ 改用雙引號／引號鍵就逃過）
  // D2：用詞回退防線——剝掉整行註解後，.ts 的字串字面量、.svelte 的任何位置都不得出現「燒傷」
  const hits = [], hits2 = [];
  const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name);
    if (n.isDirectory()) walk(p); else if (/\.(ts|svelte)$/.test(n.name) && !p.endsWith('status-display.ts')) {
      const c = readFileSync(p, 'utf8');
      const rel = p.slice(srcRoot.length + 1);
      if (/poisoned['"`]?\s*:\s*['"`]中毒/.test(c)) hits.push(rel);
      const code = stripCommentsBlankChecked(c, { label: rel });
      const bad = n.name.endsWith('.svelte') ? /燒傷/.test(code) : /(['"`])[^'"`\n]*燒傷[^'"`\n]*\1/.test(code);
      if (bad) hits2.push(rel); } } };
  walk(join(srcRoot, 'src'));
  r.D1 = hits.length === 0; r.D1n = hits.join(', ');
  r.D2 = hits2.length === 0; r.D2n = hits2.join(', ');
  // D2 正對照：判準本身抓得到雙引號、反引號、svelte 文字三種寫法
  const probe = (s, svelte) => { const code = stripCommentsBlankChecked(s); return svelte ? /燒傷/.test(code) : /(['"`])[^'"`\n]*燒傷[^'"`\n]*\1/.test(code); };
  r.D3 = probe('const a = { burned: "燒傷" };\n', false) && probe('x(`對手燒傷`);\n', false) && probe('<span>燒傷</span>\n', true)
    && !probe('// 燒傷 是舊用詞\nconst a = 1;\n', false);
  return r;
}

function judge(r, label) {
  console.log(`\n── ${label} ──`);
  ok('A1 statusIcon 五種狀態各自正確', r.A1);
  ok('A2 不認得的狀態值顯示 ❓（不是 ⚡）、空值為空字串', r.A2);
  ok('A3 statusLabel 用台灣官方用詞（灼傷，不是燒傷）', r.A3);
  ok('A4 statusLabel 不認得的值照原字串加 ❓、空值為空字串', r.A4);
  ok('A5 statusSlots 依序列出三槽、去重、去空', r.A5);
  ok('B0 掃描器下限：抽到的狀態標籤運算式數量', r.B0, r.B0n);
  ok('B1 所有狀態標籤遇到不認得的值都不會顯示 ⚡', r.B1, r.B1n);
  ok('B2 所有狀態標籤都不會出現「燒傷」', r.B2, r.B2n);
  ok('B3 正對照：所有狀態標籤對五種狀態都顯示正確圖示', r.B3, r.B3n);
  ok('B4 三槽各不同時，每個槽的標籤顯示自己那一槽（手機版第二槽不再被第三槽蓋掉）', r.B4, r.B4n);
  ok('B7 狀態標籤不會直接印出英文狀態值（poisoned…）', r.B7, r.B7n);
  ok('B5 放大檢視用 statusSlots 列出三個槽', r.B5);
  ok('B6 對戰頁與手機版不再就地寫「⚡ 麻痺」三元式', r.B6);
  ok('C0 前置：寶可夢檢查的灼傷真的結算（20 傷害）', r.C0);
  ok('C1 對戰紀錄：寶可夢檢查的灼傷用「灼傷」', r.C1);
  ok('C2 對戰紀錄：擲幣附加狀態用「灼傷」', r.C2);
  ok('C3 對戰紀錄：灼傷擲幣正面解除用「灼傷」', r.C3);
  ok('C4 對戰紀錄：灼傷致死用「灼傷」', r.C4, r.C4n);
  ok('D1 src 裡沒有再就地寫五種狀態名稱對照表（只剩 status-display.ts）', r.D1, r.D1n);
  ok('D2 src 的字串／介面文字不再出現「燒傷」', r.D2, r.D2n);
  ok('D3 正對照：D2 判準抓得到三種寫法、放過註解', r.D3);
}

const NEW = await scenarios(await load(ROOT), ROOT);
judge(NEW, 'NEW（本版）');

// ── HEAD-FAIL：BASE 逐條列紅（Rule 41） ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6556 HEAD-FAIL');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6556b-'));
  try {
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = await scenarios(await load(tmp), tmp);
    console.log('\n── BASE（v6.555）HEAD-FAIL 對照 ──');
    const mustRed = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2'];
    for (const k of mustRed) ok(`H ${k} 在 BASE 為紅`, !B[k], JSON.stringify(B[k]));
    for (const k of ['B0', 'B3', 'C0', 'D3']) ok(`H ${k} 正對照在 BASE 為綠`, !!B[k], B[k + 'n']);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.556 特殊狀態顯示中央化：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
