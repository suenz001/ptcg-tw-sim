// v6.297 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）—— 錦標賽第 4 個分頁的「框架安全」證據。
//
// 做法沿用 scripts/measure-v6296-lobby-tabs.mjs：把 src/routes/game/+page.svelte 的 <style> 區
//   **整段原樣**抽出（:global(X) → X），灌進靜態 fixture，用**同樣的 class 結構**擺出錦標賽大廳，
//   量「3 顆分頁（＝上一版）」與「4 顆分頁（本版）」兩種情況下每個既有元素的 getBoundingClientRect()，逐一相減。
//
// 四種尺寸：375×812 ／ 390×844 ／ 412×915 ／ 1366×768。
// 斷言：
//   ① 分頁列**以上**的元素（回首頁鈕／標題／已登入那一行）rect **全等**（dx=dy=dw=dh=0）
//   ② 分頁列**以下**的元素 dy **恆等於同一個常數**、dx=0、dw=0
//   ③ 分頁列與任何既有元素**零重疊**、整頁無水平溢出
//   ④ 前 3 顆分頁的**文字內容**與上一版逐字相同（第 4 顆只是加在後面）
//   ⑤ ⭐ 兩個候選方案（方案 1＝flex-wrap:wrap + flex:1 1 140px；方案 2＝短標籤「👥 好友」）
//      各量一次並印出實際數字，讓「選位移最小的那個」有據可查。
//
// 用法：node scripts/measure-v6297-tourn-tabs.mjs [path/to/+page.svelte]
//   需要 playwright（PLAYWRIGHT_MODULE 可指定；PW_CHANNEL 預設 chromium-headless-shell）。
//   結果 JSON 寫到 MEASURE_OUT（預設 /tmp/measure-v6297.json）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = process.argv[2] || join(ROOT, 'src/routes/game/+page.svelte');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const src = readFileSync(PAGE, 'utf8');
const sStart = src.lastIndexOf('<style');
const css = src.slice(src.indexOf('>', sStart) + 1, src.lastIndexOf('</style>')).replace(/:global\(([^)]*)\)/g, '$1');

/** 前 3 顆分頁鈕的文字**從出貨碼實抽**（不是手抄），避免 fixture 與出貨碼漂移。 */
function shippedTabTexts() {
  const i = src.indexOf('<div class="tourn-tabs" role="tablist">');
  if (i < 0) throw new Error('抽不到 .tourn-tabs');
  const j = src.indexOf('</div>', i);
  const blk = src.slice(i, j);
  // ⚠ 不可以用 [^>]* 抓屬性：onclick 裡的箭頭函式含有 `>`，會把一半的程式碼當成標籤文字。
  return [...blk.matchAll(/<button class="tourn-tab"[\s\S]*?<\/button>/g)].map((m) => {
    const t = m[0].slice(0, m[0].lastIndexOf('</button>'));
    return t.slice(t.lastIndexOf('>') + 1);
  });
}
const SHIPPED = shippedTabTexts();
const BASE3 = SHIPPED.slice(0, 3);

const VARIANTS = {
  base3: { tabs: BASE3, extra: '' },
  // 方案 1：容器允許折行、每顆最小基準 140px ⇒ 窄幅自動 2×2
  plan1: { tabs: [...BASE3, '👥 好友名單'], extra: '.tourn-tabs{flex-wrap:wrap;} .tourn-tab{flex:1 1 140px;}' },
  // 方案 2：第 4 顆用短標籤，**一行 CSS 都不改**
  plan2: { tabs: [...BASE3, '👥 好友'], extra: '' },
};

function html(kind) {
  const v = VARIANTS[kind];
  const tabs = v.tabs.map((t, i) => `<button class="tourn-tab${i === 0 ? ' active' : ''}" role="tab" aria-selected="${i === 0}">${t}</button>`).join('');
  return `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}html,body{margin:0;background:#162816;}</style>
<style>${css}</style><style>${v.extra}</style></head><body>
<main class="lobby tourn-lobby">
  <div class="tourn-topbar" id="m-top"><a class="tourn-home-btn" href="#">← 回到首頁</a></div>
  <h1 class="lobby-title" id="m-h1">🏆 錦標賽對戰</h1>
  <p class="tourn-who" id="m-who">已登入：<b>somebody@example.com</b> <button class="tourn-logout">登出</button></p>
  <div class="tourn-tabs" role="tablist" id="m-tabs">${tabs}</div>
  <div class="tourn-chat" id="m-chat">
    <div class="tourn-chat-head" id="m-chathead"><span>💬 大廳聊天室</span>
      <span class="tchat-filter"><label><input type="checkbox" checked> 聊天</label><label><input type="checkbox" checked> 系統</label></span></div>
    <div class="tourn-chat-msgs" id="m-msgs"><div class="tcmsg muted">還沒有人發言，來說聲哈囉吧～</div></div>
    <div class="tourn-chat-input"><input maxlength="200" placeholder="說點什麼…（Enter 送出）"><button class="btn-secondary small">送出</button></div>
  </div>
  <div class="tourn-event" id="m-ev"><p class="muted small">目前沒有開放中的賽事。</p></div>
</main></body></html>`;
}

const IDS_ABOVE = ['m-top', 'm-h1', 'm-who'];
const IDS_BELOW = ['m-chat', 'm-chathead', 'm-msgs', 'm-ev'];

