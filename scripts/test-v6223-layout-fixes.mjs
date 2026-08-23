// scripts/test-v6223-layout-fixes.mjs
// v6.223 版面三修守衛：
//   【A】fable 卡背同源尺寸（CSS cascade 事實 + DOM 接線）
//   【B】桌墊版/經典版高度自適應（recomputeZoom 抽出「實際執行」斷言 zoom 數值）
//   【C】桌機預設版面 fable（localStorage 分支抽出執行；已選過者不被覆蓋＝正對照）
// 設計原則：能行為就行為（真的執行抽出的函式），不能行為的 CSS 斷言到
// 「規則存在 + cascade 順序在被蓋規則之後 + specificity 高於對手」三個可驗證事實，
// 並另斷言 DOM 模板端的 class 接線（擋「規則在但沒接上」）。
// 真正的像素級驗證由部署後 headless 量測（見 docs/changelog-internal.md v6.223）與人工目視補位。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.V6223_SRC_ROOT || '.';
const gamePath = path.join(ROOT, 'src/routes/game/+page.svelte');
const SRC = fs.readFileSync(gamePath, 'utf8');

let fails = 0, passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log('  ✓', msg); }
  else { fails++; console.error('  ❌', msg); }
}

// ───────────────────────【B】recomputeZoom 行為測試 ───────────────────────
console.log('【B】recomputeZoom 行為（抽出實際執行）');
const fnM = SRC.match(/function recomputeZoom\(\) \{([\s\S]*?)\n  \}/);
check(!!fnM, 'recomputeZoom 函式可定位');
let runZoom = null;
if (fnM) {
  try {
    runZoom = new Function('env', `
      let gameZoom = -1;
      const { battleLayout, isTabletLayout, isPortraitMobile, resolutionMode, window } = env;
      (function recomputeZoom() {${fnM[1]}\n})();
      return gameZoom;
    `);
  } catch (e) { check(false, 'recomputeZoom 可包裝執行: ' + e.message); }
}
if (runZoom) {
  const Z = (battleLayout, w, h, isTabletLayout, extra = {}) => runZoom({
    battleLayout, isTabletLayout,
    isPortraitMobile: extra.mobile ?? false,
    resolutionMode: extra.mode ?? 'auto',
    window: { innerWidth: w, innerHeight: h },
  });
  check(Z('tabletop', 1366, 768, true) === 0.853, 'tabletop@1366×768 → zoom 0.853（矮螢幕自動縮放；BASE 上是 1＝HEAD-FAIL）');
  check(Z('tabletop', 1912, 836, true) === 0.929, 'tabletop@1912×836 → zoom 0.929');
  check(Z('tabletop', 1920, 1080, false) === 1, 'tabletop@1920×1080 → zoom 1（高度夠不縮）');
  check(Z('classic', 1366, 768, true) === 1, 'classic@1366×768(tablet-layout) → zoom 1（行為不變＝正對照）');
  check(Z('classic', 1440, 900, false) === 0.952, 'classic@1440×900(非 tablet-layout) → zoom 0.952（修 42px 整頁捲動）');
  check(Z('classic', 1920, 1080, false) === 1, 'classic@1920×1080 → zoom 1');
  check(Z('fable', 1366, 768, true) === 1, 'fable → 鎖 zoom 1（雙重縮放防護仍在）');
  check(Z('classic', 390, 844, false, { mobile: true }) === 1, '手機直式 → zoom 1（手機分支不受影響）');
  check(Z('tabletop', 1024, 768, true, { mode: '75' }) === 0.75, '手動解析度 75% 不受 targetH 影響');
}
// fable 早退必須在 targetH 計算之前（避免 fable 吃到縮放）
if (fnM) {
  const iFable = fnM[1].indexOf("battleLayout === 'fable'");
  const iTarget = fnM[1].indexOf('targetH');
  check(iFable >= 0 && iTarget > iFable, 'fable 早退寫在 targetH 計算之前');
}

