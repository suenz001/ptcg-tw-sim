// ⭐v6.495 守衛：聊天視窗可由玩家調整大小（長寬），並由瀏覽器記住（站長需求 2026-10-06）
//
// 【A】純函式：clampPanelSize／resizeByGrip／loadPanelSize
// 【B】對戰頁接線：聊天視窗掛 use:panelResize（桌機 tl／手機直式 br、兩份 key），位置也記住
// 【C】Playwright 實拉：拉左上角 ⇒ 變大、寫進 localStorage；重新掛載 ⇒ 讀回同一尺寸；雙擊 ⇒ 恢復預設並清掉記錄；
//      拉到比視窗大 ⇒ 夾在視窗內；localStorage 被封鎖 ⇒ 仍可拉、不丟例外
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require_ = createRequire(import.meta.url);
const esbuild = require_('esbuild');
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' :: ' + (e && e.message)); } };
const TA = async (n, f) => { try { await f(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' :: ' + (e && e.message)); } };

const SRC = join(ROOT, 'src/lib/panel-resize.ts');
const EXISTS = existsSync(SRC);
let M = null;
if (EXISTS) {
  const dir = mkdtempSync(join(tmpdir(), 'v6495a-'));
  await esbuild.build({ entryPoints: [SRC], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'pr.mjs'), logLevel: 'silent' });
  M = await import(pathToFileURL(join(dir, 'pr.mjs')).href);
}
const F = (n) => (typeof M?.[n] === 'function' ? M[n] : () => { throw new Error(`${n} 不存在`); });

console.log('【A】純函式');
T('A1 夾制：太小 ⇒ 最小值；太大 ⇒ 視窗扣邊距', () => {
  assert.deepEqual(F('clampPanelSize')({ w: 10, h: 10 }, 1280, 800), { w: 240, h: 200 });
  assert.deepEqual(F('clampPanelSize')({ w: 5000, h: 5000 }, 1280, 800), { w: 1248, h: 768 });
});
T('A2 視窗比最小值還小（極窄手機）⇒ 以視窗為準，不會超出', () => {
  const r = F('clampPanelSize')({ w: 300, h: 300 }, 200, 180);
  assert.ok(r.w <= 200 - 32 || r.w === 120, `w=${r.w}`); assert.ok(r.h <= 180, `h=${r.h}`);
});
T('A3 拉把方向：左上角往左上 ⇒ 變大；右下角往右下 ⇒ 變大', () => {
  assert.deepEqual(F('resizeByGrip')({ w: 350, h: 450 }, 'tl', -100, -50), { w: 450, h: 500 });
  assert.deepEqual(F('resizeByGrip')({ w: 350, h: 450 }, 'br', 100, 50), { w: 450, h: 500 });
});

