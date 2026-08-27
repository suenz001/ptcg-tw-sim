/**
 * v4.62 Phase 3b — Oracle backend equivalent of room.ts.
 *
 * 同樣 export 介面（22 個 function + types + constants），但內部用 oracle-client.ts
 * 走 fetch 取代 Firestore。Phase 3c 設 vite alias 在 build 時切換。
 *
 * 跟 room.ts 差異：
 *   - auth: oracleAuth() 而非 firebase auth.currentUser
 *   - onSnapshot → oraclePollRoom (800ms polling)
 *   - runTransaction → oracleTransaction helper (optimistic lock retry)
 *   - serverTimestamp() → Date.now() (server 端會自動 set updatedAt)
 *   - deleteField() → 設為 null (前端 readers 用 ?? 處理)
 *   - subcollection messages → top-level messages collection
 */
import {
  oracleAuth, oracleApi, oracleGetRoom, oracleUpsertRoom, oracleDeleteRoom,
  oracleListRooms, oraclePollRoom, oracleListMessages, oracleCurrentUid,
  oracleListRoomsCombined, ROOMS_UNCHANGED, ROOMS_COMBINED_UNSUPPORTED,
  // ⭐⭐⭐v6.245 逾時判別與「失敗有狀態副作用」的放寬值
  isOracleTimeout, ORACLE_SIDEEFFECT_TIMEOUT_MS,
  type OracleRoom, type OracleUpsertResult,
} from './oracle-client';
// v4.961：oracle mode 也有 firebase auth（signInAnonymously / sign-in upgrade），
// 拿 email 寫進 seat 給 admin 追蹤玩家身份。
import { auth } from '$lib/firebase';
import type { GameState } from './types';
import type { Card } from '$lib/cards/types';
import { createGame } from './engine';
import { shouldSkipStalePush } from './sync-guards';
import { adoptOrKeep } from '$lib/ui/stale-keep';

// ── re-export types & const from room.ts ────────────────────────────────────
export type { Room, RoomData, Seat, SeatRole, DeckEntry, ChatMessage } from './room';
export {
  SEAT_LAYOUT_VERSION, TOTAL_SEATS, SPECTATOR_SEATS, HEARTBEAT_STALE_MS,
  generateRoomCode, findMySeatIdx, countDeckCards, bothPlayersReady, isSeatStale,
  LOBBY_HOST_AWAY_MS, LOBBY_HOST_STALE_MS, hostPresence,
} from './room';

import type { Room, RoomData, Seat, DeckEntry, ChatMessage } from './room';
import {
  findMySeatIdx, generateRoomCode, countDeckCards,
  SEAT_LAYOUT_VERSION, SPECTATOR_SEATS, isLobbyHostDead, isLobbyTooOld,
} from './room';

// ── private helpers ─────────────────────────────────────────────────────────

/** v2.46：從 seats 推導 memberUids（去重 + 過濾 null）。 */
function computeMemberUids(seats: Seat[]): string[] {
  const set = new Set<string>();
  for (const s of seats) {
    if (s.uid) set.add(s.uid);
  }
  return Array.from(set);
}

function emptySeats(): Seat[] {
  const seats: Seat[] = [
    { role: 'p1', uid: null, name: null, deckEntries: null, ready: false, firstChoicePreference: 'random' as const },
    { role: 'p2', uid: null, name: null, deckEntries: null, ready: false, firstChoicePreference: 'random' as const },
  ];
  for (let i = 0; i < SPECTATOR_SEATS; i++) {
    seats.push({ role: 'spectator', uid: null, name: null, deckEntries: null, ready: false, firstChoicePreference: 'random' as const });
  }
  return seats;
}

/**
 * Optimistic lock retry — 取代 firestore runTransaction。
 *
 * ⭐⭐⭐v6.245 逾時**不當成硬失敗**，直接走這裡**既有的 409 重試路徑**：
 *   迴圈的每一輪都是「先 `oracleGetRoom` 重新拉最新盤面 → 對**新**盤面重跑 `fn` → 再寫」，
 *   所以重試本身就是「重新同步再重做」，**不是把同一包 40~48KB 原樣重送**。
 *   （原樣重送對 4.4 kbps 的玩家＝每 30 秒砍一次、永遠傳不完，比不加逾時更糟。）
 * ⚠ 上限：逾時最多只吃掉 **1 次**重試（與 409 的 5 次分開計數），並用比 409 更長的退避，
 *   避免自我重呼叫失控（上行真的塞死時，最多 2×timeout 就會把錯誤丟給呼叫端＝解鎖 UI）。
 * ⚠ 重新拉盤面那一發是 GET（body 幾乎為 0）—— 塞住的是**上行**，所以它拉得回來。
 */
const TX_TIMEOUT_RETRY_MAX = 1;
async function oracleTx(
  roomCode: string,
  fn: (data: RoomData) => RoomData | Promise<RoomData>,
  opts?: { timeoutMs?: number },
): Promise<RoomData> {
  let timeoutRetries = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await oracleGetRoom(roomCode);
    if (!room) throw new Error('room not found');
    const data = room as unknown as RoomData;
    const ver = (room as OracleRoom)._version;
    const newData = await fn(data);
    let result: OracleUpsertResult;
    try {
      result = await oracleUpsertRoom(roomCode, newData as unknown as Record<string, unknown>, ver, opts);
    } catch (err) {
      if (!isOracleTimeout(err) || timeoutRetries >= TX_TIMEOUT_RETRY_MAX) throw err;
      timeoutRetries++;
      await new Promise(r => setTimeout(r, 1000 * timeoutRetries));
      continue;   // ← 下一輪必定先重新同步（迴圈開頭的 oracleGetRoom），再對新盤面重做
    }
    if ('ok' in result) return result.room as unknown as RoomData;
    // conflict → retry after small backoff
    await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
  }
  throw new Error('oracleTx: max retries exhausted');
}

