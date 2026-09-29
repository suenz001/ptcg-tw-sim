#!/usr/bin/env node
/**
 * v6.442 守衛：藍桌墊重製 ——「像實體桌墊一樣永久固定」＋照示意圖 v2 擺放按鈕
 *
 * 站長回報（2026-09-29，看完 v6.441 測試站）：
 *   ① 行動框和我方牌堆疊在一起 ② 中間的虛線平常不要顯示，拖牌時才顯示黃線
 *   ③ 戰鬥寶可夢上方不要寫字 ④ 進化前的牌不要顯示
 *   ⑤ 沒照企劃做：備戰特性鈕要在卡片左上角；戰鬥卡的特性／進化鈕要在右側
 *   ⑥ 版面要永久固定，框格大小不可隨場上的能量／卡片變動
 *   ⑦ 設置階段（set up）畫面跑掉：左上角出現橫向的紅色卡背、中間還是看得到虛線框
 *
 * 這支守衛怎麼避免自己說謊
 * ──────────────────────────────────────────────────────────────────────────
 *   每一條判準都寫成「吃一份原始碼、回傳 true/false」的函式，同時餵：
 *     ・目前的原始碼（必須全部 true）
 *     ・v6.441 的原始碼（標 ★HEAD-FAIL 的必須 false ⇒ 證明判準真的抓得到 v6.441 的問題，不是恆真式）
 *   CSS 判準只讀藍桌墊哨兵區塊內「去掉註解」的文字 ⇒ 註解寫了什麼都騙不過。
 *
 * Run: node scripts/test-v6442-blue-fixed-mat.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.441（藍桌墊第一版）。
const BASE_SHA = '331d747e';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

/** 藍桌墊 CSS（外觀＋幾何＋後備），去掉註解 */
function blueCss(src) {
  const pick = (re) => { const m = re.exec(src); return m ? m[1] : ''; };
  return [
    pick(/\/\* >>> v6441-blue-css \*\/([\s\S]*?)\/\* <<< v6441-blue-css \*\//),
    pick(/\/\* >>> v6441-blue-geom \*\/([\s\S]*?)\/\* <<< v6441-blue-geom \*\//),
  ].join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}
/** 取某個選擇器（完整字串）所在規則的宣告區塊，全部串起來 */
function declsOf(css, sel) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map((x) => x.trim());
    if (sels.includes(sel)) out.push(m[2]);
  }
  return out.join(';');
}

