#!/usr/bin/env node
/**
 * v2.95 一次性 migration：把 attacks[] 裡名稱以「[特性]」開頭的 entry
 * 挪到 abilities[]（name 去掉「[特性]」前綴 + ZWJ + 空白；label='特性'；
 * 保留 effect）。
 *
 * 背景：scraper（parse-card.js）原本的 ability regex 是 `/^\[([^\]]+)\]/`，
 * 要求 rawName 第一個字是 `[`。但 PTCG 官網部分 skillName 以 1-3 個 ZWJ
 * (U+200C) 前綴，導致偵測失敗、entry 被誤分類到 attacks[]，UI 冒出可點擊招式
 * 按鈕（v2.94 bug）。
 *
 * 此腳本修全部 static/cards/*.json（含 73 個受影響 entry），scraper 的根因修
 * 在 parse-card.js 單獨處理。
 *
 * 設計原則：
 * - **只動名稱含「[特性]」**（strip ZWJ+空白後 startsWith('[特性]')）的 attack
 * - abilities[] 若為空則建立；有既存 abilities 時 push 到末端（保留原順序）
 * - effect 原封不動（rulesText 語意不變）
 * - label 統一設 '特性'（與既有 ability 一致）
 * - name 移除「[特性]」前綴 + strip ZWJ + trim 中間空白 → 規範化成純特性名
 *
 * 使用：node scripts/migrate-bracket-ability-entries.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CARDS_DIR = 'static/cards';

function normalizeAbilityName(rawAttackName) {
  // 去 ZWJ → 去「[特性]」或「[特性] 」前綴 → trim
  const noZwj = rawAttackName.replace(/\u200C/g, '');
  const stripped = noZwj.replace(/^\[特性\]\s*/, '').trim();
  return stripped;
}

const files = fs.readdirSync(CARDS_DIR)
  .filter(f => f.endsWith('.json') && f !== 'index.json');

let totalMigrated = 0;
const perFile = new Map();
const migrated = [];

for (const f of files) {
  const fullPath = path.join(CARDS_DIR, f);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const arr = JSON.parse(raw);
  let changed = false;
  let fileCount = 0;

  for (const card of arr) {
    if (!Array.isArray(card.attacks) || card.attacks.length === 0) continue;
    const keep = [];
    const move = [];
    for (const atk of card.attacks) {
      const cleaned = (atk.name || '').replace(/\u200C/g, '').replace(/\s+/g, '');
      if (cleaned.startsWith('[特性]')) {
        move.push(atk);
      } else {
        keep.push(atk);
      }
    }
    if (move.length === 0) continue;

    for (const atk of move) {
      const abName = normalizeAbilityName(atk.name);
      const newAbility = {
        name: abName,
        effect: atk.effect || '',
        label: '特性',
      };
      if (!Array.isArray(card.abilities)) card.abilities = [];
      card.abilities.push(newAbility);
      migrated.push(`${card.setCode} ${card.collectorNumber}｜${card.name} → abilities「${abName}」`);
      fileCount++;
      totalMigrated++;
    }
    card.attacks = keep;
    if (card.attacks.length === 0) delete card.attacks;
    changed = true;
  }

  if (changed) {
    // 保留既有 JSON 風格：2 空格縮排 + 尾 \n
    const hasTrailingNewline = raw.endsWith('\n');
    const serialized = JSON.stringify(arr, null, 2) + (hasTrailingNewline ? '\n' : '');
    fs.writeFileSync(fullPath, serialized, 'utf8');
    perFile.set(f, fileCount);
  }
}

console.log('═══ Migration 完成 ═══');
console.log(`遷移 entry 總數：${totalMigrated}`);
console.log('───');
for (const [f, n] of [...perFile].sort()) {
  console.log(`  ${f}: ${n} entries`);
}
console.log('───');
console.log('詳細清單：');
for (const line of migrated) console.log('  ', line);
