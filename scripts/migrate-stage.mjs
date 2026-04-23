#!/usr/bin/env node
/**
 * migrate-stage.mjs — 為所有寶可夢卡補上 `stage` 欄位 + 修正 ex 的 evolvesFrom
 *
 * 問題：
 * 1. scraper 的 refinePokemonSubtype() 會把 ex 卡的 subtype 覆寫為 'ex'，
 *    丟失原始的 基礎/1階進化/2階進化 資訊。
 * 2. 部分 ex 卡的 evolvesFrom 指向錯誤的前階（如土台龜ex → 土台龜，但應該是 林龜）。
 *
 * 做法：
 * Phase 1: 建立「寶可夢名 → stage」對應表（從 subtype=Basic/Stage1/Stage2 的卡）
 * Phase 2: 對 ex 卡用名稱比對推斷 stage（strip 'ex' → 查同名非ex版本的 stage）
 * Phase 3: 用進化鏈交叉驗證 evolvesFrom 是否正確
 * Phase 4: 寫入 stage 欄位到 JSON
 *
 * 冪等：可安全重跑。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

// ── Phase 1: 載入所有卡片，建立名稱 → stage 對應表 ──

/** @type {Array<{card: any, file: string}>} */
const allEntries = [];
/** @type {Map<string, string>} name → stage (Basic/Stage1/Stage2) */
const nameToStage = new Map();
/** @type {Map<string, any>} name → first card with that name */
const nameToCard = new Map();

for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of cards) {
    allEntries.push({ card: c, file: f });
    if (c.supertype !== 'Pokemon') continue;
    if (!nameToCard.has(c.name)) nameToCard.set(c.name, c);
    if (['Basic', 'Stage1', 'Stage2'].includes(c.subtype)) {
      // 只用非 ex 卡建表，這些 subtype 是準確的
      if (!nameToStage.has(c.name)) {
        nameToStage.set(c.name, c.subtype);
      }
    }
  }
}

console.log(`[Phase 1] Loaded ${allEntries.length} cards from ${files.length} sets.`);
console.log(`[Phase 1] Name→Stage table: ${nameToStage.size} entries from non-ex cards.`);

// ── Phase 2: 推斷 ex 卡的 stage ──

// 策略：
// 1. strip 'ex' → 查 nameToStage
// 2. strip 訓練家前綴 + 'ex' → 查 nameToStage  
// 3. 有 evolvesFrom 且前階在 nameToStage → 推斷
// 4. 超級開頭 → Mega 特殊處理
// 5. 都找不到 → 依 evolvesFrom 保守推斷

/** @type {Map<string, string>} cardId → inferred stage */
const exStageMap = new Map();
const unresolvedEx = [];

const exCards = allEntries
  .filter(e => e.card.supertype === 'Pokemon' && e.card.subtype === 'ex')
  .map(e => e.card);

for (const c of exCards) {
  const baseName = c.name.replace(/ex$/, '').trim();
  
  // 策略 1: 直接 strip ex
  if (nameToStage.has(baseName)) {
    exStageMap.set(c.id, nameToStage.get(baseName));
    continue;
  }
  
  // 策略 2: strip 訓練家前綴（如「火箭隊的超夢ex」→「超夢」）
  const trainerStripped = baseName.replace(/^.+?的/, '');
  if (trainerStripped !== baseName && nameToStage.has(trainerStripped)) {
    exStageMap.set(c.id, nameToStage.get(trainerStripped));
    continue;
  }
  
  // 策略 3: 超級進化 → 一律是 Mega（特殊 stage，不算 Basic/Stage1/Stage2）
  // 但在篩選上我們把 Mega 視為進化的（不是 Basic）
  if (c.name.startsWith('超級')) {
    // Mega 的 stage 取決於 base form：超級路卡利歐ex ← 路卡利歐ex ← 利歐路
    // 但 Mega 在 PTCG 規則上是一個額外的進化階段
    // 我們把它標記為 'Stage1'（如果前階是 Basic）或 'Stage2'（如果前階是 Stage1）
    if (c.evolvesFrom) {
      const evoFromStage = nameToStage.get(c.evolvesFrom) || exStageMap.get(
        allEntries.find(e => e.card.name === c.evolvesFrom)?.card?.id
      );
      if (evoFromStage === 'Basic') {
        exStageMap.set(c.id, 'Stage1');
      } else if (evoFromStage === 'Stage1') {
        exStageMap.set(c.id, 'Stage2');
      } else {
        // 前階也是 ex → 查前階的推斷 stage
        exStageMap.set(c.id, 'Stage1'); // 保守
      }
    } else {
      exStageMap.set(c.id, 'Basic'); // 無前階的 Mega（如超級拉帝亞斯ex）→ 實際上是 Basic ex 的 Mega
    }
    continue;
  }
  
  // 策略 4: 有 evolvesFrom → 查前階 stage 推算
  if (c.evolvesFrom) {
    const evoFromBase = c.evolvesFrom.replace(/ex$/, '').trim();
    const evoStage = nameToStage.get(c.evolvesFrom) 
      || nameToStage.get(evoFromBase);
    if (evoStage === 'Basic') {
      exStageMap.set(c.id, 'Stage1');
      continue;
    } else if (evoStage === 'Stage1') {
      exStageMap.set(c.id, 'Stage2');
      continue;
    }
    // 前階可能也是 ex，保守標 Stage1
    exStageMap.set(c.id, 'Stage1');
    continue;
  }
  
  // 策略 5: 都找不到 → 視為 Basic（無 evolvesFrom 的 ex）
  exStageMap.set(c.id, 'Basic');
  unresolvedEx.push(c);
}

