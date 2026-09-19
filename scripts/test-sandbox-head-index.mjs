#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// test-sandbox-head-index —— 平行 runner 重用沙盒時，HEAD/index 必須對齊主樹
//
// 【事故本體（2026-09-19 實地抓到，不是假想）】
//   scripts/run-tests.mjs 的 createSandbox() 在「沙盒已存在（--keep 留下來的）」分支寫：
//       try { git(['checkout', '-q', '--detach', headSha], sb); } catch { /* tree 相同時是 no-op */ }
//   註解說「tree 相同時是 no-op」——**那個判斷是錯的**（安慰劑型態 2：無差別 try/catch）。
//   真正的失敗原因是：上一輪的步驟 (b) 已經把主樹位元組（含未 commit 的改動與未追蹤檔）
//   複製進沙盒工作樹了 ⇒ checkout 會說
//       error: Your local changes to the following files would be overwritten by checkout
//       error: The following untracked working tree files would be overwritten by checkout
//       Aborting
//   而**每一次**都被那個空 catch 吞掉 ⇒ 沙盒的 HEAD 與 index 從此停在第一次建立時的 sha。
//
// 【為什麼是「真的假綠」而不是無害】
//   站內有守衛讀的是 **index**（`git ls-files`）而不是 HEAD。⚠ 這份清單**不是 3 個而是 5 個**
//   （第一版漏列兩個，獨立審查抓到 —— 所以 D 組現在做過期偵測）：
//     lint-eol-anchors:220     `ls-files -z scripts`         掃 scripts 全體的 EOL 錨點
//     test-v6130:44,49         `ls-files` / `--others`       static/music
//     test-v6272:890           `ls-files --others`           src/static 未追蹤檔
//     test-v6378:124           `ls-files --others`           static/music 殘檔
//     lib/eol-agnostic.mjs:140 `ls-files --eol`              經 committedEolIsLf 被 12 支守衛使用
//   舊 index 裡沒有的新檔案**整批不會被掃到**，而 exit code、PASS/FAIL 條數、雙指紋
//   三個判準**全部不變** ⇒ runner 的三道驗收（硬差異／指紋／skip 標記）都看不出來。
//   實測（主樹 4763aae1、沙盒 w1 停在 a47ee043）：主樹 index 1421 檔、沙盒 index 1415 檔，
//   差的正是最近三版新增的 6 支 scripts/*.mjs ⇒ 它們完全逃過 lint-eol-anchors。
//
// 【這支守衛守什麼】
//   A) 靜態：createSandbox 的重用分支不得再用「會被工作樹髒檔擋下來」的 checkout，
//      不得空吞 git 例外，必須用 `reset --mixed`，並且必須有 HEAD/index 的後置斷言。
//   B) ⭐⭐⭐ 行為端（真的開一個 git repo 跑）：證明
//        ① 舊寫法在這個情境下**真的會失敗**（正對照 —— 沒有它，整套推論只是嘴上說）
//        ② 失敗被吞掉之後 HEAD 與 index **真的還是舊的**（假綠的機制本身）
//        ③ 新寫法 `reset --mixed` 成功、HEAD/index 對齊、而且**不動工作樹**
//   C) 本守衛自己必須在 npm test chain 裡。
//
// 【HEAD-FAIL】
//   A 組在 BASE（v6.405）上會紅：BASE 的 createSandbox 裡是那句 try/catch checkout，
//   沒有 reset --mixed、也沒有後置斷言。B 組是行為端，兩個版本都綠（它驗的是 git 的行為，
//   不是本站的程式碼）——B 組的價值在於**證明 A 組守的東西不是空想**。
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { parseChain } from './lib/chain-parse.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
let P = 0, F = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { P++; console.log('  PASS ' + name); }
  else { F++; console.log('  FAIL ' + name + (detail ? '\n        ' + detail : '')); }
};

const RUNNER = 'scripts/run-tests.mjs';
const SELF = 'scripts/test-sandbox-head-index.mjs';

// ── 判準（只有這一份；正式斷言與正對照呼叫的是**同一個函式**）──────────────
//   Rule 38／安慰劑型態 11：反安慰劑自檢若只是把判準再抄一次，它在任何版本都恆綠。

