<!--
  v2.286 Phase 2-4：手機直式 layout 完整實裝（≤600px portrait）

  設計目標（Leon 反映 v2.284 一頁滑動、手牌只看到 3 張）：
  ───────────────────────────────────────────────────────────────────
  1. **一頁不滑動**：用 flex:1 的 log 區吞剩餘空間，其他 row 固定高度
  2. **手牌底部橫向 scroll**：可滑動檢視全部手牌
  3. **點選 paradigm**：點任何卡片彈 bottom sheet 顯示可用動作（手機友善）
  4. **支援 setup 階段**：手牌基礎卡 tap 後可選「放戰鬥場 / 放備戰」+ 準備完成鈕

  Layout（上→下，目標 ~600-650px 主流手機 viewport）：
    Top bar (32px)：⚙ · 回合 X · 我N 對N · phase · 結束回合鈕
    對手 bench×5 (56px) — 橫向，無圖只縮圖
    對手 chips (22px) — 獎賞/牌庫/棄牌
    對手 active (105px) — 大圖 + HP bar + 能量
    Log (flex:1, min 60px) — 反序顯示
    我方 active (110px) — 大圖 + HP bar + 能量 + 攻擊/撤退/特性按鈕
    我方 chips (22px)
    我方 bench×5 (56px)
    手牌 (98px) — 橫向 scroll，70px 寬卡

  互動 paradigm：
  ───────────────────────────────────────────────────────────────────
  - 點手牌：開 hand-action sheet（依卡類型列出可用動作）
  - 點 active：開 active-action sheet（攻擊/撤退/特性/詳情）
  - 點 bench：開 bench-action sheet（進化/特性/詳情）
  - 點 chip / stadium：開 zoom（既有 modal）
  - 結束回合 / 設定 / 離開：top bar 直接按

  共用底層：
  - 接 props 取得 game state，內部呼叫 engine helpers 計算可用動作
  - 透過 onAction(GameAction) callback 把動作丟給 +page.svelte 的 dispatch
  - 複雜流程（攻擊的 ATTACK_PRE_DISCARD_CHOICE）走 onInitiateAttack callback
  - Modal（pendingSelection / zoom-modal 等）由 +page.svelte 的既有 modal 處理
