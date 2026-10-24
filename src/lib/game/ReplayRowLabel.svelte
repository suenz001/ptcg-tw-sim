<script lang="ts">
  // ⭐v6.600 復盤清單每一筆的標題：勝敗標籤＋雙方名字＋「我：牌組 vs 對手：牌組」（玩家建議，站長 2026-10-24 裁定）。
  //   ・判準與字樣只在 replay-label.ts（唯一來源）；舊的復盤沒有牌組資訊 ⇒ 不多一行，勝敗推不出來就不標。
  //   ・獨立元件、自己的樣式：對戰頁 CSS 很大且有多支位元組守衛，放在這裡不影響它們。
  import { replayResultOf, replayResultLabel, replayDeckLine } from './replay-label';
  // ⚠ props 不給預設值（Svelte 執行期會為預設值多拆一個 chunk）
  let { meta } = $props<{ meta: unknown }>();
  const m = $derived((meta ?? null) as Parameters<typeof replayResultOf>[0]);
  const res = $derived(replayResultOf(m));
  const label = $derived(replayResultLabel(m));
  const decks = $derived(replayDeckLine(m));
  const nm = (v: unknown) => (typeof v === 'string' && v ? v : '?');
</script>

<div class="rr-names">{#if res && label}<span class="rr-res rr-{res}">{label}</span>{/if}<b>{nm(m?.p1name)}</b> vs <b>{nm(m?.p2name)}</b></div>
{#if decks}<div class="rr-decks">🃏 {decks}</div>{/if}

<style>
  .rr-names { overflow-wrap: anywhere; }
  .rr-res {
    display: inline-block; margin-right: 0.4rem; padding: 0 0.45rem; border-radius: 999px;
    font-size: 0.78rem; font-weight: 700; line-height: 1.5; vertical-align: 1px; color: #fff;
  }
  /* 白字對底色的對比都 ≥ 4.5（淺色、深色主題同一組，不必分主題） */
  .rr-win { background: #1d6b35; }
  .rr-loss { background: #9b2c2c; }
  .rr-draw { background: #5a5a5a; }
  .rr-decks { margin-top: 0.15rem; font-size: 0.82rem; overflow-wrap: anywhere; line-height: 1.4; }
</style>
