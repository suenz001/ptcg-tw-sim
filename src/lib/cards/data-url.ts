// ⭐v6.509 卡包資料檔的網址（唯一出口）：?v= 帶「檔案內容雜湊」，不是網站版本號。
//   站長 2026-10-07：「卡片資料沒變就不用重新下載。以後只有補新卡包時才會重抓」。
//   雜湊在建置時由 vite.config.js 的 cardDataHashes() 算好，以 __CARD_DATA_HASHES__ 注入。
//   ⚠ 沒有注入（例：守衛用 esbuild 直接打包、或檔案不在清單裡）⇒ 退回網站版本號（＝舊行為，最壞只是多下載一次）。
import { VERSION } from '$lib/version';

declare const __CARD_DATA_HASHES__: Record<string, string> | undefined;

/** 取得某個資料檔（相對於站台根目錄，例：'cards/M3.json'、'card-set-map.json'）的快取版本字串。 */
export function cardDataVer(rel: string, hashes?: Record<string, string> | null): string {
  const m = hashes !== undefined ? hashes : (typeof __CARD_DATA_HASHES__ !== 'undefined' ? __CARD_DATA_HASHES__ : null);
  const h = m && typeof m[rel] === 'string' ? m[rel] : '';
  return h ? 'c' + h : VERSION;
}

/** 完整網址：`${base}/${rel}?v=<內容雜湊>` */
export function cardDataUrl(base: string, rel: string): string {
  return `${base}/${rel}?v=${encodeURIComponent(cardDataVer(rel))}`;
}
