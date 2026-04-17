<script lang="ts">
  import { onMount } from 'svelte';
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
  } from '$lib/game/engine';
  import { GameActions } from '$lib/game/actions';
  import type { GameState, CardInstance } from '$lib/game/types';
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';
  import type { EnergyType } from '$lib/cards/types';

  // ── 資料載入 ────────────────────────────────────────────────────────────────
  let pool = $state<Map<string, Card>>(new Map());
  let poolReady = $state(false);
  let decks = $state<Deck[]>([]);

  /** 使用者牌組 + 內建預設牌組，合併後供 Lobby 顯示 */
  const allDecks = $derived([...PRESET_DECKS, ...decks]);

  // ── 遊戲狀態 ────────────────────────────────────────────────────────────────
  let game = $state<GameState | null>(null);

  // ── 選牌組畫面 ──────────────────────────────────────────────────────────────
  let p1DeckId = $state('');
  let p2DeckId = $state('');
  let p1Name = $state('玩家 1');
  let p2Name = $state('玩家 2');

  // ── UI 互動狀態 ─────────────────────────────────────────────────────────────
  let selectedEnergyIid = $state<string | null>(null);  // 已選取的能量卡
  let showEvoMenu = $state<string | null>(null);         // 進化選單：展開的 fromIid
  let showRetreatPicker = $state(false);                 // 顯示撤退備戰選擇
  let selectionPicked = $state<Set<string>>(new Set());  // pendingSelection 選中的 iid

  // ── Derived ────────────────────────────────────────────────────────────────
  const aIdx = $derived(game?.activePlayerIndex ?? 0);
  const dIdx = $derived((1 - aIdx) as 0 | 1);
  const activePlayer = $derived(game ? game.players[aIdx] : null);
  const defenderPlayer = $derived(game ? game.players[dIdx] : null);
  const availableAttacks = $derived(game && poolReady ? getAvailableAttacks(game, pool) : []);
  const pendingPrizes = $derived(game?.pendingPrizes ?? 0);
  const pendingSelection = $derived(game?.pendingSelection ?? null);
  const evolvableTargets = $derived(game && poolReady ? getEvolvableTargets(game, pool) : []);
  const canRetreatNow = $derived(game && poolReady ? canRetreat(game, pool) : false);
  const playableTrainerIids = $derived(
    game && poolReady ? new Set(getPlayableTrainers(game, pool)) : new Set<string>()
  );
  const playableBasicIids = $derived(
    game && poolReady ? new Set(getPlayableBasics(game, pool)) : new Set<string>()
  );
  const canEndTurn = $derived(
    game?.phase === 'playing' &&
    game.turnPhase === 'end' &&
    !hasPendingActions(game)
  );

  // pendingSelection 時可選的 items
  const selectionItems = $derived.by(() => {
    if (!pendingSelection || !game) return [] as CardInstance[];
    const src = game.players[pendingSelection.sourcePlayerIdx];
    switch (pendingSelection.type) {
      case 'deck-search': {
        const f = pendingSelection.filter ?? '';
        if (f === 'TOP6') {
          const top6Iids = new Set<string>(
            (pendingSelection.params?.top6Iids as string[]) ?? []
          );
          return src.deck.filter(c => top6Iids.has(c.iid));
        }
        return src.deck.filter(c => {
          const card = pool.get(c.cardId);
          if (!card) return false;
          if (f === 'Basic') return card.supertype === 'Pokemon' && card.subtype === 'Basic';
          if (f === 'Basic:HP70') return card.supertype === 'Pokemon' && card.subtype === 'Basic' && (card.hp ?? 0) <= 70;
          if (f === 'Pokemon') return card.supertype === 'Pokemon';
          if (f === 'Energy') return card.supertype === 'Energy';
          return true;
        });
      }
      case 'bench-choose':
        return src.bench;
      case 'hand-discard':
        return src.hand;
      case 'heal-target':
        return [...(src.active ? [src.active] : []), ...src.bench];
      default:
        return [] as CardInstance[];
    }
  });

  const selectionValid = $derived(
    pendingSelection !== null &&
    selectionPicked.size >= pendingSelection.minCount &&
    selectionPicked.size <= pendingSelection.maxCount
  );

  onMount(async () => {
    decks = loadDecks();
    const allCards = await loadAllSets();
    pool = buildCardIndex(allCards);
    poolReady = true;
  });

  // ── 輔助函式 ────────────────────────────────────────────────────────────────
  function getCard(cardId: string): Card | undefined {
    return pool.get(cardId);
  }

  function pokemonHP(instance: CardInstance): number {
    return pool.get(instance.cardId)?.hp ?? 0;
  }

  function hpRemaining(instance: CardInstance): number {
    return Math.max(0, pokemonHP(instance) - instance.damage);
  }

  function energySummary(instance: CardInstance): string {
    const counts = countEnergy(instance, pool);
    if (counts.size === 0) return '無';
    return [...counts.entries()].map(([t, n]) => `${ENERGY_LABEL[t]}×${n}`).join(' ');
  }

  function hpColor(remaining: number, total: number): string {
    const pct = total > 0 ? remaining / total : 1;
    if (pct > 0.5) return '#2c7a3c';
    if (pct > 0.25) return '#e0a020';
    return '#c00';
  }

  function retreatCostOf(inst: CardInstance): number {
    return getCard(inst.cardId)?.retreatCost?.length ?? 0;
  }

  /** 從 evolvableTargets 取得某 iid 的可用進化卡 */
  function evoOptionsFor(fromIid: string): CardInstance[] {
    const entry = evolvableTargets.find(e => e.fromIid === fromIid);
    if (!entry || !activePlayer) return [];
    return activePlayer.hand.filter(c => entry.toIids.includes(c.iid));
  }

  // ── 遊戲動作 ─────────────────────────────────────────────────────────────────
  function dispatch(action: ReturnType<typeof GameActions[keyof typeof GameActions]>) {
    if (!game || !poolReady) return;
    game = applyAction(game, action as any, pool);
    // 動作後關閉進化選單 / 撤退選擇（除非選單還有效）
    showEvoMenu = null;
    showRetreatPicker = false;
    selectedEnergyIid = null;
  }

  function startGame() {
    if (!p1DeckId || !p2DeckId) return;
    const d1 = allDecks.find((d) => d.id === p1DeckId);
    const d2 = allDecks.find((d) => d.id === p2DeckId);
    if (!d1 || !d2) return;
    game = createGame(
      { name: p1Name || d1.name, entries: d1.entries },
      { name: p2Name || d2.name, entries: d2.entries },
      pool
    );
  }

  function onAttachEnergy(targetIid: string) {
    if (!selectedEnergyIid) return;
    dispatch(GameActions.attachEnergy(selectedEnergyIid, targetIid));
  }

  function toggleSelection(iid: string) {
    const next = new Set(selectionPicked);
    if (next.has(iid)) {
      next.delete(iid);
    } else if (pendingSelection && next.size < pendingSelection.maxCount) {
      next.add(iid);
    }
    selectionPicked = next;
  }

  function confirmSelection() {
    if (!selectionValid) return;
    dispatch(GameActions.resolveSelection([...selectionPicked]));
    selectionPicked = new Set();
  }

  function selectionTitle(type: string): string {
    if (type === 'deck-search') return '從牌庫選擇';
    if (type === 'bench-choose') return '選擇備戰寶可夢';
    if (type === 'hand-discard') return '選擇丟棄的手牌';
    if (type === 'heal-target') return '選擇回復的寶可夢';
    return '請選擇';
  }
