/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// v4.26 PWA service worker — SvelteKit auto-registers this on production builds.
// 使用 $service-worker 虛擬模組取得 build / files / prerendered / version。
import { build, files, prerendered, version } from '$service-worker';
import { cachesToDelete } from '$lib/sw-policy';
import { resolveClickUrl } from '$lib/notify-core'; // v6.022 通知點擊導頁(base path 由 scope 推)

// Cast self to ServiceWorkerGlobalScope so TS knows the SW APIs.
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `ptcg-tw-sim-${version}`;

// 預快取資源：
//   build      — JS/CSS bundle（hash-named，不變）
//   prerendered — 靜態頁面（首頁 / about 等）
//   files      — static/ 下的檔案（manifest, icons, cards JSON, BGM 等）
// v5.365：封面(covers ~7MB) / 音樂(music ~10MB) 從「安裝時預快取」拿掉，改成「用到才快取」
//   （fetch handler 的 network-first 會在首次 fetch 時自動寫入快取）。原本安裝要一次抓 ~21MB，
//   會跟前景「載入卡池」搶頻寬、拖慢首次載入（玩家回報卡『載入卡池中』~30 秒）。改後安裝只預快取
//   app 本體 + 卡牌(~4MB 內)，安裝輕量、不搶頻寬；封面/音樂第一次用到時才下載並快取。
// v6.100：changelog-archive.html（完整更新歷史，~174KB）只有玩家點「查看完整更新歷史」時才需要，
//   不該在每位訪客安裝 SW／每次版本更新時就背景預抓 —— 那會抵銷本版把首頁 changelog
//   從 173KB 降到 34KB 的用意。改成「用到才快取」（與 covers／music 同一條路）。
const HEAVY_MEDIA = (u: string) => u.includes('/covers/') || u.includes('/music/') || u.includes('changelog-archive');
// v5.966：/card/ 子樹是 SEO 預渲染頁（3,839 張卡片頁，build/card ~73MB、近 8000 個請求）。
//   之前把整包 prerendered（含全部 /card/ 頁）丟進「安裝時預快取」→ 首次進站 SW install 要一次抓 ~73MB，
//   與前景 app bundle / Firestore 搶頻寬 → 手機白屏很久；且 CACHE_NAME 含 version，幾乎每日出版都讓回訪
//   使用者重抓整包（GitHub Pages max-age=600 幫不上忙）。這些卡片頁改走 fetch handler 的 network-first
//   （用到才快取），SEO 爬蟲也是直接抓、不需預快取。install 從 ~82MB 降到 ~9MB。
const IS_CARD_PAGE = (u: string) => u.includes('/card/');
const PRECACHE: string[] = [...build, ...files.filter(f => !HEAVY_MEDIA(f)), ...prerendered.filter(p => !IS_CARD_PAGE(p))];

sw.addEventListener('install', (event) => {
  async function addAll() {
    const cache = await caches.open(CACHE_NAME);
    // v5.354：逐一容錯快取（取代 cache.addAll 的原子性）。
    //   原 addAll 任一 URL fetch 失敗 → 整個 install 失敗 → 新版 SW 永遠裝不起來，
    //   使用者卡在舊版快取（玩家回報「修了好幾版卻沒生效」的真因：/cards/ 被 nginx 轉成
    //   http 觸發混合內容封鎖 → addAll reject → 站台釘死在舊版 v5.347）。
    //   改 Promise.allSettled + 個別 cache.add：個別檔失敗只略過該檔，不阻斷整體更新。
    //   app 本體（build/prerendered，皆 https）一定快取成功；卡牌等 runtime 仍走 network-first。
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
  }
  event.waitUntil(addAll());
  // skipWaiting：新版 SW install 完馬上 activate，不等舊版斷線
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  async function deleteOld() {
    // v5.968 version-skew：保留現行版 + 最近一個舊版 cache（不再全刪），讓開著舊 HTML 的分頁
    //   lazy import 舊 hash chunk 仍能命中舊 cache，不會 404 白屏。
    const keys = await caches.keys();
    for (const key of cachesToDelete(keys, CACHE_NAME)) await caches.delete(key);
    // 馬上接管現有 client（避免新版 active 後第一次 reload 才生效）
    await sw.clients.claim();
  }
  event.waitUntil(deleteOld());
});

