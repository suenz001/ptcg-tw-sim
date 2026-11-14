// server v1.81 錦標賽區塊鎖（Rule 68）：本版在錦標賽區塊加了四處 projection、終局 CAS、時限公告合併 ⇒ 指紋換新值；
//   舊的 revertV180／revertTo* 全部先套 revertV181 再交給上一節（鏈又長一節，既有呼叫點不必改，只改 import 路徑）。
import { revertAdminV181IfPresent } from './sap-revert-admin-v181.mjs';
import * as Prev from './tourn-revert-v180.mjs';
export * from './tourn-revert-v180.mjs';
export const NEW_TAIL_SHA_V181 = '8e6d0e00536c2a80863d228e2aa7bdff998814c8354cc22c800c0f4a3af01e58';
export const NEW_TEV_SHA_V181 = '078cac34d2164d487703da49f799ff44707d4872704e7e0bad9e7682ebb04641';
export const NEW_TEV_LEN_V181 = 254167;
export const revertV181 = (b) => revertAdminV181IfPresent(b);
export function revertV180(b) { return Prev.revertV180(revertV181(b)); }
export function revertV176(b) { return Prev.revertV176(revertV181(b)); }
export function revertV173(b) { return Prev.revertV173(revertV181(b)); }
export function revertToV167(b) { return Prev.revertToV167(revertV181(b)); }
export function revertToV165(b) { return Prev.revertToV165(revertV181(b)); }
export function revertToV154(b) { return Prev.revertToV154(revertV181(b)); }
export function revertToV153(b) { return Prev.revertToV153(revertV181(b)); }
export function revertToV152(b) { return Prev.revertToV152(revertV181(b)); }
export function revertToV150(b) { return Prev.revertToV150(revertV181(b)); }
export function revertToV6384(b) { return Prev.revertToV6384(revertV181(b)); }
export function revertToV6365(b) { return Prev.revertToV6365(revertV181(b)); }
export function revertToV6292(b) { return Prev.revertToV6292(revertV181(b)); }
export function revertToV6291(b) { return Prev.revertToV6291(revertV181(b)); }
export function revertV6365(b) { return Prev.revertV6365(b); }
