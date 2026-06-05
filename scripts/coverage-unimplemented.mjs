#!/usr/bin/env node
/**
 * 未實裝／靜默失效卡牌 coverage 檢查（資訊性，預設非 gating）。
 *
 * 原理：引擎結算招式用 `卡名|招式名` 去 ATTACK_PRE / ATTACK_POST / ATTACK_PRE_DISCARD_CHOICE
 *   查 handler（engine.ts:4166/5633），**無 fallback**；另有招式名層級 BENCH_FILL_ATTACK_NAMES。
 *   若卡牌 JSON 招式有 effect 文字但任何來源都查不到 → effect 靜默失效（只造成傷害）。
 *
 * 用 esbuild bundle effects.ts（import 觸發全部註冊），讀「真實註冊 map keys」比對，零 regex 誤報。
 *
 * 輸出：候選未實裝清單，並用 edit-distance 標出「疑錯字/改名」（該卡有極相近的已註冊招式名）。
 * Run: node scripts/coverage-unimplemented.mjs [--strict]
 *   預設 exit 0（資訊性）。--strict 時若有候選則 exit 1（保留給未來 gating）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-cov-entry.ts');
const OUT = join(ROOT, '.tmp-cov-bundle.mjs');
const SHIM = join(ROOT, '.tmp-cov-shim.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });

writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY, `export { ATTACK_PRE, ATTACK_POST, ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects';`);
await build({ entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': SHIM }, logLevel: 'error' });
const { ATTACK_PRE, ATTACK_POST, ATTACK_PRE_DISCARD_CHOICE } = await import(pathToFileURL(OUT).href);

const registered = new Set([...ATTACK_PRE.keys(), ...ATTACK_POST.keys(), ...ATTACK_PRE_DISCARD_CHOICE.keys()]);
// 每張卡已註冊的招式名（給 edit-distance 錯字偵測）
const cardAtks = new Map();
for (const k of registered) { const i = k.indexOf('|'); if (i < 0) continue; const c = k.slice(0, i), a = k.slice(i + 1); if (!cardAtks.has(c)) cardAtks.set(c, []); cardAtks.get(c).push(a); }

// 招式名層級 handler：engine.ts BENCH_FILL_ATTACK_NAMES
const engineSrc = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
const nameHandled = new Set();
{ const m = engineSrc.match(/BENCH_FILL_ATTACK_NAMES = new Set<string>\(\[([\s\S]*?)\]\)/); if (m) for (const mm of m[1].matchAll(/'([^']+)'/g)) nameHandled.add(mm[1]); }

function lev(a, b) { const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)); return d[m][n]; }

const dir = join(ROOT, 'static/cards');
const flagged = []; const seen = new Set();
for (const fn of readdirSync(dir)) {
  if (!fn.endsWith('.json') || fn === 'index.json') continue;
  let cards; try { cards = JSON.parse(readFileSync(join(dir, fn), 'utf8')); } catch { continue; }
  if (!Array.isArray(cards)) continue;
  for (const c of cards) {
    if (c.supertype !== 'Pokemon' || !Array.isArray(c.attacks)) continue;
    for (const a of c.attacks) {
      const eff = (a.effect || '').trim(); if (!eff) continue;
      const key = `${c.name}|${a.name}`;
      if (seen.has(key)) continue; seen.add(key);
      if (registered.has(key) || nameHandled.has(a.name)) continue;
      // 錯字/改名偵測：該卡有已註冊招式且名稱 edit-distance<=2
      let typo = null;
      for (const ra of (cardAtks.get(c.name) || [])) { const d = lev(a.name, ra); if (d <= 2 && (typo === null || d < typo.d)) typo = { d, ra }; }
      flagged.push({ key, eff, dmg: a.damage || '', typo });
    }
  }
}

const typos = flagged.filter(f => f.typo);
console.log(`未實裝／靜默失效 coverage（權威 map 比對）`);
console.log(`  已註冊 handler key ${registered.size}（+招式名層級 ${nameHandled.size}）／有 effect 招式 ${seen.size}`);
console.log(`  候選未實裝: ${flagged.length}　其中疑錯字/改名(高信心真 bug): ${typos.length}\n`);
if (typos.length) {
  console.log('── ❗ 疑錯字/改名（該卡有極相近的已註冊招式名，極可能 key 沒對上）──');
  for (const f of typos) console.log(`  ${f.key}  ← 已註冊「${f.typo.ra}」(距${f.typo.d})  ${f.eff.slice(0, 30)}`);
  console.log('');
}
console.log('── 其餘候選未實裝（前 60）──');
for (const f of flagged.filter(x => !x.typo).slice(0, 60)) console.log(`  ${f.key}  [傷${f.dmg}]  ${f.eff.slice(0, 38)}`);

if (process.argv.includes('--md')) {
  const L = [];
  L.push('# 未實裝／靜默失效卡牌 — coverage 報告', '');
  L.push(`> 自動產生：\`node scripts/coverage-unimplemented.mjs --md\`。引擎用 \`卡名|招式名\` 查 handler 無 fallback；下列招式有 effect 文字但查無實作 → 只造成傷害、效果靜默失效。`, '');
  L.push(`- 候選未實裝：**${flagged.length}**`, `- 其中疑錯字/改名（高信心真 bug）：**${typos.length}**`, '');
  L.push('## ❗ 疑錯字/改名（impl key 用了舊譯名／錯字，極可能 key 沒對上現行 JSON）', '');
  L.push('| 卡牌 | JSON 招式名 | 已註冊相近名 | 距 | 效果 |', '|---|---|---|---|---|');
  for (const f of typos) { const [c,a]=f.key.split('|'); L.push(`| ${c} | ${a} | ${f.typo.ra} | ${f.typo.d} | ${f.eff.replace(/\|/g,'/').slice(0,40)} |`); }
  L.push('', '## 其餘候選未實裝（該卡無相近已註冊招式名）', '');
  L.push('| 卡牌 | 招式 | 傷害 | 效果 |', '|---|---|---|---|');
  for (const f of flagged.filter(x=>!x.typo)) { const [c,a]=f.key.split('|'); L.push(`| ${c} | ${a} | ${f.dmg} | ${f.eff.replace(/\|/g,'/').slice(0,46)} |`); }
  console.log(L.join('\n'));
  process.exit(0);
}

if (process.argv.includes('--strict') && flagged.length > 0) process.exit(1);
