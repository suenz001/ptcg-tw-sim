/**
 * Scrape multiple expansion sets sequentially.
 * Usage:
 *   node scripts/scrape/scrape-all.js
 *   node scripts/scrape/scrape-all.js SV1S SV1V SV2D ...   # explicit list
 *
 * Reads the default set list from this file. To edit which sets get scraped,
 * modify DEFAULT_SETS below.
 *
 * Sets already scraped (i.e. {SET}.json exists under static/cards/) are skipped
 * unless you pass --force. Use --resume to pass through to scrape-set.js for
 * per-set partial recovery.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'static', 'cards');

// Main SV series expansions + M-series Mega sets.
// Ordered roughly chronologically so early failures hit older stuff first.
const DEFAULT_SETS = [
  // SV main expansions (Japanese numbering, matches the TW release cadence)
  'SV1S', 'SV1V', 'SV1a',
  'SV2P', 'SV2D', 'SV2a',
  'SV3', 'SV3a',
  'SV4M', 'SV4K', 'SV4a',
  'SV5M', 'SV5K', 'SV5a',
  'SV6', 'SV6a',
  'SV7', 'SV7a',
  'SV8', 'SV8a',
  'SV9', 'SV9a',
  // SV10 already scraped; keep it in the list so --force re-scrapes would work.
  'SV10',
  'SV11W', 'SV11B',
  // M-series (Mega evolution return)
  'M1S', 'M1L', 'M2', 'M2a', 'M3', 'M4',
  'MBD', 'MBG', 'MC', 'MJ'
];

function parseArgs(argv) {
  const args = { sets: [], force: false, resume: false, delay: 500 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--resume') args.resume = true;
    else if (a === '--delay') args.delay = parseInt(argv[++i], 10);
    else args.sets.push(a);
  }
  if (args.sets.length === 0) args.sets = DEFAULT_SETS;
  return args;
}

function runScrape(setCode, { delay, resume }) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'scrape-set.js');
    const args = [script, setCode, '--delay', String(delay)];
    if (resume) args.push('--resume');
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`scrape-set.js ${setCode} exited ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = Date.now();
  const summary = [];

  for (let i = 0; i < args.sets.length; i++) {
    const setCode = args.sets[i];
    const outPath = path.join(OUT_DIR, `${setCode}.json`);
    const alreadyDone = fs.existsSync(outPath) && !args.force;

    process.stderr.write(
      `\n${'='.repeat(60)}\n` +
        `[${i + 1}/${args.sets.length}] ${setCode}` +
        (alreadyDone ? ' (skip: already scraped)' : '') +
        `\n${'='.repeat(60)}\n`
    );

    if (alreadyDone) {
      const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      summary.push({ setCode, status: 'skipped', count: data.length });
      continue;
    }

    try {
      await runScrape(setCode, args);
      const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      summary.push({ setCode, status: 'ok', count: data.length });
    } catch (e) {
      process.stderr.write(`!!! ${setCode} FAILED: ${e.message}\n`);
      summary.push({ setCode, status: 'failed', error: e.message });
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  process.stderr.write('\n\n========== SUMMARY ==========\n');
  for (const s of summary) {
    const line =
      s.status === 'ok'
        ? `  ✓ ${s.setCode.padEnd(7)} ${String(s.count).padStart(4)} cards`
        : s.status === 'skipped'
          ? `  - ${s.setCode.padEnd(7)} ${String(s.count).padStart(4)} cards (cached)`
          : `  ✗ ${s.setCode.padEnd(7)} ${s.error}`;
    process.stderr.write(line + '\n');
  }
  const okCount = summary.filter((s) => s.status === 'ok').length;
  const skipCount = summary.filter((s) => s.status === 'skipped').length;
  const failCount = summary.filter((s) => s.status === 'failed').length;
  const totalCards = summary.reduce((n, s) => n + (s.count || 0), 0);
  process.stderr.write(
    `\n${okCount} scraped + ${skipCount} cached + ${failCount} failed · ` +
      `${totalCards} cards total · ${elapsed}s\n`
  );
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
