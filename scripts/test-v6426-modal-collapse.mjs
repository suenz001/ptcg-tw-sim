// v6.426 守衛：所有一般視窗的標題列都有折疊鈕（玩家建議、站長同意）
//
// 需求：視窗可以折疊／展開，折疊後只剩標題列、不擋對戰畫面，要操作時再展開。
// 做法：中央 `use:modalDrag` 自己在標題列最前面加一顆 ▾／▸（全站視窗一次到位、不各寫一份）；
//   折疊用 CSS 只「藏」標題列以外的子元素（Svelte 管理的 DOM 一個都不動 ⇒ 展開後已選的卡、捲動位置都還在），
//   折疊時背景讓出來（overlay 加 dragged）；浮動按鈕／面板（clamp:'contain'、wholeNode）不加。
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const esbuild = require_('esbuild');
let pass = 0, fail = 0; const failed = [];
const T = async (name, fn) => { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; failed.push(name.split(' ')[0]); console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const tmp = mkdtempSync(join(tmpdir(), 'v6426-'));
let MD = {};
if (existsSync(join(ROOT, 'src/lib/modal-drag.ts'))) {
  await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/modal-drag.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(tmp, 'md.mjs'), logLevel: 'silent' });
  MD = await import(pathToFileURL(join(tmp, 'md.mjs')).href);
}
const collapsible = typeof MD.modalCollapsible === 'function' ? MD.modalCollapsible : () => { throw new Error('（BASE 上沒有 modalCollapsible）'); };
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const MPB = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');

console.log('【A】哪些視窗有折疊鈕');
await T('A1 ⭐⭐【HEAD-FAIL】一般視窗預設有；contain（浮動按鈕／面板）與 wholeNode 沒有；可以明確關掉', () => {
  assert.strictEqual(collapsible({}), true);
  assert.strictEqual(collapsible({ resetKey: 'x' }), true);
  assert.strictEqual(collapsible({ clamp: 'contain' }), false);
  assert.strictEqual(collapsible({ wholeNode: true }), false);
  assert.strictEqual(collapsible({ collapsible: false }), false);
  assert.strictEqual(collapsible({ clamp: 'contain', collapsible: true }), true);
});
await T('A2 ⭐對戰頁沒有任何視窗偷偷關掉折疊（collapsible:false 需要理由，目前一個都沒有）', () => {
  assert.ok(!/collapsible:\s*false/.test(PAGE) && !/collapsible:\s*false/.test(MPB), '有視窗關掉了折疊鈕');
  const n = (PAGE.match(/use:modalDrag/g) || []).length + (MPB.match(/use:modalDrag/g) || []).length;
  assert.ok(n >= 25, '只掃到 ' + n + ' 個 use:modalDrag（掃描器壞了？）');
});

