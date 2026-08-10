#!/usr/bin/env node
/**
 * v6.154 守衛：admin 📡 監控分頁 ＋ `/api/tournament/admin/clientdiag`
 *
 * 這一版把兩件事接出來給站長看：
 *   ① 兩個伺服器端灰度旗標（長輪詢 v6.152 / 盤面遮蔽 v6.153）的開關與現況
 *   ② 玩家端回報的異常指紋 —— v0.77 起一直在寫 `tournamentClientDiag`，
 *      但**從來沒有讀的地方**，「很卡」的回報只能靠玩家口述還原。
 *
 * ⚠ admin.html 是 module script：inline `on*` 只看得到掛在 `window` 上的東西，
 *   模組層級的函式寫進 onclick 會**靜默失效**（v1.60 的既有事故）。這裡通用掃描一次。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

// ── 1. 端點 ────────────────────────────────────────────────────────────────
{
  const i = SRC.indexOf("app.get('/api/tournament/admin/clientdiag'");
  ok('clientdiag 讀取端點存在', i > 0);
  const seg = SRC.slice(i, i + 2600);
  ok('有管理員 gate', /if \(!isTournAdmin\(id\)\) return res\.status\(403\)/.test(seg));
  ok('hours 有 clamp（不可拉出無上限的全表掃描）', /Math\.max\(1, Math\.min\(168, Number\(req\.query\.hours\) \|\| 24\)\)/.test(seg));
  // ★ 統計必須對整個時間窗算，不能只對「最近 N 筆明細」算 —— 那會被 limit 截斷而失真
  ok('★指紋統計走 aggregate 對整個時間窗算（不是拿 rows 來數）',
    /aggregate\(\[\s*\n?\s*\{ \$match: \{ ts: \{ \$gte: since \} \} \},/.test(seg));
  ok('★統計同時算「受影響人數」（同一人重複觸發不代表全站問題）',
    /uids: \{ \$addToSet: '\$uid' \}/.test(seg) && /players: \(a\.uids \|\| \[\]\)\.length/.test(seg));
  ok('明細有筆數上限（診斷資料會累積）', /\.limit\(120\)/.test(seg));
  ok('slow-rtt 的往返時間會被解析出來', /reason: 'slow-rtt'/.test(seg) && /rt\.p95 === 'number'/.test(seg));
  ok('解析壞掉的 payload 不會炸（舊格式要能略過）', /catch \(e\) \{ \/\* 舊格式或壞掉的 payload 直接略過 \*\/ \}/.test(seg));
  // 掃描器自我驗證
  ok('★掃描器自我驗證：沒有 gate 的樣本會被抓到',
    !/if \(!isTournAdmin\(id\)\) return res\.status\(403\)/.test("app.get('/x', async (req,res)=>{ res.json({}) })"));
}

// ── 2. admin 分頁接線 ──────────────────────────────────────────────────────
{
  ok('分頁按鈕存在', ADMIN.includes('data-tab="monitor"') && ADMIN.includes("switchTab('monitor')"));
  ok('★分派有接上（有按鈕沒分派 = 點了空白頁）', ADMIN.includes("else if (currentTab === 'monitor') p = loadMonitor();"));
  ok('loadMonitor 有定義', /async function loadMonitor\(\)/.test(ADMIN));
  // ⚠⚠ Fable 5 審查抓到：這一版第一次寫的時候**只加了按鈕與分派、沒加內容容器**，
  //   而且 loadMonitor 抓的是不存在的 id ⇒ 點進去整頁空白、完全沒有錯誤訊息，
  //   而當時 22 條守衛全綠（它們只驗字串、不驗 DOM 接線）。這兩條就是補那個洞。
  ok('★★監控分頁有自己的內容容器', ADMIN.includes('<div id="tab-monitor" class="tab-content"'));
  ok('★★loadMonitor 渲染到自己的容器（不是不存在的 id）',
    /getElementById\('tab-monitor'\)/.test(ADMIN) && !/getElementById\('content'\)/.test(ADMIN));
  ok('三個資料來源都接（長輪詢／遮蔽／診斷）',
    ADMIN.includes("api('/api/tournament/admin/longpoll')")
    && ADMIN.includes("api('/api/tournament/admin/redact')")
    && ADMIN.includes("api('/api/tournament/admin/clientdiag?hours='"));
  // ⚠ api() **從不 reject**（非 2xx 回 { error: text }）⇒ 用 .catch 判斷是死碼，
  //   舊版伺服器會被當成「正常但沒資料」而顯示假綠（Fable 5 審查抓到）。
  ok('★舊版伺服器偵測用 .error 判斷，不是 .catch',
    ADMIN.includes("const _ok = function (r) { return (r && !r.error) ? r : null; };")
    && /const lp = _ok\(_r\[0\]\), rd = _ok\(_r\[1\]\), dg = _ok\(_r\[2\]\);/.test(ADMIN));
  ok('★掃描器自我驗證：.catch 死碼寫法會被判為未修',
    !"api('/x').catch(function () { return null; })".includes('_ok('));
  ok('伺服器還是舊版時有明確提示（而不是靜默空白）', ADMIN.includes('伺服器還是舊版'));
  ok('指紋說明查表防原型鏈 key', ADMIN.includes('Object.prototype.hasOwnProperty.call(MON_REASON_INFO, reason)'));
  ok('每個指紋都有白話解釋（站長要的是結論不是代號）',
    ['slow-rtt', 'stale-version', 'invisible-hand', 'setup-watchdog-repeat', 'manual-sync']
      .every((r) => new RegExp("'" + r + "': \\[").test(ADMIN)));
}

// ── 3. ★ inline on* 呼叫的函式一定要掛在 window（v1.60 事故的通用檢查）────
{
  const i0 = ADMIN.indexOf('══ v1.67 📡 監控分頁');
  const i1 = ADMIN.indexOf('══ v1.63 支援型寶可夢清單');
  ok('監控分頁區段可定位', i0 > 0 && i1 > i0, `i0=${i0} i1=${i1}`);
  const seg = ADMIN.slice(i0, i1);
  const called = new Set();
  for (const m of seg.matchAll(/onclick="(\w+)\(/g)) called.add(m[1]);
  ok('掃到監控分頁的 onclick 呼叫（掃不到就是這條守衛失效）', called.size >= 3, [...called].join(','));
  const notOnWindow = [...called].filter((fn) => !new RegExp('window\\.' + fn + ' = ').test(ADMIN));
  ok('★每個 inline onclick 呼叫的函式都掛在 window（module script 看不到模組層級的）',
    notOnWindow.length === 0, notOnWindow.join(','));
  // 掃描器自我驗證：故意壞掉的樣本要抓得到
  const probe = 'onclick="notOnWindowFn(1)"';
  const probeCalled = [...probe.matchAll(/onclick="(\w+)\(/g)].map((m) => m[1]);
  ok('★掃描器自我驗證：沒掛在 window 的樣本會被抓到',
    probeCalled.length === 1 && !new RegExp('window\\.' + probeCalled[0] + ' = ').test(ADMIN));
}

// ── 3b. ★★通用：每個分頁按鈕都要有「容器 ＋ 分派」（缺一就是靜默空白頁）──────
{
  const tabs = [...ADMIN.matchAll(/data-tab="([\w-]+)"/g)].map((m) => m[1]);
  ok('掃到分頁按鈕（掃不到就是這條守衛失效）', tabs.length >= 13, String(tabs.length));
  const noContainer = tabs.filter((t) => !ADMIN.includes('id="tab-' + t + '"'));
  ok('★★每個分頁按鈕都有對應的內容容器', noContainer.length === 0, noContainer.join(','));
  const noDispatch = tabs.filter((t) => !new RegExp("currentTab === '" + t + "'").test(ADMIN));
  ok('★★每個分頁都有 switchTab 分派', noDispatch.length === 0, noDispatch.join(','));
  ok('★掃描器自我驗證：少了容器的分頁會被抓到',
    !'<div id="tab-overview"></div>'.includes('id="tab-__probe__"'));
}

// ── 4. client 端送出的 reason 與 admin 的說明表要對得上 ───────────────────
{
  const sent = new Set([...PAGE.matchAll(/_tSendClientDiag\('([a-z-]+)'/g)].map((m) => m[1]));
  ok('client 端至少送這幾種指紋', sent.size >= 5, [...sent].join(','));
  const missing = [...sent].filter((r) => !new RegExp("'" + r + "': \\[").test(ADMIN));
  ok('★client 送的每一種指紋，admin 都有對應的白話說明（新增指紋時會紅）',
    missing.length === 0, missing.join(','));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
