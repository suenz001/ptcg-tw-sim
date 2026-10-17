#!/usr/bin/env node
/**
 * v6.567 守衛（站長 2026-10-14）：
 *   「首頁的changelog，每版的更新紀錄有分大標題和小字 我認為只要讓大字讓玩家們看就好，小字這些太細節的內容不用給玩家看，
 *    請你巡一下現在的changelog並修正首頁的顯示 另外再請你把完整changelog內容(如現在，有大字和小字說明的)，直接放到admin頁面，
 *    裡面有個 更新紀錄的分頁裡面，讓我可以查閱完整的更新內容 另外這些admin的更新，與遊戲內容無關的更新就不用寫在changelog了」
 *
 *   L：src/lib/changelog-titles.ts 實跑（真資料＋人造樣本）：玩家端只剩「版本＋大標題」、內部版本與重複紀錄不顯示、其餘內容原樣保留。
 *   D：資料巡檢：首頁＋封存頁每一則都有緊接在版本徽章後的大標題（≤60 字）；內部版本只有 v6.524、v6.472；重複紀錄 28 則、每一則前面都有同版本的第一份。
 *   C：封存頁（玩家可直接打開）的樣式只顯示大標題、內部與重複不顯示。
 *   H：首頁兩條顯示路徑（內建／後台覆蓋）都先轉成大標題；.log-item 有樣式（含深色主題）。
 *   A：admin「📋 更新記錄」分頁：clParseEntries 對真資料實跑（590 則、細節對得回來、搜尋）；接線（讀三個檔、舊編輯器收進進階）。
 *   B：升版工具 scripts/bump-version.py 有 hidden 模式（與遊戲內容無關的版本不寫對外 changelog）。
 *   E：真瀏覽器（build/）：首頁只看到大標題；封存頁摘要與細節看不到、內部版本不顯示。
 * 【H】BASE（v6.566）：L／D／C／H／A／B 逐條紅。
 */
import { build } from 'esbuild';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.566。
const BASE_SHA = '63468c82';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const stripTags = (h) => String(h).replace(/<[^>]+>/g, '');

