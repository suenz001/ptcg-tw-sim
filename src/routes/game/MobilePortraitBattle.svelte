<!--
  v2.284 Phase 1：手機直式 layout（≤600px portrait）

  雙軌並行：當 viewport 是手機直式時，+page.svelte 改 render 此元件而非原本的橫式
  .battle-root。共用 +page.svelte 的 game state / dispatch / pool — 透過 props 傳入。

  Phase 1 範圍：viewer-only + 結束回合 + 點卡開 zoom
    - 不做拖曳互動（Phase 2 加）
    - 不做攻擊 / 撤退 / 特性按鈕（Phase 2/3 加）
    - 但 AI 模式可全程觀戰

  Layout（上→下）：
    Header（單行 chip：回合 / 雙方手牌張數 / phase / stadium）
    對手區（紅）：info（獎勵/牌庫/棄牌）→ bench×5（橫向）→ active（中央大）
    Log（flex:1 撐剩餘空間，反序顯示）
    我方區（藍）：active（大）→ bench×5 → info + 結束回合
    手牌橫向 scroll（底部固定）
-->
<script lang="ts">
  import type { GameState, CardInstance, PendingSelection } from '$lib/game/types';
  import type { Card } from '$lib/cards/types';

  interface Props {
    game: GameState;
    pool: Map<string, Card>;
    myIdx: 0 | 1;
    oppIdx: 0 | 1;
    stadiumCard?: Card | null;
    pendingSelection?: PendingSelection | null;
    isMyTurn: boolean;
    canEndTurn: boolean;
    aiThinking: boolean;
    isSyncing: boolean;
    version: string;
    // Callbacks (給 +page.svelte 的 handlers)
    onOpenZoom: (cardId: string, inst: CardInstance | null) => void;
    onEndTurn: () => void;
    onOpenSettings: () => void;
    onLeave: () => void;
  }

  let {
    game, pool, myIdx, oppIdx,
    stadiumCard, pendingSelection,
    isMyTurn, canEndTurn, aiThinking, isSyncing, version,
    onOpenZoom, onEndTurn, onOpenSettings, onLeave,
  }: Props = $props();

  let myPlayer = $derived(game.players[myIdx]);
  let oppPlayer = $derived(game.players[oppIdx]);

  // 取卡片資料 + 計算 HP
  function cardOf(inst: CardInstance | null) {
    if (!inst) return null;
    return pool.get(inst.cardId) ?? null;
  }
  function hpRemaining(inst: CardInstance) {
    const c = cardOf(inst);
    return Math.max(0, (c?.hp ?? 0) - inst.damage);
  }
  function hpMax(inst: CardInstance) {
    return cardOf(inst)?.hp ?? 0;
  }
</script>

