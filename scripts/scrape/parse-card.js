/**
 * Parse a single card detail page from asia.pokemon-card.com/tw/
 * Input:  numeric card ID (e.g. "12780")
 * Output: Card object matching card-schema.d.ts
 *
 * This module has no I/O side effects; fetch() happens in fetch-card.js.
 * parseCard() takes raw HTML and returns the structured object.
 */

import * as cheerio from 'cheerio';
import { SET_REGULATION_MARK } from '../regulation.js';

/** Energy image filename (e.g. "Water.png") -> our EnergyType string */
const ENERGY_FROM_FILENAME = {
  Grass: 'Grass',
  Fire: 'Fire',
  Water: 'Water',
  Lightning: 'Lightning',
  Psychic: 'Psychic',
  Fighting: 'Fighting',
  Darkness: 'Darkness',
  Metal: 'Metal',
  Fairy: 'Fairy',
  Dragon: 'Dragon',
  Colorless: 'Colorless'
};

/** Extract energy type(s) from <img src=".../energy/Xxx.png"> elements */
function energiesFromImages($, imgs) {
  const result = [];
  imgs.each((_, el) => {
    const src = $(el).attr('src') || '';
    const m = src.match(/\/energy\/(\w+)\.png/);
    if (m && ENERGY_FROM_FILENAME[m[1]]) result.push(ENERGY_FROM_FILENAME[m[1]]);
  });
  return result;
}

/**
 * The h1 text for Pokémon looks like:
 *   "基礎\n\n            名字"
 *   "1階進化\n\n            名字"
 *   "2階進化\n\n            名字"
 * For Trainers/Energy it's just the name.
 * Returns {subtype, name}.
 */
function parsePokemonH1(rawH1) {
  const lines = rawH1.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return { subtype: null, name: '' };
  if (lines.length === 1) return { subtype: null, name: lines[0] };
  const [stageRaw, ...rest] = lines;
  const name = rest.join(' ').trim();
  const stageMap = {
    基礎: 'Basic',
    '1階進化': 'Stage1',
    '2階進化': 'Stage2'
    // V / VSTAR / ex / MEGA are embedded in the name itself in zh-TW
  };
  const subtype = stageMap[stageRaw] ?? null;
  return { subtype, name };
}

/** Detect Pokémon subtype refinements from the name suffix */
function refinePokemonSubtype(baseSubtype, name) {
  if (/\bex\b/.test(name) || name.endsWith('ex')) return 'ex';
  if (/VSTAR/i.test(name)) return 'VSTAR';
  if (name.startsWith('M ') || name.includes('超級進化')) return 'MegaEvolution';
  return baseSubtype ?? 'Other';
}

/**
 * For Trainer cards the h3[0] text tells us the subtype:
 * "物品卡" / "支援者卡" / "競技場卡" / "寶可夢道具卡"
 * For Energy: "基本能量卡" / "特殊能量卡"
 */
function classifyTrainerOrEnergyByH3($) {
  const h3s = $('h3').map((_, el) => $(el).text().trim()).get();
  for (const text of h3s) {
    const t = text.replace(/\s+/g, '');
    if (t.includes('支援者卡')) return { supertype: 'Trainer', subtype: 'Supporter' };
    if (t.includes('競技場卡')) return { supertype: 'Trainer', subtype: 'Stadium' };
    if (t.includes('寶可夢道具卡')) return { supertype: 'Trainer', subtype: 'PokemonTool' };
    if (t.includes('物品卡')) return { supertype: 'Trainer', subtype: 'Item' };
    if (t.includes('特殊能量卡')) return { supertype: 'Energy', subtype: 'Special' };
    if (t.includes('基本能量卡')) return { supertype: 'Energy', subtype: 'Basic' };
  }
  return null;
}

/**
 * Main parser.
 * @param {string} html  Raw HTML of the /detail/{id}/ page
 * @param {string} id    The numeric card ID (we don't discover it from the page)
 * @param {string} sourceUrl
 * @returns {import('./card-schema.d.ts').Card}
 */
