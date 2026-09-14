// ⭐⭐⭐ v6.381 錦標賽區塊 revert-diff 的**唯一資料來源**（v6.365 的續章）。
//
// 為什麼要再獨立一支（沿用 v6.291 → v6.292 → v6.365 的既有形狀）：
//   v6.381（站長裁定 B 組：(乙) 歸檔補 gameDraw、(丁) 平手公告加「瑞士制仍可繼續」）
//   在錦標賽區塊內動了 4 個地方 ＋ 新增 1 個 helper。
//   如果不把這些也還原掉，下列守衛會同時翻紅，而且全部是「合法改動撞到歷史錨」：
//     ・test-v6291 B1/B2/B4      ・test-v6292 B1/B2/B3/B5
//     ・test-v6276 B1/B2         ・test-v6266 F1／test-v6268 H1／test-v6278 I1（長度＋sha）
//   而「把它改成不驗／只比片段／加 || 放寬」是站長明文禁止的（那等於把鎖拆掉）。
//   ⇒ 全部守衛都從這裡 import 同一份還原器，鏈起來仍然是
//     「v6.381 → v6.365 → v6.292 → v6.291 → v6.276 → v6.275 / v6.290」的完整逐位元證明，
//     一個位元都沒放水。
//
// ⚠ 與 v6.365 不同：v6.381 有兩處是**既有行的行內插入**（歸檔 map 多一個欄位），
//   沒辦法用 `// >>> tag` 整段哨兵框住 ⇒ 沿用 **v6.292 的形狀**（逐字快照 ＋ 逐字移除）。
//   純新增的 helper 仍然用哨兵框住，兩種一起還原。
//
// ⚠ 這支是**資料 ＋ 純函式**，不做任何 I/O、不自己下判準；紅綠由呼叫端決定。
// ⚠ 還原器對「命中次數不合理」「還原後仍有 v6381 痕跡」一律 AssertionError ——
//   區塊被動了「宣告之外」的地方就會在這裡爆，不會靜默把東西一起吃掉。
import assert from 'node:assert';
import {
  revertV6365,
  NEW_TAIL_SHA_V6365, NEW_TEV_SHA_V6365, NEW_TEV_LEN_V6365,
} from './tourn-revert-v6365.mjs';
import { revertV6292 } from './tourn-revert-v6292.mjs';
import { revertV6291 } from './tourn-revert-v6291.mjs';

export { TAIL_ANCHOR, TEV_ANCHOR } from './tourn-revert-v6291.mjs';
export { revertV6365, stripDeclaredBlocksNewerThan } from './tourn-revert-v6365.mjs';

/** v6.381 之前（＝v6.365）的區塊指紋 —— 只還原 v6.381 的改動後必須逐位元回到這裡。 */
export const OLD_TAIL_SHA_V6365 = NEW_TAIL_SHA_V6365;
export const OLD_TEV_SHA_V6365 = NEW_TEV_SHA_V6365;
export const OLD_TEV_LEN_V6365 = NEW_TEV_LEN_V6365;

/**
 * v6.381 之後的新指紋 —— 全站 28 把區塊鎖都必須重釘到這三個值
 * （test-v6291 B4 / test-v6292 B5 在守；舊值零殘留也在守）。
 * ⚠⚠ 這三個值是對 **LF**（倉庫與 CI 的實際內容）算出來的。
 */
export const NEW_TAIL_SHA_V6381 = 'f908eb048dc41bd37f17d253b17ea5d5db5ae718fd21805d16fec27b4417b8c4';
export const NEW_TEV_SHA_V6381 = '7f5399c428aaae7e87ad849b6868d13211b0020df9ba36f7272948741be3d5a8';
export const NEW_TEV_LEN_V6381 = 224269;   // JS 字串長度（UTF-16 code unit；區塊內 emoji 各算 2）

/** 本版純新增的 helper（唯一一個用哨兵框住的區塊）。 */
export const V6381_TAGS = Object.freeze(['v6381-swiss-continue-note']);

/**
 * 本版在錦標賽區塊內動到的 4 個地方，逐字快照（after → before）。
 *   ・B-2-1 歸檔**寫入**端補 gameDraw
 *   ・B-2-2 歸檔**讀出**端（admin stats）補 gameDraw
 *   ・B-5-1 規則平手雙敗的公告加「瑞士制仍可繼續」
 *   ・B-5-2 時限平手雙敗的公告：瑞士制不再說「雙方淘汰」（非瑞士制逐字不變）
 * ⚠ 每一條的 `after` 都必須在區塊裡**恰好出現 1 次**，否則還原器爆。
 */
