#!/usr/bin/env node
/**
 * v6.454 守衛：v6.448～v6.453 獨立審查（fable）提出的修正
 *
 *   A 手機直式撤退選單不可穿透（v4.969 的可穿透規則只給 pending picker）；手機點外面關、桌機不關
 *   B 手機棄牌區／獎賞 sheet 捲動後 ✕ 仍看得到（黏在右上角）
 *   C／H 手機 sheet 的按鈕列黏在最底並自己吃掉安全區；撤退選單舊 footer（v6.122）的底色與內距對齊 sheet
 *       （⚠ 審查 C 說「確定會壓到 home indicator」在 Chromium 量不出來——sticky 邊界本來就扣掉 padding；【D】把它當正對照）
 *   D 「取消出招」與「否」視覺上分開（虛線透明鈕＋間距）
 *   E 手機 sheet：高傲指令、排序牌庫頂的清單也不再雙層捲動
 *   F 浮動進化選單有高度上限（選項很多時不超出頂端）
 *
 * 【S】字串判準（HEAD-FAIL 對 v6.453）＋【D】Playwright 實際量測（沒有瀏覽器 ⇒ ENV-SKIP）。
 * Run: node scripts/test-v6454-review-fixes.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleBlockOf } from './lib/svelte-style-block.mjs';
import { extractCss, pageHtml } from './lib/zoom-modal-fixture.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.453。
const BASE_SHA = 'c16c9675c7a9a6c3192768ee70bfb5ed9211e16b';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const noCmt = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '');
function sheet(src) {
  const m = /    \/\* >>> v6450-picker-sheet \*\/\n([\s\S]*?)    \/\* <<< v6450-picker-sheet \*\/\n/.exec(src);
  return noCmt(m ? m[1] : '');
}
function shell(src) {
  const m = /  \/\* >>> v6449-picker-shell \*\/\n([\s\S]*?)  \/\* <<< v6449-picker-shell \*\/\n/.exec(src);
  return noCmt(m ? m[1] : '');
}
function declsOf(c, sel) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(c))) if (m[1].split(/,(?![^()]*\))/).map((x) => x.trim()).includes(sel)) out.push(m[2]);
  return out.join(';');
}

const CHECKS = [
  ['★★★[A] 撤退遮罩多掛 retreat-menu-overlay；只有手機直式點外面才關', true, (s) =>
    s.includes('<div class="selection-overlay retreat-menu-overlay" onclick={(e) => { if (isPortraitMobile && e.target === e.currentTarget) floatingRetreatMenu = null; }}>')],
  ['★★★[A] 手機直式撤退遮罩擋住觸控（pointer-events:auto）', true, (s) => /pointer-events:auto/.test(declsOf(sheet(s), '.selection-overlay.retreat-menu-overlay'))],
  ['[A前提] 其他 pending 選擇視窗在手機直式仍可穿透（v4.969）', false, (s) => /\.selection-overlay \{\n\s*background: rgba\(0, 0, 0, 0\.4\);\n\s*pointer-events: none;/.test(s)],
  ['★★★[B] 手機棄牌區 sheet 的 ✕ 黏在頂端', true, (s) => /position:sticky/.test(declsOf(sheet(s), '.zoom-modal.discard-modal > .zoom-close')) && /top:0/.test(declsOf(sheet(s), '.zoom-modal.discard-modal > .zoom-close'))],
  ['★★★[C] 手機按鈕列吃掉安全區（有按鈕列的 sheet 底部內距交給按鈕列；不用負邊距）', true, (s) => {
    const c = sheet(s); const d = declsOf(c, '.selection-modal > .sel-footer');
    return /padding:\.5rem \.85rem calc\(\.75rem \+ var\(--safe-bottom, 0px\)\)/.test(d) && /margin:0 -\.85rem;/.test(d + ';') && /bottom:0/.test(d)
      && /padding-bottom:0/.test(declsOf(c, '.selection-modal:has(> .sel-footer)'));
  }],
  ['★★[D] 「取消出招」虛線透明（留空改由 v6.455 的彈簧排序，test-v6455 量間距）', true, (s) => {
    const d = declsOf(shell(s), '.sel-footer > .btn-act.secondary.pre-attack-cancel');
    // ⭐v6.455：margin-right:auto 是死宣告（複審量到間距只有 gap）⇒ 改由 v6.455 的彈簧排序做「留空」，這裡只守樣式；間距由 test-v6455 量
    return /background:transparent/.test(d) && /dashed/.test(d);
  }],
  ['★★[E] 手機 sheet：高傲指令與排序牌庫頂的清單也取消內捲', true, (s) => {
    const c = sheet(s);
    return /--scroll-list-max:none/.test(declsOf(c, '.selection-modal .rocket-command-scroll')) && /--scroll-list-max:none/.test(declsOf(c, '.selection-modal .reorder-deck-wrap'));
  }],
  ['★★[F] 浮動進化選單高度上限＝(100vh−16px)/1.05、超出捲動', true, (s) => {
    const d = declsOf(shell(s), '.float-evo-menu');
    return /max-height:calc\(\(100vh - 16px\) \/ 1\.05\)/.test(d) && /overflow-y:auto/.test(d);
  }],
];

let BASE_SRC = '';
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, REL); if (r.ok) BASE_SRC = r.out.replace(/\r\n/g, '\n'); }
function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('【S】字串判準');
ok('[前提] 讀得到對戰頁、兩個哨兵區塊', SRC.length > 900000 && sheet(SRC).length > 1000 && shell(SRC).length > 1500);
for (const c of runAll(SRC)) ok(c.name, c.r);
if (!BASE_SRC) shallowSkip('v6454 HEAD-FAIL', '需要 v6.453 commit');
else {
  const base = runAll(BASE_SRC);
  const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
  ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.453 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
  const ctlFail = base.filter((c) => !c.headFail && !c.r).map((c) => c.name);
  ok('[正對照] 非 headFail 的前提在 v6.453 就成立', ctlFail.length === 0, ctlFail.join(' ｜ '));
}
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !/DEV-SHOT-HOOK|__devShot|__devUI|__devPre|__devX/.test(SRC));

// ── 【D】實際量測：安全區 34px 的 iPhone 直式 ──
console.log('\n【D】實際量測（iPhone 直式、安全區 34px）');
const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="868" height="1212"><rect width="868" height="1212" fill="#3a6"/></svg>');
const cards = (n) => Array.from({ length: n }, (_, i) => `<div class="sel-card-wrap"><button class="sel-card"><img src="${IMG}" alt="c${i}"/><span class="sel-name">卡${i}</span></button></div>`).join('');
const FIX = {
  TALL: `<div class="selection-overlay"><div class="selection-modal" id="m"><div class="sel-header"><h3>選擇</h3></div><div class="sel-grid" id="grid">${cards(28)}</div><div class="sel-footer"><button class="btn-act primary" id="f-primary">確定</button><button class="btn-act secondary">跳過</button></div></div></div>`,
  DISCARD: `<div class="zoom-overlay"><div class="zoom-modal discard-modal" id="m"><button class="zoom-close" id="x">✕</button><h3 class="discard-title">棄牌區</h3><div class="sel-grid" id="grid">${cards(30)}</div></div></div>`,
  RETREAT: `<div class="selection-overlay retreat-menu-overlay" id="ov"><div class="selection-modal retreat-modal" id="m"><div class="sel-header"><h3>選擇換入的寶可夢</h3></div><div class="retreat-grid"></div><div class="sel-footer"><button class="btn-act secondary">取消</button></div></div></div>`,
  SHORT: `<div class="selection-overlay"><div class="selection-modal pk-s" id="m"><div class="sel-header"><h3>跳躍衝天</h3><p class="sel-hint" id="hint">是否要讓這隻寶可夢回到手牌？</p></div><div class="sel-footer" id="foot"><button class="btn-act primary">是</button><button class="btn-act secondary">否</button></div></div></div>`,
  PLAIN: `<div class="selection-overlay" id="ov"><div class="selection-modal" id="m"><div class="sel-header"><h3>選擇</h3></div></div></div>`,
};
async function probe(browser, css, fix, scrollFrac) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.setContent(pageHtml(css + ':root{--safe-bottom:34px}', FIX[fix]), { waitUntil: 'load' });
  const r = await pg.evaluate((f) => {
    const m = document.getElementById('m');
    if (f !== null) { m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) * f); }
    const R = (el) => { if (!el) return null; const q = el.getBoundingClientRect(); return { y: Math.round(q.y), b: Math.round(q.bottom), x: Math.round(q.x), r: Math.round(q.right) }; };
    const ov = document.getElementById('ov');
    return { m: R(m), scrollable: m.scrollHeight > m.clientHeight + 4, scrollTop: m.scrollTop, primary: R(document.getElementById('f-primary')), x: R(document.getElementById('x')), hint: R(document.getElementById('hint')), footer: R(document.getElementById('foot')), pe: ov ? getComputedStyle(ov).pointerEvents : null, vh: innerHeight };
  }, scrollFrac);
  await ctx.close();
  return r;
}
const chromium = pwChromium('v6.454 審查修正量測');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.454 審查修正量測');
  if (browser) {
    try {
      const css = extractCss(SRC);
      const t = await probe(browser, css, 'TALL', 0.4);
      ok('★★★[C量測] 內容可捲、捲到一半時「確定」底邊在 home indicator 之上（≤ 畫面高 − 34）', t.scrollable && t.scrollTop > 0 && t.primary && t.primary.b <= t.vh - 34, JSON.stringify(t));
      const tEnd = await probe(browser, css, 'TALL', 1);
      ok('★★[C量測] 捲到底時「確定」一樣在安全區之上、sheet 貼底', tEnd.primary && tEnd.primary.b <= tEnd.vh - 34 && tEnd.m.b === tEnd.vh, JSON.stringify(tEnd));
      const sh = await probe(browser, css, 'SHORT', null);
      ok('★★★[C量測] 內容很少的 sheet 不會捲動、按鈕列沒有蓋住上面的提示文字', !sh.scrollable && sh.hint && sh.footer && sh.hint.b <= sh.footer.y, JSON.stringify(sh));
      const d = await probe(browser, css, 'DISCARD', 0.6);
      ok('★★★[B量測] 棄牌區捲到中段，✕ 仍在 sheet 可見範圍內', d.scrollable && d.x && d.x.y >= d.m.y - 1 && d.x.b <= d.vh && d.x.y >= 0, JSON.stringify(d));
      const rv = await probe(browser, css, 'RETREAT', null);
      const pl = await probe(browser, css, 'PLAIN', null);
      ok('★★★[A量測] 撤退遮罩在手機直式擋觸控；一般 pending 遮罩仍可穿透', rv.pe === 'auto' && pl.pe === 'none', JSON.stringify({ retreat: rv.pe, plain: pl.pe }));
      if (BASE_SRC) {
        const bcss = extractCss(BASE_SRC);
        const bt = await probe(browser, bcss, 'TALL', 0.4);
        const bd = await probe(browser, bcss, 'DISCARD', 0.6);
        const brv = await probe(browser, bcss, 'RETREAT', null);
        ok('★★★[HEAD-FAIL 量測] v6.453 上 B、A 兩個問題量得出來（✕ 捲出畫面／撤退遮罩可穿透）',
          !(bd.x && bd.x.y >= bd.m.y - 1 && bd.x.y >= 0) && brv.pe === 'none', JSON.stringify({ bd: bd.x, bm: bd.m, brv: brv.pe }));
        // ⚠ 審查 C（確定壓到 home indicator）在 Chromium 量不出來：sticky 的邊界本來就扣掉捲動容器的 padding（含 --safe-bottom），
        //   v6.453 捲到一半時「確定」也在安全區之上。v6.454 的 footer 改寫是為了對齊撤退選單舊 footer（審查 H）並讓 footer 自己吃安全區，
        //   這裡把 C 當「正對照」：新舊都必須成立（改寫不可以讓它退步）。
        ok('[C正對照] v6.453 捲到一半時「確定」也在安全區之上（審查 C 在 Chromium 不重現；本版改寫沒有讓它退步）', bt.primary && bt.primary.b <= bt.vh - 34, JSON.stringify(bt.primary));
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.454 審查修正: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6454-review-fixes ===');
process.exit(fail ? 1 : 0);
