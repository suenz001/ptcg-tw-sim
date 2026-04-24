#!/usr/bin/env node
/**
 * v2.88 part 2 — 補修剩餘 30 張冠名寶可夢的 evolvesFrom。
 * v1 腳本的自動推導卡在「普通版寶可夢不在卡池 or 沒 evolvesFrom」這個邊界情況
 * （e.g. 尼多蘭、姆克兒、煤炭龜 — 普通版沒有 TCG 卡，但冠名版在卡池）。
 * 這份 hardcoded 對照表全部從卡池名稱 cross-reference 得到，不是猜。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = '/tmp/ptcg-work/repo/static/cards';

const fixes = [
  // 莉佳 — 兩條分支從 走路草 開始
  { f:'MC.json',   id:'16478', name:'莉佳的口呆花',     evoTo:'莉佳的走路草' },
  { f:'MC.json',   id:'16479', name:'莉佳的大食花',     evoTo:'莉佳的臭臭花' },
  // 小霞系
  { f:'MC.json',   id:'16627', name:'小霞的寶石海星',   evoTo:'小霞的海星星' },
  { f:'MC.json',   id:'16629', name:'小霞的暴鯉龍',     evoTo:'小霞的鯉魚王' },
  { f:'SV9a.json', id:'12682', name:'小霞的寶石海星',   evoTo:'小霞的海星星' },
  { f:'SV9a.json', id:'12684', name:'小霞的暴鯉龍',     evoTo:'小霞的鯉魚王' },
  // 火箭隊的尼多系（兩條分支：雌尼多蘭→尼多娜→尼多后；雄尼多朗→尼多力諾→尼多王）
  { f:'MC.json',   id:'16904', name:'火箭隊的尼多娜',   evoTo:'火箭隊的尼多蘭' },
  { f:'MC.json',   id:'16905', name:'火箭隊的尼多后',   evoTo:'火箭隊的尼多娜' },
  { f:'MC.json',   id:'16907', name:'火箭隊的尼多力諾', evoTo:'火箭隊的尼多朗' },
  { f:'MC.json',   id:'16908', name:'火箭隊的尼多王ex', evoTo:'火箭隊的尼多力諾' },
  { f:'SV10.json', id:'12809', name:'火箭隊的尼多娜',   evoTo:'火箭隊的尼多蘭' },
  { f:'SV10.json', id:'12810', name:'火箭隊的尼多后',   evoTo:'火箭隊的尼多娜' },
  { f:'SV10.json', id:'12812', name:'火箭隊的尼多力諾', evoTo:'火箭隊的尼多朗' },
  { f:'SV10.json', id:'12813', name:'火箭隊的尼多王ex', evoTo:'火箭隊的尼多力諾' },
  { f:'SV10.json', id:'12921', name:'火箭隊的尼多王ex', evoTo:'火箭隊的尼多力諾' },
  { f:'SV10.json', id:'12931', name:'火箭隊的尼多王ex', evoTo:'火箭隊的尼多力諾' },
  // 青木的姆克系
  { f:'MC.json',   id:'17062', name:'青木的姆克鳥',     evoTo:'青木的姆克兒' },
  { f:'MC.json',   id:'17063', name:'青木的姆克鷹',     evoTo:'青木的姆克鳥' },
  { f:'MC.json',   id:'18347', name:'青木的姆克鷹',     evoTo:'青木的姆克鳥' },
  // 火箭隊的天罩蟲系 (蟲寶包→天罩蟲→以歐路普)
  // 卡池沒有「火箭隊的蟲寶包」，用普通版「蟲寶包」fallback
  { f:'SV10.json', id:'12793', name:'火箭隊的天罩蟲',   evoTo:'蟲寶包' },
  { f:'SV10.json', id:'12794', name:'火箭隊的以歐路普', evoTo:'火箭隊的天罩蟲' },
  { f:'SV10.json', id:'12909', name:'火箭隊的以歐路普', evoTo:'火箭隊的天罩蟲' },
  // 火箭隊的臭臭泥 (臭泥→臭臭泥)
  { f:'SV10.json', id:'12818', name:'火箭隊的臭臭泥',   evoTo:'火箭隊的臭泥' },
  // 火箭隊的多邊獸系 (多邊獸→多邊獸Ⅱ→多邊獸Ｚ)
  { f:'SV10.json', id:'12832', name:'火箭隊的多邊獸Ⅱ', evoTo:'火箭隊的多邊獸' },
  { f:'SV10.json', id:'12833', name:'火箭隊的多邊獸Ｚ', evoTo:'火箭隊的多邊獸Ⅱ' },
  // 阿響的火爆獸系 (煤炭龜→火岩鼠→火爆獸)
  // 卡池沒有「阿響的煤炭龜」，用普通版「煤炭龜」fallback
  { f:'SV9a.json', id:'12674', name:'阿響的火岩鼠',     evoTo:'煤炭龜' },
  { f:'SV9a.json', id:'12675', name:'阿響的火爆獸',     evoTo:'阿響的火岩鼠' },
  { f:'SV9a.json', id:'12728', name:'阿響的火爆獸',     evoTo:'阿響的火岩鼠' },
  // 派帕的藏飽栗鼠 (貪心栗鼠→藏飽栗鼠)
  { f:'SV9a.json', id:'12713', name:'派帕的藏飽栗鼠',   evoTo:'派帕的貪心栗鼠' },
  { f:'SV9a.json', id:'12733', name:'派帕的藏飽栗鼠',   evoTo:'派帕的貪心栗鼠' },
];

// 驗證所有 evoTo 確實在卡池
const pool = new Set();
for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.json') && n !== 'index.json')) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon' && c.name) pool.add(c.name);
}

console.log('=== 驗證前階都在卡池 ===');
let missing = 0;
for (const x of fixes) {
  if (!pool.has(x.evoTo)) {
    console.error(`⚠  ${x.name} 前階「${x.evoTo}」不在卡池`);
    missing++;
  }
}
if (missing > 0) {
  console.error(`\n${missing} 張前階缺失，停止`);
  process.exit(1);
}
console.log(`✓ 全部 ${fixes.length} 張前階都在卡池`);

// 執行寫回
const fileEdits = new Map();
for (const x of fixes) {
  if (!fileEdits.has(x.f)) fileEdits.set(x.f, new Map());
  fileEdits.get(x.f).set(x.id, x.evoTo);
}

for (const [f, idMap] of fileEdits) {
  const full = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(full, 'utf8'));
  let changed = 0;
  for (const card of cards) {
    if (idMap.has(card.id)) {
      if (card.evolvesFrom) {
        console.warn(`  ⚠ ${f} ${card.id} ${card.name} 已有 evolvesFrom=${card.evolvesFrom}, 跳過`);
        continue;
      }
      card.evolvesFrom = idMap.get(card.id);
      changed++;
    }
  }
  if (changed > 0) {
    fs.writeFileSync(full, JSON.stringify(cards, null, 2) + '\n', 'utf8');
    console.log(`  ✓ ${f}: ${changed} 張修正`);
  }
}
console.log(`\n總計 ${fixes.length} 張修正寫回`);