export function parseCard(html, id, sourceUrl) {
  const $ = cheerio.load(html);

  // Initial classification: Pokémon has .mainInfomation (HP + type), others don't
  const isPokemon = $('.mainInfomation').length > 0;

  const card = {
    id,
    name: '',
    supertype: 'Pokemon',
    subtype: 'Other',
    setCode: '',
    collectorNumber: '',
    imageUrl: '',
    sourceUrl,
    scrapedAt: new Date().toISOString()
  };

  // --- Card image + set code (from image URL) ---
  const cardImg = $('.cardImage img').first();
  if (cardImg.length) card.imageUrl = cardImg.attr('src') || '';
  const setMark = $('img[src*="/mark/twhk_exp_"]').first();
  if (setMark.length) {
    const m = (setMark.attr('src') || '').match(/twhk_exp_([A-Za-z0-9]+)\.png/);
    if (m) card.setCode = m[1];
  }

  // --- Collector number (e.g. "001/098") ---
  // The .collectorNumber class exists in the page but let's also grep for the
  // "NNN/NNN" pattern as a fallback.
  const colNum = $('.collectorNumber').first().text().trim().replace(/\s+/g, '');
  if (colNum) card.collectorNumber = colNum;

  // --- Regulation mark ---
  // The TW site does not display regulation marks in the HTML, so we look it
  // up from our verified set-code → mark mapping table instead.
  const regLabel = $('.regulationLabel, .regulation').first().text().trim();
  if (regLabel && /^[A-Z]$/.test(regLabel)) {
    card.regulationMark = regLabel;
  } else if (card.setCode && SET_REGULATION_MARK[card.setCode]) {
    card.regulationMark = SET_REGULATION_MARK[card.setCode];
  }

  if (isPokemon) {
    card.supertype = 'Pokemon';

    const h1Raw = $('h1').first().text();
    const { subtype, name } = parsePokemonH1(h1Raw);
    card.name = name;
    card.subtype = refinePokemonSubtype(subtype, name);

    // HP + pokemonType
    const main = $('.mainInfomation').first();
    const hpNum = main.find('.number').text().trim();
    if (hpNum) card.hp = parseInt(hpNum, 10);
    const typeImgs = main.find('img');
    const types = energiesFromImages($, typeImgs);
    if (types.length) card.pokemonType = types[0];

    // Abilities + attacks (both inside .skillInformation > .skill)
    const abilities = [];
    const attacks = [];
    $('.skillInformation .skill').each((_, el) => {
      const $el = $(el);
      const rawName = $el.find('.skillName').text().trim();
      const effect = $el.find('.skillEffect').text().trim();
      const damage = $el.find('.skillDamage').text().trim();
      const costImgs = $el.find('.skillCost img');
      const cost = energiesFromImages($, costImgs);

      // Abilities are marked with "[特性]" prefix
      const abilityMatch = rawName.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (abilityMatch) {
        abilities.push({
          label: abilityMatch[1],
          name: abilityMatch[2],
          effect
        });
      } else if (rawName) {
        attacks.push({ name: rawName, cost, damage, effect });
      }
    });
    if (abilities.length) card.abilities = abilities;
    if (attacks.length) card.attacks = attacks;

    // Weakness / resistance / retreat
    const sub = $('.subInformation');
    if (sub.length) {
      const wk = sub.find('.weakpoint').first();
      if (wk.length) {
        const wkTypes = energiesFromImages($, wk.find('img'));
        const wkText = wk.text().trim().replace(/\s+/g, '');
        if (wkTypes.length && wkText !== '--') {
          card.weakness = { type: wkTypes[0], value: wkText };
        }
      }
      const rs = sub.find('.resist').first();
      if (rs.length) {
        const rsTypes = energiesFromImages($, rs.find('img'));
        const rsText = rs.text().trim().replace(/\s+/g, '');
        if (rsTypes.length && rsText !== '--') {
          card.resistance = { type: rsTypes[0], value: rsText };
        }
      }
      const es = sub.find('.escape').first();
      if (es.length) {
        const esTypes = energiesFromImages($, es.find('img'));
        if (esTypes.length) card.retreatCost = esTypes;
      }
    }

    // Pokédex info from h3 like "No.204 蓑衣蟲寶可夢"
    $('h3').each((_, el) => {
      const t = $(el).text().trim();
      const m = t.match(/^No\.(\d+)\s+(.+寶可夢)$/);
      if (m) {
        card.pokedexNumber = parseInt(m[1], 10);
        card.species = m[2];
      }
    });

    // Pre-evolution (from .evolution section)
    // Format: "{prevName}  {thisName}  {nextName...}" — this card is in the middle
    // Heuristic: find this card's name in .evolution and the previous entry is evolvesFrom
    const evo = $('.evolution').first();
    if (evo.length) {
      const names = evo.find('a, span').map((_, el) => $(el).text().trim()).get()
        .filter((s) => s && s.length > 0);
      const idx = names.findIndex((n) => n === card.name);
      if (idx > 0) card.evolvesFrom = names[idx - 1];
    }
  } else {
    // Trainer or Energy
    card.name = $('h1').first().text().trim();
    const classified = classifyTrainerOrEnergyByH3($);
    if (classified) {
      card.supertype = classified.supertype;
      card.subtype = classified.subtype;
    }
    // Full rules text lives in .skillEffect (.skill > .skillEffect)
    const effectParts = $('.skill .skillEffect')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    if (effectParts.length) card.rulesText = effectParts.join('\n\n');
  }

  // Illustrator — the .illustrator block contains the literal label "繪師"
  // plus the name; strip the label and whitespace to keep just the name.
  const illusRaw = $('.illustrator').first().text().trim();
  if (illusRaw) {
    const cleaned = illusRaw.replace(/^繪師\s*/, '').trim();
    if (cleaned) card.illustrator = cleaned;
  }

  return card;
}
