#!/usr/bin/env node
/**
 * v6.445 守衛：藍桌墊 fable 5.1 審查修正（2026-09-30）
 *
 *   🔴1 行動框 overflow-y:auto 讓兩軸都裁 ⇒ 招式預估傷害浮層被裁掉 ⇒ overflow:visible
 *   🟡2 1366 寬招式名稱被截成「動…」⇒ 放大鏡改成右上角小圓鈕、招式名稱不設上限
 *   🟡3 矮螢幕戰鬥卡右欄（第二個特性）掉出白框 ⇒ 槽位從白框底部往上排（由 v6442 ⑤ 守）
 *   🟡4 能量列往上長蓋住異常狀態 ⇒ 狀態欄從卡片頂 6px 起、疊在能量列之上
 *   🟡5 備戰框標題與第一格旗標重疊 ⇒ 備戰框上內距 25px（--bl-bench-h ＋8）
 *   🟡6 8 格備戰＋窄視窗裝飾比卡大 ⇒ 容器查詢（容器＝備戰格）縮小裝飾（不是媒體查詢）
 *   🟡7 「⚡ 點此附加」壓到能量／HP ⇒ 藍桌墊隱藏，改整個白框亮黃虛線
 *   ⚪ 已用特性與特性旗標重疊、紀錄欄收合時開關鈕壓框
 *
 *   同樣的做法：判準 (src)=>boolean 同時餵目前與 v6.444，headFail 的必須在 v6.444 不成立。
 *
 * Run: node scripts/test-v6445-blue-review-fixes.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.444。
const BASE_SHA = 'bca98712f9e0ddb3f8d7b5922c2d3586c8e23575';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function blueCss(src) {
  const m = /\/\* >>> v6441-blue-css \*\/([\s\S]*?)\/\* <<< v6441-blue-css \*\//.exec(src);
  const g = /\/\* >>> v6441-blue-geom \*\/([\s\S]*?)\/\* <<< v6441-blue-geom \*\//.exec(src);
  return ((m ? m[1] : '') + '\n' + (g ? g[1] : '')).replace(/\/\*[\s\S]*?\*\//g, '');
}
/** @container 區塊內的 CSS（去註解） */
function containerCss(src) {
  const css = blueCss(src); const i = css.indexOf('@container (max-width: 64px){');
  if (i < 0) return '';
  let d = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) { if (css[k] === '{') d++; else if (css[k] === '}') { d--; if (d === 0) return css.slice(j + 1, k); } }
  return '';
}
function declsOf(css, sel) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) if (m[1].split(',').map((x) => x.trim()).includes(sel)) out.push(m[2]);
  return out.join(';');
}
function peekCode(src) {
  const m = /    \/\/ >>> v6443-blue-peek\n([\s\S]*?)    \/\/ <<< v6443-blue-peek\n/.exec(src);
  return m ? m[1].split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n') : '';
}
function enterAttCardBody(src) {
  const i = src.indexOf('  function enterAttCard(');
  const j = src.indexOf('  function leaveAttCard(', i);
  return i > 0 && j > i ? src.slice(i, j) : '';
}

