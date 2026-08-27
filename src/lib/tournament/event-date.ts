/**
 * 錦標賽「賽事日期」的單一來源（v6.244）。
 *
 * ⚠⚠ 名詞（本版起全站統一，不可再混用）：
 *   - **開賽時間 `startedAt`**：賽程產生、第 1 輪開打的那一刻 ＝ 這場賽事「是哪一天辦的」。
 *   - **冠軍產生時間 `finishedAt`**：決賽結束、冠軍誕生的那一刻。
 *
 * 站長 2026-08-27 回報：網站賽-95【21:00 瑞士制】在台灣時間 8/26 21:00 開打，
 * 決賽打完已經是 8/27 00:xx ⇒ 名人堂拿 `finishedAt` 當賽事日期就會顯示成 2026/08/27。
 * ⇒ 歷屆冠軍／個人參賽紀錄／奪冠報告圖的「日期」一律改用**開賽時間**。
 *
 * ⚠ 時區：站台玩家全在台灣，但 `toLocaleDateString()` 吃的是**執行環境**時區
 *   （伺服器在新加坡剛好也是 +8，玩家的瀏覽器卻可能不是）。這裡固定 UTC+8，
 *   而且刻意用 `getUTC*` 而不是 `Intl` 的 `timeZone` 選項 —— 不依賴執行環境的 ICU 時區資料。
 */

/** 台灣時區固定偏移（UTC+8；台灣不實施日光節約時間，所以是常數而不是查表）。 */
export const TW_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 帶時間欄位的賽事紀錄（名人堂 champion／歸檔 archive 都符合這個形狀）。 */
export type TournamentTimeRec = {
  /** 開賽（賽程產生）時間 */
  startedAt?: number | null;
  /** 賽事建立時間；只在 startedAt 缺席時當退路 */
  createdAt?: number | null;
  /** 冠軍產生時間 —— ⚠ 這**不是**賽事日期 */
  finishedAt?: number | null;
} | null | undefined;

/**
 * 這場賽事「是哪一天辦的」＝ 開賽時間的毫秒數。
 *
 * 退路順序：`startedAt` → `createdAt` → `finishedAt`。
 * ⚠ 最後一階是 fail-open：舊版伺服器（不回 startedAt）或極早期的歸檔資料只有 finishedAt，
 *   此時行為與 v6.243 完全相同，不會變成空白。
 */
export function tournamentStartMs(rec: TournamentTimeRec): number {
  if (!rec) return 0;
  return Number(rec.startedAt) || Number(rec.createdAt) || Number(rec.finishedAt) || 0;
}

/** 固定以台灣時間（UTC+8）格式化成 `YYYY/MM/DD`；0／缺席回空字串。 */
export function formatDateTW(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n + TW_OFFSET_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return d.getUTCFullYear() + '/' + mm + '/' + dd;
}

/** 固定以台灣時間（UTC+8）格式化成 `M/D`（報告圖那種窄版面用）。 */
export function formatShortDateTW(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n + TW_OFFSET_MS);
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
}

/** 賽事日期（台灣時間，以**開賽時間**為基準）。直接吃冠軍／歸檔紀錄。 */
export function tournamentDateTW(rec: TournamentTimeRec): string {
  return formatDateTW(tournamentStartMs(rec));
}
