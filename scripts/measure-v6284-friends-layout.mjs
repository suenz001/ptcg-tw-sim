// v6.284 版面量測工具（⚠ 不在 npm test chain：需要瀏覽器）—— 好友 P1b 三處新 UI 的「零位移」證據。
//
// 做法：把 src/routes/game/+page.svelte 的 <style> 區**整段原樣**抽出（Svelte 的 :global(X) 改成 X），
//   灌進一個靜態 fixture，用**同樣的 class 結構**擺出三個場景，各量「新增前／新增後」既有元素的
//   getBoundingClientRect()，逐一相減。Svelte 的 CSS scoping 只是在每個 selector 後面加 hash class，
//   對同一份 markup 去掉 scoping 後版面完全等價 ⇒ 這裡量到的就是正式站的版面（字型不同只影響絕對數字，
//   不影響「有沒有位移」這個結構性結論）。
//
// 場景：
//   L  線上大廳（onlineStep='join'）：手機直式 375×812／412×915 ＋ 桌機 1366×768，長／短 email 各一。
//      手機：新增「👥 好友名單」在 .lobby-unified **之後**（main.lobby 的最後一個節點）⇒ 既有元素（含容器）必須全部 dx=dy=dw=dh=0。
//      桌機：入口在 .auth-user（v6.283 已量：只有「登出」右移）—— 本版桌機不動，只當對照。
//   G  賽後結算 .gameover-modal：休閒／錦標賽兩種分支 × 手機直式 375×812／375×667 ＋ 桌機 1366×768／1920×1080。
//      新增「👥 將對手加為好友」在最後 ⇒ 允許整體上移（fixed 置中），但既有鈕**彼此**的相對位置不得變、
//      尺寸不得變、modal 不得超出畫面；「送出後換成狀態文字」必須同高、既有鈕列零位移。
//      ⚠ 三種桌機對戰版面（classic／tabletop／fable）共用同一段 modal markup 與 CSS，CSS 內沒有任何
//        .tablet-layout／fable 相關 selector 碰到 .gameover-modal（守衛 test-v6284 靜態釘住）⇒ 桌機只需量 viewport。
//   S  設定 .settings-modal（⚠ v6.284 未出貨；量「若放在最後一個 section」的後果）：markup 從 svelte 檔忠實抽出，
//      證明 .zoom-modal{overflow:hidden} 蓋掉 .settings-modal{overflow-y:auto} ⇒ 375×812／1366×768 對戰中已貼到 max-height，尾端會被切掉。
//
// 用法：node scripts/measure-v6284-friends-layout.mjs [path/to/+page.svelte]
//   需要 playwright（PLAYWRIGHT_MODULE=/path/to/node_modules/playwright 可指定；PW_CHANNEL 預設 chromium-headless-shell），
//   沙盒缺 libXdamage 時：LD_LIBRARY_PATH 指向解出來的 libXdamage.so.1。結果 JSON 寫到 MEASURE_OUT（預設 /tmp/measure-v6284.json）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = process.argv[2] || join(ROOT, 'src/routes/game/+page.svelte');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const src = readFileSync(PAGE, 'utf8');
const sStart = src.lastIndexOf('<style');
const css = src.slice(src.indexOf('>', sStart) + 1, src.lastIndexOf('</style>')).replace(/:global\(([^)]*)\)/g, '$1');

const BTN = (state) => state === 'idle'
  ? '<button class="btn-secondary" title="送出好友邀請">👥 將對手加為好友</button>'
  : '<button class="btn-secondary" disabled style="cursor:default">' + (state === 'busy' ? '⏳ 送出中…' : '✅ 邀請已送出，等待對方確認') + '</button>';

