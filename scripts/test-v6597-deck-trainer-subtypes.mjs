#!/usr/bin/env node
/**
 * v6.597 守衛：牌組卡片順序把「寶可夢道具」從物品分出來；牌組公布欄明細的訓練家加小標題
 *
 * 站長 2026-10-24 裁定：
 *   ①順序「寶可夢 → 物品 → 寶可夢道具 → 支援者 → 競技場 → 能量」（寶可夢道具緊接在物品後面）；
 *   ②範圍一起改：牌組編輯器（/decks，匯出圖片也用它）與牌組公布欄共用同一份（$lib/decks/deck-order.ts）；
 *   ③牌組公布欄明細的「訓練家」底下加小標題（物品／寶可夢道具／支援者／競技場，各自張數）。
 *
 * 【U】deck-order：DECK_RANK 序號、寶可夢道具（subtype 'PokemonTool'）排在物品後面；全卡池排序檢查
 *      detail-view：subs 依序、張數、合起來＝訓練家整組；沒有的類別不出現；大圖前後卡照畫面順序
 * 【S】/decks 仍只用共用的 compareDeckCards（沒有第二份）；明細標記用同一個 cardList 片段畫大類別與小類別
 * 【B】真瀏覽器（build/）：縮圖與文字兩種模式都有四個小標題、順序與張數正確、小標題底下的卡就是那一類
 * 【H】HEAD-FAIL：BASE（v6.596）上 U1～U3、S2 逐條紅
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { loadLivePool } from './lib/ai-sim-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = 'c9922ba3';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));

const POOL = loadLivePool(ROOT);
ok('★ 前置：卡池載得到（>3000 張）', POOL.size > 3000, POOL.size);
const all = [...POOL.values()].filter((c) => typeof c.imageUrl === 'string' && c.imageUrl).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const pick = (pred, n) => all.filter(pred).slice(0, n);
const T = (sub) => (c) => c.supertype === 'Trainer' && c.subtype === sub;
const FIX = {
  energy: pick((c) => c.supertype === 'Energy', 1), stadium: pick(T('Stadium'), 1), supporter: pick(T('Supporter'), 2),
  tool: pick(T('PokemonTool'), 2), item: pick(T('Item'), 2), poke: pick((c) => c.supertype === 'Pokemon', 2),
};
ok('★ 前置：六種類型的卡都挑得到（含寶可夢道具）', Object.values(FIX).every((a) => a.length >= 1), JSON.stringify(Object.fromEntries(Object.entries(FIX).map(([k, v]) => [k, v.length]))));
// 故意打亂：能量 → 競技場 → 寶可夢道具 → 支援者 → 物品 → 寶可夢
const ENTRIES = [
  ...FIX.energy.map((c) => ({ cardId: String(c.id), count: 8 })), ...FIX.stadium.map((c) => ({ cardId: String(c.id), count: 2 })),
  ...FIX.tool.map((c, i) => ({ cardId: String(c.id), count: 1 + i })), ...FIX.supporter.map((c, i) => ({ cardId: String(c.id), count: 4 - i })),
  ...FIX.item.map((c, i) => ({ cardId: String(c.id), count: 3 + i })), ...FIX.poke.map((c, i) => ({ cardId: String(c.id), count: 2 + i })),
];
const kind = (c) => (c.supertype === 'Pokemon' ? 'poke' : c.supertype === 'Energy' ? 'energy' : c.subtype === 'Supporter' ? 'supporter' : c.subtype === 'Stadium' ? 'stadium'
  : c.subtype === 'PokemonTool' ? 'tool' : 'item');
const SUBS_WANT = [['物品', 'item'], ['寶可夢道具', 'tool'], ['支援者', 'supporter'], ['競技場', 'stadium']];
const countOf = (k) => FIX[k].reduce((n, c) => n + ENTRIES.find((e) => e.cardId === String(c.id)).count, 0);

async function loadMods(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/deck-posts/detail-view.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6597-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export * from '${p('src/lib/deck-posts/detail-view')}';\nexport * from '${p('src/lib/decks/deck-order')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return { ...(await import(pathToFileURL(O).href)) };
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function unitChecks(M) {
  const r = {};
  if (!M) return r;
  const lookup = (id) => POOL.get(id);
  // U1 序號與全卡池排序：寶可夢 < 物品 < 寶可夢道具 < 支援者 < 競技場 < 能量；同類依卡名
  const order = ['poke', 'item', 'tool', 'supporter', 'stadium', 'energy'];
  const cards = [...POOL.values()];
  const sorted = cards.slice().sort((a, b) => M.compareDeckCards(a, b));
  const kinds = sorted.map(kind);
  const mono = kinds.every((k, i) => i === 0 || order.indexOf(kinds[i - 1]) <= order.indexOf(k));
  const tools = cards.filter((c) => kind(c) === 'tool');
  r.U1 = typeof M.DECK_RANK === 'object' && mono && tools.length > 50 && tools.every((c) => M.deckCardRank(c) === M.DECK_RANK.tool)
    && M.deckCardRank({ supertype: 'Trainer', subtype: '' }) === M.DECK_RANK.item
    && M.DECK_RANK.item < M.DECK_RANK.tool && M.DECK_RANK.tool < M.DECK_RANK.supporter && M.DECK_RANK.supporter < M.DECK_RANK.stadium && M.DECK_RANK.stadium < M.DECK_RANK.energy;
  r.U1n = JSON.stringify({ mono, tools: tools.length, rankTool: M.DECK_RANK?.tool });
  // U2 明細分組：訓練家有 subs，依序 物品／寶可夢道具／支援者／競技場，張數正確，合起來＝整組（同一批卡、同一順序）
  const G = M.buildDetailGroups(ENTRIES, lookup);
  const tr = G.find((g) => g.group === '訓練家');
  const subs = tr?.subs ?? [];
  r.U2 = !!tr && subs.map((s) => s.name).join() === SUBS_WANT.map((x) => x[0]).join()
    && SUBS_WANT.every(([nm, k], i) => subs[i]?.total === countOf(k) && subs[i].items.every((it) => kind(lookup(it.cardId)) === k))
    && subs.flatMap((s) => s.items).map((x) => x.key).join() === tr.items.map((x) => x.key).join()
    && tr.total === subs.reduce((n, s) => n + s.total, 0)
    && G.filter((g) => g.group !== '訓練家').every((g) => g.subs === undefined)
    && G.map((g) => g.group).join() === '寶可夢,訓練家,能量';
  r.U2n = JSON.stringify(subs.map((s) => [s.name, s.total, s.items.length]));
  // U3 沒有的類別不出現（只有物品＋競技場）；大圖前後卡照畫面順序（物品 → 寶可夢道具 → 支援者 → 競技場）
  const G2 = M.buildDetailGroups([...FIX.stadium, ...FIX.item].map((c) => ({ cardId: String(c.id), count: 1 })), lookup);
  const Z = M.zoomableItems(G).map((x) => kind(lookup(x.cardId)));
  r.U3 = G2.find((g) => g.group === '訓練家')?.subs?.map((s) => s.name).join() === '物品,競技場'
    && Z.join() === ['poke', 'poke', 'item', 'item', 'tool', 'tool', 'supporter', 'supporter', 'stadium', 'energy'].join();
  r.U3n = JSON.stringify(Z);
  return r;
}
function staticChecks(DP, DECKS) {
  const r = {};
  const dp = stripCommentsBlank(DP), dk = stripCommentsBlank(DECKS);
  // （/decks 的卡片搜尋「類別篩選」cardCategory 是另一件事——篩選，不是排序——不在這條的範圍）
  r.S1 = /result\.sort\(\(a, b\) => compareDeckCards\(a\.card, b\.card\)\)/.test(dk) && !/const rank = \(c: Card\)/.test(dk)
    && (dk.match(/\.sort\(\(a, b\) => compareDeckCards\(/g) || []).length === 1;
  // S2 明細：一個 cardList 片段，大類別與小類別都用它畫；小標題只在 g.subs 有東西時出現
  r.S2 = (dp.match(/\{#snippet cardList\(items: DetailItem\[\]\)\}/g) || []).length === 1
    && /\{#if g\.subs && g\.subs\.length\}[\s\S]*?\{#each g\.subs as sb \(sb\.name\)\}[\s\S]*?<h4 class="dpv-subh"><span>\{sb\.name\}<\/span><span class="gtotal">\{sb\.total\} 張<\/span><\/h4>\s*\{@render cardList\(sb\.items\)\}[\s\S]*?\{:else\}\s*\{@render cardList\(g\.items\)\}/.test(dp)
    && (dp.match(/<img\b/g) || []).length === 2;
  return r;
}

const M = await loadMods(ROOT);
const U = unitChecks(M);
ok('★★★ U1 共用排序：寶可夢 → 物品 → 寶可夢道具 → 支援者 → 競技場 → 能量（全卡池單調；subtype PokemonTool 都排在物品後面）', U.U1 === true, U.U1n);
ok('★★★ U2 明細的訓練家分小類別：物品／寶可夢道具／支援者／競技場依序、各自張數正確、合起來就是整組', U.U2 === true, U.U2n);
ok('★★ U3 沒有的類別不出現；大圖的上一張／下一張照畫面順序', U.U3 === true, U.U3n);
const S = staticChecks(R('src/routes/deck-posts/+page.svelte'), R('src/routes/decks/+page.svelte'));
ok('★★ S1 牌組編輯器仍只用共用的 compareDeckCards（沒有第二份類別判斷）', S.S1 === true);
ok('★★★ S2 明細用同一個 cardList 片段畫大類別與小類別；小標題只在訓練家出現；頁面仍只有兩個 <img> 樣板', S.S2 === true);

// ── B：真瀏覽器 ──
const BUILD = join(ROOT, 'build');
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const chromium = pwChromium('v6.597');
  const browser = chromium ? await pwLaunchWith(chromium, 'v6.597') : null;
  if (!browser) shallowSkip('B（沒有可用的 Chromium）');
  else {
    const POST = { id: 'dp_t', authorName: '阿明', deckName: '小標題測試', notes: '', archetype: '', cardTotal: ENTRIES.reduce((n, e) => n + e.count, 0), likeCount: 0, downloadCount: 0, commentCount: 0, createdAt: 1760000000000, tournament: null, entries: ENTRIES };
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/api/deck-posts/dp_t') return j({ post: POST });
      if (u.pathname === '/api/deck-posts') return j({ posts: [POST], total: 1 });
      if (u.pathname.startsWith('/api/deck-posts-comments')) return j({ comments: [], hasMore: false });
      if (u.pathname.startsWith('/api/')) return j({});
      let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((rs) => srv.listen(0, rs));
    const port = srv.address().port;
    const res = {};
    try {
      for (const [view, theme, vp] of [['thumb', 'light', { width: 1280, height: 900 }], ['text', 'dark', { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp });
        await ctx.addInitScript(([v, t]) => { try { localStorage.setItem('ptcg_dp_detail_view_v1', v); localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, [view, theme]);
        await ctx.route(/asia\.pokemon-card\.com|ptcg-tw-sim-img|weserv/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"><rect width="245" height="342" fill="#4a6"/></svg>' }));
        await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/deck-posts?post=dp_t`, { waitUntil: 'load' });
        await pg.waitForSelector('.deck-table section', { timeout: 30000 }); await pg.waitForTimeout(600);
        res[view] = await pg.evaluate((isThumb) => {
          const sec = [...document.querySelectorAll('.deck-table section')].find((s) => /訓練家/.test(s.querySelector('h3')?.textContent || ''));
          if (!sec) return { err: 'no trainer section' };
          const heads = [...sec.querySelectorAll('h4.dpv-subh')].map((h) => h.textContent.replace(/\s+/g, ''));
          // 每個小標題底下（到下一個小標題之前）的那一串卡名
          const lists = [...sec.querySelectorAll('h4.dpv-subh')].map((h) => { const ul = h.nextElementSibling; return ul ? [...ul.querySelectorAll(isThumb ? '.dpv-nm' : '.nm')].map((x) => x.textContent.trim()) : []; });
          const h = sec.querySelector('h4.dpv-subh'); const cs = h ? getComputedStyle(h) : null;
          return { heads, lists, h3: document.querySelectorAll('.deck-table section h3').length, borderLeft: cs?.borderLeftWidth, visible: !!h && h.getBoundingClientRect().height > 0 };
        }, view === 'thumb');
        res[view].errs = errs.slice(0, 2);
        await ctx.close();
      }
    } finally { await browser.close(); srv.close(); }
    const wantHeads = SUBS_WANT.map(([nm, k]) => nm + countOf(k) + '張');
    const wantLists = SUBS_WANT.map(([, k]) => FIX[k].map((c) => c.name).sort((a, b) => a.localeCompare(b, 'zh-Hant')));
    const good = (x) => x && !x.err && x.heads.join() === wantHeads.join() && JSON.stringify(x.lists) === JSON.stringify(wantLists) && x.h3 === 3 && x.visible && x.errs.length === 0;
    ok('★★★ B1 縮圖模式（桌機淺色）：訓練家底下四個小標題依序、張數正確，各小標題底下就是那一類的卡', good(res.thumb), JSON.stringify(res.thumb));
    ok('★★★ B2 文字模式（手機深色）：同樣四個小標題與內容', good(res.text), JSON.stringify(res.text));
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6597b-'));
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const bU = unitChecks(await loadMods(tmp));
    const bp = readBaseBlob(ROOT, BASE_SHA, 'src/routes/deck-posts/+page.svelte'), bd = readBaseBlob(ROOT, BASE_SHA, 'src/routes/decks/+page.svelte');
    const bS = staticChecks(normEol(bp.out), normEol(bd.out));
    const red = [...['U1', 'U2', 'U3'].filter((k) => bU[k] !== true), ...(bS.S2 !== true ? ['S2'] : [])];
    ok('★★★ HEAD-FAIL：BASE（v6.596）上 U1～U3、S2 逐條紅', red.length === 4, red.join(','));
    ok('★ HEAD-FAIL 正對照：BASE 上 S1（牌組編輯器只用共用排序）本來就成立', bS.S1 === true);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.597 寶可夢道具分類／牌組公布欄訓練家小標題：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
