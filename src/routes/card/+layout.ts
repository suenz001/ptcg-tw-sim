// SEO B-2 Phase 0：/card 子樹覆寫 root 的 ssr=false → 開 SSR + 預渲染，
//   建置期產出「含內容」的靜態 HTML 供搜尋引擎索引（root +layout.svelte 已 SSR-safe）。
//   卡片頁為純靜態資料、零瀏覽器 API。trailingSlash=always → 輸出 /card/{id}/index.html。
export const ssr = true;
export const prerender = true;
export const trailingSlash = 'always';