export const V6381_EDITS = Object.freeze([
  {
    label: 'B-2-1 archive 寫入',
    after: 'draw: !!m.draw, gameDraw: !!m.gameDraw, deadlockDraw: !!m.deadlockDraw, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved, doubleDrop:',
    before: 'draw: !!m.draw, deadlockDraw: !!m.deadlockDraw, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved, doubleDrop:',
  },
  {
    label: 'B-2-2 archive 讀出',
    after: 'draw: !!m.draw, gameDraw: !!m.gameDraw, deadlockDraw: !!m.deadlockDraw, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved })),',
    before: 'draw: !!m.draw, deadlockDraw: !!m.deadlockDraw, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved })),',
  },
  {
    label: 'B-5-1 gameDraw 公告',
    after: "        const _evNote = await TEVENTS.findOne({ _id: m.eventId });   // ⭐v6.381 B-5：只為了措辭，判定完全不看它\n"
      + "        await postSystemChat('\\u2696\\ufe0f 第 ' + m.round + ' 輪 ' + (m.p1name || 'P1') + ' vs ' + (m.p2name || 'P2') + '：雙方同時符合敗北條件，本局平手 ⇒ 依站長裁定以「雙敗」處理（雙方各記一敗，不需管理員裁定）。' + swissContinueNote(_evNote));",
    before: "        await postSystemChat('\\u2696\\ufe0f 第 ' + m.round + ' 輪 ' + (m.p1name || 'P1') + ' vs ' + (m.p2name || 'P2') + '：雙方同時符合敗北條件，本局平手 ⇒ 依站長裁定以「雙敗」處理（雙方各記一敗，不需管理員裁定）。');",
  },
  {
    label: 'B-5-2 時限平手公告',
    after: "              await postSystemChat('⏰ 對局時限到，最後回合結束後仍平手 → 自動判雙敗' + (swissPhase(ev) ? swissContinueNote(ev) : '，雙方淘汰（下一輪對手輪空）') + '。');",
    before: "              await postSystemChat('⏰ 對局時限到，最後回合結束後仍平手 → 自動判雙敗，雙方淘汰（下一輪對手輪空）。');",
  },
]);

/** 產生某一個哨兵標籤的區塊比對式（LF／CRLF 皆可）。 */
function tagRe(tag) {
  return new RegExp('[ \\t]*\\/\\/ >>> ' + tag + '\\r?\\n[\\s\\S]*?[ \\t]*\\/\\/ <<< ' + tag + '\\r?\\n', 'g');
}

/**
 * 把 v6.381 的 4 處行內改動 ＋ 1 個哨兵區塊逐字還原掉
 * （**只**還原本版；v6.365／v6.292／v6.291 的插入仍在）。
 * @param {string} block 錦標賽區塊原始碼（自 TAIL_ANCHOR 或 TEV_ANCHOR 起）
 * @returns {string} 還原後的區塊
 */
export function revertV6381(block) {
  let r = block;
  let touched = 0;
  for (const e of V6381_EDITS) {
    const n = r.split(e.after).length - 1;
    assert.ok(n <= 1,
      'revert-v6381：' + e.label + ' 的逐字快照出現 ' + n + ' 次（最多 1）—— 區塊被動了「宣告之外」的地方');
    if (n === 1) { r = r.replace(e.after, e.before); touched++; }
  }
  for (const tag of V6381_TAGS) {
    const n = (r.match(tagRe(tag)) || []).length;
    assert.ok(n <= 1,
      'revert-v6381：哨兵 ' + tag + ' 出現 ' + n + ' 次（最多 1）—— 區塊被動了「宣告之外」的地方');
    if (n === 1) { r = r.replace(tagRe(tag), ''); touched++; }
  }
  assert.ok(touched >= 1,
    'revert-v6381：這一段裡一處 v6.381 的改動都沒有 ⇒ 還原器對它是 no-op '
    + '（若 v6.381 的改動真的被拿掉了，請把呼叫端的新指紋一起改回去，不要留一個假還原器）');
  // ⭐ 還原後不得留下任何 v6.381 的痕跡：哨兵被搬走／改名／把新增碼寫到宣告外都會在這裡爆。
  assert.strictEqual(r.split('v6381').length - 1, 0,
    'revert-v6381：還原後區塊裡仍有 v6381 字樣 —— 有未宣告的插入');
  assert.strictEqual(r.split('swissContinueNote').length - 1, 0,
    'revert-v6381：還原後區塊裡仍有 swissContinueNote —— 有未宣告的插入');
  assert.strictEqual(r.split('gameDraw: !!m.gameDraw').length - 1, 0,
    'revert-v6381：還原後區塊裡仍有 gameDraw 的歸檔欄位 —— 有未宣告的插入');
  return r;
}

/** 一次還原到 v6.365（＝只把本版剝掉）。 */
export function revertToV6365(block) {
  return revertV6381(block);
}
/** 一次還原到 v6.292（v6.381 → v6.365）。 */
export function revertToV6292(block) {
  return revertV6365(revertV6381(block));
}
/** 一次還原到 v6.291（v6.381 → v6.365 → v6.292）。 */
export function revertToV6291(block) {
  return revertV6292(revertV6365(revertV6381(block)));
}
/** 一次還原到 v6.290。呼叫端要再往 v6.275 串就自己接 revertTail()。 */
export function revertV6381ToV6290(block) {
  return revertV6291(revertV6292(revertV6365(revertV6381(block))));
}
