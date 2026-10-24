<script lang="ts">
  // ⭐v6.599 牌組「先後攻偏好」選單（玩家建議，站長 2026-10-24 裁定）。
  //   ・選這副牌組對戰（本機／AI、線上房間）或報名錦標賽時自動帶入，玩家仍可在那裡手動改。
  //   ・「不設定」＝牌組不帶任何值 ⇒ 入口維持原本的選擇（舊牌組行為完全不變）。
  //   ・判準與選項只在 coin-pref.ts（唯一來源）。
  //   ・獨立元件、自己的樣式：牌組編輯器桌機 CSS 有逐字指紋守衛（test-v6213），放在這裡不影響它（比照 DeckNotes）。
  import { DECK_COIN_PREF_OPTIONS, normalizeDeckCoinPref } from './coin-pref';
  // ⚠ props 不給預設值（Svelte 執行期會為預設值多拆一個 chunk）
  let { value, onchange } = $props<{ value: unknown; onchange: (v: string) => void }>();
  const cur = $derived(normalizeDeckCoinPref(value) ?? '');
</script>

<label class="dcp">
  <span class="dcp-label">🪙 贏得擲硬幣時</span>
  <select class="dcp-select" aria-label="先後攻偏好" value={cur}
    onchange={(e) => onchange((e.target as HTMLSelectElement).value)}>
    {#each DECK_COIN_PREF_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
  </select>
  <span class="dcp-hint">選這副牌組對戰或報名錦標賽時自動帶入</span>
</label>

<style>
  .dcp { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.6rem; margin: 0.35rem 0 0.5rem; font-size: 0.85rem; color: var(--ui-text-muted, #666); }
  .dcp-label { white-space: nowrap; }
  .dcp-select {
    padding: 0.3rem 0.5rem; border-radius: 8px; font: inherit; font-size: 0.85rem; max-width: 100%;
    border: 1px solid var(--ui-border, #ddd); background: var(--ui-input-bg, #fff); color: var(--ui-text, #222);
  }
  .dcp-select:focus { outline: 2px solid var(--ui-accent, #3dbb7a); outline-offset: 1px; }
  .dcp-hint { font-size: 0.78rem; opacity: 0.85; min-width: 0; overflow-wrap: anywhere; }
  /* 手機：觸控目標 ≥44px、iOS < 16px 聚焦會放大整個畫面 */
  @media (max-width: 600px) {
    .dcp-select { font-size: 16px; min-height: 44px; flex: 1 1 10rem; }
    .dcp-hint { flex-basis: 100%; }
  }
</style>
