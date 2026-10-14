// ⭐⭐⭐ server patch v1.67（v6.566：對局時限到的判法切換、推播偏好以帳號為準）錦標賽區塊 revert-diff 的**唯一資料來源**。
//
// 沿用 v6.291 → … → v1.54 → v1.65 的既有形狀（站長明文禁止「改成不驗／只比片段／加 || 放寬」）。
// 本版的改動全部逐字宣告在 sap-revert-admin-v167.mjs（含錦標賽區塊之前的哨兵區塊與區塊內的行內改動），**這裡直接沿用那一份**（Rule 38）；
//   落在錦標賽區塊之外的條目在區塊裡命中 0 次 ⇒ 略過，命中 2 次以上一律 throw。
// ⚠ v1.66 只改錦標賽區塊之前 ⇒ 區塊指紋從 v1.65 沿用到 v1.66，本版是 v1.65 之後第一次動區塊。
import assert from 'node:assert';
import { ADMIN_V167_PAIRS } from './sap-revert-admin-v167.mjs';
import {
  revertV165, revertV154, revertV153, revertV152, revertV150, revertV6384, revertV6381, revertV6365,
  revertToV6292 as _toV6292, revertToV6291 as _toV6291,
  NEW_TAIL_SHA_V165, NEW_TEV_SHA_V165, NEW_TEV_LEN_V165,
} from './tourn-revert-v165.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';
export { revertV165, revertV154, revertV153, revertV152, revertV150, revertV6384, revertV6381, revertV6365, stripDeclaredBlocksNewerThan } from './tourn-revert-v165.mjs';
export { OLD_TAIL_SHA_V6365, OLD_TEV_SHA_V6365, OLD_TEV_LEN_V6365, OLD_TAIL_SHA_V6384, OLD_TEV_SHA_V6384, OLD_TEV_LEN_V6384, OLD_TAIL_SHA_V150, OLD_TEV_SHA_V150, OLD_TEV_LEN_V150, OLD_TAIL_SHA_V152, OLD_TEV_SHA_V152, OLD_TEV_LEN_V152, OLD_TAIL_SHA_V153, OLD_TEV_SHA_V153, OLD_TEV_LEN_V153, OLD_TAIL_SHA_V154, OLD_TEV_SHA_V154, OLD_TEV_LEN_V154 } from './tourn-revert-v165.mjs';

/** v1.67 之前（＝v1.65～v1.66）的區塊指紋 —— 只還原 v1.67 的改動後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V165 = NEW_TAIL_SHA_V165;
export const OLD_TEV_SHA_V165 = NEW_TEV_SHA_V165;
export const OLD_TEV_LEN_V165 = NEW_TEV_LEN_V165;

/** v1.67 之後的新指紋 —— 全站的區塊鎖都必須重釘到這三個值（舊值零殘留也在守）。 */
export const NEW_TAIL_SHA_V167 = '04961a4419fe9af762f4394550d81753880ae4174edd8ac8bc941392fbb2dc6e';
export const NEW_TEV_SHA_V167 = '41606d319b9b89738f4c75c4af5487e804c89fc258b3343a49efc9ab58106b62';
export const NEW_TEV_LEN_V167 = 245294;

/**
 * 把 v1.67 的改動逐字還原（**只**還原本版）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 */
export function revertV167(block) {
  let r = String(block);
  let touched = 0;
  for (const [cur, old] of ADMIN_V167_PAIRS) {
    const n = r.split(cur).length - 1;
    if (n === 0) continue;
    assert.strictEqual(n, 1, 'revertV167：宣告命中 ' + n + ' 次（預期 1）');
    r = r.split(cur).join(old); touched++;
  }
  assert.ok(touched > 0, 'revertV167：一處都沒還原到 ⇒ 宣告端過期了（區塊裡沒有 v1.67 的痕跡）');
  assert.ok(!r.includes('v167-') && !r.includes('⭐v1.67'), 'revertV167：還原後仍有 v1.67 的痕跡');
  return r;
}

/** 還原到 v1.65 之前（＝v1.54～v1.64 的區塊）。 */
export function revertToV165(block) { return revertV165(revertV167(block)); }
/** 還原到 v1.54 之前（＝v1.53 的區塊）。 */
export function revertToV154(block) { return revertV154(revertToV165(block)); }
/** 還原到 v1.53 之前（＝v1.52 的區塊）。 */
export function revertToV153(block) { return revertV153(revertToV154(block)); }
/** 還原到 v1.52 之前（＝v1.50／v1.51 的區塊）。 */
export function revertToV152(block) { return revertV152(revertToV153(block)); }
/** 還原到 v1.50 之前（＝v6.384 的區塊）。 */
export function revertToV150(block) { return revertV150(revertToV152(block)); }
/** 還原到 v6.384 之前。 */
export function revertToV6384(block) { return revertV6384(revertToV150(block)); }
/** 再往後一節：還原到 v6.381 之前（＝v6.365 的區塊）。 */
export function revertToV6365(block) { return revertV6365(revertV6381(revertToV6384(block))); }
/** 一路還原到 v6.292 的區塊。 */
export function revertToV6292(block) { return _toV6292(revertV167(block)); }
/** 一路還原到 v6.291 的區塊。 */
export function revertToV6291(block) { return _toV6291(revertV167(block)); }
