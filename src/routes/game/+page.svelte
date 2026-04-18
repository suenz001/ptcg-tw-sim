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
    if (counts.size === 0) return '無能量';
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
<!--  正式對戰畫面（Play Mat 佈局）                                          -->
<!-- ══════════════════════════════════════════════════════════════════════ -->
{:else}
<div class="battle-root">

  <!-- ── 頂部資訊列 ── -->
  <header class="battle-header">
    <a href="{base}/" class="back small-back">← 首頁</a>
    <span class="turn-info">
      回合 {game.turn}　<strong>{activePlayer?.name}</strong> 行動中
      {#if game.isFirstTurn && aIdx === 0}<span class="hint">（先手第1回合不能攻擊/進化）</span>{/if}
    </span>
    <span class="phase-tag">
      {#if game.turnPhase === 'draw'}📥 抽牌
      {:else if game.turnPhase === 'main'}🎮 主階段
      {:else}⏭ 回合結束{/if}
    </span>
    <span class="status-chips">
      {#if activePlayer?.energyAttachedThisTurn}<span class="chip">⚡已附能</span>{/if}
      {#if activePlayer?.supporterPlayedThisTurn}<span class="chip">📋已用支援</span>{/if}
      {#if activePlayer?.retreatedThisTurn}<span class="chip">🔄已撤退</span>{/if}
    </span>
  </header>

  <!-- ── Play Mat ── -->
  <div class="playmat">

    <!-- ════ 對手場地（上半）════
         佈局：[牌庫棄牌] [←備戰(5格)] [出場] [獎勵牌]
    -->
    <div class="field-row opponent-row">

      <!-- 對手：牌庫 + 棄牌（最左） -->
      <div class="zone-pile">
        <div class="pile-slot deck-pile" title="對手牌庫">
          <span class="pile-icon">🃏</span>
          <span class="pile-count">{defenderPlayer?.deck.length ?? 0}</span>
          <span class="pile-label">牌庫</span>
        </div>
        <div class="pile-slot disc-pile" title="對手棄牌區">
          <span class="pile-icon">🗑</span>
          <span class="pile-count">{defenderPlayer?.discard.length ?? 0}</span>
          <span class="pile-label">棄牌</span>
        </div>
      </div>

      <!-- 對手：備戰區（5格，靠近牌庫側） -->
      <div class="zone-bench">
        {#each Array(5) as _, i}
          {#if defenderPlayer?.bench[i]}
            {@const b = defenderPlayer.bench[i]}
            {@const bc = getCard(b.cardId)}
            <div class="bench-slot">
              <img src={bc?.imageUrl} alt={bc?.name} />
              <div class="hp-bar-wrap sm">
                <div class="hp-bar" style="width:{bc?.hp ? hpRemaining(b)/bc.hp*100 : 0}%;background:{hpColor(hpRemaining(b),bc?.hp??0)}"></div>
              </div>
              <div class="bench-name">{bc?.name}</div>
              <div class="bench-stat">HP {hpRemaining(b)}/{bc?.hp}</div>
            </div>
          {:else}
            <div class="bench-slot bench-empty"></div>
          {/if}
        {/each}
      </div>

      <!-- 對手：出場寶可夢（中央） -->
      <div class="zone-active">
        <div class="zone-label-sm opp-label">對手出場</div>
        {#if defenderPlayer?.active}
          {@const ac = getCard(defenderPlayer.active.cardId)}
          <div class="active-card opp-active">
            <img src={ac?.imageUrl} alt={ac?.name} class="active-img" />
            <div class="active-info">
              <div class="active-name">{ac?.name}</div>
              <div class="hp-bar-wrap">
                <div class="hp-bar" style="width:{ac?.hp ? hpRemaining(defenderPlayer.active)/ac.hp*100 : 0}%;background:{hpColor(hpRemaining(defenderPlayer.active),ac?.hp??0)}"></div>
              </div>
              <div class="active-hp">HP {hpRemaining(defenderPlayer.active)}/{ac?.hp}</div>
              <div class="active-nrg">{energySummary(defenderPlayer.active)}</div>
            </div>
          </div>
        {:else}
          <div class="active-card active-empty">（無出場）</div>
        {/if}
      </div>

      <!-- 對手：獎勵牌（最右） -->
      <div class="zone-prizes">
        <div class="prize-grid">
          {#each Array(6) as _, i}
            <div class="prize-card" class:prize-gone={i >= (defenderPlayer?.prizes.length ?? 0)}></div>
          {/each}
        </div>
        <div class="zone-label-sm">獎勵 {defenderPlayer?.prizes.length ?? 0}張</div>
      </div>

    </div><!-- /.opponent-row -->

    <!-- ════ 中間行動列 ════ -->
    <div class="action-bar">

      <!-- 警示訊息 -->
      <div class="alerts-col">
        {#if pendingPrizes > 0}
          <div class="alert prize-alert">
            🏆 取 {pendingPrizes} 張獎勵牌
            <button class="btn-xs primary" onclick={() => dispatch(GameActions.takePrizes(pendingPrizes))}>取得</button>
          </div>
        {/if}
        {#if game.phase === 'playing' && defenderPlayer?.active === null && game.turnPhase === 'end'}
          <div class="alert warn-alert">
            ⚠️ {defenderPlayer?.name} 須送出寶可夢
            <div class="mini-row">
              {#each defenderPlayer?.bench ?? [] as b}
                {@const bc = getCard(b.cardId)}
                <button class="mini-poke-btn" onclick={() => {
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
      </div>

      <!-- 行動按鈕 -->
      <div class="action-btns">
        {#if game.turnPhase === 'draw'}
          <button class="btn-act primary" onclick={() => dispatch(GameActions.drawCard())}>📥 抽牌</button>
        {/if}

        {#if game.turnPhase === 'main' && activePlayer?.active}
          {@const ac = getCard(activePlayer.active.cardId)}
          {#each ac?.attacks ?? [] as atk, i}
            <button class="btn-act atk"
              class:atk-ready={availableAttacks.includes(i)}
              disabled={!availableAttacks.includes(i) || !!pendingSelection}
              onclick={() => dispatch(GameActions.attack(i))}>
              <span class="cost-row">
                {#each atk.cost as e}
                  <span class="epip" style="background:{ENERGY_COLOR[e]}">{ENERGY_LABEL[e]}</span>
                {/each}
              </span>
              <span class="atk-name">{atk.name}</span>
              <span class="atk-dmg">{atk.damage || '—'}</span>
            </button>
          {/each}
          <button class="btn-act secondary" disabled={!!pendingSelection}
            onclick={() => { if(game) game = {...game, turnPhase:'end'}; }}>
            跳過攻擊 →
          </button>
        {/if}

        {#if canEndTurn}
          <button class="btn-act primary" onclick={() => dispatch(GameActions.endTurn())}>⏭ 結束回合</button>
        {/if}
      </div>

      <!-- 行動紀錄 -->
      <div class="log-col">
        {#each [...(game.log ?? [])].reverse().slice(0, 12) as entry}
          <div class="log-line" class:log-sys={entry.playerIndex === null}>{entry.message}</div>
        {/each}
      </div>

    </div><!-- /.action-bar -->

    <!-- ════ 我的場地（下半）════
         佈局：[獎勵牌] [出場] [備戰(5格)→] [牌庫棄牌]
    -->
    <div class="field-row my-row">

      <!-- 我的：獎勵牌（最左） -->
      <div class="zone-prizes">
        <div class="zone-label-sm">獎勵 {activePlayer?.prizes.length ?? 0}張</div>
        <div class="prize-grid">
          {#each Array(6) as _, i}
            <div class="prize-card my-prize" class:prize-gone={i >= (activePlayer?.prizes.length ?? 0)}></div>
          {/each}
        </div>
      </div>

      <!-- 我的：出場寶可夢（中央） -->
      <div class="zone-active my-active-zone">
        <div class="zone-label-sm">
          我的出場
          {#if canRetreatNow && !showRetreatPicker && !pendingSelection}
            <button class="btn-retreat" onclick={() => showRetreatPicker = !showRetreatPicker}>
              撤退（{retreatCostOf(activePlayer!.active!)}⚡）
            </button>
          {/if}
        </div>

        {#if activePlayer?.active}
          {@const ac = getCard(activePlayer.active.cardId)}
          {@const evoOpts = evoOptionsFor(activePlayer.active.iid)}
          <div class="active-card mine-active"
            class:energy-target={selectedEnergyIid !== null && !pendingSelection}
            onclick={() => selectedEnergyIid && !pendingSelection && onAttachEnergy(activePlayer!.active!.iid)}>
            <img src={ac?.imageUrl} alt={ac?.name} class="active-img" />
            <div class="active-info">
              <div class="active-name">{ac?.name}</div>
              <div class="hp-bar-wrap">
                <div class="hp-bar" style="width:{ac?.hp ? hpRemaining(activePlayer.active)/ac.hp*100 : 0}%;background:{hpColor(hpRemaining(activePlayer.active),ac?.hp??0)}"></div>
              </div>
              <div class="active-hp">HP {hpRemaining(activePlayer.active)}/{ac?.hp}</div>
              <div class="active-nrg">{energySummary(activePlayer.active)}</div>
              {#if selectedEnergyIid && !pendingSelection}
                <div class="attach-hint">⚡ 點此附加</div>
              {/if}
            </div>
            <!-- 進化按鈕 -->
            {#if evoOpts.length > 0 && !pendingSelection}
              <div class="evo-wrap">
                <button class="evo-btn" onclick={(e)=>{ e.stopPropagation(); showEvoMenu = showEvoMenu===activePlayer!.active!.iid ? null : activePlayer!.active!.iid; }}>
                  進化▲
                </button>
                {#if showEvoMenu === activePlayer.active.iid}
                  <div class="evo-menu">
                    {#each evoOpts as evo}
                      {@const ec = getCard(evo.cardId)}
                      <button class="evo-choice" onclick={(e)=>{ e.stopPropagation(); dispatch(GameActions.evolve(activePlayer!.active!.iid, evo.iid)); }}>
                        <img src={ec?.imageUrl} alt={ec?.name} /><span>{ec?.name}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- 撤退選擇 -->
          {#if showRetreatPicker && !pendingSelection}
            <div class="retreat-picker">
              <span class="retreat-label">選擇換入：</span>
              {#each activePlayer.bench as b}
                {@const bc = getCard(b.cardId)}
                <button class="mini-poke-btn" onclick={() => dispatch(GameActions.retreat(b.iid))}>
                  <img src={bc?.imageUrl} alt={bc?.name} /><span>{bc?.name}</span>
                </button>
              {/each}
              <button class="btn-xs" onclick={() => showRetreatPicker = false}>取消</button>
            </div>
          {/if}
        {:else}
          <div class="active-card active-empty">（無出場）</div>
        {/if}
      </div>

      <!-- 我的：備戰區（5格） -->
      <div class="zone-bench">
        {#each Array(5) as _, i}
          {#if activePlayer?.bench[i]}
            {@const b = activePlayer.bench[i]}
            {@const bc = getCard(b.cardId)}
            {@const evoOptsB = evoOptionsFor(b.iid)}
            <div class="bench-slot"
              class:energy-target={selectedEnergyIid !== null && !pendingSelection}
              onclick={() => selectedEnergyIid && !pendingSelection && onAttachEnergy(b.iid)}>
              <img src={bc?.imageUrl} alt={bc?.name} />
              <div class="hp-bar-wrap sm">
                <div class="hp-bar" style="width:{bc?.hp ? hpRemaining(b)/bc.hp*100 : 0}%;background:{hpColor(hpRemaining(b),bc?.hp??0)}"></div>
              </div>
              <div class="bench-name">{bc?.name}</div>
              <div class="bench-stat">HP {hpRemaining(b)}/{bc?.hp}</div>
              <div class="bench-nrg">{energySummary(b)}</div>
              {#if selectedEnergyIid && !pendingSelection}<div class="attach-hint">⚡</div>{/if}
              {#if evoOptsB.length > 0 && !pendingSelection}
                <button class="evo-btn-sm" onclick={(e)=>{ e.stopPropagation(); showEvoMenu = showEvoMenu===b.iid ? null : b.iid; }}>進化</button>
                {#if showEvoMenu === b.iid}
                  <div class="evo-menu evo-above">
                    {#each evoOptsB as evo}
                      {@const ec = getCard(evo.cardId)}
                      <button class="evo-choice" onclick={(e)=>{ e.stopPropagation(); dispatch(GameActions.evolve(b.iid, evo.iid)); }}>
                        <img src={ec?.imageUrl} alt={ec?.name} /><span>{ec?.name}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {:else}
            <div class="bench-slot bench-empty"></div>
          {/if}
        {/each}
      </div>

      <!-- 我的：牌庫 + 棄牌（最右） -->
      <div class="zone-pile">
        <div class="pile-slot deck-pile" title="我的牌庫">
          <span class="pile-icon">🃏</span>
          <span class="pile-count">{activePlayer?.deck.length ?? 0}</span>
          <span class="pile-label">牌庫</span>
        </div>
        <div class="pile-slot disc-pile" title="我的棄牌區">
          <span class="pile-icon">🗑</span>
          <span class="pile-count">{activePlayer?.discard.length ?? 0}</span>
          <span class="pile-label">棄牌</span>
        </div>
      </div>

    </div><!-- /.my-row -->

  </div><!-- /.playmat -->

  <!-- ── 手牌列 ── -->
  <div class="hand-strip">
    <div class="hand-label">
      ✋ {activePlayer?.name} 的手牌（{activePlayer?.hand.length ?? 0} 張）
    </div>
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
          <div class="hand-card"
            class:selected={selectedEnergyIid === inst.iid}
            class:can-energy={canEnergy}
            class:can-basic={canBasic}
            class:can-trainer={canTrainer}
            onclick={() => { if (canEnergy) selectedEnergyIid = selectedEnergyIid === inst.iid ? null : inst.iid; }}
            title={c.name}>
            <img src={c.imageUrl} alt={c.name} />
            <span class="hand-name">{c.name}</span>
            {#if canEnergy}
              <span class="hand-hint energy-hint">選取⚡</span>
            {:else if canBasic}
              <button class="hand-btn basic-btn" onclick={(e)=>{ e.stopPropagation(); dispatch(GameActions.playBasic(inst.iid)); }}>備戰</button>
            {:else if canTrainer}
              <button class="hand-btn trainer-btn" onclick={(e)=>{ e.stopPropagation(); dispatch(GameActions.playTrainer(inst.iid)); }}>
                {c.subtype === 'Supporter' ? '支援者' : '使用'}
              </button>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>

  <!-- ── PendingSelection 互動疊層 ── -->
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
              （{pendingSelection.filter.replace('Basic:HP70','HP≤70基礎寶可夢').replace('Basic','基礎寶可夢').replace('Pokemon','寶可夢').replace('Energy','能量')}）
            {/if}
            · 已選 {selectionPicked.size}
          </p>
        </div>
        <div class="sel-grid">
          {#each selectionItems as item}
            {@const c = getCard(item.cardId)}
            {#if c}
              <button class="sel-card" class:sel-picked={selectionPicked.has(item.iid)} onclick={() => toggleSelection(item.iid)}>
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
          <button class="btn-act primary" disabled={!selectionValid} onclick={confirmSelection}>
            確定（{selectionPicked.size} 張）
          </button>
          {#if pendingSelection.minCount === 0}
            <button class="btn-act secondary" onclick={() => { selectionPicked = new Set(); confirmSelection(); }}>
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
  :global(body) { margin: 0; background: #162816; }

  /* ════════════════ Lobby / Setup ════════════════ */
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
  .btn-secondary {
    display: inline-block; background: #2a3a5a; color: #ccddff; border: 1px solid #4a5a8a;
    border-radius: 8px; padding: 0.5rem 1.2rem; font: inherit; cursor: pointer; text-decoration: none;
  }
  .lobby-btns { display: flex; gap: 1rem; margin-top: 1.5rem; align-items: center; }
  .winner-text { font-size: 1.4rem; font-weight: 700; color: #ffdd55; }

  /* Setup screen */
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

  /* ════════════════ Battle Root ════════════════ */
  .battle-root {
    height: 100vh;
    display: flex;
    flex-direction: column;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
    color: #f0f0f0;
    overflow: hidden;
  }

  /* ── Header ── */
  .battle-header {
    display: flex; align-items: center; gap: 0.6rem;
    background: #0a180a; padding: 0.35rem 0.75rem;
    border-bottom: 1px solid #2a4a2a; flex-shrink: 0; flex-wrap: wrap;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  .small-back { color: #88ccff; text-decoration: none; font-size: 0.82rem; }
  .small-back:hover { text-decoration: underline; }
  .turn-info { flex: 1; font-size: 0.88rem; }
  .hint { color: #888; font-size: 0.75rem; }
  .phase-tag {
    font-size: 0.78rem; color: #aaffaa;
    background: #0e2e0e; padding: 0.18rem 0.5rem; border-radius: 4px;
  }
  .status-chips { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .chip {
    font-size: 0.68rem; padding: 0.1rem 0.35rem;
    border-radius: 10px; background: #1a3a1a; color: #8f8; border: 1px solid #2a5a2a;
  }

  /* ── Playmat ── */
  .playmat {
    flex: 1;
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    overflow: hidden;
    background:
      linear-gradient(180deg,
        rgba(0,60,0,0.25) 0%,
        rgba(0,40,0,0.1) 48%,
        rgba(0,0,0,0.5) 50%,
        rgba(0,40,0,0.1) 52%,
        rgba(0,60,0,0.25) 100%),
      #1a2e1a;
  }

  /* ── Field Rows ── */
  .field-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    overflow: hidden;
    min-height: 0;
  }
  .opponent-row {
    border-bottom: 2px solid #2a5a2a;
    background: rgba(0,0,0,0.2);
    align-items: flex-end; /* 對手場地牌往下對齊（靠近中線） */
    padding-bottom: 0.5rem;
  }
  .my-row {
    border-top: 2px solid #2a5a2a;
    align-items: flex-start; /* 我方場地牌往上對齊（靠近中線） */
    padding-top: 0.5rem;
  }

  /* ── Prizes Zone ── */
  .zone-prizes {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
  }
  .prize-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
  }
  .prize-card {
    width: 30px; height: 42px;
    background: linear-gradient(135deg, #1e4a8a 0%, #2a6ab0 60%, #1e4a8a 100%);
    border: 1px solid #4a8ac0;
    border-radius: 3px;
    transition: opacity 0.3s;
  }
  .prize-card.my-prize {
    background: linear-gradient(135deg, #2a6a1a 0%, #3a8a2a 60%, #2a6a1a 100%);
    border-color: #5aaa4a;
  }
  .prize-card.prize-gone {
    background: transparent;
    border-color: #2a3a2a;
    opacity: 0.3;
  }
  .zone-label-sm { font-size: 0.62rem; color: #888; text-align: center; white-space: nowrap; }
  .opp-label { color: #aa8888; }

  /* ── Active Zone ── */
  .zone-active {
    flex-shrink: 0;
    width: 195px;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .my-active-zone { position: relative; }

  .active-card {
    display: flex;
    gap: 0.4rem;
    background: rgba(0,0,0,0.35);
    border: 1px solid #3a5a3a;
    border-radius: 8px;
    padding: 0.4rem;
    align-items: flex-start;
    position: relative;
    cursor: default;
    min-height: 90px;
  }
  .active-card.opp-active { border-color: #5a3a3a; background: rgba(0,0,0,0.4); }
  .active-card.mine-active { border-color: #3a6a3a; }
  .active-card.energy-target { border-color: #aaff44; cursor: pointer; animation: glow 1s infinite alternate; }
  .active-card.active-empty { justify-content: center; align-items: center; color: #555; font-size: 0.82rem; }
  .active-img { width: 68px; border-radius: 4px; flex-shrink: 0; }
  .active-info { flex: 1; min-width: 0; }
  .active-name { font-size: 0.85rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .active-hp { font-size: 0.73rem; color: #ccc; }
  .active-nrg { font-size: 0.67rem; color: #aaa; }
  .attach-hint { font-size: 0.65rem; color: #aaff44; font-weight: 700; margin-top: 0.15rem; }

  @keyframes glow {
    from { box-shadow: 0 0 4px #aaff44; }
    to   { box-shadow: 0 0 14px #aaff44; }
  }

  /* ── Bench Zone ── */
  .zone-bench {
    flex: 1;
    display: flex;
    gap: 0.3rem;
    overflow: hidden;
    min-width: 0;
  }
  .bench-slot {
    flex: 1;
    min-width: 0;
    max-width: 80px;
    background: rgba(0,0,0,0.25);
    border: 1px solid #2a4a2a;
    border-radius: 6px;
    padding: 0.25rem;
    text-align: center;
    font-size: 0.62rem;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.05rem;
    cursor: default;
    overflow: hidden;
  }
  .bench-slot:not(.bench-empty).energy-target {
    border-color: #aaff44;
    cursor: pointer;
  }
  .bench-slot img { width: 100%; max-width: 62px; border-radius: 3px; }
  .bench-empty {
    border-style: dashed;
    border-color: #1a3a1a;
    opacity: 0.4;
  }
  .bench-name { font-size: 0.6rem; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; text-align: center; }
  .bench-stat { font-size: 0.58rem; color: #aaa; }
  .bench-nrg  { font-size: 0.55rem; color: #888; }

  /* ── Pile Zone (deck + discard) ── */
  .zone-pile {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    width: 58px;
    align-items: center;
  }
  .pile-slot {
    width: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    padding: 0.3rem 0.2rem;
    gap: 0.1rem;
    min-height: 52px;
  }
  .deck-pile {
    background: linear-gradient(135deg, #1a3a6a, #2a5a9a);
    border: 1px solid #4a7aaa;
  }
  .disc-pile {
    background: #1a1a2a;
    border: 1px dashed #3a3a5a;
  }
  .pile-icon { font-size: 1rem; line-height: 1; }
  .pile-count { font-size: 1rem; font-weight: 700; color: #fff; }
  .pile-label { font-size: 0.58rem; color: #aaa; }

  /* ── HP bars ── */
  .hp-bar-wrap { height: 6px; background: #1a2a1a; border-radius: 3px; overflow: hidden; margin: 2px 0; }
  .hp-bar-wrap.sm { height: 4px; }
  .hp-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }

  /* ── Action Bar ── */
  .action-bar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5rem;
    padding: 0.3rem 0.6rem;
    background: rgba(0,0,0,0.6);
    border-top: 1px solid #2a4a2a;
    border-bottom: 1px solid #2a4a2a;
    flex-shrink: 0;
    align-items: center;
    min-height: 50px;
  }

  .alerts-col { display: flex; flex-direction: column; gap: 0.2rem; max-width: 260px; }
  .alert {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem;
    padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.78rem;
  }
  .prize-alert { background: #2a4a1a; border: 1px solid #4a8a3a; }
  .warn-alert { background: #3a2a0a; border: 1px solid #8a6a2a; }
  .mini-row { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.2rem; width: 100%; }

  .action-btns {
    display: flex; flex-wrap: wrap; gap: 0.35rem;
    justify-content: center; align-items: center;
  }

  .btn-act {
    display: inline-flex; align-items: center; gap: 0.25rem;
    padding: 0.3rem 0.7rem; border-radius: 6px; border: none;
    font: inherit; font-size: 0.8rem; font-weight: 600;
    cursor: pointer; white-space: nowrap;
  }
  .btn-act.primary { background: #2a7a2a; color: #fff; }
  .btn-act.primary:hover:not(:disabled) { background: #3a9a3a; }
  .btn-act.primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-act.secondary { background: #2a3a5a; color: #ccddff; border: 1px solid #4a5a8a; }
  .btn-act.secondary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-act.atk {
    background: #1a2a3a; border: 1px solid #3a5a7a;
    color: #ccd; opacity: 0.45; cursor: not-allowed;
  }
  .btn-act.atk.atk-ready { opacity: 1; cursor: pointer; border-color: #6a9aff; }
  .btn-act.atk.atk-ready:not(:disabled):hover { background: #1a3a5a; }

  .cost-row { display: flex; gap: 0.15rem; }
  .epip {
    width: 1.1rem; height: 1.1rem; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 0.52rem; font-weight: 700; color: #fff; flex-shrink: 0;
  }
  .atk-name { max-width: 100px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .atk-dmg { font-weight: 700; color: #f88; }

  .log-col {
    max-width: 190px; max-height: 80px; overflow-y: auto;
    font-size: 0.62rem;
  }
  .log-line { color: #7a9a7a; padding: 0.06rem 0; border-bottom: 1px solid #1a2a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .log-sys { color: #aaffaa; font-weight: 600; }

  /* ── Retreat ── */
  .btn-retreat {
    padding: 0.1rem 0.3rem; font-size: 0.62rem;
    background: #3a3a6a; border: 1px solid #6a6aaa;
    border-radius: 4px; color: #ccf; cursor: pointer;
  }
  .btn-retreat:hover { background: #4a4a8a; }
  .retreat-picker {
    position: absolute; bottom: 100%; left: 0; right: 0; z-index: 20;
    display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center;
    background: #1a1a3a; border: 1px solid #4a4a8a;
    border-radius: 8px; padding: 0.4rem; font-size: 0.7rem;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.6);
  }
  .retreat-label { font-size: 0.72rem; color: #aaf; width: 100%; }

  /* ── Mini pick buttons ── */
  .mini-poke-btn {
    display: flex; flex-direction: column; align-items: center;
    background: #1a3a1a; border: 1px solid #4a8a4a; border-radius: 5px;
    padding: 0.2rem; cursor: pointer; color: #ddd; font-size: 0.65rem; gap: 0.1rem;
  }
  .mini-poke-btn img { width: 38px; border-radius: 2px; }
  .mini-poke-btn:hover { background: #2a5a2a; }

  .btn-xs {
    padding: 0.15rem 0.4rem; border-radius: 4px;
    border: 1px solid #5a5a5a; background: #2a2a2a;
    color: #ddd; cursor: pointer; font: inherit; font-size: 0.72rem;
  }
  .btn-xs.primary { background: #2a7a2a; border-color: #4a9a4a; color: #fff; }

  /* ── Evolve ── */
  .evo-wrap { position: absolute; bottom: 0.25rem; right: 0.25rem; }
  .evo-btn {
    padding: 0.12rem 0.32rem; font-size: 0.62rem;
    background: #3a5a2a; border: 1px solid #6aaa4a;
    border-radius: 4px; color: #aef; cursor: pointer;
  }
  .evo-btn:hover { background: #4a7a3a; }
  .evo-btn-sm {
    display: block; width: 100%; margin-top: 0.15rem;
    padding: 0.1rem; font-size: 0.56rem;
    background: #3a5a2a; border: 1px solid #6aaa4a;
    border-radius: 3px; color: #aef; cursor: pointer;
  }
  .evo-menu {
    position: absolute; bottom: 100%; right: 0; z-index: 30;
    background: #1a2a1a; border: 1px solid #4a8a4a; border-radius: 6px;
    padding: 0.3rem; display: flex; flex-direction: column; gap: 0.2rem;
    min-width: 80px; box-shadow: 0 4px 14px rgba(0,0,0,0.8);
  }
  .evo-above { bottom: auto; top: 100%; }
  .evo-choice {
    display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
    background: #2a3a2a; border: 1px solid #4a6a4a; border-radius: 4px;
    padding: 0.25rem; cursor: pointer; color: #ddd; font-size: 0.62rem;
  }
  .evo-choice img { width: 48px; border-radius: 3px; }
  .evo-choice:hover { background: #3a5a3a; }

  /* ── Hand Strip ── */
  .hand-strip {
    flex-shrink: 0;
    background: #0a160a;
    border-top: 2px solid #2a5a2a;
    padding: 0.25rem 0.5rem 0.35rem;
  }
  .hand-label {
    font-size: 0.65rem; color: #5a8a5a;
    margin-bottom: 0.2rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  .hand-scroll {
    display: flex; gap: 0.25rem; overflow-x: auto; padding-bottom: 0.2rem;
  }
  .hand-scroll::-webkit-scrollbar { height: 4px; }
  .hand-scroll::-webkit-scrollbar-thumb { background: #2a4a2a; border-radius: 2px; }

  .hand-card {
    flex-shrink: 0; width: 58px;
    background: #0e1e0e; border: 1px solid #2a3a2a;
    border-radius: 5px; padding: 0.18rem;
    text-align: center; cursor: default;
    display: flex; flex-direction: column; align-items: center; gap: 0.08rem;
    transition: border-color 0.15s;
  }
  .hand-card img { width: 54px; border-radius: 3px; }
  .hand-name { font-size: 0.56rem; color: #bbb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
  .hand-hint { font-size: 0.56rem; }
  .energy-hint { color: #aaff44; }

  .hand-card.can-energy { border-color: #c0a020; cursor: pointer; }
  .hand-card.can-basic  { border-color: #5a9a5a; }
  .hand-card.can-trainer{ border-color: #5a7aba; }
  .hand-card.selected   { border-color: #aaff44; box-shadow: 0 0 6px #aaff4488; }

  .hand-btn {
    display: block; width: 100%; margin-top: 0.12rem;
    padding: 0.1rem 0; border-radius: 3px;
    font-size: 0.56rem; cursor: pointer; border: none;
  }
  .basic-btn   { background: #2a5a2a; color: #aef; }
  .basic-btn:hover   { background: #3a7a3a; }
  .trainer-btn { background: #2a3a6a; color: #ccf; }
  .trainer-btn:hover { background: #3a5a9a; }

  /* ── PendingSelection Overlay ── */
  .selection-overlay {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0,0,0,0.82);
    display: flex; align-items: center; justify-content: center;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
  }
  .selection-modal {
    background: #1a2a1a; border: 1px solid #4a8a4a; border-radius: 12px;
    padding: 1.25rem; max-width: 680px; width: 95vw; max-height: 85vh;
    display: flex; flex-direction: column; gap: 0.75rem; color: #f0f0f0;
  }
  .sel-header h3 { margin: 0 0 0.2rem; font-size: 1.1rem; color: #aaffaa; }
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
  .sel-check { position: absolute; top: 2px; right: 4px; font-size: 0.9rem; color: #aaff44; font-weight: 700; }
  .sel-empty { color: #666; font-size: 0.85rem; grid-column: 1/-1; text-align: center; padding: 1rem; }
  .sel-footer { display: flex; gap: 0.75rem; justify-content: flex-end; flex-wrap: wrap; }
</style>
