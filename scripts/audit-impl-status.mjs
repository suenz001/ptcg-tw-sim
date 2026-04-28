#!/usr/bin/env node
/**
 * 盤點 H/I/J 卡實裝狀態 — 寬鬆判定版（容忍 false positive，避免 false negative）
 *
 * 策略：
 *  - Trainer / Tool / Stadium / SpecialEnergy：卡名出現在 source 任何 string literal → 實裝
 *  - Ability：(a) name 出現任何字串 OR (b) regA('Pokemon',index) 形式註冊
 *  - Attack：'Pokemon|attack' 字串出現
 *
 * 這樣 Item/Supporter/Stadium/Tool/SpecialEnergy 應該全 100%，
 * 只有 Ability/Attack 還有大量未實裝。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const cardsDir = path.join(ROOT, 'static/cards');

const allCards = [];
for (const f of fs.readdirSync(cardsDir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(fs.readFileSync(path.join(cardsDir, f), 'utf8'))) allCards.push(c);
}
const cards = allCards.filter(c => ['H','I','J'].includes(c.regulationMark));

const srcFiles = [
  'src/lib/game/effects.ts',
  'src/lib/game/engine.ts',
  ...fs.readdirSync('src/lib/game/effects/cards').map(f => `src/lib/game/effects/cards/${f}`),
];
const src = srcFiles.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n\n----FILE----\n\n');

function strip(name) { return (name || '').replace(/[‌<>＜＞]/g, ''); }
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 抽出所有 regA('Pokemon', index, ...) 的 (Pokemon, index) 對
const regAByPokemon = new Map(); // pokemon → Set<index>
for (const m of src.matchAll(/regA\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\d+)/g)) {
  const pn = m[1];
  if (!regAByPokemon.has(pn)) regAByPokemon.set(pn, new Set());
  regAByPokemon.get(pn).add(Number(m[2]));
}

function nameAppearsInSrc(name) {
  const n = strip(name);
  if (!n) return false;
  const escaped = escapeReg(n);
  // 任何 quote/backtick 包裹的字串 literal 出現此名
  return new RegExp(`['"\`]${escaped}['"\`|\\s,:：）)]`, 'm').test(src);
}

function attackImplemented(pokemonName, attackName) {
  const pn = strip(pokemonName);
  const an = strip(attackName);
  const fullKey = `${pn}|${an}`;
  return new RegExp(`['"\`]${escapeReg(fullKey)}['"\`]`, 'm').test(src);
}

function abilityImplemented(pokemonName, abilityName, abilityIndex) {
  // (a) regA('Pokemon', index) — 該索引註冊過
  const pn = strip(pokemonName);
  if (regAByPokemon.has(pn) && regAByPokemon.get(pn).has(abilityIndex)) return true;
  // (b) ability 名作為字串 literal 出現（PASSIVE_*.set / regPost / inline 都會匹配）
  if (nameAppearsInSrc(abilityName)) return true;
  return false;
}

const buckets = {
  Item: { done: [], missing: [] },
  Supporter: { done: [], missing: [] },
  Stadium: { done: [], missing: [] },
  PokemonTool: { done: [], missing: [] },
  SpecialEnergy: { done: [], missing: [] },
  Ability: { done: [], missing: [] },
  Attack: { done: [], missing: [] },
};

const seen = new Set();
for (const c of cards) {
  const n = strip(c.name);

  if (c.supertype === 'Trainer') {
    let bk = null;
    if (c.subtype === 'Item') bk = 'Item';
    else if (c.subtype === 'Supporter') bk = 'Supporter';
    else if (c.subtype === 'Stadium') bk = 'Stadium';
    else if (c.subtype === 'PokemonTool') bk = 'PokemonTool';
    if (!bk) continue;
    const key = `${bk}:${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ok = nameAppearsInSrc(n);
    buckets[bk][ok ? 'done' : 'missing'].push(n);
  } else if (c.supertype === 'Energy' && c.subtype === 'Special') {
    const key = `SpecialEnergy:${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ok = nameAppearsInSrc(n);
    buckets.SpecialEnergy[ok ? 'done' : 'missing'].push(n);
  } else if (c.supertype === 'Pokemon') {
    if (c.abilities) {
      for (let i = 0; i < c.abilities.length; i++) {
        const a = c.abilities[i];
        const key = `Ability:${n}|${a.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ok = abilityImplemented(n, a.name, i);
        buckets.Ability[ok ? 'done' : 'missing'].push(`${n}｜${a.name}`);
      }
    }
    if (c.attacks) {
      for (const atk of c.attacks) {
        if (!atk.effect || !atk.effect.trim()) continue;
        const key = `Attack:${n}|${atk.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ok = attackImplemented(n, atk.name);
        buckets.Attack[ok ? 'done' : 'missing'].push(`${n}｜${atk.name}`);
      }
    }
  }
}

console.log(`\nTotal cards: ${allCards.length}, H/I/J: ${cards.length}\n`);

const order = ['Item','Supporter','Stadium','PokemonTool','SpecialEnergy','Ability','Attack'];
console.log('═══════════════════════════════════════════════════════════════');
console.log('類別            實裝   未實裝   完成率');
console.log('───────────────────────────────────────────────────────────────');
for (const k of order) {
  const b = buckets[k];
  const total = b.done.length + b.missing.length;
  const pct = total ? (b.done.length / total * 100).toFixed(1) : '–';
  console.log(`${k.padEnd(14, ' ')}  ${String(b.done.length).padStart(4)}  ${String(b.missing.length).padStart(6)}   ${pct}%`);
}
console.log('═══════════════════════════════════════════════════════════════\n');

// Group missing Ability by 寶可夢 (取「｜」之前)
function groupByPokemon(arr) {
  const g = new Map();
  for (const m of arr) {
    const [pk, name] = m.split('｜');
    if (!g.has(pk)) g.set(pk, []);
    g.get(pk).push(name);
  }
  return g;
}

for (const k of order) {
  const b = buckets[k];
  if (b.missing.length === 0) continue;
  if (k === 'Ability' || k === 'Attack') {
    console.log(`\n── ${k} 未實裝（${b.missing.length}）— 按寶可夢 group ──`);
    const g = groupByPokemon(b.missing);
    const sorted = [...g.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [pk, names] of sorted.slice(0, 50)) {
      console.log(`  ${pk}：${names.join('、')}`);
    }
    if (sorted.length > 50) console.log(`  ... 還有 ${sorted.length - 50} 隻`);
  } else {
    console.log(`\n── ${k} 未實裝（${b.missing.length}）──`);
    for (const m of b.missing) console.log(`  ${m}`);
  }
}

// 寫出完整 missing 到 file
const outPath = '/tmp/missing-impl.json';
fs.writeFileSync(outPath, JSON.stringify({
  Item: buckets.Item.missing,
  Supporter: buckets.Supporter.missing,
  Stadium: buckets.Stadium.missing,
  PokemonTool: buckets.PokemonTool.missing,
  SpecialEnergy: buckets.SpecialEnergy.missing,
  Ability: buckets.Ability.missing,
  Attack: buckets.Attack.missing,
}, null, 2));
console.log(`\n完整未實裝清單寫到：${outPath}`);
