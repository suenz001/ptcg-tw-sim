/**
 * v6.301 好友列的「加入房間／觀戰」——**純瀏覽器端比對**的中央出口。
 *
 * ── ⚠⚠⚠ 效能紅線（站長最高優先）─────────────────────────────────────────────
 *   本檔**零請求、零 timer、零 import**。它只吃兩份「呼叫端本來就已經有」的資料：
 *     ① 線上大廳每 2 秒更新一次的 `openRooms`（`subscribeOpenRooms`，含 `seats[].uid`）；
 *     ② 好友清單回應（每位好友帶 `uid` 與最近 5 個 `uids`）。
 *   ⇒ 好友列上的按鈕**不會多打任何一發請求**。
 *
 *   ⚠⚠ 絕不可為了這個功能新增輪詢。`src/routes/game/+page.svelte` 大廳房間訂閱那個
 *     `$effect` 的 `!isTournament` 是 v6.118 的效能事故修正（每個開著錦標賽頁的玩家整場
 *     每 2 秒打兩支 `/api/rooms`，30 人賽 ≈ 每秒 30 個純浪費的請求打進 Oracle 的單執行緒）。
 *   ⇒ **錦標賽頁的好友分頁與 `/friends` 獨立頁沒有 `openRooms`，一律不傳 `rooms`，
 *     整組按鈕就不渲染**（FriendsPanel 的 `rooms` 是 optional prop）。
 *
 * ── ⚠ 複雜度：O(房間數 + 好友數)，不是 O(房間 × 好友)────────────────────────────
 *   `buildFriendRoomIndex()` 每 tick 對 ≤100 間房各查 **2 個座位**（p1／p2）建成
 *   `Map<uid, 房間>`；每位好友再做 ≤6 次 O(1) 查表（自己的 uid ＋ 最近 5 個 uids）。
 *   ⚠ 巢狀迴圈（每位好友掃一遍所有房間）在 100×100 會慢兩個數量級 —— 守衛有正對照量測。
 *
 * ── ⭐⭐⭐ v6.302 主路徑：**伺服器用 email 比對出來的 `roomId`**────────────────────
 *   v6.301 只有 uid 這一條路，而站長實測回報「好友明明在休閒房，按鈕卻是暗的」。複驗過的真因：
 *     ① `playerIdentity` 的 uid **只有在「一場對局結束」時**才會被寫進去
 *        （伺服器 `recordPlayerIdentity` 的唯一接點是 `/api/match-result`）；
 *     ② 正式站的 `seats[].uid` 是 **Oracle 匿名 JWT 的 per-瀏覽器 uid**
 *        （`oracle-client.ts` 的 `/api/auth/anonymous` ＋ localStorage `ptcg_oracle_uid`）
 *        ⇒ 換裝置／清資料／401 續簽都會換一個；
 *     ③ 那張表 2026-09-02 才上線，資料只累積了兩天。
 *   ⇒ 伺服器（v6.302+）改用**好友關係本來就在用的 email** 去比對 `rooms.seats[].email`
 *     （DB 裡一直都有，v6.220 只是不再下發給瀏覽器），每筆好友多回一個 `roomId`。
 *
 *   ⭐⭐ **「欄位不存在」與「欄位是 null」語義不同，一定要分開判**：
 *     ・`roomId` **欄位缺席**（`undefined`）＝ 伺服器沒有能力回答（舊伺服器，或新伺服器的索引自驗沒過）
 *       ⇒ **退回 v6.301 的 uid 比對**。⚠ 這只是相容退路，**不是常態路徑**。
 *     ・`roomId === null` ＝ 伺服器查過了，這位好友此刻不在任何 lobby／playing 房
 *       ⇒ **直接沒有配對**（按鈕灰掉），⚠⚠ **不可以再去試 uid**（站長裁定「改成 email 比對」，
 *       不是「兩者都用」）。
 *     ・`roomId` 是字串但 `openRooms` 裡找不到那間房（好友剛離開／房間剛關）
 *       ⇒ 一樣沒有配對（按鈕灰掉）—— 這是正確行為，`openRooms` 才是「現在」。
 *
 * ── ⚠ 安全（站長已知並接受）───────────────────────────────────────────────────
 *   ⚠⚠⚠ **換成 email 比對之後，安全性並沒有變好**（這一段是 v6.302 對 v6.301 原說明的更正）：
 *   uid 那條路（零身分驗證的 `/api/match-result` 寫 `playerIdentity`）確實從此影響不到主路徑，
 *   但 `rooms.seats[].email` 同樣是 **client 自報**的（`src/lib/game/room-oracle.ts` 建房／入座時寫入；
 *   伺服器 v1.20 的回填只在 incoming **沒帶** email 時才從 DB 補 ⇒ 帶了就以 client 為準）
 *   ⇒「有人把自己房間的座位填上別人的 email、讓那間房被標成好友的房」**仍然做得到**，
 *   而且 email 比不透明的 Oracle uid **更容易知道**。
 *   ⇒ **配對到的房間一定要把房名與房主名顯示出來**（`FriendRoomHit.roomName` / `hostName`），
 *     讓玩家自己看得到再決定要不要進去。⚠ 這條規定不因為換成 email 比對而放寬。
 *
 * ── ⚠ `inTournament` 的定位────────────────────────────────────────────────────
 *   伺服器 v6.300 起好友清單多回這個布林（**快照**，不是即時值；伺服器端另有 5 秒快照）。
 *   ・舊伺服器沒有這個欄位 ⇒ `undefined`，一律**當 false**（`=== true` 才算）。
 *   ・⚠⚠ 但「沒有 inTournament」**不等於可以放行加入**：能不能加入／觀戰**一律以
 *     `openRooms` 比對為準**，比對不到就是 `'none'`（按鈕停用）。
 */

