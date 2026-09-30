#!/usr/bin/env node
/**
 * v6.455 守衛：v6.454 複審（fable）的三個建議級缺口——一律用實際量測守（複審指出 v6.454 的字串判準守不到意圖）
 *
 *   ① 「取消出招」與「否」之間真的留空（v6.454 的 margin-right:auto 是死宣告：彈簧 ::before 先吃光剩餘空間）
 *      ⇒ 有取消鈕的按鈕列把彈簧排到取消與否之間（取消最左、否／是靠右）
 *   ② 手機直式撤退選單被拖開（.dragged）時照舊透明、可點到下面（v6.454 的擋觸控規則蓋掉了 v6.425 的拖開透明化）
 *   ③ 浮動進化選單 6 個選項在 1366×657 不超出頂端（max-height 原本是 content-box，內距＋框線多 8px）
 *
 * 【S】字串（HEAD-FAIL 對 v6.454）＋【D】Playwright 量測（HEAD-FAIL 量測也對 v6.454；沒有瀏覽器 ⇒ ENV-SKIP）
 * Run: node scripts/test-v6455-review-followups.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { extractCss, pageHtml } from './lib/zoom-modal-fixture.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.454。
const BASE_SHA = 'b44728035355dc18b4312980b01ef966343ca47b';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const CHECKS = [
  ['★★[S①] 有「取消出招」的按鈕列，彈簧排到取消與否之間', true, (s) => s.includes('  .sel-footer:has(> .pre-attack-cancel)::before{ order:-2; }\n')],
  ['★★[S①] 死宣告 margin-right:auto 已拿掉', true, (s) => !s.includes('color:#c8d0dc; margin-right:auto; }')],
  ['★★[S②] 撤退遮罩被拖開時透明、不擋觸控', true, (s) => s.includes('    .selection-overlay.retreat-menu-overlay.dragged{ pointer-events:none; background:transparent; }\n')],
  ['★★[S③] 浮動進化選單 max-height 用 border-box', true, (s) => /\.float-evo-menu\{ max-height:calc\(\(100vh - 16px\) \/ 1\.05\); overflow-y:auto; box-sizing:border-box; \}/.test(s)],
];
let BASE_SRC = '';
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, REL); if (r.ok) BASE_SRC = r.out.replace(/\r\n/g, '\n'); }
const runAll = (src) => CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; });

console.log('【S】字串判準');
for (const c of runAll(SRC)) ok(c.name, c.r);
if (!BASE_SRC) shallowSkip('v6455 HEAD-FAIL', '需要 v6.454 commit');
else {
  const wrongPass = runAll(BASE_SRC).filter((c) => c.headFail && c.r).map((c) => c.name);
  ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.454 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
}
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !/DEV-SHOT-HOOK|__devShot|__devUI|__devPre|__devX/.test(SRC));

console.log('\n【D】實際量測');
const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="868" height="1212"><rect width="868" height="1212" fill="#3a6"/></svg>');
const FOOT = `<div class="sel-footer"><button class="btn-act primary" id="yes">是</button><button class="btn-act secondary" id="no">否</button><button class="btn-act secondary pre-attack-cancel" id="cancel">取消出招</button></div>`;
const FIX = {
  BIN: `<div class="selection-overlay"><div class="selection-modal pk-s" id="m"><div class="sel-header"><h3>跳躍衝天</h3></div>${FOOT}</div></div>`,
  BIN_BLUE: `<div class="battle-root"><div class="playmat layout-blue"></div><div class="selection-overlay"><div class="selection-modal pk-s" id="m"><div class="sel-header"><h3>跳躍衝天</h3></div>${FOOT}</div></div></div>`,
  DRAG: `<div class="selection-overlay retreat-menu-overlay dragged" id="ov"><div class="selection-modal retreat-modal" id="m"><div class="sel-header"><h3>選擇換入的寶可夢</h3></div></div></div>`,
  // JS 夾制後的錨點：estH＝60＋6×125＝810 ⇒ y＝min(max(top, 810×1.05＋8), vh−8)＝649（vh 657）
  EVO: `<div class="float-evo-menu" id="m" style="left:683px;top:649px;"><div class="float-evo-title">選擇進化</div>${Array.from({ length: 6 }, (_, i) => `<button class="evo-choice wide-evo"><img src="${IMG}" alt="e${i}"/><span>進化${i}</span></button>`).join('')}</div>`,
};
async function probe(browser, css, fix, vp) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 600, hasTouch: vp.width < 600, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.setContent(pageHtml(css, FIX[fix]), { waitUntil: 'load' });
  const r = await pg.evaluate(() => {
    const R = (id) => { const el = document.getElementById(id); if (!el) return null; const q = el.getBoundingClientRect(); return { x: Math.round(q.x), r: Math.round(q.right), y: Math.round(q.y), b: Math.round(q.bottom), h: Math.round(q.height) }; };
    const ov = document.getElementById('ov');
    return { m: R('m'), yes: R('yes'), no: R('no'), cancel: R('cancel'), pe: ov ? getComputedStyle(ov).pointerEvents : null, bg: ov ? getComputedStyle(ov).backgroundColor : null };
  });
  await ctx.close();
  return r;
}
async function measureAll(browser, css) {
  const d = { width: 1440, height: 900 };
  const bin = await probe(browser, css, 'BIN', d);
  const binBlue = await probe(browser, css, 'BIN_BLUE', d);
  const binM = await probe(browser, css, 'BIN', { width: 390, height: 844 });
  const drag = await probe(browser, css, 'DRAG', { width: 390, height: 844 });
  const evo = await probe(browser, css, 'EVO', { width: 1366, height: 657 });
  return {
    gap: bin.cancel && bin.no ? bin.no.x - bin.cancel.r : -1, gapBlue: binBlue.cancel && binBlue.no ? binBlue.no.x - binBlue.cancel.r : -1,
    orderOk: bin.cancel.x < bin.no.x && bin.no.x < bin.yes.x, mobileEq: Math.abs(binM.cancel.r - binM.cancel.x - (binM.yes.r - binM.yes.x)) <= 1 && binM.cancel.x < binM.no.x,
    dragPe: drag.pe, dragBg: drag.bg, evoTop: evo.m.y, evoH: evo.m.h,
  };
}
const chromium = pwChromium('v6.455 複審跟進量測');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.455 複審跟進量測');
  if (browser) {
    try {
      const cur = await measureAll(browser, extractCss(SRC));
      ok('★★★[D①] 桌機：「取消出招」與「否」之間至少留 24px（綠底與新版桌墊都是），順序＝取消｜否｜是', cur.gap >= 24 && cur.gapBlue >= 24 && cur.orderOk, JSON.stringify(cur));
      ok('★★[D①] 手機直式：三顆等寬、取消在最左', cur.mobileEq, JSON.stringify(cur));
      ok('★★★[D②] 手機直式撤退遮罩拖開時 pointer-events:none、透明', cur.dragPe === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(cur.dragBg), JSON.stringify(cur));
      ok('★★★[D③] 6 個選項的進化選單在 1366×657 不超出頂端', cur.evoTop >= 0, JSON.stringify(cur));
      if (BASE_SRC) {
        const b = await measureAll(browser, extractCss(BASE_SRC));
        ok('★★★[HEAD-FAIL 量測] v6.454 上三個缺口都量得出來（間距只有 gap、拖開仍擋觸控、進化選單超出頂端）',
          b.gap < 24 && b.dragPe === 'auto' && b.evoTop < 0, JSON.stringify(b));
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.455 複審跟進: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6455-review-followups ===');
process.exit(fail ? 1 : 0);
