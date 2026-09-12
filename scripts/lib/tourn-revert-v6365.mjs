// ⭐⭐⭐ v6.365 錦標賽區塊 revert-diff 的**唯一資料來源**（v6.292 的續章）。
//
// 為什麼要再獨立一支（沿用 v6.291 → v6.292 的既有形狀）：
//   v6.365（站長裁定 六-2：錦標賽平手＝雙敗）在錦標賽區塊內新增了三段程式碼。
//   如果不把這三段也還原掉，下列守衛會同時翻紅，而且全部是「合法改動撞到歷史錨」：
//     ・test-v6291 B1/B2/B4      ・test-v6292 B1/B2/B3/B5
//     ・test-v6276 B1/B2         ・test-v6266 F1／test-v6268 H1／test-v6278 I1（長度＋sha）
//   而「把它改成不驗／只比片段／加 || 放寬」是站長明文禁止的（那等於把鎖拆掉）。
//   ⇒ 全部守衛都從這裡 import 同一份還原器，鏈起來仍然是
//     「v6.365 → v6.292 → v6.291 → v6.276 → v6.275 / v6.290」的完整逐位元證明，
//     一個位元都沒放水。
//
// ⚠ v6.365 的三段**全部是純新增**，而且每一段都用 `// >>> v6365-xxx` … `// <<< v6365-xxx`
//   哨兵框住；既有的行一個字都沒改（`if (wSeat == null) return;` 原封不動留在哨兵外）。
//   所以「剝掉哨兵區塊」就等於「逐位元回到 v6.364」—— 這一點由 test-v6303 H3 的
//   哨兵剝除器（它比的是 server_admin_patch.js 與它自己的 BASE）獨立驗證。
//
// ⚠ 這支是**資料 ＋ 純函式**，不做任何 I/O、不自己下判準；紅綠由呼叫端決定。
// ⚠ 還原器對「哨兵出現次數不合理」「還原後仍有 v6365 痕跡」一律 AssertionError ——
//   區塊被動了「宣告之外」的地方就會在這裡爆，不會靜默把東西一起吃掉
//   （沿用 v6.276 revertTail／v6.291 revertV6291／v6.292 revertV6292 的同一條紀律）。
import assert from 'node:assert';
import {
  revertV6292, revertToV6290,
  NEW_TAIL_SHA_V6292, NEW_TEV_SHA_V6292, NEW_TEV_LEN_V6292,
} from './tourn-revert-v6292.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';

/** v6.365 之前（＝v6.292）的區塊指紋 —— 只還原 v6.365 的三段後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V6292 = NEW_TAIL_SHA_V6292;
export const OLD_TEV_SHA_V6292 = NEW_TEV_SHA_V6292;
export const OLD_TEV_LEN_V6292 = NEW_TEV_LEN_V6292;

/**
 * v6.365 之後的新指紋 —— 全站 14 把區塊鎖都必須重釘到這三個值
 * （test-v6291 B4 / test-v6292 B5 在守；舊值零殘留也在守）。
 * ⚠⚠ 這三個值是對 **LF**（倉庫與 CI 的實際內容）算出來的。
 *   本機工作樹若是 CRLF（core.autocrlf=true），這些守衛在本機會紅 —— 那是行尾假紅，
 *   判準以 LF 為準（用 __m6a/lfsim365.mjs 可在本機模擬 CI）。
 */
export const NEW_TAIL_SHA_V6365 = 'dc50464ff6843c4903080305afbdab4597b755fa89e2d623fb6a25cb314f0ff9';
export const NEW_TEV_SHA_V6365 = 'ec75c9673267ece3c9cc6ed3858c6ec7b88926f0fd29c18558303916c3c240c2';
export const NEW_TEV_LEN_V6365 = 223610;   // JS 字串長度（UTF-16 code unit；區塊內 emoji 各算 2）

