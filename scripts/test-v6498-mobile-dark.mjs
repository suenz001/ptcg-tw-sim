// ⭐v6.498 守衛：手機／平板深色主題（站長手機清單第 6 項：「深色主題目前只有電腦版（≥1024px）：手機沒有切換鈕、系統深色時仍是淺色」）
//
// 【A】五個頁面各有恰好一塊 v6498-mobile-dark 哨兵，裡面每條規則都以
//      :global(html[data-theme='dark']:not([data-ui-wide])) 開頭（手機淺色、網頁版都不成立），而且只有「顏色」宣告（不改版面）
// 【B】layout：深色時整頁底色＋color-scheme，條件相同且排除牌桌畫面
// 【C】底部導覽列有深色／淺色切換鈕，接 layout 同一個 toggleUiTheme；深色主題時導覽列本身也是深色
// 行為端（真瀏覽器、深淺兩種）由 test-v6474 E7/E7b、test-v6475 E6/E6b/E7/E7b、test-v6476 E3/E3b/E4/E4b 量測（Rule 40 已拆成兩條）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' :: ' + (e && e.message)); } };
const rd = (p) => { try { return readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
// ⭐v6.504（Rule 40）：站長要求全站版面統一 ⇒ 本區塊的條件放寬成手機不分深淺（手機淺色也讀同一套 --ui-* 色票）；仍只有顏色宣告、網頁版永遠不成立
const PREFIX = ":global(html:not([data-ui-wide]))";
const COLOR_PROPS = new Set(['color', 'background', 'background-color', 'background-image', 'border-color', 'border-top-color', 'border-bottom-color',
  'border-left-color', 'border-right-color', 'box-shadow', 'outline-color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', 'color-scheme', 'accent-color']);

// 每頁至少要有的關鍵選擇器（網頁版主題區塊抽出來的代表性元素）與規則數下限
const PAGES = [
  ['src/routes/+page.svelte', 50, ['.hm-card', '.hm-hero', '.changelog-list']],
  ['src/routes/cards/+page.svelte', 45, ['.controls', '.cardBtn', '.filter.active', '.modalInner', '.filterToggle']],
  ['src/routes/card/[id]/+page.svelte', 12, ['.body']],
  ['src/routes/decks/+page.svelte', 60, ['.rail', '.pk-chip', '.pk-filter-toggle', '.back']],
  ['src/routes/deck-posts/+page.svelte', 10, ['.post-card', '.toolbar', '.back']],
];

console.log('【A】各頁手機深色區塊');
for (const [file, minRules, keys] of PAGES) {
  const src = rd(file);
  const blocks = src.match(/  \/\* >>> v6498-mobile-dark \*\/\n[\s\S]*?  \/\* <<< v6498-mobile-dark \*\/\n/g) || [];
  T(`A ${file}：恰好一塊哨兵`, () => assert.equal(blocks.length, 1));
  const css = (blocks[0] || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  T(`A ${file}：規則數 ≥ ${minRules}（剝出來的不是空殼）`, () => assert.ok(rules.length >= minRules, String(rules.length)));
  T(`A ${file}：每個選擇器都以手機條件開頭（網頁版不成立；v6.504 起手機不分深淺）`, () => {
    const bad = [];
    for (const r of rules) for (const part of r.sel.split(/,(?![^(]*\))/)) if (!part.trim().startsWith(PREFIX)) bad.push(part.trim().slice(0, 60));
    assert.deepEqual(bad, []);
  });
  T(`A ${file}：只有顏色宣告（不改線寬、尺寸、版面）`, () => {
    const bad = [];
    for (const r of rules) for (const d of r.body.split(';')) {
      const p = d.split(':')[0].trim().toLowerCase();
      if (p && !COLOR_PROPS.has(p)) bad.push(p);
    }
    assert.deepEqual([...new Set(bad)], []);
  });
  T(`A ${file}：關鍵元素有深色樣式（${keys.join('、')}）`, () => {
    for (const k of keys) assert.ok(rules.some((r) => r.sel.includes(' ' + k)), '缺 ' + k);
  });
  T(`A ${file}：不新增 @media（本頁 @media 數量／桌機指紋有守衛）`, () => assert.ok(!/@media/.test(css)));
}

console.log('【B】layout');
const LAYOUT = rd('src/routes/+layout.svelte');
T('B1 深色時整頁底色吃主題（同條件、排除牌桌畫面）', () => {
  assert.ok(LAYOUT.includes(":global(html[data-ui-themed][data-theme='dark']:not([data-ui-wide]):not([data-battle-view]) body) { background: var(--ui-bg); color: var(--ui-text); }"));
  assert.ok(LAYOUT.includes(":global(html[data-ui-themed][data-theme='dark']:not([data-ui-wide]):not([data-battle-view])) { color-scheme: dark; }"));
});
T('B2 底部導覽列拿到 layout 同一個主題與切換函式', () => {
  assert.ok(LAYOUT.includes('<SiteBottomNav pathname={curPath} {base} theme={uiTheme} ontoggle={toggleUiTheme} />'));
});

console.log('【C】底部導覽列');
const NAV = rd('src/lib/SiteBottomNav.svelte');
T('C1 有深色／淺色切換鈕（aria-label 依目前主題）', () => {
  assert.match(NAV, /<button class="sbn-link sbn-theme" type="button" onclick=\{ontoggle\}/);
  assert.ok(NAV.includes("aria-label={theme === 'dark' ? '切換成淺色主題' : '切換成深色主題'}"));
});
T('C2 深色主題時導覽列本身也是深色', () => {
  assert.ok(NAV.includes(":global(html[data-theme='dark']) .sbn { background: rgba(16, 32, 22, 0.97);"));
});

console.log(`\n=== v6.498 手機深色主題：${pass} PASS / ${fail} FAIL ===`);
if (fail) process.exit(1);