/** 取出 createSandbox 的函式本體（剝註解後）。抓不到回 null。 */
export function createSandboxBlock(runnerSrcStripped) {
  const lines = runnerSrcStripped.split('\n');
  let s = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('function createSandbox(')) { s = i; break; }
  }
  if (s < 0) return null;
  let e = -1;
  for (let i = s + 1; i < lines.length; i++) { if (lines[i] === '}') { e = i; break; } }
  if (e < 0) return null;
  return lines.slice(s, e + 1).join('\n');
}

/** 重用分支的違規（回違規描述陣列；空陣列＝乾淨）。 */
export function sandboxReuseOffenders(block) {
  const bad = [];
  if (block == null) return ['抓不到 createSandbox 區塊（anchor 失效）'];
  if (/checkout/.test(block)) {
    bad.push("createSandbox 裡還有 checkout —— 重用沙盒的工作樹一定有髒檔，checkout 必被擋下");
  }
  // ⚠⚠ 這條 regex 第一版寫成 /catch\s*\{\s*\}/ —— 對**它想抓的那個歷史案例本身是瞎的**：
  //   `stripCommentsBlankChecked` 只空白化**整行**註解，行內的 `/* … */` 留著，
  //   而 BASE 的原形正是 `} catch { /* tree 相同時是 no-op */ }`。
  //   `catch (e) { }` 也抓不到。兩種形狀都由獨立審查實測存活（V1／V2），現在補齊。
  if (/catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)?\s*\}/.test(block)) {
    bad.push('createSandbox 裡有空吞的 catch —— git 失敗會被靜默吃掉（安慰劑型態 2）');
  }
  if (!/'reset'[\s\S]{0,40}'--mixed'/.test(block)) {
    bad.push("createSandbox 沒有用 reset --mixed 對齊 HEAD/index");
  }
  return bad;
}

/**
 * 後置斷言缺了哪些（回缺項陣列；空陣列＝齊全）。
 * ⚠⚠ 第一版只檢查「那兩個 git 指令的字串有沒有出現」，**沒有檢查 throw 還在不在**
 *   ⇒ 把兩個 `if (…)` 改成 `if (false && …)`（最自然的「暫時關掉來 debug 然後忘了打開」）
 *   守衛照樣全綠（獨立審查的 V3 實測存活）。現在改成「指令出現**而且**其後 400 字內
 *   要有 throw」——Rule 59 守的是「失敗必須大聲」，不是「有呼叫過那兩個指令」。
 */
