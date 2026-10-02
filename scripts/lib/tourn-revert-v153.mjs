// ⭐⭐⭐ server patch v1.53（錦標賽報名的牌組改在伺服器端也跑完整規則）錦標賽區塊 revert-diff 的**唯一資料來源**。
//
// 沿用 v6.291 → v6.292 → v6.365 → v6.381 → v6.384 → v1.50 → v1.52 的既有形狀（站長明文禁止「改成不驗／只比片段／加 || 放寬」）。
// 本版對錦標賽區塊的改動只有一種：
//   ・三處**行內新增**：/register、/register-and-checkin、/propose 在 60 張檢查的下一行呼叫 tournDeckIssue。
//     逐字宣告在 sap-revert-admin-v153.mjs，**這裡直接沿用那一份**（不抄第二份，Rule 38）。
//   （tournDeckIssue 本體的哨兵 v153-tourn-deck-validate 放在 TAIL_ANCHOR 之前，不在錦標賽區塊裡。）
// ⚠ 還原器對「命中次數不合理」一律 AssertionError ⇒ 區塊被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';
import { ADMIN_V153_INLINE_PAIRS } from './sap-revert-admin-v153.mjs';
import {
  revertV152, revertV150, revertV6384, revertV6381, revertV6365, revertToV6292 as _toV6292, revertToV6291 as _toV6291,
  NEW_TAIL_SHA_V152, NEW_TEV_SHA_V152, NEW_TEV_LEN_V152,
} from './tourn-revert-v152.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';
export { revertV152, revertV150, revertV6384, revertV6381, revertV6365, stripDeclaredBlocksNewerThan } from './tourn-revert-v152.mjs';
// 鏈上更早的舊指紋一併轉出去（消費者改指這一支之後，不轉就拿不到 ⇒ 鏈斷在這裡）。
export { OLD_TAIL_SHA_V6365, OLD_TEV_SHA_V6365, OLD_TEV_LEN_V6365, OLD_TAIL_SHA_V6384, OLD_TEV_SHA_V6384, OLD_TEV_LEN_V6384, OLD_TAIL_SHA_V150, OLD_TEV_SHA_V150, OLD_TEV_LEN_V150 } from './tourn-revert-v152.mjs';

/** v1.53 之前（＝v1.52）的區塊指紋 —— 只還原 v1.53 的改動後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V152 = NEW_TAIL_SHA_V152;
export const OLD_TEV_SHA_V152 = NEW_TEV_SHA_V152;
export const OLD_TEV_LEN_V152 = NEW_TEV_LEN_V152;

/** v1.53 之後的新指紋 —— 全站的區塊鎖都必須重釘到這三個值（舊值零殘留也在守）。 */
export const NEW_TAIL_SHA_V153 = '551197bdf7203fd429da272d4b93d4782b8ccfd84f19582964ab2a76b8afb317';
export const NEW_TEV_SHA_V153 = 'ffa99914604061a2232913ef086658ca0ddea65ea0a03a0740c6761a6d493afe';
export const NEW_TEV_LEN_V153 = 236758;

/**
 * 把 v1.53 的改動（三行呼叫）逐字還原（**只**還原本版）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 */
export function revertV153(block) {
  let r = String(block);
  let touched = 0;
  for (const [cur, old] of ADMIN_V153_INLINE_PAIRS) {
    const n = r.split(cur).length - 1;
    if (n === 0) continue;
    assert.strictEqual(n, 1, 'revertV153：行內宣告命中 ' + n + ' 次（預期 1）');
    r = r.split(cur).join(old); touched++;
  }
  assert.ok(touched > 0, 'revertV153：一處都沒還原到 ⇒ 宣告端過期了（區塊裡沒有 v1.53 的痕跡）');
  assert.ok(!r.includes('tournDeckIssue(') && !r.includes('⭐v1.53 完整規則'), 'revertV153：還原後仍有 v1.53 的痕跡');
  return r;
}

/** 還原到 v1.52 之前（＝v1.50／v1.51 的區塊）。 */
export function revertToV152(block) { return revertV152(revertV153(block)); }
/** 還原到 v1.50 之前（＝v6.384 的區塊）。 */
export function revertToV150(block) { return revertV150(revertToV152(block)); }
/** 還原到 v6.384 之前。 */
export function revertToV6384(block) { return revertV6384(revertToV150(block)); }
/** 再往後一節：還原到 v6.381 之前（＝v6.365 的區塊）。 */
export function revertToV6365(block) { return revertV6365(revertV6381(revertToV6384(block))); }
/** 一路還原到 v6.292 的區塊（本版 → v1.52 → v1.50 → v6.384 → v6.381 → v6.365 → v6.292）。 */
export function revertToV6292(block) { return _toV6292(revertV153(block)); }
/** 一路還原到 v6.291 的區塊。 */
export function revertToV6291(block) { return _toV6291(revertV153(block)); }
