/**
 * ⭐⭐⭐v6.197「現在坐在螢幕前的這個人，能不能操作這一局？」的**唯一**述詞。
 *
 * 事故（玩家回報）：進一般（休閒線上）對戰的觀戰、按「離開」時冒出「投降」的確認，
 *   有時候連「攻擊 / 結束回合」都按得下去。
 *
 * 真因不是某個按鈕忘了加 gate，而是舊述詞是**開放式（fail-open）**的：
 *
 *     isSpectator = isTournSpectator || (mode === 'online' && (mySeatIdx >= 2 || isAdminMode))
 *
 *   它要求「拿得出觀戰位的證據（座位 >= 2）」才算觀戰者。
 *   於是「認不出自己的座位」（mySeatIdx === -1）這個**不確定**狀態被歸成「玩家」：
 *     - 桌機頂欄從「← 首頁」翻成「🏳 投降離開」；
 *     - 手機直式的 isMyTurn 是 `!isSpectator && game.activePlayerIndex === myIdx`，
 *       而觀戰視角的 myIdx 會退回 0 ⇒ 有一半的回合會長出「⏭ 結束回合」與招式按鈕；
 *     - 更嚴重：+page.svelte 的 dispatch 唯一擋線就是 isSpectator，它一旦為 false，
 *       送出去的動作是**真的會被套用**的。
 *
 *   「認不出座位」在正式站真的會發生：oracle-client 的 401 自動重登（v5.628）會換到
 *   一個**全新的匿名 uid**，而畫面端的 myUid 只在 onMount 取過一次 ⇒ 兩者從此對不起來，
 *   `findMySeatIdx(room.seats, myUid)` 一路回 -1。
 *
 * ⇒ 本檔把述詞翻成**封閉式（fail-closed）**：線上模式下，只有「明確認得出自己是 P1/P2」
 *   才算得上玩家；其餘一切（觀戰位、認不出座位、admin 隱身、錦標賽觀戰、回放）
 *   一律唯讀。⚠ 這是**安全方向**的改變：不確定時寧可少給一個按鈕，
 *   也不可以讓一個不是當事人的瀏覽器把動作寫進別人的對局。
 *
 * ⚠⚠ 本機雙人 / AI 對戰（mode !== 'online'）沒有「觀戰」這件事，一律可操作 —— 不要用
 *   座位欄位去判本機模式（本機雙人的 myPlayerIndex 本來就是 null）。
 */

export interface ViewerRoleInput {
  /** 'online' = 線上（休閒 + 錦標賽都走這個值）；'local' = 本機雙人／AI；null = 還沒選模式 */
  mode: string | null;
  /** 座位索引：0=P1、1=P2、2~9=觀戰位、-1=認不出（⚠ 不確定，不是「不是觀戰者」） */
  mySeatIdx: number;
  /** 0/1 = 我是這一側的玩家；null = 我不是任何一側 */
  myPlayerIndex: number | null;
  /** 錦標賽觀戰 */
  isTournSpectator?: boolean;
  /** 對戰回放（蘊含觀戰；但觀戰不蘊含回放） */
  isTReplay?: boolean;
  /** admin 隱身觀戰 */
  isAdminMode?: boolean;
}

/**
 * 這個人是不是「只能看、不能動」？
 * ⚠ 回傳 true 的情境包含「不確定」，這是刻意的（fail-closed）。
 */
export function isViewerSpectator(v: ViewerRoleInput): boolean {
  if (v.isTReplay === true) return true;        // 回放永遠唯讀
  if (v.isTournSpectator === true) return true; // 錦標賽觀戰
  if (v.isAdminMode === true) return true;      // admin 隱身觀戰
  if (v.mode !== 'online') return false;        // 本機雙人 / AI：沒有觀戰概念
  // ── 以下是線上模式的 fail-closed 判定 ──────────────────────────────────
  if (v.myPlayerIndex !== 0 && v.myPlayerIndex !== 1) return true;  // 認不出自己是哪一側
  if (v.mySeatIdx !== v.myPlayerIndex) return true;                 // 兩份身分對不起來
  return false;
}

/** 這個人能不能送出動作（按鈕／拖曳／快捷鍵／dispatch 全部問這一支） */
export function canViewerAct(v: ViewerRoleInput): boolean {
  return !isViewerSpectator(v);
}

/**
 * 「線上、而且認不出自己的座位」—— 這是要對玩家講清楚的狀態，
 * 不可以只是靜靜地把按鈕收掉（玩家會以為網站壞了）。
 * ⚠ 觀戰者（座位 >= 2）不算，他本來就沒有可操作的座位。
 */
export function isSeatUnknownOnline(v: ViewerRoleInput): boolean {
  if (v.mode !== 'online') return false;
  if (v.isTReplay === true || v.isTournSpectator === true || v.isAdminMode === true) return false;
  return v.mySeatIdx < 0;
}
