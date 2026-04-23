/**
 * 一次性 migration：掃 static/cards/*.json，回填所有透過官網 list filter
 * 才能識別的 tag（古代 / 未來 / ACE SPEC × Pokemon / Trainer / Energy）。
 *
 * 來源：scripts/scrape/tag-filters.js 的 TAG_FILTERS 清單。每個 filter 獨立
 * 抓完整 ID 白名單，然後依 supertype 比對卡池補 tag。
 *
 * 原因：
 *   - 官網單張卡片頁面的 HTML 不含這些字樣（只在版型/配色上），所以 parse-card.js
 *     無法偵測，只能透過 card-search list 的 pokemonTag[] / trainersTag[] /
 *     energiesTag[] filter 回填。
 *   - 取代舊 migrate-ancient-tag.js（只抓 pokemonTag=105），本 script 涵蓋
 *     全部 8 種 filter 組合。
 *
 * 用法：
 *   node scripts/migrate-tags.js
 *
 * 安全：
 *   - 只會 append tag 到 tags[]，不覆寫既有 tag（例如太晶）。
 *   - 冪等：重跑不會產生重複。
 *   - supertype 不符的會 warn 但跳過（避免 filter 交叉污染）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAG_FILTERS, collectTaggedIds, addTag } from './scrape/tag-filters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CARDS_DIR = path.join(REPO_ROOT, 'static', 'cards');

/**
 * 訓練家寶可夢 owner 白名單（名稱 prefix 為「XX的」的寶可夢）。
 * 這些 Pokemon 在特定 Supporter/Stadium 效果中會被當作一個 group 處理
 * （例：火箭隊當家查「場上『火箭隊的』寶可夢」）。tag 化讓引擎可以用
 * tags.includes('訓練家的寶可夢') 快速識別這張是不是訓練家寶可夢，
 * 具體 owner 仍由 name prefix 推斷。
 *
 * 白名單 vs regex：官網 HTML 在新 set（SV9a/MC/SVOM/SVOD 等）會用 `<XX的>`
 * 包住，這個 `<>` 是可靠的識別訊號 — parse-card.js 用該 pattern。但 M2a 復刻
 * 版及其他較舊格式沒有 `<>`，必須靠白名單。新增 owner 時兩邊都要更新。
 */
const TRAINER_OWNERS = [
  '奇樹', '阿響', '竹蘭', '火箭隊', 'N', '莉莉艾',
  '赫普', '瑪俐', '大吾', '莉佳', '小霞', '派帕', '青木'
];
const OWNER_PREFIX_RE = new RegExp('^<?(' + TRAINER_OWNERS.join('|') + ')的[>\\s]?');
const OWNER_TAG = '訓練家的寶可夢';

async function main() {
  console.error(`[1/4] Fetching ${TAG_FILTERS.length} tag filter lists from pokemon-card.com...`);
  const mappings = [];
  for (const def of TAG_FILTERS) {
    const ids = await collectTaggedIds(def.filter, def.id);
    console.error(
      `      [${def.filter}=${def.id}] ${def.supertype}/${def.label}: ${ids.size} ids`
    );
    mappings.push({ def, ids });
  }

  console.error('[2/4] Loading static/cards/*.json...');
  const files = (await fs.readdir(CARDS_DIR))
    .filter((f) => f.endsWith('.json') && f !== 'index.json');
  console.error(`      Found ${files.length} set files.`);

  const tagCounts = {};
  let totalTagged = 0;
  let totalFilesTouched = 0;

  for (const file of files) {
    const full = path.join(CARDS_DIR, file);
    const raw = await fs.readFile(full, 'utf8');
    const cards = JSON.parse(raw);
    let changed = 0;
    for (const card of cards) {
      for (const { def, ids } of mappings) {
        if (!ids.has(String(card.id))) continue;
        if (card.supertype !== def.supertype) {
          // filter 可能橫跨多個 supertype（例：pokemonTag=105 偶爾列入少數
          // Trainer）；靠 supertype 比對擋下，log 一行方便人工追。
          console.warn(
            `  [skip-wrong-supertype] ${file} ${card.id} ${card.name} ` +
              `expected=${def.supertype} got=${card.supertype} for tag=${def.label}`
          );
          continue;
        }
        const before = card.tags?.length || 0;
        addTag(card, def.label);
        if ((card.tags?.length || 0) > before) {
          changed++;
          const key = `${def.supertype}:${def.label}`;
          tagCounts[key] = (tagCounts[key] || 0) + 1;
        }
      }
    }
    if (changed > 0) {
      await fs.writeFile(full, JSON.stringify(cards, null, 2), 'utf8');
      totalTagged += changed;
      totalFilesTouched++;
      console.error(`  [${file}] tagged ${changed} card(s)`);
    }
  }

  console.error(`[3/4] Filter-based breakdown:`);
  console.error(`      Total cards tagged: ${totalTagged} across ${totalFilesTouched} files.`);
  for (const [k, v] of Object.entries(tagCounts).sort()) {
    console.error(`        ${k}: ${v}`);
  }

  console.error(`[4/4] Applying owner-based tag "${OWNER_TAG}"...`);
  let ownerTotal = 0;
  let ownerFiles = 0;
  for (const file of files) {
    const full = path.join(CARDS_DIR, file);
    const raw = await fs.readFile(full, 'utf8');
    const cards = JSON.parse(raw);
    let changed = 0;
    for (const card of cards) {
      if (card.supertype !== 'Pokemon') continue;
      if (!OWNER_PREFIX_RE.test(card.name)) continue;
      const before = card.tags?.length || 0;
      addTag(card, OWNER_TAG);
      if ((card.tags?.length || 0) > before) changed++;
    }
    if (changed > 0) {
      await fs.writeFile(full, JSON.stringify(cards, null, 2), 'utf8');
      ownerTotal += changed;
      ownerFiles++;
      console.error(`  [${file}] tagged ${changed} owner-pokemon`);
    }
  }
  console.error(
    `      Tagged ${ownerTotal} trainer-owned Pokemon across ${ownerFiles} files.`
  );

  console.error(
    `Done. Total new tags applied: filter=${totalTagged} + owner=${ownerTotal}`
  );
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
