// ⭐⭐⭐ v6.292 錦標賽區塊 revert-diff 的**唯一資料來源**（v6.291 的續章）。
//
// 為什麼要再獨立一支：v6.291 已經把「區塊 ＝ v6.290 ＋ 恰好 3 行」抽成
//   scripts/lib/tourn-revert-v6291.mjs，而 v6.276 的守衛則再往前串一層
//   （先 revertV6291() 再 revertTail() ⇒ 逐位元回到 v6.275）。v6.292 又在區塊內插了 6 行
//   ⇒ 若不把這 6 行也還原掉，v6.276 的 B1/B2 與 v6.291 的 B2 會同時翻紅，
//     而「把它改成不驗／只比片段」是站長明文禁止的（那等於把鎖拆掉）。
//   ⇒ 三支守衛都從這裡 import 同一份還原器，鏈起來仍然是
//     「v6.292 → v6.291 → v6.276 → v6.275」的完整逐位元證明，一個位元都沒放水。
//
// ⚠ 這支是**資料 ＋ 純函式**，不做任何 I/O、不自己下判準；紅綠由呼叫端決定。
// ⚠ 還原器對「出現次數 ≠ 1」一律 AssertionError —— 區塊被動了「宣告之外」的地方就會在這裡爆，
//   不會靜默把多處一起吃掉（沿用 v6.276 revertTail／v6.291 revertV6291 的同一條紀律）。
import assert from 'node:assert';
import {
  revertV6291,
  NEW_TAIL_SHA_V6291, NEW_TEV_SHA_V6291, NEW_TEV_LEN_V6291,
} from './tourn-revert-v6291.mjs';

/** v6.292 之前（＝v6.291）的區塊指紋 —— 只還原 v6.292 那 5 行後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V6291 = NEW_TAIL_SHA_V6291;
export const OLD_TEV_SHA_V6291 = NEW_TEV_SHA_V6291;
export const OLD_TEV_LEN_V6291 = NEW_TEV_LEN_V6291;

/** v6.292 之後的新指紋 —— 全站 14 把鎖都必須重釘到這兩個值（test-v6292 的 B5 在守）。 */
export const NEW_TAIL_SHA_V6292 = 'c0891b6f200ab4e3898c50aa77365458d2207870e828dc28bbfb44df81ddcda3';
export const NEW_TEV_SHA_V6292 = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40';
export const NEW_TEV_LEN_V6292 = 220560;   // JS 字串長度（UTF-16 code unit；區塊內 emoji 各算 2）

/**
 * 本版納入 gate 的六支端點。
 * ⚠ 其餘端點刻意不動，理由見 server_admin_patch.js 的 helper 註解與 docs/changelog-internal.md：
 *   /propose 有 `!id.email` 擋（fallback 的 email 恆為 null）；/join、/action、/still-here 有
 *   `doc.matchId && !verified` 擋；/reset 根本沒叫 tournIdentity（固定名稱的測試房）；
 *   /clientdiag 是純遙測，未驗證身分只會污染統計、不動賽事狀態。
 * ⚠ /cancel-proposal 本來被 v6.291 的紀錄判成「已被 ev.proposerUid !== id.uid 大幅限縮」——
 *   **那是判錯了**：playerId fallback 就是用來冒充發起者 uid 的，那道檢查一點都擋不住 ⇒ 本版收進來。
 */
export const V6292_ENDPOINTS = ['drop', 'unregister', 'cancel-proposal', 'chat', 'match/enter', 'match/forfeit'];

/** 五行插入的**逐字**快照（含縮排、行尾註解與換行）。 */
export const V6292_GATE_LINES = Object.freeze({
  'drop': "        if (tournRequireVerified(id, res, 'drop')) return;   // ⭐⭐⭐v6.292 冒名閘（helper 定義在 tournIdentity 正下方，v6.291）\n",
  'unregister': "        if (tournRequireVerified(id, res, 'unregister')) return;   // ⭐⭐⭐v6.292 冒名閘（helper 定義在 tournIdentity 正下方，v6.291）\n",
  'cancel-proposal': "        if (tournRequireVerified(id, res, 'cancel-proposal')) return;   // ⭐⭐⭐v6.292 冒名閘（helper 定義在 tournIdentity 正下方，v6.291）\n",
  'chat': "        if (tournRequireVerified(id, res, 'chat')) return;   // ⭐⭐⭐v6.292 冒名閘（helper 定義在 tournIdentity 正下方，v6.291）\n",
  'match/enter': "        if (tournRequireVerified(id, res, 'match/enter')) return;   // ⭐⭐⭐v6.292 冒名閘（helper 定義在 tournIdentity 正下方，v6.291）\n",
  'match/forfeit': "        if (tournRequireVerified(id, res, 'match/forfeit')) return;   // ⭐⭐⭐v6.292 冒名閘（helper 定義在 tournIdentity 正下方，v6.291）\n",
});

/**
 * 把 v6.292 的 6 行插入逐字還原掉（**只**還原本版，v6.291 的 3 行仍在）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 * @returns {string} 還原後的區塊
 */
export function revertV6292(block) {
  let r = block;
  for (const ep of V6292_ENDPOINTS) {
    const line = V6292_GATE_LINES[ep];
    const n = r.split(line).length - 1;
    assert.strictEqual(n, 1,
      'revert-v6292：' + ep + ' 的 gate 行出現 ' + n + ' 次（應恰 1）—— 區塊被動了「宣告之外」的地方');
    r = r.replace(line, '');
  }
  // ⚠ v6.291 的 3 行**還在**（本函式刻意不碰它們）⇒ 這裡只能斷言「沒有第 9 處未宣告的插入」。
  const rest = r.split('tournRequireVerified(').length - 1;
  assert.strictEqual(rest, 3,
    'revert-v6292：還原後區塊內仍有 ' + rest + ' 處 tournRequireVerified（應恰 3＝v6.291 的三支）—— 有未宣告的插入？');
  return r;
}

/** 一次還原到 v6.290（v6.292 → v6.291）。呼叫端要再往 v6.275 串就自己接 revertTail()。 */
export function revertToV6290(block) {
  return revertV6291(revertV6292(block));
}
