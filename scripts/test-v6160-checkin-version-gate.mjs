#!/usr/bin/env node
/**
 * v6.160 守衛：錦標賽報到的 client 版本閘。
 *
 * 這個功能的**唯一**失敗模式是「把玩家鎖在賽外」——他報不了到就打不了那場比賽。
 * 所以本守衛的重心不在「有沒有擋到人」，而在 **fail-open 的每一條路徑都真的不擋人**。
 *
 * ⚠ 斷言「有呼叫某函式」≠「那件事發生了」：版本比較與「剛更新過」的判定都
 *   **實際 import 真的模組跑真的輸入**（esbuild 轉譯 src/lib/*.ts），不是 grep 字串。
 *   只有「接線」（誰呼叫誰、模板有沒有那兩顆鈕）才用結構掃描，且每條都配自我驗證。
 */
import { build, transform } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.xv6160.mjs');
process.on('exit', () => { try { unlinkSync(OUT); } catch { /* */ } });
// ⚠ 模組不存在／編不起來時**不可以直接爆掉** —— 那樣看起來像「測試環境壞了」，
//   而不是「這一版的東西還沒做」。改成留下 modErr，下面每一條行為斷言各自記一筆 FAIL。
let isClientTooOld = null, recentlyHardRefreshed = null, modErr = null;
try {
  await build({
    entryPoints: [join(ROOT, 'src/lib/version-compare.ts')],
    outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent',
  });
  const m = await import(pathToFileURL(OUT).href);
  isClientTooOld = m.isClientTooOld; recentlyHardRefreshed = m.recentlyHardRefreshed;
  if (typeof isClientTooOld !== 'function' || typeof recentlyHardRefreshed !== 'function') {
    modErr = 'src/lib/version-compare.ts 沒有 export isClientTooOld / recentlyHardRefreshed';
    isClientTooOld = recentlyHardRefreshed = null;
  }
} catch (e) {
  modErr = 'src/lib/version-compare.ts 載入失敗：' + (e && e.message ? e.message.split('\n')[0] : e);
}

// ⚠ 檔案不存在時回空字串（＝所有相關斷言自然 FAIL），不要讓守衛以 ENOENT 爆掉 ——
//   「這一版還沒做」必須看起來像測試沒過，不能看起來像測試環境壞了。
const rd = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
const PAGE = rd('src/routes/game/+page.svelte');
const HOME = rd('src/routes/+page.svelte');
const HR = rd('src/lib/hard-refresh.ts');
const SRV = rd('oracle-admin/server_admin_patch.js');
const ADMIN = rd('oracle-admin/admin.html');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  let v = cond;
  // 條件可以是 thunk：行為斷言用 thunk 包起來，模組缺席時才不會整支爆掉。
  if (typeof cond === 'function') {
    try { v = cond(); } catch (e) { v = false; extra = extra || ('例外：' + (e && e.message)); }
  }
  if (v) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};
// 行為斷言專用：模組缺席時一律記 FAIL（並附上原因），不做任何「假綠」的略過。
const okb = (name, thunk) => ok(name, modErr ? false : thunk, modErr || '');