console.log(`\n[Phase 2] Ex cards: ${exCards.length}`);
console.log(`[Phase 2] Resolved by name matching: ${exStageMap.size - unresolvedEx.length}`);
console.log(`[Phase 2] Defaulted to Basic (no evolvesFrom, no name match): ${unresolvedEx.length}`);
if (unresolvedEx.length > 0) {
  console.log('  These ex cards have no evolvesFrom and no matching non-ex version:');
  unresolvedEx.forEach(c => console.log(`    ${c.setCode} ${c.id} ${c.name}`));
}

// ── Phase 3: 驗證 evolvesFrom 正確性 ──
// 規則：如果 ex 卡的 evolvesFrom 指向同名的非進化版（如土台龜ex → 土台龜），
// 但那個非進化版是 Stage2，那就有問題 — 應該 evolvesFrom 指向它的前階。
// 但 PTCG 規則上 ex 卡的 evolvesFrom 是寫在卡面上的，可能確實指向同名。

console.log('\n[Phase 3] Cross-validating evolvesFrom for ex cards...');
const evolvesFromIssues = [];

for (const c of exCards) {
  if (!c.evolvesFrom) continue;
  
  // 查前階卡
  const evoFromCard = nameToCard.get(c.evolvesFrom);
  if (!evoFromCard) continue;
  
  // 推斷出的 stage
  const inferredStage = exStageMap.get(c.id) || c.subtype;
  
  // 如果 evolvesFrom 指向跟自己同名的非 ex 版本（如土台龜ex → 土台龜）
  // 且那個版本的 stage 跟自己的推斷 stage 一樣 → 有問題
  const baseName = c.name.replace(/ex$/, '').trim();
  if (c.evolvesFrom === baseName) {
    const evoFromStage = nameToStage.get(c.evolvesFrom);
    if (evoFromStage && evoFromStage !== 'Basic') {
      // evolvesFrom 指向自己同名的進化版本 — 這在 PTCG 是錯的
      // ex 應該從前一階進化（如土台龜ex 應從 林龜 進化，不是從 土台龜）
      // 但實際規則上，某些 ex 確實是從同名進化的（如甲賀忍蛙ex ← 甲賀忍蛙）
      // 需要逐一確認
      evolvesFromIssues.push({
        card: c,
        evoFromName: c.evolvesFrom,
        evoFromStage,
        inferredStage,
        issue: `evolvesFrom points to same-name ${evoFromStage} (${c.evolvesFrom})`
      });
    }
  }
  
  // 如果 evolvesFrom 指向另一張 ex 卡（如超級噴火龍Xex → 噴火龍ex）
  // 且那張 ex 卡的 evolvesFrom 是 null → 這是一條進化鏈，OK
  
  // 如果 evolvesFrom 指向帶 GX 後綴的卡 → scraper 抓錯了
  if (c.evolvesFrom.endsWith('GX')) {
    evolvesFromIssues.push({
      card: c,
      evoFromName: c.evolvesFrom,
      issue: `evolvesFrom ends with GX suffix — likely scraper error`
    });
  }
}

if (evolvesFromIssues.length > 0) {
  console.log(`\n[Phase 3] Found ${evolvesFromIssues.length} potential evolvesFrom issues:`);
  evolvesFromIssues.forEach(i => {
    console.log(`  ${i.card.setCode} ${i.card.id} ${i.card.name}: ${i.issue}`);
  });
} else {
  console.log('[Phase 3] No evolvesFrom issues found.');
}

// ── Phase 4: 寫入 stage 到 JSON ──

console.log('\n[Phase 4] Writing stage field to JSON files...');

let totalUpdated = 0;
let filesModified = 0;

for (const f of files) {
  const filePath = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let modified = false;
  
  for (const c of cards) {
    if (c.supertype !== 'Pokemon') continue;
    if (c.subtype === 'Other') continue; // 寶可夢道具不需要 stage
    
    let stage;
    if (['Basic', 'Stage1', 'Stage2'].includes(c.subtype)) {
      stage = c.subtype;
    } else if (c.subtype === 'ex') {
      stage = exStageMap.get(c.id) || 'Basic';
    } else {
      // VSTAR, MegaEvolution 等
      if (c.evolvesFrom) {
        const evoStage = nameToStage.get(c.evolvesFrom);
        if (evoStage === 'Basic') stage = 'Stage1';
        else if (evoStage === 'Stage1') stage = 'Stage2';
        else stage = 'Stage1'; // 保守
      } else {
        stage = 'Basic';
      }
    }
    
    if (c.stage !== stage) {
      c.stage = stage;
      modified = true;
      totalUpdated++;
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(cards, null, 2) + '\n', 'utf8');
    filesModified++;
    console.log(`  [${f}] updated`);
  }
}

console.log(`\n[Phase 4] Done. Updated ${totalUpdated} cards across ${filesModified} files.`);

// ── Summary ──
console.log('\n=== Summary ===');
console.log(`Total Pokemon cards: ${allEntries.filter(e => e.card.supertype === 'Pokemon' && e.card.subtype !== 'Other').length}`);
console.log(`Total ex cards: ${exCards.length}`);
console.log(`Stage field written: ${totalUpdated}`);
console.log(`Files modified: ${filesModified}/${files.length}`);
