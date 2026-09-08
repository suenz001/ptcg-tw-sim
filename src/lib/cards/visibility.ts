/**
 * ⭐⭐⭐ 「這張卡要不要對玩家開放」——**全站唯一一份**述詞。
 *
 * 站長 2026-08-15 裁定（v6.194，修正 v6.193 的做法）：
 *   「那 2 組港版就先存在資料裡面就好，但請從卡牌資料庫和牌組編輯器裡面把連結移除，
 *     讓之後的玩家不會再誤選到。」
 *
 * ⇒ 卡片**留在** `static/cards/*.json`（因此也留在對戰卡池 `tournament-pool.json`），
 *   只是不出現在 `/cards`（卡牌資料庫）與牌組編輯器的候選裡。
 *
 * ⚠⚠ 為什麼不能像 v6.193 那樣直接把卡從資料裡刪掉：
 *   已歸檔的**比賽紀錄與對戰回放**裡存的是「盤面快照 + cardId」（實測 tournament-dumps
 *   的 3 份 dump 共有玩家真的用 18965 打過的場次，快照中就寫著
 *   `{"iid":"tp8phnwl","cardId":"18965",...}`）。回放不經 `migrateDeck`／`createGame`，
 *   `tReplayGoto()` 是直接把快照塞回 `game`；卡池裡沒有那個 id 時，engine 的 `getCard()`
 *   會 throw（v5.336／v6.193 都證實過同一條路徑）。**下架 ≠ 刪除**，兩者差別就在這裡。
 *
 * ⚠ 這份表是**唯一**的排除清單。任何消費點（/cards、牌組編輯器、搜尋、匯入、
 *   SEO 卡片頁與 sitemap、牌組遷移）都必須呼叫本檔的函式，
 *   **不可以在別處再寫第二份 id 清單**（必然漂移）。
 *   `src/lib/decks/cardIdMigration.ts` 的 `RETIRED_DUP_TO_TW_ID` 已改為由本表推導。
 *
 * ⚠ 本檔**零 import**（葉子模組），可安全被 `$lib/cards/pool`、`$lib/decks/*`、
 *   `$lib/server/*` 以及各 route 引用，不會造成循環相依／模組層級 TDZ。
 */

export interface HiddenCardInfo {
  /** 對玩家開放的等價卡（同名同編號、逐欄位相同的台版）。匯入／牌組遷移一律導向它。 */
  replacementId: string;
  /** 這張卡所在的卡包 —— `/cards` 的卡包摘要張數要把它扣掉，否則「92 張」點進去只有 90 張。
   *  ⚠ 必須與 `static/card-set-map.json` 一致，守衛有逐筆比對（不會漂移）。 */
  setCode: string;
  /** 為什麼下架（寫給下一個維護者看，不是給玩家看的）。 */
  reason: string;
}

/**
 * 下架卡：資料留著、但玩家選不到。
 *
 * 這 2 張是 v4.952 實裝時台灣官網尚未發布、依鐵律 7c 改用香港官網來源抓進來的
 * （圖床 `…/hk/card-img/hk000*.png`；官方台灣卡牌檢索查無此 id）。
 * v5.904 補收官方台版時新增了 18560／18564，卻沒有把舊的港版拿掉 ⇒ 同一張卡在
 * M-P-J 出現兩次，玩家在牌組編輯器會看到兩張長得一樣的卡而不知道該選哪張。
 */
export const HIDDEN_FROM_PLAYERS: Readonly<Record<string, HiddenCardInfo>> = {
  '18965': {
    replacementId: '18560',
    setCode: 'M-P-J',
    reason: '超級妖火紅狐ex 103/M-P：港版重複收錄（hk 圖床），台版為 18560',
  },
  '18969': {
    replacementId: '18564',
    setCode: 'M-P-J',
    reason: '古歷 107/M-P：港版重複收錄（hk 圖床），台版為 18564',
  },
};

/** 這個 cardId 是否已對玩家下架（＝不得出現在任何「可挑選／可瀏覽」的清單裡）。 */
export function isHiddenFromPlayers(cardId: string | number | null | undefined): boolean {
  if (cardId == null) return false;
  return String(cardId) in HIDDEN_FROM_PLAYERS;   // ⚠ 比對 id 一律 String()
}

/**
 * 把「玩家送進來的 cardId」導向實際開放的那一張。
 * 用於**任何會新增卡進牌組的入口**（貼卡表匯入、官網代碼匯入…）：
 * 指到已下架 id 時不該報「找不到」，而是換成等價的台版那張。
 * 不在表上的 id 原樣回傳。
 */
export function resolvePlayerFacingCardId(cardId: string | number): string {
  const id = String(cardId);
  return HIDDEN_FROM_PLAYERS[id]?.replacementId ?? id;
}

/** 從一份卡片清單濾掉所有已下架的卡（`/cards`、牌組編輯器牌池共用）。 */
export function filterPlayerSelectable<T extends { id: string }>(cards: readonly T[]): T[] {
  return cards.filter((c) => !isHiddenFromPlayers(c.id));
}

/**
 * 把卡包摘要（index.json 的 `cardCount` / `count`）扣掉該包的下架卡張數。
 *
 * ⚠ 為什麼一定要有這個：`/cards` 的卡包磚顯示 `set.cardCount`（來自 index.json，含下架卡），
 *   點進去卻是「共 N 張卡」（已濾）。不扣就會出現「磚上寫 92、內頁只有 90」的自相矛盾。
 *   index.json 本身**不改**（它是資料層的真實張數，卡庫完整性守衛靠它對帳）。
 */
export function applyHiddenCountsToSets<T extends { code: string; cardCount: number; count?: number }>(
  sets: readonly T[],
): T[] {
  const hiddenPerSet = new Map<string, number>();
  for (const info of Object.values(HIDDEN_FROM_PLAYERS)) {
    hiddenPerSet.set(info.setCode, (hiddenPerSet.get(info.setCode) ?? 0) + 1);
  }
  if (hiddenPerSet.size === 0) return [...sets];
  return sets.map((s) => {
    const n = hiddenPerSet.get(s.code) ?? 0;
    if (n === 0) return s;
    return {
      ...s,
      cardCount: Math.max(0, s.cardCount - n),
      ...(s.count != null ? { count: Math.max(0, s.count - n) } : {}),
    };
  });
}
