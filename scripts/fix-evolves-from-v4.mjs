#!/usr/bin/env node
/**
 * v2.87 fix — 修正 12 張 evolvesFrom 殘骸（v2.76 大清查漏的）。
 *
 * 根因：scraper .evolution 區塊取 idx-1 在遇到「分支進化 / 地區分身 / Mega
 * 變體 / 同前階不同 Stage1 物種」時撈錯。官網鏈範例：
 *   呆呆獸 → 呆殼獸 → 呆呆王 → 呆呆王ex → 超級呆殼獸ex
 *           ^^ 這是分支，不是前階
 *
 * v2.77 修過 94 張 Mega ex 的類似問題，但這 12 張當時漏掉（不是純 Mega ex，
 * 或是新型分支樣態）。
 *
 * 所有修正值已從官網 .evolution + 卡池交叉驗證。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = '/tmp/ptcg-work/repo/static/cards';

// 12 張殘骸 → 正確前階（從官網 .evolution 鏈 + 卡池交叉驗證）
const fixes = [
  { f:'M2a',  id:'14763', name:'火箭隊的烏鴉頭頭',  from:'<火箭隊的>黑暗鴉', to:'火箭隊的黑暗鴉' },
  { f:'SV7',  id:'10934', name:'呆呆王',             from:'呆殼獸',            to:'呆呆獸' },
  { f:'SV9',  id:'12519', name:'雙彈瓦斯',           from:'伽勒爾 雙彈瓦斯',   to:'瓦斯彈' },
  { f:'M3',   id:'17989', name:'狙射樹梟ex',         from:'洗翠 狙射樹梟',     to:'投羽梟' },
  { f:'M3',   id:'18396', name:'狙射樹梟ex',         from:'洗翠 狙射樹梟',     to:'投羽梟' },
  { f:'M3',   id:'17998', name:'超級寶石海星ex',     from:'寶石海星',          to:'海星星' },
  { f:'M3',   id:'18398', name:'超級寶石海星ex',     from:'寶石海星',          to:'海星星' },
  { f:'M3',   id:'18414', name:'超級寶石海星ex',     from:'寶石海星',          to:'海星星' },
  { f:'M4',   id:'18483', name:'超級毒藻龍ex',       from:'毒藻龍',            to:'垃垃藻' },
  { f:'MC',   id:'16963', name:'巨鉗螳螂ex',         from:'劈斧螳螂',          to:'飛天螳螂' },
  { f:'SV5M', id:'9885',  name:'巨鉗螳螂ex',         from:'劈斧螳螂',          to:'飛天螳螂' },
  { f:'SV5M', id:'10238', name:'巨鉗螳螂ex',         from:'劈斧螳螂',          to:'飛天螳螂' },
];

// 載入卡池驗證 to 目標都在
const poolNames = new Set();
for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.json') && n !== 'index.json')) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon' && c.name) poolNames.add(c.name);
}

let ok = 0, skip = 0, missing = 0;
// Group by file to write once
const fileEdits = new Map();
for (const x of fixes) {
  if (!poolNames.has(x.to)) {
    console.error(`⚠ 「${x.to}」不在卡池！跳過 ${x.f} ${x.id} ${x.name}`);
    missing++;
    continue;
  }
  if (!fileEdits.has(x.f)) fileEdits.set(x.f, []);
  fileEdits.get(x.f).push(x);
}

for (const [f, edits] of fileEdits) {
  const full = path.join(DIR, f + '.json');
  const cards = JSON.parse(fs.readFileSync(full, 'utf8'));
  let changed = false;
  for (const x of edits) {
    const card = cards.find(c => c.id === x.id);
    if (!card) { console.warn(`  [${f} ${x.id}] not found, skip`); skip++; continue; }
    if (card.evolvesFrom !== x.from) {
      console.warn(`  [${f} ${x.id} ${card.name}] expected evolvesFrom='${x.from}' got='${card.evolvesFrom}', skip`);
      skip++;
      continue;
    }
    card.evolvesFrom = x.to;
    console.log(`✓ ${f} ${x.id} ${card.name}: 「${x.from}」→ 「${x.to}」`);
    changed = true;
    ok++;
  }
  if (changed) {
    fs.writeFileSync(full, JSON.stringify(cards, null, 2) + '\n', 'utf8');
  }
}

console.log(`\n總計 ${ok} 張修正，${skip} 張跳過，${missing} 張前階不在卡池`);
