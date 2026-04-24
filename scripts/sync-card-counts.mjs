#!/usr/bin/env node
/**
 * v2.98：partial update of `static/cards/index.json` —
 *   只同步 `cardCount` / `count` / `supertypeCounts` 三個欄位。
 *   其他欄位（name / releaseDate / coverImageUrl / regulationMark / scrapedAt…）
 *   原封保留。
 *
 * 用途：migration 或手動編輯 static/cards/*.json 後，讓 /cards 首頁顯示的卡包
 *   張數（`x 個卡包 · 共 N 張卡`）與實際 JSON 內容一致。
 *
 * 設計動機：
 *   `scripts/build-sets-index.js` 會整個**重建** index.json，但它的 hardcoded
 *   欄位清單不包含 releaseDate，會把 v2.30 加的發售日期砍掉。這隻腳本只做
 *   增量更新 — 安全可反覆執行。
 *
 * 用法：node scripts/sync-card-counts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CARDS_DIR = 'static/cards';
const INDEX_PATH = path.join(CARDS_DIR, 'index.json');

const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));

let changed = 0;
let total = 0;
for (const s of idx) {
  const file = path.join(CARDS_DIR, `${s.code}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`  [warn] ${s.code}.json not found — 跳過`);
    continue;
  }
  const cards = JSON.parse(fs.readFileSync(file, 'utf8'));
  const actual = cards.length;
  total += actual;

  const counts = {};
  for (const c of cards) {
    const k = c.supertype || 'Unknown';
    counts[k] = (counts[k] || 0) + 1;
  }

  const before = { cardCount: s.cardCount, count: s.count };
  s.cardCount = actual;
  s.count = actual; // legacy mirror
  s.supertypeCounts = counts;

  if (before.cardCount !== actual) {
    console.log(`  ${s.code.padEnd(7)} ${String(before.cardCount ?? '-').padStart(4)} → ${String(actual).padStart(4)}`);
    changed++;
  }
}

fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2) + '\n', 'utf8');
console.log(`\n${changed} 個卡包 cardCount 已更新；全卡池共 ${total} 張卡。`);
