// v6.304 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）—— 本版版面重構的「框架安全」證據。
//
// 做法沿用 scripts/measure-v6297-tourn-tabs.mjs／measure-v6303-ui-batch.mjs：
//   把出貨的 <style> 區段**整段原樣**抽出（:global(X) → X），灌進靜態 fixture，
//   用**同樣的 class 結構**擺出「舊版面（賽事卡全部在前、賽程表全部在後）」與
//   「新版面（依賽事分組）」兩張畫面，逐塊量 getBoundingClientRect() 相減。
//
// 三尺寸：375×812 ／ 390×844 ／ 1366×768（站長指定）。
//
// 斷言：
//   ① ⭐ 每一塊（賽事卡／積分表／賽程表）自己的 **width／height 與舊版完全相同**
//      —— 只有 y 位置變、寬高不變（重排不得改變任何一塊的尺寸）。
//   ② ⭐⭐ 左右邊界對齊：同一場的三塊，left 與 right 三者必須一致
//      （v6.298 的教訓：「既有元素零位移」不等於「新排版有對齊」）。
//   ③ 無重疊：新版面裡任兩塊在垂直方向不得交疊。
//   ④ 無水平溢出：documentElement.scrollWidth ≤ clientWidth。
//   ⑤ ⭐ 分組正確：DOM 上每一張賽事卡的正下方就是自己的積分表與賽程表（用 y 排序驗）。
//
// 用法：node scripts/measure-v6304-tourn-group.mjs
//   需要 playwright（PLAYWRIGHT_MODULE 可指定；PW_CHANNEL 預設 chromium-headless-shell）。
//   結果 JSON 寫到 MEASURE_OUT（預設 /tmp/measure-v6304.json）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_MODULE || 'playwright');

const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
/** 抽出 <style> 區段（最後一個），並把 :global(X) 攤平成 X，好灌進靜態 fixture。 */
function styleOf(src) {
  const s = src.lastIndexOf('<style');
  const out = src.slice(src.indexOf('>', s) + 1, src.lastIndexOf('</style>')).replace(/:global\(([^)]*)\)/g, '$1');
  if (out.length < 50000) throw new Error('抽不到 <style>（只有 ' + out.length + ' 字元）');
  return out;
}
const CSS = styleOf(rd(P_GAME));

