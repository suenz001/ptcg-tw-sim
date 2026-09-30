#!/usr/bin/env node
/**
 * v6.457 守衛：彈出視窗開著時，手機（觸控）不會捲到後面的整頁——中央 action `pageScrollLock`（src/lib/page-scroll-lock.ts）
 *
 * 站長 2026-09-30：「手機版查詢卡片時，也會有捲動到背景的情況發生」。
 *   實測（Playwright 390×844 觸控，/cards?set=M6 點一張卡）：詳情視窗裡滑到底再滑 ⇒ 背景 scrollY 485 → 2191；
 *   手指在深色遮罩上滑、放大圖上滑也都捲背景。牌組編輯（/decks）的卡片詳情是同一型的視窗。
 *
 * 【S】靜態（HEAD-FAIL 對 v6.456）
 *   S1 中央模組存在、只在觸控裝置鎖、有引用計數
 *   S2 列舉四頁（首頁／卡牌資料庫／牌組編輯／牌組公布欄）所有「遮罩」開頭標籤，一律掛 use:pageScrollLock
 *   S3 可捲的視窗內容區有 overscroll-behavior:contain（桌機滾輪捲到底不把整頁帶走）
 *   S4 除了中央模組，沒有別的地方自己改 body.style.position（禁止各頁再寫一套）
 * 【D】行為（Playwright；沒有瀏覽器 ⇒ ENV-SKIP）：把中央模組打包進一頁長頁面，用 CDP 真的手指拖曳
 *   D0 正對照：沒鎖時手指一拖整頁就捲（證明這個量法量得到捲動）
 *   D1 觸控裝置鎖住後拖曳 ⇒ 背景畫面位置不變（body top ＝ −原捲動量）
 *   D2 兩層（視窗＋放大圖）⇒ 關掉上層還是鎖著、兩層都關才解鎖，解鎖後回到原本的捲動位置
 *   D3 桌機（非觸控）⇒ 完全不動 body（維持站長的規則：遮罩外滾輪捲整頁）
 *   D4 站長 2026-09-30 定的桌機規則（對戰頁選擇視窗，現行就是這樣，這裡釘住）：
 *      「滑鼠停在卡片區滾動時只會捲卡片，要移到卡片區外面才捲得動整個視窗」
 *      ⇒ 卡片格捲到底再滾也不帶動整頁（群組規則 overscroll-behavior:contain）；滑鼠移到視窗外面滾輪才捲整頁
 *
 * Run: node scripts/test-v6457-page-scroll-lock.mjs
 */
import { build } from 'esbuild';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { extractCss, pageHtml } from './lib/zoom-modal-fixture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.456。
const BASE_SHA = 'ec9c3fcf537a871135fe75499983c0c81e574fe3';
const MOD = 'src/lib/page-scroll-lock.ts';
const PAGES = ['src/routes/+page.svelte', 'src/routes/cards/+page.svelte', 'src/routes/decks/+page.svelte', 'src/routes/deck-posts/+page.svelte'];
// 遮罩＝position:fixed 蓋全畫面、點了會關的那一層（第一個 class 名；各頁命名不同——牌組公布欄的 .modal 是裡面那層，不是遮罩）
const OVERLAY_CLASSES = {
  'src/routes/+page.svelte': ['modal-overlay'],
  'src/routes/cards/+page.svelte': ['modal', 'lightboxOverlay'],
  'src/routes/decks/+page.svelte': ['pv-overlay', 'lightboxOverlay'],
  'src/routes/deck-posts/+page.svelte': ['modal-backdrop'],
};
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

/** 列舉一頁所有「遮罩」開頭標籤（<div ...> 可能跨行）；回傳 [{cls, tag}] */
function overlayTags(src, classes) {
  const out = []; const re = /<div\b[^>]*>/g; let m;
  while ((m = re.exec(src))) {
    const c = /\bclass="([^"]*)"/.exec(m[0]); if (!c) continue;
    const first = c[1].trim().split(/\s+/)[0];
    if (classes.includes(first)) out.push({ cls: first, tag: m[0] });
  }
  return out;
}
const MARKUP = (src) => src.replace(/<style[\s\S]*?<\/style>/g, '');
function allOverlaysLocked(get) {
  let n = 0;
  for (const p of PAGES) { const s = get(p); if (!s) return { n: 0, bad: [p + ' 讀不到'] }; }
  const bad = [];
  for (const p of PAGES) for (const t of overlayTags(MARKUP(get(p)), OVERLAY_CLASSES[p])) { n++; if (!/\buse:pageScrollLock\b/.test(t.tag)) bad.push(p.replace('src/routes/', '') + ' .' + t.cls); }
  return { n, bad };
}
function cssBlock(src, sel) { const i = src.indexOf('  ' + sel + ' {\n'); if (i < 0) return ''; return src.slice(i, src.indexOf('\n  }\n', i)); }

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) { const p = join(dir, f); const st = statSync(p); if (st.isDirectory()) walk(p, acc); else if (/\.(svelte|ts)$/.test(f)) acc.push(relative(ROOT, p).replace(/\\/g, '/')); }
  return acc;
}

