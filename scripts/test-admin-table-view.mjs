// v1.60 守衛：admin 中央「排序 → 搜尋 → 分頁」單向管線（tv）。
//
// 這張網釘住 Wilson 回報的核心 bug：**排序完再翻頁，會退回原本的排序方式翻頁。**
//   舊機制 _tsSortTable 是 DOM 就地排序（appendChild 重排 + 狀態存在 <table data-sort-col>），
//   任何重新渲染都會把 DOM 與那個屬性一起洗掉 → 回到資料的原始順序。
//   新管線把排序放回資料層：filter → sort → slice，翻頁只動 page，排序自然保持。
//
// 直接從 admin.html 抽出真正的函式來跑（不是複製一份邏輯），避免測試與實作漂移。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

/** 從 admin.html 抽出一個頂層 function 宣告（到同縮排的收尾大括號）。 */
function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i > 0, name + ' 應存在於 admin.html');
  const end = src.indexOf('\n}', i);
  assert.ok(end > i, name + ' 找不到結尾');
  return src.slice(i, end + 2);
}

// 只抽不碰 DOM 的部分：registry + define + view。render/pager 需要 document，另以靜態檢查覆蓋。
const api = new Function(`
  const TV_PAGE_SIZE = 50;
  const tableViews = Object.create(null);
  ${grabFn('tvDefine')}
  ${grabFn('tvView')}
  function tvRender() { /* 測試中不渲染 DOM */ }
  function tvSetRows(id, rows) { tableViews[id].rows = rows || []; }
  const window = { };
  ${src.slice(src.indexOf('window.tvSort = function'), src.indexOf('window.tvRender = tvRender;'))}
  return { tableViews, tvDefine, tvView, tvSetRows, ...window };
`)();

/** 建一張測試表：名稱刻意與分數反向，才能分辨排序有沒有真的套用。
 *  ⚠每次都先清掉 registry —— tvDefine 會**刻意保留**上一次的排序/頁碼（這是產品行為：
 *  切走分頁再切回來不該被重置），不清的話各個 case 會互相污染。 */
function makeView(n = 120, keepState = false) {
  if (!keepState) delete api.tableViews.t;
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ name: 'p' + String(n - i).padStart(3, '0'), score: i, note: i % 2 ? 'even' : 'odd' });
  api.tvDefine({
    id: 't',
    columns: { name: { get: (r) => r.name, str: true }, score: { get: (r) => r.score } },
    defaultSort: ['score', 'desc'],
    searchText: (r) => (r.name + ' ' + r.note).toLowerCase(),
    mount: () => null,
    render: () => '',
  });
  api.tvSetRows('t', rows);
  return rows;
}

T('前提：admin.html 內確實有 tv 管線（本檢查才有意義）', () => {
  for (const f of ['tvDefine', 'tvView', 'tvSetRows', 'tvRender', 'tvPagerHtml', 'tvTh', 'tvSearchBox']) {
    assert.ok(src.includes('function ' + f + '('), '應有 ' + f);
  }
  for (const w of ['tvSort', 'tvPage', 'tvSearch', 'tvJump']) {
    assert.ok(src.includes('window.' + w + ' ='), w + ' 必須掛在 window（inline on* 才找得到）');
  }
});

T('每頁 50 筆（Wilson 指定的頁大小）', () => {
  makeView(120);
  const v = api.tvView('t');
  assert.equal(v.pageRows.length, 50);
  assert.equal(v.total, 120);
  assert.equal(v.totalPages, 3);
});

T('⭐⭐核心回歸鎖：先排序、再翻頁 → 第 2 頁必須延續排序，不可退回原始順序', () => {
  makeView(120);
  api.tvSort('t', 'name');                       // 依名稱升冪（與資料原始順序相反）
  const p1 = api.tvView('t').pageRows.map((r) => r.name);
  api.tvPage('t', 2);
  const p2 = api.tvView('t').pageRows.map((r) => r.name);

  assert.equal(api.tableViews.t.sortKey, 'name', '翻頁後排序欄位不可被重置');
  assert.equal(api.tableViews.t.sortDir, 'asc', '翻頁後排序方向不可被重置');
  // 第 2 頁的第一筆，必須正好接在第 1 頁最後一筆之後
  assert.ok(p1[49] < p2[0], `第2頁應延續排序：第1頁末筆=${p1[49]}、第2頁首筆=${p2[0]}`);
  // 而且整體仍是升冪
  assert.deepEqual(p2, [...p2].sort(), '第 2 頁自身也必須是排序後的結果');
  // 若排序被打回原序，第 2 頁首筆會是 p070 這種「資料原始順序」的值 → 用它當反例
  assert.notEqual(p2[0], 'p070', '第 2 頁不該回到資料的原始順序');
});

