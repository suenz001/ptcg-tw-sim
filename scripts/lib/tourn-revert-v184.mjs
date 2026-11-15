// server v1.84 錦標賽區塊鎖（Rule 68）：本版改了錦標賽區塊 ⇒ 指紋換新值；
//   舊的 revertV183／revertTo* 全部先套 revertV184 再交給上一節（鏈又長一節，既有呼叫點只改 import 路徑）。
import { revertAdminV184IfPresent } from './sap-revert-admin-v184.mjs';
import * as Prev from './tourn-revert-v183.mjs';
export * from './tourn-revert-v183.mjs';
export const NEW_TAIL_SHA_V184 = '7dea261d904d0df6531fc9385d9a24448a53729aaa14a0588ce7b40b87d62765';
export const NEW_TEV_SHA_V184 = 'b7b91f83a3b8ae71f1653da1824d09a4e2c1cc65d98fc02b32627b52c0010897';
export const NEW_TEV_LEN_V184 = 260684;
export const revertV184 = (b) => revertAdminV184IfPresent(b);
export function revertV183(b) { return Prev.revertV183(revertV184(b)); }
export function revertV182(b) { return Prev.revertV182(revertV184(b)); }
export function revertV181(b) { return Prev.revertV181(revertV184(b)); }
export function revertV180(b) { return Prev.revertV180(revertV184(b)); }
export function revertV176(b) { return Prev.revertV176(revertV184(b)); }
export function revertV173(b) { return Prev.revertV173(revertV184(b)); }
export function revertToV167(b) { return Prev.revertToV167(revertV184(b)); }
export function revertToV165(b) { return Prev.revertToV165(revertV184(b)); }
export function revertToV154(b) { return Prev.revertToV154(revertV184(b)); }
export function revertToV153(b) { return Prev.revertToV153(revertV184(b)); }
export function revertToV152(b) { return Prev.revertToV152(revertV184(b)); }
export function revertToV150(b) { return Prev.revertToV150(revertV184(b)); }
export function revertToV6384(b) { return Prev.revertToV6384(revertV184(b)); }
export function revertToV6365(b) { return Prev.revertToV6365(revertV184(b)); }
export function revertToV6292(b) { return Prev.revertToV6292(revertV184(b)); }
export function revertToV6291(b) { return Prev.revertToV6291(revertV184(b)); }
export function revertV6365(b) { return Prev.revertV6365(b); }
