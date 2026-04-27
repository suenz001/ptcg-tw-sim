#!/usr/bin/env node
/**
 * v2.215 — 全 preset 牌組實裝健康度檢查
 *
 * 對 src/lib/decks/presets.ts 中每組牌組：
 *   1. 解析 cardId 到卡名
 *   2. 對每張寶可夢卡，檢查 abilities[].name 和 attacks[].name 是否在 effects 內登錄
 *   3. 對每張 Trainer 卡，檢查名稱是否在 effects 內登錄
 *   4. 列出未實裝的卡名（去重 across decks）
 *
 * 用法：node scripts/audit-all-preset-effects.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

// ── 1. 載入卡池 ───────────────────────────────────────────────────────────────
const pool = new Map();
const cardsDir = 'static/cards';
for (const f of fs.readdirSync(cardsDir).filter(f => f.endsWith('.json') && f !== 'index.json')) {
  const arr = JSON.parse(fs.readFileSync(path.join(cardsDir, f), 'utf8'));
  for (const c of arr) {
    // 同名卡可能在多個 set，第一個取勝
    const cleaned = (c.name || '').replace(/[<>＜＞‌]/g, '');
    if (!pool.has(c.id)) pool.set(c.id, { ...c, name: cleaned });
  }
}

// ── 2. 載入實作 source ────────────────────────────────────────────────────────
function readAll(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readAll(p, out);
    else if (e.name.endsWith('.ts')) out.push(fs.readFileSync(p, 'utf8'));
  }
  return out;
}
const src = readAll('src/lib/game').join('\n----\n');

// ── 3. 解析 presets.ts 取出所有 preset 牌組 ─────────────────────────────────
const presetSrc = fs.readFileSync('src/lib/decks/presets.ts', 'utf8');
// 每組以 `name: '...'` 開頭，cards 區塊用 `{ cardId: '...', count: N }` 列出
// 結構粗略：{ name: '...', cards: [ { cardId: '...', count: N }, ... ] }
const presetRegex = /name:\s*'([^']+)'[\s\S]*?entries:\s*\[([\s\S]*?)\n\s*\]/g;
const cardEntryRegex = /cardId:\s*'([^']+)'/g;

const presets = [];
let m;
while ((m = presetRegex.exec(presetSrc)) !== null) {
  const name = m[1];
  const cardsBlock = m[2];
  const cardIds = [];
  let cm;
  while ((cm = cardEntryRegex.exec(cardsBlock)) !== null) {
    cardIds.push(cm[1]);
  }
  presets.push({ name, cardIds });
}

// ── 4. 對每個 preset 檢查 ─────────────────────────────────────────────────────
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function checkAbilityImpl(cardName, abilityName) {
  // 1. 直接 key match： '卡名|特性名'
  if (new RegExp(`['"\`]${esc(cardName)}\\|${esc(abilityName)}['"\`]`).test(src)) return true;
  // 2. legacy regA('卡名', index, ...)
  if (new RegExp(`reg(?:A|G)\\s*\\(\\s*['"\`]${esc(cardName)}['"\`]\\s*,\\s*\\d+`).test(src)) return true;
  // 3. inline a.name === '特性名'
  if (new RegExp(`\\.name\\s*===\\s*['"\`]${esc(abilityName)}['"\`]`).test(src)) return true;
  if (new RegExp(`\\.name\\s*\\?\\.\\s*startsWith\\s*\\(\\s*['"\`]${esc(abilityName)}['"\`]`).test(src)) return true;
  // 4. 特性名以 ｜（fullwidth pipe）隔開的 comment：'喵喵ex｜殺手鐧捕捉'
  if (new RegExp(`${esc(cardName)}｜${esc(abilityName)}`).test(src)) return true;
  // 5. 卡名+特性名都單獨出現
  const hasCardName = new RegExp(`['"\`]${esc(cardName)}['"\`]`).test(src);
  const hasAbName = new RegExp(`['"\`]${esc(abilityName)}['"\`]`).test(src);
  if (hasCardName && hasAbName) return true;
  return false;
}

function checkAttackImpl(cardName, attackName) {
  // 招式效果通常是 '卡名|招式名' key；某些用 attack.name 直接 inline 比對
  const patterns = [
    new RegExp(`['"\`]${esc(cardName)}\\|${esc(attackName)}['"\`]`),
    new RegExp(`reg(?:Pre|Post)\\s*\\(\\s*['"\`]${esc(cardName)}\\|${esc(attackName)}['"\`]`),
    new RegExp(`ATTACK_(?:PRE|POST)\\.set\\s*\\(\\s*['"\`]${esc(cardName)}\\|${esc(attackName)}['"\`]`),
    // 招式名 inline 比對（暗黑底牌等 copy-attack pattern）
    new RegExp(`atk\\.name\\s*===\\s*['"\`]${esc(attackName)}['"\`]`),
    new RegExp(`attack\\.name\\s*===\\s*['"\`]${esc(attackName)}['"\`]`),
  ];
  return patterns.some(p => p.test(src));
}

function checkTrainerImpl(name) {
  // 訓練家：reg('名稱') 或 TRAINER_EFFECTS.set('名稱')
  const patterns = [
    new RegExp(`reg\\s*\\(\\s*['"\`]${esc(name)}['"\`]`),
    new RegExp(`TRAINER_EFFECTS\\.set\\s*\\(\\s*['"\`]${esc(name)}['"\`]`),
    new RegExp(`['"\`]${esc(name)}['"\`]`),  // 至少卡名字串存在
  ];
  return patterns.some(p => p.test(src));
}

// 排除沒實際 effect 的東西
const SKIP_ATTACK_EFFECTS = new Set(['', '—']);
const TRAINER_NEEDS_EFFECT = (card) =>
  card.supertype === 'Trainer' && (card.subtype === 'Item' || card.subtype === 'Supporter' || card.subtype === 'Stadium');

const totalUnimpl = new Map();  // name → first preset hit

for (const preset of presets) {
  const missing = [];
  const seen = new Set();
  for (const cid of preset.cardIds) {
    const c = pool.get(cid);
    if (!c) continue;
    // 寶可夢卡：abilities + attacks
    if (c.supertype === 'Pokemon') {
      for (const ab of c.abilities || []) {
        if (!ab.effect || ab.effect.length < 5) continue;
        const key = `${c.name}｜特性 ${ab.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!checkAbilityImpl(c.name, ab.name)) {
          missing.push(key);
          if (!totalUnimpl.has(key)) totalUnimpl.set(key, preset.name);
        }
      }
      for (const atk of c.attacks || []) {
        if (!atk.effect || atk.effect.length < 5) continue;
        const key = `${c.name}｜招式 ${atk.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!checkAttackImpl(c.name, atk.name)) {
          missing.push(key);
          if (!totalUnimpl.has(key)) totalUnimpl.set(key, preset.name);
        }
      }
    } else if (TRAINER_NEEDS_EFFECT(c)) {
      const key = `${c.name}（${c.subtype}）`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!checkTrainerImpl(c.name)) {
        missing.push(key);
        if (!totalUnimpl.has(key)) totalUnimpl.set(key, preset.name);
      }
    } else if (c.supertype === 'Trainer' && c.subtype === 'PokemonTool') {
      const key = `${c.name}（PokemonTool）`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!checkTrainerImpl(c.name)) {
        missing.push(key);
        if (!totalUnimpl.has(key)) totalUnimpl.set(key, preset.name);
      }
    }
  }
  if (missing.length === 0) {
    console.log(`✓ ${preset.name}：全部實裝（${preset.cardIds.length} cards）`);
  } else {
    console.log(`✗ ${preset.name}：${missing.length} 項未實裝`);
    for (const k of missing) console.log(`    - ${k}`);
  }
}

console.log('\n═══ 跨 preset 唯一未實裝清單 ═══');
console.log(`總計：${totalUnimpl.size} 項`);
const grouped = {};
for (const [key, firstPreset] of totalUnimpl) {
  const m = key.match(/^.*?[（｜]([^（｜]+)/);
  const cat = key.includes('特性') ? '特性' : key.includes('招式') ? '招式' : 'Trainer';
  if (!grouped[cat]) grouped[cat] = [];
  grouped[cat].push({ key, firstPreset });
}
for (const cat of ['Trainer', '特性', '招式']) {
  if (!grouped[cat]) continue;
  console.log(`\n[${cat}]（${grouped[cat].length} 項）`);
  for (const { key, firstPreset } of grouped[cat]) {
    console.log(`  ${key}  — 首見於：${firstPreset}`);
  }
}
