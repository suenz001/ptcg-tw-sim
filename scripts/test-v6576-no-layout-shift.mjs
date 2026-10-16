#!/usr/bin/env node
/**
 * v6.576 守衛：對戰畫面永遠不會被提醒或回放控制列擠動（站長 2026-10-16）
 *   「出現提醒字樣的時候，例如上方出現【對手的連線不穩定…】，就會將現有的畫面往下推，導致對戰區寶可夢的位置會往下跑掉…
 *    建議比照跑馬燈的方式，直接疊在上方儀表板的上面，並且可以按X關閉」
 *   「對戰回放因為在儀表板上方增加上一步、下一步、下一回合等等的按鈕，也會導致畫面也會被往下擠…(是不是可以採浮現拖曳視窗的方法?)」
 *   「我希望對戰畫面可以固定永遠不會被擠動，這樣玩家才不會看到對戰盤面抖來抖去、跳來跳去」
 *
 *   【S】靜態
 *     S1 五種提醒（失聯／重送／排隊／說明／對手不穩）＋版本載入異常都在 position:fixed 的 battle-notice-stack 裡，堆疊在版面分支外
 *     S2 每一則都有 ✕（失聯沿用 v6.149 的 dismiss；其餘四則各有隱藏旗標，事情結束就重設）
 *     S3 回放控制列包在 treplay-float-wrap（fixed）裡，控制列掛 use:modalDrag（clamp:'contain'）、有拖曳把手
 *   【E】真瀏覽器（build/）
 *     N1 四種桌機版面：在提醒堆疊裡塞兩則長提醒 ⇒ 盤面與頁首位置不動（0 px）
 *     N2 提醒疊在頁首（儀表板）上方（不在盤面裡）
 *     NM 自驗：堆疊改回文件流（position:static）⇒ N1 真的會紅
 *     R1 藍桌墊／經典版回放：頁首與盤面之間沒有被控制列撐開（與一般對局同一個間距）
 *     R2 拖曳把手 ⇒ 控制列跟著移動、盤面不動、控制列完整留在畫面內
 *     R3 拖過之後按鈕照常可以按（下一步 ⇒ 步數前進）
 *     R4 iPad 直向 834 寬：控制列不超出畫面
 *     RM 自驗：外層改回文件流 ⇒ R1 真的會紅
 *   【H】HEAD-FAIL：S1～S3 餵 BASE（v6.575）必紅
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.575。
const BASE_SHA = 'a18f19e13a65f5d55d171b7681fd6d0b3fa9fb92';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');

function scenS(src) {
  const r = {};
  const a = src.indexOf('  <div class="battle-notice-stack" role="presentation"');   // v6.578（Rule 40）：起始標籤後面多了 use:modalDrag
  const b = src.indexOf('  <!-- <<< v6576-notice-stack-end -->');
  const stack = a >= 0 && b > a ? src.slice(a, b) : '';
  const branch = src.indexOf('{#if isPortraitMobile && game}\n    <MobilePortraitBattle');
  const kinds = ['net-warn-banner', 'act-retry-banner', 'act-queue-banner', 'act-notice-banner', 'opp-quiet-banner', 'ability-broken-banner'];
  // ⭐v6.578（Rule 40）：固定位置改由外層 battle-notice-wrap 負責（堆疊本身要掛 use:modalDrag 拖曳）；意圖（提醒不佔版面）不變
  const css = /\.battle-notice-wrap\{ position:fixed; top:calc\(var\(--safe-top, 0px\) \+ 4px\);[^}]*pointer-events:none; \}/.test(src);
  r.S1 = !!stack && kinds.every((k) => stack.includes(`<div class="${k}"`)) && kinds.every((k) => (src.match(new RegExp(`<div class="${k}"`, 'g')) || []).length === 1)
    && branch > b && css && !/\{#if abilityRegBroken\}\n    <div style="background:#7a1f1f/.test(src);
  r.S1n = JSON.stringify({ stack: !!stack, css, branchAfter: branch > b });
  const x = (cls) => { const i = stack.indexOf(`<div class="${cls}"`); const j = stack.indexOf('</div>\n  {/if}', i); return i >= 0 ? stack.slice(i, j) : ''; };
  r.S2 = ['net-warn-banner', 'act-retry-banner', 'act-queue-banner', 'act-notice-banner', 'opp-quiet-banner'].every((k) => x(k).includes('class="net-warn-x"'))
    && stack.includes('{#if tActRetry && !_ntHideRetry}') && stack.includes('{#if tActQueue.length && !_ntHideQueue}') && stack.includes('{#if tActNotice && !_ntHideNotice}') && /function tActSay\(msg: string, ms = 2600\): void \{\n    _ntHideNotice = false;/.test(src) && stack.includes('{#if tOppQuietOn && !_ntHideOppQuiet}')
    && src.includes('$effect(() => { if (!tActRetry) _ntHideRetry = false; });') && src.includes('$effect(() => { if (tActQueue.length === 0) _ntHideQueue = false; });') && src.includes('$effect(() => { if (!tOppQuietOn) _ntHideOppQuiet = false; });');
  r.S3 = src.includes(`  <div class="treplay-float-wrap">\n  <div class="treplay-bar" use:modalDrag={{ clamp: 'contain', handle: '.treplay-grip, .treplay-title', overlay: false }}>\n    <span class="treplay-grip"`)
    && /\.treplay-float-wrap \{ position: fixed;[^}]*pointer-events: none; \}/.test(src) && /\.treplay-bar \{ position: relative; pointer-events: auto;/.test(src) && !/\.treplay-bar \{ position: sticky/.test(src);
  return r;
}
const LABEL = {
  S1: '★★★ S1 所有對戰中的提醒都在固定位置的浮動堆疊裡（不佔版面），堆疊在版面分支外（手機直式也有）',
  S2: '★★ S2 每一則提醒都有 ✕；關掉後事情結束就重設（說明訊息每次 tActSay 都重設：同一句再出現也要再講）',
  S3: '★★★ S3 回放控制列是浮動、可拖曳的小視窗（use:modalDrag contain），不再 sticky 佔版面',
};
const R = scenS(SRC);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);
console.log('【H】HEAD-FAIL（BASE v6.575）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6576 HEAD-FAIL', '需要歷史 commit');
else {
  const x = readBaseBlob(ROOT, BASE_SHA, REL);
  const B = scenS(x.ok ? x.out.replace(/\r\n/g, '\n') : '');
  for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.575：${k} 紅`, B[k] !== true);
}

console.log('\n【E】真瀏覽器');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.576 盤面不被擠動') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.576 盤面不被擠動');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const geo = (pg) => pg.evaluate(() => {
      const q = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top + scrollY, b: b.bottom + scrollY, l: b.left, r: b.right, h: b.height }; };
      return { pm: q('.playmat'), hd: q('.battle-header'), st: q('.battle-notice-stack'), stPos: (() => { const e = document.querySelector('.battle-notice-wrap'); return e ? getComputedStyle(e).position : null; })()   /* v6.578：外層固定 */ };
    });
    const LONGMSG = '📶 對手的連線目前不穩定（已有 100 秒沒有連上伺服器）—— 不是你的網路、也不是網站故障。對手回來後畫面會自動更新；若一直沒回來，系統的閒置判負會照規則處理。';
    const inject = (pg) => pg.evaluate((m) => { const s = document.querySelector('.battle-notice-stack'); if (!s) return false;
      for (const c of ['opp-quiet-banner', 'net-warn-banner']) { const d = document.createElement('div'); d.className = c + ' v6576-fake'; d.style.cssText = 'padding:8px;background:#16324a;color:#fff;'; d.textContent = m; s.appendChild(d); } return true; }, LONGMSG);
    const clear = (pg) => pg.evaluate(() => document.querySelectorAll('.v6576-fake').forEach((e) => e.remove()));
    // ── N：提醒堆疊 ─────────────────────────────────────
    {
      const errs = [];
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 1024 } });
        // 卡圖一律回假圖（不連外網）；固定亂數種子 ⇒ 每次都是同一局
        await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
        await ctx.addInitScript((LY) => {
          let x = 7; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
          localStorage.setItem('ptcg_battle_layout', LY);
        }, 'blue');
        const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
        await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
        await pg.click('.mode-card');
                  const sels = pg.locator('main.lobby select');
        await sels.nth(0).selectOption('__preset_tactic_dragonite__');
        await sels.nth(1).selectOption('__preset_tactic_gardevoir__');
        const start = pg.locator('button.btn-primary', { hasText: '開始' });
        await start.waitFor({ state: 'visible', timeout: 30000 });
        for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500);
        await start.click();
        // 設置：把第一張可拖的基礎寶可夢拖上戰鬥位，按「準備完成」；之後一路處理系統視窗，直到輪到玩家 1（出現「跳過攻擊」）
        await pg.waitForSelector('.hand-card.draggable', { timeout: 60000 });
        await pg.waitForTimeout(1500);
        const drag = async (from, to) => {
          const a = await from.boundingBox(), z = await to.boundingBox(); if (!a || !z) return;
          await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await pg.mouse.down();
          await pg.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 - 10, { steps: 3 });
          await pg.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(700);
        };
        await drag(pg.locator('.hand-card.draggable').first(), pg.locator('.my-active-zone'));
        await pg.mouse.move(5, 500);
        const sysBtn = pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成/ });
        let myTurn = false;
        for (let w = 0; w < 90 && !myTurn; w++) {
          myTurn = await pg.locator('button:visible', { hasText: '跳過攻擊' }).count() > 0 && await pg.locator('.turn-res').count() > 0;
          if (!myTurn) { if (await sysBtn.count()) await sysBtn.first().click().catch(() => {}); await pg.waitForTimeout(700); }
        }
      ok('[N 前提] 開局成功、輪到玩家 1', myTurn);
      if (myTurn) {
        await pg.addStyleTag({ content: '.selection-overlay,.modal-overlay{display:none!important}' });
        for (const layout of ['blue', 'fable', 'tabletop', 'classic']) {
          await pg.setViewportSize({ width: 1376, height: 958 }); await pg.waitForTimeout(300);
          if (!(await pg.locator('select:has(option[value="tabletop"])').count())) await pg.locator('.settings-chip').first().click().catch(() => {});
          await pg.waitForTimeout(300);
          await pg.evaluate((v) => { const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'tabletop')); if (sel) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } }, layout);
          await pg.keyboard.press('Escape').catch(() => {});
          await pg.waitForTimeout(600);
          const g0 = await geo(pg); const injected = await inject(pg); await pg.waitForTimeout(300); const g1 = await geo(pg); await clear(pg);
          const dPm = g0.pm && g1.pm ? Math.abs(g1.pm.t - g0.pm.t) : 99, dHd = g0.hd && g1.hd ? Math.abs(g1.hd.t - g0.hd.t) : 99;
          ok(`★★★[N1] ${layout}：塞兩則長提醒 ⇒ 盤面與頁首位置不動`, injected && g1.stPos === 'fixed' && dPm <= 0.5 && dHd <= 0.5, JSON.stringify({ dPm, dHd, pos: g1.stPos }));
          ok(`★★[N2] ${layout}：提醒疊在頁首上方（從畫面頂端開始、不在盤面裡）`, !!g1.st && g1.st.t <= g1.hd.b && g1.st.t - scrollYOf(g1) < 40, JSON.stringify({ st: g1.st, hd: g1.hd }));
        }
        await pg.setViewportSize({ width: 1376, height: 958 });
        const tag = await pg.addStyleTag({ content: '.battle-notice-wrap{ position:static !important; } .battle-notice-stack{ transform:none !important; }' });
        await pg.waitForTimeout(300);
        const m0 = await geo(pg); await inject(pg); await pg.waitForTimeout(300); const m1 = await geo(pg); await clear(pg);
        ok('★★[NM] 自驗：提醒堆疊改回文件流 ⇒ 盤面真的會被推（量測不是恆真）', m1.pm.t - m0.pm.t > 20, JSON.stringify({ d: m1.pm.t - m0.pm.t }));
        await tag.evaluate((n) => n.remove());
      }
      ok('[N3] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
      await ctx.close();
    }
    // ── R：回放控制列 ───────────────────────────────────
    {
      const mod = await buildAiBundle(ROOT, {}), pool = loadLivePool(ROOT);
      const states = []; let last = null;
      playGame({ mod, pool, decks: [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')], agents: [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)], seed: 7, firstPlayer: firstPlayerOf(7),
        onStep: (st, act, next) => { if (next && next !== last) { states.push(next); last = next; } } });
      const fin = states[states.length - 1];
      const snaps = []; let prev = null;
      for (const s of states) { if (s.phase === 'playing' && (!prev || prev.phase !== 'playing' || prev.activePlayerIndex !== s.activePlayerIndex)) snaps.push({ turn: s.turn, activePlayerIndex: s.activePlayerIndex, logLen: s.log.length, state: { ...s, log: [] } }); prev = s; }
      const replayData = { meta: { matchId: 'EV_r1_m0', eventId: 'EV', p1name: 'A', p2name: 'B', winnerName: 'A', round: 1 }, finalLog: fin.log, finalState: { ...fin, log: [] }, snapshots: snaps };
      for (const layout of ['blue', 'classic']) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1376, height: 958 } });
        await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"/>' }));
        await ctx.route(/\/api\/tournament\/replay\?/, (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replayData) }));
        await ctx.route(/\/api\/replay\/tourn-steps/, (rt) => rt.fulfill({ status: 404, body: '' }));
        await ctx.addInitScript((LY) => { localStorage.setItem('ptcg_battle_layout', LY); }, layout);
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/game?treplay=EV_r1_m0`, { waitUntil: 'load' });
        const got = await pg.waitForSelector('.treplay-bar', { timeout: 60000 }).then(() => true).catch(() => false);
        ok(`[R 前提] ${layout}：回放開起來了`, got);
        if (got) {
          await pg.waitForTimeout(800);
          const rg = () => pg.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
            return { pm: r('.playmat'), hd: r('.battle-header'), bar: r('.treplay-bar'), step: document.querySelector('.treplay-step')?.textContent || '', W: innerWidth, H: innerHeight }; });
          const a = await rg();
          // 一般對局的頁首→盤面間距：把控制列暫時拿掉量
          const tag0 = await pg.addStyleTag({ content: '.treplay-float-wrap, .treplay-bar{ display:none !important; }' }); await pg.waitForTimeout(200);
          const n = await rg(); await tag0.evaluate((x) => x.remove()); await pg.waitForTimeout(200);
          const gapR = a.pm.t - a.hd.b, gapN = n.pm.t - n.hd.b;
          ok(`★★★[R1] ${layout}：回放時頁首與盤面之間沒有被控制列撐開（與沒有控制列時同一個間距）`, Math.abs(gapR - gapN) <= 1 && Math.abs(a.pm.t - n.pm.t) <= 1, JSON.stringify({ gapR, gapN }));
          // R6（審查 P2）：預設位置疊在頁首上，不伸進盤面（1376 寬單行；回放控制列下緣 ≤ 盤面上緣＋6px）
          ok(`★★[R6] ${layout}：1376 寬時回放控制列預設不伸進盤面`, a.bar.b <= a.pm.t + 6, JSON.stringify({ barB: a.bar.b, pmT: a.pm.t }));
          // R2：拖曳把手
          const grip = await pg.locator('.treplay-grip').boundingBox();
          await pg.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await pg.mouse.down();
          await pg.mouse.move(grip.x + 60, grip.y + 120, { steps: 6 }); await pg.mouse.move(grip.x + 220, grip.y + 300, { steps: 10 }); await pg.mouse.up(); await pg.waitForTimeout(300);
          const b = await rg();
          ok(`★★★[R2] ${layout}：拖曳把手 ⇒ 控制列跟著移動、盤面不動、控制列完整留在畫面內`, b.bar.t - a.bar.t > 150 && Math.abs(b.pm.t - a.pm.t) <= 0.5 && b.bar.l >= -1 && b.bar.r <= b.W + 1 && b.bar.t >= -1 && b.bar.b <= b.H + 1, JSON.stringify({ a: a.bar, b: b.bar }));
          await pg.locator('.treplay-btn', { hasText: '下一步' }).click(); await pg.waitForTimeout(400);
          const c = await rg();
          ok(`★★[R3] ${layout}：拖過之後按鈕照常可以按（下一步 ⇒ 步數前進）`, c.step !== b.step && /（2\//.test(c.step), JSON.stringify({ before: b.step, after: c.step }));
          await pg.setViewportSize({ width: 834, height: 1120 }); await pg.waitForTimeout(500);
          const d = await rg();
          ok(`★★[R4] ${layout}：iPad 直向 834 寬，控制列不超出畫面`, d.bar.l >= -1 && d.bar.r <= d.W + 1 && d.bar.t >= -1, JSON.stringify(d.bar));
          if (layout === 'blue') {
            await pg.setViewportSize({ width: 1376, height: 958 }); await pg.waitForTimeout(300);
            const tag = await pg.addStyleTag({ content: '.treplay-float-wrap{ position:static !important; } .treplay-bar{ transform:none !important; }' }); await pg.waitForTimeout(300);
            const m = await rg(); await tag.evaluate((x) => x.remove());
            ok('★★[RM] 自驗：外層改回文件流 ⇒ 盤面真的會被推（R1 會紅）', m.pm.t - m.hd.b - gapN > 20, JSON.stringify({ gap: m.pm.t - m.hd.b, gapN }));
          }
        }
        ok(`[R5] ${layout}：頁面零錯誤`, errs.length === 0, errs.slice(0, 3).join(' | '));
        await ctx.close();
      }
    }
    await browser.close(); srv.close();
  }
}
function scrollYOf() { return 0; }
console.log(`\n=== v6.576 對戰畫面不被提醒／回放控制列擠動：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
