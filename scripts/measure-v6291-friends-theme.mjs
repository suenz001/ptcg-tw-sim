// v6.291 /friends 頁墨綠配色＋分頁列的版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）。
//
// 做法：把 src/routes/friends/+page.svelte 與 DmPanel.svelte 的 <style> 區**整段原樣**抽出，
//   加上 <svelte:head> 注入的那一行 html/body 底色，灌進一個靜態 fixture（markup 依兩個 svelte 檔的 class 結構手寫，
//   含長暱稱、二次確認列、四區、私聊面板 desktop／mobile 兩個分支）。Svelte 的 CSS scoping 只是在 selector 後面加 hash class，
//   去掉 scoping 後對同一份 markup 版面完全等價 ⇒ 這裡量到的就是正式站的版面。
//
// 量什麼（每個 viewport 各一份 JSON）：
//   bodyBg          computed background-color 必須是 rgb(22, 40, 22)（#162816）
//   overflowX       document.scrollingElement.scrollWidth <= clientWidth（沒有橫向破版）
//   tabsSameRow     兩顆分頁鈕 top 相同、都在 main 內、寬度各佔一半左右
//   rowsInside      每一列 .row／.tourn-tab／.add 都沒有超出 main 的左右邊
//   dmInside        私聊面板（desktop：右下角 360px；mobile：inset:0）都在 viewport 內
//   contrast        幾組「文字／底」的 WCAG 對比率（淡字 #7a9a7a on #162816、#9fdca0 on #102010、#eaf5ea on #142414 …）
//
// 用法：node scripts/measure-v6291-friends-theme.mjs [outDir]
//   需要 chromium headless shell（CHROME 環境變數可指定；預設找 ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell）。
//   沙盒缺 libXdamage 時：LD_LIBRARY_PATH 指向解出來的 libXdamage.so.1。截圖與 JSON 寫到 outDir（預設 /tmp/measure-v6291）。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { styleEndIndex } from './lib/svelte-style-block.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] || '/tmp/measure-v6291';
mkdirSync(OUT, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(base)) throw new Error('找不到 chromium：設 CHROME=/path/to/headless_shell');
  const d = readdirSync(base).find((x) => x.startsWith('chromium_headless_shell-'));
  if (!d) throw new Error('找不到 chromium_headless_shell-*：設 CHROME=');
  return join(base, d, 'chrome-linux/headless_shell');
}
const CHROME = findChrome();

const PAGE = readFileSync(join(ROOT, 'src/routes/friends/+page.svelte'), 'utf8');
const PANEL = readFileSync(join(ROOT, 'src/routes/friends/DmPanel.svelte'), 'utf8');
function styleOf(src) {
  const i = src.lastIndexOf('\n<style>\n');
  const j = styleEndIndex(src);
  if (i < 0 || j < i) throw new Error('抽不到 <style>');
  return src.slice(i + 9, j).replace(/:global\(([^)]*)\)/g, '$1');
}
const headInject = /\{@html '(<style>[^']*<\/style>)'\}/.exec(PAGE);
if (!headInject) throw new Error('抽不到 <svelte:head> 的底色注入');
const CSS_PAGE = styleOf(PAGE), CSS_PANEL = styleOf(PANEL);