// ══ ① 版本比較：邊界（行為端，真的跑）══════════════════════════════════
console.log('① 版本比較邊界');
{
  // ⭐ 十進位語義（version.ts 明定 +0.01/+0.1/+1）。段落(semver)語義會把下面第 2 條判反。
  okb('★6.9 比 6.159 新（十進位：.9 = .900 > .159）', () => (isClientTooOld('6.9', '6.159') === false));
  okb('★1.09 比 1.1 舊（段落語義會判反）', () => (isClientTooOld('1.09', '1.1') === true));
  okb('6.2 比 6.10 新', () => (isClientTooOld('6.2', '6.10') === false));
  okb('★10.0 比 6.159 新（純字串比會判反）', () => (isClientTooOld('10.0', '6.159') === false));
  okb('6.144 比 6.149 舊 ⇒ 該擋', () => (isClientTooOld('6.144', '6.149') === true));
  okb('6.160 對門檻 6.149 ⇒ 不擋', () => (isClientTooOld('6.160', '6.149') === false));
  okb('相等不擋', () => (isClientTooOld('6.159', '6.159') === false));
  okb('6.15 與 6.150 視為相等（Mongo 存數字掉尾零也不會靜默降級）',
    () => (isClientTooOld('6.15', '6.150') === false && isClientTooOld('6.150', '6.15') === false));
  okb('前導零 6.009 比 6.01 舊', () => (isClientTooOld('6.009', '6.01') === true));
  // 自我驗證：掃描器本身要抓得到「用字串比」這個錯誤實作
  const strCmp = (a, b) => String(a) < String(b);
  okb('★掃描器自我驗證：字串比在 10.0 vs 6.159 會判反（故本測試確實有鑑別度）',
    () => (strCmp('10.0', '6.159') === true && isClientTooOld('10.0', '6.159') === false));
}

// ══ ② fail-open：解析不了一律不擋 ═══════════════════════════════════════
console.log('② 版本解析 fail-open');
{
  const bad = ['', '6.', '.9', '6.0.1', 'abc', '6', '6.1234567890123', null, undefined, 6.159, {}, [], NaN];
  okb('★★任何無法解析的版本（含 null/數字/三段式/超長）兩側都不擋人', () => {
    let allOpen = true;
    for (const v of bad) {
      if (isClientTooOld(v, '6.149') !== false) { allOpen = false; console.log('    ↳ cur=' + JSON.stringify(v) + ' 竟然擋人'); }
      if (isClientTooOld('6.100', v) !== false) { allOpen = false; console.log('    ↳ min=' + JSON.stringify(v) + ' 竟然擋人'); }
    }
    return allOpen;
  });
  okb('★★門檻為空字串 ＝ 沒設定 ⇒ 不擋任何人（硬約束：沒設定必須 fail-open）',
    () => (isClientTooOld('6.001', '') === false));
  okb('★★後端沒回 minClientVer 欄位（undefined）⇒ 不擋任何人',
    () => (isClientTooOld('6.001', undefined) === false));
}

// ══ ③ 「剛更新過」⇒ 不再擋（fail-open 第三條）═══════════════════════════
console.log('③ 更新後仍太舊 ⇒ 放行');
{
  const now = 1_700_000_000_000;
  okb('★★剛按過更新（_v 在時間窗內）⇒ 視為已更新 ⇒ 不再擋',
    () => (recentlyHardRefreshed('https://x/tournament?_v=' + (now - 5000), now) === true));
  okb('_v 過期（超過 10 分鐘）⇒ 不算剛更新', () => (recentlyHardRefreshed('https://x/tournament?_v=' + (now - 900000), now) === false));
  okb('沒有 _v ⇒ 不算剛更新', () => (recentlyHardRefreshed('https://x/tournament', now) === false));
  okb('_v 是垃圾 ⇒ 不算（且不 throw）', () => (recentlyHardRefreshed('https://x/t?_v=abc', now) === false));
  okb('★未來時間戳也放行（方向要選對：回 true ＝ 不擋人，寬鬆的一邊才安全）',
    () => (recentlyHardRefreshed('https://x/t?_v=' + (now + 999999), now) === true));
  okb('★★任何輸入都不會 throw（會 throw 就等於逃生口壞掉）', () => {
    if (typeof recentlyHardRefreshed !== 'function') return false;
    for (const h of [null, undefined, '', 123, {}, 'not a url at all']) {
      try { recentlyHardRefreshed(h, now); } catch { return false; }
    }
    return true;
  });
}

