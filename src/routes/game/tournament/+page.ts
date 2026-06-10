// 強制預渲染此隱藏路由 → build 產生 /game/tournament/index.html(2 層深度正確的相對資源路徑)，
// 避免走 404.html fallback(1 層相對路徑)導致 2 層路由的 _app/ 資源指錯 → 空白頁。
// ssr=false：純客戶端，預渲染只輸出 HTML 殼(不跑 onMount/載卡池)，安全。
export const prerender = true;
export const ssr = false;
