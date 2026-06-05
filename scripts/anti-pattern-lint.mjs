#!/usr/bin/env node
/**
 * 反模式 lint — 把「反覆踩到的雷」做成 CI 靜態檢查，新出現就擋。
 * Check A：closure 參數寫 `_pool`/`_aIdx`/... 但 body 又引用去底線同名 → ReferenceError。
 * Check B：基本能量用 `pokemonType === '屬性'` 比對、無卡名 fallback（基本能量 pokemonType 為 null）。
 * Run: node scripts/anti-pattern-lint.mjs  (exit 0=乾淨 / 1=有違規)
 * 見長期記憶 feedback-basic-energy-pokemontype-null / reference-discard-prize-log。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src/lib/game');
function walk(dir){const o=[];for(const e of readdirSync(dir)){const p=join(dir,e);if(statSync(p).isDirectory())o.push(...walk(p));else if(e.endsWith('.ts'))o.push(p);}return o;}
const files = walk(SRC);
const rel = (f) => f.slice(ROOT.length + 1);
const violations = [];

// ── Check A：_X 參數但 body 引用 X ───────────────────────────────
const UP = ['pool', 'aIdx', 'dIdx', 'state'];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const fnRe = /\(([^()]*)\)\s*(?:=>\s*\{|\{)/g;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    const params = m[1];
    const und = UP.filter((n) => new RegExp(`\\b_${n}\\b`).test(params) && !new RegExp(`(^|[,\\s(])${n}\\b`).test(params));
    if (und.length === 0) continue;
    let i = m.index + m[0].length - 1, depth = 0, end = -1;
    for (let j = i; j < src.length; j++){const c=src[j];if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0){end=j;break;}}}
    if (end < 0) continue;
    const body = src.slice(i + 1, end);
    for (const n of und) {
      const uses = new RegExp(`(?<![.\\w])${n}\\b(?!\\s*:)`).test(body);
      const redecl = new RegExp(`\\([^()]*\\b${n}\\b[^()]*\\)\\s*=>|function\\s+[A-Za-z0-9_]*\\s*\\([^()]*\\b${n}\\b|\\bconst\\s+${n}\\b|\\blet\\s+${n}\\b`).test(body);
      if (uses && !redecl) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push(`[A] ${rel(f)}:${line} — 參數 \`_${n}\` 但 body 引用 \`${n}\`（ReferenceError；closure 改帶 \`${n}\`）`);
      }
    }
  }
}

// ── Check B：基本能量 pokemonType 比對、無 fallback ───────────────
const TYPE_LIT = /'(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless)'/;
const SAFE = /energyMatchesType|isBasicEnergyOfType|ENERGY_NAME_TO_TYPE|name\.includes|name\.match|【|TYPE_TO_TAG/;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const norm = lines[i].replace(TYPE_LIT, 'T');
    if (!/\bpokemonType\s*(===|!==)\s*(type\b|typeFilter\b|t\b|filter\b|energyType\b|T)/.test(norm)) continue;
    const ctx = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
    if (!/supertype\s*===\s*'Energy'|\bsubtype\s*===\s*'Basic'/.test(ctx)) continue;
    if (SAFE.test(ctx)) continue;
    violations.push(`[B] ${rel(f)}:${i + 1} — 基本能量用 pokemonType 比對、無卡名 fallback（改 energyMatchesType / isBasicEnergyOfType）`);
  }
}

if (violations.length === 0) {
  console.log('反模式 lint：✅ 無違規（A: _pool ReferenceError / B: 基本能量屬性比對）');
  process.exit(0);
}
console.log(`反模式 lint：❌ 發現 ${violations.length} 處違規\n`);
for (const v of violations) console.log('  ' + v);
console.log('\n（誤報可在 scripts/anti-pattern-lint.mjs 調整 regex；真違規請修正）');
process.exit(1);
