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
 * ⭐⭐⭐v6.214【③】跨局「誰比較早建立」的**單一判準**（推端／收端共用）。
 *
 * ── 為什麼要有這支 ────────────────────────────────────────────────────────
 * 原本兩處各自寫 `(a.createdAt ?? 0) < (b.createdAt ?? 0)`，而 `createdAt` 是
 * **建局那一端瀏覽器**的 `Date.now()`。v6.198 實證線上玩家時鐘偏差有
 * -11 秒 / -77 秒 / -4.9 小時 ⇒ 兩局由不同玩家建立時，比較結果可能整個反向。
 *
 * ── 相容路徑（這一版最重要的一件事）────────────────────────────────────────
 * v6.214 起 `createGame` 會在**同步得到伺服器時鐘時**多寫一個 `createdAtSrv`。
 *   ・**兩局都有** `createdAtSrv` ⇒ 用它比（同一顆伺服器時鐘，不受任何玩家時鐘影響）。
 *   ・**任一邊缺席** ⇒ 逐字退回原本的 `createdAt` 比較。
 * 缺席會發生在：舊版 client 建的局、本機/AI 對局、從沒同步到伺服器時戳的 client、
 * 以及**所有 v6.214 之前就已經在進行中的對局**。
 * ⇒ 混版期間與既有對局走的是**與 v6.213 逐字相同**的那一條，不可能被打斷。
 *
 * ⚠ 刻意**不**做「一邊有一邊沒有就拿 createdAtSrv 跟 createdAt 混著比」——
 *   那等於拿伺服器時鐘去跟一顆偏差 4.9 小時的瀏覽器時鐘比，比原本更錯。
 */
export function isOlderGame(
  incoming: Pick<GameState, 'createdAt' | 'createdAtSrv'> | null | undefined,
  current: Pick<GameState, 'createdAt' | 'createdAtSrv'> | null | undefined,
): boolean {
  const a = incoming?.createdAtSrv;
  const b = current?.createdAtSrv;
  if (typeof a === 'number' && isFinite(a) && typeof b === 'number' && isFinite(b)) {
    return a < b;                                   // 伺服器單一時鐘
  }
  return (incoming?.createdAt ?? 0) < (current?.createdAt ?? 0);   // v6.213 原式，逐字不變
}

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
    return isOlderGame(incoming, current);   // v6.214③ 收斂到單一判準（伺服器時鐘優先，缺席退回原式）
  }
  // v5.465：終態保護（推端）— 房間已 game-over（同局）時，不讓非 game-over 的 push 蓋掉。
  //   根因：一方取最後獎賞→game-over 的瞬間，輸方剛好補位(SEND_NEW_ACTIVE)的 'playing' push
  //   會把房間 storage 從 game-over 洗回 playing → 輸方輪詢拿回 playing、永遠收不到勝利畫面而卡死。
  //   game-over 是終態，輸方任何後續操作都不該覆蓋（再來一局＝不同 id，已於上方放行）。
  if (current.phase === 'game-over' && incoming.phase !== 'game-over') return true;
  // ⭐v6.309 同局 phase 倒退（房間已 playing、我還要推 setup）→ skip，鏡射收端 rule 6 的 phase-rollback。
  //   場景：對手在收端合併後推進到 playing 並推送，我最後一筆 setup 動作的 push 晚一步落地
  //   → 房間被洗回 setup；對手端 rule 6 拒收、我端只會 poll 到自己的 echo ⇒ 沒有人再推得動（開局死角）。
  //   同一局的 setup→playing 是單向的（重新開局＝新 id、悔棋走 pushUndoRollback），所以這條沒有合法反例。
  if (current.phase === 'playing' && incoming.phase === 'setup') return true;
  // 同局：playing×playing 且 log 嚴格較短 → skip
  return incoming.phase === 'playing' && current.phase === 'playing'
    && (incoming.log?.length ?? 0) < (current.log?.length ?? 0);
}

/**
 * ⭐⭐⭐v6.212 卡住自癒的**方向**決策（純函式，行為守衛 scripts/test-v6212-selfheal-direction.mjs）。
 *
 * ── 這在修什麼 ──────────────────────────────────────────────────────────
 * v5.587 的自癒是「卡 >=25 秒 → 強制採用伺服器盤面（繞過全部 stale 守衛）」，
 * 它的註解假設是「我方沒有未推送的手」。**這個假設在 push 失敗／在途時不成立**：
 *   push 拋錯（只 console.error、不重試）⇒ 伺服器停在攻擊前 ⇒ 本地一直在等對手
 *   ⇒ 25 秒後強制採用伺服器那份 ⇒ **玩家看到回合被退回攻擊前**（回捲）。
 *
 * ⇒ 修法是把方向反過來：**本地領先時先重推**（pushGameState 對同一份盤面是冪等的，
 *   推端另有 shouldSkipStalePush 擋倒退），重推之後仍舊卡住才 force-adopt。
 *
 * ⚠ 一定要有**上限**：本地領先也可能是「伺服器合法地拒收」（例如對手已用不同路徑
 *   把盤面推進了），那時無限重推＝永遠不同步。達上限後照樣 force-adopt。
 */
export interface StuckSelfHealCtx {
  /** 本地有「推不上去、伺服器沒有」的盤面（＝本地領先伺服器）。 */
  hasUnpushedLocal: boolean;
  /** 這一次卡住期間已經連續重推幾次。 */
  repushAttempts: number;
  /** 上限（預設 2）。達上限就讓 force-adopt 接手，避免永遠不同步。 */
  maxRepushAttempts?: number;
}
export type StuckSelfHealAction = { kind: 'repush' } | { kind: 'force-adopt' };