async function getMyUid(): Promise<string> {
  const { uid } = await oracleAuth();
  return uid;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function createRoom(
  roomName: string,
  hostName: string,
  allowUndo: boolean = false,  // v4.75 練習模式
  visible: boolean = true,     // v5.003 私密房旗標（false = 不在大廳顯示）
): Promise<string> {
  const uid = await getMyUid();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRoomCode();
    const seats = emptySeats();
    // v4.961：寫入 sign-in email（若有）— 從 firebase auth 拿（即使是 oracle mode）
    const myEmail = auth.currentUser?.email ?? null;
    seats[0] = { role: 'p1', uid, email: myEmail, name: hostName, deckEntries: null, ready: false, firstChoicePreference: 'random' as const };
    const data: Record<string, unknown> = {
      roomName: roomName.trim() || (hostName + ' 的房間'),
      hostUid: uid,
      hostName,
      status: 'lobby',
      seats,
      memberUids: computeMemberUids(seats),
      gameState: null,
      schemaVersion: SEAT_LAYOUT_VERSION,
      ...(allowUndo ? { allowUndo: true } : {}),
      // v5.003：私密房旗標（預設 true = 公開，只在 false 時寫入省 doc 大小）
      ...(visible === false ? { visible: false } : {}),
    };
    // upsert with no expectedVersion → creates if missing
    // ⚠v6.245 建房失敗**有狀態副作用**（伺服器其實建好了、client 卻以為失敗 → 換房號再建一間
    //   ⇒ 大廳出現孤兒房）⇒ 逾時放寬到 60 秒，慢網路不該被誤殺。房間初始 doc 很小（沒有盤面）。
    const result = await oracleUpsertRoom(code, data, undefined, { timeoutMs: ORACLE_SIDEEFFECT_TIMEOUT_MS });
    if ('ok' in result && result.room._version === 1) return code;
    // hit existing room code → retry with new code
  }
  throw new Error('無法產生唯一房號');
}

export async function joinRoom(roomCode: string, guestName: string): Promise<Room> {
  const uid = await getMyUid();
  const code = roomCode.toUpperCase().trim();
  const room = await oracleGetRoom(code);
  if (!room) throw new Error('找不到房間，請確認房號');
  const data = room as unknown as RoomData;
  if ((data.schemaVersion ?? 1) < SEAT_LAYOUT_VERSION) {
    throw new Error('此房間是舊版本，請對方建立新房間');
  }
  if (data.status === 'ended') throw new Error('此房對戰已結束');
  if (data.status === 'playing' && data.spectatorsAllowed === false) {
    throw new Error('此房對戰中未開放觀戰');
  }

  return await oracleTx(code, (cur) => {
    const seats = cur.seats ?? [];
    const existingIdx = findMySeatIdx(seats, uid);
    if (existingIdx >= 0) {
      // 殘留座位 → 更新名字
      const newSeats = seats.map((s, i) => i === existingIdx ? { ...s, name: guestName } : s);
      return { ...cur, seats: newSeats, memberUids: computeMemberUids(newSeats) };
    }
    // v5.127：lobby 階段優先填對戰位 P1/P2（同 room.ts 修法）
    let targetIdx = -1;
    if (cur.status === 'lobby') {
      // lobby：優先填 P1/P2
      for (let i = 0; i < 2; i++) {
        if (seats[i].uid === null) { targetIdx = i; break; }
      }
    }
    // 找第一個空觀戰位（lobby 對戰位都滿 / playing 階段才走此路）
    if (targetIdx === -1) {
      for (let i = 2; i < seats.length; i++) {
        if (seats[i].uid === null) { targetIdx = i; break; }
      }
    }
    if (targetIdx === -1) throw new Error(cur.status === 'playing' ? '觀戰位已滿' : '房間已滿');
    // v4.961：寫入 sign-in email
    const myEmail = auth.currentUser?.email ?? null;
    const newSeats = seats.map((s, i) => {
      if (i !== targetIdx) return s;
      return { ...s, uid, email: myEmail, name: guestName, deckEntries: null, ready: false, firstChoicePreference: 'random' as const };
    });
    return { ...cur, seats: newSeats, memberUids: computeMemberUids(newSeats) };
    // ⚠v6.245 進場＝「失敗有狀態副作用」⇒ 逾時放寬到 60 秒（慢網路不該被誤殺）。
  }, { timeoutMs: ORACLE_SIDEEFFECT_TIMEOUT_MS }).then(updated => ({ ...updated, roomId: code }));
}

export async function takeSeat(roomCode: string, targetIdx: number): Promise<void> {
  const uid = await getMyUid();
  if (targetIdx < 0 || targetIdx >= 10) throw new Error('座位編號錯誤');
  await oracleTx(roomCode.toUpperCase(), (data) => {
    if (data.status !== 'lobby') throw new Error('房間已開始，無法移動座位');
    const seats = data.seats;
    const myIdx = findMySeatIdx(seats, uid);
    if (myIdx === targetIdx) return data;
    if (seats[targetIdx].uid !== null) throw new Error('該座位已被占用');
    const myName = myIdx >= 0 ? seats[myIdx].name : null;
    // v4.961：移位也帶上 sign-in email
    const myEmail = auth.currentUser?.email ?? null;
    const newSeats = seats.map((s, i) => {
      if (i === myIdx) {
        return { ...s, uid: null, email: null, name: null, deckEntries: null, ready: false, firstChoicePreference: 'random' as const };
      }
      if (i === targetIdx) {
        return { ...s, uid, email: myEmail, name: myName, deckEntries: null, ready: false, firstChoicePreference: 'random' as const };
      }
      return s;
    });
    return { ...data, seats: newSeats, memberUids: computeMemberUids(newSeats) };
    // ⚠v6.245 入座＝「失敗有狀態副作用」⇒ 逾時放寬到 60 秒。
  }, { timeoutMs: ORACLE_SIDEEFFECT_TIMEOUT_MS });
}

