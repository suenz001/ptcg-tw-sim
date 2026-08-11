/**
 * v6.171 守衛：Svelte runtime warning 診斷管線（本版只加量測，不改行為）。
 *
 * 事故：2026-08-11 正式站 /tournament，Console `284 https://svelte.dev/e/derived_inert`
 *       ＋ 一次「主執行緒卡 922ms」；玩家回報拖曳失效與「與伺服器失聯 xx 秒」。
 *
 * ⚠⚠ 本輪查證的結論（寫在守衛裡，避免下一個人重走一遍冤枉路）：
 *   ・`derived_inert` 的觸發條件在 svelte/src/internal/client/reactivity/deriveds.js
 *     的 execute_derived()：derived 需要重算，且它的 owner effect 已 DESTROYED **或 INERT**。
 *   ・一度以為是「離場動畫期間點到卡片」。**這條路徑不成立** ——
 *     transitions.js 的 out() 第一件事就是同步 `element.inert = true`，
 *     實測真實 Chromium：inert 節點收不到 pointerdown，document.elementFromPoint 也會跳過它。
 *     ⇒ 所以本版**不加**任何 pointer 防護（加了反而有殘留 pointer-events:none 的風險）。
 *   ・284 次的真正來源**尚未定位**，本機用未混淆 svelte 實跑 AI 對局重現不到
 *     ⇒ 本版改為把 warning 的次數與 stack 自動回報，下次事故直接看 /clientdiag。
 *
 * 釘住四件事：
 *   A 行為層：把 console.warn hook 的原始碼抓出來實跑 —— 真的有計數、有 stack、
 *     有 call through 原函式、非 svelte 的 warn 不會被計數、hook 自己不會遞迴 warn。
 *   B 接線層：編譯後的 _tSendClientDiag 送出 /clientdiag 之前，payload 真的含 svelteWarn
 *     （不是只在原始碼裡出現字串）。
 *   C 正對照：Svelte 版本升級若拿掉 out() 的 `element.inert = true`，或改掉
 *     derived_inert 的 guard 條件，本守衛要 FAIL —— 因為上面兩個結論就建立在它們上面。
 *   D 掃描器自我驗證：把 hook 的計數行拿掉，A 必須抓得到。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, 'src/routes/game/+page.svelte');
const src = fs.readFileSync(PAGE, 'utf8');

let fails = 0;
const bad = (m) => { console.error('  ✗ ' + m); fails++; };
const ok = (m) => console.log('  ✓ ' + m);

/** 從元件原始碼抓出 hook 本體（含兩個累加容器），轉成可執行的 JS */
function extractHook(source) {
  const start = source.indexOf('const _svelteWarnCounts');
  const endMark = '\n  }\n  // ⭐⭐v6.171 假說驗證用';
  const end = source.indexOf(endMark, start);
  if (start < 0 || end < 0) return null;
  let code = source.slice(start, end + 4);
  code = code
    .replace(/: Record<string, number>/g, '')
    .replace(/: string\[\]/g, '')
    .replace(/\(window as \{[^}]*\}\)/g, 'window')
    .replace(/\.\.\.args: unknown\[\]/g, '...args')
    .replace(/\.\.\.\(args as \[\]\)/g, '...args');
  return code;
}

function runHook(code) {
  const calls = [];
  const fakeConsole = { warn: (...a) => { calls.push(a); } };
  const listeners = [];
  const fakeWindow = { addEventListener: (t, f) => listeners.push([t, f]) };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'console', 'Date',
    code + '\n; return { counts: _svelteWarnCounts, first: _svelteWarnFirst, warn: console.warn };');
  const r = fn(fakeWindow, fakeConsole, Date);
  return { ...r, calls, listeners, fakeConsole };
}

