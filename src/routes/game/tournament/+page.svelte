<script lang="ts">
  // 錦標賽對戰（伺服器權威測試）— 隱藏路由 /game/tournament，首頁不放入口。
  // 運算全由 Oracle 伺服器(server_admin_patch.js)的引擎處理；本頁只送動作 + 渲染伺服器盤面。
  // ⚠ 錦標賽 API 僅正式站 www.ptcg-tw-sim.com 提供（beta github.io 無此 API）。
  import { onMount, onDestroy } from 'svelte';
  import { loadAllSets, buildCardIndex } from '$lib/cards/pool';
  import type { Card } from '$lib/cards/types';

  const API = '/api/tournament';
  const ROOM = 'TOURNAMENT-TEST';

  let phase = $state<'lobby' | 'connecting' | 'playing' | 'error'>('lobby');
  let errorMsg = $state('');
  let pool = $state<Map<string, Card>>(new Map());
  let mySeat = $state<number | null>(null);
  let game = $state<any>(null);
  let version = $state(-1);
  let busy = $state(false);
  let pollTimer: any = null;

  function playerId(): string {
    let id = localStorage.getItem('ptcg_tourn_pid');
    if (!id) { id = 'p_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('ptcg_tourn_pid', id); }
    return id;
  }

  onMount(async () => {
    try { pool = buildCardIndex(await loadAllSets()); } catch { /* 名稱 fallback 用 id */ }
  });
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });

  async function api(path: string, body?: any) {
    const res = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async function join() {
    phase = 'connecting'; errorMsg = '';
    try {
      const r = await api('/join', { room: ROOM, playerId: playerId() });
      mySeat = r.seat; game = r.gameState; version = r.version;
      phase = 'playing';
      startPolling();
    } catch (e: any) {
      errorMsg = '連線失敗：' + e.message + '\n（伺服器權威錦標賽目前僅正式站 www.ptcg-tw-sim.com 提供 API）';
      phase = 'error';
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const r = await api(`/state?room=${ROOM}&v=${version}`);
        if (r && typeof r.version === 'number' && r.version > version) { game = r.gameState; version = r.version; }
      } catch { /* 忽略單次輪詢失敗 */ }
    }, 1200);
  }

  async function act(action: any) {
    if (busy) return; busy = true; errorMsg = '';
    try {
      const r = await api('/action', { room: ROOM, playerId: playerId(), action });
      if (r.error) errorMsg = '伺服器拒絕：' + r.error;
      if (r.gameState) { game = r.gameState; version = r.version; }
    } catch (e: any) { errorMsg = e.message; }
    finally { busy = false; }
  }

  async function resetRoom() {
    if (!confirm('重置測試房？會開新的一局。')) return;
    busy = true; errorMsg = '';
    try { const r = await api('/reset', { room: ROOM, playerId: playerId() }); mySeat = r.seat; game = r.gameState; version = r.version; }
    catch (e: any) { errorMsg = e.message; } finally { busy = false; }
  }

  function cName(cid: any): string { return pool.get(String(cid))?.name ?? String(cid); }
  function cHp(inst: any): number { const c = pool.get(String(inst?.cardId)); return c?.hp ? parseInt(String(c.hp), 10) : 0; }
  let me = $derived(game && mySeat != null ? game.players[mySeat] : null);
  let opp = $derived(game && mySeat != null ? game.players[1 - mySeat] : null);
  let myTurn = $derived(!!game && mySeat != null && game.activePlayerIndex === mySeat && game.phase === 'playing');
  function attacksOf(inst: any): any[] { return (pool.get(String(inst?.cardId))?.attacks ?? []) as any[]; }
  function firstBasicEnergy(): any | null {
    if (!me) return null;
    for (const c of me.hand) { const card = pool.get(String(c.cardId)); if (card?.supertype === 'Energy' && card?.subtype === 'Basic') return c; }
    return null;
  }
</script>

<svelte:head><title>錦標賽對戰（伺服器權威測試）</title></svelte:head>

