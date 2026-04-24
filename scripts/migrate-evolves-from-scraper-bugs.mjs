#!/usr/bin/env node
/**
 * v2.99 一次性 migration：修正 scraper evolvesFrom bug。
 *
 * 背景：Leon 在 v2.99 session 發現 scraper 對 9 張進化卡的 evolvesFrom 抓錯 —
 * 有兩種 pattern：
 *   A. target 階數 ≥ 自己（違反 Basic→Stage1→Stage2 的階層）
 *   B. ex 跟同名非 ex 的 evolvesFrom 不一致（違反 feedback_evolution_ex_same_stage 原則）
 *
 * Leon 手動提供正確進化鏈（2026-04-24）：
 *   賽富豪 從 索財靈 進化
 *   君主蛇 從 青藤蛇 進化
 *   電肚蛙 從 光蚪仔 進化
 *   阿羅拉 椰蛋樹ex 從 蛋蛋 進化
 *   櫻花魚 從 珍珠貝 進化
 *   來悲粗茶 從 斯魔茶 進化
 *   蜜集大蛇 從 裹蜜蟲 進化
 *   超級雪妖女ex 從 雪童子 進化
 *   冰鬼護 從 雪童子 進化
 *
 * 本腳本掃全卡池，對 name 符合上述清單的每張卡（可能跨多個 set 版本）更新
 * evolvesFrom 為正確值。若 evolvesFrom 已正確則跳過。
 *
 * 使用：node scripts/migrate-evolves-from-scraper-bugs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CARDS_DIR = 'static/cards';

// Leon 2026-04-24 手動確認的正確 evolvesFrom 對應表
const FIX = new Map([
  ['賽富豪', '索財靈'],
  ['君主蛇', '青藤蛇'],
  ['電肚蛙', '光蚪仔'],
  ['阿羅拉 椰蛋樹ex', '蛋蛋'],
  ['櫻花魚', '珍珠貝'],
  ['來悲粗茶', '斯魔茶'],
  ['蜜集大蛇', '裹蜜蟲'],
  ['超級雪妖女ex', '雪童子'],
  ['冰鬼護', '雪童子'],
]);

const files = fs.readdirSync(CARDS_DIR)
  .filter(f => f.endsWith('.json') && f !== 'index.json');

let totalFixed = 0;
const log = [];

for (const f of files) {
  const fullPath = path.join(CARDS_DIR, f);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const arr = JSON.parse(raw);
  let changed = false;

  for (const card of arr) {
    if (!FIX.has(card.name)) continue;
    const expected = FIX.get(card.name);
    if (card.evolvesFrom === expected) continue;
    log.push(`  ${card.setCode || f.replace('.json','')} ${card.collectorNumber || '?'} ${card.name}: "${card.evolvesFrom || '(無)'}" → "${expected}"`);
    card.evolvesFrom = expected;
    totalFixed++;
    changed = true;
  }

  if (changed) {
    const hasTrailingNewline = raw.endsWith('\n');
    fs.writeFileSync(fullPath, JSON.stringify(arr, null, 2) + (hasTrailingNewline ? '\n' : ''), 'utf8');
  }
}

console.log(`═══ evolvesFrom 修正 ═══`);
console.log(`共修正 ${totalFixed} 張卡 entry：`);
for (const line of log) console.log(line);
