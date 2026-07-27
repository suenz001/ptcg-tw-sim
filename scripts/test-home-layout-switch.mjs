// 守衛：首頁版面（v6.044 起為**單一版面**）。
//
// 沿革：v6.042 曾同時提供新舊兩版與切換鈕；Wilson 實測後認為兩版差異不大，
// 決定只保留新版並移除切換機制。這支測試因此從「雙版面契約」改寫成
// 「單一版面 + 不可有殘留的切換程式碼」。
//
// 保留的**回歸保護**（改版前後都必須 PASS）：四個入口連結、連結的 base 前綴、
// 強制更新鈕、changelog 的 class 名、SEO 文字、共用區塊只有一份、能真的編譯。
//
// ⚠為什麼用原始碼分析而不是 DOM 渲染測試：這個專案沒有 Svelte 元件測試的基礎建設
//   （既有 UI 類守衛如 test-admin-helper-scope 也是掃原始碼）。但**編譯**是真的跑。
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
const CARDS = readFileSync(join(ROOT, 'src/routes/cards/+page.svelte'), 'utf8');
const GAME = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('⭐⭐首頁只有單一版面（切換機制必須完全移除，不可留半套）', () => {
  for (const dead of ['homeLayout', 'ptcg_home_layout', 'setHomeLayout', 'hm-switch', 'hm-try-btn']) {
    assert.ok(!SRC.includes(dead),
      `殘留了已移除的版面切換程式碼「${dead}」—— 半移除會留下永遠走不到的死碼`);
  }
  assert.ok(!/\{:else\}/.test(SRC.slice(SRC.indexOf('<main'), SRC.indexOf('community-section'))),
    '入口區不該還有新舊分支');
});

T('⭐⭐強制更新鈕必須在最上方的 hero 內（玩家一進站就要按得到）', () => {
  const n = (SRC.match(/onclick=\{hardRefresh\}/g) ?? []).length;
  assert.equal(n, 1, `強制更新鈕應恰好一顆，實得 ${n} 顆`);
  const iHero = SRC.indexOf('<div class="hm-hero">');
  const iHeroEnd = SRC.indexOf('</div>', SRC.indexOf('hm-refresh-top'));
  const iBtn = SRC.indexOf('onclick={hardRefresh}');
  assert.ok(iHero > 0 && iBtn > iHero && iBtn < SRC.indexOf('<nav class="hm-grid"'),
    '強制更新鈕必須位於 hero 區塊內、且在四個入口之前 —— '
    + '它是 iOS PWA 卡在舊版時唯一的自救管道，藏在頁尾玩家找不到');
});

T('⭐⭐四個入口連結都在，且都帶 base 前綴（漏了測試站子路徑會 404）', () => {
  for (const path of ['/cards', '/decks', '/game', '/tournament']) {
    assert.ok(SRC.includes(`href="{base}${path}"`), `缺少入口 ${path}`);
  }
  const bad = [...SRC.matchAll(/href="\/(cards|decks|game|tournament)"/g)].map((m) => m[0]);
  assert.deepEqual(bad, [], '這些連結沒有 {base} 前綴：' + bad.join('、'));
});

T('⭐賽事入口已正名為「錦標賽」，且不再有 Beta 或「單敗淘汰」字樣', () => {
  assert.ok(SRC.includes('錦標賽'), '應顯示「錦標賽」');
  assert.ok(!SRC.includes('淘汰賽測試'), '舊名稱應已移除');
  assert.ok(!/beta-tag/.test(SRC), 'Beta 標籤應已移除 —— 賽事已是正式功能');
  assert.ok(!SRC.includes('單敗淘汰'), '賽制不只單敗淘汰（另有瑞士制），不應只寫單敗淘汰');
});

T('⭐changelog 仍用 .changelog-list（admin 的覆寫樣式是 :global 綁在這個 class）', () => {
  assert.ok(/class="changelog-list"/.test(SRC), 'class 名不可改');
  assert.ok(/\.changelog-list :global\(details\)/.test(SRC), ':global 樣式規則要還在');
});

