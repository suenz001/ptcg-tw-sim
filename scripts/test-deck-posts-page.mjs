// v6.139 批次2 守衛：牌組公布欄前端頁（/deck-posts）。
//
// 這一頁把**其他玩家自由輸入的文字**與**其他玩家提供的牌組資料**渲染出來，
// 幾個壞掉時不會有錯誤訊息的點：
//   ・用 {@html} 渲染 notes/deckName → 儲存型 XSS，而且是站長一個人維運的站
//   ・明細用 loadAllSets → 每開一副牌就拉 40 個卡包（/cards 全量渲染是既有效能事故源）
//   ・beta 測試站沒有這些 API，靜態 404 頁不是 JSON → 玩家看到莫名其妙的解析錯誤
//   ・匯入沒走 migrateDeck → 「兩張合一」競技場不會被拆成兩張，牌組編輯器會壞掉
//   ・合法性驗證擋住匯入 → 標準輪替後所有歷史牌組都變成看得到拿不到
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE_PATH = join(ROOT, 'src/routes/deck-posts/+page.svelte');
const DECKS_PATH = join(ROOT, 'src/routes/decks/+page.svelte');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/**
 * 取兩個 anchor 之間的區段，**兩端都必須找得到**。
 * ⚠ 直接用 `indexOf` 當 slice 參數的話，anchor 失效時會回 -1，
 *   `slice(start, -1)` 是合法的「切到倒數第一個字元」—— 斷言就靜默地變成在掃全檔。
 *   （本輪就是拿註解當結尾 anchor，而掃描的是剝過註解的版本。）
 */
function sliceFn(src, startAnchor, endAnchor) {
  const i = src.indexOf(startAnchor);
  ok(i >= 0, '切片起點 anchor 失效：' + startAnchor);
  const j = src.indexOf(endAnchor, i + startAnchor.length);
  ok(j > i, '切片結尾 anchor 失效：' + endAnchor + '（anchor 不能用註解 —— 掃描的是剝過註解的版本）');
  return src.slice(i, j);
}

