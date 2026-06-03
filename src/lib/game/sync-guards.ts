// ─────────────────────────────────────────────────────────────────────────────
// 線上同步守衛（純函式版本）— single source of truth for 推/收兩端的防舊/合併決策。
//
// 背景：線上對戰雙後端（Oracle 正式 room-oracle.ts / Firebase beta room.ts），收端
//   merge/guard 邏輯原本散落 inline 在 src/routes/game/+page.svelte handleRoomUpdate
//   裡，靠多版本手修堆疊（v3.34/v3.39/v3.42/v4.494/v4.499/v5.339/v5.346/v5.364/
//   v5.366/v5.390/v5.400…）。每次改一條就有「補一個破一個」風險，且無自動化測試。
//   本檔把每條規則抽成可單元測試的純函式（scripts/test-online-sync-guards.mjs 覆蓋）。
//
// ⚠️ 行為等價要求：本檔每個函式都「忠實鏡射」原 inline 邏輯（含 `?? 0` / `?? false`
//   預設值與「只擋嚴格較舊、不擋等長」的設計）。修改務必同步更新測試網。
// ─────────────────────────────────────────────────────────────────────────────

import type { GameState } from './types';
import { tryAdvanceToPlaying } from './engine';

/**
 * 推送端防舊（room-oracle.ts pushGameState，v5.346）。
 *   playing 期間，若我方要推的 gameState 比房間現有『嚴格較舊』（log 長度單調序）→ 跳過寫入，
 *   不 regress 房間。不擋等長（避免 v2.82 _syncSeq deadlock）。
 *   ⚠️ 悔棋 rollback 走 pushUndoRollback（故意繞過此 guard），不經這裡。
 */
export function shouldSkipStalePush(
  incoming: GameState,
  current: GameState | null | undefined,
): boolean {
  return !!current
    && incoming.phase === 'playing' && current.phase === 'playing'
    && (incoming.log?.length ?? 0) < (current.log?.length ?? 0);
}

// ── 收端決策（handleRoomUpdate cascade）─────────────────────────────────────

export type RoomUpdateDecision =
  | { kind: 'ignore' }                                       // 無 incoming gameState
  | { kind: 'adopt'; game: GameState }                       // 採用 incoming（createGame race / 一般較新）
  | { kind: 'apply-undo'; game: GameState }                  // 悔棋 rollback 繞過 stale guard
  | { kind: 'reject'; reason: string }                       // 防舊 / 終態 / phase 倒退
  | { kind: 'merge-setup'; game: GameState; advanced: boolean }  // 開局 per-player 單調 merge
  | { kind: 'merge-prize'; game: GameState };                // 我方獎賞單調保護

export interface RoomUpdateCtx {
  myPlayerIndex: 0 | 1 | null;
  roomLastUndoApplyAt: number;   // room.lastUndoApplyAt ?? 0
  lastSeenUndoApplyAt: number;   // 元件持有的上次套用 marker
}

/**
 * 收端：給定本地 game 與 incoming snapshot，回傳該如何處置（純函式，無副作用）。
 *   忠實鏡射 +page.svelte handleRoomUpdate 的決策順序（v5.400 當時）：
 *   1. 無 incoming → ignore
 *   2. game.id !== incoming.id → adopt（createGame race，採 server-authoritative）
 *   3. 悔棋 marker 遞增（incoming playing）→ apply-undo（繞過下方 stale guard）
 *   4. playing×playing 且 incoming.log 嚴格較短 → reject stale
 *   5. 本地 game-over（終態）且 incoming 非 game-over → reject（v5.400）
 *   6. 本地 playing/game-over 且 incoming setup → reject phase 倒退（v4.499）
 *   7. setup×setup → merge-setup（單調合併 + tryAdvanceToPlaying）
 *   8. playing×playing 且我方獎賞被回朔（incoming 我方獎賞變多）→ merge-prize（v5.364/366）
 *   9. 其餘 → adopt
 *
 * 注意：undo 的 marker 推進（lastSeenUndoApplyAt = roomLastUndoApplyAt）與 merge-setup
 *   advanced 後的 pushGameState 同步，屬副作用，由呼叫端依 decision.kind 處理。
 */