-->
<script lang="ts">
  import type { GameState, CardInstance, PendingSelection } from '$lib/game/types';
  import { retryImg } from '$lib/img-retry';
  import type { Card } from '$lib/cards/types';
  import {
    getEffectiveAttacks, getAvailableAttacks, getEvolvableTargets, getUsableAbilities,
    canRetreat as engineCanRetreat, getRetreatCost, getBenchLimit,
    getEffectiveHP,
    getHandActivatableAbilities,  // v6.080 手牌特性中央 gate（這裡只拿 abilityName/abilityIndex 當標籤用）
    twoCardStadiumHalfIndex,      // v6.086 兩張合一競技場手牌裁半
    isTwoCardStadiumName          // v6.091 棄牌區兩張合一不聚合判準
  } from '$lib/game/engine';
  // ⭐⭐⭐v6.201：手牌「這張卡現在能做什麼」的唯一述詞（桌機 v6.200 已改讀它）。
  //   本檔原本自帶第三份 playable*Iids / aceCancelActiveLocal / handAbilityActivatableIids，
  //   雖然手機沒有拖曳（不會出現 v6.200 那種「點得動拖不動」），但三份判定遲早漂移
  //   —— 烈箭鷹ex 三度出包（v6.080 / v6.098 / v6.200）全是同一個成因。
  //   ⚠ 手機與桌機仍是兩套獨立版面分支；收斂的**只有述詞**，互動 paradigm（點卡開 sheet）不變。
  import { getHandCardOps, type HandCardOp } from '$lib/game/hand-card-ops';
  import { GameActions } from '$lib/game/actions';
  // ⭐v6.233 預估傷害：**計算不在這裡做**。由父層 +page.svelte 算好後傳進來（手機/桌機共用同一份），
  //   這裡只負責手機直式自己那一套 UI（顯示在招式右方）。
  import { estimateShortText, hasEstimateToShow, type DamageEstimate } from '$lib/game/damage-estimate';
  // v3.02：log 著色 + 卡名可點連結
  import { tokenizeLogMessage, lineClass as logLineClass } from '$lib/game/log_format';
  import { resolveLogCard } from '$lib/game/log_zoom';
  // v4.49：能量屬性顯示（彩色 chip + 文字摘要）
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';
  import type { EnergyType } from '$lib/cards/types';

  interface Props {
    game: GameState;
    pool: Map<string, Card>;
    myIdx: 0 | 1;
    oppIdx: 0 | 1;
    stadiumCard?: Card | null;
    pendingSelection?: PendingSelection | null;
    aiThinking: boolean;
    isSyncing: boolean;
    version: string;
    roomCode?: string;  // v5.374 線上房號
    pendingPrizes?: number;
    canUseStadium?: boolean;
    // v5.116 觀戰模式：true 時整個 UI 進入唯讀（按鈕全 gate 掉，純看不操作）
    isSpectator?: boolean;
    // v5.895 錦標賽觀戰：手牌已被伺服器 redact → 渲染成卡背（比照桌機 spectator-hand-back）
    isTournSpectator?: boolean;
    // v5.954 回放：攤開主視角(行動方)手牌明牌
    isTReplay?: boolean;
    // v6.147 錦標賽動作送出往返期間：會送出動作的按鈕一律 disable（父層唯一述詞 actionBusy）
    // ⭐v6.172 `actionBusy` 現在只在「佇列已滿、這一下真的不能做」時為真（原本是「有動作在途」，
    //   最長會鎖 33 秒）。「有動作在網路上」改由 actionSending 表示，它**純視覺、不 disable 任何東西**；
    //   actionQueued 是排隊中的手勢數（>0 就要讓玩家看得到，靜默丟棄是最糟的）。
    actionBusy?: boolean;
    actionSending?: boolean;
    actionQueued?: number;
    /**
     * ⭐v6.233 預估傷害（index 對齊 getEffectiveAttacks）。
     * null = 不顯示（錦標賽 / 觀戰 / 不是自己的回合）—— gate 在父層，本檔不重寫一份。
     */
    attackEstimates?: DamageEstimate[] | null;
    // Callbacks
    onAction: (action: ReturnType<(typeof GameActions)[keyof typeof GameActions]>) => void | Promise<void>;
    onInitiateAttack: (attackIndex: number) => void;
    onOpenZoom: (cardId: string, inst: CardInstance | null) => void;
    // ⭐v6.190 回放限定：開啟「雙方獎賞卡」檢視視窗。視窗本體畫在父層（版面分支之外），
    //   這裡只負責觸發。⚠ 父層沒傳＝按鈕不出現（不會靜默變成點了沒反應）。
    onOpenPrizes?: () => void;
    onOpenSettings: () => void;
    onLeave: () => void;
    // v5.194：手機版補悔棋按鈕（鏡射桌面版 performUndo）
    undoAvailable?: boolean;
    onUndo?: () => void;
    onResync?: () => void;  // v5.618 錦標賽：點狀態列強制重新同步(免重整)
  }

  let {
    game, pool, myIdx, oppIdx,
    stadiumCard, pendingSelection,
    aiThinking, isSyncing, version,
    roomCode = '',
    pendingPrizes = 0,
    canUseStadium = false,
    isSpectator = false,  // v5.116
    isTournSpectator = false,  // v5.895
    isTReplay = false,  // v5.954
    actionBusy = false,  // v6.147
    actionSending = false,  // v6.172
    actionQueued = 0,       // v6.172
    attackEstimates = null, // v6.233
    onAction, onInitiateAttack, onOpenZoom, onOpenSettings, onLeave,
    onOpenPrizes,   // v6.190（回放限定）
    undoAvailable = false,
    onUndo,
    onResync,
  }: Props = $props();

  // v5.194：手機版 log timestamp helper（鏡射 +page.svelte formatLogTime）
  function formatLogTimeShort(entry: { timestamp?: number }, gameStartTime: number | undefined): string {
    if (!entry.timestamp || !gameStartTime) return '';
    const elapsedMs = entry.timestamp - gameStartTime;
    if (elapsedMs < 0) return '';
    const totalSec = Math.floor(elapsedMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return `[${mm}:${ss}]`;
  }

  // v5.194：log 容器 ref + scroll 到底部
  let mpLogEl: HTMLElement | null = $state(null);
  // v5.791：使用者是否貼齊 log 底部。翻閱舊 log(往上捲)時為 false → 新 log 不再強制把畫面拉到最底，
  //   維持目前翻閱位置；捲回底部後恢復自動跟隨。鏡射 chat panel 的 pinned 模式。
  let mpLogPinned = $state(true);
  function onMpLogScroll() {
    if (!mpLogEl) return;
    mpLogPinned = (mpLogEl.scrollHeight - mpLogEl.scrollTop - mpLogEl.clientHeight) < 48;
  }
  $effect(() => {
    // v5.791：只有「貼齊底部」(mpLogPinned)時才自動捲到底；翻閱中維持原位置。
    const _logLen = game.log?.length;  // 觸發 reactivity
    void _logLen;
    if (mpLogEl && mpLogPinned) {
      requestAnimationFrame(() => {
        if (mpLogEl && mpLogPinned) mpLogEl.scrollTop = mpLogEl.scrollHeight;
      });
    }
  });

  // ── Derived state ─────────────────────────────────────────────────
  let myPlayer = $derived(game.players[myIdx]);
  let oppPlayer = $derived(game.players[oppIdx]);
  let myBenchLimit = $derived(getBenchLimit(game, myIdx, pool));
  let oppBenchLimit = $derived(getBenchLimit(game, oppIdx, pool));

  // v4.49：能量屬性解析（mirror +page.svelte:2356 energyPips 邏輯，let mobile 顯示彩色 chip）
  //   處理基本/特殊能量、新衝天 / 稜鏡 / 火箭隊 / 燃火等特例。
  function energyPips(inst: CardInstance): Array<{ type: string; count: number; label?: string }> {
    const host = pool.get(inst.cardId);
    const hostIsEvolution = !!host?.evolvesFrom || host?.stage === 'Stage1' || host?.stage === 'Stage2';
    const hostIsStage2 = host?.stage === 'Stage2';
    const hostNeedsType = (t: EnergyType): boolean =>
      !!host?.attacks?.some(a => a.cost?.includes(t));
    const counts = new Map<string, number>();
    const bump = (type: string, n = 1) => counts.set(type, (counts.get(type) ?? 0) + n);
    for (const e of inst.energyAttached) {
      const ec = pool.get(e.cardId);
      if (!ec) continue;
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
      const name = ec.name;
      if (name === '古舊能量' || name === '夜光能量') { bump('Rainbow'); continue; }
      if (name === '稜鏡能量') { bump(hostIsEvolution ? 'Colorless' : 'Rainbow'); continue; }
      if (name === '新衝天能量') {
        if (hostIsStage2) { bump('Rainbow', 2); }
        else { bump('Colorless'); }
        continue;
      }
      if (name === '火箭隊能量') {
        const needsDark = hostNeedsType('Darkness');
        const needsPsychic = hostNeedsType('Psychic');
        if (needsDark && !needsPsychic)      { bump('Darkness', 2); }
        else if (needsPsychic && !needsDark) { bump('Psychic', 2); }
        else                                  { bump('Psychic'); bump('Darkness'); }
        continue;
      }
      if (name === '燃火能量') {
        if (hostIsEvolution) bump('Colorless', 3);
        else bump('Colorless');
        continue;
      }
      const m2 = name.match(/【(.+?)】/);
      if (m2) {
        const zhMap: Record<string, EnergyType> = {
          草: 'Grass', 火: 'Fire', 水: 'Water', 雷: 'Lightning',
          超: 'Psychic', 鬥: 'Fighting', 惡: 'Darkness', 鋼: 'Metal',
          龍: 'Dragon', 無: 'Colorless',
        };
        if (zhMap[m2[1]]) { bump(zhMap[m2[1]]); continue; }
      }
      bump('Colorless');
    }
    return [...counts.entries()].map(([type, count]) => ({
      type, count,
      ...(type === 'Rainbow' ? { label: '彩' } : {}),
    }));
  }

  // v4.49：文字版能量摘要（撤退 picker label 等 string context 用）
  //   範例：[草水水] / [雷2鬥] / [彩2無]
  function energyLabelText(inst: CardInstance): string {
    if (inst.energyAttached.length === 0) return '';
    return energyPips(inst).map(p => {
      const lbl = p.label ?? ENERGY_LABEL[p.type as EnergyType] ?? '?';
      return p.count > 1 ? `${lbl}${p.count}` : lbl;
    }).join('');
  }
  // v5.205：mp-sheet 拖曳支援（仿桌面 modal） — 玩家可拖開 picker 看後面場上資訊再決定
  let sheetOffset = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let sheetDragged = $state(false);
  let sheetDragStart: { sx: number; sy: number; ox: number; oy: number } | null = null;
  function onSheetHeaderPointerDown(e: PointerEvent) {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    // 按到 header 內的 button / icon 不觸發拖曳
    if (t.closest('button, input, select, textarea, a, [role="button"]')) return;
    sheetDragStart = {
      sx: e.clientX, sy: e.clientY,
      ox: sheetOffset.x, oy: sheetOffset.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }
  function onSheetHeaderPointerMove(e: PointerEvent) {
    if (!sheetDragStart) return;
    const dx = e.clientX - sheetDragStart.sx;
    const dy = e.clientY - sheetDragStart.sy;
    sheetOffset = { x: sheetDragStart.ox + dx, y: sheetDragStart.oy + dy };
    if (!sheetDragged && Math.abs(dx) + Math.abs(dy) > 3) sheetDragged = true;
  }
  function onSheetHeaderPointerUp(_e: PointerEvent) {
    sheetDragStart = null;
  }
  // 切換 sheet（sheet 物件變化）時自動 reset offset
  $effect(() => {
    if (sheet === null || sheet) {
      sheetOffset = { x: 0, y: 0 };
      sheetDragged = false;
    }
  });

  // v5.116：觀戰者 isSpectator=true → isMyTurn 永遠 false → 所有按鈕 / popup actions / dispatch gate 全部失效（read-only 模式）
  let isMyTurn = $derived(!isSpectator && game.activePlayerIndex === myIdx);
  let isMainPhase = $derived(game.turnPhase === 'main');
  let isSetup = $derived(game.phase === 'setup');
  let isPlaying = $derived(game.phase === 'playing');
  let canEndTurn = $derived(isPlaying && game.turnPhase === 'end' && isMyTurn);
  // v5.015：偵測「需要送出新戰鬥寶可夢」狀態 — 結束回合按鈕鎖 + alert 提示
  //   needSendActiveMine：自方 active=null + 有備戰（被特性/中毒/反傷 KO，自己需補位）
  //   needSendActiveOpp：對手 active=null + 有備戰（剛被我 KO，等對手送）
  //   桌機版 +page.svelte 已正確 hide 按鈕 + 顯 alert，本變數補手機版同等 UX。
  let needSendActiveMine = $derived(
    isPlaying && myPlayer.active === null && myPlayer.bench.length > 0 && !pendingSelection
  );
  let needSendActiveOpp = $derived(
    isPlaying && oppPlayer.active === null && oppPlayer.bench.length > 0 && !pendingSelection
  );
  let canRetreatNow = $derived(isPlaying && isMyTurn && isMainPhase && engineCanRetreat(game, pool));
  let evolvableTargets = $derived(isPlaying && isMyTurn && isMainPhase ? getEvolvableTargets(game, pool) : []);
  let usableAbilities = $derived(isPlaying && isMyTurn && isMainPhase && !pendingSelection ? getUsableAbilities(game, pool) : []);
  // ⭐⭐⭐v6.201 手牌可用操作：唯一來源 getHandCardOps（sheet 動作清單與黃框都只讀它）。
  //   ⚠ setup 階段雙方同時擺場，本檔的 isMyTurn（= activePlayerIndex === myIdx）在 setup
  //     只會對其中一方成立 —— 所以 setup 用 isMySetupTurn（只看觀戰唯讀），
  //     對齊 v2.287「setup 階段基礎寶可夢可放（不分先後手）」的既有行為。
  let handCardOps = $derived(
    getHandCardOps(game, myIdx as 0 | 1, pool, { isMyTurn, isMySetupTurn: !isSpectator })
  );
  const EMPTY_HAND_OPS: ReadonlySet<HandCardOp> = new Set<HandCardOp>();
  function opsOf(iid: string): ReadonlySet<HandCardOp> {
    return handCardOps.get(iid) ?? EMPTY_HAND_OPS;
  }

  // 招式有效列表（含工具來源）
  let effectiveAttacks = $derived(
    isPlaying && isMyTurn && isMainPhase && myPlayer.active
      ? getEffectiveAttacks(game, myPlayer.active, pool)
      : []
  );
  let availableAttackIndices = $derived(
    isPlaying && isMyTurn && isMainPhase
      ? getAvailableAttacks(game, pool)
      : []
  );
  let currentRetreatCost = $derived(
    isPlaying && isMyTurn && isMainPhase
      ? getRetreatCost(game, pool)
      : null
  );

  // ── Helpers ────────────────────────────────────────────────────────
  function cardOf(inst: CardInstance | null): Card | null {
    if (!inst) return null;
    return pool.get(inst.cardId) ?? null;
  }
  function hpRemaining(inst: CardInstance) {
    return Math.max(0, getEffectiveHP(inst, pool, game) - inst.damage);
  }
  function hpMax(inst: CardInstance) { return getEffectiveHP(inst, pool, game); }

  // v3.02：log 內卡名 -> 可點按鈕（行為與 +page.svelte 同步）
  // 由長到短排序：longest-match-first 必須條件，避免短名遮蔽長名
  let cardNamesSorted = $derived.by(() => {
    const seen = new Set<string>();
    const arr: string[] = [];
    for (const c of pool.values()) {
      if (!c?.name) continue;
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      arr.push(c.name);
    }
    arr.sort((a, b) => b.length - a.length);
    return arr;
  });
  function openZoomByName(cardName: string, hintSourceIid?: string, hintPlayerIdx?: 0 | 1 | null) {
    // v5.955：改用共用 resolveLogCard(與桌機同源;修正手機版原本漂移—缺 evolvedFromStack、
    //   也沒搜 deck/prizes/場地/巢狀能量道具)。找不到才 fallback 全域 pool。
    if (game) {
      const r = resolveLogCard(game, pool, cardName, hintSourceIid, hintPlayerIdx);
      if (r) { onOpenZoom(r.cardId, r.inst); return; }
    }
    // fallback：本場所有區都找不到 → 全域 pool 第一個同名
    for (const c of pool.values()) {
      if (c?.name === cardName) { onOpenZoom(c.id, null); return; }
    }
  }
  // v2.286 Phase 4：HP bar 顏色 — <30% 紅、<60% 黃、其他綠
  function hpClass(inst: CardInstance): string {
    const max = hpMax(inst);
    if (max === 0) return 'hp-ok';
    const ratio = hpRemaining(inst) / max;
    if (ratio < 0.3) return 'hp-low';
    if (ratio < 0.6) return 'hp-mid';
    return 'hp-ok';
  }

  // ── Bottom sheet state（點選 paradigm） ──────────────────────────
  type SheetState =
    | { type: 'hand'; inst: CardInstance }
    | { type: 'active' }
    | { type: 'bench'; inst: CardInstance }
    | { type: 'pick-energy-target'; energyIid: string }
    | { type: 'pick-evolve-target'; evoIid: string; candidates: string[] }
    | { type: 'pick-retreat-target' }  // v5.200 撤退改卡圖網格 picker
    | { type: 'discard'; list: CardInstance[]; owner: string }
    | null;
  let sheet = $state<SheetState>(null);
  function closeSheet() { sheet = null; }

  // ── 開啟棄牌區清單 sheet ──────────────────────────────────────────
  function openDiscard(list: CardInstance[], owner: string) {
    if (list.length === 0) return;
    sheet = { type: 'discard', list: [...list].reverse(), owner };
  }

  // ── v5.128：棄牌區合併同名卡 helper（script 區 — 避開 {@const} 規則限制）─
  //   同 cardId 視為同張卡（同名 + 同版本），count 累加；按數量降序排。
  //   sheet.list 變動時 template 重新呼叫此函式，無 reactivity 問題。
  //   v5.116~v5.120 曾用 template 內 IIFE / reduce 嘗試 5 次 build fail，
  //   v5.121 才發現是另處 changelog raw {@const} 造成。本版用 script helper 最安全。
  // v6.091：key ＝ each 的穩定 key（一般卡用 cardId、兩張合一競技場拆開後用 iid，
  //   ⚠ 不改 key 會 each_key_duplicate 直接白屏）；half ＝ 左/右半。
  type DiscardGroup = { cardId: string; inst: CardInstance; count: number; name: string; supertype: string | undefined; subtype: string | undefined; key: string; half?: 0 | 1 | null };
  // v5.606 防呆：依 iid 去重，避免瞬時重複 iid 讓 keyed {#each} 崩潰（each_key_duplicate 白屏）。
  function dedupeByIid<T extends { iid?: string }>(list: readonly T[] | null | undefined): T[] {
    if (!list) return [];
    const seen = new Set<string>(); const out: T[] = [];
    for (const c of list) { const k = (c as any)?.iid; if (typeof k === 'string') { if (seen.has(k)) continue; seen.add(k); } out.push(c as T); }
    return out;
  }
  function groupDiscardList(list: CardInstance[]): DiscardGroup[] {
    const m = new Map<string, DiscardGroup>();
    for (const inst of list) {
      const c0 = pool.get(inst.cardId);
      // v6.091「傳說」兩張合一競技場不聚合 —— 左右半各自一格（Wilson 裁定）。
      if (isTwoCardStadiumName(c0?.name)) {
        m.set(inst.iid, {
          cardId: inst.cardId, inst, count: 1, key: inst.iid,
          name: c0?.name ?? '?', supertype: c0?.supertype, subtype: c0?.subtype,
          half: twoCardStadiumHalfIndex(list, inst.iid, pool),
        });
        continue;
      }
      const existing = m.get(inst.cardId);
      if (existing) {
        existing.count++;
      } else {
        m.set(inst.cardId, {
          cardId: inst.cardId,
          inst,
          count: 1,
          key: inst.cardId,
          name: c0?.name ?? '?',
          supertype: c0?.supertype,
          subtype: c0?.subtype,
        });
      }
    }
    // v5.309: 排序 寶可夢→物品→支援者→場地→能量, 同類內 count desc
    function typeRank(g: DiscardGroup): number {
      if (g.supertype === 'Pokemon') return 1;
      if (g.supertype === 'Trainer') {
        if (g.subtype === 'Supporter') return 3;
        if (g.subtype === 'Stadium') return 4;
        return 2;
      }
      if (g.supertype === 'Energy') return 5;
      return 9;
    }
    return [...m.values()].sort((a, b) => {
      const ra = typeRank(a), rb = typeRank(b);
      if (ra !== rb) return ra - rb;
      return b.count - a.count;
    });
  }

  // ── Hand tap：依卡類型決定 sheet 內容 ──────────────────────────────
  function tapHand(inst: CardInstance) {
    sheet = { type: 'hand', inst };
  }

  // ⭐v6.201：isEnergy / isTrainer / isToolCard / isEvoMon 已刪除 —— 這些「這張卡屬於哪一類」
  //   的判斷過去是用來自組可用性條件的，現在一律問 getHandCardOps()。
  //   isBasicMon 保留：只用來挑「放到戰鬥場」按鈕的**文案**（基礎 vs 瞬間爆發力），不參與判定。
  function isBasicMon(c: Card | null): boolean { return !!c && c.supertype === 'Pokemon' && !c.evolvesFrom; }

  // ⭐v6.201：v5.089 的 aceCancelActiveLocal（本檔自己鏡射一份 engine isAceCancelActive）
  //   與 isAceSpecEnergyCard 已移除 —— ACE消弭 對能量的封鎖由 getHandCardOps 內部
  //   直接呼叫 engine 的 isAceCancelActive 判定（同時修好「持有者特性被消除時仍生效」）。
  //   ⚠ 不要再把鏡射版加回來。

  // 手牌動作 dispatch
  async function playBasicToActive(iid: string) {
    closeSheet();
    await onAction(GameActions.placeActive(iid, myIdx));
  }
  async function playBasicToBench(iid: string) {
    closeSheet();
    if (isSetup) {
      await onAction(GameActions.benchPokemon(iid, myIdx));
    } else {
      await onAction(GameActions.playBasic(iid));
    }
  }
  async function playFossil(iid: string) {
    closeSheet();
    await onAction(GameActions.playFossil(iid));
  }
  async function playTrainer(iid: string) {
    closeSheet();
    await onAction(GameActions.playTrainer(iid));
  }
  async function attachEnergy(energyIid: string, targetIid: string) {
    closeSheet();
    await onAction(GameActions.attachEnergy(energyIid, targetIid));
  }
  async function evolveTo(fromIid: string, evoIid: string) {
    closeSheet();
    await onAction(GameActions.evolve(fromIid, evoIid));
  }
  async function retreatTo(benchIid: string) {
    closeSheet();
    await onAction(GameActions.retreat(benchIid));
  }
  async function useAbility(iid: string, abilityIndex: number) {
    closeSheet();
    await onAction(GameActions.useAbility(iid, abilityIndex));
  }

  // 取「手牌可選動作」list（給 sheet 用）
  function handActions(inst: CardInstance): Array<{ label: string; action: () => void; disabled?: boolean; primary?: boolean }> {
    const c = cardOf(inst);
    if (!c) return [];
    const out: Array<{ label: string; action: () => void; disabled?: boolean; primary?: boolean }> = [];
    const iid = inst.iid;
    // ⭐⭐⭐v6.201：每個動作能不能出現，一律問中央 ops —— 禁止在這裡自行組條件。
    const ops = opsOf(iid);

    // 基礎寶可夢 / 起手可當戰鬥寶可夢的卡
    if (ops.has('setup-active')) {
      // v5.031 閃焰王牌｜瞬間爆發力 — 起手 setup 階段無 active 時，非基礎也可放戰鬥場（卡面特性）
      //   官方 Q&A：手牌只有閃焰王牌時，可因「瞬間爆發力」放於戰鬥場開始對戰
      out.push({
        label: isBasicMon(c) ? '🃏 放到戰鬥場' : '🃏 放到戰鬥場（瞬間爆發力）',
        action: () => playBasicToActive(iid), primary: true,
      });
    }
    // ⭐v6.321 開局重選戰鬥場：已有戰鬥場寶可夢時，手牌基礎卡可「換上場」（原本那隻回手牌；engine 既有語意）
    if (ops.has('setup-active-swap')) {
      out.push({ label: '🔁 換上戰鬥場（原本的回手牌）', action: () => playBasicToActive(iid) });
    }
    if (ops.has('basic') || ops.has('basic-setup')) {
      out.push({ label: '📥 放到備戰區', action: () => playBasicToBench(iid) });
    }
    // 化石 Item
    if (ops.has('fossil')) {
      out.push({ label: '🦴 放化石到備戰', action: () => playFossil(iid), primary: true });
    }
    // 進化卡
    if (ops.has('evolve')) {
      const targets = evolvableTargets.filter(e => e.toIids.includes(iid)).map(e => e.fromIid);
      if (targets.length === 1) {
        out.push({ label: `🔺 進化（${nameOfIid(targets[0])}）`, action: () => evolveTo(targets[0], iid), primary: true });
      } else if (targets.length > 1) {
        out.push({ label: '🔺 選進化目標…', action: () => { sheet = { type: 'pick-evolve-target', evoIid: iid, candidates: targets }; }, primary: true });
      }
    }
    // 訓練家（含工具、競技場）— v2.289：依 subtype 顯示清楚標籤
    if (ops.has('trainer') || ops.has('tool')) {
      const sub = c?.subtype ?? '';
      const tLabel = sub === 'Stadium' ? '🏟 放置競技場'
                   : sub === 'PokemonTool' ? '🔧 附加道具到寶可夢'
                   : sub === 'Supporter' ? '👤 使用支援者'
                   : '🎴 使用此卡';
      out.push({ label: tLabel, action: () => playTrainer(iid), primary: true });
    }
    // 能量卡
    if (ops.has('energy')) {
      out.push({ label: '⚡ 附加能量到…', action: () => { sheet = { type: 'pick-energy-target', energyIid: iid }; }, primary: true });
    }
    // v3.07 Deferred Wave D — 手牌觸發特性（誘導之尾 / 熱浪鱗粉 / 緊急迴轉）
    // 機制 A: ON_DISCARD_FROM_HAND — 棄此卡觸發場上 trigger holder 特性
    if (ops.has('hand-ability')) {
      // ⚠⚠ v6.099 移除死按鈕：這裡原本硬編兩個「棄此卡 → 觸發 超能妙喵｜誘導之尾 /
      //   火神蛾｜熱浪鱗粉」的按鈕，但 **v5.510 起 `ON_DISCARD_FROM_HAND_ABILITIES` 已清空**
      //   （兩張都改成寶可夢身上的 regA 特性按鈕，避免同一個效果有兩個按鈕）。
      //   engine 的 USE_HAND_DISCARD_ABILITY handler 第一關就是 `Map.get(triggerName)`，
      //   查不到直接 return → **這兩個按鈕按下去 100% 沒反應、連 log 都不會有**。
      //   桌機端 v5.510 當時就已清空同一份 Map（`+page.svelte` 的 handDiscardAbilityTriggers
      //   直接 `return out`），**只有手機版留著死入口**，兩端行為不一致。
      //   ⇒ 一併移除；要用這兩個特性請點寶可夢身上的特性按鈕（走 USE_ABILITY / regA）。
      //   ⚠ 未來若把卡加回 ON_DISCARD_FROM_HAND_ABILITIES，**兩套 UI 要同時加回入口**
      //     （守衛 test-v6098-hand-ability-ui-central 的 ③ 區塊會在 Map 非空卻沒有 UI 入口時亮紅）。

      // 機制 B: ON_HAND_ACTIVATE（從手牌發動、把自己放到備戰區的特性）
      // ⚠⚠ v6.098 修真 bug：這裡原本**硬編**「齒輪怪｜緊急迴轉」＋自寫一份
      //   `oppHasStage2Local()`，所以 v6.080 新增的「烈箭鷹ex｜激動俯衝」在手機版
      //   **完全沒有按鈕**（黃框會亮＝判定正確，但點開卡片只有「查看詳情」）→
      //   玩家回報「場上有超級袋獸ex 時烈箭鷹ex 無法使用激動俯衝」。
      //   v6.080 當時只把「判定」收斂到 engine getHandActivatableAbilities，
      //   **動作入口這一半漏了**（同型教訓：中央述詞寫好 ≠ 每個消費點都接上）。
      //   ⇒ 改為逐項讀中央 gate 產生按鈕，label 與桌機版逐字一致。
      //   ⚠ 新增同型卡只改 engine 的 HAND_ACTIVATE_GATES；**禁止**再往這裡塞 if 判卡名。
      //   ⭐v6.201「能不能用」已由上方 ops.has('hand-ability') 決定（中央述詞）；
      //     這裡只是把 abilityName / abilityIndex 取出來當按鈕標籤與參數。
      for (const a of getHandActivatableAbilities(game, myIdx as 0 | 1, pool)) {
        if (a.iid !== iid) continue;
        out.push({
          label: `⚡ ${a.abilityName} (放備戰)`,
          action: () => { closeSheet(); onAction(GameActions.useHandAbility(iid, a.abilityIndex)); },
          primary: true,
        });
      }
    }
    // 永遠可：查看詳情
    out.push({ label: '🔍 查看詳情', action: () => { closeSheet(); onOpenZoom(inst.cardId, inst); } });
    return out;
  }

  function nameOfIid(iid: string): string {
    const all = [
      ...(myPlayer.active ? [myPlayer.active] : []),
      ...myPlayer.bench,
      ...myPlayer.hand,
    ];
    const inst = all.find(i => i.iid === iid);
    if (!inst) return iid;
    return cardOf(inst)?.name ?? iid;
  }

  /**
   * ⭐v6.233 手機直式：預估直接接在招式名後面（站長裁定：顯示在招式右方），
   * 例：「⚔️ 種子炸彈 · 30 · 預估 60（弱點 ×2）」。
   * 文案一律由中央的 estimateShortText 產生，**不在這裡另寫一套措辭**。
   */
  function estLabelSuffix(i: number): string {
    const est = attackEstimates ? (attackEstimates[i] ?? null) : null;
    return hasEstimateToShow(est) ? ` · ${estimateShortText(est)}` : '';
  }

  // 取「active 可選動作」list
  function activeActions(): Array<{ label: string; action: () => void; disabled?: boolean; primary?: boolean; zoomIid?: string }> {
    if (!myPlayer.active) return [];
    // v3.35：out array 元素 type 加 zoomIid?，與 function return type 對齊（撤退項加 zoomIid 顯示 🔍 副按鈕）
    const out: Array<{ label: string; action: () => void; disabled?: boolean; primary?: boolean; zoomIid?: string }> = [];
    const aId = myPlayer.active.iid;
    // v3.998 化石卡在戰鬥場：自己回合 main phase 才能丟棄（卡面：「若在自己的回合中，則可將場上的這張卡丟棄」）
    //   桌機 v2.189 已有此按鈕（+page.svelte line 4391+），手機版漏這個 UX。
    //   丟棄與昏厥不同：對手不抽獎賞卡；戰鬥場丟棄需從備戰補 1 隻（engine 處理）。
    if (myPlayer.active.fossilOnField && isPlaying && isMyTurn && isMainPhase && !pendingSelection) {
      out.push({
        label: '🦴 丟棄化石',
        action: () => { closeSheet(); onAction(GameActions.discardFossil(aId)); },
        primary: true,
      });
    }
    // 攻擊（若 main phase 且有可用招式）
    if (effectiveAttacks.length > 0) {
      effectiveAttacks.forEach((eff, i) => {
        const ok = isPlaying && isMyTurn && isMainPhase && !pendingSelection && availableAttackIndices.includes(i);
        out.push({
          label: `⚔️ ${eff.atk.name}${eff.atk.damage ? ' · ' + eff.atk.damage : ''}${eff.isFromTool ? ' 🔧' : ''}${estLabelSuffix(i)}`,
          action: () => { closeSheet(); onInitiateAttack(i); },
          disabled: !ok,
          primary: ok,
        });
      });
    }
    // 撤退 — v5.200 改成單一按鈕，點下後彈卡圖網格 picker（沿用送新戰鬥位 modal UX）
    if (canRetreatNow && myPlayer.bench.length > 0) {
      const costLabel = currentRetreatCost !== null ? `（-${currentRetreatCost}）` : '';
      out.push({
        label: `🔄 撤退${costLabel}…`,
        action: () => { sheet = { type: 'pick-retreat-target' }; },
        primary: true,
      });
    }
    // 特性
    const myAbil = usableAbilities.filter(u => u.iid === aId);
    myAbil.forEach(u => {
      out.push({
        label: `✨ 特性「${u.abilityName}」`,
        action: () => useAbility(aId, u.abilityIndex),
        primary: true,
      });
    });
    out.push({ label: '🔍 查看詳情', action: () => { closeSheet(); onOpenZoom(myPlayer.active!.cardId, myPlayer.active); } });
    return out;
  }

  // 取「bench 可選動作」list
  function benchActions(inst: CardInstance): Array<{ label: string; action: () => void; primary?: boolean }> {
    const out: Array<{ label: string; action: () => void; primary?: boolean }> = [];
    // v3.998 化石卡在備戰：自己回合 main phase 才能丟棄
    if (inst.fossilOnField && isPlaying && isMyTurn && isMainPhase && !pendingSelection) {
      out.push({
        label: '🦴 丟棄化石',
        action: () => { closeSheet(); onAction(GameActions.discardFossil(inst.iid)); },
        primary: true,
      });
    }
    // 該 bench 上的特性
    const benchAbil = usableAbilities.filter(u => u.iid === inst.iid);
    benchAbil.forEach(u => {
      out.push({
        label: `✨ 特性「${u.abilityName}」`,
        action: () => useAbility(inst.iid, u.abilityIndex),
        primary: true,
      });
    });
    out.push({ label: '🔍 查看詳情', action: () => { closeSheet(); onOpenZoom(inst.cardId, inst); } });
    return out;
  }

  // 取「能量附加目標」 list
  function energyTargets(): CardInstance[] {
    const out: CardInstance[] = [];
    if (myPlayer.active) out.push(myPlayer.active);
    out.push(...myPlayer.bench);
    return out;
  }

  // ── v2.289 / v3.871：iOS Safari 整頁滑動鎖 ────────────────────────
  // 1. touchmove 以 {passive:false} 掛在組件 root；對 .mp-row / .mp-hand /
  //    .mp-log / .mp-chips / .mp-sheet 內部觸控放行（允許捲動），其餘 preventDefault。
  // 2. v3.871: 額外掛 document 層的 touchmove — 因為 iOS Safari pull-to-refresh
  //    可能在 .mp 外（status bar 下、URL bar 上的瀏覽器 chrome 區）觸發，必須擋全頁。
  // 3. v3.871: 也擋 touchstart 在頁面頂端的事件，proactive 防止 Safari 啟動下拉刷新動畫。
  // v4.24 對戰計時器 — tickTime 每秒更新
  let tickTime = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { tickTime = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  function fmtTimerMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
  }
  const liveTurnTimeMs = $derived(
    game.phase === 'playing' && game.currentTurnStartTime !== undefined
      ? Math.max(0, tickTime - game.currentTurnStartTime)
      : 0
  );
  function _playerTotal(idx: 0 | 1): number {
    const stored = game.playerTurnTimeMs?.[idx] ?? 0;
    const live = (game.phase === 'playing' && game.activePlayerIndex === idx) ? liveTurnTimeMs : 0;
    return stored + live;
  }
  const p0TotalMs = $derived(_playerTotal(0));
  const p1TotalMs = $derived(_playerTotal(1));
  const gameTotalMs = $derived(
    game.gameStartTime !== undefined
      ? Math.max(0, (game.phase === 'game-over' ? (game.currentTurnStartTime ?? tickTime) + liveTurnTimeMs : tickTime) - game.gameStartTime)
      : 0
  );

  function preventScroll(node: HTMLElement) {
    const moveHandler = (e: TouchEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.mp-row, .mp-hand, .mp-log, .mp-chips, .mp-sheet, .chat-panel-messages')) return;
      e.preventDefault();
    };
    // v3.871 / v3.872: document 層也擋 — 處理 .mp 外的 pull-to-refresh
    //   v3.872 修正 whitelist：原 .zoom-modal-overlay 是腦補名稱，實際是 .zoom-overlay + .zoom-modal。
    //   v3.872 加 .selection-modal — pendingSelection picker UI（含「📖 查看牌庫剩餘全部」摺疊區）。
    //   v3.872 加 .full-deck-view / .full-deck-list — 牌庫剩餘清單可垂直 scroll。
    const docMoveHandler = (e: TouchEvent) => {
      const t = e.target as Element | null;
      // 落在 .mp 外（瀏覽器邊界區）或非 scrollable 內部 → 擋
      if (!t || !t.closest(
        '.mp-row, .mp-hand, .mp-log, .mp-chips, .mp-sheet, ' +
        '.selection-overlay, .selection-modal, ' +
        '.lightbox-overlay, ' +
        '.zoom-overlay, .zoom-modal, ' +
        '.full-deck-view, .full-deck-list, ' +
        '.chat-panel-messages',  // v5.627 浮動聊天訊息區允許垂直捲動看歷史;原本被 document touchmove 全擋
      )) {
        if (e.cancelable) e.preventDefault();
      }
    };
    node.addEventListener('touchmove', moveHandler, { passive: false });
    document.addEventListener('touchmove', docMoveHandler, { passive: false });
    return {
      destroy() {
        node.removeEventListener('touchmove', moveHandler);
        document.removeEventListener('touchmove', docMoveHandler);
      },
    };
  }

  // v5.379：滑鼠橫向拖曳捲動 — 桌機把網頁縮成手機版面時，手牌過多或零之大空洞讓備戰
  //   寶可夢變多、超出版面寬度的卡，用滑鼠無法像觸控那樣按住橫拉看到。此 action 只接管
  //   「滑鼠」指標（觸控仍走原生捲動），按住左右拖曳即可捲動；移動超過門檻判定為拖曳時，
  //   吃掉緊接著的 click 避免誤觸卡片。
  function dragScroll(node: HTMLElement) {
    let down = false, startX = 0, startScroll = 0, moved = false;
    function onDown(e: PointerEvent) {
      if (e.pointerType !== 'mouse') return;             // 觸控交給原生捲動
      if (node.scrollWidth <= node.clientWidth) return;  // 沒有可捲動內容就不接管
      down = true; moved = false;
      startX = e.clientX; startScroll = node.scrollLeft;
      node.classList.add('mp-dragging');
    }
    function onMove(e: PointerEvent) {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) { node.scrollLeft = startScroll - dx; e.preventDefault(); }
    }
    function onUp() {
      if (!down) return;
      down = false;
      node.classList.remove('mp-dragging');
      if (moved) {
        // 拖曳結束後吃掉緊接著的 click（避免把卡片當成被點擊）
        const eat = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); node.removeEventListener('click', eat, true); };
        node.addEventListener('click', eat, true);
        setTimeout(() => node.removeEventListener('click', eat, true), 0);
      }
    }
    node.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return {
      destroy() {
        node.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      },
    };
  }
