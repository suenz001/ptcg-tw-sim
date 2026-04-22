/**
 * 爬取官網「古代」寶可夢 tag 篩選的完整 ID 列表。
 *
 * 官網 pokemon-card.com 的 list search 有 pokemonTag[]=105（古代）/ 106（未來）
 * 這個 filter，能拿到所有被標記為「古代」的寶可夢。單張卡片頁面本身不含「古代」
 * 這個標籤字樣（只有藝術/版型上才有），所以我們只能透過這個 filter 來掃。
 *
 * 用法：
 *   import { collectAncientPokemonIds } from './ancient-tag.js';
 *   const ids = await collectAncientPokemonIds();   // Set<string>
 *
 * 用於：
 *   (a) scrape-set.js 抓完一個 set 後，把 id 屬於此集合的寶可夢加上
 *       tags: ['古代']（若已有 tags，append 不覆寫）。
 *   (b) scripts/migrate-ancient-tag.js（一次性）回填現有 static/cards/*.json。
 */

import * as cheerio from 'cheerio';

const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (PTCG-TW-Sim scraper; contact: github.com/suenz001/ptcg-tw-sim)';
// 官網 select 的 value 對應：
//   pokemonTag[]=105 → 古代（Ancient）
//   pokemonTag[]=106 → 未來（Future）
const TAG_ANCIENT = 105;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

/**
 * 走訪 pokemonTag[]=105 所有分頁，回傳所有古代寶可夢的 detail ID（字串）。
 * @param {number} delayMs 每頁請求間延遲（預設 600ms）
 * @returns {Promise<Set<string>>}
 */
export async function collectAncientPokemonIds(delayMs = 600) {
  const ids = new Set();
  let pageNo = 1;
  while (true) {
    const url = `${BASE}/tw/card-search/list/?pageNo=${pageNo}&pokemonTag%5B0%5D=${TAG_ANCIENT}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const before = ids.size;
    $('a[href*="/detail/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/detail\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    const added = ids.size - before;
    if (added === 0) break;
    const hasNext = $(`.pagination a[href*="pageNo=${pageNo + 1}"]`).length > 0;
    pageNo++;
    if (!hasNext) break;
    await sleep(delayMs);
  }
  return ids;
}

/**
 * 把 tag 加入 card 的 tags[]（若未含），不重複、不覆寫其他 tag（例：太晶）。
 */
export function addTag(card, tag) {
  if (!card.tags) card.tags = [];
  if (!card.tags.includes(tag)) card.tags.push(tag);
}
