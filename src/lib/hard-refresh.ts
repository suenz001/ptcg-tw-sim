/**
 * v6.160 強制更新（清快取）—— **全站唯一一份實作**。
 *
 * 原本這段只寫在首頁 `src/routes/+page.svelte` 的 `hardRefresh()` 裡（v5.197 起）。
 * v6.160 錦標賽報到也要用同一套動作，所以抽到這裡；首頁與報到視窗都呼叫這支，
 * **不另外寫第二份**（兩份清快取邏輯漂移的代價是：其中一份悄悄失效而沒人發現）。
 *
 * 動作（順序有意義）：
 *   ① 卸載所有 Service Worker —— 這是最關鍵的一步。
 *      `/tournament` 是 `prerender = true` ⇒ 它在 SW 的 `PRECACHE` 名單裡 ⇒ SW 對它是
 *      **cache-first**。SW 不卸掉的話，重載也只是再吃一次它自己快取的舊 HTML。
 *   ② 清空 Cache API 的所有 cache。
 *   ③ 帶 `_v=<timestamp>` 重載，bypass 瀏覽器 HTTP 快取。
 *
 * ⚠ v5.909 的教訓：①②在某些瀏覽器／PWA 狀態下會「既不 resolve 也不 reject」永遠卡住，
 *   try/catch 只擋 error 不擋 hang ⇒ 後面的 reload 永不執行 ⇒ 按鈕一直停在「更新中…」。
 *   所以清快取包 `Promise.race` + 2.5 秒逾時保險：無論完成或卡住都一定會重載。
 *
 * ⚠ **不清** localStorage / IndexedDB ⇒ 牌組與帳號資料保留。
 *
 * ⚠⚠ CDN 層的已知限制（v6.160 實測 www.ptcg-tw-sim.com）：
 *   `/` `/game` `/tournament` 的 HTML 是 `cf-cache-status: DYNAMIC`（Cloudflare **不**快取）
 *   ⇒ 重載一定拿得到最新 HTML，這支函式**是有效的**。
 *   但 `/service-worker.js` 是 `cf-cache-status: HIT`、`max-age=14400`（邊緣快取 4 小時）
 *   ⇒ 重載後重新註冊到的 SW 腳本可能是最多 4 小時前那一版 build 的。
 *   對「這一次要拿到新版」沒有影響（SW 已卸載、HTML 走網路、chunk 是新 hash），
 *   但那份舊 SW 之後仍會以 cache-first 服務 `/tournament`，是玩家日後再度變舊的來路。
 *   根治要在 Cloudflare 對 `/service-worker.js` 設 bypass cache 的 Cache Rule（站長端操作）。
 */
export async function hardRefreshNow(): Promise<void> {
  const cleanup = (async () => {
    try {
      // ① 卸載所有 Service Worker
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
      }
      // ② 清空 Cache API 所有 caches
      if (typeof window !== 'undefined' && 'caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
      }
    } catch (e) {
      console.warn('[hardRefresh] cleanup error:', e);
    }
  })();
  await Promise.race([cleanup, new Promise<void>((res) => setTimeout(res, 2500))]);
  // ③ 加 timestamp query 強制 fresh HTML（同時也是「剛更新過」的訊號，見 recentlyHardRefreshed）
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', String(Date.now()));
    window.location.replace(url.toString());
  }
}
