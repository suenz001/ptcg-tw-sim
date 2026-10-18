// v1.71／v6.588：公布欄附件統計；精確還原後接回既有逐位元鎖。
import assert from 'node:assert';
import { ADMIN_V171_PAIRS } from './sap-revert-admin-v171.mjs';
import * as Prev from './tourn-revert-v169.mjs';
export * from './tourn-revert-v169.mjs';
export const NEW_TAIL_SHA_V171 = '0c41d4326191032dcee416e2e28215021f54d10623fb0fa68bb92069a5d98224';
export const NEW_TEV_SHA_V171 = '65a40443f327d98168f0f07a4c0b751c323ebb139f552c8955e226f891cafb4b';
export const NEW_TEV_LEN_V171 = 245955;
export function revertV171(block) {
  let result = String(block), touched = 0;
  for (const [now, prev] of ADMIN_V171_PAIRS) {
    const n = result.split(now).length - 1;
    if (!n) continue;
    assert.strictEqual(n, 1, 'v171 區塊還原命中必須恰好一處');
    result = result.replace(now, prev); touched++;
  }
  assert.ok(touched > 0, 'v171 區塊沒有可還原的修改');
  return result;
}
export function revertToV167(block) { return Prev.revertToV167(revertV171(block)); }
export function revertToV165(block) { return Prev.revertToV165(revertV171(block)); }
export function revertToV154(block) { return Prev.revertToV154(revertV171(block)); }
export function revertToV153(block) { return Prev.revertToV153(revertV171(block)); }
export function revertToV152(block) { return Prev.revertToV152(revertV171(block)); }
export function revertToV150(block) { return Prev.revertToV150(revertV171(block)); }
export function revertToV6384(block) { return Prev.revertToV6384(revertV171(block)); }
export function revertToV6365(block) { return Prev.revertToV6365(revertV171(block)); }
export function revertToV6292(block) { return Prev.revertToV6292(revertV171(block)); }
export function revertToV6291(block) { return Prev.revertToV6291(revertV171(block)); }
export function revertV6365(block) { return Prev.revertV6365(block); }