export async function setSeatDeck(roomCode: string, deckEntries: DeckEntry[]): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0) throw new Error('你不在此房間');
    if (data.seats[myIdx].role === 'spectator') throw new Error('觀戰位不能設牌組');
    const newSeats = data.seats.map((s, i) =>
      i === myIdx ? { ...s, deckEntries, ready: false } : s
    );
    return { ...data, seats: newSeats, memberUids: computeMemberUids(newSeats) };
  });
}

export async function setSeatReady(roomCode: string, ready: boolean): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0) throw new Error('你不在此房間');
    if (data.seats[myIdx].role === 'spectator') throw new Error('觀戰位不能準備');
    const seat = data.seats[myIdx];
    if (ready && countDeckCards(seat.deckEntries) !== 60) {
      throw new Error('請先選擇 60 張牌組');
    }
    const newSeats = data.seats.map((s, i) => i === myIdx ? { ...s, ready } : s);
    return { ...data, seats: newSeats, memberUids: computeMemberUids(newSeats) };
  });
}

export async function setSeatFirstChoice(roomCode: string, choice: 'random' | 'first' | 'second' | 'opponent'): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0) throw new Error('你不在此房間');
    if (data.seats[myIdx].role === 'spectator') throw new Error('觀戰位不能設先後攻偏好');
    const newSeats = data.seats.map((s, i) =>
      i === myIdx ? { ...s, firstChoicePreference: choice } : s
    );
    return { ...data, seats: newSeats, memberUids: computeMemberUids(newSeats) };
  });
}

export async function setSpectatorsAllowed(roomCode: string, allowed: boolean): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0 || myIdx > 1) throw new Error('只有 P1/P2 可改觀戰開關');
    return { ...data, spectatorsAllowed: allowed };
  });
}

/**
 * v5.329 設定房間「對手閒置判定獲勝」秒數 — Oracle 版（clamp 60~300、snap 30 秒）。
 */
export async function setIdleTimeout(roomCode: string, sec: number): Promise<void> {
  const uid = await getMyUid();
  const clamped = Math.min(300, Math.max(60, Math.round(sec / 30) * 30));
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0 || myIdx > 1) throw new Error('只有 P1/P2 可改閒置判定時間');
    return { ...data, idleTimeoutSec: clamped };
  });
}

/**
 * v5.225 宣告對手棄權 — Oracle 版本，鏡射 room.ts 同名函式。
 */
/**
 * v5.605：宣告對手棄權前，用「最新伺服器盤面」確認真的還在等對手動作。
 *   防「對手其實已補位/行動，但我方畫面 stale 沒同步 → 仍宣告獲勝 / 反被誤判」的情況。
 *   邏輯鏡射 +page.svelte isWaitingOnOpponent。
 */
function _waitingOnOpp(gs: any, seat: 0 | 1): boolean {
  if (!gs) return false;
  const opp = (1 - seat) as 0 | 1;
  // v5.697：setup 階段——我已放置+準備、對手還沒 → 等對手（與前端 isWaitingOnOpponent 一致；
  //   修對手 setup 掛機無法宣告棄權。startGame 已設 room status='playing',故 claim 的 status gate 會過）。
  if (gs.phase === 'setup') { const sd = gs.setupDone || []; return !!sd[seat] && !sd[opp]; }
  if (gs.phase !== 'playing') return false;
  if (gs.pendingSelection) return gs.pendingSelection.actorIdx === opp;
  // v5.698：待拿獎賞卡（pendingPrizes）→ 由該方拿取（與前端 isWaitingOnOpponent / 錦標賽 tCurrentActorSeat 一致）。
  const pp = gs.pendingPrizes;
  if (pp && (pp[opp] || 0) > 0) return true;
  if (pp && (pp[seat] || 0) > 0) return false;
  const oppP = gs.players?.[opp], meP = gs.players?.[seat];
  if (oppP && oppP.active == null && (oppP.bench?.length ?? 0) > 0) return true;
  if (meP && meP.active == null && (meP.bench?.length ?? 0) > 0) return false;
  return gs.activePlayerIndex === opp;
}