async function loadLeaf(srcRoot) {
  const f = join(srcRoot, 'src/lib/changelog-titles.ts');
  if (!existsSync(f)) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6567-'));
  try {
    const O = join(tmp, 'o.mjs');
    await build({ entryPoints: [f], outfile: O, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    return await import(pathToFileURL(O).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
const summaries = (html) => [...String(html).matchAll(/<details\b([^>]*)>\s*<summary>([\s\S]*?)<\/summary>/g)].map((m) => ({
  attrs: m[1], ver: (/ver-badge">([^<]*)</.exec(m[2]) || [])[1] || '', inner: m[2], title: (/<b>([\s\S]*?)<\/b>/.exec(m[2]) || [])[1] ?? null,
}));

function leafScenarios(L, HOME) {
  const r = {};
  if (!L || typeof L.changelogTitlesOnly !== 'function') return r;
  const out = L.changelogTitlesOnly(HOME);
  const ents = summaries(HOME).filter((e) => !/data-(internal|dup)="1"/.test(e.attrs));
  const items = [...out.matchAll(/<div class="log-item"><span class="ver-badge">([^<]*)<\/span> <b>([\s\S]*?)<\/b><\/div>/g)];
  r.L1 = !/<details\b|class="log-body"|<summary>/.test(out) && items.length === ents.length && items.length > 10
    && items[0][1] === ents[0].ver && items[0][2] === ents[0].title
    && /changelog-archive-link/.test(out) && /ptcg-override-gen/.test(out)
    && !stripTags(out).includes(stripTags(HOME.split('</summary>')[0].split('<br>')[1] || 'X'));   // 第一則的摘要（小字）不見了
  r.L1n = JSON.stringify({ items: items.length, ents: ents.length, first: items[0] && items[0][1] });
  // 人造樣本：內部、重複、沒有標題的舊格式、非 details 內容
  const syn = '<p>前</p><details open>\n<summary><span class="ver-badge">v9.003</span> <b>新功能</b><br>摘要小字</summary>\n<div class="log-body">細節</div>\n</details>'
    + '<details data-internal="1"><summary><span class="ver-badge">v9.002</span> <b>內部</b><br>x</summary></details>'
    + '<details data-dup="1"><summary><span class="ver-badge">v9.003</span> <b>重複</b><br>y</summary></details>'
    + '<details><summary><span class="ver-badge">v9.001</span> 修正某某問題。後面是很長的說明，細節細節細節細節細節細節細節細節細節細節細節細節細節細節細節細節細節細節細節細節</summary></details><p>後</p>'
    + '<details><summary><span class="ver-badge">v9.000</span> ' + '長'.repeat(45) + '</summary></details>'
    + '<details><summary><span class="ver-badge">v8.999</span> <b>手牌<b>選擇</b>N張改為卡背</b><br>說明<b>粗體</b></summary></details>'
    + '<details><summary><span class="ver-badge">v8.998</span> 只列出<b>物品卡</b>的問題。後面</summary></details>';
  const so = L.changelogTitlesOnly(syn);
  r.L2 = so === '<p>前</p><div class="log-item"><span class="ver-badge">v9.003</span> <b>新功能</b></div>'
    + '<div class="log-item"><span class="ver-badge">v9.001</span> <b>修正某某問題</b></div><p>後</p>'
    + '<div class="log-item"><span class="ver-badge">v9.000</span> <b>' + '長'.repeat(40) + '…</b></div>'
    + '<div class="log-item"><span class="ver-badge">v8.999</span> <b>手牌<b>選擇</b>N張改為卡背</b></div>'   // 巢狀粗體不截斷
    + '<div class="log-item"><span class="ver-badge">v8.998</span> <b>只列出物品卡的問題</b></div>';   // 句中粗體不當標題   // 沒有句號的長摘要截 40 字
  r.L2n = so;
  return r;
}

function dataScenarios(HOME, ARC) {
  const r = {};
  const all = [...summaries(HOME), ...summaries(ARC)];
  // 大標題必須緊接在版本徽章後面（玩家端只顯示徽章後的第一個 <b>；句中的粗體不算標題 —— 審查 P1）
  const noTitle = all.filter((e) => !/^<span class="ver-badge">[^<]*<\/span> <b>/.test(e.inner) || !stripTags(e.title).trim());
  const tooLong = all.filter((e) => e.title !== null && stripTags(e.title).length > 60);   // 既有已出版的標題最長約 50 字（v6.541 等）；新補的 177 則都 ≤40（F0d 的 _TITLE_INS_RE 限制）
  const internal = all.filter((e) => /data-internal="1"/.test(e.attrs)).map((e) => e.ver).sort();
  const dups = all.map((e, i) => ({ e, i })).filter(({ e }) => /data-dup="1"/.test(e.attrs));
  const dupOk = dups.every(({ e, i }) => all.slice(0, i).some((x) => x.ver === e.ver && !/data-dup="1"/.test(x.attrs)));
  // 沒標 dup 的條目，版本不可以重複（玩家端不會看到同一版兩次）
  const vis = all.filter((e) => !/data-dup="1"/.test(e.attrs)).map((e) => e.ver);
  r.D1 = all.length >= 590 && noTitle.length === 0 && tooLong.length === 0
    && JSON.stringify(internal) === JSON.stringify(['v6.472', 'v6.524']) && dups.length === 28 && dupOk && new Set(vis).size === vis.length;
  r.D1n = JSON.stringify({ n: all.length, noTitle: noTitle.slice(0, 3).map((e) => e.ver), tooLong: tooLong.map((e) => e.ver), internal, dups: dups.length, dupOk, visDup: vis.length - new Set(vis).size });
  return r;
}

function archiveCss(ARC) {
  const st = (/<style>([\s\S]*?)<\/style>/.exec(ARC) || [])[1] || '';
  return {
    C1: /summary\{font-size:0;/.test(st) && /summary b\{font-size:inherit;\}/.test(st) && /summary>b:first-of-type\{font-size:\.93rem;/.test(st) && /summary \.ver-badge\{font-size:/.test(st)
      && /details>:not\(summary\)\{display:none;\}/.test(st) && /details\[data-internal\],details\[data-dup\]\{display:none;\}/.test(st)
      && /pointer-events:none/.test(st) && !/舊條目維持當時的原始敘述/.test(ARC),
  };
}

function homeScenarios(PG) {
  return {
    H1: /\{#if changelogOverride\}<div class="changelog-list">\{@html changelogTitlesView\(changelogOverride\)\}<\/div>/.test(PG)
      && /\{:else if changelogBuiltin\}<div class="changelog-list">\{@html changelogTitlesView\(changelogBuiltin\)\}<\/div>/.test(PG)
      && /import \{ changelogTitlesOnly \} from '\$lib\/changelog-titles';/.test(PG)
      && /function changelogTitlesView\(html: string\): string \{ if \(html !== _clvIn\) \{ _clvIn = html; _clvOut = changelogTitlesOnly\(html\); \} return _clvOut; \}/.test(PG)
      && /\.changelog-list :global\(\.log-item\) \{ border: 1px solid/.test(PG) && /\.changelog-list :global\(\.log-item\) \{ background: var\(--ui-bg-elev\)/.test(PG),
  };
}

function adminScenarios(H, HOME, BODIES, ARC) {
  const r = {};
  const i = H.indexOf('function clParseEntries('), j = H.indexOf('let _clAdminEntries');
  if (i < 0 || j < i) return r;
  const F = new Function('escapeHtml', H.slice(i, j) + '\nreturn { clParseEntries, clEntriesHtml };')((s) => String(s).replace(/</g, '&lt;'));
  const es = F.clParseEntries(HOME, BODIES, ARC);
  const recentLazy = summaries(HOME).filter((e) => /data-ver="/.test(e.attrs)).map((e) => e.ver);
  const lazyOk = recentLazy.length > 0 && recentLazy.every((v) => (es.find((e) => e.ver === v) || {}).bodyHtml);
  const first = es[0] || {};
  const search = F.clEntriesHtml(es, '地鼠');
  r.A1 = es.length === summaries(HOME).length + summaries(ARC).length && es.filter((e) => e.dup).length === 28 && es.filter((e) => e.internal).length === 2
    && lazyOk && /<b>/.test(first.summaryHtml || '') && /<br>/.test(first.summaryHtml || '') && !!first.bodyHtml
    && (search.match(/<details/g) || []).length >= 3 && /沒有符合/.test(F.clEntriesHtml(es, 'zzzz不存在的字'))
    && /🔒 內部/.test(F.clEntriesHtml(es.filter((e) => e.internal), ''));
  r.A1n = JSON.stringify({ n: es.length, dup: es.filter((e) => e.dup).length, internal: es.filter((e) => e.internal).length, lazyOk });
  r.A2 = /const CL_SITE_BASE = 'https:\/\/suenz001\.github\.io\/ptcg-tw-sim';/.test(H)
    && /Promise\.all\(\[get\('changelog\.html'\), get\('changelog-bodies\.html'\)\.catch\(\(\) => ''\), get\('changelog-archive\.html'\)\]\)/.test(H)
    && /&lt;b&gt;大標題&lt;\/b&gt;&lt;br&gt;摘要/.test(H)
    && /el\.innerHTML = fullHtml \+\s*\n\s*'<details[^']*><summary[^>]*>🛠️ 進階：首頁更新記錄覆蓋編輯/.test(H)
    && /window\.clAdminFilter = function/.test(H) && /oninput="clAdminFilter\(this\.value\)"/.test(H);
  return r;
}

function bumpScenarios(srcRoot) {
  const f = join(srcRoot, 'scripts/bump-version.py');
  if (!existsSync(f)) return {};
  const s = normEol(readFileSync(f, 'utf8'));
  return { B1: /HIDDEN = bool\(spec\.get\('hidden'\)\)/.test(s) && /if HIDDEN:\n    print\('hidden version: public changelog untouched'\)\n(?:    .*\n|\s*\n)*else:\n/.test(s)
    && /rw\('static\/site-version\.txt', lambda s: V \+ '\\n'\)/.test(s) && /spec\['allowed'\] = sorted\(set\(spec\['allowed'\]\) \| \{'static\/site-version\.txt'\}\)/.test(s)
    && /if not HIDDEN: rw\('scripts\/test-v6264-changelog-lazy-body\.mjs'/.test(s) && /R = os\.path\.join\(os\.path\.dirname\(os\.path\.abspath\(__file__\)\), '\.\.', ''\)/.test(s) };
}

const LABEL = {
  L1: '★★★ L1 首頁轉換（真資料）：只剩「版本＋大標題」、摘要與細節不見、則數＝可見條目、封存連結與世代訊號原樣保留',
  L2: '★★ L2 首頁轉換（人造樣本）：內部版本與重複紀錄不顯示；沒有標題的舊格式取第一句；非條目內容原樣',
  D1: '★★★ D1 資料巡檢：每一則都有大標題；內部版本只有 v6.524／v6.472；28 則重複紀錄都排在同版第一份之後；玩家端不會看到同一版兩次',
  C1: '★★ C1 完整更新歷史頁（玩家可直接打開）：只顯示大標題、細節／內部／重複都隱藏、不可展開',
  H1: '★★ H1 首頁兩條顯示路徑都先轉成大標題；.log-item 有樣式（含深色主題）',
  A1: '★★★ A1 admin 完整更新紀錄（真資料實跑）：全部條目、較舊幾則的細節對得回來、內部／重複有標示、搜尋可用',
  A2: '★★ A2 admin 接線：讀網站的三個更新紀錄檔、搜尋框、舊的首頁覆蓋編輯收進「進階」',
  B1: '★★ B1 升版工具 scripts/bump-version.py：hidden 模式（與遊戲內容無關的版本不寫對外 changelog）、每版寫 site-version.txt（部署驗收的前端版本標記）、收進 repo',
};

const rd = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));
async function all(srcRoot, get) {
  const g = async (fn) => { try { const x = await fn(); return x && typeof x === 'object' ? x : {}; } catch (e) { return { _err: String(e && e.message) }; } };
  const HOME = get('static/changelog.html'), ARC = get('static/changelog-archive.html'), BODIES = get('static/changelog-bodies.html');
  return { ...(await g(async () => leafScenarios(await loadLeaf(srcRoot), HOME))), ...(await g(() => dataScenarios(HOME, ARC))), ...(await g(() => archiveCss(ARC))),
    ...(await g(() => homeScenarios(get('src/routes/+page.svelte')))), ...(await g(() => adminScenarios(get('oracle-admin/admin.html'), HOME, BODIES, ARC))), ...(await g(() => bumpScenarios(srcRoot))) };
}
const R = await all(ROOT, rd);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n'] ?? R._err);

// ── E：真瀏覽器 ──────────────────────────────────────────────────────────
console.log('【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/）');
else {
  const chromium = pwChromium('v6.567 更新紀錄');
  const browser = chromium ? await pwLaunchWith(chromium, 'v6.567 更新紀錄') : null;
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
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
      await ctx.route(/googleapis|gstatic|firebase|youtube|pokemon-card\.com/, (r) => r.abort());
      const pg = await ctx.newPage();
      await pg.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
      await pg.waitForSelector('.changelog-list .log-item', { state: 'attached', timeout: 30000 }).catch(() => {});   // 等不到 ⇒ 下面 E1 照實紅（不整支 throw，Rule 41）
      const home = await pg.evaluate(() => ({
        items: document.querySelectorAll('.changelog-list .log-item').length,
        details: document.querySelectorAll('.changelog-list details').length,
        first: document.querySelector('.changelog-list .log-item')?.textContent ?? '',
        hasLead: (document.querySelector('.changelog-list')?.textContent ?? '').includes('錦標賽對局超過時限後照舊進行最後回合'),
      }));
      const HOME = rd('static/changelog.html');
      const visible = summaries(HOME).filter((e) => !/data-(internal|dup)="1"/.test(e.attrs));
      ok('★★★ E1 首頁（真瀏覽器）：每一則只顯示版本＋大標題，沒有可展開的條目、看不到摘要小字',
        home.items === visible.length && home.details === 0 && home.first.startsWith(visible[0].ver) && home.first.includes(stripTags(visible[0].title)) && !home.hasLead, JSON.stringify(home));
      await pg.goto(`http://localhost:${port}/changelog-archive.html`, { waitUntil: 'load' });
      const arc = await pg.evaluate(() => {
        const ds = [...document.querySelectorAll('details')];
        const vis = ds.filter((d) => getComputedStyle(d).display !== 'none');
        // 每一則可見條目：摘要裡「版本徽章」與「第一個直屬 <b>（大標題）」以外的文字寬度都必須是 0（審查 P1：以前只量第一則）
        const leaks = []; let titled = 0;
        for (const d of vis) {
          const s = d.querySelector('summary'); if (!s) continue;
          const tb = [...s.children].find((c) => c.tagName === 'B');
          if (tb && tb.getBoundingClientRect().width > 8) titled++;
          const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (!n.textContent.trim() || (tb && tb.contains(n)) || n.parentElement.closest('.ver-badge')) continue;
            const r = document.createRange(); r.selectNodeContents(n);
            if (r.getBoundingClientRect().width >= 1) { leaks.push((d.querySelector('.ver-badge')?.textContent || '?') + ':' + n.textContent.slice(0, 12)); break; }
          }
        }
        const body = vis.find((d) => d.querySelector('.log-body'))?.querySelector('.log-body');
        return {
          total: ds.length, visible: vis.length,
          internalShown: ds.filter((d) => d.hasAttribute('data-internal') && getComputedStyle(d).display !== 'none').length,
          dupShown: ds.filter((d) => d.hasAttribute('data-dup') && getComputedStyle(d).display !== 'none').length,
          titled, leaks: leaks.slice(0, 5), nLeaks: leaks.length,
          bodyShown: body ? getComputedStyle(body).display !== 'none' : false,
        };
      });
      ok('★★★ E2 完整更新歷史頁（真瀏覽器，逐則）：每一則大標題看得到、摘要（含句中粗體）與細節看不到、內部版本與重複紀錄不顯示',
        arc.visible === arc.total - 30 && arc.internalShown === 0 && arc.dupShown === 0 && arc.titled === arc.visible && arc.nLeaks === 0 && !arc.bodyShown, JSON.stringify(arc));
      await ctx.close();
    } finally { srv.close(); await browser.close(); }
  }
}

console.log('【H】HEAD-FAIL（BASE v6.566）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6567 HEAD-FAIL', '需要歷史 commit');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6567b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src/lib scripts | tar -x -C "${tmp}"`]);
    const B = await all(tmp, (p) => { const x = readBaseBlob(ROOT, BASE_SHA, p); return x.ok ? normEol(x.out) : ''; });
    for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.566：${k} 紅`, B[k] !== true, String(B[k]));
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
console.log(`\n=== v6.567 更新紀錄只給玩家看大標題／admin 完整紀錄：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
