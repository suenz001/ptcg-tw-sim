#!/usr/bin/env node
/**
 * v6.613 守衛：直排（直向平板、摺疊機展開）時行動鈕不再擠在一起
 *
 * 站長 2026-10-30 轉述玩家回報（附截圖）：行動欄的「招式／跳過攻擊／撤退」按鈕太擠，很容易誤按。
 *   實測（e53bec74，772×1533 觸控、新版桌墊 <1024 直排）：按鈕 27px 高、間距 3px、寬度 117／96／97px 各不相同，
 *   招式鈕右上角的 🔍 放大鏡往下延伸到「跳過攻擊」上方的縫裡。寬 ≥1024 的固定槽位沒有這個問題。
 *
 * 【S】靜態：新規則只寫在既有的 max-width:1023px 區塊裡（不新增媒體查詢）；≥1024 的固定槽位列高一個字都不動
 * 【B】真瀏覽器（build/）：
 *      B1 772×1533、704×830、860×880 觸控直排（自然開局 3 顆）：同寬、招式／跳過攻擊 38px、其他 32px（空間夠時長到最大）、
 *         相鄰間距 ≥6px、招式→跳過攻擊 ≥12px、🔍 不壓到跳過攻擊、整頁仍是一個畫面
 *      B2 1366×768 電腦版：仍是 grid 固定槽位、按鈕裝得進槽位（≤30px）、招式與跳過攻擊上緣距離 109px 不變（零回歸；
 *         109＝3×34＋3×3−(34−h)/2＋(30−h)/2，按鈕高 h 互相抵消，與字型無關，審查 P2-3）
 *      B3 Fable 版（非新版桌墊）704×830 直排：本版不套用，招式名稱仍看得到（審查 P1：滿寬後名稱被擠成 0 寬）
 *      B4 站長 2026-10-31「寧可按鈕小一點，保證不捲動」：704×830 觸控直排用 DOM 複製注入到 6、8 顆
 *         （2～3 招＋跳過＋撤退＋競技場＋悔棋＋取消）：整頁仍是一個畫面、每顆 ≥21.5px、招式與跳過攻擊不比其他按鈕矮、不壓到我方場地
 *      B5 704×704（連最小高度都放不下的極矮視窗）注入 8 顆：按鈕不可疊到我方場地（寧可整頁捲動，不可誤按）
 * 【H】HEAD-FAIL：BASE（v6.612）上 S1 紅。B 的 HEAD-FAIL 用 PTCG_V6613_BASE_BUILD 指到 BASE 的 build/ 另跑（B1 逐尺寸紅、B2 綠），
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
const BASE_SHA = 'e53bec74';
const PAGE = 'src/routes/game/+page.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 900) : '')); } };

// 找出「@media (max-width: 1023px){ … }」整個區塊（大括號配對；註解已剝成空白，不會干擾配對）
function mediaBlocks(css, head) {
  const out = []; let i = 0;
  while ((i = css.indexOf(head, i)) >= 0) {
    const open = css.indexOf('{', i); let d = 0, j = open;
    for (; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}') { d--; if (d === 0) break; } }
    out.push({ start: i, end: j + 1, body: css.slice(open + 1, j) }); i = j + 1;
  }
  return out;
}
const decl = (body, sel) => { const k = body.indexOf(sel + '{'); if (k < 0) return null; return body.slice(k + sel.length + 1, body.indexOf('}', k)); };

function staticChecks(src) {
  const r = {};
  const p = stripCommentsBlank(src);
  const blocks = mediaBlocks(p, '@media (max-width: 1023px)');
  const sentinel = src.indexOf('/* >>> v6613-action-btns-spacing */');
  const inBlock = blocks.find((b) => sentinel > b.start && sentinel < b.end);
  // 只看哨兵之間那一段（剝註解是「換成等長空白」，位置不變）——同區塊前面還有別條同選擇器的規則
  const sEnd = src.indexOf('/* <<< v6613-action-btns-spacing */');
  const body = inBlock && sEnd > sentinel && sEnd < inBlock.end ? p.slice(sentinel, sEnd) : '';
  const A = '.playmat.layout-blue.layout-fable .action-bar > .action-btns';
  const box = decl(body, A) || '';
  const btn = decl(body, `${A} > .btn-act,\n    ${A} > .atk-slot`) || '';
  const big = decl(body, `${A} > .btn-act.secondary,\n    ${A} > .btn-act.primary,\n    ${A} > .atk-slot`) || '';
  const sep = decl(body, `${A} > .atk-slot + .btn-act.secondary,\n    ${A} > .btn-act.atk-overflow + .btn-act.secondary`) || '';
  // ⚠ 每條選擇器都必須限定 .layout-blue（Fable 版直排不套，審查 P1）
  const sels = (body.match(/[^{}]+(?=\{)/g) || []).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
  const allBlue = sels.length >= 7 && sels.every((x) => x.startsWith('.playmat.layout-blue.layout-fable '));
  r.S1 = !!inBlock && allBlue && /gap:6px/.test(box) && /flex-wrap:nowrap/.test(box) && /align-items:stretch/.test(box) && !/contain:size/.test(body)
    && /flex:1 1 0/.test(btn) && /min-height:22px/.test(btn) && /max-height:32px/.test(btn) && /max-height:38px/.test(big) && /flex-grow:4/.test(big) && /margin-top:6px/.test(sep);
  r.S1n = JSON.stringify({ inBlock: !!inBlock, allBlue, n: sels.length, box, btn, big, sep });
  // S2 ≥1024 固定槽位列高不動（媒體查詢之外的兩條原規則逐字仍在）
  r.S2 = /\.playmat\.layout-fable \.action-bar > \.action-btns\{\s*grid-area:actions;[^}]*grid-template-rows:38px 38px 38px 34px 34px;[^}]*gap:3px;/.test(p)
    && /\.playmat\.layout-blue \.action-bar > \.action-btns\{ grid-template-rows:34px 34px 34px 30px 30px; grid-auto-rows:30px; \}/.test(p);
  // S3 媒體查詢數量不變（本頁數量被多支守衛釘住）：本版沒有新增任何 @media
  r.S3count = (p.match(/@media/g) || []).length;
  return r;
}

