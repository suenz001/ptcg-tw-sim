#!/usr/bin/env node
/**
 * v6.512 守衛：全站文字對比（站長 2026-10-08：「暗色系，在卡圖放大又看不到字了，請你研究好配色好嗎」）。
 *
 * 根因：卡牌資料庫的卡片視窗，招式／特性說明 .skillEffect 寫死 #333，主題規則只改了 .rules ⇒ 深色主題深字配深底（1.09:1）。
 * 本版不再一處一處補，而是用 scripts/lib/contrast-scan.mjs 在真瀏覽器裡掃「每個有文字的元素：字色對實際背景（半透明逐層疊合）」，
 * 兩種主題 × 手機／網頁版 × 多個頁面與視窗，全部 ≥ 4.5（WCAG AA）。
 *
 * 【U】屬性色塊字色：ENERGY_TEXT_COLOR 每一種屬性的字色對色塊 ≥ 4.5，而且是白字／深字中對比較高的那個
 * 【S】靜態：卡片視窗說明文字兩個主題規則都讀 --ui-text；大廳淺色產生器有「字色對最暗淺底 ≥ 4.6」的保證；--ui-danger／--ui-warn 兩個主題都有
 * 【E】真瀏覽器（build/）：掃描結果除了白名單（LINE 官方品牌按鈕）以外沒有 < 4.5 的文字；掃描器有掃到東西（下限）、正對照（植入一個灰字必被抓到）
 * 【H】HEAD-FAIL：S1 餵 v6.511 必紅
 */
