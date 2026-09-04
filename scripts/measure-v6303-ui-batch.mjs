// v6.303 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）—— 本版三件 UI 改善的「框架安全」證據。
//
// 做法沿用 scripts/measure-v6297-tourn-tabs.mjs：把出貨的 <style> 區段**整段原樣**抽出
//   （:global(X) → X），灌進靜態 fixture，用**同樣的 class 結構**擺出畫面，
//   量 getBoundingClientRect() 逐一相減。四種尺寸：375×812 ／ 390×844 ／ 412×915 ／ 1366×768。
//
// 【A】錦標賽四顆分頁縮成 2 字
//   對照組 = **BASE(v6.302) 的分頁文字**（從 git blob 實抽；抽不到才退回字面並印警告）。
//   斷言：①分頁列以上的元素 rect 全等　②以下的 dy 是同一個常數、dx=dw=0
//        ③四顆都是**單行**（y 相同）、字沒被截、中心點命中自己　④整頁無水平溢出
//        ⑤⭐ 印出 dy —— v6.297 量到 375×812 是 +21，本版要看它有沒有歸零。
//
// 【B】賽事卡左側色條不推擠內容
//   同一份 CSS 下擺三張 .tourn-event（無色條／ev-open-reg／ev-open-checkin），
//   斷言卡片**內文字**的 left／width 三者完全相同（inset 陰影不進盒模型），
//   且色條真的畫得出來（computed box-shadow 帶對應色票、inset）。
//
// 【C】卡牌資料庫左右箭頭透明化
//   對照組 = BASE 的 cards/+page.svelte CSS。斷言按鈕 rect 全等（零位移）、
//   中心點 elementFromPoint 仍命中按鈕本身，且新版底色**帶透明度**（alpha < 1）。
//
// 用法：node scripts/measure-v6303-ui-batch.mjs
//   需要 playwright（PLAYWRIGHT_MODULE 可指定；PW_CHANNEL 預設 chromium-headless-shell）。
//   結果 JSON 寫到 MEASURE_OUT（預設 /tmp/measure-v6303.json）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_CARDS = join(ROOT, 'src/routes/cards/+page.svelte');
const BASE_SHA = process.env.V6303_BASE_SHA || '5264ff88f3c37d7fbd5ec777818c1559fd62669c'; // v6.302
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
/** 抽出 <style> 區段（最後一個），並把 :global(X) 攤平成 X，好灌進靜態 fixture。 */
function styleOf(src) {
  const s = src.lastIndexOf('<style');
  return src.slice(src.indexOf('>', s) + 1, src.lastIndexOf('</style>')).replace(/:global\(([^)]*)\)/g, '$1');
}
function baseBlob(path) {
  try {
    return execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE_SHA + ':' + path],
      { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').replace(/\r\n/g, '\n');
  } catch { return null; }
}

const GAME = rd(P_GAME);
const CARDS = rd(P_CARDS);
const CSS_GAME = styleOf(GAME);
const CSS_CARDS_NEW = styleOf(CARDS);
const baseCards = baseBlob('src/routes/cards/+page.svelte');
const CSS_CARDS_OLD = baseCards ? styleOf(baseCards) : null;

/** 分頁鈕文字**從原始碼實抽**（不是手抄），避免 fixture 與出貨碼漂移。 */
function tabTexts(src) {
  const i = src.indexOf('<div class="tourn-tabs" role="tablist">');
  if (i < 0) throw new Error('抽不到 .tourn-tabs');
  const blk = src.slice(i, src.indexOf('\n      </div>', i));
  // ⚠ 不可以用 [^>]* 抓屬性：onclick 裡的箭頭函式含有 `>`。
  return [...blk.matchAll(/<button class="tourn-tab"[\s\S]*?<\/button>/g)].map((m) => {
    const t = m[0].slice(0, m[0].lastIndexOf('</button>'));
    return t.slice(t.lastIndexOf('>') + 1);
  });
}
const NEW_TABS = tabTexts(GAME);
const baseGame = baseBlob('src/routes/game/+page.svelte');
let OLD_TABS, oldFrom;
if (baseGame) { OLD_TABS = tabTexts(baseGame); oldFrom = 'BASE ' + BASE_SHA.slice(0, 8); }
else { OLD_TABS = ['🏆 賽事', '📊 排行榜', '🪪 個人資料', '👥 好友']; oldFrom = '字面回退（拿不到 BASE blob）'; }

