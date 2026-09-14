// ⭐⭐⭐ v6.384 錦標賽區塊 revert-diff 的**唯一資料來源**（v6.381 的續章）。
//
// 為什麼要再獨立一支（沿用 v6.291 → v6.292 → v6.365 → v6.381 的既有形狀）：
//   v6.384（站長 2026-09-14 裁定：休閒對戰的建立房間／加入／觀戰也要過版本閘）
//   在錦標賽區塊內**純新增**了一支公開端點 `GET /api/client-min-version`。
//   如果不把它還原掉，下列守衛會同時翻紅，而且全部是「合法改動撞到歷史錨」：
//     ・test-v6291 B1/B2/B4      ・test-v6292 B1/B2/B3/B5
//     ・test-v6276 B1/B2/B4      ・test-v6371 F4b
//     ・test-v6265／v6266／v6268／v6272／v6275／v6278／v6282~v6289／v6295／v6300／v6302 的區塊鎖
//   而「把它改成不驗／只比片段／加 || 放寬」是站長明文禁止的（那等於把鎖拆掉）。
//   ⇒ 全部守衛都從這裡 import 同一份還原器，鏈起來仍然是
//     「v6.384 → v6.381 → v6.365 → v6.292 → v6.291 → v6.276 → v6.275 / v6.290」
//     的完整逐位元證明，一個位元都沒放水。
//
// ⭐ 與 v6.381 不同：v6.384 **完全是純新增**（一個既有行都沒動）⇒ 只需要哨兵剝除，
//   不需要 v6.292／v6.381 那種「逐字快照 ＋ 逐字移除」。這也是它能做成純新增的理由：
//   新端點自成一個 `app.get(...)`，不必插進任何既有敘述中間。
//
// ⚠ 這支是**資料 ＋ 純函式**，不做任何 I/O、不自己下判準；紅綠由呼叫端決定。
// ⚠ 還原器對「命中次數不合理」「還原後仍有 v6384 痕跡」一律 AssertionError ——
//   區塊被動了「宣告之外」的地方就會在這裡爆，不會靜默把東西一起吃掉。
import assert from 'node:assert';
import {
  revertV6381,
  NEW_TAIL_SHA_V6381, NEW_TEV_SHA_V6381, NEW_TEV_LEN_V6381,
} from './tourn-revert-v6381.mjs';
import { revertV6365 } from './tourn-revert-v6365.mjs';
import { revertV6292 } from './tourn-revert-v6292.mjs';
import { revertV6291 } from './tourn-revert-v6291.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';
export { revertV6381 } from './tourn-revert-v6381.mjs';
// ⚠ 鏈上更早的舊指紋一併轉出去：消費者（test-v6381）import 的來源改指這一支之後，
//   若不轉出去它會拿不到 v6.365 的對照值（鏈就斷在這裡）。
export { OLD_TAIL_SHA_V6365, OLD_TEV_SHA_V6365, OLD_TEV_LEN_V6365 } from './tourn-revert-v6381.mjs';
export { revertV6365, stripDeclaredBlocksNewerThan } from './tourn-revert-v6365.mjs';

/** v6.384 之前（＝v6.381）的區塊指紋 —— 只還原 v6.384 的改動後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V6381 = NEW_TAIL_SHA_V6381;
export const OLD_TEV_SHA_V6381 = NEW_TEV_SHA_V6381;
export const OLD_TEV_LEN_V6381 = NEW_TEV_LEN_V6381;

/**
 * v6.384 之後的新指紋 —— 全站的區塊鎖都必須重釘到這三個值
 * （test-v6291 B4 / test-v6292 B5 在守；舊值零殘留也在守）。
 * ⚠⚠ 這三個值是對 **LF**（倉庫與 CI 的實際內容）算出來的：
 *   讀檔一律 `normEol(readFileSync(...))`，直接對 CRLF 工作樹算會全部對不上。
 */
export const NEW_TAIL_SHA_V6384 = '9b234e690ec261cafc40031b0730821042ef625e4383c8e46b9df857cb2df4d1';
export const NEW_TEV_SHA_V6384 = '09370edc9c304d729962d0a0e4d4b6757e810a7029f264486979f39475b25486';
export const NEW_TEV_LEN_V6384 = 225471;   // JS 字串長度（UTF-16 code unit；區塊內 emoji 各算 2）

/** 本版純新增的區塊（唯一一個哨兵）。 */
export const V6384_TAGS = Object.freeze(['v6384-public-min-client-version']);

/** 產生某一個哨兵標籤的區塊比對式（LF／CRLF 皆可）。 */
function tagRe(tag) {
  return new RegExp('[ \\t]*\\/\\/ >>> ' + tag + '\\r?\\n[\\s\\S]*?[ \\t]*\\/\\/ <<< ' + tag + '\\r?\\n', 'g');
}

/**
 * 把 v6.384 新增的哨兵區塊逐字剝掉（**只**還原本版；更早各版的插入仍在）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 * @returns {string} 還原後的區塊
 */
export function revertV6384(block) {
  let r = block;
  let touched = 0;
  for (const tag of V6384_TAGS) {
    const n = (r.match(tagRe(tag)) || []).length;
    assert.ok(n <= 1,
      'revert-v6384：哨兵 ' + tag + ' 出現 ' + n + ' 次（最多 1）—— 區塊被動了「宣告之外」的地方');
    if (n === 1) { r = r.replace(tagRe(tag), ''); touched++; }
  }
  assert.ok(touched >= 1,
    'revert-v6384：這一段裡一處 v6.384 的改動都沒有 ⇒ 還原器對它是 no-op '
    + '（若 v6.384 的改動真的被拿掉了，請把呼叫端的新指紋一起改回去，不要留一個假還原器）');
  // ⭐ 還原後不得留下任何 v6.384 的痕跡：哨兵被搬走／改名／把新增碼寫到宣告外都會在這裡爆。
  assert.strictEqual(r.split('v6384').length - 1, 0,
    'revert-v6384：還原後區塊裡仍有 v6384 字樣 —— 有未宣告的插入');
  assert.strictEqual(r.split('/api/client-min-version').length - 1, 0,
    'revert-v6384：還原後區塊裡仍有 /api/client-min-version —— 有未宣告的插入');
  return r;
}

/** 一次還原到 v6.381（＝只把本版剝掉）。 */
export function revertToV6381(block) {
  return revertV6384(block);
}
/** 一次還原到 v6.365（v6.384 → v6.381）。 */
export function revertToV6365(block) {
  return revertV6381(revertV6384(block));
}
/** 一次還原到 v6.292（v6.384 → v6.381 → v6.365）。 */
export function revertToV6292(block) {
  return revertV6365(revertV6381(revertV6384(block)));
}
/** 一次還原到 v6.291。 */
export function revertToV6291(block) {
  return revertV6292(revertV6365(revertV6381(revertV6384(block))));
}
/** 一次還原到 v6.290。呼叫端要再往 v6.275 串就自己接 revertTail()。 */
export function revertV6384ToV6290(block) {
  return revertV6291(revertV6292(revertV6365(revertV6381(revertV6384(block)))));
}
