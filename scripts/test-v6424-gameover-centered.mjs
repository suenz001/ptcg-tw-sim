/**
 * v6.424 守衛：對戰結束的勝負結算小視窗必須置中（站長回報：改版後都偏到右下角）。
 *
 * 【真因】v6.420 把拖曳收斂到 src/lib/modal-drag.ts 時，刪掉了勝負視窗舊的 inline
 *   `style:transform={translate(calc(-50% + x), calc(-50% + y))}`；而置中的 translate(-50%,-50%)
 *   **只**寫在那一行（CSS 只有 top:50%／left:50%）⇒ 視窗左上角落在畫面中央 ⇒ 整個偏右下。
 *   v6.420 的註解還寫著「它靠 CSS transform 置中」—— 那是我沒有查證就寫下的錯誤前提。
 * 【修法】把 translate(-50%,-50%) 補進 .gameover-modal 的 CSS；拖曳位移走獨立的 CSS translate 屬性，兩者疊加。
 * 【守法】
 *   S：語義掃描 —— 樣式區塊裡**所有** position:fixed ＋ top:50% ＋ left:50% 的規則都必須有 translate(-50%,-50%)
 *      （不是只釘 .gameover-modal 一條；下一個「靠 inline 置中」被刪掉的視窗也抓得到）。
 *   P：Playwright —— 把頁面上**真正的** .gameover-modal 規則原文搬進測試頁，掛上真的 modalDrag，
 *      量視窗中心是否在畫面中心；再拖一次確認拖曳仍然有效、且拖完還在畫面內。
 * 【HEAD-FAIL】BASE（v6.423）：S1、S2、P1 紅。
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { build } from 'esbuild';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { cssOf } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const failed = [];
const T = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; failed.push(n.split(' ')[0]); console.log('FAIL ' + n + ' :: ' + (e && e.message)); } };
const TA = async (n, fn) => { try { await fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; failed.push(n.split(' ')[0]); console.log('FAIL ' + n + ' :: ' + (e && e.message)); } };

const FILES = ['src/routes/game/+page.svelte', 'src/routes/game/MobilePortraitBattle.svelte'];
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
/** 回傳 [{ file, sel, body }]：所有頂層與 @media 內的簡單規則（不含巢狀大括號的規則本體）。 */
function rules(file) {
  const css = stripCssComments(cssOf(readFileSync(join(ROOT, file), 'utf8'), file));
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ file, sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  return out;
}
const ALL = FILES.flatMap(rules);
const isFixedCenter = (b) => /(^|;|\s)position\s*:\s*fixed\b/.test(b) && /(^|;|\s)top\s*:\s*50%/.test(b) && /(^|;|\s)left\s*:\s*50%/.test(b);
const hasCenterXf = (b) => /transform\s*:\s*translate\(\s*-50%\s*,\s*-50%\s*\)/.test(b);

console.log('\n【S】靜態：固定定位＋top/left 50% 的視窗一律要有 translate(-50%,-50%)');
T('S0 ⭐掃描器下限：兩個檔案的樣式區塊都抽得到大量規則', () => {
  assert.ok(ALL.filter((r) => r.file === FILES[0]).length > 800, '+page.svelte 規則數過少：' + ALL.filter((r) => r.file === FILES[0]).length);
  assert.ok(ALL.filter((r) => r.file === FILES[1]).length > 50, 'MobilePortraitBattle 規則數過少');
});
T('S1 ⭐⭐⭐【HEAD-FAIL】.gameover-modal 的 CSS 自己就有 translate(-50%,-50%)（不再依賴 inline style）', () => {
  // 另有一條 @media 手機直式只改寬高的 .gameover-modal ⇒ 取帶 position:fixed 的那一條（基底規則）
  const g = ALL.filter((r) => r.file === FILES[0] && r.sel === '.gameover-modal' && /position\s*:\s*fixed/.test(r.body));
  assert.strictEqual(g.length, 1, '.gameover-modal 基底規則找到 ' + g.length + ' 條');
  assert.ok(isFixedCenter(g[0].body), '.gameover-modal 不再是 fixed＋50%/50%（anchor 失效？）');
  assert.ok(hasCenterXf(g[0].body), '.gameover-modal 沒有置中的 transform ⇒ 會偏到右下角');
});
T('S2 ⭐⭐【HEAD-FAIL】語義掃描：所有 fixed＋top:50%＋left:50% 的規則都有置中 transform（至少掃到 1 條）', () => {
  const hits = ALL.filter((r) => isFixedCenter(r.body));
  assert.ok(hits.length >= 1, '一條都沒掃到 —— 掃描器壞了？');
  const bad = hits.filter((r) => !hasCenterXf(r.body));
  assert.strictEqual(bad.length, 0, '這些視窗沒有置中 transform：' + bad.map((r) => r.file + ' ' + r.sel).join('、'));
});
T('S3 ⭐反安慰劑：S2 的判準對「只有 top/left 50%、沒有 transform」的樣本必須判為違規', () => {
  const sample = 'position: fixed; top: 50%; left: 50%; width: 10px;';
  assert.ok(isFixedCenter(sample) && !hasCenterXf(sample));
  assert.ok(hasCenterXf(sample + ' transform: translate(-50%, -50%);'));
});
T('S4 ⭐勝負視窗仍掛中央拖曳、而且沒有自己的 inline transform（不會與中央 action 打架）', () => {
  const src = readFileSync(join(ROOT, FILES[0]), 'utf8');
  const tags = [...src.matchAll(/<div class="gameover-modal"([^>]*)>/g)].map((m) => m[1]);
  assert.ok(tags.length >= 2, '勝負／平手視窗只找到 ' + tags.length + ' 個');
  for (const t of tags) { assert.ok(t.includes('use:modalDrag'), '沒掛 use:modalDrag'); assert.ok(!/style:transform|style="[^"]*transform/.test(t), '又用 inline transform 了'); }
});