let bad = 0;
const ok = (cond, msg, extra) => {
  if (!cond) { bad++; console.log('  ✗ ' + msg + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
  else console.log('  ✓ ' + msg);
};
const table = [];
const HEAD = (css) => `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}html,body{margin:0;background:#162816;}</style>
<style>${css}</style></head><body>`;

// ══ 【A】分頁列 fixture（與 measure-v6297 同一份骨架）══════════════════════
function htmlTabs(tabs) {
  const t = tabs.map((x, i) => `<button class="tourn-tab${i === 0 ? ' active' : ''}" role="tab" aria-selected="${i === 0}">${x}</button>`).join('');
  return HEAD(CSS_GAME) + `<main class="lobby tourn-lobby">
  <div class="tourn-topbar" id="m-top"><a class="tourn-home-btn" href="#">← 回到首頁</a></div>
  <h1 class="lobby-title" id="m-h1">🏆 錦標賽對戰</h1>
  <p class="tourn-who" id="m-who">已登入：<b>somebody@example.com</b> <button class="tourn-logout">登出</button></p>
  <div class="tourn-tabs" role="tablist" id="m-tabs">${t}</div>
  <div class="tourn-chat" id="m-chat">
    <div class="tourn-chat-head" id="m-chathead"><span>💬 大廳聊天室</span></div>
    <div class="tourn-chat-msgs" id="m-msgs"><div class="tcmsg muted">還沒有人發言，來說聲哈囉吧～</div></div>
  </div>
  <div class="tourn-event" id="m-ev"><p class="muted small">目前沒有開放中的賽事。</p></div>
</main></body></html>`;
}
const IDS_ABOVE = ['m-top', 'm-h1', 'm-who'];
const IDS_BELOW = ['m-chat', 'm-chathead', 'm-msgs', 'm-ev'];
const PROBE_TABS = ({ above, below }) => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
  const nav = document.getElementById('m-tabs');
  const items = [...nav.querySelectorAll('.tourn-tab')];
  return {
    rects: Object.fromEntries([...above, ...below].map((id) => [id, R(document.getElementById(id))])),
    nav: R(nav),
    items: items.map((t) => ({
      txt: t.textContent, ...R(t), scrollW: t.scrollWidth, clientW: t.clientWidth,
      hit: (() => { const r = t.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return h ? h.className : null; })(),
    })),
    rows: new Set(items.map((t) => +t.getBoundingClientRect().y.toFixed(2))).size,
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
  };
};

// ══ 【B】賽事卡色條 fixture ═══════════════════════════════════════════════
const EVCARD = (id, cls) => `<div class="tourn-event ${cls}" id="ev-${id}">
  <div class="tourn-ev-head tourn-fold-toggle"><span class="tourn-fold-arrow">▾</span><h3 id="h3-${id}">🏆 測試盃</h3></div>
  <p class="tourn-evstat tourn-ev-fold" id="txt-${id}">報名中 ｜ 報名 4 / 16 人 ｜ 點此展開</p>
</div>`;
const htmlBar = () => HEAD(CSS_GAME) + `<main class="lobby tourn-lobby">
${EVCARD('plain', '')}${EVCARD('reg', 'ev-open-reg')}${EVCARD('checkin', 'ev-open-checkin')}
</main></body></html>`;
const PROBE_BAR = () => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
  const out = {};
  for (const k of ['plain', 'reg', 'checkin']) {
    const card = document.getElementById('ev-' + k);
    const cs = getComputedStyle(card);
    out[k] = {
      card: R(card), txt: R(document.getElementById('txt-' + k)), h3: R(document.getElementById('h3-' + k)),
      shadow: cs.boxShadow, borderLeft: cs.borderLeftWidth, padLeft: cs.paddingLeft, boxSizing: cs.boxSizing,
    };
  }
  return out;
};

// ══ 【C】卡牌資料庫箭頭 fixture ══════════════════════════════════════════
const htmlNav = (css) => HEAD(css) + `<div class="modal" style="position:static;">
  <div class="modalInner" id="c-inner" style="max-height:none;">
    <button class="modal-nav modal-nav-prev" id="c-prev" aria-label="上一個版本">‹</button>
    <button class="modal-nav modal-nav-next" id="c-next" aria-label="下一個版本">›</button>
    <span class="modal-variant-counter">1 / 3 版本</span>
    <div class="detailGrid"><div class="detailInfo" id="c-info">
      <h2>測試卡</h2><p class="tag">寶可夢 / 基本 · HP 120</p>
      <p id="c-behind" style="margin:0;font-size:1.4rem;">咬碎 120　　　　　　　　　　　　　　　　鐵頭 60</p>
    </div></div>
  </div></div></body></html>`;
const PROBE_NAV = () => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
  const out = {};
  for (const k of ['c-prev', 'c-next']) {
    const el = document.getElementById(k);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out[k] = { rect: R(el), bg: cs.backgroundColor, border: cs.borderColor, shadow: cs.boxShadow, textShadow: cs.textShadow, hit: h ? h.id : null };
  }
  out['c-info'] = R(document.getElementById('c-info'));
  out['c-behind'] = R(document.getElementById('c-behind'));
  out.docScrollW = document.documentElement.scrollWidth;
  out.docClientW = document.documentElement.clientWidth;
  return out;
};