export async function claimOpponentForfeit(roomCode: string, mySeatIdx: 0 | 1): Promise<boolean> {
  const uid = oracleCurrentUid();
  if (!uid) return false;
  const code = roomCode.toUpperCase();
  try {
    await oracleTx(code, (cur) => {
      if (cur.status !== 'playing' || !cur.gameState) throw new Error('NOT_PLAYING');
      const myIdx = findMySeatIdx(cur.seats, uid);
      if (myIdx !== mySeatIdx) throw new Error('NOT_ME');
      const myGs = cur.gameState;
      // v5.605：以最新伺服器盤面再驗證——對手其實已行動(我方畫面 stale)→ 不判
      if (!_waitingOnOpp(myGs as any, mySeatIdx)) throw new Error('OPP_ACTED');
      const oppIdx = (1 - mySeatIdx) as 0 | 1;
      const oppName = myGs.players?.[oppIdx]?.name ?? ('P' + (oppIdx + 1));
      const myName = myGs.players?.[mySeatIdx]?.name ?? ('P' + (mySeatIdx + 1));
      const forfeitGame = {
        ...myGs,
        phase: 'game-over' as const,
        winner: mySeatIdx,
        winReason: oppName + ' 長時間無回應，被宣告棄權',
        log: [
          ...(myGs.log ?? []),
          { turn: myGs.turn, playerIndex: null, message: oppName + ' 長時間無回應，' + myName + ' 宣告對手棄權獲勝' },
        ],
      };
      return { ...cur, gameState: JSON.parse(JSON.stringify(forfeitGame)), status: 'ended' };
    });
    return true;
  } catch (err: any) {
    if (err && (err.message === 'OPP_ACTED' || err.message === 'NOT_PLAYING' || err.message === 'NOT_ME')) return false;
    console.warn('[oracle claimOpponentForfeit]', err);
    return false;
  }
}

export async function leaveRoom(roomCode: string): Promise<void> {
  const uid = oracleCurrentUid();
  if (!uid) return;
  const code = roomCode.toUpperCase();
  try {
    const room = await oracleGetRoom(code);
    if (!room) return;
    const data = room as unknown as RoomData;
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0) return;
    // v4.499 playing 期間棄賽 — 設 gameState.phase='game-over' + winner=對手 + status='ended'
    if (data.status === 'playing' && data.gameState && (myIdx === 0 || myIdx === 1)) {
      await oracleTx(code, (cur) => {
        if (cur.status !== 'playing' || !cur.gameState) return cur;
        const myGs = cur.gameState;
        const winnerIdx = (1 - myIdx) as 0 | 1;
        const myName = myGs.players?.[myIdx]?.name ?? ('P' + (myIdx + 1));
        const forfeitGame = {
          ...myGs,
          phase: 'game-over' as const,
          winner: winnerIdx,
          winReason: '對手承認技不如人，先行離開了',
          log: [
            ...(myGs.log ?? []),
            { turn: myGs.turn, playerIndex: null, message: myName + ' 中途離開遊戲，對手獲勝' },
          ],
        };
        return { ...cur, gameState: JSON.parse(JSON.stringify(forfeitGame)), status: 'ended' };
      });
      return;
    }
    // ⭐⭐⭐v6.197 觀戰者離開房間要真的把觀戰位還回去。
    //   舊碼在這裡是 `if (data.status !== 'lobby') return;` —— 對戰中（playing）的觀戰者
    //   按下「離開」之後，伺服器上他還坐在那個觀戰位：觀戰位只有 8 個，殘留會把後面的人
    //   擋在「觀戰位已滿」外面，memberUids 也一直帶著他。
    //   ⚠ 只放行觀戰位（>= 2）：P1/P2 在 playing 的離場語義是上面那段「棄賽判對手勝」，
    //     這裡一個字都不可以碰到他們。
    //   ⚠ 交易內要**重新**找一次自己的座位（上面讀到的 data 可能已經過期）。
    if (data.status !== 'lobby') {
      if (myIdx < 2) return;
      await oracleTx(code, (cur) => {
        const seats = cur.seats ?? [];
        const i = findMySeatIdx(seats, uid);
        if (i < 2) return cur;
        const ns = seats.map((s, k) =>
          k === i ? { ...s, uid: null, name: null, deckEntries: null, ready: false, firstChoicePreference: 'random' as const } : s
        );
        return { ...cur, seats: ns, memberUids: computeMemberUids(ns) };
      });
      return;
    }
    const newSeats = data.seats.map((s, i) =>
      i === myIdx ? { ...s, uid: null, name: null, deckEntries: null, ready: false, firstChoicePreference: 'random' as const } : s
    );
    const allEmpty = newSeats.every(s => s.uid === null);
    if (allEmpty) {
      await oracleDeleteRoom(code);
    } else {
      await oracleTx(code, (cur) => ({ ...cur, seats: newSeats, memberUids: computeMemberUids(newSeats) }));
    }
  } catch (err) {
    console.warn('[oracle leaveRoom]', err);
  }
}

// ── Rematch (v3.96 對稱設計) ─────────────────────────────────────────

export async function setRematchReady(roomCode: string, ready: boolean): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0 || myIdx > 1) throw new Error('只有 P1/P2 可使用再來一局');
    const cur = data.rematchReady ?? {};
    const newReady = { ...cur, [myIdx]: ready };
    return { ...data, rematchReady: newReady };
  });
}

export async function checkAndAcceptRematch(roomCode: string): Promise<boolean> {
  try {
    let didReset = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      const ready = data.rematchReady ?? {};
      if (!ready[0] || !ready[1]) return data;
      const newSeats = data.seats.map(s => ({ ...s, ready: false }));
      didReset = true;
      // delete field via null (前端 ?? 處理)
      return {
        ...data,
        gameState: null,
        status: 'lobby',
        seats: newSeats,
        memberUids: computeMemberUids(newSeats),
        rematchReady: null,
      } as unknown as RoomData;
    });
    return didReset;
  } catch (err) {
    console.error('[checkAndAcceptRematch] failed:', err);
    return false;
  }
}

// ── Restart (v4.60 對局中重新開局) ────────────────────────────────────

