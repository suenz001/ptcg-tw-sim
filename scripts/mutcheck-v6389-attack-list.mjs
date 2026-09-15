#!/usr/bin/env node
/**
 * v6.389a 突變測試 —— 自證 test-v6389 的新斷言真的有鑑別力。
 * 每個突變都保持**可編譯**、只改語意；跑完一律還原。
 * ⚠ 本檔不進 npm test chain（會改真檔案），但**必須留在 repo**（Rule 46：查法要可複驗）。
 *   跑法：node scripts/mutcheck-v6389-attack-list.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = join(ROOT, 'scripts/test-v6389-attack-list-overflow.mjs');
const run = () => {
  try { return execFileSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
};
const lineFor = (out, k) => (out.split(/\r?\n/).find((x) => x.includes(k)) || '(找不到這條斷言)').trim();
const isRed = (out, k) => lineFor(out, k).startsWith('FAIL');

let allOk = true;
/** 對某個檔套用一組 [from,to] 取代，跑守衛，要求指定斷言翻紅，最後還原 */
function mutate(tag, rel, edits, mustRed) {
  const p = join(ROOT, rel);
  const orig = readFileSync(p, 'utf8');
  let next = orig;
  for (const [from, to] of edits) {
    const n = next.split(from).length - 1;
    if (n !== 1) { console.log(`❌ ${tag} 錨點命中 ${n} 次：${from.slice(0, 60)}`); allOk = false; return; }
    next = next.replace(from, to);
  }
  try {
    writeFileSync(p, next, 'utf8');
    const out = run();
    for (const k of mustRed) {
      const red = isRed(out, k);
      console.log(`${red ? '✅' : '❌'} ${tag} → 「${k}」${red ? '如預期翻紅' : '居然還是綠的'}`);
      console.log('   ' + lineFor(out, k).slice(0, 140));
      if (!red) allOk = false;
    }
  } finally { writeFileSync(p, orig, 'utf8'); }
}

const PAGE = 'src/routes/game/+page.svelte';

// ── M1：picker 用**組內序號**送出（Opus 5 複審 🔴-2 的真實形態：第 2 組以後每顆都打錯招式）──
mutate('M1 picker 改用組內序號 k', PAGE, [
  ['{#each g.items as it}', '{#each g.items as it, k}'],
  ['initiateAttack(it.i)', 'initiateAttack(k)'],
  ['availableAttacks.includes(it.i)', 'availableAttacks.includes(k)'],
], ['C9 ⭐⭐⭐', 'C10 ⭐⭐⭐', 'C11 ⭐⭐']);

// ── M2：閾值常數改成 99（picker 永遠不會開，整個修法靜默失效）────────────────
mutate('M2 ATTACK_LIST_INLINE_MAX = 99', 'src/lib/ui-limits.ts', [
  ['export const ATTACK_LIST_INLINE_MAX = 3;', 'export const ATTACK_LIST_INLINE_MAX = 99;'],
], ['0e ⭐⭐⭐']);

// ── M3：把 .atk-overflow 的 grid-row 規則退回 v6.389 的死寫法（特異度輸、順序在前）──
mutate('M3 grid-row 規則退回死寫法', PAGE, [
  ['.playmat.layout-fable .action-bar > .action-btns > .btn-act.primary.atk-overflow{ grid-row:1; }',
   '.playmat.layout-fable .action-bar > .action-btns > .btn-act.atk-overflow{ grid-row:1; }'],
], ['C7 ⭐⭐⭐']);

// ── M4：picker 的 disabled 拿掉 pendingSelection（對手 pending 時按了會被靜默吞掉）──
mutate('M4 picker disabled 拿掉 pendingSelection', PAGE, [
  ['availableAttacks.includes(it.i) || !!pendingSelection', 'availableAttacks.includes(it.i)'],
], ['C12 ⭐⭐']);

// ── M5：拿掉 picker 的預估傷害 ──────────────────────────────────────────────
mutate('M5 拿掉 picker 的預估傷害', PAGE, [
  ['{#if hasEstimateToShow(damageEstimates ? (damageEstimates[it.i] ?? null) : null)}',
   '{#if false && hasEstimateToShowX(damageEstimates ? (damageEstimates[it.i] ?? null) : null)}'],
], ['C13 ⭐⭐']);

// ── M6：groupAttacksBySource 真的少一項（filter 型；fixture 現在有無傷害招式了）──
mutate('M6 分組時過濾掉沒有傷害的招式', PAGE, [
  ['    eff.forEach((e, i) => {', '    eff.filter((e) => e?.atk?.damage).forEach((e, i) => {'],
], ['B1 ⭐⭐⭐']);

// ── 還原後必須回到全綠 ──────────────────────────────────────────────────────
const clean = run();
const tail = clean.split(/\r?\n/).filter((l) => l.includes('守衛：PASS')).pop() || '(找不到總結行)';
const cleanOk = /FAIL 0\s*===/.test(tail);
console.log(`${cleanOk ? '✅' : '❌'} 還原後回到全綠：${tail.trim()}`);
if (!cleanOk) allOk = false;

console.log('');
console.log(allOk ? '✅ v6.389a 突變測試全數通過' : '❌ 有未通過項');
process.exit(allOk ? 0 : 1);
