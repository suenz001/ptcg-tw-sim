#!/usr/bin/env node
/**
 * fix-mega-final.mjs — Fetch the 7 remaining Mega cards directly from official site
 * and parse their evolution chain to find the correct non-ex predecessor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

const megaToFix = [
  ['超級艾路雷朵ex', 'https://asia.pokemon-card.com/tw/card-search/detail/17975/'],
  ['超級呆殼獸ex', 'https://asia.pokemon-card.com/tw/card-search/detail/18073/'],
  ['超級妙蛙花ex', 'https://asia.pokemon-card.com/tw/card-search/detail/13960/'],
  ['超級沙奈朵ex', 'https://asia.pokemon-card.com/tw/card-search/detail/14062/'],
  ['超級雪妖女ex', 'https://asia.pokemon-card.com/tw/card-search/detail/14696/'],
  ['超級快龍ex', 'https://asia.pokemon-card.com/tw/card-search/detail/14786/'],
  ['超級皮可西ex', 'https://asia.pokemon-card.com/tw/card-search/detail/18007/'],
];

const stageMap = { '基礎': 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2' };
const fixes = new Map(); // megaName → correctEvo

for (const [megaName, url] of megaToFix) {
  console.log(`Fetching ${megaName}: ${url}`);
  const resp = await fetch(url);
  const html = await resp.text();
  const $ = load(html);

  const h1Lines = $('h1').first().text().trim().split('\n').map(s => s.trim()).filter(Boolean);
  const stage = h1Lines.length >= 2 ? (stageMap[h1Lines[0]] || null) : null;

  const evo = $('.evolution').first();
  let correctEvo = null;
  if (evo.length) {
    const names = evo.find('a, span').map((_, el) => $(el).text().trim()).get()
      .filter(s => s && s.length > 0);
    console.log(`  Chain: ${JSON.stringify(names)}`);

    // Find this mega card in chain
    const cardName = h1Lines[h1Lines.length - 1] || megaName;
    let idx = names.findIndex(n => n === cardName);
    if (idx < 0) idx = names.findIndex(n => n === megaName);

    // Walk backwards and skip ALL ex/GX variants and same-species entries
    const megaBase = megaName.replace(/^超級/, '').replace(/ex$/, '').replace(/[XY]$/, '').trim();
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        const raw = names[i].replace(/[<>]/g, '');
        const clean = raw.replace(/GX$/, '').replace(/ex$/, '').trim();
        if (clean !== megaBase) {
          correctEvo = raw.replace(/GX$/, '');
          break;
        }
      }
    }
  }

  fixes.set(megaName, correctEvo);
  console.log(`  → evo=${correctEvo}\n`);
  await new Promise(r => setTimeout(r, 300));
}

// Apply fixes
console.log('=== Applying fixes ===');
let total = 0;
for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let mod = false;
  for (const c of cards) {
    const fix = fixes.get(c.name);
    if (fix && c.evolvesFrom && c.evolvesFrom.endsWith('ex')) {
      console.log(`  ${f} ${c.id} ${c.name}: ${c.evolvesFrom} → ${fix}`);
      c.evolvesFrom = fix;
      mod = true;
      total++;
    }
  }
  if (mod) fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
}
console.log(`\nFixed ${total} Mega cards`);

// Final verification - ALL Mega cards
console.log('\n=== ALL Mega cards final state ===');
const seen = new Set();
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (!c.name?.startsWith('超級') || c.supertype !== 'Pokemon') continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const bad = c.evolvesFrom?.endsWith('ex') ? ' ← WRONG' : '';
    console.log(`${c.name.padEnd(16)} stage=${String(c.stage).padEnd(7)} evo=${c.evolvesFrom || '(none)'}${bad}`);
  }
}
