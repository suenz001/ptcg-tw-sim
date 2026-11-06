#!/usr/bin/env node
/**
 * v6.631 守衛：卡圖「卡住不載」的看門狗＋額度用完切回前景再試；iPad 圖示置中
 *
 * 站長 2026-11-07：
 *   「手機版常常會出現圖片未顯示的狀況，雖然點選查看詳情後，圖示就會重新讀取進來，但希望你看看有沒有別的方法可以改善」
 *   「我使用ipad 10.5的時候，會發生放大鏡圖示、明暗模式圖示、星星最愛圖示等等稍微位置偏移的現象」
 *   「不管你以後作任何改版，都不可以加重伺服器的負擔，導致玩家lag，這是最重要的」
 *
 * 【A】img-retry 行為端（假 DOM＋假 setTimeout；看門狗由 sweepStalledImages(now) 直接驅動）
 *   A1 縮圖載入中 15 秒沒回應也沒報錯 ⇒ 當成失敗、立刻改官方原圖；14.9 秒時不動
 *   A2 背景時間不計（切到背景 60 秒再回來，要重新等滿 15 秒）
 *   A3 loading="lazy" 的圖不看（不在畫面上本來就不會載）
 *   A4 本站自己的檔案（相對路徑、同網域絕對網址）不看 ⇒ 不會因此多打本站
 *   A5 載完／已完成／卸載 ⇒ 移出名單，不會亂換 src；全部移出後名單歸 0
 *   A6 原圖卡住 ⇒ 走原本退避（3 秒）改代理縮圖（不對官方 CDN 連發）
 *   A7 額度用完的圖：切回前景再給一輪；背景時不動
 *   A8 用完 4 次後看門狗不會無限換路徑
 *   A9 換卡（update）⇒ 新的一次載入重新起算
 * 【B】iPad 圖示置中（靜態，只在觸控分支／頂端列）
 * 【H】HEAD-FAIL：BASE 的 img-retry 沒有看門狗 ⇒ A1 紅；BASE 的 CSS 沒有置中 ⇒ B 紅
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '797f0435';   // 上一版（server v1.80，前端 v6.630）
const TMP = join(ROOT, '.x-v6631');
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 500) : '')); } };
const rd = (rel) => readFileSync(join(ROOT, rel), 'utf8');

async function loadMod(srcText, tag) {
  mkdirSync(join(TMP, tag, 'cards'), { recursive: true });
  writeFileSync(join(TMP, tag, 'img-retry.ts'), srcText);
  writeFileSync(join(TMP, tag, 'cards', 'thumb.ts'), rd('src/lib/cards/thumb.ts'));
  const out = join(TMP, tag, 'o.mjs');
  await build({ entryPoints: [join(TMP, tag, 'img-retry.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error' });
  return import(pathToFileURL(out).href + '?t=' + tag);
}

const CDN = 'https://asia.pokemon-card.com/tw/card-img/tw12345678.png';
function makeImg(src, extra = {}) {
  const listeners = new Map(), attrs = new Map();
  const { loading, ...rest } = extra;
  if (loading) attrs.set('loading', loading);
  return {
    srcHistory: [src], _src: src, currentSrc: '', complete: false, naturalWidth: 0, ...rest,
    get src() { return this._src; },
    set src(v) { this._src = v; this.srcHistory.push(v); this.complete = false; },
    addEventListener: (t, f) => { (listeners.get(t) ?? listeners.set(t, []).get(t)).push(f); },
    removeEventListener: (t, f) => { const a = listeners.get(t) ?? []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k) ?? null,
    hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k),
    _fire(t) { for (const f of [...(listeners.get(t) ?? [])]) f(); },
  };
}
let timers = [];
const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout, realNow = Date.now;
let clock = realNow();
function fakeEnv() {
  timers = [];
  clock += 10_000_000;   // 每個情境換一段全新的時間（模組層級的「最後一次有圖完成」不互相干擾）
  Date.now = () => clock;
  globalThis.setTimeout = (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id, dead: false }); return id; };
  globalThis.clearTimeout = (id) => { const t = timers[id - 1]; if (t) t.dead = true; };
  const winL = new Map(), docL = new Map();
  const mk = (m) => ({ addEventListener: (t, f) => { (m.get(t) ?? m.set(t, []).get(t)).push(f); }, removeEventListener() {}, _fire: (t) => { for (const f of [...(m.get(t) ?? [])]) f(); } });
  globalThis.window = mk(winL);
  globalThis.document = { visibilityState: 'visible', ...mk(docL) };
  globalThis.location = { origin: 'https://www.ptcg-tw-sim.com' };
}
const runPending = () => { for (const x of timers.filter((t) => !t.dead && !t.done)) { x.done = true; x.fn(); } };
const lastDelay = () => { const t = timers.filter((x) => !x.dead && !x.done); return t.length ? t[t.length - 1].ms : null; };
const isProxy = (u) => /^https:\/\/images\.weserv\.nl\//.test(u);
const isOfficial = (u) => u.startsWith(CDN);

/** 跑 A 組；回傳每一條的布林與細節（BASE 上缺函式時以 MISSING 誠實翻紅，不整支 throw — Rule 41） */
async function runA(M) {
  const R = {};
  const sweep = typeof M.sweepStalledImages === 'function' ? M.sweepStalledImages : null;
  const count = typeof M.stalledWatchCount === 'function' ? M.stalledWatchCount : () => -1;
  const active = typeof M.stallSweepActive === 'function' ? M.stallSweepActive : () => null;
  const { cardThumb } = await import(pathToFileURL(join(TMP, 'cur', 'thumbmod.mjs')).href);
  const TH = cardThumb(CDN);
  let T0 = 0;
  const at = (dt) => { clock = T0 + dt; };
  const S = (dt) => { at(dt); if (sweep) sweep(clock); };
  const fresh = () => { fakeEnv(); T0 = clock; };

  // A1 單張卡住（整頁沒有任何進度）⇒ 改走小的代理圖，不升級成官方原圖
  fresh();
  { const img = makeImg(TH); const h = M.retryImg(img, CDN);
    S(14900); const still = img.srcHistory.length === 1 && !img.hasAttribute('data-img-retrying');
    S(15100); runPending();
    const last = img.srcHistory.at(-1);
    R.A1 = { ok: !!sweep && still && img.hasAttribute('data-img-retrying') && isProxy(last) && !img.srcHistory.some(isOfficial), d: JSON.stringify({ still, hist: img.srcHistory }) };
    // A6 代理也卡住 ⇒ 交給一般失敗流程：退避後才換（不立刻連發）
    S(15100 + 15100); const d6 = lastDelay();
    R.A6 = { ok: !!sweep && d6 >= 3000 && img.srcHistory.length === 2, d: JSON.stringify({ d6, n: img.srcHistory.length }) };
    h.destroy(); S(99999); }
  // A1b（審查 P1）別張圖還在陸續完成 ⇒ 是慢不是卡，不介入
  fresh();
  { const a = makeImg(TH), b = makeImg(TH); const ha = M.retryImg(a, CDN), hb = M.retryImg(b, CDN);
    at(10000); b._fire('load'); b.complete = true; b.naturalWidth = 450;
    S(15100); const notYet = a.srcHistory.length === 1;
    S(25100); runPending(); const now = isProxy(a.srcHistory.at(-1));
    R.A1b = { ok: !!sweep && notYet && now, d: JSON.stringify({ notYet, hist: a.srcHistory }) };
    ha.destroy(); hb.destroy(); S(9e6); }
  // A1c 每一輪最多換 3 張
  fresh();
  { const imgs = Array.from({ length: 7 }, () => makeImg(TH)); const hs = imgs.map((x) => M.retryImg(x, CDN));
    S(15100); const n1 = imgs.filter((x) => x.srcHistory.length > 1).length;
    S(20100); const n2 = imgs.filter((x) => x.srcHistory.length > 1).length;
    R.A1c = { ok: !!sweep && n1 === 3 && n2 === 6, d: JSON.stringify({ n1, n2 }) };
    hs.forEach((h) => h.destroy()); S(9e6); }
  // A2 背景（背景期間有巡邏）
  fresh();
  { const img = makeImg(TH); const h = M.retryImg(img, CDN);
    globalThis.document.visibilityState = 'hidden'; S(60000);
    globalThis.document.visibilityState = 'visible'; S(61000); const a = img.srcHistory.length === 1;
    S(61000 + 14000); const b = img.srcHistory.length === 1;
    S(61000 + 15100); runPending(); const c = isProxy(img.srcHistory.at(-1));
    R.A2 = { ok: !!sweep && a && b && c, d: JSON.stringify({ a, b, c, hist: img.srcHistory }) };
    h.destroy(); S(9e6); }
  // A2b（審查 P2-1）iOS 背景凍結 JS：背景期間**完全沒有巡邏**，只有 visibilitychange 事件
  fresh();
  { const img = makeImg(TH); const h = M.retryImg(img, CDN);
    at(2000); globalThis.document.visibilityState = 'hidden'; globalThis.document._fire('visibilitychange');
    at(600000); globalThis.document.visibilityState = 'visible'; globalThis.document._fire('visibilitychange');
    S(600000); const a = img.srcHistory.length === 1;
    S(600000 + 15100); runPending(); const b = isProxy(img.srcHistory.at(-1));
    R.A2b = { ok: !!sweep && a && b, d: JSON.stringify({ a, b, hist: img.srcHistory }) };
    h.destroy(); S(9e6); }
  // A3／A4／A10 不監看的圖
  fresh();
  { const base = count();
    const lazy = makeImg(TH, { loading: 'lazy' }); const h1 = M.retryImg(lazy, CDN);
    const rel = makeImg('/covers/x.png'); const h2 = M.retryImg(rel, '/covers/x.png');
    const own = makeImg('https://www.ptcg-tw-sim.com/covers/y.png'); const h3 = M.retryImg(own, 'https://www.ptcg-tw-sim.com/covers/y.png');
    const zoom = makeImg(CDN); const h4 = M.retryImg(zoom, { url: CDN, width: 840 });
    const n = count();
    S(60000); runPending();
    R.A3 = { ok: !!sweep && lazy.srcHistory.length === 1, d: JSON.stringify({ lazy: lazy.srcHistory }) };
    R.A4 = { ok: !!sweep && rel.srcHistory.length === 1 && own.srcHistory.length === 1, d: JSON.stringify({ rel: rel.srcHistory, own: own.srcHistory }) };
    R.A10 = { ok: !!sweep && zoom.srcHistory.length === 1 && n === base, d: JSON.stringify({ base, n, zoom: zoom.srcHistory }) };
    h1.destroy(); h2.destroy(); h3.destroy(); h4.destroy(); }
  // A5 載完／已完成／卸載 ⇒ 移出名單；名單空了巡邏計時器停掉
  fresh();
  { const a = makeImg(TH), b = makeImg(TH), c = makeImg(TH);
    const ha = M.retryImg(a, CDN), hb = M.retryImg(b, CDN), hc = M.retryImg(c, CDN);
    const n3 = count(), on = active();
    a._fire('load'); b.complete = true; b.naturalWidth = 450; hc.destroy();
    S(20000); runPending();
    const none = [a, b, c].every((x) => x.srcHistory.length === 1);
    R.A5 = { ok: !!sweep && n3 >= 3 && on === true && none && count() === 0 && active() === false, d: JSON.stringify({ n3, on, after: count(), off: active(), none }) };
    ha.destroy(); hb.destroy(); }
  // A7／A8 額度用完
  fresh();
  { const img = makeImg(CDN); const h = M.retryImg(img, CDN);
    for (let i = 0; i < 6; i++) { img._fire('error'); runPending(); }
    const used = img.srcHistory.length;
    S(15100); S(30200); S(45300); runPending();
    const noLoop = img.srcHistory.length === used;
    globalThis.document.visibilityState = 'hidden'; globalThis.document._fire('visibilitychange'); runPending();
    const hiddenNo = img.srcHistory.length === used;
    globalThis.document.visibilityState = 'visible'; globalThis.document._fire('visibilitychange');
    const again = img.srcHistory.length === used + 1 && isOfficial(img.srcHistory.at(-1));
    // 再用完一次，馬上又切回前景 ⇒ 冷卻中不重給
    for (let i = 0; i < 6; i++) { img._fire('error'); runPending(); }
    const used2 = img.srcHistory.length;
    at(46000); globalThis.document._fire('visibilitychange');
    const cooled = img.srcHistory.length === used2;
    // 每隔 61 秒切一次前景：最多再給到 3 輪
    let grants = 1;
    for (let k = 1; k <= 6; k++) {
      for (let i = 0; i < 6; i++) { img._fire('error'); runPending(); }
      const before = img.srcHistory.length; at(46000 + 61000 * k); globalThis.document._fire('visibilitychange');
      if (img.srcHistory.length > before) grants++;
    }
    R.A7 = { ok: hiddenNo && again && cooled && grants === 3, d: JSON.stringify({ used, hiddenNo, again, cooled, grants }) };
    R.A8 = { ok: !!sweep && noLoop, d: JSON.stringify({ used, len: img.srcHistory.length }) };
    h.destroy(); S(9e6); }
  // A9（審查 P2-3）換卡：Svelte 5 先呼叫 action update、**之後**才寫新 src
  fresh();
  { const OTHER = 'https://asia.pokemon-card.com/tw/card-img/tw99999999.png';
    const img = makeImg(TH); const h = M.retryImg(img, CDN);
    img._fire('load'); img.complete = true; img.naturalWidth = 450;
    at(1000); h.update(OTHER); img.src = cardThumb(OTHER);
    await Promise.resolve(); await Promise.resolve();
    S(1000 + 15100); runPending();
    const last = img.srcHistory.at(-1);
    R.A9 = { ok: !!sweep && isProxy(last) && last.includes('tw99999999'), d: JSON.stringify(img.srcHistory) };
    h.destroy(); S(9e6); }
  // A11（審查 P3-1）外部圖載入中被換成本站網址 ⇒ 不再監看、不對本站重抓
  fresh();
  { const img = makeImg(TH); const h = M.retryImg(img, CDN);
    h.update('/covers/own.png'); img.src = '/covers/own.png';
    await Promise.resolve(); await Promise.resolve();
    S(60000); runPending();
    R.A11 = { ok: !!sweep && img.srcHistory.length === 2 && count() === 0, d: JSON.stringify({ hist: img.srcHistory, n: count() }) };
    h.destroy(); S(9e6); }
  globalThis.setTimeout = realST; globalThis.clearTimeout = realCT; Date.now = realNow;
  return R;
}

