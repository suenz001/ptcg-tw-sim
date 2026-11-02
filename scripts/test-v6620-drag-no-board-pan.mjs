#!/usr/bin/env node
/**
 * v6.620 守衛：拖曳浮動視窗／控制列時，後面的對戰盤面不可以被拖動
 *
 * 站長 2026-11-02：「使用ipad回放戰鬥紀錄復盤的時候，拖曳控制撥放的工具列，常常會拖到後面的對戰盤面，
 *   照理說後面的盤面應該要鎖定不能被滑動才對，請做整體的audit檢查，各種版面桌墊包含手機版，對戰的版面都不該被拖動才對」
 *
 * 根因（實測）：回放控制列的拖曳把手「標題」沒有 touch-action:none ⇒ 觸控拖曳被瀏覽器當成整頁平移
 *   （iPad Safari：頁面彈性回彈、網址列收合，盤面跟著動），同時送 pointercancel ⇒ 控制列只動一點（Chromium 實測拖 200px 只動 27px）。
 *   另外經典版／桌遊版的「解析度模式」CSS zoom 讓視窗只跟手 60～90%。
 *
 * 【U】中央 $lib/modal-drag（esbuild 打包、真 Chromium）
 *   U1 掛上 action ⇒ 把手（含之後才出現的把手）touch-action:none；非把手不受影響；wholeNode ⇒ 元素本身 none
 *   U2 卸載 ⇒ 規則移除；把手選擇器不合法也不 throw
 *   U3 祖先有 CSS zoom:0.6 ⇒ 觸控拖 200px，視窗在畫面上也移動 200px（±2）；沒有 zoom 時同樣 200px
 * 【S】靜態：對戰畫面存在時 html／body overscroll-behavior:none（關閉彈性回彈與下拉重新整理）
 * 【R】真站（build/）回放：iPad 1180×820、820×1180 × 新版桌墊／Fable／桌遊／經典，觸控拖回放控制列標題 200px
 *   ⇒ 控制列跟手（≥190px）、盤面位置與整頁捲動完全不動；html／body overscroll-behavior 為 none；在盤面上滑動也不動
 *   ＋ 整頁本來就不可捲（scrollHeight ≤ 畫面高，修法的前提）；拖「XX 的回合」也跟手（整條控制列都是把手）
 *   ⚠ iOS 的彈性回彈 Chromium 模擬不到：boardMove／sy 在 BASE 也成立，真正有鑑別力的是 barMove／stepMove（HEAD-FAIL 由 U 段證明），回彈要實機驗收
 * 【U】補充：U4 縮放比改變後不跳位；U5 panel-resize 在 zoom 下跟手（審查 P2-3）
 * 【H】HEAD-FAIL：BASE（54b996eb＝v6.619）上 U1、U3（zoom）紅
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwLaunch } from './lib/pw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '54b996eb';
const P_DRAG = 'src/lib/modal-drag.ts';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 900) : '')); } };
const rd = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// modal-drag（可換成 BASE 版本）＋panel-resize 一起打包成 window.MD
async function dragBundle(src, panelSrc = rd('src/lib/panel-resize.ts')) {
  const out = await build({ stdin: { contents: `export * from './__md_probe';\nexport { panelResize } from './__pr_probe';`, resolveDir: join(ROOT, 'src/lib'), loader: 'ts', sourcefile: 'entry.ts' },
    plugins: [{ name: 'probe', setup(b) {
      b.onResolve({ filter: /^\.\/(__md_probe|__pr_probe|modal-drag)$/ }, (a) => ({ path: a.path, namespace: 'probe' }));
      b.onLoad({ filter: /.*/, namespace: 'probe' }, (a) => ({ contents: a.path.includes('__pr_probe') ? panelSrc : src, loader: 'ts', resolveDir: join(ROOT, 'src/lib') }));
    } }],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'MD', logLevel: 'silent' });
  return out.outputFiles[0].text;
}
async function touchDrag(pg, cdp, x, y, dx, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 15; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 15, y: y + dy * i / 15 }] }); await pg.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(300);
}
const FIXTURE = (zoom) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;height:100vh}#root{${zoom ? `zoom:${zoom};` : ''}position:fixed;inset:0}#win{position:absolute;left:40px;top:40px;width:300px;background:#123;color:#fff}
.h{display:block;height:40px;background:#357}.body{height:80px}</style>
<div id="root"><div id="win"><div class="h">標題（把手）</div><div class="body">內容 <button id="b">按鈕</button></div></div><button id="fab" style="position:fixed;right:10px;bottom:10px">💬</button></div>`;

async function unitChecks(browser, bundle) {
  const r = {};
  // U1／U2
  { const ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, hasTouch: true, isMobile: true });
    const pg = await ctx.newPage(); await pg.setContent(FIXTURE(0)); await pg.addScriptTag({ content: bundle });
    r.U = await pg.evaluate(() => {
      const ta = (e) => getComputedStyle(e).touchAction;
      const win = document.getElementById('win'), fab = document.getElementById('fab');
      const a = window.MD.modalDrag(win, { handle: '.h', clamp: 'contain' });
      const late = document.createElement('div'); late.className = 'h'; win.querySelector('.body').appendChild(late);   // 之後才出現的把手
      const f = window.MD.modalDrag(fab, { wholeNode: true, clamp: 'contain', threshold: 12 });
      const on = { handle: ta(win.querySelector('.h')), late: ta(late), body: ta(win.querySelector('.body')), btn: ta(document.getElementById('b')), fab: ta(fab) };
      a.destroy(); f.destroy();
      const off = { handle: ta(win.querySelector('.h')), fab: ta(fab) };
      // 不合法的把手選擇器：中央的觸控規則安裝函式不可以 throw（其他部分沿用既有行為，不在本版範圍）
      let threw = false; try { const rm = window.MD.installHandleTouchNone(win, { handle: '.h,,[' }); rm(); } catch { threw = true; }
      return { on, off, threw };
    });
    await ctx.close(); }
  // U3：zoom
  const res = {};
  for (const z of [0, 0.6]) {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, hasTouch: true, isMobile: true });
    const pg = await ctx.newPage(); await pg.setContent(FIXTURE(z)); await pg.addScriptTag({ content: bundle });
    await pg.evaluate(() => { window.__a = window.MD.modalDrag(document.getElementById('win'), { handle: '.h', clamp: 'contain' }); });
    const before = await pg.evaluate(() => { const r = document.querySelector('.h').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: document.getElementById('win').getBoundingClientRect().top }; });
    const cdp = await ctx.newCDPSession(pg);
    await touchDrag(pg, cdp, before.x, before.y, 0, 200);
    const after = await pg.evaluate(() => document.getElementById('win').getBoundingClientRect().top);
    res[z] = after - before.top;
    await ctx.close();
  }
  r.Z = res;
  // U4：拖過之後縮放比改變（玩家改了解析度）⇒ 下一次拖曳第一下不可以跳位
  { const ctx = await browser.newContext({ viewport: { width: 800, height: 700 }, hasTouch: true, isMobile: true });
    const pg = await ctx.newPage(); await pg.setContent(FIXTURE(0.6)); await pg.addScriptTag({ content: bundle });
    await pg.evaluate(() => { window.__a = window.MD.modalDrag(document.getElementById('win'), { handle: '.h', clamp: 'contain' }); });
    const cdp = await ctx.newCDPSession(pg);
    const p0 = await pg.evaluate(() => { const r = document.querySelector('.h').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    await touchDrag(pg, cdp, p0.x, p0.y, 150, 150);
    const tr0 = await pg.evaluate(() => document.getElementById('win').style.translate);
    await pg.evaluate(() => { document.getElementById('root').style.zoom = '0.8'; window.dispatchEvent(new Event('resize')); }); await pg.waitForTimeout(300);
    const tr1 = await pg.evaluate(() => document.getElementById('win').style.translate);   // 改縮放比觸發重夾 ⇒ 樣式位移不可以被改寫（否則視窗會自己跳）
    const p1 = await pg.evaluate(() => { const r = document.querySelector('.h').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, top: document.getElementById('win').getBoundingClientRect().top }; });
    await touchDrag(pg, cdp, p1.x, p1.y, 0, 30);
    const t2 = await pg.evaluate(() => document.getElementById('win').getBoundingClientRect().top);
    r.U4 = { move: t2 - p1.top, tr0, tr1 }; await ctx.close(); }
  // U5：panel-resize 在祖先 zoom:0.6 下，拉把往左上拉 100px ⇒ 畫面上寬高各大約大 100px（不會一按就縮）
  { const ctx = await browser.newContext({ viewport: { width: 900, height: 800 } });
    const pg = await ctx.newPage(); await pg.setContent(FIXTURE(0.6) + '<style>#pan{position:fixed;right:20px;bottom:20px;width:600px;height:500px;background:#246}.panel-resize-grip{position:absolute;left:0;top:0;width:20px;height:20px;background:#fff}</style>');
    await pg.addScriptTag({ content: bundle });
    const res5 = await pg.evaluate(() => { const d = document.createElement('div'); d.id = 'pan'; document.getElementById('root').appendChild(d);
      window.MD.panelResize(d, { storageKey: 'v6620-probe', grip: 'tl' }); const r = d.getBoundingClientRect(); const g = d.querySelector('.panel-resize-grip').getBoundingClientRect();
      return { w: r.width, h: r.height, gx: g.left + g.width / 2, gy: g.top + g.height / 2 }; });
    await pg.mouse.move(res5.gx, res5.gy); await pg.mouse.down(); await pg.mouse.move(res5.gx - 1, res5.gy - 1);
    const mid = await pg.evaluate(() => document.getElementById('pan').getBoundingClientRect().width);
    await pg.mouse.move(res5.gx - 100, res5.gy - 100, { steps: 10 }); await pg.mouse.up();
    const end = await pg.evaluate(() => { const r = document.getElementById('pan').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    r.U5 = { start: res5.w, mid, dw: end.w - res5.w, dh: end.h - res5.h }; await ctx.close(); }
  return r;
}

// ── S：靜態 ──
const GAME = rd('src/routes/game/+page.svelte');
console.log('【S】靜態');
ok('★★ S1 對戰畫面存在時 html／body 關閉彈性回彈（overscroll-behavior:none）',
  /:global\(html:has\(\.battle-root\)\), :global\(body:has\(\.battle-root\)\) \{ overscroll-behavior: none; \}/.test(GAME));
ok('★★ S2 中央拖曳有把手觸控規則與縮放換算（哨兵）', /\/\/ >>> v6620-handle-touch-none/.test(rd(P_DRAG)) && /\/\/ >>> v6620-zoom-scale/.test(rd(P_DRAG)));

const browser = await pwLaunch('v6.620 拖曳不帶動盤面', { headless: true });
if (!browser) shallowSkip('U／R（沒有可用的 Chromium）');
else {
  try {
    console.log('【U】中央拖曳（真 Chromium）');
    const U = await unitChecks(browser, await dragBundle(rd(P_DRAG)));
    ok('★★★ U1 把手（含之後才出現的）touch-action:none；內容與按鈕不受影響；wholeNode 元素本身 none',
      U.U.on.handle === 'none' && U.U.on.late === 'none' && U.U.on.body === 'auto' && U.U.on.fab === 'none', JSON.stringify(U.U));
    ok('★★ U2 卸載後規則移除；不合法的把手選擇器不 throw', U.U.off.handle === 'auto' && U.U.off.fab !== 'none' && !U.U.threw, JSON.stringify(U.U));
    ok('★★★ U3 觸控拖 200px：沒有 zoom 與祖先 zoom:0.6 都跟手（畫面上移動 198～202px）',
      Math.abs(U.Z[0] - 200) <= 2 && Math.abs(U.Z[0.6] - 200) <= 2, JSON.stringify(U.Z));
    ok('★★ U4 拖過後縮放比改變（0.6→0.8）：重夾不改寫位移（不自己跳），下一次拖 30px 只移動 30px', !!U.U4.tr0 && U.U4.tr0 === U.U4.tr1 && Math.abs(U.U4.move - 30) <= 3, JSON.stringify(U.U4));
    ok('★★ U5 panel-resize 在 zoom:0.6 下：一按不縮、拉 100px 寬高各大約多 100px', Math.abs(U.U5.mid - U.U5.start) <= 3 && Math.abs(U.U5.dw - 100) <= 4 && Math.abs(U.U5.dh - 100) <= 4, JSON.stringify(U.U5));

    console.log('【R】真站回放（build/）');
    const BUILD = process.env.PTCG_ACCEPTANCE_BUILD || join(ROOT, 'build');
    if (!existsSync(join(BUILD, '404.html'))) shallowSkip('R（沒有 build/；CI 的 build 步驟之後才有）');
    else {
      const { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } = await import('./lib/ai-sim-harness.mjs');
      const mod = await buildAiBundle(ROOT, {}), pool = loadLivePool(ROOT);
      const states = []; let last = null;
      playGame({ mod, pool, decks: [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')], agents: [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)], seed: 7, firstPlayer: firstPlayerOf(7),
        onStep: (st, act, next) => { if (next && next !== last) { states.push(next); last = next; } } });
      const fin = states[states.length - 1]; const snaps = []; let prev = null;
      for (const s of states) { if (s.phase === 'playing' && (!prev || prev.phase !== 'playing' || prev.activePlayerIndex !== s.activePlayerIndex)) snaps.push({ turn: s.turn, activePlayerIndex: s.activePlayerIndex, logLen: s.log.length, state: { ...s, log: [] } }); prev = s; }
      const replayData = { meta: { matchId: 'EV_r1_m0', eventId: 'EV', p1name: 'A', p2name: 'B', winnerName: 'A', round: 1 }, finalLog: fin.log, finalState: { ...fin, log: [] }, snapshots: snaps };
      const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
      const srv = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
        if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) p = join(BUILD, '404.html');
        res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res); });
      await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
      const rows = [];
      try {
        // iPad 常見尺寸（橫／直）＋12.9 吋；⚠ iOS 的彈性回彈 Chromium 模擬不到，這裡驗的是「整頁本來就不可捲」與「控制列跟手」，回彈要實機驗收
        for (const layout of ['blue', 'fable', 'tabletop', 'classic']) for (const [w, h] of [[1180, 820], [820, 1180], [1024, 768], [1080, 810], [1133, 744], [1366, 1024], [1376, 1032]]) {
          const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
          await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"/>' }));
          await ctx.route(/\/api\/tournament\/replay\?/, (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replayData) }));
          await ctx.route(/\/api\/replay\/tourn-steps/, (rt) => rt.fulfill({ status: 404, body: '' }));
          await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
          await ctx.addInitScript((LY) => { localStorage.setItem('ptcg_battle_layout', LY); }, layout);
          const pg = await ctx.newPage();
          await pg.goto(`http://localhost:${port}/game?treplay=EV_r1_m0`, { waitUntil: 'load' });
          const got = await pg.waitForSelector('.treplay-title', { timeout: 60000 }).then(() => true).catch(() => false);
          if (!got) { rows.push({ layout, w, h, got }); await ctx.close(); continue; }
          await pg.waitForTimeout(800);
          const g = () => pg.evaluate(() => ({ sy: scrollY, fits: document.scrollingElement.scrollHeight <= innerHeight + 1, board: Math.round(document.querySelector('.playmat').getBoundingClientRect().top * 10) / 10,
            bar: Math.round(document.querySelector('.treplay-bar').getBoundingClientRect().top), ob: [getComputedStyle(document.documentElement).overscrollBehaviorY, getComputedStyle(document.body).overscrollBehaviorY],
            t: (() => { const r = document.querySelector('.treplay-title').getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 }; })(),
            st: (() => { const r = document.querySelector('.treplay-step').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() }));
          const cdp = await ctx.newCDPSession(pg);
          const a = await g();
          await touchDrag(pg, cdp, a.t.x, a.t.y, 0, 200);
          const b = await g();
          const pm = await pg.evaluate(() => { const r = document.querySelector('.playmat').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
          await touchDrag(pg, cdp, pm.x, pm.y, 0, -250);
          const c = await g();
          // 按住「XX 的回合」（不是標題）往下拖 100px ⇒ 整條控制列都是把手，也要跟手（審查 P2-2）
          await touchDrag(pg, cdp, c.st.x, c.st.y, 0, 100);
          const d = await g();
          rows.push({ layout, w, h, got, fits: a.fits, barMove: b.bar - a.bar, stepMove: d.bar - c.bar, boardMove: b.board - a.board, sy: [a.sy, b.sy, c.sy, d.sy], boardAfterSwipe: c.board - a.board, ob: a.ob });
          await ctx.close();
        }
      } finally { srv.close(); }
      const okRow = (x) => x.got && x.fits && x.barMove >= 190 && x.barMove <= 210 && x.stepMove >= 95 && x.stepMove <= 105 && Math.abs(x.boardMove) <= 0.5 && Math.abs(x.boardAfterSwipe) <= 0.5 && x.sy.every((v) => v === 0) && x.ob[0] === 'none' && x.ob[1] === 'none';
      ok('★★★ R1 iPad 7 種尺寸 × 4 種桌墊回放：整頁本來就不可捲；拖標題或拖「XX 的回合」⇒ 控制列跟手、盤面不動；在盤面上滑動也不動；整頁關閉彈性回彈',
        rows.length === 28 && rows.every(okRow), JSON.stringify(rows.filter((x) => !okRow(x)).length ? rows.filter((x) => !okRow(x)) : rows.slice(0, 2)));
    }

    console.log('【H】HEAD-FAIL');
    if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
    else {
      const b = readBaseBlob(ROOT, BASE_SHA, P_DRAG);
      let BU = null, err = null;
      const bp = readBaseBlob(ROOT, BASE_SHA, 'src/lib/panel-resize.ts');
      try { BU = await unitChecks(browser, await dragBundle(b.out, bp.out)); } catch (e) { err = e.message; }
      const reds = { U1: !!BU && BU.U.on.handle !== 'none', U3: !!BU && Math.abs(BU.Z[0.6] - 200) > 2, U5: !!BU && !(Math.abs(BU.U5.mid - BU.U5.start) <= 3 && Math.abs(BU.U5.dw - 100) <= 4) };
      ok('★★★ HEAD-FAIL：BASE 上 U1（把手沒有 touch-action:none）、U3（zoom 下不跟手）、U5（panel-resize 一按就縮）紅', reds.U1 && reds.U3 && reds.U5 && err === null, JSON.stringify({ reds, err, BU }));
    }
  } finally { await browser.close(); }
}

console.log(`\n=== v6.620 拖曳不帶動盤面：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
