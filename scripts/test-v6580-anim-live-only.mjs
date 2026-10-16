#!/usr/bin/env node
/**
 * v6.580 守衛：對戰動畫只在當下播放（站長 2026-10-17：「務必確認動畫只會在當下播放，不會有殘留的問題」
 *   觀戰進房會把放獎賞卡、開局擲硬幣再播一次；取得獎賞、放獎賞、擲硬幣等全部 audit）
 *
 *   【U】判準 decideAnimObservation（src/lib/game/anim-live.ts，唯一一份）
 *     U1 第一次看到某一局 ⇒ 基準（不播）；U2 同一局後續盤面 ⇒ 照常播；U3 我自己正在開局（還沒放、沒按準備）⇒ 開局動畫照播
 *     U4 觀戰／回放永遠不播開局；U5 同一局開局只播一次（重新整理不再播）；U6 背景分頁／回前景 2 秒內 ⇒ 基準
 *     U7 isOpeningPristineFor：放了戰鬥寶可夢、放了備戰、按了準備、不在開局 ⇒ 都不算「還沒動過」
 *     U8 makeLocalSeenStore：localStorage 拋例外也不壞，且同一分頁仍記得
 *   【S】接線：每一個「比對前後盤面」的動畫 $effect 都先問 animObserve（擲硬幣 overlay、log 擲硬幣、發獎賞、取獎賞、
 *     抽牌飛入、洗牌、棄牌閃、傷害數字、回合橫幅）；獎賞卡的發牌 class 不再永遠掛著
 *   【E】真瀏覽器（AI 對戰）
 *     E1 開局：玩家看得到擲硬幣 overlay（當下照播，正對照）
 *     E2 開局發獎賞後 ⇒ 切換版面、轉成手機直式再轉回來讓獎賞卡重新掛載 ⇒ 不可以再出現發牌動畫（舊版 class 永遠掛著 ⇒ 每次掛載都重播）
 *     E3 分頁在背景時 AI 行動 ⇒ 不產生抽牌飛入／回合橫幅；回到前景後照常
 *   【H】HEAD-FAIL：S 組餵 BASE（v6.579＋server v1.69）必紅
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：server v1.69（前端＝v6.579）。
const BASE_SHA = 'b65810ea9abf33a25580252397a9ceb127ae7282';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

console.log('【U】判準');
const { transform } = await import('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'v6580-'));
const out = join(dir, 'anim-live.mjs');
writeFileSync(out, (await transform(readFileSync(join(ROOT, 'src/lib/game/anim-live.ts'), 'utf8'), { loader: 'ts', format: 'esm' })).code);
const M = await import(pathToFileURL(out).href);
const base = { gameId: 'g1', lastGameId: null, isSpectatorOrReplay: false, seat: 0, pristineForMe: false, openingAlreadyShown: false, hidden: false, inQuietWindow: false };
const D = (o) => M.decideAnimObservation({ ...base, ...o });
ok('★★★ U1 第一次看到某一局（進房／重新整理／回到房間）⇒ 基準、不播開局', D({}).baseline === true && D({}).openingLive === false);
ok('★★★ U2 同一局後續盤面 ⇒ 照常播（不是基準）', D({ lastGameId: 'g1' }).baseline === false);
ok('★★★ U3 我自己正在開局、還沒動過 ⇒ 開局動畫照播（不是基準）', D({ pristineForMe: true }).openingLive === true && D({ pristineForMe: true }).baseline === false);
ok('★★★ U4 觀戰／回放 ⇒ 永遠不播開局（v5.516）；回放第一次看到＝基準，之後逐步導覽照舊（審查 P2-1）', D({ pristineForMe: true, isSpectatorOrReplay: true, seat: -1 }).openingLive === false && D({ pristineForMe: true, isSpectatorOrReplay: true, seat: -1 }).baseline === true
  && D({ lastGameId: 'g1', isSpectatorOrReplay: true, seat: -1 }).baseline === false);
ok('★★★ U5 同一局開局已播過（重新整理）⇒ 不再播', D({ pristineForMe: true, openingAlreadyShown: true }).openingLive === false && D({ pristineForMe: true, openingAlreadyShown: true }).baseline === true);
ok('★★ U6 背景分頁／回前景 2 秒內 ⇒ 基準（不補播）', D({ lastGameId: 'g1', hidden: true }).baseline === true && D({ lastGameId: 'g1', inQuietWindow: true }).baseline === true);
ok('★ U6b 換到新的一局（再戰）且我還沒動 ⇒ 開局照播', D({ lastGameId: 'g0', pristineForMe: true }).openingLive === true);
{
  const P = (me, extra = {}) => M.isOpeningPristineFor({ phase: 'setup', setupDone: [false, false], players: [me, { active: null, bench: [] }], ...extra }, 0);
  ok('★★ U7 isOpeningPristineFor：什麼都沒做 ⇒ true；放了戰鬥／備戰、按了準備、已進入對戰 ⇒ false',
    P({ active: null, bench: [] }) === true && P({ active: { iid: 'a' }, bench: [] }) === false && P({ active: null, bench: [{ iid: 'b' }] }) === false
    && P({ active: null, bench: [] }, { setupDone: [true, false] }) === false && P({ active: null, bench: [] }, { phase: 'playing' }) === false
    && M.isOpeningPristineFor({ phase: 'setup', players: [{ active: null, bench: [] }] }, -1) === false);
}
{
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const st = M.makeLocalSeenStore('k');
  let threw = false; try { st.add('x'); } catch { threw = true; }
  ok('★ U8 localStorage 拋例外也不壞，且同一分頁仍記得播過', !threw && st.has('x') === true && st.has('y') === false);
  const mem = {}; globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const s2 = M.makeLocalSeenStore('k2', 3); for (const id of ['a', 'b', 'c', 'd']) s2.add(id);
  const s3 = M.makeLocalSeenStore('k2', 3);
  ok('★ U8b 跨頁（重新整理）讀得回來，且只留最近 N 局', s3.has('d') && s3.has('b') && !s3.has('a'));
  globalThis.localStorage = saved;
}

{
  // U9 觀察器序列（審查 P1-1）：無盤面 → A（基準）→ A 後續（播）→ 離開（reset）→ 回到 A（必須又是基準）
  let t = 1000; let hidden = false;
  const seenMem = new Set(); const seen = { has: (id) => seenMem.has(id), add: (id) => seenMem.add(id) };
  const O = M.createAnimObserver({ seen, now: () => t, isHidden: () => hidden });
  const ctxP = { isSpectatorOrReplay: true, seat: 0 };
  const mk = (id, extra = {}) => ({ id, phase: 'playing', setupDone: [true, true], players: [{ active: { iid: 'a' }, bench: [] }, { active: { iid: 'b' }, bench: [] }], ...extra });
  const a1 = mk('A'), a2 = mk('A'), a3 = mk('A');
  const r1 = O.observe(a1, ctxP), r1b = O.observe(a1, ctxP), r2 = O.observe(a2, ctxP);
  O.reset();
  const r3 = O.observe(a3, ctxP);
  ok('★★★ U9 觀察器：第一次＝基準、同一份盤面判一次、後續照播；離開（reset）再回到同一局 ⇒ 又是基準（不重播整局）',
    r1.baseline === true && r1b === r1 && r2.baseline === false && r3.baseline === true, JSON.stringify([r1, r2, r3]));
  // U10 回前景安靜期只擋「網路補進來」的盤面；自己剛做的動作（markLocal）照播
  O.onVisible(); t += 500;
  const net = mk('A'), mine = mk('A'); O.markLocal(mine);
  const rn = O.observe(net, ctxP), rm = O.observe(mine, ctxP);
  t += 2500; const later = O.observe(mk('A'), ctxP);
  ok('★★★ U10 回前景 2 秒內：網路補進來的＝基準、自己剛做的動作照播；過了 2 秒恢復', rn.baseline === true && rm.baseline === false && later.baseline === false, JSON.stringify([rn, rm, later]));
  // U11 markBaseline（伺服器拉回舊盤面／悔棋）＝基準；背景時＝基準
  const back = mk('A'); O.markBaseline(back); hidden = true; const hid = O.observe(mk('A'), ctxP); hidden = false;
  ok('★★ U11 markBaseline 的盤面、背景分頁收到的盤面 ⇒ 基準', O.observe(back, ctxP).baseline === true && hid.baseline === true);
  // U12 玩家開局：只播一次（同一局第二次第一次看到 ⇒ 已記錄播過）
  const O2 = M.createAnimObserver({ seen, now: () => t, isHidden: () => false });
  const op = (id) => ({ id, phase: 'setup', setupDone: [false, false], players: [{ active: null, bench: [] }, { active: null, bench: [] }] });
  const q1 = O2.observe(op('N'), { isSpectatorOrReplay: false, seat: 0 }); O2.reset(); const q2 = O2.observe(op('N'), { isSpectatorOrReplay: false, seat: 0 });
  ok('★★★ U12 玩家開局當下照播；同一局重新進來（還沒動）不再播', q1.openingLive === true && q2.openingLive === false && q2.baseline === true, JSON.stringify([q1, q2]));
}

console.log('\n【S】接線');
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
function scenS(src) {
  const at = (needle, len = 2600) => { const i = src.indexOf(needle); return i < 0 ? '' : src.slice(i, i + len); };
  return {
    S1: /function animObserve\(g: GameState \| null\)/.test(src) && src.includes("from '$lib/game/anim-live'") && /createAnimObserver\(\{/.test(src)
      && /\$effect\.pre\(\(\) => \{ if \(!game\) _animObs\.reset\(\); \}\);/.test(src)
      && /_dec\.reason === 'client-ahead'\) _animObs\.markBaseline\(game\)/.test(src) && (src.match(/_animObs\.markLocal\(game\)/g) || []).length === 4
      && (src.match(/_animObs\.markBaseline\(game\);   \/\/ ⭐v6\.580 悔棋/g) || []).length === 3
      && /game = ctx\.prev; _animObs\.markBaseline\(game\);/.test(src) && /if \(idx !== _animPrevStep \+ 1\) _animObs\.markBaseline\(game\);/.test(src),
    S2: /coinFlipShownFor = game\.id;[\s\S]{0,400}if \(!animObserve\(game\)\.openingLive\) \{ coinFlipStage = 'done'; return; \}/.test(src),
    S3: /class="prize-card" class:prize-anim=\{prizeDealLive\[oppIdx\]\}/.test(src) && /class="prize-card my-prize" class:prize-anim=\{prizeDealLive\[myIdx\]\}/.test(src) && !/class="prize-card[^"]*prize-anim/.test(src),
    S4: /prevPrizesLen\[i\] === 0 && cur === 6 && !_aoPrize\.baseline/.test(src),
    S5: /if \(!wasInit\) continue;\s*\n\s*if \(animObserve\(game\)\.baseline\) continue;/.test(src),
    S6: /if \(coinFlipStage !== 'done'\) return;\s*\n[^\n]*\n\s*if \(animObserve\(game\)\.baseline\) \{ for \(const pIdx of \[0, 1\] as const\) prevHandIids\[pIdx\]/.test(src),
    S7: /if \(animObserve\(game\)\.baseline\) \{ lastLogProcessed = _maxTs; return; \}/.test(src),
    S8: /if \(animObserve\(game\)\.baseline\) return;   \/\/ ⭐v6\.580 基準盤面：游標跟上、不補播洗牌/.test(src) && /cur > prevDiscardLen\[i\] && !_quietDisc/.test(src),
    S9: /pk\.damage !== prev && !_quietDmg/.test(src) && /if \(!animObserve\(game\)\.baseline\) turnBanner = \{ text, timestamp: ts \};/.test(src),
  };
}
const LABEL = {
  S1: '★★ S1 唯一判準 animObserve 接到 anim-live.ts；盤面清空 reset、本機動作 markLocal、伺服器拉回／悔棋 markBaseline', S2: '★★★ S2 開局擲硬幣 overlay 只在「我自己正在開局」播', S3: '★★★ S3 獎賞卡發牌 class 只在當下發牌時掛（不再永遠掛著）',
  S4: '★★★ S4 發獎賞 0→6 的偵測略過基準盤面', S5: '★★★ S5 取得獎賞動畫略過基準盤面', S6: '★★★ S6 抽牌飛入略過基準盤面（只記手牌）',
  S7: '★★★ S7 log 擲硬幣：基準盤面只把游標跟上', S8: '★★ S8 洗牌、棄牌閃略過基準盤面', S9: '★★ S9 傷害數字、回合橫幅略過基準盤面',
};
const R = scenS(SRC);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true);
console.log('【H】HEAD-FAIL（BASE server v1.69＝前端 v6.579）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6580 HEAD-FAIL', '需要歷史 commit');
else { const x = readBaseBlob(ROOT, BASE_SHA, REL); const B = scenS(x.ok ? x.out.replace(/\r\n/g, '\n') : ''); for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.579：${k} 紅`, B[k] !== true); }

console.log('\n【E】真瀏覽器');
const BUILD = process.env.V6580_BUILD || join(ROOT, 'build');   // HEAD-FAIL 自驗時可指到 BASE 的 build
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.580 動畫只在當下') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.580 動畫只在當下');
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
    const errs = [];
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
    await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
    await ctx.addInitScript(() => {
      let x = 7; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
      localStorage.setItem('ptcg_battle_layout', 'classic');
      // 監看：記錄每一個動畫元素出現過幾次（MutationObserver，抓得到一閃即逝的）
      window.__fx = { coin: 0, prizeAnim: 0, drawFly: 0, banner: 0 };
      const scan = (n) => { if (!(n instanceof Element)) return;
        const q = (sel) => (n.matches(sel) ? 1 : 0) + n.querySelectorAll(sel).length;
        window.__fx.coin += q('.coin-flip-overlay'); window.__fx.prizeAnim += q('.prize-card.prize-anim'); window.__fx.drawFly += q('.draw-fly-card'); window.__fx.banner += q('.turn-banner-text'); };
      new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) scan(n); if (m.type === 'attributes' && m.target instanceof Element && m.target.matches('.prize-card.prize-anim') && !(m.oldValue || '').includes('prize-anim')) window.__fx.prizeAnim++; } })
        .observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
    const fx = () => pg.evaluate(() => ({ ...window.__fx }));
    const resetFx = () => pg.evaluate(() => { for (const k of Object.keys(window.__fx)) window.__fx[k] = 0; });
    await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
    await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
    await pg.click('.mode-card');
    const sels = pg.locator('main.lobby select');
    await sels.nth(0).selectOption('__preset_tactic_dragonite__');
    await sels.nth(1).selectOption('__preset_tactic_gardevoir__');
    const start = pg.locator('button.btn-primary', { hasText: '開始' });
    await start.waitFor({ state: 'visible', timeout: 30000 });
    for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500);
    await start.click();
    for (let i = 0; i < 40 && !(await fx()).coin; i++) await pg.waitForTimeout(250);   // 牌組載入後才開局（約 2～3 秒）
    const f0 = await fx();
    ok('★★★ E1 開局：玩家看得到擲硬幣 overlay（當下照播，正對照）', f0.coin >= 1, JSON.stringify(f0));
    // 開局：拖一隻基礎寶可夢上戰鬥場、處理系統視窗，直到輪到玩家 1
    await pg.waitForSelector('.hand-card.draggable', { timeout: 60000 });
    await pg.waitForTimeout(1500);
    const drag = async (from, to) => {
      const a = await from.boundingBox(), z = await to.boundingBox(); if (!a || !z) return;
      await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await pg.mouse.down();
      await pg.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 - 10, { steps: 3 });
      await pg.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(700);
    };
    await drag(pg.locator('.hand-card.draggable').first(), pg.locator('.my-active-zone'));
    for (let b = 0; b < 2; b++) { const c = pg.locator('.hand-card.draggable'); if (!(await c.count())) break; await drag(c.first(), pg.locator('.zone-bench').last()); }
    await pg.mouse.move(5, 500);
    const sysSel = () => pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成|確認/ });
    const myTurnNow = async () => (await pg.locator('button:visible:not([disabled])', { hasText: '跳過攻擊' }).count()) > 0;
    // 一步：處理系統視窗；昏厥後補位（點第一隻 → 確定上場）
    const sysStep = async () => {
      const sb = sysSel(); if (await sb.count()) { await sb.first().click({ timeout: 2000 }).catch(() => {}); return; }
      if (await pg.locator('.retreat-modal:visible .retreat-card').count()) {
        await pg.locator('.retreat-modal:visible .retreat-card').first().click({ timeout: 1500, position: { x: 10, y: 40 } }).catch(() => {});
        await pg.locator('.retreat-modal:visible button.btn-act.primary:not([disabled])').first().click({ timeout: 1500 }).catch(() => {});
      }
    };
    let myTurn = false;
    for (let w = 0; w < 90 && !myTurn; w++) { myTurn = await myTurnNow(); if (!myTurn) { const sb = sysSel(); if (await sb.count()) await sb.first().click({ timeout: 2000 }).catch(() => {}); await pg.waitForTimeout(600); } }
    ok('[E 前提] 開局成功、輪到玩家 1', myTurn);
    const f1 = await fx();
    ok('★★ E2-前提 開局時真的發過獎賞（當下照播）', f1.prizeAnim >= 6, JSON.stringify(f1));
    if (myTurn) {
      await pg.waitForTimeout(2500);   // 發牌動畫的 class 收掉
      await resetFx();
      // 切版面兩次 ⇒ 獎賞卡整個重新掛載
      const setLayout = async (v) => {
        await pg.locator('.settings-chip').first().click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(300);
        if (!(await pg.locator('select:visible:has(option[value="tabletop"])').count())) await pg.locator('summary:visible', { hasText: '對戰版面' }).first().click({ timeout: 3000 }).catch(() => {});
        await pg.waitForTimeout(200);
        await pg.evaluate((v) => { const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'tabletop')); if (sel) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
        await pg.waitForTimeout(300);
        await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === '✕' && (x.closest('div')?.parentElement?.textContent || '').includes('畫面縮放')); b?.click(); });
        await pg.waitForTimeout(500);
      };
      await setLayout('tabletop'); await setLayout('classic');
      // 轉成手機直式再轉回來 ⇒ 桌機盤面（含獎賞卡）整個卸載再重新掛載（＝觀戰進房／重新整理時第一次畫出獎賞卡的情況）
      await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(800);
      const nMobile = await pg.locator('.prize-card').count();
      await pg.setViewportSize({ width: 1366, height: 900 }); await pg.waitForTimeout(1200);
      const n0 = await pg.locator('.prize-card').count();
      const f2 = await fx();
      ok('[E2 前提] 轉直式時桌機獎賞卡真的卸載、轉回來重新掛載', nMobile === 0 && n0 >= 12, JSON.stringify({ nMobile, n0 }));
      ok('★★★ E2 切換版面／轉向讓獎賞卡重新掛載 ⇒ 不再重播發牌動畫', n0 >= 12 && f2.prizeAnim === 0, JSON.stringify({ prizeCards: n0, ...f2 }));
      // E3：分頁進背景 ⇒ 結束回合讓 AI 行動 ⇒ 不產生抽牌飛入／回合橫幅
      await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await resetFx();
      const endBtn = pg.locator('button:visible:not([disabled])', { hasText: /結束回合|跳過攻擊/ });
      if (await endBtn.count()) await endBtn.first().click({ timeout: 2000 }).catch(() => {});
      let back = false;
      for (let w = 0; w < 70 && !back; w++) { await sysStep(); await pg.waitForTimeout(400); back = await myTurnNow(); }
      const f3 = await fx();
      if (!back && process.env.V6580_DEBUG) await pg.screenshot({ path: '/tmp/v6580-e3.png' });
      ok('[E3 前提] 背景期間 AI 打完一回合、又輪到我', back);
      ok('★★★ E3 分頁在背景時收到的動作 ⇒ 不產生抽牌飛入／回合橫幅（回來不補播）', back && f3.drawFly === 0 && f3.banner === 0, JSON.stringify(f3));
      // 回到前景、等過安靜期 ⇒ 再打一回合 ⇒ 動畫照常（正對照）
      await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await pg.waitForTimeout(2300);
      await resetFx();
      if (await endBtn.count()) await endBtn.first().click({ timeout: 2000 }).catch(() => {});
      back = false;
      for (let w = 0; w < 70 && !back; w++) { await sysStep(); await pg.waitForTimeout(400); back = await myTurnNow(); }
      const f4 = await fx();
      ok('★★ E3M 正對照：回到前景後的動作照常播（抽牌飛入、回合橫幅）', f4.drawFly > 0 && f4.banner > 0, JSON.stringify(f4));
    }
    ok('[E4] 頁面零錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close(); await browser.close(); srv.close();
  }
}
console.log(`\n=== v6.580 動畫只在當下播放：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