// ══ ④ 絕不自動重載 ═════════════════════════════════════════════════════
console.log('④ 絕不自動重載');
{
  // 版本閘只會設 tVerModalEventId（開視窗），不可以在判定路徑上直接呼叫 hardRefreshNow。
  const gate = PAGE.slice(PAGE.indexOf('function tCheckinBlockedByVersion'), PAGE.indexOf('async function tVerModalUpdate'));
  ok('★★★版本判定 → 只開視窗，判定/報到路徑上沒有 hardRefreshNow（不自動重載）',
    gate.length > 200 && !gate.includes('hardRefreshNow('));
  ok('★★★hardRefreshNow 只由「玩家按下的那顆鈕」觸發',
    /async function tVerModalUpdate\(\)[\s\S]{0,1600}?await hardRefreshNow\(\)/.test(PAGE));
  ok('模板上 tVerModalUpdate 綁在 onclick（是玩家點的，不是自動跑的）',
    PAGE.includes('onclick={tVerModalUpdate}'));
  // 自我驗證：若有人把 hardRefreshNow 寫進判定函式，上面第一條要能抓到
  ok('★掃描器自我驗證：判定函式裡出現 hardRefreshNow 會被判為未修',
    'function tCheckinBlockedByVersion(){ hardRefreshNow(); }'.includes('hardRefreshNow('));
}