// ───────────────────────【C】預設版面分支行為測試 ───────────────────────
console.log('【C】預設版面（localStorage 分支抽出執行）');
const clM = SRC.match(/(const savedLayout = localStorage\.getItem\('ptcg_battle_layout'\);[\s\S]*?)\n    \} catch/);
check(!!clM, '預設版面初始化區塊可定位');
if (clM) {
  let runDefault = null;
  try {
    runDefault = new Function('saved', 'width', `
      let battleLayout = 'classic';
      const localStorage = {
        getItem: (k) => (k === 'ptcg_battle_layout' ? saved : null),
        setItem: () => { throw new Error('初始化不可寫 localStorage（預設值不算玩家選擇）'); },
      };
      const window = { innerWidth: width };
      ${clM[1]}
      return battleLayout;
    `);
  } catch (e) { check(false, '初始化區塊可包裝執行: ' + e.message); }
  if (runDefault) {
    check(runDefault('classic', 1920) === 'classic', '已選 classic 的玩家 → 維持 classic（絕不覆蓋＝正對照）');
    check(runDefault('tabletop', 1920) === 'tabletop', '已選 tabletop 的玩家 → 維持 tabletop');
    check(runDefault('fable', 820) === 'fable', '已選 fable 的玩家（窄視窗）→ 維持 fable');
    check(runDefault(null, 1920) === 'fable', '從未選過＋桌機寬 → 預設 fable（BASE 上是 classic＝HEAD-FAIL）');
    check(runDefault(null, 820) === 'classic', '從未選過＋窄視窗(<1024) → 維持 classic 預設');
    let threw = false;
    try { runDefault(null, 1920); } catch { threw = true; }
    check(!threw, '初始化過程沒有寫 localStorage（預設值不落盤）');
  }
}
// setBattleLayout 仍把玩家的選擇寫進 localStorage（跨 session 沿用的另一半）
const setFn = SRC.match(/function setBattleLayout\([\s\S]*?\n  \}/);
check(!!setFn && setFn[0].includes("localStorage.setItem('ptcg_battle_layout', v)"),
  'setBattleLayout 仍寫入 localStorage（玩家選擇跨 session 沿用）');

// ─────────────────────── CSS 工具 ───────────────────────
const classCount = (sel) => (sel.match(/\./g) || []).length;

// ───────────────────────【A】fable 卡背 ───────────────────────
console.log('【A】fable 卡背同源尺寸');
const iBaseLg = SRC.indexOf('.card-back-lg{ width:105px');
const iBaseSm = SRC.indexOf('.card-back-sm{ width:96px');
check(iBaseLg > 0 && iBaseSm > 0, '全域固定尺寸卡背規則仍在（classic/tabletop 沿用）');
const mFixA1 = SRC.match(/(\.playmat\.layout-fable \.active-card\.card-back-active \.card-back)\{([^}]*)\}/);
check(!!mFixA1, 'fable 戰鬥位卡背覆寫規則存在');
if (mFixA1) {
  check(/width:100%/.test(mFixA1[2]) && /height:100%/.test(mFixA1[2]) && /box-sizing:border-box/.test(mFixA1[2]),
    '戰鬥位卡背 width/height:100% + border-box（=與正面卡同尺寸源）');
  check(mFixA1.index > iBaseLg, 'cascade：覆寫規則在固定尺寸規則之後');
  check(classCount(mFixA1[1]) > classCount('.card-back-lg'), 'specificity：覆寫選擇器 class 數高於被覆寫者');
}
const mFixA2 = SRC.match(/(\.playmat\.layout-fable \.bench-slot\.card-back-slot \.card-back)\{([^}]*)\}/);
check(!!mFixA2, 'fable 備戰蓋牌覆寫規則存在');
if (mFixA2) {
  check(/width:100%/.test(mFixA2[2]) && /height:100%/.test(mFixA2[2]) && /box-sizing:border-box/.test(mFixA2[2]),
    '備戰蓋牌 width/height:100% + border-box');
  check(mFixA2.index > iBaseSm, 'cascade：備戰覆寫在固定尺寸規則之後');
}
// DOM 接線：規則指向的 markup 真的存在（擋「CSS 在但模板改名」）
check(SRC.includes('class="active-card opp-active card-back-active"'), '模板：戰鬥位卡背容器 class 未改名');
check(SRC.includes('class="card-back card-back-lg"'), '模板：戰鬥位卡背內層 class 未改名');
check(SRC.includes('class="bench-slot card-back-slot"'), '模板：備戰蓋牌槽 class 未改名');
check(SRC.includes('class="card-back card-back-sm"'), '模板：備戰蓋牌內層 class 未改名');
check(SRC.includes("class:layout-fable={battleLayout === 'fable'}"), '模板：.playmat 的 layout-fable class 綁定仍在');

