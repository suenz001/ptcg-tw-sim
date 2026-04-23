#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// 7 species that still have issues — need deep chain parsing
const species = [
  ['熾焰咆哮虎', 'https://asia.pokemon-card.com/tw/card-search/detail/16603/'],
  ['刺龍王', 'https://asia.pokemon-card.com/tw/card-search/detail/16625/'],
  ['甲賀忍蛙', 'https://asia.pokemon-card.com/tw/card-search/detail/16679/'],
  ['路卡利歐', 'https://asia.pokemon-card.com/tw/card-search/detail/16851/'],
  ['阿羅拉 椰蛋樹', 'https://asia.pokemon-card.com/tw/card-search/detail/17008/'],
  ['暴飛龍', 'https://asia.pokemon-card.com/tw/card-search/detail/17011/'],
  ['噴火龍', 'https://asia.pokemon-card.com/tw/card-search/detail/13163/'],
];

const stageMap = { '基礎': 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2' };
const fixes = new Map(); // baseName → { correctEvo, correctStage }

for (const [baseName, url] of species) {
  console.log(`Fetching ${baseName}: ${url}`);
  const resp = await fetch(url);
  const html = await resp.text();
  const $ = load(html);

  // Parse H1 for stage
  const h1Lines = $('h1').first().text().trim().split('\n').map(s => s.trim()).filter(Boolean);
  const correctStage = h1Lines.length >= 2 ? (stageMap[h1Lines[0]] || null) : null;

  // Parse .evolution — skip ALL entries matching baseName (with/without ex/GX)
  const evo = $('.evolution').first();
  let correctEvo = null;
  if (evo.length) {
    const names = evo.find('a, span').map((_, el) => $(el).text().trim()).get()
      .filter(s => s && s.length > 0);
    console.log(`  Chain: ${JSON.stringify(names)}`);

    // Find this card in chain
    const cardName = h1Lines[h1Lines.length - 1] || baseName;
    let idx = names.findIndex(n => n === cardName);
    if (idx < 0) idx = names.findIndex(n => n.replace(/ex$/, '').replace(/GX$/, '') === baseName);

    if (idx > 0) {
      // Walk backwards, skip ALL entries that match baseName
      for (let i = idx - 1; i >= 0; i--) {
        const clean = names[i].replace(/[<>]/g, '').replace(/GX$/, '').replace(/ex$/, '').trim();
        if (clean !== baseName) {
          correctEvo = names[i].replace(/[<>]/g, '').replace(/GX$/, '');
          break;
        }
      }
    }
  }

  fixes.set(baseName, { correctEvo, correctStage });
  console.log(`  → stage=${correctStage}, evolvesFrom=${correctEvo}\n`);
  await new Promise(r => setTimeout(r, 300));
}

// Apply fixes to JSON
console.log('=== Applying fixes ===');
let totalFixed = 0;

for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let modified = false;

  for (const c of cards) {
    if (c.supertype !== 'Pokemon') continue;
    const bn = c.name.replace(/ex$/, '').trim();
    const fix = fixes.get(bn);
    if (!fix) continue;

    if (c.evolvesFrom) {
      const isWrong = c.evolvesFrom === c.name || (c.evolvesFrom === bn && c.name !== bn);
      if (isWrong && fix.correctEvo) {
        console.log(`  ${f} ${c.id} ${c.name}: evo ${c.evolvesFrom} → ${fix.correctEvo}`);
        c.evolvesFrom = fix.correctEvo;
        modified = true;
        totalFixed++;
      }
    }
    if (fix.correctStage && c.stage !== fix.correctStage) {
      c.stage = fix.correctStage;
      modified = true;
    }
  }

  if (modified) fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
}

console.log(`\nFixed ${totalFixed} cards`);

// Final verification
console.log('\n=== Final verification ===');
let remaining = 0;
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    if (c.supertype !== 'Pokemon' || !c.evolvesFrom) continue;
    const bn = c.name.replace(/ex$/, '').trim();
    if (c.evolvesFrom === c.name || (c.evolvesFrom === bn && c.name !== bn)) {
      console.log(`  STILL BAD: ${f} ${c.id} ${c.name}: evo=${c.evolvesFrom}`);
      remaining++;
    }
  }
}
console.log(remaining === 0 ? 'ALL CLEAN!' : `${remaining} cards still have issues`);