/**
 * 本版在錦標賽區塊內新增的三段，逐字以哨兵標籤宣告。
 *   ・v6365-gamedraw-wording            noChampionReason 的措辭前置早退（規則平手不可說成「時限到」）
 *   ・v6365-tournament-draw-double-loss onMatchGameOver 的平手雙敗分支（CAS 搶占 ＋ 公告 ＋ 推進輪次）
 *   ・v6365-reconcile-draw              level-triggered 對帳多一條 isDraw 前置分支
 * ⚠ 三段都落在 TAIL_ANCHOR 與 TEV_ANCHOR 兩個切片**之內**（TEV 錨點在前，L6995 < L8344）。
 */
export const V6365_TAGS = Object.freeze([
  'v6365-gamedraw-wording',
  'v6365-tournament-draw-double-loss',
  'v6365-reconcile-draw',
]);

/** 產生某一個哨兵標籤的區塊比對式（LF／CRLF 皆可）。 */
function tagRe(tag) {
  return new RegExp('[ \\t]*\\/\\/ >>> ' + tag + '\\r?\\n[\\s\\S]*?[ \\t]*\\/\\/ <<< ' + tag + '\\r?\\n', 'g');
}

/**
 * 把 v6.365 的三段哨兵區塊逐字還原掉（**只**還原本版；v6.292／v6.291 的插入仍在）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 * @returns {string} 還原後的區塊
 */
export function revertV6365(block) {
  let r = block;
  let removed = 0;
  for (const tag of V6365_TAGS) {
    const n = (r.match(tagRe(tag)) || []).length;
    assert.ok(n <= 1,
      'revert-v6365：哨兵 ' + tag + ' 出現 ' + n + ' 次（最多 1）—— 區塊被動了「宣告之外」的地方');
    if (n === 1) { r = r.replace(tagRe(tag), ''); removed++; }
  }
  assert.ok(removed >= 1,
    'revert-v6365：這一段裡一個 v6.365 哨兵區塊都沒有 ⇒ 還原器對它是 no-op '
    + '（若 v6.365 的改動真的被拿掉了，請把呼叫端的新指紋一起改回去，不要留一個假還原器）');
  // ⭐ 還原後不得留下任何 v6.365 的痕跡：哨兵被搬走／改名／把新增碼寫到哨兵外都會在這裡爆。
  assert.strictEqual(r.split('v6365').length - 1, 0,
    'revert-v6365：還原後區塊裡仍有 v6365 字樣 —— 有未宣告（哨兵外）的插入');
  assert.strictEqual(r.split('gameDraw').length - 1, 0,
    'revert-v6365：還原後區塊裡仍有 gameDraw —— 有未宣告（哨兵外）的插入');
  return r;
}

/** 一次還原到 v6.292（＝只把本版剝掉）。 */
export function revertToV6292(block) {
  return revertV6365(block);
}
/** 一次還原到 v6.291（v6.365 → v6.292）。 */
export function revertToV6291(block) {
  return revertV6292(revertV6365(block));
}
/** 一次還原到 v6.290（v6.365 → v6.292 → v6.291）。呼叫端要再往 v6.275 串就自己接 revertTail()。 */
export function revertV6365ToV6290(block) {
  return revertToV6290(revertV6365(block));
}

/**
 * ⭐ A4 型（「本版零刪除：資料路徑數量與 BASE 相同」）的**中央剝除器**。
 * 把**版本號大於 floor 的、已宣告的哨兵區塊**整段剝掉，再讓呼叫端去數資料路徑。
 * 這不是放寬：反過來它要求「任何後續版本新增的資料路徑，一律必須寫在宣告過的哨兵區塊裡」，
 * 寫在哨兵外就會讓數量對不上而翻紅。
 * @param {string} src 原始碼
 * @param {number} floor 版本下限（只剝 > floor 的）
 */
export function stripDeclaredBlocksNewerThan(src, floor) {
  return src.replace(
    /[ \t]*\/\/ >>> v(\d+)-[\w-]+[\s\S]*?\/\/ <<< v\1-[\w-]+\r?\n/g,
    (m, v) => (Number(v) > floor ? '' : m),
  );
}