let bad = 0;
const ok = (cond, msg, extra) => {
  if (!cond) { bad++; console.log('  ✗ ' + msg + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
  else console.log('  ✓ ' + msg);
};
const table = [];
const HEAD = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}html,body{margin:0;background:#162816;}</style>
<style>${CSS}</style></head><body>`;

// ── 三種區塊的 markup（class 結構照抄出貨碼）──────────────────────────────
const evCard = (id) => `<div class="tourn-event" id="ev-${id}" data-kind="event" data-id="${id}">
  <div class="tourn-ev-head tourn-fold-toggle" role="button" tabindex="0"><span class="tourn-fold-arrow">▾</span><h3>🏆 ${id} 盃</h3></div>
  <p class="tourn-evstat">狀態：<b>進行中</b> ｜ 報名 8 / 16 人 ｜ 瑞士制 + Top Cut Bo1 ｜ 每場 20 分</p>
</div>`;
const stTable = (id) => `<div class="tourn-bracket" id="st-${id}" data-kind="standings" data-id="${id}">
  <div class="tourn-bracket-head tourn-fold-toggle" role="button" tabindex="0"><span class="tourn-fold-arrow">▾</span>📊 ${id} 盃 瑞士制排名 ｜ 第 2/4 輪</div>
  <div style="display:grid;grid-template-columns:34px 1fr 60px 48px 60px;gap:3px 8px;font-size:13px;align-items:center;padding:4px 2px;">
    <div style="font-weight:700;color:#9ab;text-align:center;">#</div><div style="font-weight:700;color:#9ab;">玩家</div><div style="font-weight:700;color:#9ab;text-align:center;">戰績</div><div style="font-weight:700;color:#9ab;text-align:center;">OWP</div><div style="font-weight:700;color:#9ab;text-align:center;">OOWP</div>
    <div style="text-align:center;">1</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">阿樹</div><div style="text-align:center;">2-0</div><div style="text-align:center;color:#9ab;">62%</div><div style="text-align:center;color:#9ab;">55%</div>
    <div style="text-align:center;">2</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">小霞</div><div style="text-align:center;">1-1</div><div style="text-align:center;color:#9ab;">50%</div><div style="text-align:center;color:#9ab;">48%</div>
  </div>
</div>`;
const bkTable = (id) => `<div class="tourn-bracket" id="mt-${id}" data-kind="matches" data-id="${id}">
  <div class="tourn-bracket-head tourn-fold-toggle" role="button" tabindex="0"><span class="tourn-fold-arrow">▾</span>📋 ${id} 盃 賽程表</div>
  <div class="tourn-bracket-pager"><button class="tourn-pg-btn">◀ 上一輪</button><span class="tourn-pg-title">瑞士第 2 輪<span class="tourn-pg-cur"> 進行中</span></span><button class="tourn-pg-btn">下一輪 ▶</button></div>
  <div class="tourn-round">
    <div class="tourn-match"><span class="tm-side tm-p1">阿樹</span><span class="tm-vs">VS</span><span class="tm-side tm-p2">小霞</span></div>
    <div class="tourn-match"><span class="tm-side tm-p1">小智</span><span class="tm-vs">VS</span><span class="tm-side tm-p2">小剛</span></div>
  </div>
</div>`;

/** 資料情境：A（有卡有賽程）、B（只有賽事卡）、C（孤兒＝只有賽程）。 */
const EV_IDS = ['A', 'B'];        // A 有賽程、B 沒有
const ORPHAN = 'Z';
/** 舊版面（BASE v6.303 的順序）：所有賽事卡在前、所有賽程表在後。 */
const htmlOld = () => HEAD + `<main class="lobby tourn-lobby">
${evCard('A')}${evCard('B')}
${stTable('A')}${bkTable('A')}${stTable(ORPHAN)}${bkTable(ORPHAN)}
</main></body></html>`;
/** 新版面（v6.304）：依賽事分組，孤兒補在最後。 */
const htmlNew = () => HEAD + `<main class="lobby tourn-lobby">
${evCard('A')}${stTable('A')}${bkTable('A')}${evCard('B')}
${stTable(ORPHAN)}${bkTable(ORPHAN)}
</main></body></html>`;

const PROBE = () => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) }; };
  const blocks = [...document.querySelectorAll('[data-kind]')].map((el) => ({
    key: el.dataset.kind + ':' + el.dataset.id, ...R(el),
  }));
  return { blocks, docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
};

const VPS = [
  { w: 375, h: 812, mobile: true, tag: '375×812' },
  { w: 390, h: 844, mobile: true, tag: '390×844' },
  { w: 1366, h: 768, mobile: false, tag: '1366×768' },
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
try {
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const pg = await ctx.newPage();
    console.log('\n────────── ' + vp.tag + ' ──────────');
    await pg.setContent(htmlOld(), { waitUntil: 'load' });
    const oldR = await pg.evaluate(PROBE);
    await pg.setContent(htmlNew(), { waitUntil: 'load' });
    const newR = await pg.evaluate(PROBE);
    const O = Object.fromEntries(oldR.blocks.map((b) => [b.key, b]));
    const N = Object.fromEntries(newR.blocks.map((b) => [b.key, b]));

    console.log('  新版面（依 y 排序）：');
    for (const b of [...newR.blocks].sort((a, c) => a.y - c.y)) {
      console.log('    ' + b.key.padEnd(14) + ' y=' + String(b.y).padStart(8) + '  left=' + b.x + '  right=' + b.right + '  w=' + b.w + '  h=' + b.h);
    }
    table.push({ vp: vp.tag, old: oldR.blocks, now: newR.blocks });

    // ① 每一塊自己的寬高與舊版完全相同（只有 y 變）
    for (const k of Object.keys(N)) {
      ok(!!O[k], '① 舊版面也有 ' + k + '（對照組完整）');
      if (!O[k]) continue;
      ok(N[k].w === O[k].w, '① ' + k + ' 寬度不變（' + O[k].w + ' → ' + N[k].w + '）');
      ok(N[k].h === O[k].h, '① ' + k + ' 高度不變（' + O[k].h + ' → ' + N[k].h + '）');
      ok(N[k].x === O[k].x, '① ' + k + ' 左邊界不變（' + O[k].x + ' → ' + N[k].x + '）');
    }
    // ② 三塊左右邊界對齊
    const lefts = [...new Set(newR.blocks.map((b) => b.x))];
    const rights = [...new Set(newR.blocks.map((b) => b.right))];
    ok(lefts.length === 1, '② ⭐⭐ 賽事卡／積分表／賽程表的 left 完全一致（' + JSON.stringify(lefts) + '）');
    ok(rights.length === 1, '② ⭐⭐ 三塊的 right 完全一致（' + JSON.stringify(rights) + '）');
    // ③ 無重疊
    const sorted = [...newR.blocks].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      ok(sorted[i].y >= sorted[i - 1].bottom - 0.01,
        '③ ' + sorted[i - 1].key + ' 與 ' + sorted[i].key + ' 沒有重疊',
        { prevBottom: sorted[i - 1].bottom, y: sorted[i].y });
    }
    // ④ 無水平溢出
    ok(newR.docScrollW <= newR.docClientW, '④ 整頁無水平溢出', { scrollW: newR.docScrollW, clientW: newR.docClientW });
    // ⑤ 分組正確：依 y 排序後的順序就是「A 卡 → A 積分 → A 賽程 → B 卡 → 孤兒積分 → 孤兒賽程」
    ok(sorted.map((b) => b.key).join(' → ')
      === 'event:A → standings:A → matches:A → event:B → standings:Z → matches:Z',
      '⑤ ⭐ 版面由上而下的順序就是「賽事卡→自己的積分表→自己的賽程表」，孤兒排最後',
      sorted.map((b) => b.key));
    await ctx.close();
  }
} finally { await browser.close(); }

writeFileSync(process.env.MEASURE_OUT || '/tmp/measure-v6304.json', JSON.stringify(table, null, 1));
console.log('\n══ v6.304 賽事分組版面量測：' + (bad ? bad + ' 項不符 ✗' : '全部符合 ✓') + ' ══');
process.exit(bad ? 1 : 0);
