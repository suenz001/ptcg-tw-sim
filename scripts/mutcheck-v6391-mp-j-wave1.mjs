#!/usr/bin/env node
/**
 * v6.391 突變測試：證明 test-v6391-mp-j-wave1.mjs 真的守得住。
 * ⚠ 不放進 npm test chain（它會暫時改壞 4 個檔案）；改版時手動跑：
 *     node scripts/mutcheck-v6391-mp-j-wave1.mjs
 * ⚠⚠ 跑這支的時候**不要**同時跑全套測試 —— 它會讓別的守衛讀到暫時壞掉的檔案（v6.390 踩過）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = join(ROOT, 'scripts/test-v6391-mp-j-wave1.mjs');
const FILES = {
  W: join(ROOT, 'src/lib/game/effects/cards/mp_j_wave1.ts'),
  E: join(ROOT, 'src/lib/game/effects.ts'),
  J: join(ROOT, 'static/cards/M-P-J.json'),
  I: join(ROOT, 'static/cards/index.json'),
};
const ORIG = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf8')]));

let ok = 0, bad = 0;
const say = (good, msg) => { if (good) { ok++; console.log('  ✅ ' + msg); } else { bad++; console.log('  ❌ ' + msg); } };
const restore = () => { for (const [k, p] of Object.entries(FILES)) { try { writeFileSync(p, ORIG[k], 'utf8'); } catch { /* */ } } };
// ⚠ process 級還原（v6.391 審查者 🟡-10）：Ctrl-C／被 kill 也要把 4 個檔案放回去，
//   否則會留下壞掉的 effects.ts 或卡表，而且後面每一支守衛都會莫名其妙地紅。
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });

function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  return out.split('\n').filter((l) => l.trim().startsWith('FAIL ')).map((l) => l.trim());
}

/** edits: { W: (s)=>s, ... } */
function mut(name, edits, wantRedKeys) {
  let touched = false;
  for (const [k, fn] of Object.entries(edits)) {
    const next = fn(ORIG[k]);
    if (next === ORIG[k]) continue;
    writeFileSync(FILES[k], next, 'utf8');
    touched = true;
  }
  if (!touched) { say(false, name + ' :: ⚠ 突變沒命中錨點（突變測試本身壞了）'); restore(); return; }
  try {
    const fails = runGuard();
    for (const key of wantRedKeys) say(fails.some((f) => f.includes(key)), name + ' ⇒ 「' + key + '」翻紅');
    if (!wantRedKeys.length) say(fails.length === 0, name + ' ⇒ 守衛維持全綠（不得誤紅）'
      + (fails.length ? ' :: 誤紅了 ' + JSON.stringify(fails.slice(0, 4)) : ''));
  } finally { restore(); }
}

console.log('=== v6.391 突變測試 ===');

mut('M1 火焰牙改成【中毒】', { W: (s) => s.replace("statusPost('burned')", "statusPost('poisoned')") },
  ['B3 ⭐ 火焰牙']);
mut('M2 亂抓改成擲 2 次', { W: (s) => s.replace("coinHeadsMultiplyPre(3, 20, '亂抓')", "coinHeadsMultiplyPre(2, 20, '亂抓')") },
  ['B5 ⭐ 亂抓：3 幣全正 ⇒ 60']);
mut('M3 貝殼刃的加傷改成 0', { W: (s) => s.replace('coinPlusDmg(10, 30)', 'coinPlusDmg(10, 0)') },
  ['B8 ⭐ 貝殼刃：正面 ⇒ 10+30 = 40']);
mut('M4 ⭐ 從 SELF_DISCARD_UNITS_BATCH 拿掉 小火龍｜火花',
  { E: (s) => s.replace("  ['小火龍|火花', '火花', 30, 1, 'all'],\r\n", '').replace("  ['小火龍|火花', '火花', 30, 1, 'all'],\n", '') },
  ['B9b ⭐⭐ 小火龍｜火花', 'C4 ⭐ 三個「丟 1 個自身能量」']);
// ⚠ 原本這條前面還串了一個「把 A 換成 A」的恆等 replace（死碼，會誤導後人）—— v6.391 刪掉。
mut('M5 把一張新卡的 setCode 改回官方的 M-P',
  { J: (s) => s.replace(/("id": "19720"[\s\S]{0,400}?"setCode": ")M-P-J(")/, '$1M-P$2') },
  ['0c ⭐ setCode 全部是 M-P-J']);