// 縮圖判準用正式那一份（Rule 38：不在守衛裡抄一份）
mkdirSync(join(TMP, 'cur'), { recursive: true });
await build({ entryPoints: [join(ROOT, 'src/lib/cards/thumb.ts')], outfile: join(TMP, 'cur', 'thumbmod.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error' });

console.log('【A】卡圖卡住看門狗');
const CUR = await loadMod(rd('src/lib/img-retry.ts'), 'cur');
const A = await runA(CUR);
const NAMES = {
  A1: '★★★ A1 縮圖 15 秒沒進度 ⇒ 改走小的代理圖，**不升級成官方原圖**（14.9 秒時不動）',
  A1b: '★★★ A1b 別張圖還在陸續完成（頻寬不足）⇒ 不介入，等整頁 15 秒沒進度才換',
  A1c: '★★ A1c 每一輪最多換 3 張（7 張卡住：第一輪 3、第二輪 6）',
  A2: '★★ A2 背景時間不計（背景期間有巡邏）',
  A2b: '★★★ A2b iOS 背景凍結 JS（背景期間沒有巡邏）⇒ 回前景第一輪不誤判，重新等滿 15 秒',
  A3: '★★ A3 loading="lazy"（屬性）的圖不換',
  A4: '★★★ A4 本站自己的檔案（相對路徑、同網域）不看 ⇒ 不會因此多打本站',
  A5: '★★ A5 載完／已完成／卸載 ⇒ 移出名單、不亂換 src；名單空了巡邏計時器停掉',
  A6: '★★ A6 代理圖也卡住 ⇒ 交給一般失敗流程（退避 ≥ 3 秒，不連發）',
  A7: '★★ A7 額度用完：切回前景再給一輪；背景時不動；60 秒冷卻；最多 3 輪',
  A8: '★★ A8 用完 4 次後看門狗不會無限換路徑',
  A9: '★★★ A9 換卡（update 先於新 src 寫入，與 Svelte 5 實際順序相同）⇒ 新卡照樣受監看',
  A10: '★★ A10 放大檢視的大圖（width 840）不監看',
  A11: '★★ A11 外部圖被換成本站網址 ⇒ 移出監看、不對本站重抓',
};
for (const k of Object.keys(NAMES)) ok(NAMES[k], A[k] && A[k].ok, A[k] && A[k].d);

console.log('【B】iPad 圖示置中');
function blockAfter(src, head) {
  const i = src.indexOf(head); if (i < 0) return null;
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return null;
}
function checkB(decks, tb) {
  const st = decks.slice(decks.lastIndexOf('<' + 'style'));
  const coarse = blockAfter(st, '@media (pointer: coarse) {');
  const icon = coarse && /\n\s*button\.icon \{([^}]*)\}/.exec(coarse);
  const fav = coarse && /\n\s*\.pv-fav-btn \{([^}]*)\}/.exec(coarse);
  const ctr = (b) => !!b && /display:\s*inline-flex/.test(b) && /align-items:\s*center/.test(b) && /justify-content:\s*center/.test(b);
  const tbst = tb.slice(tb.lastIndexOf('<' + 'style'));
  const theme = /\n\s*\.stb-theme \{([^}]*)\}/.exec(tbst);
  return {
    b1: !!coarse && coarse.length < 4000 && ctr(icon && icon[1]) && /padding:\s*0\b/.test(icon[1]),
    b2: ctr(fav && fav[1]),
    b3: ctr(theme && theme[1]) && /padding:\s*0\b/.test(theme[1]) && /width:\s*36px;\s*height:\s*36px/.test(theme[1]),
    // 桌機分支（觸控區塊之外）不得出現本版的置中規則：桌機 CSS 有逐字指紋守衛
    b4: !!coarse && !/button\.icon \{ display: inline-flex/.test(st.replace(coarse, '')),
  };
}
const B = checkB(rd('src/routes/decks/+page.svelte'), rd('src/lib/SiteTopBar.svelte'));
ok('★★ B1 牌組頁觸控分支：button.icon（🔍、☆、＋／−、✕）彈性置中、內距 0', B.b1);
ok('★ B2 卡片詳情的大星星（.pv-fav-btn）觸控分支彈性置中', B.b2);
ok('★★ B3 頂端列明暗切換鈕：36px 不變、彈性置中、內距 0', B.b3);
ok('★ B4 置中規則只在觸控分支（桌機 CSS 不變）', B.b4);

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const bsrc = readBaseBlob(ROOT, BASE_SHA, 'src/lib/img-retry.ts').out;
  const BM = await loadMod(bsrc, 'base');
  const HA = await runA(BM);
  const reds = Object.keys(NAMES).filter((k) => !(HA[k] && HA[k].ok));
  console.log('    BASE 上紅的：' + reds.join(', '));
  ok('★★★ H1 BASE 沒有看門狗 ⇒ A1、A1b、A2、A2b、A7、A9 必紅（A7＝額度用完切回前景不再試）', ['A1', 'A1b', 'A2', 'A2b', 'A7', 'A9'].every((k) => reds.includes(k)), reds.join(','));
  const HB = checkB(readBaseBlob(ROOT, BASE_SHA, 'src/routes/decks/+page.svelte').out, readBaseBlob(ROOT, BASE_SHA, 'src/lib/SiteTopBar.svelte').out);
  ok('★★ H2 BASE 的 CSS 沒有置中 ⇒ B1～B3 必紅', !HB.b1 && !HB.b2 && !HB.b3, JSON.stringify(HB));
}

console.log(`=== v6.631 卡圖卡住看門狗＋iPad 圖示置中：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