// ══════════════════════════════════════════════════════════════════════════
// 判準（src → boolean）。headFail=true 的判準在 v6.441 必須為 false。
// ══════════════════════════════════════════════════════════════════════════
const CHECKS = [
  // ⑥ 固定桌墊
  ['★★★[⑥固定] 四列高度：上下備戰列＝固定變數 --bl-bench-h、中場兩列＝minmax(0,1fr)（不再是 auto ＝ 跟著內容長）', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue');
    return /grid-template-rows:var\(--bl-bench-h\) minmax\(0, 1fr\) minmax\(0, 1fr\) var\(--bl-bench-h\)/.test(d) && !/grid-template-rows:[^;]*auto/.test(d);
  }],
  ['★★[⑥固定] 左右欄寬 --bl-side 只由視窗寬決定（不讀 --card-w ⇒ 卡片大小滑桿也撐不動框）', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue');
    const m = /--bl-side:([^;]+)/.exec(d);
    return !!m && !/--card-w/.test(m[1]) && /vw/.test(m[1]);
  }],
  ['★★★[⑥固定] 戰鬥寶可夢框＝固定寬高（由 --active-w／--active-h 算出，不是 auto）', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue .my-row > .zone-active');
    return /width:calc\(var\(--active-w\) \+ var\(--bl-scol\) \+ \d+px\)/.test(d) && /height:calc\(var\(--active-h\) \+ \d+px\)/.test(d);
  }],
  ['★★[⑥固定] 手牌列＝固定高度 --bl-hand-h（不隨張數／提示文字變動）', true, (src) => {
    const d = declsOf(blueCss(src), '.battle-root:has(.playmat.layout-blue) .hand-strip');
    return /(^|;|\s)height:var\(--bl-hand-h\)/.test(d) && /flex:none/.test(d);
  }],
  ['★[⑥固定] 卡寬上限把手牌列高度扣掉（一頁鎖高 ⇒ 四列＋手牌永遠放得下）', true, (src) =>
    /--card-w-cap:calc\(\(100dvh - \d+px - var\(--bl-hand-h, \d+px\)\) \/ 6\.2\)/.test(declsOf(blueCss(src), '.playmat.layout-blue'))],
  // ① 行動框
  ['★★★[①行動框] 行動框不再浮動（position:relative、transform:none），佔滿自己的格子 ⇒ 不會壓到我方牌堆', true, (src) => {
    const css = blueCss(src);
    const d = declsOf(css, '.playmat.layout-blue .action-bar > .action-btns');
    return /position:relative/.test(d) && /transform:none/.test(d) && /align-self:stretch/.test(d) && !/position:absolute/.test(d);
  }],
  // ② 中場虛線
  ['★★★[②虛線] 桌墊的 ::before 虛線框平常 display:none', true, (src) => /display:none/.test(declsOf(blueCss(src), '.playmat.layout-blue::before'))],
  ['★★[②虛線] 只有「手牌真的拖出去」（.hand-scroll.is-dragging）時才顯示，而且是黃色', true, (src) => {
    const css = blueCss(src);
    const on = declsOf(css, '.battle-root:has(.playmat.layout-blue):has(.hand-scroll.is-dragging) .playmat::before');
    const base = declsOf(css, '.playmat.layout-blue::before');
    return /display:block/.test(on) && /border:2px dashed rgba\(255,216,61/.test(base);
  }],
  ['[②虛線] 沒有其他規則讓 ::before 在非拖曳時顯示出來', false, (src) => {
    const css = blueCss(src);
    const re = /([^{}]+)\{([^{}]*)\}/g; let m; const bad = [];
    while ((m = re.exec(css))) {
      for (const sel of m[1].split(',').map((x) => x.trim())) {
        if (/::before$/.test(sel) && /\.playmat(\.layout-blue)?::before$/.test(sel) && /display:(block|flex|grid)/.test(m[2]) && !/is-dragging/.test(sel)) bad.push(sel);
      }
    }
    return bad.length === 0;
  }],
  // ③ 戰鬥寶可夢不寫字
  ['★★[③不寫字] 藍桌墊 CSS 裡不再有「戰鬥寶可夢」標題', true, (src) => { const c = blueCss(src); return c.length > 1000 && !/content:'戰鬥寶可夢'/.test(c); }],
  // ④ 進化堆
  ['★★[④進化堆] 附加卡片小卡堆（含進化前的卡）整個不顯示', true, (src) => /display:none !important/.test(declsOf(blueCss(src), '.playmat.layout-blue .att-card-stack'))],
  // ⑤ 按鈕位置（示意圖 v2）
  ['★★★[⑤備戰特性] 「特性」旗標在卡片左上角（top:-8px，left 以實際卡寬 --bl-bw 對齊卡片左緣）', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue .bench-slot .ability-btn-sm');
    return /top:-8px/.test(d) && /left:calc\(50% - var\(--bl-bw\) \/ 2 - 8px\)/.test(d);
  }],
  ['★★[⑤備戰特性] 旗標文字＝「特性」', true, (src) => /content:'特性'/.test(declsOf(blueCss(src), '.playmat.layout-blue .bench-slot .ability-btn-sm::after'))],
  ['★★[⑤備戰進化] 「▲」進化旗標在卡片右緣', true, (src) => {
    const css = blueCss(src);
    return /left:calc\(50% \+ var\(--bl-bw\) \/ 2 - \d+px\)/.test(declsOf(css, '.playmat.layout-blue .bench-slot .evo-btn-sm'))
      && /content:'▲'/.test(declsOf(css, '.playmat.layout-blue .bench-slot .evo-btn-sm::after'));
  }],
  ['★★★[⑤戰鬥右欄] 戰鬥卡的特性／進化鈕在卡片右側一欄（left:calc(100% + 10px)）', true, (src) =>
    /left:calc\(100% \+ 10px\)/.test(declsOf(blueCss(src), '.playmat.layout-blue .active-card .ability-btn'))],
  ['★★[⑤戰鬥右欄] 道具縮圖也在右側一欄最上面，並顯示道具名稱', true, (src) => {
    const css = blueCss(src);
    return /left:calc\(100% \+ 10px\)/.test(declsOf(css, '.playmat.layout-blue .active-card .bl-tool'))
      && /display:block/.test(declsOf(css, '.playmat.layout-blue .active-card .bl-tool .bl-tn'))
      && /<i class="bl-tn">\{_tc\?\.name \?\? '道具'\}<\/i>/.test(src);
  }],
  ['★★[⑤戰鬥右欄] 右欄是固定槽位：特性在道具縮圖下方、進化再下方（按鈕有無都不位移）', true, (src) => {
    const css = blueCss(src);
    const t = (sel) => { const m = /(?:^|;)\s*top:calc\(var\(--active-w\) \* \.42 \* 1\.397 \+ (\d+)px\)/.exec(declsOf(css, sel)); return m ? +m[1] : null; };
    const ab = t('.playmat.layout-blue .active-card .ability-btn'), ev = t('.playmat.layout-blue .active-card .evo-wrap');
    return ab !== null && ev !== null && ev > ab;
  }],
  ['★[⑤狀態] 異常狀態是卡片左側一欄（外凸出卡片左緣）', true, (src) => /left:-10px/.test(declsOf(blueCss(src), '.playmat.layout-blue .active-card .active-info'))],
  // ⑦ 設置階段
  ['★★★[⑦設置] 對手備戰的蓋牌格：卡背縮成該格的卡片大小（直式 63:88），不再撐滿整格變成橫向紅卡背', true, (src) => {
    const d = declsOf(blueCss(src), '.playmat.layout-blue .bench-slot.card-back-slot .card-back');
    return /width:var\(--bl-bw\)/.test(d) && /aspect-ratio:63\/88/.test(d);
  }],
  ['★★[⑦設置] 對手戰鬥位蓋牌時不疊「戰鬥中（未揭曉）」文字', true, (src) => /display:none/.test(declsOf(blueCss(src), '.playmat.layout-blue .active-card.card-back-active .active-info'))],
  ['★[⑦設置] 蓋牌改用藍桌墊同款卡背（與牌庫／獎賞一致）', true, (src) => /#2a57c4/.test(declsOf(blueCss(src), '.playmat.layout-blue .card-back'))],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、找得到藍桌墊 CSS', SRC.length > 900000 && blueCss(SRC).length > 5000);
const now = runAll(SRC);
for (const c of now) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.441（站長回報有問題的那一版）');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6442 B：HEAD-FAIL 比對', '需要 v6.441 commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 v6.441 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    const base = runAll(r.out.replace(/\r\n/g, '\n'));
    const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.441 全部不成立（判準抓得到當時的問題，不是恆真式）', wrongPass.length === 0, wrongPass.join(' ｜ '));
    ok('[自我驗證] headFail 判準夠多', CHECKS.filter((c) => c[1]).length >= 15);
  }
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot'));
ok('[範圍] 手機直式元件不讀 battleLayout（手機版面維持現況）',
  !readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8').includes('battleLayout'));

console.log(`\n=== v6.442 藍桌墊固定桌墊: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6442-blue-fixed-mat ===');
process.exit(fail ? 1 : 0);
