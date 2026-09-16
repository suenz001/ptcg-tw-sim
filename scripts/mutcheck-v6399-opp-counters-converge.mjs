/**
 * v6.399 突變測試：test-v6399 真的有在守嗎？
 * ⚠ 判紅一律看 exit code（守衛結尾本來就會印「PASS 34 / FAIL 0」，用 /FAIL/ 比對會恆真）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GUARD = join(ROOT, 'scripts/test-v6399-opp-counters-converge.mjs');
const P_EFF = join(ROOT, 'src/lib/game/effects.ts');
const P_SH = join(ROOT, 'src/lib/game/effects/_shared.ts');
const P_2620 = join(ROOT, 'src/lib/game/effects/cards/v2620_i_wave12_misc5.ts');
const FILES = [P_GUARD, P_EFF, P_SH, P_2620];
const ORIG = new Map(FILES.map((p) => [p, readFileSync(p, 'utf8')]));
const restore = () => { for (const [p, s] of ORIG) writeFileSync(p, s, 'utf8'); };

let ok = 0, bad = 0;
function runGuard() {
  try {
    execFileSync(process.execPath, [P_GUARD], { cwd: ROOT, maxBuffer: 1 << 26, timeout: 900000 });
    return { red: false, out: '' };
  } catch (e) {
    return { red: true, out: String((e.stdout && e.stdout.toString()) || '') + String((e.stderr && e.stderr.toString()) || '') + '#exit' };
  }
}
function swap(p, from, to, want = 1) {
  const s = readFileSync(p, 'utf8');
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const f = from.replace(/\r?\n/g, eol), t = to.replace(/\r?\n/g, eol);
  const n = s.split(f).length - 1;
  if (n !== want) throw new Error('錨點命中 ' + n + ' 次（預期 ' + want + '）');
  writeFileSync(p, s.split(f).join(t), 'utf8');
}
function M(name, mutate, wantRed, wantMsg) {
  restore();
  try { mutate(); } catch (e) { console.log('  NG ' + name + ' => 施加突變時出錯：' + e.message); bad++; restore(); return; }
  const { red, out } = runGuard();
  let p = (red === wantRed), why = '';
  if (p && red && wantMsg && !wantMsg.test(out)) { p = false; why = '（紅了，但不是紅在預期的那一條）'; }
  if (p) { console.log('  OK ' + name); ok++; }
  else { console.log('  NG ' + name + ' => ' + (red ? '紅了' : '沒紅') + '（期望 ' + (wantRed ? '紅' : '綠') + '）' + why); bad++; }
  restore();
}

console.log('=== v6.399 突變測試 ===');

M('M1 ⭐⭐⭐ 中央 helper 的 scope 分流拿掉（一律只數戰鬥場）=> A-all 必紅',
  () => swap(P_EFF,
    "    const n = opts.scope === 'all' ? oppAllCounters(state, aIdx) : oppActiveCounters(state, aIdx);",
    "    const n = oppActiveCounters(state, aIdx);"),
  true, /FAIL A-all/);

M('M2 ⭐⭐⭐ 中央 helper 忽略 base（dmg = per × n）=> A 必紅（行為端真的在算傷害）',
  () => swap(P_EFF, "    const dmg = base + per * n;\n    const where =", "    const dmg = per * n;\n    const where ="),
  true, /FAIL A /);

M('M3 ⭐⭐ damageCounterCount 不除 10（直接回傷害值）=> A 必紅（單位是「個」不是「點」）',
  () => swap(P_SH,
    "export function damageCounterCount(inst: CardInstance | null | undefined): number {\n  return Math.floor((inst?.damage ?? 0) / 10);\n}",
    "export function damageCounterCount(inst: CardInstance | null | undefined): number {\n  return inst?.damage ?? 0;\n}"),
  true, /FAIL A /);

M('M4 ⭐⭐ splitBreakdown 的 n>0 條件拿掉（n=0 也給 breakdown）=> B3 必紅',
  () => swap(P_EFF, "    if (opts.splitBreakdown && n > 0) {", "    if (opts.splitBreakdown) {"),
  true, /FAIL B3/);

M('M5 ⭐⭐⭐ 把一張卡改回手刻（不走中央 helper）=> C1 必紅',
  () => swap(P_EFF,
    "regPre('冰鬼護|傷害律動', oppCountersMultiplyPre(0, 20, '傷害律動', { log: false }));",
    "regPre('冰鬼護|傷害律動', (state, aIdx, _pool) => {\n  const n = oppActiveCounters(state, aIdx);\n  return { state, damage: n * 20 };\n});"),
  true, /FAIL C1/);

M('M6 ⭐⭐ 拿掉一張卡的 { log: false }（原本不寫 log 的多出一條）=> B2 必紅',
  () => swap(P_EFF,
    "regPre('蘋裹龍|酸味噴吐', oppCountersMultiplyPre(0, 20, '酸味噴吐', { log: false }));",
    "regPre('蘋裹龍|酸味噴吐', oppCountersMultiplyPre(0, 20, '酸味噴吐'));"),
  true, /FAIL B2/);

M('M7 ⭐⭐⭐ 在卡檔裡復活一份「自己除 10」的判準 => C3 必紅（全站掃描真的有在掃卡檔）',
  () => swap(P_2620,
    "// ⭐v6.399：本檔原本的 oppActiveCounterCountPre 整支刪除（同上，判準有三份）。",
    "function _mutantCounters(inst: { damage?: number } | null): number {\n  return Math.floor((inst?.damage ?? 0) / 10);\n}\nvoid _mutantCounters;"),
  true, /FAIL C3/);

M('N1 只改守衛的一行註解（不得誤紅）',
  () => swap(P_GUARD, "console.log('\\n【C】", "console.log('\\n【C】(v6399 註解突變) "),
  false, null);

restore();
console.log('=== v6.399 突變測試：' + ok + ' OK / ' + bad + ' NG ===');
process.exit(bad ? 1 : 0);
