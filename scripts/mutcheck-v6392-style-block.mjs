#!/usr/bin/env node
/**
 * v6.392 突變測試：證明 test-v6392-style-block-central.mjs 真的守得住。
 * ⚠ 不放進 npm test chain；⚠⚠ 跑的時候不要同時跑全套測試（會讓別的守衛讀到暫時壞掉的檔案）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = join(ROOT, 'scripts/test-v6392-style-block-central.mjs');
const FILES = {
  L: join(ROOT, 'scripts/lib/svelte-style-block.mjs'),
  G: join(ROOT, 'scripts/test-v6297-tourn-friends-tab.mjs'),   // 代表性的呼叫端
};
const ORIG = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf8')]));
const OPEN = "'<" + "style'";

let ok = 0, bad = 0;
const say = (good, msg) => { if (good) { ok++; console.log('  ✅ ' + msg); } else { bad++; console.log('  ❌ ' + msg); } };
const restore = () => { for (const [k, p] of Object.entries(FILES)) { try { writeFileSync(p, ORIG[k], 'utf8'); } catch { /* */ } } };
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });

/**
 * 回傳守衛紅掉的原因清單。
 * ⚠ 有些突變會讓守衛**整支拋例外**（中央 helper 是 fail-closed，會 throw）——
 *   那種情況一行 `FAIL ` 都不會印，但 exit code 不是 0。
 *   ⇒ 把它記成 '#exit'，讓突變可以宣告「我預期守衛會炸掉」而不是「預期某條 FAIL」。
 */
function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = out.split('\n').filter((l) => l.trim().startsWith('FAIL ')).map((l) => l.trim());
  if (r.status !== 0 && !fails.length) fails.push('#exit（守衛整支拋例外，exit=' + r.status + '）');
  return fails;
}
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

console.log('=== v6.392 突變測試 ===');

mut('M1 ⭐⭐ 把 test-v6297 改回自己找標籤（Rule 38 違規復發）',
  { G: (s) => s.replace('const style = styleBlockOf(src);', 'const style = src.slice(src.lastIndexOf(' + OPEN + '));') },
  ['A1 ⭐⭐⭐ 沒有任何 script 自己找樣式標籤']);

// ⚠ 改成 indexOf 之後，styleTagIndex 會回假標籤的位移，而 styleBlockOf／cssOf 的 fail-closed
//   會 throw ⇒ 守衛**整支炸掉**（一行 FAIL 都印不出來）。這正是我們要的「不可能靜默通過」。
mut('M2 ⭐⭐⭐ lib 的 lastIndexOf 改回 indexOf（v6.391 踩過的那一個）',
  { L: (s) => s.replace('const i = s.lastIndexOf(OPEN);', 'const i = s.indexOf(OPEN);') },
  ['#exit']);

// ⚠ 誠實揭露：styleBlockOf 裡的那一行 assertLooksLikeStyleBlock 是**防禦性冗餘** ——
//   只要 styleTagIndex 用的是 lastIndexOf，就取不到假標籤，所以拿掉它**不會**讓任何契約翻紅。
//   它守的是「未來有人把 styleTagIndex 改壞」的第二層（M2 已經證明第一層會炸）。
//   ⇒ 這裡登記成「不得誤紅」，而不是假裝有守到。
mut('N2 拿掉 styleBlockOf 裡的防禦性 fail-closed（目前沒有契約直接守它）',
  { L: (s) => s.replace('  assertLooksLikeStyleBlock(block, what);\n', '').replace('  assertLooksLikeStyleBlock(block, what);\r\n', '') },
  []);

mut('M4 ⭐⭐ 拿掉 Rule 48 的「開頭標籤不可以在註解裡」檢查',
  { L: (s) => s.replace('  if (lastOpen > lastClose) {', '  if (false && lastOpen > lastClose) {') },
  ['B7 ⭐⭐ 註解裡出現開頭字面']);

mut('M5 ⭐ cssOf 把開頭標籤也切進去',
  { L: (s) => s.replace('  const css = s.slice(gt + 1, e);', '  const css = s.slice(a, e);') },
  ['B3 ⭐ cssOf 是 styleBlockOf 的真子集']);

mut('M6 ⭐ markupBeforeStyle 多切一個字元',
  { L: (s) => s.replace("  return String(src).slice(0, styleTagIndex(src, what));", "  return String(src).slice(0, styleTagIndex(src, what) + 1);") },
  ['B2 ⭐ markupBeforeStyle']);

mut('N1 只改 lib 的註解（不得誤紅）',
  { L: (s) => s.replace(' * ⚠ 全部 API 在找不到／切歪時一律 **throw**', ' * ⚠（探針）全部 API 在找不到／切歪時一律 **throw**') },
  []);

{
  const same = Object.entries(FILES).every(([k, p]) => readFileSync(p, 'utf8') === ORIG[k]);
  say(same, '還原檢查：2 個檔案逐位元回到突變前');
  say(runGuard().length === 0, '還原後守衛回到全綠');
}
console.log(`\n=== v6.392 突變測試：✅ ${ok} / ❌ ${bad} ===`);
process.exit(bad ? 1 : 0);
