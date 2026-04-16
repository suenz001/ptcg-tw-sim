/**
 * Scrape all cards from a single expansion set and write to data/cards/{SET}.json.
 *
 * Usage:
 *   node scripts/scrape/scrape-set.js SV10
 *   node scripts/scrape/scrape-set.js SV10 --delay 800   # custom delay per request (ms)
 *   node scripts/scrape/scrape-set.js SV10 --resume      # skip cards already in the output file
 *
 * Output:
 *   data/cards/{SET}.json     - array of Card objects
 *   data/cards/{SET}.log      - append-only log (one line per attempt)
 *
 * Rate limiting: default 600ms between requests to be polite. The site has no
 * obvious anti-scraping, but we don't want to be rude.
 */

import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard } from './parse-card.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
// Cards are written under static/ so SvelteKit serves them as-is at /cards/*.json.
// One source of truth — no duplicate data/ + static/ copies.
const OUT_DIR = path.join(REPO_ROOT, 'static', 'cards');

const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (PTCG-TW-Sim scraper; contact: github.com/suenz001/ptcg-tw-sim)';

function parseArgs(argv) {
  const args = { set: null, delayMs: 600, resume: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--delay') args.delayMs = parseInt(argv[++i], 10);
    else if (a === '--resume') args.resume = true;
    else if (!args.set) args.set = a;
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

/** Collect every numeric card ID in a set, walking pagination. */
async function collectCardIds(setCode, delayMs) {
  const ids = new Set();
  let pageNo = 1;
  while (true) {
    const url = `${BASE}/tw/card-search/list/?expansionCodes=${setCode}&pageNo=${pageNo}`;
    console.error(`  list page ${pageNo}: ${url}`);
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const before = ids.size;
    $('a[href*="/detail/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/detail\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    const added = ids.size - before;
    // If this page added zero new ids we've gone past the end
    if (added === 0) break;
    // Check if there's a "Next" page marker; if not, stop
    const hasNext = $(`.pagination a[href*="pageNo=${pageNo + 1}"]`).length > 0;
    pageNo++;
    if (!hasNext) break;
    await sleep(delayMs);
  }
  return [...ids].sort((a, b) => parseInt(a) - parseInt(b));
}

async function loadExistingCards(outPath) {
  try {
    const raw = await fs.readFile(outPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.set) {
    console.error('Usage: node scrape-set.js <SET_CODE> [--delay ms] [--resume]');
    process.exit(1);
  }
  const setCode = args.set;

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${setCode}.json`);
  const logPath = path.join(OUT_DIR, `${setCode}.log`);

  console.error(`[1/3] Collecting card IDs for set ${setCode}...`);
  const allIds = await collectCardIds(setCode, args.delayMs);
  console.error(`      Found ${allIds.length} card IDs.`);

  const existing = args.resume ? await loadExistingCards(outPath) : [];
  const existingById = new Map(existing.map((c) => [c.id, c]));
  const toFetch = allIds.filter((id) => !existingById.has(id));
  console.error(
    `[2/3] To scrape: ${toFetch.length} cards ` +
      (args.resume ? `(resuming; ${existing.length} already done)` : '')
  );

  const results = [...existing];
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const id = toFetch[i];
    const url = `${BASE}/tw/card-search/detail/${id}/`;
    try {
      await sleep(args.delayMs);
      const html = await fetchHtml(url);
      const card = parseCard(html, id, url);
      results.push(card);
      ok++;
      await fs.appendFile(
        logPath,
        `${new Date().toISOString()}\tOK\t${id}\t${card.name}\t${card.supertype}/${card.subtype}\n`
      );
      process.stderr.write(
        `  [${i + 1}/${toFetch.length}] ${id} ${card.name} (${card.supertype}/${card.subtype})\n`
      );
      // Save progress every 10 cards so we don't lose work on crash
      if (ok % 10 === 0) {
        results.sort((a, b) => parseInt(a.id) - parseInt(b.id));
        await writeAtomic(outPath, JSON.stringify(results, null, 2));
      }
    } catch (e) {
      fail++;
      await fs.appendFile(
        logPath,
        `${new Date().toISOString()}\tERR\t${id}\t${e.message}\n`
      );
      console.error(`  [${i + 1}/${toFetch.length}] ${id} FAILED: ${e.message}`);
    }
  }

  console.error(`[3/3] Writing ${results.length} cards to ${outPath}`);
  results.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  await writeAtomic(outPath, JSON.stringify(results, null, 2));
  console.error(`Done. ${ok} ok, ${fail} failed.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
