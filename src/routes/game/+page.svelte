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
    getAvailableAttacks, hasPendingActions,
    countEnergy, getEvolvableTargets,
    canRetreat, getPlayableTrainers, getPlayableBasics,
    getUsableAbilities, isBasicPokemonCard,
  } from '$lib/game/engine';
  import { GameActions } from '$lib/game/actions';
  import type { GameState, CardInstance } from '$lib/game/types';
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';
  import type { EnergyType } from '$lib/cards/types';
  import { auth } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
  import {
    createRoom, joinRoom, subscribeRoom, pushGameState,
    type Room,
  } from '$lib/game/room';
  import { getAIAction } from '$lib/game/ai';

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

  // ── 線上模式狀態 ─────────────────────────────────────────────────────────────
  let myUid       = $state<string | null>(null);
  let myName      = $state('');
  let myDeckId    = $state('');
  /** 'choose' → 選建立/加入；'create' → 填資料建房間；'join' → 輸入房號；'room' → 房間等待中 */
  let onlineStep  = $state<'choose' | 'create' | 'join' | 'room'>('choose');
  let roomCode    = $state('');          // 建立或加入後得到的房號
  let joinInput   = $state('');          // 輸入框裡打的房號
  let amIHost     = $state(false);
  let roomData    = $state<Room | null>(null);
  let onlineLoading = $state(false);
  let onlineError   = $state('');
  let isSyncing     = $state(false);
  let myPlayerIndex = $state<0 | 1 | null>(null); // null = 本機模式（無限制）
  let unsubRoom:    (() => void) | null = null;

  // ── UI 互動狀態 ─────────────────────────────────────────────────────────────
  let selectedEnergyIid = $state<string | null>(null);
  let selectionPicked = $state<Set<string>>(new Set());
  let zoomCard = $state<Card | null>(null);
  let zoomInst = $state<CardInstance | null>(null);
  // 堆疊：之前開過的 zoom — 用於「返回上一層」按鈕
  let zoomStack = $state<Array<{ card: Card; inst: CardInstance | null }>>([]);
  let floatingEvoMenu = $state<{ fromIid: string; evoOpts: CardInstance[]; x: number; y: number } | null>(null);
  let floatingRetreatMenu = $state<{ x: number; y: number } | null>(null);
  let viewDiscardFor = $state<0 | 1 | null>(null);

  // ── 手牌 hover 預覽（Session 31 修正） ─────────────────────────────────────
  // 不改原卡 transform — 避免邊界抖動、z-index 爭奪、擋住 drop target
  let hoverHandIid = $state<string | null>(null);
  let hoverHandAnchor = $state<{ x: number; y: number } | null>(null);

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

  // ── 硬幣動畫（Session 28） ─────────────────────────────────────────────────
  let coinFlip = $state<null | { result: 'heads' | 'tails'; label: string }>(null);
  let coinTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLogProcessed = 0;

  function showCoinFlip(result: 'heads' | 'tails', label: string) {
    if (coinTimer) clearTimeout(coinTimer);
    coinFlip = { result, label };
    coinTimer = setTimeout(() => { coinFlip = null; coinTimer = null; }, 2200);
  }

  // 監聽 log 新訊息，自動觸發硬幣動畫
  $effect(() => {
    if (!game || !game.log) { lastLogProcessed = 0; return; }
    const logs = game.log;
    if (logs.length <= lastLogProcessed) { lastLogProcessed = logs.length; return; }
    const fresh = logs.slice(lastLogProcessed);
    lastLogProcessed = logs.length;
    // 只取最後一筆觸發硬幣的訊息（避免連續觸發多次）
    for (const entry of fresh) {
      const msg = entry.message;
      if (msg.includes('擲硬幣') && msg.includes('先手')) {
        const winnerName = msg.replace(/^🪙?\s*擲硬幣：\s*/, '').replace(/\s*先手.*$/, '');
        showCoinFlip(Math.random() < 0.5 ? 'heads' : 'tails', `${winnerName} 先手`);
        return;
      }
      if (msg.includes('正面')) {
        showCoinFlip('heads', '擲硬幣：正面');
        return;
      }
      if (msg.includes('反面')) {
        showCoinFlip('tails', '擲硬幣：反面');
        return;
      }
    }
  });

  // ── 拖曳交互（Session 25 A1） ──────────────────────────────────────────────
  type DragKind = 'energy' | 'basic' | 'tool';
  let dragging = $state<null | {
    iid: string; kind: DragKind; cardId: string; cardName: string;
    imageUrl: string;
    x: number; y: number;        // 當前滑鼠位置
    startX: number; startY: number;
    moved: boolean;              // 是否超出門檻視為「拖曳」
  }>(null);
  let dropTargetIid = $state<string | null>(null); // 當前 hover 的 drop target iid（寶可夢）
  let dropBenchEmpty = $state(false);              // 當前 hover 的是否為空備戰格
  const DRAG_THRESHOLD = 6; // px

  function startDrag(e: PointerEvent, inst: CardInstance, kind: DragKind, card: Card) {
    if (e.button !== 0) return;
    // 不在 pointerdown 呼叫 preventDefault —— 那會阻止後續 click 事件觸發，
    // 破壞所有「備戰/附加/使用」按鈕的 fallback 點擊。
    // 瀏覽器原生拖曳/文字選取已由 CSS touch-action:none + user-select:none 阻止。
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
        } else if (type === 'bench-empty') {
          dropTargetIid = null;
          dropBenchEmpty = true;
        } else {
          dropTargetIid = null;
          dropBenchEmpty = false;
        }
      } else {
        dropTargetIid = null;
        dropBenchEmpty = false;
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

  async function onWindowPointerUp(_e: PointerEvent) {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    const tIid = dropTargetIid;
    const benchEmpty = dropBenchEmpty;
    dropTargetIid = null;
    dropBenchEmpty = false;

    if (!d.moved) return; // 單純 click — onclick handler 會處理
    if (!isMyTurn() || pendingSelection) return;

    if (d.kind === 'energy' && tIid) {
      await dispatch(GameActions.attachEnergy(d.iid, tIid));
    } else if (d.kind === 'basic' && benchEmpty) {
      await dispatch(GameActions.playBasic(d.iid));
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
          await dispatch(GameActions.resolveSelection([tIid]));
        } else {
          // validIids 應該保證 tIid 有效（toolAttachEffect 已過濾），
          // 若走到這裡代表 race condition，不 resolve 讓玩家自己選
        }
      }
    }
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
      // 若 zoom 有堆疊，Escape 先彈回上一層，沒堆疊才全關
      if (zoomCard && zoomStack.length > 0) { popZoom(); return; }
      closeZoom(); floatingEvoMenu = null; floatingRetreatMenu = null;
      viewDiscardFor = null; selectionPicked = new Set();
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
      if (g.phase === 'setup') return !g.setupDone[ai];
      if (g.phase !== 'playing') return false;

      // 取獎勵牌或選擇 — 由誰的行動決定
      if (g.pendingPrizes > 0) return g.activePlayerIndex === ai;
      if (g.pendingSelection) return g.pendingSelection.actorIdx === ai;

      // 被擊倒需送出寶可夢
      if (g.turnPhase === 'end' && g.players[ai].active === null) return true;

      // 正常輪到自己
      return g.activePlayerIndex === ai;
    })();

    if (!shouldAct) return;

    const action = getAIAction(game!, pool, aiPlayerIndex);
    if (!action) return;

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
      if (g.phase === 'setup') return !g.setupDone[ai];
      if (g.phase !== 'playing') return false;
      if (g.pendingPrizes > 0) return g.activePlayerIndex === ai;
      if (g.pendingSelection) return g.pendingSelection.actorIdx === ai;
      if (g.turnPhase === 'end' && g.players[ai].active === null) return true;
      return g.activePlayerIndex === ai;
    })();

    if (shouldAct) {
      scheduleAI();
    } else {
      aiThinking = false;
      if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
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
  const evolvableTargets = $derived(game && poolReady ? getEvolvableTargets(game, pool) : []);
  const canRetreatNow    = $derived(game && poolReady ? canRetreat(game, pool) : false);
  const playableTrainerIids = $derived(
    game && poolReady ? new Set(getPlayableTrainers(game, pool)) : new Set<string>()
  );
  const playableBasicIids = $derived(
    game && poolReady ? new Set(getPlayableBasics(game, pool)) : new Set<string>()
  );
  const canEndTurn = $derived(
    game?.phase === 'playing' && game.turnPhase === 'end' && !hasPendingActions(game)
  );
  const usableAbilities = $derived(game && poolReady ? getUsableAbilities(game, pool) : []);
  const stadiumCard = $derived(game?.activeStadium ? pool.get(game.activeStadium.cardId) : null);
  const canUseStadium = $derived(
    game?.phase === 'playing' && game.turnPhase === 'main' &&
    !!game.activeStadium && !game.pendingSelection &&
    !(game.stadiumUsedThisTurn ?? [false,false])[myIdx]
  );

  // ── 視角固定：AI模式/線上模式我方永遠在下方，本機雙人模式隨行動方翻轉 ──────
  // 注意：線上模式必須優先判斷，否則預設 aiPlayerIndex=1 會讓雙方都算成 myIdx=0
  const myIdx   = $derived<0 | 1>(
    mode === 'online' ? ((myPlayerIndex ?? 0) as 0 | 1) :
    aiPlayerIndex !== null ? ((1 - aiPlayerIndex) as 0 | 1) :
    myPlayerIndex !== null ? myPlayerIndex : aIdx
  );
  const oppIdx  = $derived<0 | 1>((1 - myIdx) as 0 | 1);
  const myPlayer  = $derived(game ? game.players[myIdx]  : null);
  const oppPlayer = $derived(game ? game.players[oppIdx] : null);

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
      return game.activePlayerIndex === hIdx && game.pendingPrizes === 0;
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
        if (f === 'Supporter:TOP6') {
          const top6 = new Set<string>((pendingSelection.params?.top6Iids as string[]) ?? []);
          return src.deck.filter(c => top6.has(c.iid) && pool.get(c.cardId)?.subtype === 'Supporter');
        }
        return src.deck.filter(c => {
          const card = pool.get(c.cardId);
          if (!card) return false;
          if (f === 'Basic')      return isBasicPokemonCard(card);
          if (f === 'Basic:HP70') return isBasicPokemonCard(card) && (card.hp ?? 0) <= 70;
          if (f === 'Stage1')     return card.supertype === 'Pokemon' && card.subtype === 'Stage1';
          if (f === 'Pokemon')    return card.supertype === 'Pokemon' && card.subtype !== 'Other';
          if (f === 'Energy')     return card.supertype === 'Energy';
          if (f === 'ex')         return card.supertype === 'Pokemon' && card.subtype === 'ex';
          if (f === 'MegaEx')     return card.supertype === 'Pokemon' && card.subtype === 'ex' && card.name.startsWith('超級');
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
        return items;
      }
      case 'opp-bench-choose': {
        const includeActive = pendingSelection.params?.includeActive === true;
        if (includeActive && src.active) return [src.active, ...src.bench];
        return src.bench;
      }
      case 'hand-discard': {
        const f2 = pendingSelection.filter ?? '';
        if (f2 === 'Energy') return src.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
        return src.hand;
      }
      case 'hand-choose':  {
        const validIids2 = pendingSelection.params?.validIids as string[] | undefined;
        return validIids2 ? src.hand.filter(c => validIids2.includes(c.iid)) : src.hand;
      }
      case 'heal-target':  {
        const all = [...(src.active ? [src.active] : []), ...src.bench];
        const validIids3 = pendingSelection.params?.validIids as string[] | undefined;
        return validIids3 ? all.filter(c => validIids3.includes(c.iid)) : all;
      }
      case 'discard-search': {
        const f = pendingSelection.filter ?? '';
        return src.discard.filter(c => {
          const card = pool.get(c.cardId);
          if (!card) return false;
          if (f === 'PokemonOrEnergy') return (card.supertype === 'Pokemon' && card.subtype !== 'Other') || card.supertype === 'Energy';
          if (f === 'BasicEnergy')     return card.supertype === 'Energy';
          return true;
        });
      }
      default: return [] as CardInstance[];
    }
  });

  const selectionValid = $derived(
    pendingSelection !== null &&
    selectionPicked.size >= pendingSelection.minCount &&
    selectionPicked.size <= pendingSelection.maxCount
  );

  // ── 初始化 ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    decks = loadDecks();
    // 匿名登入（線上對戰需要）
    onAuthStateChanged(auth, u => { myUid = u?.uid ?? null; });
    if (!auth.currentUser) await signInAnonymously(auth);

    const allCards = await loadAllSets();
    pool = buildCardIndex(allCards);
    poolReady = true;

    // 如果 host 在 poolReady 前就收到了 ready 狀態，現在補建遊戲
    checkAndStartOnlineGame();
  });

  onDestroy(() => { unsubRoom?.(); if (aiTimer !== null) clearTimeout(aiTimer); });

  // ── 輔助函式 ────────────────────────────────────────────────────────────────
  function getCard(cardId: string): Card | undefined { return pool.get(cardId); }
  function hpRemaining(inst: CardInstance): number {
    return Math.max(0, (pool.get(inst.cardId)?.hp ?? 0) - inst.damage);
  }
  function energySummary(inst: CardInstance): string {
    const counts = countEnergy(inst, pool);
    if (counts.size === 0) return '無能量';
    return [...counts.entries()].map(([t,n]) => `${ENERGY_LABEL[t]}×${n}`).join(' ');
  }
  function hpColor(rem: number, tot: number): string {
    const p = tot > 0 ? rem/tot : 1;
    return p > 0.5 ? '#2c7a3c' : p > 0.25 ? '#e0a020' : '#c00';
  }
  function retreatCostOf(inst: CardInstance): number {
    const base = getCard(inst.cardId)?.retreatCost?.length ?? 0;
    const tool = inst.toolAttached ? getCard(inst.toolAttached.cardId) : null;
    return tool?.name === '氣球' ? Math.max(0, base - 2) : base;
  }
  function evoOptionsFor(fromIid: string): CardInstance[] {
    const entry = evolvableTargets.find(e => e.fromIid === fromIid);
    if (!entry || !myPlayer) return [];
    return myPlayer.hand.filter(c => entry.toIids.includes(c.iid));
  }

  // ── 動作分派（本機 + 線上共用） ─────────────────────────────────────────────
  async function dispatch(action: ReturnType<typeof GameActions[keyof typeof GameActions]>) {
    if (!game || !poolReady) return;
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

    if (mode === 'online' && roomCode) {
      isSyncing = true;
      try { await pushGameState(roomCode, newState); }
      catch (e) { console.error('[Online] push failed:', e); }
      finally { isSyncing = false; }
    }
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

  // ── 線上 Lobby ───────────────────────────────────────────────────────────────
  async function handleCreateRoom() {
    if (!myName.trim() || !myDeckId) { onlineError = '請填寫名稱和選擇牌組'; return; }
    const deck = allDecks.find(d => d.id === myDeckId);
    if (!deck) return;
    onlineLoading = true; onlineError = '';
    try {
      roomCode = await createRoom(myName.trim(), deck.entries);
      amIHost = true;
      myPlayerIndex = 0;
      onlineStep = 'room';
      startRoomSubscription();
    } catch(e: any) { onlineError = e.message ?? '建立房間失敗'; }
    finally { onlineLoading = false; }
  }

  async function handleJoinRoom() {
    if (!myName.trim() || !myDeckId) { onlineError = '請填寫名稱和選擇牌組'; return; }
    if (!joinInput.trim()) { onlineError = '請輸入房號'; return; }
    const deck = allDecks.find(d => d.id === myDeckId);
    if (!deck) return;
    onlineLoading = true; onlineError = '';
    try {
      await joinRoom(joinInput.trim(), myName.trim(), deck.entries);
      roomCode = joinInput.trim().toUpperCase();
      amIHost = false;
      myPlayerIndex = 1;
      onlineStep = 'room';
      startRoomSubscription();
    } catch(e: any) { onlineError = e.message ?? '加入房間失敗'; }
    finally { onlineLoading = false; }
  }

  function startRoomSubscription() {
    unsubRoom?.();
    unsubRoom = subscribeRoom(roomCode, handleRoomUpdate);
  }

  function handleRoomUpdate(room: Room | null) {
    if (!room) { onlineError = '房間不存在或連線中斷'; return; }
    roomData = room;

    // Host 看到 guest 已加入 → 建立遊戲並推送
    if (amIHost && room.status === 'ready' && !room.gameState) {
      checkAndStartOnlineGame();
    }

    // 兩邊收到 gameState → 更新畫面
    if (room.gameState) {
      game = room.gameState;
    }
  }

  function checkAndStartOnlineGame() {
    if (!amIHost || !poolReady || !roomData) return;
    if (roomData.status !== 'ready' || roomData.gameState) return;
    if (!roomData.guestDeckEntries || !roomData.guestName) return;

    const newGame = createGame(
      { name: roomData.hostName, entries: roomData.hostDeckEntries },
      { name: roomData.guestName, entries: roomData.guestDeckEntries },
      pool
    );
    game = newGame;
    pushGameState(roomCode, newGame).catch(console.error);
  }

  function leaveOnlineGame() {
    unsubRoom?.(); unsubRoom = null;
    game = null; roomCode = ''; roomData = null;
    onlineStep = 'choose'; onlineError = ''; myPlayerIndex = null;
    mode = null;
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
  function confirmSelection() {
    if (!selectionValid) return;
    dispatch(GameActions.resolveSelection([...selectionPicked]));
    selectionPicked = new Set();
  }
  function selectionTitle(type: string): string {
    if (type === 'deck-search')     return '從牌庫選擇';
    if (type === 'bench-choose')    return '選擇備戰寶可夢';
    if (type === 'opp-bench-choose') return '選擇對手的備戰寶可夢';
    if (type === 'opp-poke-choose') return '選擇對手的寶可夢';
    if (type === 'hand-discard')    return '選擇丟棄的手牌';
    if (type === 'hand-choose')     return '從手牌選擇';
    if (type === 'heal-target')     return '選擇回復的寶可夢';
    if (type === 'discard-search')  return '從棄牌區選擇';
    return '請選擇';
  }
</script>

<svelte:window onkeydown={onGlobalKey} onpointermove={onWindowPointerMove} onpointerup={onWindowPointerUp} />

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
    {#if !aiPlayerIndex && p1DeckId === p2DeckId && p1DeckId}<p class="warn">雙人模式下兩位玩家請選不同的牌組</p>{/if}
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
        <h2>建立房間（你是先手）</h2>
        <label>你的名稱<input class="name-input" placeholder="輸入名稱" bind:value={myName} /></label>
        <label>選擇牌組
          <select bind:value={myDeckId}>
            <option value="">— 選擇 —</option>
            {#if PRESET_DECKS.length > 0}
              <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
            {/if}
            {#if decks.length > 0}
              <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
            {/if}
          </select>
        </label>
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
        <h2>加入房間（你是後手）</h2>
        <label>房號（4碼）<input class="name-input code-input" placeholder="XXXX" maxlength="4" bind:value={joinInput} /></label>
        <label>你的名稱<input class="name-input" placeholder="輸入名稱" bind:value={myName} /></label>
        <label>選擇牌組
          <select bind:value={myDeckId}>
            <option value="">— 選擇 —</option>
            {#if PRESET_DECKS.length > 0}
              <optgroup label="🎴 內建預組">{#each PRESET_DECKS as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
            {/if}
            {#if decks.length > 0}
              <optgroup label="📁 我的牌組">{#each decks as d}<option value={d.id}>{d.name}</option>{/each}</optgroup>
            {/if}
          </select>
        </label>
        {#if onlineError}<p class="warn">{onlineError}</p>{/if}
        <div class="form-btns">
          <button class="btn-primary" onclick={handleJoinRoom} disabled={onlineLoading}>
            {onlineLoading ? '加入中…' : '加入房間'}
          </button>
          <button class="btn-secondary" onclick={() => { onlineStep='choose'; onlineError=''; }}>取消</button>
        </div>
      </div>

    {:else if onlineStep === 'room'}
      <!-- 等待室 -->
      <div class="room-waiting">
        {#if amIHost}
          <div class="room-code-display">
            <div class="room-code-label">你的房號</div>
            <div class="room-code-value">{roomCode}</div>
            <div class="room-code-hint">把這個房號告訴對手</div>
          </div>
          {#if roomData?.guestName}
            <p class="join-notice">✅ <strong>{roomData.guestName}</strong> 已加入！正在準備遊戲…</p>
          {:else}
            <p class="muted waiting-pulse">等待對手加入房間…</p>
          {/if}
        {:else}
          <div class="room-code-display guest">
            <div class="room-code-label">已加入房間</div>
            <div class="room-code-value">{roomCode}</div>
          </div>
          <p class="muted waiting-pulse">等待 <strong>{roomData?.hostName ?? '主場'}</strong> 開始遊戲…</p>
        {/if}
        <button class="btn-secondary" onclick={leaveOnlineGame}>離開房間</button>
      </div>
    {/if}
  </main>
  {/if}

<!-- ══════════════════════════════════════════════════════════════════════
     遊戲結束
  ══════════════════════════════════════════════════════════════════════ -->
{:else if game.phase === 'game-over'}
  {@const isWin = mode !== 'online' || myPlayerIndex === game.winner}
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
      <div class="lobby-btns" in:fade={{ duration: 400, delay: 900 }}>
        <button class="btn-primary" onclick={() => { game = null; if (mode === 'online') leaveOnlineGame(); }}>
          {mode === 'online' ? '離開房間' : '再來一局'}
        </button>
        <a href="{base}/" class="btn-secondary">回首頁</a>
      </div>
    </div>
  </main>

<!-- ══════════════════════════════════════════════════════════════════════
     Setup 畫面
  ══════════════════════════════════════════════════════════════════════ -->
{:else if game.phase === 'setup'}
  {@const setupIdx = (
    mode === 'online' && myPlayerIndex !== null
      ? myPlayerIndex
      : (aiPlayerIndex !== null && !game.setupDone[(1 - aiPlayerIndex) as 0 | 1]
          ? ((1 - aiPlayerIndex) as 0 | 1)
          : (!game.setupDone[0] ? 0 : 1))
  ) as 0 | 1}
  {@const setupPlayer = game.players[setupIdx]}
  {@const iAmDone = game.setupDone[setupIdx]}
  {@const waitingForOpp = iAmDone && !game.setupDone[(1 - setupIdx) as 0 | 1]}

  <main class="setup-screen">
    {#if game.mulliganCounts && (game.mulliganCounts[0] > 0 || game.mulliganCounts[1] > 0)}
      <div class="mulligan-banner" in:scale={{ duration: 350, start: 0.7 }}>
        <span class="shuffle-ic">🔄</span> Mulligan：
        {#if game.mulliganCounts[0] > 0}{game.players[0].name} 重抽 {game.mulliganCounts[0]} 次（對手多抽 {game.mulliganCounts[0]} 張）　{/if}
        {#if game.mulliganCounts[1] > 0}{game.players[1].name} 重抽 {game.mulliganCounts[1]} 次（對手多抽 {game.mulliganCounts[1]} 張）{/if}
      </div>
    {/if}
    {#if waitingForOpp}
      <h2>⏳ 等待對手完成準備…</h2>
      <p class="muted">你已完成設置，等待 {game.players[(1 - setupIdx) as 0 | 1].name} 選出場寶可夢。</p>
    {:else}
      <h2>🃏 {setupPlayer.name} — 選出場寶可夢</h2>
      <p class="muted">從起始手牌選出 1 隻基礎寶可夢作為出場，再選備戰區（最多 5 隻），完成後按「準備完成」。</p>
      {#if mode !== 'online' && aiPlayerIndex === null}
        <p class="muted"><small>（本機雙人：雙方依序設置；對方已完成後再輪到另一方）</small></p>
      {/if}

      {#if setupPlayer.active}
        {@const ac = getCard(setupPlayer.active.cardId)}
        <div class="setup-active">
          <strong>出場：</strong>
          <span class="poke-chip active-chip">{ac?.name ?? '?'} (HP {ac?.hp})</span>
          <button class="small danger" onclick={() => dispatch(GameActions.placeActive(setupPlayer.active!.iid, setupIdx))}>換出場</button>
        </div>
      {/if}
      {#if setupPlayer.bench.length > 0}
        <div class="setup-bench-row">
          <strong>備戰：</strong>
          {#each setupPlayer.bench as b}{@const bc=getCard(b.cardId)}<span class="poke-chip bench-chip">{bc?.name??'?'}</span>{/each}
        </div>
      {/if}

      <h3>手牌</h3>
      <div class="hand-grid">
        {#each setupPlayer.hand as inst, i (inst.iid)}
          {@const c = getCard(inst.cardId)}
          {#if c}
            <div class="hand-card" class:selectable={isBasicPokemonCard(c)}
              in:fly={{ x: 220, y: -30, duration: 420, delay: i * 80, easing: cubicOut }}
              out:fly={{ y: -160, duration: 260 }}>
              <img src={c.imageUrl} alt={c.name} onclick={() => openZoom(inst.cardId)} class="zoomable" />
              <div class="hand-card-name">{c.name}</div>
              {#if isBasicPokemonCard(c)}
                {#if !setupPlayer.active}
                  <button class="small primary" onclick={() => dispatch(GameActions.placeActive(inst.iid, setupIdx))}>出場</button>
                {:else if setupPlayer.bench.length < 5}
                  <button class="small" onclick={() => dispatch(GameActions.benchPokemon(inst.iid, setupIdx))}>備戰</button>
                {/if}
              {:else}
                <span class="card-type-tag">{c.supertype}</span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
      <button class="btn-primary" disabled={!setupPlayer.active} onclick={() => dispatch(GameActions.finishSetup(setupIdx))}>✅ 準備完成</button>
    {/if}
  </main>

<!-- ══════════════════════════════════════════════════════════════════════
     正式對戰（Play Mat 佈局）
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
    <span class="phase-tag">
      {#if game.turnPhase === 'draw'}📥 抽牌
      {:else if game.turnPhase === 'main'}🎮 主階段
      {:else}⏭ 回合結束{/if}
    </span>
    <span class="status-chips">
      {#if mode === 'online' && myPlayerIndex !== null}
        <span class="chip role-chip">{myPlayerIndex === 0 ? '我是 P1 先手' : '我是 P2 後手'}</span>
        {#if isSyncing}<span class="chip syncing-chip">⏳ 同步中</span>{/if}
        {#if !isMyTurn() && !isMyDefenderTurn()}<span class="chip wait-chip">等待對手行動</span>{/if}
      {/if}
      {#if aiPlayerIndex !== null && aiThinking}<span class="chip ai-chip">🤖 AI 思考中…</span>{/if}
      {#if stadiumCard}<span class="chip stadium-chip">🏟 {stadiumCard.name}</span>{/if}
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
  <div class="playmat">

    <!-- 對手場地（永遠在上方） -->
    <div class="field-row opponent-row">
      <div class="zone-pile">
        <div class="pile-slot deck-pile">
          <span class="pile-icon">🃏</span>
          <span class="pile-count">{oppPlayer?.deck.length??0}</span>
          <span class="pile-label">牌庫</span>
        </div>
        <div class="pile-slot disc-pile" onclick={() => viewDiscardFor = oppIdx} title="查看對手棄牌區">
          <span class="pile-icon">🗑</span>
          <span class="pile-count">{oppPlayer?.discard.length??0}</span>
          <span class="pile-label">棄牌</span>
        </div>
      </div>
      <div class="zone-bench">
        {#each Array(5) as _, i}
          {#if oppPlayer?.bench[i]}
            {@const b=oppPlayer.bench[i]}{@const bc=getCard(b.cardId)}
            <div class="bench-slot">
              <img src={bc?.imageUrl} alt={bc?.name} onclick={()=>openZoom(b.cardId,b)} class="zoomable"/>
              <div class="hp-bar-wrap sm"><div class="hp-bar" style="width:{bc?.hp?hpRemaining(b)/bc.hp*100:0}%;background:{hpColor(hpRemaining(b),bc?.hp??0)}"></div></div>
              <div class="bench-name">{bc?.name}</div>
              <div class="bench-stat">HP {hpRemaining(b)}/{bc?.hp}</div>
              {#if b.toolAttached}{@const tc3=getCard(b.toolAttached.cardId)}<div class="tool-chip sm">🔧{tc3?.name}</div>{/if}
              {#if b.abilityUsedThisTurn}<div class="ab-used-chip sm" title="本回合已使用特性">✨</div>{/if}
              {#if b.status}<div class="status-chip-sm status-{b.status}">{
                b.status === 'poisoned' ? '☠️' :
                b.status === 'burned' ? '🔥' :
                b.status === 'asleep' ? '💤' :
                b.status === 'confused' ? '😵' : '⚡'
              }</div>{/if}
            </div>
          {:else}<div class="bench-slot bench-empty"></div>{/if}
        {/each}
      </div>
      <div class="zone-active">
        <div class="zone-label-sm opp-label">對手出場</div>
        {#if oppPlayer?.active}
          {@const ac=getCard(oppPlayer.active.cardId)}
          <div class="active-card opp-active">
            <img src={ac?.imageUrl} alt={ac?.name} class="active-img zoomable" onclick={()=>openZoom(oppPlayer!.active!.cardId,oppPlayer!.active)}/>
            <div class="active-info">
              <div class="active-name">{ac?.name}</div>
              <div class="hp-bar-wrap"><div class="hp-bar" style="width:{ac?.hp?hpRemaining(oppPlayer.active)/ac.hp*100:0}%;background:{hpColor(hpRemaining(oppPlayer.active),ac?.hp??0)}"></div></div>
              <div class="active-hp">HP {hpRemaining(oppPlayer.active)}/{ac?.hp}</div>
              <div class="active-nrg">{energySummary(oppPlayer.active)}</div>
              {#if oppPlayer.active.toolAttached}{@const tc=getCard(oppPlayer.active.toolAttached.cardId)}<div class="tool-chip">🔧{tc?.name}</div>{/if}
              {#if oppPlayer.active.abilityUsedThisTurn}<div class="ab-used-chip" title="本回合已使用特性">✨已用特性</div>{/if}
              {#if oppPlayer.active.status}<div class="status-chip status-{oppPlayer.active.status}">{
                oppPlayer.active.status === 'poisoned' ? '☠️ 中毒' :
                oppPlayer.active.status === 'burned' ? '🔥 燒傷' :
                oppPlayer.active.status === 'asleep' ? '💤 睡眠' :
                oppPlayer.active.status === 'confused' ? '😵 混亂' :
                oppPlayer.active.status === 'paralyzed' ? '⚡ 麻痺' : oppPlayer.active.status
              }</div>{/if}
            </div>
          </div>
        {:else}<div class="active-card active-empty">（無出場）</div>{/if}
      </div>
      <div class="zone-prizes">
        <div class="prize-grid">
          {#each Array(6) as _, i}<div class="prize-card" class:prize-gone={i>=(oppPlayer?.prizes.length??0)}></div>{/each}
        </div>
        <div class="zone-label-sm">獎勵 {oppPlayer?.prizes.length??0}張</div>
      </div>
    </div>

    <!-- 中間行動列 -->
    <div class="action-bar">
      <div class="alerts-col">
        {#if pendingPrizes > 0 && isMyTurn()}
          <div class="alert prize-alert">
            🏆 取 {pendingPrizes} 張獎勵牌
            <button class="btn-xs primary" onclick={()=>dispatch(GameActions.takePrizes(pendingPrizes))}>取得</button>
          </div>
        {/if}
        {#if game.phase==='playing' && defenderPlayer?.active===null && game.turnPhase==='end'}
          {#if isMyDefenderTurn()}
            <div class="alert warn-alert">
              ⚠️ 請送出寶可夢
              <div class="mini-row">
                {#each defenderPlayer?.bench??[] as b}
                  {@const bc=getCard(b.cardId)}
                  <button class="mini-poke-btn" onclick={()=>dispatch(GameActions.sendNewActive(b.iid, dIdx))}>
                    <img src={bc?.imageUrl} alt={bc?.name}/><span>{bc?.name}</span>
                  </button>
                {/each}
              </div>
            </div>
          {:else if isMyTurn()}
            <div class="alert warn-alert">⚠️ 等待 {defenderPlayer?.name} 送出寶可夢</div>
          {/if}
        {/if}
      </div>

      <div class="action-btns">
        {#if isMyTurn()}
          {#if game.turnPhase==='main' && activePlayer?.active}
            {@const ac=getCard(activePlayer.active.cardId)}
            {#each ac?.attacks??[] as atk,i}
              <button class="btn-act atk" class:atk-ready={availableAttacks.includes(i)}
                disabled={!availableAttacks.includes(i)||!!pendingSelection}
                onclick={()=>dispatch(GameActions.attack(i))}>
                <span class="cost-row">{#each atk.cost as e}<span class="epip" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>{/each}</span>
                <span class="atk-name">{atk.name}</span>
                <span class="atk-dmg">{atk.damage||'—'}</span>
              </button>
            {/each}
            <button class="btn-act secondary" disabled={!!pendingSelection}
              onclick={()=>{if(game)game={...game,turnPhase:'end'};}}>跳過攻擊 →</button>
          {/if}
          {#if canUseStadium && isMyTurn()}
            <button class="btn-act stadium-btn" onclick={()=>dispatch(GameActions.useStadium())}>
              🏟 {stadiumCard?.name}
            </button>
          {/if}
          {#if canEndTurn}
            <button class="btn-act primary" onclick={()=>dispatch(GameActions.endTurn())}>⏭ 結束回合</button>
          {/if}
        {:else}
          <span class="waiting-msg">⏳ 等待 {game.players[aIdx].name} 行動…</span>
        {/if}
      </div>

      <div class="log-col">
        {#each [...(game.log??[])].reverse().slice(0,12) as entry}
          <div class="log-line" class:log-sys={entry.playerIndex===null}>{entry.message}</div>
        {/each}
      </div>
    </div>

    <!-- 我方場地（永遠在下方） -->
    <div class="field-row my-row">
      <div class="zone-prizes">
        <div class="zone-label-sm">獎勵 {myPlayer?.prizes.length??0}張</div>
        <div class="prize-grid">
          {#each Array(6) as _, i}<div class="prize-card my-prize" class:prize-gone={i>=(myPlayer?.prizes.length??0)}></div>{/each}
        </div>
      </div>

      <div class="zone-active my-active-zone">
        <div class="zone-label-sm">
          我的出場
          {#if canRetreatNow&&!pendingSelection&&isMyTurn()}
            <button class="btn-retreat" onclick={(e)=>openFloatingRetreat(e)}>
              撤退（{retreatCostOf(myPlayer!.active!)}⚡）
            </button>
          {/if}
        </div>
        {#if myPlayer?.active}
          {@const ac=getCard(myPlayer.active.cardId)}
          {@const evoOpts=evoOptionsFor(myPlayer.active.iid)}
          <div class="active-card mine-active"
            class:energy-target={selectedEnergyIid!==null&&!pendingSelection&&isMyTurn()}
            class:drop-zone={(dragging?.kind==='energy'||dragging?.kind==='tool')&&isMyTurn()}
            class:drop-hover={dropTargetIid===myPlayer.active.iid}
            class:energy-pulse={energyAttachPulse===myPlayer.active.iid}
            data-drop-type="poke"
            data-drop-iid={myPlayer.active.iid}
            onclick={()=>selectedEnergyIid&&!pendingSelection&&isMyTurn()&&onAttachEnergy(myPlayer!.active!.iid)}>
            <img src={ac?.imageUrl} alt={ac?.name} class="active-img"
              class:zoomable={!selectedEnergyIid}
              onclick={(e)=>{if(!selectedEnergyIid){e.stopPropagation();openZoom(myPlayer!.active!.cardId,myPlayer!.active);}}}/>
            <div class="active-info">
              <div class="active-name">{ac?.name}</div>
              <div class="hp-bar-wrap"><div class="hp-bar" style="width:{ac?.hp?hpRemaining(myPlayer.active)/ac.hp*100:0}%;background:{hpColor(hpRemaining(myPlayer.active),ac?.hp??0)}"></div></div>
              <div class="active-hp">HP {hpRemaining(myPlayer.active)}/{ac?.hp}</div>
              <div class="active-nrg">{energySummary(myPlayer.active)}</div>
              {#if myPlayer.active.toolAttached}{@const tc=getCard(myPlayer.active.toolAttached.cardId)}<div class="tool-chip">🔧{tc?.name}</div>{/if}
              {#if myPlayer.active.abilityUsedThisTurn}<div class="ab-used-chip" title="本回合已使用特性">✨已用特性</div>{/if}
              {#if myPlayer.active.status}<div class="status-chip status-{myPlayer.active.status}">{
                myPlayer.active.status === 'poisoned' ? '☠️ 中毒' :
                myPlayer.active.status === 'burned' ? '🔥 燒傷' :
                myPlayer.active.status === 'asleep' ? '💤 睡眠' :
                myPlayer.active.status === 'confused' ? '😵 混亂' :
                myPlayer.active.status === 'paralyzed' ? '⚡ 麻痺' : myPlayer.active.status
              }</div>{/if}
              {#if selectedEnergyIid&&!pendingSelection&&isMyTurn()}<div class="attach-hint">⚡ 點此附加</div>{/if}
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
          <div class="active-card active-empty">（無出場）</div>
        {/if}
      </div>

      <div class="zone-bench">
        {#each Array(5) as _, i}
          {#if myPlayer?.bench[i]}
            {@const b=myPlayer.bench[i]}{@const bc=getCard(b.cardId)}{@const evoOptsB=evoOptionsFor(b.iid)}
            <div class="bench-slot"
              class:energy-target={selectedEnergyIid!==null&&!pendingSelection&&isMyTurn()}
              class:drop-zone={(dragging?.kind==='energy'||dragging?.kind==='tool')&&isMyTurn()}
              class:drop-hover={dropTargetIid===b.iid}
              class:energy-pulse={energyAttachPulse===b.iid}
              data-drop-type="poke"
              data-drop-iid={b.iid}
              onclick={()=>selectedEnergyIid&&!pendingSelection&&isMyTurn()&&onAttachEnergy(b.iid)}>
              <img src={bc?.imageUrl} alt={bc?.name}
                class:zoomable={!selectedEnergyIid}
                onclick={(e)=>{if(!selectedEnergyIid){e.stopPropagation();openZoom(b.cardId,b);}}}/>
              <div class="hp-bar-wrap sm"><div class="hp-bar" style="width:{bc?.hp?hpRemaining(b)/bc.hp*100:0}%;background:{hpColor(hpRemaining(b),bc?.hp??0)}"></div></div>
              <div class="bench-name">{bc?.name}</div>
              <div class="bench-stat">HP {hpRemaining(b)}/{bc?.hp}</div>
              <div class="bench-nrg">{energySummary(b)}</div>
              {#if b.toolAttached}{@const tc2=getCard(b.toolAttached.cardId)}<div class="tool-chip sm">🔧{tc2?.name}</div>{/if}
              {#if b.abilityUsedThisTurn}<div class="ab-used-chip sm" title="本回合已使用特性">✨</div>{/if}
              {#if b.status}<div class="status-chip-sm status-{b.status}">{
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
            </div>
          {:else}
            <div class="bench-slot bench-empty"
              class:drop-zone={dragging?.kind==='basic'&&isMyTurn()&&(myPlayer?.bench.length??0)<5}
              class:drop-hover={dropBenchEmpty&&dragging?.kind==='basic'}
              data-drop-type="bench-empty"></div>
          {/if}
        {/each}
      </div>

      <div class="zone-pile">
        <div class="pile-slot deck-pile">
          <span class="pile-icon">🃏</span>
          <span class="pile-count">{myPlayer?.deck.length??0}</span>
          <span class="pile-label">牌庫</span>
        </div>
        <div class="pile-slot disc-pile" onclick={() => viewDiscardFor = myIdx} title="查看我的棄牌區">
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
    <div class="hand-scroll" class:is-dragging={!!dragging?.moved}>
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
          {@const isTrainerCard=c.supertype==='Trainer'}
          {@const isToolCard=c.supertype==='Pokemon'&&c.subtype==='Other'}
          {@const canEnergy=isEnergyCard&&game?.turnPhase==='main'&&!myPlayer?.energyAttachedThisTurn&&!pendingSelection&&isMyTurn()}
          {@const canBasic=isBasicCard&&playableBasicIids.has(inst.iid)&&isMyTurn()}
          {@const canTrainer=(isTrainerCard||isToolCard)&&playableTrainerIids.has(inst.iid)&&isMyTurn()}
          {@const dragKind = canEnergy ? 'energy' : canBasic ? 'basic' : (canTrainer && isToolCard) ? 'tool' : null}
          <div class="hand-card"
            class:selected={selectedEnergyIid===inst.iid}
            class:can-energy={canEnergy}
            class:can-basic={canBasic}
            class:can-trainer={canTrainer}
            class:dragging={dragging?.iid===inst.iid}
            class:draggable={dragKind!==null}
            class:hover-peek={hoverHandIid===inst.iid}
            style="--fan-rot:{rot}deg;--fan-lift:{liftY}px;"
            in:fly={{ x: 260, y: -40, duration: 380, delay: i * 70, easing: cubicOut }}
            out:fly={{ y: -220, duration: 260, easing: cubicOut }}
            onpointerenter={(e)=>enterHandCard(e, inst.iid)}
            onpointerleave={leaveHandCard}
            onpointerdown={(e)=>{leaveHandCard(); if(dragKind)startDrag(e, inst, dragKind, c);}}
            onclick={()=>{if(canEnergy && !dragging)selectedEnergyIid=selectedEnergyIid===inst.iid?null:inst.iid;}}
            title={dragKind?`拖曳到目標 · ${c.name}`:c.name}>
            <img src={c.imageUrl} alt={c.name}
              class:zoomable={!canEnergy}
              onclick={(e)=>{if(!canEnergy){e.stopPropagation();openZoom(inst.cardId);}}}/>
            <span class="hand-name">{c.name}</span>
            {#if canEnergy}<span class="hand-hint energy-hint">⚡ 拖曳附加</span>
            {:else if canBasic}<button class="hand-btn basic-btn" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.playBasic(inst.iid));}}>備戰</button>
            {:else if canTrainer && isToolCard}<button class="hand-btn tool-btn" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.playTrainer(inst.iid));}}>🔧 附加</button>
            {:else if canTrainer}<button class="hand-btn trainer-btn" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.playTrainer(inst.iid));}}>{c.subtype==='Supporter'?'支援者':c.subtype==='Stadium'?'競技場':'使用'}</button>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>

  <!-- PendingSelection -->
  {#if pendingSelection}
    <div class="selection-overlay">
      <div class="selection-modal">
        <div class="sel-header">
          <h3>{selectionTitle(pendingSelection.type)}</h3>
          <p class="sel-hint">
            選 {pendingSelection.minCount===pendingSelection.maxCount?`${pendingSelection.minCount}`:`${pendingSelection.minCount}～${pendingSelection.maxCount}`} 張
            {#if pendingSelection.filter&&pendingSelection.filter!=='TOP6'&&!pendingSelection.filter.startsWith('Supporter')}（{pendingSelection.filter.replace('Basic:HP70','HP≤70基礎').replace('Basic','基礎寶可夢').replace('Pokemon','寶可夢').replace('Energy','能量')}）{/if}
            · 已選 {selectionPicked.size}
          </p>
        </div>
        <div class="sel-grid">
          {#each selectionItems as item}{@const c=getCard(item.cardId)}
            {#if c}
              <button class="sel-card" class:sel-picked={selectionPicked.has(item.iid)} onclick={()=>toggleSelection(item.iid)}>
                <img src={c.imageUrl} alt={c.name}/><span class="sel-name">{c.name}</span>
                {#if c.hp}<span class="sel-hp">HP{c.hp}</span>{/if}
                {#if selectionPicked.has(item.iid)}<span class="sel-check">✓</span>{/if}
              </button>
            {/if}
          {/each}
          {#if selectionItems.length===0}<p class="sel-empty">（沒有符合條件的卡牌）</p>{/if}
        </div>
        <div class="sel-footer">
          <button class="btn-act primary" disabled={!selectionValid} onclick={confirmSelection}>確定（{selectionPicked.size}張）</button>
          {#if pendingSelection.minCount===0}
            <button class="btn-act secondary" onclick={()=>{selectionPicked=new Set();confirmSelection();}}>不選（跳過）</button>
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

  <!-- Floating Retreat Menu -->
  {#if floatingRetreatMenu && myPlayer?.active}
    <div class="float-evo-backdrop" onclick={() => floatingRetreatMenu = null}></div>
    <div class="float-evo-menu" style="left:{floatingRetreatMenu.x}px;top:{floatingRetreatMenu.y}px;">
      <div class="float-evo-title">🔄 選擇換入</div>
      {#each myPlayer.bench as b}{@const bc=getCard(b.cardId)}
        <button class="evo-choice wide-evo" onclick={(e)=>{e.stopPropagation();dispatch(GameActions.retreat(b.iid));floatingRetreatMenu=null;}}>
          <img src={bc?.imageUrl} alt={bc?.name}/><span>{bc?.name}</span>
        </button>
      {/each}
      <button class="evo-choice wide-evo" style="justify-content:center;color:#faa;" onclick={()=>floatingRetreatMenu=null}>取消</button>
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

  <!-- Zoom -->
  {#if zoomCard}
    <div class="zoom-overlay" onclick={closeZoom}>
      <div class="zoom-modal" onclick={(e)=>e.stopPropagation()}>
        {#if zoomStack.length > 0}
          <button class="zoom-back" onclick={popZoom} title="返回上一層">← 返回</button>
        {/if}
        <button class="zoom-close" onclick={closeZoom}>✕</button>
        <div class="zoom-body">
          <img src={zoomCard.imageUrl} alt={zoomCard.name} class="zoom-img"/>
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
              {@const instHp = (zoomCard.hp ?? 0) - zoomInst.damage}
              {@const toolC = zoomInst.toolAttached ? getCard(zoomInst.toolAttached.cardId) : null}
              <div class="zoom-state">
                <div class="state-title">📍 場上狀態</div>
                {#if zoomCard.hp}
                  <div class="state-row">
                    <span class="state-k">HP</span>
                    <span class="state-v">{instHp} / {zoomCard.hp}{#if zoomInst.damage>0}（傷害 {zoomInst.damage}）{/if}</span>
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
              <div class="zoom-attack">
                <div class="atk-header">
                  <span class="cost-row">{#each atk.cost as e}<span class="epip" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>{/each}{#if atk.cost.length===0}<span class="no-cost">無消耗</span>{/if}</span>
                  <span class="atk-nm">{atk.name}</span><span class="atk-dp">{atk.damage||'—'}</span>
                </div>
                {#if atk.text}<p class="effect-text">{atk.text}</p>{/if}
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

</div>
{/if}

<style>
  :global(body){ margin:0; background:#162816; }

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

  /* 等待室 */
  .room-waiting{ display:flex; flex-direction:column; align-items:center; gap:1.25rem; padding:2rem; }
  .room-code-display{ text-align:center; background:#1e2e1e; border:1px solid #3a5a3a; border-radius:12px; padding:1.5rem 2rem; }
  .room-code-display.guest{ border-color:#4a5a8a; background:#1e1e2e; }
  .room-code-label{ font-size:0.85rem; color:#888; margin-bottom:0.3rem; }
  .room-code-value{ font-size:3rem; font-weight:900; letter-spacing:0.3em; color:#aaffaa; font-family:monospace; }
  .room-code-hint{ font-size:0.8rem; color:#666; margin-top:0.5rem; }
  .join-notice{ color:#aaffaa; font-size:0.95rem; }
  .waiting-pulse{ animation:pulse-opacity 2s ease-in-out infinite; }
  @keyframes pulse-opacity{ 0%,100%{opacity:1}50%{opacity:0.5} }

  .btn-primary{ display:inline-block; background:#2a7a2a; color:#fff; border:none; border-radius:8px; padding:0.6rem 1.4rem; font:inherit; font-size:1rem; font-weight:600; cursor:pointer; text-decoration:none; }
  .btn-primary:hover:not(:disabled){ background:#3a9a3a; }
  .btn-primary:disabled{ opacity:0.4; cursor:not-allowed; }
  .btn-secondary{ display:inline-block; background:#2a3a5a; color:#ccddff; border:1px solid #4a5a8a; border-radius:8px; padding:0.5rem 1.2rem; font:inherit; cursor:pointer; text-decoration:none; }
  .lobby-btns{ display:flex; gap:1rem; margin-top:1.5rem; align-items:center; }
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
  .battle-root{ height:100vh; display:flex; flex-direction:column; font-family:system-ui,'Microsoft JhengHei',sans-serif; color:#f0f0f0; overflow:hidden; }

  .battle-header{ display:flex; align-items:center; gap:0.6rem; background:#0a180a; padding:0.35rem 0.75rem; border-bottom:1px solid #2a4a2a; flex-shrink:0; flex-wrap:wrap; }
  .small-back{ color:#88ccff; text-decoration:none; font-size:0.82rem; background:none; border:none; cursor:pointer; padding:0; }
  .small-back:hover{ text-decoration:underline; }
  .turn-info{ flex:1; font-size:0.88rem; }
  .hint{ color:#888; font-size:0.75rem; }
  .phase-tag{ font-size:0.78rem; color:#aaffaa; background:#0e2e0e; padding:0.18rem 0.5rem; border-radius:4px; }
  .status-chips{ display:flex; gap:0.3rem; flex-wrap:wrap; }
  .chip{ font-size:0.68rem; padding:0.1rem 0.35rem; border-radius:10px; background:#1a3a1a; color:#8f8; border:1px solid #2a5a2a; }
  .role-chip{ background:#1a1a3a; color:#aaf; border-color:#2a2a5a; }
  .wait-chip{ background:#3a2a1a; color:#fa8; border-color:#5a3a1a; }
  .syncing-chip{ background:#3a3a1a; color:#ff8; border-color:#5a5a1a; }
  .waiting-msg{ color:#fa8; font-size:0.85rem; font-style:italic; }
  .turn-res{ display:flex; gap:0.3rem; align-items:center; margin-left:auto; }
  .res-item{ display:flex; align-items:center; gap:.2rem; padding:.15rem .4rem; border-radius:4px; background:#0e3a1e; border:1px solid #2a6a3a; font-size:.7rem; color:#9fa; }
  .res-item.res-used{ background:#3a0e0e; border-color:#6a2a2a; color:#faa; opacity:.75; }
  .res-ic{ font-size:.78rem; }
  .res-lb{ font-weight:600; }
  .res-st{ font-size:.62rem; opacity:.85; padding-left:.15rem; border-left:1px solid rgba(255,255,255,.15); margin-left:.15rem; }

  .playmat{ flex:1; display:grid; grid-template-rows:1fr auto 1fr; overflow:hidden; position:relative;
    background:
      radial-gradient(circle at 50% 50%, rgba(80,130,90,.12), transparent 72%),
      repeating-linear-gradient(45deg, rgba(0,0,0,.05) 0 2px, transparent 2px 8px),
      linear-gradient(180deg,rgba(0,60,0,.28) 0%,rgba(0,40,0,.1) 48%,rgba(0,0,0,.55) 50%,rgba(0,40,0,.1) 52%,rgba(0,60,0,.28) 100%),
      linear-gradient(135deg,#1e3a20,#1a2e1a); }
  .playmat::before{ content:''; position:absolute; left:50%; top:50%; width:84%; height:66%; transform:translate(-50%,-50%); border:2px dashed rgba(120,170,120,.12); border-radius:16px; pointer-events:none; }

  .field-row{ display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.7rem; overflow:hidden; min-height:0; }
  .opponent-row{ border-bottom:2px solid #2a5a2a; background:rgba(0,0,0,.2); align-items:flex-end; padding-bottom:0.6rem; }
  .my-row{ border-top:2px solid #2a5a2a; align-items:flex-start; padding-top:0.6rem; }

  .zone-prizes{ flex-shrink:0; display:flex; flex-direction:column; align-items:center; gap:0.2rem; }
  .prize-grid{ display:grid; grid-template-columns:1fr 1fr; gap:3px; }
  .prize-card{ width:32px; height:45px; background:linear-gradient(135deg,#1e4a8a,#2a6ab0); border:1px solid #4a8ac0; border-radius:4px; }
  .prize-card.my-prize{ background:linear-gradient(135deg,#2a6a1a,#3a8a2a); border-color:#5aaa4a; }
  .prize-card.prize-gone{ background:transparent; border-color:#2a3a2a; opacity:.25; }
  .zone-label-sm{ font-size:.62rem; color:#888; text-align:center; white-space:nowrap; }
  .opp-label{ color:#aa8888; }

  .zone-active{ flex-shrink:0; width:300px; display:flex; flex-direction:column; gap:0.2rem; }
  .my-active-zone{ position:relative; }
  .active-card{ display:flex; gap:0.5rem; background:rgba(0,0,0,.35); border:1px solid #3a5a3a; border-radius:8px; padding:0.6rem; align-items:flex-start; position:relative; cursor:default; min-height:130px; }
  .active-card.opp-active{ border-color:#5a3a3a; background:rgba(0,0,0,.4); }
  .active-card.mine-active{ border-color:#3a6a3a; }
  .active-card.energy-target{ border-color:#aaff44; cursor:pointer; animation:glow 1s infinite alternate; }
  .active-card.active-empty{ justify-content:center; align-items:center; color:#555; font-size:.85rem; }
  .active-img{ width:120px; border-radius:5px; flex-shrink:0; }
  .active-info{ flex:1; min-width:0; }
  .active-name{ font-size:1rem; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:.2rem; }
  .active-hp{ font-size:.88rem; color:#ccc; }
  .active-nrg{ font-size:.8rem; color:#aaa; margin-top:.2rem; }
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

  .zone-bench{ flex:1; display:flex; gap:.35rem; overflow:hidden; min-width:0; }
  .bench-slot{ flex:1; min-width:0; max-width:115px; background:rgba(0,0,0,.25); border:1px solid #2a4a2a; border-radius:6px; padding:.35rem; text-align:center; font-size:.72rem; position:relative; cursor:default; display:flex; flex-direction:column; align-items:center; gap:.1rem; overflow:visible; }
  .bench-slot:not(.bench-empty).energy-target{ border-color:#aaff44; cursor:pointer; }
  .bench-slot img{ width:100%; max-width:96px; border-radius:4px; }
  .bench-empty{ border-style:dashed; border-color:#1a3a1a; opacity:.4; overflow:hidden; }
  .bench-name{ font-size:.7rem; color:#ccc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; }
  .bench-stat{ font-size:.66rem; color:#aaa; }
  .bench-nrg{ font-size:.62rem; color:#888; }

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

  .action-bar{ display:grid; grid-template-columns:auto 1fr auto; gap:.5rem; padding:.3rem .7rem; background:rgba(0,0,0,.6); border-top:1px solid #2a4a2a; border-bottom:1px solid #2a4a2a; flex-shrink:0; align-items:center; min-height:52px; }
  .alerts-col{ display:flex; flex-direction:column; gap:.2rem; max-width:280px; }
  .alert{ display:flex; flex-wrap:wrap; align-items:center; gap:.35rem; padding:.25rem .5rem; border-radius:6px; font-size:.8rem; }
  .prize-alert{ background:#2a4a1a; border:1px solid #4a8a3a; }
  .warn-alert{ background:#3a2a0a; border:1px solid #8a6a2a; }
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
  .log-col{ max-width:220px; max-height:90px; overflow-y:auto; font-size:.7rem; }
  .log-line{ color:#7a9a7a; padding:.07rem 0; border-bottom:1px solid #1a2a1a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .log-sys{ color:#aaffaa; font-weight:600; }

  .btn-retreat{ padding:.1rem .3rem; font-size:.62rem; background:#3a3a6a; border:1px solid #6a6aaa; border-radius:4px; color:#ccf; cursor:pointer; }
  .btn-retreat:hover{ background:#4a4a8a; }
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
  .hand-scroll{ display:flex; justify-content:center; gap:-24px; padding:30px 1rem 6px; overflow-x:auto; overflow-y:visible; min-height:160px; perspective:900px; }
  .hand-scroll::-webkit-scrollbar{ height:5px; }
  .hand-scroll::-webkit-scrollbar-thumb{ background:#2a4a2a; border-radius:2px; }
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
  .hand-card img{ width:88px; border-radius:4px; }
  /* 拖曳中所有其他手牌禁用 pointer，避免擋住 elementFromPoint */
  .hand-scroll.is-dragging .hand-card:not(.dragging){ pointer-events:none; }
  /* 浮層預覽：永遠最上層，不影響原卡 layout */
  .hand-preview-float{ position:fixed; z-index:9999; pointer-events:none;
    transform:translate(-50%, -100%);
    filter:drop-shadow(0 10px 26px rgba(0,0,0,.85)); }
  .hand-preview-float img{ width:220px; border-radius:10px; border:2px solid rgba(255,212,74,.5); }
  .hand-name{ font-size:.68rem; color:#bbb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; }
  .hand-hint{ font-size:.65rem; }
  .energy-hint{ color:#aaff44; }
  .hand-card.can-energy{ border-color:#c0a020; cursor:pointer; }
  .hand-card.can-basic{ border-color:#5a9a5a; }
  .hand-card.can-trainer{ border-color:#5a7aba; }
  .hand-card.selected{ border-color:#aaff44; box-shadow:0 0 6px #aaff4488; }
  .hand-btn{ display:block; width:100%; margin-top:.14rem; padding:.15rem 0; border-radius:3px; font-size:.68rem; cursor:pointer; border:none; }
  .basic-btn{ background:#2a5a2a; color:#aef; }
  .basic-btn:hover{ background:#3a7a3a; }
  .trainer-btn{ background:#2a3a6a; color:#ccf; }
  .trainer-btn:hover{ background:#3a5a9a; }

  .selection-overlay{ position:fixed; inset:0; z-index:100; background:rgba(0,0,0,.82); display:flex; align-items:center; justify-content:center; font-family:system-ui,'Microsoft JhengHei',sans-serif; }
  .selection-modal{ background:#1a2a1a; border:1px solid #4a8a4a; border-radius:12px; padding:1.25rem; max-width:680px; width:95vw; max-height:85vh; display:flex; flex-direction:column; gap:.75rem; color:#f0f0f0; }
  .sel-header h3{ margin:0 0 .2rem; font-size:1.1rem; color:#aaffaa; }
  .sel-hint{ margin:0; font-size:.85rem; color:#aaa; }
  .sel-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(72px,1fr)); gap:.4rem; overflow-y:auto; max-height:52vh; padding-right:.25rem; }
  .sel-card{ display:flex; flex-direction:column; align-items:center; gap:.2rem; background:#0e1e0e; border:2px solid #2a4a2a; border-radius:6px; padding:.3rem; cursor:pointer; color:#ccc; font-size:.65rem; position:relative; }
  .sel-card:hover{ border-color:#4a8a4a; }
  .sel-card.sel-picked{ border-color:#aaff44; box-shadow:0 0 6px #aaff4488; }
  .sel-card img{ width:64px; border-radius:3px; }
  .sel-name{ text-align:center; font-size:.6rem; }
  .sel-hp{ font-size:.58rem; color:#888; }
  .sel-check{ position:absolute; top:2px; right:4px; font-size:.9rem; color:#aaff44; font-weight:700; }
  .sel-empty{ color:#666; font-size:.85rem; grid-column:1/-1; text-align:center; padding:1rem; }
  .sel-footer{ display:flex; gap:.75rem; justify-content:flex-end; flex-wrap:wrap; }

  .zoom-overlay{ position:fixed; inset:0; z-index:200; background:rgba(0,0,0,.88); display:flex; align-items:center; justify-content:center; font-family:system-ui,'Microsoft JhengHei',sans-serif; }
  .zoom-modal{ background:#1a2a1a; border:1px solid #4a7a4a; border-radius:14px; padding:1.2rem; max-width:720px; width:96vw; max-height:92vh; display:flex; flex-direction:column; gap:.75rem; color:#f0f0f0; overflow-y:auto; position:relative; }
  .zoom-close{ position:absolute; top:.7rem; right:.8rem; background:transparent; border:none; color:#aaa; font-size:1.2rem; cursor:pointer; padding:.2rem .4rem; border-radius:4px; line-height:1; }
  .zoom-close:hover{ background:#2a3a2a; color:#fff; }
  .zoom-back{ position:absolute; top:.7rem; left:.8rem; background:#2a4a6a; border:1px solid #4a6a8a; color:#cce; font-size:.82rem; cursor:pointer; padding:.25rem .6rem; border-radius:4px; line-height:1; }
  .zoom-back:hover{ background:#3a5a8a; color:#fff; }
  .zoom-body{ display:flex; gap:1.25rem; align-items:flex-start; flex-wrap:wrap; }
  .zoom-img{ width:260px; max-width:90vw; border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,.7); flex-shrink:0; }
  .zoom-info{ flex:1; min-width:200px; display:flex; flex-direction:column; gap:.5rem; }
  .zoom-name{ font-size:1.3rem; font-weight:700; color:#fff; }
  .zoom-badges{ display:flex; gap:.35rem; flex-wrap:wrap; }
  .badge{ padding:.18rem .5rem; border-radius:10px; font-size:.75rem; font-weight:600; }
  .hp-badge{ background:#2a5a2a; color:#8f8; border:1px solid #4a8a4a; }
  .type-badge{ color:#fff; }
  .sub-badge{ background:#2a3a5a; color:#aad; border:1px solid #4a5a8a; }
  .mark-badge{ background:#3a3a1a; color:#cc8; border:1px solid #6a6a2a; }
  .zoom-meta{ font-size:.8rem; color:#888; }
  .zoom-state{ background:#0e1a1e; border:1px solid #2a5a6a; border-radius:6px; padding:.5rem .7rem; font-size:.78rem; display:flex; flex-direction:column; gap:.3rem; }
  .state-title{ font-weight:700; color:#8cf; font-size:.82rem; margin-bottom:.1rem; }
  .state-row{ display:flex; gap:.5rem; align-items:baseline; line-height:1.3; }
  .state-k{ color:#8aa; min-width:3.3rem; flex-shrink:0; }
  .state-v{ color:#ddd; flex:1; display:flex; flex-wrap:wrap; gap:.25rem; align-items:baseline; }
  .state-ecard{ display:inline-block; background:#2a4a6a; color:#ccf; padding:.08rem .4rem; border-radius:3px; font-size:.7rem; border:none; font-family:inherit; }
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
  .discard-modal{ max-width:760px; }
  .discard-title{ margin:0 0 .6rem; color:#aaffaa; font-size:1.05rem; }

  /* ── Tool + Stadium ── */
  .tool-chip{ font-size:.6rem; color:#f0d080; background:#2a2a0a; border:1px solid #6a5a20; border-radius:3px; padding:.06rem .2rem; margin-top:.1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tool-chip.sm{ font-size:.52rem; }
  .ab-used-chip{ font-size:.58rem; color:#c8c0f0; background:#2a1a3a; border:1px solid #4a3a6a; border-radius:3px; padding:.06rem .25rem; margin-top:.1rem; display:inline-block; }
  .ab-used-chip.sm{ font-size:.7rem; padding:0 .15rem; border:none; background:transparent; color:#d0a0ff; }
  .tool-btn{ background:#4a3a10; color:#f0d080; }
  .tool-btn:hover{ background:#6a5a20; }
  .stadium-chip{ background:#1a2a4a; color:#88aaff; border-color:#3a5a8a; }
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
</style>
