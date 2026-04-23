#!/usr/bin/env node
/**
 * v2.71 hotfix：Leon 指出「訓練家冠名」的定義是「該訓練家有對應寶可夢」。
 *
 * 原本的 migrate-trainer-branded.mjs 對 Trainer 太寬：只要 name 開頭「XX的」
 * 就打 tag，導致像「暗碼迷的解讀」「松葉的信心」「老大的指令」「水蓮的照顧」
 * 這類只有支援者、訓練家角色沒有對應寶可夢的卡也被錯誤打 tag。
 *
 * 正確邏輯：owner 必須在「有寶可夢的訓練家」白名單（14 人）內才算冠名。
 * 這個白名單是從 static/cards 的 Pokemon 反推出來：只要該訓練家至少有一張
 * supertype=Pokemon 的「XX的」寶可夢，就算真冠名訓練家。
 *
 * 本腳本：
 *   1. 掃所有 JSON 找出「真冠名訓練家」白名單
 *   2. 對每張有 '訓練家冠名' tag 的 Trainer 卡：
 *      - 若 owner 在白名單 → 保留
 *      - 若 owner 不在白名單 → 移除 tag
 *   3. Pokemon 不動（name 本來就是 `<XX的>` 來源，都是真冠名）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.resolve(__dirname, '..', 'static', 'cards');
const TAG = '訓練家冠名';

async function main() {
  const files = (await fs.readdir(CARDS_DIR))
    .filter(f => f.endsWith('.json') && f !== 'index.json').sort();

  // Pass 1: 從所有「真寶可夢」反推 owner 白名單
  // 注意：supertype='Pokemon' && subtype='Other' 是 PokemonTool（寶可夢道具卡），
  // 不是真寶可夢，要排除（e.g.「探險家的嚮導」SV8a 12449 是 Tool，探險家因此
  // 不算冠名訓練家）。
  const owners = new Set();
  for (const f of files) {
    const cards = JSON.parse(await fs.readFile(path.join(CARDS_DIR, f), 'utf8'));
    for (const c of cards) {
      if (c.supertype !== 'Pokemon') continue;
      if (c.subtype === 'Other') continue;
      const m = (c.name || '').match(/^([^<>\s]+?)的/);
      if (m) owners.add(m[1]);
    }
  }
  console.error(`[1/2] Derived ${owners.size} real trainer-branded owners from Pokemon:`);
  console.error(`      ${[...owners].sort().join(' / ')}`);

  // Pass 2: 掃 Trainer 卡，移除 owner 不在白名單的 tag
  let trainersChecked = 0, tagsRemoved = 0, filesChanged = 0;
  const removedSamples = new Map();

  for (const f of files) {
    const full = path.join(CARDS_DIR, f);
    const cards = JSON.parse(await fs.readFile(full, 'utf8'));
    let changed = false;

    for (const c of cards) {
      if (c.supertype !== 'Trainer') continue;
      trainersChecked++;
      const tags = c.tags || [];
      const idx = tags.indexOf(TAG);
      if (idx < 0) continue;

      const m = (c.name || '').match(/^([^<>\s]+?)的/);
      const owner = m ? m[1] : '?';
      if (!owners.has(owner)) {
        tags.splice(idx, 1);
        if (tags.length === 0) delete c.tags;
        else c.tags = tags;
        tagsRemoved++;
        changed = true;
        if (!removedSamples.has(c.name)) removedSamples.set(c.name, 0);
        removedSamples.set(c.name, removedSamples.get(c.name) + 1);
      }
    }

    if (changed) {
      await fs.writeFile(full, JSON.stringify(cards, null, 2) + '\n', 'utf8');
      filesChanged++;
      console.error(`  wrote ${f}`);
    }
  }

  console.error();
  console.error(`[2/2] Removed tags from ${tagsRemoved} Trainer cards across ${filesChanged} files.`);
  console.error(`Removed name breakdown:`);
  for (const [name, count] of [...removedSamples.entries()].sort()) {
    console.error(`  ${count}× ${name}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
