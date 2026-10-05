#!/usr/bin/env node
/**
 * v6.487 守衛：可及性基礎補強（站長同意的建議 #6）。
 *   ① 全站鍵盤焦點框：layout 的 :where(...):focus-visible（特異度 0，不蓋各頁自己的 outline）。
 *   ② 頂端列「跳到主要內容」：網頁版 Tab 第一個停在它、按下去焦點跳到 <main>／<h1>；平常看不到。
 *   ③ 中央 pageScrollLock：視窗關掉時把焦點還給打開它的元素（觸控裝置上原本是輸入框就不還，免得彈出鍵盤；
 *      焦點已被別的元素接走就不搶）。
 * HEAD-FAIL：靜態判準餵 v6.486 必須紅。
 * Run: node scripts/test-v6487-a11y-focus.mjs
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.486。
const BASE_SHA = 'ecbc90fd';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const judge = (get) => ({
  S1: /:global\(:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible\) \{\n\s*outline: 2px solid/.test(get('src/routes/+layout.svelte')),
  S2: /<button class="stb-skip" type="button" onclick=\{\(\) => focusMainContent\(\)\}>跳到主要內容<\/button>/.test(get('src/lib/SiteTopBar.svelte')),
  S3: /restoreFocusAfterModal\(prevFocus, node\);/.test(get('src/lib/page-scroll-lock.ts')),
});
console.log('【S】靜態');
const J = judge(rd);
ok('★★★[S1] layout 有全站 :focus-visible 焦點框（:where 特異度 0）', J.S1);
ok('★★★[S2] 頂端列有「跳到主要內容」', J.S2);
ok('★★★[S3] 中央 pageScrollLock 關閉時還焦點', J.S3);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.486 全紅', !B.S1 && !B.S2 && !B.S3, JSON.stringify(B));
} else shallowSkip('v6487 S0：HEAD-FAIL', '需要 BASE commit');

const chromiumL = pwChromium('v6.487 焦點');
if (chromiumL) {
  const browser = await pwLaunchWith(chromiumL, 'v6.487 焦點');
  if (browser) {
    try {
      console.log('\n【L】還焦點的判斷（真瀏覽器 DOM）');
      const require_ = createRequire(import.meta.url);
      const esbuild = require_('esbuild');
      const tmp = mkdtempSync(join(tmpdir(), 'v6487-'));
      const out = join(tmp, 'psl.js');
      await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/page-scroll-lock.ts')], bundle: true, format: 'iife', globalName: 'PSL', outfile: out, logLevel: 'silent' });
      const js = readFileSync(out, 'utf8');
      const HTML = '<!doctype html><html><body><button id="opener">開</button><input id="q"><button id="other">別的</button><div id="modal"><button id="inside">內</button></div></body></html>';
      for (const touch of [false, true]) {
        const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, isMobile: touch, hasTouch: touch });
        const pg = await ctx.newPage();
        await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
        await pg.goto('https://t.local/'); await pg.addScriptTag({ content: js });
        const R = await pg.evaluate(() => {
          const $ = (id) => document.getElementById(id); const f = window.PSL.restoreFocusAfterModal;
          const r = {};
          $('inside').focus(); r.restore = f($('opener'), $('modal')) && document.activeElement === $('opener');
          $('other').focus(); r.noSteal = !f($('opener'), $('modal')) && document.activeElement === $('other');
          const gone = document.createElement('button'); r.gone = !f(gone, $('modal'));
          $('inside').focus(); r.input = f($('q'), $('modal'));
          return r;
        });
        await ctx.close();
        const tag = touch ? '觸控' : '桌機';
        ok(`★★★[L1] ${tag}：焦點在視窗裡（或 body）⇒ 還給打開視窗的按鈕`, R.restore, JSON.stringify(R));
        ok(`★★[L2] ${tag}：焦點已被別的元素接走 ⇒ 不搶；原元素已不在頁面上 ⇒ 不還`, R.noSteal && R.gone, JSON.stringify(R));
        ok(`★★★[L3] ${tag}：原焦點是輸入框 ⇒ ${touch ? '觸控裝置不還（免得彈出鍵盤）' : '桌機照常還'}`, touch ? R.input === false : R.input === true, JSON.stringify(R));
      }

      console.log('\n【E】真站（build/）');
      const BUILD = join(ROOT, 'build');
      if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/）');
      else {
        const { createReadStream, statSync } = await import('node:fs');
        const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
        const srv = http.createServer((req, res) => {
          const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
          if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
          if (!existsSync(p)) p = join(BUILD, '404.html');
          res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
        });
        await new Promise((r) => srv.listen(0, r));
        const port = srv.address().port;
        const errs = [];
        try {
          const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
          await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
          const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
          await pg.goto(`http://localhost:${port}/cards?set=ALL`, { waitUntil: 'load' }); await pg.waitForSelector('.cardBtn', { timeout: 20000 });
          const hidden = await pg.evaluate(() => document.querySelector('.stb-skip').getBoundingClientRect().bottom <= 0);
          await pg.keyboard.press('Tab');
          const A = await pg.evaluate(() => ({ cls: document.activeElement?.className ?? '', top: document.activeElement?.getBoundingClientRect().top ?? -1, outline: getComputedStyle(document.activeElement).outlineStyle }));
          await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
          const B = await pg.evaluate(() => document.activeElement?.tagName);
          // 卡片：鍵盤聚焦後按 Enter 打開，關掉後焦點回到那張卡
          await pg.focus('.cardBtn >> nth=2'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(500);
          const opened = await pg.evaluate(() => !!document.querySelector('.modalInner'));
          await pg.click('.modalInner .close'); await pg.waitForTimeout(400);
          const back = await pg.evaluate(() => { const b = document.querySelectorAll('.cardBtn')[2]; return document.activeElement === b; });
          await ctx.close();
          ok('★★[E1] 1280：「跳到主要內容」平常在畫面外', hidden);
          ok('★★★[E2] 1280：Tab 第一個停在「跳到主要內容」、出現在畫面上、有焦點框', /stb-skip/.test(A.cls) && A.top >= 0 && A.outline !== 'none', JSON.stringify(A));
          ok('★★★[E3] 1280：按下去焦點跳到頁面主要內容', B === 'MAIN' || B === 'H1', String(B));
          ok('★★★[E4] 1280：用鍵盤打開卡片、關掉後焦點回到那張卡', opened && back, JSON.stringify({ opened, back }));
          ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
        } finally { srv.close(); }
      }
    } finally { await browser.close(); }
  }
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