export function sandboxPostAssertMissing(block) {
  const miss = [];
  if (block == null) return ['抓不到 createSandbox 區塊（anchor 失效）'];
  const RX_HEAD = /'rev-parse'[\s\S]{0,30}'HEAD'/;
  const RX_IDX = /'--cached'[\s\S]{0,30}'--quiet'/;
  const probe = (rx, other, what) => {
    const m = rx.exec(block);
    if (!m) { miss.push('缺 ' + what + ' 的比對'); return; }
    // ⚠ 窗口要**截到下一個指令為止**，否則第一個 probe 會借用到第二個斷言的 throw
    //   而永遠通過（兩條 probe 不獨立 ⇒ 又是一個「答案碰巧相同」的判準）。
    let after = block.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const o = other.exec(after);
    if (o) after = after.slice(0, o.index);
    if (!/throw\s+new\s+Error/.test(after)) {
      miss.push(what + ' 比對之後沒有 throw（斷言被拿掉了？）');
    } else if (/if\s*\(\s*(?:false|0)\b/.test(after)) {
      // 「暫時關掉來 debug 然後忘了打開」——throw 還在，但永遠走不到。
      miss.push(what + ' 的斷言被恆假條件停用了（if (false && …)）');
    }
  };
  probe(RX_HEAD, RX_IDX, 'HEAD（rev-parse）');
  probe(RX_IDX, RX_HEAD, 'index==HEAD（diff --cached --quiet）');
  return miss;
}

console.log('\n【A】靜態：createSandbox 的重用分支');
const RAW = existsSync(join(ROOT, RUNNER)) ? normEol(readFileSync(join(ROOT, RUNNER), 'utf8')) : '';
chk('A0 ⭐ 平行 runner 存在且非空', RAW.length > 2000, '長度 ' + RAW.length);
const STRIPPED = RAW ? stripCommentsBlankChecked(RAW, RUNNER) : '';
const BLOCK = createSandboxBlock(STRIPPED);
// ⚠ 上界要數**非空行**：剝註解器把整行註解空白化但保留行，所以「加註解」會吃掉餘裕
//   ——第一版用總行數 53/80，本版一口氣加了 26 行註解，再寫幾段就會假紅（審查抓到）。
const BLOCK_NE = BLOCK == null ? -1 : BLOCK.split('\n').filter((L) => L.trim()).length;
chk('A0b ⭐ 抓得到 createSandbox 區塊，且大小合理（anchor 沒失效）',
  BLOCK != null && BLOCK_NE > 8 && BLOCK_NE < 120,
  BLOCK == null ? '抓不到' : (BLOCK_NE + ' 個非空行'));

{
  const bad = sandboxReuseOffenders(BLOCK);
  chk('A1 ⭐⭐⭐ 重用分支不得用 checkout、不得空吞例外，且必須用 reset --mixed',
    bad.length === 0, bad.join(' ｜ '));
}
// ⚠ 三條偵測**各自**給一個正對照（只違反一項的樣本），而不是一個「三項全犯」的樣本：
//   全犯的樣本在掏空任何一項偵測之後仍會回 >= 2 條 ⇒ 那個斷言照樣綠（安慰劑型態 12：
//   餵了一個「讀它 vs 不讀它答案相同」的輸入）。突變測試 M5/M6/M7 就是在守這件事。
const SAMPLE = (body) => 'function createSandbox(sb, headSha) {\n' + body + '\n}';
{
  const hit = sandboxReuseOffenders(SAMPLE(
    "  git(['checkout', '-q', '--detach', headSha], sb);\n  git(['reset', '--mixed', '-q', headSha], sb);"));
  chk('A1b ★ 正對照①：只有 checkout 的樣本 ⇒ 恰好 1 條，且指的是 checkout',
    hit.length === 1 && /checkout/.test(hit[0]), JSON.stringify(hit));
}
{
  const hit = sandboxReuseOffenders(SAMPLE(
    "  try { git(['reset', '--mixed', '-q', headSha], sb); } catch { }"));
  chk('A1b2 ★ 正對照②：只有空吞 catch 的樣本 ⇒ 恰好 1 條，且指的是 catch',
    hit.length === 1 && /catch/.test(hit[0]), JSON.stringify(hit));
}
{
  const hit = sandboxReuseOffenders(SAMPLE("  noop(sb, headSha);"));
  chk('A1b3 ★ 正對照③：缺 reset --mixed 的樣本 ⇒ 恰好 1 條，且指的是 reset',
    hit.length === 1 && /reset/.test(hit[0]), JSON.stringify(hit));
}
// ⭐⭐ 下面兩條是獨立審查逼出來的：第一版的 /catch\s*\{\s*\}/ 對這兩種形狀都**瞎**，
//   而其中第一種正是 BASE 的原形 —— 守衛抓得到 BASE 純粹是靠另外兩條偵測撐著。
{
  const hit = sandboxReuseOffenders(SAMPLE(
    "  try { git(['reset', '--mixed', '-q', headSha], sb); } catch { /* tree 相同時是 no-op */ }"));
  chk('A1b4 ★★ 正對照④：帶**行內註解**的空吞 catch（BASE 的原形）⇒ 恰好 1 條，且指的是 catch',
    hit.length === 1 && /catch/.test(hit[0]), JSON.stringify(hit));
}
{
  const hit = sandboxReuseOffenders(SAMPLE(
    "  try { git(['reset', '--mixed', '-q', headSha], sb); } catch (e) { }"));
  chk('A1b5 ★★ 正對照⑤：具名參數的空吞 catch (e) { } ⇒ 恰好 1 條，且指的是 catch',
    hit.length === 1 && /catch/.test(hit[0]), JSON.stringify(hit));
}
chk('A1c ★ 反對照：正確寫法不得被誤判',
  sandboxReuseOffenders(
    "function createSandbox(sb, headSha) {\n"
    + "  git(['reset', '--mixed', '-q', headSha], sb);\n"
    + "}").length === 0);

{
  const miss = sandboxPostAssertMissing(BLOCK);
  chk('A2 ⭐⭐⭐ createSandbox 必須有 HEAD 與 index 的後置斷言', miss.length === 0, miss.join(' ｜ '));
}
// ⚠ 判別式用 /rev-parse/ 而不是 /HEAD/：兩則訊息**都**含 "HEAD"（「缺 index==HEAD 比對」
//   也含），/HEAD/ 分辨不出任何東西、只是裝飾（審查抓到）。
const THROWER = (cmd) => '  ' + cmd + '\n  if (x) { throw new Error(\'boom\'); }';
{
  const miss = sandboxPostAssertMissing(THROWER("spawnSync('git', ['-C', sb, 'diff', '--cached', '--quiet', 'HEAD']);"));
  chk('A2b ★ 正對照①：只缺 HEAD 比對 ⇒ 恰好 1 條，且指的是 rev-parse',
    miss.length === 1 && /rev-parse/.test(miss[0]), JSON.stringify(miss));
}
{
  const miss = sandboxPostAssertMissing(THROWER("const h = git(['rev-parse', 'HEAD'], sb);"));
  chk('A2b2 ★ 正對照②：只缺 index 比對 ⇒ 恰好 1 條，且指的是 index',
    miss.length === 1 && /index/.test(miss[0]), JSON.stringify(miss));
}
// ⭐⭐ 「指令還在、斷言被掏空」的三種形狀 —— 第一版對它們**完全瞎**（審查的 V3）。
const PAIR = (headTail, idxTail) =>
  "  const h = git(['rev-parse', 'HEAD'], sb);\n" + headTail + '\n'
  + "  const r = spawnSync('git', ['-C', sb, 'diff', '--cached', '--quiet', 'HEAD']);\n" + idxTail;
const OK_HEAD = "  if (h !== headSha) { throw new Error('a'); }";
const OK_IDX = "  if (r.status !== 0) { throw new Error('b'); }";
chk('A2b3 ★★ 反對照：兩條斷言都完整 ⇒ 不得誤報',
  sandboxPostAssertMissing(PAIR(OK_HEAD, OK_IDX)).length === 0,
  JSON.stringify(sandboxPostAssertMissing(PAIR(OK_HEAD, OK_IDX))));
{
  const miss = sandboxPostAssertMissing(PAIR('  const q = 1;', OK_IDX));
  chk('A2b4 ★★ 正對照③：HEAD 那條的 throw 被拿掉 ⇒ 恰好 1 條，且點名 rev-parse'
    + '（⚠ 窗口若沒截斷，它會借用 index 那條的 throw 而恆綠）',
    miss.length === 1 && /rev-parse/.test(miss[0]), JSON.stringify(miss));
}
{
  const miss = sandboxPostAssertMissing(PAIR("  if (false && h !== headSha) { throw new Error('a'); }", OK_IDX));
  chk('A2b5 ★★ 正對照④：throw 還在但條件恆假（暫時關掉來 debug 忘了打開）⇒ 恰好 1 條',
    miss.length === 1 && /停用/.test(miss[0]), JSON.stringify(miss));
}
{
  const miss = sandboxPostAssertMissing(PAIR(OK_HEAD, "  if (0 && r.status !== 0) { throw new Error('b'); }"));
  chk('A2b6 ★★ 正對照⑤：index 那條被 if (0 &&) 停用 ⇒ 恰好 1 條，且點名 index',
    miss.length === 1 && /index/.test(miss[0]), JSON.stringify(miss));
}

console.log('\n【B】行為端：真的開一個 git repo，證明「舊寫法必敗、失敗被吞就是假綠」');
{
  const G = (args, cwd) => spawnSync('git', ['-c', 'core.autocrlf=false',
    '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
    { cwd, encoding: 'utf8', windowsHide: true });
  const base = mkdtempSync(join(tmpdir(), 'sbhi-'));
  let ok = true;
  try {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    G(['init', '-q'], repo);
    writeFileSync(join(repo, 'a.txt'), 'A1\n');
    G(['add', 'a.txt'], repo);
    G(['commit', '-q', '-m', 'c1'], repo);
    const c1 = G(['rev-parse', 'HEAD'], repo).stdout.trim();
    // c2 新增 b.txt（模擬「最近幾版新增的 scripts/*.mjs」）並改 a.txt
    writeFileSync(join(repo, 'b.txt'), 'B1\n');
    writeFileSync(join(repo, 'a.txt'), 'A2\n');
    G(['add', 'a.txt', 'b.txt'], repo);
    G(['commit', '-q', '-m', 'c2'], repo);
    const c2 = G(['rev-parse', 'HEAD'], repo).stdout.trim();
    chk('B0 ⭐ 測試用 repo 建得起來（兩個 commit 不同）', !!c1 && !!c2 && c1 !== c2, c1 + ' / ' + c2);

    // 沙盒：worktree 停在 c1，然後步驟 (b) 把「主樹位元組」複製進去
    //   ⇒ b.txt 變成**未追蹤檔**、a.txt 變成**已修改**。這就是 --keep 之後的真實狀態。
    const wt = join(base, 'wt');
    G(['worktree', 'add', '--detach', '-q', wt, c1], repo);
    // ⚠ 這兩個寫入刻意寫在**同一行**：突變測試要用單行 anchor 一次把「工作樹是髒的」
    //   這個前提拿掉，藉此證明 B1 不是恆真（工作樹乾淨時 checkout 會成功）。
    writeFileSync(join(wt, 'b.txt'), 'B1\n'); writeFileSync(join(wt, 'a.txt'), 'A2\n');

    // ① 正對照：舊寫法必須失敗。沒有這一條，上面整段推論只是嘴上說。
    const rCo = G(['checkout', '-q', '--detach', c2], wt);
    chk('B1 ⭐⭐⭐ 正對照：舊寫法 `checkout --detach` 在這個情境下**真的會失敗**',
      rCo.status !== 0 && /would be overwritten|Aborting/i.test(String(rCo.stderr || '')),
      'exit=' + rCo.status + ' stderr=' + String(rCo.stderr || '').slice(0, 160));

    // ② 失敗被吞掉之後的狀態 ＝ 假綠的機制本身
    const headAfterCo = G(['rev-parse', 'HEAD'], wt).stdout.trim();
    const filesAfterCo = G(['ls-files'], wt).stdout.split('\n').filter(Boolean);
    chk('B2 ⭐⭐ 失敗被空 catch 吞掉之後，HEAD 仍停在舊 sha', headAfterCo === c1, headAfterCo);
    chk('B3 ⭐⭐⭐ 而且 index 仍然**沒有** b.txt —— 讀 `ls-files` 的守衛會整批漏掃新檔（假綠）',
      !filesAfterCo.includes('b.txt') && filesAfterCo.includes('a.txt'), filesAfterCo.join(','));

    // ③ 新寫法
    const rRs = G(['reset', '--mixed', '-q', c2], wt);
    chk('B4 ⭐⭐⭐ `reset --mixed` 在同一個情境下成功', rRs.status === 0,
      'exit=' + rRs.status + ' stderr=' + String(rRs.stderr || '').slice(0, 160));
    const headAfterRs = G(['rev-parse', 'HEAD'], wt).stdout.trim();
    const filesAfterRs = G(['ls-files'], wt).stdout.split('\n').filter(Boolean);
    chk('B5 ⭐⭐ reset 之後 HEAD 對齊', headAfterRs === c2, headAfterRs);
    chk('B6 ⭐⭐⭐ reset 之後 index 含 b.txt —— 讀 index 的守衛看得到新檔了',
      filesAfterRs.includes('b.txt'), filesAfterRs.join(','));
    const rIdx = G(['diff', '--cached', '--quiet', 'HEAD'], wt);
    chk('B7 ⭐⭐ reset 之後 index == HEAD（runner 的後置斷言不會誤紅）', rIdx.status === 0, 'exit=' + rIdx.status);
    chk('B8 ⭐⭐ reset **完全沒有動工作樹**（步驟 (b)(c) 的結果不被覆寫）',
      readFileSync(join(wt, 'a.txt'), 'utf8') === 'A2\n'
      && readFileSync(join(wt, 'b.txt'), 'utf8') === 'B1\n');
  } catch (e) {
    ok = false;
    chk('B ⚠ 行為端整組例外', false, String(e && e.message).slice(0, 300));
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* 清不掉不影響判準 */ }
  }
  void ok;
}

console.log('\n【C】本守衛自己必須在 npm test chain 裡（否則寫了等於沒寫）');
{
  const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const C = parseChain(String((PKG.scripts && PKG.scripts.test) || ''));
  const hits = C.scripts.filter((s) => s === SELF).length;
  chk('C1 ⭐ scripts.test 裡**恰好**有本檔一次', hits === 1, '出現 ' + hits + ' 次');
}

console.log('\n【D】「讀 index 的守衛」清單的過期偵測');
// ⚠ 這份清單在第一版寫成「3 支」，獨立審查抓到漏列兩個（test-v6378、lib/eol-agnostic）。
//   清單寫在註解與錯誤訊息裡 ⇒ 它會過期而且是靜默的（安慰劑型態 9 的近親）。
//   所以這裡**動態掃一次**，與清單雙向比對：多了要報（新來源沒被記下來）、
//   少了也要報（清單過期）。
const INDEX_READERS = new Map([
  ['scripts/lint-eol-anchors.mjs', 'ls-files -z scripts：掃 scripts 全體的 EOL 錨點（母體）'],
  ['scripts/test-v6130-bgm-lazy-and-licensing.mjs', 'ls-files / --others：static/music 母體'],
  ['scripts/test-v6272-firestore-read-reduction.mjs', 'ls-files --others：src/static 未追蹤檔'],
  ['scripts/test-v6378-eol-harness-and-t-split.mjs', 'ls-files --others：static/music 殘檔'],
  ['scripts/lib/eol-agnostic.mjs', 'ls-files --eol：經 committedEolIsLf 被 12 支守衛使用'],
  ['scripts/test-v6377-eol-anchors-and-orphan-harness.mjs', '⚠ 只是突變用的字串字面，不是真的讀 index'],
  ['scripts/run-tests.mjs', 'ls-files --others：runner 自己建同步清單（在主樹跑，不受沙盒 index 影響）'],
  ['scripts/test-sandbox-head-index.mjs', '⚠ 本檔自己：B 組的行為端與 D3 正對照都用到這個字面'],
]);
/** 判準只有一份：正式斷言與正反對照呼叫同一個函式。 */
export function readsIndex(src) {
  return /['"]ls-files['"]/.test(src);
}
{
  const files = [];
  for (const d of ['scripts', 'scripts/lib']) {
    let ents = [];
    try { ents = readdirSync(join(ROOT, d)); } catch { ents = []; }
    for (const f of ents) if (f.endsWith('.mjs')) files.push(d + '/' + f);
  }
  chk('D0 ⭐ 母體下限：掃到的 scripts/**.mjs ≥ 800（掃描器壞掉要在這裡爆，不可以靜默回空集合）',
    files.length >= 800, '實際 ' + files.length);
  const hit = [];
  for (const rel of files) {
    let src = '';
    try { src = normEol(readFileSync(join(ROOT, rel), 'utf8')); } catch { continue; }
    let clean;
    try { clean = stripCommentsBlankChecked(src, rel); } catch { clean = src; }
    if (readsIndex(clean)) hit.push(rel);
  }
  const known = new Set(INDEX_READERS.keys());
  const extra = hit.filter((x) => !known.has(x));
  const gone = [...known].filter((x) => !hit.includes(x));
  chk('D1 ⭐⭐⭐ 沒有**新的**讀 index 來源沒被記進清單（有的話 Rule 59 的影響面就寫錯了）',
    extra.length === 0, extra.join(', '));
  chk('D2 ⭐⭐ 清單裡的每一條都還在（過期偵測，不可以靜默縮短）',
    gone.length === 0, gone.join(', '));
  chk('D3 ★ 正對照：判準抓得到人造樣本',
    readsIndex("const r = spawnSync('git', ['ls-files', '-z', 'src']);"));
  chk('D4 ★ 反對照：不讀 index 的樣本不得誤判',
    !readsIndex("const r = spawnSync('git', ['ls-tree', '-r', 'HEAD', '--name-only']);"));
}

console.log(`\n=== 沙盒 HEAD/index：PASS ${P} / FAIL ${F} ===`);
assert.strictEqual(F, 0, `有 ${F} 條失敗`);