function lobbyHtml({ mobile, withNew, email }) {
  return `
<main class="lobby">
  <button class="back-btn" id="m-back">← 返回</button>
  <div class="auth-dashboard" id="m-dash">
    <span class="sync-pill sync-synced" id="m-pill">☁️ 已同步</span>
    <div class="auth-user" id="m-authuser">
      <span class="auth-email" id="m-email">✉️ ${email}</span>
      <button class="small" id="m-pw">🔑 更改密碼</button>
      ${!mobile ? '<button class="small" id="m-friends-desktop">👥 好友</button>' : ''}
      <button class="small danger" id="m-out">登出</button>
    </div>
  </div>
  <h1 id="m-h1">🌐 線上連線對戰</h1>
  <div class="online-form lobby-unified" id="m-form">
    <label class="name-row" id="m-name"><span class="name-label">玩家名稱</span><input class="name-input" placeholder="輸入你的名稱" value="測試玩家" /></label>
    <div class="create-room-block" id="m-create">
      <button class="btn-create-room-cta"><span class="cri-icon">🏠</span><span class="cri-text"><span class="cri-title">建立新房間</span><span class="cri-sub">產生房號等對手加入（可選練習 / 私密房）</span></span><span class="cri-chevron">▾</span></button>
    </div>
    <div class="open-rooms-section" id="m-wait">
      <h3>🌐 等待中的房間（1）</h3>
      <ul class="open-room-list"><li class="open-room-row" id="m-room1">
        <div class="or-main"><span class="or-host">🎮 測試房</span><button class="btn-sm primary or-act">加入</button></div>
        <div class="or-meta"><span class="or-host-name">🟢 房主：小明</span><span class="or-age">· 1 分鐘前</span><span class="or-code">房號 ABCD</span></div>
      </li></ul>
    </div>
    <div class="open-rooms-section" id="m-playing">
      <h3>👁 對戰中的房間（0）</h3>
      <p class="muted small">目前無進行中且開放觀戰的房間。</p>
    </div>
    <details class="manual-code" id="m-manual"><summary>🔑 用房號手動加入</summary></details>
  </div>
  ${(mobile && withNew) ? '<a class="back" href="#" id="m-friends-mobile" title="好友名單" style="margin-top:.6rem">👥 好友名單</a>' : ''}
</main>`;
}

function gameoverHtml({ withNew, state, branch }) {
  const branchHtml = branch === 'tournament'
    ? '<div class="lobby-btns" id="g-row2"><button class="btn-primary" id="g-b3">🏆 返回賽事大廳</button></div>'
    : `<div class="lobby-btns" id="g-row2"><button class="btn-primary" id="g-b3">🔁 再來一局</button><button class="btn-secondary" id="g-b4">離開房間</button></div>
       <a href="#" class="back-home-link" id="g-home">回首頁</a>`;
  return `
<div class="battle-root">
<div class="gameover-modal" id="g-modal" style="transform:translate(calc(-50% + 0px), calc(-50% + 0px))">
  <div class="gameover-modal-header" id="g-head"><span class="gameover-modal-drag-hint">☰ 拖曳移動</span></div>
  <div class="gameover-modal-body" id="g-body">
    <div class="gameover-icon win" id="g-icon">🏆</div>
    <h1 class="gameover-title win" id="g-title">Victory!</h1>
    <p class="winner-text" id="g-winner">測試玩家 獲勝！</p>
    <p class="muted" id="g-reason">對手的獎賞卡已全部拿完</p>
    <div class="lobby-btns export-btns" id="g-row1">
      <button class="btn-secondary" id="g-b1">📄 匯出 log（.txt）</button>
      <button class="btn-secondary" id="g-b2">🧾 匯出 log（.json）</button>
    </div>
    ${branchHtml}
    ${withNew ? '<div class="lobby-btns" id="g-friend-row">' + BTN(state).replace('<button', '<button id="g-friend"') + '</div>' : ''}
  </div>
</div>
</div>`;
}

