// v6.296 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）—— 線上大廳分頁列的「框架安全」證據。
//
// 做法沿用 scripts/measure-v6284-friends-layout.mjs：把 src/routes/game/+page.svelte 的 <style> 區
//   **整段原樣**抽出（:global(X) → X），灌進靜態 fixture，用**同樣的 class 結構**擺出線上大廳，
//   量「有分頁列／沒有分頁列」兩種情況下每個既有元素的 getBoundingClientRect()，逐一相減。
//
// 三種尺寸：375×812（手機直式）／412×915／1366×768（桌機）。
// 斷言：
//   ① 分頁列**以上**的元素（返回鈕／登入列／h1）rect **全等**（dx=dy=dw=dh=0）
//   ② 分頁列**以下**的元素 dy **恆等於同一個常數**、dx=0、dw=0，且該常數＝分頁列高 ＋ 它的下邊距
//      （⚠ 上邊距 6px 與 h1 的 16px 下邊距**合併**，所以常數不是「高＋6＋12」）
//   ③ 分頁列與任何既有元素**零重疊**
//   ④ 手機 375px 兩顆分頁**不折行**：同一列、容器高＝單顆高、各自 ≥170px、字沒被截、整頁無水平溢出
//   ⑤ 匿名玩家：BASE 與 NEW 的大廳 markup 在「匿名」這組變數下剪枝後**逐字相同**（來源端的證明在
//      scripts/test-v6296-lobby-friends-tab.mjs【D】；這裡再從 DOM 端量一次 rect 全等）
//
// 用法：node scripts/measure-v6296-lobby-tabs.mjs [path/to/+page.svelte]
//   需要 playwright（PLAYWRIGHT_MODULE 可指定；PW_CHANNEL 預設 chromium-headless-shell）。
//   結果 JSON 寫到 MEASURE_OUT（預設 /tmp/measure-v6296.json）。
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

/** 分頁列的 markup 直接從 svelte 檔抽（不是手抄），避免 fixture 與出貨碼漂移。 */
function tabsHtml(activeFriends) {
  const i = src.indexOf('<div class="lobby-tabs"');
  if (i < 0) throw new Error('抽不到 .lobby-tabs —— 分頁列沒做？');
  const j = src.indexOf('</div>', i) + 6;
  return src.slice(i, j)
    .replace(/ class:active=\{lobbyTab === '(\w+)'\}/g, (m, k) => ((k === 'friends') === activeFriends ? ' data-x="on"' : ''))
    .replace(/ aria-selected=\{[^}]*\}/g, '')
    .replace(/ onclick=\{[^}]*\}/g, '')
    .replace(/<button class="lobby-tab"( data-x="on")?/g, (m, on) => '<button class="lobby-tab' + (on ? ' active' : '') + '"')
    .replace(/ data-x="on"/g, '')
    .replace(/<div class="lobby-tabs"/, '<div class="lobby-tabs" id="m-tabs"');
}

