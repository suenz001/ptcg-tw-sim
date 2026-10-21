// v1.73：個人時計。TEVENTS 以下逐位元未動，只有 tail 新指紋。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ADMIN_V173_PAIRS } from './sap-revert-admin-v173.mjs';
import * as Prev from './tourn-revert-v171.mjs';
export * from './tourn-revert-v171.mjs';
export const NEW_TAIL_SHA_V173 = '6b85eed22cfdef8cbfbb6e7bff1b630fa1fda67a3f6f1ba8fcc7128a89a459aa';
export const NEW_TEV_SHA_V173 = '60eb4bc20344373c52ed5de253ee4b49d20356302b8b8939b8d1581d398bb97c';
export const NEW_TEV_LEN_V173 = 245824;
export function revertV173(block) {
 let r=String(block), touched=0;
 for(const [cur,old] of ADMIN_V173_PAIRS){const n=r.split(cur).length-1;if(!n)continue;assert.equal(n,1,'v173區塊還原須唯一');r=r.replace(cur,old);touched++;}
 if(!touched) assert.equal(createHash('sha256').update(r).digest('hex'),NEW_TEV_SHA_V173,'只有逐位元未動的TEV區塊可零還原');
 return r;
}
export function revertToV167(b) { return Prev.revertToV167(revertV173(b)); }
export function revertToV165(b) { return Prev.revertToV165(revertV173(b)); }
export function revertToV154(b) { return Prev.revertToV154(revertV173(b)); }
export function revertToV153(b) { return Prev.revertToV153(revertV173(b)); }
export function revertToV152(b) { return Prev.revertToV152(revertV173(b)); }
export function revertToV150(b) { return Prev.revertToV150(revertV173(b)); }
export function revertToV6384(b) { return Prev.revertToV6384(revertV173(b)); }
export function revertToV6365(b) { return Prev.revertToV6365(revertV173(b)); }
export function revertToV6292(b) { return Prev.revertToV6292(revertV173(b)); }
export function revertToV6291(b) { return Prev.revertToV6291(revertV173(b)); }
export function revertV6365(b) { return Prev.revertV6365(b); }