/** 配對到的那一間休閒房（只留畫面要用的四個欄位）。 */
export interface FriendRoomHit {
  roomId: string;
  /** 房名（房間沒取名時退回房主名，與大廳列表同一套顯示規則）。 */
  roomName: string;
  hostName: string;
  /** `'lobby'`＝等待中（可加入）；`'playing'`＝對戰中（只能觀戰）。 */
  status: 'lobby' | 'playing';
}

/** 一位好友此刻的按鈕狀態。 */
export type FriendRoomKind =
  | 'join'        // 在等待中的休閒房 ⇒「🚪 加入房間」（可點）
  | 'spectate'    // 在對戰中的休閒房 ⇒「👁 觀戰」（可點）
  | 'tournament'  // inTournament === true ⇒「🏆 錦標賽對戰中」（停用）
  | 'none';       // 其餘（含資料不足）⇒ 停用

export interface FriendRoomState {
  kind: FriendRoomKind;
  /** 只有 `join` / `spectate` 會有值。 */
  room: FriendRoomHit | null;
}

/** 呼叫端傳進來的房間形狀（刻意用結構型別，本檔才不必 import `Room` ⇒ 守衛可單獨載入實跑）。 */
export interface FriendRoomSource {
  roomId?: string | null;
  roomName?: string | null;
  hostName?: string | null;
  status?: string | null;
  seats?: ReadonlyArray<{ uid?: string | null } | null | undefined> | null;
}

/** 呼叫端傳進來的好友形狀（＝`FriendRow` 的子集）。 */
export interface FriendRoomSubject {
  /**
   * ⭐⭐⭐ v6.302 伺服器用 **email** 比對出來的「此刻所在的休閒房房號」。
   * ⚠⚠ 三種值語義完全不同，`friendRoomState` 會分開處理：
   *   ・`undefined`（**欄位缺席**）＝ 伺服器答不出來 ⇒ 退回 uid 比對；
   *   ・`null` ＝ 伺服器查過了、不在任何房 ⇒ 直接沒有配對（不再試 uid）；
   *   ・字串 ＝ 去 `openRooms` 找那一間房。
   */
  roomId?: string | null;
  /** ⚠ v6.301 的相容退路（只有伺服器**沒有回** `roomId` 欄位時才會被用到）。 */
  uid?: string | null;
  uids?: readonly string[] | null;
  inTournament?: boolean;
}