console.log('【B】對戰頁接線');
const page = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const tagStart = page.indexOf('<div class="chat-panel"');
const tag = page.slice(tagStart, page.indexOf('>', page.indexOf('onEnd', tagStart)) + 1);
T('B0 找得到聊天視窗的開頭標籤', () => assert.ok(tagStart > 0 && tag.length < 800, '錨點失效'));
T('B1 聊天視窗掛 use:panelResize，桌機 tl／手機直式 br 各一份 key', () => {
  assert.match(tag, /use:panelResize=\{\{\s*storageKey:\s*isPortraitMobile \? 'ptcg_chat_panel_size_m' : 'ptcg_chat_panel_size',\s*grip:\s*isPortraitMobile \? 'br' : 'tl'/);
});
T('B2 位置也記住：initial 讀 localStorage、onEnd 寫回', () => {
  assert.match(tag, /initial:\s*loadChatPanelPos\(isPortraitMobile\)/);
  assert.match(tag, /onEnd:\s*saveChatPanelPos/);
  assert.match(page, /function saveChatPanelPos[\s\S]{0,200}localStorage\.setItem\(chatPanelPosKey\(isPortraitMobile\)/);
});

console.log('【C】Playwright 實拉');
const chromium = EXISTS ? pwChromium('v6.495 【C】聊天視窗拉大小') : null;
if (!EXISTS) T('C0 ⭐【HEAD-FAIL】panel-resize 模組存在', () => assert.fail('src/lib/panel-resize.ts 不存在'));
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.495 【C】聊天視窗拉大小');
  if (browser) {
    try {
      const dir = mkdtempSync(join(tmpdir(), 'v6495c-'));
      await esbuild.build({ entryPoints: [SRC], bundle: true, format: 'iife', globalName: 'PR', outfile: join(dir, 'pr.js'), logLevel: 'silent' });
      const js = readFileSync(join(dir, 'pr.js'), 'utf8');
      const HTML = `<!doctype html><html><head><style>
        html,body{margin:0;height:100%;background:#000}
        .chat-panel{position:fixed;right:18px;bottom:18px;width:350px;height:450px;background:#123;overflow:hidden}
        .panel-resize-grip{position:absolute;width:18px;height:18px;touch-action:none}
        .panel-resize-grip[data-grip="tl"]{top:0;left:0}
        .panel-resize-grip[data-grip="br"]{bottom:0;right:0}
      </style></head><body><div class="chat-panel" id="p">聊天</div></body></html>`;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const pg = await ctx.newPage();
      await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
      await pg.goto('https://t.local/');
      await pg.addScriptTag({ content: js });
      const mount = () => pg.evaluate(() => { window.__h?.destroy(); window.__h = window.PR.panelResize(document.getElementById('p'), { storageKey: 'k', grip: 'tl' }); });
      const box = () => pg.evaluate(() => { const r = document.getElementById('p').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
      const dragGrip = async (dx, dy) => {
        const g = await pg.locator('.panel-resize-grip').boundingBox();
        await pg.mouse.move(g.x + 9, g.y + 9); await pg.mouse.down();
        await pg.mouse.move(g.x + 9 + dx, g.y + 9 + dy, { steps: 8 }); await pg.mouse.up();
      };
      await mount();
      await TA('C1 拉左上角往左上 120×80 ⇒ 變大，並寫進 localStorage', async () => {
        const b0 = await box();
        await dragGrip(-120, -80);
        const b1 = await box();
        assert.ok(Math.abs(b1.w - (b0.w + 120)) <= 2 && Math.abs(b1.h - (b0.h + 80)) <= 2, `${JSON.stringify(b0)} → ${JSON.stringify(b1)}`);
        const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('k')));
        assert.ok(Math.abs(saved.w - b1.w) <= 1 && Math.abs(saved.h - b1.h) <= 1, JSON.stringify(saved));
      });
      await TA('C2 重新整理（重新掛載）⇒ 讀回同一尺寸', async () => {
        const before = await box();
        await pg.evaluate(() => { const p = document.getElementById('p'); p.removeAttribute('style'); });
        await mount();
        const after = await box();
        assert.deepEqual(after, before);
      });
      await TA('C3 拉超過視窗 ⇒ 夾在視窗內', async () => {
        await dragGrip(-3000, -3000);
        const b = await box();
        assert.ok(b.w <= 1280 - 32 && b.h <= 800 - 32, JSON.stringify(b));
      });
      await TA('C4 雙擊拉把 ⇒ 恢復預設 350×450、清掉記錄', async () => {
        await pg.locator('.panel-resize-grip').dblclick();
        assert.deepEqual(await box(), { w: 350, h: 450 });
        assert.equal(await pg.evaluate(() => localStorage.getItem('k')), null);
      });
      await TA('C5 localStorage 被封鎖 ⇒ 仍可拉、不丟例外', async () => {
        const errs = [];
        pg.on('pageerror', (e) => errs.push(e.message));
        await pg.evaluate(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
        await mount();
        const b0 = await box();
        await dragGrip(-50, -50);
        const b1 = await box();
        assert.ok(b1.w > b0.w && b1.h > b0.h, `${JSON.stringify(b0)} → ${JSON.stringify(b1)}`);
        assert.deepEqual(errs, []);
      });
      await ctx.close();
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.495 聊天視窗調整大小：${pass} PASS, ${fail} FAIL ===`);
if (fail) process.exit(1);
