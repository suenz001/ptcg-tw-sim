#!/usr/bin/env node
/**
 * v2.218 — Simplification audit
 *
 * Scan src/lib/game/effects/ + effects.ts for "簡化" comments and extract
 * context (3 lines before/after) so Leon can review which simplifications
 * are still active and which were upgraded (commented "升級為...").
 *
 * Usage: node scripts/audit-simplifications.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
}
walk('src/lib/game/effects');
files.push('src/lib/game/effects.ts');

const findings = [];

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!/簡化/.test(ln)) continue;
    // skip comments that just describe history (升級為...)
    const isUpgraded = /升級為|改為(?!簡化)|已修|已升級|upgraded to|不再簡化/.test(ln);
    // surrounding context for orientation
    const ctxStart = Math.max(0, i - 5);
    const ctxEnd = Math.min(lines.length - 1, i + 3);
    const ctx = lines.slice(ctxStart, ctxEnd + 1).join('\n');
    // try to find the card name within nearby context
    const card = (ctx.match(/[一-鿿]+(?:ex|EX|V|GX|VMAX|VSTAR)?[｜|]/)?.[0] || '?').replace(/[｜|]$/, '');
    findings.push({
      file: f.replace('src/lib/game/', ''),
      line: i + 1,
      isUpgraded,
      card,
      comment: ln.trim().replace(/^[\s*\/]+/, ''),
      contextSnippet: ctx,
    });
  }
}

console.log(`找到 ${findings.length} 個 簡化 註解`);
console.log(`其中 ${findings.filter(f => f.isUpgraded).length} 個是「歷史升級紀錄」（已不簡化）`);
console.log(`剩下 ${findings.filter(f => !f.isUpgraded).length} 個是「實際還簡化中」\n`);

console.log('═══ 還在簡化的清單（需 Leon 審查）═══\n');
for (const f of findings.filter(f => !f.isUpgraded)) {
  console.log(`${f.file}:${f.line}`);
  console.log(`  卡名（推測）：${f.card}`);
  console.log(`  ${f.comment}`);
  console.log('');
}

fs.writeFileSync('/tmp/simplifications.json', JSON.stringify(findings, null, 2));
console.log(`\n（完整 ${findings.length} 條結果寫到 /tmp/simplifications.json）`);