<div class="mp-battle">

  <!-- Header：單行 chip，水平 scroll -->
  <header class="mp-header">
    <button class="mp-chip mp-back" onclick={onLeave}>← 離開</button>
    <span class="mp-chip mp-turn">回合 {game.turn}</span>
    <span class="mp-chip mp-phase">
      {#if game.turnPhase === 'main'}主階段
      {:else if game.turnPhase === 'draw'}抽牌
      {:else}結束{/if}
    </span>
    <span class="mp-chip mp-hand-mine">✋ 我 {myPlayer.hand.length}</span>
    <span class="mp-chip mp-hand-opp">🂠 對手 {oppPlayer.hand.length}</span>
    {#if stadiumCard && game.activeStadium}
      <button class="mp-chip mp-stadium" onclick={() => onOpenZoom(game.activeStadium!.cardId, null)}>
        🏟 {stadiumCard.name}
      </button>
    {/if}
    {#if isSyncing}<span class="mp-chip mp-sync">⏳ 同步</span>{/if}
    {#if aiThinking}<span class="mp-chip mp-ai">🤖 AI 思考</span>{/if}
    <span class="mp-chip mp-version">v{version}</span>
    <button class="mp-chip mp-settings" onclick={onOpenSettings}>⚙️</button>
  </header>

  <!-- 對手區 -->
  <section class="mp-area mp-opp-area">
    <!-- info bar：獎勵 / 牌庫 / 棄牌 -->
    <div class="mp-info-bar">
      <div class="mp-info-cell">🎁 獎勵 <strong>{oppPlayer.prizes.length}</strong></div>
      <div class="mp-info-cell">📚 牌庫 <strong>{oppPlayer.deck.length}</strong></div>
      <div class="mp-info-cell">🗑 棄牌 <strong>{oppPlayer.discard.length}</strong></div>
    </div>

    <!-- bench：橫向縮小 -->
    <div class="mp-bench" class:mp-empty={oppPlayer.bench.length === 0}>
      {#if oppPlayer.bench.length === 0}
        <div class="mp-bench-empty-hint">（備戰區空）</div>
      {:else}
        {#each oppPlayer.bench as inst (inst.iid)}
          {@const c = cardOf(inst)}
          <button class="mp-bench-slot" onclick={() => onOpenZoom(inst.cardId, inst)}
            title={c?.name}>
            {#if c?.imageUrl}
              <img src={c.imageUrl} alt={c.name}/>
            {/if}
            <div class="mp-mini-hp">{hpRemaining(inst)}</div>
          </button>
        {/each}
      {/if}
    </div>

    <!-- active 中央大圖 -->
    <div class="mp-active-row">
      {#if oppPlayer.active}
        {@const c = cardOf(oppPlayer.active)}
        <button class="mp-active mp-active-opp" onclick={() => onOpenZoom(oppPlayer.active!.cardId, oppPlayer.active!)}>
          {#if c?.imageUrl}
            <img src={c.imageUrl} alt={c.name}/>
          {/if}
          <div class="mp-active-info">
            <div class="mp-active-name">{c?.name ?? '?'}</div>
            <div class="mp-hp-bar">
              <div class="mp-hp-fill" style="width:{hpMax(oppPlayer.active) > 0 ? (hpRemaining(oppPlayer.active)/hpMax(oppPlayer.active)*100) : 0}%"></div>
              <span class="mp-hp-text">HP {hpRemaining(oppPlayer.active)}/{hpMax(oppPlayer.active)}</span>
            </div>
            {#if oppPlayer.active.energyAttached.length > 0}
              <div class="mp-energy-count">⚡ {oppPlayer.active.energyAttached.length}</div>
            {/if}
            {#if oppPlayer.active.status}
              <div class="mp-status">{oppPlayer.active.status}</div>
            {/if}
          </div>
        </button>
      {:else}
        <div class="mp-active-empty">（對手戰鬥場空）</div>
      {/if}
    </div>
  </section>

  <!-- Log：撐剩餘空間 -->
  <section class="mp-log">
    {#each [...(game.log ?? [])].reverse() as entry, i}
      <div class="mp-log-line" class:mp-log-latest={i === 0} class:mp-log-sys={entry.playerIndex === null}>
        {entry.privateMessage && entry.playerIndex === myIdx ? entry.privateMessage : entry.message}
      </div>
    {/each}
  </section>

  <!-- 我方區 -->
  <section class="mp-area mp-my-area">
    <!-- active 大圖 -->
    <div class="mp-active-row">
      {#if myPlayer.active}
        {@const c = cardOf(myPlayer.active)}
        <button class="mp-active mp-active-mine" onclick={() => onOpenZoom(myPlayer.active!.cardId, myPlayer.active!)}>
          {#if c?.imageUrl}
            <img src={c.imageUrl} alt={c.name}/>
          {/if}
          <div class="mp-active-info">
            <div class="mp-active-name">{c?.name ?? '?'}</div>
            <div class="mp-hp-bar">
              <div class="mp-hp-fill" style="width:{hpMax(myPlayer.active) > 0 ? (hpRemaining(myPlayer.active)/hpMax(myPlayer.active)*100) : 0}%"></div>
              <span class="mp-hp-text">HP {hpRemaining(myPlayer.active)}/{hpMax(myPlayer.active)}</span>
            </div>
            {#if myPlayer.active.energyAttached.length > 0}
              <div class="mp-energy-count">⚡ {myPlayer.active.energyAttached.length}</div>
            {/if}
            {#if myPlayer.active.status}
              <div class="mp-status">{myPlayer.active.status}</div>
            {/if}
          </div>
        </button>
      {:else}
        <div class="mp-active-empty">（戰鬥場空 — 待派出）</div>
      {/if}
    </div>

    <!-- bench -->
    <div class="mp-bench" class:mp-empty={myPlayer.bench.length === 0}>
      {#if myPlayer.bench.length === 0}
        <div class="mp-bench-empty-hint">（備戰區空）</div>
      {:else}
        {#each myPlayer.bench as inst (inst.iid)}
          {@const c = cardOf(inst)}
          <button class="mp-bench-slot mp-bench-mine" onclick={() => onOpenZoom(inst.cardId, inst)}
            title={c?.name}>
            {#if c?.imageUrl}
              <img src={c.imageUrl} alt={c.name}/>
            {/if}
            <div class="mp-mini-hp">{hpRemaining(inst)}</div>
          </button>
        {/each}
      {/if}
    </div>

    <!-- info bar + 結束回合 -->
    <div class="mp-info-bar mp-my-info">
      <div class="mp-info-cell">🎁 獎勵 <strong>{myPlayer.prizes.length}</strong></div>
      <div class="mp-info-cell">📚 牌庫 <strong>{myPlayer.deck.length}</strong></div>
      <div class="mp-info-cell">🗑 棄牌 <strong>{myPlayer.discard.length}</strong></div>
      {#if isMyTurn && canEndTurn && !pendingSelection}
        <button class="mp-end-turn" onclick={onEndTurn}>⏭ 結束回合</button>
      {/if}
    </div>
  </section>

  <!-- 手牌：底部固定 -->
  <footer class="mp-hand">
    {#if myPlayer.hand.length === 0}
      <div class="mp-hand-empty">（手牌空）</div>
    {:else}
      {#each myPlayer.hand as inst (inst.iid)}
        {@const c = cardOf(inst)}
        <button class="mp-hand-card" onclick={() => onOpenZoom(inst.cardId, inst)}
          title={c?.name ?? ''}>
          {#if c?.imageUrl}
            <img src={c.imageUrl} alt={c.name}/>
          {/if}
        </button>
      {/each}
    {/if}
  </footer>
</div>

<style>
  /* ─────────────────────────────────────────────────────────────────────
     v2.284 Phase 1 — 手機直式 layout 樣式
     全部用 mp- 前綴避免和 +page.svelte 既有 .battle-root 樣式衝突。
     ───────────────────────────────────────────────────────────────────── */
  .mp-battle {
    height: 100vh; height: 100dvh;
    display: flex; flex-direction: column;
    background: #1a2e1a;
    color: #f0f0f0;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
    overflow: hidden;
    user-select: none;
  }

  /* ── Header chip 列 ─────────────────────────────────────────────────── */
  .mp-header {
    flex: 0 0 auto;
    display: flex; gap: 0.3rem; align-items: center;
    padding: 0.35rem 0.5rem;
    background: #0a180a;
    border-bottom: 1px solid #2a4a2a;
    overflow-x: auto; overflow-y: hidden;
    white-space: nowrap;
  }
  .mp-header::-webkit-scrollbar { height: 0; }
  .mp-chip {
    flex-shrink: 0;
    background: #2a3a2a; border: 1px solid #4a6a4a; color: #f0f0f0;
    padding: 0.22rem 0.5rem; border-radius: 12px;
    font-size: 0.7rem; font-weight: 500;
    cursor: default;
  }
  .mp-back, .mp-stadium, .mp-settings { cursor: pointer; }
  .mp-back { background: #1a2a3a; border-color: #2a4a6a; color: #8cf; }
  .mp-turn { background: #2a3a4a; border-color: #4a6a8a; color: #cef; }
  .mp-phase { background: #2a2a4a; border-color: #4a4a6a; color: #ccf; }
  .mp-hand-mine { background: #1a3a1a; border-color: #2a6a2a; color: #afa; }
  .mp-hand-opp { background: #3a1a2a; border-color: #6a2a4a; color: #faa; }
  .mp-stadium { background: #3a2a4a; border-color: #6a4a8a; color: #fcf; }
  .mp-sync { background: #3a3a1a; border-color: #5a5a1a; color: #ff8; }
  .mp-ai { background: #3a2a1a; border-color: #5a3a1a; color: #fa8; }
  .mp-version { background: #2a1a3a; border-color: #4a3a6a; color: #c0a0e0; font-family: monospace; }
  .mp-settings { background: #2a2a2a; border-color: #4a4a4a; }

  /* ── 對手 / 我方 area ─────────────────────────────────────────────────── */
  .mp-area {
    flex: 0 0 auto;
    display: flex; flex-direction: column; gap: 0.25rem;
    padding: 0.4rem 0.5rem;
  }
  .mp-opp-area {
    background: linear-gradient(180deg, rgba(80,30,30,0.4), rgba(40,20,20,0.15));
    border-bottom: 2px solid #4a2a2a;
  }
  .mp-my-area {
    background: linear-gradient(0deg, rgba(30,40,80,0.4), rgba(20,30,40,0.15));
    border-top: 2px solid #2a4a6a;
  }

  /* info bar：3 格 + (我方多一個結束回合) */
  .mp-info-bar {
    display: flex; gap: 0.3rem;
    font-size: 0.68rem;
  }
  .mp-info-cell {
    flex: 1;
    background: rgba(0,0,0,0.4);
    padding: 0.2rem 0.35rem;
    border-radius: 4px;
    text-align: center;
    color: #ccc;
  }
  .mp-info-cell strong { color: #f0f0f0; font-size: 0.78rem; margin-left: 2px; }

  /* bench 橫向 */
  .mp-bench {
    display: flex; gap: 0.2rem;
    overflow-x: auto; overflow-y: hidden;
    padding: 0.1rem 0;
    min-height: 70px;
  }
  .mp-bench::-webkit-scrollbar { height: 0; }
  .mp-bench.mp-empty { justify-content: center; align-items: center; }
  .mp-bench-empty-hint { color: #666; font-size: 0.7rem; font-style: italic; }
  .mp-bench-slot {
    flex-shrink: 0;
    width: 52px; height: 70px;
    background: rgba(0,0,0,0.35);
    border: 1px solid #5a3a3a;
    border-radius: 4px;
    padding: 2px;
    cursor: pointer;
    position: relative;
    display: flex; flex-direction: column; align-items: center;
  }
  .mp-bench-slot.mp-bench-mine { border-color: #3a6a3a; }
  .mp-bench-slot img {
    width: 100%; height: 50px;
    object-fit: contain;
    pointer-events: none;
  }
  .mp-mini-hp {
    font-size: 0.58rem;
    color: #afa;
    font-weight: 600;
  }

  /* active 中央大圖 */
  .mp-active-row {
    display: flex; justify-content: center;
    padding: 0.15rem 0;
  }
  .mp-active {
    display: flex; gap: 0.5rem; align-items: center;
    background: rgba(0,0,0,0.5);
    border: 2px solid #5a3a3a;
    border-radius: 6px;
    padding: 0.35rem;
    cursor: pointer;
    width: 100%; max-width: 360px;
  }
  .mp-active.mp-active-mine { border-color: #3a6a3a; }
  .mp-active img {
    width: 90px;
    border-radius: 4px;
    flex-shrink: 0;
    pointer-events: none;
  }
  .mp-active-info {
    flex: 1;
    display: flex; flex-direction: column; gap: 0.2rem;
    min-width: 0;
  }
  .mp-active-name {
    font-size: 0.85rem; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .mp-hp-bar {
    position: relative;
    height: 16px;
    background: rgba(0,0,0,0.6);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 3px;
    overflow: hidden;
  }
  .mp-hp-fill {
    position: absolute; top: 0; left: 0; bottom: 0;
    background: linear-gradient(90deg, #6c6, #4a4);
    transition: width 0.3s ease;
  }
  .mp-hp-text {
    position: relative; z-index: 1;
    display: block;
    text-align: center;
    font-size: 0.68rem;
    line-height: 16px;
    color: #fff;
    text-shadow: 0 0 3px rgba(0,0,0,0.9);
  }
  .mp-energy-count, .mp-status {
    font-size: 0.7rem;
    background: rgba(0,0,0,0.4);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    display: inline-block;
    width: fit-content;
  }
  .mp-status { color: #ff8; }
  .mp-active-empty {
    width: 100%; max-width: 360px;
    text-align: center;
    padding: 1rem;
    color: #888;
    font-size: 0.78rem;
    border: 2px dashed #444;
    border-radius: 6px;
    background: rgba(0,0,0,0.25);
  }

  /* ── Log 區（撐空間） ───────────────────────────────────────────────── */
  .mp-log {
    flex: 1; min-height: 60px;
    overflow-y: auto;
    padding: 0.4rem 0.6rem;
    font-size: 0.72rem;
    line-height: 1.45;
    background: rgba(0,0,0,0.35);
    border-top: 1px solid rgba(255,255,255,0.05);
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .mp-log-line {
    padding: 0.18rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    color: #ccc;
  }
  .mp-log-line.mp-log-latest {
    color: #ffd44a; font-weight: 600;
  }
  .mp-log-line.mp-log-sys {
    color: #8cf; font-style: italic;
  }

  /* ── 我方 info bar 含結束回合按鈕 ───────────────────────────────────── */
  .mp-end-turn {
    flex: 0 0 auto;
    background: linear-gradient(180deg, #3a8a3a, #2a6a2a);
    color: #fff;
    border: 1px solid #4a8a4a;
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font-size: 0.78rem; font-weight: 600;
    cursor: pointer;
  }
  .mp-end-turn:active { background: linear-gradient(180deg, #2a6a2a, #1a5a1a); }

  /* ── 手牌底部固定 ──────────────────────────────────────────────────── */
  .mp-hand {
    flex: 0 0 auto;
    display: flex;
    gap: 0.25rem;
    overflow-x: auto; overflow-y: hidden;
    padding: 0.4rem 0.5rem 0.5rem;
    background: #0a160a;
    border-top: 2px solid #2a5a2a;
    min-height: 100px;
  }
  .mp-hand::-webkit-scrollbar { height: 0; }
  .mp-hand-empty { color: #666; font-style: italic; align-self: center; padding: 0 1rem; font-size: 0.72rem; }
  .mp-hand-card {
    flex-shrink: 0;
    width: 64px; height: 88px;
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
  .mp-hand-card:active { transform: scale(0.95); }
</style>
