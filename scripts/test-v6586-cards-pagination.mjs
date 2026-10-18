#!/usr/bin/env node
// v6.586：編譯真正的 /cards 與分頁元件，在瀏覽器操作；不以假清單代替產品行為。
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { pwLaunch } from './lib/pw.mjs';
import { readBaseBlob, hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { V6586_CARDS_REVERT_PAIRS } from './lib/revert-v6586-cards.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = 'fd81d9b7aa823ffac0ee7c61cb1e2a207f3e3e25';
const PAGE = 'src/routes/cards/+page.svelte';
const PAGINATION = 'src/lib/cards/pagination.ts';
const PAGER = 'src/lib/cards/CardsPager.svelte';
const rd = p => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const source = rd(PAGE), helper = rd(PAGINATION), pager = rd(PAGER);
// 所有突變只傳給記憶體內的編譯器；保留原始 bytes，最後確認沒有落盤污染。
const originalBytes = [PAGE, PAGINATION, PAGER].map(p => [p, readFileSync(join(ROOT, p))]);
let pass = 0, fail = 0;
function ok(name, yes, detail = '') {
  if (yes) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.error('  FAIL ' + name + ' ' + detail); }
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const baseRead = p => { const r = readBaseBlob(ROOT, BASE, p); if (!r.ok) throw new Error('BASE 讀取失敗：' + p); return r.out.replace(/\r\n/g, '\n'); };

// 還原對照是逐字的，不以更新整檔指紋取代原版面鎖。
if (hasBaseCommit(ROOT, BASE)) {
  let restored = source;
  for (const [now, prev] of V6586_CARDS_REVERT_PAIRS) {
    if (restored.split(now).length !== 2) throw new Error('還原錨點失效：' + now.slice(0, 70));
    restored = restored.replace(now, prev);
  }
  ok('Rule 40：本版改動逐字還原後等於 v6.585', restored !== source && restored === baseRead(PAGE));
  const original = baseRead('PTCG RULES/PTCG_RULES.md').split('\n');
  const corrected = rd('PTCG RULES/PTCG_RULES.md').split('\n');
  const changed = original.flatMap((v, i) => v !== corrected[i] ? [i + 1] : []);
  ok('原 Q&A 文字與行號保留，僅校正已核對的十行摘要', corrected.length === original.length && equal(changed, [6, 94, 95, 96, 102, 107, 110, 505, 549, 551]), String(changed));
  for (const [name, judge] of [
    ['先攻首回合照常抽牌', s => /包含先攻第一回合/.test(s.split('\n')[95])],
    ['完整卡名不同分開計算', s => /完整卡名不同/.test(s.split('\n')[504])],
    ['先完成效果及昏厥才取獎賞', s => /先完成招式效果與昏厥處理，再獲得獎賞卡/.test(s.split('\n')[550])],
  ]) {
    ok('文件：' + name, judge(corrected.join('\n')));
    ok('文件 HEAD-FAIL：' + name, !judge(original.join('\n')));
  }
} else shallowSkip('v6586：版面還原／規則文件 HEAD-FAIL', '需要 v6.585 歷史');

// 純函式測邊界，包含惡意／不完整網址；測的是正式產品模組。
const loadHelper = async text => {
  const r = await build({ stdin: { contents: text, loader: 'ts' }, write: false, bundle: true, format: 'esm', logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
};
const H = await loadHelper(helper);
ok('頁碼：只接受正整數，拒絕負數／小數／溢位／空值', ['', '?page=0', '?page=-1', '?page=1.5', '?page=1e3', '?page=999999999999999999'].every(s => H.readCardsPage(s) === 1) && H.readCardsPage('?page=22') === 22);
ok('範圍：空結果不出現負頁碼，超大頁碼夾回最後一頁', equal(H.cardsPageRange(0, 9, 240), { page: 1, pages: 1, start: 0, end: 0, total: 0 }) && equal(H.cardsPageRange(481, 999, 240), { page: 3, pages: 3, start: 480, end: 481, total: 481 }));
ok('網址：保留篩選／卡片／未知參數，第一頁移除 page', H.writeCardsPageSearch('?set=ALL&q=ex&card=123&utm=x', 2) === '?set=ALL&q=ex&card=123&utm=x&page=2' && H.writeCardsPageSearch('?set=ALL&page=2&q=ex', 1) === '?set=ALL&q=ex');

const live = new Set(JSON.parse(rd('static/cards/index.json')).map(s => s.code));
const cardMap = new Map();
for (const name of readdirSync(join(ROOT, 'static/cards'))) {
  if (!name.endsWith('.json') || !live.has(name.slice(0, -5))) continue;
  for (const card of JSON.parse(rd('static/cards/' + name))) if (card?.id && ['H', 'I', 'J'].includes(card.regulationMark)) cardMap.set(String(card.id), card);
}
const cards = [...cardMap.values()];
if (cards.length < 1000) throw new Error('真實卡池前置不足，不能測長清單');
const imageKey = src => basename(new URL(src, 'http://fixture').pathname).replace(/\.[^.]+$/, '');
const expected = cards.map(c => imageKey(c.imageUrl));
const bundles = new Map();
async function bundle(name, pageText = source, helperText = helper, pagerText = pager) {
  const result = await build({
    stdin: { contents: `import { mount } from 'svelte'; import App from 'v6586:wrapper'; mount(App, { target:document.getElementById('app') });`, resolveDir: ROOT, sourcefile: 'v6586-fixture.js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['browser'],
    alias: { '$lib': join(ROOT, 'src/lib') }, logLevel: 'silent',
    plugins: [{ name: 'real-cards-page', setup(b) {
      b.onResolve({ filter: /^v6586:wrapper$/ }, () => ({ path: 'wrapper', namespace: 'fixture-wrapper' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture-wrapper' }, () => {
        // 與 SvelteKit 同 route 元件沿用相同：更新 reactive data，而非每次重新 mount。
        const wrapper = `<script>
          import { tick, onMount } from 'svelte';
          import App from ${JSON.stringify(join(ROOT, PAGE).replace(/\\/g, '/'))};
          let data = $state(window.fixtureData);
          function routeData() {
            const setCode = new URL(location.href).searchParams.get('set');
            return setCode ? {mode:'set',setCode,cards:window.fixtureData.cards,sets:[],setName:'測試卡池'} : {mode:'index',sets:[]};
          }
          async function navigated() { data=routeData(); await tick(); for(const fn of window.fixtureNavHandlers ?? []) fn(); }
          onMount(() => {
            const click = e => {
              const a=e.target.closest('a[href]'); if(!a || e.defaultPrevented || e.ctrlKey || e.metaKey) return;
              const u=new URL(a.href,location.href); if(u.origin!==location.origin || u.pathname!=='/cards') return;
              e.preventDefault(); history.pushState({},'',u); void navigated();
            };
            document.addEventListener('click',click); window.addEventListener('popstate',navigated);
            void tick().then(() => { for(const fn of window.fixtureNavHandlers ?? []) fn(); });
            return () => { document.removeEventListener('click',click); window.removeEventListener('popstate',navigated); };
          });
        </script><App {data} />`;
        return { contents: compile(wrapper, { filename: join(ROOT, 'v6586-wrapper.svelte'), generate: 'client', dev: true }).js.code, loader: 'js', resolveDir: ROOT };
      });
      b.onResolve({ filter: /^\$app\/(paths|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture-app' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture-app' }, args => ({ contents: args.path.endsWith('/paths') ? 'export const base="";' : 'export function replaceState(url,state){ history.replaceState(state,"",url); } export function afterNavigate(fn){ (window.fixtureNavHandlers ??= []).push(fn); }', loader: 'js' }));
      // 資料政策在此固定為內建 H/I/J，不發登入／雲端請求；清單、搜尋、詳情、捲動仍用真正的元件。
      b.onLoad({ filter: /[/\\]policy-loader\.ts$/ }, () => ({ contents: 'export async function loadCardPolicyOnce(){}', loader: 'ts' }));
      b.onLoad({ filter: /[/\\]pagination\.ts$/ }, () => ({ contents: helperText, loader: 'ts' }));
      b.onLoad({ filter: /\.svelte$/ }, args => {
        const file = args.path.replace(/\\/g, '/');
        const text = file.endsWith('/routes/cards/+page.svelte') ? pageText : file.endsWith('/CardsPager.svelte') ? pagerText : readFileSync(args.path, 'utf8');
        return { contents: compile(text, { filename: args.path, generate: 'client', css: 'injected', dev: true }).js.code, loader: 'js', resolveDir: dirname(args.path) };
      });
    } }],
  });
  bundles.set(name, result.outputFiles[0].text);
}
await bundle('head');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const variant = url.searchParams.get('variant') || 'head';
  if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(bundles.get(variant)); return; }
  const setCode = url.searchParams.get('set') || 'ALL';
  const data = { mode: 'set', setCode, cards, sets: [], setName: '測試卡池' };
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}html[data-theme=dark]{--ui-text:#e0e8e1;--ui-text-muted:#b0bbb3;--ui-bg-elev:#25312a;--ui-border:#546258}</style></head><body><div id="app"></div><script>window.fixtureData=' + JSON.stringify(data).replace(/</g, '\\u003c') + ';</script><script src="/fixture.js?variant=' + encodeURIComponent(variant) + '"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await pwLaunch('v6.586 真正卡牌頁分頁');
if (!browser) { server.close(); process.exit(fail ? 1 : 0); }
const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const keys = p => p.locator('.cardBtn img').evaluateAll(es => es.map(e => new URL(e.getAttribute('src'), location.href).pathname.split('/').pop().replace(/\.[^.]+$/, '')));
async function context(width) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
  await ctx.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.fulfill({ status: 200, contentType: 'image/png', body: tiny }));
  return ctx;
}
async function open(p, variant, query = '') {
  await p.goto(origin + '/cards?variant=' + variant + '&set=ALL' + query);
  await p.locator('.cardBtn').first().waitFor();
}
async function summary(variant, width = 390, allPages = false) {
  const ctx = await context(width), p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.setDefaultTimeout(7000);
  const out = {};
  try {
    await open(p, variant);
    out.first = equal(await keys(p), expected.slice(0, 240));
    const sentinel = p.locator('.moreSentinel');
    if (await sentinel.count()) {
      await sentinel.scrollIntoViewIfNeeded();
      await p.waitForFunction(() => document.querySelectorAll('.cardBtn').length > 240, null, { timeout: 1800 });
    }
    out.bounded = (await p.locator('.cardBtn').count()) <= 240;
    const top = p.getByRole('navigation', { name: '卡牌分頁（上方）', exact: true });
    out.pager = (await top.count()) === 1;
    if (out.pager) {
      await top.getByRole('button', { name: '下一頁', exact: true }).click();
      await p.waitForFunction(() => document.querySelector('nav[aria-label="卡牌分頁（上方）"] select')?.value !== '1');
      out.second = equal(await keys(p), expected.slice(240, 480));
      await p.waitForFunction(() => new URL(location.href).searchParams.get('page') === '2', null, { timeout: 1800 }).catch(e => { if (e.name !== 'TimeoutError') throw e; });
      out.url = new URL(p.url()).searchParams.get('page') === '2';
      await p.locator('.cardBtn').first().click();
      await p.locator('.modalInner').waitFor();
      await p.getByRole('button', { name: '關閉', exact: true }).first().click();
      out.modal = equal(await keys(p), expected.slice(240, 480));
      await p.getByRole('navigation', { name: '卡牌分頁（下方）', exact: true }).getByRole('button', { name: '下一頁', exact: true }).click();
      out.scroll = await p.locator('.cards-page-start').evaluate(e => { const r=e.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight; });
      out.focus = await p.locator('.cards-page-start').evaluate(e => document.activeElement===e);
      await top.getByRole('combobox').selectOption('2');
      await p.waitForFunction(() => document.querySelector('nav[aria-label="卡牌分頁（上方）"] select')?.value === '2');
      await p.waitForFunction(() => new URL(location.href).searchParams.get('page') === '2', null, { timeout: 1800 }).catch(e => { if (e.name !== 'TimeoutError') throw e; });
      await p.getByRole('link', { name: '← 卡包列表', exact: true }).click();
      await p.waitForFunction(() => !document.querySelector('.cardBtn'));
      await p.goBack();
      await p.locator('.cardBtn').first().waitFor();
      // 路由更新及 afterNavigate 都有機會執行完才讀；不能只看仍殘留的舊畫面。
      await p.waitForFunction(() => document.querySelector('.cardBtn img')?.getAttribute('src'));
      out.history = equal(await keys(p), expected.slice(240, 480));
      if (allPages) {
        const seen = [...expected.slice(0, 240), ...await keys(p)];
        for (let n = 3; n <= Math.ceil(cards.length / 240); n++) {
          await top.getByRole('combobox').selectOption(String(n));
          await p.waitForFunction(n => document.querySelector('nav[aria-label="卡牌分頁（上方）"] select')?.value === String(n), n);
          seen.push(...await keys(p));
          if (await p.locator('.cardBtn').count() > 240) out.bounded = false;
        }
        out.complete = equal(seen, expected);
        out.lastDisabled = await top.getByRole('button', { name: '下一頁', exact: true }).isDisabled();
      }
    } else { out.second = out.url = out.modal = out.scroll = out.focus = out.history = false; }
    await open(p, variant, '&page=2');
    out.restore = equal(await keys(p), expected.slice(240, 480));
    await p.locator('.controls input[type=search]').fill('ex');
    await p.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'ex');
    out.filter = !new URL(p.url()).searchParams.has('page') && (await p.locator('.cardBtn').count()) <= 240;
    // 不同搜尋條件間多次返回，會沿用同一元件；只驗空搜尋的返回抓不到篩選基準遺失。
    if (out.pager) {
      await open(p, variant, '&q=ex&page=2');
      const searched = await keys(p);
      await p.getByRole('link', { name: '← 卡包列表', exact: true }).click();
      await p.locator('.setTileAll').waitFor();
      await p.locator('.setTileAll').click();
      await p.locator('.cardBtn').first().waitFor();
      await p.waitForTimeout(350);
      await p.goBack(); await p.locator('.setTileAll').waitFor();
      await p.goBack(); await p.locator('.cardBtn').first().waitFor();
      // 等 URL 寫回的 debounce 結束，避免仍停留舊 URL 時讀出假陽性。
      await p.waitForTimeout(350);
      out.filteredHistory = equal(await keys(p), searched)
        && await top.getByRole('combobox').inputValue() === '2'
        && await p.locator('.controls input[type=search]').inputValue() === 'ex'
        && new URL(p.url()).searchParams.get('page') === '2';
    } else out.filteredHistory = false;
    await open(p, variant, '&page=999999999');
    out.clamp = equal(await keys(p), expected.slice(Math.floor((cards.length - 1) / 240) * 240));
    out.width = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    out.touch = await p.locator('.cards-pager button,.cards-pager select').evaluateAll(es => es.length === 6 && es.every(e => e.getBoundingClientRect().height >= 44));
    await p.evaluate(() => document.documentElement.dataset.theme = 'dark');
    out.dark = await p.locator('.cards-pager button').first().evaluate(e => getComputedStyle(e).color === 'rgb(224, 232, 225)').catch(e => { if (e.name === 'TimeoutError') return false; throw e; });
    out.errors = errors.length === 0;
    return out;
  } finally { await ctx.close(); }
}
const checks = ['first', 'bounded', 'pager', 'second', 'url', 'modal', 'scroll', 'focus', 'history', 'restore', 'filter', 'filteredHistory', 'clamp', 'width', 'touch', 'dark', 'errors'];
try {
  for (const width of [320, 390, 430, 1280]) {
    const result = await summary('head', width, width === 390);
    for (const key of checks) ok(`瀏覽器 ${width}：${key}`, result[key], JSON.stringify(result));
    if (width === 390) { ok('逐頁遍歷真卡池，無卡片遺漏或重複', result.complete); ok('最後一頁不能再往後翻', result.lastDisabled); }
  }
  // 單一卡包維持舊的增量瀏覽，避免效能改善擴張到未要求的介面。
  const ctx = await context(390), pg = await ctx.newPage();
  try {
    await pg.goto(origin + '/cards?set=MC'); await pg.locator('.cardBtn').first().waitFor();
    await pg.locator('.moreSentinel').scrollIntoViewIfNeeded();
    await pg.waitForFunction(() => document.querySelectorAll('.cardBtn').length > 240);
    ok('正對照：單包仍增量追加、不出現分頁', (await pg.locator('.cardBtn').count()) > 240 && (await pg.locator('.cards-pager').count()) === 0);
  } finally { await ctx.close(); }
  if (hasBaseCommit(ROOT, BASE)) {
    await bundle('base', baseRead(PAGE));
    const result = await summary('base');
    for (const key of ['bounded', 'pager', 'second', 'url', 'modal', 'restore', 'filter', 'clamp']) ok('HEAD-FAIL v6.585：' + key, result[key] === false, JSON.stringify(result));
    ok('BASE 正對照：首批卡片、寬度與 JS 載入仍正常', result.first && result.width && result.errors, JSON.stringify(result));
  }
  const mutations = [
    ['超過上限', source, helper, pager, 'page', 'bounded'],
    ['永遠顯示第一批', source, helper, pager, 'start', 'second'],
    ['搜尋不重設頁碼', source, helper, pager, 'reset', 'filter'],
    ['不還原網址頁碼', source, helper, pager, 'restore', 'restore'],
    ['不寫入網址頁碼', source, helper, pager, 'url', 'url'],
    ['下一頁跳兩頁', source, helper, pager, 'skip', 'second'],
    ['不捲回新頁頂端', source, helper, pager, 'scroll', 'scroll'],
    ['不移回分頁焦點', source, helper, pager, 'focus', 'focus'],
    ['不在同路由返回時還原', source, helper, pager, 'history', 'history'],
    ['移除導頁還原篩選基準', source, helper, pager, 'historyFilter', 'filteredHistory'],
  ];
  for (const [name, page, h, ui, kind, red] of mutations) {
    let next = page, nextUi = ui;
    const replace = (s, a, b) => { if (s.split(a).length !== 2) throw new Error('突變錨點不是唯一：' + kind); return s.replace(a, b); };
    if (kind === 'page') next = replace(next, 'filtered.slice(pageRange.start, pageRange.end)', 'filtered.slice(0, PAGE_SIZE * 2)');
    if (kind === 'start') next = replace(next, 'filtered.slice(pageRange.start, pageRange.end)', 'filtered.slice(0, pageRange.end - pageRange.start)');
    if (kind === 'reset') next = replace(next, 'lastAllFilterKey !== filterKey) currentPage = 1;', 'lastAllFilterKey !== filterKey) void 0;');
    if (kind === 'restore') next = replace(next, "if (data.setCode === 'ALL') currentPage = readCardsPage(location.search);", "if (data.setCode === 'ALL') currentPage = 1;");
    if (kind === 'url') next = replace(next, 'writeCardsPageSearch(conditions, pageToWrite)', 'conditions');
    if (kind === 'skip') nextUi = replace(nextUi, 'onchange(range.page + 1)', 'onchange(range.page + 2)');
    if (kind === 'scroll') next = replace(next, "    allPageTop?.scrollIntoView({ block: 'start', behavior: 'instant' });", '');
    if (kind === 'focus') next = replace(next, '    allPageTop?.focus({ preventScroll: true });', '');
    if (kind === 'history') next = replace(next, '  afterNavigate(() => restoreFromUrl(true));', '  afterNavigate(() => {});');
    if (kind === 'historyFilter') next = replace(next, '    lastAllFilterKey = allFilterKey(); // 導頁還原不是玩家修改篩選，不重設還原的頁碼', '');
    await bundle('mutant', next, h, nextUi);
    const result = await summary('mutant');
    ok('突變由指定行為抓到：' + name + ' → ' + red, result[red] === false, JSON.stringify(result));
    // 這些維持綠只能證明頁面仍可操作，不能當作與被破壞行為的邏輯獨立性證據。
    ok('突變正對照仍綠：' + name, ['width', 'touch', 'dark', 'errors'].every(k => result[k] === true), JSON.stringify(result));
  }
  await bundle('comment-only', source + '\n<!-- N1：只新增註解，不改產品行為。 -->\n');
  const commentOnly = await summary('comment-only');
  ok('N1 只改註解：全部行為仍綠', checks.every(k => commentOnly[k] === true), JSON.stringify(commentOnly));
  ok('突變沒有改寫磁碟上的產品檔（原始 bytes 相同）', originalBytes.every(([p, bytes]) => bytes.equals(readFileSync(join(ROOT, p)))));
  const finalHead = await summary('head');
  ok('突變後複驗 HEAD：全部行為回綠', checks.every(k => finalHead[k] === true), JSON.stringify(finalHead));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
