#!/usr/bin/env node
/**
 * v6.470 守衛：Fable 版（battleLayout === 'fable'，不含新版桌墊）在 iPad 與 12～17 吋筆電上的版面（站長核准：比照 v6.466）
 *
 * 實測（Playwright 固定亂數種子開一局，28 種視窗）找到三個問題：
 *   ① 頁首與新版桌墊共用（一整排不換行、總寬約 1250px）⇒ 視窗 <1250 時「填能／支援者／撤退」被切掉，直向 iPad 連設定／全螢幕都在畫面外。
 *   ② 矮視窗（1366×768 筆電＝657 高、1280×720＠150%＝632 高、iPad mini 橫向 Safari）中場兩列各只剩約 110～116px，
 *      牌庫＋棄牌疊起來 143px、獎賞（標題＋3 列卡）139px ⇒ 對手棄牌蓋到我方「獎賞 6張」、我方牌庫蓋到對手獎賞（最多 21px）。
 *   ③ <1024 後備直排（直向 iPad）：行動列沿用基礎樣式 height:180px，裝不下「行動鈕＋滿寬紀錄」⇒ 紀錄長了以後蓋到我方場地（iPad mini 直向最明顯；iPad 11 直向只剩幾 px 餘裕）。
 *
 * 判準
 *   【S】原始碼（標 ★HEAD-FAIL 的餵 BASE＝v6.469 必須不成立）＋ @media 數量不增加
 *   【E】真瀏覽器（需要 build/ 與 Chromium，否則 ENV-SKIP）：Fable 版開一局，10 種視窗
 *     E1 頁首不用橫向捲動；設定／全螢幕／本回合資源都在畫面內
 *     E2 手牌張數沒有被截斷
 *     E3 沒有捲軸；主要區塊都在畫面內、互不重疊（含牌堆 × 獎賞）；E3b 直向後備、紀錄撐滿 220px 時也不重疊
 *     E6 直向後備的牌堆／獎賞計算樣式與 v6.469 相同（72px、置中、卡寬 0.4／卡高 0.56 卡寬）
 *     E7 寬裕視窗（1920×970）牌堆圖示照常顯示、獎賞卡維持原尺寸（只有放不下時才收）
 *     EM 自驗突變：拿掉頁首容器 ⇒ E1 紅；拿掉側欄調整 ⇒ 1366×657 的 E3 紅；行動列回 180px ⇒ 直向 E3 紅
 *   （備戰卡比備戰區高 4px：備戰格內距 2px×2 的 content-box 差，Fable 版備戰區沒有框線、看不到，刻意不動。）
 *
 * Run: node scripts/test-v6470-fable-ipad-layouts.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { cssOf } from './lib/svelte-style-block.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.469 守衛補強那一顆
const BASE_SHA = '4e1d2429';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const blk = (src, name) => { const m = new RegExp('/\\* >>> ' + name + ' \\*/([\\s\\S]*?)/\\* <<< ' + name + ' \\*/').exec(src); return m ? stripCss(m[1]) : ''; };
/** 去掉 @container 區段後的頂層規則 [{sels, body}] */
function rulesOf(css) {
  const out = []; const flat = css.replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ sels: m[1].split(',').map((s) => s.trim()).filter(Boolean), body: m[2] });
  return out;
}
const CHECKS = [
  ['★★★[S1] Fable 版頁首也是具名容器 blhdr（選擇器 .battle-root:has(.playmat.layout-fable) .battle-header）；回合文字可縮、手牌張數幾乎不縮', true, (src) => {
    const r = rulesOf(blk(src, 'v6470-fable-ipad'));
    const decl = r.filter((x) => /container\s*:\s*blhdr\s*\/\s*inline-size/.test(x.body));
    return decl.length === 1 && decl[0].sels.length === 1 && decl[0].sels[0] === '.battle-root:has(.playmat.layout-fable) .battle-header'
      && r.some((x) => x.sels[0] === '.battle-root:has(.playmat.layout-fable) .battle-header > .turn-info' && /min-width:0/.test(x.body) && /text-overflow:ellipsis/.test(x.body))
      && r.some((x) => x.sels[0] === '.battle-root:has(.playmat.layout-fable) .battle-header > .hand-counts' && /flex:0 \.05 auto/.test(x.body))
      && r.every((x) => x.sels.every((s) => s.startsWith('.battle-root:has(.playmat.layout-fable) .battle-header')));
  }],
  ['★★★[S2] 矮視窗側欄：牌堆欄是尺寸容器 flpile、矮於 150px 才收圖示；獎賞卡高＝min(0.56 卡寬, (容器高−12)/3)；全部只作用在 Fable 版（:not(.layout-blue)）', true, (src) => {
    const b = blk(src, 'v6470-fable-side'); const r = rulesOf(b);
    return r.length >= 4 && r.every((x) => x.sels.every((s) => s.startsWith('.playmat.layout-fable:not(.layout-blue) ')))
      && /container:flpile \/ size/.test(b) && /@container flpile \(max-height: 150px\)\{ \.pile-slot \.pile-icon\{ display:none; \} \}/.test(b)
      && /container:flprize \/ size/.test(b) && /height:min\(calc\(var\(--card-w\) \* 0\.56\), calc\(\(100cqh - 12px\) \/ 3\)\)/.test(b);
  }],
  ['★★★[S3] <1024 後備：行動列高度跟內容走；側欄調整全部還原成 v6.469 的值（72px、置中、0.4／0.56 卡寬）', true, (src) => {
    const b = blk(src, 'v6470-fable-fallback');
    return /\.playmat\.layout-fable > \.action-bar\{ height:auto; \}/.test(b)
      && /\.zone-pile\{ align-self:center; justify-content:normal; container:none; width:72px; \}/.test(b)
      && /\.zone-prizes\{ align-self:center; justify-content:normal; \}/.test(b)
      && /\.prize-card\{ width:calc\(var\(--card-w\) \* 0\.4\); height:calc\(var\(--card-w\) \* 0\.56\); \}/.test(b);
  }],
  ['★★[S3b] 後備區塊確實在 (max-width: 1023px) 媒體查詢裡面（位置正確）', true, (src) => {
    const i = src.indexOf('/* >>> v6470-fable-fallback */'); const j = src.lastIndexOf('@media (max-width: 1023px){', i);
    return i > 0 && j > 0 && j > src.lastIndexOf('/* <<< v6470-fable-side */', i) && src.slice(j, i).split('{').length - src.slice(j, i).split('}').length > 0;
  }],
];
const runAll = (src) => CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; });
console.log('【S】原始碼');
for (const c of runAll(SRC)) ok(c.name, c.r);
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6470 S：HEAD-FAIL 比對', '需要 v6.469 commit');
else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 v6.469 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    const base = r.out.replace(/\r\n/g, '\n');
    const wrong = runAll(base).filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.469 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
    const nMedia = (s) => (stripCss(cssOf(s, REL)).match(/@media/g) || []).length;
    ok('★★[S4] 本頁 @media 數量沒有增加（改用 @container）', nMedia(SRC) === nMedia(base), `${nMedia(base)} → ${nMedia(SRC)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【E】真瀏覽器：Fable 版固定種子開一局，量 10 種視窗');
const VPS = [
  ['iPad Pro 13 橫（Safari）', 1376, 958], ['iPad Pro 11 橫（Safari）', 1194, 760], ['iPad 10.5 橫（Safari）', 1112, 760],
  ['iPad mini 橫（Safari）', 1133, 670], ['iPad Pro 13 直（Safari）', 1032, 1302], ['iPad Pro 11 直（Safari）', 834, 1120],
  ['iPad mini 直（Safari）', 744, 1059], ['13 吋 1920×1080＠150%', 1280, 632], ['15.6 吋 1366×768', 1366, 657], ['17 吋 1920×1080', 1920, 970],
];
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.470 Fable 版 iPad／筆電') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.470 Fable 版 iPad／筆電');
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
    try {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 1024 } });
      // 卡圖一律回假圖（不連外網）；固定亂數種子 ⇒ 每次都是同一局
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
      await ctx.addInitScript(() => {
        let x = 7; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
        localStorage.setItem('ptcg_battle_layout', 'fable');
      });
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
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
      ok('[E 前提] 開局成功、輪到玩家 1（頁首有本回合資源）', myTurn);
      if (myTurn) {
        await pg.addStyleTag({ content: '.selection-overlay,.modal-overlay{display:none!important}' });
        const measure = () => pg.evaluate(() => {
          const W = innerWidth, H = innerHeight, de = document.documentElement, issues = { e1: [], e2: [], e3: [], e4: [] };
          const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
          const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
          const name = (el) => el.className.replace(/svelte-\w+/g, '').trim().split(/\s+/)[0];
          const inView = (r) => r.l >= -1 && r.t >= -1 && r.r <= W + 1 && r.b <= H + 1;
          const hd = document.querySelector('.battle-header');
          if (hd.scrollWidth > hd.clientWidth + 1) issues.e1.push(`頁首要橫向捲動 ${hd.scrollWidth}>${hd.clientWidth}`);
          for (const el of document.querySelectorAll('.battle-header .settings-chip, .battle-header .fs-chip, .battle-header .res-item')) {
            if (!vis(el)) { issues.e1.push(name(el) + ' 不見了'); continue; } if (!inView(R(el))) issues.e1.push(name(el) + ' 在畫面外 ' + JSON.stringify(R(el)));
          }
          if (!document.querySelector('.battle-header .res-item')) issues.e1.push('沒有本回合資源');
          for (const el of document.querySelectorAll('.battle-header .hand-count-chip')) if (el.scrollWidth > el.clientWidth + 1) issues.e2.push('手牌張數被截斷「' + el.textContent.trim() + '」');
          if (de.scrollWidth > W + 1 || de.scrollHeight > H + 1) issues.e3.push(`頁面有捲軸 ${de.scrollWidth}×${de.scrollHeight}`);
          const zones = [...document.querySelectorAll('.zone-pile, .zone-bench, .zone-active, .zone-prizes, .hand-strip, .log-col, .action-btns, .battle-header')].filter(vis);
          for (const z of zones) if (!inView(R(z))) issues.e3.push(name(z) + ' 在畫面外');
          for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
            const a = R(zones[i]), b = R(zones[j]); const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
            if (ox > 2 && oy > 2) issues.e3.push(`${name(zones[i])} × ${name(zones[j])} 重疊 ${ox | 0}×${oy | 0}`);
          }
          const tb = document.querySelector('.log-toggle-btn'), lc = document.querySelector('.log-col');
          if (tb && lc && vis(tb) && vis(lc)) { const a = R(tb), b = R(lc); if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1) issues.e4.push('📜 收合鈕壓在紀錄欄上'); }
          return issues;
        });
        const all = { e1: [], e2: [], e3: [], e4: [] };
        for (const [nm, w, h] of VPS) {
          await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(500);
          const m = await measure();
          for (const k of Object.keys(all)) for (const x of m[k]) all[k].push(`${nm} ${w}×${h}：${x}`);
        }
        ok('★★★[E1] 頁首不用橫向捲動；設定／全螢幕／本回合資源都在畫面內（10 種視窗）', all.e1.length === 0, all.e1.slice(0, 6).join(' ｜ '));
        ok('★★[E2] 手牌張數沒有被截斷', all.e2.length === 0, all.e2.slice(0, 6).join(' ｜ '));
        ok('★★★[E3] 沒有捲軸；主要區塊都在畫面內、互不重疊（含牌堆 × 獎賞）', all.e3.length === 0, all.e3.slice(0, 6).join(' ｜ '));
        // E6：直向後備的計算樣式與 v6.469 相同
        await pg.setViewportSize({ width: 834, height: 1120 }); await pg.waitForTimeout(500);
        const fb = await pg.evaluate(() => {
          const g = (s) => getComputedStyle(document.querySelector(s));
          const cw = parseFloat(getComputedStyle(document.querySelector('.playmat')).getPropertyValue('--card-w')) || null;
          const pz = g('.opponent-row > .zone-pile'), pr = g('.my-row > .zone-prizes'), pg2 = g('.my-row > .zone-prizes > .prize-grid'), pc = document.querySelector('.my-row .prize-card');
          const pcs = getComputedStyle(pc);
          return { pileW: pz.width, pileAlign: pz.alignSelf, pileCt: pz.containerType, pileCn: pz.containerName, prAlign: pr.alignSelf, gridCt: pg2.containerType, gridCn: pg2.containerName, gridFlex: pg2.flex, pcW: parseFloat(pcs.width), pcH: parseFloat(pcs.height), cw };
        });
        ok('★★[E6] 直向後備：牌堆 72px／置中、獎賞置中、不是容器（與 v6.469 相同）', fb.pileW === '72px' && fb.pileAlign === 'center' && fb.pileCt === 'normal' && fb.pileCn === 'none' && fb.prAlign === 'center' && fb.gridCt === 'normal' && fb.gridCn === 'none' && fb.gridFlex === '0 1 auto', JSON.stringify(fb));
        ok('★★[E6b] 直向後備：獎賞卡寬高比＝0.4：0.56（沒有被容器公式縮）', Math.abs(fb.pcH / fb.pcW - 1.4) < 0.02, JSON.stringify(fb));
        // E7：寬裕視窗不收圖示、獎賞卡維持 0.4／0.56 比例且未被縮小
        await pg.setViewportSize({ width: 1920, height: 970 }); await pg.waitForTimeout(500);
        const big = await pg.evaluate(() => {
          const ic = document.querySelector('.opponent-row .pile-icon'); const pc = document.querySelector('.my-row .prize-card'); const bs = document.querySelector('.playmat');
          const cwPx = (() => { const t = document.createElement('div'); t.style.width = 'var(--card-w)'; bs.appendChild(t); const w = t.getBoundingClientRect().width; t.remove(); return w; })();
          return { icon: getComputedStyle(ic).display, pcH: parseFloat(getComputedStyle(pc).height), want: cwPx * 0.56 };
        });
        ok('★★[E7] 1920×970：牌堆圖示照常顯示、獎賞卡高＝0.56 卡寬（放得下就不縮）', big.icon !== 'none' && Math.abs(big.pcH - big.want) < 0.6, JSON.stringify(big));
        // 自驗突變 1：拿掉頁首容器 ⇒ iPad 10.5 橫向 E1 必須紅
        await pg.setViewportSize({ width: 1112, height: 760 });
        let tag = await pg.addStyleTag({ content: '.battle-header{ container-type:normal !important; } .battle-header > *{ flex-shrink:0 !important; }' });
        await pg.waitForTimeout(500);
        const m1 = await measure();
        ok('★★[EM1] 自驗：頁首回到 v6.469 的 Fable 行為後，E1 真的會紅', m1.e1.length > 0, JSON.stringify(m1.e1.slice(0, 2)));
        await tag.evaluate((n) => n.remove());
        // 自驗突變 2：拿掉側欄調整 ⇒ 1366×657 的 E3 必須紅（牌堆 × 獎賞重疊）
        await pg.setViewportSize({ width: 1366, height: 657 });
        tag = await pg.addStyleTag({ content: '.playmat.layout-fable .field-row > .zone-pile, .playmat.layout-fable .field-row > .zone-prizes{ align-self:center !important; container-type:normal !important; } .playmat.layout-fable .field-row > .zone-pile{ width:72px !important; } .playmat.layout-fable .pile-icon{ display:block !important; } .playmat.layout-fable .zone-prizes > .prize-grid{ flex:0 1 auto !important; container-type:normal !important; } .playmat.layout-fable .zone-prizes .prize-card{ width:calc(var(--card-w) * 0.4) !important; height:calc(var(--card-w) * 0.56) !important; }' });
        await pg.waitForTimeout(500);
        const m2 = await measure();
        ok('★★[EM2] 自驗：側欄回到 v6.469 行為後，1366×657 的 E3 真的會紅', m2.e3.some((x) => /zone-pile|zone-prizes/.test(x)), JSON.stringify(m2.e3.slice(0, 3)));
        await tag.evaluate((n) => n.remove());
        // E3b：直向後備、紀錄已經很長（紀錄欄撐到上限 220px，對局中後段的常態）仍不蓋到我方場地
        //   （開局這一刻紀錄還短，行動列 180px 也裝得下 ⇒ 必須把紀錄撐滿才量得到 v6.469 的問題）
        // ⚠ 用 iPad mini 直向 744×1059：834×1120 時行動列在 grid 列內置中、還有 3～6px 餘裕（Fable 審查實測），量不出 v6.469 的問題
        await pg.setViewportSize({ width: 744, height: 1059 });
        const LOGFULL = '.playmat.layout-fable .action-bar > .log-col{ height:220px !important; }';
        tag = await pg.addStyleTag({ content: LOGFULL });
        await pg.waitForTimeout(500);
        const m3a = await measure();
        ok('★★★[E3b] 直向後備、紀錄撐滿 220px：主要區塊互不重疊（紀錄不蓋我方場地）', m3a.e3.length === 0, JSON.stringify(m3a.e3.slice(0, 3)));
        await tag.evaluate((n) => n.remove());
        // 自驗突變 3：同樣紀錄撐滿，行動列回 180px（v6.469 行為）⇒ E3 必須紅
        tag = await pg.addStyleTag({ content: LOGFULL + ' .playmat.layout-fable > .action-bar{ height:180px !important; }' });
        await pg.waitForTimeout(500);
        const m3 = await measure();
        const ovf = await pg.evaluate(() => { const a = document.querySelector('.playmat > .action-bar'); return a.scrollHeight - a.clientHeight; });
        ok('★★[EM3] 自驗：紀錄撐滿＋行動列回到 180px 時，直向 E3 真的會紅（且行動列確實溢出）', m3.e3.some((x) => /log-col/.test(x)) && ovf > 0, JSON.stringify({ e3: m3.e3.slice(0, 2), ovf }));
        await tag.evaluate((n) => n.remove());
      }
      ok('[E5] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
      await ctx.close();
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.470 Fable 版 iPad／筆電: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6470-fable-ipad-layouts ===');
process.exit(fail ? 1 : 0);