export function decideStuckSelfHeal(ctx: StuckSelfHealCtx): StuckSelfHealAction {
  const max = ctx.maxRepushAttempts ?? 2;
  if (ctx.hasUnpushedLocal && ctx.repushAttempts < max) return { kind: 'repush' };
  return { kind: 'force-adopt' };
}

// ── ⭐⭐⭐v6.248 卡住期間「重建房間訂閱」的間隔（純函式，守衛直接實跑）────────────────
/**
 * v5.360 的自癒是「等對手 >=8 秒沒有任何新動作 → 重建房間訂閱」，固定每 8 秒一次。
 * 而 `oraclePollRoom` 每次重訂閱都把 `lastVersion` 歸 -1 ＝ 多發一次**全量**房間 GET。
 *
 * ⚠ v6.247 之後這件事變多了（實測，虛擬時鐘實跑真原始碼）：
 *   推送 87 秒才送達的情境，300 秒內重訂閱 v6.246 是 24 次、v6.247 是 30 次。
 *   原因不是新增了呼叫，而是 v6.247 讓玩家**不再被回捲** ——
 *   以前那次 force-adopt 會把盤面換掉、順手更新 `_lastSyncAt`，等於幫忙壓下了幾次重訂閱。
 *
 * ⚠⚠ 但重訂閱是卡住的玩家**唯一的脫困手段**，不可以為了數字好看關掉。
 * ⇒ 折衷：前 `RESYNC_FULL_RATE_ROUNDS` 次維持 8 秒（真正有救援效果的窗口逐字不變），
 *   之後才指數退避，夾在 `RESYNC_MAX_MS` 以內。呼叫端在「同步有進展」時把 streak 歸零。
 *
 * ── ⭐⭐⭐v6.249 獨立審查者複驗 v6.248 後的兩項更正（量測腳本：
 *    `scripts/perf-v6249-resync-backoff-forfeit.mjs`，虛擬時鐘、5 秒 interval、真原始碼）──
 *
 * 【A】`RESYNC_MAX_MS = 60000` **太猛**。實測重訂閱時刻（秒，t=0 是最後一次 log 變動）：
 *      v6.247 固定 8 秒 ⇒ 10,20,…,300（30 次）
 *      v6.248 上限 60 秒 ⇒ 10,20,30,50,85,145,205,265（8 次）
 *    ⇒ 脫困延遲最壞 **55 秒**（問題在 t=86 秒解除時：舊版 t=90 就救回，v6.248 要等到 t=145），
 *      180 秒棄權窗內的脫困機會 **18 → 6**，而且 **R∈(145,180] 這 35 秒寬的區間**
 *      舊版來得及在棄權門檻前脫困、v6.248 來不及 ⇒ 那一段從「被救回」變成「輸掉」。
 *    ⇒ 上限改 **20000**：最壞慢 10 秒、180 秒窗剩 10 次、300 秒仍從 30 降到 16（churn 省一半）。
 *
 * 【B】⚠⚠ v6.248 在 `+page.svelte` 寫的「streak 會歸零，所以下一次真的卡住時第一發仍是
 *    8 秒」——**是錯的**。streak 只在「`game.log` 有變動」時歸零，而**對手長考本身就沒有
 *    log 變動** ⇒ 對手想 30 秒 streak 就已經 ≥3；連線在長考尾聲斷掉時，第一發救援不是
 *    8 秒而是最多 `RESYNC_MAX_MS` 之後。（這正是【A】那 35 秒致命區間的成因。）
 *    ⚠ 這個語意**改不掉**，不是偷懶：對客戶端而言「對手在長考」與「我收不到了」是
 *      **同一個可觀測狀態**（房間版本一樣、重訂閱一樣抓不到新東西、對手心跳一樣新鮮），
 *      審查者建議的「只在『重訂閱卻沒換來進展』時才累加」在兩種情況下都成立
 *      ⇒ 換上去之後時間軸**逐格相同**（量測腳本的 `streak-semantics` 段落有實跑對照）。
 *    ⇒ 正確的處理是「**承認 streak 起跑點可能已經很高**」，把上限壓到最壞情況也能接受，
 *      再加一道【最後救援窗】（見 `casualResyncInLastChance`）保證不會比 v6.247 更糟。
 *
 * @param streak 這一次連續卡住期間已經重訂閱過幾次（0 = 還沒重訂閱過）。
 *   ⚠ 它同時被「對手長考」推高 —— 不要再寫「下次卡住一定從 8 秒起跑」這種註解。
 */
export const RESYNC_BASE_MS = 8000;
export const RESYNC_FULL_RATE_ROUNDS = 3;
export const RESYNC_MAX_MS = 20000;
export function casualResyncGapMs(streak: number): number {
  // ⚠ 非有限值一律當 0：這是安全網，絕不能自己算出 NaN 讓比較永遠為 false（＝再也不重訂閱）。
  const s = Number.isFinite(streak) ? Math.max(0, Math.floor(streak)) : 0;
  if (s < RESYNC_FULL_RATE_ROUNDS) return RESYNC_BASE_MS;
  return Math.min(RESYNC_MAX_MS, RESYNC_BASE_MS * Math.pow(2, s - RESYNC_FULL_RATE_ROUNDS + 1));
}