export async function proposeRestart(roomCode: string): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0 || myIdx > 1) throw new Error('only P1/P2 can propose restart');
    if (data.status !== 'playing' || !data.gameState) throw new Error('game not in progress');
    const count = data.restartProposalCount ?? 0;
    const cur = data.restartProposed ?? {};
    if (cur[myIdx] || cur[1 - myIdx]) throw new Error('proposal already in progress');
    const newProposed = { ...cur, [myIdx]: true };
    return {
      ...data,
      restartProposed: newProposed,
      restartProposedAt: Date.now(),
      restartProposalCount: count + 1,
      restartRejectedAt: null,
    } as unknown as RoomData;
  });
}

export async function respondRestart(roomCode: string, accept: boolean): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0 || myIdx > 1) throw new Error('only P1/P2 can respond');
    const cur = data.restartProposed ?? {};
    if (!cur[1 - myIdx]) throw new Error('opponent did not propose');
    if (accept) {
      return { ...data, restartProposed: { ...cur, [myIdx]: true } } as unknown as RoomData;
    }
    return {
      ...data,
      restartProposed: null,
      restartProposedAt: null,
      restartRejectedAt: Date.now(),
    } as unknown as RoomData;
  });
}

export async function cancelRestart(roomCode: string): Promise<void> {
  try {
    await oracleTx(roomCode.toUpperCase(), (data) => {
      if (!data.restartProposed) return data;
      return { ...data, restartProposed: null, restartProposedAt: null } as unknown as RoomData;
    });
  } catch (err) {
    console.warn('[cancelRestart]', err);
  }
}

export async function checkAndAcceptRestart(roomCode: string, pool: Map<string, Card>): Promise<boolean> {
  try {
    let didReset = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      const p = data.restartProposed ?? {};
      if (!p[0] || !p[1]) return data;
      const p1 = data.seats[0];
      const p2 = data.seats[1];
      if (!p1.deckEntries || !p2.deckEntries) return data;
      const prefs: ['random'|'first'|'second', 'random'|'first'|'second'] = [
        p1.firstChoicePreference ?? 'random',
        p2.firstChoicePreference ?? 'random',
      ];
      const newGame = createGame(
        { name: p1.name ?? 'P1', entries: p1.deckEntries },
        { name: p2.name ?? 'P2', entries: p2.deckEntries },
        pool,
        // v6.057：與建局端一致，放行互動式開局
        { firstChoicePreferences: prefs },
      );
      didReset = true;
      return {
        ...data,
        gameState: JSON.parse(JSON.stringify(newGame)),
        restartProposed: null,
        restartProposedAt: null,
      } as unknown as RoomData;
    });
    return didReset;
  } catch (err) {
    console.error('[checkAndAcceptRestart] failed:', err);
    return false;
  }
}

// ── v5.182 propose-return-to-room (回房間選牌組) — Oracle 版仿 restart pattern ─

export async function proposeReturnToRoom(roomCode: string): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0 || myIdx > 1) throw new Error('only P1/P2 can propose');
    if (data.status !== 'playing' || !data.gameState) throw new Error('game not in progress');
    const count = data.returnRoomProposalCount ?? 0;
    const cur = data.returnRoomProposed ?? {};
    if (cur[myIdx] || cur[1 - myIdx]) throw new Error('proposal already in progress');
    const newProposed = { ...cur, [myIdx]: true };
    return {
      ...data,
      returnRoomProposed: newProposed,
      returnRoomProposedAt: Date.now(),
      returnRoomProposalCount: count + 1,
      returnRoomRejectedAt: null,
    } as unknown as RoomData;
  });
}

export async function respondReturnToRoom(roomCode: string, accept: boolean): Promise<void> {
  const uid = await getMyUid();
  await oracleTx(roomCode.toUpperCase(), (data) => {
    const myIdx = findMySeatIdx(data.seats, uid);
    if (myIdx < 0 || myIdx > 1) throw new Error('only P1/P2 can respond');
    const cur = data.returnRoomProposed ?? {};
    if (!cur[1 - myIdx]) throw new Error('opponent did not propose');
    if (accept) {
      return { ...data, returnRoomProposed: { ...cur, [myIdx]: true } } as unknown as RoomData;
    }
    return {
      ...data,
      returnRoomProposed: null,
      returnRoomProposedAt: null,
      returnRoomRejectedAt: Date.now(),
    } as unknown as RoomData;
  });
}

export async function cancelReturnToRoom(roomCode: string): Promise<void> {
  try {
    await oracleTx(roomCode.toUpperCase(), (data) => {
      if (!data.returnRoomProposed) return data;
      return { ...data, returnRoomProposed: null, returnRoomProposedAt: null } as unknown as RoomData;
    });
  } catch (err) {
    console.warn('[cancelReturnToRoom]', err);
  }
}

export async function checkAndAcceptReturnToRoom(roomCode: string): Promise<boolean> {
  try {
    let didReset = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      const p = data.returnRoomProposed ?? {};
      if (!p[0] || !p[1]) return data;
      const newSeats = data.seats.map(s => ({ ...s, ready: false }));
      didReset = true;
      return {
        ...data,
        // v5.183: status 'waiting' → 'lobby' (同 rematch path, onRoom L4187 偵測)
        status: 'lobby',
        gameState: null,
        seats: newSeats,
        returnRoomProposed: null,
        returnRoomProposedAt: null,
      } as unknown as RoomData;
    });
    return didReset;
  } catch (err) {
    console.error('[checkAndAcceptReturnToRoom] failed:', err);
    return false;
  }
}

// ── Game flow ───────────────────────────────────────────────────────────────

