#!/usr/bin/env node
/**
 * v6.467 守衛：全站 audit（2026-10-03）第一批 —— 網路／系統面，全部都是「不會讓任何情境變慢」的改動
 *
 *   ① 離開 /tournament、/game 之後殘留的計時器（真 bug）：大廳／倒數／跨房提醒四支 setInterval 建在 $effect 裡、
 *      只在 else 分支清 —— 元件卸載時 else 永遠不會跑 ⇒ 背景持續打 /event、/chat、/bracket，殭屍看門狗還會把對戰輪詢復活；
 *      每進出一次多疊一份。onDestroy 統一清掉＋startTournamentPoll 卸載後不再啟動＋通知導頁監聽可移除。
 *   ② SW 不在 install 預快取爬蟲專用檔（og-image、sitemap、robots、Google 驗證頁）；刪掉沒有任何程式載入的 ready-go.wav（310KB）。
 *   ③ preconnect：卡圖縮圖站（不帶 crossorigin，圖片是 no-cors）、securetoken（登入過期換 token）。
 *   ④ 休閒大廳房間列表／房內聊天：分頁隱藏時降頻（10 秒／5 秒），回到前景立刻補抓；前景節奏不變。
 *   ⑤ loadIndex 同時呼叫只抓一次（牌組頁冷進站原本抓兩次 index.json）。
 *   ⑥ /cards?set=ALL：卡牌政策與 index.json 同時開始載入（原本排在 index 之後）。
 *
 * 判準（每一條都餵 BASE＝v6.466 看會不會紅；標 HEAD-FAIL 的必須紅）＋ 真瀏覽器 E（需要 build/）。
 * Run: node scripts/test-v6467-site-audit-net.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：server patch v1.53（＝v6.466 的玩家端）。
const BASE_SHA = '926729af';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const esbuild = await import('esbuild');
const ts2js = (code) => esbuild.transformSync(code, { loader: 'ts' }).code;

/** 抽出 `export function NAME(` 起、到第一個「行首 }」為止的整支函式 */
function extractFn(src, name) {
  const i = src.indexOf('export function ' + name + '(');
  if (i < 0) return null;
  const j = src.indexOf('\n}', i);
  return src.slice(i, j + 2).replace(/^export /, '');
}
const FILES = {
  game: 'src/routes/game/+page.svelte', notify: 'src/lib/notify.ts', sw: 'src/service-worker.ts', app: 'src/app.html',
  room: 'src/lib/game/room-oracle.ts', pool: 'src/lib/cards/pool.ts', cards: 'src/routes/cards/+page.ts',
};
function load(getter) { const o = {}; for (const [k, p] of Object.entries(FILES)) { try { o[k] = getter(p); } catch { o[k] = ''; } } return o; }
const CUR = load(rd);

