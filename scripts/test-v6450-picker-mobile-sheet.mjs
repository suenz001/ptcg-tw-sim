#!/usr/bin/env node
/**
 * v6.450 守衛：手機直式的選擇視窗一律「從底部升起的 sheet」（UI 統一化第 4 步，站長 2026-09-30 裁定）
 *
 *   ① 全寬、上方圓角、最高 85dvh、貼齊螢幕下緣（含 home indicator 安全區）
 *   ② 只有 sheet 捲動：格子的 --scroll-list-max 取消、子元素不縮 ⇒ 沒有雙層捲動
 *   ③ 每列固定張數：卡片（含能量）4、寶可夢 3、牌庫全覽 5；卡圖寬＝格寬
 *   ④ 按鈕列按鈕等寬並排、至少 44px 高
 *   ⑤ 棄牌區／獎賞檢視也從底部升起；手機橫式選擇視窗高度上限 90dvh
 *
 * 每條判準寫成 (src) => boolean，同時餵目前原始碼（必須全成立）與 v6.449（標 headFail 的必須不成立）。
 * Run: node scripts/test-v6450-picker-mobile-sheet.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleBlockOf } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.449。
const BASE_SHA = '3e1930f746ec501c8dd02c7c56bbe6a52466dd07';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function styleOf(src) { try { return styleBlockOf(src); } catch { return ''; } }
const KEY = '@media (max-width: 600px) and (orientation: portrait) {';
function sheetRaw(src) {
  const m = /    \/\* >>> v6450-picker-sheet \*\/\n([\s\S]*?)    \/\* <<< v6450-picker-sheet \*\/\n/.exec(src);
  return m ? m[1] : '';
}
const sheet = (src) => noComments(sheetRaw(src));
function declsOf(css, sel) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) if (m[1].split(/,(?![^()]*\))/).map((x) => x.trim()).includes(sel)) out.push(m[2]);
  return out.join(';');
}
// 哨兵所在的媒體查詢區塊：往前找最近的「@media」必須是手機直式那一個，而且它的結尾在哨兵之後
function sheetInsidePortrait(src) {
  const css = styleOf(src);
  const i = css.indexOf('/* >>> v6450-picker-sheet */');
  if (i < 0) return false;
  const lastMedia = css.lastIndexOf('@media', i);
  if (css.slice(lastMedia, lastMedia + KEY.length) !== KEY) return false;
  // 從該 @media 開頭數大括號，確認哨兵結尾在區塊關閉之前
  const body = noComments(css.slice(lastMedia));
  let d = 0, end = -1;
  for (let k = 0; k < body.length; k++) { if (body[k] === '{') d++; else if (body[k] === '}') { d--; if (d === 0) { end = k; break; } } }
  const inner = body.slice(0, end);
  return end > 0 && inner.includes('.zoom-modal.discard-modal{') && inner.includes('.sel-footer::before{ display:none; }');
}