sw.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // v6.130 音樂完全繞過 SW（不 respondWith → 走瀏覽器原生 fetch + HTTP cache + Range）。
  //   ⚠ 理由不是省空間，是 CACHE_NAME 含 version、activate 只保留現行版+前一版 → 本站幾乎日更，
  //     音樂若走「用到才快取」，每次出版快取就蒸發，常聽的玩家會反覆重抓 5.5MB。
  //     原生 HTTP cache 跨 SW 版本存活，之後都是 304 revalidate。
  //   ⚠ 另一層：媒體元素首個請求通常帶 Range → GitHub Pages 回 206，而 cache.put() 對 206 會 reject
  //     （現行 `status === 200` gate 剛好擋掉，不會炸，但也代表音樂其實從沒被快取成功）；
  //     且 cache.match() 預設無視 Range、會把整包 200 回給帶 Range 的請求，Safari 媒體管線可能播不動。
  //     早退後這兩條路徑都不存在。代價：音樂不支援離線播放（可接受）。
  if (event.request.url.includes('/music/')) return;

  const url = new URL(event.request.url);

  // 跳過跨域（Firebase / Google APIs / pokemon-card.com 卡圖等）— 直接走網路
  if (url.origin !== sw.location.origin) return;

  // 跳過開發伺服器 hot reload 通道
  if (url.pathname.startsWith('/@vite') || url.pathname.startsWith('/__vite')) return;

  async function respond(): Promise<Response> {
    const cache = await caches.open(CACHE_NAME);

    // v5.968 version-skew：hash 命名不可變資源(/_app/immutable/)先跨「全部」cache 查詢(含保留的前一版)，
    //   命中即回 → 開著舊 HTML 的分頁載入舊 chunk 不會因新版已 activate 刪掉當前版沒有的舊 hash 而 404。
    if (url.pathname.includes('/immutable/')) {
      const anyCached = await caches.match(event.request);
      if (anyCached) return anyCached;
    }

    // build/files/prerendered 走 cache-first（資源不變、最快）
    if (PRECACHE.includes(url.pathname)) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }

    // 其他同源：network-first，網路失敗才回 cache
    try {
      const response = await fetch(event.request);
      // 成功才寫 cache（避免快取 4xx/5xx）
      if (response.status === 200) {
        try {
          await cache.put(event.request, response.clone());
        } catch {
          // cache.put 可能因 storage quota 等失敗，忽略不阻塞 response
        }
      }
      return response;
    } catch {
      // 離線：回 cache 命中（若有）
      const cached = await cache.match(event.request);
      if (cached) return cached;
      // SPA fallback：navigation 請求回首頁 prerendered HTML
      if (event.request.mode === 'navigate') {
        const indexCached = await cache.match('/');
        if (indexCached) return indexCached;
      }
      throw new Error('offline and not cached: ' + url.pathname);
    }
  }

  event.respondWith(respond());
});

// v6.023 階段2 Web Push：伺服器推播進來（分頁關閉／iOS 凍結時的唯一途徑）。
//   payload 由後端 sendPushToUids 送出：{ title, body, tag, requireInteraction }。
//   ⚠userVisibleOnly 訂閱下**必須**顯示通知，否則瀏覽器會警告甚至撤銷訂閱 → 解析失敗也給預設文案。
sw.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; tag?: string; requireInteraction?: boolean } = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* 非 JSON → 用預設 */ }
  const title = data.title || '🔔 錦標賽通知';
  const icon = new URL('icons/icon-192.png', sw.registration.scope.endsWith('/') ? sw.registration.scope : sw.registration.scope + '/').href;
  event.waitUntil(sw.registration.showNotification(title, {
    body: data.body || '請回到賽事頁查看。',
    tag: data.tag || 'ptcg-t-push',
    icon,
    requireInteraction: data.requireInteraction === true,
  }));
});

// 訂閱過期／被瀏覽器輪替時自動重訂（否則玩家會悄悄收不到推播）。
//   ⚠此處拿不到使用者身分（無法呼叫需驗證的 subscribe 端點），僅重新向瀏覽器訂閱；
//   真正的「送新訂閱到伺服器」由前端下次開啟頁面時的 subscribePush() 補上（它會 upsert）。
sw.addEventListener('pushsubscriptionchange', (event) => {
  const ev = event as ExtendableEvent & { oldSubscription?: PushSubscription };
  ev.waitUntil((async () => {
    try {
      const old = ev.oldSubscription;
      const key = old && (old.options as { applicationServerKey?: ArrayBuffer } | undefined)?.applicationServerKey;
      if (key) await sw.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch { /* 下次開頁由前端重訂 */ }
  })());
});

// v6.022 錦標賽通知：點擊通知 → 聚焦既有分頁並用 SPA 導頁（不整頁 reload，避免重載整個 app 資源）。
//   ⚠與 precache / cachesToDelete / version-skew 完全正交：不碰任何 cache 邏輯。
sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = resolveClickUrl(sw.registration.scope);
  event.waitUntil((async () => {
    const cs = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = cs.find((c) => c.url.startsWith(sw.registration.scope)) ?? cs[0];
    if (target) {
      try { await target.focus(); } catch { /* 部分平台 focus 受限，仍送導頁訊息 */ }
      target.postMessage({ type: 'ptcg-notify-nav', url });
    } else {
      await sw.clients.openWindow(url);
    }
  })());
});
