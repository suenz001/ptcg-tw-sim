#!/usr/bin/env node
/**
 * v6.458 守衛：桌機彈出視窗「外面才捲整頁」（站長 2026-09-30 裁定）
 *
 * v6.457 留下的缺口：桌機卡牌資料庫的卡片詳情內容不夠長（視窗本身不用捲）時，
 *   滑鼠停在視窗上滾輪 ⇒ 捲到後面的整頁。站長：「電腦版規則應該是『外面才捲整頁』」。
 * 修法（中央，src/lib/page-scroll-lock.ts 的同一個 action）：桌機在遮罩上掛 wheel 攔截——
 *   裡面（遮罩的子元素）⇒ 只捲裡面捲得動的東西，全都捲不動就擋掉；外面（遮罩本身／data-scroll-outside）⇒ 照捲整頁。
 *
 * 【S】靜態（HEAD-FAIL 對 v6.457）
 *   S1 中央模組匯出 shouldBlockWheel、action 在非觸控裝置掛 passive:false 的 wheel 監聽並在 destroy 拿掉
 *   S2 牌組編輯戰績視窗的透明背景鈕標 data-scroll-outside（它是「外面」）
 *   S3 除了中央模組，src/routes 底下沒有別處自己攔 wheel 事件
 * 【D】行為（Playwright，中央模組實際打包進頁面，真的滑鼠滾輪；沒有瀏覽器 ⇒ ENV-SKIP）
 *   D1 內容不夠長的視窗：滑鼠在裡面滾 ⇒ 整頁不動（v6.457 的缺口）
 *   D2 內容很長的視窗：滑鼠在裡面滾 ⇒ 視窗自己捲到底，整頁不動
 *   D3 滑鼠在外面（遮罩本身）滾 ⇒ 整頁照捲；D4 data-scroll-outside 的透明背景鈕上滾 ⇒ 整頁照捲
 *   D5 正對照：action destroy 之後，同樣在裡面滾 ⇒ 整頁會捲（證明 D1 是這個攔截擋下的，不是量法量不到）
 *   D6 視窗裡的 textarea 還能捲；Ctrl＋滾輪不擋
 *   D7 觸控裝置不掛滾輪攔截（整頁已由 v6.457 鎖住）
 *
 * Run: node scripts/test-v6458-desktop-wheel-outside.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.457。
const BASE_SHA = '62ce6f9f3a4cfbbc6fe70f44f7cca69b5438bd30';
const MOD = 'src/lib/page-scroll-lock.ts';
const DECKS = 'src/routes/decks/+page.svelte';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const CHECKS = [
  ['★★★[S1] 中央模組匯出 shouldBlockWheel；action 在非觸控裝置掛 passive:false 的 wheel 監聽、destroy 時拿掉', true, (get) => {
    const s = get(MOD) || '';
    return /export function shouldBlockWheel\(/.test(s) && /if \(typeof window !== 'undefined' && !shouldLockPageScroll\(\)\)/.test(s)
      && /node\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(s) && /node\.removeEventListener\('wheel', onWheel\)/.test(s)
      && /target === overlay \|\| target\.closest\('\[data-scroll-outside\]'\)/.test(s);
  }],
  ['★★[S2] 牌組編輯戰績視窗的透明背景鈕標 data-scroll-outside（它是「外面」）', true, (get) =>
    (get(DECKS) || '').includes('<button class="ds-backdrop" data-scroll-outside onclick={closeDeckStats}')],
];
function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, acc); else if (/\.(svelte|ts)$/.test(f)) acc.push(relative(ROOT, p).replace(/\\/g, '/')); }
  return acc;
}

console.log('【S】現行原始碼');
const cur = (p) => { try { return rd(p); } catch { return ''; } };
for (const [name, , fn] of CHECKS) { let r = false; try { r = !!fn(cur); } catch { r = false; } ok(name, r); }
{
  const offenders = walk(join(ROOT, 'src/routes')).filter((f) => !f.startsWith('src/routes/game/'))
    .filter((f) => /addEventListener\(\s*['"]wheel['"]|onwheel\s*=/.test(rd(f)));
  ok('★★[S3] 非對戰頁沒有別處自己攔 wheel（只走中央 action）', offenders.length === 0, offenders.join(', '));
}
console.log('\n【S】HEAD-FAIL（v6.457）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6458 HEAD-FAIL', '需要 v6.457 commit');
else {
  const base = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  const wrong = CHECKS.filter(([, hf, fn]) => { let r = false; try { r = !!fn(base); } catch { r = false; } return hf && r; }).map(([n]) => n);
  ok('★★★[HEAD-FAIL] S1～S2 在 v6.457 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
}

console.log('\n【D】行為量測（真的滑鼠滾輪）');
const bundle = await build({ entryPoints: [join(ROOT, MOD)], bundle: true, format: 'iife', globalName: 'PSL', write: false, logLevel: 'error', target: 'es2020' });
const JS = bundle.outputFiles[0].text;
// 長頁面＋固定遮罩；遮罩裡：短視窗 #short、長視窗 #long（可捲）、textarea、透明背景鈕 #bk（data-scroll-outside）
const HTML = `<!doctype html><html><head><style>
body{margin:0} .row{height:200px;border-bottom:1px solid #ccc}
#ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;gap:20px;align-items:flex-start;justify-content:center;padding:40px}
#bk{position:absolute;left:0;top:0;width:120px;height:120px;border:0;background:transparent}
.box{position:relative;background:#fff;width:260px;padding:10px;box-sizing:border-box}
#short{height:200px} #long{max-height:300px;overflow-y:auto} #long .in{height:1500px} textarea{width:200px;height:80px}
</style></head><body>${Array.from({ length: 40 }, (_, i) => `<div class="row">${i}</div>`).join('')}
<div id="ov"><button id="bk" data-scroll-outside></button><div class="box" id="short">短內容</div><div class="box" id="long"><div class="in">長內容</div></div><div class="box" id="tb"><textarea id="ta">${'一行\n'.repeat(60)}</textarea></div></div>
<script>${JS}</script></body></html>`;
const chromium = pwChromium('v6.458 桌機外面才捲整頁');
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.458 桌機外面才捲整頁');
  if (browser) {
    try {
      // 桌機
      {
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 700 } });
        const pg = await ctx.newPage(); await pg.setContent(HTML, { waitUntil: 'load' });
        await pg.evaluate(() => { window.__act = PSL.pageScrollLock(document.getElementById('ov')); });
        const Y = () => pg.evaluate(() => Math.round(scrollY));
        const center = (id) => pg.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 60) }; }, id);
        const wheelAt = async (p, dy, n = 1, mods = []) => { await pg.mouse.move(p.x, p.y); for (const m of mods) await pg.keyboard.down(m); for (let i = 0; i < n; i++) { await pg.mouse.wheel(0, dy); await pg.waitForTimeout(60); } for (const m of mods) await pg.keyboard.up(m); await pg.waitForTimeout(250); };
        await wheelAt(await center('short'), 300, 3);
        ok('★★★[D1] 內容不夠長的視窗：滑鼠在裡面滾 ⇒ 整頁不動', (await Y()) === 0, 'scrollY=' + (await Y()));
        await wheelAt(await center('long'), 400, 8);
        const lg = await pg.evaluate(() => { const e = document.getElementById('long'); return { t: Math.round(e.scrollTop), max: e.scrollHeight - e.clientHeight }; });
        ok('★★★[D2] 內容很長的視窗：裡面自己捲到底、整頁不動', lg.t >= lg.max - 1 && lg.max > 500 && (await Y()) === 0, JSON.stringify({ ...lg, win: await Y() }));
        await wheelAt({ x: 1150, y: 650 }, 300, 1);
        const afterOut = await Y();
        ok('★★★[D3] 滑鼠在外面（遮罩本身）滾 ⇒ 整頁照捲', afterOut > 0, 'scrollY=' + afterOut);
        await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(100);
        await wheelAt({ x: 60, y: 60 }, 300, 1);
        ok('★★[D4] data-scroll-outside 的透明背景鈕上滾 ⇒ 整頁照捲', (await Y()) > 0, 'scrollY=' + (await Y()));
        await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(100);
        await wheelAt(await center('ta'), 200, 2);
        const ta = await pg.evaluate(() => Math.round(document.getElementById('ta').scrollTop));
        ok('★★[D6] 視窗裡的 textarea 照常能捲、整頁不動', ta > 0 && (await Y()) === 0, JSON.stringify({ ta, win: await Y() }));
        const blk = await pg.evaluate(() => { const ov = document.getElementById('ov'); const s = document.getElementById('short'); return { ctrl: PSL.shouldBlockWheel(ov, s, 0, 100, true), plain: PSL.shouldBlockWheel(ov, s, 0, 100, false) }; });
        ok('★[D6] Ctrl＋滾輪（瀏覽器縮放）不擋、一般滾輪擋', blk.ctrl === false && blk.plain === true, JSON.stringify(blk));
        await pg.evaluate(() => window.__act.destroy());
        await wheelAt(await center('short'), 300, 2);
        ok('★★★[D5 正對照] action 拿掉之後，同樣在裡面滾 ⇒ 整頁會捲（證明 D1 是攔截擋下的）', (await Y()) > 0, 'scrollY=' + (await Y()));
        await ctx.close();
      }
      // 觸控
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const pg = await ctx.newPage(); await pg.setContent(HTML, { waitUntil: 'load' });
        const r = await pg.evaluate(() => {
          const ov = document.getElementById('ov'); const orig = ov.addEventListener; const seen = [];
          ov.addEventListener = function (t, ...a) { seen.push(t); return orig.call(this, t, ...a); };
          const a = PSL.pageScrollLock(ov); const out = { seen, pos: document.body.style.position }; a.destroy(); return out;
        });
        ok('★★[D7] 觸控裝置不掛滾輪攔截（整頁已由 v6.457 鎖住）', !r.seen.includes('wheel') && r.pos === 'fixed', JSON.stringify(r));
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
}

console.log(`\n=== v6.458 桌機外面才捲整頁: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6458-desktop-wheel-outside ===');
process.exit(fail ? 1 : 0);
