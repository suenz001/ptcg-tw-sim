// v6.030 守衛：首頁「更新記錄」的內容一定能正確渲染。
//
// 真實事故（Wilson 回報 v6.028 那條排版非常奇怪）：
//   `.changelog-list :global(summary)` 被設成 `display:flex; gap:.5rem`，
//   但 changelog 的 <summary> 裝的是**整段文字**——flex 會把裡面每個 inline 元素
//   （<b>、<br>）以及被它們切開的文字節點，各自變成一個獨立的 flex item，
//   各佔一欄、還被塞進 gap 空隙 → 整條排版爆掉。
//   ⚠這不會有任何錯誤訊息，也不影響 build，只有肉眼看得出來 → 用靜態守衛釘住前提。
//
// 附帶鎖住第二個坑：changelog.html 是**以 {@html} 直接插入的 HTML**，
//   寫 markdown 的 `**粗體**` 不會被渲染，會原樣顯示成星號（曾有 3 處中招）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const page = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8');
const log = readFileSync(join(ROOT, 'static/changelog.html'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

/** 取出 `.changelog-list :global(<sel>) { ... }` 這條規則的宣告內容。 */
function ruleFor(sel) {
  const needle = `.changelog-list :global(${sel}) {`;
  const i = page.indexOf(needle);
  assert.ok(i > 0, '應存在 CSS 規則 ' + sel);
  return page.slice(i + needle.length, page.indexOf('}', i));
}

T('前提：changelog 以 {@html} 插入，且有 :global 樣式（本檢查才有意義）', () => {
  assert.ok(page.includes('{@html changelogBuiltin}'), 'changelog 應以 {@html} 插入');
  assert.ok(page.includes('.changelog-list :global(summary)'), '應有 summary 的 :global 樣式');
});

T('⭐changelog 的 summary 不可是 flex/grid 容器（裡面是整段含 inline 標籤的文字，會被切成一格格）', () => {
  const decl = ruleFor('summary');
  const m = /display\s*:\s*([\w-]+)/.exec(decl);
  const display = m ? m[1] : 'block';
  assert.ok(!['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display),
    `summary 的 display 是 ${display} → 內含的 <b>/<br> 與文字會各自成為獨立的排版格。實際宣告：${decl.trim()}`);
  assert.ok(!/[^-]gap\s*:/.test(decl), 'summary 不該有 gap（那是 flex/grid 專用，會在每塊之間插空隙）');
});

T('三角圖示與版本徽章要能排在文字句首（inline-block，不依賴 flex）', () => {
  for (const sel of ['summary::before', '.ver-badge']) {
    const decl = ruleFor(sel);
    assert.ok(/display\s*:\s*inline-block/.test(decl), sel + ' 應為 inline-block，實際：' + decl.trim().slice(0, 120));
    assert.ok(!/flex-shrink/.test(decl), sel + ' 不該留著 flex-shrink（flex 專用的殘留宣告）');
  }
});

T('⭐changelog.html 不可出現 markdown 的 **粗體**（以 HTML 插入，星號會原樣顯示出來）', () => {
  const hits = [...log.matchAll(/\*\*([^*\n]{1,60})\*\*/g)].map((m) => m[1]);
  assert.deepEqual(hits, [], '請改用 <b>…</b>；這些會顯示成字面的星號：' + hits.join('、'));
});

T('changelog.html 的 details/summary 標籤成對（缺一個會吃掉後面所有條目）', () => {
  const cnt = (re) => (log.match(re) || []).length;
  assert.equal(cnt(/<details\b/g), cnt(/<\/details>/g), '<details> 開合數量不符');
  assert.equal(cnt(/<summary\b/g), cnt(/<\/summary>/g), '<summary> 開合數量不符');
  assert.ok(cnt(/<details\b/g) > 10, '應有多筆更新記錄，實得 ' + cnt(/<details\b/g));
  console.log('   更新記錄條目數：' + cnt(/<details\b/g));
});

T('每個條目都有版本徽章（首頁靠它顯示版本號）', () => {
  const entries = [...log.matchAll(/<summary>([\s\S]*?)<\/summary>/g)];
  const bad = entries.map((m, i) => (/ver-badge">v[\d.]+</.test(m[1]) ? null : i + 1)).filter(Boolean);
  assert.deepEqual(bad, [], '這幾筆（由上往下數）缺版本徽章：' + bad.join('、'));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
