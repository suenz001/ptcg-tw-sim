#!/usr/bin/env node
/**
 * 卡池資料健檢 — v2.143
 * - A. tag 一致性（同名卡 tags 應一致；scraper 偶有漏抓）
 * - B. 弱點/抵抗力一致性（同名卡 weakness/resistance 應一致）
 * - C. preset 未實裝招式/特性/訓練家（scope 限 preset 用到的卡）
 *
 * 執行：node scripts/audit-data.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const cardsDir = resolve(ROOT, 'static/cards');

const pool = [];
for (const f of readdirSync(cardsDir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(cardsDir, f), 'utf8'))) {
    pool.push(c);
  }
}
console.log(`Loaded ${pool.length} cards\n`);

// ── A. tag 一致性 ───────────────────────────────────────────────────────────
console.log('═════ A. Tag 一致性健檢 ═════');
const tagsByName = new Map();
for (const c of pool) {
  if (c.supertype !== 'Pokemon') continue;
  const t = JSON.stringify((c.tags ?? []).slice().sort());
  if (!tagsByName.has(c.name)) tagsByName.set(c.name, new Map());
  const m = tagsByName.get(c.name);
  if (!m.has(t)) m.set(t, []);
  m.get(t).push(`${c.id}/${c.setCode}/${c.collectorNumber ?? ''}`);
}
const tagInconsistent = [...tagsByName.entries()].filter(([_, m]) => m.size > 1);
console.log(`Pattern A: 同名卡 tag 不一致 — ${tagInconsistent.length} 種`);
for (const [name, m] of tagInconsistent.slice(0, 30)) {
  console.log(`\n  ${name}:`);
  for (const [tag, ids] of m) {
    const tagStr = tag === '[]' ? '(無 tag)' : tag;
    console.log(`    ${tagStr} — ${ids.length} 張：${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '...' : ''}`);
  }
}

// ── B. 弱點/抵抗力一致性 ────────────────────────────────────────────────────
console.log('\n\n═════ B. 弱點/抵抗力一致性健檢 ═════');
const weakByName = new Map();
const resByName = new Map();
const hpByName = new Map();
for (const c of pool) {
  if (c.supertype !== 'Pokemon') continue;
  const w = JSON.stringify(c.weakness ?? null);
  const r = JSON.stringify(c.resistance ?? null);
  const hp = c.hp ?? 0;
  for (const [map, val] of [[weakByName, w], [resByName, r], [hpByName, hp]]) {
    if (!map.has(c.name)) map.set(c.name, new Map());
    const m = map.get(c.name);
    if (!m.has(val)) m.set(val, []);
    m.get(val).push(`${c.id}/${c.setCode}`);
  }
}
const weakInc = [...weakByName.entries()].filter(([_, m]) => m.size > 1);
const resInc = [...resByName.entries()].filter(([_, m]) => m.size > 1);
const hpInc = [...hpByName.entries()].filter(([_, m]) => m.size > 1);
console.log(`Pattern B-1: 同名卡 weakness 不一致 — ${weakInc.length} 種`);
for (const [name, m] of weakInc.slice(0, 15)) {
  console.log(`\n  ${name}:`);
  for (const [w, ids] of m) {
    console.log(`    ${w} — ${ids.length} 張：${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '...' : ''}`);
  }
}
console.log(`\nPattern B-2: 同名卡 resistance 不一致 — ${resInc.length} 種`);
for (const [name, m] of resInc.slice(0, 10)) {
  console.log(`\n  ${name}:`);
  for (const [r, ids] of m) {
    console.log(`    ${r} — ${ids.length} 張：${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '...' : ''}`);
  }
}
console.log(`\nPattern B-3: 同名卡 HP 不一致 — ${hpInc.length} 種（多數正常：ex/非ex 同名差異）`);

// ── C. preset 未實裝招式/特性/訓練家 ─────────────────────────────────────────
console.log('\n\n═════ C. Preset 未實裝健檢 ═════');
const presetTxt = readFileSync(resolve(ROOT, 'src/lib/decks/presets.ts'), 'utf8');
const presetIds = [...presetTxt.matchAll(/cardId:\s*'(\d+)'/g)].map(m => m[1]);

const poolMap = new Map(pool.map(c => [c.id, c]));
const attackNames = new Set();
const abilityNames = new Set();
const trainerNames = new Set();
for (const id of presetIds) {
  const c = poolMap.get(id);
  if (!c) continue;
  if (c.supertype === 'Pokemon') {
    for (const a of c.attacks ?? []) attackNames.add(a.name);
    for (const ab of c.abilities ?? []) abilityNames.add(ab.name);
  } else {
    trainerNames.add(c.name);
  }
}

let eff = readFileSync(resolve(ROOT, 'src/lib/game/effects.ts'), 'utf8');
const effDir = resolve(ROOT, 'src/lib/game/effects/cards');
for (const f of readdirSync(effDir)) {
  if (f.endsWith('.ts')) eff += readFileSync(join(effDir, f), 'utf8');
}

const unimplAttacks = [...attackNames].filter(n => !eff.includes(n));
const unimplAbilities = [...abilityNames].filter(n => !eff.includes(n));
const unimplTrainers = [...trainerNames].filter(n => !eff.includes(n));

// v2.155: 把未實裝招式再分類為「純傷害（effect 空）」vs「有 effect 但漏實裝」
// 原因：v2.154 之前都把所有未實裝當純傷害，導致 20 個 preset 主力 ex 招式長期漏失
// 取每張卡的同名 attack — 任一張該招式 effect 非空即視為「有效果」
const attackEffectMap = new Map(); // name -> { hasEffect, sampleEffect, sampleCardName }
for (const c of pool) {
  if (c.supertype !== 'Pokemon') continue;
  for (const a of c.attacks ?? []) {
    if (!unimplAttacks.includes(a.name)) continue;
    const eff2 = (a.effect || '').trim();
    if (!attackEffectMap.has(a.name) || (eff2 && !attackEffectMap.get(a.name).hasEffect)) {
      attackEffectMap.set(a.name, {
        hasEffect: eff2.length > 0,
        sampleEffect: eff2,
        sampleCardName: c.name,
      });
    }
  }
}
const pureDmgAttacks = unimplAttacks.filter(n => !attackEffectMap.get(n)?.hasEffect).sort();
const missingAttacks = unimplAttacks.filter(n => attackEffectMap.get(n)?.hasEffect).sort();

console.log(`\n招式：${attackNames.size} 種，未在 effects 出現：${unimplAttacks.length}`);
console.log(`  └─ 純傷害（effect 空，不需註冊）：${pureDmgAttacks.length}`);
for (const n of pureDmgAttacks) console.log(`     - ${n}`);
console.log(`  └─ ⚠️ 有 effect 但漏實裝：${missingAttacks.length}`);
for (const n of missingAttacks) {
  const info = attackEffectMap.get(n);
  console.log(`     - ${n}（${info.sampleCardName}）：${info.sampleEffect}`);
}

console.log(`\n特性：${abilityNames.size} 種，未在 effects 出現：${unimplAbilities.length}`);
for (const n of unimplAbilities.sort()) console.log(`  - ${n}`);

console.log(`\n訓練家：${trainerNames.size} 種，未在 effects 出現：${unimplTrainers.length}`);
for (const n of unimplTrainers.sort()) console.log(`  - ${n}`);
