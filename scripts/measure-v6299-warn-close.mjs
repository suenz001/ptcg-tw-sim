// v6.299 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）—— 錯誤訊息關閉鈕的「零位移」證據。
//
// 做法沿用 scripts/measure-v6297-tourn-tabs.mjs／measure-v6298-lobby-align.mjs：
//   把 src/routes/game/+page.svelte 的 <style> 區**整段原樣**抽出（:global(X) → X），
//   灌進靜態 fixture，用**與出貨碼相同的 class 結構**擺出錦標賽大廳（分頁列 ＋ 分頁內容 ＋ 頁尾錯誤訊息），
//   量「沒有關閉鈕（＝ v6.298）」與「有關閉鈕（＝ 本版）」兩種情況下每個元素的 getBoundingClientRect()，逐一相減。
//
// ⭐ 錯誤訊息的文字**從出貨碼實抽**：伺服器 oracle-admin/server_admin_patch.js 回的 409 字串
//   ＋ tApi 組錯誤訊息的格式（`${res.status}: ${body}`）—— 就是站長看到的那一串，不是手抄的。
//
// 斷言：
//   ① 錯誤訊息**以上**的每一個元素（回首頁鈕／標題／已登入那一行／分頁列／分頁內容）rect 全等（dx=dy=dw=dh=0）
//   ② <p class="warn"> 本身的 top / left / width / height 全等 ⇒ 關閉鈕沒有把它撐高、也沒有讓文字換行
//   ③ 文字節點的 client rects 逐一全等 ⇒ 訊息文字一個像素都沒有被推動
//   ④ 關閉鈕的 rect 落在 <p> 的行框內（button.bottom <= p.bottom ＋ button.top >= p.top）
//   ⑤ 整頁沒有多出水平捲動（scrollWidth 不變）
//   ⑥ ⭐ 正對照：故意給關閉鈕 padding:6px 12px 的變體**必須**量出位移（證明量測器不是恆真）
//
// 四種尺寸：375×812（站長回報的手機）／390×844／412×915／1366×768。
//
// 用法：node scripts/measure-v6299-warn-close.mjs [path/to/+page.svelte]
//   需要 playwright（PLAYWRIGHT_MODULE 可指定；PW_CHANNEL 預設 chromium-headless-shell）。
//   結果 JSON 寫到 MEASURE_OUT（預設 /tmp/measure-v6299.json）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = process.argv[2] || join(ROOT, 'src/routes/game/+page.svelte');
const SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const src = readFileSync(PAGE, 'utf8');
const sStart = src.lastIndexOf('<style');
const css = src.slice(src.indexOf('>', sStart) + 1, src.lastIndexOf('</style>')).replace(/:global\(([^)]*)\)/g, '$1');

/** 出貨碼裡那一則錯誤訊息長什麼樣（伺服器字串 ＋ tApi 的組法），不手抄。 */
function shippedErrorText() {
  const srv = readFileSync(SRV, 'utf8');
  const m = /res\.status\((\d+)\)\.json\(\{ error: '(目前不在報名階段)' \}\)/.exec(srv);
  if (!m) throw new Error('抽不到伺服器的 409 字串 —— 量測器瞎了');
  const fmt = /new Error\(`\$\{res\.status\}: \$\{\(await res\.text\(\)\)\.slice\(0, 160\)\}`\)/.test(src);
  if (!fmt) throw new Error('抽不到 tApi 的錯誤訊息格式 —— 量測器瞎了');
  return m[1] + ': {"error":"' + m[2] + '"}';
}

/** 出貨碼裡關閉鈕的 class／文字，不手抄。 */
function shippedCloseBtn() {
  const m = /<button class="(warn-x)"[^]*?>(✕)<\/button>/.exec(src);
  if (!m) throw new Error('抽不到關閉鈕 —— 量測器瞎了（是不是還沒實作？）');
  return { cls: m[1], text: m[2] };
}

const ERR = shippedErrorText();
const BTN = shippedCloseBtn();

const VARIANTS = {
  // v6.298：沒有關閉鈕
  before: '',
  // 本版
  after: `<button class="${BTN.cls}" type="button" aria-label="關閉這則訊息" title="關閉">${BTN.text}</button>`,
  // ⭐ 正對照：故意做一顆「會位移」的關閉鈕（有 padding、字級變大）
  control: `<button class="${BTN.cls}" style="padding:6px 12px;font-size:1.6rem;border:2px solid red;" type="button">${BTN.text}</button>`,
};