function settingsHtml({ withNew, inGame, withBattleBtn }) {
  const sec = (id, title, open, body) => `<details class="settings-section" id="${id}"${open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  return `
<div class="zoom-overlay" id="s-overlay">
  <div class="zoom-modal settings-modal" id="s-modal">
    <button class="zoom-close" id="s-close">✕</button>
    <h3 class="settings-title" id="s-title">⚙️ 設定</h3>
    ${sec('s-bgm', '🎵 背景音樂 (BGM)', false, '')}
    ${sec('s-sfx', '🔊 遊戲音效 (SFX)', false, '')}
    ${sec('s-zoom', '🖥️ 畫面縮放', true, '<div class="setting-row"><label>縮放：</label><input type="range" /></div><div class="setting-hint">・若還是看到卡牌被切，可手動往下調</div>')}
    ${sec('s-layout', '🎴 對戰版面（測試）', false, '')}
    ${inGame ? sec('s-ctrl', '🎮 對局控制', true, '<div class="setting-row"><button class="toggle-btn restart-game-btn">🔄 提議重新開局</button></div><div class="setting-hint">連線對戰：需對手同意。可多次提議</div><div class="setting-row"><button class="toggle-btn restart-game-btn">🚪 提議返回房間</button></div><div class="setting-hint">雙方同意後回到房間選牌組介面 (需對手同意)</div>') : ''}
    ${withNew ? sec('s-friends', '👥 好友', false, '<div class="setting-row"><a class="btn-secondary" href="#">📋 前往好友名單</a></div>' + (withBattleBtn ? '<div class="setting-row"><button class="btn-secondary">👥 將對手加為好友</button></div>' : '') + '<div class="setting-hint">好友名單會在新分頁開啟，不會離開這場對戰。<br/>雙方都送出邀請（或一方確認）才會成為好友。</div>') : ''}
  </div>
</div>`;
}

const page = (body) => `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}body{margin:0}${css}</style></head><body>${body}</body></html>`;


/** 從 svelte 檔忠實抽出設定 modal 的 markup（去註解、{#if} 取第一分支、{expr}→X、事件屬性移除）。 */
function extractSettingsModal(svelte) {
  const a = svelte.indexOf('<div class="zoom-modal settings-modal"');
  const b = svelte.indexOf('<!-- v4.60 對方提議 modal -->');
  let seg = svelte.slice(a, b).replace(/<!--[\s\S]*?-->/g, '');
  const out = []; const stack = [];
  for (const line of seg.split('\n')) {
    const st = line.trim();
    if (st.startsWith('{#if') && st.endsWith('}') && (st.match(/\{/g) || []).length === 1) { stack.push(true); continue; }
    if (st.startsWith('{:else') && st.endsWith('}') && (st.match(/\{/g) || []).length === 1 && stack.length) { stack[stack.length - 1] = false; continue; }
    if (st === '{/if}' && stack.length) { stack.pop(); continue; }
    if (stack.every(Boolean)) out.push(line);
  }
  seg = out.join('\n').replace(/\{#if [^}]*\}/g, '').replace(/\{:else[^}]*\}[\s\S]*?\{\/if\}/g, '').replace(/\{\/if\}/g, '');
  let r = '', i = 0;
  while (i < seg.length) {
    if (seg[i] === '{') { let d = 1, j = i + 1; while (j < seg.length && d) { if (seg[j] === '{') d++; else if (seg[j] === '}') d--; j++; } r += 'X'; i = j; }
    else { r += seg[i++]; }
  }
  r = r.replace(/\s(on\w+|bind:\w+|class:\S+)=X/g, '').replace(/ value=X| checked=X| disabled=X/g, '').replace(/open=X/g, ' open');
  const end = r.lastIndexOf('</div>\n    </div>');
  return r.slice(0, end) + '</div>\n    </div>';
}

const R = (o) => ({ x: +o.x.toFixed(1), y: +o.y.toFixed(1), w: +o.width.toFixed(1), h: +o.height.toFixed(1) });
async function measure(pg, html, ids) {
  await pg.setContent(page(html), { waitUntil: 'load' });
  return pg.evaluate((ids) => {
    const out = {};
    for (const id of ids) { const el = document.getElementById(id); if (el) { const r = el.getBoundingClientRect(); out[id] = { x: r.x, y: r.y, width: r.width, height: r.height }; } }
    out.__doc = { scrollH: document.documentElement.scrollHeight, vh: innerHeight, vw: innerWidth };
    return out;
  }, ids);
}
function diff(before, after) {
  const rows = [];
  for (const k of Object.keys(before)) {
    if (k === '__doc' || !after[k]) continue;
    const b = R(before[k]), a = R(after[k]);
    rows.push({ id: k, dx: +(a.x - b.x).toFixed(1), dy: +(a.y - b.y).toFixed(1), dw: +(a.w - b.w).toFixed(1), dh: +(a.h - b.h).toFixed(1), before: b, after: a });
  }
  return rows;
}
const fmt = (rows) => rows.map((r) => `    ${r.id.padEnd(14)} dx=${r.dx} dy=${r.dy} dw=${r.dw} dh=${r.dh}   (${r.before.x},${r.before.y},${r.before.w}×${r.before.h}) → (${r.after.x},${r.after.y},${r.after.w}×${r.after.h})`).join('\n');
/** 兩個元素彼此的相對位移（after 的差 − before 的差）。 */
function relative(before, after, a, b) {
  return { dx: +(after[b].x - after[a].x - (before[b].x - before[a].x)).toFixed(1), dy: +(after[b].y - after[a].y - (before[b].y - before[a].y)).toFixed(1) };
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
const report = { page: PAGE, scenes: {} };
let bad = 0;
try {
  // ── L：大廳 ────────────────────────────────────────────────────────────
  const LIDS = ['m-back', 'm-dash', 'm-pill', 'm-authuser', 'm-email', 'm-pw', 'm-out', 'm-h1', 'm-form', 'm-name', 'm-create', 'm-wait', 'm-room1', 'm-playing', 'm-manual', 'm-friends-mobile', 'm-friends-desktop'];
  for (const email of ['a.very.long.email.address@example.com', 'ab@x.io']) {
    for (const vp of [{ w: 375, h: 812, mobile: true }, { w: 412, h: 915, mobile: true }, { w: 1366, h: 768, mobile: false }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
      const pg = await ctx.newPage();
      const before = await measure(pg, lobbyHtml({ mobile: vp.mobile, withNew: false, email }), LIDS);
      const after = await measure(pg, lobbyHtml({ mobile: vp.mobile, withNew: true, email }), LIDS);
      const rows = diff(before, after);
      const moved = rows.filter((r) => r.dx || r.dy || r.dw || r.dh);
      const key = `L ${vp.w}×${vp.h} ${vp.mobile ? '手機直式' : '桌機'} email=${email}`;
      report.scenes[key] = { rows, moved: moved.map((r) => r.id), newNode: after['m-friends-mobile'] ? R(after['m-friends-mobile']) : null, doc: { before: before.__doc, after: after.__doc } };
      console.log(`\n【${key}】`);
      console.log(fmt(rows));
      if (vp.mobile) {
        console.log(`    新節點 m-friends-mobile: ${JSON.stringify(report.scenes[key].newNode)}；scrollHeight ${before.__doc.scrollH} → ${after.__doc.scrollH}`);
        if (moved.length) { bad++; console.log('    ⚠⚠ 手機直式有既有元素位移：' + moved.map((r) => r.id).join(',')); }
        else console.log('    ✅ 手機直式：既有 ' + rows.length + ' 個元素全部 dx=dy=dw=dh=0');
        const n = after['m-friends-mobile'], m = after['m-manual'];
        if (!(n.y >= m.y + m.height)) { bad++; console.log('    ⚠⚠ 新節點沒有落在 manual-code 之下'); }
      } else {
        console.log('    （桌機：本版不動 .auth-user，此組只是 v6.283 對照；桌機入口 ' + JSON.stringify(after['m-friends-desktop'] ? R(after['m-friends-desktop']) : null) + '）');
      }
      await ctx.close();
    }
  }
  // ── G：賽後結算 modal ─────────────────────────────────────────────────
  const GIDS = ['g-modal', 'g-head', 'g-body', 'g-icon', 'g-title', 'g-winner', 'g-reason', 'g-row1', 'g-b1', 'g-b2', 'g-row2', 'g-b3', 'g-b4', 'g-home', 'g-friend-row', 'g-friend'];
  for (const branch of ['casual', 'tournament']) {
    for (const vp of [{ w: 375, h: 812, mobile: true }, { w: 375, h: 667, mobile: true }, { w: 1366, h: 768, mobile: false }, { w: 1920, h: 1080, mobile: false }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
      const pg = await ctx.newPage();
      const before = await measure(pg, gameoverHtml({ withNew: false, state: 'idle', branch }), GIDS);
      const after = await measure(pg, gameoverHtml({ withNew: true, state: 'idle', branch }), GIDS);
      const done = await measure(pg, gameoverHtml({ withNew: true, state: 'done', branch }), GIDS);
      const rows = diff(before, after);
      const key = `G ${branch} ${vp.w}×${vp.h} ${vp.mobile ? '手機直式' : '桌機'}`;
      const btns = ['g-b1', 'g-b2', 'g-b3', 'g-b4', 'g-home'].filter((k) => before[k]);
      const rel = [];
      for (let i = 1; i < btns.length; i++) rel.push({ pair: btns[0] + '→' + btns[i], ...relative(before, after, btns[0], btns[i]) });
      const shift = new Set(rows.map((r) => r.dy + ''));
      const m = after['g-modal'];
      const fits = m.y >= 0 && m.y + m.height <= vp.h;
      const sameH = Math.abs(after['g-friend'].height - done['g-friend'].height) < 0.5;
      const doneRowShift = +(done['g-row2'].y - after['g-row2'].y).toFixed(1);
      report.scenes[key] = { rows, rel, modalAfter: R(m), fits, btnH: { idle: +after['g-friend'].height.toFixed(1), done: +done['g-friend'].height.toFixed(1) }, doneRowShift };
      console.log(`\n【${key}】`);
      console.log(fmt(rows));
      console.log(`    既有鈕彼此相對位移: ${JSON.stringify(rel)}；整體 dy 集合: {${[...shift].join(', ')}}`);
      console.log(`    modal after: ${JSON.stringify(R(m))} viewport ${vp.w}×${vp.h} ⇒ ${fits ? '✅ 沒超出畫面' : '⚠⚠ 超出畫面'}；新鈕 idle 高 ${after['g-friend'].height.toFixed(1)} / 送出後 ${done['g-friend'].height.toFixed(1)} ⇒ ${sameH ? '✅ 同高' : '⚠⚠ 不同高'}；送出後既有鈕列位移 ${doneRowShift}`);
      if (rel.some((r) => r.dx || r.dy)) { bad++; console.log('    ⚠⚠ 既有鈕相對位置變了'); }
      // g-modal／g-body 是裝新鈕的容器，長高是預期（fixed 置中 ⇒ 上緣上移 Δ/2）；其餘既有元素尺寸不得變
      if (rows.some((r) => r.id !== 'g-modal' && r.id !== 'g-body' && (r.dw || r.dh))) { bad++; console.log('    ⚠⚠ 既有元素尺寸變了'); }
      if (!fits || !sameH || doneRowShift) bad++;
      await ctx.close();
    }
  }
  // ── S：設定 modal（⚠ v6.284 **沒有出貨**這一段：這裡量的是「若把 👥 好友 section 放在最後」會怎樣）─────
  //   markup 直接從 svelte 檔抽出（第一分支保留＝對戰中、各開關開啟的最高狀態），確保高度忠實。
  //   結論：.zoom-modal{overflow:hidden}（v3.884）蓋掉 .settings-modal{overflow-y:auto} ⇒ modal 到 max-height 後**不能捲動**，
  //   375×812／1366×768 在對戰中 BASE 就已貼到上限，尾端 section 會被切掉且點不到。這一組不計入 bad，只印出來當裁定依據。
  const SETTINGS_TRAIL = '<details class="settings-section" id="s-friends"><summary>👥 好友</summary><div class="setting-row"><a class="btn-secondary" href="#">📋 前往好友名單</a></div><div class="setting-row"><button class="btn-secondary">👥 將對手加為好友</button></div><div class="setting-hint">好友名單會在新分頁開啟，不會離開這場對戰。<br/>雙方都送出邀請（或一方確認）才會成為好友。</div></details>';
  const settingsBase = extractSettingsModal(src);
  const settingsTrail = settingsBase.replace(/<\/div>\s*<\/div>\s*$/, SETTINGS_TRAIL + '</div></div>');
  for (const vp of [{ w: 375, h: 812, mobile: true }, { w: 375, h: 667, mobile: true }, { w: 1366, h: 768, mobile: false }, { w: 1536, h: 864, mobile: false }, { w: 1920, h: 1080, mobile: false }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const pg = await ctx.newPage();
    const probe = async (html) => { await pg.setContent(page('<div class="zoom-overlay">' + html + '</div>'), { waitUntil: 'load' }); return pg.evaluate(() => {
      const m = document.querySelector('.settings-modal'); const r = m.getBoundingClientRect(); const cs = getComputedStyle(m);
      const secs = [...m.querySelectorAll('details.settings-section')].map((d) => { const q = d.getBoundingClientRect(); return { t: d.querySelector('summary').textContent.trim().slice(0, 7), y: +q.y.toFixed(1), bottom: +(q.y + q.height).toFixed(1) }; });
      return { y: +r.y.toFixed(1), h: +r.height.toFixed(1), bottom: +(r.y + r.height).toFixed(1), contentBottom: +(r.y + r.height - parseFloat(cs.paddingBottom) - 1).toFixed(1), scrollH: m.scrollHeight, clientH: m.clientHeight, overflowY: cs.overflowY, secs };
    }); };
    const before = await probe(settingsBase), after = await probe(settingsTrail);
    const key = `S(假設性,未出貨) ${vp.w}×${vp.h} ${vp.mobile ? '手機直式' : '桌機'}`;
    const last = after.secs[after.secs.length - 1];
    const clippedBefore = before.scrollH > before.clientH, clippedAfter = last.bottom > after.contentBottom;
    report.scenes[key] = { before, after, clippedBefore, clippedAfter };
    console.log(`\n【${key}】overflowY=${after.overflowY}`);
    console.log(`    BASE：modal y=${before.y} h=${before.h} scrollH=${before.scrollH} clientH=${before.clientH} ⇒ ${clippedBefore ? '⚠ 對戰中已被切掉（不能捲動）' : '剛好放得下'}`);
    console.log(`    尾端加 section：modal y=${after.y} h=${after.h}；既有 section dy=${before.secs.map((s, i) => +(after.secs[i].y - s.y).toFixed(1)).join(',')}；新 section bottom=${last.bottom} vs 內容底 ${after.contentBottom} ⇒ ${clippedAfter ? '⚠⚠ 新 section 被切掉、點不到' : '✅ 看得到'}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
const out = process.env.MEASURE_OUT || '/tmp/measure-v6284.json';
writeFileSync(out, JSON.stringify(report, null, 1));
console.log('\n' + (bad ? '⚠⚠ 有 ' + bad + ' 項不符' : '✅ 全部符合') + '；細節寫在 ' + out);
process.exit(bad ? 1 : 0);
