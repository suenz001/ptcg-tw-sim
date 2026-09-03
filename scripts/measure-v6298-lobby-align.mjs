// v6.298 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）
//
// 站長回報：「線上連線對戰的版面歪掉了，沒有對齊（好友名單分頁則是正常）」。
// 這支腳本用**真的瀏覽器**量三個並排兄弟元素的 getBoundingClientRect().left / .right：
//   ① .lobby-tabs                 （v6.296 新增的分頁列）
//   ② .online-form.lobby-unified  （線上分頁的內容；既有版面，站長的紅線＝不可位移）
//   ③ .lobby-tab-panel            （好友分頁的內容；v6.296 新增）
// 三者都是 <main class="lobby"> 的直接子元素 ⇒ 同一個 containing block ⇒ 左右邊界本來就該一致。
// 錦標賽側同樣量 .tourn-tabs vs .tourn-tab-panel（容器是 .lobby.tourn-lobby）。
//
// ⭐⭐ 另一個職責：**驗證 scripts/test-v6298-lobby-tab-align.mjs 的盒模型求解器**。
//   那支守衛在 npm test chain 裡（CI 沒有瀏覽器），用自寫的求解器算左右邊界；
//   求解器算錯就變安慰劑 ⇒ 這裡把求解器的數字與瀏覽器實測逐項對照，不一致就 exit 1（Rule 25）。
//
// 用法：node scripts/measure-v6298-lobby-align.mjs [path/to/+page.svelte]
//   需要 playwright（PLAYWRIGHT_MODULE 可指定；PW_CHANNEL 預設 chromium-headless-shell）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { solveLobbyRow, solveTournRow, extractStyle } from './test-v6298-lobby-tab-align.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = process.argv[2] || join(ROOT, 'src/routes/game/+page.svelte');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const src = readFileSync(PAGE, 'utf8');
const css = extractStyle(src).replace(/:global\(([^)]*)\)/g, '$1');

const doc = (body) => '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<style>:root{--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}html,body{margin:0;background:#0d1a12;}</style>'
  + '<style>' + css + '</style></head><body>' + body + '</body></html>';

const lobbyHtml = (tab) => `
<main class="lobby">
  <button class="back-btn">← 返回</button>
  <h1>🌐 線上連線對戰</h1>
  <div class="lobby-tabs" id="m-tabs" role="tablist">
    <button class="lobby-tab active">🌐 線上連線對戰</button>
    <button class="lobby-tab">👥 好友名單</button>
  </div>
  ${tab === 'online' ? `<div class="online-form lobby-unified" id="m-online">
    <label class="name-row"><span class="name-label">玩家名稱</span><input class="name-input" value="測試玩家" /></label>
    <div class="open-rooms-section"><h3>🌐 等待中的房間（0）</h3></div>
  </div>` : `<div class="lobby-tab-panel" id="m-friends">
    <div class="fr-panel embed"><p class="hint">好友名單</p><div class="notice">尚無好友。</div></div>
  </div>`}
</main>`;

const tournHtml = () => `
<main class="lobby tourn-lobby">
  <p class="tourn-who">已登入：<b>a@b.co</b></p>
  <div class="tourn-tabs" id="t-tabs" role="tablist">
    <button class="tourn-tab active">🏆 賽事</button><button class="tourn-tab">📊 排行榜</button>
    <button class="tourn-tab">🪪 個人資料</button><button class="tourn-tab">👥 好友</button>
  </div>
  <div class="tourn-tab-panel" id="t-panel">
    <div class="fr-panel embed"><p class="hint">好友名單</p><div class="notice">尚無好友。</div></div>
  </div>
</main>`;

const probe = async (pg, html, ids) => {
  await pg.setContent(html, { waitUntil: 'load' });
  return pg.evaluate((wanted) => {
    const out = {};
    for (const id of wanted) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[id] = { left: +r.left.toFixed(2), right: +r.right.toFixed(2), width: +r.width.toFixed(2) };
    }
    return out;
  }, ids);
};

const VPS = [
  { w: 375, h: 812, mobile: true, tag: '375×812 手機直式' },
  { w: 390, h: 844, mobile: true, tag: '390×844 手機直式' },
  { w: 1366, h: 768, mobile: false, tag: '1366×768 桌機' },
];

