/**
 * v6.393c 突變測試：test-v6392 的 A1b／A1c（v6.393a 改寫成「不依賴實體檔案」的正反對照）
 * 真的有在守嗎？
 *
 * 要否證的假綠：
 *   ① 偵測器（BAD 正則）壞掉了，A1 照樣綠 —— 因為「掃不到東西」跟「沒有違規」長得一模一樣。
 *   ② 正對照寫成恆真式（隨便餵什麼都命中）。
 *   ③ 反對照寫成恆假式（隨便餵什麼都不命中）。
 * 每個突變都必須讓 test-v6392 翻紅，且紅在對應的那一條；只改註解的 N1 不得誤紅。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P = join(ROOT, 'scripts/test-v6392-style-block-central.mjs');
const ORIG = readFileSync(P, 'utf8');
let ok = 0, bad = 0;

function runGuard() {
  try {
    const out = execFileSync(process.execPath, [P], { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8');
    // 紅＝exit != 0。
    // 不可以用 /FAIL/.test(out) 判紅 —— 這支守衛的結尾本來就會印「PASS 19 / FAIL 0」，
    // 那樣寫會恆真（判準壞掉的活教材，v6.393c 第一版真的踩到）。
    return { red: false, out };
  } catch (e) {
    const out = String((e.stdout && e.stdout.toString()) || '') + String((e.stderr && e.stderr.toString()) || '') + '#exit';
    return { red: true, out };   // 守衛整支拋例外也算紅
  }
}
const restore = () => writeFileSync(P, ORIG, 'utf8');

function M(name, from, to, wantRed, wantMsg) {
  restore();
  const s = readFileSync(P, 'utf8');
  const hits = s.split(from).length - 1;
  if (hits !== 1) { console.log('  NG ' + name + ' => 突變錨點命中 ' + hits + ' 次（必須恰好 1 次）'); bad++; restore(); return; }
  writeFileSync(P, s.replace(from, to), 'utf8');
  const { red, out } = runGuard();
  let pass = (red === wantRed);
  let why = '';
  if (pass && red && wantMsg && !wantMsg.test(out)) { pass = false; why = '（紅了，但不是紅在預期的那一條）'; }
  if (pass) { console.log('  OK ' + name); ok++; }
  else { console.log('  NG ' + name + ' => ' + (red ? '紅了' : '沒紅') + '（期望 ' + (wantRed ? '紅' : '綠') + '）' + why); bad++; }
  restore();
}

console.log('=== v6.393c 突變測試：test-v6392 的 A1b／A1c 正反對照 ===');

// M1：偵測器整組失效 —— A1 會「掃不到東西所以綠」，必須由 A1b 接住
M('M1 偵測器整組失效（BAD 清空）=> A1b 必須接住（A1 本身會假綠）',
  '  const hits = [];', '  BAD.length = 0;\n  const hits = [];', true, /FAIL A1b/);

// M2：正對照餵的字串改成「正確寫法」=> A1b 必紅（證明 A1b 不是恆真式）
M('M2 正對照改餵「走中央 helper」的正確寫法 => A1b 必紅',
  'const PROBE_BAD = "  const i = src.lastIndexOf(', 'const PROBE_BAD = "  const i = styleTagIndex(src, \x27x\x27); // (',
  true, /FAIL A1b/);

// M3：反對照餵的字串改成「舊寫法」=> A1c 必紅（證明 A1c 不是恆假式）
M('M3 反對照改餵舊寫法 => A1c 必紅',
  'const PROBE_OK = "  const i = styleTagIndex(src, \x27某某檔\x27);";',
  'const PROBE_OK = "  const i = src.lastIndexOf(\x27" + OPEN + "\x27);";',
  true, /FAIL A1c/);

// N1：只改註解，不得誤紅
M('N1 只改 A1b 上面的註解（不得誤紅）',
  '  const PROBE_BAD =', '  // v6393c：只是註解\n  const PROBE_BAD =', false, null);

restore();
if (readFileSync(P, 'utf8') === ORIG) { console.log('  OK 還原檢查：逐位元回到突變前'); ok++; }
else { console.log('  NG 還原檢查失敗'); bad++; }
const final = runGuard();
if (!final.red) { console.log('  OK 還原後守衛回到全綠'); ok++; }
else { console.log('  NG 還原後守衛仍是紅的'); bad++; }

console.log('\n=== v6.393c 突變測試：OK ' + ok + ' / NG ' + bad + ' ===');
process.exit(bad ? 1 : 0);