// ══════════════════════════════════════════════════════════════════════════
// 判準（src 集合 → boolean）；headFail=true 的在 BASE 上必須不成立
// ══════════════════════════════════════════════════════════════════════════
function onDestroyBlocks(game) {
  return [...game.matchAll(/onDestroy\(\(\) => \{([\s\S]*?)\n  \}\);/g)].map((m) => m[1]);
}
const CHECKS = [
  ['★★★[①] onDestroy 清掉大廳／倒數／跨房提醒四支 setInterval（還有兩支回房倒數與取獎計時器）', true, (S) => {
    const d = onDestroyBlocks(S.game).join('\n');
    return ['tEventPollTimer', 'tTickTimer', 'tAlertPollTimer', 'tAlertTickTimer', 'restartCountdownTimer', 'returnRoomCountdownTimer'].every((t) => new RegExp('\\b' + t + '\\b').test(d))
      && /clearInterval\(_t\)/.test(d) && /clearInterval\(takePrizeTimerId\)/.test(d) && /_gameDestroyed = true/.test(d);
  }],
  ['★★★[①b] startTournamentPoll 卸載後一律不啟動（殭屍看門狗、在途 tForceResync 不能把對戰輪詢復活）', true, (S) => {
    const i = S.game.indexOf('function startTournamentPoll() {');
    return i > 0 && /^\s*if \(_gameDestroyed\) return;/.test(S.game.slice(i + 'function startTournamentPoll() {'.length, i + 400).split('\n')[1] || '');
  }],
  ['★★[①c] 通知導頁監聽可移除，而且對戰頁卸載時真的移除', true, (S) => {
    const fn = extractFn(S.notify, 'initNotifyNav') || '';
    return /\): \(\) => void \{/.test(fn) && /removeEventListener\('message', handler\)/.test(fn)
      && /_unsubNotifyNav = initNotifyNav\(/.test(S.game) && /_unsubNotifyNav\?\.\(\)/.test(onDestroyBlocks(S.game).join('\n'));
  }],
  ['★★[①d] 刻意沒有把清除寫進那些 $effect 的 return（effect 重跑會先清再「首抓 5 支」⇒ 反而多發請求）', false, (S) => {
    const i = S.game.indexOf('tEventPollTimer = setInterval(');
    const eff = S.game.slice(S.game.lastIndexOf('$effect(() => {', i), S.game.indexOf('\n  });', i));
    return i > 0 && !/return \(\) =>/.test(eff);
  }],
  ['★★[②] SW 不預快取爬蟲專用檔（og-image／*.xml／robots／Google 驗證頁），app 用得到的檔照舊預快取', true, (S) => {
    const m = /const CRAWLER_ONLY = \(u: string\) => ([^\n]+);/.exec(S.sw);
    if (!m || !/!CRAWLER_ONLY\(f\)/.test(S.sw) || !/!CRAWLER_ONLY\(p\)/.test(S.sw)) return false;
    const f = new Function('u', 'return ' + m[1].replace(/: string/g, '') + ';');
    const crawler = ['/og-image.png', '/sitemap.xml', '/sitemap-cards.xml', '/robots.txt', '/googlec112ab47fcd31fe0.html', '/ptcg-tw-sim/og-image.png', '/ptcg-tw-sim/robots.txt'];
    const app = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512-maskable.png', '/sounds/start-the-game-already.mp3', '/', '/tournament', '/line-group-qr.png', '/home-video.json'];
    return crawler.every((u) => f(u)) && app.every((u) => !f(u));
  }],
  ['★[③] preconnect：縮圖站不帶 crossorigin（no-cors 圖片才沿用得到）、securetoken 帶 crossorigin', true, (S) =>
    /<link rel="preconnect" href="https:\/\/suenz001\.github\.io" \/>/.test(S.app) && /<link rel="preconnect" href="https:\/\/securetoken\.googleapis\.com" crossorigin \/>/.test(S.app)],
  ['★[⑥] /cards ALL：卡牌政策在 index.json 之前就開始載入，之後 await 同一個 promise', true, (S) => {
    const i = S.cards.indexOf("if (setCode === 'ALL') {"); const blk = S.cards.slice(i, i + 3000);
    // ⭐v6.509（Rule 40）：index.json 改走中央 cardDataUrl（內容雜湊）⇒ 兩種寫法擇一；意圖（政策先開始載入）不變
    const iP = blk.indexOf('const policyP = loadCardPolicyOnce();');
    const iF = Math.max(blk.indexOf('await fetch(`${base}/cards/index.json'), blk.indexOf("await fetch(cardDataUrl(base, 'cards/index.json')"));
    return iP > 0 && iF > iP && /await policyP;/.test(blk) && !/await loadCardPolicyOnce\(\)/.test(blk);
  }],
];
function runAll(S) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(S); } catch { r = false; } return { name, headFail, r }; }); }

