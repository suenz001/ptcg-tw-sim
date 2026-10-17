#!/usr/bin/env node
/**
 * v6.581 守衛：對手出牌、我方抽牌時，把那張牌放到畫面中間翻開（站長 2026-10-17「先做這項」，參考 PTCGCodex）
 *
 *   【U】判準 computeRevealEvents（src/lib/game/card-reveal.ts，唯一一份）—— 用真引擎＋AI 打一整局逐步驗
 *     U1 對手的放備戰、附能、物品、支援者、進化都抓得到；我方抽牌也抓得到
 *     U2 ⭐不洩漏：對手的每一張展示牌在下一份盤面都已經公開；我方只有「抽牌」會展示，而且只給自己
 *     U3 換座位（我是 P2）一樣成立；觀戰（-1）雙方出牌都展示、任何人的抽牌都不展示
 *     U4 ⭐錦標賽盤面遮蔽（對手手牌連 iid 都換成不透明編號）時，對手出牌照樣抓得到，結果與不遮蔽一致
 *     U5 開局（setup）、開局結束那一步、不同局 ⇒ 不展示；一步最多 3 張
 *   【S】接線：先問 animObserve（v6.580 不重播）、改走中間展示的抽牌不再另外飛、設定開關、CSS 在 blue-css 之前、零新媒體查詢
 *   【E】真瀏覽器（AI 對戰）
 *     E1 對手出牌會在中間出現（含「對手…」標籤與卡名）；E2 我方抽牌會出現「抽到」；
 *     E3 抽到的那張手牌在展示結束後一定出現（不會永久隱形）；E4 中間展示不攔滑鼠；E5 關掉開關 ⇒ 不再出現
 *   【H】HEAD-FAIL：S 組餵 BASE（v6.580）必紅
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame } from './lib/ai-sim-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.580。
const BASE_SHA = '13ada543d9d6804f9d6916d8e48165200358c29e';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

console.log('【U】判準（真引擎＋AI 一整局）');
const mod = await buildAiBundle(ROOT, { extraExports: [
  "export { computeRevealEvents, publicIidsOf, REVEAL_MAX_PER_STEP } from './src/lib/game/card-reveal';",
  "export { redactStateForSeat } from './src/lib/game/replay-record';",
] });
const pool = loadLivePool(ROOT);
const getCard = (id) => pool.get(String(id));
const decks = [presetById(mod, '__preset_tactic_dragonite__'), presetById(mod, '__preset_tactic_gardevoir__')];
const ai = (st, i) => mod.aiNew(st, pool, i);
const trace = [];
playGame({ mod, pool, decks, agents: [ai, ai], seed: 7, firstPlayer: 0, maxSteps: 500, onStep: (st, _a, next) => { trace.push([st, next]); } });
ok('[U 前提] 打了一整局（步數 > 60）', trace.length > 60, String(trace.length));
const run = (seat, redact) => {
  const kinds = {}; let leaks = 0, ownNonDraw = 0, spectDraw = 0, over = 0, total = 0;
  for (const [a, b] of trace) {
    const A = redact ? mod.redactStateForSeat(a, seat) : a, B = redact ? mod.redactStateForSeat(b, seat) : b;
    const ev = mod.computeRevealEvents(A, B, { viewerSeat: seat, getCard });
    if (ev.length > mod.REVEAL_MAX_PER_STEP) over++;
    for (const e of ev) {
      total++; kinds[e.kind] = (kinds[e.kind] || 0) + 1;
      const opp = seat === -1 || e.side !== seat;
      if (opp) { if (e.kind === 'draw') spectDraw++; else if (!mod.publicIidsOf(b, e.side).has(e.iid.split(':')[0])) leaks++; }
      else if (e.kind !== 'draw') ownNonDraw++;
    }
  }
  return { kinds, leaks, ownNonDraw, spectDraw, over, total };
};
const r0 = run(0, false), r1 = run(1, false), rs = run(-1, false), rr = run(0, true);
const need = ['bench', 'energy', 'item', 'supporter', 'evolve', 'draw'];
ok('★★★ U1 對手的放備戰、附能、物品、支援者、進化，以及我方抽牌都抓得到', need.every((k) => (r0.kinds[k] || 0) > 0), JSON.stringify(r0.kinds));
ok('★★★ U2 不洩漏：對手的展示牌下一步都已公開；我方只有抽牌會展示', r0.leaks === 0 && r0.ownNonDraw === 0 && r0.spectDraw === 0, JSON.stringify(r0));
ok('★★ U3 我是 P2 一樣成立', r1.leaks === 0 && r1.ownNonDraw === 0 && (r1.kinds.draw || 0) > 0 && (r1.kinds.bench || 0) > 0, JSON.stringify(r1));
ok('★★★ U3b 觀戰：雙方出牌都展示、任何人的抽牌都不展示', rs.spectDraw === 0 && !rs.kinds.draw && rs.leaks === 0 && rs.total >= r0.total - (r0.kinds.draw || 0), JSON.stringify(rs));
{
  // 遮蔽後的對手出牌必須與不遮蔽完全一致（抽牌是我方自己的，不受遮蔽影響）
  const oppKinds = (r) => JSON.stringify(Object.fromEntries(Object.entries(r.kinds).filter(([k]) => k !== 'draw').sort()));
  ok('★★★ U4 錦標賽盤面遮蔽（對手手牌 iid 不透明）時，對手出牌照樣抓得到、結果與不遮蔽一致', rr.leaks === 0 && oppKinds(rr) === oppKinds(r0) && rr.total > 0, oppKinds(rr) + ' vs ' + oppKinds(r0));
}
{
  const setupPair = trace.find(([a]) => a.phase === 'setup');
  const startPair = trace.find(([a, b]) => a.phase === 'setup' && b.phase === 'playing');
  const [a, b] = trace[Math.floor(trace.length / 2)];
  ok('★★ U5 開局、開局結束那一步、不同局 ⇒ 不展示；每一步不超過上限',
    (!setupPair || mod.computeRevealEvents(setupPair[0], setupPair[1], { viewerSeat: 0, getCard }).length === 0)
    && (!startPair || mod.computeRevealEvents(startPair[0], startPair[1], { viewerSeat: 0, getCard }).length === 0)
    && mod.computeRevealEvents(a, { ...b, id: 'other' }, { viewerSeat: 0, getCard }).length === 0 && r0.over === 0);
}

{
  // U6 標籤正確（審查 P2-1／P2-2）：「使用物品／支援者」一定對應這一步引擎記下的「從手牌打出」；回答選擇視窗（搜尋加入手牌）不算「抽到」
  let badUse = 0, badDraw = 0, uses = 0;
  for (const [a, b] of trace) {
    const ev = mod.computeRevealEvents(a, b, { viewerSeat: 0, getCard });
    for (const e of ev) {
      if (e.kind === 'item' || e.kind === 'supporter') {
        uses++;
        const pr = (a.players[e.side].currentTurnActions ?? []).length;
        const recs = (b.players[e.side].currentTurnActions ?? []).slice(pr).filter((r) => r.type === 'play_hand').map((r) => String(r.cardId));
        if (!recs.includes(String(e.cardId))) badUse++;
      }
      if (e.kind === 'draw' && a.pendingSelection) badDraw++;
    }
  }
  // 正對照：拿掉「必須有 play_hand」這個條件（把紀錄塞成每張都打出）⇒ 會多出被丟棄的訓練家
  let looser = 0;
  for (const [a, b] of trace) {
    const fake = { ...b, players: b.players.map((p, i) => ({ ...p, currentTurnActions: [...(a.players[i].currentTurnActions ?? []), ...(p.discard ?? []).map((d) => ({ type: 'play_hand', cardId: d.cardId }))] })) };
    looser += mod.computeRevealEvents(a, fake, { viewerSeat: 0, getCard }).filter((e) => e.kind === 'item' || e.kind === 'supporter').length;
  }
  ok('★★★ U6 「對手使用物品／支援者」都是真的從手牌打出（不含被丟棄當代價的）；搜尋加入手牌不算「抽到」', uses > 0 && badUse === 0 && badDraw === 0, JSON.stringify({ uses, badUse, badDraw }));
  ok('★★ U6M 自驗：不看「從手牌打出」紀錄時，會多出被丟棄的訓練家（這局真的有丟牌代價）', looser > uses, JSON.stringify({ looser, uses }));
}

console.log('\n【S】接線');
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
function scenS(src) {
  const blueAt = src.indexOf('/* >>> v6441-blue-css */'), cssAt = src.indexOf('/* >>> v6581-card-reveal-css */');
  const after = blueAt >= 0 ? src.slice(blueAt) : '';
  return {
    S1: src.includes("from '$lib/game/card-reveal'") && /computeRevealEvents\(prev, g, \{ viewerSeat: \(isSpectator \? -1 : myIdx\)/.test(src),
    S2: /if \(untrack\(\(\) => animObserve\(g\)\)\.baseline\) return;/.test(src),
    S3: /!prizePickIids\.has\(inst\.iid\) && !revealDrawIids\.has\(inst\.iid\)\) newIids\.push/.test(src),
    S4: /id="card-reveal-on" type="checkbox" checked=\{cardRevealOn\}/.test(src) && /localStorage\.getItem\('ptcg_card_reveal'\) === '0'/.test(src),
    S7: /function cardRevealReset\(\)/.test(src) && /if \(!g\) \{ _revealPrev = null; untrack\(\(\) => cardRevealReset\(\)\); return; \}/.test(src)
      && /if \(prev && prev\.id !== g\.id\) untrack\(\(\) => cardRevealReset\(\)\);/.test(src) && (src.match(/cardRevealReset\(\);             \/\/ ⭐v6\.581 悔掉的牌不再展示/g) || []).length === 3
      && /cardRevealOn = v; if \(!v\) cardRevealReset\(\);/.test(src),
    S5: cssAt > 0 && blueAt > cssAt && /\.card-reveal-layer\{[^}]*pointer-events:none/.test(src) && !/v6581/.test(after.split('/* <<< v6441-blue-css */')[0] || ''),
  };
}
const LABEL = { S1: '★★ S1 中間展示的事件只來自 computeRevealEvents', S2: '★★★ S2 先問 animObserve（觀戰進房、重新整理、背景回來不補播）', S3: '★★★ S3 改走中間展示的抽牌不再另外播抽牌飛入',
  S4: '★★ S4 設定開關（預設開、記在瀏覽器）', S7: '★★★ S7 換局、離開、三條悔棋、關掉開關都會清掉展示中與排隊中的牌（不殘留）', S5: '★★ S5 CSS 在 v6441-blue-css 之前、展示層不攔滑鼠' };
