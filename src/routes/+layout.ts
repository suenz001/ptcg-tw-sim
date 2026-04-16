// Pure client-side SPA — we use Firebase client SDK, so no SSR.
// But we DO prerender the HTML shell at build time so every route has
// a real index.html (GitHub Pages returns 200 instead of 404, and
// social previews / crawlers see actual markup).
export const ssr = false;
export const prerender = true;
