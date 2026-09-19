#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// test-base-blob-git-errors —— 讀歷史 blob 的中央 helper 不可以把「git 壞了」
//                               當成「淺複製拿不到歷史」
//
// 【事故型態】（IRON_RULES Rule 59 的同型，規模大一個數量級）
//   scripts/lib/base-blob.mjs 的 `_git()` 原本寫：
//       try { … } catch { return { ok: false, out: '' }; }
//   **吞掉一切** git 失敗，一律降級成「拿不到歷史」⇒ 呼叫端印 SHALLOW-SKIP 跳過那一段，
//   而 **條數不變、整體綠燈**。問題是「物件不在」只是眾多失敗原因裡的一種：
//   git 不在 PATH、這裡不是 git repo、.git/**/index.lock 殘留、權限不足、maxBuffer 爆掉，
//   全部長得一模一樣。而這支 helper 有 **72 支守衛**在用。
//
//   ⚠⚠ 而且**不能用 exit code 分辨** —— 實測（git 2.34）：
//       物件不存在 / tree 不是 tree / 路徑不存在 / **連「不是 git repo」** 全部 exit 128。
//       唯一能分辨的是 stderr 的文字（所以 stdio 的 stderr 也從 'ignore' 改成 'pipe'）。
//
//   ⚠ CI 自 v6.263 後續版本起已經是 `fetch-depth: 0`（完整 clone）⇒ SHALLOW-SKIP 應該恆為 0。
//     這時候任何一次「非預期失敗」被當成淺複製跳過，就是不折不扣的假綠。
//
// 【這支守衛守什麼】
//   A) 靜態：`_git` 不得再有無差別的 catch；必須有 missOk／soft 的分流與 throw。
//   B) ⭐⭐⭐ 行為端（真的開 git repo 跑）：
//        預期的「物件不在」⇒ 回 ok:false，**不丟**（呼叫端照舊 SHALLOW-SKIP）
//        非預期的「不是 git repo」⇒ **丟**，而且訊息帶得到 git 自己的 stderr
//        isShallowCheckout（純診斷）⇒ 壞掉時仍然不丟
//        正常路徑 ⇒ 真的讀得到 blob 內容
//   C) 本守衛自己必須在 npm test chain 裡。
//
// 【HEAD-FAIL】B2/B4（非預期失敗要丟）在 BASE 上會紅：BASE 的 _git 對「不是 git repo」
//   回的是 ok:false 而不是丟。
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { parseChain } from './lib/chain-parse.mjs';
import { hasBaseCommit, readBaseBlob, isShallowCheckout, classifyGitFailure } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
let P = 0, F = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { P++; console.log('  PASS ' + name); }
  else { F++; console.log('  FAIL ' + name + (detail ? '\n        ' + detail : '')); }
};
const LIB = 'scripts/lib/base-blob.mjs';
const SELF = 'scripts/test-base-blob-git-errors.mjs';

// ── 判準只有一份（正式斷言與正反對照呼叫同一個函式）────────────────────────
/** 取出 _git 的函式本體（剝註解後）。抓不到回 null。 */
export function gitHelperBlock(stripped) {
  const lines = stripped.split('\n');
  let s = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('function _git(')) { s = i; break; }
  if (s < 0) return null;
  let e = -1;
  for (let i = s + 1; i < lines.length; i++) if (lines[i] === '}') { e = i; break; }
  return e < 0 ? null : lines.slice(s, e + 1).join('\n');
}
/** _git 的違規（回描述陣列；空陣列＝乾淨）。 */
export function gitHelperOffenders(block) {
  if (block == null) return ['抓不到 _git 區塊（anchor 失效）'];
  const bad = [];
  // ⚠ 這裡抓的是「catch 之後**只**回一個值、完全沒有分流」的形狀。
  //   行內註解要吃得下（stripCommentsBlankChecked 只空白化整行註解）。
  if (/catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)?\s*return[^\n]*\n?\s*\}/.test(block)) {
    bad.push('_git 的 catch 直接 return，沒有分流 —— git 壞掉會被當成「拿不到歷史」（安慰劑型態 2）');
  }
  if (!/throw\s+new\s+Error/.test(block)) {
    bad.push('_git 的 catch 裡沒有 throw —— 非預期的 git 失敗不會大聲');
  }
  if (!/stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/.test(block)) {
    bad.push("_git 沒有把 stderr 接成 'pipe' —— 連分辨「物件不在」與「不是 repo」的依據都拿不到");
  }
  return bad;
}

