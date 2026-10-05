#!/usr/bin/env node
/**
 * v6.481 守衛：卡片搜尋語法（玩家提議：「資料庫搜尋能不能支援正則，或者可以使用更多的關鍵字交叉搜尋」）。
 *   唯一實作 $lib/cards/search-query.ts；卡牌資料庫（/cards）與牌組編輯器找卡（/decks）共用。
 *   【L】語法行為：空白＝AND、|＝OR、開頭 -＝排除、"…"／「…」＝整段、/…/＝正規表示式（寫錯退回文字並標記）、全形空白。
 *   【C】相容性：拿全部真實卡資料，「單一個詞」的結果必須與 v6.480 兩頁內嵌的舊邏輯逐張相同（一般／關鍵字三種範圍）；
 *        唯一例外：一般搜尋的卡號比對改成不分大小寫（舊版打 sv 找不到 SV-P 卡號），只會多、不會少。
 *   【S】兩頁都改呼叫共用實作、舊的內嵌比對程式不再存在（不會兩份分歧）；搜尋框 title 有語法說明。
 *   【E】真瀏覽器 /cards?set=ALL：AND、排除、正規表示式真的縮小結果。
 * HEAD-FAIL：靜態判準餵 v6.480 必須紅。
 * Run: node scripts/test-v6481-card-search-syntax.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.480。
const BASE_SHA = 'bd4db145';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function judge(get) {
  const r = {};
  for (const [k, p] of [['C', 'src/routes/cards/+page.svelte'], ['D', 'src/routes/decks/+page.svelte']]) {
    const s = get(p);
    r[k + '1'] = s.includes("from '$lib/cards/search-query'") && /compileCardQuery\(/.test(s) && /cardSearchFields\(c, searchMode, keywordScope\)/.test(s);
    // 舊的內嵌比對（haystack 組裝與 includes(q)）不得再出現 ⇒ 只剩一份實作
    r[k + '2'] = !!s && !/haystack\.some\(s => s && s\.toLowerCase\(\)\.includes\(q\)\)/.test(s) && !/c\.name\.toLowerCase\(\)\.includes\(q\)/.test(s);
    r[k + '3'] = /title=\{SEARCH_SYNTAX_HINT\}/.test(s);
  }
  return r;
}
console.log('【S】靜態');
const J = judge(rd);
ok('★★★[S1] 卡牌資料庫改呼叫共用搜尋實作', J.C1);
ok('★★★[S2] 卡牌資料庫的舊內嵌比對已移除', J.C2);
ok('★★[S3] 卡牌資料庫搜尋框有語法說明（title）', J.C3);
ok('★★★[S4] 牌組編輯器找卡改呼叫共用搜尋實作', J.D1);
ok('★★★[S5] 牌組編輯器的舊內嵌比對已移除', J.D2);
ok('★★[S6] 牌組編輯器搜尋框有語法說明（title）', J.D3);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const B = judge(g);
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.480 全紅', !B.C1 && !B.C2 && !B.C3 && !B.D1 && !B.D2 && !B.D3, JSON.stringify(B));
} else shallowSkip('v6481 S0：HEAD-FAIL', '需要 BASE commit');

const { build } = await import('esbuild');
const out = await build({ entryPoints: [join(ROOT, 'src/lib/cards/search-query.ts')], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const Q = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

console.log('\n【L】語法行為');
{
  const t = (q, fields) => Q.compileCardQuery(q).test(fields);
  const F = ['超級皮卡丘ex', '001/022', '十萬伏特', '從自己的牌庫抽 2 張卡'];
  ok('★★★[L1] 空白＝而且：兩個詞都在才命中、少一個就不中', t('皮卡丘 ex', F) && !t('皮卡丘 雷丘', F));
  ok('★★★[L2] |＝或', t('雷丘|皮卡丘', F) && !t('雷丘|胖丁', F));
  ok('★★★[L3] 開頭 -＝排除；只有排除詞時＝不含該詞的全部', !t('皮卡丘 -超級', F) && t('皮卡丘 -雷丘', F) && t('-雷丘', F) && !t('-超級', F));
  ok('★★[L4] "引號"／「引號」整段（含空白）；拆開後的順序不同就不算', t('"抽 2 張"', F) && t('「抽 2 張」', F) && !t('"2 抽"', F) && t('-"抽 3 張"', F));
  ok('★★★[L5] /…/ 正規表示式（不分大小寫）', t('/^超級.*EX$/', F) && t('/抽\\s*\\d\\s*張/', F) && !t('/^皮卡丘/', F));
  const bad = Q.compileCardQuery('/[超級/');
  ok('★★[L6] 寫錯的正規表示式退回文字搜尋並標記 regexError（不丟例外）', bad.regexError === true && bad.test(['/[超級/ 在這']) && !bad.test(F));
  ok('★★[L7] 全形空白也當分隔、前後空白無影響、空字串＝全部命中', t('　皮卡丘　ex　', F) && Q.compileCardQuery('   ').empty && t('', F));
  ok('★[L8] 卡號含斜線不會被當成正規表示式（001/022、/022 都是一般文字）', t('001/022', F) && t('/022', F) && !Q.compileCardQuery('/022').regexError);
  { const long = '/' + 'a'.repeat(400) + '/'; const L = Q.compileCardQuery(long);
    ok('★★[L9] 正規表示式長度上限：超長樣式當一般文字（只命中字面、不命中 400 個 a）', L.test(['x' + long]) && !L.test(['a'.repeat(400)])); }
}

console.log('\n【C】相容性：單一詞與 v6.480 舊邏輯逐張相同（全部真實卡資料）');
{
  const cards = [];
  for (const f of readdirSync(join(ROOT, 'static/cards'))) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const d = JSON.parse(readFileSync(join(ROOT, 'static/cards', f), 'utf8'));
    if (Array.isArray(d)) cards.push(...d.filter((c) => c && typeof c.name === 'string' && typeof c.collectorNumber === 'string'));
  }
  // v6.480 兩頁內嵌的舊邏輯（逐字搬過來當對照）
  const old = (c, mode, scope, q) => {
    if (mode === 'keyword') {
      let hay;
      if (scope === 'attacks') hay = (c.attacks ?? []).flatMap(a => [a.name, a.effect ?? '']);
      else if (scope === 'abilities') hay = (c.abilities ?? []).flatMap(a => [a.label ?? '', a.name, a.effect ?? '']);
      else hay = [c.name, c.collectorNumber, c.evolvesFrom ?? '', c.rulesText ?? '', ...(c.attacks ?? []).flatMap(a => [a.name, a.effect ?? '']), ...(c.abilities ?? []).flatMap(a => [a.label ?? '', a.name, a.effect ?? ''])];
      return hay.some(s => s && s.toLowerCase().includes(q));
    }
    return c.name.toLowerCase().includes(q) || c.collectorNumber.includes(q) || (c.attacks ?? []).some((a) => a.name.toLowerCase().includes(q)) || (c.abilities ?? []).some((a) => a.name.toLowerCase().includes(q));
  };
  const words = ['皮卡丘', 'ex', 'EX', '抽', '傷害', '001', '/022', '超級', '能量', '特性', '基礎', 'v', '寶可夢道具', '放逐區', '10'];
  let diffs = 0, caseDiffs = 0, checked = 0, hits = 0; const ex = [];
  for (const [mode, scope] of [['normal', 'all'], ['keyword', 'all'], ['keyword', 'attacks'], ['keyword', 'abilities']]) {
    for (const w of words) {
      const cq = Q.compileCardQuery(w); const q = w.trim().toLowerCase();
      for (const c of cards) {
        const a = cq.test(Q.cardSearchFields(c, mode, scope)); const b = old(c, mode, scope, q);
        checked++; if (a) hits++;
        if (a !== b) {
          // 唯一允許的差異：舊的一般搜尋比對卡號時**分大小寫**（打 sv 找不到 SV-P 的卡號），新實作卡號也不分大小寫 ⇒ 只會多、不會少
          const caseOnly = mode === 'normal' && a && !b && c.collectorNumber.toLowerCase().includes(q) && !c.collectorNumber.includes(q);
          if (caseOnly) caseDiffs++; else { diffs++; if (ex.length < 3) ex.push(mode + '/' + scope + ' ' + w + ' ' + c.id); }
        }
      }
    }
  }
  ok('★★★[C1] 單一詞：新實作與舊邏輯逐張相同（唯一例外：卡號改成不分大小寫，只多不少）', cards.length > 3000 && diffs === 0, JSON.stringify({ cards: cards.length, checked, diffs, caseDiffs, ex }));
  ok('[C3] 正對照：卡號大小寫的例外真的存在（打 v 會多找到卡號含 V 的卡）', caseDiffs > 0, String(caseDiffs));
  ok('[C2] 正對照：比對真的有命中（不是全部 false 的恆等）', hits > 1000, String(hits));
}

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.481') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.481');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p.replace(/\/$/, '') + '.html') && !p.endsWith('.html')) p = p.replace(/\/$/, '') + '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const errs = [];
    try {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
      await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/cards?set=ALL`, { waitUntil: 'load' });
      await pg.waitForSelector('.cardBtn', { timeout: 20000 });
      const meta = async (q) => { await pg.fill('.controls input[type=search]', q); await pg.waitForTimeout(700); return pg.evaluate(() => ({ n: Number((document.querySelector('.meta')?.textContent.match(/顯示 (\d+)/) || [])[1]), names: [...document.querySelectorAll('.cardBtn .name')].slice(0, 40).map((x) => x.textContent) })); };
      const A = await meta('皮卡丘');
      const B = await meta('皮卡丘 ex');
      const Cx = await meta('皮卡丘 -ex');
      const R = await meta('/^超級.*ex$/');
      await ctx.close();
      ok('★★★[E1] AND 會縮小結果、而且每張都同時含兩個詞', A.n > 0 && B.n > 0 && B.n < A.n && B.names.every((s) => s.includes('皮卡丘') && /ex/i.test(s)), JSON.stringify({ A: A.n, B: B.n }));
      ok('★★★[E2] 排除：皮卡丘 -ex ＝ 皮卡丘 減掉 皮卡丘 ex', Cx.n + B.n === A.n && Cx.names.every((s) => !/ex/i.test(s)), JSON.stringify({ A: A.n, B: B.n, C: Cx.n }));
      ok('★★★[E3] 正規表示式：結果卡名都符合 ^超級.*ex$', R.n > 0 && R.names.every((s) => /^超級.*ex$/i.test(s)), JSON.stringify({ n: R.n, s: R.names.slice(0, 3) }));
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
