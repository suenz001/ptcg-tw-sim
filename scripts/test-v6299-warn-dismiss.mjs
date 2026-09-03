// v6.299 守衛：錦標賽大廳的錯誤訊息不再「永久掛在頁面最下方」。
//
// 站長回報（逐字）：「手機版錦標賽的頁面最下方 出現了 409: {"error":"目前不在報名階段"} 的 bug
//   （不管切換哪個分頁都會顯示這個 bug 在最下方）」
//
// 真因（本檔逐條複驗）：大廳的 `tError` 印在 <main> 層級、在所有分頁的條件式收尾之後 ⇒ 每個分頁都看得到；
//   而 `tSwitchTab()` 完全沒有清它 ⇒ 一旦 /register 回 409 就永遠掛著。
//
// 守什麼（能行為端就行為端；靜態只用在行為端測不到的地方）：
//   【A】HEAD-FAIL 錨點：tSwitchTab 內的清除、模板上的關閉鈕、CSS 的 .warn-x —— BASE(v6.298) 三個都沒有。
//   【B】⭐⭐ 行為端：把 tSwitchTab 的**函式體從出貨碼抽出來真的跑**，四個分頁各跑一次
//        ⇒ tError／tCheckinErrId 必須變空，且既有的載入行為（排行榜／個人資料／診斷）一個都沒被改掉。
//   【C】⭐ 行為端：把關閉鈕 onclick 的箭頭函式**抽出來真的跑** ⇒ tError／tCheckinErrId 變空。
//   【D】⚠⚠ 對戰中的 .tourn-toast 沒被動到：
//        D1 toast 那一行逐字未動、且**沒有**關閉鈕；D2 .tourn-toast 的 CSS 規則逐字未動；
//        D3 ⭐⭐ 「tSwitchTab 在對戰中根本呼叫不到」的**結構＋求值**證明：四個呼叫點全部落在
//           `{#if isTournament && tStep !== 'playing'}` 的 <main> 裡，而該條件在對戰中求值為 false。
//   【E】⚠ v6.167「貼著報到鈕」的兩則訊息仍然會顯示（行為端：跑 tCheckinCommit 的錯誤路徑 → 求值渲染條件）。
//   【F】⭐ 零位移的靜態等價條件（沿用 v6.298 的手法：把 CSS 真的解析出來看**宣告的值**，不是比字面）：
//        .warn-x 的 padding／border 為 0、font／line-height 繼承、background 透明、不是區塊盒；
//        .warn 本身逐字未動。DOM 實測在 scripts/measure-v6299-warn-close.mjs（不在 chain，需要瀏覽器）。
//   【G】回歸：version.ts 與 admin.html SITE_VERSION_HINT 一致；本檔在 npm test chain 裡。
//   【H】突變：5 個，每一個都必須紅在**預期那一條**。
//
// ⚠ 守衛安慰劑八種型態逐一避開：只捕 assert.AssertionError；**不 pin 任何版本號／sha**；
//   每個抽取器都有下限斷言；條件一律求值不比字面；每條「未動」都配一個正對照。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const esbuild = await import('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_VER = join(ROOT, 'src/lib/version.ts');
const P_ADMIN = join(ROOT, 'oracle-admin/admin.html');
const P_PKG = join(ROOT, 'package.json');
const P_SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 900)); fail++; }
    else throw e;
  }
};
const mutantMustBreak = (name, run, frag) => {
  let err = null;
  try { run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(frag),
    '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 300) + '（預期含「' + frag + '」）');
  console.log('  PASS 突變「' + name + '」→ 紅在「' + frag + '」');
  pass++;
};
const mutate = (src, a, b) => {
  const n = src.split(a).length - 1;
  assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 90));
  return src.replace(a, b);
};
const evalExpr = (expr, vars) => new Function(...Object.keys(vars), 'return (' + expr + ');')(...Object.values(vars));

/** 從 `open` 這個位置的左大括號開始，配對出「不含外層括號」的內容。 */
function balanced(src, openIdx) {
  assert.strictEqual(src[openIdx], '{', '不是從 { 開始 —— 抽取器瞎了');
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  throw new assert.AssertionError({ message: '括號沒有配對成功 —— 抽取器瞎了' });
}

