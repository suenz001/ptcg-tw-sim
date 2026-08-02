// v6.100 首頁更新記錄精簡（Wilson 交辦：只顯示跟玩家有關的內容、約留最新 50 則）
//
// 背景：changelog.html 曾累積到 228 則 / 173KB，且**每次進站都會整份載入**（首頁 fetch + {@html}）
//   —— 這與 v5.893「進站越來越慢」同源。本版拆成：
//     ・static/changelog.html         ＝ 最近 50 則，敘述改寫成玩家視角
//     ・static/changelog-archive.html ＝ 完整歷史（獨立頁面，只有點連結時才載入）
//
// ⚠ changelog.html 是靜態片段、用 {@html} 插進首頁，**裡面寫不了 svelte 的 {base}**，
//   所以封存連結先寫成 `__BASE__/changelog-archive.html`，由 +page.svelte 載入時 replaceAll。
//   → 這支守衛把「則數上限／檔案大小／佔位字串兩端都在／封存頁完整」四件事一起鎖住。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CL = join(ROOT, 'static/changelog.html');
const AR = join(ROOT, 'static/changelog-archive.html');
const PAGE = join(ROOT, 'src/routes/+page.svelte');
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const cl = readFileSync(CL, 'utf8');
const countEntries = (s) => (s.match(/class="ver-badge"/g) || []).length;

T('① 首頁 changelog 則數 ≤ 50（Wilson 指定「約 50 則」）', () => {
  const n = countEntries(cl);
  assert.ok(n > 0 && n <= 50, '實際 ' + n + ' 則（超過就該把最舊的搬進 changelog-archive.html）');
});
T('② 首頁 changelog 檔案 < 60KB（原本 173KB 會拖慢進站）', () => {
  const kb = statSync(CL).size / 1024;
  assert.ok(kb < 60, '實際 ' + kb.toFixed(1) + 'KB');
});
T('③ 底部有「完整更新歷史」連結，且用 __BASE__ 佔位（GitHub Pages 有子路徑前綴）', () => {
  assert.ok(cl.includes('__BASE__/changelog-archive.html'),
    '封存連結必須寫成 __BASE__/changelog-archive.html —— 寫死絕對路徑在測試站(子路徑)會 404');
});
T('④ +page.svelte 有把 __BASE__ 換成實際 base（少了這行連結就會壞）', () => {
  const src = readFileSync(PAGE, 'utf8');
  assert.ok(/replaceAll\(\s*['"]__BASE__['"]\s*,\s*base\s*\)/.test(src),
    '+page.svelte 載入 changelog.html 後必須 replaceAll(\'__BASE__\', base)');
});
T('⑤ changelog-archive.html 存在、是可直接開啟的完整頁面、且保留了完整歷史', () => {
  assert.ok(existsSync(AR), 'static/changelog-archive.html 必須存在');
  const ar = readFileSync(AR, 'utf8');
  assert.ok(/^<!DOCTYPE html>/i.test(ar.trim()), '封存頁必須是完整 HTML（會被直接開啟，不是片段）');
  assert.ok(ar.includes('<title>'), '應有 title');
  assert.ok(ar.includes('href="./"'), '應有返回首頁連結');
  const n = countEntries(ar);
  assert.ok(n >= countEntries(cl), '封存頁則數(' + n + ') 應 ≥ 首頁則數(' + countEntries(cl) + ')');
  assert.ok(n >= 200, '封存頁應保留完整歷史（≥200 則），實際 ' + n + ' —— 舊紀錄不可以被刪掉');
});
T('⑥ 首頁 changelog 不得再出現偏技術面的字眼（Wilson：只顯示跟玩家有關的內容）', () => {
  // ⚠ 這是「玩家視角」的硬性檢查：新增條目若寫了根因/內部名稱會被擋下。
  const BAD = ['根因', '中央收斂', '收斂到', '守衛', 'resolver', 'effectKey', 'commit',
               'bundle', 'TS2304', 'helper', '程式碼', '重構'];
  const hit = BAD.filter(w => cl.includes(w));
  assert.strictEqual(hit.length, 0,
    '出現技術用語：' + hit.join('、') + ' —— 更新記錄請只寫「玩家會看到什麼變化」');
});
T('⑦ 每一則都有標題（<b>…</b>），不會出現空白條目', () => {
  const blocks = cl.split('<details').slice(1);
  const bad = blocks.filter(b => !/<b>[^<]/.test(b.slice(0, 400)) && b.includes('ver-badge'));
  assert.strictEqual(bad.length, 0, bad.length + ' 則沒有標題');
});
console.log(`\n=== v6.100 changelog 精簡與封存: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