console.log('[v6.171] A. 行為層：實跑 console.warn hook');
const hookCode = extractHook(src);
if (!hookCode) bad('抓不到 console.warn hook 本體（_svelteWarnCounts … 區塊）');
else {
  const h = runHook(hookCode);
  h.warn('https://svelte.dev/e/derived_inert');
  h.warn('%c[svelte] derived_inert', 'bold', 'https://svelte.dev/e/derived_inert');
  h.warn('這是別的警告，不該被計數');
  const n = h.counts.derived_inert;
  if (n !== 2) bad(`derived_inert 應計數 2 次，實際 ${n}`);
  else ok('只計 svelte.dev/e/ 開頭的 warning，計數正確');
  if (h.calls.length !== 3) bad(`原始 console.warn 應被呼叫 3 次（call through），實際 ${h.calls.length}`);
  else ok('三則 warning 全部原封不動傳給原始 console.warn（不吞訊息）');
  if (h.calls[2][0] !== '這是別的警告，不該被計數') bad('非 svelte 的 warning 參數被改動了');
  else if (Object.keys(h.counts).length !== 1) bad('非 svelte 的 warning 被誤計數：' + JSON.stringify(h.counts));
  else ok('非 svelte 的 warning 不計數、不改參數');
  if (!h.first.length || !/derived_inert \+-?\d+ms @ /.test(h.first[0])) bad('沒有抓到 stack／沒有帶「距上次 pointer 幾 ms」：' + JSON.stringify(h.first[0]));
  else ok('第一筆有 stack 與「距上次 pointerdown 幾 ms」');
  if (h.first.length > 3) bad('first 沒有上限（會把 payload 撐爆）');
  else ok('first 有上限');
  if (!h.listeners.some(([t]) => t === 'pointerdown')) bad('沒有掛 pointerdown 監聽（拿不到互動時間）');
  else ok('有掛 pointerdown 監聽');
  // 遞迴保護：hook 自己不得再呼叫被包裝過的 console.warn
  if (/_svelteWarnCounts[\s\S]*console\.warn\(/.test(hookCode.replace(/console\.warn = function/, 'X'))) bad('hook 內部自己呼叫了 console.warn（會無限遞迴）');
  else ok('hook 內部不呼叫 console.warn（無遞迴風險）');
}

console.log('[v6.171] B. 接線層：svelteWarn 真的在送出去的 /clientdiag payload 裡');
{
  const js = compile(src, { generate: 'client', dev: false, filename: 'game.svelte' }).js.code;
  const fi = js.indexOf('function _tSendClientDiag');
  const ti = fi >= 0 ? js.indexOf("tApi('/clientdiag'", fi) : -1;
  if (fi < 0 || ti < 0) bad('編譯輸出找不到 _tSendClientDiag → tApi(\'/clientdiag\') 這條路徑');
  else {
    const body = js.slice(fi, ti);
    for (const k of ['svelteWarn', '_svelteWarnCounts', '_svelteWarnFirst', 'inertNodes']) {
      if (!body.includes(k)) { bad(`payload 少了 ${k}（診斷沒接上）`); }
    }
    if (body.includes('svelteWarn') && body.includes('inertNodes')) ok('payload 含 svelteWarn.counts / first / inertNodes');
  }
}

console.log('[v6.171] C. 正對照：本版「不做 pointer 防護」的兩個前提仍成立');
{
  const T = path.join(ROOT, 'node_modules/svelte/src/internal/client/dom/elements/transitions.js');
  const D = path.join(ROOT, 'node_modules/svelte/src/internal/client/reactivity/deriveds.js');
  if (!fs.existsSync(T) || !fs.existsSync(D)) {
    console.log('  – 跳過（找不到 svelte 原始碼，可能是 CI 只裝了 dist）');
  } else {
    const t = fs.readFileSync(T, 'utf8');
    const oi = t.indexOf('out(fn) {');
    const seg = oi >= 0 ? t.slice(oi, oi + 400) : '';
    if (!/element\.inert\s*=\s*true/.test(seg)) {
      bad('svelte transitions.js 的 out() 不再同步設 element.inert=true '
        + '⇒ 離場中的節點會重新變成可點／可被 elementFromPoint 命中，本專案要自己補防護');
    } else ok('out() 仍同步 element.inert = true（離場中的節點點不到）');
    const d = fs.readFileSync(D, 'utf8');
    if (!/derived_inert\(\)/.test(d) || !/DESTROYED \| INERT/.test(d)) {
      bad('svelte deriveds.js 的 derived_inert guard 條件變了 ⇒ 診斷的判讀說明要跟著改');
    } else ok('derived_inert 的 guard 條件仍是 (DESTROYED | INERT)');
  }
}

console.log('[v6.171] D. 掃描器自我驗證（拿掉計數行，A 必須抓得到）');
{
  if (!hookCode) bad('無法自我驗證（前面已抓不到 hook）');
  else {
    const mutated = hookCode.replace(/_svelteWarnCounts\[code\] = [^\n]*\n/, '');
    if (mutated === hookCode) bad('自我驗證失敗：找不到計數行');
    else {
      const h = runHook(mutated);
      h.warn('https://svelte.dev/e/derived_inert');
      if (h.counts.derived_inert === 1) bad('自我驗證失敗：拿掉計數行後仍然計到數（守衛是死的）');
      else ok('自我驗證通過（拿掉計數行後 A 的斷言會失敗）');
    }
  }
}

if (fails > 0) { console.error(`\n[v6.171] ✗ ${fails} 項失敗`); process.exit(1); }
console.log('\n[v6.171] ✓ 全數通過');
