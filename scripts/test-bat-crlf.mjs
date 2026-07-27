// 守衛：repo 裡所有 Windows 批次檔（.bat）必須是 CRLF 換行。
//
// 真實事故（survey-archetype.bat 第一版）：檔案是純 LF 換行，Wilson 雙擊執行後
//   **視窗一閃而過、連錯誤訊息都來不及看到**。cmd.exe 對 `if (...)` / `for ... do (...)`
//   這種括號區塊是「整塊讀入再解析」，換行符不對就整塊爛掉、直接結束行程。
//
// ⚠這種錯完全沒有訊號：git diff 看起來一模一樣、`node --check` 不檢查 .bat、
//   在 Linux 上 `cat` 也完全正常 —— 只有在 Windows 真的按下去才會發現。
//   而在 Linux 沙盒寫檔預設就是 LF，所以這是會**反覆再犯**的錯，必須用守衛釘住。
//
// 順帶檢查兩件同類的事：
//   ・BOM：cmd 會把 BOM 當成第一道指令的一部分（`'∩╗┐@echo' 不是內部或外部命令`）。
//   ・要有 pause：否則錯誤訊息一樣是一閃而過，使用者只會說「視窗自動關閉了」。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

/**
 * 只檢查**版控中**的 .bat。
 * ⚠不可無腦掃磁碟：開發機上會有一堆沒進版控的本機殘留腳本（一次性的 push 腳本、
 *   舊的部署工具…），掃到它們會讓本機紅燈、CI 綠燈 —— 兩邊結果不一致的守衛
 *   很快就會被當成雜訊忽略，等於沒有守衛。
 * 沙盒是用 `git archive` 解出來的（沒有 .git），那裡磁碟上本來就只有版控檔案，
 *   所以退回掃磁碟的結果等價，不是妥協。
 */
function findBatsOnDisk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git' || f === '.svelte-kit' || f === 'build' || f === 'dist') continue;
    const p = join(dir, f);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) findBatsOnDisk(p, out);
    else if (f.toLowerCase().endsWith('.bat')) out.push(p);
  }
  return out;
}
function listBats() {
  if (existsSync(join(ROOT, '.git'))) {
    try {
      // ⚠一定要用 `ls-tree HEAD`（讀 commit）而**不是** `ls-files`（讀 .git/index）——
      //   本專案的 push 流程刻意走 git plumbing、用臨時 GIT_INDEX_FILE，**從不更新主 index**，
      //   所以 .git/index 停在很舊的狀態，`ls-files` 會漏掉一堆其實已在 HEAD 的檔案。
      //   （第一版就中招：明明有 8 支 .bat，ls-files 只列得出 3 支。）
      const out = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '-z', '--name-only', 'HEAD'], { encoding: 'buffer' });
      const rels = out.toString('utf8').split('\0').filter((r) => r.toLowerCase().endsWith('.bat'));
      return rels.map((r) => join(ROOT, r)).filter((p) => existsSync(p));
    } catch { /* git 不可用 → 退回掃磁碟 */ }
  }
  return findBatsOnDisk(ROOT);
}
const bats = listBats();
const rel = (p) => p.slice(ROOT.length);

T('前提：找得到 .bat 檔（找不到的話這份守衛就是空轉）', () => {
  assert.ok(bats.length > 0, 'repo 裡應該有 .bat');
  console.log('   掃到 ' + bats.length + ' 支：' + bats.map(rel).join('、'));
});

T('⭐⭐每支 .bat 都必須是 CRLF 換行（純 LF 會讓視窗一閃而過）', () => {
  const bad = [];
  for (const p of bats) {
    const s = readFileSync(p, 'latin1');
    const crlf = (s.match(/\r\n/g) || []).length;
    const lf = (s.match(/\n/g) || []).length - crlf;
    if (lf > 0) bad.push(`${rel(p)}（裸 LF ${lf} 個 / CRLF ${crlf} 個）`);
  }
  assert.deepEqual(bad, [],
    '這些 .bat 有裸 LF 換行，在 Windows 上 if(...) 區塊會解析錯亂、視窗直接關閉：\n  ' + bad.join('\n  '));
});

T('⭐.bat 不可有 UTF-8 BOM（cmd 會把它當成第一道指令的一部分）', () => {
  const bad = bats.filter((p) => {
    const b = readFileSync(p);
    return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  }).map(rel);
  assert.deepEqual(bad, [], '這些 .bat 有 BOM：' + bad.join('、'));
});

T('⭐.bat 要有 pause（否則出錯時訊息一閃而過，使用者只會說「視窗自動關閉了」）', () => {
  const bad = bats.filter((p) => !/\bpause\b/i.test(readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(bad, [], '這些 .bat 沒有 pause：' + bad.join('、'));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
