import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const targets = JSON.parse(fs.readFileSync('/tmp/hij_targets.json', 'utf8'));

// Collect all impl source files
const implFiles = [
  'src/lib/game/effects.ts',
  'src/lib/game/engine.ts',
  ...fs.readdirSync('src/lib/game/effects/cards').map(f => `src/lib/game/effects/cards/${f}`),
];

// Read all source content into one big string for fast scanning
const src = implFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n\n----FILE----\n\n');

const results = [];
for (const t of targets) {
  // Look for either a `reg('NAME'`-style call or a TOOL_*/SPECIAL_ENERGY_*/PASSIVE_/STATIC_*.set('NAME' or includes('NAME')
  // v2.199：strip 卡名前後的 ZWNJ (U+200C) 與 angle brackets — pool.ts:51 已在 runtime
  // 統一移除這些字元，effects.ts 用「乾淨」名 register，audit 比對也要先 strip 才能 match。
  const n = t.name.replace(/[‌<>＜＞]/g, '');
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Patterns suggesting actual implementation:
  const patterns = [
    new RegExp(`reg(?:R|G|A|Pre|Post)?\\s*\\(\\s*['"\`]${escaped}['"\`]`),
    new RegExp(`\\.set\\s*\\(\\s*['"\`]${escaped}['"\`]`),     // TOOL_*.set('NAME', ...)
    new RegExp(`name\\s*===\\s*['"\`]${escaped}['"\`]`),       // === 'NAME'
    new RegExp(`name\\s*\\?\\.\\s*startsWith\\s*\\(\\s*['"\`]${escaped}['"\`]`),
    new RegExp(`'${escaped}'`),                                 // bare string literal in any list
    new RegExp(`"${escaped}"`),
  ];
  let matched = false;
  let evidence = '';
  for (const p of patterns) {
    if (p.test(src)) { matched = true; evidence = p.source; break; }
  }
  results.push({ ...t, implemented: matched, evidence });
}

const yes = results.filter(r => r.implemented).length;
const no = results.length - yes;
console.log(`Implemented (raw match): ${yes}/${results.length}, missing: ${no}`);

// Group missing by subtype
const missingBySub = {};
for (const r of results.filter(r => !r.implemented)) {
  const k = r.subtype;
  if (!missingBySub[k]) missingBySub[k] = [];
  missingBySub[k].push(r.name);
}
console.log('Missing by subtype:');
for (const k of Object.keys(missingBySub).sort()) {
  console.log(`  ${k}: ${missingBySub[k].length}`);
}

fs.writeFileSync('/tmp/hij_audit.json', JSON.stringify(results, null, 2));