console.log('\n【P】Playwright：真的 .gameover-modal CSS ＋ 真的 modalDrag');
const chromium = pwChromium('v6.424 【P】勝負視窗置中實測');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.424 【P】勝負視窗置中實測');
  if (browser) {
    try {
      const dir = mkdtempSync(join(tmpdir(), 'v6424-'));
      await build({ entryPoints: [join(ROOT, 'src/lib/modal-drag.ts')], bundle: true, format: 'iife', globalName: 'MDRAG', outfile: join(dir, 'md.js'), logLevel: 'silent' });
      const md = readFileSync(join(dir, 'md.js'), 'utf8');
      const g = ALL.find((r) => r.file === FILES[0] && r.sel === '.gameover-modal' && /position\s*:\s*fixed/.test(r.body));
      const head = ALL.find((r) => r.file === FILES[0] && r.sel === '.gameover-modal-header');
      const HTML = `<!doctype html><html><head><style>html,body{margin:0;height:100%;}
        .gameover-modal{${g ? g.body : ''}} .gameover-modal-header{${head ? head.body : ''}} .gameover-modal-body{height:220px;}
      </style></head><body><div class="gameover-modal" id="m"><div class="gameover-modal-header modal-drag-handle" id="h">☰ 拖曳移動</div><div class="gameover-modal-body">結算</div></div></body></html>`;
      for (const [vw, vh] of [[1280, 800], [375, 667]]) {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
        const pg = await ctx.newPage();
        await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
        await pg.goto('https://t.local/');
        await pg.addScriptTag({ content: md });
        // ⭐v6.425（Rule 40）：本條守「置中 transform 不影響夾制」，用 v6.420 的完整夾制規則（contain）驗
        await pg.evaluate(() => { window.MDRAG.modalDrag(document.getElementById('m'), { clamp: 'contain' }); });
        const r0 = await pg.evaluate(() => { const r = document.getElementById('m').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, l: r.left, t: r.top, rr: r.right, b: r.bottom }; });
        // eslint-disable-next-line no-await-in-loop
        await TA(`P1 ⭐⭐⭐【HEAD-FAIL】${vw}×${vh}：勝負視窗中心在畫面中心（誤差 ≤ 2px）`, () => {
          assert.ok(Math.abs(r0.cx - vw / 2) <= 2 && Math.abs(r0.cy - vh / 2) <= 2, `中心在 (${r0.cx.toFixed(1)}, ${r0.cy.toFixed(1)})，畫面中心 (${vw / 2}, ${vh / 2})`);
        });
        const hb = await pg.locator('#h').boundingBox();
        await pg.mouse.move(hb.x + 30, hb.y + hb.height / 2); await pg.mouse.down();
        await pg.mouse.move(hb.x + 30 + 3000, hb.y + hb.height / 2 + 3000, { steps: 8 }); await pg.mouse.up();
        const r1 = await pg.evaluate(() => { const r = document.getElementById('m').getBoundingClientRect(); return { l: r.left, t: r.top, rr: r.right, b: r.bottom, tr: document.getElementById('m').style.translate }; });
        // eslint-disable-next-line no-await-in-loop
        await TA(`P2 ⭐⭐${vw}×${vh}：往右下拖 3000px ⇒ 有移動、而且整個視窗仍在畫面內（置中 transform 不影響夾制）`, () => {
          assert.ok(r1.tr, '沒有移動');
          assert.ok(r1.l >= -0.5 && r1.t >= -0.5 && r1.rr <= vw + 0.5 && r1.b <= vh + 0.5, JSON.stringify(r1));
        });
        // ⭐v6.425：正式的勝負視窗用的是預設 reachable 夾制 ⇒ 也驗一次（對齊正式行為，fable 審查建議）
        await pg.reload(); await pg.addScriptTag({ content: md });
        await pg.evaluate(() => { window.MDRAG.modalDrag(document.getElementById('m')); });
        const hb2 = await pg.locator('#h').boundingBox();
        // ⚠ v6.426 起把手最前面是折疊鈕（按下去不拖曳）⇒ 抓 x+80
        await pg.mouse.move(hb2.x + 80, hb2.y + hb2.height / 2); await pg.mouse.down();
        await pg.mouse.move(hb2.x + 80 + 3000, hb2.y + hb2.height / 2 + 3000, { steps: 8 }); await pg.mouse.up();
        const r2 = await pg.evaluate(() => { const r = document.getElementById('m').getBoundingClientRect(); return { l: r.left, t: r.top }; });
        // eslint-disable-next-line no-await-in-loop
        await TA(`P2b ⭐⭐${vw}×${vh}：預設（reachable）往右下拖 ⇒ 可出畫面但把手一角仍在（l ≤ vw−72、0 ≤ t ≤ vh−56）`, () => {
          assert.ok(r2.l <= vw - 72 + 0.5 && r2.t >= -0.5 && r2.t <= vh - 56 + 0.5, JSON.stringify(r2));
          assert.ok(r2.l > vw / 2, '沒有真的往右移出去：' + JSON.stringify(r2));
        });
        // eslint-disable-next-line no-await-in-loop
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.424 勝負視窗置中：${pass} PASS / ${fail} FAIL ===` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
