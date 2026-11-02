#!/usr/bin/env node
/**
 * v6.619 守衛：錦標賽個人計時可縮小成氣泡；手機直式的提示不再推動遊玩畫面
 *
 * 站長 2026-11-02：
 *   「這個錦標賽個人計時用的小視窗，建議也能比照聊天氣泡，增加一個縮小成聊天氣泡大小的按鈕與功能，避免干擾玩家的遊玩版面」
 *   「縮小的氣泡可以改成，只顯示倒數計時的簡化數字時間版本」
 *   「手機版的越小越好，因為手機版的版面空間已經很拮据了」
 *   「我發顯手機版的，請派出寶可夢的通知，還是會下推遊戲介面，這個請你也一起修正，並做整體的audit，不要再有下推或變動玩家遊玩畫面的狀況，
 *     我建議直接覆蓋顯示在計時器那欄就好，或是根本不需要提示文字，因為本來就會跳出請玩家選擇的視窗」
 *
 * 【C】真元件（svelte/compiler 編譯 PlayerClockNotice.svelte＋esbuild 打包 $lib，Chromium 實跑）
 *   C1 預設展開；按「－」⇒ 變氣泡、記住（localStorage）；氣泡裡**只有數字**（14:32）；點氣泡 ⇒ 展開、記住
 *   C2 尺寸：手機（390）氣泡高 ≤ 26px、寬 ≤ 60px；網頁版（1280）54×54 圓（同聊天氣泡）
 *   C3 限時操作：氣泡只剩秒數（23）、剩 10 秒內有 urgent；等待對手時仍是數字
 *   C4 拖曳氣泡：位置改變、不會因為拖曳而展開、位置寫進 localStorage；重新掛載後沿用縮小狀態
 *   C5 手機氣泡的可點範圍 ≥ 40px（透明 ::before 擴大），看起來仍小
 * 【M】手機直式提示（MobilePortraitBattle.svelte）
 *   M1 靜態：派出提示在 .mp-timer-strip 裡（mp-strip-cover），取獎提示在 .mp-my-chips 裡（mp-strip-cover）；舊的獨立一列只剩「沒有計時器」的後備
 *   M2 幾何（產品 CSS＋與產品相同 class 的 markup）：提示出現時戰鬥列、手牌的 top 與沒有提示時完全相同（0px）
 *   M3 疊加提示在畫面內、蓋在計時器那一欄上（高度＝計時器高度）
 *   M1d 三個疊加提示都在定位容器的 </div> 之內（深度計數；審查 P2-1）
 *   H1 頁首 🤖／⏳送出中／⏳已排隊 標籤出現時「結束回合」與 ⚙ 不移動（審查 P2-2）
 * 【H】HEAD-FAIL：BASE（60dec41d）上 C1、M1a、M1b、M2、H1 紅
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { extractCss } from './lib/zoom-modal-fixture.mjs';
import { pwLaunch } from './lib/pw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '60dec41d';   // v6.618＋鐵律 Rule 91（本版的上一版）
const P_CLOCK = 'src/routes/game/PlayerClockNotice.svelte';
const P_MOB = 'src/routes/game/MobilePortraitBattle.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 900) : '')); } };
const rd = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const baseOf = (p) => { const b = readBaseBlob(ROOT, BASE_SHA, p); return b.ok ? b.out.replace(/\r\n/g, '\n') : null; };

// ── 把 PlayerClockNotice（現行或 BASE）打包成可掛載的 IIFE ──
async function clockBundle(src) {
  const js = compile(src, { generate: 'client', filename: 'PlayerClockNotice.svelte', css: 'injected', runes: true }).js.code;
  const out = await build({
    stdin: { contents: js + '\nimport { mount } from "svelte";\nwindow.__mountClock = (props) => mount(PlayerClockNotice, { target: document.querySelector("#app"), props });\n',
      resolveDir: join(ROOT, 'src/routes/game'), sourcefile: 'clock-probe.js', loader: 'js' },
    bundle: true, write: false, platform: 'browser', format: 'iife', conditions: ['browser'],
    alias: { '$lib': join(ROOT, 'src/lib') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}
// 測試用時計狀態：一般（剩 14:32）、等待、限時 23 秒、限時 7 秒
const clockState = (mode) => ({ epoch: 1, changedAt: 0, minutes: 25, gameStart: 1, at: 1_000_000, turnKey: 'x',
  actors: mode === 'wait' ? [1] : [0], spent: [mode === 'quick' || mode === 'urgent' ? 25 * 60000 : (25 * 60 - 872) * 1000, 0],
  quickLeft: [mode === 'urgent' ? 7000 : 23000, 30000], quick: [mode === 'quick' || mode === 'urgent', false], stalled: [false, false] });

async function clockChecks(browser, bundle) {
  const r = {};
  const open = async (vp, mode = 'normal', ls = {}) => {
    const ctx = await browser.newContext({ viewport: vp, ...(vp.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
    // ⚠ about:blank 沒有 localStorage ⇒ 用一個假網址（route 回應 fixture）讓頁面有自己的 origin
    await ctx.route('http://clock-probe.test/**', (rt) => rt.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--safe-top:0px;--safe-right:0px}body{margin:0;background:#234}</style><main id="app"></main>' }));
    const pg = await ctx.newPage();
    await pg.goto('http://clock-probe.test/');
    await pg.evaluate((ls) => { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, ls);
    await pg.addScriptTag({ content: bundle });
    await pg.evaluate(({ c }) => window.__mountClock({ clock: c, seat: 0, now: 1_000_000 }), { c: clockState(mode) });
    await pg.waitForTimeout(100);
    return { ctx, pg };
  };
  const st = (pg) => pg.evaluate(() => {
    const fab = document.querySelector('.clock-fab'), box = document.querySelector('.clock-notice');
    const b = fab?.getBoundingClientRect();
    return { fab: !!fab, box: !!box, text: fab ? fab.textContent.trim() : null, w: b?.width, h: b?.height, x: b?.left, y: b?.top,
      urgent: !!fab?.classList.contains('urgent'), ls: localStorage.getItem('ptcg_clock_min'), pos: localStorage.getItem('ptcg_clock_fab_pos') };
  });
  // C1／C2（手機）／C5
  { const { ctx, pg } = await open({ width: 390, height: 844 });
    const s0 = await st(pg);
    const hasMin = await pg.locator('.clock-notice .min-btn').count();
    if (hasMin) await pg.click('.clock-notice .min-btn');
    const s1 = await st(pg);
    // 可點範圍：氣泡外 8px 的點仍落在氣泡上
    const hit = s1.fab ? await pg.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return !!e && !!e.closest('.clock-fab'); }, { x: s1.x - 8, y: s1.y + s1.h / 2 }) : false;
    if (s1.fab) await pg.click('.clock-fab');
    const s2 = await st(pg);
    r.C1 = s0.box && !s0.fab && hasMin === 1 && s1.fab && !s1.box && s1.ls === '1' && s1.text === '14:32' && s2.box && !s2.fab && s2.ls === '0';
    r.C1n = JSON.stringify({ s0, s1, s2, hasMin });
    r.C2m = s1.fab && s1.h <= 26 && s1.w <= 60; r.C2mn = JSON.stringify(s1);
    r.C5 = hit; await ctx.close(); }
  // C2（網頁版）
  { const { ctx, pg } = await open({ width: 1280, height: 800 }, 'normal', { ptcg_clock_min: '1' });
    const s = await st(pg); r.C2d = s.fab && Math.abs(s.w - 54) < 0.6 && Math.abs(s.h - 54) < 0.6 && s.text === '14:32'; r.C2dn = JSON.stringify(s); await ctx.close(); }
  // C3
  { const res = {};
    for (const m of ['quick', 'urgent', 'wait']) { const { ctx, pg } = await open({ width: 390, height: 844 }, m, { ptcg_clock_min: '1' }); res[m] = await st(pg); await ctx.close(); }
    r.C3 = res.quick.text === '23' && !res.quick.urgent && res.urgent.text === '7' && res.urgent.urgent && res.wait.text === '14:32';
    r.C3n = JSON.stringify(res); }
  // C4 拖曳（滑鼠，網頁版）＋重新掛載沿用縮小
  { const { ctx, pg } = await open({ width: 1280, height: 800 }, 'normal', { ptcg_clock_min: '1' });
    const a = await st(pg);
    if (!a.fab) { r.C4 = false; r.C4n = '沒有氣泡'; await ctx.close(); return r; }   // BASE 沒有氣泡：這一條紅、前面的結果照常回報（Rule 41）
    await pg.mouse.move(a.x + a.w / 2, a.y + a.h / 2); await pg.mouse.down();
    await pg.mouse.move(a.x + a.w / 2 - 150, a.y + a.h / 2 + 120, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(150);
    const b = await st(pg);
    let pos = null; try { pos = JSON.parse(b.pos); } catch { /* */ }
    r.C4 = b.fab && !b.box && Math.abs(b.x - (a.x - 150)) < 2 && Math.abs(b.y - (a.y + 120)) < 2 && !!pos && Math.abs(pos.x + 150) < 2 && Math.abs(pos.y - 120) < 2;
    r.C4n = JSON.stringify({ a, b }); await ctx.close(); }
  return r;
}

