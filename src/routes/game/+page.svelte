<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import type { Card } from '$lib/cards/types';
  import { loadAllSets, buildCardIndex } from '$lib/cards/pool';
  import { loadDecks } from '$lib/decks/storage';
  import type { Deck } from '$lib/decks/types';
  import { createGame, applyAction, getAvailableAttacks, hasPendingActions, countEnergy } from '$lib/game/engine';
  import { GameActions } from '$lib/game/actions';
  import type { GameState, CardInstance } from '$lib/game/types';
  import { ENERGY_LABEL, ENERGY_COLOR } from '$lib/cards/energy';
  import type { EnergyType } from '$lib/cards/types';

  // ── 資料載入 ────────────────────────────────────────────────────────────────
  let pool = $state<Map<string, Card>>(new Map());
  let poolReady = $state(false);
  let decks = $state<Deck[]>([]);

  // ── 遊戲狀態 ────────────────────────────────────────────────────────────────
  let game = $state<GameState | null>(null);

  // ── 選牌組畫面 ──────────────────────────────────────────────────────────────
  let p1DeckId = $state('');
  let p2DeckId = $state('');
  let p1Name = $state('玩家 1');
  let p2Name = $state('玩家 2');

  // ── UI 互動狀態 ─────────────────────────────────────────────────────────────
  let selectedEnergyIid = $state<string | null>(null); // 手牌中選取的能量
  let previewCard = $state<Card | null>(null);          // hover/click 預覽卡片

  // ── Derived ────────────────────────────────────────────────────────────────
  const aIdx = $derived(game?.activePlayerIndex ?? 0);
  const dIdx = $derived((1 - aIdx) as 0 | 1);
  const activePlayer = $derived(game ? game.players[aIdx] : null);
  const defenderPlayer = $derived(game ? game.players[dIdx] : null);
  const availableAttacks = $derived(game && poolReady ? getAvailableAttacks(game, pool) : []);
  const pendingPrizes = $derived(game?.pendingPrizes ?? 0);
  const canEndTurn = $derived(
    game?.phase === 'playing' &&
    game.turnPhase === 'end' &&
    !hasPendingActions(game)
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

  function cardName(instance: CardInstance): string {
    return pool.get(instance.cardId)?.name ?? instance.cardId;
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

  function deckToEntries(deck: Deck) {
    return deck.entries;
  }

  // ── 遊戲動作 ─────────────────────────────────────────────────────────────────
  function dispatch(action: ReturnType<typeof GameActions[keyof typeof GameActions]>) {
    if (!game || !poolReady) return;
    game = applyAction(game, action as any, pool);
  }

  function startGame() {
    if (!p1DeckId || !p2DeckId) return;
    const d1 = decks.find((d) => d.id === p1DeckId);
    const d2 = decks.find((d) => d.id === p2DeckId);
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
    selectedEnergyIid = null;
  }

  // ── HP 進度條顏色 ─────────────────────────────────────────────────────────
  function hpColor(remaining: number, total: number): string {
    const pct = total > 0 ? remaining / total : 1;
    if (pct > 0.5) return '#2c7a3c';
    if (pct > 0.25) return '#e0a020';
    return '#c00';
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
    {:else if decks.length < 2}
      <p class="warn">⚠️ 請先在牌組編輯器建立至少 2 套牌組。</p>
      <a href="{base}/decks" class="btn-primary">前往牌組編輯器</a>
    {:else}
      <div class="player-setup">
        <!-- P1 -->
        <div class="setup-card">
          <h2>玩家 1（先手）</h2>
          <input class="name-input" placeholder="玩家名稱" bind:value={p1Name} />
          <select bind:value={p1DeckId}>
            <option value="">— 選擇牌組 —</option>
            {#each decks as d}
              <option value={d.id}>{d.name}（{d.entries.reduce((n,e)=>n+e.count,0)} 張）</option>
            {/each}
          </select>
        </div>

        <div class="vs-badge">VS</div>

        <!-- P2 -->
        <div class="setup-card">
          <h2>玩家 2（後手）</h2>
          <input class="name-input" placeholder="玩家名稱" bind:value={p2Name} />
          <select bind:value={p2DeckId}>
            <option value="">— 選擇牌組 —</option>
            {#each decks as d}
              <option value={d.id}>{d.name}（{d.entries.reduce((n,e)=>n+e.count,0)} 張）</option>
            {/each}
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
<!--  Setup 畫面（選出場寶可夢）                                             -->
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
                <button class="small primary" onclick={() => dispatch(GameActions.placeActive(inst.iid))}>
                  出場
                </button>
              {:else if setupPlayer.bench.length < 5}
                <button class="small" onclick={() => dispatch(GameActions.benchPokemon(inst.iid))}>
                  備戰
                </button>
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
        {#if game.isFirstTurn && aIdx === 0}　<span class="hint">（先手第1回合不能攻擊）</span>{/if}
      </span>
      <span class="phase-tag">
        {game.turnPhase === 'draw' ? '📥 抽牌' : game.turnPhase === 'main' ? '🎮 主階段' : '⏭ 回合結束'}
      </span>
    </header>

    <div class="battle-layout">

      <!-- 左側：對手場地 -->
      <section class="field opponent-field">
        <h3>{defenderPlayer?.name}的場地</h3>

        <!-- 對手出場 -->
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

        <!-- 對手備戰 -->
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

        <!-- 對手資訊列 -->
        <div class="field-info">
          <span>📦 牌組 {defenderPlayer?.deck.length}</span>
          <span>🗑 墓地 {defenderPlayer?.discard.length}</span>
          <span>🏆 獎勵 {defenderPlayer?.prizes.length}</span>
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
            ⚠️ {defenderPlayer?.name} 的出場寶可夢被擊倒，需要送出新的寶可夢。
            <br>（請將裝置交給 {defenderPlayer?.name}）
            <div class="bench-pick-row">
              {#each defenderPlayer?.bench ?? [] as b}
                {@const bc = getCard(b.cardId)}
                <button class="bench-pick-btn" onclick={() => {
                  // 切換 activePlayerIndex 到防守方，讓他們送出新的寶可夢
                  if (game) {
                    game = { ...game, activePlayerIndex: dIdx };
                    dispatch(GameActions.sendNewActive(b.iid));
                    game = { ...game, activePlayerIndex: aIdx };
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
                  disabled={!availableAttacks.includes(i)}
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

            <button class="btn-secondary" onclick={() => { if(game) game = {...game, turnPhase:'end'}; }}>
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
        <div class="zone-label">出場</div>
        {#if activePlayer?.active}
          {@const ac = getCard(activePlayer.active.cardId)}
          <div class="pokemon-slot mine"
            class:energy-target={selectedEnergyIid !== null}
            onclick={() => selectedEnergyIid && onAttachEnergy(activePlayer!.active!.iid)}>
            <img src={ac?.imageUrl} alt={ac?.name} />
            <div class="poke-info">
              <div class="poke-name">{ac?.name}</div>
              <div class="hp-bar-wrap">
                <div class="hp-bar" style="width:{ac?.hp ? hpRemaining(activePlayer.active)/ac.hp*100 : 0}%;background:{hpColor(hpRemaining(activePlayer.active), ac?.hp ?? 0)}"></div>
              </div>
              <div class="hp-text">HP {hpRemaining(activePlayer.active)} / {ac?.hp}</div>
              <div class="energy-text">⚡ {energySummary(activePlayer.active)}</div>
            </div>
            {#if selectedEnergyIid}
              <div class="attach-hint">點此附加</div>
            {/if}
          </div>
        {:else}
          <div class="pokemon-slot empty">（無出場寶可夢）</div>
        {/if}

        <!-- 備戰區 -->
        <div class="zone-label">備戰（{activePlayer?.bench.length ?? 0}/5）</div>
        <div class="bench-row">
          {#each activePlayer?.bench ?? [] as b}
            {@const bc = getCard(b.cardId)}
            <div class="bench-slot"
              class:energy-target={selectedEnergyIid !== null}
              onclick={() => selectedEnergyIid && onAttachEnergy(b.iid)}>
              <img src={bc?.imageUrl} alt={bc?.name} />
              <div class="bench-name">{bc?.name}</div>
              <div class="bench-hp">HP {hpRemaining(b)}/{bc?.hp}</div>
              <div class="bench-energy">⚡ {energySummary(b)}</div>
              {#if selectedEnergyIid}
                <div class="attach-hint">點此附加</div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- 資訊列 -->
        <div class="field-info">
          <span>📦 牌組 {activePlayer?.deck.length}</span>
          <span>🗑 墓地 {activePlayer?.discard.length}</span>
          <span>🏆 獎勵 {activePlayer?.prizes.length}</span>
          {#if activePlayer?.energyAttachedThisTurn}
            <span class="used">✅ 能量已附加</span>
          {/if}
        </div>

        <!-- 手牌 -->
        <div class="zone-label">手牌（{activePlayer?.hand.length ?? 0}張）</div>
        <div class="hand-scroll">
          {#each activePlayer?.hand ?? [] as inst}
            {@const c = getCard(inst.cardId)}
            {#if c}
              <div class="hand-card-mini"
                class:selected={selectedEnergyIid === inst.iid}
                class:is-energy={c.supertype === 'Energy'}
                onclick={() => {
                  if (c.supertype === 'Energy' && game?.turnPhase === 'main' && !activePlayer?.energyAttachedThisTurn) {
                    selectedEnergyIid = selectedEnergyIid === inst.iid ? null : inst.iid;
                  }
                }}
                title={c.name}
              >
                <img src={c.imageUrl} alt={c.name} />
                <span class="hand-name">{c.name}</span>
                {#if c.supertype === 'Energy' && game?.turnPhase === 'main' && !activePlayer?.energyAttachedThisTurn}
                  <span class="attach-hint-mini">選取</span>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </section>

    </div><!-- /.battle-layout -->
  </div><!-- /.battle-root -->
{/if}

<style>
  :global(body) { margin: 0; background: #1a2a1a; }

  /* ── Lobby / Setup ── */
  .lobby, .setup-screen {
    max-width: 700px;
    margin: 2rem auto;
    padding: 1.5rem;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
    color: #f0f0f0;
  }
  .lobby h1 { font-size: 1.8rem; margin-bottom: 1rem; }
  .back { color: #88ccff; font-size: 0.9rem; text-decoration: none; display: inline-block; margin-bottom: 1rem; }
  .back:hover { text-decoration: underline; }
  .muted { color: #aaa; font-size: 0.9rem; }
  .warn { color: #f0b040; }
  .player-setup {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: center;
    margin: 1.5rem 0;
  }
  .setup-card {
    background: #2a3a2a;
    border: 1px solid #3a5a3a;
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .setup-card h2 { margin: 0; font-size: 1rem; color: #aaffaa; }
  .name-input, .setup-card select {
    padding: 0.45rem 0.6rem;
    border: 1px solid #4a6a4a;
    border-radius: 6px;
    background: #1a2a1a;
    color: #f0f0f0;
    font: inherit;
  }
  .vs-badge {
    font-size: 1.5rem;
    font-weight: 700;
    color: #f0b040;
    text-align: center;
  }
  .btn-primary {
    display: inline-block;
    background: #2a7a2a;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 0.6rem 1.4rem;
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    margin-top: 0.5rem;
  }
  .btn-primary:hover:not(:disabled) { background: #3a9a3a; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary.sm { font-size: 0.85rem; padding: 0.35rem 0.8rem; }
  .btn-secondary {
    display: inline-block;
    background: #2a3a5a;
    color: #ccddff;
    border: 1px solid #4a5a8a;
    border-radius: 8px;
    padding: 0.5rem 1.2rem;
    font: inherit;
    cursor: pointer;
    text-decoration: none;
  }
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
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 0.5rem;
    margin: 0.5rem 0 1rem;
  }
  .hand-card {
    background: #2a3a2a;
    border: 1px solid #3a5a3a;
    border-radius: 6px;
    padding: 0.4rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: #ddd;
  }
  .hand-card img { width: 70px; border-radius: 4px; }
  .hand-card-name { text-align: center; font-size: 0.72rem; }
  .hand-card.selectable { border-color: #6aaa6a; cursor: pointer; }
  .card-type-tag { font-size: 0.65rem; color: #888; }
  .small { padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid #5a5a5a; background: #2a2a2a; color: #ddd; cursor: pointer; font: inherit; font-size: 0.78rem; }
  .small.danger { color: #f88; border-color: #a44; }
  .small.primary { background: #2a5a2a; color: #aef; border-color: #4a8a4a; }

  /* ── Battle root ── */
  .battle-root {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    font-family: system-ui, 'Microsoft JhengHei', sans-serif;
    color: #f0f0f0;
  }
  .battle-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    background: #0a1a0a;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #2a4a2a;
    flex-wrap: wrap;
  }
  .small-back { color: #88ccff; text-decoration: none; font-size: 0.85rem; }
  .turn-info { font-weight: 600; flex: 1; }
  .phase-tag { font-size: 0.85rem; color: #aaffaa; }
  .hint { color: #aaa; font-size: 0.8rem; }

  .battle-layout {
    display: grid;
    grid-template-columns: 1fr 260px 1fr;
    gap: 0.75rem;
    padding: 0.75rem;
    flex: 1;
  }

  /* ── Field ── */
  .field {
    background: #1e2e1e;
    border: 1px solid #2a4a2a;
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .field h3 { margin: 0; font-size: 0.95rem; color: #aaffaa; }
  .zone-label { font-size: 0.75rem; color: #888; margin-top: 0.25rem; }
  .pokemon-slot {
    border: 1px solid #3a5a3a;
    border-radius: 8px;
    padding: 0.5rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    background: #0e1e0e;
    cursor: default;
  }
  .pokemon-slot.energy-target { border-color: #aaff44; cursor: pointer; animation: pulse 1s infinite alternate; }
  .pokemon-slot.empty { color: #555; font-size: 0.85rem; justify-content: center; min-height: 60px; }
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
    background: #0e1e0e;
    border: 1px solid #2a4a2a;
    border-radius: 6px;
    padding: 0.3rem;
    text-align: center;
    font-size: 0.72rem;
    width: 64px;
    cursor: default;
  }
  .bench-slot.energy-target { border-color: #aaff44; cursor: pointer; }
  .bench-slot img { width: 54px; border-radius: 3px; }
  .bench-name { font-size: 0.65rem; color: #ccc; }
  .bench-hp { color: #aaa; font-size: 0.65rem; }
  .bench-energy { color: #888; font-size: 0.62rem; }
  .attach-hint-mini { display: block; font-size: 0.62rem; color: #aaff44; }
  .field-info { display: flex; gap: 0.6rem; font-size: 0.75rem; color: #888; flex-wrap: wrap; }
  .used { color: #8f8; }

  /* Hand */
  .hand-scroll { display: flex; gap: 0.3rem; overflow-x: auto; padding-bottom: 0.25rem; }
  .hand-card-mini {
    flex-shrink: 0;
    width: 56px;
    background: #0e1e0e;
    border: 1px solid #2a4a2a;
    border-radius: 5px;
    padding: 0.2rem;
    text-align: center;
    cursor: default;
    font-size: 0.62rem;
    color: #bbb;
  }
  .hand-card-mini.is-energy { border-color: #c0a020; cursor: pointer; }
  .hand-card-mini.selected { border-color: #aaff44; box-shadow: 0 0 6px #aaff44; }
  .hand-card-mini img { width: 52px; border-radius: 3px; }
  .hand-name { display: block; font-size: 0.6rem; margin-top: 0.15rem; }

  /* Action zone */
  .action-zone {
    background: #0a1a0a;
    border: 1px solid #2a4a2a;
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .alert-box {
    background: #2a4a1a;
    border: 1px solid #4a8a3a;
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
    font-size: 0.88rem;
  }
  .alert-box.warn { background: #3a2a0a; border-color: #8a6a2a; }
  .bench-pick-row { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .bench-pick-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #1a3a1a;
    border: 1px solid #4a8a4a;
    border-radius: 6px;
    padding: 0.3rem;
    cursor: pointer;
    color: #ddd;
    font-size: 0.75rem;
    gap: 0.2rem;
  }
  .bench-pick-btn img { width: 50px; border-radius: 3px; }
  .bench-pick-btn:hover { background: #2a5a2a; }
  .action-btns { display: flex; flex-direction: column; gap: 0.5rem; }
  .btn-attack {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #1a2a3a;
    border: 1px solid #3a5a7a;
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    color: #ccd;
    cursor: not-allowed;
    opacity: 0.5;
    font: inherit;
    font-size: 0.88rem;
    text-align: left;
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
    flex: 1;
    background: #050f05;
    border: 1px solid #1a3a1a;
    border-radius: 6px;
    padding: 0.5rem;
    overflow: hidden;
  }
  .log-title { font-size: 0.72rem; color: #555; margin-bottom: 0.3rem; }
  .log-entries { display: flex; flex-direction: column; gap: 0.2rem; max-height: 260px; overflow-y: auto; }
  .log-entry { font-size: 0.75rem; color: #99aa99; padding: 0.15rem 0; border-bottom: 1px solid #1a2a1a; }
  .log-entry.system { color: #aaffaa; font-weight: 600; }
</style>
