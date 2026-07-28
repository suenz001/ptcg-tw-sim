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
import { tryAdvanceToPlaying, effectiveOpeningDone, ensureOpeningFinalized } from './engine';

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
  // v5.504 不復活守衛（Oracle 開局回復重抽 / 重複開局同手牌沒重洗 的客戶端根治）。
  //   v5.492 後贏方的 game 只在 startGame transaction commit 後才設定，故任何「合法」推送發生時
  //   房間必已有 gameState（current 非 null）。因此 current===null 只會發生在「房間已被重置成空」
  //   （rematch/離開 → gameState=null）的時刻——此時殘留舊局想被 push 回去就是「復活」，一律 skip。
  //   若不擋：舊局被推回 → 後續 startGame 讀到房間已有 gameState → no-op → 雙方又 adopt 同一舊局
  //   （手牌一樣、牌庫沒重洗）；或新舊局 id 分歧 → 一端被拉回 setup（開局回復重抽）。
  if (!current) return true;
  // v5.457 跨局防舊：incoming 是「較早建立的局」(createdAt 較小) → 別用殘留舊局蓋現有(較新)局。
  //   （再來一局後，舊局殘留 push 因 log 較長騙過長度比較 → 蓋新局；改用 createdAt 跨局判斷。）
  if (incoming.id !== current.id) {
    // v5.716 phantom 防護：current 已開打(playing)卻要推一個「不同 id 的 setup 局」
    //   = 開局 createGame race 殘留的 phantom 局，絕不可覆蓋進行中的對局(不論 createdAt 新舊)。
    //   合法「重新開局」走 checkAndAcceptRestart 的 oracleTx 直寫房間，不經 pushGameState，故不受影響。
    if (current.phase === 'playing' && incoming.phase === 'setup') {
      return true;
    }
    return (incoming.createdAt ?? 0) < (current.createdAt ?? 0);
  }
  // v5.465：終態保護（推端）— 房間已 game-over（同局）時，不讓非 game-over 的 push 蓋掉。
  //   根因：一方取最後獎賞→game-over 的瞬間，輸方剛好補位(SEND_NEW_ACTIVE)的 'playing' push
  //   會把房間 storage 從 game-over 洗回 playing → 輸方輪詢拿回 playing、永遠收不到勝利畫面而卡死。
  //   game-over 是終態，輸方任何後續操作都不該覆蓋（再來一局＝不同 id，已於上方放行）。
  if (current.phase === 'game-over' && incoming.phase !== 'game-over') return true;
  // 同局：playing×playing 且 log 嚴格較短 → skip
  return incoming.phase === 'playing' && current.phase === 'playing'
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
  // v5.716 phantom 防護：用 restartProposalCount 區分「合法重新開局」vs「開局 phantom race 局」。
  //   合法 restart 會在 proposeRestart 時遞增 restartProposalCount；phantom（開局 createGame race
  //   殘留局）不會。adopt 端只在 roomRestartCount > lastAdoptedRestartCount 時放行 setup 覆蓋 playing。
  roomRestartCount?: number;         // room.restartProposalCount ?? 0
  lastAdoptedRestartCount?: number;  // 元件持有：上次 adopt restart 重建局時的 restartProposalCount
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

  // 2. 不同局：createGame race 採較新/同齡局；但「較早建立的殘留舊局」(createdAt 較小) 拒收
  //    v5.457：避免再來一局後舊局殘留 snapshot 蓋掉新局（回到上一盤最後一手）。舊版無 createdAt 視為 0。
  if (local && local.id !== incoming.id) {
    if ((incoming.createdAt ?? 0) < (local.createdAt ?? 0)) {
      return { kind: 'reject', reason: 'stale-old-game' };
    }
    // v5.716 phantom 防護：local 進行中(playing)，incoming 是「不同 id 的 setup 局」
    //   → 只有雙方同意的「重新開局」(restartProposalCount 遞增)才放行；否則為開局 createGame race
    //   殘留的 phantom setup 局，拒收（否則 adopt 它會把進行中的對局拉回 setup、重新洗牌）。
    //   （再來一局/返回房間走 gameState=null 回 lobby，不是 setup 局覆蓋，不在此路徑。）
    if (local.phase === 'playing'
        && incoming.phase === 'setup'
        && (ctx.roomRestartCount ?? 0) <= (ctx.lastAdoptedRestartCount ?? 0)) {
      return { kind: 'reject', reason: 'phantom-setup' };
    }
    return { kind: 'adopt', game: incoming };
  }

  // 3. 悔棋 rollback 繞過：marker 遞增即無條件套用（log 較短也接受）
  if (local && incoming.phase === 'playing'
      && (ctx.roomLastUndoApplyAt ?? 0) > ctx.lastSeenUndoApplyAt) {
    return { kind: 'apply-undo', game: incoming };
  }

  // 3.5 取獎賞窗口 per-player 單調合併（v5.459，須在下方 stale-reject 之前）。
  //   咒詛炸彈雙KO 等「雙方各取獎賞 + 我方補位」：對手只取獎賞(log 較短)的 push 會被
  //   Rule 4 stale-reject 擋掉 → 我方永遠看不到對手取了獎賞 → pendingPrizes 卡住、跳過鈕消失、卡死。
  //   修法：只要任一方在取獎賞窗口(pendingPrizes 非 0)，改 per-player 單調合併（我方側保留 local，
  //   對手側若有「取獎賞前進」(待取減少 / 獎賞卡減少)則併入），不受 log 長度影響。
  if (local && local.id === incoming.id && ctx.myPlayerIndex !== null
      && (hasPendingPrize(local) || hasPendingPrize(incoming))) {
    const merged = mergePrizeWindowMonotonic(local, incoming, ctx.myPlayerIndex);
    if (merged) return { kind: 'merge-prize', game: merged };
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
    // v6.053 批3：互動式開局的結算必須在**合併之後**再跑一次。
    //   雙方同時各做一次選擇時，兩端本地都只看到單邊 done → 誰都不會在 applyAction 裡結算；
    //   要等合併把雙方的 openingDone 湊齊，這裡才算得出來。冪等（靠 openingFinalized 旗標）。
    merged = ensureOpeningFinalized(merged);
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
  const base: GameState = {
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
  // v6.053 批3：非互動式開局（全站絕大多數對局）到此為止 —— 逐欄位與 v6.052 以前完全相同。
  if (local.openingFlow !== 'interactive' && incoming.openingFlow !== 'interactive') return base;
  return mergeInteractiveOpening(local, incoming, base);
}

/**
 * v6.053 批3：互動式開局（閃焰王牌｜瞬間爆發力）在 setup 合併時的額外規則。
 *
 * ⭐核心不變式：**一個座位的開局進度只有該座位的玩家能推進**，而且是單調的
 *   （`mulliganCounts` 只增、`openingDone` 只 false→true）。因此每個座位都可以獨立地
 *   「取較前進的那一份」，兩端最終必然收斂到同一結果，不需要誰等誰。
 *
 * ⚠**同源原則（避免縫合怪）**：`players[i]` / `mulliganCounts[i]` / `mulliganRevealedHands`
 *   的第 i 半必須來自**同一份 snapshot**。若各欄位各自取極值，會做出「重抽次數是新的、
 *   手牌卻是舊的」這種現實中不存在的盤面 —— 對手能多抽幾張就會算錯。
 *   本函式用單一述詞 `oppLocalAhead` 同時決定這三個欄位。
 *
 * ⚠`setupDone` / `mulliganPostBenchOpen` / `players` 的己側規則**沿用** base（legacy），
 *   因為開局定案之後玩家還會繼續擺場，那段的權威規則不變。
 */
function mergeInteractiveOpening(
  local: GameState,
  incoming: GameState,
  base: GameState,
): GameState {
  const lDone = effectiveOpeningDone(local);
  const iDone = effectiveOpeningDone(incoming);
  const lCnt = local.mulliganCounts ?? [0, 0];
  const iCnt = incoming.mulliganCounts ?? [0, 0];
  const lRev = local.mulliganRevealedHands ?? { p1: [], p2: [] };
  const iRev = incoming.mulliganRevealedHands ?? { p1: [], p2: [] };

  /**
   * 座位 i：本地是否比 incoming 更前進（→ 保留本地那一半，防 stale 回退）。
   * 判準依序：已定案 > 重抽次數 > 已按準備。
   * （三者都是單調量；同一座位的兩份 snapshot 必有偏序，不會互相矛盾 ——
   *   定案之後不可能再重抽，所以不存在「done 較舊但 counts 較新」的組合。）
   */
  const localAhead = (i: 0 | 1): boolean =>
    (lDone[i] && !iDone[i])
    || (lCnt[i] > iCnt[i])
    || (!!local.setupDone?.[i] && !incoming.setupDone?.[i]);

  const ahead: [boolean, boolean] = [localAhead(0), localAhead(1)];
  const pick = <T,>(i: 0 | 1, l: T, inc: T): T => (ahead[i] ? l : inc);

  const players = [
    pick(0, local.players[0], incoming.players[0]),
    pick(1, local.players[1], incoming.players[1]),
  ] as GameState['players'];
  const mulliganCounts = [
    pick(0, lCnt[0], iCnt[0]),
    pick(1, lCnt[1], iCnt[1]),
  ] as [number, number];
  const mulliganRevealedHands = {
    p1: pick(0, lRev.p1 ?? [], iRev.p1 ?? []),
    p2: pick(1, lRev.p2 ?? [], iRev.p2 ?? []),
  };
  const openingDone: [boolean, boolean] = [
    !!((local.openingDone?.[0] ?? false) || (incoming.openingDone?.[0] ?? false)),
    !!((local.openingDone?.[1] ?? false) || (incoming.openingDone?.[1] ?? false)),
  ];
  // `pending` 與 `done` 在引擎裡恆為互補（createGame 與兩個 handler 三處都這樣寫），
  // 直接導出即可，少一條合併規則就少一個洞。用 effective done（含 skew 逃生）。
  const effDone: [boolean, boolean] = [
    openingDone[0] || !!base.setupDone?.[0],
    openingDone[1] || !!base.setupDone?.[1],
  ];

  // ⭐結算後才寫入的兩個欄位（pendingMulliganDraw / mulliganRevealConfirmed）不能用
  //   legacy 的 MIN / OR：
  //   ・MIN：一端結算出 [2,0]、另一端還是 [0,0] → MIN 把補抽整個吃掉（靜默少抽，公平性）
  //   ・OR ：`mulliganRevealConfirmed` 在互動式下**不是單調的** —— createGame 先用「當下
  //         次數」算過一次（雙方 0 次時是 [true,true]），finalizeOpening 再用「最終次數」
  //         重算，可能 true→false。OR 會把 stale 的 true 復活 → 跳過對手的揭示確認。
  //   修法：只有「兩端結算狀態相同」時才用 legacy 規則；恰一端結算過就整組採該端。
  const lFin = !!local.openingFinalized;
  const iFin = !!incoming.openingFinalized;
  const finSrc = lFin === iFin ? null : (lFin ? local : incoming);

  return {
    ...base,
    players,
    mulliganCounts,
    mulliganRevealedHands,
    openingDone,
    openingChoicePending: [!effDone[0], !effDone[1]] as [boolean, boolean],
    openingFinalized: lFin || iFin,
    openingFlow: 'interactive',
    ...(finSrc ? {
      pendingMulliganDraw: [...(finSrc.pendingMulliganDraw ?? [0, 0])] as [number, number],
      mulliganRevealConfirmed: [...(finSrc.mulliganRevealConfirmed ?? [true, true])] as [boolean, boolean],
    } : {}),
  };
}

/**
 * 我方獎賞單調保護（v5.364/v5.366）。
 *   我方獎賞卡數遊戲中只會「減少」。若 incoming 讓我方獎賞「變多」＝我的取獎賞被回朔
 *   （取獎賞與對手派新寶可夢等長分歧、整份覆蓋洗掉我的取獎賞）→ per-player 保護：
 *   我這半保留本地（players[me] + pendingPrizes[me]），對手那半採 incoming。
 *   回傳 null = 不需保護（incoming 我方獎賞沒變多）。
 */
/** 任一方是否在「待取獎賞」窗口（pendingPrizes 有非 0）。 */
export function hasPendingPrize(s: GameState): boolean {
  return (s.pendingPrizes?.[0] ?? 0) > 0 || (s.pendingPrizes?.[1] ?? 0) > 0;
}

/**
 * 取獎賞窗口 per-player 單調合併（v5.459）。
 *   以 local 為基底（保留我方側全部進度：已取獎賞 / 已補位 active / 較長 log），
 *   只在「對手側有更前進的取獎賞進度」(對手待取減少 或 對手獎賞卡減少=取了) 時，
 *   併入對手側 players[opp] + 對手 pendingPrizes 取 MIN（單調遞減防回退）。
 *   無對手前進 → 回 null（交回上層 stale-reject/adopt 既有邏輯）。
 *   雙向對稱：兩端各自保留己側、併入對方取獎賞 → 收斂到 pendingPrizes=[0,0]。
 */
export function mergePrizeWindowMonotonic(
  local: GameState,
  incoming: GameState,
  me: 0 | 1,
): GameState | null {
  const opp = (1 - me) as 0 | 1;
  const oppPendLocal = local.pendingPrizes?.[opp] ?? 0;
  const oppPendInc = incoming.pendingPrizes?.[opp] ?? 0;
  const oppPrizesLocal = local.players[opp].prizes?.length ?? 0;
  const oppPrizesInc = incoming.players[opp].prizes?.length ?? 0;
  // 對手側有更前進的取獎賞進度才併入
  const oppAdvanced = oppPendInc < oppPendLocal || oppPrizesInc < oppPrizesLocal;
  if (!oppAdvanced) return null;
  const myPend = local.pendingPrizes?.[me] ?? 0;
  const newOppPend = Math.min(oppPendLocal, oppPendInc);
  return {
    ...local,
    players: (me === 0
      ? [local.players[0], incoming.players[1]]
      : [incoming.players[0], local.players[1]]) as GameState['players'],
    pendingPrizes: (me === 0 ? [myPend, newOppPend] : [newOppPend, myPend]) as [number, number],
  };
}

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

/**
 * v5.749：決定性建局者 — 根治「開局重新洗牌」。
 *   根因：開局時雙端各自 createGame(不同 id/牌序),透過 startGame race 擇一為 canonical,
 *   另一端的 phantom 局或被 adopt(自己盤面被對方牌序蓋掉=重洗)或互相覆蓋。v5.716 的雙端
 *   phantom 防護只在「現有局 playing」才擋,setup×setup 不同 id 仍 adopt 較新 → 開局重洗未解。
 *   收斂法:指定 seat 0(P1)為唯一建局者立即建;seat 1(P2)只在 grace 期過後(P1 斷線/未建)
 *   才 fallback 建。雙端 seat 正確時只有 P1 建 → 房間 canonical 唯一 → P2 純 adopt,phantom race
 *   整類消失。已有本地局(haveLocalGame)一律不再建(防自身重複建局重洗)。
 */
export function shouldAttemptStartGame(opts: {
  mySeat: number;            // 自己在 roomData.seats 的 index(0/1;-1=未入座)
  bothReady: boolean;
  roomStatus: string;
  hasGameState: boolean;
  haveLocalGame: boolean;    // 本端已有 local game(setup/playing)→ 不再建
  readyElapsedMs: number;    // 雙方就緒+lobby+無 gameState 已持續多久
  fallbackGraceMs?: number;  // P2 fallback 等待(預設 3000ms)
}): boolean {
  if (opts.haveLocalGame) return false;
  if (opts.roomStatus !== 'lobby' || opts.hasGameState) return false;
  if (!opts.bothReady) return false;
  if (opts.mySeat === 0) return true;                                  // 指定建局者:立即
  if (opts.mySeat === 1) return opts.readyElapsedMs >= (opts.fallbackGraceMs ?? 6000); // fallback（v5.893：3000→6000ms 加大 grace，降低「P1 建局 push 未在時限內傳到 P2 → P2 也建局 → 開局後不久整局重洗」的競態；正常 P1 <1s 建局，P2 不會觸發；僅 P1 開局即斷線才 6s 後接手）
  return false;
}
