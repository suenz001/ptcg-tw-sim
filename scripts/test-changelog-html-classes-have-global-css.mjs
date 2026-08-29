/**
 * v6.133 守衛：`static/changelog.html` / `changelog-archive.html` 用到的每個 class，
 * 都必須在首頁 `src/routes/+page.svelte` 有對應的 `:global(...)` 規則。
 *
 * 為什麼會有這張網：
 *   首頁的 changelog 是用 `fetch()` + `{@html}` 注入的（v5.969 為了縮小 bundle）。
 *   **Svelte 的 scoped CSS 只作用在編譯期就存在的標記上** —— 執行期注入的 HTML 拿不到 scope hash，
 *   所以樣式一律要寫成 `.changelog-list :global(...)`。
 *   ⇒ 在 changelog.html 裡用一個沒寫 :global 規則的 class，**不會報錯、不會壞版**，
 *     只是那段文字安靜地變成瀏覽器預設樣式（1rem），跟周圍 0.85~0.9rem 的字並排就特別大。
 *   v6.129 起我用 `<div class="log-body">` 放補充說明，卻忘了加規則 —— 四則紀錄的字都爆掉，
 *   直到站長回報才發現。這種「不會壞、只是變醜」的缺陷靠人眼很難每次都抓到，交給守衛。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const PAGE = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8');
ok(PAGE.length > 20000, `+page.svelte 只讀到 ${PAGE.length} bytes → 疑似被 mount 截斷，掃描不可信`);

// 首頁所有 :global(...) 裡出現的 class 名
const globalClasses = new Set();
for (const m of PAGE.matchAll(/:global\(([^)]*)\)/g)) {
  for (const c of m[1].matchAll(/\.([A-Za-z_][\w-]*)/g)) globalClasses.add(c[1]);
}
ok(globalClasses.size >= 2, `首頁 :global() 只掃到 ${globalClasses.size} 個 class → 掃描器壞了，不是「乾淨」`);

// ⚠ 只掃 changelog.html —— 它是**片段**，被首頁 fetch + {@html} 注入，所以吃的是首頁的 CSS。
//   `changelog-archive.html` 是 `<!DOCTYPE html>` 開頭的**獨立完整頁面**，有自己的 <style>，
//   不走首頁的 :global，納進來只會產生假 FAIL（第一版就是這樣紅了 4 條）。
// v6.264：changelog-bodies.html（較舊條目的內文，展開才抓）同樣是被注入首頁的**片段**，
//   吃的也是首頁的 :global 樣式 ⇒ 必須一起掃（掃描面積只增不減）。
const FILES = ['static/changelog.html', 'static/changelog-bodies.html'];
let scannedClasses = 0;
for (const f of FILES) {
  const p = join(ROOT, f);
  if (!existsSync(p)) { ok(false, `${f} 不存在`); continue; }
  const html = readFileSync(p, 'utf8');
  ok(html.length > 1000, `${f} 只讀到 ${html.length} bytes → 疑似截斷`);
  const used = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].trim().split(/\s+/)) if (c) used.add(c);
  }
  ok(used.size > 0, `${f} 掃不到任何 class → 掃描器錨點失效`);
  for (const c of used) {
    scannedClasses++;
    ok(globalClasses.has(c),
      `${f} 用了 class="${c}"，但首頁 +page.svelte 沒有對應的 :global(.${c}) 規則。`
      + `\n         changelog 是 {@html} 注入的 → Svelte scoped CSS 對它無效，沒寫 :global 就等於**沒有樣式**，`
      + `\n         那段文字會安靜地變成瀏覽器預設大小（1rem），跟周圍 0.85~0.9rem 的字並排會明顯過大。`
      + `\n         （v6.129 的 .log-body 就是這樣爆掉四則紀錄的。）`);
  }
}
ok(scannedClasses >= 3, `只檢查了 ${scannedClasses} 個 class 用例 → 掃描器可能失效`);

// archive 的前提檢查：它必須仍是「有自己 <style> 的獨立頁面」。
//   哪天若被改成片段（像 changelog.html 那樣被注入），就得納回上面的 FILES 一起掃。
{
  const ap = join(ROOT, 'static/changelog-archive.html');
  if (existsSync(ap)) {
    const a = readFileSync(ap, 'utf8');
    ok(/^<!DOCTYPE html>/i.test(a.trimStart()) && /<style/.test(a),
      'changelog-archive.html 不再是「有自己 <style> 的獨立頁面」→ 它現在可能也需要首頁的 :global 規則，'
      + '請把它加回本守衛的 FILES 一起掃描');
  }
}

// 自我驗證：判準要抓得到刻意植入的違規，也不得誤判合法的
{
  const fakeGlobals = new Set(['ver-badge']);
  ok(!fakeGlobals.has('log-body'), '正對照：未定義的 class 必須被判為違規');
  ok(fakeGlobals.has('ver-badge'), '反向對照：已定義的 class 不得被誤判');
  const m = ':global(.a-b_c)'.match(/:global\(([^)]*)\)/);
  const got = [...m[1].matchAll(/\.([A-Za-z_][\w-]*)/g)].map(x => x[1]);
  ok(got[0] === 'a-b_c', '正對照：class 名的 - 與 _ 必須被完整抽出（否則會漏判）');
}

console.log(`\nv6133 changelog class 樣式完整性：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
