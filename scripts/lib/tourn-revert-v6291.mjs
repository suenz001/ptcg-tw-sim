// ⭐⭐⭐ v6.291 錦標賽區塊 revert-diff 的**唯一資料來源**。
//
// 為什麼要獨立成一支：v6.276 的 `test-v6276-deck-tournament-stats.mjs` 用 revert-diff 證明
//   「錦標賽區塊 ＝ v6.275 ＋ 恰好那 6 處 additive 插入」。v6.291 是 v6.276 之後**第一個**
//   再度動到區塊內部的版本 ⇒ 若不把 v6.291 的插入也還原掉，v6.276 的 B1/B2 會直接翻紅，
//   而「把它改成不驗／只比片段」是站長明文禁止的（那等於把鎖拆掉）。
//   ⇒ 兩支守衛都從這裡 import 同一份還原器：v6.276 先 revertV6291() 再跑自己的 revertTail()，
//     鏈起來仍然是「逐位元回到 v6.275」的完整證明，一個位元都沒放水。
//
// ⚠ 這支是**資料 ＋ 純函式**，不做任何 I/O、不自己下判準；紅綠由呼叫端決定。
// ⚠ 還原器對「出現次數 ≠ 1」一律 AssertionError —— 區塊被動了「宣告之外」的地方就會在這裡爆，
//   不會靜默把多處一起吃掉（v6.276 revertTail 的同一條紀律）。
import assert from 'node:assert';

/** 區塊錨點（兩把鎖各自的起點；全站 14 支守衛共用這兩個字面量）。 */
export const TAIL_ANCHOR = "app.get('/api/tournament";
export const TEV_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";

/** v6.291 之前（v6.276~v6.290）的區塊指紋 —— 還原後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V6290 = '495221f1dbf51dea9020284147fcf9b271d2baeccdac8d3b4745110c409dca02';
export const OLD_TEV_SHA_V6290 = '93d29a7d68b1508c9201b660ef38f06418fc5760606bb87798f8bdd5f5ed9fdd';
export const OLD_TEV_LEN_V6290 = 219484;   // JS 字串長度（UTF-16 code unit；區塊內 emoji 各算 2）

/** v6.291 之後的新指紋 —— 全站 14 把鎖都必須重釘到這兩個值（test-v6291 的 B5 在守）。 */
export const NEW_TAIL_SHA_V6291 = 'd43fe3e575456c4c885b8d84eb278d2a59e29b96fe94341d3a2bcf25e0097c99';
export const NEW_TEV_SHA_V6291 = 'fc015380210f69fd159ff859c047678d748930496bd3d474e4c3c41d42415138';
export const NEW_TEV_LEN_V6291 = 219837;

/** 本版納入 gate 的三支端點（其餘端點刻意不動，理由見 server_admin_patch.js 的 helper 註解）。 */
export const V6291_ENDPOINTS = ['checkin', 'register', 'register-and-checkin'];

/** 三行插入的**逐字**快照（含縮排、行尾註解與換行）。 */
export const V6291_GATE_LINES = Object.freeze({
  'checkin': "        if (tournRequireVerified(id, res, 'checkin')) return;   // ⭐⭐⭐v6.291 冒名報名閘（helper 定義在 tournIdentity 正下方）\n",
  'register': "        if (tournRequireVerified(id, res, 'register')) return;   // ⭐⭐⭐v6.291 冒名報名閘（helper 定義在 tournIdentity 正下方）\n",
  'register-and-checkin': "        if (tournRequireVerified(id, res, 'register-and-checkin')) return;   // ⭐⭐⭐v6.291 冒名報名閘（helper 定義在 tournIdentity 正下方）\n",
});

/** helper 本體的定位錨（helper 刻意放在 tournIdentity 正下方 ⇒ **在兩個區塊錨點之前**，
 *  所以它完全不進區塊 sha ⇒ 區塊的差異就只有上面那 3 行。 */
export const V6291_HELPER_HEAD = '    function tournRequireVerified(id, res, ep) {\n';
export const V6291_BLOCK_BEGIN = '    // ── v6.291 TOURN VERIFIED GATE BEGIN ──\n';
export const V6291_BLOCK_END = '    // ── v6.291 TOURN VERIFIED GATE END ──\n';

/**
 * 把 v6.291 的 3 行插入逐字還原掉。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 * @returns {string} 還原後的區塊
 */
export function revertV6291(block) {
  let r = block;
  for (const ep of V6291_ENDPOINTS) {
    const line = V6291_GATE_LINES[ep];
    const n = r.split(line).length - 1;
    assert.strictEqual(n, 1,
      'revert-v6291：' + ep + ' 的 gate 行出現 ' + n + ' 次（應恰 1）—— 區塊被動了「宣告之外」的地方');
    r = r.replace(line, '');
  }
  assert.ok(!r.includes('tournRequireVerified('),
    'revert-v6291：還原後區塊裡還有 tournRequireVerified 的殘跡（有第 4 處未宣告的插入？）');
  return r;
}
