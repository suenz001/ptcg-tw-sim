<script lang="ts">
  // ⭐ v6.617「出自於卡包」卡片（玩家建議：卡牌資料的出處加上卡包封面，並能直接連到該卡包）
  //   卡牌資料庫的卡片視窗（/cards）與單卡頁（/card/[id]）共用這一個元件（Rule 38：只有一份）。
  //   ・有 href ⇒ 整張卡片是連結（點了到該卡包的卡牌列表）；沒有 href（正在看的就是這個卡包）⇒ 只顯示、標「目前瀏覽中」。
  //     ⚠ 卡片視窗的 .modalInner 會 stopPropagation，SvelteKit 的連結攔截收不到 ⇒ 實際是整頁導航（同既有的「📄 單卡頁」連結），
  //       視窗自然不在了，所以這裡不需要也不提供「點了先關視窗」的 callback（審查 P2-2）。
  //   ・封面與卡包列表的磚同一張圖、同一種裁切（aspect-ratio 0.71、object-fit: cover），玩家在店裡比對外盒最直覺。
  //   ・顏色只讀 layout 的 --ui-* 色票（附淺色後備值）⇒ 淺色／深色、手機／網頁版都跟著頁面主題走。
  import { coverUrl, type SetLite } from '$lib/cards/cover-url';   // 封面網址與型別只有一份（Rule 38）
  import { retryImg } from '$lib/img-retry';   // 封面有的是官網卡圖（MT*／SVI／M-P）⇒ 載入失敗要能重試／換代理（test-v6101）

  let { set, href = null }: { set: SetLite; href?: string | null } = $props();
  // 封面可能是官網卡圖 ⇒ 掛 use:retryImg（test-v6101 會掃這個檔；不直接寫 src={coverUrl(…)}，那是卡包列表站內封面的豁免字樣）
  const cover = $derived(coverUrl(set.coverImageUrl));
  // 每一段各自不換行（日期不會被拆成「2024-08-」＋「22」），段與段之間才換行
  const meta = $derived([set.code, set.releaseDate ? `發售 ${set.releaseDate}` : '', set.cardCount ? `${set.cardCount} 張` : ''].filter(Boolean));
</script>

{#snippet inner()}
  {#if set.coverImageUrl}<img class="ssc-cover" src={cover} use:retryImg={cover} alt="" loading="lazy" />{/if}
  <span class="ssc-text">
    <span class="ssc-label">出自於卡包{#if !href}<span class="ssc-here">目前瀏覽中</span>{/if}</span>
    <span class="ssc-name">{set.name}</span>
    <span class="ssc-meta">{#each meta as m, i}{#if i > 0}{' '}{/if}<span class="ssc-seg">{i > 0 ? '· ' : ''}{m}</span>{/each}</span>
  </span>
  {#if href}
    <span class="ssc-go" aria-hidden="true">查看卡包<span class="ssc-arrow">›</span></span>
  {/if}
{/snippet}

{#if href}
  <a class="ssc" {href} aria-label={`出自於卡包「${set.name}」，查看此卡包全部卡牌`}>{@render inner()}</a>
{:else}
  <div class="ssc ssc-static">{@render inner()}</div>
{/if}

<style>
  .ssc {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 10px 0 0;
    padding: 10px 12px;
    border: 1px solid var(--ui-border, #e3e6ea);
    border-radius: 12px;
    background: var(--ui-bg-sunken, #f7f8fa);
    color: var(--ui-text, #1d1d1f);
    text-decoration: none;
    min-height: 44px;            /* 手機可點範圍 */
    -webkit-tap-highlight-color: transparent;
  }
  a.ssc { cursor: pointer; transition: border-color 0.12s, box-shadow 0.12s, transform 0.08s; }
  a.ssc:hover { border-color: var(--ui-accent, #2e9d6a); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.10); }
  a.ssc:active { transform: translateY(1px); }
  .ssc-cover {
    flex: 0 0 auto;
    width: 56px;
    aspect-ratio: 0.71;
    object-fit: cover;
    border-radius: 6px;
    background: #e9ecef;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  }
  .ssc-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ssc-label { font-size: 12px; color: var(--ui-text-muted, #6b7280); }
  .ssc-name {
    font-size: 16px; font-weight: 700; line-height: 1.3; color: var(--ui-text, #1d1d1f);
    overflow-wrap: anywhere;      /* 長卡包名完整顯示、可換行，不截斷 */
  }
  .ssc-meta { font-size: 12px; color: var(--ui-text-muted, #6b7280); font-variant-numeric: tabular-nums; }
  .ssc-seg { white-space: nowrap; }
  .ssc-go {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 2px;
    font-size: 13px; font-weight: 700; color: var(--ui-link, #2563eb); white-space: nowrap;
  }
  .ssc-arrow { font-size: 20px; line-height: 1; margin-left: 2px; }
  /* 正在看的就是這個卡包：標在「出自於卡包」旁邊（不佔右側寬度，卡包名與日期才不會被擠到換行） */
  .ssc-here {
    display: inline-block; margin-left: 6px; font-size: 11px; color: var(--ui-text-muted, #6b7280); white-space: nowrap;
    border: 1px solid var(--ui-border, #e3e6ea); border-radius: 999px; padding: 0 7px; vertical-align: 1px;
  }
  /* 窄螢幕：箭頭文字縮成只剩「›」，把寬度讓給卡包名 */
  @media (max-width: 420px) { .ssc-go { font-size: 0; } .ssc-arrow { font-size: 22px; } .ssc-cover { width: 50px; } }
</style>
