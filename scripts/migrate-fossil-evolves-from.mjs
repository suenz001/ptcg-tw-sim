#!/usr/bin/env node
/**
 * v2.188 migration：補 5 條化石進化鏈 Stage1 寶可夢的 evolvesFrom。
 *
 * 背景：scraper 從官網的 .evolution block 抓 evolvesFrom，但化石卡（陳舊的XX
 * 化石）是 Trainer/Item 卡，**不會出現在 .evolution block** 裡。所以 Stage1
 * 寶可夢（從化石進化）找不到「前一個 entry」，evolvesFrom 全部漏寫。
 *
 * 5 條化石進化鏈（Leon 2026-04-27 確認）：
 *   陳舊的背蓋化石 → 原蓋海龜 → 肋骨海龜
 *   陳舊的顎之化石 → 寶寶暴龍 → 怪顎龍
 *   陳舊的鰭之化石 → 冰雪龍 → 冰雪巨龍
 *   陳舊的羽毛化石 → 始祖小鳥 → 始祖大鳥
 *   陳舊的根狀化石 → 觸手百合 → 搖籃百合
 *
 * Stage2 → Stage1 的 evolvesFrom 全都正確（怪顎龍 → 寶寶暴龍 等）；只缺
 * Stage1 → 化石。
 *
 * 本腳本可重跑（idempotent）。重爬後若 scraper 仍未修，跑這個 migration 即可。
 *
 * 使用：node scripts/migrate-fossil-evolves-from.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CARDS_DIR = 'static/cards';

// Stage1 寶可夢名 → 對應化石（即正確 evolvesFrom）
const FOSSIL_STAGE1 = new Map([
  ['原蓋海龜', '陳舊的背蓋化石'],
  ['寶寶暴龍', '陳舊的顎之化石'],
  ['冰雪龍', '陳舊的鰭之化石'],
  ['始祖小鳥', '陳舊的羽毛化石'],
  ['觸手百合', '陳舊的根狀化石'],
]);

const files = fs.readdirSync(CARDS_DIR).filter(f => f.endsWith('.json'));
let totalPatched = 0;

for (const f of files) {
  const fp = path.join(CARDS_DIR, f);
  const arr = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  let changed = false;
  for (const c of arr) {
    if (c.supertype !== 'Pokemon') continue;
    const want = FOSSIL_STAGE1.get(c.name);
    if (!want) continue;
    if (c.evolvesFrom === want) continue; // 已正確
    const old = c.evolvesFrom ?? '(無)';
    c.evolvesFrom = want;
    console.log(`  ${f} id=${c.id} (${c.name} ${c.setCode} ${c.collectorNumber}): evolvesFrom ${old} → ${want}`);
    changed = true;
    totalPatched++;
  }
  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(arr, null, 2) + '\n', 'utf-8');
  }
}
console.log(`\nTotal patched: ${totalPatched} cards`);
console.log(totalPatched === 0 ? '✓ 已是最新狀態' : '✓ 化石進化鏈 Stage1 evolvesFrom 補完');