<div class="tourn">
  {#if phase === 'lobby'}
    <h1>🏆 錦標賽對戰</h1>
    <p class="sub">伺服器權威測試房（運算由伺服器處理）</p>
    <button class="big" onclick={join}>進入固定測試房</button>
    <p class="note">兩個人各自點進來，就會配到同一房對戰。<br>⚠ 此功能的運算需要正式站的伺服器，beta 站無法連線。</p>
  {:else if phase === 'connecting'}
    <p>連線中…</p>
  {:else if phase === 'error'}
    <p class="err">{errorMsg}</p>
    <button onclick={() => (phase = 'lobby')}>返回</button>
  {:else if phase === 'playing' && game}
    <div class="bar">
      <span>我是 P{(mySeat ?? 0) + 1}</span>
      <span class="turn" class:active={myTurn}>{game.phase === 'game-over' ? '🏁 對戰結束' : myTurn ? '👉 你的回合' : '⏳ 對手回合'}</span>
      <span>回合 {game.turn ?? '-'}</span>
      <button class="mini" onclick={resetRoom} disabled={busy}>重置房</button>
    </div>

    {#if game.winner != null}
      <p class="win">勝者：P{game.winner + 1}{game.winner === mySeat ? '（你贏了！）' : ''} — {game.winReason ?? ''}</p>
    {/if}

    <div class="side opp">
      <h3>對手 P{(mySeat === 0 ? 1 : 0) + 1}</h3>
      <p>戰鬥場：<b>{opp?.active ? cName(opp.active.cardId) : '（無）'}</b>
        {#if opp?.active}（傷害 {opp.active.damage ?? 0} / HP {cHp(opp.active)}）{/if}</p>
      <p>備戰 {opp?.bench?.length ?? 0} ｜ 手牌 {opp?.hand?.length ?? 0} ｜ 牌庫 {opp?.deck?.length ?? 0} ｜ 獎賞 {opp?.prizes?.length ?? 0}</p>
    </div>

    <div class="side me">
      <h3>我方 P{(mySeat ?? 0) + 1}</h3>
      <p>戰鬥場：<b>{me?.active ? cName(me.active.cardId) : '（無）'}</b>
        {#if me?.active}（傷害 {me.active.damage ?? 0} / HP {cHp(me.active)} ｜ 能量 {me.active.energyAttached?.length ?? 0}）{/if}</p>
      <p>備戰 {me?.bench?.length ?? 0} ｜ 牌庫 {me?.deck?.length ?? 0} ｜ 獎賞 {me?.prizes?.length ?? 0}</p>

      {#if myTurn}
        <div class="actions">
          {#if me?.active}
            {#if firstBasicEnergy()}
              <button onclick={() => act({ type: 'ATTACH_ENERGY', energyIid: firstBasicEnergy().iid, targetIid: me.active.iid })} disabled={busy}>附 1 張基本能量到戰鬥場</button>
            {/if}
            {#each attacksOf(me.active) as atk, i}
              <button onclick={() => act({ type: 'ATTACK', attackIndex: i })} disabled={busy}>攻擊：{atk.name}{atk.damage ? `（${atk.damage}）` : ''}</button>
            {/each}
          {/if}
          <button class="end" onclick={() => act({ type: 'END_TURN' })} disabled={busy}>結束回合</button>
        </div>
      {/if}

      <details class="hand">
        <summary>我的手牌（{me?.hand?.length ?? 0}）</summary>
        <ul>{#each me?.hand ?? [] as c}<li>{cName(c.cardId)}</li>{/each}</ul>
      </details>
    </div>

    {#if errorMsg}<p class="err">{errorMsg}</p>{/if}

    <details class="log">
      <summary>對戰記錄</summary>
      <ul>{#each (game.log ?? []).slice(-12) as l}<li>{typeof l === 'string' ? l : (l?.text ?? l?.message ?? '')}</li>{/each}</ul>
    </details>
  {/if}
</div>

<style>
  .tourn { max-width: 640px; margin: 0 auto; padding: 16px; font-family: system-ui, sans-serif; }
  h1 { font-size: 1.6rem; }
  .sub { color: #666; }
  .big { font-size: 1.2rem; padding: 12px 28px; background: #b8860b; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
  .note { color: #888; font-size: 0.85rem; margin-top: 16px; }
  .bar { display: flex; gap: 12px; align-items: center; justify-content: space-between; background: #f4f4f4; padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; }
  .turn { font-weight: bold; }
  .turn.active { color: #1a7f37; }
  .mini { font-size: 0.75rem; padding: 2px 8px; }
  .side { border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
  .side.opp { background: #fff5f5; }
  .side.me { background: #f5f9ff; }
  .side h3 { margin: 0 0 6px; font-size: 1rem; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
  .actions button { padding: 8px 14px; border: 1px solid #b8860b; background: #fffbe6; border-radius: 6px; cursor: pointer; }
  .actions .end { border-color: #888; background: #eee; }
  .hand, .log { margin-top: 8px; font-size: 0.85rem; }
  .win { background: #e6ffed; padding: 8px 12px; border-radius: 8px; font-weight: bold; }
  .err { color: #c00; white-space: pre-wrap; }
</style>
