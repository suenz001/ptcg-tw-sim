#!/usr/bin/env node
/**
 * v2.88 — 修復冠名寶可夢的 evolvesFrom。
 *
 * 根因：官網 `.evolution` 區塊對冠名寶可夢（小霞的寶石海星、火箭隊的拉達、
 * 青木的土龍節節ex 等）只列出該卡自己，沒有前階。例：
 *   h1: 1階進化|<小霞的>寶石海星
 *   .evolution: ["<小霞的>寶石海星"]
 * scraper 的 idx-1 找不到前階 → evolvesFrom 空著。
 *
 * 邏輯推導：{owner}的{base} Stage1+ 的前階 =
 *   1. {owner}的{base_prev}（如果同訓練家冠名前階在卡池）
 *   2. 否則 {base_prev}（普通版 fallback）
 * 其中 base_prev 來自卡池中同 base 的普通版（非冠名）的 evolvesFrom。
 *
 * Strip `<>` 統一命名規則（v2.71 定的，未 strip 的直接 strip）。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = '/tmp/ptcg-work/repo/static/cards';
const OWNERS = ['N','大吾','奇樹','小霞','派帕','火箭隊','瑪俐','竹蘭','莉佳','莉莉艾','赫普','阿響','青木'];
const OWNER_RE = new RegExp('^(' + OWNERS.join('|') + ')的');

// 載入所有 Pokemon
const allCards = [];
const files = fs.readdirSync(DIR).filter(n => n.endsWith('.json') && n !== 'index.json').sort();
for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) if (c.supertype === 'Pokemon' && c.name) allCards.push({ f, c });
}

const poolByName = new Map();
for (const { c } of allCards) {
  if (!poolByName.has(c.name)) poolByName.set(c.name, []);
  poolByName.get(c.name).push(c);
}

// Step 1: 建「普通版 base 名 → evolvesFrom」mapping（用於推導冠名前階的 base）
// 只看 supertype=Pokemon、非冠名（不符合 OWNER_RE）、有 evolvesFrom 的卡
const basePrevMap = new Map(); // base_name (strip ex) → base_prev
for (const { c } of allCards) {
  if (OWNER_RE.test(c.name)) continue;
  if (!c.evolvesFrom) continue;
  const baseName = c.name.replace(/ex$/, '');
  // 取第一個為主（同一物種多卡 evolvesFrom 一致）
  if (!basePrevMap.has(baseName)) basePrevMap.set(baseName, c.evolvesFrom);
  if (!basePrevMap.has(c.name)) basePrevMap.set(c.name, c.evolvesFrom);
}

// Step 2: 對每張 evolvesFrom 為空的冠名寶可夢推導前階
const fixes = []; // [{file, id, name, evoTo}]
const unresolved = [];

for (const { f, c } of allCards) {
  if (!OWNER_RE.test(c.name)) continue;
  if (c.evolvesFrom) {
    // 即便有 evolvesFrom，也確認它：(1) 不帶 <>；(2) 若有同訓練家冠名前階則用冠名版
    // 但目前 audit 顯示 72 張都 OK，這邊 passthrough
    continue;
  }
  if (c.stage === 'Basic' || c.subtype === 'Basic') continue;

  const m = c.name.match(OWNER_RE);
  const owner = m[1];
  const brandlessName = c.name.replace(OWNER_RE + '.的', '').replace(OWNER_RE, '').slice(owner.length + 1); // e.g. '小霞的寶石海星' → '寶石海星'
  // 更簡單的 strip
  const brandless = c.name.slice(owner.length + 1); // 「XXX的」3 字元

  // 查普通版的 evolvesFrom
  let basePrev = basePrevMap.get(brandless);
  if (!basePrev) {
    // 試 strip ex
    basePrev = basePrevMap.get(brandless.replace(/ex$/, ''));
  }

  if (!basePrev) {
    unresolved.push({ f, id:c.id, name:c.name, stage:c.stage, brandless });
    continue;
  }

  // 去 <>（防守）
  const cleanBasePrev = basePrev.replace(/[<>]/g, '');
  // 優先用同訓練家冠名前階
  const brandedPrev = owner + '的' + cleanBasePrev;
  let evoTo;
  if (poolByName.has(brandedPrev)) {
    evoTo = brandedPrev;
  } else if (poolByName.has(cleanBasePrev)) {
    evoTo = cleanBasePrev;
  } else {
    unresolved.push({ f, id:c.id, name:c.name, stage:c.stage, brandless, suggested: brandedPrev, note:'冠名+普通前階都不在卡池' });
    continue;
  }

  fixes.push({ f, id:c.id, name:c.name, evoTo });
}

// Step 3: 另外掃「現有 evolvesFrom 仍帶 <>」的情況（strip 漏的）
const stripFixes = [];
for (const { f, c } of allCards) {
  if (c.evolvesFrom && (c.evolvesFrom.includes('<') || c.evolvesFrom.includes('>'))) {
    stripFixes.push({ f, id:c.id, name:c.name, evoTo: c.evolvesFrom.replace(/[<>]/g, '') });
  }
}

console.log('=== 建議修正 ===');
console.log('冠名寶可夢補 evolvesFrom:', fixes.length);
for (const x of fixes) console.log(`  ${x.f} ${x.id} ${x.name} → evolvesFrom = 「${x.evoTo}」`);
console.log('\nStrip <> from evolvesFrom:', stripFixes.length);
for (const x of stripFixes) console.log(`  ${x.f} ${x.id} ${x.name} → strip → 「${x.evoTo}」`);
console.log('\n無法推導:', unresolved.length);
for (const x of unresolved) console.log(`  ${x.f} ${x.id} ${x.name} brandless=「${x.brandless}」 ${x.note || ''}`);

// 執行修正（寫 json）
if (process.argv.includes('--apply')) {
  const fileEdits = new Map();
  for (const x of [...fixes, ...stripFixes]) {
    if (!fileEdits.has(x.f)) fileEdits.set(x.f, new Map());
    fileEdits.get(x.f).set(x.id, x.evoTo);
  }
  for (const [f, idMap] of fileEdits) {
    const full = path.join(DIR, f);
    const cards = JSON.parse(fs.readFileSync(full, 'utf8'));
    let changed = 0;
    for (const card of cards) {
      if (idMap.has(card.id)) {
        card.evolvesFrom = idMap.get(card.id);
        changed++;
      }
    }
    if (changed > 0) {
      fs.writeFileSync(full, JSON.stringify(cards, null, 2) + '\n', 'utf8');
      console.log(`  ✓ ${f}: ${changed} 張修正`);
    }
  }
  console.log(`\n總計 ${fixes.length + stripFixes.length} 張修正寫回 JSON`);
} else {
  console.log('\n(dry-run) 加 --apply 執行寫回');
}