const eqRect = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const alphaOf = (rgba) => { const m = /rgba?\(([^)]*)\)/.exec(rgba); if (!m) return 1; const p = m[1].split(','); return p.length >= 4 ? parseFloat(p[3]) : 1; };
const VPS = [
  { w: 375, h: 812, mobile: true, tag: '375×812' },
  { w: 390, h: 844, mobile: true, tag: '390×844' },
  { w: 412, h: 915, mobile: true, tag: '412×915' },
  { w: 1366, h: 768, mobile: false, tag: '1366×768' },
];

console.log('【A】錦標賽分頁列：對照組文字來源 = ' + oldFrom);
console.log('   舊：' + JSON.stringify(OLD_TABS) + '\n   新：' + JSON.stringify(NEW_TABS));
if (OLD_TABS.length !== NEW_TABS.length) { console.log('  ✗ 舊新分頁數不同 —— 本版只改文字，數量不該變'); bad++; }

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
try {
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const pg = await ctx.newPage();
    console.log('\n────────── ' + vp.tag + ' ──────────');

    // ── 【A】 ──
    await pg.setContent(htmlTabs(OLD_TABS), { waitUntil: 'load' });
    const oldT = await pg.evaluate(PROBE_TABS, { above: IDS_ABOVE, below: IDS_BELOW });
    await pg.setContent(htmlTabs(NEW_TABS), { waitUntil: 'load' });
    const newT = await pg.evaluate(PROBE_TABS, { above: IDS_ABOVE, below: IDS_BELOW });
    const dy = +(newT.rects['m-chat'].y - oldT.rects['m-chat'].y).toFixed(2);
    console.log('【A】舊（' + OLD_TABS.join('／') + '）：分頁列高 ' + oldT.nav.h + 'px、' + oldT.rows + ' 列，每顆高 ' + oldT.items.map((t) => t.h).join('/'));
    console.log('【A】新（' + NEW_TABS.join('／') + '）：分頁列高 ' + newT.nav.h + 'px、' + newT.rows + ' 列，每顆高 ' + newT.items.map((t) => t.h).join('/'));
    console.log('【A】⭐ 下方內容位移 dy = ' + dy + 'px（v6.297 在 375×812 量到的是 +21）');
    table.push({ vp: vp.tag, part: 'A', oldNavH: oldT.nav.h, newNavH: newT.nav.h, oldRows: oldT.rows, newRows: newT.rows, dy });
    for (const id of IDS_ABOVE) ok(eqRect(oldT.rects[id], newT.rects[id]), 'A① ' + id + '（分頁列以上）rect 全等', { old: oldT.rects[id], now: newT.rects[id] });
    const dys = IDS_BELOW.map((id) => +(newT.rects[id].y - oldT.rects[id].y).toFixed(2));
    ok(new Set(dys).size === 1, 'A② 分頁列以下的 dy 是同一個常數', { dys });
    for (const id of IDS_BELOW) {
      ok(newT.rects[id].x === oldT.rects[id].x, 'A② ' + id + ' dx=0');
      ok(newT.rects[id].w === oldT.rects[id].w, 'A② ' + id + ' dw=0');
    }
    ok(newT.rows === 1, 'A③ 新版四顆分頁在**同一列**（rows=' + newT.rows + '）');
    ok(newT.items.length === 4, 'A③ 分頁鈕恰四顆', newT.items.length);
    for (const t of newT.items) {
      ok(t.scrollW <= t.clientW + 0.5, 'A③ 「' + t.txt + '」字沒被截（scrollW ' + t.scrollW + ' ≤ clientW ' + t.clientW + '）');
      ok(String(t.hit).includes('tourn-tab'), 'A③ 「' + t.txt + '」中心點命中自己', t.hit);
      ok(t.h === newT.items[0].h, 'A③ 「' + t.txt + '」與其他分頁等高');
    }
    ok(newT.docScrollW <= newT.docClientW, 'A④ 整頁無水平溢出', { scrollW: newT.docScrollW, clientW: newT.docClientW });
    ok(dy <= 0, 'A⑤ ⭐ 新版不會把下方內容往下推（dy=' + dy + ' ≤ 0）');

    // ── 【B】 ──
    await pg.setContent(htmlBar(), { waitUntil: 'load' });
    const bar = await pg.evaluate(PROBE_BAR);
    console.log('【B】卡片內文字 left：無色條 ' + bar.plain.txt.x + ' ／ 報名中 ' + bar.reg.txt.x + ' ／ 報到中 ' + bar.checkin.txt.x
      + '　（box-sizing=' + bar.plain.boxSizing + '、border-left=' + bar.plain.borderLeft + '、padding-left=' + bar.plain.padLeft + '）');
    table.push({ vp: vp.tag, part: 'B', txtX: [bar.plain.txt.x, bar.reg.txt.x, bar.checkin.txt.x], shadow: [bar.plain.shadow, bar.reg.shadow, bar.checkin.shadow] });
    for (const k of ['reg', 'checkin']) {
      ok(bar[k].txt.x === bar.plain.txt.x, 'B① ' + k + '：卡片內文字的 left 不變（' + bar[k].txt.x + ' vs ' + bar.plain.txt.x + '）');
      ok(bar[k].txt.w === bar.plain.txt.w, 'B① ' + k + '：卡片內文字的寬度不變');
      ok(bar[k].h3.x === bar.plain.h3.x, 'B① ' + k + '：標題的 left 不變');
      ok(bar[k].card.w === bar.plain.card.w, 'B① ' + k + '：卡片外框寬度不變');
      ok(bar[k].card.h === bar.plain.card.h, 'B① ' + k + '：卡片高度不變');
      ok(bar[k].borderLeft === bar.plain.borderLeft, 'B① ' + k + '：border-left-width 沒被動（' + bar[k].borderLeft + '）');
      ok(bar[k].padLeft === bar.plain.padLeft, 'B① ' + k + '：padding-left 沒被動（' + bar[k].padLeft + '）');
    }
    ok(bar.plain.shadow === 'none', 'B② 沒掛 class 的賽事卡**沒有**色條（' + bar.plain.shadow + '）');
    ok(/inset/.test(bar.reg.shadow) && /106,\s*184,\s*122/.test(bar.reg.shadow), 'B② 報名中＝墨綠 #6ab87a 的 inset 色條', bar.reg.shadow);
    ok(/inset/.test(bar.checkin.shadow) && /255,\s*211,\s*90/.test(bar.checkin.shadow), 'B② 報到中＝強調金 #ffd35a 的 inset 色條', bar.checkin.shadow);

    // ── 【C】 ──
    if (!CSS_CARDS_OLD) { console.log('  ⚠ 【C】拿不到 BASE 的 cards CSS，只量新版（零位移對照跳過）'); }
    let oldN = null;
    if (CSS_CARDS_OLD) { await pg.setContent(htmlNav(CSS_CARDS_OLD), { waitUntil: 'load' }); oldN = await pg.evaluate(PROBE_NAV); }
    await pg.setContent(htmlNav(CSS_CARDS_NEW), { waitUntil: 'load' });
    const newN = await pg.evaluate(PROBE_NAV);
    console.log('【C】‹ 鈕 rect ' + JSON.stringify(newN['c-prev'].rect) + '　底色 ' + newN['c-prev'].bg + '（alpha=' + alphaOf(newN['c-prev'].bg) + '）');
    table.push({ vp: vp.tag, part: 'C', prev: newN['c-prev'], next: newN['c-next'] });
    if (oldN) {
      for (const k of ['c-prev', 'c-next']) ok(eqRect(oldN[k].rect, newN[k].rect), 'C① ' + k + ' 透明化後**零位移**', { old: oldN[k].rect, now: newN[k].rect });
      ok(eqRect(oldN['c-behind'], newN['c-behind']), 'C① 箭頭後方的文字沒有位移');
      ok(oldN.docScrollW === newN.docScrollW, 'C① 頁面 scrollWidth 不變');
    }
    for (const k of ['c-prev', 'c-next']) {
      ok(newN[k].hit === k, 'C② ' + k + ' 中心點 elementFromPoint 仍命中自己（實得 ' + newN[k].hit + '）');
      ok(alphaOf(newN[k].bg) < 1, 'C③ ' + k + ' 底色帶透明度（' + newN[k].bg + '）');
      ok(alphaOf(newN[k].border) < 1, 'C③ ' + k + ' 邊框帶透明度（' + newN[k].border + '）');
      ok(newN[k].textShadow !== 'none', 'C③ ' + k + ' 有白色光暈 text-shadow（' + newN[k].textShadow + '）');
    }
    ok(newN.docScrollW <= newN.docClientW, 'C④ 卡牌 modal 無水平溢出', { scrollW: newN.docScrollW, clientW: newN.docClientW });
    await ctx.close();
  }
} finally { await browser.close(); }

writeFileSync(process.env.MEASURE_OUT || '/tmp/measure-v6303.json', JSON.stringify(table, null, 1));
console.log('\n══ v6.303 三件 UI 改善版面量測：' + (bad ? bad + ' 項不符 ✗' : '全部符合 ✓') + ' ══');
process.exit(bad ? 1 : 0);