export async function startGame(roomCode: string, gameState: GameState): Promise<boolean> {
  try {
    let started = false;
    await oracleTx(roomCode.toUpperCase(), (data) => {
      if (data.status !== 'lobby') return data;
      if (data.gameState) return data;
      started = true;
      return {
        ...data,
        gameState: JSON.parse(JSON.stringify(gameState)),
        status: 'playing',
      };
      // ⚠v6.245 開局＝封包最大（整包盤面）且「失敗有狀態副作用」⇒ 逾時放寬到 60 秒。
    }, { timeoutMs: ORACLE_SIDEEFFECT_TIMEOUT_MS });
    return started;
  } catch (err) {
    // v6.055 診斷：同 room.ts —— 留一份錯誤給 UI 顯示，否則建局失敗完全無聲。
    (globalThis as unknown as { __ptcgStartGameError?: string }).__ptcgStartGameError =
      (err as Error)?.message ?? String(err);
    console.error('[oracle startGame]', err);
    return false;
  }
}

export async function pushGameState(roomCode: string, gameState: GameState): Promise<void> {
  await oracleTx(roomCode.toUpperCase(), (data) => {
    // v5.346：回退防護 — 防止「stale 本地 push 覆蓋房間更新的狀態」。
    //   根因：optimistic UI 讓玩家在前一個 push（如寶芬/搜尋的 pending 狀態）尚未 commit 前就點了
    //   下一步，兩個 pushGameState 的 oracleTx 可能 out-of-order commit（後到的是『較早』狀態），
    //   把房間洗回舊狀態 → 對手畫面回退/沒顯示、自己端 pending 被 poll 讀回重觸發（寶芬畫面再閃一次）。
    //   修法：playing 期間，若我方 gameState 比房間現有『嚴格較舊』(log 長度為單調序) → 不覆蓋，
    //   保留房間較新狀態（idempotent；本地稍後由 poll 收斂到較新）。不擋等長，避免雙端互卡。
    const cur = (data as unknown as { gameState?: GameState | null }).gameState;
    if (shouldSkipStalePush(gameState, cur)) {
      return data; // 我方較舊 → 略過寫入，不 regress 房間（邏輯抽至 sync-guards.shouldSkipStalePush）
    }
    return {
      ...data,
      gameState: JSON.parse(JSON.stringify(gameState)),
      status: gameState.phase === 'game-over' ? 'ended' : 'playing',
    };
  });
}

/**
 * v5.390 悔棋專用推送（Oracle）。
 *   ⚠️ 故意「不」套用 pushGameState 的單調 stale guard — 悔棋 rollback 的 log 比房間現有短，
 *   若走一般 push 會被那道 guard 擋掉、根本寫不進房間（正式站毀棋失效的直接根因）。
 *   atomic：同一個 oracleTx 寫 gameState + 清 undoRequest + bump lastUndoApplyAt 一次性標記。
 */
export async function pushUndoRollback(roomCode: string, gameState: GameState): Promise<void> {
  await oracleTx(roomCode.toUpperCase(), (data) => ({
    ...data,
    gameState: JSON.parse(JSON.stringify(gameState)),
    status: gameState.phase === 'game-over' ? 'ended' : 'playing',
    undoRequest: undefined,
    lastUndoApplyAt: Date.now(),
  }));
}

// ── Subscribe (polling) ─────────────────────────────────────────────────────

/**
 * v6.216③:休閒對戰盤面輪詢的自適應檔位（純函式，守衛直接實跑）。
 *   - 觀戰者:4000 / 6000(背景) — v5.777 既有行為不變。
 *   - 對戰者背景分頁:2500 — v5.359 既有行為不變。
 *   - 對戰者前景:等對手動作維持 500(快檔不變);「明確等待自己輸入」時降到 1000。
 *   查證(v6.216):自己回合時對手仍可能寫盤面的路徑裡,唯一需要即時反映的是
 *   「我方效果把選擇權交給對手」(pendingSelection / pendingChainQueue)——由 caller 的
 *   waitingSelfInput 定義排除(盤面上有任何 pending 就不算等待自己輸入,比逐項判 actorIdx
 *   更保守);其餘(對手投降/悔棋請求/心跳)皆低頻事件,晚半秒看到無感。
 */
export function computeCasualRoomPollMs(bg: boolean, spectator: boolean, waitingSelfInput: boolean): number {
  if (spectator) return bg ? 6000 : 4000;
  if (bg) return 2500;
  return waitingSelfInput ? 1000 : 500;
}

export function subscribeRoom(roomCode: string, callback: (room: Room | null) => void, isSpectator?: () => boolean, isWaitingSelfInput?: () => boolean): () => void {
  const code = roomCode.toUpperCase();
  return oraclePollRoom(code, (room) => {
    if (!room) { callback(null); return; }
    callback({ ...(room as unknown as RoomData), roomId: code });
    // v5.347：自適應輪詢間隔 — 前景(分頁可見)時加快、對手動作更即時；
    //   背景(document.hidden)時放慢以省手機電量/行動數據。
    //   只改 cadence，不動 callback/merge/push；callback 仍只在 _version 變化時觸發。
  }, () => {
    // v6.216③:檔位決策收斂到 computeCasualRoomPollMs;isWaitingSelfInput 缺席或丟例外
    //   一律當 false ⇒ 行為退回 v5.777/v5.359 的 500/2500/4000/6000,絕不因新參數變慢。
    const bg = (typeof document !== 'undefined' && document.hidden);
    let waiting = false;
    try { waiting = isWaitingSelfInput?.() === true; } catch { waiting = false; }
    return computeCasualRoomPollMs(bg, isSpectator?.() === true, waiting);
  });
}

