#!/usr/bin/env node
/**
 * audit-card-impl.mjs — 全面卡牌實裝 audit script
 *
 * 用途：
 *   給定一組目標卡片（卡名 + 招式名 / 特性名 / 卡片類型），全面掃 codebase
 *   尋找實裝痕跡，避免單一 pattern 誤判（v2.39 audit 誤判化石卡 / Stadium 的教訓）。
 *
 * 涵蓋的實裝路徑（共 12 種 pattern）：
 *   ── Trainer 類 ──
 *   1. reg('卡名', ...)                                  PLAY_TRAINER 路徑（一般 Item / Supporter）
 *   2. regG('卡名', ...)                                 PLAY_TRAINER gate
 *   3. FOSSIL_NAMES_LOCAL / FOSSIL_ITEM_NAMES set        化石卡（PLAY_FOSSIL action）
 *   4. stadiumCard.name === '卡名' (USE_STADIUM 內嵌)    Stadium 主動觸發 case
 *   5. STATIC_PASSIVE_STADIUMS / PASSIVE_STADIUMS set   Stadium 被動效果
 *   6. JAMMING_TOWER_STADIUMS / ROCKET_WATCHTOWER_STADIUMS / BENCH_PROTECTION_STADIUMS
 *
 *   ── Pokémon 類 ──
 *   7. regPre('卡名|招式', ...) / regPost                招式 PRE/POST
 *   8. ATTACK_PRE.set('卡名|招式', ...) / ATTACK_POST    同上
 *   9. regA('卡名', N, ...) / ABILITY_EFFECTS.set(...)   特性 ability
 *  10. PASSIVE_DAMAGE_REDUCE / PASSIVE_IMMUNITY / PASSIVE_RETALIATION /
 *      PASSIVE_ATTACK_BONUS / PASSIVE_PREVENT_KO / ABILITY_RETREAT_MOD set
 *      被動特性（不需 regA）
 *  11. BENCH_PLACE_TRIGGERS.set('卡名', ...)            上備戰時觸發
 *  12. engine.ts 內嵌 if (ab.name === '特性名')         engine 內嵌特性 gate
 *
 *   ── Energy 類 ──
 *  13. SPECIAL_ENERGY_ATTACH / SPECIAL_ENERGY_HP_BONUS / SPECIAL_ENERGY_RETREAT_MOD /
 *      SPECIAL_ENERGY_STATUS_IMMUNE / SPECIAL_ENERGY_ON_DAMAGED set
 *
 *   ── Tool 類 ──
 *  14. TOOL_HP_BONUS / TOOL_ATTACK_BONUS / TOOL_DEFENSE_REDUCE_BY_TYPE /
 *      TOOL_PREVENT_KO / TOOL_ON_KO / TOOL_PRIZE_BONUS / TOOL_ON_DAMAGED /
 *      TOOL_RETREAT_MOD / TOOL_BOTH_SIDES_RETREAT_PLUS / TOOL_END_TURN_DISCARD /
 *      TOOL_ATTACH_GATE set
 *
 * 用法：
 *   node scripts/audit-card-impl.mjs --reg=J          # 列出指定 regulation 全部卡
 *   node scripts/audit-card-impl.mjs --name=狙擊手之眼 # 查單張卡
 *
 * 輸出：每張目標的實裝命中路徑表 + 整體覆蓋率。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Step 1: load all source files ─────────────────────────────────────────────
function loadAllSources() {
  const buf = [];
  function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, e.name);
      if (e.isDirectory() && !fp.includes('node_modules') && !fp.includes('.svelte-kit')) {
        walk(fp);
      } else if (e.isFile() && (fp.endsWith('.ts') || fp.endsWith('.svelte'))) {
        try { buf.push(readFileSync(fp, 'utf8')); } catch { /* skip unreadable */ }
      }
    }
  }
  walk(join(REPO_ROOT, 'src/lib/game'));
  return buf.join('\n');
}

