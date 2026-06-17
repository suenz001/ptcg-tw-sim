import { getStdCardIds } from '$lib/server/cardIndex';

// SEO B-2 Phase 1：所有標準卡頁的 sitemap，網址一律指向正式站 .com（canonical 目標）。
export const prerender = true;

export function GET() {
  const ids = getStdCardIds();
  const urls = ids
    .map((id) => `  <url><loc>https://www.ptcg-tw-sim.com/card/${id}/</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