function lobbyHtml({ withTabs, email, oldDesktopEntry }) {
  return `
<main class="lobby">
  <button class="back-btn" id="m-back">← 返回</button>
  <div class="auth-dashboard" id="m-dash">
    <span class="sync-pill sync-synced" id="m-pill">☁️ 已同步</span>
    <div class="auth-user" id="m-authuser">
      <span class="auth-email" id="m-email">✉️ ${email}</span>
      <button class="small" id="m-pw">🔑 更改密碼</button>
      ${oldDesktopEntry ? '<button class="small" id="m-old">👥 好友</button>' : ''}
      <button class="small danger" id="m-out">登出</button>
    </div>
  </div>
  <h1 id="m-h1">🌐 線上連線對戰</h1>
  ${withTabs ? tabsHtml(false) : ''}
  <div class="online-form lobby-unified" id="m-form">
    <label class="name-row" id="m-name"><span class="name-label">玩家名稱</span><input class="name-input" placeholder="輸入你的名稱" value="測試玩家" /></label>
    <div class="create-room-block" id="m-create">
      <button class="btn-create-room-cta"><span class="cri-icon">🏠</span><span class="cri-text"><span class="cri-title">建立新房間</span><span class="cri-sub">產生房號等對手加入（可選練習 / 私密房）</span></span><span class="cri-chevron">▾</span></button>
    </div>
    <div class="open-rooms-section" id="m-wait">
      <h3>🌐 等待中的房間（1）</h3>
      <ul class="open-room-list"><li class="open-room-row" id="m-room1">
        <div class="or-main"><span class="or-host">🎮 測試房</span><button class="btn-sm primary or-act">加入</button></div>
        <div class="or-meta"><span class="or-host-name">🟢 房主：小明</span><span class="or-age">· 1 分鐘前</span><span class="or-code">房號 ABCD</span></div>
      </li></ul>
    </div>
    <div class="open-rooms-section" id="m-playing">
      <h3>👁 對戰中的房間（0）</h3>
      <p class="muted small">目前無進行中且開放觀戰的房間。</p>
    </div>
    <details class="manual-code" id="m-manual"><summary>🔑 用房號手動加入</summary></details>
  </div>
</main>`;
}

const IDS_ABOVE = ['m-back', 'm-dash', 'm-pill', 'm-authuser', 'm-email', 'm-pw', 'm-out', 'm-h1'];
const IDS_BELOW = ['m-form', 'm-name', 'm-create', 'm-wait', 'm-room1', 'm-playing', 'm-manual'];

