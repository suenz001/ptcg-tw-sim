#!/usr/bin/env node
/**
 * 分類 H 標卡片的未實裝效果，按模式分群。
 *
 * 目的：找出哪些可以「批次套模板」實裝（例如所有「擲硬幣正面 +N」、
 * 所有「讓對手中毒」、所有「回 N HP」等），哪些需要單獨寫。
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const H_SETS = ['SV5K', 'SV5M', 'SV5a', 'SV6', 'SV6a', 'SV7', 'SV7a', 'SV8', 'SV8a', 'MJ'];
const I_SETS = ['SV9', 'SV9a', 'SV10', 'SV11B', 'SV11W', 'M1S', 'M1L', 'M2', 'M2a', 'MBD', 'MBG'];
const J_SETS = ['MC', 'M3', 'M4'];
const TARGET = process.argv[2] ?? 'H';
const sets = TARGET === 'H' ? H_SETS : TARGET === 'I' ? I_SETS : J_SETS;

const cardsDir = 'E:/ptcg-tw-sim/static/cards';
const effects = readFileSync('E:/ptcg-tw-sim/src/lib/game/effects.ts', 'utf8');
const implT = new Set([...effects.matchAll(/^reg\('([^']+)'/gm)].map(m => m[1]));
const implPre = new Set([...effects.matchAll(/regPre\('([^']+)\|([^']+)'/g)].map(m => `${m[1]}|${m[2]}`));
const implPost = new Set([...effects.matchAll(/regPost\('([^']+)\|([^']+)'/g)].map(m => `${m[1]}|${m[2]}`));
const implAtk = new Set([...implPre, ...implPost]);
const implA = new Set([...effects.matchAll(/regA\('([^']+)',\s*(\d+)/g)].map(m => `${m[1]}|${m[2]}`));

function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

// 攻擊分類模式
function classifyAttack(text) {
  if (!text || !text.trim()) return 'no-effect';
  const t = text;
  const tags = [];
  if (t.includes('擲') && t.includes('硬幣')) tags.push('coin');
  if (t.includes('正面')) tags.push('heads');
  if (t.includes('反面')) tags.push('tails');
  if (t.includes('中毒')) tags.push('poison');
  if (t.includes('燒傷')) tags.push('burn');
  if (t.includes('睡眠')) tags.push('sleep');
  if (t.includes('麻痺')) tags.push('paralyze');
  if (t.includes('混亂')) tags.push('confuse');
  if (t.includes('丟棄') && t.includes('能量')) tags.push('discard-energy');
  if (t.includes('回復') && t.includes('HP')) tags.push('heal-self');
  if (t.includes('附加') && t.includes('能量')) tags.push('attach-energy');
  if (t.includes('抽出')) tags.push('draw');
  if (t.includes('備戰寶可夢') && t.includes('傷害')) tags.push('bench-snipe');
  if (t.match(/\+\s*\d+/)) tags.push('damage-plus');
  if (t.match(/×\s*\d+/) || t.match(/\*\s*\d+/)) tags.push('damage-multiply');
  if (t.includes('在下個') && t.includes('無法')) tags.push('debuff-target');
  if (t.includes('傷害') && t.includes('-')) tags.push('damage-reduce');
  if (t.includes('昏厥')) tags.push('ko-check');
  if (tags.length === 0) tags.push('other');
  return tags.join(',');
}
function classifyAbility(text) {
  if (!text) return 'unknown';
  const tags = [];
  if (text.includes('只要這隻寶可夢') || text.includes('只要自己的')) tags.push('passive');
  if (text.includes('1次') || text.includes('可使用1次')) tags.push('once-per-turn');
  if (text.includes('當') || text.includes('時可使用')) tags.push('triggered');
  if (text.includes('抽出')) tags.push('draw');
  if (text.includes('附加') || text.includes('附於')) tags.push('attach');
  if (text.includes('回復')) tags.push('heal');
  if (text.includes('傷害')) tags.push('damage');
  if (tags.length === 0) tags.push('other');
  return tags.join(',');
}

const report = { attacks: {}, abilities: {}, trainers: {} };
const seenAtk = new Set(), seenAb = new Set(), seenT = new Set();

for (const set of sets) {
  const path = join(cardsDir, `${set}.json`);
  const cards = JSON.parse(readFileSync(path, 'utf8'));
  for (const c of cards) {
    // 攻擊
    if (Array.isArray(c.attacks)) {
      c.attacks.forEach(a => {
        const txt = a.effect || a.text || '';
        if (!txt || !txt.trim()) return;
        const key = `${c.name}|${a.name}`;
        if (seenAtk.has(key) || implAtk.has(key)) return;
        seenAtk.add(key);
        const cls = classifyAttack(txt);
        (report.attacks[cls] ??= []).push({ set, name: c.name, attack: a.name, dmg: a.damage || '', effect: norm(txt).slice(0, 120) });
      });
    }
    // 特性
    if (Array.isArray(c.abilities)) {
      c.abilities.forEach((ab, i) => {
        const key = `${c.name}|${i}`;
        if (seenAb.has(key) || implA.has(key)) return;
        seenAb.add(key);
        const txt = ab.effect || ab.text || '';
        const cls = classifyAbility(txt);
        (report.abilities[cls] ??= []).push({ set, name: c.name, ability: ab.name, effect: norm(txt).slice(0, 120) });
      });
    }
    // 訓練家/道具/寶可夢道具/競技場
    if (c.supertype === 'Trainer' || (c.supertype === 'Pokemon' && c.subtype === 'Other')) {
      if (seenT.has(c.name) || implT.has(c.name)) continue;
      seenT.add(c.name);
      (report.trainers[c.subtype ?? '?'] ??= []).push({ set, name: c.name, effect: norm(c.rulesText ?? '').slice(0, 140) });
    }
  }
}

// 輸出
console.log(`=== ${TARGET} 標未實裝分類 ===\n`);
console.log('## 攻擊效果');
Object.entries(report.attacks).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => {
  console.log(`  [${k}] ${v.length} 張`);
});
console.log('\n## 特性');
Object.entries(report.abilities).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => {
  console.log(`  [${k}] ${v.length} 張`);
});
console.log('\n## 訓練家 / 道具');
Object.entries(report.trainers).forEach(([k, v]) => {
  console.log(`  [${k}] ${v.length} 張`);
});

const total = Object.values(report.attacks).flat().length + Object.values(report.abilities).flat().length + Object.values(report.trainers).flat().length;
console.log(`\n總未實裝：${total} 張`);

writeFileSync(`E:/ptcg-tw-sim/.tmp-${TARGET}-classify.json`, JSON.stringify(report, null, 2));
console.log(`詳細資料：.tmp-${TARGET}-classify.json`);
