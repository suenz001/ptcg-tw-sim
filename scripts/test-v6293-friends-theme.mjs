// v6.293 守衛：/friends 頁（含私聊面板）改成墨綠配色 ＋ 頂端假分頁列
//
// 守什麼（⚠ 不只驗字串存在：色票對齊、分頁列版面、變數是否真的解析得出來，全部走 DOM／求值）：
//   【A】<svelte:head> 真的注入了整頁底色，而且用的是「一般 <style> 元素」不是 {@html}
//        （本頁滿是玩家自由輸入的暱稱，「零 {@html}」是 test-v6283 B3／test-v6288 E1 的紅線，不可為了換色鬆綁）。
//   【B】色碼**單一來源**：兩個檔的 <style> 剝註解後，hex 只准出現在 --fr-* 宣告行；DmPanel 一個 hex 都沒有。
//        而且每一個 --fr-* 的值都**從 src/routes/game/+page.svelte 實抽**同一條規則來比對（不 pin 字面值：
//        錦標賽改色時這裡會紅，正是「視覺一致性」要的效果）。
//   【C】分頁列：兩顆 <a>、href 正確、好友那顆帶 active；「回線上大廳」的 URL 用 game/+page.svelte
//        裡**實際存在**的分流條件求值驗證（不是我猜的）。
//   【D】⭐⭐ DOM 量測（playwright，375×812 手機直式 ＋ 1366×768 桌機）：
//        body 真的變墨綠（正對照＝拿掉注入那一行就回白底）、分頁列不折行不溢出、
//        既有元素零遮蔽、每個 var() 真的解析成墨綠（含 position:fixed 的私聊面板靠繼承拿到色票）、
//        正文對比度 ≥ 4.5:1（避免「墨綠底配暗字」這種真事故）。
//   【E】src/routes/game/+page.svelte 的 blob sha 與 BASE 逐位元相同（站長最高紅線）。
//   【F】回歸保護：friends-api.ts 仍零 setInterval；v6.291／v6.292 的 verified 閘仍在（沿用既有守衛，不重寫）。
//   【G】test chain ／ 版本一致（不 pin 版本號）。
//   【H】七個突變，每個都必須紅在**預期那一條**。
//
// ⚠ 紀律：只捕 assert.AssertionError；突變體必須紅在預期斷言；不 pin 版本號／整檔 sha256。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_PAGE = join(ROOT, 'src/routes/friends/+page.svelte');
const P_PANEL = join(ROOT, 'src/routes/friends/DmPanel.svelte');
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_PKG = join(ROOT, 'package.json');
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const PAGE = rd(P_PAGE);
const PANEL = rd(P_PANEL);
const GAME = rd(P_GAME);
const API = rd(P_API);
const PKG = rd(P_PKG);

