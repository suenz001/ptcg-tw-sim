#!/usr/bin/env node
/**
 * 突變測試：證明 test-base-blob-git-errors.mjs 不是安慰劑。
 *
 * ⚠ 誠實揭露：A 組的逐項正對照（A1b／A1b2／A1b3／A1c）餵的是**寫死的常數字串樣本**，
 *   與 scripts/lib/base-blob.mjs 無關 ⇒ 對 LIB 的突變下它們**結構上恆綠**，
 *   不構成獨立性證據。真正有資訊量的是 M4–M6：逐項掏空守衛**自己的偵測器**。
 *
 * 做法：逐一注入突變 → 跑守衛 → 斷言 ① exit ≠ 0 ② **紅在預期的那一條**
 * （⚠ 絕不用 /FAIL/.test(out)，守衛結尾恆印「FAIL N」）→ finally 還原 → 複驗全綠。
 *
 * ⚠⚠ 破壞式：會暫時改寫 scripts/lib/base-blob.mjs 與守衛自己。請在沙盒裡跑。
 *   刻意**不**接進 npm test chain（test-runner-and-chain-hygiene 的 A1 在守這件事）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const GUARD_REL = 'scripts/test-base-blob-git-errors.mjs';
const GUARD = join(ROOT, GUARD_REL);
const LIB = 'scripts/lib/base-blob.mjs';

/** @type {{id:string,file:string,from:string,to:string,red:string[],green?:string[]}[]} */
const MUTS = [
  {
    id: 'M1 _git 退回「吞掉一切」的原形（本版修掉的那個 bug 本體）',
    file: LIB,
    from: String.raw`    if (kind === 'env') {`,
    to: String.raw`    if (false) {`,
    // 環境壞掉不再丟 ⇒ 行為端的 B5/B6 立刻紅（A 組是靜態形狀、A2 是純函式 ⇒ 都看不出來）
    red: ['B5', 'B5b', 'B6'],
    green: ['A1', 'A2', 'B1', 'B2', 'B3', 'B4', 'B4b', 'B7', 'B8'],
  },
  {
    id: 'M2 把 stderr 接回 ignore（分辨的依據沒了）',
    file: LIB,
    from: String.raw`        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'),`,
    to: String.raw`        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'),`,
    // 拿不到 stderr ⇒ 所有失敗都變成 'unclear'：
    //   「物件不在」不再標成 expected（B4／B4b 紅），
    //   「不是 git repo」也不再被認出來 ⇒ 不丟（B5／B5b／B6 紅）。
    //   B3 只看 hasBaseCommit 回 false ⇒ 仍綠（unclear 一樣回 ok:false）。
    red: ['A1', 'B4', 'B4b', 'B5', 'B5b', 'B6'],
    green: ['B1', 'B2', 'B3', 'B7', 'B8'],
  },
  {
    id: 'M3 EXPECTED_MISS 放寬成「什麼都算預期」（＝又變回吞掉一切）',
    file: LIB,
    from: String.raw`  'not a valid object name',         // 磁碟上也沒有這個路徑／sha 根本不存在`,
    to: String.raw`  '',   // 空字串 ⇒ 整條 regex 變成「什麼都匹配」`,
    // ⚠ classifyGitFailure 先看 ENV_BROKEN 再看 EXPECTED_MISS ⇒ 「不是 git repo」仍然會丟
    //   （B5/B6 維持綠）。真正被打到的是 'unclear' 那兩筆變成 'miss' ⇒ A2 的表格翻紅。
    //   ⭐ 這一條同時證明「三分類的順序」是有意義的：env 優先於 miss。
    red: ['A2'],
    green: ['A1', 'B1', 'B2', 'B3', 'B4', 'B4b', 'B5', 'B5b', 'B6', 'B7', 'B8'],
  },
  {
    id: 'M3c ⭐ 白名單漏列「exists on disk, but not in」（第一版真的犯過、當場打斷 8 支守衛）',
    file: LIB,
    from: String.raw`  'exists on disk, but not in',      // ⭐ 檔案在工作樹裡、但那顆 commit 沒有（本版新增的檔）`,
    to: String.raw`  'zzz-removed-by-mutcheck',`,
    // ⚠ 'does not exist in' 也在白名單裡，但那是**另一個** git 版本的措辭；
    //   這台機器的 git 給的是 'exists on disk, but not in' ⇒ 拿掉就會誤判成非預期 ⇒ B4b 紅。
    red: ['A2', 'B4b'],
    green: ['B3', 'B4', 'B4c', 'B5', 'B6', 'B7', 'B8', 'A1'],
  },
  {
    id: 'M3b isShallowCheckout 不再用 soft（純診斷卻會把守衛炸掉）',
    file: LIB,
    from: String.raw`  return _git(root, ['rev-parse', '--is-shallow-repository'], { soft: true }).out.trim() === 'true';`,
    to: String.raw`  return _git(root, ['rev-parse', '--is-shallow-repository']).out.trim() === 'true';`,
    red: ['B7'],
    green: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B8', 'A1'],
  },
  {
    id: 'M3d ⭐⭐ 把 unclear 也歸成 env（＝第一版把 CI 弄紅的那個錯）',
    file: LIB,
    from: String.raw`  return 'unclear';`,
    to: String.raw`  return 'env';`,
    // 「git 可執行但失敗、沒有 stderr」＝ test-v6263 ④ 的 PATH shim。歸成 env ⇒ 丟
    // ⇒ CI 上那 5 支守衛集體爆掉。A2 的表格把這件事釘死。
    red: ['A2'],
    green: ['A2b', 'A1', 'B1', 'B2', 'B3', 'B5', 'B6', 'B7'],
  },
  {
    id: 'M3e 把「不是 git repo」從 ENV_BROKEN 拿掉（環境壞了卻被當成拿不到歷史）',
    file: LIB,
    from: String.raw`const ENV_BROKEN = /not a git repository|index\.lock|permission denied|dubious ownership|unable to read|cannot open|no such file or directory/i;`,
    to: String.raw`const ENV_BROKEN = /index\.lock|permission denied|dubious ownership|unable to read|cannot open/i;`,
    red: ['A2', 'B5', 'B5b', 'B6'],
    green: ['A2b', 'B1', 'B2', 'B3', 'B4', 'B4b', 'B7', 'B8'],
  },
  {
    id: 'M4 掏空「catch 直接 return」的偵測',
    file: GUARD_REL,
    from: String.raw`  if (/catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)?\s*return[^\n]*\n?\s*\}/.test(block)) {`,
    to: String.raw`  if (0) {`,
    red: ['A1b'],
    green: ['A1', 'A1b2', 'A1b3', 'A1c'],
  },
  {
    id: 'M5 掏空「catch 裡要有 throw」的偵測',
    file: GUARD_REL,
    from: String.raw`  if (!/throw\s+new\s+Error/.test(block)) {`,
    to: String.raw`  if (false) {`,
    red: ['A1b2'],
    green: ['A1', 'A1b', 'A1b3', 'A1c'],
  },
  {
    id: 'M6 掏空「stderr 要接成 pipe」的偵測',
    file: GUARD_REL,
    from: String.raw`  if (!/stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/.test(block)) {`,
    to: String.raw`  if (false) {`,
    red: ['A1b3'],
    green: ['A1', 'A1b', 'A1b2', 'A1c'],
  },
  {
    id: 'M7 ⭐ B2 改成只看 ok 不看內容（證明「真的讀得到內容」不是恆真）',
    file: GUARD_REL,
    from: String.raw`    writeFileSync(join(repo, 'a.txt'), 'HELLO-A\n');`,
    to: String.raw`    writeFileSync(join(repo, 'a.txt'), 'DIFFERENT\n');`,
    // 檔案內容換掉但斷言仍然期待 'HELLO-A\n' ⇒ B2 必須紅。
    // 這證明 B2 真的在比對內容，而不是「ok 為真就算過」。
    red: ['B2'],
    green: ['B1', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'],
  },
];

function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, timeout: 300000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function isRed(out, id) {
  return new RegExp('^\\s*FAIL ' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'm').test(out);
}

console.log('【0】基準：未突變時守衛必須全綠');
{
  const r = runGuard();
  assert.strictEqual(r.code, 0, '未突變就紅了，突變測試無意義：\n' + r.out.slice(-1500));
  console.log('  OK  守衛在乾淨狀態下 exit=0');
}

let killed = 0;
for (const m of MUTS) {
  const path = join(ROOT, m.file);
  const orig = readFileSync(path, 'utf8');
  try {
    const n = orig.split(m.from).length - 1;
    assert.strictEqual(n, 1, `${m.id}：突變 anchor 在 ${m.file} 裡出現 ${n} 次（需要恰好 1 次）`
      + `\n  ⚠ 不唯一時 replace 只會改掉第一處 ⇒ 突變只做了一半。\n  找：${m.from.slice(0, 100)}`);
    writeFileSync(path, orig.replace(m.from, m.to));
    const r = runGuard();
    assert.notStrictEqual(r.code, 0, `${m.id}：突變存活（守衛照樣 exit=0）\n` + r.out.slice(-1200));
    for (const id of m.red) {
      assert.ok(isRed(r.out, id), `${m.id}：應該紅在 ${id}，但那一條沒紅\n` + r.out.slice(-1800));
    }
    for (const id of (m.green || [])) {
      assert.ok(!isRed(r.out, id), `${m.id}：${id} 不該跟著紅（斷言之間沒有各自獨立）\n` + r.out.slice(-1800));
    }
  } finally {
    writeFileSync(path, orig);
  }
  killed++;
  console.log(`  OK  ${m.id}  → 紅在 ${m.red.join('/')}${m.green ? '，而 ' + m.green.join('/') + ' 維持綠' : ''}`);
}

console.log('\n【末】還原後複驗');
{
  const r = runGuard();
  assert.strictEqual(r.code, 0, '還原後守衛沒有回到全綠（finally 沒還原乾淨）：\n' + r.out.slice(-1500));
  console.log('  OK  還原後 exit=0');
}

console.log(`\n=== mutcheck base-blob git 失敗分流：${killed}/${MUTS.length} 個突變都被抓到 ===`);
