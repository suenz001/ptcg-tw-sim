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
 * ── ⚠ 安全（站長已知並接受）───────────────────────────────────────────────────
 *   `uid`／`uids` 來自未驗證的 `playerIdentity`（站長裁定 `/api/match-result` 不修），
 *   理論上有人能讓自己的房被標成好友的房。
 *   ⇒ **配對到的房間一定要把房名與房主名顯示出來**（`FriendRoomHit.roomName` / `hostName`），
 *     讓玩家自己看得到再決定要不要進去。
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
 * ⚠ 順序不可改：**`openRooms` 比對優先**（2 秒一更新的實況）；比不到才看 `inTournament`（5 秒快照）。
 */
export function friendRoomState(
  row: FriendRoomSubject | null | undefined,
  index: ReadonlyMap<string, FriendRoomHit> | null | undefined,
): FriendRoomState {
  const hit = (row && index) ? lookupHit(row, index) : null;
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
