/**
 * v6.393b 突變測試：test-v6297 的 G1「BASE_MIGRATIONS 白名單」真的有在守嗎？
 *
 * 要否證的假綠：白名單一旦寫壞，就會變成「兩邊怎樣都算對」的鬆判準 ——
 *   那 G1 的逐位元比對就名存實亡（Rule 40 最怕的就是這個）。
 *
 * 每一個突變都必須讓 test-v6297 **翻紅**，而且紅的訊息要指到 G1；
 * 只改註解的 N1 則不得誤紅。跑完逐位元還原並複驗回綠。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GUARD = join(ROOT, 'scripts/test-v6297-tourn-friends-tab.mjs');
const P_PAGE = join(ROOT, 'src/routes/friends/+page.svelte');

const ORIG_GUARD = readFileSync(P_GUARD, 'utf8');
const ORIG_PAGE = readFileSync(P_PAGE, 'utf8');

let ok = 0, bad = 0;

/** 跑守衛，回傳 { red, out }。red = exit != 0。 */
function runGuard() {
  try {
    const out = execFileSync(process.execPath, [P_GUARD], { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8');
    return { red: false, out };
  } catch (e) {
    const out = String((e.stdout && e.stdout.toString()) || '') + String((e.stderr && e.stderr.toString()) || '') + '#exit';
    return { red: true, out };   // 守衛整支拋例外也算紅（見 v6.392 mutcheck 的教訓）
  }
}

function restore() {
  writeFileSync(P_GUARD, ORIG_GUARD, 'utf8');
  writeFileSync(P_PAGE, ORIG_PAGE, 'utf8');
}

/**
 * @param {string} name
 * @param {() => void} mutate  施加突變
 * @param {boolean} wantRed    期望翻紅
 * @param {RegExp|null} wantMsg 紅的時候訊息要對得上（錨點精準度）
 */
function M(name, mutate, wantRed, wantMsg) {
  restore();
  try { mutate(); } catch (e) { console.log('  ❌ ' + name + ' ⇒ 施加突變時出錯：' + e.message); bad++; restore(); return; }
  const { red, out } = runGuard();
  let pass = (red === wantRed);
  let why = '';
  if (pass && red && wantMsg && !wantMsg.test(out)) { pass = false; why = '（紅了，但訊息沒指到 G1 ⇒ 錨點不精準）'; }
  if (pass) { console.log('  ✅ ' + name); ok++; }
  else { console.log('  ❌ ' + name + ' ⇒ ' + (red ? '紅了' : '沒紅') + '（期望 ' + (wantRed ? '紅' : '綠') + '）' + why); bad++; }
  restore();
}

console.log('=== v6.393b 突變測試：G1 的 BASE_MIGRATIONS 白名單 ===');

// ── M1：改 /friends 頁裡**白名單以外**的地方 ⇒ G1 必須照樣紅 ────────────────
M('M1 ⭐⭐⭐ /friends 頁改了白名單以外的一個位元 ⇒ G1 仍須逐位元抓到',
  () => {
    const marker = '本檔只留版面。 */';
    const s = readFileSync(P_PAGE, 'utf8');
    if (s.split(marker).length - 1 !== 1) throw new Error('M1 錨點命中次數不是 1');
    writeFileSync(P_PAGE, s.replace(marker, '本檔只留版面。（v6393b 突變） */'), 'utf8');
  }, true, /G1|被動到了/);

// ── M2：把 step0 的修正還原回舊字面 ⇒ 白名單不得「兩邊都接受」 ──────────────
M('M2 ⭐⭐⭐ 把 step0 的註解修正還原回舊字面 ⇒ 白名單不可以變成「兩邊都算對」',
  () => {
    const s = readFileSync(P_PAGE, 'utf8');
    const from = 'FriendsPanel.svelte 的樣式區塊最上面';
    const to = 'FriendsPanel.svelte 的 ' + '<' + 'style' + '>' + ' 最上面';
    if (s.split(from).length - 1 !== 1) throw new Error('M2 錨點命中次數不是 1');
    writeFileSync(P_PAGE, s.replace(from, to), 'utf8');
  }, true, null);

// ── M3：白名單的錨點改成 BASE 裡不存在 ⇒ 必須紅在「命中 0 次」（fail-closed）──
M('M3 ⭐⭐ 白名單錨點改成 BASE 裡不存在的字串 ⇒ 必須紅在「必須恰好 1 次」',
  () => {
    const s = readFileSync(P_GUARD, 'utf8');
    const from = "['FriendsPanel.svelte 的 ' + OPEN_STYLE + ' 最上面'";
    if (s.split(from).length - 1 !== 1) throw new Error('M3 錨點命中次數不是 1');
    writeFileSync(P_GUARD, s.replace(from, "['__v6393b_不存在的錨點__' + OPEN_STYLE + ' 最上面'"), 'utf8');
  }, true, /命中 0 次|必須恰好 1 次/);

// ── M4：把逐位元比對降級成「只做結構斷言」 ⇒ M1 那種改動就抓不到了 ──────────
//   這一條驗的是「降級 = 假綠」：把 sha 比對整段拿掉之後，M1 的突變必須變成綠 ——
//   如果它照樣紅，代表 G1 的紅其實來自別的地方（錨點不精準）。
M('M4 ⭐⭐ 反證：拿掉 sha 逐位元比對之後，M1 的改動就抓不到了（證明紅的來源是它）',
  () => {
    const s = readFileSync(P_GUARD, 'utf8');
    const from = "    assert.strictEqual(createHash('sha256').update(rd(p), 'utf8').digest('hex'),\n      createHash('sha256').update(baseText, 'utf8').digest('hex'),";
    const fromCrlf = from.replace(/\n/g, '\r\n');
    const use = s.includes(fromCrlf) ? fromCrlf : from;
    if (s.split(use).length - 1 !== 1) throw new Error('M4 錨點命中次數不是 1');
    writeFileSync(P_GUARD, s.replace(use, "    assert.strictEqual(String(rd(p) && baseText && 1), '1',"), 'utf8');
    // 同時施加 M1 的頁面改動
    const marker = '本檔只留版面。 */';
    const t = readFileSync(P_PAGE, 'utf8');
    if (t.split(marker).length - 1 !== 1) throw new Error('M4 的頁面錨點命中次數不是 1');
    writeFileSync(P_PAGE, t.replace(marker, '本檔只留版面。（v6393b 突變） */'), 'utf8');
  }, false, null);

// ── N1：只改守衛裡的註解 ⇒ 不得誤紅 ───────────────────────────────────────
M('N1 只改 G1 白名單的註解（不得誤紅）',
  () => {
    const s = readFileSync(P_GUARD, 'utf8');
    const from = '  const OPEN_STYLE = ';
    if (s.split(from).length - 1 !== 1) throw new Error('N1 錨點命中次數不是 1');
    writeFileSync(P_GUARD, s.replace(from, '  // v6393b：只是註解\n  const OPEN_STYLE = '), 'utf8');
  }, false, null);

// ── 還原檢查 ───────────────────────────────────────────────────────────────
restore();
const okGuard = readFileSync(P_GUARD, 'utf8') === ORIG_GUARD;
const okPage = readFileSync(P_PAGE, 'utf8') === ORIG_PAGE;
if (okGuard && okPage) { console.log('  ✅ 還原檢查：兩個檔都逐位元回到突變前'); ok++; }
else { console.log('  ❌ 還原檢查失敗：guard=' + okGuard + ' page=' + okPage); bad++; }

const final = runGuard();
if (!final.red) { console.log('  ✅ 還原後守衛回到全綠'); ok++; }
else { console.log('  ❌ 還原後守衛仍是紅的'); bad++; }

console.log('\n=== v6.393b 突變測試：✅ ' + ok + ' / ❌ ' + bad + ' ===');
process.exit(bad ? 1 : 0);
