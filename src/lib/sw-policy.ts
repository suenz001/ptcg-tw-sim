// v5.968 SW / version-skew 策略純函式（service-worker 與 +layout 共用；不依賴 SW/瀏覽器專屬 global，方便單元測試）。

const CACHE_PREFIX = 'ptcg-tw-sim-';

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
  const others = allKeys.filter((k) => k !== current);
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
