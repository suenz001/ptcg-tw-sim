#!/usr/bin/env node
// v6.585：量測真正的桌機／手機 CSS；卡背統一，正面、空獎賞、棄牌與幾何不變。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extractCss, pageHtml } from './lib/zoom-modal-fixture.mjs';
import { pwLaunch } from './lib/pw.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'src/routes/game/+page.svelte';
const MOBILE = 'src/routes/game/MobilePortraitBattle.svelte';
const CSS = 'src/lib/game/card-back.css';
const ASSET = 'src/lib/assets/pokemon-card-back.jpg';
const BASE_SHA = '4474367c96bc1a5aa3d38f15ffed19663195df59';
const IMPORT = 'import "$lib/game/card-back.css";';
const read = p => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const src = read(PAGE), mobile = read(MOBILE);
const css = existsSync(join(ROOT, CSS)) ? read(CSS) : '';
const asset = existsSync(join(ROOT, ASSET)) ? readFileSync(join(ROOT, ASSET)) : Buffer.alloc(0);
let pass = 0, fail = 0;
function ok(name, value, detail = '') {
  if (value) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

ok('S1 對戰頁匯入共用卡背樣式（手機與動畫也在同一頁）', src.includes(IMPORT));
ok('S2 使用已核對的官方原圖，檔案內容完整', createHash('sha256').update(asset).digest('hex') === '37a4df719ed9134a4652c639fea545f549c6cce40647ad5d82909be02a6afeb3');
ok('S3 圖片走 Vite 相對資源，不用根路徑或第三方圖片請求', /url\(['"]?\.\.\/assets\/pokemon-card-back\.jpg['"]?\)/.test(css) && !/url\(['"]?(?:https?:|\/)/.test(css));
ok('S4 樣式只改卡背外觀，不改尺寸、位置、轉場或點擊', !/(?:^|[;{])\s*(?:width|height|min-width|min-height|max-width|max-height|padding|margin|position|display|transform|animation|transition|pointer-events|z-index)\s*:/m.test(css));

const keys = ['back', 'mobile', 'concealed', 'prize', 'deck', 'draw', 'reveal', 'pick'];
const controls = ['faceup', 'gone', 'discard', 'front'];
const fixture = layout => `<div class="battle-root"><div class="playmat ${layout}">
  <div class="card-back card-back-sm" id="back"><span class="card-back-mark">?</span></div>
  <div class="mp-card-back mp-active-card-back" id="mobile"><span class="mp-card-back-mark">?</span></div>
  <div class="sel-card-back" id="concealed"><span class="sel-card-back-icon">🎴</span><span class="sel-card-back-q">?</span></div>
  <div class="prize-card my-prize" id="prize"></div>
  <div class="pile-slot deck-pile" id="deck"><span class="pile-icon">📚</span><span class="pile-count">47</span></div>
  <div class="prize-card prize-faceup" id="faceup"><img class="prize-face-img" alt="公開卡牌"></div>
  <div class="prize-card prize-gone" id="gone"></div>
  <div class="pile-slot disc-pile" id="discard"><span class="pile-icon">🗑</span></div>
  <img class="prize-face-img" id="front" alt="正面卡圖">
</div>
  <div class="draw-fly-card"><div class="card-back draw-fly-back" id="draw"><span class="card-back-mark">?</span></div></div>
  <div class="card-reveal-face card-reveal-back"><div class="card-back" id="reveal"><span class="card-back-mark">?</span></div></div>
  <div class="card-back prize-pick-back" id="pick"><span class="card-back-mark">?</span></div>
</div>`;

const browser = await pwLaunch('v6.585 官方卡背、幾何與正對照');
if (browser) {
  try {
    const page = await browser.newPage();
    const dataUrl = 'data:image/jpeg;base64,' + asset.toString('base64');
    const size = await page.evaluate(async url => {
      const image = new Image(); image.src = url;
      try { await image.decode(); return [image.naturalWidth, image.naturalHeight]; } catch { return [0, 0]; }
    }, dataUrl);
    ok('E0 原圖可解碼為 660 × 921', size[0] === 660 && size[1] === 921);
    async function measure(gameSrc, mobileSrc, extraCss, layout, width) {
      await page.setViewportSize({ width, height: 900 });
      // 只把實際的本機資源引用換成原圖資料 URI，讓 fixture 不依賴網路。
      const material = extraCss.replaceAll('../assets/pokemon-card-back.jpg', dataUrl);
      await page.setContent(pageHtml(extractCss(gameSrc) + extractCss(mobileSrc) + material, fixture(layout)));
      return page.evaluate(({ keys, controls }) => {
        const result = {};
        for (const key of [...keys, ...controls]) {
          const e = document.getElementById(key), s = getComputedStyle(e), r = e.getBoundingClientRect();
          result[key] = {
            official: s.backgroundImage.includes('data:image/jpeg;base64,'),
            geometry: [r.x, r.y, r.width, r.height],
            background: s.background, border: s.border, shadow: s.boxShadow,
          };
        }
        result.markersHidden = [...document.querySelectorAll('.card-back-mark,.mp-card-back-mark,.sel-card-back-icon,.sel-card-back-q,.deck-pile .pile-icon')]
          .every(e => { const s = getComputedStyle(e); return s.visibility === 'hidden' || s.display === 'none'; });
        result.countVisible = getComputedStyle(document.querySelector('.deck-pile .pile-count')).visibility === 'visible';
        return result;
      }, { keys, controls });
    }
    let blueBaseline;
    for (const [layout, width] of [['', 1440], ['layout-tabletop', 1440], ['layout-fable', 1440], ['layout-fable layout-blue', 1440], ['', 390], ['', 320], ['', 430]]) {
      const tag = (layout || '經典／手機') + ' ' + width;
      const before = await measure(src, mobile, '', layout, width);
      const after = await measure(src, mobile, css, layout, width);
      for (const key of keys) ok(`E1 ${tag} ${key} 用官方卡背`, after[key].official);
      ok(`E2 ${tag} 卡牌、牌庫與動畫幾何不變`, [...keys, ...controls].every(k => JSON.stringify(before[k].geometry) === JSON.stringify(after[k].geometry)));
      ok(`E3 ${tag} 正面／空獎賞／棄牌外觀不變`, controls.every(k => JSON.stringify(before[k]) === JSON.stringify(after[k])));
      ok(`E4 ${tag} 遮住舊圖示，牌庫張數仍可見`, after.markersHidden && after.countVisible);
      if (layout.includes('layout-blue')) blueBaseline = { before, after };
    }
    if (hasBaseCommit(ROOT, BASE_SHA)) {
      const oldPage = readBaseBlob(ROOT, BASE_SHA, PAGE), oldMobile = readBaseBlob(ROOT, BASE_SHA, MOBILE);
      ok('H0 上一版可讀', oldPage.ok && oldMobile.ok);
      if (oldPage.ok && oldMobile.ok) {
        const base = await measure(oldPage.out, oldMobile.out, '', 'layout-fable layout-blue', 1440);
        for (const key of keys) ok(`H1 HEAD-FAIL ${key}：上一版不是官方卡背`, !base[key].official);
        ok('H2 正對照：上一版的正面、空獎賞、棄牌與本版一致', controls.every(k => JSON.stringify(base[k]) === JSON.stringify(blueBaseline.after[k])));
      }
    } else shallowSkip('v6585 H', '需要 v6.584 commit');
    // 直接改送進瀏覽器的樣式，證明量測能殺掉每種漏接；不寫回工作樹。
    const mutations = [
      ['手機漏接', css.replace('.battle-root .mp-card-back,', ''), 'mobile'],
      ['共用卡背漏接', css.replace('.battle-root .card-back,', ''), 'draw'],
      ['選擇窗漏接', css.replace('.battle-root .sel-card-back,', ''), 'concealed'],
      ['獎賞漏接', css.replace('.battle-root .prize-card:not(.prize-gone):not(.prize-faceup),', ''), 'prize'],
      ['牌庫漏接', css.replace('.battle-root .deck-pile {', '.battle-root .missing-deck {'), 'deck'],
      ['誤蓋公開獎賞', css.replace(':not(.prize-faceup)', ''), 'faceup'],
      ['誤蓋空獎賞', css.replace(':not(.prize-gone)', ''), 'gone'],
    ];
    for (const [name, mutant, key] of mutations) {
      ok(`M 前提 ${name} 確實改到樣式`, mutant !== css);
      const measured = await measure(src, mobile, mutant, 'layout-fable layout-blue', 1440);
      ok(`M ${name} 被原判準抓到`, controls.includes(key)
        ? JSON.stringify(measured[key]) !== JSON.stringify(blueBaseline.after[key])
        : !measured[key].official);
    }
  } finally { await browser.close(); }
}
console.log(`v6.585 官方卡背：${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
