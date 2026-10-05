#!/usr/bin/env node
/**
 * v6.486 守衛：自己的牌組也能「📋 複製一份」＋牌組「📝 備註」欄（站長同意的建議 #4）。
 *   【S】複製不再限預組；備註寫回牌組 notes（預組唯讀）；公布欄投稿說明預填備註、玩家改過不覆蓋（上限 200 字）。
 *   【E】真瀏覽器：預組 ⇒ 複製到我的牌組 ⇒ 自己的牌組出現「複製一份」⇒ 再複製一份（張數相同、名稱加（複製））；
 *        在備註打字 ⇒ 寫進本機存檔；預組的備註欄唯讀；手機也能用。
 * HEAD-FAIL：靜態判準餵 v6.485 必須紅。
 * Run: node scripts/test-v6486-deck-copy-notes.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.485。
const BASE_SHA = '307270cf';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const judge = (get) => {
  const d = get('src/routes/decks/+page.svelte');
  const p = get('src/routes/deck-posts/+page.svelte');
  const copyFn = (d.match(/function copyPresetToMine\(\) \{\n([^\n]*)/) || [])[1] || '';
  return {
    S1: copyFn.trim() === 'if (!active) return;' && /onclick=\{copyPresetToMine\} title="複製一份這副牌組/.test(d),
    S2: /function setActiveNotes\(notes: string\) \{\n\s*if \(!active \|\| isPresetActive\) return;\n\s*const updated = \{ \.\.\.active, notes \};/.test(d) && /<DeckNotes value=\{active\.notes \?\? ''\} readonly=\{isPresetActive\} onchange=\{setActiveNotes\} \/>/.test(d),
    S3: /if \(!postOpen \|\| postNotesTouched\) return;\n\s*postNotes = String\(d\?\.notes \?\? ''\)\.slice\(0, 200\);/.test(p) && /oninput=\{\(\) => \(postNotesTouched = true\)\}/.test(p),
  };
};
console.log('【S】靜態');
const J = judge(rd);
ok('★★★[S1] 自己的牌組也能複製（不再限預組）', J.S1);
ok('★★★[S2] 備註寫回牌組 notes、預組唯讀', J.S2);
ok('★★[S3] 公布欄投稿說明預填備註（玩家改過不覆蓋、200 字上限）', J.S3);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.485 全紅', !B.S1 && !B.S2 && !B.S3, JSON.stringify(B));
} else shallowSkip('v6486 S0：HEAD-FAIL', '需要 BASE commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.486') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.486');
  if (browser) {
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
      for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
        await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
        const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
        pg.on('dialog', (d) => d.accept());
        await pg.goto(`http://localhost:${port}/decks`, { waitUntil: 'load' }); await pg.waitForSelector('.preset-summary', { timeout: 20000 });
        await pg.click('.preset-summary'); await pg.waitForTimeout(300);
        await pg.locator('.preset-list li button').first().click(); await pg.waitForTimeout(1000);
        const presetRO = await pg.evaluate(() => document.querySelector('.dn-text')?.hasAttribute('readonly'));
        await pg.click('button:has-text("複製到我的牌組")'); await pg.waitForTimeout(800);
        const name1 = await pg.inputValue('.deck-title');
        const count1 = await pg.textContent('.count');
        await pg.click('button:has-text("📋 複製一份")'); await pg.waitForTimeout(800);
        const name2 = await pg.inputValue('.deck-title');
        const count2 = await pg.textContent('.count');
        const sumOpen = await pg.evaluate(() => document.querySelector('details.dn')?.open);
        if (!sumOpen) await pg.click('.dn-sum');
        await pg.fill('.dn-text', '換牌想法：第三張超級球');
        await pg.waitForTimeout(400);
        const saved = await pg.evaluate(() => { try { return JSON.stringify(Object.keys(localStorage).map((k) => localStorage.getItem(k)).filter((v) => v && v.includes('換牌想法'))).length > 2; } catch { return false; } });
        await ctx.close();
        const tag = mobile ? '手機 390' : '1440';
        ok(`★★[E1] ${tag}：預組的備註欄唯讀`, presetRO === true, String(presetRO));
        ok(`★★★[E2] ${tag}：自己的牌組「複製一份」⇒ 新牌組名稱加（複製）、張數相同`, /（複製）（複製）$/.test(name2) && name1 !== name2 && count1 === count2 && /60/.test(count2), JSON.stringify({ name1, name2, count1, count2 }));
        ok(`★★★[E3] ${tag}：備註打字後存進本機`, saved);
      }
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
