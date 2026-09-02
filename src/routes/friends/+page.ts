// v6.283 好友頁 /friends：純客戶端路由（與 /decks、/deck-posts 同一套）。
//   prerender=true 只輸出 HTML 殼（不跑 onMount、不發任何請求），ssr=false 才不會在建置期碰 Firebase。
//   ⚠ 1 層深度（與 /game 同層）：走 404.html fallback 時 _app/ 相對路徑才解析得到（同 /tournament 的教訓）。
export const prerender = true;
export const ssr = false;