console.log('【B】Playwright：真的按一次');
const chromium = MD.modalDrag ? pwChromium('v6.426 【B】折疊鈕實測') : null;
if (!MD.modalDrag) await T('B0 ⭐【HEAD-FAIL】中央模組可載入', () => assert.fail('modal-drag 不存在'));
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.426 【B】折疊鈕實測');
  if (browser) {
    try {
      const bundle = join(tmp, 'md-iife.js');
      await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/modal-drag.ts')], bundle: true, format: 'iife', globalName: 'MDRAG', outfile: bundle, logLevel: 'silent' });
      const md = readFileSync(bundle, 'utf8');
      const HTML = `<!doctype html><html><head><style>
        html,body{margin:0;height:100%;}
        #board{position:fixed;inset:0;background:#040;}
        .selection-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;}
        .selection-overlay.dragged{background:transparent;pointer-events:none;}
        .selection-overlay.dragged .selection-modal{pointer-events:auto;}
        .selection-modal{background:#123;width:355px;padding:.6rem;box-sizing:border-box;}
        .sel-header{height:40px;background:#245;color:#fff;touch-action:none;}
        .grid{height:300px;background:#346;} .foot{height:40px;}
      </style></head><body>
        <div id="board">棋盤</div>
        <div class="selection-overlay" id="ov"><div class="selection-modal" id="m">
          <div class="sel-header" id="h">標題</div>
          <div class="grid" id="g"><input id="pick" value="已選的卡"></div>
          <div class="foot" id="f"><button id="ok">確定</button></div>
          <button class="zoom-close" id="cl" style="position:absolute;right:4px;top:4px">✕</button>
        </div></div>
        <div class="selection-overlay" id="ov3" style="display:none"><div class="selection-modal" id="m3"><div class="sel-header" id="h3">乙</div><div class="grid">內容</div></div></div>
        <div class="selection-overlay" id="ov2" style="display:none"><button class="chat-fab" id="fab">💬</button></div>
      </body></html>`;
      const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
      const pg = await ctx.newPage();
      await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
      await pg.goto('https://t.local/');
      await pg.addScriptTag({ content: md });
      await pg.evaluate(() => {
        window.__h = window.MDRAG.modalDrag(document.getElementById('m'), { resetKey: 'A' });
        window.MDRAG.modalDrag(document.getElementById('fab'), { clamp: 'contain', wholeNode: true, overlay: false });
      });
      const s0 = await pg.evaluate(() => ({
        btn: !!document.querySelector('#m .modal-collapse-btn'),
        first: document.getElementById('h').firstChild === document.querySelector('#m .modal-collapse-btn'),
        fabBtn: !!document.querySelector('#fab .modal-collapse-btn, #ov2 .modal-collapse-btn'),
        h: document.getElementById('m').getBoundingClientRect().height,
      }));
      await T('B1 ⭐⭐⭐【HEAD-FAIL】一般視窗掛上中央 action 就自動有折疊鈕；浮動按鈕沒有', () => {
        assert.ok(s0.btn, '沒有折疊鈕');
        assert.ok(!s0.fabBtn, '浮動按鈕也被加了折疊鈕');
        assert.ok(s0.first, '折疊鈕不在標題列最前面（會疊在標題文字上或跑到別處）');
      });
      if (!s0.btn) {
        // ⚠ Rule 41：BASE 上沒有折疊鈕 ⇒ 後面每一條各自誠實翻紅，不讓整支在 click 逾時處 throw
        for (const n of ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B9', 'B8']) await T(n + ' 【HEAD-FAIL】（沒有折疊鈕，無法實測）', () => assert.fail('沒有折疊鈕'));
      } else {
      await pg.fill('#pick', '我選的那張');
      await pg.click('#m .modal-collapse-btn');
      const s1 = await pg.evaluate(() => {
        const m = document.getElementById('m').getBoundingClientRect();
        const hit = document.elementFromPoint(20, 640);
        return { h: m.height, gridShown: getComputedStyle(document.getElementById('g')).display !== 'none',
          footShown: getComputedStyle(document.getElementById('f')).display !== 'none',
          closeShown: getComputedStyle(document.getElementById('cl')).display !== 'none',
          headShown: getComputedStyle(document.getElementById('h')).display !== 'none',
          boardHit: !!hit && hit.id === 'board', label: document.querySelector('#m .modal-collapse-btn').getAttribute('aria-expanded') };
      });
      await T('B2 ⭐⭐⭐【HEAD-FAIL】按下去 ⇒ 只剩標題列（內容藏起來、視窗變矮）', () => {
        assert.ok(s1.headShown && !s1.gridShown && !s1.footShown, '標題列以外的內容沒有全部藏起來：' + JSON.stringify(s1));
        assert.ok(s1.closeShown, '關閉鈕被藏起來了（折疊狀態下就關不掉）');
        assert.ok(s1.h < s0.h / 2, '視窗沒有變矮：' + s0.h + ' → ' + s1.h);
        assert.strictEqual(s1.label, 'false');
      });
      await T('B3 ⭐⭐ 折疊後背景讓出來：下面的對戰畫面點得到', () => {
        assert.ok(s1.boardHit, '背景仍被遮罩擋住');
      });
      // 折疊狀態下仍可拖（把手在）
      const hb = await pg.locator('#h').boundingBox();
      await pg.mouse.move(hb.x + 80, hb.y + 20); await pg.mouse.down();
      await pg.mouse.move(hb.x + 80 + 60, hb.y + 20 + 200, { steps: 5 }); await pg.mouse.up();
      const moved = await pg.evaluate(() => document.getElementById('m').style.translate);
      await T('B4 折疊狀態下仍然拖得動', () => { assert.ok(moved, '拖不動'); });
      await pg.click('#m .modal-collapse-btn');
      const s2 = await pg.evaluate(() => ({ gridShown: getComputedStyle(document.getElementById('g')).display !== 'none', val: document.getElementById('pick').value, h: document.getElementById('m').getBoundingClientRect().height }));
      await T('B5 ⭐⭐⭐ 再按一次 ⇒ 展開，而且折疊前的狀態都還在（只藏不拆）', () => {
        assert.ok(s2.gridShown, '沒有展開');
        assert.strictEqual(s2.val, '我選的那張', '內容被重建了（已選的東西不見）');
        assert.ok(Math.abs(s2.h - s0.h) < 1, '高度沒有恢復');
      });
      // 按折疊鈕不可以觸發拖曳
      const t0 = await pg.evaluate(() => document.getElementById('m').style.translate);
      const bb = await pg.locator('#m .modal-collapse-btn').boundingBox();
      await pg.mouse.move(bb.x + 5, bb.y + 5); await pg.mouse.down();
      await pg.mouse.move(bb.x + 105, bb.y + 105, { steps: 5 }); await pg.mouse.up();
      const t1 = await pg.evaluate(() => document.getElementById('m').style.translate);
      await T('B6 ⭐按在折疊鈕上拖 ⇒ 不會拖動視窗（按鈕按得到）', () => { assert.strictEqual(t1, t0); });
      // 換成另一個視窗內容（resetKey 變）⇒ 一律展開
      await pg.click('#m .modal-collapse-btn');
      await pg.evaluate(() => { window.__h.update({ resetKey: 'B' }); });
      const s3 = await pg.evaluate(() => ({ collapsed: document.getElementById('m').classList.contains('modal-collapsed'), n: document.querySelectorAll('#m .modal-collapse-btn').length }));
      await T('B7 ⭐⭐ 換成另一個視窗內容（resetKey 變）⇒ 自動展開；折疊鈕不會重複加', () => {
        assert.strictEqual(s3.collapsed, false);
        assert.strictEqual(s3.n, 1, '折疊鈕加了 ' + s3.n + ' 顆');
      });
      // 沒拖過的視窗：折疊 → 展開 ⇒ 遮罩要恢復（背景不可以一直可點）
      await pg.evaluate(() => { document.getElementById('ov3').style.display = 'flex'; window.MDRAG.modalDrag(document.getElementById('m3')); });
      await pg.click('#m3 .modal-collapse-btn');
      const d1 = await pg.evaluate(() => document.getElementById('ov3').classList.contains('dragged'));
      await pg.click('#m3 .modal-collapse-btn');
      const d2 = await pg.evaluate(() => document.getElementById('ov3').classList.contains('dragged'));
      await T('B9 ⭐沒拖過的視窗：折疊時背景讓出、展開後遮罩恢復', () => {
        assert.ok(d1 && !d2, 'dragged：折疊時 ' + d1 + '、展開後 ' + d2);
      });
      await pg.evaluate(() => { window.__h.destroy(); });
      const s4 = await pg.evaluate(() => document.querySelectorAll('#m .modal-collapse-btn').length);
      await T('B8 視窗關閉（action destroy）⇒ 折疊鈕一起移除', () => { assert.strictEqual(s4, 0); });
      }
      await ctx.close();
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.426 視窗折疊鈕：PASS ${pass} / FAIL ${fail} ===` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
