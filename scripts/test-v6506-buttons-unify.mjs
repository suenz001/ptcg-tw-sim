#!/usr/bin/env node
/**
 * v6.506 守衛：全站版面統一 第 3 步——主要／次要按鈕、提示框、輸入框統一成綠色主色與 --ui-* 色票（站長 2026-10-07）。
 * 【S】牌組編輯器／公布欄／卡牌資料庫的 v6504-unify 區塊、LobbyUnify 有對應規則，顏色只讀 --ui-*
 * 【E】390／1440、淺色／深色：牌組編輯器「存檔／讀取」、錦標賽「登入」是 --ui-accent 底；「註冊新帳號」是 --ui-bg-elev 底＋--ui-border 框；
 *      錦標賽輸入框是 --ui-input-bg；公布欄提示框是 --ui-accent-soft；「⬜ 本機」標籤是 --ui-bg-sunken
 * HEAD-FAIL：靜態判準餵 v6.505 必須紅。
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { uiColor } from './lib/ui-palette.mjs';   // ⭐v6.511 色票唯一讀取點（不寫死色碼）
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.505。
const BASE_SHA = 'c3bfb348';
const rd = (r) => { try { return readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const blk = (s) => (s.match(/\/\* >>> v6504-unify \*\/[\s\S]*?\/\* <<< v6504-unify \*\//) || [''])[0];
function judge(get) {
  const D = blk(get('src/routes/decks/+page.svelte')), P = blk(get('src/routes/deck-posts/+page.svelte')), C = blk(get('src/routes/cards/+page.svelte'));
  const L = get('src/lib/LobbyUnify.svelte');
  return {
    S1: D.includes(':global(html) .cloud-btn { background: var(--ui-accent) !important;') && D.includes(':global(html) button.small.primary { background: var(--ui-accent);') && D.includes(':global(html) .sync-idle {'),
    S2: P.includes(':global(html) button.primary, :global(html) .modal-foot button.primary { background: var(--ui-accent);') && P.includes(':global(html) .notice { background: var(--ui-accent-soft);'),
    S3: C.includes(':global(html) .cardPageLink { color: var(--ui-link); }'),
    S4: L.includes('.btn-primary.btn-primary.btn-primary) { background: var(--ui-accent);') && L.includes('.btn-secondary.btn-secondary.btn-secondary) { background: var(--ui-bg-elev);') && L.includes('.name-input.name-input.name-input),'),
  };
}
console.log('【S】靜態');
const C0 = judge(rd);
ok('★★★[S1] 牌組編輯器：存檔／讀取、primary 小按鈕、本機標籤改讀色票', C0.S1);
ok('★★[S2] 公布欄：primary 按鈕、提示框改讀色票', C0.S2);
ok('★[S3] 卡牌資料庫：單卡頁連結改讀色票', C0.S3);
ok('★★★[S4] 大廳：主要／次要按鈕與輸入框改讀色票', C0.S4);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const B = judge((f) => { const b = readBaseBlob(ROOT, BASE_SHA, f); return b.ok ? b.out.replace(/\r\n/g, '\n') : ''; });
  ok('★★[S0] HEAD-FAIL：v6.505 全紅', !B.S1 && !B.S2 && !B.S3 && !B.S4, JSON.stringify(B));
} else shallowSkip('v6506 S0', '需要 BASE commit');
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.506') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.506');
  if (browser) {
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
    // ⭐v6.511（Rule 40）：色票調整後改讀現行色票（意圖「這些元件讀色票」不變）
    const tok = (t) => ({ accent: uiColor(ROOT, t, '--ui-accent'), elev: uiColor(ROOT, t, '--ui-bg-elev'), border: uiColor(ROOT, t, '--ui-border'), soft: uiColor(ROOT, t, '--ui-accent-soft'), sunken: uiColor(ROOT, t, '--ui-bg-sunken'), input: uiColor(ROOT, t, '--ui-input-bg') });
    const T = { light: tok('light'), dark: tok('dark') };
    const bg = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopColor]; }, sel);
    const btnByText = (pg, txt) => pg.evaluate((t) => { const e = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t); if (!e) return null; const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopColor]; }, txt);
    try {
      for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
        for (const theme of ['light', 'dark']) {
          const X = T[theme];
          const open = async (path) => {
            const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
            await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
            await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
            const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
            await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
            return { ctx, pg };
          };
          const tag = `${w} ${theme}`;
          let { ctx, pg } = await open('/decks');
          const save = await btnByText(pg, '存檔'), load = await btnByText(pg, '讀取'), pill = await bg(pg, '.sync-idle');
          await ctx.close();
          ok(`★★★[E1] ${tag} 牌組編輯器：存檔／讀取是綠色主色`, save?.[0] === X.accent && load?.[0] === X.accent, JSON.stringify({ save, load }));
          ok(`★★[E2] ${tag} 牌組編輯器：「本機」標籤是 --ui-bg-sunken`, pill?.[0] === X.sunken, JSON.stringify(pill));
          ({ ctx, pg } = await open('/tournament'));
          const login = await btnByText(pg, '登入'), reg = await btnByText(pg, '註冊新帳號'), inp = await bg(pg, '.tourn-field .name-input');
          await ctx.close();
          ok(`★★★[E3] ${tag} 錦標賽：登入是綠色主色、註冊是白卡（深色時深卡）＋框線`, login?.[0] === X.accent && reg?.[0] === X.elev && reg?.[1] === X.border, JSON.stringify({ login, reg }));
          ok(`★★[E4] ${tag} 錦標賽：輸入框是 --ui-input-bg＋--ui-border`, inp?.[0] === X.input && inp?.[1] === X.border, JSON.stringify(inp));
          ({ ctx, pg } = await open('/deck-posts'));
          const note = await bg(pg, '.notice');
          await ctx.close();
          ok(`★★[E5] ${tag} 公布欄：提示框是 --ui-accent-soft`, note?.[0] === X.soft, JSON.stringify(note));
        }
      }
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}
console.log(`\n=== v6.506 全站版面統一（第 3 步：按鈕與輸入框）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
