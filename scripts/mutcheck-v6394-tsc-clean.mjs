/**
 * v6.394 突變測試：test-v6394-tsc-clean 真的有在守嗎？
 *
 * 要否證的假綠：
 *   ① tsc 其實沒跑起來（找不到編譯器／參數打錯），輸出永遠是空的 ⇒ A1 恆綠。
 *   ② supertype 掃描只是「沒掃到東西所以綠」。
 *   ③ C1 的簽章比對寫成恆真。
 * 每個突變都必須讓守衛翻紅，且紅在對應的那一條；只改註解的 N1 不得誤紅。
 * 跑完逐位元還原並複驗回綠。
 *
 * ⚠ 判紅一律看 exit code，**不可以**用 /FAIL/.test(out) ——
 *   守衛的結尾本來就會印「PASS 11 / FAIL 0」，那樣寫會恆真（v6.393c 第一版真的踩到）。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GUARD = join(ROOT, 'scripts/test-v6394-tsc-clean.mjs');
const P_SF = join(ROOT, 'src/lib/game/selection-filter.ts');
const P_W10 = join(ROOT, 'src/lib/game/effects/cards/m6_wave10.ts');
// 挑一個最小的卡片 JSON 當 B1 的突變對象（改完逐位元還原）
const CARDS = join(ROOT, 'static/cards');
const smallest = readdirSync(CARDS).filter((n) => n.endsWith('.json'))
  .map((n) => ({ n, s: readFileSync(join(CARDS, n), 'utf8') }))
  .sort((a, b) => a.s.length - b.s.length)[0];
const P_JSON = join(CARDS, smallest.n);

const ORIG = new Map([[P_GUARD, readFileSync(P_GUARD, 'utf8')], [P_SF, readFileSync(P_SF, 'utf8')],
                     [P_W10, readFileSync(P_W10, 'utf8')], [P_JSON, readFileSync(P_JSON, 'utf8')]]);
const restore = () => { for (const [p, s] of ORIG) writeFileSync(p, s, 'utf8'); };

let ok = 0, bad = 0;
function runGuard() {
  try {
    const out = execFileSync(process.execPath, [P_GUARD], { cwd: ROOT, maxBuffer: 1 << 26, timeout: 900000 }).toString('utf8');
    return { red: false, out };
  } catch (e) {
    const out = String((e.stdout && e.stdout.toString()) || '') + String((e.stderr && e.stderr.toString()) || '') + '#exit';
    return { red: true, out };
  }
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
function swap(p, from, to) {
  const s = readFileSync(p, 'utf8');
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error('錨點命中 ' + n + ' 次（必須恰好 1 次）');
  writeFileSync(p, s.replace(from, to), 'utf8');
}

console.log('=== v6.394 突變測試（B1 的突變對象：static/cards/' + smallest.n + '）===');

// M1：注入一條真的型別錯誤 ⇒ A1 必紅
M('M1 ⭐⭐⭐ 在 m6_wave10.ts 注入一條真的型別錯誤 => A1 必紅',
  () => swap(P_W10, 'function lanternTake(st: GameState, idx: 0 | 1',
                    'function lanternTake(st: GameState, idx: 0 | 1 | 2'),
  true, /FAIL A1 /);

// M2：把 isMegaExCard 改回型別述詞 ⇒ C1 必紅
M('M2 ⭐⭐ 把 isMegaExCard 改回型別述詞 => C1 必紅',
  () => swap(P_SF, 'export function isMegaExCard(c: Card | undefined): boolean {',
                   'export function isMegaExCard(c: Card | undefined): c is Card {'),
  true, /FAIL C1/);

// M3：塞一張 supertype 帶重音的卡 ⇒ B1 必紅
M('M3 ⭐⭐ 在卡片資料裡塞一個帶重音的 supertype => B1 必紅',
  () => {
    // ⚠ 卡檔裡有很多張 Pokemon，swap() 要求錨點唯一 ⇒ 這裡改成「只換第一張」：
    //   B1 是「整包資料裡不可以出現壞值」，換一張就足以讓它紅。
    const s = readFileSync(P_JSON, 'utf8');
    const from = '"supertype": "Pokemon"';
    const i = s.indexOf(from);
    if (i < 0) throw new Error('找不到錨點');
    writeFileSync(P_JSON, s.slice(0, i) + '"supertype": "Pok\u00e9mon"' + s.slice(i + from.length), 'utf8');
  },
  true, /FAIL B1 /);

// M4：把 tsc 的路徑改成不存在 ⇒ A0 哨兵必須接住（否則「跑不起來」會被當成「沒有錯誤」）
M('M4 ⭐⭐⭐ 把 tsc 路徑改成不存在 => A0 哨兵必須接住（跑不起來 ≠ 程式碼乾淨）',
  () => swap(P_GUARD, "const TSC = join(ROOT, 'node_modules/typescript/bin/tsc');",
                      "const TSC = join(ROOT, 'node_modules/typescript/bin/__不存在__');"),
  true, /FAIL A0/);

// N1：只改守衛的註解 ⇒ 不得誤紅
M('N1 只改守衛裡的一行註解（不得誤紅）',
  () => swap(P_GUARD, "console.log('【A】", "console.log('【A】(v6394c 註解突變) "),
  false, null);

restore();
let allSame = true;
for (const [p, s] of ORIG) if (readFileSync(p, 'utf8') !== s) allSame = false;
if (allSame) { console.log('  OK 還原檢查：四個檔都逐位元回到突變前'); ok++; }
else { console.log('  NG 還原檢查失敗'); bad++; }
const final = runGuard();
if (!final.red) { console.log('  OK 還原後守衛回到全綠'); ok++; }
else { console.log('  NG 還原後守衛仍是紅的'); bad++; }

console.log('\n=== v6.394 突變測試：OK ' + ok + ' / NG ' + bad + ' ===');
process.exit(bad ? 1 : 0);