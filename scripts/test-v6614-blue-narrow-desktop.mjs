#!/usr/bin/env node
/**
 * v6.614 守衛：新版桌墊在寬 <1024（摺疊機展開、直立平板）改用電腦版桌墊的排列
 *
 * 站長 2026-10-31：「摺疊機有沒有更好的排版方式 更貼近windows網頁版的排版 雙方的戰鬥寶可夢在中間第一排 備戰寶可夢在第二排的配置」
 *   → 看過研究原型後：「要做，但你要檢查直立平板的解析度和排版是否合適，是否需要再客製化」
 *   → 「對戰log的位置，記得也要和windows桌面版一致(都在右側)」、「預設展開 避免玩家以為沒有對戰log」
 *
 * 【S】靜態（對戰頁 max-width:1023px 區塊）
 *   S1 通用 Fable 後備規則全部排除新版桌墊（沒有任何「裸的 .playmat.layout-fable」選擇器會套到新版桌墊）；
 *      新版桌墊直排專用的三段（v6442-blue-fallback／v6596-blue-portrait-fill／v6613-action-btns-spacing）已移除；
 *      新哨兵 v6614-blue-narrow-desktop 在區塊內，紀錄欄寬 --log-w 有值、格線第四欄是 var(--log-w)、紀錄欄 contain:size
 *   S2 電腦版新版桌墊的格線（四欄、grid-template-areas）逐字不動
 *   S3 媒體查詢數量與 BASE 相同
 * 【B】真瀏覽器（build/）
 *   B1 10 種摺疊機／直立平板尺寸（觸控、紀錄預設展開）＋1000×920（滑鼠）：用格線排版；整頁一個畫面；各區塊在畫面內且互不重疊；
 *      對手備戰在上 → 對手戰鬥 → 我方戰鬥 → 我方備戰 → 手牌；紀錄欄在行動欄右邊、貼齊畫面右側；備戰格寬 ≥38px；行動鈕 ≥22px
 *   B2 點收合鈕：紀錄欄收起、卡片變大、仍是一個畫面（704×830、820×1106）
 *   B3 舊 Fable 版（非新版桌墊）704×830 仍是原本的直排（零回歸）
 *   B4 1366×768 電腦版新版桌墊：格線欄寬與 BASE 實測相同（零回歸）
 *   B5 零之大空洞 8 格備戰（DOM 模擬：雙方備戰區加 bench-extended、--bench-n:8、補滿 8 格）：紀錄展開時備戰格不小於 v6.613 實測
 *      （704×830 ≥34、912×1300 ≥52；審查 P2：未處理前是 29／42），收合時各區塊內容不凸出框外、仍一個畫面；
 *      「對手牌堆」標題不被先攻／後攻小標蓋住（複審 P2：左欄收到 100px 時重疊 12px）
 *   B6 整頁鎖高（審查 P3：拿掉鎖高時 B1～B5 全綠）：704×704 行動欄注入到 8 顆 ⇒ 整頁仍是一個畫面
 * 【H】HEAD-FAIL：BASE（v6.613）上 S1 紅、S2 綠。B 的 HEAD-FAIL 用 PTCG_V6614_BASE_BUILD 指到 BASE 的 build/ 另跑（B1、B2 紅，B3、B4 綠），
 *      結果記在 docs/changelog-internal.md。
 */
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '42b129cc';
const PAGE = 'src/routes/game/+page.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 1200) : '')); } };

// 找出「@media (max-width: 1023px){ … }」整個區塊（大括號配對；註解已剝成等長空白，位置不變）
function mediaBlock(css) {
  const i = css.indexOf('@media (max-width: 1023px){'); if (i < 0) return null;
  const open = css.indexOf('{', i); let d = 0, j = open;
  for (; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}') { d--; if (d === 0) break; } }
  return { start: i, end: j + 1, body: css.slice(open + 1, j) };
}

