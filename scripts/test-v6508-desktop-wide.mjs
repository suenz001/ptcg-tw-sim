#!/usr/bin/env node
/**
 * v6.508 守衛：網頁版（≥1024px）善用版面（站長 2026-10-07：「對戰演練（包含線上連線對戰）、錦標賽的 windows 網頁版，
 *   仍然沒有有效利用版面，仍然是手機版的風格，請你再一併檢視一下網站的內容，看看能不能不要浪費 windows 網頁版的」；看過預覽圖後回「可以」）。
 *
 * 【S】靜態：LobbyUnify 的寬版規則每條都帶 html:not([data-battle-view])[data-ui-wide]（手機／牌桌不受影響）、顏色只讀色票；
 *      好友頁網頁版放寬到 1200px；好友名單網頁版多欄
 * 【E】真瀏覽器（build/）：1440 寬：大廳 1200px、模式卡片加高、線上大廳左右兩欄、錦標賽聊天室在右側欄（賽事卡片在左、不重疊）、
 *      排行四欄一列、個人參賽紀錄兩欄；390 手機與 data-battle-view（牌桌）時以上全部不成立
 *      （錦標賽的聊天室／榜單需要登入才看得到 ⇒ 在真頁面的錦標賽大廳裡放入同類別的元素量測，規則本身是全域樣式；
 *       榜單的 display:grid 是對戰頁的範圍樣式（放進去的元素吃不到）⇒ fixture 用行內 display:grid 補上，欄數完全由本版規則決定）
 * 【H】HEAD-FAIL：靜態判準餵 v6.507 全紅
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：admin v1.79（玩家端＝v6.507）。
const BASE_SHA = 'e648de89';
const rd = (r) => { try { return readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const W = 'html:not([data-battle-view])[data-ui-wide]';
function judge(get) {
  const r = {};
  const L = get('src/lib/LobbyUnify.svelte');
  const css = (L.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1].replace(/\/\*[\s\S]*?\*/g, '');
  const wide = [...css.matchAll(/:global\(([^{}]*?)\)\s*\{/g)].map((m) => m[1]).filter((s) => s.includes('[data-ui-wide]') && !s.includes(':not([data-ui-wide])'));   // 手機專用（:not([data-ui-wide])）的是 v6.505 的規則，不在本版範圍
  const has = (sel) => wide.some((s) => s.startsWith(W) && s.includes(sel));
  r.S1 = wide.length >= 18 && wide.every((s) => s.startsWith(W))
    && has('main.lobby.lobby') && has('.mode-card') && has('.player-setup') && has('.online-form.lobby-unified')
    && has('.open-room-list') && has('.battle-seats') && has('.tourn-lobby > .tourn-chat') && has('.tourn-lb-grid') && has('.tourn-pf-events')
    && /main\.lobby\.lobby\) \{ max-width: 1200px; \}/.test(css);
  r.S2 = !/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(css);
  r.S3 = get('src/routes/friends/+page.svelte').includes(':global(html[data-ui-wide]) main { max-width: 1200px; }')
    && get('src/lib/friends/FriendsPanel.svelte').includes(':global(html[data-ui-wide]) .rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); }');
  return r;
}
console.log('【S】靜態');
const C = judge(rd);
ok('★★★[S1] 寬版規則每條都只在網頁版（data-ui-wide）＋非牌桌生效，涵蓋大廳寬度／模式卡片／本機／線上大廳／房間清單／等待室／錦標賽聊天室／排行／個人', C.S1);
ok('★★[S2] 顏色只讀色票（沒有寫死色碼）', C.S2);
ok('★★[S3] 好友頁網頁版 1200px、好友名單網頁版多欄', C.S3);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const B = judge((f) => { const b = readBaseBlob(ROOT, BASE_SHA, f); return b.ok ? b.out.replace(/\r\n/g, '\n') : ''; });
  ok('★★[S0] HEAD-FAIL：S1、S3 在 v6.507 全紅', !B.S1 && !B.S3, JSON.stringify(B));
} else shallowSkip('v6508 S0', '需要 BASE commit');

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.508') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.508');
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
    const open = async (w, h, mobile, path) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}${path}`, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
      return { ctx, pg };
    };
    // 錦標賽：在真頁面的錦標賽大廳裡放入與登入後同類別的元素（聊天室＋賽事卡片＋榜單＋參賽紀錄），量版面
    const tournProbe = (pg) => pg.evaluate(() => {
      const main = document.querySelector('main.tourn-lobby');
      if (!main) return null;
      const mk = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; };
      main.append(mk('<div class="tourn-chat" id="x-chat"><div class="tourn-chat-msgs" id="x-msgs">聊天</div></div>'));
      main.append(mk('<div class="tourn-event" id="x-ev" style="border:1px solid #888">賽事卡片</div>'));
      main.append(mk('<div class="tourn-lb-grid" id="x-lb" style="display:grid"><div>1</div><div>2</div><div>3</div><div>4</div></div>'));
      main.append(mk('<div class="tourn-pf-events" id="x-pf"><div class="tourn-lb-title">紀錄</div><div class="tourn-pf-evrow">a</div><div class="tourn-pf-evrow">b</div></div>'));
      const R = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      const lb = [...document.getElementById('x-lb').children].map((c) => Math.round(c.getBoundingClientRect().top));
      const pf = [...document.getElementById('x-pf').querySelectorAll('.tourn-pf-evrow')].map((c) => Math.round(c.getBoundingClientRect().top));
      return { main: Math.round(main.getBoundingClientRect().width), chat: R('x-chat'), ev: R('x-ev'), msgs: R('x-msgs'), lbRows: new Set(lb).size, pfSameRow: pf[0] === pf[1] };
    });
    try {
      // ── 1440 網頁版 ──
      {
        const { ctx, pg } = await open(1440, 900, false, '/game');
        const m = await pg.evaluate(() => {
          const main = document.querySelector('main.lobby'), mc = document.querySelector('.mode-card');
          return { main: Math.round(main.getBoundingClientRect().width), card: Math.round(mc.getBoundingClientRect().height) };
        });
        ok('★★★[E1] 1440：對戰大廳寬 1200px（含內距 1248）、模式卡片至少 200px 高', m.main >= 1200 && m.card >= 200, JSON.stringify(m));
        await pg.click('.mode-card >> nth=1'); await pg.waitForTimeout(1200);
        const o = await pg.evaluate(() => {
          const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top) }; };
          return { name: R('.online-form .name-row'), create: R('.online-form .create-room-block'), rooms: R('.online-form .open-rooms-section'), list: document.querySelector('.online-form .open-room-list') ? getComputedStyle(document.querySelector('.online-form .open-room-list')).display : null };
        });
        ok('★★★[E2] 1440：線上大廳左欄（玩家名稱、建立房間）、右欄（房間清單）並排', !!o.name && !!o.rooms && o.rooms.l >= o.name.r && Math.abs(o.rooms.t - o.name.t) <= 2 && o.create.l === o.name.l, JSON.stringify(o));
        await ctx.close();
      }
      {
        const { ctx, pg } = await open(1440, 900, false, '/tournament');
        const t = await tournProbe(pg);
        ok('★★★[E3] 1440：錦標賽聊天室在右側欄（360px、加高），賽事卡片在左側不重疊', !!t && t.main >= 1200 && t.chat.w === 360 && t.chat.l > t.ev.r && Math.abs(t.chat.t - t.ev.t) <= 2 && t.msgs.h >= 400, JSON.stringify(t));
        ok('★★[E4] 1440：排行四個榜單一列、個人參賽紀錄兩欄', !!t && t.lbRows === 1 && t.pfSameRow, JSON.stringify(t && { lb: t.lbRows, pf: t.pfSameRow }));
        await pg.evaluate(() => document.documentElement.setAttribute('data-battle-view', '')); await pg.waitForTimeout(100);
        const b = await pg.evaluate(() => getComputedStyle(document.getElementById('x-chat')).cssFloat);
        ok('★★[E5] 掛上 data-battle-view（牌桌）⇒ 寬版規則不成立', b === 'none', b);
        await ctx.close();
      }
      {
        const { ctx, pg } = await open(1440, 900, false, '/friends');
        const w = await pg.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().width));
        ok('★★[E6] 1440：好友頁寬 1200px（原本 760）', w >= 1200, String(w));
        await ctx.close();
      }
      // ── 390 手機：一個都不成立 ──
      {
        const { ctx, pg } = await open(390, 844, true, '/tournament');
        const t = await tournProbe(pg);
        const f = await pg.evaluate(() => getComputedStyle(document.getElementById('x-chat')).cssFloat);
        ok('★★★[E7] 390 手機：聊天室不浮動、與賽事卡片同寬（手機版面不變）', !!t && f === 'none' && t.chat.w === t.ev.w, JSON.stringify({ f, chat: t && t.chat, ev: t && t.ev }));
        await ctx.close();
      }
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.508 網頁版善用版面：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
