/**
 * v6.397 突變測試：test-v6397 真的有在守嗎？
 * ⚠ 判紅一律看 exit code（守衛結尾本來就會印「PASS 12 / FAIL 0」）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GUARD = join(ROOT, 'scripts/test-v6397-self-counters-converge.mjs');
const P_EFF = join(ROOT, 'src/lib/game/effects.ts');
const FILES = [P_GUARD, P_EFF];
const ORIG = new Map(FILES.map((p) => [p, readFileSync(p, 'utf8')]));
const restore = () => { for (const [p, s] of ORIG) writeFileSync(p, s, 'utf8'); };

let ok = 0, bad = 0;
function runGuard() {
  try {
    execFileSync(process.execPath, [P_GUARD], { cwd: ROOT, maxBuffer: 1 << 26, timeout: 600000 });
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

console.log('=== v6.397 突變測試 ===');

M('M1 ⭐⭐⭐ 醜醜魚改回手刻（不走中央 helper）=> C1 必紅',
  () => swap(P_EFF,
    "regPre('醜醜魚|抓狂', selfCountersMultiplyPre(0, 10, '抓狂', { log: false }));",
    "regPre('醜醜魚|抓狂', (state, aIdx, _pool) => {\n  const n = selfActiveCounters(state, aIdx);\n  return { state, damage: n * 10 };\n});"),
  true, /FAIL C1/);

M('M2 ⭐⭐⭐ 把醜醜魚的倍率從 10 改成 20 => A1 必紅（行為端真的在算傷害）',
  () => swap(P_EFF,
    "regPre('醜醜魚|抓狂', selfCountersMultiplyPre(0, 10, '抓狂', { log: false }));",
    "regPre('醜醜魚|抓狂', selfCountersMultiplyPre(0, 20, '抓狂', { log: false }));"),
  true, /FAIL A1 /);

M('M3 ⭐⭐ 拿掉 { log: false } => C2 必紅（原本沒有 log 的不可以多出一條）',
  () => swap(P_EFF,
    "regPre('醜醜魚|抓狂', selfCountersMultiplyPre(0, 10, '抓狂', { log: false }));",
    "regPre('醜醜魚|抓狂', selfCountersMultiplyPre(0, 10, '抓狂'));"),
  true, /FAIL C2/);

M('M4 ⭐⭐ 把挑靶函式改成不避開弱點 => A1 必紅（證明「中立靶」是判準的一部分）',
  () => swap(P_GUARD,
    "    if (w === atkType || r === atkType) continue;\n    return id;",
    "    void w; void r;\n    return id;"),
  true, /FAIL A1 /);

M('N1 只改守衛的一行註解（不得誤紅）',
  () => swap(P_GUARD, "console.log('\\n【C】", "console.log('\\n【C】(v6397 註解突變) "),
  false, null);

restore();
let same = true;
for (const [p, s] of ORIG) if (readFileSync(p, 'utf8') !== s) same = false;
if (same) { console.log('  OK 還原檢查：兩個檔都逐位元回到突變前'); ok++; }
else { console.log('  NG 還原檢查失敗'); bad++; }
const final = runGuard();
if (!final.red) { console.log('  OK 還原後守衛回到全綠'); ok++; }
else { console.log('  NG 還原後守衛仍是紅的'); bad++; }

console.log('\n=== v6.397 突變測試：OK ' + ok + ' / NG ' + bad + ' ===');
process.exit(bad ? 1 : 0);