// v6.285 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）—— 設定 modal 捲動修正的證據。
//
// 做法（沿 scripts/measure-v6284-friends-layout.mjs）：把 `+page.svelte` 的 <style> 區**整段原樣**抽出（:global(X)→X），
//   灌進靜態 fixture；BASE 與修後兩份 CSS 各量一次，逐元素相減。Svelte 的 CSS scoping 只是在 selector 後面加 hash class，
//   去掉 scoping 後對同一份 markup 版面完全等價 ⇒ 量到的就是正式站的版面。markup／CSS 抽取與守衛共用 scripts/lib/zoom-modal-fixture.mjs。
//
// 場景：
//   S  設定 modal（markup 從 svelte 檔忠實抽出：{#if} 取第一分支＝對戰中、各開關開啟的最高狀態）
//      × 375×812／375×667／1366×768／1536×864／1920×1080：
//      (1) 修後 CSS 下 overflow-y 必須是 auto、捲到底之後**最後一個 section 的底**必須落在 modal 內容區內且在 viewport 內；
//      (2) BASE 的症狀重現：overflow hidden、scrollHeight > clientHeight（＝被切掉且不能捲）；
//      (3) 既有 section 的位移（scrollTop=0）—— 只在「modal 尚未貼到上限」的大尺寸會因 margin:auto 置中而整體上移，
//          其餘 dy=0；桌機溢出時出現捲軸 ⇒ 內容寬度會少一個捲軸寬（這是「能捲」的必然代價，如實列出）。
//   Z  其他三種 zoom modal（棄牌區 .discard-modal／獎賞卡檢視 .prize-view-modal／卡牌放大 .zoom-modal）
//      × 同五種尺寸：BASE CSS vs 修後 CSS，**同一份 markup**，每個元素的 rect、overflow-y、scrollHeight/clientHeight 必須全等。
//
// 用法：node scripts/measure-v6285-settings-scroll.mjs <BASE 的 +page.svelte> [修後的 +page.svelte]
//   需要 playwright（PLAYWRIGHT_MODULE=/path/to/node_modules/playwright；PW_CHANNEL 預設 chromium-headless-shell；
//   沙盒缺 libXdamage 時 LD_LIBRARY_PATH 指向解出來的 libXdamage.so.1）。結果 JSON 寫到 MEASURE_OUT（預設 /tmp/measure-v6285.json）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { extractCss, settingsMarkup, zoomModalFixtures, VIEWPORTS, pageHtml } from './lib/zoom-modal-fixture.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_PATH = process.argv[2];
const HEAD_PATH = process.argv[3] || join(ROOT, 'src/routes/game/+page.svelte');
if (!BASE_PATH) { console.error('用法：node scripts/measure-v6285-settings-scroll.mjs <BASE +page.svelte> [修後 +page.svelte]'); process.exit(2); }
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseSrc = readFileSync(BASE_PATH, 'utf8');
const headSrc = readFileSync(HEAD_PATH, 'utf8');
const cssBase = extractCss(baseSrc), cssHead = extractCss(headSrc);
const settingsBase = settingsMarkup(baseSrc), settingsHead = settingsMarkup(headSrc);