const CUR = normEol(readFileSync(join(ROOT, PAGE), 'utf8'));
const S = staticChecks(CUR);
console.log('【S】靜態');
ok('★★★ S1 直排規則寫在既有 max-width:1023px 區塊內、只限新版桌墊：不換欄、間距 6px、滿寬、可收縮（最小 22、最大 38／32、重要鈕優先）、跳過攻擊前多空 6px、不用 contain:size', S.S1 === true, S.S1n);
ok('★★ S2 寬 ≥1024 的固定槽位（Fable 38/38/38/34/34、新版桌墊 34/34/34/30/30、gap 3px）逐字不動', S.S2 === true);

// ── B：真瀏覽器 ──
async function browserChecks(buildDir) {
  const r = { ran: false };
  if (!existsSync(join(buildDir, '404.html'))) return r;
  const chromium = pwChromium('v6.613 行動鈕');
  if (!chromium) return r;
  const browser = await pwLaunchWith(chromium, 'v6.613 行動鈕');
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
  // 開一局 vs AI（雙方呆呆王預組、固定亂數），打到自己的主要階段（出現「跳過攻擊」）
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
    await pg.waitForTimeout(600);
    return { ctx, pg, myTurn };
  }
  const measure = (pg) => pg.evaluate(() => {
    const box = document.querySelector('.action-bar > .action-btns'); if (!box) return null;
    const R = (e) => { const b = e.getBoundingClientRect(); return { t: (e.textContent || '').trim().slice(0, 10), big: e.matches('.secondary, .primary, .atk'), l: b.left, r: b.right, top: b.top, b: b.bottom, h: b.height, w: b.width }; };
    const btns = [...box.querySelectorAll(':scope > .btn-act, :scope > .atk-slot > .btn-act')].filter((e) => e.offsetParent).map(R).sort((x, y) => x.top - y.top);
    const zoom = [...box.querySelectorAll(':scope > .atk-slot > .dmg-est-toggle')].filter((e) => e.offsetParent).map(R);
    const atkCount = box.querySelectorAll(':scope > .atk-slot').length;
    return { disp: getComputedStyle(box).display, btns, zoom, atkCount, sh: document.documentElement.scrollHeight, H: innerHeight };
  });
  try {
    const b1 = {}; r.B1 = true;
    for (const vp of [{ width: 772, height: 1533 }, { width: 704, height: 830 }, { width: 860, height: 880 }]) {
      const g = await openGame(vp, true); const m = g.myTurn ? await measure(g.pg) : null; const issues = [];
      if (!g.myTurn || !m) issues.push('沒有打到自己的回合');
      else {
        const { btns, zoom, atkCount } = m;
        if (m.disp !== 'flex') issues.push('不是直排（' + m.disp + '）');
        if (btns.length < 3 || atkCount < 1) issues.push('按鈕太少 ' + btns.length);
        for (const x of btns) if (x.h < (x.big ? 37.5 : 31.5)) issues.push(`${x.t} 只有 ${x.h}px 高`);
        for (const x of btns) if (x.h > (x.big ? 38.5 : 32.5)) issues.push(`${x.t} 長到 ${x.h}px（超過上限）`);
        const ws = btns.map((x) => Math.round(x.w)); if (Math.max(...ws) - Math.min(...ws) > 1) issues.push('寬度不一致 ' + ws.join('/'));
        for (let i = 1; i < btns.length; i++) { const gap = btns[i].top - btns[i - 1].b; if (gap < 5.5) issues.push(`${btns[i - 1].t}→${btns[i].t} 只隔 ${gap}px`); }
        const skip = btns.find((x) => x.t.startsWith('跳過攻擊')); const lastAtk = btns.filter((x) => skip && x.top < skip.top).pop();
        if (!skip || !lastAtk) issues.push('找不到招式／跳過攻擊');
        else {
          if (skip.top - lastAtk.b < 11.5) issues.push(`招式→跳過攻擊只隔 ${skip.top - lastAtk.b}px`);
          for (const zz of zoom) if (Math.min(zz.r, skip.r) - Math.max(zz.l, skip.l) > 0 && Math.min(zz.b, skip.b) - Math.max(zz.top, skip.top) > -3) issues.push('🔍 壓到或貼著跳過攻擊');
        }
        if (m.sh > m.H + 1) issues.push(`整頁 ${m.sh} 比視窗 ${m.H} 高`);
      }
      b1[vp.width + 'x' + vp.height] = issues; if (issues.length) r.B1 = false;
      await g.ctx.close();
    }
    r.B1n = JSON.stringify(b1);
    { const g = await openGame({ width: 1366, height: 768 }, false); const m = g.myTurn ? await measure(g.pg) : null;
      const skip = m && m.btns.find((x) => x.t.startsWith('跳過攻擊')); const atk = m && m.btns[0];
      // BASE（v6.612）實測：grid、兩者上緣相距 109px（按鈕高度在公式裡抵消，只要 ≤30 裝得進槽位）
      r.B2 = !!(m && m.disp === 'grid' && skip && atk && atk.h <= 30.5 && skip.h <= 30.5 && Math.round(skip.top - atk.top) === 109);
      r.B2n = JSON.stringify(m && { disp: m.disp, atkH: atk?.h, skipH: skip?.h, d: skip && atk ? skip.top - atk.top : null });
      await g.ctx.close(); }
    { const g = await openGame({ width: 704, height: 830 }, false, 'fable');
      const m = g.myTurn ? await g.pg.evaluate(() => { const n = document.querySelector('.playmat.layout-fable:not(.layout-blue) .action-btns .atk-slot .atk-name'); const box = document.querySelector('.action-bar > .action-btns'); return n && { cw: n.clientWidth, sw: n.scrollWidth, gap: getComputedStyle(box).rowGap }; }) : null;
      r.B3 = !!(m && m.cw >= 40 && m.gap === '3px'); r.B3n = JSON.stringify({ myTurn: g.myTurn, ...m });
      await g.ctx.close(); }
    // 注入：在自然開局（1 招＋跳過＋競技場）上複製出更多按鈕（只量版面，不觸發邏輯）
    const inject = (pg, target) => pg.evaluate(async (target) => {
      const box = document.querySelector('.action-bar > .action-btns'); const slot = box.querySelector(':scope > .atk-slot'); const skip = box.querySelector(':scope > .btn-act.secondary');
      if (!slot || !skip || !box.querySelector(':scope > .stadium-btn')) return null;
      const mk = (src, from, to, txt) => { const e = src.cloneNode(true); e.classList.remove(from); e.classList.add(to); e.textContent = txt; return e; };
      slot.after(slot.cloneNode(true));                                            // 第 2 招
      skip.after(mk(skip, 'secondary', 'btn-retreat-mirror', '🔄 撤退（1⚡）'));
      box.appendChild(mk(skip, 'secondary', 'btn-undo', '↩ 悔棋'));               // 6 顆
      if (target >= 8) { slot.after(slot.cloneNode(true)); box.appendChild(mk(skip, 'secondary', 'btn-undo-cancel', '取消')); }
      await new Promise((r) => setTimeout(r, 150));
      const R = (e) => e.getBoundingClientRect();
      const items = [...box.querySelectorAll(':scope > .btn-act, :scope > .atk-slot')].map((e) => ({ big: e.matches('.atk-slot, .secondary, .primary'), h: R(e).height, b: R(e).bottom }));
      return { n: items.length, minH: Math.min(...items.map((x) => x.h)), bigMin: Math.min(...items.filter((x) => x.big).map((x) => x.h)), smallMax: Math.max(...items.filter((x) => !x.big).map((x) => x.h)),
        bottom: Math.max(...items.map((x) => x.b)), myTop: R(document.querySelector('.my-row')).top, sh: document.documentElement.scrollHeight, H: innerHeight };
    }, target);
    { const res = {}; r.B4 = true;
      for (const target of [6, 8]) {
        const g = await openGame({ width: 704, height: 830 }, true); const m = g.myTurn ? await inject(g.pg, target) : null; res[target] = { myTurn: g.myTurn, ...m };
        if (!(m && m.n === target && m.sh <= m.H + 1 && m.minH >= 21.5 && m.bigMin >= m.smallMax - 0.5 && m.bottom <= m.myTop)) r.B4 = false;
        await g.ctx.close();
      }
      r.B4n = JSON.stringify(res); }
    { const g = await openGame({ width: 704, height: 704 }, true); const m = g.myTurn ? await inject(g.pg, 8) : null;
      r.B5 = !!(m && m.n === 8 && m.bottom <= m.myTop); r.B5n = JSON.stringify({ myTurn: g.myTurn, ...m });
      await g.ctx.close(); }
  } finally { await browser.close(); srv.close(); }
  return r;
}
const BUILD = process.env.PTCG_V6613_BASE_BUILD || process.env.PTCG_ACCEPTANCE_BUILD || join(ROOT, 'build');
console.log('【B】真瀏覽器' + (process.env.PTCG_V6613_BASE_BUILD ? '（BASE build，預期 B1 紅、B2 綠）' : ''));
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const B = await browserChecks(BUILD);
  if (!B.ran) shallowSkip('B（沒有可用的 Chromium）');
  else {
    ok('★★★ B1 觸控直排 772×1533／704×830／860×880（自然開局）：同寬、招式／跳過 38px、其他 32px、間距 ≥6px、招式→跳過攻擊 ≥12px、🔍 不貼著跳過攻擊、整頁一個畫面', B.B1 === true, B.B1n);
    ok('★★ B2 1366×768 電腦版固定槽位零回歸（grid、按鈕 ≤30px、招式→跳過攻擊上緣 109px）', B.B2 === true, B.B2n);
    ok('★★★ B3 Fable 版 704×830 直排不套用（間距仍 3px）、招式名稱看得到（≥40px 寬）', B.B3 === true, B.B3n);
    ok('★★★ B4 704×830 觸控直排 6、8 顆：整頁一個畫面、每顆 ≥21.5px、招式／跳過攻擊不比其他矮、不壓到我方場地（站長：保證不捲動）', B.B4 === true, B.B4n);
    ok('★★ B5 704×704 注入 8 顆：按鈕不疊到我方場地（放不下時整頁捲動，不可誤按）', B.B5 === true, B.B5n);
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const bp = readBaseBlob(ROOT, BASE_SHA, PAGE);
  const bS = bp.ok ? staticChecks(normEol(bp.out)) : {};
  ok('★★★ HEAD-FAIL：BASE（v6.612）上 S1 紅、S2 綠（固定槽位本來就在）', bS.S1 !== true && bS.S2 === true, JSON.stringify({ S1: bS.S1, S2: bS.S2 }));
  ok('★ S3 本版沒有新增媒體查詢（數量與 BASE 相同）', S.S3count === bS.S3count, `${S.S3count} vs ${bS.S3count}`);
}

console.log(`\n=== v6.613 直排行動鈕間距：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
