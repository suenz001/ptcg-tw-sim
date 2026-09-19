// ════════════════════════════════════════════════════════════════════════════
// scripts/lib/tracked-scope.mjs —— 「哪些檔算是本專案的原始碼」這個母體的**單一判準**
//
// 為什麼要有這支：全站掃描型的守衛（test-v6380 掃 import 宣告、test-source-encoding 掃
// 編碼……）都要先決定「掃哪些檔」。這個母體若各寫各的，就會出現兩種失效：
//   ① 母體太寬：守衛把**殘檔**也掃進去。實測 2026-09 曾累積 405 個 esbuild 暫存檔，
//      其中 scripts/.v6380-positive-control.mjs（上一輪中斷留下的正對照檔，內容是
//      `import x from 'definitely-not-a-real-package-v6380'`）讓 test-v6380 的
//      B1/B2/D2 三條翻紅 —— 純粹由殘檔造成的假紅。
//   ② 母體太窄：用 /^(tmp|_|\.)/ 這種檔名樣式濾掉，會連站長手寫的 `_repro_*.mjs`
//      一起漏掉 —— 而那些檔**一旦被 `git add -A` 就會進版控**，正是最需要被掃的。
//
// ⭐ 正解是問 git：**「這個檔有沒有被 .gitignore 忽略」**。
//   殘檔已經在 .gitignore 裡（列管過了）⇒ 自動排除；
//   `_repro_*.mjs` 沒有被忽略 ⇒ 自動留下。判準與「會不會進版控」完全一致。
//
// ⚠ 失效方向是 fail-closed：git 拿不到答案時回傳「全部都不忽略」⇒ 母體變大 ⇒ 掃得更嚴，
//   不會讓違規溜過去。但 git 真的出錯（exit 128）仍然 throw，不靜默吞掉。
// ════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

/**
 * 從一批絕對路徑裡，濾掉「被 .gitignore 忽略」的。
 * @param {string} root  repo 根
 * @param {string[]} absPaths
 * @returns {string[]} 未被忽略的（順序保持不變）
 */
export function filterNotIgnored(root, absPaths) {
  if (!absPaths.length) return [];
  const rels = absPaths.map((p) => relative(root, p).split('\\').join('/'));
  let ignored = new Set();
  try {
    const out = execFileSync('git', ['-C', root, 'check-ignore', '--stdin'],
      { input: rels.join('\n'), encoding: 'utf8', maxBuffer: 1 << 28 });
    ignored = new Set(out.split(/\r?\n/).filter(Boolean).map((x) => x.split('\\').join('/')));
  } catch (e) {
    // git check-ignore 的 exit code：0 = 有被忽略的／1 = 一個都沒有／其餘 = 真的錯了
    if (e && e.status === 1) {
      ignored = new Set();
    } else if (e && e.status === 128) {
      // 不是 git repo（例如某些沙盒）⇒ 回傳全部，母體變大＝掃得更嚴（fail-closed）
      return absPaths.slice();
    } else {
      throw e;   // ⚠ 其他錯誤不吞：靜默吞掉會讓母體判準無聲失效
    }
  }
  return absPaths.filter((_, i) => !ignored.has(rels[i]));
}

/** 單一路徑版（給只需要問一個檔的地方用；批次一律用 filterNotIgnored）。 */
export function isIgnored(root, absPath) {
  return filterNotIgnored(root, [absPath]).length === 0;
}
