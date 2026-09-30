#!/usr/bin/env node
/**
 * v6.448 守衛：picker／UI 調查找到的四個錯誤（2026-09-30，UI 統一化第 1 步「先修錯誤」）
 *
 *   ① modal-choice（道具拆除器、數字選擇等）選項按鈕原本沒有樣式 ⇒ 整列清單按鈕
 *   ② modal-choice 的提示原本寫「選 1 張 · 已選 0」（它不是選卡）⇒ 改成選項／數字專用提示
 *   ③ 排序牌庫頂（reorder-deck-top）會多顯示「（沒有符合條件的卡牌）」⇒ 排除
 *   ④ 手機直向 picker 卡圖固定 64px（棄牌區 108px）撐破 54px 格子、疊到隔壁張 ⇒ 卡圖跟著格子縮
 *   ⑤ 懸浮進化選單往上長，按鈕靠近畫面頂端時超出畫面 ⇒ 初始位置夾在視窗內
 *
 * 每條判準寫成 (src) => boolean，同時餵目前原始碼（必須全成立）與 v6.447（標 headFail 的必須不成立）。
 * Run: node scripts/test-v6448-picker-bugfixes.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleBlockOf } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.447。
const BASE_SHA = '5b77a3f6e4708346b672b5f8e0e8c32d8d4a0d50';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function styleOf(src) {
  try { return noComments(styleBlockOf(src)); } catch { return ''; }
}
// 手機直向的媒體查詢區塊（本頁有好幾個 ⇒ 全部串起來；每段抓到下一個 @media 為止）
function mobilePortraitCss(src) {
  const css = styleOf(src);
  const KEY = '@media (max-width: 600px) and (orientation: portrait)';
  let out = '', i = css.indexOf(KEY);
  while (i >= 0) {
    const j = css.indexOf('@media', i + 10);
    out += css.slice(i + KEY.length, j > i ? j : undefined).replace(/^\s*\{/, '') + '\n';
    i = css.indexOf(KEY, i + 10);
  }
  return out;
}
function declsOf(css, sel) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) if (m[1].split(',').map((x) => x.trim()).includes(sel)) out.push(m[2]);
  return out.join(';');
}
function fnBody(src, name, next) {
  const i = src.indexOf('  function ' + name + '(');
  const j = src.indexOf('  function ' + next + '(', i);
  return i > 0 && j > i ? src.slice(i, j) : '';
}

const CHECKS = [
  ['★★★[①選項樣式] .btn-act.modal-choice-btn 有整列清單樣式（寬 100%、靠左、可換行）', true, (src) => {
    const d = declsOf(styleOf(src), '.btn-act.modal-choice-btn');
    return /width:100%/.test(d) && /text-align:left/.test(d) && /white-space:normal/.test(d);
  }],
  ['★★[①選項樣式] .modal-choice-list 是直向清單', true, (src) =>
    /flex-direction:column/.test(declsOf(styleOf(src), '.modal-choice-list'))],
  ['★[①選項樣式] 停用選項變暗', true, (src) =>
    /opacity:\.45/.test(declsOf(styleOf(src), '.btn-act.modal-choice-btn:disabled'))],
  ['[①前提] markup 仍用 modal-choice-list／modal-choice-btn 這兩個 class', false, (src) =>
    src.includes('modal-choice-list') && src.includes('modal-choice-btn')],
  ['★★★[②提示] modal-choice 有自己的提示分支（不再顯示「選 N 張」）', true, (src) =>
    /\{:else if pendingSelection\.type === 'modal-choice'\}\s*(<!--[\s\S]*?-->\s*)?<p class="sel-hint">\{pendingSelection\.params\?\.stepper \? '用 ＋／－ 選好數字後按「確認」' : '點一下要執行的選項'\}<\/p>/.test(src)],
  ['★★★[③排序] 「沒有符合條件」排除 reorder-deck-top', true, (src) =>
    src.includes("{#if selectionItems.length===0 && pendingSelection.type !== 'modal-choice' && pendingSelection.type !== 'reorder-deck-top'}<p class=\"sel-empty\">")],
  ['[③前提] 仍然只有一處顯示「沒有符合條件的卡牌」（在 selection-modal 裡）', false, (src) =>
    (src.match(/（沒有符合條件的卡牌）/g) || []).length === 1],
  ['★★★[④手機卡圖] 手機直向 .sel-grid .sel-card img 寬度跟著格子（100%）', true, (src) => {
    const d = declsOf(mobilePortraitCss(src), '.sel-grid .sel-card img');
    return /width:100%/.test(d) && /max-width:100%/.test(d);
  }],
  ['★★[④手機卡圖] 棄牌區檢視器的 108px 卡圖在手機直向也跟著格子', true, (src) =>
    /width:100%/.test(declsOf(mobilePortraitCss(src), '.discard-modal .sel-grid .sel-card img'))],
  ['★[④手機卡圖] 格子可以縮到比卡圖原寬還窄（min-width:0）', true, (src) =>
    /min-width:0/.test(declsOf(mobilePortraitCss(src), '.sel-grid .sel-card'))],
  ['[④前提] 能量 picker 的手機 60px 規則還在（特異度較高、不受影響）', false, (src) =>
    /width:60px/.test(declsOf(mobilePortraitCss(src), '.sel-grid.sel-grid-energy .sel-card img'))],
  ['★★★[⑤進化選單] openFloatingEvo 依選項數估高度，把錨點夾在視窗內', true, (src) => {
    const b = fnBody(src, 'openFloatingEvo', 'openFloatingRetreat');
    return /const estH = 60 \+ evoOpts\.length \* 125;/.test(b)
      && /Math\.min\(Math\.max\(rect\.top, estH \* 1\.05 \+ 8\), vh - 8\)/.test(b)
      && /Math\.min\(Math\.max\(rect\.left \+ rect\.width \/ 2, 90\), vw - 90\)/.test(b)
      && /floatingEvoMenu = \{ fromIid, evoOpts, x, y \};/.test(b);
  }],
  ['[本頁] 媒體查詢數量沒變（被 test-v6187／v6195／v6199 釘住）', false, (src) =>
    (styleOf(src).match(/@media/g) || []).length === (styleOf(BASE_SRC || src).match(/@media/g) || []).length],
];

let BASE_SRC = '';
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  if (r.ok) BASE_SRC = r.out.replace(/\r\n/g, '\n');
}

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、抓得到手機直向區塊', SRC.length > 900000 && mobilePortraitCss(SRC).length > 2000);
for (const c of runAll(SRC)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.447');
if (!BASE_SRC) {
  shallowSkip('v6448 B：HEAD-FAIL 比對', '需要 v6.447 commit');
} else {
  const base = runAll(BASE_SRC);
  const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
  ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.447 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
  const ctlFail = base.filter((c) => !c.headFail && !c.r).map((c) => c.name);
  ok('[正對照] 非 headFail 的結構前提在 v6.447 就成立', ctlFail.length === 0, ctlFail.join(' ｜ '));
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot') && !SRC.includes('__devUI'));

console.log(`\n=== v6.448 picker 錯誤修正: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6448-picker-bugfixes ===');
process.exit(fail ? 1 : 0);