console.log('\n【A】靜態：_git 的失敗分流');
const RAW = existsSync(join(ROOT, LIB)) ? normEol(readFileSync(join(ROOT, LIB), 'utf8')) : '';
chk('A0 ⭐ 中央 helper 存在且非空', RAW.length > 1000, '長度 ' + RAW.length);
const BLOCK = gitHelperBlock(RAW ? stripCommentsBlankChecked(RAW, LIB) : '');
const BLOCK_NE = BLOCK == null ? -1 : BLOCK.split('\n').filter((L) => L.trim()).length;
chk('A0b ⭐ 抓得到 _git 區塊，且大小合理（anchor 沒失效）',
  BLOCK != null && BLOCK_NE > 6 && BLOCK_NE < 80, BLOCK == null ? '抓不到' : (BLOCK_NE + ' 個非空行'));
{
  const bad = gitHelperOffenders(BLOCK);
  chk('A1 ⭐⭐⭐ _git 必須分流失敗原因、非預期的要 throw、stderr 要接得到', bad.length === 0, bad.join(' ｜ '));
}
// ⚠ 逐項正對照（每個樣本只違反一項）——餵「多項全犯」的樣本時，掏空其中任何一項偵測
//   之後它仍會回 >= 2 條而照樣綠（安慰劑型態 12）。
const SAMPLE = (body) => 'function _git(root, args) {\n' + body + '\n}';
{
  const hit = gitHelperOffenders(SAMPLE(
    "  try { return { ok: true, out: x({ stdio: ['ignore', 'pipe', 'pipe'] }) }; }\n"
    + "  catch { return { ok: false, out: '' }; }\n"
    + "  throw new Error('x');"));
  chk('A1b ★★ 正對照①：catch 直接 return（＝ BASE 的原形）⇒ 恰好 1 條',
    hit.length === 1 && /沒有分流/.test(hit[0]), JSON.stringify(hit));
}
{
  const hit = gitHelperOffenders(SAMPLE(
    "  const s = { stdio: ['ignore', 'pipe', 'pipe'] };\n  if (a) { return s; }"));
  chk('A1b2 ★★ 正對照②：沒有 throw ⇒ 恰好 1 條', hit.length === 1 && /throw/.test(hit[0]), JSON.stringify(hit));
}
{
  const hit = gitHelperOffenders(SAMPLE(
    "  const s = { stdio: ['ignore', 'pipe', 'ignore'] };\n  throw new Error('x');"));
  chk('A1b3 ★★ 正對照③：stderr 仍是 ignore ⇒ 恰好 1 條', hit.length === 1 && /stderr/.test(hit[0]), JSON.stringify(hit));
}
chk('A1c ★ 反對照：正確寫法不得被誤判',
  gitHelperOffenders(SAMPLE(
    "  const s = { stdio: ['ignore', 'pipe', 'pipe'] };\n"
    + "  if (opts.missOk) { return { ok: false }; }\n"
    + "  throw new Error('boom');")).length === 0);

