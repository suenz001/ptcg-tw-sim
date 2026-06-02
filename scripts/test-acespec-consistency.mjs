#!/usr/bin/env node
/**
 * 防呆：同名卡的 ACE SPEC 標記（tags 內 'ACE SPEC'）必須跨所有印刷版一致。
 * 背景：v5.376 修正——寶可夢旋風回收機 SV6 版漏標 ACE SPEC，導致牌組驗證
 *   把它當普通 Item（4 張上限），可與其他 ACE SPEC 卡違規同放。
 *   根因是「同一張卡的不同印刷版標記不一致」。此測試掃全資料庫，
 *   只要有任何卡名「部分版本標 ACE SPEC、部分沒標」就 FAIL，
 *   防止日後新卡匯入重蹈覆轍。
 * Run: node scripts/test-acespec-consistency.mjs  (exit 0=過 / 1=有不一致)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'static/cards');
const byName = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) {
    const ace = !!(c.tags && c.tags.includes('ACE SPEC'));
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push({ file: f, id: c.id, col: c.collectorNumber, ace });
  }
}
const bad = [];
for (const [name, prints] of byName) {
  const flags = prints.map(p => p.ace);
  if (flags.some(Boolean) && !flags.every(Boolean)) bad.push({ name, prints });
}
console.log(`ACE SPEC 標記一致性：掃 ${byName.size} 種卡名`);
if (bad.length === 0) { console.log('全部一致 ✅'); process.exit(0); }
console.log(`❌ 發現 ${bad.length} 種卡名標記不一致：`);
for (const b of bad) {
  console.log('  ★', b.name);
  for (const p of b.prints) console.log(`     ${p.file} id=${p.id} col=${p.col} ${p.ace ? 'ACE' : '缺'}`);
}
process.exit(1);
