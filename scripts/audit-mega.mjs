#!/usr/bin/env node
/**
 * audit-mega-cards.mjs — Fetch ALL Mega card pages and extract:
 * 1. Stage from H1 (基礎/1階進化/2階進化)
 * 2. "從「X」進化" text from card detail area
 * 3. Compare with current data
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

// Get unique Mega cards with their sourceUrl
const megaCards = new Map();
for (const c of allCards) {
  if (!c.name?.startsWith('超級')) continue;
  if (!megaCards.has(c.name)) megaCards.set(c.name, c);
}

const stageMap = { '基礎': 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2' };

console.log(`Auditing ${megaCards.size} unique Mega species...\n`);

const results = [];

for (const [name, card] of megaCards) {
  if (!card.sourceUrl) { console.log(`SKIP ${name}: no sourceUrl`); continue; }
  
  const resp = await fetch(card.sourceUrl);
  const html = await resp.text();
  const $ = load(html);
  
  // 1. Parse H1 for stage
  const h1Lines = $('h1').first().text().trim().split('\n').map(s => s.trim()).filter(Boolean);
  const webStage = h1Lines.length >= 2 ? (stageMap[h1Lines[0]] || h1Lines[0]) : '?';
  
  // 2. Look for "從「X」進化" in the page
  const pageText = $('body').text();
  const evoMatch = pageText.match(/從「([^」]+)」進化/);
  const webEvo = evoMatch ? evoMatch[1] : null;
  
  // 3. Also check the card detail section specifically
  const detailText = $('.card-detail, .pokemon-info, .card-info, .detail').text();
  const detailMatch = detailText.match(/從「([^」]+)」進化/);
  const detailEvo = detailMatch ? detailMatch[1] : null;
  
  const currentEvo = card.evolvesFrom || '(none)';
  const currentStage = card.stage || '?';
  
  const stageMismatch = webStage !== currentStage;
  const evoMismatch = webEvo && webEvo !== currentEvo;
  const mark = (stageMismatch || evoMismatch) ? ' ← MISMATCH' : '';
  
  results.push({ name, webStage, webEvo: webEvo || detailEvo, currentStage, currentEvo, stageMismatch, evoMismatch });
  
  console.log(`${name}`);
  console.log(`  Web:     stage=${webStage}, evo=${webEvo || detailEvo || '(not found)'}`);
  console.log(`  Current: stage=${currentStage}, evo=${currentEvo}${mark}`);
  
  await new Promise(r => setTimeout(r, 300));
}

// Summary
console.log('\n=== MISMATCHES ===');
const mismatches = results.filter(r => r.stageMismatch || r.evoMismatch);
if (mismatches.length === 0) {
  console.log('None!');
} else {
  for (const r of mismatches) {
    console.log(`${r.name}:`);
    if (r.stageMismatch) console.log(`  stage: ${r.currentStage} → ${r.webStage}`);
    if (r.evoMismatch) console.log(`  evo: ${r.currentEvo} → ${r.webEvo}`);
  }
}