// ── Step 2: detect implementation hits ────────────────────────────────────────
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectImpl(src, name, kind, attackName, abilityName) {
  const e = escapeRegex(name);
  const hits = [];

  // 通用：reg / regG（PLAY_TRAINER）
  if (new RegExp(`reg\\(\\s*['"]${e}['"]`).test(src)) hits.push('reg(PLAY_TRAINER)');
  if (new RegExp(`regG\\(\\s*['"]${e}['"]`).test(src)) hits.push('regG(gate)');

  // FOSSIL set
  if (new RegExp(`['"]${e}['"]`).test(src) && /FOSSIL_NAMES_LOCAL|FOSSIL_ITEM_NAMES/.test(src)) {
    // 進一步檢查名稱是否在化石 set 區塊內
    const fossilMatch = src.match(/FOSSIL_NAMES_LOCAL[^[]*\[([^\]]*)\]/) || src.match(/FOSSIL_ITEM_NAMES[^[]*\[([^\]]*)\]/);
    if (fossilMatch && fossilMatch[1].includes(name)) hits.push('FOSSIL_set');
  }

  // Stadium - USE_STADIUM 內嵌 case
  if (new RegExp(`stadiumCard\\.name\\s*===\\s*['"]${e}['"]`).test(src)) hits.push('USE_STADIUM_inline');

  // Stadium - STATIC set
  for (const setName of ['STATIC_PASSIVE_STADIUMS', 'PASSIVE_STADIUMS', 'JAMMING_TOWER_STADIUMS',
                          'ROCKET_WATCHTOWER_STADIUMS', 'BENCH_PROTECTION_STADIUMS']) {
    const reg = new RegExp(`${setName}[\\s\\S]*?['"]${e}['"]`);
    if (reg.test(src)) {
      // 檢查是否真的在該 set 內（簡化：找最近的 set 宣告）
      hits.push(`Stadium_set(${setName})`);
      break;
    }
  }

  // Pokémon - 招式 PRE/POST
  if (attackName) {
    const eA = escapeRegex(attackName);
    if (new RegExp(`reg(?:Pre|Post)\\(\\s*['"]${e}\\|${eA}['"]`).test(src)) hits.push(`regPre/Post(${attackName})`);
    if (new RegExp(`(?:ATTACK_PRE|ATTACK_POST)\\.set\\(\\s*['"]${e}\\|${eA}['"]`).test(src)) hits.push(`ATTACK_set(${attackName})`);
  }

  // Pokémon - 特性 regA / 被動 set
  if (abilityName) {
    const eAb = escapeRegex(abilityName);
    if (new RegExp(`regA\\(\\s*['"]${e}['"]`).test(src)) hits.push(`regA`);
    if (new RegExp(`ABILITY_EFFECTS\\.set\\(\\s*['"]${e}\\|${eAb}['"]`).test(src)) hits.push(`ABILITY_EFFECTS.set`);

    // 被動特性 - PASSIVE_* maps（key 是 ability name 不是 pokemon name）
    for (const setName of ['PASSIVE_DAMAGE_REDUCE', 'PASSIVE_IMMUNITY', 'PASSIVE_RETALIATION',
                            'PASSIVE_ATTACK_BONUS', 'PASSIVE_PREVENT_KO', 'ABILITY_RETREAT_MOD',
                            'MOVE_DAMAGE_COUNTER_ABILITIES']) {
      const reg = new RegExp(`${setName}[\\s\\S]*?['"]${eAb}['"]`);
      if (reg.test(src)) {
        hits.push(`${setName}(${abilityName})`);
        break;
      }
    }

    // engine.ts 內嵌 if (ab.name === '特性名')
    if (new RegExp(`ab\\.name\\s*===\\s*['"]${eAb}['"]`).test(src)) hits.push(`engine_inline(ab.name===)`);
    if (new RegExp(`ability\\.name\\s*===\\s*['"]${eAb}['"]`).test(src)) hits.push(`engine_inline(ability.name===)`);
    if (new RegExp(`a\\.name\\s*===\\s*['"]${eAb}['"]`).test(src)) hits.push(`engine_inline(a.name===)`);
  }

  // BENCH_PLACE_TRIGGERS
  if (new RegExp(`BENCH_PLACE_TRIGGERS\\.set\\(\\s*['"]${e}['"]`).test(src)) hits.push('BENCH_PLACE_TRIGGERS');

  // Tool sets
  for (const setName of ['TOOL_HP_BONUS', 'TOOL_ATTACK_BONUS', 'TOOL_DEFENSE_REDUCE_BY_TYPE',
                          'TOOL_PREVENT_KO', 'TOOL_ON_KO', 'TOOL_PRIZE_BONUS', 'TOOL_ON_DAMAGED',
                          'TOOL_RETREAT_MOD', 'TOOL_BOTH_SIDES_RETREAT_PLUS', 'TOOL_END_TURN_DISCARD',
                          'TOOL_ATTACH_GATE']) {
    const reg = new RegExp(`${setName}[\\s\\S]*?['"]${e}['"]`);
    if (reg.test(src)) {
      hits.push(`${setName}`);
      break;
    }
  }

  // Special Energy sets
  for (const setName of ['SPECIAL_ENERGY_ATTACH', 'SPECIAL_ENERGY_HP_BONUS',
                          'SPECIAL_ENERGY_RETREAT_MOD', 'SPECIAL_ENERGY_STATUS_IMMUNE',
                          'SPECIAL_ENERGY_ON_DAMAGED', 'OPP_ENERGY_ATTACH_PASSIVE']) {
    const reg = new RegExp(`${setName}[\\s\\S]*?['"]${e}['"]`);
    if (reg.test(src)) {
      hits.push(`${setName}`);
      break;
    }
  }

  return hits;
}

// ── Step 3: load card data ────────────────────────────────────────────────────
function loadCards() {
  const cards = [];
  const dir = join(REPO_ROOT, 'static/cards');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      for (const c of data) cards.push(c);
    } catch { /* skip */ }
  }
  return cards;
}