/**
 * ⚠ 只看 p1／p2 兩個座位。座位 2 以後是觀戰位 —— 好友在觀戰位時他自己也只是旁觀者，
 *   把那種情況標成「他在這間房」會誤導（而且觀戰位隨時進出，抖動很大）。
 */
export const FRIEND_SEAT_SLOTS = 2;

/**
 * 建索引：`Map<座位 uid, 房間>`。**O(房間數)**（每間房固定看 2 個座位）。
 * ⚠ 同一個 uid 理論上不會同時坐兩間房；真的重複時採「先到先得」，行為穩定不抖動。
 */
export function buildFriendRoomIndex(
  rooms: ReadonlyArray<FriendRoomSource | null | undefined> | null | undefined,
): Map<string, FriendRoomHit> {
  const index = new Map<string, FriendRoomHit>();
  if (!rooms) return index;
  for (const r of rooms) {
    if (!r) continue;
    const roomId = typeof r.roomId === 'string' ? r.roomId : '';
    if (!roomId) continue;
    // ⚠ 只認得 lobby／playing 兩種；ended 或認不出來的一律不進索引（fail-closed）。
    const status: 'lobby' | 'playing' | null =
      r.status === 'lobby' ? 'lobby' : (r.status === 'playing' ? 'playing' : null);
    if (!status) continue;
    const seats = r.seats;
    if (!seats) continue;
    const hostName = typeof r.hostName === 'string' ? r.hostName : '';
    const hit: FriendRoomHit = {
      roomId,
      roomName: (typeof r.roomName === 'string' && r.roomName) ? r.roomName : hostName,
      hostName,
      status,
    };
    const slots = Math.min(FRIEND_SEAT_SLOTS, seats.length);
    for (let i = 0; i < slots; i++) {
      const uid = seats[i]?.uid;
      if (typeof uid !== 'string' || !uid) continue;
      if (!index.has(uid)) index.set(uid, hit);
    }
  }
  return index;
}

/**
 * ⭐⭐⭐ v6.302 建索引：`Map<房號, 房間>`。**O(房間數)**，與 `buildFriendRoomIndex` 同一份輸入、同一套
 * 「只認 lobby／playing」規則（`ended` 或認不出來的一律不進索引 ⇒ fail-closed）。
 * ⚠ 這是本版的**主要**查表方向：伺服器已經用 email 比對出房號，瀏覽器只負責把房號換成
 *   「現在的」房名／房主／status（`openRooms` 每 2 秒更新一次）。
 */
export function buildFriendRoomIdIndex(
  rooms: ReadonlyArray<FriendRoomSource | null | undefined> | null | undefined,
): Map<string, FriendRoomHit> {
  const index = new Map<string, FriendRoomHit>();
  if (!rooms) return index;
  for (const r of rooms) {
    if (!r) continue;
    const roomId = typeof r.roomId === 'string' ? r.roomId : '';
    if (!roomId || index.has(roomId)) continue;
    const status: 'lobby' | 'playing' | null =
      r.status === 'lobby' ? 'lobby' : (r.status === 'playing' ? 'playing' : null);
    if (!status) continue;
    const hostName = typeof r.hostName === 'string' ? r.hostName : '';
    index.set(roomId, {
      roomId,
      roomName: (typeof r.roomName === 'string' && r.roomName) ? r.roomName : hostName,
      hostName,
      status,
    });
  }
  return index;
}

