/**
 * v2.213 — 補抓 PokemonTool 上寫的招式
 *
 * 背景：parse-card.js 原本只把 Trainer 卡的 .skill .skillEffect 串成 rulesText，
 *   未處理 PokemonTool 上「附加後寶可夢可使用的招式」（招式學習器系列、核心記憶碟）。
 *   本次 parser 已加 toolAttacks 抽取邏輯（PokemonTool subtype）。
 *   此腳本重新爬下列 6 張卡，將 attacks 欄位 patch 進對應的 static/cards/*.json。
 *
 * 影響卡（rulesText 含「可使用這張卡上寫的招式」）：
 *   M3 18049 核心記憶碟 [J]
 *   SV8 11281 招式學習器 螢石 [H]
 *   SV8a 12437 招式學習器 演進 [G]
 *   SV8a 12438 招式學習器 衰退 [G]
 *   SVK 11155 招式學習器 演進 [G]
 *   SVK 11156 招式學習器 衰退 [G]
 *
 * 用法：node scripts/migrate-pokemon-tool-attacks.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseCard } from './scrape/parse-card.js';

const TARGETS = [
  { set: 'M3',   id: '18049' },
  { set: 'SV8',  id: '11281' },
  { set: 'SV8a', id: '12437' },
  { set: 'SV8a', id: '12438' },
  { set: 'SVK',  id: '11155' },
  { set: 'SVK',  id: '11156' },
];

const BASE = 'https://asia.pokemon-card.com';

async function fetchAndParse(id) {
  const url = `${BASE}/tw/card-search/detail/${id}/`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-TW' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return parseCard(html, id, url);
}

async function main() {
  // group by set
  const bySet = {};
  for (const t of TARGETS) {
    bySet[t.set] = bySet[t.set] || [];
    bySet[t.set].push(t.id);
  }

  for (const [setCode, ids] of Object.entries(bySet)) {
    const filePath = path.join('static/cards', `${setCode}.json`);
    if (!fs.existsSync(filePath)) {
      console.warn(`[skip] ${filePath} not found`);
      continue;
    }
    const arr = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let touched = 0;

    for (const id of ids) {
      const idx = arr.findIndex(c => c.id === id);
      if (idx < 0) {
        console.warn(`[${setCode}] id=${id} not found in JSON`);
        continue;
      }
      try {
        const fresh = await fetchAndParse(id);
        if (!fresh.attacks || fresh.attacks.length === 0) {
          console.warn(`[${setCode}/${id}] ${fresh.name}: parser still returned no attacks (parser bug?)`);
          continue;
        }
        // 只覆寫 attacks（其他欄位保留現狀，避免動到下游已修過的標籤等）
        arr[idx] = { ...arr[idx], attacks: fresh.attacks };
        touched++;
        const summary = fresh.attacks.map(a =>
          `${a.name} [${a.cost.join(',') || '無'}]${a.damage ? ' ' + a.damage : ''}`
        ).join('; ');
        console.log(`[${setCode}/${id}] ${fresh.name}: ${summary}`);
      } catch (e) {
        console.error(`[${setCode}/${id}] ${e.message}`);
      }
    }

    if (touched > 0) {
      fs.writeFileSync(filePath, JSON.stringify(arr, null, 2) + '\n');
      console.log(`[${setCode}] wrote ${touched} cards`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