/** 抽 <style> 區（最後一段）。 */
function styleBlock(src) {
  const i = src.lastIndexOf('<style');
  assert.ok(i >= 0, '找不到 <style> 區 —— 抽取器瞎了');
  return src.slice(src.indexOf('>', i) + 1, src.lastIndexOf('</style>'));
}

/** 從 CSS 抽出某個選擇器（完全相符）的宣告字串，回傳陣列（可能多條）。 */
function cssRules(css, selector) {
  const out = [];
  const noCmt = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp('(^|[};])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^{}]*)\\}', 'g');
  let m;
  while ((m = re.exec(noCmt))) out.push(m[2].trim());
  return out;
}

/** 解析宣告字串成 map（後者覆蓋前者，同 CSS 語義）。 */
function decls(body) {
  const out = new Map();
  for (const part of body.split(';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    out.set(part.slice(0, k).trim().toLowerCase(), part.slice(k + 1).trim().toLowerCase());
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL 錨點（BASE v6.298 三個都沒有 ⇒ 這一條必紅並中止）');
let GAME = '';
T('A0 HEAD-FAIL：tSwitchTab 有清除、模板有 .warn-x 關閉鈕、CSS 有 .warn-x 規則', () => {
  GAME = rd(P_GAME);
  assert.ok(GAME.length > 500000, 'game/+page.svelte 只讀到 ' + GAME.length + ' 字元 —— 讀錯檔？');
  for (const k of [
    "    tError = ''; tCheckinErrId = '';\n    tTabRaw = tab;",
    '<button class="warn-x"',
    '.warn-x{',
  ]) assert.ok(GAME.includes(k), 'game/+page.svelte 缺「' + k + '」');
});
if (fail) {
  console.log('\n══ v6.299 錯誤訊息可關閉守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：新東西不存在，後續斷言無法進行）══');
  process.exit(1);
}

// ── 抽取器（全部帶下限斷言）───────────────────────────────────────────────
const SIG = "function tSwitchTab(tab: 'events' | 'leaderboard' | 'profile' | 'friends') {";
function switchTabBody(src) {
  const i = src.indexOf(SIG);
  assert.ok(i > 0, '抽不到 tSwitchTab');
  const body = balanced(src, src.indexOf('{', i + SIG.length - 1));
  assert.ok(body.length > 200, 'tSwitchTab 函式體只有 ' + body.length + ' 字元 ⇒ 錨點抓錯');
  return body;
}
/** 跑一次 tSwitchTab，回傳套用後的狀態＋被呼叫到的載入函式。 */
function runSwitchTab(body, tab, init) {
  const calls = [];
  const S = Object.assign({
    tTabRaw: 'events', tError: '', tCheckinErrId: '',
    tLeaderboard: null, tLeaderboardStale: false, tProfile: null, tProfileStale: false,
    tLeaderboardLoad: () => calls.push('lb'), tProfileLoad: () => calls.push('pf'),
    refreshNotifyDiag: () => calls.push('diag'),
  }, init || {});
  new Function('S', 'tab', 'with (S) {' + body + '}')(S, tab);
  return { S, calls };
}
/** 抽關閉鈕的 onclick 箭頭函式（原始碼字串）。 */
function closeHandler(src) {
  const i = src.indexOf('<button class="warn-x"');
  assert.ok(i > 0, '抽不到 .warn-x 關閉鈕');
  const j = src.indexOf('onclick={', i);
  assert.ok(j > i && j < i + 400, '關閉鈕上抽不到 onclick');
  const expr = balanced(src, j + 'onclick='.length);
  assert.ok(expr.includes('=>'), '關閉鈕的 onclick 不是函式：' + expr.slice(0, 120));
  return expr;
}
function runCloseHandler(expr, init) {
  const S = Object.assign({ tError: '409: {"error":"目前不在報名階段"}', tCheckinErrId: 'ev-abc' }, init || {});
  new Function('S', 'with (S) { (' + expr + ')(); }')(S);
  return S;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐ 行為端：tSwitchTab 抽出來實跑（四個分頁各一次）');
const TABS = ['events', 'leaderboard', 'profile', 'friends'];
function assertClearsOnEveryTab(src) {
  const body = switchTabBody(src);
  for (const tab of TABS) {
    const { S } = runSwitchTab(body, tab, { tError: '409: {"error":"目前不在報名階段"}', tCheckinErrId: 'ev-abc' });
    assert.strictEqual(S.tError, '', '切到「' + tab + '」分頁之後 tError 還在：' + JSON.stringify(S.tError)
      + ' ⇒ 錯誤訊息仍會掛在頁面最下方');
    assert.strictEqual(S.tCheckinErrId, '', '切到「' + tab + '」分頁之後 tCheckinErrId 還在：' + S.tCheckinErrId);
    assert.strictEqual(S.tTabRaw, tab, 'tSwitchTab 沒有把分頁切過去');
  }
}
T('B1 ⭐⭐⭐ 設了 tError 之後切到**任一分頁** ⇒ tError（與 tCheckinErrId）都變空', () => {
  assertClearsOnEveryTab(GAME);
});
T('B2 既有行為沒被改掉：排行榜／個人資料只在需要時載入，切賽事分頁不觸發任何載入', () => {
  const body = switchTabBody(GAME);
  assert.deepStrictEqual(runSwitchTab(body, 'events').calls, [], '切賽事分頁不該觸發載入');
  assert.deepStrictEqual(runSwitchTab(body, 'leaderboard').calls, ['lb'], '切排行榜要載排行榜');
  assert.deepStrictEqual(runSwitchTab(body, 'profile').calls, ['pf', 'diag'], '切個人資料要載個人資料＋刷新診斷');
  assert.deepStrictEqual(runSwitchTab(body, 'friends').calls, [], '切好友分頁不該觸發賽事端的載入');
  // 已經有資料且不是 stale ⇒ 不重抓（v6.177 的行為）
  assert.deepStrictEqual(runSwitchTab(body, 'leaderboard', { tLeaderboard: {}, tLeaderboardStale: false }).calls, [],
    '已有排行榜資料時不該重抓');
});
T('B3 ⚠⚠ tSwitchTab 不碰任何對戰狀態（tStep／onlineStep／game／isTournament）', () => {
  const body = switchTabBody(GAME);
  for (const k of ['tStep', 'onlineStep', 'game', 'isTournament']) {
    assert.ok(!new RegExp('(^|[^\\w.])' + k + '\\s*=[^=]').test(body),
      '⚠⚠ 切分頁動了 ' + k + '：' + body.slice(0, 200));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐ 行為端：關閉鈕的 onclick 抽出來實跑');
function assertCloseClears(src) {
  const S = runCloseHandler(closeHandler(src));
  assert.strictEqual(S.tError, '', '⭐ 關閉鈕點下去之後 tError 還在：' + JSON.stringify(S.tError));
  assert.strictEqual(S.tCheckinErrId, '', '關閉鈕點下去之後 tCheckinErrId 還在：' + S.tCheckinErrId);
}
T('C1 ⭐ 關閉鈕點下去 ⇒ tError 變空（tCheckinErrId 一起清）', () => { assertCloseClears(GAME); });
T('C2 關閉鈕就掛在 {#if tError} 那一則訊息上（不是別的地方），且有無障礙標籤', () => {
  const i = GAME.indexOf('{#if tError}<p class="warn">');
  assert.ok(i > 0, '找不到大廳那一則 {#if tError} 的 <p class="warn">');
  const line = GAME.slice(i, GAME.indexOf('\n', i));
  assert.ok(line.includes('<button class="warn-x"'), '關閉鈕不在那一則訊息裡：' + line.slice(0, 200));
  assert.ok(/aria-label="[^"]+"/.test(line), '關閉鈕沒有 aria-label（只有一個 ✕ 字元，讀螢幕的人聽不懂）');
  assert.ok(line.includes('type="button"'), '關閉鈕沒有 type="button"');
  assert.strictEqual(GAME.split('<button class="warn-x"').length - 1, 1,
    '.warn-x 關閉鈕出現不只一次 —— 是不是也加到別的訊息上了？');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】⚠⚠ 對戰中的 .tourn-toast 沒被動到');
const TOAST_LINE = '{#if isTournament && tError}<div class="tourn-toast">{tError}</div>{/if}';
const TOAST_CSS = '.tourn-toast { position: fixed; top: calc(8px + var(--safe-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 9999; background: #7a1f1f; color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 0.9rem; box-shadow: 0 2px 8px rgba(0,0,0,.4); max-width: 90vw; }';
function assertToastIntact(src) {
  assert.strictEqual(src.split(TOAST_LINE).length - 1, 1,
    '⚠⚠ 對戰中的 .tourn-toast 那一行被動到了（或消失了）—— 對戰中的錯誤提示不可以被改');
  assert.ok(src.includes(TOAST_CSS), '⚠⚠ .tourn-toast 的 CSS 規則被動到了');
}
T('D1 toast 那一行與 CSS 規則逐字未動，且 toast 裡**沒有**關閉鈕（對戰中不給關，避免誤觸）', () => {
  assertToastIntact(GAME);
  const i = GAME.indexOf(TOAST_LINE);
  assert.ok(!GAME.slice(i, i + TOAST_LINE.length).includes('warn-x'), 'toast 裡混進了關閉鈕');
});
T('D1b 自我驗證：上一條不是恆真（把 toast 那一行改一個字元就會紅）', () => {
  const bad = mutate(GAME, TOAST_LINE, TOAST_LINE.replace('tourn-toast', 'tourn-toast2'));
  assert.throws(() => assertToastIntact(bad), assert.AssertionError, 'D1 是恆真式');
});
const LOBBY_COND = "isTournament && tStep !== 'playing'";
function assertSwitchTabLobbyOnly(src) {
  // ① 大廳版面的渲染條件在**對戰中**求值為 false ⇒ 分頁列（唯一的呼叫點）根本不存在
  const cond = "{#if " + LOBBY_COND + "}\n  <main class=\"lobby tourn-lobby\">";
  assert.ok(src.includes(cond), '⚠⚠ 錦標賽大廳 <main> 的渲染條件被改了（找不到「' + LOBBY_COND + '」）'
    + ' ⇒ tSwitchTab 可能在對戰中也被呼叫得到，會誤清 .tourn-toast');
  assert.strictEqual(evalExpr(LOBBY_COND, { isTournament: true, tStep: 'playing' }), false,
    '⚠⚠ 對戰中大廳版面竟然會被畫出來');
  assert.strictEqual(evalExpr(LOBBY_COND, { isTournament: true, tStep: 'lobby' }), true, '大廳竟然畫不出來');
  // ② 所有呼叫點都落在那個 <main> 裡（定義本身在 <script>，不算呼叫點）
  const mStart = src.indexOf('<main class="lobby tourn-lobby">');
  const mEnd = src.indexOf('</main>', mStart);
  assert.ok(mStart > 0 && mEnd > mStart, '抽不到錦標賽大廳的 <main> 區間 —— 抽取器瞎了');
  const calls = [...src.matchAll(/tSwitchTab\(/g)].map((m) => m.index)
    .filter((i) => i !== src.indexOf(SIG) + 'function '.length);
  assert.ok(calls.length >= 4, '只找到 ' + calls.length + ' 個 tSwitchTab( —— 抽取器瞎了（四顆分頁鈕呢？）');
  const outside = calls.filter((i) => !(i > mStart && i < mEnd) && !(i < mStart && src.slice(0, i).includes(SIG) && i < src.indexOf('</script>')));
  assert.deepStrictEqual(outside, [],
    '⚠⚠ 有 ' + outside.length + ' 個 tSwitchTab 呼叫點在錦標賽大廳 <main> 之外'
    + ' ⇒ 它可能在對戰中被呼叫到，會把 .tourn-toast 的錯誤提示誤清掉');
}
T('D3 ⭐⭐ tSwitchTab 只在大廳可達：大廳版面的條件在對戰中求值為 false，且四個呼叫點全在那個 <main> 裡', () => {
  assertSwitchTabLobbyOnly(GAME);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】⚠ v6.167「貼著報到鈕」的兩則訊息仍然會顯示（行為端）');
const CHECKIN_COND = 'tCheckinErrId === ev._id && tError';
function checkinCommitBody(src) {
  const sig = 'async function tCheckinCommit(eventId: string) {';
  const i = src.indexOf(sig);
  assert.ok(i > 0, '抽不到 tCheckinCommit');
  const body = balanced(src, src.indexOf('{', i + sig.length - 1));
  assert.ok(body.includes('/checkin'), 'tCheckinCommit 函式體抓錯（沒有 /checkin）');
  return body;
}
/** 真的跑一次「報到被伺服器拒絕」，回傳套用後的狀態。
 *  ⚠ 函式體是 TypeScript（`catch (e: any)`）⇒ 用 esbuild 剝掉型別再跑，不是自己寫 regex 硬拆。 */
async function runCheckinFail(src, errMsg) {
  const body = checkinCommitBody(src);
  const js = (await esbuild.transform(body, { loader: 'ts', target: 'es2022' })).code;
  assert.ok(js.includes('/checkin'), 'esbuild 轉出來的碼不含 /checkin —— 轉譯器吃掉了函式體');
  const S = { tBusy: false, tError: '', tCheckinErrId: '', VERSION: '0',
    tApi: async () => ({ error: errMsg }), tournLoadEvent: () => {} };
  const fn = new Function('S', 'eventId', 'with (S) { return (async () => {' + js + '})(); }');
  await fn(S, 'ev-777');
  return S;
}
const checkinChecks = async (src) => {
  const S = await runCheckinFail(src, '目前不在報到階段');
  assert.strictEqual(S.tError, '目前不在報到階段', '報到失敗沒有把訊息放進 tError');
  assert.strictEqual(S.tCheckinErrId, 'ev-777', '⚠ 報到失敗沒有記下賽事 id ⇒ 貼著報到鈕的訊息不會出現');
  // ⚠ Svelte 的 {#if} 看的是 truthiness，不是嚴格 true ⇒ 這裡也用 Boolean() 判，與畫面一致。
  assert.strictEqual(Boolean(evalExpr(CHECKIN_COND, { tCheckinErrId: S.tCheckinErrId, ev: { _id: 'ev-777' }, tError: S.tError })),
    true, '⚠ 貼著報到鈕的訊息渲染條件為假 ⇒ 玩家看不到「按了沒反應」的原因（那道修法被弄壞了）');
  // 切分頁之後才消失（＝本版要的行為）
  const { S: S2 } = runSwitchTab(switchTabBody(src), 'leaderboard', { tError: S.tError, tCheckinErrId: S.tCheckinErrId });
  assert.strictEqual(Boolean(evalExpr(CHECKIN_COND, { tCheckinErrId: S2.tCheckinErrId, ev: { _id: 'ev-777' }, tError: S2.tError })),
    false, '切分頁之後那則訊息竟然還在');
};
let e1 = null;
await checkinChecks(GAME).then(() => { console.log('  PASS E1 ⚠ 報到失敗仍會把訊息貼在該場賽事的報到鈕旁邊（切分頁後才消失）'); pass++; })
  .catch((e) => { if (!(e instanceof assert.AssertionError)) throw e; e1 = e; console.log('  FAIL E1 :: ' + e.message.slice(0, 900)); fail++; });
T('E2 模板上那兩處渲染條件還在（各一次，v6.167 的兩個位置）', () => {
  assert.strictEqual(GAME.split(CHECKIN_COND).length - 1, 2,
    '「' + CHECKIN_COND + '」不是出現兩次 ⇒ v6.167 貼著報到鈕的訊息被動到了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】⭐ 零位移的靜態等價條件（把 CSS 解析出來看**宣告的值**）');
const WARN_CSS = '.warn{ color:#f0b040; }';
function assertNoLayoutShift(src) {
  const css = styleBlock(src);
  assert.ok(src.includes(WARN_CSS), '⚠ .warn 本身被動到了（原本是「' + WARN_CSS + '」）—— 那會動到既有版面');
  const rules = cssRules(css, '.warn-x');
  assert.ok(rules.length >= 1, '找不到 .warn-x 的 CSS 規則 —— 抽取器瞎了');
  const d = decls(rules[0]);
  assert.ok(d.size >= 8, '.warn-x 只解析到 ' + d.size + ' 條宣告 —— 解析器壞了');
  // 行框高度不變的充分條件：字級／行高完全繼承、沒有 padding／border、baseline 對齊
  assert.strictEqual(d.get('font'), 'inherit', '.warn-x 的 font 必須 inherit（字級一變行框就變高）');
  assert.strictEqual(d.get('line-height'), 'inherit', '.warn-x 的 line-height 必須 inherit');
  assert.strictEqual(d.get('vertical-align'), 'baseline', '.warn-x 必須 baseline 對齊');
  assert.ok(/^0(\S*)?$/.test(String(d.get('padding'))), '.warn-x 的 padding 必須是 0，實得「' + d.get('padding') + '」⇒ 會把訊息撐高');
  assert.ok(/^0(\S*)?$/.test(String(d.get('border'))), '.warn-x 的 border 必須是 0，實得「' + d.get('border') + '」');
  assert.strictEqual(d.get('background'), 'none', '.warn-x 的 background 必須 none（有底色就會看起來像另一個區塊）');
  // 不可以變成區塊盒／絕對定位（那都會改變 <p> 的盒子或蓋住文字）
  for (const k of ['display', 'position', 'width', 'height', 'float']) {
    assert.ok(!d.has(k), '.warn-x 不可以宣告 ' + k + '（會改變版面），實得「' + d.get(k) + '」');
  }
  // 只能出現在非 @media 區（本站沒有為它寫任何 media 變體）
  assert.strictEqual(rules.length, 1, '.warn-x 有 ' + rules.length + ' 條規則 —— 多出來的那條會讓上面的檢查失去意義');
}
T('F1 ⭐ .warn-x 的宣告構成「行框高度不變」的充分條件，且 .warn 本身逐字未動', () => {
  assertNoLayoutShift(GAME);
});
T('F2 自我驗證：正對照（給關閉鈕 padding）必須紅 —— 證明 F1 不是恆真', () => {
  const bad = mutate(GAME, 'padding:0; margin:0 0 0 8px;', 'padding:6px 12px; margin:0 0 0 8px;');
  assert.throws(() => assertNoLayoutShift(bad), assert.AssertionError, 'F1 是恆真式');
});
T('F3 量測腳本存在且會從出貨碼實抽（不是手抄字串）', () => {
  const p = join(ROOT, 'scripts/measure-v6299-warn-close.mjs');
  assert.ok(existsSync(p), '找不到 DOM 量測腳本 scripts/measure-v6299-warn-close.mjs ⇒ 零位移沒有實測證據');
  const m = rd(p);
  assert.ok(m.includes('getBoundingClientRect'), '量測腳本沒有量 rect');
  assert.ok(m.includes('shippedErrorText') && m.includes('shippedCloseBtn'),
    '量測腳本沒有從出貨碼實抽訊息／關閉鈕 ⇒ 會與出貨碼漂移');
  assert.ok(m.includes("VARIANTS = {") && m.includes('control:'), '量測腳本沒有正對照變體');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】回歸不變量（不 pin 版本號）');
T('G1 version.ts 與 admin.html 的 SITE_VERSION_HINT 一致', () => {
  const v = /VERSION = '([\d.]+)'/.exec(rd(P_VER))[1];
  const h = /SITE_VERSION_HINT = '([\d.]+)'/.exec(rd(P_ADMIN))[1];
  assert.strictEqual(h, v, 'hint ' + h + ' ≠ version.ts ' + v);
});
T('G2 本檔在 npm test chain 裡（只加進 iron-rules-audit 等於沒加）', () => {
  const chain = JSON.parse(rd(P_PKG)).scripts.test;
  assert.ok(chain.includes('scripts/test-v6299-warn-dismiss.mjs'), 'test chain 沒有本守衛');
});
T('G3 ⚠ 伺服器端那句 409 還在（訊息的來源；本版沒有動 server_admin_patch.js）', () => {
  const srv = rd(P_SRV);
  assert.ok(/res\.status\(409\)\.json\(\{ error: '目前不在報名階段' \}\)/.test(srv),
    '找不到 /register 的 409 —— 站長看到的那串訊息來源變了，本守衛的情境要重新確認');
});
T('G4 本守衛沒有 pin 任何版本號或 commit sha（守衛紀律 E：pin 會在版本被取代的當下靜默失效）', () => {
  const self = rd(join(ROOT, 'scripts/test-v6299-warn-dismiss.mjs'));
  assert.ok(!/[0-9a-f]{40}/.test(self), '本檔出現 40 位元 commit sha');
  assert.ok(!/\bconst\s+\w*(SHA|BASE)\w*\s*=/.test(self), '本檔出現 SHA／BASE 常數');
  // 「拿版本號當判準」＝ 版本字串出現在比較式的右邊
  const RE_PIN = /(?:===|!==|strictEqual\(|\.equal\()[^\n]*['"`]v?6\.\d/g;
  const cmp = self.split('\n').filter((l) => !l.includes('__PROBE__')).join('\n').match(RE_PIN) || [];
  assert.deepStrictEqual(cmp, [], '本檔把版本號當成判準：' + cmp.join(' / '));
  // 正對照：這個掃描器抓得到真的 pin（否則它是恆真式）
  const probe = 'assert.strictEqual(v, ' + "'6." + "299');"; // __PROBE__
  assert.strictEqual((probe.match(RE_PIN) || []).length, 1, 'G4 的掃描器抓不到真的 pin ⇒ 它是恆真式');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】突變（每一個都必須紅在預期那一條）');
mutantMustBreak('M1 只清「賽事」一個分頁',
  () => assertClearsOnEveryTab(mutate(GAME, "    tError = ''; tCheckinErrId = '';\n    tTabRaw = tab;",
    "    if (tab === 'events') { tError = ''; tCheckinErrId = ''; }\n    tTabRaw = tab;")),
  '分頁之後 tError 還在');
mutantMustBreak('M2 關閉鈕不清 state（只是個裝飾）',
  () => assertCloseClears(mutate(GAME, "onclick={() => { tError = ''; tCheckinErrId = ''; }}>✕</button>",
    'onclick={() => { /* noop */ }}>✕</button>')),
  '關閉鈕點下去之後 tError 還在');
mutantMustBreak('M3 大廳版面的條件放寬成只看 isTournament ⇒ 對戰中也畫得出分頁列（會誤清 toast）',
  () => assertSwitchTabLobbyOnly(mutate(GAME, "{#if isTournament && tStep !== 'playing'}\n  <main class=\"lobby tourn-lobby\">",
    '{#if isTournament}\n  <main class="lobby tourn-lobby">')),
  '大廳 <main> 的渲染條件被改了');
mutantMustBreak('M4 對戰中的 toast 也被塞了一顆會清 tError 的關閉鈕',
  () => assertToastIntact(mutate(GAME, TOAST_LINE,
    '{#if isTournament && tError}<div class="tourn-toast">{tError}<button class="warn-x">✕</button></div>{/if}')),
  '.tourn-toast 那一行被動到了');
{
  const bad = mutate(GAME, "if (r?.error) { tError = r.error; tCheckinErrId = eventId; }\n      else { tournLoadEvent(); }",
    'if (r?.error) { tError = r.error; }\n      else { tournLoadEvent(); }');
  let err = null;
  await checkinChecks(bad).catch((e) => { if (!(e instanceof assert.AssertionError)) throw e; err = e; });
  T('M5 報到失敗不再記下賽事 id ⇒ 貼著報到鈕的訊息消失（必須紅）', () => {
    assert.ok(err, '突變體 M5 沒有讓任何斷言變紅 ⇒ E1 是安慰劑');
    assert.ok(String(err.message).includes('沒有記下賽事 id'),
      'M5 紅在別條：' + String(err.message).slice(0, 200));
  });
}

console.log('\n══ v6.299 錯誤訊息可關閉守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
if (fail) process.exit(1);