console.log('【S】原始碼');
for (const c of runAll(CUR)) ok(c.name, c.r);
ok('★★[②b] ready-go.wav 已刪除，而且沒有任何程式載入它（實際播的是 start-the-game-already.mp3）',
  !existsSync(join(ROOT, 'static/sounds/ready-go.wav')) && !/ready-go\.wav['"`]/.test(CUR.game + rd('src/lib/audio/sfx.ts').replace(/\/\/[^\n]*/g, ''))
  && /preloadReadyGoSample\(`\$\{base\}\/sounds\/start-the-game-already\.mp3`\)/.test(CUR.game));

// ── 行為：休閒大廳列表／房內聊天的背景降頻與回前景補抓 ────────────────────────
console.log('\n【B】行為（實跑抽出的函式）');
async function runRooms(src, { hidden }) {
  const body = extractFn(src, 'filterAndSortOpenRooms') + '\n' + extractFn(src, 'subscribeOpenRooms');
  const js = ts2js(body);
  const listeners = [];
  const doc = { visibilityState: hidden ? 'hidden' : 'visible', addEventListener: (t, h) => listeners.push(h), removeEventListener: (t, h) => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); } };
  const delays = []; let pending = null; let cleared = 0; let calls = 0;
  const fakeSet = (cb, d) => { delays.push(d); pending = cb; return 7; };
  const fakeClear = () => { cleared++; pending = null; };
  const U = Symbol('u'), N = Symbol('n');
  const combined = async () => { calls++; return { rooms: [], h: 'h' + calls }; };
  const sub = new Function('oracleListRoomsCombined', 'oracleListRooms', 'ROOMS_UNCHANGED', 'ROOMS_COMBINED_UNSUPPORTED', 'adoptOrKeep', 'SEAT_LAYOUT_VERSION', 'isLobbyHostDead', 'isLobbyTooOld', 'setTimeout', 'clearTimeout', 'console', 'document',
    js + '\n;return subscribeOpenRooms;')(combined, async () => [], U, N, (l, c) => ({ data: c !== null ? c : l }), 2, () => false, () => false, fakeSet, fakeClear, { warn() {} }, doc);
  const unsub = sub(() => {});
  await new Promise((r) => setTimeout(r, 15));
  const out = { delays: [...delays], callsBefore: calls };
  doc.visibilityState = 'visible'; for (const h of [...listeners]) h();
  await new Promise((r) => setTimeout(r, 15));
  out.callsAfterVisible = calls; out.cleared = cleared; out.delaysAfter = delays.slice(out.delays.length);
  unsub(); out.listenersLeft = listeners.length;
  return out;
}
async function runChat(src, { hidden }) {
  const js = ts2js(extractFn(src, 'subscribeMessages'));
  const listeners = [];
  const doc = { visibilityState: hidden ? 'hidden' : 'visible', addEventListener: (t, h) => listeners.push(h), removeEventListener: (t, h) => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); } };
  const delays = []; let calls = 0;
  const sub = new Function('oracleListMessages', 'MESSAGES_LIMIT', 'setTimeout', 'clearTimeout', 'console', 'document',
    js + '\n;return subscribeMessages;')(async () => { calls++; return null; }, 100, (cb, d) => { delays.push(d); return 7; }, () => {}, { warn() {} }, doc);
  const unsub = sub('ABC', () => {});
  await new Promise((r) => setTimeout(r, 15));
  const out = { delays: [...delays], calls };
  doc.visibilityState = 'visible'; for (const h of [...listeners]) h();
  await new Promise((r) => setTimeout(r, 15));
  out.callsAfterVisible = calls; unsub(); out.listenersLeft = listeners.length;
  return out;
}
{
  const fg = await runRooms(CUR.room, { hidden: false });
  const bg = await runRooms(CUR.room, { hidden: true });
  ok('★★★[④a] 前景節奏不變：房間列表 2000ms', fg.delays[0] === 2000, JSON.stringify(fg));
  ok('★★[④b] 分頁隱藏：房間列表改 10 秒一發', bg.delays[0] === 10000, JSON.stringify(bg.delays));
  ok('★★★[④c] 回到前景：取消排好的那發、立刻補抓一發，之後回到 2 秒節奏；退訂後監聽移除',
    bg.callsAfterVisible === bg.callsBefore + 1 && bg.cleared >= 1 && bg.delaysAfter[0] === 2000 && bg.listenersLeft === 0, JSON.stringify(bg));
  const cfg = await runChat(CUR.room, { hidden: false });
  const cbg = await runChat(CUR.room, { hidden: true });
  ok('★★[④d] 房內聊天：前景 1500ms 不變、隱藏 5000ms、回前景立刻補抓、退訂後監聽移除',
    cfg.delays[0] === 1500 && cbg.delays[0] === 5000 && cbg.callsAfterVisible === cbg.calls + 1 && cbg.listenersLeft === 0, JSON.stringify([cfg, cbg]));
}
{
  // ⑤ loadIndex 同時呼叫只抓一次；失敗後可以重試
  //   ⭐v6.509（Rule 40）：pool.ts 改 import 中央 cardDataUrl（卡包內容雜湊）⇒ 剝 import 後補一個替身；意圖不變
  const js = ts2js(CUR.pool.replace(/^import[^\n]*\n/gm, ''));
  const mod = new Function('base', 'VERSION', 'migrateCardId', 'cardDataUrl', js.replace(/export /g, '') + '\n;return { loadIndex };')('', 'T', (x) => x, (b, r) => `${b}/${r}?v=T`);
  let n = 0;
  const fetchFn = async () => { n++; await new Promise((r) => setTimeout(r, 10)); return { ok: true, json: async () => [{ code: 'X' }] }; };
  const [a, b] = await Promise.all([mod.loadIndex(fetchFn), mod.loadIndex(fetchFn)]);
  ok('★★[⑤] loadIndex 同時呼叫只抓一次 index.json、兩邊拿到同一份', n === 1 && a === b && a.length === 1, String(n));
  const mod2 = new Function('base', 'VERSION', 'migrateCardId', 'cardDataUrl', js.replace(/export /g, '') + '\n;return { loadIndex };')('', 'T', (x) => x, (b, r) => `${b}/${r}?v=T`);
  let m = 0;
  const flaky = async () => { m++; if (m === 1) return { ok: false, status: 500 }; return { ok: true, json: async () => [] }; };
  let threw = false; try { await mod2.loadIndex(flaky); } catch { threw = true; }
  const r2 = await mod2.loadIndex(flaky);
  ok('[⑤b] 失敗時清掉在途記錄，下一次呼叫照舊重試（與原本行為相同）', threw && Array.isArray(r2) && m === 2);
}

