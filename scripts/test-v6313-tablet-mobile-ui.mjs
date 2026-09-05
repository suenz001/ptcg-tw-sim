// scripts/test-v6313-tablet-mobile-ui.mjs
// v6.313 平板（iPad 等）直立時可選用手機版對戰介面 —— 行為端守衛（不是「字串存在」）。
//
// 守什麼（每一條都把 game/+page.svelte 裡的真實程式片段抽出來**執行**）：
//   【A】computeIsPortraitMobile(w, h, force)：開關關 ⇒ 22 格尺寸矩陣逐格等於 BASE 公式 Math.min(w,h) <= 600；
//       開關開 ⇒ 只在「直式且 min(w,h) > 600」多切到手機版，橫式一律不切（平板橫放仍走桌機版）。
//   【B】onResize 區塊抽出執行：isPortraitMobile 真的走 computeIsPortraitMobile（不是另抄一份公式）；
//       isSmallScreen 永遠＝BASE 公式；開關開時 isTabletLayout 必為 false（桌機分支專用旗標不得同時亮）。
//   【C】localStorage 初始化：只認 '1'；'0'／null／'true'／'yes' 一律當關（預設不變＝不動任何現有玩家）。
//   【D】setter：寫 'ptcg_force_mobile_battle_ui'、並派發 resize（同一條 onResize 路徑，不另抄判定）。
//   【E】旋轉遮罩 .rotate-prompt 的 {#if} 條件求值：isPortraitMobile=true ⇒ 不渲染（否則 z-index 99999 遮罩蓋死手機版）；
//       isPortraitMobile=false ⇒ 與 BASE 三個條件逐格相同。
//   【F】設定 modal：開關落在「🎴 對戰版面（測試）」section 內、被 {#if !isSmallScreen} 包住、input 接 forceMobileBattleUI／setForceMobileBattleUI；
//       好友 section 仍是最後一個（test-v6285 另有守）；零新 CSS。
//   【G】結構不變量：對戰版面分支的 {#if} 字面恰一處、isPortraitMobile 的賦值點恰一處（onResize）、
//       MobilePortraitBattle.svelte 不讀 innerWidth／matchMedia／@media（「偽造 min(w,h) 的量測 ＝ 真開關」這個前提）。
//   【H】⭐ v6.315 旋轉遮罩 .rotate-prompt 的 **CSS 層**：把 @media 條件抽出來用迷你求值器逐格算（不是字串存在）——
//       真手機（min(w,h) <= 600）CSS 層自己就必須擋掉（不靠 {#if}，雙層防禦）；iPad 直式 744／820／834 開關關 ⇒ 顯示、開關開 ⇒ 不顯示；
//       1024×1366（超過 950）與橫式與滑鼠裝置一律不顯示；「渲染且可見」＝{#if} 條件 × CSS 條件 的合成真值表逐格鎖住。
//   【M】突變 ≥ 7：每一條只捕 assert.AssertionError，且必須紅在預期那一條。
//   ⚠ v6.315 補兩個盲點（獨立審查者抓到）：矩陣多了 w === h 三格（h > w 突變成 h >= w 之前 A1 全綠）；CSS 層原本完全沒鎖。
//
// ⚠ 不 pin 版本號、不 pin sha。BASE 公式 `Math.min(w, h) <= 600` 直接寫在這裡當對照（它就是守護對象）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAME = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const MPB = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + e.message.split('\n')[0].slice(0, 300)); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, expectRe) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(expectRe.test(String(err.message)), '突變體「' + name + '」紅在別條：' + err.message.split('\n')[0].slice(0, 200) + '（預期 ' + expectRe + '）');
};
const once = (src, s, what) => { assert.strictEqual(src.split(s).length - 1, 1, (what || s.slice(0, 60)) + ' 不是恰一處'); return src.indexOf(s); };