/**
 * ⭐⭐⭐v6.249【最後救援窗】距離棄權門檻只剩 `RESYNC_LAST_CHANCE_MS` 以內時，
 * 退避一律讓路、回到 `RESYNC_BASE_MS` 全速。
 *
 * 為什麼要有它（不是為了好看）：站長已裁定「卡住方判負」，所以**沒能在棄權門檻前脫困
 * ＝直接輸掉一局**。只調 `RESYNC_MAX_MS`（20 秒）之後仍留下一段 **10 秒寬**的區間
 * （R∈(170,180]）：v6.247 來得及救、v6.249 來不及 —— 那是對玩家的**淨退步**，
 * 違反「絕不可讓玩家端變慢」。加上這道窗之後，實測致命區間 **10 秒 → 0 秒**
 * （量測腳本掃 R=1..300 秒逐秒對照：v6.249 不存在「v6.247 救得到而它救不到」的 R）。
 *
 * 代價：每一次卡住最多多打 **2~4 次**全量房間 GET（只發生在「已經卡住、而且即將輸掉」
 * 的那條線上）；300 秒總量仍是 **30 → 18**（比 v6.247 少四成）。
 *
 * ⚠⚠ 它**只讀**棄權門檻與 `_lastActionAt`，一個字都沒有改棄權語意：
 *   不寫 `oppInactivityWarn`、不動門檻算式、不碰 `claimOpponentForfeit`。
 * ⚠ 上界用 `<=` 而不是無上界：過了門檻之後如果繼續全速，退避就等於沒做
 *   （300 秒會回到 24~30 次）。門檻之後回到退避，脫困仍由重訂閱負責。
 *
 * @param sinceLastActionMs   距離最後一個「log 增長」的毫秒數（＝棄權倒數用的同一個時鐘）。
 * @param forfeitThresholdMs  這個房間目前的棄權門檻（房主可調 60~300 秒）。
 */
export const RESYNC_LAST_CHANCE_MS = 30000;
export function casualResyncInLastChance(sinceLastActionMs: number, forfeitThresholdMs: number): boolean {
  // ⚠ 非有限值一律回 false：這是「加碼救援」的旁路，壞掉時必須退回原本的退避，不可以自己亂開。
  if (!Number.isFinite(sinceLastActionMs) || !Number.isFinite(forfeitThresholdMs)) return false;
  if (!(forfeitThresholdMs > 0)) return false;
  return sinceLastActionMs >= forfeitThresholdMs - RESYNC_LAST_CHANCE_MS
      && sinceLastActionMs <= forfeitThresholdMs;
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
  // ⭐⭐⭐v6.214【①】「本裝置目前正在看的那一局」的 id（＝重整前那一局）。
  //   由 +page.svelte 以 sessionStorage 持有：採用任何盤面時寫入、回大廳（game=null）時清除、
  //   逾 ACTIVE_GAME_TTL 視為沒有。**只用來分辨「重整想看終局盤」與「跳回舊局」**，
  //   不參與任何其他決策；缺席（undefined/null）一律 fail-closed ＝ 不採納已結束的局。
  activeGameId?: string | null;
}

/**
 * ⭐⭐⭐v6.214【①】「已結束的舊局不要自動採納」（純函式；收端 + force-adopt 兩條路共用同一份判準）。
 *
 * ── 這在修什麼 ────────────────────────────────────────────────────────────
 * `resolveRoomUpdate` 第 9 步是無條件 `adopt`，而它上面**每一條**守衛都寫著 `if (local && …)`
 * ⇒ 本地 `game === null`（玩家正在大廳畫面／剛重整）時，那些守衛一條都不會執行，
 *   房間裡殘留的、早就結束的舊局 snapshot 會被直接採納 ⇒ 玩家「突然跳回一局早就打完的對局」。
 *
 * ── 分界（站長要的判準）──────────────────────────────────────────────────
 * 只看兩件事，兩件都很窄：
 *   (a) **只在本地沒有局時才管**。本地已經有局 ⇒ 原本的第 4/5/6/9 條照舊，一個字都沒改
 *       ⇒ 「剛結束、玩家還在該局頁面」的終局畫面**不可能**因為這條而消失（local 非 null）。
 *   (b) **只擋 `phase === 'game-over'`**。`setup` / `playing` 的局一律照舊 adopt
 *       ⇒ 「重新加入進行中的對局」（重整、換裝置、斷線回來）**完全不受影響**。
 * 剩下唯一會被擋的，就是「本地沒有局 × incoming 是已結束的局」。而這一格裡還有一個合法情形：
 * **玩家剛在那一局按下 F5**（他想看終局盤）。用 `ctx.activeGameId` 分辨 ——
 * 那是本裝置寫在 sessionStorage 的「我剛剛在看的那一局」，重整會留著、回大廳會清掉、
 * 逾時會過期。id 對得上就放行，對不上（或根本沒有）就拒收並留在大廳。
 *
 * ⚠ fail-closed：`activeGameId` 缺席一律拒收。這是刻意的 ——
 *   拒收的代價是「玩家要自己點一次才看得到終局盤」，採納的代價是「被丟進一局陌生的舊對局」。
 */
