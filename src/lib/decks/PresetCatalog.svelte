<script lang="ts">
  import { onMount } from 'svelte';
  import type { Deck } from './types';
  import { PRESET_DECKS } from './presets';
  import { parsePresetCatalog } from './preset-catalog-shape';
  let { onupdate }: { onupdate: (decks: Deck[]) => void } = $props();
  let message = $state('');
  let busy = $state(false);
  let hasSnapshot = false;
  let currentIds: string[] = [];
  let removed = $state(false);
  function adopt(items: Deck[]) {
    const ids = items.map(d => d.id);
    if (currentIds.some(id => !ids.includes(id))) removed = true;
    currentIds = ids; onupdate(items);
  }
  const apiRoot = (import.meta.env.VITE_ORACLE_API_URL || '').replace(/\/$/, '');
  const key = 'ptcg:managed-presets:v1:' + apiRoot;
  let lastAt = 0;
  async function refresh() {
    if (!apiRoot || busy) return;
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const r = await fetch(apiRoot + '/api/preset-decks', { signal: controller.signal });
      if (!r.ok) throw new Error('讀取失敗');
      const data = parsePresetCatalog(await r.json());
      if (!data) throw new Error('目錄格式錯誤');
      adopt(data.decks); message = ''; hasSnapshot = true;
      try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* 儲存空間不足仍可使用 */ }
    } catch { message = hasSnapshot ? '預設牌組更新失敗，正顯示可能過期的清單。' : '無法載入預設牌組，請重新載入。'; }
    finally { clearTimeout(timeout); busy = false; lastAt = Date.now(); }
  }
  onMount(() => {
    if (!apiRoot) { onupdate(PRESET_DECKS); return; }
    try {
      const data = parsePresetCatalog(JSON.parse(localStorage.getItem(key) || 'null'));
      if (data) { adopt(data.decks); hasSnapshot = true; message = '正在更新預設牌組，暫時顯示先前清單…'; }
    } catch { /* 沒有快照，等待伺服器 */ }
    if (!hasSnapshot) message = '正在載入預設牌組…';
    void refresh();
    const wake = () => { if (document.visibilityState === 'visible' && Date.now() - lastAt > 60000) void refresh(); };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  });
</script>
{#if removed}<p role="status">預設牌組清單已更新；若已選牌組被下架，請重新選擇。進行中的對戰與已報名牌表仍保留。</p>{/if}
{#if message}<p role="status">{message} <button onclick={refresh} disabled={busy}>重新載入預組</button></p>{/if}
