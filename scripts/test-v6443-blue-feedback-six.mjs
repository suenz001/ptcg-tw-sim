#!/usr/bin/env node
/**
 * v6.443 守衛：藍桌墊站長回饋六項（2026-09-29 晚）
 *
 *   ① 滑鼠移到備戰寶可夢時，名稱／HP 提示被放大預覽蓋住 ⇒ 藍桌墊的預覽改放卡片旁邊（左側，放不下才右側）
 *   ② 招式鈕不顯示能量需求圖示（只留名稱＋傷害，名稱不再只剩「…」）
 *   ③ 手牌不寫「拖曳使用」等提示（黃框已表示可用）
 *   ④ 備戰寶可夢用過特性要有「已用特性」標籤（和戰鬥寶可夢一樣）
 *   ⑤ 頁首不再顯示競技場卡（左側競技場框已有卡圖）
 *   ⑥ 設置階段的蓋牌只顯示卡背，不畫「?」
 *
 * 這支守衛怎麼避免自己說謊
 *   每條判準寫成 (src) => boolean，同時餵目前的原始碼（必須全成立）與 v6.442（標 headFail 的必須不成立）。
 *   CSS 只讀藍桌墊哨兵區塊內「去掉註解」的文字；script 只讀 v6443-blue-peek 哨兵內「去掉註解」的程式。
 *   ⚠ 其他版面零位元組變動由 test-v6441 A 剝除器守（它也會剝掉 v6443-blue-peek 哨兵）。
 *
 * Run: node scripts/test-v6443-blue-feedback-six.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.442。
const BASE_SHA = '4d34c3b0c16d439fdfd96bb90fa396de719600b6';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function blueCss(src) {
  const m = /\/\* >>> v6441-blue-css \*\/([\s\S]*?)\/\* <<< v6441-blue-css \*\//.exec(src);
  return (m ? m[1] : '').replace(/\/\*[\s\S]*?\*\//g, '');
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
  ['★★★[①預覽] 藍桌墊的場上卡片放大預覽改放卡片旁邊：先試左側（rect.left − 間距 − 預覽寬），放不下才放右側（rect.right＋間距）', true, (src) => {
    const c = peekCode(src);
    return /if \(battleLayout === 'blue'\) \{/.test(c) && /rect\.left - 14 - PW/.test(c) && /rect\.right \+ 14 \+ PW \/ 2/.test(c) && /const PW = 344/.test(c);
  }],
  ['★★[①預覽] 垂直置中對齊卡片並夾在視窗內（用 below 模式 ⇒ top 就是預覽上緣）', true, (src) => {
    const c = peekCode(src);
    return /rect\.top \+ rect\.height \/ 2 - PH \/ 2/.test(c) && /vh - PH - 8/.test(c) && /hoverAttBelow = true;/.test(c) && /hoverAttAnchor = \{ x: bx, y: top \};/.test(c);
  }],
  ['★★[①預覽] 這段位在 enterAttCard 裡、在原本的 hoverAttAnchor 指定之後（覆寫才會生效；其他版面不經過）', true, (src) => {
    const b = enterAttCardBody(src);
    const iOrig = b.indexOf('    hoverAttAnchor = { x: rect.left + rect.width / 2, y };\n');
    const iPeek = b.indexOf('    // >>> v6443-blue-peek');
    return iOrig > 0 && iPeek > iOrig;
  }],
  ['[①預覽] 哨兵內只有這一個 if 區塊（沒有夾帶其他程式）', false, (src) => {
    const raw = peekCode(src), c = raw.trim();
    return c.startsWith("if (battleLayout === 'blue') {") && c.endsWith('}') && (raw.match(/^ {4}\S/gm) || []).length === 2;
  }],
  ['★★[②招式] 招式鈕的能量需求圖示在藍桌墊不顯示', true, (src) =>
    /display:none/.test(declsOf(blueCss(src), '.playmat.layout-blue .action-bar > .action-btns .btn-act.atk .cost-row .epip'))],
  ['★★[③手牌] 手牌的操作提示文字在藍桌墊不顯示，高度還給卡圖', true, (src) => {
    const css = blueCss(src);
    return /display:none/.test(declsOf(css, '.battle-root:has(.playmat.layout-blue) .hand-card .hand-hint'))
      && /width:calc\(\(var\(--bl-hand-h\) - 34px\) \/ 1\.4\)/.test(declsOf(css, '.battle-root:has(.playmat.layout-blue) .hand-card img'));
  }],
  ['★★★[④已用特性] 備戰的已用特性標籤在藍桌墊顯示（左上角、文字「已用特性」）', true, (src) => {
    const css = blueCss(src);
    return /display:block/.test(declsOf(css, '.playmat.layout-blue .bench-slot .ab-used-chip.sm'))
      && /top:-8px/.test(declsOf(css, '.playmat.layout-blue .bench-slot .ab-used-chip.sm'))
      && /content:'✨已用特性'/.test(declsOf(css, '.playmat.layout-blue .bench-slot .ab-used-chip.sm::after'));
  }],
  ['[④已用特性] markup 仍只在 abilityUsedThisTurn 時才 render 這個標籤（沒用過就不會出現）', false, (src) =>
    src.includes('{#if b.abilityUsedThisTurn}<div class="ab-used-chip sm" title="本回合已使用特性">✨</div>{/if}')],
  ['★★[⑤頁首] 頁首的競技場卡在藍桌墊不顯示', true, (src) =>
    /display:none/.test(declsOf(blueCss(src), '.battle-root:has(.playmat.layout-blue) .battle-header .stadium-chip'))],
  ['[⑤頁首] 頁首競技場卡的 markup 在 .battle-header 裡（選擇器才打得到）', false, (src) => {
    const i = src.indexOf('<button class="chip stadium-chip clickable-chip"');
    const h = src.lastIndexOf('class="battle-header"', i);
    const hEnd = src.indexOf('<div class="playmat"', h);
    return i > 0 && h > 0 && i < hEnd;
  }],
  ['★★[⑥卡背] 設置階段蓋牌的「?」在藍桌墊不顯示', true, (src) =>
    /display:none/.test(declsOf(blueCss(src), '.playmat.layout-blue .card-back .card-back-mark'))],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、找得到藍桌墊 CSS', SRC.length > 900000 && blueCss(SRC).length > 5000);
for (const c of runAll(SRC)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.442');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6443 B：HEAD-FAIL 比對', '需要 v6.442 commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 v6.442 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    const base = runAll(r.out.replace(/\r\n/g, '\n'));
    const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.442 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
    const ctlFail = base.filter((c) => !c.headFail && !c.r && !/哨兵內只有/.test(c.name)).map((c) => c.name);
    ok('[正對照] 非 headFail 的結構前提在 v6.442 就成立（markup 沒被本版動到）', ctlFail.length === 0, ctlFail.join(' ｜ '));
  }
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot'));

console.log(`\n=== v6.443 藍桌墊回饋六項: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6443-blue-feedback-six ===');
process.exit(fail ? 1 : 0);
