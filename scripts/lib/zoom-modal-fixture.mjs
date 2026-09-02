// ⭐ v6.285 中央 fixture：`src/routes/game/+page.svelte` 的 zoom modal 家族（棄牌區／設定／獎賞卡檢視／卡牌放大）
//   給「量測腳本」（Playwright，沙盒）與「守衛」（CI；有 Playwright 才跑 DOM 段）共用同一份 markup 與 CSS 抽取，
//   兩邊量到的東西才是同一個東西。
//
//   extractCss：把 <style> 區整段原樣抽出（:global(X)→X）。Svelte scoping 只是在 selector 後加 hash class，
//     去掉之後對同一份 markup 版面完全等價。
//   extractFirstBranchMarkup：從 svelte 檔忠實抽出一段 markup（去註解、{#if} 取第一分支、{expr}→X、事件／bind 屬性移除）。
//   settingsMarkup：設定 modal（第一分支＝對戰中、各開關開啟的最高狀態 ⇒ 最高的那個版本）。
//   zoomModalFixtures：其他三種 zoom modal 的手寫 fixture（同一份 markup 拿去比 BASE／修後 CSS，卡圖用固定尺寸 div 代替避免網路）。
export const VIEWPORTS = [
  { w: 375, h: 812, mobile: true }, { w: 375, h: 667, mobile: true },
  { w: 1366, h: 768, mobile: false }, { w: 1536, h: 864, mobile: false }, { w: 1920, h: 1080, mobile: false },
];

export function extractCss(svelte) {
  const sStart = svelte.lastIndexOf('<style');
  const sEnd = svelte.lastIndexOf('</style>');
  if (sStart < 0 || sEnd < sStart) throw new Error('找不到 <style> 區');
  return svelte.slice(svelte.indexOf('>', sStart) + 1, sEnd).replace(/:global\(([^)]*)\)/g, '$1');
}

export function extractFirstBranchMarkup(svelte, startMarker, endMarker) {
  const a = svelte.indexOf(startMarker);
  const b = svelte.indexOf(endMarker, a);
  if (a < 0 || b < a) throw new Error('找不到 markup 錨點：' + startMarker.slice(0, 40));
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
  r = r.replace(/\s(on\w+|bind:\w+|class:\S+|style|aria-live|href)=X/g, '').replace(/ value=X| checked=X| disabled=X/g, '').replace(/open=X/g, ' open');
  return r;
}

/** 設定 modal（含 .zoom-modal.settings-modal 那個 div，到 modal 收尾）。 */
export function settingsMarkup(svelte) {
  const r = extractFirstBranchMarkup(svelte, '<div class="zoom-modal settings-modal"', '<!-- v4.60 對方提議 modal -->');
  const end = r.lastIndexOf('</div>\n    </div>');
  return '<div class="zoom-overlay">' + r.slice(0, end) + '</div></div>';
}

const CARD = (i, cls = 'sel-card') => `<button class="${cls}" id="z-card${i}"><div id="z-img${i}" style="width:108px;height:151px;background:#333;border-radius:6px"></div><span class="sel-name">卡片 ${i}</span></button>`;
export function zoomModalFixtures() {
  const discard = `<div class="zoom-overlay" id="z-overlay"><div class="zoom-modal discard-modal" id="z-modal">
  <button class="zoom-close" id="z-close">✕</button>
  <h3 class="discard-title" id="z-title">🗑 測試玩家 的棄牌區（24 張）</h3>
  <div class="sel-grid" id="z-grid">${Array.from({ length: 24 }, (_, i) => CARD(i)).join('')}</div>
</div></div>`;
  const prize = `<div class="zoom-overlay" id="z-overlay"><div class="zoom-modal discard-modal prize-view-modal" id="z-modal">
  <button class="zoom-close" id="z-close">✕</button>
  <h3 class="discard-title" id="z-title">🎁 獎賞卡（回放限定）</h3>
  ${[0, 1].map((s) => `<div class="prize-view-side" id="z-side${s}"><div class="prize-view-side-title" id="z-sidet${s}">玩家 ${s}　剩 6 張</div><div class="sel-grid" id="z-grid${s}">${Array.from({ length: 6 }, (_, i) => CARD(s * 10 + i)).join('')}</div></div>`).join('')}
</div></div>`;
  const zoom = `<div class="zoom-overlay" id="z-overlay"><div class="zoom-modal" id="z-modal">
  <button class="zoom-back" id="z-back">← 返回</button>
  <button class="zoom-close" id="z-close">✕</button>
  <div class="zoom-scroll" id="z-scroll"><div class="zoom-body" id="z-body">
    <button class="zoom-img-btn" id="z-imgbtn"><div class="zoom-img" id="z-img" style="height:436px;background:#333"></div><span class="zoom-img-hint" id="z-hint">🔍</span></button>
    <div class="zoom-info" id="z-info">
      <div class="zoom-name" id="z-name">測試寶可夢ex</div>
      <div class="zoom-badges" id="z-badges"><span class="badge hp-badge">HP 330</span><span class="badge type-badge" style="background:#c33">火</span><span class="badge sub-badge">1階進化</span><span class="badge mark-badge">J</span></div>
      <div class="zoom-meta" id="z-meta">進化自：測試寶可夢</div>
      <div class="zoom-state" id="z-state"><div>已附能量：3</div><div>傷害：120</div></div>
      ${Array.from({ length: 3 }, (_, i) => `<div class="zoom-attack" id="z-atk${i}"><div class="atk-name">招式 ${i}　120</div><div class="atk-text">這是招式說明文字，用來撐高度：對手的戰鬥寶可夢造成傷害，並擲硬幣若為正面則……</div></div>`).join('')}
      <div class="zoom-meta" id="z-meta2">弱點：水 ×2　抵抗力：—　撤退：2</div>
    </div>
  </div></div>
</div></div>`;
  return { discard, prize, zoom };
}

export const pageHtml = (css, body) => `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}body{margin:0}${css}</style></head><body>${body}</body></html>`;