/**
 * 剝掉註解。
 *
 * ⚠ 這是**否定型斷言的必要前置**。本輪就踩了：頁面頂部的註解寫著「全頁不得出現 {@html}」
 *   與「不是 loadAllSets」，掃描器把註解裡的字當成真的用到了 → 兩項假紅。
 *   （repo 已經被註解騙過三、四次，IRON_RULES Rule 25 專門講這件事。）
 *   反過來如果是肯定型斷言，同樣的註解就會給出**假綠**，那更危險。
 *
 * 保守作法：只剝 `//` 行註解（避開 `://` 這種網址）與 `/* *​/` 區塊註解、HTML 註解。
 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

ok(existsSync(PAGE_PATH), '找不到 /deck-posts 頁 —— 掃描器自己壞了，以下斷言都不可信');
const RAW = readFileSync(PAGE_PATH, 'utf8');
const P = stripComments(RAW);
const D = stripComments(readFileSync(DECKS_PATH, 'utf8'));
ok(RAW.length > 3000, '頁面檔案太小，八成不是預期的那一份');
// 自我驗證：剝註解不能把整個檔案剝光，也必須真的有剝到東西
ok(P.length > RAW.length * 0.5, '剝註解剝掉一半以上內容 —— stripComments 壞了');
ok(P.length < RAW.length, 'stripComments 什麼都沒剝掉 —— 那它就沒在運作');
ok(!/全頁不得出現/.test(P), '剝註解後仍看得到註解文字 —— 否定型斷言會被騙');

console.log('\n① 渲染別人輸入的文字');

T('⭐⭐⭐ 全頁不得出現 {@html}（notes / deckName / authorName 都是玩家自由輸入）', () => {
  ok(!/\{@html/.test(P), '出現了 {@html} —— 投稿內容會變成儲存型 XSS');
});

T('⭐ 玩家輸入的三個欄位都以純文字插值渲染', () => {
  for (const f of ['notes', 'deckName', 'authorName']) {
    ok(new RegExp('\\{(openPost\\.|p\\.)' + f + '\\}').test(P), f + ' 沒有以純插值渲染（或根本沒顯示）');
  }
});

console.log('\n② 載入量：不得為了一副牌拉整個卡池');

T('⭐⭐⭐ 明細走 loadDeckSets（只載這副牌用到的卡包），不得用 loadAllSets', () => {
  ok(/loadDeckSets/.test(P), '沒有用 loadDeckSets');
  ok(!/loadAllSets/.test(P),
    '用了 loadAllSets —— 每開一副牌就拉 40 個卡包約 4.6MB（v6.118 的 /cards 全量渲染教訓）');
});

T('⭐ 牌表是文字列表，不渲染 60 張卡圖', () => {
  ok(!/<img/.test(P), '出現了 <img> —— v1 明細刻意不渲染卡圖');
  ok(!/retryImg/.test(P), '掛了卡圖重試 —— 表示有在載圖');
});

T('⭐ 列表不依賴 entries 欄位（後端列表的 projection 刻意排除它）', () => {
  const script = P.slice(0, P.indexOf('</script>'));
  const listPart = script.slice(script.indexOf('async function fetchList'), script.indexOf('async function openDetail'));
  ok(!/\.entries/.test(listPart),
    '列表流程讀了 entries —— 後端不回這個欄位，會是 undefined');
});

console.log('\n③ 測試站沒有這些 API');

T('⭐⭐ 非 JSON 回應要當成「此站沒有這個功能」，不是解析錯誤', () => {
  ok(/content-type/i.test(P), '沒有檢查 content-type —— 靜態站的 404 頁會被當成 JSON 解析而爆錯');
  ok(/apiUnavailable/.test(P), '沒有「API 不存在」的狀態');
  ok(/正式站/.test(P), '沒有告訴玩家哪裡才有這個功能');
});

T('⭐ API 不存在時不要再顯示一般錯誤訊息（兩種訊息同時出現只會讓人更困惑）', () => {
  ok(/'unavailable'/.test(P), '沒有用專門的 sentinel 區分兩種失敗');
  ok(/!==\s*'unavailable'/.test(P), '沒有在 catch 裡把 unavailable 排除掉');
});

console.log('\n③-2 慢請求與亂序（Fable 5 review）');

T('⭐⭐⭐ 明細有請求代次，且 closeDetail 一定要清掉載入中狀態', () => {
  ok(/detailSeq/.test(P), '明細沒有請求代次 —— 遲到的回應會把玩家關掉的 modal 重新彈開');
  const fn = P.slice(P.indexOf('function closeDetail'), P.indexOf('const detailRows'));
  ok(/detailSeq\+\+/.test(fn), 'closeDetail 沒有遞增代次');
  ok(/detailLoading\s*=\s*false/.test(fn),
    'closeDetail 沒有清 detailLoading —— 載入中的 modal 沒有關閉按鈕，玩家會被全屏 backdrop 鎖死');
});

T('⭐⭐ 列表有請求代次（快速切排序時慢的舊回應不得蓋掉新的）', () => {
  ok(/listSeq/.test(P), '列表沒有請求代次 —— 排序 tab 會和內容對不上（v6.135 同型 bug）');
  const fn = P.slice(P.indexOf('async function fetchList'), P.indexOf('function changeSort'));
  ok(/seq !== listSeq/.test(fn), 'fetchList 沒有在寫回前檢查代次');
});

T('⭐⭐ 正式站的 5xx 不得被說成「你在測試站」', () => {
  const fn = P.slice(P.indexOf('async function api'), P.indexOf('async function fetchList'));
  ok(/res\.status\s*>=\s*500/.test(fn),
    '非 JSON 一律當成「此站沒有這個功能」—— tunnel 掛掉時正式站玩家會看到一段斷言他在測試站的公告，而且 UI 永久隱藏');
  const i5 = fn.indexOf('res.status >= 500'), iU = fn.indexOf('apiUnavailable = true');
  ok(i5 >= 0 && iU > i5, '5xx 分流寫在 apiUnavailable 之後 —— 走不到');
});

T('⭐⭐ 匯入要置頂並同步雲端（否則會被「從雲端載入」無聲洗掉）', () => {
  const fn = P.slice(P.indexOf('function doImport'), P.indexOf('async function countDownload'));
  ok(/order:/.test(fn), '沒有設 order —— sortDecks 會把它排到所有牌組後面，但定案寫的是置頂');
  ok(/syncDeckToCloud\(/.test(fn),
    '沒有同步到雲端 —— 編輯器只在儲存時同步，而它的「從雲端載入」是整包覆蓋，匯入後沒編輯過的牌組會消失');
  ok(/isAnonymous/.test(fn), '沒有排除匿名帳號');
  ok(/catch/.test(fn), '雲端同步失敗沒有 catch —— 離線時會打斷匯入');
});

console.log('\n④ 匯入');

T('⭐⭐⭐ 匯入必須走 migrateDeck（含「兩張合一」競技場拆分與 cardId 遷移）', () => {
  ok(/migrateDeck\(/.test(P),
    '匯入沒有走 migrateDeck —— 兩張合一競技場不會被拆成兩張實體卡，牌組編輯器會顯示異常');
  ok(/upsertDeck\(/.test(P), '沒有寫進牌組儲存');
  ok(/newDeck\(/.test(P), '沒有用 newDeck 產生新 id —— 直接沿用投稿 id 會覆蓋玩家自己的牌組');
});

T('⭐⭐ 合法性只是提示，不得擋住匯入（標準輪替後歷史牌組仍有保存價值）', () => {
  const fn = P.slice(P.indexOf('function doImport'), P.indexOf('async function countDownload'));
  ok(/validateDeck\(/.test(fn), '完全沒驗，玩家不會知道這副牌現在不合法');
  ok(!/if\s*\(!?v\.legal\)\s*\{?\s*(return|throw)/.test(fn),
    '不合法就 return/throw —— 標準輪替後所有歷史牌組都會變成看得到拿不到');
  const iUp = fn.indexOf('upsertDeck('), iV = fn.indexOf('validateDeck(');
  ok(iUp >= 0 && iV > iUp, '驗證寫在 upsertDeck 之前 —— 順序上就是想擋');
});

T('⭐ 下載計數失敗不得影響匯入（未登入時伺服器回 204，本來就不計數）', () => {
  const fn = P.slice(P.indexOf('async function countDownload'), P.indexOf('function fmtDate'));
  ok(/catch/.test(fn), '計數沒有 catch —— 失敗會冒泡打斷匯入');
  ok(!/throw/.test(fn), '計數失敗往外丟了');
});

console.log('\n④-2 投稿／按讚／我的投稿（v6.140 批次3）');

T('⭐⭐⭐ 刪除必須有確認與 busy 防護（不可逆，且連點會顯示假錯誤）', () => {
  const fn = P.slice(P.indexOf('async function deleteMine'), P.indexOf('function openPostModal'));
  ok(/confirm\(/.test(fn), '刪除沒有確認 —— 手機上緊貼統計數字，一 tap 就永久毀損且無復原路徑');
  ok(/deleteBusy/.test(fn),
    '沒有 busy 防護 —— 連點第二下會撞伺服器的 status:{$ne:deleted} 回 404，刪除成功卻對玩家報錯');
  ok(/mineSeq\+\+/.test(fn), '刪除後沒讓還在飛的 fetchMine 作廢 —— 遲到的回應會把「已刪除」蓋回去');
});

T('⭐⭐ 按讚失敗不得寫進 detailError（那會把整份牌表換成一行錯誤）', () => {
  const fn = P.slice(P.indexOf('async function toggleLike'), P.indexOf('async function fetchMine'));
  ok(!/detailError\s*=/.test(fn),
    '按讚的 catch 寫了 detailError —— modal 分支順序是 detailError 優先於 openPost，遇到 429 或投稿剛被下架時整份牌表會消失');
  ok(/likeError\s*=/.test(fn), '沒有獨立的按讚錯誤狀態');
});

T('⭐⭐ 按讚以伺服器回傳的數字為準，不是本地 +1', () => {
  const fn = P.slice(P.indexOf('async function toggleLike'), P.indexOf('async function fetchMine'));
  ok(/r\.likeCount/.test(fn), '沒有採用伺服器回傳的 likeCount —— 本地 +1 會和唯一鍵去重的實際結果不一致');
  ok(/openPost\.id === p\.id/.test(fn), '寫回前沒確認還是同一篇 —— 玩家切到別篇時會寫錯對象');
});

T('⭐⭐ 被站長下架（hidden）的投稿也要能刪', () => {
  ok(/p\.status !== 'deleted'/.test(P),
    '只讓 published 可刪 —— 投稿總量上限算的是「未刪除」的，被下架 10 篇的玩家會永遠不能再投稿也無法自救');
});

T('⭐⭐ fetchMine 有代次防護（與本地刪除狀態會打架）', () => {
  ok(/mineSeq/.test(P), 'fetchMine 沒有代次 —— auth callback 與切分頁會同時在飛兩發');
  const fn = P.slice(P.indexOf('async function fetchMine'), P.indexOf('function switchTab'));
  ok(/seq !== mineSeq/.test(fn), 'fetchMine 沒有在寫回前檢查代次');
});

T('⭐ 三個寫入動作都有 busy 防護（連點不得重複送出）', () => {
  for (const [name, flag, a, b] of [
    ['投稿', 'postBusy', 'async function doPost', 'async function fetchEligibility'],
    ['賽事分享', 'tSubmitBusy', 'async function submitTournament', 'function fmtDate'],
  ]) {
    const fn = P.slice(P.indexOf(a), P.indexOf(b));
    ok(new RegExp(flag).test(fn), name + ' 沒有 busy 旗標');
  }
  ok(/likeBusy/.test(P), '按讚沒有 busy 旗標');
});

T('⭐⭐ 投稿／按讚／賽事分享的入口都 gate 在「已登入非匿名」（後端對匿名一律 403）', () => {
  ok(/const canPost = \$derived\(!!firebaseUser && !firebaseUser\.isAnonymous\)/.test(P),
    '沒有 canPost 判定 —— 顯示可按但按下去 403 是最糟的錯誤體驗');
  ok(/\{#if canPost\}/.test(P), 'template 沒有用 canPost 分流');
});

T('⭐⭐ 需要登入的兩支查詢只在拿到非匿名使用者後才發（v6.026 auth-race 教訓）', () => {
  const fn = P.slice(P.indexOf('onMount(()'), P.indexOf('const canPost'));
  ok(/isAnonymous/.test(fn),
    'onAuthStateChanged 裡沒判匿名 —— 訂閱 effect 跑得比 auth 還早會拿不到 token，401 被靜默吞掉');
  ok(/fetchEligibility\(\)/.test(fn), 'eligibility 不是在 auth callback 裡發');
});

console.log('\n④-3 iOS 動態島安全區（玩家回報：按不到「← 首頁」）');

T('⭐⭐ 頁面頂部必須留 safe-area-inset-top（全站標準，/cards /decks 首頁都有）', () => {
  ok(/env\(safe-area-inset-top/.test(RAW),
    '沒有 safe-area-inset-top —— 有動態島的 iPhone 上「← 首頁」會被系統 UI 蓋住按不到');
  const mainBlock = /\bmain\s*\{[^}]*\}/.exec(RAW);
  ok(mainBlock && /env\(safe-area-inset-top/.test(mainBlock[0]), 'main 的 padding 沒有帶 safe-area-inset-top');
});

T('⭐⭐ 手機斷點不得把 safe-area 整條覆蓋掉（改窄邊距時最容易犯）', () => {
  const mq = /@media \(max-width: 600px\)\s*\{[\s\S]*?\n  \}/.exec(RAW);
  ok(mq, '找不到手機斷點');
  // 斷點內若有重新宣告 main 的 padding，就必須一併帶 env()
  const mainInMq = /\bmain\s*\{[^}]*padding[^}]*\}/.exec(mq[0]);
  if (mainInMq) {
    ok(/env\(safe-area-inset-top/.test(mainInMq[0]),
      '手機斷點重新宣告了 main 的 padding 卻沒帶 env() —— 會整條蓋掉桌機版的 safe-area');
  }
});

T('⭐ modal 也要避開動態島（貼齊上緣時關閉鈕會被蓋住）', () => {
  const bd = /\.modal-backdrop\s*\{[^}]*\}/.exec(RAW);
  ok(bd && /env\(safe-area-inset-top/.test(bd[0]), 'modal backdrop 沒有 safe-area-inset-top');
});

console.log('\n④-4 改顯示名稱（v6.143）');

T('⭐⭐⭐ 編輯只送名稱與說明，**絕不送牌組內容**', () => {
  // ⚠ 切片 anchor **不能用註解** —— P 是剝過註解的，indexOf 會回 -1，
  //   slice(start, -1) 就變成「整個檔案剩下的部分」，斷言等於在掃全檔（v6.143 假紅）。
  const fn = sliceFn(P, 'async function saveEdit', 'function openPostModal');
  ok(/authorName/.test(fn) && /notes/.test(fn), 'saveEdit 沒有送 authorName 或 notes');
  ok(!/entries|deckName/.test(fn),
    'saveEdit 送出了 entries 或 deckName —— 換皮繼承讚的漏洞');
  ok(/editBusy/.test(fn), '沒有 busy 防護');
  ok(/fetchList\(\)/.test(fn), '改完沒重抓公開列表 —— 列表上還是舊資料');
});

T('⭐ 已刪除的投稿不給編輯', () => {
  ok(/editId === p\.id/.test(P) || /editId !== p\.id/.test(P), '沒有 per-post 的編輯狀態');
  const seg = sliceFn(P, '{#if editId !== p.id}', '<span class="dot">');
  ok(/p\.status !== 'deleted'/.test(seg), '已刪除的投稿仍顯示編輯鈕');
});

console.log('\n⑤ 入口與身分');

T('⭐ 牌組編輯器有公布欄入口（沒有入口等於沒上線）', () => {
  ok(/\/deck-posts/.test(D), '/decks 頁沒有連到公布欄');
});

T('⭐ 帶 token 是盡力而為：拿不到就不帶，未登入仍可瀏覽與匯入', () => {
  ok(/getIdToken\(\)/.test(P), '沒有帶 Firebase ID token');
  ok(/isAnonymous/.test(P), '沒有排除匿名帳號 —— 後端對匿名一律拒絕，帶了只會拿到 403');
  const fn = P.slice(P.indexOf('async function authHeaders'), P.indexOf('async function api'));
  ok(/catch/.test(fn), '取 token 沒有 catch —— 失敗會讓整頁載不出來');
});

console.log('\n' + (fail ? '✗' : '✓') + ' 通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
process.exit(fail ? 1 : 0);
