#!/usr/bin/env node
/**
 * v6.390 突變測試：證明 test-v6390-scroll-list.mjs 真的守得住，不是安慰劑。
 *
 * ⚠ 不放進 npm test chain（它會暫時改壞 +page.svelte）；改版時手動跑：
 *     node scripts/mutcheck-v6390-scroll-list.mjs
 * ⚠ 每個突變跑完立刻還原，最後再驗一次「還原後守衛回綠」。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P = join(ROOT, 'src/routes/game/+page.svelte');
const GUARD = join(ROOT, 'scripts/test-v6390-scroll-list.mjs');
const ORIG = readFileSync(P, 'utf8');
const EOL = ORIG.includes('\r\n') ? '\r\n' : '\n';

let ok = 0, bad = 0;
const say = (good, msg) => { if (good) { ok++; console.log('  ✅ ' + msg); } else { bad++; console.log('  ❌ ' + msg); } };

function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { out, fails: out.split('\n').filter((l) => l.trim().startsWith('FAIL ')).map((l) => l.trim()) };
}

/** 突變：mutate(src) 回傳新內容或 null（代表錨點沒命中 ⇒ 突變本身壞了，要報錯） */
function mut(name, mutate, wantRedKeys) {
  const next = mutate(ORIG);
  if (next === null || next === ORIG) { say(false, name + ' :: ⚠ 突變沒命中錨點（突變測試本身壞了）'); return; }
  writeFileSync(P, next, 'utf8');
  try {
    const { fails } = runGuard();
    for (const k of wantRedKeys) {
      say(fails.some((f) => f.includes(k)), name + ' ⇒ 「' + k + '」翻紅');
    }
    if (!wantRedKeys.length) say(fails.length === 0, name + ' ⇒ 守衛維持全綠（不得誤紅）'
      + (fails.length ? ' :: 誤紅了 ' + JSON.stringify(fails.slice(0, 5)) : ''));
  } finally {
    writeFileSync(P, ORIG, 'utf8');
  }
}

console.log('=== v6.390 突變測試 ===');

// ── M1：個別規則改回寫死 max-height（v6.389 死規則的原型）────────────────
mut('M1 .sel-grid 個別規則改回 max-height:52vh',
  (s) => s.replace('gap:.4rem; --scroll-list-max:52vh;', 'gap:.4rem; max-height:52vh;'),
  ['A3 .sel-grid', 'B4 .sel-grid（一般選擇 modal，桌機） → ⭐ 勝出的 max-height 來自']);