let pass = 0, fail = 0; const skipped = [];
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 700)); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, frag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(frag),
    '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 260) + '（預期含「' + frag + '」）');
};
const mutate = (src, a, b) => {
  const n = src.split(a).length - 1;
  assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 90));
  return src.replace(a, b);
};
/** 剝 CSS/HTML 註解（色碼掃描前必做，否則「引用來源」的說明文字會被誤判成硬寫色碼）。 */
const stripCssCmt = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripHtmlCmt = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
/** 剝掉 HTML／區塊／行註解（既有守衛 test-v6288 的 stripComments 同一套；`://` 不誤傷）。 */
const stripAllCmt = (s) => stripCssCmt(stripHtmlCmt(s)).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
/** 取 .svelte 檔最後一段 <style>…</style> 的內容。 */
const styleOf = (s) => {
  const a = s.lastIndexOf('<style'), b = s.lastIndexOf('</style>');
  assert.ok(a > 0 && b > a, '抽不到 <style> 區');
  return s.slice(s.indexOf('>', a) + 1, b);
};
const headOf = (s) => {
  const a = s.indexOf('<svelte:head>'), b = s.indexOf('</svelte:head>');
  assert.ok(a >= 0 && b > a, '抽不到 <svelte:head>');
  return s.slice(a, b);
};
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const lc = (x) => String(x).toLowerCase();

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】<svelte:head> 注入整頁底色（且不是 {@html}）');
const PAGE_HEAD = headOf(PAGE);
let HEAD_STYLE = '';
await T('A1 ⭐⭐ /friends 的 <svelte:head> 有一個一般 <style> 元素，內容把 html/body 的 background-color 換成墨綠；整頁仍零 {@html}', () => {
  const m = /<style>([^<]*)<\/style>/.exec(stripHtmlCmt(PAGE_HEAD));
  assert.ok(m, 'HEAD-FAIL：<svelte:head> 裡沒有 <style> 元素 ⇒ 整頁底色仍吃 layout 的白底 baseline');
  HEAD_STYLE = m[1];
  assert.ok(/\bhtml\b/.test(HEAD_STYLE) && /\bbody\b/.test(HEAD_STYLE), '注入的 <style> 沒有同時蓋 html 與 body：' + HEAD_STYLE);
  assert.ok(/background-color:\s*#[0-9a-fA-F]{6}\s*!important/.test(HEAD_STYLE), '注入的底色沒有 !important（蓋不掉 layout 的 :global(body)）：' + HEAD_STYLE);
  assert.ok(!stripAllCmt(PAGE).includes('{@html'), '/friends 頁出現 {@html}（暱稱是玩家自由輸入 ⇒ 這是紅線）');
  assert.ok(!stripAllCmt(PANEL).includes('{@html'), 'DmPanel 出現 {@html}');
});
await T('A2 掃描器下限：<style> 區夠長、--fr-* 變數 ≥ 15 條（抽不到就不是「沒問題」，是掃描器壞了）', () => {
  const st = styleOf(PAGE);
  assert.ok(st.length > 2000, '/friends 的 <style> 只有 ' + st.length + ' 字元 ⇒ 抽取器壞了');
  const vars = [...stripCssCmt(st).matchAll(/--fr-[a-z-]+:\s*[^;]+;/g)];
  assert.ok(vars.length >= 15, '--fr-* 只抽到 ' + vars.length + ' 條 ⇒ 色票單一來源沒建立或抽取器壞了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】色碼單一來源 ＋ 與錦標賽色票逐條對齊');
/** 抽 --fr-* 的宣告（只認「一行一個、值是 6 碼 hex」的形狀）。 */
function frVars(pageSrc) {
  const st = stripCssCmt(styleOf(pageSrc));
  const out = new Map();
  for (const m of st.matchAll(/^\s*(--fr-[a-z-]+):\s*(#[0-9a-fA-F]{6});\s*$/gm)) out.set(m[1], lc(m[2]));
  return out;
}
function assertSingleSource(pageSrc, panelSrc) {
  assert.ok(!/#fff\b/i.test(pageSrc) && !/#f4f4f6/i.test(pageSrc), '/friends 頁仍有 #fff／#f4f4f6');
  assert.ok(!/#fff\b/i.test(panelSrc) && !/#f4f4f6/i.test(panelSrc), 'DmPanel 仍有 #fff／#f4f4f6');
  const panelStyle = stripCssCmt(styleOf(panelSrc));
  const panelHex = panelStyle.match(HEX) || [];
  assert.deepStrictEqual(panelHex, [], 'DmPanel 的 <style> 出現硬寫色碼（色票必須單一來源）：' + panelHex.join(' '));
  assert.ok(/var\(--fr-card-bg\)/.test(panelStyle) && /var\(--fr-fg\)/.test(panelStyle), 'DmPanel 沒有吃 --fr-* 色票');
  const pageStyle = stripCssCmt(styleOf(pageSrc));
  for (const line of pageStyle.split('\n')) {
    if (!HEX.test(line)) { HEX.lastIndex = 0; continue; }
    HEX.lastIndex = 0;
    assert.ok(/^\s*--fr-[a-z-]+:\s*#[0-9a-fA-F]{6};\s*$/.test(line),
      '/friends 的 <style> 在變數宣告以外的地方硬寫色碼（色票必須單一來源）：' + line.trim());
  }
}
await T('B1 ⭐⭐ 兩個檔零 #fff／零 #f4f4f6；DmPanel 的 <style> 零色碼；/friends 的色碼只出現在 --fr-* 宣告行', () => assertSingleSource(PAGE, PANEL));

/** 從 game/+page.svelte 抽某條規則的宣告 body（selector 需逐字給，含 `{`）。 */
function gameRule(sel) {
  const i = GAME.indexOf(sel);
  assert.ok(i > 0, '抽不到 game/+page.svelte 的規則 ' + sel + '（寫法變了？掃描器要修）');
  const j = GAME.indexOf('}', i);
  return GAME.slice(i + sel.length, j);
}
const declOf = (body, prop) => {
  const m = new RegExp('(?:^|;)\\s*' + prop + ':\\s*([^;]+)').exec(body);
  assert.ok(m, '規則裡沒有 ' + prop + '：' + body.slice(0, 160));
  return m[1].trim();
};
await T('B2 ⭐⭐⭐ 每個 --fr-* 的值都與 src/routes/game/+page.svelte 的**同一條規則**逐字相同（錦標賽改色 ⇒ 這裡會紅）', () => {
  const V = frVars(PAGE);
  const tab = gameRule('.tourn-tab {');
  const tabHover = gameRule('.tourn-tab:hover {');
  const tabOn = gameRule('.tourn-tab.active {');
  const card = gameRule('.tourn-lb-card {');
  const input = gameRule('.tourn-field .deck-select, .tourn-field .name-input {');
  const field = gameRule('.tourn-field {');
  const email = gameRule('.tourn-pf-email {');
  const chatHead = gameRule('.tourn-chat-head {');
  const regOk = gameRule('.reg-ok {');
  const gameHeadBg = /background-color:\s*(#[0-9a-fA-F]{6})/.exec(headOf(GAME));
  assert.ok(gameHeadBg, 'game/+page.svelte 的 <svelte:head> 抽不到底色（寫法變了？）');
  const grad = /linear-gradient\(180deg,\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\)/.exec(tabOn);
  assert.ok(grad, '.tourn-tab.active 的漸層抽不到：' + tabOn);
  const cancel = /\.sc-cancel[^{]*\{\s*color:\s*(#[0-9a-fA-F]{6})/.exec(GAME);
  assert.ok(cancel, '抽不到 .sc-cancel 的警示紅');
  const sys = /\.tcmsg\.tcsys \{ color: (#[0-9a-fA-F]{6}); \}/.exec(GAME);
  assert.ok(sys, '抽不到 .tcmsg.tcsys 的強調金');
  const want = {
    '--fr-bg': lc(gameHeadBg[1]),
    '--fr-fg': lc(declOf(input, 'color')),
    '--fr-label': lc(declOf(field, 'color')),
    '--fr-dim': lc(declOf(email, 'color')),
    '--fr-card-bg': lc(declOf(card, 'background')),
    '--fr-card-bd': lc(/1px solid (#[0-9a-fA-F]{6})/.exec(declOf(card, 'border'))[1]),
    '--fr-tab-bg': lc(declOf(tab, 'background')),
    '--fr-tab-bd': lc(/1px solid (#[0-9a-fA-F]{6})/.exec(declOf(tab, 'border'))[1]),
    '--fr-tab-fg': lc(declOf(tab, 'color')),
    '--fr-tab-hover-bg': lc(declOf(tabHover, 'background')),
    '--fr-tab-on-from': lc(grad[1]),
    '--fr-tab-on-to': lc(grad[2]),
    '--fr-tab-on-fg': lc(declOf(tabOn, 'color')),
    '--fr-tab-on-bd': lc(declOf(tabOn, 'border-color')),
    '--fr-gold': lc(sys[1]),
    '--fr-ok': lc(declOf(regOk, 'color')),
    '--fr-danger': lc(cancel[1]),
    '--fr-bubble-them': lc(declOf(chatHead, 'background')),
    '--fr-bubble-me': lc(grad[1]),
  };
  const got = {};
  for (const k of Object.keys(want)) got[k] = V.get(k);
  assert.deepStrictEqual(got, want, '色票與錦標賽不一致（左＝/friends 實際，右＝game/+page.svelte 抽出來的）');
});
await T('B2b 掃描器自驗：抽出來的錦標賽色票不是空的（≥ 12 個相異色碼），且不含 #ffffff', () => {
  const V = frVars(PAGE);
  const uniq = new Set(V.values());
  assert.ok(uniq.size >= 12, '只抽到 ' + uniq.size + ' 個相異色碼 ⇒ 掃描器壞了');
  assert.ok(![...uniq].some((c) => c === '#ffffff'), '色票裡混進白色');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】頂端假分頁列：結構、href、回大廳的 URL 正確性');
function tabsOf(pageSrc) {
  const src = stripHtmlCmt(pageSrc);
  const i = src.indexOf('<nav class="fr-tabs"');
  assert.ok(i > 0, 'HEAD-FAIL：找不到 <nav class="fr-tabs">（分頁列沒做）');
  const j = src.indexOf('</nav>', i);
  const nav = src.slice(i, j + 6);
  const tabs = [...nav.matchAll(/<a class="fr-tab([^"]*)" href="([^"]+)"([^>]*)>([^<]*)<\/a>/g)]
    .map((m) => ({ cls: m[1].trim(), href: m[2], attrs: m[3], text: m[4] }));
  return { nav, tabs };
}
function assertTabs(pageSrc) {
  const { nav, tabs } = tabsOf(pageSrc);
  assert.strictEqual(tabs.length, 2, '分頁列應恰兩顆，抽到 ' + tabs.length + '：' + nav.slice(0, 300));
  assert.ok(!/\{#each/.test(nav), '分頁列不可用 {#each}（test-v6288 E1 要求本頁每個 each 都用 (r.fid) 當 key）');
  assert.ok(!/role="tab"/.test(nav) && !/role="tablist"/.test(nav),
    '這一版是連結不是真分頁，不可對輔助科技謊稱 role="tab"／"tablist"：' + nav.slice(0, 200));
  const lobby = tabs[0], me = tabs[1];
  assert.ok(lobby.text.includes('線上連線對戰'), '第一顆不是「線上連線對戰」：' + lobby.text);
  assert.ok(me.text.includes('好友'), '第二顆不是「好友名單」：' + me.text);
  assert.strictEqual(lobby.href, '{base}/game?mode=online', '回大廳的 href 不對：' + lobby.href);
  assert.strictEqual(me.href, '{base}/friends', '好友那顆的 href 不對：' + me.href);
  assert.strictEqual(lobby.cls, '', '線上對戰那顆不該有 active：' + lobby.cls);
  assert.strictEqual(me.cls, 'active', '好友那顆沒有 active 樣式：「' + me.cls + '」');
  assert.ok(/aria-current="page"/.test(me.attrs), '好友那顆缺 aria-current="page"');
  return { lobby, me };
}
await T('C1 ⭐⭐ 分頁列恰兩顆 <a>、文案／href 正確、好友那顆帶 active＋aria-current、不用 {#each}、不假冒 role="tab"', () => { assertTabs(PAGE); });
await T('C2 ⭐⭐⭐ 「回線上大廳」的 URL 用 game/+page.svelte **實際存在**的分流條件求值驗證（不是我猜的）；附反例', () => {
  // game/+page.svelte onMount 內的 v4.935 分流：`?mode=online` ⇒ mode='online'
  const m = /const params = new URLSearchParams\(window\.location\.search\);\s*\n\s*if \(params\.get\('([a-z]+)'\) === '([a-z]+)'\) \{\s*\n\s*mode = '([a-z]+)';/.exec(GAME);
  assert.ok(m, 'game/+page.svelte 的 ?mode=online 分流抽不到（寫法變了 ⇒ 這個 href 可能已經沒用）');
  const [, key, val, assigned] = m;
  assert.strictEqual(assigned, 'online', '分流賦的值不是 online：' + assigned);
  const { lobby } = assertTabs(PAGE);
  const run = (href) => {
    const u = new URL('https://x' + href.replace('{base}', ''));
    return new URLSearchParams(u.search).get(key) === val;   // ＝ game 頁那一行的判斷
  };
  assert.strictEqual(run(lobby.href), true, '分頁列的 href「' + lobby.href + '」進不了線上大廳（會停在模式選擇畫面）');
  assert.strictEqual(run('{base}/game'), false, '反例失效：沒帶 query 也被判成能進大廳 ⇒ 上一條是恆真式');
  assert.strictEqual(run('{base}/game?mode=local'), false, '反例失效：mode=local 也被判成 online');
});
await T('C3 舊的重複入口「線上對戰 →」（.to-game）已移除，且它的 CSS 規則沒有留成死碼', () => {
  assert.ok(!PAGE.includes('to-game'), '/friends 頁還留著 .to-game（與分頁列重複，且它指向模式選擇畫面不是大廳）');
});
await T('C4 分頁列在 <main> 內、且排在 .page-head 之後、四個好友區塊之前（頂端）', () => {
  const src = stripHtmlCmt(PAGE);
  const iMain = src.indexOf('<main>'), iHead = src.indexOf('<header class="page-head">');
  const iNav = src.indexOf('<nav class="fr-tabs"'), iAdd = src.indexOf('<section class="add">');
  assert.ok(iMain > 0 && iHead > iMain && iNav > iHead, '分頁列不在 .page-head 之後：' + [iMain, iHead, iNav].join(','));
  assert.ok(iAdd > iNav, '分頁列排在好友區塊之後（不是頂端）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】DOM 量測（375×812 手機直式 ／ 1366×768 桌機）');
/** fixture：layout 的白底 baseline ＋ 本頁 <svelte:head> 注入的那一段 ＋ 兩個檔的 <style>。 */
const LAYOUT_BASELINE = 'body { margin: 0; background: #f4f4f6; }';   // ＝ src/routes/+layout.svelte 的 :global(body)
const NAV_HTML = (pageSrc) => tabsOf(pageSrc).nav.replace(/\{base\}/g, '');
const FIXTURE_BODY = (pageSrc) => `
<main>
  <header class="page-head" id="x-head">
    <a href="/" class="back" id="x-back">← 首頁</a>
    <h1 id="x-h1">👥 好友 <span class="version-tag">v6.293</span></h1>
  </header>
  ${NAV_HTML(pageSrc)}
  <section class="add" id="x-add">
    <h2>用 email 加好友</h2>
    <p class="hint">輸入對方登入本站用的 email，對方確認後就會成為好友。</p>
    <form class="add-form"><input type="email" placeholder="對方的 email" id="x-input" /><button class="primary" id="x-primary">送出邀請</button></form>
    <p class="ok" id="x-ok">邀請已送出，請等待對方確認。</p>
    <p class="error" id="x-err">請先以 email 帳號登入。</p>
  </section>
  <section class="group" id="x-group">
    <h2>好友 <span class="count">2 / 100</span></h2>
    <ul class="rows">
      <li class="row" id="x-row"><span class="nick" id="x-nick">小明</span><span class="meta" id="x-meta">對戰中加入・2026-09-03</span><span class="spacer"></span>
        <button class="small" id="x-dm">💬 私聊</button><button class="small">解除好友</button><button class="small danger" id="x-danger">封鎖</button></li>
      <li class="row"><span class="nick">AVeryLongNicknameWithoutAnySpace1234567890</span><span class="meta">以 email 加入</span><span class="spacer"></span>
        <span class="confirm" id="x-confirm">確定解除好友？雙方名單都會移除。</span><button class="small danger">確定解除</button><button class="small">取消</button></li>
    </ul>
  </section>
  <p class="notice" id="x-notice">好友功能需要以 <b>email 帳號</b>登入才能使用。<a href="#x" id="x-noticea">www.ptcg-tw-sim.com</a></p>
  <section class="dm-panel desktop" aria-label="私聊" id="x-dm-panel">
    <header class="dm-head"><span class="dm-title">💬 <span class="dm-nick">小明</span></span><span class="dm-slow" id="x-slow">已放慢更新</span><button class="dm-close">✕</button></header>
    <div class="dm-list"><div class="dm-msg theirs"><span class="dm-bubble" id="x-bub-them">你好</span><span class="dm-ts" id="x-ts">09/03 12:00</span></div>
      <div class="dm-msg mine"><span class="dm-bubble" id="x-bub-me">安安</span><span class="dm-ts">09/03 12:01</span></div></div>
    <p class="dm-notice" id="x-dmnotice">傳太快了，請稍候。</p>
    <form class="dm-form"><input type="text" id="x-dminput" placeholder="輸入訊息（最多 200 字）" /><button class="dm-send" id="x-dmsend">送出</button></form>
  </section>
</main>`;
const pageHtmlFor = (pageSrc, panelSrc, withHead) => `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">`
  + `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  + `<style>:root{--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}${LAYOUT_BASELINE}</style>`
  + (withHead ? `<style>${/<style>([^<]*)<\/style>/.exec(stripHtmlCmt(headOf(pageSrc)))[1]}</style>` : '')
  + `<style>${styleOf(pageSrc)}\n${styleOf(panelSrc)}</style>`
  + `</head><body>${FIXTURE_BODY(pageSrc)}</body></html>`;

const VPS = [{ w: 375, h: 812, mobile: true, tag: '375×812 手機直式' }, { w: 1366, h: 768, mobile: false, tag: '1366×768 桌機' }];
const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const lum = (c) => { const f = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const contrast = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex2rgb = (h) => 'rgb(' + [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';

let chromium = null;
try { chromium = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium; } catch { chromium = null; }
if (!chromium) {
  skipped.push('【D】DOM 量測（沒有 playwright 模組）');
  console.log('  ⚠⚠ SKIP 【D】：這台機器沒有 Playwright ⇒ DOM 量測沒有跑（沙盒證據見 docs/changelog-internal.md v6.293）');
} else {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
  try {
    const probe = async (pg, html) => {
      await pg.setContent(html, { waitUntil: 'load' });
      return pg.evaluate(() => {
        const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
        const cs = (el) => getComputedStyle(el);
        const nav = document.querySelector('.fr-tabs');
        const tabs = [...document.querySelectorAll('.fr-tab')];
        const hitOf = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return h ? (h.className || h.tagName) : null; };
        const o = {
          bodyBg: cs(document.body).backgroundColor,
          htmlBg: cs(document.documentElement).backgroundColor,
          mainColor: cs(document.querySelector('main')).color,
          navWrap: cs(nav).flexWrap, navRect: R(nav),
          tabs: tabs.map((t) => ({
            rect: R(t), wrap: cs(t).whiteSpace, bg: cs(t).backgroundColor, bgImg: cs(t).backgroundImage,
            fg: cs(t).color, bd: cs(t).borderTopColor, scrollW: t.scrollWidth, clientW: t.clientWidth, hit: hitOf(t),
          })),
          docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
          rects: {}, colors: {},
        };
        for (const id of ['x-head', 'x-add', 'x-group', 'x-row', 'x-notice', 'x-dm-panel', 'x-back', 'x-primary', 'x-input', 'x-danger']) {
          const el = document.getElementById(id); o.rects[id] = R(el);
          o.colors[id] = { bg: cs(el).backgroundColor, fg: cs(el).color, bd: cs(el).borderTopColor, bgImg: cs(el).backgroundImage };
        }
        for (const id of ['x-nick', 'x-meta', 'x-ok', 'x-err', 'x-confirm', 'x-bub-them', 'x-bub-me', 'x-dmsend', 'x-dminput', 'x-dmnotice', 'x-ts', 'x-noticea']) {
          const el = document.getElementById(id); o.colors[id] = { bg: cs(el).backgroundColor, fg: cs(el).color, bgImg: cs(el).backgroundImage };
        }
        return o;
      });
    };
    const V = frVars(PAGE);
    for (const vp of VPS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
      const pg = await ctx.newPage();
      const on = await probe(pg, pageHtmlFor(PAGE, PANEL, true));
      const off = await probe(pg, pageHtmlFor(PAGE, PANEL, false));   // 正對照：拿掉 <svelte:head> 那一行

      await T('D1 ' + vp.tag + ' ⭐⭐ body 真的是墨綠（正對照：拿掉 <svelte:head> 注入那一行 ⇒ 回 layout 的白底）', () => {
        assert.strictEqual(on.bodyBg, hex2rgb(V.get('--fr-bg')), 'body 底色不是 --fr-bg');
        assert.strictEqual(off.bodyBg, 'rgb(244, 244, 246)', '正對照失效：沒有注入時 body 竟然不是 layout 的白底 ⇒ D1 是恆真式');
      });
      await T('D2 ' + vp.tag + ' ⭐⭐ 分頁列不折行：兩顆同一列、容器高＝單顆高、字沒被截、flex/white-space 都是 nowrap、整頁無水平溢出', () => {
        assert.strictEqual(on.tabs.length, 2, '量到的 .fr-tab 不是兩顆');
        const [a, b] = on.tabs;
        assert.strictEqual(a.rect.y, b.rect.y, '兩顆分頁鈕不在同一列（折行了）：' + a.rect.y + ' vs ' + b.rect.y);
        assert.ok(Math.abs(on.navRect.h - a.rect.h) <= 1, '分頁列高度 ' + on.navRect.h + ' ≠ 單顆高度 ' + a.rect.h + ' ⇒ 折行');
        assert.strictEqual(on.navWrap, 'nowrap', '.fr-tabs 的 flex-wrap 不是 nowrap：' + on.navWrap);
        for (const t of on.tabs) {
          assert.strictEqual(t.wrap, 'nowrap', '.fr-tab 的 white-space 不是 nowrap（字會折成兩行）：' + t.wrap);
          assert.ok(t.scrollW <= t.clientW + 1, '分頁鈕的文字被截斷（scrollWidth ' + t.scrollW + ' > clientWidth ' + t.clientW + '）');
          assert.ok(t.rect.x >= 0 && t.rect.x + t.rect.w <= vp.w + 0.5, '分頁鈕超出畫面：' + JSON.stringify(t.rect));
        }
        assert.ok(on.docScrollW <= on.docClientW, '整頁出現水平捲動（' + on.docScrollW + ' > ' + on.docClientW + '）');
        console.log('      量測 ' + vp.tag + '：分頁列 ' + JSON.stringify(on.navRect)
          + ' ｜左 ' + JSON.stringify(a.rect) + ' 文字寬 ' + a.scrollW + '/' + a.clientW
          + ' ｜右 ' + JSON.stringify(b.rect) + ' 文字寬 ' + b.scrollW + '/' + b.clientW
          + ' ｜頁寬 ' + on.docScrollW + '/' + on.docClientW);
      });
      await T('D3 ' + vp.tag + ' ⭐⭐ 零遮蔽：兩顆分頁鈕中心點都命中自己；分頁列與既有元素（頁首／加好友／好友區／說明）矩形零重疊', () => {
        for (const t of on.tabs) assert.ok(String(t.hit).includes('fr-tab'), '分頁鈕中心點被別的東西蓋住：' + t.hit);
        const overlap = (p, q) => !(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y);
        for (const id of ['x-head', 'x-add', 'x-group', 'x-notice']) {
          assert.ok(!overlap(on.navRect, on.rects[id]), '分頁列與 ' + id + ' 重疊：' + JSON.stringify(on.navRect) + ' vs ' + JSON.stringify(on.rects[id]));
          assert.ok(on.rects[id].h > 0 && on.rects[id].w > 0, id + ' 被壓成 0（fixture 壞了或版面炸了）');
          assert.ok(on.rects[id].x + on.rects[id].w <= vp.w + 0.5, id + ' 超出畫面寬：' + JSON.stringify(on.rects[id]));
        }
      });
      await T('D4 ' + vp.tag + ' ⭐⭐⭐ var() 真的解析成墨綠：分頁鈕／active 漸層／卡片／輸入框／按鈕，以及 position:fixed 的私聊面板（靠繼承拿到色票）', () => {
        const [a, b] = on.tabs;
        assert.strictEqual(a.bg, hex2rgb(V.get('--fr-tab-bg')), '未選中的分頁鈕底色不對');
        assert.strictEqual(a.fg, hex2rgb(V.get('--fr-tab-fg')), '未選中的分頁鈕字色不對');
        assert.strictEqual(a.bd, hex2rgb(V.get('--fr-tab-bd')), '未選中的分頁鈕框色不對');
        assert.ok(b.bgImg.includes('linear-gradient'), 'active 分頁鈕沒有漸層：' + b.bgImg);
        assert.ok(b.bgImg.includes(hex2rgb(V.get('--fr-tab-on-from'))) && b.bgImg.includes(hex2rgb(V.get('--fr-tab-on-to'))), 'active 漸層的色停不對：' + b.bgImg);
        assert.strictEqual(b.bd, hex2rgb(V.get('--fr-tab-on-bd')), 'active 分頁鈕框色不對');
        assert.strictEqual(b.fg, hex2rgb(V.get('--fr-tab-on-fg')), 'active 分頁鈕字色不對');
        assert.strictEqual(on.colors['x-row'].bg, hex2rgb(V.get('--fr-card-bg')), '好友列底色不對');
        assert.strictEqual(on.colors['x-row'].bd, hex2rgb(V.get('--fr-card-bd')), '好友列框色不對');
        assert.strictEqual(on.colors['x-add'].bg, hex2rgb(V.get('--fr-card-bg')), '加好友區底色不對');
        assert.strictEqual(on.colors['x-input'].bg, hex2rgb(V.get('--fr-tab-bg')), '輸入框底色不對');
        assert.strictEqual(on.colors['x-input'].fg, hex2rgb(V.get('--fr-fg')), '輸入框字色不對');
        assert.ok(on.colors['x-primary'].bgImg.includes('linear-gradient'), '主要按鈕沒有漸層');
        assert.strictEqual(on.colors['x-danger'].fg, hex2rgb(V.get('--fr-danger')), '危險按鈕字色不對');
        assert.strictEqual(on.colors['x-ok'].fg, hex2rgb(V.get('--fr-ok')), '成功訊息字色不對');
        assert.strictEqual(on.colors['x-confirm'].fg, hex2rgb(V.get('--fr-gold')), '二次確認文字色不對');
        assert.strictEqual(on.colors['x-meta'].fg, hex2rgb(V.get('--fr-dim')), '次要資訊字色不對');
        // ⭐⭐ 私聊面板是 position:fixed，但 DOM 上仍在 <main> 底下 ⇒ 自訂屬性必須繼承得到
        assert.strictEqual(on.colors['x-dm-panel'].bg, hex2rgb(V.get('--fr-card-bg')), '私聊面板底色不對（--fr-* 沒有繼承到 fixed 面板？）');
        assert.strictEqual(on.colors['x-dm-panel'].fg, hex2rgb(V.get('--fr-fg')), '私聊面板字色不對');
        assert.strictEqual(on.colors['x-bub-them'].bg, hex2rgb(V.get('--fr-bubble-them')), '對方訊息泡泡底色不對');
        assert.strictEqual(on.colors['x-bub-me'].bg, hex2rgb(V.get('--fr-bubble-me')), '自己訊息泡泡底色不對');
        assert.ok(on.colors['x-dmsend'].bgImg.includes('linear-gradient'), '送出鈕沒有漸層');
        assert.strictEqual(on.colors['x-dminput'].bg, hex2rgb(V.get('--fr-tab-bg')), '私聊輸入框底色不對');
      });
      await T('D5 ' + vp.tag + ' ⭐ 讀得到：正文／暱稱／連結／按鈕對比度 ≥ 4.5:1，次要資訊 ≥ 3:1（墨綠底配暗字是真事故）', () => {
        const pageBg = on.bodyBg, cardBg = on.colors['x-row'].bg;
        const check = (name, fg, bg, min) => assert.ok(contrast(fg, bg) >= min,
          name + ' 對比度只有 ' + contrast(fg, bg).toFixed(2) + ':1（需 ≥ ' + min + '）fg=' + fg + ' bg=' + bg);
        check('正文', on.mainColor, pageBg, 4.5);
        check('暱稱', on.colors['x-nick'].fg, cardBg, 4.5);
        check('「← 首頁」', on.colors['x-back'].fg, pageBg, 4.5);
        check('未選中分頁鈕', on.tabs[0].fg, on.tabs[0].bg, 4.5);
        check('已選中分頁鈕', on.tabs[1].fg, hex2rgb(V.get('--fr-tab-on-to')), 4.5);
        check('錯誤訊息', on.colors['x-err'].fg, cardBg, 4.5);
        check('成功訊息', on.colors['x-ok'].fg, cardBg, 4.5);
        check('說明區連結', on.colors['x-noticea'].fg, on.colors['x-notice'].bg, 4.5);
        check('私聊訊息', on.colors['x-dm-panel'].fg, on.colors['x-bub-them'].bg, 4.5);
        check('次要資訊', on.colors['x-meta'].fg, cardBg, 3);
        check('時間戳', on.colors['x-ts'].fg, cardBg, 3);
      });
      await ctx.close();
    }
  } finally { await browser.close(); }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】對戰頁一個位元都沒動');
const BASE_SHA = '625119f6256a4b1111aa2f207e9e7ff6bf7ab227';   // v6.292（本版的 BASE）
await T('E1 ⭐⭐⭐ src/routes/game/+page.svelte 的 blob sha 與 BASE 逐位元相同', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6293 E1 game/+page.svelte blob 比對', '需要歷史 commit'); skipped.push('E1（淺複製）'); return; }
  const want = execFileSync('git', ['-C', ROOT, 'rev-parse', BASE_SHA + ':src/routes/game/+page.svelte']).toString().trim();
  const got = execFileSync('git', ['-C', ROOT, 'hash-object', join(ROOT, 'src/routes/game/+page.svelte')]).toString().trim();
  assert.strictEqual(got, want, '對戰頁被動到了（站長最高紅線）：' + got + ' ≠ ' + want);
});
await T('E2 掃描器自驗：同一支 hash-object 對「多一個空白的內容」會算出不同 sha（上一條不是恆真式）', () => {
  const a = execFileSync('git', ['-C', ROOT, 'hash-object', '--stdin'], { input: 'x' }).toString().trim();
  const b = execFileSync('git', ['-C', ROOT, 'hash-object', '--stdin'], { input: 'x ' }).toString().trim();
  assert.notStrictEqual(a, b, 'hash-object 自驗失敗');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】回歸保護（沿用既有守衛的判準，不重寫）');
await T('F1 friends-api.ts 仍零 setInterval／零 setTimeout（零輪詢；剝註解後數）', () => {
  const s = API.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  assert.strictEqual((s.match(/setInterval/g) || []).length, 0, 'friends-api.ts 出現 setInterval');
  assert.strictEqual((s.match(/setTimeout/g) || []).length, 0, 'friends-api.ts 出現 setTimeout');
});
await T('F2 v6.291／v6.292 的 verified 閘仍在：伺服器區塊恰 9 行 tournRequireVerified(，且兩支守衛都還在 test chain', () => {
  const SRV = rd(join(ROOT, 'oracle-admin/server_admin_patch.js'));
  const n = (SRV.match(/if \(tournRequireVerified\(id, res, '/g) || []).length;
  assert.strictEqual(n, 9, 'verified 閘的行數變了（v6.291 三支 ＋ v6.292 六支 ＝ 9）：' + n);
  assert.ok(/function tournRequireVerified\(/.test(SRV), 'tournRequireVerified helper 不見了');
  for (const t of ['test-v6291-tourn-verified-gate.mjs', 'test-v6292-tourn-verified-gate2.mjs'])
    assert.ok(PKG.includes(t), t + ' 不在 test chain（gate 沒人守了）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】test chain ／ 版本一致');
await T('G1 本守衛在 package.json 的 test chain；version.ts 與 admin.html SITE_VERSION_HINT 一致（不 pin 版本號）', () => {
  assert.ok(PKG.includes('test-v6293-friends-theme.mjs'), '本守衛沒進 test chain');
  const V = /VERSION = '([\d.]+)'/.exec(rd(join(ROOT, 'src/lib/version.ts')))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(rd(join(ROOT, 'oracle-admin/admin.html')))[1];
  assert.strictEqual(H, V, 'admin.html hint ' + H + ' ≠ version.ts ' + V);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】突變（每個都必須紅在預期那一條）');
await T('H1 突變：DmPanel 的面板底色改回 #fff ⇒ B1 紅在「仍有 #fff」', () =>
  mutantMustBreak('DmPanel #fff', () => assertSingleSource(PAGE, mutate(PANEL, 'background: var(--fr-card-bg);', 'background: #fff;')), '仍有 #fff'));
await T('H2 突變：/friends 的 .row 直接硬寫色碼（不走變數）⇒ B1 紅在「變數宣告以外的地方硬寫色碼」', () =>
  mutantMustBreak('硬寫色碼', () => assertSingleSource(mutate(PAGE, 'background: var(--fr-card-bg); border: 1px solid var(--fr-card-bd); border-radius: 8px; padding: 8px 10px; }',
    'background: #142414; border: 1px solid var(--fr-card-bd); border-radius: 8px; padding: 8px 10px; }'), PANEL), '硬寫色碼'));
await T('H3 突變：回大廳的 href 少了 ?mode=online ⇒ C1 紅在「回大廳的 href 不對」', () =>
  mutantMustBreak('href 少 query', () => assertTabs(mutate(PAGE, 'href="{base}/game?mode=online"', 'href="{base}/game"')), '回大廳的 href 不對'));
await T('H4 突變：active 掛到「線上連線對戰」那一顆 ⇒ C1 紅在「不該有 active」', () =>
  mutantMustBreak('active 掛錯顆', () => assertTabs(mutate(PAGE, '<a class="fr-tab" href="{base}/game?mode=online">', '<a class="fr-tab active" href="{base}/game?mode=online">')), '不該有 active'));
await T('H5 突變：好友那一顆拿掉 active ⇒ C1 紅在「沒有 active 樣式」', () =>
  mutantMustBreak('少 active', () => assertTabs(mutate(PAGE, '<a class="fr-tab active" href="{base}/friends"', '<a class="fr-tab" href="{base}/friends"')), '沒有 active 樣式'));
await T('H6 突變：分頁列改用 {#each} ⇒ C1 紅在「不可用 {#each}」', () =>
  mutantMustBreak('用 each', () => assertTabs(mutate(PAGE, '<nav class="fr-tabs" aria-label="線上對戰與好友">', '<nav class="fr-tabs" aria-label="線上對戰與好友">{#each t as x}')), '不可用 {#each}'));
await T('H7 突變：--fr-tab-fg 抄錯一個字 ⇒ B2 紅在「色票與錦標賽不一致」', () =>
  mutantMustBreak('色票抄錯', () => {
    const bad = mutate(PAGE, '--fr-tab-fg: #9fdca0;', '--fr-tab-fg: #9fdca1;');
    const V = frVars(bad);
    assert.strictEqual(V.get('--fr-tab-fg'), lc(declOf(gameRule('.tourn-tab {'), 'color')), '色票與錦標賽不一致：--fr-tab-fg');
  }, '色票與錦標賽不一致'));
await T('H8 突變：<svelte:head> 的注入改成沒有 !important ⇒ A1 紅在「沒有 !important」', () =>
  mutantMustBreak('少 !important', () => {
    const bad = mutate(PAGE, 'background-color: #162816 !important;', 'background-color: #162816;');
    const m = /<style>([^<]*)<\/style>/.exec(stripHtmlCmt(headOf(bad)));
    assert.ok(m, '找不到 <style>');
    assert.ok(/background-color:\s*#[0-9a-fA-F]{6}\s*!important/.test(m[1]), '注入的底色沒有 !important（蓋不掉 layout 的 :global(body)）：' + m[1]);
  }, '沒有 !important'));

// ═══════════════════════════════════════════════════════════════════════════
if (skipped.length) console.log('\n⚠⚠ 本次 SKIP：' + skipped.join('；') + ' —— 這幾段在這台機器上沒有在守');
console.log('\n══ v6.293 好友頁墨綠配色＋分頁列守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
