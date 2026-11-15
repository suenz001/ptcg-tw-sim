// server v1.82 錦標賽區塊鎖（Rule 68）：本版在錦標賽區塊加了 /bracket 內容簽章 ⇒ 指紋換新值；
//   舊的 revertV181／revertTo* 全部先套 revertV182 再交給上一節（鏈又長一節，既有呼叫點只改 import 路徑）。
import { revertAdminV182IfPresent } from './sap-revert-admin-v182.mjs';
import * as Prev from './tourn-revert-v181.mjs';
export * from './tourn-revert-v181.mjs';
export const NEW_TAIL_SHA_V182 = '5ef85f2399821c5fec124b919aa2b7cd753d7baca0b46da900d0439167c2ca90';
export const NEW_TEV_SHA_V182 = '8c7fd6f95e0ba1f0fa7e5d69234226f12922d1ff07da956d6e824a68d28c75ba';
export const NEW_TEV_LEN_V182 = 256160;
export const revertV182 = (b) => revertAdminV182IfPresent(b);
export function revertV181(b) { return Prev.revertV181(revertV182(b)); }
export function revertV180(b) { return Prev.revertV180(revertV182(b)); }
export function revertV176(b) { return Prev.revertV176(revertV182(b)); }
export function revertV173(b) { return Prev.revertV173(revertV182(b)); }
export function revertToV167(b) { return Prev.revertToV167(revertV182(b)); }
export function revertToV165(b) { return Prev.revertToV165(revertV182(b)); }
export function revertToV154(b) { return Prev.revertToV154(revertV182(b)); }
export function revertToV153(b) { return Prev.revertToV153(revertV182(b)); }
export function revertToV152(b) { return Prev.revertToV152(revertV182(b)); }
export function revertToV150(b) { return Prev.revertToV150(revertV182(b)); }
export function revertToV6384(b) { return Prev.revertToV6384(revertV182(b)); }
export function revertToV6365(b) { return Prev.revertToV6365(revertV182(b)); }
export function revertToV6292(b) { return Prev.revertToV6292(revertV182(b)); }
export function revertToV6291(b) { return Prev.revertToV6291(revertV182(b)); }
export function revertV6365(b) { return Prev.revertV6365(b); }