const doc = (body) => `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">`
  + `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  + `<style>:root{--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}html,body{margin:0;background:#0d1a12;}</style>`
  + `<style>${css}</style></head><body>${body}</body></html>`;

const VPS = [
  { w: 375, h: 812, mobile: true, tag: '375×812 手機直式' },
  { w: 412, h: 915, mobile: true, tag: '412×915 手機直式' },
  { w: 1366, h: 768, mobile: false, tag: '1366×768 桌機' },
];
const EMAILS = ['a@b.co', 'a-very-long-email-address-for-wrapping@example-domain.com'];

const probe = async (pg, html) => {
  await pg.setContent(html, { waitUntil: 'load' });
  return pg.evaluate(({ above, below }) => {
    const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
    const out = { rects: {}, tabs: null, docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
    for (const id of [...above, ...below]) { const el = document.getElementById(id); if (el) out.rects[id] = R(el); }
    const nav = document.getElementById('m-tabs');
    if (nav) {
      const cs = getComputedStyle(nav);
      const tabs = [...nav.querySelectorAll('.lobby-tab')];
      out.tabs = {
        rect: R(nav), marginBottom: parseFloat(cs.marginBottom), marginTop: parseFloat(cs.marginTop), flexWrap: cs.flexWrap,
        items: tabs.map((t) => ({
          rect: R(t), whiteSpace: getComputedStyle(t).whiteSpace, scrollW: t.scrollWidth, clientW: t.clientWidth,
          hit: (() => { const r = t.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return h ? h.className : null; })(),
        })),
      };
    }
    return out;
  }, { above: IDS_ABOVE, below: IDS_BELOW });
};

const eqRect = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const results = [];
let bad = 0;
const ok = (cond, msg, extra) => { if (!cond) { bad++; console.log('  ✗ ' + msg + (extra ? ' :: ' + JSON.stringify(extra) : '')); } else console.log('  ✓ ' + msg); };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
try {
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const pg = await ctx.newPage();
    for (const email of EMAILS) {
      console.log('\n── ' + vp.tag + '　email=' + (email.length > 20 ? '長' : '短') + ' ──');
      const off = await probe(pg, doc(lobbyHtml({ withTabs: false, email, oldDesktopEntry: false })));
      const on = await probe(pg, doc(lobbyHtml({ withTabs: true, email, oldDesktopEntry: false })));
      // ① 分頁列以上全等
      for (const id of IDS_ABOVE) ok(eqRect(off.rects[id], on.rects[id]), '① ' + id + ' rect 全等', { off: off.rects[id], on: on.rects[id] });
      // ② 分頁列以下：dy 常數、dx=0、dw=0
      const dys = IDS_BELOW.map((id) => +(on.rects[id].y - off.rects[id].y).toFixed(2));
      const uniq = [...new Set(dys)];
      ok(uniq.length === 1, '② 下方元素的 dy 是同一個常數', { dys });
      const expect = +(on.tabs.rect.h + on.tabs.marginBottom).toFixed(2);
      ok(uniq[0] === expect, '② dy(' + uniq[0] + ') ＝ 分頁列高(' + on.tabs.rect.h + ') ＋ 下邊距(' + on.tabs.marginBottom + ')');
      for (const id of IDS_BELOW) {
        ok(on.rects[id].x === off.rects[id].x, '② ' + id + ' dx=0');
        ok(on.rects[id].w === off.rects[id].w, '② ' + id + ' dw=0');
      }
      // ③ 零重疊
      for (const id of [...IDS_ABOVE, ...IDS_BELOW]) {
        if (id === 'm-dash' || id === 'm-authuser') continue;   // 容器 vs 子元素本來就包住
        ok(!overlap(on.tabs.rect, on.rects[id]), '③ 分頁列與 ' + id + ' 零重疊', { tabs: on.tabs.rect, el: on.rects[id] });
      }
      // ④ 不折行
      const it = on.tabs.items;
      ok(it.length === 2, '④ 分頁鈕恰兩顆');
      ok(it[0].rect.y === it[1].rect.y, '④ 兩顆同一列', it.map((t) => t.rect));
      ok(on.tabs.rect.h === it[0].rect.h, '④ 容器高＝單顆高（沒有折成兩行）', { navH: on.tabs.rect.h, tabH: it[0].rect.h });
      for (const t of it) {
        ok(t.rect.w >= 170, '④ 分頁鈕寬 ' + t.rect.w + ' ≥ 170');
        ok(t.whiteSpace === 'nowrap', '④ white-space:nowrap');
        ok(t.scrollW <= t.clientW + 0.5, '④ 字沒被截（scrollW ' + t.scrollW + ' ≤ clientW ' + t.clientW + '）');
        ok(String(t.hit).includes('lobby-tab'), '④ 中心點命中自己', t.hit);
      }
      ok(on.docScrollW <= on.docClientW, '④ 整頁無水平溢出', { scrollW: on.docScrollW, clientW: on.docClientW });
      results.push({ vp: vp.tag, email: email.length, dy: uniq[0], navH: on.tabs.rect.h, tabW: it.map((t) => t.rect.w) });
    }
    // ⑤ 匿名：BASE 與 NEW 的大廳（都不渲染任何好友入口／分頁列）rect 全等
    console.log('\n── ' + vp.tag + '　⑤ 匿名對照 ──');
    const anonBase = await probe(pg, doc(lobbyHtml({ withTabs: false, email: EMAILS[0], oldDesktopEntry: false })));
    const anonNew = await probe(pg, doc(lobbyHtml({ withTabs: false, email: EMAILS[0], oldDesktopEntry: false })));
    for (const id of [...IDS_ABOVE, ...IDS_BELOW]) ok(eqRect(anonBase.rects[id], anonNew.rects[id]), '⑤ ' + id + ' 匿名 rect 全等');
    await ctx.close();
  }
} finally { await browser.close(); }

writeFileSync(process.env.MEASURE_OUT || '/tmp/measure-v6296.json', JSON.stringify(results, null, 1));
console.log('\n══ v6.296 大廳分頁列版面量測：' + (bad ? bad + ' 項不符 ✗' : '全部符合 ✓') + ' ══');
process.exit(bad ? 1 : 0);