console.log('\n【A2】分類判準 classifyGitFailure 的表格測試（判準只有一份，正式路徑也呼叫它）');
// ⚠⚠ 'unclear' 這一類是**第一版把 CI 弄紅**才補出來的：
//   test-v6263 的 ④ 會把 git 換成 `#!/bin/sh\nexit 1` 的 PATH shim，實跑 5 支守衛並斷言
//   **條數完全相同**（那一段只在 POSIX 跑 ⇒ Windows 本機看不到，CI 才會執行）。
//   那個 shim 是「git 可執行但失敗、**沒有任何 stderr**」—— 第一版把它歸成「非預期 ⇒ 丟」，
//   於是 CI 上那 5 支集體爆掉（本機 738/738 全綠，CI 的 npm test 紅）。
//   ⭐「git 完全不能用」本來就是「拿不到歷史」的極端情況，不是環境異常的證據。
//   （shim 的**行為端**由 test-v6263 ④ 在 CI 上守；這裡守的是分類判準本身。）
{
  const T = [
    ["fatal: Not a valid object name deadbeef^{commit}", undefined, 'miss', '物件不存在'],
    ["fatal: path 'a/b.ts' exists on disk, but not in 'sha'", undefined, 'miss', '檔案在磁碟有、BASE 沒有'],
    ["fatal: path 'a/b.ts' does not exist in 'sha'", undefined, 'miss', '另一種措辭'],
    ['fatal: not a tree object', undefined, 'miss', 'tree 不是 tree'],
    ['fatal: not a git repository (or any of the parent directories): .git', undefined, 'env', '不是 git repo'],
    ["fatal: Unable to create '/x/.git/index.lock': File exists.", undefined, 'env', 'index.lock 殘留'],
    ['fatal: could not open directory: Permission denied', undefined, 'env', '權限'],
    ['', 'ENOENT', 'env', 'git 不在 PATH'],
    ['', undefined, 'unclear', '⭐ git 可執行但失敗、沒有 stderr（＝ test-v6263 ④ 的 PATH shim）'],
    ['something nobody has seen before', undefined, 'unclear', '沒見過的訊息'],
  ];
  let bad = [];
  for (const [err, code, want, why] of T) {
    const got = classifyGitFailure(err, code);
    if (got !== want) bad.push(`${why}：期待 ${want}、實得 ${got}`);
  }
  chk('A2 ⭐⭐⭐ 三分類（miss／env／unclear）逐項正確', bad.length === 0, bad.join(' ｜ '));
  chk('A2b ★ 表格本身有涵蓋三類（不是只測一類就宣稱涵蓋）',
    new Set(T.map((r) => r[2])).size === 3, JSON.stringify([...new Set(T.map((r) => r[2]))]));
  chk('A2c ★★ 反安慰劑：三類真的會給出不同答案（餵同一個輸入不可能同時是三類）',
    classifyGitFailure('fatal: not a git repository', undefined) !== classifyGitFailure('', undefined)
    && classifyGitFailure('', undefined) !== classifyGitFailure('fatal: not a tree object', undefined));
}