const CHECKS = [
  ['★★★[位置] 哨兵寫在手機直式的媒體查詢區塊裡（桌機、手機橫式不受影響）', true, sheetInsidePortrait],
  ['★★★[①sheet] 選擇視窗全寬、上方圓角、最高 85dvh、底部留安全區', true, (src) => {
    const d = declsOf(sheet(src), '.selection-modal');
    return /width:100vw/.test(d) && /max-width:100vw/.test(d) && /max-height:85dvh/.test(d)
      && /border-radius:16px 16px 0 0/.test(d) && /var\(--safe-bottom, 0px\)/.test(d);
  }],
  ['★★★[①sheet] 遮罩把視窗排到下緣（原本貼頂）', true, (src) => /align-items:flex-end/.test(declsOf(sheet(src), '.selection-overlay'))],
  ['★★[②捲動] 格子不再自己捲（--scroll-list-max:none）、子元素不縮', true, (src) => {
    const c = sheet(src);
    return /--scroll-list-max:none/.test(declsOf(c, '.selection-modal .sel-grid')) && /--scroll-list-max:none/.test(declsOf(c, '.selection-modal .retreat-grid'))
      && /flex-shrink:0/.test(declsOf(c, '.selection-modal > *'));
  }],
  ['★★★[③張數] 卡片每列 4 張（含能量）、寶可夢 3 隻、牌庫全覽 5 張', true, (src) => {
    const c = sheet(src);
    return /repeat\(4, minmax\(0, 1fr\)\) !important/.test(declsOf(c, '.sel-grid')) && /repeat\(4, minmax\(0, 1fr\)\) !important/.test(declsOf(c, '.sel-grid.sel-grid-energy'))
      && /repeat\(3, minmax\(0, 1fr\)\)/.test(declsOf(c, '.retreat-grid')) && /repeat\(5, minmax\(0, 1fr\)\)/.test(declsOf(c, '.full-deck-list'));
  }],
  ['★★[③卡圖] 能量卡圖與寶可夢卡圖跟著格子寬', true, (src) => {
    const c = sheet(src);
    return /width:100%/.test(declsOf(c, '.sel-grid.sel-grid-energy .sel-card img')) && /width:100%/.test(declsOf(c, '.retreat-pick img'));
  }],
  ['★★★[④按鈕] 按鈕列按鈕等寬並排、至少 44px 高；手機不用彈簧', true, (src) => {
    const c = sheet(src);
    return c.includes('.sel-footer > :is(button, .btn-act, .btn-primary, .btn-ghost){ flex:1 1 0; min-height:44px;') && /display:none/.test(declsOf(c, '.sel-footer::before'));
  }],
  ['★★[⑤檢視] 棄牌區／獎賞檢視也從底部升起', true, (src) => {
    const c = sheet(src);
    const d = declsOf(c, '.zoom-modal.discard-modal');
    return /width:100vw/.test(d) && /max-height:85dvh/.test(d) && /border-radius:16px 16px 0 0/.test(d)
      && /align-items:flex-end/.test(declsOf(c, '.zoom-overlay:has(> .discard-modal)'));
  }],
  ['★★[⑤橫式] 手機橫式選擇視窗高度上限 90dvh（仍置中、580px）', true, (src) =>
    src.includes('    .selection-modal{ max-width:580px; width:96vw; max-height:90dvh; padding:0.6rem; gap:0.4rem; }\n')],
  ['[前提] 桌機的 v6449 外框區塊還在（手機 sheet 是在它之後由媒體查詢覆蓋）', false, (src) => src.includes('/* >>> v6449-picker-shell */')],
  ['[前提] 手機直式遮罩仍不擋背景觸控（pointer-events:none，v4.969）', false, (src) =>
    /\.selection-overlay \{\n\s*background: rgba\(0, 0, 0, 0\.4\);\n\s*pointer-events: none;/.test(src)],
  ['[本頁] 哨兵內沒有媒體查詢，整頁媒體查詢數量沒變', false, (src) =>
    !/@media/.test(sheet(src)) && (styleOf(src).match(/@media/g) || []).length === (styleOf(BASE_SRC || src).match(/@media/g) || []).length],
];

let BASE_SRC = '';
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  if (r.ok) BASE_SRC = r.out.replace(/\r\n/g, '\n');
}
function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、找得到 v6450-picker-sheet 區塊', SRC.length > 900000 && sheetRaw(SRC).length > 1000);
for (const c of runAll(SRC)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.449');
if (!BASE_SRC) {
  shallowSkip('v6450 B：HEAD-FAIL 比對', '需要 v6.449 commit');
} else {
  const base = runAll(BASE_SRC);
  const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
  ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.449 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
  const ctlFail = base.filter((c) => !c.headFail && !c.r).map((c) => c.name);
  ok('[正對照] 非 headFail 的結構前提在 v6.449 就成立', ctlFail.length === 0, ctlFail.join(' ｜ '));
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot') && !SRC.includes('__devUI'));

console.log(`\n=== v6.450 picker 手機底部 sheet: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6450-picker-mobile-sheet ===');
process.exit(fail ? 1 : 0);
