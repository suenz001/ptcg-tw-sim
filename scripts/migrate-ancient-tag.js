/**
 * 一次性 migration：掃 static/cards/*.json，把屬於「古代」tag 的寶可夢
 * 加上 tags: ['古代']。依據是官網 pokemon-card.com 的 pokemonTag[]=105 篩選
 * 回傳的 detail id 白名單。
 *
 * 原因：
 *   - 故勒頓「原生亂打」＝30×自己場上的「古代」寶可夢數量；覺醒戰鼓同樣依賴
 *     此 tag；但我們的 card JSON 目前只有太晶 tag，古代沒有被 scraper 抓到
 *     （官網單張卡片頁面的 HTML 不含「古代」字樣，只能透過 list filter 得知）。
 *   - 本 script 把 filter 回傳的 id 對應的卡片在所有 set JSON 裡統一補 tag。
 *
 * 用法：
 *   node scripts/migrate-ancient-tag.js
 *
 * 安全：
 *   - 只會 append '古代' 到 tags[]，不覆寫既有 tags（例如太晶）。
 *   - 冪等：重跑不會產生重複。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAncientPokemonIds, addTag } from './scrape/ancient-tag.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CARDS_DIR = path.join(REPO_ROOT, 'static', 'cards');

async function main() {
  console.error('[1/3] Fetching ancient Pokemon IDs from pokemon-card.com...');
  const ancientIds = await collectAncientPokemonIds();
  console.error(`      Collected ${ancientIds.size} ancient Pokemon IDs.`);

  console.error('[2/3] Loading static/cards/*.json...');
  const files = (await fs.readdir(CARDS_DIR))
    .filter((f) => f.endsWith('.json') && f !== 'index.json');
  console.error(`      Found ${files.length} set files.`);

  let totalTagged = 0;
  let totalFilesTouched = 0;

  for (const file of files) {
    const full = path.join(CARDS_DIR, file);
    const raw = await fs.readFile(full, 'utf8');
    const cards = JSON.parse(raw);
    let changed = 0;
    for (const card of cards) {
      if (ancientIds.has(String(card.id))) {
        if (card.supertype !== 'Pokemon') {
          console.warn(`  [skip-non-pokemon] ${file} ${card.id} ${card.name} (${card.supertype})`);
          continue;
        }
        const before = card.tags?.length || 0;
        addTag(card, '古代');
        const after = card.tags.length;
        if (after > before) changed++;
      }
    }
    if (changed > 0) {
      await fs.writeFile(full, JSON.stringify(cards, null, 2), 'utf8');
      totalTagged += changed;
      totalFilesTouched++;
      console.error(`  [${file}] tagged ${changed} ancient Pokemon`);
    }
  }

  console.error(`[3/3] Done. Tagged ${totalTagged} Pokemon across ${totalFilesTouched} set files.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