// ── M：手機直式提示 ──
// 從 open（例 '<div class="mp-timer-strip">'）開始，用 <div …> ／ </div> 深度計數找到配對的 </div>，回傳容器內部（審查 P2-1：
//   只截「到下一個錨點」的話，提示被搬到容器的 </div> 之後仍會綠，而那時它是 .mp 的直接子元素 ⇒ inset:0 蓋滿整個畫面）
function innerOf(s, open) {
  const i = s.indexOf(open);
  if (i < 0) return null;
  const re = /<div\b|<\/div>/g; re.lastIndex = i + open.length;
  let depth = 1, m;
  while ((m = re.exec(s))) { depth += m[0] === '</div>' ? -1 : 1; if (depth === 0) return s.slice(i + open.length, m.index); }
  return null;
}
function mobileStatic(src) {
  const s = stripCommentsBlankChecked(src);
  const strip = innerOf(s, '<div class="mp-timer-strip">') ?? '';
  const chips = innerOf(s, '<div class="mp-chips mp-my-chips">') ?? '';
  const overlays = (s.match(/mp-strip-cover"/g) || []).length;   // 出現在 markup 的疊加提示總數
  const inside = (strip.match(/mp-strip-cover"/g) || []).length + (chips.match(/mp-strip-cover"/g) || []).length;
  return {
    M1a: /needSendActiveMine\}\s*<div class="mp-wait-alert mp-wait-warn mp-strip-cover"/.test(strip) && /needSendActiveOpp && isMyTurn\}\s*<div class="mp-wait-alert mp-strip-cover"/.test(strip),
    M1b: /<div class="mp-prize-alert mp-strip-cover"/.test(chips) && (s.match(/class="mp-prize-alert/g) || []).length === 1,
    M1c: /\.mp-timer-strip \{ position: relative; \}/.test(s) && /\.mp-strip-cover\.mp-strip-cover \{[^}]*position: absolute; inset: 0;/.test(s),
    M1d: overlays === 3 && inside === 3,   // 每一個疊加提示都在定位容器裡面
  };
}
// 與產品同 class 的 markup：overlay=true 時提示放在產品現在放的位置；false 時放在 BASE 的位置（獨立一列）
function mobileMarkup(overlay, alert, prize) {
  const bench = '<div class="mp-row">' + '<div class="mp-slot mp-empty"></div>'.repeat(5) + '</div>';
  const active = '<div class="mp-active-row"><button class="mp-active"><div class="mp-active-card-back"></div><div class="mp-active-info"><div class="mp-active-name">測試寶可夢ex</div><div class="mp-hp">HP 300/300</div></div></button></div>';
  const strip = '<span class="mp-t-cell mp-t-total">⏱ 12:03</span><span class="mp-t-cell">P1 6:01</span><span class="mp-t-sep">|</span><span class="mp-t-cell">P2 6:02</span><span class="mp-t-cell mp-t-turn">▶ 0:42</span>';
  const al = overlay ? '<div class="mp-wait-alert mp-wait-warn mp-strip-cover">⚠️ 請從備戰區派出新的戰鬥寶可夢</div>' : '<div class="mp-wait-alert mp-wait-warn">⚠️ 請從備戰區派出新的戰鬥寶可夢（下方視窗選擇）</div>';
  const pz = overlay ? '<div class="mp-prize-alert mp-strip-cover">🏆 取 1 張獎賞卡 <button class="mp-prize-btn">取得</button></div>' : '<div class="mp-prize-alert">🏆 取 1 張獎賞卡 <button class="mp-prize-btn">取得</button></div>';
  const top = `<header class="mp-top">回合 5<button class="mp-end-btn">結束回合</button></header><div class="mp-timer-strip">${strip}${overlay && alert ? al : ''}</div>${!overlay && alert ? al : ''}`;
  const myChips = `<div class="mp-chips mp-my-chips"><span class="mp-chip">🎁 5</span><span class="mp-chip">📚 38</span>${overlay && prize ? pz : ''}</div>${!overlay && prize ? pz : ''}`;
  return `<div class="battle-root"><div class="mp">${top}${bench}<div class="mp-chips"><span class="mp-chip">🎁 6</span></div>${active}<section class="mp-log">${'<div>紀錄</div>'.repeat(12)}</section>${active}${myChips}${bench}<footer class="mp-hand">${'<button class="mp-hand-card"></button>'.repeat(6)}</footer></div></div>`;
}
async function mobileGeo(browser, src, overlay) {
  const css = extractCss(rd('src/routes/+layout.svelte')) + extractCss(src);
  const res = {};
  for (const [w, h] of [[390, 844], [320, 568]]) {
    const pos = {};
    for (const [tag, a, p] of [['none', false, false], ['alert', true, false], ['prize', false, true], ['both', true, true]]) {
      const pg = await browser.newPage({ viewport: { width: w, height: h } });
      await pg.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--safe-top:0px;--safe-bottom:0px}</style>${mobileMarkup(overlay, a, p)}`);
      pos[tag] = await pg.evaluate(() => {
        const t = (e) => Math.round(e.getBoundingClientRect().top * 10) / 10;
        const al = document.querySelector('.mp-wait-alert'), sp = document.querySelector('.mp-timer-strip');
        return { rows: [...document.querySelectorAll('.mp-active-row, .mp-row, .mp-hand')].map(t),
          alert: al ? (() => { const a = al.getBoundingClientRect(), s = sp.getBoundingClientRect(); return { top: a.top, h: a.height, sTop: s.top + sp.clientTop, sH: sp.clientHeight, right: a.right, vw: innerWidth }; /* 量內距框（計時器那一欄有 1px 底線） */ })() : null };
      });
      await pg.close();
    }
    res[`${w}x${h}`] = pos;
  }
  const same = Object.values(res).every((p) => ['alert', 'prize', 'both'].every((k) => JSON.stringify(p[k].rows) === JSON.stringify(p.none.rows)));
  const cover = Object.values(res).every((p) => { const a = p.alert.alert; return !!a && Math.abs(a.top - a.sTop) < 0.6 && Math.abs(a.h - a.sH) < 0.6 && a.right <= a.vw + 0.5; });
  return { same, cover, detail: JSON.stringify(res) };
}

// 頁首：🤖／⏳送出中／⏳已排隊 標籤一閃一閃時，「結束回合」與 ⚙ 的位置不可以變（審查 P2-2）
async function headerGeo(browser, src) {
  const css = extractCss(rd('src/routes/+layout.svelte')) + extractCss(src);
  const head = (tags) => `<div class="battle-root"><div class="mp"><header class="mp-top"><button class="mp-icon-btn">←</button><button class="mp-icon-btn mp-undo-btn">↶</button><span class="mp-turn-text">回合 12</span><span class="mp-phase">🟢 你的回合 🔄</span><span class="mp-spacer"></span>${tags ? '<span class="mp-tag">🤖</span><span class="mp-tag">⏳</span><span class="mp-tag">⏳送出中</span><span class="mp-tag">⏳已排隊 2</span>' : ''}<button class="mp-end-btn">⏭ 結束回合</button><button class="mp-icon-btn">⚙</button></header></div></div>`;
  const res = {};
  for (const w of [320, 375, 390]) {
    const r = {};
    for (const t of [false, true]) {
      const pg = await browser.newPage({ viewport: { width: w, height: 700 } });
      await pg.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>${head(t)}`);
      r[t ? 'tags' : 'none'] = await pg.evaluate(() => { const q = (s) => { const b = document.querySelectorAll(s); const e = b[b.length - 1].getBoundingClientRect(); return [Math.round(e.left), Math.round(e.top), Math.round(e.width), Math.round(e.height)]; };
        return { end: q('.mp-end-btn'), gear: q('.mp-icon-btn'), hdr: document.querySelector('.mp-top').getBoundingClientRect().height, vw: innerWidth }; });
      await pg.close();
    }
    res[w] = r;
  }
  const same = Object.values(res).every((r) => JSON.stringify(r.none.end) === JSON.stringify(r.tags.end) && JSON.stringify(r.none.gear) === JSON.stringify(r.tags.gear)
    && r.tags.gear[0] + r.tags.gear[2] <= r.tags.vw + 0.5 && r.tags.end[3] === r.none.end[3]);
  return { same, detail: JSON.stringify(res) };
}

