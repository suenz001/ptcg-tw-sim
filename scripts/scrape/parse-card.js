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
    if (t.includes('寶可夢道具')) return { supertype: 'Trainer', subtype: 'PokemonTool' };
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
export function parseCard(html, id, sourceUrl, expectedSetCode = null) {
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

  // --- Collector number (e.g. "001/098" or "099/M-P") ---
  // The .collectorNumber class exists in the page but let's also grep for the
  // "NNN/NNN" pattern as a fallback.
  const colNum = $('.collectorNumber').first().text().trim().replace(/\s+/g, '');
  if (colNum) card.collectorNumber = colNum;

  // Fallback 1: promo cards show /mark/PROMO.MARK.png and have a collector
  // number like "099/M-P" — extract the set code from the collector number's
  // denominator, since the twhk_exp_*.png image is absent.
  if (!card.setCode && colNum) {
    const m = colNum.match(/\/([A-Z0-9-]+)$/);
    if (m) card.setCode = m[1];
  }
  // Fallback 2: some promo entries (e.g. basic energy with colNum "GRA",
  // 勝利之證 with colNum "M-P" sans slash) can't be recovered from either
  // the logo or collectorNumber. Use the scrape-set.js-provided expectedSetCode
  // as a last-resort fallback — we know from the list-page walk which set
  // we're scraping.
  if (!card.setCode && expectedSetCode) {
    card.setCode = expectedSetCode;
  }

  // --- Regulation mark ---
  // The TW site has regulation marks in the `<span class="alpha">H</span>` block.
  // This is critical for compilation sets (like SV4a, SV8a) where cards from
  // different sets (and thus different regulation marks) are mixed.
  const alphaMark = $('.alpha').first().text().trim();
  const regLabel = $('.regulationLabel, .regulation').first().text().trim();
  
  if (alphaMark && /^[A-Z]$/.test(alphaMark)) {
    card.regulationMark = alphaMark;
  } else if (regLabel && /^[A-Z]$/.test(regLabel)) {
    card.regulationMark = regLabel;
  } else if (card.setCode && SET_REGULATION_MARK[card.setCode]) {
    card.regulationMark = SET_REGULATION_MARK[card.setCode];
  }

  if (isPokemon) {
    card.supertype = 'Pokemon';

    const h1Raw = $('h1').first().text();
    const { subtype, name } = parsePokemonH1(h1Raw);
    card.name = name;
    // v2.75: 保留原始 stage（基礎/1階進化/2階進化），然後才讓 refine 把 subtype 覆寫為 ex 等
    if (subtype) card.stage = subtype;  // 'Basic' | 'Stage1' | 'Stage2'
    card.subtype = refinePokemonSubtype(subtype, name);

    // HP + pokemonType
    const main = $('.mainInfomation').first();
    const hpNum = main.find('.number').text().trim();
    if (hpNum) card.hp = parseInt(hpNum, 10);
    const typeImgs = main.find('img');
    const types = energiesFromImages($, typeImgs);
    if (types.length) card.pokemonType = types[0];

    // Abilities + attacks + tags (all inside .skillInformation > .skill)
    //
    // 寶可夢的 .skill 區塊可能是三種：
    //   (a) 特性：rawName 為 "[特性] xxx"（或 "[古代特性] xxx" 等）→ abilities[]
    //   (b) 特徵標籤（目前只有「太晶」）：rawName 為 "太晶" 或 "[太晶]"，沒有 cost/damage →
    //       這不是招式而是寶可夢本身的防禦特徵（e.g. 太晶 = 在備戰區不受招式傷害），
    //       寫到 card.tags[] 讓引擎查詢。
    //   (c) 招式：其餘的。
    const abilities = [];
    const attacks = [];
    const tags = [];
    const TAG_KEYWORDS = new Set(['太晶', '[太晶]']);
    $('.skillInformation .skill').each((_, el) => {
      const $el = $(el);
      const rawName = $el.find('.skillName').text().trim();
      const effect = $el.find('.skillEffect').text().trim();
      const damage = $el.find('.skillDamage').text().trim();
      const costImgs = $el.find('.skillCost img');
      const cost = energiesFromImages($, costImgs);

      // Abilities are marked with "[特性]" prefix ("[特性] xxx")
      const abilityMatch = rawName.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (abilityMatch) {
        abilities.push({
          label: abilityMatch[1],
          name: abilityMatch[2],
          effect
        });
        return;
      }

      // 特徵標籤（太晶）：name 是白名單 + 沒有 cost/damage
      if (TAG_KEYWORDS.has(rawName) && cost.length === 0 && !damage) {
        const cleanName = rawName.replace(/^\[/, '').replace(/\]$/, '');
        if (!tags.includes(cleanName)) tags.push(cleanName);
        return;
      }

      if (rawName) {
        attacks.push({ name: rawName, cost, damage, effect });
      }
    });
    // 訓練家冠名（v2.71 改名自「訓練家的寶可夢」並擴展到 Trainer 卡）。
    // 含兩類：
    //   (a) 訓練家冠名的寶可夢（例：阿響的凱羅斯、火箭隊的超夢ex、竹蘭的烈咬陸鯊ex）
    //   (b) 訓練家冠名的訓練家卡（例：赫普的包包、N的ＰＰ提升劑、老大的指令）
    // 這類卡在官網寶可夢的 name 會帶有 `<XX的>` 包裝標記，HTML 上可見。v2.71 後
    // JSON 儲存時會把 `<>` strip 掉（fetch-card.js 處理），但 parse-card.js 在
    // 打 tag 時以原始帶 `<>` name 判定，最可靠。
    // 訓練家卡沒有 `<>` 標記，由 migrate-tags.js / migrate-trainer-branded.mjs 的
    // prefix 比對補打 tag，未來新 Trainer 卡由 migration 批次回填。
    if (/^<[^<>]+的>/.test(card.name)) {
      if (!tags.includes('訓練家冠名')) tags.push('訓練家冠名');
    }
    // v2.71：tag 打完後，strip `<>` 讓 JSON name 不帶冠名括號（統一格式）。
    // 這也會順便 strip evolvesFrom（若前階也帶冠名）。
    if (card.name.includes('<') || card.name.includes('>')) {
      card.name = card.name.replace(/[<>]/g, '');
    }

    if (abilities.length) card.abilities = abilities;
    if (attacks.length) card.attacks = attacks;
    if (tags.length) card.tags = tags;

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
      if (idx > 0) {
        // v2.76: 向前搜尋正確的前階卡。
        // 官網 .evolution 區塊可能在 ex 卡前面列出同名的 GX / 非 ex 版本，
        // 例如 [小火龍, 火恐龍, 噴火龍, 噴火龍GX, 噴火龍ex]
        // 噴火龍ex 的 evolvesFrom 應該是 火恐龍（跳過同名的噴火龍和噴火龍GX）。
        const cardBase = card.name.replace(/ex$/, '').trim();
        let evoName = null;
        for (let i = idx - 1; i >= 0; i--) {
          const clean = names[i].replace(/[<>]/g, '').replace(/GX$/, '').replace(/ex$/, '').trim();
          if (clean !== cardBase) {
            evoName = names[i].replace(/[<>]/g, '').replace(/GX$/, '');
            break;
          }
        }
        if (evoName) card.evolvesFrom = evoName;
      }
    }
  } else {
    // Trainer or Energy
    const rawTrainerName = $('h1').first().text().trim();
    // v2.71：Trainer 冠名卡（如「赫普的包包」「N的ＰＰ提升劑」「瑪俐的長毛巨魔組合」）
    // 打 '訓練家冠名' tag。
    //
    // 定義（Leon 定的）：冠名訓練家 = 該訓練家**至少有一隻對應的寶可夢**。像
    // 「暗碼迷的解讀」「松葉的信心」「水蓮的照顧」「老大的指令」「博士的研究」
    // 雖然也是「XX的」格式，但卡池裡沒有「暗碼迷的XX」「松葉的XX」「老大的XX」
    // 寶可夢，所以只是「支援者的角色名稱」，不算冠名。
    //
    // 白名單 13 人：從 static/cards 反推真寶可夢（必須 supertype='Pokemon'
    // **且** subtype !== 'Other' — 'Other' 是寶可夢道具卡 PokemonTool 的標記，
    // 不算真寶可夢）。scripts/migrate-trainer-branded-fix.mjs 能自動重算。
    // 未來新 set 若出現新的「XX的寶可夢」系列，記得把 XX 加到這份白名單 +
    // migrate-tags.js 的 TRAINER_OWNERS。
    //
    // v2.73：原 v2.72 清單誤含「探險家」— 探險家的嚮導 SV8a 12449 是
    // [Pokemon/Other]（PokemonTool），不是真寶可夢；其他 4 版本都是
    // Trainer/Supporter。所以探險家沒有任何一張真寶可夢，不算冠名訓練家。
    const TRAINER_BRANDED_OWNERS = [
      'N', '大吾', '奇樹', '小霞', '派帕', '火箭隊',
      '瑪俐', '竹蘭', '莉佳', '莉莉艾', '赫普', '阿響', '青木'
    ];
    const TRAINER_BRANDED_RE = new RegExp('^(' + TRAINER_BRANDED_OWNERS.join('|') + ')的');
    const isTrainerBranded = (name) => TRAINER_BRANDED_RE.test(name);
    card.name = rawTrainerName.replace(/[<>]/g, '');
    const classified = classifyTrainerOrEnergyByH3($);
    if (classified) {
      card.supertype = classified.supertype;
      card.subtype = classified.subtype;
    } else if (/能量$/.test(card.name)) {
      // v2.69：官網部分卡（例：驅勁能量古代/未來版）HTML 內完全沒有 h3 分類標籤，
      // classifyTrainerOrEnergyByH3 會回 null → 落回 default supertype='Pokemon'，
      // 下游 migrate-tags.js 的 supertype guard 也因此擋下 ACE SPEC 補 tag。
      // fallback：卡名以「能量」結尾 → 視為能量卡。基本能量大多帶 h3 所以走前面分支，
      // 此 fallback 預設為 Special（ACE SPEC / 一般特殊能量皆落此範圍）。
      card.supertype = 'Energy';
      card.subtype = /基本/.test(card.name) ? 'Basic' : 'Special';
    }
    // Full rules text lives in .skillEffect (.skill > .skillEffect)
    const effectParts = $('.skill .skillEffect')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    if (effectParts.length) card.rulesText = effectParts.join('\n\n');

    // Trainer 冠名卡打 tag（能量不判定）
    if (card.supertype === 'Trainer' && isTrainerBranded(card.name)) {
      card.tags = card.tags || [];
      if (!card.tags.includes('訓練家冠名')) card.tags.push('訓練家冠名');
    }
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