mut('M6 index.json 的 M-P-J count 改成 999',
  { I: (s) => s.replace(/("code": "M-P-J"[\s\S]{0,300}?"cardCount": )135/, '$1999') },
  ['A1 ⭐ index.json 的 M-P-J count']);
mut('M7 寄生種子改成回 20', { W: (s) => s.replace("selfHealPost(10, '寄生種子')", "selfHealPost(20, '寄生種子')") },
  ['B1 ⭐ 寄生種子']);
mut('M8 ⭐ 在新檔裡把 火斑喵｜火焰牙 再註冊一次（Rule 38 違規）',
  { W: (s) => s.replace("regPost('火斑喵|火焰牙', statusPost('burned'));",
    "regPost('火斑喵|火焰牙', statusPost('burned'));\nregPost('火斑喵|火焰牙', statusPost('burned'));") },
  ['C1 ⭐⭐ 這 11 個 key']);
// ⚠ 錨點必須綁 id（v6.391 審查者 🟡-10）：「將這隻寶可夢恢復「10」HP。」這句話站上有 7 個既有 key，
//   直接 replace 會改到別張卡 ⇒ 0d 不紅，突變測試自己變成 ❌（不是靜默假綠，但仍然是壞錨點）。
mut('M9 改掉**19720 那一張**的招式效果文字',
  { J: (s) => s.replace(/("id": "19720"[\s\S]{0,1200}?"effect": ")[^"]*(")/, '$1將這隻寶可夢恢復「20」HP。$2') },
  ['0d ⭐⭐ 這 11 招的卡面文字逐字相符']);
// ── ⭐v6.391 審查者 🟡-10：原本 0b／A2／C3／B16 一條突變都沒有，補上 ──────────
mut('M10 ⭐ index.json 的 M-P-J supertypeCounts.Pokemon 改成 106',
  { I: (s) => s.replace(/("code": "M-P-J"[\s\S]{0,400}?"Pokemon": )107/, '$1106') },
  ['A2 ⭐ index.json 的 supertypeCounts']);
mut('M11 ⭐⭐ 從 effects.ts 拿掉 import mp_j_wave1（整批 8 招靜默失效）',
  { E: (s) => s.replace(/^import '\.\/effects\/cards\/mp_j_wave1';.*\r?\n/m, '') },
  ['C3 ⭐ 新檔有掛進 effects.ts 的 import 鏈', 'B1 ⭐ 寄生種子', 'B3 ⭐ 火焰牙']);
mut('M12 ⭐ 把一張新卡的標從 J 改成 I（站長：只處理 H／I／J，標錯會混進錯的賽制）',
  { J: (s) => s.replace(/("id": "19720"[\s\S]{0,400}?"regulationMark": ")J(")/, '$1I$2') },
  ['0b ⭐ 全部是 J 標']);
mut('M13 ⭐⭐ 給 19723（菊草葉｜飛葉快刀，本來沒效果）補一句效果文字但不註冊 ⇒ 靜默少做事',
  { J: (s) => s.replace(/("id": "19723"[\s\S]{0,1200}?"effect": ")([^"]*)(")/, '$1將對手的戰鬥寶可夢【麻痺】。$3') },
  ['B16 ⭐⭐⭐ 32 張裡「有效果文字」的招式']);

mut('N2 只改 effects.ts 的註解（不得誤紅）',
  { E: (s) => s.replace('// ⭐v6.391：M-P（J 標）慶祝系列御三家三張。', '// ⭐v6.391（探針）：M-P（J 標）慶祝系列御三家三張。') },
  []);
mut('N1 只改新檔的註解（不得誤紅）',
  { W: (s) => s.replace('// ══════════════════════════════════════════════════════════════════════════════\n// 1. 自身回復', '// ══════════════════════════════════════════════════════════════════════════════\n// 1. 自身回復（探針註解）') },
  []);

{
  const same = Object.entries(FILES).every(([k, p]) => readFileSync(p, 'utf8') === ORIG[k]);
  say(same, '還原檢查：4 個檔案逐位元回到突變前');
  say(runGuard().length === 0, '還原後守衛回到全綠');
}
console.log(`\n=== v6.391 突變測試：✅ ${ok} / ❌ ${bad} ===`);
process.exit(bad ? 1 : 0);