console.log('\n【B】行為端：真的開一個 git repo，驗「預期的不丟、非預期的要丟」');
{
  const G = (args, cwd) => spawnSync('git', ['-c', 'core.autocrlf=false',
    '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
    { cwd, encoding: 'utf8', windowsHide: true });
  const base = mkdtempSync(join(tmpdir(), 'bbge-'));
  try {
    const repo = join(base, 'repo');
    const notRepo = join(base, 'notrepo');
    mkdirSync(repo); mkdirSync(notRepo);
    G(['init', '-q'], repo);
    writeFileSync(join(repo, 'a.txt'), 'HELLO-A\n');
    G(['add', 'a.txt'], repo);
    G(['commit', '-q', '-m', 'c1'], repo);
    const sha = G(['rev-parse', 'HEAD'], repo).stdout.trim();
    const FAKE = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    chk('B0 ⭐ 測試用 repo 建得起來', !!sha, sha);

    // ① 正常路徑：真的讀得到
    chk('B1 ⭐ 正常路徑：hasBaseCommit 對存在的 commit 回 true', hasBaseCommit(repo, sha) === true);
    {
      const b = readBaseBlob(repo, sha, 'a.txt');
      chk('B2 ⭐⭐ 正常路徑：readBaseBlob 真的讀得到內容（不是空字串矇混過去）',
        b.ok === true && b.out === 'HELLO-A\n', JSON.stringify(b.out));
    }

    // ② 預期的「物件不在」：回 false／ok:false，**不可以丟**
    //    （丟了的話 72 支守衛在淺複製環境下會集體爆掉，那是另一種災難）
    let threw = '';
    try { chk('B3 ⭐⭐⭐ 預期的「commit 不在」⇒ 回 false 且**不丟**', hasBaseCommit(repo, FAKE) === false); }
    catch (e) { threw = String((e && e.message) || e); chk('B3 ⭐⭐⭐ 預期的「commit 不在」⇒ 回 false 且**不丟**', false, threw); }
    try {
      const b = readBaseBlob(repo, sha, 'nope.txt');
      chk('B4 ⭐⭐⭐ 預期的「檔案不在（磁碟上也沒有）」⇒ ok:false 且**不丟**',
        b.ok === false && b.expected === true, JSON.stringify(b));
    } catch (e) {
      chk('B4 ⭐⭐⭐ 預期的「檔案不在（磁碟上也沒有）」⇒ ok:false 且**不丟**', false, String((e && e.message) || e));
    }
    // ⭐⭐⭐ B4b 是第一版漏掉、而且當場打斷 8 支守衛的那個情境：
    //   **檔案在工作樹裡存在，但 BASE 那顆 commit 沒有**（＝本版新增的檔）。
    //   git 這時給的是 `path '…' exists on disk, but not in '<sha>'`，**不是**
    //   `Not a valid object name` ⇒ 白名單漏列就會把預期失敗誤判成非預期 ⇒ 假紅。
    //   （安慰劑型態 10 的變形：枚舉語義不要枚舉字面。）
    writeFileSync(join(repo, 'later.txt'), 'ONLY-IN-WORKTREE\n');
    try {
      const b = readBaseBlob(repo, sha, 'later.txt');
      chk('B4b ⭐⭐⭐ 預期的「檔案在磁碟上有、但 BASE 沒有」⇒ ok:false 且**不丟**',
        b.ok === false && b.expected === true, JSON.stringify(b));
    } catch (e) {
      chk('B4b ⭐⭐⭐ 預期的「檔案在磁碟上有、但 BASE 沒有」⇒ ok:false 且**不丟**', false,
        String((e && e.message) || e).slice(0, 260));
    }
    // ⚠ 正對照：確認這個情境**真的**走到了另一條 git 訊息（否則 B4b 與 B4 是同一件事，
    //   等於白測一次 —— 安慰劑型態 12：餵了「兩條路徑答案相同」的輸入）。
    {
      const r = G(['cat-file', '-p', sha + ':later.txt'], repo);
      chk('B4c ★★ 正對照：這個情境的 git 訊息確實是「exists on disk, but not in」（與 B4 不同條）',
        r.status !== 0 && /exists on disk, but not in|does not exist in/i.test(String(r.stderr || '')),
        String(r.stderr || '').slice(0, 200));
    }

    // ③ 非預期的「不是 git repo」：**必須丟**，而且訊息要帶得到 git 自己的 stderr
    //    ⚠ 這是本版的核心 —— BASE 在這裡回的是 ok:false（＝被當成淺複製跳過 ⇒ 假綠）。
    {
      let msg = null;
      try { hasBaseCommit(notRepo, sha); } catch (e) { msg = String((e && e.message) || e); }
      chk('B5 ⭐⭐⭐ 非預期的「不是 git repo」⇒ hasBaseCommit **必須丟**', msg !== null, '沒有丟（回了 ok:false ⇒ 會被當成淺複製跳過）');
      chk('B5b ⭐⭐ 而且訊息要帶得到 git 自己的 stderr（診斷得下去）',
        msg !== null && /not a git repository/i.test(msg), String(msg).slice(0, 200));
    }
    {
      let msg = null;
      try { readBaseBlob(notRepo, sha, 'a.txt'); } catch (e) { msg = String((e && e.message) || e); }
      chk('B6 ⭐⭐⭐ 非預期的「不是 git repo」⇒ readBaseBlob **必須丟**', msg !== null);
    }

    // ④ 純診斷的 isShallowCheckout 壞掉時**不可以**丟（它不是判準）
    {
      let msg = null, v = null;
      try { v = isShallowCheckout(notRepo); } catch (e) { msg = String((e && e.message) || e); }
      chk('B7 ⭐⭐ 純診斷的 isShallowCheckout 在壞掉的目錄上不丟、回 false',
        msg === null && v === false, msg || String(v));
    }
    chk('B8 ⭐ 正常路徑的 isShallowCheckout 也答得出來（完整 clone ⇒ false）',
      isShallowCheckout(repo) === false);
  } catch (e) {
    chk('B ⚠ 行為端整組例外', false, String((e && e.message) || e).slice(0, 300));
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* 清不掉不影響判準 */ }
  }
}

console.log('\n【C】本守衛自己必須在 npm test chain 裡（否則寫了等於沒寫）');
{
  const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const C = parseChain(String((PKG.scripts && PKG.scripts.test) || ''));
  const hits = C.scripts.filter((s) => s === SELF).length;
  chk('C1 ⭐ scripts.test 裡**恰好**有本檔一次', hits === 1, '出現 ' + hits + ' 次');
}

console.log(`\n=== base-blob git 失敗分流：PASS ${P} / FAIL ${F} ===`);
assert.strictEqual(F, 0, `有 ${F} 條失敗`);
