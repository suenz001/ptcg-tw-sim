// ⭐⭐⭐ server patch v1.50（admin v1.77：每日固定網站賽一鍵建立）錦標賽區塊 revert-diff 的**唯一資料來源**。
//
// 沿用 v6.291 → v6.292 → v6.365 → v6.381 → v6.384 的既有形狀（站長明文禁止「改成不驗／只比片段／加 || 放寬」）。
// 本版對錦標賽區塊的改動只有兩種：
//   ① 純新增：`// >>> v150-daily-tournament` … `// <<< v150-daily-tournament`（常數／helper／兩支 admin 端點）。
//   ② 一處**行內改動**：`/event/create` 端點裡「組賽事文件＋insertOne」收斂成中央 `insertTournamentEvent(b, id, seq)`
//      （每日一鍵建立走同一份 ⇒ 欄位不會兩邊漂移，Rule 38）。逐字宣告在 sap-revert-admin-v150.mjs，
//      **這裡直接沿用那一份**（不抄第二份，否則兩份宣告會漂移）。
// ⚠ 還原器對「命中次數不合理」一律 AssertionError ⇒ 區塊被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';
import { ADMIN_V150_INLINE_PAIRS } from './sap-revert-admin-v150.mjs';
import {
  revertV6384, revertV6381, revertV6365, revertToV6292 as _toV6292, revertToV6291 as _toV6291,
  NEW_TAIL_SHA_V6384, NEW_TEV_SHA_V6384, NEW_TEV_LEN_V6384,
} from './tourn-revert-v6384.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';
export { revertV6384, revertV6381, revertV6365, stripDeclaredBlocksNewerThan } from './tourn-revert-v6384.mjs';
// ⚠ revertToV6292／revertToV6291 是「從**現行**區塊一路還原到那一版」的入口 ⇒ 必須先還原 v1.50，
//   直接 re-export 舊的那一份會讓鍰斷在這一節（test-v6381 C3 實測會紅）。
// 鍰上更早的舊指紋一併轉出去（消費者改指這一支之後，不轉就拿不到 ⇒ 鍰斷在這裡）。
export { OLD_TAIL_SHA_V6365, OLD_TEV_SHA_V6365, OLD_TEV_LEN_V6365 } from './tourn-revert-v6384.mjs';

/** v1.50 之前（＝v6.384）的區塊指紋 —— 只還原 v1.50 的改動後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V6384 = NEW_TAIL_SHA_V6384;
export const OLD_TEV_SHA_V6384 = NEW_TEV_SHA_V6384;
export const OLD_TEV_LEN_V6384 = NEW_TEV_LEN_V6384;

/** v1.50 之後的新指紋 —— 全站的區塊鎖都必須重釘到這三個值（舊值零殘留也在守）。 */
export const NEW_TAIL_SHA_V150 = '487f2ed8d976ca725d8446b758faa3cd43827c2a15c640ce0d3c7126a50391c0';
export const NEW_TEV_SHA_V150 = 'ebee9891421e33226965ee1afe63fb22878f433939b5771b355a8e5ace926dd8';
export const NEW_TEV_LEN_V150 = 234650;

/** 本版純新增的區塊（唯一一個哨兵）。 */
export const V150_TAGS = Object.freeze(['v150-daily-tournament']);

function tagRe(tag) {
  return new RegExp('[ \\t]*\\/\\/ >>> ' + tag + '\\r?\\n[\\s\\S]*?[ \\t]*\\/\\/ <<< ' + tag + '\\r?\\n', 'g');
}

/**
 * 把 v1.50 的改動（哨兵區塊 ＋ create 端點的行內收斂）逐字還原（**只**還原本版）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 */
export function revertV150(block) {
  let r = String(block);
  let touched = 0;
  for (const tag of V150_TAGS) {
    const n = (r.match(tagRe(tag)) || []).length;
    assert.ok(n === 0 || n === 1, 'revertV150：哨兵 ' + tag + ' 命中 ' + n + ' 次（預期 0 或 1）');
    if (n === 1) { r = r.replace(tagRe(tag), ''); touched++; }
  }
  for (const [cur, old] of ADMIN_V150_INLINE_PAIRS) {
    const n = r.split(cur).length - 1;
    if (n === 0) continue;                       // 區塊起點在 create 端點之後時（TAIL_ANCHOR 之前）本來就不含它
    assert.strictEqual(n, 1, 'revertV150：行內宣告命中 ' + n + ' 次（預期 1）');
    r = r.split(cur).join(old); touched++;
  }
  assert.ok(touched > 0, 'revertV150：一處都沒還原到 ⇒ 宣告端過期了（區塊裡沒有 v1.50 的痕跡）');
  assert.ok(!r.includes('v150-daily-tournament') && !r.includes('insertTournamentEvent'),
    'revertV150：還原後仍有 v1.50 的痕跡');
  return r;
}

/** 還原到 v6.384 之前（＝把本版與 v6.384 的改動都拿掉）。 */
export function revertToV6384(block) { return revertV6384(revertV150(block)); }
/** 再往後一節：還原到 v6.381 之前（＝v6.365 的區塊）。 */
export function revertToV6365(block) { return revertV6365(revertV6381(revertToV6384(block))); }
/** 一路還原到 v6.292 的區塊（本版 → v6.384 → v6.381 → v6.365 → v6.292）。 */
export function revertToV6292(block) { return _toV6292(revertV150(block)); }
/** 一路還原到 v6.291 的區塊。 */
export function revertToV6291(block) { return _toV6291(revertV150(block)); }