// ══ ⑤ 逃生口 + 接線（結構）═════════════════════════════════════════════
console.log('⑤ 逃生口與接線');
{
  ok('★★★視窗有「先不更新，直接報到」的逃生鈕', PAGE.includes('先不更新，直接報到') && PAGE.includes('onclick={tVerModalSkip}'));
  // ⭐ 逃生鈕必須真的完成報到，而且**前面不可以有任何會 throw 的前置動作**
  const skip = PAGE.slice(PAGE.indexOf('async function tVerModalSkip'), PAGE.indexOf('function tSendLobbyDiag'));
  ok('★★★逃生鈕真的會呼叫報到（不是只把視窗關掉）', /await tCheckinCommit\(_id\)/.test(skip));
  ok('★★逃生路徑沒有 sessionStorage/localStorage（Safari 無痕 setItem 會 throw ⇒ 逃生口壞死）',
    !skip.includes('sessionStorage') && !skip.includes('localStorage'));
  ok('★★整份版本閘都不依賴 Web Storage',
    !PAGE.slice(PAGE.indexOf('function tCheckinBlockedByVersion'), PAGE.indexOf('function tSendLobbyDiag')).match(/sessionStorage|localStorage/));
  ok('報到真的會帶 client 版本給伺服器', PAGE.includes("tApi('/checkin', { eventId, ver: VERSION })"));
  ok('★門檻由 /event 收下，缺欄位退回空字串', PAGE.includes("tMinClientVer = (typeof r.minClientVer === 'string') ? r.minClientVer : '';"));
  ok('★報到剩餘時間不足就不擋（門檻＝30 秒，行為端逐條驗在 ⑩）', /_left < 30000/.test(PAGE));
  ok('★大廳診斷不依賴 tActiveRoom（既有 _tSendClientDiag 在大廳送不出去）',
    /function tSendLobbyDiag[\s\S]{0,600}?tApi\('\/clientdiag'/.test(PAGE)
    && !/function tSendLobbyDiag[\s\S]{0,400}?tActiveRoom/.test(PAGE));
}

// ══ ⑥ 清快取只有一份實作 ═══════════════════════════════════════════════
console.log('⑥ 清快取單一實作');
{
  ok('★src/lib/hard-refresh.ts 存在', HR.length > 0);
  ok('hard-refresh.ts 三個動作齊全（卸 SW / 清 caches / 帶 _v 重載）',
    HR.includes('unregister()') && HR.includes('caches.delete') && HR.includes("searchParams.set('_v'") && HR.includes('location.replace'));
  ok('★保留 v5.909 的 2.5 秒逾時保險（清快取 hang 住也一定會重載）', /Promise\.race\(\[cleanup,[\s\S]{0,80}2500\)/.test(HR));
  ok('★不清 localStorage / IndexedDB（牌組與帳號資料要保留）',
    !/localStorage\.clear|indexedDB\.deleteDatabase/.test(HR));
  ok('★★首頁改用共用實作，沒有留下第二份清快取程式碼',
    HOME.includes("from '$lib/hard-refresh'") && HOME.includes('await hardRefreshNow();')
    && !HOME.includes('caches.delete') && !HOME.includes('getRegistrations()'));
  ok('★★錦標賽頁也是 import 同一支（不是自己抄一份）',
    PAGE.includes("import { hardRefreshNow } from '$lib/hard-refresh';"));
  // ⭐v6.160 收斂第三份：v5.991 的 hardReloadBrokenReg 原本自己抄了一份清快取，
  //   而且少了 2.5 秒逾時保險與 `_v` cache-bypass —— 偏偏它是「特性按鈕靜默消失」的自救鈕。
  ok('★★★全站只剩一份清快取實作（game 頁不再自己 unregister/清 caches）',
    !PAGE.includes('caches.keys()') && !PAGE.includes('caches.delete') && !PAGE.includes('getRegistrations()')
    && /async function hardReloadBrokenReg\(\) \{ await hardRefreshNow\(\); \}/.test(PAGE));
}

// ══ ⑦ 後端：永不擋人 + 灰度慣例 ════════════════════════════════════════
console.log('⑦ 後端');
{
  const ci = SRV.slice(SRV.indexOf("app.post('/api/tournament/checkin'"), SRV.indexOf("app.post('/api/tournament/checkin'") + 2600);
  ok('★★★/checkin 不因版本回 4xx（後端加 gate ＝ 玩家自己救不了自己）',
    !/req\.body\.ver[\s\S]{0,300}res\.status\(4/.test(ci) && !/clientVer[\s\S]{0,200}res\.status\(4/.test(ci));
  ok('★沒帶 ver 記成 pre-gate（唯一能識別 v6.159 以下 client 的訊號）', ci.includes("'pre-gate'"));
  ok('ver 有長度上限與格式驗證（垃圾不進 DB）', ci.includes('slice(0, 16)') && ci.includes('TMINVER_RE.test'));
  ok('★★預設關閉且門檻為空 ⇒ 不擋任何人', SRV.includes('const TMINVER_DEFAULT = { enabled: false, min: \'\' };'));
  ok('只有明確 true 才算開（比照 longPoll/redactState）', /cfg\.enabled = cfg\.enabled === true;[\s\S]{0,400}cfg\.min = TMINVER_RE\.test/.test(SRV));
  ok('★關閉時 /event 一律回空字串（client 據此不擋人）', SRV.includes("const _minClientVer = (_mvc && _mvc.enabled) ? (_mvc.min || '') : '';"));
  ok('★讀設定失敗也不擋人（catch 後 _mvc 維持 null）', /try \{ _mvc = await minVerConfig\(\); \} catch/.test(SRV));
  ok('/event 真的把欄位送出去', /res\.json\(\{ event: ev \|\| null,[^\n]*minClientVer: _minClientVer/.test(SRV));
  ok('admin 端點有 isTournAdmin gate（GET/POST 各一）',
    (SRV.match(/app\.(get|post)\('\/api\/tournament\/admin\/minclientver'[\s\S]{0,240}?isTournAdmin\(id\)\) return res\.status\(403\)/g) || []).length === 2);
  ok('★寫入後快取立刻失效（比照 _lpCfgAt = 0）', SRV.includes('_mvCfgAt = 0;'));
  ok('★啟用但沒有有效門檻要回 400（不可靜默假開）', SRV.includes('要啟用請同時填寫最低版本'));
  ok('門檻一律存字串（存數字 6.150 會被收成 6.15）', SRV.includes('const _m = String(b.min).trim();'));
}

// ══ ⑧ admin 分頁接線 ═══════════════════════════════════════════════════
// ══ ⑨ Fable 5 審查補強（三條都是「會鎖人／訊號消失」等級）════════════════
console.log('⑨ 審查補強');
{
  const VER = rd('src/lib/version.ts');
  // ⑨-1 逃生鈕永遠不可能被永久 disabled：replace 沒真的離開頁面時要有看門狗放開它
  ok('★★★更新鈕有看門狗放開 tVerModalBusy（否則 replace 沒導航 ⇒ 連逃生口都按不動）',
    /setTimeout\(\(\) => \{ tVerModalBusy = false; \}, 5000\);[\s\S]{0,200}?await hardRefreshNow\(\)/.test(PAGE));
  ok('★看門狗掛在 await 之前（掛在後面等於沒掛）',
    PAGE.indexOf('tVerModalBusy = false; }, 5000)') < PAGE.indexOf('try { await hardRefreshNow(); }'));
  // ⑨-2 /clientdiag 節流必須分 reason，否則後送的指紋 100% 被前一則吃掉
  ok('★★★clientdiag 節流是 per-(uid, reason)，不是 per-uid',
    SRV.includes("const _thKey = uid + '|' + String((req.body && req.body.reason) || '');")
    && SRV.includes('_cdiagThrottle.get(_thKey)') && SRV.includes('_cdiagThrottle.set(_thKey, now)'));
  ok('★掃描器自我驗證：舊的 per-uid 寫法會被判為未修',
    !"if (now - (_cdiagThrottle.get(uid) || 0) < 60000)".includes('_thKey'));
  ok('節流 map 上限有跟著放大（key 變細了）', SRV.includes('_cdiagThrottle.size > 2000'));
  // ⑨-3 admin 的「現行部署版本」對照值不可以靜默過期
  ok('★admin 的 SITE_VERSION_HINT 與 src/lib/version.ts 的 VERSION 一致（否則紅字警告會誤發）',
    (() => {
      const a = (ADMIN.match(/window\.SITE_VERSION_HINT = '([\d.]+)';/) || [])[1];
      const v = (VER.match(/export const VERSION = '([\d.]+)';/) || [])[1];
      return !!a && !!v && a === v;
    })(), '出新版時 admin.html 的 SITE_VERSION_HINT 也要一起改');
}

console.log('⑧ admin 分頁');
{
  ok('監控分頁有抓 minclientver', ADMIN.includes("api('/api/tournament/admin/minclientver')"));
  ok('★舊版伺服器偵測沿用 _ok()（api() 從不 reject，用 .catch 是死碼）', ADMIN.includes('mv = _ok(_r[3])'));
  ok('★★handler 掛在 window（admin.html 是 module script，模組層級函式寫進 onclick 會靜默失效）',
    ADMIN.includes('window.monSetMinVer = async function') && ADMIN.includes('onclick="monSetMinVer(true, this)"'));
  ok('★失敗路徑還原按鈕文字（比照 v1.68，否則永遠停在「處理中…」）',
    /monSetMinVer[\s\S]{0,1400}?btn\.textContent = _t0; \} return;/.test(ADMIN));
  ok('★admin 端的版本比較也是十進位語義（不可用 parseFloat/字串比）',
    ADMIN.includes('window.verLE = function') && ADMIN.includes("padEnd(L, '0')") && !/parseFloat\(min/.test(ADMIN));
  ok('UI 明說門檻只對 v6.160 以上生效（避免站長誤以為擋得到舊 client）', ADMIN.includes('只對 v6.160 以上的玩家生效'));
  ok('UI 明說不會鎖人', ADMIN.includes('不會自動重載、也不會擋住報到'));
}

// ══ ⑩ 報到截止前的「剩餘時間門檻」＝30 秒（v6.162 站長裁定，原 90 秒）══════
// ⚠ 這條**刻意不是**「grep 到那個數字就綠」—— 那種寫法實作改成幾就綠成幾，等於假綠。
//   做法：把 tCheckinBlockedByVersion 的原始碼原封不動抽出來、注入 stub 之後**真的跑**，
//   釘住「門檻確實存在、而且真的在 30 秒這個位置生效」：
//     剩 31 秒 ⇒ 仍然提示更新；剩 29 秒 ⇒ 放行（fail-open，絕不把人推去重載）。
//   最後一條是**變異測試**：把門檻改回 90000 的實作在「剩 31 秒」會放行 ⇒ 證明第一條
//   真的擋得住回退，而不是永遠會過。
console.log('⑩ 報到剩餘時間門檻（行為端）');
{
  const THRESHOLD_MS = 30000;
  const _i0 = PAGE.indexOf('function tCheckinBlockedByVersion');
  const src = _i0 < 0 ? '' : PAGE.slice(_i0, PAGE.indexOf('async function tCheckin(', _i0));
  let mkErr = modErr;
  const compile = async (source) => {
    const wrapped = '(function(env){ const { isClientTooOld, recentlyHardRefreshed, VERSION, tMinClientVer, tEvents, tNow, tSendLobbyDiag } = env;\n'
      + source + '\nreturn tCheckinBlockedByVersion; })';
    const js = (await transform(wrapped, { loader: 'ts' })).code;
    const f = (0, eval)(js);
    if (typeof f !== 'function') throw new Error('抽出來的東西不是函式');
    return f;
  };
  let mk = null, mkOld = null;
  if (!mkErr) {
    if (src.length < 200) mkErr = '抽不到 tCheckinBlockedByVersion 的原始碼（函式改名／搬走了？）';
    else {
      const oldSrc = src.replace('_left < ' + THRESHOLD_MS, '_left < 90000');
      if (oldSrc === src) mkErr = '原始碼裡找不到 `_left < ' + THRESHOLD_MS + '`（門檻沒改到，或寫法變了）';
      else {
        try { mk = await compile(src); mkOld = await compile(oldSrc); }
        catch (e) { mkErr = '轉譯/載入失敗：' + (e && e.message ? String(e.message).split('\n')[0] : e); }
      }
    }
  }
  const diag = [];
  // 版本一定太舊（6.100 < 門檻 6.160）⇒ 唯一的變因就是「報到剩餘時間」。
  const run = (factory, leftMs) => {
    diag.length = 0;
    const now = 1700000000000;
    return factory({
      isClientTooOld, recentlyHardRefreshed,
      VERSION: '6.100', tMinClientVer: '6.160',
      tEvents: [{ _id: 'E1', checkInDeadline: (leftMs === null) ? null : (now + leftMs) }],
      tNow: now,
      tSendLobbyDiag: (reason) => { diag.push(reason); },
    })('E1');
  };
  const okx = (name, thunk) => ok(name, mkErr ? false : thunk, mkErr || '');
  okx('★★★剩 31 秒（＞30 秒門檻）⇒ 仍然提示更新', () => (run(mk, 31000) === true));
  okx('★★★剩 29 秒（＜30 秒門檻）⇒ 直接放行，絕不把人推去重載', () => (run(mk, 29000) === false));
  okx('★邊界：剛好剩 30 秒不算「不足」⇒ 仍然提示更新', () => (run(mk, 30000) === true));
  okx('★放行時要留下 checkin-stale-deadline-near 診斷（站長才看得到有人踩到）',
    () => (run(mk, 29000) === false && diag.includes('checkin-stale-deadline-near')));
  okx('★沒有 checkInDeadline ⇒ 剩餘時間視為無限 ⇒ 照常提示更新', () => (run(mk, null) === true));
  okx('★★掃描器自我驗證（變異測試）：門檻退回 90000 的實作在「剩 31 秒」會放行',
    () => (run(mkOld, 31000) === false && run(mk, 31000) === true));
  ok('★註解與程式碼同步講 30 秒（改了數字沒改註解 ⇒ 下一個人被註解騙）',
    /剩不到 30 秒還把人推去重載/.test(PAGE) && !/剩不到 90 秒/.test(PAGE) && !/_left < 90000/.test(PAGE));
}


console.log(`\nv6.160 報到版本閘守衛：${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
