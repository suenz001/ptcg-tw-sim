<script lang="ts">
  import { tokenizeLogMessage, lineClass as logLineClass } from '$lib/game/log_format';
  import { retryImg } from '$lib/img-retry';
  // ⭐⭐⭐v6.177「抓取中／抓取失敗不清空已顯示資料」的唯一中央述詞（stale-while-revalidate）。
  import { adoptOrKeep, mergeKeyedOrKeep } from '$lib/ui/stale-keep';
  import { LB_TOP_OPTIONS, LB_TOP_MAX, lbTopRows, loadLbTop, saveLbTop } from '$lib/ui/leaderboard-top';
  import { resolveLogCard } from '$lib/game/log_zoom';
  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { fly, scale, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { base } from '$app/paths';
  import type { Card } from '$lib/cards/types';
  import { loadAllSets, buildCardIndex, loadDeckSets, deckEntriesAllInPool } from '$lib/cards/pool';
  import { getBroadcastConfig, type BroadcastConfig } from '$lib/game/broadcast';
  import { loadDecks, saveDecks, sortDecks } from '$lib/decks/storage';
  // v4.925：雲端 sync — 同帳號切換時 game 頁需重載牌組
  import { loadDecksFromCloud } from '$lib/decks/cloud';
  import type { Deck } from '$lib/decks/types';
  import { PRESET_DECKS } from '$lib/decks/presets';
  import { validateDeck } from '$lib/decks/validation';
  import {
    createGame, applyAction,
    getAvailableAttacks, getEffectiveAttacks, hasPendingActions,
    countEnergy, getEvolvableTargets, canEvolveOnto,   // v6.203 進化來源逐字比對中央述詞
    canRetreat, getRetreatBlockReason,
    computeActiveRetreatCostFor,
    getUsableAbilities, isBasicPokemonCard, isRulePokemon, getEffectiveHP, getBasicEnergyType,
    totalEnergyUnits, getBenchLimit, canBeInitialActiveCard,
    tryAdvanceToPlaying,
    tryPromoteToMainForFestival,
    getHandActivatableAbilities,  // v6.080 手牌特性中央 gate
    twoCardStadiumHalfIndex,      // v6.086 兩張合一競技場手牌裁半
    isTwoCardStadiumName,         // v6.091 棄牌區兩張合一不聚合判準
    twoCardStadiumSide,           // v6.095 依 cardId 直接判左右半（重抽回顧只有 cardId 沒有 iid）
  } from '$lib/game/engine';
  // ⭐⭐⭐v6.200「這張手牌卡現在能做哪個操作」的**唯一述詞** —— 拖曳與點擊共用同一份。
  //   （v6.199 以前拖曳看 dragKind、點擊看 canHandActivate，兩份漂移 →
  //     烈箭鷹ex｜激動俯衝 只能點、不能拖。）
  import {
    getHandCardOps, handCardDragKind, handCardDraggable, handOpForDropTarget,
    type HandCardOp, type HandDragKind, type HandDropTarget,
  } from '$lib/game/hand-card-ops';
  import { evaluateSelectionFilter, isKnownSelectionFilter, isMegaExCard,
           isBasicEnergyOfType as isBasicEnergyOfTypeCentral } from '$lib/game/selection-filter';
  import { selfCheckAbilityRegistry } from '$lib/game/effects/_shared';
  import { resolveRoomUpdate, shouldAttemptStartGame, decideBoardAdopt, decideStuckSelfHeal, isStaleFinishedGame } from '$lib/game/sync-guards';
  import { staleVersionDiagWhy } from '$lib/tournament/stale-diag';
  import { activeEnergyDiscardCandidates, fieldPickerBaseCandidates } from '$lib/game/selection-candidates';
  import { selectionAllowsSkip, selectionAllowsCancel, selectionConfirmFloor, selectionHasNoExit } from '$lib/game/selection-ui';
  import { GameActions } from '$lib/game/actions';
  import type { GameState, CardInstance } from '$lib/game/types';
  import { RULE_BOX_SUBTYPES } from '$lib/game/types';
  import { ATTACK_PRE_DISCARD_CHOICE, type PreDiscardSpec, PASSIVE_STADIUMS, getEnergyDiscardUnits, effectivePreDiscardMin, ABILITY_RETREAT_MOD, SPECIAL_ENERGY_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS, energyProvidesType, OPTIN_NO_PAYMENT } from '$lib/game/effects'; // v5.992 若希望 opt-in sentinel
  import { JAMMING_TOWER_STADIUMS } from '$lib/game/effects/cards/stadiums';
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';
  import type { EnergyType } from '$lib/cards/types';
  import { auth } from '$lib/firebase';
  import {
    signInAnonymously,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    linkWithCredential,
    EmailAuthProvider,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    updatePassword,
    reauthenticateWithCredential,
    type User,
  } from 'firebase/auth';
  // v4.65 Phase 3d: Oracle backend mode 支援（VITE_BACKEND_MODE=oracle 時用）
  import { ORACLE_MODE, oracleAuth, oracleRoomArchetypes, onOracleUidChange } from '$lib/game/oracle-client';
  // ⭐⭐⭐v6.197「這個人能不能操作」的唯一述詞（fail-closed）。見 src/lib/game/viewer-role.ts
  import { isViewerSpectator, canViewerAct, isSeatUnknownOnline } from '$lib/game/viewer-role';
  import {
    createRoom, joinRoom, subscribeRoom, pushGameState, pushUndoRollback, subscribeOpenRooms,
    takeSeat, setSeatDeck, setSeatReady, setSeatFirstChoice, startGame, leaveRoom, claimOpponentForfeit,
    setRematchReady, checkAndAcceptRematch,
    proposeRestart, respondRestart, cancelRestart, checkAndAcceptRestart,
    // v5.180 提議返回房間
    proposeReturnToRoom, respondReturnToRoom, cancelReturnToRoom, checkAndAcceptReturnToRoom,
    setSpectatorsAllowed, setIdleTimeout,
    findMySeatIdx, bothPlayersReady, countDeckCards,
    sendMessage, subscribeMessages,
    heartbeat, isSeatStale, HEARTBEAT_STALE_MS, deleteRoom,
    hostPresence,  // v5.393 大廳房主在線狀態
    // v4.75 連線練習模式悔棋 API
    requestUndo as requestUndoApi,
    agreeUndo as agreeUndoApi,
    rejectUndo as rejectUndoApi,
    clearUndoRequest as clearUndoRequestApi,
    type Room, type Seat, type ChatMessage,
  } from '$lib/game/room';
  import { getAIAction } from '$lib/game/ai';
  // v6.038 批次4b：本機 AI 對戰開始前，依 AI 那一側的牌組載入打法表（fail-open）。
  import { prepareAIPlaybook, clearPlaybook } from '$lib/game/ai-playbook';
  import { tryPredictAction, OPTIMISTIC_ACTION_TYPES } from '$lib/game/optimistic';  // v6.137 錦標賽樂觀更新
  // ⭐⭐⭐v6.173 錦標賽同步的結構共享（純函式，等價性由 test-v6173-adopt-structural-share 釘住）
  import { shareStateIdentity } from '$lib/game/state-share';
  import { VERSION } from '$lib/version';
  // ⭐⭐⭐v6.160 錦標賽報到的「client 版本太舊」提示。清快取動作與首頁那顆鈕**共用同一份實作**。
  import { hardRefreshNow } from '$lib/hard-refresh';
  import { isClientTooOld, recentlyHardRefreshed } from '$lib/version-compare';
  import { playSfx, closeAudio, preloadReadyGoSample, staggerSfx, playSfxEvents } from '$lib/audio/sfx';
  // v6.048：音效決策收斂到純函式（三條路徑共用，可寫自動化守衛）
  import { computeSfxEvents } from '$lib/audio/sfx-events';
  // v6.022 錦標賽通知（本地通知；決策核心在 notify-core.ts 純函式、有單元測試）
  import { notifyScan, notifyAct, resetActNotify, shouldPromptOnLobby, requestNotifyPermission, markPrompted,
           getNotifyEnabled, saveNotifyEnabled, getPermission as getNotifyPermission,
           sendTestNotification, isIOSNeedsInstall, initNotifyNav,
           subscribePush, unsubscribePush, getNotifyDiagnostics, hasPrompted,
           describePushStage, getNotifyCommunity, saveNotifyCommunity } from '$lib/notify';
  // ⭐v6.185 「輪到我需要操作」的需求計算（純函式、有單元測試）
  import { buildActNeed } from '$lib/notify-core';
  import { parseCoinFlipAnimationEvents } from '$lib/game/coinAnimation';
  import {
    loadAudioPrefs, saveVolume, saveMuted, isMuted as isAudioMuted, getMasterVolume as getAudioVolume,
    // v4.928 sub-bus 音量
    saveUiVolume, saveSfxVolume, saveStatusVolume,
    getUiVolume, getSfxVolume, getStatusVolume,
    // v4.929 playWhenHidden
    savePlayWhenHidden, getPlayWhenHidden,
    getBgmTrack, setBgmTrack, getBgmVolume, setBgmVolume
  } from '$lib/audio/settings';
  // v2.284 Phase 1：手機直式 layout 元件 — 用條件 render 切換
  import MobilePortraitBattle from './MobilePortraitBattle.svelte';
  // ⭐v6.233 預估傷害（只在休閒對戰）——計算全部收斂在 damage-estimate.ts，
  //   手機直式（MobilePortraitBattle）與桌機（本檔）兩套 UI 各自渲染，**但只有這一份計算**。
  import { estimateAllAttacks, estimateShortText, hasEstimateToShow, warnEstimateOnce, type DamageEstimate } from '$lib/game/damage-estimate';

  // ── 卡池 ────────────────────────────────────────────────────────────────────
  let pool = $state<Map<string, Card>>(new Map());
  let poolReady = $state(false);
  // v5.991：特性註冊 runtime 自檢 — 偵測 effects 註冊不完整(SW 舊 chunk / chunk 載入失敗 / 循環相依)時顯示重新整理提示
  let abilityRegBroken = $state(false);
  // ⭐⭐v6.160：這裡原本是**第三份**清快取實作，而且比首頁那份少了兩樣東西——
  //   ①沒有 v5.909 的 2.5 秒逾時保險（列舉 SW 註冊／刪 cache 的那兩支 API 在某些 PWA 狀態下
  //     會既不 resolve 也不 reject ⇒ 後面的 reload 永不執行 ⇒ 按了完全沒反應）；
  //   ②用 location.reload() 而不是帶 `_v=` ⇒ 沒有 bypass HTTP 快取。
  //   正好是「特性按鈕靜默消失」最需要它可靠的時候。收斂到唯一實作。
  async function hardReloadBrokenReg() { await hardRefreshNow(); }
  let decks = $state<Deck[]>([]);
  const allDecks = $derived([...PRESET_DECKS, ...decks]);
  // ── v0.4 錦標賽伺服器權威模式（/tournament wrapper 傳入 tournamentMode=true）──
  //   全部以 isTournament gate；正常 /game 線上對戰路徑 runtime 完全不變（gate=false）。
  let { tournamentMode = false } = $props();
  let isTournament = $state(tournamentMode);
  let tStep = $state<'lobby' | 'waiting' | 'playing'>('lobby');
  let tVersion = $state(-1);
  let tDeckId = $state('');
  let tNickname = $state(''); // 錦標賽暱稱（對戰/聊天/賽程表都用它顯示）
  let tCoinPref = $state('random'); // v5.572 硬幣勝出時要先攻/後攻/隨機
  // v5.724：報名顯示先後攻偏好。server /event 未回傳 myCoinPref 時用 localStorage(玩家報名時本機存的)fallback。
  const COIN_PREF_LABEL: Record<string, string> = { random: '隨機', first: '先攻', second: '後攻', opponent: '對手決定' };
  function coinPrefLabel(p: string | undefined | null): string { return COIN_PREF_LABEL[p ?? 'random'] ?? '隨機'; }
  function readCoinPref(eventId: string): string { try { return localStorage.getItem(`ptcg_tourn_coinpref_${eventId}`) ?? 'random'; } catch { return 'random'; } }
  function saveCoinPref(eventId: string, pref: string): void { try { localStorage.setItem(`ptcg_tourn_coinpref_${eventId}`, pref); } catch { /* ignore */ } }
  let tNow = $state(Date.now()); // 倒數計時用（輪詢時更新）
  let tLastActionAt = $state(0);   // v5.569：對局最後動作時間(伺服器回)，等待方閒置倒數用
  let tIdleMin = $state(3);        // 閒置判負分鐘(伺服器回)
  // ⭐v6.151 伺服器權威「現在輪到誰」。閒置判負是**伺服器**用它自己那份盤面算的，
  //   client 各自本地推算 ⇒ 只要版本落後就會對不上（v6.149 事故：玩家看到「對手在倒數」，
  //   伺服器其實在倒數他）。undefined = 伺服器還沒回過這個欄位（舊版）⇒ 退回本地推算。
  let tServerActorSeat = $state<number | null | undefined>(undefined);
  // v6.151 回前景時間：背景頁籤的 setInterval 會被節流，tNow 停在舊值 ⇒ 一回前景會先算出
  //   「剩 0 秒」嚇人。短暫抑制倒數提示，等下一次 tick 對時後再顯示。
  let _tForegroundAt = $state(0);
  // ⭐v6.152 伺服器是否已啟用長輪詢（灰度旗標，伺服器端預設關閉）。
  //   **只有伺服器宣告啟用後 client 才會送 `wait=1`**，所以旗標關著時行為與 v6.151 逐字相同。
  let tLongPollReady = $state(false);
  let _tLongPollAt = 0;                // 長輪詢在途的送出時間（0 = 沒有在途）
  let _rttSamples: number[] = [];      // v6.151 動作往返時間取樣（只在明顯偏慢時回報一次）
  let _rttDiagSent = false;
  // ⭐⭐⭐v6.159【只加量測，不做任何效能修正】
  //   錦標賽的「卡」修了十幾版都沒中，因為每一版都在修伺服器，而伺服器端指標一直是全綠的。
  //   本版的唯一目的：讓下一場賽事的數據能**決定性地**分辨「網路慢」與「client 主執行緒慢」。
  //   ⚠ v6.151 的 `rtt` 是從 `tApi` 進函式起算的 —— 它**包含**
  //     `await firebaseUser.getIdToken()`、`res.json()` 解析、以及 await 續行還要排隊等
  //     主執行緒空檔 ⇒ 它從來就不是純網路時間，我們一直誤讀它。這裡把它拆成四段。
  let _segTok: number[] = [];          // ① await firebaseUser.getIdToken()
  let _segNet: number[] = [];          // ② fetch 送出 → response **header** 回來
  //   ⚠⚠ Fable 5 審查抓到：`fetch` 在 header 到達就 resolve，**body 還沒下載**。
  //     若把 `res.json()` 整段當成「解析」，行動網路 + 大盤面時「解析」欄會被**下載時間**灌爆，
  //     而「網路」欄反而很小 ⇒ 會做出**與事實相反**的結論（把網路慢誤診成裝置慢），
  //     那正好顛覆這一版唯一的目的。所以拆成「下載 body」與「純 JSON.parse」兩段。
  let _segDl: number[] = [];           // ③ res.text()：body 下載（**網路吞吐量**，不是主執行緒）
  let _segParse: number[] = [];        // ④ JSON.parse（**純主執行緒 CPU**）
  let _segTotal: number[] = [];        // ⑤ tApi 函式總耗時（①~④ + 等主執行緒空檔）
  // ⭐⭐⭐v6.213【③ 伺服器端 per-request 處理時間】
  //   `net`（送出 → 第一個位元組）把「隧道／CF 慢」與「Node 自己處理慢」**綁死**，分不開。
  //   伺服器現在在每個 /api/tournament/* 回應帶 `X-Srv-Ms`（Express 進 handler → 送出 header
  //   的純處理時間），這裡收下來 ⇒ `net - srv` 才是真正的「線路 + 隧道」。
  //   ⚠ 舊伺服器沒有這個 header ⇒ 一筆都收不到 ⇒ `_sampleStats` 回 **null**，
  //     絕不送一堆恆為 0 的欄位假裝有量到（與 longtask / seg 同一條紀律）。
  let _segSrv: number[] = [];          // X-Srv-Ms（伺服器端處理時間，毫秒）
  let _srvHdrN = 0;                    // 有帶 header 的成功往返數
  let _srvHdrMiss = 0;                 // 沒帶 header 的成功往返數（＝伺服器還是舊版）
  // ⭐⭐⭐v6.227【玩家落在哪個 Cloudflare 邊緣節點（colo）】
  //   實測：台灣 HiNet 出口被 CF 導去美西 SJC（8/8、connect 148~155ms ≒ 玩家 net p50 138~151ms），
  //   隧道端在新加坡。「偶發 3~4 秒尾巴」剩兩個競爭假說：(a) cloudflared 隨 uptime 劣化（重啟可解）
  //   vs (b) 特定邊緣節點劣化（重啟只是碰巧換節點）。判準＝慢的人集不集中在特定 colo，
  //   而 payload 一直沒有 colo ⇒ 這裡補上。
  //   ⭐ 來源是**既有回應**的 `cf-ray` 標頭（形如 a2fb6ea96b799913-SJC，'-' 之後就是 colo）。
  //     同源 ⇒ 回應標頭全部讀得到，不需要 CORS 白名單；**零額外請求**——
  //     絕不去打 /cdn-cgi/trace（那是多一發請求，違反「觀測不得加負擔」的紀律）。
  //   ⚠ 記「這場看過哪些 colo 各幾次」而不是逐筆：玩家可能在對局中換節點，
  //     但 payload 有 8192 字元上限 ⇒ 只存計數（相異 colo 鍵數上限 8，超過不再新增鍵）。
  //   ⚠ 沒有 cf-ray 的成功回應（SW 快取、不經 CF 的路徑）記進 miss，絕不 throw。
  let _coloCounts: Record<string, number> = {};  // colo（如 SJC/TPE/SIN）→ 這場看到的次數
  let _coloLast: string | null = null;           // 最近一發成功往返落在哪個 colo
  let _coloMiss = 0;                             // 成功往返但回應沒有 cf-ray 的次數
  let _adoptSamples: number[] = [];    // tAdopt 本身的同步執行時間
  let _paintSamples: number[] = [];    // tAdopt 開始 → 下一個 animation frame（重繪成本的代理指標）
  let _paintPending = false;           // 同時只掛一個 rAF —— 量測本身絕不可以變成新的主執行緒負擔
  let _visSeq = 0;                     // 頁籤可見性代次：背景時 rAF 完全不 fire，跨越可見性變動的樣本一律丟棄
  let _ltSamples: { t: number; d: number }[] = [];   // longtask（>50ms 的主執行緒任務）滾動窗
  let _ltSupported = false;            // ⚠ Safari/iOS 沒有 longtask ⇒ 一律回 null（不是 0），且絕不 throw
  // ⭐⭐⭐v6.213【② 低頻無條件取樣】—— 把「健康對照組」放回遙測裡。
  //   v6.198 把 stale-version 的判準收緊之後，**網路正常的人不再送任何回報** ⇒
  //   `/clientdiag` 裡只剩下有問題的人，往後「這一版有沒有變慢」在原則上就答不出來
  //   （分母只剩病人）。這裡補一條**與異常完全無關**的抽樣管道：
  //     ・每一場對戰進場時擲一次骰子，機率 PERF_SAMPLE_RATE；
  //     ・中了就在累積到 PERF_SAMPLE_MIN_CALLS 發成功往返之後送**一發**（每場最多 1 發）；
  //     ・reason 用**新指紋** 'perf-sample'，與所有異常指紋分開（dump / admin 兩邊都分開統計）。
  //   ⚠ 取樣本身極輕：一次 Math.random() + 每發往返一個布林比較，沒有新的計時器、沒有新的請求管道。
  //   ⚠ 走既有的 /clientdiag 與既有節流，**不另開端點**。
  //   ⚠ 不佔每頁 3 發的異常配額（見 _tSendClientDiag 的 _isExempt）——
  //     取樣絕不可以把真異常指紋擠掉，那會是比「沒有對照組」更糟的事。
  //   ⚠ 只涵蓋**錦標賽對戰者**：整套 perf 量測（_tRecordApiSegments）本來就只掛在這條路徑上，
  //     休閒／本機對戰沒有 tApi 也沒有四段拆分，硬接等於另開一套（違反「沿用既有管線」）。
  const PERF_SAMPLE_RATE = 0.1;        // v6.214④ 每場對戰 10%（站長裁定：1% 一場賽事只有 ~1.5 筆，看不出趨勢）
  const PERF_SAMPLE_MIN_CALLS = 20;    // 累積 20 發成功往返才送 —— 太早送等於只量到開局那幾發
  let _perfSampleRoom = '';            // 上一次擲骰是為了哪一間房（房號一變＝新的一場）
  let _perfSampleArmed = false;        // 這一場中籤了嗎（每場只擲一次）
  let _perfSampleSent = false;         // 這一場已經送過了（每場最多 1 發）
  // ⭐⭐⭐v6.170【A：自動回報網路細節】—— 取代「請玩家按 F12」。
  //   v6.159 量到 `net`（fetch 送出 → response header）p50 289ms 但同一個人 max 14.8 秒，
  //   結論是**間歇性斷流**。但「那一發到底有沒有重新建連線」我們量不到 —— 而那正是
  //   分辨「舊連線陷進 TCP 退避」與「單純封包在路上」的關鍵，也是決定下一步怎麼修的依據。
  //   ⚠⚠ 這些欄位在**跨源**時需要 `Timing-Allow-Origin`，否則全部是 0。
  //     本站實測（curl 正式站）：頁面與 API 都在 www.ptcg-tw-sim.com，`/api/tournament/*`
  //     由 Cloudflare 轉到 VM ⇒ **同源，不需要 TAO**，欄位拿得到。
  //   ⚠ 即使如此仍**逐筆自我驗證**：`requestStart` 為 0 就代表這筆 timing 被瀏覽器閹割了，
  //     一律丟棄並記進 `bad` —— 絕不把一堆恆為 0 的欄位送上去假裝有量到。
  let _rtSupported = false;            // PerformanceObserver('resource') 掛得上嗎（不支援 ⇒ 統計回 null）
  let _rtN = 0;                        // 可用樣本數
  let _rtBad = 0;                      // timing 被閹割（requestStart===0）而丟棄的樣本數
  let _rtReuse = 0;                    // 重用既有連線
  let _rtFresh = 0;                    // 這一發**重新建了連線**
  let _rtSw = 0;                       // workerStart>0（＝真的經過 Service Worker；用來驗證 SW 確實放行 /api/）
  const _rtProto: Record<string, number> = {};   // nextHopProtocol（h2 / h3 / http/1.1 / '?'）→ 次數
  let _rtConnMs: number[] = [];        // 建連耗時（只在「重新建連」的樣本才有意義）
  let _rtDnsMs: number[] = [];
  let _rtTlsMs: number[] = [];
  // ⭐⭐⭐v6.179【把「網路」那 1.3 秒再拆成兩段】—— 只加量測，不改任何效能邏輯。
  //   v6.159 量到 `net`（送出 → 第一個位元組）中位 1.3 秒、最大 14.9 秒，
  //   而 `dl` 只有 27ms、`parse` 1ms、`adopt` 3ms、`paint` 50ms、`lt` 中位 0
  //   ⇒ 時間**全在等第一個位元組**，不是體積也不是主執行緒。
  //   伺服器與隧道實測無罪（VM 上 node 3.7ms、繞 Cloudflare 一圈 65ms），
  //   所以這一版把 `net` 用 PerformanceResourceTiming 拆開：
  //     queue = requestStart - fetchStart    ⇒ DNS＋TCP＋TLS＋瀏覽器排隊（**不含** SW，見下）
  //     wire  = responseStart - requestStart ⇒ 真正的請求往返（含 CF、隧道、VM）
  //     sw    = fetchStart - workerStart     ⇒ **Service Worker 派送成本就在這一段**
  //     lag   = net(JS 量的) - (responseStart - startTime)
  //             ⇒ 瀏覽器時間軸解釋不了的殘差＝await 續行在等主執行緒空檔
  //             （這一欄大就代表 `net` 被主執行緒灌水，不是真的網路慢）
  //   ⚠⚠⚠ 這一輪最重要的更正：規範上 `workerStart` **早於** `fetchStart`。
  //     Resource Timing §3.3：workerStart 取 fetch timing info 的 final service worker start time，
  //     fetchStart 取 post-redirect start time；MDN 明寫
  //     `const workerProcessingTime = entry.fetchStart - entry.workerStart;`。
  //     ⇒ SW 派送成本**不在 queue 裡**，把它當成 queue 的一部分會做出**完全相反**的結論。
  //     所以 `sw` 是獨立一欄，而且只在 `fetchStart - workerStart > 0` 才記；
  //     不合這個順序的瀏覽器記進 `swOdd`（硬算會生出負數或假 0）。
  let _rtSegN = 0;                     // 成功對回「哪一發 fetch」的樣本數
  let _rtSegBad = 0;                   // 對不上任何 fetch 時間窗 ⇒ **丟棄**，絕不硬湊
  let _rtQueueMs: number[] = [];
  let _rtWireMs: number[] = [];
  let _rtSwMs: number[] = [];          // fetchStart - workerStart（SW 派送）
  let _rtSwN = 0;                      // workerStart > 0 的樣本數
  let _rtSwOdd = 0;                    // workerStart > 0 但 fetchStart - workerStart <= 0
  let _rtLagMs: number[] = [];
  let _rtPreMs: number[] = [];         // startTime → workerStart（無 SW 時 → fetchStart）：瀏覽器內部排程／SW 查找／redirect
  let _rtSegAbort = 0;                 // responseStart 為 0（逾時／abort 的失敗往返）⇒ 與「對不上」分開記
  let _rtLagNeg = 0;                   // 殘差為明顯負值（< -2ms）＝算式或時鐘有問題，必須看得見而不是被靜靜丟掉
  // fetch 時間窗（對齊用）。⚠ 每發只存一個字串＋三個數字，
  //   量測本身不可以變成新的主執行緒負擔（這是我們現在唯一的儀器）。
  type _RtWin = { u: string; t1: number; t2: number; used: boolean };
  let _rtWins: _RtWin[] = [];
  // ⭐⭐⭐v6.170【B-1/B-2/B-3：動作的冪等重試】
  //   斷流時 `POST /action` 逾時，玩家**根本不知道那一發有沒有送到**。v6.169 的做法是把這個
  //   不確定性原封不動丟給玩家（「動作可能未送達，請重試」）；重按就可能套用兩次，不按就遺失。
  //   ⇒ 帶上冪等鍵讓伺服器保證「同一個鍵只套用一次」，重送就變成安全的，可以自動做。
  const TACT_RETRY_MAX = 5;            // attempt 上限
  const TACT_RETRY_MS = 25000;         // 重送窗牆鐘上限（伺服器端去重紀錄保存 120 秒 ＝ 這個的 4.8 倍）
  const TACT_POST_TIMEOUT = 8000;      // ⚠ 由 12000 降下來：p99 的 net 是 3.6 秒，等 12 秒才知道要重試太久了。
                                       //   有了冪等鍵，「提早放棄並重送」不再有重複套用的風險。
  type TActCtx = { action: any; actId: string; prev: any; predictedRef: any; predicted: boolean; attempt: number; startedAt: number; baseV: number };
  let _actCtx: TActCtx | null = null;  // 同時只有一個（tournamentDispatch 開頭的 tInFlight 單發鎖保證）
  // ⭐⭐⭐v6.172【拖曳被鎖死最長 33 秒】的根治：手勢改成「排隊」，不再靜默丟棄。
  //   v6.170 的重送狀態機讓 tInFlight 最長撐 TACT_RETRY_MS(25s) + TACT_POST_TIMEOUT(8s) ≈ 33 秒，
  //   而 v6.147 的 actionBusy 直接 gate 住手牌的 onpointerdown ⇒ 那 33 秒之內每一個拖曳
  //   （附能量、放寶可夢到場上）都被丟掉，而且畫面沒有任何提示。v6.121 沒有這個旗標，
  //   玩家說的「舊版順、新版卡」指的就是這件事。
  //   ⚠ 直接放行是錯的：兩個邏輯動作同時在途，伺服器依抵達順序套用，順序一亂就變成另一場對局。
  //   ⇒ 唯一安全的做法是「收下手勢、排進佇列、嚴格照順序送」：
  //     ① 網路上同時仍然只有一個動作（tInFlight 單發鎖完全不動）⇒ v6.170 的 actId 冪等照舊成立；
  //     ② 每個手勢**出佇列時才走 tournamentDispatch**，於是各自拿到自己的 actId，
  //        不同手勢絕不共用鍵、也就不可能被伺服器誤判成重複而吞掉；
  //     ③ 佇列滿了才真的擋，而且擋下來時**一定講出來**（靜默丟棄是最糟的）。
  const TACT_QUEUE_MAX = 3;
  type TActQueued = { action: any; sig: string };
  let tActQueue = $state<TActQueued[]>([]);
  let tActNotice = $state('');   // 「剛剛那一下怎麼了」的可見說明（template 綁定）
  let _tActNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  function _tActSig(a: any): string { try { return JSON.stringify(a); } catch { return String(a && a.type); } }
  /** ⭐ 唯一的「告訴玩家剛剛那一下怎麼了」出口。⚠ 任何擋下手勢的地方都必須呼叫它，不可以只 return。 */
  function tActSay(msg: string, ms = 2600): void {
    tActNotice = msg;
    if (_tActNoticeTimer) clearTimeout(_tActNoticeTimer);
    _tActNoticeTimer = setTimeout(() => { tActNotice = ''; _tActNoticeTimer = null; }, ms);
  }
  const TACT_BLOCKED_MSG = '⚠ 前面已經排了 ' + TACT_QUEUE_MAX + ' 個動作還沒送出 —— 剛剛這一下沒有生效，請稍候再試一次。';
  let _actRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let tActRetry = $state<{ n: number; max: number } | null>(null);   // template 綁定：重送中的可見狀態
  let tOppQuietSec = $state(0);        // ⭐v6.170【B-4】伺服器回報「對手安靜幾秒」（0／未回報 = 不提示）
  let _freshWatchdogVersionAt = -1;    // v6.151 新鮮度看門狗第一次觸發當下的版本
  // ⭐v6.156「我還在」：把「事後看監控」換成「當場問玩家」。真掛機照樣判負，在思考的人不會被冤枉。
  let tStillHereBusy = $state(false);
  let tStillHereNote = $state('');     // 伺服器拒絕時的說明（時限已到／不是你該動作／已結束）
  let _stalledDiagSent = false;        // setup-stalled-both-done 每場只送一次（診斷配額每頁只有 3 發）
  // ── 觀戰 ──
  let tSpectateList = $state<any[]>([]);
  let tChampions = $state<any[]>([]); // v5.570 名人堂（歷屆冠軍）
  let tHofView = $state<any | null>(null);   // v5.642 名人堂點選後載入的「當初賽程」(歸檔)
  let tHofPage = $state(1);                   // 名人堂賽程翻頁(輪次)
  let tHofLoading = $state(false);
  let tHofOfficialOpen = $state(false);      // v6.005 官方歷屆冠軍：預設收合（同社群，節省版面；點擊展開）
  let tHofCommunityOpen = $state(false);     // v5.652 社群自辦歷屆冠軍：預設收摺（社群賽數量多，點選才展開）
  // v5.691 錦標賽大廳三分頁：賽事 / 排行榜 / 個人資料
  let tTab = $state<'events' | 'leaderboard' | 'profile'>('events');
  let tLeaderboard = $state<any | null>(null);   // 排行榜聚合（後端 /leaderboard）
  let tLbLoading = $state(false);
  // ⭐v6.199 排行榜顯示筆數（5 / 10 / 20，見 $lib/ui/leaderboard-top）。
  //   伺服器一次送 LB_TOP_MAX 筆，切換筆數**只是本地 slice**：不重抓、不清空、不閃，
  //   v6.177 的 stale-keep 那份好資料原封不動留在 tLeaderboard 裡。
  let tLbTop = $state(loadLbTop());
  function tLbSetTop(v: string | number): void { tLbTop = Number(v); saveLbTop(tLbTop); }
  let tProfile = $state<any | null>(null);        // 個人資料聚合（後端 /profile，本人）
  let tProfileLoading = $state(false);
  // v5.692 對戰戰報（名人堂賽程點某場看公開 log）
  let tHofEventId = $state('');
  let tMatchLog = $state<any | null>(null);
  let tMatchLogLoading = $state(false);
  let tMatchLogTitle = $state('');
  let tSpectateRoom = $state('');
  let isTournSpectator = $state(false);
  let tError = $state('');
  let tBusy = $state(false);
  let tPollTimer: ReturnType<typeof setInterval> | null = null;
  let tPollGen = 0;  // v5.586 poll 世代：離開對戰時 ++，使在路上的 in-flight 回應失效（防返回大廳後被彈回對戰）
  let _tLastPollOkAt = 0;  // v5.591 上次輪詢成功回應時間（**只給輪詢停擺看門狗用**，語義刻意不變）
  // ⭐⭐⭐v6.172 連線健康的**單一錨點**（「與伺服器失聯」的判準只准有這一份）。
  //   舊判準 `(tNow - _tLastPollOkAt)/1000` 有兩個各自獨立、都會誤報的缺陷：
  //   ① `_tLastPollOkAt` 只有 /state 輪詢、看門狗、手動 resync 會更新 —— `POST /action`
  //      往返成功**不算**。⇒ 動作全部成功、伺服器 5xx=0，橫幅照樣跳「與伺服器失聯 xx 秒」。
  //   ② 站長已開啟長輪詢：伺服器 by design 把 /state 掛起最多 25 秒 —— 在舊判準眼裡就是
  //      「失聯 25 秒」⇒ **對手每次長考都誤報**。玩家回報的「一直出現失聯」就是這個。
  //   新判準只有一句話：**距離「上一次能證明伺服器還連得上」過了多久**。
  //   ・任何一次成功的伺服器往返都算 —— 在 tApi 的成功出口**單點**記錄（/state、長輪詢正常
  //     回應、POST /action、看門狗與手動 resync 全部經過那裡，不必也不准各自再寫一份）。
  //   ・在途的長輪詢，在它**自己的逾時**到期前不構成失聯的證據 ⇒ 掛起期間一律 0 秒。
  //   ⚠ 正對照（真的斷線仍要跳）：斷線時那一發長輪詢會在 T_LP_CLIENT_TIMEOUT_MS 逾時，
  //     finally 清掉掛起窗 ⇒ 秒數立刻從「上次成功往返」起算（那時已經 ≥30 秒）⇒ 橫幅**立刻**
  //     跳出來，比舊版還早，而不是要再慢慢爬 10 秒。
  const T_LP_CLIENT_TIMEOUT_MS = 30000;   // 長輪詢的 client 逾時（伺服器掛起上限 25 秒 + 餘裕）
  const T_OFFLINE_BANNER_SEC = 10;        // 失聯幾秒才跳橫幅
  let _tLastServerOkAt = $state(0);       // 任何一次成功的伺服器往返
  let _tLpHangUntil = $state(0);          // 在途長輪詢「合法掛起」到什麼時候（0 = 沒有在途）
  // ⭐⭐v6.172（Fable 5 審查抓到）長輪詢「黑洞式斷線」的補洞。
  //   掛起期間我們分不出「伺服器正常掛住」與「封包被丟掉」，所以掛起窗會壓住橫幅最長 30 秒，
  //   比 v6.171 的 10 秒晚 —— 那是把誤報修過頭。⇒ 用一發**便宜的**探針把偵測時間補回來：
  //   只在「長輪詢在途、而且已經 12 秒沒有任何一次成功往返」時送，帶目前版本
  //   ⇒ 伺服器回精簡的 unchanged（不是 v=-1 全量，v6.155 的教訓）。
  //   ・探針成功 ⇒ tApi 的成功出口自動記錄存活（連線其實是好的，橫幅本來就不該跳）；
  //   ・探針失敗 ⇒ 撤銷掛起窗，失聯秒數立刻從「上次成功往返」起算 ⇒ 橫幅約 12～17 秒就出現。
  const T_CONN_PROBE_AFTER_MS = 12000;    // 幾秒沒有任何成功往返才值得送探針
  const T_CONN_PROBE_THROTTLE_MS = 15000; // 探針自己的節流（絕不能變成第二條輪詢）
  let _tConnProbeAt = 0;
  function _tMarkServerAlive(): void { _tLastServerOkAt = Date.now(); }
  let _tLastStateChangeAt = 0;  // v5.618 上次盤面實際更新時間（新鮮度看門狗：poll 成功卻漏接更新時也能自動重抓）
  let _tLastForceResyncAt = 0;  // v5.618 上次強制重抓時間（節流）
  // ⭐⭐v6.149 輪詢停擺看門狗的**節流專用**時間戳。
  //   原本它是直接把 `_tLastPollOkAt` 推到現在來「防重複觸發」—— 那等於**自我安撫**：
  //   救援成功與否都重置，`_tLastPollOkAt` 因此永遠不會累積成「已失聯 N 秒」，
  //   也就永遠無法升級成玩家看得到的警示。節流與「上次真的收到伺服器回應」必須分開記。
  let _tPollStallGuardAt = 0;
  let _tNetBannerDismissAt = $state(0);   // 玩家手動關掉橫幅的時間（同一次失聯不再重複打擾）
  // v6.150：伺服器回 401（登入憑證失效／在別的分頁登出／被撤銷）時為真。與「網路失聯」分開，
  //   因為自救方式不同：這個要重新登入或強制刷新 token，重連是沒有用的。
  let tAuthLost = $state(false);
  //   ⚠ 必須是 $state：plain let 要等下一次 tOfflineSec 重算才收掉橫幅（最多延遲 1 秒，玩家會連點）。
  let _diagSentCount = 0;              // v5.933 客戶端診斷回傳 per-page 上限(3)
  let _lastManualDiagAt = 0;           // v6.155 manual-sync 自帶節流（不佔上述配額）
  let _freshWatchdogFires = 0;         // v5.933 新鮮度看門狗連續觸發次數(盤面 tAdopt 即歸零)
  let _invisibleHandDiagSent = false;  // v5.933 隱形手牌指紋已回傳一次(避免每 tick 重送)
  let _setupDiagSent = false;          // v6.155 setup 指紋每場只回報一次
  // ⭐⭐v6.158（Fable 5 審查抓到）：stale-version 原本**沒有** per-stall 去重 ——
  //   看門狗每 8 秒觸發一次、條件持續成立就會連發，一次 70 秒的長考就把
  //   `_diagSentCount` 的 3 發配額燒光，之後 invisible-hand 等真指紋全部靜音
  //   （與 v6.155 把 manual-sync 移出配額時點名的是同一型缺陷）。
  //   ⇒ 記住「已回報過的那個卡住版本」，版本一前進就自動失效、可以再報。
  let _staleDiagVersion = -1;
  // ⭐⭐⭐v6.198 上一次送出時是哪一條判準成立（'a'／'b'／'c'，可能多條）。
  //   會原樣寫進 payload 的 `poll.staleWhy` —— 站長／dump 摘要靠它分辨
  //   「這筆是新判準送的」與「這筆來自 v6.197 以前的舊 bundle」。
  let _staleDiagWhy: string | null = null;
  // ⭐⭐v6.158：`/action` 在正式賽房會對未驗證身分回 403（server_admin_patch.js
  //   `doc.matchId && !_id.verified`），而盤面遮蔽關閉時 `/state` **完全不驗身分**、永遠 200
  //   ⇒ 會出現「輪詢正常、畫面正常、輪到我，但每一發動作都被拒」而版本永遠不前進。
  //   舊版只會閃一則紅色 toast，失聯橫幅（連同它的「刷新憑證」自救鈕）因為 tOfflineSec=0 不會出現，
  //   也沒有任何診斷指紋 ⇒ 站長事後完全看不到。
  let _tActionAuthErr = $state(false);
  let _tActionAuthErrAt = $state(0);
  let _actionAuthDiagSent = false;

/** v6.155 目前畫面上真的畫出來的手牌張數 —— 桌機與手機直式是兩套 class，兩邊都要數。 */
function _countVisibleHandCards(): number {
  if (typeof document === 'undefined') return -1;
  return document.querySelectorAll('.hand-strip .hand-card, .mp-hand-card').length;
}

/**
 * ⭐⭐v6.155 setup 階段「輪到我、我卻動不了」的中央述詞。
 *
 * 事故：v6.154 上線後監控收到 `setup-watchdog-repeat` **118 次 / 59 人** —— 幾乎每個參賽者都中。
 *   實際查兩筆樣本：`sincePollOk` 只有 211ms / 944ms（輪詢完全正常、沒斷線），
 *   `sinceStateChange` 12.3s / 15.2s（伺服器盤面真的沒動）。原因很單純：**在等對方做開局選擇**。
 *   舊判準是「setup 期間盤面連續約 11.5 秒沒變」（3.5s 門檻 + 8s 節流 → 第 2 次 fire），
 *   而人類看揭示、選出場、放備戰本來就會超過 11.5 秒 ⇒ 判準太敏感，不是 bug。
 *   ⚠ 這種雜訊最大的傷害不是吵，是**把真訊號淹掉**：下次真的有人卡住，會埋在 118 筆裡找不到。
 *
 * 修法（保留原始意圖、只砍雜訊）：
 *   ・看門狗本身的自癒完全不動（仍是 setup 3.5 秒就強制重抓）—— 只改「要不要回報診斷」。
 *   ・只有「**我這邊還有動作沒做**」才算異常；已經做完在等對手，盤面不動是正常的。
 *   ・門檻拉到 60 秒（遠高於人類讀牌/選牌的時間），且每場只報一次。
 */
function _setupSelfPending(g: any, seat: number): string | null {
  if (!g || g.phase !== 'setup' || seat !== 0 && seat !== 1) return null;
  // ⭐⭐v6.158：「我還沒做」不等於「現在輪得到我做」。
  //   依 PTCG 規則，mulligan 【較多】方必須等較少方先放好戰鬥場、按下準備（引擎
  //   PLACE_ACTIVE 直接擋）—— 他的 setupDone 必然是 false，但那是【規則叫他等】，
  //   不是卡住。v6.155 只看 setupDone[我]===false 就回 'setup-not-done'，
  //   → 這一類全部變成假陽性（2026-08-10 賽事的 setup-watchdog-repeat 64 次/36 人含大量這種）。
  //   ⭐ 【只能有一份判準】：不在這裡再拄一份順序邏輯，一律問 setupActorSeat
  //   （它與伺服器 currentActorSeat 逐行同步）。-1 = 雙方都該動作 ⇒ 仍視為我有待辦。
  const _actor = setupActorSeat(g);
  if (_actor !== -1 && _actor !== seat) return null;
  // ⚠ 逐項都用「明確為真」判斷，欄位缺席（舊版伺服器/舊盤面）一律當成「沒有待辦」——
  //   fail-closed 到「不回報」，寧可漏報也不要製造新的雜訊。
  if (g.setupDone?.[seat] === false) return 'setup-not-done';
  if ((g.pendingMulliganDraw?.[seat] ?? 0) > 0) return 'mulligan-draw';
  if (g.mulliganRevealConfirmed?.[seat] === false) return 'reveal-not-confirmed';
  if (g.mulliganPostBenchOpen?.[seat] === true) return 'post-bench-open';
  return null;
}
  const T_API = '/api/tournament';
  const T_ROOM = 'TOURNAMENT-TEST';
  // ── Phase1-B：賽事狀態 ──
  let tEvents = $state<any[]>([]);   // 多賽事：開放中賽事清單（每場一張卡，各自報名）
  // ⭐⭐⭐v6.160 報到版本閘（灰度，伺服器 tournamentConfig.minClientVer 決定門檻）。
  //   ⚠ 空字串 ＝ 沒設定／伺服器是舊版沒有這個欄位 ⇒ `isClientTooOld` 解析不出來 ⇒ **不擋任何人**。
  //     這條 fail-open 是硬約束：把玩家擋在報到之外＝他打不了那場比賽。
  let tMinClientVer = $state('');
  let tVerModalEventId = $state('');   // 非空 ＝ 正在顯示「版本太舊」提示視窗（該場賽事 id）
  let tVerModalBusy = $state(false);
  // ⭐v6.167 報到失敗的訊息要**貼著報到鈕**顯示。大廳的 `tError` 只印在 main 最底下
  //   （in-flow 的 <p class="warn">，不是對戰分支那個 fixed 的 .tourn-toast），
  //   賽事卡一多就會捲出畫面 ⇒ 玩家按了報到、伺服器回 409，他看到的一樣是「按了沒反應」。
  let tCheckinErrId = $state('');   // 最後一次報到失敗的賽事 id（空字串＝沒有失敗）
  // ⭐⭐⭐v6.167「同一場賽事最多只擋一次」——**不依賴提示視窗有沒有被畫出來**的最後一道 fail-open。
  //   v6.160~v6.166 的事故就是：提示視窗被寫進「對戰中」那個版面分支（見模板上的 v6.167 註解），
  //   玩家在大廳按報到時它根本不存在 ⇒ 只看到「按了沒反應」，而且再按幾次都一樣 ＝ 被鎖在賽外。
  //   ⇒ 這個 Set 把最壞情況收斂成「白按一次」：第二次按下去一定會走到 tCheckinCommit。
  //   ⚠ 刻意用非響應式的 Set（不是 $state）：它只影響判定，不需要驅動任何畫面。
  //   ⚠ 只存在於這一次頁面生命週期；重載後可以再提示一次，這正是我們要的（重載＝版本可能已更新）。
  const _tVerPrompted = new Set<string>();
  let tRegFormEventId = $state('');  // 目前展開報名表單的賽事 id（點某場「報名」才展開）
  // ⭐⭐⭐v6.188 棄賽確認框。站長裁定：棄賽**不可逆**、不開放玩家自助反悔 ⇒ 唯一的保護就是這個確認框，
  //   所以「按鈕」與「真的送出」一定要是兩個不同的動作（tDropRequest 只開框、tDropCommit 才打 API）。
  let tDropConfirmEventId = $state('');
  // v5.629 玩家發起社群賽
  let tProposeOpen = $state(false);
  let tProposeName = $state('');
  let tProposeFormat = $state<'single-elim' | 'swiss'>('single-elim');
  let tProposeRally = $state(30);
  const tHasCommunityEvent = $derived(tEvents.some((e: any) => e.createdByPlayer));
  let tMe = $state<any>({ registered: false });
  // 多賽事：在任一開放賽事報名過即可發言/視為已參賽
  const tCanChat = $derived(!!firebaseUser?.email || tIsAdmin); // v5.920 後端 v0.68 已放寬:任何已登入者皆可聊天(不限報名)
  // v5.620：賽事分組——進行中/即將開始(checkin/running/bracket_ready/seeding)排上面、報名中/籌備中(registration/draft)排下面
  // v5.622：賽事卡依「開賽時間(registrationCloseAt)」由近到遠排序——越接近開賽排越上面。
  const _evStart = (e: any) => (e.registrationCloseAt ?? e.registrationOpenAt ?? Infinity);
  const _byStart = (a: any, b: any) => _evStart(a) - _evStart(b);
  const tRunningEvents = $derived(tEvents.filter((e: any) => e.status !== 'registration' && e.status !== 'draft').slice().sort(_byStart));
  const tUpcomingEvents = $derived(tEvents.filter((e: any) => e.status === 'registration' || e.status === 'draft').slice().sort(_byStart));
  let tIsAdmin = $state(false);
  let tEventPollTimer: ReturnType<typeof setInterval> | null = null;
  // ⭐⭐⭐v6.161 大廳（＝沒有在對戰的人）降頻用的狀態。判準一律取自**伺服器回來的賽事資料**，
  //   不看畫面狀態；而且每一項都 fail-open —— 判斷不出來就當作「在對戰」用正常頻率。
  let _tEventOkAt = 0;        // /event 最後一次**成功**回應的時刻（0＝從沒成功過 ⇒ 一律正常頻率）
  let _tLobbyResumeAt = 0;    // 最後一次「立刻恢復正常頻率」的時刻（輪次推進／回前景／剛進大廳）
  let _tTabHidden = false;    // 分頁在背景（visibilitychange 維護；回前景會立即強制同步）
  let _tLobbyEventAt = 0;     // 大廳輪詢三個端點各自的節奏錨點（時間判準，不用 v5.637 的輪數計數器）
  let _tLobbyChatAt = 0;
  let _tLobbyBracketAt = 0;
  let tTickTimer: ReturnType<typeof setInterval> | null = null; // v5.575 1秒tick平滑倒數
  let tClockOffset = $state(0);   // v5.575 伺服器時間 - 本機時間(對時，所有倒數用)
  let tChatClearedAt = $state(0); // v5.575 已知聊天清空時間(admin清空即時生效)
  // ── Phase1-C 大廳聊天 ──
  let tChat = $state<any[]>([]);
  let _tChatLoading = false;  // v5.624 tChatLoad 並發防護（見 tChatLoad）
  let tChatInput = $state('');
  let tChatLastTs = $state(0);
  let tChatHasMore = $state(false);  // v5.752 是否還有更舊訊息可載(往上滑續載)
  let _tChatLoadingOlder = false;   // v5.752 載更舊並發防護
  // ── Phase1-D 賽程（單敗淘汰）──
  let tBrackets = $state<any[]>([]);   // v5.937 所有進行中賽事的賽程(官方+社群並行);每個 { event, matches(含roomId), standings }
  // ⭐⭐⭐v6.177 賽程/排名「這一份是沿用上一次好資料」的旗標 → 標題列掛一個小小的「· 更新中」，
  //   ⚠ 只加一個 inline <span>，不動版面高度（整區消失/版面跳動正是這一版要根治的症狀）。
  let tBracketsStale = $state(false);
  let _tBracketSeq = 0;              // v6.177 /bracket 代次：晚到的舊回應整發丟棄
  let _tBracketFailStreak = 0;       // v6.177 連續失敗次數（只在 0→1 那一次拉回正常頻率）
  // v6.177 賽程曾經成功載入過至少一次 ⇒ 空狀態要說「更新中」而不是「尚未產生」。
  let tBracketsEverOk = $state(false);
  let tLeaderboardStale = $state(false);
  let tProfileStale = $state(false);
  let tMyMatch = $state<any>(null);   // 我本輪可進行的對戰 { matchId, round, oppName }
  /**
   * ⭐v6.212 賽程「回到對戰」按鈕的保險。
   *   伺服器 /event 的 myMatch 已經濾掉 status==='done' 的場，正常情況打完就會消失；
   *   但只要伺服器把該場結算掉的那一步出了錯（對戰紀錄卡在 playing），這個按鈕就會一直在，
   *   玩家會以為還要回去打。賽程表本身已經標了勝負 ⇒ 用它當第二來源交叉檢查。
   *   ⚠ 只在「賽程表確實載到、而且明確標成已完成」時才隱藏；賽程沒載到一律照畫
   *     （進場按鈕消失會直接吃未進場判負，v5.937 已經踩過一次）。
   */
  function tMatchAlreadyDone(brk: any, mm: any): boolean {
    if (!brk || !mm) return false;
    const ms = brk.matches;
    if (!Array.isArray(ms)) return false;
    return ms.some((m: any) => m && m.mine === true && m.round === mm.round && m.status === 'done');
  }
  let tMyBye = $state<any>(null);     // v5.935 我本輪輪空 { round, enterOpenAt }(輪空者也看倒數+可觀戰提示)
  let isTReplay = $state(false);         // v5.939 對戰回放模式
  let tReplay = $state<any>(null);       // { meta, finalLog, finalState, snapshots }
  let tReplayStep = $state(0);
  // ⭐⭐⭐v6.177 賽程有可能是「上一份好資料」（/bracket 這一發失敗時沿用）⇒ **輪次號碼一律以
  //   /event 的值為準**：/event 是每 3 秒更新的伺服器權威來源，而且 tEvents 只會被成功回應改寫。
  //   少了這條，連續抓不到 /bracket 時畫面會停在舊輪、還把舊輪標成「進行中」——
  //   那正是「保留舊資料反而誤導玩家」的具體形式（Fable 5 審查點名）。
  function liveRoundOf(brk: any): number {
    const id = brk && brk.event && brk.event._id;
    const ev = id ? tEvents.find((e: any) => e && e._id === id) : null;
    if (ev && typeof ev.currentRound === 'number') return ev.currentRound;
    return (brk && brk.event && brk.event.currentRound) ?? 1;
  }
  // ⭐v6.177 排名表的穩定 key：舊寫法 `(s.name + '_' + s.rank)` 把**每輪都會變的 rank 寫進 key**，
  //   結算一洗牌所有 key 全變 ⇒ 整張排名表被拆掉重建（＝玩家看到的另一半「閃一下」）。
  //   改用玩家名當身分；同名玩家用出現序後綴保證唯一（重複 key 會讓 Svelte 直接拋 each_key_duplicate）。
  function standingsKeyed(rows: any[]): any[] {
    const seen = new Map<string, number>();
    return (rows ?? []).map((r: any) => {
      const nm = String((r && r.name) ?? '');
      const n = (seen.get(nm) ?? 0) + 1; seen.set(nm, n);
      return { ...r, _k: n === 1 ? nm : nm + '#' + n };
    });
  }
  // v5.937 賽程翻頁改 per-event(多賽事並存):存 {round,page};pageOf 判存的 round≠currentRound 即視為未設→跳當前輪(免 $effect/舊 hack)。
  let tBracketPages = $state<Record<string, { round: number; page: number }>>({});
  function pageOf(brk: any, rounds: number): number {
    const cur = liveRoundOf(brk);
    const st = tBracketPages[brk?.event?._id];
    const p = (st && st.round === cur) ? st.page : cur;
    return Math.min(Math.max(1, p), rounds);
  }
  function setBracketPage(brk: any, page: number) {
    const cur = liveRoundOf(brk);   // v6.177 必須與 pageOf 用同一個輪次來源，否則存進去的頁碼立刻失效
    tBracketPages = { ...tBracketPages, [brk.event._id]: { round: cur, page } };
  }
  let tActiveRoom = $state('TOURNAMENT-TEST'); // 目前對戰房（測試房=固定；正式賽=各場 mr_<matchId>）
  // v5.585 跨房提醒：在「一般對戰」中也輪詢錦標賽「我的對戰」，可入場時跳頂部橫幅
  let tAlertEvent = $state<any>(null);
  let tAlertMatch = $state<any>(null);
  let tAlertOffset = $state(0);
  let tAlertNow = $state(0);
  let tAlertDismissedId = $state('');
  let tAlertPollTimer: ReturnType<typeof setInterval> | null = null;
  let tAlertTickTimer: ReturnType<typeof setInterval> | null = null;
  const tAlertReady = $derived(
    !isTournament
    && !!tAlertMatch && !tAlertMatch.entered
    && tAlertMatch.matchId !== tAlertDismissedId
    && (tAlertMatch.enterOpenAt ?? Infinity) <= tAlertNow
  );
  $effect(() => {
    if (isTournament && firebaseUser && !firebaseUser.isAnonymous && tStep !== 'playing') {
      if (!tEventPollTimer) {
        // 首次進大廳：5 支全抓一次（即時顯示）
        tNow = Date.now() + tClockOffset; tournLoadEvent().then(() => tBracketLoad()); tChatLoad(); tChampionsLoad();
        // v5.637 降載：原本每 3s 同時打 5 支 API，大型錦標賽多人同時在大廳時把單一 node 進程打爆（事件迴圈尖峰→502）。
        //   常變的 /event /chat 維持 3s；/bracket /spectate 改每 3 tick(9s)；/champions（名人堂幾乎不變）只在進入大廳抓一次、不週期刷新（v5.647）。
        // ⭐⭐⭐v6.161 「沒有在對戰的人」降頻：base tick 仍是 3 秒，實際多久送一次改由中央述詞
        //   `tPollDesiredMs(false, 'lobby')` 決定（v5.637 的 `_tPollTick % 3` 是輪數計數器，
        //   節奏一變就漂移——v6.148 在對戰端已經踩過同一個坑，這裡改成同一套時間判準）。
        //   ⚠ `- 100` 是 setInterval 抖動的容差：沒有它的話，3050ms 的 tick 會讓「正常頻率」
        //     每次都晚一整拍（3 秒變 6 秒），等於把快要上場的人也一起降頻了。
        _tLobbyResumeAt = Date.now();   // 剛進大廳的 60 秒一律正常頻率（進場鈕與倒數都在這段出現）
        _tLobbyEventAt = Date.now(); _tLobbyChatAt = Date.now(); _tLobbyBracketAt = Date.now();
        tEventPollTimer = setInterval(() => {
          tNow = Date.now() + tClockOffset;
          const _now = Date.now();
          // ⚠⚠ 牆鐘被往回校（NTP／使用者改系統時間）會讓 `_now - 錨點` 變成負數 ⇒ 三個端點
          //   一起停發，最壞停到牆鐘追上來為止（可能好幾分鐘）—— 那真的會害人被判未進場。
          //   舊版每個 tick 無條件送、沒有這個弱點，所以這裡明確補回來：任一錨點跑到「未來」
          //   就當作時鐘被動過，走 tLobbyResume() 重錨（fail-open：寧可多送一發）。
          if (_tLobbyEventAt > _now || _tLobbyChatAt > _now || _tLobbyBracketAt > _now) tLobbyResume();
          const _evMs = tPollDesiredMs(false, 'lobby');
          const _brMs = _evMs * 3;   // /bracket 一向是 /event 的 1/3（v5.637），維持這個比例
          if (_now - _tLobbyEventAt >= _evMs - 100) { _tLobbyEventAt = _now; tournLoadEvent(); }
          if (_now - _tLobbyChatAt >= _evMs - 100) { _tLobbyChatAt = _now; tChatLoad(); }
          if (_now - _tLobbyBracketAt >= _brMs - 100) { _tLobbyBracketAt = _now; tBracketLoad(); }
          // v5.647 降載：名人堂(/champions)移出輪詢——冠軍只在賽事結束才變,週期刷新無意義;
          //   只在「進入/重入錦標賽大廳」初始那次抓(上方首抓已有 tChampionsLoad()),降低 Oracle 負擔。
        }, 3000);
      }
    } else if (tEventPollTimer) { clearInterval(tEventPollTimer); tEventPollTimer = null; }
  });
  // v5.575：1 秒 tick 平滑倒數（用伺服器對時 tClockOffset，所有倒數對齊伺服器時間）；hub + 對戰中都跑
  $effect(() => {
    if (isTournament) {
      if (!tTickTimer) tTickTimer = setInterval(() => {
        tNow = Date.now() + tClockOffset;
        notifyScan([], tMyMatch, tNow);   // v6.022 進場時間一到就通知（去重保證只發一次）
        // v5.591 輪詢看門狗：對戰中若輪詢停擺(>6s 沒成功回應)→ 重啟輪詢，避免 client 卡在舊狀態
        //   (看不到對手 KO 我方 → 無法換新戰鬥位 → 被閒置判敗)。伺服器權威，重抓永遠安全。
        // v6.146 對戰已結束 → 盤面不會再動，這條「自癒」沒有對象，只是每 6 秒白抓一份全量 gameState。
        const _tOver = !!game && (game as any).phase === 'game-over';
        // ⚠v6.152 長輪詢在途時**不算停擺** —— 那一發本來就會掛在伺服器最多 25 秒，
        //   6 秒沒回應是正常的。若真的黑洞，30 秒逾時後 _tLongPollAt 歸零，這條看門狗自動恢復。
        const _lpInFlight = _tLongPollAt > 0 && (Date.now() - _tLongPollAt) < T_LP_CLIENT_TIMEOUT_MS;
        if (tStep === 'playing' && game && !_tOver && !isTournSpectator && _tLastPollOkAt > 0 && !_lpInFlight
            && (Date.now() - _tLastPollOkAt) > 6000 && (Date.now() - _tPollStallGuardAt) > 6000) {
          _tPollStallGuardAt = Date.now();  // v6.149 只節流，**不**動 _tLastPollOkAt（見宣告處）
          // v5.593 輪詢停擺 → 立即強制重抓最新狀態並「強制採用」(伺服器權威，繞過版本檢查) + 重啟輪詢，
          //   治「第一隻昏厥後 client 沒收到 active=空 → 無法換場 → 閒置判敗」型卡住，最多 6~7 秒自動恢復。
          (async () => {
            // ⭐v6.180 同 tForceResync：這一發與主輪詢並行 ⇒ 需要 expectV 才分得出亂序；
            //   另外要帶代次/房間快照，否則離場後晚到的回應會把人彈回已結束的對戰。
            const _rv = tVersion, _rGen = tPollGen, _rRoom = tActiveRoom;
            try {
              const fr = await tApi(`/state?room=${tActiveRoom}&v=-1`);
              if (_rGen !== tPollGen || _rRoom !== tActiveRoom) return;   // 已離開對戰／換房 ⇒ 作廢
              // ⭐⭐v6.149（Fable 5 審查）：救援成功也是**貨真價實的伺服器回應**，必須算進存活。
              //   否則 RTT 持續 ≥6 秒時形成活鎖：看門狗每 6 秒 ++tPollGen，在途 poll 全被
              //   `gen !== tPollGen` 丟棄而不記存活 ⇒ _tLastPollOkAt 永遠不前進 ⇒
              //   橫幅一直爬升、每 6 秒再送一發 v=-1 全量（失聯時反而加重）。
              if (fr) _tLastPollOkAt = Date.now();
              // ⭐⭐⭐v6.180 原本是 `game = fr.gameState` **完全沒有版本判斷**（也沒有 ensurePoolForStateIds、
              //   沒有 shareStateIdentity）。救援的本意是「本地領先型卡死 ⇒ 伺服器權威回正」，
              //   那正好就是中央閘的 `client-ahead`（`expectV === tVersion` ⇒ 從送出到現在本地沒採納過東西）
              //   ⇒ 治卡死的能力一點都沒少，但晚到的舊盤面不再把畫面拖回上一步。
              if (fr && fr.gameState) tAdopt(fr.gameState, fr.version, { expectV: _rv, reason: 'poll-stall' });
              if (fr && typeof fr.serverNow === 'number') tClockOffset = fr.serverNow - Date.now();
              if (fr && typeof fr.lastActionAt === 'number') tLastActionAt = fr.lastActionAt;
            } catch { /* ignore */ }
          })();
          startTournamentPoll();
        }
        // ⭐⭐v6.172 長輪詢黑洞探針（見 _tConnProbeAt 宣告處）。
        //   ⚠ 刻意**不採納**回應的盤面：它只是「連線還通不通」的探針，盤面一律讓長輪詢/看門狗處理。
        if (tStep === 'playing' && game && !_tOver && !isTournSpectator && _tLongPollAt > 0
            && _tLastServerOkAt > 0 && (Date.now() - _tLastServerOkAt) > T_CONN_PROBE_AFTER_MS
            && (Date.now() - _tConnProbeAt) > T_CONN_PROBE_THROTTLE_MS) {
          _tConnProbeAt = Date.now();
          (async () => {
            try { await tApi(`/state?room=${tActiveRoom}&v=${tVersion}`, undefined, { timeoutMs: 5000 }); }
            catch { _tLpHangUntil = 0; }   // 探針也不通 ⇒ 掛起窗不再是「可能還會成功」的理由
          })();
        }
        // v5.618 新鮮度看門狗：對戰/setup 中盤面 >8s 沒任何更新（poll 成功卻漏接/版本卡住，如「對手補抽放置完成後我方手牌沒亮」）
        //   → 強制重抓伺服器權威最新盤面。涵蓋 setup（tStep 一有 gameState 即 playing）。gate：我方 picker 進行中不擾動；節流 8s。
        // v6.151：playing 的保險由 8s 放寬到 20s。這一發是**單發成本最大**的（每次都是整份
        //   `v=-1` 全量盤面），而輪詢本身的版本比對已經涵蓋「漏接」自癒 —— 這條只是最後的保險網。
        //   setup 維持 3.5s（那裡是歷史事故最密集的區段，而且盤面小）。
        const _freshStaleMs = (game && game.phase === 'setup') ? 3500 : 20000;
        //   ⚠⚠ v6.146：原本**沒有排除 game-over**。tForceResync 末尾是無條件把 _tLastStateChangeAt
        //     推到現在，於是對戰結束後形成「8 秒 stale → 抓一次 v=-1 全量盤面 → 重設計時 → 再 8 秒」
        //     的無限迴圈，而且每次還會 startTournamentPoll() 重建 timer。這就是伺服器 log 裡
        //     週期性出現的 4~5KB `?v=-1` 請求的來源（不是玩家在按 F5）。
        //   ⭐⭐v6.155（Fable 5 最終審查）：**長輪詢在途時這條保險網必須整條停用**。
        //     長輪詢的語意就是「盤面一變伺服器立刻回」，所以「20 秒沒更新」在長輪詢模式下
        //     是**對手在長考**的正常狀態，不是漏接。沒有這個守衛會有三個後果：
        //     ① 每 20 秒白抓一份 `v=-1` 全量盤面 —— 正好抵銷長輪詢要省的那筆流量；
        //     ② 順帶的 startTournamentPoll() 會 ++tPollGen，把**掛在伺服器上、對手一動就會回**
        //        的那一發長輪詢回應判為過期丟棄 ⇒ 對手第 21 秒動作時反而多等一個 RTT；
        //     ③ 最糟的是 `_freshWatchdogFires` 會累加到 3 而 tVersion 沒動 ⇒ 誤發
        //        `stale-version` 診斷指紋。那個指紋是站長在 admin 監控分頁用來判讀
        //        「版本是不是真的卡住」的訊號，被長考誤報淹掉就再也讀不出真的卡住。
        if (tStep === 'playing' && game && !_tOver && !isTournSpectator && !_lpInFlight
            && _tLastStateChangeAt > 0 && (Date.now() - _tLastStateChangeAt) > _freshStaleMs
            && (Date.now() - _tLastForceResyncAt) > 8000
            && !tInFlight   // v6.137 動作送出中不強制重抓：會把本地預測畫面倒回，伺服器回應到達後又前進＝閃爍
            && !(game.pendingSelection && game.pendingSelection.actorIdx === mySeatIdx)) {
          _tLastForceResyncAt = Date.now();
          _freshWatchdogFires++;  // v5.933 連續觸發計數
          if (_freshWatchdogFires === 1) _freshWatchdogVersionAt = tVersion;
          // ⭐⭐v6.155 setup 指紋收斂（見 _setupSelfPending 的註解）：
          //   舊判準「連續觸發 2 次」＝盤面約 11.5 秒沒變就報 ⇒ 118 次 / 59 人 的雜訊。
          //   新判準：①我這邊確實還有動作沒做（純等對手不算異常）②盤面 60 秒沒動 ③每場只報一次。
          if (!_setupDiagSent && game && game.phase === 'setup'
              && _setupSelfPending(game, mySeatIdx) !== null
              && (Date.now() - _tLastStateChangeAt) > 60000) {
            _setupDiagSent = true;
            _tSendClientDiag('setup-watchdog-repeat');
          }
          // ⭐v6.151 新增 stale-version 指紋：**playing 階段的版本卡住**原本不屬於任何現有診斷
          //   指紋，什麼都不會回傳（v6.149 事故就是這一類，只能靠玩家口述還原）。
          //   判準＝看門狗連續觸發 3 次、而 tVersion 一步都沒有前進。
          //   ⭐⭐v6.158：舊判準（連續觸發 3 次）實際只代表【盤面 36 秒沒動】（20s 門檻 + 8s 節流 × 2）——
  //     對手長考 40 秒本來就超過它，而且雙方的 client 會各報一次。2026-08-10 賽事 75 次/33 人
  //     就是這個量級。門檻拉齊 v6.155 的 setup 指紋（60 秒），並在 payload 補上
  //     `sinceLastAction` / `srvActor`，下一場才分得出「對手在長考」與「真的卡住」。
          // ⭐⭐⭐v6.198 再加一道**送出**判準（見 $lib/tournament/stale-diag）。
          //   用 2026-08-16 的 7 天 dump 逐筆回放：舊判準 407 筆／93 人裡約 89% 是
          //   「對手在長考」「自己在長考」這種正常等待 —— 站長要判讀的真訊號被淹掉。
          //   新判準三取一（前景卻輪詢不通／伺服器動過我沒跟上／誰該動作雙方認知分岔），
          //   同一份 dump 回放後剩 43 筆／25 人。
          // ⚠⚠ 收緊的**只有送不送診斷**：下面兩行自癒（強制重抓 ＋ 重建輪詢）刻意留在
          //   這個 if 之外、無條件執行 —— 判準再嚴都不會讓任何一台卡住的畫面失去自救。
          if (_freshWatchdogFires >= 3 && game && game.phase === 'playing' && tVersion === _freshWatchdogVersionAt
              && (Date.now() - _tLastStateChangeAt) > 60000
              && _staleDiagVersion !== tVersion) {
            const _why = _staleVersionWhyNow();
            // ⚠ 不成立時**不**設 _staleDiagVersion —— 條件 (a) 會隨時間累積，
            //   同一個卡住的版本稍後若真的惡化成「輪詢不通」仍然報得出來。
            if (_why) { _staleDiagVersion = tVersion; _staleDiagWhy = _why; _tSendClientDiag('stale-version'); }
          }
          tForceResync();
          startTournamentPoll();
        }
        // v5.933 隱形手牌指紋偵測(v5.932 已修根因,此為確認+未來防護):手牌有卡卻一張都不可見+arriving 殘留 → 回傳一次診斷
        if (tStep === 'playing' && game && !isTournSpectator && !_invisibleHandDiagSent && arrivingIids.size > 0) {
          const _hl = game.players?.[mySeatIdx]?.hand?.length ?? 0;
          if (_hl > 0) {
            // v6.155 ⚠ 原本只認桌機的 .hand-strip .hand-card —— 手機直式用的是 .mp-hand-card，
            //   於是手機上這個數字**恆為 0**，害 invisible-hand 在手機端形同無條件成立、
            //   也讓 setup 診斷 payload 裡的 visHand 在手機上完全不能當證據。
            let _vis = -1; try { _vis = _countVisibleHandCards(); } catch { /* */ }
            if (_vis === 0) { _invisibleHandDiagSent = true; _tSendClientDiag('invisible-hand'); }
          }
        }
      }, 1000);
    } else if (tTickTimer) { clearInterval(tTickTimer); tTickTimer = null; }
  });
  // v5.585 跨房提醒輪詢：非錦標賽頁 + 已登入(非匿名) → 每 60 秒(v6.217④ 原 30 秒)查一次我的錦標賽對戰，1 秒 tick 算倒數
  $effect(() => {
    if (!isTournament && firebaseUser && !firebaseUser.isAnonymous) {
      if (!tAlertPollTimer) {
        const poll = async () => {
          try {
            const r = await tApi('/event');
            tAlertEvent = r?.event ?? null;
            tAlertMatch = r?.myMatch ?? null;
            if (r?.serverNow) tAlertOffset = r.serverNow - Date.now();
            notifyScan(r?.events ?? [], tAlertMatch, Date.now() + tAlertOffset);   // v6.022 人在其他頁也能收到
          } catch { /* 未登入錦標賽 / 無賽事 / 網路 → 略過，不影響一般對戰 */ }
        };
        poll();
        // ⭐v6.217④ 30000 → 60000:這條是「人在一般對戰頁時的錦標賽進場提醒」備援輪詢,
        //   主通道是 Web Push(v0.85「本輪可進場」)+進錦標賽頁的 /event 3 秒輪詢。
        //   最壞多等 60 秒才發現新對戰,而未進場容許窗硬地板是 2 分鐘(v6.214 NOSHOW_FLOOR_MIN)
        //   且預設 3~5 分鐘 ⇒ 不可能因此被判未進場。全站每位掛在一般頁的登入者少打一半 /event。
        tAlertPollTimer = setInterval(poll, 60000);
        tAlertTickTimer = setInterval(() => {
          tAlertNow = Date.now() + tAlertOffset;
          notifyScan([], tAlertMatch, tAlertNow);   // v6.022 進場時間一到就通知（去重保證只發一次）
        }, 1000);
      }
    } else {
      if (tAlertPollTimer) { clearInterval(tAlertPollTimer); tAlertPollTimer = null; }
      if (tAlertTickTimer) { clearInterval(tAlertTickTimer); tAlertTickTimer = null; }
      tAlertMatch = null; tAlertEvent = null;
    }
  });
  // v5.585 倒數格式化：>1天顯示「X 天 HH:MM:SS」，否則 HH:MM:SS
  function fmtCountdown(ms: number): string {
    if (!ms || ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (n: number) => String(n).padStart(2, '0');
    return (d > 0 ? d + ' 天 ' : '') + p(h) + ':' + p(m) + ':' + p(sec);
  }
  function tPlayerId(): string {
    // v0.5 A1：登入帳號 → 用 firebase uid 當身分（與伺服器 verifyIdToken 回傳的 uid 一致）
    if (firebaseUser && !firebaseUser.isAnonymous) return firebaseUser.uid;
    try {
      let id = localStorage.getItem('ptcg_tourn_pid');
      if (!id) { id = 'p_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('ptcg_tourn_pid', id); }
      return id;
    } catch { return 'p_' + Math.random().toString(36).slice(2, 10); }
  }

  // ── 遊戲狀態 ────────────────────────────────────────────────────────────────
  // v5.068：對戰 log 時間戳 — 顯示「[mm:ss] 訊息」相對對戰開始時間
  //   來源：玩家建議。例：「[00:30] AI 對手 將能量附加到 斯魔茶」
  //   gameStartTime 由 engine.ts 在 setup→playing transition 設（v4.24）；
  //   timestamp 由 addLog 在 LogEntry 創建時記（v5.068）。
  //   兩者皆為 epoch 毫秒；若任一未設則 fallback 空字串（setup 階段 / 舊 save 不顯示）。
  function formatLogTime(entry: { timestamp?: number }, gameStartTime: number | undefined): string {
    if (!entry.timestamp || !gameStartTime) return '';
    const elapsedMs = entry.timestamp - gameStartTime;
    if (elapsedMs < 0) return '';
    const totalSec = Math.floor(elapsedMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return `[${mm}:${ss}]`;
  }

  let game = $state<GameState | null>(null);

  // ⭐⭐⭐v6.214【①】「我剛剛在看的那一局」——用來分辨「重整後想看終局盤」與「跳回舊局」。
  //   站長回報：早就結束的對局會突然跳回去。真因是 sync-guards 第 9 步無條件 adopt
  //   （上面每一條守衛都是 `if (local && …)`，本地 game===null 時全部落空）。
  //   ⚠ 用 **sessionStorage** 而不是 localStorage：語義剛好就是我們要的分界 ——
  //     同一個分頁重新整理會留著（＝玩家想看終局盤），關掉分頁／換分頁就沒有（＝不該跳回去）。
  //   ⚠ 另外加一個時間上限：同一個分頁裡離開對戰頁再回來（SPA 導覽，元件重新掛載）時
  //     sessionStorage 還在，只靠 id 會又被拉回終局盤。TTL 用的是**同一台裝置自己的**
  //     Date.now() 差值 —— v6.198 實證的時鐘偏差是「跨玩家」比較才會出事，
  //     同一顆時鐘算 elapsed 不受影響。
  //   ⚠ 讀寫都包 try/catch：無痕模式／配額滿會 throw，那時退化成「不記得」＝更保守
  //     （不會多採納任何一局），絕不讓它把對戰頁打掛。
  const ACTIVE_GAME_KEY = 'ptcg:activeGameId';
  const ACTIVE_GAME_TTL_MS = 5 * 60 * 1000;
  function _readActiveGameId(): string | null {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const raw = sessionStorage.getItem(ACTIVE_GAME_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.id !== 'string' || typeof o.at !== 'number') return null;
      if (!(Date.now() - o.at <= ACTIVE_GAME_TTL_MS)) return null;   // NaN 也會落到這裡＝視為沒有
      return o.id;
    } catch { return null; }
  }
  let _activeGameId: string | null = _readActiveGameId();
  // ⚠⚠ 「元件剛掛載、還沒收到任何盤面」與「玩家真的回大廳了」必須分得出來：
  //   前者 game 也是 null，但那時**不可以**清掉記憶（清了就等於重整後看不到終局盤）。
  let _seenGameOnce = false;
  function _noteActiveGame(g: GameState | null): void {
    if (!g) {
      if (!_seenGameOnce) return;      // 還沒有過盤面 → 保留重整前的記憶
      _activeGameId = null;
      try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(ACTIVE_GAME_KEY); } catch { /* 忽略 */ }
      return;
    }
    _seenGameOnce = true;
    _activeGameId = g.id;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify({ id: g.id, at: Date.now() }));
      }
    } catch { /* 忽略 */ }
  }
  // ⚠ 用 $effect 當**單一接線點**：game 在本檔有數十處賦值，逐一手動呼叫必定漏接
  //   （而漏接的症狀就是「偶爾又跳回舊局」，跟原本的 bug 長得一模一樣、查不出來）。
  $effect(() => { _noteActiveGame(game); });

  // v5.478 系統管理員廣播：開戰讀一次 config/broadcast；game.turn 命中設定回合 → 上方跑馬燈跑一輪。
  //   beta+正式站都讀同一份 Firestore；純前端顯示、不經同步層（兩端各自獨立顯示，無 desync 風險）。
  let broadcastCfg = $state<BroadcastConfig | null>(null);
  let broadcastMarquee = $state('');   // 當前跑馬燈文字（'' = 不顯示）
  let broadcastIsCommunity = $state(false);  // v5.632 true=玩家社群賽募集(綠底)、false=管理員廣播(紫粉底)
  // v5.633 跑馬燈時長依「螢幕寬度 + 文字長度」算，目標固定速度(~90px/s)→ 手機/桌面速度一致(手機不再過慢)；
  //   隱藏計時器 = 此時長(+緩衝)，讓整段文字跑完離開螢幕才自然消失(不再跑到一半被砍)。
  let broadcastMarqueeDur = $state(18);
  function marqueeDur(text: string): number {
    const vw = (typeof window !== 'undefined') ? window.innerWidth : 1000;
    const textPx = (text?.length ?? 0) * 16;  // CJK 每字約 16px 估算
    return Math.max(8, Math.round((vw + textPx) / 90));  // 速度 ~90px/s（值越小越慢）
  }
  let broadcastKey = $state(0);        // 強制重播動畫
  let _bcLoadedGameId = '';
  let _bcShownTurns = new Set<number>();
  let _bcHideTimer: ReturnType<typeof setTimeout> | null = null;
  let _commRallyShownGameId = '';  // v5.631 一般對戰第2回合社群賽募集跑馬燈（每局只查一次）
  // 新對局（game.id 變）→ 載入廣播設定 + 重置已顯示回合
  //   v5.482：只有「線上對戰」才讀廣播（本機雙人 / vs AI 練習不碰 Firebase，再省讀取量）。
  $effect(() => {
    const gid = game?.id ?? '';
    if (!gid || gid === _bcLoadedGameId) return;
    _bcLoadedGameId = gid;
    _bcShownTurns = new Set();
    broadcastCfg = null;
    if (mode !== 'online') return;  // 單機/AI 模式不讀廣播
    getBroadcastConfig().then((cfg) => { broadcastCfg = cfg; }).catch(() => { /* 容錯 */ });
  });
  // game.turn 命中設定回合 → 顯示跑馬燈（config 非同步載入完也會 re-run，補上 turn 1）
  $effect(() => {
    const t = game?.turn;
    const cfg = broadcastCfg;
    if (!game || game.phase !== 'playing' || t == null || !cfg?.enabled || !cfg.text) return;
    if (!cfg.turns.includes(t) || _bcShownTurns.has(t)) return;
    _bcShownTurns.add(t);
    broadcastMarquee = cfg.text;
    broadcastIsCommunity = false;
    broadcastMarqueeDur = marqueeDur(cfg.text);
    broadcastKey++;
    if (_bcHideTimer) clearTimeout(_bcHideTimer);
    _bcHideTimer = setTimeout(() => { broadcastMarquee = ''; }, broadcastMarqueeDur * 1000 + 600);
  });
  // v5.631 一般線上對戰第 2 回合 → 若有「募集中的玩家社群賽」自動跑馬燈宣傳（鼓勵報名）。
  //   只在 online 一般對戰(非錦標賽)、每局查一次；查 /event 找 createdByPlayer 且 registration 的賽事。
  $effect(() => {
    const t = game?.turn;
    if (!game || game.phase !== 'playing' || isTournament || mode !== 'online') return;
    if (t == null || t < 2 || _commRallyShownGameId === game.id) return;
    _commRallyShownGameId = game.id;
    (async () => {
      try {
        const r = await tApi('/event');
        const ev = (r?.events ?? []).find((e: any) => e.createdByPlayer && e.status === 'registration');
        if (ev && !broadcastMarquee) {
          const d = ev.registrationCloseAt ? new Date(ev.registrationCloseAt) : null;
          const hhmm = d ? (String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')) : '';
          broadcastMarquee = `📣【${ev.proposerName || '玩家'}】發起【${ev.name}】之社群賽，截止時間為 ${hhmm}，歡迎大家到錦標賽頁面報名參加！`;
          broadcastIsCommunity = true;
          broadcastMarqueeDur = marqueeDur(broadcastMarquee);
          broadcastKey++;
          if (_bcHideTimer) clearTimeout(_bcHideTimer);
          _bcHideTimer = setTimeout(() => { broadcastMarquee = ''; }, broadcastMarqueeDur * 1000 + 600);
        }
      } catch { /* 未登入/無權限 → 不顯示，容錯 */ }
    })();
  });

  // ── 模式：null=未選、local=本機、online=線上 ────────────────────────────────
  let mode = $state<'local' | 'online' | null>(null);

  // ── 本機 Lobby ───────────────────────────────────────────────────────────────
  let p1DeckId = $state('');
  let p2DeckId = $state('');
  let p1Name = $state('玩家 1');
  // v5.005 admin matchRecords — 防同場多次 fire POST /api/match-result
  let recordedMatchId = $state<string | null>(null);

  // v5.009 桌墊版 layout 切換（opt-in，預設 classic）— 仿實體 TCG 對戰版面
  //   classic = 現有左對齊 active；tabletop = active 置中 + bench 對稱列
  //   localStorage 'ptcg_battle_layout' 跨 session 記憶；只動桌機
  //   v5.011：選項整合到既有 showSettingsModal 面板，移除獨立 popup
  let battleLayout = $state<'classic' | 'tabletop' | 'fable'>('classic');
  function setBattleLayout(v: 'classic' | 'tabletop' | 'fable'): void {
    battleLayout = v;
    try { localStorage.setItem('ptcg_battle_layout', v); } catch { /* quota ignore */ }
    recomputeZoom();
  }
  // v5.012：桌墊版 battle log side panel toggle（可關閉），localStorage 記憶
  let battleLogOpen = $state<boolean>(true);
  function toggleBattleLog(): void {
    battleLogOpen = !battleLogOpen;
    try { localStorage.setItem('ptcg_battle_log_open', battleLogOpen ? '1' : '0'); } catch { /* ignore */ }
  }
  // fable 版卡牌大小 slider（0.7~1.4）— 只有 .playmat.layout-fable CSS 讀 --card-scale
  let fableCardScale = $state(1);
  function setFableCardScale(v: number): void {
    if (!Number.isFinite(v)) return;
    fableCardScale = Math.min(1.4, Math.max(0.7, v));
    try { localStorage.setItem('ptcg_fable_card_scale', String(fableCardScale)); } catch { /* ignore */ }
  }
  // v5.051: 預組永遠顯示在下拉內（移除 toggle） — Android Chrome 對動態 {#if} optgroup 有 bug
  let p2Name = $state('AI 對手');
  // v3.75：本機/AI 模式先後攻偏好（贏擲幣時生效；AI 模式直接生效）
  let p1FirstPref = $state<'random' | 'first' | 'second' | 'opponent'>(_readLastFirstPref());
  let p2FirstPref = $state<'random' | 'first' | 'second' | 'opponent'>('random');
  // v5.476：本機/我方先後攻偏好變更時持久化（線上由 seat radio onchange 存）
  $effect(() => { _saveFirstPref(p1FirstPref); });
  /** AI 控制哪個玩家（null = 無 AI） */
  let aiPlayerIndex = $state<0 | 1 | null>(1);
  /** AI 是否正在思考（防止連擊） */
  let aiThinking = $state(false);

  // v4.74 練習模式 — 悔棋 1 步（AI 對戰專用）
  // 在玩家「主要 action」前 snapshot 上一手 state；END_TURN 時清空（不能跨手）。
  // AI 自己的 action 不 snapshot（fromAI flag 跳過）。連線對戰 v4.75 再做。
  let undoSnapshot = $state<GameState | null>(null);
  const UNDOABLE_ACTIONS = new Set<string>([
    'ATTACK', 'EVOLVE', 'PLAY_TRAINER', 'PLAY_BASIC', 'PLAY_FOSSIL',
    'ATTACH_ENERGY', 'RETREAT', 'USE_ABILITY',
  ]);
  // v4.75 連線練習模式悔棋 — 4 個額外 state
  let undoActionDesc = $state<string | null>(null);        // 描述上一手做什麼（給對手 modal 看）
  let undoDeniedThisSnapshot = $state(false);              // 對手拒絕後，這個 snapshot 的按鈕消失（直到下個 action）
  let lastSeenUndoApplyAt = 0;                            // v5.390 悔棋 rollback 一次性標記去重（>此值才套用 rollback）
  let lastAdoptedRestartCount = 0;                       // v5.716 phantom 防護：上次 adopt restart 重建 setup 局時的 restartProposalCount
  let undoAwaitingResponse = $state(false);                // 發起方等待對手回應中
  let roomAllowUndoInput = $state(false);                  // 開房表單 checkbox 狀態
  let roomPrivateInput = $state(false);                    // v5.003 私密房 checkbox 狀態（預設公開）
  let aiTimer: ReturnType<typeof setTimeout> | null = null;

  // v3.38：本機/AI lobby 牌組 60 張驗證 — UI gate（防止使用者選擇張數錯誤的牌組開戰）
  // 連線 lobby 已在 seat-area 內 derive hasValidDeck（L3078），此處補本機/AI 模式
  const p1DeckObj = $derived(allDecks.find(d => d.id === p1DeckId));
  const p2DeckObj = $derived(allDecks.find(d => d.id === p2DeckId));
  const p1DeckCount = $derived(p1DeckObj ? countDeckCards(p1DeckObj.entries) : 0);
  const p2DeckCount = $derived(p2DeckObj ? countDeckCards(p2DeckObj.entries) : 0);
  // v5.215：本機 lobby 牌組驗證加上 validateDeck 完整檢查（60 張 / 無 G 標 / ACE SPEC ≤1 /
  //   同名 ≤4 / ≥1 基礎寶可夢）。pool 還沒 load 完時 fallback 用 60 張簡易檢查避免 UI 卡按鈕。
  const p1DeckValid = $derived.by(() => {
    if (!p1DeckId || p1DeckCount !== 60) return false;
    if (!p1DeckObj || !deckEntriesAllInPool(p1DeckObj.entries, pool)) return p1DeckCount === 60;  // 該牌組卡包未載齊 → 走輕量檢查
    return validateDeck(p1DeckObj, pool).issues.length === 0;
  });
  const p2DeckValid = $derived.by(() => {
    if (!p2DeckId || p2DeckCount !== 60) return false;
    if (!p2DeckObj || !deckEntriesAllInPool(p2DeckObj.entries, pool)) return p2DeckCount === 60;
    return validateDeck(p2DeckObj, pool).issues.length === 0;
  });
  // v5.216：deck-count-info UI 用 — 判定是否有 G 標違規（依 validateDeck issue 字串「為 X 標」匹配）
  //   含 G/F/E 等任何非 H/I/J 標卡（剔除基本能量與 reprint exception 名單後）— 全部歸類「含 G 標」訊息
  const p1DeckHasIllegalMark = $derived.by(() => {
    if (!p1DeckObj || !deckEntriesAllInPool(p1DeckObj.entries, pool)) return false;
    return validateDeck(p1DeckObj, pool).issues.some(s => /為 [A-Z]+ 標/.test(s));
  });
  const p2DeckHasIllegalMark = $derived.by(() => {
    if (!p2DeckObj || !deckEntriesAllInPool(p2DeckObj.entries, pool)) return false;
    return validateDeck(p2DeckObj, pool).issues.some(s => /為 [A-Z]+ 標/.test(s));
  });

  // ── 線上模式狀態（v2.269 座位制重構） ──────────────────────────────────
  let myUid       = $state<string | null>(null);
  /** ⭐v6.197 Oracle 身分變動訂閱的解除函式（不解除 ⇒ 每次重進 /game 就多疊一個 listener） */
  let _unsubOracleUid: (() => void) | null = null;
  // v4.913 port 牌組編輯器的登入 dashboard 到模式選擇畫面
  let firebaseUser = $state<User | null>(null);
  let syncStatus = $state<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  let syncError = $state<string | null>(null);
  // Auth modal state
  let showAuthModal = $state(false);
  let authTab = $state<'upgrade' | 'login'>('upgrade');
  let authEmail = $state('');
  let authPassword = $state('');
  let authError = $state<string | null>(null);
  let authLoading = $state(false);
  let forgotMode = $state(false);
  let resetEmailSent = $state(false);
  // Change-password modal state
  let showChangePasswordModal = $state(false);
  let cpOldPassword = $state('');
  let cpNewPassword = $state('');
  let cpNewPasswordConfirm = $state('');
  let cpError = $state<string | null>(null);
  let cpSuccess = $state(false);
  let cpLoading = $state(false);
  const isAnonymous = $derived(firebaseUser?.isAnonymous ?? true);
  // v5.476：先後攻偏好 + 對手閒置判定時間 的記憶（採上次設定，玩家不用每次調）
  function _readLastFirstPref(): 'random' | 'first' | 'second' | 'opponent' {
    try { const v = localStorage.getItem('ptcg-tw-sim:lastFirstPref'); return (v === 'first' || v === 'second' || v === 'opponent' || v === 'random') ? v : 'random'; } catch { return 'random'; }
  }
  function _saveFirstPref(p: string) { try { localStorage.setItem('ptcg-tw-sim:lastFirstPref', p); } catch { /* ignore */ } }
  function _readLastIdle(): number {
    try { const v = Number(localStorage.getItem('ptcg-tw-sim:lastIdleTimeout')); return (v >= 60 && v <= 300) ? (Math.round(v / 30) * 30) : 180; } catch { return 180; }
  }
  function _saveIdle(s: number) { try { localStorage.setItem('ptcg-tw-sim:lastIdleTimeout', String(s)); } catch { /* ignore */ } }
  // v5.311: 載入上次的玩家名稱 / 房間名稱 (localStorage), 玩家不用每次重打
  const _lastMyName = (() => { try { return typeof localStorage !== 'undefined' ? (localStorage.getItem('ptcg-tw-sim:lastMyName') ?? '') : ''; } catch { return ''; } })();
  const _lastRoomName = (() => { try { return typeof localStorage !== 'undefined' ? (localStorage.getItem('ptcg-tw-sim:lastRoomName') ?? '') : ''; } catch { return ''; } })();
  let myName      = $state(_lastMyName);
  let myDeckId    = $state('');           // 在房間內選牌組用
  let roomNameInput = $state(_lastRoomName);  // v5.311: 預設沿用上次房間名
  // v5.311: 自動把當前玩家名/房間名持久化 (玩家編輯後立刻存, 不需點按鈕)
  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      if (myName) localStorage.setItem('ptcg-tw-sim:lastMyName', myName);
      if (roomNameInput) localStorage.setItem('ptcg-tw-sim:lastRoomName', roomNameInput);
    } catch { /* localStorage 滿 / 隱私模式 — 略過 */ }
  });
  /** 'choose' → 選建立/加入；'create' → 填資料建房間；'join' → 輸入房號；'room' → 房間等待中 */
  // v5.008：合併 choose/join 為單一大廳頁面，create 表單改為大廳內 inline 展開
  //   'choose' 保留在 union 是為了向後相容（外部任何狀態變化都會被 effect normalize 成 'join'）
  let onlineStep  = $state<'choose' | 'create' | 'join' | 'room'>('join');
  // v5.008：大廳內「建立新房間」按鈕的折疊狀態（false=只顯示按鈕，true=展開表單）
  let showCreateForm = $state(false);

  // v3.96 再來一局（對稱設計）— 雙方各自獨立按按鈕，從 roomData 取得雙方 ready 狀態
  //   myRematchReady: 我端已按下「再來一局」
  //   oppRematchReady: 對手已按下「再來一局」
  //   雙方都 true → 任一方 client 自動 trigger checkAndAcceptRematch
  const myRematchReady = $derived(
    roomData && mySeatIdx >= 0 && mySeatIdx <= 1
      ? !!(roomData.rematchReady?.[mySeatIdx])
      : false
  );
  const oppRematchReady = $derived(
    roomData && mySeatIdx >= 0 && mySeatIdx <= 1
      ? !!(roomData.rematchReady?.[1 - mySeatIdx])
      : false
  );

  // v4.60 propose-restart state
  const myRestartProposed = $derived(
    roomData && mySeatIdx >= 0 && mySeatIdx <= 1
      ? !!(roomData.restartProposed?.[mySeatIdx])
      : false
  );
  const oppRestartProposed = $derived(
    roomData && mySeatIdx >= 0 && mySeatIdx <= 1
      ? !!(roomData.restartProposed?.[1 - mySeatIdx]) && !myRestartProposed
      : false
  );
  const restartProposalCount = $derived(roomData?.restartProposalCount ?? 0);
  let restartCountdown = $state(30);
  let restartRejectedToast = $state(false);
  let lastSeenRejectedAt = $state<number | null>(null);
  const canProposeRestart = $derived(
    mode === 'online'
      ? !myRestartProposed && !oppRestartProposed
      : true
  );
  let restartCountdownTimer: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    const proposedAt = roomData?.restartProposedAt;
    if (proposedAt && (myRestartProposed || oppRestartProposed)) {
      if (restartCountdownTimer) clearInterval(restartCountdownTimer);
      const tick = () => {
        const elapsed = Math.floor((Date.now() - proposedAt) / 1000);
        restartCountdown = Math.max(0, 30 - elapsed);
        if (restartCountdown === 0) {
          if (restartCountdownTimer) { clearInterval(restartCountdownTimer); restartCountdownTimer = null; }
          if (myRestartProposed && roomCode) {
            cancelRestart(roomCode).catch((e: unknown) => console.warn('[cancelRestart timeout]', e));
          } else if (oppRestartProposed && roomCode) {
            respondRestart(roomCode, false).catch((e: unknown) => console.warn('[respondRestart timeout]', e));
          }
        }
      };
      tick();
      restartCountdownTimer = setInterval(tick, 500);
    } else {
      if (restartCountdownTimer) { clearInterval(restartCountdownTimer); restartCountdownTimer = null; }
      restartCountdown = 30;
    }
  });

  // v5.180 propose-return-to-room state (仿 restart pattern)
  const myReturnRoomProposed = $derived(
    roomData && mySeatIdx >= 0 && mySeatIdx <= 1
      ? !!(roomData.returnRoomProposed?.[mySeatIdx])
      : false
  );
  const oppReturnRoomProposed = $derived(
    roomData && mySeatIdx >= 0 && mySeatIdx <= 1
      ? !!(roomData.returnRoomProposed?.[1 - mySeatIdx]) && !myReturnRoomProposed
      : false
  );
  let returnRoomCountdown = $state(30);
  let returnRoomRejectedToast = $state(false);
  let lastSeenReturnRoomRejectedAt = $state<number | null>(null);
  const canProposeReturnRoom = $derived(
    mode === 'online'
      ? !myReturnRoomProposed && !oppReturnRoomProposed
      : true
  );
  let returnRoomCountdownTimer: ReturnType<typeof setInterval> | null = null;
  $effect(() => {
    const proposedAt = roomData?.returnRoomProposedAt;
    if (proposedAt && (myReturnRoomProposed || oppReturnRoomProposed)) {
      if (returnRoomCountdownTimer) clearInterval(returnRoomCountdownTimer);
      const tick = () => {
        const elapsed = Math.floor((Date.now() - proposedAt) / 1000);
        returnRoomCountdown = Math.max(0, 30 - elapsed);
        if (returnRoomCountdown === 0) {
          if (returnRoomCountdownTimer) { clearInterval(returnRoomCountdownTimer); returnRoomCountdownTimer = null; }
          if (myReturnRoomProposed && roomCode) {
            cancelReturnToRoom(roomCode).catch((e: unknown) => console.warn('[cancelReturnToRoom timeout]', e));
          } else if (oppReturnRoomProposed && roomCode) {
            respondReturnToRoom(roomCode, false).catch((e: unknown) => console.warn('[respondReturnToRoom timeout]', e));
          }
        }
      };
      tick();
      returnRoomCountdownTimer = setInterval(tick, 500);
    } else {
      if (returnRoomCountdownTimer) { clearInterval(returnRoomCountdownTimer); returnRoomCountdownTimer = null; }
      returnRoomCountdown = 30;
    }
  });
  $effect(() => {
    const rejectedAt = roomData?.returnRoomRejectedAt;
    if (rejectedAt && rejectedAt !== lastSeenReturnRoomRejectedAt) {
      lastSeenReturnRoomRejectedAt = rejectedAt;
      returnRoomRejectedToast = true;
      setTimeout(() => returnRoomRejectedToast = false, 3000);
    }
  });

  $effect(() => {
    const rejectedAt = roomData?.restartRejectedAt;
    if (rejectedAt && rejectedAt !== lastSeenRejectedAt) {
      lastSeenRejectedAt = rejectedAt;
      restartRejectedToast = true;
      setTimeout(() => { restartRejectedToast = false; }, 4000);
    }
  });

  // v3.97 對戰中聊天室（floating panel）— 沿用既有 chatMessages / sendMessage
  //   chatPanelOpen: 是否展開
  //   chatPanelPos: 拖曳偏移（桌機）— mobile portrait 走 CSS 全螢幕 modal 樣式忽略此值
  //   lastSeenChatCount: 已看到的訊息數，差額即為未讀
  let chatPanelOpen = $state(false);

  // v5.055：對手回合動作 panel — 仿 chat-panel pattern
  //   oppTurnPanelOpen: 是否展開
  //   oppTurnPanelPos: 拖曳位置 offset
  //   oppTurnViewIndex: 從 turnActionsLog 末尾算回去看哪一回合 (0=上1回合, 1=上2回合...)
  let oppTurnPanelOpen = $state(false);
  let oppTurnPanelPos = $state({ x: 0, y: 0 });
  let oppTurnTogglePos = $state({ x: 0, y: 0 });  // v5.057：toggle 按鈕拖曳位置
  let oppTurnViewIndex = $state(0);  // 0 = 最新 (上一回合)
  // v5.057：拖曳 vs 點擊區分 — 拖移超過 5px 視為拖曳，不觸發 click
  let oppTurnToggleMoved = $state(false);

  // v5.055：對手回合 panel 拖曳 handler
  let oppTurnDragStart: { x: number; y: number; panelX: number; panelY: number } | null = null;
  function onOppTurnDragStart(e: PointerEvent) {
    oppTurnDragStart = {
      x: e.clientX, y: e.clientY,
      panelX: oppTurnPanelPos.x, panelY: oppTurnPanelPos.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onOppTurnDragMove(e: PointerEvent) {
    if (!oppTurnDragStart) return;
    oppTurnPanelPos = {
      x: oppTurnDragStart.panelX + (e.clientX - oppTurnDragStart.x),
      y: oppTurnDragStart.panelY + (e.clientY - oppTurnDragStart.y),
    };
  }
  function onOppTurnDragEnd(e: PointerEvent) {
    oppTurnDragStart = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }

  // v5.057：toggle 按鈕拖曳 — 仿 panel header 邏輯但操作 togglePos
  let oppTurnToggleDragStart: { x: number; y: number; btnX: number; btnY: number } | null = null;
  function onOppTurnToggleDragStart(e: PointerEvent) {
    e.stopPropagation();  // v5.231 防止穿透點到下面的卡
    oppTurnToggleDragStart = {
      x: e.clientX, y: e.clientY,
      btnX: oppTurnTogglePos.x, btnY: oppTurnTogglePos.y,
    };
    oppTurnToggleMoved = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onOppTurnToggleDragMove(e: PointerEvent) {
    e.stopPropagation();  // v5.231 防止穿透
    if (!oppTurnToggleDragStart) return;
    const dx = e.clientX - oppTurnToggleDragStart.x;
    const dy = e.clientY - oppTurnToggleDragStart.y;
    if (Math.hypot(dx, dy) > 5) oppTurnToggleMoved = true;  // 超過 5px 算拖曳
    oppTurnTogglePos = {
      x: oppTurnToggleDragStart.btnX + dx,
      y: oppTurnToggleDragStart.btnY + dy,
    };
  }
  function onOppTurnToggleDragEnd(e: PointerEvent) {
    e.stopPropagation();  // v5.231 防止穿透
    oppTurnToggleDragStart = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }
  function onOppTurnToggleClick() {
    // 拖曳結束時也會 fire click — 拖移超過 5px 不觸發 panel 開啟
    if (oppTurnToggleMoved) {
      oppTurnToggleMoved = false;
      return;
    }
    oppTurnPanelOpen = true;
    oppTurnViewIndex = 0;
  }
  let chatPanelPos = $state({ x: 0, y: 0 });
  let chatPanelDragStart: { mx: number; my: number; ox: number; oy: number } | null = null;
  let lastSeenChatCount = $state(0);
  const unreadChatCount = $derived(Math.max(0, chatMessages.length - lastSeenChatCount));
  let tLastSeenChat = $state(0); // v5.577 錦標賽對戰中浮動聊天(接大廳)已讀數
  const chatFabUnread = $derived(isTournament ? Math.max(0, tChat.length - tLastSeenChat) : unreadChatCount);
  let chatPanelScrollEl: HTMLDivElement | null = null;
  let chatPanelPinned = $state(true);  // v5.626 使用者是否在底部；往上看歷史時(false)新訊息不強制捲回底
  function onChatPanelScroll(e: Event) { const el = e.currentTarget as HTMLElement; chatPanelPinned = (el.scrollHeight - el.scrollTop - el.clientHeight) < 48; if (isTournament && el.scrollTop < 60 && tChatHasMore && !_tChatLoadingOlder) tChatLoadOlder(el); }

  function toggleChatPanel() {
    chatPanelOpen = !chatPanelOpen;
    if (chatPanelOpen) {
      lastSeenChatCount = chatMessages.length;
      if (isTournament) tLastSeenChat = tChat.length;
      // 開啟時等 DOM 更新後 scroll to bottom
      setTimeout(() => {
        if (chatPanelScrollEl) chatPanelScrollEl.scrollTop = chatPanelScrollEl.scrollHeight;
      }, 50);
    }
  }
  function onChatHeaderDown(e: PointerEvent) {
    chatPanelDragStart = { mx: e.clientX, my: e.clientY, ox: chatPanelPos.x, oy: chatPanelPos.y };
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  }
  function onChatHeaderMove(e: PointerEvent) {
    if (!chatPanelDragStart) return;
    const dx = e.clientX - chatPanelDragStart.mx;
    const dy = e.clientY - chatPanelDragStart.my;
    let x = chatPanelDragStart.ox + dx, y = chatPanelDragStart.oy + dy;
    // v5.626 手機版用 margin 位移(避免 transform 破壞 iOS 內部捲動)→ clamp 保留面板大致在畫面內不拖丟
    if (isPortraitMobile && typeof window !== 'undefined') {
      const W = window.innerWidth, H = window.innerHeight;
      x = Math.max(-W * 0.45, Math.min(W * 0.45, x));
      y = Math.max(-(H * 0.25), Math.min(H * 0.45, y));
    }
    chatPanelPos = { x, y };
  }
  function onChatHeaderUp(_e: PointerEvent) {
    chatPanelDragStart = null;
  }

  // v4.24 對戰計時器 — tickTime 每秒更新驅動 derived 顯示時間
  let tickTime = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { tickTime = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  // 將毫秒格式化為 mm:ss 或 h:mm:ss
  function fmtTimerMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
  }
  // 當前回合計時（active player 的本回合時間）— phase==='playing' 才 live
  const liveTurnTimeMs = $derived(
    game && game.phase === 'playing' && game.currentTurnStartTime !== undefined
      ? Math.max(0, tickTime - game.currentTurnStartTime)
      : 0
  );
  // 玩家累計時間 = 已記錄 playerTurnTimeMs + 當前回合 live time（僅 active player）
  function _playerTotal(idx: 0 | 1): number {
    if (!game) return 0;
    const stored = game.playerTurnTimeMs?.[idx] ?? 0;
    const live = (game.phase === 'playing' && game.activePlayerIndex === idx) ? liveTurnTimeMs : 0;
    return stored + live;
  }
  const p0TotalMs = $derived(_playerTotal(0));
  const p1TotalMs = $derived(_playerTotal(1));
  const gameTotalMs = $derived(
    game && game.gameStartTime !== undefined
      ? Math.max(0, (game.phase === 'game-over' ? (game.currentTurnStartTime ?? tickTime) + liveTurnTimeMs : tickTime) - game.gameStartTime)
      : 0
  );

  // v4.21 勝負視窗（可拖曳）— 對局結束時 overlay 戰鬥盤面，保留場上狀況檢視
  //   gameoverPanelPos：拖曳偏移（初始 0,0；CSS center 定位 + transform translate）
  //   gameoverPanelDragStart：drag origin（null = 非拖曳中）
  let gameoverPanelPos = $state({ x: 0, y: 0 });
  let gameoverPanelDragStart: { mx: number; my: number; ox: number; oy: number } | null = null;
  function onGameoverHeaderDown(e: PointerEvent) {
    gameoverPanelDragStart = { mx: e.clientX, my: e.clientY, ox: gameoverPanelPos.x, oy: gameoverPanelPos.y };
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  }
  function onGameoverHeaderMove(e: PointerEvent) {
    if (!gameoverPanelDragStart) return;
    const dx = e.clientX - gameoverPanelDragStart.mx;
    const dy = e.clientY - gameoverPanelDragStart.my;
    gameoverPanelPos = { x: gameoverPanelDragStart.ox + dx, y: gameoverPanelDragStart.oy + dy };
  }
  function onGameoverHeaderUp(_e: PointerEvent) {
    gameoverPanelDragStart = null;
  }

  // v3.98 聊天 fab 圖示拖曳 — 玩家可移動到不擋牌的位置
  //   位置存 localStorage 重整保留；session 內也持續
  let chatFabPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let chatFabDragStart: { mx: number; my: number; ox: number; oy: number } | null = null;
  let chatFabDragged = false;  // 區分 click vs drag（drag 後不觸發 toggle）

  // 載入 localStorage 保存的位置
  // v5.613：clamp 聊天 fab 位置在視窗內——避免拖出畫面、或換裝置/旋轉後偏移超出視窗導致 fab「不見」
  function clampChatFabPos(p: { x: number; y: number }): { x: number; y: number } {
    if (typeof window === 'undefined') return p;
    const W = window.innerWidth, H = window.innerHeight, PAD = 6, SIZE = 54, BASE = 18;
    const minX = PAD + BASE + SIZE - W, maxX = BASE - PAD;
    const minY = PAD + BASE + SIZE - H, maxY = BASE - PAD;
    return { x: Math.max(minX, Math.min(maxX, p.x)), y: Math.max(minY, Math.min(maxY, p.y)) };
  }
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('ptcg_chat_fab_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          chatFabPos = clampChatFabPos(parsed);
        }
      }
    } catch { /* ignore parse errors */ }
  }

  function onFabPointerDown(e: PointerEvent) {
    e.stopPropagation();  // v5.231 防止穿透點到下面的卡
    chatFabDragStart = { mx: e.clientX, my: e.clientY, ox: chatFabPos.x, oy: chatFabPos.y };
    chatFabDragged = false;
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  }
  function onFabPointerMove(e: PointerEvent) {
    e.stopPropagation();  // v5.231 防止穿透
    if (!chatFabDragStart) return;
    const dx = e.clientX - chatFabDragStart.mx;
    const dy = e.clientY - chatFabDragStart.my;
    if (!chatFabDragged && Math.abs(dx) + Math.abs(dy) > 12) {
      chatFabDragged = true;  // v5.591 門檻 4→12px：手機觸控輕觸常有 <12px 抖動，避免被誤判成拖曳而點不開聊天室
    }
    if (chatFabDragged) {
      chatFabPos = clampChatFabPos({ x: chatFabDragStart.ox + dx, y: chatFabDragStart.oy + dy });
    }
  }
  function onFabPointerUp(e: PointerEvent) {
    e.stopPropagation();  // v5.231 防止穿透
    if (!chatFabDragStart) return;
    if (!chatFabDragged) {
      // 沒拖曳 → 視為 click，開 panel
      toggleChatPanel();
    } else {
      // 拖曳結束 → 存 localStorage 保留位置
      try {
        localStorage.setItem('ptcg_chat_fab_pos', JSON.stringify(chatFabPos));
      } catch { /* ignore quota errors */ }
    }
    chatFabDragStart = null;
  }
  // 新訊息進來時若 panel 已開 → markChatSeen + 自動 scroll
  $effect(() => {
    if (chatPanelOpen && !isTournament && chatMessages.length > lastSeenChatCount) {
      lastSeenChatCount = chatMessages.length;
      setTimeout(() => {
        if (chatPanelScrollEl && chatPanelPinned) chatPanelScrollEl.scrollTop = chatPanelScrollEl.scrollHeight;
      }, 50);
    }
    if (chatPanelOpen && isTournament && tChat.length > tLastSeenChat) {
      tLastSeenChat = tChat.length;
      setTimeout(() => { if (chatPanelScrollEl && chatPanelPinned) chatPanelScrollEl.scrollTop = chatPanelScrollEl.scrollHeight; }, 50);
    }
  });
  let roomCode    = $state('');          // 建立或加入後得到的房號
  let joinInput   = $state('');          // 輸入框裡打的房號
  let amIHost     = $state(false);       // 是否為房主（用來顯示「關房」等按鈕）
  let roomData    = $state<Room | null>(null);
  let onlineLoading = $state(false);
  let onlineError   = $state('');
  /** v6.055 診斷：卡包載入自我重呼叫的次數（防無聲無限重試）。 */
  let _poolRetry = 0;
  /**
   * 互動式開局（閃焰王牌｜瞬間爆發力）的逃生開關。
   *
   * v6.057：**預設放行**。網址帶 `?opening=0` 可強制退回舊開局 ——
   * 這是留給 Wilson 的即時逃生口：萬一線上開局出問題，不必等我改版，
   * 開房時網址加 `?opening=0` 就能立刻用舊流程開一局。
   *
   * ⚠**只有「建局方」（房主，seat 0）帶這個參數才有意義** —— 局走哪一套是建局那一刻
   *   由 `createGame` 決定並寫進盤面，加入方之後只是收盤面。
   *   （v6.055 用 `?opening=1` 當「開啟」開關就是踩到這點：玩家分不清自己是不是建局方，
   *     參數帶在加入方身上完全無效，看起來就像功能沒生效。）
   */
  const forceLegacyOpeningParam = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('opening') === '0';
  let isSyncing     = $state(false);
  /** v2.269：從 roomData.seats 推導 — 0=P1, 1=P2, null=觀戰或未在房 */
  let myPlayerIndex = $state<0 | 1 | null>(null);
  /** v2.269：當前座位索引 (0..9)；觀戰位 ≥2 */
  let mySeatIdx = $state<number>(-1);
  let _onlineReadyAt = 0; // v5.749 決定性建局者 grace 計時(雙就緒+lobby+無局 起算)
  let unsubRoom:    (() => void) | null = null;
  // v2.73 殭屍房間心跳機制
  let heartbeatTimer: number | null = null;
  // 可加入的開放房間列表（onlineStep='join' 時即時訂閱）
  let openRooms = $state<Room[]>([]);
  let openRoomsErr = $state('');
  // v3.992：把 openRooms 依 status 分組（lobby = 等待中可加入；playing = 對戰中可觀戰）
  const lobbyRooms = $derived(openRooms.filter(r => r.status === 'lobby'));
  const playingRooms = $derived(openRooms.filter(r => r.status === 'playing'));
  /**
   * v6.115 大廳「對戰中房間」的牌組原型名稱：roomId → { p1, p2 }。
   * 值是伺服器比對 admin「牌組原型」規則後回傳的**名稱字串**（含 '未分類'）；
   * 拿不到就是 undefined／null，UI 直接不顯示標籤（fail-open，絕不猜）。
   * ⚠ 只有正式站（Oracle）有這份規則庫；測試站走 Firebase，沒有規則可比對。
   */
  let roomArchetypes = $state<Record<string, { p1: string | null; p2: string | null }>>({});
  /** 問過但還沒有結果的房間，記下時間避免每 2 秒重問一次（一場對戰內牌組不會變）。 */
  const _archAskedAt = new Map<string, number>();
  const ARCH_RETRY_MS = 30000;

  async function ensureRoomArchetypes(rooms: Room[]) {
    if (!ORACLE_MODE) return;                       // 測試站沒有規則庫，不必打端點
    if (isTournament) return;                       // v6.118：錦標賽頁沒有休閒大廳，雙保險
    const now = Date.now();
    const need = rooms
      .filter(r => r.status === 'playing' && !roomArchetypes[r.roomId]
                   && now - (_archAskedAt.get(r.roomId) ?? 0) > ARCH_RETRY_MS)
      .map(r => r.roomId)
      .slice(0, 30);
    if (!need.length) return;
    for (const id of need) _archAskedAt.set(id, now);
    try {
      const got = await oracleRoomArchetypes(need);
      if (got && typeof got === 'object' && Object.keys(got).length) {
        roomArchetypes = { ...roomArchetypes, ...got };
      }
    } catch {
      /* 端點不存在／伺服器還沒更新 → 就是不顯示標籤，不影響大廳其他功能 */
    }
  }
  let unsubOpenRooms: (() => void) | null = null;
  // v2.272 Phase 2：聊天室
  let chatMessages = $state<ChatMessage[]>([]);
  let chatInput = $state('');
  let unsubMessages: (() => void) | null = null;
  let chatScrollEl: HTMLElement | null = $state(null);
  // v5.589 大廳聊天室：進入即捲到最新訊息；「釘在底部」——讀歷史往上捲時不打擾，捲回底部恢復自動捲
  let tLobbyChatEl = $state<HTMLElement | null>(null);
  let tLobbyChatPinned = true;
  function onLobbyChatScroll() {
    const el = tLobbyChatEl;
    if (!el) return;
    tLobbyChatPinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 60 && tChatHasMore && !_tChatLoadingOlder) tChatLoadOlder(el); // v5.752 滑到頂→載更舊
  }
  $effect(() => {
    const _n = tChat.length;  // 依賴：訊息變動 / 首次載入時觸發
    if (!tLobbyChatEl || !tLobbyChatPinned) return;
    setTimeout(() => { if (tLobbyChatEl) tLobbyChatEl.scrollTop = tLobbyChatEl.scrollHeight; }, 30);
  });
  // v2.276 Phase 3：觀戰視角切換
  let spectatorView = $state<'p1' | 'p2' | 'auto'>('auto');

  // ── UI 互動狀態 ─────────────────────────────────────────────────────────────
  let selectedEnergyIid = $state<string | null>(null);
  let selectionPicked = $state<Set<string>>(new Set());
  // damage-distribute 專用：每隻目標本批次要放幾個 counter
  // 跟 selectionPicked 分開：selectionPicked 是 toggle 集合（單次唯一），這裡是計數器
  let selectionCounts = $state<Record<string, number>>({});
  // v2.164 reorder-deck-top 專用：玩家排序後保留的 iid（top first）+ 已丟棄的 iid
  // 跟 selectionPicked 分開：reorder 是兩列 + 順序，不是單純 toggle 集合
  let selectionReorderKeep = $state<string[]>([]);
  let selectionReorderDiscard = $state<Set<string>>(new Set());
  // v2.201 modal-choice stepper 專用：當前數值（泰姆猜 HP / 未來其他需要數字 stepper 的卡）
  // 規則：modal-choice pendingSelection.params.stepper = { min, max, step, init }
  // 啟用條件：params.stepper 存在 → UI 渲染 +/- 按鈕 + 確認 而非 options 列表
  // 為何不用 number input：Leon 規則「戰鬥畫面只用滑鼠」（記憶 feedback_mouse_only_battle.md）
  let selectionStepperValue = $state<number>(0);
  let zoomCard = $state<Card | null>(null);
  // ⭐⭐⭐v6.190 回放限定：獎賞卡檢視視窗。
  //   ⚠⚠ 獎賞卡在正式對戰中是「蓋著的機密資訊」（只有 faceUp 的那幾張才可以看）。
  //   這個視窗**只准在對戰回放（isTReplay）裡開**：回放讀的是已結束對局的歸檔快照，
  //   攤牌是刻意的（v5.940 手牌攤開、v6.135 獎賞正面都是同一個決定）。
  //   ⚠ 觀戰（isTournSpectator）**不是**回放：觀戰看的是進行中的對局，
  //     伺服器的 _redactStateForSeat 對觀戰端永遠遮，但玩家端遮蔽是灰度旗標（v6.153 預設關），
  //     也就是說「對戰中的 client 手上就有對手獎賞的 cardId」⇒ 這道 client 端的閘是唯一防線。
  //   ⇒ 三道閘：① openPrizeView 早退 ② 觸發按鈕包在 isTReplay 內 ③ 視窗本體 {#if isTReplay ...}。
  let prizeViewOpen = $state(false);
  function openPrizeView() {
    if (!isTReplay) { prizeViewOpen = false; return; }   // ⚠ 非回放一律拒絕（不是只有不顯示）
    prizeViewOpen = true;
  }
  function closePrizeView() { prizeViewOpen = false; }
  // v2.129：全螢幕卡牌放大 lightbox（鏡射 /cards 樣式）— 從任何 zoom-img 或 cards 點擊觸發
  let lightboxUrl = $state<string | null>(null);
  function openLightboxImg(url: string) { lightboxUrl = url; }
  function closeLightboxImg() { lightboxUrl = null; }

  // ── 全螢幕切換（iOS Safari 隱藏分頁列/工具列） ─────────────────────────────
  let isFullscreen = $state(false);
  function toggleFullscreen() {
    const doc = document as any;
    const el = document.documentElement as any;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
      if (req) req.call(el).catch(() => {});
    } else {
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (exit) exit.call(doc).catch(() => {});
    }
  }
  onMount(() => {
    const onFsChange = () => {
      const doc = document as any;
      isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  });

  // v5.350：長任務（主執行緒卡死）偵測器 — 玩家回報「畫面凍住 / 聊天打字要等很久」時，
  //   F12 console 會印出主執行緒被卡幾毫秒 + 當下最後一個動作，協助定位真兇（渲染或反應式運算）。
  //   注意：true 無限迴圈不會產生 longtask entry（任務沒結束），但「長但會結束」的飽和會被抓到。
  onMount(() => {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          // ⭐v6.159 順手累計進診斷用的滾動窗。**刻意共用這顆既有的 observer**：
          //   多開一顆 PerformanceObserver 等於替主執行緒再加一份回呼負擔，
          //   而這一版整個重點就是量主執行緒 —— 量測自己不能變成被量的對象。
          _ltSamples.push({ t: Date.now(), d: e.duration });
          if (_ltSamples.length > 200) _ltSamples.splice(0, _ltSamples.length - 200);
          if (e.duration >= 600) {
            const bc = (globalThis as any).__ptcgLB;
            console.error('[PTCG] \u26a0\ufe0f \u4e3b\u57f7\u884c\u7dd2\u5361 ' + Math.round(e.duration) + 'ms'
              + (bc ? '\uff08\u6700\u5f8c\u52d5\u4f5c\uff1a' + bc.kind + '/' + (bc.action ?? '') + '\uff0c' + Math.round(Date.now() - bc.t) + 'ms \u524d\uff09' : ''));
          }
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
      // ⚠⚠ v6.159：Safari/iOS **有** PerformanceObserver 但**沒有** longtask，而 `observe()`
      //   對不支援的 entryType **不會 throw**（只在 console 警告）⇒ 絕不可以用「observe 沒爆」
      //   當支援判據，那會把整批 Safari 使用者誤記成「主執行緒完全沒有長任務」（假綠）。
      //   唯一可信的判據是 supportedEntryTypes；查不到就保守當作不支援 → 回報 null。
      const _sup = (PerformanceObserver as any).supportedEntryTypes;
      _ltSupported = Array.isArray(_sup) && _sup.indexOf('longtask') >= 0;
    } catch { /* longtask 不支援就略過 */ }
    return () => { _ltSupported = false; try { obs?.disconnect(); } catch { /* ignore */ } };
  });

  // v4.05：擋瀏覽器返回手勢避免右滑中斷對戰
  //   玩家回報手機版右滑（iOS Safari 邊緣返回 / Android 左滑）會跳出對戰。
  //   修法：進對戰時 history.pushState dummy state；popstate 觸發時再 push 回。
  //   用戶要離開請走 UI 內的「←」離開按鈕（不經 history.back）。
  $effect(() => {
    if (!game || typeof window === 'undefined') return;
    // 進對戰：push dummy state（marker 用 timestamp 確保唯一）
    try { history.pushState({ ptcgGameLock: Date.now() }, ''); } catch { /* ignore */ }
    const onPop = (_e: PopStateEvent) => {
      // 對戰中 popstate（含右滑觸發）→ 立刻再 push 回攔截 back
      if (game) {
        try { history.pushState({ ptcgGameLock: Date.now() }, ''); } catch { /* ignore */ }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); };
  });

  // ── v2.284 手機直式偵測 & 平板/1366x768 橫屏縮小版偵測 ──────────────────────
  // ≤600px 寬 + portrait 方向 → 切換到 MobilePortraitBattle 元件（雙軌並行）。
  // 桌機 / 大螢幕 走原 .battle-root 橫式 layout。
  // 平板 / 1366x768 走 .battle-root.tablet-layout 橫式縮小配置。
  let isPortraitMobile = $state(false);
  let isTabletLayout = $state(false);

  // ── v2.45 解析度模式（Leon 反映 1024×576 螢幕容納不下 tablet-layout）──────────
  // 模式：
  //   'auto'  → 依視窗大小自動算 zoom（小於 1280×720 時 fit-to-window）
  //   '100' / '90' / '80' / '75' → 強制套用該百分比 zoom
  // gameZoom 為實際應用的數值（0.6 ~ 1）；存入 localStorage 跨 session 保留
  let resolutionMode = $state<'auto' | '100' | '90' | '80' | '75' | '70' | '65' | '60'>('auto');
  let gameZoom = $state(1);

  function recomputeZoom() {
    if (typeof window === 'undefined') return;
    if (battleLayout === 'fable') { gameZoom = 1; return; }  // fable 版自帶 clamp/vw/vh 尺寸,鎖 gameZoom=1 避免雙重縮放
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (resolutionMode === 'auto') {
      // 手機 portrait 走另一個元件，不縮放
      if (isPortraitMobile) { gameZoom = 1; return; }
      // v2.463：基準改為 1366×768（之前 1280×720 對 1024×576 zoom 0.8 仍切到右側，
      //   特別是 Mac Safari 瀏覽器 UI 額外吃高度）。
      //   1366×768 → 1.0；1280×720 → ~0.94；1024×576 → ~0.75
      // v6.223 各版面內容高度基準分開算：
      //   桌墊版 grid（bench/active 四排 + 手牌 + header）在 zoom=1 需要約 886px 高，實測 1366×768 /
      //   1867×831 / 1912×836 都會讓上下戰鬥場重疊、對手 bench 被推出畫面上緣 → targetH 用 900，
      //   高度不足時整版自動縮放（battle-root 高度換算見 CSS 的 100dvh/zoom 規則）。
      //   經典版在「非 tablet-layout」(h>850) 且 h<942 的縫隙會整頁捲動（實測 1440×900 scrollHeight=942）
      //   → targetH 用 945；tablet-layout（h<=850）下經典版維持 768 基準，行為與過去完全相同。
      const targetW = 1366;
      const targetH = battleLayout === 'tabletop' ? 900 : (isTabletLayout ? 768 : 945);
      const ratio = Math.min(w / targetW, h / targetH, 1);
      gameZoom = ratio < 0.97 ? Math.max(0.55, +ratio.toFixed(3)) : 1;
    } else {
      gameZoom = parseInt(resolutionMode, 10) / 100;
    }
  }

  function setResolutionMode(mode: 'auto' | '100' | '90' | '80' | '75' | '70' | '65' | '60') {
    resolutionMode = mode;
    try { localStorage.setItem('ptcgGameResolutionMode', mode); } catch {}
    recomputeZoom();
  }

  onMount(() => {
    // v5.939 分享回放連結:?treplay=<matchId> 進頁直接進回放(公開端點免登入)
    try { const _rid = new URLSearchParams(window.location.search).get('treplay'); if (_rid) tStartReplay(_rid); } catch { /* ignore */ }
  });
  // ⭐v6.151 回前景立即與伺服器對一次盤面。背景頁籤的 setInterval 會被瀏覽器節流到分鐘級，
  //   回來時畫面可能已經落後好幾個版本 —— 而閒置判負的倒數是**伺服器**在算，不會跟著暫停。
  //   全站原本只有 src/lib/img-retry.ts 掛過 visibilitychange。
  onMount(() => {
    if (typeof document === 'undefined') return;
    const onVis = (): void => {
      _visSeq++;   // v6.159 只是計數：背景頁籤的 rAF 根本不 fire，跨越可見性變動的重繪樣本必須丟棄
      _tTabHidden = (document.visibilityState !== 'visible');   // ⭐v6.161 大廳降頻讀這個旗標
      if (document.visibilityState !== 'visible') return;
      // ⭐⭐⭐v6.161 回前景 ⇒ 大廳輪詢**立刻**恢復正常頻率並馬上再抓一次。
      //   ⚠⚠ 必須放在下面那行 `tStep !== 'playing'` 早退**之前** —— 大廳的人正好就是
      //   tStep !== 'playing'，寫在早退之後等於完全沒接上（本專案反覆踩過的「早退擺錯位置」）。
      tLobbyResume();
      tNow = Date.now() + tClockOffset;   // 先把時鐘拉回現在，倒數才不會用背景期間的舊值
      // ⚠ 與 tNow 同一個時鐘域（都是伺服器域）。寫成 Date.now() 的話兩者差值就是 tClockOffset，
      //   裝置時鐘慢 3 秒以上抑制永遠不生效、快 30 秒則抑制長達 33 秒（Fable 5 審查抓到）。
      _tForegroundAt = tNow;
      // ⭐v6.170【B-2】回前景 ⇒ 若有動作卡在退避等待中，立刻重送（不等計時器）。
      //   ⚠ 放在下面那行早退**之前**：那行會把大廳與非對戰狀態濾掉，寫在後面等於沒接上。
      _tOnNetRecovered(false);
      if (!isTournament || isTournSpectator || !tActiveRoom || tStep !== 'playing') return;
      // ⚠ 對戰已結束 → 沒有東西要同步，而且重建 timer 會讓 game-over 的降頻重新開始
      //   （v6.146 那條守衛鎖的就是這件事）。平手待裁定仍由既有的降頻輪詢帶回結果。
      if (game && (game as any).phase === 'game-over') return;
      void tForceResync();
      startTournamentPoll();
    };
    _tTabHidden = (document.visibilityState !== 'visible');   // ⭐v6.161 初值（在背景載入的頁面不會收到 visibilitychange）
    document.addEventListener('visibilitychange', onVis);
    // ⭐⭐v6.170【B-2】`online` 事件是「網路剛回來」最直接的訊號 —— 卡在退避等待中的動作
    //   立刻重送，不必等玩家發現、也不必等下一個退避週期。
    //   ⚠ `navigator.onLine` 只代表「有網路介面」，不代表連得到伺服器 ⇒ 我們**只用事件當觸發**，
    //     絕不拿 `onLine === false` 去主動封鎖任何送出（那會在誤判時把玩家鎖死）。
    const onOnline = (): void => { _tOnNetRecovered(true); };
    // ⭐v6.170 量測（A）必須在任何請求送出前掛上 observer，否則早期樣本會漏收。
    _tStartResTiming();
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    };
  });
  onMount(() => {
    // 載入 localStorage 設定
    try {
      const saved = localStorage.getItem('ptcgGameResolutionMode');
      if (saved && ['auto','100','90','80','75','70','65','60'].includes(saved)) {
        resolutionMode = saved as 'auto' | '100' | '90' | '80' | '75' | '70' | '65' | '60';
      }
    } catch {}
    // v5.009 桌墊版 layout — 初始化讀 localStorage（跟其他 settings 一起 init）
    try {
      const savedLayout = localStorage.getItem('ptcg_battle_layout');
      if (savedLayout === 'tabletop' || savedLayout === 'classic' || savedLayout === 'fable') battleLayout = savedLayout;
      // v6.223 桌機預設版面改為 fable：只影響「從未選過」的玩家（上面 savedLayout 命中就依玩家上次選擇，絕不覆蓋）。
      //   窄視窗（<1024，含 iPad 直式）維持 classic 預設 —— fable 完整 grid 是 >=1024 才啟用（見下方 CSS media 分界）。
      //   ⚠ 這裡不寫 localStorage：預設值不算「玩家的選擇」，玩家實際切換才由 setBattleLayout 寫入。
      //   ⚠ 手機直式不受影響：isPortraitMobile 走 MobilePortraitBattle 元件，該元件不讀 battleLayout。
      else if (typeof window !== 'undefined' && window.innerWidth >= 1024) battleLayout = 'fable';
    } catch { /* SSR / quota / private mode：保持預設 classic */ }
    // v5.012：battle log side panel 開關狀態（桌墊版用）
    try {
      const savedLogOpen = localStorage.getItem('ptcg_battle_log_open');
      if (savedLogOpen === '0' || savedLogOpen === '1') battleLogOpen = savedLogOpen === '1';
    } catch { /* ignore */ }
    try {
      const savedScale = parseFloat(localStorage.getItem('ptcg_fable_card_scale') ?? '');
      if (Number.isFinite(savedScale) && savedScale >= 0.7 && savedScale <= 1.4) fableCardScale = savedScale;
    } catch { /* ignore */ }

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      // 手機直式 (MobilePortraitBattle)
      // v5.194：手機橫放也走手機 layout — 改成 min(w, h) <= 600
      //   原條件只在 portrait（h>w）才切手機版，玩家不小心橫放會跳到桌機版
      //   新條件：任一邊 ≤ 600px 就視為手機（含手機橫放、平板大小手機）
      isPortraitMobile = Math.min(w, h) <= 600;
      
      // 極小手機橫屏（交給原本的 @media max-width: 950px and orientation: landscape 處理）
      const isLandscapeMobile = w <= 950 && w > h;
      
      // 平板 / 1366x768 筆電 等中型螢幕
      // 若寬 <= 1366 或是高 <= 850，且不是極小手機，就開啟 tablet-layout 縮小配置
      // 以免 1366x768 或 iPad 橫屏時被擠斷
      isTabletLayout = !isPortraitMobile && !isLandscapeMobile && (w <= 1366 || h <= 850);
      
      // v2.45：依視窗 / 設定重算 game zoom
      recomputeZoom();
      // v5.613：視窗大小/方向改變後重新 clamp 聊天 fab，避免偏移超出新視窗而消失
      chatFabPos = clampChatFabPos(chatFabPos);
    };
    
    window.addEventListener('resize', onResize);
    onResize(); // 初始化
    return () => window.removeEventListener('resize', onResize);
  });
  let zoomInst = $state<CardInstance | null>(null);
  // 堆疊：之前開過的 zoom — 用於「返回上一層」按鈕
  let zoomStack = $state<Array<{ card: Card; inst: CardInstance | null }>>([]);
  let floatingEvoMenu = $state<{ fromIid: string; evoOpts: CardInstance[]; x: number; y: number } | null>(null);
  let floatingRetreatMenu = $state<{ x: number; y: number } | null>(null);
  let viewDiscardFor = $state<0 | 1 | null>(null);

  // ── 彈出 UI 視窗拖曳（v2.44） ──────────────────────────────────────────────
  // Leon feedback：選牌 / 選寶可夢 modal 彈出後，玩家想拖曳視窗回去看場上的卡，
  // 被拖曳後背景變暗狀況也要取消，讓玩家看到被遮住的場面。
  // 實作：
  //   - `.sel-header` 為拖曳把手（避免按到按鈕）
  //   - 被拖曳後 `.selection-overlay` 加 `.dragged` → 背景 transparent + pointer-events:none
  //   - `.selection-modal` pointer-events:auto 讓 modal 本身仍可點
  //   - 切換新 modal 時 $effect 自動重置 offset（pendingSelection 物件變更就 trigger）
  let modalOffset = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let modalDragged = $state(false);
  let suppressToolSelectModal = $state(false); // v5.413：拖曳道具自動解期間抑制 attach-tool modal 閃現
  // v4.923：mulligan 補抽 stepper 計數覆寫值 — null 代表使用預設最大值
  let mulliganPickOverride = $state<number | null>(null);
  // v4.926 Admin 偷看模式：?spectate=ROOM&admin=1 + email 在白名單 → 純訂閱、不寫 seat、不寫 chat
  const ADMIN_EMAILS = ['suenz001@yahoo.com.tw'] as const;
  let isAdminMode = $state(false);
  // v3.81：取得獎賞 10 秒倒數 — 防本機雙人模式對手不點 take 卡死
  let takePrizeCountdown = $state<number>(0);
  let takePrizeTimerId = $state<ReturnType<typeof setInterval> | null>(null);
  // v3.74：mulligan 揭示 modal 的當前頁碼（每頁顯示一手起手 = 7 張卡）
  let revealPage = $state(0);
  let modalDragStart: { sx: number; sy: number; ox: number; oy: number } | null = null;
  function onModalHeaderPointerDown(e: PointerEvent) {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    // 按到 header 裡面的按鈕/輸入框時不觸發拖曳
    if (t.closest('button, input, select, textarea, a, [role="button"]')) return;
    modalDragStart = {
      sx: e.clientX, sy: e.clientY,
      ox: modalOffset.x, oy: modalOffset.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }
  function onModalHeaderPointerMove(e: PointerEvent) {
    if (!modalDragStart) return;
    const dx = e.clientX - modalDragStart.sx;
    const dy = e.clientY - modalDragStart.sy;
    modalOffset = { x: modalDragStart.ox + dx, y: modalDragStart.oy + dy };
    if (!modalDragged && Math.abs(dx) + Math.abs(dy) > 3) modalDragged = true;
  }
  function onModalHeaderPointerUp(_e: PointerEvent) {
    modalDragStart = null;
  }

  // ── 招式前置丟能量選擇（v1.57） ────────────────────────────────────────────
  // 玩家宣告招式、ATTACK_PRE_DISCARD_CHOICE 命中時彈出的能量挑選 modal 狀態
  // v3.873：optional copyAttackChoice — 扮晶晶酒先選對手太晶招式，再開能量 picker 時帶著 choice 一起 dispatch
  // v3.875：optional exactRequired — 激流水泵類「全有或全無」picker，confirm 只在 picked === 0 或 picked === exactRequired 時 enable
  let preAttackDiscard = $state<{
    attackIndex: number;
    spec: PreDiscardSpec;
    attackName: string;
    picked: Set<string>;
    copyAttackChoice?: { pokeIid: string; attackIndex: number };
    exactRequired?: number;
  } | null>(null);

  // ── 手牌 hover 預覽（Session 31 修正） ─────────────────────────────────────
  // 不改原卡 transform — 避免邊界抖動、z-index 爭奪、擋住 drop target
  let hoverHandIid = $state<string | null>(null);
  let hoverHandAnchor = $state<{ x: number; y: number } | null>(null);
  // v5.026 桌墊版：附加卡 hover 放大預覽（與手牌 hover-peek 同款，但用 cardId 不用 iid 找）
  // v5.027 加 hoverAttBelow — 卡靠近 viewport 頂端時預覽改顯示在卡下方
  let hoverAttCardId = $state<string | null>(null);
  let hoverAttAnchor = $state<{ x: number; y: number } | null>(null);
  let hoverAttBelow = $state<boolean>(false);

  // ── 擲硬幣動畫（Session 34） ────────────────────────────────────────────────
  // 新遊戲開始時播放 2 秒硬幣旋轉 + 1.5 秒結果揭曉
  let coinFlipStage = $state<'flipping' | 'revealing' | 'done'>('done');
  let coinFlipShownFor = $state<string | null>(null); // 已播過動畫的 game.id
  let coinFlipTimers: ReturnType<typeof setTimeout>[] = [];

  $effect(() => {
    if (!game) return;
    // game.id 變化（新局）才重播
    if (coinFlipShownFor === game.id) return;
    coinFlipShownFor = game.id;
    // 清掉舊 timer
    for (const t of coinFlipTimers) clearTimeout(t);
    coinFlipTimers = [];
    // v5.516：觀戰者進房不重播開場先攻擲硬幣動畫（玩家報每次進房都看到之前的擲幣）。
    //   已標記此 game.id 處理過 → 直接 done、不開 overlay。
    if (isSpectator) { coinFlipStage = 'done'; return; }
    coinFlipStage = 'flipping';
    coinFlipTimers.push(setTimeout(() => { coinFlipStage = 'revealing'; }, 2000));
    coinFlipTimers.push(setTimeout(() => { coinFlipStage = 'done'; }, 3800));
  });

  // ── 獎賞卡放置動畫（開局發牌 0→6）────────────────────────────────────────
  // 偵測雙方 prizes 從 0 → 6 的瞬間，觸發 stagger 動畫重播
  let prizeAnimKey = $state<[number, number]>([0, 0]);
  const prevPrizesLen: [number, number] = [0, 0];
  // v5.131：取獎賞 iid snapshot — 偵測 prizes.length 減少 + 對應 iid 進手牌
  const prevPrizesIids: [Set<string>, Set<string>] = [new Set(), new Set()];
  $effect(() => {
    if (!game) return;
    let changed = false;
    const next: [number, number] = [prizeAnimKey[0], prizeAnimKey[1]];
    for (const i of [0, 1] as const) {
      const cur = game.players[i].prizes.length;
      if (prevPrizesLen[i] === 0 && cur === 6) {
        next[i]++;
        changed = true;
      }
      prevPrizesLen[i] = cur;
      // v5.132：不在這裡更新 prevPrizesIids（移到取獎賞 effect 末尾）—
      //   原 v5.131 在此提前更新 → 取獎賞 effect 跑時 prev===current → picked 永遠空
      //   → 動畫永遠不觸發。Wilson 測試發現 bug。
    }
    if (changed) prizeAnimKey = next;
  });

  // v5.131：取得獎賞卡動畫 — prizes 減少 + 對應 iid 進手牌時觸發特殊動畫
  //   差別化 v5.049 一般 draw-fly：從 prize 位置 → 飛到螢幕中央 + scale 2.5 + rotate 360°
  //   → 縮小飛回 hand-strip → 落地隱藏。1.6s 內結束。
  //   同時把 prize 來源 iid 從 arrivingIids 移除（draw-fly 不再觸發），避免雙動畫。
  type PrizePickAnim = {
    id: number;
    cardId: string;
    iid: string;
    startX: number; startY: number;
    endX: number;   endY: number;
    duration: number;
    isMine: boolean;  // v5.137：對手取獎賞顯示卡背，我方取獎賞顯示正面
  };
  let prizePickAnims = $state<PrizePickAnim[]>([]);
  let prizePickIids = $state<Set<string>>(new Set());  // 防 draw-fly 雙觸發
  const prizePickTimers: ReturnType<typeof setTimeout>[] = [];
  const PRIZE_PICK_DUR = 1600;

  $effect(() => {
    if (!game) return;
    if (coinFlipStage !== 'done') return;
    for (const pIdx of [0, 1] as const) {
      const curPrizes = game.players[pIdx].prizes;
      const curIids = new Set(curPrizes.map(c => c.iid));
      const prevIids = prevPrizesIids[pIdx];
      // 找出「上次有但現在沒有」= 被取走的 iid
      const pickedIids: string[] = [];
      for (const iid of prevIids) if (!curIids.has(iid)) pickedIids.push(iid);
      // v5.132：先更新 prevPrizesIids 再判斷是否觸發動畫，
      //   下次 effect run 才能拿到正確 prev。同時記下 prev 是否曾經 init（避免第一次誤觸發）
      const wasInit = prevIids.size > 0;
      prevPrizesIids[pIdx] = curIids;
      // 第一次 prev 是空（初始化），不觸發動畫；之後 prev>0 且 picked>0 才觸發
      if (!wasInit) continue;
      if (pickedIids.length === 0) continue;
      // 標記 — draw-fly skip 這些 iid
      const newSet = new Set(prizePickIids);
      for (const iid of pickedIids) newSet.add(iid);
      prizePickIids = newSet;
      // 找對應 cardId（從新進入 hand 的 iid 內找）
      const handByIid = new Map(game.players[pIdx].hand.map(c => [c.iid, c.cardId]));
      const capturedPicks = pickedIids
        .map(iid => ({ iid, cardId: handByIid.get(iid) }))
        .filter((x): x is { iid: string; cardId: string } => !!x.cardId);
      if (capturedPicks.length === 0) continue;
      // queueMicrotask 等 DOM 渲染後 measure prize zone & hand-strip 位置
      queueMicrotask(() => {
        const isMine = (pIdx as number) === myIdx;
        const prizeEl = document.querySelector(
          isMine ? '.my-row .zone-prizes' : '.opponent-row .zone-prizes'
        ) as HTMLElement | null;
        if (!prizeEl) return;
        const prizeRect = prizeEl.getBoundingClientRect();
        const startX = prizeRect.left + prizeRect.width / 2;
        const startY = prizeRect.top + prizeRect.height / 2;
        let endX: number, endY: number;
        if (isMine) {
          const handEl = document.querySelector('.hand-strip') as HTMLElement | null;
          const handRect = handEl?.getBoundingClientRect();
          endX = handRect ? handRect.left + handRect.width / 2 : window.innerWidth / 2;
          endY = handRect ? handRect.top + handRect.height / 2 : window.innerHeight - 80;
        } else {
          const playmatEl = document.querySelector('.playmat') as HTMLElement | null;
          const pmRect = playmatEl?.getBoundingClientRect();
          endX = pmRect ? pmRect.left + pmRect.width / 2 : window.innerWidth / 2;
          endY = pmRect ? Math.max(pmRect.top + 20, 40) : 40;
        }
        // v5.134：多張獎賞 stagger delay + 一次多張時加快每張動畫速度
        // v5.137：multi 時 1.0s→1.4s（Wilson 反應太快看不清）
        // v5.141：stagger 250ms → 600ms（Wilson 反應第一張跑完前第二張就出來，要再延遲）
        const multi = capturedPicks.length;
        const effDur = multi > 1 ? 1400 : PRIZE_PICK_DUR;  // 多張時 1.6s→1.4s（略快但看得清）
        const stagger = multi > 1 ? 600 : 0;  // 每張間隔 600ms（第一張主體跑完再啟第二張）
        capturedPicks.forEach((p, i) => {
          const id = Date.now() + Math.random() + i * 0.001;
          const startDelay = i * stagger;
          // 等 startDelay 後 push 動畫
          const startTimer = setTimeout(() => {
            const anim: PrizePickAnim = {
              id, cardId: p.cardId, iid: p.iid,
              startX, startY, endX, endY,
              duration: effDur,
              isMine,  // v5.137：對手取獎賞顯示卡背，我方取獎賞顯示正面
            };
            prizePickAnims = [...prizePickAnims, anim];
          }, startDelay);
          prizePickTimers.push(startTimer);
          // 動畫結束清除
          const total = startDelay + effDur + 80;
          const timerId = setTimeout(() => {
            prizePickAnims = prizePickAnims.filter(d => d.id !== id);
            const next = new Set(prizePickIids);
            next.delete(p.iid);
            prizePickIids = next;
          }, total);
          prizePickTimers.push(timerId);
        });
      });
    }
  });

  function enterHandCard(e: PointerEvent, iid: string) {
    if (dragging) return; // 拖曳中不顯示預覽
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverHandIid = iid;
    hoverHandAnchor = { x: rect.left + rect.width / 2, y: rect.top };
  }
  function leaveHandCard() {
    hoverHandIid = null;
    hoverHandAnchor = null;
  }
  // v5.026 桌墊版：附加卡 hover 放大預覽 — 與 hand 共用同套 float overlay
  function enterAttCard(e: PointerEvent, cardId: string) {
    if (dragging) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // v5.028：viewport-aware 雙向 clamp
    //   - 預設預覽在卡上方（preview bottom 對齊 rect.top）
    //   - 上方空間 < PH 時改顯示在下方
    //   - 兩邊都不夠時 clamp 到視窗邊緣，避免預覽切到視窗外
    const PH = 480;
    const vh = (typeof window !== 'undefined') ? window.innerHeight : 768;
    const spaceAbove = rect.top;
    const spaceBelow = vh - rect.bottom;
    let below: boolean;
    if (spaceAbove >= PH) below = false;
    else if (spaceBelow >= PH) below = true;
    else below = spaceBelow > spaceAbove;  // 都不夠 — 選空間較大那邊
    let y: number;
    if (below) y = Math.min(rect.bottom + 8, Math.max(8, vh - PH - 8));
    // v5.039：上方時 preview top 距 viewport 頂至少 40px（原 8px 太貼頂玩家回報），
    //         戰鬥場 / 高位 attached 卡都不會切到 viewport 頂緣
    else y = Math.max(rect.top, PH + 40);  // 上方時：保證 preview top (= y-PH) >= 40
    hoverAttCardId = cardId;
    hoverAttBelow = below;
    hoverAttAnchor = { x: rect.left + rect.width / 2, y };
  }
  function leaveAttCard() {
    hoverAttCardId = null;
    hoverAttAnchor = null;
    hoverAttBelow = false;
  }

  // ── 傷害數字彈出 + 能量附加 pulse（Session 29 D2） ──────────────────────────
  const lastDamageByIid = new Map<string, number>();
  let damagePops = $state<Array<{ id: number; amount: number; x: number; y: number; heal: boolean }>>([]);
  let energyAttachPulse = $state<string | null>(null); // 剛被附能量的寶可夢 iid
  let energyPulseTimer: ReturnType<typeof setTimeout> | null = null;

  function triggerEnergyPulse(iid: string) {
    if (energyPulseTimer) clearTimeout(energyPulseTimer);
    energyAttachPulse = iid;
    energyPulseTimer = setTimeout(() => { energyAttachPulse = null; }, 700);
  }

  // 監聽每隻場上寶可夢 damage 變化，彈出浮動數字
  $effect(() => {
    if (!game) return;
    const seen = new Set<string>();
    for (const p of game.players) {
      const all = [...(p.active ? [p.active] : []), ...p.bench];
      for (const pk of all) {
        seen.add(pk.iid);
        const prev = lastDamageByIid.get(pk.iid);
        if (prev === undefined) { lastDamageByIid.set(pk.iid, pk.damage); continue; }
        if (pk.damage !== prev) {
          // 用 queueMicrotask 讓 DOM 更新後再查座標（此時 HP bar 已 reactive）
          const diff = pk.damage - prev;
          const iid = pk.iid;
          queueMicrotask(() => {
            const el = document.querySelector(`[data-drop-iid="${iid}"]`) as HTMLElement | null;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const popId = Date.now() + Math.random();
            damagePops = [...damagePops, {
              id: popId, amount: Math.abs(diff),
              heal: diff < 0,
              x: rect.left + rect.width / 2,
              y: rect.top + 20,
            }];
            setTimeout(() => { damagePops = damagePops.filter(d => d.id !== popId); }, 1400);
          });
        }
        lastDamageByIid.set(pk.iid, pk.damage);
      }
    }
    // 清除已不存在的 iid
    for (const iid of [...lastDamageByIid.keys()]) {
      if (!seen.has(iid)) lastDamageByIid.delete(iid);
    }
  });

  // ── v2.42 牌庫洗牌 / 棄牌脈衝 / KO 震動動畫 ──────────────────────────────
  // 洗牌：在 log 裡偵測「洗牌 / 重洗 / 洗回」關鍵字，對應玩家的牌庫圖示做 shake + glow
  // 棄牌脈衝：棄牌區張數變多 → 對應玩家棄牌圖示閃一下
  // KO 震動：寶可夢被打空 HP → 先震動 0.4s 再被移除（利用 Svelte out:transition）
  let shuffleFlashUntil = $state<[number, number]>([0, 0]);      // timestamp（ms）
  let discardFlashUntil = $state<[number, number]>([0, 0]);
  let animLogCursor = 0;                                         // log 游標（與硬幣動畫共用不同的 cursor）
  const prevDiscardLen: [number, number] = [0, 0];
  const shuffleTimers: ReturnType<typeof setTimeout>[] = [];
  const discardTimers: ReturnType<typeof setTimeout>[] = [];

  // 監聽 log 新訊息 → 洗牌動畫
  $effect(() => {
    if (!game || !game.log) { animLogCursor = 0; return; }
    const logs = game.log;
    // v0.71：改用 timestamp 偵測新事件(非 log 長度/索引)，使伺服器 log 截尾(只送最近 N 行)後洗牌動畫仍正常。
    //   animLogCursor 此時語意為「已處理的最大 timestamp」。
    const fresh = logs.filter((e: any) => (e.timestamp ?? 0) > animLogCursor);
    if (fresh.length) animLogCursor = Math.max(animLogCursor, ...fresh.map((e: any) => e.timestamp ?? 0));
    for (const entry of fresh) {
      if (!/(洗牌|重洗|洗回)/.test(entry.message)) continue;
      const idx = entry.playerIndex;
      // 整場洗牌（setup mulligan、裁判、特殊紅牌等）也要給雙方都來一下
      const targets: (0 | 1)[] = idx === 0 || idx === 1 ? [idx] : [0, 1];
      const ts = Date.now() + 600;
      for (const t of targets) {
        const next: [number, number] = [...shuffleFlashUntil];
        next[t] = ts;
        shuffleFlashUntil = next;
        const timerId = setTimeout(() => {
          if (shuffleFlashUntil[t] === ts) {
            const clear: [number, number] = [...shuffleFlashUntil];
            clear[t] = 0;
            shuffleFlashUntil = clear;
          }
        }, 600);
        shuffleTimers.push(timerId);
      }
    }
  });

  // 監聽 discard 張數變化 → 棄牌脈衝
  $effect(() => {
    if (!game) { prevDiscardLen[0] = 0; prevDiscardLen[1] = 0; return; }
    for (const i of [0, 1] as const) {
      const cur = game.players[i].discard.length;
      if (cur > prevDiscardLen[i]) {
        const ts = Date.now() + 500;
        const next: [number, number] = [...discardFlashUntil];
        next[i] = ts;
        discardFlashUntil = next;
        const timerId = setTimeout(() => {
          if (discardFlashUntil[i] === ts) {
            const clear: [number, number] = [...discardFlashUntil];
            clear[i] = 0;
            discardFlashUntil = clear;
          }
        }, 500);
        discardTimers.push(timerId);
      }
      prevDiscardLen[i] = cur;
    }
  });

  // ── v2.45 抽牌飛卡 overlay ────────────────────────────────────────────────
  // Leon feedback：每回合開始抽牌 / 胡地特性 / 富裕能量 / 不公印章 / 莉莉艾的決意 /
  // 裁判 / setup 一開始發 7 張，看不到動畫。希望一張一張發牌、有抽牌的臨場感。
  //
  // 做法：
  //   - 監聽 game.players[*].hand 的 iid 集合差異
  //   - 新 iid 視為「剛抽到」，從對應玩家牌庫位置飛到手牌區（自己往下，對手往上）
  //   - 多張同時進來時 stagger 130ms，玩家看到一張一張飛過去
  //   - face-down card-back 呈現（抽牌當下看不到內容，飛到位後才揭曉 = 實際 hand-card）
  //   - 為避免與既有 hand-card `in:fly` 重疊、看到兩張卡疊著，arrivingIids 讓
  //     hand-card 飛行期間 opacity:0，overlay 卡落地後 remove → hand-card 淡入
  //   - coinFlipStage !== 'done' 時不動（setup 一開始蓋著 coin-overlay 看不到）
  type DrawAnim = {
    id: number;
    playerIdx: 0 | 1;
    iid: string;
    startX: number; startY: number;
    endX: number;   endY: number;
    width: number;  height: number;
    delay: number;  duration: number;
  };
  let drawAnims = $state<DrawAnim[]>([]);
  let arrivingIids = $state<Set<string>>(new Set());
  const prevHandIids: [Set<string>, Set<string>] = [new Set(), new Set()];
  const drawAnimTimers: ReturnType<typeof setTimeout>[] = [];
  const DRAW_ANIM_DUR = 650;  // v5.116：520 → 650ms 拉長讓動畫更明顯
  const DRAW_STAGGER  = 130;
  // v5.116：just-arrived halo — 飛行動畫結束後維持 1500ms glow pulse，玩家更易察覺新卡
  let justArrivedIids = $state<Set<string>>(new Set());
  const JUST_ARRIVED_HOLD_MS = 1500;
  const justArrivedTimers: ReturnType<typeof setTimeout>[] = [];

  $effect(() => {
    if (!game) {
      prevHandIids[0] = new Set();
      prevHandIids[1] = new Set();
      return;
    }
    if (isTReplay) return;  // v5.939 回放:直接落定盤面,不放抽牌飛入動畫(避免 arriving 洩漏/連放)
    // 硬幣動畫還在播時：發牌畫面會被蓋住，不動；等 'done' 後再算 iid 差異
    if (coinFlipStage !== 'done') return;
    for (const pIdx of [0, 1] as const) {
      const curr = game.players[pIdx].hand;
      const currIids = new Set(curr.map(c => c.iid));
      const prev = prevHandIids[pIdx];
      const newIids: string[] = [];
      for (const inst of curr) {
        // v5.131：來自獎賞卡的 iid 跳過 draw-fly（改走 prize-pick 大動畫）
        if (!prev.has(inst.iid) && !prizePickIids.has(inst.iid)) newIids.push(inst.iid);
      }
      prevHandIids[pIdx] = currIids;
      if (newIids.length === 0) continue;
      // 先把新 iid 標記為 arriving（hand-card opacity:0）— 自己的手牌才有 DOM
      if ((pIdx as number) === myIdx) {
        const next = new Set(arrivingIids);
        for (const iid of newIids) next.add(iid);
        arrivingIids = next;
        // v5.932 安全網：無論動畫路徑(deckEl null/microtask 未跑/timer 被清),4s 後強制清除仍殘留的 arriving,
        //   確保手牌絕不會永久隱形需 F5。正常飛入 ~1s 內已清,此 timer 幾乎不會實際動到(僅異常兜底)。
        const guardIids = newIids.slice();
        const guardTimer = setTimeout(() => {
          let changed = false; const g2 = new Set(arrivingIids);
          for (const iid of guardIids) if (g2.has(iid)) { g2.delete(iid); changed = true; }
          if (changed) arrivingIids = g2;
        }, 4000);
        drawAnimTimers.push(guardTimer);
      }
      const capturedNew = newIids.slice();
      // 延遲到下一個 microtask 才量 DOM — 此時 hand 新卡已 render
      queueMicrotask(() => {
        const isMine = (pIdx as number) === myIdx;
        const deckEl = document.querySelector(
          isMine ? '.my-row .pile-slot.deck-pile' : '.opponent-row .pile-slot.deck-pile'
        ) as HTMLElement | null;
        if (!deckEl) {
          // v5.932 根因修 fail-open：量不到牌庫 DOM（開局 coin 動畫剛轉 done、setup 版面尚未 render deck-pile 等）→
          //   放棄飛入動畫,但務必把這批 iid 從 arrivingIids 移除,否則 hand-card 永久 opacity:0+pointer-events:none
          //   → 手牌張數 label 有數字卻一張沒亮、選不了出場,只能 F5。此為玩家回報「畫面沒牌需重整」真根因。
          if (isMine && capturedNew.length) {
            const noAnim = new Set(arrivingIids);
            for (const iid of capturedNew) noAnim.delete(iid);
            arrivingIids = noAnim;
          }
          return;
        }
        const deckRect = deckEl.getBoundingClientRect();
        const startX = deckRect.left + deckRect.width / 2;
        const startY = deckRect.top  + deckRect.height / 2;
        // 自己的手牌區 → 飛到 hand-strip 中心；對手無可見手牌 → 飛到 opponent-row 上方
        let endX: number, endY: number;
        if (isMine) {
          const handEl = document.querySelector('.hand-strip') as HTMLElement | null;
          const handRect = handEl?.getBoundingClientRect();
          endX = handRect ? handRect.left + handRect.width / 2 : window.innerWidth / 2;
          endY = handRect ? handRect.top  + handRect.height / 2 : window.innerHeight - 80;
        } else {
          // v5.049：對手發牌應該飛到「畫面正上方中線」(模擬對手手牌位置 — 對手坐你對面，
          //         他的手牌在他面前 = 你的視角畫面頂部中央)。
          //         v5.047 用對手戰鬥場 (zone-active) 不對 — 那是「對手寶可夢出場位置」
          //         不是「對手手牌位置」。Wilson 回報「怎麼會發向戰鬥寶可夢」。
          // 算法：endX = playmat 水平中心 (用 playmat 不用 viewport，避免 log panel 等
          //       佔右邊空間造成偏左)。endY = playmat top + 20px (頂部下方一點，避開
          //       BETA banner / migration banner 但仍在「頂部中線」視覺)。
          const playmatEl = document.querySelector('.playmat') as HTMLElement | null;
          const playmatRect = playmatEl?.getBoundingClientRect();
          if (playmatRect && playmatRect.width > 0) {
            endX = playmatRect.left + playmatRect.width / 2;
            endY = Math.max(playmatRect.top + 20, 40);  // 至少距 viewport 頂 40px
          } else {
            // fallback：viewport 水平中心 + 頂部 40px
            endX = window.innerWidth / 2;
            endY = 40;
          }
        }
        capturedNew.forEach((iid, i) => {
          const id = Date.now() + Math.random() + i * 0.001;
          const anim: DrawAnim = {
            id, playerIdx: pIdx, iid,
            startX, startY, endX, endY,
            width: 96, height: 128,
            delay: i * DRAW_STAGGER,
            duration: DRAW_ANIM_DUR,
          };
          drawAnims = [...drawAnims, anim];
          const total = anim.delay + anim.duration + 40;
          const timerId = setTimeout(() => {
            drawAnims = drawAnims.filter(d => d.id !== id);
            if (isMine) {
              const next = new Set(arrivingIids);
              next.delete(iid);
              arrivingIids = next;
              // v5.116：飛行結束後標 just-arrived，hand-card 顯示 glow halo 1500ms
              const ja = new Set(justArrivedIids);
              ja.add(iid);
              justArrivedIids = ja;
              const haloTimer = setTimeout(() => {
                const ja2 = new Set(justArrivedIids);
                ja2.delete(iid);
                justArrivedIids = ja2;
              }, JUST_ARRIVED_HOLD_MS);
              justArrivedTimers.push(haloTimer);
            }
          }, total);
          drawAnimTimers.push(timerId);
        });
      });
    }
  });

  onDestroy(() => {
    for (const t of shuffleTimers) clearTimeout(t);
    for (const t of discardTimers) clearTimeout(t);
    for (const t of justArrivedTimers) clearTimeout(t);  // v5.116
    for (const t of prizePickTimers) clearTimeout(t);  // v5.131
    for (const t of drawAnimTimers) clearTimeout(t);
  });

  // ── 硬幣動畫（Session 28；v2.252：升級為 queue 支援連續多次擲幣） ─────────
  // queue 機制：機關槍合擊、滾球、奔進 等「擲到反面前」類招式會連續擲多次硬幣，
  // 每次擲幣 log 一行（格式『… — 正面』/『… — 反面』），UI 解析後逐個 push 到
  // queue 排隊播放（每個 1.4s），玩家能完整看到每次擲幣結果。
  let coinFlip = $state<null | { result: 'heads' | 'tails'; label: string; id: number }>(null);
  let coinFlipQueue = $state<Array<{ result: 'heads' | 'tails'; label: string; id: number }>>([]);
  let coinTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLogProcessed = 0;
  let coinFlipIdCounter = 0; // 每次擲幣獨立 id，讓 {#key} 強制重建 DOM、重播 CSS 動畫
  // 每個 flip 動畫播放時間（含 css 翻轉 + label 顯示）— 太短看不清、太長拖節奏
  const COIN_FLIP_MS = 1400;

  function processCoinQueue() {
    if (coinFlipQueue.length === 0) {
      coinFlip = null;
      coinTimer = null;
      return;
    }
    const next = coinFlipQueue[0];
    coinFlipQueue = coinFlipQueue.slice(1);
    coinFlip = next;
    // v6.048：擲硬幣音效 —— sfx.ts 裡的 playCoin 早就寫好了，但全專案**沒有任何地方呼叫**，
    //   所以擲幣從來沒有聲音。掛在動畫佇列上，與翻面動畫同步；正面/反面用不同音，
    //   讓玩家不用盯著畫面也知道結果。
    try { playSfx(next.result === 'heads' ? 'coin' : 'coin-tails', { force: true }); } catch { /* 音效不影響遊戲 */ }
    coinTimer = setTimeout(processCoinQueue, COIN_FLIP_MS);
  }

  function enqueueCoinFlip(result: 'heads' | 'tails', label: string) {
    coinFlipQueue = [...coinFlipQueue, { result, label, id: coinFlipIdCounter++ }];
    if (!coinFlip) processCoinQueue();
  }

  // 監聽 log 新訊息，自動觸發硬幣動畫
  // v2.252：parser 改寫支援多次擲幣
  //   - 優先 match 「擲硬幣 … — 正面」/「擲硬幣 … — 反面」明確單次格式（破折號 — 後接結果）
  //     → 一條訊息對應一次 flip，依序 push 到 queue
  //   - fallback：includes '正面'/'反面' 的舊式匯總 log（連斬/咬棄/喀嚓喀嚓 等仍 1 次動畫）
  //     避免破壞既有招式（每招總共 1 次動畫，跟舊行為一致）
  $effect(() => {
    if (!game || !game.log) { lastLogProcessed = 0; return; }
    const logs = game.log;
    // v0.71：改用 timestamp 偵測新事件(非 log 長度/索引)，使伺服器 log 截尾後擲幣音效動畫仍正常。
    //   lastLogProcessed 此時語意為「已處理的最大 timestamp」。
    const _maxTs = logs.length ? Math.max(...logs.map((e: any) => e.timestamp ?? 0)) : 0;
    // v5.516：觀戰者不播擲硬幣動畫 — 同步游標但不 enqueue，避免進房時把歷史擲幣全部重播一遍。
    if (isSpectator) { lastLogProcessed = _maxTs; return; }
    const fresh = logs.filter((e: any) => (e.timestamp ?? 0) > lastLogProcessed);
    lastLogProcessed = _maxTs;
    for (const entry of fresh) {
      const msg = entry.message;
      // setup 先手特例（保留現有邏輯）
      if (msg.includes('擲硬幣') && msg.includes('先手')) {
        const winnerName = msg.replace(/^🪙?\s*擲硬幣：\s*/, '').replace(/\s*先手.*$/, '');
        enqueueCoinFlip(Math.random() < 0.5 ? 'heads' : 'tails', `${winnerName} 先手`);
        continue;
      }
      for (const event of parseCoinFlipAnimationEvents(msg)) {
        enqueueCoinFlip(event.result, event.label);
      }
    }
  });

  // ── 拖曳交互（v1.03 擴增 trainer 類） ─────────────────────────────────────
  // ⭐v6.200：DragKind 不再在這裡自己列舉一份 —— 與「可用操作」同源（hand-card-ops.ts）。
  //   ⚠ 少列一種（v6.080 新增手牌特性時就是這樣）＝ 那種操作永遠拖不動。
  type DragKind = HandDragKind;
  let dragging = $state<null | {
    iid: string; kind: DragKind; cardId: string; cardName: string;
    /** ⭐v6.200 拖曳當下的可用操作集合快照；釋放時只查它（handOpForDropTarget），禁再寫一份 kind 對照 */
    ops: HandCardOp[];
    imageUrl: string;
    x: number; y: number;        // 當前滑鼠位置
    startX: number; startY: number;
    moved: boolean;              // 是否超出門檻視為「拖曳」
  }>(null);
  let dropTargetIid = $state<string | null>(null); // 當前 hover 的 drop target iid（寶可夢）
  let dropBenchEmpty = $state(false);              // 當前 hover 的是否為空備戰格
  let dropActiveEmpty = $state(false);             // Setup 階段 hover 空戰鬥場
  const DRAG_THRESHOLD = 6; // px

  // ⭐v6.200：startDrag 只收「可用操作集合」，kind 由中央 handCardDragKind 推導 ——
  //   呼叫端沒辦法自己決定「哪些卡可以拖」，杜絕第二份判定。
  function startDrag(e: PointerEvent, inst: CardInstance, ops: ReadonlySet<HandCardOp>, card: Card) {
    if (e.button !== 0) return;
    const kind = handCardDragKind(ops);
    if (!kind) return;
    // 若 pointerdown 落在 button / 連結等互動元件，不啟動 drag —
    // 讓按鈕的 click 事件正常觸發（否則 pointer capture 會吃掉 click）
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;
    hoverHandIid = null; hoverHandAnchor = null;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    dragging = {
      iid: inst.iid, kind, ops: [...ops], cardId: inst.cardId, cardName: card.name,
      imageUrl: card.imageUrl,
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      moved: false,
    };
  }

  function onWindowPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const dy = e.clientY - dragging.startY;
    if (!dragging.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragging.moved = true;
    dragging.x = e.clientX;
    dragging.y = e.clientY;

    if (dragging.moved) {
      // 用 elementFromPoint + closest 向上爬到 drop target 容器
      const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const el = hit?.closest('[data-drop-type]') as HTMLElement | null;
      if (el) {
        const type = el.dataset.dropType;
        if (type === 'poke') {
          dropTargetIid = el.dataset.dropIid ?? null;
          dropBenchEmpty = false;
          dropActiveEmpty = false;
        } else if (type === 'bench-empty') {
          dropTargetIid = null;
          dropBenchEmpty = true;
          dropActiveEmpty = false;
        } else if (type === 'active-empty') {
          dropTargetIid = null;
          dropBenchEmpty = false;
          dropActiveEmpty = true;
        } else {
          dropTargetIid = null;
          dropBenchEmpty = false;
          dropActiveEmpty = false;
        }
      } else {
        dropTargetIid = null;
        dropBenchEmpty = false;
        dropActiveEmpty = false;
        // Debug：拖曳 basic 但沒碰到 drop target 時印出 hit 元素幫 debug
        if (dragging.ops.includes('basic') && hit) {
          const hitInfo = hit.tagName + (hit.className ? '.' + String(hit.className).split(' ')[0] : '') + (hit.id ? '#' + hit.id : '');
          const benches = document.querySelectorAll('[data-drop-type="bench-empty"]');
          if ((window as any).__ptcgDragLog !== hitInfo) {
            (window as any).__ptcgDragLog = hitInfo;
            console.log('[PTCG drag]', { hit: hitInfo, benchEmptyCount: benches.length, mouse: { x: e.clientX, y: e.clientY } });
          }
        }
      }
    }
  }

  async function onWindowPointerUp(e: PointerEvent) {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    const tIid = dropTargetIid;
    const benchEmpty = dropBenchEmpty;
    const activeEmpty = dropActiveEmpty;
    dropTargetIid = null;
    dropBenchEmpty = false;
    dropActiveEmpty = false;

    if (!d.moved) return; // 單純 click — onclick handler 會處理
    if (!isMyTurn() || pendingSelection) return;

    // ⭐⭐⭐v6.200：「釋放在哪 → 結算成哪個操作」一律查中央 handOpForDropTarget。
    //   這裡**禁止**再寫一份 `if (kind === 'xxx')` 的可用性判斷 —— 那正是
    //   v6.199 之前 dragKind 漏掉手牌特性（烈箭鷹ex｜激動俯衝拖不動）的成因。
    //   落在寶可夢/備戰格/戰鬥場上時先問該釋放區；問不到再退回「整張桌墊」
    //   （支援者/物品/競技場沒有專屬釋放區，蓋在寶可夢上放開也算使用 — 保持 v1.03 行為）。
    const dOps = new Set<HandCardOp>(d.ops);
    const dropZone: HandDropTarget | null =
      tIid ? 'poke' : benchEmpty ? 'bench-empty' : activeEmpty ? 'active-empty' : null;
    const op = (dropZone ? handOpForDropTarget(dOps, dropZone) : null)
      ?? handOpForDropTarget(dOps, 'playmat');
    if (!op) return;

    if (op === 'energy' && tIid) {
      await dispatch(GameActions.attachEnergy(d.iid, tIid));
    } else if (op === 'setup-active' && activeEmpty && !myPlayer?.active) {
      await dispatch(GameActions.placeActive(d.iid, myIdx));
    } else if (op === 'basic-setup' && benchEmpty && myPlayer?.active) {
      await dispatch(GameActions.benchPokemon(d.iid, myIdx));
    } else if (op === 'basic' && benchEmpty) {
      await dispatch(GameActions.playBasic(d.iid));
    } else if (op === 'fossil') {
      // v2.189 化石 Item 拖到備戰格：作為 HP60【無】基礎寶可夢上場
      if (benchEmpty) {
        await dispatch(GameActions.playFossil(d.iid));
      }
    } else if (op === 'hand-ability' && benchEmpty) {
      // ⭐v6.200 玩家回報：烈箭鷹ex｜激動俯衝（M6）條件成立時桌機拖不動（只能點）。
      //   手牌特性一律「把這張卡放到備戰區」→ 釋放區＝空備戰格，與基礎寶可夢同一格。
      //   abilityIndex 由中央 gate 提供（同名多特性卡不能硬編 0）。
      const meta = handActivateAbilities.get(d.iid);
      if (meta) await dispatch(GameActions.useHandAbility(d.iid, meta.abilityIndex));
    } else if (op === 'evolve' && tIid) {
      // 確認目標在合法進化清單裡
      if (evolveTargetsFor(d.iid).includes(tIid)) {
        await dispatch(GameActions.evolve(tIid, d.iid));
      }
    } else if (op === 'trainer') {
      // 支援者/物品/競技場 — 只有釋放點落在 .playmat（綠色虛線釋放區）內才算使用；
      // 拖回手牌 / 拖到非釋放區 / 拖到視窗外 → 一律視為取消，不 dispatch。
      // 其他 kind（basic/evolve/tool）靠 tIid / benchEmpty / activeEmpty 自然具備 cancel 行為，
      // 只有 trainer 因為沒有特定 drop target，之前漏做這個檢查。
      const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const inPlaymat = !!hit?.closest('.playmat');
      const inHand = !!hit?.closest('.hand-strip');
      if (inPlaymat && !inHand) {
        await dispatch(GameActions.playTrainer(d.iid));
      }
      // else: 取消使用（手牌保留）
    } else if (op === 'tool' && tIid) {
      // 檢查目標是否已有道具（一隻只能附加一個，除非有特性）
      const allMy = [...(myPlayer?.active ? [myPlayer.active] : []), ...(myPlayer?.bench ?? [])];
      const target = allMy.find(p => p.iid === tIid);
      if (target?.toolAttached) {
        // v3.20 多重轉接：洛托姆家族 + 自方場上有洛托姆ex 多重轉接 → 可附第 2 張
        const targetCard = getCard(target.cardId);
        const isLotomFam = (targetCard?.name ?? '').includes('洛托姆');
        const myAll = [...(myPlayer?.active ? [myPlayer.active] : []), ...(myPlayer?.bench ?? [])];
        const hasMultiRelay = myAll.some(p => {
          const c = getCard(p.cardId);
          return c?.name === '洛托姆ex' && c.abilities?.some(a => a.name === '多重轉接');
        });
        const extraCount = target.extraTools?.length ?? 0;
        if (!(isLotomFam && hasMultiRelay && extraCount < 1)) {
          alert(`「${targetCard?.name ?? '該寶可夢'}」已附有道具，無法再附加（一隻寶可夢只能附加一個道具）。`);
          return;
        }
      }
      // 打出道具 → 觸發 pendingSelection（attach-tool）→ 用 drop target 直接 resolve。
      // v5.413：拖曳自動解這段期間抑制 attach-tool 選擇 modal 渲染，避免線上拖曳附加道具時
      //   「playTrainer 開 modal → resolveSelection 關 modal」中間 render 一次造成 modal 閃現。
      suppressToolSelectModal = true;
      try {
        await dispatch(GameActions.playTrainer(d.iid));
        const sel = game?.pendingSelection;
        if (sel?.effectKey === 'attach-tool') {
          const validIids = (sel.params?.validIids as string[] | undefined) ?? [];
          if (validIids.includes(tIid)) {
            const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
            await dispatch(GameActions.resolveSelection([tIid], sid, (sel as { token?: number }).token));
          }
        }
      } finally {
        suppressToolSelectModal = false;
      }
    }
  }

  // 對戰結束後匯出 log（.txt 給玩家肉眼復盤；.json 給外部工具分析）
  // v5.090：strip cardLink marker（\uE100<iid>\uE101<name>\uE102 PUA 字元）→ 純 name。
  //   匯出 log 時若不處理，PUA 字元在文字編輯器顯示「?」+ 後續 iid 亂碼（玩家回報）。
  //   tokenizer 在 UI 端正常解析 marker 顯示卡名 button，但匯出純文字檔需手動 strip。
  function stripCardLinkMarkers(s: string): string {
    if (!s) return s;
    // capture group 1 = name；group 0 = 整個 marker（含 iid + PUA boundary）
    return s.replace(/\uE100[^\uE100\uE101\uE102]+\uE101([^\uE100\uE101\uE102]+)\uE102/g, '$1');
  }
  function exportLogAs(format: 'txt' | 'json') {
    if (!game) return;
    const ts = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
    const p0 = game.players[0]?.name ?? 'P0';
    const p1 = game.players[1]?.name ?? 'P1';
    const winnerName = game.winner !== null && game.winner !== undefined ? (game.players[game.winner]?.name ?? '?') : '?';
    const reason = game.winReason ?? '';
    let blob: Blob;
    let filename: string;
    if (format === 'txt') {
      const lines: string[] = [];
      lines.push(`=== PTCG 對戰紀錄 ===`);
      lines.push(`匯出時間：${ts.toISOString()}`);
      lines.push(`玩家：${p0}（P0）vs ${p1}（P1）`);
      lines.push(`勝者：${winnerName}`);
      lines.push(`原因：${reason}`);
      lines.push(`版本：v${VERSION}`);
      lines.push(`==================`);
      for (const e of (game.log ?? [])) {
        const who = e.playerIndex === 0 ? `[T${e.turn} P0:${p0}]`
                  : e.playerIndex === 1 ? `[T${e.turn} P1:${p1}]`
                  : `[T${e.turn} —]`;
        // v2.130：玩家匯出時自己看私有訊息；對手看公開版
        const text = (e.privateMessage && e.playerIndex === myIdx) ? e.privateMessage : e.message;
        lines.push(`${who} ${stripCardLinkMarkers(text ?? '')}`);
      }
      blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      filename = `ptcg-log-${stamp}.txt`;
    } else {
      // v5.090：JSON 匯出也 strip 一份 message（保留原 message 做 raw 欄位，新增 messageDisplay 為純文字）
      const cleanLog = (game.log ?? []).map(e => ({
        ...e,
        message: stripCardLinkMarkers(e.message ?? ''),
        ...(e.privateMessage ? { privateMessage: stripCardLinkMarkers(e.privateMessage) } : {}),
      }));
      const payload = {
        meta: {
          exportedAt: ts.toISOString(),
          version: VERSION,
          players: [p0, p1],
          winner: game.winner,
          winnerName,
          winReason: reason,
          finalTurn: game.turn,
        },
        log: cleanLog,
      };
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      filename = `ptcg-log-${stamp}.json`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openZoom(cardId: string, inst: CardInstance | null = null) {
    const c = pool.get(cardId);
    if (!c) return;
    // 若已有 zoom 開啟，把當前推入堆疊（供「返回」用）
    if (zoomCard) zoomStack = [...zoomStack, { card: zoomCard, inst: zoomInst }];
    zoomCard = c; zoomInst = inst;
  }
  function closeZoom() { zoomCard = null; zoomInst = null; zoomStack = []; }
  function popZoom() {
    if (zoomStack.length === 0) { closeZoom(); return; }
    const last = zoomStack[zoomStack.length - 1];
    zoomStack = zoomStack.slice(0, -1);
    zoomCard = last.card;
    zoomInst = last.inst;
  }

  // v3.02：log 內卡名 -> 可點按鈕
  // - cardNamesSorted：從 pool.values() 取唯一卡名，由長到短排序，
  //   讓「瑪俐的搗蛋小妖」優先匹配於「搗蛋小妖」（避免短名遮蔽長名）
  // - openZoomByName：log 卡名按鈕點擊時，找 pool 中第一個同名 Card 後呼叫 openZoom
  // - 同名多版本（不同 set 同名卡）取第一個即可，使用者可在 zoom 內看到實體
  let cardNamesSorted = $derived.by(() => {
    if (!poolReady) return [] as string[];
    const seen = new Set<string>();
    const arr: string[] = [];
    for (const c of pool.values()) {
      if (!c?.name) continue;
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      arr.push(c.name);
    }
    // 由長到短排序：longest-match-first 必須條件
    arr.sort((a, b) => b.length - a.length);
    return arr;
  });
  // v5.034：beta 站還原 — 移除 v4.935 加的 github.io → .com 強制 redirect。
  //   現況：github.io 當 beta 測試站（Firebase backend），.com 當正式站（Oracle backend）。
  //   build-time ORACLE_MODE 已自動切後端，按鈕只需切 mode='online' 即可。
  //   兩個站資料庫不互通 — beta 測試房間不會影響正式站玩家，正是設計上想要的隔離。
  function onClickOnlineMode() {
    mode = 'online';
  }

  function openZoomByName(cardName: string, hintSourceIid?: string, hintPlayerIdx?: 0 | 1 | null) {
    // v5.955：log 卡名點擊 → 共用 resolveLogCard 解析到「本場實體卡」(正確印刷/卡圖)。
    //   搜雙方所有 zone(active/bench/場地/discard/hand/prizes/deck + 巢狀能量道具/進化來源),
    //   永不落到全域 pool 第一個同名(那會抓到玩家根本沒帶的印刷)。找不到才 fallback。
    if (game && poolReady) {
      const r = resolveLogCard(game, pool, cardName, hintSourceIid, hintPlayerIdx);
      if (r) { openZoom(r.cardId, r.inst); return; }
    }
    // fallback：本場所有區都找不到 → 全域 pool 第一個同名 Card(宣言型效果/系統訊息)
    for (const c of pool.values()) {
      if (c?.name === cardName) { openZoom(c.id); return; }
    }
  }
  function openFloatingEvo(fromIid: string, evoOpts: CardInstance[], e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    floatingEvoMenu = { fromIid, evoOpts, x: rect.left + rect.width / 2, y: rect.top };
  }
  function openFloatingRetreat(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    floatingRetreatMenu = { x: rect.left + rect.width / 2, y: rect.top };
  }
  // v5.005 admin matchRecords — game-over 時 fire POST 永久紀錄到 Oracle MongoDB
  //   防多次 fire：用 recordedMatchId state + game.id（同場 game.id 一致）
  //   v5.409 去單點：線上 P1+P2 皆 fire（P1 斷線時 P2 仍寫）；server 用 matchId $setOnInsert upsert 去重；本機唯一 client fire
  //   admin spy (isAdminMode) 跳過，避免污染統計
  $effect(() => {
    if (!game || game.phase !== 'game-over') return;
    if (recordedMatchId === game.id) return;  // 已記錄
    if (isAdminMode) return;                  // admin spy 不寫
    // v5.409：線上 P1 或 P2 皆 fire（觀戰者 mySeatIdx=-1 跳過）；server $setOnInsert 防重複
    if (mode === 'online' && mySeatIdx !== 0 && mySeatIdx !== 1) return;
    recordedMatchId = game.id;
    fireMatchRecord(game);
  });

  // v5.005 匯出對戰紀錄到 Oracle backend (matchRecords collection)
  //   email source：線上 → roomData.seats[0/1].email；本機 → P1 用 firebaseUser?.email
  //   cardIds aggregate：deck/hand/bench/active/discard/prizes + evolvedFromStack 去重
  async function fireMatchRecord(g: GameState) {
    const apiUrl = (((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '';
    if (!apiUrl) return;  // 只 Oracle build 記錄；GitHub Pages build 跳過
    // v5.006 改：Aggregate cardId → count (deck/hand/bench/active/discard/prizes + evolvedFromStack)
    // 每個 card instance 算 1 張；evolvedFromStack 內每張歷代進化前也算 1 張（牌組原本就有）。
    // 用 Record<string, number> 而非 Set，admin 牌組 modal 才能顯示「× N」張數。
    function collectCardCounts(p: GameState['players'][0]): Record<string, number> {
      const counts: Record<string, number> = {};
      const add = (id: string): void => { counts[id] = (counts[id] ?? 0) + 1; };
      const visit = (c: CardInstance | null | undefined): void => {
        if (!c) return;
        add(c.cardId);
        for (const e of c.evolvedFromStack ?? []) add(e.cardId);
        // v5.532：補計入場上寶可夢身上附加的能量與道具。先前只統計寶可夢本體與進化前卡，
        //   漏掉 energyAttached / toolAttached / extraTools → 對戰結束時仍存活、身上帶能量或
        //   道具的寶可夢，其附加卡未被計入 → 牌組張數顯示不足 60（敗方場面已清空故正常 60）。
        //   附加卡（能量/道具）皆無巢狀附加，直接 add 即可、不會重複計算。
        for (const en of c.energyAttached ?? []) add(en.cardId);
        if (c.toolAttached) add(c.toolAttached.cardId);
        for (const t of c.extraTools ?? []) add(t.cardId);
      };
      for (const c of p.deck) visit(c);
      for (const c of p.hand) visit(c);
      for (const c of p.bench) visit(c);
      visit(p.active);
      for (const c of p.discard) visit(c);
      for (const c of p.prizes) visit(c);
      return counts;
    }
    // email source 分流：online 用 roomData.seats，local 用 firebaseUser（P1 only）
    let p1Email: string | null = null;
    let p2Email: string | null = null;
    if (mode === 'online' && roomData?.seats) {
      p1Email = roomData.seats[0]?.email ?? null;
      p2Email = roomData.seats[1]?.email ?? null;
    } else {
      // 本機模式：P1 = current login user, P2 = AI/匿名對手
      p1Email = firebaseUser?.email ?? null;
    }
    const payload = {
      matchId: g.id,
      roomCode: roomCode || null,
      mode: mode === 'online' ? 'online' : 'local',
      vsAI: aiPlayerIndex !== null,
      aiSide: aiPlayerIndex,
      winner: g.winner ?? null,
      winReason: g.winReason ?? '',
      finalTurn: g.turn,
      durationMs: g.gameStartTime ? (Date.now() - g.gameStartTime) : 0,
      startedAt: g.gameStartTime ?? null,
      endedAt: Date.now(),
      p1: {
        name: g.players[0]?.name ?? 'P1',
        email: p1Email,
        cardCounts: collectCardCounts(g.players[0]),
      },
      p2: {
        name: g.players[1]?.name ?? 'P2',
        email: p2Email,
        cardCounts: collectCardCounts(g.players[1]),
      },
    };
    try {
      await fetch(`${apiUrl}/api/match-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // 統計失敗不影響遊戲，靜默處理
    }
  }

  function onGlobalKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // v2.129：lightbox 最上層，Esc 先關 lightbox
      if (lightboxUrl) { closeLightboxImg(); return; }
      // 若 zoom 有堆疊，Escape 先彈回上一層，沒堆疊才全關
      if (zoomCard && zoomStack.length > 0) { popZoom(); return; }
      closeZoom(); floatingEvoMenu = null; floatingRetreatMenu = null;
      viewDiscardFor = null; selectionPicked = new Set(); selectionCounts = {};
    }
  }

  // ── AI 驅動迴圈 ──────────────────────────────────────────────────────────────
  function scheduleAI() {
    if (aiTimer !== null) return; // 已排程中
    const delay = aiThinking ? 250 : 500; // 第一步慢一點（看起來像在思考）
    aiTimer = setTimeout(() => {
      aiTimer = null;
      tickAI();
    }, delay);
  }

  // v5.617：AI 無進展防呆 — 連續若干次行動後盤面 signature 完全沒變(動作被引擎拒絕無法執行,
  //   如富裕能量被 ACE消弭擋/祭典樂舞第二擊無能量) → AI 卡住、回合結束不了。偵測到即強制 END_TURN。
  let _aiPrevSig = '';
  let _aiStuck = 0;
  function tickAI() {
    if (!game || !poolReady || aiPlayerIndex === null) return;
    // v5.351：鐵 gate — 線上對局(有 roomCode)永不跑 AI 驅動。aiPlayerIndex 線上預設 1(給 UI)，
    //   若 mode 尚未設成 'online' 的空窗，舊 mode gate 會失效讓 AI 迴圈空轉(setTimeout 無限重排
    //   想幫真人對手在 setup 行動 → 主執行緒卡死 + setupDone 死結)。roomCode 在 game 出現前就已設。
    if (roomCode || roomData) return; // v5.355：三重 gate(roomCode/roomData)— 在房間裡一律不跑 AI 驅動
    if (game.phase === 'game-over') return;

    // 判斷是否該 AI 行動
    const shouldAct = (() => {
      const ai = aiPlayerIndex;
      const g = game!;
      // v5.138：mulliganPostBenchOpen=true 時 AI 也要行動（送 FINISH_MULLIGAN_POST_BENCH）
      if (g.phase === 'setup') return !!g.openingChoicePending?.[ai] || !g.setupDone[ai] || (g.pendingMulliganDraw?.[ai] ?? 0) > 0 || !!g.mulliganPostBenchOpen?.[ai] || !g.mulliganRevealConfirmed?.[ai]; // v5.198 補 mulliganRevealConfirmed gate (雙方都 mulligan 時 AI 卡死) / v6.051 批2 補 openingChoicePending
      if (g.phase !== 'playing') return false;

      // 取獎賞卡或選擇 — 由誰的行動決定
      if ((g.pendingPrizes?.[ai] ?? 0) > 0) return true;
      if (g.pendingSelection) return g.pendingSelection.actorIdx === ai;

      // v2.145：戰鬥寶可夢被擊倒（包含特性如腎上腺腦力 KO）→ 不論 turnPhase 都應立即遞補
      //   — 之前只在 turnPhase==='end' 觸發，對手回合內被特性 KO 時 AI 不會自動補，
      //     卡住玩家無法 END_TURN（因為 engine 端 END_TURN gate 要求對手 active 不為 null）。
      if (g.players[ai].active === null && g.players[ai].bench.length > 0) return true;

      // Bug fix (#21): 席多藍恩打死喵喵ex後 — end 階段但對手 active 為空，
      // 等對手先送出新寶可夢，AI 此時不行動（避免 END_TURN 被 engine 拒絕的無限迴圈）
      const dIdx = (1 - ai) as 0 | 1;
      if (g.turnPhase === 'end' && g.players[dIdx].active === null) return false;

      // 正常輪到自己
      return g.activePlayerIndex === ai;
    })();

    if (!shouldAct) return;

    // v5.617 無進展防呆：若盤面 signature 與上一個 AI tick 完全相同(上次 dispatch 被拒、毫無進展)，
    //   累計；連續 2 次無進展 → AI 卡在無法執行的動作 → 主階段強制 END_TURN(同 null-fallback 條件)。
    {
      const _g = game!;
      const _aip = _g.players[aiPlayerIndex];
      // v5.639：移除 log.length（被引擎拒絕但有寫警告 log 的動作會讓 log 每 tick 變長→sig 一直變→
      //   無進展防呆永遠不觸發→AI 卡死，例：古舊能量被 ACE消弭 擋）。改用「實際盤面進展」欄位：
      //   牌庫/棄牌/手牌張數 + 場上能量總數 + 場上/備戰 + pending；純加警告 log 不算進展。
      const _eTot = (_aip.active?.energyAttached.length ?? 0) + _aip.bench.reduce((nn, c) => nn + c.energyAttached.length, 0);
      const _sig = `${_g.phase}|${_g.turn}|${_g.turnPhase}|${_g.activePlayerIndex}|${_g.players[0].hand.length}|${_g.players[1].hand.length}|${_aip.bench.length}|${_aip.active?.iid ?? ''}|${_g.pendingSelection?.effectKey ?? ''}|${_g.pendingPrizes?.[0] ?? 0}|${_g.pendingPrizes?.[1] ?? 0}|${_aip.deck.length}|${_aip.discard.length}|${_eTot}`;
      if (_sig === _aiPrevSig) _aiStuck++; else { _aiStuck = 0; _aiPrevSig = _sig; }
      if (_aiStuck >= 2) {
        _aiStuck = 0; _aiPrevSig = '';
        // ⭐⭐⭐ v6.175（Fable 5 審查抓到的軟鎖）：engine 端新增「選擇整批不合法 ⇒ 不關 pending」的閘之後，
        //   AI 送出不合法選擇時盤面 signature 完全不變（那個閘只動 log，而 log 刻意不在 sig 裡），
        //   於是這裡連續兩次無進展就進到本分支 —— 但下面的強制 END_TURN 要求 `!pendingSelection`，
        //   pending 還在就直接 return、不 dispatch、不 scheduleAI ⇒ **AI 從此不再有任何 tick**（真死結）。
        //   ⇒ pending 還在時，先用「空選擇」把它解掉（＝v6.174 以前的行為），保證一定有進展。
        if (_g.pendingSelection && _g.pendingSelection.actorIdx === aiPlayerIndex) {
          console.warn('[AI no-progress guard] AI 連續無進展且 pending 未解 → 以空選擇強制推進');
          aiThinking = true;
          dispatch(GameActions.resolveSelection([], undefined, _g.pendingSelection.token), { fromAI: true });
          scheduleAI();
          return;
        }
        if (_g.phase === 'playing' && _g.activePlayerIndex === aiPlayerIndex && _g.turnPhase === 'main'
            && !_g.pendingSelection && (_g.pendingPrizes?.[0] ?? 0) === 0 && (_g.pendingPrizes?.[1] ?? 0) === 0) {
          console.warn('[AI no-progress guard] AI 連續無進展(動作被拒) → 強制 END_TURN');
          aiThinking = true;
          dispatch({ type: 'END_TURN' } as any, { fromAI: true });
          scheduleAI();
        }
        return;
      }
    }

    const action = getAIAction(game!, pool, aiPlayerIndex);
    if (!action) {
      // v2.131：AI 應該行動但 getAIAction 拿不到 action — 防呆：在主階段就強制 END_TURN
      //   避免 AI 卡住（曾發生於某 corner case：扭轉乾坤後 AI 沒下一步）。
      const g = game!;
      if (g.phase === 'playing'
          && g.activePlayerIndex === aiPlayerIndex
          && g.turnPhase === 'main'
          && !g.pendingSelection
          && (g.pendingPrizes?.[0] ?? 0) === 0
          && (g.pendingPrizes?.[1] ?? 0) === 0) {
        console.warn('[AI fallback] getAIAction returned null in main phase → forcing END_TURN');
        aiThinking = true;
        dispatch({ type: 'END_TURN' } as any, { fromAI: true });
        scheduleAI();
      }
      return;
    }

    aiThinking = true;
    dispatch(action as any, { fromAI: true });
    // 繼續排程下一步（直到 AI 不再需要行動）
    scheduleAI();
  }

  // v3.81：監聽 myPendingPrizes — 出現時啟動 10s 倒數，timeout 後自動取
  //   修本機雙人模式 take-prize 卡死（自身 KO 後 pendingPrizes 在對手側，玩家若沒點就無限等）
  // v5.199：觀戰者跳過 — 不該幫他人自動取獎賞
  $effect(() => {
    if (!game || isSpectator) return;
    const pending = myPendingPrizes;
    if (pending > 0) {
      if (takePrizeTimerId === null) {
        takePrizeCountdown = 10;
        takePrizeTimerId = setInterval(() => {
          takePrizeCountdown -= 1;
          if (takePrizeCountdown <= 0) {
            // 自動取
            if (takePrizeTimerId !== null) {
              clearInterval(takePrizeTimerId);
              takePrizeTimerId = null;
            }
            if (game && myPendingPrizes > 0) {
              // v6.147：自動取獎撞上動作送出中 → 會被丟棄並跳紅字，玩家完全不知道那是自動
              //   計時器發的。直接跳過這一次（計時器會再排）。
              // ⭐⭐v6.172（Fable 5 審查抓到）守衛必須換成 `actionSending` —— `actionBusy` 的語義
              //   已經改成「佇列已滿」，繼續守它等於**自動動作也會被排進佇列**，網路恢復時補送一個
              //   玩家早就不想要的動作。自動計時器不是玩家手勢，跳過這一次就好（它會自己再來）。
              if (actionSending) return;
              dispatch(GameActions.takePrizes(myPendingPrizes, myIdx, myIdx));
            }
          }
        }, 1000);
      }
    } else {
      // pending 變 0 → 清計時器
      if (takePrizeTimerId !== null) {
        clearInterval(takePrizeTimerId);
        takePrizeTimerId = null;
      }
      takePrizeCountdown = 0;
    }
  });

  // 監聽 game 變化：若 AI 需要行動則排程
  $effect(() => {
    if (!game || aiPlayerIndex === null || mode === 'online' || roomCode || roomData) return; // v5.351/v5.355：roomCode+roomData 三重鐵 gate，防 mode 未設好空窗誤跑 AI 迴圈
    const g = game;
    const ai = aiPlayerIndex;
    if (g.phase === 'game-over') { aiThinking = false; return; }

    const shouldAct = (() => {
      // v5.138：mulliganPostBenchOpen=true 時也要 scheduleAI
      if (g.phase === 'setup') return !!g.openingChoicePending?.[ai] || !g.setupDone[ai] || (g.pendingMulliganDraw?.[ai] ?? 0) > 0 || !!g.mulliganPostBenchOpen?.[ai] || !g.mulliganRevealConfirmed?.[ai]; // v5.198 補 mulliganRevealConfirmed gate (雙方都 mulligan 時 AI 卡死) / v6.051 批2 補 openingChoicePending
      if (g.phase !== 'playing') return false;
      if ((g.pendingPrizes?.[ai] ?? 0) > 0) return true;
      if (g.pendingSelection) return g.pendingSelection.actorIdx === ai;
      // v2.145：active===null 不論 turnPhase 都立即遞補（特性 KO 對手後也要立刻動）
      if (g.players[ai].active === null && g.players[ai].bench.length > 0) return true;
      // Bug fix (#21): end 階段但對手 active 為空 → 等對手補場，AI 不排程（避免迴圈）
      const dIdxE = (1 - ai) as 0 | 1;
      if (g.turnPhase === 'end' && g.players[dIdxE].active === null) return false;
      return g.activePlayerIndex === ai;
    })();

    if (shouldAct) {
      scheduleAI();
    } else {
      aiThinking = false;
      if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    }
  });

  // v2.198 自動結束回合：依 PTCG 官方規則，「使用招式後（含招式內所有結算 — 傷害、分配指示物、
  //   獎賞卡、補戰鬥位）」回合即結束，玩家不需手動按結束回合。
  // 觸發條件 = canEndTurn（turnPhase==='end' + 無 pending）+ 玩家身分匹配當前回合方。
  // 加 600ms 延遲讓玩家看清楚結算結果（KO 動畫 / 獎賞 / 新戰鬥位等）。
  // - 本機雙人模式：永遠由當前 activePlayerIndex 那側自動觸發
  // - 線上模式：只有自己是 activePlayerIndex 時自動觸發（避免雙端同時 dispatch END_TURN）
  // - AI 模式：activePlayerIndex 是 AI 時讓 AI 迴圈自己處理（getAIAction 會回傳 END_TURN）
  // 結束回合按鈕仍保留作為 fallback / 玩家想立即跳過 600ms 等待。
  let autoEndTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    // 取消前一個 timer（state 變動時重新評估）
    if (autoEndTimer !== null) { clearTimeout(autoEndTimer); autoEndTimer = null; }
    if (!game || !poolReady) return;
    const g = game;
    if (g.phase !== 'playing') return;
    if (g.turnPhase !== 'end') return;
    if (hasPendingActions(g)) return;

    // 線上：只有當前 active player 自己那一端可自動觸發
    // v2.332 fix：不能用 turn%2 判斷，因為本遊戲的 turn 不會在每次換手時 +1。
    // 直接以 engine 維護的 activePlayerIndex 為準，與 isMyTurn / AI 判斷保持一致。
    if (mode === 'online') {
      if (myPlayerIndex === null) return;
      if (g.activePlayerIndex !== myPlayerIndex) return;
    }
    // AI 模式：AI 是當前活動玩家時讓 AI 迴圈處理。
    // v2.333 fix：線上模式也保留 aiPlayerIndex 預設值 1（UI 用），不能用它阻擋 P2 自動結束。
    if (mode !== 'online' && aiPlayerIndex !== null && g.activePlayerIndex === aiPlayerIndex) return;
    // v4.792：練習模式不再暫停 auto-end（v4.74 / v4.75 的舊行為已 revert）。
    //   舊行為：練習模式有 undoSnapshot 時暫停自動結束回合，等玩家決定悔棋 or 繼續。
    //   玩家回饋：暫停讓遊戲節奏卡卡，希望恢復順暢。
    //   新行為：練習模式也照樣 600ms 後自動結束回合。要悔棋的話：(a) 在 600ms 內按悔棋
    //   按鈕；(b) 或先把結束回合的 600ms timer 想成最後機會。auto-end 觸發 END_TURN 後
    //   snapshot 會被清掉（見 dispatch() 的 if action.type==='END_TURN' 分支）。

    // 延遲後若條件仍成立（沒被新 pending / KO / 取獎賞中斷）就 dispatch
    autoEndTimer = setTimeout(() => {
      autoEndTimer = null;
      if (!game) return;
      if (game.phase !== 'playing') return;
      if (game.turnPhase !== 'end') return;
      if (hasPendingActions(game)) return;
      if (mode === 'online') {
        if (myPlayerIndex === null) return;
        if (game.activePlayerIndex !== myPlayerIndex) return;
      }
      if (mode !== 'online' && aiPlayerIndex !== null && game.activePlayerIndex === aiPlayerIndex) return;
      // ⭐⭐⭐v6.172（Fable 5 審查抓到）同上，而且這一個更嚴重：END_TURN 若被排進佇列，
      //   前一發被伺服器拒絕時它仍可能被送出去 ⇒ **玩家還沒攻擊就被換手**。守 actionSending。
      if (actionSending) return;   // v6.147 同上：自動結束回合撞上送出中 → 跳過這一次
      dispatch(GameActions.endTurn());
    }, 600);
  });

  // v2.206 手機自動鎖橫屏：進戰鬥畫面（game !== null）時 try Screen Orientation API。
  //   - Android Chrome（fullscreen 下）：lock('landscape') 會旋轉並鎖定
  //   - iOS Safari：API 不支援 → silent fail，依靠 CSS overlay 提示用戶手動旋轉
  //   - 桌機 / 平板：API 也會 silent fail（沒手機 sensor），不影響
  // 離開戰鬥（game === null，回 lobby）→ unlock orientation
  let orientationLocked = $state(false);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const inBattle = game !== null;
    if (inBattle && !orientationLocked) {
      // 嘗試鎖橫向（async 但不 await — 失敗就跳過）
      try {
        const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation;
        so?.lock?.('landscape').then(() => { orientationLocked = true; }).catch(() => {});
      } catch { /* 不支援的瀏覽器：silent */ }
    } else if (!inBattle && orientationLocked) {
      try {
        const so = (screen as Screen & { orientation?: { unlock?: () => void } }).orientation;
        so?.unlock?.();
      } catch {}
      orientationLocked = false;
    }
  });

  // ── Derived ─────────────────────────────────────────────────────────────────
  const aIdx = $derived(game?.activePlayerIndex ?? 0);
  const dIdx = $derived((1 - aIdx) as 0 | 1);
  const activePlayer   = $derived(game ? game.players[aIdx] : null);
  const defenderPlayer = $derived(game ? game.players[dIdx] : null);
  const availableAttacks = $derived(game && poolReady ? getAvailableAttacks(game, pool) : []);

  /**
   * v3.9994/v3.9995 UX 補強：偵測太晶寶可夢 + 璀璨結晶 → 返回是否啟用 cost reduction
   *   v3.9994 原版返 index 用於劃線單一 pip，但因卡面「任意屬性皆可」應由玩家選擇，
   *   單一 pip 劃線會誤導（讓玩家以為只能減特定位置）。改為 boolean + cost row 末尾總徽章。
   *   阻礙之塔啟用時道具失效。
   */
  function isShinyCrystalActive(
    attacker: import('$lib/game/types').CardInstance | null | undefined,
    attackCost: import('$lib/game/types').EnergyType[],
  ): boolean {
    if (!attacker || attackCost.length === 0 || !game) return false;
    const attackerCard = pool.get(attacker.cardId);
    if (!attackerCard?.tags?.includes('太晶')) return false;
    if (game.activeStadium) {
      const stadiumCard = pool.get(game.activeStadium.cardId);
      if (stadiumCard?.name === '阻礙之塔') return false;
    }
    const tools: import('$lib/game/types').CardInstance[] = [];
    if (attacker.toolAttached) tools.push(attacker.toolAttached);
    if (attacker.extraTools) tools.push(...attacker.extraTools);
    return tools.some(t => pool.get(t.cardId)?.name === '璀璨結晶');
  }
  // v2.98：pendingPrizes 改為 [P1 owed, P2 owed]
  // v3.791 Bug fix：原本用 `myPlayerIndex ?? 0` — 但在本機雙人模式下 myPlayerIndex 永遠 null，
  //   會強制讀 pendingPrizes[0]（P1 視角）。P2 攻擊 KO P1 時 P2 的 pendingPrizes 不會被認，
  //   導致 take-prize 按鈕不出現、整個流程卡住。改用 myIdx（perspective-aware derived 索引）。
  const pendingPrizesArr = $derived<[number, number]>(game?.pendingPrizes ?? [0, 0]);
  const myPendingPrizes  = $derived(pendingPrizesArr[myIdx] ?? 0);
  const oppPendingPrizes = $derived(pendingPrizesArr[oppIdx] ?? 0);
  const pendingSelection = $derived(game?.pendingSelection ?? null);

  // v2.44：切換新 modal 時重置拖曳偏移量
  // 用 effectKey + actorIdx + type 做 signature，避免每次 game 狀態更新（物件新 ref）都誤重置
  const modalSignature = $derived(
    pendingSelection
      ? `${game?.id ?? ''}|${pendingSelection.type}|${pendingSelection.effectKey ?? ''}|${pendingSelection.actorIdx}`
      : floatingRetreatMenu
        ? 'retreat-menu'
        : 'none'
  );
  $effect(() => {
    // v5.458：唯一相依 modalSignature（含 game.id）。重置只在「邏輯 pending 身分」或「換局」時觸發。
    //   修玩家回報：線上 Oracle 輪詢每次 adopt 重賦值 game → pendingSelection 物件參考變 → 原本
    //   $effect 因 body 讀 pendingSelection 而相依物件、每次都 re-run → 把剛點 +/- 設好的能量分配
    //   (selectionCounts) 歸 0（金屬製造者分配回朔）。改：body 包 untrack，只認 modalSignature 字串變動。
    const _sig = modalSignature;
    void _sig;
    untrack(() => {
      selectionPicked = new Set();
      selectionCounts = {};
      selectionReorderKeep = [];
      selectionReorderDiscard = new Set();
      modalOffset = { x: 0, y: 0 };
      modalDragged = false;
      modalDragStart = null;
      // reorder-deck-top 切到新 pending 時，從 candidateIids 初始化 keep 列表（保持原順序）
      if (pendingSelection?.type === 'reorder-deck-top') {
        const cand = (pendingSelection.params?.candidateIids as string[] | undefined) ?? [];
        selectionReorderKeep = [...cand];
        selectionReorderDiscard = new Set();
      }
      // modal-choice stepper 切到新 pending 時，從 params.stepper.init 初始化數值
      if (pendingSelection?.type === 'modal-choice') {
        const stepper = pendingSelection.params?.stepper as { min: number; max: number; step: number; init: number } | undefined;
        if (stepper) {
          selectionStepperValue = stepper.init;
        }
      }
    });
  });
  const evolvableTargets = $derived(game && poolReady ? getEvolvableTargets(game, pool) : []);
  const canRetreatNow    = $derived(game && poolReady ? canRetreat(game, pool) : false);
  // ⭐v6.200：playableTrainerIids / playableBasicIids / playableFossilIids / playableEvoIids
  //   四份手牌可用清單已收斂進 `getHandCardOps()`（它自己呼叫同一批 engine helper）。
  //   ⚠ 不要在本檔重新拉出這些 Set 再自行組條件 —— 那就是「第二份判定」的起點。
  // v5.089 的 aceCancelActiveLocal（UI 自己鏡射一份 engine isAceCancelActive）已於 ⭐v6.200 移除 ——
  //   手牌可用性統一由 `getHandCardOps()` 計算，它直接呼叫 engine 匯出的 `isAceCancelActive`。
  //   ⚠ 不要再把它加回來：兩份鏡射就是這一族 bug（v6.098／v6.131／v6.109）的固定成因。
  // v2.981：任一方有待領獎賞時，鎖住所有 main-phase 動作（除了取獎賞按鈕）
  // 確保獎賞流程順序：取完才能攻擊、使用競技場、特性、撤退、附能量等
  const anyPendingPrize = $derived(
    game ? ((game.pendingPrizes?.[0] ?? 0) > 0 || (game.pendingPrizes?.[1] ?? 0) > 0) : false
  );
  const canEndTurn = $derived(
    game?.phase === 'playing' && game.turnPhase === 'end' && !hasPendingActions(game)
  );
  const usableAbilities = $derived(game && poolReady ? getUsableAbilities(game, pool) : []);
  const stadiumCard = $derived(game?.activeStadium ? pool.get(game.activeStadium.cardId) : null);

  // ─── v3.07 Deferred Wave D — 手牌觸發特性 ───────────────────────────────────
  // ⚠ v6.099：機制 A（ON_DISCARD_FROM_HAND：棄 1 張指定手牌觸發場上寶可夢的特性）
  //   的 UI 入口**已整段移除**。v5.510 起 `ON_DISCARD_FROM_HAND_ABILITIES` 就是空 Map
  //   （超能妙喵｜誘導之尾、火神蛾｜熱浪鱗粉 都改成寶可夢身上的 regA 特性按鈕，避免雙按鈕），
  //   engine 的 USE_HAND_DISCARD_ABILITY handler 第一關 `Map.get()` 查不到就 return
  //   → 這裡留著的 derived/按鈕是**死碼**（本檔當時已 `return out` 空 Map，手機版則還留著
  //   會按下去毫無反應的死按鈕，兩端不一致；v6.099 一併清乾淨）。
  //   ⚠ 未來若把卡加回該 Map，**兩套 UI 要同時加回入口**（守衛 test-v6098 會亮紅提醒）。
  // 以下只保留機制 B（ON_HAND_ACTIVATE：手牌寶可夢自身觸發、把自己放上備戰）。

  // 機制 B: 手牌寶可夢自身為 trigger（齒輪怪｜緊急迴轉、烈箭鷹ex｜激動俯衝）
  // v6.080：條件判斷收斂到 engine getHandActivatableAbilities（引擎 handler 與手機版同一份）。
  //   原本這裡自己寫一份，且硬編 `bench.length < 5` 沒走 getBenchLimit（零之大空洞上限 8）→
  //   引擎放行但卡片不亮。新增同型卡只改 engine 的 HAND_ACTIVATE_GATES。
  // key = 手牌 iid, value = { abilityName, abilityIndex, label }
  const handActivateAbilities = $derived.by<Map<string, { abilityName: string; abilityIndex: number; label: string }>>(() => {
    const out = new Map<string, { abilityName: string; abilityIndex: number; label: string }>();
    if (!game || !poolReady) return out;
    if (!isMyTurn()) return out;
    for (const a of getHandActivatableAbilities(game, myIdx as 0 | 1, pool)) {
      out.set(a.iid, { abilityName: a.abilityName, abilityIndex: a.abilityIndex, label: `⚡ ${a.abilityName} (放備戰)` });
    }
    return out;
  });

  // ⭐⭐⭐v6.200 手牌卡「現在能做哪些操作」的**唯一述詞**（拖曳／點擊／黃框／提示文字全讀它）。
  //   ⚠ 玩家回報：烈箭鷹ex｜激動俯衝 可用時桌機**拖不動**（只能點）。
  //     真因＝拖曳的 `dragKind` 與點擊的 `canHandActivate` 是**兩份互不相干的條件**，
  //     v6.080 新增手牌特性時只補了點擊那一份。收斂後兩條路徑不可能再分岔。
  //   ⚠ 本檔（桌機 classic + fable 共用同一份 markup）與手機直式都禁止再自行判斷可用性。
  const handCardOps = $derived.by<Map<string, Set<HandCardOp>>>(() => {
    if (!game || !poolReady) return new Map<string, Set<HandCardOp>>();
    return getHandCardOps(game, myIdx as 0 | 1, pool, { isMyTurn: isMyTurn() });
  });
  const EMPTY_HAND_OPS: ReadonlySet<HandCardOp> = new Set<HandCardOp>();
  /** 拖曳中的那張卡，放到某種釋放區會結算成哪個操作（給 drop-zone 高亮用，與實際結算同一支） */
  function dragOpFor(target: HandDropTarget): HandCardOp | null {
    if (!dragging) return null;
    return handOpForDropTarget(new Set<HandCardOp>(dragging.ops), target);
  }

  // ⭐v6.208：原本這裡有一支 `triggerHandActivateAbility` 函式（手牌特性的**點擊**入口）。
  //   站長裁定手牌特性只能拖曳發動 ⇒ 該函式零呼叫端＝死碼，一併刪除，
  //   避免「函式還在＝入口還在」的錯覺（v6.098／v6.099 死入口的教訓）。
  //   拖曳結算仍走 onWindowPointerUp 的 `op === 'hand-ability'` 分支（讀同一份 handActivateAbilities）。


  // ⭐⭐⭐v6.197 觀戰者判定收斂成**單一中央述詞**，而且方向由 fail-open 改成 fail-closed。
  //   舊寫法 `mySeatIdx >= 2` 要求「拿得出觀戰位的證據」才算觀戰者 ⇒「認不出座位」
  //   （mySeatIdx === -1，401 自動重登換了 uid 之後就會這樣）被歸成「玩家」：
  //   桌機頂欄長出「🏳 投降離開」、手機直式的 isMyTurn 退回 myIdx=0 而長出
  //   「⏭ 結束回合」與招式鈕，而 dispatch 的唯一擋線就是這個旗標 ⇒ 動作是真的會被套用的。
  //   ⚠ 新述詞在 src/lib/game/viewer-role.ts，桌機與手機直式共用同一份（手機直式吃 isSpectator prop）。
  const isSpectator = $derived(isViewerSpectator({ mode, mySeatIdx, myPlayerIndex, isTournSpectator, isTReplay, isAdminMode }));
  /** ⭐v6.197 所有「會送出動作」的按鈕／拖曳／dispatch 一律問這一支（= !isSpectator，但只有一個來源） */
  const canAct = $derived(canViewerAct({ mode, mySeatIdx, myPlayerIndex, isTournSpectator, isTReplay, isAdminMode }));
  /** ⭐v6.197 線上但認不出座位 —— 要顯性告訴玩家，不可以只是靜靜把按鈕收掉 */
  const seatUnknown = $derived(isSeatUnknownOnline({ mode, mySeatIdx, myPlayerIndex, isTournSpectator, isTReplay, isAdminMode }));
  // v4.927：admin spy 若在 poolReady 之前觸發，這個 $effect 會在 pool 載完後補訂閱
  let _adminSpySubscribed = $state(false);
  $effect(() => {
    if (isAdminMode && poolReady && roomCode && !_adminSpySubscribed) {
      _adminSpySubscribed = true;
      try {
        startRoomSubscription();
        console.log('[admin spy] effect subscribed to room', roomCode);
      } catch (e) { console.error('[admin spy] effect sub failed', e); }
    }
  });

  // ── 視角固定：AI模式/線上模式我方永遠在下方，本機雙人模式隨行動方翻轉 ──────
  // 注意：線上模式必須優先判斷，否則預設 aiPlayerIndex=1 會讓雙方都算成 myIdx=0
  // Setup 階段本機雙人：翻到尚未完成 setup 的那一方
  // v2.276：觀戰者依 spectatorView 決定看哪一邊（auto = 跟著當前 active player）
  const myIdx   = $derived<0 | 1>(
    mode === 'online' ? (
      isSpectator
        ? (spectatorView === 'p1' ? 0
            : spectatorView === 'p2' ? 1
            : ((game?.activePlayerIndex ?? game?.firstPlayerIdx ?? 0) as 0 | 1))  // v5.943 保險:AP 缺退先攻
        : ((myPlayerIndex ?? 0) as 0 | 1)
    ) :
    aiPlayerIndex !== null ? ((1 - aiPlayerIndex) as 0 | 1) :
    (game?.phase === 'setup' && myPlayerIndex === null
      // 本機雙人 setup：優先級 pendingMulliganDraw → mulliganRevealConfirmed → mulliganPostBenchOpen → setupDone
      // v5.173：補 mulliganPostBenchOpen 優先級
      // v5.185：補 mulliganRevealConfirmed 優先 — 若哪邊還沒 confirm 對方揭示就切到那邊
      //   不然 setupDone[0]?1:0 會把 myIdx 切到對手視角，揭示 modal 條件 !mulliganRevealConfirmed[myIdx] 失敗 → 卡死
      //   插入順序：pendingMulliganDraw（最高）→ mulliganRevealConfirmed → mulliganPostBenchOpen → setupDone
      // v6.051 批2：互動式開局的選擇擁有最高優先序 —— 此時雙方 setupDone 都還是 false，
      //   舊鏈的末端 `setupDone[0] ? 1 : 0` 會恆定切到 P1，P2 要選時永遠看不到視窗 → 死結。
      ? ((game.openingChoicePending?.[0]
          ? 0
          : game.openingChoicePending?.[1]
            ? 1
          : (game.pendingMulliganDraw?.[0] ?? 0) > 0
          ? 0
          : (game.pendingMulliganDraw?.[1] ?? 0) > 0
            ? 1
            : ((game.mulliganRevealedHands?.p2 ?? []).length > 0 && !game.mulliganRevealConfirmed?.[0])
              ? 0
              : ((game.mulliganRevealedHands?.p1 ?? []).length > 0 && !game.mulliganRevealConfirmed?.[1])
                ? 1
                : game.mulliganPostBenchOpen?.[0] === true
                  ? 0
                  : game.mulliganPostBenchOpen?.[1] === true
                    ? 1
                    : (game.setupDone[0] ? 1 : 0)) as 0 | 1)
      // v3.81：本機雙人 playing — pendingPrizes 在哪邊就 switch 到那邊（讓對手能點「取得」按鈕）
      //   修咒詛炸彈自身 KO 後對手卡死的問題（pendingPrizes 在非 activePlayer 那邊，UI 看不到 button）。
      //   只在 myPlayerIndex===null 的本機雙人才適用；線上 / AI 模式 myPlayerIndex 永遠有值，走另一條路徑。
      : (myPlayerIndex !== null
          ? myPlayerIndex
          : (game?.phase === 'playing' && (game.pendingPrizes?.[1 - aIdx] ?? 0) > 0
              ? ((1 - aIdx) as 0 | 1)
              : aIdx)))
  );
  const oppIdx  = $derived<0 | 1>((1 - myIdx) as 0 | 1);
  const myPlayer  = $derived(game ? game.players[myIdx]  : null);
  const oppPlayer = $derived(game ? game.players[oppIdx] : null);
  // v2.146：備戰位上限（零之大空洞 + 太晶寶可夢 → 8，否則 5）
  //   UI 之前 hardcode Array(5)，當 engine 允許 8 時看不到第 6~8 格 → 玩家無法放第 6 隻起。
  //   改為各自查 getBenchLimit 後決定要 render 幾格。
  const myBenchLimit  = $derived(game && poolReady ? getBenchLimit(game, myIdx,  pool) : 5);
  const oppBenchLimit = $derived(game && poolReady ? getBenchLimit(game, oppIdx, pool) : 5);
  // Setup 階段對手場上的寶可夢應該蓋牌（不能讓對手看到身分），等雙方都完成後（phase→playing）再揭曉
  const oppHidden = $derived(!!game && game.phase === 'setup');

  // v2.31：純被動場地卡（對戰圓形競技場 / 阻礙之塔 / 火箭隊的監視塔）不需要使用按鈕，
  // 效果放下即一直存在；排除這組後才顯示「🏟 使用競技場」按鈕。
  const canUseStadium = $derived(
    game?.phase === 'playing' && game.turnPhase === 'main' &&
    !!game.activeStadium && !game.pendingSelection &&
    !(game.stadiumUsedThisTurn ?? [false,false])[myIdx] &&
    !(stadiumCard && PASSIVE_STADIUMS.has(stadiumCard.name)) &&
    // v5.212：祭典樂舞 pending 期間禁用場地卡
    !(game.festivalDancePendingSecondAttack && game.festivalDancePendingSecondAttack.idx === myIdx)
  );

  // 線上模式 / AI 模式：是否輪到玩家行動
  // v5.643 setup「誰該動作」— 與伺服器 currentActorSeat 同一套邏輯(敗場判定/UI 提示一致):
  //   放出場階段 mulligan 較少方先放(較多方等);雙方 setupDone 後才進揭示確認/補抽。回 0/1=該方,-1=雙方(都該動)。
  function setupActorSeat(g: any): 0 | 1 | -1 {
    const sd0 = !!g?.setupDone?.[0], sd1 = !!g?.setupDone?.[1];
    // v6.051 批2 / v6.053 批3：互動式開局尚未定案時，「該動作的人」＝還要做選擇的那一側
    //   （雙方都要選 → -1，閒置判負對 -1 不單判任一方）。
    //   ⚠必須排在下面的 mulligan 次數比較之前：opening 期間雙方 setupDone 都是 false，
    //     舊邏輯會走 `m0 !== m1` 分支回傳「重抽次數較少」那一側 —— 但那一側往往正是
    //     **已經選完在等待**的人，而他被引擎的 opening gate 擋住什麼都不能做
    //     → 3 分鐘後被誤判閒置敗（v0.60/v0.62/v0.67/v0.74 同款事故的第五種路徑）。
    //   ⚠判準要和 effectiveOpeningDone 一致：舊版 client（沒有 opening 流程）會直接
    //     PLACE_ACTIVE + FINISH_SETUP，它的 openingChoicePending 永遠停在 true，
    //     只看 pending 會把「其實已經完成」的舊 client 誤判成掛機。
    //   ⚠與伺服器 currentActorSeat 逐行同步（閒置判負用）。
    const _oc = g?.openingChoicePending;
    const _oPend0 = !!(_oc && _oc[0]) && !sd0;
    const _oPend1 = !!(_oc && _oc[1]) && !sd1;
    if (_oPend0 || _oPend1) {
      if (_oPend0 && !_oPend1) return 0;
      if (_oPend1 && !_oPend0) return 1;
      return -1;
    }
    const pmd = g?.pendingMulliganDraw ?? [0, 0];
    const mrc = g?.mulliganRevealConfirmed ?? [true, true];
    const mpb = g?.mulliganPostBenchOpen ?? [false, false];
    // v5.911：mulligan 補抽後加備戰(mpb)是「已按過準備、擁有者必須完成」的動作。
    //   v5.923 修:但若【對手尚未 setupDone(還欠放出場)】則對手也欠動作→回 -1(雙方都可動作:isMyTurn 對雙方 true→
    //   mpb 擁有者仍有「完成補抽後設置」鍵[不回歸 v5.911]、對手放置 UI 也啟用[解 deadlock])。對手已 setupDone 才由 mpb 擁有者單獨。
    //   ⚠與伺服器 currentActorSeat 逐行同步(閒置判負用)。
    const p0mpb = !!mpb[0], p1mpb = !!mpb[1];
    if (p0mpb || p1mpb) { if (p0mpb && !p1mpb) return sd1 ? 0 : -1; if (p1mpb && !p0mpb) return sd0 ? 1 : -1; return -1; }
    if (!(sd0 && sd1)) {
      const m0 = g?.mulliganCounts?.[0] ?? 0, m1 = g?.mulliganCounts?.[1] ?? 0;
      if (m0 === m1) { if (!sd0 && !sd1) return -1; return (!sd0 ? 0 : 1); }
      const lessIdx: 0 | 1 = m0 < m1 ? 0 : 1;
      if (!(lessIdx === 0 ? sd0 : sd1)) return lessIdx;
      const moreIdx: 0 | 1 = lessIdx === 0 ? 1 : 0;
      if (!(moreIdx === 0 ? sd0 : sd1)) return moreIdx;
    }
    const owes = (i: number) => (Number(pmd[i]) > 0) || !mrc[i];
    if (owes(0) || owes(1)) { const b0 = owes(0), b1 = owes(1); if (b0 && !b1) return 0; if (b1 && !b0) return 1; return -1; }
    return -1;
  }
  const isMyTurn = $derived(() => {
    if (!game) return false;
    // 線上模式：只有輪到 myPlayerIndex 才能行動（必須優先於 AI 判斷）
    if (mode === 'online') {
      if (myPlayerIndex === null) return false;
      // v5.139: setup 階段同時看 mulliganPostBenchOpen — 補抽後加備戰也是「我的回合」
      if (game.phase === 'setup') { const _b = setupActorSeat(game); return _b === -1 || _b === myPlayerIndex; }
      if (game.pendingSelection) return game.pendingSelection.actorIdx === myPlayerIndex;
      if (game.turnPhase === 'end' && game.players[myPlayerIndex].active === null) return true;
      return game.activePlayerIndex === myPlayerIndex;
    }
    // AI 模式：只有輪到人類時才能手動操作
    if (aiPlayerIndex !== null) {
      const hIdx = (1 - aiPlayerIndex) as 0 | 1;
      // v5.139: setup 階段同時看 mulliganPostBenchOpen — 補抽後加備戰也是「我的回合」
      if (game.phase === 'setup') { const _b = setupActorSeat(game); return _b === -1 || _b === hIdx; }
      if (game.pendingSelection) return game.pendingSelection.actorIdx === hIdx;
      if (game.turnPhase === 'end' && game.players[hIdx].active === null) return true;
      // v2.98：取獎賞由 owner 決定（pendingPrizes[hIdx] > 0 即可取，不論誰的回合）
      if ((game.pendingPrizes?.[hIdx] ?? 0) > 0) return true;
      return game.activePlayerIndex === hIdx;
    }
    return true; // 本機雙人模式
  });

  // ── ⭐v6.233 預估傷害 ────────────────────────────────────
  //   站長裁定：**只做休閒對戰**（錦標賽是比賽性質，玩家自己算）
  //   ⇒ 用全檔既有的中央述詞 `isTournament` gate，**不另外新寫「是不是錦標賽」的判斷**。
  //   ⚠ 效能：一招要 2~4 次乾跑。這裡用 `$derived.by` ⇒ **只有盤面（game）或視角變動時才重算**，
  //     不是每次 render 都跑；桌機是 CSS `:hover` 才顯示，內容早就算好放在 DOM 裡，
  //     **hover 事件本身不做任何運算**。
  //   ⚠ 只在「招式按鈕真的能按」的情境才算，其餘一律回 null（＝不顯示、也不花這個成本）。
  const damageEstimates = $derived.by<DamageEstimate[] | null>(() => {
    if (isTournament) return null;                                 // 站長裁定：錦標賽不做
    if (isSpectator || isTournSpectator || isTReplay) return null; // 觀戰/回放沒有「要不要出這招」的決策
    if (!game || !poolReady) return null;
    if (game.phase !== 'playing' || game.turnPhase !== 'main') return null;
    if (game.pendingSelection) return null;
    if (!isMyTurn()) return null;
    const _ai = game.activePlayerIndex;
    if (_ai !== 0 && _ai !== 1) return null;
    const _actor = game.players[_ai];
    if (!_actor?.active) return null;
    try {
      const _n = getEffectiveAttacks(game, _actor.active, pool).length;
      if (_n <= 0) return null;
      // ⭐⭐⭐v6.237 真因就在這一行。
      //   `game` 是 Svelte 5 的 `$state` 變數 ⇒ 執行期是一個 **Proxy**；
      //   而 damage-estimate.ts 乾跑的第一件事是 `structuredClone(base)`，
      //   `structuredClone` 對 Proxy 一律拋 `DataCloneError`（HTML 規格：帶有
      //   [[ProxyHandler]] 內部欄位的物件不可序列化）⇒ 每一招都回 `unknown`
      //   ⇒ **v6.233～v6.236 這個功能從來沒有在畫面上出現過**，而且兩層 catch
      //   把錯誤吃得一乾二淨，連主控台都不留一行。
      //   ⇒ 用 Svelte 官方的 `$state.snapshot()` 先取得**純物件**再交出去；
      //     damage-estimate.ts 因此維持與框架無關（它也被 Node 守衛直接呼叫）。
      //   ⚠ 為什麼 snapshot 與 structuredClone 在這裡等價：GameState 是 Firestore-safe
      //     的純資料（沒有 Map／Set／Date／類別實體）—— 這件事由
      //     `test-v6237-estimate-state-proxy.mjs` 的遞迴掃描逐欄釘住，不是靠註解保證。
      //   ⚠ 複製次數：這裡多一次深拷貝，但乾跑本身每一招要 4~5 次；實測見那支守衛的量測段。
      const _plain = $state.snapshot(game) as GameState;
      return estimateAllAttacks(_plain, _n, pool, _ai);
    } catch (err) {
      // ⚠⚠v6.237【B】行為仍然 fail-closed（算不出來就不顯示，絕不拿錯數字騙玩家），
      //   但**絕不再靜靜吞掉** —— 至少留一行可見診斷（同一種原因只噴一次）。
      warnEstimateOnce('桌機 damageEstimates 計算失敗', err);
      return null;
    }
  });
  /**
   * ⭐⭐⭐v6.238【B】桌機「放大鏡」點開的是哪一招的預估。
   *
   * 站長回報：有玩家用 iPad 玩，**觸控裝置模擬不出「滑鼠停在上面」** ——
   * 一碰就直接使出招式，v6.233 的 hover 提示等於看不到。
   * ⇒ 招式鈕旁邊多一顆放大鏡，點它才顯示（再點一次收起）。
   * ⚠ 連 `turn` 一起記：換回合自動失效，不必在各處手動清（少一個會忘記清的地方）。
   */
  let estOpen = $state<{ turn: number; i: number } | null>(null);

  // 線上模式：我是否為防守方（被擊倒後需送出寶可夢）
  // ── v6.122 補位（派出新的戰鬥寶可夢）改「選取 → 確定」兩段式 ────────────────
  //   玩家回報：昏厥後選備戰上場「只要點選就立即上場」，很容易按錯。
  //   ⚠ 這個流程搞砸的後果很嚴重：補位卡住 = 玩家無法行動 → 錦標賽會被閒置判負。
  //   所以：①選取只改本地 state、不送 action ②確定鈕才送 ③送出前再驗一次。
  //   ⚠⚠ **兩個 modal 各自一份 pick state，不可共用**：
  //     Modal A（防守方版）列的是 defenderPlayer.bench、Modal B（自 KO 版）列的是
  //     myPlayer.bench。一般情況兩者相同，但**本機雙人「雙方同時自傷 KO」**時是
  //     兩份不同的備戰區疊在一起 —— 共用一份 state 會跨清單汙染。
  let promotePickDef = $state<string | null>(null);   // Modal A：防守方補位
  let promotePickSelf = $state<string | null>(null);  // Modal B：自 KO 補位
  /**
   * v6.122 中央收斂：**全檔唯一**送出 SEND_NEW_ACTIVE 的地方（守衛會釘死這件事）。
   * ⚠ 送出前必須再驗一次 iid 仍在該玩家的備戰區 —— 線上盤面可能在玩家選好之後被
   *   對手的動作 merge 進來而改變；送 stale iid 會被引擎拒絕，玩家只會看到「按了沒反應」。
   */
  function confirmSendNewActive(iid: string | null, senderIdx: 0 | 1, bench: { iid: string }[]) {
    if (!iid) return;
    if (!(bench ?? []).some((b) => b.iid === iid)) return;
    dispatch(GameActions.sendNewActive(iid, senderIdx));
    promotePickDef = null;
    promotePickSelf = null;
  }

  const isMyDefenderTurn = $derived(() => {
    if (!game) return false;
    // 線上模式必須優先判斷
    if (mode === 'online') {
      if (myPlayerIndex === null) return false;
      return game.phase === 'playing' &&
             game.turnPhase === 'end' &&
             myPlayerIndex === dIdx &&
             defenderPlayer?.active === null;
    }
    if (aiPlayerIndex !== null) {
      const hIdx = (1 - aiPlayerIndex) as 0 | 1;
      return game.phase === 'playing' && game.turnPhase === 'end' &&
             hIdx === dIdx && defenderPlayer?.active === null;
    }
    return true; // 本機雙人模式
  });

  const selectionItemsRaw = $derived.by(() => {
    if (!pendingSelection || !game) return [] as CardInstance[];
    const src = game.players[pendingSelection.sourcePlayerIdx];
    switch (pendingSelection.type) {
      case 'deck-search': {
        const f = pendingSelection.filter ?? '';
        // v5.362：依卡名過濾（如 亮光增長 'Name:燈火幽靈'）。原本沒此 case → fallthrough `return true`
        //   顯示整副牌庫、可選非目標卡（regR 雖只放有效卡，但 picker UI 錯誤）。
        if (f.startsWith('Name:')) {
          const nm = f.slice('Name:'.length);
          return src.deck.filter(c => pool.get(c.cardId)?.name === nm);
        }
        if (f === 'TOP6') {
          const top6 = new Set<string>((pendingSelection.params?.top6Iids as string[]) ?? []);
          return src.deck.filter(c => top6.has(c.iid));
        }
        if (f === 'TOP8') {
          const top8 = new Set<string>((pendingSelection.params?.top8Iids as string[]) ?? []);
          return src.deck.filter(c => top8.has(c.iid));
        }
        // v6.081 超級烈空坐ex｜霸者咆哮：牌庫上方 4 張（顯示全部＝「查看」，可勾的限制走 validIids）
        if (f === 'TOP4') {
          const top4 = new Set<string>((pendingSelection.params?.top4Iids as string[]) ?? []);
          return src.deck.filter(c => top4.has(c.iid));
        }
        if (f === 'TOP2') {
          const top2 = new Set<string>((pendingSelection.params?.top2Iids as string[]) ?? []);
          return src.deck.filter(c => top2.has(c.iid));
        }
        if (f === 'Supporter:TOP6') {
          const top6 = new Set<string>((pendingSelection.params?.top6Iids as string[]) ?? []);
          return src.deck.filter(c => top6.has(c.iid) && pool.get(c.cardId)?.subtype === 'Supporter');
        }
        // v2.56 寶可裝置3.0：牌庫頂 7 張中的支援者
        if (f === 'Supporter:TOP7') {
          const top7 = new Set<string>((pendingSelection.params?.top7Iids as string[]) ?? []);
          return src.deck.filter(c => top7.has(c.iid) && pool.get(c.cardId)?.subtype === 'Supporter');
        }
        // v3.11 米立龍ex|硃砂誘餌 / 人造細胞卵|傳喚之門：peek N 中的基礎寶可夢
        if (f === 'Basic:TOP_N') {
          const topN = new Set<string>((pendingSelection.params?.topIids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!topN.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Pokemon' && !card.evolvesFrom;
          });
        }
        // v3.11 拉普拉斯ex|海紋石之雨：peek N 中的能量（含特殊能量）
        if (f === 'Energy:TOP_N') {
          const topN = new Set<string>((pendingSelection.params?.topIids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!topN.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Energy';
          });
        }
        // v5.964 女服務生:peek N 中的「基本」能量 — 須在 generic startsWith('BasicEnergy:') 之前
        //   (否則 TOP_N 被當 EnergyType 恒 false)。原 generic 'BasicEnergy' 不交集 topIids → 顯示整副。
        if (f === 'BasicEnergy:TOP_N') {
          const topN = new Set<string>((pendingSelection.params?.topIids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!topN.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Energy' && card.subtype === 'Basic';
          });
        }
        // v4.952 超級妖火紅狐ex 戲法傳送門：牌庫頂 9 張中的寶可夢卡（任意階段）
        if (f === 'Pokemon:TOP9') {
          const top9 = new Set<string>((pendingSelection.params?.top9Iids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!top9.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Pokemon';
          });
        }
        // v6.027：NameContains:（化石採掘場語義＝名稱含 X 的物品卡）已收進中央 selection-filter，
        //   這裡的早期 return 移除，讓它落到下方「先問中央求值器」的通用出口（零行為變更、單一真相）。
        // v4.942 黑暗球：bottom 7（用 top7Iids 名義 reuse 既有 spec'd TOP-N 機制）中的寶可夢卡
        if (f === 'Pokemon:TOP7') {
          const top7 = new Set<string>((pendingSelection.params?.top7Iids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!top7.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Pokemon';
          });
        }
        // v4.915 杜若：peek N 中的寶可夢卡（任意階段）
        if (f === 'Pokemon:TOP_N') {
          const topN = new Set<string>((pendingSelection.params?.topIids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!topN.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Pokemon';
          });
        }
        // v4.915 杜若：peek N 中的訓練家卡（含支援者/物品/競技場/道具）
        if (f === 'Trainer:TOP_N') {
          const topN = new Set<string>((pendingSelection.params?.topIids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!topN.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Trainer';
          });
        }
        // v4.941 同名群聚（呱呱泡蛙 / 強顎雞母蟲 / 一家鼠 / 蟲電寶 等）：限定同名寶可夢
        // v5.085：原 v4.941 過度限制為 isBasicPokemonCard — 但蟲電寶/一家鼠 SV7 是
        //   Stage1，被 isBasicPokemonCard 濾掉 → picker 顯示空白（玩家回報）。
        //   卡面「放置於備戰區」是規則例外，可直接放同名 Stage1+。
        //   改用 params.validIids（server-side deckSameNameBenchPost 已 narrow 到牌庫
        //   實體同名卡）為主 filter；保留 targetName 為 defense-in-depth。
        //   filter 名稱保留 'Basic:SameName' 向後相容（effects.ts L9360 同步註解）。
        if (f === 'Basic:SameName') {
          const validIids = pendingSelection.params?.validIids as string[] | undefined;
          const targetName = pendingSelection.params?.targetName as string | undefined;
          return src.deck.filter(c => {
            if (validIids && !validIids.includes(c.iid)) return false;
            const card = pool.get(c.cardId);
            if (!card || card.supertype !== 'Pokemon') return false;
            if (targetName && card.name !== targetName) return false;
            return true;
          });
        }
        // v2.209 配樂之笛：對手牌庫頂 5 張中的基礎寶可夢
        if (f === 'Basic:TOP5') {
          const top5 = new Set<string>((pendingSelection.params?.top5Iids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!top5.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Pokemon' && !card.evolvesFrom;
          });
        }
        // v2.42 越橘的一步棋：牌庫頂 7 張中的【惡】屬性寶可夢卡（任意階段）
        // ── 修正夜間學院互動 bug：原 filter 'Pokemon:Type=Darkness' 落到 generic
        //    Pokemon: parser → t='Type=Darkness' 比對 pokemonType 永遠 false。
        if (f === 'DarknessPokemon:TOP7') {
          const top7 = new Set<string>((pendingSelection.params?.top7Iids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!top7.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Pokemon' && card.pokemonType === 'Darkness';
          });
        }
        // Bug fix (#19 金屬怪): 牌庫頂 4 張中的基本【鋼】能量（不顯示整個牌庫）
        if (f === 'BasicMetalEnergy:TOP4') {
          const top4 = new Set<string>((pendingSelection.params?.top4Iids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!top4.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && isBasicEnergyOfType(card, 'Metal');
          });
        }
        // v2.211 壯偉碩木 step 1：牌庫中 evolvesFrom 對得上場上某基底的 Stage1
        if (f === 'SturdyMightTree:Stage1') {
          const baseNames = (pendingSelection.params?.baseNames as string[] | undefined) ?? [];
          return src.deck.filter(c => {
            const card = pool.get(c.cardId);
            if (!card || card.supertype !== 'Pokemon') return false;
            if ((card.stage ?? card.subtype) !== 'Stage1') return false;
            if (!card.evolvesFrom) return false;
            return baseNames.some(n => card.evolvesFrom === n || card.evolvesFrom!.replace(/<|>/g, '') === n);
          });
        }
        // v2.211 壯偉碩木 step 2：evolvesFrom = step 1 進化後的卡名
        if (f === 'SturdyMightTree:Stage2') {
          const fromName = (pendingSelection.params?.stage1Name as string | undefined) ?? '';
          return src.deck.filter(c => {
            const card = pool.get(c.cardId);
            if (!card || card.supertype !== 'Pokemon') return false;
            if ((card.stage ?? card.subtype) !== 'Stage2') return false;
            if (!card.evolvesFrom) return false;
            return card.evolvesFrom === fromName || card.evolvesFrom.replace(/<|>/g, '') === fromName;
          });
        }
        // v4.38 火箭隊的尼多娜｜惡之覺醒：牌庫中 evolvesFrom = 所選 base name 的進化卡
        if (f === 'EvilAwakening:EvolveFrom') {
          const baseName = (pendingSelection.params?.baseName as string | undefined) ?? '';
          return src.deck.filter(c => {
            const card = pool.get(c.cardId);
            if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
            // v6.203：進化來源逐字比對（中央述詞 canEvolveOnto）——
            //   顯示端(filter) 必須 === 能勾端(resolver 的 validEvoIids)，原 stripEx 會多列違規候選。
            return canEvolveOnto(card.evolvesFrom, baseName);
          });
        }
        // v4.45 小箭雀｜鳥笛：牌庫中抵抗力為【鬥】屬性的寶可夢
        if (f === 'Resistance:Fighting') {
          return src.deck.filter(c => {
            const card = pool.get(c.cardId);
            if (!card || card.supertype !== 'Pokemon') return false;
            return card.resistance?.type === 'Fighting';
          });
        }
        // v2.55 捕蟲組合：牌庫頂 7 張中的基本【草】寶可夢 or 基本【草】能量
        if (f === 'GrassBasicOrGrassEnergy:TOP7') {
          const top7 = new Set<string>((pendingSelection.params?.top7Iids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!top7.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            if (!card) return false;
            // Bug fix (#20): 捕蟲組合卡面寫「【草】寶可夢卡」= 任何階段，移除 !evolvesFrom 限制
            if (card.supertype === 'Pokemon' && card.pokemonType === 'Grass') return true;
            if (isBasicEnergyOfType(card, 'Grass')) return true;
            return false;
          });
        }
        return src.deck.filter(c => {
          const card = pool.get(c.cardId);
          if (!card) return false;
          // v6.014（P1-1 批3）：UI deck-search 接中央 selection filter 求值器（三態：回 null 走原 inline fallback）。
          //   BasicEnergy:DistinctTypes 需傳 excludeEnergyTypes（已勾選的其他能量屬性、排除自己本張），與原 inline 等價。
          let _exclDT: Set<string> | undefined;
          if (f === 'BasicEnergy:DistinctTypes') {
            _exclDT = new Set<string>();
            for (const d of src.deck) {
              if (d.iid === c.iid) continue;
              if (selectionPicked.has(d.iid)) { const pt = getBasicEnergyType(pool.get(d.cardId)); if (pt) _exclDT.add(pt); }
            }
          }
          const _central = evaluateSelectionFilter('deck-search', f, c, card, { params: pendingSelection?.params as Record<string, unknown> | undefined, excludeEnergyTypes: _exclDT });
          if (_central !== null) return _central;
          if (f === 'Basic')      return isBasicPokemonCard(card);
          if (f === 'Basic:HP70') return isBasicPokemonCard(card) && (card.hp ?? 0) <= 70;
          // v2.171 深缽鎮：基礎寶可夢且非「擁有規則」（排除 ex / V 等）
          if (f === 'BasicNonRule') {
            // v3.66：改用 isRulePokemon helper 統一管理規則盒判定
            return isBasicPokemonCard(card) && !isRulePokemon(card);
          }
          // v2.159：基礎寶可夢且名字以指定 prefix 開頭（如「赫普的」）
          if (f.startsWith('Basic:NamePrefix=')) {
            const prefix = f.slice('Basic:NamePrefix='.length);
            return isBasicPokemonCard(card) && card.name.startsWith(prefix);
          }
          // v2.159：寶可夢且名字以指定 prefix 開頭（不限階段）
          if (f.startsWith('Pokemon:NamePrefix=')) {
            const prefix = f.slice('Pokemon:NamePrefix='.length);
            return card.supertype === 'Pokemon' && card.name.startsWith(prefix);
          }
          // v5.639：名稱「含」指定字串的寶可夢（洛托呼喚：清洗/切割/加熱洛托姆等，洛托姆 為字尾，prefix 比對會漏）
          if (f.startsWith('Pokemon:NameContains=')) {
            const sub = f.slice('Pokemon:NameContains='.length);
            return card.supertype === 'Pokemon' && card.name.includes(sub);
          }
          // v2.159：寶可夢且名字含對手場上某寶可夢同名（甜蜜球）— params.matchOppNames 提供
          if (f === 'Pokemon:MatchOppName') {
            const names = (pendingSelection?.params?.matchOppNames as string[]) ?? [];
            if (names.length === 0) return false;
            return card.supertype === 'Pokemon' && names.includes(card.name);
          }
          // v2.132：用 stage 欄位（含 ex 進化），不靠 subtype — ex 寶可夢 subtype='ex' 會被排除
          if (f === 'Stage1')     return card.supertype === 'Pokemon' && (card.stage ?? card.subtype) === 'Stage1';
          if (f === 'Stage2')     return card.supertype === 'Pokemon' && (card.stage ?? card.subtype) === 'Stage2';
          // v4.976: 賽吉「擁有特性的寶可夢除外」需 picker UI 也跟著 narrow — 支援 params.validIids intersect
          if (f === 'Evolution') {
            if (!(card.supertype === 'Pokemon' && !!card.evolvesFrom)) return false;
            const validIidsEvo = pendingSelection?.params?.validIids as string[] | undefined;
            if (validIidsEvo && !validIidsEvo.includes(c.iid)) return false;
            return true;
          }
          if (f === 'PsychicBasic') return card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Psychic';
          if (f === 'Pokemon') {
            if (card.supertype !== 'Pokemon') return false;
            // v5.214 Bug 1：卡娜莉等用 filter='Pokemon'+validIids 限制屬性 — 加 intersect (仿 v4.976 Evolution 分支)
            const validIidsPoke = pendingSelection?.params?.validIids as string[] | undefined;
            if (validIidsPoke && !validIidsPoke.includes(c.iid)) return false;
            return true;
          }
          if (f === 'Energy')     return card.supertype === 'Energy';
          if (f === 'BasicEnergy') return card.supertype === 'Energy' && card.subtype === 'Basic';
          // v2.162：基本能量但已選的屬性要排除（伊布｜鮮豔捕捉）
          //   filter 由 selectionItems 計算，但 deck 本身的「已選 picked set」會在 toggle 時改變 →
          //   selectionItems 是 $derived，會自動 re-run 並重新過濾。
          if (f === 'BasicEnergy:DistinctTypes') {
            if (!(card.supertype === 'Energy' && card.subtype === 'Basic')) return false;
            // v6.008：基本能量的 pokemonType 幾乎都留空（現役 68 張全 null）→ 必須用 getBasicEnergyType
            //   從卡名【X】推屬性；原先直接讀 card.pokemonType → 恒 null 被濾掉，玩家「選不了基礎能量」。
            const myType = getBasicEnergyType(card);
            if (!myType) return false;
            // 已選的能量屬性（不含本張）
            const pickedTypes = new Set<string>();
            for (const d of src.deck) {
              if (d.iid === c.iid) continue; // 自己不算入「已選」
              if (selectionPicked.has(d.iid)) {
                const pt = getBasicEnergyType(pool.get(d.cardId));
                if (pt) pickedTypes.add(pt);
              }
            }
            return !pickedTypes.has(myType);
          }
          if (f === 'ex')         return card.supertype === 'Pokemon' && card.subtype === 'ex';
          if (f === 'MegaEx')     return isMegaExCard(card);
          if (f === 'TeraPokemon') return card.supertype === 'Pokemon' && !!card.tags?.includes('太晶');
          if (f === 'Item')       return card.supertype === 'Trainer' && card.subtype === 'Item';
          if (f === 'Supporter')  return card.supertype === 'Trainer' && card.subtype === 'Supporter';
          if (f === 'Tool')       return card.supertype === 'Trainer' && card.subtype === 'PokemonTool';
          if (f === 'Stadium')    return card.supertype === 'Trainer' && card.subtype === 'Stadium';
          if (f === 'Trainer')    return card.supertype === 'Trainer';
          // Wave 42 新增 filter
          if (f === 'CynthiaPokemon') {
            return card.supertype === 'Pokemon' && card.name.includes('竹蘭的');
          }
          // Wave 44 (v2.21)：尖釘鎮道館用 — 「瑪俐的」寶可夢
          if (f === 'MarniePokemon') {
            return card.supertype === 'Pokemon' && card.name.startsWith('瑪俐的');
          }
          // v5.249：莉佳的蔓藤怪|百花齊放 — 「莉佳的」寶可夢
          if (f === 'ErikaPokemon') {
            return card.supertype === 'Pokemon' && card.name.startsWith('莉佳的');
          }
          if (f === 'FightingBasicOrFightingEnergy') {
            // 基本【鬥】寶可夢：pokemonType === 'Fighting' 且為基礎
            if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Fighting') return true;
            // 基本【鬥】能量：pokemonType 有時缺漏（MC 集能量卡），所以名字含【鬥】/【格】也算
            //   ⭐ v6.210：中央 isBasicEnergyOfType 的 ZH_ENERGY_TYPE 同時收 '鬥' 與 '格' ⇒ 語義相同
            if (isBasicEnergyOfType(card, 'Fighting')) return true;
            return false;
          }
          if (f === 'PokemonNonRule') {
            // v3.66：改用 isRulePokemon helper 統一管理規則盒判定
            return card.supertype === 'Pokemon' && !isRulePokemon(card);
          }
          // v2.35：火箭隊新增 filter
          if (f === 'RocketSupporter') {
            return card.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊');
          }
          if (f === 'RocketBasic') {
            return card.supertype === 'Pokemon' && !card.evolvesFrom && card.name.includes('火箭隊的');
          }
          if (f === 'AnyTrainer') {
            return card.supertype === 'Trainer';
          }
          if (f === 'GrassBasicOrGrassEnergy') {
            // Bug fix (#20): 捕蟲組合「【草】寶可夢卡」= 任何階段（非限基本），移除 !evolvesFrom
            if (card.supertype === 'Pokemon' && card.pokemonType === 'Grass') return true;
            if (isBasicEnergyOfType(card, 'Grass')) return true;
            return false;
          }
          if (f === 'BasicEnergy:Grass+Lightning') {
            // v2.155 電電充能：基本【草】或基本【雷】能量
            return isBasicEnergyOfType(card, 'Grass') || isBasicEnergyOfType(card, 'Lightning');
          }
          if (f === 'BasicEnergy:Grass') {
            // v2.305 電電充能第一段：基本【草】能量
            return isBasicEnergyOfType(card, 'Grass');
          }
          if (f === 'BasicEnergy:Lightning') {
            // v2.305 電電充能第二段：基本【雷】能量
            return isBasicEnergyOfType(card, 'Lightning');
          }
          // v2.135：阿響的冒險
          if (f === 'RakiPokemonOrFireEnergy') {
            if (card.supertype === 'Pokemon' && card.name.startsWith('阿響的')) return true;
            if (isBasicEnergyOfType(card, 'Fire')) return true;
            return false;
          }
          // v2.135：洛拍棒
          if (f === 'Supporter:TOP4') {
            const top4 = new Set<string>((pendingSelection.params?.top4Iids as string[]) ?? []);
            return top4.has(c.iid) && card.subtype === 'Supporter';
          }
          // v2.135：固定卡名（旅途牽絆 'Card:阿響的冒險'）
          if (f.startsWith('Card:')) {
            return card.name === f.slice(5);
          }
          if (f.startsWith('Pokemon:Types=')) {
            // v3.13: 多屬性寶可夢 OR 比對（霜奶仙|彩色甜點 用），例 'Pokemon:Types=Grass,Fire'
            const ts = new Set(f.slice('Pokemon:Types='.length).split(',').filter(Boolean));
            return card.supertype === 'Pokemon' && card.pokemonType != null && ts.has(card.pokemonType);
          }
          // v3.58 新增：寶可夢 OR 比對「卡名」（不是屬性！）
          //   - 'Pokemon:Name=脫殼忍者' → 卡名完全等於「脫殼忍者」
          //   - 'Pokemon:Names=甲殼繭,盾甲繭' → 卡名為其中之一
          //   bug 根因：原本 v2306 兩張卡用 'Pokemon:脫殼忍者' / 'Pokemon:甲殼繭,盾甲繭' 寫，
          //   會被下面 generic Pokemon:<Type> handler 抓到 → 比對 pokemonType === '脫殼忍者' 永遠 false
          //   → 玩家看不到任何候選卡，無法觸發。改用 Pokemon:Name= / Pokemon:Names= 明確語意。
          if (f.startsWith('Pokemon:Name=')) {
            const n = f.slice('Pokemon:Name='.length);
            return card.supertype === 'Pokemon' && card.name === n;
          }
          if (f.startsWith('Pokemon:Names=')) {
            const ns = new Set(f.slice('Pokemon:Names='.length).split(',').filter(Boolean));
            return card.supertype === 'Pokemon' && ns.has(card.name);
          }
          // v3.58 新增：Stage1+Stage2 進化寶可夢 + 屬性 filter
          //   - 'Stage1Or2:Metal' → pokemonType=Metal 且 stage 是 Stage1 / Stage2
          //   bug 根因：蓋諾賽克特ex 金屬信號用此 filter，但原本 UI helper 完全沒這個 case，
          //   fallthrough 到 line 1605 的 `return true;` → 整副牌庫都顯示為候選 → 玩家可任選 2 張。
          if (f.startsWith('Stage1Or2:')) {
            const t = f.slice('Stage1Or2:'.length);
            if (card.supertype !== 'Pokemon') return false;
            if (card.pokemonType !== t) return false;
            const stage = card.stage ?? card.subtype;
            return stage === 'Stage1' || stage === 'Stage2';
          }
          // v3.58 新增：基本能量 + 屬性 filter（generic 版本，避免每加一個屬性都要寫 if-else）
          //   - 'BasicEnergy:Fire' / 'BasicEnergy:Psychic' / 'BasicEnergy:Water' / 'BasicEnergy:Metal' / 'BasicEnergy:Darkness'
          //   bug 根因：v2306 妖火紅狐 / v155 樂呵呵之吻等用此 filter，UI 沒對應 case → fallthrough → 任意卡。
          //   注意：放在 'BasicEnergy:Grass+Lightning' / 'BasicEnergy:Grass' / 'BasicEnergy:Lightning'
          //   等具名 case 之後，所以這裡是 fallback 處理其他屬性。
          if (f.startsWith('BasicEnergy:')) {
            const t = f.slice('BasicEnergy:'.length) as EnergyType;
            return isBasicEnergyOfType(card, t);
          }
          // v3.58 新增：別名 + 漏寫的 case
          //   - 'BasicPokemon' = 'Basic'（呼朋引伴 / 巨翅飛魚 用）
          //   - 'EvolutionPokemon' = 'Evolution'（哈克龍 進化指引 用）
          //   - 'PokemonTool' = Trainer + subtype=PokemonTool（白貝木 / Earl 的鋸鋸鯊 / 道具搜尋類用）
          //   - 'BasicPsychicEnergy' = 基本【超】能量（樂呵呵之吻 用，hand-discard 已有但 deck-search 沒）
          //   - 'BasicFightingEnergy' = 基本【鬥】能量
          //   - 'GrassPokemonOrStadium' = 【草】寶可夢 OR Stadium 卡（時拉比 時間輪轉 用）
          //   - 'FirePokemonOrBasicFireEnergy' = 【火】寶可夢 OR 基本【火】能量
          if (f === 'BasicPokemon') return isBasicPokemonCard(card);
          if (f === 'EvolutionPokemon') return card.supertype === 'Pokemon' && !!card.evolvesFrom;
          if (f === 'PokemonTool') return card.supertype === 'Trainer' && card.subtype === 'PokemonTool';
          if (f === 'BasicPsychicEnergy') {
            return isBasicEnergyOfType(card, 'Psychic');
          }
          if (f === 'BasicFightingEnergy') {
            return isBasicEnergyOfType(card, 'Fighting');
          }
          if (f === 'GrassPokemonOrStadium') {
            if (card.supertype === 'Pokemon' && card.pokemonType === 'Grass') return true;
            if (card.supertype === 'Trainer' && card.subtype === 'Stadium') return true;
            return false;
          }
          if (f === 'FirePokemonOrBasicFireEnergy') {
            if (card.supertype === 'Pokemon' && card.pokemonType === 'Fire') return true;
            if (isBasicEnergyOfType(card, 'Fire')) return true;
            return false;
          }
          if (f.startsWith('Pokemon:')) {
            // 指定屬性的寶可夢，例 'Pokemon:Lightning'
            const t = f.slice(8);
            return card.supertype === 'Pokemon' && card.pokemonType === t;
          }
            if (f.startsWith('Energy:')) {
            // v2.121：加 name fallback（基本能量 pokemonType 常為 undefined）
            const t = f.slice(7) as EnergyType;
            return isBasicEnergyOfType(card, t);
          }
          // v2.321：Trainer: prefix 處理（殺手鐧捕捉 filter='Trainer:Supporter'）
          if (f.startsWith('Trainer:')) {
            const sub = f.slice(8); // e.g. 'Supporter', 'Item', 'Stadium', 'PokemonTool'
            return card.supertype === 'Trainer' && card.subtype === sub;
          }
          // v2.225 旋轉洛托姆｜風扇呼喚：HP≤100 的【無】屬性寶可夢卡
          //   （之前 filter 漏在 deck-search chain，導致 fallback `return true` →
          //    整副牌庫都能選。Leon v2.224 後反映 UI 顯示「任選 3 張牌」。）
          if (f === 'ColorlessPokeHP100') {
            return card.supertype === 'Pokemon' && card.pokemonType === 'Colorless' && (card.hp ?? 999) <= 100;
          }
          return true;
        });
      }
      // ⭐⭐⭐ v6.176：這四型（bench-choose / opp-poke-choose / opp-bench-choose / heal-target）
      //   的「基礎候選」全部收斂到 selection-candidates.ts 的 fieldPickerBaseCandidates —— 因為
      //   engine 的中央消毒閘（sanitizeSelectedIids）在 pending 沒宣告 validIids 時，會用**同一個**
      //   函式算出「能勾什麼」。兩端各寫一份就是 v6.109「看得到卻勾不動」的成因。
      case 'bench-choose': {
        // v3.813: 加 includeActive 支援（壯偉碩木 disambiguator 需可選 active）
        const validIids4 = pendingSelection.params?.validIids as string[] | undefined;
        const baseBC = fieldPickerBaseCandidates('bench-choose', src, pendingSelection.params?.includeActive === true);
        return validIids4 ? baseBC.filter(c => validIids4.includes(c.iid)) : baseBC;
      }
      case 'opp-poke-choose': {
        const items = fieldPickerBaseCandidates('opp-poke-choose', src);
        const validIidsOpp = pendingSelection.params?.validIids as string[] | undefined;
        return validIidsOpp ? items.filter(c => validIidsOpp.includes(c.iid)) : items;
      }
      case 'opp-bench-choose': {
        const base = fieldPickerBaseCandidates('opp-bench-choose', src, pendingSelection.params?.includeActive === true);
        const validIidsOppB = pendingSelection.params?.validIids as string[] | undefined;
        return validIidsOppB ? base.filter(c => validIidsOppB.includes(c.iid)) : base;
      }
      case 'damage-distribute': {
        // v4.990: 支援 params.validIids 過濾免疫目標（化隱 / 球形盾牌 / 對戰圓形 等），
        //   配合幻影奇襲 POST dry-run，picker UI 不再顯示永遠 block 的 bench → 不會卡 picker。
        const includeActiveDD = pendingSelection.params?.includeActive === true;
        const validIidsDD = pendingSelection.params?.validIids as string[] | undefined;
        const baseDD = includeActiveDD && src.active ? [src.active, ...src.bench] : src.bench;
        return validIidsDD ? baseDD.filter(c => validIidsDD.includes(c.iid)) : baseDD;
      }
      case 'energy-distribute': {
        // v2.87 同類能量自由分配：自方寶可夢，依 validIids 過濾
        const all = [...(src.active ? [src.active] : []), ...src.bench];
        const validIidsED = pendingSelection.params?.validIids as string[] | undefined;
        return validIidsED ? all.filter(c => validIidsED.includes(c.iid)) : all;
      }
      case 'hand-discard': {
        const f2 = pendingSelection.filter ?? '';
        const validIidsHD = pendingSelection.params?.validIids as string[] | undefined;
        let pool0 = src.hand;
        if (validIidsHD) pool0 = pool0.filter(c => validIidsHD.includes(c.iid));
        // v6.017（P1-1 批4）：中央 selection filter 求值器（known 走中央、否則落原 inline chain）；UI 為 canonical，零行為變更
        if (isKnownSelectionFilter('hand-discard', f2)) return pool0.filter(c => evaluateSelectionFilter('hand-discard', f2, c, pool.get(c.cardId), {}) === true);
        if (f2 === 'Energy') return pool0.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
        if (f2 === 'BasicEnergy') return pool0.filter(c => {
          const card = pool.get(c.cardId);
          return card?.supertype === 'Energy' && card.subtype === 'Basic';
        });
        // v2.40 月光丘陵：只基本【超】能量（排除感應【超】等 Special Energy）
        if (f2 === 'BasicPsychicEnergy') return pool0.filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Psychic'));
        // v2.89 波動突刺：只基本【鬥】能量（排除硬岩【鬥】等 Special Energy）
        if (f2 === 'BasicFightingEnergy') return pool0.filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Fighting'));
        // v3.58：generic 基本能量 + 屬性 filter（妖火紅狐｜閃焰魔法 用 BasicEnergy:Fire）
        //   原本 UI 只認 BasicEnergy:Grass / Lightning（v2.305 加的兩個具名 case），
        //   fallthrough 到 `return pool0;` 讓玩家可棄任何手牌 — 這是 bug。
        //   放在最後讓上面具名 case 優先（如 BasicPsychicEnergy / BasicFightingEnergy）。
        if (f2.startsWith('BasicEnergy:')) {
          const t = f2.slice('BasicEnergy:'.length) as EnergyType;
          return pool0.filter(c => isBasicEnergyOfType(pool.get(c.cardId), t));
        }
        if (f2.startsWith('Energy:')) {
          // v2.121：加 name fallback
          const t = f2.slice(7) as EnergyType;
          return pool0.filter(c => isBasicEnergyOfType(pool.get(c.cardId), t));
        }
        return pool0;
      }
      case 'hand-choose':  {
        const validIids2 = pendingSelection.params?.validIids as string[] | undefined;
        return validIids2 ? src.hand.filter(c => validIids2.includes(c.iid)) : src.hand;
      }
      // v2.63 撤退選擇要丟棄的附加能量（戰鬥寶可夢身上有多屬性時才彈出）
      // v3.14 擴充：支援 params.targetIid（粉碎之錘 / 悠哉尾草棒）— 從 src 玩家
      //   「指定 iid」的寶可夢身上挑能量；可以是 active 或 bench；找不到則 fallback active。
      // v3.826 擴充：支援 params.scope='all-own'（鐵斑葉ex 迅速游標）— 列自方所有寶可夢身上能量
      case 'active-energy-discard':
        // v5.718：邏輯抽至 selection-candidates.ts（純函式，test-selection-candidates 覆蓋）。
        return activeEnergyDiscardCandidates(pendingSelection.params, src);
      case 'heal-target':  {
        // v6.176：與 engine 中央閘共用 fieldPickerBaseCandidates（見上方註解）
        const all = fieldPickerBaseCandidates('heal-target', src);
        const validIids3 = pendingSelection.params?.validIids as string[] | undefined;
        return validIids3 ? all.filter(c => validIids3.includes(c.iid)) : all;
      }
      case 'discard-search': {
        const f = pendingSelection.filter ?? '';
        // v2.233：discard-search 也支援 validIids 限定（沉重接力棒：剛 KO 的能量批次）
        const validIidsDiscard = pendingSelection.params?.validIids as string[] | undefined;
        return src.discard.filter(c => {
          if (validIidsDiscard && !validIidsDiscard.includes(c.iid)) return false;
          const card = pool.get(c.cardId);
          if (!card) return false;
          // v6.017（P1-1 批4）：中央 selection filter 求值器（known 走中央、否則落原 inline chain）；UI 為 canonical，零行為變更
          if (isKnownSelectionFilter('discard-search', f)) return evaluateSelectionFilter('discard-search', f, c, card, {}) === true;
          if (f === 'PokemonOrEnergy') return (card.supertype === 'Pokemon') || card.supertype === 'Energy';
          if (f === 'PokemonOrBasicEnergy') {
            // v2.43：夜間擔架用 — 寶可夢卡或「基本」能量卡（排除 Special Energy / Pokemon 道具）
            if (card.supertype === 'Pokemon') return true;
            if (card.supertype === 'Energy' && card.subtype === 'Basic') return true;
            return false;
          }
          if (f === 'PokemonNonExOrBasicEnergy') {
            // 水蓮的照顧：寶可夢（不含道具 subtype=Other 與規則盒 subtype=ex）+ 基本能量
            if (card.supertype === 'Pokemon' && card.subtype !== 'ex') return true;
            if (card.supertype === 'Energy' && card.subtype === 'Basic') return true;
            return false;
          }
          if (f === 'WaterPokemonOrBasicWaterEnergy') {
            // 豐收漁網：【水】寶可夢 + 基本【水】能量（基本能量 pokemonType 常 null，用卡名【水】fallback）
            if (card.supertype === 'Pokemon' && card.pokemonType === 'Water') return true;
            if (isBasicEnergyOfType(card, 'Water')) return true;
            return false;
          }
          // v2.40 修正：原本這裡寫 supertype === 'Energy'（= 所有能量）是 bug，
          // 會讓能量回收器 / 能量回收 等卡從棄牌區撿到富裕能量等 Special Energy。
          // 正確語義：BasicEnergy = supertype=Energy && subtype=Basic（與 deck-search/hand-discard 一致）
          if (f === 'BasicEnergy')     return card.supertype === 'Energy' && card.subtype === 'Basic';
          if (f === 'BasicPsychicEnergy') {
            // 奇跡修正檔 / 月光丘陵：只基本【超】能量。排除富裕能量/感應【超】等 Special Energy。
            return isBasicEnergyOfType(card, 'Psychic');
          }
          if (f === 'BasicFightingEnergy') {
            // v2.89 波動突刺：只基本【鬥】能量。排除硬岩【鬥】等 Special Energy。
            return isBasicEnergyOfType(card, 'Fighting');
          }
          // v5.022：discard-search 補 BasicEnergy:<Type> generic case（mirror deck-search line ~2262）
          //   bug 根因：玩家回報麻麻鰻｜電氣發電機 從棄牌區挑出「伏特【雷】能量」（Special）— 違反卡面「只能基本【雷】能量」。
          //   discard-search filter chain 漏 'BasicEnergy:Lightning' handler → 落到 `return true;` → 任意能量都過。
          //   修：與 deck-search 對稱，加 generic case；pokemonType/name pattern 雙重識別基本能量。
          if (f.startsWith('BasicEnergy:')) {
            // ⭐ v6.210：原本自帶一份 zhMap（ZH_ENERGY_TYPE 的第三份複本）⇒ 收斂中央述詞。
            return isBasicEnergyOfType(card, f.slice('BasicEnergy:'.length) as EnergyType);
          }
          if (f === 'FightingPokemonOrBasicFightingEnergy') {
            // v2.117 塔拉剛：【鬥】寶可夢 或 基本【鬥】能量
            if (card.supertype === 'Pokemon' && card.pokemonType === 'Fighting') return true;
            if (isBasicEnergyOfType(card, 'Fighting')) return true;
            return false;
          }
          if (f === 'Pokemon')         return card.supertype === 'Pokemon';
          // v3.829 fix：變化之書 / 寶寶球 等卡用 filter='Basic'，原本落入 fallback return true
          //   → picker 顯示棄牌區所有卡（包含支援者、物品等）違反卡面「【基礎】寶可夢」。
          //   補：基礎寶可夢 = supertype='Pokemon' 且 evolvesFrom=undefined 且非 Stage1/Stage2 subtype。
          if (f === 'Basic')           return card.supertype === 'Pokemon' && !card.evolvesFrom
                                              && card.subtype !== 'Stage1' && card.subtype !== 'Stage2';
          if (f === 'Trainer')         return card.supertype === 'Trainer';
          if (f === 'Supporter')       return card.supertype === 'Trainer' && card.subtype === 'Supporter';
          // v3.13: 多屬性 OR 比對（霜奶仙|彩色甜點）
          if (f.startsWith('Pokemon:Types=')) {
            const ts = new Set(f.slice('Pokemon:Types='.length).split(',').filter(Boolean));
            return card.supertype === 'Pokemon' && card.pokemonType != null && ts.has(card.pokemonType as string);
          }
          // v2.186：'Pokemon:<EnergyType>' 通用 filter（豐收漁網用）
          if (f.startsWith('Pokemon:')) {
            const t = f.slice(8) as EnergyType;
            return card.supertype === 'Pokemon' && card.pokemonType === t;
          }
          if (f.startsWith('Energy:')) {
            // e.g., 'Energy:Lightning' = 基本能量 + 指定屬性
            // v2.121：加 name fallback（基本能量 pokemonType 常 undefined）
            const t = f.slice(7) as EnergyType;
            return isBasicEnergyOfType(card, t);
          }
          // v2.102 旋轉洛托姆｜風扇呼喚：HP≤100 的【無】寶可夢
          if (f === 'ColorlessPokeHP100') {
            return card.supertype === 'Pokemon' && card.pokemonType === 'Colorless' && (card.hp ?? 999) <= 100;
          }
          return true;
        });
      }
      default: return [] as CardInstance[];
    }
  });
  // ⚠ v6.108：四個消費此清單的 {#each} 都是 keyed (item.iid)。keyed each 遇到重複 key 會
  //   **直接 throw、整個對戰頁白屏**（v5.606 已被咬過一次）。正常盤面 iid 唯一（引擎出口有
  //   normalizeNonFieldStacks ＋ 守恆測試），這個 dedupe 純屬保險：萬一版本 skew 或引擎瞬時
  //   產生重複 iid，寧可少顯示一張也不要整頁崩掉。
  const selectionItems = $derived.by(() => dedupeByIid(selectionItemsRaw));

  // ⭐ v6.108 防呆：把「已選了哪幾張」轉成玩家看得懂的卡名。
  //   玩家 DCG_Bear 回報「我要拿的是祭典會場，結果變成捕蟲組合」——引擎與送出路徑逐項查證都正確
  //   （全程綁 iid、iid 無碰撞、錦標賽 client 不跑本地 applyAction），最可能是單選 picker 的
  //   「點第二張會靜默換掉選取」(v2.86) 加上「確認前完全不顯示選了什麼」造成的誤選。
  //   ⚠ 這是**唯一來源**：提示列與確認鈕都讀它，不要各自再拼一份字串（會漂移）。
  const selectedCardNames = $derived.by(() => {
    if (!pendingSelection) return [] as string[];
    // ⭐⭐ 公平性（Fable 5 審 v6.108 抓到）：concealed = 卡面「在**不看正面**的情況下選擇」
    //   （功夫鼬／滑滑小子｜拍落、太陽伊布ex｜精神出局／咬棄、貓貓｜占為己有）。
    //   那些 picker 的卡面本來就顯示卡背 + ???，若這裡把真名寫出來，玩家可以逐張 toggle
    //   讀提示列，**把對手整副手牌掃一遍**再決定丟哪張 —— 等於把防呆做成作弊工具。
    if (pendingSelection.params?.concealed === true) return [] as string[];
    return selectionItems.filter(it => selectionPicked.has(it.iid))
      .map(it => getCard(it.cardId)?.name ?? '?');
  });
  /** 已選卡名的顯示字串；超過 3 張只顯示張數（避免確認鈕爆版）。空字串＝不顯示。 */
  const selectedNamesLabel = $derived(
    selectedCardNames.length === 0 || selectedCardNames.length > 3
      ? '' : selectedCardNames.map(n => '《' + n + '》').join('、')
  );

  // ⚠ v6.108：四個消費此清單的 {#each} 都改成 keyed (item.iid) 了。keyed each 遇到重複 key 會
  //   **直接 throw、整個對戰頁白屏**（v5.606 已被咬過一次）。正常盤面 iid 唯一（引擎出口有
  //   normalizeNonFieldStacks + 守恆測試），這裡的 dedupe 只是保險：萬一版本 skew 或引擎瞬時
  //   產生重複 iid，寧可少顯示一張也不要整頁崩掉。


  // 赤松（akamatsu-split）：選 2 張能量時必須是不同屬性；只選 1 張或 0 張永遠合法
  // 注意：基本能量卡的 `pokemonType` 欄位在卡表資料中常為空（undefined），
  // 所以這裡從卡名 `基本【X】能量` 解析屬性字元來比對。
  function basicEnergyTypeFromName(name: string): string | null {
    const m = name.match(/【(.+?)】/);
    return m ? m[1] : null;
  }
  const akamatsuSameTypeBlocked = $derived.by(() => {
    if (!pendingSelection || pendingSelection.effectKey !== 'akamatsu-split') return false;
    if (selectionPicked.size < 2) return false;
    const iids = [...selectionPicked];
    const types = iids.map(iid => {
      const item = selectionItems.find(it => it.iid === iid);
      const c = item ? getCard(item.cardId) : null;
      if (!c) return `?${iid}`; // 缺資料時以 iid 當獨立值，避免誤判為同屬性
      // 優先用 pokemonType；沒有就從名字解析；兩者都拿不到則視為「未知-該張 iid」避免誤擋
      return c.pokemonType ?? basicEnergyTypeFromName(c.name) ?? `?${iid}`;
    });
    return new Set(types).size < types.length;
  });

  // v5.014：小剛的發掘 — 同 modal 顯示基礎+進化的動態選擇規則
  //   點 Basic 後只能繼續點 Basic（最多 2）；點 Evolution 後不能再點任何
  const brocksDigPickState = $derived.by(() => {
    if (!pendingSelection || pendingSelection.effectKey !== 'brocks-dig-unified') {
      return { hasBasic: false, hasEvolution: false, basicCount: 0 };
    }
    let hasBasic = false, hasEvolution = false, basicCount = 0;
    for (const iid of selectionPicked) {
      const item = selectionItems.find(it => it.iid === iid);
      if (!item) continue;
      const card = getCard(item.cardId);
      if (!card) continue;
      if (card.evolvesFrom) hasEvolution = true;
      else { hasBasic = true; basicCount++; }
    }
    return { hasBasic, hasEvolution, basicCount };
  });
  // 給單一 iid 用 — 是否該 disable 點擊（保留：已選的 iid 永遠可點以取消選擇）
  function isBrocksDigDisabled(item: CardInstance): boolean {
    if (!pendingSelection || pendingSelection.effectKey !== 'brocks-dig-unified') return false;
    if (selectionPicked.has(item.iid)) return false;  // 已選 → 允許取消
    const card = getCard(item.cardId);
    if (!card) return false;
    const isEvo = !!card.evolvesFrom;
    if (brocksDigPickState.hasEvolution) return true;     // 已選 Evolution → 全擋
    if (brocksDigPickState.basicCount >= 2) return true;  // 已選 2 Basic → 全擋
    if (brocksDigPickState.hasBasic && isEvo) return true; // Basic 已選 → 擋 Evolution
    return false;
  }
  // v5.489：豐收漁網 — 同 picker 內分類上限（【水】寶可夢 ≤3、基本【水】能量 ≤3）
  const fishnetPickState = $derived.by(() => {
    if (!pendingSelection || pendingSelection.effectKey !== 'fishnet-unified') {
      return { pokeCount: 0, energyCount: 0 };
    }
    let pokeCount = 0, energyCount = 0;
    for (const iid of selectionPicked) {
      const item = selectionItems.find(it => it.iid === iid);
      if (!item) continue;
      const card = getCard(item.cardId);
      if (!card) continue;
      if (card.supertype === 'Pokemon') pokeCount++;
      else if (card.supertype === 'Energy') energyCount++;
    }
    return { pokeCount, energyCount };
  });
  function isFishnetDisabled(item: CardInstance): boolean {
    if (!pendingSelection || pendingSelection.effectKey !== 'fishnet-unified') return false;
    if (selectionPicked.has(item.iid)) return false;  // 已選 → 允許取消
    const card = getCard(item.cardId);
    if (!card) return false;
    if (card.supertype === 'Pokemon') return fishnetPickState.pokeCount >= 3;   // 寶可夢已選 3 → 擋
    if (card.supertype === 'Energy') return fishnetPickState.energyCount >= 3;   // 能量已選 3 → 擋
    return false;
  }
  // damage-distribute 本批次加總的 counter 數（= 各 iid 的 count 之和）
  const selectionBatchSum = $derived.by(() => {
    let s = 0;
    for (const n of Object.values(selectionCounts)) s += n;
    return s;
  });
  const selectionValid = $derived.by(() => {
    if (!pendingSelection) return false;
    if (akamatsuSameTypeBlocked) return false;
    // v5.014：小剛的發掘 — 拒絕同時混選 Basic + Evolution；Evolution 最多 1；Basic 最多 2
    if (pendingSelection.effectKey === 'brocks-dig-unified') {
      if (brocksDigPickState.hasBasic && brocksDigPickState.hasEvolution) return false;
      if (brocksDigPickState.hasEvolution && selectionPicked.size > 1) return false;
      if (brocksDigPickState.basicCount > 2) return false;
    }
    if (pendingSelection.effectKey === 'fishnet-unified') {
      if (fishnetPickState.pokeCount > 3 || fishnetPickState.energyCount > 3) return false;
    }
    if (pendingSelection.type === 'damage-distribute') {
      const n = selectionBatchSum;
      return n >= pendingSelection.minCount && n <= pendingSelection.maxCount;
    }
    // v2.87 energy-distribute：count 總和必須 = totalCount
    if (pendingSelection.type === 'energy-distribute') {
      const n = selectionBatchSum;
      return n >= pendingSelection.minCount && n <= pendingSelection.maxCount;
    }
    // v2.164 reorder-deck-top：用保留的 keep 列表長度當判定
    if (pendingSelection.type === 'reorder-deck-top') {
      const n = selectionReorderKeep.length;
      return n >= pendingSelection.minCount && n <= pendingSelection.maxCount;
    }
    // v3.876：modal-choice + stepper（願增猿腎上腺腦力 / 潔淨支援 / 泰姆猜HP 等）
    //   stepper UI 不會 add 任何東西到 selectionPicked，valid 應檢查 selectionStepperValue 是否在 stepper.min/max 範圍內。
    //   fall-through 到下方「selectionPicked.size >= minCount」分支會永遠 false → confirmSelection 早退卡死。
    if (pendingSelection.type === 'modal-choice' && pendingSelection.params?.stepper) {
      const stepper = pendingSelection.params.stepper as { min: number; max: number; step: number; init: number };
      return selectionStepperValue >= stepper.min && selectionStepperValue <= stepper.max;
    }
    // v2.69：撤退能量選擇用「能量單位」判定（火箭隊能量 1 張 = 2 units）
    // 而非張數；要求選中能量單位總和 ≥ retreatCost。
    // v2.108：傳 state+actorIdx 讓大竺葵繁茂套上（基本【草】能量 = 2 units）。
    // v3.823：加 essential 上限 — 拿掉任一張就 < retreatCost（即每張都必要）。
    //   原邏輯只看 ≥ retreatCost，玩家身上 1 草 + 1 火、撤退費 1 時兩張都選也通過 → 多丟一張。
    //   修法：嚴格 PTCG 規則 — 撤退時丟剛好足夠的能量，不能多丟。
    if (pendingSelection.type === 'active-energy-discard'
        && pendingSelection.effectKey === 'retreat-energy-discard') {
      const retreatCost = (pendingSelection.params?.retreatCost as number | undefined) ?? 0;
      if (selectionPicked.size === 0) return false;
      const pickedInsts = selectionItems.filter(it => selectionPicked.has(it.iid));
      const actorIdxR = pendingSelection.actorIdx as 0 | 1;
      // v5.144：取 host (attacker.active) 給 totalEnergyUnits 判定燃火能量 on 進化 = 3 units。
      //   v5.125 已修 totalEnergyUnits 加 hostInst 參數但 UI 沒補 → 浩大鯨 (Stage1) 附燃火能量
      //   時 sum 算 1 unit < retreatCost 3 → 確定按鈕灰色卡死。
      const hostForRetreat = game?.players[actorIdxR].active ?? undefined;
      // v3.35：totalEnergyUnits 接受 GameState | undefined；game ($state) 為 GameState | null，做 ?? undefined 轉換
      const total = totalEnergyUnits(pickedInsts, pool, game ?? undefined, actorIdxR, hostForRetreat);
      if (total < retreatCost) return false;
      // v3.823：essential 檢查 — 每張 picked 卡都必要（拿掉它就不足）
      //   範例：picked = [雙倍渦輪(2)] + retreatCost=1 → 拿掉雙倍渦輪 0<1 → essential ✓ 合法
      //         picked = [草(1), 火(1)] + retreatCost=1 → 拿掉草 1≥1 → 草非 essential ✗ 不合法
      for (const inst of pickedInsts) {
        const remaining = pickedInsts.filter(x => x.iid !== inst.iid);
        const remainingUnits = totalEnergyUnits(remaining, pool, game ?? undefined, actorIdxR, hostForRetreat);
        if (remainingUnits >= retreatCost) return false;  // 多丟了
      }
      return true;
    }
    // v5.949「選 N 個能量」(繁茂/特殊能量 host-aware)+彈性卡數:合法 ⟺ 張數 k ≤ N ≤ Σ單位。
    //   噴射旋風等:繁茂下基本草各 2 單位→可只選 2 張(算 2+1=3個)或 3 張(各 1=3個)。非繁茂時 k=N=張數(等價舊行為)。
    if (pendingSelection.type === 'active-energy-discard' && pendingSelection.params?.unitTarget != null) {
      const _N = pendingSelection.params.unitTarget as number;
      const _k = selectionPicked.size;
      if (_k === 0 || _k > _N) return false;
      const _pickedU = selectionItems.filter(it => selectionPicked.has(it.iid));
      const _ownerU = (pendingSelection.params.unitOwnerIdx as 0 | 1 | undefined) ?? (pendingSelection.actorIdx as 0 | 1);
      const _hostU = game?.players[_ownerU].active ?? undefined;
      const _maxU = totalEnergyUnits(_pickedU, pool, game ?? undefined, _ownerU, _hostU);
      return _N <= _maxU;  // k ≤ N 已於上驗;此處驗 N ≤ Σ單位
    }
    // v5.424：確定鈕一律需 ≥1（防呆，未選不可確定）；選 0 的合法路徑改走【不選】鈕（僅可略過的 picker 才有）
    return selectionPicked.size >= selectionConfirmFloor(pendingSelection.minCount)
        && selectionPicked.size <= pendingSelection.maxCount;
  });

  // ── 音效與音樂設定（v2.118 + BGM）────────────────────────────────────────
  let showSettingsModal = $state(false);
  let audioVolume = $state(0.5);
  let audioMuted = $state(false);
  // v4.928 sub-bus 音量
  let uiVolume = $state(1.0);
  let sfxVolume = $state(1.0);
  let statusVolume = $state(1.0);
  // v4.929 切到背景頁籤時是否仍播音（讓玩家用聽覺判斷對戰開始）
  let playWhenHidden = $state(true);
  let bgmTrack = $state('none');
  let bgmVolume = $state(0.5);
  let bgmAudioEl: HTMLAudioElement | null = $state(null);
  // v6.130 BGM 上架站長原創曲。瀏覽器的 autoplay policy 會擋掉「無使用者手勢的自動播放」，
  //   而重整回訪時 bgmTrack 是從 localStorage 讀回來的（沒有手勢）→ 一定被擋。
  //   ⚠ <audio autoplay> 屬性被擋是**靜默**的（拿不到 promise）；改用程式呼叫 play() 才 catch 得到
  //   NotAllowedError，才有辦法在首次點擊時補播。否則玩家會以為「設定沒存住」。
  let bgmBlocked = $state(false);
  /** 可選曲目白名單。localStorage 存的是曲目代號，舊值/壞值一律退回 'none'（避免拼出 404 網址）。 */
  const BGM_TRACKS = ['none', 'last-card'] as const;

  function onVolumeChange(v: number) {
    audioVolume = v;
    saveVolume(v);
  }
  function onMuteToggle() {
    audioMuted = !audioMuted;
    saveMuted(audioMuted);
  }
  /** 嘗試播放 BGM；被 autoplay policy 擋下時標記 bgmBlocked，等玩家第一次點擊再補播。 */
  function tryPlayBgm() {
    const el = bgmAudioEl;
    if (!el || bgmTrack === 'none') return;
    el.play().then(() => { bgmBlocked = false; }).catch(() => { bgmBlocked = true; });
  }
  function onBgmTrackChange(track: string) {
    bgmTrack = track;
    setBgmTrack(track);
    // 這裡仍在 <select> change 的使用者手勢窗內 → play() 會成功；
    // tick() 是等 {#if bgmTrack !== 'none'} 把 <audio> 掛上去、bgmAudioEl 綁定完成。
    void tick().then(() => tryPlayBgm());
  }
  /** 首次任何點擊 → 若先前被擋就補播（對戰頁玩家必然會點，體感上幾乎無感）。 */
  function unlockBgmOnGesture() { if (bgmBlocked) tryPlayBgm(); }
  function onBgmVolumeChange(v: number) {
    bgmVolume = v;
    setBgmVolume(v);
  }

  // ── 初始化 ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    decks = loadDecks();
    loadAudioPrefs();
    audioVolume = getAudioVolume();
    audioMuted = isAudioMuted();
    // v4.928 sub-bus 音量
    uiVolume = getUiVolume();
    sfxVolume = getSfxVolume();
    statusVolume = getStatusVolume();
    // v4.929 playWhenHidden + preload ready-go sample
    // v4.968: 換成「Start the game already.mp3」(用戶提供的開戰語音)
    playWhenHidden = getPlayWhenHidden();
    preloadReadyGoSample(`${base}/sounds/start-the-game-already.mp3`);
    // v6.130：舊值/壞值退回 'none'，避免拼出 /music/<不存在>.mp3 的 404
    const _savedTrack = getBgmTrack();
    bgmTrack = (BGM_TRACKS as readonly string[]).includes(_savedTrack) ? _savedTrack : 'none';
    bgmVolume = getBgmVolume();
    // 重整回訪且先前選過曲目 → 這裡沒有使用者手勢，play() 多半被擋（bgmBlocked=true），
    // 由 unlockBgmOnGesture 在玩家第一次點擊時補播。
    void tick().then(() => tryPlayBgm());
    window.addEventListener('pointerdown', unlockBgmOnGesture);
    // 匿名登入（線上對戰需要）— v4.924 改用 Firebase + Oracle 並行：
    //   v4.65 原本是 if/else 二擇一，但 vite 沒 swap $lib/firebase，Firebase
    //   Auth SDK 在 Oracle build 下完全可用（牌組編輯器頁就是這樣跑的）。
    //   分流導致 firebaseUser 在 Oracle build 永遠 null → dashboard 不顯示。
    //   修法：Firebase auth 永遠初始化（給 dashboard 用 firebaseUser）；
    //   Oracle build 額外取 Oracle JWT（給房間 API 用）。myUid 在 ORACLE_MODE
    //   下仍走 Oracle JWT uid，避免房間 memberUid 比對失敗。
    onAuthStateChanged(auth, async u => {
      firebaseUser = u;
      // Oracle build 下 myUid 必須走 Oracle JWT uid（房間 API 簽 JWT 用），
      // 不能被 Firebase uid 蓋掉 → 加 gate 阻擋 callback 覆寫 myUid。
      if (!ORACLE_MODE) {
        myUid = u?.uid ?? null;
      }
      // v4.937：u=null（第一次造訪 / 登出後）→ 立即匿名重登。
      //   修「登出後 dashboard 完全消失（沒退到匿名狀態）」bug。
      //   pattern 同 decks/+page.svelte:409-414（牌組編輯器既有正確實作）。
      //   signInAnonymously 會再次觸發 callback 帶 anonymous user → firebaseUser 設定 →
      //   dashboard 顯示「👤 匿名 / 建立帳號」按鈕。
      // [admin fix]：admin 偷看觀戰 URL (?spectate=&admin=) 進 game 頁時跳過匿名重登，
      //   避免 cross-tab 蓋掉 admin.html 分頁的 password user → admin polling 全 403。
      // v4.985: 加 localStorage flag check — admin tab 登入時設 'ptcg_admin_active'，
      //   game/decks tab 看到此 flag 就跳過 sign-in 匿名（保留 admin user 避免被蓋）。
      if (!u) {
        const isAdminSpyURL = typeof window !== 'undefined' && (() => {
          const params = new URLSearchParams(window.location.search);
          return !!(params.get('admin') && params.get('spectate'));
        })();
        const isAdminActive = typeof window !== 'undefined'
          && !!localStorage.getItem('ptcg_admin_active');
        if (isAdminSpyURL || isAdminActive) {
          // 不 sign-in，等 SDK 從 IndexedDB load admin user 後 callback 會再 fire
          return;
        }
        try { await signInAnonymously(auth); } catch { /* retry on next visit */ }
        return;
      }
      // v4.925：跟著 user 變化同步雲端牌組（修「換帳號後仍顯示舊牌組」bug）。
      //   邏輯跟 decks/+page.svelte:409+ 同套：cloud + local merge by updatedAt。
      //   匿名 user 沒雲端帳號 → 只讀 localStorage。
      if (u && !u.isAnonymous) {
        try {
          const local = loadDecks();
          const cloud = await loadDecksFromCloud(u.uid);
          if (cloud.length > 0) {
            const merged = new Map<string, Deck>();
            for (const d of [...local, ...cloud]) {
              const existing = merged.get(d.id);
              if (!existing || d.updatedAt > existing.updatedAt) merged.set(d.id, d);
            }
            decks = sortDecks([...merged.values()]); // v5.352：自訂順序優先（對戰選牌組與編輯器一致）
            saveDecks(decks);
          } else {
            // cloud 空 → 用 local（保持原樣，不改動）
            decks = local;
          }
        } catch {
          // cloud 不可用 → fallback localStorage（不洗成空）
          decks = loadDecks();
        }
      } else if (u && u.isAnonymous) {
        // 匿名身份：純 localStorage
        decks = loadDecks();
      }
      // v4.935 Firebase 額度分流 trigger — URL `?mode=online`
      //   來源：GitHub Pages 站點擊「線上連線對戰」自動 redirect 到 Oracle 站時帶此參數。
      //   行為：auto-set mode='online' + 清掉 query string（避免分享 URL 時帶 ?mode=online）。
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('mode') === 'online') {
          mode = 'online';
          // 清 URL query string（保留 pathname + hash）
          const url = new URL(window.location.href);
          url.searchParams.delete('mode');
          window.history.replaceState({}, '', url.toString());
        }
      }
      // v4.927 Admin 偷看 trigger — URL `?admin=BASE64_TOKEN&spectate=ROOM`
      //   token = base64(admin email)，decode 後比對 ADMIN_EMAILS。
      //   不依賴 firebaseUser.email（game 頁不需登 admin 帳號）— 因為 admin
      //   只在 admin.html 登入，game 頁 firebaseUser 通常是匿名或玩家自己。
      if (!isAdminMode && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const adminParam = params.get('admin');
        const spectateRoom = params.get('spectate');
        if (adminParam && spectateRoom && adminParam !== '1') {
          // 解 base64 拿 email — atob() 失敗就 skip
          let adminEmail: string | null = null;
          try { adminEmail = atob(adminParam); } catch { /* invalid token */ }
          if (adminEmail && ADMIN_EMAILS.includes(adminEmail as any)) {
            const rc = spectateRoom.trim().toUpperCase();
            if (rc) {
              try {
                mode = 'online';
                onlineStep = 'room';
                roomCode = rc;
                amIHost = false;
                isAdminMode = true;
                // 等 poolReady 後才 startRoomSubscription — 避免 race
                if (poolReady) {
                  startRoomSubscription();
                  console.log('[admin spy] subscribed to room', rc);
                } else {
                  console.log('[admin spy] queued, waiting for poolReady');
                  // pool 載入是 onMount 內依序 await，靠下面 $effect 補觸發
                }
              } catch (e) {
                console.error('[admin spy] failed to subscribe', e);
              }
            }
          }
        }
      }
    });
    // v4.984: 刪掉冗餘 sign-in block — 此處與 onAuthStateChanged callback 內
    //   line 2534 並行觸發兩個 signInAnonymously，產生兩個不同 anonymous user
    //   互相覆蓋 → firebaseUser 反覆 toggle → 「匿名 建立帳號」auth pill 閃爍循環。
    //   callback 內 sign-in 已 cover 所有情境（first visit / 登出後 / admin spy gate）。
    // Oracle build 額外初始化 — 取 Oracle JWT 給房間 API
    if (ORACLE_MODE) {
      // ⭐⭐⭐v6.197 myUid 舊寫法只在這裡取一次：如果這一發 oracleAuth() 失敗（網路/儲存空間
      //   被擋），myUid 會**永遠停在 null**，而稍後 joinRoom 內部的 oracleAuth() 卻會成功並用
      //   新 uid 佔位 ⇒ findMySeatIdx(room.seats, null) 一路回 -1 ⇒ 認不出座位。
      //   ⚠⚠ 訂閱只**補空白**、絕不取代一個已經在用的身分：401 自動重登（v5.628）會換到一個
      //   全新的 uid，但**座位裡存的是加入當下那個舊 uid**；把 myUid 換成新的等於親手把
      //   對戰中的 P1/P2 打成「認不出座位」（fail-closed 之後就是直接鎖成唯讀）。
      //   ⇒ 只有「本來就沒有身分」時才填。
      _unsubOracleUid = onOracleUidChange((uid) => { if (!myUid) myUid = uid; });
      try {
        const { uid } = await oracleAuth();
        myUid = uid;
      } catch (err) {
        console.error('[oracle auth]', err);
      }
    }

    // v5.894：不再一次全載 40 個卡包（4.6MB）。改按牌組只載雙方用到的卡包（完整性 fallback 缺卡則全載兜底）。
    //   先把本機已存牌組（allDecks）用到的卡包載入，讓本機/AI lobby 驗牌立即可用；線上對手卡包於開局前補齊。
    try {
      const _localEntries: { cardId: string }[] = [];
      for (const d of allDecks) for (const e of d.entries) _localEntries.push({ cardId: String(e.cardId) });
      if (_localEntries.length > 0) await ensurePoolForDeckEntries([_localEntries]);
    } catch (e) { console.error('[pool] 初始按牌組載入失敗', e); }
    poolReady = true;
    // v5.991：對戰頁載入後抽測特性註冊完整性(黑夜魔靈咒詛炸彈等核心特性),miss=版本載入異常→顯性提示
    try { const _chk = selfCheckAbilityRegistry(); if (!_chk.ok) { abilityRegBroken = true; console.warn('[PTCG] 特性註冊自檢失敗,建議重新整理:', _chk.missing); } } catch (_e) {}

    // 如果 host 在 poolReady 前就收到了 ready 狀態，現在補建遊戲
    checkAndStartOnlineGame();
  });

  onDestroy(() => {
    stopHeartbeat();
    window.removeEventListener('pointerdown', unlockBgmOnGesture);   // v6.130 BGM 手勢解鎖
    closeAudio();  // v4.928: 釋放 AudioContext + 停所有 in-flight oscillators
    if (tPollTimer) { clearInterval(tPollTimer); tPollTimer = null; tPollGen++; }
    unsubRoom?.();
    unsubOpenRooms?.();
    _unsubOracleUid?.(); _unsubOracleUid = null;   // ⭐v6.197 不解除就會每次重進 /game 疊一個
    // v4.40：補 chat messages listener leak（玩家硬改網址不走 leaveOnlineGame 時殘留）
    unsubMessages?.(); unsubMessages = null;
    if (aiTimer !== null) clearTimeout(aiTimer);
  });

  // ── v4.913 Auth actions（從牌組編輯器 port 過來） ────────────────────
  function openAuthModal() {
    authTab = isAnonymous ? 'upgrade' : 'login';
    authEmail = '';
    authPassword = '';
    authError = null;
    showAuthModal = true;
  }

  /** 匿名帳號升級為 Email 帳號（保留現有 uid） */
  async function upgradeAccount() {
    if (!authEmail || !authPassword) { authError = '請輸入 Email 和密碼'; return; }
    authLoading = true; authError = null;
    try {
      const credential = EmailAuthProvider.credential(authEmail, authPassword);
      await linkWithCredential(auth.currentUser!, credential);
      showAuthModal = false;
    } catch (e: any) {
      authError = friendlyAuthError(e.code);
    } finally { authLoading = false; }
  }

  /** 用 Email 登入（切換帳號） */
  async function loginWithEmail() {
    if (!authEmail || !authPassword) { authError = '請輸入 Email 和密碼'; return; }
    authLoading = true; authError = null;
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
      showAuthModal = false;
    } catch (e: any) {
      authError = friendlyAuthError(e.code);
    } finally { authLoading = false; }
  }

  /** 登出（回到匿名狀態） */
  async function handleSignOut() {
    if (!confirm('確定登出？登出後將以匿名模式繼續使用。')) return;
    await signOut(auth);
  }

  // 忘記密碼：寄送 Firebase 重設信
  async function sendResetEmail() {
    if (!authEmail) { authError = '請輸入 Email'; return; }
    authLoading = true; authError = null; resetEmailSent = false;
    try {
      await sendPasswordResetEmail(auth, authEmail);
      resetEmailSent = true;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      authError = friendlyAuthError(code);
    } finally { authLoading = false; }
  }

  // 開啟更改密碼 modal
  function openChangePasswordModal() {
    cpOldPassword = '';
    cpNewPassword = '';
    cpNewPasswordConfirm = '';
    cpError = null;
    cpSuccess = false;
    showChangePasswordModal = true;
  }

  // 送出更改密碼
  async function submitChangePassword() {
    if (!cpOldPassword || !cpNewPassword) { cpError = '請輸入舊密碼與新密碼'; return; }
    if (cpNewPassword.length < 6) { cpError = '新密碼至少需要 6 個字元'; return; }
    if (cpNewPassword !== cpNewPasswordConfirm) { cpError = '兩次輸入的新密碼不一致'; return; }
    const user = auth.currentUser;
    if (!user || !user.email) { cpError = '未登入或非 Email 帳號'; return; }
    if (cpNewPassword === cpOldPassword) { cpError = '新密碼不能與舊密碼相同'; return; }
    cpLoading = true; cpError = null;
    try {
      const cred = EmailAuthProvider.credential(user.email, cpOldPassword);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, cpNewPassword);
      cpSuccess = true;
      cpOldPassword = '';
      cpNewPassword = '';
      cpNewPasswordConfirm = '';
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      cpError = friendlyAuthError(code);
    } finally { cpLoading = false; }
  }

  function friendlyAuthError(code: string): string {
    const map: Record<string, string> = {
      'auth/email-already-in-use': '此 Email 已被其他帳號使用',
      'auth/invalid-email': 'Email 格式不正確',
      'auth/weak-password': '密碼至少需要 6 個字元',
      'auth/wrong-password': '密碼錯誤',
      'auth/user-not-found': '找不到此 Email 的帳號',
      'auth/too-many-requests': '嘗試次數過多，請稍後再試',
      'auth/credential-already-in-use': '此帳號已存在，請直接登入',
      'auth/invalid-credential': '帳號或密碼錯誤',
      'auth/requires-recent-login': '此操作需要最近一次登入認證，請重新登入後再試',
      'auth/missing-email': '請輸入 Email',
      'auth/network-request-failed': '網路連線失敗，請檢查網路後重試',
    };
    return map[code] ?? `操作失敗（${code}）`;
  }

  // 在線上 Lobby 的 join 步驟訂閱開放房間列表
  //
  // ⚠⚠⚠ v6.118 效能事故修正：這裡以前**沒有 `!isTournament` gate**。
  //   /tournament 路由是 `<GamePage tournamentMode={true} />`（同一個元件），而
  //   `onlineStep` 的初始值就是 `'join'`，且錦標賽流程從頭到尾不會去改它
  //   （三個 `onlineStep = 'room'` 賦值點全在休閒線上的建房／加入／admin 觀戰路徑上）；
  //   正式站又會在 onMount 無條件 `oracleAuth()` 設好 `myUid`。
  //   ⇒ **每個開著錦標賽頁的玩家，整場都在每 2 秒打兩支 `/api/rooms`**
  //     （subscribeOpenRooms 的 tick 是 2000ms，一次 lobby 一次 playing）。
  //     30 人賽 ≈ 每秒 30 個純浪費的請求打進 Oracle 的單執行緒，
  //     疊在錦標賽本身的輪詢上就是玩家回報的「人一多就很 lag」。
  //   錦標賽頁根本不顯示休閒大廳列表，這些資料一筆都用不到。
  $effect(() => {
    if (!isTournament && mode === 'online' && onlineStep === 'join' && myUid) {
      unsubOpenRooms?.();
      openRoomsErr = '';
      unsubOpenRooms = subscribeOpenRooms(
        rooms => {
          openRooms = rooms; openRoomsErr = '';
          // v6.115：只問「還沒有標籤且 30 秒內沒問過」的對戰中房間 —— 一場對戰內牌組不會變，
          //   所以正常情況每間房只會問一次，不會隨大廳每 2 秒輪詢一起放大。
          void ensureRoomArchetypes(rooms);
        },
        err => {
          openRoomsErr = err?.message?.includes('index')
            ? '房間查詢需要 Firestore 索引（尚未部署），已退回手動房號。'
            : `房間列表載入失敗：${err?.message ?? '未知錯誤'}`;
        },
      );
    } else {
      unsubOpenRooms?.();
      unsubOpenRooms = null;
      openRooms = [];
      openRoomsErr = '';
    }
  });

  // 從房間列表一鍵加入
  async function handleJoinFromList(rc: string) {
    // v2.270：v2.269 重構後加入時不需選牌組（房內才選），只檢查名稱
    if (!myName.trim()) { onlineError = '請先填寫玩家名稱'; return; }
    joinInput = rc;
    await handleJoinRoom();
  }

  // ── 輔助函式 ────────────────────────────────────────────────────────────────
  // v5.322: typeRank — 玩家視角排序 (寶可夢→物品→支援者→場地→能量, 同類內 count/name)
  //   跟 MobilePortraitBattle.svelte groupDiscardList 同邏輯, 給「查看牌庫剩餘」picker 用
  function cardTypeRank(c: Card | undefined): number {
    if (!c) return 9;
    if (c.supertype === 'Pokemon') return 1;
    if (c.supertype === 'Trainer') {
      if (c.subtype === 'Supporter') return 3;
      if (c.subtype === 'Stadium') return 4;
      return 2;
    }
    if (c.supertype === 'Energy') return 5;
    return 9;
  }
  function getCard(cardId: string): Card | undefined { return pool.get(cardId); }
  function hpRemaining(inst: CardInstance): number {
    return Math.max(0, getEffectiveHP(inst, pool, game ?? undefined) - inst.damage);
  }
  function hpTotal(inst: CardInstance | null | undefined): number {
    return inst ? getEffectiveHP(inst, pool, game ?? undefined) : 0;
  }
  // v2.228 改寫：原本用 countEnergy（cost 檢查語意，全屬性能量會展開成 10 種屬性各 1）
  //   → SEND_NEW_ACTIVE 等 picker UI 顯示「水×1 火×1 雷×1 ...」誤導又凌亂。
  //   改為 delegate 到 energyPips（pip 顯示語意：1 張卡 = 1 個 pip），
  //   全屬性卡（古舊/夜光/稜鏡基礎/新衝天）顯示「彩×1」即可。
  function energySummary(inst: CardInstance): string {
    const pips = energyPips(inst);
    if (pips.length === 0) return '無能量';
    return pips.map(p => `${p.label ?? ENERGY_LABEL[p.type as EnergyType]}×${p.count}`).join(' ');
  }
  /**
   * v2.47：備戰區專用的緊湊能量圖示 — 以小圓形彩色 pip 橫向排列，
   * 取代「火×2 水×1」這種文字表達，避免 bench-slot 被撐寬或換行。
   * 回傳 { type, count } 陣列供模板 #each 渲染。
   */
  // v2.120：以「一張卡 = 一個 pip」為原則，避免全屬性特殊能量展成 10 個 pip。
  // 'Rainbow' = virtual type「彩」，用於古舊/夜光/稜鏡(on Basic)/新衝天 等全屬性卡。
  // 火箭隊能量：看 host 招式需求 → 2 顆惡 或 2 顆超 或 1 超 1 惡。
  function energyPips(inst: CardInstance): Array<{ type: string; count: number; label?: string }> {
    const host = getCard(inst.cardId);
    const hostIsEvolution = !!host?.evolvesFrom || host?.stage === 'Stage1' || host?.stage === 'Stage2';
    const hostIsStage2 = host?.stage === 'Stage2';
    const hostNeedsType = (t: EnergyType): boolean =>
      !!host?.attacks?.some(a => a.cost?.includes(t));

    // Map<pip type> → count。用 Map 保留插入順序（先來先列）。
    const counts = new Map<string, number>();
    const bump = (type: string, n = 1) => counts.set(type, (counts.get(type) ?? 0) + n);

    for (const e of inst.energyAttached) {
      const ec = getCard(e.cardId);
      if (!ec) continue;
      // 基本能量：按卡片 pokemonType 或 name 解析
      if (ec.subtype === 'Basic') {
        let t: string = 'Colorless';
        if (ec.pokemonType) t = ec.pokemonType;
        else {
          const m = ec.name.match(/【(.+?)】/);
          const zhMap: Record<string, EnergyType> = {
            草: 'Grass', 火: 'Fire', 水: 'Water', 雷: 'Lightning',
            超: 'Psychic', 鬥: 'Fighting', 惡: 'Darkness', 鋼: 'Metal',
            龍: 'Dragon', 無: 'Colorless',
          };
          if (m && zhMap[m[1]]) t = zhMap[m[1]];
        }
        bump(t);
        continue;
      }
      // 特殊能量：依卡名分類
      const name = ec.name;
      // 全屬性類 → Rainbow「彩」
      if (name === '古舊能量' || name === '夜光能量') { bump('Rainbow'); continue; }
      if (name === '稜鏡能量') { bump(hostIsEvolution ? 'Colorless' : 'Rainbow'); continue; }
      if (name === '新衝天能量') {
        if (hostIsStage2) { bump('Rainbow', 2); }
        else { bump('Colorless'); }
        continue;
      }
      // 火箭隊能量：看 host 招式需求 → 顯示相符屬性 ×2
      if (name === '火箭隊能量') {
        const needsDark = hostNeedsType('Darkness');
        const needsPsychic = hostNeedsType('Psychic');
        if (needsDark && !needsPsychic)      { bump('Darkness', 2); }
        else if (needsPsychic && !needsDark) { bump('Psychic', 2); }
        else                                  { bump('Psychic'); bump('Darkness'); }
        continue;
      }
      // 燃火能量：on 進化 = 3 顆【無】；其他 = 1 顆【無】
      if (name === '燃火能量') {
        if (hostIsEvolution) bump('Colorless', 3);
        else bump('Colorless');
        continue;
      }
      // 單屬性特殊能量（感應【超】/ 硬岩【鬥】 / 磁鐵【鋼】 等）→ 主屬性
      //   name 例如「感應【超】能量」→ 取【X】解析
      const m = name.match(/【(.+?)】/);
      if (m) {
        const zhMap: Record<string, EnergyType> = {
          草: 'Grass', 火: 'Fire', 水: 'Water', 雷: 'Lightning',
          超: 'Psychic', 鬥: 'Fighting', 惡: 'Darkness', 鋼: 'Metal',
          龍: 'Dragon', 無: 'Colorless',
        };
        if (zhMap[m[1]]) { bump(zhMap[m[1]]); continue; }
      }
      // fallback：無色
      bump('Colorless');
    }
    // 轉出，Rainbow 加 label '彩'
    return [...counts.entries()].map(([type, count]) => ({
      type,
      count,
      ...(type === 'Rainbow' ? { label: '彩' } : {}),
    }));
  }
  function hpColor(rem: number, tot: number): string {
    const p = tot > 0 ? rem/tot : 1;
    return p > 0.5 ? '#2c7a3c' : p > 0.25 ? '#e0a020' : '#c00';
  }
  function retreatCostOf(inst: CardInstance): number {
    // v5.473：撤退費收斂——委派 engine 中央 computeActiveRetreatCostFor（與實際撤退 / getRetreatCost
    //   同一來源，含道具 / 特殊能量 / 重力之玉 / 天空徑線(初始化消除) / 競技場 / ABILITY_RETREAT_MOD / 鼓擊；
    //   UI 不再各自重算，免漏修）。retreatCostOf 4 處 call site 一律以 myPlayer.active 呼叫，故用 myIdx。
    if (!game) return getCard(inst.cardId)?.retreatCost?.length ?? 0;
    return computeActiveRetreatCostFor(game, myIdx as 0 | 1, pool);
  }
  // v5.020 桌墊版 — 列出 inst 身上所有 attached cards（能量 / 道具 / 進化堆）扁平陣列。
  // 用於 .att-card-stack 重疊呈現；kind 影響 border 顏色區分種類。
  // v5.231 排序（由下到上 = z-index 低到高 = array 由後到前）：
  //   1. 普通能量（最下，最早 render，最大露出）
  //   2. 特殊能量
  //   3. 寶可夢道具
  //   4. 基礎寶可夢（evolvedFromStack[0]）
  //   5. 1 階寶可夢（evolvedFromStack[1...]）
  //   6. 寶可夢本體（z=99，最上）
  //   實作：array index 小 = z-index 高 = 越靠近本體 = 渲染在上層
  //   推入順序（由本體往外推）：進化堆反序 → 道具 → 特殊能量 → 普通能量
  // v5.606 防呆：依 iid 去重，避免任何瞬時/異常重複 iid 讓 Svelte keyed {#each} 丟 each_key_duplicate（整頁崩潰白屏）。
  //   正常情況下 iid 唯一→回傳原樣（不影響動畫）；萬一引擎瞬時產生重複 iid，寧可少顯示一張也不要整個對戰畫面崩掉。
  function dedupeByIid<T extends { iid?: string }>(list: readonly T[] | null | undefined): T[] {
    if (!list) return [];
    const seen = new Set<string>(); const out: T[] = [];
    for (const c of list) { const k = (c as any)?.iid; if (typeof k === 'string') { if (seen.has(k)) continue; seen.add(k); } out.push(c as T); }
    return out;
  }
  function attachedCardsOf(inst: CardInstance | null | undefined): Array<{ cardId: string; iid: string; kind: 'energy' | 'tool' | 'evo' }> {
    if (!inst) return [];
    const out: Array<{ cardId: string; iid: string; kind: 'energy' | 'tool' | 'evo' }> = [];
    // 進化堆反序：[基礎, 1階] → 推入順序為 [1階(靠近本體), 基礎(最遠)]
    const evoStack = inst.evolvedFromStack ?? [];
    for (let i = evoStack.length - 1; i >= 0; i--) {
      const ev = evoStack[i];
      out.push({ cardId: ev.cardId, iid: ev.iid, kind: 'evo' });
    }
    // 寶可夢道具
    if (inst.toolAttached) out.push({ cardId: inst.toolAttached.cardId, iid: inst.toolAttached.iid, kind: 'tool' });
    for (const et of inst.extraTools ?? []) out.push({ cardId: et.cardId, iid: et.iid, kind: 'tool' });
    // 能量：特殊能量先（上層）、普通能量後（最下層）
    const specialEnergies: typeof inst.energyAttached = [];
    const basicEnergies: typeof inst.energyAttached = [];
    for (const e of inst.energyAttached) {
      const card = getCard(e.cardId);
      if (card?.subtype === 'Special') specialEnergies.push(e);
      else basicEnergies.push(e);
    }
    for (const e of specialEnergies) out.push({ cardId: e.cardId, iid: e.iid, kind: 'energy' });
    for (const e of basicEnergies) out.push({ cardId: e.cardId, iid: e.iid, kind: 'energy' });
    return dedupeByIid(out);
  }
  function evoOptionsFor(fromIid: string): CardInstance[] {
    const entry = evolvableTargets.find(e => e.fromIid === fromIid);
    if (!entry || !myPlayer) return [];
    return myPlayer.hand.filter(c => entry.toIids.includes(c.iid));
  }
  // 手牌某張進化卡 → 可進化到哪些場上寶可夢 iid
  function evolveTargetsFor(handIid: string): string[] {
    const targets: string[] = [];
    for (const entry of evolvableTargets) {
      if (entry.toIids.includes(handIid)) targets.push(entry.fromIid);
    }
    return targets;
  }

  // ── 動作分派（本機 + 線上共用） ─────────────────────────────────────────────
  // ── 錦標賽 transport（伺服器權威）：dispatch 在 isTournament 時改走這裡 ──
  async function tApi(path: string, body?: any, opts?: { timeoutMs?: number }) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // ⭐v6.159 四段拆分的起點。⚠ 只是三個數字：沒有 await、沒有物件配置、沒有任何分支改變，
    //   控制流程與 v6.158 逐字相同（這一版的紀律是「只加量測」）。
    const _segT0 = _pnow();
    let _segT1 = _segT0, _segT2 = _segT0;
    // v0.5 A1：帶 Firebase ID token，伺服器 verifyIdToken 驗證身分（禁匿名）
    // ⭐⭐⭐v6.167 這一段 await 在下面那顆逾時計時器**之前** —— v6.135 的逾時只保護 fetch，
    //   `getIdToken()` 在 token 過期時會發真的網路請求，隧道黑洞／裝置睡眠喚醒時它可能
    //   既不 resolve 也不 reject ⇒ 整支 tApi 掛住 ⇒ 呼叫端的 `finally { tBusy = false }`
    //   永遠不執行 ⇒ 大廳每一顆鈕（含「✋ 我要報到」）永久 disabled、卡在「報到中…」
    //   ＝玩家被鎖在賽外，而且畫面上沒有任何錯誤訊息可以讓他知道發生什麼事。
    //   ⇒ 給它 6 秒上限。逾時就**不帶 Authorization** 送出去：伺服器要嘛走 playerId fallback、
    //     要嘛回一個看得見的錯誤，兩者都比「按鈕永遠不會回來」好（可用性優先，站長裁定）。
    //   ⚠ 逾時的那一支 getIdToken 仍在背景跑，只是我們不再等它；不 abort 是因為 Firebase
    //     沒有提供取消介面，而硬中斷它會連帶影響其他共用同一份 token 的呼叫。
    try {
      if (firebaseUser && !firebaseUser.isAnonymous) {
        const _tok: any = await Promise.race<any>([
          firebaseUser.getIdToken(),
          new Promise((r) => setTimeout(() => r(null), 6000)),
        ]);
        if (_tok) headers['Authorization'] = 'Bearer ' + _tok;
      }
    } catch { /* 取 token 失敗 → 伺服器退回 playerId fallback */ }
    _segT1 = _pnow();   // ① token 段結束
    // ⭐v6.179 開一個 fetch 時間窗，等 Resource Timing 的 entry 回來好對回「是哪一發」。
    //   ⚠ 沒有 await、沒有分支改變，控制流程與 v6.178 逐字相同（這一版的紀律是「只加量測」）。
    const _rtWin = _tResWinOpen(path, _segT1);
    // v6.135 逾時保護：fetch 預設沒有 timeout（瀏覽器要幾百秒才放棄）。
    //   隧道排隊/黑洞時 `await fetch` 既不 resolve 也不 reject
    //   → tournamentDispatch 的 `finally { tBusy = false }` 永遠不執行
    //   → tBusy 永久 true → 之後**所有**點擊被 `if (tBusy) return` 靜默吞掉，
    //     而 tBusy 沒有任何 template 綁定（按鈕不會變灰）⇒ 玩家只會看到「按了沒反應」。
    //   POST(動作) 12s、GET(輪詢/查詢) 8s：伺服器 P95 是 8ms，正常情況遠不會觸發。
    //   進場/報名這種「失敗有狀態副作用」的呼叫可用 opts.timeoutMs 放寬（慢網路不該被誤殺）。
    const _toMs = opts?.timeoutMs ?? (body ? 12000 : 8000);
    const _ac = new AbortController();
    let _timedOut = false;  // 只認「這顆計時器造成的 abort」，不把其他來源的 AbortError 誤判成逾時
    const _to = setTimeout(() => { _timedOut = true; try { _ac.abort(); } catch { /* ignore */ } }, _toMs);
    try {
      const res = await fetch(T_API + path, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: _ac.signal,
      });
      _segT2 = _pnow();   // ② 網路段結束（response header 已回來，body 還沒讀）
      // ⭐v6.179 關窗。⚠ 逐出（abort/逾時）的那一發永遠不會走到這行 ⇒ `t2` 維持 0
      //   ⇒ 對齊時會被跳過（只排除，不靠它硬湊一發）—— 與 rtt/四段拆分同一條紀律：只記成功的往返。
      if (_rtWin) _rtWin.t2 = _segT2;
      // ⭐v6.213【③】伺服器自報的處理時間（同源，不需要 Access-Control-Expose-Headers）。
      //   ⚠ 只讀一個字串再轉數字：沒有 await、沒有分支改變控制流程（這一版仍是「只加量測」）。
      let _srvMs: number | null = null;
      try {
        const _sh = res.headers.get('X-Srv-Ms');
        if (_sh != null) { const _sv = Number(_sh); if (isFinite(_sv) && _sv >= 0) _srvMs = _sv; }
      } catch { /* 量測絕不影響對戰 */ }
      // ⭐v6.227 Cloudflare 邊緣節點：cf-ray 是**回應**標頭（同源 ⇒ 讀得到），'-' 之後就是 colo。
      //   一樣只讀一個字串：沒有 await、沒有新請求、沒有任何分支改變控制流程（只加量測）。
      let _colo: string | null = null;
      try {
        const _cray = res.headers.get('cf-ray');
        if (_cray) {
          const _ci = _cray.lastIndexOf('-');
          const _cc = _ci >= 0 ? _cray.slice(_ci + 1).trim().toUpperCase() : '';
          if (/^[A-Z0-9]{3,4}$/.test(_cc)) _colo = _cc;   // IATA 機場碼；格式不對一律當「沒有」
        }
      } catch { /* 量測絕不影響對戰 */ }
      if (!res.ok) {
        // v6.150：錦標賽 /state 對「認不出座位」回 401（不再回一份連自己都遮的盤面）。
        //   呼叫端必須分得出「身分失效」與「網路斷線」——兩者在畫面上的自救方式完全不同，
        //   否則玩家只會看到「與伺服器失聯」，按重新同步也沒反應，然後被閒置判負。
        const _err: any = new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
        _err.status = res.status;
        throw _err;
      }
      // ⚠ `res.text()` + `JSON.parse` 與 `res.json()` 語義相同（規範上 json() 就是 UTF-8 解碼後
      //   再 JSON.parse，壞 JSON 一樣丟 SyntaxError、一樣落到下面的 catch）。
      //   拆開的唯一理由是**量測**：把「body 下載（網路）」與「JSON.parse（主執行緒）」分開，
      //   這正是這一版要分辨的那兩件事。
      const _txt = await res.text();
      const _segT3 = _pnow();   // ③ body 下載段結束
      const _json = JSON.parse(_txt);
      // ⚠ 與 v6.151 的 rtt 同一條紀律：**只記成功的往返**。錯誤/逾時路徑（12 秒）記進去會扭曲統計。
      _tRecordApiSegments(path, _segT0, _segT1, _segT2, _segT3, _pnow());
      _tRecordSrvSample(path, _srvMs);   // ⭐v6.213【③】＋【②】：與上一行同一個範圍守衛（母體一致）
      _tRecordColoSample(path, _colo);   // ⭐v6.227：同一個範圍守衛（colo 的母體＝net/srv 的母體，才能對照）
      // ⭐⭐⭐v6.172 連線健康的**唯一**寫入點：任何一次成功的伺服器往返都算「連得上」。
      //   這就是為什麼 `POST /action` 全部成功之後不會再誤報失聯 —— 不必在每個呼叫端補一行，
      //   也不會有第二份判準漂移。
      _tMarkServerAlive();
      return _json;
    } catch (e: any) {
      // AbortError → 換成看得懂的訊息（呼叫端會顯示在 tError）
      if (_timedOut && e && (e.name === 'AbortError' || String(e).includes('AbortError'))) {
        throw new Error(`連線逾時（${Math.round(_toMs / 1000)} 秒沒有回應）`);
      }
      throw e;
    } finally { clearTimeout(_to); }
  }
  async function tournLogin() {
    if (!authEmail || !authPassword) { authError = '請輸入 Email 和密碼'; return; }
    authError = null; tBusy = true;
    try { await signInWithEmailAndPassword(auth, authEmail, authPassword); authPassword = ''; }
    catch (e: any) { authError = friendlyAuthError(e.code); }
    finally { tBusy = false; }
  }
  async function tournRegister() {
    if (!authEmail || !authPassword) { authError = '請輸入 Email 和密碼（至少 6 碼）'; return; }
    authError = null; tBusy = true;
    try { await createUserWithEmailAndPassword(auth, authEmail, authPassword); authPassword = ''; }
    catch (e: any) { authError = friendlyAuthError(e.code); }
    finally { tBusy = false; }
  }
  async function tournLogout() {
    // 登出：清錦標賽狀態 + signOut → onAuthStateChanged 退回匿名 → isAnonymous 觸發登入閘門
    try { if (tPollTimer) { clearInterval(tPollTimer); tPollTimer = null; } } catch { /* ignore */ }
    tPollGen++; // v5.586 使在路上的 in-flight poll 回應失效，避免返回大廳後被彈回對戰
    game = null; tVersion = -1; tStep = 'lobby'; myPlayerIndex = null; mySeatIdx = -1; tDeckId = ''; tError = ''; isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0;
    try { await signOut(auth); } catch { /* ignore */ }
  }
  // v5.650 錦標賽系統播報分類上色：依訊息開頭 emoji／關鍵字歸類，回傳對應 CSS class（皆亮色系，不傷眼）
  function tSysClass(text: string): string {
    const t = (text || '').trim();
    if (/冠軍|恭喜/.test(t) && /^(🏆|🎉)/.test(t)) return 'sc-champ';     // 冠軍誕生（金黃高亮）
    if (/^(🚫|⚠)/.test(t) || /無冠軍/.test(t)) return 'sc-cancel';        // 取消／不足／無冠軍（紅粉）
    if (/^🏳/.test(t) || /投降|棄權/.test(t)) return 'sc-forfeit';        // 投降／棄權（橙）
    if (/^⏰/.test(t)) return 'sc-timeout';                               // 逾時／未進場／閒置／時限（珊瑚紅）
    if (/^(⚖|🔄|⏳)/.test(t) || /管理員/.test(t)) return 'sc-admin';      // 管理員裁定／順延（淡紫）
    if (/^(📣|📋)/.test(t)) return 'sc-reg';                              // 報名／募集／發起（亮藍）
    if (/^(🔔|⚔|🎲|🏆)/.test(t)) return 'sc-bracket';                    // 賽程／配對／開賽（亮綠）
    return '';                                                            // 其他（維持原黃色）
  }
  async function tChatLoad() {
    // v5.624 防並發重入：tChatLoad 從多處呼叫（3s 輪詢 / 送出後 / 對戰中持續更新），
    //   同時跑會用「同一個 since」重複抓同一批訊息 → tChat 出現重複 id →
    //   keyed {#each tChat (m.id)} 丟 each_key_duplicate → 整頁渲染崩潰（連「返回賽事大廳」鈕都按不動）。
    //   錦標賽回合推進/勝利時系統連發多則廣播，最易觸發。
    if (_tChatLoading) return;
    _tChatLoading = true;
    try {
      const r = await tApi(`/chat?since=${tChatLastTs}`);
      if (r && typeof r.serverNow === 'number') tClockOffset = r.serverNow - Date.now();
      // v5.575：admin 清除聊天室 → 本地即時清空（不必 F5 重整）
      if (r && typeof r.clearedAt === 'number' && r.clearedAt > tChatClearedAt) {
        tChat = []; tChatClearedAt = r.clearedAt; tChatLastTs = r.clearedAt; tChatHasMore = false;
      }
      // v5.752 懶載入：初始(since=0)伺服器回最新一頁 + hasMore;增量輪詢(since>0)不附 hasMore→沿用。
      if (r && typeof r.hasMore === 'boolean') tChatHasMore = r.hasMore;
      if (r && Array.isArray(r.messages) && r.messages.length) {
        for (const m of r.messages) { if (m.ts > tChatLastTs) tChatLastTs = m.ts; }
        // v5.624 依 id 去重合併（杜絕並發/邊界重複造成的 each_key_duplicate）
        const _seen = new Set(); const _merged: any[] = [];
        for (const m of [...tChat, ...r.messages]) { const k = m && m.id; if (k != null) { if (_seen.has(k)) continue; _seen.add(k); } _merged.push(m); }
        tChat = _merged.slice(-600);  // v5.752 提高上限(原200)讓往上滑載入的舊訊息不被增量輪詢裁掉
      }
    } catch { /* ignore */ }
    finally { _tChatLoading = false; }
  }
  // v5.752 往上滑載入更舊訊息（懶載入：預設只讀最新一頁，需要的人滑到頂再續載，省流量）。
  async function tChatLoadOlder(el: HTMLElement | null) {
    if (_tChatLoadingOlder || !tChatHasMore || tChat.length === 0) return;
    _tChatLoadingOlder = true;
    const beforeTs = (tChat[0] && tChat[0].ts) || 0;
    const prevH = el ? el.scrollHeight : 0;
    const prevTop = el ? el.scrollTop : 0;
    try {
      const r = await tApi(`/chat?before=${beforeTs}`);
      if (r && Array.isArray(r.messages) && r.messages.length) {
        const _seen = new Set(tChat.map((m: any) => m && m.id));
        const older = r.messages.filter((m: any) => m && m.id != null && !_seen.has(m.id));
        if (older.length) tChat = [...older, ...tChat];
      }
      if (r && typeof r.hasMore === 'boolean') tChatHasMore = r.hasMore;
      // prepend 後內容變高，維持使用者原本看的位置（不讓畫面跳動）。
      if (el) requestAnimationFrame(() => { try { el.scrollTop = prevTop + (el.scrollHeight - prevH); } catch { /* noop */ } });
    } catch { /* ignore */ }
    finally { _tChatLoadingOlder = false; }
  }
  async function tChatSend() {
    const txt = (tChatInput || '').trim();
    if (!txt) return;
    tChatInput = '';
    try { const r = await tApi('/chat', { text: txt }); if (r && r.error) tError = r.error; await tChatLoad(); }
    catch (e: any) { tError = String(e?.message ?? e); }
  }
  async function tournLoadEvent() {
    // ⭐⭐⭐v6.161 降頻的「立即恢復」判準：先記下套用這一發回應**之前**的輪次/狀態/我的對戰，
    //   套用後若有任何一項變了，就是「輪次推進／我有新比賽」⇒ 立刻回正常頻率並馬上再抓一次。
    //   ⚠ 必須在覆寫 tEvents/tMyMatch **之前**取，否則永遠比不出差異（「改了卻沒生效」的典型形式）。
    const _prevSig = tEvents.map((e: any) => (e && e._id) + ':' + (e && e.currentRound) + ':' + (e && e.status)).join('|');
    const _prevMatchId = (tMyMatch && tMyMatch.matchId) || '';
    try {
      const r = await tApi('/event');
      if (r && typeof r.serverNow === 'number') tClockOffset = r.serverNow - Date.now();
      // ⭐⭐⭐v6.177 回應形狀不對（壞回應／代理回了 HTML／舊版伺服器）⇒ **整發不採納**：
      //   保留畫面上已顯示的賽事卡，也**不**刷新 _tEventOkAt —— 讓 tPollDesiredMs 判成
      //   「判斷不出來」而 fail-open 回正常頻率。舊寫法 `? r.events : []` 會把整個大廳清空。
      if (!r || !Array.isArray(r.events)) return;
      tEvents = r.events;
      tMe = r.me ?? { registered: false }; tIsAdmin = !!r.isAdmin; tMyMatch = r.myMatch ?? null; tMyBye = r.myBye ?? null;
      // ⭐v6.161 只有真的拿到回應才算「判斷得出來」（fail-open 的另一半見 tPollDesiredMs 的 lobby 分支）。
      _tEventOkAt = Date.now();
      const _sig = tEvents.map((e: any) => (e && e._id) + ':' + (e && e.currentRound) + ':' + (e && e.status)).join('|');
      const _matchId = (tMyMatch && tMyMatch.matchId) || '';
      if (_prevSig !== '' && (_sig !== _prevSig || _matchId !== _prevMatchId)) tLobbyResume();
      // v6.160：舊版伺服器沒有這個欄位 ⇒ 維持 '' ⇒ 不擋任何人（fail-open）。
      tMinClientVer = (typeof r.minClientVer === 'string') ? r.minClientVer : '';
      notifyScan(tEvents, tMyMatch, Date.now() + tClockOffset);   // v6.022 報到開始 / 可進場（僅背景時發）
      // 預填暱稱：用任一已報名賽事的暱稱
      if (!tNickname) {
        const mine = tEvents.find((e: any) => e.registered && e.myName);
        if (mine) tNickname = mine.myName;
        else if (tMe.registered && tMe.name) tNickname = tMe.name;
        else if (tMe.lastName) tNickname = tMe.lastName;  // v5.941 未報名任何賽事也預填「最近一次報名暱稱」(或帳號顯示名),免每次重打
      }
    } catch { /* ignore */ }
  }
  // 載入賽程表（admin seed 後才有 matches）
  // ⭐⭐⭐v6.177 根治「賽程/排名整區消失好幾秒」：
  //   舊寫法 `tBrackets = rs.filter(r => r && ...)` 是**清空型**的——任一支 /bracket 逾時/500，
  //   或伺服器在賽事查不到時回 `{event:null, matches:[]}`，那一場就被 filter 掉；
  //   `{#each tBrackets}` 一筆都不畫 ⇒ 整區憑空消失，而且要等下一次輪詢才回來
  //   （v6.161 之後：有本輪對戰 9 秒、出局/本輪打完 27 秒、背景分頁 63 秒）。
  //   改成逐 eventId 合併：成功的用新的、失敗的**沿用上一份好資料**並標 stale。
  async function tBracketLoad() {
    // v5.937 官方+社群賽並行:每個進行中賽事各抓一次 /bracket?eventId=(伺服器 per-eventId 3s 快取,N≤2,並發不序列)。
    try {
      const evs = tRunningEvents;
      // ⚠ 這裡的「空」只有在 /event 真的成功回了一份不含進行中賽事的清單時才算權威
      //   （v6.177 起 tournLoadEvent 對壞回應整發不採納 ⇒ tEvents 只會被成功回應改寫）。
      if (!evs || evs.length === 0) { tBrackets = []; tBracketsStale = false; return; }
      const _seq = ++_tBracketSeq;
      const rs = await Promise.all(evs.map((ev: any) => tApi('/bracket?eventId=' + encodeURIComponent(ev._id)).catch(() => null)));
      // ⭐v6.177 亂序守衛（比照 v6.139 deck-posts 的 listSeq）：tLobbyResume 會讓下一發提早送出，
      //   慢的那一發後到時，**合併版**會把舊回應當成權威新資料收編（比舊的 filter 版更難察覺）。
      if (_seq !== _tBracketSeq) return;
      const incoming = evs.map((ev: any, i: number) => {
        const r: any = rs[i];
        // 可信＝真的拿到這場賽事的賽程；否則一律 null（= 這一筆不可信，交給中央述詞沿用舊的）
        const ok = !!(r && r.event && Array.isArray(r.matches));
        return { key: String(ev && ev._id), value: ok ? r : null };
      });
      const merged = mergeKeyedOrKeep<any>(tBrackets, (b: any) => String(b && b.event && b.event._id), incoming);
      tBrackets = merged.list;
      tBracketsStale = merged.stale;
      if (!merged.stale && merged.list.length > 0) tBracketsEverOk = true;
      // ⭐⭐⭐v6.177 資料一過期就**立刻拉回正常頻率**（沿用 v6.161 既有的 tLobbyResume，不另寫一份）：
      //   否則出局/本輪打完的人要等 27 秒、背景分頁 63 秒才會重試，過期窗口被降頻放大。
      // ⚠⚠ 上限是「**每一段連續失敗期最多拉一次**」，不是每 N 秒拉一次：
      //   40 人賽事 /bracket 正在噴 500 時，「越失敗→越加速→越失敗」是正回饋，會把掙扎中的
      //   端點推倒（Fable 5 審查點名）。偶發單次失敗（玩家回報的症狀）仍然 ≤3 秒就補上，
      //   持續失敗則只加速這一次、60 秒寬限過後自動退回 v6.161 的降頻。
      // ⚠ 背景分頁不加速：那正是 v6.161 要省下來的人口，而且他看不到畫面。
      if (merged.stale) {
        if (_tBracketFailStreak === 0 && !_tTabHidden) tLobbyResume();
        _tBracketFailStreak++;
      } else {
        _tBracketFailStreak = 0;
      }
    } catch { /* ignore */ }
  }
  // 進入我本輪的對戰（伺服器建/取對戰房，鎖定的牌組）
  async function tEnterMatch() {
    tError = ''; tBusy = true;
    try {
      const r = await tApi('/match/enter', {}, { timeoutMs: 20000 });  // v6.135 失敗會踢回大廳 → 放寬
      if (r.error) { tError = r.error; return; }
      // ⚠⭐v6.180 換房間＝合法的版本重置（見 decideBoardAdopt 的 `first`）。
      tActiveRoom = r.roomId; tVersion = -1; mySeatIdx = r.seat; myPlayerIndex = r.seat as 0 | 1; mode = 'online'; tStep = 'waiting'; isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0;
      const sst = await tApi(`/state?room=${tActiveRoom}&v=-1`, undefined, { timeoutMs: 20000 });  // v6.135 同上
      if (sst && sst.names) tSyntheticRoom(sst.seats, sst.names);
      if (sst && sst.gameState) tAdopt(sst.gameState, sst.version);
      if (sst && typeof sst.lastActionAt === 'number') tLastActionAt = sst.lastActionAt;
      if (sst && typeof sst.idleForfeitMin === 'number') tIdleMin = sst.idleForfeitMin;
      if (sst && 'actorSeat' in sst) tServerActorSeat = (typeof sst.actorSeat === 'number' ? sst.actorSeat : null);   // v6.151 伺服器權威
      if (sst && typeof sst.longPoll === 'boolean') tLongPollReady = sst.longPoll;   // v6.152
      if (sst && typeof sst.serverNow === 'number') tClockOffset = sst.serverNow - Date.now();
      tNow = Date.now() + tClockOffset;
      startTournamentPoll();
    } catch (e: any) { tError = '進場失敗：' + (e?.message ?? e); tStep = 'lobby'; }
    finally { tBusy = false; }
  }
  // 對戰結束 → 返回賽事大廳（清本地對局、刷新賽程）
  function tLeaveMatch() {
    try { if (tPollTimer) { clearInterval(tPollTimer); tPollTimer = null; } } catch { /* ignore */ }
    // v6.151 跨場次殘留清乾淨：actorSeat 帶著上一場的值，會讓下一場在第一個輪詢回來之前
    //   用錯的方向算倒數；RTT 樣本混到上一場則會讓 slow-rtt 指紋掛在錯誤的場次上。
    tServerActorSeat = undefined; _rttSamples = []; _rttDiagSent = false;
    // ⭐v6.159 同一條「跨場殘留」紀律：新的四段/採納/重繪樣本混到上一場，
    //   會讓下一場的判讀掛在錯誤的場次上（longtask 是頁面級的，刻意不清）。
    _segTok = []; _segNet = []; _segDl = []; _segParse = []; _segTotal = [];
    // ⭐v6.213 同一條「跨場殘留」紀律：srv 樣本與取樣旗標都是 per-match 的。
    //   ⚠ 旗標不清會讓下一場沿用上一場的中籤結果（機率就不是 1% 了 ＝ 分母污染）。
    _segSrv = []; _srvHdrN = 0; _srvHdrMiss = 0;
    _perfSampleRoom = ''; _perfSampleArmed = false; _perfSampleSent = false;
    _coloCounts = {}; _coloLast = null; _coloMiss = 0;   // ⭐v6.227 colo 也是 per-match（殘留會把上一場的節點掛到下一場）
    // ⚠ _paintPending 也要放掉：離場瞬間若有在途 rAF，它會把上一場尾端那一筆推進下一場
    //   的新陣列（Fable 5 審查）。
    _adoptSamples = []; _paintSamples = []; _paintPending = false;
    _tResetResSeg();   // ⭐v6.179 同上：seg 是用來解釋每場清空的 `perf.api.net` 的，母體必須一致
    _setupDiagSent = false; _invisibleHandDiagSent = false;   // v6.155 診斷旗標同樣是每場一次，殘留會讓下一場漏報
    _staleDiagVersion = -1; _staleDiagWhy = null; _actionAuthDiagSent = false; _tActionAuthErr = false; _tActionAuthErrAt = 0;   // v6.158 同上
    tLongPollReady = false; _tLongPollAt = 0;   // v6.152
    tStillHereBusy = false; tStillHereNote = ''; _stalledDiagSent = false;   // v6.156（Fable 5 審查：跨場殘留）
    tPollGen++; // v5.586 使在路上的 in-flight poll 回應失效，避免返回大廳後被彈回對戰
    tActAbortAll('已離開對戰');   // ⭐v6.172 在途動作＋佇列一律作廢（否則舊手勢會打進下一場）
    game = null; tVersion = -1; tStep = 'lobby'; myPlayerIndex = null; mySeatIdx = -1; tActiveRoom = T_ROOM; isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0;
    tournLoadEvent(); tBracketLoad();
  }
  // 名人堂：載入歷屆冠軍
  async function tChampionsLoad() {
    // v6.177 同一條紀律：回應形狀不對 ⇒ 沿用上一份（名人堂只在進大廳抓一次，清空後不會自己回來）。
    try { const r = await tApi('/champions'); tChampions = adoptOrKeep<any[]>(tChampions, (r && Array.isArray(r.champions)) ? r.champions : null).data; }
    catch { /* ignore：保留畫面上那一份 */ }
  }
  // v5.691 排行榜 / 個人資料載入（後端聚合端點，掃 TARCHIVE）
  async function tLeaderboardLoad() {
    if (tLbLoading) return; tLbLoading = true;
    // v6.177 抓失敗不再把排行榜指回 null（會讓整塊變成「排行榜尚未開放」的假空狀態）。
    // v6.199 固定要上限那一份（伺服器沒帶 limit 仍是 5，舊 client 行為不變）；筆數切換在本地做。
    try { const _k = adoptOrKeep<any>(tLeaderboard, (await tApi('/leaderboard?limit=' + LB_TOP_MAX)) ?? null); tLeaderboard = _k.data; tLeaderboardStale = _k.stale; }
    catch { tLeaderboardStale = true; }
    finally { tLbLoading = false; }
  }
  async function tProfileLoad() {
    if (tProfileLoading) return; tProfileLoading = true;
    // v6.177 同上：抓失敗保留上一份個人資料，只標 stale。
    try { const _k = adoptOrKeep<any>(tProfile, (await tApi('/profile')) ?? null); tProfile = _k.data; tProfileStale = _k.stale; }
    catch { tProfileStale = true; }
    finally { tProfileLoading = false; }
  }
  function tSwitchTab(tab: 'events' | 'leaderboard' | 'profile') {
    tTab = tab;
    // v6.177 保留舊資料後，失敗不再把它清成 null ⇒ 重試條件要改看 stale，否則切回分頁不會重抓。
    if (tab === 'leaderboard' && (!tLeaderboard || tLeaderboardStale)) tLeaderboardLoad();
    if (tab === 'profile') {
      if (!tProfile || tProfileStale) tProfileLoad();   // v6.177 同上
      // v6.032 進分頁即刷新診斷：少了這行，notifyDiag 是 null → 'server-missing' 永遠偵測不到，
      //   徽章會顯示成「運作中」的假綠燈，而那正是最需要被看見的狀態。
      void refreshNotifyDiag();
    }
  }
  // v5.642 名人堂點選 → 載入該賽事「當初賽程」(歸檔 TARCHIVE)
  async function tHofOpen(c: any) {
    if (!c || !c.eventId) { tError = '此冠軍紀錄沒有可顯示的賽程'; return; }
    tHofLoading = true; tHofView = null; tHofPage = 1; tError = ''; tHofEventId = c.eventId || '';
    try {
      const r = await tApi(`/champion-bracket?eventId=${encodeURIComponent(c.eventId)}`);
      tHofView = (r && Array.isArray(r.matches)) ? r : null;
      tHofPage = 1;
    } catch (e: any) { tError = String(e?.message ?? e); }
    finally { tHofLoading = false; }
  }
  function tHofClose() { tHofView = null; }
  // v5.692 對戰戰報：點賽程某場 → 載入公開 log（已結束賽事，後端已剝私有訊息）
  async function tMatchLogOpen(round: number, idx: number, p1: string, p2: string) {
    if (!tHofEventId) return;
    tMatchLogTitle = (p1 ?? '?') + ' vs ' + (p2 ?? '?');
    tMatchLogLoading = true; tMatchLog = null;
    try {
      const r = await tApi(`/match-log?eventId=${encodeURIComponent(tHofEventId)}&round=${round}&idx=${idx}`);
      tMatchLog = (r && Array.isArray(r.log)) ? r : { log: [] };
    } catch (e: any) { tMatchLog = { log: [], error: (e && e.message) || '載入失敗' }; }
    finally { tMatchLogLoading = false; }
  }
  function tMatchLogClose() { tMatchLog = null; tMatchLogLoading = false; }
  // 觀戰：列出進行中的對戰
  async function tSpectateLoad() {
    // v6.177 同一條紀律（此函式自 v0.79 起未被呼叫，仍一併收斂避免日後接回來又踩同一個坑）。
    try { const r = await tApi('/spectate/list'); tSpectateList = adoptOrKeep<any[]>(tSpectateList, (r && Array.isArray(r.matches)) ? r.matches : null).data; }
    catch { /* ignore：保留畫面上那一份 */ }
  }
  // 觀戰：進入某場對戰（read-only，伺服器已 redact 雙方手牌；本端額外把手牌渲染成卡背）
  // ── v5.939 對戰回放 ──
  function tReplaySteps(): any[] {
    if (!tReplay) return [];
    const finalLogLen = (tReplay.finalLog || []).length;
    // v5.940 半回合逐步:每格帶 activePlayerIndex(先攻/後攻)+logLen(該格對戰 log 進度)
    const steps = (tReplay.snapshots || []).map((s: any) => ({
      turn: s.turn, activePlayerIndex: s.activePlayerIndex ?? null,
      logLen: (s.logLen == null ? null : s.logLen), state: s.state, isFinal: false,
    }));
    // 依 logLen 升冪=時序(同 turn 的先攻/後攻靠此正確排序);缺 logLen(舊資料)退回 turn
    steps.sort((a: any, b: any) => {
      const la = a.logLen == null ? (a.turn ?? 0) * 1e6 : a.logLen;
      const lb = b.logLen == null ? (b.turn ?? 0) * 1e6 : b.logLen;
      return la - lb;
    });
    if (tReplay.finalState) steps.push({
      turn: tReplay.meta?.finalTurn ?? (steps.length ? steps[steps.length - 1].turn : 1),
      activePlayerIndex: null, logLen: finalLogLen, state: tReplay.finalState, isFinal: true,
    });
    return steps;
  }
  function tReplayGoto(i: number) {
    const steps = tReplaySteps();
    if (!steps.length) return;
    const idx = Math.min(Math.max(0, i), steps.length - 1);
    tReplayStep = idx;
    const step = steps[idx];
    const st = JSON.parse(JSON.stringify(step.state));
    // v5.940 對戰 log 逐步顯示:用 logLen 切到「這一步為止」的 log(先攻/後攻各自進度);缺 logLen 退回 turn 過濾
    const fullLog = (tReplay.finalLog || []);
    if (step.isFinal) {
      st.log = fullLog.slice();
    } else if (step.logLen == null) {
      const upto = step.turn;
      st.log = fullLog.filter((e: any) => (e.turn ?? 0) < upto);  // v5.943 舊格快照=turn 開頭,log 切到上一 turn 結尾(原 <= 會多納整個 turn→log 超前盤面一整回合)
    } else {
      st.log = fullLog.slice(0, step.logLen);
    }
    // v5.942 視角=當前出牌方在底部(本機雙人語義):spectatorView='auto'→myIdx 跟 game.activePlayerIndex(state 一定有,新舊快照皆robust);不在此強制,讓玩家手動看P1/P2可持續override
    st.pendingSelection = null;  // v5.944 兜底:回放不開 picker(避免 turn-start 殘留 pendingSelection)
    coinFlipStage = 'done';
    game = st;
  }
  async function tStartReplay(matchId: string) {
    if (!matchId) return;
    tError = '';
    try {
      const res = await fetch(T_API + '/replay?matchId=' + encodeURIComponent(matchId));
      if (!res.ok) { tError = '回放載入失敗（' + res.status + '）'; return; }
      const data = await res.json();
      if (data.error) { tError = data.error; return; }
      if ((!data.snapshots || data.snapshots.length === 0) && !data.finalState) { tError = '這場沒有可回放的資料（可能是部署回放功能之前的舊對戰）'; return; }
      tReplay = data;
      // ⚠⚠v6.190 先把上一份盤面清掉再開回放旗標：isTReplay 一旦為 true，桌機獎賞縮圖就會
      //   翻正面（(_pz.faceUp || isTReplay)），而底下還有一個 await 才會把 game 換成回放快照。
      //   進入點同時歸零獎賞卡檢視視窗（離開回放有 7 條路徑，在進入點歸零才是單一來源）。
      game = null; prizeViewOpen = false;
      isTReplay = true; isTournSpectator = true; mySeatIdx = 2; myPlayerIndex = null; mode = 'online'; battleLogOpen = true; spectatorView = 'auto';  // v5.942 開log面板+視角自動跟當前出牌方(本機雙人;可手動看P1/P2 override)
      const steps = tReplaySteps();
      try { await Promise.all(steps.map((s: any) => ensurePoolForStateIds(s.state))); } catch { /* best-effort */ }
      tReplayGoto(0);
      tStep = 'playing';
    } catch (e: any) { tError = '回放載入失敗：' + (e?.message ?? e); }
  }
  function tExitReplay() {
    isTReplay = false; tReplay = null; tReplayStep = 0; game = null; isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0; mySeatIdx = -1; myPlayerIndex = null;
    try { const u = new URL(window.location.href); u.searchParams.delete('treplay'); history.replaceState(null, '', u.toString()); } catch { /* */ }
    tStep = 'lobby';
    try { tournLoadEvent(); tBracketLoad(); } catch { /* */ }
  }
  async function tCopyReplayLink(matchId: string) {
    try {
      const link = window.location.origin + base + '/game?treplay=' + encodeURIComponent(matchId);
      await navigator.clipboard.writeText(link);
      tError = '✅ 已複製回放連結,可分享給別人';
      setTimeout(() => { if (tError.startsWith('✅ 已複製回放連結')) tError = ''; }, 2500);
    } catch { tError = '複製失敗,請手動複製網址列'; }
  }
  async function tSpectate(roomId: string) {
    // v5.604 防呆：若這是「我自己參賽」的對戰 → 走進場(看自己手牌)而非觀戰(redact 手牌)。
    //   伺服器 /spectate/list v0.43 已排除自己的場，這裡再保險一層(防快取/stale 清單誤點)。
    if (tMyMatch && tMyMatch.roomId && tMyMatch.roomId === roomId) { return tEnterMatch(); }
    tError = ''; tBusy = true;
    try {
      // ⚠⭐v6.180 同 tEnterMatch：換房間是合法的版本重置，一定要歸 -1（見中央閘 `first`）。
      isTournSpectator = true; tSpectateRoom = roomId; tVersion = -1; mySeatIdx = 2; myPlayerIndex = null; mode = 'online'; tStep = 'waiting';
      const sst = await tApi(`/spectate/state?room=${roomId}&v=-1`);
      if (sst && sst.waiting && !sst.gameState) { tError = '這場對戰已結束或尚未開始，無法觀戰'; isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0; tSpectateRoom = ''; mySeatIdx = -1; tStep = 'lobby'; return; }  // v5.937 殘留/已結束房快速失敗,不卡 waiting
      if (sst && sst.names) tSyntheticRoom(sst.seats, sst.names);
      if (sst && sst.gameState) tAdopt(sst.gameState, sst.version);
      startSpectatePoll();
    } catch (e: any) { tError = '觀戰失敗：' + (e?.message ?? e); isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0; tStep = 'lobby'; }
    finally { tBusy = false; }
  }
  function startSpectatePoll() {
    if (tPollTimer) clearInterval(tPollTimer);
    const gen = ++tPollGen;
    let _spLastFetchAt = 0;   // v6.148 與主輪詢同一套節奏述詞
    let _spBusy = false;
    tPollTimer = setInterval(async () => {
      // ⚠ 同主輪詢：早退必須在 try 之外，否則 finally 會把在途那一發的旗標清掉。
      if (_spBusy) return;                       // v6.148 C4 防自我壅塞
      const _now = Date.now();
        // v6.146/148 對戰結束後畫面不會再更新（version 不再遞增），但原本仍每 2 秒下載一整份
        //   redact 過的 gameState。觀戰者常常看完就把分頁擱著 → 結束後降到 10 秒。
      if (_now - _spLastFetchAt < tPollDesiredMs(true)) return;
      _spLastFetchAt = _now;
      _spBusy = true;
      try {
        const reqV = tVersion;   // ⭐v6.180 同主輪詢：送出當下的版本（亂序守衛用）
        const r = await tApi(`/spectate/state?room=${tSpectateRoom}&v=${tVersion}`);
        if (gen !== tPollGen) return; // v5.586 已離開觀戰 → 丟棄在路上的回應
        if (r && r.names) tSyntheticRoom(r.seats, r.names);
        // ⭐v6.180 觀戰也走同一個中央閘（`/spectate/state` 的 version 與對戰同一個 doc.version）。
        //   觀戰者沒有 tForceResync／看門狗可以自救，萬一 tVersion 被污染就是永久停格
        //   ⇒ `client-ahead` 這條逃生口對觀戰者特別重要。
        if (r && typeof r.version === 'number' && r.version !== tVersion && r.gameState) tAdopt(r.gameState, r.version, { expectV: reqV, reason: 'spectate' });
      } catch { /* 忽略單次失敗 */ }
      finally { _spBusy = false; }
    }, 400);
  }
  function tLeaveSpectate() {
    try { if (tPollTimer) { clearInterval(tPollTimer); tPollTimer = null; } } catch { /* ignore */ }
    tPollGen++; // v5.586 使在路上的 in-flight poll 回應失效，避免返回大廳後被彈回對戰
    tActAbortAll('已離開觀戰');   // ⭐v6.172 同 tLeaveMatch（觀戰理論上沒有在途動作，但不留例外）
    _tResetResSeg();   // ⭐v6.179（Fable 5 審查）觀戰輪詢的殘留不可以揹到自己那一場的診斷裡
    game = null; tVersion = -1; tStep = 'lobby'; isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0; tSpectateRoom = ''; mySeatIdx = -1; myPlayerIndex = null;
    tournLoadEvent(); tBracketLoad();
  }
  async function tournEnroll(eventId: string) {
    const nick = (tNickname || '').trim();
    if (!nick) { tError = '請先填寫錦標賽暱稱'; return; }
    const deck = allDecks.find(d => d.id === tDeckId);
    if (!deck) { tError = '請先選擇牌組'; return; }
    const total = deck.entries.reduce((s: number, e: any) => s + (e.count || 0), 0);
    if (total !== 60) { tError = `所選牌組為 ${total} 張（需 60 張）`; return; }
    tError = ''; tBusy = true;
    try { const r = await tApi('/register', { eventId, name: nick, deckName: deck.name, deckEntries: deck.entries, coinPref: tCoinPref }); if (r.error) tError = r.error; else { saveCoinPref(eventId, tCoinPref); tRegFormEventId = ''; } await tournLoadEvent(); } // v5.724 存先後攻偏好供報名卡顯示
    catch (e: any) { tError = String(e?.message ?? e); } finally { tBusy = false; }
  }
  // ⭐⭐⭐v6.188 補報名＋直接報到（站長核准，網站賽與社群賽都開放）。
  //   報到階段才發現忘了報名的人，過去只看得到「未報名者無法參加」乾等下一場。
  //   ⚠ 前置驗證與 tournEnroll **逐條相同**（後端也是複用 /register 那一套），這裡只是換一支端點；
  //     任何一邊放寬條件都會讓另一邊變成假訊息，改動請兩邊一起改。
  async function tLateJoin(eventId: string) {
    const nick = (tNickname || '').trim();
    if (!nick) { tError = '請先填寫錦標賽暱稱'; tCheckinErrId = eventId; return; }
    const deck = allDecks.find(d => d.id === tDeckId);
    if (!deck) { tError = '請先選擇牌組'; tCheckinErrId = eventId; return; }
    const total = deck.entries.reduce((s: number, e: any) => s + (e.count || 0), 0);
    if (total !== 60) { tError = `所選牌組為 ${total} 張（需 60 張）`; tCheckinErrId = eventId; return; }
    tError = ''; tCheckinErrId = ''; tBusy = true;
    try {
      const r = await tApi('/register-and-checkin', { eventId, name: nick, deckName: deck.name, deckEntries: deck.entries, coinPref: tCoinPref, ver: VERSION });
      if (r?.error) { tError = r.error; tCheckinErrId = eventId; }
      else { saveCoinPref(eventId, tCoinPref); tRegFormEventId = ''; }
      await tournLoadEvent();
    } catch (e: any) { tError = '補報名失敗：' + String(e?.message ?? e); tCheckinErrId = eventId; }
    finally { tBusy = false; }
  }
  // ⭐⭐⭐v6.188 中途棄賽。⚠⚠ 這支**只開確認框、絕不送出**——棄賽不可逆，誤按沒有救。
  function tDropRequest(eventId: string) { tError = ''; tDropConfirmEventId = eventId; }
  // 確認框上的「確定棄賽」才會真的打 API。
  async function tDropCommit() {
    const eventId = tDropConfirmEventId;
    if (!eventId) return;
    tDropConfirmEventId = ''; tBusy = true; tError = '';
    try {
      const r = await tApi('/drop', { eventId });
      if (r?.error) tError = r.error;
      await tournLoadEvent(); tBracketLoad();
    } catch (e: any) { tError = '棄賽失敗：' + String(e?.message ?? e); }
    finally { tBusy = false; }
  }
  // v5.629 玩家發起社群賽
  async function tPropose() {
    const nick = (tNickname || '').trim();
    if (!nick) { tError = '請先填寫錦標賽暱稱'; return; }
    if (!tProposeName.trim()) { tError = '請填寫賽事名稱'; return; }
    const deck = allDecks.find(d => d.id === tDeckId);
    if (!deck) { tError = '請先選擇牌組'; return; }
    const total = deck.entries.reduce((sum: number, e: any) => sum + (e.count || 0), 0);
    if (total !== 60) { tError = `所選牌組為 ${total} 張（需 60 張）`; return; }
    tError = ''; tBusy = true;
    try {
      const r = await tApi('/propose', { format: tProposeFormat, rallyMin: tProposeRally, eventName: tProposeName.trim(), nickname: nick, deckName: deck.name, deckEntries: deck.entries, coinPref: tCoinPref });
      if (r?.error) tError = r.error; else { tProposeOpen = false; tProposeName = ''; await tournLoadEvent(); }
    } catch (e: any) { tError = '發起失敗：' + String(e?.message ?? e); } finally { tBusy = false; }
  }
  // v5.590 報到：報到階段按鈕，已報名者標記 checkedIn=true
  //
  // ⭐⭐⭐v6.160 報到前的版本閘。線上仍有停在 v6.141/v6.144 的 client（Service Worker 對
  //   `/tournament` 是 cache-first ⇒ 卡住舊 bundle ⇒ 拿不到任何修正，而且會拖累對手）。
  //   報到是最好的攔截點：比賽還沒開始，重載零代價。
  //
  // ⚠⚠⚠ 這裡的每一條規則都是為了「**絕不把玩家鎖在賽外**」而寫的，改動前請先讀完：
  //   ①**絕不自動重載**。重載後版本仍舊 ⇒ 無限重載迴圈 ⇒ 那位玩家永遠報不了到、打不了比賽。
  //     一律跳視窗、由玩家自己點。
  //   ②**更新過一輪仍太舊就不再擋**（fail-open）。訊號是 URL 上的 `_v=`（hardRefreshNow 加的），
  //     不是 sessionStorage —— Safari 無痕的 `setItem` 會 throw，逃生鈕會整條壞掉。
  //   ③**報到快截止時不擋**。按更新要重載＋重新登入，整輪十幾秒；剩不到 30 秒還把人推去重載，
  //     等他回來 `ev.status` 已經不是 checkin，後端回 409 ⇒ 我們親手害他報不了到。
  //   ④視窗上永遠有「先不更新，直接報到」的逃生口。可用性優先於版本一致性（站長裁定）。
  //   ⑤**同一場賽事最多只擋一次**（v6.167 補）。①~④ 全部都建立在「視窗真的顯示得出來」上，
  //     而 v6.160~v6.166 正是栽在這個前提：視窗放錯版面分支 ⇒ 五條 fail-open 一條都沒救到人。
  //     ⑤ 是唯一不依賴 UI 的那一條，也是守衛 test-v6167-checkin-never-locked.mjs 的核心不變式。
  function tCheckinBlockedByVersion(eventId: string): boolean {
    try {
      if (!isClientTooOld(VERSION, tMinClientVer)) return false;
      // ⑤**同一場賽事最多只擋一次**（v6.167）。這條與視窗顯示與否完全無關：
      //   就算提示視窗因為任何理由沒被畫出來（版面分支、CSS、未來重構…），
      //   玩家再按一次「我要報到」就一定會完成報到 ⇒ 最壞情況只是白按一次，不會被鎖住。
      if (_tVerPrompted.has(eventId)) return false;
      // ②更新過一輪還是舊的 ⇒ 放行，並記一筆診斷讓站長看得到「更新沒生效」這件事。
      const _href = (typeof window !== 'undefined' && window.location) ? window.location.href : '';
      if (recentlyHardRefreshed(_href, Date.now())) {
        tSendLobbyDiag('checkin-stale-after-update', eventId);
        return false;
      }
      // ③報到剩餘時間不足 ⇒ 放行（寧可讓他帶著舊版打，也不要害他錯過報到）。
      const _ev = tEvents.find((e: any) => e && e._id === eventId);
      // ⚠ 門檻 30 秒（v6.162 站長裁定，v6.160 原為 90 秒）：「更新不需要那麼久，30 秒綽綽有餘」。
      //   改這個數字時，scripts/test-v6160-checkin-version-gate.mjs 的 ⑩ 區塊（行為端）要一起改，
      //   admin.html 的兩處說明文字也要一起改（「90 秒」這個說法散在四處，grep 數字只找得到這一處）。
      const _left = (_ev && _ev.checkInDeadline) ? (_ev.checkInDeadline - tNow) : Infinity;
      if (_left < 30000) { tSendLobbyDiag('checkin-stale-deadline-near', eventId); return false; }
      return true;
    } catch { return false; }   // 判斷本身出任何錯 ⇒ 不擋（fail-open）
  }
  async function tCheckin(eventId: string) {
    // ⚠ 只在這裡開視窗、**不呼叫 API**；視窗的兩顆鈕才會走下面的 tCheckinCommit。
    if (tCheckinBlockedByVersion(eventId)) {
      tVerModalEventId = eventId;
      _tVerPrompted.add(eventId);   // v6.167：擋過一次就記下來，下一次按一定放行（見上面第 ⑤ 條）
      tSendLobbyDiag('checkin-update-prompted', eventId);
      return;
    }
    await tCheckinCommit(eventId);
  }
  async function tCheckinCommit(eventId: string) {
    tBusy = true; tError = ''; tCheckinErrId = '';
    try {
      // v6.160：帶上 client 版本供伺服器記錄（admin 報名名單看得到誰還停在舊版）。
      //   ⚠ 後端**永遠不會**因為這個欄位拒絕報到 —— 擋人的判斷只在 client，且處處 fail-open。
      const r = await tApi('/checkin', { eventId, ver: VERSION });
      if (r?.error) { tError = r.error; tCheckinErrId = eventId; }
      else { tournLoadEvent(); }
    } catch (e: any) { tError = '報到失敗：' + (e?.message ?? e); tCheckinErrId = eventId; }
    finally { tBusy = false; }
  }
  // 視窗：「🔄 更新並重新載入」。⚠ 不在這裡報到 —— 重載後版本就會是新的，玩家自己再按一次報到。
  //   若重載後版本**仍舊**，`recentlyHardRefreshed` 會讓下一次報到直接放行（fail-open ②）。
  async function tVerModalUpdate() {
    if (tVerModalBusy) return;
    tVerModalBusy = true;
    // ⚠⚠⚠ 最後一塊「絕不鎖人」的拼圖（Fable 5 審查抓到）：
    //   `hardRefreshNow()` 保證會**呼叫** location.replace，但不保證瀏覽器真的導航離開
    //   （PWA／異常狀態下 replace 可能回來了卻沒換頁 —— 正是 v5.909 那一族的親戚）。
    //   那種情況下 tVerModalBusy 會永遠是 true ⇒ **兩顆鈕都 disabled，連逃生口都按不動**。
    //   ⇒ 先掛一個 5 秒看門狗：真的離開頁面就無感，沒離開則逃生鈕自己復活。
    setTimeout(() => { tVerModalBusy = false; }, 5000);
    try { await hardRefreshNow(); }
    catch { tVerModalBusy = false; tVerModalEventId = ''; }   // 清快取炸了也不能卡住視窗
  }
  // 視窗：逃生口「先不更新，直接報到」。這條路徑不可以有任何會 throw 的前置動作。
  async function tVerModalSkip() {
    const _id = tVerModalEventId;
    tVerModalEventId = '';
    tSendLobbyDiag('checkin-update-skipped', _id);
    await tCheckinCommit(_id);
  }
  // ⭐v6.160 大廳診斷。⚠ 既有的 `_tSendClientDiag` 開頭就 `if (!tActiveRoom) return`，
  //   在大廳（還沒進對戰房）**送不出去** —— 報到階段正是沒有 tActiveRoom 的時候。
  //   所以這裡另寫一支輕量的，走同一支 `/clientdiag` 端點與既有指紋慣例。
  //   ⚠ 伺服器的 per-uid 60 秒節流是**不分 reason** 的：大廳這幾則會佔用配額。
  //     量很小（一位玩家一場賽事最多幾則），可接受。
  function tSendLobbyDiag(reason: string, eventId: string) {
    try {
      if (!isTournament) return;
      void tApi('/clientdiag', {
        reason, room: '', ts: Date.now(), ver: VERSION,
        lobby: { eventId, minVer: tMinClientVer, href: (typeof window !== 'undefined' && window.location ? String(window.location.href).slice(0, 120) : '') },
      }).catch(() => { /* fire-and-forget：診斷絕不影響報到 */ });
    } catch { /* 同上 */ }
  }
  async function tournUnregister(eventId: string) {
    if (!confirm('確定退賽？')) return;
    tBusy = true; tError = '';
    try { await tApi('/unregister', { eventId }); await tournLoadEvent(); } catch (e: any) { tError = String(e?.message ?? e); } finally { tBusy = false; }
  }
  // v5.635 發起者取消自己發起的社群賽（伺服器再 gate：本人/報名階段/未達門檻）
  async function tCancelProposal(eventId: string) {
    if (!confirm('確定要取消這場你發起的社群賽嗎？取消後所有已報名者都會解除報名。')) return;
    tBusy = true; tError = '';
    try { await tApi('/cancel-proposal', { eventId }); await tournLoadEvent(); } catch (e: any) { tError = String(e?.message ?? e); } finally { tBusy = false; }
  }
  function tEventStatusLabel(st: string): string {
    return ({ draft: '籌備中', registration: '報名中', checkin: '簽到中', bracket_ready: '賽程已公布', running: '進行中', finished: '已結束' } as any)[st] ?? st;
  }
  function tSyntheticRoom(seats: any, names: any) {
    // 餵戰板一個最小相容 Room（無聊天/觀戰/悔棋；不觸發任何線上後端）
    roomData = {
      roomId: T_ROOM, roomName: '\u{1F3C6} 錦標賽', status: 'playing',
      allowUndo: false, allowSpectate: false, isPrivate: true,
      hostName: (names && names[0]) || 'P1',
      seats: [
        { uid: (seats && seats[0]) || 't0', name: (names && names[0]) || 'P1', deckEntries: [], ready: true, firstChoicePreference: 'random' },
        { uid: (seats && seats[1]) || 't1', name: (names && names[1]) || 'P2', deckEntries: [], ready: true, firstChoicePreference: 'random' },
      ],
      spectators: [], createdAt: Date.now(), updatedAt: Date.now(),
    } as any;
  }
  // ⭐v6.180 亂序舊盤面被丟棄的診斷（走既有 /clientdiag，沿用既有指紋命名慣例）。
  //   ⚠ 不可以靜默：這條閘一旦誤擋，症狀是「畫面不更新」，比原 bug 更糟 ——
  //     一定要留下「丟了幾發、從哪條路徑來、版本差多少」才查得出來。
  let _staleAdoptDrops = 0;
  let _staleAdoptLast = '';
  let _staleAdoptDiagSent = false;
  // ⚠v6.180（Fable 5 審查）：在「`v=-1` 的救援/重新同步與主輪詢並行」的設計下，丟掉一發亂序舊盤面
  //   是**守衛正常工作**的訊號，不是異常 ⇒ 偶發 1~2 次不值得回報（會排擠真異常指紋）。
  //   累積到 3 次才送一發，而且**不佔每頁 3 發的配額**（見 _tSendClientDiag，v6.158 的教訓）。
  const STALE_ADOPT_DIAG_MIN = 3;
  function _tNoteStaleAdoptDrop(version: number, from: string): void {
    _staleAdoptDrops++;
    _staleAdoptLast = from + ':' + String(version) + '<' + String(tVersion);
    if (_staleAdoptDrops >= STALE_ADOPT_DIAG_MIN && !_staleAdoptDiagSent) {
      _staleAdoptDiagSent = true; _tSendClientDiag('stale-board-drop');
    }
  }
  function tAdopt(state: any, version: number, opts?: { skipSfx?: boolean; expectV?: number | null; reason?: string }) {
    // ⭐⭐⭐v6.180 **盤面採納的單一中央閘**（判準在 sync-guards.decideBoardAdopt，有單元＋行為守衛）。
    //   在此之前只有這個函式擋 stale，另外三條路徑（輪詢停擺救援／tForceResync／主輪詢的
    //   `version < tVersion` 分支）都刻意繞過版本檢查，而它們的請求與主輪詢**並行**
    //   ⇒ 舊回應晚到就把盤面指回上一版 ＝ 玩家看到的「一直跳回上一步」。現在四條全走這裡。
    //   ⚠ 合法的版本重置（換房／再來一局／client 真的超前）由該函式的 `first` / `client-ahead`
    //     放行 —— 這道閘**不可以**修成「畫面永遠不更新」。
    const _dec = decideBoardAdopt({ localVersion: tVersion, incomingVersion: version, expectVersion: opts?.expectV ?? null });
    if (_dec.kind === 'drop') { _tNoteStaleAdoptDrop(version, opts?.reason ?? 'adopt'); return; }
    const _adoptT0 = _pnow();   // ⭐v6.159 只量測，不改這個函式的任何行為
    // ⭐v6.048：錦標賽「對手的動作」只會經由這裡進來，而這裡原本完全沒有音效
    //   → 對手攻擊、擊倒我方寶可夢、施加狀態、拿獎賞全程無聲，連**我輸掉這一局**
    //   的勝負音都不會播（game-over 音只掛在本機 action 與休閒線上兩條路徑上）。
    //   自己的動作走 tournamentDispatch（它會自己算音效）→ 傳 skipSfx 避免播兩次。
    const _sfxPrev = game;
    // ⚠v6.180 `client-ahead` 是「伺服器把我拉回較舊的權威盤面」——拿倒退的 diff 去算音效
    //   會播出一串現實中沒有發生的事件（原本那條分支根本不播音效），一律靜音。
    if (!opts?.skipSfx && _dec.reason !== 'client-ahead' && _sfxPrev && state && (_sfxPrev as GameState).id === (state as GameState).id) {
      try {
        playSfxEvents(computeSfxEvents(_sfxPrev as GameState, state as GameState, null, pool,
          { mode, myPlayerIndex, aiPlayerIndex }));
      } catch { /* 音效不影響對戰 */ }
    }
    // ⭐⭐⭐v6.173 結構共享：伺服器每一發都是剛 JSON.parse 出來的全新物件，直接 `game = state`
    //   等於把每一個子物件都換成新的 Svelte proxy ⇒ 模板裡每一個 {@const} / derived 都被迫重算
    //   ⇒ 每 400~800ms 一次**全量重繪**（本機/休閒因為引擎是 immutable 更新才沒這問題）。
    //   shareStateIdentity 回傳一份與 state **逐位元組等價**、但沒變的子樹沿用舊物件的盤面。
    //   ⚠ 這是純效能改動：盤面內容不可以有任何差異（守衛用真自對局序列逐步比對 JSON）。
    //   ⚠ untrack：tAdopt 是網路回呼、正常不在 reaction 裡，但深讀 proxy 萬一落在某個 effect
    //     內就會訂閱整棵樹 → 一律包起來 fail-closed。
    const _sharePrev: unknown = game;
    game = (_sharePrev ? untrack(() => shareStateIdentity(_sharePrev, state)) : state) as GameState;
    // v5.921：錦標賽盤面由伺服器送來,client 只載過自己牌組的卡包→對手(或促銷卡集如 SV-P-H/SVPN)
    //   的卡 getCard 查不到→無法顯示/同名 fallback 錯版。依盤面實際 cardId 補載其卡包(缺卡才動作)。
    void ensurePoolForStateIds(state);
    if (typeof version === 'number') tVersion = version;
    if (state) tStep = 'playing';
    _tLastStateChangeAt = Date.now();  // v5.618 記錄盤面更新時間（新鮮度看門狗用）
    _freshWatchdogFires = 0;  // v5.933 真盤面更新 → 看門狗連續觸發計數歸零
    _tRecordAdopt(_adoptT0);   // ⭐v6.159 量測（必須是最後一行：要含整個函式的成本）
  }
  // v6.151 動作往返時間（RTT）取樣。伺服器端 P95 是 8ms，所以往返幾乎都是隧道排隊 + 網路，
  //   那正是 v6.134「第四輪很卡」一直缺的那份資料。⚠ 只記成功的往返：逾時是 12 秒，記進去會扭曲統計。
  // ⭐v6.159 統計工具收斂：rtt / 四段拆分 / tAdopt / 重繪代理 全部共用同一份 p50/p95/max
  //   與同一個 30 筆滾動窗 —— 各寫一套必然漂移，admin 端也就沒辦法用同一種讀法判讀。
  //   ⚠ 樣本原本就是整數毫秒（Date.now 差值），改用 performance.now 之後才會有小數，
  //     所以這裡統一 round：對既有 rtt 是 identity，行為不變。
  type _PStat = { n: number; p50: number; p95: number; max: number };
  function _sampleStats(src: number[]): _PStat | null {
    if (src.length === 0) return null;
    const a = [...src].sort((x, y) => x - y);
    const at = (q: number) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
    return { n: a.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(a[a.length - 1]) };
  }
  function _pushSample(arr: number[], ms: number): void {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return;
    arr.push(ms);
    if (arr.length > 30) arr.shift();   // 沿用 rtt 的 30 筆滾動窗
  }
  // ⚠ Date.now() 只有 1ms 解析度，而 getIdToken 命中快取時是 0.x ms ⇒ 全部會被記成 0，
  //   看不出「token 其實沒事」。performance.now() 不可用就退回 Date.now()（絕不 throw）。
  function _pnow(): number {
    try {
      return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
    } catch { return Date.now(); }
  }
  function _rttStats(): _PStat | null { return _sampleStats(_rttSamples); }
  // ⭐v6.170 冪等鍵。⚠⚠ 產生點必須在「一個使用者手勢」的入口（tournamentDispatch 開頭），
  //   **絕不可以**改成拿動作內容做 hash —— 連續兩次「附能量」是兩個各自合法的動作、payload
  //   可能一模一樣，用內容當鍵會把第二次誤判成重複而靜默吞掉（玩家看到「按了沒反應」）。
  function _newActId(): string {
    try {
      const c: any = (typeof crypto !== 'undefined') ? crypto : null;
      if (c && typeof c.randomUUID === 'function') return String(c.randomUUID());
      if (c && typeof c.getRandomValues === 'function') {
        const b = new Uint8Array(16); c.getRandomValues(b);
        let out = ''; for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
        return out;
      }
    } catch { /* 不支援就走下面的退路，絕不 throw */ }
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  // ⭐v6.179 seg 樣本的**唯一**歸零點（tLeaveMatch 與 tLeaveSpectate 共用一份，各寫一套必然漂移）。
  function _tResetResSeg(): void {
    _rtSegN = 0; _rtSegBad = 0; _rtSegAbort = 0; _rtSwN = 0; _rtSwOdd = 0; _rtLagNeg = 0;
    _rtQueueMs = []; _rtWireMs = []; _rtSwMs = []; _rtLagMs = []; _rtPreMs = []; _rtWins = [];
  }
  // ⭐⭐⭐v6.179 開一個 fetch 時間窗。
  //   ⚠⚠ 範圍守衛必須與 `_tRecordApiSegments` / `_tRecordResEntry` 逐字一致（只有對戰熱路徑、
  //     排除長輪詢）—— 窗與 entry 的母體不一致的話，「對不上」的比例會變成假訊號。
  function _tResWinOpen(path: string, t1: number): _RtWin | null {
    try {
      if (!isTournament || isTournSpectator) return null;
      if (path.indexOf('wait=1') >= 0) return null;
      if (!(path.indexOf('/action') === 0 || path.indexOf('/state') === 0)) return null;
      const w: _RtWin = { u: T_API + path, t1, t2: 0, used: false };
      _rtWins.push(w);
      // 上限 16：輪詢最快 1.2 秒一發、entry 幾毫秒內就回來，16 綽綽有餘。
      if (_rtWins.length > 16) _rtWins.splice(0, _rtWins.length - 16);
      return w;
    } catch { return null; }   // 量測絕不影響對戰
  }
  // ⭐v6.170 逐筆處理一個 PerformanceResourceTiming。**每一欄都 feature-detect，拿不到填 null**。
  function _tRecordResEntry(e: any): void {
    if (!e || typeof e.name !== 'string') return;
    // 範圍紀律與 v6.159 的 perf.api 完全一致：只看對戰熱路徑，且**排除長輪詢**
    //   （伺服器 by design 把它掛起 8~25 秒，記進來整份統計就變成假訊號）。
    if (e.name.indexOf('/api/tournament/') < 0) return;
    if (e.name.indexOf('/action') < 0 && e.name.indexOf('/state') < 0) return;
    if (e.name.indexOf('wait=1') >= 0) return;
    // ⭐⭐⭐v6.179（Fable 5 審查抓到，已自行查證）：`/spectate/state?…`（觀戰輪詢，2 秒一發）
    //   會通過上面那個 **substring** 的 `/state` 判斷，但開窗端用的是 **prefix**
    //   （`path.indexOf('/state') === 0`）⇒ 觀戰的每一發都必然對不上、無上限累積進 `seg.bad`。
    //   而 `tLeaveSpectate` 又不清計數器 ⇒ 先觀戰十分鐘再打自己那場的玩家，
    //   第一份診斷就揹著幾百的 bad，admin 會照我們自己寫的規則顯示「不可採信」——
    //   **假警報，正好打死這一版要的數字**。兩端母體必須一致：觀戰不是對戰熱路徑，直接排除。
    if (e.name.indexOf('/spectate/') >= 0) return;
    const req = Number(e.requestStart);
    // requestStart 為 0 ＝ 這筆的 timing 被瀏覽器閹割（跨源無 TAO／異常）⇒ 丟棄，不假裝量到。
    if (!(req > 0)) { _rtBad++; return; }
    _rtN++;
    const proto = (typeof e.nextHopProtocol === 'string' && e.nextHopProtocol) ? e.nextHopProtocol : '?';
    //  ⚠ Safari 對 nextHopProtocol 支援不一致（可能回空字串）⇒ 只當統計欄位，
    //    **絕不拿它當任何邏輯分支的判準**。
    _rtProto[proto] = (_rtProto[proto] || 0) + 1;
    if (Number(e.workerStart) > 0) _rtSw++;
    const conn = Number(e.connectEnd) - Number(e.connectStart);
    if (!isFinite(conn)) { _rtBad++; _rtN--; return; }
    // 規範行為：**連線重用時 connectStart === connectEnd**（DNS 兩欄同理）。
    //   用 1ms 當門檻而不是嚴格 ===：Safari 把時戳粗化到 ~1ms。而真的重建連線至少要一個
    //   往返（本站實測繞 Cloudflare 一圈 65ms），1ms 的門檻不可能把「重建」誤判成「重用」。
    if (conn >= 1) {
      _rtFresh++;
      _pushSample(_rtConnMs, conn);
      const dns = Number(e.domainLookupEnd) - Number(e.domainLookupStart);
      if (isFinite(dns) && dns >= 0) _pushSample(_rtDnsMs, dns);
      const sc = Number(e.secureConnectionStart);
      if (sc > 0) _pushSample(_rtTlsMs, Number(e.connectEnd) - sc);
    } else {
      _rtReuse++;
    }
    // ━━ ⭐⭐⭐v6.179 把這一發對回「是哪一次 fetch」，才能把 `perf.api.net` 拆開 ━━
    // ⚠ 對不上就**丟棄並記進 `seg.bad`**，絕不硬湊：硬湊出來的 queue/wire
    //   會直接把下一輪的判斷帶到錯的方向（這比「沒有數字」更壞）。
    const _fs = Number(e.fetchStart);
    const _st = Number(e.startTime);
    const _rs = Number(e.responseStart);
    // ⭐v6.179（Fable 5 審查）：逾時／abort 的失敗往返，較新的瀏覽器會給一筆
    //   `requestStart > 0` 但 `responseStart === 0` 的 entry。把它算進 `bad` 會讓
    //   **網路最爛的那群玩家**（正是我們在查的人）bad 天然偏高，而判讀規則教站長
    //   「bad 大＝不可採信」⇒ 自我否定。分流成獨立的 `abort`。
    if (_rs === 0) { _rtSegAbort++; return; }
    // 逐筆自我驗證：四個時戳必須單調遞增，否則這筆 timing 不可信（不是拿來硬算的）。
    if (!(_fs > 0) || !(_st >= 0) || !(_rs >= req) || !(req >= _fs) || !(_fs >= _st)) { _rtSegBad++; return; }
    let _w: _RtWin | null = null;
    let _bestD = Infinity;
    for (const cand of _rtWins) {
      if (cand.used || !(cand.t2 > 0)) continue;
      // 名稱：entry.name 是**絕對 URL**，fetch 用的是相對路徑 ⇒ 比字尾。
      if (!e.name.endsWith(cand.u)) continue;   // ⚠ 不用 slice：那是每個候選窗都配置一個字串
      // 時間窗：startTime 必須落在「呼叫 fetch」與「header 回來」之間。
      //   ±2ms 容忍時戳粗化（Safari 會把時戳粗化到 ~1ms）。
      if (_st < cand.t1 - 2 || _st > cand.t2 + 2) continue;
      const _d = Math.abs(_st - cand.t1);
      if (_d < _bestD) { _bestD = _d; _w = cand; }
    }
    if (!_w) { _rtSegBad++; return; }
    _w.used = true;   // 一對一：同一個窗不可以被兩筆 entry 認領
    _rtSegN++;
    _pushSample(_rtQueueMs, req - _fs);
    _pushSample(_rtWireMs, _rs - req);
    // ⚠⚠ SW 派送成本在 workerStart → fetchStart，**不在 queue 裡**（規範順序如此）。
    const _ws = Number(e.workerStart);
    if (_ws > 0) {
      _rtSwN++;
      const _swMs = _fs - _ws;
      if (_swMs > 0) _pushSample(_rtSwMs, _swMs); else _rtSwOdd++;
    }
    // ⭐v6.179（Fable 5 審查）：`startTime → workerStart`（沒有 SW 時是 → fetchStart）
    //   本來沒有任何一欄承接 ⇒ 五欄加起來對不上 `net`，站長一對帳就會困惑。
    //   這一段裝的是瀏覽器內部排程／SW registration 查找／redirect。補上之後
    //   **逐筆** pre + sw + queue + wire + lag 恰好等於 net（p50/p95 是各自的分位數，不必相等）。
    _pushSample(_rtPreMs, (_ws > 0 ? _ws : _fs) - _st);
    // 殘差：JS 量到的 net（t2 - t1）減掉瀏覽器自己的「fetch 開始 → 第一個位元組」。
    //   這一欄大 ⇒ `net` 是被 **await 續行排隊**灌水的，不是網路。
    //   ⚠ 微小負值是時戳粗化 ⇒ clamp 成 0（直接丟掉會讓整個分布系統性偏高）；
    //   明顯的負值（< -2ms）代表算式或時鐘有問題，記進 `lagNeg` 讓它**看得見**。
    const _lag = (_w.t2 - _w.t1) - (_rs - _st);
    if (_lag < -2) _rtLagNeg++;
    _pushSample(_rtLagMs, _lag > 0 ? _lag : 0);
  }
  // ⚠⚠ Resource Timing buffer 預設只有 250 筆，對戰頁每 1.2 秒一發，幾分鐘就滿 ——
  //   滿了之後 getEntriesByType 會**靜默不再收錄**，長對局後段會全空而被誤讀成「沒有壞樣本」。
  //   PerformanceObserver 不受那個 buffer 限制 ⇒ 一律走 observer，而且要在任何請求送出前掛上。
  function _tStartResTiming(): void {
    try {
      if (typeof PerformanceObserver !== 'function') return;
      const po: any = new PerformanceObserver((list: any) => {
        try {
          const es = list && typeof list.getEntries === 'function' ? list.getEntries() : [];
          for (const e of es) { try { _tRecordResEntry(e); } catch { /* 單筆壞掉不影響其他 */ } }
        } catch { /* 量測絕不影響對戰 */ }
      });
      // 舊瀏覽器只吃 entryTypes 陣列形式 ⇒ 兩種都試，都不行就當作不支援（統計回 null）。
      try { po.observe({ type: 'resource', buffered: false }); }
      catch { po.observe({ entryTypes: ['resource'] }); }
      _rtSupported = true;
    } catch { _rtSupported = false; }
  }
  // ⚠ 不支援時回 **null**（不是回 0）—— 0 會被判讀成「這台裝置從來沒重建過連線」，
  //   那正好是最會誤導站長的假訊號（與 v6.159 longtask 同一條紀律）。
  function _resTimingStats(): any {
    if (!_rtSupported) return null;
    if (_rtN === 0 && _rtBad === 0) return null;
    return {
      n: _rtN, bad: _rtBad, proto: _rtProto, sw: _rtSw,
      reuse: _rtReuse, fresh: _rtFresh,
      // 「這一發有沒有重新建連線」的比例（%）。分母 0 時回 null 而不是 0。
      freshPct: _rtN > 0 ? Math.round((_rtFresh / _rtN) * 100) : null,
      conn: _sampleStats(_rtConnMs), dns: _sampleStats(_rtDnsMs), tls: _sampleStats(_rtTlsMs),
      // ⭐⭐⭐v6.179 `net` 的拆分。⚠ 一筆都沒對齊到（也沒對錯）⇒ 回 **null**，
      //   絕不送一堆恆為 0 的欄位假裝有量到（與 longtask / freshPct 同一條紀律）。
      seg: (_rtSegN === 0 && _rtSegBad === 0 && _rtSegAbort === 0) ? null : {
        n: _rtSegN, bad: _rtSegBad, abort: _rtSegAbort,
        pre: _sampleStats(_rtPreMs),
        queue: _sampleStats(_rtQueueMs), wire: _sampleStats(_rtWireMs),
        sw: _sampleStats(_rtSwMs), swN: _rtSwN, swOdd: _rtSwOdd,
        lag: _sampleStats(_rtLagMs), lagNeg: _rtLagNeg,
      },
    };
  }
  // ⭐v6.159 四段拆分的記錄點。範圍守衛與 `_tRecordRtt` 完全一致（只記錦標賽對戰者），
  //   而且**刻意不新增任何觸發條件** —— 這一版只負責讓資料搭既有的
  //   slow-rtt / manual-sync 指紋順風車進到 `/clientdiag`，不製造新的回報噪音。
  function _tRecordApiSegments(path: string, t0: number, t1: number, t2: number, t3: number, t4: number): void {
    if (!isTournament || isTournSpectator) return;
    // ⚠⚠⚠ Fable 5 審查抓到的致命污染源：`tApi` 是**所有**錦標賽端點的共同入口，
    //   其中 `/state?…&wait=1` 是長輪詢（v6.152 灰度）——伺服器**刻意把請求掛起最多 25 秒**。
    //   把它記進來，`net` 的 p95 會 by design 變成 ~25000ms ⇒「網路欄大＝真的網路慢」
    //   直接變成假訊號，而下一場賽事正好可能開這個灰度實測。
    //   大廳端點（/chat /event /bracket /leaderboard…）也不是對戰熱路徑，混進來只會稀釋。
    //   ⇒ 只記對戰熱路徑：`/action` 與**短輪詢**的 `/state`。
    if (path.indexOf('wait=1') >= 0) return;
    if (!(path.indexOf('/action') === 0 || path.indexOf('/state') === 0)) return;
    _pushSample(_segTok, t1 - t0);
    _pushSample(_segNet, t2 - t1);
    _pushSample(_segDl, t3 - t2);
    _pushSample(_segParse, t4 - t3);
    _pushSample(_segTotal, t4 - t0);
  }
  // ⭐⭐⭐v6.213【③ 伺服器端處理時間】＋【② 低頻取樣】的記錄點。
  //   ⚠ 刻意**不**寫進 `_tRecordApiSegments` —— 那支是 v6.159 的量測函式、有既有的行為守衛
  //     在逐字驗它（scripts/test-v6159-…），塞新東西進去會讓那份契約失效。
  //   ⚠⚠ 範圍守衛的三行**必須與 `_tRecordApiSegments` 逐字相同**（srv 與 net 的母體要一致，
  //     否則 `net - srv` 這個減法沒有意義）。scripts/test-v6213-… 有一條守衛在比對這三行的文字，
  //     任何一邊被改動都會紅。
  function _tRecordSrvSample(path: string, srvMs: number | null): void {
    if (!isTournament || isTournSpectator) return;
    if (path.indexOf('wait=1') >= 0) return;
    if (!(path.indexOf('/action') === 0 || path.indexOf('/state') === 0)) return;
    // ⚠ 分母要分得出「舊伺服器沒帶這個標頭」與「帶了但是 0 ms」：
    //   前者是**不知道**、後者是**真的很快**，混在一起看就會把「還沒部署」讀成「伺服器很快」。
    if (typeof srvMs === 'number' && isFinite(srvMs) && srvMs >= 0) { _srvHdrN++; _pushSample(_segSrv, srvMs); }
    else _srvHdrMiss++;
    // ⭐【②】低頻無條件取樣。骰子**每場只擲一次**：以房號當鍵，房號一變才重擲。
    //   ⚠⚠ 這一行是整個機率的定義。若改成「每發都擲」，實際機率就完全不是 1%
    //     而且送出來的資料看起來一模一樣、沒有人會發現（分母污染）。
    //   ⚠ 刻意寫在這裡而不是 tEnterMatch：擲骰與取樣的條件（只算對戰熱路徑）在同一個地方，
    //     不會有「某一條進場路徑忘了擲」的漏接；房號一變就是新的一場，語義由 tActiveRoom 定義。
    //   ⚠ 已知且可接受的偏差：同一場中途重新整理頁面會再擲一次
    //     ⇒ 每場的期望值是 1% ×（1 + 重整次數）。重整很罕見，且那本來也算「新的一次連線」。
    if (_perfSampleRoom !== tActiveRoom) {
      _perfSampleRoom = tActiveRoom;
      _perfSampleArmed = Math.random() < PERF_SAMPLE_RATE;
      _perfSampleSent = false;
    }
    // ⚠ 這裡只有兩個布林比較與一個長度比較；沒中籤的人成本是**一次 `if` 就 return**。
    _tMaybePerfSample();
  }
  // ⭐⭐⭐v6.227 colo 的記錄點。
  //   ⚠ 範圍守衛的三行**必須與 `_tRecordApiSegments`／`_tRecordSrvSample` 逐字相同**
  //     （colo 的母體要與 net/srv 一致，「這個 colo 的 net」這句話才有意義）。
  //   ⚠ 相異 colo 鍵數上限 8：一場對局實際只會看到 1~2 個，上限只是防禦——
  //     超過就不再新增鍵（既有鍵照數），絕不讓 payload 被灌爆。
  function _tRecordColoSample(path: string, colo: string | null): void {
    if (!isTournament || isTournSpectator) return;
    if (path.indexOf('wait=1') >= 0) return;
    if (!(path.indexOf('/action') === 0 || path.indexOf('/state') === 0)) return;
    if (colo) {
      _coloLast = colo;
      if (Object.prototype.hasOwnProperty.call(_coloCounts, colo)) _coloCounts[colo]++;
      else if (Object.keys(_coloCounts).length < 8) _coloCounts[colo] = 1;
    } else { _coloMiss++; }
  }
  /** ⭐v6.213【②】每場最多送一發的健康對照樣本。⚠ 這支自己不擲骰（骰子在進場時擲好） */
  function _tMaybePerfSample(): void {
    if (!_perfSampleArmed || _perfSampleSent) return;
    if (_segTotal.length < PERF_SAMPLE_MIN_CALLS) return;
    _perfSampleSent = true;
    _tSendClientDiag('perf-sample');
  }
  // ⭐v6.159 盤面採納耗時。Fable 5 的診斷假說：`game = state` 每次都指到一棵**全新的 JSON 樹**，
  //   物件同一性整批換掉 ⇒ Svelte 無法細粒度更新 ⇒ 每次版本變動＝整個盤面全量重繪。
  //   本機對戰因為引擎有結構共享沒這問題，**只有錦標賽路徑缺這優勢**。
  //   ⚠ 本版**不做任何修正**，只把兩個數字量出來讓下一場賽事的數據自己說話：
  //     adopt = tAdopt 自己的同步執行時間；
  //     paint = tAdopt 開始 → 下一個 animation frame（Svelte flush + 樣式/版面/繪製排隊之後的間隔）。
  function _tRecordAdopt(t0: number): void {
    if (!isTournament || isTournSpectator) return;
    _pushSample(_adoptSamples, _pnow() - t0);
    // 同時只掛一個 rAF：量測不可以自己製造負擔。
    if (_paintPending) return;
    if (typeof requestAnimationFrame !== 'function') return;
    // ⚠ 背景頁籤的 rAF 根本不會 fire ⇒ 不在可見狀態就不排（否則切回前景時會一次收到一筆
    //   幾十秒的假樣本，而那是「頁籤被切走」不是「重繪很慢」）。
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const _seq = _visSeq;
    _paintPending = true;
    try {
      requestAnimationFrame(() => {
        _paintPending = false;
        if (_seq !== _visSeq) return;   // 期間切過背景 ⇒ 這筆不是重繪成本，丟棄
        _pushSample(_paintSamples, _pnow() - t0);
      });
    } catch { _paintPending = false; }
  }
  // ⭐v6.159 longtask 統計（最近 N 秒內的數量／總時長／最長一筆）。
  //   ⚠⚠ Safari/iOS 不支援 ⇒ `_ltSupported` 為 false 時回 **null**，不是回 0 ——
  //     0 會被判讀成「這台裝置主執行緒很順」，那正好是最會誤導人的假訊號。
  function _longTaskStats(winMs = 60000): { win: number; n: number; total: number; max: number } | null {
    if (!_ltSupported) return null;
    const cut = Date.now() - winMs;
    let n = 0, total = 0, max = 0;
    for (const e of _ltSamples) {
      if (!e || e.t < cut) continue;
      n++; total += e.d; if (e.d > max) max = e.d;
    }
    return { win: Math.round(winMs / 1000), n, total: Math.round(total), max: Math.round(max) };
  }
  function _tRecordRtt(ms: number): void {
    if (!isTournament || isTournSpectator || !(ms >= 0)) return;
    _rttSamples.push(ms);
    if (_rttSamples.length > 30) _rttSamples.shift();
    if (_rttDiagSent || _rttSamples.length < 10) return;
    const st = _rttStats();
    // 門檻 3 秒：正常是幾十毫秒，會踩到這條的一定是真的在排隊。只回報一次。
    if (st && st.p95 >= 3000) { _rttDiagSent = true; _tSendClientDiag('slow-rtt'); }
  }
  // v5.933 客戶端診斷回傳(setup/同步異常定根因/確認用)——只在真異常指紋才送,fire-and-forget,絕不阻塞/影響對戰。
  // ⭐⭐⭐v6.171 診斷：Svelte 5 runtime warning 收集器（本版**只加量測，不做任何行為修正**）。
  //   事故：2026-08-11 正式站 /tournament，Console 出現 `284 https://svelte.dev/e/derived_inert`。
  //   正式 build 的 svelte warning 只會印一行網址（warnings.js 的 non-DEV 分支），
  //   站長看得到「284 次」卻看不出是哪一段程式 ⇒ 這裡把次數與前幾筆 stack 收下來，
  //   併進既有的 /clientdiag 管線（不另開管線，比照 v6.170 的 Resource Timing）。
  //   ⚠ 只收集：不改 console 的輸出、不吞任何一則、一律 call through 原函式。
  //   ⚠ 全包 try/catch，且**這段自己絕不可以再呼叫 console.warn**（會遞迴）。
  //   ⚠ 只認純字串參數：把 $state proxy 丟進 console 會觸發 svelte 自己的 console_log_state。
  //   ⚠⚠⚠ v6.179 修掉一個**假零**（v6.171 埋的）：hook 用 `window.__ptcgSvelteWarnHook` 防重裝，
  //     但計數器 `_svelteWarnCounts` / `_svelteWarnFirst` / `_lastPointerAt` 是**元件實例變數**。
  //     /game 重新掛載後，被包裝過的 `console.warn` 仍然閉包在**舊實例**那三個容器上，
  //     新實例讀到的永遠是初值 ⇒ `/clientdiag` 回報的 `svelteWarn.counts` 恆為 `{}`、
  //     `first` 恆為空、`+NNNms` 恆為 -1 —— 看起來像「這一場完全沒有 warning」，
  //     而那正是最會誤導人的假訊號（與 longtask 回 0 同一類錯誤）。
  //     ⇒ 計數器搬到 window 層級，與 hook 同一個生命週期；同一個容器物件被兩邊共用。
  const _svelteWarn: { counts: Record<string, number>; first: string[]; lastPointerAt: number } = (() => {
    const _w = (typeof window !== 'undefined') ? (window as any) : null;
    // SSR／非瀏覽器：不需要跨實例共享，回一個本地容器就好（絕不 throw）。
    if (!_w) return { counts: {}, first: [], lastPointerAt: 0 };
    if (!_w.__ptcgSvelteWarn || typeof _w.__ptcgSvelteWarn !== 'object') {
      _w.__ptcgSvelteWarn = { counts: {}, first: [], lastPointerAt: 0 };
    }
    return _w.__ptcgSvelteWarn;
  })();
  if (typeof window !== 'undefined' && !(window as { __ptcgSvelteWarnHook?: boolean }).__ptcgSvelteWarnHook) {
    (window as { __ptcgSvelteWarnHook?: boolean }).__ptcgSvelteWarnHook = true;
    try {
      // ⭐ 判別「互動觸發」vs「背景 burst」：warn 當下距離上一次 pointer 事件多久。
      //   殭屍 interval／輪詢續行讀到已銷毀元件的 derived ⇒ 這個值會很大且規律。
      window.addEventListener('pointerdown', () => { _svelteWarn.lastPointerAt = Date.now(); }, { capture: true, passive: true });
    } catch { /* 診斷絕不影響對戰 */ }
    const _origWarn = console.warn.bind(console);
    console.warn = function (...args: unknown[]) {
      try {
        const joined = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
        const hit = /svelte\.dev\/e\/([a-z_]+)/.exec(joined);
        if (hit) {
          const code = hit[1];
          _svelteWarn.counts[code] = (_svelteWarn.counts[code] ?? 0) + 1;
          if (_svelteWarn.first.length < 3) {
            const st = String(new Error().stack ?? '').split('\n').slice(2, 8).join(' <= ');
            _svelteWarn.first.push(code + ' +' + (_svelteWarn.lastPointerAt ? Date.now() - _svelteWarn.lastPointerAt : -1) + 'ms @ ' + st.slice(0, 700));
          }
        }
      } catch { /* 診斷絕不影響對戰 */ }
      return _origWarn(...(args as []));
    };
  }
  // ⭐⭐v6.171 假說驗證用：畫面上還掛著幾個 inert 節點。
  //   Svelte 的 pause_effect 要等所有 outro callback 回來才 destroy_effect；
  //   若某個 outro 的 onfinish 沒回來，那個分支會**永久 INERT 但 DOM 還在**
  //   ⇒ 畫面凍結 ＋ 該區塊點不到 ＋ 裡面的 derived 一直被判 inert。
  //   這一欄若持續 > 0，就是那個假說的直接證據。
  function _inertNodeCount(): number {
    try { return document.querySelectorAll('[inert]').length; } catch { return -1; }
  }
  /**
   * ⭐⭐⭐v6.198 `stale-version` 要不要送 —— 把「當下的狀態」餵進中央述詞。
   * ⚠ 每一欄都與診斷 payload 裡同名欄位**逐字同一個算式**（含 `? ... : -1` 的缺值寫法），
   *   站長拿 dump 回放才會得到與線上完全相同的答案（scripts/test-v6198-… 就是這樣驗的）。
   */
  function _staleVersionWhyNow(): string | null {
    const now = Date.now();
    return staleVersionDiagWhy({
      vis: (typeof document !== 'undefined' ? document.visibilityState : null),
      sincePollOk: _tLastPollOkAt ? now - _tLastPollOkAt : -1,
      sinceStateChange: _tLastStateChangeAt ? now - _tLastStateChangeAt : -1,
      sinceLastAction: tLastActionAt ? now - tLastActionAt : -1,
      srvActor: (tServerActorSeat === undefined ? null : tServerActorSeat),
      localActor: (() => { try { return tCurrentActorSeat(game); } catch { return null; } })(),
    });
  }
  function _tSendClientDiag(reason: string) {
    try {
      const now0 = Date.now();
      if (!isTournament || isTournSpectator || !tActiveRoom) return;
      // ⭐⭐v6.155（Fable 5 審查）：`manual-sync` 不佔每頁 3 發的配額，且自帶 60 秒節流。
      //   兩條真實的漏報路徑：
      //   ①玩家覺得卡的時候最愛按「等待對手 🔄」，三下就把配額用光 ⇒ 之後**所有**指紋全靜音；
      //   ②伺服器的 per-uid 60 秒節流**不分 reason** ⇒ 剛按過手動同步，緊接著觸發的
      //     `setup-watchdog-repeat` 會被 throttle 丟掉，而 client 已把 `_setupDiagSent` 設 true
      //     不會重送 ⇒ **真訊號被 manual-sync 吃掉**。
      //   manual-sync 本來就「不一定是 bug」，不該排擠真異常指紋。
      const _isManual = reason === 'manual-sync';
      // ⭐v6.180 `stale-board-drop` 同理不佔配額：它每場最多送 1 發、且門檻是「亂序累積 3 次」，
      //   本來就稀少；佔掉 1/3 配額卻可能害真異常指紋（invisible-hand／stale-version）靜音。
      // ⭐v6.213 'perf-sample'（低頻無條件取樣）同樣不佔配額：它每場最多 1 發、而且**與異常無關**，
      //   若讓它扣掉 1/3 的配額，等於用對照組把真異常指紋擠靜音 —— 那比沒有對照組更糟。
      const _isExempt = _isManual || reason === 'stale-board-drop' || reason === 'perf-sample';
      if (_isManual) {
        if (now0 - _lastManualDiagAt < 60000) return;
        _lastManualDiagAt = now0;
      } else {
        // ⚠ 豁免的指紋不扣配額（理由同 manual-sync），但仍受各自的「每場一次」旗標拘束。
        if (!_isExempt) {
          if (_diagSentCount >= 3) return;
          _diagSentCount++;
        }
      }
      const g: any = game;
      let visHand = -1, arrivingDom = -1;
      try { visHand = _countVisibleHandCards(); } catch { /* */ }
      // ⚠ v6.155：手機直式的手牌**沒有** arriving class（整套 arrivingIids 只接在桌機 hand-card），
      //   所以 `.mp-hand-card.arriving` 是死查詢、手機端這個值恆為 0。
      //   判讀手機的 payload 請看 `render.arrivingSize`（那是 state 不是 DOM），別把 0 讀成「沒有殘留」。
      try { arrivingDom = document.querySelectorAll('.hand-strip .hand-card.arriving, .mp-hand-card.arriving').length; } catch { /* */ }
      const now = Date.now();
      const payload = {
        reason, room: tActiveRoom, ts: now, ver: VERSION,
        // ⭐⭐⭐v6.227 這場落在哪個 Cloudflare 邊緣節點（見 _tRecordColoSample）。判讀：
        //   ・seen ＝這場（對戰熱路徑的成功往返）看過的 colo 與各自次數；last ＝最近一發。
        //   ・miss ＝成功往返但回應沒有 cf-ray（SW 快取、不經 CF 的路徑）。
        //   ・null ＝一發熱路徑往返都還沒有。⚠ v6.227 之前的舊 client 根本沒這一欄——
        //     欄位缺席＝「不知道」，讀的人不可以當成 0 或當成某個 colo。
        //   ⚠ 刻意放在 payload 前段：8192 截斷砍的是尾端，而 colo 正是「慢的人集不集中在
        //     特定節點」這個問題的關鍵欄位，不能排在 svelteWarn/env 之後陪葬。
        colo: (_coloLast || _coloMiss > 0) ? { last: _coloLast, seen: { ..._coloCounts }, miss: _coloMiss } : null,
        state: {
          tVersion, gameId: g?.id ?? null, phase: g?.phase ?? null, setupDone: g?.setupDone ?? null,
          pendingMulliganDraw: g?.pendingMulliganDraw ?? null, mulliganRevealConfirmed: g?.mulliganRevealConfirmed ?? null,
          mulliganPostBenchOpen: g?.mulliganPostBenchOpen ?? null,
          actorSeat: (() => { try { return tCurrentActorSeat(g); } catch { return null; } })(), mySeatIdx,
          // v6.155：null = 我這邊都做完了（在等對手）；有值 = 我還有這件事沒做。
          //   舊版診斷分不出這兩種，是誤報淹沒真訊號的主因。
          selfPending: (() => { try { return _setupSelfPending(g, mySeatIdx); } catch { return null; } })(),
        },
        render: {
          coinFlipStage, arrivingSize: arrivingIids.size, drawAnims: drawAnims.length,
          handLen: (g?.players?.[mySeatIdx]?.hand?.length ?? -1), visHand, arrivingDom,
        },
        poll: {
          sincePollOk: _tLastPollOkAt ? now - _tLastPollOkAt : -1, sinceStateChange: _tLastStateChangeAt ? now - _tLastStateChangeAt : -1,
          sinceForceResync: _tLastForceResyncAt ? now - _tLastForceResyncAt : -1, pollGen: tPollGen, watchdogFires: _freshWatchdogFires,
          // ⭐v6.180 亂序舊盤面被中央閘丟掉的次數與最後一筆（`來源:收到的版本<當時的本地版本`）。
          //   ⚠ 判讀：`n` 大 ＝ 這台裝置真的在亂序（原本這些都會讓畫面倒退一步）；
          //     若同時有人回報「畫面不更新」而這一欄很大，才要回頭懷疑閘擋錯了。
          staleAdopt: _staleAdoptDrops, staleAdoptLast: _staleAdoptLast || null,
          // v6.151：伺服器端指標一直是全綠的，但那不含隧道排隊與網路往返（v6.134 的教訓）。
          //   這裡回報 client 實測的動作往返時間，才對得上玩家說的「很卡」。
          rtt: _rttStats(),
          // ⭐v6.158：光看「版本沒前進」分不出「對手在長考」與「真的卡住」。
          //   srvActor = 伺服器權威的該動作座位（不是 client 自己推算的）；
          //   sinceLastAction = 伺服器上【真的有人動作】到現在過了多久。
          srvActor: (tServerActorSeat === undefined ? 'n/a' : tServerActorSeat),
          sinceLastAction: tLastActionAt ? now - tLastActionAt : -1,
          longPoll: tLongPollReady,
          // ⭐⭐⭐v6.198 這筆 stale-version 是**哪一條**判準送出來的（見 $lib/tournament/stale-diag）。
          //   ⚠ 判讀：這一欄**缺席**只代表「那是 v6.197 以前的 bundle 用舊判準送的」，
          //     絕不可以讀成「新判準沒有理由」。其他 reason 一律是 null（欄位在、值為空）。
          staleWhy: (reason === 'stale-version' ? _staleDiagWhy : null),
          // ⭐⭐⭐v6.198 伺服器說「對手已經幾秒沒有向伺服器要盤面」（0 ＝對手正常在輪詢）。
          //   ⚠⚠ **誠實標示這一欄的極限**：它是**順帶**的判讀欄，不是「對手掉線指紋」。
          //     「我正常、對手斷線」這個情境下判準三條都不成立（盤面與伺服器 lastActionAt
          //     一起停在對手最後一步）⇒ **不會有任何回報被送出**，這一欄自然也看不到。
          //     它真正的用途是：**任何一筆送出來的回報**都能一眼看出「其實是對面掉線」，
          //     不必再靠「在線那一方也跟著報 stale-version」去反推（那正是鏡像重複的來源）。
          //     要系統性地統計對手掉線，得另開指紋或在伺服器端統計（本版刻意不做）。
          //   ⚠ 舊 client 沒有這一欄；欄位缺席＝不知道，**不是** 0（對手正常）。
          oppQuiet: tOppQuietSec,
        },
        // ⭐⭐⭐v6.159 「網路慢」vs「主執行緒慢」的判別資料（本版只量測，不做任何修正）。
        //   判讀規則（寫給站長，admin 監控分頁上也有同一段）：
        //     ・`api.net`（到 header）或 `api.dl`（body 下載）大 ⇒ 真的是**網路／隧道**。
        //     ・這兩者小、但 `api.parse` / `api.total` / `adopt` / `paint` / `lt` 大
        //       ⇒ 瓶頸在**那台裝置的主執行緒**，再修伺服器不會有任何效果。
        //     ・`lt` 為 null ＝ 這台裝置（Safari/iOS）不支援 longtask，**不是**「沒有長任務」。
        //     ⚠ 每個切點都是 await 續行 ⇒ 主執行緒被長任務佔住時 `net`／`dl` 也會被灌水，
        //       所以「網路欄大」要**同時看 `lt`／`paint`** 才能定案（單看一欄會誤判）。
        //     ⚠ `api.*` 涵蓋「動作 ＋ 短輪詢」；`poll.rtt` 只涵蓋動作 —— 兩者不可直接相減。
        perf: {
          api: { tok: _sampleStats(_segTok), net: _sampleStats(_segNet), dl: _sampleStats(_segDl), parse: _sampleStats(_segParse), total: _sampleStats(_segTotal) },
          adopt: _sampleStats(_adoptSamples), paint: _sampleStats(_paintSamples),
          lt: _longTaskStats(),
          // ⭐⭐⭐v6.213【③】伺服器自報的 per-request 處理時間（回應標頭 X-Srv-Ms）。判讀：
          //   ・`srv` 小而 `api.net` 大 ⇒ Node 早就處理完了，時間全花在 **CF／隧道／線路**。
          //   ・`srv` 也大 ⇒ 這次是**伺服器自己**慢（DB 查詢／序列化），修伺服器才有意義。
          //   ⚠ `srv` 為 null ＝一筆都沒收到這個標頭。看 `srvHdr`：
          //     `{n:0, miss:N}` ＝伺服器還沒部署 v6.213（**不是**「伺服器很快」）；
          //     n 與 miss 同時 >0 ＝部署中／有舊 instance。
          //   ⚠ 涵蓋範圍與 `api.*` 完全相同（動作＋短輪詢，排除 wait=1 長輪詢），可以直接相減。
          srv: _sampleStats(_segSrv), srvHdr: { n: _srvHdrN, miss: _srvHdrMiss },
          // ⭐⭐⭐v6.170 連線層細節（PerformanceResourceTiming）。判讀規則：
          //   ・`res.freshPct` 高 ⇒ 這台裝置一直在**重新建連線**（無線斷訊／NAT 逾時的指紋），
          //     而每次重建都要付 DNS+TCP+TLS 一整套往返 —— 這是「間歇性斷流」最直接的證據。
          //   ・`res.proto` 看得到 h2/h3 佔比：壞樣本全是 h2 ⇒ 那些人的網路擋 UDP，h3 幫不了他們。
          //   ・`res.n` 為 0 但 `res.bad` 大 ⇒ timing 被閹割（不該發生，本站同源），要回頭查。
          //   ・整個 `res` 為 null ＝ 這台裝置不支援 PerformanceObserver，**不是**「連線都很好」。
          //   ⭐⭐⭐v6.179 `res.seg` 把 `api.net`（送出 → 第一個位元組）再拆開，判讀規則：
          //   ・`seg.queue` 大（requestStart - fetchStart）⇒ 卡在**送出去之前**：
          //     DNS／TCP／TLS／瀏覽器連線排隊。配 `res.freshPct` 看是不是一直在重建連線。
          //   ・`seg.wire` 大（responseStart - requestStart）⇒ 卡在**真正的往返**：
          //     Cloudflare／隧道／VM。伺服器端指標全綠時，剩下的就是 CF 到 VM 那一段。
          //   ・`seg.sw` 大（fetchStart - workerStart）⇒ **Service Worker 派送成本**。
          //     ⚠ 這一段**不在** queue 裡（規範上 workerStart 早於 fetchStart）。
          //     Android 冷啟動 SW 執行緒可達數百 ms，而 service-worker.ts 對 `/api/` 雖然是
          //     early-return 放行，那一次派送成本仍然要付，且 `perf.api.net` 是用
          //     performance.now() 包在 fetch 前後量的 ⇒ **包含這一段**。
          //   ・`seg.lag` 大 ⇒ `net` 是被 **await 續行排隊**灌水的（主執行緒忙），不是網路。
          //   ・`seg.pre`（startTime → workerStart／fetchStart）＝瀏覽器內部排程／SW 查找／redirect。
          //     逐筆 `pre + sw + queue + wire + lag = net`，所以五欄可以拿來對帳。
          //   ・`seg.abort` ＝逾時／abort 的失敗往返（**不是**對齊失敗）。網路爛的人這欄天然會大。
          //   ・`seg.bad` 大 ⇒ 對齊失敗的比例高，queue/wire 這幾欄**不可採信**（要回頭查）。
          //   ・`seg.lagNeg` > 0 ⇒ 殘差算出明顯負值，代表算式或時鐘有問題，要回頭查（正常恆為 0）。
          //   ・`seg` 為 null ＝ 這台裝置一筆都沒對齊到，**不是**「每一段都是 0」。
          res: _resTimingStats(),
        },
        // ⭐⭐⭐v6.171 Svelte runtime warning。`derived_inert` ＝ 讀到「owner effect 已銷毀／
        //   正在離場」的 derived ⇒ 讀到的是**過期值**。判讀：
        //   ・`first` 帶 chunk:line:col，配 sourcemap 就能定位到底是哪一個 derived。
        //   ・`+NNNms` 是距離上一次 pointerdown 的時間：很大 ⇒ 不是玩家點出來的，
        //     多半是殭屍計時器／輪詢續行讀到已銷毀元件的 derived。
        //   ・`inertNodes` 持續 > 0 ⇒ 有分支永久卡在 INERT（離場動畫沒收尾）。
        //   ⚠ v6.179 起容器在 window 上（`window.__ptcgSvelteWarn`）—— /game 重掛載後仍讀得到，
        //     不再是「新實例永遠回空」的假零。
        svelteWarn: { counts: { ..._svelteWarn.counts }, first: _svelteWarn.first.slice(0, 3), inertNodes: _inertNodeCount() },
        env: {
          vis: (typeof document !== 'undefined' ? document.visibilityState : '?'), layout: battleLayout,
          w: (typeof window !== 'undefined' ? window.innerWidth : 0), h: (typeof window !== 'undefined' ? window.innerHeight : 0),
          ua: (typeof navigator !== 'undefined' ? (navigator.userAgent || '').slice(0, 80) : ''),
          // ⭐v6.159 裝置等級（都要 feature-detect；拿不到一律 null，絕不 throw）。
          //   旁證顯示多數玩家 RTT 中位數 0.2~0.8 秒、少數 3~7 秒 ⇒ per-裝置成因，
          //   核心數／記憶體正是驗證「就是那幾台弱裝置」最直接的一欄。
          hc: (typeof navigator !== 'undefined' && typeof (navigator as any).hardwareConcurrency === 'number' ? (navigator as any).hardwareConcurrency : null),
          dm: (typeof navigator !== 'undefined' && typeof (navigator as any).deviceMemory === 'number' ? (navigator as any).deviceMemory : null),
        },
      };
      void tApi('/clientdiag', payload).catch(() => { /* fire-and-forget,診斷絕不影響對戰 */ });
    } catch { /* 診斷絕不影響對戰 */ }
  }
  // v5.618：手動/自動「重新同步」— 強制 v=-1 抓伺服器權威最新盤面（版本不同才採用，避免擾動我方 picker）。
  //   答玩家「輪到自己時系統會幫忙確認/不必 F5」：對戰中盤面卡住即可由看門狗自動或玩家點「🔄 同步」恢復。
  async function tForceResync() {
    if (!isTournament || isTournSpectator || !tActiveRoom) return;
    // ⭐⭐⭐v6.180 送出當下的版本：這一發與**主輪詢並行**（主輪詢是 setInterval，不等前一發回來），
    //   所以它的回應完全可能比輪詢剛採納的那一份還舊。`expectV` 讓中央閘分得出
    //   「亂序的舊回應」（丟棄）與「client 真的超前伺服器」（放行回正）。
    // ⚠⚠⭐v6.180（Fable 5 審查）：版本閘**擋不住跨房**——離場後 `tVersion` 歸 -1，晚到的舊回應
    //   反而會走 `first` 被照收，把 `game` 復活、`tStep` 拉回 'playing'（玩家被彈回已結束的對戰）。
    //   主輪詢從 v5.586 起就有 `gen !== tPollGen` 這道守衛，這兩條 `v=-1` 路徑一直沒有。
    const _rv = tVersion, _rGen = tPollGen, _rRoom = tActiveRoom;
    try {
      const fr = await tApi(`/state?room=${tActiveRoom}&v=-1&s=${mySeatIdx}`);   // v6.170 順便打心跳
      if (_rGen !== tPollGen || _rRoom !== tActiveRoom) return;   // 已離開對戰／換房 ⇒ 這一發整發作廢
      if (fr) _tLastPollOkAt = Date.now();   // v6.149 同上：手動/看門狗同步成功也算存活（按了鈕橫幅要能立刻收掉）
      if (fr && fr.gameState && typeof fr.version === 'number') {
        // ⭐⭐v6.148（Fable 5 實測抓到）：`_tLastStateChangeAt` 原本在 if **外面**無條件執行 ——
        //   新鮮度看門狗每 8 秒觸發一次 resync，每次都把 anchor 推到現在，
        //   於是「盤面最近有變動」永遠成立，`tPollDesiredMs` 的快檔變成**常態**
        //   （對手長考 120 秒的模擬：93% 的時間都落在快檔）。
        //   anchor 的語義是「盤面**真的**變過」，所以只在版本真的不同時才更新
        //   —— v6.180 起 anchor 由 `tAdopt` 在**真的採納了**的時候推進，語義更嚴格（被丟棄就不推）。
        // ⭐⭐⭐v6.180：這裡原本是 `!==` 就整包蓋上去（含**比較舊**的版本），是「跳回上一步」的
        //   主要來源之一。改走中央閘：亂序丟棄、真超前才回正。ensurePoolForStateIds／tStep
        //   ／anchor 都由 tAdopt 負責（v5.932 的補救也在裡面，不會漏）。
        if (fr.version !== tVersion) tAdopt(fr.gameState, fr.version, { expectV: _rv, reason: 'resync' });
      }
      if (fr && typeof fr.lastActionAt === 'number') tLastActionAt = fr.lastActionAt;
      if (fr && 'actorSeat' in fr) tServerActorSeat = (typeof fr.actorSeat === 'number' ? fr.actorSeat : null);   // v6.151 伺服器權威
      if (fr && typeof fr.longPoll === 'boolean') tLongPollReady = fr.longPoll;   // v6.152
      if (fr && typeof fr.serverNow === 'number') { tClockOffset = fr.serverNow - Date.now(); tNow = Date.now() + tClockOffset; }
      tAuthLost = false;   // v6.150 同步成功 ⇒ 身分是好的
    } catch (e: any) { if (e && e.status === 401) tAuthLost = true; /* 其餘忽略 */ }
  }
  // v5.569：算「當前該動作的座位」(鏡射伺服器 currentActorSeat)，給等待方閒置倒數判斷
  function tCurrentActorSeat(g: any): number | null {
    if (!g || g.phase === 'game-over') return null;
    // ⭐⭐v6.158：setup 分支原本是【只看 setupDone】的 v5.569 舊副本 ——
    //   雙方都未完成時一律回 -1，完全忽略 mulligan 子階段。後果不只是閃避倒數：
  //   診斷 payload 的 `actorSeat` 就是用它算的，2026-08-10 賽事兩筆「開局卡住」回報回
  //   `actorSeat=-1`（看起來像【沒人該動作的死角】），但同一組盤面送進伺服器的
  //   currentActorSeat 實跑是 0（mulligan 較少方先放）—— 完全誤導診斷方向。
  //   ⭐【只能有一份判準】：setup 一律改呼 setupActorSeat（與伺服器逐行同步那一份）。
    if (g.phase === 'setup') return setupActorSeat(g);
    if (g.phase !== 'playing') return null;
    if (g.pendingSelection && (g.pendingSelection.actorIdx === 0 || g.pendingSelection.actorIdx === 1)) return g.pendingSelection.actorIdx;
    if (g.pendingPrizes && (g.pendingPrizes[0] || 0) > 0) return 0;
    if (g.pendingPrizes && (g.pendingPrizes[1] || 0) > 0) return 1;
    if (g.players && g.players[0] && g.players[0].active === null) return 0;
    if (g.players && g.players[1] && g.players[1].active === null) return 1;
    return (g.activePlayerIndex === 0 || g.activePlayerIndex === 1) ? g.activePlayerIndex : null;
  }
  // 我在等對手時，回傳「對手再過幾秒閒置判負（我獲勝）」；非等待狀態回 null
  const tIdleWarnSec = $derived.by(() => {
    if (!isTournament || isTournSpectator || !game || !tLastActionAt) return null;
    if ((game as any).phase === 'game-over') return null;
    // ⭐v6.151 回前景後短暫不顯示：背景頁籤的 tick 被瀏覽器節流，tNow 停在舊值，
    //   一回來會先算出「剩 0 秒」嚇人一跳（畫面其實還沒對時）。
    if (_tForegroundAt > 0 && tNow - _tForegroundAt < 3000) return null;
    // ⭐v6.151 方向以**伺服器**為準：閒置判負是伺服器用它那份盤面算的，client 本地推算
    //   只要版本落後就會反向（v6.149 事故）。伺服器沒回這個欄位（舊版）才退回本地推算。
    const actor = (tServerActorSeat !== undefined) ? tServerActorSeat : tCurrentActorSeat(game);
    // ⚠ v6.156（Fable 5 審查）：`actor === -1`（雙方都該動作＝系統死角）也要回 null。
    //   否則死角時**同一個畫面**會同時出現「⏳ 對手閒置中：將自動判你勝」（這句在死角情境
    //   是錯的 —— 結果是平手待裁定，不是我勝）與「剩 N 秒未行動就會被判負」的確認框，
    //   兩句話方向相反。v6.156 起 -1 一律由「我還在」確認框負責。
    if (actor == null || actor === -1 || actor === mySeatIdx) return null;
    const remain = Math.ceil((tLastActionAt + tIdleMin * 60000 - tNow) / 1000);
    return remain > 0 ? remain : 0;
  });
  // ⭐v6.156 **我自己**再過幾秒會被判負（tIdleWarnSec 的反方向）。
  //   ⚠ `actor === -1`（雙方都該動作＝系統死角）兩邊都要看到 —— 站長裁定②「所有閒置情境都彈」，
  //     而死角正是最需要當場問的那一種：兩個人都在等對方，誰也不知道自己正在被倒數。
  //   ⚠ 方向同樣以**伺服器**為準（v6.149 事故：本地推算只要版本落後就會反向）。
  const tMyIdleSec = $derived.by(() => {
    if (!isTournament || isTournSpectator || !game || !tLastActionAt) return null;
    if ((game as any).phase === 'game-over') return null;
    // 回前景後短暫不顯示（同 tIdleWarnSec：背景頁籤 tick 被節流，tNow 停在舊值會先算出「剩 0 秒」）
    if (_tForegroundAt > 0 && tNow - _tForegroundAt < 3000) return null;
    const actor = (tServerActorSeat !== undefined) ? tServerActorSeat : tCurrentActorSeat(game);
    if (actor == null) return null;
    if (!(actor === mySeatIdx || actor === -1)) return null;
    const remain = Math.ceil((tLastActionAt + tIdleMin * 60000 - tNow) / 1000);
    return remain > 0 ? remain : 0;
  });
  /**
   * v6.156 按下「我還在」。
   * ⚠ 伺服器只接受「該動作方」的呼叫（否則等待方就能替掛機的對手無限續命）。
   * ⚠ 對局時限已到之後伺服器會拒絕 —— 那時倒數不該再被重置，否則最後回合永遠打不完。
   */
  async function tStillHere() {
    if (tStillHereBusy) return;
    tStillHereBusy = true; tStillHereNote = '';
    try {
      const r = await tApi('/still-here', { room: tActiveRoom, playerId: tPlayerId() });
      if (r && r.ok) {
        if (typeof r.lastActionAt === 'number') tLastActionAt = r.lastActionAt;
        // 死角（雙方都該動作）：點了「我還在」但盤面還是推不動，**那才是真 bug** ⇒
        //   強制重抓一次權威盤面，並送診斷指紋讓站長在監控分頁看得到。
        if (r.actorSeat === -1) {
          tForceResync();
          // ⚠ v6.156（Fable 5 審查）：伺服器回 -1 **不等於**「雙方都完成準備」——
          //   例如雙方同 mulligan 數、都還沒放出場也是 -1。指紋名稱與 admin 的白話說明
          //   都是「雙方都完成準備卻推不動」，誤發會直接誤導站長。
          //   而且這個指紋走一般配額（每頁 3 發），死角裡玩家每 2.5 分鐘點一次，
          //   三次就把配額吃光 ⇒ 之後真正的 stale-version 全部靜音。⇒ 加判準 + 每場只送一次。
          const _sd = (game as any)?.setupDone;
          if (!_stalledDiagSent && (game as any)?.phase === 'setup' && !!(_sd && _sd[0]) && !!(_sd && _sd[1])) {
            _stalledDiagSent = true; _tSendClientDiag('setup-stalled-both-done');
          }
        }
      } else if (r && r.reason === 'time-limit') {
        tStillHereNote = '對局時限已到，請盡快完成最後回合。';
      } else if (r && r.reason === 'not-your-turn') {
        // 伺服器認為現在不是我該動作 ⇒ 我手上的盤面落後了，重抓才是對的處置
        tStillHereNote = '盤面已更新，正在重新同步…'; tForceResync();
      } else if (r && r.reason === 'game-over') {
        tStillHereNote = '這場對戰已經結束。'; tForceResync();
      } else if (r && r.error) {
        tStillHereNote = r.error;
      }
    } catch (e: any) {
      tStillHereNote = '網路不穩，請再按一次。';
    } finally { tStillHereBusy = false; }
  }
  async function tournamentJoin() {
    const deck = allDecks.find(d => d.id === tDeckId);
    if (!deck) { tError = '請先選擇牌組'; return; }
    const total = deck.entries.reduce((s: number, e: any) => s + (e.count || 0), 0);
    if (total !== 60) { tError = `所選牌組為 ${total} 張（需 60 張）`; return; }
    tError = ''; tBusy = true; tStep = 'waiting'; tActiveRoom = T_ROOM; tVersion = -1;   // ⭐v6.180 進場＝合法的版本重置（同 tEnterMatch）
    try {
      const nm = (myName && myName.trim()) || '玩家';
      const r = await tApi('/join', { room: tActiveRoom, playerId: tPlayerId(), name: nm, deckEntries: deck.entries });
      if (r.error) { tError = r.error; tStep = 'lobby'; return; }
      mySeatIdx = r.seat; myPlayerIndex = r.seat as 0 | 1; mode = 'online'; isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0;
      tSyntheticRoom(r.seats, r.names);
      if (r.gameState) tAdopt(r.gameState, r.version);
      else tStep = 'waiting';
      startTournamentPoll();
    } catch (e: any) {
      tError = '連線失敗：' + (e?.message ?? e) + '（伺服器權威錦標賽僅正式站可用）';
      tStep = 'lobby';
    } finally { tBusy = false; }
  }
  // ⭐⭐⭐v6.161 「立刻回到正常頻率」的唯一入口：把三個節奏錨點歸零（下一個 base tick，≤3 秒，
  //   就會送出 /event /chat /bracket），並把 _tLobbyResumeAt 推到現在（接下來 60 秒一律正常頻率）。
  //   呼叫時機：①輪次推進／我有新比賽（tournLoadEvent 對照出差異） ②分頁回到前景 ③剛進大廳。
  function tLobbyResume() {
    _tLobbyResumeAt = Date.now();
    _tLobbyEventAt = 0; _tLobbyChatAt = 0; _tLobbyBracketAt = 0;
  }
  // ⭐⭐v6.148 輪詢節奏的**唯一**中央述詞（對戰與觀戰共用同一套判準）。
  //   ① 對戰已結束 → 大幅降頻（v6.146）。⚠ 是降頻不是停：`winner == null` 的平手要等管理員裁定，
  //      裁定會 bump 伺服器盤面版本，停掉輪詢玩家永遠等不到結果。
  //   ② 盤面「最近才變動過」＝雙方正在你來我往 → 加密到 600ms，把「對手動作到我看到」的
  //      最壞延遲從 1.2 秒砍半。長考／掛機時自動退回 1.2 秒，所以不會變成常態負載。
  //   ③ 其餘維持 1.2 秒。
  function tPollDesiredMs(spectate: boolean, mode: 'battle' | 'lobby' = 'battle'): number {
    // ⭐⭐⭐v6.161 lobby 分支：大廳（＝沒有在對戰的人）的 /event /chat /bracket 節奏
    //   也收進這支中央述詞，**不另外寫一份**。40 人打到第四輪時，出局／輪空／
    //   本輪已打完的人逐輪累積，卻一直以對戰中的頻率在打伺服器。
    // ⚠⚠ 這裡每一條都是 **fail-open**：判斷不出來一律回正常頻率。
    //   寧可多打伺服器，不可因為降頻害人晚一步發現比賽開始而被判未進場。
    if (mode === 'lobby') {
      const _now = Date.now();
      // ① 從沒成功抓過 /event，或最近 30 秒沒有成功回應 ⇒ 判斷不出來 ⇒ 正常頻率。
      if (_tEventOkAt <= 0 || (_now - _tEventOkAt) > 30000) return 3000;
      // ② 剛輪次推進／剛回前景／剛進大廳 ⇒ 60 秒內一律正常頻率。
      if (_tLobbyResumeAt > 0 && (_now - _tLobbyResumeAt) < 60000) return 3000;
      // ③ 我本輪有還沒打完的對戰（含還沒進場）⇒ 正常頻率。這是最不能降的一群人。
      //   伺服器的 myMatch 查的就是 status ≠ done 的本輪對戰，是權威資料、不是畫面狀態。
      if (tMyMatch) return 3000;
      // ④ 我已報名且該賽事正在報到／賽程產生中 ⇒ 正常頻率（下一步就是我的第一場）。
      if (tEvents.some((e: any) => e && e.registered && (e.status === 'checkin' || e.status === 'bracket_ready'))) return 3000;
      // ⑤ 其餘＝出局／輪空／本輪已打完／純逛大廳 ⇒ 降頻。
      //   ⚠ base tick 是 3000ms，只有 3000 的倍數是**實際會發生**的間隔（v6.148 的量化教訓）：
      //     寫 8000 會被量化成 9000，那就是文件與行為不符 ⇒ 誠實寫 9000。3 秒 → 9 秒。
      //   ⚠ 遲到的代價：/event 是「我的下一場開始了」的輪詢通道，最壞多 6 秒才發現；
      //     而輪次推進後還有 roundCountdownMin（預設 3 分）休息倒數 ＋ noShowMin（預設 5 分）
      //     遲到容許，共 480 秒；6 秒佔 1.25%，不可能因此被判未進場。
      //     （實作比對：一般對戰頁的跨房提醒 tAlertPollTimer 本來就是 60 秒一次（v6.217④）。）
      if (_tTabHidden) return 21000;   // 背景分頁再保守一點（回前景會立即強制同步，見 onVis）
      return 9000;
    }
    const g = game as { phase?: string; winner?: number | null; activePlayerIndex?: number } | null;
    if (g && g.phase === 'game-over') {
      if (spectate) return 10000;
      return (g.winner == null) ? 6000 : 12000;   // 平手待裁定要早點看到結果
    }
    // ⭐v6.217⑤ 觀戰輪詢 2000 → 4000:觀戰者不參與對局,晚 2 秒看到對手動作不影響任何
    //   判定;錦標賽尖峰時觀戰人數會放大這條輪詢的量(v0.80:每場都掛著數名觀戰者)。
    //   ⚠ base tick 是 400ms,4000 是 400 的整數倍=實際會發生的間隔(v6.148 量化教訓)。
    //   game-over 後的 10000 檔位不動(v6.146 既有行為)。
    if (spectate) return 4000;
    // ⚠ 快檔三個條件缺一不可：
    //   ① 只在 playing —— setup 有自己的 3.5 秒看門狗，50 人同時開局全員進快檔會變成尖峰。
    //   ② 只在「等對手」—— 自己回合的動作走 dispatch，回應本身就即時，不需要快 poll；
    //      這一條把快檔人口直接砍半。
    //   ③ 盤面 15 秒內真的變動過（見 tForceResync 的 anchor 修正）。
    // ⚠ base tick 是 400ms，所以 800 是**實際會發生**的間隔；寫 600 會被量化成 800，
    //   等於文件與行為不符（Fable 5 審查指出）。誠實寫 800：1.2 秒 → 0.8 秒。
    const _waitingOpp = !!g && (g as { activePlayerIndex?: number }).activePlayerIndex !== mySeatIdx;
    if (g && g.phase === 'playing' && _waitingOpp
        && _tLastStateChangeAt > 0 && (Date.now() - _tLastStateChangeAt) < 15000) return 800;
    return 1200;
  }
  function startTournamentPoll() {
    if (tPollTimer) clearInterval(tPollTimer);
    const gen = ++tPollGen;
    let _lastChatAt = 0;       // v6.148 大廳聊天改時間判準（原本綁輪詢輪數，節奏一變就漂移）
    let _lastFetchAt = 0;      // v6.148 上一次真的送出 /state 的時刻
    let _pollBusy = false;     // v6.148 上一發還沒回來
    tPollTimer = setInterval(async () => {
      // ⭐⭐v6.148 C4 防自我壅塞：setInterval **不等前一發完成**，RTT 飆高時會一直疊送，
      //   在隧道排隊反而讓延遲雪上加霜（v6.135 只修了亂序的**正確性**，沒防壅塞）。
      // ⚠⚠ 這兩個早退**必須放在 try 之外**：`return` 在 try 內一樣會執行 finally，
      //   於是每個「因為忙碌而跳過」的 tick 都會把**在途那一發設的旗標**清掉 ⇒ 防壅塞完全失效。
      //   （Fable 5 實測：RTT 2 秒時同時在途最高 3 發，修正後才是 1 發。）
      if (_pollBusy) return;
      // ⭐v6.148 節奏 gate：base tick 固定 400ms，實際多久送一次由 tPollDesiredMs 決定。
      //   （v6.146 用「每 N 輪」的計數器實作，改成時間判準後兩邊共用同一個中央述詞。）
      const _now = Date.now();
      // ⭐v6.152 長輪詢模式：伺服器會把這一發掛起最多 25 秒、盤面一變就回。
      //   ① 不再套 tPollDesiredMs 節流 —— 回來就立刻再送一發，等待端的延遲才降得到 ~RTT；
      //   ② 逾時放寬到 30 秒（比伺服器的 25 秒上限多一點餘裕）；
      //   ③ `_pollBusy` 仍然擋住重疊送出（v6.148 的防自我壅塞在這裡更重要）；
      //   ④ 對戰結束後不長輪詢 —— 那時要的是降頻，不是低延遲。
      const _lp = tLongPollReady && !isTournSpectator && !!game && (game as any).phase !== 'game-over';
      if (!_lp && _now - _lastFetchAt < tPollDesiredMs(false)) return;
      _lastFetchAt = _now;
      _pollBusy = true;
      try {
        const reqV = tVersion;  // v6.135 送出當下的版本（亂序守衛用）
        // ⭐⭐v6.172 掛起窗：這一發本來就會被伺服器掛住最多 25 秒，
        //   在它自己的逾時到期前**不得**被算成「失聯」（否則長輪詢＝橫幅常駐）。
        if (_lp) { _tLongPollAt = Date.now(); _tLpHangUntil = Date.now() + T_LP_CLIENT_TIMEOUT_MS; }
        // ⭐v6.170 `s=` 是**心跳**：讓伺服器知道我這個座位還連得上，對手才看得到誠實的
        //   「對手連線不穩」提示（B-4 鏡像效應）。純視覺用途，不進遮蔽判定、不碰閒置判負。
        const r = await tApi(`/state?room=${tActiveRoom}&v=${tVersion}&s=${mySeatIdx}` + (_lp ? '&wait=1' : ''),
          undefined, _lp ? { timeoutMs: T_LP_CLIENT_TIMEOUT_MS } : undefined);
        if (gen !== tPollGen) return; // v5.586 已離開對戰 → 丟棄在路上的回應，避免 tAdopt 把人彈回對戰畫面
        _tLastPollOkAt = Date.now();  // v5.591 標記輪詢存活（看門狗用）
        tAuthLost = false;            // v6.150 拿到正常回應 ⇒ 身分是好的
        if (r && r.names) tSyntheticRoom(r.seats, r.names);
        // v5.593 client 版本超前伺服器(desync/房重置)→ 強制回正(伺服器權威)
        // v6.135 ⚠ 亂序守衛 `reqV === tVersion`：setInterval **不等前一發完成**，RTT 抖動時多發並行。
        //   情境：A、B 兩發並行，B 帶回 v12（已採納，tVersion=12），A 晚到帶回 v11 → 舊條件 `11 < 12` 成立
        //   → **盤面倒回 v11**，1.2 秒後又跳回 v12 ⇒ 玩家看到「動作出現又消失」。
        //   既有的 `gen !== tPollGen` 只擋「離開對戰後的舊回應」，擋不住同一輪詢內的亂序。
        //   真 desync 的特徵是「送出當下 client 就已經超前」⇒ 用 reqV 判定，晚到的舊回應一律丟棄。
        // ⭐⭐⭐v6.180 前進／回正兩條分支收斂成**同一個中央閘**（`reqV` 就是 `expectV`）：
        //   兩邊各寫一套的年代，另外三條採納路徑漏掉了這個判準（見 tAdopt 的註解）。
        if (r && typeof r.version === 'number' && r.version !== tVersion && r.gameState) tAdopt(r.gameState, r.version, { expectV: reqV, reason: 'poll' });
        if (r && typeof r.lastActionAt === 'number') tLastActionAt = r.lastActionAt;
        if (r && typeof r.idleForfeitMin === 'number') tIdleMin = r.idleForfeitMin;
        if (r && 'actorSeat' in r) tServerActorSeat = (typeof r.actorSeat === 'number' ? r.actorSeat : null);   // v6.151 伺服器權威
        if (r && typeof r.longPoll === 'boolean') tLongPollReady = r.longPoll;   // v6.152 伺服器宣告是否已啟用長輪詢
        // ⭐v6.170 欄位**缺席就是 0**（伺服器未達門檻／沒紀錄時刻意省略這個鍵）⇒ 提示自然收掉。
        tOppQuietSec = (r && typeof r.oppQuietSec === 'number') ? r.oppQuietSec : 0;
        if (r && typeof r.serverNow === 'number') tClockOffset = r.serverNow - Date.now();
        tNow = Date.now() + tClockOffset;
        // v5.577/v0.68 對戰中大廳聊天降載。v6.148 改**時間判準**：原本綁「每 5 輪」，
        //   輪詢節奏一變（400ms base）就會跟著漂移，與它自己的降載意圖脫鉤。
        if (_now - _lastChatAt >= 6000) { _lastChatAt = _now; tChatLoad(); }
      } catch (e: any) { if (e && e.status === 401) tAuthLost = true; /* 其餘忽略單次輪詢失敗 */ }
      // ⭐v6.172 掛起窗一併關閉：逾時／失敗 ⇒ 立刻恢復計算失聯秒數（正對照的關鍵）。
      finally { _pollBusy = false; _tLongPollAt = 0; _tLpHangUntil = 0; }   // v6.148 一定要放掉，否則輪詢永久停擺
    }, 400);
  }
  // v6.137 樂觀更新狀態 —— 與 tBusy 分開：
  //   tBusy    仍是「大廳操作鎖」（報名/進場/離場…，template 有多處綁定）
  //   tInFlight 是「對戰動作的網路單發鎖」
  //   tPredicted 表示「目前畫面上的 game 是本地預測、尚未被伺服器確認」
  //   ⚠ tVersion 絕不因預測遞增 —— 它的語義永遠是「伺服器確認過的版本」，
  //     動了會讓輪詢的「client 超前回正」分支誤判（v6.135 才剛修過亂序倒退）。
  let tInFlight = $state(false);

  // ⭐⭐v6.147「按了沒反應」的真兇之一：`tInFlight` 在 v6.137 加進來時**沒有任何 template 綁定**
  //   （`disabled={tInFlight}` 整份檔案出現 0 次），所以動作送出往返期間按鈕外觀完全不變，
  //   玩家第二次點擊還會被 tournamentDispatch 開頭直接丟棄並跳一行紅字。
  //   ⇒ 這裡建立**唯一**的視覺 busy 述詞，所有送出動作的按鈕一律綁它。
  //   ⚠ 刻意**只** disable「會送出動作的元素」，不做全畫面遮罩 ——
  //     tApi 有 12 秒逾時保護，全域遮罩會讓網路卡住時玩家連設定/離開/放大鏡都按不了。
  // ⭐⭐⭐v6.172 這裡拆成**兩個**述詞，因為它們回答的是兩個不同的問題：
  //   `actionSending` ——「現在有動作在網路上嗎？」⇒ 只拿來顯示 ⏳ 提示，**不擋任何操作**。
  //   `actionBusy`    ——「這一下真的不能做嗎？」⇒ **唯一**可以 disable 元素／擋拖曳的述詞。
  //   v6.171 以前兩者是同一個 ⇒「有動作在途」＝「什麼都不能做」，最長 33 秒（重送窗）。
  //   現在只有**佇列已滿**（前面已經排了 TACT_QUEUE_MAX 個手勢還沒送出）才會真的擋，
  //   而且擋下來一定有文字說明（tActSay ／ TACT_BLOCKED_MSG）。
  const actionSending = $derived(isTournament && tInFlight);
  const actionBusy = $derived(isTournament && tInFlight && tActQueue.length >= TACT_QUEUE_MAX);

  // ⭐⭐⭐v6.149 連線健康橫幅 —— 事故驅動（2026-08-09 網站賽-61 R6）。
  //   玩家與伺服器失聯約 8 分鐘，畫面停在「對手回合」的舊盤面、本地把對手的閒置倒數走到 0，
  //   於是他看到「對方閒置超時」；伺服器依權威盤面判的卻是他自己閒置逾時。
  //   ⚠ 當時三處失敗路徑（輪詢 / 兩個看門狗）**全部靜默 catch**，畫面沒有任何一個像素提示。
  //   ⚠ 這個秒數必須是「上次真的收到伺服器回應」到現在，不能被看門狗的自我安撫重置。
  // ⭐⭐⭐v6.172 中央述詞：距離「上一次能證明伺服器還連得上」幾毫秒。
  //   ⚠ 用 `tNow - tClockOffset` 而不是 tNow：兩個錨點都是本機時鐘，直接拿伺服器時鐘相減
  //     會把時鐘偏移一起算成失聯秒數（tNow 的定義就是 Date.now() + tClockOffset）。
  //   ⚠ `_tLpHangUntil` 是**未來**的時間戳 ⇒ 長輪詢掛起期間這個值恆為 0，橫幅不可能跳。
  const tConnStaleMs = $derived(Math.max(0, (tNow - tClockOffset) - Math.max(_tLastServerOkAt, _tLpHangUntil)));
  const tOfflineSec = $derived(
    isTournament && tStep === 'playing' && !!game && (game as { phase?: string }).phase !== 'game-over'
    && !isTournSpectator && _tLastServerOkAt > 0
      ? Math.floor(tConnStaleMs / 1000)
      : 0,
  );
  // ⭐v6.158：身分被拒也要出橫幅 —— 它帶的「立即重新同步」會先 getIdToken(true) 強制換憑證，
  //   那正是這種情況唯一的自救路徑。⚠ 關閉條件用 _tActionAuthErrAt 而不是 _tLastPollOkAt：
  //   輪詢一直在成功，用 _tLastPollOkAt 的話按了叉叉下一秒又跳出來。
  // ⭐⭐⭐v6.170【B-4】「鏡像效應」的誠實提示。
  //   v6.159 的資料：`stale-version` 138 筆裡 94 筆發生在**對手回合**、108 筆自己的輪詢是健康的
  //   ⇒ 多數人喊「卡住」其實是對面那個人斷線的投影。我方畫面不該看起來像網站壞掉。
  // ⚠⚠ 判準**全部來自伺服器**，一個都不用猜：
  //   ① `tOppQuietSec` —— 對手上一次向伺服器要盤面到現在幾秒；**門檻是伺服器依它自己的
  //      長輪詢設定推導的**（站長把掛起秒數調來調去，寫死門檻的版本就會開始誤報）。
  //   ② `tServerActorSeat` —— 伺服器權威的「現在輪到誰」，不是 client 本地推算（v6.149 教訓）。
  // ⚠ 只在「輪到對手」時顯示：自己回合時對手斷不斷線都不擋我出牌，跳提示只會製造焦慮。
  // ⚠ 正常長考的對手仍然每 1.2 秒在輪詢 ⇒ oppQuietSec 恆為 0 ⇒ 長考絕不會誤觸發。
  // ⚠ 不透露任何盤面資訊；也不碰閒置判負（那是伺服器依 lastActionAt 自己算的，本提示純視覺）。
  const tOppQuietOn = $derived(
    isTournament && !isTournSpectator && tStep === 'playing' && !!game
    && (game as { phase?: string }).phase !== 'game-over'
    && tOppQuietSec > 0
    && typeof tServerActorSeat === 'number' && tServerActorSeat >= 0 && tServerActorSeat !== mySeatIdx);
  const tNetBannerOn = $derived(
    (tOfflineSec >= T_OFFLINE_BANNER_SEC && _tNetBannerDismissAt < _tLastServerOkAt)
    || (_tActionAuthErr && _tNetBannerDismissAt < _tActionAuthErrAt));

  // ⭐⭐⭐v6.170 動作送出狀態機（B-1 冪等重試 ／ B-2 恢復偵測 ／ B-3 不鎖死）。
  //   v6.169 的行為：逾時 ⇒ 回滾預測畫面 ＋ 紅字「動作可能未送達，請重試」。
  //   那句話把整個不確定性丟給玩家：重按可能套用兩次、不按就動作遺失然後被閒置判負。
  //   ⇒ 現在每個動作都帶一個 `actId`（一個手勢一個鍵，跨所有重送 attempt 不變），
  //     伺服器保證同一個鍵只套用一次 ⇒ 「網路一恢復就自動重送」變成安全的。
  // ⚠ 用**物件同一性**判斷而不是無條件 `game = prev`：若輪詢在 await 期間已帶回更新的盤面
  //   （動作其實成功、只是回應丟了），盲目還原會把畫面倒退到比 tVersion 還舊（v6.137 教訓）。
  // ⭐⭐⭐v6.180 再加一條**版本**判準：只有「伺服器版本從我做預測到現在一步都沒動過」才可以還原。
  //   物件同一性單獨用是不夠的 —— v6.173 起 `tAdopt` 走 `shareStateIdentity`，當伺服器盤面與本地
  //   預測**逐位元組相同**（白名單四個動作都是決定性的、兩端同一份引擎）時它會**原封回傳 prev 本人**，
  //   `game === ctx.predictedRef` 依然成立。那時伺服器其實已經確認了這個動作（tVersion 已前進），
  //   只是那一發 POST 的回應沒回來（逾時／401／玩家按了「停止重送」）—— 還原它就是「跳回上一步」。
  //   ⚠ 另一半見 tournamentDispatch：`predictedRef` 必須存**讀回來的** `game`（proxy），存原始物件
  //     的話這個條件恆為 false，整段回滾是死碼（v6.137~v6.179 的實際行為）。
  function _tRestorePrediction(ctx: TActCtx): void {
    if (ctx.predicted && game === ctx.predictedRef && tVersion === ctx.baseV) game = ctx.prev;
    ctx.predicted = false; ctx.predictedRef = null;
  }
  function _tActDone(ctx: TActCtx): void {
    if (_actCtx !== ctx) return;
    _actCtx = null; tActRetry = null; tInFlight = false;
    if (_actRetryTimer) { clearTimeout(_actRetryTimer); _actRetryTimer = null; }
  }
  /** ⭐v6.172 丟掉整條佇列。⚠ 一定要說出來 —— 玩家做過的手勢消失而畫面不講，就是這一版要根治的事。 */
  function _tActClearQueue(why: string): void {
    if (!tActQueue.length) return;
    const n = tActQueue.length;
    tActQueue = [];
    tActSay('已取消 ' + n + ' 個排隊中的動作（' + why + '）—— 這些動作沒有送出，請以畫面為準重做。', 6000);
  }
  /**
   * ⭐⭐⭐v6.172（Fable 5 審查抓到）離開對戰／重置房間 ⇒ **在途動作與整條佇列一律作廢**。
   * ⚠⚠ 只清佇列是不夠的：在途那一發回來時會 `tAdopt`，那會把 `tStep` 拉回 'playing'、`game` 復活，
   *   於是 drain 的 game-over 防線形同虛設，舊手勢就會用新的 actId 打進**下一場**對局。
   *   ⇒ 必須同時把 `_actCtx` 設成 null —— `_tActAttempt` 開頭的 `_actCtx !== ctx` 會讓那一發的
   *     回應在 tAdopt **之前**就被丟棄。
   */
  function tActAbortAll(why: string): void {
    if (_actRetryTimer) { clearTimeout(_actRetryTimer); _actRetryTimer = null; }
    _actCtx = null; tActRetry = null; tInFlight = false;
    _tActClearQueue(why);
  }
  /**
   * ⭐⭐⭐v6.172 送出佇列最前面那一個。
   * ⚠⚠ 一次只放一個出去（`tInFlight` 仍然是單發鎖）—— 這是「不會重複套用、也不會亂序」的根據：
   *   ・同時只有一個動作在網路上 ⇒ v6.170 的 actId 冪等語義完全沒變；
   *   ・出佇列時才走 tournamentDispatch ⇒ 每個手勢拿到**自己的** actId；
   *   ・佇列長度有上限且每次必定移除一個 ⇒ 這條自我重呼叫鏈有明確上限，不可能無限展開。
   */
  function _tActDrain(): void {
    if (tInFlight || !tActQueue.length) return;
    if (game && (game as { phase?: string }).phase === 'game-over') { _tActClearQueue('對局已結束'); return; }
    if (tStep !== 'playing' || !tActiveRoom) { _tActClearQueue('已離開對戰'); return; }
    const next = tActQueue[0];
    tActQueue = tActQueue.slice(1);
    void tournamentDispatch(next.action);
  }
  function _tActCanRetry(ctx: TActCtx): boolean {
    if (_actCtx !== ctx) return false;                       // 已被取消／被新動作取代
    if (ctx.attempt >= TACT_RETRY_MAX) return false;
    if (Date.now() - ctx.startedAt >= TACT_RETRY_MS) return false;
    // ⚠ 對局已經結束（被判負／對手投降／時限到）⇒ 立刻停手。只靠次數與時間上限是不夠的：
    //   那還要再等十幾秒，而畫面上寫著「正在重送」會讓玩家以為還有救。
    if (game && (game as { phase?: string }).phase === 'game-over') return false;
    return true;
  }
  function _tActSchedule(ctx: TActCtx, delayMs: number): void {
    if (_actRetryTimer) { clearTimeout(_actRetryTimer); _actRetryTimer = null; }
    tActRetry = { n: ctx.attempt + 1, max: TACT_RETRY_MAX };   // 退避等待期間就要看得到，不是等送出才顯示
    _actRetryTimer = setTimeout(() => { _actRetryTimer = null; void _tActAttempt(ctx); }, Math.max(0, delayMs));
  }
  async function _tActAttempt(ctx: TActCtx): Promise<void> {
    if (_actCtx !== ctx) return;
    ctx.attempt++;
    tActRetry = ctx.attempt > 1 ? { n: ctx.attempt, max: TACT_RETRY_MAX } : null;
    try {
      const _rttT0 = Date.now();
      const r = await tApi('/action',
        { room: tActiveRoom, playerId: tPlayerId(), action: ctx.action, actId: ctx.actId },
        { timeoutMs: TACT_POST_TIMEOUT });
      // ⚠ 在途期間玩家可能按了「停止重送」⇒ 這一發的結果作廢，絕不可以再動畫面或旗標。
      if (_actCtx !== ctx) return;
      _tRecordRtt(Date.now() - _rttT0);   // v6.151 只記成功的往返（逾時記進去會扭曲統計）
      _tActionAuthErr = false;            // v6.158 動作真的送進去了 ⇒ 身分是好的（只有這條路徑能證明）
      if (r.gameState) {
        // 伺服器權威：無條件採納（含 error/rejected/stale/duplicate 各條路徑回傳的盤面 ＝ 自動回正）
        tAdopt(r.gameState, r.version, { skipSfx: true });   // v6.048 自己的動作由下一行算音效
        if (!ctx.predicted) {
          try { if (game && game !== ctx.prev) dispatchSfxForAction(ctx.action as any, ctx.prev as any, game as any); } catch { /* sfx best-effort */ }
        }
        ctx.predicted = false;
      } else {
        // 回應沒帶 gameState（伺服器唯一這條：{ error:'對局尚未開始', waiting }）→ 預測畫面回不去，必須自己還原
        _tRestorePrediction(ctx);
      }
      // v5.598 CAS 落敗（setup 雙方同時擺場最常見）⇒ 用**同一個 actId** 立刻重送。
      // ⚠ 沿用同一個 actId 是正確的：若這一發其實沒套用（對手贏了 CAS），重送會正常套用；
      //   若是我自己的兩發並發、其中一發已寫進去，重送會被伺服器認出來回 duplicate。兩種都對。
      // ⚠ 與網路重送**共用同一份 attempt 預算**，不另開一套計數（否則兩套交錯可以繞過上限）。
      if (r.stale && _tActCanRetry(ctx)) { _tActSchedule(ctx, 0); return; }
      // ⭐⭐⭐v6.172（Fable 5 審查抓到）：**只有「這一發真的套用了」才可以放下一個手勢出去。**
      //   伺服器有三種「沒有套用」的回應：`error`（現在不是你能操作的時機／動作無效／對局尚未開始）、
      //   `rejected`（引擎拒絕，盤面沒變）、`stale` 而重送預算已用完（也帶 rejected）。
      //   這三種情況下，排在後面的手勢是**依據一個根本沒有發生的盤面**做出來的 ——
      //   最糟的情形是「自動結束回合」被照送出去（玩家還沒攻擊就換手）。⇒ 一律丟棄並講清楚。
      //   ⚠ `duplicate`（重送被認出來）**不算沒套用**：它代表更早那一發已經生效 ⇒ 照常放行。
      const _applied = !r.error && !r.rejected;
      if (r.error) tError = r.error;
      _tActDone(ctx);
      if (_applied) _tActDrain();   // 這一發真的套用了 ⇒ 放下一個排隊中的手勢出去（嚴格照順序、一次一個）
      else _tActClearQueue('前一個動作沒有被伺服器接受');
    } catch (e: any) {
      if (_actCtx !== ctx) return;
      // ⭐⭐v6.158：401/403 是「身分不被伺服器接受」，跟斷線完全不同 —— 重送幾次都一樣，
      //   而且輪詢會繼續成功（遮蔽關閉時 /state 不驗身分）⇒ 失聯橫幅永遠不會出現。
      if (e && (e.status === 401 || e.status === 403)) {
        _tActionAuthErr = true; _tActionAuthErrAt = Date.now();
        if (!_actionAuthDiagSent) { _actionAuthDiagSent = true; _tSendClientDiag('action-forbidden'); }
        tError = String(e?.message ?? e);
        _tRestorePrediction(ctx); _tActDone(ctx);
        _tActClearQueue('身分沒有被伺服器接受');   // ⭐v6.172 後面那些一定也會被拒，不要一個一個再撞一次
        return;
      }
      if (_tActCanRetry(ctx)) {
        // ⭐⭐⭐ 逾時／斷線 ⇒ **不回滾、不報錯**，排一次自動重送。
        //   冪等鍵保證伺服器不會套用兩次，所以這裡可以放心重送 —— 這就是這一版的重點。
        tError = '';
        _tActSchedule(ctx, Math.min(4000, 600 * Math.pow(2, ctx.attempt - 1)));
        return;
      }
      tError = String(e?.message ?? e);
      _tRestorePrediction(ctx);
      tError = (tError ? tError + '　' : '') + '（已自動重送 ' + ctx.attempt + ' 次仍送不出去，畫面已還原）';
      void tForceResync();   // 第二道保險：若動作其實成功了，這裡會把伺服器新盤面抓回來
      _tActDone(ctx);
      // ⭐⭐v6.172 前一個動作最終失敗、畫面已經還原 ⇒ 排在它後面的手勢是**依據那個已被還原的
      //   盤面**做出來的，照送就變成玩家沒有意圖的動作。一律丟掉並講清楚（不是靜默丟）。
      _tActClearQueue('前一個動作送不出去');
    }
  }
  // ⭐⭐v6.170【B-3 逃生口】停止重送並立刻解鎖 UI。
  // ⚠⚠ 這**不是** undo —— 按下去的那一瞬間，那個動作可能已經在伺服器上生效、只是回應沒回來。
  //   所以文案絕不可以寫「已取消」（玩家會以為沒發生，再做一次 ⇒ 那才是真的送出兩個動作）。
  //   做法：清掉排程與 ctx（在途回應會因 `_actCtx !== ctx` 自動作廢）→ 強制同步 → 伺服器說了算。
  function tActCancel(): void {
    const ctx = _actCtx;
    if (_actRetryTimer) { clearTimeout(_actRetryTimer); _actRetryTimer = null; }
    _actCtx = null; tActRetry = null; tInFlight = false;
    if (ctx) _tRestorePrediction(ctx);
    tError = '已停止重送。這個動作可能已經生效，畫面正在以伺服器為準重新同步。';
    _tActClearQueue('已停止重送');   // ⭐v6.172 前一個動作的結果都不確定了，後面那些不可以照送
    void tForceResync();
  }
  // ⭐⭐v6.170【B-2 恢復偵測】斷流結束的那一刻就重送，不要傻等退避計時器跑完。
  //   `online` 事件與回前景是「網路可能剛回來」最便宜也最準的兩個訊號。
  function _tOnNetRecovered(kickResync: boolean): void {
    if (!isTournament || isTournSpectator) return;
    const ctx = _actCtx;
    if (ctx && _actRetryTimer) { clearTimeout(_actRetryTimer); _actRetryTimer = null; void _tActAttempt(ctx); return; }
    if (!kickResync) return;
    if (tStep !== 'playing' || !tActiveRoom) return;
    if (game && (game as { phase?: string }).phase === 'game-over') return;
    void tForceResync();
  }
  async function tournamentDispatch(action: any) {
    // v6.135 不再靜默 return：tBusy 沒有 template 綁定，按鈕外觀不會變，
    //   玩家在等待往返時連點會完全沒有回饋 ⇒ 體感就是「按下去沒反應」。改為顯性提示。
    if (tInFlight) {
      // ⭐⭐⭐v6.172 這裡以前是「丟掉 ＋ 一行紅字」。現在改成**排隊**：手勢一定被收下，
      //   前一個動作一送完就依序執行。⚠ 仍然 return —— 網路上同時只有一個動作，
      //   這正是「不會重複套用、也不會亂序」的根據，絕不可以為了『順』而拿掉。
      const _sig = _tActSig(action);
      if (_actCtx && _tActSig(_actCtx.action) === _sig) { tActSay('這個動作已經在送出中了，不會重複送出。'); return; }
      if (tActQueue.some((q) => q.sig === _sig)) { tActSay('這個動作已經排在佇列裡了，不會重複送出。'); return; }
      if (tActQueue.length >= TACT_QUEUE_MAX) { tActSay(TACT_BLOCKED_MSG, 5000); return; }
      tActQueue = [...tActQueue, { action, sig: _sig }];
      tActSay('⏳ 已排隊（第 ' + tActQueue.length + ' 個）—— 前一個動作送出後會自動依序執行，不必重按。');
      return;
    }
    tInFlight = true; tError = '';
    // ⚠ ctx 一律用**函式內區域物件**（不是元件層級變數）—— 放元件層級會跨呼叫洩漏：
    //   伺服器有一條 `{ error:'對局尚未開始', waiting }`（房間剛被 reset 的競態）**不帶 gameState**，
    //   不進任何清除點 → 旗標殘留到下一次 dispatch，害下次誤跳音效、誤觸回滾。
    // ⭐v6.180 baseV = 預測當下的伺服器版本（回滾判準，見 _tRestorePrediction）
    const ctx: TActCtx = { action, actId: _newActId(), prev: game, predictedRef: null, predicted: false, attempt: 0, startedAt: Date.now(), baseV: tVersion };
    _actCtx = ctx;
    // v6.137 樂觀更新：先在本地試跑一次，通過所有 gate 才把預測畫面上畫。
    //   fail-closed —— 任何 gate 沒過就維持現行行為（等伺服器），最壞情況與改動前完全相同。
    //   ⚠ 只預測一次：重送時 game 可能已被伺服器盤面覆蓋，那一輪不再重算預測（同 v6.137 的 _retried）。
    if (poolReady) {
      const pr = tryPredictAction(game, action, pool, { allowedTypes: OPTIMISTIC_ACTION_TYPES });
      if (pr.ok) {
        game = pr.predicted;
        // ⚠⚠⚠v6.180（Fable 5 審查抓到，我實跑驗證過）：這裡原本存的是 `pr.predicted`（**原始物件**），
        //   但 `game` 是 Svelte 5 的**深層** `$state` —— 編譯產物是 `$.set(game, pr.predicted, true)`，
        //   第三個參數 `should_proxy=true` 會把值 `proxy()` 成一個**新的 Proxy** 才存進去
        //   （`proxy(raw) !== raw`；已經是 proxy 的則原樣回傳）。
        //   ⇒ 讀回來的 `game` 永遠不等於 `pr.predicted` ⇒ `_tRestorePrediction` 的
        //     `game === ctx.predictedRef` **恆為 false** ⇒ v6.137 那道回滾從上線至今是**死碼**。
        //   後果（玩家看得到）：動作最終送不出去時紅字寫著「畫面已還原」，畫面上卻還留著那個
        //   **伺服器根本沒有套用**的動作；等下一次版本前進（對手動作／看門狗）才被伺服器盤面洗掉
        //   ⇒ 就是「過一下子突然跳回上一步」。存讀回來的那一份才是真的物件同一性。
        ctx.predictedRef = game;
        ctx.predicted = true;
        // 音效在預測當下就播（原本是等伺服器回應才播）；伺服器確認那一次要跳過，避免播兩次。
        try { dispatchSfxForAction(action as any, ctx.prev as any, game as any); } catch { /* sfx best-effort */ }
      }
    }
    await _tActAttempt(ctx);
  }
  async function tournamentReset() {
    if (!confirm('重置測試房？會清空目前對局，雙方需重新選牌組進場。')) return;
    tBusy = true; tError = '';
    try { await tApi('/reset', { room: tActiveRoom, playerId: tPlayerId() }); }
    catch (e: any) { tError = String(e?.message ?? e); }
    finally { tBusy = false; }
    tActAbortAll('房間已重置');   // ⭐v6.172 同 tLeaveMatch
    tPollGen++;   // ⭐v6.180 同 tLeaveMatch：房間重置後，在途的 `v=-1` 回應不可以把舊盤面帶回來
    game = null; tVersion = -1; tStep = 'lobby'; myPlayerIndex = null; mySeatIdx = -1; tActiveRoom = T_ROOM; isTournSpectator = false; isTReplay = false; tReplay = null; tReplayStep = 0;
  }

  async function dispatch(
    action: ReturnType<typeof GameActions[keyof typeof GameActions]>,
    opts: { fromAI?: boolean } = {}
  ) {
    if (!game || !poolReady) return;
    // v2.276 Phase 3：觀戰者所有 action 都被擋（read-only）
    // ⭐v6.197 改問中央述詞 canAct（fail-closed：認不出座位一律當觀戰者）
    if (!canAct) {
      console.log('[Spectator] action blocked:', action.type);
      return;
    }
    if (isTournament) { await tournamentDispatch(action); return; }
    const prevState = game;
    // v5.345：引擎可能 throw（最常見：getCard 找不到卡 — ?卡 / 舊版 id 漏遷移 / 尚未載入的 set），
    //   原本沒有 try/catch → throw 會讓 dispatch 崩潰、玩家點了沒反應 = 整局凍結。改為攔截：
    //   不改 state、不 push（避免把壞狀態同步給對手），並提示玩家（可投降/重整脫困）。
    (globalThis as any).__ptcgLB = { kind: 'dispatch', action: (action as any)?.type, t: Date.now() }; // v5.350 卡頓麵包屑
    let newState: GameState;
    try {
      const _t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
      newState = applyAction(game, action as any, pool);
      const _dt = (typeof performance !== 'undefined') ? performance.now() - _t0 : 0;
      if (_dt >= 300) console.warn('[PTCG] applyAction(' + (action as any)?.type + ') 耗時 ' + Math.round(_dt) + 'ms');
    } catch (err) {
      console.error('[PTCG] applyAction 拋例外，已攔截避免凍結:', action.type, err);
      if (!opts.fromAI) {
        try { alert('這個動作發生錯誤，已略過。若持續卡住，請按「投降」結束本局，或重新整理頁面。'); } catch { /* ignore */ }
      }
      return;
    }
    // Debug：如果 action 被拒絕（state 沒變），印出 state 幫 debug
    if (newState === game) {
      console.warn('[PTCG] action 被 engine 拒絕:', action.type, {
        action,
        phase: game.phase,
        turnPhase: game.turnPhase,
        activePlayer: game.activePlayerIndex,
        pendingSelection: game.pendingSelection?.type,
        pendingPrizes: game.pendingPrizes,
        myPlayerIndex,
        isFirstTurn: game.isFirstTurn,
      });
    }
    // v4.74 + v4.75 練習模式：在「人類玩家主要 action」前 snapshot 1 步
    //   - opts.fromAI=true 跳過（AI 自己的 action 不存 snapshot）
    //   - END_TURN 清空（不能跨手悔棋）
    //   - AI 對戰（v4.74）：mode !== 'online' && aiPlayerIndex !== null
    //   - 連線練習房（v4.75）：mode === 'online' && roomData?.allowUndo === true && 我是 P1/P2
    //   - 本機 2P 不支援
    if (!opts.fromAI && newState !== prevState) {
      const undoModeOn = (mode !== 'online' && aiPlayerIndex !== null)
        || (mode === 'online' && roomData?.allowUndo === true && mySeatIdx >= 0 && mySeatIdx <= 1);
      if (undoModeOn) {
        if (action.type === 'END_TURN') {
          undoSnapshot = null;
          undoActionDesc = null;
          undoDeniedThisSnapshot = false;
        } else if (UNDOABLE_ACTIONS.has(action.type)) {
          undoSnapshot = prevState;
          undoActionDesc = describeUndoAction(action, prevState, pool);
          undoDeniedThisSnapshot = false;  // 新 snapshot 重置 denied flag
        }
      }
    }
    game = newState;
    floatingEvoMenu = null; floatingRetreatMenu = null; selectedEnergyIid = null;

    // 視覺回饋
    if (action.type === 'ATTACH_ENERGY') triggerEnergyPulse(action.targetIid);

    // v2.118 音效：action-based（state-diff 類在 $effect 觸發）
    if (newState !== prevState) {
      dispatchSfxForAction(action, prevState, newState);
    }

    // v3.34 Fix #1：action 被 engine 拒絕（state 完全沒變）→ 不需 push，
    //   否則會把同樣 state 推回 firestore、bump updatedAt 又夾在對手剛 push 的中間。
    // v3.34 Fix #2：線上模式下，僅當「我是此 action 的合法 actor」才 push；
    //   actor 認定 = pendingSelection.actorIdx === myPlayerIndex
    //   或無 pending 時 activePlayerIndex === myPlayerIndex
    //   或我是被擊倒方需補場（dIdx + active===null）。
    //   防止對手回合中 UI race / 觀戰位點到隱藏按鈕 / pendingPrize owner 寫入時
    //   把對方權威 state 覆蓋。pendingPrize 由 owner 取（與 activePlayer 無關），
    //   故額外允許 pendingPrizes[myPlayerIndex] > 0 時推送。
    if (newState !== prevState && mode === 'online' && roomCode) {
      const canIPush = (() => {
        if (myPlayerIndex === null) return false; // 觀戰位永遠不推
        // v3.39 Fix：setup 階段雙方各自擺自己側，都需要 push（per-player merge 防互覆）。
        //   原本 gate 只在 prevState.activePlayerIndex===myPlayerIndex 才放行 push，
        //   但 setup 階段 activePlayerIndex 是固定 firstPlayerIdx → 後手 dispatch 全被擋，
        //   導致先攻方收不到後手擺放、自己擺完後 push 又把後手擺放從 echo 倒退掉。
        if (prevState.phase === 'setup') return true;
        if (newState.pendingSelection) {
          // 既有 selection 由其 actor 推；我消化完 (newState 的 pending 變了/消失) 也算我推
          if (prevState.pendingSelection?.actorIdx === myPlayerIndex) return true;
          if (newState.pendingSelection.actorIdx === myPlayerIndex) return true;
          // v3.822 fix：A 動作觸發給 B 的 pending（例：A 蓋掉 B 的零之大空洞 → enforceBenchLimit
          //   設 pending 給 B 棄備戰）— 原邏輯只看 actor === me 會讓 A 不 push → B 永遠收不到
          //   → 雙方卡死。修法：prevState 沒 pending 時，我是發動者（active player）就該推，
          //   把這個對手向 pending 同步出去。
          if (!prevState.pendingSelection && prevState.activePlayerIndex === myPlayerIndex) return true;
          // 防守方補場觸發的 pending（自己被擊倒後送新 active，過程中可能觸發給對手的 pending）
          if (!prevState.pendingSelection
              && prevState.players[myPlayerIndex].active === null
              && prevState.phase === 'playing') return true;
          // 取獎賞觸發的 pending（自身獎賞 + side effect 給對手的 pending）
          if (!prevState.pendingSelection
              && (prevState.pendingPrizes?.[myPlayerIndex] ?? 0) > 0) return true;
          return false;
        }
        if (prevState.pendingSelection) {
          // 剛消化完別人的 selection？理論上不會（actor gate），保險：只有自己才放行
          return prevState.pendingSelection.actorIdx === myPlayerIndex;
        }
        // 取獎賞（pendingPrize owner）
        if ((prevState.pendingPrizes?.[myPlayerIndex] ?? 0) > 0) return true;
        // 防守方補場
        if (prevState.players[myPlayerIndex].active === null
            && prevState.phase === 'playing') return true;
        // 一般情況：當前活動玩家
        return prevState.activePlayerIndex === myPlayerIndex;
      })();
      if (canIPush) {
        isSyncing = true;
        try { await pushWithRetry(roomCode, newState); }
        finally { isSyncing = false; }
      } else {
        console.warn('[Online] dispatch suppressed push (not my turn / actor mismatch):',
          action.type, { myPlayerIndex,
                         active: prevState.activePlayerIndex,
                         pendingActor: prevState.pendingSelection?.actorIdx });
      }
    }
  }

  // ── 招式宣告：若需要丟能量選擇則開 modal，否則直接派送 ─────────────────────
  // v2.214：用 getEffectiveAttacks 取招式（含工具上寫的招式 — 招式學習器 螢石 等）
  //   - tool 招式的 effectKey 用 tool 名做 key（與 engine 一致）
  function initiateAttack(attackIndex: number) {
    if (!game || !activePlayer?.active) return;
    if (!canAct) return;   // ⭐v6.197 觀戰／認不出座位：連本地的 copy-attack 選單都不開
    const eff = getEffectiveAttacks(game, activePlayer.active, pool);
    const entry = eff[attackIndex];
    if (!entry) return;
    const { atk, sourceCardName } = entry;
    // v2.119 copy-attack intercept：暗黑底牌 要先讓玩家選備戰 N的寶可夢 + 招式
    if (atk.name === '暗黑底牌') {
      const candidates = activePlayer.bench
        .map(b => ({ inst: b, card: getCard(b.cardId) }))
        .filter(x => x.card?.name?.startsWith('N的') && (x.card?.attacks?.length ?? 0) > 0);
      if (candidates.length === 0) {
        dispatch(GameActions.attack(attackIndex));  // 沒目標就讓 engine 自己出錯 log
        return;
      }
      copyAttackPicker = { sourceAttackIndex: attackIndex, candidates };
      return;
    }
    // v3.873 扮晶晶酒 intercept：對手戰鬥場若為太晶寶可夢，讓玩家挑要扮演哪個招式
    //   解決：之前自動挑最高傷害 → 啜泣（20）永遠用不到 + 激流水泵 picker 不開
    if (atk.name === '扮晶晶酒') {
      if (!game) return;
      const opp = game.players[1 - myIdx];
      const oppActive = opp.active;
      const oppCard = oppActive ? getCard(oppActive.cardId) : undefined;
      // 目標必為對手戰鬥場「太晶」寶可夢；無目標 / 非太晶 → 讓 engine 出 log
      if (!oppActive || !oppCard || !(oppCard.tags ?? []).includes('太晶') || (oppCard.attacks?.length ?? 0) === 0) {
        dispatch(GameActions.attack(attackIndex));
        return;
      }
      personateAttackPicker = {
        sourceAttackIndex: attackIndex,
        oppPoke: { inst: oppActive, card: oppCard },
      };
      return;
    }
    // v3.895 耀閃挑戰 intercept：peek 自己牌庫頂，若該卡為寶可夢（非規則）且有 2+ 招式 → 開 picker 讓玩家選
    //   - 1 招 → 自動填 copyAttackChoice (attackIndex=0)，不彈 picker（避免單一選項浪費 UX）
    //   - 牌庫空 / 非寶可夢 / 規則寶可夢 / 0 招 → 直接 dispatch（engine 自己會 fail log）
    //   - 2+ 招 → 開 brightChallengePicker（卡面：「選擇 1 個那隻寶可夢持有的招式，作為這個招式使用」）
    if (atk.name === '耀閃挑戰') {
      if (!game) return;
      const myDeck = game.players[myIdx].deck;
      const topInst = myDeck[0];
      if (!topInst) {
        dispatch(GameActions.attack(attackIndex));
        return;
      }
      const topCard = getCard(topInst.cardId);
      const isPokemon = topCard?.supertype === 'Pokemon';
      const isRule = topCard ? (RULE_BOX_SUBTYPES.has(topCard.subtype ?? '')) : false;
      const atks = topCard?.attacks ?? [];
      if (!isPokemon || isRule || atks.length === 0) {
        dispatch(GameActions.attack(attackIndex));
        return;
      }
      if (atks.length === 1) {
        // v5.992 單招也走 dispatchBorrowedAttack — 被借招式有 PRE_DISCARD_CHOICE(若希望)時開 modal
        dispatchBorrowedAttack(attackIndex, topInst.iid, 0, topCard);
        return;
      }
      // 2+ 招 → 開 picker
      brightChallengePicker = {
        sourceAttackIndex: attackIndex,
        topPoke: { inst: topInst, card: topCard! },
      };
      return;
    }
    // v5.178 皮可西|揮指 / 阿響的樹才怪|試著模仿 intercept：開 picker 讓玩家選對手戰鬥場招式
    //   reuse rocketCommandPicker UI（pokeList = [對手戰鬥場 1 寶可夢]）
    //   試著模仿擲幣後正面才用 choice，反面 0 傷害 (玩家選了但浪費)
    if ((atk.name === '揮指' && sourceCardName === '皮可西') ||
        (atk.name === '試著模仿' && sourceCardName === '阿響的樹才怪') ||
        (atk.name === '欺詐' && sourceCardName === '索羅亞克')) {
      if (!game) return;
      const oppActive = game.players[1 - myIdx].active;
      if (!oppActive) {
        dispatch(GameActions.attack(attackIndex));
        return;
      }
      const oppCard = getCard(oppActive.cardId);
      const oppAttacks = (oppCard?.attacks ?? []).filter(a => a.name && a.name !== atk.name);
      if (oppAttacks.length === 0) {
        dispatch(GameActions.attack(attackIndex));
        return;
      }
      if (oppAttacks.length === 1) {
        const idx = oppCard!.attacks!.findIndex(a => a.name === oppAttacks[0].name);
        // v5.992 單招也走 dispatchBorrowedAttack — 忍者飛旋等「若希望」選擇不再被 fast-path 吃掉
        dispatchBorrowedAttack(attackIndex, oppActive.iid, idx, oppCard);
        return;
      }
      // v5.181：sourceAttackName 動態, modal hint 不再顯示「高傲指令」
      rocketCommandPicker = {
        sourceAttackIndex: attackIndex,
        pokeList: [{ inst: oppActive, card: oppCard! }],
        top10All: [{ inst: oppActive, card: oppCard! }],
        revealOnly: false,
        sourceAttackName: atk.name,
      };
      return;
    }
    // v5.468 狐大盜|技能大盜 intercept：手牌=0 時複製對手場上(active+備戰)任一寶可夢的招式。
    //   原本無 intercept → engine 自動挑印刷最高傷害(簡易)；完整版讓玩家選要複製哪招(reuse rocketCommandPicker)。
    if (atk.name === '技能大盜') {
      if (!game) return;
      // 手牌須=0(engine gate)；>0 直接 dispatch 讓 engine fail log
      if (game.players[myIdx].hand.length > 0) { dispatch(GameActions.attack(attackIndex)); return; }
      const opp = game.players[1 - myIdx];
      const pokeList = [
        ...(opp.active ? [{ inst: opp.active, card: getCard(opp.active.cardId) }] : []),
        ...opp.bench.map(b => ({ inst: b, card: getCard(b.cardId) })),
      ].filter(x => x.card?.supertype === 'Pokemon' && (x.card?.attacks?.length ?? 0) > 0) as Array<{ inst: CardInstance; card: Card }>;
      if (pokeList.length === 0) { dispatch(GameActions.attack(attackIndex)); return; }
      if (pokeList.length === 1 && (pokeList[0].card.attacks?.length ?? 0) === 1) {
        dispatchBorrowedAttack(attackIndex, pokeList[0].inst.iid, 0, pokeList[0].card); // v5.992 單選也帶出「若希望」modal
        return;
      }
      rocketCommandPicker = {
        sourceAttackIndex: attackIndex,
        pokeList,
        top10All: pokeList,
        revealOnly: false,
        sourceAttackName: '技能大盜',
      };
      return;
    }
    // v4.39 火箭隊的貓老大ex|高傲指令 intercept：peek 對手牌庫頂 10 張 → 列寶可夢的招式讓玩家選
    //   - 0 寶可夢 → 直接 dispatch（engine PRE 出 fail log）
    //   - 1 寶可夢 1 招 → 自動帶 copyAttackChoice（避免單一選項浪費 UX）
    //   - 多選項 → 開 rocketCommandPicker（含「不複製」skip 按鈕，符合「若希望」）
    if (atk.name === '高傲指令' && sourceCardName === '火箭隊的貓老大ex') {
      if (!game) return;
      const oppDeck = game.players[1 - myIdx].deck;
      const top10 = oppDeck.slice(0, 10);
      const pokeList = top10
        .map(inst => ({ inst, card: getCard(inst.cardId) }))
        .filter(x => x.card?.supertype === 'Pokemon' && (x.card?.attacks?.length ?? 0) > 0) as Array<{ inst: CardInstance; card: Card }>;
      // v5.174：top10 全 10 張 (含非寶可夢) 給 modal 揭示用 — 參考寶可裝置3.0「公開揭示」精神
      const top10All = top10.map(inst => ({ inst, card: getCard(inst.cardId) })).filter(x => x.card) as Array<{ inst: CardInstance; card: Card }>;
      if (pokeList.length === 0) {
        rocketCommandPicker = {
          sourceAttackIndex: attackIndex,
          pokeList: [],
          top10All,
          revealOnly: true,
          sourceAttackName: '高傲指令',
        };
        return;
      }
      if (pokeList.length === 1 && (pokeList[0].card.attacks?.length ?? 0) === 1) {
        dispatchBorrowedAttack(attackIndex, pokeList[0].inst.iid, 0, pokeList[0].card); // v5.992 單選也帶出「若希望」modal
        return;
      }
      rocketCommandPicker = {
        sourceAttackIndex: attackIndex,
        pokeList,
        top10All,
        revealOnly: false,
        sourceAttackName: '高傲指令',
      };
      return;
    }
    const key = `${sourceCardName}|${atk.name}`;
    const spec = ATTACK_PRE_DISCARD_CHOICE.get(key);
    if (!spec) {
      dispatch(GameActions.attack(attackIndex));
      return;
    }
    // v3.875：激流水泵 picker 用「全有或全無」UX — 偵測 璀璨結晶 → required = 2，否則 3
    const exactRequired = _computeExactRequired(atk.name, activePlayer.active);
    preAttackDiscard = {
      attackIndex,
      spec,
      attackName: atk.name,
      picked: new Set<string>(),
      exactRequired,
    };
  }

  // v3.875：計算「啟用 option 所需精確放回數」— 目前只 激流水泵 用
  //   厄鬼椪 水井面具ex（太晶）+ 璀璨結晶 → 2；否則 3
  //   非 激流水泵 → undefined（picker 走原邏輯）
  function _computeExactRequired(attackName: string, att: CardInstance | null): number | undefined {
    if (!att) return undefined;
    if (attackName === '激流水泵') {
      const card = getCard(att.cardId);
      const isTera = card?.tags?.includes('太晶') ?? false;
      if (!isTera) return 3;
      const allTools = [att.toolAttached, ...(att.extraTools ?? [])].filter(Boolean) as CardInstance[];
      const hasShinyCrystal = allTools.some(t => getCard(t.cardId)?.name === '璀璨結晶');
      return hasShinyCrystal ? 2 : 3;
    }
    // v5.992：忍者飛旋 / 災難衝擊 改走 spec.optInPay 一般化二段流程（binary-yes-no），
    //   不再由此處 hardcode exactRequired。
    return undefined;
  }

  // v2.119 copy-attack picker（目前僅用於 N的索羅亞克ex｜暗黑底牌）
  let copyAttackPicker = $state<{
    sourceAttackIndex: number;
    candidates: Array<{ inst: CardInstance; card: Card | undefined }>;
  } | null>(null);
  // v5.721：copy-attack 借招式統一 dispatch（收斂 4 個 picker）——被借招式有 PRE_DISCARD_CHOICE
  //   （「若希望」binary-yes-no / 能量 picker）時開 preAttackDiscard 帶 copyAttackChoice 讓玩家選；
  //   否則直接 dispatch。原本只有耀閃挑戰 / 扮晶晶酒各自實作此處理，高傲指令系列（揮指 / 欺詐 /
  //   試著模仿 / 技能大盜）與暗黑底牌「漏」→ 借金屬之錘等「若希望」招式時玩家無法選不希望（v5.720
  //   只修了引擎端 sentinel，前端沒開 modal 仍走 fallback）。
  function dispatchBorrowedAttack(srcAttackIndex: number, pokeIid: string, attackIndex: number, borrowedCard: Card | undefined) {
    const pickedAtk = borrowedCard?.attacks?.[attackIndex];
    if (borrowedCard && pickedAtk) {
      const borrowedKey = `${borrowedCard.name}|${pickedAtk.name}`;
      const spec = ATTACK_PRE_DISCARD_CHOICE.get(borrowedKey);
      if (spec) {
        const borrowerActive = game?.players[myIdx].active ?? null;
        const exactRequired = _computeExactRequired(pickedAtk.name, borrowerActive);
        preAttackDiscard = {
          attackIndex: srcAttackIndex, spec, attackName: pickedAtk.name,
          picked: new Set<string>(), copyAttackChoice: { pokeIid, attackIndex }, exactRequired,
        };
        return;
      }
    }
    dispatch(GameActions.attack(srcAttackIndex, undefined, { pokeIid, attackIndex }));
  }
  function resolveCopyAttack(pokeIid: string, attackIndex: number) {
    if (!copyAttackPicker) return;
    const src = copyAttackPicker.sourceAttackIndex;
    const card = copyAttackPicker.candidates.find(c => c.inst.iid === pokeIid)?.card; // v5.721 borrowed card
    copyAttackPicker = null;
    dispatchBorrowedAttack(src, pokeIid, attackIndex, card);
  }
  function cancelCopyAttack() { copyAttackPicker = null; }

  // v3.873 扮晶晶酒 picker：玩家挑對手戰鬥場太晶寶可夢的招式
  //   - 啜泣 → 直接 dispatch（無 PRE_DISCARD_CHOICE）
  //   - 激流水泵 → 接 preAttackDiscard 開能量 picker（min=0/max=3，可選 0 = 不希望使用 option / 選 3 = 希望使用 option）
  let personateAttackPicker = $state<{
    sourceAttackIndex: number;
    oppPoke: { inst: CardInstance; card: Card };
  } | null>(null);
  function resolvePersonateAttack(pokeIid: string, attackIndex: number) {
    if (!personateAttackPicker) return;
    const src = personateAttackPicker.sourceAttackIndex;
    const oppPoke = personateAttackPicker.oppPoke;
    personateAttackPicker = null;
    dispatchBorrowedAttack(src, pokeIid, attackIndex, oppPoke.card); // v5.721 收斂
  }
  function cancelPersonateAttack() { personateAttackPicker = null; }

  // v3.895 耀閃挑戰 picker：peek 自己牌庫頂的寶可夢，列出該卡的所有招式讓玩家挑
  //   topPoke.inst 是 myDeck[0]（尚未丟棄；UI 為了開 picker 必須提前知道 — 連線對戰時對手看不到 deck 順序，無資訊洩漏問題）
  //   玩家選定後 dispatch GameActions.attack 帶 copyAttackChoice { pokeIid, attackIndex } —
  //     regPre 內驗證 pokeIid === deck[0].iid，mismatch 時 fallback 自動挑印刷最高
  let brightChallengePicker = $state<{
    sourceAttackIndex: number;
    topPoke: { inst: CardInstance; card: Card };
  } | null>(null);
  function resolveBrightChallenge(pokeIid: string, attackIndex: number) {
    if (!brightChallengePicker) return;
    const src = brightChallengePicker.sourceAttackIndex;
    const topPoke = brightChallengePicker.topPoke;
    brightChallengePicker = null;
    // v4.47 P1：仿 resolvePersonateAttack — 借來的招式若有 PRE_DISCARD_CHOICE，
    //   先開 preAttackDiscard（傳 copyAttackChoice）讓玩家選能量。
    //   呆呆王不能借規則寶可夢的招式（RULE_BOX_SUBTYPES filter 已守住），
    //   所以實際影響的招式有限（多數 picker 招式都在 ex/規則 上）。
    //   但保留 general-purpose fix 以防將來新增非規則寶可夢的 picker 招式。
    dispatchBorrowedAttack(src, pokeIid, attackIndex, topPoke.card); // v5.721 收斂
  }
  function cancelBrightChallenge() { brightChallengePicker = null; }

  // v4.39 火箭隊的貓老大ex|高傲指令 picker：對手牌庫頂 10 張寶可夢的招式
  //   pokeList = top10 中有招式的寶可夢清單（攻擊方可看見 — 卡面「翻到正面」）
  //   resolveRocketCommand → dispatch ATTACK 帶 copyAttackChoice {pokeIid, attackIndex}
  //   skipRocketCommand → dispatch 帶 skip sentinel（不複製，傷害 0，符合「若希望」）
  //   cancelRocketCommand → 關 picker 不 dispatch（玩家可改用其他招式）
  let rocketCommandPicker = $state<{
    sourceAttackIndex: number;
    pokeList: Array<{ inst: CardInstance; card: Card }>;
    // v5.174：top10All = 對手牌庫頂 10 張全部（含非寶可夢），revealOnly=true 時 modal 改純揭示
    top10All?: Array<{ inst: CardInstance; card: Card }>;
    revealOnly?: boolean;
    // v5.181：sourceAttackName — 揮指/試著模仿/高傲指令 共用 modal, hint 動態
    sourceAttackName?: string;
  } | null>(null);
  function resolveRocketCommand(pokeIid: string, attackIndex: number) {
    if (!rocketCommandPicker) return;
    const src = rocketCommandPicker.sourceAttackIndex;
    const card = rocketCommandPicker.pokeList.find(pk => pk.inst.iid === pokeIid)?.card; // v5.721 borrowed card
    rocketCommandPicker = null;
    dispatchBorrowedAttack(src, pokeIid, attackIndex, card);
  }
  function skipRocketCommand() {
    if (!rocketCommandPicker) return;
    const src = rocketCommandPicker.sourceAttackIndex;
    rocketCommandPicker = null;
    dispatch(GameActions.attack(src, undefined, { pokeIid: '__rocket_command_skip__', attackIndex: -1 }));
  }
  function cancelRocketCommand() { rocketCommandPicker = null; }

  // v3.900 回合切換 banner：每次 game.activePlayerIndex 變化時，全螢幕中央彈 1.5s 大字
  //   - text='你的回合' if new active === myIdx else '對手回合'
  //   - 本機 2P 下 myIdx 跟著 activePlayerIndex 切 → 永遠「你的回合」（從新操作者視角，直覺正確）
  //   - 連線 / AI 下 myIdx 固定 → 對手 END_TURN 時顯示「你的回合」、自己 END_TURN 時顯示「對手回合」
  //   - 用普通 let 變數 _prevTurnPlayerIdx 當 prev tracker（不在 $state，不 trigger reactivity）
  // v6.022 通知：設定開關 / 首次詢問視窗 / iOS 安裝引導
  let notifyEnabled = $state(false);
  let notifyPerm = $state<'granted' | 'denied' | 'default'>('default');
  let showNotifyPrompt = $state(false);
  let notifyIOSNeedsInstall = $state(false);
  let _notifyPromptChecked = false;
  // v6.024 診斷：測試通知結果 + 目前卡在哪一關（免開發者工具）
  let notifyTestMsg = $state<{ ok: boolean; hint: string } | null>(null);
  let notifyDiag = $state<{ supported: boolean; permission: string; enabled: boolean; swRegistered: boolean; pushSubscribed: boolean; iosNeedsInstall: boolean;
                            serverRegistered: boolean; serverStage: string; serverDetail: string; pushHost: string } | null>(null);
  // v6.026：伺服器端推播自測結果（由伺服器真的推一則回來，能分清「訂閱沒登記」與「推播送不出」）
  let pushSelfTestMsg = $state<{ ok: boolean; text: string } | null>(null);
  // v6.035 社群賽開辦通知偏好（真正生效處在伺服器，這裡只是 UI 狀態）
  let notifyCommunity = $state(true);
  let pushSelfTestBusy = $state(false);
  async function refreshNotifyDiag() { try { notifyDiag = await getNotifyDiagnostics(); } catch { notifyDiag = null; } }
  async function runNotifyTest() {
    notifyTestMsg = null;
    const r = await sendTestNotification();
    notifyTestMsg = { ok: r.ok, hint: r.hint };
    await refreshNotifyDiag();
  }
  // ══ v6.032 通知設定搬到錦標賽大廳「🪪 個人資料」分頁 ═══════════════════════
  // 把六個 boolean 收斂成單一「玩家看得懂」的整體狀態。順序有意義：
  //   ios 必須排在 unsupported 之前 —— iPhone 未加入主畫面時 Notification API 根本不存在，
  //   diag.supported 也會是 false，先判 unsupported 會讓 iOS 使用者看到「換瀏覽器」的錯誤指引。
  // 'server-missing' = 本機訂閱成功但伺服器沒登記到 → 關掉分頁/App 就收不到報到與進場推播，
  //   這是最需要被看見的異常（v6.026 的事故就是這個狀態被靜默吞掉）。
  const notifyOverall = $derived.by<'ios' | 'unsupported' | 'blocked' | 'off' | 'server-missing' | 'on'>(() => {
    if (notifyIOSNeedsInstall) return 'ios';
    if (notifyDiag && !notifyDiag.supported) return 'unsupported';
    if (notifyPerm === 'denied') return 'blocked';
    if (!notifyEnabled) return 'off';
    if (notifyDiag && notifyDiag.pushSubscribed && !notifyDiag.serverRegistered) return 'server-missing';
    return 'on';
  });
  const NOTIFY_BADGE: Record<string, string> = {
    ios: '需安裝', unsupported: '不支援', blocked: '被封鎖', off: '未開啟', 'server-missing': '⚠ 連線異常', on: '運作中',
  };
  /** 開關邏輯抽成具名函式：大廳的完整卡片與設定視窗保留的最小開關共用同一份，不會漂移。 */
  async function onNotifyToggle(want: boolean) {
    if (want && notifyPerm !== 'granted') { notifyPerm = await requestNotifyPermission(); }
    notifyEnabled = want && getNotifyPermission() === 'granted';
    saveNotifyEnabled(notifyEnabled);
    notifyPerm = getNotifyPermission();
    if (notifyEnabled) void (async () => { const r = await subscribePush(tApi); if (r.ok) _pushSubDone = true; await refreshNotifyDiag(); })();
    else { _pushSubDone = false; void unsubscribePush(tApi); void refreshNotifyDiag(); }
  }

  // v6.032 測試結果訊息自動退場（Wilson：訊息會一直留在畫面上很礙眼）
  //   ・成功訊息 8 秒後自動消失 —— 玩家只需要知道「有通」，留著就是視覺垃圾。
  //   ・失敗訊息**不自動消失** —— 那是要照著做（開權限／裝 PWA）或截圖給管理員的排查資訊，
  //     自動消失反而會讓人以為問題自己好了；改成訊息旁邊給一顆 ✕ 手動關掉。
  //   ・timer 生命週期全交給 $effect 的 cleanup：重複點擊時 msg 換成新物件 → effect 重跑前
  //     先執行 cleanup 清掉舊 timer（計時從最新訊息重算）；元件卸載時也會執行 cleanup。
  //     兩條洩漏路徑都封死，不必手動維護 clearTimeout。
  $effect(() => {
    const m = notifyTestMsg;
    if (!m || !m.ok) return;
    const t = setTimeout(() => { notifyTestMsg = null; }, 8000);
    return () => clearTimeout(t);
  });
  $effect(() => {
    const m = pushSelfTestMsg;
    if (!m || !m.ok) return;
    const t = setTimeout(() => { pushSelfTestMsg = null; }, 8000);
    return () => clearTimeout(t);
  });

  // v6.026：先確保訂閱真的登記到伺服器（會回報卡在哪一關），再請伺服器實際推一則回來。
  //   這是唯一能分清「本機通知沒問題但伺服器根本沒有我的訂閱」與「有訂閱但推播送不到」的方法。
  async function runPushSelfTest() {
    if (pushSelfTestBusy) return;
    pushSelfTestBusy = true; pushSelfTestMsg = null;
    try {
      const sub = await subscribePush(tApi);
      if (!sub.ok) {
        pushSelfTestMsg = { ok: false, text: '訂閱未能登記到伺服器：' + describePushStage(sub.stage) + (sub.detail ? '（' + sub.detail + '）' : '') };
        await refreshNotifyDiag();
        return;
      }
      const r = await tApi('/push/selftest', { ping: 1 }) as { ok?: boolean; sent?: number; results?: { host: string; code: number; err?: string }[] };
      const rs = r?.results ?? [];
      if (!rs.length) pushSelfTestMsg = { ok: false, text: '伺服器上找不到你的推播訂閱（請確認已登入同一組帳號）。' };
      else pushSelfTestMsg = { ok: rs.some((x) => x.code >= 200 && x.code < 300),
        text: '伺服器已送出 ' + rs.length + ' 則：' + rs.map((x) => x.host + ' → ' + x.code + (x.err ? ' ' + x.err : '')).join('；')
              + '。若代碼是 2xx 卻沒跳出通知，請把本 App 完全關閉再重開（更新背景服務）後再試一次。' };
    } catch (e) {
      pushSelfTestMsg = { ok: false, text: '測試失敗：' + String((e as Error)?.message ?? e).slice(0, 160) };
    } finally {
      pushSelfTestBusy = false;
      await refreshNotifyDiag();
    }
  }
  onMount(() => {
    notifyEnabled = getNotifyEnabled();
    notifyCommunity = getNotifyCommunity();
    notifyPerm = getNotifyPermission();
    notifyIOSNeedsInstall = isIOSNeedsInstall();
    initNotifyNav((url) => { try { if (!location.href.startsWith(url)) goto(url); } catch { /* 導頁失敗不影響對戰 */ } });
  });
  // 首次進錦標賽大廳時詢問一次（Wilson 決策：不是一進站、也不是報名時）
  $effect(() => {
    if (isTournament && !_notifyPromptChecked) {
      _notifyPromptChecked = true;
      if (shouldPromptOnLobby()) showNotifyPrompt = true;
      // v6.024：iOS Safari 未安裝成 PWA 時 Notification API 不存在 → 原本整個跳過，玩家什麼提示都沒有。
      //   改為照樣顯示視窗，但內容換成「加入主畫面」引導（isIOSNeedsInstall 時模板會顯示該段）。
      else if (isIOSNeedsInstall() && !hasPrompted()) { showNotifyPrompt = true; }
    }
  });
  // v6.026 真根因修正：補訂閱原本掛在上面那個一次性 $effect 的 else-if 分支，
  //   但它在頁面 mount 後幾毫秒就跑完，而 Firebase 登入狀態是**非同步**從 IndexedDB 還原的
  //   → 那一刻 firebaseUser 還是 null → tApi 不帶 Authorization → /push/subscribe 回 401
  //   → subscribePush 靜默失敗，伺服器上一筆訂閱都沒有。
  //   但瀏覽器端的 pushManager.subscribe() 已經成功，診斷面板顯示「推播訂閱 ✅」＝假綠燈，
  //   於是「測試通知有、報到推播沒有」。（測試通知是純本機，不經伺服器。）
  //   修法：獨立成依賴 firebaseUser 的 $effect，登入就緒才登記；失敗不設 guard，下次狀態變動再試。
  let _pushSubDone = $state(false);
  $effect(() => {
    const u = firebaseUser;
    if (!isTournament || _pushSubDone || !u || u.isAnonymous) return;
    if (!getNotifyEnabled() || getNotifyPermission() !== 'granted') return;
    void (async () => { const r = await subscribePush(tApi); if (r.ok) _pushSubDone = true; })();
  });
  async function notifyPromptAccept() {
    showNotifyPrompt = false;
    notifyPerm = await requestNotifyPermission();
    notifyEnabled = getNotifyEnabled();
    // v6.023：同時訂閱 Web Push（分頁關閉/iOS 凍結時仍收得到報到與進場通知）
    // v6.026：立即試一次；若此刻登入尚未就緒而失敗，上面依賴 firebaseUser 的 $effect 會補做。
    if (notifyEnabled) void (async () => { const r = await subscribePush(tApi); if (r.ok) _pushSubDone = true; })();
  }
  function notifyPromptDecline() { showNotifyPrompt = false; markPrompted(true); }

  let turnBanner = $state<{ text: string; timestamp: number } | null>(null);
  let _prevTurnPlayerIdx = -1;
  $effect(() => {
    if (!game) { _prevTurnPlayerIdx = -1; return; }
    const newIdx = game.activePlayerIndex;
    if (_prevTurnPlayerIdx !== -1 && _prevTurnPlayerIdx !== newIdx) {
      // 真正的回合切換
      const isMine = newIdx === myIdx;
      const text = isMine ? '你的回合' : '對手回合';
      const ts = Date.now();
      turnBanner = { text, timestamp: ts };
      // v3.91：播放回合切換音效（清亮上行三音 C5→E5→G5）
      // v6.048：回放模式不播 —— 逐步導覽時每按一次「下一步」幾乎都會跨半回合，
      //   會變成一直嗶。回放要的是看盤面，不是重播音效。
      if (!isTReplay) playSfx('turn-start');
      // ⭐⭐⭐v6.185 這裡**不再**發通知。原本 v6.022 的 notifyTurn 掛在這個
      //   「activePlayerIndex 改變」的 edge 上 —— 而昏厥補位（SEND_NEW_ACTIVE）、
      //   對手效果要我做選擇、開局階段、取獎賞卡**都不會改 activePlayerIndex**，
      //   所以那些「輪到我要操作」的時機從來沒有通知過（站長回報的缺口）。
      //   通知已收斂到下面那個 level 掃描的 $effect，單一述詞「不需要操作 → 需要操作」。
      setTimeout(() => {
        // 1.5s 後若仍是同一次顯示 → 清掉（避免 race：若中途又切回合，新 banner 蓋掉舊的）
        if (turnBanner?.timestamp === ts) turnBanner = null;
      }, 1500);
    }
    _prevTurnPlayerIdx = newIdx;
  });

  // ⭐⭐⭐ v6.185 「輪到我需要操作」通知 —— 全站唯一發送點（level 掃描，不是 edge）。
  //
  //   每次盤面落地都算一次「我現在需不需要操作」，把結果交給 notify-core 的單一述詞
  //   decideActNotify：**從「不需要操作」變成「需要操作」才響**。
  //   ⇒ 補位（SEND_NEW_ACTIVE）、對手效果要我做選擇、取獎賞卡、開局階段全部涵蓋，
  //     而「補位完成後馬上輪到我」因為中間沒有出現過「不需要操作」⇒ 不會再響第二次；
  //     「補位完成後對手還有動作、之後才輪到我」中間會觀察到一次「不需要操作」⇒ 照響。
  //
  // ⚠ 誰該動作**只問 tCurrentActorSeat**（與伺服器 currentActorSeat 逐行同步的那一份），
  //   這裡絕不自己再拄一份條件 —— 否則就是第二份判準，必然漂移。
  // ⚠ need 為 null 時也**必須**呼叫 notifyAct：「需求消失」是讓下一段需求能重新響的訊號。
  // ⚠ 觀戰／回放／非錦標賽對戰不發（觀戰者沒有座位，回放是歷史盤面）。
  $effect(() => {
    const g = game;
    const room = String(tActiveRoom || '');
    const inBattle = isTournament && !isTournSpectator && !isTReplay && tStep === 'playing' && !!room && myPlayerIndex !== null;
    // ⚠ 離開對戰（回大廳/換房/改觀戰）一定要清掉鏈式狀態 —— 殘留的 prevKey 會讓
    //   下一場的第一個需求被誤判成「同一串的延續」而只靜默更新 ⇒ 那就是漏響。
    if (!inBattle) { resetActNotify(); return; }
    const seat = g ? tCurrentActorSeat(g) : null;
    notifyAct(room, buildActNeed(g as any, myPlayerIndex as 0 | 1, seat, room));
  });

  // 取得「可被挑選丟棄」的卡片清單（依 scope 決定範圍）
  // v2.143 擴展：scope='hand-rocket-supporter' 時返回手牌中「火箭隊」支援者
  //   返回項目仍用 hostInst 結構但 hostInst = activePlayer.active（佔位，UI 不會顯示來源）
  //   ownerName 顯示卡名（讓玩家看清楚要丟哪張）
  function getDiscardableEnergies(spec: PreDiscardSpec): Array<{ iid: string; cardId: string; ownerIid: string; ownerName: string; hostInst: CardInstance }> {
    if (!game || !activePlayer) return [];
    let out: Array<{ iid: string; cardId: string; ownerIid: string; ownerName: string; hostInst: CardInstance }> = []; // v6.078 basicEnergyOnly 需重新指派
    if (spec.scope === 'hand-rocket-supporter') {
      // v2.143 火箭羽毛：列出手牌中「火箭隊」支援者
      const placeholder = activePlayer.active ?? activePlayer.bench[0];
      if (!placeholder) return [];
      for (const h of activePlayer.hand) {
        const hc = getCard(h.cardId);
        if (hc?.supertype === 'Trainer' && hc.subtype === 'Supporter' && hc.name.includes('火箭隊')) {
          out.push({ iid: h.iid, cardId: h.cardId, ownerIid: 'hand', ownerName: hc.name, hostInst: placeholder });
        }
      }
      return out;
    }
    if (spec.scope === 'hand-tool') {
      // v2.254 灰塵山|丟棄：列出手牌中「寶可夢道具」
      const placeholder = activePlayer.active ?? activePlayer.bench[0];
      if (!placeholder) return [];
      for (const h of activePlayer.hand) {
        const hc = getCard(h.cardId);
        if (hc?.supertype === 'Trainer' && hc.subtype === 'PokemonTool') {
          out.push({ iid: h.iid, cardId: h.cardId, ownerIid: 'hand', ownerName: hc.name, hostInst: placeholder });
        }
      }
      return out;
    }
    // v6.078：scope='hand-reveal' —— 「從手牌將任意數量的○○給對手看過後」型招式。
    //   ⚠ 只揭示、不移動卡；玩家自行決定展示幾張（卡面寫「任意數量」，禁自動全展示）。
    if (spec.scope === 'hand-reveal') {
      const placeholder = activePlayer.active ?? activePlayer.bench[0];
      if (!placeholder) return [];
      for (const h of activePlayer.hand) {
        const hc = getCard(h.cardId);
        if (!hc) continue;
        if (spec.handRevealNames && !spec.handRevealNames.includes(hc.name)) continue;
        if (spec.handRevealSupertype && hc.supertype !== spec.handRevealSupertype) continue;
        out.push({ iid: h.iid, cardId: h.cardId, ownerIid: 'hand', ownerName: hc.name, hostInst: placeholder });
      }
      return out;
    }
    if (spec.scope === 'hand-energy') {
      // v2.389 雙重食客 / 射攻月亮：列出手牌中「能量卡」
      const placeholder = activePlayer.active ?? activePlayer.bench[0];
      if (!placeholder) return [];
      for (const h of activePlayer.hand) {
        const hc = getCard(h.cardId);
        if (hc?.supertype === 'Energy') {
          out.push({ iid: h.iid, cardId: h.cardId, ownerIid: 'hand', ownerName: hc.name, hostInst: placeholder });
        }
      }
      return out;
    }
    const addFrom = (host: CardInstance | null | undefined) => {
      if (!host) return;
      const hc = getCard(host.cardId);
      const hname = hc?.name ?? '?';
      for (const e of host.energyAttached) out.push({ iid: e.iid, cardId: e.cardId, ownerIid: host.iid, ownerName: hname, hostInst: host });
    };
    if (spec.scope === 'attacker') {
      addFrom(activePlayer.active);
    } else if (spec.scope === 'own-bench') {
      // v2.57 擦除球：只丟備戰寶可夢身上的能量
      for (const b of activePlayer.bench) addFrom(b);
    } else {
      addFrom(activePlayer.active);
      for (const b of activePlayer.bench) addFrom(b);
    }
    // v6.078：spec.basicEnergyOnly — 只留「基本能量卡」（卡面寫「基本能量卡」的招式）。
    //   與 energyTypeFilter 正交，先套這一層再套屬性層。
    if (spec.basicEnergyOnly) {
      out = out.filter(item => getCard(item.cardId)?.subtype === 'Basic');
    }
    // v4.16：spec.energyTypeFilter 設定時，filter 出「視為該屬性」的能量
    //   覆蓋基本/特殊能量規則；新衝天 (Stage2) 視為所有屬性；稜鏡 (Basic) 視為所有屬性
    if (spec.energyTypeFilter) {
      // v5.682：收斂到中央 host-aware energyProvidesType（基本【X】/古舊(全)/稜鏡(Basic=全)/
      //   新衝天(Stage2=全)/燃火/火箭隊）。取代原本前端自己一份、漏掉古舊等的實作。
      const filterType = spec.energyTypeFilter as EnergyType;
      return out.filter(item => energyProvidesType(item.hostInst, { cardId: item.cardId }, filterType, pool));
    }
    return out;
  }

  /**
   * v2.129：依 PreDiscardSpec.countMode 計算「目前已選的數量」（cards 或 units）。
   * units 模式下，需要透過 getDiscardableEnergies 找到 host 才能正確處理燃火能量等特殊規則。
   */
  function computePickedAmount(spec: PreDiscardSpec, picked: Set<string>, energies: ReturnType<typeof getDiscardableEnergies>): number {
    if (spec.countMode !== 'units') return picked.size;
    let n = 0;
    for (const e of energies) {
      if (picked.has(e.iid)) n += getEnergyDiscardUnits(e.cardId, e.hostInst, pool, game, aIdx);
    }
    return n;
  }

  // v5.998：可丟能量總量(供 effectivePreDiscardMin 上限;不足spec.min時付能付的,依黃玉伏特官方Q&A)
  function _maxDiscardAmount(spec: PreDiscardSpec): number {
    const energies = getDiscardableEnergies(spec);
    return computePickedAmount(spec, new Set(energies.map(e => e.iid)), energies);
  }

  function togglePreAttackEnergy(iid: string) {
    if (!preAttackDiscard) return;
    const picked = new Set(preAttackDiscard.picked);
    if (picked.has(iid)) {
      picked.delete(iid);
    } else {
      const { min, max, countMode } = preAttackDiscard.spec;
      // v4.10：units mode 用 min 為 gate（不是 max）— PTCG 規則「卡 atomic」：
      //   單張卡提供超過 min units 是允許的（例：1 張燃火能量 = 3 units 滿足「丟 2 個」）。
      //   修法：cur < min 可加任何卡；cur >= min 不能再加（達標即停，避免亂丟）。
      if (countMode === 'units') {
        const energies = getDiscardableEnergies(preAttackDiscard.spec);
        const target = energies.find(e => e.iid === iid);
        const addUnits = target ? getEnergyDiscardUnits(target.cardId, target.hostInst, pool, game, aIdx) : 1;
        const cur = computePickedAmount(preAttackDiscard.spec, picked, energies);
        // v4.14：gate threshold 用 exactRequired 優先（min=0 場景如激流水泵/忍者飛旋）
        //   否則用 min（min>0 場景如分身連打/龍之滑翔）
        const gate = (preAttackDiscard.exactRequired !== undefined && preAttackDiscard.exactRequired > 0)
          ? preAttackDiscard.exactRequired
          : min;
        if (gate > 0 && cur >= gate) return;  // 已達標 → 不能再加
        // 最小組合檢查：加新卡後若已選任一卡移除後仍 >= gate，該卡多餘 → 拒
        const newSum = cur + addUnits;
        if (gate > 0 && newSum >= gate) {
          for (const pickedIid of picked) {
            const pe = energies.find(e => e.iid === pickedIid);
            const pu = pe ? getEnergyDiscardUnits(pe.cardId, pe.hostInst, pool, game, aIdx) : 1;
            if (newSum - pu >= gate) return;  // 此已選卡多餘 → 拒
          }
        }
      } else if (max !== null && picked.size >= max) {
        // cards mode 沿用原行為（最多 N 張）
        return;
      }
      picked.add(iid);
    }
    preAttackDiscard = { ...preAttackDiscard, picked };
  }

  function confirmPreAttackDiscard() {
    if (!preAttackDiscard) return;
    // v3.873：解構 copyAttackChoice — 若為 扮晶晶酒 borrowed picker 流程，需一併 dispatch
    // v3.875：exactRequired 設值時，picked 必須是 0 (skip) 或 exactRequired (啟用 option)，中間數量 reject
    const { attackIndex, spec, picked, copyAttackChoice, exactRequired } = preAttackDiscard;
    const energies = getDiscardableEnergies(spec);
    const amount = computePickedAmount(spec, picked, energies);
    if (amount < effectivePreDiscardMin(spec, _maxDiscardAmount(spec))) return;
    // v4.15：units mode 允許單張 atomic 超過 max（同 v4.12 UI maxOk 修法）
    if (spec.countMode !== 'units' && spec.max !== null && amount > spec.max) return;
    // v4.14：units mode 允許單張超過 → 改 < 嚴擋 (0 skip 或 >= exactRequired 才送)
    if (exactRequired !== undefined && amount !== 0 && amount < exactRequired) return;
    const iids = [...picked];
    preAttackDiscard = null;
    dispatch(GameActions.attack(attackIndex, iids, copyAttackChoice));
  }

  function cancelPreAttackDiscard() {
    preAttackDiscard = null;
  }

  // v4.60 propose-restart handlers
  function handleProposeRestartButton() {
    showSettingsModal = false;
    if (!game) return;
    if (mode === 'online') {
      if (!roomCode) return;
      if (!canProposeRestart) return;
      if (!confirm('向對手提議重新開局？\n對方收到後會被詢問是否同意（30 秒回應時間）。')) return;
      proposeRestart(roomCode).catch((e: any) => {
        alert('提議重新開局失敗：' + (e?.message ?? e));
      });
    } else {
      if (!confirm('確定要重新開局嗎？目前盤面將清空，從擲幣決定先攻重新開始。')) return;
      aiThinking = false;
      if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
      startLocalGame();
    }
  }
  function handleAcceptOppRestart() {
    if (!roomCode) return;
    respondRestart(roomCode, true).catch((e: any) => alert('接受失敗：' + (e?.message ?? e)));
  }
  function handleRejectOppRestart() {
    if (!roomCode) return;
    respondRestart(roomCode, false).catch((e: any) => alert('拒絕失敗：' + (e?.message ?? e)));
  }
  // v5.180 提議返回房間 handlers
  function handleProposeReturnRoomButton() {
    showSettingsModal = false;
    if (!game) return;
    if (mode === 'online') {
      if (!roomCode) return;
      if (!canProposeReturnRoom) return;
      if (!confirm('向對手提議返回房間？\n雙方同意後將回到房間選牌組介面 (30 秒回應時間)。')) return;
      proposeReturnToRoom(roomCode).catch((e: any) => {
        alert('提議返回房間失敗：' + (e?.message ?? e));
      });
    } else {
      // v5.183: 本機/AI 改 game=null 讓 game route 自動顯示對應 lobby (本機雙人選牌組 / AI lobby)
      //   而非 navigate 回首頁。Wilson 要求回到「本機雙人對戰 選牌組」介面。
      if (!confirm('確定要返回對戰模式選擇介面嗎？目前對戰將結束，可重新選擇牌組。')) return;
      aiThinking = false;
      if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
      game = null;
    }
  }
  function handleAcceptOppReturnRoom() {
    if (!roomCode) return;
    respondReturnToRoom(roomCode, true).catch((e: any) => alert('接受失敗：' + (e?.message ?? e)));
  }
  function handleRejectOppReturnRoom() {
    if (!roomCode) return;
    respondReturnToRoom(roomCode, false).catch((e: any) => alert('拒絕失敗：' + (e?.message ?? e)));
  }
  function handleCancelMyReturnRoom() {
    if (!roomCode) return;
    cancelReturnToRoom(roomCode).catch((e: any) => alert('取消失敗：' + (e?.message ?? e)));
  }
  function handleCancelMyRestart() {
    if (!roomCode) return;
    cancelRestart(roomCode).catch((e: unknown) => console.warn('[cancelRestart] failed:', e));
  }

  // ── 本機 Lobby ───────────────────────────────────────────────────────────────
  async function startLocalGame() {
    if (!p1DeckId || !p2DeckId) return;
    const d1 = allDecks.find(d => d.id === p1DeckId);
    const d2 = allDecks.find(d => d.id === p2DeckId);
    if (!d1 || !d2) return;
    // v5.894：建局前確保雙方牌組卡包已載入（完整性 fallback 缺卡則全載），使下方 validateDeck 與對戰用真 pool。
    await ensurePoolForDeckEntries([d1.entries, d2.entries], true);
    // v3.38：60 張規則最終 gate（雙重保險，UI button 已 disabled）
    // v5.215：改用 validateDeck 完整驗證（60 張 / 無 G 標 / ACE SPEC ≤1 / 同名 ≤4 /
    //   ≥1 基礎寶可夢 + reprint exception 名單例外）。任一玩家有 issues 即 alert 列出。
    const c1 = countDeckCards(d1.entries);
    const c2 = countDeckCards(d2.entries);
    const v1 = validateDeck(d1, pool);
    const v2 = validateDeck(d2, pool);
    if (v1.issues.length > 0 || v2.issues.length > 0) {
      const lines: string[] = ['牌組不合法，無法開始對戰：', ''];
      lines.push(`玩家 1（${c1} 張）：`);
      if (v1.issues.length === 0) lines.push('  ✓ 合法'); else v1.issues.forEach(s => lines.push(`  • ${s}`));
      lines.push('');
      lines.push(`玩家 2（${c2} 張）：`);
      if (v2.issues.length === 0) lines.push('  ✓ 合法'); else v2.issues.forEach(s => lines.push(`  • ${s}`));
      alert(lines.join('\n'));
      return;
    }
    aiThinking = false;
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    // v6.038：AI 模式才載打法表，且**只看 AI 那一側的牌組**（AI 本來就知道自己帶什麼牌）。
    //   ⚠每局都要先 clear/重挑：上一局的表不可以殘留到不同牌組的下一局。
    //   ⚠fail-open —— prepareAIPlaybook 內部已吞掉所有錯誤；這裡再包一層 try 是雙保險，
    //     一張策略表絕不該讓「開始對戰」這個動作失敗。
    try {
      if (aiPlayerIndex !== null) {
        await prepareAIPlaybook((aiPlayerIndex === 0 ? d1 : d2).entries, pool);
      } else {
        clearPlaybook();
      }
    } catch { clearPlaybook(); }
    // v3.75：先後攻偏好處理
    // - AI 模式：人類玩家偏好直接決定先手（不擲幣）
    //   先攻 → 人類先手；後攻 → AI 先手；隨機 → 擲幣決定
    // - 本機雙人：擲幣 + 套贏家偏好（與線上同邏輯）
    // v6.051 批2：本機／AI 已接好選擇視窗 → 這條路開放互動式開局。
    //   引擎端仍只在「雙方牌組任一含瞬間爆發力」時才走新流程，其餘對局逐欄位 0 diff。
    //   v6.053 批3／批4：線上與錦標賽也已放行，全站統一。
    let createOpts: Parameters<typeof createGame>[3] = {};
    if (aiPlayerIndex !== null) {
      const humanIdx = (1 - aiPlayerIndex) as 0 | 1;
      const humanPref = humanIdx === 0 ? p1FirstPref : p2FirstPref;
      if (humanPref === 'first') {
        createOpts = { firstPlayerOverride: humanIdx };
      } else if (humanPref === 'second') {
        createOpts = { firstPlayerOverride: (1 - humanIdx) as 0 | 1 };
      }
      // random → 不傳 override → 走擲幣 random
    } else {
      // 本機雙人：擲幣 + 雙方偏好
      createOpts = { firstChoicePreferences: [p1FirstPref, p2FirstPref] };
    }
    game = createGame(
      { name: p1Name || d1.name, entries: d1.entries },
      { name: aiPlayerIndex === 1 ? '🤖 ' + (p2Name || d2.name) : (p2Name || d2.name), entries: d2.entries },
      pool,
      createOpts,
    );
  }

  // ── 線上 Lobby（v2.269 座位制重構） ────────────────────────────────────
  async function handleCreateRoom() {
    if (!myName.trim()) { onlineError = '請輸入玩家名稱'; return; }
    if (!roomNameInput.trim()) { onlineError = '請輸入房間名稱'; return; }
    onlineLoading = true; onlineError = '';
    try {
      // v4.75：傳 allowUndo 旗標決定是否為練習房
      // v5.003：第 4 個參數是 visible — !private 即「公開房 = true」「私密房 = false」
      roomCode = await createRoom(roomNameInput.trim(), myName.trim(), roomAllowUndoInput, !roomPrivateInput);
      amIHost = true;
      onlineStep = 'room';
      startRoomSubscription();
      // v5.480：套用上次記憶的先後攻偏好 + 閒置時間——改非阻塞（fire-and-forget），
      //   避免這兩個 Firestore 寫入在手機上 hang 住整個進房流程（v5.476 用 await 會卡在開房畫面）。
      setSeatFirstChoice(roomCode, _readLastFirstPref()).catch(() => { /* best-effort */ });
      setIdleTimeout(roomCode, _readLastIdle()).catch(() => { /* best-effort */ });
    } catch(e: any) { onlineError = e.message ?? '建立房間失敗'; }
    finally { onlineLoading = false; }
  }

  async function handleJoinRoom() {
    if (!myName.trim()) { onlineError = '請輸入玩家名稱'; return; }
    if (!joinInput.trim()) { onlineError = '請輸入房號'; return; }
    onlineLoading = true; onlineError = '';
    try {
      await joinRoom(joinInput.trim(), myName.trim());
      roomCode = joinInput.trim().toUpperCase();
      amIHost = false;
      onlineStep = 'room';
      startRoomSubscription();
      // v5.480：套用上次記憶的先後攻偏好——非阻塞，避免 hang 住進房流程。
      setSeatFirstChoice(roomCode, _readLastFirstPref()).catch(() => { /* best-effort */ });
    } catch(e: any) { onlineError = e.message ?? '加入房間失敗'; }
    finally { onlineLoading = false; }
  }

  // v2.73 殭屍房間心跳機制：玩家在房內時每 15s 寫 lastSeenAt 到 Firestore
  function startHeartbeat() {
    stopHeartbeat();
    const tick = () => {
      if (!roomCode || !roomData || !myUid) return;
      const idx = findMySeatIdx(roomData.seats, myUid);
      if (idx < 0) return;
      // v2.83：playing 狀態不寫心跳，避免心跳 updateDoc 與 pushGameState race 造成
      //   onSnapshot 帶回舊 gameState、本地 dispatch 結果被倒推。
      //   殭屍房偵測在 lobby 期間心跳就足夠（5 分鐘 threshold）；playing 房有任一方持續
      //   pushGameState 即會 bump updatedAt，cleanup 規則對 playing > 5min 無更新仍可清。
      if (roomData.status === 'playing') return;
      heartbeat(roomCode, idx).catch(() => { /* silent */ });
    };
    tick();
    // v4.40：15s → 60s。殭屍判定門檻 5min，60s 仍有 5x 安全餘裕；對方 echo 也減少。
    heartbeatTimer = window.setInterval(tick, 60000);
  }
  function stopHeartbeat() {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  let oppStale = $derived((() => {
    if (!roomData) return false;
    const idx = mySeatIdx;
    if (idx !== 0 && idx !== 1) return false;
    const oppIdx = (1 - idx) as 0 | 1;
    const oppSeat = roomData.seats[oppIdx];
    if (!oppSeat?.uid) return false;
    return isSeatStale(roomData, oppIdx, HEARTBEAT_STALE_MS);
  })());

  // 對手 3 分鐘無動作 → 顯示棄權按鈕。
  //   v5.328 重寫（修兩個漏洞，玩家回報「對手打到一半掛機卻不彈窗」）：
  //   (A) gate 漏「我方回合卻卡在等對手」：原本只看 activePlayerIndex≠我，但 (1) 我方 KO
  //       掉對手戰鬥寶可夢後對手要送新寶可夢（active===null，activePlayerIndex 仍是我）、
  //       (2) pendingSelection.actorIdx 是對手（對手要選手牌/備戰）這兩種「等對手」情境
  //       都被排除 → 對手在此掛機永不計時。改用 isWaitingOnOpponent() 精準判定。
  //   (B) 原本 $effect 內 setTimeout，game 物件每次被重新賦值（Oracle 輪詢 _version 變動 /
  //       任何同步）就 clear+重起 → 過度重置。改用 lastActionAt 時間戳：只在 game.log 真的
  //       成長（有新 action）才重置計時起點，再用一條持續 interval 判定，免疫 game 重賦值頻率。
  let oppInactivityWarn = $state(false);
  let showForfeitConfirm = $state(false);
  let _lastActionAt = Date.now();
  let _lastResyncAt = 0;  // v5.360：上次自動重訂閱(自癒)時間
  let _forceAdoptNext = false;  // v5.587：下一個收到的同局 snapshot 強制採用(繞過 stale 守衛)＝程式幫忙重整
  // ⭐⭐⭐v6.212 push 失敗要有限重試，失敗到底就把那份盤面記下來（＝本地領先伺服器的證據）。
  //   舊版只 console.error 就算了 ⇒ 伺服器停在攻擊前、本地繼續等對手 ⇒ 25 秒後 force-adopt
  //   把攻擊前那份拉回來，玩家看到的就是「回合結束了又跳回攻擊前」。
  let _unpushedState: GameState | null = null;
  let _repushAttempts = 0;
  const PUSH_RETRY_MAX = 3;
  async function pushWithRetry(code: string, st: GameState): Promise<boolean> {
    for (let i = 0; i < PUSH_RETRY_MAX; i++) {
      try {
        await pushGameState(code, st);
        _unpushedState = null;
        _repushAttempts = 0;
        return true;
      } catch (e) {
        console.warn('[Online] push failed (' + (i + 1) + '/' + PUSH_RETRY_MAX + '):', e);
        if (i < PUSH_RETRY_MAX - 1) {
          await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        }
      }
    }
    _unpushedState = st;
    _repushAttempts = 0;   // ⭐v6.212 審查回饋：重推額度是「這一次卡住」的額度，新的失敗要重新給
    console.error('[Online] push 連續失敗 —— 本地領先伺服器，改由自癒重推（不回捲）');
    return false;
  }
  let _prevLogLen = -1;
  let _prevGameId = '';  // v5.698：閒置倒數基準綁定的對局 id（換局重設，避免上一局倒數殘留）
  let _lastSyncAt = Date.now();  // v5.701：卡住自癒(resync/force-adopt)專用計時，與宣告倒數 _lastActionAt 解耦

  // v5.329 秒數 → m:ss 顯示
  function fmtMMSS(totalSec: number): string {
    const t = Math.max(0, Math.round(totalSec));
    const m = Math.floor(t / 60);
    const r = t % 60;
    return m + ':' + r.toString().padStart(2, '0');
  }

  // 「現在這個對局是否在等『對手』動作」— 精準判定，避免我方回合等對手時漏判 / 對手回合卻其實等我方時誤判。
  function isWaitingOnOpponent(g: GameState | null, seat: number): boolean {
    if (!g) return false;
    if (seat !== 0 && seat !== 1) return false;
    const opp = (1 - seat) as 0 | 1;
    const me = seat as 0 | 1;
    // v5.697：setup 階段也涵蓋——我已放置+準備、對手還沒(setupDone[opp]=false) → 等對手。
    //   修「對手剛加入就掛機、不擺場/不按準備時宣告按鈕不跳出」(原 phase!=='playing' 直接 false 漏掉 setup)。
    if (g.phase === 'setup') { const sd: any = (g as any).setupDone || []; return !!sd[me] && !sd[opp]; }
    if (g.phase !== 'playing') return false;
    // 1) 有待選擇 → 由 actorIdx 決定在等誰
    if (g.pendingSelection) return g.pendingSelection.actorIdx === opp;
    // v5.698：待拿獎賞卡（pendingPrizes）→ 由該方拿取（與運作正常的錦標賽 tCurrentActorSeat 判定順序對齊）。
    //   原線上版漏這關：盤面停在「對手該拿獎賞、但 activePlayerIndex 已非對手」時會誤判「不等對手」→ 按鈕不跳。
    const pp: any = (g as any).pendingPrizes;
    if (pp && (pp[opp] || 0) > 0) return true;
    if (pp && (pp[me] || 0) > 0) return false;
    // 2) 對手戰鬥寶可夢被 KO、需送新寶可夢（還有備戰可送）→ 等對手（即使現在名義上是我方回合）
    if (g.players[opp].active === null && g.players[opp].bench.length > 0) return true;
    // 3) 我方需送新寶可夢 → 等我，不算對手閒置
    if (g.players[me].active === null && g.players[me].bench.length > 0) return false;
    // 4) 一般情況 → 看是誰的回合
    return g.activePlayerIndex === opp;
  }

  // (1) log 成長 = 有新 action（任一方）→ 重置閒置起點 + 立即收 banner
  //   v5.698：只在 log「增長」時重置倒數。真正的對手/我方動作只會「附加」log；
  //   「縮短」是自癒 force-adopt 採用較短的伺服器權威盤面 / merge 收斂造成的同步雜訊，
  //   不是新動作，不該重置閒置倒數（原本 `!==` 會被 25s force-adopt 洗掉倒數→按鈕延後/不跳）。
  //   換局/新局（game.id 變）則重設基準，避免上一局的倒數殘留到新局。
  $effect(() => {
    const g = game;
    const logLen = g?.log?.length ?? 0;
    const gid = (g as any)?.id ?? '';
    if (gid !== _prevGameId) {            // 換局/新局 → 重設基準
      _prevGameId = gid;
      _prevLogLen = logLen;
      _lastActionAt = Date.now();
      _lastSyncAt = Date.now();
      oppInactivityWarn = false;
      _unpushedState = null;               // v6.212：上一局的未推送殘留不可延用到新局
      _repushAttempts = 0;
      return;
    }
    if (logLen !== _prevLogLen) {
      const grew = logLen > _prevLogLen;  // 只有「增長」才是新動作
      _prevLogLen = logLen;
      // v5.701：自癒計時用「任何 log 變動」即更新（回到 v5.698 前語意，與宣告倒數解耦，
      //   避免 grow-only 改動把自癒(8s 重訂閱/25s force-adopt)頻率放大）。
      _lastSyncAt = Date.now();
      if (grew) {
        _lastActionAt = Date.now();
        oppInactivityWarn = false;
      }
    }
  });

  // (2) 持續檢查（mount 時建一次 interval，不隨 game 重賦值頻率而重置）：
  //     線上對戰 + 對戰位 + 正在等對手動作 + 距上次 action ≥ 3 分鐘 → 顯示 banner。
  $effect(() => {
    const iv = setInterval(() => {
      if (!roomCode) { oppInactivityWarn = false; return; }
      if (!isWaitingOnOpponent(game, mySeatIdx)) { oppInactivityWarn = false; return; }
      // v5.329：門檻改讀房間設定（房主可調 1:00~5:00，預設 3:00）；clamp 防呆
      const thresholdMs = Math.min(300, Math.max(60, roomData?.idleTimeoutSec ?? 180)) * 1000;
      oppInactivityWarn = (Date.now() - _lastActionAt) >= thresholdMs;
      // v5.360：卡住自癒 — 等對手 >8s 都沒有任何新動作（含對手 KO 我方/我方 KO 對手後對手沒收到），
      //   自動重建房間訂閱（＝玩家手動「重新整理 / 回房按觀戰」的修復：重置輪詢 lastVersion → 重新
      //   抓房間最新狀態走正常 merge 收斂）。只重讀、不改 merge 邏輯，安全。免玩家手動脫困。
      if (roomCode && (Date.now() - _lastSyncAt) >= 8000 && (Date.now() - _lastResyncAt) >= 8000) {
        _lastResyncAt = Date.now();
        // v5.587：卡更久(>=25s 等對手都沒新動作)→ 強制採用伺服器最新狀態(繞過 stale 守衛)。
        //   治「本地 log 領先伺服器、重抓回來又被守衛拒收」型卡死。只在『正等對手』時走到這(上方已 gate)，
        //   我方沒有未推送的手，故不會丟手；不同局/game-over/setup 在 handleRoomUpdate 內另有保護。
        // ── ⭐v6.212 SELFHEAL DIRECTION BLOCK BEGIN ──────────────────────────────
        //   v5.587 這裡無條件 force-adopt（繞過全部 stale 守衛）。當本地有推不上去的手時，
        //   伺服器那份是**攻擊前**的盤面 ⇒ 強制採用＝把玩家的回合退回去。
        //   ⇒ 先重推本地那份（冪等；推端 shouldSkipStalePush 會擋倒退），重推仍卡住才 adopt。
        if ((Date.now() - _lastSyncAt) >= 25000) {
          const _healAction = decideStuckSelfHeal({
            hasUnpushedLocal: !!(_unpushedState && game && _unpushedState.id === game.id),
            repushAttempts: _repushAttempts,
          });
          if (_healAction.kind === 'repush') {
            _repushAttempts++;
            const _st = _unpushedState;
            console.warn('[Online] 自癒：本地領先伺服器 → 先重推本地盤面（不回捲），第 '
              + _repushAttempts + ' 次');
            if (_st) {
              pushGameState(roomCode, _st)
                .then(() => { _unpushedState = null; _repushAttempts = 0; })
                .catch((e: unknown) => console.warn('[Online] 自癒重推失敗:', e));
            }
          } else {
            // 放棄本地那份（重推額度用完 / 本來就沒有未推送的手）⇒ 照 v5.587 強制同步。
            _unpushedState = null; _repushAttempts = 0;
            _forceAdoptNext = true;
          }
        }
        // ── ⭐v6.212 SELFHEAL DIRECTION BLOCK END ────────────────────────────────
        try { unsubRoom?.(); unsubRoom = subscribeRoom(roomCode, handleRoomUpdate, () => myPlayerIndex === null, casualWaitingSelfInput); } catch { /* ignore */ }
      }
    }, 5000);
    return () => clearInterval(iv);
  });

  async function onClickClaimForfeit() {
    showForfeitConfirm = true;
  }

  async function confirmClaimForfeit() {
    if (!roomCode || (mySeatIdx !== 0 && mySeatIdx !== 1)) {
      showForfeitConfirm = false;
      return;
    }
    showForfeitConfirm = false;
    oppInactivityWarn = false;
    try {
      // v5.605：宣告前由 room lib 以「最新伺服器盤面」再驗證。回傳 false = 對手其實已行動
      //   (我方畫面 stale)→ 不判，強制重新同步盤面 + 提示「輪到你了」，避免畫面沒同步而誤判勝負。
      const granted = await claimOpponentForfeit(roomCode, mySeatIdx as 0 | 1);
      if (granted === false) {
        _forceAdoptNext = true;
        _lastActionAt = Date.now();
        try { unsubRoom?.(); unsubRoom = subscribeRoom(roomCode, handleRoomUpdate, () => myPlayerIndex === null, casualWaitingSelfInput); } catch { /* ignore */ }
        alert('對手其實已經行動了，現在輪到你！畫面已為你重新同步。');
      }
    } catch (e) {
      console.warn('[claimOpponentForfeit] failed:', e);
    }
  }

  async function dismissZombieRoom() {
    if (!roomCode || !roomData) return;
    if (!confirm('確定要解散此房間嗎？\n\n偵測到對方已離線超過 5 分鐘，房間將被刪除，雙方都會回到大廳。')) return;
    onlineLoading = true;
    try {
      // v3.34 Fix #5：先 unsub + stopHeartbeat，再 await deleteRoom；對齊 leaveOnlineGame 順序
      unsubRoom?.(); unsubRoom = null;
      unsubMessages?.(); unsubMessages = null;
      stopHeartbeat();
      await deleteRoom(roomCode);
      game = null; roomCode = ''; roomData = null;
      onlineStep = 'join'; showCreateForm = false;
      mode = null;
    } catch (err: any) {
      onlineError = err?.message ?? '解散房間失敗';
    } finally {
      onlineLoading = false;
    }
  }

  // ── v6.216③ 休閒對戰盤面輪詢自適應 ────────────────────────────────────────────
  //   「明確等待自己輸入」= 線上模式、對局進行中(playing)、輪到我、且盤面上沒有任何
  //   pendingSelection / pendingChainQueue。此時盤面輪詢由 500ms 降到 1000ms。
  //   查證(v6.216)自己回合時對手仍可能寫盤面的所有路徑:
  //   (a) 我方招式/效果把選擇權交給對手(pendingSelection.actorIdx=對手,或 pending 鏈中
  //       還有對手的待選)→ 需要即時 ⇒ 底下「有任何 pending 一律回 false」——比逐項判
  //       actorIdx 更保守,連「我自己在選」的期間也不降頻。
  //   (b) 對手投降 / 悔棋請求(requestUndo 經房間 doc)→ 低頻事件,晚半秒看到無感。
  //   (c) 心跳/聊天 → 心跳不影響玩家可見盤面;聊天走 subscribeMessages 另一條輪詢。
  //   setup(雙方並行動作)/game-over/觀戰/身分未明(myPlayerIndex null)一律不降頻。
  //   任何例外都回 false ⇒ 行為退回既有 500ms 快檔(fail-open 不降頻)。
  function casualWaitingSelfInput(): boolean {
    try {
      if (mode !== 'online') return false;
      const g = game;
      if (!g || g.phase !== 'playing') return false;
      if (myPlayerIndex === null) return false;
      if (g.activePlayerIndex !== myPlayerIndex) return false;
      if (g.pendingSelection) return false;
      if (g.pendingChainQueue && g.pendingChainQueue.length > 0) return false;
      return true;
    } catch {
      return false;
    }
  }

  function startRoomSubscription() {
    unsubRoom?.();
    unsubRoom = subscribeRoom(roomCode, handleRoomUpdate, () => myPlayerIndex === null, casualWaitingSelfInput);
    startHeartbeat();
    // v2.272：訂閱聊天訊息
    unsubMessages?.();
    unsubMessages = subscribeMessages(roomCode, msgs => {
      chatMessages = msgs;
      // 自動捲到底（用 setTimeout 等 DOM 更新）
      setTimeout(() => {
        if (chatScrollEl) chatScrollEl.scrollTop = chatScrollEl.scrollHeight;
      }, 50);
    });
  }

  // v4.920 觀戰加入/離開改寫到聊天室（不汙染對戰 log）
  //   v4.919 原本寫到 game.log，但對戰 log 應該只記錄招式/特性/抽牌等對戰事件。
  //   meta-game 社交訊息（觀戰者進出）放聊天室更合適 — 不影響對戰回放與記錄。
  //   跨 handleRoomUpdate 保留前次觀戰者快照（uid -> name）。
  let lastSpectatorMap = new Map<string, string>();

  function handleRoomUpdate(room: Room | null) {
    if (!room) { onlineError = '房間不存在或連線中斷'; return; }
    roomData = room;
    (globalThis as any).__ptcgLB = { kind: 'incoming', action: room?.gameState?.log?.length, t: Date.now() }; // v5.350 卡頓麵包屑
    // v5.361 診斷：每次輪詢遞送房間時印「房間版本/log 長度 vs 本地 log 長度」，協助抓同步分歧。
    //   房間較舊(inLen<myLen)→ 會被 reject-stale 擋；較新→ 會套用；等長→ 視 id/phase。
    if (room.gameState && game && game.phase === 'playing') {
      const rv = (room as any)._version;
      const inLen = room.gameState.log?.length ?? 0;
      const myLen = game.log?.length ?? 0;
      const tag = inLen < myLen ? '房間較舊(擋)' : (inLen > myLen ? '房間較新(套用)' : '等長');
      console.log(`[PTCG sync] 房間 v${rv ?? '?'} log=${inLen} ｜ 本地 log=${myLen} ｜ ${tag}`);
    }

    // ── v4.920 觀戰者加入/離開通知（送到聊天室）─────────────────────────
    //   只有 mySeatIdx === 0 (P1) 才 sendMessage，避免雙方 client 同時偵測重複。
    //   觸發條件：在房間裡（roomCode 存在）；不限對戰階段（lobby/playing 都會通知）。
    //   sendMessage 用 P1 的 uid 但 senderName 標成「📺 系統」讓玩家辨識。
    {
      const currentMap = new Map<string, string>();
      for (const seat of room.seats) {
        if (seat.role === 'spectator' && seat.uid) {
          currentMap.set(seat.uid, seat.name ?? '觀戰者');
        }
      }
      if (mySeatIdx === 0 && roomCode && lastSpectatorMap.size + currentMap.size > 0) {
        const joined: string[] = [];
        const left: string[] = [];
        for (const [uid, name] of currentMap) {
          if (!lastSpectatorMap.has(uid)) joined.push(name);
        }
        for (const [uid, name] of lastSpectatorMap) {
          if (!currentMap.has(uid)) left.push(name);
        }
        for (const name of joined) {
          sendMessage(roomCode, '📺 系統', `${name} 加入觀戰`)
            .catch(e => console.warn('[spectator chat] join push failed:', e));
        }
        for (const name of left) {
          sendMessage(roomCode, '📺 系統', `${name} 離開觀戰`)
            .catch(e => console.warn('[spectator chat] leave push failed:', e));
        }
      }
      lastSpectatorMap = currentMap;
    }

    // 從 seats 推導我的座位
    const idx = findMySeatIdx(room.seats, myUid);
    mySeatIdx = idx;
    myPlayerIndex = (idx === 0) ? 0 : (idx === 1) ? 1 : null;

    // v4.60 propose-restart trigger (both sides true)
    const rp = room.restartProposed ?? {};
    if (rp[0] && rp[1] && roomCode) {
      checkAndAcceptRestart(roomCode, pool).catch((e: unknown) => console.warn('[checkAndAcceptRestart] failed:', e));
    }
    // v5.180 propose-return-to-room trigger (both sides true)
    const rrp = room.returnRoomProposed ?? {};
    if (rrp[0] && rrp[1] && roomCode) {
      checkAndAcceptReturnToRoom(roomCode).catch((e: unknown) => console.warn('[checkAndAcceptReturnToRoom] failed:', e));
    }

    // v3.96 再來一局（對稱）：雙方都 ready → 任一方 trigger checkAndAcceptRematch
    //   transaction 內讀-比-寫保證只執行一次，後到的 transaction 看到 rematchReady 已清就 abort
    const rr = room.rematchReady ?? {};
    if (rr[0] && rr[1] && roomCode) {
      checkAndAcceptRematch(roomCode).catch((e: unknown) => console.warn('[checkAndAcceptRematch] failed:', e));
    }

    // v3.96 房間 status 從 'playing'/'ended' → 'lobby' + game=null：雙方都 ready 後 reset 的同步點
    if (room.status === 'lobby' && !room.gameState && game) {
      // 清 local game 跳回 setup（onlineStep 保持 'room'，UI 顯示 lobby/setup 畫面）
      game = null;
    }

    // v3.34 Fix #4：playing 期間防舊 snapshot 倒退本地。
    //   incoming.log.length < local.log.length 視為舊 snapshot（含「我自己 push 後
    //   firestore echo 回來但對手剛好夾入更舊的寫」這種 race window）。
    //   只擋 strictly less，不擋等於，避免 v2.82 _syncSeq deadlock 重演。
    //   v2.83 已用「playing 期間停心跳」減少 race；本條為最終防線。
    if (room.gameState) {
      const incoming = room.gameState;
      // v5.587 強制自癒：自癒升級——卡 >=25s 後本次 snapshot 強制採用伺服器狀態(繞過下方 stale 守衛)＝等同重整。
      //   僅同一局(或本地無局)且非 setup(防 phase 倒退)才採用；game-over 本地時上層 isWaitingOnOpponent=false 不會走到這。
      if (_forceAdoptNext) {
        _forceAdoptNext = false;
        // ⭐v6.214①：這條路徑是**刻意繞過** resolveRoomUpdate 的，所以「已結束的舊局不採納」
        //   必須在這裡再問一次同一個純述詞（單一判準，不是複製一份條件）。
        //   `!game` 時原條件是放行的 ⇒ 不補這一道，自癒就會變成另一個「跳回舊局」的入口。
        if (incoming && incoming.phase !== 'setup' && (!game || game.id === incoming.id)
            && !isStaleFinishedGame(game, incoming, _activeGameId)) {
          console.warn('[Online] 強制自癒：採用伺服器最新狀態（繞過 stale 守衛，治本地領先型卡死）');
          game = incoming;
          return;
        }
      }
      // SFX（保留）：B 端首次收到 setup snapshot 播 ready-go + 起手發 7 張
      if (!game && incoming.phase === 'setup') {
        playSfx('ready-go');
        staggerSfx('deal', 7, { delayMs: 350, intervalMs: 110, baseVolume: 0.7 });
      }
      // v6.050：音效移到**決策之後**才播（見下方 decision 之後），並用「真正被採用的盤面」做 diff。
      //   原本在這裡、也就是 stale 守衛**之前**就播：被 reject 的舊 snapshot 一樣會發出聲音
      //   （例如舊的 activePlayerIndex 與現況不同 → 誤播回合切換音，真 snapshot 到達後再播一次）。
      const _sfxPrevGame = game;
      // ⭐v6.050：對手回合的音效 —— 用 decision 決定要採用的盤面做 diff。
      //   之前這條路徑只播「換回合／KO／狀態／勝負／拿獎／抽牌」，對手的攻擊、進化、附能、
      //   放卡、特性、撤退全部無聲（同一場對戰打 AI 有聲、打線上就沒有）。
      //   v6.048 把音效決策收斂成純函式之後，這裡只要換成「決策後的盤面」就能一次補齊。
      const _emitCasualSfx = (nextGame: GameState | null | undefined): void => {
        if (!_sfxPrevGame || !nextGame) return;
        if (_sfxPrevGame.id !== nextGame.id) return;      // 不同局（重新開局等）不 diff
        if (_sfxPrevGame === nextGame) return;
        try { detectSpectatorStateDiffSfx(_sfxPrevGame, nextGame); } catch { /* 音效不影響遊戲 */ }
      };
      // v5.408：收端決策統一改由 sync-guards.resolveRoomUpdate（單一來源，受
      //   scripts/test-online-sync-guards.mjs 回歸網保護）。原本散落 inline 的
      //   createGame race / 悔棋繞過 / 防舊 / game-over 終態 / phase 倒退 / 開局單調
      //   merge / 獎賞單調保護全部收斂到該純函式；此處只套用決策副作用。
      const decision = resolveRoomUpdate(game, incoming, {
        myPlayerIndex,
        roomLastUndoApplyAt: room.lastUndoApplyAt ?? 0,
        lastSeenUndoApplyAt,
        roomRestartCount: (room.restartProposalCount as number | undefined) ?? 0,
        lastAdoptedRestartCount,
        activeGameId: _activeGameId,   // v6.214①：分辨「重整想看終局盤」與「跳回舊局」
      });
      // reject / ignore 不會改變盤面 → 不發出任何聲音（這正是移到守衛之後的目的）
      if (decision.kind !== 'reject' && decision.kind !== 'ignore') _emitCasualSfx(decision.game);
      switch (decision.kind) {
        case 'reject':
          console.warn('[Online] reject snapshot:', decision.reason);
          return;
        case 'apply-undo':
          // v5.390 悔棋 rollback：套用 + 清 undo/浮動選單 UI + bump 一次性 marker
          lastSeenUndoApplyAt = room.lastUndoApplyAt as number;
          game = decision.game;
          // ⭐v6.212：悔棋之後，那份「悔棋前的未推送快照」已經作廢 —— 留著會被自癒重推回去
          //   （它的 log 較長，shouldSkipStalePush 只擋嚴格較短的，擋不住）＝ 復活已悔掉的一手。
          _unpushedState = null; _repushAttempts = 0;
          undoSnapshot = null; undoActionDesc = null;
          undoAwaitingResponse = false; undoDeniedThisSnapshot = false;
          floatingEvoMenu = null; floatingRetreatMenu = null; selectedEnergyIid = null;
          prizeAnimKey = [prizeAnimKey[0] + 1, prizeAnimKey[1] + 1];
          arrivingIids = new Set(); justArrivedIids = new Set();
          console.log('[undo] 收到悔棋 rollback 標記，已套用並繞過 stale guard');
          return;
        case 'merge-setup':
          // v4.494：開局單調 merge 後若湊齊雙方完成 → 已是 playing，推給對方同步（idempotent）
          if (decision.advanced && roomCode) {
            pushGameState(roomCode, decision.game).catch((e: unknown) => console.warn('[pushGameState advance] failed:', e));
          }
          game = decision.game;
          return;
        case 'adopt':
        case 'merge-prize':
          game = decision.game;
          // v5.716：adopt 了 restart 重建的新 setup 局(已通過 phantom 防護=合法重新開局) →
          //   記下當前 restartProposalCount,讓後續同 count 的 phantom setup 局被擋(只放行「下一次」restart)。
          if (decision.kind === 'adopt' && decision.game.phase === 'setup') {
            lastAdoptedRestartCount = (room.restartProposalCount as number | undefined) ?? 0;
          }
          // v5.432：線上祭典樂舞第二次攻擊修正 — 「取獎賞」(攻擊方) 與「對手補位」分屬兩 client，
          //   各自 action 當下開窗條件未齊（一邊只取獎賞、一邊只補位）；對方動作 merge 進來後沒有任何一方
          //   重新評估 → 第二次攻擊視窗永遠不開、玩家被迫結束回合。修法：merge 後由「攻擊方本人 client」
          //   (festival pending.idx===myPlayerIndex) 在尚未 promote(turnPhase!=='main') 時重跑
          //   tryPromoteToMainForFestival（內部已檢查 pending/獎賞/對手active/中斷例外，條件齊才 promote）。
          //   只由攻擊方一端做（避免兩端各自 promote 造成 log 分歧），promote 後推同步。
          if (game && myPlayerIndex !== null
              && game.festivalDancePendingSecondAttack
              && game.festivalDancePendingSecondAttack.idx === myPlayerIndex
              && game.turnPhase !== 'main') {
            const _festPromoted = tryPromoteToMainForFestival(game, pool);
            if (_festPromoted !== game) {
              game = _festPromoted;
              if (roomCode) pushGameState(roomCode, _festPromoted).catch((e: unknown) => console.warn('[festival promote push] failed:', e));
            }
          }
          return;
        default:
          return;
      }
    }

    // v2.72：雙方 P1/P2 都 ready → P1 或 P2 任一 client 都可觸發 startGame
    //   原本只 P1 觸發 → host 關瀏覽器後 P2 卡死；現改 idx >= 0（任一玩家），
    //   並由 startGame 內部 Firestore transaction 防 race（兩方同時寫只有一方 commit）。
    if (room.status === 'lobby' && bothPlayersReady(room.seats) && (idx === 0 || idx === 1) && poolReady) {
      checkAndStartOnlineGame();
    }
  }

  // v5.894：對戰按牌組載入 — 只載雙方牌組用到的卡包（非全部 40 包）。完整性 fallback：對照表查無 set、
  //   或 forceComplete 後仍缺卡 → loadAllSets 全載兜底，保證對戰永不因缺卡崩潰（最差＝現況全載）。
  async function ensurePoolForDeckEntries(
    entriesList: ({ cardId: string }[] | null | undefined)[],
    forceComplete = false,
  ): Promise<void> {
    const ids: string[] = [];
    for (const entries of entriesList) if (entries) for (const e of entries) ids.push(String(e.cardId));
    if (ids.length === 0) return;
    if (ids.every((id) => pool.has(id))) return;  // 已全部載入 → 免動作（避免重複抓取/迴圈）
    try {
      const { cards, missingIds } = await loadDeckSets(ids);
      const merged = new Map(pool);
      for (const c of cards) merged.set(c.id, c);
      const stillMissing = forceComplete ? ids.filter((id) => !merged.has(id)) : [];
      if (missingIds.length > 0 || stillMissing.length > 0) {
        const all = await loadAllSets();
        for (const c of all) merged.set(c.id, c);
      }
      pool = merged;
    } catch (e) {
      console.error('[pool] ensurePoolForDeckEntries 失敗，fallback 全載', e);
      try { const all = await loadAllSets(); const merged = new Map(pool); for (const c of all) merged.set(c.id, c); pool = merged; } catch { /* ignore */ }
    }
  }

  // v5.921：依「盤面上實際出現的 cardId」補載卡包 — 錦標賽/線上盤面由伺服器送,client 未必載過對手
  //   牌組(尤其促銷卡集)的卡包→getCard 查不到→無法顯示或同名 fallback 錯版。收集雙方 active/bench/
  //   hand/deck/discard/prizes + 附加能量/道具(含多重轉接)/進化堆的所有 cardId,缺卡即透過
  //   ensurePoolForDeckEntries(forceComplete) 載其 set(對照表)或 loadAllSets 兜底。全載入時 O(n) 早退。
  async function ensurePoolForStateIds(state: any): Promise<void> {
    const ps = state && state.players;
    if (!Array.isArray(ps)) return;
    const ids: string[] = [];
    // v6.150：錦標賽伺服器把**對手隱藏區**（手牌/牌庫/獎賞）的 cardId 換成佔位 id。
    //   它不是真卡、永遠不在 pool 裡 ⇒ 不濾掉的話 `ids.every(pool.has)` 永遠 false，
    //   每次盤面更新都會走 loadDeckSets → missingIds 非空 → loadAllSets() 把 40 個卡包
    //   重建一次 Map（觀戰端從 v0.68 起就一直在做這件事，同步修掉）。
    const HIDDEN_CARD_ID = '__HIDDEN__';
    const pushInst = (it: any) => {
      if (!it) return;
      if (it.cardId && String(it.cardId) !== HIDDEN_CARD_ID) ids.push(String(it.cardId));
      if (Array.isArray(it.energyAttached)) for (const e of it.energyAttached) if (e && e.cardId) ids.push(String(e.cardId));
      if (it.toolAttached && it.toolAttached.cardId) ids.push(String(it.toolAttached.cardId));
      if (Array.isArray(it.extraTools)) for (const t of it.extraTools) if (t && t.cardId) ids.push(String(t.cardId));
      if (Array.isArray(it.evolvedFromStack)) for (const s of it.evolvedFromStack) if (s && s.cardId) ids.push(String(s.cardId));
    };
    for (const pl of ps) {
      if (!pl) continue;
      pushInst(pl.active);
      for (const z of ['bench', 'hand', 'deck', 'discard', 'prizes'] as const) {
        const arr = pl[z];
        if (Array.isArray(arr)) for (const it of arr) pushInst(it);
      }
    }
    if (ids.length === 0) return;
    if (ids.every((id) => pool.has(id))) return; // 已全載 → 免動作
    await ensurePoolForDeckEntries([ids.map((id) => ({ cardId: id }))], true);
  }

  // v5.894：本機/AI lobby 選定的牌組變動 → 按需載其卡包（驗牌用真 pool；缺卡走輕量檢查不誤判）。
  $effect(() => {
    const es: ({ cardId: string }[] | undefined)[] = [];
    if (p1DeckObj) es.push(p1DeckObj.entries);
    if (p2DeckObj) es.push(p2DeckObj.entries);
    if (es.length) ensurePoolForDeckEntries(es);
  });
  // v5.894：線上房間 seat 牌組 → 按需載其卡包（讓 seat 驗牌 G 標檢查用真 pool）。
  $effect(() => {
    if (!roomData) return;
    const es = roomData.seats.map((s) => s.deckEntries).filter(Boolean) as { cardId: string }[][];
    if (es.length) ensurePoolForDeckEntries(es);
  });

  function checkAndStartOnlineGame() {
    if (!poolReady || !roomData) return;
    // v5.749：非「雙就緒+lobby+無 gameState」一律重置 grace 計時
    if (roomData.status !== 'lobby' || roomData.gameState) { _onlineReadyAt = 0; return; }
    const p1 = roomData.seats[0], p2 = roomData.seats[1];
    if (!p1.uid || !p2.uid || !p1.deckEntries || !p2.deckEntries) { _onlineReadyAt = 0; return; }
    if (!p1.ready || !p2.ready) { _onlineReadyAt = 0; return; }
    // v5.749：決定性建局者 — 消滅開局雙端 createGame race（開局重新洗牌根治）。
    //   只有 seat 0（P1）立即建；seat 1（P2）僅 P1 久未建（grace）才 fallback；本端已有 local game 不再建。
    if (_onlineReadyAt === 0) _onlineReadyAt = Date.now();
    const _mySeat = roomData.seats.findIndex((s) => !!s.uid && s.uid === myUid);
    if (!shouldAttemptStartGame({
      mySeat: _mySeat, bothReady: true, roomStatus: roomData.status,
      hasGameState: !!roomData.gameState, haveLocalGame: !!game,
      readyElapsedMs: Date.now() - _onlineReadyAt,
    })) return;

    // v5.894：建局前確保雙方牌組卡包已載入（完整性 fallback）。缺卡→先載入再自我重呼叫本函式。
    // v6.055 診斷：這段是「自我重呼叫」迴圈 —— 若某張卡永遠載不進 pool 就會**無聲無限重試**，
    //   症狀正好是「雙方已準備 ⏳ 但永遠不開始」。加重試上限，超過就把原因寫到畫面上。
    if (!deckEntriesAllInPool(p1.deckEntries, pool) || !deckEntriesAllInPool(p2.deckEntries, pool)) {
      _poolRetry += 1;
      if (_poolRetry > 6) {
        const _miss = [...p1.deckEntries, ...p2.deckEntries]
          .map((e) => e.cardId).filter((id) => !pool.has(String(id)));
        onlineError = `建局卡住：牌組卡包載入失敗（已重試 ${_poolRetry - 1} 次）。缺少卡片 id：`
          + [...new Set(_miss)].slice(0, 8).join('、') + (_miss.length > 8 ? ' …' : '');
        console.error('[建局診斷] pool 載入失敗', _miss);
        return;
      }
      ensurePoolForDeckEntries([p1.deckEntries, p2.deckEntries], true).then(() => checkAndStartOnlineGame());
      return;
    }
    _poolRetry = 0;
    // v3.75：讀雙方 seat 上的先後攻偏好（贏擲幣的一方套用自己的偏好）
    const prefs: ['random'|'first'|'second'|'opponent', 'random'|'first'|'second'|'opponent'] = [
      p1.firstChoicePreference ?? 'random',
      p2.firstChoicePreference ?? 'random',
    ];
    // ⚠v6.054 止血：休閒線上預設退回舊開局（v6.053 實測雙方按準備後卡在建局）。
    //   v6.053 的合併規則／錦標賽閒置判定修正全部保留 —— 它們對舊開局是 0 diff，無害。
    // v6.057：線上正式放行互動式開局（引擎端仍只在「雙方牌組任一含瞬間爆發力」時生效）。
    //   `?opening=0` 為即時逃生口。
    let newGame: GameState;
    try {
      newGame = createGame(
        { name: p1.name ?? 'P1', entries: p1.deckEntries },
        { name: p2.name ?? 'P2', entries: p2.deckEntries },
        pool,
        { firstChoicePreferences: prefs, forceLegacyOpening: forceLegacyOpeningParam },
      );
    } catch (err) {
      // 原本 createGame 沒有 try/catch —— 它一拋例外，整個 checkAndStartOnlineGame 就中斷，
      // 畫面永遠停在「⏳ 雙方已準備」而且什麼都不顯示。這是本次 bug 的頭號嫌疑路徑。
      const _msg = (err as Error)?.message ?? String(err);
      onlineError = `建局失敗（createGame）：${_msg}`;
      console.error('[建局診斷] createGame 拋例外', err);
      return;
    }
    // v5.492：先確認本端 startGame transaction 是否 commit（成為房間 canonical 局）才採用本地 game。
    //   再來一局/開局時雙方各自 createGame race（不同 id），輸掉 transaction 的一端若先用自己的
    //   phantom 局抽牌/設置寶可夢，待 canonical 局 push 進來被 adopt → 進度突然回復重洗（v5.457 後症狀）。
    //   修法：只有 commit 成功(won=true)才採用本地 game + 播 ready-go/發牌；輸方保持 game=null，
    //   待 canonical snapshot 由 room update adopt（B 端首次收 setup snapshot 自有 deal 音效）。
    const _pendingGame = newGame;
    startGame(roomCode, _pendingGame).then((won) => {
      if (won) {
        game = _pendingGame;
        playSfx('ready-go');
        staggerSfx('deal', 7, { delayMs: 350, intervalMs: 110, baseVolume: 0.7 });
      } else {
        console.log('[online] startGame 未 commit（對方已建 canonical 局）→ 不用本地 phantom 局，等同步 adopt');
        // v6.055 診斷：`won=false` 有兩種意思 —— 「對方先建好了」（正常，稍後會 adopt）
        //   與「寫入被拒／房間已有殘留盤面」（異常，會永遠卡住）。後者原本完全無聲。
        const _wErr = (globalThis as any).__ptcgStartGameError;
        if (_wErr) {
          onlineError = `建局失敗（startGame 寫入）：${_wErr}`;
          console.error('[建局診斷] startGame 寫入失敗', _wErr);
        } else {
          setTimeout(() => {
            if (!game && roomData && !roomData.gameState && bothPlayersReady(roomData.seats)) {
              onlineError = '建局未完成：對方也沒有建立對局（房間仍無盤面）。請雙方重新整理再試一次。';
            }
          }, 8000);
        }
      }
    }).catch((e) => {
      const _msg = (e as Error)?.message ?? String(e);
      onlineError = `建局失敗（startGame）：${_msg}`;
      console.error('[建局診斷] startGame 拋例外', e);
    });
  }

  /**
   * v6.055 建局逾時看門狗。
   *
   * 「⏳ 雙方已準備，遊戲即將開始⋯」卡住時，玩家（和我）完全看不到是哪一關沒過 ——
   * 建局路徑上有好幾個會**無聲 return** 的 gate：
   *   ① `poolReady` 還是 false（卡包還在載）
   *   ② 認不出自己的座位（`myUid` 與 seats[].uid 對不起來）→ shouldAttemptStartGame 恆 false
   *   ③ 牌組卡包缺卡 → `ensurePoolForDeckEntries` 自我重呼叫**無限重試**
   *   ④ createGame 拋例外／startGame 寫入失敗
   * 這個看門狗在雙方就緒 12 秒後仍沒有盤面時，把每一關的實際值直接寫到畫面上。
   * 純診斷，不改變任何流程。
   */
  $effect(() => {
    if (game || !roomData) return;
    if (roomData.gameState) return;
    if (roomData.status !== 'lobby') return;
    if (!bothPlayersReady(roomData.seats)) return;
    const _rd = roomData;
    const t = setTimeout(() => {
      if (game || !roomData || roomData.gameState || roomData.status !== 'lobby') return;
      if (onlineError) return;   // 已經有更精確的錯誤了就不覆蓋
      const seat = _rd.seats.findIndex((s) => !!s.uid && s.uid === myUid);
      const p1 = _rd.seats[0], p2 = _rd.seats[1];
      const miss = [...(p1?.deckEntries ?? []), ...(p2?.deckEntries ?? [])]
        .map((e) => String(e.cardId)).filter((id) => !pool.has(id));
      onlineError = '建局逾時診斷 → '
        + `我的座位=${seat}${seat < 0 ? '（認不出自己，uid 對不上）' : ''}`
        + `｜卡池已載入=${poolReady}`
        + `｜雙方牌組張數=${(p1?.deckEntries?.length ?? 0)}/${(p2?.deckEntries?.length ?? 0)}`
        + `｜卡池缺卡=${miss.length}${miss.length ? '（' + [...new Set(miss)].slice(0, 6).join('、') + '）' : ''}`
        + `｜卡包重試=${_poolRetry}`;
      console.error('[建局診斷] 逾時', { seat, poolReady, miss, _poolRetry, myUid, room: _rd });
    }, 12000);
    return () => clearTimeout(t);
  });

  // ── 房間內互動 ─────────────────────────────────────────────────────────
  async function handleTakeSeat(targetIdx: number) {
    if (!roomCode) return;
    onlineError = '';
    try { await takeSeat(roomCode, targetIdx); }
    catch (e: any) { onlineError = e.message ?? '移動座位失敗'; }
  }

  async function handleSetDeck() {
    if (!roomCode || !myDeckId) { return; }
    const deck = allDecks.find(d => d.id === myDeckId);
    if (!deck) return;
    const totalCards = countDeckCards(deck.entries);
    if (totalCards !== 60) {
      onlineError = `所選牌組張數為 ${totalCards}（應為 60 張），請選別的牌組`;
      return;
    }
    onlineError = '';
    try { await setSeatDeck(roomCode, deck.entries); }
    catch (e: any) { onlineError = e.message ?? '設定牌組失敗'; }
  }
  // v3.9993：偵測「🎲 隨機牌組」option（value="__random__"）並回傳隨機抽選的 deck id。
  //   - 抽選範圍：玩家自己的「我的牌組」(decks)，不含內建預組(PRESET_DECKS)。
  //   - 若 decks 是空的 → alert 提示 + 回傳空字串（重置 select）。
  //   - 非 '__random__' 值原樣回傳，無副作用。
  function resolveDeckSelection(val: string): string {
    if (val !== '__random__') return val;
    if (decks.length === 0) {
      alert('「我的牌組」是空的，請先到牌組頁建立至少一個牌組，或從內建預組挑選。');
      return '';
    }
    const pick = decks[Math.floor(Math.random() * decks.length)];
    return pick.id;
  }

  // v2.270：select onchange 自動套用，省去「套用牌組」按鈕
  // v3.9993：handler 內加 resolveDeckSelection — 偵測 __random__ 並改為實際 deck id
  async function handleDeckChange(e: Event) {
    const t = e.target as HTMLSelectElement;
    const resolved = resolveDeckSelection(t.value);
    // 若回傳值與 select 不同（剛剛抽 random），同步 DOM 顯示對應 option
    if (resolved !== t.value) t.value = resolved;
    myDeckId = resolved;
    if (myDeckId) await handleSetDeck();
  }

  async function handleToggleReady() {
    if (!roomCode || mySeatIdx < 0) return;
    const seat = roomData?.seats[mySeatIdx];
    if (!seat) return;
    onlineError = '';
    try { await setSeatReady(roomCode, !seat.ready); }
    catch (e: any) { onlineError = e.message ?? '切換準備狀態失敗'; }
  }

  // v3.96 再來一局：toggle 自己的 ready 狀態（雙方對稱設計）
  async function toggleMyRematchReady() {
    if (!roomCode) return;
    const next = !myRematchReady;
    try {
      await setRematchReady(roomCode, next);
      // 雙方都 ready 時 handleRoomUpdate 會自動 trigger checkAndAcceptRematch
    } catch (e) {
      console.warn('[setRematchReady] failed:', e);
    }
  }

  // v5.560：對戰中「投降離開」前先確認，減少順手中離影響對手體驗
  function surrenderLeave() {
    // ⭐⭐⭐v6.197 投降是「玩家專屬」的動作：不能操作的人連確認視窗都不該看到。
    //   玩家回報「觀戰按離開卻冒出投降」就是走到這裡；上層 onLeave 已分流，這裡是第二道。
    if (!canAct) { if (mode === 'online' && isTournSpectator) tLeaveSpectate(); else leaveOnlineGame(); return; }
    if (!confirm('中離是不好的行為，訓練家應盡力完成對戰，確定要投降/離開嗎？？？')) return;
    // v5.568：錦標賽模式投降 → 伺服器即時判對手勝+晉級，再返回賽事大廳(不走一般 leaveOnlineGame)
    if (isTournament) { tForfeitAndLeave(); return; }
    leaveOnlineGame();
  }
  async function tForfeitAndLeave() {
    try { await tApi('/match/forfeit', { room: tActiveRoom }); } catch (e) { console.warn('[tForfeit]', e); }
    tLeaveMatch();
  }
  async function leaveOnlineGame() {
    // v3.34 Fix #3：先 unsubRoom 阻斷 onSnapshot callback，再 stopHeartbeat，
    //   最後 await leaveRoom；避免 await 期間 firestore snapshot 仍 fire
    //   handleRoomUpdate → 把 game 重新填回（或誤判房間不存在跳到 onlineError）。
    unsubRoom?.(); unsubRoom = null;
    unsubMessages?.(); unsubMessages = null;
    stopHeartbeat();
    // ⭐⭐⭐v6.197 順序改了：**先把「還停在對戰頁」的狀態清乾淨，再去打網路**。
    //   舊順序是「先 await leaveRoom(一次 HTTP 往返)、回來才 game=null / mySeatIdx=-1」，
    //   那段等待期間畫面還是整個對戰盤，而身分欄位又正處在半清狀態 ⇒ 玩家按了離開之後
    //   還會看到（甚至按得到）不屬於他的按鈕。清乾淨是同步的，不需要等伺服器點頭。
    //   ⚠ roomCode 先存進區域變數再清空 —— 清完才有東西可以送給 leaveRoom。
    const _leavingRoomCode = roomCode;
    chatMessages = []; chatInput = '';
    game = null; roomCode = ''; roomData = null;
    onlineStep = 'join'; showCreateForm = false; onlineError = ''; myPlayerIndex = null; mySeatIdx = -1;
    if (_leavingRoomCode) {
      try { await leaveRoom(_leavingRoomCode); }
      catch (e) { console.warn('[leaveRoom] failed:', e); }
    }
    // v5.321: 不清空 roomNameInput, 從 localStorage 讀回上次值
    // (v5.311 onMount 讀過, 但 leaveRoom 後若清成空 → 下次建房又要重打字)
    try {
      roomNameInput = typeof localStorage !== 'undefined' ? (localStorage.getItem('ptcg-tw-sim:lastRoomName') ?? '') : '';
    } catch { roomNameInput = ''; }
    myDeckId = '';
    // v5.130：保留 mode='online' — 玩家離開房間後留在線上對戰大廳（看其他房間列表），
    //   不要跳回首頁逼玩家重新點「線上連線對戰」按鈕。
    //   onlineStep='join' 已會顯示大廳房間列表。
    mode = 'online';
  }

  // v2.272：發送聊天訊息
  async function handleSendMessage() {
    const text = chatInput.trim();
    if (!text || !roomCode || !myName.trim()) return;
    try {
      await sendMessage(roomCode, myName.trim(), text);
      chatInput = '';
    } catch (e: any) {
      onlineError = e.message ?? '訊息傳送失敗';
    }
  }
  function handleChatKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  }
  // v5.393：大廳「開房 X 分鐘前」— 兼容 Oracle(數字 ms) 與 Firebase({seconds})
  function fmtRoomAge(createdAt: unknown): string {
    let ms: number | undefined;
    if (typeof createdAt === 'number') ms = createdAt;
    else if (createdAt && typeof (createdAt as { seconds?: number }).seconds === 'number') ms = (createdAt as { seconds: number }).seconds * 1000;
    if (typeof ms !== 'number') return '';
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return '剛剛開房';
    if (min < 60) return `開房 ${min} 分鐘前`;
    const hr = Math.floor(min / 60);
    return `開房 ${hr} 小時前`;
  }
  // v5.571：錦標賽聊天訊息時間(ms epoch) → HH:MM
  function tFmtMsgTime(ts: number | null | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  function fmtChatTime(ts: { seconds?: number } | null | undefined): string {
    if (!ts?.seconds) return '';
    const d = new Date(ts.seconds * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ── 選擇互動 ─────────────────────────────────────────────────────────────────
  function onAttachEnergy(targetIid: string) {
    if (!selectedEnergyIid) return;
    // ⭐v6.147（Fable 5 審查抓到）：拖曳派已由 hand-card 的 onpointerdown gate 住，
    //   但**點擊派**（點手牌能量 → 點目標）整條沒查 —— 而附能是最高頻動作，
    //   busy 期間點下去會被 tournamentDispatch 丟棄、只換來一行紅字。
    if (actionBusy) { tActSay(TACT_BLOCKED_MSG, 5000); return; }
    dispatch(GameActions.attachEnergy(selectedEnergyIid, targetIid));
  }
  function toggleSelection(iid: string) {
    // v5.014：小剛的發掘 — defense-in-depth refuse disabled iids（即使 UI 沒擋）
    if (pendingSelection?.effectKey === 'brocks-dig-unified') {
      const item = selectionItems.find(it => it.iid === iid);
      if (item && isBrocksDigDisabled(item)) return;
    }
    if (pendingSelection?.effectKey === 'fishnet-unified') {
      const item = selectionItems.find(it => it.iid === iid);
      if (item && isFishnetDisabled(item)) return;
    }
    const next = new Set(selectionPicked);
    if (next.has(iid)) {
      // 點已選 → 取消
      next.delete(iid);
    } else if (pendingSelection?.maxCount === 1 && next.size === 1) {
      // v2.86 單選模式優化：已選 1 張時點另一張 → 自動取消舊的、選新的（不必先點舊的取消）
      next.clear();
      next.add(iid);
    } else if (pendingSelection && next.size < pendingSelection.maxCount) {
      // 多選模式或還沒選滿 → 加入
      next.add(iid);
    }
    selectionPicked = next;
  }
  // damage-distribute / energy-distribute：點擊目標 +1 counter
  function incrementCount(iid: string) {
    if (!pendingSelection) return;
    if (pendingSelection.type !== 'damage-distribute'
        && pendingSelection.type !== 'energy-distribute') return;
    if (selectionBatchSum >= pendingSelection.maxCount) return;
    // v5.442 奇異駭入「抽走」模式：每隻上限 = 該寶可夢現有指示物數（不能抽超過）
    if (pendingSelection.params?.abraRemove && game) {
      const src = game.players[pendingSelection.sourcePlayerIdx];
      const pk = src.active?.iid === iid ? src.active : src.bench.find(b => b.iid === iid);
      const haveCounters = Math.floor((pk?.damage ?? 0) / 10);
      if ((selectionCounts[iid] ?? 0) >= haveCounters) return;
    }
    selectionCounts = { ...selectionCounts, [iid]: (selectionCounts[iid] ?? 0) + 1 };
  }
  function decrementCount(iid: string) {
    const cur = selectionCounts[iid] ?? 0;
    if (cur <= 0) return;
    const next = { ...selectionCounts };
    if (cur - 1 <= 0) delete next[iid]; else next[iid] = cur - 1;
    selectionCounts = next;
  }
  /**
   * ⭐⭐⭐ v6.175：把「這個選擇是在回答哪一個 picker」一起送出去。
   * ⚠ 一定要**現讀現帶**（每次送出時從 game.pendingSelection 取），不可以快取到變數 ——
   *   整個修正的價值就在於「畫面上這個 picker 已經不是伺服器當下那個」時要對不上。
   * 舊盤面沒有 token ⇒ 回 undefined ⇒ engine fail-open（維持既有行為）。
   */
  function _pendingTok(): number | undefined {
    const t = (game as GameState | null)?.pendingSelection?.token;
    return typeof t === 'number' ? t : undefined;
  }
  function confirmSelection() {
    if (!selectionValid) return;
    // 線上模式帶 senderIdx 避免對手搶先 resolve
    const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
    let payload: string[];
    if (pendingSelection?.type === 'damage-distribute'
        || pendingSelection?.type === 'energy-distribute') {
      // 展開計數器為扁平陣列：{A:2, B:1} → [A,A,B]
      payload = Object.entries(selectionCounts).flatMap(([iid, n]) => Array(n).fill(iid));
    } else if (pendingSelection?.type === 'reorder-deck-top') {
      // v2.164：保留 + 排序的 iid 列表（top first）
      payload = [...selectionReorderKeep];
    } else if (pendingSelection?.type === 'modal-choice'
        && pendingSelection.params?.stepper) {
      // v2.201：modal-choice stepper（泰姆猜 HP 等）— payload 是當前 stepper 數值（字串化）
      payload = [String(selectionStepperValue)];
    } else {
      payload = [...selectionPicked];
    }
    dispatch(GameActions.resolveSelection(payload, sid, _pendingTok()));
    selectionPicked = new Set();
    selectionCounts = {};
    selectionReorderKeep = [];
    selectionReorderDiscard = new Set();
  }

  // ── v2.164 reorder-deck-top UI 操作 ────────────────────────────────────────
  // keep 列表是「保留並排序」（top first = index 0）；discard set 是「丟棄」候選
  function reorderMoveUp(iid: string) {
    const i = selectionReorderKeep.indexOf(iid);
    if (i <= 0) return;
    const arr = [...selectionReorderKeep];
    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    selectionReorderKeep = arr;
  }
  function reorderMoveDown(iid: string) {
    const i = selectionReorderKeep.indexOf(iid);
    if (i < 0 || i >= selectionReorderKeep.length - 1) return;
    const arr = [...selectionReorderKeep];
    [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    selectionReorderKeep = arr;
  }
  function reorderToDiscard(iid: string) {
    const arr = selectionReorderKeep.filter(id => id !== iid);
    selectionReorderKeep = arr;
    const set = new Set(selectionReorderDiscard);
    set.add(iid);
    selectionReorderDiscard = set;
  }
  function reorderToKeep(iid: string) {
    const set = new Set(selectionReorderDiscard);
    set.delete(iid);
    selectionReorderDiscard = set;
    if (!selectionReorderKeep.includes(iid)) {
      selectionReorderKeep = [...selectionReorderKeep, iid];
    }
  }

  /**
   * ⭐ v6.123 picker 的「次要動作」（目前只有推理組合的「或者：重洗放回牌庫下方」）。
   * 卡面把兩個選項並列在「查看之後」，所以 UI 也要在同一個畫面上並列兩顆按鈕。
   * ⚠ 不能重用 confirmSelection()：它有 `if (!selectionValid) return` 的 gate，
   *   而且 payload 固定是 selectionReorderKeep —— 次要動作要送的是 altAction.id。
   * ⚠ 要比照 abandonSelection 帶 sid（線上模式的 senderIdx），否則對手側 race 時語義不對。
   */
  function confirmSelectionAlt() {
    const alt = pendingSelection?.params?.altAction as { id?: string } | undefined;
    if (!alt?.id) return;
    const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
    dispatch(GameActions.resolveSelection([alt.id], sid, _pendingTok()));
    selectionPicked = new Set();
    selectionCounts = {};
    selectionReorderKeep = [];
    selectionReorderDiscard = new Set();
  }

  // v2.121 全域安全網：當 pending 的候選列表為空（例：搜卡但牌庫/棄牌/手牌無符合條件的卡）
  // 允許玩家「放棄」以空 selection 前進，避免卡死。resolver 收到空 iids 應能 graceful 結束。
  function abandonSelection() {
    const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
    dispatch(GameActions.resolveSelection([], sid, _pendingTok()));
    selectionPicked = new Set();
    selectionCounts = {};
  }
  // 判定：這個 pending 的候選是否為空且 minCount>0（玩家會被卡住 → 需要放棄按鈕）。
  // damage-distribute 用 counts 不用 picked，排除。
  // ⭐ v6.174：判斷下沉到 selection-ui.ts 的中央述詞 selectionHasNoExit（純函式 → test-selection-ui 覆蓋）。
  //   原本這裡把 damage-distribute / energy-distribute 直接 return false 排除掉，
  //   但那兩型候選為空時「確認」鈕同樣永遠 disabled ⇒ 玩家一顆能按的按鈕都沒有 = 真的卡死。
  const pendingStuckEmpty = $derived.by(() => {
    if (!pendingSelection) return false;
    return selectionHasNoExit({
      type: pendingSelection.type,
      actorIdx: pendingSelection.actorIdx,
      sourcePlayerIdx: pendingSelection.sourcePlayerIdx,
      effectKey: pendingSelection.effectKey,
      minCount: pendingSelection.minCount,
      allowSkipZero: pendingSelection.params?.allowSkipZero === true,
      allowCancel: pendingSelection.params?.allowCancel === true,   // v6.175 有【取消】鈕就有出口
    }, selectionItems.length);
  });
  // v2.121：判斷一張卡是否為指定屬性的基本能量。
  // 很多基本能量卡 JSON 的 pokemonType 欄位為 undefined（scraper 沒填），只能從卡名【X】解析。
  // ⭐ v6.210：本地那份（含自帶的 ZH_BY_TYPE 對照表）是中央 `isBasicEnergyOfType`
  //   （selection-filter.ts，內含同一份 ZH_ENERGY_TYPE）的**逐字複本** —— UI／AI 兩份漂移
  //   正是 v6.008／v6.129 兩次玩家回報的根因 ⇒ 改成薄殼委派中央述詞，7 個既有呼叫點不動。
  function isBasicEnergyOfType(card: Card | undefined, type: EnergyType): boolean {
    return isBasicEnergyOfTypeCentral(card as never, type);
  }

  function selectionTitle(type: string): string {
    // 支援效果層透過 params.titleOverride 客製標題（例：赤松要「選寶可夢附加能量」而非預設「回復」）
    const override = pendingSelection?.params?.titleOverride;
    if (typeof override === 'string' && override.length > 0) return override;
    if (type === 'deck-search')     return '從牌庫選擇';
    if (type === 'bench-choose')    return '選擇備戰寶可夢';
    if (type === 'opp-bench-choose') return '選擇對手的備戰寶可夢';
    if (type === 'opp-poke-choose') return '選擇對手的寶可夢';
    // v3.62：default 改為中性「選擇手牌」。
    //   原本「選擇丟棄的手牌」對誤用 hand-discard 為「附加 / 放回牌庫 / 互換」的卡會誤導玩家。
    //   真正丟棄的卡（高級球 / 交易 / 再構築 / 松葉的信心 等）addLog 已說「丟棄」，picker title 中立 OK。
    //   非丟棄的卡（激動渦輪 / 沙儷 / 碧綠之舞 / 無力充能 / 幸福禮物 / 金色火焰 / 能量撢子）
    //   都已在 effects 端傳 params.titleOverride 蓋過此 default。
    if (type === 'hand-discard')    return '選擇手牌';
    if (type === 'hand-choose')     return '從手牌選擇';
    if (type === 'active-energy-discard') return '選擇撤退要丟棄的能量';
    if (type === 'heal-target') {
      const override2 = pendingSelection?.params?.titleOverride;
      if (typeof override2 === 'string' && override2.length > 0) return override2;
      // v5.272: attach-tool effectKey 顯示明確 title (避免玩家誤以為是別的 modal)
      if (pendingSelection?.effectKey === 'attach-tool') {
        const toolInstAtt = pendingSelection?.params?.toolInst as { cardId: string } | undefined;
        const toolCardAtt = toolInstAtt ? getCard(toolInstAtt.cardId) : null;
        return toolCardAtt ? `為「${toolCardAtt.name}」選擇要附加的寶可夢` : '選擇要附加的寶可夢';
      }
      // v3.33 改通用標題：heal-target picker 同時用於回復、進化、附能量、退化、互換目標等情境
      //   先前「選擇回復的寶可夢」字面只描述其中一種用途，造成 UI 文字與實際情境不符
      return '選擇目標寶可夢';
    }
    if (type === 'discard-search')  return '從棄牌區選擇';
    if (type === 'damage-distribute') {
      const label = pendingSelection?.params?.label as string | undefined;
      return label ? `${label}：放置傷害指示物` : '放置傷害指示物';
    }
    if (type === 'energy-distribute') {
      const label = pendingSelection?.params?.label as string | undefined;
      const eName = pendingSelection?.params?.energyTypeName as string | undefined;
      const tail = eName ? `分配【${eName}】能量` : '分配能量';
      return label ? `${label}：${tail}` : tail;
    }
    if (type === 'modal-choice') {
      const label = pendingSelection?.params?.label as string | undefined;
      return label ? `${label}：選擇效果` : '選擇效果';
    }
    if (type === 'reorder-deck-top') return '排序牌庫頂';
    return '請選擇';
  }

  // v2.43：把 effects.ts 的 filter 字串翻成 UI 顯示文字。
  // 先前是一連串 .replace('Pokemon','寶可夢').replace('Energy','能量') 的鏈式替換，
  // 碰到 'PokemonNonExOrBasicEnergy' 這類複合名時會殘留英文（例：「寶可夢NonExOr基礎寶可夢能量」）。
  // 現在改為：已知 filter 優先查表；'Energy:Type' / 'Pokemon:Type' 走屬性規則；未列出者退回舊鏈。
  function describeFilter(f: string): string {
    const map: Record<string, string> = {
      'Basic':                         '基礎寶可夢',
      'Basic:HP70':                    'HP≤70 基礎寶可夢',
      'BasicEnergy':                   '基本能量',
      'BasicPsychicEnergy':            '基本【超】能量',
      'BasicFightingEnergy':           '基本【鬥】能量',
      'BasicEnergy:Grass+Lightning':   '基本【草】或基本【雷】能量',
      'BasicEnergy:Grass':             '基本【草】能量',
      'BasicEnergy:Lightning':         '基本【雷】能量',
      'Pokemon':                       '寶可夢',
      'PokemonOrEnergy':               '寶可夢或能量',
      'PokemonOrBasicEnergy':          '寶可夢或基本能量',
      'PokemonNonExOrBasicEnergy':     '寶可夢（非 ex）或基本能量',
      'WaterPokemonOrBasicWaterEnergy': '【水】寶可夢或基本【水】能量',
      'PokemonNonRule':                '非規則盒寶可夢',
      'Stage1':                        '1 階進化',
      'Stage2':                        '2 階進化',
      'Evolution':                     '進化卡',
      'Tool':                          '道具',
      'Stadium':                       '競技場卡',
      'Trainer':                       '訓練家',
      'AnyTrainer':                    '訓練家卡',
      'Any':                           '任意卡',
      'any':                           '任意卡',
      'Energy':                        '能量',
      'Item':                          '物品卡',
      'Supporter':                     '支援者',
      'ex':                            'ex 寶可夢',
      'MegaEx':                        '超級進化寶可夢 ex',
      'TeraPokemon':                   '「太晶」寶可夢',
      'MarniePokemon':                 '瑪俐的寶可夢',
      'CynthiaPokemon':                '竹蘭的寶可夢',
      'ErikaPokemon':                  '莉佳的寶可夢',
      'FightingBasicOrFightingEnergy': '基礎【鬥】寶可夢或【鬥】能量',
      'FightingPokemonOrBasicFightingEnergy': '【鬥】寶可夢或基本【鬥】能量',
      'GrassBasicOrGrassEnergy':       '基礎【草】寶可夢或【草】能量',
      'PsychicBasic':                  '基礎【超】寶可夢',
      'RocketBasic':                   '火箭隊基礎寶可夢',
      'RocketSupporter':               '火箭隊支援者',
      'ColorlessPokeHP100':            'HP≤100 的【無】寶可夢',
    };
    if (map[f]) return map[f];
    if (f.startsWith('Name:')) return '「' + f.slice('Name:'.length) + '」';  // v5.362
    const typeMap: Record<string, string> = {
      Grass: '【草】', Fire: '【火】', Water: '【水】', Lightning: '【雷】',
      Psychic: '【超】', Fighting: '【鬥】', Darkness: '【惡】', Metal: '【鋼】',
      Dragon: '【龍】', Fairy: '【妖】', Colorless: '【無】',
    };
    const mET = f.match(/^(Energy|Pokemon):(\w+)$/);
    if (mET) {
      const t = typeMap[mET[2]] ?? mET[2];
      return mET[1] === 'Energy' ? `基本${t}能量` : `${t}寶可夢`;
    }
    // v2.44：X:TOPn 複合 filter（如 Supporter:TOP6 = 牌庫頂 6 張中的支援者）
    const mKTop = f.match(/^(\w+):TOP(\d+)$/);
    if (mKTop) {
      const inner = map[mKTop[1]] ?? mKTop[1];
      return `牌庫頂 ${mKTop[2]} 張中的${inner}`;
    }
    const mTop = f.match(/^TOP(\d+)$/);
    if (mTop) return `前 ${mTop[1]} 張`;
    // fallback：舊的替換鏈（避免未列出的 filter 完全壞）
    return f.replace('Basic:HP70','HP≤70基礎')
            .replace('Basic','基礎寶可夢')
            .replace('Pokemon','寶可夢')
            .replace('Energy','能量');
  }

  // ─── v2.118 音效 / 攻擊動畫 ─────────────────────────────────────────────
  // attackFx：目前正在播放的攻擊動畫。active slot 會掛 class 根據這個 state。
  let attackFx = $state<{
    attackerIdx: 0 | 1;
    attackerIid: string;
    defenderIid: string | null;
    energyType: EnergyType;
    ts: number;
  } | null>(null);

  function triggerAttackFx(attackerIdx: 0 | 1, attackerIid: string, defenderIid: string | null, energyType: EnergyType) {
    const ts = Date.now();
    attackFx = { attackerIdx, attackerIid, defenderIid, energyType, ts };
    // 約略 600ms 後清除（shake 400ms + flash 500ms + buffer）
    setTimeout(() => { if (attackFx?.ts === ts) attackFx = null; }, 600);
  }

  /** action dispatch 後觸發對應音效 / 動畫（v2.118） */
  // v4.75 helper: 在 prevState 找指定 iid 的卡名（找遍 active/bench/hand/energy）
  function findCardNameByIid(state: GameState, iid: string, pool: Map<string, Card>): string {
    for (const p of state.players) {
      if (p.active?.iid === iid) return pool.get(p.active.cardId)?.name ?? '?';
      for (const b of p.bench) if (b.iid === iid) return pool.get(b.cardId)?.name ?? '?';
      for (const h of p.hand) if (h.iid === iid) return pool.get(h.cardId)?.name ?? '?';
      if (p.active) {
        for (const e of p.active.energyAttached) if (e.iid === iid) return pool.get(e.cardId)?.name ?? '?';
      }
      for (const b of p.bench) for (const e of b.energyAttached) if (e.iid === iid) return pool.get(e.cardId)?.name ?? '?';
    }
    return '?';
  }

  // v4.75 helper: 描述 action 給對手看（modal「對方上一手：XX」用）
  function describeUndoAction(action: any, prevState: GameState, pool: Map<string, Card>): string {
    const type = action.type;
    const nm = (iid: string) => findCardNameByIid(prevState, iid, pool);
    switch (type) {
      case 'ATTACK': {
        const idx = prevState.activePlayerIndex;
        const ac = prevState.players[idx].active;
        if (!ac) return '使用招式';
        const card = pool.get(ac.cardId);
        const atk = card?.attacks?.[action.attackIndex];
        return '使用招式「' + (atk?.name ?? '?') + '」';
      }
      case 'EVOLVE':
        return '進化：' + nm(action.fromIid) + ' → ' + nm(action.toIid);
      case 'PLAY_TRAINER':
        return '使用「' + nm(action.iid) + '」';
      case 'PLAY_BASIC':
        return '出基礎寶可夢「' + nm(action.iid) + '」到備戰';
      case 'PLAY_FOSSIL':
        return '出化石「' + nm(action.iid) + '」到備戰';
      case 'ATTACH_ENERGY':
        return '附加能量到「' + nm(action.targetIid) + '」';
      case 'RETREAT':
        return '撤退戰鬥場寶可夢';
      case 'USE_ABILITY': {
        const cardName = nm(action.iid);
        for (const p of prevState.players) {
          const all = [...(p.active ? [p.active] : []), ...p.bench];
          for (const inst of all) {
            if (inst.iid === action.iid) {
              const c = pool.get(inst.cardId);
              const ab = c?.abilities?.[action.abilityIndex];
              return '使用特性「' + (ab?.name ?? '?') + '」(' + cardName + ')';
            }
          }
        }
        return '使用特性 (' + cardName + ')';
      }
      default:
        return type;
    }
  }

  // v4.74 / v4.75 練習模式 — 悔棋按鈕點擊
  //   AI / 本機：直接回到 snapshot
  //   連線：發起 request 等對手同意
  async function performUndo() {
    if (!undoSnapshot) return;
    if (undoAwaitingResponse) return;
    if (undoDeniedThisSnapshot) return;

    if (mode === 'online') {
      // v4.75 連線練習模式：發起悔棋請求
      if (!roomCode || mySeatIdx < 0 || mySeatIdx > 1) return;
      if (!roomData?.allowUndo) return;
      undoAwaitingResponse = true;
      try {
        await requestUndoApi(roomCode, mySeatIdx, undoActionDesc ?? '上一手');
      } catch (e) {
        undoAwaitingResponse = false;
        console.warn('[undo] requestUndo failed:', e);
      }
      return;
    }

    // AI / 本機模式（v4.74）：直接回到 snapshot
    game = undoSnapshot;
    undoSnapshot = null;
    undoActionDesc = null;
    undoDeniedThisSnapshot = false;
    floatingEvoMenu = null;
    floatingRetreatMenu = null;
    selectedEnergyIid = null;
    // v5.276: defensive reset — 悔棋回到「特性觸發前」state 後, 殘留的 UI animation
    //   key 可能還對應 KO 後的 prize 狀態, 造成 prize 動畫卡住或重抓獎賞 modal 不關.
    //   bump prizeAnimKey 強迫 reactive 重算; clear arriving/justArrived 動畫 set.
    prizeAnimKey = [prizeAnimKey[0] + 1, prizeAnimKey[1] + 1];
    arrivingIids = new Set();
    justArrivedIids = new Set();
    console.log('[undo] 已悔棋一步（本機）');
  }

  // v4.75 連線：發起方取消請求（對手還沒回應前）
  async function cancelUndoRequest() {
    if (mode !== 'online' || !roomCode) return;
    try { await clearUndoRequestApi(roomCode); } catch (e) { console.warn('cancelUndo:', e); }
    undoAwaitingResponse = false;
  }

  // v4.75 連線：對手同意悔棋
  async function handleAgreeUndo() {
    if (mode !== 'online' || !roomCode) return;
    try { await agreeUndoApi(roomCode); } catch (e) { console.warn('agreeUndo:', e); }
  }

  // v4.75 連線：對手拒絕悔棋
  async function handleRejectUndo() {
    if (mode !== 'online' || !roomCode) return;
    try { await rejectUndoApi(roomCode); } catch (e) { console.warn('rejectUndo:', e); }
  }

  // v4.75 連線：監聽 roomData.undoRequest 變化（發起方 only）
  //   status='agreed' → push 自己的 snapshot 到 Firestore 並清掉 request
  //   status='rejected' → 設 denied flag，這個 snapshot 的悔棋按鈕消失（直到下個 action）
  //   注意：對手側看 status='pending' 顯示 modal，agree/reject 由 modal 按鈕觸發，不在此 effect 處理
  $effect(() => {
    if (mode !== 'online' || !roomData || !roomCode) return;
    if (mySeatIdx < 0 || mySeatIdx > 1) return;
    const req = roomData.undoRequest;
    if (!req || req.fromSeatIdx !== mySeatIdx) return;
    if (!undoAwaitingResponse) return;
    if (req.status === 'agreed' && undoSnapshot) {
      // 對手同意 → 把 snapshot 設成新的 game state 並 push
      const snap = undoSnapshot;
      (async () => {
        try {
          game = snap;
          // v5.390：atomic 寫 rollback + 清 undoRequest + bump marker（繞過 push/收端 stale guard）
          await pushUndoRollback(roomCode, snap);
          console.log('[undo] 對手同意，已 sync 上一手 state');
        } catch (e) {
          console.warn('[undo agreed] push failed:', e);
        }
        undoSnapshot = null;
        undoActionDesc = null;
        undoDeniedThisSnapshot = false;
        undoAwaitingResponse = false;
        floatingEvoMenu = null;
        floatingRetreatMenu = null;
        selectedEnergyIid = null;
      })();
    } else if (req.status === 'rejected') {
      // 對手拒絕 → 這個 snapshot 的按鈕消失（直到下個 action 產生新 snapshot）
      (async () => {
        try { await clearUndoRequestApi(roomCode); } catch (e) { /* ignore */ }
        undoDeniedThisSnapshot = true;
        undoAwaitingResponse = false;
        console.log('[undo] 對手拒絕，這個 snapshot 不能再悔棋');
      })();
    }
  });


  // ⭐v6.048：音效決策全部搬到 `$lib/audio/sfx-events.ts` 的純函式。
  //   原本這裡有三段各自為政的邏輯（本機 action / 休閒線上 diff / 錦標賽完全沒有），
  //   同一件事在不同模式聽到的東西不一樣。現在三條路徑都走 computeSfxEvents()，
  //   改一次全模式生效，而且規則可以用 scripts/test-sfx-events.mjs 自動驗證。
  function dispatchSfxForAction(
    action: ReturnType<typeof GameActions[keyof typeof GameActions]>,
    prev: GameState,
    next: GameState,
  ): void {
    try {
      playSfxEvents(computeSfxEvents(prev, next, action as unknown as ({ type: string } & Record<string, unknown>),
        pool, { mode, myPlayerIndex, aiPlayerIndex }));
    } catch { /* 音效不影響遊戲 */ }
  }

  /** 線上/觀戰：只有盤面（沒有 action 物件）時，一樣走同一套決策。 */
  function detectSpectatorStateDiffSfx(prev: GameState, next: GameState): void {
    try {
      if (prev.activePlayerIndex !== next.activePlayerIndex && next.phase === 'playing' && !isTReplay) {
        playSfx('turn-start');
      }
      playSfxEvents(computeSfxEvents(prev, next, null, pool, { mode, myPlayerIndex, aiPlayerIndex }));
    } catch { /* 音效不影響遊戲 */ }
  }

</script>

<svelte:head>
  {@html '<style>html, body { margin: 0; background-color: #162816 !important; min-height: 100vh; }</style>'}
</svelte:head>

<svelte:window onkeydown={onGlobalKey} onpointermove={onWindowPointerMove} onpointerup={onWindowPointerUp} />

<!-- v2.288：手機直式 + 戰鬥中時鎖 body 滑動，禁止 iOS Safari 整頁 bounce / pull-to-refresh -->
<svelte:body class:mp-locked={isPortraitMobile && !!game} />

<!-- v5.585 跨房錦標賽入場提醒：一般對戰中，我的錦標賽對戰可入場時頂部固定橫幅 -->
{#if tAlertReady}
  <div class="tourn-alert-banner">
    <span class="tourn-alert-txt">🏆 你報名的錦標賽對戰可以入場了！對手：<b>{tAlertMatch.oppName ?? '?'}</b></span>
    <a class="tourn-alert-go" href="{base}/tournament">⚔️ 前往入場</a>
    <button class="tourn-alert-x" onclick={() => (tAlertDismissedId = tAlertMatch.matchId)} aria-label="關閉提醒">✕</button>
  </div>
{/if}

<!-- ⭐⭐⭐v6.167 這個視窗**必須留在「大廳／對戰」兩個版面分支之外**（＝現在這個位置）。
     v6.160~v6.166 它被寫在下面那個 isTournament && tStep !== 'playing' 區塊的 else
     （＝對戰中）分支裡，而「✋ 我要報到」鈕在 then（＝大廳）分支 —— 兩者條件互斥，
     於是版本閘一擋人，視窗永遠畫不出來，玩家只看到「按了沒反應」＝被鎖在賽外，
     正是 v6.160 設計時列為唯一失敗模式的那一件事。
     ⚠ 同族事故：v6.149 失聯橫幅寫進桌機分支（手機玩家看不到）、v6.154 監控分頁沒有內容容器。
       通則：**跨版面的提示／視窗一律放在所有版面分支之外**，並用行為端守衛釘住可達性。
     守衛 scripts/test-v6167-checkin-never-locked.mjs 用 svelte 編譯器 AST 實跑求值
     報到鈕與本視窗的 if-chain，只要兩者出現互斥條件就 FAIL（不是字串比對）。 -->
<!-- ⭐⭐⭐v6.160 報到版本閘提示視窗。
     ⚠ 這個視窗**沒有 X 也沒有點背景關閉**，但那不是把人關起來 —— 兩顆鈕都會離開視窗，
       其中「先不更新，直接報到」一定會完成報到。刻意不給第三條「什麼都不做」的出口，
       是因為那條路只會讓玩家以為報到鈕壞了。
     ⚠ `tVerModalEventId` 只有 tCheckinBlockedByVersion() 回 true 時才會被設起來，
       而那支函式處處 fail-open（沒設門檻／版本解析不了／剛更新過／報到快截止 → 一律不擋）。 -->
{#if isTournament && !isTournSpectator && tVerModalEventId}
  <div class="tourn-vergate-mask" role="alertdialog" aria-modal="true" aria-labelledby="tvg-title">
    <div class="tourn-vergate">
      <div class="tvg-title" id="tvg-title">🔄 你的版本較舊，建議先更新</div>
      <div class="tvg-body">
        目前這個瀏覽器載入的是 <strong>v{VERSION}</strong>，賽事建議的最低版本是 <strong>v{tMinClientVer}</strong>。
        <br>舊版可能沒有近期的對戰修正，連線也容易卡頓，<b>並且會一起拖慢對手</b>。
        <br><span class="tvg-note">更新會清除網頁快取並重新載入，牌組與帳號資料都會保留。更新後請再按一次「我要報到」。</span>
      </div>
      <button class="tvg-btn tvg-primary" disabled={tVerModalBusy} onclick={tVerModalUpdate}>{tVerModalBusy ? '更新中…' : '🔄 更新並重新載入'}</button>
      <button class="tvg-btn tvg-ghost" disabled={tVerModalBusy} onclick={tVerModalSkip}>先不更新，直接報到</button>
    </div>
  </div>
{/if}

<!-- ⭐⭐⭐v6.188 棄賽確認框。站長裁定①：**棄賽不可逆、不開放玩家自助反悔**，
     所以按下去之前這一框是唯一的保護。它必須跟上面的版本閘視窗一樣放在**所有版面分支之外** ——
     v6.167 的教訓：跨版面的視窗寫進某個分支，就等於在另一個分支永遠畫不出來，
     而「畫不出來的確認框」＝ 按鈕按了沒反應，或更糟：某天有人為了「修好」它而把確認拿掉。 -->
{#if isTournament && !isTournSpectator && tDropConfirmEventId}
  <div class="tourn-vergate-mask" role="alertdialog" aria-modal="true" aria-labelledby="tdrop-title">
    <div class="tourn-vergate">
      <div class="tvg-title" id="tdrop-title">🏳 確定要棄賽嗎？</div>
      <div class="tvg-body">
        確定要棄賽嗎？棄賽後<b>無法復原</b>，你將不再被排入後續對戰。
        <br><span class="tvg-note">若目前這一場尚未結束，會直接判對手獲勝；已完成的戰績會保留在排名表上。誤按請聯絡站長。</span>
      </div>
      <button class="tvg-btn tvg-primary" disabled={tBusy} onclick={tDropCommit}>🏳 確定棄賽</button>
      <button class="tvg-btn tvg-ghost" disabled={tBusy} onclick={() => (tDropConfirmEventId = '')}>取消，我要繼續比賽</button>
    </div>
  </div>
{/if}

{#if isTournament && tStep !== 'playing'}
  <main class="lobby tourn-lobby">
    <div class="tourn-topbar"><a class="tourn-home-btn" href="{base}/">← 回到首頁</a></div>
    <h1 class="lobby-title">🏆 錦標賽對戰</h1>
    {#if tStep === 'waiting'}
      <!-- v5.597：waiting 畫面依情境分流。原本寫死「測試房」文案＋重置鈕，進真實對戰(tActiveRoom='mr_…')
           時 tEnterMatch 先設 waiting 就會閃這個錯畫面；若進場競態卡住更會困在此(重置鈕對真實對戰無用、
           又無返回鈕)。觀戰/測試房/真實對戰各給對應文案，真實對戰附「返回賽事大廳」逃生鈕。 -->
      {#if isTournSpectator}
        <p class="tourn-wait">⏳ 載入觀戰畫面中…</p>
        <button class="btn-secondary" onclick={tLeaveSpectate} disabled={tBusy}>返回賽事大廳</button>
      {:else if tActiveRoom === T_ROOM}
        <p class="tourn-wait">⏳ 已進場，等待對手加入…<br/>（請另一人也開 /tournament 選牌組進場）</p>
        <button class="btn-secondary" onclick={tournamentReset} disabled={tBusy}>重置測試房</button>
      {:else}
        <p class="tourn-wait">⏳ 進場中，正在載入對戰…</p>
        <button class="btn-secondary" onclick={tLeaveMatch} disabled={tBusy}>返回賽事大廳</button>
      {/if}
    {:else if isAnonymous}
      <p class="tourn-gate">🔒 錦標賽需要 email 帳號（不開放匿名）。請登入，或註冊新帳號：</p>
      <label class="tourn-field">Email
        <input class="name-input" type="email" bind:value={authEmail} placeholder="you@example.com" />
      </label>
      <label class="tourn-field">密碼
        <input class="name-input" type="password" bind:value={authPassword} placeholder="密碼（至少 6 碼）" onkeydown={(e) => e.key === 'Enter' && tournLogin()} />
      </label>
      {#if authError}<p class="warn">{authError}</p>{/if}
      <div class="tourn-auth-btns">
        <button class="btn-primary" onclick={tournLogin} disabled={tBusy}>登入</button>
        <button class="btn-secondary" onclick={tournRegister} disabled={tBusy}>註冊新帳號</button>
      </div>
    {:else}
      <p class="tourn-who">已登入：<b>{firebaseUser?.email}</b> <button class="tourn-logout" onclick={tournLogout} disabled={tBusy}>登出</button></p>
      <div class="tourn-tabs" role="tablist">
        <button class="tourn-tab" class:active={tTab === 'events'} role="tab" aria-selected={tTab === 'events'} onclick={() => tSwitchTab('events')}>🏆 賽事</button>
        <button class="tourn-tab" class:active={tTab === 'leaderboard'} role="tab" aria-selected={tTab === 'leaderboard'} onclick={() => tSwitchTab('leaderboard')}>📊 排行榜</button>
        <button class="tourn-tab" class:active={tTab === 'profile'} role="tab" aria-selected={tTab === 'profile'} onclick={() => tSwitchTab('profile')}>🪪 個人資料</button>
      </div>
      {#if tTab === 'events'}
      <div class="tourn-chat">
        <div class="tourn-chat-head">💬 大廳聊天室</div>
        <div class="tourn-chat-msgs" bind:this={tLobbyChatEl} onscroll={onLobbyChatScroll}>
          {#if tChat.length === 0}<div class="tcmsg muted">還沒有人發言，來說聲哈囉吧～</div>{/if}
          {#each tChat as m (m.id)}
            <div class="tcmsg {m.sys ? tSysClass(m.text) : ''}" class:tcsys={m.sys} class:tcadmin={m.admin}>{#if m.ts}<span class="tctime">{tFmtMsgTime(m.ts)}</span>{/if}<span class="tcname">{#if m.admin}🛡️ {/if}{m.name}</span>：{m.text}</div>
          {/each}
        </div>
        {#if tCanChat || tIsAdmin}
          <div class="tourn-chat-input">
            <input bind:value={tChatInput} maxlength="200" placeholder="說點什麼…（Enter 送出）" onkeydown={(e) => e.key === 'Enter' && tChatSend()} />
            <button class="btn-secondary small" onclick={tChatSend} disabled={!tChatInput.trim()}>送出</button>
          </div>
        {:else}
          <div class="tourn-chat-input"><span class="muted small" style="padding:4px 8px;">🔒 請先登入即可在此發言</span></div>
        {/if}
      </div>
      {#if tEvents.length === 0}
        <div class="tourn-event"><p class="muted small">目前沒有開放中的賽事。</p></div>
      {/if}
      <!-- v5.629 玩家發起社群賽 -->
      {#if firebaseUser?.email && !tHasCommunityEvent}
        {#if !tProposeOpen}
          <button class="btn-primary tourn-join" style="margin:4px 0;" onclick={() => { tProposeOpen = true; tError = ''; }} disabled={tBusy}>📣 我要發起社群賽</button>
        {:else}
          <div class="tourn-event">
            <h3>📣 發起社群賽</h3>
            <p class="muted small">募集時間內皆可報名，時間結束時達門檻（單淘汰 4 人／瑞士 8 人）即自動開賽；但若接近網站預定賽事舉辦時間則不開放。</p>
            <label class="tourn-field">賽事名稱<input class="name-input" maxlength="30" bind:value={tProposeName} placeholder="例：週五歡樂盃" /></label>
            <label class="tourn-field">賽制
              <select class="deck-select" bind:value={tProposeFormat}>
                <option value="single-elim">單淘汰 Bo1（最少 4 人開賽）</option>
                <option value="swiss">瑞士制 + Top Cut Bo1（最少 8 人開賽）</option>
              </select>
            </label>
            <label class="tourn-field">募集時間
              <select class="deck-select" bind:value={tProposeRally}>
                <option value={5}>5 分鐘</option>
                <option value={15}>15 分鐘</option>
                <option value={30}>30 分鐘</option>
                <option value={60}>60 分鐘</option>
              </select>
            </label>
            <label class="tourn-field">你的暱稱<input class="name-input" maxlength="16" bind:value={tNickname} placeholder="輸入暱稱（最多 16 字）" /></label>
            <label class="tourn-field">你的牌組（需 60 張）
              <select class="deck-select" bind:value={tDeckId}>
                <option value="" disabled>— 請選擇牌組 —</option>
                {#if decks.length > 0}<optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>{/if}
                {#if PRESET_DECKS.length > 0}<optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>{/if}
              </select>
            </label>
            <label class="tourn-field">硬幣勝出時，你要：
              <select class="deck-select" bind:value={tCoinPref}><option value="random">隨機（不指定）</option><option value="first">先攻</option><option value="second">後攻</option></select>
            </label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
              <button class="btn-primary tourn-join" onclick={tPropose} disabled={tBusy || !tDeckId || !tNickname.trim() || !tProposeName.trim()}>{tBusy ? '發起中…' : '📣 確認發起（你會自動報名）'}</button>
              <button class="btn-secondary small" onclick={() => { tProposeOpen = false; tError = ''; }} disabled={tBusy}>取消</button>
            </div>
          </div>
        {/if}
      {/if}
      <!-- ⭐⭐v6.188 報名表單抽成 snippet：報名階段與「報到階段補報名」**共用同一份**。
           兩份各自維護必然漂移（改了一邊忘了另一邊 ＝ 其中一條路徑的驗證條件與後端對不上）。
           lateJoin=true ⇒ 送 /register-and-checkin（報名＋報到單筆一次到位）；否則走原本的 /register。 -->
      {#snippet regForm(ev, lateJoin)}
              <div class="tourn-reg-form">
                <label class="tourn-field">錦標賽暱稱（對戰／聊天室／賽程表都以此顯示）
                  <input class="name-input" maxlength="16" bind:value={tNickname} placeholder="輸入暱稱（最多 16 字）" />
                </label>
                <label class="tourn-field">選擇牌組（需 60 張）
                  <select class="deck-select" bind:value={tDeckId}>
                    <option value="" disabled>— 請選擇牌組 —</option>
                    {#if decks.length > 0}
                      <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
                    {/if}
                    {#if PRESET_DECKS.length > 0}
                      <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
                    {/if}
                  </select>
                </label>
                <label class="tourn-field">硬幣勝出時，你要：
                  <select class="deck-select" bind:value={tCoinPref}>
                    <option value="random">隨機（不指定）</option>
                    <option value="first">先攻</option>
                    <option value="second">後攻</option>
                  </select>
                  <span class="tourn-coin-hint">（贏得開場擲幣時，依此自動安排；輸的話由對手決定）</span>
                </label>
                <div class="tourn-reg-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                  <button class="btn-primary tourn-join" onclick={() => (lateJoin ? tLateJoin(ev._id) : tournEnroll(ev._id))} disabled={tBusy || !tDeckId || !tNickname.trim()}>{tBusy ? (lateJoin ? '補報名中…' : '報名中…') : (lateJoin ? '✅ 確認補報名並直接報到' : '✅ 確認報名（鎖定暱稱與牌組）')}</button>
                  <button class="btn-secondary small" onclick={() => { tRegFormEventId = ''; tError = ''; }} disabled={tBusy}>取消</button>
                </div>
              </div>
      {/snippet}
      {#snippet eventCard(ev)}
        <div class="tourn-event">
          <h3>🏆 {ev.name}</h3>
          {#if ev.createdByPlayer}<p class="muted small" style="margin:2px 0;color:#8fdcc0;">📣 玩家社群賽{#if ev.proposerName}（{ev.proposerName} 發起）{/if}{#if ev.minPlayers} ｜ 響應 {ev.regCount ?? 0}/{ev.minPlayers} 人{/if}</p>{/if}
          <p class="tourn-evstat">狀態：<b>{tEventStatusLabel(ev.status)}</b> ｜ 報名 {ev.regCount ?? 0}{ev.maxPlayers ? ' / ' + ev.maxPlayers : '（不限）'} 人 ｜ {ev.format === 'swiss-then-cut' ? '瑞士制 + Top Cut Bo1' : '單敗淘汰 Bo1'} ｜ 每場 {ev.roundLimitMin} 分</p>
          {#if ev.status === 'draft' && ev.registrationOpenAt}<p class="muted small">⏳ 報名將於 {new Date(ev.registrationOpenAt).toLocaleString()} 開放</p>{/if}
          {#if ev.status === 'registration' && ev.registrationCloseAt}<p class="muted small">⏰ 報名截止：{new Date(ev.registrationCloseAt).toLocaleString()}（到點自動公布賽程並開賽）</p>{/if}
          {#if ev.status === 'draft' && ev.registrationOpenAt}
            {@const _toOpen = ev.registrationOpenAt - tNow}
            {#if _toOpen > 0}<div class="tourn-cdbox"><div class="tourn-cdbox-label">⏳ 報名開放倒數</div><div class="tourn-cdbox-time">{fmtCountdown(_toOpen)}</div></div>{/if}
          {/if}
          {#if ev.status === 'registration' && ev.registrationCloseAt}
            {@const _toStart = ev.registrationCloseAt - tNow}
            <div class="tourn-cdbox" class:urgent={_toStart > 0 && _toStart <= 300000}>
              {#if _toStart > 0}
                <div class="tourn-cdbox-label">⏰ 距離開賽倒數</div>
                <div class="tourn-cdbox-time">{fmtCountdown(_toStart)}</div>
              {:else}
                <div class="tourn-cdbox-label">🔔 報名截止，賽程即將公布，請準備進場！</div>
              {/if}
            </div>
          {/if}
          {#if ev.status === 'checkin'}
            {@const _ciMs = (ev.checkInDeadline ?? 0) - tNow}
            <div class="tourn-cdbox urgent">
              <div class="tourn-cdbox-label">📋 報到階段{#if _ciMs > 0} ｜ 剩 {fmtCountdown(_ciMs)}{/if}</div>
              {#if !ev.registered}
                <!-- ⭐⭐⭐v6.188 補報名＋直接報到：報到階段對「未報名者」直接開報名表單（重用同一份）。
                     後端是**單筆 insertOne**（checkedIn:true + lateJoin:true），沒有「報了名卻沒報到」的中間態。 -->
                <div class="muted small">你尚未報名這一場 —— 現在補報名可以<b>直接完成報到</b>（報到結束後依「已報到者」產生賽程）。</div>
                {#if tRegFormEventId === ev._id}
                  {@render regForm(ev, true)}
                {:else}
                  <button class="tourn-enter-btn" onclick={() => { tRegFormEventId = ev._id; tError = ''; }} disabled={tBusy}>📝 補報名並報到</button>
                {/if}
                {#if tCheckinErrId === ev._id && tError}<p class="warn small" style="margin-top:4px;">{tError}</p>{/if}
              {:else if ev.checkedIn}
                <div class="reg-ok">✅ 你已報到，等待開賽…</div>
              {:else}
                <button class="tourn-enter-btn" onclick={() => tCheckin(ev._id)} disabled={tBusy}>{tBusy ? '報到中…' : '✋ 我要報到'}</button>
                <div class="muted small" style="margin-top:4px;">逾時未報到將不列入賽程</div>
                <div class="muted small" style="margin-top:2px;">按了沒反應請再按一次；如仍無法報到，請至首頁更新版本。</div>
                {#if tCheckinErrId === ev._id && tError}<p class="warn small" style="margin-top:4px;">{tError}</p>{/if}
              {/if}
            </div>
          {/if}
          {#if ev.status === 'running' && ev.registered && ev.checkedIn}
            <!-- ⭐⭐⭐v6.188 中途棄賽鈕（單淘汰賽語意＝投降）。⚠ 只開確認框，**不會直接送出**。 -->
            {#if ev.dropped}
              <p class="warn small" style="margin:6px 0;">🏳 你已棄賽，不會再被排入後續對戰（已完成的戰績仍保留在排名表上）。</p>
            {:else}
              <button class="btn-secondary small" style="border-color:#a4434a;color:#ff9b9b;margin-top:6px;" onclick={() => tDropRequest(ev._id)} disabled={tBusy}>🏳 棄賽（退出本賽事）</button>
            {/if}
          {/if}
          {#if ev.registered}
            <p class="reg-ok">✅ 你已報名 ｜ 暱稱：<b>{ev.myName}</b> ｜ 鎖定牌組：<b>{ev.myDeckName ?? '（已選定）'}</b> ｜ 先後攻：<b>{coinPrefLabel(ev.myCoinPref ?? readCoinPref(ev._id))}</b></p>
            {#if ev.status === 'registration'}<button class="btn-secondary small" onclick={() => tournUnregister(ev._id)} disabled={tBusy}>退賽</button>{/if}
            {#if ev.isProposer && ev.createdByPlayer && ev.status === 'registration' && (ev.regCount ?? 0) < (ev.minPlayers ?? 4)}<button class="btn-secondary small" style="border-color:#a4434a;color:#ff9b9b;margin-left:6px;" onclick={() => tCancelProposal(ev._id)} disabled={tBusy}>🚫 取消比賽</button>{/if}
          {:else if ev.status === 'registration'}
            {#if tRegFormEventId === ev._id}
              {@render regForm(ev, false)}
            {:else}
              <button class="btn-primary tourn-join" onclick={() => { tRegFormEventId = ev._id; tError = ''; }} disabled={tBusy}>{ev.createdByPlayer ? '✋ 我要響應（報名）' : '📝 報名這一場'}</button>
            {/if}
          {/if}
        </div>
      {/snippet}
      <!-- v5.620：進行中／即將開始的賽事優先（其賽程表、觀戰選單排在「下一場報名」視窗之上）-->
      {#each tRunningEvents as ev (ev._id)}{@render eventCard(ev)}{/each}
      <!-- v5.937 官方+社群賽並行:每個進行中賽事各顯示賽程表(含瑞士排名)+內嵌觀戰(觀戰按鈕併入每場VS,省版面) -->
      {#snippet myMatchBox()}
        {@const _waitMs = (tMyMatch.enterOpenAt ?? 0) - tNow}
        {@const _dlMs = (tMyMatch.noShowDeadline ?? 0) - tNow}
        <div class="tourn-mymatch">
          <span>🔔 第 {tMyMatch.round} 輪 ｜ 對手：<b>{tMyMatch.oppName}</b></span>
          {#if _waitMs > 0}
            <span class="tourn-cd">⏳ 休息倒數 {Math.floor(_waitMs / 60000)}:{String(Math.floor((_waitMs % 60000) / 1000)).padStart(2, '0')} 後可進場</span>
          {:else}
            <button class="tourn-enter-btn" onclick={tEnterMatch} disabled={tBusy}>{tBusy ? '進場中…' : (tMyMatch.entered ? '⚔️ 回到對戰' : '⚔️ 立即進入對戰')}</button>
          {/if}
        </div>
        {#if _waitMs <= 0 && tMyMatch.noShowDeadline && _dlMs > 0 && !tMyMatch.entered}
          <p class="muted small" style="text-align:center;color:#e8a;">⏰ 請於 {Math.floor(_dlMs / 60000)}:{String(Math.floor((_dlMs % 60000) / 1000)).padStart(2, '0')} 內進場，逾時判負離席</p>
        {/if}
      {/snippet}
      {#snippet myByeBox()}
        {@const _byeMs = (tMyBye.enterOpenAt ?? 0) - tNow}
        <div class="tourn-mymatch">
          <span>💤 第 {tMyBye.round} 輪 ｜ 你本輪<b>輪空</b>（自動晉級，不需進場）</span>
          {#if _byeMs > 0}
            <span class="tourn-cd">⏳ 其他對戰休息倒數 {Math.floor(_byeMs / 60000)}:{String(Math.floor((_byeMs % 60000) / 1000)).padStart(2, '0')} 後開打，屆時可到賽程表點 VS👁 觀戰</span>
          {:else}
            <span class="tourn-cd">👁 其他對戰已開放進場，可到賽程表點 VS👁 觀戰</span>
          {/if}
        </div>
      {/snippet}
      {#snippet bracketBlock(brk)}
        {#if brk.standings && brk.standings.length}
          <div class="tourn-bracket">
            <div class="tourn-bracket-head">📊 {brk.event?.name ?? ''} 瑞士制排名{#if brk.event?.phase === 'cut'} ｜ 已進入 Top Cut{:else if brk.event?.swissRounds} ｜ 第 {liveRoundOf(brk)}/{brk.event.swissRounds} 輪{/if}{#if tBracketsStale}<span class="tourn-stale" title="連線不穩，畫面顯示的是上一次成功取得的賽程，正在重新取得">· 更新中</span>{/if}</div>
            <div style="display:grid;grid-template-columns:34px 1fr 60px 48px 60px;gap:3px 8px;font-size:13px;align-items:center;padding:4px 2px;">
              <div style="font-weight:700;color:#9ab;text-align:center;">#</div><div style="font-weight:700;color:#9ab;">玩家</div><div style="font-weight:700;color:#9ab;text-align:center;">戰績</div><div style="font-weight:700;color:#9ab;text-align:center;">OWP</div><div style="font-weight:700;color:#9ab;text-align:center;">OOWP</div>
              {#each standingsKeyed(brk.standings) as s (s._k)}
                <div style="text-align:center;{s.mine ? 'color:#ffd56b;font-weight:700;' : ''}">{s.rank}</div>
                <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;{s.mine ? 'color:#ffd56b;font-weight:700;' : ''}">{s.name}{#if s.mine} （你）{/if}</div>
                <div style="text-align:center;">{s.w}-{s.l}</div>
                <div style="text-align:center;color:#9ab;">{s.owp}%</div>
                <div style="text-align:center;color:#9ab;">{s.oowp}%</div>
              {/each}
            </div>
          </div>
        {/if}
        {#if brk.matches && brk.matches.length}
          <div class="tourn-bracket">
            <div class="tourn-bracket-head">📋 {brk.event?.name ?? ''} 賽程表{#if brk.event?.championName} ｜ 🏆 冠軍：<b>{brk.event.championName}</b>{/if}{#if tBracketsStale}<span class="tourn-stale" title="連線不穩，畫面顯示的是上一次成功取得的賽程，正在重新取得">· 更新中</span>{/if}</div>
            {#if tMyMatch && tMyMatch.eventId === brk.event?._id && !tMatchAlreadyDone(brk, tMyMatch)}
              {@render myMatchBox()}
            {:else if tMyBye && tMyBye.eventId === brk.event?._id}
              {@render myByeBox()}
            {/if}
            {#if brk.event}
              {@const _maxRound = brk.matches.reduce((mx: number, m: any) => Math.max(mx, m.round), 1)}
              {@const _rounds = Math.max(brk.event.rounds ?? 1, _maxRound)}
              {@const _page = pageOf(brk, _rounds)}
              {@const _curR = liveRoundOf(brk)}
              {@const _roundMatches = brk.matches.filter((m: any) => m.round === _page)}
              {@const _isCut = _roundMatches.some((m: any) => m.phase === 'cut')}
              {@const _isSwiss = _roundMatches.some((m: any) => m.phase === 'swiss')}
              {@const _cutPlayers = _roundMatches.reduce((n: number, m: any) => n + (m.p2name != null ? 2 : 1), 0)}
              <div class="tourn-bracket-pager">
                <button class="tourn-pg-btn" onclick={() => setBracketPage(brk, _page - 1)} disabled={_page <= 1}>◀ 上一輪</button>
                <span class="tourn-pg-title">{_isSwiss ? '瑞士第 ' + _page + ' 輪' : _isCut ? (_cutPlayers <= 2 ? '🏆 決賽' : _cutPlayers + '強賽') : (_page === _rounds ? '🏆 決賽' : '第 ' + _page + ' 輪')}{#if _page === _curR}<span class="tourn-pg-cur"> 進行中</span>{/if}</span>
                <button class="tourn-pg-btn" onclick={() => setBracketPage(brk, _page + 1)} disabled={_page >= _rounds}>下一輪 ▶</button>
              </div>
              <div class="tourn-round">
                {#if _roundMatches.length === 0}
                  <div class="muted small" style="text-align:center;padding:14px;">此輪賽程尚未產生（前一輪打完才會排定）</div>
                {/if}
                <!-- v6.177 穩定 key：沒有 key 時 Svelte 依索引重用 DOM，輪次推進/名次變動會整排重畫造成閃爍 -->
                {#each _roundMatches as m (m.round + '_' + m.idx)}
                  {@const _canSpec = m.status === 'playing' && m.roomId && !m.mine}
                  {@const _mid = brk.event._id + '_r' + m.round + '_m' + m.idx}
                  <div class="tourn-match" class:mine={m.mine} class:done={m.status === 'done'} class:bye={m.bye}>
                    <span class="tm-side tm-p1" class:win={m.winner === 'p1'} title={m.p1name ?? ''}>{m.p1name ?? '—'}</span>
                    {#if _canSpec}
                      <button class="tm-vs tm-vs-spec" title="👁 點此觀戰這場對戰（目前 {m.viewers ?? 0} 人觀戰中）" onclick={() => tSpectate(m.roomId)} disabled={tBusy}>VS👁{(m.viewers ?? 0) > 0 ? '(' + m.viewers + ')' : ''}</button>
                    {:else if m.status === 'playing' && (m.viewers ?? 0) > 0}
                      <span class="tm-vs" title="目前 {m.viewers} 人觀戰中">VS 👁{m.viewers}</span>
                    {:else if m.status === 'done' && !m.bye}
                      <button class="tm-vs tm-vs-replay" title="🎬 觀看這場對戰回放" onclick={() => tStartReplay(_mid)} disabled={tBusy}>▶回放</button>
                    {:else}
                      <span class="tm-vs">{m.bye ? '輪空' : 'VS'}</span>
                    {/if}
                    <span class="tm-side tm-p2" class:win={m.winner === 'p2'} title={m.p2name ?? ''}>{m.bye ? '—' : (m.p2name ?? '—')}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/snippet}
      <!-- v5.937 進場鈕保底(判負攸關):tMyMatch/tMyBye 存在但沒對應到已載入的 bracket → 頂層獨立渲染,避免進場鈕消失吃 noShow 判負 -->
      {#if tMyMatch && !tBrackets.some((b) => b.event?._id === tMyMatch.eventId)}
        <div class="tourn-bracket">{@render myMatchBox()}</div>
      {:else if tMyBye && !tBrackets.some((b) => b.event?._id === tMyBye.eventId)}
        <div class="tourn-bracket">{@render myByeBox()}</div>
      {/if}
      {#each tBrackets as brk (brk.event._id)}
        {@render bracketBlock(brk)}
      {/each}
      <!-- ⭐v6.177 核心②：真的沒有資料可畫時仍要有合理的空狀態（舊版是什麼都不畫＝整區憑空消失）。 -->
      {#if tBrackets.length === 0 && tRunningEvents.length > 0}
        <div class="tourn-bracket">
          <div class="muted small" style="text-align:center;padding:14px;">
            {tBracketsEverOk ? '賽程更新中…（連線不穩，正在重新取得）' : '賽程載入中…'}
          </div>
        </div>
      {/if}
      <!-- v5.620：報名中／籌備中的賽事（下一場、下下場…）排在進行中賽事與觀戰之下 -->
      {#each tUpcomingEvents as ev (ev._id)}{@render eventCard(ev)}{/each}
      <!-- v5.652 名人堂分兩段下拉：網站賽（在前、預設展開「直接呈現」）與社群自辦賽（在後、預設收摺「點選才看」）。
           v6.110 更名：使用者可見文字一律「網站賽」，不再用「官方賽」——本站是非官方同好站，
           用「官方」會被誤會成寶可夢官方、有版權爭議。⚠ 資料欄位（communityEvent／championsOfficial）不動。
           因網站賽人數多、社群自辦賽人數少（最低 4 人），奪冠難度不同，分開呈現較清楚。依 communityEvent 旗標分流。 -->
      {#if tChampions.some((c) => !c.communityEvent)}
        <div class="tourn-bracket tourn-hof">
          <div class="tourn-bracket-head tourn-hof-toggle" role="button" tabindex="0" style="cursor:pointer;user-select:none;" onclick={() => tHofOfficialOpen = !tHofOfficialOpen} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (tHofOfficialOpen = !tHofOfficialOpen)}>
            <span style="display:inline-block;width:1em;">{tHofOfficialOpen ? '▾' : '▸'}</span>🏛️ 網站賽歷屆冠軍（{tChampions.filter((c) => !c.communityEvent).length}）<span class="muted small" style="font-weight:400;">{tHofOfficialOpen ? ' ｜ 點擊冠軍看當初賽程' : ' ｜ 點此展開'}</span>
          </div>
          {#if tHofOfficialOpen}
          {#each tChampions.filter((c) => !c.communityEvent) as c (c.id)}
            <div class="tourn-hof-row tourn-hof-clickable" role="button" tabindex="0" onclick={() => tHofOpen(c)} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && tHofOpen(c)}>
              <span class="tourn-hof-trophy">🏆</span>
              <span class="tourn-hof-name">{c.championName}</span>
              <span class="tourn-hof-meta">{c.eventName}{#if c.deckName} ｜ {c.deckName}{/if}{#if c.playerCount} ｜ {c.playerCount} 人{/if}{#if c.finishedAt} ｜ {new Date(c.finishedAt).toLocaleDateString('zh-TW')}{/if}</span>
              {#if c.eventId}<span class="tourn-hof-go">賽程 ▸</span>{/if}
            </div>
          {/each}
          {/if}
        </div>
      {/if}
      {#if tChampions.some((c) => c.communityEvent)}
        <div class="tourn-bracket tourn-hof">
          <div class="tourn-bracket-head tourn-hof-toggle" role="button" tabindex="0" style="cursor:pointer;user-select:none;" onclick={() => tHofCommunityOpen = !tHofCommunityOpen} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (tHofCommunityOpen = !tHofCommunityOpen)}>
            <span style="display:inline-block;width:1em;">{tHofCommunityOpen ? '▾' : '▸'}</span>🎖️ 社群自辦歷屆冠軍（{tChampions.filter((c) => c.communityEvent).length}）<span class="muted small" style="font-weight:400;">{tHofCommunityOpen ? ' ｜ 點擊冠軍看當初賽程' : ' ｜ 點此展開'}</span>
          </div>
          {#if tHofCommunityOpen}
          {#each tChampions.filter((c) => c.communityEvent) as c (c.id)}
            <div class="tourn-hof-row tourn-hof-clickable" role="button" tabindex="0" onclick={() => tHofOpen(c)} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && tHofOpen(c)}>
              <span class="tourn-hof-trophy">🎖️</span>
              <span class="tourn-hof-name" style="color:#8fdcc0;">{c.championName} <span style="font-size:.6rem;background:#2a6a55;color:#dff;border-radius:4px;padding:1px 5px;vertical-align:middle;">社群</span></span>
              <span class="tourn-hof-meta">{c.eventName}{#if c.deckName} ｜ {c.deckName}{/if}{#if c.playerCount} ｜ {c.playerCount} 人{/if}{#if c.finishedAt} ｜ {new Date(c.finishedAt).toLocaleDateString('zh-TW')}{/if}</span>
              {#if c.eventId}<span class="tourn-hof-go">賽程 ▸</span>{/if}
            </div>
          {/each}
          {/if}
        </div>
      {/if}
      {#if tHofLoading}
        <div class="hof-modal-backdrop" role="presentation"><div class="hof-modal"><p class="muted" style="text-align:center;margin:18px 0;">載入賽程中…</p></div></div>
      {/if}
      {#if tHofView}
        {@const _hr = Math.max(1, tHofView.rounds ?? 1)}
        {@const _hpg = Math.min(Math.max(1, tHofPage), _hr)}
        {@const _hrm = (tHofView.matches ?? []).filter((m: any) => m.round === _hpg)}
        <div class="hof-modal-backdrop" role="presentation" onclick={tHofClose}>
          <div class="hof-modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && tHofClose()}>
            <div class="tourn-bracket-head">📋 {tHofView.eventName ?? '錦標賽'}{#if tHofView.championName} ｜ 🏆 {tHofView.championName}{/if}<button class="hof-modal-x" onclick={tHofClose} aria-label="關閉">✕</button></div>
            <div class="tourn-bracket-pager">
              <button class="tourn-pg-btn" onclick={() => tHofPage = Math.max(1, _hpg - 1)} disabled={_hpg <= 1}>◀ 上一輪</button>
              <span class="tourn-pg-title">{_hpg === _hr ? '🏆 決賽' : '第 ' + _hpg + ' 輪'}</span>
              <button class="tourn-pg-btn" onclick={() => tHofPage = Math.min(_hr, _hpg + 1)} disabled={_hpg >= _hr}>下一輪 ▶</button>
            </div>
            <div class="tourn-round">
              {#if _hrm.length === 0}<div class="muted small" style="text-align:center;padding:14px;">此輪無對戰紀錄</div>{/if}
              {#each _hrm as m}
                {@const _hasLog = m.status === 'done' && !m.bye && m.p1name && m.p2name}
                <div class="tourn-match" class:done={m.status === 'done'} class:bye={m.bye} class:tourn-match-log={_hasLog}
                  role={_hasLog ? 'button' : undefined} tabindex={_hasLog ? 0 : undefined}
                  title={_hasLog ? '點擊查看這場對戰戰報' : ''}
                  onclick={() => { if (_hasLog) tMatchLogOpen(m.round, m.idx, m.p1name, m.p2name); }}
                  onkeydown={(e) => { if (_hasLog && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tMatchLogOpen(m.round, m.idx, m.p1name, m.p2name); } }}>
                  <span class="tm-side tm-p1" class:win={m.winner === 'p1'} title={m.p1name ?? ''}>{m.p1name ?? '—'}</span>
                  {#if _hasLog}
                    <button class="tm-vs tm-vs-replay" title="🎬 觀看這場對戰回放" onclick={(e) => { e.stopPropagation(); const _mid = tHofEventId + '_r' + m.round + '_m' + m.idx; tHofClose(); tStartReplay(_mid); }}>▶回放</button>
                  {:else}
                    <span class="tm-vs">{m.bye ? '輪空' : 'VS'}</span>
                  {/if}
                  <span class="tm-side tm-p2" class:win={m.winner === 'p2'} title={m.p2name ?? ''}>{m.bye ? '—' : (m.p2name ?? '—')}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
      {#if tMatchLog || tMatchLogLoading}
        <div class="hof-modal-backdrop" role="presentation" onclick={tMatchLogClose}>
          <div class="hof-modal mlog-modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && tMatchLogClose()}>
            <div class="tourn-bracket-head">📜 對戰戰報 ｜ {tMatchLogTitle}<button class="hof-modal-x" onclick={tMatchLogClose} aria-label="關閉">✕</button></div>
            {#if tMatchLogLoading}
              <p class="muted" style="text-align:center;margin:18px 0;">載入戰報中…</p>
            {:else if !tMatchLog || (tMatchLog.log?.length ?? 0) === 0}
              <p class="muted" style="text-align:center;margin:18px 0;">{tMatchLog?.error ?? '這場沒有可顯示的戰報紀錄。'}</p>
            {:else}
              {#if tMatchLog.winnerName}<p class="muted small" style="text-align:center;margin:2px 0 8px;">🏆 勝者：{tMatchLog.winnerName}{#if tMatchLog.turn} ｜ 共 {tMatchLog.turn} 回合{/if}</p>{/if}
              <div class="mlog-list">
                {#each tMatchLog.log as entry}
                  {@const _mlc = logLineClass(entry.message ?? '')}
                  {@const _mtk = tokenizeLogMessage(entry.message ?? '', cardNamesSorted)}
                  <div class="log-line {_mlc}" class:log-sys={entry.playerIndex === null}>
                    {#each _mtk as tok}{#if tok.cls === 'log-card-link'}<button type="button" class="log-card-link" onclick={() => openZoomByName(tok.text, tok.iid ?? entry.sourceIid, entry.playerIndex)}>{tok.text}</button>{:else}<span class={tok.cls}>{tok.text}</span>{/if}{/each}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}
      {:else if tTab === 'leaderboard'}
        <div class="tourn-lb">
          {#if tLbLoading && !tLeaderboard}
            <p class="muted small" style="text-align:center;padding:18px;">載入排行榜中…</p>
          {:else if !tLeaderboard}
            <p class="muted small" style="text-align:center;padding:18px;">排行榜尚未開放，或目前還沒有已結束的賽事資料。</p>
          {:else}
            {#snippet lbBoard(title, rows, unit)}
              <div class="tourn-lb-card">
                <div class="tourn-lb-title">{title}</div>
                {#if !rows || rows.length === 0}
                  <div class="tourn-lb-empty">尚無資料</div>
                {:else}
                  {#each lbTopRows(rows, tLbTop) as r, i}
                    <div class="tourn-lb-row">
                      <span class="tourn-lb-rank tourn-lb-rank-{i + 1}">{i + 1}</span>
                      <span class="tourn-lb-name">{r.displayName}</span>
                      <span class="tourn-lb-cnt">{r.count} {unit}</span>
                    </div>
                  {/each}
                {/if}
              </div>
            {/snippet}
            {#if typeof tLeaderboard.limit === 'number'}
            <div class="tourn-lb-bar">
              <label class="tourn-lb-toplbl" for="tourn-lb-top">顯示名次</label>
              <select id="tourn-lb-top" class="tourn-lb-topsel" value={String(tLbTop)} onchange={(e) => tLbSetTop(e.currentTarget.value)}>
                {#each LB_TOP_OPTIONS as _n}<option value={String(_n)}>前 {_n} 名</option>{/each}
              </select>
            </div>
            {/if}
            <div class="tourn-lb-grid">
              <div class="tourn-lb-card tourn-lb-champ">
                <div class="tourn-lb-title">🏆 冠軍榜</div>
                <div class="tourn-lb-champ-cols">
                  <div>
                    <div class="tourn-lb-sub">🏛️ 網站賽</div>
                    {#if !tLeaderboard.champions?.official?.length}<div class="tourn-lb-empty">尚無資料</div>{/if}
                    {#each lbTopRows(tLeaderboard.champions?.official, tLbTop) as r, i}
                      <div class="tourn-lb-row"><span class="tourn-lb-rank tourn-lb-rank-{i + 1}">{i + 1}</span><span class="tourn-lb-name">{r.displayName}</span><span class="tourn-lb-cnt">{r.count} 冠</span></div>
                    {/each}
                  </div>
                  <div>
                    <div class="tourn-lb-sub">🎖️ 社群賽</div>
                    {#if !tLeaderboard.champions?.community?.length}<div class="tourn-lb-empty">尚無資料</div>{/if}
                    {#each lbTopRows(tLeaderboard.champions?.community, tLbTop) as r, i}
                      <div class="tourn-lb-row"><span class="tourn-lb-rank tourn-lb-rank-{i + 1}">{i + 1}</span><span class="tourn-lb-name">{r.displayName}</span><span class="tourn-lb-cnt">{r.count} 冠</span></div>
                    {/each}
                  </div>
                </div>
              </div>
              {@render lbBoard('⚔️ 勝場榜（網站賽+社群賽）', tLeaderboard.wins, '勝')}
              {@render lbBoard('🥇 8 強榜（網站賽）', tLeaderboard.top8, '次')}
              {@render lbBoard('🏅 決賽次數榜（網站賽）', tLeaderboard.finals, '次')}
              {@render lbBoard('📣 社群賽主辦榜', tLeaderboard.communityHost, '場')}
            </div>
            <p class="muted small" style="text-align:center;margin-top:8px;">※ 依帳號統計，顯示玩家最後一場賽事所用暱稱。</p>
          {/if}
        </div>
      {:else if tTab === 'profile'}
        <div class="tourn-profile">
          <!-- ══ v6.032 🔔 賽事通知（自設定視窗搬來）══════════════════════════════
               ⚠必須放在 tProfileLoading / tProfile 的判斷**之外**：tProfile 為 null 的新玩家
                 （還沒有已結束的賽事紀錄）整個分頁只會顯示一行「尚未開放」，
                 通知設定若被關在裡面，新玩家就永遠設定不到通知。 -->
          <div class="tourn-nt">
            <div class="tourn-nt-head">
              <span class="tourn-nt-title">🔔 賽事通知</span>
              <span class="tourn-nt-badge nt-{notifyOverall}">{NOTIFY_BADGE[notifyOverall]}</span>
            </div>
            <label class="tourn-nt-toggle">
              <input type="checkbox" checked={notifyEnabled}
                disabled={notifyOverall === 'ios' || notifyOverall === 'unsupported'}
                onchange={(e) => onNotifyToggle(e.currentTarget.checked)} />
              <span>報到開始、輪到你可以進場、對戰中輪到你行動時提醒我</span>
            </label>
            <!-- v6.035 社群賽開辦通知：從屬於總開關（總開關關掉就收不到任何推播，故一併 disabled） -->
            <label class="tourn-nt-toggle tourn-nt-sub">
              <input type="checkbox" checked={notifyCommunity}
                disabled={!notifyEnabled || notifyOverall === 'ios' || notifyOverall === 'unsupported'}
                onchange={(e) => { notifyCommunity = e.currentTarget.checked; void saveNotifyCommunity(notifyCommunity, tApi); }} />
              <span>有玩家發起<b>社群賽</b>時也通知我（會顯示賽事名稱、賽制與開賽門檻、募集剩餘時間）</span>
            </label>
            {#if notifyOverall === 'ios'}
              <p class="tourn-nt-note nt-warn">📱 iPhone / iPad 要先安裝才能收通知：Safari 分享鈕 →「加入主畫面」，之後從主畫面圖示開啟本站（需 iOS 16.4 以上）。</p>
            {:else if notifyOverall === 'unsupported'}
              <p class="tourn-nt-note nt-warn">⚠️ 這個瀏覽器不支援通知功能，本站無法提醒你（建議改用 Chrome / Edge / Firefox）。</p>
            {:else if notifyOverall === 'blocked'}
              <p class="tourn-nt-note nt-warn">⚠️ 通知已被瀏覽器封鎖。請點網址列的鎖頭圖示 → 通知 → 允許，再回來勾選開啟。</p>
            {:else if notifyOverall === 'server-missing'}
              <p class="tourn-nt-note nt-warn">⚠️ 通知已開啟，但與伺服器的連線沒有建立成功——關掉這個分頁或 App 之後，會收不到報到與進場提醒。請按下方「重新連線」。</p>
            {:else if notifyOverall === 'on'}
              <p class="tourn-nt-note nt-ok">✅ 通知運作中：即使切到其他分頁或手機鎖屏，也會提醒你。</p>
            {/if}
            {#if notifyOverall !== 'ios' && notifyOverall !== 'unsupported'}
              <div class="tourn-nt-btns">
                {#if notifyOverall === 'server-missing'}
                  <button class="btn-primary" onclick={() => runPushSelfTest()} disabled={pushSelfTestBusy}>{pushSelfTestBusy ? '連線中…' : '🔄 重新連線'}</button>
                {/if}
                <button class="btn-secondary" onclick={() => runNotifyTest()}>發送測試通知</button>
              </div>
            {/if}
            {#if notifyTestMsg}
              <p class="tourn-nt-msg" class:ok={notifyTestMsg.ok}>{notifyTestMsg.ok ? '✅ ' : '⚠️ '}{notifyTestMsg.hint}{#if !notifyTestMsg.ok}<button class="tourn-nt-x" title="關閉這則訊息" onclick={() => (notifyTestMsg = null)}>✕</button>{/if}</p>
            {/if}
            {#if pushSelfTestMsg}
              <p class="tourn-nt-msg" class:ok={pushSelfTestMsg.ok}>{pushSelfTestMsg.ok ? '✅ ' : '⚠️ '}{pushSelfTestMsg.text}{#if !pushSelfTestMsg.ok}<button class="tourn-nt-x" title="關閉這則訊息" onclick={() => (pushSelfTestMsg = null)}>✕</button>{/if}</p>
            {/if}
            <details class="tourn-nt-adv" ontoggle={(e) => { if (e.currentTarget.open) void refreshNotifyDiag(); }}>
              <summary>進階診斷（收不到通知時，請展開後截圖給管理員）</summary>
              <div class="tourn-nt-btns">
                <button class="btn-secondary" onclick={() => runPushSelfTest()} disabled={pushSelfTestBusy}>{pushSelfTestBusy ? '測試中…' : '測試伺服器推播'}</button>
                <button class="btn-secondary" onclick={() => refreshNotifyDiag()}>重新檢查</button>
              </div>
              {#if notifyDiag}
                <p class="tourn-nt-diag">本機：瀏覽器支援 {notifyDiag.supported ? '✅' : '❌'}｜權限 {notifyDiag.permission === 'granted' ? '✅ 已允許' : (notifyDiag.permission === 'denied' ? '❌ 已封鎖' : '⏳ 尚未詢問')}｜開關 {notifyDiag.enabled ? '✅' : '❌'}｜背景服務 {notifyDiag.swRegistered ? '✅' : '❌'}</p>
                <p class="tourn-nt-diag">推播：本機訂閱 {notifyDiag.pushSubscribed ? '✅' : '❌'}｜伺服器登記 {notifyDiag.serverRegistered ? '✅' : '❌'}（{describePushStage(notifyDiag.serverStage)}）{notifyDiag.pushHost ? '｜通道 ' + notifyDiag.pushHost : ''}</p>
              {:else}
                <p class="tourn-nt-diag">（按「重新檢查」取得目前狀態）</p>
              {/if}
            </details>
          </div>
          {#if tProfileLoading && !tProfile}
            <p class="muted small" style="text-align:center;padding:18px;">載入個人資料中…</p>
          {:else if !tProfile}
            <p class="muted small" style="text-align:center;padding:18px;">個人資料尚未開放，或你還沒有已結束的賽事紀錄。</p>
          {:else}
            <div class="tourn-pf-head">
              <div class="tourn-pf-name">{tProfile.displayName ?? '（未命名）'}</div>
              <div class="tourn-pf-email">{tProfile.email ?? firebaseUser?.email}</div>
            </div>
            <div class="tourn-pf-tiles">
              <div class="tourn-pf-tile"><div class="tourn-pf-num">{tProfile.championsOfficial ?? 0}</div><div class="tourn-pf-lbl">網站賽奪冠</div></div>
              <div class="tourn-pf-tile"><div class="tourn-pf-num">{tProfile.championsCommunity ?? 0}</div><div class="tourn-pf-lbl">社群奪冠</div></div>
              <div class="tourn-pf-tile"><div class="tourn-pf-num">{tProfile.finals ?? 0}</div><div class="tourn-pf-lbl">決賽(網站賽)</div></div>
              <div class="tourn-pf-tile"><div class="tourn-pf-num">{tProfile.top4 ?? 0}</div><div class="tourn-pf-lbl">4 強(網站賽)</div></div>
              <div class="tourn-pf-tile"><div class="tourn-pf-num">{tProfile.top8 ?? 0}</div><div class="tourn-pf-lbl">8 強(網站賽)</div></div>
              <div class="tourn-pf-tile"><div class="tourn-pf-num">{tProfile.communityEntered ?? 0}</div><div class="tourn-pf-lbl">社群賽參加</div></div>
              <div class="tourn-pf-tile"><div class="tourn-pf-num">{tProfile.totalWins ?? 0}-{tProfile.totalLosses ?? 0}</div><div class="tourn-pf-lbl">總勝-敗</div></div>
              <div class="tourn-pf-tile"><div class="tourn-pf-num">{tProfile.eventsPlayed ?? 0}</div><div class="tourn-pf-lbl">參賽場數</div></div>
            </div>
            <div class="tourn-pf-events">
              <div class="tourn-lb-title">📋 參賽紀錄</div>
              {#if !tProfile.events?.length}<div class="tourn-lb-empty">尚無參賽紀錄</div>{/if}
              {#each (tProfile.events ?? []) as ev}
                <div class="tourn-pf-evrow">
                  <span class="tourn-pf-evname">{ev.communityEvent ? '🎖️' : '🏛️'} {ev.eventName}</span>
                  <span class="tourn-pf-evmeta">{ev.date ? new Date(ev.date).toLocaleDateString('zh-TW') : ''} ｜ {ev.wins ?? 0} 勝 {ev.losses ?? 0} 敗{#if ev.result} ｜ {ev.result}{/if}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      {#if tError}<p class="warn">{tError}</p>{/if}
    {/if}
  </main>
{:else}
{#if isTournament && tError}<div class="tourn-toast">{tError}</div>{/if}
{#if isTournament && tIdleWarnSec != null && tIdleWarnSec <= 90}<div class="tourn-idle-warn">⏳ 對手閒置中：剩 {tIdleWarnSec} 秒未行動將自動判你勝</div>{/if}
<!-- ⭐⭐v6.156「我還在」確認框：把「事後看監控」換成「當場問玩家」。
     ⚠⚠ 這個區塊**必須留在手機／桌機版面分支之外**（v6.149 剛踩過：失聯橫幅寫在桌機的
       else 分支裡，手機玩家整個看不到）。它與上一行的 tourn-idle-warn 同層，兩者互斥
       —— 一個是「對手在被倒數」、一個是「我在被倒數」，方向由伺服器權威的 actorSeat 決定。
     ⚠ 手機在背景／鎖屏時看不到任何畫面 ⇒ 仍要靠 v6.151 的 60 秒推播叫醒。彈窗是補強不是取代。 -->
{#if isTournament && !isTournSpectator && tMyIdleSec != null && tMyIdleSec <= 60}<div class="tourn-still-here" role="alertdialog" aria-live="assertive"><div class="tsh-title">⏰ 系統已開始計時</div><div class="tsh-body">剩 <strong>{tMyIdleSec}</strong> 秒未行動就會被判負。如果你還在，按一下確認。</div><button class="tsh-btn" disabled={tStillHereBusy} onclick={tStillHere}>{tStillHereBusy ? '確認中…' : '我還在'}</button>{#if tStillHereNote}<div class="tsh-note">{tStillHereNote}</div>{/if}</div>{/if}

{#if isTournament && game && game.phase === 'game-over' && (game.winner === null || game.winner === undefined)}<div class="tourn-return-bar" style="text-align:center;"><p class="muted small" style="margin:0 0 6px;color:#fd0;">⏰ {game.winReason || '本場平手，等待管理員裁定'}</p><button class="btn-primary" onclick={tLeaveMatch}>🏆 返回賽事大廳</button></div>{/if}
{#if isTournSpectator && game && !isTReplay}<div class="tourn-return-bar"><button class="btn-secondary" onclick={tLeaveSpectate}>← 離開觀戰</button></div>{/if}

<!-- v2.206：手機直屏旋轉提示 — 進戰鬥（game !== null）且手機直屏時顯示。
     CSS 用 @media (orientation: portrait) 守門：橫屏自動隱藏。
     iOS Safari 不支援 screen.orientation.lock，依靠用戶手動旋轉。
     v5.609：game-over / 觀戰時不顯示 — 此提示是 z-index:99999 全螢幕遮罩(無 pointer-events:none)，
       在 601~950px 直向觸控裝置會蓋住「返回賽事大廳 / 離開觀戰」鈕(z-9999)→ 按不了。
       這兩種狀態玩家只需按離開/返回、不需橫向，故不顯示提示。對戰進行中(參戰者)維持提示不變。 -->
{#if game && game.phase !== 'game-over' && !isSpectator}
  <div class="rotate-prompt">
    <div class="rotate-prompt-icon">📱</div>
    <div class="rotate-prompt-text">請將手機旋轉至橫向<br/>以獲得最佳對戰體驗</div>
    <div class="rotate-prompt-sub">（橫屏後此提示會自動消失）</div>
  </div>
{/if}

<!-- ══════════════════════════════════════════════════════════════════════
     模式選擇 / Lobby
  ══════════════════════════════════════════════════════════════════════ -->
{#if !game}

  <!-- v4.926 Admin 隱身觀戰提示（只有 admin 自己看得到，玩家完全不會收到通知） -->
  {#if isAdminMode}
    <div class="admin-spy-banner">🔒 ADMIN 隱身觀戰中（房間 {roomCode}） · 玩家不會看到你</div>
  {/if}

  {#if mode === null}
  <!-- ─── 模式選擇 ─── -->
  <main class="lobby">
    <a href="{base}/" class="back">← 首頁</a>
    <!-- v4.913 登入狀態 dashboard（port 自牌組編輯器；v4.924 開放 Oracle build） -->
    {#if firebaseUser}
      <div class="auth-dashboard">
        <span class="sync-pill sync-{syncStatus}" title={syncStatus === 'error' ? (syncError ?? '雲端連線失敗') : ''}>
          {#if syncStatus === 'syncing'}⏳ 同步中{:else if syncStatus === 'synced'}☁️ 已同步{:else if syncStatus === 'error'}⚠️ 離線（hover 看原因）{:else}⬜ 本機{/if}
        </span>
        {#if isAnonymous}
          <button class="auth-btn anon" onclick={openAuthModal} title="建立帳號以跨裝置保存牌組">
            👤 匿名　<span class="auth-sub">建立帳號</span>
          </button>
        {:else}
          <div class="auth-user">
            <span class="auth-email">✉️ {firebaseUser.email}</span>
            <button class="small" onclick={openChangePasswordModal} title="更改密碼">🔑 更改密碼</button>
            <button class="small danger" onclick={handleSignOut}>登出</button>
          </div>
        {/if}
      </div>
    {/if}
    <h1>⚔️ 開始對戰</h1>
    {#if !poolReady}<p class="muted">載入卡池中…</p>{/if}
    <div class="mode-cards">
      <button class="mode-card" onclick={() => mode='local'} disabled={!poolReady}>
        <div class="mode-icon">🖥️</div>
        <div class="mode-title">本機雙人對戰</div>
        <div class="mode-desc">同一台裝置輪流操作</div>
      </button>
      <button class="mode-card online" onclick={onClickOnlineMode} disabled={!poolReady}>
        <div class="mode-icon">🌐</div>
        <div class="mode-title">線上連線對戰</div>
        <div class="mode-desc">各自裝置，即時對戰</div>
      </button>
    </div>
  </main>

  {:else if mode === 'local'}
  <!-- ─── 本機 Lobby ─── -->
  <main class="lobby">
    <button class="back-btn" onclick={() => mode=null}>← 返回</button>
    <!-- v4.918 登入狀態 dashboard（同 v4.913 模式選擇畫面；v4.924 開放 Oracle build） -->
    {#if firebaseUser}
      <div class="auth-dashboard">
        <span class="sync-pill sync-{syncStatus}" title={syncStatus === 'error' ? (syncError ?? '雲端連線失敗') : ''}>
          {#if syncStatus === 'syncing'}⏳ 同步中{:else if syncStatus === 'synced'}☁️ 已同步{:else if syncStatus === 'error'}⚠️ 離線（hover 看原因）{:else}⬜ 本機{/if}
        </span>
        {#if isAnonymous}
          <button class="auth-btn anon" onclick={openAuthModal} title="建立帳號以跨裝置保存牌組">
            👤 匿名　<span class="auth-sub">建立帳號</span>
          </button>
        {:else}
          <div class="auth-user">
            <span class="auth-email">✉️ {firebaseUser.email}</span>
            <button class="small" onclick={openChangePasswordModal} title="更改密碼">🔑 更改密碼</button>
            <button class="small danger" onclick={handleSignOut}>登出</button>
          </div>
        {/if}
      </div>
    {/if}
    <h1>🖥️ 本機雙人對戰</h1>
    <p class="lobby-subtitle">遊戲開始時會擲硬幣決定先後手</p>
    <!-- v5.051: 移除預組 toggle — Android Chrome select bug 改永遠顯示 -->
    <div class="player-setup">
      <div class="setup-card">
        <h2>玩家 1</h2>
        <input class="name-input" placeholder="玩家名稱" bind:value={p1Name} />
        <select bind:value={p1DeckId} onchange={() => { p1DeckId = resolveDeckSelection(p1DeckId); }}>
          <option value="">— 選擇牌組 —</option>
          <option value="__random__" disabled={decks.length === 0}>🎲 隨機牌組（從「我的牌組」抽選）{decks.length === 0 ? '— 尚無我的牌組' : ''}</option>
          {#if decks.length > 0}
            <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
          {/if}
          <!-- v5.051: 預組永遠顯示（移除 toggle） — Android Chrome native select 對動態 {#if} optgroup 有 reconciliation bug，玩家勾選後 picker 點不開 -->
          {#if PRESET_DECKS.length > 0}
            <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
          {/if}
        </select>
        {#if p1DeckId}
          {#if p1DeckCount === 60 && p1DeckHasIllegalMark}
            <!-- v5.216：60 張到位但含 G 標等非標準賽卡 → 黃字警告 -->
            <div class="deck-count-info bad">⚠ 含有 G 標</div>
          {:else if p1DeckCount === 60}
            <div class="deck-count-info ok">✓ 60 張</div>
          {:else if p1DeckCount < 60}
            <div class="deck-count-info bad">⚠ 不足 60 張（目前 {p1DeckCount} 張）</div>
          {:else}
            <div class="deck-count-info bad">⚠ 超過 60 張（目前 {p1DeckCount} 張）</div>
          {/if}
        {/if}
        <!-- v3.75：先後攻偏好 -->
        <div class="first-pref-group">
          <div class="first-pref-label">{aiPlayerIndex === 1 ? '先後攻偏好' : '贏擲幣時'}</div>
          <label class="first-pref-radio"><input type="radio" value="random" bind:group={p1FirstPref} /><span>🎲 隨機</span></label>
          <label class="first-pref-radio"><input type="radio" value="first" bind:group={p1FirstPref} /><span>⚡ 先攻</span></label>
          <label class="first-pref-radio"><input type="radio" value="second" bind:group={p1FirstPref} /><span>🛡️ 後攻</span></label>
          <label class="first-pref-radio"><input type="radio" value="opponent" bind:group={p1FirstPref} /><span>🤝 對手決定</span></label>
        </div>
      </div>
      <div class="vs-badge">VS</div>
      <div class="setup-card" class:ai-card={aiPlayerIndex===1}>
        <!-- v4.983: h2 + ai-toggle 並排，與玩家 1 卡片高度對齊 -->
        <div class="setup-card-header">
          <h2>玩家 2{#if aiPlayerIndex===1}<span class="ai-tag">🤖 AI</span>{/if}</h2>
          <label class="ai-toggle">
            <input type="checkbox" checked={aiPlayerIndex===1} onchange={(e)=>{
              aiPlayerIndex = (e.currentTarget as HTMLInputElement).checked ? 1 : null;
              if (aiPlayerIndex === 1) p2Name = 'AI 對手';
            }} />
            由 AI 控制
          </label>
        </div>
        {#if aiPlayerIndex !== 1}
          <input class="name-input" placeholder="玩家名稱" bind:value={p2Name} />
        {/if}
        <select bind:value={p2DeckId} onchange={() => { p2DeckId = resolveDeckSelection(p2DeckId); }}>
          <option value="">— 選擇牌組 —</option>
          <option value="__random__" disabled={decks.length === 0}>🎲 隨機牌組（從「我的牌組」抽選）{decks.length === 0 ? '— 尚無我的牌組' : ''}</option>
          {#if decks.length > 0}
            <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
          {/if}
          <!-- v5.051: 預組永遠顯示（移除 toggle） — Android Chrome native select 對動態 {#if} optgroup 有 reconciliation bug，玩家勾選後 picker 點不開 -->
          {#if PRESET_DECKS.length > 0}
            <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
          {/if}
        </select>
        {#if p2DeckId}
          {#if p2DeckCount === 60 && p2DeckHasIllegalMark}
            <!-- v5.216：60 張到位但含 G 標等非標準賽卡 → 黃字警告 -->
            <div class="deck-count-info bad">⚠ 含有 G 標</div>
          {:else if p2DeckCount === 60}
            <div class="deck-count-info ok">✓ 60 張</div>
          {:else if p2DeckCount < 60}
            <div class="deck-count-info bad">⚠ 不足 60 張（目前 {p2DeckCount} 張）</div>
          {:else}
            <div class="deck-count-info bad">⚠ 超過 60 張（目前 {p2DeckCount} 張）</div>
          {/if}
        {/if}
        <!-- v3.75：P2 先後攻偏好（AI 模式不顯示，因為由 P1 的偏好直接決定） -->
        {#if aiPlayerIndex !== 1}
          <div class="first-pref-group">
            <div class="first-pref-label">贏擲幣時</div>
            <label class="first-pref-radio"><input type="radio" value="random" bind:group={p2FirstPref} /><span>🎲 隨機</span></label>
            <label class="first-pref-radio"><input type="radio" value="first" bind:group={p2FirstPref} /><span>⚡ 先攻</span></label>
            <label class="first-pref-radio"><input type="radio" value="second" bind:group={p2FirstPref} /><span>🛡️ 後攻</span></label>
            <label class="first-pref-radio"><input type="radio" value="opponent" bind:group={p2FirstPref} /><span>🤝 對手決定</span></label>
          </div>
        {/if}
      </div>
    </div>
    <button class="btn-primary" disabled={!p1DeckValid || !p2DeckValid} onclick={startLocalGame}>
      {aiPlayerIndex !== null ? '🤖 開始 vs AI' : '🎮 開始遊戲'}
    </button>
    <!-- v2.70：移除「雙人請選不同牌組」警告；本機/線上對戰皆允許兩位玩家使用同一牌組 -->

  </main>

  {:else}
  <!-- ─── 線上 Lobby ─── -->
  <main class="lobby">
    <!-- v2.276：'room' step 不顯示返回鈕（避免使用者跳離但沒呼叫 leaveRoom，造成空房殘留）；
         在房間內要走右上「離開房間」按鈕（onclick=leaveOnlineGame）才會清座位 -->
    {#if onlineStep !== 'room'}
      <button class="back-btn" onclick={() => { mode=null; onlineStep='join'; showCreateForm=false; onlineError=''; }}>← 返回</button>
    {/if}
    <!-- v4.918 登入狀態 dashboard（同 v4.913 模式選擇畫面；v4.924 開放 Oracle build） -->
    {#if firebaseUser}
      <div class="auth-dashboard">
        <span class="sync-pill sync-{syncStatus}" title={syncStatus === 'error' ? (syncError ?? '雲端連線失敗') : ''}>
          {#if syncStatus === 'syncing'}⏳ 同步中{:else if syncStatus === 'synced'}☁️ 已同步{:else if syncStatus === 'error'}⚠️ 離線（hover 看原因）{:else}⬜ 本機{/if}
        </span>
        {#if isAnonymous}
          <button class="auth-btn anon" onclick={openAuthModal} title="建立帳號以跨裝置保存牌組">
            👤 匿名　<span class="auth-sub">建立帳號</span>
          </button>
        {:else}
          <div class="auth-user">
            <span class="auth-email">✉️ {firebaseUser.email}</span>
            <button class="small" onclick={openChangePasswordModal} title="更改密碼">🔑 更改密碼</button>
            <button class="small danger" onclick={handleSignOut}>登出</button>
          </div>
        {/if}
      </div>
    {/if}
    <h1>🌐 線上連線對戰</h1>

    {#if onlineStep === 'join' || onlineStep === 'choose' || onlineStep === 'create'}
      <!-- v5.008：統一大廳頁面 — 建立 / 加入 / 房間列表 合併單頁顯示 -->
      <div class="online-form lobby-unified">
        <label class="name-row">
          <span class="name-label">玩家名稱</span>
          <input class="name-input" placeholder="輸入你的名稱" bind:value={myName} />
        </label>

        <!-- 建立新房間：折疊式 inline 表單（預設收合，點按鈕展開）-->
        <div class="create-room-block" class:expanded={showCreateForm}>
          {#if !showCreateForm}
            <button class="btn-create-room-cta" onclick={() => { showCreateForm = true; onlineError=''; }}>
              <span class="cri-icon">🏠</span>
              <span class="cri-text">
                <span class="cri-title">建立新房間</span>
                <span class="cri-sub">產生房號等對手加入（可選練習 / 私密房）</span>
              </span>
              <span class="cri-chevron">▾</span>
            </button>
          {:else}
            <div class="create-room-inline">
              <div class="cri-header">
                <h3>🏠 建立新房間</h3>
                <button class="btn-link cri-collapse" onclick={() => { showCreateForm = false; onlineError=''; }} title="收合表單">▴ 收合</button>
              </div>
              <label>房間名稱<input class="name-input" placeholder="輸入房間名稱" bind:value={roomNameInput} /></label>
              <!-- v4.75 練習模式：勾選後此房雙方可請求悔棋（對手同意制）。預設不勾。 -->
              <label class="check-row">
                <input type="checkbox" bind:checked={roomAllowUndoInput} />
                <span>🎯 練習模式（允許悔棋）— 對戰中雙方可請求悔棋，需對手同意才會生效</span>
              </label>
              <!-- v5.003 私密房：勾選後不會出現在大廳列表，朋友需透過房號加入 -->
              <label class="check-row">
                <input type="checkbox" bind:checked={roomPrivateInput} />
                <span>🔒 私密房 — 不在大廳列表公開顯示，朋友需透過分享房號才能加入</span>
              </label>
              {#if onlineError}<p class="warn">{onlineError}</p>{/if}
              <div class="form-btns">
                <button class="btn-primary" onclick={handleCreateRoom} disabled={onlineLoading}>
                  {onlineLoading ? '建立中…' : '建立房間'}
                </button>
              </div>
            </div>
          {/if}
        </div>

        <!-- v3.992 公開房間列表：分兩區（等待中可加入 + 對戰中可觀戰）-->
        <div class="open-rooms-section">
          <h3>🌐 等待中的房間（{lobbyRooms.length}）</h3>
          {#if openRoomsErr}
            <p class="warn small">⚠️ {openRoomsErr}</p>
          {/if}
          {#if lobbyRooms.length === 0 && !openRoomsErr}
            <p class="muted small">目前無等待中的房間 — 可請對方建立後再刷新，或自己點上方「🏠 建立新房間」開房。</p>
          {:else if lobbyRooms.length > 0}
            <ul class="open-room-list">
              {#each lobbyRooms as r (r.roomId)}
                {@const _bothSeated = !!(r.seats?.[0]?.uid && r.seats?.[1]?.uid)}
                {@const _host = hostPresence(r)}
                <li class="open-room-row" class:practice-room={r.allowUndo} class:room-full={_bothSeated}>
                  <!-- v6.114 第一行：房名 + 標籤 + 主要動作鈕（手機自動折行） -->
                  <div class="or-main">
                    <span class="or-host">🎮 {r.roomName ?? r.hostName}</span>
                    {#if r.allowUndo}<span class="or-practice-tag" title="此房為練習模式 — 雙方同意可悔棋">🎯 練習</span>{/if}
                    {#if _bothSeated}<span class="or-waiting-tag" title="雙方就坐，等待開戰中 — 進去只能加入觀戰位">⏳ 等待開戰</span>{/if}
                    <button class="btn-sm primary or-act" onclick={() => handleJoinFromList(r.roomId)} disabled={onlineLoading || !myName.trim()}>
                      {_bothSeated ? '👁 觀戰' : '加入'}
                    </button>
                  </div>
                  <!-- v6.114 第二行：次要資訊縮成一行小字 -->
                  <div class="or-meta">
                    <span class="or-host-name" title={_host === 'online' ? '房主在線' : '房主可能已離開（心跳逾時）'}>{_host === 'online' ? '🟢' : '⚪'} 房主：{r.hostName}</span>
                    <span class="or-age">· {fmtRoomAge(r.createdAt)}</span>
                    <span class="or-code">房號 {r.roomId}</span>
                  </div>
                  {#if !myName.trim()}<div class="or-hint">↑ 請先在上方填寫玩家名稱才能加入</div>{/if}
                  <!-- ⚠ 等待中的房間永遠不顯示任何牌組／場面資訊：雙方已選牌組但還沒開打，
                       先看到對方牌組再決定要不要加入＝牌組狙擊。場面預覽只掛在下面的「對戰中」區。 -->
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- v3.992 對戰中可觀戰房間 -->
        <div class="open-rooms-section">
          <h3>👁 對戰中的房間（{playingRooms.length}）</h3>
          {#if playingRooms.length === 0}
            <p class="muted small">目前無進行中且開放觀戰的房間。</p>
          {:else}
            <ul class="open-room-list playing-list">
              {#each playingRooms as r (r.roomId)}
                {@const _arch = roomArchetypes[r.roomId]}
                <li class="open-room-row playing-row" class:practice-room={r.allowUndo}>
                  <div class="or-main">
                    <span class="or-host">⚔️ {r.roomName ?? r.hostName}</span>
                    {#if r.allowUndo}<span class="or-practice-tag" title="此房為練習模式">🎯 練習</span>{/if}
                    <button class="btn-sm spectator-btn or-act" onclick={() => handleJoinFromList(r.roomId)} disabled={onlineLoading || !myName.trim()}>
                      👁 觀戰
                    </button>
                  </div>
                  <!-- v6.115 牌組原型標籤：名稱由伺服器比對「牌組原型」規則後回傳，
                       前端只拿得到名稱字串，拿不到任何牌表內容。
                       ⚠ 只有「對戰中」的房間有（等待中顯示＝牌組狙擊），
                       且伺服器在開局放置階段不回（那時對手還看不到你的場面）。 -->
                  <div class="or-meta">
                    <span class="or-host-name">
                      {r.seats?.[0]?.name ?? '?'}{#if _arch?.p1}<span class="or-arch">【{_arch.p1}】</span>{/if}
                      <span class="or-vs">vs</span>
                      {r.seats?.[1]?.name ?? '?'}{#if _arch?.p2}<span class="or-arch">【{_arch.p2}】</span>{/if}
                    </span>
                    <span class="or-code">房號 {r.roomId}</span>
                  </div>
                  {#if !myName.trim()}<div class="or-hint">↑ 請先在上方填寫玩家名稱才能觀戰</div>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- 手動輸入房號 fallback -->
        <details class="manual-code">
          <summary>🔑 用房號手動加入</summary>
          <label>房號（4碼）<input class="name-input code-input" placeholder="XXXX" maxlength="4" bind:value={joinInput} /></label>
          <button class="btn-primary" onclick={handleJoinRoom} disabled={onlineLoading || !joinInput.trim()}>
            {onlineLoading ? '加入中…' : '加入'}
          </button>
        </details>

        {#if onlineError && !showCreateForm}<p class="warn">{onlineError}</p>{/if}
      </div>

    {:else if onlineStep === 'room'}
      <!-- 房間等待室（座位制） -->
      <div class="room-lobby">
        <div class="room-header">
          <div>
            <div class="room-title">{roomData?.roomName ?? '房間'}</div>
            <div class="room-code-inline">房號 <strong>{roomCode}</strong></div>
          </div>
          <button class="btn-secondary" onclick={leaveOnlineGame}>離開房間</button>
        </div>

        <!-- v3.992 觀戰開關（v5.116：只有房主 P1 可改）-->
        {#if mySeatIdx === 0}
          <div class="spectator-toggle-row">
            <label class="spectator-toggle">
              <input
                type="checkbox"
                checked={roomData?.spectatorsAllowed !== false}
                onchange={(e) => {
                  if (!roomCode) return;
                  const target = e.currentTarget as HTMLInputElement;
                  setSpectatorsAllowed(roomCode, target.checked).catch(console.error);
                }}
              />
              <span>✅ 允許觀戰（讓其他玩家在大廳的「對戰中房間」看到此房）</span>
            </label>
          </div>
        {:else if mySeatIdx === 1}
          <!-- v5.116 P2 唯讀顯示 -->
          <div class="spectator-toggle-row">
            <span class="muted small">{roomData?.spectatorsAllowed !== false ? '✅ 房主已允許觀戰' : '🚫 房主已停用觀戰'}（由房主決定）</span>
          </div>
          <!-- v5.051: 移除線上 lobby 預組 toggle — 同本機 lobby -->
        {/if}

        <!-- v5.329 對手閒置判定獲勝時間（只有房主 P1 可拉；P2 唯讀顯示）-->
        {#if mySeatIdx === 0}
          <div class="spectator-toggle-row idle-timeout-row">
            <div class="idle-timeout-head">⏱️ 對手閒置判定獲勝時間：<strong>{fmtMMSS(roomData?.idleTimeoutSec ?? 180)}</strong></div>
            <input
              class="idle-timeout-range"
              type="range" min="60" max="300" step="30"
              value={roomData?.idleTimeoutSec ?? 180}
              onchange={(e) => {
                if (!roomCode) return;
                const t = e.currentTarget as HTMLInputElement;
                _saveIdle(Number(t.value));
                setIdleTimeout(roomCode, Number(t.value)).catch(console.error);
              }}
            />
            <span class="muted small">對手輪到動作卻超過此時間沒反應 → 你可宣告獲勝（範圍 1:00 ~ 5:00，預設 3:00）</span>
          </div>
        {:else if mySeatIdx === 1}
          <div class="spectator-toggle-row">
            <span class="muted small">⏱️ 對手閒置判定獲勝時間：{fmtMMSS(roomData?.idleTimeoutSec ?? 180)}（由房主決定）</span>
          </div>
        {/if}

        <!-- v2.73 殭屍房警示 + 解散按鈕 -->
        {#if oppStale}
          <div class="zombie-warning">
            <div class="zw-icon">⚠️</div>
            <div class="zw-text">
              <strong>對方已離線超過 5 分鐘</strong>
              <div class="zw-sub">可能是關閉了瀏覽器或斷線。建議解散房間，雙方都會回到大廳。</div>
            </div>
            <button class="btn-danger zw-btn" onclick={dismissZombieRoom} disabled={onlineLoading}>
              解散房間
            </button>
          </div>
        {/if}

        {#if roomData}
          <div class="seat-area">
            <!-- 左側：對戰位 P1 / P2（我的座位內嵌牌組+準備） -->
            <div class="battle-seats">
              {#each [0, 1] as i}
                {@const s = roomData.seats[i]}
                {@const isMine = mySeatIdx === i}
                {@const myDeckCount = countDeckCards(s.deckEntries)}
                <!-- v5.217：線上 seat 也加 G 標驗證（依現行 PTCG 規則，validateDeck 含 reprint exception） -->
                {@const seatDeckObj = ({ id: '', name: '', entries: s.deckEntries } as Deck)}
                {@const seatIssues = (myDeckCount === 60 && deckEntriesAllInPool(s.deckEntries, pool)) ? validateDeck(seatDeckObj, pool).issues : []}
                {@const seatHasIllegalMark = seatIssues.some(x => /為 [A-Z]+ 標/.test(x))}
                {@const hasValidDeck = myDeckCount === 60 && !seatHasIllegalMark}
                <div class="seat battle-seat {s.uid ? 'taken' : 'empty'} {isMine ? 'mine' : ''} {s.ready ? 'ready' : ''}">
                  <div class="seat-label">對戰玩家 {i + 1}</div>
                  {#if s.uid}
                    <div class="seat-name">{s.name}{isMine ? '（你）' : ''}</div>
                    {#if isMine}
                      <!-- 我的座位：內嵌牌組選擇 + 準備按鈕 -->
                      <select class="seat-deck-select"
                        value={myDeckId}
                        onchange={handleDeckChange}
                        disabled={s.ready}>
                        <option value="">— 選擇牌組 —</option>
                        <option value="__random__" disabled={decks.length === 0}>🎲 隨機牌組（從「我的牌組」抽選）{decks.length === 0 ? '— 尚無我的牌組' : ''}</option>
                        {#if decks.length > 0}
                          <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
                        {/if}
                        <!-- v5.051: 預組永遠顯示（移除 toggle） — Android Chrome native select bug -->
                        {#if PRESET_DECKS.length > 0}
                          <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
                        {/if}
                      </select>
                      {#if hasValidDeck}
                        <div class="seat-deck-info">✓ 牌組已套用（60 張）</div>
                      {:else if myDeckCount === 60 && seatHasIllegalMark}
                        <!-- v5.217：60 張到位但含 G 標等非標準賽卡 → 黃字警告 -->
                        <div class="seat-deck-info" style="color:#ff8866;">⚠ 含有 G 標</div>
                      {:else if myDeckId && myDeckCount === 0}
                        <div class="seat-deck-info" style="color:#ffcc66;">套用中⋯</div>
                      {:else if myDeckId && myDeckCount < 60}
                        <div class="seat-deck-info" style="color:#ff8866;">⚠ 不足 60 張（目前 {myDeckCount} 張）</div>
                      {:else if myDeckId && myDeckCount > 60}
                        <div class="seat-deck-info" style="color:#ff8866;">⚠ 超過 60 張（目前 {myDeckCount} 張）</div>
                      {:else}
                        <div class="seat-deck-info muted">請選牌組</div>
                      {/if}
                      <button class="btn-sm primary {s.ready ? 'unready' : ''}"
                        onclick={handleToggleReady}
                        disabled={!hasValidDeck}>
                        {s.ready ? '取消準備' : '準備完成'}
                      </button>
                      <!-- v3.75：先後攻偏好（只有自己看得到自己的，對手看不到） -->
                      <div class="first-pref-group lobby">
                        <div class="first-pref-label">贏擲幣時</div>
                        <label class="first-pref-radio"><input type="radio" name="seat-pref-{i}" value="random" checked={(s.firstChoicePreference ?? 'random') === 'random'} disabled={s.ready} onchange={() => { _saveFirstPref('random'); roomCode && setSeatFirstChoice(roomCode, 'random').catch(console.error); }} /><span>🎲 隨機</span></label>
                        <label class="first-pref-radio"><input type="radio" name="seat-pref-{i}" value="first" checked={s.firstChoicePreference === 'first'} disabled={s.ready} onchange={() => { _saveFirstPref('first'); roomCode && setSeatFirstChoice(roomCode, 'first').catch(console.error); }} /><span>⚡ 先攻</span></label>
                        <label class="first-pref-radio"><input type="radio" name="seat-pref-{i}" value="second" checked={s.firstChoicePreference === 'second'} disabled={s.ready} onchange={() => { _saveFirstPref('second'); roomCode && setSeatFirstChoice(roomCode, 'second').catch(console.error); }} /><span>🛡️ 後攻</span></label>
                        <label class="first-pref-radio"><input type="radio" name="seat-pref-{i}" value="opponent" checked={s.firstChoicePreference === 'opponent'} disabled={s.ready} onchange={() => { _saveFirstPref('opponent'); roomCode && setSeatFirstChoice(roomCode, 'opponent').catch(console.error); }} /><span>🤝 對手決定</span></label>
                      </div>
                    {:else}
                      <!-- 別人坐：只顯示狀態（v3.38：補張數警告；v5.217：補 G 標警告） -->
                      {#if hasValidDeck}
                        <div class="seat-deck-info">✓ 已選牌組（60 張）</div>
                      {:else if myDeckCount === 60 && seatHasIllegalMark}
                        <!-- v5.217：60 張到位但含 G 標等非標準賽卡 → 黃字警告 -->
                        <div class="seat-deck-info" style="color:#ff8866;">⚠ 牌組含有 G 標</div>
                      {:else if myDeckCount > 0 && myDeckCount < 60}
                        <div class="seat-deck-info" style="color:#ff8866;">⚠ 牌組不足 60 張（{myDeckCount} 張）</div>
                      {:else if myDeckCount > 60}
                        <div class="seat-deck-info" style="color:#ff8866;">⚠ 牌組超過 60 張（{myDeckCount} 張）</div>
                      {:else}
                        <div class="seat-deck-info muted">尚未選擇牌組</div>
                      {/if}
                      <div class="seat-status">{s.ready ? '✅ 已準備' : '⏳ 未準備'}</div>
                    {/if}
                  {:else}
                    <!-- 空位 -->
                    <div class="seat-empty-hint">空位</div>
                    <button class="btn-sm primary"
                      onclick={() => handleTakeSeat(i)}
                      disabled={onlineLoading || mySeatIdx < 0}>
                      入坐此位
                    </button>
                  {/if}
                </div>
              {/each}
            </div>

            <!-- 右側：8 個觀戰位 -->
            <div class="spectator-seats">
              <div class="spectator-label">觀戰位（{roomData.seats.slice(2).filter(s => s.uid).length}/8）</div>
              <div class="spectator-grid">
                {#each roomData.seats.slice(2) as s, i (i)}
                  {@const seatIdx = i + 2}
                  {@const isMine = mySeatIdx === seatIdx}
                  <div class="seat spec-seat {s.uid ? 'taken' : 'empty'} {isMine ? 'mine' : ''}">
                    {#if s.uid}
                      <div class="seat-name small">{s.name}{isMine ? '（你）' : ''}</div>
                    {:else}
                      <button class="btn-spec-take"
                        onclick={() => handleTakeSeat(seatIdx)}
                        disabled={onlineLoading || mySeatIdx < 0}>
                        + 入坐
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </div>

          {#if onlineError}<p class="warn">{onlineError}</p>{/if}

          {#if bothPlayersReady(roomData.seats)}
            <p class="muted waiting-pulse">⏳ 雙方已準備，遊戲即將開始⋯</p>
          {/if}

          <!-- v2.272 Phase 2：聊天室 -->
          <div class="chat-area">
            <div class="chat-header">💬 聊天室</div>
            <div class="chat-messages" bind:this={chatScrollEl}>
              {#if chatMessages.length === 0}
                <p class="muted small chat-empty">尚無訊息，先說聲哈囉吧！</p>
              {:else}
                {#each chatMessages as m (m.id)}
                  <div class="chat-msg {m.uid === myUid ? 'mine' : ''}">
                    <span class="chat-name">{m.name}</span>
                    <span class="chat-time">{fmtChatTime(m.createdAt)}</span>
                    <div class="chat-text">{m.text}</div>
                  </div>
                {/each}
              {/if}
            </div>
            <div class="chat-input-row">
              <input
                class="chat-input"
                type="text"
                placeholder="輸入訊息（Enter 送出，最多 200 字）"
                maxlength="200"
                bind:value={chatInput}
                onkeydown={handleChatKey}
                disabled={mySeatIdx < 0}
              />
              <button class="btn-primary chat-send"
                onclick={handleSendMessage}
                disabled={!chatInput.trim() || mySeatIdx < 0}>
                送出
              </button>
            </div>
          </div>
        {:else}
          <p class="muted">載入房間中⋯</p>
        {/if}
      </div>
    {/if}
  </main>
  {/if}

<!-- ══════════════════════════════════════════════════════════════════════
     正式對戰（Play Mat 佈局） — setup 和 playing 共用此畫面
  ══════════════════════════════════════════════════════════════════════ -->
{:else}
<div class="battle-root" class:tablet-layout={isTabletLayout && battleLayout !== 'fable'} class:zoomed={gameZoom !== 1} style="--game-zoom: {gameZoom};">

  <!-- v5.478 系統管理員廣播跑馬燈（桌面+手機共用；fixed 浮在最上方，跑一輪後自動收起）-->
  {#if broadcastMarquee}
    {#key broadcastKey}
      <div class="admin-broadcast-bar" class:community={broadcastIsCommunity} role="status">
        <div class="admin-broadcast-track" style="animation-duration: {broadcastMarqueeDur}s">📢 {broadcastMarquee}</div>
        <button class="admin-broadcast-close" onclick={() => broadcastMarquee = ''} title="關閉廣播" aria-label="關閉廣播">✕</button>
      </div>
    {/key}
  {/if}

  <!-- v2.286 Phase 2-4：手機直式（≤600px portrait）切換到 MobilePortraitBattle 元件。
       桌機 / 平板 / 手機橫屏走原 layout。setup + playing 都切（MobilePortraitBattle 內部
       自行依 phase 切換 setup「拖手牌」vs playing「結束回合」按鈕）。
       Modals（pendingSelection / lightbox / zoom-modal 等）保留在 .battle-root 內、
       conditional 之外，always render — 兩種 layout 都能觸發 modal。 -->

  <!-- 背景音樂播放器 (全域) -->
  <!-- v6.130 ⚠ 這個 {#if} 就是「玩家沒選就零下載」的保證：bgmTrack==='none' 時 DOM 裡根本
       沒有 <audio> 元素，不會發出任何請求。SW 端另有 HEAVY_MEDIA 把 /music/ 排除預快取。
       ⚠ 不放 autoplay 屬性 —— 被瀏覽器擋下時是靜默的；改由 tryPlayBgm() 呼叫 play() 才 catch 得到。 -->
  {#if bgmTrack !== 'none'}
    <audio
      src="{base}/music/{bgmTrack}.mp3"
      loop
      preload="auto"
      bind:this={bgmAudioEl}
      bind:volume={bgmVolume}
    ></audio>
  {/if}

  <!-- ⭐⭐v6.149 連線健康橫幅：失聯 10 秒以上就明講，並提醒閒置倒數仍在跑。
       ⚠⚠ 必須放在「手機直式 vs 桌機」那個版面分支的**外面** —— 第一版寫在桌機那半邊，
       ⚠ 這行刻意不把該分支的條件字面寫出來：既有守衛是用「第一個含該字串的行」定位分支起點，
         寫在註解裡會變成假錨點（v6.139 被頁面註解騙過一次，這裡是同一個坑）。
         分支裡，手機直式玩家完全看不到，而註解還寫著「不在 isPortraitMobile 分支內」
         （Fable 5 審查抓到：註解與碼相反）。事故當事人很可能就是手機玩家。
         同 v6.122 補位 modal 的既定做法：兩版共用的東西一律放在分支外。 -->
  {#if tNetBannerOn}
    <div class="net-warn-banner" role="alert">
      {#if _tActionAuthErr}
        <span>⚠ 動作送不出去：伺服器不認得目前的登入身分（憑證過期，或在其他分頁登出）。畫面看起來正常，但每一個動作都會被拒絕、盤面不會前進 —— 請先按「立即重新同步」刷新憑證；閒置判負的倒數仍在計算。</span>
      {:else if tAuthLost}
        <span>⚠ 登入狀態已失效（憑證過期，或在其他分頁登出）—— 畫面不會再更新，請重新登入後回到對戰；閒置判負的倒數仍在計算。</span>
      {:else}
        <span>⚠ 與伺服器失聯 {tOfflineSec} 秒 —— 畫面可能不是最新的，閒置判負的倒數仍在計算。</span>
      {/if}
      <!-- v6.150：先強制刷新一次 Firebase token 再重試 —— 憑證過期造成的 401 這樣就能自救，
           不必離開對戰重新登入（重新登入等於離開對戰，很可能直接被判負）。 -->
      <button class="net-warn-btn" onclick={() => { void (async () => { try { if (firebaseUser) await firebaseUser.getIdToken(true); } catch { /* 刷新失敗就照原樣重試 */ } tForceResync(); startTournamentPoll(); })(); }}>🔄 立即重新同步</button>
      <button class="net-warn-x" title="關閉提示" onclick={() => { _tNetBannerDismissAt = Date.now(); }}>✕</button>
    </div>
  {/if}
  <!-- ⭐⭐v6.170【B-3】重送中的可見狀態。**刻意不做全畫面遮罩**：盤面、設定、放大鏡、離開
       全部照常可用，玩家在等的時候看得到自己的牌。逃生鈕讓「斷流 25 秒 ＝ 被鎖 25 秒」不再成立。 -->
  {#if tActRetry}
    <div class="act-retry-banner" role="alert">
      <span>🔁 連線不穩，正在自動重送這個動作（第 {tActRetry.n} / {tActRetry.max} 次）—— 盤面照常可以看，不必重新整理，也不必重按。</span>
      <button class="net-warn-btn" onclick={tActCancel}>停止重送</button>
    </div>
  {/if}
  <!-- ⭐⭐⭐v6.172 排隊中的手勢一定要看得見（靜默丟棄是最糟的）。
       ⚠ 與上面兩則同樣放在 isPortraitMobile 分支**之外** —— v6.149 的教訓。 -->
  {#if tActQueue.length}
    <div class="act-queue-banner" role="status">
      <span>⏳ 已排隊 {tActQueue.length} 個動作 —— 前一個動作送出後會自動依序執行，不必重按。</span>
    </div>
  {/if}
  {#if tActNotice}
    <div class="act-notice-banner" role="status"><span>{tActNotice}</span></div>
  {/if}
  <!-- ⭐⭐v6.170【B-4】對手斷線時，我方畫面不該看起來像網站壞掉。判準見 tOppQuietOn。 -->
  {#if tOppQuietOn}
    <div class="opp-quiet-banner" role="status">
      <span>📶 對手的連線目前不穩定（已有 {tOppQuietSec} 秒沒有連上伺服器）—— 不是你的網路、也不是網站故障。對手回來後畫面會自動更新；若一直沒回來，系統的閒置判負會照常處理。</span>
    </div>
  {/if}
  {#if isPortraitMobile && game}
    <MobilePortraitBattle
      {game}
      {pool}
      {myIdx}
      {oppIdx}
      stadiumCard={stadiumCard ?? null}
      {pendingSelection}
      {aiThinking}
      {isSyncing}
      {canUseStadium}
      {isSpectator}
      {isTournSpectator}
      {isTReplay}
      pendingPrizes={myPendingPrizes}
      version={VERSION}
      roomCode={roomCode}
      onResync={isTournament ? tForceResync : undefined}
      actionBusy={actionBusy}
      actionSending={actionSending}
      actionQueued={tActQueue.length}
      onAction={dispatch}
      onInitiateAttack={initiateAttack}
      attackEstimates={damageEstimates}
      onOpenZoom={openZoom}
      onOpenPrizes={openPrizeView}
      onOpenSettings={() => showSettingsModal = true}
      onLeave={() => {
        // v5.566：手機直式離開鈕也要走投降確認(原直接 leaveOnlineGame 漏了確認視窗)
        // 觀戰者不投降：錦標賽走離開觀戰、一般線上走離開房間
        if (mode === 'online' && isSpectator) { if (isTournSpectator) tLeaveSpectate(); else leaveOnlineGame(); }
        else if (mode === 'online') surrenderLeave();
        else { game = null; mode = null; }
      }}
      undoAvailable={!!undoSnapshot && !undoAwaitingResponse && !undoDeniedThisSnapshot}
      onUndo={performUndo}
    />
    {#if isTReplay && tReplay}
      {@const _msteps = tReplaySteps()}
      {@const _mcur = _msteps[tReplayStep]}
      {@const _mact = _mcur?.state?.activePlayerIndex ?? _mcur?.state?.firstPlayerIdx ?? 0}
      {@const _mfirst = (_mcur?.state?.firstPlayerIdx ?? 0)}
      <div class="treplay-mob" role="toolbar" aria-label="回放導覽">
        <button class="treplay-mob-btn treplay-mob-exit" onclick={tExitReplay} aria-label="離開回放">✕</button>
        <button class="treplay-mob-btn" onclick={() => tReplayGoto(0)} disabled={tReplayStep <= 0} aria-label="第一步">⏮</button>
        <button class="treplay-mob-btn treplay-mob-main" onclick={() => tReplayGoto(tReplayStep - 1)} disabled={tReplayStep <= 0}>◀ 上一步</button>
        <span class="treplay-mob-step">{_mcur?.isFinal ? '🏁' : (_mact === _mfirst ? '先' : '後') + '·T' + (_mcur?.turn ?? '?')}<br/>{tReplayStep + 1}/{_msteps.length}</span>
        <button class="treplay-mob-btn treplay-mob-main" onclick={() => tReplayGoto(tReplayStep + 1)} disabled={tReplayStep >= _msteps.length - 1}>下一步 ▶</button>
        <button class="treplay-mob-btn" onclick={() => tReplayGoto(_msteps.length - 1)} disabled={tReplayStep >= _msteps.length - 1} aria-label="最後一步">⏭</button>
        <button class="treplay-mob-btn" onclick={() => tCopyReplayLink(tReplay.meta?.matchId)} aria-label="複製分享連結">🔗</button>
      </div>
    {/if}
  {:else}

  {#if abilityRegBroken}
    <div style="background:#7a1f1f;color:#fff;padding:0.5rem 0.75rem;font-size:0.85rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:center;">
      ⚠ 偵測到版本載入異常（部分卡牌特性未正確載入，可能導致特性按鈕無法顯示）。請點此重新整理以取得完整版本：
      <button onclick={hardReloadBrokenReg} style="background:#fff;color:#7a1f1f;border:none;border-radius:4px;padding:0.25rem 0.6rem;font-weight:600;cursor:pointer;">🔄 重新整理</button>
    </div>
  {/if}
  <!-- ── 頂部資訊列 ── -->
  <header class="battle-header">
    {#if mode === 'online' && !isSpectator}
      <button class="small-back" onclick={surrenderLeave}>🏳 投降離開</button>
    {:else if mode === 'online' && !isTournSpectator && !isTReplay && !isAdminMode}
      <!-- ⭐⭐v6.197 桌機的休閒觀戰原本只有一條 `← 首頁` 的 <a>，整頁換掉、**不會呼叫
           leaveRoom** ⇒ 伺服器上那個觀戰位一直被佔著（只有 8 個），後面的人會被「觀戰位已滿」
           擋在外面。錦標賽觀戰早就有專屬離開鈕（tourn-return-bar），休閒這邊補齊。 -->
      <button class="small-back" onclick={leaveOnlineGame}>← 離開觀戰</button>
    {:else}
      <a href="{base}/" class="small-back">← 首頁</a>
    {/if}
    <span class="turn-info">
      回合 {game.turn}　<strong>{activePlayer?.name}</strong> 行動中
      {#if game.isFirstTurn && aIdx === game.firstPlayerIdx}<span class="hint">（先手第1回合不能攻擊 / 進化 / 用支援者）</span>{/if}
    </span>
    <span class="hand-counts" title="雙方手牌張數（手牌內容仍為隱私，僅顯示張數）">
      {#each game.players as pl, pi}
        <span class="chip hand-count-chip" class:hc-active={pi === aIdx}>
          ✋ {pl.name ?? `P${pi+1}`} 手牌 {pl.hand.length} 張
        </span>
      {/each}
    </span>
    <span class="phase-tag">
      {#if game.turnPhase === 'draw'}📥 抽牌
      {:else if game.turnPhase === 'main'}🎮 主階段
      {:else}⏭ 回合結束{/if}
    </span>
    <span class="status-chips">
      {#if mode === 'online' && myPlayerIndex !== null}
        <!-- v2.198 修：P1/P2 是座位編號（房主=P1、客人=P2），先後手由擲硬幣 game.firstPlayerIdx 決定，
             跟座位無關。舊版寫死「P1=先手、P2=後手」是錯的：客人擲贏先攻時也會被顯示成「P2 後手」。 -->
        <span class="chip role-chip">
          我是 P{myPlayerIndex + 1}
          {#if game?.firstPlayerIdx !== undefined}
            · {game.firstPlayerIdx === myPlayerIndex ? '先手' : '後手'}
          {/if}
        </span>
        {#if isSyncing}<span class="chip syncing-chip">⏳ 同步中</span>{/if}
        {#if actionSending}<span class="chip syncing-chip">⏳ 送出中…</span>{/if}
        {#if !isMyTurn() && !isMyDefenderTurn()}<span class="chip wait-chip" title={isTournament ? '若遲遲沒換你，可能是畫面沒更新 → 點此重新同步（不必重整網頁）' : undefined} style={isTournament ? 'cursor:pointer;' : undefined} onclick={() => { if (isTournament) { _tSendClientDiag('manual-sync'); tForceResync(); } }}>等待對手行動{#if isTournament} 🔄{/if}</span>{/if}
      {/if}
      <!-- ⭐v6.197 線上但認不出自己的座位：顯性提示（此時所有操作已被中央述詞收掉） -->
      {#if seatUnknown}
        <span class="chip wait-chip" title="伺服器上認不出你的座位（多半是連線期間身分被重新簽發）。這個分頁已切成唯讀，請重新整理後再進房。">⚠ 認不出你的座位（唯讀）</span>
      {/if}
      <!-- v2.276 Phase 3：觀戰模式 — 視角切換 -->
      {#if isSpectator}
        <span class="chip spec-chip">👀 觀戰中（看 P{myIdx + 1}）</span>
        <span class="spec-toolbar">
          <button class="spec-btn {spectatorView === 'p1' ? 'active' : ''}"
            onclick={() => spectatorView = 'p1'}>看 P1</button>
          <button class="spec-btn {spectatorView === 'p2' ? 'active' : ''}"
            onclick={() => spectatorView = 'p2'}>看 P2</button>
          <button class="spec-btn {spectatorView === 'auto' ? 'active' : ''}"
            onclick={() => spectatorView = 'auto'}>自動切換</button>
        </span>
      {/if}
      {#if aiPlayerIndex !== null && aiThinking}<span class="chip ai-chip">🤖 AI 思考中…</span>{/if}
      {#if stadiumCard && game.activeStadium}
        {@const sId = game.activeStadium.cardId}
        <button class="chip stadium-chip clickable-chip" title="點擊查看卡片詳情" onclick={()=>openZoom(sId, null)}>🏟 {stadiumCard.name} 🔍</button>
      {/if}
      {#if game.gameStartTime !== undefined}
        <span class="chip timer-chip timer-total" title="對戰總時間"><span class="t-ic">⏱</span><span class="t-val">{fmtTimerMs(gameTotalMs)}</span></span>
        <span class="chip timer-chip timer-p1" class:active={game.activePlayerIndex === 0 && game.phase === 'playing'} title="{game.players[0].name} 累計時間"><span class="t-lb">P1</span><span class="t-val">{fmtTimerMs(p0TotalMs)}</span></span>
        <span class="chip timer-chip timer-p2" class:active={game.activePlayerIndex === 1 && game.phase === 'playing'} title="{game.players[1].name} 累計時間"><span class="t-lb">P2</span><span class="t-val">{fmtTimerMs(p1TotalMs)}</span></span>
        <span class="chip timer-chip timer-turn" title="本回合時間"><span class="t-ic">▶</span><span class="t-val">{fmtTimerMs(liveTurnTimeMs)}</span></span>
      {/if}
      {#if roomCode}<span class="chip room-chip" title="房間代碼（邀請朋友觀戰 / 回報 bug 用）">🔑 {roomCode}</span>{/if}
      <span class="chip version-chip" title="應用程式版本 — 檢查是否同步到最新">v{VERSION}</span>
      <!-- 音效與音樂設定（⚙️） -->
      <button class="chip settings-chip" onclick={() => showSettingsModal = true} title="設定（音效與音樂）">
        ⚙️ 設定
      </button>
      <button class="chip fs-chip" onclick={toggleFullscreen} title={isFullscreen ? '退出全螢幕' : '全螢幕（隱藏瀏覽器列）'}>
        {isFullscreen ? '⛶' : '⛶'} {isFullscreen ? '退出全螢幕' : '全螢幕'}
      </button>
    </span>
    {#if game.phase === 'playing' && activePlayer}
      {@const attEnergy = activePlayer.energyAttachedThisTurn}
      {@const attSupp = activePlayer.supporterPlayedThisTurn}
      {@const attRetreat = activePlayer.retreatedThisTurn}
      {@const attStadium = (game.stadiumUsedThisTurn ?? [false,false])[aIdx]}
      <div class="turn-res" title="本回合資源（{activePlayer.name}）">
        <span class="res-item" class:res-used={attEnergy}>
          <span class="res-ic">⚡</span><span class="res-lb">填能</span>
          <span class="res-st">{attEnergy?'已用':'可用'}</span>
        </span>
        <span class="res-item" class:res-used={attSupp}>
          <span class="res-ic">📋</span><span class="res-lb">支援者</span>
          <span class="res-st">{attSupp?'已用':'可用'}</span>
        </span>
        <span class="res-item" class:res-used={attRetreat}>
          <span class="res-ic">🔄</span><span class="res-lb">撤退</span>
          <span class="res-st">{attRetreat?'已用':'可用'}</span>
        </span>
        {#if stadiumCard}
          <span class="res-item" class:res-used={attStadium}>
            <span class="res-ic">🏟</span><span class="res-lb">競技場</span>
            <span class="res-st">{attStadium?'已用':'可用'}</span>
          </span>
        {/if}
      </div>
    {/if}
  </header>

  <!-- ── Play Mat ── -->
  
<!-- v5.225 對手 3 分鐘無動作警告 banner —— fixed 在頂部 -->


<!-- v5.225 確認 modal —— 點按鈕後二次確認 -->


{#if isTReplay && tReplay}
  {@const _steps = tReplaySteps()}
  {@const _cur = _steps[tReplayStep]}
  {@const _actIdx = _cur?.state?.activePlayerIndex ?? _cur?.state?.firstPlayerIdx ?? 0}
  {@const _finalOnly = (tReplay?.snapshots?.length ?? 0) === 0}
  {@const _isOldFmt = _finalOnly || (tReplay.snapshots || []).every((s: any) => s.logLen == null)}
  <div class="treplay-bar">
    <button class="treplay-btn" onclick={tExitReplay} title="離開回放">✕ 離開</button>
    <span class="treplay-title">🎬 回放：<b>{tReplay.meta?.p1name ?? '?'}</b> vs <b>{tReplay.meta?.p2name ?? '?'}</b>{#if tReplay.meta?.winnerName} ｜ 🏆 {tReplay.meta.winnerName}{/if}</span>
    {#if _isOldFmt}<span class="treplay-oldfmt" title="這場對戰是在回放系統上線前打的,只存了{_finalOnly ? '終局盤面' : '整回合粒度'}資料,無法逐半回合切換視角。上線後打的新對戰才有完整逐半回合回放。">⚠ {_finalOnly ? '舊對戰（僅終局盤面）' : '舊版快照（整回合粒度）'}</span>{/if}
    <div class="treplay-nav">
      <button class="treplay-btn" onclick={() => tReplayGoto(0)} disabled={tReplayStep <= 0}>⏮</button>
      <button class="treplay-btn" onclick={() => tReplayGoto(tReplayStep - 1)} disabled={tReplayStep <= 0}>◀ 上一步</button>
      <span class="treplay-step">{_cur?.isFinal ? '🏁 最終盤面' : ((_cur?.state?.players?.[_actIdx]?.name ?? '?') + '（' + (_actIdx === (_cur?.state?.firstPlayerIdx ?? 0) ? '先攻' : '後攻') + '）的回合')}（{tReplayStep + 1}/{_steps.length}）</span>
      <button class="treplay-btn" onclick={() => tReplayGoto(tReplayStep + 1)} disabled={tReplayStep >= _steps.length - 1}>下一步 ▶</button>
      <button class="treplay-btn" onclick={() => tReplayGoto(_steps.length - 1)} disabled={tReplayStep >= _steps.length - 1}>⏭</button>
    </div>
    <button class="treplay-btn" onclick={() => tCopyReplayLink(tReplay.meta?.matchId)} title="複製分享連結">🔗 複製連結</button>
  </div>
{/if}

<div class="playmat" class:trainer-drop-zone={dragOpFor('playmat')==='trainer'} class:has-stadium-bg={!!stadiumCard} class:layout-tabletop={battleLayout === 'tabletop'} class:layout-fable={battleLayout === 'fable'} class:log-collapsed={battleLayout !== 'classic' && !battleLogOpen} style="--card-scale:{fableCardScale}">
    <!-- v5.012：桌墊版專用 battle log toggle 按鈕（漂在右邊） -->
    {#if battleLayout !== 'classic'}
      <button class="log-toggle-btn" onclick={toggleBattleLog}
        title={battleLogOpen ? '收合對戰紀錄面板' : '展開對戰紀錄面板'}
        aria-label={battleLogOpen ? '收合對戰紀錄' : '展開對戰紀錄'}>
        <span class="log-toggle-icon">📜</span>
        <span class="log-toggle-arrow">{battleLogOpen ? '⟶' : '⟵'}</span>
      </button>
    {/if}

    <!-- v4.22 場地卡在場時的背景圖層（只抓上半藝術圖區 + 低調透明度） -->
    {#if stadiumCard}
      <div class="stadium-bg-layer" aria-hidden="true">
        <img use:retryImg={stadiumCard.imageUrl} src={stadiumCard.imageUrl} alt="" />
      </div>
    {/if}

    <!-- 對手場地（永遠在上方） -->
    <div class="field-row opponent-row">
      {#if game}
        <div class="turn-order-chip" class:active-turn={game.activePlayerIndex === oppIdx}
          title={(game.firstPlayerIdx === oppIdx ? '對手為先攻玩家' : '對手為後攻玩家')
            + (game.activePlayerIndex === oppIdx ? '・目前回合' : '')}>
          {game.firstPlayerIdx === oppIdx ? '先攻' : '後攻'}
        </div>
      {/if}
      <div class="zone-pile">
        <div class="pile-slot deck-pile" class:shuffling={shuffleFlashUntil[oppIdx] > 0}>
          <span class="pile-icon">🃏</span>
          <span class="pile-count">{oppPlayer?.deck.length??0}</span>
          <span class="pile-label">牌庫</span>
          {#if shuffleFlashUntil[oppIdx] > 0}<span class="shuffle-spark">🌀</span>{/if}
        </div>
        <div class="pile-slot disc-pile" class:discard-pulse={discardFlashUntil[oppIdx] > 0}
          onclick={() => viewDiscardFor = oppIdx} title="查看對手棄牌區">
          <span class="pile-icon">🗑</span>
          <span class="pile-count">{oppPlayer?.discard.length??0}</span>
          <span class="pile-label">棄牌</span>
        </div>
      </div>
      <div class="zone-bench" class:bench-extended={oppBenchLimit > 5} style="--bench-n:{oppBenchLimit}">
        {#each Array(Math.max(Math.min(5, (oppPlayer?.bench.length ?? 0) + 1), oppBenchLimit, 1)) as _, i (i)}
          {#if oppPlayer?.bench[i]}
            {@const b=oppPlayer.bench[i]}{@const bc=getCard(b.cardId)}
            {#if oppHidden}
              <div class="bench-slot card-back-slot" title="對手備戰寶可夢（設置中，未揭曉）">
                <div class="card-back card-back-sm"><span class="card-back-mark">?</span></div>
                <div class="bench-name">？？？</div>
              </div>
            {:else}
              <!-- ⭐v6.173 對手側移除離場動畫：離場中的節點會多佔 320ms 的版面與一次 WAAPI 動畫，
                   而且那段期間該子樹的 effect 是 INERT（讀到的 derived 會是過期值）。對手側的離場
                   動畫對玩家判讀沒有價值，直接拿掉；我方仍保留。 -->
              <div class="bench-slot">
                <!-- v2.49：名字/HP 移到卡牌上方，避免與下方 chip/button 擠在一起 -->
                <!-- v2.59：對手 bench 也要顯示附加能量（pip column），與我方備戰一致 — Leon 回報對手資訊看不到 -->
                <div class="bench-name">{bc?.name}</div>
                <div class="bench-stat">HP {hpRemaining(b)}/{hpTotal(b)}</div>
                <div class="bench-middle">
                  <img use:retryImg={bc?.imageUrl} src={bc?.imageUrl} alt={bc?.name} onclick={()=>openZoom(b.cardId,b)} class="zoomable" onpointerenter={(e)=>enterAttCard(e, b.cardId)} onpointerleave={leaveAttCard}/>
                  <!-- v5.020 桌墊版：附加卡片小卡圖重疊呈現（能量/道具/進化堆）-->
                  {#if battleLayout !== 'classic'}
                    {@const _attOB = attachedCardsOf(b)}
                    {#if _attOB.length > 0}
                      <!-- v5.038：疊牌動態間距 — 越多張疊得越密，避免疊太長
                           公式：step = max(12, 32 - length * 3) → 1張:29 / 4張:20 / 6張:14 / 7+:12 -->
                      {@const _stepOB = Math.max(12, 32 - _attOB.length * 3)}
                      <!-- v5.098：對手 bench 堆疊方向改往下（top 正值），玩家回報 -->
                      <div class="att-card-stack">
                        {#each _attOB as itm, i (itm.iid)}{@const _c=getCard(itm.cardId)}{#if _c}<img use:retryImg={_c.imageUrl} class="att-card att-{itm.kind}" style="top:{(i+1) * _stepOB}px;z-index:{110-i}" onpointerenter={(e)=>enterAttCard(e, itm.cardId)} onpointerleave={leaveAttCard} onclick={(e)=>{e.stopPropagation();openZoom(itm.cardId,null);}} src={_c.imageUrl} alt={_c.name} title={_c.name}/>{/if}{/each}
                      </div>
                      <!-- v5.410：桌墊版能量/道具 compact overlay（疊在卡圖上，仿手機版）-->
                      <div class="tt-attach-overlay">{#each energyPips(b) as pip}<span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>{/each}{#if b.toolAttached || (b.extraTools && b.extraTools.length > 0)}<span class="tt-tool" title="附加道具">🔧{b.extraTools && b.extraTools.length > 0 ? `×${1 + b.extraTools.length}` : ''}</span>{/if}</div>
                    {/if}
                  {/if}
                  {#if energyPips(b).length > 0}
                    <div class="bench-nrg">
                      {#each energyPips(b) as pip}
                        <span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="hp-bar-wrap sm"><div class="hp-bar" style="width:{hpTotal(b)?hpRemaining(b)/hpTotal(b)*100:0}%;background:{hpColor(hpRemaining(b),hpTotal(b))}"></div></div>
                {#if b.toolAttached}{@const tc3=getCard(b.toolAttached.cardId)}<div class="tool-chip sm">🔧{tc3?.name ?? '道具'}</div>{/if}{#each (b.extraTools ?? []) as et3}{@const tcE=getCard(et3.cardId)}<div class="tool-chip sm">🔧{tcE?.name ?? '道具'}</div>{/each}
                {#if b.abilityUsedThisTurn}<div class="ab-used-chip sm" title="本回合已使用特性">✨</div>{/if}
                {#if b.status}<div class="status-chip-sm status-{b.status}">{
                  b.status === 'poisoned' ? '☠️' :
                  b.status === 'burned' ? '🔥' :
                  b.status === 'asleep' ? '💤' :
                  b.status === 'confused' ? '😵' : '⚡'
                }</div>{/if}
              </div>
            {/if}
          {:else}<div class="bench-slot bench-empty"></div>{/if}
        {/each}
      </div>
      <div class="zone-active">
        <div class="zone-label-sm opp-label">對手出場</div>
        {#if oppPlayer?.active}
          {@const ac=getCard(oppPlayer.active.cardId)}
          {#if oppHidden}
            <div class="active-card opp-active card-back-active" title="對手戰鬥寶可夢（設置中，未揭曉）">
              <div class="card-back card-back-lg"><span class="card-back-mark">?</span></div>
              <div class="active-info">
                <div class="active-name">？？？</div>
                <div class="active-hp">戰鬥中（未揭曉）</div>
              </div>
            </div>
          {:else}
            <div
              class="active-card opp-active"
              class:attack-shake={attackFx && oppPlayer.active && attackFx.attackerIid === oppPlayer.active.iid}
              class:attack-flash={attackFx && oppPlayer.active && attackFx.defenderIid === oppPlayer.active.iid}
              class:status-glow-poisoned={oppPlayer.active.status === 'poisoned'}
              class:status-glow-burned={oppPlayer.active.status === 'burned'}
              class:status-glow-asleep={oppPlayer.active.status === 'asleep'}
              class:status-glow-confused={oppPlayer.active.status === 'confused'}
              style={attackFx && oppPlayer.active && attackFx.defenderIid === oppPlayer.active.iid ? `--flash-color:${ENERGY_COLOR[attackFx.energyType]}` : undefined}
            >
              <img use:retryImg={ac?.imageUrl} src={ac?.imageUrl} alt={ac?.name} class="active-img zoomable" onclick={()=>openZoom(oppPlayer!.active!.cardId,oppPlayer!.active)} onpointerenter={(e)=>enterAttCard(e, oppPlayer!.active!.cardId)} onpointerleave={leaveAttCard}/>
              <!-- v5.020 桌墊版：附加卡片小卡圖重疊呈現（能量/道具/進化堆）-->
              {#if battleLayout !== 'classic'}
                {@const _attOA = attachedCardsOf(oppPlayer.active)}
                {#if _attOA.length > 0}
                  <div class="att-card-stack">
                    {#each _attOA as itm, i (itm.iid)}{@const _c=getCard(itm.cardId)}{#if _c}<img use:retryImg={_c.imageUrl} class="att-card att-{itm.kind}" style="left:calc(var(--fan-step, 32px) * {i+1});z-index:{50-i}" onpointerenter={(e)=>enterAttCard(e, itm.cardId)} onpointerleave={leaveAttCard} onclick={(e)=>{e.stopPropagation();openZoom(itm.cardId,null);}} src={_c.imageUrl} alt={_c.name} title={_c.name}/>{/if}{/each}
                  </div>
                  <!-- v5.410：桌墊版能量/道具 compact overlay（疊在卡圖上，仿手機版）-->
                  <div class="tt-attach-overlay">{#each energyPips(oppPlayer.active) as pip}<span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>{/each}{#if oppPlayer.active.toolAttached || (oppPlayer.active.extraTools && oppPlayer.active.extraTools.length > 0)}<span class="tt-tool" title="附加道具">🔧{oppPlayer.active.extraTools && oppPlayer.active.extraTools.length > 0 ? `×${1 + oppPlayer.active.extraTools.length}` : ''}</span>{/if}</div>
                {/if}
              {/if}
              <!-- v2.52：能量改為垂直 pip 圖示，排在卡圖右側（與備戰一致）
                   v2.53：無能量時不渲染（避免空欄佔寬度） -->
              {#if energyPips(oppPlayer.active).length > 0}
                <div class="active-nrg-col">
                  {#each energyPips(oppPlayer.active) as pip}
                    <span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                  {/each}
                </div>
              {/if}
              <div class="active-info">
                <div class="active-name">{ac?.name}</div>
                {#if oppPlayer.active.toolAttached}{@const tc=getCard(oppPlayer.active.toolAttached.cardId)}<div class="tool-chip">🔧{tc?.name ?? '道具（未載入）'}</div>{/if}{#each (oppPlayer.active.extraTools ?? []) as etOA}{@const tcOA=getCard(etOA.cardId)}<div class="tool-chip">🔧{tcOA?.name ?? '道具（未載入）'}</div>{/each}
                {#if oppPlayer.active.abilityUsedThisTurn}<div class="ab-used-chip" title="本回合已使用特性">✨已用特性</div>{/if}
                {#if oppPlayer.active.status}<div class="status-chip status-{oppPlayer.active.status}">{
                  oppPlayer.active.status === 'poisoned' ? '☠️ 中毒' :
                  oppPlayer.active.status === 'burned' ? '🔥 燒傷' :
                  oppPlayer.active.status === 'asleep' ? '💤 睡眠' :
                  oppPlayer.active.status === 'confused' ? '😵 混亂' :
                  oppPlayer.active.status === 'paralyzed' ? '⚡ 麻痺' : oppPlayer.active.status
                }</div>{/if}
                <!-- v2.163：同時兩狀態（如危險光線 灼傷+混亂） -->
                {#if oppPlayer.active.secondaryStatus}<div class="status-chip status-{oppPlayer.active.secondaryStatus}">{
                  oppPlayer.active.secondaryStatus === 'poisoned' ? '☠️ 中毒' :
                  oppPlayer.active.secondaryStatus === 'burned' ? '🔥 燒傷' :
                  oppPlayer.active.secondaryStatus === 'asleep' ? '💤 睡眠' :
                  oppPlayer.active.secondaryStatus === 'confused' ? '😵 混亂' :
                  oppPlayer.active.secondaryStatus === 'paralyzed' ? '⚡ 麻痺' : oppPlayer.active.secondaryStatus
                }</div>{/if}
                <!-- v5.295/v5.296：三狀態並存獨立第三 chip (中毒+灼傷+混亂) -->
                {#if oppPlayer.active.tertiaryStatus}<div class="status-chip status-{oppPlayer.active.tertiaryStatus}">{
                  oppPlayer.active.tertiaryStatus === 'poisoned' ? '☠️ 中毒' :
                  oppPlayer.active.tertiaryStatus === 'burned' ? '🔥 燒傷' :
                  oppPlayer.active.tertiaryStatus === 'asleep' ? '💤 睡眠' :
                  oppPlayer.active.tertiaryStatus === 'confused' ? '😵 混亂' :
                  oppPlayer.active.tertiaryStatus === 'paralyzed' ? '⚡ 麻痺' : oppPlayer.active.tertiaryStatus
                }</div>{/if}
              </div>
              <!-- v2.130：血條移到卡牌最下方，避免被特性按鈕等 UI 蓋住（雙方統一） -->
              <div class="active-hpbar-bottom">
                <div class="hp-bar-wrap"><div class="hp-bar" style="width:{hpTotal(oppPlayer.active)?hpRemaining(oppPlayer.active)/hpTotal(oppPlayer.active)*100:0}%;background:{hpColor(hpRemaining(oppPlayer.active),hpTotal(oppPlayer.active))}"></div></div>
                <span class="active-hp-text">HP {hpRemaining(oppPlayer.active)}/{hpTotal(oppPlayer.active)}</span>
                {#if battleLayout !== 'classic'}<div class="active-name-tt">{ac?.name ?? '?'}</div>{/if}
              </div>
            </div>
          {/if}
        {:else}<div class="active-card active-empty">（無出場）</div>{/if}
      </div>
      <div class="zone-prizes">
        {#key prizeAnimKey[oppIdx]}
          <div class="prize-grid">
            {#each Array(6) as _, i (i)}{@const _pz = oppPlayer?.prizes[i]}{@const _pc = _pz && (_pz.faceUp || isTReplay) ? getCard(_pz.cardId) : null}<div class="prize-card prize-anim" class:prize-gone={i>=(oppPlayer?.prizes.length??0)} class:prize-faceup={!!_pz && (!!_pz.faceUp || isTReplay)} style="animation-delay:{i*90}ms" title={_pc?.name??''}>{#if _pc?.imageUrl}<img use:retryImg={_pc.imageUrl} class="prize-face-img" src={_pc.imageUrl} alt={_pc.name}
              class:legend-half-l={twoCardStadiumHalfIndex(oppPlayer?.prizes, _pz?.iid ?? '', pool) === 0}
              class:legend-half-r={twoCardStadiumHalfIndex(oppPlayer?.prizes, _pz?.iid ?? '', pool) === 1}/>{/if}</div>{/each}
          </div>
        {/key}
        {#if isTReplay}
          <button class="zone-label-sm prize-view-btn" onclick={openPrizeView} title="查看雙方獎賞卡（回放限定）">🎁 獎賞 {oppPlayer?.prizes.length??0}張 🔍</button>
        {:else}
          <div class="zone-label-sm">獎賞 {oppPlayer?.prizes.length??0}張</div>
        {/if}
      </div>
    </div>

    <!-- 中間行動列 -->
    <div class="action-bar">
      <div class="alerts-col">
        {#if game.phase==='setup'}
          {@const _sb = setupActorSeat(game)}
          {#if _sb !== -1 && _sb !== myIdx}
            <div class="alert info-alert">⏳ 等待對手{(game.pendingMulliganDraw?.[oppIdx] ?? 0) > 0 ? '補抽手牌' : (!game.mulliganRevealConfirmed?.[oppIdx] ? '確認起手揭示' : (!game.setupDone?.[oppIdx] ? '選出場寶可夢並準備' : '準備'))}…</div>
          {:else if !game.setupDone[myIdx]}
            {#if !myPlayer?.active}
              <div class="alert info-alert">🃏 從手牌拖出 1 隻基礎寶可夢到戰鬥場</div>
            {:else}
              <div class="alert info-alert">✅ 可加入備戰（最多 5 隻） · 準備完成後點下方按鈕</div>
            {/if}
          {/if}
        {/if}
        {#if myPendingPrizes > 0 && !isSpectator}
          <div class="alert prize-alert">
            🏆 取 {myPendingPrizes} 張獎賞卡
            {#if takePrizeCountdown > 0}
              <span class="prize-countdown">⏱️ {takePrizeCountdown}s 後自動取得</span>
            {/if}
            <!-- v3.791：takePrizes 也改用 myIdx，本機雙人模式 myPlayerIndex=null 時才不會誤抓 P1 -->
            <button class="btn-xs primary" disabled={actionBusy} onclick={()=>dispatch(GameActions.takePrizes(myPendingPrizes, myIdx, myIdx))}>取得</button>
          </div>
        {/if}
        <!-- v2.123：send-new-active alert 去掉 turnPhase==='end' 限制
             特性/招式 KO 對手或自己時，不管 turnPhase 都要 popup 補戰鬥位，回合才能繼續。
             v2.197：加 !pendingSelection guard — 攻擊方還在 pending（如幻影奇襲分配
             6 個 counter）時，防守方先別顯示「請派出戰鬥寶可夢」alert，等對方完成
             pending 後 modal 才彈，避免畫面卡住的視覺感。 -->
        {#if game.phase==='playing' && defenderPlayer?.active===null && !pendingSelection}
          {#if isMyDefenderTurn()}
            <div class="alert warn-alert">⚠️ 請從備戰區派出新的戰鬥寶可夢（下方視窗選擇）</div>
          {:else if isMyTurn()}
            <div class="alert warn-alert">⚠️ 等待 {defenderPlayer?.name} 送出寶可夢</div>
          {/if}
        {/if}
        <!-- 對方 pending 處理中（如幻影奇襲分配傷害）時，防守方顯示「等待對方完成」 -->
        {#if game.phase==='playing' && defenderPlayer?.active===null && pendingSelection && isMyDefenderTurn()}
          <div class="alert warn-alert">⏳ 等待 {game.players[pendingSelection.actorIdx].name} 完成當前操作後，再派出新的戰鬥寶可夢</div>
        {/if}
        <!-- 自 KO（如咒詛炸彈、中毒）：主動方自己戰鬥場變空，須從備戰區送出新戰鬥寶可夢 -->
        {#if game.phase==='playing' && myPlayer?.active===null && (myPlayer?.bench??[]).length>0 && !pendingSelection}
          <div class="alert warn-alert">⚠️ 請從備戰區派出新的戰鬥寶可夢（下方視窗選擇）</div>
        {/if}
        {#if game.phase==='playing' && oppPlayer?.active===null && game.turnPhase!=='end' && (oppPlayer?.bench??[]).length>0 && !pendingSelection}
          <div class="alert warn-alert">⚠️ 等待 {oppPlayer?.name} 送出新戰鬥寶可夢</div>
        {/if}
        <!-- v2.200 對手互動 picker：當 pending.actorIdx 是對手（且不是 my 視角）時，
             我方畫面顯示「等待對手選擇」訊息。馬志士的交易 / 泰姆 等對手互動 supporter
             需要這個 alert，否則出卡方畫面只看到攻擊鈕灰掉，不知道在等什麼。
             modal 顯示守門（line 2929）會把 modal 隱藏在 actor 那側 — 這 alert 補在另一側。 -->
        {#if game.phase==='playing' && pendingSelection && pendingSelection.actorIdx === oppIdx && (mode === 'online' || aiPlayerIndex !== null)}
          <div class="alert info-alert">⏳ 等待 {game.players[pendingSelection.actorIdx].name} 做出選擇…</div>
        {/if}
      </div>

      <div class="action-btns">
        {#if game.phase==='setup' && isMyTurn() && !game.setupDone[myIdx]}
          <button class="btn-act primary" disabled={actionBusy||!myPlayer?.active}
            onclick={()=>dispatch(GameActions.finishSetup(myIdx))}>
            ✅ 準備完成
          </button>
        {:else if game.phase==='setup' && isMyTurn() && game.mulliganPostBenchOpen?.[myIdx]}
          <!-- v5.138：mulligan 補抽後加備戰完成（PTCG 規則：不需重抽方補抽後可選擇加備戰） -->
          <div class="alert info-alert" style="margin-bottom:6px">📝 補抽完成！可從手牌加新基礎寶可夢到備戰（限自由選擇）</div>
          <button class="btn-act primary" disabled={actionBusy}
            onclick={()=>dispatch(GameActions.finishMulliganPostBench(myIdx))}>
            ✅ 完成補抽後設置
          </button>
        {:else if isMyTurn() && !anyPendingPrize}
          <!-- v5.166：加 game.phase==='playing' gate — 避免 setup phase 邊界情況下
               招式 / 跳過攻擊按鈕 disabled 但仍 render。
               v5.167：移除 v5.166「等待對手」elseif — 它在 setup phase 雙人模式下
               覆蓋 P2 視角操作 UI (myIdx 切到 P2 後 setupDone[P2]=true 即 match 等待)，
               讓 P2 無法按「準備完成」/「確認 mulligan 揭示」。phase gate 已足夠。 -->
          {#if game.turnPhase==='main' && activePlayer?.active && game.phase==='playing'}
            {@const eff=getEffectiveAttacks(game, activePlayer.active, pool)}
            {#each eff as { atk, sourceCardName, isFromTool }, i}
              {@const _shinyOn = isShinyCrystalActive(activePlayer.active, atk.cost)}
              {@const _est = damageEstimates ? (damageEstimates[i] ?? null) : null}
              <!-- ⭐v6.237【D】外層容器 .atk-slot：預估提示改掛在**沒有 disabled 的容器**上。
                   原本掛在按鈕裡，靠 `.btn-act.atk:hover` 顯示 —— 但能量還沒附夠的招式按鈕是
                   原生 `disabled`，disabled 表單元件本來就不派送滑鼠事件、各家瀏覽器對
                   `:hover` 的處理也不一致 ⇒ **最需要預估的時候（還在規劃要不要附能量）看不到**。
                   ⚠ 按鈕本身**維持原生 `disabled`**（沒有改成 aria-disabled）——
                     絕不可讓玩家真的按得下去不能使用的招式。容器只負責接 hover。
                   ⚠ 容器是 inline-flex、緊貼按鈕，`.action-btns` 的 flex 排版完全不變。 -->
              <span class="atk-slot" class:est-open={estOpen?.turn === game.turn && estOpen?.i === i}>
                <button class="btn-act atk" class:atk-ready={availableAttacks.includes(i)} class:atk-from-tool={isFromTool}
                  disabled={actionBusy||!availableAttacks.includes(i)||!!pendingSelection}
                  title={(_shinyOn ? '璀璨結晶：可免除任一能量需求；剩餘 cost 仍需對應屬性能量（例如 1 顆草能無法付【火】或【超】）\n\n' : '') + (isFromTool ? `來自工具：${sourceCardName}` : '')}
                  onclick={()=>initiateAttack(i)}>
                  <span class="cost-row">{#each atk.cost as e}<span class="epip" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>{/each}{#if _shinyOn}<span class="shiny-crystal-badge" title="璀璨結晶：免除其中 1 顆能量需求（任意屬性）；其餘 cost 仍需對應屬性能量">🔮-1</span>{/if}</span>
                  <span class="atk-name">{atk.name}{isFromTool ? ' 🔧' : ''}</span>
                  <span class="atk-dmg">{atk.damage||'—'}</span>
                </button>
                {#if hasEstimateToShow(_est)}
                  <!-- ⭐⭐⭐v6.238【B】放大鏡：平板／觸控裝置沒有 hover，點它才顯示。
                       ⚠⚠ **點放大鏡絕對不可以使出招式**。這裡用的是最硬的做法：
                         ① 它是招式鈕的**兄弟節點**，不是子節點 —— DOM 上沒有祖先關係，
                            click 事件根本沒有機會冒泡到招式鈕的 onclick（結構上就不可能）。
                         ② `type="button"`：避免任何 form 情境下被當成 submit。
                         ③ handler 仍呼叫 stopPropagation()／preventDefault() 當第三層保險。
                       ⚠ hover **保留**：滑鼠玩家沿用 v6.233 的習慣，兩者顯示的是同一塊內容。 -->
                  <button type="button" class="dmg-est-toggle"
                    aria-expanded={estOpen?.turn === game.turn && estOpen?.i === i}
                    aria-label="{atk.name}：顯示預估傷害"
                    title="顯示預估傷害（平板／觸控可用）"
                    onclick={(e)=>{ e.stopPropagation(); e.preventDefault();
                      const _on = estOpen?.turn === game.turn && estOpen?.i === i;
                      estOpen = _on ? null : { turn: game.turn, i }; }}>🔍</button>
                  <!-- ⭐v6.233 桌機：**滑鼠移上去才顯示**（絕對定位，不影響原本版面配置）。
                       內容在 damageEstimates 算好時就已經在 DOM 裡，:hover 只是 CSS 顯示、不做運算。 -->
                  <span class="dmg-est">
                    <span class="dmg-est-main">{estimateShortText(_est)}</span>
                    {#if _est && _est.kind === 'exact' && _est.formula}
                      <span class="dmg-est-formula">{_est.formula}</span>
                    {/if}
                  </span>
                {/if}
              </span>
            {/each}
            <!-- v5.166：disabled 改為精確判定 — 只在「自己有 pending modal 顯示中」
                 才 disabled；對方 pending 不擋（理論上 isMyTurn() 已 gate，但雙保險）。
                 PTCG 「跳過攻擊」= 自己選擇放棄本回合攻擊直接結束，應永遠可按。 -->
            <button class="btn-act secondary"
              disabled={actionBusy || (!!pendingSelection && pendingSelection.actorIdx === myIdx)}
              onclick={()=>dispatch(GameActions.endTurn())}>跳過攻擊 →</button>
          {/if}
          {#if canUseStadium && isMyTurn()}
            <button class="btn-act stadium-btn" disabled={actionBusy} onclick={()=>dispatch(GameActions.useStadium())}>
              🏟 {stadiumCard?.name}
            </button>
          {/if}
          <!-- v3.93：action-bar 內加 mirror 撤退按鈕（玩家視線常駐區，避免在不同解析度找不到）-->
          <!-- v5.084：能量不夠時改顯示 disabled 態（鏡射 zone-active L5969-5980） —
               原 v3.93 只在 canRetreatNow=true 時 render → 對手帶重力之玉等情境讓
               cost +1 超過自身能量時，按鈕「消失」，玩家誤以為系統 bug。
               改 if/else 兩態，行為一致 zone-active 按鈕。 -->
          {#if !pendingSelection && isMyTurn() && myPlayer?.active && !myPlayer.active.fossilOnField && (myPlayer.bench?.length??0) > 0 && game.phase==='playing' && game.turnPhase==='main'}
            {#if canRetreatNow}
              <button class="btn-act btn-retreat-mirror" disabled={actionBusy} onclick={(e)=>openFloatingRetreat(e)} title="撤退戰鬥場寶可夢到備戰，換另一隻上場">
                🔄 撤退（{retreatCostOf(myPlayer.active)}⚡）
              </button>
            {:else}
              <button class="btn-act btn-retreat-mirror" disabled
                title={getRetreatBlockReason(game!, pool) ?? '無法撤退（未知原因）'}>
                🚫 撤退（{retreatCostOf(myPlayer.active)}⚡）
              </button>
            {/if}
          {/if}
          <!-- v5.372：化石戰鬥寶可夢的【丟棄化石】按鈕移到 action-btns（撤退鈕位置，跳過攻擊下方）-->
          {#if !pendingSelection && isMyTurn() && myPlayer?.active?.fossilOnField && game.phase==='playing' && game.turnPhase==='main'}
            <button class="btn-act btn-fossil-discard"
              title="把場上的化石丟棄到棄牌區（非昏厥，對手不抽獎賞）。戰鬥場丟棄需從備戰補 1 隻"
              onclick={async () => { await dispatch(GameActions.discardFossil(myPlayer!.active!.iid)); }}>
              🦴 丟棄化石
            </button>
          {/if}
          {#if canEndTurn}
            <button class="btn-act primary" disabled={actionBusy} onclick={()=>dispatch(GameActions.endTurn())}>⏭ 結束回合</button>
          {/if}
          <!-- v4.74 練習模式 — AI 對戰悔棋（直接回到上一手）-->
          {#if undoSnapshot && mode !== 'online' && aiPlayerIndex !== null && !pendingSelection && game.phase === 'playing'}
            <button class="btn-act btn-undo" onclick={performUndo}
              title="悔棋：回到上一手前（AI 對戰練習模式）。換手後就不能再悔。">
              ↩ 悔棋
            </button>
          {/if}
          <!-- v4.75 連線練習模式 — 請求悔棋（需對手同意）-->
          {#if undoSnapshot && mode === 'online' && roomData?.allowUndo && !undoDeniedThisSnapshot && !undoAwaitingResponse && !pendingSelection && game.phase === 'playing' && mySeatIdx >= 0 && mySeatIdx <= 1 && isMyTurn()}
            <button class="btn-act btn-undo" onclick={performUndo}
              title="向對手請求悔棋（雙方同意制）。換手或被拒絕後就不能再悔。">
              ↩ 請求悔棋
            </button>
          {/if}
          {#if undoAwaitingResponse && mode === 'online' && game.phase === 'playing'}
            <button class="btn-act btn-undo-waiting" disabled title="等待對手回應">
              ⏳ 等待對手同意…
            </button>
            <button class="btn-act btn-undo-cancel" onclick={cancelUndoRequest} title="取消悔棋請求">
              ✗ 取消
            </button>
          {/if}
        {:else if isMyTurn() && anyPendingPrize}
          <span class="waiting-msg">🏆 請先取獎賞卡再繼續行動</span>
        {:else if pendingSelection}
          <span class="waiting-msg">⏳ 等待 {game.players[pendingSelection.actorIdx].name} 選擇中…</span>
        {:else}
          <span class="waiting-msg">⏳ 等待 {game.players[aIdx].name} 行動…</span>
        {/if}
      </div>

      {#if stadiumCard && game.activeStadium}
        {@const stadiumIid = game.activeStadium.cardId}
        <div class="stadium-display" title="場地卡 — 點擊查看詳情" onclick={()=>openZoom(stadiumIid, null)} onkeydown={(e)=>{if(e.key==='Enter')openZoom(stadiumIid, null);}} role="button" tabindex="0">
          <div class="stadium-display-label">🏟 場地</div>
          <img use:retryImg={stadiumCard.imageUrl} src={stadiumCard.imageUrl} alt={stadiumCard.name} />
          <div class="stadium-display-name">{stadiumCard.name} 🔍</div>
        </div>
      {/if}

      <div class="log-col" title="向下滾動可查看從戰鬥開始到現在的完整記錄">
        <!-- v5.724：用原始 log index 當 each key，避免新動作時整個列表 DOM 重建→捲動位置被重置(玩家回顧被跳掉) -->
        {#each [...(game.log??[]).entries()].reverse() as [origIdx, entry], i (origIdx)}
          <!-- v2.130：privateMessage 只給 entry.playerIndex 本人看（對手 / 系統 fallback 到 message） -->
          <!-- v2.88：tokenize 後依類別套色 + 整行類別（turn-marker / victory）-->
          {@const _isPrivate = !!(entry.privateMessage && entry.playerIndex === myIdx)}
          {@const _msgText = _isPrivate ? entry.privateMessage : entry.message}
          {@const _lineCls = logLineClass(_msgText ?? '')}
          {@const _tokens = tokenizeLogMessage(_msgText ?? '', cardNamesSorted)}
          <div class="log-line {_lineCls}" class:log-sys={entry.playerIndex===null} class:log-latest={i===0} class:log-private={_isPrivate}>
            {#if formatLogTime(entry, game?.gameStartTime)}<span class="log-time">{formatLogTime(entry, game?.gameStartTime)}</span>{/if}
            {#if _isPrivate}<span class="log-private-icon" title="只有你看得到">🔒</span>{/if}
            {#each _tokens as tok}{#if tok.cls === 'log-card-link'}<button type="button" class="log-card-link" title="點擊查看 {tok.text} 卡片詳情" onclick={() => openZoomByName(tok.text, tok.iid ?? entry.sourceIid, entry.playerIndex)}>{tok.text}</button>{:else}<span class={tok.cls}>{tok.text}</span>{/if}{/each}
          </div>
        {/each}
      </div>
    </div>

    <!-- 我方場地（永遠在下方） -->
    <div class="field-row my-row">
      {#if game}
        <div class="turn-order-chip" class:active-turn={game.activePlayerIndex === myIdx}
          title={(game.firstPlayerIdx === myIdx ? '我方為先攻玩家' : '我方為後攻玩家')
            + (game.activePlayerIndex === myIdx ? '・目前回合' : '')}>
          {game.firstPlayerIdx === myIdx ? '先攻' : '後攻'}
        </div>
      {/if}
      <div class="zone-prizes">
        {#if isTReplay}
          <button class="zone-label-sm prize-view-btn" onclick={openPrizeView} title="查看雙方獎賞卡（回放限定）">🎁 獎賞 {myPlayer?.prizes.length??0}張 🔍</button>
        {:else}
          <div class="zone-label-sm">獎賞 {myPlayer?.prizes.length??0}張</div>
        {/if}
        <div class="prize-grid">
          {#key prizeAnimKey[myIdx]}
            {#each Array(6) as _, i (i)}{@const _pz = myPlayer?.prizes[i]}{@const _pc = _pz && (_pz.faceUp || isTReplay) ? getCard(_pz.cardId) : null}<div class="prize-card my-prize prize-anim" class:prize-gone={i>=(myPlayer?.prizes.length??0)} class:prize-faceup={!!_pz && (!!_pz.faceUp || isTReplay)} style="animation-delay:{i*90}ms" title={_pc?.name??''}>{#if _pc?.imageUrl}<img use:retryImg={_pc.imageUrl} class="prize-face-img" src={_pc.imageUrl} alt={_pc.name}
              class:legend-half-l={twoCardStadiumHalfIndex(myPlayer?.prizes, _pz?.iid ?? '', pool) === 0}
              class:legend-half-r={twoCardStadiumHalfIndex(myPlayer?.prizes, _pz?.iid ?? '', pool) === 1}/>{/if}</div>{/each}
          {/key}
        </div>
      </div>

      <div class="zone-active my-active-zone">
        <div class="zone-label-sm">
          <span class="zone-label-text">我的出場</span>
          {#if !pendingSelection&&isMyTurn()&&!myPlayer?.active?.fossilOnField&&myPlayer?.active&&(myPlayer?.bench?.length??0)>0&&game?.phase==='playing'&&game?.turnPhase==='main'}
            {#if canRetreatNow}
              <button class="btn-retreat" onclick={(e)=>openFloatingRetreat(e)}>
                撤退（{retreatCostOf(myPlayer!.active!)}⚡）
              </button>
            {:else}
              <!-- v3.37：不能撤退時顯示 disabled 按鈕 + tooltip 說明原因，
                   讓玩家分得清是「規則限制」還是「我方系統 bug」 -->
              <button class="btn-retreat btn-retreat-blocked" disabled
                title={getRetreatBlockReason(game!, pool) ?? '無法撤退（未知原因）'}>
                🚫 撤退（{retreatCostOf(myPlayer!.active!)}⚡）
              </button>
            {/if}
          {/if}
        </div>
        {#if myPlayer?.active}
          {@const ac=getCard(myPlayer.active.cardId)}
          {@const evoOpts=evoOptionsFor(myPlayer.active.iid)}
          <div class="active-card mine-active"
            class:energy-clickable={selectedEnergyIid!==null&&!pendingSelection&&isMyTurn()}
            class:drop-zone={isMyTurn() && !!dragging && ((dragOpFor('poke')==='energy'||dragOpFor('poke')==='tool') || (dragOpFor('poke')==='evolve'&&evolveTargetsFor(dragging.iid).includes(myPlayer.active.iid)))}
            class:drop-hover={dropTargetIid===myPlayer.active.iid}
            class:energy-pulse={energyAttachPulse===myPlayer.active.iid}
            class:attack-shake={attackFx && attackFx.attackerIid === myPlayer.active.iid}
            class:attack-flash={attackFx && attackFx.defenderIid === myPlayer.active.iid}
            class:status-glow-poisoned={myPlayer.active.status === 'poisoned'}
            class:status-glow-burned={myPlayer.active.status === 'burned'}
            class:status-glow-asleep={myPlayer.active.status === 'asleep'}
            class:status-glow-confused={myPlayer.active.status === 'confused'}
            style={attackFx && myPlayer.active && attackFx.defenderIid === myPlayer.active.iid ? `--flash-color:${ENERGY_COLOR[attackFx.energyType]}` : undefined}
            data-drop-type="poke"
            data-drop-iid={myPlayer.active.iid}
            out:scale={{ duration: 360, start: 0.55, opacity: 0 }}
            onclick={()=>selectedEnergyIid&&!pendingSelection&&isMyTurn()&&onAttachEnergy(myPlayer!.active!.iid)}>
            <img use:retryImg={ac?.imageUrl} src={ac?.imageUrl} alt={ac?.name} class="active-img"
              class:zoomable={!selectedEnergyIid}
              onclick={(e)=>{if(!selectedEnergyIid){e.stopPropagation();openZoom(myPlayer!.active!.cardId,myPlayer!.active);}}}
              onpointerenter={(e)=>enterAttCard(e, myPlayer!.active!.cardId)} onpointerleave={leaveAttCard}/>
            <!-- v5.020 桌墊版：附加卡片小卡圖重疊呈現（能量/道具/進化堆）-->
            {#if battleLayout !== 'classic'}
              {@const _attMA = attachedCardsOf(myPlayer.active)}
              {#if _attMA.length > 0}
                <div class="att-card-stack">
                  {#each _attMA as itm, i (itm.iid)}{@const _c=getCard(itm.cardId)}{#if _c}<img use:retryImg={_c.imageUrl} class="att-card att-{itm.kind}" style="left:calc(var(--fan-step, 32px) * {i+1});z-index:{50-i}" onpointerenter={(e)=>enterAttCard(e, itm.cardId)} onpointerleave={leaveAttCard} onclick={(e)=>{e.stopPropagation();openZoom(itm.cardId,null);}} src={_c.imageUrl} alt={_c.name} title={_c.name}/>{/if}{/each}
                </div>
                <!-- v5.410：桌墊版能量/道具 compact overlay（疊在卡圖上，仿手機版）-->
                <div class="tt-attach-overlay">{#each energyPips(myPlayer.active) as pip}<span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>{/each}{#if myPlayer.active.toolAttached || (myPlayer.active.extraTools && myPlayer.active.extraTools.length > 0)}<span class="tt-tool" title="附加道具">🔧{myPlayer.active.extraTools && myPlayer.active.extraTools.length > 0 ? `×${1 + myPlayer.active.extraTools.length}` : ''}</span>{/if}</div>
              {/if}
            {/if}
            <!-- v2.52：能量改為垂直 pip 圖示，排在卡圖右側（與備戰一致）
                 v2.53：無能量時不渲染（避免空欄佔寬度） -->
            {#if energyPips(myPlayer.active).length > 0}
              <div class="active-nrg-col">
                {#each energyPips(myPlayer.active) as pip}
                  <span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                {/each}
              </div>
            {/if}
            <div class="active-info">
              <div class="active-name">{ac?.name}</div>
              {#if myPlayer.active.toolAttached}{@const tc=getCard(myPlayer.active.toolAttached.cardId)}<div class="tool-chip">🔧{tc?.name ?? '道具（未載入）'}</div>{/if}{#each (myPlayer.active.extraTools ?? []) as etMA}{@const tcMA=getCard(etMA.cardId)}<div class="tool-chip">🔧{tcMA?.name ?? '道具（未載入）'}</div>{/each}
              {#if myPlayer.active.abilityUsedThisTurn}<div class="ab-used-chip" title="本回合已使用特性">✨已用特性</div>{/if}
              {#if myPlayer.active.status}<div class="status-chip status-{myPlayer.active.status}">{
                myPlayer.active.status === 'poisoned' ? '☠️ 中毒' :
                myPlayer.active.status === 'burned' ? '🔥 燒傷' :
                myPlayer.active.status === 'asleep' ? '💤 睡眠' :
                myPlayer.active.status === 'confused' ? '😵 混亂' :
                myPlayer.active.status === 'paralyzed' ? '⚡ 麻痺' : myPlayer.active.status
              }</div>{/if}
              <!-- v2.163：同時兩狀態（如危險光線 灼傷+混亂） -->
              {#if myPlayer.active.secondaryStatus}<div class="status-chip status-{myPlayer.active.secondaryStatus}">{
                myPlayer.active.secondaryStatus === 'poisoned' ? '☠️ 中毒' :
                myPlayer.active.secondaryStatus === 'burned' ? '🔥 燒傷' :
                myPlayer.active.secondaryStatus === 'asleep' ? '💤 睡眠' :
                myPlayer.active.secondaryStatus === 'confused' ? '😵 混亂' :
                myPlayer.active.secondaryStatus === 'paralyzed' ? '⚡ 麻痺' : myPlayer.active.secondaryStatus
              }</div>{/if}
              <!-- v5.295/v5.296：三狀態並存獨立第三 chip (中毒+灼傷+混亂) -->
              {#if myPlayer.active.tertiaryStatus}<div class="status-chip status-{myPlayer.active.tertiaryStatus}">{
                myPlayer.active.tertiaryStatus === 'poisoned' ? '☠️ 中毒' :
                myPlayer.active.tertiaryStatus === 'burned' ? '🔥 燒傷' :
                myPlayer.active.tertiaryStatus === 'asleep' ? '💤 睡眠' :
                myPlayer.active.tertiaryStatus === 'confused' ? '😵 混亂' :
                myPlayer.active.tertiaryStatus === 'paralyzed' ? '⚡ 麻痺' : myPlayer.active.tertiaryStatus
              }</div>{/if}
              {#if selectedEnergyIid&&!pendingSelection&&isMyTurn()}<div class="attach-hint">⚡ 點此附加</div>{/if}
            </div>
            <!-- v2.130：血條移到卡牌最下方，避免被特性按鈕擠擋（雙方統一） -->
            <div class="active-hpbar-bottom">
              <div class="hp-bar-wrap"><div class="hp-bar" style="width:{hpTotal(myPlayer.active)?hpRemaining(myPlayer.active)/hpTotal(myPlayer.active)*100:0}%;background:{hpColor(hpRemaining(myPlayer.active),hpTotal(myPlayer.active))}"></div></div>
              <span class="active-hp-text">HP {hpRemaining(myPlayer.active)}/{hpTotal(myPlayer.active)}</span>
              {#if battleLayout !== 'classic'}<div class="active-name-tt">{ac?.name ?? '?'}</div>{/if}
            </div>
            {#if evoOpts.length>0&&!pendingSelection&&isMyTurn()}
              <div class="evo-wrap">
                <button class="evo-btn" onclick={(e)=>{e.stopPropagation();openFloatingEvo(myPlayer!.active!.iid,evoOpts,e);}}>進化▲</button>
              </div>
            {/if}
            <!-- v5.160：觀戰者隱藏特性按鈕（isMyTurn 對觀戰者永遠 false） -->
            {#if isMyTurn()}
              {#each usableAbilities.filter(a=>a.iid===myPlayer!.active!.iid) as ab}
                <button class="ability-btn" disabled={actionBusy} onclick={(e)=>{e.stopPropagation();dispatch(GameActions.useAbility(ab.iid,ab.abilityIndex));}}>
                  ✨{ab.abilityName}
                </button>
              {/each}
            {/if}
          </div>
        {:else}
          <div class="active-card active-empty"
            class:drop-zone={dragOpFor('active-empty')!==null&&game?.phase==='setup'&&isMyTurn()}
            class:drop-hover={dropActiveEmpty&&dragOpFor('active-empty')!==null}
            data-drop-type="active-empty">
            {#if game?.phase==='setup'}🃏 拖曳基礎寶可夢到這裡{:else}（無出場）{/if}
          </div>
        {/if}
      </div>

      <div class="zone-bench" class:bench-extended={myBenchLimit > 5} style="--bench-n:{myBenchLimit}">
        {#each Array(Math.max(Math.min(5, (myPlayer?.bench.length ?? 0) + 1), myBenchLimit, 1)) as _, i (i)}
          {#if myPlayer?.bench[i]}
            {@const b=myPlayer.bench[i]}{@const bc=getCard(b.cardId)}{@const evoOptsB=evoOptionsFor(b.iid)}
            <div class="bench-slot"
              class:energy-target={selectedEnergyIid!==null&&!pendingSelection&&isMyTurn()}
              class:drop-zone={isMyTurn() && !!dragging && ((dragOpFor('poke')==='energy'||dragOpFor('poke')==='tool') || (dragOpFor('poke')==='evolve'&&evolveTargetsFor(dragging.iid).includes(b.iid)))}
              class:drop-hover={dropTargetIid===b.iid}
              class:energy-pulse={energyAttachPulse===b.iid}
              data-drop-type="poke"
              data-drop-iid={b.iid}
              out:scale={{ duration: 320, start: 0.55, opacity: 0 }}
              onclick={()=>selectedEnergyIid&&!pendingSelection&&isMyTurn()&&onAttachEnergy(b.iid)}>
              <!-- v2.49：名字/HP 移到卡牌上方，避免與下方進化按鈕/特性按鈕/能量 pip 擠在一起 -->
              <div class="bench-name">{bc?.name}</div>
              <div class="bench-stat">HP {hpRemaining(b)}/{hpTotal(b)}</div>
              <!-- v2.51：加寬 slot + 能量 pip 改為垂直排列在圖片右側，避免能量超過 2 個時撐高
                   v2.53：bench-nrg 條件渲染 — 沒能量就不 render 右側欄，讓 img 置中填滿 slot -->
              <div class="bench-middle">
                <img use:retryImg={bc?.imageUrl} src={bc?.imageUrl} alt={bc?.name}
                  class:zoomable={!selectedEnergyIid}
                  onclick={(e)=>{if(!selectedEnergyIid){e.stopPropagation();openZoom(b.cardId,b);}}}
                  onpointerenter={(e)=>enterAttCard(e, b.cardId)} onpointerleave={leaveAttCard}/>
                <!-- v5.020 桌墊版：附加卡片小卡圖重疊呈現（能量/道具/進化堆）-->
                {#if battleLayout !== 'classic'}
                  {@const _attMB = attachedCardsOf(b)}
                  {#if _attMB.length > 0}
                    <!-- v5.038：疊牌動態間距 — 越多張疊得越密（同對手 bench 邏輯） -->
                    {@const _stepMB = Math.max(12, 32 - _attMB.length * 3)}
                    <div class="att-card-stack">
                      {#each _attMB as itm, i (itm.iid)}{@const _c=getCard(itm.cardId)}{#if _c}<img use:retryImg={_c.imageUrl} class="att-card att-{itm.kind}" style="top:{-(i+1) * _stepMB}px;z-index:{50-i}" onpointerenter={(e)=>enterAttCard(e, itm.cardId)} onpointerleave={leaveAttCard} onclick={(e)=>{e.stopPropagation();openZoom(itm.cardId,null);}} src={_c.imageUrl} alt={_c.name} title={_c.name}/>{/if}{/each}
                    </div>
                    <!-- v5.410：桌墊版能量/道具 compact overlay（疊在卡圖上，仿手機版）-->
                    <div class="tt-attach-overlay">{#each energyPips(b) as pip}<span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>{/each}{#if b.toolAttached || (b.extraTools && b.extraTools.length > 0)}<span class="tt-tool" title="附加道具">🔧{b.extraTools && b.extraTools.length > 0 ? `×${1 + b.extraTools.length}` : ''}</span>{/if}</div>
                  {/if}
                {/if}
                {#if energyPips(b).length > 0}
                  <div class="bench-nrg">
                    {#each energyPips(b) as pip}
                      <span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="hp-bar-wrap sm"><div class="hp-bar" style="width:{hpTotal(b)?hpRemaining(b)/hpTotal(b)*100:0}%;background:{hpColor(hpRemaining(b),hpTotal(b))}"></div></div>
              {#if b.toolAttached}{@const tc2=getCard(b.toolAttached.cardId)}<div class="tool-chip sm">🔧{tc2?.name ?? '道具'}</div>{/if}{#each (b.extraTools ?? []) as et2}{@const tcE2=getCard(et2.cardId)}<div class="tool-chip sm">🔧{tcE2?.name ?? '道具'}</div>{/each}
              {#if b.abilityUsedThisTurn}<div class="ab-used-chip sm" title="本回合已使用特性">✨</div>{/if}
              <!-- v2.47：備戰區寶可夢依 PTCG 規則不會有異常狀態；engine scrubBenchStatus 亦會抹除，
                   這裡不再渲染 status chip（避免佔版面） -->
              {#if b.status}<div class="status-chip-sm status-{b.status}" title="異常狀態（不應出現於備戰，請回報）">{
                b.status === 'poisoned' ? '☠️' :
                b.status === 'burned' ? '🔥' :
                b.status === 'asleep' ? '💤' :
                b.status === 'confused' ? '😵' : '⚡'
              }</div>{/if}
              {#if selectedEnergyIid&&!pendingSelection&&isMyTurn()}<div class="attach-hint">⚡</div>{/if}
              {#if evoOptsB.length>0&&!pendingSelection&&isMyTurn()}
                <button class="evo-btn-sm" onclick={(e)=>{e.stopPropagation();openFloatingEvo(b.iid,evoOptsB,e);}}>進化</button>
              {/if}
              <!-- v5.160：觀戰者隱藏特性按鈕（isMyTurn 對觀戰者永遠 false） -->
              {#if isMyTurn()}
                {#each usableAbilities.filter(a=>a.iid===b.iid) as ab}
                  <button class="ability-btn-sm" disabled={actionBusy} onclick={(e)=>{e.stopPropagation();dispatch(GameActions.useAbility(ab.iid,ab.abilityIndex));}}>✨{ab.abilityName}</button>
                {/each}
              {/if}
              <!-- v2.189 化石卡【丟棄】按鈕：備戰版本 -->
              {#if b.fossilOnField && isMyTurn() && game?.phase==='playing' && game?.turnPhase==='main' && !pendingSelection}
                <button class="evo-btn-sm fossil-discard-btn"
                  title="把化石丟棄到棄牌區（非昏厥，對手不抽獎賞）"
                  onclick={(e)=>{e.stopPropagation();dispatch(GameActions.discardFossil(b.iid));}}>
                  🦴 丟棄
                </button>
              {/if}
            </div>
          {:else}
            <!-- ⭐v6.200：空備戰格的高亮改問中央 dragOpFor('bench-empty')（與實際結算同一支）——
                 原本硬列 basic/fossil 兩種 kind，手牌特性（放備戰）拖過去時格子不會亮。 -->
            <div class="bench-slot bench-empty"
              class:drop-zone={dragOpFor('bench-empty')!==null&&isMyTurn()&&(myPlayer?.bench.length??0)<myBenchLimit&&(game?.phase==='playing'||(game?.phase==='setup'&&!!myPlayer?.active))}
              class:drop-hover={dropBenchEmpty&&dragOpFor('bench-empty')!==null}
              data-drop-type="bench-empty"></div>
          {/if}
        {/each}
      </div>

      <div class="zone-pile">
        <div class="pile-slot deck-pile" class:shuffling={shuffleFlashUntil[myIdx] > 0}>
          <span class="pile-icon">🃏</span>
          <span class="pile-count">{myPlayer?.deck.length??0}</span>
          <span class="pile-label">牌庫</span>
          {#if shuffleFlashUntil[myIdx] > 0}<span class="shuffle-spark">🌀</span>{/if}
        </div>
        <div class="pile-slot disc-pile" class:discard-pulse={discardFlashUntil[myIdx] > 0}
          onclick={() => viewDiscardFor = myIdx} title="查看我的棄牌區">
          <span class="pile-icon">🗑</span>
          <span class="pile-count">{myPlayer?.discard.length??0}</span>
          <span class="pile-label">棄牌</span>
        </div>
      </div>
    </div>
  </div><!-- /.playmat -->

  <!-- 手牌列（永遠顯示自己的手牌） -->
  <div class="hand-strip">
    <div class="hand-label">✋ {myPlayer?.name} 的手牌（{myPlayer?.hand.length??0} 張）
      {#if !isMyTurn()}<span class="hand-not-my-turn">（等待對手行動中）</span>{/if}
    </div>
    <div class="hand-scroll" class:is-dragging={!!dragging?.moved}
      style="--hand-overlap:{(myPlayer?.hand.length??0)<=9 ? 0 : Math.min(58, ((myPlayer?.hand.length??0)-9)*7)}px;">
      <!-- v2.43: setup 階段要等硬幣動畫結束才開始發牌（感覺上是硬幣→發 7 張） -->
      <!-- v3.87: 本機雙人換人時用 {#key myIdx} 強制重 mount 手牌 — 修「換人後手牌不顯示」race -->
      {#if !game || game.phase !== 'setup' || coinFlipStage === 'done'}
      {#if isTReplay}
        <!-- v5.940 回放:攤開行動方真手牌(面朝上,唯讀,點擊放大) -->
        {#each dedupeByIid(myPlayer?.hand) as inst (inst.iid)}{@const _rc=getCard(inst.cardId)}<div class="hand-card spectator-hand-face" title={_rc?.name ?? ''} onclick={() => openZoom(inst.cardId, inst)} onkeydown={(e)=>{if(e.key==='Enter')openZoom(inst.cardId, inst);}} role="button" tabindex="0">{#if _rc?.imageUrl}<img use:retryImg={_rc.imageUrl} class="replay-hand-img" src={_rc.imageUrl} alt={_rc.name} class:legend-half-l={twoCardStadiumHalfIndex(myPlayer?.hand, inst.iid, pool) === 0} class:legend-half-r={twoCardStadiumHalfIndex(myPlayer?.hand, inst.iid, pool) === 1}/>{:else}<div class="card-back card-back-sm"><span class="card-back-mark">?</span></div>{/if}</div>{/each}
      {:else if isTournSpectator}
        {#each dedupeByIid(myPlayer?.hand) as inst (inst.iid)}<div class="hand-card spectator-hand-back"><div class="card-back card-back-sm"><span class="card-back-mark">?</span></div></div>{/each}
      {:else}
      {#key myIdx}
      {#each dedupeByIid(myPlayer?.hand) as inst, i (inst.iid)}
        {@const c=getCard(inst.cardId)}
        {@const n=(myPlayer?.hand.length??0)}
        {@const mid=(n-1)/2}
        {@const step=Math.min(4, 36/Math.max(1,n))}
        {@const rot=n>1?(i-mid)*step:0}
        {@const liftY=Math.abs(i-mid)*(step*0.6)}
        {#if c}
          <!-- ⭐⭐⭐v6.200：手牌卡的可用性**只有一份來源** handCardOps（見 $lib/game/hand-card-ops）。
               v6.199 以前這裡是「拖曳一份 dragKind ／ 點擊一份 canHandActivate」的兩份條件，
               v6.080 新增手牌特性時只補了點擊那份 → 烈箭鷹ex｜激動俯衝 桌機拖不動（玩家回報）。
               ⚠ 禁止在這個 block 內再自行計算任何「能不能做某操作」的條件；
                 新增操作種類請加到 hand-card-ops.ts 的 HandCardOp。 -->
          {@const ops = handCardOps.get(inst.iid) ?? EMPTY_HAND_OPS}
          {@const isToolCard=c.supertype === 'Trainer' && c.subtype === 'PokemonTool'}
          {@const canEnergy=ops.has('energy')}
          {@const canBasic=ops.has('basic')||ops.has('basic-setup')||ops.has('setup-active')}
          {@const canFossil=ops.has('fossil')}
          {@const canTrainer=ops.has('trainer')||ops.has('tool')}
          {@const canEvolve=ops.has('evolve')}
          <!-- v5.511 緊急迴轉(齒輪怪) / v6.080 激動俯衝(烈箭鷹ex) — 黃框可用、**拖**到空備戰格發動。
               ⭐⭐⭐v6.208 站長裁定：手牌特性**不可以點一下就發動**（玩家回報「碰一下就放到場上」）。
               v6.200 之前這裡是「拖不動、只能點」，v6.200 把拖曳補起來之後，
               點擊那條就從「唯一入口」變成純粹的誤觸來源。
               桌機其他手牌卡點一下的**實際**行為（逐條查證本檔 v6.207 的 onclick）：
                 ・能量卡 → 只切換 selectedEnergyIid（選取／取消選取），不會附上去
                 ・基礎／化石／訓練家／道具／進化 → onclick **沒有對應分支＝什麼都不做**（一律拖曳）
               ⇒ 手牌特性比照「什麼都不做」；桌機唯一入口＝拖到空備戰格（HAND_OP_DROP_TARGET）。
               ⚠ 手機直式（MobilePortraitBattle.svelte）**不走這個 onclick**：點卡片是開 sheet 選單，
                 再按「⚡ 該特性名 (放備戰)」才發動 ⇒ 手機可用性完全不受本次改動影響。 -->
          {@const canHandActivate = ops.has('hand-ability')}
          {@const dragKind = handCardDragKind(ops)}
          {@const isActionable = handCardDraggable(ops)}
          <div class="hand-card" class:action-busy={actionBusy}
            class:selected={selectedEnergyIid===inst.iid}
            class:can-actionable={isActionable}
            class:dragging={dragging?.iid===inst.iid}
            class:draggable={dragKind!==null}
            class:hover-peek={hoverHandIid===inst.iid}
            class:arriving={arrivingIids.has(inst.iid)}
            class:just-arrived={justArrivedIids.has(inst.iid)}
            style="--fan-rot:{rot}deg;--fan-lift:{liftY}px;"
            in:fly={{ x: 220, y: -40, duration: game?.phase === 'setup' ? 480 : 220, delay: (game?.phase === 'setup' ? i * 150 : i * 40), easing: cubicOut }}
            out:fly={{ y: -220, duration: 220, easing: cubicOut }}
            onpointerenter={(e)=>enterHandCard(e, inst.iid)}
            onpointerleave={leaveHandCard}
            onpointerdown={(e)=>{leaveHandCard(); if(handCardDraggable(ops)){ if(actionBusy){tActSay(TACT_BLOCKED_MSG,5000);} else startDrag(e, inst, ops, c); }}}
            onclick={()=>{if(actionBusy){tActSay(TACT_BLOCKED_MSG,5000);return;} if(canEnergy && !dragging)selectedEnergyIid=selectedEnergyIid===inst.iid?null:inst.iid;}}
            title={canHandActivate?(canEvolve?`拖到空備戰格發動特性、拖到進化目標進化 · ${c.name}`:`拖到備戰格使用特性 · ${c.name}`):(dragKind?`拖曳使用 · ${c.name}`:c.name)}>
            <!-- v4.27 修：iPad / 觸控裝置 tap 此鈕本來會「同時」觸發 parent 的 hover-peek 大圖
                 預覽 + 自己的 openZoom modal（兩種視覺都出現很多餘）。玩家要求只保留 hover-peek。
                 改法：onclick 不再呼叫 openZoom，僅 stopPropagation 防觸發外層 startDrag/click。
                 觸控時 parent .hand-card 的 onpointerenter/leave 自動管 hover-peek：
                   - 按下手指 → 進入 .hand-card → pointerenter → 大圖預覽顯示
                   - 放開手指 → 離開 .hand-card → pointerleave → 預覽消失
                 桌機（>950px）此鈕 display:none，沿用 hover-peek，本來就不受影響。 -->
            <button class="hand-zoom-btn"
              onpointerdown={(e)=>e.stopPropagation()}
              onclick={(e)=>e.stopPropagation()}
              title="長按查看 {c.name}">🔍</button>
            <!-- v6.086「兩張合一」競技場：官方只給一張合併橫圖（≈兩張直卡並排），
                 手牌依 Wilson 裁定顯示成**兩張直立的卡** → 同一張圖裁左半／右半（零新圖片資源）。
                 ⚠ 這裡不能用 {@const}（Svelte 5 限定它只能是 #if/#each 等的直接子節點），
                   直接寫成 class: 的表達式；手牌張數很少，重複呼叫成本可忽略。 -->
            <img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}
              class:legend-half-l={twoCardStadiumHalfIndex(myPlayer?.hand, inst.iid, pool) === 0}
              class:legend-half-r={twoCardStadiumHalfIndex(myPlayer?.hand, inst.iid, pool) === 1}/>
            <span class="hand-name">{c.name}</span>
            <!-- v6.099：機制 A 的手牌觸發按鈕已移除（死碼，見上方說明） -->
            <!-- v5.511：緊急迴轉 改為「黃框可用 + 拖到空備戰格發動」（⭐v6.208 站長裁定：點卡不再發動），不再顯示按鈕標示 -->
            {#if canHandActivate && canEvolve}<span class="hand-hint hl">⚡ 拖到備戰發動特性／🔺 拖到進化目標</span>
            {:else if canHandActivate}<span class="hand-hint hl">⚡ 拖到備戰發動特性</span>
            {:else if canEnergy}<span class="hand-hint hl">⚡ 拖曳附加</span>
            {:else if canBasic}<span class="hand-hint hl">📥 拖到備戰</span>
            {:else if canFossil}<span class="hand-hint hl">🦴 化石放到備戰</span>
            {:else if canEvolve}<span class="hand-hint hl">🔺 拖到進化目標</span>
            {:else if canTrainer && isToolCard}<span class="hand-hint hl">🔧 拖到寶可夢</span>
            {:else if canTrainer}<span class="hand-hint hl">🎴 拖曳使用</span>
            {/if}
          </div>
        {/if}
      {/each}
      {/key}
      {/if}
      {/if}
    </div>
  </div>
  {/if}<!-- /isPortraitMobile && playing -->

<!-- ⭐ v6.107：「對手長時間無回應 → 宣告棄權」banner 與確認視窗原本寫在上面那個
     {#if isPortraitMobile}…{:else}…{/if} 的**桌機分支內**，手機直式版完全看不到 ——
     計時邏輯照跑、oppInactivityWarn 照樣變 true，但沒有任何 UI 消費它
     （與 v6.098「黃框會亮但按鈕不存在」同型）。移到區塊外，兩種版面共用同一份。
     ⚠ 不要再把它搬回任何一個版面分支裡。 -->
{#if oppInactivityWarn && (game?.phase === 'playing' || game?.phase === 'setup') && (mySeatIdx === 0 || mySeatIdx === 1)}
  <div class="opp-inactive-banner">
    <span class="opp-inactive-text">⚠️ 對手長時間無回應</span>
    <button class="opp-inactive-btn" onclick={onClickClaimForfeit}>宣告對手棄權獲勝</button>
  </div>
{/if}
{#if showForfeitConfirm}
  <div class="forfeit-modal-backdrop" onclick={() => showForfeitConfirm = false} role="presentation">
    <div class="forfeit-modal" onclick={(e) => e.stopPropagation()} role="dialog">
      <h3 class="forfeit-title">確定宣告對手棄權？</h3>
      <p class="forfeit-desc">對手已超過 {fmtMMSS(Math.min(300, Math.max(60, roomData?.idleTimeoutSec ?? 180)))} 無回應。確認後系統會立刻判定你獲勝，無法撤回。</p>
      <div class="forfeit-actions">
        <button class="forfeit-confirm" onclick={confirmClaimForfeit}>確定獲勝</button>
        <button class="forfeit-cancel" onclick={() => showForfeitConfirm = false}>再等等</button>
      </div>
    </div>
  </div>
{/if}

  <!-- PendingSelection — 只對 actor 玩家顯示（避免對手看到或搶先操作）
       v2.196 修：mode='local' 嚴格 check，不接受 null。線上模式剛 join 時 mode 還未確定
       但 pendingSelection 可能已從 firestore sync 進來，舊 condition `mode !== 'online'` 為
       true 會錯誤顯示 modal（嚴重隱私 bug：對手看到我選牌畫面）。
       本機雙人模式（mode='local'）視角會隨 actor 自動翻轉，actor 永遠等於當前視角，
       不需另加 actor === myIdx check（會誤判）。 -->
  {#if pendingSelection && !suppressToolSelectModal && (
    (mode === 'online' && myPlayerIndex !== null && pendingSelection.actorIdx === myPlayerIndex)
    || (mode === 'local' && aiPlayerIndex === null)
    || (mode !== 'online' && aiPlayerIndex !== null && pendingSelection.actorIdx === (1 - aiPlayerIndex))
  )}
    {@const isPokePicker = pendingSelection.type==='bench-choose' || pendingSelection.type==='opp-bench-choose' || pendingSelection.type==='opp-poke-choose' || pendingSelection.type==='heal-target'}
    {@const isDmgDist   = pendingSelection.type==='damage-distribute'}
    {@const isEnergyDist = pendingSelection.type==='energy-distribute'}
    {@const dmgTotal    = (pendingSelection.params?.totalCounters as number | undefined) ?? pendingSelection.maxCount}
    {@const dmgPlaced   = (pendingSelection.params?.placedCounters as number | undefined) ?? 0}
    {@const dmgPer      = (pendingSelection.params?.counterDamage as number | undefined) ?? 10}
    {@const isAbraRem   = isDmgDist && pendingSelection.params?.abraRemove === true}
    {@const energyTotal = (pendingSelection.params?.totalCount as number | undefined) ?? pendingSelection.maxCount}
    {@const energyPlaced = (pendingSelection.params?.placedCount as number | undefined) ?? 0}
    {@const energyTypeName = (pendingSelection.params?.energyTypeName as string | undefined) ?? ''}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal" class:retreat-modal={isPokePicker || isDmgDist || isEnergyDist} style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>{selectionTitle(pendingSelection.type)}</h3>
          {#if isDmgDist}
            <div class="dmg-progress">
              <div class="dmg-progress-bar">
                <div class="dmg-progress-fill" style="width:{Math.min(100, ((dmgPlaced + selectionBatchSum) / dmgTotal) * 100)}%"></div>
              </div>
              <div class="dmg-progress-text">
                {isAbraRem ? '已抽走' : '已放置'} <strong>{(dmgPlaced + selectionBatchSum) * dmgPer}</strong>／{dmgTotal * dmgPer}
                　<span class="muted">（{dmgPlaced + selectionBatchSum}／{dmgTotal} 個指示物）</span>
              </div>
              <p class="sel-hint">
                {#if isAbraRem}
                  剩餘可抽走 <strong>{pendingSelection.maxCount - selectionBatchSum}</strong>／{pendingSelection.maxCount} 個
                  · 點對手寶可夢抽走其身上指示物（每隻最多抽走其現有數）· 確認後開「分配」視窗（可選 0 略過）
                {:else}
                  本批次剩餘可放 <strong>{pendingSelection.maxCount - selectionBatchSum}</strong>／{pendingSelection.maxCount} 個
                  · 點目標 +1、按「－」鍵 或 右鍵 -1 · 確認後若還有指示物會再開此視窗
                {/if}
              </p>
            </div>
          {:else if isEnergyDist}
            <!-- v2.87 同類能量分配 -->
            <div class="dmg-progress">
              <div class="dmg-progress-bar">
                <div class="dmg-progress-fill" style="width:{Math.min(100, ((energyPlaced + selectionBatchSum) / energyTotal) * 100)}%"></div>
              </div>
              <div class="dmg-progress-text">
                已附加 <strong>{energyPlaced + selectionBatchSum}</strong>／{energyTotal} 張{energyTypeName ? `【${energyTypeName}】` : ''}能量
              </div>
              <p class="sel-hint">
                本批次剩餘可附 <strong>{pendingSelection.maxCount - selectionBatchSum}</strong>／{pendingSelection.maxCount} 張
                · 點目標 +1、右鍵 -1 · 全部分配完後按「確認」一次套用
              </p>
            </div>
          {:else}
            <p class="sel-hint">
              選 {pendingSelection.minCount===pendingSelection.maxCount?`${pendingSelection.minCount}`:`${pendingSelection.minCount}～${pendingSelection.maxCount}`} 張
              {#if pendingSelection.filter&&pendingSelection.filter!=='TOP6'&&!pendingSelection.filter.startsWith('Supporter')}（{describeFilter(pendingSelection.filter)}）{/if}
              · 已選 {selectionPicked.size}{#if selectedNamesLabel}：<b class="sel-picked-names">{selectedNamesLabel}</b>{/if}
              {#if isPokePicker}· 點放大鏡 🔍 查看詳情{/if}
            </p>
            <!-- v5.147：撤退能量 picker 加能量需求進度顯示 (Wilson 要求 X/Y 格式) -->
            {#if pendingSelection.type === 'active-energy-discard' && pendingSelection.effectKey === 'retreat-energy-discard'}
              {@const _retreatCost = (pendingSelection.params?.retreatCost as number | undefined) ?? 0}
              {@const _pickedInstsForHint = selectionItems.filter(it => selectionPicked.has(it.iid))}
              {@const _hostForHint = game?.players[pendingSelection.actorIdx as 0|1].active ?? undefined}
              {@const _currentUnits = totalEnergyUnits(_pickedInstsForHint, pool, game ?? undefined, pendingSelection.actorIdx as 0|1, _hostForHint)}
              <p class="sel-hint" style="color:{_currentUnits >= _retreatCost ? '#88e088' : '#ffd54a'};font-weight:bold;">
                ⚡ 撤退能量需求：{_currentUnits}/{_retreatCost} 單位 {_currentUnits >= _retreatCost ? '✓ 已達標' : '（請繼續選擇）'}
              </p>
            {/if}
          {/if}
        </div>
        {#snippet activeSpotBadge(isOpp)}
          <span class="retreat-active-badge" class:opp={isOpp} title={isOpp ? '對手目前戰鬥寶可夢' : '我方目前戰鬥寶可夢'}>⚔️ {isOpp ? '對手' : '我方'}戰鬥寶可夢</span>
        {/snippet}
        {#if isPokePicker}
          {@const srcActiveIid = game?.players[pendingSelection.sourcePlayerIdx].active?.iid ?? null}
          {@const isOppPicker = pendingSelection.type==='opp-poke-choose' || pendingSelection.type==='opp-bench-choose'}
          <div class="retreat-grid">
            {#each selectionItems as item (item.iid)}{@const c=getCard(item.cardId)}
              {#if c}
                {@const eff=hpTotal(item)}
                {@const rem=hpRemaining(item)}
                {@const picked=selectionPicked.has(item.iid)}
                {@const isActivePoke = item.iid === srcActiveIid}
                <div class="retreat-card" class:sel-picked={picked} class:is-active-poke={isActivePoke}>
                  <button class="retreat-zoom" title="放大檢視：{c.name}"
                    onclick={(e)=>{e.stopPropagation();openZoom(item.cardId, item);}}>🔍</button>
                  <button class="retreat-pick" onclick={(e)=>{e.stopPropagation();toggleSelection(item.iid);}}>
                    {#if isActivePoke}{@render activeSpotBadge(isOppPicker)}{/if}
                    <img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}/>
                    <div class="retreat-name">{c.name}</div>
                    <div class="retreat-hp">HP {rem}/{eff}</div>
                    <div class="retreat-nrg">{energySummary(item)}</div>
                    {#if item.toolAttached}{@const tc=getCard(item.toolAttached.cardId)}<div class="retreat-tool">🔧 {tc?.name ?? '?'}</div>{/if}{#each (item.extraTools ?? []) as etIT}{@const tcIT=getCard(etIT.cardId)}<div class="retreat-tool">🔧 {tcIT?.name ?? '?'}</div>{/each}
                    {#if item.status}<div class="retreat-status">
                      {item.status==='poisoned'?'☠️':item.status==='burned'?'🔥':item.status==='asleep'?'💤':item.status==='confused'?'😵':item.status==='paralyzed'?'⚡':''}
                      {item.status}
                    </div>{/if}
                    {#if picked}<span class="sel-check">✓</span>{/if}
                  </button>
                </div>
              {/if}
            {/each}
            {#if selectionItems.length===0}<p class="sel-empty">（沒有符合條件的寶可夢）</p>{/if}
          </div>
        {:else if isDmgDist}
          {@const srcActiveIidD = game?.players[pendingSelection.sourcePlayerIdx].active?.iid ?? null}
          {@const batchFull = selectionBatchSum >= pendingSelection.maxCount}
          <div class="retreat-grid">
            {#each selectionItems as item (item.iid)}{@const c=getCard(item.cardId)}
              {#if c}
                {@const eff=hpTotal(item)}
                {@const rem=hpRemaining(item)}
                {@const cnt=selectionCounts[item.iid] ?? 0}
                {@const isActivePoke = item.iid === srcActiveIidD}
                {@const projected = item.damage + (isAbraRem ? -1 : 1) * cnt * dmgPer}
                {@const willKO = !isAbraRem && eff > 0 && projected >= eff}
                {@const removeCap = Math.floor(item.damage / dmgPer)}
                <div class="retreat-card" class:sel-picked={cnt>0} class:is-active-poke={isActivePoke} class:will-ko={willKO}>
                  <button class="retreat-zoom" title="放大檢視：{c.name}"
                    onclick={(e)=>{e.stopPropagation();openZoom(item.cardId, item);}}>🔍</button>
                  {#if cnt > 0}
                    <button class="dmg-minus" title="移除 1 個指示物（右鍵/減號 快捷）"
                      onclick={(e)=>{e.stopPropagation();decrementCount(item.iid);}}>−</button>
                  {/if}
                  <button class="retreat-pick" disabled={batchFull || (isAbraRem && cnt >= removeCap)}
                    oncontextmenu={(e)=>{e.preventDefault();decrementCount(item.iid);}}
                    onclick={(e)=>{e.stopPropagation();incrementCount(item.iid);}}>
                    {#if isActivePoke}{@render activeSpotBadge(true)}{/if}
                    <img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}/>
                    <div class="retreat-name">{c.name}</div>
                    <div class="retreat-hp">HP {rem}/{eff}</div>
                    <div class="retreat-nrg">{energySummary(item)}</div>
                    {#if cnt > 0}
                      <div class="dmg-preview">
                        {isAbraRem ? '−' : '+'}{cnt * dmgPer} → {Math.max(0, Math.min(projected, eff))}/{eff}
                        {#if willKO}<span class="dmg-ko-tag">KO</span>{/if}
                      </div>
                    {/if}
                  </button>
                  {#if cnt > 0}<span class="dmg-badge">×{cnt}</span>{/if}
                </div>
              {/if}
            {/each}
            {#if selectionItems.length===0}<p class="sel-empty">（對手沒有備戰寶可夢，無法分配）</p>{/if}
          </div>
        {:else if isEnergyDist}
          <!-- v2.87 同類能量分配 +/- 計數器 -->
          {@const srcActiveIidE = game?.players[pendingSelection.sourcePlayerIdx].active?.iid ?? null}
          {@const batchFullE = selectionBatchSum >= pendingSelection.maxCount}
          <div class="retreat-grid">
            {#each selectionItems as item (item.iid)}{@const c=getCard(item.cardId)}
              {#if c}
                {@const eff=hpTotal(item)}
                {@const rem=hpRemaining(item)}
                {@const cntE=selectionCounts[item.iid] ?? 0}
                {@const isActivePoke = item.iid === srcActiveIidE}
                <div class="retreat-card" class:sel-picked={cntE>0} class:is-active-poke={isActivePoke}>
                  <button class="retreat-zoom" title="放大檢視：{c.name}"
                    onclick={(e)=>{e.stopPropagation();openZoom(item.cardId, item);}}>🔍</button>
                  {#if cntE > 0}
                    <button class="dmg-minus" title="移除 1 張能量（右鍵 快捷）"
                      onclick={(e)=>{e.stopPropagation();decrementCount(item.iid);}}>−</button>
                  {/if}
                  <button class="retreat-pick" disabled={batchFullE}
                    oncontextmenu={(e)=>{e.preventDefault();decrementCount(item.iid);}}
                    onclick={(e)=>{e.stopPropagation();incrementCount(item.iid);}}>
                    {#if isActivePoke}{@render activeSpotBadge(false)}{/if}
                    <img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}/>
                    <div class="retreat-name">{c.name}</div>
                    <div class="retreat-hp">HP {rem}/{eff}</div>
                    <div class="retreat-nrg">{energySummary(item)}</div>
                    {#if cntE > 0}
                      <div class="dmg-preview">
                        +{cntE} 張{energyTypeName ? `【${energyTypeName}】` : ''}能量
                      </div>
                    {/if}
                  </button>
                  {#if cntE > 0}<span class="dmg-badge">×{cntE}</span>{/if}
                </div>
              {/if}
            {/each}
            {#if selectionItems.length===0}<p class="sel-empty">（場上沒有可附加的寶可夢）</p>{/if}
          </div>
        {:else}
          {@const isEnergyPicker = pendingSelection.type === 'active-energy-discard'}
          <!-- v3.827: 能量 picker 在每張能量卡下方顯示來源寶可夢
               場景：鐵斑葉ex 迅速游標（scope=all-own，多來源）+ 急進開關（targetIid 單來源）
               +未來能量轉移類道具。即使單一來源也顯示，讓玩家明確知道對象。 -->
          {@const energyOwnerMap = (() => {
            // v3.828: 存整個 CardInstance（不只 name）讓標籤能觸發 openZoom 放大寶可夢
            // v4.01: 加 isActive flag 用於 UI 標示 [戰鬥場]/[備戰]
            if (!isEnergyPicker || !game) return new Map<string, { name: string; inst: CardInstance; isActive: boolean }>();
            const src = game.players[pendingSelection.sourcePlayerIdx];
            const allPokes = [...(src.active ? [src.active] : []), ...src.bench];
            const m = new Map<string, { name: string; inst: CardInstance; isActive: boolean }>();
            for (const pk of allPokes) {
              const pkName = pool.get(pk.cardId)?.name ?? '?';
              const isActive = pk.iid === src.active?.iid;
              for (const e of pk.energyAttached) m.set(e.iid, { name: pkName, inst: pk, isActive });
            }
            return m;
          })()}
          {@const concealed = pendingSelection.params?.concealed === true}
          <div class="sel-grid" class:sel-grid-energy={isEnergyPicker}>
            <!-- v6.150：concealed（卡面「在不看正面的情況下」）的候選卡，錦標賽伺服器不會揭示
                 cardId（揭示了就違反卡面），所以 getCard 一定回 undefined。concealed 分支本來就
                 只畫卡背與 ???、完全不需要卡面資料；若沿用「有卡面才渲染」的判斷，選擇視窗會整片
                 空白，而這類 picker minCount 至少 1 又沒有取消鈕 ⇒ 使用該招式的玩家會被閒置判負
                 （太陽伊布ex｜精神出局、拍落、占為己有、驚嚇、鈴鈴吵鬧 … 共 10 招）。 -->
            {#each selectionItems as item (item.iid)}{@const c=getCard(item.cardId)}
              {#if c || concealed}
                {@const _bdDisabled = isBrocksDigDisabled(item) || isFishnetDisabled(item)}
                <div class="sel-card-wrap" class:sel-picked={selectionPicked.has(item.iid)} class:sel-concealed={concealed} class:bd-disabled={_bdDisabled}>
                  {#if !concealed}
                    {#if isEnergyPicker && energyOwnerMap.has(item.iid)}
                      {@const _zOwner = energyOwnerMap.get(item.iid)!}
                      <!-- v4.28：能量 picker 上的 🔍 改為放大擁有該能量的寶可夢
                           （玩家不需要看基本能量的詳細說明，看寶可夢卡比較有戰術意義） -->
                      <button class="sel-zoom" title="放大檢視擁有此能量的寶可夢：{_zOwner.name}"
                        onclick={(e)=>{e.stopPropagation();openZoom(_zOwner.inst.cardId, _zOwner.inst);}}>🔍</button>
                    {:else}
                      <button class="sel-zoom" title="放大檢視：{c.name}"
                        onclick={(e)=>{e.stopPropagation();openZoom(item.cardId, item);}}>🔍</button>
                    {/if}
                  {/if}
                  <button class="sel-card" disabled={_bdDisabled}
                    title={_bdDisabled ? '依小剛的發掘規則，此卡目前不可選（Basic+Evolution 不可混選；Evolution 最多 1）' : ''}
                    onclick={()=>toggleSelection(item.iid)}>
                    {#if concealed}
                      <!-- v3.9998：concealed 模式（精神出局等「不看正面」）— 卡背 + 卡名隱藏 -->
                      <div class="sel-card-back"><div class="sel-card-back-icon">🎴</div><div class="sel-card-back-q">?</div></div>
                      <span class="sel-name">???</span>
                    {:else}
                      <img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name} loading="lazy"
                        class:legend-half-l={twoCardStadiumHalfIndex(selectionItems, item.iid, pool) === 0}
                        class:legend-half-r={twoCardStadiumHalfIndex(selectionItems, item.iid, pool) === 1}/><span class="sel-name">{c.name}</span>
                      {#if c.hp}<span class="sel-hp">HP{c.hp}</span>{/if}
                    {/if}
                    {#if isEnergyPicker && energyOwnerMap.has(item.iid)}
                      {@const owner = energyOwnerMap.get(item.iid)!}
                      <!-- v3.828: 點 📍 標籤放大來源寶可夢 — 用 div + role=button 避免 button-in-button nesting -->
                      <!-- v4.01: prefix [戰鬥場]/[備戰] 讓玩家明確知道來源位置 -->
                      <div class="sel-energy-source" role="button" tabindex="0"
                        title="點擊放大來源寶可夢：[{owner.isActive ? '戰鬥場' : '備戰'}] {owner.name}"
                        onclick={(e) => {e.stopPropagation(); openZoom(owner.inst.cardId, owner.inst);}}
                        onkeydown={(e) => {if (e.key==='Enter' || e.key===' ') {e.preventDefault(); e.stopPropagation(); openZoom(owner.inst.cardId, owner.inst);}}}>
                        📍 <span class="sel-source-slot" class:sel-source-active={owner.isActive}>{owner.isActive ? '⚔️ 戰鬥場' : '備戰'}</span> {owner.name} 🔍
                      </div>
                    {/if}
                    {#if selectionPicked.has(item.iid)}<span class="sel-check">✓</span>{/if}
                  </button>
                </div>
              {/if}
            {/each}
            <!-- v5.208：加 type gate 避免在 modal-choice（如道具拆除器）誤顯示「沒有符合條件」-->
            {#if selectionItems.length===0 && pendingSelection.type !== 'modal-choice'}<p class="sel-empty">（沒有符合條件的卡牌）</p>{/if}
          </div>
        {/if}

        <!-- 查看全牌庫（用於推斷獎賞卡） — 僅在「搜尋全牌庫」類型顯示；peek-top-X 機制不該能看剩餘牌 -->
        {#if pendingSelection.type==='deck-search' && game
          && !(pendingSelection.filter?.startsWith('TOP') || pendingSelection.filter?.includes(':TOP'))}
          {@const srcP = game.players[pendingSelection.sourcePlayerIdx]}
          {@const deckGrouped = (() => {
            // v2.43：保留 cardId 讓每組旁邊的放大鏡可呼叫 openZoom（與枇琶下拉一致）
            const map = new Map<string, { name: string; count: number; cardId: string; half?: 0 | 1 | null }>();
            for (const c of srcP.deck) {
              const card = pool.get(c.cardId);
              const name = card?.name ?? c.cardId;
              // v6.095「傳說」兩張合一競技場不聚合 —— 比照棄牌區，左右半各自一格個別顯示。
              //   Map key 改用 iid 才不會和同一半的其他張互相覆蓋。
              if (isTwoCardStadiumName(card?.name)) {
                map.set(c.iid, { name, count: 1, cardId: c.cardId, half: twoCardStadiumHalfIndex(srcP.deck, c.iid, pool) });
                continue;
              }
              const entry = map.get(c.cardId);
              if (entry) entry.count++;
              else map.set(c.cardId, { name, count: 1, cardId: c.cardId });
            }
            // v5.322: 同棄牌區排序 — 寶可夢→物品→支援者→場地→能量, 同類內 count desc 再 name
            return [...map.values()].sort((a,b)=>{
              const ra = cardTypeRank(pool.get(a.cardId)), rb = cardTypeRank(pool.get(b.cardId));
              if (ra !== rb) return ra - rb;
              return b.count - a.count || a.name.localeCompare(b.name);
            });
          })()}
          <details class="full-deck-view" open={selectionItems.length === 0}>
            <summary>📖 查看牌庫剩餘全部（{srcP.deck.length} 張，推斷獎賞卡）</summary>
            <div class="full-deck-note">※ 對照你的原牌組，不在清單中的 6 張通常是獎賞卡（或已在手牌/場上/棄牌）</div>
            <div class="full-deck-list">
              {#each deckGrouped as entry}{@const _dc=getCard(entry.cardId)}
                <button class="deck-cell" title="{entry.half === 0 || entry.half === 1 ? entry.name : entry.count + '× ' + entry.name} — 點擊放大"
                  onclick={(e)=>{e.stopPropagation();openZoom(entry.cardId);}}>
                  {#if _dc?.imageUrl}<img use:retryImg={_dc.imageUrl} src={_dc.imageUrl} alt={entry.name} class="deck-cell-img" loading="lazy"
                    class:legend-half-l={entry.half === 0} class:legend-half-r={entry.half === 1}/>
                  {:else}<div class="deck-cell-fallback">{entry.name}</div>{/if}
                  <!-- v6.095：兩張合一競技場已拆成一格一張，×1 徽章會誤讀成聚合 -->
                  {#if entry.half !== 0 && entry.half !== 1}<span class="deck-cell-count">×{entry.count}</span>{/if}
                </button>
              {/each}
            </div>
          </details>
        {/if}

        <!-- peek-top-N 的「非目標類」剩餘卡 — 例：米立龍「集客」(Supporter:TOP6) 顯示非支援者 3 張
             玩家看過但本次無法挑選；洗回牌庫會重新洗牌，不外洩其他位置資訊。
             篩選條件：filter 形如 "Supporter:TOP6" / "Pokemon:TOP_N" / 其他 "X:TOPN" — 純 TOP6 / TOP8 不進此分支。
             v5.077：regex 補 :TOP_N 後綴（通用 TOP_N filter）+ peekIids fallback 補 topIids — 讓
                     杜若 / 拉普拉斯ex|海紋石之雨 / 米立龍ex|硃砂誘餌 / 人造細胞卵|傳喚之門
                     等用 Pokemon/Energy/Trainer:TOP_N filter 的招式也能揭示翻到的其他類卡。 -->
        {#if pendingSelection.type==='deck-search' && game && /:TOP(\d+|_N)$/.test(pendingSelection.filter ?? '')}
          {@const srcP2 = game.players[pendingSelection.sourcePlayerIdx]}
          {@const peekIids = new Set<string>(
            (pendingSelection.params?.top4Iids as string[] | undefined)
            ?? (pendingSelection.params?.top6Iids as string[] | undefined)
            ?? (pendingSelection.params?.top7Iids as string[] | undefined)
            ?? (pendingSelection.params?.top8Iids as string[] | undefined)
            ?? (pendingSelection.params?.top9Iids as string[] | undefined)
            ?? (pendingSelection.params?.topIids as string[] | undefined)
            ?? []
          )}
          {@const pickableIids = new Set(selectionItems.map(c => c.iid))}
          {@const peekedOthers = srcP2.deck.filter(c => peekIids.has(c.iid) && !pickableIids.has(c.iid))
            .slice().sort((a,b) => {
              const ca = pool.get(a.cardId), cb = pool.get(b.cardId);
              const ra = cardTypeRank(ca), rb = cardTypeRank(cb);
              if (ra !== rb) return ra - rb;
              return (ca?.name ?? '').localeCompare(cb?.name ?? '');
            })}
          {@const remainingDeck = srcP2.deck.length - peekIids.size}
          {#if peekedOthers.length > 0}
            <details class="full-deck-view">
              <summary>🔍 查看翻到的其他 {peekedOthers.length} 張（本次不可選，僅供參考）· 牌庫剩餘 {remainingDeck} 張</summary>
              <div class="full-deck-note">※ 這些卡你已看過但本次不符合挑選條件；結束後會洗回牌庫重新洗牌（位置不會外洩）</div>
              <div class="full-deck-list">
                {#each peekedOthers as inst}{@const c=getCard(inst.cardId)}
                  {#if c}
                    <button class="deck-cell" title="{c.name} — 點擊放大"
                      onclick={(e)=>{e.stopPropagation();openZoom(inst.cardId, inst);}}>
                      {#if c.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name} class="deck-cell-img" loading="lazy"
                        class:legend-half-l={twoCardStadiumHalfIndex(peekedOthers, inst.iid, pool) === 0}
                        class:legend-half-r={twoCardStadiumHalfIndex(peekedOthers, inst.iid, pool) === 1}/>
                      {:else}<div class="deck-cell-fallback">{c.name}</div>{/if}
                    </button>
                  {/if}
                {/each}
              </div>
            </details>
          {/if}
        {/if}

        <!-- v2.38 枇琶：對手手牌 hand-discard（sourcePlayerIdx != actorIdx）— 揭露「非可選」其餘手牌 -->
        <!-- v3.9998：concealed 模式（精神出局）不揭露其餘手牌 -->
        {#if (pendingSelection.type==='hand-discard' || pendingSelection.type==='hand-choose') && game
          && pendingSelection.sourcePlayerIdx !== pendingSelection.actorIdx
          && pendingSelection.params?.concealed !== true}
          {@const srcHand = game.players[pendingSelection.sourcePlayerIdx].hand}
          {@const pickableIidsHD = new Set(selectionItems.map(c => c.iid))}
          {@const otherHand = srcHand.filter(c => !pickableIidsHD.has(c.iid))
            .slice().sort((a,b) => {
              const ca = pool.get(a.cardId), cb = pool.get(b.cardId);
              const ra = cardTypeRank(ca), rb = cardTypeRank(cb);
              if (ra !== rb) return ra - rb;
              return (ca?.name ?? '').localeCompare(cb?.name ?? '');
            })}
          {#if otherHand.length > 0}
            <details class="full-deck-view">
              <summary>🔍 對手手牌其餘 {otherHand.length} 張（本次不可選，僅供查看）</summary>
              <div class="full-deck-note">{pendingSelection.type==='hand-choose' ? '※ 相仿秀查看對手手牌後只能選 1 張「支援者」卡複製其效果；其餘手牌僅揭露供查看，不可選' : '※ 枇琶效果只能丟棄物品卡；其餘手牌（寶可夢 / 支援者 / 能量 / 道具 / 場地）僅揭露，不可選'}</div>
              <div class="full-deck-list">
                {#each otherHand as inst}{@const c=getCard(inst.cardId)}
                  {#if c}
                    <button class="deck-cell" title="{c.name} — 點擊放大"
                      onclick={(e)=>{e.stopPropagation();openZoom(inst.cardId, inst);}}>
                      {#if c.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name} class="deck-cell-img" loading="lazy"
                        class:legend-half-l={twoCardStadiumHalfIndex(otherHand, inst.iid, pool) === 0}
                        class:legend-half-r={twoCardStadiumHalfIndex(otherHand, inst.iid, pool) === 1}/>
                      {:else}<div class="deck-cell-fallback">{c.name}</div>{/if}
                    </button>
                  {/if}
                {/each}
              </div>
            </details>
          {/if}
        {/if}

        <!-- v2.164 reorder-deck-top：排序牌庫頂 N 張（推理組合 / 蕾荷） -->
        {#if pendingSelection.type === 'reorder-deck-top' && game}
          {@const allowDiscard = (pendingSelection.params?.allowDiscard as boolean | undefined) ?? false}
          {@const candidateIids = (pendingSelection.params?.candidateIids as string[] | undefined) ?? []}
          {@const ownerDeck = game.players[pendingSelection.sourcePlayerIdx].deck}  <!-- v5.903：排序對象牌庫依 sourcePlayerIdx(支援排對手牌庫:天眼/攪亂雷達) -->
          {@const candById = new Map(ownerDeck.filter(c => candidateIids.includes(c.iid)).map(c => [c.iid, c] as const))}
          <div class="reorder-deck-wrap">
            <div class="reorder-section">
              <div class="reorder-section-title">📥 保留並排序（牌庫頂 → 底）</div>
              <div class="reorder-list">
                {#each selectionReorderKeep as iid, i (iid)}{@const inst = candById.get(iid)}{@const c = inst ? getCard(inst.cardId) : null}
                  {#if c && inst}
                    <div class="reorder-item">
                      <span class="reorder-pos">#{i + 1}</span>
                      <span class="reorder-name" title={c.name}>{c.name}</span>
                      <button class="reorder-btn" disabled={i === 0} onclick={() => reorderMoveUp(iid)} title="上移（更接近牌庫頂）">↑</button>
                      <button class="reorder-btn" disabled={i === selectionReorderKeep.length - 1} onclick={() => reorderMoveDown(iid)} title="下移（更接近牌庫底）">↓</button>
                      <button class="reorder-btn" onclick={(e) => {e.stopPropagation(); openZoom(inst.cardId, inst);}} title="放大查看">🔍</button>
                      {#if allowDiscard}
                        <button class="reorder-btn reorder-btn-discard" onclick={() => reorderToDiscard(iid)} title="丟棄這張">🗑</button>
                      {/if}
                    </div>
                  {/if}
                {/each}
                {#if selectionReorderKeep.length === 0}
                  <div class="reorder-empty">（沒有保留任何卡）</div>
                {/if}
              </div>
            </div>
            {#if allowDiscard && selectionReorderDiscard.size > 0}
              <div class="reorder-section">
                <div class="reorder-section-title">🗑 丟棄</div>
                <div class="reorder-list">
                  {#each [...selectionReorderDiscard] as iid (iid)}{@const inst = candById.get(iid)}{@const c = inst ? getCard(inst.cardId) : null}
                    {#if c && inst}
                      <div class="reorder-item reorder-item-discard">
                        <span class="reorder-name" title={c.name}>{c.name}</span>
                        <button class="reorder-btn" onclick={(e) => {e.stopPropagation(); openZoom(inst.cardId, inst);}} title="放大查看">🔍</button>
                        <button class="reorder-btn" onclick={() => reorderToKeep(iid)} title="放回保留列表">↩</button>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- v2.139 modal-choice：兩/多選一文字選單（烏栗 等）
             v2.201：擴展支援 stepper UI（params.stepper = {min, max, step, init}） — 泰姆猜 HP 用
             stepper 與 options 互斥；options 為主、有 stepper 時切換到數字 +/- 模式 -->
        {#if pendingSelection.type === 'modal-choice'}
          {@const stepper = pendingSelection.params?.stepper as { min: number; max: number; step: number; init: number } | undefined}
          {#if stepper}
            <div class="modal-choice-stepper">
              <button class="stepper-btn stepper-minus"
                disabled={selectionStepperValue <= stepper.min}
                onclick={() => { selectionStepperValue = Math.max(stepper.min, selectionStepperValue - stepper.step); }}
                title="減 {stepper.step}">−</button>
              <div class="stepper-value">{selectionStepperValue}</div>
              <button class="stepper-btn stepper-plus"
                disabled={selectionStepperValue >= stepper.max}
                onclick={() => { selectionStepperValue = Math.min(stepper.max, selectionStepperValue + stepper.step); }}
                title="加 {stepper.step}">+</button>
              <button class="btn-act primary stepper-confirm" disabled={actionBusy}
                onclick={() => confirmSelection()}>✓ 確認</button>
            </div>
            <p class="sel-hint stepper-hint">範圍 {stepper.min}–{stepper.max} · 每次 ±{stepper.step}</p>
          {:else}
            {@const opts = (pendingSelection.params?.options as Array<{id:string;text:string;disabled?:boolean;inspectIid?:string;inspectPlayerIdx?:0|1}>) ?? []}
            {@const coinFlips = (pendingSelection.params?.coinFlips as string[] | undefined) ?? []}
            {@const retryAttackName = (pendingSelection.params?.attackName as string | undefined) ?? '本次招式'}
            <!-- v5.263: 機關槍合擊類「擲幣直到反面為止」才顯示「停止」標籤 -->
            {@const isUntilTailsAttack = retryAttackName === '機關槍合擊' || retryAttackName === '滾球' || retryAttackName === '連續舞步' || retryAttackName === '奔進' || retryAttackName === '螺旋衝刺' || retryAttackName === '連續火焰'}
            <!-- v5.263 重試徽章 modal — 顯示本次擲幣明細 -->
            {#if coinFlips.length > 0}
              <div class="modal-coin-flips">
                <div class="modal-coin-flips-title">🎲 本次擲幣結果 [{retryAttackName}]（共 {coinFlips.length} 次）</div>
                <ul class="modal-coin-flips-list">
                  {#each coinFlips as flip, idx}
                    <li>
                      第 <strong>{idx + 1}</strong> 次 →
                      <strong class:heads={flip === '正面'} class:tails={flip !== '正面'}>{flip}</strong>
                      {#if isUntilTailsAttack && flip !== '正面' && idx === coinFlips.length - 1}<span class="stop-tag">（停止）</span>{/if}
                    </li>
                  {/each}
                </ul>
                <div class="modal-coin-flips-note">
                  ※ 本次招式：「{retryAttackName}」的擲幣結果如上。重試徽章可選擇保留或重擲；保留則套用此結果，重擲則本回合不可再用徽章。
                </div>
              </div>
            {/if}
            <div class="modal-choice-list">
              {#each opts as opt}
                <!-- v5.191：道具拆除器等需要查看寶可夢的場景，若 opt 有 inspectIid 則旁邊渲染放大鏡按鈕 -->
                {#if opt.inspectIid !== undefined && opt.inspectPlayerIdx !== undefined && game}
                  {@const _ip = game.players[opt.inspectPlayerIdx]}
                  {@const _inst = _ip.active?.iid === opt.inspectIid ? _ip.active : _ip.bench.find(b => b.iid === opt.inspectIid)}
                  <div class="modal-choice-row">
                    <button class="btn-act modal-choice-btn modal-choice-btn-flex"
                      disabled={actionBusy||!!opt.disabled}
                      onclick={() => {
                        // v5.208：modal-choice 直接 dispatch payload，避開 confirmSelection 內 selectionValid 早退
                        //   (Svelte 5 state replace 與 derived 同步順序不可靠，single-click flow 易踩)
                        const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
                        dispatch(GameActions.resolveSelection([opt.id], sid, _pendingTok()));
                        selectionPicked = new Set();
                        selectionCounts = {};
                      }}>
                      {opt.text}
                    </button>
                    <button class="btn-act modal-choice-inspect"
                      title="查看寶可夢詳情"
                      disabled={!_inst}
                      onclick={() => { if (_inst) openZoom(_inst.cardId, _inst); }}>
                      🔍
                    </button>
                  </div>
                {:else}
                  <button class="btn-act modal-choice-btn"
                    disabled={actionBusy||!!opt.disabled}
                    onclick={() => {
                      // v5.208：modal-choice 直接 dispatch (同上)
                      const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
                      dispatch(GameActions.resolveSelection([opt.id], sid, _pendingTok()));
                      selectionPicked = new Set();
                      selectionCounts = {};
                    }}>
                    {opt.text}
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        {/if}

        <div class="sel-footer">
          {#if akamatsuSameTypeBlocked}
            <div class="sel-hint-warn">⚠ 赤松選 2 張能量時，兩張屬性必須不同</div>
          {/if}
          {#if pendingSelection.type === 'modal-choice'}
            <!-- modal-choice 直接點按鈕 resolve，不需要確認/跳過 footer -->
          {:else if isDmgDist}
            <button class="btn-act primary" disabled={actionBusy||!selectionValid} onclick={confirmSelection}>
              確認本批次（{selectionBatchSum}／{pendingSelection.maxCount} 個指示物）
            </button>
            {#if selectionBatchSum > 0}
              <button class="btn-act secondary" onclick={()=>{selectionCounts={};}}>清空本批次</button>
            {/if}
            <!-- ⭐ v6.174：分配型也要有逃生口。候選為空時「確認本批次」因 selectionValid 永遠 disabled，
                 而 selectionAllowsSkip 又被 minCount>=1 短路 ⇒ 玩家一顆能按的按鈕都沒有＝真卡死。 -->
            {#if pendingStuckEmpty}
              <button class="btn-act secondary" onclick={abandonSelection}
                title="沒有可分配的目標 — 放棄此效果以繼續">
                放棄（無可分配目標）
              </button>
            {/if}
          {:else if isEnergyDist}
            <!-- v5.384：energy-distribute 用 selectionCounts/selectionBatchSum 計數；
                 原本沒有專屬 footer → 落到下方預設分支顯示 selectionPicked.size 永遠 0
                 （金屬製造者等「分配附能量」picker 的「(0)確定」bug）。 -->
            <button class="btn-act primary" disabled={actionBusy||!selectionValid} onclick={confirmSelection}>
              確認分配（{selectionBatchSum}／{pendingSelection.maxCount} 個能量）
            </button>
            {#if selectionBatchSum > 0}
              <button class="btn-act secondary" onclick={()=>{selectionCounts={};}}>清空</button>
            {/if}
            <!-- ⭐ v6.174：同上，分配能量的畫面也要有逃生口（候選為空時原本完全按不動）。 -->
            {#if pendingStuckEmpty}
              <button class="btn-act secondary" onclick={abandonSelection}
                title="沒有可分配的目標 — 放棄此效果以繼續">
                放棄（無可分配目標）
              </button>
            {/if}
          {:else if pendingSelection.type === 'reorder-deck-top'}
            <!-- v5.384：reorder-deck-top 用 selectionReorderKeep，同樣不能用 selectionPicked.size -->
            <button class="btn-act primary" disabled={actionBusy||!selectionValid} onclick={confirmSelection}>確定（保留 {selectionReorderKeep.length} 張）</button>
            <!-- ⭐ v6.123 次要動作：推理組合卡面的「或者：翻回反面重洗，放回牌庫下方」。
                 只有帶 params.altAction 的 pending 才渲染 ⇒ 蕾荷／天眼／攪亂雷達不受影響。 -->
            {#if pendingSelection.params?.altAction}
              <button class="btn-act secondary" onclick={confirmSelectionAlt}
                title="卡面的另一個選項：不排序，把這幾張翻回反面重洗後放到牌庫最下方">
                {pendingSelection.params.altAction.label ?? '重洗放回牌庫下方'}
              </button>
            {/if}
          {:else}
            <!-- v6.108：確認鈕直接寫出要拿／要處理的是哪幾張，讓誤選在按下去之前就看得見 -->
            <button class="btn-act primary" disabled={actionBusy||!selectionValid} onclick={confirmSelection}>{selectedNamesLabel ? '確定 ' + selectedNamesLabel : '確定（' + selectionPicked.size + '張）'}</button>
            {#if selectionAllowsSkip({ type: pendingSelection.type, actorIdx: pendingSelection.actorIdx, sourcePlayerIdx: pendingSelection.sourcePlayerIdx, effectKey: pendingSelection.effectKey, minCount: pendingSelection.minCount, allowSkipZero: pendingSelection.params?.allowSkipZero === true })}
              <button class="btn-act secondary" disabled={actionBusy} onclick={abandonSelection}>{pendingSelection.effectKey === 'attach-tool' ? '取消（道具退回手牌）' : pendingSelection.effectKey === 'sakura-crescendo-attach' ? '不附能量（直接造成傷害）' : '不選（跳過）'}</button>
            {:else if selectionAllowsCancel({ effectKey: pendingSelection.effectKey, allowCancel: pendingSelection.params?.allowCancel === true })}
              <!-- ⭐ v6.175 站長裁定：寶可夢道具可以反悔。這顆鈕過去被 minCount>=1 短路吃掉，
                   resolver 早就寫好的「道具退回手牌」分支因此是永遠走不到的死碼。
                   ⚠ 這不是「選 0 張」，是取消整個動作 → 走 selectionAllowsCancel 而非 selectionAllowsSkip。 -->
              <button class="btn-act secondary" disabled={actionBusy} onclick={abandonSelection}
                title="取消這次附加，道具原封退回手牌">取消（道具退回手牌）</button>
            {/if}
            <!-- v2.121 全域安全網：候選為空且 minCount>0 時開放「放棄」避免卡住 -->
            {#if pendingStuckEmpty}
              <button class="btn-act secondary" onclick={abandonSelection}
                title="沒有符合條件的卡可選 — 放棄此效果以繼續">
                放棄（無符合卡）
              </button>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Floating Evolution Menu -->
  {#if floatingEvoMenu}
    <div class="float-evo-backdrop" onclick={() => floatingEvoMenu = null}></div>
    <div class="float-evo-menu" style="left:{floatingEvoMenu.x}px;top:{floatingEvoMenu.y}px;">
      <div class="float-evo-title">選擇進化</div>
      {#each floatingEvoMenu.evoOpts as evo}{@const ec=getCard(evo.cardId)}
        <button class="evo-choice wide-evo" disabled={actionBusy} onclick={(e)=>{e.stopPropagation();dispatch(GameActions.evolve(floatingEvoMenu!.fromIid,evo.iid));floatingEvoMenu=null;}}>
          <img use:retryImg={ec?.imageUrl} src={ec?.imageUrl} alt={ec?.name}/><span>{ec?.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Hand Hover Preview（獨立浮層，不改原卡位置） -->
  {#if hoverHandIid && hoverHandAnchor && !dragging}
    {@const inst = myPlayer?.hand.find(h => h.iid === hoverHandIid)}
    {#if inst}
      {@const pc = getCard(inst.cardId)}
      {#if pc}
        <div class="hand-preview-float"
          style="left:{hoverHandAnchor.x}px; top:{hoverHandAnchor.y - 8}px;"
          in:fade={{ duration: 120 }} aria-hidden="true">
          <img use:retryImg={pc.imageUrl} src={pc.imageUrl} alt={pc.name}/>
        </div>
      {/if}
    {/if}
  {/if}

  <!-- v5.026 桌墊版：附加卡 hover 放大預覽（attached energy/tool/evo 都用同個浮層）
       v5.027：頂部卡 hoverAttBelow=true 時預覽改顯示在卡下方 -->
  {#if hoverAttCardId && hoverAttAnchor && !dragging && battleLayout !== 'classic'}
    {@const ac = getCard(hoverAttCardId)}
    {#if ac}
      <div class="hand-preview-float att-preview-float" class:att-preview-below={hoverAttBelow}
        style="left:{hoverAttAnchor.x}px; top:{hoverAttAnchor.y - (hoverAttBelow ? 0 : 8)}px;"
        in:fade={{ duration: 120 }} aria-hidden="true">
        <img use:retryImg={ac.imageUrl} src={ac.imageUrl} alt={ac.name}/>
      </div>
    {/if}
  {/if}

  <!-- Damage / Heal Popups -->
  {#each damagePops as pop (pop.id)}
    <div class="dmg-pop" class:heal={pop.heal}
      style="left:{pop.x}px;top:{pop.y}px;"
      in:fly={{ y: 0, duration: 0 }}
      out:fade={{ duration: 300 }}>
      {pop.heal ? '+' : '−'}{pop.amount}
    </div>
  {/each}

  <!-- Coin Flip Overlay -->
  {#if coinFlip}
    <div class="coin-overlay" in:fade={{ duration: 200 }} out:fade={{ duration: 250 }}>
      <div class="coin-stage">
        {#key coinFlip.id}
          <!-- key = 每次擲幣唯一 id，確保連續同結果（例如連 3 正面）也會重建 DOM、重播 CSS 動畫與文字 -->
          <div class="coin coin-{coinFlip.result}">
            <div class="coin-face coin-heads">🪙</div>
            <div class="coin-face coin-tails">⚫</div>
          </div>
          <!-- delay 600ms：讓文字在硬幣翻面後立即出現，並在 1400ms 換下一次前保持可見 -->
          <div class="coin-label" in:fly={{ y: 20, duration: 300, delay: 600 }}>{coinFlip.label}</div>
        {/key}
      </div>
    </div>
  {/if}

  <!-- Floating Drag Preview -->
  {#if dragging && dragging.moved}
    <div class="drag-preview" style="left:{dragging.x / gameZoom}px;top:{dragging.y / gameZoom}px;" aria-hidden="true">
      <img use:retryImg={dragging.imageUrl} src={dragging.imageUrl} alt=""/>
      <!-- ⚠ 這裡的 dragging.kind 只是**拖曳中的文字標籤**（外觀），它本身由中央
           handCardDragKind(ops) 產生。可用性、釋放區判斷一律不准用 kind —— 用
           dragOpFor()/handOpForDropTarget()。守衛 test-v6200 只放行這個 drag-preview 區塊。 -->
      <div class="drag-hint">
        {#if dragging.kind==='energy'}⚡ 拖到寶可夢附加
        {:else if dragging.kind==='basic'}📥 拖到備戰空格
        {:else if dragging.kind==='tool'}🔧 拖到寶可夢附加
        {:else if dragging.kind==='hand-ability'}⚡ 拖到備戰空格發動特性
        {/if}
      </div>
    </div>
  {/if}

  <!-- v3.74 Mulligan 揭示：對手起手無基礎重抽時，揭示每次重抽的 7 張手牌給玩家確認（PTCG 官方規則）
       v5.133：加 setupDone[myIdx] gate — 依 PTCG 規則 (PDF Q173)，
       自己先放戰鬥場 + bench + 按準備（setupDone=true），才看對手 mulligan 揭示。
       原 v3.74 玩家一進 setup 就 popup mulligan reveal modal，強制看完才能放
       戰鬥場 — 順序違反 PTCG 規則「先放基礎到戰鬥場」。 -->
  <!-- v6.051 批2 互動式開局（閃焰王牌｜瞬間爆發力）：起手沒有【基礎】寶可夢、但有可用
       「瞬間爆發力」上場的寶可夢時，由玩家二選一。
       官方 PTCG RULES §17.40.G：「（起手）僅有擁有特性『瞬間爆發力』的閃焰王牌，那麼可以
       不將閃焰王牌放置於戰鬥場上嗎？→ 可以。／這個情況下，可選擇是否將閃焰王牌放置於戰鬥場上。」
       ＝引擎不可以替玩家決定；這個選擇會改變雙方的重抽次數與對手可多抽的張數。 -->
  {#if game && game.phase==='setup' && game.openingChoicePending?.[myIdx] && (
        (mode==='online' && myPlayerIndex===myIdx) ||
        (mode!=='online' && aiPlayerIndex === null) ||
        (aiPlayerIndex !== null && aiPlayerIndex !== myIdx)
      )}
    {@const burstNames = [...new Set((myPlayer?.hand ?? [])
        .filter(c => canBeInitialActiveCard(pool.get(c.cardId)))
        .map(c => pool.get(c.cardId)?.name ?? '?'))]}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal mulligan-modal mulligan-reveal-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>🔥 起手沒有【基礎】寶可夢</h3>
          <p class="sel-hint">
            你的起手沒有【基礎】寶可夢，但有 <strong>{burstNames.join('、')}</strong>，
            可用特性「瞬間爆發力」反面朝上放置於戰鬥場開局。
            <br/>依官方規則，你<strong>也可以</strong>視同沒有【基礎】寶可夢而重抽手牌
            —— 此時需先向對手展示這 7 張牌，你的重抽次數 +1（對手可因此多抽牌）。
          </p>
        </div>
        <div class="mulligan-reveal-body">
          <div class="mulligan-reveal-grid">
            {#each (myPlayer?.hand ?? []) as hc (hc.iid)}
              {@const hcc = pool.get(hc.cardId)}
              <div class="mulligan-reveal-card" class:opening-burst={canBeInitialActiveCard(hcc)}>
                {#if hcc?.imageUrl}
                  <img use:retryImg={hcc.imageUrl} src={hcc.imageUrl} alt={hcc.name} onclick={() => openZoom(hc.cardId, null)} class="zoomable"
                    class:legend-half-l={twoCardStadiumHalfIndex(myPlayer?.hand, hc.iid, pool) === 0}
                    class:legend-half-r={twoCardStadiumHalfIndex(myPlayer?.hand, hc.iid, pool) === 1} />
                {:else}
                  <div class="card-placeholder">{hcc?.name ?? hc.cardId}</div>
                {/if}
                <div class="card-name-label">{hcc?.name ?? '?'}</div>
              </div>
            {/each}
          </div>
        </div>
        <div class="sel-footer mulligan-footer">
          <button class="btn-act" disabled={actionBusy} onclick={() => dispatch(GameActions.openingMulligan(myIdx))}>
            🔄 視同沒有基礎，重抽手牌
          </button>
          <button class="btn-act primary" disabled={actionBusy} onclick={() => dispatch(GameActions.openingKeep(myIdx))}>
            ✅ 用牠開局
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if game && game.phase==='setup'
       && game.setupDone?.[myIdx]
       && (((oppIdx === 0 ? game.mulliganRevealedHands?.p1 : game.mulliganRevealedHands?.p2)?.length ?? 0) > 0)
       && !game.mulliganRevealConfirmed?.[myIdx]
       && (
            (mode==='online' && myPlayerIndex===myIdx) ||
            (mode!=='online' && aiPlayerIndex === null) ||
            (aiPlayerIndex !== null && aiPlayerIndex !== myIdx)
          )}
    {@const oppHandsRaw = (oppIdx === 0 ? game.mulliganRevealedHands?.p1 : game.mulliganRevealedHands?.p2) ?? []}
    {@const oppHands = oppHandsRaw.map(s => s.split('|'))}
    {@const totalPages = oppHands.length}
    {@const pageIdx = Math.min(Math.max(revealPage, 0), totalPages - 1)}
    {@const curHand = oppHands[pageIdx] ?? []}
    {@const oppName2 = game.players[oppIdx].name}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal mulligan-modal mulligan-reveal-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>👀 對手起手揭示</h3>
          <p class="sel-hint">
            <strong>{oppName2}</strong> 起手無基礎寶可夢，重抽 {totalPages} 次。依 PTCG 官方規則，每次重抽前的 7 張手牌需向你揭示確認。
          </p>
        </div>
        <div class="mulligan-reveal-body">
          <!-- 翻頁工具列 -->
          <div class="mulligan-reveal-pager">
            <button class="btn-act small"
              disabled={pageIdx <= 0}
              onclick={() => revealPage = Math.max(0, pageIdx - 1)}>← 上一手</button>
            <span class="page-indicator">第 {pageIdx + 1} 次重抽 / 共 {totalPages} 次</span>
            <button class="btn-act small"
              disabled={pageIdx >= totalPages - 1}
              onclick={() => revealPage = Math.min(totalPages - 1, pageIdx + 1)}>下一手 →</button>
          </div>
          <!-- 7 張卡 grid -->
          <div class="mulligan-reveal-grid">
            {#each curHand as cid, ci (pageIdx + '_' + ci)}
              {@const cc = pool.get(cid)}
              <div class="mulligan-reveal-card">
                {#if cc?.imageUrl}
                  <img use:retryImg={cc.imageUrl} src={cc.imageUrl} alt={cc.name} onclick={() => openZoom(cid, null)} class="zoomable"
                    class:legend-half-l={twoCardStadiumSide(cid) === 0}
                    class:legend-half-r={twoCardStadiumSide(cid) === 1} />
                {:else}
                  <div class="card-placeholder">{cc?.name ?? cid}</div>
                {/if}
                <div class="card-name-label">{cc?.name ?? '?'}</div>
              </div>
            {/each}
          </div>
        </div>
        <div class="sel-footer mulligan-footer">
          <span class="sel-hint" style="flex:1; font-size:.8rem;">
            {#if pageIdx < totalPages - 1}
              （請看完所有重抽手牌再按確認）
            {:else}
              ✅ 已看完全部重抽手牌
            {/if}
          </span>
          <button class="btn-act primary"
            onclick={() => {
              dispatch(GameActions.confirmMulliganReveal(myIdx));
              revealPage = 0;
            }}>
            ✅ 我看完了，繼續
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- v4.923 重抽懲罰補抽決定：+/- 計數器 UI（0 ~ nDraw 張，預設最大值） -->
  {#if game && game.phase==='setup' && (game.pendingMulliganDraw?.[myIdx] ?? 0) > 0 && (game.mulliganRevealConfirmed?.[myIdx] ?? true) && (
      (mode==='online' && myPlayerIndex===myIdx) ||
      (mode!=='online' && aiPlayerIndex === null) ||
      (aiPlayerIndex !== null && aiPlayerIndex !== myIdx)
    )}
    {@const nDraw = game.pendingMulliganDraw[myIdx]}
    {@const pickCount = mulliganPickOverride === null ? nDraw : Math.min(Math.max(0, mulliganPickOverride), nDraw)}
    {@const oppName = game.players[oppIdx].name}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal mulligan-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>🔄 對手的重抽懲罰</h3>
          <p class="sel-hint">
            <strong>{oppName}</strong> 起手沒有基礎寶可夢，重新洗牌 {nDraw} 次。
            <br/>作為補償，你可選擇多抽 <strong>0 ~ {nDraw}</strong> 張牌（預設為最大值）。
          </p>
        </div>
        <div class="mulligan-body">
          <div class="mulligan-info">
            <div>📦 牌組剩餘：{myPlayer?.deck.length ?? 0} 張</div>
            <div>🖐 目前手牌：{myPlayer?.hand.length ?? 0} 張</div>
            <div>👉 確認後手牌變為：{(myPlayer?.hand.length ?? 0) + pickCount} 張</div>
          </div>
          <div class="mulligan-stepper">
            <button class="btn-ghost stepper-btn"
              disabled={pickCount <= 0}
              onclick={() => { mulliganPickOverride = Math.max(0, pickCount - 1); }}>−</button>
            <div class="stepper-value">{pickCount}</div>
            <button class="btn-ghost stepper-btn"
              disabled={pickCount >= nDraw}
              onclick={() => { mulliganPickOverride = Math.min(nDraw, pickCount + 1); }}>＋</button>
          </div>
        </div>
        <div class="sel-footer mulligan-footer">
          <button class="btn-act primary"
            onclick={() => { dispatch(GameActions.mulliganDrawDecision(pickCount, myIdx)); mulliganPickOverride = null; }}>
            ✅ 確認補抽 {pickCount} 張
          </button>
        </div>
      </div>
    </div>
  {:else if game && game.phase==='setup' && (game.pendingMulliganDraw?.[oppIdx] ?? 0) > 0 && mode==='online' && myPlayerIndex===myIdx && setupActorSeat(game) === oppIdx}
    <!-- 對手還沒決定重抽補抽 — 僅在線上模式需顯示等待
         ⭐⭐v6.158 `setupActorSeat(game) === oppIdx` 不是贅字：`pendingMulliganDraw[對手]`
         在【建局當下】就已經 &gt; 0（makeGame 就算好了），而這是一層
         `position:fixed; inset:0` 的全螢幕遮罩。舊條件下，重抽過的那一方整個開局都被蓋住；
         等對手一按【準備完成】，規則上就輪到他放出場了（setupActorSeat 回他），
         盤面卻還是被這層遮罩擋著—— 他什麼都按不到，而伺服器正在倒數判他閒置敗。 -->
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal mulligan-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>⏳ 等待對手</h3>
          <!-- v6.158 文案改成【對手現在真的卡在哪一步】：舊文案一律寫「正在決定是否多抽」，
               但對手那時候其實還在選出場寶可夢（揭示確認、補抽都要等他 setupDone 之後）。 -->
          <p class="sel-hint">起手無基礎寶可夢，已重抽 {game.mulliganCounts?.[myIdx] ?? 0} 次。{!game.setupDone?.[oppIdx] ? '對手正在選出場寶可夢並按準備…' : (!game.mulliganRevealConfirmed?.[oppIdx] ? '對手正在確認起手揭示…' : ('對手正在決定是否多抽 ' + game.pendingMulliganDraw[oppIdx] + ' 張…'))}</p>
        </div>
      </div>
    </div>
  {/if}

  <!-- v2.256 招式前置：0~max stepper overlay（波盪水|蜿蜒割裂 等「最多 N 個指示物」招式） -->
  {#if preAttackDiscard && game && preAttackDiscard.spec.scope === 'self-counter-stepper'}
    {@const spec = preAttackDiscard.spec}
    {@const minN = spec.min}
    {@const maxN = spec.max ?? 9}
    {@const currentN = preAttackDiscard.picked.size}
    {@const estDmg = spec.baseDamage + currentN * spec.damagePerEnergy}
    {@const estSelfDmg = currentN * (spec.selfDamagePerCounter ?? 0)}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>🔢 {preAttackDiscard.attackName}</h3>
          <p class="sel-hint">{spec.choicePrompt ?? `選擇放置幾個傷害指示物（${minN}~${maxN}）`}</p>
          <p class="sel-hint">
            預估傷害 <strong>{estDmg}</strong>
            {#if (spec.selfDamagePerCounter ?? 0) > 0}
              · 自身受 <strong>{estSelfDmg}</strong> 傷害
            {/if}
          </p>
        </div>
        <div class="sel-actions" style="justify-content:center;gap:16px;padding:24px;align-items:center">
          <button class="btn-ghost" style="padding:8px 18px;font-size:18px;font-weight:bold"
            disabled={currentN <= minN}
            onclick={() => {
              if (!preAttackDiscard) return;
              const picked = new Set(preAttackDiscard.picked);
              // 拿任一個 sentinel 出來
              const first = picked.values().next().value;
              if (first) picked.delete(first);
              preAttackDiscard = { ...preAttackDiscard, picked };
            }}>−</button>
          <div style="font-size:32px;font-weight:bold;min-width:64px;text-align:center">{currentN}</div>
          <button class="btn-ghost" style="padding:8px 18px;font-size:18px;font-weight:bold"
            disabled={currentN >= maxN}
            onclick={() => {
              if (!preAttackDiscard) return;
              const picked = new Set(preAttackDiscard.picked);
              picked.add(`stepper-${picked.size}`);
              preAttackDiscard = { ...preAttackDiscard, picked };
            }}>+</button>
          <button class="btn-primary" style="padding:12px 24px;font-size:16px;margin-left:24px"
            onclick={() => {
              if (!preAttackDiscard) return;
              const ai = preAttackDiscard.attackIndex;
              const iids = [...preAttackDiscard.picked];
              preAttackDiscard = null;
              dispatch(GameActions.attack(ai, iids));
            }}>確認（放 {currentN} 個）</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- v2.255 招式前置：yes/no 二選一 overlay（蚊香泳士|跳躍衝天 等「若希望」招式） -->
  {#if preAttackDiscard && game && preAttackDiscard.spec.scope === 'binary-yes-no'}
    {@const spec = preAttackDiscard.spec}
    {@const yesLabel = spec.choiceYesLabel ?? '是'}
    {@const noLabel = spec.choiceNoLabel ?? '否'}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>❓ {preAttackDiscard.attackName}</h3>
          <p class="sel-hint">{spec.choicePrompt ?? '是否觸發此選用效果？'}</p>
        </div>
        <div class="sel-actions" style="justify-content:center;gap:24px;padding:24px">
          <button class="btn-primary" style="padding:12px 32px;font-size:16px"
            onclick={() => {
              // sentinel iid 'yes-token' — engine 端 regPre 看 length>=1 = yes
              // v3.35：closure 內 ts narrowing 不會穿過外層 #if，需 null guard
              if (!preAttackDiscard) return;
              const ai = preAttackDiscard.attackIndex;
              const cc = preAttackDiscard.copyAttackChoice; // v5.720 borrowed(耀閃挑戰/高傲指令)時帶上,否則被借招式選擇丟失
              // v5.992 spec.optInPay 一般化二段流程（原 v4.46 金屬之錘 hardcode Stage 2 抽象化，
              //   金屬之錘/忍者飛旋/災難衝擊/時間爆炸/叢林鞭打/狂暴噴射共用）：
              //   - 0 可付 → OPTIN_NO_PAYMENT sentinel（Wilson 裁定：固定加傷/狀態照給全額）
              //   - 可付 ≤ N（或 N=null 全部）→ 自動全付
              //   - 可付 > N → 切換 picker（min=max=N 強制選恰 N）
              const op = spec.optInPay;
              if (op) {
                const stage2Spec: PreDiscardSpec = {
                  min: 0, max: op.payMax, scope: op.scope,
                  baseDamage: spec.baseDamage, damagePerEnergy: 0,
                  energyTypeFilter: op.energyTypeFilter, verb: op.verb, countMode: op.countMode,
                };
                const eligible = getDiscardableEnergies(stage2Spec);
                const totalAmount = op.countMode === 'units'
                  ? eligible.reduce((n, e) => n + getEnergyDiscardUnits(e.cardId, e.hostInst, pool, game, aIdx), 0)
                  : eligible.length;
                if (eligible.length === 0) {
                  preAttackDiscard = null;
                  dispatch(GameActions.attack(ai, [OPTIN_NO_PAYMENT], cc));
                } else if (op.payMax === null || totalAmount <= op.payMax) {
                  preAttackDiscard = null;
                  dispatch(GameActions.attack(ai, eligible.map(e => e.iid), cc));
                } else {
                  // 超過 N：切換到 picker spec（min=max=N 強制玩家選恰 N）
                  preAttackDiscard = {
                    attackIndex: ai,
                    spec: { ...stage2Spec, min: op.payMax, max: op.payMax },
                    attackName: preAttackDiscard.attackName,
                    picked: new Set<string>(),
                    exactRequired: op.payMax,
                    copyAttackChoice: cc, // v5.720 borrowed:stage2 picker confirm 也要帶
                  };
                }
                return;
              }
              preAttackDiscard = null;
              dispatch(GameActions.attack(ai, ['yes-token'], cc));
            }}>{yesLabel}</button>
          <button class="btn-ghost" style="padding:12px 32px;font-size:16px"
            onclick={() => {
              // v3.35：closure 內 ts narrowing 不會穿過外層 #if，需 null guard
              if (!preAttackDiscard) return;
              const ai = preAttackDiscard.attackIndex;
              const cc = preAttackDiscard.copyAttackChoice; // v5.720 borrowed 選「否」也要帶,否則耀閃挑戰收不到借招選擇
              preAttackDiscard = null;
              dispatch(GameActions.attack(ai, [], cc));
            }}>{noLabel}</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- 招式前置：丟棄能量選擇（v1.57 花冠射線 / 猛擂鼓 EX 等變動張數招式） -->
  {#if preAttackDiscard && game && preAttackDiscard.spec.scope !== 'binary-yes-no'}
    {@const spec = preAttackDiscard.spec}
    {@const energies = getDiscardableEnergies(spec)}
    {@const pickedCount = preAttackDiscard.picked.size}
    {@const pickedAmount = computePickedAmount(spec, preAttackDiscard.picked, energies)}
    {@const isUnits = spec.countMode === 'units'}
    {@const isHandDiscard = spec.scope === 'hand-rocket-supporter' || spec.scope === 'hand-tool' || spec.scope === 'hand-energy' || spec.scope === 'hand-reveal'}
    {@const isHandReveal = spec.scope === 'hand-reveal'}
    {@const isHandTool = spec.scope === 'hand-tool'}
    {@const unit = isUnits ? '個' : '張'}
    {@const minOk = pickedAmount >= effectivePreDiscardMin(spec, _maxDiscardAmount(spec))}
    {@const maxOk = isUnits ? true : (spec.max === null || pickedAmount <= spec.max)}
    {@const dmgPicked = isUnits && spec.max !== null ? Math.min(pickedAmount, spec.max) : pickedAmount}
    {@const estDmg = spec.baseDamage + dmgPicked * spec.damagePerEnergy}
    {@const req = preAttackDiscard.exactRequired}
    {@const exactOk = req === undefined ? true : pickedAmount >= req}
    {@const confirmEnabled = minOk && maxOk && exactOk}
    <!-- v5.115：移除「pickedAmount === 0 旁路」— 玩家回報「就算沒選能量也能按綠色按鈕」。
         原 v4.23 邏輯允許 0 張當「跳過」path，但 footer 已有 secondary「不啟用追加效果」按鈕
         專門走 0 張，primary「啟用追加效果」應只在 pickedAmount >= req 時 enable，
         否則 disabled 並提示「目前 X/req」。 -->
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>{isHandDiscard ? '🪶' : '⚡'} {preAttackDiscard.attackName}：選擇要{
            spec.verb === 'return-to-hand' ? '放回手牌的' :
            spec.verb === 'return-to-deck' ? '放回牌庫的' :
            spec.verb === 'reveal' ? '給對手看的' :
            '丟棄的'
          }{
            spec.scope === 'hand-rocket-supporter' ? '火箭隊支援者' :
            spec.scope === 'hand-energy' ? '能量卡' :
            isHandReveal ? (spec.handRevealLabel ?? '手牌') :
            isHandTool ? '寶可夢道具' :
            '能量'
          }</h3>
          <p class="sel-hint">
            最少 {spec.min} {unit}{spec.max === null ? '（不限上限）' : `，最多 ${spec.max} ${unit}`}
            · 已選 {pickedCount} 張{isUnits ? `（= ${pickedAmount} 個能量）` : ''}
            {#if spec.damagePerEnergy > 0}· 預估傷害 <strong>{estDmg}</strong>{/if}
            <br/>範圍：{
              spec.scope === 'attacker' ? '僅攻擊方出場寶可夢身上的能量' :
              spec.scope === 'own-bench' ? '僅自己備戰寶可夢身上的能量' :
              spec.scope === 'hand-rocket-supporter' ? '從自己手牌中名稱含「火箭隊」的支援者卡' :
              spec.scope === 'hand-energy' ? '從自己手牌中的能量卡（任意屬性）' :
              isHandReveal ? `從自己手牌中的${spec.handRevealLabel ?? '卡'}（只給對手看，不會離開手牌）` :
              isHandTool ? '從自己手牌中的寶可夢道具卡' :
              '自己場上任一寶可夢身上的能量'
            }
            {#if isUnits}<br/><small style="color:#888">註：1 張燃火能量（附進化）= 3 個無能量；1 張火箭隊能量 = 2 個無能量。</small>{/if}
          </p>
        </div>
        <div class="sel-grid">
          {#each energies as e (e.iid)}{@const ec = getCard(e.cardId)}
            {#if ec}
              {@const picked = preAttackDiscard.picked.has(e.iid)}
              {@const eUnits = isUnits ? getEnergyDiscardUnits(e.cardId, e.hostInst, pool, game, aIdx) : 1}
              <!-- v5.219：能量旁加放大鏡 — 玩家可看擁有此能量的寶可夢詳情（HP/能量/狀態），決定要丟哪隻的能量。
                   hand-* scope 沒 hostInst（能量還在手牌）→ 隱藏放大鏡。 -->
              <div class="sel-card-wrap" class:sel-picked={picked}>
                {#if !isHandDiscard && e.hostInst}
                  <button class="sel-zoom" title="放大檢視擁有此能量的寶可夢：{e.ownerName}"
                    onclick={(e2) => { e2.stopPropagation(); openZoom(e.hostInst.cardId, e.hostInst); }}>🔍</button>
                {/if}
                <button class="sel-card" class:sel-picked={picked} onclick={() => togglePreAttackEnergy(e.iid)}>
                  <img use:retryImg={ec.imageUrl} src={ec.imageUrl} alt={ec.name}/>
                  <span class="sel-name">{ec.name}{isUnits && eUnits > 1 ? `（${eUnits}個）` : ''}</span>
                  <span class="sel-hp">{isHandDiscard ? '在手牌中' : `附於 ${e.ownerName}`}</span>
                  {#if picked}<span class="sel-check">✓</span>{/if}
                </button>
              </div>
            {/if}
          {/each}
          {#if energies.length === 0}
            <p class="sel-empty">（沒有可{isHandReveal ? '展示的' + (spec.handRevealLabel ?? '卡') : (isHandDiscard ? '丟棄的支援者' : '丟棄的能量')}）</p>
          {/if}
        </div>
        <div class="sel-footer">
          <button class="btn-act primary" disabled={!confirmEnabled} onclick={confirmPreAttackDiscard}>
            {#if req !== undefined}
              啟用追加效果（需放回 {req} 個能量，目前 {pickedCount}/{req}）
            {:else}
              確定使用招式（{spec.verb === 'reveal' ? '給對手看' : (spec.verb === 'return-to-hand' || spec.verb === 'return-to-deck' ? '放回' : '丟')} {pickedCount} 張{isUnits ? `／${pickedAmount} 個能量` : ''}）
            {/if}
          </button>
          {#if spec.min === 0}
            <button class="btn-act secondary" onclick={() => { if (preAttackDiscard) { preAttackDiscard.picked = new Set(); confirmPreAttackDiscard(); } }}>
              {#if req !== undefined}
                不啟用追加效果（不放回任何能量）
              {:else}
                {spec.verb === 'reveal' ? '不給對手看' : (spec.verb === 'return-to-hand' || spec.verb === 'return-to-deck' ? '不放回' : '不丟')}（0 傷害）
              {/if}
            </button>
          {/if}
          <button class="btn-act secondary" onclick={cancelPreAttackDiscard}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- v2.119 N的索羅亞克ex｜暗黑底牌 copy-attack picker ─────────────────── -->
  {#if copyAttackPicker}
    <div class="selection-overlay">
      <div class="selection-modal copy-attack-modal">
        <div class="sel-header">
          <h3>🌑 暗黑底牌：選擇要使用的招式</h3>
          <p class="sel-hint">從備戰區的「N的」寶可夢中選一隻，複製它的招式作為這個招式使用。</p>
        </div>
        <div class="copy-attack-list">
          {#each copyAttackPicker.candidates as cand (cand.inst.iid)}
            {#if cand.card}
              <div class="copy-attack-poke">
                <img use:retryImg={cand.card.imageUrl} src={cand.card.imageUrl} alt={cand.card.name} class="copy-attack-img"/>
                <div class="copy-attack-col">
                  <div class="copy-attack-name">{cand.card.name}</div>
                  <div class="copy-attack-atks">
                    {#each cand.card.attacks ?? [] as atk, aIdx}
                      <button
                        class="copy-attack-btn"
                        onclick={() => resolveCopyAttack(cand.inst.iid, aIdx)}
                        title={atk.effect ?? ''}
                      >
                        <span class="copy-atk-cost">
                          {#each atk.cost as e}<span class="copy-atk-pip" style:background={ENERGY_COLOR[e]} title={ENERGY_LABEL[e]}>{ENERGY_LABEL[e]}</span>{/each}
                        </span>
                        <span class="copy-atk-name">{atk.name}</span>
                        {#if atk.damage}<span class="copy-atk-dmg">{atk.damage}</span>{/if}
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            {/if}
          {/each}
        </div>
        <div class="sel-footer">
          <button class="btn-act secondary" onclick={cancelCopyAttack}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- v3.873 火箭隊的謎擬Ｑ｜扮晶晶酒 — 挑對手戰鬥場太晶寶可夢的招式 ─────────── -->
  {#if personateAttackPicker}
    {@const op = personateAttackPicker.oppPoke}
    <div class="selection-overlay">
      <div class="selection-modal copy-attack-modal">
        <div class="sel-header">
          <h3>🎭 扮晶晶酒：選擇要扮演的招式</h3>
          <p class="sel-hint">從對手戰鬥場的「太晶」寶可夢中選 1 個招式，作為這個招式使用。<br/>若選到有「若希望」效果的招式（如激流水泵），下一步會詢問是否啟用追加效果。</p>
        </div>
        <div class="copy-attack-list">
          <div class="copy-attack-poke">
            <img use:retryImg={op.card.imageUrl} src={op.card.imageUrl} alt={op.card.name} class="copy-attack-img"/>
            <div class="copy-attack-col">
              <div class="copy-attack-name">{op.card.name}（對手戰鬥場）</div>
              <div class="copy-attack-atks">
                {#each op.card.attacks ?? [] as atk, aIdx}
                  <button
                    class="copy-attack-btn"
                    onclick={() => resolvePersonateAttack(op.inst.iid, aIdx)}
                    title={atk.effect ?? ''}
                  >
                    <span class="copy-atk-cost">
                      {#each atk.cost as e}<span class="copy-atk-pip" style:background={ENERGY_COLOR[e]} title={ENERGY_LABEL[e]}>{ENERGY_LABEL[e]}</span>{/each}
                    </span>
                    <span class="copy-atk-name">{atk.name}</span>
                    {#if atk.damage}<span class="copy-atk-dmg">{atk.damage}</span>{/if}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>
        <div class="sel-footer">
          <button class="btn-act secondary" onclick={cancelPersonateAttack}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- v3.895 呆呆王｜耀閃挑戰 — 牌庫頂寶可夢的招式選擇 picker ─────────── -->
  {#if brightChallengePicker}
    {@const tp = brightChallengePicker.topPoke}
    <div class="selection-overlay">
      <div class="selection-modal copy-attack-modal">
        <div class="sel-header">
          <h3>耀閃挑戰：選擇要使用的招式</h3>
          <p class="sel-hint">自己的牌庫上方 1 張卡為「{tp.card.name}」（將被丟棄）。請選擇 1 個它持有的招式作為這個招式使用。</p>
        </div>
        <div class="copy-attack-list">
          <div class="copy-attack-poke">
            <img use:retryImg={tp.card.imageUrl} src={tp.card.imageUrl} alt={tp.card.name} class="copy-attack-img"/>
            <div class="copy-attack-col">
              <div class="copy-attack-name">{tp.card.name}（牌庫頂）</div>
              <div class="copy-attack-atks">
                {#each tp.card.attacks ?? [] as atk, aIdx}
                  <button
                    class="copy-attack-btn"
                    onclick={() => resolveBrightChallenge(tp.inst.iid, aIdx)}
                    title={atk.effect ?? ''}
                  >
                    <span class="copy-atk-cost">
                      {#each atk.cost as e}<span class="copy-atk-pip" style:background={ENERGY_COLOR[e]} title={ENERGY_LABEL[e]}>{ENERGY_LABEL[e]}</span>{/each}
                    </span>
                    <span class="copy-atk-name">{atk.name}</span>
                    {#if atk.damage}<span class="copy-atk-dmg">{atk.damage}</span>{/if}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>
        <div class="sel-footer">
          <button class="btn-act secondary" onclick={cancelBrightChallenge}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- v4.39 火箭隊的貓老大ex｜高傲指令 — 對手牌庫頂 10 張寶可夢的招式選擇 picker ─── -->
  {#if rocketCommandPicker}
    <div class="selection-overlay">
      <div class="selection-modal copy-attack-modal">
        <div class="sel-header">
          <!-- v5.181：sourceAttackName 動態 (高傲指令/揮指/試著模仿). 用 inline ?? 避開 svelte 5 @const placement rule -->
          {#if rocketCommandPicker.revealOnly}
            <h3>{rocketCommandPicker.sourceAttackName ?? '高傲指令'}：對手牌庫頂 10 張無寶可夢（公開揭示）</h3>
            <p class="sel-hint">依照卡面規則，翻到正面的 10 張卡全部公開揭示給對手看。下方為對手牌庫上方 10 張卡的內容（無寶可夢可複製）。確認後放回牌庫並重洗，本次招式 0 傷害。</p>
          {:else if (rocketCommandPicker.sourceAttackName ?? '高傲指令') === '高傲指令'}
            <h3>高傲指令：選擇要使用的招式</h3>
            <p class="sel-hint">對手牌庫上方 10 張卡翻到正面，下列為其中持有招式的寶可夢。請選擇 1 個招式作為這個招式使用（若不希望可按「不複製」）。翻到正面的卡將放回牌庫並重洗。</p>
          {:else}
            <h3>{rocketCommandPicker.sourceAttackName}：選擇要複製的招式</h3>
            <p class="sel-hint">對手戰鬥場寶可夢持有的招式如下，請選擇 1 個作為此招式使用。{#if rocketCommandPicker.sourceAttackName === '試著模仿'}（注意：必須擲幣為正面才實際生效，反面則 0 傷害）{/if}</p>
          {/if}
        </div>
        {#if rocketCommandPicker.revealOnly && rocketCommandPicker.top10All}
          <!-- v5.174：revealOnly 模式 — 純展示 top10 全部卡圖（含非寶可夢） -->
          <div class="copy-attack-list rocket-command-scroll" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.5rem">
            {#each rocketCommandPicker.top10All as p (p.inst.iid)}
              <div class="copy-attack-poke" style="flex-direction:column;align-items:center;text-align:center">
                <img use:retryImg={p.card.imageUrl} src={p.card.imageUrl} alt={p.card.name} class="copy-attack-img" style="max-width:110px"/>
                <div class="copy-attack-name" style="font-size:.78rem">{p.card.name}</div>
              </div>
            {/each}
          </div>
        {:else}
        <div class="copy-attack-list rocket-command-scroll">
          {#each rocketCommandPicker.pokeList as p (p.inst.iid)}
            <div class="copy-attack-poke">
              <img use:retryImg={p.card.imageUrl} src={p.card.imageUrl} alt={p.card.name} class="copy-attack-img"/>
              <div class="copy-attack-col">
                <div class="copy-attack-name">{p.card.name}</div>
                <div class="copy-attack-atks">
                  {#each p.card.attacks ?? [] as atk, aIdx}
                    <button
                      class="copy-attack-btn"
                      onclick={() => resolveRocketCommand(p.inst.iid, aIdx)}
                      title={atk.effect ?? ''}
                    >
                      <span class="copy-atk-cost">
                        {#each atk.cost as e}<span class="copy-atk-pip" style:background={ENERGY_COLOR[e]} title={ENERGY_LABEL[e]}>{ENERGY_LABEL[e]}</span>{/each}
                      </span>
                      <span class="copy-atk-name">{atk.name}</span>
                      {#if atk.damage}<span class="copy-atk-dmg">{atk.damage}</span>{/if}
                    </button>
                  {/each}
                </div>
              </div>
            </div>
          {/each}
        </div>
        {#if rocketCommandPicker.top10All && rocketCommandPicker.top10All.length > 0}
          <!-- v5.175：揭示其他翻到的卡 (非寶可夢 / 無招式寶可夢) - 仿寶可裝置3.0 details 下拉
               對玩家來說是重要資訊：得知對手牌庫頂 10 張內容 (含支援者/能量/物品/道具) -->
          {@const _pickableIids = new Set(rocketCommandPicker.pokeList.map(p => p.inst.iid))}
          {@const _peekedOthers = rocketCommandPicker.top10All.filter(p => !_pickableIids.has(p.inst.iid))
            .slice().sort((a,b) => {
              const ra = cardTypeRank(a.card), rb = cardTypeRank(b.card);
              if (ra !== rb) return ra - rb;
              return (a.card?.name ?? '').localeCompare(b.card?.name ?? '');
            })}
          {#if _peekedOthers.length > 0}
            <details class="full-deck-view" open>
              <summary>🔍 翻到的其他 {_peekedOthers.length} 張（公開揭示，本次不可複製招式）</summary>
              <div class="full-deck-note">※ 高傲指令翻到正面 10 張全部公開揭示給雙方看；確認後放回牌庫並重洗</div>
              <div class="full-deck-list">
                {#each _peekedOthers as p (p.inst.iid)}
                  <button class="deck-cell" title="{p.card.name} — 點擊放大"
                    onclick={(e)=>{e.stopPropagation();openZoom(p.inst.cardId, p.inst);}}>
                    {#if p.card.imageUrl}<img use:retryImg={p.card.imageUrl} src={p.card.imageUrl} alt={p.card.name} class="deck-cell-img" loading="lazy"
                      class:legend-half-l={twoCardStadiumSide(p.inst.cardId) === 0}
                      class:legend-half-r={twoCardStadiumSide(p.inst.cardId) === 1}/>
                    {:else}<div class="deck-cell-fallback">{p.card.name}</div>{/if}
                  </button>
                {/each}
              </div>
            </details>
          {/if}
        {/if}
        {/if}
        <div class="sel-footer">
          {#if rocketCommandPicker.revealOnly}
            <!-- v5.174：揭示確認 — 等同 skip (傷害 0 + 重洗對手牌庫) -->
            <button class="btn-act primary" onclick={skipRocketCommand}>✓ 確認（已揭示，重洗對手牌庫，本招式 0 傷害）</button>
          {:else}
            <!-- v5.169：「不複製」按鈕 (skip 但攻擊算完) -->
            <button class="btn-act" onclick={skipRocketCommand}>不複製（傷害 0，攻擊結束）</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- v3.900 回合切換 banner — 全螢幕中央彈「你的回合 / 對手回合」大字 1.5s ─────── -->
  <!-- v6.022 錦標賽通知：首次進大廳詢問（先用自訂視窗問意願，按下才向瀏覽器要權限，
     避免玩家直覺按掉導致瀏覽器永久封鎖、之後很難再開） -->
{#if showNotifyPrompt}
  <div class="modal-overlay notify-prompt-overlay" role="dialog" aria-modal="true" aria-label="開啟賽事通知">
    <div class="notify-prompt-modal">
      <h3>🔔 開啟賽事通知？</h3>
      <p>開放報到、輪到你可以進場、以及對戰中輪到你行動時，就算你切到別的分頁或鎖屏，也會跳通知提醒你。</p>
      <p class="muted">此分頁需保持開啟；你正在看畫面時不會打擾你。隨時可在設定中關閉。</p>
      {#if notifyIOSNeedsInstall}
        <p class="muted ios-hint">📱 iPhone / iPad 需先「加入主畫面」並從主畫面開啟本站，通知才會生效（需 iOS 16.4 以上）。</p>
      {/if}
      <div class="notify-prompt-btns">
        {#if notifyIOSNeedsInstall}
          <button class="btn-primary" onclick={() => notifyPromptDecline()}>我知道了</button>
        {:else}
          <button class="btn-primary" onclick={() => notifyPromptAccept()}>開啟通知</button>
          <button class="btn-secondary" onclick={() => notifyPromptDecline()}>不用了</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if turnBanner}
    <div class="turn-banner-overlay" transition:fade={{ duration: 200 }}>
      <div class="turn-banner-content">
        <div class="turn-banner-pokeball">⚪</div>
        <div class="turn-banner-text">{turnBanner.text}</div>
      </div>
    </div>
  {/if}

  <!-- v3.97 對戰中聊天室（floating panel + 手機 modal）─────────────────────── -->
  <!-- 只在連線模式 + 已進入 game（避開 lobby — lobby 已有 chat-area） -->
  {#if (mode === 'online' && game && roomCode) || (isTournament && game)}
    <!-- v5.055：對手回合動作 panel — toggle 按鈕 -->
    {#if game?.phase === 'playing'
         && (oppPlayer?.turnActionsLog?.length ?? 0) > 0
         && !oppTurnPanelOpen}
      <button class="opp-turn-toggle-btn"
        style:transform={`translate(${oppTurnTogglePos.x}px, ${oppTurnTogglePos.y}px)`}
        onpointerdown={onOppTurnToggleDragStart}
        onpointermove={onOppTurnToggleDragMove}
        onpointerup={onOppTurnToggleDragEnd}
        onclick={onOppTurnToggleClick}
        title="查看對手回合出牌（拖曳移動位置）">📜</button>
    {/if}

    <!-- v5.055：對手回合動作 panel 主體 -->
    {#if oppTurnPanelOpen && oppPlayer}
      {@const _log = oppPlayer.turnActionsLog ?? []}
      {@const _maxIdx = Math.max(0, _log.length - 1)}
      {@const _safeIdx = Math.min(oppTurnViewIndex, _maxIdx)}
      {@const _currentEntry = _log.length > 0 ? _log[_log.length - 1 - _safeIdx] : null}
      <div class="opp-turn-panel" style:transform={`translate(${oppTurnPanelPos.x}px, ${oppTurnPanelPos.y}px)`}>
        <div class="opp-turn-panel-header"
          onpointerdown={onOppTurnDragStart}
          onpointermove={onOppTurnDragMove}
          onpointerup={onOppTurnDragEnd}>
          <span class="opp-turn-panel-title">
            <button class="opp-turn-nav-btn" disabled={_safeIdx >= _maxIdx}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => { oppTurnViewIndex = Math.min(_maxIdx, oppTurnViewIndex + 1); }}
              title="看更早的回合">◀</button>
            <span class="opp-turn-title-text">
              📜 對手回合出牌 {_currentEntry?.turn ?? '?'}
              <span class="opp-turn-title-sub">（上 {_safeIdx + 1} 回合前）</span>
            </span>
            <button class="opp-turn-nav-btn" disabled={_safeIdx <= 0}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => { oppTurnViewIndex = Math.max(0, oppTurnViewIndex - 1); }}
              title="看更新的回合">▶</button>
          </span>
          <button class="opp-turn-panel-close"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => oppTurnPanelOpen = false} aria-label="關閉">✕</button>
        </div>
        <div class="opp-turn-panel-body">
          {#if _currentEntry && _currentEntry.actions.length > 0}
            <div class="opp-turn-actions-grid">
              {#each _currentEntry.actions as act}
                {@const _c = getCard(act.cardId)}
                <div class="opp-turn-action-item" class:discard={act.type === 'discard'}
                  title={(_c?.name ?? '?') + (act.extra ? ' / ' + act.extra : '') + (act.type === 'discard' ? '（被丟棄）' : '')}>
                  {#if _c?.imageUrl}
                    <img use:retryImg={_c.imageUrl} class="opp-turn-card-img" src={_c.imageUrl} alt={_c?.name ?? '?'}
                      class:legend-half-l={twoCardStadiumSide(act.cardId) === 0}
                      class:legend-half-r={twoCardStadiumSide(act.cardId) === 1}
                      onclick={() => openZoom(act.cardId, null)} />
                  {:else}
                    <div class="opp-turn-card-placeholder">?</div>
                  {/if}
                  {#if act.type === 'attack'}
                    <div class="opp-turn-action-label attack">⚔️ {act.extra ?? '招式'}</div>
                  {:else if act.type === 'retreat'}
                    <div class="opp-turn-action-label retreat">🔄 撤退{act.extra ?? ''}</div>
                  {:else if act.type === 'use_ability'}
                    <div class="opp-turn-action-label ability">✨ {act.extra ?? '特性'}</div>
                  {:else if act.type === 'discard'}
                    <div class="opp-turn-action-label discard">🗑 丟棄</div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="opp-turn-empty">（此回合無記錄）</div>
          {/if}
        </div>
      </div>
    {/if}

    {#if !chatPanelOpen}
      <!-- v3.98 收合：圓形按鈕可拖曳（pointer events 區分 click vs drag）-->
      <button class="chat-fab"
        style:transform={`translate(${chatFabPos.x}px, ${chatFabPos.y}px)`}
        onpointerdown={onFabPointerDown}
        onpointermove={onFabPointerMove}
        onpointerup={onFabPointerUp}
        title="點擊開啟聊天室；長按拖曳可移動位置">
        💬
        {#if chatFabUnread > 0}<span class="chat-fab-badge">{chatFabUnread}</span>{/if}
      </button>
    {:else}
      <!-- 展開：floating panel（桌機）/ 全螢幕 modal（手機 portrait CSS @media） -->
      <div class="chat-panel" style:transform={`translate(${chatPanelPos.x}px, ${chatPanelPos.y}px)`} style:margin-left={isPortraitMobile ? `${chatPanelPos.x}px` : undefined} style:margin-top={isPortraitMobile ? `${chatPanelPos.y}px` : undefined}>
        <div class="chat-panel-header"
          onpointerdown={onChatHeaderDown}
          onpointermove={onChatHeaderMove}
          onpointerup={onChatHeaderUp}
          title="拖曳此處移動聊天視窗（手機版固定全螢幕）">
          <span>{isTournament ? '💬 大廳聊天室' : '💬 聊天室'}</span>
          <button class="chat-panel-close"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={toggleChatPanel}
            title="最小化">×</button>
        </div>
        <div class="chat-panel-messages" bind:this={chatPanelScrollEl} onscroll={onChatPanelScroll}>
          {#if isTournament}
            {#if tChat.length === 0}
              <p class="muted small chat-empty">大廳聊天室目前沒有訊息～</p>
            {:else}
              {#each tChat as m (m.id)}
                <div class="chat-msg {m.sys ? tSysClass(m.text) : ''}" class:tcsys={m.sys} class:tcadmin={m.admin}>
                  <span class="chat-name">{#if m.admin}🛡️ {/if}{m.name}</span>
                  {#if m.ts}<span class="chat-time">{tFmtMsgTime(m.ts)}</span>{/if}
                  <div class="chat-text">{m.text}</div>
                </div>
              {/each}
            {/if}
          {:else if chatMessages.length === 0}
            <p class="muted small chat-empty">尚無訊息，先說聲哈囉吧！</p>
          {:else}
            {#each chatMessages as m (m.id)}
              <div class="chat-msg {m.uid === myUid ? 'mine' : ''}">
                <span class="chat-name">{m.name}</span>
                <span class="chat-time">{fmtChatTime(m.createdAt)}</span>
                <div class="chat-text">{m.text}</div>
              </div>
            {/each}
          {/if}
        </div>
        <div class="chat-input-row">
          {#if isTournament}
            <input class="chat-input" type="text" placeholder={(tCanChat || tIsAdmin) ? '與大廳聊天室互動（Enter 送出）' : '🔒 請先登入即可發言，可觀看'} maxlength="200" bind:value={tChatInput} onkeydown={(e) => e.key === 'Enter' && (tCanChat || tIsAdmin) && tChatSend()} disabled={!(tCanChat || tIsAdmin)} />
            <button class="btn-primary chat-send" onclick={tChatSend} disabled={!tChatInput.trim() || !(tCanChat || tIsAdmin)}>送出</button>
          {:else}
            <input
              class="chat-input"
              type="text"
              placeholder="輸入訊息（Enter 送出，最多 200 字）"
              maxlength="200"
              bind:value={chatInput}
              onkeydown={handleChatKey}
              disabled={mySeatIdx < 0}
            />
            <button class="btn-primary chat-send"
              onclick={handleSendMessage}
              disabled={!chatInput.trim() || mySeatIdx < 0}>
              送出
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Retreat Menu（置中橫向 grid，支援放大鏡，避免撞到畫面頂部） -->
  {#if floatingRetreatMenu && myPlayer?.active}
    <div class="selection-overlay" class:dragged={modalDragged} onclick={() => floatingRetreatMenu = null}>
      <div class="selection-modal retreat-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`} onclick={(e)=>e.stopPropagation()}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>🔄 選擇換入的寶可夢</h3>
          <p class="sel-hint">挑選一隻備戰區的寶可夢上場；點放大鏡 🔍 查看詳情以區分同名卡身上的能量</p>
        </div>
        <div class="retreat-grid">
          {#each myPlayer.bench as b}{@const bc=getCard(b.cardId)}
            {#if bc}
              {@const eff=hpTotal(b)}
              {@const rem=hpRemaining(b)}
              <div class="retreat-card">
                <button class="retreat-zoom" title="放大檢視：{bc.name}"
                  onclick={(e)=>{e.stopPropagation();openZoom(b.cardId, b);}}>🔍</button>
                <button class="retreat-pick" disabled={actionBusy} onclick={(e)=>{e.stopPropagation();dispatch(GameActions.retreat(b.iid));floatingRetreatMenu=null;}}>
                  <img use:retryImg={bc.imageUrl} src={bc.imageUrl} alt={bc.name}/>
                  <div class="retreat-name">{bc.name}</div>
                  <div class="retreat-hp">HP {rem}/{eff}</div>
                  <div class="retreat-nrg" title="附加的能量">⚡ {energySummary(b)}</div>
                  {#if b.toolAttached}{@const tc=getCard(b.toolAttached.cardId)}<div class="retreat-tool" title="附加道具">🔧 道具：{tc?.name ?? '?'}</div>{/if}
                  {#each (b.extraTools ?? []) as etRM}{@const tcRM=getCard(etRM.cardId)}<div class="retreat-tool" title="附加道具（多重轉接）">🔧 道具：{tcRM?.name ?? '?'}</div>{/each}
                  {#if b.status}<div class="retreat-status" title="特殊狀態">
                    ⚠️ 狀態：{b.status==='poisoned'?'☠️ 中毒':b.status==='burned'?'🔥 灼傷':b.status==='asleep'?'💤 睡眠':b.status==='confused'?'😵 混亂':b.status==='paralyzed'?'⚡ 麻痺':b.status}
                  </div>{/if}
                </button>
              </div>
            {/if}
          {/each}
          {#if myPlayer.bench.length===0}
            <p class="sel-empty">（備戰區沒有可上場的寶可夢）</p>
          {/if}
        </div>
        <div class="sel-footer">
          <button class="btn-act secondary" onclick={()=>floatingRetreatMenu=null}>取消</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ⭐ v6.122 補位卡片格子：兩個 modal 共用同一份 markup（原本各抄一份、會漂移）。
       pick／onPick 由呼叫端各自傳入自己的 state —— 不共用（見 confirmSendNewActive 上方註解）。 -->
  {#snippet promoteGrid(bench: any[], pick: string | null, onPick: (iid: string) => void)}
    <div class="retreat-grid">
      {#each bench as b (b.iid)}{@const bc=getCard(b.cardId)}
        {#if bc}
          {@const eff=hpTotal(b)}
          {@const rem=hpRemaining(b)}
          {@const picked = pick === b.iid}
          <div class="retreat-card" class:sel-picked={picked}>
            <button class="retreat-zoom" title="放大檢視：{bc.name}"
              onclick={(e)=>{e.stopPropagation();openZoom(b.cardId, b);}}>🔍</button>
            <button class="retreat-pick" onclick={(e)=>{e.stopPropagation();onPick(b.iid);}}>
              <img use:retryImg={bc.imageUrl} src={bc.imageUrl} alt={bc.name}/>
              <div class="retreat-name">{bc.name}</div>
              <div class="retreat-hp">HP {rem}/{eff}</div>
              <div class="retreat-nrg" title="附加的能量">⚡ {energySummary(b)}</div>
              {#if b.toolAttached}{@const tc=getCard(b.toolAttached.cardId)}<div class="retreat-tool" title="附加道具">🔧 道具：{tc?.name ?? '?'}</div>{/if}
              {#each (b.extraTools ?? []) as etSN}{@const tcSN=getCard(etSN.cardId)}<div class="retreat-tool" title="附加道具（多重轉接）">🔧 道具：{tcSN?.name ?? '?'}</div>{/each}
              {#if b.status}<div class="retreat-status" title="特殊狀態">
                ⚠️ 狀態：{b.status==='poisoned'?'☠️ 中毒':b.status==='burned'?'🔥 灼傷':b.status==='asleep'?'💤 睡眠':b.status==='confused'?'😵 混亂':b.status==='paralyzed'?'⚡ 麻痺':b.status}
              </div>{/if}
              {#if picked}<span class="sel-check">✓</span>{/if}
            </button>
          </div>
        {/if}
      {/each}
      {#if bench.length===0}
        <p class="sel-empty">（備戰區沒有可上場的寶可夢）</p>
      {/if}
    </div>
  {/snippet}

  <!-- Send New Active Modal（戰鬥寶可夢昏厥後派出新戰鬥寶可夢，使用統一的橫向 grid + 放大鏡介面）
       v2.123：去掉 turnPhase==='end' 限制 — 特性/招式 KO 時 turnPhase 仍為 'main'，
       舊條件會不彈 modal 造成卡住。
       v2.197：加 !pendingSelection guard — 攻擊方還在 pending（如幻影奇襲分配
       6 counter）時，防守方先不彈 modal；等 pending 結束後再彈，避免「modal 已開
       但 button 按了沒反應」的卡頓視覺。
       v6.122：改「選取 → 確定」兩段式；並補 !isSpectator（觀戰者的 dispatch 本來就被擋，
       原本卻仍會蓋一個點不動也關不掉的 modal 在觀戰畫面上）。 -->
  {#if game && game.phase==='playing' && defenderPlayer?.active===null && isMyDefenderTurn() && !pendingSelection && !isSpectator}
    {@const _benchD = defenderPlayer?.bench ?? []}
    {@const _pickOkD = !!promotePickDef && _benchD.some((b) => b.iid === promotePickDef)}
    {@const _pickNameD = _pickOkD ? (getCard(_benchD.find((b) => b.iid === promotePickDef)!.cardId)?.name ?? '') : ''}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal retreat-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`} onclick={(e)=>e.stopPropagation()}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>⚠️ 派出新的戰鬥寶可夢</h3>
          <p class="sel-hint">先點選要上場的寶可夢，再按下方的「確定上場」；點放大鏡 🔍 查看詳情</p>
        </div>
        {@render promoteGrid(_benchD, promotePickDef, (iid) => { promotePickDef = promotePickDef === iid ? null : iid; })}
        <div class="sel-footer">
          <button class="btn-act primary" disabled={actionBusy||!_pickOkD}
            onclick={()=>confirmSendNewActive(promotePickDef, dIdx, _benchD)}>
            {_pickOkD ? `✅ 確定讓「${_pickNameD}」上場` : '請先點選要上場的寶可夢'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Send New Active Modal（自 KO 版）：主動方自 KO（如咒詛炸彈、中毒）後自己戰鬥場空欄 → 從自己備戰區選
       v2.123：去掉 turnPhase!=='end' 限制 — 中毒於 END_TURN 觸發時 turnPhase 可能已是 'end'，
       舊條件會擋掉 modal 造成當機。
       v6.122：同上，改兩段式 + 補 !isSpectator。 -->
  {#if game && game.phase==='playing' && myPlayer?.active===null && (myPlayer?.bench??[]).length>0 && !pendingSelection && !isSpectator}
    {@const _benchS = myPlayer?.bench ?? []}
    {@const _pickOkS = !!promotePickSelf && _benchS.some((b) => b.iid === promotePickSelf)}
    {@const _pickNameS = _pickOkS ? (getCard(_benchS.find((b) => b.iid === promotePickSelf)!.cardId)?.name ?? '') : ''}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal retreat-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`} onclick={(e)=>e.stopPropagation()}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>⚠️ 派出新的戰鬥寶可夢</h3>
          <p class="sel-hint">先點選要上場的寶可夢，再按下方的「確定上場」；點放大鏡 🔍 查看詳情</p>
        </div>
        {@render promoteGrid(_benchS, promotePickSelf, (iid) => { promotePickSelf = promotePickSelf === iid ? null : iid; })}
        <div class="sel-footer">
          <button class="btn-act primary" disabled={actionBusy||!_pickOkS}
            onclick={()=>confirmSendNewActive(promotePickSelf, myIdx, _benchS)}>
            {_pickOkS ? `✅ 確定讓「${_pickNameS}」上場` : '請先點選要上場的寶可夢'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Discard Viewer -->
  {#if viewDiscardFor !== null}
    {@const viewPlayer = game!.players[viewDiscardFor]}
    {@const discardGrouped = (() => {
      // v5.352：網頁版棄牌區改與手機版一致 — 合併同名卡顯示張數，依
      //   寶可夢→物品→支援者→場地→能量 排序（同類內 count desc 再 name）。
      const map = new Map();
      for (const inst of viewPlayer.discard) {
        const card = pool.get(inst.cardId);
        // v6.091「傳說」兩張合一競技場不聚合 —— 左右半各自一格個別顯示（Wilson 裁定）。
        //   Map key 改用 iid 才不會和同 cardId 的另一半互相覆蓋。
        if (isTwoCardStadiumName(card?.name)) {
          map.set(inst.iid, {
            name: card?.name ?? inst.cardId, count: 1, cardId: inst.cardId,
            half: twoCardStadiumHalfIndex(viewPlayer.discard, inst.iid, pool),
          });
          continue;
        }
        const entry = map.get(inst.cardId);
        if (entry) entry.count++;
        else map.set(inst.cardId, { name: card?.name ?? inst.cardId, count: 1, cardId: inst.cardId });
      }
      return [...map.values()].sort((a, b) => {
        const ra = cardTypeRank(pool.get(a.cardId)), rb = cardTypeRank(pool.get(b.cardId));
        if (ra !== rb) return ra - rb;
        return b.count - a.count || a.name.localeCompare(b.name);
      });
    })()}
    <div class="zoom-overlay" onclick={() => viewDiscardFor = null}>
      <div class="zoom-modal discard-modal" onclick={(e)=>e.stopPropagation()}>
        <button class="zoom-close" onclick={() => viewDiscardFor = null}>✕</button>
        <h3 class="discard-title">🗑 {viewPlayer.name} 的棄牌區（{viewPlayer.discard.length} 張）</h3>
        <div class="sel-grid">
          {#each discardGrouped as g}{@const c=getCard(g.cardId)}
            {#if c}
              <button class="sel-card" onclick={() => openZoom(g.cardId)}>
                <img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name} loading="lazy"
                  class:legend-half-l={g.half === 0} class:legend-half-r={g.half === 1}/><span class="sel-name">{c.name}</span>
                <!-- v6.091：兩張合一競技場已拆成一格一張，×1 徽章反而容易誤讀成聚合，故不顯示 -->
                {#if g.half !== 0 && g.half !== 1}<span class="deck-cell-count">×{g.count}</span>{/if}
              </button>
            {/if}
          {/each}
          {#if viewPlayer.discard.length === 0}<p class="sel-empty">（棄牌區是空的）</p>{/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Settings Modal (Audio & BGM) -->
  {#if showSettingsModal}
    <div class="zoom-overlay" onclick={() => showSettingsModal = false}>
      <div class="zoom-modal settings-modal" onclick={(e)=>e.stopPropagation()}>
        <button class="zoom-close" onclick={() => showSettingsModal = false}>✕</button>
        <h3 class="settings-title">⚙️ 設定</h3>
        
        <details class="settings-section">
          <summary>🎵 背景音樂 (BGM)</summary>
          <div class="setting-row">
            <label for="bgm-select">選擇曲目：</label>
            <select id="bgm-select" value={bgmTrack} onchange={(e) => onBgmTrackChange(e.currentTarget.value)}>
              <option value="none">無 (關閉)</option>
              <!-- v3.84: 為避免版權風險，移除 3 首官方 BGM（v6.130 已把 mp3 檔案本身也從網站移除）。
                   v6.130: 上架站長原創曲。新增曲目＝在這加一個 option + 把 .mp3 放進 static/music/
                   + 把代號加進上面的 BGM_TRACKS 白名單（三處都要，否則舊值 fallback 會把它擋掉）。 -->
              <option value="last-card">最後一張牌</option>
            </select>
          </div>
          <div class="bgm-note">選擇曲目後才會開始下載，不選就完全不佔流量。</div>
          {#if bgmTrack !== 'none' && bgmBlocked}
            <div class="bgm-note bgm-blocked">🔇 瀏覽器擋住了自動播放 —— 在畫面上點一下就會開始播放。</div>
          {/if}
          {#if bgmTrack !== 'none'}
            <div class="setting-row">
              <label for="bgm-vol">音樂音量：</label>
              <input id="bgm-vol" type="range" min="0" max="1" step="0.05" value={bgmVolume} oninput={(e) => onBgmVolumeChange(parseFloat(e.currentTarget.value))} />
              <span class="vol-text">{Math.round(bgmVolume * 100)}%</span>
            </div>
          {/if}
        </details>

        <details class="settings-section">
          <summary>🔊 遊戲音效 (SFX)</summary>
          <div class="setting-row">
            <label for="sfx-mute">音效開關：</label>
            <button id="sfx-mute" class="toggle-btn" onclick={onMuteToggle}>
              {audioMuted ? '❌ 已靜音' : '✅ 開啟'}
            </button>
          </div>
          {#if !audioMuted}
            <div class="setting-row">
              <label for="sfx-vol">總音量：</label>
              <input id="sfx-vol" type="range" min="0" max="1" step="0.05" value={audioVolume} oninput={(e) => onVolumeChange(parseFloat(e.currentTarget.value))} />
              <span class="vol-text">{Math.round(audioVolume * 100)}%</span>
            </div>
            <!-- v4.928 sub-bus 音量 -->
            <div class="setting-row">
              <label for="ui-vol">操作音（抽牌/進化/附能量）：</label>
              <input id="ui-vol" type="range" min="0" max="1" step="0.05" value={uiVolume} oninput={(e) => { uiVolume = parseFloat(e.currentTarget.value); saveUiVolume(uiVolume); }} />
              <span class="vol-text">{Math.round(uiVolume * 100)}%</span>
            </div>
            <div class="setting-row">
              <label for="sfx-attack-vol">戰鬥音（攻擊/結算）：</label>
              <input id="sfx-attack-vol" type="range" min="0" max="1" step="0.05" value={sfxVolume} oninput={(e) => { sfxVolume = parseFloat(e.currentTarget.value); saveSfxVolume(sfxVolume); }} />
              <span class="vol-text">{Math.round(sfxVolume * 100)}%</span>
            </div>
            <div class="setting-row">
              <label for="status-vol">狀態音（中毒/灼傷）：</label>
              <input id="status-vol" type="range" min="0" max="1" step="0.05" value={statusVolume} oninput={(e) => { statusVolume = parseFloat(e.currentTarget.value); saveStatusVolume(statusVolume); }} />
              <span class="vol-text">{Math.round(statusVolume * 100)}%</span>
            </div>
            <!-- v4.929 切到背景頁籤時是否仍播音 -->
            <div class="setting-row">
              <label for="play-hidden">畫面不在對戰中也有音效：</label>
              <input id="play-hidden" type="checkbox" checked={playWhenHidden} onchange={(e) => { playWhenHidden = e.currentTarget.checked; savePlayWhenHidden(playWhenHidden); }} />
              <span class="small" style="color:#9aa3b0">（讓你聽 ready go 知道對戰開始）</span>
            </div>
          {/if}
          <!-- v6.032 通知的完整設定／測試／診斷已搬到 🏆 錦標賽大廳 ›「🪪 個人資料」分頁。
               這裡只留一個開關，供對戰進行中（大廳畫面不存在時）臨時想關掉推播使用。
               ⚠刻意放在 {#if !audioMuted} 的**外面**：通知跟音效靜音無關，
                 原本整段被包在裡面 → 把音效靜音的玩家在設定視窗完全看不到通知設定（順手修掉的舊 bug）。 -->
          <div class="setting-row">
            <label for="notify-enabled">🔔 錦標賽背景通知：</label>
            <input id="notify-enabled" type="checkbox" checked={notifyEnabled}
              onchange={(e) => onNotifyToggle(e.currentTarget.checked)} />
            <span class="small" style="color:#9aa3b0">（測試與診斷請到錦標賽大廳的「🪪 個人資料」）</span>
          </div>
        </details>

        <!-- v2.45 解析度模式 — 為 1024×576 等小螢幕玩家加 fit-to-window 縮放 -->
        <details class="settings-section" open>
          <summary>🖥️ 畫面縮放</summary>
          <div class="setting-row">
            <label for="res-mode">解析度模式：</label>
            <select id="res-mode" value={resolutionMode} onchange={(e) => setResolutionMode(e.currentTarget.value as 'auto' | '100' | '90' | '80' | '75' | '70' | '65' | '60')}>
              <option value="auto">自動（推薦）</option>
              <option value="100">100% — 原始尺寸</option>
              <option value="90">90% — 微縮</option>
              <option value="80">80%</option>
              <option value="75">75% — 1024×576 推薦</option>
              <option value="70">70%</option>
              <option value="65">65%</option>
              <option value="60">60% — 極小視窗</option>
            </select>
          </div>
          <div class="setting-hint">
            目前縮放：{Math.round(gameZoom * 100)}%
            <br/>・自動模式依視窗自動算（基準 1366×768）；1024×576 約落在 75%
            <br/>・若還是看到卡牌被切，可手動往下調 70% / 65% / 60%
          </div>
        </details>

        <!-- v5.009 / v5.011：對戰版面切換（仿實體 TCG 桌墊版，opt-in 測試）-->
        <details class="settings-section">
          <summary>🎴 對戰版面（測試）</summary>
          <div class="setting-row">
            <label for="battle-layout">板面布局：</label>
            <select id="battle-layout" value={battleLayout}
              onchange={(e) => setBattleLayout(e.currentTarget.value as 'classic' | 'tabletop' | 'fable')}>
              <option value="classic">經典版（Active 左對齊）</option>
              <option value="tabletop">🆕 桌墊版（仿實體 — Active 置中、bench 對稱列）</option>
              <option value="fable">✨ Fable 版（忠實桌墊 grid — 卡牌大小可調、紀錄入欄）</option>
            </select>
          </div>
          {#if battleLayout === 'fable'}
            <div class="setting-row">
              <label for="fable-card-scale">卡牌大小：{Math.round(fableCardScale * 100)}%</label>
              <input id="fable-card-scale" type="range" min="0.7" max="1.4" step="0.05"
                value={fableCardScale}
                oninput={(e) => setFableCardScale(parseFloat(e.currentTarget.value))} />
            </div>
          {/if}
          <div class="setting-hint">
            ・經典版 = 目前預設，所有玩家原本看到的版面
            <br/>・桌墊版 = 仿實體 TCG — 戰鬥位置中、Bench 5 格對稱列、競技場置中央
            <br/>・桌墊版仍在測試，窄螢幕（&lt; 1200px）可能變形，會自動退回經典版
            <br/>・只動桌機 — 手機版直立 layout 不受影響
          </div>
        </details>

        <!-- v4.60 對局控制 -->
        {#if game && game.phase !== 'game-over'}
        <details class="settings-section" open>
          <summary>🎮 對局控制</summary>
          <div class="setting-row">
            <button class="toggle-btn restart-game-btn"
                    onclick={handleProposeRestartButton}
                    disabled={mode === 'online' && !canProposeRestart}>
              🔄 提議重新開局
            </button>
          </div>
          <div class="setting-hint">
            {#if mode === 'online'}
              {#if myRestartProposed}
                ⏳ 等待對方同意中... 倒數 {restartCountdown}s
              {:else if oppRestartProposed}
                ⚠️ 對方已提議重新開局，請於彈出視窗回應
              {:else}
                連線對戰：需對手同意。可多次提議
              {/if}
            {:else}
              將清空目前盤面，從擲幣決定先攻重新開始
            {/if}
          </div>
          <!-- v5.180 提議返回房間 (仿提議重新開局, 雙方同意後回房間選牌組) -->
          <div class="setting-row">
            <button class="toggle-btn restart-game-btn"
                    onclick={handleProposeReturnRoomButton}
                    disabled={mode === 'online' && !canProposeReturnRoom}>
              🚪 提議返回房間
            </button>
          </div>
          <div class="setting-hint">
            {#if mode === 'online'}
              {#if myReturnRoomProposed}
                ⏳ 等待對方同意中... 倒數 {returnRoomCountdown}s
              {:else if oppReturnRoomProposed}
                ⚠️ 對方已提議返回房間，請於彈出視窗回應
              {:else}
                雙方同意後回到房間選牌組介面 (需對手同意)
              {/if}
            {:else}
              回到首頁重新選擇對戰模式
            {/if}
          </div>
        </details>
        {/if}
      </div>
    </div>
  {/if}

  <!-- v4.60 對方提議 modal -->
  {#if oppRestartProposed && mode === 'online'}
    <div class="zoom-overlay restart-proposal-overlay">
      <div class="restart-proposal-modal" onclick={(e)=>e.stopPropagation()}>
        <h3>🔄 對手提議重新開局</h3>
        <p>對方希望從擲幣重新開始這場對戰。是否同意？</p>
        <p class="restart-countdown-text">倒數 {restartCountdown}s 後自動拒絕</p>
        <div class="restart-proposal-actions">
          <button class="restart-btn-accept" onclick={handleAcceptOppRestart}>✅ 同意</button>
          <button class="restart-btn-reject" onclick={handleRejectOppRestart}>❌ 拒絕</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- v4.60 我方等待 strip -->
  {#if myRestartProposed && mode === 'online'}
    <div class="restart-waiting-strip">
      <span>⏳ 等待對方同意重新開局... ({restartCountdown}s)</span>
      <button class="restart-cancel-btn" onclick={handleCancelMyRestart}>取消</button>
    </div>
  {/if}

  <!-- v4.60 拒絕 toast -->
  {#if restartRejectedToast}
    <div class="restart-rejected-toast">
      ❌ 對方拒絕了重新開局的提議
    </div>
  {/if}

  <!-- v5.180 提議返回房間 modal/strip/toast -->
  {#if oppReturnRoomProposed && mode === 'online'}
    <div class="zoom-overlay restart-proposal-overlay">
      <div class="restart-proposal-modal" onclick={(e)=>e.stopPropagation()}>
        <h3>🚪 對手提議返回房間</h3>
        <p>對方希望結束目前對戰返回房間，雙方可重新選擇牌組。是否同意？</p>
        <p class="restart-countdown-text">倒數 {returnRoomCountdown}s 後自動拒絕</p>
        <div class="restart-proposal-actions">
          <button class="restart-btn-accept" onclick={handleAcceptOppReturnRoom}>✅ 同意</button>
          <button class="restart-btn-reject" onclick={handleRejectOppReturnRoom}>❌ 拒絕</button>
        </div>
      </div>
    </div>
  {/if}
  {#if myReturnRoomProposed && mode === 'online'}
    <div class="restart-waiting-strip">
      <span>⏳ 等待對方同意返回房間... ({returnRoomCountdown}s)</span>
      <button class="restart-cancel-btn" onclick={handleCancelMyReturnRoom}>取消</button>
    </div>
  {/if}
  {#if returnRoomRejectedToast}
    <div class="restart-rejected-toast">
      ❌ 對方拒絕了返回房間的提議
    </div>
  {/if}

  <!-- ⭐⭐⭐v6.190 獎賞卡檢視（回放限定） —— 位置刻意放在
       `{#if isPortraitMobile && game}` … `{:else}` … `{/if}` 這組版面分支**之外**，
       手機直式與桌機共用同一個視窗（v6.167：畫在錯的分支＝有一種版面永遠顯示不出來）。
       ⚠⚠ 第一個條件永遠是 isTReplay：正式對戰／觀戰時這段 DOM 根本不存在。 -->
  {#if isTReplay && prizeViewOpen && game}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="zoom-overlay" onclick={closePrizeView}>
      <div class="zoom-modal discard-modal prize-view-modal" onclick={(e)=>e.stopPropagation()}>
        <button class="zoom-close" onclick={closePrizeView} aria-label="關閉">✕</button>
        <h3 class="discard-title">🎁 獎賞卡（回放限定）</h3>
        {#each [myPlayer, oppPlayer] as _pvp, _pvi (_pvi)}
          <div class="prize-view-side">
            <div class="prize-view-side-title">{_pvp?.name ?? (_pvi === 0 ? '下方玩家' : '上方玩家')}　剩 {_pvp?.prizes.length??0} 張</div>
            <div class="sel-grid">
              {#each dedupeByIid(_pvp?.prizes) as _pvc (_pvc.iid)}{@const _pvcard = getCard(_pvc.cardId)}
                {#if _pvcard}
                  <button class="sel-card" onclick={() => openZoom(_pvc.cardId, _pvc)}>
                    <img use:retryImg={_pvcard.imageUrl} src={_pvcard.imageUrl} alt={_pvcard.name} loading="lazy"
                      class:legend-half-l={twoCardStadiumHalfIndex(_pvp?.prizes, _pvc.iid, pool) === 0}
                      class:legend-half-r={twoCardStadiumHalfIndex(_pvp?.prizes, _pvc.iid, pool) === 1}/><span class="sel-name">{_pvcard.name}</span>
                  </button>
                {/if}
              {/each}
              {#if (_pvp?.prizes.length??0) === 0}<p class="sel-empty">（獎賞卡已全部取完）</p>{/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Zoom -->
  {#if zoomCard}
    <div class="zoom-overlay" onclick={closeZoom}>
      <div class="zoom-modal" onclick={(e)=>e.stopPropagation()}>
        {#if zoomStack.length > 0}
          <button class="zoom-back" onclick={popZoom} title="返回上一層">← 返回</button>
        {/if}
        <button class="zoom-close" onclick={closeZoom}>✕</button>
        <div class="zoom-scroll">
        <div class="zoom-body">
          <!-- v2.129：點擊 zoom-img 開全螢幕 lightbox -->
          <button class="zoom-img-btn" type="button" onclick={() => openLightboxImg(zoomCard!.imageUrl)} title="點擊放大">
            <img use:retryImg={{ url: zoomCard.imageUrl, width: 840 }} src={zoomCard.imageUrl} alt={zoomCard.name} class="zoom-img"/>
            <span class="zoom-img-hint">🔍</span>
          </button>
          <div class="zoom-info">
            <div class="zoom-name">{zoomCard.name}</div>
            <div class="zoom-badges">
              {#if zoomCard.hp}<span class="badge hp-badge">HP {zoomCard.hp}</span>{/if}
              {#if zoomCard.pokemonType}<span class="badge type-badge" style="background:{ENERGY_COLOR[zoomCard.pokemonType]}">{ENERGY_LABEL[zoomCard.pokemonType]}</span>{/if}
              {#if zoomCard.subtype}<span class="badge sub-badge">{zoomCard.subtype}</span>{/if}
              {#if zoomCard.regulationMark}<span class="badge mark-badge">{zoomCard.regulationMark}</span>{/if}
            </div>
            {#if zoomCard.evolvesFrom}<div class="zoom-meta">進化自：{zoomCard.evolvesFrom}</div>{/if}
            {#if zoomInst}
              {@const effMax = hpTotal(zoomInst)}
              {@const instHp = Math.max(0, effMax - zoomInst.damage)}
              {@const _allToolsZ = [...(zoomInst.toolAttached ? [zoomInst.toolAttached] : []), ...(zoomInst.extraTools ?? [])]}
              <!-- v4.03：場上狀態預設無條件展開（玩家要求手機版也預設打開） -->
              <details class="zoom-section" open>
                <summary class="zoom-section-summary">📍 場上狀態</summary>
              <div class="zoom-state">
                {#if effMax > 0}
                  <div class="state-row">
                    <span class="state-k">HP</span>
                    <span class="state-v">{instHp} / {effMax}{#if effMax > (zoomCard.hp ?? 0)}（道具 +{effMax - (zoomCard.hp ?? 0)}）{/if}{#if zoomInst.damage>0}（傷害 {zoomInst.damage}）{/if}</span>
                  </div>
                {/if}
                <div class="state-row">
                  <span class="state-k">附能</span>
                  <span class="state-v">
                    {#if zoomInst.energyAttached.length===0}無{:else}
                      {#each zoomInst.energyAttached as ec}{@const c2=getCard(ec.cardId)}<button class="state-ecard clickable" title="點擊放大：{c2?.name}" onclick={() => openZoom(ec.cardId, null)}>{c2?.name?.replace(/基本【|】能量/g,'') ?? '?'} 🔍</button>{/each}
                    {/if}
                  </span>
                </div>
                {#if _allToolsZ.length > 0}
                  <div class="state-row"><span class="state-k">🔧 道具</span><span class="state-v">{#each _allToolsZ as _tz}{@const _tcZ = getCard(_tz.cardId)}<button class="state-tool clickable" title="點擊放大：{_tcZ?.name ?? '道具'}" onclick={() => openZoom(_tz.cardId, null)}>{_tcZ?.name ?? '道具'} 🔍</button>{/each}</span></div>
                {/if}
                <!-- v5.071：補 secondaryStatus 雙狀態同顯（如「灼傷+混亂」時 status='confused' / secondaryStatus='burned'，
                     原本只顯示 status 漏掉 secondaryStatus；玩家手機回報只看到「混亂」沒看到「灼傷」）。 -->
                {#if zoomInst.status || zoomInst.secondaryStatus}
                  <div class="state-row"><span class="state-k">異常</span><span class="state-v">{#if zoomInst.status}<span class="status-piece">{
                    zoomInst.status==='poisoned'?'☠️ 中毒':
                    zoomInst.status==='burned'?'🔥 燒傷':
                    zoomInst.status==='asleep'?'💤 睡眠':
                    zoomInst.status==='confused'?'😵 混亂':
                    zoomInst.status==='paralyzed'?'⚡ 麻痺':zoomInst.status
                  }</span>{/if}{#if zoomInst.status && zoomInst.secondaryStatus}<span class="status-sep"> + </span>{/if}{#if zoomInst.secondaryStatus}<span class="status-piece">{
                    zoomInst.secondaryStatus==='poisoned' || zoomInst.tertiaryStatus === 'poisoned'?'☠️ 中毒':
                    zoomInst.secondaryStatus==='burned' || zoomInst.tertiaryStatus === 'burned'?'🔥 燒傷':
                    zoomInst.secondaryStatus==='asleep'?'💤 睡眠':
                    zoomInst.secondaryStatus==='confused'?'😵 混亂':
                    zoomInst.secondaryStatus==='paralyzed'?'⚡ 麻痺':zoomInst.secondaryStatus
                  }</span>{/if}</span></div>
                {/if}
                {#if zoomInst.evolvedFromStack && zoomInst.evolvedFromStack.length>0}
                  <div class="state-row">
                    <span class="state-k">進化鏈</span>
                    <span class="state-v state-chain">
                      {#each zoomInst.evolvedFromStack as pc}{@const c3=getCard(pc.cardId)}<button class="chain-node clickable" title="點擊放大：{c3?.name}" onclick={() => openZoom(pc.cardId, pc)}>{c3?.name ?? '?'}</button><span class="chain-arr">→</span>{/each}
                      <span class="chain-node chain-current">{zoomCard.name}</span>
                    </span>
                  </div>
                {/if}
                {#if zoomInst.abilityUsedThisTurn}
                  <div class="state-row"><span class="state-k">✨</span><span class="state-v">本回合已使用特性</span></div>
                {/if}
                {#if zoomInst.justPlaced}
                  <div class="state-row"><span class="state-k">🆕</span><span class="state-v">本回合才打出（無法進化）</span></div>
                {/if}
                {#if zoomInst.evolvedThisTurn}
                  <div class="state-row"><span class="state-k">🔺</span><span class="state-v">本回合剛進化（無法再進化）</span></div>
                {/if}
                {#if zoomInst.cantAttackThisTurn}
                  <div class="state-row"><span class="state-k">🚫</span><span class="state-v">下一回合無法攻擊</span></div>
                {/if}
              </div>
              </details>
            {/if}
            {#each zoomCard.abilities??[] as ab}
              <details class="zoom-section" open={!isPortraitMobile}>
                <summary class="zoom-section-summary"><span class="ability-label">特性</span> <strong>{ab.name}</strong></summary>
                <div class="zoom-ability"><p class="effect-text">{ab.effect ?? (ab as any).text}</p></div>
              </details>
            {/each}
            {#each zoomCard.attacks??[] as atk}
              {@const atkEffect = atk.effect ?? (atk as any).text ?? ''}
              <details class="zoom-section" open={!isPortraitMobile}>
                <summary class="zoom-section-summary">
                  <span class="cost-row">{#each atk.cost as e}<span class="epip" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>{/each}{#if atk.cost.length===0}<span class="no-cost">無消耗</span>{/if}</span>
                  <span class="atk-nm">⚔️ {atk.name}</span><span class="atk-dp">{atk.damage||'—'}</span>
                </summary>
                <div class="zoom-attack">
                  {#if atkEffect.trim()}<p class="effect-text">{atkEffect}</p>{:else}<p class="effect-text" style="color:#888;font-style:italic;">（無額外效果）</p>{/if}
                </div>
              </details>
            {/each}
            {#if zoomCard.rulesText}<div class="zoom-rules">{zoomCard.rulesText}</div>{/if}
            <div class="zoom-footer">
              {#if zoomCard.weakness}<span class="footer-item">弱點：<span class="epip sm" style="background:{ENERGY_COLOR[zoomCard.weakness.type]}">{ENERGY_LABEL[zoomCard.weakness.type]}</span> ×2</span>{/if}
              {#if zoomCard.retreatCost?.length}
                <span class="footer-item">撤退：{#each zoomCard.retreatCost as e}<span class="epip sm" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>{/each}</span>
              {:else if zoomCard.supertype==='Pokemon'}<span class="footer-item">撤退：免費</span>{/if}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- ══ 擲硬幣動畫 (Session 34) ══ -->
  {#if coinFlipStage !== 'done'}
    <div class="coin-flip-overlay" in:fade={{ duration: 250 }} out:fade={{ duration: 400 }}>
      <div class="coin-flip-box">
        {#if coinFlipStage === 'flipping'}
          <div class="coin flipping">🪙</div>
          <div class="coin-text">擲硬幣決定先後…</div>
        {:else}
          {@const firstName = game.players[game.firstPlayerIdx].name}
          <div class="coin revealed" in:scale={{ start: 0.3, duration: 500 }}>
            {game.firstPlayerIdx === 0 ? '☀️' : '🌙'}
          </div>
          <div class="coin-text coin-result" in:fade={{ delay: 200, duration: 400 }}>
            <strong>{firstName}</strong> 先手！
          </div>
          {#if game.mulliganCounts && (game.mulliganCounts[0] > 0 || game.mulliganCounts[1] > 0)}
            <div class="coin-sub" in:fade={{ delay: 500, duration: 400 }}>
              🔄 重抽懲罰：
              {#if game.mulliganCounts[0] > 0}{game.players[0].name} 重抽 {game.mulliganCounts[0]} 次，{game.players[1].name} 多抽 {game.mulliganCounts[0]} 張。{/if}
              {#if game.mulliganCounts[1] > 0}{game.players[1].name} 重抽 {game.mulliganCounts[1]} 次，{game.players[0].name} 多抽 {game.mulliganCounts[1]} 張。{/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  <!-- ══ v2.45 抽牌飛卡 overlay ══ -->
  {#if drawAnims.length > 0}
    <div class="draw-fly-overlay">
      {#each drawAnims as d (d.id)}
        <div class="draw-fly-card"
          style="
            left:{d.startX - d.width/2}px;
            top:{d.startY - d.height/2}px;
            width:{d.width}px;
            height:{d.height}px;
            --dx:{d.endX - d.startX}px;
            --dy:{d.endY - d.startY}px;
            animation-delay:{d.delay}ms;
            animation-duration:{d.duration}ms;
          ">
          <div class="card-back draw-fly-back"><span class="card-back-mark">?</span></div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- ══ v5.131 取得獎賞卡動畫 overlay — 從 prize → 中央 → 手牌 ══ -->
  {#if prizePickAnims.length > 0}
    <div class="prize-pick-overlay">
      {#each prizePickAnims as p (p.id)}
        {@const pc = pool.get(p.cardId)}
        <div class="prize-pick-card"
          style="
            left:{p.startX - 60}px;
            top:{p.startY - 84}px;
            --dx:{p.endX - p.startX}px;
            --dy:{p.endY - p.startY}px;
            animation-duration:{p.duration}ms;
          ">
          <!-- v5.137：對手取獎賞只顯示卡背，不暴露對手手牌（PTCG 隱私規則） -->
          {#if p.isMine && pc?.imageUrl}
            <img use:retryImg={pc.imageUrl} src={pc.imageUrl} alt={pc.name}/>
          {:else}
            <div class="card-back prize-pick-back"><span class="card-back-mark">?</span></div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- v2.129：全螢幕卡牌放大 lightbox（鏡射 /cards 樣式）—— 從 zoom-img 點擊或 ImageButton 觸發 -->
  {#if lightboxUrl}
    <div class="lightbox-overlay" role="dialog" aria-modal="true" aria-label="放大卡牌圖片"
      onclick={closeLightboxImg}>
      <img class="lightbox-img" use:retryImg={{ url: lightboxUrl, width: 900 }} src={lightboxUrl} alt="放大圖片" onclick={closeLightboxImg}/>
      <button class="lightbox-close" onclick={closeLightboxImg} aria-label="關閉">×</button>
    </div>
  {/if}

  <!-- v4.75 連線練習模式 — 對手請求悔棋 modal（顯示在被請求方的畫面）-->
  {#if mode === 'online' && game && roomData?.undoRequest && roomData.undoRequest.status === 'pending' && mySeatIdx >= 0 && mySeatIdx <= 1 && roomData.undoRequest.fromSeatIdx !== mySeatIdx}
    <div class="modal-overlay undo-modal-overlay" role="dialog" aria-modal="true" aria-label="對手請求悔棋">
      <div class="undo-request-modal">
        <h3>↩ 對手請求悔棋</h3>
        <p class="undo-action-desc">對方上一手：<b>{roomData.undoRequest.actionDesc}</b></p>
        <p class="muted">同意後雙方回到對方做這個動作之前的狀態。<br>不同意則此手悔棋按鈕消失，對方需做新動作才能再次請求。</p>
        <div class="undo-modal-btns">
          <button class="btn-primary undo-agree-btn" onclick={handleAgreeUndo}>✓ 同意悔棋</button>
          <button class="btn-secondary undo-reject-btn" onclick={handleRejectUndo}>✗ 拒絕</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- v4.21 對局結束可拖曳勝負視窗 — overlay 在戰鬥盤面上方 -->
  {#if game.phase === 'game-over' && game.winner !== null && game.winner !== undefined}
    {@const isWin = (
      mode === 'online' ? (myPlayerIndex === game.winner) :
      aiPlayerIndex !== null ? (game.winner === (1 - aiPlayerIndex)) :
      true
    )}
    <div class="gameover-modal"
      style:transform={`translate(calc(-50% + ${gameoverPanelPos.x}px), calc(-50% + ${gameoverPanelPos.y}px))`}>
      <div class="gameover-modal-header"
        onpointerdown={onGameoverHeaderDown}
        onpointermove={onGameoverHeaderMove}
        onpointerup={onGameoverHeaderUp}
        title="拖曳此處移動勝負視窗 — 可看到背後戰鬥盤最終狀態">
        <span class="gameover-modal-drag-hint">☰ 拖曳移動</span>
      </div>
      <div class="gameover-modal-body">
        <div class="gameover-icon {isWin ? 'win' : 'lose'}">
          {isWin ? '🏆' : '💔'}
        </div>
        <h1 class="gameover-title {isWin ? 'win' : 'lose'}">
          {isWin ? 'Victory!' : 'Defeat'}
        </h1>
        <p class="winner-text">
          {game.players[game.winner!].name} 獲勝！
        </p>
        <p class="muted">{game.winReason}</p>
        <div class="lobby-btns export-btns">
          <button class="btn-secondary" onclick={()=>exportLogAs('txt')} title="匯出純文字 log 供復盤">
            📄 匯出 log（.txt）
          </button>
          <button class="btn-secondary" onclick={()=>exportLogAs('json')} title="匯出結構化 log 供外部工具分析">
            🧾 匯出 log（.json）
          </button>
        </div>
        {#if isTournament}
          <div class="lobby-btns">
            <button class="btn-primary" onclick={tLeaveMatch}>🏆 返回賽事大廳</button>
          </div>
        {:else if mode === 'online' || roomCode}
          <div class="lobby-btns">
            <button
              class="btn-primary"
              class:rematch-ready={myRematchReady}
              onclick={toggleMyRematchReady}
              title={myRematchReady ? '點擊取消，回到「再來一局」狀態' : '點擊後等對手也按，雙方都按就重置房間'}
            >
              {#if myRematchReady}
                ✓ 已準備（取消）
              {:else}
                🔁 再來一局
              {/if}
            </button>
            <button class="btn-secondary" onclick={() => { game = null; leaveOnlineGame(); }}>離開房間</button>
          </div>
          {#if oppRematchReady && !myRematchReady}
            <p class="muted rematch-hint">💡 對手已準備再來一局，點選按鈕雙方都準備好就直接重啟對戰！</p>
          {:else if myRematchReady && !oppRematchReady}
            <p class="muted rematch-hint">⏳ 等待對手也按下「再來一局」...</p>
          {:else if myRematchReady && oppRematchReady}
            <p class="muted rematch-hint">🎉 雙方都已準備，房間即將重置...</p>
          {/if}
          <a href="{base}/" class="back-home-link">回首頁</a>
        {:else}
          <div class="lobby-btns">
            <button class="btn-primary" onclick={() => { game = null; }}>再來一局</button>
            <a href="{base}/" class="btn-secondary">回首頁</a>
          </div>
        {/if}
      </div>
    </div>
  {/if}

</div>
{/if}

<!-- ── v4.913 Auth modal (port 自牌組編輯器) ─────────────────────────── -->
{#if showAuthModal}
  <div class="pv-overlay" onclick={() => { showAuthModal = false; }}>
    <div class="pv-inner auth-modal" onclick={(e) => e.stopPropagation()}>
      <button class="pv-close" onclick={() => { showAuthModal = false; }} aria-label="關閉">×</button>

      <h3 class="modal-title">帳號管理</h3>

      <div class="auth-tabs">
        <button class:active={authTab === 'upgrade'} onclick={() => { authTab = 'upgrade'; authError = null; }}>
          {isAnonymous ? '🆕 建立新帳號' : '🆕 建立帳號'}
        </button>
        <button class:active={authTab === 'login'} onclick={() => { authTab = 'login'; authError = null; }}>
          🔑 登入現有帳號
        </button>
      </div>

      {#if authTab === 'upgrade'}
        {#if isAnonymous}
          <p class="auth-desc">建立帳號後，你目前的所有牌組將永久保存，換電腦也能繼續使用。</p>
        {:else}
          <p class="auth-desc">為其他裝置建立新帳號。</p>
        {/if}
        <div class="auth-form">
          <input type="email" placeholder="Email" bind:value={authEmail} onkeydown={(e) => e.key === 'Enter' && upgradeAccount()} />
          <input type="password" placeholder="密碼（至少 6 碼）" bind:value={authPassword} onkeydown={(e) => e.key === 'Enter' && upgradeAccount()} />
          {#if authError}<p class="auth-error">{authError}</p>{/if}
          <button class="small primary" onclick={upgradeAccount} disabled={authLoading}>
            {authLoading ? '處理中…' : isAnonymous ? '建立並綁定帳號' : '建立帳號'}
          </button>
        </div>
      {:else}
        {#if !forgotMode}
          <p class="auth-desc">登入後將從雲端載入該帳號的牌組。</p>
          <div class="auth-form">
            <input type="email" placeholder="Email" bind:value={authEmail} onkeydown={(e) => e.key === 'Enter' && loginWithEmail()} />
            <input type="password" placeholder="密碼" bind:value={authPassword} onkeydown={(e) => e.key === 'Enter' && loginWithEmail()} />
            {#if authError}<p class="auth-error">{authError}</p>{/if}
            <button class="small primary" onclick={loginWithEmail} disabled={authLoading}>
              {authLoading ? '登入中…' : '登入'}
            </button>
            <button class="auth-link" onclick={() => { forgotMode = true; authError = null; resetEmailSent = false; }}>
              忘記密碼？寄送重設信
            </button>
          </div>
        {:else}
          <p class="auth-desc">輸入註冊時的 Email，我們會寄送密碼重設信到該信箱。</p>
          <div class="auth-form">
            <input type="email" placeholder="Email" bind:value={authEmail} onkeydown={(e) => e.key === 'Enter' && sendResetEmail()} />
            {#if authError}<p class="auth-error">{authError}</p>{/if}
            {#if resetEmailSent}<p class="auth-success">重設信已寄出！請查收信箱（含垃圾郵件夾），點擊信中連結重設密碼。</p>{/if}
            <button class="small primary" onclick={sendResetEmail} disabled={authLoading}>
              {authLoading ? '寄送中…' : '寄送重設信'}
            </button>
            <button class="auth-link" onclick={() => { forgotMode = false; authError = null; resetEmailSent = false; }}>
              ← 返回登入
            </button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<!-- ── v4.913 Change-password modal ──────────────────────────────────── -->
{#if showChangePasswordModal}
  <div class="pv-overlay" onclick={() => { showChangePasswordModal = false; }}>
    <div class="pv-inner auth-modal" onclick={(e) => e.stopPropagation()}>
      <button class="pv-close" onclick={() => { showChangePasswordModal = false; }} aria-label="關閉">×</button>
      <h3 class="modal-title">🔑 更改密碼</h3>
      {#if cpSuccess}
        <p class="auth-success">密碼已成功更改！下次登入請使用新密碼。</p>
        <div class="auth-form">
          <button class="small primary" onclick={() => { showChangePasswordModal = false; }}>關閉</button>
        </div>
      {:else}
        <p class="auth-desc">更改密碼需要先輸入舊密碼確認身分。</p>
        <div class="auth-form">
          <input type="password" placeholder="舊密碼" bind:value={cpOldPassword} autocomplete="current-password" />
          <input type="password" placeholder="新密碼（至少 6 碼）" bind:value={cpNewPassword} autocomplete="new-password" />
          <input type="password" placeholder="再次輸入新密碼" bind:value={cpNewPasswordConfirm} autocomplete="new-password" onkeydown={(e) => e.key === 'Enter' && submitChangePassword()} />
          {#if cpError}<p class="auth-error">{cpError}</p>{/if}
          <button class="small primary" onclick={submitChangePassword} disabled={cpLoading}>
            {cpLoading ? '處理中…' : '確認更改密碼'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
{/if}
<style>
  /* 錦標賽大廳/提示（v0.4 伺服器權威）*/
  .lobby.tourn-lobby { max-width: 640px; }  /* v5.634 提高 specificity 蓋過 .lobby 的 700；統一大廳寬度並置中 */
  .tourn-field { display: block; text-align: left; margin: 14px auto; max-width: 360px; font-weight: 600; color: #cfe8cf; }
  .tourn-field .deck-select, .tourn-field .name-input { display: block; width: 100%; margin-top: 6px; padding: 10px; border-radius: 8px; border: 1px solid #4a6a4a; background: #142414; color: #eaf5ea; font-size: 1rem; box-sizing: border-box; }
  .tourn-join { margin-top: 8px; }
  .tourn-wait { color: #ffd35a; font-size: 1.05rem; margin: 22px 0; line-height: 1.6; }
  .tourn-toast { position: fixed; top: calc(8px + var(--safe-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 9999; background: #7a1f1f; color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 0.9rem; box-shadow: 0 2px 8px rgba(0,0,0,.4); max-width: 90vw; }
  .tourn-gate { color: #ffd35a; max-width: 360px; margin: 8px auto 4px; line-height: 1.5; }
  .tourn-who { color: #9fdca0; margin: 4px auto 10px; }
  /* v5.691 三分頁切換 */
  .tourn-tabs { display: flex; gap: 6px; max-width: 100%; margin: 6px auto 12px; }
  .tourn-tab { flex: 1; padding: 9px 6px; border: 1px solid #3a5a3a; border-radius: 9px; background: #102010; color: #9fdca0; font-size: .9rem; font-weight: 600; cursor: pointer; transition: .15s; }
  .tourn-tab:hover { background: #18301a; }
  .tourn-tab.active { background: linear-gradient(180deg,#2a5a3a,#1d4029); color: #eaffea; border-color: #6ab87a; box-shadow: 0 0 0 1px #6ab87a inset; }
  /* v5.692 對戰戰報 */
  .tourn-match-log { cursor: pointer; transition: background .12s, box-shadow .12s; border-color: #3a6a48; }
  .tourn-match-log:hover { background: #1c3320; box-shadow: 0 0 0 1px #5aa86a inset; }
  .mlog-modal { max-width: 680px; }
  .mlog-list { max-height: 62vh; overflow-y: auto; background: #0d140d; border: 1px solid #2a3a2a; border-radius: 8px; padding: 8px 10px; font-size: .82rem; line-height: 1.5; }
  .mlog-list .log-line { padding: 2px 0; border-bottom: 1px solid #161f16; word-break: break-word; }
  .mlog-list .log-line:last-child { border-bottom: none; }
  /* 排行榜 */
  .tourn-lb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
  .tourn-lb-card { border: 1px solid #4a6a4a; border-radius: 12px; padding: 12px 14px; background: #142414; }
  .tourn-lb-champ { grid-column: 1 / -1; }
  .tourn-lb-champ-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .tourn-lb-title { font-weight: 700; color: #ffd35a; margin-bottom: 8px; font-size: .98rem; }
  .tourn-lb-sub { font-weight: 600; color: #cfe0f8; margin-bottom: 5px; font-size: .85rem; }
  .tourn-lb-empty { color: #6a7a6a; font-size: .8rem; padding: 4px 0; }
  .tourn-lb-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #20301f; }
  .tourn-lb-row:last-child { border-bottom: none; }
  .tourn-lb-rank { flex: 0 0 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 50%; background: #24382a; color: #bfe; font-size: .78rem; font-weight: 700; }
  .tourn-lb-rank-1 { background: linear-gradient(180deg,#ffe082,#d4a017); color: #3a2a00; }
  .tourn-lb-rank-2 { background: linear-gradient(180deg,#e0e0e0,#9aa0a8); color: #2a2a2a; }
  .tourn-lb-rank-3 { background: linear-gradient(180deg,#e0a060,#a0682c); color: #2a1500; }
  .tourn-lb-name { flex: 1 1 auto; color: #eaffea; font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tourn-lb-cnt { flex: 0 0 auto; color: #9fdca0; font-size: .82rem; font-weight: 600; }
  /* v6.199 顯示筆數下拉：色票（#142414 底／#4a6a4a 框／#eaf5ea 字／8px 圓角）完全沿用
     .tourn-field .deck-select，只把版型從「整列填滿」換成「靠右內嵌」，不另做一套外觀。
     ⚠ 刻意不加任何 @media：這一列在窄螢幕靠 flex 自然收合，不需要手機分支。 */
  .tourn-lb-bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
  .tourn-lb-toplbl { color: #cfe8cf; font-size: .82rem; font-weight: 600; }
  .tourn-lb-topsel { padding: 5px 8px; border-radius: 8px; border: 1px solid #4a6a4a; background: #142414; color: #eaf5ea; font-size: .85rem; box-sizing: border-box; }
  /* 個人資料 */
  .tourn-pf-head { text-align: center; margin-bottom: 12px; }
  .tourn-pf-name { font-size: 1.25rem; font-weight: 700; color: #eaffea; }
  .tourn-pf-email { font-size: .8rem; color: #7a9a7a; }
  .tourn-pf-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; margin-bottom: 14px; }
  .tourn-pf-tile { border: 1px solid #4a6a4a; border-radius: 10px; padding: 9px 4px; background: #142414; text-align: center; }
  .tourn-pf-num { font-size: 1.3rem; font-weight: 700; color: #ffd35a; }
  .tourn-pf-lbl { font-size: .72rem; color: #9fdca0; margin-top: 2px; }
  .tourn-pf-events { border: 1px solid #4a6a4a; border-radius: 12px; padding: 12px 14px; background: #142414; }
  .tourn-pf-evrow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 6px 0; border-bottom: 1px solid #20301f; }
  .tourn-pf-evrow:last-child { border-bottom: none; }
  .tourn-pf-evname { color: #eaffea; font-size: .9rem; font-weight: 600; }
  .tourn-pf-evmeta { color: #9fdca0; font-size: .78rem; }
  /* ══ v6.032 賽事通知設定卡（個人資料分頁）══
     ⚠note 的狀態 class 刻意叫 nt-warn / nt-ok 而不是 warn / ok：
       本檔已有全域的 .warn（{#if tError}<p class="warn">）與其他 ok，避免選擇器互撞。 */
  .tourn-nt { border: 1px solid #4a6a4a; border-radius: 12px; padding: 12px 14px; background: #142414; margin-bottom: 14px; }
  .tourn-nt-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .tourn-nt-title { color: #eaffea; font-size: .95rem; font-weight: 700; }
  .tourn-nt-badge { font-size: .7rem; padding: 2px 8px; border-radius: 999px; border: 1px solid #444; }
  .tourn-nt-badge.nt-on { color: #9fdca0; border-color: #4a6a4a; background: #1a2e1a; }
  .tourn-nt-badge.nt-off { color: #9aa3b0; border-color: #444; background: #1e1e1e; }
  .tourn-nt-badge.nt-server-missing, .tourn-nt-badge.nt-blocked { color: #ffb35a; border-color: #7a5a2a; background: #2e2414; }
  .tourn-nt-badge.nt-ios, .tourn-nt-badge.nt-unsupported { color: #ff9a9a; border-color: #7a3a3a; background: #2e1414; }
  .tourn-nt-toggle { display: flex; align-items: flex-start; gap: 8px; color: #cfe8cf; font-size: .85rem; cursor: pointer; }
  .tourn-nt-toggle input { margin-top: 2px; flex: none; }
  /* v6.035 子項：視覺上從屬於上面的總開關 */
  .tourn-nt-sub { margin-top: 8px; padding-left: 18px; border-left: 2px solid #2c402c; font-size: .82rem; }
  .tourn-nt-sub input:disabled + span { opacity: .5; }
  .tourn-nt-note { font-size: .8rem; margin: 8px 0 0; line-height: 1.5; }
  .tourn-nt-note.nt-ok { color: #9fdca0; }
  .tourn-nt-note.nt-warn { color: #e0a050; }
  .tourn-nt-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .tourn-nt-msg { font-size: .8rem; margin: 8px 0 0; color: #e0a050; line-height: 1.5; }
  .tourn-nt-msg.ok { color: #7cc4ff; }
  .tourn-nt-x { margin-left: 6px; padding: 0 6px; font-size: .75rem; border: 1px solid #666; background: #2a2a2a; color: #ccc; border-radius: 4px; cursor: pointer; }
  .tourn-nt-adv { margin-top: 10px; border-top: 1px dashed #2c402c; padding-top: 8px; }
  .tourn-nt-adv summary { font-size: .75rem; color: #7a9a7a; cursor: pointer; }
  .tourn-nt-diag { font-size: .72rem; color: #9aa3b0; margin: 6px 0 0; word-break: break-all; }
  @media (max-width: 560px) { .tourn-lb-champ-cols { grid-template-columns: 1fr; } }
  .tourn-logout { margin-left: 8px; padding: 2px 10px; font-size: 0.8rem; border: 1px solid #888; background: #2a2a2a; color: #ddd; border-radius: 6px; cursor: pointer; }
  .tourn-event { border: 1px solid #4a6a4a; border-radius: 10px; padding: 10px 14px; margin: 10px auto; max-width: 100%; background: #142414; }  /* v5.634 填滿欄位、邊緣對齊 */
  .tourn-event h3 { margin: 0 0 4px; }
  .tourn-evstat { color: #cfe8cf; font-size: 0.88rem; }
  .reg-ok { color: #7CFC9A; font-weight: 600; }
  .tourn-chat { max-width: 100%; margin: 10px auto; border: 1px solid #3a5a3a; border-radius: 10px; background: #0f1c0f; overflow: hidden; text-align: left; }
  .tourn-chat-head { background: #1a2e1a; padding: 6px 12px; font-weight: 600; color: #cfe8cf; }
  .tourn-chat-msgs { height: 200px; overflow-y: auto; padding: 8px 12px; font-size: 0.88rem; line-height: 1.5; display: flex; flex-direction: column; }
  .tcmsg { color: #e8f0e8; word-break: break-word; }
  .tcmsg.muted { color: #888; }
  .tcmsg.tcsys { color: #ffd35a; }
  .tcmsg.tcsys .tcname { color: #ffd35a; } /* v5.579 系統通知的「系統」名字也用黃色(與內容一致)，跟玩家發言的藍色名區分 */
  /* v5.650 系統播報分類上色（亮色系，避免太暗傷眼）；同時套用大廳(.tcmsg)與浮動/對戰中(.chat-msg） */
  .tcmsg.tcsys.sc-reg, .tcmsg.tcsys.sc-reg .tcname, .chat-msg.sc-reg .chat-text, .chat-msg.sc-reg .chat-name { color: #5fd0ff; }
  .tcmsg.tcsys.sc-bracket, .tcmsg.tcsys.sc-bracket .tcname, .chat-msg.sc-bracket .chat-text, .chat-msg.sc-bracket .chat-name { color: #7ee787; }
  .tcmsg.tcsys.sc-champ, .tcmsg.tcsys.sc-champ .tcname, .chat-msg.sc-champ .chat-text, .chat-msg.sc-champ .chat-name { color: #ffd84d; font-weight: 800; text-shadow: 0 0 7px rgba(255,200,60,0.5); }
  .tcmsg.tcsys.sc-forfeit, .tcmsg.tcsys.sc-forfeit .tcname, .chat-msg.sc-forfeit .chat-text, .chat-msg.sc-forfeit .chat-name { color: #ffae42; }
  .tcmsg.tcsys.sc-timeout, .tcmsg.tcsys.sc-timeout .tcname, .chat-msg.sc-timeout .chat-text, .chat-msg.sc-timeout .chat-name { color: #ff8c6b; }
  .tcmsg.tcsys.sc-cancel, .tcmsg.tcsys.sc-cancel .tcname, .chat-msg.sc-cancel .chat-text, .chat-msg.sc-cancel .chat-name { color: #ff6f7d; }
  .tcmsg.tcsys.sc-admin, .tcmsg.tcsys.sc-admin .tcname, .chat-msg.sc-admin .chat-text, .chat-msg.sc-admin .chat-name { color: #c5a3ff; }
  .tctime { color: #667; font-size: 11px; margin-right: 5px; font-variant-numeric: tabular-nums; }
  .tcname { color: #7fc7ff; font-weight: 600; }
  .tcadmin .tcname { color: #ff7a3d; font-weight: 800; text-shadow: 0 0 6px rgba(255,122,61,0.5); }
  .tourn-idle-warn { position: fixed; top: calc(8px + var(--safe-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 200; background: rgba(40,30,10,0.95); color: #ffd35a; border: 1px solid #a80; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 700; box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
  /* v6.156「我還在」確認框：置中偏下，避開頂部的 tourn-idle-warn 與底部手牌列 */
  .tourn-still-here { position: fixed; left: 50%; bottom: calc(92px + var(--safe-bottom, 0px)); transform: translateX(-50%); z-index: 9998; width: min(92vw, 360px); background: rgba(40,18,18,0.97); color: #ffe0e0; border: 2px solid #e05a5a; border-radius: 12px; padding: 12px 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.6); text-align: center; }
  .tourn-still-here .tsh-title { font-size: 15px; font-weight: 800; color: #ff9a9a; margin-bottom: 4px; }
  .tourn-still-here .tsh-body { font-size: 13px; line-height: 1.5; margin-bottom: 10px; }
  .tourn-still-here .tsh-body strong { color: #ffd35a; font-size: 17px; }
  .tourn-still-here .tsh-btn { width: 100%; padding: 10px 0; border: none; border-radius: 8px; background: #d64545; color: #fff; font-size: 15px; font-weight: 800; cursor: pointer; }

  /* v6.160 報到版本閘視窗 */
  .tourn-vergate-mask { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.62); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .tourn-vergate { width: min(94vw, 420px); background: #1e2530; color: #e8eef6; border: 2px solid #4a8fd6; border-radius: 14px; padding: 18px 18px 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.65); text-align: center; }
  .tourn-vergate .tvg-title { font-size: 17px; font-weight: 800; color: #8fc6ff; margin-bottom: 8px; }
  .tourn-vergate .tvg-body { font-size: 13.5px; line-height: 1.65; margin-bottom: 14px; text-align: left; }
  .tourn-vergate .tvg-body strong { color: #ffd35a; }
  .tourn-vergate .tvg-note { display: block; margin-top: 6px; font-size: 12px; color: #9fb0c4; }
  .tourn-vergate .tvg-btn { width: 100%; padding: 11px 0; border-radius: 9px; font-size: 15px; font-weight: 800; cursor: pointer; border: none; }
  .tourn-vergate .tvg-btn:disabled { opacity: .55; cursor: wait; }
  .tourn-vergate .tvg-primary { background: #3d84d6; color: #fff; margin-bottom: 8px; }
  .tourn-vergate .tvg-ghost { background: transparent; color: #a8bccf; border: 1px solid #46566b; font-weight: 600; font-size: 13.5px; }
  .tourn-still-here .tsh-btn:disabled { opacity: 0.6; cursor: default; }
  .tourn-still-here .tsh-note { margin-top: 8px; font-size: 12px; color: #ffd35a; }
  .tourn-coin-hint { display: block; color: #889; font-size: 11px; margin-top: 3px; }
  .tourn-chat-input { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #2a3a2a; }
  .tourn-chat-input input { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid #4a6a4a; background: #142414; color: #eaf5ea; }
  /* v5.584 進入對戰按鈕：大、橘色漸層、脈動發光，醒目好按 */
  .tourn-enter-btn {
    display: block; width: 100%; margin: 10px 0 4px; padding: 16px 20px;
    font-size: 1.25rem; font-weight: 800; letter-spacing: 1px;
    color: #fff; border: 2px solid #ffd35a; border-radius: 12px; cursor: pointer;
    background: linear-gradient(135deg, #e8531a, #ff8c00);
    box-shadow: 0 0 0 0 rgba(255,140,0,.55), 0 6px 18px rgba(0,0,0,.45);
    text-shadow: 0 1px 2px rgba(0,0,0,.4);
    animation: tournEnterPulse 1.3s ease-in-out infinite;
  }
  .tourn-enter-btn:hover { filter: brightness(1.08); }
  .tourn-enter-btn:active { transform: scale(.98); }
  .tourn-enter-btn:disabled { opacity: .6; cursor: default; animation: none; }
  @keyframes tournEnterPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,140,0,.55), 0 6px 18px rgba(0,0,0,.45); transform: scale(1); }
    50% { box-shadow: 0 0 20px 7px rgba(255,140,0,0), 0 6px 18px rgba(0,0,0,.45); transform: scale(1.035); }
  }
  .tourn-bracket { max-width: 100%; margin: 12px auto; border: 1px solid #3a4a6a; border-radius: 10px; background: #0f1420; padding: 10px 12px; text-align: left; }
  .tourn-bracket-head { font-weight: 600; color: #cfe0f8; margin-bottom: 8px; }
  /* v6.177 「更新中」輕量提示：inline、字級縮小、不換行、不佔額外高度 ⇒ 不會造成版面跳動 */
  .tourn-stale { margin-left: 8px; font-size: 11px; font-weight: 400; color: #8fa3c4; white-space: nowrap; }
  .tourn-hof { border-color: #6a5a2a; background: #16120a; }
  .tourn-hof .tourn-bracket-head { color: #ffd35a; }
  .tourn-hof-row { display: flex; align-items: baseline; gap: 8px; padding: 4px 0; border-bottom: 1px solid #2a2414; }
  .tourn-hof-row:last-child { border-bottom: none; }
  .tourn-hof-trophy { font-size: 15px; }
  .tourn-hof-name { font-weight: 700; color: #ffe79a; }
  .tourn-hof-meta { color: #9a8d6a; font-size: 12px; }
  .tourn-hof-row.tourn-hof-clickable { cursor: pointer; }
  .tourn-hof-row.tourn-hof-clickable:hover { background: #1f1a0c; border-radius: 6px; }
  .tourn-hof-go { margin-left: auto; color: #ffd35a; font-size: 12px; white-space: nowrap; }
  .hof-modal-backdrop { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.62); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .hof-modal { background: #0f1420; border: 1px solid #3a4a6a; border-radius: 12px; padding: 14px; max-width: 560px; width: 100%; max-height: 86vh; overflow-y: auto; box-shadow: 0 8px 30px rgba(0,0,0,.6); }
  .hof-modal-x { float: right; background: transparent; border: none; color: #cfe0f8; font-size: 1.15rem; cursor: pointer; line-height: 1; }
  .tourn-mymatch { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #1a2440; border: 1px solid #3a5a8a; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .tourn-rounds { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 4px; }
  .tourn-round { width: 100%; }
  /* v5.590 賽程翻頁 */
  .tourn-bracket-pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0 10px; }
  .tourn-pg-btn { background: #1a2440; color: #cfe0f8; border: 1px solid #3a5a8a; border-radius: 7px; padding: 5px 12px; cursor: pointer; font-size: .85rem; }
  .tourn-pg-btn:disabled { opacity: .4; cursor: default; }
  .tourn-pg-title { font-weight: 700; color: #ffd35a; font-size: 1rem; }
  .tourn-pg-cur { color: #7ee0a0; font-size: .78rem; font-weight: 600; }
  .tourn-round-title { font-size: 0.82rem; color: #8aa0c8; margin-bottom: 6px; text-align: center; }
  /* v5.595 賽程單場改單列橫排：玩家A 〔VS〕 玩家B，grid 三欄置中、贏家高亮 */
  .tourn-match { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; background: #141b2a; border: 1px solid #2a3a55; border-radius: 8px; padding: 7px 12px; margin-bottom: 8px; font-size: 0.9rem; }
  .tourn-match.mine { border-color: #d8b24a; box-shadow: 0 0 0 1px #d8b24a55; }
  .tourn-match.done { opacity: 0.92; }
  .tourn-match.bye { opacity: 0.85; }
  .tourn-match .tm-side { padding: 4px 8px; color: #c8d4e8; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tourn-match .tm-p1 { text-align: right; }
  .tourn-match .tm-p2 { text-align: left; }
  .tourn-match .tm-side.win { color: #aef0b0; font-weight: 700; background: #1d3a1d; }
  .tourn-match .tm-vs { text-align: center; font-size: 0.7rem; font-weight: 700; color: #9ab4e0; background: #1a2440; border: 1px solid #3a5a8a; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
  .tourn-match .tm-vs-spec { cursor: pointer; color: #7ee0a0; background: #123020; border-color: #2e6a3e; font-family: inherit; line-height: 1.2; }
  .tourn-match .tm-vs-spec:hover { background: #1a4a2a; color: #aef0b0; }
  .tourn-match .tm-vs-spec:disabled { opacity: .5; cursor: default; }
  .tourn-match .tm-vs-replay { cursor: pointer; color: #ffcf6b; background: #2e2410; border-color: #6a5a2e; font-family: inherit; line-height: 1.2; }
  .tourn-match .tm-vs-replay:hover { background: #4a3a1a; color: #ffe0a0; }
  .treplay-bar { position: sticky; top: 0; z-index: 500; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; background: #0f1730; border-bottom: 2px solid #3a5a8a; padding: 8px 12px; box-shadow: 0 3px 12px rgba(0,0,0,.5); }
  .treplay-bar .treplay-title { font-weight: 700; color: #cfe0f8; font-size: .9rem; flex: 1 1 160px; min-width: 140px; }
  .treplay-oldfmt { font-size: .72rem; color: #f0c674; background: rgba(240,198,116,.12); border: 1px solid rgba(240,198,116,.35); border-radius: 5px; padding: 2px 7px; white-space: nowrap; cursor: help; }
  .treplay-bar .treplay-nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .treplay-bar .treplay-step { color: #ffd35a; font-weight: 700; font-size: .85rem; white-space: nowrap; padding: 0 4px; }
  .treplay-btn { background: #1a2440; color: #cfe0f8; border: 1px solid #3a5a8a; border-radius: 7px; padding: 5px 10px; cursor: pointer; font-size: .82rem; white-space: nowrap; }
  .treplay-btn:disabled { opacity: .4; cursor: default; }
  .treplay-btn:hover:not(:disabled) { background: #24345a; }
  /* v5.953 手機版回放導覽浮層 — 只在 isPortraitMobile 手機分支渲染(是 <MobilePortraitBattle/> 的兄弟節點)。
     position:fixed 蓋在 .mp-top + 計時細條之上、不佔文檔流→對手機盤面零位移。桌機 .treplay-bar 不動。 */
  .treplay-mob {
    position: fixed; top: 0; left: 0; right: 0; z-index: 80;
    display: flex; align-items: stretch; gap: 4px;
    padding: calc(var(--safe-top, 0px) + 4px) max(var(--safe-right, 0px), 6px) 4px max(var(--safe-left, 0px), 6px);
    background: #0f1730; border-bottom: 2px solid #3a5a8a; box-shadow: 0 3px 12px rgba(0,0,0,.5);
  }
  .treplay-mob-btn {
    background: #1a2440; color: #cfe0f8; border: 1px solid #3a5a8a; border-radius: 8px;
    min-height: 44px; padding: 4px 6px; font-size: .78rem; white-space: nowrap;
    cursor: pointer; touch-action: manipulation; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center;
  }
  .treplay-mob-btn:disabled { opacity: .4; cursor: default; }
  .treplay-mob-main { flex: 1 1 52px; min-width: 52px; font-weight: 700; }
  .treplay-mob-exit { color: #f8b8b8; border-color: #6a3a3a; }
  .treplay-mob-step {
    flex: 0 1 auto; min-width: 0; color: #ffd35a; font-weight: 700; font-size: .68rem; line-height: 1.1;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
    display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 2px;
  }
  .tourn-return-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(18px + var(--safe-bottom, 0px)); z-index: 9999; }
  .tourn-return-bar button { box-shadow: 0 4px 14px #000a; }
  .tourn-auth-btns { display: flex; gap: 10px; justify-content: center; margin-top: 6px; }
  /* v5.225 對手掛機警告 banner */
  /* ⭐⭐⭐ v6.187：這條 banner 貼齊螢幕最上緣(top:0)，在 iPhone PWA(viewport-fit=cover)下
       整條(高度僅約 41px)都落在動態島的 59px 安全區裡 → 玩家**按不到**「宣告對手棄權獲勝」，
       等於無法宣告獲勝。改成 padding-top 讓開 var(--safe-top)（單一來源見 +layout.svelte）。
     ⚠ z-index 由 1000 提到 100000：同樣貼 top:0 的 .admin-broadcast-bar(99999) 與
       .tourn-alert-banner(99990) 會蓋在它上面；這顆鈕影響勝負，必須在最上層。 */
  .opp-inactive-banner {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: calc(10px + var(--safe-top, 0px)) max(20px, var(--safe-right, 0px)) 10px max(20px, var(--safe-left, 0px));
    background: #fbbf24;
    color: #1f1f1f;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .opp-inactive-text { font-size: 15px; }
  .opp-inactive-btn {
    /* v6.187：原本 6px padding + 15px 字 ≈ 33px 高，小於 Apple HIG 建議的 44px 最小觸控目標 */
    padding: 8px 16px;
    min-height: 44px;
    touch-action: manipulation;
    background: #dc2626;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-weight: 700;
    cursor: pointer;
  }
  .opp-inactive-btn:hover { background: #b91c1c; }

  /* v5.225 確認 modal */
  .forfeit-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .forfeit-modal {
    background: #fff;
    padding: 24px 28px;
    border-radius: 8px;
    max-width: 420px;
    width: 90%;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  .forfeit-title {
    margin: 0 0 12px;
    font-size: 18px;
    color: #1f1f1f;
  }
  .forfeit-desc {
    margin: 0 0 20px;
    font-size: 14px;
    color: #4b5563;
    line-height: 1.5;
  }
  .forfeit-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }
  .forfeit-confirm {
    padding: 8px 16px;
    background: #dc2626;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
  }
  .forfeit-confirm:hover { background: #b91c1c; }
  .forfeit-cancel {
    padding: 8px 16px;
    background: #e5e7eb;
    color: #1f1f1f;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .forfeit-cancel:hover { background: #d1d5db; }
  /* v2.144：html + body 背景色改由頂端 svelte:head 動態注入，避免污染其他頁面 */

  /* v2.164 reorder-deck-top — 排序牌庫頂 N 張 UI */
  .reorder-deck-wrap { display:flex; flex-direction:column; gap:0.7rem; padding:0.5rem 0; max-height:60vh; overflow-y:auto; }
  .reorder-section-title { font-weight:700; color:#cce5cc; margin-bottom:0.3rem; font-size:0.95rem; }
  .reorder-list { display:flex; flex-direction:column; gap:0.3rem; }
  .reorder-item { display:flex; align-items:center; gap:0.4rem; background:#2a3a2a; border:1px solid #3a5a3a; border-radius:6px; padding:0.35rem 0.5rem; }
  .reorder-item-discard { background:#3a2a2a; border-color:#5a3a3a; opacity:0.85; }
  .reorder-pos { font-weight:700; color:#88cc88; min-width:1.8rem; }
  .reorder-name { flex:1; color:#f0f0f0; font-size:0.95rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .reorder-btn { background:#3a5a3a; border:1px solid #5a7a5a; color:#fff; cursor:pointer; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.95rem; }
  .reorder-btn:hover:not(:disabled) { background:#4a6a4a; }
  .reorder-btn:disabled { opacity:0.4; cursor:not-allowed; }
  .reorder-btn-discard { background:#5a3a3a; border-color:#7a5a5a; }
  .reorder-btn-discard:hover { background:#6a4a4a; }
  .reorder-empty { color:#888; font-style:italic; padding:0.4rem 0.5rem; }

  /* ════ Lobby / Setup ════ */
  /* v4.491：margin top 改為 calc(1rem + env(safe-area-inset-top, 0)) 比照 cards 標準，避開 iOS 動態島／瀏海。
     Desktop 上 env() = 0 不影響；iOS 上自動補上動態島高度（~47px）。 */
  .lobby,.setup-screen{ max-width:700px; margin: calc(1rem + var(--safe-top, 0px)) auto 2rem; padding:1.5rem; font-family:system-ui,'Microsoft JhengHei',sans-serif; color:#f0f0f0; }
  /* v5.576：錦標賽頁回到首頁鈕；padding-top 再加 safe-area，iOS 動態島／瀏海不會擋到、好按 */
  /* v5.585 跨房入場提醒橫幅 */
  .tourn-alert-banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 99990;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center;
    /* ⚠ v6.187 修：原本寫成 `padding: 10px 14px calc(10px + env(safe-area-inset-top,0))`
         —— 三值 padding 的第三個是**下**邊，safe-area 加錯邊，橫幅內容照樣被動態島蓋住。 */
    padding: calc(10px + var(--safe-top, 0px)) max(14px, var(--safe-right, 0px)) 10px max(14px, var(--safe-left, 0px));
    background: linear-gradient(135deg, #b8341a, #e8801a); color: #fff;
    box-shadow: 0 3px 14px rgba(0,0,0,.5); font-weight: 700;
    animation: tournAlertPulse 1.2s ease-in-out infinite;
  }
  .tourn-alert-txt { font-size: 1rem; }
  .tourn-alert-go {
    background: #fff; color: #c0392b; text-decoration: none; font-weight: 800;
    padding: 7px 16px; border-radius: 9px; border: 2px solid #ffd35a; white-space: nowrap;
  }
  .tourn-alert-go:hover { filter: brightness(.96); }
  .tourn-alert-x { background: transparent; border: none; color: #fff; font-size: 1.1rem; cursor: pointer; opacity: .85; }
  @keyframes tournAlertPulse { 0%,100% { background: linear-gradient(135deg, #b8341a, #e8801a); } 50% { background: linear-gradient(135deg, #d63a1e, #ffa033); } }
  /* v5.585 開賽倒數框 */
  .tourn-cdbox {
    margin: 10px auto; max-width: 360px; padding: 10px 14px;
    border: 2px solid #ffd35a; border-radius: 12px; background: rgba(255,170,40,.10); text-align: center;
  }
  .tourn-cdbox-label { font-size: .85rem; color: #ffd9a0; margin-bottom: 2px; }
  .tourn-cdbox-time { font-size: 1.9rem; font-weight: 800; letter-spacing: 2px; color: #ffd35a; font-variant-numeric: tabular-nums; }
  .tourn-cdbox.urgent { border-color: #ff6a4d; background: rgba(255,80,50,.14); animation: tournCdPulse 1s ease-in-out infinite; }
  .tourn-cdbox.urgent .tourn-cdbox-time { color: #ff8c6e; }
  @keyframes tournCdPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,90,60,.4); } 50% { box-shadow: 0 0 14px 3px rgba(255,90,60,0); } }
  .tourn-topbar { margin: 0 0 14px; padding-top: var(--safe-top, 0px); text-align: left; }
  .tourn-home-btn { display: inline-block; padding: 10px 18px; background: #2a3a4a; color: #cfe0f8; border: 1px solid #4a6a8a; border-radius: 9px; text-decoration: none; font-size: 14px; font-weight: 600; }
  .tourn-home-btn:active, .tourn-home-btn:hover { background: #36495d; }
  .lobby h1{ font-size:1.8rem; margin-bottom:1rem; }
  .lobby-subtitle{ color:#9aa; font-size:0.85rem; margin:-0.5rem 0 0.8rem; text-align:center; }
  .back{ color:#88ccff; font-size:0.9rem; text-decoration:none; display:inline-block; margin-bottom:1rem; }
  .back:hover{ text-decoration:underline; }
  .back-btn{ background:none; border:none; color:#88ccff; font-size:0.9rem; cursor:pointer; padding:0; margin-bottom:1rem; }
  .back-btn:hover{ text-decoration:underline; }
  .muted{ color:#aaa; font-size:0.9rem; }
  .warn{ color:#f0b040; }

  /* 模式選擇卡片 */
  .mode-cards{ display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin:1.5rem 0; }
  .mode-cards.compact{ max-width:500px; }
  .mode-card{
    background:#2a3a2a; border:1px solid #3a5a3a; border-radius:12px;
    padding:1.5rem 1rem; display:flex; flex-direction:column; align-items:center; gap:0.5rem;
    cursor:pointer; transition:background 0.15s,border-color 0.15s; color:#f0f0f0;
    position:relative;
  }
  .mode-card:hover:not(:disabled){ background:#3a4a3a; border-color:#5a8a5a; }
  .mode-card:disabled{ opacity:0.5; cursor:not-allowed; }
  .mode-card.online{ border-color:#4a5a8a; }
  .mode-card.online:hover:not(:disabled){ background:#2a3a5a; border-color:#6a7aaa; }
  .mode-icon{ font-size:2.2rem; }
  .mode-title{ font-size:1.05rem; font-weight:700; color:#fff; }
  .mode-desc{ font-size:0.82rem; color:#aaa; text-align:center; }
  .mode-badge{ position:absolute; top:0.6rem; right:0.6rem; background:#2a5aaa; color:#adf; font-size:0.65rem; font-weight:700; padding:0.15rem 0.4rem; border-radius:10px; }

  /* 本機 Lobby */
  /* v4.994: 預組 toggle 樣式（本機 + 線上對戰共用） */
  .preset-toggle-row {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.5rem 0 0;
    padding: 0.4rem 0.7rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid #3a5a3a;
    border-radius: 6px;
    color: #aaccaa;
    font-size: 0.85rem;
    cursor: pointer;
    user-select: none;
  }
  .preset-toggle-row input { accent-color: #8a4aee; cursor: pointer; }
  .player-setup{ display:grid; grid-template-columns:1fr auto 1fr; gap:1rem; align-items:center; margin:1.5rem 0; }
  .setup-card{ background:#2a3a2a; border:1px solid #3a5a3a; border-radius:10px; padding:1rem; display:flex; flex-direction:column; gap:0.6rem; }
  .setup-card h2{ margin:0; font-size:1rem; color:#aaffaa; }
  /* v4.983: 玩家 2 header — h2 與 AI toggle 並排，使兩卡片高度一致 */
  .setup-card-header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .setup-card-header h2 { margin: 0; }
  .name-input,.setup-card select{ padding:0.45rem 0.6rem; border:1px solid #4a6a4a; border-radius:6px; background:#1a2a1a; color:#f0f0f0; font:inherit; }
  .vs-badge{ font-size:1.5rem; font-weight:700; color:#f0b040; text-align:center; }

  /* 線上 Lobby */
  .online-form{ background:#1e2e1e; border:1px solid #3a5a3a; border-radius:10px; padding:1.25rem; display:flex; flex-direction:column; gap:0.75rem; max-width:420px; }
  .online-form h2{ margin:0; color:#aaffaa; font-size:1rem; }
  .online-form label{ display:flex; flex-direction:column; gap:0.3rem; font-size:0.85rem; color:#ccc; }
  .online-form select{ padding:0.4rem 0.6rem; border:1px solid #4a6a4a; border-radius:6px; background:#1a2a1a; color:#f0f0f0; font:inherit; }
  .code-input{ text-transform:uppercase; letter-spacing:0.25em; font-size:1.2rem; font-weight:700; text-align:center; max-width:120px; }
  .form-btns{ display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.25rem; }

  /* 開放房間列表 */
  .open-rooms-section{ background:#162616; border:1px solid #2a4a2a; border-radius:8px; padding:.7rem .9rem; }
  .open-rooms-section h3{ margin:0 0 .5rem; font-size:.95rem; color:#aaffcc; }
  .small{ font-size:.8rem; }
  /* v6.114 大廳房間列改「卡片式多行」：原本一列硬塞 6 個元素、單行 flex 又沒有 flex-wrap，
     手機（375px）下房名會被壓成幾個字、其餘元素互相擠爆。改成
       第一行 or-main（房名 + 標籤 + 動作鈕）／第二行 or-meta（房主・房齡・房號・牌組原型）
     每一行各自 flex-wrap，手機自然折行。 */
  .open-room-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.4rem; max-height:420px; overflow-y:auto; }
  .open-room-row{ display:flex; flex-direction:column; align-items:stretch; gap:.3rem; padding:.5rem .75rem; background:#1a2a1a; border:1px solid #3a5a3a; border-radius:6px; }
  .or-main{ display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
  .or-meta{ display:flex; align-items:center; gap:.45rem; flex-wrap:wrap; font-size:.8rem; color:#9a9a9a; }
  .or-act{ margin-left:auto; }
  .or-hint{ font-size:.75rem; color:#e0b060; }
  .or-host{ flex:1; min-width:6rem; font-weight:600; color:#f0f0f0; word-break:break-word; }
  .or-code{ font-family:monospace; letter-spacing:.15em; color:#aaf; font-size:.85rem; }
  /* v6.115 牌組原型標籤（名稱來自伺服器比對 admin 的「牌組原型」規則） */
  .or-arch{ color:#ffd97a; font-weight:600; }
  .or-vs{ color:#c4a84a; margin:0 .15rem; }
  .btn-sm{ padding:.3rem .8rem; border:none; border-radius:5px; cursor:pointer; font-size:.85rem; }
  .btn-sm.primary{ background:#3a7a3a; color:#fff; }
  .btn-sm.primary:hover:not(:disabled){ background:#4a9a4a; }
  .btn-sm:disabled{ opacity:.5; cursor:not-allowed; }
  .manual-code{ background:#0e1e0e; border:1px solid #2a4a2a; border-radius:6px; padding:.5rem .8rem; }
  /* v6.114 手機版大廳：原本清單有 max-height:240px 內滾動，在手機上會變成
     「頁面滾動 + 清單內滾動」的雙層滾動，很難操作 —— 手機直接解除，交給頁面滾動。 */
  @media (max-width:600px){
    .open-room-list{ max-height:none; overflow-y:visible; }
    .or-act{ margin-left:auto; min-height:34px; }
    .or-meta{ font-size:.75rem; }
  }
  .manual-code summary{ cursor:pointer; color:#ccc; font-size:.88rem; }
  .manual-code label{ margin-top:.5rem; }
  .manual-code button{ margin-top:.5rem; }

  /* ═══════════════════════════════════════════════════════════════════
     v5.009 桌墊版 layout — 仿實體 TCG 對戰布局（opt-in）
     啟用：battleLayout === 'tabletop' → .playmat.layout-tabletop
     ═══════════════════════════════════════════════════════════════════ */
  /* ═══════════════════════════════════════════════════════════════════
     v5.012 桌墊版 v2 — 1366×768 緊湊布局重寫
     用 display:contents 把 .field-row / .action-bar 變透明，子孫成為
     .playmat 直接 grid items，再用 grid-template-areas 精準定位。
     ═══════════════════════════════════════════════════════════════════ */
  .playmat.layout-tabletop{
    display:grid !important;
    /* v5.143：加 position:relative — 給 stadium-display absolute 用作 containing block fallback。
       stadium 改 absolute 後（含 grid-area:stadium）containing block 是 grid area，但若瀏覽器
       fallback 行為，position:relative 提供穩定 anchor。 */
    position:relative;
    /* 6 cols：chip | piles-or-prize-side | stadium | actions | center(active+bench) | prize-or-piles-side
       v5.027：actions column 從 auto → 固定 160px，避免 alerts-col 內 prize-alert 出現時撐寬 column
       把整個戰鬥場往右擠 — 玩家反映「就像真的桌游一樣不該抖動桌子」 */
    grid-template-columns:32px auto auto 160px 1fr auto;
    /* 4 rows: opp-bench / opp-active / self-active / self-bench
       v5.136 用 fix 300/300 撐爆 viewport (~1010px 超過可用 800-900) → 撤回為 auto。
       v5.138 真根因：align-self 方向錯。bench 原黏「外側」、active 原黏「內側」→
       active row 撐高時 bench 跟著外移、active 黏不動 → 視覺距離拉大。
       新解：bench 改黏「內側」(靠近 active)、active 改黏「外側」(靠近 bench) →
       bench-active 永遠貼 gap 15px，不論 row 高度怎麼變。
       stadium-display 跨 Row 2-3 在中間自然填充。 */
    grid-template-rows:auto auto auto auto;
    grid-template-areas:
      ".       .         .         .         benchO    ."
      "chipO   pilesO    stadium   .         activeO   prizesO"
      "chipMe  prizesMe  stadium   actions   activeMe  pilesMe"
      ".       .         .         .         benchMe   .";
    /* v5.038→v5.050→v5.110→v5.111：row-gap 12→5→25→15px。
       玩家回報 v5.110 25px 撐爆 viewport 需要 scroll，且我方對方 active 距離太遠。
       縮回 15px：保留 bench-active 視覺分隔，又能 fit 1366×768。
       padding-top/bottom 維持 8px (v5.098)。 */
    gap:15px 8px;
    padding:8px 8px;
    align-items:center;
    /* 預留右側 log panel 空間（log 開啟時） */
    margin-right:0;
    transition:margin-right .2s;
  }
  .playmat.layout-tabletop:not(.log-collapsed){ margin-right:296px; }

  /* field-row / action-bar 變 display:contents — 子孫直接被 .playmat grid 接管 */
  .playmat.layout-tabletop > .field-row,
  .playmat.layout-tabletop > .action-bar{ display:contents !important; }

  /* === 對手 row === */
  .playmat.layout-tabletop .opponent-row > .turn-order-chip{ grid-area:chipO; align-self:center; }
  .playmat.layout-tabletop .opponent-row > .zone-pile{
    grid-area:pilesO; display:flex; flex-direction:column; gap:3px;
  }
  .playmat.layout-tabletop .opponent-row > .zone-bench{
    grid-area:benchO; display:flex; justify-content:center; flex-wrap:nowrap; gap:2px;
    /* v5.138：改 align-self:end — bench 黏 Row 1 底，靠近 activeO，
       active 撐高時 bench 跟著移動，視覺貼齊不撐間隙 (Wilson 連 4 次回報修正) */
    align-self:end;
  }
  /* v5.138：active 改黏「外側」(靠近 bench) — align-self:end → start，
     讓 active-bench 視覺貼齊 gap 15px，不論 row 高度。 */
  .playmat.layout-tabletop .opponent-row > .zone-active{ grid-area:activeO; justify-self:center; align-self:start; }
  .playmat.layout-tabletop .opponent-row > .zone-prizes{ grid-area:prizesO; }

  /* === 我方 row（注意：prize / piles 左右互換）=== */
  .playmat.layout-tabletop .my-row > .turn-order-chip{ grid-area:chipMe; align-self:center; }
  .playmat.layout-tabletop .my-row > .zone-prizes{ grid-area:prizesMe; }  /* 互換：prize 在左 */
  .playmat.layout-tabletop .my-row > .zone-bench{
    grid-area:benchMe; display:flex; justify-content:center; flex-wrap:nowrap; gap:2px;
    /* v5.138：改 align-self:start — bench 黏 Row 4 頂，靠近 activeMe，
       active 撐高時 bench 跟著移動，視覺貼齊不撐間隙 (Wilson 連 4 次回報修正) */
    align-self:start;
  }
  /* v5.138：active 改黏「外側」(靠近 bench) — align-self:start → end，
     讓 active-bench 視覺貼齊 gap 15px，不論 row 高度。
     v5.146→v5.154：撤回 z-index:250。Wilson 反饋 bench 疊牌被 active 框架蓋住，
     優先讓 bench att-card-stack 可見。bench (z=200) 蓋 active (z=1) 是正確視覺層。
     evo-wrap 在 active-img 上方（v5.149 top:110）已足夠，少數重疊不影響可點。 */
  .playmat.layout-tabletop .my-row > .zone-active{
    grid-area:activeMe; justify-self:center; align-self:end;
  }
  .playmat.layout-tabletop .my-row > .zone-pile{
    grid-area:pilesMe; display:flex; flex-direction:column; gap:3px;  /* 互換：piles 在右 */
  }

  /* === action-bar children — Stadium 跨兩 row（centerline align）=== */
  /* v5.129：桌墊版 stadium 加 max-height + 縮小 img — 避免場地卡上場後撐大父 row
     讓上下版面框架保持穩定 */
  .playmat.layout-tabletop .action-bar > .stadium-display{
    /* v5.143：position:absolute 浮層（Wilson 提案「類似 word 文繞圖」），不貢獻
       row track sizing — Spec 保證 absolute item 即使有 grid-area 也不撐 grid。
       v5.157：拿掉 grid-area / grid-row（不必需，absolute item 在 grid 中本就
       不撐 row）。改用 right/top 從 .playmat（v5.143 已 position:relative）量定位
       到右側對手 prizes/piles col 6 左方。放大 96/138 → 120/168 (1.25x)。 */
    position:absolute;
    right:150px;            /* v5.157 移到右側 (留對手 prizes/piles 區 ~140px) */
    top:50%;
    transform:translateY(-50%);
    /* 顯示與 flex layout（內部 label/img/name 垂直排列） */
    display:flex; flex-direction:column; align-items:center;
    background:rgba(26,42,74,.6); border:1px solid #3a5a8a; border-radius:6px;
    cursor:pointer;
    width:120px;            /* v5.157: 96→120 放大 */
    height:168px;           /* v5.157: 138→168 等比 (96:138 ≈ 120:172, 取 168) */
    padding:.25rem .3rem; gap:.18rem;
    overflow:hidden;
    z-index:5;  /* 浮在 grid items 之上但不蓋 modal */
  }
  .playmat.layout-tabletop .action-bar > .stadium-display img{
    /* v5.157: 64/90 → 84/118 等比放大 (卡片 96:135 比例) */
    width:84px;
    height:118px;
    object-fit:contain;
  }
  /* v5.157: 字體放大配合 width 增 */
  .playmat.layout-tabletop .action-bar > .stadium-display .stadium-display-label{
    font-size:.75rem;
  }
  .playmat.layout-tabletop .action-bar > .stadium-display .stadium-display-name{
    font-size:.78rem; max-width:112px;
  }
  .playmat.layout-tabletop .action-bar > .action-btns{
    grid-area:actions; align-self:center; justify-self:center;
    /* v5.046：gap:3 → 2 — 招式按鈕之間近，跨類別按鈕用 margin-top 額外撐開避免誤按 */
    /* v5.149：position:absolute — 動態按鈕變化（進化/附加完成後 confirm 按鈕等）
       不貢獻 row sizing，row 3 高度由 active-card (鎖死 175) 決定。 */
    position:absolute;
    display:flex; flex-direction:column; gap:2px; max-width:140px;
  }
  /* v5.046：桌墊版 action-btns 內按鈕分組間距
     - 招式（.btn-act.atk）之間 gap:2 (近，同一寶可夢的 2 個招式不誤按)
     - 跨類別（招式→跳過/stadium/撤退/結束回合/悔棋）→ margin-top:14px 撐開避免誤按 */
  .playmat.layout-tabletop .action-bar > .action-btns > .btn-act.secondary,
  .playmat.layout-tabletop .action-bar > .action-btns > .btn-act.stadium-btn,
  .playmat.layout-tabletop .action-bar > .action-btns > .btn-act.btn-retreat-mirror,
  .playmat.layout-tabletop .action-bar > .action-btns > .btn-act.btn-undo{
    margin-top: 14px !important;
  }
  /* primary 結束回合 — 跟前面隔開（除非自己是第一個如 setup 階段「準備完成」） */
  .playmat.layout-tabletop .action-bar > .action-btns > .btn-act.primary:not(:first-child){
    margin-top: 14px !important;
  }
  .playmat.layout-tabletop .action-bar > .alerts-col{
    /* 跟 actions 同欄但上方堆疊
       v5.149：position:absolute — 不貢獻 row track sizing（鏡射 v5.143 stadium）。
       alerts 內動態訊息瞬間出現/消失不撐 row 3 高度。 */
    grid-area:actions; align-self:start; justify-self:center;
    position:absolute;
    z-index:5; pointer-events:none;  /* alerts 內部按鈕需 re-enable */
  }
  .playmat.layout-tabletop .action-bar > .alerts-col > *{ pointer-events:auto; }

  /* === Bench 縮小 65%（讓 1366×768 不滾動）=== */
  /* v5.016：transform:scale 不影響 layout 框 → 浪費 72px 垂直空間（玩家回饋）。
     改用 zoom:0.65 — 同步縮 layout + 視覺 → grid row auto 直接縮到 ~133px，省去多餘空間。 */
  .playmat.layout-tabletop .zone-bench{ zoom:0.65; }

  /* v5.024 桌墊版：附加卡片改「同寶可夢大小、壓在底下、僅露出底部」（仿實體桌面）。
     + HP bar 從卡底移到左側細長欄，省下垂直空間給手牌上移。
     僅 .playmat.layout-tabletop scope；桌機 classic + 手機 portrait 不受影響。 */
  .playmat.layout-tabletop .active-card,
  .playmat.layout-tabletop .bench-slot{ position:relative; }

  /* === 附加卡疊放：absolute 與寶可夢圖同寬同位置，active 往右扇開、bench 往上扇開 === */
  .playmat.layout-tabletop .att-card-stack{
    position:absolute; pointer-events:none; overflow:visible;
    /* width/top/left 由 active vs bench 分別設定（見下） */
  }
  .playmat.layout-tabletop .att-card{
    position:absolute; left:0; top:0;  /* top 由 inline style 設定 */
    width:100%; height:auto;
    border:1px solid rgba(255,255,255,0.35);
    border-radius:3px;
    box-shadow:0 2px 4px rgba(0,0,0,0.65);
    /* v5.026：個別卡片重新開啟 pointer-events 以接 hover 預覽（stack container 自身仍 none，
       避免擋到下方寶可夢圖點擊；但卡片本體要能 hover 觸發 enterAttCard） */
    pointer-events:auto; cursor:zoom-in;
  }
  .playmat.layout-tabletop .att-card.att-tool{ border-color:#d4a000; }
  .playmat.layout-tabletop .att-card.att-evo{ border-color:#88aaff; }

  /* === active：stack 對齊 active-img — 橫向往右扇開 === */
  .playmat.layout-tabletop .active-card .active-img{ position:relative; z-index:99; }
  .playmat.layout-tabletop .active-card > .att-card-stack{
    /* v5.038：HP 欄 88→140px → stack 跟著右移對齊 img */
    top:.45rem; left:calc(.5rem + 140px + .45rem); width:105px; height:140px;
    overflow:visible !important;
  }

  /* === bench：縱向往上扇開 — v5.027 改 grid 對齊解決 >2 張亂疊 === */
  /* 根因：原本 bench-middle 是 flex column，flex 高度可能 > img 高（被 bench-slot 撐開），
     img 被 align-items:center 垂直置中，但 stack top:0 是錨在 bench-middle 頂，
     導致兩者沒對齊。改 grid 讓 img + stack 在同一 grid cell place-items:center，自動對齊。 */
  /* v5.107: contain:layout 強制 layout containment — children layout 不影響父 sizing。
     防止 stack absolute children 視覺溢出時某些瀏覽器 reflow 父 row。
     height:205px 仍 fixed (base CSS), 但 contain 確保此 fix 不被 break。 */
  .playmat.layout-tabletop .bench-slot{
    overflow:visible !important;
    contain: layout style;
  }

  /* v5.108：對手 bench-slot height 回 205 跟我方對稱（玩家回報：對手距離較近）。
     原 v5.048 縮 155 為省 50px，但 v5.097 後卡圖撐滿框架，bench-slot 高度直接決定卡圖大小
     → 對手卡圖比我方小 → 不對稱視覺。v5.108 統一 205px 對稱。 */
  .playmat.layout-tabletop .opponent-row .bench-slot{
    height: 205px !important;
  }
  /* v5.097：bench-middle 撐滿 bench-slot 框架。v5.106 簡化 grid → flex
     stack 已改 absolute 脫離 layout，img 是唯一 layout 內容，用 flex center 對齊即可。 */
  .playmat.layout-tabletop .bench-slot .bench-middle{
    display:flex; align-items:center; justify-content:center;
    position:absolute; inset:0;
    overflow:visible;
  }
  .playmat.layout-tabletop .bench-slot .bench-middle img{
    z-index:99;
    /* v5.097: 卡圖放大到 slot 高度，object-fit:contain 保比例不變形 */
    height:100%; width:auto; max-width:100%; max-height:100%;
    object-fit:contain;
  }
  /* v5.098 → v5.105 → v5.106 演進：
     - v5.098: height:100% + aspect-ratio + width:auto → 寬度撐爆 146px > cell 95px
     - v5.105: width:100% + height:auto + aspect-ratio → 變 grid item, stack 仍影響 cell layout
     - v5.106: 改 position:absolute + 中央定位完全脫離 grid layout，
       att-card 視覺往上 fan 出框架外，框架尺寸不變（玩家要求「框架鎖死」）
     att-card 內仍 position:absolute top:-N，從 stack 頂往上偏移視覺溢出 bench-slot。 */
  .playmat.layout-tabletop .bench-slot .att-card-stack{
    position:absolute;
    top:50%; left:50%;
    transform:translate(-50%, -50%);
    width:100%; max-width:100%;
    aspect-ratio:96/135; height:auto;
    overflow:visible !important;
    pointer-events:none;  /* att-card 個別 pointer-events:auto 仍可 hover */
  }
  /* v5.107: zone-bench 也加 contain:layout 隔離 — 雙保險
     v5.109: z-index:200 拉高過 active-card(z=auto)，修對手 bench 往下 fan 被 active 蓋
     對手 bench 在 row 1, fan 進 row 2 對手 active 區。同 DOM order 後者(active)堆疊在上
     → bench att-card 被蓋。z-index:200 在 zone-bench 整體建立 stacking context 之上。
     v5.131: 加 min-height:205px — 鎖死 bench-row 高度，沒 bench 寶可夢時也預留空間。
     v5.134: min-height → fixed height:205 + max-height:205 — 玩家回報 v5.131 後仍有間隙，
     可能 bench-slot 內容 + height:auto 導致變化。改 fixed height 完全鎖死所有 layout shift。 */
  .playmat.layout-tabletop .zone-bench{
    overflow:visible !important;
    contain: layout;
    position:relative;
    z-index:200;
    height:205px;
    min-height:205px;
    max-height:205px;
  }
  /* v5.109: zone-active z-index 明確設定 1, 低於 zone-bench(200) */
  .playmat.layout-tabletop .zone-active{
    position:relative;
    z-index:1;
  }

  /* === v5.027 att-preview 在 viewport 頂部 → 改顯示在卡下方（transform 翻轉） === */
  .hand-preview-float.att-preview-below{ transform:translate(-50%, 0); }

  /* === HP bar 從卡底移到左側 — v5.027 延長：column 56→88px（玩家要求往左延長）
     v5.038：再延長到 140px — 跟 .active-name-tt 等寬（v5.035 設的 140px），血條視覺
     寬度與名字框完全對齊；padding-left 從 96px 跟著加到 148px (140 + 4gap + 4pad) === */
  /* v5.111: min-height 170 → 140 縮回 (玩家回報 active-card 內部上下空白浪費)。
     row-gap 25px 已給 bench/active 之間視覺距離, active-card 不需再加內部緩衝。
     v5.147：min-height → fixed height:175 三鎖死。Wilson 報告附加能量後 active row
     瞬間撐大、下一動作回復 — 是 active-card 內元素瞬時變化（能量 chip 動畫 / att-card
     重排 / ability-btn 出現等）撐 active-card 進而撐 grid row 3/2。
     v5.150：175 → 160（Wilson 怒「卡圖下方一大片空白佔版面」）。
       active-img 卡圖 96:135 比例 width:105 → height ≈ 147 + padding 上下 .45rem*2 ≈ 14 = 161。
       設 160 視覺接近完美貼合，刪除卡圖下方多餘 ~13px 空白。
       overflow:visible 仍可讓 evo-wrap (top:100) 溢出 1-2px 不影響。 */
  .playmat.layout-tabletop .active-card{
    padding-left:148px !important;  /* 140px HP 欄 + 4 gap + 4 padding */
    padding-bottom:.45rem !important;
    height:160px !important;
    min-height:160px !important;
    max-height:160px !important;
    overflow:visible;
  }
  /* v5.112: HP column 垂直置中 (玩家要求大約置中位置) */
  .playmat.layout-tabletop .active-card .active-hpbar-bottom{
    left:.4rem; top:50%; transform:translateY(-50%); right:auto; bottom:auto;
    width:140px;
    flex-direction:column; align-items:center; justify-content:flex-start;
    gap:5px; padding:5px 4px;
    background:rgba(0,0,0,0.78);
    border-radius:6px;
  }
  .playmat.layout-tabletop .active-card .active-hpbar-bottom .hp-bar-wrap{
    flex:0 0 auto;
    width:100%; height:8px;
    margin:0;
  }
  .playmat.layout-tabletop .active-card .active-hpbar-bottom .active-hp-text{
    font-size:.7rem; line-height:1.1; text-align:center;
    white-space:normal; word-break:keep-all;
  }
  /* v5.149：evo-wrap 改疊在 active-img 上（卡圖內 ability-btn 下方），不再放卡片底部佔版面。
     v5.150：active-card 縮到 160，evo-wrap top 110 → 100（仍在 ability-btn 75+30 下方）。
     Wilson：進化按鈕要疊在寶可夢卡圖上不要佔版面，且不能跟特性按鈕重疊。
     ability-btn 位置：right:8 top:75 width:90 height ~30。evo-wrap 放 ability-btn 下方 5px。
     z-index:201 高於 ability-btn 200，確保兩者都可點。 */
  .playmat.layout-tabletop .active-card .evo-wrap{
    position:absolute;
    bottom:auto !important;
    top:100px;          /* v5.150: ability-btn top:75 + height ~25 + gap (active-card 縮到 160) */
    right:8px;
    width:90px;
    z-index:201;
  }
  /* v5.146/v5.149：桌墊版進化按鈕字體放大 + 填滿 evo-wrap 寬 */
  .playmat.layout-tabletop .active-card .evo-btn{
    width:100% !important;
    font-size:.85rem !important;
    padding:.3rem .5rem !important;
    font-weight:bold;
  }

  /* === v5.028 active 名稱左欄（HP bar 下方） + 字放大 ===
     v5.035：突破父 .active-hpbar-bottom 88px 寬度限制 — 改 absolute 定位、
     往兩邊各延伸 26px（總寬 140px），z-index 拉到 100 確保任何時候都在最上層
     （高過 attached(z≤80) / tool-chip(z=5) / 父 hpbar-bottom(z=10)），
     pointer-events:none 不擋下層 hover 事件。預留 140px 寬給未來更長名字。 */
  .playmat.layout-tabletop .active-card .active-name-tt{
    position:absolute;
    top:100%;                /* 從 hpbar-bottom 底部接續 */
    left:50%;
    transform:translateX(-50%);
    width:140px;             /* 突破父 88px，左右各延伸 26px */
    margin-top:4px;
    z-index:100;             /* 任何狀態都在最上層 */
    font-size:.9rem; font-weight:700; color:#fff;
    text-align:center; line-height:1.2;
    background:rgba(0,0,0,0.82);
    padding:3px 6px;
    border-radius:4px;
    word-break:keep-all; overflow-wrap:anywhere;
    text-shadow:0 1px 2px rgba(0,0,0,.95);
    pointer-events:none;
    box-shadow:0 2px 4px rgba(0,0,0,.4);
  }
  /* HP 字也放大 */
  .playmat.layout-tabletop .active-card .active-hpbar-bottom .active-hp-text{
    font-size:.92rem; font-weight:700;
  }
  /* tabletop 隱藏右側 active-info 內的原 active-name（避免重複顯示） */
  .playmat.layout-tabletop .active-card .active-info .active-name{ display:none; }
  /* v5.857 桌墊版：戰鬥位狀態徽章(混亂/中毒/灼傷…)+已用特性 chip 被進化堆疊 att-card
     (z-index 50，往右扇開 left:(i+1)*32px) 蓋住看不到。根因：.active-info(z-index:2)
     被 .active-card 的 isolation:isolate 封在下層，子孫再高 z 也無法蓋過同層 att-card。
     比照備戰 .status-chip-sm(z-index:201) 既有收斂做法，把戰鬥位 .active-info 整層
     z-index 提到 att-card(50) 與 tt-attach-overlay(130) 之上、ability-btn(200) 之下，
     讓狀態徽章在桌墊版恆可見（雙方 active 共用此 .active-info → 一處收斂全解）。 */
  /* pointer-events:none：此層唯一可見子孫為狀態/已用特性/附能提示等純資訊 chip
     (active-name/tool-chip 於桌墊版 display:none；特性鈕/進化鈕為 .active-info 的
     sibling 不在此層)，故整層穿透，才不會蓋住下方 att-card 的 hover 預覽與點擊縮放。 */
  .playmat.layout-tabletop .active-card .active-info{ z-index:140; pointer-events:none; }

  /* === v5.030 bench 名稱+HP 改 absolute 疊在 Pokemon 圖中央上方 === */
  /* 原本 (v5.028) name/stat 在 bench-slot flex 頂部，z-index:200 浮在 attached 之上 —
     但占據了 slot 頂部空間，attached 卡疊到上方時被 name/stat 區擋住 hover 事件，
     玩家無法 hover 預覽。改 absolute 疊在 Pokemon 圖中央偏上區、pointer-events:none
     讓事件穿透到下方的 img + attached 卡。 */
  .playmat.layout-tabletop .bench-slot .bench-name{
    position:absolute; left:4px; right:4px; top:38%;
    z-index:200; pointer-events:none;
    /* v5.038→v5.039：放大 .82 → 1rem → 1.05rem，再大一點點 */
    font-size:1.05rem; font-weight:700; color:#fff;
    text-align:center; line-height:1.1;
    text-shadow:0 1px 3px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.95);
    background:rgba(0,0,0,.75); border-radius:3px;
    padding:1px 3px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .playmat.layout-tabletop .bench-slot .bench-stat{
    position:absolute; left:4px; right:4px; top:calc(38% + 22px);
    z-index:200; pointer-events:none;
    /* v5.038→v5.039：放大 .78 → .92 → 1.1rem (HP 長度有限可大幅放大) */
    font-size:1.1rem; font-weight:700; color:#cfe;
    text-align:center; line-height:1.15;
    text-shadow:0 1px 3px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.95);
    background:rgba(0,0,0,.82); border-radius:3px;
    padding:2px 6px;
  }
  /* v5.097：bench hp-bar 改 absolute 浮在 slot 底部（讓 bench-middle 卡圖撐滿） */
  .playmat.layout-tabletop .bench-slot > .hp-bar-wrap{
    position:absolute; left:4px; right:4px; bottom:4px;
    z-index:200;
  }

  /* === v5.038 ability-btn-sm 在桌墊版備戰區放大；v5.097 改 absolute 浮層；v5.098 加高 ===
     v5.097：原本 flow 內占空間 → 改 absolute 浮在卡圖底部上方（仿 bench-name/bench-stat
     pattern），不再撐高 bench-slot；bench-middle 卡圖可撐滿整個框架。
     v5.098：padding .22 → .35rem、font .72 → .82rem，按鈕高度更明顯，玩家更好點。
     bottom 從 22 → 26 對應加高，仍在 hp-bar 上方。 */
  .playmat.layout-tabletop .bench-slot .ability-btn-sm{
    position:absolute; left:4px; right:4px; bottom:26px;
    z-index:201;                       /* 高過 hp-bar(200) + 卡圖(99) */
    font-size:.82rem !important;
    padding:.35rem .45rem !important;
    margin:0 !important;
    border-radius:4px !important;
    font-weight:600;
    box-shadow:0 2px 4px rgba(0,0,0,.5);
    min-height:28px;
  }
  /* v5.097：evo-btn-sm 也 absolute 浮層（在 ability-btn 上方一層） */
  .playmat.layout-tabletop .bench-slot .evo-btn-sm{
    position:absolute; left:4px; right:4px; bottom:48px;
    z-index:201;
    margin:0 !important;
    box-shadow:0 2px 4px rgba(0,0,0,.5);
  }
  /* v5.097：化石丟棄按鈕也 absolute 浮層 */
  /* v5.156：字體放大 — Wilson 反應原 .56rem 太小（繼承自 .evo-btn-sm L10105）。 */
  .playmat.layout-tabletop .bench-slot .evo-btn-sm.fossil-discard-btn{
    bottom:48px;
    font-size:.82rem !important;
    padding:.3rem .45rem !important;
    font-weight:600;
    min-height:28px;
  }
  /* v5.097：tool-chip / ab-used-chip / status-chip-sm 改 absolute 浮層
     tool-chip：在 hp-bar 上方
     ab-used-chip：右上角小圖示
     status-chip-sm：左上角（罕見） */
  .playmat.layout-tabletop .bench-slot .tool-chip.sm{
    position:absolute; left:4px; right:4px; bottom:38px;
    z-index:201; margin:0;
    font-size:.7rem; padding:1px 4px;
    text-align:center;
    background:rgba(180,140,0,.85); color:#fff;
    border-radius:3px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    box-shadow:0 1px 3px rgba(0,0,0,.5);
  }
  .playmat.layout-tabletop .bench-slot .ab-used-chip.sm{
    position:absolute; right:4px; top:4px;
    z-index:201; margin:0;
    background:rgba(160,160,160,.85); color:#222;
    font-size:.7rem; padding:1px 4px; border-radius:3px;
  }
  .playmat.layout-tabletop .bench-slot .status-chip-sm{
    position:absolute; left:4px; top:4px;
    z-index:201; margin:0;
    font-size:.8rem; padding:0 3px; border-radius:3px;
  }
  /* v5.097：attach-hint 浮在卡圖正中央 */
  .playmat.layout-tabletop .bench-slot .attach-hint{
    position:absolute; left:50%; top:50%;
    transform:translate(-50%, -50%);
    z-index:202; margin:0;
    font-size:1.4rem;
    background:rgba(0,0,0,.78); color:#ffeb3b;
    padding:6px 12px; border-radius:8px;
    box-shadow:0 0 12px rgba(255,235,59,.7);
  }

  /* === v5.039 戰鬥場特性按鈕釘在名字框下方（緊鄰下邊界） ===
     原本 .ability-btn 跟著 .active-info 在 active-card 右側 flow 排列 — 桌墊版
     視覺位置奇怪。改 absolute 釘在 active-card 左側 HP column 下方，跟
     .active-name-tt (v5.035 設 width:140px, top:100% from hpbar-bottom) 同寬同列，
     視覺上「在名字框正下方緊接」。
     top 計算依當前 hpbar-bottom 與 name-tt 預估高度 ~ 88px from active-card top
     （hpbar top:.5rem 8 + 內容 ~45 + name-tt margin 4 + name-tt height ~28 + gap 3）。 */
  /* v5.150：padding-bottom .9rem → .45rem。v5.112 原預留 ability-btn flow 空間，
     但 v5.097 已把 ability-btn 改 absolute，不再需要 padding 預留。刪掉多餘空白。 */
  .playmat.layout-tabletop .active-card{
    padding-bottom:.45rem !important;
  }
  /* v5.112: ability-btn 移到 active-img (卡圖) 上方文字說明區位置, 用 right 對齊 active-card 右側
     active-img width:105 在 active-card 右側 (padding-left:148 之後). 卡圖內部文字 effect 區大約在
     上方 ~60% 位置 (卡牌設計: 上半圖, 下半 attacks/effect)。
     用 right:8px + top:75px 把按鈕放到卡圖中下文字區位置, z-index 200 最頂層。 */
  .playmat.layout-tabletop .active-card .ability-btn{
    position:absolute;
    right:8px;
    width:90px;
    top:75px;                /* 卡圖約 50-60% 高度位置 = 文字說明開始 */
    z-index:200;             /* 最頂層, 高過 active-img(99) + attached(50~80) + name-tt(100) */
    margin:0;
    padding:.3rem .4rem;
    font-size:.75rem; font-weight:700;
    background:rgba(58, 26, 90, .92); color:#fff;
    border:1px solid #b070dd; border-radius:5px;
    cursor:pointer; text-align:center;
    box-shadow:0 2px 6px rgba(0,0,0,.7), 0 0 8px rgba(176,112,221,.5);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .playmat.layout-tabletop .active-card .ability-btn:hover{
    background:#5a2a8a;
  }

  /* === v5.039 戰鬥場中線對齊備戰第 3 隻中線 ===
     根因：active-card padding-left:148px (HP column 140 + gap 8) 造成 card 內 pokemon
     img 中心比 card 視覺中心偏右 ~74px；card 用 justify-self:center 對齊 grid column
     中央時，img 中心就偏離 column 中央 74px → 跟 bench 5 隻置中時的第 3 隻中心不一致。
     修法：對雙方 zone-active 加 transform:translateX(-74px)，把 active 整體往左拉，
     讓 pokemon img 中心精準對齊 grid column 中央（同 bench 第 3 隻中心）。 */
  .playmat.layout-tabletop .opponent-row > .zone-active,
  .playmat.layout-tabletop .my-row > .zone-active{
    transform:translateX(-74px);
  }

  /* === v5.038 拿掉「對手出場」「我的出場」label — 釋出 4 zone 間距空間 ===
     對手 label 是純文字 div（class="zone-label-sm opp-label"），整個 hide；
     我的 label div 內含撤退按鈕，只 hide 內層 .zone-label-text span（v5.038 新加），
     保留按鈕並讓 div 高度降到只剩按鈕。 */
  .playmat.layout-tabletop .zone-label-sm.opp-label{ display:none; }
  .playmat.layout-tabletop .my-active-zone > .zone-label-sm{
    margin:0; padding:0; min-height:0;
  }
  .playmat.layout-tabletop .zone-label-sm .zone-label-text{ display:none; }

  /* === v5.029 hover 高亮 — 只亮邊 + 發光，不再改 z-index === */
  /* 玩家反映：原本 z-index:80 讓能量（最外側 z 較低的卡）hover 時跳到最前面、
     覆蓋上層內容；進化鏈本來 z 就高所以視覺差異小。為一致改成都不調 z-index，
     hover 僅用亮邊 + 黃光，原 stacking 維持不變。 */
  .playmat.layout-tabletop .att-card:hover{
    border-color:#ffd44a !important;
    box-shadow:0 0 14px rgba(255,212,74,.9), 0 2px 6px rgba(0,0,0,.6);
    transition:border-color .12s, box-shadow .12s;
  }
  /* Pokemon 圖 hover 亮邊（active + bench） */
  .playmat.layout-tabletop .active-card .active-img:hover,
  .playmat.layout-tabletop .bench-slot .bench-middle img:hover{
    filter:brightness(1.12) drop-shadow(0 0 8px rgba(255,212,74,.7));
    transition:filter .12s;
  }

  /* === 隱藏舊 pip / chip（被疊放小卡圖取代） === */
  .playmat.layout-tabletop .active-card .active-nrg-col,
  .playmat.layout-tabletop .bench-slot .bench-nrg,
  .playmat.layout-tabletop .active-card .tool-chip,
  .playmat.layout-tabletop .bench-slot .tool-chip{ display:none; }

  /* === v5.410：桌墊版能量/道具 compact overlay（疊在卡圖上，玩家建議仿手機版）===
     原桌墊版把 pip/chip display:none、只留 att-card-stack 小卡圖，玩家反應看不清能量
     種類/道具。新增獨立 .tt-attach-overlay（absolute + pointer-events:none，不改框架），
     疊在卡圖底部顯示能量 pip（重用 .nrg-pip 配色）+ 道具 🔧×N。att-card-stack 保留。 */
  .playmat.layout-tabletop .tt-attach-overlay{
    position:absolute; display:flex; flex-wrap:wrap; gap:2px;
    align-items:flex-end; justify-content:center;
    z-index:130; pointer-events:none;
  }
  .playmat.layout-tabletop .tt-attach-overlay:empty{ display:none; }
  .playmat.layout-tabletop .active-card .tt-attach-overlay{
    left:calc(.5rem + 140px + .45rem); width:105px; bottom:0;
  }
  .playmat.layout-tabletop .bench-slot .tt-attach-overlay{
    /* v5.474：原 bottom:25px 與 .ability-btn-sm(bottom:26px,z201)同高被蓋住 → 往下挪到最底（HP 數字
       另由 .bench-stat 顯示，細血條被蓋可接受）；z-index 提到 202 顯示在 hp-bar(200)之上。 */
    left:1px; right:1px; bottom:2px; z-index:202;
  }
  .playmat.layout-tabletop .tt-attach-overlay .nrg-pip{
    min-width:21px; height:21px; font-size:.78rem; padding:0 4px; border-radius:11px;
  }
  .playmat.layout-tabletop .bench-slot .tt-attach-overlay .nrg-pip{
    /* v5.474：加大（玩家建議）22→24px、.8→.9rem */
    min-width:26px; height:24px; font-size:.9rem; padding:0 5px; border-radius:12px;
  }
  .playmat.layout-tabletop .tt-attach-overlay .tt-tool{
    display:inline-flex; align-items:center; height:21px; font-size:.76rem;
    padding:0 5px; border-radius:11px; font-weight:700; color:#fff;
    background:rgba(180,140,0,.92);
    box-shadow:0 0 0 1px rgba(0,0,0,.4) inset, 0 1px 2px rgba(0,0,0,.3);
  }
  .playmat.layout-tabletop .bench-slot .tt-attach-overlay .tt-tool{
    height:24px; font-size:.88rem; padding:0 5px;
  }

  /* v5.016：隱藏戰鬥位上方的「撤退」按鈕 — 統一由左側 action-bar 的 .btn-retreat-mirror 操作，
     讓雙方 active 距離更近。:not(.btn-fossil-discard) 避免誤隱藏化石丟棄按鈕（共用 class）。 */
  .playmat.layout-tabletop .my-active-zone .btn-retreat:not(.btn-fossil-discard){ display:none; }

  /* v5.024：手牌列再上移（桌墊版專屬，HP bar 移左後上下省更多） — :has() 反向選 hand-strip */
  .battle-root:has(.playmat.layout-tabletop) .hand-strip{ padding:0 .7rem 0; }
  .battle-root:has(.playmat.layout-tabletop) .hand-strip .hand-label{ margin-bottom:0; font-size:.65rem; }
  .battle-root:has(.playmat.layout-tabletop) .hand-strip .hand-scroll{ padding:0 1rem 0; min-height:120px; }

  /* === Battle log side panel（漂浮在右邊） === */
  .playmat.layout-tabletop .action-bar > .log-col{
    position:fixed; right:8px; top:88px; bottom:200px;
    width:280px;
    background:rgba(10, 26, 10, 0.92); border:1px solid #3a5a3a;
    border-radius:8px; padding:8px 6px;
    overflow-y:auto; z-index:50;
    box-shadow:0 4px 12px rgba(0,0,0,.4);
    /* v5.016：聊天室慣例 — 新訊息在底、舊訊息在頂。
       data 仍 .reverse()（newest first），column-reverse 把首項翻到視覺底部，
       overflow-y:auto 配合自動 anchor 在底部最新訊息。 */
    display:flex; flex-direction:column-reverse;
  }
  .playmat.layout-tabletop.log-collapsed .action-bar > .log-col{ display:none; }

  /* === Log toggle 按鈕（邊緣浮動）=== */
  .playmat.layout-tabletop .log-toggle-btn{
    position:fixed; top:120px; right:296px;
    background:#1a2a1a; border:1px solid #5a8a5a; color:#aaffaa;
    padding:10px 8px; border-radius:4px 0 0 4px;
    cursor:pointer; z-index:60;
    display:flex; flex-direction:column; align-items:center; gap:2px;
    font-size:11px; font-weight:600;
    transition:right .2s, background .15s;
  }
  .playmat.layout-tabletop.log-collapsed .log-toggle-btn{ right:8px; }
  .playmat.layout-tabletop .log-toggle-btn:hover{ background:#2a4a2a; }
  .playmat.layout-tabletop .log-toggle-icon{ font-size:18px; line-height:1; }
  .playmat.layout-tabletop .log-toggle-arrow{ font-size:14px; color:#88ddaa; }

  /* === 1366×768 窄螢幕：fallback 回 classic 避免變形 === */
  @media (max-width: 1199px){
    .playmat.layout-tabletop{
      display:grid !important;
      grid-template-columns:none; grid-template-rows:none; grid-template-areas:none;
      margin-right:0 !important;
    }
    .playmat.layout-tabletop > .field-row,
    .playmat.layout-tabletop > .action-bar{ display:flex !important; }
    .playmat.layout-tabletop > .field-row > *,
    .playmat.layout-tabletop > .action-bar > *{
      grid-area:unset !important; grid-row:auto !important; grid-column:auto !important;
    }
    .playmat.layout-tabletop .zone-bench{ transform:none; }
    .playmat.layout-tabletop .action-bar > .log-col{ position:static; width:auto; }
    .playmat.layout-tabletop .log-toggle-btn{ display:none; }
  }

  /* v6.223【B】桌墊版高度自適應（實測 1366×768 / 1867×831 / 1912×836 上下 active 重疊、對手 bench 出上緣）：
     1) tablet-layout(h<=850) 的 :global 3-row 壓縮規則寫在檔案較後面、把桌墊版 4-row grid 蓋掉
        → 以更高 specificity 還原成 4 個 auto row；
     2) zoom 縮放時，vh 定高的容器「不會」因 zoom 獲得更多 CSS px 空間（v2.463 經典版縮放後底部留黑
        就是同一效應）→ battle-root 高度以 100dvh/zoom 換算，縮小後恰好填滿視窗、內容不再互擠。
     ⚠ 兩條都以 :has(.playmat.layout-tabletop) gate —— 經典版 / fable / 手機直式（不渲染 .playmat）零影響。 */
  :global(.battle-root.tablet-layout:has(.playmat.layout-tabletop) .playmat){ grid-template-rows:auto auto auto auto; }
  :global(.battle-root.zoomed:has(.playmat.layout-tabletop)){ height:calc(100vh / var(--game-zoom, 1)); height:calc(100dvh / var(--game-zoom, 1)); min-height:0; overflow:hidden; }

  /* v5.008 統一大廳 — 名稱欄 + 建立房間 CTA + inline 表單 */
  .online-form.lobby-unified{ max-width:560px; }
  .lobby-unified .name-row{ flex-direction:row; align-items:center; gap:.6rem; background:#162616; border:1px solid #2a4a2a; border-radius:8px; padding:.6rem .85rem; }
  .lobby-unified .name-label{ font-size:.88rem; color:#aaffcc; font-weight:600; min-width:64px; }
  .lobby-unified .name-row .name-input{ flex:1; }
  .create-room-block{ display:flex; flex-direction:column; }
  /* 收合狀態：大型 CTA 按鈕（沒人開房時最顯眼） */
  .btn-create-room-cta{
    display:flex; align-items:center; gap:.8rem;
    background:linear-gradient(135deg,#2a5a2a 0%,#1e3e1e 100%);
    border:1px solid #4a8a4a; border-radius:10px;
    padding:.85rem 1rem; cursor:pointer; color:#f0f0f0;
    font:inherit; text-align:left; transition:background .15s, transform .1s;
  }
  .btn-create-room-cta:hover{ background:linear-gradient(135deg,#3a7a3a 0%,#286028 100%); }
  .btn-create-room-cta:active{ transform:translateY(1px); }
  .btn-create-room-cta .cri-icon{ font-size:1.8rem; line-height:1; }
  .btn-create-room-cta .cri-text{ display:flex; flex-direction:column; gap:.15rem; flex:1; }
  .btn-create-room-cta .cri-title{ font-size:1rem; font-weight:700; color:#aaffaa; }
  .btn-create-room-cta .cri-sub{ font-size:.78rem; color:#bcd; }
  .btn-create-room-cta .cri-chevron{ font-size:1.2rem; color:#aaffaa; }
  /* 展開狀態：完整 inline 表單 */
  .create-room-inline{
    background:#1e2e1e; border:1px solid #4a8a4a; border-radius:10px;
    padding:.85rem 1rem; display:flex; flex-direction:column; gap:.65rem;
    animation:cri-expand .18s ease-out;
  }
  @keyframes cri-expand{ from{opacity:0; transform:translateY(-4px)} to{opacity:1; transform:translateY(0)} }
  .cri-header{ display:flex; align-items:center; justify-content:space-between; gap:.6rem; }
  .cri-header h3{ margin:0; color:#aaffaa; font-size:1rem; }
  .btn-link{ background:none; border:none; color:#8ad48a; font:inherit; font-size:.85rem; cursor:pointer; padding:.2rem .4rem; border-radius:4px; }
  .btn-link:hover{ background:rgba(138,212,138,.1); color:#aaffaa; }
  .cri-collapse{ font-size:.82rem; }

  /* 等待室 — 舊版（已不使用，但保留以防其他地方引用） */
  .room-waiting{ display:flex; flex-direction:column; align-items:center; gap:1.25rem; padding:2rem; }
  .room-code-display{ text-align:center; background:#1e2e1e; border:1px solid #3a5a3a; border-radius:12px; padding:1.5rem 2rem; }
  .room-code-display.guest{ border-color:#4a5a8a; background:#1e1e2e; }
  .room-code-label{ font-size:0.85rem; color:#888; margin-bottom:0.3rem; }
  .room-code-value{ font-size:3rem; font-weight:900; letter-spacing:0.3em; color:#aaffaa; font-family:monospace; }
  .room-code-hint{ font-size:0.8rem; color:#666; margin-top:0.5rem; }
  .join-notice{ color:#aaffaa; font-size:0.95rem; }
  .waiting-pulse{ animation:pulse-opacity 2s ease-in-out infinite; }
  @keyframes pulse-opacity{ 0%,100%{opacity:1}50%{opacity:0.5} }

  /* ── v2.269 座位制 lobby ── */
  .room-lobby{ display:flex; flex-direction:column; gap:1rem; padding:1rem; }
  .room-header{ display:flex; justify-content:space-between; align-items:center; padding:0.75rem 1rem;
    background:#1e2e1e; border:1px solid #3a5a3a; border-radius:10px; }
  .room-title{ font-size:1.2rem; font-weight:700; color:#aaffaa; }
  .room-code-inline{ font-size:0.9rem; color:#aaa; margin-top:0.2rem; }
  .room-code-inline strong{ color:#ffdd55; font-family:monospace; letter-spacing:0.15em; }

  .seat-area{ display:grid; grid-template-columns:1fr 1.2fr; gap:1rem; }
  @media (max-width:700px){ .seat-area{ grid-template-columns:1fr; } }

  .battle-seats{ display:flex; flex-direction:column; gap:0.75rem; }
  .seat{ background:#1e2e1e; border:2px solid #3a5a3a; border-radius:10px; padding:0.75rem;
    display:flex; flex-direction:column; gap:0.4rem; min-height:5rem; }
  .seat.empty{ border-style:dashed; opacity:0.7; }
  .seat.taken{ background:#1e2e2e; }
  .seat.mine{ border-color:#ffdd55; box-shadow:0 0 8px rgba(255,221,85,0.3); }
  .seat.ready{ background:#1e3a1e; border-color:#5aaa5a; }
  .battle-seat{ min-height:7rem; }
  .seat-label{ font-size:0.8rem; color:#888; font-weight:600; }
  .seat-name{ font-size:1.05rem; font-weight:700; color:#fff; }
  .seat-name.small{ font-size:0.9rem; }
  .seat-deck-info{ font-size:0.8rem; color:#aaffaa; }
  .seat-deck-info.muted{ color:#888; }
  .seat-status{ font-size:0.85rem; color:#ffdd55; }
  .seat-empty-hint{ font-size:0.85rem; color:#666; }
  .seat-empty-hint.small{ font-size:0.75rem; }

  .spectator-seats{ background:#181a24; border:1px solid #2a2a3a; border-radius:10px; padding:0.75rem; }
  .spectator-label{ font-size:0.85rem; color:#aaa; margin-bottom:0.5rem; font-weight:600; }
  .spectator-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:0.4rem; }
  @media (max-width:500px){ .spectator-grid{ grid-template-columns:repeat(2,1fr); } }
  .spec-seat{ min-height:3.5rem; padding:0.4rem; align-items:center; justify-content:center; text-align:center; }
  .btn-spec-take{ background:none; border:1px dashed #555; color:#888; border-radius:6px;
    padding:0.3rem 0.5rem; font:inherit; font-size:0.8rem; cursor:pointer; }
  .btn-spec-take:hover:not(:disabled){ border-color:#aaffaa; color:#aaffaa; }
  .btn-spec-take.small{ font-size:0.7rem; padding:0.2rem 0.4rem; }

  /* v2.273：內嵌座位卡內的牌組 dropdown + 準備按鈕 */
  .seat-deck-select{ padding:0.35rem 0.5rem; border:1px solid #4a6a8a; border-radius:6px;
    background:#1a2a3a; color:#f0f0f0; font:inherit; font-size:0.85rem; width:100%; }
  .seat-deck-select:disabled{ opacity:0.6; }
  .battle-seat .btn-sm{ width:fit-content; align-self:flex-start; }
  .btn-sm.primary{ background:#2a7a2a; color:#fff; border:none; border-radius:6px;
    padding:0.35rem 0.8rem; font:inherit; font-size:0.85rem; cursor:pointer; font-weight:600; }
  .btn-sm.primary:hover:not(:disabled){ background:#3a9a3a; }
  .btn-sm.primary:disabled{ opacity:0.4; cursor:not-allowed; }
  .btn-sm.primary.unready{ background:#7a3a3a; }
  .btn-sm.primary.unready:hover:not(:disabled){ background:#9a4a4a; }
  .btn-primary.unready{ background:#7a3a3a; }
  .btn-primary.unready:hover:not(:disabled){ background:#9a4a4a; }
  .or-host-name{ font-size:0.8rem; color:#aaa; }

  /* v2.276 Phase 3：觀戰模式 toolbar */
  .spec-chip{ background:#3a3a5a; color:#ffcc66; border:1px solid #5a5a8a; }
  .spec-toolbar{ display:inline-flex; gap:0.25rem; align-items:center; }
  .spec-btn{ background:#2a2a3a; color:#aaa; border:1px solid #3a3a4a; border-radius:6px;
    padding:0.25rem 0.6rem; font:inherit; font-size:0.8rem; cursor:pointer; }
  .spec-btn:hover{ background:#3a3a4a; color:#fff; }
  .spec-btn.active{ background:#4a3a6a; color:#ffcc66; border-color:#6a5a8a; font-weight:600; }

  /* ── v2.272 Phase 2 聊天室 ── */
  .chat-area{ background:#1a1a24; border:1px solid #3a3a4a; border-radius:10px;
    display:flex; flex-direction:column; overflow:hidden; min-height:200px; max-height:340px; }
  .chat-header{ background:#252535; padding:0.5rem 0.8rem; font-size:0.85rem; font-weight:600;
    color:#aaccff; border-bottom:1px solid #3a3a4a; }
  .chat-messages{ flex:1; overflow-y:auto; padding:0.5rem 0.8rem; display:flex; flex-direction:column; gap:0.4rem;
    min-height:120px; max-height:240px; }
  .chat-empty{ text-align:center; color:#666; margin:auto; }
  .chat-msg{ background:#222230; border:1px solid #2a2a3a; border-radius:8px; padding:0.4rem 0.6rem;
    align-self:flex-start; max-width:75%; }
  .chat-msg.mine{ align-self:flex-end; background:#1e3a3a; border-color:#3a6a6a; }
  .chat-name{ font-size:0.75rem; font-weight:700; color:#aaccff; margin-right:0.4rem; }
  .chat-msg.mine .chat-name{ color:#aaffaa; }
  .chat-time{ font-size:0.7rem; color:#888; }
  .chat-text{ font-size:0.9rem; color:#f0f0f0; word-break:break-word; white-space:pre-wrap; }
  .chat-input-row{ display:flex; gap:0.4rem; padding:0.5rem; border-top:1px solid #3a3a4a; background:#1e1e28; }
  .chat-input{ flex:1; padding:0.4rem 0.6rem; border:1px solid #3a3a4a; border-radius:6px;
    background:#0e0e18; color:#f0f0f0; font:inherit; font-size:0.85rem; }
  .chat-input:focus{ outline:1px solid #5a7aaa; }
  .chat-input:disabled{ opacity:0.4; }
  .chat-send{ font-size:0.85rem; padding:0.4rem 0.9rem; }

  .btn-primary{ display:inline-block; background:#2a7a2a; color:#fff; border:none; border-radius:8px; padding:0.6rem 1.4rem; font:inherit; font-size:1rem; font-weight:600; cursor:pointer; text-decoration:none; }
  .btn-primary:hover:not(:disabled){ background:#3a9a3a; }
  .btn-primary:disabled{ opacity:0.4; cursor:not-allowed; }
  .btn-secondary{ display:inline-block; background:#2a3a5a; color:#ccddff; border:1px solid #4a5a8a; border-radius:8px; padding:0.5rem 1.2rem; font:inherit; cursor:pointer; text-decoration:none; }
  .lobby-btns{ display:flex; gap:1rem; margin-top:1.5rem; align-items:center; }
  .export-btns{ margin-top:1rem; }
  .export-btns .btn-secondary{ font-size:.9rem; padding:.5rem .9rem; }
  .winner-text{ font-size:1.4rem; font-weight:700; color:#ffdd55; }
  /* v3.96 再來一局（對稱設計）UI 樣式 */
  .btn-primary.rematch-ready { background:#2a8a3a; border-color:#3aaa4a; }
  .btn-primary.rematch-ready:hover { background:#3a9a4a; }
  .rematch-hint { font-size:.95rem; margin-top:.8rem; text-align:center; color:#aacccc; }
  .back-home-link { display:inline-block; margin-top:.6rem; color:#88aacc; font-size:.85rem; text-decoration:underline; }
  .back-home-link:hover { color:#bbccdd; }

  /* v3.992 觀戰功能 UI */
  .open-room-row.playing-row { border-left: 3px solid #c4a84a; background: rgba(196, 168, 74, 0.05); }
  .btn-sm.spectator-btn {
    background: #6a4aaa; color: #fff; border: 1px solid #8a6acc;
  }
  .btn-sm.spectator-btn:hover:not(:disabled) {
    background: #7a5abb;
  }
  .btn-sm.spectator-btn:disabled {
    opacity: .5; cursor: not-allowed;
  }
  .spectator-toggle-row {
    margin: .6rem 0; padding: .5rem .8rem;
    background: rgba(106, 74, 170, 0.1); border: 1px solid rgba(106, 74, 170, 0.3);
    border-radius: 6px;
  }
  .spectator-toggle {
    display: flex; align-items: center; gap: .5rem; cursor: pointer;
    font-size: .9rem; color: #ccddee;
  }
  .spectator-toggle input[type="checkbox"] {
    width: 18px; height: 18px; cursor: pointer;
  }
  /* v5.329 對手閒置判定時間 slider */
  .idle-timeout-row { display: flex; flex-direction: column; gap: .35rem; }
  .idle-timeout-head { font-size: .9rem; color: #ccddee; }
  .idle-timeout-head strong { color: #ffd700; }
  .idle-timeout-range { width: 100%; accent-color: #6a4aaa; cursor: pointer; }

  /* v4.24 對戰計時器 chip — battle-header 內 4 個小 chip */
  .timer-chip {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.72rem;
    padding: 0.18rem 0.45rem;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: rgba(60, 90, 140, 0.32);
    color: #afdbff;
    border: 1px solid rgba(110, 160, 220, 0.18);
    letter-spacing: 0.02em;
  }
  .timer-chip .t-ic { opacity: 0.85; font-size: 0.78rem; }
  .timer-chip .t-lb { font-size: 0.62rem; opacity: 0.7; }
  .timer-chip .t-val { font-weight: 600; }
  .timer-chip.timer-turn { background: rgba(120, 80, 30, 0.4); color: #ffd494; border-color: rgba(255, 212, 148, 0.25); }
  .timer-chip.active { background: rgba(80, 120, 60, 0.4); color: #c8f0a0; border-color: rgba(180, 220, 120, 0.3); }

  /* v3.97 對戰中聊天室 ─────────────────────────────────────────────────── */
  .chat-fab {
    position: fixed; right: calc(18px + var(--safe-right, 0px)); bottom: calc(18px + var(--safe-bottom, 0px)); z-index: 9000;
    width: 54px; height: 54px; border-radius: 50%; border: 2px solid #d97a2a;
    background: #2a3a5a; color: #ffdd88; font-size: 1.6rem; cursor: grab;
    box-shadow: 0 4px 12px rgba(0,0,0,.4);
    display: flex; align-items: center; justify-content: center;
    transition: background .15s;
    /* v3.98 拖曳支援：touch-action none 防手機拖曳觸發 scroll；transform 由 inline style 控制 */
    touch-action: none;
    user-select: none;
  }
  .chat-fab:active { cursor: grabbing; }
  .chat-fab:hover { background: #3a4a7a; transform: scale(1.06); }
  .chat-fab-badge {
    position: absolute; top: -4px; right: -4px;
    min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px;
    background: #d94a3a; color: #fff; font-size: .8rem; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 4px rgba(0,0,0,.3);
  }
  /* v5.055：對手回合動作 panel — 仿 .chat-panel 樣式 */
  .opp-turn-toggle-btn {
    position: fixed; right: calc(18px + var(--safe-right, 0px)); bottom: calc(80px + var(--safe-bottom, 0px)); z-index: 8990;
    width: 48px; height: 48px; border-radius: 50%;
    background: #3a3a5a; color: #ffcc66;
    border: 2px solid #5a5a7a;
    font-size: 22px; cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,.45);
    transition: background .15s, transform .1s;
    /* v5.582 對齊 chat-fab：flex 置中 emoji（iPad baseline 偏移修正）+ touch-action none 防拖曳帶動背景 */
    display: flex; align-items: center; justify-content: center;
    line-height: 1; padding: 0;
    touch-action: none; user-select: none;
  }
  .opp-turn-toggle-btn:hover { background: #4a4a7a; transform: translateY(-2px); }
  .opp-turn-toggle-btn:active { transform: translateY(0); }

  .opp-turn-panel {
    position: fixed; right: calc(18px + var(--safe-right, 0px)); bottom: calc(80px + var(--safe-bottom, 0px)); z-index: 9001;
    width: 360px; max-height: 460px;
    background: #1a1a24; border: 2px solid #5a4a7a; border-radius: 10px;
    display: flex; flex-direction: column;
    box-shadow: 0 6px 24px rgba(0,0,0,.5);
    overflow: hidden;
  }
  .opp-turn-panel-header {
    background: #2a253a; padding: .55rem .55rem .55rem .85rem;
    font-size: .85rem; font-weight: 600; color: #ddccff;
    display: flex; justify-content: space-between; align-items: center;
    cursor: move; user-select: none; touch-action: none;
    border-bottom: 1px solid #4a3a5a;
  }
  .opp-turn-panel-title {
    display: flex; align-items: center; gap: 6px;
    flex: 1; min-width: 0;
  }
  .opp-turn-title-text { flex: 1; text-align: center; }
  .opp-turn-title-sub { font-size: .72rem; color: #aa99cc; font-weight: 400; }
  .opp-turn-nav-btn {
    background: rgba(255,255,255,.08); border: 1px solid #5a4a7a;
    color: #ccddff; width: 24px; height: 24px; border-radius: 4px;
    cursor: pointer; font-size: .8rem; flex-shrink: 0;
    transition: background .15s;
  }
  .opp-turn-nav-btn:hover:not(:disabled) { background: rgba(255,255,255,.18); }
  .opp-turn-nav-btn:disabled { opacity: .3; cursor: not-allowed; }
  .opp-turn-panel-close {
    background: none; border: none; color: #aaa;
    font-size: 1.2rem; cursor: pointer; padding: 0 .3rem;
    flex-shrink: 0;
  }
  .opp-turn-panel-close:hover { color: #fff; }

  .opp-turn-panel-body {
    flex: 1; overflow-y: auto;
    padding: .6rem;
    background: #15151f;
  }
  .opp-turn-actions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: .4rem;
  }
  .opp-turn-action-item {
    display: flex; flex-direction: column; align-items: center;
    gap: 2px;
  }
  .opp-turn-card-img {
    width: 100%; max-width: 80px;
    border-radius: 4px; cursor: zoom-in;
    transition: transform .12s;
    border: 1px solid #3a3a4a;
  }
  .opp-turn-card-img:hover {
    transform: scale(1.06);
    border-color: #aa88ff;
  }
  .opp-turn-card-placeholder {
    width: 80px; height: 112px;
    background: #2a2a3a; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    color: #555; font-size: 1.5rem;
  }
  .opp-turn-action-label {
    font-size: .65rem; text-align: center;
    padding: 1px 4px; border-radius: 3px;
    line-height: 1.2;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .opp-turn-action-label.attack { background: rgba(180,80,80,.35); color: #ffccaa; }
  .opp-turn-action-label.retreat { background: rgba(180,140,60,.35); color: #ffe0aa; }
  .opp-turn-action-label.ability { background: rgba(120,80,200,.35); color: #ddccff; }
  .opp-turn-action-label.discard { background: rgba(100,100,100,.4); color: #aaa; }

  /* v5.057：被丟棄的牌 — 灰調 + 半透明區別於主動打出的牌 */
  .opp-turn-action-item.discard .opp-turn-card-img {
    opacity: 0.45;
    filter: grayscale(0.7) brightness(0.85);
    border-color: #5a5a6a;
  }
  .opp-turn-action-item.discard .opp-turn-card-img:hover {
    opacity: 0.85;
    filter: grayscale(0.3) brightness(1);
  }

  .opp-turn-empty {
    text-align: center; padding: 1.5rem .5rem;
    color: #777; font-size: .85rem;
  }

  /* Mobile RWD — v5.196：自適應內容 + 保留拖曳
     原 (orientation: portrait) 強制 left/right/top/bottom 填滿螢幕 → 卡片少時下方大片空白；
       且 transform: none !important 讓拖曳完全失效。
     v5.196 改：拿掉 orientation gate（手機橫放也套用），max-width: min(360px, 92vw) 
       讓 panel 自然依內容大小；保留 transform 讓玩家可拖移到不擋視線的位置。 */
  @media (max-width: 600px) {
    .opp-turn-toggle-btn {
      right: 2.5vw; bottom: max(var(--safe-bottom, 0px) + 60px, 70px);
    }
    .opp-turn-panel {
      /* 自然大小，依內容自適應；上限 92vw / 75vh 避免超出螢幕 */
      width: min(360px, 92vw);
      max-width: 92vw;
      max-height: 75vh;
      /* 不固定位置 — 用桌面預設的 right: 18px; bottom: 80px; 並保留 transform 給拖曳 */
    }
    /* v5.196：手機版仍要可拖（移除 cursor: default 覆蓋 + 不再 transform: none） */
    .opp-turn-panel-header { cursor: move; }
  }

  .chat-panel {
    position: fixed; right: calc(18px + var(--safe-right, 0px)); bottom: calc(18px + var(--safe-bottom, 0px)); z-index: 9000;
    width: 350px; height: 450px;
    background: #1a1a24; border: 2px solid #4a4a6a; border-radius: 10px;
    display: flex; flex-direction: column;
    box-shadow: 0 6px 24px rgba(0,0,0,.5);
    overflow: hidden;
    /* v5.168：手機雙擊不放大瀏覽器頁面（玩家回報雙擊後 viewport zoom 卡住關不掉） */
    touch-action: manipulation;
  }
  .chat-panel-header {
    background: #252535; padding: .55rem .85rem;
    font-size: .9rem; font-weight: 600; color: #ccddee;
    display: flex; justify-content: space-between; align-items: center;
    cursor: move; user-select: none; touch-action: none;
    border-bottom: 1px solid #3a3a4a;
    /* v5.168：sticky top 確保 header (含 X 按鈕) 永遠在頂部不被內容捲走 */
    position: sticky; top: 0; z-index: 50; flex-shrink: 0;
  }
  .chat-panel-close {
    background: none; border: none; color: #aabbcc; font-size: 1.4rem;
    cursor: pointer; padding: 0 .3rem; line-height: 1;
    /* v5.168：確保 X 按鈕永遠在最上層，玩家絕對點得到 */
    position: relative; z-index: 100;
  }
  .chat-panel-close:hover { color: #fff; }
  .chat-panel-messages {
    flex: 1; min-height: 0; overflow-y: auto; padding: .5rem .8rem;
    display: flex; flex-direction: column; gap: .4rem;
    background: #15151f;
    /* v5.580：iPad/iOS 觸控慣性捲動 + 允許垂直拖曳捲動(不被父層 touch-action 吃掉) */
    -webkit-overflow-scrolling: touch; touch-action: pan-y; overscroll-behavior: contain;
  }
  /* v5.580：浮動對話面板字體縮小(玩家回報 iPad 太大)；只影響浮動面板，不動其他聊天 */
  .chat-panel .chat-text { font-size: .78rem; }
  .chat-panel .chat-name { font-size: .68rem; }
  .chat-panel .chat-time { font-size: .62rem; }
  .chat-panel .chat-msg { padding: .3rem .5rem; }
  .chat-panel .chat-input-row {
    display: flex; gap: .4rem; padding: .5rem;
    border-top: 1px solid #3a3a4a; background: #1e1e28;
  }
  /* v3.971 手機 portrait：縮小 modal 範圍（避免頂到 iOS 動態島 / Home indicator）
     - 95% 寬 + 高度限制（min(85vh, 600px) 避免大螢幕拉太長）
     - 置中於螢幕（top/left 用 auto + transform 抵消）
     - 加 safe-area-inset 邊距處理瀏海 / 動態島 / 底部 home indicator */
  @media (max-width: 600px) and (orientation: portrait) {
    .chat-panel {
      /* v5.626 改 left/top + 固定尺寸(不再 left+right/top+bottom stretch)→ 讓 margin 位移可乾淨拖曳；
         仍 transform:none(避免 iOS position:fixed+transform 破壞內部捲動)。 */
      left: 2.5vw; right: auto;
      top: max(var(--safe-top, 0px), 40px); bottom: auto;
      width: 95vw; height: 55vh; max-height: 55vh;
      border-radius: 12px;
      border: 2px solid #4a4a6a;
      transform: none !important;
    }
    .chat-panel-header {
      cursor: move;
      padding: .7rem 1rem;
      font-size: 1rem;
    }
    .chat-panel-close {
      font-size: 1.8rem;
      padding: 0 .5rem;
      min-width: 44px;  /* touch target 至少 44×44 (Apple HIG) */
      min-height: 44px;
    }
    .chat-fab {
      right: 12px; bottom: 12px;
      width: 50px; height: 50px;
    }
  }

  /* ── 勝負畫面（Session 27） ── */
  .gameover-screen{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:2rem; background:radial-gradient(circle at 50% 40%, #1a2e3a 0%, #000 80%); font-family:system-ui,'Microsoft JhengHei',sans-serif; color:#f0f0f0; position:relative; overflow:hidden; }
  .gameover-screen::before{ content:''; position:absolute; inset:-50%; background:conic-gradient(from 0deg at 50% 50%, transparent, rgba(255,212,74,.06), transparent, rgba(136,204,255,.06), transparent); animation:slow-spin 20s linear infinite; pointer-events:none; }
  @keyframes slow-spin{ to{transform:rotate(360deg)} }
  .gameover-card{ background:linear-gradient(160deg,#1a2a3a,#0a1a2a); border:2px solid #3a5a8a; border-radius:16px; padding:2.5rem 3rem; text-align:center; max-width:500px; box-shadow:0 20px 60px rgba(0,0,0,.8); position:relative; z-index:1; }
  .gameover-icon{ font-size:5rem; margin-bottom:.5rem; display:inline-block; animation:bounce 1.5s ease-in-out infinite; }
  .gameover-icon.win{ filter:drop-shadow(0 0 24px rgba(255,212,74,.9)); }
  .gameover-icon.lose{ filter:grayscale(.4) drop-shadow(0 0 18px rgba(200,80,80,.6)); }
  @keyframes bounce{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
  .gameover-title{ font-size:3rem; font-weight:800; margin:.2rem 0 1rem; letter-spacing:.08em; }
  .gameover-title.win{ color:#ffd44a; text-shadow:0 0 20px rgba(255,212,74,.7), 0 0 40px rgba(255,212,74,.3); }
  .gameover-title.lose{ color:#cc6666; text-shadow:0 0 18px rgba(200,80,80,.5); }

  /* v4.21 勝負浮動視窗 — overlay 在戰鬥盤上，可拖曳 */
  .gameover-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    width: min(440px, 90vw);
    max-height: 88vh;
    overflow-y: auto;
    background: linear-gradient(160deg, #1a2a3a, #0a1a2a);
    border: 2px solid #3a5a8a;
    border-radius: 14px;
    box-shadow: 0 16px 50px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255,212,74,.2);
    z-index: 9999;
    pointer-events: auto;
  }
  .gameover-modal-header {
    background: linear-gradient(90deg, #2a3a5a, #1a2a4a);
    border-radius: 12px 12px 0 0;
    padding: 0.5rem 0.8rem;
    cursor: grab;
    user-select: none;
    color: #ffd44a;
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    text-align: center;
    border-bottom: 1px solid #3a5a8a;
  }
  .gameover-modal-header:active { cursor: grabbing; }
  .gameover-modal-drag-hint { opacity: 0.8; }
  .gameover-modal-body {
    padding: 1.5rem 2rem 1.8rem;
    text-align: center;
    color: #f0f0f0;
  }
  .gameover-modal-body .gameover-icon { font-size: 3.6rem; margin-bottom: 0.2rem; }
  .gameover-modal-body .gameover-title { font-size: 2.2rem; margin: 0.1rem 0 0.6rem; }
  .gameover-modal-body .winner-text { font-size: 1.05rem; color: #ffe89e; font-weight: 600; margin: 0.4rem 0 0.2rem; }
  .gameover-modal-body .muted { font-size: 0.85rem; margin: 0.3rem 0 0.8rem; }
  .gameover-modal-body .lobby-btns { display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap; margin-top: 0.6rem; }
  .gameover-modal-body .rematch-hint { font-size: 0.78rem; margin-top: 0.4rem; }
  .gameover-modal-body .back-home-link { display: inline-block; margin-top: 0.6rem; font-size: 0.8rem; color: #88aacc; }
  @media (max-width: 600px) and (orientation: portrait) {
    /* v5.032：max-height 從 92vh 縮到 calc(100vh - safe-area-top - safe-area-bottom - 24px)
       避免 modal 上緣壓到 iOS 動態島 / 瀏海，下緣壓到 home indicator。 */
    .gameover-modal {
      width: 92vw;
      max-height: calc(100vh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px);
    }
    .gameover-modal-body { padding: 1rem 1.2rem 1.4rem; }
    .gameover-modal-body .gameover-icon { font-size: 2.8rem; }
    .gameover-modal-body .gameover-title { font-size: 1.7rem; }
  }

  /* Setup */
  .setup-screen{ background:#1a2a1a; border-radius:10px; }
  .setup-screen h2{ color:#aaffaa; }
  .mulligan-banner{ background:#3a2a0e; border:1px solid #6a5a1a; color:#f8d080; padding:.5rem .8rem; border-radius:6px; margin-bottom:.8rem; font-size:.85rem; }
  .shuffle-ic{ display:inline-block; animation:spin 1.5s linear infinite; }
  @keyframes spin{ from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  .setup-active,.setup-bench-row{ margin:0.5rem 0; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; }
  .poke-chip{ padding:0.2rem 0.5rem; border-radius:6px; font-size:0.85rem; }
  .active-chip{ background:#3a7a3a; color:#fff; }
  .bench-chip{ background:#2a4a6a; color:#cdf; }
  .hand-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:0.5rem; margin:0.5rem 0 1rem; }
  .hand-card{ background:#2a3a2a; border:1px solid #3a5a3a; border-radius:6px; padding:0.4rem; display:flex; flex-direction:column; align-items:center; gap:0.25rem; font-size:0.75rem; color:#ddd; }
  .hand-card img{ width:70px; border-radius:4px; }
  .hand-card-name{ text-align:center; font-size:0.72rem; }
  /* v5.940 回放攤牌手牌(面朝上,唯讀) */
  .spectator-hand-face{ cursor:pointer; transition:transform .12s ease; }
  .spectator-hand-face:hover{ transform:translateY(-6px); z-index:5; }
  .replay-hand-img{ width:70px; border-radius:4px; display:block; }
  .hand-card.selectable{ border-color:#6aaa6a; cursor:pointer; }
  .card-type-tag{ font-size:0.65rem; color:#888; }
  .small{ padding:0.2rem 0.5rem; border-radius:4px; border:1px solid #5a5a5a; background:#2a2a2a; color:#ddd; cursor:pointer; font:inherit; font-size:0.78rem; }
  .small.danger{ color:#f88; border-color:#a44; }
  .small.primary{ background:#2a5a2a; color:#aef; border-color:#4a8a4a; }

  .zoomable{ cursor:zoom-in; }
  .zoomable:hover{ opacity:0.85; outline:2px solid #aaff4488; border-radius:3px; }

  /* ════ Battle ════ */
  /* v2.198 viewport 適配：原 height:100vh + overflow:hidden 在視窗高度不足時（沒全螢幕、有 DevTools 開啟、行動裝置）
     會把底部 hand-strip 切掉。改用 min-height + overflow-y:auto，讓視窗太小時整頁可滾動，手牌不會消失。
     大視窗用戶不受影響（min-height:100vh 仍撐滿）。100dvh 為現代瀏覽器動態 viewport（行動裝置 URL bar 友善）。 */
  /* v5.478 系統管理員廣播跑馬燈 */
  .admin-broadcast-bar{
    position:fixed; top:0; left:0; right:0; z-index:99999;
    /* v6.187：貼 top:0 → 讓開動態島（box-sizing 讓 padding 算進 height 內） */
    /* ⭐⭐⭐ v6.195：v6.187 只把「整條 bar」讓開動態島，裡面那顆 ✕ 沒動。
       ✕ 是 position:absolute; top:50%，而 50% 是相對**整個 padding box**
       （=34px + 安全區 59px = 93px）→ 中心落在 46.5px、整顆(22px)都在
       iPhone 動態島的 59px 安全區裡 ⇒ 玩家**按不到跑馬燈的 ✕**。
       改法：內容列高度 = 34px + min(10px, var(--safe-top))：
         • --safe-top:0px（非 iPhone）→ 34px，與 v6.194 完全相同（版面 0 位移）
         • --safe-top:59px（動態島）→ 44px，剛好讓 ✕ 的 44×44 觸控區
           完整落在安全區**下方**（Apple HIG 最小觸控目標）。
       ⚠ 高度寫成字面運算（不用 CSS 自訂屬性），守衛才能直接求值。 */
    box-sizing:border-box; padding-top:var(--safe-top, 0px); padding-left:var(--safe-left, 0px);
    height:calc(34px + min(10px, var(--safe-top, 0px)) + var(--safe-top, 0px)); display:flex; align-items:center; overflow:hidden;
    background:linear-gradient(90deg,#7a1fa2,#c2185b);
    color:#fff; font-weight:700; font-size:.95rem;
    box-shadow:0 2px 10px rgba(0,0,0,.45);
  }
  /* v5.632 玩家社群賽募集跑馬燈：綠底，與管理員廣播(紫粉)區分 */
  .admin-broadcast-bar.community{ background:linear-gradient(90deg,#0f7a3d,#1f9d57); }
  .admin-broadcast-track{
    white-space:nowrap; will-change:transform;
    animation: bc-scroll 14s linear 1;
    padding-right:3rem;
  }
  @keyframes bc-scroll{ from{ transform:translateX(100vw); } to{ transform:translateX(-100%); } }
  /* ⭐⭐⭐ v6.195：✕ 的**可點區**改成「44px 寬 × 內容列高」並整塊釘在
     var(--safe-top) 之下（top 不再用 50%，因為 50% 會把 padding-top 一起算進去）。
     可見的 22px 圓圈改由 ::before 畫：::before 的 top:50% 是相對**按鈕自己**的
     內容列，--safe-top:0px 時圓心位置與 v6.194 逐像素相同（right:6px、垂直中心 17px）。
     ⚠ 按鈕本體 font-size:0，避免原本的文字節點與 ::before 重複畫出兩個 ✕；
       aria-label / title 仍在 template 上，輔助技術不受影響。 */
  .admin-broadcast-close{
    position:absolute; right:var(--safe-right, 0px); top:var(--safe-top, 0px);
    width:44px; height:calc(34px + min(10px, var(--safe-top, 0px)));
    border:none; background:none; padding:0; margin:0; cursor:pointer;
    font-size:0; color:transparent; line-height:0; -webkit-tap-highlight-color:transparent;
  }
  .admin-broadcast-close::before{
    content:'✕';
    position:absolute; right:6px; top:50%; transform:translateY(-50%);
    width:22px; height:22px; border-radius:50%;
    background:rgba(0,0,0,.3); color:#fff; font-size:.78rem; line-height:1;
    display:flex; align-items:center; justify-content:center;
  }
  .battle-root{ min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; font-family:system-ui,'Microsoft JhengHei',sans-serif; color:#f0f0f0; overflow-y:auto; overflow-x:hidden; }

  /* v2.280：桌機 header 改 nowrap + overflow-x:auto。
     原本 flex-wrap:wrap 在 setup 階段 header chips 少不會換行，但遊戲開始後 turn-res
     （4 個資源 chip）+ 動態 chips（同步中/AI 思考中等）會擠到第 2~3 行，
     header 額外多 26-30px×N → 撐高 .battle-root 超過視窗，右側出滾輪。
     改 nowrap + overflow-x:auto 後 chip 太多時水平捲動（桌機通常很寬，正常 1080p 不會觸發），
     header 高度永遠是 1 行，setup vs playing 視覺一致。flex-shrink:0 防 chip 內容被壓扁。 */
  /* v5.070：padding-top 加 env(safe-area-inset-top) — 避開 iOS 動態島 / 瀏海。
     正式站 (.com) 沒有上方 banner，battle-header 是第一個元素直接觸頂；
     iOS Safari / iPad 在橫向時動態島 / status bar 會蓋住最上排 chip（v、設定、全螢幕）。
     viewport-fit=cover 已在 app.html 啟用，env() 才有值。 */
  .battle-header{ display:flex; align-items:center; gap:0.6rem; background:#0a180a; padding:calc(0.35rem + var(--safe-top, 0px)) 0.75rem 0.35rem 0.75rem; border-bottom:1px solid #2a4a2a; flex-shrink:0; flex-wrap:nowrap; overflow-x:auto; overflow-y:hidden; }
  .battle-header > *{ flex-shrink:0; }
  .small-back{ color:#88ccff; text-decoration:none; font-size:0.82rem; background:none; border:none; cursor:pointer; padding:0; }
  .small-back:hover{ text-decoration:underline; }
  .turn-info{ flex:1; font-size:0.88rem; white-space:nowrap; }
  .hint{ color:#888; font-size:0.75rem; }
  .phase-tag{ font-size:0.78rem; color:#aaffaa; background:#0e2e0e; padding:0.18rem 0.5rem; border-radius:4px; }
  .hand-counts{ display:flex; gap:0.28rem; align-items:center; flex-wrap:nowrap; }
  .hand-count-chip{ background:#1a2a3a; color:#9cf; border-color:#2a4a6a; font-size:0.7rem; padding:0.14rem 0.45rem; }
  .hand-count-chip.hc-active{ background:#2a3e1a; color:#cfa; border-color:#4a6a2a; box-shadow:0 0 4px rgba(150,255,100,.25); }
  .status-chips{ display:flex; gap:0.3rem; flex-wrap:nowrap; }
  .chip{ font-size:0.68rem; padding:0.1rem 0.35rem; border-radius:10px; background:#1a3a1a; color:#8f8; border:1px solid #2a5a2a; }
  .role-chip{ background:#1a1a3a; color:#aaf; border-color:#2a2a5a; }
  .room-chip{ background:#10241a; color:#7fe; border-color:#1a4a3a; font-weight:700; letter-spacing:0.5px; }
  .version-chip{ background:#2a1a3a; color:#c0a0e0; border-color:#4a3a6a; font-family:monospace; }
  .wait-chip{ background:#3a2a1a; color:#fa8; border-color:#5a3a1a; }
  .syncing-chip{ background:#3a3a1a; color:#ff8; border-color:#5a5a1a; }
  /* v6.149 連線健康橫幅（失聯提示）*/
  .net-warn-banner{ display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; justify-content:center;
    background:#5a1f1f; color:#ffdede; border:1px solid #a34; border-radius:6px;
    padding:.45rem .8rem; margin:0 0 .4rem; font-size:.9rem; font-weight:600; }
  .net-warn-btn{ background:#fff; color:#7a1f1f; border:none; border-radius:4px; padding:.2rem .6rem;
    font:inherit; font-weight:700; cursor:pointer; }
  .net-warn-x{ background:transparent; color:#ffdede; border:1px solid #a34; border-radius:4px;
    padding:.1rem .4rem; font:inherit; cursor:pointer; }
  /* v6.170 動作自動重送中（橘：警示但不是錯誤 —— 這件事系統正在自己處理）*/
  .act-retry-banner{ display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; justify-content:center;
    background:#5a3a12; color:#ffe9c9; border:1px solid #b8791f; border-radius:6px;
    padding:.45rem .8rem; margin:0 0 .4rem; font-size:.9rem; font-weight:600; }
  /* v6.170 對手連線不穩（藍：純資訊，不是我方的錯誤，配色刻意與紅色的失聯橫幅分開）*/
  .opp-quiet-banner{ display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; justify-content:center;
    background:#16324a; color:#cfe6ff; border:1px solid #2f6d9e; border-radius:6px;
    padding:.45rem .8rem; margin:0 0 .4rem; font-size:.88rem; font-weight:600; }
  /* v6.172 動作排隊中（綠：系統收到了、正在照順序處理，不是錯誤也不是警告）*/
  .act-queue-banner{ display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; justify-content:center;
    background:#14371f; color:#cdf5da; border:1px solid #2f7d4c; border-radius:6px;
    padding:.45rem .8rem; margin:0 0 .4rem; font-size:.88rem; font-weight:600; }
  /* v6.172 「剛剛那一下怎麼了」的短暫說明（灰：純告知，數秒後自動收掉）*/
  .act-notice-banner{ display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; justify-content:center;
    background:#2a2f38; color:#e6ecf5; border:1px solid #4a5568; border-radius:6px;
    padding:.4rem .8rem; margin:0 0 .4rem; font-size:.86rem; font-weight:600; }
  /* v6.147 錦標賽動作送出中：手牌整排變淡且不可拖（v6.172 起只有「佇列已滿」才會這樣，見 actionBusy） */
  .hand-card.action-busy{ opacity:.5; cursor:progress; }
  .fs-chip{ background:#1a2a3a; color:#8cf; border-color:#2a4a6a; cursor:pointer; font-size:0.68rem; }
  .fs-chip:hover{ background:#2a3a5a; }
  .waiting-msg{ color:#fa8; font-size:0.85rem; font-style:italic; }
  .turn-res{ display:flex; gap:0.3rem; align-items:center; margin-left:auto; }
  .res-item{ display:flex; align-items:center; gap:.2rem; padding:.15rem .4rem; border-radius:4px; background:#0e3a1e; border:1px solid #2a6a3a; font-size:.7rem; color:#9fa; }
  .res-item.res-used{ background:#3a0e0e; border-color:#6a2a2a; color:#faa; opacity:.75; }
  .res-ic{ font-size:.78rem; }
  .res-lb{ font-weight:600; }
  .res-st{ font-size:.62rem; opacity:.85; padding-left:.15rem; border-left:1px solid rgba(255,255,255,.15); margin-left:.15rem; }

  .playmat{ flex:1; display:grid; grid-template-rows:minmax(230px,1fr) auto minmax(230px,1fr); overflow:visible; position:relative;
    /* v4.25：isolation: isolate 形成 stacking context — 讓 .stadium-bg-layer (z-index:-1)
       畫在 .playmat 綠色 gradient 之上、field-row 之下（v4.22 失誤原因：沒這條時 z-index:-1
       逃出本地 stacking、被自己的 gradient 蓋住）。 */
    isolation: isolate;
    background:
      radial-gradient(circle at 50% 50%, rgba(80,130,90,.12), transparent 72%),
      repeating-linear-gradient(45deg, rgba(0,0,0,.05) 0 2px, transparent 2px 8px),
      linear-gradient(180deg,rgba(0,60,0,.28) 0%,rgba(0,40,0,.1) 48%,rgba(0,0,0,.55) 50%,rgba(0,40,0,.1) 52%,rgba(0,60,0,.28) 100%),
      linear-gradient(135deg,#1e3a20,#1a2e1a); }
  .playmat::before{ content:''; position:absolute; left:50%; top:50%; width:84%; height:66%; transform:translate(-50%,-50%); border:2px dashed rgba(120,170,120,.12); border-radius:16px; pointer-events:none; transition:border-color .2s, box-shadow .2s; }
  /* 拖曳訓練家類卡時，整個 playmat 內部虛線框變綠發光 */
  .playmat.trainer-drop-zone::before{
    border-color: rgba(100,255,130,.7);
    border-style: solid;
    box-shadow: 0 0 30px rgba(100,255,130,.35), inset 0 0 30px rgba(100,255,130,.15);
  }

  /* v4.22 場地卡在場時的背景圖層 — absolute + z-index:-1 → 蓋 playmat gradient 底色但在 field-row 之下 */
  /* v4.31：換 background-image → <img> 元素 + transform translateY，精準只截藝術區
       PTCG 卡版面：頂 ~18% labels（競技場/訓練家/卡名），中 ~46% 藝術區，底 ~36% 文字
       width 100% + height auto → 圖高 = 容器寬 × 1.4
       translateY(-18%) → 上移圖自身 18%，藝術區頂端對齊容器頂
       overflow:hidden 切掉底端（含文字區），mask 漸層處理 narrow viewport 文字殘留 */
  .stadium-bg-layer {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
  }
  .stadium-bg-layer img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: auto;
    transform: translateY(-18%);
    opacity: 0.55;
    filter: blur(1.2px);
    -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0.5) 70%, rgba(0,0,0,0.15) 88%, transparent 100%);
    mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0.5) 70%, rgba(0,0,0,0.15) 88%, transparent 100%);
  }

  .field-row{ display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.7rem; overflow:visible; min-height:0; }
  .opponent-row{ border-bottom:2px solid #2a5a2a; background:rgba(0,0,0,.2); align-items:flex-end; padding-bottom:0.6rem; }
  /* v2.03：還原為對稱 padding，依靠 overflow:visible 讓按鈕自然延伸到場地外即可 */
  .my-row{ border-top:2px solid #2a5a2a; align-items:flex-end; padding-bottom:0.6rem; }

  .zone-prizes{ flex-shrink:0; display:flex; flex-direction:column; align-items:center; gap:0.2rem; }
  .prize-grid{ display:grid; grid-template-columns:1fr 1fr; gap:3px; }
  .prize-card{ width:32px; height:45px; background:linear-gradient(135deg,#1e4a8a,#2a6ab0); border:1px solid #4a8ac0; border-radius:4px; }
  .prize-card.prize-faceup{ overflow:hidden; border-color:#ffd23f; box-shadow:0 0 4px #ffd23f; background:#111; }
  .prize-face-img{ width:100%; height:100%; object-fit:cover; border-radius:3px; display:block; }
  /* v6.096「傳說」兩張合一競技場：獎賞卡翻正面也裁半。
     ⭐ 回放（isTReplay）會把 6 張獎賞全部翻正面 → 只要牌組帶傳說、有半張進獎賞就會看到。
     .prize-card 是 32×45 固定框 + 本來就 cover → 只需 object-position（不需 aspect-ratio）。 */
  .prize-face-img.legend-half-l { object-position: 0% 50%; }
  .prize-face-img.legend-half-r { object-position: 100% 50%; }
  .prize-card.my-prize{ background:linear-gradient(135deg,#2a6a1a,#3a8a2a); border-color:#5aaa4a; }
  .prize-card.prize-gone{ background:transparent; border-color:#2a3a2a; opacity:.25; animation:none !important; }
  /* 獎賞卡放置動畫：從上方 fly-in + rotate + scale，by animation-delay 錯開 */
  /* v5.129：獎賞卡動畫差別化 — 跟一般發牌（draw-fly）區隔
     改 1.2s + 大 zoom + rotate 360°，並加金色 glow 凸顯特殊性 */
  .prize-card.prize-anim{ animation:prize-deal 1.2s cubic-bezier(.2,.9,.35,1.15) both; transform-origin:center; }
  @keyframes prize-deal{
    0%   { transform:scale(0) rotate(0deg); opacity:0; box-shadow:0 0 0 rgba(255,215,0,0); }
    25%  { transform:scale(2.4) rotate(180deg); opacity:1; box-shadow:0 0 30px rgba(255,215,0,.9); }
    55%  { transform:scale(2.0) rotate(360deg); opacity:1; box-shadow:0 0 36px rgba(255,215,0,.7); }
    85%  { transform:scale(1.18) rotate(360deg); opacity:1; box-shadow:0 0 14px rgba(255,215,0,.4); }
    100% { transform:none; opacity:1; box-shadow:none; }
  }
  .zone-label-sm{ font-size:.62rem; color:#888; text-align:center; white-space:nowrap; }
  .opp-label{ color:#aa8888; }

  /* 先攻/後攻 標記（場地行首常駐顯示）
   * v2.16 Bug #108：新增標籤 + 先攻金色高亮。
   * v2.17 Bug #115：金色高亮改表示「目前回合輪到誰」，文字本身已傳達先攻/後攻。 */
  .turn-order-chip{
    flex-shrink:0;
    align-self:center;
    font-size:.72rem; font-weight:700;
    padding:.2rem .45rem;
    border-radius:6px;
    background:rgba(60,60,80,.45);
    color:#99a;
    border:1px solid #556;
    letter-spacing:.1em;
    writing-mode:vertical-rl; text-orientation:upright;
    min-height:3rem;
    display:flex; align-items:center; justify-content:center;
    transition:background .2s, color .2s, border-color .2s, box-shadow .2s;
  }
  .turn-order-chip.active-turn{
    background:linear-gradient(180deg, rgba(255,200,60,.25), rgba(255,140,40,.25));
    color:#ffd35a;
    border-color:#ffb732;
    box-shadow:0 0 8px rgba(255,180,60,.25);
  }
  .sel-hint-warn{
    font-size:.78rem; color:#ffcc66; padding:.25rem .5rem;
    background:rgba(120,80,20,.25); border:1px solid #aa7722;
    border-radius:4px; text-align:center; margin-bottom:.3rem;
  }

  /* v3.40：align-self: center 覆蓋 .field-row 的 align-items: flex-end，戰鬥場上下置中 */
  .zone-active{ flex-shrink:0; width:300px; display:flex; flex-direction:column; gap:0.2rem; align-self:center; }
  .my-active-zone{ position:relative; }
  /* v2.45 Leon feedback：戰鬥場框大小固定，不因 tool/ability-used/status chip 出現而變長變短；
     min-height 170px 預留最壞情形（名字/HP bar/HP/能量/裝備/特性已用/狀態）。 */
  .active-card{ display:flex; gap:0.45rem; background:rgba(0,0,0,.35); border:1px solid #3a5a3a; border-radius:8px; padding:0.45rem 0.5rem; align-items:flex-start; position:relative; cursor:default; min-height:170px; }
  .active-card.opp-active{ border-color:#5a3a3a; background:rgba(0,0,0,.4); }
  .active-card.mine-active{ border-color:#3a6a3a; }
  .active-card.energy-target{ border-color:#aaff44; cursor:pointer; animation:glow 1s infinite alternate; }
  /* v2.54: 我方戰鬥場在「選擇附加能量目標」時不再套黃框動畫（上方 zone-label 已標示為戰鬥場），
     僅保留 pointer cursor 提示可點擊，避免與 pending-selection 黃框 UI 混淆。 */
  .active-card.energy-clickable{ cursor:pointer; }
  /* active-empty: 讓空戰鬥場佔用與放置寶可夢後接近的空間，避免 setup 時 drop target 比實際位置小很多 */
  .active-card.active-empty{ justify-content:center; align-items:center; color:#888; font-size:.9rem; text-align:center; padding:1.4rem; border:2px dashed #444; background:rgba(0,0,0,.25); min-height:160px; font-weight:600; }
  .active-card.active-empty.drop-zone{ border-color:#88aaff; color:#cce; background:rgba(40,70,120,.3); border-width:3px; }
  .active-img{ width:105px; border-radius:5px; flex-shrink:0; }
  /* 設置階段對手卡蓋牌：紅藍漸層 + Pokéball 風格 */
  .card-back{ background:radial-gradient(circle at 50% 50%, #f0f4ff 0 12%, #ffffff 12% 14%, #1a1a1a 14% 18%, #c0392b 18% 50%, #922b21 50% 100%); border:2px solid #1a1a1a; border-radius:6px; box-shadow:inset 0 0 6px rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .card-back-mark{ font-family: 'Times New Roman', serif; font-weight:900; font-size:1.4rem; color:rgba(255,255,255,.85); text-shadow:0 1px 2px rgba(0,0,0,.7); }
  .card-back-sm{ width:96px; height:128px; }
  .card-back-lg{ width:105px; height:140px; }
  .card-back-active .active-info{ color:#bbb; }
  .card-back-active .active-name{ font-style:italic; }
  .card-back-slot{ cursor:default !important; }
  /* v2.122：position + z-index 保險 — 避免 v2.118 .attack-flash::after 的
     mix-blend-mode 殘留影響 hp-bar / tool-chip 等 inner element 顯示。
     `isolation: isolate` 建立新 stacking context，::after 的 blend 只作用於
     card 內部，不再滲到 active-info 元素上。 */
  .active-info{ flex:1; min-width:0; position:relative; z-index:2; }
  .active-card{ isolation:isolate; }
  .hp-bar-wrap{ position:relative; z-index:2; }
  .active-name{ font-size:1rem; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:.2rem; }
  .active-hp{ font-size:.88rem; color:#ccc; }
  .active-nrg{ font-size:.8rem; color:#aaa; margin-top:.2rem; }
  /* v2.52：戰鬥場能量 pip 改為垂直排列在卡圖右側（與備戰的 .bench-nrg 一致）。
     pip 比 bench 版本略大以符合戰鬥場比例（寬≈18px、高=16px）。 */
  .active-nrg-col{ display:flex; flex-direction:column; align-items:center; gap:3px; flex-shrink:0; padding-top:.2rem; line-height:1; }
  /* v3.93：戰鬥場能量 pip 更大 — 從 18×16/.66rem 提升到 24×22/.86rem */
  .active-nrg-col .nrg-pip{ min-width:24px; height:22px; font-size:.86rem; padding:0 5px; border-radius:11px; }
  .attach-hint{ font-size:.75rem; color:#aaff44; font-weight:700; margin-top:.2rem; }
  @keyframes glow{ from{box-shadow:0 0 4px #aaff44}to{box-shadow:0 0 14px #aaff44} }

  /* ── 拖曳交互（Session 25） ── */
  .hand-card.draggable{ cursor:grab; touch-action:none; user-select:none; }
  .hand-card.draggable:active{ cursor:grabbing; }
  .hand-card.dragging{ opacity:0.3; transform:scale(0.95); transition:transform .15s, opacity .15s; }
  .drop-zone{ outline:2px dashed rgba(136,204,255,.55); outline-offset:2px; animation:drop-pulse 1.2s infinite alternate; }
  .drop-hover{ outline:3px solid #ffd44a !important; outline-offset:2px; box-shadow:0 0 18px rgba(255,212,74,.6); }
  @keyframes drop-pulse{ from{outline-color:rgba(136,204,255,.35)}to{outline-color:rgba(136,204,255,.75)} }
  .drag-preview{ position:fixed; z-index:9999; pointer-events:none; transform:translate(-50%,-50%) rotate(4deg); width:110px; filter:drop-shadow(0 8px 16px rgba(0,0,0,.65)); }
  .drag-preview img{ width:100%; border-radius:6px; border:2px solid rgba(255,212,74,.7); }
  .drag-hint{ margin-top:.3rem; text-align:center; font-size:.68rem; color:#ffeaa6; background:rgba(0,0,0,.75); padding:.15rem .4rem; border-radius:3px; white-space:nowrap; }

  /* ── 硬幣動畫（Session 28） ── */
  .coin-overlay{ position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center; background:radial-gradient(circle at 50% 50%, rgba(0,0,0,.55), rgba(0,0,0,.88)); backdrop-filter:blur(3px); pointer-events:none; }
  .coin-stage{ display:flex; flex-direction:column; align-items:center; gap:1.2rem; }
  .coin{ width:120px; height:120px; position:relative; transform-style:preserve-3d; animation:coin-flip 1.5s cubic-bezier(.35,.2,.25,1) forwards; }
  .coin-face{ position:absolute; inset:0; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:5rem; backface-visibility:hidden; background:linear-gradient(135deg,#ffd44a,#b58a20); box-shadow:0 0 30px rgba(255,212,74,.6), inset 0 0 20px rgba(0,0,0,.3); border:3px solid #8a6a10; }
  .coin-heads{ transform:rotateY(0deg); }
  .coin-tails{ transform:rotateY(180deg); background:linear-gradient(135deg,#555,#222); color:#eee; box-shadow:0 0 30px rgba(136,136,136,.4), inset 0 0 20px rgba(0,0,0,.5); border-color:#333; }
  .coin.coin-heads{ animation-name:coin-flip-heads; }
  .coin.coin-tails{ animation-name:coin-flip-tails; }
  @keyframes coin-flip-heads{
    0%{ transform:rotateY(0) scale(.6); }
    50%{ transform:rotateY(1080deg) scale(1.15); }
    100%{ transform:rotateY(1440deg) scale(1); }
  }
  @keyframes coin-flip-tails{
    0%{ transform:rotateY(0) scale(.6); }
    50%{ transform:rotateY(1080deg) scale(1.15); }
    100%{ transform:rotateY(1620deg) scale(1); }
  }
  .coin-label{ font-size:1.4rem; font-weight:700; color:#ffd44a; text-shadow:0 0 12px rgba(255,212,74,.7); background:rgba(0,0,0,.5); padding:.4rem 1rem; border-radius:6px; border:1px solid #8a6a10; }

  /* ── 傷害數字彈出（Session 29） ── */
  .dmg-pop{ position:fixed; z-index:9500; pointer-events:none;
    transform:translate(-50%, -50%);
    font-size:2.2rem; font-weight:900; color:#ff4a4a;
    text-shadow: 0 2px 0 #3a0a0a, 0 0 14px rgba(255,0,0,.8), 0 0 28px rgba(255,0,0,.5);
    animation: dmg-rise 1.2s cubic-bezier(.2,.7,.3,1) forwards;
    font-family: system-ui, sans-serif; letter-spacing:-2px; }
  .dmg-pop.heal{ color:#4affa0; text-shadow: 0 2px 0 #083020, 0 0 14px rgba(0,255,100,.7); }
  @keyframes dmg-rise{
    0%  { transform:translate(-50%, -50%) scale(.5); opacity:0; }
    20% { transform:translate(-50%, -90%) scale(1.3); opacity:1; }
    55% { transform:translate(-50%, -110%) scale(1); opacity:1; }
    100%{ transform:translate(-50%, -180%) scale(.85); opacity:0; }
  }

  /* ── 能量附加 pulse ── */
  .active-card.energy-pulse, .bench-slot.energy-pulse{
    animation: energy-attach-pulse .7s cubic-bezier(.2,.7,.3,1);
  }
  @keyframes energy-attach-pulse{
    0%  { box-shadow: 0 0 0 rgba(170,255,68,0); }
    40% { box-shadow: 0 0 24px rgba(170,255,68,.9), inset 0 0 18px rgba(170,255,68,.4); transform:scale(1.04); }
    100%{ box-shadow: 0 0 0 rgba(170,255,68,0); transform:scale(1); }
  }

  /* ─── v2.118 攻擊動畫 ────────────────────────────────────────
     attacker 卡橫向震動、defender 卡疊色 flash（顏色取自 attacker pokemonType） */
  .active-card.attack-shake{ animation: attack-shake .4s cubic-bezier(.3,.1,.3,1); }
  @keyframes attack-shake{
    0%,100% { transform: translateX(0); }
    20%     { transform: translateX(-10px) rotate(-1deg); }
    45%     { transform: translateX(8px)  rotate(1deg); }
    70%     { transform: translateX(-4px); }
  }
  .active-card.attack-flash{ position:relative; }
  .active-card.attack-flash::after{
    content:''; position:absolute; inset:0;
    background: var(--flash-color, #fff);
    opacity:0; border-radius:inherit; pointer-events:none;
    mix-blend-mode:screen;
    animation: attack-flash .5s ease-out;
  }
  @keyframes attack-flash{
    0%   { opacity:0;   transform: scale(.9); }
    25%  { opacity:.75; transform: scale(1.02); }
    60%  { opacity:.4;  }
    100% { opacity:0;   transform: scale(1); }
  }

  /* ─── v2.118 狀態異常光暈 ────────────────────────────────────
     以 box-shadow 脈動呈現；不改動 DOM 結構、不佔位，不影響原先 UI。 */
  .active-card.status-glow-poisoned{
    animation: glow-poisoned 1.6s ease-in-out infinite;
  }
  @keyframes glow-poisoned{
    0%,100% { box-shadow: 0 0 6px 1px rgba(170,80,220,.35), inset 0 0 10px rgba(170,80,220,.15); }
    50%     { box-shadow: 0 0 16px 3px rgba(170,80,220,.8), inset 0 0 18px rgba(170,80,220,.35); }
  }
  .active-card.status-glow-burned{
    animation: glow-burned 0.9s ease-in-out infinite;
  }
  @keyframes glow-burned{
    0%,100% { box-shadow: 0 0 6px 1px rgba(255,120,60,.4), inset 0 0 10px rgba(255,120,60,.2); }
    50%     { box-shadow: 0 0 18px 4px rgba(255,80,40,.9), inset 0 0 20px rgba(255,80,40,.4); }
  }
  .active-card.status-glow-asleep{
    animation: glow-asleep 2.4s ease-in-out infinite;
  }
  @keyframes glow-asleep{
    0%,100% { box-shadow: 0 0 6px 1px rgba(100,140,220,.3), inset 0 0 10px rgba(100,140,220,.1); }
    50%     { box-shadow: 0 0 14px 3px rgba(100,140,220,.7), inset 0 0 18px rgba(100,140,220,.3); }
  }
  .active-card.status-glow-confused{
    animation: glow-confused 0.6s ease-in-out infinite;
  }
  @keyframes glow-confused{
    0%,100% { box-shadow: 0 0 8px 2px rgba(255,220,80,.5); transform: rotate(-.3deg); }
    50%     { box-shadow: 0 0 14px 4px rgba(255,220,80,.75); transform: rotate(.3deg); }
  }

  /* ─── v2.119 Copy-attack picker（暗黑底牌） ──────────────── */
  .copy-attack-modal{ max-width:560px; }
  .copy-attack-list{ display:flex; flex-direction:column; gap:.8rem; padding:.5rem 0; max-height:60vh; overflow-y:auto; }
  .copy-attack-poke{ display:flex; gap:.8rem; background:#1e2e1e; border:1px solid #3a5a3a; border-radius:8px; padding:.5rem; }
  .copy-attack-img{ width:80px; height:auto; border-radius:4px; object-fit:cover; }
  .copy-attack-col{ display:flex; flex-direction:column; gap:.35rem; flex:1; min-width:0; }
  .copy-attack-name{ font-weight:600; color:#d8e8d8; font-size:.95rem; }
  .copy-attack-atks{ display:flex; flex-direction:column; gap:.3rem; }
  .copy-attack-btn{ display:flex; align-items:center; gap:.5rem; padding:.45rem .6rem;
    background:#2a3a2a; border:1px solid #4a7a4a; border-radius:6px; cursor:pointer;
    color:#eee; font-size:.88rem; text-align:left; }
  .copy-attack-btn:hover{ background:#3a5a3a; border-color:#6aaa6a; }
  .copy-atk-cost{ display:inline-flex; gap:.15rem; }
  /* v4.01：能量 picker 來源寶可夢位置標籤（[戰鬥場] / [備戰]）— 醒目顏色區分 */
  .sel-source-slot{
    display:inline-block;
    padding:0 .25rem;
    margin-right:.15rem;
    font-size:.85em;
    font-weight:700;
    color:#ffd56a;
    background:rgba(0,0,0,.4);
    border-radius:3px;
  }
  /* v5.665：戰鬥場(active)來源標籤改暖橘+底色,與[備戰]金色明顯區分,一眼辨識戰鬥寶可夢 */
  .sel-source-slot.sel-source-active{ color:#ffae6a; background:rgba(120,45,0,.55); }

  /* v3.9998：concealed picker（精神出局）— 卡背 placeholder */
  .sel-card-back{
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    width:100%; aspect-ratio: 245/342;
    background:linear-gradient(135deg, #1a1a3a 0%, #2a2a5a 50%, #1a1a3a 100%);
    border:2px solid #4a4a8a; border-radius:6px;
    color:#aabbff;
  }
  .sel-card-back-icon{ font-size:2.5rem; line-height:1; }
  .sel-card-back-q{ font-size:2rem; font-weight:900; margin-top:.3rem; color:#ffcc44; text-shadow:0 2px 4px rgba(0,0,0,.5); }
  .sel-concealed .sel-name{ color:#aabbff; font-style:italic; }

  /* v3.9995：璀璨結晶啟用時，cost row 末尾加總徽章 */
  /*   （v3.9994 加的單顆 .cost-reduced 劃線移除 — 因「任意屬性皆可」應由玩家彈性選） */
  .shiny-crystal-badge{
    display:inline-flex; align-items:center;
    margin-left:.15rem; padding:0 .25rem;
    font-size:.55rem; font-weight:700; color:#1a1a0a;
    background:linear-gradient(135deg, #ffd700, #ffb300);
    border:1px solid #cc8800; border-radius:6px;
    box-shadow:0 0 4px rgba(255,215,0,.5);
    white-space:nowrap;
  }
  .copy-atk-pip{ display:inline-flex; width:1.2em; height:1.2em; border-radius:50%;
    align-items:center; justify-content:center; color:#fff; font-size:.7rem; font-weight:700;
    text-shadow:0 1px 1px rgba(0,0,0,.4); }
  .copy-atk-name{ flex:1; }
  .copy-atk-dmg{ font-weight:700; color:#ffcc44; font-variant-numeric:tabular-nums; }

  /* ─── v2.118 Header 音效控制 chip ────────────────────────── */
  .audio-chip{ display:inline-flex; align-items:center; gap:.3rem; padding:.1rem .4rem; }
  .audio-btn{
    background:transparent; border:none; cursor:pointer; font-size:1rem; padding:0;
    line-height:1; color:inherit;
  }
  .audio-btn:hover{ filter: brightness(1.4); }
  .audio-slider{
    width:72px; height:3px; cursor:pointer;
    accent-color:#5a8a5a;
    background:transparent;
  }

  /* ── v2.42 牌庫洗牌動畫 ── */
  .pile-slot.deck-pile.shuffling{
    animation: deck-shuffle .55s cubic-bezier(.3,.8,.3,1);
    box-shadow: 0 0 16px rgba(136,190,255,.8), 0 0 28px rgba(136,190,255,.4);
  }
  @keyframes deck-shuffle{
    0%   { transform: rotate(0)     scale(1); }
    20%  { transform: rotate(-10deg) scale(1.08); }
    45%  { transform: rotate(8deg)   scale(1.12); }
    70%  { transform: rotate(-4deg)  scale(1.05); }
    100% { transform: rotate(0)      scale(1); }
  }
  .pile-slot .shuffle-spark{
    position:absolute; top:-10px; right:-6px; font-size:1.1rem;
    pointer-events:none;
    animation: spark-spin .55s linear;
    filter: drop-shadow(0 0 6px rgba(136,190,255,.9));
  }
  @keyframes spark-spin{
    0%   { transform: rotate(0)    scale(.4); opacity:0; }
    30%  { transform: rotate(140deg) scale(1.1); opacity:1; }
    100% { transform: rotate(360deg) scale(.6); opacity:0; }
  }

  /* ── v2.42 棄牌脈衝 ── */
  .pile-slot.disc-pile.discard-pulse{
    animation: discard-pulse .45s cubic-bezier(.3,.8,.3,1);
    background:#2a1a3a !important;
    box-shadow: 0 0 14px rgba(200,120,255,.7);
  }
  @keyframes discard-pulse{
    0%   { transform: scale(1); }
    45%  { transform: scale(1.14) rotate(-3deg); }
    100% { transform: scale(1) rotate(0); }
  }

  /* ── v2.45 抽牌飛卡 overlay ── */
  /* 注意：.draw-fly-card 用 fixed + left/top（初始在牌庫位置），動畫用 translate(var(--dx), var(--dy)) */
  .draw-fly-overlay{ position:fixed; inset:0; z-index:9200; pointer-events:none; overflow:visible; }
  .draw-fly-card{
    position:fixed; pointer-events:none; will-change:transform, opacity;
    animation-name: draw-fly; animation-timing-function: cubic-bezier(.3,.7,.25,1); animation-fill-mode: both;
    filter: drop-shadow(0 6px 12px rgba(0,0,0,.65));
  }
  .draw-fly-back{
    width:100%; height:100%; border-radius:6px;
    display:flex; align-items:center; justify-content:center;
    background:radial-gradient(circle at 50% 50%, #f0f4ff 0 12%, #ffffff 12% 14%, #1a1a1a 14% 18%, #c0392b 18% 50%, #922b21 50% 100%);
    border:2px solid #1a1a1a;
    box-shadow:inset 0 0 6px rgba(0,0,0,.6);
  }

  
  /* Settings Modal CSS */
  .settings-modal {
    max-width: 500px;
    max-height: 85vh;
    padding: 2rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  /* v4.930 settings-section 改用 <details> 可摺疊 */
  details.settings-section { margin-bottom: 1rem; background: rgba(0,0,0,0.2); padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #2a4a2a; }
  details.settings-section[open] { padding: 1rem; }
  details.settings-section > summary { cursor: pointer; padding: 0.5rem 0; font-size: 1.05rem; font-weight: 600; color: #f0f0f0; list-style: none; user-select: none; display: flex; align-items: center; gap: 0.5rem; }
  details.settings-section > summary::-webkit-details-marker { display: none; }
  details.settings-section > summary::before { content: '▶'; font-size: 0.75rem; color: #aac; transition: transform 0.15s; display: inline-block; }
  details.settings-section[open] > summary::before { transform: rotate(90deg); }
  details.settings-section > summary:hover { color: #aaffaa; }
  .setting-hint { font-size: 0.78rem; color: #aac; margin-top: 0.4rem; padding-left: 0.5rem; }

  /* v2.45 解析度模式 — 用 CSS zoom 縮小整個 .battle-root */
  /* zoom 屬性 modern browser 都支援（Chrome/Safari/Edge/Firefox 126+），
     效果：等比縮小整個 layout 含 modal 內容；rendering 對齊 sub-pixel 但仍清晰。
     遊戲設計基準是 1280×720（tablet-layout）；對 1024×576 玩家設 80% 即 1024×576 視覺尺寸 = 1280×720 設計尺寸，完美適配。 */
  :global(.battle-root.zoomed) {
    zoom: var(--game-zoom, 1);
  }
  .settings-title { font-size: 1.5rem; color: #aaffaa; margin-top: 0; margin-bottom: 1rem; border-bottom: 1px solid #3a5a3a; padding-bottom: 0.5rem; }
  .settings-section { margin-bottom: 1.5rem; background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px; border: 1px solid #2a4a2a; }
  .settings-section h4 { color: #f0f0f0; margin-top: 0; margin-bottom: 1rem; font-size: 1.1rem; }
  .setting-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem; font-size: 0.95rem; }
  .setting-row label { flex: 0 0 100px; color: #ccc; }
  .setting-row select, .setting-row input[type="range"] { flex: 1; }
  .setting-row select { background: #2a3a2a; color: #fff; border: 1px solid #4a7a4a; padding: 0.4rem; border-radius: 4px; font-size: 0.95rem; }
  .vol-text { flex: 0 0 45px; text-align: right; color: #aaa; font-variant-numeric: tabular-nums; }
  .toggle-btn { flex: 1; background: #2a3a2a; color: #fff; border: 1px solid #4a7a4a; padding: 0.5rem; border-radius: 4px; cursor: pointer; text-align: center; }
  .toggle-btn:hover { background: #3a4a3a; }
  /* v4.60 restart button + overlays */
  .restart-game-btn { background:#f59e0b !important; color:#000; font-weight:600; border-color:#d97706 !important; }
  .restart-game-btn:hover { background:#fbbf24 !important; }
  .restart-game-btn:disabled { background:#444 !important; color:#888; cursor:not-allowed; border-color:#444 !important; }
  .restart-proposal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:9999; display:flex; align-items:center; justify-content:center; }
  .restart-proposal-modal { background:linear-gradient(135deg,#1a2540 0%, #2a3550 100%); border:2px solid #f59e0b; border-radius:12px; padding:24px 32px; min-width:300px; max-width:90vw; color:#fff; text-align:center; box-shadow:0 8px 32px rgba(0,0,0,.6); }
  .restart-proposal-modal h3 { margin:0 0 12px; color:#fbbf24; font-size:1.3em; }
  .restart-proposal-modal p { margin:8px 0; }
  .restart-countdown-text { color:#fbbf24; font-weight:600; font-size:.95em; }
  .restart-proposal-actions { margin-top:16px; display:flex; gap:12px; justify-content:center; }
  .restart-btn-accept, .restart-btn-reject { padding:10px 24px; border:none; border-radius:6px; font-size:1em; font-weight:600; cursor:pointer; }
  .restart-btn-accept { background:#10b981; color:#fff; }
  .restart-btn-accept:hover { background:#34d399; }
  .restart-btn-reject { background:#ef4444; color:#fff; }
  .restart-btn-reject:hover { background:#f87171; }
  .restart-waiting-strip { position:fixed; top:calc(60px + var(--safe-top, 0px)); left:50%; transform:translateX(-50%); z-index:9998; background:rgba(245,158,11,.95); color:#000; padding:8px 18px; border-radius:20px; display:flex; align-items:center; gap:12px; box-shadow:0 4px 12px rgba(0,0,0,.4); font-weight:600; font-size:.92em; }
  .restart-cancel-btn { background:#000; color:#fbbf24; border:none; padding:4px 12px; border-radius:12px; font-size:.85em; cursor:pointer; font-weight:600; }
  .restart-cancel-btn:hover { background:#222; }
  .restart-rejected-toast { position:fixed; bottom:calc(80px + var(--safe-bottom, 0px)); left:50%; transform:translateX(-50%); z-index:9998; background:rgba(239,68,68,.95); color:#fff; padding:12px 24px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.4); font-weight:600; animation:rejectedToastFade 4s ease; }
  @keyframes rejectedToastFade { 0% { opacity:0; transform:translate(-50%, 20px); } 10% { opacity:1; transform:translate(-50%, 0); } 85% { opacity:1; transform:translate(-50%, 0); } 100% { opacity:0; transform:translate(-50%, -10px); } }
  @media (max-width: 768px) { .restart-proposal-modal { padding:18px 20px; min-width:260px; } .restart-waiting-strip { top:calc(50px + var(--safe-top, 0px)); font-size:.85em; padding:6px 14px; } .restart-rejected-toast { font-size:.9em; padding:10px 18px; } }
  .settings-chip { background: #2a3a2a; border-color: #5a5a5a; cursor: pointer; }
  .settings-chip:hover { background: #3a4a3a; }

  .sel-grid{ display:flex; flex-wrap:wrap; gap:1.2rem; justify-content:center; }
  .draw-fly-card .card-back-mark{ font-size:1.15rem; font-weight:900; color:rgba(255,255,255,.85); text-shadow:0 1px 2px rgba(0,0,0,.7); font-family:'Times New Roman',serif; }
  @keyframes draw-fly{
    0%   { transform:translate(0,0) rotate(-8deg) scale(.7); opacity:0; }
    12%  { opacity:1; transform:translate(calc(var(--dx) * .05), calc(var(--dy) * .05)) rotate(-6deg) scale(.78); }
    70%  { opacity:1; transform:translate(calc(var(--dx) * .88), calc(var(--dy) * .88)) rotate(-2deg) scale(.98); }
    100% { transform:translate(var(--dx), var(--dy)) rotate(0) scale(1.02); opacity:0; }
  }

  /* v5.131：取得獎賞卡動畫 overlay — face-up 卡圖飛到螢幕中央 + 變大 + 轉一圈 + 飛回手牌 */
  .prize-pick-overlay{
    position:fixed; inset:0; pointer-events:none; z-index:9000;
  }
  .prize-pick-card{
    position:absolute;
    width:120px; height:168px;
    border-radius:8px;
    overflow:hidden;
    box-shadow:0 4px 20px rgba(0,0,0,.6);
    animation-name:prize-pick;
    animation-timing-function:cubic-bezier(.2,.9,.35,1.15);
    animation-fill-mode:both;
    transform-origin:center;
  }
  /* v5.137：對手取獎賞時顯示卡背填滿動畫卡框 */
  .prize-pick-back{
    width:100%; height:100%;
    border-radius:8px;
  }
  .prize-pick-card img{
    width:100%; height:100%; object-fit:contain;
    display:block;
    border-radius:8px;
  }
  /* 0%: prize 位置原大小（120x168） → 30%: 中央 scale 2.5 + 半圈 → 60%: 中央 scale 2.5 + 整圈 →
     85%: 飛向 hand-strip scale .8 → 100%: 到 hand-strip 縮小消失 */
  @keyframes prize-pick{
    0%   { transform:translate(0,0) scale(1) rotate(0); opacity:0;
           box-shadow:0 0 0 rgba(255,215,0,0); }
    15%  { transform:translate(calc(var(--dx) * .3), calc(var(--dy) * .15)) scale(2.0) rotate(180deg); opacity:1;
           box-shadow:0 0 30px rgba(255,215,0,.85); }
    50%  { transform:translate(calc(var(--dx) * .3), calc(var(--dy) * .25)) scale(2.5) rotate(360deg); opacity:1;
           box-shadow:0 0 40px rgba(255,215,0,.9); }
    70%  { transform:translate(calc(var(--dx) * .5), calc(var(--dy) * .5)) scale(2.0) rotate(360deg); opacity:1;
           box-shadow:0 0 30px rgba(255,215,0,.7); }
    95%  { transform:translate(calc(var(--dx) * .92), calc(var(--dy) * .92)) scale(.85) rotate(360deg); opacity:.85;
           box-shadow:0 0 10px rgba(255,215,0,.3); }
    100% { transform:translate(var(--dx), var(--dy)) scale(.4) rotate(360deg); opacity:0;
           box-shadow:none; }
  }

  /* v2.45：overlay 飛行期間 hand-card opacity:0，overlay 落地才淡入 */
  .hand-card.arriving{ opacity:0; pointer-events:none; }
  .hand-card:not(.arriving){ transition: opacity .18s ease-out; }
  /* v5.116：剛抽到/檢索到的新卡 halo pulse 1.5s 讓玩家更易察覺 */
  .hand-card.just-arrived {
    animation: hand-card-arrived 1.5s ease-out;
  }
  @keyframes hand-card-arrived {
    0%   { box-shadow: 0 0 0 3px rgba(255, 230, 80, 0.9), 0 0 20px 6px rgba(255, 200, 60, 0.7); transform: scale(1.05); }
    30%  { box-shadow: 0 0 0 3px rgba(255, 230, 80, 0.85), 0 0 24px 8px rgba(255, 200, 60, 0.6); transform: scale(1.05); }
    70%  { box-shadow: 0 0 0 2px rgba(255, 230, 80, 0.5), 0 0 14px 4px rgba(255, 200, 60, 0.4); transform: scale(1.02); }
    100% { box-shadow: 0 0 0 0 rgba(255, 230, 80, 0); transform: scale(1); }
  }

  .zone-bench{ flex:1; display:flex; gap:.35rem; overflow:visible; min-width:0; }

  /* v2.47：零之大空洞場景（備戰上限 5→8）— 自動縮小 slot + 必要時橫向捲動 */
  .zone-bench.bench-extended {
    overflow-x: auto;
    overflow-y: visible;
    /* 平滑捲動 + 觸控支援 */
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    scrollbar-color: #4a6a4a #0e1e0e;
  }
  .zone-bench.bench-extended::-webkit-scrollbar {
    height: 6px;
  }
  .zone-bench.bench-extended::-webkit-scrollbar-track {
    background: #0e1e0e;
    border-radius: 3px;
  }
  .zone-bench.bench-extended::-webkit-scrollbar-thumb {
    background: #4a6a4a;
    border-radius: 3px;
  }
  .zone-bench.bench-extended::-webkit-scrollbar-thumb:hover {
    background: #6a8a6a;
  }
  /* slot 縮小：90→78 min；128→112 max（讓 8 隻在 1280+ 螢幕能完整顯示，不需捲動） */
  .zone-bench.bench-extended .bench-slot {
    flex: 1 1 78px;
    min-width: 78px;
    max-width: 112px;
  }
  .zone-bench.bench-extended .bench-empty {
    flex: 1 1 78px;
    min-width: 78px;
    max-width: 112px;
  }
  .zone-bench.bench-extended .bench-slot img {
    max-width: 92px;
    max-height: 110px;
  }

  /* v5.287 桌墊版 bench-extended v4 — slot fixed 100px (跟 5 卡 base 視覺接近, 不平分)
     v5.285 用 flex:1 1 0 + max:192px 後 Wilson 截圖三大問題:
     (1) 對手 3 卡撐到 max:192 視覺過大 — 少量卡 grow 撐滿
     (2) opp + my active 疊在一起 — max:192 撐爆 grid 內部 layout 計算, 1fr cell 寬被搶
     (3) Wilson 要求: 8 卡單張寬度應跟 5 卡 base slot 一致, 不要平分整 row
     v4 修法:
     (a) slot 改 fixed `flex:0 0 100px; width:100px` — 不 grow/shrink, 跟 5 卡視覺一致
         (5 卡 base 90~128 layout * zoom 0.65 ~ 58~83 視覺; 8 卡 fixed 100 視覺 65 中間值)
     (b) grid-area: 1/1/2/-1 / 4/1/5/-1 仍跨整 row (突破 1fr cell 限制讓 8 卡放得下)
         但因 slot fixed 100, container 寬度 = 8*100+gap = ~830 固定, 不撐爆其他 cells
     (c) justify-content: center 少量卡 (3 卡) 集中, 不撐滿整 row */
  .playmat.layout-tabletop .opponent-row > .zone-bench.bench-extended {
    grid-area: 1 / 1 / 2 / -1 !important;
    justify-self: center !important;
  }
  .playmat.layout-tabletop .my-row > .zone-bench.bench-extended {
    grid-area: 4 / 1 / 5 / -1 !important;
    justify-self: center !important;
  }
  .playmat.layout-tabletop .zone-bench.bench-extended {
    overflow-x: visible !important;
    overflow-y: visible !important;
    display: flex !important;
    flex-wrap: nowrap !important;
    justify-content: center !important;
    gap: 4px !important;
    width: max-content !important;
    max-width: none !important;
  }
  /* slot fixed 100px — 跟 5 卡 base 視覺接近, 不 grow / shrink, 不平分整 row */
  .playmat.layout-tabletop .zone-bench.bench-extended .bench-slot,
  .playmat.layout-tabletop .zone-bench.bench-extended .bench-empty {
    flex: 0 0 100px !important;
    width: 100px !important;
    min-width: 100px !important;
    max-width: 100px !important;
  }

  /* v2.47：bench-slot 高度鎖定 — 不管有 tool/特性用過/狀態/能量多少，高度固定，
     避免撐大 zone-bench 把下方手牌擠出 viewport。
     v2.51：加寬 slot（115→140px），能量 pip 移到右側垂直排列。
     v2.53：縮窄 slot 回 128px 並放大卡圖（Leon 反饋「牌變小空隙太大」），
            bench-nrg 條件渲染後沒能量時 img 置中填滿 slot。 */
  /* v2.123：bench-slot 加高 20px（185 → 205），讓特性按鈕不會擠掉 HP 顯示
     （Leon 反饋：備戰寶可夢血量常看不到） */
  .bench-slot{ flex:1 1 90px; min-width:90px; max-width:128px; height:205px; background:rgba(0,0,0,.25); border:1px solid #2a4a2a; border-radius:6px; padding:.35rem; text-align:center; font-size:.72rem; position:relative; cursor:default; display:flex; flex-direction:column; align-items:center; gap:.1rem; overflow:hidden; }
  .bench-slot:not(.bench-empty).energy-target{ border-color:#aaff44; cursor:pointer; }
  /* v2.49：限制圖片高度，把底部空間留給能量 pip / 進化按鈕 / 特性按鈕（名字/HP 已移到卡牌上方）
     v2.51：寬度讓 flex 自動分配（bench-middle 裡與能量 pip 共用一列；對手 bench 無 bench-middle 則直接填滿 slot）
     v2.53：max-width 92→108、max-height 100→128，卡圖顯著放大（寶可夢卡 aspect ≈1.4，height 主導 → 實際約 92×128） */
  .bench-slot img{ width:100%; max-width:108px; max-height:128px; object-fit:contain; border-radius:4px; }
  /* v2.51：中段 flex row — 圖片 + 右側能量垂直 pip；佔據 slot 大部分高度，下方留空間給 hp bar + 按鈕 */
  .bench-middle{ display:flex; flex-direction:row; width:100%; align-items:center; justify-content:center; gap:3px; flex:1 1 auto; min-height:0; }
  /* bench-empty：與已放置 slot 等高；flex 與寬度對齊已放置卡牌的 slot，避免 setup 時 drop target 小到難拖 */
  .bench-empty{ border-style:dashed; border-color:#2a5a2a; opacity:.55; overflow:visible; flex:1 1 90px; min-width:90px; max-width:128px; height:185px; }
  /* 拖曳中的 bench-empty 提升可見度（粗框 + 偏亮底） */
  .bench-empty.drop-zone{ opacity:.95; border-width:3px; }
  /* v4.496：寶可夢名字加暗背景 chip + z-index:12 浮在卡片上方（避免與卡片印製內容視覺衝突） */
  .bench-name{
    font-size:.7rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    background:rgba(0,0,0,.6);
    padding:.05rem .35rem;
    border-radius:3px;
    margin:0 .15rem;
    position:relative;
    z-index:12;  /* 高過 tool-chip(5)，確保浮在卡片圖最上層 */
    text-shadow:0 1px 1px rgba(0,0,0,.8);
    font-weight:600;
    flex-shrink:0;
  }
  /* v3.9993：備戰區血量字加大（玩家反饋字太小）.66rem → .85rem + 顏色加亮 + 粗體
     v4.496：加暗背景 chip + z-index:12 — 玩家回報土龍節節/超級甲賀忍蛙ex 等高 HP 卡
     HP 文字與卡片印製的 HP 區塊重疊看不清楚，比照 active-hpbar-bottom 風格修補 */
  .bench-stat{
    font-size:.85rem; color:#cfe; font-weight:700; text-shadow:0 1px 2px rgba(0,0,0,.9);
    background:rgba(0,0,0,.7);
    padding:.05rem .35rem;
    border-radius:3px;
    margin:0 .15rem;
    position:relative;
    z-index:12;  /* 高過 tool-chip(5) + hp-bar-wrap(2) */
    display:inline-block;
    flex-shrink:0;
  }
  /* v2.51：能量 pip 改為垂直排列在圖片右側（解決能量多時撐高問題） */
  .bench-nrg{ font-size:.62rem; color:#888; display:flex; flex-direction:column; align-items:center; gap:2px; line-height:1; flex-shrink:0; }
  /* v3.93：能量 pip 放大 — 從 14×14/.58rem 提升到 18×18/.72rem 改善可讀性 */
  .nrg-pip{
    display:inline-flex; align-items:center; justify-content:center;
    min-width:18px; height:18px; padding:0 4px; border-radius:9px;
    font-size:.72rem; font-weight:700; color:#fff; line-height:1;
    box-shadow:0 0 0 1px rgba(0,0,0,.4) inset, 0 1px 2px rgba(0,0,0,.2);
  }
  /* v2.120 Rainbow pip：全屬性特殊能量（古舊/夜光/稜鏡 on Basic/新衝天 on Stage2） */
  .nrg-pip.nrg-pip-rainbow{
    background: conic-gradient(
      #5ca83a 0deg 40deg,     /* 草 */
      #d94a3a 40deg 80deg,    /* 火 */
      #3a7aca 80deg 120deg,   /* 水 */
      #e8b33a 120deg 160deg,  /* 雷 */
      #9a4ab4 160deg 200deg,  /* 超 */
      #aa6a4a 200deg 240deg,  /* 鬥 */
      #4a4a5a 240deg 280deg,  /* 惡 */
      #8a9aa4 280deg 320deg,  /* 鋼 */
      #c4a84a 320deg 360deg   /* 龍 */
    );
    color:#fff; text-shadow:0 0 3px rgba(0,0,0,.9), 0 0 2px rgba(0,0,0,.9);
  }

  .zone-pile{ flex-shrink:0; display:flex; flex-direction:column; gap:.35rem; width:72px; align-items:center; }
  .pile-slot{ width:65px; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius:6px; padding:.35rem .25rem; gap:.12rem; min-height:60px; transition:transform .15s, box-shadow .15s; position:relative; }
  .pile-slot:hover{ transform:translateY(-2px) scale(1.04); box-shadow:0 4px 12px rgba(0,0,0,.4); }
  .pile-slot::before{ content:''; position:absolute; inset:3px; border-radius:4px; background:inherit; opacity:.35; transform:translate(2px,2px); pointer-events:none; z-index:-1; }
  .pile-slot::after{ content:''; position:absolute; inset:6px; border-radius:3px; background:inherit; opacity:.2; transform:translate(4px,4px); pointer-events:none; z-index:-2; }
  .deck-pile{ background:linear-gradient(135deg,#1a3a6a,#2a5a9a); border:1px solid #4a7aaa; cursor:pointer; }
  .disc-pile{ background:#1a1a2a; border:1px dashed #3a3a5a; cursor:pointer; transition:border-color .15s,background .15s; }
  .disc-pile:hover{ border-color:#6a6aaa; background:#1e1e3a; }
  .pile-icon{ font-size:1.15rem; line-height:1; }
  .pile-count{ font-size:1.1rem; font-weight:700; color:#fff; }
  .pile-label{ font-size:.65rem; color:#aaa; }

  .hp-bar-wrap{ height:8px; background:#1a2a1a; border-radius:3px; overflow:hidden; margin:3px 0; }
  .hp-bar-wrap.sm{ height:5px; }
  .hp-bar{ height:100%; border-radius:3px; transition: width .55s cubic-bezier(.3,.8,.3,1), background .3s ease-out; }

  /* v2.03：action-bar 還原為原本 160/200；靠 overflow:visible 讓場地卡不會被切
     v2.283：min/max-height (160/200) 改 height:180 固定 — 自己回合 vs 對手回合 action-btns
     寬度差異大（攻擊按鈕群 vs 「等待…」字串）+ alerts-col 數量不同，原 40px 變動範圍會
     讓 .playmat grid minmax(0,1fr) 平分時兩個 row 高度跟著伸縮 → 回合切換時整個畫面晃。 */
  .action-bar{ display:grid; grid-template-columns:auto 1fr auto auto; gap:.5rem; padding:.3rem .7rem; background:rgba(0,0,0,.6); border-top:1px solid #2a4a2a; border-bottom:1px solid #2a4a2a; flex-shrink:0; align-items:stretch; height:180px; overflow:visible; }
  .alerts-col, .action-btns, .stadium-display{ align-self:center; }
  .stadium-display{ display:flex; flex-direction:column; align-items:center; gap:.25rem; padding:.35rem .5rem; border:1px solid #3a5a8a; background:rgba(26,42,74,.6); border-radius:6px; cursor:pointer; transition:transform .2s ease, box-shadow .2s ease; }
  .stadium-display:hover{ transform:scale(1.05); box-shadow:0 0 12px rgba(136,170,255,.4); }
  .stadium-display img{ width:92px; height:auto; border-radius:4px; }
  .stadium-display-label{ font-size:.78rem; color:#a8c4ff; font-weight:700; letter-spacing:.05em; }
  .stadium-display-name{ font-size:.82rem; color:#dde; max-width:120px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
  .alerts-col{ display:flex; flex-direction:column; gap:.2rem; max-width:280px; }
  .alert{ display:flex; flex-wrap:wrap; align-items:center; gap:.35rem; padding:.25rem .5rem; border-radius:6px; font-size:.8rem; }
  .prize-alert{ background:#2a4a1a; border:1px solid #4a8a3a; }
  .warn-alert{ background:#3a2a0a; border:1px solid #8a6a2a; }
  .info-alert{ background:#1a3a4a; border:1px solid #3a7aaa; color:#cce6ff; }

  /* ══ 擲硬幣動畫 ══ */
  .coin-flip-overlay{
    position:fixed; inset:0; z-index:999;
    background:rgba(0,0,0,.75); backdrop-filter:blur(4px);
    display:flex; align-items:center; justify-content:center;
  }
  .coin-flip-box{
    display:flex; flex-direction:column; align-items:center; gap:1.2rem;
    padding:2.5rem 3.5rem;
    background:linear-gradient(135deg, #2a4a2a, #1a3a1a);
    border:2px solid #5aaa5a; border-radius:16px;
    box-shadow:0 0 60px rgba(90,170,90,.5);
    min-width:360px;
  }
  .coin{
    font-size:5rem; line-height:1;
    filter:drop-shadow(0 0 12px rgba(255, 215, 0, .6));
  }
  .coin.flipping{
    animation:coin-spin 0.35s linear infinite;
  }
  .coin.revealed{
    filter:drop-shadow(0 0 20px rgba(255, 215, 0, .8));
  }
  @keyframes coin-spin{
    0%   { transform: rotateY(0deg)   scale(1);   }
    25%  { transform: rotateY(90deg)  scale(.85); }
    50%  { transform: rotateY(180deg) scale(1);   }
    75%  { transform: rotateY(270deg) scale(.85); }
    100% { transform: rotateY(360deg) scale(1);   }
  }
  .coin-text{
    font-size:1.4rem; color:#eef; font-weight:700;
    letter-spacing:1px; text-align:center;
  }
  .coin-result strong{ color:#ffd700; font-size:1.6rem; }
  .coin-sub{
    margin-top:.5rem; padding:.5rem 1rem;
    background:rgba(0,0,0,.4); border-radius:6px;
    font-size:.85rem; color:#bcd; text-align:center;
  }
  .mini-row{ display:flex; gap:.25rem; flex-wrap:wrap; margin-top:.2rem; width:100%; }
  .action-btns{ display:flex; flex-wrap:wrap; gap:.35rem; justify-content:center; align-items:center; }
  .btn-act{ display:inline-flex; align-items:center; gap:.25rem; padding:.4rem .85rem; border-radius:6px; border:none; font:inherit; font-size:.9rem; font-weight:600; cursor:pointer; white-space:nowrap; }
  .btn-act.primary{ background:#2a7a2a; color:#fff; }
  .btn-act.primary:hover:not(:disabled){ background:#3a9a3a; }
  .btn-act.primary:disabled{ opacity:.4; cursor:not-allowed; }
  .btn-act.secondary{ background:#2a3a5a; color:#ccddff; border:1px solid #4a5a8a; }
  .btn-act.secondary:disabled{ opacity:.4; cursor:not-allowed; }
  .btn-act.atk{ background:#1a2a3a; border:1px solid #3a5a7a; color:#ccd; opacity:.45; cursor:not-allowed; position:relative; }
  /* ⭐v6.233 預估傷害（桌機：hover 才顯示）—— position:absolute + display:none
     ⇒ 不佔任何版面空間，原本的按鈕排版完全不變。
     ⭐v6.237【D】定位基準改成外層的 .atk-slot（不是按鈕本身）：
       能量還沒附夠的招式按鈕是原生 disabled，disabled 元件不派送滑鼠事件、
       各家瀏覽器對 :hover 的處理也不一致 ⇒ 掛在按鈕上就是「最需要的時候看不到」。
       容器沒有 disabled，hover 一定成立；按鈕維持 disabled，玩家仍然按不下去。 */
  .atk-slot{ position:relative; display:inline-flex; }
  /* 容器被拉寬時（Fable 版面把它當成固定寬度的 grid 槽位）按鈕要跟著填滿，
     版面才與 v6.236 一模一樣；一般 flex 版面下 basis:auto ＝ 原本的內容寬度。 */
  .atk-slot > .btn-act.atk{ flex:1 1 auto; }
  .dmg-est{
    position:absolute; left:50%; bottom:calc(100% + 6px); transform:translateX(-50%);
    display:none; flex-direction:column; gap:2px; z-index:60; pointer-events:none;
    background:rgba(8,16,26,.97); border:1px solid #6a9aff; border-radius:6px;
    padding:.3rem .55rem; white-space:nowrap; box-shadow:0 2px 10px rgba(0,0,0,.6);
  }
  .atk-slot:hover .dmg-est{ display:flex; }
  /* ⭐⭐⭐v6.238【B】放大鏡點開的狀態（與 hover 顯示同一塊內容、同一個位置）。 */
  .atk-slot.est-open .dmg-est{ display:flex; }
  .dmg-est-toggle{
    flex:0 0 auto; position:relative; width:34px; height:34px; margin-left:.2rem; padding:0;
    display:inline-flex; align-items:center; justify-content:center;
    background:#12202e; border:1px solid #3a5a7a; border-radius:6px; color:#ffd97a;
    font:inherit; font-size:.95rem; line-height:1; cursor:pointer;
  }
  .dmg-est-toggle:hover{ background:#1a3a5a; border-color:#6a9aff; }
  /* ⚠ 觸控目標：可視大小 34×34 要塞進 Fable 版面 38px 高的固定槽位，
       所以改用不佔版面的 ::after 把**可點區**外擴 5px ⇒ 44×44（觸控建議值）。
       ::after 是絕對定位 ⇒ 完全不影響三種桌機版面的按鈕排版。 */
  .dmg-est-toggle::after{ content:''; position:absolute; top:-5px; right:-5px; bottom:-5px; left:-5px; }
  .dmg-est-main{ font-size:.8rem; font-weight:700; color:#ffd97a; }
  .dmg-est-formula{ font-size:.72rem; font-weight:500; color:#bcd; }
  .btn-act.atk.atk-ready{ opacity:1; cursor:pointer; border-color:#6a9aff; }
  .btn-act.atk.atk-ready:not(:disabled):hover{ background:#1a3a5a; }
  .cost-row{ display:flex; gap:.15rem; }
  .epip{ width:1.25rem; height:1.25rem; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:.58rem; font-weight:700; color:#fff; flex-shrink:0; }
  .epip.sm{ width:1rem; height:1rem; font-size:.5rem; }
  .atk-name{ max-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .atk-dmg{ font-weight:700; color:#f88; font-size:.95rem; }
  .log-col{ width:380px; max-height:100%; min-height:0; overflow-y:auto; font-size:.8rem; line-height:1.35;
    background:rgba(0,0,0,.45); border:1px solid #2a4a2a; border-radius:6px; padding:.3rem .55rem;
    align-self:stretch;
    scrollbar-width:thin; scrollbar-color:#4a6a4a rgba(0,0,0,.3);
    /* v5.068：經典版同桌墊版 — 新訊息在底、舊訊息在頂（聊天室慣例）。
       data 已 .reverse()（newest first），column-reverse 把首項翻到視覺底部。
       桌墊版的 .playmat.layout-tabletop .action-bar > .log-col 仍 override 為 fixed
       position，但 flex-direction 一致（皆 column-reverse）— 兩種版型視覺對齊。 */
    display:flex; flex-direction:column-reverse; }
  .log-col::-webkit-scrollbar{ width:8px; }
  .log-col::-webkit-scrollbar-thumb{ background:#3a5a3a; border-radius:4px; }
  .log-col::-webkit-scrollbar-thumb:hover{ background:#5a7a5a; }
  .log-line{ color:#9ab89a; padding:.2rem 0; border-bottom:1px solid rgba(42,74,42,.4); white-space:normal; word-break:break-all; }
  /* v5.068：log 時間戳 [mm:ss] 樣式 — 灰色淡化、固定寬度，不擾干主訊息 */
  .log-line .log-time { color:#6a8a6a; font-size:.72rem; margin-right:.3rem; font-variant-numeric:tabular-nums; opacity:.75; }
  .log-line:last-child{ border-bottom:none; }
  .log-sys{ color:#aaffcc; font-weight:600; }
  .log-latest{ background:rgba(170,255,204,.06); padding-left:.3rem; border-left:2px solid #aaffcc; }
  /* v2.88 戰鬥 log 著色 — 各類別 token 樣式 ─────────────────────────── */
  .log-line .log-bracket   { color:#ffd166; font-weight:700; }       /* 招式/特性名【XX】*/
  .log-line .log-ko        { color:#ff6b6b; font-weight:700; }       /* 被擊倒 / KO */
  .log-line .log-prize     { color:#ffc93c; font-weight:700; }       /* +N 張獎賞卡 */
  .log-line .log-damage    { color:#ff8a65; font-weight:600; }       /* N 點傷害 */
  .log-line .log-heal      { color:#7fdc7f; font-weight:600; }       /* 回 N HP */
  .log-line .log-status    { color:#ce93d8; font-weight:600; }       /* 中毒/灼傷/麻痺/睡眠/混亂 */
  .log-line .log-evolve    { color:#7fdc7f; font-weight:600; }       /* 進化成 */
  .log-line .log-coin      { color:#fff59d; font-weight:600; }       /* 擲硬幣/正面/反面 */
  .log-line .log-secondary { color:#7a8a7a; }                        /* 抽牌/重洗/搜尋牌庫（淡化）*/
  /* v3.02 卡名可點連結 — 用 button 保留可鍵盤聚焦 / a11y */
  .log-line .log-card-link {
    display: inline;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: #80c0ff;
    text-decoration: underline;
    cursor: pointer;
    line-height: inherit;
  }
  .log-line .log-card-link:hover { color: #a0d0ff; background: rgba(128,192,255,0.1); }
  .log-line .log-card-link:focus { outline: 1px dotted #a0d0ff; outline-offset: 2px; }
  /* 整行類別 ──────────────────────────────────────────────────────── */
  .log-line.log-turn-marker {
    background:rgba(170,200,255,.08); border-top:1px solid rgba(170,200,255,.3);
    border-bottom:1px solid rgba(170,200,255,.3); margin:.3rem 0;
    padding:.35rem .3rem; color:#bcd4ff; font-weight:700;
  }
  .log-line.log-victory {
    background:rgba(255,200,80,.12); border:1px solid rgba(255,200,80,.5);
    border-radius:4px; padding:.4rem; margin:.3rem 0;
    color:#ffe082; font-weight:700;
  }
  .log-line.log-private {
    background:rgba(170,140,255,.05); border-left:2px solid rgba(170,140,255,.4); padding-left:.3rem;
  }
  .log-private-icon { margin-right:.2rem; opacity:.8; font-size:.85em; }

  /* v3.93：撤退按鈕放大 + 配色改顯眼橘黃（玩家反映找不到按鈕）*/
  .btn-retreat{ padding:.25rem .55rem; font-size:.78rem; font-weight:600; background:#d97a2a; border:1px solid #f4a040; border-radius:5px; color:#fff; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,.3); transition:background .15s, transform .1s; }
  .btn-retreat:hover{ background:#e89432; transform:translateY(-1px); }
  .btn-retreat:active{ transform:translateY(0); }
  /* v3.37 + v5.088：不能撤退時的 disabled 樣式（紅暗色 + grayscale 變灰，hover 不變）
     v5.088：玩家回報只有 🚫 emoji 沒視覺變暗 — 加強 opacity (.55→.45) + filter:grayscale。
     同時把 mirror 按鈕 (.btn-act.btn-retreat-mirror) :disabled 套用同 dim 樣式
     （原 v5.084 加了 disabled 屬性但沒對應 CSS — 紅橘背景蓋掉預設 disabled 變暗）。 */
  .btn-retreat-blocked,
  .btn-act.btn-retreat-mirror:disabled{
    opacity:.45;
    cursor:not-allowed;
    background:#4a3030;
    border-color:#8a5a5a;
    color:#dcc;
    box-shadow:none;
    filter:grayscale(.5);
  }
  .btn-retreat-blocked:hover,
  .btn-act.btn-retreat-mirror:disabled:hover{
    background:#4a3030;
    transform:none;
  }
  /* v3.93：action-bar 內 mirror 撤退按鈕 — 沿用 btn-act 基底但配色一致為橘黃顯眼 */
  .btn-act.btn-retreat-mirror{ background:#d97a2a; color:#fff; border:1px solid #f4a040; box-shadow:0 1px 3px rgba(0,0,0,.3); }
  .btn-act.btn-retreat-mirror:hover{ background:#e89432; transform:translateY(-1px); }
  .btn-act.btn-retreat-mirror:active{ transform:translateY(0); }

  /* v3.38：本機/AI lobby 牌組張數提示 */
  .deck-count-info { font-size:.78rem; margin-top:.4rem; padding:.25rem .5rem; border-radius:4px; display:inline-block; font-weight:500; }
  .deck-count-info.ok { color:#9f9; background:rgba(60,140,60,.15); border:1px solid rgba(80,180,80,.3); }
  .deck-count-info.bad { color:#fc8; background:rgba(170,80,80,.18); border:1px solid rgba(210,110,110,.4); }
  /* v2.189 化石丟棄按鈕 — 棕色系與撤退按鈕區分 */
  .btn-fossil-discard{ background:#5a3a2a; border-color:#aa6a4a; color:#fc8; margin-left:.3rem; }
  .btn-fossil-discard:hover{ background:#7a4a3a; }
  .fossil-discard-btn{ background:#5a3a2a; border-color:#aa6a4a; color:#fc8; }
  .fossil-discard-btn:hover{ background:#7a4a3a; }
  .retreat-picker{ position:absolute; bottom:100%; left:0; right:0; z-index:20; display:flex; gap:.3rem; flex-wrap:wrap; align-items:center; background:#1a1a3a; border:1px solid #4a4a8a; border-radius:8px; padding:.4rem; font-size:.7rem; box-shadow:0 -4px 12px rgba(0,0,0,.6); }
  .retreat-label{ font-size:.72rem; color:#aaf; width:100%; }

  .mini-poke-btn{ display:flex; flex-direction:column; align-items:center; background:#1a3a1a; border:1px solid #4a8a4a; border-radius:5px; padding:.2rem; cursor:pointer; color:#ddd; font-size:.65rem; gap:.1rem; }
  .mini-poke-btn img{ width:40px; border-radius:2px; }
  .mini-poke-btn:hover{ background:#2a5a2a; }
  .btn-xs{ padding:.15rem .4rem; border-radius:4px; border:1px solid #5a5a5a; background:#2a2a2a; color:#ddd; cursor:pointer; font:inherit; font-size:.72rem; }
  .btn-xs.primary{ background:#2a7a2a; border-color:#4a9a4a; color:#fff; }

  .evo-wrap{ position:absolute; bottom:.25rem; right:.25rem; }
  .evo-btn{ padding:.12rem .32rem; font-size:.62rem; background:#3a5a2a; border:1px solid #6aaa4a; border-radius:4px; color:#aef; cursor:pointer; }
  .evo-btn:hover{ background:#4a7a3a; }
  .evo-btn-sm{ display:block; width:100%; margin-top:.15rem; padding:.1rem; font-size:.56rem; background:#3a5a2a; border:1px solid #6aaa4a; border-radius:3px; color:#aef; cursor:pointer; }
  .evo-menu{ position:absolute; bottom:100%; right:0; z-index:30; background:#1a2a1a; border:1px solid #4a8a4a; border-radius:6px; padding:.3rem; display:flex; flex-direction:column; gap:.2rem; min-width:90px; box-shadow:0 4px 14px rgba(0,0,0,.8); }
  .evo-above{ bottom:auto; top:100%; }
  .evo-choice{ display:flex; flex-direction:column; align-items:center; gap:.15rem; background:#2a3a2a; border:1px solid #4a6a4a; border-radius:4px; padding:.25rem; cursor:pointer; color:#ddd; font-size:.62rem; }
  .evo-choice img{ width:52px; border-radius:3px; }
  .evo-choice:hover{ background:#3a5a3a; }

  /* v2.279：桌機砍 hand-strip / hand-label 上下空白，避免整體高度超過視窗造成右側滾輪 */
  .hand-strip{ flex-shrink:0; background:#0a160a; border-top:2px solid #2a5a2a; padding:.2rem .7rem .25rem; overflow:visible; }
  .hand-label{ font-size:.75rem; color:#5a8a5a; margin-bottom:.15rem; }
  .hand-not-my-turn{ color:#888; margin-left:.4rem; }
  /* v2.41：鎖定手牌列不可滑動（移除 overflow-x:auto 產生的滑桿）；
     當手牌 >9 張時以 var(--hand-overlap) 讓卡片互疊而不溢出視窗。
     `overflow:hidden` 確保兩軸都不產生滾動條；padding-bottom 加大以容納扇形下彎。
     v2.279：padding 30/22 → 14/8 — 30px 上 padding 是給 hover-peek translateY(-14px) 預留升起空間，砍到剛好 14 即可；
            min-height 170→150 配合縮小（卡牌實際高度約 130px）。 */
  .hand-scroll{ display:flex; justify-content:center; gap:0; padding:14px 1rem 8px; overflow:hidden; min-height:150px; perspective:900px; }

  /* ════════════════════════════════════════════════════════════════════════
     v2.313：平板與 1366x768 筆電 專屬橫向縮小版配置（透過 JS .tablet-layout 控制）
     ────────────────────────────────────────────────────────────────────────
     取代原本的 max-height: 1080px media query。
     給予 1366x768 與 iPad 更合適的等比例縮放，避免 1366x768 高度不足（~650px）
     導致下半部手牌區被切斷的問題。
     獨立的 CSS scope 完美隔離了與大螢幕版（1920x1080+）的干擾。
     ════════════════════════════════════════════════════════════════════════ */
  :global(.battle-root.tablet-layout) {
    /* 鎖死視窗 + 不出滾輪 */
    height: 100vh; height: 100dvh; min-height: 0; overflow: hidden;
  }
  
  :global(.battle-root.tablet-layout .playmat) {
    /* 由 .battle-root 剩餘空間平分，不再強制 230 */
    grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr); 
    min-height: 0; overflow: hidden;
  }
  
  :global(.battle-root.tablet-layout .field-row) {
    min-height: 0; overflow: hidden; padding: 0.2rem 0.4rem;
  }
  
  /* v3.41：放大場上卡填滿 iPad 10.5 / 1366×768 留白 */
  :global(.battle-root.tablet-layout .active-card) {
    min-height: 160px; padding: 0.3rem 0.4rem; gap: 0.3rem;
  }
  :global(.battle-root.tablet-layout .active-card.active-empty) {
    min-height: 150px; padding: 0.6rem;
  }
  :global(.battle-root.tablet-layout .active-img) {
    max-height: 150px; max-width: 115px; object-fit: contain;
  }
  
  :global(.battle-root.tablet-layout .bench-slot) {
    height: 175px;
  }
  :global(.battle-root.tablet-layout .bench-slot img) {
    max-height: 115px;
  }
  
  :global(.battle-root.tablet-layout .action-bar) {
    height: 125px; min-height: 0; max-height: none; padding: 0.2rem 0.4rem;
  }
  :global(.battle-root.tablet-layout .log-col) {
    width: 360px;
  }
  
  :global(.battle-root.tablet-layout .hand-strip) {
    padding: 0.15rem 0.4rem 0.2rem;
  }
  :global(.battle-root.tablet-layout .hand-scroll) {
    padding: 10px 0.7rem 7px; min-height: 150px;
  }
  :global(.battle-root.tablet-layout .hand-card) {
    width: 96px; padding: 0.25rem; gap: 0.15rem;
  }
  :global(.battle-root.tablet-layout .hand-card img) {
    width: 92px;
  }
  
  /* Stadium card needs to be shrunk so it doesn't overflow the 125px action bar */
  :global(.battle-root.tablet-layout .stadium-display img) {
    width: 60px;
  }
  :global(.battle-root.tablet-layout .stadium-display) {
    padding: 0.2rem 0.3rem; gap: 0.15rem;
  }
  :global(.battle-root.tablet-layout .stadium-display-label) {
    font-size: 0.65rem;
  }
  :global(.battle-root.tablet-layout .stadium-display-name) {
    font-size: 0.65rem; max-width: 80px;
  }
  
  /* Font sizes and compact spacing */
  :global(.battle-root.tablet-layout .action-btns) { gap: 0.25rem; }
  :global(.battle-root.tablet-layout .btn-act) { padding: 0.35rem 0.5rem; font-size: 0.82rem; }
  :global(.battle-root.tablet-layout .btn-act.atk) { min-height: 44px; }
  :global(.battle-root.tablet-layout .turn-info) { font-size: 0.8rem; }

  .hand-scroll > .hand-card + .hand-card{ margin-left: calc(var(--hand-overlap, 0px) * -1); }
  .hand-card{ flex-shrink:0; width:92px; background:#0e1e0e; border:1.5px solid #2a3a2a; border-radius:6px; padding:.25rem; text-align:center; cursor:default; display:flex; flex-direction:column; align-items:center; gap:.12rem;
    transform: rotate(var(--fan-rot, 0deg)) translateY(var(--fan-lift, 0));
    transform-origin: 50% 180%;
    transition: border-color .15s, box-shadow .15s;
    box-shadow: 0 3px 8px rgba(0,0,0,.35); }
  /* 當前 hover 的卡片略微上推提示（仍維持原大小，避免抖動 + z-index 爭奪） */
  .hand-card.hover-peek:not(.dragging){
    transform: rotate(var(--fan-rot, 0deg)) translateY(calc(var(--fan-lift, 0) - 14px));
    transition: transform .15s ease-out, border-color .15s;
    box-shadow: 0 8px 18px rgba(0,0,0,.55);
  }
  .hand-card img{ width:88px; border-radius:4px; pointer-events:none; }
  /* 整張 hand-card（含 img）為拖曳區域；不再用 img 的放大鏡按鈕 */
  .hand-card{ cursor: default; }
  .hand-card.draggable{ cursor: grab !important; }
  .hand-card.draggable:active{ cursor: grabbing !important; }
  /* 拖曳中所有其他手牌禁用 pointer，避免擋住 elementFromPoint */
  .hand-scroll.is-dragging .hand-card:not(.dragging){ pointer-events:none; }
  /* 浮層預覽：永遠最上層，不影響原卡 layout */
  .hand-preview-float{ position:fixed; z-index:9999; pointer-events:none;
    transform:translate(-50%, -100%);
    filter:drop-shadow(0 10px 26px rgba(0,0,0,.85)); }
  .hand-preview-float img{ width:340px; border-radius:10px; border:2px solid rgba(255,212,74,.6); }
  /* v6.096「傳說」兩張合一競技場：對手回合面板也裁半。
     ⚠ .opp-turn-card-img 只設了 width/max-width（沒有 height）→ **必須自己補 aspect-ratio**，
     否則 object-fit:cover 永遠不會裁（v6.087 的教訓）。868/1212 = 官方直式卡圖比例。 */
  .opp-turn-card-img.legend-half-l, .opp-turn-card-img.legend-half-r { aspect-ratio: 868 / 1212; height:auto; object-fit:cover; }
  .opp-turn-card-img.legend-half-l { object-position: 0% 50%; }
  .opp-turn-card-img.legend-half-r { object-position: 100% 50%; }
  .hand-name{ font-size:.68rem; color:#bbb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; }
  .hand-hint{ font-size:.65rem; color:#bbb; }
  .hand-hint.hl{ color:#ffd44a; font-weight:600; }
  .energy-hint{ color:#aaff44; }
  /* v1.02：統一黃框表示「當下可用」— 涵蓋能量/基礎/訓練家/進化 */
  /* v6.099：.hand-trigger-btn 隨機制 A 的手牌按鈕一起移除（該按鈕已是死碼，見上方說明） */

    .hand-card.can-actionable{
    border-color:#e0b030;
    box-shadow: 0 0 8px rgba(224,176,48,.45), 0 3px 8px rgba(0,0,0,.35);
  }
  .hand-card.selected{ border-color:#aaff44; box-shadow:0 0 8px #aaff4488; }
  .hand-btn{ display:block; width:100%; margin-top:.14rem; padding:.15rem 0; border-radius:3px; font-size:.68rem; cursor:pointer; border:none; }
  .basic-btn{ background:#2a5a2a; color:#aef; }
  .basic-btn:hover{ background:#3a7a3a; }
  .trainer-btn{ background:#2a3a6a; color:#ccf; }
  .trainer-btn:hover{ background:#3a5a9a; }

  /* v3.900 回合切換 banner — 中央 pokeball + 粉紅大字，pointer-events none 不擋互動 */
  .turn-banner-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 9998;
    background: rgba(0, 0, 0, 0.08);
  }
  .turn-banner-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    animation: turnBannerPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .turn-banner-pokeball {
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background:
      linear-gradient(to bottom, #ff3838 0%, #ff3838 49%, #222 49%, #222 53%, #fafafa 53%, #fafafa 100%);
    border: 6px solid #222;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    position: relative;
  }
  .turn-banner-pokeball::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 28px;
    height: 28px;
    margin: -14px 0 0 -14px;
    border-radius: 50%;
    background: #fafafa;
    border: 6px solid #222;
    box-sizing: border-box;
  }
  .turn-banner-text {
    font-size: clamp(56px, 11vw, 140px);
    font-weight: 900;
    color: #ff5b8a;
    -webkit-text-stroke: 4px #c41a4a;
    text-stroke: 4px #c41a4a;
    text-shadow: 0 6px 20px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.5);
    letter-spacing: 0.12em;
    line-height: 1;
    font-family: 'PingFang TC', 'Microsoft JhengHei', 'Heiti TC', sans-serif;
  }
  @keyframes turnBannerPop {
    0% { transform: scale(0.4); opacity: 0; }
    55% { transform: scale(1.12); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }

  .selection-overlay{ position:fixed; inset:0; z-index:100; background:rgba(0,0,0,.82); display:flex; align-items:center; justify-content:center; font-family:system-ui,'Microsoft JhengHei',sans-serif; transition:background .15s ease; }
  /* v2.44：modal 被拖曳後背景變透明且不擋互動（讓玩家看見、甚至操作場上），modal 本體仍可互動 */
  .selection-overlay.dragged{ background:transparent; pointer-events:none; }
  .selection-overlay.dragged .selection-modal{ pointer-events:auto; box-shadow:0 8px 32px rgba(0,0,0,.6); }
  .selection-modal{ background:#1a2a1a; border:1px solid #4a8a4a; border-radius:12px; padding:1.25rem; max-width:680px; width:95vw; max-height:85vh; display:flex; flex-direction:column; gap:.75rem; color:#f0f0f0; will-change:transform; }
  /* v2.44：sel-header 兼任拖曳把手，給 cursor 提示；touch-action:none 阻止觸控滾動干擾 */
  .sel-header{ cursor:grab; user-select:none; touch-action:none; }
  .sel-header:active{ cursor:grabbing; }
  .sel-header h3{ margin:0 0 .2rem; font-size:1.1rem; color:#aaffaa; }
  .sel-hint{ margin:0; font-size:.85rem; color:#aaa; }
  /* v5.191 modal-choice 行內放大鏡（道具拆除器等需查看寶可夢的場景） */
  .modal-choice-row{ display:flex; align-items:stretch; gap:.35rem; width:100%; }
  .modal-choice-btn-flex{ flex:1; }
  .modal-choice-inspect{
    flex: 0 0 auto;
    padding: .35rem .55rem;
    font-size: 1rem;
    line-height: 1;
    min-width: 2.3rem;
  }
  .modal-choice-inspect[disabled]{ opacity:.45; cursor:not-allowed; }

  /* v2.201 modal-choice stepper：泰姆猜 HP 等需要數字輸入的場景 — Leon 規則「戰鬥畫面只用滑鼠」
     置中橫排：[−] [當前值] [+] [✓ 確認]，按鈕為大圓鈕方便手機/平板觸控 */
  .modal-choice-stepper{ display:flex; align-items:center; justify-content:center; gap:.6rem; padding:.6rem 0; flex-wrap:wrap; }
  /* v5.165 重試徽章 modal — 前次擲幣明細顯示區 */
  .modal-coin-flips{ margin:.5rem 0 .8rem; padding:.6rem .8rem; background:#0e1a0e; border:1px solid #2a4a6a; border-radius:8px; }
  .modal-coin-flips-title{ font-size:.95rem; font-weight:700; color:#aacfff; margin-bottom:.4rem; text-align:center; }
  .modal-coin-flips-list{ list-style:none; padding:0; margin:0 0 .4rem; display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:.25rem .8rem; }
  .modal-coin-flips-list li{ font-size:.9rem; color:#ccc; padding:.2rem .4rem; background:#1a2a1a; border-radius:4px; }
  .modal-coin-flips-list .heads{ color:#ffd54a; }
  .modal-coin-flips-list .tails{ color:#aaa; }
  .modal-coin-flips-list .stop-tag{ color:#888; font-size:.8rem; }
  .modal-coin-flips-note{ font-size:.75rem; color:#888; text-align:center; }
  .stepper-btn{ width:2.6rem; height:2.6rem; border-radius:50%; border:1px solid #4a6a4a; background:#1e3a1e; color:#fff; font-size:1.4rem; font-weight:700; cursor:pointer; user-select:none; }
  .stepper-btn:hover:not(:disabled){ background:#2a4a2a; border-color:#5a8a5a; }
  .stepper-btn:disabled{ opacity:.35; cursor:not-allowed; }
  .stepper-value{ min-width:5rem; text-align:center; font-size:1.6rem; font-weight:700; color:#aaffaa; padding:0 .8rem; background:#0a180a; border:1px solid #2a4a2a; border-radius:8px; line-height:2.4rem; }
  .stepper-confirm{ margin-left:.4rem; }
  .stepper-hint{ text-align:center; }
  .sel-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(72px,1fr)); gap:.4rem; overflow-y:auto; max-height:52vh; padding-right:.25rem; }
  .full-deck-view{ margin-top:.6rem; background:#0e1a0e; border:1px solid #2a4a2a; border-radius:6px; padding:.4rem .7rem; }
  .full-deck-view summary{ cursor:pointer; font-size:.85rem; color:#aaffcc; font-weight:600; }
  .full-deck-note{ margin:.4rem 0; font-size:.75rem; color:#888; }
  /* v5.309: grid 卡圖 + 右下 count badge, 64px 寬控制 modal 不過大 (與棄牌區 cell 視覺一致) */
  .full-deck-list{ display:grid; grid-template-columns:repeat(auto-fill,minmax(64px,1fr)); gap:4px; max-height:60vh; overflow-y:auto; padding:4px; }
  .deck-cell{ position:relative; display:block; width:100%; height:0; padding:0 0 140% 0; background:rgba(255,255,255,.04); border:1px solid #444; border-radius:6px; overflow:hidden; cursor:pointer; }
  .deck-cell:hover{ border-color:#4a8a4a; }
  .deck-cell-img{ position:absolute; inset:0; width:100%; height:100%; object-fit:contain; display:block; }
  /* v6.095「傳說」兩張合一競技場：牌庫檢視／翻牌檢視／對手手牌檢視也裁半。
     .deck-cell 用 padding-bottom 撐出固定直式框、img 絕對定位鋪滿 → 框比例與圖片無關，
     只要把預設的 contain 覆蓋成 cover 再給 object-position 即可（不需要 aspect-ratio）。 */
  .deck-cell-img.legend-half-l, .deck-cell-img.legend-half-r { object-fit:cover; }
  .deck-cell-img.legend-half-l { object-position: 0% 50%; }
  .deck-cell-img.legend-half-r { object-position: 100% 50%; }
  .deck-cell-fallback{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#ccc; font-size:.55rem; padding:2px; text-align:center; box-sizing:border-box; line-height:1.1; }
  .deck-cell-count{ position:absolute; right:2px; bottom:2px; background:rgba(220,38,38,.95); color:#fff; font-size:.7rem; font-weight:800; padding:0 5px; border-radius:8px; border:1.5px solid rgba(255,255,255,.9); box-shadow:0 1px 2px rgba(0,0,0,.5); min-width:20px; text-align:center; line-height:1.2; }
  /* v2.39 行內放大鏡：flex 左文字 + 右 🔍，避免長名稱爆版 */
  /* v2.43 Leon 反饋：原本 justify-content:space-between + 名字 flex:1 1 auto，
     讓名字拉滿整行、放大鏡被推到最右邊，與卡名的距離太遠。
     改為 flex-start + 名字 flex:0 1 auto，讓名字只佔實際寬度，放大鏡緊貼名字。 */
  .deck-item{ display:flex; align-items:center; justify-content:flex-start; gap:.25rem; font-size:.8rem; color:#bbb; padding:.1rem 0; min-width:0; }
  .deck-item-name{ flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .deck-item-zoom{ flex:0 0 auto; background:transparent; border:none; color:#aaffcc; cursor:pointer; font-size:.85rem; padding:0 .15rem; line-height:1; }
  .deck-item-zoom:hover{ color:#fff; }
  .sel-card{ display:flex; flex-direction:column; align-items:center; gap:.2rem; background:#0e1e0e; border:2px solid #2a4a2a; border-radius:6px; padding:.3rem; cursor:pointer; color:#ccc; font-size:.65rem; position:relative; width:100%; }
  .sel-card:hover{ border-color:#4a8a4a; }
  .sel-card.sel-picked{ border-color:#aaff44; box-shadow:0 0 6px #aaff4488; }
  /* v4.39 高傲指令 picker — 長列表（多 Pokemon × 多 attack）需可滾動 */
  .rocket-command-scroll {
    max-height: 60vh;
    overflow-y: auto;
    padding-right: 4px;
  }

  /* v6.108：提示列裡的「已選卡名」— 要一眼看得到，這是防誤選的主要視覺錨點 */
  .sel-picked-names { color: #ffd54a; font-weight: 700; }
  /* v6.130 BGM 說明文字（原創聲明 / autoplay 被擋提示） */
  .bgm-note {
    font-size: 0.78rem;
    line-height: 1.5;
    opacity: 0.75;
    margin: 0.25rem 0 0.5rem;
  }
  .bgm-blocked { opacity: 1; color: #f0b23c; }

  /* deck-search / generic selection：放大鏡 + 挑選按鈕的 wrapper */
  .sel-card-wrap{ position:relative; display:flex; flex-direction:column; }
  .sel-card-wrap.sel-picked .sel-card{ border-color:#aaff44; box-shadow:0 0 6px #aaff4488; }
  /* v5.014：小剛的發掘 — 動態 disabled 卡（混選/超限時灰掉） */
  .sel-card-wrap.bd-disabled{ opacity:.35; }
  .sel-card-wrap.bd-disabled .sel-card{ cursor:not-allowed; filter:grayscale(.6); border-color:#3a3a3a; }
  .sel-card-wrap.bd-disabled .sel-card:hover{ border-color:#3a3a3a; box-shadow:none; }
  .sel-zoom{ position:absolute; top:.2rem; right:.2rem; z-index:2; background:rgba(0,0,0,.72); border:1px solid #6aaa6a; color:#cfc; font-size:.7rem; line-height:1; padding:.18rem .32rem; border-radius:4px; cursor:pointer; }
  .sel-zoom:hover{ background:rgba(74,138,74,.9); color:#fff; }
  .sel-card img{ width:64px; border-radius:3px; }
  /* v6.091「傳說」兩張合一競技場：picker 選擇盤 / 棄牌區也裁半（與手牌一致）。
     ⚠ aspect-ratio 不能省（v6.087 教訓）：.sel-card img 只設 width 時，img 框比例＝圖片比例
     → object-fit:cover 永遠不會裁 → 半裁靜默失效。對 .sel-grid-energy 的 88px 寬同樣成立。 */
  .sel-card img.legend-half-l, .sel-card img.legend-half-r { aspect-ratio: 868 / 1212; height:auto; object-fit:cover; }
  .sel-card img.legend-half-l { object-position: 0% 50%; }
  .sel-card img.legend-half-r { object-position: 100% 50%; }
  .sel-name{ text-align:center; font-size:.6rem; }
  /* v3.827: 能量 picker 來源寶可夢標籤 */
  .sel-energy-source{ display:inline-block; font-size:.7rem; line-height:1.25; color:#9cd49c; background:rgba(0,0,0,.55); border:1px solid rgba(156,212,156,.4); border-radius:4px; padding:.1rem .35rem; margin-top:.2rem; max-width:100%; white-space:normal; overflow-wrap:anywhere; word-break:break-word; cursor:pointer; transition:background .15s, border-color .15s; } /* v5.664：移除截斷,來源寶可夢名完整換行 */
  .sel-energy-source:hover{ background:rgba(20,60,20,.85); border-color:#9cd49c; color:#cfe9cf; }
  .sel-energy-source:focus-visible{ outline:2px solid #9cd49c; outline-offset:1px; }
  /* v5.664：能量 picker 卡圖放大(僅挑能量的 picker,不動其他選取格) */
  .sel-grid.sel-grid-energy{ grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); gap:.6rem; }
  .sel-grid.sel-grid-energy .sel-card{ font-size:.72rem; }
  .sel-grid.sel-grid-energy .sel-card img{ width:88px; }
  .sel-grid.sel-grid-energy .sel-name{ font-size:.72rem; }
  .sel-hp{ font-size:.58rem; color:#888; }
  .sel-check{ position:absolute; top:2px; right:4px; font-size:.9rem; color:#aaff44; font-weight:700; }
  .sel-empty{ color:#666; font-size:.85rem; grid-column:1/-1; text-align:center; padding:1rem; }
  .sel-footer{ display:flex; gap:.75rem; justify-content:flex-end; flex-wrap:wrap; }

  /* v3.75 先後攻偏好 radio group */
  .first-pref-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: rgba(255, 200, 100, 0.06);
    border: 1px solid rgba(255, 200, 100, 0.25);
    border-radius: 6px;
  }
  .first-pref-group .first-pref-label {
    font-size: 0.75rem;
    color: #ffd070;
    font-weight: 600;
    margin-right: 0.3rem;
  }
  .first-pref-group .first-pref-radio {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-size: 0.78rem;
    color: #eee;
  }
  .first-pref-group .first-pref-radio:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .first-pref-group .first-pref-radio input { margin: 0; }
  .first-pref-group .first-pref-radio:has(input:checked) {
    background: rgba(255, 200, 100, 0.15);
    color: #ffeaa0;
  }
  .first-pref-group .first-pref-radio:has(input:disabled) {
    opacity: 0.55;
    cursor: not-allowed;
  }
  /* lobby variant — slightly more compact */
  .first-pref-group.lobby {
    margin-top: 0.3rem;
    padding: 0.3rem 0.45rem;
  }
  .first-pref-group.lobby .first-pref-radio { font-size: 0.72rem; padding: 0.15rem 0.3rem; }

  /* v3.81：取得獎賞 10s 倒數計時器顯示 */
  .prize-countdown {
    display: inline-block;
    margin: 0 0.5rem;
    padding: 0.15rem 0.5rem;
    background: rgba(255, 200, 100, 0.15);
    border: 1px solid rgba(255, 200, 100, 0.4);
    border-radius: 6px;
    color: #ffd070;
    font-size: 0.82rem;
    font-weight: 600;
  }
  /* Mulligan 補抽模態 */
  .mulligan-modal{ max-width:440px; }
  /* v3.74 Mulligan 揭示翻頁 modal */
  .mulligan-reveal-modal{ max-width:760px; }
  .mulligan-reveal-body{ padding:.5rem 0; display:flex; flex-direction:column; gap:.8rem; }
  .mulligan-reveal-pager{ display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
  .mulligan-reveal-pager .page-indicator{ color:#ffd070; font-weight:600; font-size:.92rem; }
  .mulligan-reveal-pager .btn-act.small{ padding:.3rem .65rem; font-size:.82rem; }
  .mulligan-reveal-pager .btn-act:disabled{ opacity:.35; cursor:not-allowed; }
  .mulligan-reveal-grid{
    display:grid;
    grid-template-columns: repeat(7, 1fr);
    gap:.4rem;
    background:rgba(0,0,0,.25);
    padding:.5rem;
    border-radius:8px;
  }
  .mulligan-reveal-card{
    display:flex; flex-direction:column; align-items:center; gap:.2rem;
  }
  /* v6.095：開局手牌展示／重抽回顧的裁半（本框已有 aspect-ratio + cover，只需 object-position） */
  .mulligan-reveal-card img.legend-half-l { object-position: 0% 50%; }
  .mulligan-reveal-card img.legend-half-r { object-position: 100% 50%; }
  .mulligan-reveal-card img{
    width:100%; height:auto; aspect-ratio:2.5/3.5; object-fit:cover;
    border-radius:4px; cursor:zoom-in;
    box-shadow:0 1px 3px rgba(0,0,0,.5);
  }
  .mulligan-reveal-card .card-name-label{
    font-size:.65rem; color:#ddd; text-align:center; line-height:1.1;
    max-width:100%; word-break:break-all; overflow:hidden;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
  }
  /* v6.051 批2：開局選擇視窗中，可用「瞬間爆發力」上場的那張卡加高亮外框 */
  .mulligan-reveal-card.opening-burst img,
  .mulligan-reveal-card.opening-burst .card-placeholder{
    outline:2px solid #ff9a3c; outline-offset:1px;
    box-shadow:0 0 10px rgba(255,154,60,.75);
  }
  .mulligan-reveal-card .card-placeholder{
    width:100%; aspect-ratio:2.5/3.5; background:#333; border-radius:4px;
    display:flex; align-items:center; justify-content:center;
    color:#aaa; font-size:.7rem; text-align:center; padding:.3rem;
  }
  /* 手機 / 窄螢幕：改 4 欄並縮小字 */
  @media (max-width: 640px) {
    .mulligan-reveal-modal{ max-width:96vw; }
    .mulligan-reveal-grid{ grid-template-columns: repeat(4, 1fr); }
    .mulligan-reveal-card .card-name-label{ font-size:.6rem; }
    .mulligan-reveal-pager .page-indicator{ font-size:.78rem; }
  }

  .mulligan-body{ padding:.4rem 0; display:flex; flex-direction:column; gap:.6rem; }
  .mulligan-info{ background:rgba(255,220,120,.08); border:1px solid rgba(255,200,100,.35); border-radius:8px; padding:.6rem .75rem; display:flex; flex-direction:column; gap:.25rem; color:#ffe0a0; font-size:.85rem; }
  .mulligan-footer{ justify-content:center; }
  /* v4.926 Admin 隱身觀戰提示 banner */
  .admin-spy-banner{
    position:fixed; top:calc(8px + var(--safe-top, 0px)); left:50%; transform:translateX(-50%);
    background:linear-gradient(90deg,#5a1818,#742222);
    color:#ffcfa0; padding:6px 14px; border-radius:6px;
    z-index:99999; font-weight:bold; font-size:0.85rem;
    border:1px solid #c54;
    box-shadow:0 2px 8px rgba(0,0,0,0.4);
    pointer-events:none; user-select:none;
  }

  /* v4.923：mulligan stepper — +/- 計數器 UI */
  .mulligan-stepper{ display:flex; align-items:center; justify-content:center; gap:18px; padding:6px 0 2px; }
  .mulligan-stepper .stepper-btn{ padding:8px 22px; font-size:22px; font-weight:bold; min-width:64px; border-radius:8px; }
  .mulligan-stepper .stepper-value{ font-size:42px; font-weight:bold; min-width:80px; text-align:center; color:#ffd070; line-height:1; }

  /* 撤退選單（置中橫向 grid） */
  .retreat-modal{ max-width:760px; }
  .retreat-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:.6rem; overflow-y:auto; max-height:58vh; padding:.25rem; }
  .retreat-card{ position:relative; background:#0e1e0e; border:2px solid #2a4a2a; border-radius:8px; overflow:hidden; transition:border-color .15s, box-shadow .15s; }
  .retreat-card:hover{ border-color:#4a8a4a; box-shadow:0 0 8px rgba(170,255,170,.25); }
  .retreat-card.sel-picked{ border-color:#aaff44; box-shadow:0 0 10px #aaff4488; }
  /* v2.58：選寶可夢 modal 中，戰鬥寶可夢不再加粗黃框 — 只留上方 retreat-active-badge 頂條做標示（Leon UX 回饋）。 */
  /* v2.15：徽章改為頂部全寬 header 條，避免與 HP/能量/狀態行重疊；對手戰鬥寶可夢用紅底更顯眼 */
  .retreat-active-badge{ display:block; width:100%; margin:-.35rem 0 .1rem; padding:.22rem .3rem; box-sizing:border-box; background:linear-gradient(90deg,#b8860b,#e2a020,#b8860b); color:#fffbe0; font-size:.78rem; font-weight:800; letter-spacing:.04em; text-align:center; border-radius:4px 4px 0 0; text-shadow:0 0 3px rgba(0,0,0,.8); pointer-events:none; white-space:nowrap; box-shadow:0 1px 4px rgba(0,0,0,.55); }
  .retreat-active-badge.opp{ background:linear-gradient(90deg,#962020,#d04040,#962020); color:#fff1e0; }
  .retreat-pick .sel-check{ position:absolute; top:.25rem; left:.35rem; font-size:1rem; color:#aaff44; font-weight:700; text-shadow:0 0 4px rgba(0,0,0,.8); }
  .retreat-zoom{ position:absolute; top:.25rem; right:.25rem; z-index:2; background:rgba(0,0,0,.72); border:1px solid #6aaa6a; color:#cfc; font-size:.78rem; line-height:1; padding:.22rem .4rem; border-radius:4px; cursor:pointer; }
  .retreat-zoom:hover{ background:rgba(74,138,74,.9); color:#fff; }
  .retreat-pick{ display:flex; flex-direction:column; align-items:center; gap:.25rem; background:transparent; border:none; padding:.45rem .3rem .5rem; cursor:pointer; color:#ddd; font-size:.72rem; width:100%; }
  .retreat-pick img{ width:96px; border-radius:6px; }
  .retreat-name{ font-weight:700; color:#fff; font-size:.82rem; text-align:center; max-width:100%; word-break:break-all; line-height:1.2; }
  .retreat-hp{ color:#aaffaa; font-size:.72rem; }
  .retreat-nrg{ color:#ffcc88; font-size:.72rem; min-height:.9rem; }
  .retreat-tool{ color:#aad0ff; font-size:.7rem; }
  .retreat-status{ color:#ff9999; font-size:.7rem; text-transform:capitalize; }
  .retreat-pick:hover .retreat-name{ color:#aaffcc; }

  /* damage-distribute (幻影奇襲) — 頂部進度條 + 每卡片計數徽章 */
  .dmg-progress{ display:flex; flex-direction:column; gap:.35rem; margin-top:.2rem; }
  .dmg-progress-bar{ width:100%; height:10px; background:#0e1e0e; border:1px solid #3a5a3a; border-radius:5px; overflow:hidden; }
  .dmg-progress-fill{ height:100%; background:linear-gradient(90deg,#ff8844,#ff4444); transition:width .2s; }
  .dmg-progress-text{ font-size:1rem; color:#ffcc88; letter-spacing:.02em; }
  .dmg-progress-text .muted{ color:#888; font-size:.82rem; }
  .dmg-progress-text strong{ color:#ffe0a0; font-size:1.1rem; }

  .retreat-card.will-ko{ border-color:#ff4466; box-shadow:0 0 12px rgba(255,68,102,.55); }
  .retreat-card.will-ko.sel-picked{ border-color:#ff6688; box-shadow:0 0 14px rgba(255,102,136,.7); }
  .retreat-pick[disabled]{ opacity:.55; cursor:not-allowed; }
  .retreat-pick[disabled]:hover .retreat-name{ color:#ddd; }

  .dmg-badge{ position:absolute; top:.3rem; left:.3rem; z-index:3; background:linear-gradient(135deg,#ff6030,#cc3030); color:#fff; font-size:.9rem; font-weight:800; padding:.18rem .48rem; border-radius:10px; border:2px solid #fff2; box-shadow:0 2px 6px rgba(0,0,0,.6); pointer-events:none; min-width:1.4rem; text-align:center; }
  .dmg-minus{ position:absolute; top:.3rem; left:2.6rem; z-index:4; width:1.6rem; height:1.6rem; border-radius:50%; background:#2a2a2a; border:1px solid #6a6a6a; color:#fff; font-size:1.1rem; font-weight:800; line-height:1; cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center; }
  .dmg-minus:hover{ background:#cc3030; border-color:#ff8080; }
  .dmg-preview{ color:#ff8866; font-size:.75rem; font-weight:600; margin-top:.15rem; }
  .dmg-ko-tag{ display:inline-block; margin-left:.3rem; background:#ff2040; color:#fff; font-weight:800; padding:.05rem .35rem; border-radius:3px; font-size:.7rem; letter-spacing:.05em; }


  .zoom-overlay{ position:fixed; inset:0; z-index:200; background:rgba(0,0,0,.88); display:flex; align-items:flex-start; justify-content:center; padding:1rem; padding-top:calc(var(--safe-top, 0px) + 1rem); font-family:system-ui,'Microsoft JhengHei',sans-serif; }
  /* v2.69：卡牌詳細 modal 整體等比放大 20%（Leon 反饋） */
  /* v3.884：.zoom-modal 不再是 scroll 容器（iOS Safari flex+overflow bug），改靠內層 .zoom-scroll */
  .zoom-modal{ background:#1a2a1a; border:1px solid #4a7a4a; border-radius:14px; padding:1.44rem; max-width:864px; width:96vw; max-height:calc(100vh - var(--safe-top, 0px) - 3rem); margin:auto; display:flex; flex-direction:column; gap:.9rem; color:#f0f0f0; overflow:hidden; position:relative; }
  /* v3.884：scrollable wrapper inside .zoom-modal — 真正的 scroll 容器（非 flex）*/
  .zoom-scroll{ flex:1 1 auto; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; touch-action:pan-y; overscroll-behavior:contain; width:100%; }
  .zoom-close{ position:absolute; top:1rem; right:1rem; width:2.2rem; height:2.2rem; background:rgba(0,0,0,0.6); border-radius:50%; border:none; color:#eee; font-size:1.44rem; display:flex; align-items:center; justify-content:center; cursor:pointer; line-height:1; z-index:10; box-shadow:0 2px 6px rgba(0,0,0,0.4); }
  .zoom-close:hover{ background:#fff; color:#000; }
  /* v2.32：放到 × 左邊（top-right），避免擋到卡牌圖。.zoom-close 大約 2.2rem 寬，所以 back 從 right:4rem 開始留一些間距。 */
  .zoom-back{ position:absolute; top:1.25rem; right:4.5rem; background:#2a4a6a; border:1px solid #4a6a8a; color:#cce; font-size:.98rem; cursor:pointer; padding:.3rem .72rem; border-radius:4px; line-height:1; z-index:10; box-shadow:0 2px 6px rgba(0,0,0,0.4); }
  .zoom-back:hover{ background:#3a5a8a; color:#fff; }
  .zoom-body{ display:flex; gap:1.5rem; align-items:flex-start; flex-wrap:wrap; }
  .zoom-img{ width:312px; max-width:90vw; border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,.7); flex-shrink:0; }
  .zoom-info{ flex:1; min-width:240px; display:flex; flex-direction:column; gap:.6rem; }
  .zoom-name{ font-size:1.56rem; font-weight:700; color:#fff; }
  .zoom-badges{ display:flex; gap:.42rem; flex-wrap:wrap; }
  .badge{ padding:.22rem .6rem; border-radius:10px; font-size:.9rem; font-weight:600; }
  .hp-badge{ background:#2a5a2a; color:#8f8; border:1px solid #4a8a4a; }
  .type-badge{ color:#fff; }
  .sub-badge{ background:#2a3a5a; color:#aad; border:1px solid #4a5a8a; }
  .mark-badge{ background:#3a3a1a; color:#cc8; border:1px solid #6a6a2a; }
  .zoom-meta{ font-size:.96rem; color:#888; }
  .zoom-state{ background:#0e1a1e; border:1px solid #2a5a6a; border-radius:6px; padding:.6rem .84rem; font-size:.94rem; display:flex; flex-direction:column; gap:.36rem; }
  .state-title{ font-weight:700; color:#8cf; font-size:.98rem; margin-bottom:.12rem; }
  .state-row{ display:flex; gap:.6rem; align-items:baseline; line-height:1.3; }
  .state-k{ color:#8aa; min-width:4rem; flex-shrink:0; }
  .state-v{ color:#ddd; flex:1; display:flex; flex-wrap:wrap; gap:.3rem; align-items:baseline; }
  .state-ecard{ display:inline-block; background:#2a4a6a; color:#ccf; padding:.1rem .48rem; border-radius:3px; font-size:.84rem; border:none; font-family:inherit; }
  .state-ecard.clickable{ cursor:pointer; }
  .state-ecard.clickable:hover{ background:#4a6a8a; color:#fff; }
  .state-tool{ display:inline-block; background:#3a3a10; color:#f0d080; padding:.08rem .4rem; border-radius:3px; font-size:.75rem; border:1px solid #6a5a20; font-family:inherit; cursor:pointer; }
  .state-tool:hover{ background:#5a5a20; color:#fff; }
  .state-chain{ flex-wrap:wrap; }
  .chain-node{ background:#1a2a1a; border:1px solid #3a5a3a; border-radius:3px; padding:.08rem .35rem; font-size:.72rem; color:#aca; font-family:inherit; }
  .chain-node.clickable{ cursor:pointer; }
  .chain-node.clickable:hover{ background:#3a5a3a; color:#fff; }
  .chain-current{ background:#2a4a2a; color:#cfc; border-color:#5a7a5a; font-weight:600; }
  .chain-arr{ color:#667; font-size:.7rem; margin:0 .15rem; }
  .zoom-ability{ background:#1e1e0e; border:1px solid #6a5a1a; border-radius:6px; padding:.5rem .6rem; }
  .ability-label{ display:inline-block; background:#8a1a1a; color:#fcc; font-size:.68rem; font-weight:700; padding:.1rem .35rem; border-radius:3px; margin-right:.4rem; }
  .zoom-attack{ background:#0e1e2e; border:1px solid #2a4a6a; border-radius:6px; padding:.45rem .6rem; }
  /* v3.887：可收折區塊（場上狀態 / 特性 / 招式）— 採用 native <details> */
  .zoom-section{ border:1px solid #3a5a3a; border-radius:8px; background:#1e2e1e; overflow:hidden; }
  .zoom-section[open]{ background:#0e1e0e; }
  .zoom-section-summary{
    cursor:pointer; padding:.5rem .7rem;
    background:#1a2a1a;
    list-style:none;
    display:flex; align-items:center; gap:.4rem; flex-wrap:wrap;
    font-size:.92rem; color:#cce0cc;
    user-select:none;
    transition:background .12s;
  }
  .zoom-section-summary::-webkit-details-marker{ display:none; }
  .zoom-section-summary::before{
    content:'▸';
    display:inline-block;
    color:#8fa;
    font-size:.85rem;
    transition:transform .18s;
    transform-origin:center;
  }
  .zoom-section[open] > .zoom-section-summary::before{ transform:rotate(90deg); }
  .zoom-section-summary:hover{ background:#243424; }
  .zoom-section[open] > .zoom-section-summary{ border-bottom:1px solid #3a5a3a; }
  /* .zoom-section 內的 .zoom-state / .zoom-ability / .zoom-attack 不再加 border（外層 .zoom-section 已有） */
  .zoom-section > .zoom-state,
  .zoom-section > .zoom-ability,
  .zoom-section > .zoom-attack{ border:none; border-radius:0; background:transparent; padding:.5rem .7rem; }

  .atk-header{ display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; }
  .atk-nm{ flex:1; font-weight:600; font-size:.9rem; }
  .atk-dp{ font-weight:700; color:#f88; font-size:1rem; }
  .no-cost{ font-size:.7rem; color:#666; }
  .effect-text{ margin:.3rem 0 0; font-size:.78rem; color:#aaa; line-height:1.5; }
  .zoom-rules{ background:#1e1e1e; border:1px solid #3a3a3a; border-radius:6px; padding:.5rem .6rem; font-size:.8rem; color:#bbb; line-height:1.5; }
  .zoom-footer{ display:flex; gap:.75rem; flex-wrap:wrap; font-size:.78rem; color:#888; border-top:1px solid #2a3a2a; padding-top:.4rem; margin-top:auto; }
  .footer-item{ display:flex; align-items:center; gap:.25rem; }

  /* ── Floating Evo Menu ── */
  .float-evo-backdrop{ position:fixed; inset:0; z-index:50; }
  .float-evo-menu{ position:fixed; z-index:51; transform:translate(-50%,-105%); background:#1a2a1a; border:1px solid #6aaa4a; border-radius:8px; padding:.4rem; display:flex; flex-direction:column; gap:.25rem; min-width:120px; box-shadow:0 4px 24px rgba(0,0,0,.95); }
  .float-evo-title{ font-size:.7rem; color:#aaffaa; text-align:center; font-weight:700; margin-bottom:.15rem; border-bottom:1px solid #2a4a2a; padding-bottom:.2rem; }
  .wide-evo img{ width:70px; }

  /* ── Discard Modal ── */
  .discard-modal{ max-width:920px; }
  .discard-title{ margin:0 0 .6rem; color:#aaffaa; font-size:1.05rem; }
  /* v2.69：棄牌區卡片圖示放大（Leon 反饋：原本太小考驗眼力） */
  .discard-modal .sel-grid{ grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:.55rem; max-height:72vh; }
  .discard-modal .sel-card{ padding:.4rem; font-size:.78rem; }
  .discard-modal .sel-card img{ width:108px; }
  .discard-modal .sel-name{ font-size:.74rem; }
  .discard-modal .sel-hp{ font-size:.68rem; }

  /* ⭐v6.190 獎賞卡檢視（回放限定）。手機/桌機共用同一份樣式 —— 差異只靠尺寸自適應，
     ⚠ 不用 @media 當「手機開關」（手機直式與桌機是兩套獨立分支，開關是 isPortraitMobile）。
     ⚠ 安全區一律讀單一來源 --safe-top / --safe-bottom（v6.187，宣告在 +layout.svelte）。 */
  .prize-view-modal{ max-width:760px; overflow-y:auto;
    padding-bottom:calc(1.44rem + var(--safe-bottom, 0px));
    max-height:calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 2rem); }
  .prize-view-modal .sel-grid{ max-height:none; overflow:visible; }
  .prize-view-side{ margin-bottom:.5rem; }
  .prize-view-side-title{ margin:.15rem 0 .35rem; color:#ffd23f; font-size:.9rem; font-weight:700; }
  .prize-view-btn{ background:rgba(255,210,63,.14); border:1px solid #a8842a; border-radius:6px; color:#ffd23f; cursor:pointer; font:inherit; padding:1px 7px; }
  .prize-view-btn:hover{ background:rgba(255,210,63,.28); }

  /* ── Tool + Stadium ── */
  /* v3.9996：玩家回報自己戰鬥場道具標示看不清楚 — 字太小 + 對比低 */
  /*   放大 font-size .6rem → .78rem，顏色提亮 #f0d080 → #ffd700，加 font-weight 700 */
  /* v3.9997：移除截斷邏輯 — 玩家回報非太晶寶可夢（有 ability-btn 擠寬 active-info） */
  /*   原 overflow:hidden + text-overflow:ellipsis + max-width:100% 會把整個 chip 截成空白 */
  /*   改用 width:max-content（自然寬度）+ 取消 max-width 限制 + z-index 提高避免被覆蓋 */
  .tool-chip{
    font-size:.78rem;
    color:#ffd700;
    background:#2a2208;
    border:1px solid #8a6a10;
    border-radius:4px;
    padding:.08rem .35rem;
    margin-top:.15rem;
    white-space:nowrap;
    width: max-content;
    display: inline-block;
    font-weight:700;
    text-shadow:0 1px 1px rgba(0,0,0,.7);
    position:relative;
    z-index:5;
    flex-shrink:0;
  }
  .tool-chip.sm{ font-size:.62rem; padding:.04rem .25rem; }
  .ab-used-chip{ font-size:.58rem; color:#c8c0f0; background:#2a1a3a; border:1px solid #4a3a6a; border-radius:3px; padding:.06rem .25rem; margin-top:.1rem; display:inline-block; }
  .ab-used-chip.sm{ font-size:.7rem; padding:0 .15rem; border:none; background:transparent; color:#d0a0ff; }
  .tool-btn{ background:#4a3a10; color:#f0d080; }
  .tool-btn:hover{ background:#6a5a20; }
  .stadium-chip{ background:#1a2a4a; color:#88aaff; border-color:#3a5a8a; }
  .clickable-chip{ cursor:pointer; font-family:inherit; }
  .clickable-chip:hover{ background:#2a3a5a; color:#fff; }
  /* v5.129：原 #1a2a4a 深藍底+淺藍字視覺像 disabled，玩家以為不可按。
     改鮮明青藍漸層 + 白字 + glow，辨識「可用」；hover 更鮮 */
  .btn-act.stadium-btn{
    background:linear-gradient(180deg, #3b82f6, #2563eb);
    color:#fff;
    border:1px solid #60a5fa;
    box-shadow:0 0 8px rgba(96, 165, 250, 0.45);
    font-weight:600;
  }
  .btn-act.stadium-btn:hover{
    background:linear-gradient(180deg, #60a5fa, #3b82f6);
    box-shadow:0 0 14px rgba(96, 165, 250, 0.75);
  }

  /* ── 特性按鈕 ── */
  .ability-btn{ display:block; width:100%; margin-top:.2rem; padding:.2rem .3rem; font-size:.65rem; background:#3a1a5a; color:#e0a0ff; border:1px solid #7a4aaa; border-radius:4px; cursor:pointer; text-align:center; }
  .ability-btn:hover{ background:#5a2a8a; }
  .ability-btn-sm{ display:block; width:100%; margin-top:.12rem; padding:.12rem; font-size:.56rem; background:#3a1a5a; color:#e0a0ff; border:1px solid #7a4aaa; border-radius:3px; cursor:pointer; }
  .ability-btn-sm:hover{ background:#5a2a8a; }

  /* ── 特殊狀態晶片 ── */
  .status-chip{ font-size:.62rem; color:#fff; padding:.08rem .25rem; border-radius:3px; margin-top:.1rem; display:inline-block; }
  .status-chip-sm{ font-size:.75rem; display:inline-block; }
  .status-poisoned{ background:#4a0a7a; border:1px solid #8a3aaa; }
  .status-burned{ background:#8a2a00; border:1px solid #cc4a10; }
  .status-asleep{ background:#1a1a5a; border:1px solid #4a4aaa; }
  .status-confused{ background:#5a3a00; border:1px solid #aa7a10; }
  .status-paralyzed{ background:#5a5a00; border:1px solid #aaaa10; }

  /* ── AI 模式 ── */
  .ai-card{ border-color:#5a3a8a !important; }
  .ai-tag{ font-size:.72rem; background:#3a1a5a; color:#e0a0ff; border-radius:4px; padding:.08rem .3rem; margin-left:.4rem; vertical-align:middle; }
  .ai-toggle{ display:flex; align-items:center; gap:.4rem; font-size:.85rem; color:#ccc; cursor:pointer; }
  .ai-toggle input{ cursor:pointer; accent-color:#8a4aee; width:16px; height:16px; }
  .ai-chip{ background:#3a1a5a; color:#e0a0ff; border:1px solid #7a4aaa; animation:pulse 1s infinite alternate; }
  @keyframes pulse{ from{ opacity:.7; } to{ opacity:1; } }

  /* ── v2.130：戰鬥場卡牌底部血條（雙方統一）── */
  /* 把血條從 .active-info 中拉出來，固定在 .active-card 底部，避開特性按鈕 / 進化按鈕 */
  .active-hpbar-bottom{
    position:absolute;
    left:.4rem; right:.4rem;
    bottom:.3rem;
    display:flex; align-items:center; gap:.4rem;
    padding:.15rem .35rem;
    background:rgba(0,0,0,.6);
    border-radius:6px;
    z-index:10;  /* v4.07：高於 tool-chip(z=5) 避免道具標籤蓋住血量數字 */
    pointer-events:none;
  }
  /* v3.9993：戰鬥場血量字加大（玩家反饋字太小）9px → 11px / .72rem → .95rem / 600 → 700 */
  .active-hpbar-bottom .hp-bar-wrap{ flex:1; height:11px; margin:0; background:#1a2a1a; border:1px solid #2a4a2a; border-radius:4px; }
  .active-hpbar-bottom .active-hp-text{ font-size:.95rem; color:#cfe; white-space:nowrap; font-weight:700; text-shadow:0 1px 2px rgba(0,0,0,.7); }
  /* 把進化按鈕往上挪，避免壓到底部血條 */
  .active-card{ padding-bottom:1.95rem !important; }
  .evo-wrap{ bottom:1.85rem !important; }

  /* ── v2.129：zoom-modal 內的 zoom-img 點擊全螢幕放大 ── */
  .zoom-img-btn{ position:relative; display:block; background:none; border:none; padding:0; cursor:zoom-in; }
  .zoom-img-btn .zoom-img{ display:block; }
  .zoom-img-hint{ position:absolute; top:0.4rem; right:0.4rem; background:rgba(0,0,0,0.55); color:#fff; padding:0.15rem 0.4rem; border-radius:0.4rem; font-size:0.85rem; opacity:0.7; pointer-events:none; transition:opacity 0.12s; }
  .zoom-img-btn:hover .zoom-img-hint{ opacity:1; }

  /* ── v2.129：全螢幕 lightbox（鏡射 /cards 樣式，但 z-index 比 zoom-overlay 高） ── */
  .lightbox-overlay{ position:fixed; inset:0; background:rgba(0,0,0,0.92); display:flex; align-items:flex-start; justify-content:center; z-index:9999; cursor:zoom-out; padding:1rem; padding-top:calc(var(--safe-top, 0px) + 1rem); }
  .lightbox-img{ margin:auto; max-width:min(600px,95vw); max-height:calc(100vh - var(--safe-top, 0px) - 3rem); object-fit:contain; border-radius:12px; box-shadow:0 8px 40px rgba(0,0,0,0.6); cursor:default; }
  .lightbox-close{ position:absolute; top:4rem; top:calc(var(--safe-top, 0px) + 1.5rem); right:1.5rem; background:rgba(255,255,255,0.15); border:none; color:#fff; font-size:2rem; line-height:1; width:2.5rem; height:2.5rem; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .lightbox-close:hover{ background:rgba(255,255,255,0.3); }

  /* ════════════════════════════════════════════════════════════════════════
     v2.202 RWD — 手機橫屏（≤950px）
     ════════════════════════════════════════════════════════════════════════
     目標尺寸：手機橫屏 width 800–950px / height 380–440px（iPhone 14/Pro Max、
     Samsung S23 等橫屏 viewport）。桌機（>950px）保留現有 layout 完全不變。

     關鍵預算（430px 高 viewport）：
       header ~36 + 對手 field ~120 + 我方 field ~120 + hand strip ~80 + action bar ~70 = 426
     現有桌機尺寸（active-card 170, bench-slot 205, hand-card 92, action-bar 160-200）
     在這個 viewport 一定爆出去。本 breakpoint 把所有 slot/card 等比縮約 35-40%。

     原則：
       - 只動尺寸（width / height / padding / font-size）；layout flex 結構不動
       - drag drop zone 用 runtime offsetWidth/Height 自動跟著縮，不用手調
       - 動畫（attack-shake/flash、fly）用 transform + relative position，自動 OK
       - v2.198 .battle-root min-height + overflow-y:auto fallback 不拔（撐底保險）
     ════════════════════════════════════════════════════════════════════════ */
  /* 桌機（hover 可用）：放大鈕預設隱藏；hover-peek 看大圖 */
  .hand-zoom-btn{ display:none; }
  /* v2.279：平板 / 觸控裝置（無 hover）— 手牌卡顯示 🔍 放大鈕。
     手機 (max-width:950px) media query 會再覆寫成更小尺寸（18×18 / top:1 / font-size:10px）。
     用 (hover:none) 比寫死 max-width 區間語意更準 — 任何不能 hover 的裝置都該顯示，
     不論是 iPad/Android tablet/Surface 觸控模式/觸控筆電。 */
  @media (hover: none) {
    .hand-zoom-btn{
      display:flex; align-items:center; justify-content:center;
      position:absolute; top:2px; right:2px; z-index:5;
      width:24px; height:24px; padding:0;
      background:rgba(0,0,0,0.65); color:#fff;
      border:1px solid rgba(255,255,255,0.4); border-radius:50%;
      font-size:13px; line-height:1;
      cursor:pointer; touch-action:manipulation;
    }
    .hand-zoom-btn:hover, .hand-zoom-btn:active{ background:rgba(0,0,0,0.85); }
    /* hover-peek 在無 hover 裝置不會觸發；但保險起見禁用 transform 變化避免 stylus 戳到 */
    .hand-card.hover-peek{
      transform: rotate(var(--fan-rot, 0deg)) translateY(var(--fan-lift, 0));
      box-shadow: 0 3px 8px rgba(0,0,0,.35);
    }
  }
  /* v2.206 手機直屏 fallback overlay（在 mobile 直屏時提示旋轉到橫向）
     v2.285：加 min-width:601 — 手機（≤600）直式走 MobilePortraitBattle 元件
     v4.02：加 (hover: none) + (pointer: coarse) 區分「真手機/平板」vs「桌面小視窗」。
       玩家回報桌面瀏覽器縮窄視窗時誤觸發此 overlay 導致無法操作。
       桌面（含縮小視窗）有滑鼠 hover + 細指標 → 不觸發。
       真觸控設備（手機/平板）→ 觸發。 */
  .rotate-prompt{ display:none; }
  @media (min-width: 601px) and (max-width: 950px) and (orientation: portrait)
         and (hover: none) and (pointer: coarse) {
    .rotate-prompt{
      display:flex; position:fixed; inset:0; z-index:99999;
      background:rgba(0,0,0,0.92); color:#fff;
      align-items:center; justify-content:center;
      flex-direction:column; gap:1rem;
      font-family:system-ui,'Microsoft JhengHei',sans-serif;
      padding:2rem; text-align:center;
    }
    .rotate-prompt-icon{ font-size:4rem; animation:rotate-hint 2s ease-in-out infinite; }
    .rotate-prompt-text{ font-size:1.1rem; line-height:1.5; }
    .rotate-prompt-sub{ font-size:0.85rem; color:#aaa; }
    @keyframes rotate-hint {
      0%, 100% { transform: rotate(0deg); }
      50% { transform: rotate(90deg); }
    }
  }

  /* v2.288：手機直式 + 戰鬥中鎖 body 滑動（禁止 iOS Safari pull-to-refresh / bounce）
     v3.880：拿掉 `touch-action: none` — iOS Safari 對 body 級此屬性解讀過強硬，
     會壓制 nested scrollable 元素（zoom-modal / selection-modal）的 pan-y，
     導致查看詳情長文無法滾動。改靠：
     - JS preventScroll (MobilePortraitBattle.svelte) — 擋 touchmove outside whitelist
     - overscroll-behavior: none — 擋 overscroll bouncing
     - position: fixed + width:100% + height:100dvh — 防止整頁位移
     這樣 body level 不強制 touch-action: none，巢狀 modal 內可正常 pan scroll。 */
  :global(body.mp-locked) {
    overflow: hidden !important;
    overscroll-behavior: none;
  }
  :global(html:has(body.mp-locked)) { overflow: hidden; overscroll-behavior: none; }

  /* ════════════════════════════════════════════════════════════════════
     v2.286 Phase 3：手機直屏（≤600px portrait）modal RWD 適配
     ────────────────────────────────────────────────────────────────────
     當 MobilePortraitBattle 元件觸發既有 modal（pendingSelection / zoom-modal /
     selection-modal / lightbox / settings-modal 等）時，這些 modal 原桌機尺寸
     在 ≤600px viewport 會擠爛。以下覆寫 modal 的 width/padding/font-size，讓
     modal 在手機直屏也能舒適閱讀 + 操作。
     ════════════════════════════════════════════════════════════════════ */
  @media (max-width: 600px) and (orientation: portrait) {
    /* v4.969: 手機直屏 selection-overlay 不擋背景 touch — 玩家可同時看 modal
       並橫向滑動手牌瀏覽。半透明背景仍有視覺區隔；modal 本體 pointer-events:auto
       維持正常互動。靠上對齊讓下方手牌區 free。
       此規則同時嘉惠 send-new-active modal（被昏厥後選備戰）+ pendingSelection picker。
       v5.032：原 padding-top 0.4rem 太小，iOS 動態島 / 瀏海會壓到 modal 頂端。
       改用 calc(env(safe-area-inset-top) + 0.4rem) 讓 modal 完整避開 safe area。 */
    .selection-overlay {
      background: rgba(0, 0, 0, 0.4);
      pointer-events: none;
      align-items: flex-start;
      padding-top: calc(var(--safe-top, 0px) + 0.4rem);
      padding-bottom: var(--safe-bottom, 0px);
    }
    .selection-overlay .selection-modal {
      pointer-events: auto;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
    }
    /* selection-modal（pendingSelection 通用 modal） */
    /* v5.308: 加 overflow-y:auto — 對手 8 隻 (零之大空洞滿備戰) 的 picker
       (腎上腺腦力 / 任意對手寶可夢 picker) retreat-grid 內容會超出 max-height,
       v5.299 拿掉內層 grid scroll 後, 沒外層 scroll 會讓 sel-footer (確定鈕) 看不到. */
    .selection-modal {
      width: 96vw; max-width: 96vw;
      padding: 0.6rem; gap: 0.4rem;
      max-height: 88vh;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      border-radius: 10px;
    }
    .sel-header h3 { font-size: 0.95rem; }
    .sel-hint { font-size: 0.7rem; }
    /* v5.299: 手機版拿掉 retreat-grid 內層 max-height + overflow-y, 解雙層滑捲衝突
       (附加道具/能量等 modal 滿場時, 內層 grid 滑捲在手機觸控被外層 selection-modal 截掉,
       導致下半部寶可夢的能量資訊看不見) */
    .retreat-grid {
      max-height: none !important;
      overflow-y: visible !important;
    }
    /* ⭐ v6.122：手機直式整個 modal 才是捲動容器（見上方 v5.299/v5.308），
       備戰滿場時「確定上場」會落在折疊線下面、要捲才看得到。
       補位是**判負攸關**的流程（沒補位 → 錦標賽會被判閒置敗），確定鈕不能藏起來
       ⇒ 只在補位/寶可夢 picker 這類 .retreat-modal 內把 footer 釘在底部。 */
    .retreat-modal .sel-footer {
      position: sticky; bottom: 0; z-index: 2;
      background: #12261a; margin: 0 -0.6rem -0.6rem;
      padding: 0.5rem 0.6rem 0.6rem;
      box-shadow: 0 -6px 12px rgba(0,0,0,.45);
    }
    .sel-grid {
      grid-template-columns: repeat(auto-fill, minmax(54px, 1fr)) !important;
      gap: 0.25rem;
      max-height: 50vh;
    }
    /* v5.667：手機直式能量 picker — 修 v5.664 桌機放大(img 88px)外溢到手機 54px 欄位致排版跑掉。
       欄寬加大到 80px(!important 蓋上面 54px)、圖縮到吻合格子,來源寶可夢名仍完整顯示。 */
    .sel-grid.sel-grid-energy{ grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)) !important; gap:0.3rem; }
    .sel-grid.sel-grid-energy .sel-card img{ width:60px; }
    .sel-grid.sel-grid-energy .sel-name{ font-size:0.6rem; }
    .sel-grid.sel-grid-energy .sel-energy-source{ font-size:0.62rem; }

    /* zoom-modal（卡牌詳細 / 放大）— v3.885 重新啟用 lightbox 點圖 */
    .zoom-modal {
      width: 96vw; max-width: 96vw;
      padding: 0.7rem; gap: 0.55rem;
      max-height: 92vh;
      border-radius: 10px;
    }
    .zoom-img { width: 56vw; max-width: 56vw; }
    .zoom-img-btn { cursor: zoom-in; pointer-events: auto; }
    .zoom-img-hint { display: block; }

    /* settings-modal */
    .settings-modal {
      max-width: 92vw;
      padding: 1rem;
    }

    /* lightbox（全螢幕大圖） */
    .lightbox-img {
      max-width: 96vw; max-height: 86vh;
    }

    /* v2.288：本機雙人對戰 lobby — 手機直式改上下排（避免左右超出） */
    .player-setup {
      grid-template-columns: 1fr !important;
      gap: 0.6rem !important;
    }
    .vs-badge { font-size: 1.2rem !important; padding: 0.2rem 0; }
    .setup-card { padding: 0.7rem; }
    .setup-card h2 { font-size: 0.95rem; }

    /* lobby 整體緊縮 */
    .lobby { padding: 0.8rem !important; }
    .lobby h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    .lobby-subtitle { font-size: 0.78rem; margin: -0.3rem 0 0.6rem; }
    .mode-cards { gap: 0.6rem; }
    .mode-card { padding: 1rem !important; }

    /* 線上 lobby 房間相關元素 */
    .seat-area { grid-template-columns: 1fr !important; gap: 0.4rem; }
  }

  @media (max-width: 950px) and (orientation: landscape) {
    /* ════════════════════════════════════════════════════════════════════
       v2.206：強制不滑動 — battle-root 改 height:100dvh + overflow:hidden，
       field-row 用 flex:1 1 0 + min-height:0 吞下剩餘空間。zoom-modal 縮小到
       無需滾動，手機禁用 zoom→lightbox 二段（Leon 反映兩個畫面突兀）。

       340px viewport 預算（iOS Safari 橫屏 URL bar 沒收的最小情境）：
         header 24 + field*2 (~75 each) + hand-strip 70 + action-bar 40 = 284 ✓
       ════════════════════════════════════════════════════════════════════ */

    /* ── 強制不捲動：battle-root 鎖定 100dvh + overflow:hidden ──
       v2.208：放棄 flex:1 1 0（不可預測的分配），改用 explicit vh 比例。
       header 6vh + field 30vh×2 + hand 16vh + action 12vh = 94vh（剩 6vh buffer）。
       每個 row flex:0 0 <vh> + overflow:hidden 確保內容超出時不擠到別 row。 */
    .battle-root{ height:100vh; height:100dvh; min-height:0; overflow:hidden; }
    /* v5.953 平板橫向(601-950)回放列壓成單行,避免 wrap 佔多行擠爆 vh 預算把 action-bar 切掉 */
    .treplay-bar{ padding:2px 6px; gap:4px; flex-wrap:nowrap; overflow-x:auto; }
    .treplay-bar .treplay-title{ display:none; }
    .treplay-bar .treplay-oldfmt{ display:none; }
    .treplay-bar .treplay-btn{ padding:3px 7px; font-size:.7rem; }
    .treplay-bar .treplay-step{ font-size:.7rem; }
    /* v5.070：mobile portrait — padding-top 同樣加 env(safe-area-inset-top) */
    .battle-header{ flex:0 0 auto; max-height:7vh; padding:calc(0.1rem + var(--safe-top, 0px)) 0.4rem 0.1rem 0.4rem; gap:0.2rem; font-size:0.66rem;
                    overflow-x:auto; overflow-y:hidden; flex-wrap:nowrap; white-space:nowrap; }
    .battle-header > *{ flex-shrink:0; }
    .field-row{ flex:0 0 30vh; max-height:30vh; min-height:0; overflow:hidden;
                padding:0.1rem 0.25rem; gap:0.2rem; }
    .hand-strip{ flex:0 0 16vh; max-height:16vh; min-height:0; overflow:hidden;
                 padding:0.1rem 0.35rem; }
    .action-bar{ flex:0 0 12vh; max-height:12vh; min-height:0; padding:0.12rem 0.3rem; gap:0.2rem;
                 display:flex; flex-wrap:nowrap; align-items:center; justify-content:space-between;
                 overflow-x:auto; overflow-y:hidden; }

    /* ── 戰鬥場框（active card）—— v2.207 縮到 60px 給 field-row 容身空間 ── */
    .active-card{ min-height:60px; padding:0.18rem 0.22rem; gap:0.18rem; border-radius:5px; }
    .active-card.active-empty{ min-height:56px; padding:0.35rem; font-size:0.62rem; }
    .active-img{ max-width:44px; max-height:62px; object-fit:contain; }
    /* ── 備戰格 —— v2.207 縮到 64px ── */
    .bench-slot{ flex:1 1 44px; min-width:44px; max-width:62px; height:64px; padding:0.08rem; font-size:0.5rem; gap:0.03rem; }
    .bench-slot img{ max-width:48px; max-height:42px; }
    /* ── 手牌卡 —— v2.207 隱藏 hint 文字節省垂直空間，只留 img + 🔍 鈕 ── */
    .hand-card{ width:46px; padding:0.08rem; gap:0.04rem; font-size:0.5rem; position:relative; }
    .hand-card img{ width:42px; }
    .hand-card-name, .hand-name{ font-size:0.48rem; line-height:1; max-height:1.2em; overflow:hidden; }
    .hand-hint{ display:none; }  /* 手機隱藏「⚡ 拖曳附加」「📥 拖到備戰」等提示 — 拖一拖就懂，省空間 */
    /* ── 手機專屬 🔍 放大鈕（取代 hover-peek） ── */
    .hand-zoom-btn{
      display:flex; align-items:center; justify-content:center;
      position:absolute; top:1px; right:1px; z-index:5;
      width:18px; height:18px; padding:0;
      background:rgba(0,0,0,0.65); color:#fff;
      border:1px solid rgba(255,255,255,0.4); border-radius:50%;
      font-size:10px; line-height:1;
      cursor:pointer; touch-action:manipulation;
    }
    .hand-zoom-btn:hover{ background:rgba(0,0,0,0.85); }
    /* ── header chip 字體再縮 ── */
    .battle-header .chip{ font-size:0.6rem; padding:0.05rem 0.3rem; }
    /* ── hand-scroll: 砍 min-height + perspective（避免被撐高） ── */
    .hand-scroll{ min-height:0; height:100%; padding:2px 0.4rem; perspective:none; align-items:center; }
    .alerts-col{ max-width:140px; gap:0.08rem; }
    .alert{ font-size:0.66rem; padding:0.12rem 0.35rem; }
    .stadium-display{ padding:0.15rem 0.25rem; gap:0.08rem; }
    .stadium-display img{ width:36px; }
    .stadium-display-label{ font-size:0.58rem; }
    .stadium-display-name{ font-size:0.58rem; max-width:70px; }
    .action-btns{ gap:0.2rem; }
    .btn-act{ padding:0.25rem 0.45rem; font-size:0.72rem; }
    .btn-act.atk{ flex-direction:column; padding:0.18rem 0.35rem; min-height:38px; gap:0.05rem; }
    .btn-act.atk .atk-name{ font-size:0.66rem; }
    .btn-act.atk .atk-dmg{ font-size:0.7rem; font-weight:700; }
    /* ── 選擇 modal ── */
    .selection-modal{ max-width:580px; width:96vw; max-height:82vh; padding:0.6rem; gap:0.4rem; }
    .sel-header h3{ font-size:0.86rem; }
    .sel-hint{ font-size:0.66rem; }
    .sel-grid{ grid-template-columns:repeat(auto-fill, minmax(52px, 1fr)); gap:0.25rem; max-height:46vh; }
    /* ── stepper（仍 ≥40px 觸控最小） ── */
    .stepper-btn{ width:2.4rem; height:2.4rem; font-size:1.2rem; }
    .stepper-value{ min-width:4rem; font-size:1.3rem; line-height:2.2rem; }

    /* ── v3.886 zoom 全螢幕 + 圖片強制縮小（!important 覆寫桌機 width:312px + flex-shrink:0） ──
       v3.885 寫了 .zoom-img max-height:36vh 但沒生效 — 桌機 CSS 仍套用。
       本版用 !important 強制覆寫，並改 .zoom-body 為 column stack。 */
    .zoom-modal{
      max-width:100vw !important; width:100vw !important;
      max-height:100vh !important; max-height:100dvh !important; height:100dvh !important;
      padding:0.5rem !important; gap:0.4rem !important;
      border-radius:0 !important;
      margin:0 !important;
    }
    /* v3.886：image + info 上下排（column stack），避免 flex row wrap 造成圖片不縮 */
    .zoom-body{
      display:flex !important;
      flex-direction:column !important;
      gap:0.4rem !important;
      align-items:center !important;
      flex-wrap:nowrap !important;
    }
    /* v3.886：圖片強制縮小到 max-height:34vh — 用 !important 蓋桌機 width:312px */
    .zoom-img{
      max-height:34vh !important;
      max-width:88vw !important;
      width:auto !important;
      height:auto !important;
      object-fit:contain !important;
      flex-shrink:1 !important;
      box-shadow:0 4px 16px rgba(0,0,0,0.5);
    }
    /* v3.886：.zoom-img-btn 中央對齊 + 重啟 lightbox 點擊 */
    .zoom-img-btn{
      display:flex !important;
      justify-content:center !important;
      align-items:center !important;
      width:auto !important;
      flex-shrink:1 !important;
      cursor:zoom-in !important;
      pointer-events:auto !important;
      padding:0 !important;
    }
    .zoom-img-btn .zoom-img{ display:block; }
    .zoom-info{
      width:100% !important;
      min-width:0 !important;
    }
    .zoom-name{ font-size:1rem; }
    .zoom-badges{ gap:0.25rem; }
    .zoom-badges .badge{ font-size:0.66rem; padding:0.1rem 0.4rem; }
    .zoom-meta, .zoom-state, .state-row{ font-size:0.74rem; }
    .zoom-img-hint{ display:block !important; font-size:0.7rem; }
  }

  /* v2.73 殭屍房警示 banner */
  .zombie-warning {
    display: flex;
    align-items: center;
    gap: 1rem;
    background: linear-gradient(90deg, rgba(255, 80, 80, 0.15), rgba(255, 140, 80, 0.12));
    border: 1px solid rgba(255, 100, 100, 0.4);
    border-radius: 10px;
    padding: 1rem 1.25rem;
    margin: 0.75rem 0;
    color: #fff;
  }
  .zw-icon { font-size: 1.8rem; flex-shrink: 0; }
  .zw-text { flex: 1; line-height: 1.45; }
  .zw-text strong { color: #ffb3b3; font-size: 1.05rem; }
  .zw-sub { font-size: 0.85rem; color: rgba(255, 255, 255, 0.7); margin-top: 0.2rem; }
  .zw-btn {
    background: #c0392b !important;
    color: #fff !important;
    border: none;
    padding: 0.6rem 1.1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    flex-shrink: 0;
  }
  .zw-btn:hover { background: #a83121 !important; }
  .zw-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  /* v2.85 防止對戰 UI 誤選文字（user-select: none） */
  /* 範圍只在 .battle-root（對戰頁），首頁／卡牌資料庫等不影響 */
  .battle-root, .battle-root * {
    user-select: none;
    -webkit-user-select: none;
  }
  /* 例外 — 以下區塊保留可選文字（玩家可能想 copy 紀錄、訊息、房號、卡片描述等） */
  .battle-root .log-col, .battle-root .log-col *,
  .battle-root .chat-messages, .battle-root .chat-messages *,
  .battle-root .chat-panel-messages, .battle-root .chat-panel-messages *,
  .battle-root .modal-body, .battle-root .modal-body *,
  .battle-root .room-code-inline, .battle-root .room-code-inline *,
  .battle-root input, .battle-root textarea, .battle-root select {
    user-select: text;
    -webkit-user-select: text;
  }

  /* v2.86 modal 底部拖曳提示（避免玩家不知道視窗可拖開） */
  .selection-modal::after {
    content: '💡 提示：按住上方標題列可拖曳視窗到不擋場面的位置';
    display: block;
    text-align: center;
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.55);
    padding: 0.4rem 0.5rem 0.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin-top: 0;
    user-select: none;
    pointer-events: none;
  }
  /* 拖曳後（dragged）視窗背景透明 — 提示也跟著淡化但仍可見 */
  .selection-overlay.dragged .selection-modal::after {
    color: rgba(255, 255, 255, 0.4);
  }
  /* v4.74 練習模式悔棋按鈕（仿 btn-act 但用警示色提醒玩家「這是練習模式專用」）*/
  .btn-undo {
    background: linear-gradient(180deg, #f59e0b, #d97706);
    color: #fff;
    border: 1px solid #b45309;
  }
  .btn-undo:hover { background: linear-gradient(180deg, #fbbf24, #ea8a0a); }

  /* v4.75 連線練習模式 — 等待對手回應 / 取消請求 按鈕 */
  .btn-undo-waiting {
    background: linear-gradient(180deg, #6b7280, #4b5563);
    color: #fff;
    border: 1px solid #374151;
    cursor: wait;
    opacity: 0.85;
  }
  .btn-undo-cancel {
    background: linear-gradient(180deg, #dc2626, #991b1b);
    color: #fff;
    border: 1px solid #7f1d1d;
  }
  .btn-undo-cancel:hover { background: linear-gradient(180deg, #ef4444, #b91c1c); }

  /* v4.75 對手請求悔棋 modal */
  /* v6.022 錦標賽通知：首次詢問視窗 */
  .notify-prompt-overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.65);
    z-index: 10000;
    display: flex; align-items: center; justify-content: center;
  }
  .notify-prompt-modal {
    background: #1a1a2e;
    border: 2px solid #4a9eff;
    border-radius: 12px;
    padding: 24px 28px;
    max-width: 460px;
    width: 90vw;
    color: #e0e0e0;
    box-shadow: 0 8px 32px rgba(74, 158, 255, 0.3);
  }
  .notify-prompt-modal h3 { margin: 0 0 12px 0; color: #7cc4ff; font-size: 20px; }
  .notify-prompt-modal p { margin: 8px 0; line-height: 1.6; }
  .notify-prompt-modal .muted { color: #9aa3b0; font-size: 13px; }
  .notify-prompt-modal .ios-hint { color: #e0a050; }
  .notify-prompt-btns { display: flex; gap: 12px; margin-top: 18px; justify-content: flex-end; }

  .undo-modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.65);
    z-index: 10000;
    display: flex; align-items: center; justify-content: center;
  }
  .undo-request-modal {
    background: #1a1a2e;
    border: 2px solid #f59e0b;
    border-radius: 12px;
    padding: 24px 28px;
    max-width: 460px;
    width: 90vw;
    color: #e0e0e0;
    box-shadow: 0 8px 32px rgba(245, 158, 11, 0.3);
  }
  .undo-request-modal h3 {
    margin: 0 0 12px 0;
    color: #fbbf24;
    font-size: 20px;
  }
  .undo-action-desc {
    font-size: 16px;
    margin: 8px 0 16px 0;
    padding: 10px 14px;
    background: rgba(245, 158, 11, 0.1);
    border-left: 3px solid #f59e0b;
    border-radius: 4px;
  }
  .undo-action-desc b { color: #fbbf24; }
  .undo-request-modal .muted {
    color: #999;
    font-size: 13px;
    line-height: 1.5;
    margin: 0 0 18px 0;
  }
  .undo-modal-btns {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  .undo-agree-btn {
    background: linear-gradient(180deg, #10b981, #059669);
    color: #fff;
    border: 1px solid #047857;
    padding: 10px 24px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .undo-agree-btn:hover { background: linear-gradient(180deg, #34d399, #10b981); }
  .undo-reject-btn {
    background: linear-gradient(180deg, #6b7280, #4b5563);
    color: #fff;
    border: 1px solid #374151;
    padding: 10px 24px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .undo-reject-btn:hover { background: linear-gradient(180deg, #9ca3af, #6b7280); }

  /* v4.75 lobby 練習房 badge + checkbox 樣式 */
  .or-practice-tag {
    background: linear-gradient(180deg, #f59e0b, #d97706);
    color: #fff;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    margin-left: 6px;
  }
  .open-room-row.practice-room {
    border-left: 3px solid #f59e0b;
  }
  /* v5.124 lobby 等待開戰 badge — 仿練習 pattern，改用青藍漸層區分 */
  .or-waiting-tag {
    background: linear-gradient(180deg, #06b6d4, #0891b2);
    color: #fff;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    margin-left: 6px;
  }
  .open-room-row.room-full {
    border-left: 3px solid #06b6d4;
  }
  /* room-full 同時是 practice 時左邊框優先顯示等待開戰青色（更重要的訊息） */
  .open-room-row.room-full.practice-room {
    border-left: 3px solid #06b6d4;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.25);
    border-radius: 6px;
    margin: 8px 0;
    cursor: pointer;
    font-size: 14px;
  }
  .check-row input[type="checkbox"] {
    accent-color: #f59e0b;
    transform: scale(1.2);
  }

  /* ──────────────────────────────────────────────────────────────────
     v4.913 登入 dashboard / Auth modal CSS（port 自牌組編輯器）
     ────────────────────────────────────────────────────────────────── */
  .auth-dashboard {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.4rem 0 1rem;
  }
  /* Sync status pill */
  .sync-pill {
    font-size: 0.78rem;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
  }
  .sync-idle    { background: #2a3a2a; color: #aaa; }
  .sync-syncing { background: #4a3e1a; color: #ffd870; }
  .sync-synced  { background: #1a3a22; color: #88cc88; }
  .sync-error   { background: #4a1a1a; color: #ffa0a0; cursor: help; }

  /* Auth header elements */
  .auth-btn {
    background: #3a3322;
    border: 1px solid #6a5520;
    border-radius: 6px;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
    color: #f0e8c0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .auth-btn:hover { background: #4a4030; }
  .auth-sub { color: #88ccff; font-size: 0.78rem; }
  .auth-user {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .auth-email {
    font-size: 0.82rem;
    color: #ccc;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .auth-user button.small {
    background: #2a3a2a;
    border: 1px solid #4a5a4a;
    color: #f0f0f0;
    border-radius: 5px;
    padding: 0.2rem 0.55rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .auth-user button.small:hover { background: #3a4a3a; }
  .auth-user button.small.danger {
    background: #3a1a1a;
    border-color: #5a3a3a;
    color: #ffb0b0;
  }
  .auth-user button.small.danger:hover { background: #4a2a2a; }

  /* Preview-style overlay used by auth modals */
  .pv-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    z-index: 100;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 1rem;
    padding-top: calc(var(--safe-top, 0px) + 1rem);
    cursor: zoom-out;
  }
  .pv-inner {
    background: #fff;
    color: #222;
    border-radius: 12px;
    max-width: 1170px;
    width: 100%;
    max-height: calc(100vh - var(--safe-top, 0px) - 3rem);
    margin: auto;
    overflow-y: auto;
    position: relative;
    padding: 1.5rem;
    cursor: default;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  }
  .pv-close {
    position: absolute;
    top: 1.25rem;
    right: 1.25rem;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    border: 1px solid #ddd;
    background: #f4f4f4;
    color: #222;
    font-size: 1.45rem;
    line-height: 1;
    cursor: pointer;
    z-index: 1;
  }
  .pv-close:hover { background: #e8e8e8; }

  /* Auth modal */
  .auth-modal { max-width: 420px; }
  .modal-title { margin: 0 0 0.5rem; font-size: 1.1rem; color: #222; }
  .auth-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid #eee;
    margin-bottom: 1rem;
  }
  .auth-tabs button {
    flex: 1;
    background: none;
    border: none;
    padding: 0.5rem;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
    color: #888;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
  }
  .auth-tabs button.active {
    color: #0066cc;
    border-bottom-color: #0066cc;
    font-weight: 600;
  }
  .auth-desc {
    font-size: 0.88rem;
    color: #555;
    margin: 0 0 1rem;
  }
  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .auth-form input {
    padding: 0.5rem 0.65rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    font: inherit;
    font-size: 0.95rem;
    color: #222;
    background: #fff;
  }
  .auth-form input:focus { outline: 2px solid #4a7fd4; border-color: transparent; }
  .auth-form button.small {
    padding: 0.5rem 0.8rem;
    font-size: 0.95rem;
    border-radius: 6px;
    border: 1px solid #ccc;
    background: #f4f4f4;
    color: #222;
    cursor: pointer;
  }
  .auth-form button.small.primary {
    background: #0066cc;
    color: #fff;
    border-color: #0066cc;
  }
  .auth-form button.small.primary:hover:not(:disabled) { background: #0055aa; }
  .auth-form button.small.primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .auth-link {
    background: none;
    border: none;
    color: #4a90e2;
    text-decoration: underline;
    font-size: 0.9em;
    padding: 4px 0;
    cursor: pointer;
    text-align: center;
  }
  .auth-link:hover { color: #2d6cc0; }
  .auth-success {
    color: #2d8d3e;
    background: #e8f5ea;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #b8e0c0;
    font-size: 0.9em;
    margin: 4px 0;
  }
  .auth-error {
    margin: 0;
    color: #c00;
    font-size: 0.85rem;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Fable 版對戰版面 — battleLayout === 'fable' → .playmat.layout-fable
     全部 scope 在 .playmat.layout-fable，不洩漏 classic / .layout-tabletop。
     1) --card-w 單一尺寸源；--card-scale 由設定面板 slider 注入。
     2) 忠實實體桌墊 grid-template-areas；log 佔右側 grid 欄。
     3) gameZoom 於 fable 鎖 1；tablet-layout 絕緣。
     4) 備戰列 repeat(var(--bench-n)) minmax 自適應（8 備戰自動收縮不捲動）。
     ═══════════════════════════════════════════════════════════════════ */
  .playmat.layout-fable{
    --card-scale-safe: clamp(0.7, var(--card-scale, 1), 1.4);
    /* v5.957 一頁鎖高：--card-w-cap = 由視窗高反推的卡寬硬上限(header/hand/gap 等固定開銷約 300px，
       除以四排卡總高係數 6.05)。滑桿照常放大縮小，但永遠被 cap 鎖住 → 任何 scale 都撐不破一頁。 */
    --card-w-cap: calc((100dvh - 300px) / 6.05);
    --card-w: min(calc(clamp(64px, 5.4vw, 96px) * var(--card-scale-safe)), var(--card-w-cap));
    --card-h: calc(var(--card-w) * 1.4);
    --active-w: calc(var(--card-w) * 1.16);
    --active-h: calc(var(--active-w) * 1.4);
    --fan-step: calc(var(--card-w) * 0.32);
    --mat-gap: clamp(6px, 0.8vw, 14px);
    --row-gap: clamp(8px, 1.2vh, 18px);
    --log-w: clamp(220px, 18vw, 300px);
    --badge-fs: clamp(0.6rem, calc(var(--card-w) * 0.12), 0.82rem);
    display:grid !important;
    position:relative;
    grid-template-columns:auto calc(var(--card-w) * 1.08) minmax(0, 1fr) clamp(140px, 12vw, 176px) auto var(--log-w);
    grid-template-rows:auto minmax(0, 1fr) minmax(0, 1fr) auto;
    grid-template-areas:
      "benchO   benchO  benchO    benchO   benchO   log"
      "pilesO   stad    activeO   actions  prizesO  log"
      "prizesMe stad    activeMe  actions  pilesMe  log"
      "benchMe  benchMe benchMe   benchMe  benchMe  log";
    gap:var(--row-gap) var(--mat-gap);
    padding:10px 10px;
    align-items:center;
    margin-right:0;
  }
  .playmat.layout-fable.log-collapsed{ --log-w:0px; }
  .playmat.layout-fable > .field-row,
  .playmat.layout-fable > .action-bar{ display:contents !important; }
  .playmat.layout-fable .opponent-row > .turn-order-chip{ position:absolute; left:10px; top:10px; z-index:60; margin:0; }
  .playmat.layout-fable .my-row > .turn-order-chip{ position:absolute; left:10px; bottom:10px; z-index:60; margin:0; }
  .playmat.layout-fable .opponent-row > .zone-pile{ grid-area:pilesO; display:flex; flex-direction:column; gap:4px; align-self:center; justify-self:start; }
  .playmat.layout-fable .opponent-row > .zone-prizes{ grid-area:prizesO; align-self:center; justify-self:end; }
  .playmat.layout-fable .my-row > .zone-prizes{ grid-area:prizesMe; align-self:center; justify-self:start; }
  .playmat.layout-fable .my-row > .zone-pile{ grid-area:pilesMe; display:flex; flex-direction:column; gap:4px; align-self:center; justify-self:end; }
  .playmat.layout-fable .pile-slot{ width:calc(var(--card-w) * 0.82); min-height:calc(var(--card-w) * 0.62); }
  .playmat.layout-fable .prize-card{ width:calc(var(--card-w) * 0.4); height:calc(var(--card-w) * 0.56); }
  .playmat.layout-fable .zone-bench{
    display:grid !important;
    grid-template-columns:repeat(var(--bench-n, 5), minmax(0, var(--card-w)));
    gap:calc(var(--card-w) * 0.07);
    justify-content:center;
    height:calc(var(--card-h) + 8px);
    min-height:0; max-height:none;
    overflow:visible !important;
    contain:layout;
    position:relative;
    z-index:200;
  }
  .playmat.layout-fable .opponent-row > .zone-bench{ grid-area:benchO; align-self:end; }
  .playmat.layout-fable .my-row > .zone-bench{ grid-area:benchMe; align-self:start; }
  .playmat.layout-fable .zone-bench.bench-extended{ overflow-x:visible !important; overflow-y:visible !important; }
  .playmat.layout-fable .zone-bench .bench-slot,
  .playmat.layout-fable .zone-bench .bench-empty,
  .playmat.layout-fable .zone-bench.bench-extended .bench-slot,
  .playmat.layout-fable .zone-bench.bench-extended .bench-empty{
    flex:none; width:auto; min-width:0; max-width:none;
    height:calc(var(--card-h) + 6px); min-height:0;
  }
  .playmat.layout-fable .bench-slot{ position:relative; overflow:visible !important; contain:layout style; padding:2px; border-radius:6px; }
  .playmat.layout-fable .bench-slot .bench-middle{ display:flex; align-items:center; justify-content:center; position:absolute; inset:0; overflow:visible; }
  .playmat.layout-fable .bench-slot .bench-middle img{ z-index:99; height:100%; width:auto; max-width:100%; max-height:100%; object-fit:contain; border-radius:4px; }
  .playmat.layout-fable .zone-bench.bench-extended .bench-slot img{ max-width:100%; max-height:100%; }
  .playmat.layout-fable .bench-slot .bench-name{
    position:absolute; left:3%; right:3%; top:36%; z-index:200; pointer-events:none;
    font-size:clamp(0.66rem, calc(var(--card-w) * 0.14), 0.98rem);
    font-weight:700; color:#fff; text-align:center; line-height:1.1;
    text-shadow:0 1px 3px rgba(0,0,0,.95);
    background:rgba(0,0,0,.72); border-radius:3px; padding:1px 3px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .playmat.layout-fable .bench-slot .bench-stat{
    position:absolute; left:6%; right:6%;
    top:calc(36% + clamp(16px, calc(var(--card-w) * 0.24), 24px));
    z-index:200; pointer-events:none;
    font-size:clamp(0.68rem, calc(var(--card-w) * 0.14), 1rem);
    font-weight:700; color:#cfe; text-align:center; line-height:1.15;
    text-shadow:0 1px 3px rgba(0,0,0,.95);
    background:rgba(0,0,0,.8); border-radius:3px; padding:1px 4px;
  }
  .playmat.layout-fable .bench-slot > .hp-bar-wrap{ position:absolute; left:4%; right:4%; bottom:3px; z-index:200; margin:0; }
  .playmat.layout-fable .bench-slot .ability-btn-sm{
    position:absolute; left:3%; right:3%; bottom:16%; z-index:201; margin:0 !important;
    font-size:var(--badge-fs) !important; font-weight:600;
    padding:.3rem .35rem !important; border-radius:4px !important;
    box-shadow:0 2px 4px rgba(0,0,0,.5); min-height:24px;
  }
  .playmat.layout-fable .bench-slot .evo-btn-sm{
    position:absolute; left:3%; right:3%; bottom:calc(16% + 30px); z-index:201; margin:0 !important;
    font-size:var(--badge-fs) !important; box-shadow:0 2px 4px rgba(0,0,0,.5);
  }
  .playmat.layout-fable .bench-slot .evo-btn-sm.fossil-discard-btn{ font-weight:600; padding:.28rem .35rem !important; min-height:24px; }
  .playmat.layout-fable .bench-slot .ab-used-chip.sm{
    position:absolute; right:3%; top:3%; z-index:201; margin:0;
    background:rgba(160,160,160,.85); color:#222; font-size:var(--badge-fs); padding:1px 4px; border-radius:8px;
  }
  .playmat.layout-fable .bench-slot .status-chip-sm{
    position:absolute; left:3%; top:3%; z-index:201; margin:0;
    font-size:calc(var(--badge-fs) * 1.05); padding:0 3px; border-radius:8px;
  }
  .playmat.layout-fable .bench-slot .attach-hint{
    position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); z-index:202; margin:0;
    font-size:clamp(1rem, calc(var(--card-w) * 0.18), 1.4rem);
    background:rgba(0,0,0,.78); color:#ffeb3b; padding:5px 10px; border-radius:8px;
    box-shadow:0 0 12px rgba(255,235,59,.7);
  }
  .playmat.layout-fable .bench-slot .tool-chip.sm{ display:none; }
  .playmat.layout-fable .bench-slot .att-card-stack{
    position:absolute; top:50%; left:50%; transform:translate(-50%, -50%);
    width:100%; max-width:100%; aspect-ratio:96/135; height:auto;
    overflow:visible !important; pointer-events:none;
  }
  /* v5.959 雙 active 靠中線(中間距=row-gap)、active↔bench 拉開=1fr 剩餘高 → 附加卡扇開較不疊；
     z-index:210 > zone-bench(200) → 戰鬥場 HP/血條/特性鈕/進化鈕永遠在備戰卡之上(.playmat isolation:isolate
     封裝,不外洩蓋 playmat 外 fixed modal/zoom;alerts-col z:230 仍最高)。 */
  .playmat.layout-fable .opponent-row > .zone-active{ grid-area:activeO; justify-self:center; align-self:end; position:relative; z-index:210; transform:none; }
  .playmat.layout-fable .my-row > .zone-active{ grid-area:activeMe; justify-self:center; align-self:start; position:relative; z-index:210; transform:none; }
  .playmat.layout-fable .opponent-row .active-card .active-name-tt{ top:auto; bottom:100%; margin-top:0; margin-bottom:4px; }
  .playmat.layout-fable .zone-active{ width:auto; flex:none; display:flex; flex-direction:column; align-items:center; gap:2px; }
  .playmat.layout-fable .active-card{
    /* v5.958 放卡零位移:此頁無全域 border-box,active-empty padding .4rem 在 content-box 墊高 12.8px
       →空位(170.7)≠實卡(157.9)放卡跳動;border-box 令空位/實卡/卡背三態同高 --active-h */
    box-sizing:border-box;
    display:block; width:var(--active-w) !important; height:var(--active-h) !important;
    min-height:0 !important; max-height:none !important; padding:0 !important;
    position:relative; overflow:visible;
    background:rgba(0,0,0,.28); border:1px solid #3a5a3a; border-radius:8px;
  }
  .playmat.layout-fable .active-card .active-img{ position:absolute; inset:0; width:100% !important; height:100%; object-fit:contain; z-index:99; border-radius:6px; }
  .playmat.layout-fable .active-card.active-empty{
    display:flex; align-items:center; justify-content:center;
    width:var(--active-w) !important; height:var(--active-h) !important;
    min-height:0 !important; padding:.4rem !important;
    font-size:clamp(.6rem, calc(var(--card-w) * 0.11), .85rem);
  }
  .playmat.layout-fable .active-card.card-back-active{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; }
  /* v6.223【A】setup 卡背改吃 fable 同一尺寸源：容器(.active-card)已被上方規則鎖成 --active-w/--active-h，
     但 .card-back-lg/-sm 是全域固定 px（105×140 / 96×128，另加 2px border）——視窗一縮正面卡跟著變小、
     卡背卻不動 → 卡背比正面卡大且比例不符（站長截圖的病灶）。改讓卡背填滿容器（=與正面卡同源），
     box-sizing 把 border 算進盒內避免 4px 溢出。bench 蓋牌槽同理。 */
  .playmat.layout-fable .active-card.card-back-active .card-back{ width:100%; height:100%; box-sizing:border-box; border-radius:6px; }
  .playmat.layout-fable .bench-slot.card-back-slot .card-back{ width:100%; height:100%; box-sizing:border-box; border-radius:4px; }
  .playmat.layout-fable .active-card > .att-card-stack{ position:absolute; top:4%; left:5%; width:100%; height:100%; overflow:visible !important; pointer-events:none; }
  .playmat.layout-fable .att-card{
    position:absolute; left:0; top:0; width:100%; height:auto;
    border:1px solid rgba(255,255,255,0.35); border-radius:3px;
    box-shadow:0 2px 4px rgba(0,0,0,0.65); pointer-events:auto; cursor:zoom-in;
  }
  .playmat.layout-fable .att-card.att-tool{ border-color:#d4a000; }
  .playmat.layout-fable .att-card.att-evo{ border-color:#88aaff; }
  .playmat.layout-fable .att-card:hover{ border-color:#ffd44a !important; box-shadow:0 0 14px rgba(255,212,74,.9), 0 2px 6px rgba(0,0,0,.6); transition:border-color .12s, box-shadow .12s; }
  .playmat.layout-fable .active-card .active-img:hover,
  .playmat.layout-fable .bench-slot .bench-middle img:hover{ filter:brightness(1.12) drop-shadow(0 0 8px rgba(255,212,74,.7)); transition:filter .12s; }
  /* v5.957 HP 條改滿寬 overlay：血條永遠佔滿卡寬(雙方等長明顯、不被 HP 字數擠壓)，HP 文字疊血條正中(不佔 flow、不多吃高度) */
  .playmat.layout-fable .active-card .active-hpbar-bottom{
    position:absolute; left:3%; right:3%; bottom:2%; top:auto;
    display:block; padding:3px 5px; margin:0; width:auto; transform:none;
    background:rgba(0,0,0,.75); border-radius:6px; z-index:135; pointer-events:none;
  }
  .playmat.layout-fable .active-card .active-hpbar-bottom .hp-bar-wrap{ display:block; width:100%; height:clamp(12px, calc(var(--card-w) * 0.17), 16px); margin:0; border-radius:5px; border:1px solid rgba(255,255,255,.18); }
  .playmat.layout-fable .active-card .active-hpbar-bottom .active-hp-text{
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    z-index:3; font-size:clamp(.58rem, calc(var(--card-w) * 0.105), .78rem); font-weight:700;
    white-space:nowrap; line-height:1; color:#fff;
    text-shadow:0 1px 2px rgba(0,0,0,.95), 0 0 4px rgba(0,0,0,.9);
  }
  .playmat.layout-fable .active-card .active-name-tt{
    position:absolute; top:100%; left:50%; transform:translateX(-50%);
    width:calc(var(--active-w) * 1.3); margin-top:4px; z-index:100; pointer-events:none;
    font-size:clamp(.72rem, calc(var(--card-w) * 0.13), .95rem);
    font-weight:700; color:#fff; text-align:center; line-height:1.2;
    background:rgba(0,0,0,.82); padding:3px 6px; border-radius:4px;
    word-break:keep-all; overflow-wrap:anywhere;
    text-shadow:0 1px 2px rgba(0,0,0,.95); box-shadow:0 2px 4px rgba(0,0,0,.4);
  }
  .playmat.layout-fable .active-card .active-info{
    position:absolute; left:3%; top:3%; right:auto; bottom:auto;
    display:flex; flex-direction:column; align-items:flex-start; gap:3px;
    max-width:80%; min-width:0; flex:none; z-index:140; pointer-events:none;
  }
  .playmat.layout-fable .active-card .active-info .active-name{ display:none; }
  .playmat.layout-fable .active-card .active-info .tool-chip{ display:none; }
  .playmat.layout-fable .active-card .active-info .status-chip{ font-size:var(--badge-fs); padding:1px 6px; border-radius:9px; box-shadow:0 1px 3px rgba(0,0,0,.6); }
  .playmat.layout-fable .active-card .active-info .ab-used-chip{ font-size:var(--badge-fs); padding:1px 6px; border-radius:9px; }
  .playmat.layout-fable .active-card .active-info .attach-hint{ font-size:calc(var(--badge-fs) * 1.15); background:rgba(0,0,0,.78); color:#ffeb3b; padding:3px 8px; border-radius:8px; box-shadow:0 0 10px rgba(255,235,59,.6); }
  .playmat.layout-fable .active-card .active-nrg-col,
  .playmat.layout-fable .bench-slot .bench-nrg{ display:none; }
  .playmat.layout-fable .tt-attach-overlay{ position:absolute; display:flex; flex-wrap:wrap; gap:2px; align-items:flex-end; justify-content:center; z-index:130; pointer-events:none; }
  .playmat.layout-fable .tt-attach-overlay:empty{ display:none; }
  .playmat.layout-fable .active-card .tt-attach-overlay{ left:4%; right:4%; bottom:14%; width:auto; }
  .playmat.layout-fable .bench-slot .tt-attach-overlay{ left:2%; right:2%; bottom:2px; z-index:202; }
  .playmat.layout-fable .tt-attach-overlay .nrg-pip{ min-width:clamp(16px, calc(var(--card-w) * 0.22), 24px); height:clamp(16px, calc(var(--card-w) * 0.22), 24px); font-size:clamp(.6rem, calc(var(--card-w) * 0.105), .85rem); padding:0 4px; border-radius:12px; }
  .playmat.layout-fable .tt-attach-overlay .tt-tool{ display:inline-flex; align-items:center; height:clamp(16px, calc(var(--card-w) * 0.22), 24px); font-size:clamp(.58rem, calc(var(--card-w) * 0.1), .8rem); padding:0 5px; border-radius:12px; font-weight:700; color:#fff; background:rgba(180,140,0,.92); box-shadow:0 0 0 1px rgba(0,0,0,.4) inset, 0 1px 2px rgba(0,0,0,.3); }
  .playmat.layout-fable .active-card .ability-btn{
    position:absolute; right:4%; top:54%; width:70%; margin:0; z-index:200;
    padding:.28rem .4rem; font-size:var(--badge-fs); font-weight:700;
    background:rgba(58, 26, 90, .92); color:#fff; border:1px solid #b070dd; border-radius:5px;
    cursor:pointer; text-align:center; box-shadow:0 2px 6px rgba(0,0,0,.7), 0 0 8px rgba(176,112,221,.5);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .playmat.layout-fable .active-card .ability-btn:hover{ background:#5a2a8a; }
  .playmat.layout-fable .active-card .evo-wrap{ position:absolute; right:4%; bottom:auto !important; top:calc(54% + clamp(26px, calc(var(--card-w) * 0.34), 34px)); width:70%; z-index:201; margin:0; }
  .playmat.layout-fable .active-card .evo-btn{ width:100% !important; font-size:var(--badge-fs) !important; padding:.28rem .4rem !important; font-weight:bold; }
  .playmat.layout-fable .zone-label-sm.opp-label{ display:none; }
  .playmat.layout-fable .zone-label-sm .zone-label-text{ display:none; }
  .playmat.layout-fable .my-active-zone > .zone-label-sm{ margin:0; padding:0; min-height:0; }
  .playmat.layout-fable .my-active-zone .btn-retreat:not(.btn-fossil-discard){ display:none; }
  .playmat.layout-fable .action-bar > .stadium-display{
    grid-area:stad; position:static; right:auto; top:auto; transform:none;
    align-self:center; justify-self:center; display:flex; flex-direction:column; align-items:center;
    width:calc(var(--card-w) * 1.04); height:auto; max-height:none; padding:.25rem .3rem; gap:.18rem;
    background:rgba(26,42,74,.6); border:1px solid #3a5a8a; border-radius:6px; cursor:pointer; overflow:hidden; z-index:5;
  }
  .playmat.layout-fable .action-bar > .stadium-display img{ width:calc(var(--card-w) * 0.86); height:auto; object-fit:contain; }
  .playmat.layout-fable .action-bar > .stadium-display .stadium-display-label{ font-size:clamp(.6rem, calc(var(--card-w) * 0.11), .78rem); }
  .playmat.layout-fable .action-bar > .stadium-display .stadium-display-name{ font-size:clamp(.62rem, calc(var(--card-w) * 0.115), .8rem); max-width:calc(var(--card-w) * 0.98); }
  /* v5.958 行動鈕固定槽位(Wilson:招式1/2、跳過攻擊、撤退 螢幕位置鎖死,不因狀態增減位移):
     flex 置中 → grid 固定 row 槽。row1-3=招式(槽3給技術機加招,平時留白兼分組距)、row4=跳過攻擊|結束回合
     (canEndTurn 與招式塊互斥,共槽)、row5=撤退|丟化石(互斥)、row6=場地、row7/8=悔棋類。鈕消失時固定
     track 仍在→其餘鈕零位移。Y 錨改固定 -97px(五槽+gap 半高,視覺≈原置中)。原 12px margin 分組距移除。 */
  .playmat.layout-fable .action-bar > .action-btns{
    grid-area:actions; position:absolute; left:50%; top:50%; transform:translate(-50%, -97px);
    display:grid; grid-template-rows:38px 38px 38px 34px 34px; grid-auto-rows:min-content;
    align-content:start; gap:3px; width:clamp(130px, 11vw, 168px); max-width:none;
  }
  /* ⚠⚠v6.237：招式鈕外面多包了一層 .atk-slot（見上方預估傷害的說明）⇒ 固定槽位的
     直接子選擇器必須跟著改到容器上，否則這三條會變成 unused，Fable 版面的招式鈕
     就不再鎖在 1/2/3 列（桌機**預設**就是 Fable 版，會直接看得出來）。
     ⚠ 這正是 svelte 編譯器的 unused-CSS 警告抓到的 —— 換 DOM 結構時務必回頭掃一次。 */
  .playmat.layout-fable .action-bar > .action-btns > .atk-slot:nth-of-type(1){ grid-row:1; }
  .playmat.layout-fable .action-bar > .action-btns > .atk-slot:nth-of-type(2){ grid-row:2; }
  .playmat.layout-fable .action-bar > .action-btns > .atk-slot:nth-of-type(3){ grid-row:3; }
  .playmat.layout-fable .action-bar > .action-btns > .btn-act.secondary,
  .playmat.layout-fable .action-bar > .action-btns > .btn-act.primary{ grid-row:4; }
  .playmat.layout-fable .action-bar > .action-btns > .btn-act.btn-retreat-mirror,
  .playmat.layout-fable .action-bar > .action-btns > .btn-act.btn-fossil-discard{ grid-row:5; }
  .playmat.layout-fable .action-bar > .action-btns > .btn-act.stadium-btn{ grid-row:6; }
  .playmat.layout-fable .action-bar > .action-btns > .btn-act.btn-undo,
  .playmat.layout-fable .action-bar > .action-btns > .btn-act.btn-undo-waiting{ grid-row:7; }
  .playmat.layout-fable .action-bar > .action-btns > .btn-act.btn-undo-cancel{ grid-row:8; }
  .playmat.layout-fable .action-bar > .action-btns > .waiting-msg{ grid-row:4; align-self:center; justify-self:center; text-align:center; }
  .playmat.layout-fable .action-bar > .alerts-col{ position:absolute; left:50%; top:8px; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:6px; max-width:min(560px, 62vw); z-index:230; pointer-events:none; }
  .playmat.layout-fable .action-bar > .alerts-col > *{ pointer-events:auto; box-shadow:0 6px 18px rgba(0,0,0,.55); animation:fableToastIn .18s ease-out; }
  @keyframes fableToastIn{ from{ opacity:0; transform:translateY(-8px); } to{ opacity:1; transform:translateY(0); } }
  .playmat.layout-fable .action-bar > .log-col{
    grid-area:log; position:static; width:auto; min-width:0; max-width:none;
    align-self:stretch; justify-self:stretch; height:auto; max-height:none; min-height:0;
    background:rgba(10, 26, 10, 0.92); border:1px solid #3a5a3a; border-radius:8px; padding:8px 6px;
    overflow-y:auto; box-shadow:0 4px 12px rgba(0,0,0,.4);
    display:flex; flex-direction:column-reverse; font-size:clamp(.68rem, .78vw, .8rem);
  }
  .playmat.layout-fable.log-collapsed .action-bar > .log-col{ display:none; }
  .playmat.layout-fable .log-toggle-btn{
    position:fixed; top:120px; right:calc(var(--log-w) + 16px);
    background:#1a2a1a; border:1px solid #5a8a5a; color:#aaffaa;
    padding:10px 8px; border-radius:4px 0 0 4px; cursor:pointer; z-index:60;
    display:flex; flex-direction:column; align-items:center; gap:2px; font-size:11px; font-weight:600;
    transition:right .2s, background .15s;
  }
  .playmat.layout-fable.log-collapsed .log-toggle-btn{ right:8px; }
  .playmat.layout-fable .log-toggle-btn:hover{ background:#2a4a2a; }
  .playmat.layout-fable .log-toggle-icon{ font-size:18px; line-height:1; }
  .playmat.layout-fable .log-toggle-arrow{ font-size:14px; color:#88ddaa; }
  /* v5.957 Fable 一頁鎖高：桌機(>=1024)鎖 battle-root=視窗高不捲動，playmat 吃滿 header 與手牌間剩餘高度。
     :has() 只在 fable 版存在時命中 → classic/tabletop/手機零影響；<1024 fallback 不鎖(照舊可捲)故包 media。 */
  @media (min-width: 1024px){
    .battle-root:has(.playmat.layout-fable){ height:100vh; height:100dvh; min-height:0; overflow:hidden; }
    .playmat.layout-fable{ min-height:0; overflow:hidden; }
  }
  .battle-root:has(.playmat.layout-fable) .hand-strip{ padding:0 .7rem 0; }
  .battle-root:has(.playmat.layout-fable) .hand-strip .hand-label{ margin-bottom:0; font-size:.65rem; }
  .battle-root:has(.playmat.layout-fable) .hand-strip .hand-scroll{ padding:0 1rem 0; min-height:120px; }
  @media (max-width: 1023px){
    .playmat.layout-fable{ --card-w-cap:9999px; display:grid !important; grid-template-columns:none; grid-template-rows:none; grid-template-areas:none; }
    .playmat.layout-fable > .field-row,
    .playmat.layout-fable > .action-bar{ display:flex !important; }
    .playmat.layout-fable > .field-row > *,
    .playmat.layout-fable > .action-bar > *{ grid-area:unset !important; grid-row:auto !important; grid-column:auto !important; }
    .playmat.layout-fable .opponent-row > .turn-order-chip,
    .playmat.layout-fable .my-row > .turn-order-chip{ position:static; }
    .playmat.layout-fable .action-bar > .alerts-col,
    .playmat.layout-fable .action-bar > .action-btns{ position:static; transform:none; }
    .playmat.layout-fable .action-bar > .action-btns{ display:flex; flex-direction:column; }
    .playmat.layout-fable .action-bar > .log-col{ width:auto; }
    .playmat.layout-fable .zone-bench{ display:flex !important; height:auto; min-height:0; max-height:none; }
    .playmat.layout-fable .log-toggle-btn{ display:none; }
    /* v6.223【B】fallback 補洞（實測 820×1180）：fable 基礎規則把 bench 槽設 width:auto →
       空槽在 fallback 的 flex 列塌成 ~8px 細條；log-col 浮在畫面中間蓋住場面。
       這裡同 specificity、檔內較後 → 蓋回固定槽寬與滿寬紀錄列。 */
    .playmat.layout-fable .zone-bench .bench-slot,
    .playmat.layout-fable .zone-bench .bench-empty,
    .playmat.layout-fable .zone-bench.bench-extended .bench-slot,
    .playmat.layout-fable .zone-bench.bench-extended .bench-empty{ flex:0 0 var(--card-w); width:var(--card-w); height:calc(var(--card-h) + 6px); }
    .playmat.layout-fable > .action-bar{ flex-wrap:wrap; }
    .playmat.layout-fable .action-bar > .log-col{ flex:1 1 100%; width:auto; max-height:220px; position:static; }
  }


  /* v6.086「兩張合一」競技場手牌裁半 —— 官方只有一張合併橫圖（767×536 ≈ 兩張直卡並排）。
     ⚠ v6.087 修：`.hand-card img` 只設 width、**沒設 height/aspect-ratio** → img 盒高度 auto
       ＝跟著圖片天然比例走，盒比例 == 圖比例時 `cover` 根本不會裁切、object-position 也就無效
       （Fable 5 審 v6.086 抓到，桌機主戰場整個沒生效）。補 aspect-ratio 讓盒子變回直卡比例。
     ⚠ 只加在 .legend-half-* 上，不動其他手牌卡。868/1212 = 官方直式卡圖比例。 */
  .hand-card img.legend-half-l,
  .hand-card img.legend-half-r,
  .replay-hand-img.legend-half-l,
  .replay-hand-img.legend-half-r { aspect-ratio: 868 / 1212; height: auto; object-fit: cover; }
  .hand-card img.legend-half-l, .replay-hand-img.legend-half-l { object-position: 0% 50%; }
  .hand-card img.legend-half-r, .replay-hand-img.legend-half-r { object-position: 100% 50%; }
</style>
