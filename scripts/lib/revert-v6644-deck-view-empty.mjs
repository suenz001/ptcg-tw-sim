// v6.644 牌庫搜尋選擇區與 validIids 取交集（感應【超】能量回報）的逐字還原；不能放寬舊範圍鎖。
import assert from 'node:assert/strict';
export const V6644_PAIRS = {"src/routes/game/+page.svelte": [["  //   產生重複 iid，寧可少顯示一張也不要整頁崩掉。\n  // >>> v6644-deck-view-empty\n  // ⭐v6.644 牌庫搜尋（deck-search）的選擇區一律與 params.validIids 取交集——與引擎中央消毒閘（sanitizeSelectedIids）同一條規則：\n  //   validIids 是「這個 picker 到底能勾什麼」的權威。原本只有少數 filter 各自交集，'any' 等其餘 filter 會無視它 ⇒\n  //   「牌庫無符合卡、只能檢視」（validIids: []）時選擇區列出整副牌庫（玩家回報：感應【超】能量）。整副牌庫仍在下方「📖 查看牌庫剩餘全部」。\n  //   判準在 selection-candidates.ts 的 deckSearchVisible（唯一一份，Rule 38）。\n  const selectionItems = $derived.by(() => dedupeByIid(pendingSelection?.type === 'deck-search'\n    ? deckSearchVisible(selectionItemsRaw, pendingSelection.params as Record<string, unknown> | undefined)\n    : selectionItemsRaw));\n  // <<< v6644-deck-view-empty\n\n", "  //   產生重複 iid，寧可少顯示一張也不要整頁崩掉。\n  const selectionItems = $derived.by(() => dedupeByIid(selectionItemsRaw));\n\n"], ["  import { staleVersionDiagWhy } from '$lib/tournament/stale-diag';\n  import { activeEnergyDiscardCandidates, fieldPickerBaseCandidates, handDiscardCandidates, damageDistributeCandidates, deckSearchVisible } from '$lib/game/selection-candidates';   // ⭐v6.644 deckSearchVisible\n  import { selectionAllowsSkip, selectionAllowsCancel, selectionConfirmFloor, selectionHasNoExit, aiStuckSelectionPayload } from '$lib/game/selection-ui';\n", "  import { staleVersionDiagWhy } from '$lib/tournament/stale-diag';\n  import { activeEnergyDiscardCandidates, fieldPickerBaseCandidates, handDiscardCandidates, damageDistributeCandidates } from '$lib/game/selection-candidates';\n  import { selectionAllowsSkip, selectionAllowsCancel, selectionConfirmFloor, selectionHasNoExit, aiStuckSelectionPayload } from '$lib/game/selection-ui';\n"]], "src/lib/version.ts": [[" */\nexport const VERSION = '6.644';\n", " */\nexport const VERSION = '6.643';\n"]], "static/site-version.txt": [["6.644\n", "6.643\n"]]};
export function revertV6644IfPresent(path, source) {
  let s = source.replace(/\r\n/g, '\n');
  const pairs = V6644_PAIRS[path];
  if (!pairs || !pairs.every(([a]) => s.split(a).length === 2)) return s;
  for (const [a, b] of pairs) {
    assert.equal(s.split(a).length, 2, 'v6644 還原錨點缺失或重複 ' + path);
    s = s.replace(a, () => b);
  }
  return s;
}
