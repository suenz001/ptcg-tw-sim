/**
 * Fetch official set name + cover art URL for every set in our index.
 *
 * For each set code it tries two sources in order:
 *   1. card-search/list/ page  → extracts page title / heading
 *   2. archive/special/card/{code}/ → checks for hero-visual.png
 *
 * Run: node scripts/fetch-set-info.js
 * Output: printed JSON to stdout (copy useful bits into build-sets-index.js)
 */

import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'static', 'cards', 'index.json');

const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (PTCG-TW-Sim scraper; contact: github.com/suenz001/ptcg-tw-sim)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' }
  });
  return { ok: res.ok, status: res.status, html: res.ok ? await res.text() : '' };
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    return res.ok;
  } catch { return false; }
}

async function fetchSetName(code) {
  // Try card-search list page
  const url = `${BASE}/tw/card-search/list/?expansionCodes=${code}&pageNo=1`;
  const { ok, html } = await fetchHtml(url);
  if (!ok) return null;
  const $ = cheerio.load(html);

  // Try common patterns for set name on Taiwan site
  const candidates = [
    $('title').first().text().trim(),
    $('h1').first().text().trim(),
    $('h2').first().text().trim(),
    $('.expansion-name, .pack-name, .setName').first().text().trim(),
    $('.breadcrumb li').last().text().trim(),
  ];
  return candidates.find(s => s && s.length > 1 && s !== '寶可夢集換式卡牌遊戲') ?? null;
}

async function findCoverUrl(code) {
  const codeLower = code.toLowerCase();
  // Try several known URL patterns for pack art
  const candidates = [
    `${BASE}/tw/archive/special/card/${codeLower}/assets/images/hero-visual.png`,
    `${BASE}/tw/images/card/${code}/hero-visual.png`,
    `${BASE}/tw/card-img/expansion/${code}.png`,
    `${BASE}/tw/common/images/info/packname/${code}.png`,
  ];
  for (const url of candidates) {
    const ok = await headOk(url);
    if (ok) return url;
    await sleep(100);
  }
  return null;
}

async function main() {
  const sets = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const results = [];

  for (const s of sets) {
    process.stderr.write(`Checking ${s.code}...`);
    const [name, cover] = await Promise.all([
      fetchSetName(s.code),
      findCoverUrl(s.code),
    ]);
    const info = {
      code: s.code,
      currentName: s.name,
      fetchedName: name,
      coverUrl: cover ?? '(not found)',
    };
    results.push(info);
    process.stderr.write(` name="${name ?? 'N/A'}" cover=${cover ? 'FOUND' : 'N/A'}\n`);
    await sleep(300);
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
