// 以台灣官方稀有度檢索建立顯示用索引；不改卡池、規則或引擎。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const evidenceAt = args.indexOf('--evidence');
if (evidenceAt < 0 || !args[evidenceAt + 1]) throw new Error('請以 --evidence 指定 repo 外的原始頁保存目錄');
const evidence = resolve(args[evidenceAt + 1]);
const relEvidence = relative(resolve(ROOT), evidence);
if (!relEvidence || (!isAbsolute(relEvidence) && relEvidence !== '..' && !relEvidence.startsWith('..' + sep))) throw new Error('原始頁請保存在 repo 外');
mkdirSync(evidence, { recursive: true });
const rareLabels = new Set(['AR', 'SR', 'SAR', 'UR', 'SSR', 'S', 'HR', 'CHR', 'CSR', 'BWR', 'MUR', 'MA', 'FUR']);
const cards = readdirSync(join(ROOT, 'static/cards')).filter(n => n.endsWith('.json') && n !== 'index.json')
  .flatMap(n => { const j = JSON.parse(readFileSync(join(ROOT, 'static/cards', n), 'utf8')); return Array.isArray(j) ? j : j.cards || []; })
  .filter(c => typeof c.name === 'string'); // 資料庫會顯示整包重印；稀有度不能以賽季標記排除。
const ids = new Set(cards.map(c => String(c.id)));
const delay = ms => new Promise(r => setTimeout(r, ms));
async function page(url, name) {
  if (args.includes('--reuse-source')) {
    try { const html = readFileSync(join(evidence, name), 'utf8'); return { $: cheerio.load(html), sha256: createHash('sha256').update(html).digest('hex') }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'PTCG-TW-Sim card-rarity indexing; github.com/suenz001/ptcg-tw-sim' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  const html = await r.text();
  writeFileSync(join(evidence, name), html);
  return { $: cheerio.load(html), sha256: createHash('sha256').update(html).digest('hex') };
}
const { $ } = await page('https://asia.pokemon-card.com/tw/card-search/', 'filters.html');
const definitions = $('input[name="rarity[]"]').map((_, el) => ({ id: $(el).val(), label: $(`label[for="${$(el).attr('id')}"]`).text().trim() })).get()
  .filter(d => rareLabels.has(d.label));
if (!definitions.some(d => d.label === 'SR') || !definitions.some(d => d.label === 'SAR')) throw new Error('官方篩選欄位形狀已改變，停止寫入');
const groups = {}, sources = [];
// 逐類串行，請求間隔 400ms；只在維護時執行，玩家端不呼叫官網。
for (const d of definitions) {
  const found = new Set();
  let declared = null, pages = null;
  const hashes = [];
  for (let n = 1; ; n++) {
    const url = `https://asia.pokemon-card.com/tw/card-search/list/?regulation=all&rarity%5B0%5D=${d.id}&pageNo=${n}`;
    const result = await page(url, `${d.label}-${n}.html`), q = result.$;
    const count = Number(q('.resultNumber').first().text().trim());
    const totalPages = count === 0 ? 1 : Number(q('.resultTotalPages').first().text().match(/\d+/)?.[0]);
    if (q('.resultNumber').length === 0) throw new Error('官網缺少結果總數');
    if (!Number.isInteger(count) || count < 0 || !Number.isInteger(totalPages) || totalPages < 1 || totalPages > 500) throw new Error(`${d.label} 官方總數／頁數無效`);
    if (declared === null) { declared = count; pages = totalPages; }
    if (declared !== count || pages !== totalPages) throw new Error(`${d.label} 抓取期間官網總數異動，請重跑`);
    const links = q('a[href*="/card-search/detail/"]').map((_, el) => (q(el).attr('href') || '').match(/\/detail\/(\d+)/)?.[1]).get().filter(Boolean);
    if (declared > 0 && links.length === 0) throw new Error(`${d.label} 第 ${n} 頁沒有卡片`);
    for (const id of links) found.add(id);
    hashes.push(result.sha256);
    if (n === pages) break;
    await delay(400);
  }
  if (found.size !== declared) throw new Error(`${d.label} 宣告 ${declared}，去重取得 ${found.size}，不可當成完整資料`);
  groups[d.label] = [...found].filter(id => ids.has(id)).sort((a, b) => Number(a) - Number(b));
  sources.push({ label: d.label, rarityId: d.id, declared, pages, maintained: groups[d.label].length, hashes });
  console.log(`${d.label}: 官方 ${declared} 筆／${pages} 頁，本庫已收錄 ${groups[d.label].length} 筆`);
  await delay(400);
}
const data = { schema: 1, source: 'https://asia.pokemon-card.com/tw/card-search/', checkedAt: new Date().toISOString(), groups };
writeFileSync(join(evidence, 'sources.json'), JSON.stringify({ ...data, sources, maintainedCards: cards.length }, null, 2) + '\n');
writeFileSync(join(ROOT, 'src/lib/cards/rarity-index.json'), JSON.stringify(data, null, 2) + '\n');
console.log(`已建立 ${Object.values(groups).reduce((n, g) => n + g.length, 0)} 筆稀有卡索引；其他卡片歸一般卡（含未標稀有度特典卡）。`);