let bad = 0;
const ok = (cond, msg, extra) => {
  if (!cond) { bad++; console.log('  ✗ ' + msg + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
  else console.log('  ✓ ' + msg);
};

const results = [];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
try {
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const pg = await ctx.newPage();
    console.log('\n── ' + vp.tag + ' ──');

    const on = await probe(pg, doc(lobbyHtml('online')), ['m-tabs', 'm-online']);
    const fr = await probe(pg, doc(lobbyHtml('friends')), ['m-tabs', 'm-friends']);
    const tourn = await probe(pg, doc(tournHtml()), ['t-tabs', 't-panel']);

    const row = { vp: vp.tag, tabs: on['m-tabs'], online: on['m-online'], friends: fr['m-friends'],
      tabsInFriends: fr['m-tabs'], tTabs: tourn['t-tabs'], tPanel: tourn['t-panel'] };
    results.push(row);
    console.log('    分頁列   left=' + row.tabs.left + '  right=' + row.tabs.right + '  (w=' + row.tabs.width + ')');
    console.log('    線上分頁 left=' + row.online.left + '  right=' + row.online.right + '  (w=' + row.online.width + ')');
    console.log('    好友分頁 left=' + row.friends.left + '  right=' + row.friends.right + '  (w=' + row.friends.width + ')');
    console.log('    錦標賽 分頁列 left=' + row.tTabs.left + ' right=' + row.tTabs.right
      + ' ／ 分頁內容 left=' + row.tPanel.left + ' right=' + row.tPanel.right);

    ok(row.tabs.left === row.tabsInFriends.left && row.tabs.right === row.tabsInFriends.right, 'A 分頁列在兩個分頁下位置相同');
    ok(row.tabs.left === row.online.left, 'B1 分頁列.left ＝ 線上分頁.left', { tabs: row.tabs.left, online: row.online.left });
    ok(row.tabs.right === row.online.right, 'B2 分頁列.right ＝ 線上分頁.right', { tabs: row.tabs.right, online: row.online.right });
    ok(row.tabs.left === row.friends.left, 'B3 分頁列.left ＝ 好友分頁.left', { tabs: row.tabs.left, friends: row.friends.left });
    ok(row.tabs.right === row.friends.right, 'B4 分頁列.right ＝ 好友分頁.right', { tabs: row.tabs.right, friends: row.friends.right });
    ok(row.tTabs.left === row.tPanel.left, 'C1 錦標賽 分頁列.left ＝ 分頁內容.left', { a: row.tTabs.left, b: row.tPanel.left });
    ok(row.tTabs.right === row.tPanel.right, 'C2 錦標賽 分頁列.right ＝ 分頁內容.right', { a: row.tTabs.right, b: row.tPanel.right });

    // ⭐⭐ 求解器交叉驗證：守衛的盒模型求解器必須算出與瀏覽器**相同**的 left/right。
    const solved = solveLobbyRow(css, vp.w, vp.h);
    const solvedT = solveTournRow(css, vp.w, vp.h);
    const near = (a, b) => Math.abs(a - b) < 0.05;
    for (const [k, br] of [['tabs', row.tabs], ['online', row.online], ['panel', row.friends]])
      ok(near(solved[k].left, br.left) && near(solved[k].right, br.right), 'D 求解器 vs 瀏覽器：' + k, { solver: solved[k], browser: br });
    for (const [k, br] of [['tabs', row.tTabs], ['panel', row.tPanel]])
      ok(near(solvedT[k].left, br.left) && near(solvedT[k].right, br.right), 'D 求解器 vs 瀏覽器（錦標賽）：' + k, { solver: solvedT[k], browser: br });
    await ctx.close();
  }
} finally { await browser.close(); }

writeFileSync(process.env.MEASURE_OUT || '/tmp/measure-v6298.json', JSON.stringify(results, null, 1));
console.log('\n══ v6.298 分頁對齊量測：' + (bad ? bad + ' 項不符 ✗' : '全部符合 ✓') + ' ══');
process.exit(bad ? 1 : 0);
