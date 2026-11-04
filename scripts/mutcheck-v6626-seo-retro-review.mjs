// 真產品副本突變：不寫ROOT，指定行為必須紅；中性註解與還原必須綠。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'ptcg-v6626-'));
const server = 'oracle-admin/server_admin_patch.js', page = 'src/routes/deck-posts/+page.svelte';
const originals = new Map([server, page].map(p => [p, readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')]));
function reset() { for (const [p, s] of originals) { mkdirSync(dirname(join(temp, p)), { recursive: true }); writeFileSync(join(temp, p), s); } }
function run(label, red) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/test-v6626-seo-retro-review.mjs')], { cwd: ROOT, env: { ...process.env, V6626_PRODUCT: temp }, encoding: 'utf8', timeout: 90000 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (red) { assert.equal(r.status, 1, label + '必須行為失敗而非崩潰 ' + out); assert.ok(out.includes('FAIL ' + red), label + '指定行為未攔截 ' + out); }
  else { assert.equal(r.status, 0, label + '應通過 ' + out); assert.match(out, /15 PASS \/ 0 FAIL/); }
  console.log(label + ' OK' + (red ? ' -> ' + red : ''));
}
function change(path, from, to, count = 1) { const s = originals.get(path); assert.equal(s.split(from).length - 1, count, '突變錨點次數 ' + from); writeFileSync(join(temp, path), s.split(from).join(to)); }
try {
  reset(); run('正對照');
  const cases = [
    ['M1 名稱欄位', server, 'p.deckName', 'p.title', 4, 'A1'],
    ['M2 卡池Map', server, 'const card = TPOOL.get(id);', 'const card = null;', 1, 'A2'],
    ['M3 不合併在途', server, 'if (!pending) pending =', 'if (true) pending =', 1, 'B1'],
    ['M4 吞DB故障', server, ').sort({ endedAt: -1 }).limit(500).toArray(),', ').sort({ endedAt: -1 }).limit(500).toArray().catch(() => []),', 1, 'B3'],
    ['M5 吞分類故障', server, 'if (recentMatches.length) await app.locals._archetypeEnrichMatchRecords(recentMatches);', 'try { if (recentMatches.length) await app.locals._archetypeEnrichMatchRecords(recentMatches); } catch {}', 1, 'B4'],
    ['M6 完成後不清在途', server, '.finally(() => { pending = null; })', '', 1, 'B5'],
    ['M7 手機依賴hydrate', page, '@media (max-width: 1023px) {\n    .meta-bar {', '@media (max-width: 10000px) {\n    .meta-bar {', 1, 'D1'],
    ['M8 重複中央判準', server, 'const _metaCleanFilter = app.locals._buildCasualCleanFilter({ excludeAI: true, archNoShow: true, winnerOnly: true });', 'const _metaCleanFilter = {};', 1, 'C1'],
    ['M9 永久統計快取', server, 'exp: Date.now() + 30 * 60 * 1000', 'exp: Infinity', 1, 'B7'],
    ['M10 永久sitemap快取', server, 'exp: Date.now() + 10 * 60 * 1000', 'exp: Infinity', 1, 'B7'],
  ];
  for (const [name, p, a, b, n, red] of cases) { reset(); change(p, a, b, n); run(name, red); }
  reset(); writeFileSync(join(temp, server), originals.get(server) + '\n// 中性註解，不改行為\n'); run('N1 中性註解'); reset(); run('逐位元還原');
  console.log(cases.length + '/' + cases.length + ' 有效突變攔截，N1與還原皆綠');
} finally { assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep)); rmSync(temp, { recursive: true, force: true }); }
