#!/usr/bin/env node
/**
 * v6.557 守衛（站長回報：電腦版手牌很多時整排擠在中間互疊，兩旁還有空間）：
 *   桌機手牌互疊量改由 src/lib/game/hand-layout.ts 依「手牌列可用寬度／單張卡寬／扇形外擴」計算。
 *   A 段：判準的行為（放得下不疊、放不下剛好塞滿、最緊仍露出 18px、量不到退回舊公式、扇形外擴幾何）。
 *   B 段：對戰頁接線（style 只讀判準、量測 action 用假 DOM 實際執行、扇形公式只有一份）。
 *   E 段：真瀏覽器（Chromium）——把對戰頁的手牌 CSS 與 handFit 本體原樣搬進測試頁，
 *         量旋轉後每張卡是否超出手牌列（審查 P1：扇形兩端被切）、是否攤開、縮放／張數／卡寬變動是否重量。
 * 【H】BASE（v6.556）：A／B 紅、A0（舊公式正對照）綠。
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build, transform } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.556。
const BASE_SHA = '277a20b9';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

async function load(srcRoot) {
  const lib = join(srcRoot, 'src/lib/game/hand-layout.ts');
  if (!existsSync(lib)) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6557-'));
  const E = join(tmp, 'e.ts'), O = join(tmp, 'o.mjs'), I = join(tmp, 'i.js');
  writeFileSync(E, `export * from '${lib.replace(/\\/g, '/')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent' });
    await build({ entryPoints: [E], outfile: I, bundle: true, format: 'iife', globalName: 'HL', platform: 'browser', target: 'es2020', logLevel: 'silent' });
    const M = await import(pathToFileURL(O).href);
    return { ...M, __iife: readFileSync(I, 'utf8') };
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

/** 對戰頁 v6557-hand-fit 哨兵區塊 → 去型別的 JS（宣告 handAvailW／handCardW／handFit）。 */
async function handFitJs(src) {
  const a = src.indexOf('// >>> v6557-hand-fit'), b = src.indexOf('// <<< v6557-hand-fit');
  if (a < 0 || b < a) return null;
  const ts = src.slice(a, b).replace(/\$state\(0\)/g, '0');
  return (await transform(ts, { loader: 'ts' })).code;
}

// 假 DOM：手牌列 + 卡片的 computed style
function fakeEnv({ rot = 0, lift = 0 } = {}) {
  const card = { _cs: { boxSizing: 'content-box', width: '92px', height: '130px', paddingLeft: '4px', paddingRight: '4px', paddingTop: '4px', paddingBottom: '4px',
    borderLeftWidth: '1.5px', borderRightWidth: '1.5px', borderTopWidth: '1.5px', borderBottomWidth: '1.5px', transformOrigin: '51.5px 250.2px',
    getPropertyValue: (k) => (k === '--fan-rot' ? rot + 'deg' : k === '--fan-lift' ? lift + 'px' : '') } };
  const node = { clientWidth: 1932, _cs: { paddingLeft: '16px', paddingRight: '16px' },
    querySelectorAll: (q) => (q === ':scope > .hand-card' ? [card, card] : []) };
  const gcs = (el) => el._cs;
  return { node, gcs };
}
function runFake(js, M, opt) {
  const { node, gcs } = fakeEnv(opt);
  // eslint-disable-next-line no-new-func
  const fn = new Function('getComputedStyle', 'ResizeObserver', 'borderBoxSize', 'fanOvershootPx', 'handOverlapPx', 'handFanPose',
    `${js}\nconst r = handFit(arguments[6], 19); return { avail: handAvailW, card: handCardW, r };`);
  try { return fn(gcs, undefined, M.borderBoxSize, M.fanOvershootPx, M.handOverlapPx, M.handFanPose, node); } catch (e) { return { err: e.message }; }
}