const CHECKS = [
  ['★★★[🔴1] 行動框不裁切（overflow:visible，沒有 overflow-y:auto／hidden／scroll）⇒ 預估傷害浮層完整顯示', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue .action-bar > .action-btns');
    return /overflow:visible/.test(d) && !/overflow(-[xy])?:(auto|hidden|scroll)/.test(d);
  }],
  ['★[🔴1] 行動框疊在戰鬥區之上（浮層不被戰鬥框蓋住），放不下時從上往下排（safe center）', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue .action-bar > .action-btns');
    return /z-index:215/.test(d) && /align-content:safe center/.test(d);
  }],
  ['★★[🟡2] 放大鏡改成招式鈕右上角的小圓鈕（absolute，不佔招式鈕寬度）', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue .action-bar > .action-btns > .atk-slot > .dmg-est-toggle');
    return /position:absolute/.test(d) && /top:-\d+px/.test(d) && /right:-\d+px/.test(d);
  }],
  ['★★[🟡2] 招式名稱在藍桌墊不設 120px 上限', true, (src) =>
    /max-width:none/.test(declsOf(blueCss(src), '.playmat.layout-blue .action-bar > .action-btns .btn-act.atk .atk-name'))],
  ['★★[🟡4] 異常狀態欄從卡片頂部起排、疊在能量列（228）之上', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue .active-card .active-info');
    const m = /z-index:(\d+)/.exec(d);
    return /top:6px/.test(d) && !!m && +m[1] > 228;
  }],
  ['★[🟡4] 能量列不壓到 HP 條（bottom:-7px ⇔ HP 條 top:100%+7px）', true, (src) =>
    /bottom:-7px/.test(declsOf(blueCss(src), '.playmat.layout-blue .bl-chips'))
      && /top:calc\(100% \+ 7px\)/.test(declsOf(blueCss(src), '.playmat.layout-blue .active-card .active-hpbar-bottom'))],
  ['★★[🟡5] 備戰框上內距 25px（旗標 top:-8px 仍在標題列 3～16px 之下），列高同步 +8', true, (src) =>
    /padding:25px 6px 13px/.test(declsOf(blueCss(src), '.playmat.layout-blue .zone-bench'))
      && /--bl-bench-h:calc\(var\(--card-w\) \* 1\.397 \+ 40px\)/.test(declsOf(blueCss(src), '.playmat.layout-blue'))],
  ['★★[🟡6] 備戰格窄於 64px 時用容器查詢縮小傷害黃圓／能量／旗標（不是媒體查詢）', true, (src) => {
    const c = containerCss(src);
    return /\.playmat\.layout-blue \.bench-slot \.bl-dmg\{/.test(c) && /\.playmat\.layout-blue \.bench-slot \.bl-chip\{/.test(c)
      && /\.playmat\.layout-blue \.bench-slot \.ability-btn-sm\{/.test(c) && /content:'✨已用'/.test(c);
  }],
  ['[🟡6] 前提：備戰格就是查詢容器（container-type:inline-size）', false, (src) =>
    /container-type:inline-size/.test(declsOf(blueCss(src), '.playmat.layout-blue .zone-bench .bench-slot'))],
  ['★★[🟡7] 戰鬥卡的「點此附加」提示在藍桌墊隱藏，改成整個白框亮黃虛線', true, (src) => {
    const css = blueCss(src);
    return /display:none/.test(declsOf(css, '.playmat.layout-blue .active-card .active-info .attach-hint'))
      && /outline:2px dashed #ffeb3b/.test(declsOf(css, '.playmat.layout-blue .my-row > .zone-active:has(> .active-card.energy-clickable)'));
  }],
  ['★[⚪] 同一隻備戰已用特性又有可用特性：已用標籤往下錯開', true, (src) =>
    /top:16px/.test(declsOf(blueCss(src), '.playmat.layout-blue .bench-slot:has(.ability-btn-sm) .ab-used-chip.sm'))],
  ['★[⚪] 紀錄欄收合時保留 34px 窄欄給開關鈕', true, (src) =>
    /--log-w:34px/.test(declsOf(blueCss(src), '.playmat.layout-blue.log-collapsed'))],
  ['[範圍] 容器查詢區塊內每條選擇器都 scope 在 .playmat.layout-blue', false, (src) => {
    const c = containerCss(src).replace(/\{[^{}]*\}/g, '{}');
    const sels = c.split('{}').flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
    return sels.length >= 6 && sels.every((x) => /^\.playmat\.layout-blue(?![\w-])/.test(x));
  }],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、找得到藍桌墊 CSS', SRC.length > 900000 && blueCss(SRC).length > 5000);
for (const c of runAll(SRC)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.444');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6445 B：HEAD-FAIL 比對', '需要 v6.444 commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 v6.444 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    const base = runAll(r.out.replace(/\r\n/g, '\n'));
    const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.444 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
    const ctlFail = base.filter((c) => !c.headFail && !c.r && !/哨兵內只有|\[範圍\] 容器查詢/.test(c.name)).map((c) => c.name);
    ok('[正對照] 非 headFail 的結構前提在 v6.444 就成立（markup 沒被本版動到）', ctlFail.length === 0, ctlFail.join(' ｜ '));
  }
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot'));

console.log(`\n=== v6.445 藍桌墊 fable 審查修正: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6445-blue-review-fixes ===');
process.exit(fail ? 1 : 0);