function staticChecks(src) {
  const r = {};
  const p = stripCommentsBlank(src);
  const blk = mediaBlock(p);
  const body = blk ? blk.body : '';
  // 區塊內所有選擇器（逗號拆開）
  const sels = (body.match(/[^{}]+(?=\{)/g) || []).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
  // 「會套到新版桌墊的 Fable 後備規則」：以 .playmat.layout-fable 開頭、卻沒有排除新版桌墊、也不是新版桌墊專用
  const leaking = sels.filter((x) => /^\.playmat\.layout-fable(?![\w-])/.test(x) && !x.startsWith('.playmat.layout-fable:not(.layout-blue)') && !/layout-blue/.test(x));
  const removed = ['v6442-blue-fallback', 'v6596-blue-portrait-fill', 'v6613-action-btns-spacing'].every((t) => !src.includes(`/* >>> ${t} */`));
  const sStart = src.indexOf('/* >>> v6614-blue-narrow-desktop */'), sEnd = src.indexOf('/* <<< v6614-blue-narrow-desktop */');
  const inBlk = !!blk && sStart > blk.start && sEnd > sStart && sEnd < blk.end;
  const seg = inBlk ? p.slice(sStart, sEnd) : '';
  r.S1 = sels.length > 20 && leaking.length === 0 && removed && inBlk
    && /--log-w:clamp\(\d+px, \d+vw, \d+px\);/.test(seg) && /grid-template-columns:var\(--bl-side\) minmax\(0, 1fr\) var\(--bl-side-r\) var\(--log-w\);/.test(seg)
    && /\.log-col\{ contain:size;/.test(seg) && !/position:fixed/.test(seg);
  r.S1n = JSON.stringify({ n: sels.length, leaking: leaking.slice(0, 5), removed, inBlk });
  r.S2 = /\.playmat\.layout-blue\{[^}]*grid-template-columns:var\(--bl-side\) minmax\(0, 1fr\) var\(--bl-side\) var\(--log-w\);[^}]*"pilesO   benchO   prizesO  log"\s*"stad     activeO  actions  log"\s*"stad     activeMe actions  log"\s*"prizesMe benchMe  pilesMe  log";/.test(p);
  r.S3count = (p.match(/@media/g) || []).length;
  return r;
}

const CUR = normEol(readFileSync(join(ROOT, PAGE), 'utf8'));
const S = staticChecks(CUR);
console.log('【S】靜態');
ok('★★★ S1 <1024 區塊：Fable 後備不再套到新版桌墊、直排專用三段已移除、v6614 哨兵在區塊內（紀錄在右側欄、contain:size、不用浮層）', S.S1 === true, S.S1n);
ok('★★ S2 電腦版新版桌墊格線（四欄、區位）逐字不動', S.S2 === true);

// ── B：真瀏覽器 ──
async function browserChecks(buildDir) {
  const r = { ran: false };
  if (!existsSync(join(buildDir, '404.html'))) return r;
  const chromium = pwChromium('v6.614 窄螢幕新版桌墊');
  if (!chromium) return r;
  const browser = await pwLaunchWith(chromium, 'v6.614 窄螢幕新版桌墊');
  if (!browser) return r;
  r.ran = true;
  const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = join(buildDir, decodeURIComponent(u.pathname));
    if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) p = join(buildDir, '404.html');
    res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
  });
  await new Promise((rs) => srv.listen(0, rs));
  const port = srv.address().port;
  // 開一局 vs AI（雙方呆呆王預組、固定亂數），打到自己的主要階段（出現「跳過攻擊」）。紀錄不預設任何值 ⇒ 走站內預設（展開）
  async function openGame(vp, touch, layout = 'blue') {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
    await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
    await ctx.addInitScript((l) => { let x = 7; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; localStorage.setItem('ptcg_battle_layout', l); }, layout);
    const pg = await ctx.newPage();
    await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
    await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 }); await pg.click('.mode-card');
    const sels = pg.locator('main.lobby select');
    await sels.nth(0).selectOption('__preset_slowking__'); await sels.nth(1).selectOption('__preset_slowking__');
    const start = pg.locator('button.btn-primary', { hasText: '開始' }); await start.waitFor({ state: 'visible', timeout: 30000 });
    for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500);
    await start.click();
    await pg.waitForSelector('.hand-card.draggable', { timeout: 60000 }); await pg.waitForTimeout(1200);
    const z = await pg.locator('.my-active-zone').boundingBox(); const a = await pg.locator('.hand-card.draggable').first().boundingBox();
    if (z && a) { await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await pg.mouse.down(); await pg.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 - 10, { steps: 3 }); await pg.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(700); }
    await pg.mouse.move(5, 300);
    const sysBtn = pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成/ });
    let myTurn = false;
    for (let w = 0; w < 90 && !myTurn; w++) { myTurn = await pg.locator('button:visible', { hasText: '跳過攻擊' }).count() > 0; if (!myTurn) { if (await sysBtn.count()) await sysBtn.first().click().catch(() => {}); await pg.waitForTimeout(700); } }
    await pg.mouse.move(5, 5); await pg.waitForTimeout(2500);
    return { ctx, pg, myTurn };
  }
  const layoutIssues = (pg) => pg.evaluate(() => {
    const W = innerWidth, H = innerHeight, issues = [];
    const R = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); if (b.width === 0 && b.height === 0) return null; return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const de = document.documentElement;
    if (getComputedStyle(document.querySelector('.playmat')).display !== 'grid') issues.push('不是格線排版');
    if (de.scrollHeight > H + 1 || de.scrollWidth > W + 1) issues.push(`整頁 ${de.scrollWidth}×${de.scrollHeight}`);
    const Z = { 對手牌堆: '.opponent-row > .zone-pile', 對手備戰: '.opponent-row > .zone-bench', 對手獎賞: '.opponent-row > .zone-prizes', 對手戰鬥: '.opponent-row > .zone-active', 我方戰鬥: '.my-row > .zone-active', 行動: '.action-bar > .action-btns', 我方獎賞: '.my-row > .zone-prizes', 我方備戰: '.my-row > .zone-bench', 我方牌堆: '.my-row > .zone-pile', 手牌: '.hand-strip' };
    const B = {}; for (const [k, q] of Object.entries(Z)) { B[k] = R(q); if (!B[k]) { issues.push(k + ' 不存在'); continue; } const x = B[k]; if (x.l < -1 || x.t < -1 || x.r > W + 1 || x.b > H + 1) issues.push(k + ' 超出畫面'); }
    const ov = (a, b) => a && b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
    const ks = Object.keys(Z); for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) if (ov(B[ks[i]], B[ks[j]])) issues.push(`${ks[i]}×${ks[j]} 重疊`);
    if (B.對手備戰 && B.對手戰鬥 && B.我方戰鬥 && B.我方備戰 && B.手牌 && !(B.對手備戰.b <= B.對手戰鬥.t && B.對手戰鬥.b <= B.我方戰鬥.t && B.我方戰鬥.b <= B.我方備戰.t && B.我方備戰.b <= B.手牌.t)) issues.push('上下順序不是 對手備戰→對手戰鬥→我方戰鬥→我方備戰→手牌');
    const log = R('.action-bar > .log-col');
    const cw = document.querySelector('.my-row .zone-bench .bench-slot, .my-row .zone-bench .bench-empty');
    const btns = [...document.querySelectorAll('.action-bar > .action-btns > .btn-act, .action-bar > .action-btns > .atk-slot')].map((e) => e.getBoundingClientRect().height);
    if (btns.some((h) => h < 21.5)) issues.push('行動鈕太矮 ' + btns.map(Math.round).join('/'));
    return { issues, log, actions: B.行動, W, bench: cw ? cw.getBoundingClientRect().width : 0, collapsed: document.querySelector('.playmat').classList.contains('log-collapsed') };
  });
  try {
    const SIZES = [[704, 830], [673, 790], [860, 880], [744, 1059], [768, 1024], [810, 1010], [820, 1106], [834, 1120], [800, 1184], [912, 1300], [704, 704]];
    const b1 = {}; r.B1 = true;
    for (const [w, h] of [...SIZES.map((s) => [...s, true]), [1000, 920, false]]) {
      const g = await openGame({ width: w, height: h }, h > 920 || w < 1000);
      const m = g.myTurn ? await layoutIssues(g.pg) : null; const issues = m ? [...m.issues] : ['沒有打到自己的回合'];
      if (m) {
        if (m.collapsed) issues.push('紀錄預設不是展開');
        if (!m.log) issues.push('看不到紀錄欄');
        else if (!(m.actions && m.log.l >= m.actions.r - 1 && m.log.r >= m.W - 20)) issues.push('紀錄欄不在右側');
        if (m.bench < 38) issues.push('備戰格只有 ' + Math.round(m.bench));
      }
      b1[w + 'x' + h] = issues; if (issues.length) r.B1 = false;
      await g.ctx.close();
    }
    r.B1n = JSON.stringify(Object.fromEntries(Object.entries(b1).filter(([, v]) => v.length)));
    const b2 = {}; r.B2 = true;
    for (const [w, h] of [[704, 830], [820, 1106]]) {
      const g = await openGame({ width: w, height: h }, true);
      const before = g.myTurn ? await layoutIssues(g.pg) : null;
      let clicked = false;
      if (before) { clicked = await g.pg.locator('.log-toggle-btn').click({ timeout: 3000 }).then(() => true, () => false); await g.pg.waitForTimeout(600); }   // Rule 41：點不到（例如 BASE 隱藏收合鈕）⇒ 這一條紅，不整支丟例外
      const after = before ? await layoutIssues(g.pg) : null;
      const okk = !!(clicked && before && after && after.collapsed && !after.log && after.issues.length === 0 && after.bench > before.bench + 10);
      b2[w + 'x' + h] = { clicked, before: before && Math.round(before.bench), after: after && Math.round(after.bench), issues: after && after.issues, collapsed: after && after.collapsed };
      if (!okk) r.B2 = false; await g.ctx.close();
    }
    r.B2n = JSON.stringify(b2);
    { const g = await openGame({ width: 704, height: 830 }, false, 'fable');   // 滑鼠（舊 Fable 直排用觸控拖曳開局打不出第一張卡，v6.613 也一樣，與本版無關）
      const m = g.myTurn ? await g.pg.evaluate(() => ({ fable: !!document.querySelector('.playmat.layout-fable:not(.layout-blue)'), btns: getComputedStyle(document.querySelector('.action-bar > .action-btns')).display, bar: getComputedStyle(document.querySelector('.playmat > .action-bar')).display })) : null;
      r.B3 = !!(m && m.fable && m.btns === 'flex' && m.bar === 'flex'); r.B3n = JSON.stringify({ myTurn: g.myTurn, ...m }); await g.ctx.close(); }
    { const g = await openGame({ width: 1366, height: 768 }, false);
      const m = g.myTurn ? await g.pg.evaluate(() => getComputedStyle(document.querySelector('.playmat')).gridTemplateColumns) : null;
      // BASE（v6.613）在同一個環境實測：171px 735.578px 171px 245.875px 的形狀（四欄）；比對欄數與兩側欄寬（與字型無關）
      const cols = (m || '').split(' ').map(parseFloat);
      r.B4 = cols.length === 4 && Math.round(cols[0]) === 171 && Math.round(cols[2]) === 171 && Math.round(cols[3]) === 246; r.B4n = m;
      await g.ctx.close(); }
    // B5：8 格備戰（DOM 模擬；class 與 --bench-n 都是對戰頁實際使用的兩個開關）
    const bench8 = (pg) => pg.evaluate(async () => {
      for (const z of document.querySelectorAll('.opponent-row > .zone-bench, .my-row > .zone-bench')) {
        z.classList.add('bench-extended'); z.style.setProperty('--bench-n', '8');
        const kids = [...z.children].filter((c) => c.matches('.bench-slot, .bench-empty'));
        for (let i = kids.length; i < 8 && kids.length; i++) z.appendChild(kids[kids.length - 1].cloneNode(true));
      }
      await new Promise((r) => setTimeout(r, 300));
      const n = document.querySelectorAll('.my-row > .zone-bench > .bench-slot, .my-row > .zone-bench > .bench-empty').length;
      const clip = [];
      for (const q of ['.opponent-row > .zone-pile', '.my-row > .zone-pile', '.opponent-row > .zone-prizes', '.my-row > .zone-prizes', '.action-bar > .stadium-display', '.my-row > .zone-bench', '.opponent-row > .zone-bench']) {
        const z = document.querySelector(q); if (!z) continue; const zb = z.getBoundingClientRect();
        for (const c of z.querySelectorAll('img, .bench-slot, .bench-empty, .prize-card, .pile-slot')) { const b = c.getBoundingClientRect(); if (b.width < 2) continue; if (b.right > zb.right + 3 || b.bottom > zb.bottom + 3 || b.left < zb.left - 3 || b.top < zb.top - 3) { clip.push(q); break; } }
      }
      const w = document.querySelector('.my-row > .zone-bench > .bench-slot, .my-row > .zone-bench > .bench-empty');
      // 「對手牌堆」標題（::before，量字寬）右緣不可壓到先攻／後攻小標（複審 P2：左欄收到 100px 時重疊 12px）
      const zone = document.querySelector('.opponent-row > .zone-pile'); const chip = document.querySelector('.opponent-row > .turn-order-chip');
      let hdr = null;
      if (zone && chip) { const cs = getComputedStyle(zone, '::before'); const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const tw = c.measureText(cs.content.replace(/"/g, '')).width + 3 * (parseFloat(cs.letterSpacing) || 0);
        const tr = zone.getBoundingClientRect().left + parseFloat(cs.left) + 1 + tw; hdr = Math.round(tr - chip.getBoundingClientRect().left); }
      return { n, w: w ? w.getBoundingClientRect().width : 0, clip, hdr };
    });
    { const res = {}; r.B5 = true;
      for (const [w, h, min] of [[704, 830, 34], [912, 1300, 52]]) {
        const g = await openGame({ width: w, height: h }, true);
        const open = g.myTurn ? await bench8(g.pg) : null; const lo = open ? await layoutIssues(g.pg) : null;
        let closed = null, lc = null;
        if (open) { const c = await g.pg.locator('.log-toggle-btn').click({ timeout: 3000 }).then(() => true, () => false); await g.pg.waitForTimeout(600);
          if (c) { closed = await bench8(g.pg); lc = await layoutIssues(g.pg); } }
        const okk = !!(open && open.n === 8 && open.w >= min && lo && lo.issues.length === 0 && open.clip.length === 0 && open.hdr !== null && open.hdr <= 1 && closed && closed.clip.length === 0 && closed.hdr !== null && closed.hdr <= 1 && lc && lc.issues.length === 0);
        res[w + 'x' + h] = { min, open: open && { w: Math.round(open.w), clip: open.clip, hdr: open.hdr }, closed: closed && { w: Math.round(closed.w), clip: closed.clip, hdr: closed.hdr }, issues: [...(lo?.issues || []), ...(lc?.issues || [])] };
        if (!okk) r.B5 = false; await g.ctx.close();
      }
      r.B5n = JSON.stringify(res); }
    // B6：整頁鎖高 —— 704×704 行動欄注入到 8 顆（2～3 招＋跳過＋撤退＋競技場＋悔棋＋取消）仍是一個畫面
    { const g = await openGame({ width: 704, height: 704 }, true);
      const m = g.myTurn ? await g.pg.evaluate(async () => {
        const box = document.querySelector('.action-bar > .action-btns'); const slot = box.querySelector(':scope > .atk-slot'); const skip = box.querySelector(':scope > .btn-act.secondary');
        if (!slot || !skip) return null;
        const mk = (to, txt) => { const e = skip.cloneNode(true); e.classList.remove('secondary'); e.classList.add(to); e.textContent = txt; return e; };
        slot.after(slot.cloneNode(true)); slot.after(slot.cloneNode(true));
        skip.after(mk('btn-retreat-mirror', '🔄 撤退（1⚡）')); box.appendChild(mk('btn-undo', '↩ 悔棋')); box.appendChild(mk('btn-undo-cancel', '取消'));
        await new Promise((r) => setTimeout(r, 300));
        const hs = [...box.querySelectorAll(':scope > .btn-act, :scope > .atk-slot')].map((e) => e.getBoundingClientRect().height);
        return { n: hs.length, minH: Math.min(...hs), sh: document.documentElement.scrollHeight, H: innerHeight };
      }) : null;
      r.B6 = !!(m && m.n >= 8 && m.sh <= m.H + 1 && m.minH >= 21.5); r.B6n = JSON.stringify({ myTurn: g.myTurn, ...m }); await g.ctx.close(); }
  } finally { await browser.close(); srv.close(); }
  return r;
}
const BUILD = process.env.PTCG_V6614_BASE_BUILD || process.env.PTCG_ACCEPTANCE_BUILD || join(ROOT, 'build');
console.log('【B】真瀏覽器' + (process.env.PTCG_V6614_BASE_BUILD ? '（BASE build，預期 B1、B2 紅，B3、B4 綠）' : ''));
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const B = await browserChecks(BUILD);
  if (!B.ran) shallowSkip('B（沒有可用的 Chromium）');
  else {
    ok('★★★ B1 摺疊機／直立平板 11 種尺寸＋1000×920：格線排版、一個畫面、互不重疊、上下順序同電腦版、紀錄預設展開且在右側、備戰格 ≥38px、行動鈕 ≥22px', B.B1 === true, B.B1n);
    ok('★★ B2 點收合鈕：紀錄收起、備戰卡變大、仍是一個畫面（704×830、820×1106）', B.B2 === true, B.B2n);
    ok('★★ B3 舊 Fable 版 704×830 仍是原本的直排（零回歸）', B.B3 === true, B.B3n);
    ok('★★ B4 1366×768 電腦版新版桌墊格線欄寬不變（零回歸）', B.B4 === true, B.B4n);
    ok('★★★ B5 8 格備戰：紀錄展開時備戰格不小於 v6.613（704×830 ≥34、912×1300 ≥52）、展開／收合都不凸出框外且一個畫面、牌堆標題不被先攻小標蓋住', B.B5 === true, B.B5n);
    ok('★★ B6 整頁鎖高：704×704 行動欄 8 顆仍是一個畫面、每顆 ≥21.5px', B.B6 === true, B.B6n);
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const bp = readBaseBlob(ROOT, BASE_SHA, PAGE);
  const bS = bp.ok ? staticChecks(normEol(bp.out)) : {};
  ok('★★★ HEAD-FAIL：BASE（v6.613）上 S1 紅、S2 綠', bS.S1 !== true && bS.S2 === true, JSON.stringify({ S1: bS.S1, S2: bS.S2 }));
  ok('★ S3 本版沒有新增媒體查詢（數量與 BASE 相同）', S.S3count === bS.S3count, `${S.S3count} vs ${bS.S3count}`);
}

console.log(`\n=== v6.614 窄螢幕新版桌墊改用電腦版排列：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