// ── 尺寸矩陣（真手機／平板直式／平板橫式／桌機／邊界）───────────────────────────
const MATRIX = [
  [375, 812], [390, 844], [412, 915], [430, 932],           // 真手機直式
  [812, 375], [915, 412],                                   // 真手機橫放（BASE 也走手機版）
  [600, 1000], [601, 1000], [1000, 600], [1000, 601],       // 600 邊界
  [744, 1133], [820, 1180], [834, 1194], [1024, 1366], [1032, 1376],  // iPad 直式（mini／10.9／Pro 11／Pro 12.9／Pro 13）
  [1133, 744], [1180, 820], [1194, 834], [1366, 1024],      // iPad 橫式
  [1366, 768], [1440, 900], [1920, 1080],                   // 桌機
  [600, 600], [700, 700], [1024, 1024],                     // ⭐ v6.315 正方形（w === h）：h > w 為 false ⇒ 開關開也不切；600 那格 BASE 本來就是手機版
];
const BASE_FORMULA = (w, h) => Math.min(w, h) <= 600;

// ── 抽函式／區塊 ─────────────────────────────────────────────────────────────
function extractCompute(src) {
  const m = /function computeIsPortraitMobile\(w: number, h: number, force: boolean\): boolean \{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(m, '找不到 computeIsPortraitMobile');
  return new Function('w', 'h', 'force', m[1]);
}
function extractSetter(src) {
  const m = /function setForceMobileBattleUI\(on: boolean\) \{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(m, '找不到 setForceMobileBattleUI');
  return m[1];
}
/** 把 onResize 的函式體抽出來執行：回傳 { isPortraitMobile, isSmallScreen, isTabletLayout } */
function extractOnResize(src) {
  const s = once(src, '    const onResize = () => {', 'onResize 起點');
  const e = src.indexOf('\n    };', s);
  assert.ok(e > s, 'onResize 收尾');
  const body = src.slice(s + '    const onResize = () => {'.length, e);
  const fn = new Function('env', `
    let isPortraitMobile = null, isSmallScreen = null, isTabletLayout = null, chatFabPos = { x: 0, y: 0 };
    const { window, forceMobileBattleUI } = env;
    const recomputeZoom = () => {}; const clampChatFabPos = (p) => p;
    const computeIsPortraitMobile = env.compute;
    (() => {${body}\n})();
    return { isPortraitMobile, isSmallScreen, isTabletLayout };
  `);
  return (w, h, force, compute) => fn({ window: { innerWidth: w, innerHeight: h }, forceMobileBattleUI: force, compute });
}
function extractInit(src) {
  const m = /(try \{ forceMobileBattleUI = localStorage\.getItem\('ptcg_force_mobile_battle_ui'\)[^\n]*\n)/.exec(src);
  assert.ok(m, '找不到 localStorage 初始化那一行');
  return (saved) => new Function('saved', `let forceMobileBattleUI = false; const localStorage = { getItem: (k) => (k === 'ptcg_force_mobile_battle_ui' ? saved : null) }; ${m[1]} return forceMobileBattleUI;`)(saved);
}
function rotatePromptCond(src) {
  const i = once(src, '  <div class="rotate-prompt">', 'rotate-prompt 節點');
  const head = src.lastIndexOf('{#if ', i);
  const cond = src.slice(head + 5, src.indexOf('}', head));
  assert.ok(i - head < 900, 'rotate-prompt 前面最近的 {#if} 距離太遠（' + (i - head) + ' 字元）—— 節點被搬走了？');
  return cond;
}
function evalCond(cond, env) {
  return new Function('env', `const { game, isSpectator, isPortraitMobile } = env; return !!(${cond});`)(env);
}
function settingsBlock(src) {
  const s = once(src, '<div class="zoom-modal settings-modal"', '設定 modal');
  const e = src.indexOf('<!-- v4.60 對方提議 modal -->', s);
  assert.ok(e > s, '設定 modal 收尾錨點');
  return src.slice(s, e);
}
function layoutSection(src) {
  const seg = settingsBlock(src);
  const s = seg.indexOf('<summary>🎴 對戰版面（測試）</summary>');
  assert.ok(s > 0, '找不到「🎴 對戰版面（測試）」section');
  const e = seg.indexOf('</details>', s);
  return seg.slice(s, e);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('【A】computeIsPortraitMobile：開關關＝BASE 公式逐格相同；開關開＝只在直式多切');
function assertCompute(src) {
  const f = extractCompute(src);
  for (const [w, h] of MATRIX) {
    assert.strictEqual(f(w, h, false), BASE_FORMULA(w, h), `開關關 ${w}×${h}：與 BASE 公式 Math.min(w,h)<=600 不同`);
    const expectOn = BASE_FORMULA(w, h) || (h > w);
    assert.strictEqual(f(w, h, true), expectOn, `開關開 ${w}×${h}：預期 ${expectOn}（直式才切；橫式不切）`);
  }
  // 反面對照：橫式平板開了開關也不得切
  assert.strictEqual(f(1180, 820, true), false, '開關開 橫式 1180×820 不得切到手機版');
  assert.strictEqual(f(820, 1180, true), true, '開關開 直式 820×1180 必須切到手機版');
  assert.strictEqual(f(820, 1180, false), false, '開關關 直式 820×1180 必須維持桌機版（＝現況）');
  // ⭐ v6.315：正方形不是直式（h > w 才算）—— 把 h > w 寫成 h >= w 會在這裡紅
  assert.strictEqual(f(700, 700, true), false, '開關開 正方形 700×700 不得切到手機版（h > w 才算直式，h >= w 是突變）');
}
await T(`A1 ${MATRIX.length} 格矩陣（含 w===h）：開關關逐格＝BASE、開關開只在 h>w 多切`, () => assertCompute(GAME));

console.log('【B】onResize 抽出執行：isPortraitMobile 走 computeIsPortraitMobile；isSmallScreen＝BASE；開關開時 isTabletLayout=false');
function assertOnResize(src) {
  const run = extractOnResize(src);
  const compute = extractCompute(src);
  let usedCompute = 0;
  const spy = (w, h, force) => { usedCompute++; return compute(w, h, force); };
  for (const [w, h] of MATRIX) for (const force of [false, true]) {
    const r = run(w, h, force, spy);
    assert.strictEqual(r.isPortraitMobile, compute(w, h, force), `onResize ${w}×${h} force=${force}：isPortraitMobile 不等於 computeIsPortraitMobile`);
    assert.strictEqual(r.isSmallScreen, BASE_FORMULA(w, h), `onResize ${w}×${h}：isSmallScreen 不等於 BASE 公式`);
    if (r.isPortraitMobile) assert.strictEqual(r.isTabletLayout, false, `onResize ${w}×${h} force=${force}：手機版分支亮著時 isTabletLayout 必須是 false`);
    if (!force) {
      // 開關關：isTabletLayout 逐格＝BASE 公式（!mobile && !(w<=950&&w>h) && (w<=1366||h<=850)）
      const mob = BASE_FORMULA(w, h), land = w <= 950 && w > h;
      assert.strictEqual(r.isTabletLayout, !mob && !land && (w <= 1366 || h <= 850), `onResize ${w}×${h} 開關關：isTabletLayout 與 BASE 不同`);
    }
  }
  assert.ok(usedCompute >= MATRIX.length * 2, 'onResize 沒有呼叫 computeIsPortraitMobile（另抄了一份公式？呼叫次數 ' + usedCompute + '）');
}
await T(`B1 onResize ${MATRIX.length * 2} 次執行：三個旗標與單一來源逐格一致`, () => assertOnResize(GAME));

console.log('【C】localStorage 初始化：只認 \'1\'');
function assertInit(src) {
  const init = extractInit(src);
  assert.strictEqual(init('1'), true, "'1' 必須開");
  for (const v of ['0', null, '', 'true', 'yes', ' 1', '1 ']) assert.strictEqual(init(v), false, JSON.stringify(v) + ' 必須當關（預設不變）');
}
await T('C1 \'1\' 開；\'0\'／null／\'\'／\'true\'／\'yes\'／帶空白 一律關', () => assertInit(GAME));

console.log('【D】setter：寫 localStorage ＋ 派發 resize');
function assertSetter(src) {
  const body = extractSetter(src);
  const runSetter = (on) => {
    const store = {}; let dispatched = [];
    const fn = new Function('on', 'store', 'dispatched', `
      let forceMobileBattleUI = null;
      const localStorage = { setItem: (k, v) => { store[k] = v; } };
      const window = { dispatchEvent: (ev) => { dispatched.push(ev.type); return true; } };
      const Event = class { constructor(t) { this.type = t; } };
      (() => {${body}\n})();
      return forceMobileBattleUI;`);
    const state = fn(on, store, dispatched);
    return { state, store, dispatched };
  };
  const on = runSetter(true), off = runSetter(false);
  assert.strictEqual(on.state, true, 'setter(true) 沒把 state 設成 true');
  assert.strictEqual(off.state, false, 'setter(false) 沒把 state 設成 false');
  assert.strictEqual(on.store.ptcg_force_mobile_battle_ui, '1', "setter(true) 沒寫 localStorage '1'");
  assert.strictEqual(off.store.ptcg_force_mobile_battle_ui, '0', "setter(false) 沒寫 localStorage '0'");
  assert.deepStrictEqual(on.dispatched, ['resize'], 'setter 沒派發 resize（開關切換後畫面不會立刻重算）');
  assert.deepStrictEqual(off.dispatched, ['resize'], 'setter(false) 沒派發 resize');
  // 初始化與 setter 用同一把 key
  assert.ok(/getItem\('ptcg_force_mobile_battle_ui'\)/.test(src), '初始化讀的 key 不是 ptcg_force_mobile_battle_ui');
}
await T('D1 setter(true/false)：state／localStorage(\'1\'/\'0\')／resize 事件', () => assertSetter(GAME));

console.log('【E】旋轉遮罩條件：手機版分支亮著時不得渲染');
function assertRotate(src) {
  const cond = rotatePromptCond(src);
  const G = { phase: 'playing' }, GO = { phase: 'game-over' };
  assert.strictEqual(evalCond(cond, { game: G, isSpectator: false, isPortraitMobile: true }), false, '手機版分支亮著（isPortraitMobile=true）時 rotate-prompt 仍會渲染 ⇒ z-index 99999 遮罩蓋死平板手機版');
  // 與 BASE 三條件逐格相同（isPortraitMobile=false）
  assert.strictEqual(evalCond(cond, { game: G, isSpectator: false, isPortraitMobile: false }), true, '桌機分支對戰中必須照舊渲染');
  assert.strictEqual(evalCond(cond, { game: GO, isSpectator: false, isPortraitMobile: false }), false, 'game-over 不渲染（v5.609）');
  assert.strictEqual(evalCond(cond, { game: G, isSpectator: true, isPortraitMobile: false }), false, '觀戰不渲染（v5.609）');
  assert.strictEqual(evalCond(cond, { game: null, isSpectator: false, isPortraitMobile: false }), false, '沒對局不渲染');
}
await T('E1 rotate-prompt {#if}：isPortraitMobile=true ⇒ false；其餘四格與 BASE 相同', () => assertRotate(GAME));

console.log('【H】旋轉遮罩 .rotate-prompt 的 CSS 層：@media 條件抽出求值，真手機 CSS 自己就要擋；{#if} × CSS 合成真值表');
/** 抽出 `.rotate-prompt{ display:flex …}` 所屬的那一條 @media 查詢字串（不含 `{`） */
function rotatePromptMedia(src) {
  const rule = once(src, '    .rotate-prompt{\n      display:flex; position:fixed; inset:0; z-index:99999;', 'rotate-prompt 的 display:flex 規則');
  once(src, '  .rotate-prompt{ display:none; }', 'rotate-prompt 的預設 display:none 規則');
  const at = src.lastIndexOf('@media', rule);
  assert.ok(at > 0 && rule - at < 200, 'display:flex 規則前面 200 字元內找不到 @media —— 遮罩的 CSS 條件被搬走或拆掉了');
  const q = src.slice(at + 6, src.indexOf('{', at)).trim();
  // 這條 @media 與 display:flex 規則之間不得有 `}`（否則規則其實不在這個 @media 區塊內）
  assert.ok(!src.slice(src.indexOf('{', at) + 1, rule).includes('}'), 'display:flex 規則不在該 @media 區塊內');
  return q;
}
/** 迷你 media query 求值器：只認 min-width／max-width／orientation／hover／pointer，其他一律 assert（不能靜默放行） */
function mediaMatches(q, { w, h, touch }) {
  const feats = [...q.matchAll(/\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)/g)];
  assert.ok(feats.length >= 1, '@media 裡沒有任何 (feature: value)：' + q);
  const rest = q.replace(/\(\s*[\w-]+\s*:\s*[^)]+?\s*\)/g, '').replace(/\band\b/g, '').trim();
  assert.strictEqual(rest, '', '@media 含守衛不認得的語法（or／not／逗號…）：' + JSON.stringify(rest));
  return feats.every(([, f, v]) => {
    const px = () => { const m = /^(\d+(?:\.\d+)?)px$/.exec(v); assert.ok(m, f + ' 的值不是 px：' + v); return parseFloat(m[1]); };
    switch (f) {
      case 'min-width': return w >= px();
      case 'max-width': return w <= px();
      case 'orientation': assert.ok(v === 'portrait' || v === 'landscape', 'orientation 值：' + v); return v === 'portrait' ? h >= w : w > h; // CSS 規格：高 ≥ 寬 即 portrait
      case 'hover': assert.ok(v === 'none' || v === 'hover', 'hover 值：' + v); return (v === 'none') === touch;
      case 'pointer': assert.ok(['none', 'coarse', 'fine'].includes(v), 'pointer 值：' + v); return (v === 'coarse') === touch;
      default: assert.fail('@media 用了守衛不認得的 feature「' + f + '」—— 請先擴充求值器再改 CSS');
    }
  });
}
function assertRotateCss(src) {
  const q = rotatePromptMedia(src);
  const cond = rotatePromptCond(src);
  const compute = extractCompute(src);
  const G = { phase: 'playing' };
  for (const [w, h] of MATRIX) for (const touch of [true, false]) {
    const css = mediaMatches(q, { w, h, touch });
    // ① 真手機（BASE 公式）：CSS 層**自己**就必須擋掉（v2.285 的 min-width:601；不靠 {#if} 的 !isPortraitMobile）
    if (BASE_FORMULA(w, h)) assert.strictEqual(css, false, `真手機 ${w}×${h} touch=${touch}：rotate-prompt 的 CSS 條件命中了（真手機 CSS 層自己就要擋，不能只靠 {#if}）`);
    // ② 滑鼠／細指標裝置（桌面縮窄視窗）永遠不命中（v4.02）
    if (!touch) assert.strictEqual(css, false, `滑鼠裝置 ${w}×${h}：rotate-prompt 的 CSS 條件命中了（v4.02 桌面縮窄視窗不得誤觸發）`);
    // ③ 橫式永遠不命中
    if (w > h) assert.strictEqual(css, false, `橫式 ${w}×${h} touch=${touch}：rotate-prompt 的 CSS 條件命中了`);
    for (const force of [false, true]) {
      const pm = compute(w, h, force);
      const rendered = evalCond(cond, { game: G, isSpectator: false, isPortraitMobile: pm });
      const visible = rendered && css;
      // ④ 手機版分支亮著時，不論 CSS 怎麼寫都不可見（E 的 {#if} 已守；這裡是合成後再守一次）
      if (pm) assert.strictEqual(visible, false, `${w}×${h} force=${force} touch=${touch}：手機版分支亮著卻仍會看到旋轉遮罩`);
      // ⑤ 現況真值表：觸控 + 601~950 寬 + 直式（CSS 規格 h >= w） + 桌機分支 ⇒ 可見；其餘不可見
      const expect = touch && w >= 601 && w <= 950 && h >= w && !pm;
      assert.strictEqual(visible, expect, `${w}×${h} force=${force} touch=${touch}：旋轉遮罩可見性預期 ${expect}（CSS=${css}, {#if}=${rendered}）`);
    }
  }
  // 錨點型反面對照：iPad 直式三種尺寸開關關必須看得到（＝現況，v6.314 changelog 的「先橫放再進設定」就是因為它）
  for (const w of [744, 820, 834]) assert.strictEqual(mediaMatches(q, { w, h: w + 400, touch: true }), true, `iPad 直式 ${w} 寬開關關：旋轉遮罩應顯示（現況）`);
  assert.strictEqual(mediaMatches(q, { w: 1024, h: 1366, touch: true }), false, '1024×1366 超過 950 不顯示（現況）');
}
await T(`H1 rotate-prompt CSS 層：${MATRIX.length} 格 × touch × 開關 的合成真值表；真手機／滑鼠／橫式 CSS 自己就擋`, () => assertRotateCss(GAME));

console.log('【F】設定 modal 開關：位置／包裝條件／接線／零新 CSS');
function assertSettings(src) {
  const sec = layoutSection(src);
  const i = sec.indexOf('id="force-mobile-ui"');
  assert.ok(i > 0, '「🎴 對戰版面（測試）」section 內找不到 force-mobile-ui 開關');
  assert.strictEqual(src.split('id="force-mobile-ui"').length - 1, 1, 'force-mobile-ui 全檔不是恰一處');
  const before = sec.slice(0, i);
  const wrapAt = before.lastIndexOf('{#if !isSmallScreen}');
  assert.ok(wrapAt >= 0 && !/\{\/if\}/.test(before.slice(wrapAt)), '開關沒有被 {#if !isSmallScreen} 直接包住（真手機上顯示這個開關沒有意義）');
  const row = sec.slice(i, sec.indexOf('</div>', i));
  assert.ok(/checked=\{forceMobileBattleUI\}/.test(row), 'checkbox 沒綁 forceMobileBattleUI');
  assert.ok(/onchange=\{\(e\) => setForceMobileBattleUI\(e\.currentTarget\.checked\)\}/.test(row), 'onchange 沒接 setForceMobileBattleUI(checked)');
  assert.ok(/type="checkbox"/.test(row), '不是 checkbox');
  const after = sec.slice(i);
  assert.ok(after.indexOf('{/if}') > 0 && after.indexOf('{/if}') < after.indexOf('<div class="setting-hint">'), '{#if !isSmallScreen} 沒有在 setting-hint 之前收尾');
  // 零新 CSS：style 區沒有任何 force-mobile 相關 selector
  const css = src.slice(src.lastIndexOf('<style'));
  assert.strictEqual((css.match(/force-mobile|isSmallScreen|forceMobileBattleUI/g) || []).length, 0, 'style 區出現本版識別字（本版零新 CSS）');
  // 只用既有 class
  const classes = new Set([...row.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  assert.deepStrictEqual([...classes].filter((c) => !['setting-row', 'small'].includes(c)), [], '開關列用了新 class');
}
await T('F1 開關在對戰版面 section 內、{#if !isSmallScreen} 包住、接線正確、零新 class／零新 CSS', () => assertSettings(GAME));

console.log('【G】結構不變量');
function assertStructure(src, mpb) {
  once(src, '  {#if isPortraitMobile && game}\n', '對戰版面分支的 {#if}');
  once(src, '{/if}<!-- /isPortraitMobile && playing -->', '對戰版面分支的 {/if}');
  const assigns = [...src.matchAll(/^\s*isPortraitMobile = /gm)];
  assert.strictEqual(assigns.length, 1, 'isPortraitMobile 的賦值點必須恰一處（onResize），現在 ' + assigns.length + ' 處');
  const assignsSmall = [...src.matchAll(/^\s*isSmallScreen = /gm)];
  assert.strictEqual(assignsSmall.length, 1, 'isSmallScreen 的賦值點必須恰一處，現在 ' + assignsSmall.length + ' 處');
  // 手機版元件不讀視窗寬／不用 media query ⇒ 「偽造 min(w,h) 的量測」與「真開關」等價；也是「禁 @media 當手機開關」的體現
  assert.strictEqual((mpb.match(/innerWidth|innerHeight|matchMedia|@media/g) || []).length, 0, 'MobilePortraitBattle.svelte 讀了視窗尺寸／用了 @media —— 量測前提失效');
  // 初始化必須在 onResize() 初始化呼叫之前（否則第一幀先桌機再跳手機）
  const initAt = src.indexOf("localStorage.getItem('ptcg_force_mobile_battle_ui')");
  const firstCall = src.indexOf('    onResize(); // 初始化');
  assert.ok(initAt > 0 && firstCall > initAt, 'localStorage 讀取必須在 onResize() 初始化之前');
}
await T('G1 分支 {#if} 恰一處、旗標賦值恰一處、MobilePortraitBattle 零視窗尺寸讀取、初始化順序', () => assertStructure(GAME, MPB));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【M】突變測試（只捕 AssertionError，且要紅在預期那一條）');
const mut = (a, b) => { assert.strictEqual(GAME.split(a).length - 1, 1, '突變錨點不唯一：' + a.slice(0, 60)); return GAME.replace(a, b); };
await T('M1 突變：公式改成 force || min<=600（橫式也切）⇒ A 紅在「橫式不切」', () =>
  mutantMustBreak('橫式也切', () => assertCompute(mut('return Math.min(w, h) <= 600 || (force && h > w);', 'return Math.min(w, h) <= 600 || force;')), /橫式不切|不得切到手機版/));
await T('M2 突變：公式改成 (min<=600 || force) && h > w（真手機橫放不再是手機版＝破壞既有行為）⇒ A 紅在「與 BASE 公式不同」', () =>
  mutantMustBreak('破壞 BASE', () => assertCompute(mut('return Math.min(w, h) <= 600 || (force && h > w);', 'return (Math.min(w, h) <= 600 || force) && h > w;')), /與 BASE 公式/));
await T('M3 突變：onResize 改回舊公式（不走單一來源）⇒ B 紅', () =>
  mutantMustBreak('onResize 另抄公式', () => assertOnResize(mut('isPortraitMobile = computeIsPortraitMobile(w, h, forceMobileBattleUI);', 'isPortraitMobile = Math.min(w, h) <= 600;')), /不等於 computeIsPortraitMobile|沒有呼叫 computeIsPortraitMobile/));
await T('M4 突變：初始化改成 !== \'0\'（沒設過的人全部被打開）⇒ C 紅', () =>
  mutantMustBreak('預設變開', () => assertInit(mut("localStorage.getItem('ptcg_force_mobile_battle_ui') === '1'", "localStorage.getItem('ptcg_force_mobile_battle_ui') !== '0'")), /必須當關/));
await T('M5 突變：setter 不派發 resize ⇒ D 紅', () =>
  mutantMustBreak('不重算', () => assertSetter(mut("if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));", '')), /沒派發 resize/));
await T('M6 突變：rotate-prompt 條件拿掉 !isPortraitMobile（＝BASE）⇒ E 紅', () =>
  mutantMustBreak('遮罩蓋死手機版', () => assertRotate(mut("{#if game && game.phase !== 'game-over' && !isSpectator && !isPortraitMobile}", "{#if game && game.phase !== 'game-over' && !isSpectator}")), /遮罩蓋死/));
await T('M7 突變：設定 modal 開關拿掉 {#if !isSmallScreen} ⇒ F 紅', () =>
  mutantMustBreak('真手機也顯示', () => assertSettings(mut('          {#if !isSmallScreen}\n          <!-- ⭐ v6.313', '          <!-- ⭐ v6.313').replace(/\n          \{\/if\}\n          <div class="setting-hint">\n            ・經典版/, '\n          <div class="setting-hint">\n            ・經典版')), /沒有被 \{#if !isSmallScreen\} 直接包住/));
await T('M8 突變：onResize 裡 isSmallScreen 改成跟 isPortraitMobile 一樣（開關開時真手機判定被污染）⇒ B 紅', () =>
  mutantMustBreak('isSmallScreen 污染', () => assertOnResize(mut('isSmallScreen = Math.min(w, h) <= 600;', 'isSmallScreen = computeIsPortraitMobile(w, h, forceMobileBattleUI);')), /isSmallScreen 不等於 BASE 公式/));
await T('M9 突變：多一個 isPortraitMobile 賦值點（例如 setter 直接寫旗標）⇒ G 紅', () =>
  mutantMustBreak('雙寫入點', () => assertStructure(mut('    forceMobileBattleUI = on;\n', '    forceMobileBattleUI = on;\n    isPortraitMobile = on;\n'), MPB), /賦值點必須恰一處/));
// ⭐ v6.315 補的三條（審查者證明 v6.313 守衛對前兩條全綠）
await T('M10 突變：h > w 改成 h >= w（正方形也算直式）⇒ A 紅在「正方形」那格（v6.313 守衛對這條全綠）', () =>
  mutantMustBreak('正方形也切', () => assertCompute(mut('return Math.min(w, h) <= 600 || (force && h > w);', 'return Math.min(w, h) <= 600 || (force && h >= w);')), /700×700|正方形/));
await T('M11 突變：rotate-prompt 的 min-width: 601px 改成 0px（真手機也命中）⇒ H 紅在「真手機 CSS 層」（v6.313 守衛對這條 16 條全綠）', () =>
  mutantMustBreak('真手機也命中', () => assertRotateCss(mut('@media (min-width: 601px) and (max-width: 950px) and (orientation: portrait)', '@media (min-width: 0px) and (max-width: 950px) and (orientation: portrait)')), /真手機 .* CSS 層自己就要擋/));
await T('M12 突變：rotate-prompt 的 max-width: 950px 改成 1400px（1024×1366 現況改變）⇒ H 紅', () =>
  mutantMustBreak('12.9 吋也遮', () => assertRotateCss(mut('@media (min-width: 601px) and (max-width: 950px) and (orientation: portrait)', '@media (min-width: 601px) and (max-width: 1400px) and (orientation: portrait)')), /1024×1366/));
await T('M13 突變：rotate-prompt 的 @media 拿掉 (hover: none) and (pointer: coarse)（桌面縮窄視窗誤觸發，v4.02 回歸）⇒ H 紅', () =>
  mutantMustBreak('滑鼠也遮', () => assertRotateCss(mut('@media (min-width: 601px) and (max-width: 950px) and (orientation: portrait)\n         and (hover: none) and (pointer: coarse) {', '@media (min-width: 601px) and (max-width: 950px) and (orientation: portrait) {')), /滑鼠裝置/));

console.log(`\n══ v6.313／v6.315 平板直立手機版介面守衛：${pass} PASS / ${fail} FAIL ══`);
if (fail > 0) process.exit(1);