async function probe(pg, kind) {
  await pg.setContent(html(kind), { waitUntil: 'load' });
  return pg.evaluate(({ above, below }) => {
    const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
    const nav = document.getElementById('m-tabs');
    const items = [...nav.querySelectorAll('.tourn-tab')];
    const cs = getComputedStyle(nav);
    return {
      rects: Object.fromEntries([...above, ...below].map((id) => [id, R(document.getElementById(id))])),
      nav: { ...R(nav), mt: parseFloat(cs.marginTop), mb: parseFloat(cs.marginBottom), wrap: cs.flexWrap },
      items: items.map((t) => ({
        txt: t.textContent, ...R(t), scrollW: t.scrollWidth, clientW: t.clientWidth,
        hit: (() => { const r = t.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return h ? h.className : null; })(),
      })),
      docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
      contentW: +(document.querySelector('main.lobby').clientWidth - parseFloat(getComputedStyle(document.querySelector('main.lobby')).paddingLeft) * 2).toFixed(2),
    };
  }, { above: IDS_ABOVE, below: IDS_BELOW });
}

const eqRect = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const VPS = [
  { w: 375, h: 812, mobile: true, tag: '375×812' },
  { w: 390, h: 844, mobile: true, tag: '390×844' },
  { w: 412, h: 915, mobile: true, tag: '412×915' },
  { w: 1366, h: 768, mobile: false, tag: '1366×768' },
];

let bad = 0;
const ok = (cond, msg, extra) => { if (!cond) { bad++; console.log('  ✗ ' + msg + (extra ? ' :: ' + JSON.stringify(extra) : '')); } else console.log('  ✓ ' + msg); };
const table = [];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
try {
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const pg = await ctx.newPage();
    const b3 = await probe(pg, 'base3');
    const p1 = await probe(pg, 'plan1');
    const p2 = await probe(pg, 'plan2');
    console.log('\n── ' + vp.tag + '（大廳內容寬 ' + b3.contentW + 'px）──');
    console.log('   上一版 3 顆：分頁列高 ' + b3.nav.h + 'px，每顆 ' + b3.items.map((t) => t.w).join(' / ') + 'px');
    for (const [name, r] of [['方案1 折行 2×2', p1], ['方案2 短標籤', p2]]) {
      const dy = +(r.rects['m-chat'].y - b3.rects['m-chat'].y).toFixed(2);
      console.log('   ' + name + '：分頁列高 ' + r.nav.h + 'px（Δ' + (r.nav.h - b3.nav.h).toFixed(2) + '），下方位移 dy=' + dy
        + '，每顆寬 ' + r.items.map((t) => t.w).join(' / ') + '，每顆高 ' + r.items.map((t) => t.h).join(' / ')
        + '，列數 ' + new Set(r.items.map((t) => t.y)).size);
      table.push({ vp: vp.tag, contentW: b3.contentW, plan: name, navH: r.nav.h, baseNavH: b3.nav.h, dy, tabW: r.items.map((t) => t.w), tabH: r.items.map((t) => t.h), rows: new Set(r.items.map((t) => t.y)).size });
    }
    // ── 本版採用的是方案 2 ⇒ 以下斷言只對它做 ──
    for (const id of IDS_ABOVE) ok(eqRect(b3.rects[id], p2.rects[id]), '① ' + id + ' 分頁列以上 rect 全等', { base: b3.rects[id], now: p2.rects[id] });
    const dys = IDS_BELOW.map((id) => +(p2.rects[id].y - b3.rects[id].y).toFixed(2));
    ok(new Set(dys).size === 1, '② 分頁列以下的 dy 是同一個常數', { dys });
    ok(dys[0] === +(p2.nav.h - b3.nav.h).toFixed(2), '② dy(' + dys[0] + ') ＝ 分頁列高的增量(' + (p2.nav.h - b3.nav.h).toFixed(2) + ')');
    for (const id of IDS_BELOW) {
      ok(p2.rects[id].x === b3.rects[id].x, '② ' + id + ' dx=0');
      ok(p2.rects[id].w === b3.rects[id].w, '② ' + id + ' dw=0');
    }
    for (const id of [...IDS_ABOVE, ...IDS_BELOW]) {
      if (id === 'm-chat') continue;   // 容器 vs 子元素本來就包住
      ok(!overlap(p2.nav, p2.rects[id]) || id === 'm-chathead' || id === 'm-msgs', '③ 分頁列與 ' + id + ' 零重疊', { nav: p2.nav, el: p2.rects[id] });
    }
    ok(p2.docScrollW <= p2.docClientW, '③ 整頁無水平溢出', { scrollW: p2.docScrollW, clientW: p2.docClientW });
    ok(p2.items.length === 4, '④ 分頁鈕恰四顆');
    ok(JSON.stringify(p2.items.slice(0, 3).map((t) => t.txt)) === JSON.stringify(b3.items.map((t) => t.txt)), '④ 前三顆文字逐字未動', p2.items.slice(0, 3).map((t) => t.txt));
    for (const t of p2.items) {
      ok(t.scrollW <= t.clientW + 0.5, '④ 「' + t.txt + '」字沒被截（scrollW ' + t.scrollW + ' ≤ clientW ' + t.clientW + '）');
      ok(String(t.hit).includes('tourn-tab'), '④ 「' + t.txt + '」中心點命中自己', t.hit);
    }
    ok(+(p2.nav.h - b3.nav.h).toFixed(2) <= +(p1.nav.h - b3.nav.h).toFixed(2), '⑤ 方案 2 的位移不大於方案 1（' + (p2.nav.h - b3.nav.h) + ' ≤ ' + (p1.nav.h - b3.nav.h) + '）');
    await ctx.close();
  }
} finally { await browser.close(); }

writeFileSync(process.env.MEASURE_OUT || '/tmp/measure-v6297.json', JSON.stringify(table, null, 1));
console.log('\n══ v6.297 錦標賽分頁列版面量測：' + (bad ? bad + ' 項不符 ✗' : '全部符合 ✓') + ' ══');
process.exit(bad ? 1 : 0);
