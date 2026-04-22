#!/usr/bin/env node
/**
 * v2.35 — 批修 scraper 誤寫的 evolvesFrom 欄位
 *
 * 規則來源：Leon 確認 PTCG「ex/非 ex 同階」+「多分支進化」，故下列家族的
 * evolvesFrom 應為特定 Basic/Stage1，而非同階的其他 ex/非 ex 卡名。
 *
 * 用法：node scripts/fix-evolution-data.mjs
 * 結束後會列出修了哪幾張卡，方便對照 git diff。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CARDS_DIR = 'static/cards';

// key = 寶可夢名（含角括號 <> 的前綴訓練家形式原樣保留）
// value = 正確的 evolvesFrom（可為 null 代表直接清空，但此檔全都是指向 Basic）
// 「多個版本的同名卡」一律套同一個 evolvesFrom。
const FIXES = {
  // === 伊布 8 兄弟（全部 Stage1 from 伊布，包含 ex 版）===
  '火伊布': '伊布',
  '火伊布ex': '伊布',
  '水伊布': '伊布',
  '水伊布ex': '伊布',
  '雷伊布': '伊布',
  '雷伊布ex': '伊布',
  '冰伊布': '伊布',
  '冰伊布ex': '伊布',
  '月亮伊布': '伊布',
  '月亮伊布ex': '伊布',
  '太陽伊布': '伊布',
  '太陽伊布ex': '伊布',
  '葉伊布': '伊布',
  '葉伊布ex': '伊布',
  '仙子伊布': '伊布',
  '仙子伊布ex': '伊布',

  // === 炭小侍分支 ===
  '蒼炎刃鬼': '炭小侍',        // Stage1，從炭小侍（非經紅蓮鎧騎）
  '蒼炎刃鬼ex': '炭小侍',
  '紅蓮鎧騎': '炭小侍',        // 保持原本正確
  '紅蓮鎧騎ex': '炭小侍',       // 原本寫成「蒼炎刃鬼」，修正

  // === 盾甲繭（刺尾蟲分支，v2.35 memo）===
  '盾甲繭': '刺尾蟲',
  '盾甲繭ex': '刺尾蟲',

  // === 啃果蟲分支（蘋裹龍 / 豐蜜龍 / 裹蜜蟲 全部直接從啃果蟲）===
  '蘋裹龍': '啃果蟲',          // 保持原本正確
  '豐蜜龍': '啃果蟲',          // 原本寫「蘋裹龍」，修
  '裹蜜蟲': '啃果蟲',          // 原本寫「豐蜜龍」，修
  '裹蜜蟲ex': '啃果蟲',

  // === 火箭隊的大嘴蝠線 ===
  '火箭隊的大嘴蝠': '火箭隊的超音蝠',        // self-ref 修
  '<火箭隊的>大嘴蝠': '火箭隊的超音蝠',
  '火箭隊的叉字蝠ex': '火箭隊的大嘴蝠',       // Stage2，從大嘴蝠
  '<火箭隊的>叉字蝠ex': '火箭隊的大嘴蝠',

  // === 奇樹 3 張 self-ref ===
  '奇樹的頑皮雷彈': '奇樹的霹靂電球',
  '<奇樹的>頑皮雷彈': '奇樹的霹靂電球',
  '奇樹的大電海燕': '奇樹的電海燕',
  '<奇樹的>大電海燕': '奇樹的電海燕',
  '奇樹的電肚蛙ex': '奇樹的光蚪仔',
  '<奇樹的>電肚蛙ex': '奇樹的光蚪仔',

  // === 莉莉艾的蝶結萌虻 ===
  '莉莉艾的蝶結萌虻': '莉莉艾的萌虻',
  '<莉莉艾的>蝶結萌虻': '莉莉艾的萌虻',

  // === N的索羅亞克ex ===
  'N的索羅亞克ex': 'N的索羅亞',
  '<N的>索羅亞克ex': 'N的索羅亞',

  // === 赫普的鋼鎧鴉 / 藍鴉 ===
  '赫普的鋼鎧鴉': '赫普的藍鴉',          // Stage2 self-ref → 正確 Stage1
  '<赫普的>鋼鎧鴉': '赫普的藍鴉',
  '赫普的藍鴉': '赫普的稚山雀',          // MC 那張 evolvesFrom='鋼鎧鴉'（倒寫）；SV9 本來就對
  '<赫普的>藍鴉': '赫普的稚山雀',

  // === v2.35 稍早已手動修的土龍節節ex 也收進來保險（MC 17046 / SV9 12541 / SV9 12646）===
  '土龍節節': '土龍弟弟',
  '土龍節節ex': '土龍弟弟',
};

// strip <>，用 cleaned 做 lookup；但 FIXES key 兩種形式都列了，保留嚴格比對
const stripBrackets = (s) => (s || '').replace(/[<>]/g, '');

let totalFiles = 0;
let totalFixed = 0;
const changes = [];

for (const fname of readdirSync(CARDS_DIR).sort()) {
  if (!fname.endsWith('.json')) continue;
  const path = join(CARDS_DIR, fname);
  const raw = readFileSync(path, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch { continue; }
  if (!Array.isArray(data)) continue;

  let fileFixed = 0;
  for (const card of data) {
    if (card.supertype !== 'Pokemon') continue;
    const name = card.name;
    const nameKey = stripBrackets(name);
    // 查兩個版本的 FIXES（含括號、去括號）
    const want = FIXES[name] ?? FIXES[nameKey];
    if (!want) continue;
    if (card.evolvesFrom === want) continue; // 已正確
    changes.push({
      file: fname,
      cardId: card.cardId,
      name,
      before: card.evolvesFrom,
      after: want,
    });
    card.evolvesFrom = want;
    fileFixed++;
    totalFixed++;
  }
  if (fileFixed > 0) {
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
    totalFiles++;
  }
}

console.log(`Fixed ${totalFixed} card records across ${totalFiles} JSON files.`);
for (const c of changes) {
  console.log(`  [${c.file}] ${c.cardId} ${c.name}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
}
