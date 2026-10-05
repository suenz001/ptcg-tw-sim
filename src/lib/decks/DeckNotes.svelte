<script lang="ts">
  // ⭐v6.486 牌組「備註」欄（站長同意的建議 #4）。
  //   牌組資料本來就有 notes 欄位（匯入 JSON、複製預組都會帶著走、雲端同步整份上傳），只是編輯器沒有地方寫。
  //   ・用來記換牌想法、對局筆記；投稿到牌組公布欄時會自動帶入（公布欄說明欄上限 200 字，超過會截斷）。
  //   ・預設收合（<details>），有內容時自動展開；內建預組唯讀。
  //   ・獨立元件、自己的樣式：牌組編輯器桌機 CSS 有逐字指紋守衛（test-v6213），放在這裡不影響它。
  import { untrack } from 'svelte';
  // ⚠ props 不給預設值（Svelte 執行期會為預設值多拆一個 chunk）
  let { value, readonly, onchange } = $props<{ value: string; readonly: boolean; onchange: (v: string) => void }>();
  const DECK_NOTES_MAX = 1000;
  const len = $derived((value ?? '').length);
  // 只在打開這副牌時決定要不要展開（打字刪光時不會突然收起來）；換牌組時父層用 {#key} 重建這個元件
  const startOpen = untrack(() => !!(value && value.length));
</script>

<details class="dn" open={startOpen}>
  <summary class="dn-sum">📝 備註{#if len > 0}<span class="dn-len">（{len} 字）</span>{/if}</summary>
  <textarea
    class="dn-text"
    rows="3"
    maxlength={DECK_NOTES_MAX}
    placeholder={readonly ? '（內建預組沒有備註）' : '換牌想法、對局筆記…（投稿到牌組公布欄時會自動帶入）'}
    value={value ?? ''}
    {readonly}
    oninput={(e) => onchange((e.target as HTMLTextAreaElement).value)}
  ></textarea>
</details>

<style>
  .dn { margin: 0.35rem 0 0.5rem; }
  .dn-sum { cursor: pointer; font-size: 0.85rem; color: var(--ui-text-muted, #666); user-select: none; }
  .dn-len { margin-left: 0.2rem; }
  .dn-text {
    display: block; width: 100%; box-sizing: border-box; margin-top: 0.35rem; padding: 0.5rem 0.6rem;
    min-height: 4.5rem; resize: vertical; border-radius: 8px; font: inherit; font-size: 0.9rem; line-height: 1.5;
    border: 1px solid var(--ui-border, #ddd); background: var(--ui-input-bg, #fff); color: var(--ui-text, #222);
  }
  .dn-text:focus { outline: 2px solid var(--ui-accent, #3dbb7a); outline-offset: 1px; }
  .dn-text[readonly] { opacity: 0.7; }
  @media (max-width: 600px) { .dn-text { font-size: 16px; } }   /* iOS < 16px 聚焦會放大整個畫面 */
</style>
