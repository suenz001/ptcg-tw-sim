// server v1.88（v6.671 瑞士輪未進場自動棄賽）錦標賽區塊鎖（Rule 68）：本版改了錦標賽區塊 ⇒ 指紋換新值；
//   舊的 revertV185／revertTo* 全部先套 revertV186 再交給上一節（鏈又長一節，既有呼叫點只改 import 路徑）。
import { revertV6671IfPresent } from './revert-v6671-noshow-auto-drop.mjs';
import * as Prev from './tourn-revert-v186.mjs';
export * from './tourn-revert-v186.mjs';
export const NEW_TAIL_SHA_V188 = '41a7746a8f5660844bf2df543de4bf4cb57b3e925bb4d5eac53e373289434533';
export const NEW_TEV_SHA_V188 = 'd08890ecea6b1d2569a3dcde66ca1bcda769e6ef99d9e2a84e5960a134836cbd';
export const NEW_TEV_LEN_V188 = 263357;
// 本版的錦標賽區塊改動只在 v6.671 的逐位元還原表（單一來源 revert-v6671；它也串在全站還原鏈上）
export const revertV188 = (b) => revertV6671IfPresent('oracle-admin/server_admin_patch.js', b);
export function revertV186(b) { return Prev.revertV186(revertV188(b)); }
export function revertV185(b) { return Prev.revertV185(revertV188(b)); }
export function revertV184(b) { return Prev.revertV184(revertV188(b)); }
export function revertV183(b) { return Prev.revertV183(revertV188(b)); }
export function revertV182(b) { return Prev.revertV182(revertV188(b)); }
export function revertV181(b) { return Prev.revertV181(revertV188(b)); }
export function revertV180(b) { return Prev.revertV180(revertV188(b)); }
export function revertV176(b) { return Prev.revertV176(revertV188(b)); }
export function revertV173(b) { return Prev.revertV173(revertV188(b)); }
export function revertToV167(b) { return Prev.revertToV167(revertV188(b)); }
export function revertToV165(b) { return Prev.revertToV165(revertV188(b)); }
export function revertToV154(b) { return Prev.revertToV154(revertV188(b)); }
export function revertToV153(b) { return Prev.revertToV153(revertV188(b)); }
export function revertToV152(b) { return Prev.revertToV152(revertV188(b)); }
export function revertToV150(b) { return Prev.revertToV150(revertV188(b)); }
export function revertToV6384(b) { return Prev.revertToV6384(revertV188(b)); }
export function revertToV6365(b) { return Prev.revertToV6365(revertV188(b)); }
export function revertToV6292(b) { return Prev.revertToV6292(revertV188(b)); }
export function revertToV6291(b) { return Prev.revertToV6291(revertV188(b)); }
export function revertV6365(b) { return Prev.revertV6365(b); }
