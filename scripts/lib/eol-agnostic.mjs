// ⭐ v6.371 中央 helper：**行尾中性**的「多行字串字面」定位／取代／比對。
//
// 背景（站長裁定 六-7；v6.371 實測而非推論）：
//   本專案的工作樹是 CRLF（`core.autocrlf`），但 `git cat-file -p <sha>:<path>` 吐的是 **LF**。
//   守衛裡到處都是「用多行字串字面當錨點」的寫法：
//     const A = "    if (room.gameState) {\n      const incoming = room.gameState;";
//     const i = src.indexOf(A);            // ← CRLF 工作樹永遠 -1
//   以及「BASE blob（LF）對現況檔（CRLF）逐字比對」：
//     assert.strictEqual(readFileSync(cur, 'utf8'), readBaseBlob(...).out);   // ← 永遠不等
//   ⇒ 在 Windows 本機**永久紅**；在 CI／LF 免疫測試網**永久綠**。
//   兩種下場都很糟：本機紅燈久了就沒人看（真紅燈被淹沒），LF 綠燈則是**假綠**
//   —— 突變層（「改壞了必須紅」）根本沒有跑到，等於零保護力。
//
// ⚠⚠ 這支 helper 的存在意義是 **Rule 38 中央收斂**：不要在每一個錨點各補一次
//   `.replace(/\r\n/g,'\n')`。散裝補法的下場已經看過了 —— test-v6265 的 F4 裡有五份
//   各自手寫的 `swap(str, from, to)`（LF/CRLF 各試一次），漏掉的那幾處就是現在的紅燈。
//
// ⚠⚠ 本 helper **不決定**測試的紅綠，也**絕不靜默吞掉**失敗：
//   `eolReplaceOnce` 找不到／找到多處時回 `{ ok:false, count }`，由呼叫端把它變成一條紅。
//   「錨點過期了就默默不取代、然後宣告突變成功」是最嚴重的安慰劑（第十一種）。

/** 正則逸出（抄 __m6a/bump369.mjs 的 esc()）。 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 needle 做成「行尾中性」的正則來源字串：每一個換行都吃 `\r\n` 或 `\n`。
 * ⚠ 先把 CRLF 收斂成 LF 再逸出，否則 `\r` 會被單獨逸出成字面 `\r`（＝只吃 CRLF）。
 */
export function eolRxSource(needle) {
  return esc(String(needle).replace(/\r\n/g, '\n')).replace(/\n/g, '\\r?\\n');
}

/** 行尾中性的正則（預設全域）。 */
export function eolRx(needle, flags = 'g') {
  return new RegExp(eolRxSource(needle), flags);
}

/** needle 在 hay 裡出現幾次（行尾中性）。 */
export function eolCount(hay, needle) {
  return (String(hay).match(eolRx(needle)) || []).length;
}

/**
 * 行尾中性的 indexOf。找不到回 -1。
 * ⚠ 只回索引；需要「結束位置」（例如 `src.slice(i, j + needle.length)` 這種寫法）請用 eolFind。
 */
export function eolIndexOf(hay, needle, from = 0) {
  const f = eolFind(hay, needle, from);
  return f ? f.index : -1;
}

/**
 * 行尾中性的尋找。回 `{ index, end, text }`（`text` 是**實際**匹配到的字串，行尾照現況），
 * 找不到回 `null`。`end` 是「匹配結束的下一個索引」⇒ `hay.slice(f.index, f.end)` 就是 f.text。
 */
export function eolFind(hay, needle, from = 0) {
  const s = String(hay);
  const re = eolRx(needle, 'g');
  re.lastIndex = Math.max(0, from | 0);
  const m = re.exec(s);
  return m ? { index: m.index, end: m.index + m[0].length, text: m[0] } : null;
}

/**
 * 把 repl 的行尾對齊 sample 的行尾（sample 裡有 `\r\n` 就把 repl 的 `\n` 全換成 `\r\n`）。
 * 用途：取代字串本身也是多行時，不要在 CRLF 檔案裡塞進 LF 造成混行尾。
 */
export function matchEol(repl, sample) {
  const lf = String(repl).replace(/\r\n/g, '\n');
  return /\r\n/.test(String(sample)) ? lf.replace(/\n/g, '\r\n') : lf;
}

/**
 * 行尾中性的「恰好取代一次」。
 * @returns {{ ok: boolean, out: string, count: number, text: string }}
 *   `ok` 只有在**恰好出現一次**時才是 true；其餘情況 `out` 原樣回傳（不做任何取代），
 *   由呼叫端自己決定要不要變成紅燈。⚠ 不要 `if (!r.ok) return;` 就算了。
 */
