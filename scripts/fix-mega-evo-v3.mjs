#!/usr/bin/env node
/**
 * fix-mega-evo-v3.mjs — Fix the remaining 7 Mega cards by fetching their 
 * base ex cards' evolution chains, then applying to both base ex and Mega.
 */
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
const allCards = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon') allCards.push(c);
}

// The 7 base ex species that need evolvesFrom
const baseExNames = ['沙奈朵ex', '呆呆王ex', '妙蛙花ex', '雪妖女ex', '快龍ex', '皮可西ex'];
// Note: 超級艾路雷朵ex also points to 沙奈朵ex (Gardevoir line → Gallade branch)

const stageMap = { '基礎': 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2' };
const fixes = new Map();

for (const exName of baseExNames) {
  const card = allCards.find(c => c.name === exName);
  if (!card) { console.log(`NOT FOUND: ${exName}`); continue; }
  if (card.evolvesFrom) { console.log(`${exName} already has evo=${card.evolvesFrom}`); continue; }

  console.log(`Fetching ${exName}: ${card.sourceUrl}`);
  const resp = await fetch(card.sourceUrl);
  const html = await resp.text();
  const $ = load(html);

  const h1Lines = $('h1').first().text().trim().split('\n').map(s => s.trim()).filter(Boolean);
  const correctStage = h1Lines.length >= 2 ? (stageMap[h1Lines[0]] || null) : null;

  const evo = $('.evolution').first();
  let correctEvo = null;
  if (evo.length) {
    const names = evo.find('a, span').map((_, el) => $(el).text().trim()).get()
      .filter(s => s && s.length > 0);
    console.log(`  Chain: ${JSON.stringify(names)}`);

    const baseName = exName.replace(/ex$/, '').trim();
    // Find our card in the chain
    let idx = names.findIndex(n => n === exName);
    if (idx < 0) idx = names.findIndex(n => n === baseName);

    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        const clean = names[i].replace(/[<>]/g, '').replace(/GX$/, '').replace(/ex$/, '').trim();
        if (clean !== baseName) {
          correctEvo = names[i].replace(/[<>]/g, '').replace(/GX$/, '');
          break;
        }
      }
    }
  }

  fixes.set(exName, { correctEvo, correctStage });
  console.log(`  → stage=${correctStage}, evolvesFrom=${correctEvo}\n`);
  await new Promise(r => setTimeout(r, 300));
}

// Apply fixes to base ex cards
console.log('=== Applying base ex fixes ===');
let count = 0;
for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let mod = false;
  for (const c of cards) {
    const fix = fixes.get(c.name);
    if (!fix) continue;
    if (fix.correctEvo && !c.evolvesFrom) {
      console.log(`  ${f} ${c.id} ${c.name}: evo → ${fix.correctEvo}`);
      c.evolvesFrom = fix.correctEvo;
      mod = true; count++;
    }
    if (fix.correctStage && c.stage !== fix.correctStage) {
      c.stage = fix.correctStage;
      mod = true;
    }
  }
  if (mod) fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
}
console.log(`Fixed ${count} base ex cards\n`);

// Now fix Mega cards — rebuild lookup
const allCards2 = [];
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon') allCards2.push(c);
}
const nameToEvo = new Map();
allCards2.forEach(c => { if (c.evolvesFrom && !nameToEvo.has(c.name)) nameToEvo.set(c.name, c.evolvesFrom); });

console.log('=== Fixing Mega ex ===');
let megaCount = 0;
for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let mod = false;
  for (const c of cards) {
    if (!c.name?.startsWith('超級') || !c.evolvesFrom) continue;
    if (!c.evolvesFrom.endsWith('ex')) continue; // Only fix those still pointing to ex

    let cur = c.evolvesFrom;
    const megaBase = c.name.replace(/^超級/, '').replace(/ex$/, '').replace(/[XY]$/, '').trim();
    for (let i = 0; i < 10; i++) {
      const cleanCur = cur.replace(/ex$/, '').replace(/GX$/, '').trim();
      if (cleanCur === megaBase || cur.endsWith('ex') || cur.endsWith('GX')) {
        const next = nameToEvo.get(cur);
        if (next) { cur = next; } else break;
      } else break;
    }
    if (cur !== c.evolvesFrom) {
      console.log(`  ${f} ${c.id} ${c.name}: ${c.evolvesFrom} → ${cur}`);
      c.evolvesFrom = cur;
      mod = true; megaCount++;
    }
  }
  if (mod) fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
}
console.log(`Fixed ${megaCount} Mega cards\n`);

// Final verification
console.log('=== Final verification ===');
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