// ── 執行 ──
console.log('【M】手機直式提示（靜態）');
const MS = mobileStatic(rd(P_MOB));
ok('★★★ M1a 派出／等待派出提示放在計時器那一欄裡（疊加）', MS.M1a);
ok('★★★ M1b 取獎提示放在我方 chips 列裡（疊加），只有這一處', MS.M1b);
ok('★★ M1c 計時器那一欄是定位容器、疊加提示絕對定位不佔高度', MS.M1c);
ok('★★★ M1d 三個疊加提示都在定位容器（計時器欄／我方 chips）的 </div> 之內', MS.M1d);
{ // 正對照：把派出提示搬到計時器欄的 </div> 之後 ⇒ M1a／M1d 必須紅
  const cur = rd(P_MOB);
  const i0 = cur.indexOf('<div class="mp-timer-strip">');
  const a0 = cur.indexOf('      {#if needSendActiveMine}\n        <div class="mp-wait-alert', i0);
  const a1 = cur.indexOf('      {/if}\n    </div>\n', a0);
  const mv = (i0 < 0 || a0 < 0 || a1 < 0) ? cur
    : cur.slice(0, a0) + '    </div>\n' + cur.slice(a0, a1 + '      {/if}\n'.length) + cur.slice(a1 + '      {/if}\n    </div>\n'.length);
  const bad = mobileStatic(mv);
  ok('★ M1 正對照：提示被搬到容器外必須紅', mv !== cur && bad.M1a === false && bad.M1d === false);
}

