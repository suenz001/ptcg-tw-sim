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
// ⭐ v6.264：較舊條目的內文搬到 static/changelog-bodies.html（首頁展開才抓）。
//   ⚠ ⑥⑬ 這種「黑名單掃全文」的檢查若還是只掃 changelog.html，就等於**被放寬**
//     ——被搬走的那 30KB 內文從此沒人在看。改成兩份一起掃（掃描面積只增不減）。
const BD = join(ROOT, 'static/changelog-bodies.html');
const bodies = existsSync(BD) ? readFileSync(BD, 'utf8') : '';
const clAll = cl + '\n' + bodies;
const countEntries = (s) => (s.match(/class="ver-badge"/g) || []).length;

T('① 首頁 changelog 則數 ≤ 50（Wilson 指定「約 50 則」）', () => {
  const n = countEntries(cl);
  assert.ok(n > 0 && n <= 50, '實際 ' + n + ' 則（超過就該把最舊的搬進 changelog-archive.html）');
});
T('② 首頁 changelog 檔案 < 40KB（v6.264 收緊：原本 60KB 只差 4 bytes 就爆）', () => {
  // ⚠ v6.100 的門檻是 60KB，到 v6.263 已經逼到 61,436 / 61,440 bytes（剩 4 bytes）。
  //   v6.264 把「展開才看得到的內文」搬到 changelog-bodies.html 之後降到約 30KB，
  //   門檻同步收緊到 40KB —— {x : x < 40KB} ⊂ {x : x < 60KB}，**嚴格更緊，不是放寬**。
  const kb = statSync(CL).size / 1024;
  assert.ok(kb < 40, '實際 ' + kb.toFixed(1) + 'KB');
});
T('②b 搬出去的內文檔也要有上限（40KB），否則只是把成長換個地方繼續', () => {
  assert.ok(existsSync(BD), 'static/changelog-bodies.html 必須存在（v6.264 起）');
  const kb = statSync(BD).size / 1024;
  assert.ok(kb < 40, 'changelog-bodies.html 實際 ' + kb.toFixed(1) + 'KB');
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
               'bundle', 'TS2304', 'helper', '程式碼', '重構',
               // v6.121：只有站長需要知道的內部題材，一律不上首頁（寫進 docs/changelog-internal.md）
               '降載', '資料庫查詢', '輪詢', '索引', 'projection', 'API'];
  const hit = BAD.filter(w => clAll.includes(w));   // v6.264：含搬到 bodies 檔的內文
  assert.strictEqual(hit.length, 0,
    '出現技術用語：' + hit.join('、') + ' —— 更新記錄請只寫「玩家會看到什麼變化」');
});
T('⑦ 每一則都有標題（<b>…</b>），不會出現空白條目', () => {
  const blocks = cl.split('<details').slice(1);
  const bad = blocks.filter(b => !/<b>[^<]/.test(b.slice(0, 400)) && b.includes('ver-badge'));
  assert.strictEqual(bad.length, 0, bad.length + ' 則沒有標題');
});
// ⭐ v6.106（Wilson：「再簡化，只要讓玩家知道他們需要知道的事情就好」）
//   首頁每一則改成「一句話＋必要提醒」（約 40~80 字），來龍去脈／伺服器／程式細節
//   一律只寫進 docs/changelog-internal.md —— 內部檔不打包進網站、玩家看不到、
//   也不佔進站載入量。**新增條目時請照這個規格寫，別再寫成長篇說明。**
const entriesTxt = [...cl.matchAll(/<summary>([\s\S]*?)<\/summary>/g)]
  .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
// ⭐ v6.121（Wilson：「首頁 changelog 是給所有玩家看的扼要改版內容，
//   不是針對我這個網站作者的說明」）——兩條硬性規範：
//   ⑫ 不得用第二人稱：條目是公告，不是對著某一個人講話。
//      ✗「會連問你兩次能量」「牌組檢查會提醒你補齊」
//      ✓「會連續要求選兩次能量」「牌組檢查會提示補齊」
//   ⑬ 與遊戲／網站內容無關、或玩家不需要知道的（純伺服器內部調整、更新記錄自己的寫法），
//      **整則都不要放上首頁**，只寫進 docs/changelog-internal.md。
T('⑫ 首頁 changelog 不得出現第二人稱（公告語氣，不是對站長說明）', () => {
  const PRONOUN = ['你', '妳', '您'];
  const bad = [];
  for (const t of entriesTxt) for (const w of PRONOUN) if (t.includes(w)) bad.push(w + '｜' + t.slice(0, 40));
  assert.strictEqual(bad.length, 0,
    '出現第二人稱：\n      ' + bad.join('\n      ')
    + '\n      → 改成中性敘述（「玩家」「該回合」「系統」）或直接省略主詞');
  // 正對照：確保這個檢查真的抓得到
  assert.ok(['會提醒你補齊'].some((probe) => PRONOUN.some((w) => probe.includes(w))), '正對照失效');
});
T('⑬ 首頁 changelog 不得出現「只有站長需要知道」的題材', () => {
  // 這些題材玩家沒有任何要做的事、也感受不到規則差異 → 應整則移除，只留在內部詳細版。
  const OWNER_ONLY = ['更新記錄再精簡', '首頁只顯示最近', '伺服器降載', '部署', 'bat 檔'];
  const hit = OWNER_ONLY.filter((w) => clAll.includes(w));   // v6.264：含搬到 bodies 檔的內文
  assert.strictEqual(hit.length, 0,
    '出現站長專屬題材：' + hit.join('、') + ' —— 這類改版整則都不要放上首頁');
});
T('⑧ 每一則 ≤ 150 字（防再度膨脹成長篇說明）', () => {
  const lens = entriesTxt.map((t) => t.length);
  const worst = Math.max(...lens);
  assert.ok(worst <= 150,
    `最長 ${worst} 字：「${entriesTxt[lens.indexOf(worst)].slice(0, 60)}…」—— 細節請寫進 docs/changelog-internal.md`);
});
T('⑨ 全部合計 ≤ 5000 字（v6.106 精簡後約 3700）', () => {
  const total = entriesTxt.reduce((a, t) => a + t.length, 0);
  assert.ok(total <= 5000, `目前合計 ${total} 字`);
});
T('⑩ 內部詳細版 docs/changelog-internal.md 存在', () => {
  assert.ok(existsSync(join(ROOT, 'docs/changelog-internal.md')),
    '細部紀錄要寫在這裡（玩家看不到），首頁只留精簡版');
});
T('⑪ 內部詳細版確實比首頁詳細（不是複製一份精簡版過去）', () => {
  const md = readFileSync(join(ROOT, 'docs/changelog-internal.md'), 'utf8');
  // ⚠ 比**純文字**長度：首頁是 HTML，標籤本身就佔一堆字元，直接比檔案大小會失真。
  const plainTotal = entriesTxt.reduce((a, t) => a + t.length, 0);
  assert.ok(md.length > plainTotal * 2,
    `內部 ${md.length} vs 首頁純文字 ${plainTotal} —— 細節沒有真的寫進內部檔`);
  assert.ok(md.includes('不是給玩家看的'), '內部檔開頭要寫明用途，免得日後被誤當成公開文件');
});
console.log(`\n=== v6.100 changelog 精簡與封存: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