</script>

<div class="mp" use:preventScroll>

  <!-- v4.22 場地卡在場時的背景圖層（手機版同樣只抓上半藝術圖區） -->
  {#if stadiumCard}
    <div class="mp-stadium-bg-layer" style:background-image="url({stadiumCard.imageUrl})" aria-hidden="true"></div>
  {/if}

  <!-- ─── Top bar：1 行 ─── -->
  <header class="mp-top">
    <button class="mp-icon-btn" onclick={onLeave} title="離開">←</button>
    <!-- v5.194：手機版悔棋按鈕（只當 undoAvailable=true 顯示，鏡射桌面版邏輯） -->
    {#if undoAvailable && onUndo && !isSpectator}
      <button class="mp-icon-btn mp-undo-btn" onclick={onUndo} title="悔棋（回到上一步）">↶</button>
    {/if}
    <span class="mp-turn-text">回合 {game.turn}</span>
    <span class="mp-phase" role={onResync ? 'button' : undefined} style={onResync ? 'cursor:pointer;' : undefined} title={onResync ? '若畫面卡住、遲遲沒換你 → 點此重新同步（不必重整網頁）' : undefined} onclick={() => onResync?.()}>
      {#if isSetup}🎴 設置
      {:else if game.turnPhase === 'main'}{isMyTurn ? '🟢 你的回合' : '🔴 對手回合'}
      {:else if game.turnPhase === 'draw'}📥 抽牌
      {:else}⏭ 結束{/if}{#if onResync} 🔄{/if}
    </span>
    <span class="mp-spacer"></span>
    {#if aiThinking}<span class="mp-tag">🤖</span>{/if}
    {#if isSyncing}<span class="mp-tag">⏳</span>{/if}
        {#if actionSending}<span class="mp-tag">⏳送出中</span>{/if}
    {#if actionQueued}<span class="mp-tag">⏳已排隊 {actionQueued}</span>{/if}
    {#if isSetup && !game.setupDone[myIdx] && !isSpectator}
      <!-- v2.287 修：setup 階段雙方各自準備，不依 isMyTurn 判定（後手玩家 isMyTurn=false 會看不到按鈕） -->
      <!-- v5.116：觀戰者不顯示準備按鈕 -->
      <button class="mp-end-btn" disabled={actionBusy || !myPlayer.active}
        onclick={() => onAction(GameActions.finishSetup(myIdx))}>✅ 準備</button>
    {:else if isSetup && game.mulliganPostBenchOpen?.[myIdx] && !isSpectator}
      <!-- v5.189：手機版補抽後設置按鈕（補桌面版 +page.svelte L6248 對應分支）
           玩家補抽完手牌後 mulliganPostBenchOpen=true，需此按鈕進入 playing phase
           不依 isMyTurn — myIdx 已由 +page.svelte L2151 myIdx 切換邏輯處理（v5.185 補 mulliganPostBenchOpen 優先級）-->
      <button class="mp-end-btn" disabled={actionBusy}
        onclick={() => onAction(GameActions.finishMulliganPostBench(myIdx))}>✅ 完成補抽</button>
    {:else if isMyTurn && isPlaying && !pendingSelection && !sheet && (game.pendingPrizes?.[0] ?? 0) === 0 && (game.pendingPrizes?.[1] ?? 0) === 0}
      <!-- v2.289：不限 turnPhase==='end'，主階段也顯示（等同「跳過攻擊 + 結束回合」合一）
           engine END_TURN 自帶 pendingPrizes / defender.active=null 雙重 gate -->
      <!-- v5.015：補 active=null 顯示 disabled — 之前按鈕顯示但 engine 拒絕，玩家以為按鈕壞掉 -->
      {#if needSendActiveMine}
        <button class="mp-end-btn" disabled title="請先從備戰區派出新的戰鬥寶可夢">⏭ 結束回合</button>
      {:else if needSendActiveOpp}
        <button class="mp-end-btn" disabled title="等待對手送出新戰鬥寶可夢">⏭ 結束回合</button>
      {:else}
        <button class="mp-end-btn" disabled={actionBusy} onclick={() => onAction(GameActions.endTurn())}>⏭ 結束回合</button>
      {/if}
    {/if}
    <button class="mp-icon-btn" onclick={onOpenSettings} title="設定">⚙</button>
  </header>

  <!-- v4.24 對戰計時器 — 細條 timer-strip，4 欄資訊一直可見 -->
  {#if game.gameStartTime !== undefined}
    <div class="mp-timer-strip">
      <span class="mp-t-cell mp-t-total">⏱ {fmtTimerMs(gameTotalMs)}</span>
      <span class="mp-t-cell" class:mp-t-active={game.activePlayerIndex === 0 && game.phase === 'playing'}>P1 {fmtTimerMs(p0TotalMs)}</span>
      <span class="mp-t-sep">|</span>
      <span class="mp-t-cell" class:mp-t-active={game.activePlayerIndex === 1 && game.phase === 'playing'}>P2 {fmtTimerMs(p1TotalMs)}</span>
      <span class="mp-t-cell mp-t-turn">▶ {fmtTimerMs(liveTurnTimeMs)}</span>
    </div>
  {/if}

  <!-- v5.015：送出新戰鬥寶可夢的等待提示 — 桌機版 +page.svelte:5641-5662 已有同樣 alert，手機 portrait 需自行渲染 -->
  {#if needSendActiveMine}
    <div class="mp-wait-alert mp-wait-warn">⚠️ 請從備戰區派出新的戰鬥寶可夢（下方視窗選擇）</div>
  {:else if needSendActiveOpp && isMyTurn}
    <div class="mp-wait-alert">⏳ 對手戰鬥場空 — 等待對手送出新戰鬥寶可夢</div>
  {/if}

  <!-- ─── 對手 bench ─── -->
  <div class="mp-row mp-opp-bench" use:dragScroll>
    {#each Array(Math.max(5, oppBenchLimit, oppPlayer.bench.length)) as _, i}
      {@const inst = oppPlayer.bench[i]}
      {#if inst}
        {@const c = cardOf(inst)}
        {#if game.phase === 'setup'}
          <div class="mp-slot mp-card-back" title="準備中...">
            <span class="mp-card-back-mark">?</span>
          </div>
        {:else}
          <button class="mp-slot mp-opp-slot" onclick={() => onOpenZoom(inst.cardId, inst)}>
            {#if c?.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}/>{/if}
            <span class="mp-slot-hp">{hpRemaining(inst)}</span>
            {#if inst.energyAttached.length > 0}
              <span class="mp-slot-eg">
                {#each energyPips(inst) as pip}
                  <span class="mp-pip mp-pip-sm" class:mp-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`}>{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                {/each}
              </span>
            {/if}
          </button>
        {/if}
      {:else}
        <div class="mp-slot mp-empty"></div>
      {/if}
    {/each}
  </div>

  <!-- ─── 對手 chips: 獎賞/牌庫/棄牌（緊湊） ─── -->
  <div class="mp-chips mp-opp-chips">
    {#if isTReplay && onOpenPrizes}
      <button class="mp-chip mp-clickable" onclick={onOpenPrizes} title="查看雙方獎賞卡（回放限定）">🎁 {oppPlayer.prizes.length} 🔍</button>
    {:else}
      <span class="mp-chip">🎁 {oppPlayer.prizes.length}</span>
    {/if}
    <span class="mp-chip">📚 {oppPlayer.deck.length}</span>
    <button class="mp-chip mp-clickable" onclick={() => openDiscard(oppPlayer.discard, '對手')} disabled={oppPlayer.discard.length === 0}>🗑 {oppPlayer.discard.length}</button>
    <span class="mp-chip">✋ {oppPlayer.hand.length}</span>
    {#if stadiumCard && game.activeStadium}
      <button class="mp-chip mp-clickable mp-stadium" onclick={() => onOpenZoom(game.activeStadium!.cardId, null)}>🏟 {stadiumCard.name}</button>
    {/if}
  </div>

  <!-- ─── 對手 active ─── -->
  <div class="mp-active-row">
    <!-- v5.383：先攻/後攻標示（左側空白處，鏡射桌面版） -->
    {#if game.firstPlayerIdx !== undefined}
      <span class="mp-turn-order" class:mp-turn-now={game.activePlayerIndex === oppIdx}>{game.firstPlayerIdx === oppIdx ? '先攻' : '後攻'}</span>
    {/if}
    {#if oppPlayer.active}
      {@const inst = oppPlayer.active}
      {@const c = cardOf(inst)}
      {#if game.phase === 'setup'}
        <div class="mp-active mp-active-opp mp-status-none" title="準備中...">
          <div class="mp-card-back mp-active-card-back">
            <span class="mp-card-back-mark">?</span>
          </div>
          <div class="mp-active-info">
            <div class="mp-active-name">？？？</div>
            <div class="mp-hp hp-high">
              <div class="mp-hp-fill" style="width:100%"></div>
              <span>HP ???/???</span>
            </div>
            <div class="mp-meta"><span>準備中</span></div>
          </div>
        </div>
      {:else}
        <button class="mp-active mp-active-opp mp-status-{inst.status ?? 'none'}" onclick={() => onOpenZoom(inst.cardId, inst)}>
          {#if c?.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}/>{/if}
          <div class="mp-active-info">
            <div class="mp-active-name">{c?.name ?? '?'}</div>
            <div class="mp-hp {hpClass(inst)}">
              <div class="mp-hp-fill" style="width:{hpMax(inst) ? (hpRemaining(inst)/hpMax(inst)*100) : 0}%"></div>
              <span>HP {hpRemaining(inst)}/{hpMax(inst)}</span>
            </div>
            <div class="mp-meta">
              {#if inst.energyAttached.length > 0}
                <span class="mp-meta-pips">
                  {#each energyPips(inst) as pip}
                    <span class="mp-pip" class:mp-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                  {/each}
                </span>
              {/if}
              {#if inst.toolAttached || (inst.extraTools && inst.extraTools.length > 0)}<span>🔧{(inst.extraTools && inst.extraTools.length > 0) ? `×${1 + inst.extraTools.length}` : ''}</span>{/if}
              <!-- v5.071：顯示中文 label + emoji，並補 secondaryStatus 雙狀態同顯 -->
              {#if inst.status}<span class="mp-status mp-status-chip-{inst.status}">{
                inst.status==='poisoned'?'☠️ 中毒':
                inst.status==='burned'?'🔥 燒傷':
                inst.status==='asleep'?'💤 睡眠':
                inst.status==='confused'?'😵 混亂':
                inst.status==='paralyzed'?'⚡ 麻痺':inst.status
              }</span>{/if}
              {#if inst.secondaryStatus}<span class="mp-status mp-status-chip-{inst.secondaryStatus}">{
                inst.secondaryStatus==='poisoned' || inst.tertiaryStatus === 'poisoned'?'☠️ 中毒':
                inst.secondaryStatus==='burned' || inst.tertiaryStatus === 'burned'?'🔥 燒傷':
                inst.secondaryStatus==='asleep'?'💤 睡眠':
                inst.secondaryStatus==='confused'?'😵 混亂':
                inst.secondaryStatus==='paralyzed'?'⚡ 麻痺':inst.secondaryStatus
              }</span>{/if}{#if inst.tertiaryStatus}<span class="mp-status mp-status-chip-{inst.tertiaryStatus}">{
                inst.tertiaryStatus==='poisoned' || inst.tertiaryStatus === 'poisoned'?'☠️ 中毒':
                inst.tertiaryStatus==='burned' || inst.tertiaryStatus === 'burned'?'🔥 燒傷':
                inst.tertiaryStatus==='asleep'?'💤 睡眠':
                inst.tertiaryStatus==='confused'?'😵 混亂':
                inst.tertiaryStatus==='paralyzed'?'⚡ 麻痺':inst.tertiaryStatus
              }</span>{/if}
            </div>
          </div>
        </button>
      {/if}
    {:else}
      <div class="mp-active-empty">（對手戰鬥場空）</div>
    {/if}
  </div>

  <!-- ─── Log（撐空間） ─── -->
  <!-- v3.02：套 +page.svelte 同款 tokenize + 卡名可點 -->
  <!-- v5.194：log 改為正序顯示（最舊在上、最新在下）+ 顯示 timestamp [mm:ss]，鏡射桌面版 -->
  <section class="mp-log" bind:this={mpLogEl} onscroll={onMpLogScroll}>
    {#each (game.log ?? []) as entry, i (i + (entry.message ?? ''))}
      {@const _isPrivate = !!(entry.privateMessage && entry.playerIndex === myIdx)}
      {@const _msgText = _isPrivate ? entry.privateMessage : entry.message}
      {@const _lineCls = logLineClass(_msgText ?? '')}
      {@const _tokens = tokenizeLogMessage(_msgText ?? '', cardNamesSorted)}
      {@const _ts = formatLogTimeShort(entry, game?.gameStartTime)}
      <div class="mp-log-line {_lineCls}" class:latest={i === ((game.log ?? []).length - 1)} class:sys={entry.playerIndex === null} class:private={_isPrivate}>
        {#if _ts}<span class="log-time">{_ts}</span>{/if}
        {#if _isPrivate}<span class="log-private-icon" title="只有你看得到">🔒</span>{/if}
        {#each _tokens as tok}{#if tok.cls === 'log-card-link'}<button type="button" class="log-card-link" title="點擊查看 {tok.text} 卡片詳情" onclick={() => openZoomByName(tok.text, tok.iid ?? entry.sourceIid, entry.playerIndex)}>{tok.text}</button>{:else}<span class={tok.cls}>{tok.text}</span>{/if}{/each}
      </div>
    {/each}
  </section>

  <!-- ─── 我方 active ─── -->
  <div class="mp-active-row">
    <!-- v5.383：先攻/後攻標示（左側空白處，鏡射桌面版） -->
    {#if game.firstPlayerIdx !== undefined}
      <span class="mp-turn-order" class:mp-turn-now={game.activePlayerIndex === myIdx}>{game.firstPlayerIdx === myIdx ? '先攻' : '後攻'}</span>
    {/if}
    {#if myPlayer.active}
      {@const inst = myPlayer.active}
      {@const c = cardOf(inst)}
      <button class="mp-active mp-active-mine mp-status-{inst.status ?? 'none'}"
        class:mp-actionable={isPlaying && isMyTurn && isMainPhase && !pendingSelection}
        onclick={() => sheet = { type: 'active' }}>
        {#if c?.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}/>{/if}
        <div class="mp-active-info">
          <div class="mp-active-name">{c?.name ?? '?'}</div>
          <div class="mp-hp {hpClass(inst)}">
            <div class="mp-hp-fill" style="width:{hpMax(inst) ? (hpRemaining(inst)/hpMax(inst)*100) : 0}%"></div>
            <span>HP {hpRemaining(inst)}/{hpMax(inst)}</span>
          </div>
          <div class="mp-meta">
            {#if inst.energyAttached.length > 0}
              <span class="mp-meta-pips">
                {#each energyPips(inst) as pip}
                  <span class="mp-pip" class:mp-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                {/each}
              </span>
            {/if}
            {#if inst.toolAttached || (inst.extraTools && inst.extraTools.length > 0)}<span>🔧{(inst.extraTools && inst.extraTools.length > 0) ? `×${1 + inst.extraTools.length}` : ''}</span>{/if}
            <!-- v5.071：顯示中文 label + emoji，並補 secondaryStatus 雙狀態同顯 -->
              {#if inst.status}<span class="mp-status mp-status-chip-{inst.status}">{
                inst.status==='poisoned'?'☠️ 中毒':
                inst.status==='burned'?'🔥 燒傷':
                inst.status==='asleep'?'💤 睡眠':
                inst.status==='confused'?'😵 混亂':
                inst.status==='paralyzed'?'⚡ 麻痺':inst.status
              }</span>{/if}
              {#if inst.secondaryStatus}<span class="mp-status mp-status-chip-{inst.secondaryStatus}">{
                inst.secondaryStatus==='poisoned' || inst.tertiaryStatus === 'poisoned'?'☠️ 中毒':
                inst.secondaryStatus==='burned' || inst.tertiaryStatus === 'burned'?'🔥 燒傷':
                inst.secondaryStatus==='asleep'?'💤 睡眠':
                inst.secondaryStatus==='confused'?'😵 混亂':
                inst.secondaryStatus==='paralyzed'?'⚡ 麻痺':inst.secondaryStatus
              }</span>{/if}{#if inst.tertiaryStatus}<span class="mp-status mp-status-chip-{inst.tertiaryStatus}">{
                inst.tertiaryStatus==='poisoned' || inst.tertiaryStatus === 'poisoned'?'☠️ 中毒':
                inst.tertiaryStatus==='burned' || inst.tertiaryStatus === 'burned'?'🔥 燒傷':
                inst.tertiaryStatus==='asleep'?'💤 睡眠':
                inst.tertiaryStatus==='confused'?'😵 混亂':
                inst.tertiaryStatus==='paralyzed'?'⚡ 麻痺':inst.tertiaryStatus
              }</span>{/if}
            {#if isPlaying && isMyTurn && isMainPhase}
              <span class="mp-tap-hint">👆 點開動作</span>
            {/if}
          </div>
        </div>
      </button>
    {:else if isSetup}
      <div class="mp-active-empty">點手牌的基礎寶可夢 → 放到戰鬥場</div>
    {:else}
      <div class="mp-active-empty">（戰鬥場空 — 待派出新寶可夢）</div>
    {/if}
  </div>

  <!-- ─── 我方 chips: 獎賞/牌庫/棄牌 ─── -->
  <div class="mp-chips mp-my-chips">
    {#if isTReplay && onOpenPrizes}
      <button class="mp-chip mp-clickable" onclick={onOpenPrizes} title="查看雙方獎賞卡（回放限定）">🎁 {myPlayer.prizes.length} 🔍</button>
    {:else}
      <span class="mp-chip">🎁 {myPlayer.prizes.length}</span>
    {/if}
    <span class="mp-chip">📚 {myPlayer.deck.length}</span>
    <button class="mp-chip mp-clickable" onclick={() => openDiscard(myPlayer.discard, '我方')} disabled={myPlayer.discard.length === 0}>🗑 {myPlayer.discard.length}</button>
    <span class="mp-chip mp-mine">✋ {myPlayer.hand.length}</span>
    {#if canUseStadium && isMyTurn}
      <button class="mp-chip mp-clickable mp-stadium-btn" disabled={actionBusy} onclick={() => onAction(GameActions.useStadium())}>🏟 使用競技場</button>
    {:else}
      <span class="mp-right-chips">
        {#if roomCode}<span class="mp-chip mp-room" title="房間代碼（邀請朋友觀戰 / 回報 bug 用）">🔑 {roomCode}</span>{/if}
        <span class="mp-chip mp-version">v{version}</span>
      </span>
    {/if}
  </div>

  <!-- v5.199：補 !isSpectator gate — 觀戰者不該看到「取得」按鈕（雖 dispatch L3589 已擋，但 UX 不該顯示） -->
  {#if (pendingPrizes ?? 0) > 0 && !isSpectator}
    <div class="mp-prize-alert">
      🏆 取 {pendingPrizes} 張獎賞卡
      <button class="mp-prize-btn" disabled={actionBusy} onclick={() => onAction(GameActions.takePrizes(pendingPrizes!, myIdx, myIdx))}>取得</button>
    </div>
  {/if}

  <!-- ─── 我方 bench ─── -->
  <div class="mp-row mp-my-bench" use:dragScroll>
    {#each Array(Math.max(5, myBenchLimit, myPlayer.bench.length)) as _, i}
      {@const inst = myPlayer.bench[i]}
      {#if inst}
        {@const c = cardOf(inst)}
        {@const hasUsableAbility = usableAbilities.some(u => u.iid === inst.iid)}
        {@const isEvoTarget = evolvableTargets.some(e => e.fromIid === inst.iid)}
        <button class="mp-slot mp-my-slot"
          class:mp-actionable={hasUsableAbility || isEvoTarget}
          onclick={() => sheet = { type: 'bench', inst }}>
          {#if c?.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}/>{/if}
          <span class="mp-slot-hp">{hpRemaining(inst)}</span>
          {#if inst.energyAttached.length > 0}
            <span class="mp-slot-eg">
              {#each energyPips(inst) as pip}
                <span class="mp-pip mp-pip-sm" class:mp-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`}>{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
              {/each}
            </span>
          {/if}
          {#if hasUsableAbility}<span class="mp-slot-ab">✨</span>{/if}
        </button>
      {:else}
        <div class="mp-slot mp-empty"></div>
      {/if}
    {/each}
  </div>

  <!-- ─── 手牌橫向 scroll（底部固定） ─── -->
  <footer class="mp-hand" use:dragScroll>
    <!-- v3.87: 本機雙人換人時用 {#key myIdx} 強制重 mount 手牌 — 修「換人後手牌不顯示」race -->
    {#key myIdx}
    {#if myPlayer.hand.length === 0}
      <div class="mp-hand-empty">（手牌空）</div>
    {:else if isTReplay}
      <!-- v5.954 回放：攤開主視角(行動方)手牌明牌，唯讀，點擊放大(比照桌機 v5.940 spectator-hand-face)。cardOf null 時 fallback 卡背 -->
      {#each dedupeByIid(myPlayer.hand) as inst (inst.iid)}
        {@const c = cardOf(inst)}
        <button class="mp-hand-card mp-hand-replay" onclick={() => onOpenZoom(inst.cardId, inst)} title={c?.name} aria-label={c?.name ?? '手牌'}>
          {#if c?.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}
            class:legend-half-l={twoCardStadiumHalfIndex(myPlayer.hand, inst.iid, pool) === 0}
            class:legend-half-r={twoCardStadiumHalfIndex(myPlayer.hand, inst.iid, pool) === 1}/>{:else}<div class="mp-card-back mp-hand-back-fill"><span class="mp-card-back-mark">?</span></div>{/if}
        </button>
      {/each}
    {:else if isTournSpectator}
      <!-- v5.895：錦標賽觀戰者手牌渲染成卡背（伺服器已 redact，不查卡；比照桌機 spectator-hand-back） -->
      {#each dedupeByIid(myPlayer.hand) as inst (inst.iid)}
        <div class="mp-hand-card mp-hand-back"><div class="mp-card-back mp-hand-back-fill"><span class="mp-card-back-mark">?</span></div></div>
      {/each}
    {:else}
      {#each dedupeByIid(myPlayer.hand) as inst (inst.iid)}
        {@const c = cardOf(inst)}
        <!-- ⭐⭐⭐v6.201：黃框＝「中央述詞說這張卡有任何一種可用操作」，與 sheet 的按鈕同源。
             禁止在這裡再組任何條件（那就是第二份判定的起點）。 -->
        {@const _ops = opsOf(inst.iid)}
        {@const playable = _ops.size > 0}
        {@const isPlayableTrainer = (_ops.has('trainer') || _ops.has('tool')) && !!c && (c.supertype === 'Trainer')}
        <!-- v6.086「兩張合一」競技場：手牌顯示成兩張直立的卡（同一張合併橫圖裁左半／右半） -->
        {@const _half = twoCardStadiumHalfIndex(myPlayer.hand, inst.iid, pool)}
        <button class="mp-hand-card" class:mp-playable={playable} disabled={actionBusy} onclick={() => tapHand(inst)} title={c?.name}>
          {#if c?.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name}
            class:legend-half-l={_half === 0} class:legend-half-r={_half === 1}/>{/if}
          {#if isPlayableTrainer && isMyTurn}
            <div class="mp-card-hint">{c?.subtype === 'Stadium' ? '🏟' : c?.subtype === 'Supporter' ? '👤' : '🎴'}</div>
          {/if}
        </button>
      {/each}
    {/if}
    {/key}
  </footer>
</div>

<!-- ─── Bottom Sheet：動作選單 ─── -->
{#if sheet}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- v5.205：拖曳時 overlay 加 .dragged → 背景透明 + pointer-events: none（仿桌面 modal）-->
  <div class="mp-sheet-overlay" class:dragged={sheetDragged} onclick={closeSheet} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="mp-sheet" style:transform={`translate(${sheetOffset.x}px, ${sheetOffset.y}px)`} onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      {#if sheet.type === 'hand'}
        {@const acts = handActions(sheet.inst)}
        {@const c = cardOf(sheet.inst)}
        <div class="mp-sheet-title mp-sheet-drag-handle" onpointerdown={onSheetHeaderPointerDown} onpointermove={onSheetHeaderPointerMove} onpointerup={onSheetHeaderPointerUp} title="拖曳視窗位置">{c?.name ?? '?'}</div>
        {#if acts.length === 0}
          <div class="mp-sheet-empty">本回合無可執行動作</div>
        {/if}
        {#each acts as a}
          <button class="mp-sheet-btn" class:primary={a.primary} disabled={a.disabled || actionBusy} onclick={a.action}>{a.label}</button>
        {/each}
      {:else if sheet.type === 'active'}
        {@const acts = activeActions()}
        <div class="mp-sheet-title mp-sheet-drag-handle" onpointerdown={onSheetHeaderPointerDown} onpointermove={onSheetHeaderPointerMove} onpointerup={onSheetHeaderPointerUp} title="拖曳視窗位置">戰鬥寶可夢動作</div>
        {#if acts.length === 0}
          <div class="mp-sheet-empty">本回合無可執行動作</div>
        {/if}
        {#each acts as a}
          {#if a.zoomIid}
            <!-- v3.32 撤退類項目：主按鈕 + 🔍 zoom 副按鈕 -->
            <div class="mp-sheet-row">
              <button class="mp-sheet-btn mp-sheet-btn-flex" class:primary={a.primary} disabled={a.disabled || actionBusy} onclick={a.action}>{a.label}</button>
              <button class="mp-sheet-zoom" title="放大檢視" onclick={() => {
                closeSheet();
                const inst = [...(myPlayer.active ? [myPlayer.active] : []), ...myPlayer.bench].find(x => x.iid === a.zoomIid);
                if (inst) onOpenZoom(inst.cardId, inst);
              }}>🔍</button>
            </div>
          {:else}
            <button class="mp-sheet-btn" class:primary={a.primary} disabled={a.disabled || actionBusy} onclick={a.action}>{a.label}</button>
          {/if}
        {/each}
      {:else if sheet.type === 'bench'}
        {@const acts = benchActions(sheet.inst)}
        {@const c = cardOf(sheet.inst)}
        <div class="mp-sheet-title mp-sheet-drag-handle" onpointerdown={onSheetHeaderPointerDown} onpointermove={onSheetHeaderPointerMove} onpointerup={onSheetHeaderPointerUp} title="拖曳視窗位置">{c?.name ?? '?'}</div>
        {#each acts as a}
          <button class="mp-sheet-btn" class:primary={a.primary} disabled={actionBusy} onclick={a.action}>{a.label}</button>
        {/each}
      {:else if sheet.type === 'pick-energy-target'}
        <!-- v5.200：附加能量目標改卡圖網格（鏡射桌面送新戰鬥位 modal UX）-->
        <div class="mp-sheet-title mp-sheet-drag-handle" onpointerdown={onSheetHeaderPointerDown} onpointermove={onSheetHeaderPointerMove} onpointerup={onSheetHeaderPointerUp} title="拖曳視窗位置">⚡ 選擇附加目標</div>
        <div class="mp-pick-grid">
          {#each energyTargets() as tinst}
            {@const c = cardOf(tinst)}
            {@const allTools = [...(tinst.toolAttached ? [tinst.toolAttached] : []), ...(tinst.extraTools ?? [])]}
            {@const toolCnt = allTools.length}
            <div class="mp-pick-card">
              {#if tinst.iid === myPlayer.active?.iid}<span class="mp-pick-active-badge">⚔️ 戰鬥</span>{/if}
              <button class="mp-pick-zoom" title="放大檢視：{c?.name ?? '?'}"
                onclick={(e) => { e.stopPropagation(); closeSheet(); onOpenZoom(tinst.cardId, tinst); }}>🔍</button>
              <button class="mp-pick-btn" disabled={actionBusy} onclick={() => attachEnergy(sheet!.type === 'pick-energy-target' ? sheet!.energyIid : '', tinst.iid)}>
                {#if c?.imageUrl}<img use:retryImg={c.imageUrl} src={c.imageUrl} alt={c.name} loading="lazy"/>{/if}
                <div class="mp-pick-name">{c?.name ?? '?'}</div>
                <div class="mp-pick-meta">HP {hpRemaining(tinst)}/{hpMax(tinst)}</div>
                <div class="mp-pick-pips">
                  {#each energyPips(tinst) as pip}
                    <span class="mp-pip mp-pip-sm" class:mp-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                  {/each}
                  {#if tinst.energyAttached.length === 0}<span class="mp-pick-noenergy">無能量</span>{/if}
                </div>
                {#if toolCnt > 0}<div class="mp-pick-meta">🔧 {toolCnt}</div>{/if}
                {#if tinst.status}<div class="mp-pick-status">⚠️ {tinst.status === 'poisoned' ? '☠️' : tinst.status === 'burned' ? '🔥' : tinst.status === 'asleep' ? '💤' : tinst.status === 'confused' ? '😵' : tinst.status === 'paralyzed' ? '⚡' : tinst.status}</div>{/if}
              </button>
            </div>
          {/each}
        </div>
      {:else if sheet.type === 'pick-evolve-target'}
        <!-- v5.200：進化目標改卡圖網格 -->
        <div class="mp-sheet-title mp-sheet-drag-handle" onpointerdown={onSheetHeaderPointerDown} onpointermove={onSheetHeaderPointerMove} onpointerup={onSheetHeaderPointerUp} title="拖曳視窗位置">🔺 選擇進化目標</div>
        <div class="mp-pick-grid">
          {#each (sheet.type === 'pick-evolve-target' ? sheet.candidates : []) as fromIid}
            {@const inst = [...(myPlayer.active ? [myPlayer.active] : []), ...myPlayer.bench].find(x => x.iid === fromIid)}
            {#if inst}
              {@const ic = cardOf(inst)}
              {@const allTools = [...(inst.toolAttached ? [inst.toolAttached] : []), ...(inst.extraTools ?? [])]}
              {@const toolCnt = allTools.length}
              <div class="mp-pick-card">
                {#if inst.iid === myPlayer.active?.iid}<span class="mp-pick-active-badge">⚔️ 戰鬥</span>{/if}
                <button class="mp-pick-zoom" title="放大檢視：{ic?.name ?? '?'}"
                  onclick={(e) => { e.stopPropagation(); closeSheet(); onOpenZoom(inst.cardId, inst); }}>🔍</button>
                <button class="mp-pick-btn" disabled={actionBusy} onclick={() => evolveTo(fromIid, (sheet as { evoIid: string }).evoIid)}>
                  {#if ic?.imageUrl}<img use:retryImg={ic.imageUrl} src={ic.imageUrl} alt={ic.name} loading="lazy"/>{/if}
                  <div class="mp-pick-name">{ic?.name ?? '?'}</div>
                  <div class="mp-pick-meta">HP {hpRemaining(inst)}/{hpMax(inst)}</div>
                  <div class="mp-pick-pips">
                    {#each energyPips(inst) as pip}
                      <span class="mp-pip mp-pip-sm" class:mp-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                    {/each}
                    {#if inst.energyAttached.length === 0}<span class="mp-pick-noenergy">無能量</span>{/if}
                  </div>
                  {#if toolCnt > 0}<div class="mp-pick-meta">🔧 {toolCnt}</div>{/if}
                  {#if inst.status}<div class="mp-pick-status">⚠️ {inst.status === 'poisoned' ? '☠️' : inst.status === 'burned' ? '🔥' : inst.status === 'asleep' ? '💤' : inst.status === 'confused' ? '😵' : inst.status === 'paralyzed' ? '⚡' : inst.status}</div>{/if}
                </button>
              </div>
            {/if}
          {/each}
        </div>
      {:else if sheet.type === 'pick-retreat-target'}
        <!-- v5.200：撤退選備戰改卡圖網格（鏡射桌面送新戰鬥位 modal）-->
        <div class="mp-sheet-title mp-sheet-drag-handle" onpointerdown={onSheetHeaderPointerDown} onpointermove={onSheetHeaderPointerMove} onpointerup={onSheetHeaderPointerUp} title="拖曳視窗位置">🔄 選擇換入的寶可夢{currentRetreatCost !== null ? `（撤退費 -${currentRetreatCost}）` : ''}</div>
        <div class="mp-pick-grid">
          {#each myPlayer.bench as b}
            {@const bc = cardOf(b)}
            {@const allTools = [...(b.toolAttached ? [b.toolAttached] : []), ...(b.extraTools ?? [])]}
            {@const toolCnt = allTools.length}
            <div class="mp-pick-card">
              <button class="mp-pick-zoom" title="放大檢視：{bc?.name ?? '?'}"
                onclick={(e) => { e.stopPropagation(); closeSheet(); onOpenZoom(b.cardId, b); }}>🔍</button>
              <button class="mp-pick-btn" disabled={actionBusy} onclick={() => retreatTo(b.iid)}>
                {#if bc?.imageUrl}<img use:retryImg={bc.imageUrl} src={bc.imageUrl} alt={bc.name} loading="lazy"/>{/if}
                <div class="mp-pick-name">{bc?.name ?? '?'}</div>
                <div class="mp-pick-meta">HP {hpRemaining(b)}/{hpMax(b)}</div>
                <div class="mp-pick-pips">
                {#each energyPips(b) as pip}
                  <span class="mp-pip mp-pip-sm" class:mp-pip-rainbow={pip.type === 'Rainbow'} style={pip.type === 'Rainbow' ? undefined : `background:${ENERGY_COLOR[pip.type as EnergyType]}`} title="{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]} × {pip.count}">{pip.label ?? ENERGY_LABEL[pip.type as EnergyType]}{pip.count > 1 ? pip.count : ''}</span>
                {/each}
                {#if b.energyAttached.length === 0}<span class="mp-pick-noenergy">無能量</span>{/if}
              </div>
              {#if toolCnt > 0}<div class="mp-pick-meta">🔧 {toolCnt}</div>{/if}
                {#if b.status}<div class="mp-pick-status">⚠️ {b.status === 'poisoned' ? '☠️' : b.status === 'burned' ? '🔥' : b.status === 'asleep' ? '💤' : b.status === 'confused' ? '😵' : b.status === 'paralyzed' ? '⚡' : b.status}</div>{/if}
              </button>
            </div>
          {/each}
        </div>
      {:else if sheet.type === 'discard'}
        <div class="mp-sheet-title mp-sheet-drag-handle" onpointerdown={onSheetHeaderPointerDown} onpointermove={onSheetHeaderPointerMove} onpointerup={onSheetHeaderPointerUp} title="拖曳視窗位置">🗑 {sheet.owner}棄牌區（{sheet.list.length} 張）</div>
        <!-- v5.129：改 grid 顯示「卡圖縮圖 + 右下角紅色數字」，更易檢索 -->
        <div class="mp-discard-grid">
          {#each groupDiscardList(sheet.list) as g (g.key)}
            {@const gc = pool.get(g.cardId)}
            <button class="mp-discard-cell" onclick={() => { closeSheet(); onOpenZoom(g.cardId, g.inst); }} title="放大查看 {g.name}">
              {#if gc?.imageUrl}
                <img use:retryImg={gc.imageUrl} src={gc.imageUrl} alt={g.name} class="mp-discard-img"
                  class:legend-half-l={g.half === 0} class:legend-half-r={g.half === 1}/>
              {:else}
                <div class="mp-discard-placeholder">{g.name}</div>
              {/if}
              {#if g.half !== 0 && g.half !== 1}<span class="mp-discard-count">×{g.count}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
      <button class="mp-sheet-cancel" onclick={closeSheet}>取消</button>
    </div>
  </div>
{/if}

<style>
  /* ════════════════════════════════════════════════════════════════════
     v2.286：手機直式完整 layout — 一頁不滑、手牌橫滑、tap-action 互動
     ════════════════════════════════════════════════════════════════════ */
  .mp {
    /* v3.861: 強制 fixed 定位到 viewport，避免 iOS Safari 整頁因 dynamic viewport
       / pull-to-refresh / overscroll bounce 等行為讓內容上下位移。
       body.mp-locked 已加 position:fixed，但 .mp 自己也設 fixed 才能徹底鎖死。 */
    position: fixed;
    inset: 0;
    height: 100vh; height: 100dvh;
    display: flex; flex-direction: column;
    background: #1a2e1a;
    color: #f0f0f0;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
    overflow: hidden;
    user-select: none;
    /* v3.861: 整個 .mp 禁用觸控手勢（但內部 .mp-row / .mp-hand / .mp-log / .mp-chips 各自開放） */
    touch-action: none;
    overscroll-behavior: none;
    /* v2.287：iPhone 動態島 / 瀏海 / home indicator 安全區
       padding 算進 100dvh 內（border-box 預設）；safe-area 兩端各退一些避免被遮 */
    box-sizing: border-box;
    /* v6.186 全站手機直式「卡面長寬比」單一來源 — 戰鬥位卡圖與卡背都讀這個變數，
       不再各自寫死數字（實體卡 63mm x 88mm）。 */
    --mp-card-ar: 63 / 88;
    /* v6.187：改讀全站唯一來源 --safe-* （定義在 src/routes/+layout.svelte 的 :root）。
       數值與行為與 env(safe-area-inset-*) 完全相同，只是不再各自寫一份。 */
    padding-top: var(--safe-top, 0px);
    padding-bottom: var(--safe-bottom, 0px);
    padding-left: var(--safe-left, 0px);
    padding-right: var(--safe-right, 0px);
  }
  /* v4.24 對戰計時器細條 — mp-top 下方 ~20px，4 欄資訊 */
  .mp-timer-strip {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 8px;
    gap: 6px;
    background: rgba(0, 0, 0, 0.55);
    color: #afdbff;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.02em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .mp-t-cell { white-space: nowrap; }
  .mp-t-total { opacity: 0.92; }
  .mp-t-sep { color: rgba(255,255,255,0.18); }
  .mp-t-active { color: #c8f0a0; font-weight: 600; }
  .mp-t-turn { color: #ffd494; font-weight: 600; }

  /* v3.861: 內部可滾動區允許各自方向手勢（不會冒泡到 .mp） */
  .mp-row { touch-action: pan-x; }
  .mp-hand { touch-action: pan-x; }
  .mp-log { touch-action: pan-y; }
  .mp-chips { touch-action: pan-x; }

  /* v4.22 手機版場地卡背景圖層 — fixed 覆蓋 .mp 區域，z-index:0 在 #1a2e1a 純色底之上但所有 UI 元素之下 */
  /* v4.23 修：移除 mask-image（下半透明導致自己這邊不顯示）+ opacity 0.32 → 0.55 增加存在感
     手機 portrait 容器很高，背景圖 cover 模式會把整張卡（含文字）以接近原比例填滿，
     但 0.55 opacity + 2px blur 之下文字部分視覺上只是模糊雜訊，不會影響 UI 可讀性 */
  .mp-stadium-bg-layer {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-size: cover;
    background-position: center top;
    background-repeat: no-repeat;
    opacity: 0.55;
    filter: blur(2px);
    pointer-events: none;
  }
  /* 確保 .mp 內所有後續 child 元素疊在背景圖之上 */
  .mp > :not(.mp-stadium-bg-layer) { position: relative; z-index: 1; }

  /* ── Top bar ────────────────────────────────────────────────────── */
  .mp-top {
    flex: 0 0 32px;
    display: flex; align-items: center; gap: 0.3rem;
    padding: 0 0.4rem;
    background: #0a180a;
    border-bottom: 1px solid #2a4a2a;
    font-size: 0.72rem;
  }
  .mp-icon-btn {
    background: transparent; color: #8cf;
    border: 1px solid #2a4a6a; border-radius: 4px;
    padding: 2px 8px; font-size: 0.78rem; cursor: pointer;
  }
  /* v5.195：悔棋按鈕改成橘黃底漸層 + 加寬，鏡射綠底結束回合按鈕的明顯度
     (與綠色結束回合區隔，橘黃讓玩家直覺「警示/回復」操作) */
  .mp-undo-btn {
    background: linear-gradient(180deg, #c88a2a, #a86a1a) !important;
    color: #fff !important;
    border: 1px solid #d8a040 !important;
    padding: 3px 12px !important;
    font-size: 0.78rem !important;
    font-weight: 700;
    box-shadow: 0 0 4px rgba(255,180,80,0.4);
  }
  .mp-undo-btn:active {
    background: linear-gradient(180deg, #a86a1a, #884a0a) !important;
  }
  .mp-turn-text { color: #cef; font-weight: 600; }
  .mp-phase { color: #ffd44a; font-size: 0.7rem; }
  .mp-spacer { flex: 1; }
  .mp-tag {
    background: #3a2a1a; color: #fa8;
    border: 1px solid #5a3a1a; border-radius: 8px;
    padding: 1px 6px; font-size: 0.7rem;
  }
  .mp-end-btn {
    background: linear-gradient(180deg, #3a8a3a, #2a6a2a);
    color: #fff;
    border: 1px solid #4a8a4a; border-radius: 4px;
    padding: 3px 10px; font-size: 0.74rem; font-weight: 700;
    cursor: pointer;
  }
  .mp-end-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .mp-end-btn:active { background: linear-gradient(180deg, #2a6a2a, #1a5a1a); }

  /* ── Bench rows（橫向縮小） ─────────────────────────────────────── */
  .mp-row {
    flex: 0.8; /* 備戰區彈性，但比例低於戰鬥區 */
    min-height: 80px;
    max-height: 110px;
    display: flex; gap: 4px;
    padding: 4px 6px;
    overflow-x: auto;
  }
  .mp-row::-webkit-scrollbar { display: none; }
  /* v5.379 滑鼠橫向拖曳捲動：游標提示 + 拖曳中禁止選字 */
  .mp-hand, .mp-row.mp-opp-bench, .mp-row.mp-my-bench { cursor: grab; }
  .mp-dragging { cursor: grabbing !important; user-select: none; }
  .mp-row { scrollbar-width: none; }
  .mp-opp-bench { background: linear-gradient(180deg, rgba(80,30,30,0.5), rgba(60,20,20,0.3)); }
  .mp-my-bench { background: linear-gradient(0deg, rgba(30,40,80,0.5), rgba(20,30,40,0.3)); }
  .mp-slot {
    /* v6.186 ⚠ 必須明寫 border-box：同一個 .mp-slot 在 setup 是 <div>(卡背)、
       在 playing 是 <button>(卡圖)，而 <button> 的 UA 預設就是 border-box、<div> 是
       content-box → 同樣 height:100% 會解出差 2px 的盒高，造成兩階段版面跳動。 */
    box-sizing: border-box;
    flex: 1 1 0; min-width: 52px; max-width: 90px; height: 100%;
    background: rgba(0,0,0,0.4);
    border: 1px solid #3a5a3a; border-radius: 4px;
    padding: 1px;
    cursor: pointer;
    position: relative;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .mp-opp-slot { border-color: #5a3a3a; }
  .mp-my-slot { border-color: #3a6a3a; }
  .mp-empty {
    border-style: dashed; border-color: rgba(255,255,255,0.1);
    background: transparent; cursor: default;
  }
  .mp-slot img {
    width: 100%; height: 100%;
    object-fit: cover; border-radius: 3px;
    pointer-events: none;
  }
  .mp-slot-hp {
    position: absolute; bottom: 1px; left: 1px;
    background: rgba(0,0,0,0.7); color: #afa;
    padding: 0 3px; border-radius: 3px;
    font-size: 0.62rem; font-weight: 700;
  }
  .mp-slot-eg {
    position: absolute; top: 1px; right: 1px;
    background: rgba(0,0,0,0.7); color: #ffd44a;
    padding: 0 3px; border-radius: 3px;
    font-size: 0.62rem;
  }
  .mp-slot-ab {
    position: absolute; top: 1px; left: 1px;
    background: rgba(255,212,74,0.85); color: #000;
    padding: 0 3px; border-radius: 3px;
    font-size: 0.6rem;
  }
  .mp-actionable { box-shadow: 0 0 6px rgba(255,212,74,0.6); border-color: #e0b030 !important; }

  /* ── Chips row（獎賞/牌庫/棄牌 緊湊） ───────────────────────────── */
  .mp-chips {
    flex: 0 0 22px;
    display: flex; gap: 4px;
    padding: 0 6px;
    overflow-x: auto;
    align-items: center;
    font-size: 0.65rem;
    position: relative; z-index: 10;
  }
  .mp-chips::-webkit-scrollbar { display: none; }
  .mp-chips { scrollbar-width: none; }
  .mp-opp-chips { background: rgba(80,30,30,0.3); border-bottom: 1px solid rgba(255,255,255,0.05); }
  .mp-my-chips { background: rgba(30,40,80,0.3); border-top: 1px solid rgba(255,255,255,0.05); }
  .mp-chip {
    /* v6.186 同理：.mp-chip 同時用在 <span> 與 <button> 上 */
    box-sizing: border-box;
    flex-shrink: 0;
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 1px 6px;
    color: #ddd; font-size: 0.62rem;
    white-space: nowrap;
  }
  .mp-chip.mp-mine { color: #afa; }
  .mp-chip.mp-version { color: #c0a0e0; font-family: monospace; }
  .mp-right-chips { margin-left: auto; display: flex; gap: 0.25rem; align-items: center; }
  .mp-chip.mp-room { color: #7fffd4; font-weight: 700; letter-spacing: 0.5px; }
  button.mp-chip { cursor: pointer; }
  button.mp-chip:disabled { opacity: 0.4; cursor: default; }
  button.mp-clickable { background: rgba(60,40,80,0.5); border-color: rgba(180,140,220,0.3); }

  /* ── Active 大圖 ─────────────────────────────────────────────────── */
  .mp-active-row {
    flex: 1.2;
    min-height: 88px;
    max-height: 160px;
    display: flex; justify-content: center;
    padding: 4px 8px;
    position: relative; /* v5.383：給先攻/後攻徽章絕對定位用 */
  }
  /* v5.383：先攻/後攻直書徽章，放左側空白處，不影響卡片置中 */
  .mp-turn-order {
    position: absolute; left: 6px; top: 50%; transform: translateY(-50%);
    writing-mode: vertical-rl; text-orientation: upright;
    font-size: 0.6rem; font-weight: 700; letter-spacing: 1px; line-height: 1.05;
    padding: 4px 3px; border-radius: 5px; z-index: 2; pointer-events: none;
    color: #cfd8e8; background: rgba(60,70,100,0.55); border: 1px solid #4a5878;
  }
  .mp-turn-order.mp-turn-now { color: #1a1a1a; background: rgba(224,176,48,0.92); border-color: #e0b030; }
  .mp-active {
    /* v6.186 ⚠ 必須明寫 border-box（真因）：setup 的對手戰鬥位是 <div class="mp-active">，
       playing 是 <button class="mp-active">。<button> UA 預設 border-box、<div> content-box，
       同樣 height:100% 讓 div 版的內容盒多出 padding 8px + border 4px = 12px，
       裡面 height:100% 的卡背就跟著大一圈（實測 118.53x164 vs 卡圖 105.98x148）。 */
    box-sizing: border-box;
    display: flex; gap: 8px; align-items: center;
    background: rgba(0,0,0,0.5);
    border: 2px solid #3a3a3a;
    border-radius: 8px;
    padding: 4px;
    cursor: pointer;
    width: 100%; max-width: 380px;
    height: 100%;
    /* v2.9994: 明確設定亮色，避免 button 預設深色（buttontext system color）讓
       inside 文字（如 mp-meta 內的能量數字 ⚡N 的 N）難以辨識。 */
    color: #f0f0f0;
  }
  .mp-active.mp-active-opp { border-color: #5a3a3a; background: linear-gradient(180deg, rgba(80,30,30,0.5), rgba(40,20,20,0.4)); }
  .mp-active.mp-active-mine { border-color: #3a6a3a; background: linear-gradient(0deg, rgba(30,60,30,0.5), rgba(20,40,20,0.4)); }
  .mp-active.mp-actionable { border-color: #e0b030; box-shadow: 0 0 12px rgba(255,212,74,0.4); }
  /* v6.186 ⭐ 戰鬥位「卡面尺寸單一來源」：
     setup 的卡背（.mp-active-card-back）與 playing 的卡圖（img）共用同一組幾何宣告，
     不是各寫各的數字 —— 以後只要改這一處，兩個階段一定同步。 */
  .mp-active img,
  .mp-active .mp-active-card-back {
    height: 100%; width: auto;
    aspect-ratio: var(--mp-card-ar, 63 / 88);
    max-width: 120px;
    flex-shrink: 0;
  }
  .mp-active img {
    object-fit: contain; border-radius: 4px;
    pointer-events: none;
  }
  /* v5.955 卡背改用桌機版同款仿真卡背(紅白同心圓),手機/桌機視覺一致 */
  .mp-card-back {
    /* v6.186 border-box：卡背有 2px 邊框，若用 content-box，aspect-ratio 會算在內容盒上，
       外框再加 4px → 比同高的卡圖寬。 */
    box-sizing: border-box;
    background: radial-gradient(circle at 50% 50%, #f0f4ff 0 12%, #ffffff 12% 14%, #1a1a1a 14% 18%, #c0392b 18% 50%, #922b21 50% 100%);
    border: 2px solid #1a1a1a;
    border-radius: 6px;
    box-shadow: inset 0 0 6px rgba(0,0,0,.6);
    display: flex; align-items: center; justify-content: center;
  }
  .mp-card-back-mark { color: rgba(255,255,255,.85); font-weight: 900; font-family: 'Times New Roman', serif; font-size: 1.5rem; text-shadow: 0 1px 2px rgba(0,0,0,.7); }
  /* v5.895 觀戰手牌卡背：填滿 .mp-hand-card(64x86) */
  .mp-hand-card.mp-hand-back { cursor: default; }
  .mp-hand-card.mp-hand-replay { cursor: zoom-in; }  /* v5.954 回放手牌明牌:點擊放大 */
  .mp-card-back.mp-hand-back-fill { width: 100%; height: 100%; }
  .mp-slot.mp-card-back { padding: 0; width: auto; height: 100%; }

  .mp-active-info {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  .mp-active-name {
    font-size: 0.85rem; font-weight: 700;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mp-hp {
    position: relative;
    height: 14px;
    background: rgba(0,0,0,0.6);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 3px;
    overflow: hidden;
  }
  .mp-hp-fill {
    position: absolute; top: 0; left: 0; bottom: 0;
    background: linear-gradient(90deg, #6c6, #4a4);
    transition: width 0.3s ease, background 0.3s ease;
  }
  /* v2.286 Phase 4：HP bar 顏色依比例 */
  .mp-hp.hp-mid .mp-hp-fill { background: linear-gradient(90deg, #ec6, #c84); }
  .mp-hp.hp-low .mp-hp-fill { background: linear-gradient(90deg, #e66, #c44); }
  /* v2.286 Phase 4：active 卡狀態異常 glow */
  .mp-active.mp-status-poisoned { box-shadow: 0 0 14px rgba(180, 90, 220, 0.6); border-color: #a060c0; }
  .mp-active.mp-status-burned { box-shadow: 0 0 14px rgba(255, 100, 50, 0.7); border-color: #d04a20; }
  .mp-active.mp-status-asleep { box-shadow: 0 0 14px rgba(120, 160, 220, 0.6); border-color: #5080c0; opacity: 0.85; }
  .mp-active.mp-status-paralyzed { box-shadow: 0 0 14px rgba(255, 220, 60, 0.6); border-color: #d0b020; }
  .mp-active.mp-status-confused { box-shadow: 0 0 14px rgba(220, 100, 220, 0.6); border-color: #c050c0; }
  .mp-hp span {
    position: relative; z-index: 1;
    display: block; text-align: center;
    font-size: 0.62rem; line-height: 14px;
    color: #fff; text-shadow: 0 0 3px rgba(0,0,0,0.9);
  }
  .mp-meta {
    display: flex; gap: 6px; flex-wrap: wrap;
    font-size: 0.66rem;
  }
  /* v4.49 能量屬性 pip — 仿 +page.svelte .nrg-pip 但縮小給手機 */
  .mp-pip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 14px;
    padding: 0 3px;
    margin-right: 2px;
    font-size: 0.62rem;
    font-weight: 700;
    color: #fff;
    border-radius: 7px;
    text-shadow: 0 1px 1px rgba(0,0,0,0.5);
    line-height: 1;
    flex-shrink: 0;
  }
  .mp-pip.mp-pip-sm {
    min-width: 12px;
    height: 11px;
    padding: 0 2px;
    font-size: 0.5rem;
    border-radius: 5px;
    margin-right: 1px;
  }
  .mp-pip.mp-pip-rainbow {
    background: linear-gradient(45deg, #f00 0%, #ff8 25%, #0f0 50%, #08f 75%, #f0f 100%);
  }
  .mp-meta-pips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 1px;
    align-items: center;
  }

  /* v2.9994: 明確設定能量/道具/狀態指示器文字為亮黃，與 ⚡ emoji 顏色一致；
     避免在某些 device 上 button 預設文字色覆蓋導致數字深色難讀。 */
  .mp-meta span { background: rgba(0,0,0,0.4); padding: 0 5px; border-radius: 3px; color: #ffd44a; }
  .mp-meta .mp-status { color: #ff8; }
  .mp-tap-hint { color: #ffd44a; animation: mp-pulse 1.5s ease-in-out infinite; }
  @keyframes mp-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .mp-active-empty {
    width: 100%; max-width: 360px;
    text-align: center; padding: 0.8rem;
    color: #888; font-size: 0.78rem;
    border: 2px dashed #444; border-radius: 6px;
    background: rgba(0,0,0,0.25);
  }

  /* ── Log（撐空間） ─────────────────────────────────────────────── */
  .mp-log {
    flex: 1; min-height: 50px; max-height: 120px;
    overflow-y: auto;
    padding: 3px 8px;
    font-size: 0.65rem;
    line-height: 1.3;
    background: rgba(0,0,0,0.4);
    border-top: 1px solid rgba(255,255,255,0.05);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    display: flex; flex-direction: column;
  }
  /* v5.194：log timestamp 樣式（鏡射桌面版 .log-line .log-time） */
  .mp-log-line .log-time { color:#6a8a6a; font-size:.68rem; margin-right:.3rem; font-variant-numeric:tabular-nums; opacity:.75; }
  .mp-log-line {
    padding: 1px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    color: #bbb;
  }
  .mp-log-line.latest { color: #ffd44a; font-weight: 600; }
  .mp-log-line.sys { color: #8cf; font-style: italic; }
  /* v3.02：log 內 token 著色（mobile 端對應 +page.svelte 主版色票，但縮小） */
  .mp-log-line .log-bracket   { color:#ffd166; font-weight:700; }
  .mp-log-line .log-ko        { color:#ff6b6b; font-weight:700; }
  .mp-log-line .log-prize     { color:#ffc93c; font-weight:700; }
  .mp-log-line .log-damage    { color:#ff8a65; font-weight:600; }
  .mp-log-line .log-heal      { color:#7fdc7f; font-weight:600; }
  .mp-log-line .log-status    { color:#ce93d8; font-weight:600; }
  .mp-log-line .log-evolve    { color:#7fdc7f; font-weight:600; }
  .mp-log-line .log-coin      { color:#fff59d; font-weight:600; }
  .mp-log-line .log-secondary { color:#7a8a7a; }
  /* v3.02 卡名可點連結 — button 形式 */
  .mp-log-line .log-card-link {
    display: inline;
    background: transparent; border: none; padding: 0; margin: 0;
    font: inherit;
    color: #80c0ff;
    text-decoration: underline;
    cursor: pointer;
    line-height: inherit;
  }
  .mp-log-line .log-card-link:hover { color: #a0d0ff; background: rgba(128,192,255,0.1); }
  .mp-log-line .log-card-link:focus { outline: 1px dotted #a0d0ff; outline-offset: 1px; }
  .mp-log-line.log-turn-marker { background: rgba(170,200,255,.08); color:#bcd4ff; font-weight:700; padding: 2px 4px; }
  .mp-log-line.log-victory { background: rgba(255,200,80,.12); color:#ffe082; font-weight:700; padding: 2px 4px; }
  .mp-log-line.private { color: #d0c0ff; }
  .log-private-icon { margin-right:.2rem; opacity:.8; font-size:.85em; }

  /* ── 手牌底部橫向 scroll ─────────────────────────────────────── */
  .mp-hand {
    flex: 0 0 96px;
    display: flex; gap: 4px;
    overflow-x: auto;
    padding: 4px 6px;
    background: #0a160a;
    border-top: 2px solid #2a5a2a;
    -webkit-overflow-scrolling: touch;
  }
  .mp-hand::-webkit-scrollbar { height: 0; }
  .mp-hand-empty {
    color: #666; font-style: italic;
    align-self: center; padding: 0 1rem;
    font-size: 0.72rem;
  }
  .mp-hand-card {
    /* v6.186 同理：觀戰/回放的卡背用 <div class="mp-hand-card">，一般手牌是 <button> */
    box-sizing: border-box;
    flex-shrink: 0;
    width: 64px; height: 86px;
    border: 1px solid #3a5a3a;
    border-radius: 4px;
    padding: 0;
    background: transparent;
    cursor: pointer;
    overflow: hidden;
  }
  .mp-hand-card img {
    width: 100%; height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  /* v5.195：可使用手牌黃框加強 — 加粗到 3px + 強發光 + pulse animation
     原 1px border + 微弱發光在手機螢幕上不顯眼，玩家容易漏看 */
  .mp-hand-card.mp-playable {
    border: 3px solid #ffd44a;
    box-shadow:
      0 0 12px rgba(255,212,74,0.85),
      inset 0 0 6px rgba(255,212,74,0.4);
    animation: mp-playable-pulse 1.4s ease-in-out infinite;
  }
  @keyframes mp-playable-pulse {
    0%, 100% {
      box-shadow:
        0 0 12px rgba(255,212,74,0.85),
        inset 0 0 6px rgba(255,212,74,0.4);
    }
    50% {
      box-shadow:
        0 0 20px rgba(255,212,74,1.0),
        inset 0 0 10px rgba(255,212,74,0.6);
    }
  }
  .mp-hand-card:active { transform: scale(0.95); }

  /* ── Bottom Sheet ─────────────────────────────────────────────── */
  .mp-sheet-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: flex-end;
    z-index: 9000;
    animation: mp-fade-in 0.15s ease-out;
  }
  @keyframes mp-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  /* ⭐⭐ v6.195：.mp-sheet-overlay 是 `inset:0; align-items:flex-end` ⇒ 這張 sheet 貼齊
     螢幕**下緣**，但原本 padding-bottom 只有 1.2rem(19.2px) < iPhone home indicator 的
     34px ⇒ 最後一顆鈕（「取消」）下半部會壓在 home indicator 上，難按且容易誤觸系統手勢。
     沿用 v6.187 的單一來源；--safe-bottom:0px（Android／電腦）時仍是 1.2rem，版面 0 位移。 */
  .mp-sheet {
    width: 100%;
    background: #1a2e2a;
    border-top-left-radius: 16px; border-top-right-radius: 16px;
    border: 1px solid #4a6a4a;
    border-bottom: none;
    padding: 0.8rem 1rem calc(1.2rem + var(--safe-bottom, 0px));
    display: flex; flex-direction: column; gap: 0.5rem;
    max-height: 70vh;
    overflow-y: auto;
    animation: mp-slide-up 0.2s ease-out;
  }
  @keyframes mp-slide-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  .mp-sheet-title {
    font-size: 1rem; font-weight: 700;
    color: #ffd44a;
    text-align: center;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .mp-sheet-empty {
    text-align: center; color: #888; font-size: 0.85rem;
    padding: 0.8rem;
  }
  .mp-sheet-btn {
    width: 100%;
    background: rgba(0,0,0,0.4);
    color: #f0f0f0;
    border: 1px solid #4a6a4a;
    border-radius: 6px;
    padding: 0.65rem 0.8rem;
    font-size: 0.92rem;
    text-align: left;
    cursor: pointer;
  }

  /* v3.32 sheet row（主按鈕 + 副 zoom 按鈕並排） */
  .mp-sheet-row {
    display: flex; gap: 6px; margin: 0 0 6px 0;
  }
  .mp-sheet-row .mp-sheet-btn {
    flex: 1;
    margin: 0;
  }
  .mp-sheet-zoom {
    flex: 0 0 auto;
    width: 44px;
    background: rgba(80, 60, 100, 0.85);
    color: #f0f0f0;
    border: 1px solid #5a4a7a;
    border-radius: 6px;
    cursor: pointer;
    font-size: 1.05rem;
    padding: 0;
  }
  .mp-sheet-zoom:hover { background: rgba(100, 80, 130, 0.95); }
  .mp-sheet-zoom:active { background: rgba(60, 40, 80, 0.95); }
  .mp-sheet-btn.primary {
    background: linear-gradient(180deg, #3a8a3a, #2a6a2a);
    border-color: #4a8a4a;
    font-weight: 600;
  }
  .mp-sheet-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  /* v6.147 送出中：pick 鈕與手牌一併給 disabled 視覺 */
  .mp-pick-btn:disabled, .mp-hand-card:disabled, .mp-prize-btn:disabled { opacity: 0.45; cursor: progress; }
  .mp-sheet-btn:active:not(:disabled) { transform: scale(0.98); }

  /* v5.205：mp-sheet 拖曳支援 — overlay.dragged 透明化讓玩家看到底下場上 */
  .mp-sheet-overlay.dragged {
    background: transparent;
    pointer-events: none;
  }
  .mp-sheet-overlay.dragged .mp-sheet {
    pointer-events: auto;
    box-shadow: 0 6px 28px rgba(0,0,0,0.7);
  }
  .mp-sheet-drag-handle {
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .mp-sheet-drag-handle:active { cursor: grabbing; }

  /* v5.205：picker 卡片內能量分屬性顯示（取代原 ⚡N 統一顯示） */
  .mp-pick-pips {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5px;
    justify-content: center;
    padding: 0.05rem 0;
    line-height: 1;
  }
  .mp-pick-pips .mp-pip {
    min-width: 13px;
    height: 13px;
    font-size: 0.52rem;
    padding: 0 2px;
    margin: 0;
  }
  .mp-pick-noenergy {
    font-size: 0.55rem;
    color: #888;
    font-style: italic;
  }

  /* v5.200：手機版選目標 picker 卡圖網格（撤退 / 附能 / 進化共用）
     設計目標：80px 卡寬 + auto-fit + max-height 55vh + 內捲。
     用 CSS auto-fit minmax 取代 JS 偵測，向量化處理任意數量寶可夢。 */
  .mp-pick-grid {
    display: grid;
    /* v5.276: 改 fixed-width 110px 卡 + center 對齊, 場上只 1 隻寶可夢時不撐滿整個 sheet */
    grid-template-columns: repeat(auto-fit, 110px);
    justify-content: center;
    gap: 0.45rem;
    /* v5.298: 拿掉 max-height + overflow-y — 跟外層 .mp-sheet (70vh + overflow-y:auto) 雙層滑捲
       在手機觸控時衝突, 內層卡片底部能量資訊永遠看不到. 改由 sheet 統一負責滑捲. */
    padding: 0.3rem 0.15rem;
    margin-bottom: 0.3rem;
  }
  .mp-pick-card {
    position: relative;
    display: flex;
  }
  /* v5.384：picker 卡圖網格標示戰鬥（active）寶可夢，鏡射桌面 modal */
  .mp-pick-active-badge {
    position: absolute; top: 2px; left: 2px; z-index: 3;
    font-size: 0.55rem; font-weight: 700; line-height: 1;
    padding: 2px 4px; border-radius: 4px;
    background: rgba(224,176,48,0.95); color: #1a1a1a; pointer-events: none;
  }
  .mp-pick-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.12rem;
    background: rgba(40, 60, 40, 0.85);
    color: #f0f0f0;
    border: 1.5px solid #4a8a4a;
    border-radius: 8px;
    padding: 0.25rem 0.18rem 0.35rem;
    cursor: pointer;
    transition: transform 0.1s, background 0.15s;
    /* v5.277: 拿掉 overflow:hidden, 改 visible + min-height 確保能量 pips/狀態 icon 完整顯示
       (滿場 8 隻寶可夢時, max-height 55vh container 自帶 overflow-y scroll, 整個 picker 仍可捲) */
    overflow: visible;
    min-height: 0;
  }
  .mp-pick-btn:hover { background: rgba(60, 90, 60, 0.95); border-color: #6aaa6a; }
  .mp-pick-btn:active { transform: scale(0.96); }
  .mp-pick-btn img {
    width: 100%;
    aspect-ratio: 2.5 / 3.5;
    object-fit: cover;
    border-radius: 4px;
    display: block;
  }
  .mp-pick-name {
    font-size: 0.62rem;
    font-weight: 600;
    text-align: center;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #ffe680;
  }
  .mp-pick-meta {
    font-size: 0.58rem;
    text-align: center;
    color: #d0d0d0;
    line-height: 1.15;
  }
  .mp-pick-status {
    font-size: 0.58rem;
    text-align: center;
    color: #ffaa66;
    line-height: 1.15;
    font-weight: 600;
  }
  .mp-pick-zoom {
    position: absolute;
    top: 2px;
    right: 2px;
    z-index: 2;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    background: rgba(80, 60, 100, 0.92);
    color: #fff;
    border: 1px solid #5a4a7a;
    cursor: pointer;
    font-size: 0.7rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mp-pick-zoom:hover { background: rgba(120, 90, 150, 1); }
  .mp-pick-zoom:active { background: rgba(60, 40, 80, 1); }

  .mp-sheet-cancel {
    width: 100%;
    background: rgba(60,40,40,0.6);
    color: #faa;
    border: 1px solid #5a3a3a;
    border-radius: 6px;
    padding: 0.55rem;
    font-size: 0.88rem;
    cursor: pointer;
    margin-top: 0.3rem;
  }

  /* v5.129：棄牌區 grid（圖片 + 右下角數字 badge）— 取代既有 list 為主視覺
     舊 .mp-discard-list 樣式保留為 fallback（罕用） */
  .mp-discard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
    gap: 6px;
    padding: 4px;
    max-height: 60vh;
    overflow-y: auto;
  }
  /* v5.304: aspect-ratio: 5/7 在 iOS Safari grid item 內 row height 計算偶發失準,
     row 與 row 之間出現 vertical overlap (玩家截圖反應 — 棄牌區 25 張時最明顯).
     改用 padding-bottom: 140% 老古典 trick (寬 100% → 高 100% × 7/5 = 140%),
     內層 img/placeholder 改 absolute inset:0 鋪滿. */
  .mp-discard-cell {
    position: relative;
    display: block;
    width: 100%;
    height: 0;
    padding: 0 0 140% 0;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid #444;
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
  }
  .mp-discard-cell:active {
    background: rgba(255, 255, 255, 0.15);
  }
  .mp-discard-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  /* v6.091「傳說」兩張合一競技場：手機棄牌區也裁半。
     cell 用 padding-bottom 固定直式框、img 絕對定位鋪滿 → 框比例與圖片無關，
     只要改成 cover + object-position 就能精準取左/右半（預設 contain 不動）。 */
  .mp-discard-img.legend-half-l, .mp-discard-img.legend-half-r { object-fit: cover; }
  .mp-discard-img.legend-half-l { object-position: 0% 50%; }
  .mp-discard-img.legend-half-r { object-position: 100% 50%; }
  .mp-discard-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: #ccc;
    font-size: 0.7rem;
    padding: 4px;
    text-align: center;
    box-sizing: border-box;
  }
  /* 右下角紅色大數字 badge */
  .mp-discard-count {
    position: absolute;
    right: 4px;
    bottom: 4px;
    background: rgba(220, 38, 38, 0.95);
    color: #fff;
    font-size: 1rem;
    font-weight: 800;
    padding: 1px 8px;
    border-radius: 10px;
    border: 2px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
    min-width: 28px;
    text-align: center;
    line-height: 1.1;
  }

  /* v2.297：棄牌區清單 sheet — 舊樣式保留 fallback */
  .mp-discard-list {
    display: flex; flex-direction: column;
    gap: 2px;
    max-height: 52vh;
    overflow-y: auto;
  }
  .mp-discard-row {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .mp-discard-row:nth-child(even) { background: rgba(255,255,255,0.04); }
  .mp-discard-name {
    flex: 1;
    font-size: 0.86rem;
    color: #e8e8e8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mp-discard-type {
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .mp-discard-zoom {
    flex-shrink: 0;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.85rem;
    cursor: pointer;
    color: #fff;
    transition: background 0.15s;
  }
  .mp-discard-zoom:active { background: rgba(255,255,255,0.2); }

  /* v2.289：手牌可打出的訓練家/競技場 右上角小 badge */
  .mp-card-hint {
    position: absolute;
    top: 1px; right: 1px;
    background: rgba(0,0,0,0.75);
    border-radius: 3px;
    font-size: 0.65rem;
    line-height: 1.2;
    padding: 0 2px;
    pointer-events: none;
  }

  /* v5.015：戰鬥位空缺等待 alert（補手機版桌機已有的對應提示） */
  .mp-wait-alert {
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    background: linear-gradient(90deg, rgba(80,140,200,0.32), rgba(60,110,170,0.2));
    border: 1px solid #4a8acc;
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem; font-weight: 600;
    color: #aaddff;
    margin: 4px 10px;
    text-align: center;
  }
  .mp-wait-alert.mp-wait-warn {
    background: linear-gradient(90deg, rgba(200,120,40,0.35), rgba(180,100,30,0.2));
    border-color: #c0782a;
    color: #ffdda0;
  }

  /* v2.286：獎賞卡 alert + 競技場能力按鈕 */
  .mp-prize-alert {
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    background: linear-gradient(90deg, rgba(200,160,40,0.35), rgba(180,140,30,0.2));
    border: 1px solid #a08020;
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem; font-weight: 600;
    color: #ffe060;
    margin: 4px 10px;
  }
  .mp-prize-btn {
    background: linear-gradient(180deg, #c09030, #a07020);
    color: #fff; border: 1px solid #d0a040;
    border-radius: 4px; padding: 0.2rem 0.6rem;
    font-size: 0.72rem; font-weight: 700;
    cursor: pointer;
  }
  .mp-prize-btn:active { background: #906818; }
  .mp-stadium-btn {
    background: linear-gradient(180deg, #4a3a8a, #3a2a6a);
    color: #e8d0ff;
    border: 1px solid #6a4aaa;
  }

  /* v6.086「兩張合一」競技場手牌裁半（官方只給一張合併橫圖）。
     手機的 .mp-hand-card img 有固定寬高（cover 本來就會裁），仍明寫 aspect-ratio 與桌機一致，
     避免日後有人改了容器尺寸就靜默失效（v6.087 桌機就是這樣沒生效）。 */
  .mp-hand-card img.legend-half-l,
  .mp-hand-card img.legend-half-r { aspect-ratio: 868 / 1212; object-fit: cover; }
  .mp-hand-card img.legend-half-l { object-position: 0% 50%; }
  .mp-hand-card img.legend-half-r { object-position: 100% 50%; }
</style>
