#!/usr/bin/env node
/**
 * v6.444 守衛：藍桌墊站長回饋三項（2026-09-29 夜）
 *
 *   ① 中間那幾格備戰卡的名稱／HP 提示被戰鬥寶可夢框蓋住（Fable 疊放順序：備戰區 200 < 戰鬥區 210）
 *   ② 戰鬥場／備戰區的寶可夢道具小縮圖，滑鼠碰到也要顯示放大預覽
 *   ③ 拖牌到我方戰鬥寶可夢（進化／附能量／附道具）時，拉到外圍白框內就要成立，不必對準卡面
 *   （③ 另有雲端 Playwright 實測：能量拖到白框右下角空白處 ⇒ 附加成功 3→4。）
 *
 * 這支守衛怎麼避免自己說謊
 *   每條判準寫成 (src) => boolean，同時餵目前的原始碼（必須全成立）與 v6.442（標 headFail 的必須不成立）。
 *   CSS 只讀藍桌墊哨兵區塊內「去掉註解」的文字；script 只讀 v6443-blue-peek 哨兵內「去掉註解」的程式。
 *   ⚠ 其他版面零位元組變動由 test-v6441 A 剝除器守（它也會剝掉 v6443-blue-peek 哨兵）。
 *
 * Run: node scripts/test-v6444-blue-feedback-three.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.443。
const BASE_SHA = 'f6a12bf44c229e3222194fbf9da47a56b807c2dc';

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
  ['★★★[①疊放] 滑鼠停在備戰區時整列拉到戰鬥區（210）之上', true, (src) => {
    const m = /z-index:(\d+)/.exec(declsOf(blueCss(src), '.playmat.layout-blue .my-row > .zone-bench:hover'));
    const o = /z-index:(\d+)/.exec(declsOf(blueCss(src), '.playmat.layout-blue .opponent-row > .zone-bench:hover'));
    return !!m && !!o && +m[1] > 210 && +o[1] > 210 && +m[1] < 230;
  }],
  ['[①疊放] 前提：Fable 的戰鬥區疊放順序仍是 210（若改了，上面的門檻要跟著改）', false, (src) =>
    src.includes('.playmat.layout-fable .my-row > .zone-active{ grid-area:activeMe; justify-self:center; align-self:start; position:relative; z-index:210;')],
  ['★★★[②道具預覽] 道具縮圖的 <img> 滑鼠移上呼叫 enterAttCard（放大預覽）、移開 leaveAttCard', true, (src) =>
    /<span class="bl-tool"[\s\S]{0,200}?<img use:retryImg=\{_tc\?\.imageUrl\}[^>]*onpointerenter=\{\(e\)=>enterAttCard\(e, _bt\[0\]\.cardId\)\} onpointerleave=\{leaveAttCard\}/.test(src)],
  ['★★[②道具預覽] 點道具縮圖＝放大檢視；但「選了能量要附加」時不攔截（讓點擊照常冒泡到卡位＝附加能量）', true, (src) =>
    /onclick=\{\(e\)=>\{if\(!selectedEnergyIid\)\{e\.stopPropagation\(\);openZoom\(_bt\[0\]\.cardId,null\);\}\}\}/.test(src)],
  ['★★[②道具預覽] 只有縮圖本身吃滑鼠（外框 .bl-tool 仍 pointer-events:none）', true, (src) => {
    const css = blueCss(src);
    return /pointer-events:auto/.test(declsOf(css, '.playmat.layout-blue .bl-tool img')) && /pointer-events:none/.test(declsOf(css, '.playmat.layout-blue .bl-tool'));
  }],
  ['★★★[③拖放範圍] 我方戰鬥卡（data-drop-type 所在）用 ::before 把命中範圍撐滿整個白框（含右側一欄與 HP 條）', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue .my-row > .zone-active > .active-card::before');
    return /content:''/.test(d) && /position:absolute/.test(d) && /right:calc\(-1 \* \(var\(--bl-scol\) \+ \d+px\)\)/.test(d) && /bottom:-\d+px/.test(d) && /top:-\d+px/.test(d) && /left:-\d+px/.test(d);
  }],
  ['★★[③拖放範圍] 撐出的命中層在卡圖與按鈕之下（z-index:-1 ⇒ 不擋特性／進化鈕）', true, (src) =>
    /z-index:-1/.test(declsOf(blueCss(src), '.playmat.layout-blue .my-row > .zone-active > .active-card::before'))],
  ['★[③拖放範圍] 拖曳到框內時整個白框亮黃框（放開就成立）', true, (src) =>
    /outline:3px solid #ffd44a/.test(declsOf(blueCss(src), '.playmat.layout-blue .my-row > .zone-active:has(> .active-card.drop-hover)'))],
  ['[③拖放範圍] 前提：拖放判定是 elementFromPoint＋closest(data-drop-type)（偽元素命中＝命中 .active-card，才會生效）', false, (src) =>
    src.includes("const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;\n      const el = hit?.closest('[data-drop-type]') as HTMLElement | null;")
      && /<div class="active-card mine-active"[\s\S]{0,1800}?data-drop-type="poke"/.test(src)],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、找得到藍桌墊 CSS', SRC.length > 900000 && blueCss(SRC).length > 5000);
for (const c of runAll(SRC)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.443');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6444 B：HEAD-FAIL 比對', '需要 v6.443 commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 v6.443 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    const base = runAll(r.out.replace(/\r\n/g, '\n'));
    const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.443 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
    const ctlFail = base.filter((c) => !c.headFail && !c.r && !/哨兵內只有/.test(c.name)).map((c) => c.name);
    ok('[正對照] 非 headFail 的結構前提在 v6.443 就成立（markup 沒被本版動到）', ctlFail.length === 0, ctlFail.join(' ｜ '));
  }
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot'));

console.log(`\n=== v6.444 藍桌墊回饋三項: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6444-blue-feedback-three ===');
process.exit(fail ? 1 : 0);
