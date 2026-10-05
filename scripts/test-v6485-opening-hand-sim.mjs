#!/usr/bin/env node
/**
 * v6.485 守衛：牌組編輯器「🎲 測抽」（站長同意的建議 #3）。
 *   【L】$lib/decks/opening-hand：洗牌是排列（不多不少）、抽 7＋擺 6、往下抽、三態判定、機率公式（含暴力枚舉對照）。
 *   【C】canStartActive 與引擎 canBeInitialActiveCard、isBasicOf 與中央 isBasicPokemonCard 對全部真實卡逐張相同。
 *   【E】真瀏覽器：載入預組 ⇒ 按「🎲 測抽」⇒ 7 張手牌＋6 張蓋著的獎賞；再抽 1 張變 8 張；重抽回 7 張；關閉；手機也能用。
 * HEAD-FAIL：靜態判準餵 v6.484 必須紅。
 * Run: node scripts/test-v6485-opening-hand-sim.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.484。
const BASE_SHA = '529fe726';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const judge = (get) => {
  const s = get('src/routes/decks/+page.svelte');
  return { S1: s.includes("import OpeningHandSim from '$lib/decks/OpeningHandSim.svelte'") && /onclick=\{\(\) => \(showOpeningSim = true\)\}/.test(s) && /<OpeningHandSim entries=/.test(s) };
};
console.log('【S】靜態');
const J = judge(rd);
ok('★★★[S1] 牌組編輯器有「🎲 測抽」按鈕並掛上測抽視窗', J.S1);
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const g = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  ok('★★[S0] HEAD-FAIL：同一份判準餵 v6.484 為紅', !judge(g).S1);
} else shallowSkip('v6485 S0：HEAD-FAIL', '需要 BASE commit');

const { build } = await import('esbuild');
const load = async (f) => { const o = await build({ entryPoints: [join(ROOT, f)], bundle: true, format: 'esm', write: false, platform: 'neutral', logLevel: 'silent' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const O = await load('src/lib/decks/opening-hand.ts');

console.log('\n【L】純函式');
{
  const mk = (name, extra = {}) => ({ id: name, name, supertype: 'Pokemon', subtype: 'Basic', ...extra });
  const basic = mk('小火龍'), st1 = mk('火恐龍', { subtype: 'Stage1', evolvesFrom: '小火龍' }), item = { id: 'i', name: '寶可夢球', supertype: 'Trainer', subtype: 'Item' };
  const deck = O.expandDeck([{ card: basic, count: 4 }, { card: st1, count: 3 }, { card: item, count: 53 }]);
  ok('★★[L1] 展開牌組：60 張、key 不重複', deck.length === 60 && new Set(deck.map((d) => d.key)).size === 60);
  let seed = 7; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const st = O.dealOpening(deck, rng);
  const all = [...st.hand, ...st.prizes, ...st.deck].map((d) => d.key).sort((a, b) => a - b);
  ok('★★★[L2] 抽 7、擺 6、剩 47；三區合起來剛好是原本的 60 張（洗牌是排列）', st.hand.length === 7 && st.prizes.length === 6 && st.deck.length === 47 && all.every((k, i) => k === i));
  const st2 = O.drawOne(st);
  ok('★★[L3] 再抽 1 張：手牌 8、牌庫 46、抽到的是原本牌庫頂', st2.hand.length === 8 && st2.deck.length === 46 && st2.hand[7].key === st.deck[0].key);
  const flash = mk('閃焰王牌', { subtype: 'Stage2', evolvesFrom: 'x', abilities: [{ name: '瞬間爆發力' }] });
  const H = (cards) => cards.map((c, i) => ({ key: i, card: c }));
  ok('★★★[L4] 三態判定：有基礎／只有瞬間爆發力／都沒有', O.classifyOpening(H([item, basic])) === 'has-basic' && O.classifyOpening(H([item, flash])) === 'burst-only' && O.classifyOpening(H([item, st1])) === 'none');
  // 機率：與暴力枚舉（小牌組）對照
  const brute = (N, B, h) => { let hit = 0, tot = 0; const idx = [...Array(N).keys()]; const rec = (start, chosen) => { if (chosen.length === h) { tot++; if (chosen.some((x) => x < B)) hit++; return; } for (let i = start; i < N; i++) rec(i + 1, [...chosen, i]); }; rec(0, []); return hit / tot; };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok('★★★[L5] 起手機率公式＝暴力枚舉（N=12,B=3,抽5；N=10,B=1,抽7）', near(O.basicInOpeningProb(12, 3, 5), brute(12, 3, 5)) && near(O.basicInOpeningProb(10, 1, 7), brute(10, 1, 7)));
  ok('★★[L6] 機率邊界：沒有基礎 0、基礎多到必中 1、60 張 10 基礎＝1−C(50,7)/C(60,7)≈0.7414', O.basicInOpeningProb(60, 0) === 0 && O.basicInOpeningProb(60, 54) === 1 && Math.abs(O.basicInOpeningProb(60, 10) - (1 - 99884400 / 386206920)) < 1e-12, String(O.basicInOpeningProb(60, 10)));
}

console.log('\n【C】與引擎／中央述詞一致（全部真實卡）');
{
  const E = await load('src/lib/game/engine.ts');
  const S = await load('src/lib/game/selection-filter.ts');
  const cards = [];
  for (const f of readdirSync(join(ROOT, 'static/cards'))) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const d = JSON.parse(readFileSync(join(ROOT, 'static/cards', f), 'utf8'));
    if (Array.isArray(d)) for (const c of d) if (c && c.id != null && c.supertype) cards.push(c);
  }
  let d1 = 0, d2 = 0, burst = 0; const ex = [];
  for (const c of cards) {
    if (O.canStartActive(c) !== E.canBeInitialActiveCard(c)) { d1++; if (ex.length < 3) ex.push(c.id); }
    if (O.isBasicOf(c) !== S.isBasicPokemonCard(c)) d2++;
    if (O.canStartActive(c) && !O.isBasicOf(c)) burst++;
  }
  ok('★★★[C1] canStartActive＝引擎 canBeInitialActiveCard（逐張）', cards.length > 3000 && d1 === 0, JSON.stringify({ n: cards.length, d1, ex }));
  ok('★★[C2] isBasicOf＝中央 isBasicPokemonCard（逐張）', d2 === 0, String(d2));
  ok('[C3] 正對照：真實卡裡確實有「非基礎但可放戰鬥場」的卡（瞬間爆發力那條不是死碼）', burst >= 1, String(burst));
}

console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.485') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.485');
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
      for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
        await ctx.route(/googleapis|firebase|gstatic|pokemon-card|github\.io|youtube|ytimg/, (r) => r.abort());
        const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/decks`, { waitUntil: 'load' }); await pg.waitForSelector('.preset-summary', { timeout: 20000 });
        const before = await pg.locator('text=🎲 測抽').count();
        await pg.click('.preset-summary'); await pg.waitForTimeout(300);
        await pg.locator('.preset-list li button').first().click(); await pg.waitForTimeout(1200);
        await pg.click('text=🎲 測抽'); await pg.waitForTimeout(600);
        const count = () => pg.evaluate(() => ({ hand: document.querySelectorAll('.ohs-grid')[0]?.querySelectorAll('.ohs-card').length ?? -1, backs: document.querySelectorAll('.ohs-back').length, meta: document.querySelector('.ohs-meta')?.textContent ?? '' }));
        const A = await count();
        await pg.click('.ohs-btn:has-text("再抽 1 張")'); await pg.waitForTimeout(200);
        const B = await count();
        await pg.click('.ohs-btn.primary'); await pg.waitForTimeout(200);
        const C = await count();
        await pg.click('.ohs-actions .ohs-btn:has-text("關閉")'); await pg.waitForTimeout(200);
        const closed = await pg.evaluate(() => !document.querySelector('.ohs-inner'));
        await ctx.close();
        const tag = mobile ? '手機 390' : '1440';
        ok(`★★[E0] ${tag}：還沒選牌組時沒有測抽鈕`, before === 0, String(before));
        ok(`★★★[E1] ${tag}：測抽 ⇒ 7 張手牌＋6 張蓋著的獎賞、顯示 60 張與機率`, A.hand === 7 && A.backs === 6 && /牌組 60 張/.test(A.meta) && /%/.test(A.meta), JSON.stringify(A));
        ok(`★★★[E2] ${tag}：再抽 1 張 ⇒ 8 張；重新洗牌再抽 ⇒ 回到 7 張；關閉`, B.hand === 8 && C.hand === 7 && closed, JSON.stringify({ B, C, closed }));
      }
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await browser.close(); srv.close(); }
  }
}
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
