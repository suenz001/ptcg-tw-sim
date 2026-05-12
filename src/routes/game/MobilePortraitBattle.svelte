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
    對手 chips (22px) — 獎勵/牌庫/棄牌
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
  import type { Card } from '$lib/cards/types';
  import {
    getEffectiveAttacks, getAvailableAttacks, getEvolvableTargets, getPlayableTrainers,
    getPlayableBasics, getPlayableFossils, getUsableAbilities,
    canRetreat as engineCanRetreat, getRetreatCost, getBenchLimit,
    getEffectiveHP
  } from '$lib/game/engine';
  import { GameActions } from '$lib/game/actions';
  // v3.02：log 著色 + 卡名可點連結
  import { tokenizeLogMessage, lineClass as logLineClass } from '$lib/game/log_format';

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
    pendingPrizes?: number;
    canUseStadium?: boolean;
    // Callbacks
    onAction: (action: ReturnType<(typeof GameActions)[keyof typeof GameActions]>) => void | Promise<void>;
    onInitiateAttack: (attackIndex: number) => void;
    onOpenZoom: (cardId: string, inst: CardInstance | null) => void;
    onOpenSettings: () => void;
    onLeave: () => void;
  }

  let {
    game, pool, myIdx, oppIdx,
    stadiumCard, pendingSelection,
    aiThinking, isSyncing, version,
    pendingPrizes = 0,
    canUseStadium = false,
    onAction, onInitiateAttack, onOpenZoom, onOpenSettings, onLeave,
  }: Props = $props();

  // ── Derived state ─────────────────────────────────────────────────
  let myPlayer = $derived(game.players[myIdx]);
  let oppPlayer = $derived(game.players[oppIdx]);
  let myBenchLimit = $derived(getBenchLimit(game, myIdx, pool));
  let oppBenchLimit = $derived(getBenchLimit(game, oppIdx, pool));
  let isMyTurn = $derived(game.activePlayerIndex === myIdx);
  let isMainPhase = $derived(game.turnPhase === 'main');
  let isSetup = $derived(game.phase === 'setup');
  let isPlaying = $derived(game.phase === 'playing');
  let canEndTurn = $derived(isPlaying && game.turnPhase === 'end' && isMyTurn);
  let canRetreatNow = $derived(isPlaying && isMyTurn && isMainPhase && engineCanRetreat(game, pool));
  let evolvableTargets = $derived(isPlaying && isMyTurn && isMainPhase ? getEvolvableTargets(game, pool) : []);
  let usableAbilities = $derived(isPlaying && isMyTurn && isMainPhase && !pendingSelection ? getUsableAbilities(game, pool) : []);
  let playableTrainerIids = $derived(isPlaying && isMyTurn && isMainPhase ? new Set(getPlayableTrainers(game, pool)) : new Set<string>());
  let playableBasicIids = $derived(isPlaying && isMyTurn && isMainPhase ? new Set(getPlayableBasics(game, pool)) : new Set<string>());
  let playableFossilIids = $derived(isPlaying && isMyTurn && isMainPhase ? new Set(getPlayableFossils(game, pool)) : new Set<string>());
  let playableEvoIids = $derived(new Set<string>(evolvableTargets.flatMap(e => e.toIids)));

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
  function openZoomByName(cardName: string) {
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
    | { type: 'discard'; list: CardInstance[]; owner: string }
    | null;
  let sheet = $state<SheetState>(null);
  function closeSheet() { sheet = null; }

  // ── 開啟棄牌區清單 sheet ──────────────────────────────────────────
  function openDiscard(list: CardInstance[], owner: string) {
    if (list.length === 0) return;
    sheet = { type: 'discard', list: [...list].reverse(), owner };
  }

  // ── Hand tap：依卡類型決定 sheet 內容 ──────────────────────────────
  function tapHand(inst: CardInstance) {
    sheet = { type: 'hand', inst };
  }

  function isEnergy(c: Card | null): boolean { return !!c && c.supertype === 'Energy'; }
  function isTrainer(c: Card | null): boolean { return !!c && c.supertype === 'Trainer' && c.subtype !== 'PokemonTool'; }
  function isToolCard(c: Card | null): boolean { return !!c && c.supertype === 'Trainer' && c.subtype === 'PokemonTool'; }
  function isBasicMon(c: Card | null): boolean { return !!c && c.supertype === 'Pokemon' && !c.evolvesFrom; }
  function isEvoMon(c: Card | null): boolean { return !!c && c.supertype === 'Pokemon' && !!c.evolvesFrom; }

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

    // 基礎寶可夢
    if (isBasicMon(c)) {
      const canPlayBasic = playableBasicIids.has(iid) || (isSetup && !myPlayer.active);
      // v3.64：用 myBenchLimit（已 derive 自 getBenchLimit）取代 hardcoded 5
      //   零之大空洞 + 太晶寶可夢時上限 8；舊邏輯卡在 5，導致延伸位置（6/7/8）
      //   雖然有畫出格子但 hand action sheet 不顯示「放到備戰區」按鈕。
      //   playableBasicIids 由 engine getPlayableBasics 計算（已正確套用 getBenchLimit），
      //   playing 階段走那條 path 沒問題；setup 階段這裡 hardcode 5 是 bug。
      const canPlayBench = (isSetup && myPlayer.bench.length < myBenchLimit) || playableBasicIids.has(iid);
      if (canPlayBasic && !myPlayer.active) {
        out.push({ label: '🃏 放到戰鬥場', action: () => playBasicToActive(iid), primary: true });
      }
      if (canPlayBench && myPlayer.bench.length < myBenchLimit) {
        out.push({ label: '📥 放到備戰區', action: () => playBasicToBench(iid) });
      }
    }
    // 化石 Item
    if (playableFossilIids.has(iid)) {
      out.push({ label: '🦴 放化石到備戰', action: () => playFossil(iid), primary: true });
    }
    // 進化卡
    if (isEvoMon(c) && playableEvoIids.has(iid)) {
      const targets = evolvableTargets.filter(e => e.toIids.includes(iid)).map(e => e.fromIid);
      if (targets.length === 1) {
        out.push({ label: `🔺 進化（${nameOfIid(targets[0])}）`, action: () => evolveTo(targets[0], iid), primary: true });
      } else if (targets.length > 1) {
        out.push({ label: '🔺 選進化目標…', action: () => { sheet = { type: 'pick-evolve-target', evoIid: iid, candidates: targets }; }, primary: true });
      }
    }
    // 訓練家（含工具、競技場）— v2.289：依 subtype 顯示清楚標籤
    if (playableTrainerIids.has(iid) && (isTrainer(c) || isToolCard(c))) {
      const sub = c?.subtype ?? '';
      const tLabel = sub === 'Stadium' ? '🏟 放置競技場'
                   : sub === 'PokemonTool' ? '🔧 附加道具到寶可夢'
                   : sub === 'Supporter' ? '👤 使用支援者'
                   : '🎴 使用此卡';
      out.push({ label: tLabel, action: () => playTrainer(iid), primary: true });
    }
    // 能量卡
    if (isEnergy(c) && isPlaying && isMyTurn && isMainPhase && !myPlayer.energyAttachedThisTurn && !pendingSelection) {
      out.push({ label: '⚡ 附加能量到…', action: () => { sheet = { type: 'pick-energy-target', energyIid: iid }; }, primary: true });
    }
    // v3.07 Deferred Wave D — 手牌觸發特性（誘導之尾 / 熱浪鱗粉 / 緊急迴轉）
    // 機制 A: ON_DISCARD_FROM_HAND — 棄此卡觸發場上 trigger holder 特性
    if (isPlaying && isMyTurn && isMainPhase && !pendingSelection && c) {
      const me = myPlayer;
      const opp = oppPlayer;
      const usedNames = me.abilityNamesUsedThisTurn ?? [];
      const hasOnField = (name: string): boolean => {
        const all = [...(me.active ? [me.active] : []), ...me.bench];
        return all.some(p => pool.get(p.cardId)?.name === name);
      };
      // 1) 棄『悠哉尾草棒』→ 觸發超能妙喵｜誘導之尾
      if (c.name === '悠哉尾草棒'
          && hasOnField('超能妙喵')
          && !usedNames.includes('誘導之尾')
          && opp.active && opp.bench.length > 0) {
        out.push({
          label: '🌀 棄此卡 → 觸發 超能妙喵｜誘導之尾',
          action: () => { closeSheet(); onAction(GameActions.useHandDiscardAbility('超能妙喵', iid)); },
          primary: true,
        });
      }
      // 2) 棄『基本【火】能量』→ 觸發火神蛾｜熱浪鱗粉
      if (c.supertype === 'Energy' && c.subtype === 'Basic'
          && (c.name?.includes('【火】') ?? false)
          && hasOnField('火神蛾')
          && !usedNames.includes('熱浪鱗粉')
          && opp.active && opp.active.status !== 'burned') {
        out.push({
          label: '🔥 棄此卡 → 觸發 火神蛾｜熱浪鱗粉',
          action: () => { closeSheet(); onAction(GameActions.useHandDiscardAbility('火神蛾', iid)); },
          primary: true,
        });
      }
      // 機制 B: ON_HAND_ACTIVATE — 齒輪怪｜緊急迴轉
      if (c.name === '齒輪怪'
          && !usedNames.includes('緊急迴轉')
          && me.bench.length < myBenchLimit) {
        // 對手場上有 Stage 2
        const oppHasStage2Local = (): boolean => {
          const all = [...(opp.active ? [opp.active] : []), ...opp.bench];
          for (const p of all) {
            const card = pool.get(p.cardId);
            if (!card || card.supertype !== 'Pokemon') continue;
            const sub = (card.subtype ?? '') as string;
            if (typeof sub === 'string' && (sub.includes('Stage 2') || sub.includes('Stage2')
                || sub.includes('2 階') || sub.includes('二階') || sub === '2階進化')) return true;
            if (card.evolvesFrom) {
              for (const v of pool.values()) {
                if (v.name === card.evolvesFrom && v.evolvesFrom) return true;
              }
            }
          }
          return false;
        };
        if (oppHasStage2Local()) {
          out.push({
            label: '⚡ 緊急迴轉 (放備戰)',
            action: () => { closeSheet(); onAction(GameActions.useHandAbility(iid, 0)); },
            primary: true,
          });
        }
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

  // 取「active 可選動作」list
  function activeActions(): Array<{ label: string; action: () => void; disabled?: boolean; primary?: boolean; zoomIid?: string }> {
    if (!myPlayer.active) return [];
    // v3.35：out array 元素 type 加 zoomIid?，與 function return type 對齊（撤退項加 zoomIid 顯示 🔍 副按鈕）
    const out: Array<{ label: string; action: () => void; disabled?: boolean; primary?: boolean; zoomIid?: string }> = [];
    const aId = myPlayer.active.iid;
    // 攻擊（若 main phase 且有可用招式）
    if (effectiveAttacks.length > 0) {
      effectiveAttacks.forEach((eff, i) => {
        const ok = isPlaying && isMyTurn && isMainPhase && !pendingSelection && availableAttackIndices.includes(i);
        out.push({
          label: `⚔️ ${eff.atk.name}${eff.atk.damage ? ' · ' + eff.atk.damage : ''}${eff.isFromTool ? ' 🔧' : ''}`,
          action: () => { closeSheet(); onInitiateAttack(i); },
          disabled: !ok,
          primary: ok,
        });
      });
    }
    // 撤退
    if (canRetreatNow && myPlayer.bench.length > 0) {
      myPlayer.bench.forEach(b => {
        const c = cardOf(b);
        const costLabel = currentRetreatCost !== null ? ` (-${currentRetreatCost})` : '';
        out.push({
          label: `🔄 撤退${costLabel} → ${c?.name ?? '?'}`,
          action: () => retreatTo(b.iid),
          // v3.32 撤退選項加 zoomIid，UI 顯示 🔍 副按鈕讓玩家先看備戰寶可夢狀態
          zoomIid: b.iid,
        });
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
  function preventScroll(node: HTMLElement) {
    const moveHandler = (e: TouchEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.mp-row, .mp-hand, .mp-log, .mp-chips, .mp-sheet')) return;
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
        '.full-deck-view, .full-deck-list',
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
</script>

<div class="mp" use:preventScroll>

  <!-- ─── Top bar：1 行 ─── -->
  <header class="mp-top">
    <button class="mp-icon-btn" onclick={onLeave} title="離開">←</button>
    <span class="mp-turn-text">回合 {game.turn}</span>
    <span class="mp-phase">
      {#if isSetup}🎴 設置
      {:else if game.turnPhase === 'main'}{isMyTurn ? '🟢 你的回合' : '🔴 對手回合'}
      {:else if game.turnPhase === 'draw'}📥 抽牌
      {:else}⏭ 結束{/if}
    </span>
    <span class="mp-spacer"></span>
    {#if aiThinking}<span class="mp-tag">🤖</span>{/if}
    {#if isSyncing}<span class="mp-tag">⏳</span>{/if}
    {#if isSetup && !game.setupDone[myIdx]}
      <!-- v2.287 修：setup 階段雙方各自準備，不依 isMyTurn 判定（後手玩家 isMyTurn=false 會看不到按鈕） -->
      <button class="mp-end-btn" disabled={!myPlayer.active}
        onclick={() => onAction(GameActions.finishSetup(myIdx))}>✅ 準備</button>
    {:else if isMyTurn && isPlaying && !pendingSelection && (game.pendingPrizes?.[0] ?? 0) === 0 && (game.pendingPrizes?.[1] ?? 0) === 0}
      <!-- v2.289：不限 turnPhase==='end'，主階段也顯示（等同「跳過攻擊 + 結束回合」合一）
           engine END_TURN 自帶 pendingPrizes / defender.active=null 雙重 gate -->
      <button class="mp-end-btn" onclick={() => onAction(GameActions.endTurn())}>⏭ 結束回合</button>
    {/if}
    <button class="mp-icon-btn" onclick={onOpenSettings} title="設定">⚙</button>
  </header>

  <!-- ─── 對手 bench ─── -->
  <div class="mp-row mp-opp-bench">
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
            {#if c?.imageUrl}<img src={c.imageUrl} alt={c.name}/>{/if}
            <span class="mp-slot-hp">{hpRemaining(inst)}</span>
            {#if inst.energyAttached.length > 0}
              <span class="mp-slot-eg">⚡{inst.energyAttached.length}</span>
            {/if}
          </button>
        {/if}
      {:else}
        <div class="mp-slot mp-empty"></div>
      {/if}
    {/each}
  </div>

  <!-- ─── 對手 chips: 獎勵/牌庫/棄牌（緊湊） ─── -->
  <div class="mp-chips mp-opp-chips">
    <span class="mp-chip">🎁 {oppPlayer.prizes.length}</span>
    <span class="mp-chip">📚 {oppPlayer.deck.length}</span>
    <button class="mp-chip mp-clickable" onclick={() => openDiscard(oppPlayer.discard, '對手')} disabled={oppPlayer.discard.length === 0}>🗑 {oppPlayer.discard.length}</button>
    <span class="mp-chip">🂠 對手手牌 {oppPlayer.hand.length}</span>
    {#if stadiumCard && game.activeStadium}
      <button class="mp-chip mp-clickable mp-stadium" onclick={() => onOpenZoom(game.activeStadium!.cardId, null)}>🏟 {stadiumCard.name}</button>
    {/if}
  </div>

  <!-- ─── 對手 active ─── -->
  <div class="mp-active-row">
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
          {#if c?.imageUrl}<img src={c.imageUrl} alt={c.name}/>{/if}
          <div class="mp-active-info">
            <div class="mp-active-name">{c?.name ?? '?'}</div>
            <div class="mp-hp {hpClass(inst)}">
              <div class="mp-hp-fill" style="width:{hpMax(inst) ? (hpRemaining(inst)/hpMax(inst)*100) : 0}%"></div>
              <span>HP {hpRemaining(inst)}/{hpMax(inst)}</span>
            </div>
            <div class="mp-meta">
              {#if inst.energyAttached.length > 0}<span>⚡{inst.energyAttached.length}</span>{/if}
              {#if inst.toolAttached || (inst.extraTools && inst.extraTools.length > 0)}<span>🔧{(inst.extraTools && inst.extraTools.length > 0) ? `×${1 + inst.extraTools.length}` : ''}</span>{/if}
              {#if inst.status}<span class="mp-status">{inst.status}</span>{/if}
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
  <section class="mp-log">
    {#each [...(game.log ?? [])].reverse().slice(0, 30) as entry, i (i + (entry.message ?? ''))}
      {@const _isPrivate = !!(entry.privateMessage && entry.playerIndex === myIdx)}
      {@const _msgText = _isPrivate ? entry.privateMessage : entry.message}
      {@const _lineCls = logLineClass(_msgText ?? '')}
      {@const _tokens = tokenizeLogMessage(_msgText ?? '', cardNamesSorted)}
      <div class="mp-log-line {_lineCls}" class:latest={i === 0} class:sys={entry.playerIndex === null} class:private={_isPrivate}>
        {#if _isPrivate}<span class="log-private-icon" title="只有你看得到">🔒</span>{/if}
        {#each _tokens as tok}{#if tok.cls === 'log-card-link'}<button type="button" class="log-card-link" title="點擊查看 {tok.text} 卡片詳情" onclick={() => openZoomByName(tok.text)}>{tok.text}</button>{:else}<span class={tok.cls}>{tok.text}</span>{/if}{/each}
      </div>
    {/each}
  </section>

  <!-- ─── 我方 active ─── -->
  <div class="mp-active-row">
    {#if myPlayer.active}
      {@const inst = myPlayer.active}
      {@const c = cardOf(inst)}
      <button class="mp-active mp-active-mine mp-status-{inst.status ?? 'none'}"
        class:mp-actionable={isPlaying && isMyTurn && isMainPhase && !pendingSelection}
        onclick={() => sheet = { type: 'active' }}>
        {#if c?.imageUrl}<img src={c.imageUrl} alt={c.name}/>{/if}
        <div class="mp-active-info">
          <div class="mp-active-name">{c?.name ?? '?'}</div>
          <div class="mp-hp {hpClass(inst)}">
            <div class="mp-hp-fill" style="width:{hpMax(inst) ? (hpRemaining(inst)/hpMax(inst)*100) : 0}%"></div>
            <span>HP {hpRemaining(inst)}/{hpMax(inst)}</span>
          </div>
          <div class="mp-meta">
            {#if inst.energyAttached.length > 0}<span>⚡{inst.energyAttached.length}</span>{/if}
            {#if inst.toolAttached || (inst.extraTools && inst.extraTools.length > 0)}<span>🔧{(inst.extraTools && inst.extraTools.length > 0) ? `×${1 + inst.extraTools.length}` : ''}</span>{/if}
            {#if inst.status}<span class="mp-status">{inst.status}</span>{/if}
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

  <!-- ─── 我方 chips: 獎勵/牌庫/棄牌 ─── -->
  <div class="mp-chips mp-my-chips">
    <span class="mp-chip">🎁 {myPlayer.prizes.length}</span>
    <span class="mp-chip">📚 {myPlayer.deck.length}</span>
    <button class="mp-chip mp-clickable" onclick={() => openDiscard(myPlayer.discard, '我方')} disabled={myPlayer.discard.length === 0}>🗑 {myPlayer.discard.length}</button>
    <span class="mp-chip mp-mine">✋ {myPlayer.hand.length}</span>
    {#if canUseStadium && isMyTurn}
      <button class="mp-chip mp-clickable mp-stadium-btn" onclick={() => onAction(GameActions.useStadium())}>🏟 使用競技場</button>
    {:else}
      <span class="mp-chip mp-version">v{version}</span>
    {/if}
  </div>

  {#if (pendingPrizes ?? 0) > 0}
    <div class="mp-prize-alert">
      🏆 取 {pendingPrizes} 張獎勵牌
      <button class="mp-prize-btn" onclick={() => onAction(GameActions.takePrizes(pendingPrizes!, myIdx, myIdx))}>取得</button>
    </div>
  {/if}

  <!-- ─── 我方 bench ─── -->
  <div class="mp-row mp-my-bench">
    {#each Array(Math.max(5, myBenchLimit, myPlayer.bench.length)) as _, i}
      {@const inst = myPlayer.bench[i]}
      {#if inst}
        {@const c = cardOf(inst)}
        {@const hasUsableAbility = usableAbilities.some(u => u.iid === inst.iid)}
        {@const isEvoTarget = evolvableTargets.some(e => e.fromIid === inst.iid)}
        <button class="mp-slot mp-my-slot"
          class:mp-actionable={hasUsableAbility || isEvoTarget}
          onclick={() => sheet = { type: 'bench', inst }}>
          {#if c?.imageUrl}<img src={c.imageUrl} alt={c.name}/>{/if}
          <span class="mp-slot-hp">{hpRemaining(inst)}</span>
          {#if inst.energyAttached.length > 0}
            <span class="mp-slot-eg">⚡{inst.energyAttached.length}</span>
          {/if}
          {#if hasUsableAbility}<span class="mp-slot-ab">✨</span>{/if}
        </button>
      {:else}
        <div class="mp-slot mp-empty"></div>
      {/if}
    {/each}
  </div>

  <!-- ─── 手牌橫向 scroll（底部固定） ─── -->
  <footer class="mp-hand">
    <!-- v3.87: 本機雙人換人時用 {#key myIdx} 強制重 mount 手牌 — 修「換人後手牌不顯示」race -->
    {#key myIdx}
    {#if myPlayer.hand.length === 0}
      <div class="mp-hand-empty">（手牌空）</div>
    {:else}
      {#each myPlayer.hand as inst (inst.iid)}
        {@const c = cardOf(inst)}
        {@const playable = (
          playableBasicIids.has(inst.iid) || playableEvoIids.has(inst.iid) ||
          playableTrainerIids.has(inst.iid) || playableFossilIids.has(inst.iid) ||
          (isEnergy(c) && isPlaying && isMyTurn && isMainPhase && !myPlayer.energyAttachedThisTurn && !pendingSelection) ||
          /* v2.287 修：setup 階段基礎寶可夢可放（不分先後手） */
          (isSetup && !game.setupDone[myIdx] && isBasicMon(c) && (!myPlayer.active || myPlayer.bench.length < myBenchLimit))
        )}
        {@const isPlayableTrainer = playableTrainerIids.has(inst.iid) && !!c && (c.supertype === 'Trainer')}
        <button class="mp-hand-card" class:mp-playable={playable} onclick={() => tapHand(inst)} title={c?.name}>
          {#if c?.imageUrl}<img src={c.imageUrl} alt={c.name}/>{/if}
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
  <div class="mp-sheet-overlay" onclick={closeSheet} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="mp-sheet" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      {#if sheet.type === 'hand'}
        {@const acts = handActions(sheet.inst)}
        {@const c = cardOf(sheet.inst)}
        <div class="mp-sheet-title">{c?.name ?? '?'}</div>
        {#if acts.length === 0}
          <div class="mp-sheet-empty">本回合無可執行動作</div>
        {/if}
        {#each acts as a}
          <button class="mp-sheet-btn" class:primary={a.primary} disabled={a.disabled} onclick={a.action}>{a.label}</button>
        {/each}
      {:else if sheet.type === 'active'}
        {@const acts = activeActions()}
        <div class="mp-sheet-title">戰鬥寶可夢動作</div>
        {#if acts.length === 0}
          <div class="mp-sheet-empty">本回合無可執行動作</div>
        {/if}
        {#each acts as a}
          {#if a.zoomIid}
            <!-- v3.32 撤退類項目：主按鈕 + 🔍 zoom 副按鈕 -->
            <div class="mp-sheet-row">
              <button class="mp-sheet-btn mp-sheet-btn-flex" class:primary={a.primary} disabled={a.disabled} onclick={a.action}>{a.label}</button>
              <button class="mp-sheet-zoom" title="放大檢視" onclick={() => {
                closeSheet();
                const inst = [...(myPlayer.active ? [myPlayer.active] : []), ...myPlayer.bench].find(x => x.iid === a.zoomIid);
                if (inst) onOpenZoom(inst.cardId, inst);
              }}>🔍</button>
            </div>
          {:else}
            <button class="mp-sheet-btn" class:primary={a.primary} disabled={a.disabled} onclick={a.action}>{a.label}</button>
          {/if}
        {/each}
      {:else if sheet.type === 'bench'}
        {@const acts = benchActions(sheet.inst)}
        {@const c = cardOf(sheet.inst)}
        <div class="mp-sheet-title">{c?.name ?? '?'}</div>
        {#each acts as a}
          <button class="mp-sheet-btn" class:primary={a.primary} onclick={a.action}>{a.label}</button>
        {/each}
      {:else if sheet.type === 'pick-energy-target'}
        <div class="mp-sheet-title">⚡ 選擇附加目標</div>
        {#each energyTargets() as tinst}
          {@const c = cardOf(tinst)}
          <button class="mp-sheet-btn primary" onclick={() => attachEnergy(sheet!.type === 'pick-energy-target' ? sheet!.energyIid : '', tinst.iid)}>
            {c?.name ?? '?'}（HP {hpRemaining(tinst)}/{hpMax(tinst)} · ⚡{tinst.energyAttached.length}）
          </button>
        {/each}
      {:else if sheet.type === 'pick-evolve-target'}
        <div class="mp-sheet-title">🔺 選擇進化目標</div>
        {#each (sheet.type === 'pick-evolve-target' ? sheet.candidates : []) as fromIid}
          {@const inst = [...(myPlayer.active ? [myPlayer.active] : []), ...myPlayer.bench].find(x => x.iid === fromIid)}
          <!-- v3.722 進化目標加 🔍 zoom 副按鈕（與撤退 picker 同模式），玩家可先看寶可夢狀態再決定 -->
          <div class="mp-sheet-row">
            <button class="mp-sheet-btn mp-sheet-btn-flex primary" onclick={() => evolveTo(fromIid, (sheet as { evoIid: string }).evoIid)}>
              {nameOfIid(fromIid)}{inst ? `（HP ${hpRemaining(inst)}/${hpMax(inst)} · ⚡${inst.energyAttached.length}）` : ''}
            </button>
            {#if inst}
              <button class="mp-sheet-zoom" title="放大檢視" onclick={() => {
                closeSheet();
                onOpenZoom(inst.cardId, inst);
              }}>🔍</button>
            {/if}
          </div>
        {/each}
      {:else if sheet.type === 'discard'}
        <div class="mp-sheet-title">🗑 {sheet.owner}棄牌區（{sheet.list.length} 張）</div>
        <div class="mp-discard-list">
          {#each sheet.list as inst (inst.iid)}
            {@const c = pool.get(inst.cardId)}
            <div class="mp-discard-row">
              <span class="mp-discard-name">{c?.name ?? '?'}</span>
              <span class="mp-discard-type">{c?.supertype === 'Pokemon' ? '🐾' : c?.supertype === 'Energy' ? '⚡' : '🃏'}</span>
              <button class="mp-discard-zoom" onclick={() => { closeSheet(); onOpenZoom(inst.cardId, inst); }} title="放大查看">🔍</button>
            </div>
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
    padding-top: env(safe-area-inset-top, 0);
    padding-bottom: env(safe-area-inset-bottom, 0);
    padding-left: env(safe-area-inset-left, 0);
    padding-right: env(safe-area-inset-right, 0);
  }
  /* v3.861: 內部可滾動區允許各自方向手勢（不會冒泡到 .mp） */
  .mp-row { touch-action: pan-x; }
  .mp-hand { touch-action: pan-x; }
  .mp-log { touch-action: pan-y; }
  .mp-chips { touch-action: pan-x; }

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
  .mp-row { scrollbar-width: none; }
  .mp-opp-bench { background: linear-gradient(180deg, rgba(80,30,30,0.5), rgba(60,20,20,0.3)); }
  .mp-my-bench { background: linear-gradient(0deg, rgba(30,40,80,0.5), rgba(20,30,40,0.3)); }
  .mp-slot {
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

  /* ── Chips row（獎勵/牌庫/棄牌 緊湊） ───────────────────────────── */
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
    flex-shrink: 0;
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 1px 6px;
    color: #ddd; font-size: 0.62rem;
    white-space: nowrap;
  }
  .mp-chip.mp-mine { color: #afa; }
  .mp-chip.mp-version { color: #c0a0e0; font-family: monospace; margin-left: auto; }
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
  }
  .mp-active {
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
  .mp-active img {
    height: 100%; width: auto;
    max-width: 120px;
    object-fit: contain; border-radius: 4px;
    flex-shrink: 0;
    pointer-events: none;
  }
  .mp-card-back {
    background: repeating-linear-gradient(45deg, #1f4277, #1f4277 8px, #1a3a6a 8px, #1a3a6a 16px);
    border: 2px solid #eebb44;
    border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
  }
  .mp-card-back-mark { color: #eebb44; font-weight: 700; font-family: serif; font-size: 1.5rem; }
  .mp-slot.mp-card-back { padding: 0; width: auto; height: 100%; }
  .mp-card-back.mp-active-card-back { height: 100%; aspect-ratio: 63/88; flex-shrink: 0; }

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
  .mp-hand-card.mp-playable {
    border-color: #e0b030;
    box-shadow: 0 0 8px rgba(255,212,74,0.5);
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
  .mp-sheet {
    width: 100%;
    background: #1a2e2a;
    border-top-left-radius: 16px; border-top-right-radius: 16px;
    border: 1px solid #4a6a4a;
    border-bottom: none;
    padding: 0.8rem 1rem 1.2rem;
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
  .mp-sheet-btn:active:not(:disabled) { transform: scale(0.98); }
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

  /* v2.297：棄牌區清單 sheet */
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
</style>