T('⭐同欄再點一次＝反向；換欄位＝回第一頁', () => {
  makeView(120);
  api.tvSort('t', 'name'); assert.equal(api.tableViews.t.sortDir, 'asc');
  api.tvSort('t', 'name'); assert.equal(api.tableViews.t.sortDir, 'desc', '同欄再點應反向');
  api.tvPage('t', 3);
  api.tvSort('t', 'score');
  assert.equal(api.tableViews.t.page, 1, '換排序欄位應回到第 1 頁（否則會看到空白頁）');
  assert.equal(api.tableViews.t.sortDir, 'desc', '數值欄預設由大到小');
});

T('⭐搜尋 + 排序 + 翻頁三者可同時成立', () => {
  makeView(120);
  api.tvSort('t', 'name');
  api.tvSearch('t', 'even');                    // 只留一半
  const v = api.tvView('t');
  assert.equal(v.total, 60, '搜尋應縮小結果集');
  assert.equal(api.tableViews.t.page, 1, '搜尋應回到第 1 頁');
  assert.equal(api.tableViews.t.sortKey, 'name', '搜尋不可清掉排序');
  api.tvPage('t', 2);
  const p2 = api.tvView('t').pageRows.map((r) => r.name);
  assert.deepEqual(p2, [...p2].sort(), '搜尋後翻頁仍要維持排序');
});

T('搜尋把結果縮到剩一頁時，頁碼要夾回範圍內（不會停在空白頁）', () => {
  makeView(120);
  api.tvPage('t', 3);
  api.tableViews.t.search = 'p001';             // 直接設值以跳過 tvSearch 的 page=1
  const v = api.tvView('t');
  assert.equal(v.page, 1, '頁碼應被夾回，實得 ' + v.page);
  assert.ok(v.pageRows.length > 0, '不該顯示空白頁');
});

T('空值一律排最後（升冪降冪都是）——「沒有資料」不該被當成最小值衝到第一名', () => {
  api.tvDefine({
    id: 'n', columns: { v: { get: (r) => r.v } }, defaultSort: ['v', 'desc'],
    mount: () => null, render: () => '',
  });
  api.tvSetRows('n', [{ v: 5 }, { v: null }, { v: 9 }, { v: undefined }, { v: 1 }]);
  const desc = api.tvView('n').pageRows.map((r) => r.v);
  assert.deepEqual(desc.slice(0, 3), [9, 5, 1]);
  assert.ok(desc[3] == null && desc[4] == null, '空值應在最後');
  api.tvSort('n', 'v');   // 轉升冪
  const asc = api.tvView('n').pageRows.map((r) => r.v);
  assert.deepEqual(asc.slice(0, 3), [1, 5, 9]);
  assert.ok(asc[3] == null && asc[4] == null, '升冪時空值仍應在最後');
});

T('重新註冊同一張表時保留使用者的排序與頁碼（切走再切回來不會被重置）', () => {
  makeView(120);
  api.tvSort('t', 'name');
  api.tvPage('t', 2);
  makeView(120, true);    // 模擬 re-render 時重新 tvDefine（不清 registry）
  assert.equal(api.tableViews.t.sortKey, 'name');
  assert.equal(api.tableViews.t.page, 2);
});

// ── 靜態檢查：需要 DOM 的部分 ──
T('⭐搜尋框必須放在 mount 容器之外（放裡面會每敲一鍵就失去輸入焦點）', () => {
  // tvSearchBox 的呼叫點都不可以出現在 tv render 的字串裡
  const renders = [...src.matchAll(/render:\s*\(v(?:,\s*tv)?\)\s*=>([\s\S]{0,2000}?)\n\s{4}\},/g)].map((m) => m[1]);
  assert.ok(renders.length >= 3, '應抓得到多個 render 定義，實得 ' + renders.length);
  for (const r of renders) {
    assert.ok(!r.includes('tvSearchBox('), 'render 內不可出現 tvSearchBox（會失焦）');
  }
});

T('每張分頁表的 mount 佔位 div 都真的存在於渲染出的 HTML 裡', () => {
  const ids = [...src.matchAll(/getElementById\('tv-mount-(\w+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 5, '應有多張表接上 tv，實得 ' + ids.length);
  for (const id of new Set(ids)) {
    assert.ok(src.includes('id="tv-mount-' + id + '"') || src.includes("id=\\'tv-mount-" + id),
      'tv-mount-' + id + ' 有 mount() 卻找不到對應的佔位 div');
  }
  console.log('   已接上中央管線的表：' + [...new Set(ids)].join('、'));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
