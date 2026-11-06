// server v1.80 錦標賽區塊鎖（Rule 68）：本版改了 broadcastPush 兩行 ⇒ 錦標賽區塊指紋換新值；
//   舊的 revertV176／revertTo* 全部先套 revertV180 再交給上一節（鏈又長一節，既有呼叫點不必改，只改 import 路徑）。
import { revertAdminV180IfPresent } from './sap-revert-admin-v180.mjs';
import * as Prev from './tourn-revert-v176.mjs';
export * from './tourn-revert-v176.mjs';
export const NEW_TAIL_SHA_V180 = '3b5b2d095c977438312e9895fec8d5da70b571b2cc9c785838e2e371b4e05e06';
export const NEW_TEV_SHA_V180 = '474b9038708ce74f6d4ad10611654e8330132c1737f738afd1c72179ca9eb843';
export const NEW_TEV_LEN_V180 = 248732;
export const revertV180 = (b) => revertAdminV180IfPresent(b);
export function revertV176(b) { return Prev.revertV176(revertV180(b)); }
export function revertV173(b) { return Prev.revertV173(revertV180(b)); }
export function revertToV167(b) { return Prev.revertToV167(revertV180(b)); }
export function revertToV165(b) { return Prev.revertToV165(revertV180(b)); }
export function revertToV154(b) { return Prev.revertToV154(revertV180(b)); }
export function revertToV153(b) { return Prev.revertToV153(revertV180(b)); }
export function revertToV152(b) { return Prev.revertToV152(revertV180(b)); }
export function revertToV150(b) { return Prev.revertToV150(revertV180(b)); }
export function revertToV6384(b) { return Prev.revertToV6384(revertV180(b)); }
export function revertToV6365(b) { return Prev.revertToV6365(revertV180(b)); }
export function revertToV6292(b) { return Prev.revertToV6292(revertV180(b)); }
export function revertToV6291(b) { return Prev.revertToV6291(revertV180(b)); }
export function revertV6365(b) { return Prev.revertV6365(b); }
