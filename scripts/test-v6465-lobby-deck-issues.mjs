#!/usr/bin/env node
/**
 * v6.465 守衛：一般對戰／錦標賽選牌組時，牌組不合法要說出原因（與牌組編輯器同一支 validateDeck）
 *
 * 站長回報（2026-10-01）：一般對戰的介面選了不合法的牌組（未滿 60 張、沒有基礎寶可夢…），不會像牌組編輯器一樣提示錯誤。
 * 查證：
 *   - 本機／AI 大廳：60 張但沒有基礎寶可夢／同名超過 4 張／ACE SPEC 超過 1 張 ⇒ 顯示「✓ 60 張」、開始鈕卻是灰的，不說原因。
 *   - 線上座位：hasValidDeck 只看「60 張＋不能使用的卡」⇒ 上述牌組**可以按準備完成**。
 *   - 錦標賽報名（報名／補報名／發起社群賽／測試房）：前端只檢查 60 張（伺服器也只檢查 60 張）。
 *
 * 【S】結構（剝註解後比對；判準唯一＝validateDeck）
 *   S1 中央述詞 deckIssuesNow 走 validateDeck，卡包未載齊回 null（判斷不出來，不誤判）
 *   S2 本機大廳 P1／P2：60 張且有 issues ⇒「⚠ 牌組不符合規則」排在「✓ 60 張」之前，並列出 issues
 *   S3 線上座位：hasValidDeck ＝ 60 張 且 seatIssues 為空；自己座位列出 issues；對手座位只說「不符合規則」不列細節
 *   S4 錦標賽四個入口：60 張檢查之後都呼叫 tDeckSubmitError（載齊卡包＋卡牌政策後跑 validateDeck）
 *   S5 兩個錦標賽選牌位置下方都列出 tDeckIssues
 * 【E】真瀏覽器（需要 build/ 與 Chromium，否則 ENV-SKIP）：本機大廳選「無基礎寶可夢」「同名 5 張」「合法」三副牌，
 *      前兩副顯示原因且開始鈕灰，合法那副顯示 ✓ 且可按。
 * 【H】HEAD-FAIL：v6.464 的線上座位 hasValidDeck 只看張數與不能使用的卡（S3 在 BASE 必紅）。
 * 突變（實跑）：M1 線上 hasValidDeck 改回舊式 ⇒ S3 紅；M2 拿掉 tLateJoin 的完整驗證 ⇒ S4 紅。
 *
 * Run: node scripts/test-v6465-lobby-deck-issues.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.464＋Rule 78。
const BASE_SHA = '413b382e808808fafb0ab2acba1d7b7495c40702';
const PAGE = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, PAGE), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const fnBody = (src, name) => { const i = src.indexOf('async function ' + name + '('); if (i < 0) return ''; const j = src.indexOf('\n  }\n', i); return src.slice(i, j); };

function checkStruct(src) {
  const r = {};
  const di = src.slice(src.indexOf('function deckIssuesNow('), src.indexOf('function deckIssuesNow(') + 500);
  r.S1 = /deckEntriesAllInPool\(deck\.entries, pool\)\) return null;/.test(di) && /return validateDeck\(deck, pool\)\.issues;/.test(di);
  r.S2 = ['p1', 'p2'].every((P) => {
    const a = src.indexOf(`{:else if ${P}DeckCount === 60 && (${P}DeckIssues?.length ?? 0) > 0}`);
    const b = src.indexOf(`{:else if ${P}DeckCount === 60}\n            <div class="deck-count-info ok">✓ 60 張</div>`);
    return a > 0 && b > a && src.includes(`{#each issuesExceptCount(${P}DeckIssues) as iss}`);
  });
  const seat = src.slice(src.indexOf('{@const seatIssues ='), src.indexOf('<!-- 右側：8 個觀戰位 -->'));
  const oppPart = seat.slice(seat.indexOf('<!-- 別人坐：'));
  r.S3 = /\{@const hasValidDeck = myDeckCount === 60 && seatIssues\.length === 0\}/.test(seat)
    && /\{#each seatIssues as iss\}/.test(seat.slice(0, seat.indexOf('<!-- 別人坐：')))
    && oppPart.includes('⚠ 牌組不符合規則') && !/\{#each seatIssues/.test(oppPart);
  r.S4 = ['tournEnroll', 'tLateJoin', 'tPropose', 'tournamentJoin'].map((f) => {
    const b = fnBody(src, f); const i60 = b.indexOf('需 60 張'); const iv = b.indexOf('await tDeckSubmitError(deck)'); const ib = b.indexOf('tBusy = true');
    return [f, i60 > 0 && iv > i60 && ib > iv];
  });
  const sub = src.slice(src.indexOf('async function tDeckSubmitError('), src.indexOf('async function tDeckSubmitError(') + 600);
  r.S4b = /ensurePoolForDeckEntries\(\[deck\.entries\], true\)/.test(sub) && /loadCardPolicyOnce\(\)/.test(sub) && /validateDeck\(deck, pool\)\.issues/.test(sub);
  r.S5 = (src.match(/\{#each tDeckIssues \?\? \[\] as iss\}/g) || []).length;
  return r;
}

console.log('【S】結構');
const c = checkStruct(SRC);
ok('★★[S1] deckIssuesNow 走 validateDeck；卡包未載齊回 null（不誤判）', c.S1);
ok('★★★[S2] 本機大廳 P1／P2：有 issues 先顯示「牌組不符合規則」並列出原因（不再顯示 ✓ 60 張）', c.S2);
ok('★★★[S3] 線上座位：準備鈕看完整驗證；自己列原因、對手不列細節', c.S3);
ok('★★★[S4] 錦標賽四個入口都在 60 張檢查後跑完整驗證：' + c.S4.map(([f, v]) => f + (v ? '✓' : '✗')).join(' '), c.S4.every(([, v]) => v));
ok('★★[S4b] tDeckSubmitError 先載齊卡包與卡牌政策再驗', c.S4b);
ok('★★[S5] 兩個錦標賽選牌位置都列出原因', c.S5 === 2, c.S5);

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const rb = readBaseBlob(ROOT, BASE_SHA, PAGE);
  if (rb.ok) {
    const b = checkStruct(rb.out.replace(/\r\n/g, '\n'));
    ok('★★★[H1] v6.464：線上座位只看張數與不能使用的卡 ⇒ S3 在 BASE 必紅', !b.S3 && /\{@const hasValidDeck = myDeckCount === 60 && !seatHasIllegalMark\}/.test(rb.out));
    ok('★★[H2] v6.464：錦標賽入口沒有完整驗證 ⇒ S4 在 BASE 必紅', b.S4.every(([, v]) => !v));
  } else shallowSkip('v6465 H', '讀不到 BASE blob');
} else shallowSkip('v6465 H', '需要 v6.464 commit');

console.log('\n【突變】');
const M1 = SRC.replace('{@const hasValidDeck = myDeckCount === 60 && seatIssues.length === 0}', '{@const hasValidDeck = myDeckCount === 60 && !seatHasIllegalMark}');
ok('[M1 自驗] 突變有套上', M1 !== SRC);
ok('★★[M1] 線上 hasValidDeck 改回舊式 ⇒ S3 必紅', !checkStruct(M1).S3);
const lj = fnBody(SRC, 'tLateJoin');
const M2 = SRC.replace(lj, lj.replace('await tDeckSubmitError(deck)', 'null'));
ok('[M2 自驗] 突變有套上', M2 !== SRC);
ok('★★[M2] 拿掉 tLateJoin 的完整驗證 ⇒ S4 必紅', !checkStruct(M2).S4.every(([, v]) => v));

console.log('\n【E】真瀏覽器：本機大廳');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.465 大廳牌組提示') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/；CI 的 build 步驟之後才有）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.465 大廳牌組提示');
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
      const now = new Date().toISOString();
      const decks = [
        { id: 'd-nobasic', name: '無基礎', entries: [{ cardId: '14102', count: 60 }], createdAt: now, updatedAt: now },
        { id: 'd-ok', name: '合法', entries: [{ cardId: '19551', count: 4 }, { cardId: '14102', count: 56 }], createdAt: now, updatedAt: now },
        { id: 'd-five', name: '五張', entries: [{ cardId: '19551', count: 5 }, { cardId: '14102', count: 55 }], createdAt: now, updatedAt: now },
      ];
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
      await ctx.addInitScript((d) => { localStorage.setItem('ptcg-tw-sim:decks', JSON.stringify(d)); }, decks);
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
      await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
      await pg.click('.mode-card');
      const sel = pg.locator('select').filter({ has: pg.locator('option[value="d-ok"]') });
      const look = async (id) => { await sel.nth(0).selectOption(id); await sel.nth(1).selectOption('d-ok'); await pg.waitForTimeout(2500);
        return pg.evaluate(() => { const btn = [...document.querySelectorAll('button.btn-primary')].find((x) => /開始/.test(x.textContent || ''));
          return { info: [...document.querySelectorAll('.deck-count-info')].map((x) => x.textContent.trim()), lists: [...document.querySelectorAll('.deck-issue-list li')].map((x) => x.textContent.trim()), dis: btn ? btn.disabled : null }; }); };
      const nb = await look('d-nobasic'); const fv = await look('d-five'); const okd = await look('d-ok');
      ok('★★★[E1] 沒有基礎寶可夢：顯示「牌組不符合規則」與原因，開始鈕灰', nb.info[0] === '⚠ 牌組不符合規則' && nb.lists.some((x) => x.includes('至少需要 1 隻基礎寶可夢')) && nb.dis === true, JSON.stringify(nb));
      ok('★★[E2] 同名 5 張：列出「不得超過 4 張」', fv.info[0] === '⚠ 牌組不符合規則' && fv.lists.some((x) => x.includes('不得超過 4 張')) && fv.dis === true, JSON.stringify(fv));
      ok('★★[E3] 合法牌組：✓ 60 張、沒有原因清單、開始鈕可按（正對照）', okd.info.every((x) => x === '✓ 60 張') && okd.lists.length === 0 && okd.dis === false, JSON.stringify(okd));
      ok('[E4] 頁面零錯誤', errs.length === 0, errs.join(' | '));
      await ctx.close();
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.465 大廳／報名的牌組錯誤提示: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6465-lobby-deck-issues ===');
process.exit(fail ? 1 : 0);
