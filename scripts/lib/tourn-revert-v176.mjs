import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PAIRS} from './sap-revert-admin-v176.mjs';
import * as Prev from './tourn-revert-v173.mjs';
export * from './tourn-revert-v173.mjs';
export const NEW_TAIL_SHA_V176='9a5029795679c6946db5406f9f991f20ab6f7e9337f32bfb21b0ec8b502a9e1f';
export const NEW_TEV_SHA_V176='1d483b89ae99fb5af927183ddf2583bb1f3247a3fcdfec4884b4f0b2daf8d813';
export const NEW_TEV_LEN_V176=248441;
export function revertV176(block) {
 let s=String(block).replace(/\r\n/g,'\n'),touched=0;
 for(const[a,b]of PAIRS){const n=s.split(a).length-1;if(!n)continue;assert.equal(n,1,'v176區塊錨點唯一');s=s.replace(a,b);touched++;}
 if(!touched) assert.ok(['6b85eed22cfdef8cbfbb6e7bff1b630fa1fda67a3f6f1ba8fcc7128a89a459aa','60eb4bc20344373c52ed5de253ee4b49d20356302b8b8939b8d1581d398bb97c'].includes(createHash('sha256').update(s).digest('hex')),'無還原只允許精確舊區塊');
 return s;
}
export function revertV173(b){return Prev.revertV173(revertV176(b));}
export function revertToV167(b){return Prev.revertToV167(revertV176(b));}
export function revertToV165(b){return Prev.revertToV165(revertV176(b));}
export function revertToV154(b){return Prev.revertToV154(revertV176(b));}
export function revertToV153(b){return Prev.revertToV153(revertV176(b));}
export function revertToV152(b){return Prev.revertToV152(revertV176(b));}
export function revertToV150(b){return Prev.revertToV150(revertV176(b));}
export function revertToV6384(b){return Prev.revertToV6384(revertV176(b));}
export function revertToV6365(b){return Prev.revertToV6365(revertV176(b));}
export function revertToV6292(b){return Prev.revertToV6292(revertV176(b));}
export function revertToV6291(b){return Prev.revertToV6291(revertV176(b));}
export function revertV6365(b){return Prev.revertV6365(b);}