/** ⭐ 誠實面：本站最長的一則錯誤訊息（補報名失敗那條的完整樣子），拿來看「會不會多推一行」。 */
const ERR_LONG = '補報名失敗：連線逾時（12 秒沒有回應）—— 請確認網路後再試一次';

const fixture = (variant, msg) => `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --safe-top: 0px; }
  html, body { margin:0; padding:0; background:#101810; color:#f0f0f0;
    font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif; font-size:16px; }
${css}
</style></head><body>
<main class="lobby tourn-lobby">
  <div class="tourn-topbar" id="m-top"><a class="tourn-home-btn" href="#">← 回到首頁</a></div>
  <h1 class="lobby-title" id="m-title">🏆 錦標賽對戰</h1>
  <p class="tourn-who" id="m-who">已登入：<b>player@example.com</b> <button class="tourn-logout">登出</button></p>
  <div class="tourn-tabs" role="tablist" id="m-tabs">
    <button class="tourn-tab active" role="tab">🏆 賽事</button>
    <button class="tourn-tab" role="tab">📊 排行榜</button>
    <button class="tourn-tab" role="tab">🪪 個人資料</button>
    <button class="tourn-tab" role="tab">👥 好友</button>
  </div>
  <div class="tourn-tab-panel" id="m-panel">
    <div class="tourn-lb-title">📋 賽事清單</div>
    <div class="tourn-lb-empty">目前沒有開放中的賽事</div>
  </div>
  <p class="warn" id="m-warn">${msg}${variant}</p>
</main>
</body></html>`;

const SIZES = [
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '1366x768', width: 1366, height: 768 },
];
const ABOVE = ['m-top', 'm-title', 'm-who', 'm-tabs', 'm-panel'];

const browser = await chromium.launch(
  process.env.PW_EXEC
    ? { executablePath: process.env.PW_EXEC, args: ['--no-sandbox'] }
    : { channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });

const round = (v) => Math.round(v * 1000) / 1000;

async function measure(page, variant, msg = ERR) {
  await page.setContent(fixture(VARIANTS[variant], msg), { waitUntil: 'load' });
  return await page.evaluate((ids) => {
    const r = (el) => { const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    const out = { above: {}, scrollWidth: document.documentElement.scrollWidth };
    for (const id of ids) { const el = document.getElementById(id); if (el) out.above[id] = r(el); }
    const p = document.getElementById('m-warn');
    out.warn = r(p);
    out.warnStyle = { lineHeight: getComputedStyle(p).lineHeight, fontSize: getComputedStyle(p).fontSize };
    // 文字節點（第一個 child node）的 client rects —— 訊息文字有沒有被推動 / 換行
    const tn = p.firstChild;
    const rg = document.createRange(); rg.selectNodeContents(tn);
    out.textRects = [...rg.getClientRects()].map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height }));
    const btn = p.querySelector('button');
    out.btn = btn ? r(btn) : null;
    return out;
  }, ABOVE);
}

const results = {};
const page = await browser.newPage();
for (const s of SIZES) {
  await page.setViewportSize({ width: s.width, height: s.height });
  const before = await measure(page, 'before');
  const after = await measure(page, 'after');
  const control = await measure(page, 'control');
  // ⭐ 誠實面：本站最長那則訊息（會換行）加上關閉鈕，行數／高度會不會變
  const longBefore = await measure(page, 'before', ERR_LONG);
  const longAfter = await measure(page, 'after', ERR_LONG);

  const diffs = {};
  for (const id of ABOVE) {
    const a = before.above[id], b = after.above[id];
    diffs[id] = { dx: round(b.x - a.x), dy: round(b.y - a.y), dw: round(b.w - a.w), dh: round(b.h - a.h) };
  }
  const warnDiff = { dx: round(after.warn.x - before.warn.x), dy: round(after.warn.y - before.warn.y),
    dw: round(after.warn.w - before.warn.w), dh: round(after.warn.h - before.warn.h) };
  const ctlWarnDiff = { dx: round(control.warn.x - before.warn.x), dy: round(control.warn.y - before.warn.y),
    dw: round(control.warn.w - before.warn.w), dh: round(control.warn.h - before.warn.h) };
  const textSame = before.textRects.length === after.textRects.length
    && before.textRects.every((r, i) => round(r.x - after.textRects[i].x) === 0 && round(r.y - after.textRects[i].y) === 0
      && round(r.w - after.textRects[i].w) === 0 && round(r.h - after.textRects[i].h) === 0);
  const ctlTextSame = before.textRects.length === control.textRects.length
    && before.textRects.every((r, i) => round(r.x - control.textRects[i].x) === 0 && round(r.y - control.textRects[i].y) === 0);
  results[s.name] = {
    above: diffs, warnDiff, ctlWarnDiff, textSame, ctlTextSame,
    beforeTextLines: before.textRects.length, afterTextLines: after.textRects.length,
    warnBox: before.warn, warnStyle: before.warnStyle,
    btn: after.btn, btnInsideLine: after.btn ? (after.btn.top >= after.warn.top - 0.01 && after.btn.bottom <= after.warn.bottom + 0.01) : null,
    scrollWidth: { before: before.scrollWidth, after: after.scrollWidth },
    long: { lines: [longBefore.textRects.length, longAfter.textRects.length],
      dh: round(longAfter.warn.h - longBefore.warn.h) },
  };
}
await browser.close();

