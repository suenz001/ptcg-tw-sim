// server v1.83 錦標賽區塊鎖（Rule 68）：本版改了錦標賽區塊 ⇒ 指紋換新值；
//   舊的 revertV182／revertTo* 全部先套 revertV183 再交給上一節（鏈又長一節，既有呼叫點只改 import 路徑）。
import { revertAdminV183IfPresent } from './sap-revert-admin-v183.mjs';
import * as Prev from './tourn-revert-v182.mjs';
export * from './tourn-revert-v182.mjs';
export const NEW_TAIL_SHA_V183 = '419cc4a0b635827653a7c8d64f6a255cba9811056340e8e28627c644f320c549';
export const NEW_TEV_SHA_V183 = '2aebe3b998628e082d9978978e7ff09445bc855ad5b5a57065d81d839845aa50';
export const NEW_TEV_LEN_V183 = 259710;
export const revertV183 = (b) => revertAdminV183IfPresent(b);
export function revertV182(b) { return Prev.revertV182(revertV183(b)); }
export function revertV181(b) { return Prev.revertV181(revertV183(b)); }
export function revertV180(b) { return Prev.revertV180(revertV183(b)); }
export function revertV176(b) { return Prev.revertV176(revertV183(b)); }
export function revertV173(b) { return Prev.revertV173(revertV183(b)); }
export function revertToV167(b) { return Prev.revertToV167(revertV183(b)); }
export function revertToV165(b) { return Prev.revertToV165(revertV183(b)); }
export function revertToV154(b) { return Prev.revertToV154(revertV183(b)); }
export function revertToV153(b) { return Prev.revertToV153(revertV183(b)); }
export function revertToV152(b) { return Prev.revertToV152(revertV183(b)); }
export function revertToV150(b) { return Prev.revertToV150(revertV183(b)); }
export function revertToV6384(b) { return Prev.revertToV6384(revertV183(b)); }
export function revertToV6365(b) { return Prev.revertToV6365(revertV183(b)); }
export function revertToV6292(b) { return Prev.revertToV6292(revertV183(b)); }
export function revertToV6291(b) { return Prev.revertToV6291(revertV183(b)); }
export function revertV6365(b) { return Prev.revertV6365(b); }
