// ⭐⭐⭐ server patch v1.65（v6.562：Top Cut 人多取 16 強）錦標賽區塊 revert-diff 的**唯一資料來源**。
//
// 沿用 v6.291 → … → v1.53 → v1.54 的既有形狀（站長明文禁止「改成不驗／只比片段／加 || 放寬」）。
// 本版的改動全部逐字宣告在 sap-revert-admin-v165.mjs（含錦標賽區塊之前的哨兵區塊與區塊內的行內改動），**這裡直接沿用那一份**（Rule 38）；
//   落在錦標賽區塊之外的條目在區塊裡命中 0 次 ⇒ 略過，命中 2 次以上一律 throw。
// ⚠ v1.55～v1.64 都只改錦標賽區塊之前 ⇒ 區塊指紋從 v1.54 一路沿用到 v1.64，本版是 v1.54 之後第一次動區塊。
import assert from 'node:assert';
import { ADMIN_V165_PAIRS } from './sap-revert-admin-v165.mjs';
import {
  revertV154, revertV153, revertV152, revertV150, revertV6384, revertV6381, revertV6365, revertToV6292 as _toV6292, revertToV6291 as _toV6291,
  NEW_TAIL_SHA_V154, NEW_TEV_SHA_V154, NEW_TEV_LEN_V154,
} from './tourn-revert-v154.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';
export { revertV154, revertV153, revertV152, revertV150, revertV6384, revertV6381, revertV6365, stripDeclaredBlocksNewerThan } from './tourn-revert-v154.mjs';
export { OLD_TAIL_SHA_V6365, OLD_TEV_SHA_V6365, OLD_TEV_LEN_V6365, OLD_TAIL_SHA_V6384, OLD_TEV_SHA_V6384, OLD_TEV_LEN_V6384, OLD_TAIL_SHA_V150, OLD_TEV_SHA_V150, OLD_TEV_LEN_V150, OLD_TAIL_SHA_V152, OLD_TEV_SHA_V152, OLD_TEV_LEN_V152, OLD_TAIL_SHA_V153, OLD_TEV_SHA_V153, OLD_TEV_LEN_V153 } from './tourn-revert-v154.mjs';

/** v1.65 之前（＝v1.54～v1.64）的區塊指紋 —— 只還原 v1.65 的改動後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V154 = NEW_TAIL_SHA_V154;
export const OLD_TEV_SHA_V154 = NEW_TEV_SHA_V154;
export const OLD_TEV_LEN_V154 = NEW_TEV_LEN_V154;

/** v1.65 之後的新指紋 —— 全站的區塊鎖都必須重釘到這三個值（舊值零殘留也在守）。 */
export const NEW_TAIL_SHA_V165 = '8af4edb9453d17e6d515f6a6fd85f53cd52dfa2c57c0e7b7e78c8d2765696fdf';
export const NEW_TEV_SHA_V165 = '43767585cccbd5fc4c9999b1d43334360633110af4871c4532f37ab1824c7894';
export const NEW_TEV_LEN_V165 = 240843;

/**
 * 把 v1.65 的改動逐字還原（**只**還原本版）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 */
export function revertV165(block) {
  let r = String(block);
  let touched = 0;
  for (const [cur, old] of ADMIN_V165_PAIRS) {
    const n = r.split(cur).length - 1;
    if (n === 0) continue;
    assert.strictEqual(n, 1, 'revertV165：宣告命中 ' + n + ' 次（預期 1）');
    r = r.split(cur).join(old); touched++;
  }
  assert.ok(touched > 0, 'revertV165：一處都沒還原到 ⇒ 宣告端過期了（區塊裡沒有 v1.65 的痕跡）');
  assert.ok(!r.includes('v165-') && !r.includes('⭐v1.65'), 'revertV165：還原後仍有 v1.65 的痕跡');
  return r;
}

/** 還原到 v1.54 之前（＝v1.53 的區塊）。 */
export function revertToV154(block) { return revertV154(revertV165(block)); }
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
export function revertToV6292(block) { return _toV6292(revertV165(block)); }
/** 一路還原到 v6.291 的區塊。 */
export function revertToV6291(block) { return _toV6291(revertV165(block)); }