import { readFileSync, existsSync, createReadStream, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { scanContrastInPage } from './lib/contrast-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.511。
const BASE_SHA = '550c44b3';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const rd = (p) => { try { return readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
const relLum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

console.log('【U】屬性色塊字色');
{
  const S = join(ROOT, '.v6512-e.ts'), O = join(ROOT, '.v6512-o.mjs');
  let M = null;
  try {
    writeFileSync(S, "export { ENERGY_COLOR, ENERGY_TEXT_COLOR, readableTextOn, ENERGY_TEXT_DARK } from './src/lib/cards/energy';");
    await build({ entryPoints: [S], outfile: O, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    M = await import(pathToFileURL(O).href);
  } catch (e) { console.log('  （打包失敗：' + String(e.message).split('\n')[0].slice(0, 100) + '）'); }
  finally { for (const p of [S, O]) { try { rmSync(p); } catch { /* */ } } }
  // Rule 41：舊版沒有 ENERGY_TEXT_COLOR ⇒ 各條自己翻紅，不整支 throw
  const types = M && M.ENERGY_TEXT_COLOR ? Object.keys(M.ENERGY_COLOR) : [];
  const bad = types.filter((t) => !(contrast(M.ENERGY_TEXT_COLOR[t], M.ENERGY_COLOR[t]) >= 4.5));
  ok('★★★[U1] 11 種屬性色塊上的字色對比都 ≥ 4.5', types.length === 11 && bad.length === 0, bad.join(','));
  const notBest = types.filter((t) => contrast(M.ENERGY_TEXT_COLOR[t], M.ENERGY_COLOR[t]) + 1e-9 < Math.max(contrast('#ffffff', M.ENERGY_COLOR[t]), contrast(M.ENERGY_TEXT_DARK, M.ENERGY_COLOR[t])));
  ok('★★[U2] 每種都挑白字／深字中對比較高的那個（雷、無用深字；惡用白字）', types.length === 11 && notBest.length === 0 && M.ENERGY_TEXT_COLOR.Lightning !== '#ffffff' && M.ENERGY_TEXT_COLOR.Colorless !== '#ffffff' && M.ENERGY_TEXT_COLOR.Darkness === '#ffffff', notBest.join(','));
}

function judge(get) {
  const C = get('src/routes/cards/+page.svelte'), G = get('scripts/gen-lobby-light.py'), L = get('src/routes/+layout.svelte');
  return {
    S1: C.includes('    .rules, .skillEffect { color: var(--ui-text); }') && C.includes(':global(html:not([data-ui-wide])) .skillEffect { color: var(--ui-text); }'),
    S2: /_cr\(\(nr,ng,nb\),\(0xd2\/255,0xd9\/255,0xd5\/255\)\)<4\.6/.test(G),
    S3: (L.match(/--ui-danger: #[0-9a-f]{6};/g) || []).length === 2 && (L.match(/--ui-warn: #[0-9a-f]{6};/g) || []).length === 2,
  };
}
console.log('\n【S】靜態');
const CUR = judge(rd);
ok('★★★[S1] 卡片視窗的招式／特性說明，網頁版與手機的主題規則都讀 --ui-text', CUR.S1);
ok('★★[S2] 大廳淺色產生器：字色對最暗淺底（#d2d9d5）不足 4.6 就保持色相調暗', CUR.S2);
ok('★★[S3] --ui-danger／--ui-warn 兩個主題都有定義', CUR.S3);
console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const B = judge((p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; });
  ok('★★[H1] v6.511：S1、S2、S3 全紅', !B.S1 && !B.S2 && !B.S3, JSON.stringify(B));
} else shallowSkip('v6512 H', '需要 v6.511 commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.512') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.512');
  if (browser) {
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) { const h = p.replace(/\/$/, '') + '.html'; p = existsSync(h) ? h : join(BUILD, '404.html'); }
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream', 'cache-control': 'no-store' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    // 白名單：LINE 群組按鈕用 LINE 官方品牌綠（#06C755）配白字，是品牌規範的外觀，刻意不改
    const ALLOW = (b) => b.sel === 'span.line-icon' || (b.sel === 'span' && /LINE|演練群組/.test(b.text));
    const SCEN = [
      ['卡片放大視窗', '/cards?set=SV5a', async (pg) => { await pg.click('.cardBtn >> nth=39'); await pg.waitForTimeout(600); }],
      ['卡包篩選', '/cards?set=SV5a', null],
      ['牌組編輯器', '/decks', async (pg) => { await pg.evaluate(() => { const d = document.querySelector('details.preset-section'); if (d) d.open = true; }); }],
      ['單卡頁', '/card/10052', null],
      ['錦標賽', '/tournament', null],
    ];
    const found = []; let scanned = 0; const errs = [];
    try {
      for (const theme of ['dark', 'light']) for (const [vw, vh] of [[390, 844], [1440, 900]]) for (const [name, url, act] of SCEN) {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, serviceWorkers: 'block', colorScheme: theme, isMobile: vw < 500, hasTouch: vw < 500 });
        await ctx.route(/googleapis|firebase|gstatic|youtube|ytimg/, (r) => r.abort());
        await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
        const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
        try {
          await pg.goto(`http://localhost:${port}${url}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
          if (act) await act(pg);
          scanned += await pg.evaluate(() => document.querySelectorAll('body *').length);
          for (const b of await pg.evaluate(scanContrastInPage, 4.5)) if (!ALLOW(b)) found.push(`${theme}/${vw}/${name}：${b.sel}「${b.text}」${b.cr}`);
          if (theme === 'dark' && vw === 1440 && name === '卡片放大視窗') {
            // 正對照：植入一個深底灰字，掃描器必須抓到（證明掃描器真的會判紅）
            const hit = await pg.evaluate((fn) => { const d = document.createElement('p'); d.textContent = '正對照灰字'; d.style.cssText = 'color:#555;background:#253b27;position:fixed;top:0;left:0;padding:8px;z-index:99999'; document.body.appendChild(d);
              const r = (0, eval)('(' + fn + ')')(4.5).some((x) => x.text === '正對照灰字'); d.remove(); return r; }, scanContrastInPage.toString());
            ok('★★[E0] 正對照：植入深底灰字，掃描器抓得到', hit);
          }
        } catch (e) { found.push(`${theme}/${vw}/${name}：載入失敗 ${e.message.split('\n')[0]}`); }
        await ctx.close();
      }
      ok('[E1] 掃描器有掃到東西（20 個畫面合計元素 > 5000）', scanned > 5000, String(scanned));
      ok('★★★[E2] 兩種主題 × 手機／網頁版 × 卡片視窗、篩選、牌組編輯器、單卡頁、錦標賽：所有文字對比 ≥ 4.5', found.length === 0, found.slice(0, 8).join(' ｜ '));
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.512 全站文字對比：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