async function scenarios(M, srcRoot) {
  const r = {};
  const F = M?.handOverlapPx, L = M?.legacyHandOverlapPx;
  const legacy = (n) => (n <= 9 ? 0 : Math.min(58, (n - 9) * 7));
  r.A0 = legacy(19) === 58 && legacy(9) === 0 && legacy(12) === 21;   // 正對照：舊公式本身
  r.A1 = !!F && F(19, 80, 1900) === 0 && F(10, 92, 920) === 0;
  r.A2 = !!F && (() => { const o = F(19, 80, 1200); return o === Math.ceil((19 * 80 - 1200) / 18) && 80 + 18 * (80 - o) <= 1200; })();
  r.A3 = !!F && F(40, 80, 300) === 80 - M.HAND_MIN_VISIBLE_PX && M.HAND_MIN_VISIBLE_PX === 18;
  r.A4 = !!F && !!L && [5, 9, 10, 12, 19, 30].every((n) => F(n, 0, 0) === legacy(n) && F(n, 80, 0) === legacy(n) && L(n) === legacy(n));
  r.A5 = !!F && F(1, 80, 10) === 0 && F(0, 80, 10) === 0;
  r.A6 = !!F && F(19, 80, 1900) === 0 && legacy(19) === 58;
  // A7：扇形公式（與舊 markup 逐值相同）
  const oldPose = (i, n) => { const mid = (n - 1) / 2, step = Math.min(4, 36 / Math.max(1, n)); return { rot: n > 1 ? (i - mid) * step : 0, lift: Math.abs(i - mid) * (step * 0.6) }; };
  r.A7 = !!M?.handFanPose && [1, 2, 7, 9, 19, 40].every((n) => Array.from({ length: n }, (_, i) => i).every((i) => {
    const a = M.handFanPose(i, n), b = oldPose(i, n); return Math.abs(a.rot - b.rot) < 1e-9 && Math.abs(a.lift - b.lift) < 1e-9; }));
  // A8：扇形外擴幾何（0° 為 0；左轉往左甩、右轉往右甩、左右對稱；轉越多甩越多）
  const G = M?.fanOvershootPx;
  r.A8 = !!G && (() => {
    const base = { w: 103, h: 139, liftPx: 0, originX: 51.5, originY: 250.2 };
    const z = G({ ...base, rotDeg: 0 }), l = G({ ...base, rotDeg: -18 }), rr = G({ ...base, rotDeg: 18 }), s = G({ ...base, rotDeg: -9 });
    return z.left === 0 && z.right === 0 && l.left > 40 && l.right === 0 && rr.right > 40 && rr.left === 0
      && Math.abs(l.left - rr.right) < 1e-6 && s.left < l.left && s.left > 0;
  })();
  // A10：與獨立實作的幾何（CSS 先 translateY 再以原點旋轉）逐值比對，含 hover 上推 14px 的姿勢
  r.A10 = !!G && (() => {
    const oracle = (w, h, deg, lift, ox, oy) => {
      const t = deg * Math.PI / 180; let lo = 0, hi = w;
      for (const L of [lift, lift - 14]) for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
        const X = ox + Math.cos(t) * (px - ox) - Math.sin(t) * (py - oy + L); lo = Math.min(lo, X); hi = Math.max(hi, X); }
      return { left: Math.max(0, -lo), right: Math.max(0, hi - w) };
    };
    return [[-18, 10.8], [18, 10.8], [-6, 3.6], [12, 0], [-17, -5]].every(([deg, lift]) => {
      const a = G({ w: 103, h: 141, rotDeg: deg, liftPx: lift, originX: 51.5, originY: 253.8 }), b = oracle(103, 141, deg, lift, 51.5, 253.8);
      return Math.abs(a.left - b.left) < 1e-9 && Math.abs(a.right - b.right) < 1e-9;
    });
  })();
  r.A9 = !!M?.borderBoxSize && (() => {
    const cs = { boxSizing: 'content-box', width: '92px', height: '130px', paddingLeft: '4px', paddingRight: '4px', paddingTop: '4px', paddingBottom: '4px', borderLeftWidth: '1.5px', borderRightWidth: '1.5px', borderTopWidth: '1.5px', borderBottomWidth: '1.5px' };
    const a = M.borderBoxSize(cs), b = M.borderBoxSize({ ...cs, boxSizing: 'border-box', width: '106.3px', height: '150px' });
    return a.w === 103 && a.h === 141 && b.w === 106.3 && b.h === 150;   // 小數保留（審查 P3）
  })();

  // B：頁面接線
  const src = readFileSync(join(srcRoot, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf('<div class="hand-scroll"');
  const tag = i >= 0 ? src.slice(i, src.indexOf('>', src.indexOf('style=', i)) + 1) : '';
  r.B1 = /style="--hand-overlap:\{handOverlapPx\(dedupeByIid\(myPlayer\?\.hand\)\.length, handCardW, handAvailW\)\}px;"/.test(tag);
  r.B2 = /use:handFit=\{dedupeByIid\(myPlayer\?\.hand\)\.length\}/.test(tag);
  r.B3 = !/Math\.min\(58,/.test(src) && !/\{@const step=Math\.min\(4, 36/.test(src);   // 舊公式／扇形公式不再就地寫
  r.B6 = /\{@const pose=handFanPose\(i, n\)\}/.test(src);
  const js = await handFitJs(src);
  if (js && M) {
    const flat = runFake(js, M, { rot: 0 });
    const fan = runFake(js, M, { rot: -18, lift: 10.8 });
    r.B4 = flat.avail === 1900 && flat.card === 103 && typeof flat.r?.destroy === 'function';
    r.B5 = fan.avail > 0 && fan.avail < 1900 - 80 && fan.card === 103;   // 扇形時兩邊預留外擴
    r.B4n = JSON.stringify({ flat, fan });
  } else { r.B4 = false; r.B5 = false; r.B4n = 'handFit 區塊不存在'; }
  r.B7 = /import \{ handOverlapPx, handFanPose, fanOvershootPx, borderBoxSize \} from '\$lib\/game\/hand-layout';/.test(src);
  r.js = js; r.src = src;
  return r;
}

function judge(r, label) {
  console.log(`\n── ${label} ──`);
  ok('A0 正對照：舊公式（9 張以上每張 7px、最多 58px）', r.A0);
  ok('A1 放得下（含剛好等於）就不疊', r.A1);
  ok('A2 放不下時疊「剛好塞滿」的量，且不超出可用寬度', r.A2);
  ok('A3 疊到最緊時每張至少露出 18px', r.A3);
  ok('A4 量不到寬度時退回舊公式（逐張數等價）', r.A4);
  ok('A5 0／1 張不疊', r.A5);
  ok('A6 站長截圖情境：寬螢幕 19 張不疊（舊公式疊 58px）', r.A6);
  ok('A7 扇形角度／下沉與舊 markup 逐值相同（搬家不改外觀）', r.A7);
  ok('A8 扇形外擴幾何：0° 為 0、左右對稱、轉越多甩越多', r.A8);
  ok('A9 卡寬用 border-box 且保留小數', r.A9);
  ok('A10 扇形外擴與獨立幾何逐值相同（含 hover 上推姿勢）', r.A10);
  ok('B1 手牌列 --hand-overlap 只讀 handOverlapPx（量到的寬度、與畫面同源的張數）', r.B1);
  ok('B2 手牌列掛量測 action（張數變化時重量）', r.B2);
  ok('B3 頁面不再就地寫互疊公式與扇形公式', r.B3);
  ok('B4 量測 action 實際執行（無扇形）：可用寬扣左右 padding、卡寬含 padding／邊框、回傳 destroy', r.B4, r.B4n);
  ok('B5 量測 action 實際執行（扇形 18°）：兩邊預留旋轉外擴', r.B5, r.B4n);
  ok('B6 markup 的扇形姿勢讀 handFanPose', r.B6);
  ok('B7 頁面 import 中央判準', r.B7);
}

const NEW = await scenarios(await load(ROOT), ROOT);
judge(NEW, 'NEW（本版）');

// ════════════════════════════════════════════════════════════════════════════
// E：真瀏覽器。手牌 CSS 從對戰頁原樣抽出（不在測試裡抄一份），handFit 也是頁面原文。
console.log('\n【E】真瀏覽器：手牌列實際排版（扇形／藍桌墊無扇形）');
function handCss(src) {
  const pick = (re) => { const m = src.match(re); return m ? m[0] : ''; };
  const scroll = pick(/\n  \.hand-scroll\{ display:flex;[^\n]*\}/);
  const overlap = pick(/\n  \.hand-scroll > \.hand-card \+ \.hand-card\{[^\n]*\}/);
  const card = pick(/\n  \.hand-card\{ flex-shrink:0;[\s\S]*?\}/);
  return { css: [scroll, overlap, card].join('\n'), ok: !!(scroll && overlap && card) };
}
const chromium = pwChromium('v6.557 手牌互疊');
if (chromium && NEW.js) {
  const browser = await pwLaunchWith(chromium, 'v6.557 手牌互疊');
  if (browser) {
    try {
      const { css, ok: cssOk } = handCss(NEW.src);
      ok('[E 前提] 從對戰頁抽到手牌三條 CSS 規則', cssOk);
      const M = await load(ROOT);
      const pg = await (await browser.newContext({ viewport: { width: 2000, height: 600 } })).newPage();
      await pg.setContent(`<!doctype html><html><head><style>body{margin:0}${css}\n.blue .hand-card{--fan-rot:0deg !important;--fan-lift:0px !important;}</style></head><body><div id="wrap"></div></body></html>`);
      await pg.addScriptTag({ content: M.__iife });
      const runCase = (args) => pg.evaluate(async ({ js, n, width, blue, zeroFan, frac }) => {
        const code = zeroFan ? js.replace(/fanPad = Math\.max\(fanPad, o\.left, o\.right\);/, 'fanPad = 0;') : js;
        const { handOverlapPx, handFanPose, fanOvershootPx, borderBoxSize } = window.HL;
        // eslint-disable-next-line no-new-func
        const make = new Function('handOverlapPx', 'handFanPose', 'fanOvershootPx', 'borderBoxSize',
          `${code}\nreturn { handFit, get avail() { return handAvailW; }, get card() { return handCardW; } };`);
        const api = make(handOverlapPx, handFanPose, fanOvershootPx, borderBoxSize);
        const wrap = document.getElementById('wrap'); wrap.innerHTML = '';
        wrap.className = blue ? 'blue' : '';
        const sc = document.createElement('div'); sc.className = 'hand-scroll'; sc.style.width = width + 'px'; sc.style.boxSizing = 'border-box';
        wrap.appendChild(sc);
        const addCards = (k) => { for (let j = 0; j < k; j++) { const c = document.createElement('div'); c.className = 'hand-card'; c.innerHTML = '<div style="height:120px;width:100%"></div>'; sc.appendChild(c); } };
        const pose = () => { const cs = [...sc.children]; cs.forEach((c, i) => { const p = handFanPose(i, cs.length); c.style.setProperty('--fan-rot', p.rot + 'deg'); c.style.setProperty('--fan-lift', p.lift + 'px'); }); };
        const apply = () => sc.style.setProperty('--hand-overlap', handOverlapPx(sc.children.length, api.card, api.avail) + 'px');
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        addCards(n); pose();
        if (frac) for (const c of sc.children) c.style.width = frac + 'px';   // 卡寬帶小數（審查 P3：頁面若把卡寬取整，張數多時誤差累積）
        const act = api.handFit(sc, n); await frame(); apply(); await frame();
        const measure = () => {
          const s = getComputedStyle(sc), R = sc.getBoundingClientRect();
          const L = R.left + parseFloat(s.paddingLeft), Rr = R.right - parseFloat(s.paddingRight);
          let out = 0, minL = Infinity, maxR = -Infinity;
          for (const c of sc.children) { const b = c.getBoundingClientRect(); minL = Math.min(minL, b.left); maxR = Math.max(maxR, b.right); out = Math.max(out, L - b.left, b.right - Rr); }
          // 物理上放得下嗎：每張露出最少 18px 時整排寬＋扇形兩端外擴 ≤ 手牌列（放不下的情況只能被切，不列入 E1）
          const n2 = sc.children.length, feasible = api.card + (n2 - 1) * 18 <= api.avail + 0.5;
          return { out: +out.toFixed(1), span: +(maxR - minL).toFixed(1), content: +(Rr - L).toFixed(1), overlap: parseFloat(sc.style.getPropertyValue('--hand-overlap')), feasible };
        };
        const m1 = measure();
        // 縮放：手牌列變窄 ⇒ ResizeObserver 重量
        sc.style.width = Math.round(width * 0.6) + 'px'; await frame(); await frame(); apply(); await frame();
        const m2 = measure();
        // 張數變動：多 10 張 ⇒ update() 重量
        const availBefore = api.avail;
        addCards(10); pose(); act.update(n + 10); await frame(); apply(); await frame();
        const m3 = measure(); const availAfter = api.avail;
        // 只改卡寬（手牌列寬不變）⇒ 觀察卡片的 ResizeObserver 重量
        const before = api.card;
        for (const c of sc.children) c.style.width = '70px';
        await frame(); await frame(); const after = api.card;
        act.destroy();
        return { m1, m2, m3, cardBefore: before, cardAfter: after, availBefore, availAfter };
      }, args);
      const res = [];
      for (const blue of [false, true]) for (const width of [1888, 1300]) for (const n of [3, 9, 12, 19, 25, 40]) {
        res.push({ blue, width, n, ...(await runCase({ js: NEW.js, n, width, blue, zeroFan: false })) });
      }
      const over = res.flatMap((x) => ['m1', 'm2', 'm3'].filter((k) => x[k].feasible && x[k].out > 0.5).map((k) => `${x.blue ? '藍' : '扇'} ${x.width} ${x.n}張 ${k} 超出 ${x[k].out}px`));
      const nFeasible = res.reduce((s, x) => s + ['m1', 'm2', 'm3'].filter((k) => x[k].feasible).length, 0);
      ok('★★★[E1] 扇形與藍桌墊、兩種寬度、9～40 張（含縮放與加牌後）：放得下的情況沒有任何一張卡超出手牌列', over.length === 0 && nFeasible >= 40, `可行情況 ${nFeasible} ` + over.slice(0, 6).join(' ｜ '));
      const blue19 = res.find((x) => x.blue && x.width === 1888 && x.n === 19);
      const fan19 = res.find((x) => !x.blue && x.width === 1888 && x.n === 19);
      ok('★★★[E2] 寬手牌列 19 張：攤開到接近整列寬（不再擠在中間）', blue19.m1.span > blue19.m1.content * 0.95 && fan19.m1.span > fan19.m1.content * 0.85 && blue19.m1.overlap < 58,
        JSON.stringify({ blue: blue19.m1, fan: fan19.m1 }));
      ok('★★[E3] 手牌列變窄後重量（ResizeObserver 觀察手牌列）', res.every((x) => x.n < 19 || x.m2.overlap > x.m1.overlap), JSON.stringify(res.filter((x) => x.n >= 12 && !(x.m2.overlap > x.m1.overlap)).map((x) => [x.width, x.n, x.m1.overlap, x.m2.overlap]).slice(0, 4)));
      // 3 → 13 張時兩端旋轉角 4° → 約 17°，扇形外擴變大；只有 update() 會重量（手牌列與第一張卡都沒變大小）
      const e4 = res.filter((x) => !x.blue && x.n === 3);
      ok('★★[E4] 張數增加後重量（update）：扇形外擴跟著張數變大', e4.length === 2 && e4.every((x) => x.availAfter < x.availBefore - 40), JSON.stringify(e4.map((x) => [x.width, x.availBefore, x.availAfter])));
      ok('★★[E5] 只改卡寬也重量（ResizeObserver 觀察第一張卡）', res.every((x) => Math.abs(x.cardAfter - x.cardBefore) > 5), JSON.stringify(res.map((x) => [x.cardBefore, x.cardAfter]).slice(0, 4)));
      const fr = await runCase({ js: NEW.js, n: 40, width: 1868.1, blue: true, zeroFan: false, frac: 95.45 });   // 寬度挑在「取整會讓 ceil 少 1px」的位置：真卡寬 106.45 ⇒ 需疊 62.1→63；取整 106 ⇒ 61.6→62，整排多 3.9px
      ok('★★[E7] 卡寬帶小數（95.45px）、40 張：整排不超出手牌列（卡寬沒有被取整）', fr.m1.out <= 0.5 && fr.m1.overlap > 0, JSON.stringify(fr.m1));
      // 正對照：同一套量測，把扇形外擴拿掉（審查 P1 那一版）⇒ 扇形必須被量到超出
      const ctl = await runCase({ js: NEW.js, n: 19, width: 1888, blue: false, zeroFan: true });
      ok('★★[E6 正對照] 不預留扇形外擴時，E1 的量測抓得到兩端超出', ctl.m1.out > 20, JSON.stringify(ctl.m1));
    } finally { await browser.close(); }
  }
} else if (!NEW.js) ok('[E 前提] 頁面有 v6557-hand-fit 區塊', false);

if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6557 HEAD-FAIL');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6557b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const B = await scenarios(await load(tmp), tmp);
    console.log('\n── BASE（v6.556）HEAD-FAIL 對照 ──');
    for (const k of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']) ok(`H ${k} 在 BASE 為紅`, !B[k]);
    ok('H A0 正對照在 BASE 為綠', !!B.A0);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.557 手牌互疊依實際寬度：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
