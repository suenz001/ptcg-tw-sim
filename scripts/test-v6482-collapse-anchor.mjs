// v6.482 守衛：視窗折疊後「標題列留在原地」（站長回報）
//
// 症狀：手機看卡片詳情等視窗，按標題列的折疊鈕 ⇒ 折疊後的小視窗跑到別的位置（往下掉）；
//   視窗拖到下方時再按，整個掉出畫面。
// 真因：視窗由遮罩用 flex 置中（或像手機動作選單貼底）——折疊後高度變小就被重新排版，標題列跟著移動。
// 修法（中央 src/lib/modal-drag.ts，全站視窗同一份）：按折疊鈕時先記下標題列在畫面上的位置，
//   切換後把差距補進位移；展開時回到折疊前的位置（折疊期間拖過就同樣讓標題列留在原地）。
// HEAD-FAIL：同一組實測餵 v6.481 的 modal-drag.ts 必須紅（標題列會移動）。
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.481。
const BASE_SHA = '4c887e8a';
const require_ = createRequire(import.meta.url);
const esbuild = require_('esbuild');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const tmp = mkdtempSync(join(tmpdir(), 'v6482-'));
async function bundleOf(src, name) {
  const f = join(tmp, name + '.ts'); writeFileSync(f, src);
  const out = join(tmp, name + '.js');
  await esbuild.build({ entryPoints: [f], bundle: true, format: 'iife', globalName: 'MDRAG', outfile: out, logLevel: 'silent' });
  return readFileSync(out, 'utf8');
}
const CUR = await bundleOf(readFileSync(join(ROOT, 'src/lib/modal-drag.ts'), 'utf8'), 'cur');
let BASE = null;
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, 'src/lib/modal-drag.ts'); if (r.ok) BASE = await bundleOf(r.out, 'base'); }
else shallowSkip('v6482 H：HEAD-FAIL', '需要 BASE commit');

const HTML = `<!doctype html><html><head><style>
  html,body{margin:0;height:100%;}
  #board{position:fixed;inset:0;background:#040;}
  .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;justify-content:center;}
  .ov.center{align-items:center;} .ov.bottom{align-items:flex-end;}
  .ov.dragged{background:transparent;pointer-events:none;} .ov.dragged .m{pointer-events:auto;}
  .m{background:#123;width:355px;box-sizing:border-box;padding:6px;}
  .hd{height:40px;background:#245;color:#fff;touch-action:none;}
  .body{height:380px;background:#346;}
</style></head><body><div id="board"></div>
  <div class="ov center" id="ovA"><div class="m" id="mA"><div class="hd sel-header" id="hA">置中視窗</div><div class="body"></div></div></div>
  <div class="ov bottom" id="ovB" style="display:none"><div class="m" id="mB"><div class="hd sel-header" id="hB">貼底選單</div><div class="body"></div></div></div>
</body></html>`;

async function scenario(pg, which) {
  const m = '#m' + which, h = '#h' + which;
  await pg.evaluate((w) => { for (const o of document.querySelectorAll('.ov')) o.style.display = 'none'; document.getElementById('ov' + w).style.display = 'flex'; window['__' + w] = window.MDRAG.modalDrag(document.getElementById('m' + w), {}); }, which);
  const top = () => pg.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().top), h);
  const r = {};
  r.t0 = await top();
  await pg.click(m + ' .modal-collapse-btn'); await pg.waitForTimeout(50);
  r.t1 = await top();
  await pg.click(m + ' .modal-collapse-btn'); await pg.waitForTimeout(50);
  r.t2 = await top();
  // 拖到畫面下方（標題列在 y≈560）再折疊 ⇒ 不可以掉出畫面、標題列留在原地
  const hb = await pg.locator(h).boundingBox();
  await pg.mouse.move(hb.x + 200, hb.y + 20); await pg.mouse.down();
  await pg.mouse.move(hb.x + 200, 580, { steps: 6 }); await pg.mouse.up();
  r.t3 = await top();
  await pg.click(m + ' .modal-collapse-btn'); await pg.waitForTimeout(50);
  r.t4 = await top();
  r.vis = await pg.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }, h);
  await pg.click(m + ' .modal-collapse-btn'); await pg.waitForTimeout(50);
  r.t5 = await top();
  return r;
}
async function runWith(browser, md) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: false });
  const pg = await ctx.newPage();
  await pg.route('**/*', (rq) => rq.fulfill({ contentType: 'text/html', body: HTML }));
  await pg.goto('https://t.local/');
  await pg.addScriptTag({ content: md });
  const A = await scenario(pg, 'A');
  const B = await scenario(pg, 'B');
  await ctx.close();
  return { A, B };
}
const near = (a, b) => Math.abs(a - b) <= 1;
const good = (r) => near(r.t0, r.t1) && near(r.t2, r.t0) && near(r.t3, r.t4) && r.vis && near(r.t5, r.t3);

const chromium = pwChromium('v6.482 折疊定位');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.482 折疊定位');
  if (browser) {
    try {
      const C = await runWith(browser, CUR);
      ok('★★★[E1] 置中視窗：按折疊 ⇒ 標題列不動；再按展開 ⇒ 回到原位', near(C.A.t0, C.A.t1) && near(C.A.t2, C.A.t0), JSON.stringify(C.A));
      ok('★★★[E2] 置中視窗拖到畫面下方再折疊 ⇒ 標題列留在原地、仍在畫面內；展開也不跳', near(C.A.t3, C.A.t4) && C.A.vis && near(C.A.t5, C.A.t3), JSON.stringify(C.A));
      ok('★★★[E3] 貼底選單（手機動作選單 .mp-sheet 的排法）：折疊／展開標題列都不動', good(C.B), JSON.stringify(C.B));
      ok('[E0] 正對照：拖曳真的把視窗拖到畫面下方（E2 才有意義）；折疊在 H1 證明會讓標題列移動', C.A.t3 > 400, String(C.A.t3));
      if (BASE) {
        const B = await runWith(browser, BASE);
        ok('★★[H1] HEAD-FAIL：v6.481 的 modal-drag 折疊後標題列會移動（置中與貼底都紅）', !good(B.A) && !good(B.B), JSON.stringify(B));
      }
    } finally { await browser.close(); }
  }
}
console.log(`\n=== v6.482 折疊定位: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