</script>

<!-- ══════════════════════════════════════════════════════════════════════ -->
<!--  選牌組畫面                                                            -->
<!-- ══════════════════════════════════════════════════════════════════════ -->
{#if !game}
  <main class="lobby">
    <a href="{base}/" class="back">← 首頁</a>
    <h1>⚔️ 開始對戰</h1>

    {#if !poolReady}
      <p class="muted">載入卡池中…</p>
    {:else}
      <div class="player-setup">
        <div class="setup-card">
          <h2>玩家 1（先手）</h2>
          <input class="name-input" placeholder="玩家名稱" bind:value={p1Name} />
          <select bind:value={p1DeckId}>
            <option value="">— 選擇牌組 —</option>
            {#if PRESET_DECKS.length > 0}
              <optgroup label="🎴 內建預組">
                {#each PRESET_DECKS as d}
                  <option value={d.id}>{d.name}</option>
                {/each}
              </optgroup>
            {/if}
            {#if decks.length > 0}
              <optgroup label="📁 我的牌組">
                {#each decks as d}
                  <option value={d.id}>{d.name}（{d.entries.reduce((n,e)=>n+e.count,0)} 張）</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </div>

        <div class="vs-badge">VS</div>

        <div class="setup-card">
          <h2>玩家 2（後手）</h2>
          <input class="name-input" placeholder="玩家名稱" bind:value={p2Name} />
          <select bind:value={p2DeckId}>
            <option value="">— 選擇牌組 —</option>
            {#if PRESET_DECKS.length > 0}
              <optgroup label="🎴 內建預組">
                {#each PRESET_DECKS as d}
                  <option value={d.id}>{d.name}</option>
                {/each}
              </optgroup>
            {/if}
            {#if decks.length > 0}
              <optgroup label="📁 我的牌組">
                {#each decks as d}
                  <option value={d.id}>{d.name}（{d.entries.reduce((n,e)=>n+e.count,0)} 張）</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </div>
      </div>

      <button class="btn-primary" disabled={!p1DeckId || !p2DeckId || p1DeckId === p2DeckId}
        onclick={startGame}>
        🎮 開始遊戲
      </button>
      {#if p1DeckId === p2DeckId && p1DeckId}
        <p class="warn">兩位玩家請選不同的牌組</p>
      {/if}
    {/if}
  </main>

<!-- ══════════════════════════════════════════════════════════════════════ -->
<!--  遊戲結束畫面                                                          -->
<!-- ══════════════════════════════════════════════════════════════════════ -->
{:else if game.phase === 'game-over'}
  <main class="lobby">
    <h1>🏆 遊戲結束</h1>
    <p class="winner-text">{game.players[game.winner!].name} 獲勝！</p>
    <p class="muted">{game.winReason}</p>
    <div class="lobby-btns">
      <button class="btn-primary" onclick={() => { game = null; }}>再來一局</button>
      <a href="{base}/" class="btn-secondary">回首頁</a>
    </div>
  </main>

<!-- ══════════════════════════════════════════════════════════════════════ -->
<!--  Setup 畫面                                                            -->
<!-- ══════════════════════════════════════════════════════════════════════ -->
{:else if game.phase === 'setup-p1' || game.phase === 'setup-p2'}
  {@const setupIdx = game.phase === 'setup-p1' ? 0 : 1}
  {@const setupPlayer = game.players[setupIdx]}
  <main class="setup-screen">
    <h2>🃏 {setupPlayer.name} — 選出場寶可夢</h2>
    <p class="muted">從起始手牌選出 1 隻基礎寶可夢作為出場，再選備戰區（最多 5 隻），完成後按「準備完成」。</p>

    {#if setupPlayer.active}
      {@const ac = getCard(setupPlayer.active.cardId)}
      <div class="setup-active">
        <strong>出場：</strong>
        <span class="poke-chip active-chip">{ac?.name ?? '?'} (HP {ac?.hp})</span>
        <button class="small danger" onclick={() => dispatch(GameActions.placeActive(setupPlayer.active!.iid))}>
          換出場
        </button>
      </div>
    {/if}

    {#if setupPlayer.bench.length > 0}
      <div class="setup-bench-row">
        <strong>備戰：</strong>
        {#each setupPlayer.bench as b}
          {@const bc = getCard(b.cardId)}
          <span class="poke-chip bench-chip">{bc?.name ?? '?'}</span>
        {/each}
      </div>
    {/if}

    <h3>手牌</h3>
    <div class="hand-grid">
      {#each setupPlayer.hand as inst}
        {@const c = getCard(inst.cardId)}
        {#if c}
          <div class="hand-card" class:selectable={c.supertype === 'Pokemon' && c.subtype === 'Basic'}>
            <img src={c.imageUrl} alt={c.name} />
            <div class="hand-card-name">{c.name}</div>
            {#if c.supertype === 'Pokemon' && c.subtype === 'Basic'}
              {#if !setupPlayer.active}
                <button class="small primary" onclick={() => dispatch(GameActions.placeActive(inst.iid))}>出場</button>
              {:else if setupPlayer.bench.length < 5}
                <button class="small" onclick={() => dispatch(GameActions.benchPokemon(inst.iid))}>備戰</button>
              {/if}
            {:else}
              <span class="card-type-tag">{c.supertype}</span>
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <button class="btn-primary" disabled={!setupPlayer.active}
      onclick={() => dispatch(GameActions.finishSetup())}>
      ✅ 準備完成
    </button>
  </main>

<!-- ══════════════════════════════════════════════════════════════════════ -->
<!--  正式對戰畫面                                                          -->
<!-- ══════════════════════════════════════════════════════════════════════ -->
{:else}
  <div class="battle-root">

    <!-- 狀態列 -->
    <header class="battle-header">
      <a href="{base}/" class="back small-back">← 首頁</a>
      <span class="turn-info">
        回合 {game.turn}　{activePlayer?.name} 行動中
        {#if game.isFirstTurn && aIdx === 0}<span class="hint">（先手第1回合不能攻擊/進化）</span>{/if}
      </span>
      <span class="phase-tag">
        {game.turnPhase === 'draw' ? '📥 抽牌' : game.turnPhase === 'main' ? '🎮 主階段' : '⏭ 回合結束'}
      </span>
    </header>

    <div class="battle-layout">

      <!-- 左側：對手場地 -->
      <section class="field opponent-field">
        <h3>{defenderPlayer?.name}的場地</h3>

        <div class="zone-label">出場</div>
        {#if defenderPlayer?.active}
          {@const ac = getCard(defenderPlayer.active.cardId)}
          <div class="pokemon-slot opponent">
            <img src={ac?.imageUrl} alt={ac?.name} />
            <div class="poke-info">
              <div class="poke-name">{ac?.name}</div>
              <div class="hp-bar-wrap">
                <div class="hp-bar" style="width:{ac?.hp ? hpRemaining(defenderPlayer.active)/ac.hp*100 : 0}%;background:{hpColor(hpRemaining(defenderPlayer.active), ac?.hp ?? 0)}"></div>
              </div>
              <div class="hp-text">HP {hpRemaining(defenderPlayer.active)} / {ac?.hp}</div>
              <div class="energy-text">⚡ {energySummary(defenderPlayer.active)}</div>
            </div>
          </div>
        {:else}
          <div class="pokemon-slot empty">（無出場寶可夢）</div>
        {/if}

        <div class="zone-label">備戰（{defenderPlayer?.bench.length ?? 0}/5）</div>
        <div class="bench-row">
          {#each defenderPlayer?.bench ?? [] as b}
            {@const bc = getCard(b.cardId)}
            <div class="bench-slot">
              <img src={bc?.imageUrl} alt={bc?.name} />
              <div class="bench-name">{bc?.name}</div>
              <div class="bench-hp">HP {hpRemaining(b)}/{bc?.hp}</div>
            </div>
          {/each}
        </div>

        <div class="field-info">
          <span>📦 {defenderPlayer?.deck.length}</span>
          <span>🗑 {defenderPlayer?.discard.length}</span>
          <span>🏆 {defenderPlayer?.prizes.length}</span>
        </div>
      </section>

      <!-- 中間：行動區 -->
      <section class="action-zone">

        <!-- 待取獎勵牌 -->
        {#if pendingPrizes > 0}
          <div class="alert-box">
            🏆 取得 {pendingPrizes} 張獎勵牌！
            <button class="btn-primary sm" onclick={() => dispatch(GameActions.takePrizes(pendingPrizes))}>
              取得獎勵牌
            </button>
          </div>
        {/if}

        <!-- 對手需要送出寶可夢 -->
        {#if game.phase === 'playing' && defenderPlayer?.active === null && game.turnPhase === 'end'}
          <div class="alert-box warn">
            ⚠️ {defenderPlayer?.name} 需送出寶可夢
            <br><small>（請將裝置交給 {defenderPlayer?.name}）</small>
            <div class="bench-pick-row">
              {#each defenderPlayer?.bench ?? [] as b}
                {@const bc = getCard(b.cardId)}
                <button class="bench-pick-btn" onclick={() => {
                  if (game) {
                    const prev = game.activePlayerIndex;
                    game = { ...game, activePlayerIndex: dIdx };
                    dispatch(GameActions.sendNewActive(b.iid));
                    if (game) game = { ...game, activePlayerIndex: prev };
                  }
                }}>
                  <img src={bc?.imageUrl} alt={bc?.name} />
                  <span>{bc?.name}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 主要行動按鈕 -->
        <div class="action-btns">
          {#if game.turnPhase === 'draw'}
            <button class="btn-primary" onclick={() => dispatch(GameActions.drawCard())}>
              📥 抽牌
            </button>
          {/if}

          {#if game.turnPhase === 'main'}
            <!-- 攻擊按鈕 -->
            {#if activePlayer?.active}
              {@const ac = getCard(activePlayer.active.cardId)}
              {#each ac?.attacks ?? [] as atk, i}
                <button
                  class="btn-attack"
                  class:available={availableAttacks.includes(i)}
                  disabled={!availableAttacks.includes(i) || !!pendingSelection}
                  onclick={() => dispatch(GameActions.attack(i))}
                >
                  <span class="atk-cost-row">
                    {#each atk.cost as e}
                      <span class="epip" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>
                    {/each}
                  </span>
                  <span class="atk-name">{atk.name}</span>
                  <span class="atk-dmg">{atk.damage || '—'}</span>
                </button>
              {/each}
            {/if}

            <button class="btn-secondary" disabled={!!pendingSelection}
              onclick={() => { if(game) game = {...game, turnPhase:'end'}; }}>
              跳過攻擊 →
            </button>
          {/if}

          {#if canEndTurn}
            <button class="btn-primary" onclick={() => dispatch(GameActions.endTurn())}>
              ⏭ 結束回合
            </button>
          {/if}
        </div>

        <!-- 行動紀錄 -->
        <div class="log-box">
          <div class="log-title">行動紀錄</div>
          <div class="log-entries">
            {#each [...(game.log ?? [])].reverse().slice(0, 20) as entry}
              <div class="log-entry" class:system={entry.playerIndex === null}>
                {entry.message}
              </div>
            {/each}
          </div>
        </div>
      </section>

      <!-- 右側：自己場地 -->
      <section class="field my-field">
        <h3>{activePlayer?.name}的場地</h3>

        <!-- 出場寶可夢 -->
        <div class="zone-label">出場
          {#if canRetreatNow && !showRetreatPicker && !pendingSelection}
            <button class="small-action-btn" onclick={() => showRetreatPicker = !showRetreatPicker}>
              撤退 ({retreatCostOf(activePlayer!.active!)}⚡)
            </button>
          {/if}
          {#if activePlayer?.retreatedThisTurn}<span class="used">✅ 已撤退</span>{/if}
        </div>

        {#if activePlayer?.active}
          {@const ac = getCard(activePlayer.active.cardId)}
          {@const evoOpts = evoOptionsFor(activePlayer.active.iid)}
          <div class="pokemon-slot mine"
            class:energy-target={selectedEnergyIid !== null && !pendingSelection}
            onclick={() => selectedEnergyIid && !pendingSelection && onAttachEnergy(activePlayer!.active!.iid)}>
            <img src={ac?.imageUrl} alt={ac?.name} />
            <div class="poke-info">
              <div class="poke-name">{ac?.name}</div>
              <div class="hp-bar-wrap">
                <div class="hp-bar" style="width:{ac?.hp ? hpRemaining(activePlayer.active)/ac.hp*100 : 0}%;background:{hpColor(hpRemaining(activePlayer.active), ac?.hp ?? 0)}"></div>
              </div>
              <div class="hp-text">HP {hpRemaining(activePlayer.active)} / {ac?.hp}</div>
              <div class="energy-text">⚡ {energySummary(activePlayer.active)}</div>
              {#if selectedEnergyIid && !pendingSelection}<div class="attach-hint">點此附加</div>{/if}
            </div>
            <!-- 進化按鈕 -->
            {#if evoOpts.length > 0 && !pendingSelection}
              <div class="evo-wrap">
                <button class="evo-btn" onclick={(e)=>{ e.stopPropagation(); showEvoMenu = showEvoMenu === activePlayer!.active!.iid ? null : activePlayer!.active!.iid; }}>
                  進化 ▲
                </button>
                {#if showEvoMenu === activePlayer.active.iid}
                  <div class="evo-menu">
                    {#each evoOpts as evo}
                      {@const ec = getCard(evo.cardId)}
                      <button class="evo-choice" onclick={(e)=>{ e.stopPropagation(); dispatch(GameActions.evolve(activePlayer!.active!.iid, evo.iid)); }}>
                        <img src={ec?.imageUrl} alt={ec?.name} />
                        <span>{ec?.name}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- 撤退備戰選擇 -->
          {#if showRetreatPicker && !pendingSelection}
            <div class="retreat-picker">
              <span class="retreat-label">選擇換入備戰寶可夢：</span>
              {#each activePlayer.bench as b}
                {@const bc = getCard(b.cardId)}
                <button class="bench-pick-btn" onclick={() => dispatch(GameActions.retreat(b.iid))}>
                  <img src={bc?.imageUrl} alt={bc?.name} />
                  <span>{bc?.name}</span>
                </button>
              {/each}
              <button class="small" onclick={() => showRetreatPicker = false}>取消</button>
            </div>
          {/if}
        {:else}
          <div class="pokemon-slot empty">（無出場寶可夢）</div>
        {/if}

        <!-- 備戰區 -->
        <div class="zone-label">備戰（{activePlayer?.bench.length ?? 0}/5）</div>
        <div class="bench-row">
          {#each activePlayer?.bench ?? [] as b}
            {@const bc = getCard(b.cardId)}
            {@const evoOptsB = evoOptionsFor(b.iid)}
            <div class="bench-slot"
              class:energy-target={selectedEnergyIid !== null && !pendingSelection}
              onclick={() => selectedEnergyIid && !pendingSelection && onAttachEnergy(b.iid)}>
              <img src={bc?.imageUrl} alt={bc?.name} />
              <div class="bench-name">{bc?.name}</div>
              <div class="bench-hp">HP {hpRemaining(b)}/{bc?.hp}</div>
              <div class="bench-energy">⚡ {energySummary(b)}</div>
              {#if selectedEnergyIid && !pendingSelection}<div class="attach-hint">點此附加</div>{/if}
              <!-- 進化 -->
              {#if evoOptsB.length > 0 && !pendingSelection}
                <button class="evo-btn-sm" onclick={(e)=>{ e.stopPropagation(); showEvoMenu = showEvoMenu === b.iid ? null : b.iid; }}>
                  進化
                </button>
                {#if showEvoMenu === b.iid}
                  <div class="evo-menu">
                    {#each evoOptsB as evo}
                      {@const ec = getCard(evo.cardId)}
                      <button class="evo-choice" onclick={(e)=>{ e.stopPropagation(); dispatch(GameActions.evolve(b.iid, evo.iid)); }}>
                        <img src={ec?.imageUrl} alt={ec?.name} />
                        <span>{ec?.name}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/each}
        </div>

        <!-- 資訊列 -->
        <div class="field-info">
          <span>📦 {activePlayer?.deck.length}</span>
          <span>🗑 {activePlayer?.discard.length}</span>
          <span>🏆 {activePlayer?.prizes.length}</span>
          {#if activePlayer?.energyAttachedThisTurn}<span class="used">⚡ 已附能量</span>{/if}
          {#if activePlayer?.supporterPlayedThisTurn}<span class="used">📋 已用支援者</span>{/if}
        </div>

        <!-- 手牌 -->
        <div class="zone-label">手牌（{activePlayer?.hand.length ?? 0}張）</div>
        <div class="hand-scroll">
          {#each activePlayer?.hand ?? [] as inst}
            {@const c = getCard(inst.cardId)}
            {#if c}
              {@const isEnergyCard = c.supertype === 'Energy'}
              {@const isBasicCard = c.supertype === 'Pokemon' && c.subtype === 'Basic'}
              {@const isTrainerCard = c.supertype === 'Trainer'}
              {@const canEnergy = isEnergyCard && game?.turnPhase === 'main' && !activePlayer?.energyAttachedThisTurn && !pendingSelection}
              {@const canBasic = isBasicCard && playableBasicIids.has(inst.iid)}
              {@const canTrainer = isTrainerCard && playableTrainerIids.has(inst.iid)}
              <div class="hand-card-mini"
                class:selected={selectedEnergyIid === inst.iid}
                class:is-energy={canEnergy}
                class:is-basic={canBasic}
                class:is-trainer={canTrainer}
                onclick={() => {
                  if (canEnergy) selectedEnergyIid = selectedEnergyIid === inst.iid ? null : inst.iid;
                }}
                title={c.name}
              >
                <img src={c.imageUrl} alt={c.name} />
                <span class="hand-name">{c.name}</span>
                {#if canEnergy}
                  <span class="hand-action-hint">選取⚡</span>
                {:else if canBasic}
                  <button class="hand-action-btn basic" onclick={(e)=>{ e.stopPropagation(); dispatch(GameActions.playBasic(inst.iid)); }}>
                    上備戰
                  </button>
                {:else if canTrainer}
                  <button class="hand-action-btn trainer" onclick={(e)=>{ e.stopPropagation(); dispatch(GameActions.playTrainer(inst.iid)); }}>
                    {c.subtype === 'Supporter' ? '支援者' : '使用'}
                  </button>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </section>

    </div><!-- /.battle-layout -->

    <!-- ── PendingSelection 互動疊層 ─────────────────────────────────────── -->
    {#if pendingSelection}
      <div class="selection-overlay">
        <div class="selection-modal">
          <div class="sel-header">
            <h3>{selectionTitle(pendingSelection.type)}</h3>
            <p class="sel-hint">
              選 {pendingSelection.minCount === pendingSelection.maxCount
                ? `${pendingSelection.minCount}`
                : `${pendingSelection.minCount}～${pendingSelection.maxCount}`} 張
              {#if pendingSelection.filter && pendingSelection.filter !== 'TOP6'}
                （{pendingSelection.filter.replace('Basic:HP70', 'HP≤70 基礎寶可夢').replace('Basic', '基礎寶可夢').replace('Pokemon', '寶可夢').replace('Energy', '能量')}）
              {/if}
              · 已選 {selectionPicked.size}
            </p>
          </div>
          <div class="sel-grid">
            {#each selectionItems as item}
              {@const c = getCard(item.cardId)}
              {#if c}
                <button
                  class="sel-card"
                  class:sel-picked={selectionPicked.has(item.iid)}
                  onclick={() => toggleSelection(item.iid)}
                >
                  <img src={c.imageUrl} alt={c.name} />
                  <span class="sel-name">{c.name}</span>
                  {#if c.hp}<span class="sel-hp">HP{c.hp}</span>{/if}
                  {#if selectionPicked.has(item.iid)}<span class="sel-check">✓</span>{/if}
                </button>
              {/if}
            {/each}
            {#if selectionItems.length === 0}
              <p class="sel-empty">（沒有符合條件的卡牌）</p>
            {/if}
          </div>
          <div class="sel-footer">
            <button class="btn-primary" disabled={!selectionValid} onclick={confirmSelection}>
              確定（{selectionPicked.size} 張）
            </button>
            {#if pendingSelection.minCount === 0}
              <button class="btn-secondary" onclick={() => { selectionPicked = new Set(); confirmSelection(); }}>
                不選（跳過）
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

  </div><!-- /.battle-root -->
{/if}

<style>
  :global(body) { margin: 0; background: #1a2a1a; }

  /* ── Lobby / Setup ── */
  .lobby, .setup-screen {
    max-width: 700px; margin: 2rem auto; padding: 1.5rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif; color: #f0f0f0;
  }
  .lobby h1 { font-size: 1.8rem; margin-bottom: 1rem; }
  .back { color: #88ccff; font-size: 0.9rem; text-decoration: none; display: inline-block; margin-bottom: 1rem; }
  .back:hover { text-decoration: underline; }
  .muted { color: #aaa; font-size: 0.9rem; }
  .warn { color: #f0b040; }
  .player-setup {
    display: grid; grid-template-columns: 1fr auto 1fr;
    gap: 1rem; align-items: center; margin: 1.5rem 0;
  }
  .setup-card {
    background: #2a3a2a; border: 1px solid #3a5a3a; border-radius: 10px;
    padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem;
  }
  .setup-card h2 { margin: 0; font-size: 1rem; color: #aaffaa; }
  .name-input, .setup-card select {
    padding: 0.45rem 0.6rem; border: 1px solid #4a6a4a; border-radius: 6px;
    background: #1a2a1a; color: #f0f0f0; font: inherit;
  }
  .vs-badge { font-size: 1.5rem; font-weight: 700; color: #f0b040; text-align: center; }
  .btn-primary {
    display: inline-block; background: #2a7a2a; color: #fff; border: none;
    border-radius: 8px; padding: 0.6rem 1.4rem; font: inherit; font-size: 1rem;
    font-weight: 600; cursor: pointer; text-decoration: none; margin-top: 0.5rem;
  }
  .btn-primary:hover:not(:disabled) { background: #3a9a3a; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary.sm { font-size: 0.85rem; padding: 0.35rem 0.8rem; margin-top: 0; }
  .btn-secondary {
    display: inline-block; background: #2a3a5a; color: #ccddff; border: 1px solid #4a5a8a;
    border-radius: 8px; padding: 0.5rem 1.2rem; font: inherit; cursor: pointer; text-decoration: none;
  }
  .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
  .lobby-btns { display: flex; gap: 1rem; margin-top: 1.5rem; align-items: center; }
  .winner-text { font-size: 1.4rem; font-weight: 700; color: #ffdd55; }

  /* ── Setup screen ── */
  .setup-screen { background: #1a2a1a; border-radius: 10px; }
  .setup-screen h2 { color: #aaffaa; }
  .setup-active, .setup-bench-row { margin: 0.5rem 0; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .poke-chip { padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.85rem; }
  .active-chip { background: #3a7a3a; color: #fff; }
  .bench-chip { background: #2a4a6a; color: #cdf; }
  .hand-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 0.5rem; margin: 0.5rem 0 1rem;
  }
  .hand-card {
    background: #2a3a2a; border: 1px solid #3a5a3a; border-radius: 6px;
    padding: 0.4rem; display: flex; flex-direction: column; align-items: center;
    gap: 0.25rem; font-size: 0.75rem; color: #ddd;
  }
  .hand-card img { width: 70px; border-radius: 4px; }
  .hand-card-name { text-align: center; font-size: 0.72rem; }
  .hand-card.selectable { border-color: #6aaa6a; cursor: pointer; }
  .card-type-tag { font-size: 0.65rem; color: #888; }
  .small { padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid #5a5a5a; background: #2a2a2a; color: #ddd; cursor: pointer; font: inherit; font-size: 0.78rem; }
  .small.danger { color: #f88; border-color: #a44; }
  .small.primary { background: #2a5a2a; color: #aef; border-color: #4a8a4a; }

  /* ── Battle root ── */
  .battle-root { min-height: 100vh; display: flex; flex-direction: column; font-family: system-ui, 'Microsoft JhengHei', sans-serif; color: #f0f0f0; }
  .battle-header {
    display: flex; align-items: center; gap: 1rem; background: #0a1a0a;
    padding: 0.5rem 1rem; border-bottom: 1px solid #2a4a2a; flex-wrap: wrap;
  }
  .small-back { color: #88ccff; text-decoration: none; font-size: 0.85rem; }
  .turn-info { font-weight: 600; flex: 1; }
  .phase-tag { font-size: 0.85rem; color: #aaffaa; }
  .hint { color: #aaa; font-size: 0.8rem; }
  .battle-layout {
    display: grid; grid-template-columns: 1fr 260px 1fr;
    gap: 0.75rem; padding: 0.75rem; flex: 1;
  }

  /* ── Field ── */
  .field {
    background: #1e2e1e; border: 1px solid #2a4a2a; border-radius: 10px;
    padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;
  }
  .field h3 { margin: 0; font-size: 0.95rem; color: #aaffaa; }
  .zone-label {
    font-size: 0.75rem; color: #888; margin-top: 0.25rem;
    display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
  }
  .pokemon-slot {
    border: 1px solid #3a5a3a; border-radius: 8px; padding: 0.5rem;
    display: flex; gap: 0.5rem; align-items: flex-start;
    background: #0e1e0e; cursor: default; position: relative;
  }
  .pokemon-slot.energy-target { border-color: #aaff44; cursor: pointer; animation: pulse 1s infinite alternate; }
  .pokemon-slot.empty { color: #555; font-size: 0.85rem; justify-content: center; min-height: 60px; align-items: center; }
  @keyframes pulse { from { box-shadow: 0 0 4px #aaff44; } to { box-shadow: 0 0 12px #aaff44; } }
  .pokemon-slot img { width: 56px; border-radius: 4px; flex-shrink: 0; }
  .poke-info { flex: 1; min-width: 0; }
  .poke-name { font-weight: 600; font-size: 0.9rem; }
  .hp-bar-wrap { height: 6px; background: #333; border-radius: 3px; overflow: hidden; margin: 3px 0; }
  .hp-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
  .hp-text { font-size: 0.78rem; color: #ccc; }
  .energy-text { font-size: 0.72rem; color: #aaa; }
  .attach-hint { font-size: 0.7rem; color: #aaff44; font-weight: 700; }
  .bench-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .bench-slot {
    background: #0e1e0e; border: 1px solid #2a4a2a; border-radius: 6px;
    padding: 0.3rem; text-align: center; font-size: 0.72rem;
    width: 68px; cursor: default; position: relative;
  }
  .bench-slot.energy-target { border-color: #aaff44; cursor: pointer; }
  .bench-slot img { width: 58px; border-radius: 3px; }
  .bench-name { font-size: 0.65rem; color: #ccc; }
  .bench-hp { color: #aaa; font-size: 0.65rem; }
  .bench-energy { color: #888; font-size: 0.62rem; }
  .field-info { display: flex; gap: 0.6rem; font-size: 0.75rem; color: #888; flex-wrap: wrap; }
  .used { color: #8f8; font-size: 0.72rem; }

  /* ── Evolve ── */
  .evo-wrap { position: absolute; bottom: 0.3rem; right: 0.3rem; }
  .evo-btn {
    padding: 0.18rem 0.4rem; font-size: 0.68rem; background: #3a5a2a;
    border: 1px solid #6aaa4a; border-radius: 4px; color: #aef; cursor: pointer;
  }
  .evo-btn:hover { background: #4a7a3a; }
  .evo-btn-sm {
    display: block; width: 100%; margin-top: 0.2rem;
    padding: 0.15rem; font-size: 0.62rem; background: #3a5a2a;
    border: 1px solid #6aaa4a; border-radius: 3px; color: #aef; cursor: pointer;
  }
  .evo-menu {
    position: absolute; bottom: 100%; right: 0; z-index: 10;
    background: #1a2a1a; border: 1px solid #4a8a4a; border-radius: 6px;
    padding: 0.4rem; display: flex; flex-direction: column; gap: 0.3rem;
    min-width: 90px; box-shadow: 0 4px 12px #000a;
  }
  .evo-choice {
    display: flex; flex-direction: column; align-items: center; gap: 0.2rem;
    background: #2a3a2a; border: 1px solid #4a6a4a; border-radius: 4px;
    padding: 0.3rem; cursor: pointer; color: #ddd; font-size: 0.7rem;
  }
  .evo-choice img { width: 52px; border-radius: 3px; }
  .evo-choice:hover { background: #3a5a3a; }

  /* ── Retreat ── */
  .small-action-btn {
    padding: 0.15rem 0.4rem; font-size: 0.68rem; background: #3a3a6a;
    border: 1px solid #6a6aaa; border-radius: 4px; color: #ccf; cursor: pointer;
  }
  .small-action-btn:hover { background: #4a4a8a; }
  .retreat-picker {
    display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center;
    background: #1a1a3a; border: 1px solid #4a4a8a; border-radius: 8px; padding: 0.5rem;
  }
  .retreat-label { font-size: 0.78rem; color: #aaf; width: 100%; }

  /* ── Hand ── */
  .hand-scroll { display: flex; gap: 0.3rem; overflow-x: auto; padding-bottom: 0.25rem; }
  .hand-card-mini {
    flex-shrink: 0; width: 60px; background: #0e1e0e; border: 1px solid #2a4a2a;
    border-radius: 5px; padding: 0.2rem; text-align: center; cursor: default;
    font-size: 0.62rem; color: #bbb; position: relative;
  }
  .hand-card-mini.is-energy { border-color: #c0a020; cursor: pointer; }
  .hand-card-mini.is-basic { border-color: #5a9a5a; }
  .hand-card-mini.is-trainer { border-color: #5a7aba; }
  .hand-card-mini.selected { border-color: #aaff44; box-shadow: 0 0 6px #aaff44; }
  .hand-card-mini img { width: 56px; border-radius: 3px; }
  .hand-name { display: block; font-size: 0.6rem; margin-top: 0.15rem; }
  .hand-action-hint { display: block; font-size: 0.6rem; color: #aaff44; margin-top: 0.1rem; }
  .hand-action-btn {
    display: block; width: 100%; margin-top: 0.2rem; padding: 0.15rem 0;
    border-radius: 3px; font-size: 0.62rem; cursor: pointer; border: none;
  }
  .hand-action-btn.basic { background: #2a5a2a; color: #aef; }
  .hand-action-btn.basic:hover { background: #3a7a3a; }
  .hand-action-btn.trainer { background: #2a3a6a; color: #ccf; }
  .hand-action-btn.trainer:hover { background: #3a5a9a; }

  /* ── Action zone ── */
  .action-zone {
    background: #0a1a0a; border: 1px solid #2a4a2a; border-radius: 10px;
    padding: 0.75rem; display: flex; flex-direction: column; gap: 0.6rem;
  }
  .alert-box {
    background: #2a4a1a; border: 1px solid #4a8a3a; border-radius: 8px;
    padding: 0.6rem 0.75rem; font-size: 0.88rem;
  }
  .alert-box.warn { background: #3a2a0a; border-color: #8a6a2a; }
  .bench-pick-row { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .bench-pick-btn {
    display: flex; flex-direction: column; align-items: center;
    background: #1a3a1a; border: 1px solid #4a8a4a; border-radius: 6px;
    padding: 0.3rem; cursor: pointer; color: #ddd; font-size: 0.75rem; gap: 0.2rem;
  }
  .bench-pick-btn img { width: 50px; border-radius: 3px; }
  .bench-pick-btn:hover { background: #2a5a2a; }
  .action-btns { display: flex; flex-direction: column; gap: 0.5rem; }
  .btn-attack {
    display: flex; align-items: center; gap: 0.5rem; background: #1a2a3a;
    border: 1px solid #3a5a7a; border-radius: 8px; padding: 0.5rem 0.75rem;
    color: #ccd; cursor: not-allowed; opacity: 0.5; font: inherit; font-size: 0.88rem; text-align: left;
  }
  .btn-attack.available { opacity: 1; cursor: pointer; border-color: #6a9aff; }
  .btn-attack.available:hover { background: #1a3a5a; }
  .atk-cost-row { display: flex; gap: 0.2rem; }
  .epip {
    width: 1.2rem; height: 1.2rem; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 0.6rem; font-weight: 700; color: #fff; flex-shrink: 0;
  }
  .atk-name { flex: 1; }
  .atk-dmg { font-weight: 700; color: #f88; }
  .log-box {
    flex: 1; background: #050f05; border: 1px solid #1a3a1a; border-radius: 6px; padding: 0.5rem; overflow: hidden;
  }
  .log-title { font-size: 0.72rem; color: #555; margin-bottom: 0.3rem; }
  .log-entries { display: flex; flex-direction: column; gap: 0.2rem; max-height: 200px; overflow-y: auto; }
  .log-entry { font-size: 0.75rem; color: #99aa99; padding: 0.15rem 0; border-bottom: 1px solid #1a2a1a; }
  .log-entry.system { color: #aaffaa; font-weight: 600; }

  /* ── PendingSelection Overlay ── */
  .selection-overlay {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center;
  }
  .selection-modal {
    background: #1a2a1a; border: 1px solid #4a8a4a; border-radius: 12px;
    padding: 1.25rem; max-width: 680px; width: 95vw; max-height: 85vh;
    display: flex; flex-direction: column; gap: 0.75rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif; color: #f0f0f0;
  }
  .sel-header h3 { margin: 0 0 0.25rem; font-size: 1.1rem; color: #aaffaa; }
  .sel-hint { margin: 0; font-size: 0.85rem; color: #aaa; }
  .sel-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 0.4rem; overflow-y: auto; max-height: 52vh; padding-right: 0.25rem;
  }
  .sel-card {
    display: flex; flex-direction: column; align-items: center; gap: 0.2rem;
    background: #0e1e0e; border: 2px solid #2a4a2a; border-radius: 6px;
    padding: 0.3rem; cursor: pointer; color: #ccc; font-size: 0.65rem; position: relative;
  }
  .sel-card:hover { border-color: #4a8a4a; }
  .sel-card.sel-picked { border-color: #aaff44; box-shadow: 0 0 6px #aaff4488; }
  .sel-card img { width: 64px; border-radius: 3px; }
  .sel-name { text-align: center; font-size: 0.6rem; }
  .sel-hp { font-size: 0.58rem; color: #888; }
  .sel-check {
    position: absolute; top: 2px; right: 4px;
    font-size: 0.9rem; color: #aaff44; font-weight: 700;
  }
  .sel-empty { color: #666; font-size: 0.85rem; grid-column: 1/-1; text-align: center; padding: 1rem; }
  .sel-footer { display: flex; gap: 0.75rem; justify-content: flex-end; flex-wrap: wrap; }
</style>
