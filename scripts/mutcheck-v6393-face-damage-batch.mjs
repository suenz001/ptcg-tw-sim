#!/usr/bin/env node
/**
 * v6.393 突變測試：證明 test-v6393-face-damage-batch.mjs 真的守得住。
 * ⚠ 不放進 npm test chain；⚠⚠ 不要與全套測試並行。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = join(ROOT, 'scripts/test-v6393-face-damage-batch.mjs');
const FILES = { E: join(ROOT, 'src/lib/game/effects.ts') };
const ORIG = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf8')]));

let ok = 0, bad = 0;
const say = (good, msg) => { if (good) { ok++; console.log('  ✅ ' + msg); } else { bad++; console.log('  ❌ ' + msg); } };
const restore = () => { for (const [k, p] of Object.entries(FILES)) { try { writeFileSync(p, ORIG[k], 'utf8'); } catch { /* */ } } };
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });

function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = out.split('\n').filter((l) => l.trim().startsWith('FAIL ')).map((l) => l.trim());
  if (r.status !== 0 && !fails.length) fails.push('#exit（守衛整支拋例外，exit=' + r.status + '）');
  return fails;
}
function mut(name, edits, want) {
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
    for (const key of want) say(fails.some((f) => f.includes(key)), name + ' ⇒ 「' + key + '」翻紅');
    if (!want.length) say(fails.length === 0, name + ' ⇒ 守衛維持全綠（不得誤紅）'
      + (fails.length ? ' :: 誤紅了 ' + JSON.stringify(fails.slice(0, 4)) : ''));
  } finally { restore(); }
}

console.log('=== v6.393 突變測試 ===');

mut('M1 ⭐⭐⭐ 傷害改回寫死的 baseDamage（本版之前的行為）',
  { E: (s) => s.replace('const dmg = faceBase + per * discarded.length;', 'const dmg = baseDamage + per * discarded.length;') },
  ['A1 ⭐⭐ regPre 的傷害用的是 faceBase', 'B3 ⭐⭐⭐ 人造第二種印刷']);

mut('M2 ⭐⭐ faceAttackDamage 改成用寫死的招式名去卡面找（找不到 ⇒ 永遠回 fallback）',
  { E: (s) => s.replace('faceAttackDamage(state, aIdx, pool, label, baseDamage)', "faceAttackDamage(state, aIdx, pool, '__nope__', baseDamage)") },
  ['A2 ⭐ faceBase 真的來自 faceAttackDamage', 'B3 ⭐⭐⭐ 人造第二種印刷']);

mut('M3 ⭐ 把表裡 小火龍|火花 的 label 改成對不上招式名',
  { E: (s) => s.replace("['小火龍|火花', '火花', 30, 1, 'all'],", "['小火龍|火花', '火花X', 30, 1, 'all'],") },
  ['C3 ⭐⭐ label 必須等於招式名']);

mut('M4 ⭐ 把表裡一個 key 改成卡池裡不存在的卡',
  { E: (s) => s.replace("['暖暖豬|火花', '火花', 40, 1, 'all'],", "['暖暖豬X|火花', '火花', 40, 1, 'all'],") },
  ['C2 ⭐ 每個 key 在卡池裡都找得到對應的卡']);

mut('N1 只改 regPre 那一段的註解（不得誤紅）',
  { E: (s) => s.replace('//   前科見 _shared.ts 的 faceAttackDamage 檔頭', '//   （探針）前科見 _shared.ts 的 faceAttackDamage 檔頭') },
  []);

{
  const same = Object.entries(FILES).every(([k, p]) => readFileSync(p, 'utf8') === ORIG[k]);
  say(same, '還原檢查：effects.ts 逐位元回到突變前');
  say(runGuard().length === 0, '還原後守衛回到全綠');
}
console.log(`\n=== v6.393 突變測試：✅ ${ok} / ❌ ${bad} ===`);
process.exit(bad ? 1 : 0);