export function resolveRoomUpdate(
  local: GameState | null,
  incoming: GameState | null | undefined,
  ctx: RoomUpdateCtx,
): RoomUpdateDecision {
  if (!incoming) return { kind: 'ignore' };

  // 2. createGame race：本地與 incoming 不同局 → 全採 incoming
  if (local && local.id !== incoming.id) {
    return { kind: 'adopt', game: incoming };
  }

  // 3. 悔棋 rollback 繞過：marker 遞增即無條件套用（log 較短也接受）
  if (local && incoming.phase === 'playing'
      && (ctx.roomLastUndoApplyAt ?? 0) > ctx.lastSeenUndoApplyAt) {
    return { kind: 'apply-undo', game: incoming };
  }

  // 4. 防舊 snapshot：只擋嚴格較短 log
  if (local && local.phase === 'playing' && incoming.phase === 'playing'
      && (incoming.log?.length ?? 0) < (local.log?.length ?? 0)) {
    return { kind: 'reject', reason: 'stale-snapshot' };
  }

  // 5. game-over 終態保護
  if (local && local.phase === 'game-over' && incoming.phase !== 'game-over') {
    return { kind: 'reject', reason: 'game-over-terminal' };
  }

  // 6. phase 倒退保護（playing/game-over → setup）
  if (local && (local.phase === 'playing' || local.phase === 'game-over')
      && incoming.phase === 'setup') {
    return { kind: 'reject', reason: 'phase-rollback' };
  }

  // 7. 開局 setup per-player 單調 merge
  if (local && local.phase === 'setup' && incoming.phase === 'setup'
      && ctx.myPlayerIndex !== null) {
    let merged = mergeSetupMonotonic(local, incoming, ctx.myPlayerIndex);
    const advanced = tryAdvanceToPlaying(merged);
    if (advanced.phase === 'playing') {
      return { kind: 'merge-setup', game: advanced, advanced: true };
    }
    return { kind: 'merge-setup', game: merged, advanced: false };
  }

  // 8. 我方獎賞單調保護
  if (local && local.phase === 'playing' && incoming.phase === 'playing'
      && ctx.myPlayerIndex !== null) {
    const protectedGame = mergePrizeMonotonic(local, incoming, ctx.myPlayerIndex);
    if (protectedGame) return { kind: 'merge-prize', game: protectedGame };
  }

  // 9. 其餘：採用 incoming
  return { kind: 'adopt', game: incoming };
}

/**
 * 開局 setup per-player 單調合併（v3.39/v4.494/v5.159/v5.339/v5.346）。
 *   - players：自己側永遠保留本地最新；對手側採 incoming，但若本地已收到對手 setupDone=true
 *     卻來了 setupDone=false 的 stale incoming → 保留本地對手 players（防回退）。
 *   - setupDone / mulliganRevealConfirmed：OR（false→true 單調）。
 *   - pendingMulliganDraw：MIN（N→0 單調）。
 *   - mulliganPostBenchOpen：per-player（自己端用本地、對手端用 incoming）。
 */
export function mergeSetupMonotonic(
  local: GameState,
  incoming: GameState,
  me: 0 | 1,
): GameState {
  return {
    ...incoming,
    players: (me === 0
      ? [local.players[0], (local.setupDone[1] && !incoming.setupDone[1]) ? local.players[1] : incoming.players[1]]
      : [(local.setupDone[0] && !incoming.setupDone[0]) ? local.players[0] : incoming.players[0], local.players[1]]) as GameState['players'],
    setupDone: [
      local.setupDone[0] || incoming.setupDone[0],
      local.setupDone[1] || incoming.setupDone[1],
    ] as [boolean, boolean],
    mulliganRevealConfirmed: [
      local.mulliganRevealConfirmed[0] || incoming.mulliganRevealConfirmed[0],
      local.mulliganRevealConfirmed[1] || incoming.mulliganRevealConfirmed[1],
    ] as [boolean, boolean],
    pendingMulliganDraw: [
      Math.min(local.pendingMulliganDraw?.[0] ?? 0, incoming.pendingMulliganDraw?.[0] ?? 0),
      Math.min(local.pendingMulliganDraw?.[1] ?? 0, incoming.pendingMulliganDraw?.[1] ?? 0),
    ] as [number, number],
    mulliganPostBenchOpen: (me === 0
      ? [local.mulliganPostBenchOpen?.[0] ?? false, incoming.mulliganPostBenchOpen?.[1] ?? false]
      : [incoming.mulliganPostBenchOpen?.[0] ?? false, local.mulliganPostBenchOpen?.[1] ?? false]) as [boolean, boolean],
  };
}

/**
 * 我方獎賞單調保護（v5.364/v5.366）。
 *   我方獎賞卡數遊戲中只會「減少」。若 incoming 讓我方獎賞「變多」＝我的取獎賞被回朔
 *   （取獎賞與對手派新寶可夢等長分歧、整份覆蓋洗掉我的取獎賞）→ per-player 保護：
 *   我這半保留本地（players[me] + pendingPrizes[me]），對手那半採 incoming。
 *   回傳 null = 不需保護（incoming 我方獎賞沒變多）。
 */
export function mergePrizeMonotonic(
  local: GameState,
  incoming: GameState,
  me: 0 | 1,
): GameState | null {
  const myPrizesLocal = local.players[me].prizes?.length ?? 0;
  const myPrizesInc = incoming.players[me].prizes?.length ?? 0;
  if (myPrizesInc <= myPrizesLocal) return null;

  const oppIdx = (1 - me) as 0 | 1;
  const myPend = local.pendingPrizes?.[me] ?? 0;
  const oppPend = incoming.pendingPrizes?.[oppIdx] ?? 0;
  return {
    ...incoming,
    players: (me === 0
      ? [local.players[0], incoming.players[1]]
      : [incoming.players[0], local.players[1]]) as GameState['players'],
    pendingPrizes: (me === 0 ? [myPend, oppPend] : [oppPend, myPend]) as [number, number],
  };
}
