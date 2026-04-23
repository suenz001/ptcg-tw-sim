/**
 * audit-regmark-scrape.mjs
 * 
 * Scrapes the official PTCG TW website for each card and reads the
 * regulation mark from the card detail page's `.pokemon-regulation` or
 * `.pokemon-info` section. Then compares with local JSON and fixes mismatches.
 * 
 * The regulation mark is visible at the bottom-left corner of the card image,
 * and in the HTML it appears as a text element with class containing "alpha"
 * or inside a regulation mark section.
 */
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const DIR = 'static/cards';
const DELAY = 300; // ms between requests
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchRegMark(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = load(html);

    // Method 1: Look for .pokemon-regulation or regulation mark class
    const regEl = $('.pokemon-regulation').text().trim();
    if (regEl && /^[A-Z]$/.test(regEl)) return regEl;

    // Method 2: Look for .alpha class (used in some card pages)
    const alphaEl = $('[class*="alpha"]');
    if (alphaEl.length) {
      const cls = alphaEl.attr('class') || '';
      // e.g. "pokemon-regulation alpha-H" → extract "H"
      const m = cls.match(/alpha[_-]?([A-Z])/i);
      if (m) return m[1].toUpperCase();
      // Or the text content itself
      const txt = alphaEl.text().trim();
      if (/^[A-Z]$/.test(txt)) return txt;
    }

    // Method 3: Search all text for a standalone regulation mark letter
    // in the pokemon info section
    const infoText = $('.pokemon-info, .pokemon-detail, .pokemon-card-detail').text();
    const markMatch = infoText.match(/Regulation\s*(?:Mark)?\s*[:：]?\s*([A-Z])/i);
    if (markMatch) return markMatch[1].toUpperCase();

    // Method 4: Look for image alt text or src containing regulation mark
    const imgs = $('img');
    for (let i = 0; i < imgs.length; i++) {
      const alt = $(imgs[i]).attr('alt') || '';
      const src = $(imgs[i]).attr('src') || '';
      const altM = alt.match(/regulation[_-]?mark[_-]?([A-Z])/i);
      if (altM) return altM[1].toUpperCase();
      const srcM = src.match(/regulation[_-]?([A-Z])\./i);
      if (srcM) return srcM[1].toUpperCase();
    }

    return null;
  } catch {
    return null;
  }
}

async function main() {
  // First, let's check a known card to understand the HTML structure
  const testUrl = 'https://asia.pokemon-card.com/tw/card-search/detail/13153/';
  console.log('Testing HTML structure on:', testUrl);
  const res = await fetch(testUrl);
  const html = await res.text();
  const $ = load(html);

  // Dump all classes containing "regulation" or "alpha" or "mark"
  const allEls = $('*');
  const relevantClasses = new Set();
  allEls.each((_, el) => {
    const cls = $(el).attr('class') || '';
    if (/regulation|alpha|mark/i.test(cls)) {
      relevantClasses.add(cls);
      console.log('Found class:', cls, '→ text:', $(el).text().trim().substring(0, 50));
    }
  });

  // Also check for any image containing regulation mark info
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    const alt = $(el).attr('alt') || '';
    if (/regulation|alpha|mark/i.test(src + alt)) {
      console.log('Found img:', src, 'alt:', alt);
    }
  });

  // Dump the full HTML of the card info section for analysis
  const cardInfo = $('.pokemon-info, .pokemon-card-detail, .card-detail, .pokemon-regulation, .right-pokemon-detail').first();
  if (cardInfo.length) {
    console.log('\n--- Card info section HTML ---');
    console.log(cardInfo.html()?.substring(0, 2000));
  }

  // Try to find by looking at all spans/divs with single letter content
  $('span, div, p').each((_, el) => {
    const text = $(el).text().trim();
    if (/^[A-Z]$/.test(text) && $(el).children().length === 0) {
      const cls = $(el).attr('class') || 'no-class';
      const parent = $(el).parent().attr('class') || 'no-parent';
      console.log(`Single letter "${text}" in <${el.name}> class="${cls}" parent="${parent}"`);
    }
  });
}

main();