export function isStaleFinishedGame(
  local: GameState | null | undefined,
  incoming: GameState | null | undefined,
  activeGameId?: string | null,
): boolean {
  if (!incoming) return false;
  if (local) return false;                      // (a) 本地有局 → 這條完全不介入
  if (incoming.phase !== 'game-over') return false;  // (b) 只擋已結束的局
  return !activeGameId || activeGameId !== incoming.id;
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
// >>> v6280-restart-baseline-core
/**
 * ⭐⭐⭐v6.280「幻影 setup 防護」的門檻（`lastAdoptedRestartCount`）**跟著房間走**的唯一判準。
 *
 * ## 這一版在修什麼（線上實測，不是推論）
 * `resolveRoomUpdate` 第 2 條的 phantom 防護是這樣寫的：
 *   `local.phase==='playing' && incoming.phase==='setup' && roomRestartCount <= lastAdoptedRestartCount`
 *   → reject `'phantom-setup'`。
 * 而 `lastAdoptedRestartCount` 在 `game/+page.svelte` 裡**只有一個寫入點**：
 *   「adopt 了一個 setup 局」的時候記下當時的 `restartProposalCount`。
 *
 * ⚠⚠ 問題在於它是 **per-page** 的變數，卻承載 **per-room** 的語意：
 *   ・`seat 0` 是 v5.749 的「指定建局者」—— 開局時它自己 `createGame` + `startGame` 成功後
 *     **直接** `game = _pendingGame`，**不經過 adopt** ⇒ 進到新房間永遠不會重新寫這個值；
 *   ・離開房間時 `roomData`／`game` 都清了，**唯獨這個值沒清**
 *   ⇒ 在 A 房經歷過一次重新開局（值被墊到 1）的 seat 0 玩家，換到 B 房之後，
 *     B 房的第一次重新開局（`restartProposalCount` 1）會被 `1 <= 1` **擋掉** ⇒ 畫面凍在舊局；
 *     等對手在新局裡等滿閒置秒數宣告棄權，那份 **game-over** 盤面 id 不同、phase 也不是 setup
 *     ⇒ 防護不適用 ⇒ 直接採納 ⇒ 玩家「什麼都沒做就輸了」。
 *
 * ## 判準
 * 這個門檻只在**同一間房**裡有意義。所以：
 *   ・`baselineRoom !== roomCode`（換房／重新訂閱同一間房）⇒ 用**那一間房伺服器端當下的**
 *     `restartProposalCount` 當新基準。
 *   ⚠⚠ **不是設 0** —— 設 0 是 fail-open：重整回到一間 `restartProposalCount` 已經是 2 的房，
 *     之後任何幻影 setup 局（count 2 &gt; 0）都會被放行。
 *   ・房號未知（`roomCode` 空）或 `roomRestartCount` 不是有限數 ⇒ **fail-closed：保留舊值**，
 *     一個字都不改（寧可多擋一次，也不要在資訊不足時放寬防護）。
 *   ・同一間房的後續每一發更新 ⇒ 原值不動（重設只發生一次，不會把 adopt 記下的值洗掉）。
 *
 * ⚠ 這支是**純函式**、沒有副作用；`resolveRoomUpdate` 一個字都沒有動。
 */
export function nextRestartBaseline(opts: {
  /** 目前這個門檻值是「哪一間房」的（null＝換房後尚未對應到任何房間） */
  baselineRoom: string | null;
  /** 這一發房間更新屬於哪一間房 */
  roomCode: string;
  /** 這一間房伺服器端當下的 restartProposalCount */
  roomRestartCount: number;
  /** 目前的門檻值 */
  lastAdoptedRestartCount: number;
}): { baselineRoom: string | null; lastAdoptedRestartCount: number } {
  const keep = {
    baselineRoom: opts.baselineRoom,
    lastAdoptedRestartCount: opts.lastAdoptedRestartCount,
  };
  if (!opts.roomCode) return keep;                       // fail-closed：房號都還不知道
  if (opts.baselineRoom === opts.roomCode) return keep;  // 同一間房 → 不重設
  if (!Number.isFinite(opts.roomRestartCount)) return keep;  // fail-closed：拿不到房間的計數
  return { baselineRoom: opts.roomCode, lastAdoptedRestartCount: opts.roomRestartCount };
}
// <<< v6280-restart-baseline-core

export function resolveRoomUpdate(
  local: GameState | null,
  incoming: GameState | null | undefined,
  ctx: RoomUpdateCtx,
): RoomUpdateDecision {
  if (!incoming) return { kind: 'ignore' };

  // ⭐⭐⭐1.5（v6.214①）本地沒有局時，**已結束的舊局不自動採納** → 留在大廳畫面。
  //   ⚠ 位置必須在第 2 條之前：第 2 條起每一條都是 `if (local && …)`，local 為 null 時
  //     全部落空、一路掉到第 9 步無條件 adopt —— 那正是「突然跳回舊局」的來源。
  //   判準與正對照見 isStaleFinishedGame 的說明（進行中的局／終局畫面都不受影響）。
  if (isStaleFinishedGame(local, incoming, ctx.activeGameId)) {
    return { kind: 'reject', reason: 'finished-old-game' };
  }

  // 2. 不同局：createGame race 採較新/同齡局；但「較早建立的殘留舊局」(createdAt 較小) 拒收
  //    v5.457：避免再來一局後舊局殘留 snapshot 蓋掉新局（回到上一盤最後一手）。舊版無 createdAt 視為 0。
  if (local && local.id !== incoming.id) {
    if (isOlderGame(incoming, local)) {   // v6.214③ 同上：單一判準
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
 * ⭐⭐⭐v6.309 座位的 setup 進度階梯（**中央述詞**：收端合併／推端合併／守衛三處共用）。
 *
 * ── 這在修什麼（玩家回報：補抽到的牌被系統放回牌庫，下回合又依序抽回同兩張）──
 * v6.308 以前 `mergeSetupMonotonic` 的 legacy 欄位是三套各自為政的規則：
 *   ・`players[對手]`：只有「本地已收到對手 setupDone、incoming 卻 false」才保留本地，**否則一律採 incoming**
 *     ⇒ 對手按過準備**之後**的進度（補抽、補抽後放備戰）完全沒有防回退。
 *   ・`pendingMulliganDraw`：MIN ⇒ 0 一旦出現就黏住（分不出「還沒領」與「領完了」）。
 *   ・`mulliganPostBenchOpen[對手]`：直接採 incoming ⇒ 舊 echo 帶 false 就把對手的補抽後視窗關掉。
 * 三者疊加：收到**自己的舊 echo**（房間被自己較舊的 push 蓋回去）時，對手那一半整組退回
 * 「補抽前」，而 pending 仍是 0、post-bench 也關了 ⇒ `tryAdvanceToPlaying` 全部 gate 通過
 * ⇒ 進 playing 並推送 ⇒ 受害端 setup×playing 走 adopt ⇒ **領到的補抽被洗回牌庫頂**。
 *
 * ── 修法：把 v6.058 只做在互動式欄位上的「同源＋單調 pick」推廣到 legacy 的全部 setup 欄位 ──
 * 每個座位只有**該座位的玩家**能推進自己的進度，而且每一個里程碑都是單調的：
 *   setupDone false→true、揭示確認 false→true、補抽 N→0、post-bench（領過才會開）true→false。
 * 因此「兩份快照裡同一座位誰比較前進」有偏序，取里程碑計數就是一個對該座位**單調不減**的分數：
 *
 *   0 互動式開局未定案（還在選 KEEP／MULLIGAN）
 *   1 定案未結算（`openingFinalized` 還沒寫，補抽 NET 還沒算）
 *   2 已結算／legacy 起點（尚未按準備）
 *   3 已按準備（setupDone）          ┐ 這四個里程碑彼此順序不固定（揭示確認可以在按準備之前），
 *   4 已確認揭示                     │ 所以用**計數**而不是固定階梯：同一座位的兩份快照必在同一條
 *   5 補抽已決定（pending 0）且 post-bench 開著 │ 鏈上，鏈上每個里程碑都只增不減 ⇒ 計數＝鏈上的先後。
 *   6 補抽已決定且 post-bench 關（＝該座位在 setup 已無任何可做的事） ┘
 *
 * ⚠ 未結算（0／1）時 legacy 欄位是 createGame 的佔位值（pending [0,0]），**不能**拿去跟結算後的
 *   「真的 0（領完了）」比 ⇒ 階梯把它們壓在 2 以下，結算後才開始數里程碑。
 * ⚠ 里程碑之外的差異（例如同階內放備戰）不影響分數；平手時對手側採 incoming（＝v6.308 以前
 *   「對手側顯示採房間」的行為），而同階內 deck 張數不變，所以平手不可能吃掉補抽（守衛 I8 直接實跑驗證）。
 */
export const SETUP_SEAT_RANK_MAX = 6;
export function setupSeatRank(s: GameState, i: 0 | 1): number {
  if (s.openingFlow === 'interactive') {
    if (!effectiveOpeningDone(s)[i]) return 0;
    if (!s.openingFinalized) return 1;
  }
  const decided = (s.pendingMulliganDraw?.[i] ?? 0) === 0;
  return 2
    + (s.setupDone?.[i] ? 1 : 0)
    + (s.mulliganRevealConfirmed?.[i] ? 1 : 0)
    + (decided ? 1 : 0)
    + (decided && !(s.mulliganPostBenchOpen?.[i] ?? false) ? 1 : 0);
}

/** 「這份快照的 legacy 欄位（補抽／揭示確認）已經是結算後的真值」——非互動式一律視為已結算。 */
function setupFieldsSettled(s: GameState): boolean {
  return s.openingFlow !== 'interactive' || !!s.openingFinalized;
}

/**
 * 開局 setup **每座位同源、單調**合併（v3.39/v4.494/v5.159/v5.339/v5.346 → v6.053/v6.058 → ⭐v6.309 收斂成單一規則）。
 *
 *   ・己側（me）收端**恆用本地**：我的座位只有我在推進，本地永遠是最前進的一份（推端見 mergeSetupSeats）。
 *   ・對手側**整組同源**：`players` / `setupDone` / `mulliganRevealConfirmed` / `pendingMulliganDraw` /
 *     `mulliganPostBenchOpen` / `mulliganCounts` / `mulliganRevealedHands` / `openingDone` 一起取
 *     `setupSeatRank` 較高的那份快照（未定案時再比重抽次數，同 v6.053 的 localAhead）。
 *     ⚠**同源原則**：各欄位各取極值會做出現實中不存在的盤面（v6.053 的縫合怪教訓）。
 *   ・互動式「恰一端已結算」時，`pendingMulliganDraw` / `mulliganRevealConfirmed` 整組採已結算那一端
 *     （未結算那端的值只是 createGame 的佔位；v6.053 批3 的 finSrc 規則，語義不變）。
 *   ・兩份快照先各自做冪等的 `ensureOpeningFinalized`（雙方都定案的快照立刻算出 NET），
 *     merge 完由 resolveRoomUpdate 再跑一次（合併後才湊齊雙定案的情況）。
 *
 * ⭐ 非互動式且 incoming **不是舊快照**（對手側 rank ≥ 本地）時，結果與 v6.308 的 OR／MIN／per-player
 *   規則**逐欄位相同**（scripts/test-opening-online-sync.mjs 第 10 條用矩陣實跑證明）；
 *   只有 incoming 在對手側**較舊**時才不同 —— 那正是要修的那一類。
 */
export function mergeSetupMonotonic(
  local: GameState,
  incoming: GameState,
  me: 0 | 1,
): GameState {
  return mergeSetupSeats(local, incoming, me, 'receive');
}

/** 座位 i 兩份快照誰比較前進：rank 高者；同為未定案時重抽次數多者；平手回 null。 */
function aheadSeat(L: GameState, I: GameState, i: 0 | 1): GameState | null {
  const rL = setupSeatRank(L, i);
  const rI = setupSeatRank(I, i);
  if (rI !== rL) return rI > rL ? I : L;
  if (rL === 0) {
    // 未定案：重抽次數較多者較前進（重抽次數只增不減；同次數＝同一手牌）
    const cL = L.mulliganCounts?.[i] ?? 0, cI = I.mulliganCounts?.[i] ?? 0;
    if (cL !== cI) return cL > cI ? L : I;
  }
  return null;
}

/**
 * 收端／推端共用的本體。兩端只差「己側平手時採誰」：
 *   ・receive（收端 resolveRoomUpdate）：己側**恆本地** —— 我的座位只有我在推進，本地永遠是最前進的一份
 *     （incoming 對我這一半頂多與本地同階；rank 較高只可能是「對手端先算出了結算旗標」，卡片內容相同）。
 *   ・push（推端 pushGameState）：己側也走 rank pick、平手採我這份 —— 我**自己的**兩發 push 可能亂序落地
 *     （BENCH 的那發晚於 FINISH 的那發），較舊那發不可以把房間裡我自己較新的一階蓋回去；
 *     平手採我這份＝v6.308 以前「推送＝整份覆蓋」在順序正常時的同一結果。
 *   ・對手側兩端相同：rank 高者，平手採「對方那份」（收端＝incoming、推端＝房間現況）：
 *     對手的權威資料本來就只會經由房間到我這裡，同階內張數不變（守衛 I8 實跑驗證）。
 */
function mergeSetupSeats(
  local: GameState,
  incoming: GameState,
  me: 0 | 1,
  mode: 'receive' | 'push',
): GameState {
  const opp = (1 - me) as 0 | 1;
  const L = ensureOpeningFinalized(local);
  const I = ensureOpeningFinalized(incoming);

  // ── 每個座位要採哪一份（單一述詞，決定該座位的全部欄位）──
  const oppSrc: GameState = aheadSeat(L, I, opp) ?? I;
  const mySrc: GameState = mode === 'receive' ? L : (aheadSeat(L, I, me) ?? L);
  const src: [GameState, GameState] = me === 0 ? [mySrc, oppSrc] : [oppSrc, mySrc];
  const seat = <T,>(get: (s: GameState) => readonly [T, T] | undefined, dflt: T): [T, T] =>
    [get(src[0])?.[0] ?? dflt, get(src[1])?.[1] ?? dflt];

  const players = [src[0].players[0], src[1].players[1]] as GameState['players'];
  const setupDone = seat<boolean>((s) => s.setupDone, false);
  const mulliganPostBenchOpen = seat<boolean>((s) => s.mulliganPostBenchOpen, false);

  // ── 結算後才有意義的兩個欄位：兩端結算狀態相同 → 每座位同源；恰一端結算 → 整組採該端 ──
  const fL = setupFieldsSettled(L);
  const fI = setupFieldsSettled(I);
  const finSrc: GameState | null = fL === fI ? null : (fL ? L : I);
  const pendingMulliganDraw = finSrc
    ? [...(finSrc.pendingMulliganDraw ?? [0, 0])] as [number, number]
    : seat<number>((s) => s.pendingMulliganDraw, 0);
  const mulliganRevealConfirmed = finSrc
    ? [...(finSrc.mulliganRevealConfirmed ?? [true, true])] as [boolean, boolean]
    : seat<boolean>((s) => s.mulliganRevealConfirmed, true);

  const base: GameState = {
    ...I,
    players,
    setupDone,
    mulliganRevealConfirmed,
    pendingMulliganDraw,
    mulliganPostBenchOpen,
  };
  // 非互動式開局（全站絕大多數對局）到此為止：不新增任何互動式欄位。
  if (L.openingFlow !== 'interactive' && I.openingFlow !== 'interactive') return base;

  // ── 互動式：每座位同源（與上面同一個 src），`pending`／`done` 互補直接導出 ──
  const mulliganCounts = seat<number>((s) => s.mulliganCounts, 0);
  const mulliganRevealedHands = {
    p1: [...(src[0].mulliganRevealedHands?.p1 ?? [])],
    p2: [...(src[1].mulliganRevealedHands?.p2 ?? [])],
  };
  // `openingDone` 只會 false→true，而且不牽涉任何卡片 ⇒ 沿用 OR（版本 skew 的舊 client 不會寫這個欄位，
  //   它那一份的 false 不是「撤銷」而是「不知道」；階梯本來就是用 effectiveOpeningDone 讀的）。
  const openingDone: [boolean, boolean] = [
    !!((L.openingDone?.[0] ?? false) || (I.openingDone?.[0] ?? false)),
    !!((L.openingDone?.[1] ?? false) || (I.openingDone?.[1] ?? false)),
  ];
  const effDone: [boolean, boolean] = [openingDone[0] || setupDone[0], openingDone[1] || setupDone[1]];
  return {
    ...base,
    mulliganCounts,
    mulliganRevealedHands,
    openingDone,
    openingChoicePending: [!effDone[0], !effDone[1]] as [boolean, boolean],
    openingFinalized: !!L.openingFinalized || !!I.openingFinalized,
    openingFlow: 'interactive',
  };
}

/**
 * ⭐⭐⭐v6.309 推送端（room-oracle.ts / room.ts 的 pushGameState）在 setup 期間要寫進房間的盤面。
 *
 * ── 這在修什麼 ──
 * v6.308 以前 setup 期間的 push 是「整份覆蓋」：`shouldSkipStalePush` 只擋 playing×playing 的
 * log 倒退，setup×setup 一律放行 ⇒ 我的 PUT 若因 409 重試而**晚於**對手的 push 落地，
 * 會把房間裡對手較新的那一半整份蓋回舊的 ⇒ 兩端接著都會 poll 到這份「我的舊 echo」。
 * ⇒ 推送端也走**同一支** `mergeSetupMonotonic`（我這一半恆用我的，對手那一半取房間與我之中
 *   較前進的），房間本身因此也是每座位單調的，舊 echo 再也蓋不掉對手較新的一半。
 *
 * ⚠ 零額外請求：這支在 oracleTx／runTransaction 的 closure 裡跑，用的就是那一輪本來就會讀到的房間現況；
 *   每一輪 409 重試都會對新的房間現況重算（純函式、冪等），不會產生寫入迴圈
 *   （merge 結果不會觸發新的 push —— 收端只在 action 或 setup→playing 推進時才推）。
 * ⚠ 只在「同一局、兩邊都是 setup、而且知道自己的座位」時合併；其餘一律原樣（與 v6.308 逐字相同）。
 */
export function mergeForSetupPush(
  mine: GameState,
  cur: GameState | null | undefined,
  mySeat: 0 | 1 | null | undefined,
): GameState {
  if (mySeat !== 0 && mySeat !== 1) return mine;
  if (!cur || cur.id !== mine.id) return mine;
  if (mine.phase !== 'setup' || cur.phase !== 'setup') return mine;
  return mergeSetupSeats(mine, cur, mySeat, 'push');
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

/**
 * ⭐⭐⭐v6.274：「P2 fallback grace 的起算點（`_onlineReadyAt`）什麼時候必須歸零」的**唯一**判準。
 *
 * ## 這一版在修什麼（線上實測，不是推論）
 * `_onlineReadyAt` 只在 `game/+page.svelte` 的 `checkAndStartOnlineGame()` 裡被歸零，
 * 但那支函式**只在「房間是 lobby ＋雙方就緒」時才會被 `handleRoomUpdate` 呼叫** ——
 * 於是它裡面那三條歸零（非 lobby／已有盤面／未雙就緒）在真實流程裡**跑不到**；
 * 而第四條早退 `haveLocalGame` 是在 `shouldAttemptStartGame` 內部擋的，呼叫端在它之前
 * 就已經把 `_onlineReadyAt` 寫成「這一刻」⇒ 同樣不會歸零。
 * 結果：第一局開打之後 `_onlineReadyAt` 就凍在「第一局雙方就緒的那一刻」，
 * 「再來一局」時 `readyElapsedMs` ＝上一局的**整場時間**
 * （8/30 線上指紋實測 169,596／397,304／597,965／1,164,572／1,300,430／1,314,882 ms），
 * P2 的 6 秒 fallback grace 被瞬間擊穿 ⇒ **雙端同時 createGame ⇒ v5.749 想根治的開局重洗競態重生**。
 *
 * ## 判準＝`shouldAttemptStartGame` 四條早退的**完全補集**
 * grace 計時的語意是「雙方就緒、房間還沒有局」已經持續多久。這個前提只要有任何一項不成立，
 * 計時就必須重新起算 —— 否則下一次前提再度成立時會沿用陳舊的起點。
 * 守衛 `test-v6274` 的【C】對全部 2×2×2×2 組合逐一斷言：
 * 本函式回 true ⇒ `shouldAttemptStartGame` 對**任何** seat／**任何** elapsed 都必回 false。
 *
 * ⚠ 本函式**只決定計時歸零**，不決定建不建局 —— 建局判準仍然唯一在 `shouldAttemptStartGame`。
 */
export function shouldResetStartGrace(opts: {
  roomStatus: string;
  hasGameState: boolean;
  bothReady: boolean;
  haveLocalGame: boolean;
}): boolean {
  return opts.roomStatus !== 'lobby' || opts.hasGameState || !opts.bothReady || opts.haveLocalGame;
}

// ── 錦標賽盤面採納：單一中央閘（v6.180）───────────────────────────────────────

/** `decideBoardAdopt` 的判決。`drop` = 這一發是亂序的舊盤面，採納它畫面就會倒退。 */
export type BoardAdoptDecision =
  | { kind: 'adopt'; reason: 'no-version' | 'first' | 'forward' | 'client-ahead' }
  | { kind: 'drop'; reason: 'out-of-order' };

/**
 * ⭐⭐⭐v6.180「錦標賽盤面只能往前，不能倒退」的**唯一**判準。
 *
 * ## 事故：玩家回報「盤面一直跳回上一步」
 * 錦標賽同步一共有 **4 個**地方會把 `game` 指成伺服器送來的盤面，而版本守衛只有 1 個
 * （`tAdopt` 開頭的 `version < tVersion` 早退）。另外 3 個都是刻意「繞過版本檢查」的
 * 強制回正路徑，全部是 `?v=-1` 的請求：
 *   ① 輪詢停擺看門狗的救援（v5.593）：`game = fr.gameState` —— 完全沒有版本判斷。
 *   ② `tForceResync`（v5.618）：`fr.version !== tVersion` 就整包蓋上去 —— **包含比較舊的版本**。
 *   ③ 主輪詢的 `r.version < tVersion` 分支（v5.593，v6.135 補了 `reqV === tVersion`）。
 * ①②的請求與主輪詢是**並行**的（主輪詢是 `setInterval`，不等前一發回來），所以
 * 「救援／重新同步的回應（版本 N）晚於主輪詢的回應（版本 N+1）抵達」是一個很普通的時序：
 *   ⇒ 盤面被指回 N ＝ **畫面倒退一步**，下一發輪詢再把它推回 N+1 ＝ 玩家看到的「跳回上一步」。
 * `tForceResync` 的呼叫點很多（8 秒節流的新鮮度看門狗、玩家點「等待對手行動 🔄」、
 * 「我還在」確認框、動作送不出去、v6.170 的回前景／`online` 事件），所以會**反覆**發生。
 *
 * ## 為什麼「版本必須前進」是安全的（查證，不是假設）
 * 錦標賽房間的 `version` 由伺服器單調遞增，**沒有任何一條路徑會讓它變小**：
 *   ・`/action` 套用成功：`nv = doc.version + 1`（CAS filter 帶舊版本）
 *   ・`/reset` 重置房間：`nv = (prev.version || 0) + 1` —— 是 **+1，不是歸零**
 *   ・排程器（判負警告／level-triggered 補推）：`version: (room.version || 1) + 1`
 * ⇒ 同一個房間內收到「比較小的版本」只可能是①亂序②client 自己超前，不可能是伺服器倒退。
 *
 * ## 合法的「版本重置」怎麼放行（⚠ 這比原 bug 更容易修壞）
 *   ・**換房間**（下一輪對戰／再來一局／進場觀戰／房間重置）：client 在每個離場點都把
 *     `tVersion = -1`，`tEnterMatch`／`tSpectate` 進場時也重設 ⇒ 走 `first` 一律放行。
 *   ・**client 真的超前伺服器**（跨房殘留的回應把 `tVersion` 拉高、伺服器資料被還原…）：
 *     `expectVersion` ＝**送出這一發當下**的 `tVersion`。若它與現在的 `tVersion` 相等，
 *     代表「從送出到現在，本地一次都沒有採納過別的盤面」⇒ 這就不是亂序，是真的 client 超前
 *     ⇒ 放行讓伺服器權威回正（`client-ahead`）。這條逃生口正是 v6.135 的判準，
 *     只是本版把它從「主輪詢一處」升級成**所有採納點共用**。
 *   ・伺服器沒給版本（舊端點／測試房）⇒ `no-version` 照收，維持改動前行為（fail-open）。
 */
export function decideBoardAdopt(opts: {
  /** 目前畫面上盤面的版本（尚未採納過任何盤面時為 -1）。 */
  localVersion: number;
  /** 這一發回應帶回來的版本。非數字 ⇒ fail-open 照收。 */
  incomingVersion: unknown;
  /** 送出這一發**當下**的 `localVersion`；沒有提供 ⇒ 不主張「client 超前」。 */
  expectVersion?: number | null;
}): BoardAdoptDecision {
  const inc = opts.incomingVersion;
  if (typeof inc !== 'number' || !Number.isFinite(inc)) return { kind: 'adopt', reason: 'no-version' };
  const local = (typeof opts.localVersion === 'number' && Number.isFinite(opts.localVersion))
    ? opts.localVersion : -1;
  if (local < 0) return { kind: 'adopt', reason: 'first' };
  // ⚠⚠ 等長**必須放行**（`>=`，忠實沿用 v6.048 以來 `tAdopt` 只擋嚴格較舊的行為）。
  //   Fable 5 審查建議收緊成嚴格 `>`（理由：等版本重採會洗掉畫面上的樂觀預測）——**查證後不採納**：
  //   `/action` 的 `rejected` / `notyourturn` / `invalid` 三種回應都帶著**版本沒變**的權威盤面
  //   （server_admin_patch.js：`version: doc.version`），而 `_tActAttempt` 正是靠這一發 `tAdopt`
  //   把「引擎拒絕了、但畫面上還畫著」的樂觀預測洗掉（它下一行就把 `ctx.predicted` 設成 false，
  //   之後再也沒有人會還原它）。改成 drop 的話，被拒絕的動作會**永遠留在畫面上**——
  //   那正是我們這一版要根治的「畫面與伺服器不一致，稍後才跳回去」。
  if (inc >= local) return { kind: 'adopt', reason: 'forward' };
  const expect = opts.expectVersion;
  if (typeof expect === 'number' && Number.isFinite(expect) && expect === local) {
    return { kind: 'adopt', reason: 'client-ahead' };
  }
  return { kind: 'drop', reason: 'out-of-order' };
}
