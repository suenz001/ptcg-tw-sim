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
