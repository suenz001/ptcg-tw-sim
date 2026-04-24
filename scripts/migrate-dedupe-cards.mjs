#!/usr/bin/env node
/**
 * v2.105 一次性 migration：清理 static/cards/*.json 每個 set 內同 collectorNumber
 * 重複的 entries（兩張完全同名同 cn 但兩個 id — scraper 前後抓兩次產生）。
 *
 * 策略：對每組 duplicate，保留「最高分」者：
 *   1. 被 preset 引用的 id（src/lib/decks/presets.ts）→ +1,000,000,000 分
 *   2. scrapedAt 較新（timestamp 秒數）
 *   3. tie 則保留 id 較大的（後爬的）
 *
 * v2.105 跑時 307 個重複 entries 全部可安全刪除（0 個被 preset 引用）。
 *
 * 受影響 sets：M-P(3)、SV11B(80)、SV11W(80)、SV8a(144)。
 *
 * 跑完需 `node scripts/sync-card-counts.mjs` 同步 index.json 的 cardCount。
 *
 * 用法：node scripts/migrate-dedupe-cards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CARDS_DIR = 'static/cards';

// 掃 presets 用到的 cardId 做安全保護
const presetsSrc = fs.readFileSync('src/lib/decks/presets.ts', 'utf8');
const usedIds = new Set([...presetsSrc.matchAll(/cardId:\s*'(\d+)'/g)].map(m => m[1]));

function score(c) {
  let s = 0;
  if (usedIds.has(c.id)) s += 1_000_000_000;
  s += c.scrapedAt ? new Date(c.scrapedAt).getTime() / 1000 : 0;
  s += parseInt(c.id) || 0;
  return s;
}

const files = fs.readdirSync(CARDS_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
let totalDrop = 0;
const perFile = [];

for (const f of files) {
  const fullPath = path.join(CARDS_DIR, f);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const arr = JSON.parse(raw);
  // group by collectorNumber
  const byCn = new Map();
  for (const c of arr) {
    if (!byCn.has(c.collectorNumber)) byCn.set(c.collectorNumber, []);
    byCn.get(c.collectorNumber).push(c);
  }
  const dropIds = new Set();
  let dropCount = 0;
  for (const [cn, group] of byCn) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => score(b) - score(a));
    const keep = sorted[0];
    // drop the rest — safety: if any is used in preset, keep that one instead
    for (const d of sorted.slice(1)) {
      if (usedIds.has(d.id)) {
        console.warn(`  [skip] ${f} cn=${cn} id=${d.id} 被 preset 引用（但排序把 ${keep.id} 放第一） — 為安全不刪除`);
        continue;
      }
      dropIds.add(d.id);
      dropCount++;
    }
  }
  if (dropIds.size === 0) continue;
  const kept = arr.filter(c => !dropIds.has(c.id));
  const hasTrailingNewline = raw.endsWith('\n');
  fs.writeFileSync(fullPath, JSON.stringify(kept, null, 2) + (hasTrailingNewline ? '\n' : ''), 'utf8');
  totalDrop += dropCount;
  perFile.push({ file: f, before: arr.length, after: kept.length, drop: dropCount });
}

console.log('═══ Dedupe 完成 ═══');
console.log(`共 drop ${totalDrop} 個重複 entries`);
for (const p of perFile) {
  console.log(`  ${p.file.padEnd(12)} ${p.before} → ${p.after} (-${p.drop})`);
}
console.log('\n記得跑：node scripts/sync-card-counts.mjs 同步 index.json');
