// ⭐⭐⭐ server patch v1.52（/api/tournament/bracket 只讀用得到的欄位＋in-flight 合併）錦標賽區塊 revert-diff 的**唯一資料來源**。
//
// 沿用 v6.291 → v6.292 → v6.365 → v6.381 → v6.384 → v1.50 的既有形狀（站長明文禁止「改成不驗／只比片段／加 || 放寬」）。
// 本版對錦標賽區塊的改動只有兩種：
//   ① 純新增：`// >>> v152-bracket-light` … `// <<< v152-bracket-light`（兩個 projection 常數＋bracketFindShared）。
//   ② 兩處**行內改動**：/bracket 端點的 TMATCH.find／TREGS.find 改走 bracketFindShared＋projection。
//      逐字宣告在 sap-revert-admin-v152.mjs，**這裡直接沿用那一份**（不抄第二份，Rule 38）。
// ⚠ 還原器對「命中次數不合理」一律 AssertionError ⇒ 區塊被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';
import { ADMIN_V152_INLINE_PAIRS } from './sap-revert-admin-v152.mjs';
import {
  revertV150, revertV6384, revertV6381, revertV6365, revertToV6292 as _toV6292, revertToV6291 as _toV6291,
  NEW_TAIL_SHA_V150, NEW_TEV_SHA_V150, NEW_TEV_LEN_V150,
} from './tourn-revert-v150.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';
export { revertV150, revertV6384, revertV6381, revertV6365, stripDeclaredBlocksNewerThan } from './tourn-revert-v150.mjs';
// 鏈上更早的舊指紋一併轉出去（消費者改指這一支之後，不轉就拿不到 ⇒ 鏈斷在這裡）。
export { OLD_TAIL_SHA_V6365, OLD_TEV_SHA_V6365, OLD_TEV_LEN_V6365, OLD_TAIL_SHA_V6384, OLD_TEV_SHA_V6384, OLD_TEV_LEN_V6384 } from './tourn-revert-v150.mjs';

/** v1.52 之前（＝v1.50／v1.51）的區塊指紋 —— 只還原 v1.52 的改動後必須逐位元回到這裡。
 *  （v1.51 的清掃區塊放在 TAIL_ANCHOR 之前，沒有動到錦標賽區塊。） */
export const OLD_TAIL_SHA_V150 = NEW_TAIL_SHA_V150;
export const OLD_TEV_SHA_V150 = NEW_TEV_SHA_V150;
export const OLD_TEV_LEN_V150 = NEW_TEV_LEN_V150;

/** v1.52 之後的新指紋 —— 全站的區塊鎖都必須重釘到這三個值（舊值零殘留也在守）。 */
export const NEW_TAIL_SHA_V152 = 'ca07d851c2597d57b29944234193f7ece05790e6330261ccf4b254caf6a46499';
export const NEW_TEV_SHA_V152 = '1267b66df436d9b98f4b67688a1e42080447531ec59652b6bd553c7aae9def04';
export const NEW_TEV_LEN_V152 = 236223;

/** 本版純新增的區塊（唯一一個哨兵）。 */
export const V152_TAGS = Object.freeze(['v152-bracket-light']);

function tagRe(tag) {
  return new RegExp('[ \\t]*\\/\\/ >>> ' + tag + '\\r?\\n[\\s\\S]*?[ \\t]*\\/\\/ <<< ' + tag + '\\r?\\n', 'g');
}

/**
 * 把 v1.52 的改動（哨兵區塊 ＋ /bracket 的兩行查詢）逐字還原（**只**還原本版）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 */
export function revertV152(block) {
  let r = String(block);
  let touched = 0;
  for (const tag of V152_TAGS) {
    const n = (r.match(tagRe(tag)) || []).length;
    assert.ok(n === 0 || n === 1, 'revertV152：哨兵 ' + tag + ' 命中 ' + n + ' 次（預期 0 或 1）');
    if (n === 1) { r = r.replace(tagRe(tag), ''); touched++; }
  }
  for (const [cur, old] of ADMIN_V152_INLINE_PAIRS) {
    const n = r.split(cur).length - 1;
    if (n === 0) continue;
    assert.strictEqual(n, 1, 'revertV152：行內宣告命中 ' + n + ' 次（預期 1）');
    r = r.split(cur).join(old); touched++;
  }
  assert.ok(touched > 0, 'revertV152：一處都沒還原到 ⇒ 宣告端過期了（區塊裡沒有 v1.52 的痕跡）');
  assert.ok(!r.includes('v152-bracket-light') && !r.includes('bracketFindShared') && !r.includes('BRACKET_MATCH_PROJ_V152'),
    'revertV152：還原後仍有 v1.52 的痕跡');
  return r;
}

/** 還原到 v1.50 之前（＝v6.384 的區塊）。 */
export function revertToV150(block) { return revertV150(revertV152(block)); }
/** 還原到 v6.384 之前。 */
export function revertToV6384(block) { return revertV6384(revertToV150(block)); }
/** 再往後一節：還原到 v6.381 之前（＝v6.365 的區塊）。 */
export function revertToV6365(block) { return revertV6365(revertV6381(revertToV6384(block))); }
/** 一路還原到 v6.292 的區塊（本版 → v1.50 → v6.384 → v6.381 → v6.365 → v6.292）。 */
export function revertToV6292(block) { return _toV6292(revertV152(block)); }
/** 一路還原到 v6.291 的區塊。 */
export function revertToV6291(block) { return _toV6291(revertV152(block)); }