const LONG = 'VeryLongNicknameWithoutAnySpaceAtAll_0123456789_abcdefghijklmnopqrstuvwxyz';
function row(nick, meta, buttons) {
  return `<li class="row" data-m="row"><span class="nick">${nick}</span><span class="meta">${meta}</span><span class="spacer"></span>${buttons}</li>`;
}
function pageHtml({ dm }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${headInject[1]}
<style>${CSS_PAGE}</style><style>${CSS_PANEL}</style>
<style>body{font-family:system-ui,sans-serif}</style>
</head><body>
<main id="main">
  <header class="page-head">
    <a href="#" class="back">← 首頁</a>
    <h1>👥 好友 <span class="version-tag">v6.291</span></h1>
    <a href="#" class="to-game">線上對戰 →</a>
  </header>
  <nav class="tourn-tabs" aria-label="線上功能" id="tabs">
    <a class="tourn-tab" href="#" data-m="tab">🌐 線上連線對戰</a>
    <a class="tourn-tab active" href="#" aria-current="page" data-m="tab">👥 好友名單</a>
  </nav>
  <p class="warn">目前顯示的是上一次讀到的名單，更新中…</p>
  <section class="add" data-m="add">
    <h2>用 email 加好友</h2>
    <p class="hint">輸入對方登入本站用的 email，對方確認後就會成為好友。對方不會看到這裡輸入的 email，名單上只顯示暱稱。</p>
    <form class="add-form"><input type="email" placeholder="對方的 email" /><button class="primary" type="button">送出邀請</button></form>
    <p class="ok">邀請已送出，請等待對方確認。</p>
    <p class="error">這是錯誤訊息的樣子。</p>
  </section>
  <section class="group">
    <h2>好友 <span class="count">3 / 100</span></h2>
    <p class="hint">私聊功能尚未開放。</p>
    <ul class="rows">
      ${row('小智', '對戰中加入・2026-09-01', '<button class="small dm-open">💬 私聊</button><button class="small">解除好友</button><button class="small danger">封鎖</button>')}
      ${row(LONG, '以 email 加入・2026-08-30', '<button class="small dm-open">💬 私聊</button><button class="small">解除好友</button><button class="small danger">封鎖</button>')}
      ${row('小霞', '', '<span class="confirm">確定解除好友？雙方名單都會移除，和這位好友的私聊對話也會一起刪除，無法復原。</span><button class="small danger">確定解除</button><button class="small">取消</button>')}
    </ul>
  </section>
  <section class="group">
    <h2>待我確認 <span class="count">1</span></h2>
    <ul class="rows">${row('小剛', '對戰中加入・2026-09-02', '<button class="small primary">接受</button><button class="small">拒絕</button><button class="small danger">封鎖</button>')}</ul>
  </section>
  <section class="group">
    <h2>我送出的邀請 <span class="count">0</span></h2>
    <p class="empty">沒有等待中的邀請。</p>
  </section>
  <section class="group">
    <h2>已封鎖 <span class="count">1</span></h2>
    <ul class="rows">${row('壞人', '2026-08-01', '<button class="small">解除封鎖</button>')}</ul>
  </section>
  <p class="notice">好友功能需要以 <b>email 帳號</b>登入才能使用。<a href="#">www.ptcg-tw-sim.com/friends</a></p>
  ${dm ? `
  <section class="dm-panel ${dm}" id="dm" aria-label="私聊">
    <header class="dm-head"><span class="dm-title">💬 <span class="dm-nick">${LONG}</span></span><span class="dm-slow">已放慢更新</span><button class="dm-close" type="button">✕</button></header>
    <div class="dm-list">
      <button class="dm-more" type="button">載入更早的訊息</button>
      <div class="dm-msg theirs"><span class="dm-bubble">嗨，晚點打一場？</span><span class="dm-ts">09/03 10:12</span></div>
      <div class="dm-msg mine"><span class="dm-bubble">好啊，${LONG}</span><span class="dm-ts">09/03 10:13</span></div>
      <div class="dm-msg theirs"><span class="dm-bubble">多行\n訊息\n測試</span><span class="dm-ts">09/03 10:14</span></div>
    </div>
    <p class="dm-notice">這是提示列。</p>
    <form class="dm-form"><input type="text" placeholder="輸入訊息（最多 200 字）" /><button class="dm-send" type="button">送出</button></form>
  </section>` : ''}
</main>
<pre id="m" style="display:none"></pre>
<script>
(function(){
  const r=(el)=>{const b=el.getBoundingClientRect();return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height)};};
  const main=r(document.getElementById('main'));
  const inside=(b)=>b.l>=main.l-1&&b.r<=main.r+1;
  const out={viewport:{w:innerWidth,h:innerHeight},bodyBg:getComputedStyle(document.body).backgroundColor,htmlBg:getComputedStyle(document.documentElement).backgroundColor,
    scrollWidth:document.scrollingElement.scrollWidth,clientWidth:document.scrollingElement.clientWidth,main,tabs:[],rowsOutside:[],dm:null,contrast:{}};
  document.querySelectorAll('[data-m="tab"]').forEach((e)=>out.tabs.push(r(e)));
  document.querySelectorAll('[data-m="row"],[data-m="add"],[data-m="tab"]').forEach((e,i)=>{const b=r(e);if(!inside(b))out.rowsOutside.push({i,b});});
  document.querySelectorAll('.nick').forEach((e)=>{const b=r(e);if(b.r>main.r+1)out.rowsOutside.push({nick:true,b});});
  const dm=document.getElementById('dm');
  if(dm){const b=r(dm);out.dm={b,inside:b.l>=0&&b.t>=0&&b.r<=innerWidth&&b.b<=innerHeight,bg:getComputedStyle(dm).backgroundColor};
    const inp=dm.querySelector('.dm-form input');const ib=r(inp);out.dm.inputInside=ib.r<=b.r&&ib.b<=b.b;}
  const lum=(hex)=>{const c=hex.replace('#','');const f=(i)=>{let v=parseInt(c.substr(i,2),16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(0)+0.7152*f(2)+0.0722*f(4);};
  const cr=(a,b)=>{const x=lum(a),y=lum(b);return Math.round(((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05))*100)/100;};
  out.contrast={'#7a9a7a/#162816 (淡字/頁底)':cr('#7a9a7a','#162816'),'#7a9a7a/#142414 (淡字/卡片)':cr('#7a9a7a','#142414'),'#9fdca0/#102010 (鈕字/鈕底)':cr('#9fdca0','#102010'),
    '#eaf5ea/#142414 (正文/卡片)':cr('#eaf5ea','#142414'),'#ffd35a/#142414 (標題金/卡片)':cr('#ffd35a','#142414'),'#cfe8cf/#142414 (標籤/卡片)':cr('#cfe8cf','#142414'),
    '#ff8866/#162816 (錯誤/頁底)':cr('#ff8866','#162816'),'#ff9b9b/#102010 (危險鈕字/鈕底)':cr('#ff9b9b','#102010'),'#eaffea/#2a5a3a (自己氣泡)':cr('#eaffea','#2a5a3a'),'#eaf5ea/#1d3a1d (對方氣泡)':cr('#eaf5ea','#1d3a1d')};
  document.getElementById('m').textContent=JSON.stringify(out);
})();
</script></body></html>`;
}

const scenes = [
  { name: 'mobile-375x812', w: 375, h: 812, dm: null },
  { name: 'mobile-375x812-dm', w: 375, h: 812, dm: 'mobile' },
  { name: 'mobile-412x915', w: 412, h: 915, dm: null },
  { name: 'desktop-1366x768', w: 1366, h: 768, dm: null },
  { name: 'desktop-1366x768-dm', w: 1366, h: 768, dm: 'desktop' },
  { name: 'desktop-1920x1080-dm', w: 1920, h: 1080, dm: 'desktop' },
];
const results = {};
for (const sc of scenes) {
  const html = join(OUT, sc.name + '.html');
  writeFileSync(html, pageHtml({ dm: sc.dm }));
  const args = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=' + sc.w + ',' + sc.h];
  const dom = execFileSync(CHROME, [...args, '--dump-dom', 'file://' + html], { maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  const m = /<pre id="m" style="display:none">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) throw new Error(sc.name + '：量測結果沒寫出來');
  const j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  execFileSync(CHROME, [...args, '--screenshot=' + join(OUT, sc.name + '.png'), 'file://' + html], { stdio: ['ignore', 'ignore', 'ignore'] });
  const verdict = {
    bodyBgOk: j.bodyBg === 'rgb(22, 40, 22)' && j.htmlBg === 'rgb(22, 40, 22)',
    noOverflowX: j.scrollWidth <= j.clientWidth,
    tabsSameRow: j.tabs.length === 2 && j.tabs[0].t === j.tabs[1].t && Math.abs(j.tabs[0].w - j.tabs[1].w) <= 8,
    rowsInside: j.rowsOutside.length === 0,
    dmInside: sc.dm ? (j.dm && j.dm.inside && j.dm.inputInside && j.dm.bg === 'rgb(20, 36, 20)') : null,
  };
  results[sc.name] = { ...j, verdict };
  const ok = Object.values(verdict).every((v) => v === true || v === null);
  console.log((ok ? 'OK   ' : 'FAIL ') + sc.name.padEnd(24) + JSON.stringify(verdict) + '  tabs=' + JSON.stringify(j.tabs) + (sc.dm ? '  dm=' + JSON.stringify(j.dm.b) : ''));
}
console.log('\n對比率（WCAG，≥4.5 為 AA 正文、≥3 為大字/UI）：');
for (const [k, v] of Object.entries(results['desktop-1366x768'].contrast)) console.log('  ' + (v >= 4.5 ? 'AA  ' : v >= 3 ? 'ui  ' : 'LOW ') + v.toFixed(2).padStart(6) + '  ' + k);
writeFileSync(join(OUT, 'measure-v6291.json'), JSON.stringify(results, null, 2));
console.log('\n截圖與 JSON 在 ' + OUT);
