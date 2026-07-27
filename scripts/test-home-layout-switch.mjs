// 守衛：首頁雙版面切換（v6.042）。
//
// 需求：新版現代化首頁 + 保留舊版 + 一鍵互切 + 記住玩家選擇（下次開啟沿用）。
//
// 這支同時做兩件事：
//   ① **新機制**的斷言（在改版前的程式碼上天然 FAIL —— 機制根本不存在）。
//   ② **回歸保護**：證明舊版真的「一字未動」—— 四個入口連結、強制更新鈕、
//      changelog 的 class 名都必須完好。這組在改版前後都要 PASS。
//
// ⚠為什麼用原始碼分析而不是 DOM 渲染測試：這個專案沒有 Svelte 元件測試的基礎建設
//   （既有測試都是 node + esbuild 跑 .ts 邏輯，UI 類守衛如 test-admin-helper-scope
//   也是掃原始碼）。硬加一套 jsdom/testing-library 會是比這次改版更大的變動。
//   但**編譯**是真的跑：用 svelte compiler 編一次，確保不是只有字串對得上而已。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createRequire } from 'node:module';
// ⚠用 CJS require 載入 svelte compiler：在本專案的沙盒測試環境（node_modules 為 symlink）
//   `import('svelte/compiler')` 會直接卡住不回應，CJS 路徑則正常。
const { compile } = createRequire(import.meta.url)('svelte/compiler');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ══ ① 新機制 ══════════════════════════════════════════════════════════
T('⭐⭐偏好存在 localStorage，key 沿用全站 ptcg_ 慣例', () => {
  assert.ok(/localStorage\.getItem\('ptcg_home_layout'\)/.test(SRC), '應讀 ptcg_home_layout');
  assert.ok(/localStorage\.setItem\('ptcg_home_layout'/.test(SRC), '切換時應寫回 ptcg_home_layout');
});

T('⭐⭐首次造訪（沒有偏好）預設新版', () => {
  assert.ok(/let homeLayout = \$state<'modern' \| 'classic'>\('modern'\)/.test(SRC),
    'homeLayout 的初始值應為 modern —— 預設舊版的話新版曝光率會趨近於零');
});

T("⭐⭐玩家選過舊版就必須記住（讀回時 'classic' 要生效）", () => {
  assert.ok(/_hl === 'classic'/.test(SRC) && /_hl === 'modern'/.test(SRC),
    '讀回時兩個合法值都要接受；只認一個等於另一個永遠失效');
  assert.ok(/homeLayout = _hl/.test(SRC), '讀回的值要真的套用');
});

T('⭐⭐偏好必須**同步**讀取，不可等 onMount（否則會先畫錯版面再跳掉）', () => {
  const iState = SRC.indexOf("let homeLayout = $state");
  const iRead = SRC.indexOf("localStorage.getItem('ptcg_home_layout')");
  const iMount = SRC.indexOf('onMount(');
  assert.ok(iState > 0 && iRead > iState, '應在 state 宣告後緊接著同步讀取');
  assert.ok(iRead < iMount,
    '讀取偏好的位置在 onMount 之後 —— 那會先用預設值畫一次，玩家會看到版面跳動');
});

T('⭐localStorage 失敗不可讓首頁掛掉（Safari 無痕模式會對 setItem 丟例外）', () => {
  const iRead = SRC.indexOf("localStorage.getItem('ptcg_home_layout')");
  const readBlock = SRC.slice(Math.max(0, iRead - 200), iRead + 260);
  assert.ok(/try\s*\{/.test(readBlock) && /catch/.test(readBlock), '讀取要包 try/catch');
  const iWrite = SRC.indexOf("localStorage.setItem('ptcg_home_layout'");
  const writeBlock = SRC.slice(iWrite - 60, iWrite + 200);
  assert.ok(/try\s*\{/.test(writeBlock) && /catch/.test(writeBlock), '寫入要包 try/catch');
});

T('⭐⭐兩個版面都存在，且互相可切', () => {
  assert.ok(/\{#if homeLayout === 'modern'\}/.test(SRC), '應有 modern 分支');
  assert.ok(/\{:else\}/.test(SRC), '應有 classic 分支');
  assert.ok(/setHomeLayout\('classic'\)/.test(SRC), '新版要有「切回舊版」的按鈕');
  assert.ok(/setHomeLayout\('modern'\)/.test(SRC), '舊版要有「試用新版」的入口，否則切回去就回不來了');
});

// ══ ② 回歸保護：舊版必須完好 ══════════════════════════════════════════
T('⭐⭐舊版四個入口連結一個都不能少', () => {
  for (const path of ['/cards', '/decks', '/game', '/tournament']) {
    const n = (SRC.match(new RegExp(`href="\\{base\\}${path}"`, 'g')) ?? []).length;
    assert.ok(n >= 2, `${path} 應在新舊兩版都有（實得 ${n} 處）`);
  }
});

T('⭐⭐所有入口連結都必須帶 base 前綴（漏了測試站會全部斷掉）', () => {
  // 測試站掛在 github.io 的 /ptcg-tw-sim 子路徑，硬寫 href="/cards" 在那裡是 404
  const bad = [...SRC.matchAll(/href="\/(cards|decks|game|tournament)"/g)].map((m) => m[0]);
  assert.deepEqual(bad, [],
    '這些連結沒有 {base} 前綴，在測試站（子路徑部署）會連不到：' + bad.join('、'));
});

T('⭐⭐強制更新鈕兩版都要有（iOS PWA 卡舊版時唯一的自救管道）', () => {
  const n = (SRC.match(/onclick=\{hardRefresh\}/g) ?? []).length;
  assert.ok(n >= 2, `強制更新鈕應在新舊兩版都存在，實得 ${n} 處`);
});

T('⭐changelog 仍用 .changelog-list（admin 的覆寫樣式是 :global 綁在這個 class）', () => {
  assert.ok(/class="changelog-list"/.test(SRC), 'class 名不可改');
  assert.ok(/\.changelog-list :global\(details\)/.test(SRC), ':global 樣式規則要還在');
});

T('⭐SEO 文字兩版都要保留（h1 與關鍵字副標是刻意加的）', () => {
  const h1 = (SRC.match(/PTCG 實體賽事演練/g) ?? []).length;
  assert.ok(h1 >= 2, `主標題應在兩版都出現，實得 ${h1} 次`);
  const sub = (SRC.match(/Pokémon TCG Simulator/g) ?? []).length;
  assert.ok(sub >= 2, `關鍵字副標應在兩版都出現，實得 ${sub} 次`);
});

T('⭐社群／更新紀錄／意見回饋／免責聲明維持共用（不可被複製成兩份）', () => {
  // 這些區塊刻意留在 {#if} 外面 —— 複製成兩份的話，日後改一處就會漂移
  for (const [name, mark] of [['社群', 'community-section'], ['更新紀錄', 'changelog-section'],
                              ['意見回饋', 'feedback-section'], ['免責聲明', 'disclaimer']]) {
    // ⚠要精確匹配整個 class 值：`class="disclaimer` 這個前綴也會命中
    //   disclaimer-title／disclaimer-section，第一版就是這樣誤判成 7 份。
    const n = (SRC.match(new RegExp(`class="${mark}"`, 'g')) ?? []).length;
    assert.equal(n, 1, `${name}區塊應只有一份（共用），實得 ${n} 份`);
  }
});

T('⭐⭐首頁真的編譯得過（不是只有字串對得上）', () => {
  const r = compile(SRC, { generate: 'client', filename: '+page.svelte' });
  assert.ok(r.js?.code, '應產出 JS');
  console.log(`   編譯通過，warnings ${r.warnings?.length ?? 0} 則（多為既有 unused CSS）`);
});

T('⭐新版樣式不得讓「裝整段文字的容器」變成 flex（v6.030 爆版根因）', () => {
  // v6.030：changelog 的 summary 設了 display:flex，裡面的 b 標籤與文字各自成為
  //   flex item，整段文字被拆開排版。凡是裝一整段文字的容器都不可 flex/grid。
  const i = SRC.indexOf('.hm-hero-text {');
  assert.ok(i > 0, '應有 hero 文字容器');
  const block = SRC.slice(i, i + 160);
  assert.ok(!/display:\s*(flex|grid)/.test(block),
    'hero 文字容器不可設 flex/grid —— 內含的 span/文字會各自成為獨立項目');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
