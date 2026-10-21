// v6.593：編譯真實條件與 class 接線，量測產品 CSS；不模擬原生系統模糊。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { build } from 'esbuild';
import { pwLaunch } from './lib/pw.mjs';
import { extractCss } from './lib/zoom-modal-fixture.mjs';
import { revertIosTopV6593, IOS_TOP_V6593_PAIRS } from './lib/revert-ios-top-v6593.mjs';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PRODUCT = process.env.V6593_PRODUCT_ROOT || ROOT;
const path = 'src/routes/game/MobilePortraitBattle.svelte';
const src = readFileSync(join(PRODUCT, path), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
function ok(name, value, detail = '') {
  if (value) { pass++; console.log('PASS ' + name); }
  else { fail++; console.error('FAIL ' + name + ' ' + detail); }
}
// BASE 沒有本版條件時，仍編譯原本 root，讓幾何斷言實際失敗、負例仍通過。
const start = src.indexOf('// >>> v6593-ios-top-clearance');
const end = src.indexOf('// <<< v6593-ios-top-clearance');
if ((start < 0) !== (end < 0) || (start >= 0 && end <= start)) throw Error('條件區塊不完整');
const condition = start < 0 ? '' : src.slice(start, end);
const opening = src.match(/<div class="mp"[^>]*>/)?.[0];
if (!opening) throw Error('找不到真實手機根元素');
const bench = '<div class="mp-row">' + '<div class="mp-slot mp-empty"></div>'.repeat(5) + '</div>';
const active = '<div class="mp-active-row"><button class="mp-active"><div class="mp-active-card-back"></div><div class="mp-active-info"><div class="mp-active-name">測試寶可夢ex</div><div class="mp-hp">HP 300/300</div></div></button></div>';
const chips = '<div class="mp-chips"><button class="mp-chip">棄牌區</button></div>';
const source = `<script lang="ts">${condition}\nlet clicks=$state(0);</script>${opening.replace(' use:preventScroll', '')}<header class="mp-top">回合 1<button class="mp-end-btn" onclick={()=>clicks++}>結束回合</button></header><div class="mp-timer-strip">P1 0:06</div>${bench}${chips}${active}<section class="mp-log">${'<div>對戰紀錄</div>'.repeat(20)}</section>${active}${chips}${bench}<footer class="mp-hand">${'<button class="mp-hand-card">手牌</button>'.repeat(8)}</footer></div><output>{clicks}</output>`;
const compiled = compile(source, { generate: 'client', filename: 'Probe.svelte' }).js.code;
const bundle = (await build({ stdin: { contents: compiled + '\nimport {mount} from "svelte";mount(Probe,{target:document.querySelector("#app")});', resolveDir: ROOT, sourcefile: 'Probe.js' }, bundle: true, write: false, platform: 'browser', format: 'iife', conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text;
const css = extractCss(readFileSync(join(PRODUCT, 'src/routes/+layout.svelte'), 'utf8')) + extractCss(src);
const browser = await pwLaunch('v6593 iPhone頂部避讓', { headless: true });
if (browser) { try {
  const cases = [
    ['iPhone主畫面', 'iPhone', true, 390, 844, 59, 34, 20],
    ['iPhone短螢幕', 'iPhone', true, 320, 568, 20, 0, 20],
    ['iPhone高度預算', 'iPhone', true, 390, 700, 59, 34, 20],
    ['iPhone安全區零', 'iPhone', true, 390, 700, 0, 0, 0],
    ['iPhone小安全區', 'iPhone', true, 390, 700, 10, 0, 10],
    ['Safari', 'iPhone', false, 390, 700, 59, 34, 0],
    ['Safari沒有standalone', 'iPhone', null, 390, 700, 59, 34, 0],
    ['Android安裝版', 'Android', true, 390, 700, 24, 0, 0],
    ['iPad', 'iPad', true, 390, 700, 24, 0, 0],
    ['桌機', 'Windows', true, 1280, 900, 0, 0, 0]
  ];
  for (const [name, ua, standalone, width, height, top, bottom, gap] of cases) {
    const page = await browser.newPage({ viewport: { width, height }, userAgent: ua });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--safe-top:${top}px;--safe-bottom:${bottom}px}</style><main id="app"></main>`);
    if (standalone !== null) await page.evaluate(value => Object.defineProperty(navigator, 'standalone', { value, configurable: true }), standalone);
    await page.addScriptTag({ content: bundle });
    const r = await page.evaluate(() => {
      const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { top:r.top, bottom:r.bottom, height:r.height }; };
      return { header:rect('.mp-top'), hand:rect('.mp-hand'), card:rect('.mp-hand-card'), bg:getComputedStyle(document.querySelector('.mp-top')).backgroundColor };
    });
    ok(name + ' 工具列避讓', Math.abs(r.header.top - top - gap) < .1, JSON.stringify(r));
    ok(name + ' 手牌完整', r.hand.bottom <= height - bottom + 1 && r.card.bottom <= height - bottom + 1 && r.card.top >= r.header.bottom, JSON.stringify(r));
    const shortfall = Math.min(360, Math.max(0, 655 - (height - top - bottom - gap)));
    ok(name + ' 高度預算同步', Math.abs(r.card.height - (Math.max(48, 96-shortfall*.16)-10)) < .1, JSON.stringify(r));
    await page.locator('.mp-end-btn').click();
    ok(name + ' 按鈕可點且無錯誤', await page.locator('output').textContent() === '1' && errors.length === 0);
    ok(name + ' 頂部實色底', r.bg === 'rgb(10, 24, 10)');
    if (name === 'iPhone主畫面') {
      await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '0px'));
      ok('安全區動態變零不殘留', Math.abs(await page.locator('.mp-top').evaluate(e=>e.getBoundingClientRect().top)) < .1);
      await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));
      ok('安全區恢復自動避讓', Math.abs(await page.locator('.mp-top').evaluate(e=>e.getBoundingClientRect().top) - 79) < .1);
    }
    await page.close();
  }
} finally { await browser.close(); } }
// 還原器不能吞掉額外差異，也不能接受缺失或重複錨點。
if (start >= 0) {
  const restored = revertIosTopV6593(src);
  ok('還原仍保留額外差異', revertIosTopV6593(src + '\n/* 額外差異 */').endsWith('/* 額外差異 */'));
  for (const [i, [current]] of IOS_TOP_V6593_PAIRS.entries()) {
    for (const [kind, input] of [['缺失', src.replace(current, '')], ['重複', src + current]]) {
      let rejected = false; try { revertIosTopV6593(input); } catch { rejected = true; }
      ok('還原拒絕' + kind + i, rejected);
    }
  }
  ok('還原保留原安全區', restored.includes('padding-top: var(--safe-top, 0px);'));
}
ok('產品檔未改寫', src === readFileSync(join(PRODUCT, path), 'utf8').replace(/\r\n/g, '\n'));
console.log(`v6.593：${pass} PASS / ${fail} FAIL`);
if (fail) process.exitCode = 1;
