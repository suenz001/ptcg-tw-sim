// v5.968 SW / version-skew 策略純函式（service-worker 與 +layout 共用；不依賴 SW/瀏覽器專屬 global，方便單元測試）。

const CACHE_PREFIX = 'ptcg-tw-sim-';

/**
 * ⭐v6.509 卡包資料（/cards/*.json、/card-set-map.json）的專用快取：不跟著網站版本走。
 *   網址的 ?v= 是檔案內容雜湊（見 $lib/cards/data-url.ts）⇒ 內容沒變網址就不變，新版上線也不必重抓。
 *   同一個檔換了新雜湊時，舊的那一筆由 staleCardDataUrls 挑出來刪掉（不會無限長大）。
 */
export const CARD_DATA_CACHE = 'ptcg-tw-sim-carddata';
/** 這個路徑是不是卡包資料檔（測試站帶 base path ⇒ 用結尾判斷）。 */
export function isCardDataPath(pathname: string): boolean {
  return /\/cards\/[^/]+\.json$/.test(pathname) || pathname.endsWith('/card-set-map.json');
}
/** 存進新的一筆時，同一個檔（同路徑、不同 ?v=）的舊網址要刪掉。 */
export function staleCardDataUrls(cachedUrls: string[], newUrl: string): string[] {
  const n = new URL(newUrl);
  return cachedUrls.filter((u) => { try { const x = new URL(u); return x.pathname === n.pathname && x.search !== n.search; } catch { return false; } });
}

function cacheSuffixNum(key: string, prefix = CACHE_PREFIX): number {
  if (!key.startsWith(prefix)) return -1;
  const n = Number(key.slice(prefix.length));
  return Number.isFinite(n) ? n : -1;
}

/**
 * activate 時要刪除的舊 cache key 清單。
 * 保留：現行版(current) + 最近一個舊版(suffix 次高者)；其餘(含非本站前綴者)全刪。
 * 目的：新版 activate 後，開著舊 HTML 的分頁 lazy import 舊 hash chunk 仍能從保留的前一版 cache 命中，
 *       不會 404 白屏(version-skew)。只保留 1 個舊版，避免 cache 無限成長。
 */
export function cachesToDelete(allKeys: string[], current: string, prefix = CACHE_PREFIX): string[] {
  // ⭐v6.509 卡包資料快取（CARD_DATA_CACHE）跨版本保留：裡面的網址帶內容雜湊，卡片沒變就一直沿用
  const others = allKeys.filter((k) => k !== current && k !== CARD_DATA_CACHE);
  const prevMostRecent = others
    .filter((k) => cacheSuffixNum(k, prefix) >= 0)
    .sort((a, b) => cacheSuffixNum(b, prefix) - cacheSuffixNum(a, prefix))[0];
  return others.filter((k) => k !== prevMostRecent);
}

/**
 * 判斷是否為「動態載入 chunk 失敗」錯誤(version-skew 導致舊 hash chunk 404 / import 失敗)。
 * 各瀏覽器訊息不同，涵蓋常見樣本。
 */
export function isChunkLoadError(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('failed to fetch dynamically imported module') ||
    m.includes('error loading dynamically imported module') ||
    m.includes('importing a module script failed') ||
    m.includes('chunkloaderror') ||
    (m.includes('module script') && m.includes('failed'))
  );
}
