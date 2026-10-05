#!/usr/bin/env node
/**
 * v6.479 守衛：首頁網頁版（≥1024px）右欄「錦標賽動態」小卡＋伺服器 v1.55 免登入摘要端點。
 *   【V】伺服器端點 GET /api/home/tourn-summary：
 *       ・放在錦標賽區塊（TAIL_ANCHOR＝第一個 app.get('/api/tournament）之前 ⇒ 28 把鎖不動；
 *       ・資料只取 getEventShared()（共用 3 秒快取），逐欄挑選，**絕不回** proposerUid／proposerName／uid；
 *       ・把 handler 抽出來接假資料實跑：draft／finished 濾掉、欄位白名單、帶哨兵 homeTournApi:1、失敗回 500。
 *   【L】前端 $lib/home-tourn：形狀不對一律 null（＝不顯示）、排序（進行中 → 簽到 → 公布 → 報名）、文字、HTML 回應不解析。
 *   【E】真瀏覽器：1440 有資料 ⇒ 卡片出現；端點 404（舊伺服器／測試站）⇒ 不顯示、無例外；手機 390 ⇒ 一發都不抓、DOM 沒有卡。
 * HEAD-FAIL：同一份靜態判準餵 v6.478 必須紅。
 * Run: node scripts/test-v6479-home-tourn-card.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.478。
const BASE_SHA = '2ea0b766';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const TAIL_ANCHOR = "app.get('/api/tournament";
const blockOf = (src) => (src.match(/    \/\/ >>> v155-home-tourn-summary\n[\s\S]*?    \/\/ <<< v155-home-tourn-summary\n/) || [''])[0];
function judge(get) {
  const r = {};
  const S = get('oracle-admin/server_admin_patch.js');
  const b = blockOf(S);
  r.V1 = !!b && S.indexOf(b) < S.indexOf(TAIL_ANCHOR) && !b.includes(TAIL_ANCHOR) && b.includes("app.get('/api/home/tourn-summary'");
  r.V2 = !!b && /await getEventShared\(\)/.test(b) && !/proposer|uid|deckEntries|\.\.\._e/.test(b.replace(/\/\/.*$/gm, ''));
  const P = get('src/routes/+page.svelte');
  r.F1 = /from '\$lib\/home-tourn'/.test(P) && /matchMedia\('\(min-width: 1024px\)'\)\.matches\) \{\n\s*_tournTimer = setTimeout/.test(P) && /class="hm-evt"/.test(P) && /main\.hm-has-evt \{/.test(P);
  r.F2 = /\.hm-evt \{ display: none; \}/.test(P);
  return r;
}
console.log('【S】靜態');
const C = judge(rd);
ok('★★★[V1] 伺服器端點在錦標賽區塊之前、路徑不帶錦標賽前綴（28 把鎖不動）', C.V1);
ok('★★★[V2] 端點只讀 getEventShared()，不碰 proposer／uid／牌組欄位、不整份展開文件', C.V2);
ok('★★★[F1] 首頁：只在網頁版、首屏後（setTimeout）才抓；有卡時 main 換版面', C.F1);
ok('★★[F2] 手機一律不顯示卡片（基底 display:none）', C.F2);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.478 全紅', !B.V1 && !B.V2 && !B.F1 && !B.F2, JSON.stringify(B));
} else shallowSkip('v6479 S0：HEAD-FAIL', '需要 BASE commit');

console.log('\n【V】伺服器 handler 實跑（抽出哨兵區塊、接假資料）');
{
  const b = blockOf(rd('oracle-admin/server_admin_patch.js'));
  const run = async (shared) => {
    let handler = null;
    const app = { get: (p, h) => { if (p === '/api/home/tourn-summary') handler = h; } };
    const getEventShared = async () => { if (shared instanceof Error) throw shared; return shared; };
    new Function('app', 'getEventShared', b)(app, getEventShared);
    const out = { status: 200, body: null, headers: {} };
    const res = { set: (k, v) => { out.headers[k] = v; return res; }, status: (c) => { out.status = c; return res; }, json: (j) => { out.body = j; return res; } };
    await handler({ query: {}, headers: {} }, res);
    return out;
  };
  const shared = {
    openList: [
      { _id: 'e1', name: '網站賽-1', status: 'registration', maxPlayers: 32, registrationCloseAt: 123, currentRound: 0, proposerUid: 'SECRET_UID', proposerName: '某玩家', createdByPlayer: false, deckEntries: [1] },
      { _id: 'e2', name: '草稿', status: 'draft' },
      { _id: 'e3', name: '社群賽', status: 'running', currentRound: 2, createdByPlayer: true, proposerUid: 'U2', proposerName: '提案人' },
    ],
    regCounts: { e1: 7, e3: 4 }, runningEvents: [],
  };
  const o = await run(shared);
  const txt = JSON.stringify(o.body);
  ok('★★★[V3] 回哨兵 homeTournApi:1、濾掉 draft、人數取共用快取', o.status === 200 && o.body?.homeTournApi === 1 && o.body.events.length === 2 && o.body.events[0].regCount === 7 && o.body.events[1].community === true, txt);
  ok('★★★[V4] 欄位白名單：回應裡沒有 uid／提案人／牌組／_id', !/SECRET_UID|U2|某玩家|提案人|deckEntries|"_id"/.test(txt) && Object.keys(o.body.events[0]).sort().join() === 'community,currentRound,maxPlayers,name,regCount,registrationCloseAt,status', txt);
  ok('★★[V5] 不給快取（no-store）', o.headers['Cache-Control'] === 'no-store');
  const e = await run(new Error('db down'));
  ok('★★[V6] 讀取失敗 ⇒ 500，不洩漏錯誤訊息', e.status === 500 && !JSON.stringify(e.body).includes('db down'), JSON.stringify(e.body));
}

console.log('\n【L】前端純函式');
{
  const { build } = await import('esbuild');
  const out = await build({ entryPoints: [join(ROOT, 'src/lib/home-tourn.ts')], bundle: true, format: 'esm', write: false, platform: 'neutral' });
  const m = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
  ok('★★★[L1] 形狀不對一律 null（沒有哨兵／events 不是陣列／null／字串）', [null, 'x', {}, { events: [] }, { homeTournApi: 2, events: [] }, { homeTournApi: 1, events: {} }].every((x) => m.parseHomeTournSummary(x) === null));
  const P = m.parseHomeTournSummary({ homeTournApi: 1, events: [
    { name: 'A', status: 'registration', regCount: 3, maxPlayers: 8 },
    { name: 'B', status: 'running', regCount: 16, maxPlayers: 16, currentRound: 2 },
    { name: 'C', status: 'draft' }, { name: '', status: 'running' },
    { name: 'D', status: 'checkin', regCount: 5 }, { name: 'E', status: 'registration', regCount: 1 },
  ] });
  ok('★★★[L2] 濾掉 draft／無名稱；排序 進行中→簽到→報名（同階維持順序）；最多 3 場', P && P.map((e) => e.name).join() === 'B,D,A', JSON.stringify(P));
  ok('★★[L3] 文字：「進行中・第 2 輪」「3 / 8 人」「5 人」', m.homeTournStatusLabel(P[0]) === '進行中・第 2 輪' && m.homeTournCountLabel(P[2]) === '3 / 8 人' && m.homeTournCountLabel(P[1]) === '5 人');
  ok('★★[L4] 台灣時間 HH:MM 固定 UTC+8', m.formatHmTW(Date.UTC(2026, 9, 5, 13, 5)) === '21:05' && m.formatHmTW(0) === '');
  const mk = (status, ct, body) => async () => ({ ok: status === 200, status, headers: { get: () => ct }, json: async () => body });
  ok('★★★[L5] 測試站／舊伺服器回 HTML 或 404 ⇒ null；fetch 丟例外 ⇒ null',
    (await m.fetchHomeTournSummary(mk(200, 'text/html', null))) === null && (await m.fetchHomeTournSummary(mk(404, 'application/json', {}))) === null
    && (await m.fetchHomeTournSummary(async () => { throw new Error('net'); })) === null);
  ok('★★[L6] 正對照：正常 JSON 回應解析得出來', (await m.fetchHomeTournSummary(mk(200, 'application/json; charset=utf-8', { homeTournApi: 1, events: [{ name: 'X', status: 'running' }] })))?.length === 1);
  const hang = await m.fetchHomeTournSummary((u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('abort')))), 50);
  ok('★★[L7] 逾時會中斷並回 null（不會永遠掛著）', hang === null);
}

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.479') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.479');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) { res.writeHead(404, { 'content-type': 'text/html' }); createReadStream(join(BUILD, '404.html')).pipe(res); return; }
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    const BODY = JSON.stringify({ homeTournApi: 1, serverNow: Date.now(), events: [{ name: '網站賽-1【21:00 瑞士制】', status: 'registration', regCount: 9, maxPlayers: 32, registrationCloseAt: Date.now() + 3600e3 }, { name: '網站賽-0', status: 'running', regCount: 16, maxPlayers: 16, currentRound: 2 }] });
    const open = async (w, h, { mobile = false, mock = true } = {}) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const hits = [];
      if (mock) await ctx.route(/\/api\/home\/tourn-summary/, (r) => { hits.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: BODY }); });
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      pg.on('request', (q) => { if (!mock && q.url().includes('/api/home/')) hits.push(q.url()); });
      await pg.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await pg.waitForTimeout(1800);
      return { ctx, pg, hits };
    };
    try {
      let { ctx, pg, hits } = await open(1440, 900);
      const D = await pg.evaluate(() => ({ items: [...document.querySelectorAll('.hm-evt-item')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()), main: document.querySelector('main')?.className.includes('hm-has-evt'), area: getComputedStyle(document.querySelector('.hm-evt') || document.body).gridArea }));
      await ctx.close();
      ok('★★★[E1] 1440：抓一次、卡片出現（進行中排前面）、main 換版面', hits.length === 1 && D.items.length === 2 && D.items[0].includes('進行中・第 2 輪') && D.items[1].includes('9 / 32 人') && D.main && /evt/.test(D.area), JSON.stringify({ hits: hits.length, ...D }));
      ({ ctx, pg, hits } = await open(1440, 900, { mock: false }));
      const N = await pg.evaluate(() => ({ evt: !!document.querySelector('.hm-evt'), main: document.querySelector('main')?.className.includes('hm-has-evt') }));
      await ctx.close();
      ok('★★★[E2] 端點不存在（回 404 HTML，＝舊伺服器／測試站）：有試抓、卡片不出現、版面不變', hits.length === 1 && !N.evt && !N.main, JSON.stringify({ hits: hits.length, ...N }));
      ({ ctx, pg, hits } = await open(390, 844, { mobile: true }));
      const M = await pg.evaluate(() => !!document.querySelector('.hm-evt'));
      await ctx.close();
      ok('★★★[E3] 手機 390：一發都不抓、DOM 沒有卡片', hits.length === 0 && !M, JSON.stringify({ hits: hits.length, M }));
      ok('[E9] 以上頁面沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