const browser = await pwLaunch('v6.619 計時氣泡／手機疊加提示', { headless: true });
let baseBundleErr = null;
if (!browser) shallowSkip('C／M2／M3（沒有可用的 Chromium）');
else {
  try {
    console.log('【C】個人計時氣泡（真元件）');
    const C = await clockChecks(browser, await clockBundle(rd(P_CLOCK)));
    ok('★★★ C1 預設展開；「－」縮成只有數字的氣泡（14:32）並記住；點氣泡展開並記住', C.C1, C.C1n);
    ok('★★★ C2 手機氣泡很小（高 ≤26、寬 ≤60）', C.C2m, C.C2mn);
    ok('★★ C2 網頁版氣泡 54×54（同聊天氣泡）', C.C2d, C.C2dn);
    ok('★★ C3 限時操作只剩秒數、10 秒內 urgent；等待對手仍顯示數字', C.C3, C.C3n);
    ok('★★ C4 拖曳氣泡：位置跟手、不會展開、位置寫進 localStorage', C.C4, C.C4n);
    ok('★ C5 手機氣泡外 8px 仍點得到（擴大可點範圍）', C.C5);
    console.log('【M】手機直式提示（幾何）');
    const G = await mobileGeo(browser, rd(P_MOB), true);
    ok('★★★ M2 提示出現時戰鬥列、備戰列、手牌位置完全不變（390×844、320×568）', G.same, G.detail);
    ok('★★ M3 派出提示剛好蓋住計時器那一欄、在畫面內', G.cover, G.detail);
    const H = await headerGeo(browser, rd(P_MOB));
    ok('★★★ H1 頁首標籤出現時「結束回合」與 ⚙ 位置、高度不變、不超出畫面（320／375／390）', H.same, H.detail);
    // 正對照：同一份判準套在「提示獨立一列」（BASE 的位置）必須紅
    const Gbad = await mobileGeo(browser, rd(P_MOB), false);
    ok('★ M2 正對照：提示放回獨立一列 ⇒ 位置必須改變', Gbad.same === false);

    console.log('【H】HEAD-FAIL');
    if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
    else {
      const bMob = baseOf(P_MOB), bClock = baseOf(P_CLOCK);
      const bM = mobileStatic(bMob);
      let bC1 = false;
      try { bC1 = (await clockChecks(browser, await clockBundle(bClock))).C1; } catch (e) { baseBundleErr = e.message; }   // Rule 41：不整支 throw
      // BASE 的 CSS 沒有疊加規則 ⇒ 把提示放在現行位置也會撐開版面
      const bG = await mobileGeo(browser, bMob, true);
      const bH = await headerGeo(browser, bMob);
      const reds = { C1: baseBundleErr === null && !bC1, M1a: !bM.M1a, M1b: !bM.M1b, M2: !bG.same, H1: !bH.same };   // 審查 P3-14：打包失敗不算紅
      ok('★★★ HEAD-FAIL：BASE 上 C1、M1a、M1b、M2、H1 全紅', Object.values(reds).every(Boolean), JSON.stringify({ reds, baseBundleErr }));
    }
  } finally { await browser.close(); }
}

console.log(`\n=== v6.619 計時氣泡／手機疊加提示：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