/**
 * v6.217①② 大廳列表的「client 端顯示過濾+排序」(從 subscribeOpenRooms 抽出的純函式)。
 * ⚠ 這一段**每個 tick 都要重跑**——即使伺服器回 204(內容沒變):
 *   isLobbyHostDead(心跳 3 分鐘過期)與 isLobbyTooOld(開房超過 10 分鐘)都是「拿當下
 *   時間跟房間欄位比」的判斷,資料不變、時間也會走,死房/殭屍房要靠重跑才會從列表消失。
 */
export function filterAndSortOpenRooms(all: OracleRoom[]): Room[] {
  const rooms = all
    .filter(r => {
      if ((r.schemaVersion ?? 1) < SEAT_LAYOUT_VERSION) return false;
      if (r.status === 'playing' && r.spectatorsAllowed === false) return false;
      // v5.004：私密房 (visible === false) 不出現在大廳列表，只能透過房號加入
      if (r.visible === false) return false;
      // v5.393：房主(座位0)心跳過期 > 3min 的 lobby 死房不列出（可逆）
      if (isLobbyHostDead(r as unknown as RoomData)) return false;
      // v5.463：開房超過 10 分鐘的 lobby 房不列出（房主長掛分頁的殭屍練習房；用 createdAt 因 updatedAt 被心跳 bump）
      if (isLobbyTooOld(r as unknown as RoomData)) return false;
      return true;
    })
    .map(r => ({ ...(r as unknown as RoomData), roomId: r._id }) as Room);
  rooms.sort((a, b) => {
    const ta = (a.createdAt as number) ?? 0;
    const tb = (b.createdAt as number) ?? 0;
    return tb - ta;
  });
  return rooms;
}

export function subscribeOpenRooms(callback: (rooms: Room[]) => void, onError?: (err: Error) => void): () => void {
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // ⭐⭐⭐v6.177 同一條「載入時不要清空已顯示資料」的紀律（與錦標賽賽程同型）：
  //   舊寫法 `.catch(() => [])` 把「請求失敗」偽裝成「伺服器說沒有房間」——
  //   callback([]) 之後大廳的房間列表整個消失，還顯示成「目前沒有公開房間」
  //   （openRoomsErr 同時被清成 ''），玩家完全看不出是連線問題；而且每 2 秒重跑一次。
  //   ⚠ 一定要用 null 而不是 [] 來表達失敗，否則「伺服器權威地說沒有房間」與「抓不到」
  //     就分不出來（v6.138 的同型教訓）。
  //   ⚠⚠ 逐 kind 保留、**不是**整發放棄：若 'playing' 這一支長期壞掉而 'lobby' 正常，
  //     整發放棄會讓休閒大廳完全凍結（新開的房永遠看不到）——Fable 5 審查點名。
  let _lastLobby: OracleRoom[] | null = null;
  let _lastPlaying: OracleRoom[] | null = null;
  // ⭐v6.217①② 合併+增量輪詢狀態機:
  //   _combinedMode: null=還沒探測 / true=伺服器支援(一發拿兩組+204 增量) / false=退回兩支舊輪詢。
  //   ⚠ 判定「不支援」只認 ROOMS_COMBINED_UNSUPPORTED 哨兵(=200 但沒有 combined:true 旗標);
  //     網路錯誤**不算**不支援——尖峰時最容易網路錯誤,若因此永久退回兩支舊輪詢,
  //     減量效果會在最需要它的時候消失。
  let _combinedMode: boolean | null = null;
  let _lastH: string | null = null;
  let _lastAll: OracleRoom[] | null = null;
  const legacyTick = async () => {
    if (!alive) return;
    try {
      const [lobbyRes, playingRes] = await Promise.all([
        oracleListRooms('lobby').catch(() => null),
        oracleListRooms('playing').catch(() => null),
      ]);
      const lobby = adoptOrKeep<OracleRoom[] | null>(_lastLobby, lobbyRes as OracleRoom[] | null).data;
      const playing = adoptOrKeep<OracleRoom[] | null>(_lastPlaying, playingRes as OracleRoom[] | null).data;
      if (lobbyRes !== null) _lastLobby = lobbyRes as OracleRoom[];
      if (playingRes !== null) _lastPlaying = playingRes as OracleRoom[];
      // 從來沒有成功過（兩邊都還是 null）⇒ 這一發沒有任何可顯示的資料，不 callback，
      //   讓畫面維持既有的「載入中／空狀態」，而不是被填成假的「目前沒有公開房間」。
      if (lobby === null && playing === null) {
        if (alive) timer = setTimeout(legacyTick, 2000);
        return;
      }
      callback(filterAndSortOpenRooms([...(lobby ?? []), ...(playing ?? [])] as OracleRoom[]));
    } catch (err) {
      console.warn('[subscribeOpenRooms]', err);
      onError?.(err as Error);
    }
    if (alive) timer = setTimeout(legacyTick, 2000);
  };
  const tick = async () => {
    if (!alive) return;
    if (_combinedMode === false) { void legacyTick(); return; }  // 防禦:切換後 tick 不該再被排到
    try {
      const r = await oracleListRoomsCombined(_lastH);
      if (r === ROOMS_COMBINED_UNSUPPORTED) {
        // 舊伺服器(或 middleware 沒 hoist 成功):**這一發就**改跑舊的兩支輪詢,不空等一輪;
        // legacyTick 自己排程,本 tick 從此不再進場。
        _combinedMode = false;
        void legacyTick();
        return;
      }
      _combinedMode = true;
      if (r === ROOMS_UNCHANGED) {
        // 204:內容沒變 ⇒ 沿用上一包原始資料**重跑過濾**(死房/殭屍房判定是時間函數,見
        // filterAndSortOpenRooms 的說明)。理論上第一發不帶 h 不可能拿到 204;防禦性起見
        // 沒有上一包就當作「這一發沒資料」,維持畫面既有狀態。
        if (_lastAll !== null) callback(filterAndSortOpenRooms(_lastAll));
      } else {
        _lastAll = r.rooms;
        _lastH = r.h;
        callback(filterAndSortOpenRooms(r.rooms));
      }
    } catch (err) {
      // 網路失敗:不清空、不退回舊協定(v6.177 紀律+上方 _combinedMode 說明);
      // 有上一包就重跑過濾讓列表維持可見。
      console.warn('[subscribeOpenRooms]', err);
      onError?.(err as Error);
      if (_lastAll !== null) callback(filterAndSortOpenRooms(_lastAll));
    }
    if (alive) timer = setTimeout(tick, 2000);
  };
  tick();
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
  };
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

