#!/usr/bin/env node
/**
 * v6.464 守衛：卡圖小尺寸顯示改用縮圖 repo（suenz001/ptcg-tw-sim-img，450px WebP），失敗立刻退回官方原圖
 *
 * 由來：2026-10-01 站長同意另開 repo。官方 PNG 平均 427KB、CloudFront 對台灣每次 Miss（0.4～1.2 秒）；
 *   縮圖平均 53KB、GitHub Pages（Fastly 新加坡）命中約 0.07 秒。一局約 19.6MB → 2.4MB。
 *
 * 【A】cardThumb() 轉換規則（tw／hk PNG 轉；日版 jpg、站內圖、空值原樣）
 * 【B】產生器與轉換器判準一致：scripts/gen-card-thumbs.py 的 THUMB_RE ＝ thumb.ts 的 THUMB_PATTERN，
 *      且拿全資料庫卡圖網址兩邊各跑一次，「會被轉換的集合」完全相同（產生器漏做的圖＝玩家多等一次退路）
 * 【C】接線：每個 src={cardThumb(X)} 的 <img> 都有 use:retryImg={X}（同一個官方網址 ⇒ 退路接得上）；
 *      放大檢視（zoom-img／lightbox／detailImg／pv-img）與卡片 SEO 頁仍用官方原圖；替換數量下限
 * 【D】行為（假 DOM、真 img-retry.ts）：縮圖失敗 ⇒ **0 延遲**改官方原圖；官方原圖失敗 ⇒ 照舊 1 秒退避；
 *      官方原圖直接掛（沒走縮圖）的舊行為完全不變
 * 【H】HEAD-FAIL：v6.463 的 img-retry 在縮圖失敗後要等 1 秒（D1 在 BASE 必紅）
 * 突變（實跑）：M1 拿掉 failedThumb 的 0 延遲 ⇒ D1 紅；M2 產生器正規式少了 hk ⇒ B2 紅。
 *
 * Run: node scripts/test-v6464-card-thumbs.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.463。
const BASE_SHA = '4155077a8357cb0da090f3ae3452ad7ad60420ac';
const TMP = mkdtempSync(join(tmpdir(), 'thumb6464-'));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

let seq = 0;
async function bundle(entrySrc, entryName, extraAlias = {}) {
  const dir = join(TMP, 'b' + (++seq)); const { mkdirSync } = await import('node:fs'); mkdirSync(join(dir, 'cards'), { recursive: true });
  writeFileSync(join(dir, entryName), entrySrc);
  writeFileSync(join(dir, 'cards/thumb.ts'), readFileSync(join(ROOT, 'src/lib/cards/thumb.ts'), 'utf8'));
  const out = join(dir, 'out.mjs');
  await build({ entryPoints: [join(dir, entryName)], outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error', alias: extraAlias });
  return import(pathToFileURL(out).href);
}

const THUMB_SRC = readFileSync(join(ROOT, 'src/lib/cards/thumb.ts'), 'utf8');
const T = await bundle(THUMB_SRC, 'entry.ts');
const B = T.THUMB_BASE;

console.log('【A】cardThumb 轉換');
ok('[A1] tw PNG ⇒ 縮圖', T.cardThumb('https://asia.pokemon-card.com/tw/card-img/tw00013033.png') === B + 'tw00013033.webp');
ok('[A2] hk PNG ⇒ 縮圖', T.cardThumb('https://asia.pokemon-card.com/hk/card-img/hk00018965.png') === B + 'hk00018965.webp');
ok('[A3] 日版 jpg、站內圖、空值原樣回傳', T.cardThumb('https://www.pokemon-card.com/assets/images/card_images/large/M5/x.jpg') === 'https://www.pokemon-card.com/assets/images/card_images/large/M5/x.jpg'
  && T.cardThumb('/covers/a.png') === '/covers/a.png' && T.cardThumb('') === '' && T.cardThumb(undefined) === undefined && T.cardThumb(null) === null);
ok('[A4] 縮圖網址在 GitHub Pages 的縮圖 repo、450 寬目錄', B === 'https://suenz001.github.io/ptcg-tw-sim-img/w450/');
ok('[A5] isCardThumb 只認縮圖網址', T.isCardThumb(B + 'tw1.webp') && !T.isCardThumb('https://asia.pokemon-card.com/tw/card-img/tw1.png') && !T.isCardThumb(''));

console.log('\n【B】產生器與轉換器判準一致');
const PY = readFileSync(join(ROOT, 'scripts/gen-card-thumbs.py'), 'utf8');
const pyRe = (src) => { const m = src.match(/^THUMB_RE = r'([^']+)'/m); return m ? m[1] : null; };
ok('[B1] gen-card-thumbs.py 的 THUMB_RE 逐字等於 thumb.ts 的 THUMB_PATTERN', pyRe(PY) === T.THUMB_PATTERN, pyRe(PY) + ' vs ' + T.THUMB_PATTERN);
const urls = [];
for (const f of readdirSync(join(ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  let d; try { d = JSON.parse(readFileSync(join(ROOT, 'static/cards', f), 'utf8')); } catch { continue; }
  if (Array.isArray(d)) for (const c of d) if (c && c.imageUrl) urls.push(c.imageUrl);
}
const sameSet = (pySrc) => { const r = new RegExp(pyRe(pySrc)); return urls.every((u) => r.test(u) === (T.cardThumb(u) !== u)); };
ok('[B2] 全資料庫卡圖網址：產生器會做的 ＝ 前端會轉的（' + urls.length + ' 個網址）', urls.length > 4000 && sameSet(PY));
ok('[B3] 台灣卡圖（asia /tw/）全部會轉', urls.filter((u) => u.includes('asia.pokemon-card.com/tw/')).every((u) => T.cardThumb(u) !== u));

console.log('\n【C】接線');
const FILES = ['src/routes/game/+page.svelte', 'src/routes/game/MobilePortraitBattle.svelte', 'src/routes/decks/+page.svelte', 'src/routes/cards/+page.svelte'];
function scan(srcOf) {
  let total = 0; const unpaired = []; const zoomThumb = [];
  for (const f of FILES) {
    const s = srcOf(f);
    for (const m of s.matchAll(/<img\b(?:=>|[^>])*>/gs)) {
      const tag = m[0]; const line = s.slice(0, m.index).split('\n').length;
      const t = tag.match(/src=\{cardThumb\(([^)]*)\)\}/);
      if (/zoom-img|lightbox|detailImg|pv-img/i.test(tag) && t) zoomThumb.push(f + ':' + line);
      if (!t) continue;
      total++;
      const r = tag.match(/use:retryImg=\{([^}]*)\}/);
      if (!r || r[1].trim() !== t[1].trim()) unpaired.push(f + ':' + line);
    }
  }
  return { total, unpaired, zoomThumb };
}
const readF = (f) => readFileSync(join(ROOT, f), 'utf8');
const { total, unpaired, zoomThumb } = scan(readF);
ok('★★★[C1] 每個縮圖 <img> 都接上 use:retryImg={同一個官方網址}（退路）', unpaired.length === 0, unpaired.join(', '));
ok('★★[C2] 替換數量下限（對戰 41＋手機 8＋牌組 2＋資料庫 1 ≥ 50）', total >= 50, total);
ok('★★[C3] 放大檢視（zoom／lightbox／詳情大圖／預覽）不用縮圖（否則放大會糊）', zoomThumb.length === 0, zoomThumb.join(', '));
ok('[C4] 卡片 SEO 頁 /card/[id] 不用縮圖', !readFileSync(join(ROOT, 'src/routes/card/[id]/+page.svelte'), 'utf8').includes('cardThumb('));

{
  // 掃描器正對照：拿掉一個縮圖 <img> 的 use:retryImg ⇒ C1 必須抓到
  const g = readF(FILES[1]); const mut = g.replace(/use:retryImg=\{c\.imageUrl\} (src=\{cardThumb)/, '$1');
  ok('[C5 掃描器正對照] 拿掉一個縮圖的 use:retryImg ⇒ C1 抓得到', mut !== g && scan((f) => f === FILES[1] ? mut : readF(f)).unpaired.length === 1);
}

console.log('\n【D】img-retry 行為');
const OFFICIAL = 'https://asia.pokemon-card.com/tw/card-img/tw12345678.png';
const THUMB = T.cardThumb(OFFICIAL);
function makeImg(src) {
  const L = new Map(), A = new Map();
  return { hist: [src], _s: src, get src() { return this._s; }, set src(v) { this._s = v; this.hist.push(v); }, currentSrc: '', complete: false, naturalWidth: 1,
    addEventListener: (t, f) => { (L.get(t) ?? L.set(t, []).get(t)).push(f); }, removeEventListener: () => {},
    setAttribute: (k, v) => A.set(k, v), getAttribute: (k) => A.get(k) ?? null, hasAttribute: (k) => A.has(k), removeAttribute: (k) => A.delete(k),
    _fire: (t) => { for (const f of [...(L.get(t) ?? [])]) f(); } };
}
let timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms, dead: false }); return timers.length; };
globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].dead = true; };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
const live = () => timers.filter((t) => !t.dead && !t.done);
const run = () => { for (const t of live()) { t.done = true; t.fn(); } };
async function behave(retrySrc) {
  const R = await bundle(retrySrc, 'img-retry.ts');
  const out = {};
  timers = []; let img = makeImg(THUMB); R.retryImg(img, OFFICIAL);
  img._fire('error'); out.d1Delay = live().at(-1)?.ms; run(); out.d1Src = img.src;
  img._fire('error'); out.d2Delay = live().at(-1)?.ms;
  timers = []; img = makeImg(OFFICIAL); R.retryImg(img, OFFICIAL);
  img._fire('error'); out.d3Delay = live().at(-1)?.ms; run(); out.d3Src = img.src;
  return out;
}
const RETRY = readFileSync(join(ROOT, 'src/lib/img-retry.ts'), 'utf8');
const cur = await behave(RETRY);
ok('★★★[D1] 縮圖失敗 ⇒ 0 延遲改官方原圖（新卡沒縮圖、GitHub 掛掉時玩家不會多等）', cur.d1Delay === 0 && cur.d1Src === OFFICIAL, JSON.stringify(cur));
ok('★★[D2] 官方原圖接著也失敗 ⇒ 照舊退避（不對官方 CDN 連發）', cur.d2Delay >= 1000, cur.d2Delay);
ok('★★[D3] 沒走縮圖的官方原圖失敗 ⇒ 舊行為不變（1 秒退避、重試同一個原圖）', cur.d3Delay === 1000 && cur.d3Src === OFFICIAL, JSON.stringify(cur));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const rb = readBaseBlob(ROOT, BASE_SHA, 'src/lib/img-retry.ts');
  if (rb.ok) { const b = await behave(rb.out); ok('★★★[H1] v6.463 的 img-retry：縮圖失敗要等 1 秒 ⇒ D1 在 BASE 必紅', b.d1Delay === 1000, JSON.stringify(b)); }
  else shallowSkip('v6464 H1', '讀不到 BASE blob');
} else shallowSkip('v6464 H1', '需要 v6.463 commit');

console.log('\n【突變】');
const M1 = RETRY.replace('failedThumb ? 0 : BACKOFF_MS', 'failedThumb ? BACKOFF_MS[0] : BACKOFF_MS');
ok('[M1 自驗] 突變有套上', M1 !== RETRY);
if (M1 !== RETRY) { const m = await behave(M1); ok('★★[M1] 拿掉縮圖失敗的 0 延遲 ⇒ D1 必紅', m.d1Delay !== 0, JSON.stringify(m)); }
const M2 = PY.replace("card-img/((?:tw|hk)\\d+)", "card-img/((?:tw)\\d+)").replace('(tw|hk)/card-img', '(tw)/card-img');
ok('[M2 自驗] 突變有套上', M2 !== PY);
ok('★★[M2] 產生器正規式漏了 hk ⇒ B1／B2 必紅', pyRe(M2) !== T.THUMB_PATTERN && !sameSet(M2));

rmSync(TMP, { recursive: true, force: true });
console.log(`\n=== v6.464 卡圖縮圖: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6464-card-thumbs ===');
process.exit(fail ? 1 : 0);
