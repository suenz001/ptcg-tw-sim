#!/usr/bin/env node
/**
 * v2.217 — 全寶可夢卡（3161 張）特性 + 招式實裝健康度檢查
 *
 * 對 static/cards 中所有 supertype === 'Pokemon' 的卡：
 *   1. 對每個有效果的 abilities[] / attacks[]，dedup by (cardName, name)
 *   2. 用多種 pattern 偵測是否在 effects/engine 中有實裝
 *   3. 列出未實裝的 (cardName, abilityName/attackName) 清單
 *
 * 偵測 pattern（依命中順序）：
 *   1. '卡名|特性名/招式名' key 字串（regA / regPre / regPost / ABILITY_EFFECTS.set 等）
 *   2. legacy regA('卡名', index) 寫法
 *   3. inline a.name === '特性名' / atk.name === '招式名'
 *   4. 全形 ｜ 註解 '卡名｜特性名'
 *   5. Map/Set 註冊 '特性名' 或 '招式名' 字串 + 卡名單獨出現（map-based 寬鬆推定）
 *
 * 用法：node scripts/audit-all-pokemon-effects.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

// ── 載入卡池 ─────────────────────────────────────────────────────────────────
const cards = [];
for (const f of fs.readdirSync('static/cards').filter(f => f.endsWith('.json') && f !== 'index.json')) {
  const arr = JSON.parse(fs.readFileSync(path.join('static/cards', f), 'utf8'));
  for (const c of arr) {
    if (c.supertype === 'Pokemon') cards.push({ ...c, name: (c.name || '').replace(/[<>＜＞‌]/g, '') });
  }
}

// ── 載入實作 source ───────────────────────────────────────────────────────────
function readAll(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readAll(p, out);
    else if (e.name.endsWith('.ts')) out.push(fs.readFileSync(p, 'utf8'));
  }
  return out;
}
const src = readAll('src/lib/game').join('\n----\n');

// ── 工具：跑檢查 ──────────────────────────────────────────────────────────────
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function check(cardName, effectName) {
  // 1. 直接 key match
  if (new RegExp(`['"\`]${esc(cardName)}\\|${esc(effectName)}['"\`]`).test(src)) return true;
  // 2. legacy regA('卡名', index, ...)
  if (new RegExp(`reg(?:A|G)\\s*\\(\\s*['"\`]${esc(cardName)}['"\`]\\s*,\\s*\\d+`).test(src)) return true;
  // 3. inline a.name / atk.name === '...'
  if (new RegExp(`\\.name\\s*===\\s*['"\`]${esc(effectName)}['"\`]`).test(src)) return true;
  if (new RegExp(`\\.name\\s*\\?\\.\\s*startsWith\\s*\\(\\s*['"\`]${esc(effectName)}['"\`]`).test(src)) return true;
  // 4. 全形 ｜ 註解
  if (new RegExp(`${esc(cardName)}｜${esc(effectName)}`).test(src)) return true;
  // 5. 卡名+效果名都單獨出現（寬鬆 — map-based 註冊）
  const hasCard = new RegExp(`['"\`]${esc(cardName)}['"\`]`).test(src);
  const hasEff = new RegExp(`['"\`]${esc(effectName)}['"\`]`).test(src);
  if (hasCard && hasEff) return true;
  return false;
}

// ── 主檢查迴圈 ────────────────────────────────────────────────────────────────
const seenAbility = new Map();  // key → bestRegMark
const seenAttack = new Map();
const missingAbility = [];
const missingAttack = [];
let abilityChecked = 0, attackChecked = 0;

// 取每個 (cardName, effectName) 的「最佳」regulationMark — H/I/J > G > F > 其他 > unknown
const REG_PRIORITY = { J: 100, I: 90, H: 80, G: 70, F: 60, E: 50, D: 40 };
function regScore(mark) { return REG_PRIORITY[mark] ?? 0; }

for (const c of cards) {
  const mark = c.regulationMark || '?';
  for (const ab of c.abilities || []) {
    if (!ab.effect || ab.effect.length < 5) continue;
    const key = `${c.name}|${ab.name}`;
    const prev = seenAbility.get(key);
    if (!prev || regScore(mark) > regScore(prev.mark)) {
      seenAbility.set(key, { mark, sample: c.id, label: ab.label, effect: ab.effect });
    }
  }
  for (const atk of c.attacks || []) {
    if (!atk.effect || atk.effect.length < 5) continue;
    const key = `${c.name}|${atk.name}`;
    const prev = seenAttack.get(key);
    if (!prev || regScore(mark) > regScore(prev.mark)) {
      seenAttack.set(key, { mark, sample: c.id, effect: atk.effect });
    }
  }
}

abilityChecked = seenAbility.size;
attackChecked = seenAttack.size;

for (const [key, info] of seenAbility) {
  const [cardName, abName] = key.split('|');
  if (!check(cardName, abName)) {
    missingAbility.push({ card: cardName, name: abName, mark: info.mark, label: info.label, sample: info.sample, effect: info.effect });
  }
}
for (const [key, info] of seenAttack) {
  const [cardName, atkName] = key.split('|');
  if (!check(cardName, atkName)) {
    missingAttack.push({ card: cardName, name: atkName, mark: info.mark, sample: info.sample, effect: info.effect });
  }
}

// ── 報告：依 regulation mark 分組 ────────────────────────────────────────────
console.log('═══ 全寶可夢卡實裝健康度檢查 ═══');
console.log(`寶可夢卡數: ${cards.length}`);
console.log(`唯一特性數（同名跨 set 去重）: ${abilityChecked}，未實裝: ${missingAbility.length}`);
console.log(`唯一招式數（同名跨 set 去重）: ${attackChecked}，未實裝: ${missingAttack.length}`);

function summarizeByMark(items, label) {
  const byMark = {};
  for (const m of items) (byMark[m.mark || '?'] ??= []).push(m);
  console.log(`\n${label} 按 regulation mark 分布：`);
  for (const mark of Object.keys(byMark).sort()) {
    console.log(`  [${mark}] ${byMark[mark].length} 項`);
  }
  return byMark;
}

const missAbByMark = summarizeByMark(missingAbility, '未實裝特性');
const missAtByMark = summarizeByMark(missingAttack, '未實裝招式');

// 列出 H/I/J 標的所有未實裝項目（重點）
function listMark(byMark, mark, label) {
  const list = byMark[mark] || [];
  if (list.length === 0) return;
  console.log(`\n[${mark} 標 ${label}]（${list.length} 項）`);
  for (const m of list) {
    console.log(`  ${m.card}｜${m.name}` + (m.label && m.label !== '特性' ? ` [${m.label}]` : '') + ` (id ${m.sample})`);
    console.log(`    → ${m.effect.replace(/\n+/g, ' ').slice(0, 110)}${m.effect.length > 110 ? '...' : ''}`);
  }
}

for (const mark of ['J', 'I', 'H']) {
  listMark(missAbByMark, mark, '未實裝特性');
  listMark(missAtByMark, mark, '未實裝招式');
}

// 寫到 /tmp 給後續審查
const outPath = '/tmp/pokemon_audit.json';
fs.writeFileSync(outPath, JSON.stringify({
  total: cards.length,
  abilityChecked, attackChecked,
  missingAbility, missingAttack,
}, null, 2));
console.log(`\n（完整結果已寫到 ${outPath}）`);
