#!/usr/bin/env node
/**
 * v6.449 守衛：選擇視窗（picker）桌機統一化（UI 統一化第 3 步，站長 2026-09-30 裁定）
 *
 *   ① 外框三級寬度 S 480／M 760／L 960，一律 min(尺寸, 100vw − 32px)、border-box、高度上限 85dvh、視窗內捲動
 *   ② 按鈕列黏底；次要在左、主要在右；btn-ghost／無 primary 的 btn-act 一律次要樣式
 *   ③ 可選卡圖 96px（不超過格子）；牌庫全覽 72px
 *   ④ 遮罩統一 .82；撤退選單點遮罩不關閉（要做決定的視窗）
 *   ⑤ 新版桌墊：視窗配色跟著桌墊（深藍＋白框線）；其他版面維持深綠
 *
 * 每條判準寫成 (src) => boolean，同時餵目前原始碼（必須全成立）與 v6.448（標 headFail 的必須不成立）。
 * Run: node scripts/test-v6449-picker-desktop-shell.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleBlockOf } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.448。
const BASE_SHA = 'aeb36339db7e9af973519898e02ae1ee014ff9a6';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function styleOf(src) { try { return styleBlockOf(src); } catch { return ''; } }
function shellRaw(src) {
  const m = /  \/\* >>> v6449-picker-shell \*\/\n([\s\S]*?)  \/\* <<< v6449-picker-shell \*\/\n/.exec(src);
  return m ? m[1] : '';
}
const shell = (src) => noComments(shellRaw(src));
function blueCss(src) {
  const m = /\/\* >>> v6441-blue-css \*\/([\s\S]*?)\/\* <<< v6441-blue-css \*\//.exec(src);
  return noComments(m ? m[1] : '');
}
function declsOf(css, sel) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) if (m[1].split(/,(?![^()]*\))/).map((x) => x.trim()).includes(sel)) out.push(m[2]);
  return out.join(';');
}
const B = '.battle-root:has(.playmat.layout-blue)';

const CHECKS = [
  ['★★★[①尺寸] 三級寬度與卡圖尺寸變數：S 480／M 760／L 960、卡圖 96', true, (src) => {
    const d = declsOf(shell(src), '.selection-overlay');
    return /--pk-s:480px/.test(d) && /--pk-m:760px/.test(d) && /--pk-l:960px/.test(d) && /--pk-card:96px/.test(d);
  }],
  ['★★★[①外框] .selection-modal：預設 M、min(尺寸, 100vw − 32px)、border-box、85dvh、視窗內捲動', true, (src) => {
    const d = declsOf(shell(src), '.selection-modal');
    return /--pk-w:var\(--pk-m\)/.test(d) && /max-width:min\(var\(--pk-w\), calc\(100vw - 32px\)\)/.test(d)
      && /box-sizing:border-box/.test(d) && /max-height:85dvh/.test(d) && /overflow-y:auto/.test(d);
  }],
  ['★★[①S] 選項／數字視窗（pk-s）與重抽視窗用 S', true, (src) =>
    /--pk-w:var\(--pk-s\)/.test(declsOf(shell(src), ':where(.selection-modal).pk-s'))
    && /--pk-w:var\(--pk-s\)/.test(declsOf(shell(src), ':where(.selection-modal).mulligan-modal:not(.mulligan-reveal-modal)'))],
  ['★★[①L] 棄牌區／獎賞檢視用 L', true, (src) => {
    const d = declsOf(shell(src), ':where(.zoom-modal).discard-modal');
    return /--pk-w:var\(--pk-l\)/.test(d) && /max-width:min\(var\(--pk-w\), calc\(100vw - 32px\)\)/.test(d);
  }],
  ['★[①特異度] 寬度變體一律用 :where() 包住（特異度不高於手機直式的 .selection-modal／.zoom-modal，手機仍由媒體查詢蓋回）', true, (src) => {
    const sels = [...shell(src).matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => /pk-s|mulligan-modal|discard-modal\b(?! \.)/.test(s) && !/\.sel-/.test(s));
    return sels.length >= 2 && sels.every((s) => s.split(',').every((p) => p.trim().startsWith(':where(')));
  }],
  ['★★★[②按鈕列] 按鈕列黏在視窗底部', true, (src) => {
    const d = declsOf(shell(src), '.selection-modal > .sel-footer');
    return /position:sticky/.test(d) && /bottom:0/.test(d);
  }],
  ['★★★[②按鈕列] 次要在左、主要在右（::before 彈簧＋次要 order:-1）', true, (src) => {
    const c = shell(src);
    return /flex:1 1 0/.test(declsOf(c, '.sel-footer::before')) && c.includes('.sel-footer > :is(.btn-act.secondary, .btn-ghost, .btn-act:not(.primary)){ order:-1; }')
      && /justify-content:flex-start/.test(declsOf(c, '.sel-footer'));
  }],
  ['★★[②按鈕] btn-ghost 在視窗內有次要樣式（原本是瀏覽器預設灰鈕）；stepper 鈕除外', true, (src) =>
    /background:#2a3a5a/.test(declsOf(shell(src), '.selection-modal .btn-ghost:not(.stepper-btn)'))],
  ['★★★[③卡圖] 可選卡圖＝var(--pk-card) 且不超過格子寬', true, (src) => {
    const d = declsOf(shell(src), '.sel-card img');
    return /width:var\(--pk-card\)/.test(d) && /max-width:100%/.test(d) && declsOf(shell(src), '.discard-modal .sel-card img') === d;
  }],
  ['★★[③卡圖] 格子最小 112px（96＋內距＋框線）', true, (src) => /minmax\(112px,1fr\)/.test(declsOf(shell(src), '.sel-grid'))],
  ['★[③卡圖] 暗黑底牌卡圖、蓋著的獎賞卡背同尺寸；牌庫全覽 72px', true, (src) => {
    const c = shell(src);
    return /width:var\(--pk-card\)/.test(declsOf(c, '.copy-attack-img')) && /width:var\(--pk-card\)/.test(declsOf(c, '.prize-view-cardback'))
      && /minmax\(72px,1fr\)/.test(declsOf(c, '.full-deck-list'));
  }],
  ['★★[④遮罩] 檢視類遮罩改 .82（與選擇視窗一致）', true, (src) => /rgba\(0,0,0,\.82\)/.test(declsOf(shell(src), '.zoom-overlay'))],
  // ⭐v6.454（審查 A，Rule 40 意圖不變）：桌機仍「點遮罩不關」；手機直式因為撤退選單不是 pending picker、要擋住背後觸控，
  //   改成「只有手機直式點外面才關」（原本手機自己的撤退 sheet 就是點外即關）——判準收緊成「非手機直式一律不關」。
  ['★★★[④關閉] 撤退選單點遮罩不再關閉（桌機；手機直式例外見 test-v6454）', true, (src) => {
    if (src.includes('<div class="selection-overlay" onclick={() => floatingRetreatMenu = null}>')) return false;
    const tail = '\n      <div class="selection-modal retreat-modal" use:modalDrag={{ resetKey: pendingSelection?.token ?? pendingSelection?.effectKey }} onclick={(e)=>e.stopPropagation()}>\n        <div class="sel-header" title="拖曳視窗">\n          <h3>🔄 選擇換入的寶可夢</h3>';
    return src.includes('<div class="selection-overlay">' + tail)
      || src.includes('<div class="selection-overlay retreat-menu-overlay" onclick={(e) => { if (isPortraitMobile && e.target === e.currentTarget) floatingRetreatMenu = null; }}>' + tail);
  }],
  ['[④前提] 撤退選單仍有「取消」鈕可關閉', false, (src) => {
    const i = src.indexOf('<h3>🔄 選擇換入的寶可夢</h3>'); const j = src.indexOf('<div class="sel-footer">', i);
    return i > 0 && j > i && /floatingRetreatMenu\s*=\s*null/.test(src.slice(j, j + 400));
  }],
  ['[④前提] 檢視類（棄牌區、放大、獎賞）仍可點遮罩關閉', false, (src) =>
    src.includes('<div class="zoom-overlay" onclick={() => viewDiscardFor = null}>') && src.includes('<div class="zoom-overlay" onclick={closeZoom}>') && src.includes('<div class="zoom-overlay" onclick={closePrizeView}>')],
  ['★★[S 標記] 主選擇視窗在 modal-choice 時掛 pk-s；攻擊前 stepper／是否視窗掛 pk-s', true, (src) =>
    src.includes("class:pk-s={pendingSelection.type === 'modal-choice'}") && (src.match(/<div class="selection-modal pk-s" use:modalDrag/g) || []).length === 2],
  ['★★★[⑤配色] 新版桌墊的視窗深藍底＋白框線（只 scope 在新版桌墊）', true, (src) => {
    const d = declsOf(blueCss(src), `${B} .selection-modal`);
    return /background:#0f2250/.test(d) && /border:1\.5px solid rgba\(255,255,255,\.55\)/.test(d);
  }],
  ['★★[⑤配色] 新版桌墊的選取框用桌墊金色、主要鈕用桌墊綠色膠囊', true, (src) => {
    const c = blueCss(src);
    return /#ffd83d/.test(declsOf(c, `${B} .sel-card.sel-picked`))
      && /border-radius:999px/.test(declsOf(c, `${B} .selection-modal .btn-act.primary`));
  }],
  ['[⑤前提] 其他版面的視窗仍是深綠（.selection-modal 基底 #1a2a1a 沒被改）', false, (src) =>
    /\.selection-modal\{ background:#1a2a1a;/.test(src) && /\.zoom-modal\{ background:#1a2a1a;/.test(src)],
  ['★★[位置] 區塊放在桌機 picker 規則之後、手機直式媒體查詢之前（同特異度桌機由它決定、手機照舊被蓋回）', true, (src) => {
    const css = styleOf(src);
    const i = css.indexOf('/* >>> v6449-picker-shell */');
    const a = css.indexOf('.prize-view-btn:hover{');
    const lastPortrait = css.lastIndexOf('@media (max-width: 600px) and (orientation: portrait) {');
    const landscape = css.indexOf('@media (max-width: 950px) and (orientation: landscape) {');
    return i > a && a > 0 && i < lastPortrait && i < landscape;
  }],
  ['[前提] 手機直式仍用 96vw 寬、自己的高度上限（v6.450 才改手機）', false, (src) =>
    /\.selection-modal \{\n\s*width: 96vw; max-width: 96vw;/.test(src)],
  ['[本頁] 區塊內沒有 @media，且整頁媒體查詢數量沒變', false, (src) =>
    !/@media/.test(shell(src)) && (styleOf(src).match(/@media/g) || []).length === (styleOf(BASE_SRC || src).match(/@media/g) || []).length],
];

let BASE_SRC = '';
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  if (r.ok) BASE_SRC = r.out.replace(/\r\n/g, '\n');
}
function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、找得到 v6449-picker-shell 區塊', SRC.length > 900000 && shellRaw(SRC).length > 1500);
for (const c of runAll(SRC)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.448');
if (!BASE_SRC) {
  shallowSkip('v6449 B：HEAD-FAIL 比對', '需要 v6.448 commit');
} else {
  const base = runAll(BASE_SRC);
  const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
  ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.448 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
  const ctlFail = base.filter((c) => !c.headFail && !c.r && !/區塊內沒有 @media/.test(c.name)).map((c) => c.name);
  ok('[正對照] 非 headFail 的結構前提在 v6.448 就成立', ctlFail.length === 0, ctlFail.join(' ｜ '));
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot') && !SRC.includes('__devUI'));

console.log(`\n=== v6.449 picker 桌機外框統一: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6449-picker-desktop-shell ===');
process.exit(fail ? 1 : 0);
