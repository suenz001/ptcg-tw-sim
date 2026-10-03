// ⭐⭐⭐ server patch v1.54（全站 audit 2026-10-03：伺服器端降載）錦標賽區塊 revert-diff 的**唯一資料來源**。
//
// 沿用 v6.291 → … → v1.52 → v1.53 的既有形狀（站長明文禁止「改成不驗／只比片段／加 || 放寬」）。
// 本版的改動全部逐字宣告在 sap-revert-admin-v154.mjs（含哨兵區塊與行內改動），**這裡直接沿用那一份**（Rule 38）；
//   落在錦標賽區塊之外的條目在區塊裡命中 0 次 ⇒ 略過，命中 2 次以上一律 throw。
import assert from 'node:assert';
import { ADMIN_V154_PAIRS } from './sap-revert-admin-v154.mjs';
import {
  revertV153, revertV152, revertV150, revertV6384, revertV6381, revertV6365, revertToV6292 as _toV6292, revertToV6291 as _toV6291,
  NEW_TAIL_SHA_V153, NEW_TEV_SHA_V153, NEW_TEV_LEN_V153,
} from './tourn-revert-v153.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';
export { revertV153, revertV152, revertV150, revertV6384, revertV6381, revertV6365, stripDeclaredBlocksNewerThan } from './tourn-revert-v153.mjs';
export { OLD_TAIL_SHA_V6365, OLD_TEV_SHA_V6365, OLD_TEV_LEN_V6365, OLD_TAIL_SHA_V6384, OLD_TEV_SHA_V6384, OLD_TEV_LEN_V6384, OLD_TAIL_SHA_V150, OLD_TEV_SHA_V150, OLD_TEV_LEN_V150, OLD_TAIL_SHA_V152, OLD_TEV_SHA_V152, OLD_TEV_LEN_V152 } from './tourn-revert-v153.mjs';

/** v1.54 之前（＝v1.53）的區塊指紋 —— 只還原 v1.54 的改動後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V153 = NEW_TAIL_SHA_V153;
export const OLD_TEV_SHA_V153 = NEW_TEV_SHA_V153;
export const OLD_TEV_LEN_V153 = NEW_TEV_LEN_V153;

/** v1.54 之後的新指紋 —— 全站的區塊鎖都必須重釘到這三個值（舊值零殘留也在守）。 */
export const NEW_TAIL_SHA_V154 = '64c15bd2688f5cb07f68828a8c8355660dbe931a00f47c034dc3678414485a57';
export const NEW_TEV_SHA_V154 = '98679fb3f9013b0a7b59971977b7ff13dd1ac03a9c46560c36072cae6aea46ff';
export const NEW_TEV_LEN_V154 = 239306;

/**
 * 把 v1.54 的改動逐字還原（**只**還原本版）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 */
export function revertV154(block) {
  let r = String(block);
  let touched = 0;
  for (const [cur, old] of ADMIN_V154_PAIRS) {
    const n = r.split(cur).length - 1;
    if (n === 0) continue;
    assert.strictEqual(n, 1, 'revertV154：宣告命中 ' + n + ' 次（預期 1）');
    r = r.split(cur).join(old); touched++;
  }
  assert.ok(touched > 0, 'revertV154：一處都沒還原到 ⇒ 宣告端過期了（區塊裡沒有 v1.54 的痕跡）');
  assert.ok(!r.includes('v154-') && !r.includes('⭐v1.54'), 'revertV154：還原後仍有 v1.54 的痕跡');
  return r;
}

/** 還原到 v1.53 之前（＝v1.52 的區塊）。 */
export function revertToV153(block) { return revertV153(revertV154(block)); }
/** 還原到 v1.52 之前（＝v1.50／v1.51 的區塊）。 */
export function revertToV152(block) { return revertV152(revertToV153(block)); }
/** 還原到 v1.50 之前（＝v6.384 的區塊）。 */
export function revertToV150(block) { return revertV150(revertToV152(block)); }
/** 還原到 v6.384 之前。 */
export function revertToV6384(block) { return revertV6384(revertToV150(block)); }
/** 再往後一節：還原到 v6.381 之前（＝v6.365 的區塊）。 */
export function revertToV6365(block) { return revertV6365(revertV6381(revertToV6384(block))); }
/** 一路還原到 v6.292 的區塊。 */
export function revertToV6292(block) { return _toV6292(revertV154(block)); }
/** 一路還原到 v6.291 的區塊。 */
export function revertToV6291(block) { return _toV6291(revertV154(block)); }