// ── M2：群組規則少掛一個 class ──────────────────────────────────────────
mut('M2 群組規則的選擇器拿掉 .retreat-grid',
  (s) => s.replace(/\.rocket-command-scroll,(\r?\n)\s*\.retreat-grid\{/, '.rocket-command-scroll{'),
  ['A1 ⭐ 群組規則**恰好一條**', 'F2 ⭐⭐ 影響這 8 個 class 的規則集合',
    'B7 .retreat-grid（桌機） → ⭐ 勝出的 max-height 來自', 'B14 .retreat-grid']);

// ── M3：群組規則把高度寫死（--scroll-list-max 全部失效）──────────────────
mut('M3 群組規則的 max-height 改成寫死 60vh',
  (s) => s.replace('max-height:var(--scroll-list-max, 60vh);', 'max-height:60vh;'),
  ['A2 群組規則有 max-height:var', 'A2b ⭐ 群組規則自己不可以寫死高度',
    'B1 .mlog-list（桌機） → max-height 解析為 62vh', 'B4 .sel-grid（一般選擇 modal，桌機） → max-height 解析為 52vh']);

// ── M4：觸控四件套少一件 ────────────────────────────────────────────────
mut('M4 群組規則拿掉 overscroll-behavior:contain',
  (s) => s.replace('min-height:0; overflow-y:auto; overscroll-behavior:contain;', 'min-height:0; overflow-y:auto;'),
  ['A2 群組規則有 overscroll-behavior:contain', 'B14 .mlog-list']);

// ── M5：刻意保留的高特異度覆寫被刪掉 ────────────────────────────────────
mut('M5 刪掉 .prize-view-modal .sel-grid 的 max-height:none',
  (s) => s.replace('.prize-view-modal .sel-grid{ max-height:none; overflow:visible; }', ''),
  ['B12 ⭐ .prize-view-modal .sel-grid 仍然是 max-height:none', 'F2 ⭐⭐ 影響這 8 個 class 的規則集合']);

// ── M6：覆寫的高度被改掉 ────────────────────────────────────────────────
mut('M6 .discard-modal .sel-grid 的 72vh 改成 99vh',
  (s) => s.replace('gap:.55rem; --scroll-list-max:72vh;', 'gap:.55rem; --scroll-list-max:99vh;'),
  ['B8 .discard-modal .sel-grid（棄牌區，桌機） → max-height 解析為 72vh',
    'B11 .discard-modal .sel-grid（手機直式仍是 72vh，特異度勝） → max-height 解析為 72vh']);

// ── M7：@media 覆寫改回寫死（群組規則在該情境下變死碼）──────────────────
mut('M7 手機直式的 --scroll-list-max: 50vh 改回 max-height: 50vh',
  (s) => s.replace('      --scroll-list-max: 50vh;', '      max-height: 50vh;'),
  ['B9 .sel-grid（手機直式） → ⭐ 勝出的 max-height 來自']);

// ── M8：⭐⭐ 在群組規則**之後**補一條同特異度的 .sel-grid（v6.389 那個 bug 的完整重演）──
mut('M8 ⭐⭐ 群組規則之後新增 .sel-grid{max-height:99vh}（死規則的成因）',
  (s) => s.replace('  .copy-attack-poke{', '  .sel-grid{ max-height:99vh; }' + EOL + '  .copy-attack-poke{'),
  ['A3 .sel-grid', 'B4 .sel-grid（一般選擇 modal，桌機） → max-height 解析為 52vh',
    'F2 ⭐⭐ 影響這 8 個 class 的規則集合']);

// ── M9：註解裡的現查數字被改掉（Rule 46 制度化那一條）────────────────────
mut('M9 註解宣稱「剩 11 條」被改成 12',
  (s) => s.replace('那 18 條會剩 **11 條**', '那 18 條會剩 **12 條**'),
  ['A4 ⭐⭐ 註解宣稱的']);

// ── M10：!important 被拿掉（v5.299 的雙層滑捲衝突會回來）─────────────────
mut('M10 手機直式 .retreat-grid 的 max-height:none !important 拿掉 !important',
  (s) => s.replace('      max-height: none !important;', '      max-height: none;'),
  ['B13 ⭐ 手機直式的 .retreat-grid']);

// ── 不得誤紅 ────────────────────────────────────────────────────────────
mut('N1 改一個完全無關的寬度（.copy-attack-modal max-width 560→561）',
  (s) => s.replace('.copy-attack-modal{ max-width:560px; }', '.copy-attack-modal{ max-width:561px; }'),
  []);
// ⚠ 這條探針**不可以**寫 max-height + overflow-y:auto —— 那會讓 A4 的「現查條數」正當地翻紅，
//   變成假的誤紅。正對照要挑「真的與本版契約無關」的改動。
mut('N2 新增一個與這 8 個 class 無關的規則',
  (s) => s.replace('  .copy-attack-poke{', '  .__v6390_probe__{ color:#fff; }' + EOL + '  .copy-attack-poke{'),
  []);

// ── 還原檢查 ────────────────────────────────────────────────────────────
{
  const cur = readFileSync(P, 'utf8');
  say(cur === ORIG, '還原檢查：+page.svelte 逐位元回到突變前');
  const { out, fails } = runGuard();
  say(fails.length === 0 && /FAIL 0 ===/.test(out), '還原後守衛回到全綠');
}

console.log(`\n=== v6.390 突變測試：✅ ${ok} / ❌ ${bad} ===`);
process.exit(bad ? 1 : 0);
