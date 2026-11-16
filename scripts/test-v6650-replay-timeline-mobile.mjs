// v6.650 守衛：回放時間軸記號（R2：回合記號＋昏厥節點＋圖例）與手機「詳情」面板（R6）
//
// 【I】索引（src/lib/game/replay-index.ts，實跑）
//   I1 replayFaints：場上的寶可夢進到「同一位玩家」的棄牌區才算昏厥；回手牌／回牌庫／進化／換位都不算；一格多隻逐隻列出；終局與最後一格相同不重複
//   I2 replayTimelineMarks：回合記號＝turnStarts（行動方不確定 ⇒ null）；同一位玩家相近的昏厥合併並計數，不同玩家不合併
//   I3 buildReplayIndex 帶出 faints（真的 AI 對局：每一次昏厥都對應到那一格的紀錄裡有「昏厥」字樣——只拿來驗證，判準本身不看文字）
// 【F】對戰頁接線
//   F1 桌機時間軸：range 包在 .treplay-track 裡，記號用同一個 snippet（replayMarks）；圖例 replayLegend；點記號走 replayManualGoto（會停掉播放）
//   F2 手機：詳情開關＋面板（預設收起、離開與開新回放都收起、Esc／收起鈕關閉後焦點回到開關）；面板用 --safe-* 避開瀏海
//   F3 昏厥節點一定有符號（● ◆），不是只有顏色
// 【E】真瀏覽器（build/）
//   E1 桌機：回合記號數＝半回合數、昏厥節點都在、點節點跳到那一步且停掉播放；控制列高度不變（時間軸那一列沒有被撐高）
//   E2 手機 390×844：預設收起；打開後面板在控制列正下方、不蓋到手牌與下方操作、內容在面板內捲動；昏厥節點至少 24px 好按；收起後焦點回到開關
//   E3 手機截圖（V6650_SHOT）
// 【H】HEAD-FAIL：BASE（42512b4e＝v6.649）上 I1／I2／F1／F2 紅
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '42512b4e';
const PAGE = 'src/routes/game/+page.svelte';
const SHOT = process.env.V6650_SHOT || '';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 500) : '')); } };
const tmp = mkdtempSync(join(tmpdir(), 'v6650-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

async function bundleIndex(src) {
  if (!src) return null;
  const f = join(tmp, 'ri-' + Math.random().toString(36).slice(2) + '.ts');
  writeFileSync(f, src.replace("from './replay-record'", `from ${JSON.stringify(join(ROOT, 'src/lib/game/replay-record.ts'))}`));
  const out = f.replace(/\.ts$/, '.mjs');
  const stub = join(tmp, 'stub.js'); writeFileSync(stub, 'export const base="";export const browser=false;');
  await build({ entryPoints: [f], outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': stub, '$app/environment': stub }, logLevel: 'silent' });
  return import(pathToFileURL(out).href);
}

// ── 小盤面 ──
const inst = (iid, cardId = 'c' + iid) => ({ iid, cardId });
const P = (active, bench = [], discard = [], hand = [], prizes = 6) => ({ active, bench, discard, hand, prizes: Array.from({ length: prizes }, (_, k) => inst('pz' + k)) });
const st = (p0, p1) => ({ players: [p0, p1] });
const step = (turn, ap, state, extra = {}) => ({ turn, activePlayerIndex: ap, logLen: 0, state, ...extra });

function checkI(M, tag) {
  const has = !!M && typeof M.replayFaints === 'function' && typeof M.replayTimelineMarks === 'function';
  ok(`★★★ I0${tag} 模組有 replayFaints／replayTimelineMarks`, has);
  if (!has) { ok(`★★★ I1${tag} replayFaints`, false); ok(`★★★ I2${tag} replayTimelineMarks`, false); return; }
  // 0 號玩家的獎賞卡張數隨 1 號玩家的寶可夢昏厥減少（取獎可能晚一格）
  const S = [
    step(1, 0, st(P(inst('a')), P(inst('x'), [inst('y'), inst('z')]))),
    step(1, 0, st(P(inst('a'), [], [], [], 5), P(inst('y'), [inst('z')], [inst('x')]))),                 // x 昏厥進棄牌、對手同一格取獎
    step(2, 1, st(P(inst('b'), [], [], [inst('a')], 5), P(inst('y'), [inst('z')], [inst('x')]))),        // a 回手牌（不算）
    step(2, 1, st(P(inst('b2', 'evo'), [], [], [], 5), P(inst('z'), [inst('w')], [inst('x'), inst('y')]))),   // y 昏厥（取獎晚一格）；b→b2 不算
    step(2, 1, st(P(inst('b2', 'evo'), [], [], [], 4), P(inst('z'), [inst('w')], [inst('x'), inst('y')]))),
    step(3, 0, st(P(inst('b2', 'evo'), [], [], [], 3), P(inst('w'), [], [inst('x'), inst('y'), inst('z')]))), // z（備戰）昏厥
    step(3, 0, st(P(null, [], [], [], 2), P(null, [], [inst('x'), inst('y'), inst('z'), inst('w')]))),       // b2 不見了但不在棄牌（不算）；w 昏厥
    step(3, null, st(P(null, [], [], [], 2), P(null, [], [inst('x'), inst('y'), inst('z'), inst('w')])), { isFinal: true }), // 終局不重複
  ];
  // 一格兩隻（對手一次取 2 張）
  const S2 = [step(1, 0, st(P(inst('p')), P(inst('q'), [inst('r')]))), step(1, 0, st(P(inst('p'), [], [], [], 4), P(null, [], [inst('q'), inst('r')])))];
  // 換場地後備戰被丟棄：進棄牌區但對手沒拿獎賞卡 ⇒ 不算昏厥（審查 P2-1）
  const S3 = [step(1, 0, st(P(inst('p')), P(inst('q'), [inst('r'), inst('s')]))), step(1, 0, st(P(inst('p')), P(inst('q'), [inst('r')], [inst('s')]))), step(1, 0, st(P(inst('p')), P(inst('q'), [inst('r')], [inst('s')])))];
  const f = M.replayFaints(S), f2 = M.replayFaints(S2), f3 = M.replayFaints(S3);
  ok(`★★★ I1${tag} 昏厥＝場上→同一位玩家的棄牌區，且對手 3 格內拿了獎賞卡（回手牌、進化、去向不明、換場地丟棄備戰都不算；備戰也算；一格兩隻逐隻列；終局不重複）`,
    JSON.stringify(f.map((x) => [x.step, x.side, x.cardId])) === JSON.stringify([[1, 1, 'cx'], [3, 1, 'cy'], [5, 1, 'cz'], [6, 1, 'cw']])
      && JSON.stringify(f2.map((x) => [x.step, x.side, x.cardId])) === JSON.stringify([[1, 1, 'cq'], [1, 1, 'cr']]) && f3.length === 0,
    JSON.stringify({ f, f2, f3 }));
  const idx = { n: 101, turnStarts: [0, 10, 50, 100], faints: [{ step: 20, side: 0, cardId: 'a' }, { step: 21, side: 0, cardId: 'b' }, { step: 21, side: 1, cardId: 'c' }, { step: 60, side: 0, cardId: 'd' }] };
  const steps = Array.from({ length: 101 }, (_, i) => ({ turn: 1 + Math.floor(i / 10), activePlayerIndex: i === 50 ? null : (Math.floor(i / 10) % 2), isFinal: i === 100, logLen: i }));
  const mk = M.replayTimelineMarks(idx, steps, 0.012);
  const wide = M.replayTimelineMarks(idx, steps, 0.5);
  ok(`★★★ I2${tag} 回合記號＝每個半回合開頭（行動方不確定／終局 ⇒ null）；同一位玩家相近的昏厥合併計數、不同玩家不合併、遠的不合併`,
    JSON.stringify(mk.ticks.map((t) => [t.step, t.side])) === JSON.stringify([[0, 0], [10, 1], [50, null], [100, null]])
      && JSON.stringify(mk.faints.map((x) => [x.step, x.side, x.count, x.lastStep])) === JSON.stringify([[20, 0, 2, 21], [21, 1, 1, 21], [60, 0, 1, 60]])
      && JSON.stringify(wide.faints.map((x) => [x.step, x.side, x.count])) === JSON.stringify([[20, 0, 3], [21, 1, 1]]),
    JSON.stringify({ t: mk.ticks, f: mk.faints, w: wide.faints }));
}

function playOne(mod, pool, seed) {
  const states = []; let last = null;
  playGame({ mod, pool, decks: [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')], agents: [(s, i) => mod.aiNew(s, pool, i), (s, i) => mod.aiNew(s, pool, i)], seed, firstPlayer: firstPlayerOf(seed),
    onStep: (s, act, next) => { if (next && next !== last) { states.push(next); last = next; } } });
  return states;
}

function checkI3(M, mod, pool) {
  if (!M?.buildReplayIndex) { ok('★★ I3 真對局（模組不存在）', false); return; }
  let total = 0, bad = [];
  for (const seed of [3, 5, 7]) {
    const states = playOne(mod, pool, seed);
    const steps = states.filter((s) => s.phase === 'playing').map((s) => ({ turn: s.turn, activePlayerIndex: s.activePlayerIndex, logLen: s.log.length, state: s }));
    const fin = states[states.length - 1];
    const x = M.buildReplayIndex(steps, fin.log);
    total += x.faints.length;
    for (const f of x.faints) {
      const lines = M.replayStepLines(x, f.step).map((k) => fin.log[k].message).join('|');
      if (!/昏厥/.test(lines)) bad.push({ seed, step: f.step, lines: lines.slice(0, 120) });
    }
  }
  ok(`★★ I3 真的 AI 對局（3 局）：抓到 ${total} 次昏厥（下限 6），每一次那一格的紀錄都有「昏厥」（只用來驗證）`, total >= 6 && bad.length === 0, JSON.stringify(bad.slice(0, 3)));
}

function checkF(pageRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const tl = (() => { const i = page.indexOf('<div class="treplay-timeline">'); return i > 0 ? page.slice(i, page.indexOf('</div>', i)) : ''; })();
  const sn = (() => { const i = page.indexOf('{#snippet replayMarks('); return i > 0 ? page.slice(i, page.indexOf('{/snippet}', i)) : ''; })();
  ok(`★★★ F1${tag} 桌機時間軸：range 包在 .treplay-track、記號用 replayMarks、旁邊有圖例；點記號走 replayManualGoto（會停掉播放）`,
    /<span class="treplay-track">\s*<input class="treplay-range"[\s\S]*?\{@render replayMarks\('desk'\)\}\s*<\/span>/.test(tl) && /\{@render replayLegend\('desk'\)\}/.test(tl)
      && /onclick=\{\(\) => replayManualGoto\(t\.step\)\}/.test(sn) && /onclick=\{\(\) => replayManualGoto\(f\.firstStep\)\}/.test(sn) && /replayTimelineMarks\(_ri, tReplaySteps\(\)/.test(sn),
    tl.slice(0, 160));
  const mob = (() => { const i = page.indexOf('<div class="treplay-mob" role="toolbar"'); return i > 0 ? page.slice(i, i + 4500) : ''; })();
  const ord = (() => { const i = page.indexOf('function openReplayData('); return i > 0 ? page.slice(i, i + 3000) : ''; })();
  ok(`★★★ F2${tag} 手機：詳情開關（預設收起）＋面板（Esc／收起鈕關閉、焦點回到開關）；開新回放與離開回放都收起；面板用 --safe-*`,
    /<button type="button" class="treplay-mob-step treplay-mob-more" bind:this=\{replayMobToggleEl\} aria-expanded=\{replayMobPanel\}/.test(mob) && /<div class="treplay-mob-panel" id="treplay-mob-panel"/.test(mob)
      && /if \(e\.key === 'Escape'\) \{ e\.stopPropagation\(\); replayMobPanelClose\(\); \}/.test(mob) && /\{@render replayMarks\('mob'\)\}/.test(mob) && /\{@render replayLegend\('mob'\)\}/.test(mob)
      && /function replayMobPanelClose\(\) \{ replayMobPanel = false; void tick\(\)\.then\(\(\) => \{ try \{ replayMobToggleEl\?\.focus\(\); \} catch/.test(page)
      && /\$effect\.pre\(\(\) => \{ if \(!isTReplay\) replayMobPanel = false; \}\);/.test(page) && /replayMobPanel = false;/.test(ord)
      && /\.treplay-mob-panel \{ position: fixed; z-index: 81; top: calc\(var\(--safe-top, 0px\) \+ 54px\); left: max\(var\(--safe-left, 0px\), 6px\); right: max\(var\(--safe-right, 0px\), 6px\);/.test(page),
    mob.length);
  ok(`★★ F4${tag} 時間軸記號上的空白鍵交還（按下記號＝跳過去，不切換播放）`, /:not\(\.treplay-tick\):not\(\.treplay-faint\)/.test(readFileSync(join(ROOT, 'src/lib/game/replay-keys.ts'), 'utf8')) || tag !== '');
  ok(`★★ F3${tag} 昏厥節點有符號（● ◆，不只靠顏色）；圖例列出兩種符號與「回合」`, /\{f\.side === 0 \? '●' : '◆'\}/.test(sn) && /● \{String\(game\?\.players\?\.\[0\]/.test(page) && /◆ \{String\(game\?\.players\?\.\[1\]/.test(page) && /｜回合/.test(page));
}

async function checkE(browser, mod, pool) {
  const BUILD = join(ROOT, 'build');
  if (!existsSync(join(BUILD, '404.html'))) { console.log('  ENV-SKIP E（沒有 build/）'); return; }
  if (!browser) { console.log('  ENV-SKIP E（沒有瀏覽器）'); return; }
  const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
    if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) p = join(BUILD, '404.html');
    res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
  });
  await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
  try {
    const states = playOne(mod, pool, 7);
    const fin = states[states.length - 1];
    const snaps = states.filter((s) => s.phase === 'playing').map((s) => ({ turn: s.turn, activePlayerIndex: s.activePlayerIndex, logLen: s.log.length, state: { ...s, log: [] } })).slice(0, 4000);
    const replayData = { meta: { matchId: 'EV_r1_m0', eventId: 'EV', p1name: 'A', p2name: 'B', winnerName: 'A', round: 1 }, finalLog: fin.log, finalState: { ...fin, log: [] }, snapshots: snaps };
    const M = await bundleIndex(readFileSync(join(ROOT, 'src/lib/game/replay-index.ts'), 'utf8'));
    const steps = [...snaps.map((s) => ({ ...s })), { turn: fin.turn, activePlayerIndex: fin.activePlayerIndex, logLen: fin.log.length, isFinal: true, state: fin }];
    const ix = M.buildReplayIndex(steps, fin.log);
    const expTicks = ix.turnStarts.length, expFaint = M.replayTimelineMarks(ix, steps, 0.012).faints.length;
    const mkCtx = async (opts) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', ...opts });
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
      await ctx.route(/\/api\/tournament\/replay\?/, (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replayData) }));
      await ctx.route(/\/api\/replay\/tourn-steps/, (rt) => rt.fulfill({ status: 404, body: '' }));
      await ctx.addInitScript(() => { try { localStorage.setItem('ptcg_battle_layout', 'blue'); } catch { /* */ } });
      return ctx;
    };
    // ── 桌機 ──
    {
      const ctx = await mkCtx({ viewport: { width: 1376, height: 958 }, deviceScaleFactor: SHOT ? 2 : 1 });
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/game?treplay=EV_r1_m0`, { waitUntil: 'load' });
      await pg.waitForSelector('.treplay-bar .treplay-marks', { timeout: 60000 }); await pg.waitForTimeout(600);
      const r = await pg.evaluate(() => ({ ticks: document.querySelectorAll('.treplay-bar .treplay-tick').length, faints: document.querySelectorAll('.treplay-bar .treplay-faint').length,
        tlH: Math.round(document.querySelector('.treplay-timeline').getBoundingClientRect().height), legend: document.querySelector('.treplay-bar .treplay-legend')?.textContent || '' }));
      if (SHOT) { await pg.evaluate(() => document.querySelector('.admin-broadcast-close')?.click()); await pg.waitForTimeout(200); await pg.screenshot({ path: SHOT + '/v6650-desktop-timeline.png', clip: { x: 0, y: 0, width: 1376, height: 140 } }); }
      // 播放中點最後一個昏厥節點 ⇒ 跳過去並停播
      await pg.evaluate(() => document.querySelector('.treplay-play')?.click()); await pg.waitForTimeout(150);
      const target = await pg.evaluate(() => { const fs = [...document.querySelectorAll('.treplay-bar .treplay-faint')]; const b = fs[fs.length - 1]; if (!b) return null; b.click(); return b.getAttribute('title'); });
      await pg.waitForTimeout(400);
      const after = await pg.evaluate(() => ({ step: document.querySelector('.treplay-step')?.textContent || '', play: document.querySelector('.treplay-play')?.textContent || '', here: !!document.querySelector('.treplay-bar .treplay-faint.here') }));
      const wantStep = Number((target || '').match(/第 (\d+) 步/)?.[1] || -1);
      ok(`★★★[E1] 桌機：回合記號 ${r.ticks}＝半回合數 ${expTicks}、昏厥節點 ${r.faints}＝${expFaint}（至少 1 個）、圖例有 ● ◆；點節點跳到那一步（${wantStep}）且停掉播放；時間軸那一列沒有被撐高（${r.tlH}px）`,
        r.ticks === expTicks && r.faints === expFaint && r.faints >= 1 && /●/.test(r.legend) && /◆/.test(r.legend) && after.step.includes(`（${wantStep}/`) && /播放/.test(after.play) && after.here && r.tlH <= 30 && errs.length === 0,
        JSON.stringify({ r, after, target, errs: errs.slice(0, 2) }));
      await ctx.close();
    }
    // ── 手機 ──
    {
      const ctx = await mkCtx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOT ? 2 : 1, isMobile: true, hasTouch: true });
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/game?treplay=EV_r1_m0`, { waitUntil: 'load' });
      await pg.waitForSelector('.treplay-mob', { timeout: 60000 }); await pg.waitForTimeout(800);
      const closed = await pg.evaluate(() => ({ panel: !!document.querySelector('.treplay-mob-panel'), tog: !!document.querySelector('.treplay-mob .treplay-mob-more') }));
      // 全站公告橫幅可能晚一點才出現並蓋住頂端 ⇒ 先關掉再量（與本功能無關）
      for (let k = 0; k < 3; k++) { await pg.evaluate(() => document.querySelector('.admin-broadcast-close')?.click()); await pg.waitForTimeout(150); }
      await pg.locator('.treplay-mob-more').tap(); await pg.waitForTimeout(400);
      const geo = await pg.evaluate(() => {
        const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
        const panel = r('.treplay-mob-panel'), bar = r('.treplay-mob');
        const hand = r('.mp-hand'); const tog = r('.treplay-mob-more');
        // 開關的實際可點高度（含 ::before）：從中心往上下找 elementFromPoint 仍打到開關的範圍
        const tb = document.querySelector('.treplay-mob-more').getBoundingClientRect(); const cx = tb.left + tb.width / 2; let hitH = 0;
        for (let y = tb.top - 15; y <= tb.bottom + 15; y++) { const e = document.elementFromPoint(cx, y); if (e && e.closest('.treplay-mob-more')) hitH++; }
        const fs = [...document.querySelectorAll('.treplay-mob-panel .treplay-faint')].map((e) => { const b = e.getBoundingClientRect(); return [b.width, b.height]; });
        const p = document.querySelector('.treplay-mob-panel');
        return { panel, bar, hand, tog, hitH, fs, scrollable: p ? getComputedStyle(p).overflowY : '', innerW: innerWidth, innerH: innerHeight, sum: document.querySelector('.treplay-mob-sum')?.textContent?.trim() || '', legend: document.querySelector('.treplay-mob-panel .treplay-legend')?.textContent || '', focus: document.activeElement?.className || '' };
      });
      if (SHOT) await pg.screenshot({ path: SHOT + '/v6650-mobile-panel.png' });
      // 點面板裡的昏厥節點 ⇒ 跳步
      const before = await pg.evaluate(() => document.querySelector('.treplay-mob-step')?.textContent || '');
      await pg.evaluate(() => { const fs = [...document.querySelectorAll('.treplay-mob-panel .treplay-faint')]; fs[fs.length - 1]?.click(); }); await pg.waitForTimeout(300);
      const afterStep = await pg.evaluate(() => document.querySelector('.treplay-mob-step')?.textContent || '');
      await pg.locator('.treplay-mob-close').tap(); await pg.waitForTimeout(300);
      const end = await pg.evaluate(() => ({ panel: !!document.querySelector('.treplay-mob-panel'), focus: document.activeElement?.classList.contains('treplay-mob-more') }));
      ok('★★★[E2] 手機 390×844：預設收起（開關就是控制列裡的步數字樣，不浮在盤面上，可點高度 ≥24px）；打開後面板在控制列正下方、不超出畫面、不蓋到手牌、面板內可捲動；有摘要與圖例；昏厥節點 ≥24px；點節點會跳步；收起後焦點回到「詳情」',
        !closed.panel && closed.tog && !!geo.panel && !!geo.bar && geo.panel.t >= geo.bar.b - 2 && geo.panel.l >= 0 && geo.panel.r <= geo.innerW && geo.panel.b <= geo.innerH * 0.5 + geo.bar.b
          && !!geo.hand && geo.panel.b <= geo.hand.t && !!geo.tog && geo.tog.t >= geo.bar.t && geo.tog.b <= geo.bar.b && geo.hitH >= 24 && geo.scrollable === 'auto' && geo.sum.length > 0 && /●/.test(geo.legend) && geo.fs.length >= 1 && geo.fs.every(([w, h]) => w >= 24 && h >= 24)
          && afterStep !== before && !end.panel && end.focus === true && errs.length === 0,
        JSON.stringify({ closed, geo, before, afterStep, end, errs: errs.slice(0, 2) }));
      await ctx.close();
    }
  } finally { srv.close(); }
}

const pageRaw = readFileSync(join(ROOT, PAGE), 'utf8');
const riSrc = readFileSync(join(ROOT, 'src/lib/game/replay-index.ts'), 'utf8');
const M = await bundleIndex(riSrc);
const mod = await buildAiBundle(ROOT, {}), pool = loadLivePool(ROOT);
console.log('【I】索引'); checkI(M, ''); checkI3(M, mod, pool);
console.log('【F】對戰頁接線'); checkF(pageRaw, '');
const chromium = pwChromium('v6.650 回放時間軸');
const browser = chromium ? await pwLaunchWith(chromium, 'v6.650 回放時間軸') : null;
console.log('【E】真瀏覽器'); await checkE(browser, mod, pool);
if (browser) await browser.close();
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const bp = readBaseBlob(ROOT, BASE_SHA, PAGE), bi = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/replay-index.ts');
  const MB = bi.ok ? await bundleIndex(bi.out) : null;
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  checkI(MB, '@BASE'); checkF(bp.ok ? bp.out : '', '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 18));
  pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上 I1／I2／F1／F2／F3 各自紅', ['I1@', 'I2@', 'F1@', 'F2@', 'F3@'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
}
console.log(`=== v6.650 回放時間軸記號＋手機詳情面板：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
