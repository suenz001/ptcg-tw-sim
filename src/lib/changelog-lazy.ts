// v6.264 首頁「版本更新記錄」較舊條目的補充說明延後載入 —— 純函式部分。
//
// 背景：static/changelog.html 是**每次開啟首頁都會 fetch 一整份**的片段（v5.969 起）。
//   它固定 50 則、每出一版「進一則、擠掉最舊一則」，但新條目普遍比被擠掉的舊條目長，
//   到 v6.263 已累積到 61,436 bytes，距離守衛的 60KB（61,440 bytes）上限只剩 4 bytes
//   —— 下一則必爆。其中 log-body 的內文就佔了 40,729 bytes（66%），
//   而那是「展開才看得到」的補充說明。
//
// 站長裁定：「首頁只載最新 N 則，其餘展開才拓」。
//   ⇒ static/changelog.html 只內嵌最新 12 則的完整內文；更舊的 38 則只留標題（summary），
//     並在 details 上標 data-ver；內文全部搬到 static/changelog-bodies.html，
//     玩家展開那一則的當下才 fetch（整份只抓一次，之後共用）。
//
// ⚠ 這裡刻意只放**與 DOM 無關的純字串邏輯**，讓守衛能直接執行、斷言到行為層
//   （v6.154 教訓：只驗「字串存在」擋不住「接線沒接上」）。

/** 補充說明片段的檔名（首頁與守衛共用同一個常數，避免兩邊各寫一份而漂移）。 */
export const CHANGELOG_BODIES_FILE = 'changelog-bodies.html';

/**
 * 版本字串格式檢查。
 * ⚠ data-ver 雖然出自我們自己的靜態檔，仍不可直接拿去拼比對樣式 ——
 *   萬一 admin 後台 override 的 HTML 裡貼了奇怪的 data-ver，這裡先擋掉。
 */
export function isValidChangelogVer(ver: string): boolean {
  return /^v\d+(?:\.\d+)*$/.test(ver);
}

/**
 * 從 changelog-bodies.html 取出指定版本那一則的內文（不含外層標籤）。
 * 找不到就回 null —— 呼叫端必須顯示「可以再展開一次」的提示，不可靜默留白。
 *
 * ⚠ 用字串定位而不是貪婪比對：內文一律是純文字加 inline 標籤，
 *   守衛 test-v6264-changelog-lazy-body.mjs 有一條專門釘住「內文不得含巢狀 div」，
 *   否則這裡會抓到錯的結束標籤。
 */
export function pickChangelogBody(bodiesHtml: string, ver: string): string | null {
  if (!isValidChangelogVer(ver)) return null;
  const openTag = '<div class="log-body" data-ver="' + ver + '">';
  const i = bodiesHtml.indexOf(openTag);
  if (i < 0) return null;
  const from = i + openTag.length;
  const j = bodiesHtml.indexOf('</div>', from);
  if (j < 0) return null;
  return bodiesHtml.slice(from, j);
}