const R = (o) => ({ x: +o.x.toFixed(1), y: +o.y.toFixed(1), w: +o.w.toFixed(1), h: +o.h.toFixed(1) });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
const report = { base: BASE_PATH, head: HEAD_PATH, S: {}, Z: {} };
let bad = 0;
try {
  console.log('══ S：設定 modal ══');
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const pg = await ctx.newPage();
    const probe = async (css, html, allOpen = false) => {
      await pg.setContent(pageHtml(css, html), { waitUntil: 'load' });
      return pg.evaluate((allOpen) => {
        const m = document.querySelector('.settings-modal'); const cs = getComputedStyle(m);
        if (allOpen) for (const d of m.querySelectorAll('details')) d.open = true;   // 最嚴：每個 section 都展開（玩家點開最後一個 section 之後）
        const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        const secs = [...m.querySelectorAll('details.settings-section')].map((d) => ({ t: d.querySelector('summary').textContent.trim(), ...rect(d) }));
        const close0 = rect(m.querySelector('.zoom-close'));
        const r0 = rect(m);
        const contentBottom = r0.y + r0.h - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
        m.scrollTop = 1e6;
        const scrolled = m.scrollTop;
        const last = m.querySelector('details.settings-section:last-of-type');
        const lastR = rect(last);
        const ctls = [...last.querySelectorAll('button, select, input, a')];
        const lastCtl = ctls.length ? rect(ctls[ctls.length - 1]) : null;
        const close1 = rect(m.querySelector('.zoom-close'));
        m.scrollTop = 0;
        return { overflowY: cs.overflowY, boxSizing: cs.boxSizing, modal: r0, contentBottom, scrollH: m.scrollHeight, clientH: m.clientHeight, secs, close0, scrolled, lastSec: { t: last.querySelector('summary').textContent.trim(), ...lastR }, lastCtl, close1 };
      }, allOpen);
    };
    const b = await probe(cssBase, settingsBase);          // BASE CSS ＋ BASE markup（正式站現況；預設展開狀態）
    const hb = await probe(cssHead, settingsBase, true);   // 修後 CSS ＋ BASE markup（只修捲動；全部 section 展開）
    const h = await probe(cssHead, settingsHead, true);    // 修後 CSS ＋ 修後 markup（含好友 section；全部 section 展開）
    const h0 = await probe(cssHead, settingsHead);         // 修後 CSS ＋ 修後 markup（預設展開狀態 ⇒ 與 b 比既有 section 位移）
    const key = `${vp.w}×${vp.h} ${vp.mobile ? '手機直式' : '桌機'}`;
    // ⚠ overflow:hidden 的元素仍可用程式設 scrollTop（BASE 也會 >0），「玩家捲得動」的判準是 overflow-y 的最終值
    const ok = (p) => (p.overflowY === 'auto' || p.overflowY === 'scroll') && (p.scrollH <= p.clientH || p.scrolled > 0)
      && p.lastSec.y + p.lastSec.h <= p.contentBottom + 0.6 && p.lastSec.y + p.lastSec.h <= vp.h
      && !!p.lastCtl && p.lastCtl.y + p.lastCtl.h <= p.contentBottom + 0.6 && p.lastCtl.y >= 0;
    const secDiff = b.secs.map((s, i) => ({ t: s.t.slice(0, 8), dx: +(h0.secs[i].x - s.x).toFixed(1), dy: +(h0.secs[i].y - s.y).toFixed(1), dw: +(h0.secs[i].w - s.w).toFixed(1), dh: +(h0.secs[i].h - s.h).toFixed(1) }));
    report.S[key] = { base: b, headBaseMarkup: hb, head: h, headDefault: h0, secDiff, okHb: ok(hb), okH: ok(h) };
    console.log(`\n【S ${key}】box-sizing=${b.boxSizing}`);
    console.log(`  BASE          ：overflow-y=${b.overflowY} modal=${JSON.stringify(R(b.modal))} scrollH=${b.scrollH} clientH=${b.clientH} ⇒ ${b.scrollH > b.clientH ? (b.overflowY === 'hidden' ? '⚠ 被切掉 ' + (b.scrollH - b.clientH) + 'px 且玩家不能捲' : '可捲') : '放得下'}；最後 section「${b.lastSec.t}」bottom=${(b.lastSec.y + b.lastSec.h).toFixed(1)} vs 內容底 ${b.contentBottom.toFixed(1)}`);
    console.log(`  修後 CSS＋舊 markup（全展開）：overflow-y=${hb.overflowY} scrollH=${hb.scrollH} clientH=${hb.clientH} 捲到底 scrollTop=${hb.scrolled} ⇒ 最後 section「${hb.lastSec.t}」bottom=${(hb.lastSec.y + hb.lastSec.h).toFixed(1)} vs 內容底 ${hb.contentBottom.toFixed(1)}／viewport ${vp.h} ⇒ ${ok(hb) ? '✅ 捲得到、看得到' : '⚠⚠ 看不到'}`);
    console.log(`  修後 CSS＋新 markup（全展開）：overflow-y=${h.overflowY} modal=${JSON.stringify(R(h.modal))} scrollH=${h.scrollH} clientH=${h.clientH} 捲到底 scrollTop=${h.scrolled} ⇒ 最後 section「${h.lastSec.t}」bottom=${(h.lastSec.y + h.lastSec.h).toFixed(1)}（最後一個可操作元素 bottom=${h.lastCtl ? (h.lastCtl.y + h.lastCtl.h).toFixed(1) : '-'}）vs 內容底 ${h.contentBottom.toFixed(1)}／viewport ${vp.h} ⇒ ${ok(h) ? '✅ 捲得到、看得到' : '⚠⚠ 看不到'}`);
    console.log(`  既有 section（scrollTop=0，預設展開狀態）BASE→修後：${secDiff.map((d) => `${d.t} dx=${d.dx} dy=${d.dy} dw=${d.dw} dh=${d.dh}`).join('；')}`);
    console.log(`  ✕ 關閉鈕：scrollTop=0 時 ${JSON.stringify(R(h.close0))}，捲到底後 ${JSON.stringify(R(h.close1))}（absolute 子元素隨內容捲動，與 .prize-view-modal 同型）`);
    console.log(`  好友 section 收合時 modal=${JSON.stringify(R(h0.modal))} scrollH=${h0.scrollH} clientH=${h0.clientH}`);
    if (!(ok(hb) && ok(h))) bad++;
    await ctx.close();
  }

  console.log('\n══ Z：其他 zoom modal（BASE CSS vs 修後 CSS，同一份 markup）══');
  const fixtures = zoomModalFixtures();
  for (const [name, html] of Object.entries(fixtures)) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
      const pg = await ctx.newPage();
      const probe = async (css) => {
        await pg.setContent(pageHtml(css, html), { waitUntil: 'load' });
        return pg.evaluate(() => {
          const out = {};
          for (const el of document.querySelectorAll('[id]')) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); out[el.id] = { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), ov: cs.overflowY, sh: el.scrollHeight, ch: el.clientHeight }; }
          return out;
        });
      };
      const b = await probe(cssBase), h = await probe(cssHead);
      const ids = Object.keys(b);
      const diffs = ids.filter((id) => JSON.stringify(b[id]) !== JSON.stringify(h[id]));
      const key = `${name} ${vp.w}×${vp.h}`;
      report.Z[key] = { n: ids.length, diffs, modal: b['z-modal'] };
      const m = b['z-modal'];
      console.log(`  ${key.padEnd(20)} 元素 ${String(ids.length).padStart(2)} 個 ⇒ ${diffs.length ? '⚠⚠ 有差異：' + diffs.join(',') : '✅ 全等'}   modal=(${m.x},${m.y},${m.w}×${m.h}) overflow-y=${m.ov} scrollH=${m.sh} clientH=${m.ch}`);
      if (diffs.length) bad++;
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
const out = process.env.MEASURE_OUT || '/tmp/measure-v6285.json';
writeFileSync(out, JSON.stringify(report, null, 1));
console.log('\n' + (bad ? '⚠⚠ 有 ' + bad + ' 項不符' : '✅ 全部符合') + '；細節寫在 ' + out);
process.exit(bad ? 1 : 0);
