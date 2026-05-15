/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// v4.26 PWA service worker — SvelteKit auto-registers this on production builds.
// 使用 $service-worker 虛擬模組取得 build / files / prerendered / version。
import { build, files, prerendered, version } from '$service-worker';

// Cast self to ServiceWorkerGlobalScope so TS knows the SW APIs.
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `ptcg-tw-sim-${version}`;

// 預快取資源：
//   build      — JS/CSS bundle（hash-named，不變）
//   prerendered — 靜態頁面（首頁 / about 等）
//   files      — static/ 下的檔案（manifest, icons, cards JSON, BGM 等）
// 注意：files 包含 ~21MB 內容（cards 4MB + covers 7MB + music 10MB），第一次安裝會佔流量。
//        但用戶只下載一次，後續完全離線可用，符合 PWA 體驗。
const PRECACHE: string[] = [...build, ...files, ...prerendered];

sw.addEventListener('install', (event) => {
  async function addAll() {
    const cache = await caches.open(CACHE_NAME);
    // 用 addAll 一次 fetch 全部；任一失敗整批失敗（保證原子性）
    await cache.addAll(PRECACHE);
  }
  event.waitUntil(addAll());
  // skipWaiting：新版 SW install 完馬上 activate，不等舊版斷線
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  async function deleteOld() {
    for (const key of await caches.keys()) {
      if (key !== CACHE_NAME) await caches.delete(key);
    }
    // 馬上接管現有 client（避免新版 active 後第一次 reload 才生效）
    await sw.clients.claim();
  }
  event.waitUntil(deleteOld());
});

sw.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 跳過跨域（Firebase / Google APIs / pokemon-card.com 卡圖等）— 直接走網路
  if (url.origin !== sw.location.origin) return;

  // 跳過開發伺服器 hot reload 通道
  if (url.pathname.startsWith('/@vite') || url.pathname.startsWith('/__vite')) return;

  async function respond(): Promise<Response> {
    const cache = await caches.open(CACHE_NAME);

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
