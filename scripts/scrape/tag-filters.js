/**
 * 爬取官網 card-search list 的 tag filter 結果，取得各 tag 的卡片 ID 白名單。
 *
 * 官網有三組 filter（pokemonTag[] / trainersTag[] / energiesTag[]），每組都支援
 * 古代(105) / 未來(106) / ACE SPEC(104) 等 tag。trainer filter 裡的 subtype
 * 分類（物品/支援者/競技場/道具 = 1/2/3/18）以及劍盾期的一擊/連擊/匯流 (20/21/22)
 * 不在這裡處理（subtype 靠 h3，劍盾卡我們資料集沒有）。
 *
 * 關鍵：單張卡片頁面的 HTML「不含」古代/未來/ACE SPEC 這些字樣（只體現在版型/
 * 配色等藝術設計上），所以這層 tag 只能透過 list filter 回填。
 *
 * v2.48 太晶 tag 可從單張頁面解析（在 .skillInformation .skill 區塊內），
 * 不需要走這個 filter — 那屬於 parse-card.js 的範圍。
 *
 * 用法：
 *   import { collectTaggedIds, TAG_FILTERS, addTag } from './tag-filters.js';
 *   const idsByTag = await collectAllTaggedIds();
 *   // idsByTag.get('pokemon:古代') => Set of id strings
 *
 * 用於：
 *   (a) scrape-set.js：抓完一個 set 後，對該 set 的 cards 按 supertype+tag 比對
 *       ID 白名單，把 tags[] 補上。
 *   (b) scripts/migrate-tags.js：一次性回填所有 static/cards/*.json。
 */

import * as cheerio from 'cheerio';

const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (PTCG-TW-Sim scraper; contact: github.com/suenz001/ptcg-tw-sim)';

/**
 * 我們關心的 tag 清單。每筆 { filter, id, label, supertype }：
 *   - filter: 官網 query string 的 filter 名（pokemonTag / trainersTag / energiesTag）
 *   - id:     官網 filter 的 value（105 古代、106 未來、104 ACE SPEC）
 *   - label:  寫到 card.tags[] 的中文 tag 字串（顯示給玩家、引擎查 tags.includes）
 *   - supertype: 期待的 Card.supertype，用來在 migration 階段做 sanity check，
 *                避免 filter 結果意外串到錯的 supertype（早期 v2.67 發現 trainer
 *                被列入 pokemonTag=105 結果 → 那類案例用 supertype 比對擋掉）。
 */
export const TAG_FILTERS = [
  { filter: 'pokemonTag',  id: 105, label: '古代',    supertype: 'Pokemon' },
  { filter: 'pokemonTag',  id: 106, label: '未來',    supertype: 'Pokemon' },
  { filter: 'trainersTag', id: 104, label: 'ACE SPEC', supertype: 'Trainer' },
  { filter: 'trainersTag', id: 105, label: '古代',    supertype: 'Trainer' },
  { filter: 'trainersTag', id: 106, label: '未來',    supertype: 'Trainer' },
  { filter: 'energiesTag', id: 104, label: 'ACE SPEC', supertype: 'Energy'  },
  { filter: 'energiesTag', id: 105, label: '古代',    supertype: 'Energy'  },
  { filter: 'energiesTag', id: 106, label: '未來',    supertype: 'Energy'  }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

/**
 * 走訪某個 tag filter 的所有分頁，回傳所有命中卡片的 detail ID（字串）。
 * @param {string} filter 'pokemonTag' | 'trainersTag' | 'energiesTag'
 * @param {number} id 官網 filter 的 value
 * @param {number} delayMs 每頁請求間延遲（預設 600ms）
 * @returns {Promise<Set<string>>}
 */
export async function collectTaggedIds(filter, id, delayMs = 600) {
  const ids = new Set();
  let pageNo = 1;
  while (true) {
    const url = `${BASE}/tw/card-search/list/?pageNo=${pageNo}&${filter}%5B0%5D=${id}`;
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
 * 抓 TAG_FILTERS 裡所有 filter 的結果。
 * 回傳 Map<tagKey, {ids: Set<string>, def: TagFilterDef}>，其中
 * tagKey = `${supertype}:${label}`（例：'Pokemon:古代' / 'Trainer:ACE SPEC'）。
 * 兩個 supertype 都有 '古代'，但它們是獨立的 filter，所以鍵用 supertype:label 區分。
 *
 * @param {number} delayMs 每個 filter、每個分頁之間的延遲
 */
export async function collectAllTaggedIds(delayMs = 600) {
  const out = new Map();
  for (const def of TAG_FILTERS) {
    const ids = await collectTaggedIds(def.filter, def.id, delayMs);
    out.set(`${def.supertype}:${def.label}`, { ids, def });
    await sleep(delayMs);
  }
  return out;
}

/**
 * 為了回溯相容，保留 collectAncientPokemonIds 名稱（ancient-tag.js 的舊 API）。
 * scrape-set.js v2.67 之前用的是這個，新程式碼應該用 collectTaggedIds 或
 * collectAllTaggedIds。
 * @deprecated Use collectTaggedIds('pokemonTag', 105, delayMs) instead.
 */
export async function collectAncientPokemonIds(delayMs = 600) {
  return collectTaggedIds('pokemonTag', 105, delayMs);
}

/**
 * 把 tag 加入 card.tags[]（若未含），不重複、不覆寫其他 tag（例：太晶 / 古代）。
 */
export function addTag(card, tag) {
  if (!card.tags) card.tags = [];
  if (!card.tags.includes(tag)) card.tags.push(tag);
}
