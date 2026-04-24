#!/usr/bin/env node
/**
 * v2.87 audit — 把 12 張 evolvesFrom 殘骸（v2.76 大清查漏的）的正確前階
 * 從官網重新抓回來。只印結果，不動 json。
 *
 * root cause：scraper .evolution 區塊在遇到「地區分身（洗翠/伽勒爾/阿羅拉）」
 * 或「同前階的不同 Stage1 分支（巨鉗螳螂/劈斧螳螂）」或「同 stage 不同物種
 * （呆呆王/呆殼獸）」時，會取到「旁邊的那張」而非真正的前階。
 * v2.76 修過 ex/GX 同名，但沒處理這些新類型。
 */

import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const DIR = '/tmp/ptcg-work/repo/static/cards';

// 12 張殘骸 + 基本資料
const cases = [
  { f:'M2a',  id:'14763', note:'火箭隊的烏鴉頭頭 (v2.71 strip <> 漏 evolvesFrom)' },
  { f:'SV7',  id:'10934', note:'呆呆王 (scraper 取錯，撈到分支呆殼獸)' },
  { f:'SV9',  id:'12519', note:'雙彈瓦斯 (scraper 撈到伽勒爾版)' },
  { f:'M3',   id:'17989', note:'狙射樹梟ex (scraper 撈到洗翠版)' },
  { f:'M3',   id:'18396', note:'狙射樹梟ex v2' },
  { f:'M3',   id:'17998', note:'超級寶石海星ex' },
  { f:'M3',   id:'18398', note:'超級寶石海星ex v2' },
  { f:'M3',   id:'18414', note:'超級寶石海星ex v3' },
  { f:'M4',   id:'18483', note:'超級毒藻龍ex' },
  { f:'MC',   id:'16963', note:'巨鉗螳螂ex (scraper 撈到同前階分支劈斧螳螂)' },
  { f:'SV5M', id:'9885',  note:'巨鉗螳螂ex v2' },
  { f:'SV5M', id:'10238', note:'巨鉗螳螂ex v3' },
];

// 載入卡池 name set 供驗證建議前階是否存在
const poolNames = new Set();
for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.json') && n !== 'index.json')) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon' && c.name) poolNames.add(c.name);
}

const stageMap = { '基礎': 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2' };

console.log('='.repeat(80));
for (const x of cases) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, x.f + '.json'), 'utf8'));
  const card = cards.find(c => c.id === x.id);
  console.log(`\n[${x.f} ${x.id}] ${card.name}`);
  console.log(`  note: ${x.note}`);
  console.log(`  current: evolvesFrom=「${card.evolvesFrom}」 stage=${card.stage}`);

  try {
    const resp = await fetch(card.sourceUrl);
    const html = await resp.text();
    const $ = load(html);

    // H1 stage
    const h1Text = $('h1').first().text().trim();
    const h1Lines = h1Text.split('\n').map(s => s.trim()).filter(Boolean);
    const officialStage = h1Lines.length >= 2 ? stageMap[h1Lines[0]] : null;

    // .evolution chain
    const evo = $('.evolution').first();
    let chain = [];
    if (evo.length) {
      chain = evo.find('a, span').map((_, el) => $(el).text().trim()).get()
        .filter(s => s && s.length > 0);
    }

    console.log(`  official stage: ${officialStage}`);
    console.log(`  官網進化鏈: [${chain.join(' → ')}]`);

    // 找 card.name 的 index，往前一格就是正確的前階（但要跳過同名 ex/GX 變體）
    const rawName = card.name;
    const strippedBase = rawName.replace(/ex$/, '').replace(/GX$/, '').trim();

    const idx = chain.findIndex(n => n === rawName);
    let suggested = null;
    if (idx > 0) {
      // 往前搜尋，跳過所有同名 base（e.g. 噴火龍/噴火龍ex/噴火龍GX）
      for (let i = idx - 1; i >= 0; i--) {
        const cleanName = chain[i].replace(/ex$/, '').replace(/GX$/, '').trim();
        if (cleanName !== strippedBase) {
          suggested = chain[i];
          break;
        }
      }
    }

    if (suggested) {
      const inPool = poolNames.has(suggested);
      const status = inPool ? '✓ 在卡池' : '✗ 不在卡池';
      console.log(`  suggested evolvesFrom: 「${suggested}」${status}`);
      if (suggested !== card.evolvesFrom) {
        console.log(`  → 需要修改 (${card.evolvesFrom} → ${suggested})`);
      } else {
        console.log(`  → 已是正確值（但前階不在卡池，需要另解）`);
      }
    } else {
      console.log(`  → 官網鏈無可用前階（可能是 Basic）`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }

  // 小延遲避免觸發官網 rate limit
  await new Promise(r => setTimeout(r, 500));
}
console.log('\n' + '='.repeat(80));