// ── HEAD-FAIL ──────────────────────────────────────────────────────────────
console.log('\n【H】HEAD-FAIL：同一批判準餵 v6.466');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6467 H：HEAD-FAIL', '需要 BASE commit');
else {
  const BASE = load((p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); if (!r.ok) throw new Error('no'); return r.out.replace(/\r\n/g, '\n'); });
  const wrong = runAll(BASE).filter((c) => c.headFail && c.r).map((c) => c.name);
  ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.466 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
  const bg = await runRooms(BASE.room, { hidden: true });
  ok('★★[HEAD-FAIL ④] v6.466 的房間列表在分頁隱藏時照樣 2 秒一發', bg.delays[0] === 2000, JSON.stringify(bg.delays));
}

// ── 真瀏覽器：進出錦標賽頁三次，背景計時器不可以累積 ─────────────────────────
console.log('\n【E】真瀏覽器：進出 /tournament、/game 之後沒有殘留的計時器');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.467 殘留計時器') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.467 殘留計時器');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    try {
      const ctx = await browser.newContext({ serviceWorkers: 'block' });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io/, (r) => r.abort());
      await ctx.addInitScript(() => {
        const live = new Set(); const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
        window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); live.add(id); return id; };
        window.clearInterval = (id) => { live.delete(id); return ci(id); };
        window.__live = () => live.size;
      });
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      const nav = async (href) => { await pg.evaluate((h) => { const a = document.createElement('a'); a.href = h; document.body.appendChild(a); a.click(); }, href); };
      await pg.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await pg.waitForTimeout(2500);
      const home = await pg.evaluate(() => window.__live());
      let inT = 0;
      for (let i = 0; i < 3; i++) { await nav('/tournament'); await pg.waitForTimeout(3500); inT = Math.max(inT, await pg.evaluate(() => window.__live())); await nav('/'); await pg.waitForTimeout(2500); }
      const after = await pg.evaluate(() => window.__live());
      await nav('/game'); await pg.waitForTimeout(3500); await nav('/'); await pg.waitForTimeout(2500);
      const afterGame = await pg.evaluate(() => window.__live());
      ok('[E 前提] 進了錦標賽頁確實有掛計時器（量測有效）', inT > home, JSON.stringify({ home, inT }));
      ok('★★★[E1] 進出 /tournament 三次、/game 一次之後回到首頁，計時器數量與一開始相同（v6.466 是每進出一次多 1 支）', after === home && afterGame === home, JSON.stringify({ home, after, afterGame }));
      ok('[E2] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
      await ctx.close();
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.467 全站 audit（網路／系統）: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6467-site-audit-net ===');
process.exit(fail ? 1 : 0);