/** 查一位好友的所有 uid（自己的 ＋ 最近 5 個）。≤6 次 O(1) 查表。 */
function lookupHit(
  row: FriendRoomSubject,
  index: ReadonlyMap<string, FriendRoomHit>,
): FriendRoomHit | null {
  if (typeof row.uid === 'string' && row.uid) {
    const hit = index.get(row.uid);
    if (hit) return hit;
  }
  const uids = row.uids;
  if (uids) {
    for (const u of uids) {
      if (typeof u !== 'string' || !u) continue;
      const hit = index.get(u);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 一位好友此刻的按鈕狀態。
 *
 * ⭐⭐⭐ v6.302 判斷順序（⚠ 不可改）：
 *   ① 好友這一筆**有** `roomId` 欄位（伺服器用 email 比對過）⇒ **一律以它為準**：
 *      是字串就去 `byId` 找那間房；是 `null`（或找不到那間房）就是沒有配對，
 *      ⚠⚠ **絕不再退回 uid 比對** —— 站長裁定的是「改成 email 比對」，不是「兩者都用」。
 *   ② 好友這一筆**沒有** `roomId` 欄位（`undefined`＝舊伺服器／伺服器答不出來）
 *      ⇒ 才走 v6.301 的 uid 比對退路。
 *   ③ 兩條路都沒配到房 ⇒ 才看 `inTournament`（那只是給停用按鈕一個更好的文案）。
 *
 * ⚠ 不論走哪一條，最後都要在 `openRooms` 裡真的找得到那間房才會放行 ——
 *   `openRooms` 每 2 秒更新一次，它才是「現在」。
 *
 * @param byUid v6.301 的 `Map<座位 uid, 房間>`（只有退路會用到）
 * @param byId  ⭐ v6.302 的 `Map<房號, 房間>`（主路徑）；呼叫端沒給 ⇒ 主路徑一律配不到（fail-closed）
 */
export function friendRoomState(
  row: FriendRoomSubject | null | undefined,
  byUid: ReadonlyMap<string, FriendRoomHit> | null | undefined,
  byId?: ReadonlyMap<string, FriendRoomHit> | null,
): FriendRoomState {
  let hit: FriendRoomHit | null = null;
  if (row && row.roomId !== undefined) {
    // ① 伺服器有回這個欄位（含 null）⇒ 以它為準。
    hit = (typeof row.roomId === 'string' && row.roomId && byId) ? (byId.get(row.roomId) ?? null) : null;
  } else if (row && byUid) {
    // ② 欄位缺席才退回 uid 比對。
    hit = lookupHit(row, byUid);
  }
  if (hit) return { kind: hit.status === 'lobby' ? 'join' : 'spectate', room: hit };
  if (row?.inTournament === true) return { kind: 'tournament', room: null };
  return { kind: 'none', room: null };
}

/** 按鈕文字。⚠ 不得寫成「即時」——`inTournament` 是快照。 */
export function friendRoomLabel(state: FriendRoomState): string {
  switch (state.kind) {
    case 'join': return '🚪 加入房間';
    case 'spectate': return '👁 觀戰';
    case 'tournament': return '🏆 錦標賽對戰中';
    default: return '🚪 加入房間';
  }
}

/** 只有真的配對到房間才可以點。⚠ `tournament` / `none` 一律停用（不放行加入）。 */
export function friendRoomClickable(state: FriendRoomState): boolean {
  return (state.kind === 'join' || state.kind === 'spectate') && !!state.room;
}

/** 滑鼠移上去的說明。 */
export function friendRoomTitle(state: FriendRoomState): string {
  switch (state.kind) {
    case 'join': return '加入這位好友所在的房間';
    case 'spectate': return '這位好友正在對戰中，可以進去觀戰';
    case 'tournament': return '這位好友最近正在錦標賽對戰中，無法從這裡加入';
    default: return '這位好友目前不在可加入的房間';
  }
}