T('⭐SEO 的 h1 與關鍵字副標仍在', () => {
  assert.ok(SRC.includes('PTCG 實體賽事演練'), 'h1 主標題');
  assert.ok(SRC.includes('Pokémon TCG Simulator'), '關鍵字副標');
});

T('⭐社群／更新紀錄／意見回饋／免責聲明各只有一份', () => {
  for (const [name, mark] of [['社群', 'community-section'], ['更新紀錄', 'changelog-section'],
                              ['意見回饋', 'feedback-section'], ['免責聲明', 'disclaimer']]) {
    // ⚠精確匹配整個 class 值：`class="disclaimer` 這個前綴也會命中 disclaimer-title
    const n = (CARDS === null ? 0 : (SRC.match(new RegExp(`class="${mark}"`, 'g')) ?? []).length);
    assert.equal(n, 1, `${name}區塊應只有一份，實得 ${n} 份`);
  }
});

T('⭐新版樣式不得讓「裝整段文字的容器」變成 flex（v6.030 爆版根因）', () => {
  const i = SRC.indexOf('.hm-hero-text {');
  assert.ok(i > 0, '應有 hero 文字容器');
  assert.ok(!/display:\s*(flex|grid)/.test(SRC.slice(i, i + 160)),
    'hero 文字容器不可設 flex/grid');
});

// ══ 卡牌頁（v6.044 手機密度 + modal 配色修正）══════════════════════
T('⭐⭐卡牌頁手機密度：卡包 2 欄、卡片 3 欄', () => {
  assert.ok(/\.setGrid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(CARDS),
    '手機卡包列表應為 2 欄（原本 minmax(180px) 在手機只放得下 1 個）');
  assert.ok(/\.grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/.test(CARDS),
    '手機卡片牆應為 3 欄（原本 minmax(140px) 在手機只有 2 張）');
});

T('⭐⭐卡牌頁 modal 是白底，內部元件不可用深色主題的淺藍字（對比過低看不見）', () => {
  assert.ok(/\.modalInner \{\s*background: #fff/.test(CARDS), '前提：modal 是白底');
  const navIdx = CARDS.indexOf('.modal-nav {');
  const evoIdx = CARDS.indexOf('.evo-card-link {');
  for (const [name, i] of [['modal-nav', navIdx], ['evo-card-link', evoIdx]]) {
    assert.ok(i > 0, `應有 ${name}`);
    const block = CARDS.slice(i, i + 400);
    assert.ok(!/color:\s*#cce0ff/.test(block),
      `${name} 用了 #cce0ff（對戰頁深色主題的淺藍字），在白底 modal 上幾乎看不見`);
    assert.ok(!/background:\s*rgba\(255, 255, 255, 0\.0/.test(block),
      `${name} 用了近乎透明的白底，在白底 modal 上等於沒有背景`);
  }
});

T('⭐卡牌頁 CSS class 名必須真的存在（寫錯只會靜默失效）', () => {
  // 實際 class 是 cardLabel（駝峰），第一版寫成 card-label 完全沒作用
  assert.ok(CARDS.includes('class="cardLabel"'), '模板應有 cardLabel');
  assert.ok(/\.cardLabel \{ font-size/.test(CARDS), '手機樣式應套在 cardLabel 上');
});

// ══ 對戰頁 ══════════════════════════════════════════════════════════
T('⭐對戰頁不再有過時的「M3 NEW」徽章', () => {
  assert.ok(!GAME.includes('M3 NEW'), 'M3 是很久以前的事了，徽章應已移除');
});

T('⭐⭐三個頁面都真的編譯得過', () => {
  for (const [nm, src] of [['首頁', SRC], ['卡牌頁', CARDS], ['對戰頁', GAME]]) {
    const r = compile(src, { generate: 'client', filename: nm });
    assert.ok(r.js?.code, `${nm} 應產出 JS`);
  }
  console.log('   首頁／卡牌頁／對戰頁 皆編譯通過');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