const CHECKS = [
  ['★★★[S1] 中央模組存在：觸控裝置才鎖、引用計數、body 固定＋解鎖捲回原位', true, (get) => {
    const s = get(MOD); return !!s && s.includes("'(hover: none) and (pointer: coarse)'") && /lockCount\+\+/.test(s) && /b\.position = 'fixed'/.test(s)
      && /window\.scrollTo\(\{ top: savedY/.test(s) && /export function pageScrollLock\(/.test(s);
  }],
  ['★★★[S2] 四頁所有遮罩（首頁回饋／卡牌資料庫詳情＋放大圖／牌組編輯詳情＋放大圖＋其他視窗／牌組公布欄）都掛 use:pageScrollLock', true, (get) => {
    const r = allOverlaysLocked(get); return r.n >= 12 && r.bad.length === 0;
  }],
  ['★★[S2] 每頁都有 import 中央 action（不是各自再寫一份）', true, (get) =>
    PAGES.every((p) => /import \{ pageScrollLock \} from '\$lib\/page-scroll-lock';/.test(get(p) || ''))],
  ['★★[S3] 可捲的視窗內容區 overscroll-behavior:contain（卡牌資料庫／牌組編輯／牌組公布欄）', true, (get) =>
    /overscroll-behavior: contain;/.test(cssBlock(get('src/routes/cards/+page.svelte'), '.modalInner'))
    && /overscroll-behavior: contain;/.test(cssBlock(get('src/routes/decks/+page.svelte'), '.pv-inner'))
    && /overscroll-behavior: contain;/.test(cssBlock(get('src/routes/deck-posts/+page.svelte'), '.modal'))],
];

// ── A) 現行原始碼 ──
const cur = (p) => (existsSync(join(ROOT, p)) ? rd(p) : '');
console.log('【S】現行原始碼');
const r0 = allOverlaysLocked(cur);
ok('[前提] 列舉器找得到遮罩（≥12 個，少了代表列舉器壞了）', r0.n >= 12, 'n=' + r0.n);
for (const [name, , fn] of CHECKS) { let r = false; try { r = !!fn(cur); } catch { r = false; } ok(name, r, name.includes('S2') ? JSON.stringify(r0.bad) : undefined); }
{
  const offenders = walk(join(ROOT, 'src')).filter((f) => f !== MOD && f !== 'src/routes/game/+page.svelte' && f !== 'src/routes/game/MobilePortraitBattle.svelte')
    .filter((f) => /document\.body\.style\.(position|top)\s*=|body\.style\.position\s*=/.test(rd(f)));
  ok('★★[S4] 除了中央模組（與對戰頁既有的 mp-locked），沒有別處自己改 body.style.position／top', offenders.length === 0, offenders.join(', '));
}

// ── B) HEAD-FAIL：同一批判準餵 v6.456 ──
console.log('\n【S】HEAD-FAIL（v6.456）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6457 HEAD-FAIL', '需要 v6.456 commit');
else {
  const cache = new Map();
  const base = (p) => { if (!cache.has(p)) { const r = readBaseBlob(ROOT, BASE_SHA, p); cache.set(p, r.ok ? r.out.replace(/\r\n/g, '\n') : ''); } return cache.get(p); };
  const wrong = CHECKS.filter(([, hf, fn]) => { let r = false; try { r = !!fn(base); } catch { r = false; } return hf && r; }).map(([n]) => n);
  ok('★★★[HEAD-FAIL] S1～S3 在 v6.456 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
  const b0 = allOverlaysLocked(base);
  ok('[正對照] v6.456 也列舉得到同樣多的遮罩（列舉器對兩版一致）', b0.n === r0.n, `base=${b0.n} cur=${r0.n}`);
}

// ── D) 行為量測 ──
console.log('\n【D】行為量測（中央模組實際打包進頁面，CDP 手指拖曳）');
const bundle = await build({ entryPoints: [join(ROOT, MOD)], bundle: true, format: 'iife', globalName: 'PSL', write: false, logLevel: 'error', target: 'es2020' });
const JS = bundle.outputFiles[0].text;
const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}.row{height:200px;border-bottom:1px solid #ccc}</style></head><body>${Array.from({ length: 40 }, (_, i) => `<div class="row">${i}</div>`).join('')}<script>${JS}</script></body></html>`;
const chromium = pwChromium('v6.457 整頁捲動鎖');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.457 整頁捲動鎖');
  if (browser) {
    try {
      async function session(touch) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
        const pg = await ctx.newPage(); await pg.setContent(HTML, { waitUntil: 'load' });
        const cdp = await ctx.newCDPSession(pg);
        const drag = async (dy) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 600 }] });
          for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 600 + dy * i / 10 }] }); await pg.waitForTimeout(16); }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(300);
        };
        // 畫面上第一列的實際位置（不論是 window 捲動還是 body 被 top 推上去，都量「使用者看到的背景」）
        const seen = () => pg.evaluate(() => Math.round(document.querySelector('.row').getBoundingClientRect().top));
        return { ctx, pg, drag, seen };
      }
      // D0＋D1＋D2：觸控
      {
        const { ctx, pg, drag, seen } = await session(true);
        const coarse = await pg.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
        ok('[前提] 觸控情境 matchMedia 判得出觸控裝置', coarse);
        await drag(-400); await pg.waitForTimeout(1200); const afterFree = await seen(); // 等慣性捲動停下來
        ok('★★[D0 正對照] 沒鎖時手指一拖整頁就捲（量法量得到捲動）', afterFree < -100, 'row.top=' + afterFree);
        const rel1 = await pg.evaluate(() => { window.__r1 = PSL.lockPageScroll(); return PSL._pageScrollLockCount(); });
        const lockedAt = await seen();
        await drag(-400); await drag(-400); await drag(300);
        const afterLocked = await seen();
        ok('★★★[D1] 觸控裝置鎖住後拖曳 ⇒ 背景位置不變', rel1 === 1 && afterLocked === lockedAt && Math.abs(lockedAt - afterFree) <= 2, JSON.stringify({ afterFree, lockedAt, afterLocked }));
        const st = await pg.evaluate(() => { window.__r2 = PSL.lockPageScroll(); const c2 = PSL._pageScrollLockCount(); window.__r2(); window.__r2(); const c1 = PSL._pageScrollLockCount(); const pos1 = document.body.style.position; window.__r1(); return { c2, c1, pos1, c0: PSL._pageScrollLockCount(), pos0: document.body.style.position, y: Math.round(scrollY) }; });
        ok('★★★[D2] 兩層：關上層仍鎖（重複解鎖不多扣）、兩層都關才解鎖、解鎖後捲回原位', st.c2 === 2 && st.c1 === 1 && st.pos1 === 'fixed' && st.c0 === 0 && st.pos0 === '' && st.y === -lockedAt, JSON.stringify(st));
        await ctx.close();
      }
      // D3：桌機
      {
        const { ctx, pg } = await session(false);
        const d = await pg.evaluate(() => { const r = PSL.lockPageScroll(); const out = { c: PSL._pageScrollLockCount(), pos: document.body.style.position }; r(); return out; });
        ok('★★★[D3] 桌機（非觸控）⇒ 不鎖、不動 body（遮罩外滾輪照舊捲整頁）', d.c === 0 && d.pos === '', JSON.stringify(d));
        await ctx.close();
      }
      // D4：桌機對戰頁選擇視窗（真的 +page.svelte CSS）
      {
        const css = extractCss(rd('src/routes/game/+page.svelte'));
        const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="868" height="1212"><rect width="868" height="1212" fill="#3a6"/></svg>');
        const cards = Array.from({ length: 60 }, (_, i) => `<div class="sel-card"><img src="${IMG}" alt="c${i}"/></div>`).join('');
        const FIX = `<div style="height:3000px"></div><div class="selection-overlay"><div class="selection-modal pk-m" id="m"><div class="sel-header"><h3>選擇卡片</h3></div><div class="sel-grid" id="g">${cards}</div><div class="sel-footer"><button class="btn-act primary">確認</button></div></div></div>`;
        const ctx = await browser.newContext({ viewport: { width: 1366, height: 657 } });
        const pg = await ctx.newPage(); await pg.setContent(pageHtml(css, FIX), { waitUntil: 'load' });
        const st = () => pg.evaluate(() => { const g = document.getElementById('g'); return { win: Math.round(scrollY), g: Math.round(g.scrollTop), gMax: g.scrollHeight - g.clientHeight }; });
        const gr = await pg.evaluate(() => { const r = document.getElementById('g').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await pg.mouse.move(gr.x, gr.y); for (let i = 0; i < 12; i++) { await pg.mouse.wheel(0, 400); await pg.waitForTimeout(60); }
        await pg.waitForTimeout(300); const inGrid = await st();
        const mx = await pg.evaluate(() => document.getElementById('m').getBoundingClientRect().x);
        await pg.mouse.move(Math.max(4, mx / 2), 300); await pg.mouse.wheel(0, 300); await pg.waitForTimeout(300); const outside = await st();
        ok('★★★[D4] 桌機：卡片區上滾輪只捲卡片（捲到底再滾也不帶動整頁）', inGrid.gMax > 200 && inGrid.g >= inGrid.gMax - 1 && inGrid.win === 0, JSON.stringify(inGrid));
        ok('★★[D4] 桌機：滑鼠移到視窗外面，滾輪才捲得動整頁', outside.win > 0, JSON.stringify(outside));
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.457 整頁捲動鎖: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6457-page-scroll-lock ===');
process.exit(fail ? 1 : 0);
