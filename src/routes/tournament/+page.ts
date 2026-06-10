// 隱藏路由 /tournament（1 層深度，與 /game 同層）→ 預渲染產生 /tournament 的 HTML。
// 即使走 404.html fallback，1 層相對的 _app/ 資源路徑也能正確解析，不會空白頁。
// （原 2 層 /game/tournament 的 fallback 會把 _app/ 指到 /game/_app/ → 404 → 空白頁。）
// ssr=false：純客戶端，預渲染只輸出 HTML 殼(不跑 onMount/載卡池)，安全。
export const prerender = true;
export const ssr = false;
