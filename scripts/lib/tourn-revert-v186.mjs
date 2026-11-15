// server v1.86 錦標賽區塊鎖（Rule 68）：本版改了錦標賽區塊 ⇒ 指紋換新值；
//   舊的 revertV185／revertTo* 全部先套 revertV186 再交給上一節（鏈又長一節，既有呼叫點只改 import 路徑）。
import { revertAdminV186IfPresent } from './sap-revert-admin-v186.mjs';
import * as Prev from './tourn-revert-v185.mjs';
export * from './tourn-revert-v185.mjs';
export const NEW_TAIL_SHA_V186 = 'dc041826c0f73eeeba63d64655d26a5aec02071992ab05db537997c6a079f78c';
export const NEW_TEV_SHA_V186 = '33c4153cc0be6de6d9d804bc8332c3eec5eb83ad32d542f8f9a4a8d111c1e455';
export const NEW_TEV_LEN_V186 = 260974;
export const revertV186 = (b) => revertAdminV186IfPresent(b);
export function revertV185(b) { return Prev.revertV185(revertV186(b)); }
export function revertV184(b) { return Prev.revertV184(revertV186(b)); }
export function revertV183(b) { return Prev.revertV183(revertV186(b)); }
export function revertV182(b) { return Prev.revertV182(revertV186(b)); }
export function revertV181(b) { return Prev.revertV181(revertV186(b)); }
export function revertV180(b) { return Prev.revertV180(revertV186(b)); }
export function revertV176(b) { return Prev.revertV176(revertV186(b)); }
export function revertV173(b) { return Prev.revertV173(revertV186(b)); }
export function revertToV167(b) { return Prev.revertToV167(revertV186(b)); }
export function revertToV165(b) { return Prev.revertToV165(revertV186(b)); }
export function revertToV154(b) { return Prev.revertToV154(revertV186(b)); }
export function revertToV153(b) { return Prev.revertToV153(revertV186(b)); }
export function revertToV152(b) { return Prev.revertToV152(revertV186(b)); }
export function revertToV150(b) { return Prev.revertToV150(revertV186(b)); }
export function revertToV6384(b) { return Prev.revertToV6384(revertV186(b)); }
export function revertToV6365(b) { return Prev.revertToV6365(revertV186(b)); }
export function revertToV6292(b) { return Prev.revertToV6292(revertV186(b)); }
export function revertToV6291(b) { return Prev.revertToV6291(revertV186(b)); }
export function revertV6365(b) { return Prev.revertV6365(b); }
