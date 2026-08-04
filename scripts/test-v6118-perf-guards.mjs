// v6.118 效能守衛：兩個「人一多／卡一多就放大」的結構性問題，都不得再回來。
//
// 站長回報：①「開啟正式站的卡牌資料庫、所有卡牌，常常都會卡住」
//           ②「錦標賽人比較多（約 30 人以上），系統就會變得很 lag」
//
// 查證後的根因（兩個都是**既有**結構問題，被最近的資料量／人數放大）：
//   B線：/tournament 是 `<GamePage tournamentMode={true} />`（同一個元件），而
//        `onlineStep` 初始值就是 'join'、錦標賽流程從不改它，正式站又必定設好 myUid
//        ⇒ 訂閱休閒大廳的 $effect 條件成立 ⇒ **每人每 2 秒兩支 /api/rooms**，
//        30 人 ≈ 30 req/s 純浪費，打進 Oracle 單執行緒。
//   A線：/cards?set=ALL 一次全量渲染 4930 張卡（≈3 萬個 DOM 節點）；
//        而且 v6.101 的 use:retryImg **每個 <img> 各自**掛 window/document listener
//        ⇒ 近 1 萬個全域監聽器。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAME = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const CARDS = readFileSync(join(ROOT, 'src/routes/cards/+page.svelte'), 'utf8');
const RETRY = readFileSync(join(ROOT, 'src/lib/img-retry.ts'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
/** 用結構 anchor 截段，不寫死行數。 */
function sliceFrom(text, needle, len) {
  const i = text.indexOf(needle);
  return i < 0 ? null : text.slice(i, i + len);
}

console.log('① 錦標賽頁不得訂閱休閒大廳輪詢');

T('⭐⭐⭐ 訂閱 subscribeOpenRooms 的條件必須含 !isTournament', () => {
  const i = GAME.indexOf('unsubOpenRooms = subscribeOpenRooms(');
  ok(i > 0, '找不到 subscribeOpenRooms 的訂閱點');
  // 往回找最近的 if 條件
  const head = GAME.slice(Math.max(0, i - 1200), i);
  const m = head.match(/if \(([^)]*onlineStep === 'join'[^)]*)\)/);
  ok(m, '找不到訂閱的 if 條件（結構改了，請重新檢視本守衛）');
  ok(/!isTournament/.test(m[1]),
    '訂閱條件是「' + m[1] + '」——少了 !isTournament。\n'
    + '      錦標賽頁的 onlineStep 永遠是 join（三個 =\'room\' 賦值點全在休閒路徑上），\n'
    + '      這條訂閱會讓每位參賽者每 2 秒打兩支 /api/rooms，30 人賽 ≈ 30 req/s 純浪費。');
});

T('⭐ ensureRoomArchetypes 也要有 isTournament 早退（雙保險）', () => {
  const fn = sliceFrom(GAME, 'async function ensureRoomArchetypes', 700);
  ok(fn, '找不到 ensureRoomArchetypes');
  ok(/if \(isTournament\) return;/.test(fn),
    'ensureRoomArchetypes 沒有 isTournament 早退 —— 若 $effect 的 gate 又被改壞，'
    + '錦標賽頁會連 /api/rooms-archetypes 一起打');
  ok(/if \(!ORACLE_MODE\) return;/.test(fn), 'ORACLE_MODE 早退不見了（測試站沒有規則庫）');
});

T('⭐ 輪詢間隔沒有被偷偷調快（大廳 2 秒是刻意的下限）', () => {
  const ro = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');
  const i = ro.indexOf('export function subscribeOpenRooms');
  ok(i > 0, '找不到 subscribeOpenRooms');
  const body = ro.slice(i, i + 1800);
  const m = body.match(/setTimeout\(tick,\s*(\d+)\)/);
  ok(m, '找不到輪詢間隔');
  ok(Number(m[1]) >= 2000, '大廳輪詢間隔被調成 ' + m[1] + 'ms（< 2000），會放大伺服器負載');
});

T('正對照：判準抓得到「沒有 gate」的樣本', () => {
  const probe = "if (onlineStep === 'join' && myUid) {";
  ok(!/!isTournament/.test(probe), '判準抓不到未 gate 樣本 ⇒ 假綠');
});

console.log('② 卡牌資料庫「所有卡牌」不得再全量渲染');

T('⭐⭐ grid 的 each 必須吃分頁後的清單，不能直接吃 filtered', () => {
  const i = CARDS.indexOf('<div class="grid">');
  ok(i > 0, '找不到卡片 grid');
  const blk = CARDS.slice(i, i + 400);
  ok(!/\{#each filtered as card/.test(blk),
    'grid 仍直接 {#each filtered} —— ALL 模式會一次建立 4930 張卡（≈3 萬個 DOM 節點），'
    + '主執行緒會整段凍住');
  ok(/\{#each shown as card/.test(blk), 'grid 應改吃 shown（filtered 的前 N 筆）');
});

T('⭐ 必須有「捲到底再追加」的機制，且篩選變動要歸零', () => {
  ok(/const PAGE_SIZE\s*=\s*\d+/.test(CARDS), '沒有 PAGE_SIZE');
  ok(/visibleCount\s*\+=\s*PAGE_SIZE/.test(CARDS), '沒有追加下一批的邏輯');
  ok(/IntersectionObserver/.test(CARDS), '沒有用 IntersectionObserver 觸發追加');
  ok(/visibleCount = PAGE_SIZE;/.test(CARDS),
    '篩選／搜尋變動後沒有把 visibleCount 歸零 —— 會停在上一次的捲動量');
});

T('⭐ 搜尋要 debounce（每敲一字全量重算 4930 張會頓）', () => {
  ok(/debouncedQuery/.test(CARDS), '沒有 debouncedQuery');
  const f = sliceFrom(CARDS, 'const filtered = $derived.by', 300);
  ok(f && /debouncedQuery\.trim\(\)/.test(f),
    'filtered 仍直接讀 query（未 debounce）——每個 input 事件都會全量重算＋keyed diff');
});

console.log('③ retryImg 不得每張圖各掛一組全域 listener');

T('⭐⭐ window/document 的 listener 必須綁在模組層級，只綁一次', () => {
  ok(/const kickers = new Set/.test(RETRY), '沒有模組層級的分發集合');
  ok(/boundWindows/.test(RETRY) || /globalBound/.test(RETRY), '沒有「只綁一次」的旗標');
  // action 內部不得再出現對 window/document 的 addEventListener
  const i = RETRY.indexOf('export function retryImg');
  ok(i > 0, '找不到 retryImg');
  const body = RETRY.slice(i);
  ok(!/window\.addEventListener/.test(body) && !/document\.addEventListener/.test(body),
    'retryImg 內仍對 window/document addEventListener —— 4930 張卡會掛出近 1 萬個全域監聽器');
  ok(/kickers\.add\(/.test(body) && /kickers\.delete\(/.test(body),
    '節點要登記／註銷到分發集合，否則不是洩漏就是收不到事件');
});

T('正對照：判準抓得到「每個節點各自掛全域事件」的樣本', () => {
  const probe = "  node.addEventListener('error', onError);\n  window.addEventListener('online', onOnline);";
  ok(/window\.addEventListener/.test(probe), '判準抓不到樣本 ⇒ 假綠');
});

console.log('\n=== v6.118 效能守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