const R = scenS(SRC);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true);
ok('★ S6 零新增媒體查詢（v6581 哨兵內沒有 @media）', !/@media/.test(SRC.slice(SRC.indexOf('/* >>> v6581-card-reveal-css */'), SRC.indexOf('/* <<< v6581-card-reveal-css */'))));
console.log('【H】HEAD-FAIL（BASE v6.580）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6581 HEAD-FAIL', '需要歷史 commit');
else { const x = readBaseBlob(ROOT, BASE_SHA, REL); const B = scenS(x.ok ? x.out.replace(/\r\n/g, '\n') : ''); for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.580：${k} 紅`, B[k] !== true); }

console.log('\n【E】真瀏覽器');
const BUILD = process.env.V6581_BUILD || join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.581 中間展示') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.581 中間展示');
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
    const runGame = async (revealOn, maxTurns) => {
      const errs = [];
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
      await ctx.addInitScript((on) => {
        let x = 7; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
        localStorage.setItem('ptcg_battle_layout', 'blue');
        if (!on) localStorage.setItem('ptcg_card_reveal', '0');
        window.__rv = []; window.__rvBlock = 0;
        new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (!(n instanceof Element)) continue;
          const e = n.matches('.card-reveal') ? n : n.querySelector?.('.card-reveal'); if (!e) continue;
          window.__rv.push(e.querySelector('.card-reveal-label')?.textContent?.trim() || '');
          // 展示中點畫面正中央 ⇒ 點到的不可以是展示層（不攔滑鼠）
          requestAnimationFrame(() => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); if (el && el.closest('.card-reveal-layer')) window.__rvBlock++; });
        } }).observe(document, { childList: true, subtree: true });
      }, revealOn);
      const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
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
      await pg.waitForSelector('.hand-card.draggable', { timeout: 60000 });
      await pg.waitForTimeout(1500);
      const a = await pg.locator('.hand-card.draggable').first().boundingBox(), z = await pg.locator('.my-active-zone').boundingBox();
      if (a && z) { await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await pg.mouse.down(); await pg.mouse.move(a.x + 20, a.y, { steps: 3 }); await pg.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 }); await pg.mouse.up(); }
      await pg.mouse.move(5, 500);
      const sysSel = () => pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成|確認/ });
      const myTurnNow = async () => (await pg.locator('button:visible:not([disabled])', { hasText: '跳過攻擊' }).count()) > 0;
      let turns = 0, hiddenAfter = 0;
      for (let w = 0; w < 200 && turns < maxTurns; w++) {
        if (await myTurnNow() && w > 10) {
          // 輪到我：等展示播完，手牌每一張都必須看得到（抽到的那張不可以永久隱形）
          await pg.waitForTimeout(2800);
          hiddenAfter += await pg.evaluate(() => [...document.querySelectorAll('.hand-scroll > .hand-card')].filter((e) => getComputedStyle(e).opacity === '0').length);
          turns++;
          const eb = pg.locator('button:visible:not([disabled])', { hasText: /結束回合|跳過攻擊/ }); if (await eb.count()) await eb.first().click({ timeout: 2000 }).catch(() => {});
        }
        const sb = sysSel(); if (await sb.count()) await sb.first().click({ timeout: 2000 }).catch(() => {});
        await pg.waitForTimeout(300);
      }
      const rv = await pg.evaluate(() => window.__rv), block = await pg.evaluate(() => window.__rvBlock);
      await ctx.close();
      return { rv, block, turns, hiddenAfter, errs };
    };
    const on = await runGame(true, 2);
    ok('[E 前提] 打了幾個回合', on.turns >= 2, JSON.stringify({ turns: on.turns }));
    ok('★★★ E1 對手出牌會在中間出現（「對手…」標籤＋卡名）', on.rv.some((t) => /^對手(放到備戰區|附加能量|使用支援者|使用物品|進化|派上戰鬥場|附加道具|打出競技場)\S+/.test(t)), JSON.stringify(on.rv.slice(0, 6)));
    ok('★★★ E2 我方抽牌會出現「抽到」', on.rv.some((t) => /^抽到\S+/.test(t)), JSON.stringify(on.rv.slice(0, 8)));
    ok('★★★ E3 抽到的那張手牌在展示結束後一定看得到（沒有永久隱形）', on.turns >= 2 && on.hiddenAfter === 0, String(on.hiddenAfter));
    ok('★★ E4 中間展示不攔滑鼠（點畫面正中央點不到展示層）', on.rv.length > 0 && on.block === 0, String(on.block));
    ok('[E] 頁面零錯誤', on.errs.length === 0, on.errs.slice(0, 2).join(' | '));
    const off = await runGame(false, 2);
    ok('★★ E5 設定關掉 ⇒ 不再出現中間展示（正對照：同一局開著時有）', off.turns >= 1 && off.rv.length === 0 && on.rv.length > 0, JSON.stringify({ off: off.rv.length, offTurns: off.turns, on: on.rv.length }));
    await browser.close(); srv.close();
  }
}
console.log(`\n=== v6.581 出牌／抽牌放到中間翻開：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
