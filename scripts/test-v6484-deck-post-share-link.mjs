#!/usr/bin/env node
/**
 * v6.484 守衛：牌組公布欄每篇投稿有自己的網址（/deck-posts?post=<id>）＋「🔗 複製連結」（站長同意的建議 #2）。
 *   【L】$lib/deck-posts/share-link：讀 post 參數（格式白名單）、設定／移除時保留其他參數、分享網址格式。
 *   【E】真瀏覽器（假 API）：帶 ?post= 進頁直接打開那一篇；開著時網址有 post、關掉就拿掉；
 *        複製連結得到分享網址；不合法的 id 不會發出查詢。
 * HEAD-FAIL：靜態判準餵 v6.483 必須紅。
 * Run: node scripts/test-v6484-deck-post-share-link.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.483。
const BASE_SHA = '0e74051c';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const judge = (get) => {
  const s = get('src/routes/deck-posts/+page.svelte');
  return {
    S1: s.includes("from '$lib/deck-posts/share-link'") && /const sharedId = postIdFromSearch\(location\.search\);\n\s*if \(sharedId\) void openDetail\(sharedId\);/.test(s),
    S2: /urlPostId = id;/.test(s) && /urlPostId = null;/.test(s) && /onclick=\{copyShareLink\}/.test(s),
  };
};
console.log('【S】靜態');
const J = judge(rd);
ok('★★★[S1] 進頁讀 ?post= 直接打開那一篇', J.S1);
ok('★★★[S2] 開／關投稿同步網址；詳情有「複製連結」', J.S2);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.483 全紅', !B.S1 && !B.S2, JSON.stringify(B));
} else shallowSkip('v6484 S0：HEAD-FAIL', '需要 BASE commit');

console.log('\n【L】網址工具');
{
  const { build } = await import('esbuild');
  const o = await build({ entryPoints: [join(ROOT, 'src/lib/deck-posts/share-link.ts')], bundle: true, format: 'esm', write: false, platform: 'neutral' });
  const L = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
  ok('★★★[L1] 讀 post：合法回 id、不合法（路徑、空白、太長）回 null', L.postIdFromSearch('?post=abc_12-X') === 'abc_12-X' && L.postIdFromSearch('?post=../x') === null && L.postIdFromSearch('?post=a%20b') === null && L.postIdFromSearch('?post=' + 'a'.repeat(65)) === null && L.postIdFromSearch('') === null);
  ok('★★★[L2] 設定／移除 post 保留其他參數；全部拿掉時回空字串', L.withPostParam('?tab=hot', 'p1') === '?tab=hot&post=p1' && L.withPostParam('?tab=hot&post=p1', null) === '?tab=hot' && L.withPostParam('?post=p1', null) === '' && L.withPostParam('', '../bad') === '');
  ok('★★[L3] 分享網址格式', L.postShareUrl('https://www.ptcg-tw-sim.com', 'p 1') === 'https://www.ptcg-tw-sim.com/deck-posts?post=p%201');
}

console.log('\n【E】真瀏覽器（build/，假 API）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.484') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.484');
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
    const POST = { id: 'abc123', authorName: '測試玩家', deckName: '守衛測試牌組', notes: '', archetype: '', cardTotal: 60, likeCount: 0, downloadCount: 0, commentCount: 0, createdAt: Date.now(), tournament: null, entries: [{ cardId: '18367', count: 4 }] };
    const open = async (path, detailHits) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      await ctx.route(/\/api\/deck-posts/, (r) => {
        const u = new URL(r.request().url());
        const json = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (u.pathname === '/api/deck-posts-comments') return json({ comments: [], hasMore: false, total: 0 });
        if (u.pathname.startsWith('/api/deck-posts-')) return json({});
        if (u.pathname === '/api/deck-posts') return json({ posts: [], total: 0 });
        detailHits.push(u.pathname);
        return json({ post: POST });
      });
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(2500);
      return { ctx, pg };
    };
    try {
      const hits = [];
      let { ctx, pg } = await open('/deck-posts?post=abc123', hits);
      const A = await pg.evaluate(() => ({ text: document.body.innerText.includes('守衛測試牌組'), q: location.search }));
      await pg.locator('button.share-btn').click(); await pg.waitForTimeout(300);
      const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      await pg.locator('.modal-foot button', { hasText: '關閉' }).click(); await pg.waitForTimeout(500);
      const afterClose = await pg.evaluate(() => location.search);
      await ctx.close();
      ok('★★★[E1] 帶 ?post= 進頁 ⇒ 直接打開那一篇、網址保留 post', hits.includes('/api/deck-posts/abc123') && A.text && A.q === '?post=abc123', JSON.stringify({ hits, A }));
      ok('★★★[E2] 「複製連結」得到這篇的分享網址', clip === `http://localhost:${port}/deck-posts?post=abc123`, clip);
      ok('★★★[E3] 關掉視窗 ⇒ 網址的 post 拿掉', afterClose === '', afterClose);
      const hits2 = [];
      ({ ctx, pg } = await open('/deck-posts?post=../evil', hits2));
      await ctx.close();
      ok('★★[E4] 不合法的 id 不發查詢', hits2.length === 0, JSON.stringify(hits2));
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
