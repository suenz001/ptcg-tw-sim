#!/usr/bin/env node
/**
 * v2.71 migration：統一「訓練家冠名」卡命名 + tag。
 *
 * 背景：
 *   - 之前 scraper 對帶 `<XX的>` 包裝的卡（新 set SV9a/MC/SVOM/SVOD 等）會把
 *     `<>` 一起存進 JSON name，runtime 靠 pool.ts 載入時 strip `<>` 才讓
 *     effects.ts 用乾淨的 name 當 key。但 JSON 層級格式不統一（部分帶 `<>`、
 *     部分不帶），對新牌組製作、查資料都造成困擾。
 *   - 同時既有 tag '訓練家的寶可夢'（v2.68）只打給 Pokemon，不含訓練家卡
 *     （赫普的包包、N 的ＰＰ提升劑等），Leon 要求 /cards 檢索系統能一次
 *     篩到所有「訓練家冠名」的卡（含 Pokemon + Trainer）。
 *
 * 本腳本做的事：
 *   1. Strip `<>` 從所有 JSON 卡的 name（runtime 已 strip，這裡把 JSON 也統一）
 *   2. 重命名 tag '訓練家的寶可夢' → '訓練家冠名'
 *   3. 擴展 tag 到 Trainer supertype：name 開頭「XX的」（除了陳舊的/飄浮泡泡
 *      等形容詞性黑名單）
 *   4. Pokemon 仍用 TRAINER_OWNERS 白名單 + 原 `<>` pattern 判定
 *
 * 冪等：重跑不會重複打 tag；已 strip 的 `<>` 再跑也沒副作用。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.resolve(__dirname, '..', 'static', 'cards');

// 訓練家角色白名單（Pokemon 冠名必匹配其中之一才算訓練家寶可夢）。
// 保持與 scripts/migrate-tags.js 的 TRAINER_OWNERS 同步。
const POKEMON_OWNERS = [
  '奇樹', '阿響', '竹蘭', '火箭隊', 'N', '莉莉艾',
  '赫普', '瑪俐', '大吾', '莉佳', '小霞', '派帕', '青木'
];
const POKEMON_OWNER_RE = new RegExp('^(' + POKEMON_OWNERS.join('|') + ')的');

// Trainer 冠名：「XX的」開頭都算，但排除這些形容詞性/地形性 prefix（非訓練家）
const TRAINER_NAME_BLACKLIST = [
  /^陳舊的/,         // 陳舊的 XX 化石
  /^飄浮泡泡/,       // 飄浮泡泡 太陽的樣子（Pokemon，但有時候誤列）
];

const OLD_TAG = '訓練家的寶可夢';
const NEW_TAG = '訓練家冠名';

function isPokemonTrainerBranded(card) {
  const raw = card.name || '';
  // 1. 原 name 帶 <XX的>
  if (/^<[^<>]+的>/.test(raw)) return true;
  // 2. Strip 後名稱匹配 owner 白名單
  const stripped = raw.replace(/[<>]/g, '');
  return POKEMON_OWNER_RE.test(stripped);
}

function isTrainerCardBranded(card) {
  if (card.supertype !== 'Trainer') return false;
  const name = (card.name || '').replace(/[<>]/g, '');
  // 必須是 [XX]的 開頭（且中間不能有空白/括號）
  if (!/^[^<>\s]+的/.test(name)) return false;
  // 黑名單（形容詞性、非訓練家）
  for (const re of TRAINER_NAME_BLACKLIST) {
    if (re.test(name)) return false;
  }
  return true;
}

async function main() {
  const files = (await fs.readdir(CARDS_DIR))
    .filter(f => f.endsWith('.json') && f !== 'index.json')
    .sort();
  console.error(`Scanning ${files.length} set files in ${CARDS_DIR}`);

  let totalCards = 0;
  let stripped = 0;        // <> 被 strip 的卡數
  let tagsRenamed = 0;     // 舊 tag -> 新 tag
  let newTagsAdded = 0;    // 新加的 tag（Trainer 或未 tag 的 Pokemon）
  let filesChanged = 0;

  for (const f of files) {
    const full = path.join(CARDS_DIR, f);
    const raw = await fs.readFile(full, 'utf8');
    const cards = JSON.parse(raw);
    let changed = false;

    for (const card of cards) {
      totalCards++;
      const rawName = card.name || '';
      const hadAngle = rawName.includes('<') || rawName.includes('>');

      // Step 1: decide tag eligibility (BEFORE stripping <>)
      const eligiblePokemon = card.supertype === 'Pokemon' && isPokemonTrainerBranded(card);
      const eligibleTrainer = isTrainerCardBranded(card);
      const shouldHaveNewTag = eligiblePokemon || eligibleTrainer;

      // Step 2: strip <>
      if (hadAngle) {
        card.name = rawName.replace(/[<>]/g, '');
        // evolvesFrom 也會帶 <> (e.g., <火箭隊的> 前階)
        if (typeof card.evolvesFrom === 'string' && (card.evolvesFrom.includes('<') || card.evolvesFrom.includes('>'))) {
          card.evolvesFrom = card.evolvesFrom.replace(/[<>]/g, '');
        }
        stripped++;
        changed = true;
      }

      // Step 3: update tags
      const tags = Array.isArray(card.tags) ? [...card.tags] : [];
      const oldIdx = tags.indexOf(OLD_TAG);
      const hasNew = tags.includes(NEW_TAG);

      if (oldIdx >= 0 && !hasNew) {
        // 重命名：移除舊，加新
        tags.splice(oldIdx, 1);
        tags.push(NEW_TAG);
        tagsRenamed++;
        changed = true;
      } else if (oldIdx >= 0 && hasNew) {
        // 已有新 tag，只把舊 tag 拿掉
        tags.splice(oldIdx, 1);
        changed = true;
      }

      if (shouldHaveNewTag && !tags.includes(NEW_TAG)) {
        tags.push(NEW_TAG);
        newTagsAdded++;
        changed = true;
      }

      // 如果原本有 tags 或我們加了新 tag 才寫回 tags 欄位
      if (tags.length > 0) {
        const prev = card.tags || [];
        if (prev.length !== tags.length || prev.some((t, i) => t !== tags[i])) {
          card.tags = tags;
        }
      } else if (Array.isArray(card.tags) && card.tags.length === 0) {
        delete card.tags;
      }
    }

    if (changed) {
      await fs.writeFile(full, JSON.stringify(cards, null, 2) + '\n', 'utf8');
      filesChanged++;
      console.error(`  wrote ${f}`);
    }
  }

  console.error();
  console.error(`Total cards scanned: ${totalCards}`);
  console.error(`Names stripped of <>: ${stripped}`);
  console.error(`Tags renamed (${OLD_TAG} → ${NEW_TAG}): ${tagsRenamed}`);
  console.error(`New ${NEW_TAG} tags added (Trainer + missing Pokemon): ${newTagsAdded}`);
  console.error(`Files modified: ${filesChanged}/${files.length}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