// ── Step 4: main ──────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const regFilter = args.find(a => a.startsWith('--reg='))?.split('=')[1];
  const nameFilter = args.find(a => a.startsWith('--name='))?.split('=')[1];

  const src = loadAllSources();
  const cards = loadCards();

  // De-dup by (name, supertype, subtype)
  const seen = new Set();
  const targets = [];
  for (const c of cards) {
    if (regFilter && c.regulationMark !== regFilter) continue;
    if (nameFilter && c.name !== nameFilter) continue;
    const key = `${c.name}|${c.supertype}|${c.subtype}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(c);
  }

  // Categorize
  const pokemons = targets.filter(c => c.supertype === 'Pokemon');
  const trainers = targets.filter(c => c.supertype === 'Trainer');
  const energies = targets.filter(c => c.supertype === 'Energy');

  console.log(`\n=== Audit target: reg=${regFilter ?? 'ALL'} name=${nameFilter ?? 'ALL'} ===`);
  console.log(`寶可夢: ${pokemons.length} / 訓練家: ${trainers.length} / 能量: ${energies.length}\n`);

  // Pokémon - 逐 effect / ability 檢查
  const pokeRows = [];
  for (const p of pokemons) {
    const abilities = (p.abilities ?? []).map(a => a.name);
    const effectAttacks = (p.attacks ?? []).filter(a => (a.effect || '').trim()).map(a => a.name);
    if (abilities.length === 0 && effectAttacks.length === 0) {
      pokeRows.push({ name: p.name, status: 'PURE_DAMAGE', detail: '純傷害寶可夢' });
      continue;
    }
    const missAb = [], missAtk = [];
    for (const ab of abilities) {
      const hits = detectImpl(src, p.name, 'Pokemon', null, ab);
      if (hits.length === 0) missAb.push(ab);
    }
    for (const atk of effectAttacks) {
      const hits = detectImpl(src, p.name, 'Pokemon', atk, null);
      if (hits.length === 0) missAtk.push(atk);
    }
    if (missAb.length === 0 && missAtk.length === 0) {
      pokeRows.push({ name: p.name, status: 'OK', detail: `特性${abilities.length}個 / effect招式${effectAttacks.length}個 全部命中` });
    } else {
      const parts = [];
      if (missAb.length > 0) parts.push(`缺特性: ${missAb.join('、')}`);
      if (missAtk.length > 0) parts.push(`缺招式: ${missAtk.join('、')}`);
      pokeRows.push({ name: p.name, status: 'MISSING', detail: parts.join(' / ') });
    }
  }

  // Trainer
  const trainerRows = [];
  for (const t of trainers) {
    const hits = detectImpl(src, t.name, t.subtype);
    trainerRows.push({
      name: t.name, sub: t.subtype,
      status: hits.length > 0 ? 'OK' : 'MISSING',
      detail: hits.join(' | ') || '(無)',
    });
  }

  // Energy
  const energyRows = [];
  for (const e of energies) {
    if (e.subtype === 'Basic') {
      energyRows.push({ name: e.name, sub: e.subtype, status: 'BASIC', detail: '基本能量不需註冊' });
      continue;
    }
    const hits = detectImpl(src, e.name, e.subtype);
    energyRows.push({
      name: e.name, sub: e.subtype,
      status: hits.length > 0 ? 'OK' : 'MISSING',
      detail: hits.join(' | ') || '(無)',
    });
  }

  // Output
  console.log('=== 寶可夢 ===');
  const okPoke = pokeRows.filter(r => r.status === 'OK').length;
  const purePoke = pokeRows.filter(r => r.status === 'PURE_DAMAGE').length;
  const missPoke = pokeRows.filter(r => r.status === 'MISSING');
  console.log(`完整: ${okPoke} / 純傷害: ${purePoke} / 缺實裝: ${missPoke.length}\n`);
  for (const r of missPoke) console.log(`  ❌ ${r.name.padEnd(20)} ${r.detail}`);

  console.log('\n=== 訓練家 ===');
  const okT = trainerRows.filter(r => r.status === 'OK').length;
  const missT = trainerRows.filter(r => r.status === 'MISSING');
  console.log(`命中: ${okT}/${trainerRows.length}\n`);
  for (const r of missT) console.log(`  ❌ [${r.sub}] ${r.name}`);
  // 也列已命中的細節（可選）
  if (process.argv.includes('-v')) {
    for (const r of trainerRows.filter(r => r.status === 'OK')) {
      console.log(`  ✅ [${r.sub}] ${r.name.padEnd(15)} → ${r.detail}`);
    }
  }

  console.log('\n=== 特殊能量 ===');
  const spEnergies = energyRows.filter(r => r.sub !== 'Basic');
  const okE = spEnergies.filter(r => r.status === 'OK').length;
  const missE = spEnergies.filter(r => r.status === 'MISSING');
  console.log(`命中: ${okE}/${spEnergies.length}\n`);
  for (const r of missE) console.log(`  ❌ ${r.name}`);

  // 整體覆蓋
  const totalNon = pokemons.length + trainers.length + spEnergies.length;
  const okNon = okPoke + purePoke + okT + okE;
  console.log(`\n=== 整體 ===`);
  console.log(`覆蓋: ${okNon}/${totalNon} (${(100 * okNon / totalNon).toFixed(1)}%)`);

  if (missPoke.length > 0 || missT.length > 0 || missE.length > 0) {
    process.exit(1);
  }
}

main();