let bad = 0;
console.log('\n訊息文字（從出貨碼實抽）：' + ERR);
console.log('關閉鈕（從出貨碼實抽）：class=' + BTN.cls + ' text=' + BTN.text + '\n');
for (const [name, r] of Object.entries(results)) {
  console.log('── ' + name + ' ' + '─'.repeat(60));
  for (const [id, d] of Object.entries(r.above)) {
    const ok = d.dx === 0 && d.dy === 0 && d.dw === 0 && d.dh === 0;
    if (!ok) bad++;
    console.log('   ' + (ok ? '✓' : '✗') + ' ' + id.padEnd(10)
      + ' dx=' + d.dx + ' dy=' + d.dy + ' dw=' + d.dw + ' dh=' + d.dh);
  }
  const wOk = r.warnDiff.dx === 0 && r.warnDiff.dy === 0 && r.warnDiff.dw === 0 && r.warnDiff.dh === 0;
  if (!wOk) bad++;
  console.log('   ' + (wOk ? '✓' : '✗') + ' p.warn     dx=' + r.warnDiff.dx + ' dy=' + r.warnDiff.dy
    + ' dw=' + r.warnDiff.dw + ' dh=' + r.warnDiff.dh
    + '   （盒子 ' + round(r.warnBox.w) + '×' + round(r.warnBox.h) + '，line-height ' + r.warnStyle.lineHeight + '）');
  if (!r.textSame) bad++;
  console.log('   ' + (r.textSame ? '✓' : '✗') + ' 訊息文字 client rects 全等（行數 '
    + r.beforeTextLines + ' → ' + r.afterTextLines + '）');
  if (r.btnInsideLine !== true) bad++;
  console.log('   ' + (r.btnInsideLine ? '✓' : '✗') + ' 關閉鈕落在同一個行框內  btn '
    + round(r.btn.w) + '×' + round(r.btn.h) + ' @ x=' + round(r.btn.x));
  const sOk = r.scrollWidth.before === r.scrollWidth.after;
  if (!sOk) bad++;
  console.log('   ' + (sOk ? '✓' : '✗') + ' 無水平溢出 scrollWidth ' + r.scrollWidth.before + ' → ' + r.scrollWidth.after);
  console.log('   ℹ [誠實面] 最長那則訊息（會換行）加上關閉鈕：行數 ' + r.long.lines[0] + ' → '
    + r.long.lines[1] + '，<p> 高度差 ' + r.long.dh + 'px（訊息本身在頁尾、下方沒有任何元素）');
  const ctlMoved = !(r.ctlWarnDiff.dh === 0 && r.ctlTextSame);
  if (!ctlMoved) bad++;
  console.log('   ' + (ctlMoved ? '✓' : '✗') + ' [正對照] 有 padding 的關閉鈕**確實**量得出位移 dh='
    + r.ctlWarnDiff.dh + ' 文字全等=' + r.ctlTextSame);
}
const out = process.env.MEASURE_OUT || '/tmp/measure-v6299.json';
writeFileSync(out, JSON.stringify({ err: ERR, btn: BTN, results }, null, 2));
console.log('\n結果寫到 ' + out);
if (bad) { console.log('❌ ' + bad + ' 項不符'); process.exit(1); }
console.log('✅ 全部尺寸零位移，且正對照有量到位移（量測器不是恆真）');
