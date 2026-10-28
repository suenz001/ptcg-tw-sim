import assert from 'node:assert/strict';
export const PAIRS=[["  .prize-view-cardback{ width:var(--pk-card); height:auto; aspect-ratio:660 / 921; max-width:100%; box-sizing:border-box; } /* v6.606：窄格縮寬時高度同步等比例縮小。 */", "  .prize-view-cardback{ width:var(--pk-card); height:calc(var(--pk-card) * 1.397); max-width:100%; }"]];
export function revertV6606Game(s){s=s.replace(/\r\n/g,'\n');for(const[a,b]of PAIRS){assert.equal(s.split(a).length-1,1,'6606精確還原錨點必須唯一');s=s.replace(a,b);}return s;}