export function eolReplaceOnce(hay, needle, repl) {
  const s = String(hay);
  const count = eolCount(s, needle);
  if (count !== 1) return { ok: false, out: s, count, text: '' };
  const f = eolFind(s, needle);
  // 取代字串的行尾要跟著**匹配到的那一段**；單行錨點沒有行尾訊號時，跟著整份檔案的行尾。
  const crlfHere = f.text.includes('\r\n') || (!/\n/.test(String(needle)) && /\r\n/.test(s));
  const to = matchEol(repl, crlfHere ? '\r\n' : '\n');
  return { ok: true, out: s.slice(0, f.index) + to + s.slice(f.end), count, text: f.text };
}

/**
 * 行尾中性的「全部取代」。回 `{ out, count }`；`count === 0` 時呼叫端要自己判定是不是錯誤。
 */
export function eolReplaceAll(hay, needle, repl) {
  const s = String(hay);
  let count = 0;
  const out = s.replace(eolRx(needle, 'g'), (m) => { count++; return matchEol(repl, m.includes('\r\n') ? '\r\n' : '\n'); });
  return { out, count };
}

/**
 * 把字串正規化成 LF。
 * ⭐ 專門給「現況檔（CRLF 工作樹）vs BASE blob（`git cat-file -p` 一律 LF）」的逐字比對用。
 * ⚠ 這**不是**放寬判準：不正規化的話那條斷言在 Windows 上是**永久紅**、在 LF 上才綠，
 *   等於「判準依機器而定」。正規化之後兩種機器得到同一個結論，內容差異照樣一個字都跑不掉。
 * ⚠ 但它確實**不再**守「行尾本身」—— 行尾由 `.gitattributes`／`core.autocrlf` 管，
 *   另有 `scripts/test-bat-crlf.mjs` 在守。
 */
export function normEol(s) {
  return String(s).replace(/\r\n/g, '\n');
}

// ══ v6.378 C-7：「這個檔案**被 commit 的內容**是不是 LF」 ══════════════════
/**
 * ⚠⚠ 為什麼**不可以**用工作樹的位元組判斷行尾（本版把 11 支守衛從這個寫法搬過來）：
 *   站長的 Windows 是 `core.autocrlf=true` ⇒ 任何被 git 判定為 text 的檔案，
 *   **工作樹一律是 CRLF**；但真正會被部署的是 **index/blob 的內容**
 *   （GitHub Actions 的 actions/checkout 在 Linux 上取出來的就是它）。
 *   ⇒ `!readFileSync(p).includes('\r\n')` 這種寫法在本機**恆紅**、在 CI **恆綠**，
 *     兩邊都沒有在守 —— 它量的是 checkout 設定，不是那個檔案。
 *
 * ⭐ 正解：直接問 git「index 的行尾是什麼」（`git ls-files --eol`）。
 *   - CI／LF checkout：index 與工作樹逐位元相同 ⇒ 與舊寫法**完全等價**（不是放寬）。
 *   - CRLF 工作樹：改成檢查真正會被部署的那份位元組 ⇒ 從恆紅變成真的在守。
 *
 * ⚠ 這**不是**恆真式：本 repo 現在就有 12 個 `i/crlf` 的追蹤檔（.bat 那一批，
 *   例如 oracle-admin/dump-monitor.bat）—— 拿它們當負對照必須回 false。
 *   （scripts/test-v6378-*.mjs 有正／負對照把這件事鎖住。）
 *
 * ⚠ 拿不到 git（沒有 git／不是 repo／檔案未追蹤）⇒ **退回**檢查工作樹位元組，
 *   也就是舊寫法，並在 `how` 據實回報是哪一條路徑（不假裝有在守）。
 */
export function indexEol(root, rel) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '--eol', '--', rel],
      { maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    const m = /(?:^|\n)i\/(\S+)\s/.exec(out);
    return m ? m[1] : null;      // 未追蹤 ⇒ git 不會輸出任何一行
  } catch { return null; }       // 沒有 git／不是 repo
}

/**
 * @returns {{ ok: boolean, how: 'index'|'worktree'|'missing', detail: string }}
 *   `ok` ＝「會被部署的那份位元組沒有 CRLF」。`how` 說明這次是走哪一條路徑判定的。
 */
export function committedEolIsLf(root, rel) {
  const i = indexEol(root, rel);
  if (i !== null) {
    return { ok: i === 'lf' || i === 'none', how: 'index', detail: 'git index 行尾＝i/' + i };
  }
  let buf;
  try { buf = readFileSync(join(root, rel)); }
  catch (e) { return { ok: false, how: 'missing', detail: '讀不到檔案：' + (e && e.message ? e.message : e) }; }
  const has = buf.includes(Buffer.from('\r\n'));
  return {
    ok: !has, how: 'worktree',
    detail: '拿不到 git index（未追蹤／沒有 git）⇒ 退回工作樹位元組：' + (has ? '有 CRLF' : '全 LF'),
  };
}
