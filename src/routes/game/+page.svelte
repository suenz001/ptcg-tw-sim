<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fly, scale, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { base } from '$app/paths';
  import type { Card } from '$lib/cards/types';
  import { loadAllSets, buildCardIndex } from '$lib/cards/pool';
  import { loadDecks } from '$lib/decks/storage';
  import type { Deck } from '$lib/decks/types';
  import { PRESET_DECKS } from '$lib/decks/presets';
  import {
    createGame, applyAction,
    getAvailableAttacks, getEffectiveAttacks, hasPendingActions,
    countEnergy, getEvolvableTargets,
    canRetreat, getPlayableTrainers, getPlayableBasics, getPlayableFossils,
    getUsableAbilities, isBasicPokemonCard, isFossilItemCard, getEffectiveHP,
    totalEnergyUnits, getBenchLimit,
  } from '$lib/game/engine';
  import { GameActions } from '$lib/game/actions';
  import type { GameState, CardInstance } from '$lib/game/types';
  import { ATTACK_PRE_DISCARD_CHOICE, type PreDiscardSpec, PASSIVE_STADIUMS, getEnergyDiscardUnits } from '$lib/game/effects';
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';
  import type { EnergyType } from '$lib/cards/types';
  import { auth } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
  import {
    createRoom, joinRoom, subscribeRoom, pushGameState, subscribeOpenRooms,
    takeSeat, setSeatDeck, setSeatReady, startGame,
    findMySeatIdx, bothPlayersReady, countDeckCards,
    sendMessage, subscribeMessages,
    type Room, type Seat, type ChatMessage,
  } from '$lib/game/room';
  import { getAIAction } from '$lib/game/ai';
  import { VERSION } from '$lib/version';
  import { playSfx } from '$lib/audio/sfx';
  import { 
    loadAudioPrefs, saveVolume, saveMuted, isMuted as isAudioMuted, getMasterVolume as getAudioVolume,
    getBgmTrack, setBgmTrack, getBgmVolume, setBgmVolume
  } from '$lib/audio/settings';

  // ── 卡池 ────────────────────────────────────────────────────────────────────
  let pool = $state<Map<string, Card>>(new Map());
  let poolReady = $state(false);
  let decks = $state<Deck[]>([]);
  const allDecks = $derived([...PRESET_DECKS, ...decks]);

  // ── 遊戲狀態 ────────────────────────────────────────────────────────────────
  let game = $state<GameState | null>(null);

  // ── 模式：null=未選、local=本機、online=線上 ────────────────────────────────
  let mode = $state<'local' | 'online' | null>(null);

  // ── 本機 Lobby ───────────────────────────────────────────────────────────────
  let p1DeckId = $state('');
  let p2DeckId = $state('');
  let p1Name = $state('玩家 1');
  let p2Name = $state('AI 對手');
  /** AI 控制哪個玩家（null = 無 AI） */
  let aiPlayerIndex = $state<0 | 1 | null>(1);
  /** AI 是否正在思考（防止連擊） */
  let aiThinking = $state(false);
  let aiTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 線上模式狀態（v2.269 座位制重構） ──────────────────────────────────
  let myUid       = $state<string | null>(null);
  let myName      = $state('');
  let myDeckId    = $state('');           // 在房間內選牌組用
  let roomNameInput = $state('');         // 建房時的房間名稱
  /** 'choose' → 選建立/加入；'create' → 填資料建房間；'join' → 輸入房號；'room' → 房間等待中 */
  let onlineStep  = $state<'choose' | 'create' | 'join' | 'room'>('choose');
  let roomCode    = $state('');          // 建立或加入後得到的房號
  let joinInput   = $state('');          // 輸入框裡打的房號
  let amIHost     = $state(false);       // 是否為房主（用來顯示「關房」等按鈕）
  let roomData    = $state<Room | null>(null);
  let onlineLoading = $state(false);
  let onlineError   = $state('');
  let isSyncing     = $state(false);
  /** v2.269：從 roomData.seats 推導 — 0=P1, 1=P2, null=觀戰或未在房 */
  let myPlayerIndex = $state<0 | 1 | null>(null);
  /** v2.269：當前座位索引 (0..9)；觀戰位 ≥2 */
  let mySeatIdx = $state<number>(-1);
  let unsubRoom:    (() => void) | null = null;
  // 可加入的開放房間列表（onlineStep='join' 時即時訂閱）
  let openRooms = $state<Room[]>([]);
  let openRoomsErr = $state('');
  let unsubOpenRooms: (() => void) | null = null;
  // v2.272 Phase 2：聊天室
  let chatMessages = $state<ChatMessage[]>([]);
  let chatInput = $state('');
  let unsubMessages: (() => void) | null = null;
  let chatScrollEl: HTMLElement | null = $state(null);

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
  let preAttackDiscard = $state<{
    attackIndex: number;
    spec: PreDiscardSpec;
    attackName: string;
    picked: Set<string>;
  } | null>(null);

  // ── 手牌 hover 預覽（Session 31 修正） ─────────────────────────────────────
  // 不改原卡 transform — 避免邊界抖動、z-index 爭奪、擋住 drop target
  let hoverHandIid = $state<string | null>(null);
  let hoverHandAnchor = $state<{ x: number; y: number } | null>(null);

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
    coinFlipStage = 'flipping';
    coinFlipTimers.push(setTimeout(() => { coinFlipStage = 'revealing'; }, 2000));
    coinFlipTimers.push(setTimeout(() => { coinFlipStage = 'done'; }, 3800));
  });

  // ── 獎賞卡放置動畫 ─────────────────────────────────────────────────────────
  // 偵測雙方 prizes 從 0 → 6 的瞬間，觸發 stagger 動畫重播
  let prizeAnimKey = $state<[number, number]>([0, 0]);
  const prevPrizesLen: [number, number] = [0, 0];
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
    }
    if (changed) prizeAnimKey = next;
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
    if (logs.length <= animLogCursor) { animLogCursor = logs.length; return; }
    const fresh = logs.slice(animLogCursor);
    animLogCursor = logs.length;
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
  const DRAW_ANIM_DUR = 520;
  const DRAW_STAGGER  = 130;

  $effect(() => {
    if (!game) {
      prevHandIids[0] = new Set();
      prevHandIids[1] = new Set();
      return;
    }
    // 硬幣動畫還在播時：發牌畫面會被蓋住，不動；等 'done' 後再算 iid 差異
    if (coinFlipStage !== 'done') return;
    for (const pIdx of [0, 1] as const) {
      const curr = game.players[pIdx].hand;
      const currIids = new Set(curr.map(c => c.iid));
      const prev = prevHandIids[pIdx];
      const newIids: string[] = [];
      for (const inst of curr) if (!prev.has(inst.iid)) newIids.push(inst.iid);
      prevHandIids[pIdx] = currIids;
      if (newIids.length === 0) continue;
      // 先把新 iid 標記為 arriving（hand-card opacity:0）— 自己的手牌才有 DOM
      if ((pIdx as number) === myIdx) {
        const next = new Set(arrivingIids);
        for (const iid of newIids) next.add(iid);
        arrivingIids = next;
      }
      const capturedNew = newIids.slice();
      // 延遲到下一個 microtask 才量 DOM — 此時 hand 新卡已 render
      queueMicrotask(() => {
        const isMine = (pIdx as number) === myIdx;
        const deckEl = document.querySelector(
          isMine ? '.my-row .pile-slot.deck-pile' : '.opponent-row .pile-slot.deck-pile'
        ) as HTMLElement | null;
        if (!deckEl) return;
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
          const oppRowEl = document.querySelector('.opponent-row') as HTMLElement | null;
          const oppRect = oppRowEl?.getBoundingClientRect();
          endX = oppRect ? oppRect.left + oppRect.width / 2 : window.innerWidth / 2;
          endY = oppRect ? oppRect.top  + 30 : 60;
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
    for (const t of drawAnimTimers) clearTimeout(t);
  });

  // ── 硬幣動畫（Session 28；v2.252：升級為 queue 支援連續多次擲幣） ─────────
  // queue 機制：機關槍合擊、滾球、奔進 等「擲到反面前」類招式會連續擲多次硬幣，
  // 每次擲幣 log 一行（格式『… — 正面』/『… — 反面』），UI 解析後逐個 push 到
  // queue 排隊播放（每個 1.4s），玩家能完整看到每次擲幣結果。
  let coinFlip = $state<null | { result: 'heads' | 'tails'; label: string }>(null);
  let coinFlipQueue = $state<Array<{ result: 'heads' | 'tails'; label: string }>>([]);
  let coinTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLogProcessed = 0;
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
    coinTimer = setTimeout(processCoinQueue, COIN_FLIP_MS);
  }

  function enqueueCoinFlip(result: 'heads' | 'tails', label: string) {
    coinFlipQueue = [...coinFlipQueue, { result, label }];
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
    if (logs.length <= lastLogProcessed) { lastLogProcessed = logs.length; return; }
    const fresh = logs.slice(lastLogProcessed);
    lastLogProcessed = logs.length;
    for (const entry of fresh) {
      const msg = entry.message;
      // setup 先手特例（保留現有邏輯）
      if (msg.includes('擲硬幣') && msg.includes('先手')) {
        const winnerName = msg.replace(/^🪙?\s*擲硬幣：\s*/, '').replace(/\s*先手.*$/, '');
        enqueueCoinFlip(Math.random() < 0.5 ? 'heads' : 'tails', `${winnerName} 先手`);
        continue;
      }
      // v2.252 新格式：明確單次擲幣 — 「… — 正面」 / 「… — 反面」
      // 用全形破折號 — 結尾才視為「單次擲幣明確結果」，避免 heads=0 訊息中
      // 「擲到反面前正面 0 次」誤判（該訊息已被 v2.252 改寫成多筆單次 log，不會走到這）
      const single = msg.match(/—\s*(正面|反面)/);
      if (single) {
        enqueueCoinFlip(single[1] === '正面' ? 'heads' : 'tails', `擲硬幣：${single[1]}`);
        continue;
      }
      // fallback：舊招式總結 log（連斬/咬棄 等寫「擲 N 次硬幣正面 X 次」一次帶過）
      // 仍只觸發 1 次動畫，跟既有行為一致
      if (msg.includes('正面')) {
        enqueueCoinFlip('heads', '擲硬幣：正面');
        continue;
      }
      if (msg.includes('反面')) {
        enqueueCoinFlip('tails', '擲硬幣：反面');
        continue;
      }
    }
  });

  // ── 拖曳交互（v1.03 擴增 trainer 類） ─────────────────────────────────────
  type DragKind = 'energy' | 'basic' | 'fossil' | 'tool' | 'evolve' | 'trainer';
  let dragging = $state<null | {
    iid: string; kind: DragKind; cardId: string; cardName: string;
    imageUrl: string;
    x: number; y: number;        // 當前滑鼠位置
    startX: number; startY: number;
    moved: boolean;              // 是否超出門檻視為「拖曳」
  }>(null);
  let dropTargetIid = $state<string | null>(null); // 當前 hover 的 drop target iid（寶可夢）
  let dropBenchEmpty = $state(false);              // 當前 hover 的是否為空備戰格
  let dropActiveEmpty = $state(false);             // Setup 階段 hover 空戰鬥場
  const DRAG_THRESHOLD = 6; // px

  function startDrag(e: PointerEvent, inst: CardInstance, kind: DragKind, card: Card) {
    if (e.button !== 0) return;
    // 若 pointerdown 落在 button / 連結等互動元件，不啟動 drag —
    // 讓按鈕的 click 事件正常觸發（否則 pointer capture 會吃掉 click）
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;
    hoverHandIid = null; hoverHandAnchor = null;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    dragging = {
      iid: inst.iid, kind, cardId: inst.cardId, cardName: card.name,
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
        if (dragging.kind === 'basic' && hit) {
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

    if (d.kind === 'energy' && tIid) {
      await dispatch(GameActions.attachEnergy(d.iid, tIid));
    } else if (d.kind === 'basic') {
      // Setup 階段：無 active 拖到 active-empty → PLACE_ACTIVE；已有 active 拖到 bench-empty → BENCH_POKEMON
      // Playing 階段：只能拖到 bench-empty → PLAY_BASIC
      if (game?.phase === 'setup') {
        if (activeEmpty && !myPlayer?.active) {
          await dispatch(GameActions.placeActive(d.iid, myIdx));
        } else if (benchEmpty && myPlayer?.active) {
          await dispatch(GameActions.benchPokemon(d.iid, myIdx));
        }
      } else if (benchEmpty) {
        await dispatch(GameActions.playBasic(d.iid));
      }
    } else if (d.kind === 'fossil') {
      // v2.189 化石 Item 拖到備戰格：作為 HP60【無】基礎寶可夢上場
      if (benchEmpty) {
        await dispatch(GameActions.playFossil(d.iid));
      }
    } else if (d.kind === 'evolve' && tIid) {
      // 確認目標在合法進化清單裡
      if (evolveTargetsFor(d.iid).includes(tIid)) {
        await dispatch(GameActions.evolve(tIid, d.iid));
      }
    } else if (d.kind === 'trainer') {
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
    } else if (d.kind === 'tool' && tIid) {
      // 檢查目標是否已有道具（一隻只能附加一個，除非有特性）
      const allMy = [...(myPlayer?.active ? [myPlayer.active] : []), ...(myPlayer?.bench ?? [])];
      const target = allMy.find(p => p.iid === tIid);
      if (target?.toolAttached) {
        alert(`「${getCard(target.cardId)?.name ?? '該寶可夢'}」已附有道具，無法再附加（一隻寶可夢只能附加一個道具）。`);
        return;
      }
      // 打出道具 → 觸發 pendingSelection（attach-tool）→ 用 drop target 直接 resolve
      await dispatch(GameActions.playTrainer(d.iid));
      const sel = game?.pendingSelection;
      if (sel?.effectKey === 'attach-tool') {
        const validIids = (sel.params?.validIids as string[] | undefined) ?? [];
        if (validIids.includes(tIid)) {
          const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
          await dispatch(GameActions.resolveSelection([tIid], sid));
        }
      }
    }
  }

  // 對戰結束後匯出 log（.txt 給玩家肉眼復盤；.json 給外部工具分析）
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
        lines.push(`${who} ${text}`);
      }
      blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      filename = `ptcg-log-${stamp}.txt`;
    } else {
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
        log: game.log ?? [],
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
  function openFloatingEvo(fromIid: string, evoOpts: CardInstance[], e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    floatingEvoMenu = { fromIid, evoOpts, x: rect.left + rect.width / 2, y: rect.top };
  }
  function openFloatingRetreat(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    floatingRetreatMenu = { x: rect.left + rect.width / 2, y: rect.top };
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

  function tickAI() {
    if (!game || !poolReady || aiPlayerIndex === null) return;
    if (game.phase === 'game-over') return;

    // 判斷是否該 AI 行動
    const shouldAct = (() => {
      const ai = aiPlayerIndex;
      const g = game!;
      if (g.phase === 'setup') return !g.setupDone[ai] || (g.pendingMulliganDraw?.[ai] ?? 0) > 0;
      if (g.phase !== 'playing') return false;

      // 取獎勵牌或選擇 — 由誰的行動決定
      if (g.pendingPrizes > 0) return g.activePlayerIndex === ai;
      if (g.pendingSelection) return g.pendingSelection.actorIdx === ai;

      // v2.145：戰鬥寶可夢被擊倒（包含特性如腎上腺腦力 KO）→ 不論 turnPhase 都應立即遞補
      //   — 之前只在 turnPhase==='end' 觸發，對手回合內被特性 KO 時 AI 不會自動補，
      //     卡住玩家無法 END_TURN（因為 engine 端 END_TURN gate 要求對手 active 不為 null）。
      if (g.players[ai].active === null && g.players[ai].bench.length > 0) return true;

      // 正常輪到自己
      return g.activePlayerIndex === ai;
    })();

    if (!shouldAct) return;

    const action = getAIAction(game!, pool, aiPlayerIndex);
    if (!action) {
      // v2.131：AI 應該行動但 getAIAction 拿不到 action — 防呆：在主階段就強制 END_TURN
      //   避免 AI 卡住（曾發生於某 corner case：扭轉乾坤後 AI 沒下一步）。
      const g = game!;
      if (g.phase === 'playing'
          && g.activePlayerIndex === aiPlayerIndex
          && g.turnPhase === 'main'
          && !g.pendingSelection
          && (g.pendingPrizes ?? 0) === 0) {
        console.warn('[AI fallback] getAIAction returned null in main phase → forcing END_TURN');
        aiThinking = true;
        dispatch({ type: 'END_TURN' } as any);
        scheduleAI();
      }
      return;
    }

    aiThinking = true;
    dispatch(action as any);
    // 繼續排程下一步（直到 AI 不再需要行動）
    scheduleAI();
  }

  // 監聽 game 變化：若 AI 需要行動則排程
  $effect(() => {
    if (!game || aiPlayerIndex === null || mode === 'online') return;
    const g = game;
    const ai = aiPlayerIndex;
    if (g.phase === 'game-over') { aiThinking = false; return; }

    const shouldAct = (() => {
      if (g.phase === 'setup') return !g.setupDone[ai] || (g.pendingMulliganDraw?.[ai] ?? 0) > 0;
      if (g.phase !== 'playing') return false;
      if (g.pendingPrizes > 0) return g.activePlayerIndex === ai;
      if (g.pendingSelection) return g.pendingSelection.actorIdx === ai;
      // v2.145：active===null 不論 turnPhase 都立即遞補（特性 KO 對手後也要立刻動）
      if (g.players[ai].active === null && g.players[ai].bench.length > 0) return true;
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
  //   獎勵牌、補戰鬥位）」回合即結束，玩家不需手動按結束回合。
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

    // 線上：只有 activePlayerIndex 那側可自動觸發
    if (mode === 'online') {
      if (myPlayerIndex !== g.activePlayerIndex) return;
    }
    // AI 模式：AI 是當前活動玩家時讓 AI 迴圈處理
    if (aiPlayerIndex !== null && g.activePlayerIndex === aiPlayerIndex) return;

    // 延遲後若條件仍成立（沒被新 pending / KO / 取獎賞中斷）就 dispatch
    autoEndTimer = setTimeout(() => {
      autoEndTimer = null;
      if (!game) return;
      if (game.phase !== 'playing') return;
      if (game.turnPhase !== 'end') return;
      if (hasPendingActions(game)) return;
      if (mode === 'online' && myPlayerIndex !== game.activePlayerIndex) return;
      if (aiPlayerIndex !== null && game.activePlayerIndex === aiPlayerIndex) return;
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
  const pendingPrizes    = $derived(game?.pendingPrizes ?? 0);
  const pendingSelection = $derived(game?.pendingSelection ?? null);

  // v2.44：切換新 modal 時重置拖曳偏移量
  // 用 effectKey + actorIdx + type 做 signature，避免每次 game 狀態更新（物件新 ref）都誤重置
  const modalSignature = $derived(
    pendingSelection
      ? `${pendingSelection.type}|${pendingSelection.effectKey ?? ''}|${pendingSelection.actorIdx}`
      : floatingRetreatMenu
        ? 'retreat-menu'
        : 'none'
  );
  $effect(() => {
    const _sig = modalSignature;
    modalOffset = { x: 0, y: 0 };
    modalDragged = false;
    modalDragStart = null;
    // v2.164：reorder-deck-top 切到新 pending 時，從 candidateIids 初始化 keep 列表（保持原順序）
    if (pendingSelection?.type === 'reorder-deck-top') {
      const cand = (pendingSelection.params?.candidateIids as string[] | undefined) ?? [];
      selectionReorderKeep = [...cand];
      selectionReorderDiscard = new Set();
    }
    // v2.201：modal-choice stepper 切到新 pending 時，從 params.stepper.init 初始化數值
    if (pendingSelection?.type === 'modal-choice') {
      const stepper = pendingSelection.params?.stepper as { min: number; max: number; step: number; init: number } | undefined;
      if (stepper) {
        selectionStepperValue = stepper.init;
      }
    }
  });
  const evolvableTargets = $derived(game && poolReady ? getEvolvableTargets(game, pool) : []);
  const canRetreatNow    = $derived(game && poolReady ? canRetreat(game, pool) : false);
  const playableTrainerIids = $derived(
    game && poolReady ? new Set(getPlayableTrainers(game, pool)) : new Set<string>()
  );
  const playableBasicIids = $derived(
    game && poolReady ? new Set(getPlayableBasics(game, pool)) : new Set<string>()
  );
  // v2.189：化石 Item 可作為基礎寶可夢上場（走 PLAY_FOSSIL action）
  const playableFossilIids = $derived(
    game && poolReady ? new Set(getPlayableFossils(game, pool)) : new Set<string>()
  );
  // 手牌中「可進化」的卡（其場上有合法基底）
  const playableEvoIids = $derived(
    new Set<string>(evolvableTargets.flatMap(e => e.toIids))
  );
  const canEndTurn = $derived(
    game?.phase === 'playing' && game.turnPhase === 'end' && !hasPendingActions(game)
  );
  const usableAbilities = $derived(game && poolReady ? getUsableAbilities(game, pool) : []);
  const stadiumCard = $derived(game?.activeStadium ? pool.get(game.activeStadium.cardId) : null);

  // ── 視角固定：AI模式/線上模式我方永遠在下方，本機雙人模式隨行動方翻轉 ──────
  // 注意：線上模式必須優先判斷，否則預設 aiPlayerIndex=1 會讓雙方都算成 myIdx=0
  // Setup 階段本機雙人：翻到尚未完成 setup 的那一方
  const myIdx   = $derived<0 | 1>(
    mode === 'online' ? ((myPlayerIndex ?? 0) as 0 | 1) :
    aiPlayerIndex !== null ? ((1 - aiPlayerIndex) as 0 | 1) :
    (game?.phase === 'setup' && myPlayerIndex === null
      // 本機雙人 setup：優先處理 mulligan 補抽，再看 setup 完成狀態
      ? (((game.pendingMulliganDraw?.[0] ?? 0) > 0
          ? 0
          : (game.pendingMulliganDraw?.[1] ?? 0) > 0
            ? 1
            : (game.setupDone[0] ? 1 : 0)) as 0 | 1)
      : (myPlayerIndex !== null ? myPlayerIndex : aIdx))
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
    !(stadiumCard && PASSIVE_STADIUMS.has(stadiumCard.name))
  );

  // 線上模式 / AI 模式：是否輪到玩家行動
  const isMyTurn = $derived(() => {
    if (!game) return false;
    // 線上模式：只有輪到 myPlayerIndex 才能行動（必須優先於 AI 判斷）
    if (mode === 'online') {
      if (myPlayerIndex === null) return false;
      if (game.phase === 'setup') return !game.setupDone[myPlayerIndex];
      if (game.pendingSelection) return game.pendingSelection.actorIdx === myPlayerIndex;
      if (game.turnPhase === 'end' && game.players[myPlayerIndex].active === null) return true;
      return game.activePlayerIndex === myPlayerIndex;
    }
    // AI 模式：只有輪到人類時才能手動操作
    if (aiPlayerIndex !== null) {
      const hIdx = (1 - aiPlayerIndex) as 0 | 1;
      if (game.phase === 'setup') return !game.setupDone[hIdx];
      if (game.pendingSelection) return game.pendingSelection.actorIdx === hIdx;
      if (game.turnPhase === 'end' && game.players[hIdx].active === null) return true;
      // 取獎勵由 activePlayerIndex 決定 — 我 KO 對方後換我取獎勵，UI 須允許取
      if (game.pendingPrizes > 0) return game.activePlayerIndex === hIdx;
      return game.activePlayerIndex === hIdx;
    }
    return true; // 本機雙人模式
  });
  // 線上模式：我是否為防守方（被擊倒後需送出寶可夢）
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

  const selectionItems = $derived.by(() => {
    if (!pendingSelection || !game) return [] as CardInstance[];
    const src = game.players[pendingSelection.sourcePlayerIdx];
    switch (pendingSelection.type) {
      case 'deck-search': {
        const f = pendingSelection.filter ?? '';
        if (f === 'TOP6') {
          const top6 = new Set<string>((pendingSelection.params?.top6Iids as string[]) ?? []);
          return src.deck.filter(c => top6.has(c.iid));
        }
        if (f === 'TOP8') {
          const top8 = new Set<string>((pendingSelection.params?.top8Iids as string[]) ?? []);
          return src.deck.filter(c => top8.has(c.iid));
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
        // v2.209 配樂之笛：對手牌庫頂 5 張中的基礎寶可夢
        if (f === 'Basic:TOP5') {
          const top5 = new Set<string>((pendingSelection.params?.top5Iids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!top5.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            return !!card && card.supertype === 'Pokemon' && !card.evolvesFrom;
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
        // v2.55 捕蟲組合：牌庫頂 7 張中的基本【草】寶可夢 or 基本【草】能量
        if (f === 'GrassBasicOrGrassEnergy:TOP7') {
          const top7 = new Set<string>((pendingSelection.params?.top7Iids as string[]) ?? []);
          return src.deck.filter(c => {
            if (!top7.has(c.iid)) return false;
            const card = pool.get(c.cardId);
            if (!card) return false;
            if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Grass') return true;
            if (card.supertype === 'Energy' && card.subtype === 'Basic') {
              if (card.pokemonType === 'Grass') return true;
              if (card.name.includes('【草】')) return true;
            }
            return false;
          });
        }
        return src.deck.filter(c => {
          const card = pool.get(c.cardId);
          if (!card) return false;
          if (f === 'Basic')      return isBasicPokemonCard(card);
          if (f === 'Basic:HP70') return isBasicPokemonCard(card) && (card.hp ?? 0) <= 70;
          // v2.171 深缽鎮：基礎寶可夢且非「擁有規則」（排除 ex / V 等）
          if (f === 'BasicNonRule') {
            if (!isBasicPokemonCard(card)) return false;
            const isRule = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX')
              || !!card.rulesText?.includes('擁有規則');
            return !isRule;
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
          // v2.159：寶可夢且名字含對手場上某寶可夢同名（甜蜜球）— params.matchOppNames 提供
          if (f === 'Pokemon:MatchOppName') {
            const names = (pendingSelection?.params?.matchOppNames as string[]) ?? [];
            if (names.length === 0) return false;
            return card.supertype === 'Pokemon' && names.includes(card.name);
          }
          // v2.132：用 stage 欄位（含 ex 進化），不靠 subtype — ex 寶可夢 subtype='ex' 會被排除
          if (f === 'Stage1')     return card.supertype === 'Pokemon' && (card.stage ?? card.subtype) === 'Stage1';
          if (f === 'Stage2')     return card.supertype === 'Pokemon' && (card.stage ?? card.subtype) === 'Stage2';
          if (f === 'Evolution')  return card.supertype === 'Pokemon' && !!card.evolvesFrom;
          if (f === 'PsychicBasic') return card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Psychic';
          if (f === 'Pokemon')    return card.supertype === 'Pokemon';
          if (f === 'Energy')     return card.supertype === 'Energy';
          if (f === 'BasicEnergy') return card.supertype === 'Energy' && card.subtype === 'Basic';
          // v2.162：基本能量但已選的屬性要排除（伊布｜鮮豔捕捉）
          //   filter 由 selectionItems 計算，但 deck 本身的「已選 picked set」會在 toggle 時改變 →
          //   selectionItems 是 $derived，會自動 re-run 並重新過濾。
          if (f === 'BasicEnergy:DistinctTypes') {
            if (!(card.supertype === 'Energy' && card.subtype === 'Basic')) return false;
            // 已選的能量屬性（不含本張）
            const pickedTypes = new Set<string>();
            for (const d of src.deck) {
              if (d.iid === c.iid) continue; // 自己不算入「已選」
              if (selectionPicked.has(d.iid)) {
                const pc = pool.get(d.cardId);
                if (pc?.pokemonType) pickedTypes.add(pc.pokemonType);
              }
            }
            // 本張屬性必須不在已選 set 內（pokemonType 必有，因為基本能量都有）
            if (!card.pokemonType) return false;
            return !pickedTypes.has(card.pokemonType);
          }
          if (f === 'ex')         return card.supertype === 'Pokemon' && card.subtype === 'ex';
          if (f === 'MegaEx')     return card.supertype === 'Pokemon' && card.subtype === 'ex' && card.name.startsWith('超級');
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
          if (f === 'FightingBasicOrFightingEnergy') {
            // 基本【鬥】寶可夢：pokemonType === 'Fighting' 且為基礎
            if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Fighting') return true;
            // 基本【鬥】能量：pokemonType 有時缺漏（MC 集能量卡），所以名字含【鬥】/【格】也算
            if (card.supertype === 'Energy' && card.subtype === 'Basic') {
              if (card.pokemonType === 'Fighting') return true;
              if (card.name.includes('【鬥】') || card.name.includes('【格】')) return true;
            }
            return false;
          }
          if (f === 'PokemonNonRule') {
            if (card.supertype !== 'Pokemon') return false;
            const isRule = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX');
            return !isRule;
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
            // 捕蟲組合：基本【草】寶可夢 or 基本【草】能量
            if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Grass') return true;
            if (card.supertype === 'Energy' && card.subtype === 'Basic') {
              if (card.pokemonType === 'Grass') return true;
              if (card.name.includes('【草】')) return true;
            }
            return false;
          }
          // v2.135：阿響的冒險
          if (f === 'RakiPokemonOrFireEnergy') {
            if (card.supertype === 'Pokemon' && card.name.startsWith('阿響的')) return true;
            if (card.supertype === 'Energy' && card.subtype === 'Basic') {
              if (card.pokemonType === 'Fire' || card.name.includes('【火】')) return true;
            }
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
          // v2.225 旋轉洛托姆｜風扇呼喚：HP≤100 的【無】屬性寶可夢卡
          //   （之前 filter 漏在 deck-search chain，導致 fallback `return true` →
          //    整副牌庫都能選。Leon v2.224 後反映 UI 顯示「任選 3 張牌」。）
          if (f === 'ColorlessPokeHP100') {
            return card.supertype === 'Pokemon' && card.pokemonType === 'Colorless' && (card.hp ?? 999) <= 100;
          }
          return true;
        });
      }
      case 'bench-choose': {
        const validIids4 = pendingSelection.params?.validIids as string[] | undefined;
        return validIids4 ? src.bench.filter(c => validIids4.includes(c.iid)) : src.bench;
      }
      case 'opp-poke-choose': {
        const items: CardInstance[] = [...src.bench];
        if (src.active) items.unshift(src.active);
        const validIidsOpp = pendingSelection.params?.validIids as string[] | undefined;
        return validIidsOpp ? items.filter(c => validIidsOpp.includes(c.iid)) : items;
      }
      case 'opp-bench-choose': {
        const includeActive = pendingSelection.params?.includeActive === true;
        const base = includeActive && src.active ? [src.active, ...src.bench] : src.bench;
        const validIidsOppB = pendingSelection.params?.validIids as string[] | undefined;
        return validIidsOppB ? base.filter(c => validIidsOppB.includes(c.iid)) : base;
      }
      case 'damage-distribute': {
        // 傷害指示物自由分配（幻影奇襲）— 預設只能選對手備戰；
        // 若效果允許 includeActive，則把對手戰鬥寶可夢也納入。
        const includeActiveDD = pendingSelection.params?.includeActive === true;
        if (includeActiveDD && src.active) return [src.active, ...src.bench];
        return src.bench;
      }
      case 'hand-discard': {
        const f2 = pendingSelection.filter ?? '';
        const validIidsHD = pendingSelection.params?.validIids as string[] | undefined;
        let pool0 = src.hand;
        if (validIidsHD) pool0 = pool0.filter(c => validIidsHD.includes(c.iid));
        if (f2 === 'Energy') return pool0.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
        if (f2 === 'BasicEnergy') return pool0.filter(c => {
          const card = pool.get(c.cardId);
          return card?.supertype === 'Energy' && card.subtype === 'Basic';
        });
        // v2.40 月光丘陵：只基本【超】能量（排除感應【超】等 Special Energy）
        if (f2 === 'BasicPsychicEnergy') return pool0.filter(c => {
          const card = pool.get(c.cardId);
          return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【超】');
        });
        // v2.89 波動突刺：只基本【鬥】能量（排除硬岩【鬥】等 Special Energy）
        if (f2 === 'BasicFightingEnergy') return pool0.filter(c => {
          const card = pool.get(c.cardId);
          return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【鬥】');
        });
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
      case 'active-energy-discard': {
        return src.active?.energyAttached ?? [];
      }
      case 'heal-target':  {
        const all = [...(src.active ? [src.active] : []), ...src.bench];
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
          // v2.40 修正：原本這裡寫 supertype === 'Energy'（= 所有能量）是 bug，
          // 會讓能量回收器 / 能量回收 等卡從棄牌區撿到富裕能量等 Special Energy。
          // 正確語義：BasicEnergy = supertype=Energy && subtype=Basic（與 deck-search/hand-discard 一致）
          if (f === 'BasicEnergy')     return card.supertype === 'Energy' && card.subtype === 'Basic';
          if (f === 'BasicPsychicEnergy') {
            // 奇跡修正檔 / 月光丘陵：只基本【超】能量。排除富裕能量/感應【超】等 Special Energy。
            return card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【超】');
          }
          if (f === 'BasicFightingEnergy') {
            // v2.89 波動突刺：只基本【鬥】能量。排除硬岩【鬥】等 Special Energy。
            return card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【鬥】');
          }
          if (f === 'FightingPokemonOrBasicFightingEnergy') {
            // v2.117 塔拉剛：【鬥】寶可夢 或 基本【鬥】能量
            if (card.supertype === 'Pokemon' && card.pokemonType === 'Fighting') return true;
            if (card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【鬥】')) return true;
            return false;
          }
          if (f === 'Pokemon')         return card.supertype === 'Pokemon';
          if (f === 'Trainer')         return card.supertype === 'Trainer';
          if (f === 'Supporter')       return card.supertype === 'Trainer' && card.subtype === 'Supporter';
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
  // damage-distribute 本批次加總的 counter 數（= 各 iid 的 count 之和）
  const selectionBatchSum = $derived.by(() => {
    let s = 0;
    for (const n of Object.values(selectionCounts)) s += n;
    return s;
  });
  const selectionValid = $derived.by(() => {
    if (!pendingSelection) return false;
    if (akamatsuSameTypeBlocked) return false;
    if (pendingSelection.type === 'damage-distribute') {
      const n = selectionBatchSum;
      return n >= pendingSelection.minCount && n <= pendingSelection.maxCount;
    }
    // v2.164 reorder-deck-top：用保留的 keep 列表長度當判定
    if (pendingSelection.type === 'reorder-deck-top') {
      const n = selectionReorderKeep.length;
      return n >= pendingSelection.minCount && n <= pendingSelection.maxCount;
    }
    // v2.69：撤退能量選擇用「能量單位」判定（火箭隊能量 1 張 = 2 units）
    // 而非張數；要求選中能量單位總和 ≥ retreatCost。
    // v2.108：傳 state+actorIdx 讓大竺葵繁茂套上（基本【草】能量 = 2 units）。
    if (pendingSelection.type === 'active-energy-discard'
        && pendingSelection.effectKey === 'retreat-energy-discard') {
      const retreatCost = (pendingSelection.params?.retreatCost as number | undefined) ?? 0;
      if (selectionPicked.size === 0) return false;
      const pickedInsts = selectionItems.filter(it => selectionPicked.has(it.iid));
      return totalEnergyUnits(pickedInsts, pool, game, pendingSelection.actorIdx as 0 | 1) >= retreatCost;
    }
    return selectionPicked.size >= pendingSelection.minCount
        && selectionPicked.size <= pendingSelection.maxCount;
  });

  // ── 音效與音樂設定（v2.118 + BGM）────────────────────────────────────────
  let showSettingsModal = $state(false);
  let audioVolume = $state(0.5);
  let audioMuted = $state(false);
  let bgmTrack = $state('none');
  let bgmVolume = $state(0.5);
  let bgmAudioEl: HTMLAudioElement | null = $state(null);

  function onVolumeChange(v: number) {
    audioVolume = v;
    saveVolume(v);
  }
  function onMuteToggle() {
    audioMuted = !audioMuted;
    saveMuted(audioMuted);
  }
  function onBgmTrackChange(track: string) {
    bgmTrack = track;
    setBgmTrack(track);
  }
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
    bgmTrack = getBgmTrack();
    bgmVolume = getBgmVolume();
    // 匿名登入（線上對戰需要）
    onAuthStateChanged(auth, u => { myUid = u?.uid ?? null; });
    if (!auth.currentUser) await signInAnonymously(auth);

    const allCards = await loadAllSets();
    pool = buildCardIndex(allCards);
    poolReady = true;

    // 如果 host 在 poolReady 前就收到了 ready 狀態，現在補建遊戲
    checkAndStartOnlineGame();
  });

  onDestroy(() => {
    unsubRoom?.();
    unsubOpenRooms?.();
    if (aiTimer !== null) clearTimeout(aiTimer);
  });

  // 在線上 Lobby 的 join 步驟訂閱開放房間列表
  $effect(() => {
    if (onlineStep === 'join' && myUid) {
      unsubOpenRooms?.();
      openRoomsErr = '';
      unsubOpenRooms = subscribeOpenRooms(
        rooms => { openRooms = rooms; openRoomsErr = ''; },
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
    const card = getCard(inst.cardId);
    let cost = card?.retreatCost?.length ?? 0;
    const tool = inst.toolAttached ? getCard(inst.toolAttached.cardId) : null;
    if (tool?.name === '氣球') cost = Math.max(0, cost - 2);
    // v2.96：天空徑線（拉帝亞斯ex）— 自己場上有拉帝亞斯ex 時基礎寶可夢撤退 0
    // 鏡射 engine canRetreat 的 hook；UI 按鈕顯示「撤退（0⚡）」
    if (cost > 0 && card && !card.evolvesFrom && card.subtype !== 'Stage1' && card.subtype !== 'Stage2' && myPlayer) {
      const allMy = [...(myPlayer.active ? [myPlayer.active] : []), ...myPlayer.bench];
      const hasSkyPath = allMy.some(c => getCard(c.cardId)?.abilities?.some(a => a.name === '天空徑線'));
      if (hasSkyPath) cost = 0;
    }
    // v2.117 N的城堡（Stadium）— 雙方場上所有「N的」寶可夢撤退 0
    if (cost > 0 && card?.name?.startsWith('N的') && game?.activeStadium) {
      const stadiumName = getCard(game.activeStadium.cardId)?.name;
      if (stadiumName === 'N的城堡') cost = 0;
    }
    return cost;
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
  async function dispatch(action: ReturnType<typeof GameActions[keyof typeof GameActions]>) {
    if (!game || !poolReady) return;
    const prevState = game;
    const newState = applyAction(game, action as any, pool);
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
    game = newState;
    floatingEvoMenu = null; floatingRetreatMenu = null; selectedEnergyIid = null;

    // 視覺回饋
    if (action.type === 'ATTACH_ENERGY') triggerEnergyPulse(action.targetIid);

    // v2.118 音效：action-based（state-diff 類在 $effect 觸發）
    if (newState !== prevState) {
      dispatchSfxForAction(action, prevState, newState);
    }

    if (mode === 'online' && roomCode) {
      isSyncing = true;
      try { await pushGameState(roomCode, newState); }
      catch (e) { console.error('[Online] push failed:', e); }
      finally { isSyncing = false; }
    }
  }

  // ── 招式宣告：若需要丟能量選擇則開 modal，否則直接派送 ─────────────────────
  // v2.214：用 getEffectiveAttacks 取招式（含工具上寫的招式 — 招式學習器 螢石 等）
  //   - tool 招式的 effectKey 用 tool 名做 key（與 engine 一致）
  function initiateAttack(attackIndex: number) {
    if (!game || !activePlayer?.active) return;
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
    const key = `${sourceCardName}|${atk.name}`;
    const spec = ATTACK_PRE_DISCARD_CHOICE.get(key);
    if (!spec) {
      dispatch(GameActions.attack(attackIndex));
      return;
    }
    preAttackDiscard = {
      attackIndex,
      spec,
      attackName: atk.name,
      picked: new Set<string>(),
    };
  }

  // v2.119 copy-attack picker（目前僅用於 N的索羅亞克ex｜暗黑底牌）
  let copyAttackPicker = $state<{
    sourceAttackIndex: number;
    candidates: Array<{ inst: CardInstance; card: Card | undefined }>;
  } | null>(null);
  function resolveCopyAttack(pokeIid: string, attackIndex: number) {
    if (!copyAttackPicker) return;
    const src = copyAttackPicker.sourceAttackIndex;
    copyAttackPicker = null;
    dispatch(GameActions.attack(src, undefined, { pokeIid, attackIndex }));
  }
  function cancelCopyAttack() { copyAttackPicker = null; }

  // 取得「可被挑選丟棄」的卡片清單（依 scope 決定範圍）
  // v2.143 擴展：scope='hand-rocket-supporter' 時返回手牌中「火箭隊」支援者
  //   返回項目仍用 hostInst 結構但 hostInst = activePlayer.active（佔位，UI 不會顯示來源）
  //   ownerName 顯示卡名（讓玩家看清楚要丟哪張）
  function getDiscardableEnergies(spec: PreDiscardSpec): Array<{ iid: string; cardId: string; ownerIid: string; ownerName: string; hostInst: CardInstance }> {
    if (!game || !activePlayer) return [];
    const out: Array<{ iid: string; cardId: string; ownerIid: string; ownerName: string; hostInst: CardInstance }> = [];
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
      if (picked.has(e.iid)) n += getEnergyDiscardUnits(e.cardId, e.hostInst, pool);
    }
    return n;
  }

  function togglePreAttackEnergy(iid: string) {
    if (!preAttackDiscard) return;
    const picked = new Set(preAttackDiscard.picked);
    if (picked.has(iid)) {
      picked.delete(iid);
    } else {
      const { max, countMode } = preAttackDiscard.spec;
      if (max !== null) {
        if (countMode === 'units') {
          // 預估若加入這張會否超過 max units
          const energies = getDiscardableEnergies(preAttackDiscard.spec);
          const target = energies.find(e => e.iid === iid);
          const addUnits = target ? getEnergyDiscardUnits(target.cardId, target.hostInst, pool) : 1;
          const cur = computePickedAmount(preAttackDiscard.spec, picked, energies);
          if (cur + addUnits > max) return;
        } else if (picked.size >= max) {
          return;
        }
      }
      picked.add(iid);
    }
    preAttackDiscard = { ...preAttackDiscard, picked };
  }

  function confirmPreAttackDiscard() {
    if (!preAttackDiscard) return;
    const { attackIndex, spec, picked } = preAttackDiscard;
    const energies = getDiscardableEnergies(spec);
    const amount = computePickedAmount(spec, picked, energies);
    if (amount < spec.min) return;
    if (spec.max !== null && amount > spec.max) return;
    const iids = [...picked];
    preAttackDiscard = null;
    dispatch(GameActions.attack(attackIndex, iids));
  }

  function cancelPreAttackDiscard() {
    preAttackDiscard = null;
  }

  // ── 本機 Lobby ───────────────────────────────────────────────────────────────
  function startLocalGame() {
    if (!p1DeckId || !p2DeckId) return;
    const d1 = allDecks.find(d => d.id === p1DeckId);
    const d2 = allDecks.find(d => d.id === p2DeckId);
    if (!d1 || !d2) return;
    aiThinking = false;
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    game = createGame(
      { name: p1Name || d1.name, entries: d1.entries },
      { name: aiPlayerIndex === 1 ? '🤖 ' + (p2Name || d2.name) : (p2Name || d2.name), entries: d2.entries },
      pool
    );
  }

  // ── 線上 Lobby（v2.269 座位制重構） ────────────────────────────────────
  async function handleCreateRoom() {
    if (!myName.trim()) { onlineError = '請輸入玩家名稱'; return; }
    if (!roomNameInput.trim()) { onlineError = '請輸入房間名稱'; return; }
    onlineLoading = true; onlineError = '';
    try {
      roomCode = await createRoom(roomNameInput.trim(), myName.trim());
      amIHost = true;
      onlineStep = 'room';
      startRoomSubscription();
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
    } catch(e: any) { onlineError = e.message ?? '加入房間失敗'; }
    finally { onlineLoading = false; }
  }

  function startRoomSubscription() {
    unsubRoom?.();
    unsubRoom = subscribeRoom(roomCode, handleRoomUpdate);
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

  function handleRoomUpdate(room: Room | null) {
    if (!room) { onlineError = '房間不存在或連線中斷'; return; }
    roomData = room;

    // 從 seats 推導我的座位
    const idx = findMySeatIdx(room.seats, myUid);
    mySeatIdx = idx;
    myPlayerIndex = (idx === 0) ? 0 : (idx === 1) ? 1 : null;

    // 兩邊收到 gameState → 更新畫面
    if (room.gameState) {
      game = room.gameState;
      return;
    }

    // 雙方 P1/P2 都 ready → 由坐 P1 的 client 觸發 startGame
    if (room.status === 'lobby' && bothPlayersReady(room.seats) && idx === 0 && poolReady) {
      checkAndStartOnlineGame();
    }
  }

  function checkAndStartOnlineGame() {
    if (!poolReady || !roomData) return;
    if (roomData.status !== 'lobby' || roomData.gameState) return;
    const p1 = roomData.seats[0], p2 = roomData.seats[1];
    if (!p1.uid || !p2.uid || !p1.deckEntries || !p2.deckEntries) return;
    if (!p1.ready || !p2.ready) return;

    const newGame = createGame(
      { name: p1.name ?? 'P1', entries: p1.deckEntries },
      { name: p2.name ?? 'P2', entries: p2.deckEntries },
      pool
    );
    game = newGame;
    startGame(roomCode, newGame).catch(console.error);
  }

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
  // v2.270：select onchange 自動套用，省去「套用牌組」按鈕
  async function handleDeckChange(e: Event) {
    const t = e.target as HTMLSelectElement;
    myDeckId = t.value;
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

  function leaveOnlineGame() {
    unsubRoom?.(); unsubRoom = null;
    unsubMessages?.(); unsubMessages = null;
    chatMessages = []; chatInput = '';
    game = null; roomCode = ''; roomData = null;
    onlineStep = 'choose'; onlineError = ''; myPlayerIndex = null; mySeatIdx = -1;
    roomNameInput = ''; myDeckId = '';
    mode = null;
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
  function fmtChatTime(ts: { seconds?: number } | null | undefined): string {
    if (!ts?.seconds) return '';
    const d = new Date(ts.seconds * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ── 選擇互動 ─────────────────────────────────────────────────────────────────
  function onAttachEnergy(targetIid: string) {
    if (!selectedEnergyIid) return;
    dispatch(GameActions.attachEnergy(selectedEnergyIid, targetIid));
  }
  function toggleSelection(iid: string) {
    const next = new Set(selectionPicked);
    if (next.has(iid)) { next.delete(iid); }
    else if (pendingSelection && next.size < pendingSelection.maxCount) { next.add(iid); }
    selectionPicked = next;
  }
  // damage-distribute：點擊目標 +1 counter；達到 maxCount 後不再加
  function incrementCount(iid: string) {
    if (!pendingSelection || pendingSelection.type !== 'damage-distribute') return;
    if (selectionBatchSum >= pendingSelection.maxCount) return;
    selectionCounts = { ...selectionCounts, [iid]: (selectionCounts[iid] ?? 0) + 1 };
  }
  function decrementCount(iid: string) {
    const cur = selectionCounts[iid] ?? 0;
    if (cur <= 0) return;
    const next = { ...selectionCounts };
    if (cur - 1 <= 0) delete next[iid]; else next[iid] = cur - 1;
    selectionCounts = next;
  }
  function confirmSelection() {
    if (!selectionValid) return;
    // 線上模式帶 senderIdx 避免對手搶先 resolve
    const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
    let payload: string[];
    if (pendingSelection?.type === 'damage-distribute') {
      // 展開計數器為扁平陣列：{A:2, B:1} → [A,A,B]（resolver 以 iid 出現次數計數）
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
    dispatch(GameActions.resolveSelection(payload, sid));
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

  // v2.121 全域安全網：當 pending 的候選列表為空（例：搜卡但牌庫/棄牌/手牌無符合條件的卡）
  // 允許玩家「放棄」以空 selection 前進，避免卡死。resolver 收到空 iids 應能 graceful 結束。
  function abandonSelection() {
    const sid = mode === 'online' && myPlayerIndex !== null ? myPlayerIndex : undefined;
    dispatch(GameActions.resolveSelection([], sid));
    selectionPicked = new Set();
    selectionCounts = {};
  }
  // 判定：這個 pending 的候選是否為空且 minCount>0（玩家會被卡住 → 需要放棄按鈕）。
  // damage-distribute 用 counts 不用 picked，排除。
  const pendingStuckEmpty = $derived.by(() => {
    if (!pendingSelection) return false;
    if (pendingSelection.type === 'damage-distribute') return false;
    if (pendingSelection.minCount <= 0) return false;
    return selectionItems.length === 0;
  });
  // v2.121：判斷一張卡是否為指定屬性的基本能量。
  // 很多基本能量卡 JSON 的 pokemonType 欄位為 undefined（scraper 沒填），只能從卡名【X】解析。
  // 統一 helper 供所有 filter 'Energy:<Type>' 用。
  const ZH_BY_TYPE: Record<EnergyType, string> = {
    Grass: '草', Fire: '火', Water: '水', Lightning: '雷',
    Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼',
    Dragon: '龍', Colorless: '無',
  };
  function isBasicEnergyOfType(card: Card | undefined, type: EnergyType): boolean {
    if (!card) return false;
    if (card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
    if (card.pokemonType === type) return true;
    const zh = ZH_BY_TYPE[type];
    return zh ? card.name.includes(`【${zh}】`) : false;
  }

  function selectionTitle(type: string): string {
    // 支援效果層透過 params.titleOverride 客製標題（例：赤松要「選寶可夢附加能量」而非預設「回復」）
    const override = pendingSelection?.params?.titleOverride;
    if (typeof override === 'string' && override.length > 0) return override;
    if (type === 'deck-search')     return '從牌庫選擇';
    if (type === 'bench-choose')    return '選擇備戰寶可夢';
    if (type === 'opp-bench-choose') return '選擇對手的備戰寶可夢';
    if (type === 'opp-poke-choose') return '選擇對手的寶可夢';
    if (type === 'hand-discard')    return '選擇丟棄的手牌';
    if (type === 'hand-choose')     return '從手牌選擇';
    if (type === 'active-energy-discard') return '選擇撤退要丟棄的能量';
    if (type === 'heal-target')     return '選擇回復的寶可夢';
    if (type === 'discard-search')  return '從棄牌區選擇';
    if (type === 'damage-distribute') {
      const label = pendingSelection?.params?.label as string | undefined;
      return label ? `${label}：放置傷害指示物` : '放置傷害指示物';
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
      'Pokemon':                       '寶可夢',
      'PokemonOrEnergy':               '寶可夢或能量',
      'PokemonOrBasicEnergy':          '寶可夢或基本能量',
      'PokemonNonExOrBasicEnergy':     '寶可夢（非 ex）或基本能量',
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
      'FightingBasicOrFightingEnergy': '基礎【鬥】寶可夢或【鬥】能量',
      'FightingPokemonOrBasicFightingEnergy': '【鬥】寶可夢或基本【鬥】能量',
      'GrassBasicOrGrassEnergy':       '基礎【草】寶可夢或【草】能量',
      'PsychicBasic':                  '基礎【超】寶可夢',
      'RocketBasic':                   '火箭隊基礎寶可夢',
      'RocketSupporter':               '火箭隊支援者',
      'ColorlessPokeHP100':            'HP≤100 的【無】寶可夢',
    };
    if (map[f]) return map[f];
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
  function dispatchSfxForAction(
    action: ReturnType<typeof GameActions[keyof typeof GameActions]>,
    prev: GameState,
    next: GameState,
  ): void {
    try {
      switch (action.type) {
        case 'DRAW_CARD':
          playSfx('draw');
          break;
        case 'MULLIGAN_DRAW_DECISION':
          if ((action as any).accept) playSfx('draw');
          break;
        case 'FINISH_SETUP':
          // 雙方 setup 都完成 → 進 playing，放擲硬幣音（開局象徵先攻）
          if (prev.phase === 'setup' && next.phase === 'playing') playSfx('coin');
          else playSfx('click');
          break;
        case 'ATTACH_ENERGY':
        case 'PLAY_BASIC':
        case 'BENCH_POKEMON':
        case 'EVOLVE':
        case 'USE_STADIUM':
          playSfx('click');
          break;
        case 'RETREAT':
          playSfx('shuffle', { volume: 0.5 });
          break;
        case 'END_TURN':
          playSfx('click', { volume: 0.6 });
          break;
        case 'PLAY_TRAINER': {
          playSfx('click');
          // Trainer 常帶 draw/shuffle 效果 — 若手牌數上升 or deck 減少顯著，補 draw 音
          const myIdx = next.activePlayerIndex;
          const handDelta = next.players[myIdx].hand.length - prev.players[myIdx].hand.length;
          if (handDelta > 0) setTimeout(() => playSfx('draw', { volume: 0.6 }), 100);
          break;
        }
        case 'USE_ABILITY':
          playSfx('click');
          break;
        case 'RESOLVE_SELECTION':
          playSfx('click', { volume: 0.6 });
          // 若 state 的 deck 縮短明顯，通常是搜卡動作，附加 shuffle 聲
          {
            const myIdx = next.activePlayerIndex;
            const deckDelta = prev.players[myIdx].deck.length - next.players[myIdx].deck.length;
            if (deckDelta >= 2) setTimeout(() => playSfx('shuffle', { volume: 0.4 }), 150);
          }
          break;
        case 'ATTACK': {
          // 攻擊音效 + 動畫 — 取 attacker 主屬性
          const aIdx = prev.activePlayerIndex;
          const attacker = prev.players[aIdx].active;
          if (!attacker) break;
          const atkCard = pool.get(attacker.cardId);
          const etype: EnergyType = atkCard?.pokemonType ?? 'Colorless';
          // v2.224 — 沒有造成傷害的招式（如猛雷鼓ex｜濺射咆哮：棄手牌重抽）
          //   不該觸發攻擊動畫（shake + flash 視覺效果只用在會造成傷害的招式）。
          //   gate：依招式 attack.damage（'' / '0' / 0 → 視為無傷害）。
          const atkData = atkCard?.attacks?.[action.attackIndex];
          const rawDmg = (atkData?.damage ?? '').toString().trim();
          const isZeroDamage = rawDmg === '' || rawDmg === '0';
          playSfx(`attack-${etype}` as `attack-${EnergyType}`);
          if (!isZeroDamage) {
            const defender = next.players[1 - aIdx].active;
            triggerAttackFx(aIdx as 0 | 1, attacker.iid, defender?.iid ?? null, etype);
          }
          break;
        }
        case 'TAKE_PRIZES':
          playSfx('draw');
          break;
        case 'SEND_NEW_ACTIVE':
          playSfx('click');
          break;
        default:
          break;
      }

      // state-diff：status 轉移 / KO（獨立於 action type，checkup 等非 action 也會變）
      detectStatusAndKOSfx(prev, next);
    } catch {
      // 音效失敗不影響遊戲
    }
  }

  /** 比對 prev/next 找出新出現的異常狀態 + KO，播對應音效。 */
  function detectStatusAndKOSfx(prev: GameState, next: GameState): void {
    for (const idx of [0, 1] as const) {
      const prevP = prev.players[idx];
      const nextP = next.players[idx];
      // 戰鬥位 KO（從有 → 無）
      if (prevP.active && !nextP.active) {
        playSfx('ko');
      }
      // 戰鬥位 status：比對同一 iid 前後狀態
      if (prevP.active && nextP.active && prevP.active.iid === nextP.active.iid) {
        if (!prevP.active.status && nextP.active.status) {
          const s = nextP.active.status;
          if (s === 'poisoned') playSfx('poison');
          else if (s === 'burned') playSfx('burn');
          else if (s === 'asleep') playSfx('sleep');
          else if (s === 'confused') playSfx('confuse');
        }
      }
    }
  }
</script>

<svelte:head>
  {@html '<style>html, body { margin: 0; background-color: #162816 !important; min-height: 100vh; }</style>'}
</svelte:head>

<svelte:window onkeydown={onGlobalKey} onpointermove={onWindowPointerMove} onpointerup={onWindowPointerUp} />

<!-- v2.206：手機直屏旋轉提示 — 進戰鬥（game !== null）且手機直屏時顯示。
     CSS 用 @media (orientation: portrait) 守門：橫屏自動隱藏。
     iOS Safari 不支援 screen.orientation.lock，依靠用戶手動旋轉。 -->
{#if game}
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

  {#if mode === null}
  <!-- ─── 模式選擇 ─── -->
  <main class="lobby">
    <a href="{base}/" class="back">← 首頁</a>
    <h1>⚔️ 開始對戰</h1>
    {#if !poolReady}<p class="muted">載入卡池中…</p>{/if}
    <div class="mode-cards">
      <button class="mode-card" onclick={() => mode='local'} disabled={!poolReady}>
        <div class="mode-icon">🖥️</div>
        <div class="mode-title">本機雙人對戰</div>
        <div class="mode-desc">同一台裝置輪流操作</div>
      </button>
      <button class="mode-card online" onclick={() => mode='online'} disabled={!poolReady}>
        <div class="mode-icon">🌐</div>
        <div class="mode-title">線上連線對戰</div>
        <div class="mode-desc">各自裝置，即時對戰</div>
        <div class="mode-badge">M3 NEW</div>
      </button>
    </div>
  </main>

  {:else if mode === 'local'}
  <!-- ─── 本機 Lobby ─── -->
  <main class="lobby">
    <button class="back-btn" onclick={() => mode=null}>← 返回</button>
    <h1>🖥️ 本機雙人對戰</h1>
    <div class="player-setup">
      <div class="setup-card">
        <h2>玩家 1（先手）</h2>
        <input class="name-input" placeholder="玩家名稱" bind:value={p1Name} />
        <select bind:value={p1DeckId}>
          <option value="">— 選擇牌組 —</option>
          {#if PRESET_DECKS.length > 0}
            <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
          {/if}
          {#if decks.length > 0}
            <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
          {/if}
        </select>
      </div>
      <div class="vs-badge">VS</div>
      <div class="setup-card" class:ai-card={aiPlayerIndex===1}>
        <h2>玩家 2（後手）{#if aiPlayerIndex===1}<span class="ai-tag">🤖 AI</span>{/if}</h2>
        <label class="ai-toggle">
          <input type="checkbox" checked={aiPlayerIndex===1} onchange={(e)=>{
            aiPlayerIndex = (e.currentTarget as HTMLInputElement).checked ? 1 : null;
            if (aiPlayerIndex === 1) p2Name = 'AI 對手';
          }} />
          由 AI 控制
        </label>
        {#if aiPlayerIndex !== 1}
          <input class="name-input" placeholder="玩家名稱" bind:value={p2Name} />
        {/if}
        <select bind:value={p2DeckId}>
          <option value="">— 選擇牌組 —</option>
          {#if PRESET_DECKS.length > 0}
            <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
          {/if}
          {#if decks.length > 0}
            <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
          {/if}
        </select>
      </div>
    </div>
    <button class="btn-primary" disabled={!p1DeckId || !p2DeckId} onclick={startLocalGame}>
      {aiPlayerIndex !== null ? '🤖 開始 vs AI' : '🎮 開始遊戲'}
    </button>
    <!-- v2.70：移除「雙人請選不同牌組」警告；本機/線上對戰皆允許兩位玩家使用同一牌組 -->

  </main>

  {:else}
  <!-- ─── 線上 Lobby ─── -->
  <main class="lobby">
    <button class="back-btn" onclick={() => { mode=null; onlineStep='choose'; onlineError=''; }}>← 返回</button>
    <h1>🌐 線上連線對戰</h1>

    {#if onlineStep === 'choose'}
      <p class="muted">選擇你的身份：</p>
      <div class="mode-cards compact">
        <button class="mode-card" onclick={() => onlineStep='create'}>
          <div class="mode-icon">🏠</div>
          <div class="mode-title">建立房間</div>
          <div class="mode-desc">產生房號，等對手加入</div>
        </button>
        <button class="mode-card online" onclick={() => onlineStep='join'}>
          <div class="mode-icon">🚪</div>
          <div class="mode-title">加入房間</div>
          <div class="mode-desc">輸入對方的房號</div>
        </button>
      </div>

    {:else if onlineStep === 'create'}
      <div class="online-form">
        <h2>建立房間</h2>
        <label>玩家名稱<input class="name-input" placeholder="輸入你的名稱" bind:value={myName} /></label>
        <label>房間名稱<input class="name-input" placeholder="輸入房間名稱" bind:value={roomNameInput} /></label>
        {#if onlineError}<p class="warn">{onlineError}</p>{/if}
        <div class="form-btns">
          <button class="btn-primary" onclick={handleCreateRoom} disabled={onlineLoading}>
            {onlineLoading ? '建立中…' : '建立房間'}
          </button>
          <button class="btn-secondary" onclick={() => { onlineStep='choose'; onlineError=''; }}>取消</button>
        </div>
      </div>

    {:else if onlineStep === 'join'}
      <div class="online-form">
        <h2>加入房間</h2>
        <label>玩家名稱<input class="name-input" placeholder="輸入你的名稱" bind:value={myName} /></label>

        <!-- 公開房間列表 -->
        <div class="open-rooms-section">
          <h3>🌐 目前開放的房間（{openRooms.length}）</h3>
          {#if openRoomsErr}
            <p class="warn small">⚠️ {openRoomsErr}</p>
          {/if}
          {#if openRooms.length === 0 && !openRoomsErr}
            <p class="muted small">尚無其他玩家建立房間。可等待、或請對方建立後再刷新，或改用下方手動房號輸入。</p>
          {:else if openRooms.length > 0}
            <ul class="open-room-list">
              {#each openRooms as r (r.roomId)}
                <li class="open-room-row">
                  <span class="or-host">🎮 {r.roomName ?? r.hostName}</span>
                  <span class="or-host-name">房主：{r.hostName}</span>
                  <span class="or-code">房號 {r.roomId}</span>
                  <button class="btn-sm primary" onclick={() => handleJoinFromList(r.roomId)} disabled={onlineLoading || !myName.trim()}>
                    加入
                  </button>
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

        {#if onlineError}<p class="warn">{onlineError}</p>{/if}
        <div class="form-btns">
          <button class="btn-secondary" onclick={() => { onlineStep='choose'; onlineError=''; }}>取消</button>
        </div>
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

        {#if roomData}
          <div class="seat-area">
            <!-- 左側：對戰位 P1 / P2 -->
            <div class="battle-seats">
              {#each [0, 1] as i}
                {@const s = roomData.seats[i]}
                {@const isMine = mySeatIdx === i}
                <div class="seat battle-seat {s.uid ? 'taken' : 'empty'} {isMine ? 'mine' : ''} {s.ready ? 'ready' : ''}">
                  <div class="seat-label">對戰玩家 {i + 1}</div>
                  {#if s.uid}
                    <div class="seat-name">{s.name}{isMine ? '（你）' : ''}</div>
                    {#if countDeckCards(s.deckEntries) === 60}
                      <div class="seat-deck-info">✓ 已選牌組（60 張）</div>
                    {:else}
                      <div class="seat-deck-info muted">尚未選擇牌組</div>
                    {/if}
                    <div class="seat-status">{s.ready ? '✅ 已準備' : '⏳ 未準備'}</div>
                  {:else}
                    <div class="seat-empty-hint">空位（點擊入坐）</div>
                    <button class="btn-sm primary"
                      onclick={() => handleTakeSeat(i)}
                      disabled={onlineLoading}>
                      入坐
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
                    {:else if !mySeatIdx || mySeatIdx === seatIdx}
                      <button class="btn-spec-take"
                        onclick={() => handleTakeSeat(seatIdx)}
                        disabled={onlineLoading || mySeatIdx < 0}>
                        + 入坐
                      </button>
                    {:else}
                      <span class="seat-empty-hint small">空位</span>
                      <button class="btn-spec-take small"
                        onclick={() => handleTakeSeat(seatIdx)}
                        disabled={onlineLoading || mySeatIdx < 0}>
                        移到此
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <!-- 我的座位操作面板 -->
          {#if mySeatIdx >= 0 && (mySeatIdx === 0 || mySeatIdx === 1)}
            {@const mySeat = roomData.seats[mySeatIdx]}
            {@const hasValidDeck = countDeckCards(mySeat.deckEntries) === 60}
            <div class="my-seat-panel">
              <h3>你的位置：對戰玩家 {mySeatIdx + 1}</h3>
              <label>選擇牌組（選擇後自動套用）
                <select value={myDeckId} onchange={handleDeckChange} disabled={mySeat.ready}>
                  <option value="">— 選擇 —</option>
                  {#if PRESET_DECKS.length > 0}
                    <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
                  {/if}
                  {#if decks.length > 0}
                    <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
                  {/if}
                </select>
              </label>
              {#if hasValidDeck}
                <p class="muted small" style="color:#aaffaa;">✓ 牌組已套用（{countDeckCards(mySeat.deckEntries)} 張）</p>
              {:else if myDeckId}
                <p class="muted small" style="color:#ffcc66;">套用中⋯ 若沒進度請重選</p>
              {:else}
                <p class="muted small">請選擇一個牌組</p>
              {/if}
              <div class="seat-actions">
                <button class="btn-primary {mySeat.ready ? 'unready' : ''}"
                  onclick={handleToggleReady}
                  disabled={!hasValidDeck}>
                  {mySeat.ready ? '取消準備' : '準備完成'}
                </button>
              </div>
            </div>
          {:else if mySeatIdx >= 2}
            <div class="my-seat-panel spectator-panel">
              <h3>你目前在觀戰位</h3>
              <p class="muted">移動到「對戰玩家 1/2」位才能加入對戰；或等待對戰開始進入觀戰模式。</p>
            </div>
          {/if}

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
     遊戲結束
  ══════════════════════════════════════════════════════════════════════ -->
{:else if game.phase === 'game-over'}
  {@const isWin = (
    mode === 'online' ? (myPlayerIndex === game.winner) :
    aiPlayerIndex !== null ? (game.winner === (1 - aiPlayerIndex)) :
    true  /* 本機雙人無勝負個人視角，統一顯示 Victory */
  )}
  <main class="gameover-screen">
    <div class="gameover-card" in:scale={{ duration: 600, start: 0.3, easing: cubicOut }}>
      <div class="gameover-icon {isWin ? 'win' : 'lose'}">
        {isWin ? '🏆' : '💔'}
      </div>
      <h1 class="gameover-title {isWin ? 'win' : 'lose'}">
        {isWin ? 'Victory!' : 'Defeat'}
      </h1>
      <p class="winner-text" in:fly={{ y: 30, duration: 500, delay: 300 }}>
        {game.players[game.winner!].name} 獲勝！
      </p>
      <p class="muted" in:fade={{ duration: 400, delay: 600 }}>{game.winReason}</p>
      <div class="lobby-btns export-btns" in:fade={{ duration: 400, delay: 800 }}>
        <button class="btn-secondary" onclick={()=>exportLogAs('txt')} title="匯出純文字 log 供復盤">
          📄 匯出 log（.txt）
        </button>
        <button class="btn-secondary" onclick={()=>exportLogAs('json')} title="匯出結構化 log 供外部工具分析">
          🧾 匯出 log（.json）
        </button>
      </div>
      <div class="lobby-btns" in:fade={{ duration: 400, delay: 900 }}>
        <button class="btn-primary" onclick={() => { game = null; if (mode === 'online') leaveOnlineGame(); }}>
          {mode === 'online' ? '離開房間' : '再來一局'}
        </button>
        <a href="{base}/" class="btn-secondary">回首頁</a>
      </div>
    </div>
  </main>

<!-- ══════════════════════════════════════════════════════════════════════
     正式對戰（Play Mat 佈局） — setup 和 playing 共用此畫面
  ══════════════════════════════════════════════════════════════════════ -->
{:else}
<div class="battle-root">

  <!-- ── 頂部資訊列 ── -->
  <header class="battle-header">
    {#if mode === 'online'}
      <button class="small-back" onclick={leaveOnlineGame}>← 離開</button>
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
        {#if !isMyTurn() && !isMyDefenderTurn()}<span class="chip wait-chip">等待對手行動</span>{/if}
      {/if}
      {#if aiPlayerIndex !== null && aiThinking}<span class="chip ai-chip">🤖 AI 思考中…</span>{/if}
      {#if stadiumCard && game.activeStadium}
        {@const sId = game.activeStadium.cardId}
        <button class="chip stadium-chip clickable-chip" title="點擊查看卡片詳情" onclick={()=>openZoom(sId, null)}>🏟 {stadiumCard.name} 🔍</button>
      {/if}
      <span class="chip version-chip" title="應用程式版本 — 檢查是否同步到最新">v{VERSION}</span>
      <!-- 音效與音樂設定（⚙️） -->
      <button class="chip settings-chip" onclick={() => showSettingsModal = true} title="設定（音效與音樂）">
        ⚙️ 設定
      </button>
      <button class="chip fs-chip" onclick={toggleFullscreen} title={isFullscreen ? '退出全螢幕' : '全螢幕（隱藏瀏覽器列）'}>
        {isFullscreen ? '⛶' : '⛶'} {isFullscreen ? '退出全螢幕' : '全螢幕'}
      </button>
    </span>
    
    <!-- 背景音樂播放器 -->
    {#if bgmTrack !== 'none'}
      <audio 
        src="{base}/music/{bgmTrack}.mp3" 
        loop 
        autoplay 
        bind:this={bgmAudioEl} 
        bind:volume={bgmVolume}
      ></audio>
    {/if}

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
  <div class="playmat" class:trainer-drop-zone={dragging?.kind==='trainer'}>

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
      <div class="zone-bench">
        {#each Array(Math.max(5, oppBenchLimit, oppPlayer?.bench.length ?? 0)) as _, i}
          {#if oppPlayer?.bench[i]}
            {@const b=oppPlayer.bench[i]}{@const bc=getCard(b.cardId)}
            {#if oppHidden}
              <div class="bench-slot card-back-slot" title="對手備戰寶可夢（設置中，未揭曉）">
                <div class="card-back card-back-sm"><span class="card-back-mark">?</span></div>
                <div class="bench-name">？？？</div>
              </div>
            {:else}
              <div class="bench-slot" out:scale={{ duration: 320, start: 0.55, opacity: 0 }}>
                <!-- v2.49：名字/HP 移到卡牌上方，避免與下方 chip/button 擠在一起 -->
                <!-- v2.59：對手 bench 也要顯示附加能量（pip column），與我方備戰一致 — Leon 回報對手資訊看不到 -->
                <div class="bench-name">{bc?.name}</div>
                <div class="bench-stat">HP {hpRemaining(b)}/{hpTotal(b)}</div>
                <div class="bench-middle">
                  <img src={bc?.imageUrl} alt={bc?.name} onclick={()=>openZoom(b.cardId,b)} class="zoomable"/>
                  {#if energyPips(b).length > 0}
                    <div class="bench-nrg">
                      {#each energyPips(b) as pip}
                        <span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="hp-bar-wrap sm"><div class="hp-bar" style="width:{hpTotal(b)?hpRemaining(b)/hpTotal(b)*100:0}%;background:{hpColor(hpRemaining(b),hpTotal(b))}"></div></div>
                {#if b.toolAttached}{@const tc3=getCard(b.toolAttached.cardId)}<div class="tool-chip sm">🔧{tc3?.name}</div>{/if}
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
              out:scale={{ duration: 360, start: 0.55, opacity: 0 }}
            >
              <img src={ac?.imageUrl} alt={ac?.name} class="active-img zoomable" onclick={()=>openZoom(oppPlayer!.active!.cardId,oppPlayer!.active)}/>
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
                {#if oppPlayer.active.toolAttached}{@const tc=getCard(oppPlayer.active.toolAttached.cardId)}<div class="tool-chip">🔧{tc?.name}</div>{/if}
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
              </div>
              <!-- v2.130：血條移到卡牌最下方，避免被特性按鈕等 UI 蓋住（雙方統一） -->
              <div class="active-hpbar-bottom">
                <div class="hp-bar-wrap"><div class="hp-bar" style="width:{hpTotal(oppPlayer.active)?hpRemaining(oppPlayer.active)/hpTotal(oppPlayer.active)*100:0}%;background:{hpColor(hpRemaining(oppPlayer.active),hpTotal(oppPlayer.active))}"></div></div>
                <span class="active-hp-text">HP {hpRemaining(oppPlayer.active)}/{hpTotal(oppPlayer.active)}</span>
              </div>
            </div>
          {/if}
        {:else}<div class="active-card active-empty">（無出場）</div>{/if}
      </div>
      <div class="zone-prizes">
        {#key prizeAnimKey[oppIdx]}
          <div class="prize-grid">
            {#each Array(6) as _, i}<div class="prize-card prize-anim" class:prize-gone={i>=(oppPlayer?.prizes.length??0)} style="animation-delay:{i*90}ms"></div>{/each}
          </div>
        {/key}
        <div class="zone-label-sm">獎勵 {oppPlayer?.prizes.length??0}張</div>
      </div>
    </div>

    <!-- 中間行動列 -->
    <div class="action-bar">
      <div class="alerts-col">
        {#if game.phase==='setup'}
          {@const myDone = game.setupDone[myIdx]}
          {@const oppDone = game.setupDone[oppIdx]}
          {#if myDone && !oppDone}
            <div class="alert info-alert">⏳ 等待對手選出場寶可夢…</div>
          {:else if !myDone}
            {#if !myPlayer?.active}
              <div class="alert info-alert">🃏 從手牌拖出 1 隻基礎寶可夢到戰鬥場</div>
            {:else}
              <div class="alert info-alert">✅ 可加入備戰（最多 5 隻） · 準備完成後點下方按鈕</div>
            {/if}
          {/if}
        {/if}
        {#if pendingPrizes > 0 && isMyTurn()}
          <div class="alert prize-alert">
            🏆 取 {pendingPrizes} 張獎勵牌
            <button class="btn-xs primary" onclick={()=>dispatch(GameActions.takePrizes(pendingPrizes))}>取得</button>
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
          <div class="alert warn-alert">⚠️ 你的戰鬥寶可夢已昏厥，請從備戰區派出新的戰鬥寶可夢（下方視窗選擇）</div>
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
          <button class="btn-act primary" disabled={!myPlayer?.active}
            onclick={()=>dispatch(GameActions.finishSetup(myIdx))}>
            ✅ 準備完成
          </button>
        {:else if isMyTurn()}
          {#if game.turnPhase==='main' && activePlayer?.active}
            {@const eff=getEffectiveAttacks(game, activePlayer.active, pool)}
            {#each eff as { atk, sourceCardName, isFromTool }, i}
              <button class="btn-act atk" class:atk-ready={availableAttacks.includes(i)} class:atk-from-tool={isFromTool}
                disabled={!availableAttacks.includes(i)||!!pendingSelection}
                title={isFromTool ? `來自工具：${sourceCardName}` : ''}
                onclick={()=>initiateAttack(i)}>
                <span class="cost-row">{#each atk.cost as e}<span class="epip" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>{/each}</span>
                <span class="atk-name">{atk.name}{isFromTool ? ' 🔧' : ''}</span>
                <span class="atk-dmg">{atk.damage||'—'}</span>
              </button>
            {/each}
            <button class="btn-act secondary" disabled={!!pendingSelection}
              onclick={async ()=>{
                if(!game) return;
                game = {...game, turnPhase: 'end'};
                // v2.182：線上模式必須 push 到 firestore，否則對手看不到 turnPhase 變化，
                //        且自己的「結束回合」按鈕在對手端不會出現對應 UI 變化。
                if (mode === 'online' && roomCode) {
                  isSyncing = true;
                  try { await pushGameState(roomCode, game); }
                  catch (e) { console.error('[Online] skip-attack push failed:', e); }
                  finally { isSyncing = false; }
                }
              }}>跳過攻擊 →</button>
          {/if}
          {#if canUseStadium && isMyTurn()}
            <button class="btn-act stadium-btn" onclick={()=>dispatch(GameActions.useStadium())}>
              🏟 {stadiumCard?.name}
            </button>
          {/if}
          {#if canEndTurn}
            <button class="btn-act primary" onclick={()=>dispatch(GameActions.endTurn())}>⏭ 結束回合</button>
          {/if}
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
          <img src={stadiumCard.imageUrl} alt={stadiumCard.name} />
          <div class="stadium-display-name">{stadiumCard.name} 🔍</div>
        </div>
      {/if}

      <div class="log-col" title="向下滾動可查看從戰鬥開始到現在的完整記錄">
        {#each [...(game.log??[])].reverse() as entry, i}
          <!-- v2.130：privateMessage 只給 entry.playerIndex 本人看（對手 / 系統 fallback 到 message） -->
          <div class="log-line" class:log-sys={entry.playerIndex===null} class:log-latest={i===0}>{entry.privateMessage && entry.playerIndex === myIdx ? entry.privateMessage : entry.message}</div>
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
        <div class="zone-label-sm">獎勵 {myPlayer?.prizes.length??0}張</div>
        <div class="prize-grid">
          {#key prizeAnimKey[myIdx]}
            {#each Array(6) as _, i}<div class="prize-card my-prize prize-anim" class:prize-gone={i>=(myPlayer?.prizes.length??0)} style="animation-delay:{i*90}ms"></div>{/each}
          {/key}
        </div>
      </div>

      <div class="zone-active my-active-zone">
        <div class="zone-label-sm">
          我的出場
          {#if canRetreatNow&&!pendingSelection&&isMyTurn()&&!myPlayer?.active?.fossilOnField}
            <button class="btn-retreat" onclick={(e)=>openFloatingRetreat(e)}>
              撤退（{retreatCostOf(myPlayer!.active!)}⚡）
            </button>
          {/if}
          <!-- v2.189 化石卡【丟棄】按鈕：戰鬥場版本（自己回合 main phase 才出現） -->
          {#if myPlayer?.active?.fossilOnField && isMyTurn() && game?.phase==='playing' && game?.turnPhase==='main' && !pendingSelection}
            <button class="btn-retreat btn-fossil-discard"
              title="把場上的化石丟棄到棄牌區（非昏厥，對手不抽獎賞）。戰鬥場丟棄需從備戰補 1 隻"
              onclick={async () => { await dispatch(GameActions.discardFossil(myPlayer!.active!.iid)); }}>
              🦴 丟棄化石
            </button>
          {/if}
        </div>
        {#if myPlayer?.active}
          {@const ac=getCard(myPlayer.active.cardId)}
          {@const evoOpts=evoOptionsFor(myPlayer.active.iid)}
          <div class="active-card mine-active"
            class:energy-clickable={selectedEnergyIid!==null&&!pendingSelection&&isMyTurn()}
            class:drop-zone={isMyTurn() && ((dragging?.kind==='energy'||dragging?.kind==='tool') || (dragging?.kind==='evolve'&&evolveTargetsFor(dragging.iid).includes(myPlayer.active.iid)))}
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
            <img src={ac?.imageUrl} alt={ac?.name} class="active-img"
              class:zoomable={!selectedEnergyIid}
              onclick={(e)=>{if(!selectedEnergyIid){e.stopPropagation();openZoom(myPlayer!.active!.cardId,myPlayer!.active);}}}/>
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
              {#if myPlayer.active.toolAttached}{@const tc=getCard(myPlayer.active.toolAttached.cardId)}<div class="tool-chip">🔧{tc?.name}</div>{/if}
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
              {#if selectedEnergyIid&&!pendingSelection&&isMyTurn()}<div class="attach-hint">⚡ 點此附加</div>{/if}
            </div>
            <!-- v2.130：血條移到卡牌最下方，避免被特性按鈕擠擋（雙方統一） -->
            <div class="active-hpbar-bottom">
              <div class="hp-bar-wrap"><div class="hp-bar" style="width:{hpTotal(myPlayer.active)?hpRemaining(myPlayer.active)/hpTotal(myPlayer.active)*100:0}%;background:{hpColor(hpRemaining(myPlayer.active),hpTotal(myPlayer.active))}"></div></div>
              <span class="active-hp-text">HP {hpRemaining(myPlayer.active)}/{hpTotal(myPlayer.active)}</span>
            </div>
            {#if evoOpts.length>0&&!pendingSelection&&isMyTurn()}
              <div class="evo-wrap">
                <button class="evo-btn" onclick={(e)=>{e.stopPropagation();openFloatingEvo(myPlayer!.active!.iid,evoOpts,e);}}>進化▲</button>
              </div>
            {/if}
            {#each usableAbilities.filter(a=>a.iid===myPlayer!.active!.iid) as ab}
              <button class="ability-btn" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.useAbility(ab.iid,ab.abilityIndex));}}>
                ✨{ab.abilityName}
              </button>
            {/each}
          </div>
        {:else}
          <div class="active-card active-empty"
            class:drop-zone={dragging?.kind==='basic'&&game?.phase==='setup'&&isMyTurn()}
            class:drop-hover={dropActiveEmpty&&dragging?.kind==='basic'}
            data-drop-type="active-empty">
            {#if game?.phase==='setup'}🃏 拖曳基礎寶可夢到這裡{:else}（無出場）{/if}
          </div>
        {/if}
      </div>

      <div class="zone-bench">
        {#each Array(Math.max(5, myBenchLimit, myPlayer?.bench.length ?? 0)) as _, i}
          {#if myPlayer?.bench[i]}
            {@const b=myPlayer.bench[i]}{@const bc=getCard(b.cardId)}{@const evoOptsB=evoOptionsFor(b.iid)}
            <div class="bench-slot"
              class:energy-target={selectedEnergyIid!==null&&!pendingSelection&&isMyTurn()}
              class:drop-zone={isMyTurn() && ((dragging?.kind==='energy'||dragging?.kind==='tool') || (dragging?.kind==='evolve'&&evolveTargetsFor(dragging.iid).includes(b.iid)))}
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
                <img src={bc?.imageUrl} alt={bc?.name}
                  class:zoomable={!selectedEnergyIid}
                  onclick={(e)=>{if(!selectedEnergyIid){e.stopPropagation();openZoom(b.cardId,b);}}}/>
                {#if energyPips(b).length > 0}
                  <div class="bench-nrg">
                    {#each energyPips(b) as pip}
                      <span class="nrg-pip" class:nrg-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="hp-bar-wrap sm"><div class="hp-bar" style="width:{hpTotal(b)?hpRemaining(b)/hpTotal(b)*100:0}%;background:{hpColor(hpRemaining(b),hpTotal(b))}"></div></div>
              {#if b.toolAttached}{@const tc2=getCard(b.toolAttached.cardId)}<div class="tool-chip sm">🔧{tc2?.name}</div>{/if}
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
              {#each usableAbilities.filter(a=>a.iid===b.iid) as ab}
                <button class="ability-btn-sm" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.useAbility(ab.iid,ab.abilityIndex));}}>✨{ab.abilityName}</button>
              {/each}
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
            <div class="bench-slot bench-empty"
              class:drop-zone={(dragging?.kind==='basic'||dragging?.kind==='fossil')&&isMyTurn()&&(myPlayer?.bench.length??0)<myBenchLimit&&(game?.phase==='playing'||(game?.phase==='setup'&&!!myPlayer?.active))}
              class:drop-hover={dropBenchEmpty&&(dragging?.kind==='basic'||dragging?.kind==='fossil')}
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
      {#if !game || game.phase !== 'setup' || coinFlipStage === 'done'}
      {#each myPlayer?.hand??[] as inst, i (inst.iid)}
        {@const c=getCard(inst.cardId)}
        {@const n=(myPlayer?.hand.length??0)}
        {@const mid=(n-1)/2}
        {@const step=Math.min(4, 36/Math.max(1,n))}
        {@const rot=n>1?(i-mid)*step:0}
        {@const liftY=Math.abs(i-mid)*(step*0.6)}
        {#if c}
          {@const isEnergyCard=c.supertype==='Energy'}
          {@const isBasicCard=isBasicPokemonCard(c)}
          {@const isFossilCard=isFossilItemCard(c)}
          {@const isTrainerCard=c.supertype==='Trainer'}
          {@const isToolCard=c.supertype === 'Trainer' && c.subtype === 'PokemonTool'}
          {@const isEvolutionCard=c.supertype==='Pokemon'&&!!c.evolvesFrom}
          {@const canEnergy=isEnergyCard&&game?.phase==='playing'&&game?.turnPhase==='main'&&!myPlayer?.energyAttachedThisTurn&&!pendingSelection&&isMyTurn()}
          {@const canBasicPlay=isBasicCard&&playableBasicIids.has(inst.iid)&&isMyTurn()&&game?.phase==='playing'}
          {@const canBasicSetup=isBasicCard&&game?.phase==='setup'&&!game?.setupDone[myIdx]&&isMyTurn()}
          {@const canBasic=canBasicPlay||canBasicSetup}
          {@const canFossil=isFossilCard&&playableFossilIids.has(inst.iid)&&isMyTurn()&&game?.phase==='playing'}
          {@const canTrainer=(isTrainerCard||isToolCard)&&!isFossilCard&&game?.phase==='playing'&&playableTrainerIids.has(inst.iid)&&isMyTurn()}
          {@const canEvolve=isEvolutionCard&&game?.phase==='playing'&&playableEvoIids.has(inst.iid)&&isMyTurn()&&!pendingSelection}
          {@const dragKind =
            canEnergy ? 'energy'
            : canBasic ? 'basic'
            : canFossil ? 'fossil'
            : canEvolve ? 'evolve'
            : (canTrainer && isToolCard) ? 'tool'
            : canTrainer ? 'trainer'
            : null}
          {@const isActionable = canEnergy || canBasic || canFossil || canTrainer || canEvolve}
          <div class="hand-card"
            class:selected={selectedEnergyIid===inst.iid}
            class:can-actionable={isActionable}
            class:dragging={dragging?.iid===inst.iid}
            class:draggable={dragKind!==null}
            class:hover-peek={hoverHandIid===inst.iid}
            class:arriving={arrivingIids.has(inst.iid)}
            style="--fan-rot:{rot}deg;--fan-lift:{liftY}px;"
            in:fly={{ x: 220, y: -40, duration: game?.phase === 'setup' ? 480 : 220, delay: (game?.phase === 'setup' ? i * 150 : i * 40), easing: cubicOut }}
            out:fly={{ y: -220, duration: 220, easing: cubicOut }}
            onpointerenter={(e)=>enterHandCard(e, inst.iid)}
            onpointerleave={leaveHandCard}
            onpointerdown={(e)=>{leaveHandCard(); if(dragKind)startDrag(e, inst, dragKind, c);}}
            onclick={()=>{if(canEnergy && !dragging)selectedEnergyIid=selectedEnergyIid===inst.iid?null:inst.iid;}}
            title={dragKind?`拖曳使用 · ${c.name}`:c.name}>
            <!-- v2.205 手機專屬放大按鈕：手機沒 hover preview，所以加 🔍 鈕 tap → openZoom。
                 stopPropagation 防止觸發外層 onpointerdown(startDrag) / onclick(selectedEnergyIid)。
                 桌機（>950px）display:none 隱藏，桌機沿用 hover-peek。 -->
            <button class="hand-zoom-btn"
              onpointerdown={(e)=>e.stopPropagation()}
              onclick={(e)=>{e.stopPropagation(); openZoom(inst.cardId, inst);}}
              title="放大查看 {c.name}">🔍</button>
            <img src={c.imageUrl} alt={c.name}/>
            <span class="hand-name">{c.name}</span>
            {#if canEnergy}<span class="hand-hint hl">⚡ 拖曳附加</span>
            {:else if canBasic}<span class="hand-hint hl">📥 拖到備戰</span>
            {:else if canFossil}<span class="hand-hint hl">🦴 化石放到備戰</span>
            {:else if canEvolve}<span class="hand-hint hl">🔺 拖到進化目標</span>
            {:else if canTrainer && isToolCard}<span class="hand-hint hl">🔧 拖到寶可夢</span>
            {:else if canTrainer}<span class="hand-hint hl">🎴 拖曳使用</span>
            {/if}
          </div>
        {/if}
      {/each}
      {/if}
    </div>
  </div>

  <!-- PendingSelection — 只對 actor 玩家顯示（避免對手看到或搶先操作）
       v2.196 修：mode='local' 嚴格 check，不接受 null。線上模式剛 join 時 mode 還未確定
       但 pendingSelection 可能已從 firestore sync 進來，舊 condition `mode !== 'online'` 為
       true 會錯誤顯示 modal（嚴重隱私 bug：對手看到我選牌畫面）。
       本機雙人模式（mode='local'）視角會隨 actor 自動翻轉，actor 永遠等於當前視角，
       不需另加 actor === myIdx check（會誤判）。 -->
  {#if pendingSelection && (
    (mode === 'online' && myPlayerIndex !== null && pendingSelection.actorIdx === myPlayerIndex)
    || (mode === 'local' && aiPlayerIndex === null)
    || (aiPlayerIndex !== null && pendingSelection.actorIdx === (1 - aiPlayerIndex))
  )}
    {@const isPokePicker = pendingSelection.type==='bench-choose' || pendingSelection.type==='opp-bench-choose' || pendingSelection.type==='opp-poke-choose' || pendingSelection.type==='heal-target'}
    {@const isDmgDist   = pendingSelection.type==='damage-distribute'}
    {@const dmgTotal    = (pendingSelection.params?.totalCounters as number | undefined) ?? pendingSelection.maxCount}
    {@const dmgPlaced   = (pendingSelection.params?.placedCounters as number | undefined) ?? 0}
    {@const dmgPer      = (pendingSelection.params?.counterDamage as number | undefined) ?? 10}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal" class:retreat-modal={isPokePicker || isDmgDist} style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>{selectionTitle(pendingSelection.type)}</h3>
          {#if isDmgDist}
            <!-- 幻影奇襲類：頂部進度條顯示「已放置 X/totalCounters」— X 含本批次即時累加 -->
            <div class="dmg-progress">
              <div class="dmg-progress-bar">
                <div class="dmg-progress-fill" style="width:{Math.min(100, ((dmgPlaced + selectionBatchSum) / dmgTotal) * 100)}%"></div>
              </div>
              <div class="dmg-progress-text">
                已放置 <strong>{(dmgPlaced + selectionBatchSum) * dmgPer}</strong>／{dmgTotal * dmgPer}
                　<span class="muted">（{dmgPlaced + selectionBatchSum}／{dmgTotal} 個指示物）</span>
              </div>
              <p class="sel-hint">
                本批次剩餘可放 <strong>{pendingSelection.maxCount - selectionBatchSum}</strong>／{pendingSelection.maxCount} 個
                · 點目標 +1、按「－」鍵 或 右鍵 -1 · 確認後若還有指示物會再開此視窗
              </p>
            </div>
          {:else}
            <p class="sel-hint">
              選 {pendingSelection.minCount===pendingSelection.maxCount?`${pendingSelection.minCount}`:`${pendingSelection.minCount}～${pendingSelection.maxCount}`} 張
              {#if pendingSelection.filter&&pendingSelection.filter!=='TOP6'&&!pendingSelection.filter.startsWith('Supporter')}（{describeFilter(pendingSelection.filter)}）{/if}
              · 已選 {selectionPicked.size}
              {#if isPokePicker}· 點放大鏡 🔍 查看詳情{/if}
            </p>
          {/if}
        </div>
        {#if isPokePicker}
          {@const srcActiveIid = game?.players[pendingSelection.sourcePlayerIdx].active?.iid ?? null}
          {@const isOppPicker = pendingSelection.type==='opp-poke-choose' || pendingSelection.type==='opp-bench-choose'}
          <div class="retreat-grid">
            {#each selectionItems as item}{@const c=getCard(item.cardId)}
              {#if c}
                {@const eff=hpTotal(item)}
                {@const rem=hpRemaining(item)}
                {@const picked=selectionPicked.has(item.iid)}
                {@const isActivePoke = item.iid === srcActiveIid}
                <div class="retreat-card" class:sel-picked={picked} class:is-active-poke={isActivePoke}>
                  <button class="retreat-zoom" title="放大檢視：{c.name}"
                    onclick={(e)=>{e.stopPropagation();openZoom(item.cardId, item);}}>🔍</button>
                  <button class="retreat-pick" onclick={(e)=>{e.stopPropagation();toggleSelection(item.iid);}}>
                    {#if isActivePoke}<span class="retreat-active-badge" class:opp={isOppPicker} title={isOppPicker ? '對手目前戰鬥寶可夢' : '目前戰鬥寶可夢'}>⚔️ {isOppPicker ? '對手戰鬥寶可夢' : '我方戰鬥寶可夢'}</span>{/if}
                    <img src={c.imageUrl} alt={c.name}/>
                    <div class="retreat-name">{c.name}</div>
                    <div class="retreat-hp">HP {rem}/{eff}</div>
                    <div class="retreat-nrg">{energySummary(item)}</div>
                    {#if item.toolAttached}{@const tc=getCard(item.toolAttached.cardId)}<div class="retreat-tool">🔧 {tc?.name ?? '?'}</div>{/if}
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
            {#each selectionItems as item}{@const c=getCard(item.cardId)}
              {#if c}
                {@const eff=hpTotal(item)}
                {@const rem=hpRemaining(item)}
                {@const cnt=selectionCounts[item.iid] ?? 0}
                {@const isActivePoke = item.iid === srcActiveIidD}
                {@const projected = item.damage + cnt * dmgPer}
                {@const willKO = eff > 0 && projected >= eff}
                <div class="retreat-card" class:sel-picked={cnt>0} class:is-active-poke={isActivePoke} class:will-ko={willKO}>
                  <button class="retreat-zoom" title="放大檢視：{c.name}"
                    onclick={(e)=>{e.stopPropagation();openZoom(item.cardId, item);}}>🔍</button>
                  {#if cnt > 0}
                    <button class="dmg-minus" title="移除 1 個指示物（右鍵/減號 快捷）"
                      onclick={(e)=>{e.stopPropagation();decrementCount(item.iid);}}>−</button>
                  {/if}
                  <button class="retreat-pick" disabled={batchFull}
                    oncontextmenu={(e)=>{e.preventDefault();decrementCount(item.iid);}}
                    onclick={(e)=>{e.stopPropagation();incrementCount(item.iid);}}>
                    {#if isActivePoke}<span class="retreat-active-badge opp" title="對手目前戰鬥寶可夢">⚔️ 對手戰鬥寶可夢</span>{/if}
                    <img src={c.imageUrl} alt={c.name}/>
                    <div class="retreat-name">{c.name}</div>
                    <div class="retreat-hp">HP {rem}/{eff}</div>
                    <div class="retreat-nrg">{energySummary(item)}</div>
                    {#if cnt > 0}
                      <div class="dmg-preview">
                        +{cnt * dmgPer} → {Math.min(projected, eff)}/{eff}
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
        {:else}
          <div class="sel-grid">
            {#each selectionItems as item}{@const c=getCard(item.cardId)}
              {#if c}
                <div class="sel-card-wrap" class:sel-picked={selectionPicked.has(item.iid)}>
                  <button class="sel-zoom" title="放大檢視：{c.name}"
                    onclick={(e)=>{e.stopPropagation();openZoom(item.cardId, item);}}>🔍</button>
                  <button class="sel-card" onclick={()=>toggleSelection(item.iid)}>
                    <img src={c.imageUrl} alt={c.name}/><span class="sel-name">{c.name}</span>
                    {#if c.hp}<span class="sel-hp">HP{c.hp}</span>{/if}
                    {#if selectionPicked.has(item.iid)}<span class="sel-check">✓</span>{/if}
                  </button>
                </div>
              {/if}
            {/each}
            {#if selectionItems.length===0}<p class="sel-empty">（沒有符合條件的卡牌）</p>{/if}
          </div>
        {/if}

        <!-- 查看全牌庫（用於推斷獎賞卡） — 僅在「搜尋全牌庫」類型顯示；peek-top-X 機制不該能看剩餘牌 -->
        {#if pendingSelection.type==='deck-search' && game
          && !(pendingSelection.filter?.startsWith('TOP') || pendingSelection.filter?.includes(':TOP'))}
          {@const srcP = game.players[pendingSelection.sourcePlayerIdx]}
          {@const deckGrouped = (() => {
            // v2.43：保留 cardId 讓每組旁邊的放大鏡可呼叫 openZoom（與枇琶下拉一致）
            const map = new Map<string, { name: string; count: number; cardId: string }>();
            for (const c of srcP.deck) {
              const card = pool.get(c.cardId);
              const name = card?.name ?? c.cardId;
              const entry = map.get(c.cardId);
              if (entry) entry.count++;
              else map.set(c.cardId, { name, count: 1, cardId: c.cardId });
            }
            return [...map.values()].sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name));
          })()}
          <details class="full-deck-view">
            <summary>📖 查看牌庫剩餘全部（{srcP.deck.length} 張，推斷獎賞卡）</summary>
            <div class="full-deck-note">※ 對照你的原牌組，不在清單中的 6 張通常是獎賞卡（或已在手牌/場上/棄牌）</div>
            <div class="full-deck-list">
              {#each deckGrouped as entry}
                <div class="deck-item">
                  <span class="deck-item-name" title={entry.name}>{entry.count}× {entry.name}</span>
                  <button class="deck-item-zoom" title="放大查看：{entry.name}"
                    onclick={(e)=>{e.stopPropagation();openZoom(entry.cardId);}}>🔍</button>
                </div>
              {/each}
            </div>
          </details>
        {/if}

        <!-- peek-top-N 的「非目標類」剩餘卡 — 例：米立龍「集客」(Supporter:TOP6) 顯示非支援者 3 張
             玩家看過但本次無法挑選；洗回牌庫會重新洗牌，不外洩其他位置資訊。
             篩選條件：filter 形如 "Supporter:TOP6" / 其他 "X:TOPN" —— 純 TOP6 / TOP8（全範圍可選）不進這個分支。 -->
        {#if pendingSelection.type==='deck-search' && game && /:TOP\d+$/.test(pendingSelection.filter ?? '')}
          {@const srcP2 = game.players[pendingSelection.sourcePlayerIdx]}
          {@const peekIids = new Set<string>(
            (pendingSelection.params?.top6Iids as string[] | undefined)
            ?? (pendingSelection.params?.top7Iids as string[] | undefined)
            ?? (pendingSelection.params?.top8Iids as string[] | undefined)
            ?? []
          )}
          {@const pickableIids = new Set(selectionItems.map(c => c.iid))}
          {@const peekedOthers = srcP2.deck.filter(c => peekIids.has(c.iid) && !pickableIids.has(c.iid))}
          {@const remainingDeck = srcP2.deck.length - peekIids.size}
          {#if peekedOthers.length > 0}
            <details class="full-deck-view">
              <summary>🔍 查看翻到的其他 {peekedOthers.length} 張（本次不可選，僅供參考）· 牌庫剩餘 {remainingDeck} 張</summary>
              <div class="full-deck-note">※ 這些卡你已看過但本次不符合挑選條件；結束後會洗回牌庫重新洗牌（位置不會外洩）</div>
              <div class="full-deck-list">
                {#each peekedOthers as inst}{@const c=getCard(inst.cardId)}
                  {#if c}
                    <div class="deck-item">
                      <span class="deck-item-name" title={c.name}>{c.name}</span>
                      <button class="deck-item-zoom" title="放大查看：{c.name}"
                        onclick={(e)=>{e.stopPropagation();openZoom(inst.cardId, inst);}}>🔍</button>
                    </div>
                  {/if}
                {/each}
              </div>
            </details>
          {/if}
        {/if}

        <!-- v2.38 枇琶：對手手牌 hand-discard（sourcePlayerIdx != actorIdx）— 揭露「非可選」其餘手牌 -->
        {#if pendingSelection.type==='hand-discard' && game
          && pendingSelection.sourcePlayerIdx !== pendingSelection.actorIdx}
          {@const srcHand = game.players[pendingSelection.sourcePlayerIdx].hand}
          {@const pickableIidsHD = new Set(selectionItems.map(c => c.iid))}
          {@const otherHand = srcHand.filter(c => !pickableIidsHD.has(c.iid))}
          {#if otherHand.length > 0}
            <details class="full-deck-view">
              <summary>🔍 對手手牌其餘 {otherHand.length} 張（本次不可丟棄，僅供查看）</summary>
              <div class="full-deck-note">※ 枇琶效果只能丟棄物品卡；其餘手牌（寶可夢 / 支援者 / 能量 / 道具 / 場地）僅揭露，不可選</div>
              <div class="full-deck-list">
                {#each otherHand as inst}{@const c=getCard(inst.cardId)}
                  {#if c}
                    <div class="deck-item">
                      <span class="deck-item-name" title={c.name}>{c.name}</span>
                      <button class="deck-item-zoom" title="放大查看：{c.name}"
                        onclick={(e)=>{e.stopPropagation();openZoom(inst.cardId, inst);}}>🔍</button>
                    </div>
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
          {@const ownerDeck = game.players[pendingSelection.actorIdx].deck}
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
              <button class="btn-act primary stepper-confirm"
                onclick={() => confirmSelection()}>✓ 確認</button>
            </div>
            <p class="sel-hint stepper-hint">範圍 {stepper.min}–{stepper.max} · 每次 ±{stepper.step}</p>
          {:else}
            {@const opts = (pendingSelection.params?.options as Array<{id:string;text:string;disabled?:boolean}>) ?? []}
            <div class="modal-choice-list">
              {#each opts as opt}
                <button class="btn-act modal-choice-btn"
                  disabled={!!opt.disabled}
                  onclick={() => { selectionPicked = new Set([opt.id]); confirmSelection(); }}>
                  {opt.text}
                </button>
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
            <button class="btn-act primary" disabled={!selectionValid} onclick={confirmSelection}>
              確認本批次（{selectionBatchSum}／{pendingSelection.maxCount} 個指示物）
            </button>
            {#if selectionBatchSum > 0}
              <button class="btn-act secondary" onclick={()=>{selectionCounts={};}}>清空本批次</button>
            {/if}
          {:else}
            <button class="btn-act primary" disabled={!selectionValid} onclick={confirmSelection}>確定（{selectionPicked.size}張）</button>
            {#if pendingSelection.minCount===0}
              <button class="btn-act secondary" onclick={()=>{selectionPicked=new Set();confirmSelection();}}>不選（跳過）</button>
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
        <button class="evo-choice wide-evo" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.evolve(floatingEvoMenu!.fromIid,evo.iid));floatingEvoMenu=null;}}>
          <img src={ec?.imageUrl} alt={ec?.name}/><span>{ec?.name}</span>
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
          <img src={pc.imageUrl} alt={pc.name}/>
        </div>
      {/if}
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
        <div class="coin coin-{coinFlip.result}">
          <div class="coin-face coin-heads">🪙</div>
          <div class="coin-face coin-tails">⚫</div>
        </div>
        <div class="coin-label" in:fly={{ y: 20, duration: 300, delay: 1400 }}>{coinFlip.label}</div>
      </div>
    </div>
  {/if}

  <!-- Floating Drag Preview -->
  {#if dragging && dragging.moved}
    <div class="drag-preview" style="left:{dragging.x}px;top:{dragging.y}px;" aria-hidden="true">
      <img src={dragging.imageUrl} alt=""/>
      <div class="drag-hint">
        {#if dragging.kind==='energy'}⚡ 拖到寶可夢附加
        {:else if dragging.kind==='basic'}📥 拖到備戰空格
        {:else if dragging.kind==='tool'}🔧 拖到寶可夢附加
        {/if}
      </div>
    </div>
  {/if}

  <!-- 重抽懲罰補抽決定：對手起手無基礎寶可夢重抽時，玩家選擇抽/不抽補償 -->
  {#if game && game.phase==='setup' && (game.pendingMulliganDraw?.[myIdx] ?? 0) > 0 && (
      (mode==='online' && myPlayerIndex===myIdx) ||
      (mode!=='online' && aiPlayerIndex === null) ||
      (aiPlayerIndex !== null && aiPlayerIndex !== myIdx)
    )}
    {@const nDraw = game.pendingMulliganDraw[myIdx]}
    {@const oppName = game.players[oppIdx].name}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal mulligan-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>🔄 對手的重抽懲罰</h3>
          <p class="sel-hint">
            <strong>{oppName}</strong> 起手沒有基礎寶可夢，重新洗牌 {nDraw} 次。
            <br/>作為補償，你可多抽 <strong>{nDraw}</strong> 張牌。
          </p>
        </div>
        <div class="mulligan-body">
          <div class="mulligan-info">
            <div>📦 牌組剩餘：{myPlayer?.deck.length ?? 0} 張</div>
            <div>🖐 目前手牌：{myPlayer?.hand.length ?? 0} 張</div>
            <div>👉 接受後手牌變為：{(myPlayer?.hand.length ?? 0) + nDraw} 張</div>
          </div>
        </div>
        <div class="sel-footer mulligan-footer">
          <button class="btn-act secondary"
            onclick={() => dispatch(GameActions.mulliganDrawDecision(false, myIdx))}>
            🚫 不抽（放棄 {nDraw} 張）
          </button>
          <button class="btn-act primary"
            onclick={() => dispatch(GameActions.mulliganDrawDecision(true, myIdx))}>
            ✅ 抽 {nDraw} 張
          </button>
        </div>
      </div>
    </div>
  {:else if game && game.phase==='setup' && (game.pendingMulliganDraw?.[oppIdx] ?? 0) > 0 && mode==='online' && myPlayerIndex===myIdx}
    <!-- 對手還沒決定重抽補抽 — 僅在線上模式需顯示等待 -->
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal mulligan-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>⏳ 等待對手決定補抽</h3>
          <p class="sel-hint">你因起手無基礎寶可夢重抽了 {game.mulliganCounts[myIdx]} 次，對手正在決定是否多抽 {game.pendingMulliganDraw[oppIdx]} 張…</p>
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
              const ai = preAttackDiscard.attackIndex;
              preAttackDiscard = null;
              dispatch(GameActions.attack(ai, ['yes-token']));
            }}>{yesLabel}</button>
          <button class="btn-ghost" style="padding:12px 32px;font-size:16px"
            onclick={() => {
              const ai = preAttackDiscard.attackIndex;
              preAttackDiscard = null;
              dispatch(GameActions.attack(ai, []));
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
    {@const isHandDiscard = spec.scope === 'hand-rocket-supporter' || spec.scope === 'hand-tool'}
    {@const isHandTool = spec.scope === 'hand-tool'}
    {@const unit = isUnits ? '個' : '張'}
    {@const minOk = pickedAmount >= spec.min}
    {@const maxOk = spec.max === null || pickedAmount <= spec.max}
    {@const estDmg = spec.baseDamage + pickedAmount * spec.damagePerEnergy}
    <div class="selection-overlay" class:dragged={modalDragged}>
      <div class="selection-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>{isHandDiscard ? '🪶' : '⚡'} {preAttackDiscard.attackName}：選擇要丟棄的{
            spec.scope === 'hand-rocket-supporter' ? '火箭隊支援者' :
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
              {@const eUnits = isUnits ? getEnergyDiscardUnits(e.cardId, e.hostInst, pool) : 1}
              <button class="sel-card" class:sel-picked={picked} onclick={() => togglePreAttackEnergy(e.iid)}>
                <img src={ec.imageUrl} alt={ec.name}/>
                <span class="sel-name">{ec.name}{isUnits && eUnits > 1 ? `（${eUnits}個）` : ''}</span>
                <span class="sel-hp">{isHandDiscard ? '在手牌中' : `附於 ${e.ownerName}`}</span>
                {#if picked}<span class="sel-check">✓</span>{/if}
              </button>
            {/if}
          {/each}
          {#if energies.length === 0}
            <p class="sel-empty">（沒有可丟棄的{isHandDiscard ? '支援者' : '能量'}）</p>
          {/if}
        </div>
        <div class="sel-footer">
          <button class="btn-act primary" disabled={!minOk || !maxOk} onclick={confirmPreAttackDiscard}>
            確定使用招式（丟 {pickedCount} 張{isUnits ? `／${pickedAmount} 個能量` : ''}）
          </button>
          {#if spec.min === 0}
            <button class="btn-act secondary" onclick={() => { if (preAttackDiscard) { preAttackDiscard.picked = new Set(); confirmPreAttackDiscard(); } }}>不丟（0 傷害）</button>
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
                <img src={cand.card.imageUrl} alt={cand.card.name} class="copy-attack-img"/>
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
                <button class="retreat-pick" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.retreat(b.iid));floatingRetreatMenu=null;}}>
                  <img src={bc.imageUrl} alt={bc.name}/>
                  <div class="retreat-name">{bc.name}</div>
                  <div class="retreat-hp">HP {rem}/{eff}</div>
                  <div class="retreat-nrg">{energySummary(b)}</div>
                  {#if b.toolAttached}{@const tc=getCard(b.toolAttached.cardId)}<div class="retreat-tool">🔧 {tc?.name ?? '?'}</div>{/if}
                  {#if b.status}<div class="retreat-status">
                    {b.status==='poisoned'?'☠️':b.status==='burned'?'🔥':b.status==='asleep'?'💤':b.status==='confused'?'😵':b.status==='paralyzed'?'⚡':''}
                    {b.status}
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

  <!-- Send New Active Modal（戰鬥寶可夢昏厥後派出新戰鬥寶可夢，使用統一的橫向 grid + 放大鏡介面）
       v2.123：去掉 turnPhase==='end' 限制 — 特性/招式 KO 時 turnPhase 仍為 'main'，
       舊條件會不彈 modal 造成卡住。
       v2.197：加 !pendingSelection guard — 攻擊方還在 pending（如幻影奇襲分配
       6 counter）時，防守方先不彈 modal；等 pending 結束後再彈，避免「modal 已開
       但 button 按了沒反應」的卡頓視覺。 -->
  {#if game && game.phase==='playing' && defenderPlayer?.active===null && isMyDefenderTurn() && !pendingSelection}
    <div class="selection-overlay">
      <div class="selection-modal retreat-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`} onclick={(e)=>e.stopPropagation()}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>⚠️ 派出新的戰鬥寶可夢</h3>
          <p class="sel-hint">你的戰鬥寶可夢已昏厥，請從備戰區挑選一隻上場；點放大鏡 🔍 查看詳情</p>
        </div>
        <div class="retreat-grid">
          {#each defenderPlayer?.bench??[] as b}{@const bc=getCard(b.cardId)}
            {#if bc}
              {@const eff=hpTotal(b)}
              {@const rem=hpRemaining(b)}
              <div class="retreat-card">
                <button class="retreat-zoom" title="放大檢視：{bc.name}"
                  onclick={(e)=>{e.stopPropagation();openZoom(b.cardId, b);}}>🔍</button>
                <button class="retreat-pick" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.sendNewActive(b.iid, dIdx));}}>
                  <img src={bc.imageUrl} alt={bc.name}/>
                  <div class="retreat-name">{bc.name}</div>
                  <div class="retreat-hp">HP {rem}/{eff}</div>
                  <div class="retreat-nrg">{energySummary(b)}</div>
                  {#if b.toolAttached}{@const tc=getCard(b.toolAttached.cardId)}<div class="retreat-tool">🔧 {tc?.name ?? '?'}</div>{/if}
                  {#if b.status}<div class="retreat-status">
                    {b.status==='poisoned'?'☠️':b.status==='burned'?'🔥':b.status==='asleep'?'💤':b.status==='confused'?'😵':b.status==='paralyzed'?'⚡':''}
                    {b.status}
                  </div>{/if}
                </button>
              </div>
            {/if}
          {/each}
          {#if (defenderPlayer?.bench??[]).length===0}
            <p class="sel-empty">（備戰區沒有可上場的寶可夢）</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Send New Active Modal（自 KO 版）：主動方自 KO（如咒詛炸彈、中毒）後自己戰鬥場空欄 → 從自己備戰區選
       v2.123：去掉 turnPhase!=='end' 限制 — 中毒於 END_TURN 觸發時 turnPhase 可能已是 'end'，
       舊條件會擋掉 modal 造成當機。 -->
  {#if game && game.phase==='playing' && myPlayer?.active===null && (myPlayer?.bench??[]).length>0 && !pendingSelection}
    <div class="selection-overlay">
      <div class="selection-modal retreat-modal" style:transform={`translate(${modalOffset.x}px, ${modalOffset.y}px)`} onclick={(e)=>e.stopPropagation()}>
        <div class="sel-header" onpointerdown={onModalHeaderPointerDown} onpointermove={onModalHeaderPointerMove} onpointerup={onModalHeaderPointerUp} title="拖曳視窗">
          <h3>⚠️ 派出新的戰鬥寶可夢</h3>
          <p class="sel-hint">你的戰鬥寶可夢已昏厥，請從備戰區挑選一隻上場；點放大鏡 🔍 查看詳情</p>
        </div>
        <div class="retreat-grid">
          {#each myPlayer?.bench??[] as b}{@const bc=getCard(b.cardId)}
            {#if bc}
              {@const eff=hpTotal(b)}
              {@const rem=hpRemaining(b)}
              <div class="retreat-card">
                <button class="retreat-zoom" title="放大檢視：{bc.name}"
                  onclick={(e)=>{e.stopPropagation();openZoom(b.cardId, b);}}>🔍</button>
                <button class="retreat-pick" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.sendNewActive(b.iid, myIdx));}}>
                  <img src={bc.imageUrl} alt={bc.name}/>
                  <div class="retreat-name">{bc.name}</div>
                  <div class="retreat-hp">HP {rem}/{eff}</div>
                  <div class="retreat-nrg">{energySummary(b)}</div>
                  {#if b.toolAttached}{@const tc=getCard(b.toolAttached.cardId)}<div class="retreat-tool">🔧 {tc?.name ?? '?'}</div>{/if}
                  {#if b.status}<div class="retreat-status">
                    {b.status==='poisoned'?'☠️':b.status==='burned'?'🔥':b.status==='asleep'?'💤':b.status==='confused'?'😵':b.status==='paralyzed'?'⚡':''}
                    {b.status}
                  </div>{/if}
                </button>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Discard Viewer -->
  {#if viewDiscardFor !== null}
    {@const viewPlayer = game!.players[viewDiscardFor]}
    <div class="zoom-overlay" onclick={() => viewDiscardFor = null}>
      <div class="zoom-modal discard-modal" onclick={(e)=>e.stopPropagation()}>
        <button class="zoom-close" onclick={() => viewDiscardFor = null}>✕</button>
        <h3 class="discard-title">🗑 {viewPlayer.name} 的棄牌區（{viewPlayer.discard.length} 張）</h3>
        <div class="sel-grid">
          {#each [...viewPlayer.discard].reverse() as inst}{@const c=getCard(inst.cardId)}
            {#if c}
              <button class="sel-card" onclick={() => openZoom(inst.cardId)}>
                <img src={c.imageUrl} alt={c.name}/><span class="sel-name">{c.name}</span>
                {#if c.hp}<span class="sel-hp">HP{c.hp}</span>{/if}
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
        
        <div class="settings-section">
          <h4>🎵 背景音樂 (BGM)</h4>
          <div class="setting-row">
            <label for="bgm-select">選擇曲目：</label>
            <select id="bgm-select" value={bgmTrack} onchange={(e) => onBgmTrackChange(e.currentTarget.value)}>
              <option value="none">無 (關閉)</option>
              <option value="Aim to Be a Pokemon Master">Aim to Be a Pokémon Master</option>
              <option value="Pokemon XYZ Opening">Pokémon XYZ Opening</option>
              <option value="We Go">We Go</option>
            </select>
          </div>
          {#if bgmTrack !== 'none'}
            <div class="setting-row">
              <label for="bgm-vol">音樂音量：</label>
              <input id="bgm-vol" type="range" min="0" max="1" step="0.05" value={bgmVolume} oninput={(e) => onBgmVolumeChange(parseFloat(e.currentTarget.value))} />
              <span class="vol-text">{Math.round(bgmVolume * 100)}%</span>
            </div>
          {/if}
        </div>

        <div class="settings-section">
          <h4>🔊 遊戲音效 (SFX)</h4>
          <div class="setting-row">
            <label for="sfx-mute">音效開關：</label>
            <button id="sfx-mute" class="toggle-btn" onclick={onMuteToggle}>
              {audioMuted ? '❌ 已靜音' : '✅ 開啟'}
            </button>
          </div>
          {#if !audioMuted}
            <div class="setting-row">
              <label for="sfx-vol">音效音量：</label>
              <input id="sfx-vol" type="range" min="0" max="1" step="0.05" value={audioVolume} oninput={(e) => onVolumeChange(parseFloat(e.currentTarget.value))} />
              <span class="vol-text">{Math.round(audioVolume * 100)}%</span>
            </div>
          {/if}
        </div>
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
        <div class="zoom-body">
          <!-- v2.129：點擊 zoom-img 開全螢幕 lightbox -->
          <button class="zoom-img-btn" type="button" onclick={() => openLightboxImg(zoomCard!.imageUrl)} title="點擊放大">
            <img src={zoomCard.imageUrl} alt={zoomCard.name} class="zoom-img"/>
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
              {@const toolC = zoomInst.toolAttached ? getCard(zoomInst.toolAttached.cardId) : null}
              <div class="zoom-state">
                <div class="state-title">📍 場上狀態</div>
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
                {#if toolC}
                  <div class="state-row"><span class="state-k">🔧 道具</span><span class="state-v"><button class="state-tool clickable" title="點擊放大：{toolC.name}" onclick={() => openZoom(zoomInst!.toolAttached!.cardId, null)}>{toolC.name} 🔍</button></span></div>
                {/if}
                {#if zoomInst.status}
                  <div class="state-row"><span class="state-k">異常</span><span class="state-v">{
                    zoomInst.status==='poisoned'?'☠️ 中毒':
                    zoomInst.status==='burned'?'🔥 燒傷':
                    zoomInst.status==='asleep'?'💤 睡眠':
                    zoomInst.status==='confused'?'😵 混亂':
                    zoomInst.status==='paralyzed'?'⚡ 麻痺':zoomInst.status
                  }</span></div>
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
            {/if}
            {#each zoomCard.abilities??[] as ab}
              <div class="zoom-ability"><span class="ability-label">特性</span><strong>{ab.name}</strong><p class="effect-text">{ab.effect ?? (ab as any).text}</p></div>
            {/each}
            {#each zoomCard.attacks??[] as atk}
              {@const atkEffect = atk.effect ?? (atk as any).text ?? ''}
              <div class="zoom-attack">
                <div class="atk-header">
                  <span class="cost-row">{#each atk.cost as e}<span class="epip" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>{/each}{#if atk.cost.length===0}<span class="no-cost">無消耗</span>{/if}</span>
                  <span class="atk-nm">{atk.name}</span><span class="atk-dp">{atk.damage||'—'}</span>
                </div>
                {#if atkEffect.trim()}<p class="effect-text">{atkEffect}</p>{/if}
              </div>
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

  <!-- v2.129：全螢幕卡牌放大 lightbox（鏡射 /cards 樣式）—— 從 zoom-img 點擊或 ImageButton 觸發 -->
  {#if lightboxUrl}
    <div class="lightbox-overlay" role="dialog" aria-modal="true" aria-label="放大卡牌圖片"
      onclick={closeLightboxImg}>
      <img class="lightbox-img" src={lightboxUrl} alt="放大圖片" onclick={(e)=>e.stopPropagation()}/>
      <button class="lightbox-close" onclick={closeLightboxImg} aria-label="關閉">×</button>
    </div>
  {/if}

</div>
{/if}

<style>
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
  .lobby,.setup-screen{ max-width:700px; margin:2rem auto; padding:1.5rem; font-family:system-ui,'Microsoft JhengHei',sans-serif; color:#f0f0f0; }
  .lobby h1{ font-size:1.8rem; margin-bottom:1rem; }
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
  .player-setup{ display:grid; grid-template-columns:1fr auto 1fr; gap:1rem; align-items:center; margin:1.5rem 0; }
  .setup-card{ background:#2a3a2a; border:1px solid #3a5a3a; border-radius:10px; padding:1rem; display:flex; flex-direction:column; gap:0.6rem; }
  .setup-card h2{ margin:0; font-size:1rem; color:#aaffaa; }
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
  .open-room-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.4rem; max-height:240px; overflow-y:auto; }
  .open-room-row{ display:flex; align-items:center; gap:.6rem; padding:.5rem .75rem; background:#1a2a1a; border:1px solid #3a5a3a; border-radius:6px; }
  .or-host{ flex:1; font-weight:600; color:#f0f0f0; }
  .or-code{ font-family:monospace; letter-spacing:.15em; color:#aaf; font-size:.85rem; }
  .btn-sm{ padding:.3rem .8rem; border:none; border-radius:5px; cursor:pointer; font-size:.85rem; }
  .btn-sm.primary{ background:#3a7a3a; color:#fff; }
  .btn-sm.primary:hover:not(:disabled){ background:#4a9a4a; }
  .btn-sm:disabled{ opacity:.5; cursor:not-allowed; }
  .manual-code{ background:#0e1e0e; border:1px solid #2a4a2a; border-radius:6px; padding:.5rem .8rem; }
  .manual-code summary{ cursor:pointer; color:#ccc; font-size:.88rem; }
  .manual-code label{ margin-top:.5rem; }
  .manual-code button{ margin-top:.5rem; }

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

  .my-seat-panel{ background:#1e2e3e; border:1px solid #4a6a8a; border-radius:10px; padding:1rem;
    display:flex; flex-direction:column; gap:0.6rem; }
  .my-seat-panel h3{ margin:0; font-size:1rem; color:#aaccff; }
  .my-seat-panel select{ padding:0.4rem 0.6rem; border:1px solid #4a6a8a; border-radius:6px;
    background:#1a2a3a; color:#f0f0f0; font:inherit; }
  .my-seat-panel.spectator-panel{ background:#2a2a3a; border-color:#5a5a6a; }
  .seat-actions{ display:flex; gap:0.5rem; flex-wrap:wrap; }
  .btn-primary.unready{ background:#7a3a3a; }
  .btn-primary.unready:hover:not(:disabled){ background:#9a4a4a; }
  .or-host-name{ font-size:0.8rem; color:#aaa; }

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
  .battle-root{ min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; font-family:system-ui,'Microsoft JhengHei',sans-serif; color:#f0f0f0; overflow-y:auto; overflow-x:hidden; }

  .battle-header{ display:flex; align-items:center; gap:0.6rem; background:#0a180a; padding:0.35rem 0.75rem; border-bottom:1px solid #2a4a2a; flex-shrink:0; flex-wrap:wrap; }
  .small-back{ color:#88ccff; text-decoration:none; font-size:0.82rem; background:none; border:none; cursor:pointer; padding:0; }
  .small-back:hover{ text-decoration:underline; }
  .turn-info{ flex:1; font-size:0.88rem; }
  .hint{ color:#888; font-size:0.75rem; }
  .phase-tag{ font-size:0.78rem; color:#aaffaa; background:#0e2e0e; padding:0.18rem 0.5rem; border-radius:4px; }
  .hand-counts{ display:flex; gap:0.28rem; align-items:center; flex-wrap:wrap; }
  .hand-count-chip{ background:#1a2a3a; color:#9cf; border-color:#2a4a6a; font-size:0.7rem; padding:0.14rem 0.45rem; }
  .hand-count-chip.hc-active{ background:#2a3e1a; color:#cfa; border-color:#4a6a2a; box-shadow:0 0 4px rgba(150,255,100,.25); }
  .status-chips{ display:flex; gap:0.3rem; flex-wrap:wrap; }
  .chip{ font-size:0.68rem; padding:0.1rem 0.35rem; border-radius:10px; background:#1a3a1a; color:#8f8; border:1px solid #2a5a2a; }
  .role-chip{ background:#1a1a3a; color:#aaf; border-color:#2a2a5a; }
  .version-chip{ background:#2a1a3a; color:#c0a0e0; border-color:#4a3a6a; font-family:monospace; }
  .wait-chip{ background:#3a2a1a; color:#fa8; border-color:#5a3a1a; }
  .syncing-chip{ background:#3a3a1a; color:#ff8; border-color:#5a5a1a; }
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

  .field-row{ display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.7rem; overflow:visible; min-height:0; }
  .opponent-row{ border-bottom:2px solid #2a5a2a; background:rgba(0,0,0,.2); align-items:flex-end; padding-bottom:0.6rem; }
  /* v2.03：還原為對稱 padding，依靠 overflow:visible 讓按鈕自然延伸到場地外即可 */
  .my-row{ border-top:2px solid #2a5a2a; align-items:flex-end; padding-bottom:0.6rem; }

  .zone-prizes{ flex-shrink:0; display:flex; flex-direction:column; align-items:center; gap:0.2rem; }
  .prize-grid{ display:grid; grid-template-columns:1fr 1fr; gap:3px; }
  .prize-card{ width:32px; height:45px; background:linear-gradient(135deg,#1e4a8a,#2a6ab0); border:1px solid #4a8ac0; border-radius:4px; }
  .prize-card.my-prize{ background:linear-gradient(135deg,#2a6a1a,#3a8a2a); border-color:#5aaa4a; }
  .prize-card.prize-gone{ background:transparent; border-color:#2a3a2a; opacity:.25; animation:none !important; }
  /* 獎賞卡放置動畫：從上方 fly-in + rotate + scale，by animation-delay 錯開 */
  .prize-card.prize-anim{ animation:prize-deal .45s cubic-bezier(.2,.9,.35,1.15) both; transform-origin:center; }
  @keyframes prize-deal{
    0%{ transform:translate(-60px,-40px) rotate(-18deg) scale(.5); opacity:0; box-shadow:0 8px 16px rgba(0,0,0,.6); }
    60%{ transform:translate(2px,3px) rotate(4deg) scale(1.05); opacity:1; box-shadow:0 4px 10px rgba(0,0,0,.55); }
    100%{ transform:none; opacity:1; box-shadow:none; }
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

  .zone-active{ flex-shrink:0; width:300px; display:flex; flex-direction:column; gap:0.2rem; }
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
  .active-nrg-col .nrg-pip{ min-width:18px; height:16px; font-size:.66rem; }
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
  .settings-modal { max-width: 500px; padding: 2rem; }
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

  /* v2.45：overlay 飛行期間 hand-card opacity:0，overlay 落地才淡入 */
  .hand-card.arriving{ opacity:0; pointer-events:none; }
  .hand-card:not(.arriving){ transition: opacity .18s ease-out; }

  .zone-bench{ flex:1; display:flex; gap:.35rem; overflow:visible; min-width:0; }
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
  .bench-name{ font-size:.7rem; color:#ccc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; }
  .bench-stat{ font-size:.66rem; color:#aaa; }
  /* v2.51：能量 pip 改為垂直排列在圖片右側（解決能量多時撐高問題） */
  .bench-nrg{ font-size:.62rem; color:#888; display:flex; flex-direction:column; align-items:center; gap:2px; line-height:1; flex-shrink:0; }
  .nrg-pip{
    display:inline-flex; align-items:center; justify-content:center;
    min-width:14px; height:14px; padding:0 3px; border-radius:7px;
    font-size:.58rem; font-weight:700; color:#fff; line-height:1;
    box-shadow:0 0 0 1px rgba(0,0,0,.35) inset;
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

  /* v2.03：action-bar 還原為原本 160/200；靠 overflow:visible 讓場地卡不會被切 */
  .action-bar{ display:grid; grid-template-columns:auto 1fr auto auto; gap:.5rem; padding:.3rem .7rem; background:rgba(0,0,0,.6); border-top:1px solid #2a4a2a; border-bottom:1px solid #2a4a2a; flex-shrink:0; align-items:stretch; min-height:160px; max-height:200px; overflow:visible; }
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
  .btn-act.atk{ background:#1a2a3a; border:1px solid #3a5a7a; color:#ccd; opacity:.45; cursor:not-allowed; }
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
    scrollbar-width:thin; scrollbar-color:#4a6a4a rgba(0,0,0,.3); }
  .log-col::-webkit-scrollbar{ width:8px; }
  .log-col::-webkit-scrollbar-thumb{ background:#3a5a3a; border-radius:4px; }
  .log-col::-webkit-scrollbar-thumb:hover{ background:#5a7a5a; }
  .log-line{ color:#9ab89a; padding:.2rem 0; border-bottom:1px solid rgba(42,74,42,.4); white-space:normal; word-break:break-all; }
  .log-line:last-child{ border-bottom:none; }
  .log-sys{ color:#aaffcc; font-weight:600; }
  .log-latest{ background:rgba(170,255,204,.06); padding-left:.3rem; border-left:2px solid #aaffcc; }

  .btn-retreat{ padding:.1rem .3rem; font-size:.62rem; background:#3a3a6a; border:1px solid #6a6aaa; border-radius:4px; color:#ccf; cursor:pointer; }
  .btn-retreat:hover{ background:#4a4a8a; }
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

  .hand-strip{ flex-shrink:0; background:#0a160a; border-top:2px solid #2a5a2a; padding:.35rem .7rem .5rem; overflow:visible; }
  .hand-label{ font-size:.75rem; color:#5a8a5a; margin-bottom:.25rem; }
  .hand-not-my-turn{ color:#888; margin-left:.4rem; }
  /* v2.41：鎖定手牌列不可滑動（移除 overflow-x:auto 產生的滑桿）；
     當手牌 >9 張時以 var(--hand-overlap) 讓卡片互疊而不溢出視窗。
     `overflow:hidden` 確保兩軸都不產生滾動條；padding-bottom 加大以容納扇形下彎。 */
  .hand-scroll{ display:flex; justify-content:center; gap:0; padding:30px 1rem 22px; overflow:hidden; min-height:170px; perspective:900px; }
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
  .hand-name{ font-size:.68rem; color:#bbb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; }
  .hand-hint{ font-size:.65rem; color:#bbb; }
  .hand-hint.hl{ color:#ffd44a; font-weight:600; }
  .energy-hint{ color:#aaff44; }
  /* v1.02：統一黃框表示「當下可用」— 涵蓋能量/基礎/訓練家/進化 */
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
  /* v2.201 modal-choice stepper：泰姆猜 HP 等需要數字輸入的場景 — Leon 規則「戰鬥畫面只用滑鼠」
     置中橫排：[−] [當前值] [+] [✓ 確認]，按鈕為大圓鈕方便手機/平板觸控 */
  .modal-choice-stepper{ display:flex; align-items:center; justify-content:center; gap:.6rem; padding:.6rem 0; flex-wrap:wrap; }
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
  .full-deck-list{ display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:.2rem .6rem; max-height:200px; overflow-y:auto; }
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
  /* deck-search / generic selection：放大鏡 + 挑選按鈕的 wrapper */
  .sel-card-wrap{ position:relative; display:flex; flex-direction:column; }
  .sel-card-wrap.sel-picked .sel-card{ border-color:#aaff44; box-shadow:0 0 6px #aaff4488; }
  .sel-zoom{ position:absolute; top:.2rem; right:.2rem; z-index:2; background:rgba(0,0,0,.72); border:1px solid #6aaa6a; color:#cfc; font-size:.7rem; line-height:1; padding:.18rem .32rem; border-radius:4px; cursor:pointer; }
  .sel-zoom:hover{ background:rgba(74,138,74,.9); color:#fff; }
  .sel-card img{ width:64px; border-radius:3px; }
  .sel-name{ text-align:center; font-size:.6rem; }
  .sel-hp{ font-size:.58rem; color:#888; }
  .sel-check{ position:absolute; top:2px; right:4px; font-size:.9rem; color:#aaff44; font-weight:700; }
  .sel-empty{ color:#666; font-size:.85rem; grid-column:1/-1; text-align:center; padding:1rem; }
  .sel-footer{ display:flex; gap:.75rem; justify-content:flex-end; flex-wrap:wrap; }

  /* Mulligan 補抽模態 */
  .mulligan-modal{ max-width:440px; }
  .mulligan-body{ padding:.4rem 0; }
  .mulligan-info{ background:rgba(255,220,120,.08); border:1px solid rgba(255,200,100,.35); border-radius:8px; padding:.6rem .75rem; display:flex; flex-direction:column; gap:.25rem; color:#ffe0a0; font-size:.85rem; }
  .mulligan-footer{ justify-content:space-between; }

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


  .zoom-overlay{ position:fixed; inset:0; z-index:200; background:rgba(0,0,0,.88); display:flex; align-items:center; justify-content:center; font-family:system-ui,'Microsoft JhengHei',sans-serif; }
  /* v2.69：卡牌詳細 modal 整體等比放大 20%（Leon 反饋） */
  .zoom-modal{ background:#1a2a1a; border:1px solid #4a7a4a; border-radius:14px; padding:1.44rem; max-width:864px; width:96vw; max-height:92vh; display:flex; flex-direction:column; gap:.9rem; color:#f0f0f0; overflow-y:auto; position:relative; }
  .zoom-close{ position:absolute; top:.7rem; right:.8rem; background:transparent; border:none; color:#aaa; font-size:1.44rem; cursor:pointer; padding:.24rem .48rem; border-radius:4px; line-height:1; }
  .zoom-close:hover{ background:#2a3a2a; color:#fff; }
  /* v2.32：放到 × 左邊（top-right），避免擋到卡牌圖。.zoom-close 大約 1.6–2rem 寬，所以 back 從 right:3rem 開始留一些間距。 */
  .zoom-back{ position:absolute; top:.7rem; right:3.2rem; background:#2a4a6a; border:1px solid #4a6a8a; color:#cce; font-size:.98rem; cursor:pointer; padding:.3rem .72rem; border-radius:4px; line-height:1; }
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

  /* ── Tool + Stadium ── */
  .tool-chip{ font-size:.6rem; color:#f0d080; background:#2a2a0a; border:1px solid #6a5a20; border-radius:3px; padding:.06rem .2rem; margin-top:.1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tool-chip.sm{ font-size:.52rem; }
  .ab-used-chip{ font-size:.58rem; color:#c8c0f0; background:#2a1a3a; border:1px solid #4a3a6a; border-radius:3px; padding:.06rem .25rem; margin-top:.1rem; display:inline-block; }
  .ab-used-chip.sm{ font-size:.7rem; padding:0 .15rem; border:none; background:transparent; color:#d0a0ff; }
  .tool-btn{ background:#4a3a10; color:#f0d080; }
  .tool-btn:hover{ background:#6a5a20; }
  .stadium-chip{ background:#1a2a4a; color:#88aaff; border-color:#3a5a8a; }
  .clickable-chip{ cursor:pointer; font-family:inherit; }
  .clickable-chip:hover{ background:#2a3a5a; color:#fff; }
  .btn-act.stadium-btn{ background:#1a2a4a; color:#88aaff; border:1px solid #3a5a8a; }
  .btn-act.stadium-btn:hover{ background:#2a3a6a; }

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
    z-index:3;  /* 高於 .active-info(z=2)，確保不被覆蓋 */
    pointer-events:none;
  }
  .active-hpbar-bottom .hp-bar-wrap{ flex:1; height:9px; margin:0; background:#1a2a1a; border:1px solid #2a4a2a; border-radius:4px; }
  .active-hpbar-bottom .active-hp-text{ font-size:.72rem; color:#cfe; white-space:nowrap; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,.7); }
  /* 把進化按鈕往上挪，避免壓到底部血條 */
  .active-card{ padding-bottom:1.95rem !important; }
  .evo-wrap{ bottom:1.85rem !important; }

  /* ── v2.129：zoom-modal 內的 zoom-img 點擊全螢幕放大 ── */
  .zoom-img-btn{ position:relative; display:block; background:none; border:none; padding:0; cursor:zoom-in; }
  .zoom-img-btn .zoom-img{ display:block; }
  .zoom-img-hint{ position:absolute; top:0.4rem; right:0.4rem; background:rgba(0,0,0,0.55); color:#fff; padding:0.15rem 0.4rem; border-radius:0.4rem; font-size:0.85rem; opacity:0.7; pointer-events:none; transition:opacity 0.12s; }
  .zoom-img-btn:hover .zoom-img-hint{ opacity:1; }

  /* ── v2.129：全螢幕 lightbox（鏡射 /cards 樣式，但 z-index 比 zoom-overlay 高） ── */
  .lightbox-overlay{ position:fixed; inset:0; background:rgba(0,0,0,0.92); display:flex; align-items:center; justify-content:center; z-index:9999; cursor:zoom-out; padding:1rem; }
  .lightbox-img{ max-width:min(600px,95vw); max-height:92vh; object-fit:contain; border-radius:12px; box-shadow:0 8px 40px rgba(0,0,0,0.6); cursor:default; }
  .lightbox-close{ position:absolute; top:1rem; right:1.25rem; background:rgba(255,255,255,0.15); border:none; color:#fff; font-size:2rem; line-height:1; width:2.5rem; height:2.5rem; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; }
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
  /* 桌機（>950px）：手機專屬 🔍 鈕預設隱藏；hover-peek 仍正常運作 */
  .hand-zoom-btn{ display:none; }
  /* v2.206 手機直屏 fallback overlay（在 mobile 直屏時提示旋轉到橫向） */
  .rotate-prompt{ display:none; }
  @media (max-width: 950px) and (orientation: portrait) {
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
    .battle-header{ flex:0 0 auto; max-height:7vh; padding:0.1rem 0.4rem; gap:0.2rem; font-size:0.66rem;
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

    /* ── v2.206 zoom-modal 縮小到不用滾動 ── */
    /* 卡圖縮小：桌機 312px → 手機 160px。zoom-modal width 96vw / max-height 88vh */
    .zoom-modal{ max-width:560px; width:96vw; max-height:88vh; padding:0.7rem; gap:0.5rem; }
    .zoom-img{ width:160px; max-width:42vw; }
    .zoom-name{ font-size:1rem; }
    .zoom-badges{ gap:0.25rem; }
    .zoom-badges .badge{ font-size:0.66rem; padding:0.1rem 0.4rem; }
    .zoom-meta, .zoom-state, .state-row{ font-size:0.74rem; }
    /* zoom-img-btn 在手機上停用 lightbox 二段（直接顯示 zoom-modal 詳細資料即可） */
    .zoom-img-btn{ cursor:default; pointer-events:none; }
    .zoom-img-hint{ display:none; }
  }
</style>