// ───────────────────────【B】桌墊版 CSS 兩條 ───────────────────────
console.log('【B】桌墊版高度自適應 CSS');
const mRows = SRC.match(/(:global\(\.battle-root\.tablet-layout:has\(\.playmat\.layout-tabletop\) \.playmat\))\{([^}]*)\}/);
check(!!mRows, 'tablet-layout 4-row 還原規則存在');
const mCompress = SRC.match(/(:global\(\.battle-root\.tablet-layout \.playmat\))\s*\{/);
check(!!mCompress, '（對手規則）tablet-layout 3-row 壓縮規則仍在（classic 沿用）');
if (mRows && mCompress) {
  check(/grid-template-rows:auto auto auto auto/.test(mRows[2]), '還原為 4 個 auto row');
  check(classCount(mRows[1]) > classCount(mCompress[1]), 'specificity：還原規則 class 數高於壓縮規則（誰後誰前都贏）');
}
const mHeight = SRC.match(/:global\(\.battle-root\.zoomed:has\(\.playmat\.layout-tabletop\)\)\{([^}]*)\}/);
check(!!mHeight, 'zoom 高度換算規則存在');
if (mHeight) {
  check(/calc\(100dvh \/ var\(--game-zoom, 1\)\)/.test(mHeight[1]) && /overflow:hidden/.test(mHeight[1]),
    '高度 = 100dvh / zoom + overflow:hidden（縮小後恰好填滿視窗）');
}
// 接線：--game-zoom 與 .zoomed 由模板供給
check(SRC.includes('style="--game-zoom: {gameZoom};"'), '模板：--game-zoom 綁定仍在');
check(SRC.includes('class:zoomed={gameZoom !== 1}'), '模板：.zoomed class 綁定仍在');
check(/:global\(\.battle-root\.zoomed\)\s*\{\s*zoom: var\(--game-zoom, 1\);/.test(SRC), '.zoomed 的 zoom 規則仍在');

// ───────────────────────【B】fable <1024 fallback 補洞 ───────────────────────
console.log('【B】fable fallback 補洞');
const iMedia = SRC.indexOf('@media (max-width: 1023px){');
check(iMedia > 0, 'fable fallback media 區塊存在');
const mediaWin = SRC.slice(iMedia, iMedia + 5000);
const iBaseBench = SRC.indexOf('flex:none; width:auto; min-width:0; max-width:none;');
check(iBaseBench > 0, '（對手規則）fable 基礎 bench 槽 width:auto 仍在（>=1024 grid 用）');
const mBench = mediaWin.match(/\.playmat\.layout-fable \.zone-bench \.bench-slot,[\s\S]*?\.bench-empty\{([^}]*)\}/);
check(!!mBench, 'fallback bench 槽固定寬規則存在於 media 區塊內');
if (mBench) {
  check(/flex:0 0 var\(--card-w\)/.test(mBench[1]) && /width:var\(--card-w\)/.test(mBench[1]),
    'bench 槽 flex-basis/width = var(--card-w)（空槽不再塌成細條）');
  check(mediaWin.includes('.zone-bench.bench-extended .bench-slot'), 'bench-extended 變體也涵蓋（8 備戰）');
  check(iMedia > iBaseBench, 'cascade：media 區塊在基礎規則之後（同 specificity 靠順序取勝）');
}
check(/\.playmat\.layout-fable \.action-bar > \.log-col\{ flex:1 1 100%;[^}]*max-height:220px/.test(mediaWin),
  'fallback log-col 滿寬限高（不再浮在畫面中間）');
check(mediaWin.includes('.playmat.layout-fable > .action-bar{ flex-wrap:wrap; }'), 'fallback action-bar 可換行');

// ─────────────────────── 手機直式分支純淨 ───────────────────────
console.log('手機直式分支純淨');
const mob = fs.readFileSync(path.join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
check(!mob.includes('battleLayout'), 'MobilePortraitBattle 不讀 battleLayout（預設值變更零影響）');
check(!mob.includes('v6.223'), 'MobilePortraitBattle 本版零改動');

// ─────────────────────── 版本一致 ───────────────────────
console.log('版本一致');
const ver = fs.readFileSync(path.join(ROOT, 'src/lib/version.ts'), 'utf8');
check(ver.includes("VERSION = '6.223'"), 'version.ts = 6.223');
try {
  const adm = fs.readFileSync(path.join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  check(adm.includes("SITE_VERSION_HINT = '6.223'"), 'admin.html SITE_VERSION_HINT = 6.223');
} catch { console.log('  （admin.html 不在此樹，跳過）'); }
try {
  const cl = fs.readFileSync(path.join(ROOT, 'static/changelog.html'), 'utf8');
  check(cl.includes('v6.223'), 'changelog 有 v6.223 條目');
  check((cl.match(/<details/g) || []).length === 50, 'changelog 條目數 = 50');
  check((cl.match(/<details open>/g) || []).length === 1, 'changelog 恰一則 open');
} catch { console.log('  （changelog 不在此樹，跳過）'); }

console.log(`\n${fails === 0 ? '✅' : '❌'} v6223 layout guards: ${passes} pass / ${fails} fail`);
if (fails > 0) process.exit(1);