export async function heartbeat(roomCode: string, seatIdx: number): Promise<void> {
  try {
    await oracleTx(roomCode.toUpperCase(), (data) => {
      const hbs: Record<number, number> = { ...(data.heartbeats as Record<number, number> ?? {}) };
      hbs[seatIdx] = Date.now();
      return { ...data, heartbeats: hbs as unknown as RoomData['heartbeats'] };
    });
  } catch (err) {
    console.warn('[oracle heartbeat]', err);
  }
}

export async function deleteRoom(roomCode: string): Promise<void> {
  await oracleDeleteRoom(roomCode.toUpperCase());
}

// ── v4.75 練習模式悔棋 API（連線對戰）─────────────────────────────────
export async function requestUndo(
  roomCode: string,
  fromSeatIdx: number,
  actionDesc: string,
): Promise<void> {
  await oracleTx(roomCode.toUpperCase(), (data) => ({
    ...data,
    undoRequest: { fromSeatIdx, actionDesc, status: 'pending' } as unknown as RoomData['undoRequest'],
  }));
}

export async function agreeUndo(roomCode: string): Promise<void> {
  await oracleTx(roomCode.toUpperCase(), (data) => {
    if (!data.undoRequest || data.undoRequest.status !== 'pending') return data;
    return {
      ...data,
      undoRequest: { ...data.undoRequest, status: 'agreed' } as RoomData['undoRequest'],
    };
  });
}

export async function rejectUndo(roomCode: string): Promise<void> {
  await oracleTx(roomCode.toUpperCase(), (data) => {
    if (!data.undoRequest || data.undoRequest.status !== 'pending') return data;
    return {
      ...data,
      undoRequest: { ...data.undoRequest, status: 'rejected' } as RoomData['undoRequest'],
    };
  });
}

export async function clearUndoRequest(roomCode: string): Promise<void> {
  await oracleTx(roomCode.toUpperCase(), (data) => ({
    ...data,
    undoRequest: undefined,
  }));
}

// ── Messages ────────────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 200;
const MESSAGES_LIMIT = 100;

export async function sendMessage(roomCode: string, senderName: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error('訊息超過 ' + MAX_MESSAGE_LENGTH + ' 字');
  }
  // server.js 目前不收 name 欄位，先把 senderName 塞進 kind 欄位（簡化做法）
  // Phase 3c polish 時擴 server API 增加 name field
  await oracleApi('/api/rooms/' + roomCode.toUpperCase() + '/messages', {
    method: 'POST',
    body: { text: trimmed, kind: 'chat:' + senderName },
  });
}

export function subscribeMessages(roomCode: string, callback: (msgs: ChatMessage[]) => void): () => void {
  const code = roomCode.toUpperCase();
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // v6.216②:增量輪詢——記住最後一則訊息的 createdAt,下一發帶 ?since=;伺服器沒有比 since
  //   新的訊息時回 204(oracleListMessages 回 null)→ 這一發不 callback、畫面維持原樣。
  //   有新訊息時伺服器仍回「全量最新 100 則」(格式與舊版逐字一致)⇒ 合併/顯示邏輯零改動。
  //   ⚠ 輪詢節奏維持 1.5s 不變——這一版砍的是回應體積,不是即時性。
  //   ⚠ 第一發不帶 since(lastTs=0)⇒ 進房仍載入完整聊天記錄;舊 client 不帶 since 時
  //     伺服器 fail-open 回全量(向後相容)。
  //   ⚠ 同一毫秒兩則訊息時 $gt 可能暫時漏掉後寫入的那則——下一則新訊息出現時的全量回應
  //     會自動補回,且既有 oraclePollMessages 本就同樣以 > 判新,非本版新增的邊界。
  let lastTs = 0;
  const tick = async () => {
    if (!alive) return;
    try {
      const messages = lastTs > 0
        ? await oracleListMessages(code, MESSAGES_LIMIT, lastTs)
        : await oracleListMessages(code, MESSAGES_LIMIT);
      if (messages !== null) {
        for (const m of messages) { if (m.createdAt > lastTs) lastTs = m.createdAt; }
        const msgs: ChatMessage[] = messages.map((m) => ({
          id: m._id ?? (m.createdAt + '-' + m.uid),
          uid: m.uid,
          name: (m.kind?.startsWith('chat:') ? m.kind.slice(5) : null) ?? m.uid.slice(0, 8),
          text: m.text,
          createdAt: { seconds: Math.floor(m.createdAt / 1000) },
        }));
        callback(msgs);
      }
    } catch (err) {
      console.warn('[subscribeMessages]', err);
    }
    if (alive) timer = setTimeout(tick, 1500);
  };
  tick();
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
  };
}
