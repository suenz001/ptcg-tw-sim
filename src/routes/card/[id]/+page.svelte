<script lang="ts">
  import { base } from '$app/paths';
  import { retryImg } from '$lib/img-retry';
  import { ENERGY_LABEL } from '$lib/cards/energy';
  import type { EnergyType } from '$lib/cards/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const card = $derived(data.card);

  const SUPERTYPE_ZH: Record<string, string> = { Pokemon: '寶可夢', Trainer: '訓練家', Energy: '能量' };
  const STAGE_ZH: Record<string, string> = { Basic: '基礎', Stage1: '1階進化', Stage2: '2階進化' };
  const elabel = (e: EnergyType) => ENERGY_LABEL[e] ?? e;
  const energyList = (arr?: EnergyType[]) => (arr ?? []).map(elabel).join('、');

  const setLabel = $derived(`${card.setCode} ${card.collectorNumber}`);
  const h1 = $derived(`${card.name}（${setLabel}）`);
  const title = $derived(`${card.name} ${setLabel}｜PTCG 卡牌資料庫`);
  const pageUrl = $derived(`https://www.ptcg-tw-sim.com/card/${card.id}/`);  // canonical 永遠指正式站，不帶 base(github.io 的 /ptcg-tw-sim 不該接上)
  const description = $derived.by(() => {
    const p: string[] = [];
    if (card.species) p.push(card.species);
    if (card.hp) p.push(`HP ${card.hp}`);
    if (card.abilities?.length) p.push('特性：' + card.abilities.map((a) => a.name).join('、'));
    if (card.attacks?.length) p.push('招式：' + card.attacks.map((a) => a.name).join('、'));
    return `${card.name}（${SUPERTYPE_ZH[card.supertype] ?? ''}${card.regulationMark ? '，標準標記 ' + card.regulationMark : ''}）。${p.join('｜')}。Pokémon 集換式卡牌資料、招式效果與屬性 — PTCG 卡牌資料庫。`;
  });
  const jsonLdScript = $derived.by(() => {
    const j = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product',
      name: card.name, image: card.imageUrl, description,
      sku: String(card.id), category: SUPERTYPE_ZH[card.supertype] ?? card.supertype,
      brand: { '@type': 'Brand', name: 'Pokémon TCG' },
    });
    return `<script type="application/ld+json">${j}<\/script>`;
  });
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={pageUrl} />
  <meta name="robots" content="index,follow" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={card.imageUrl} />
  {@html jsonLdScript}
</svelte:head>

<main class="card-page">
  <nav class="crumb">
    <a href="{base}/">首頁</a> ／
    <a href="{base}/cards?set={card.setCode}">{card.setCode} 卡包</a> ／
    <span>{card.name}</span>
  </nav>

  <h1>{h1}</h1>

  <div class="body">
    <img use:retryImg={card.imageUrl} class="img" src={card.imageUrl} alt={card.name} loading="lazy" width="367" height="512" />
    <table class="info">
      <tbody>
        <tr><th>類別</th><td>{SUPERTYPE_ZH[card.supertype] ?? card.supertype}{card.subtype && card.subtype !== 'None' ? '／' + card.subtype : ''}</td></tr>
        {#if card.stage}<tr><th>階段</th><td>{STAGE_ZH[card.stage] ?? card.stage}</td></tr>{/if}
        {#if card.evolvesFrom}<tr><th>由此進化</th><td>{card.evolvesFrom}</td></tr>{/if}
        {#if card.hp}<tr><th>HP</th><td>{card.hp}</td></tr>{/if}
        {#if card.pokemonType}<tr><th>屬性</th><td>{elabel(card.pokemonType)}</td></tr>{/if}
        {#if card.weakness}<tr><th>弱點</th><td>{elabel(card.weakness.type)} {card.weakness.value}</td></tr>{/if}
        {#if card.resistance}<tr><th>抵抗力</th><td>{elabel(card.resistance.type)} {card.resistance.value}</td></tr>{/if}
        {#if card.retreatCost?.length}<tr><th>撤退費用</th><td>{card.retreatCost.length}（{energyList(card.retreatCost)}）</td></tr>{/if}
        {#if card.species}<tr><th>種族</th><td>{card.species}</td></tr>{/if}
        {#if card.pokedexNumber}<tr><th>圖鑑編號</th><td>No.{card.pokedexNumber}</td></tr>{/if}
        {#if card.illustrator}<tr><th>插畫家</th><td>{card.illustrator}</td></tr>{/if}
        {#if card.regulationMark}<tr><th>標準標記</th><td>{card.regulationMark}</td></tr>{/if}
        <tr><th>所屬版本</th><td>{card.setCode} ｜ 收集編號 {card.collectorNumber}</td></tr>
      </tbody>
    </table>
  </div>

  {#if card.abilities?.length}
    <section class="sec">
      <h2>特性</h2>
      {#each card.abilities as ab}
        <div class="block"><div class="block-name">{ab.label || '特性'}｜{ab.name}</div><p>{ab.effect}</p></div>
      {/each}
    </section>
  {/if}

  {#if card.attacks?.length}
    <section class="sec">
      <h2>招式</h2>
      {#each card.attacks as atk}
        <div class="block">
          <div class="block-name">
            <span class="cost">{atk.cost?.length ? energyList(atk.cost) : '無色'}</span>
            <span>{atk.name}</span>
            {#if atk.damage}<span class="dmg">{atk.damage}</span>{/if}
          </div>
          {#if atk.effect}<p>{atk.effect}</p>{/if}
        </div>
      {/each}
    </section>
  {/if}

  {#if card.rulesText}
    <section class="sec"><h2>卡片敘述</h2><p>{card.rulesText}</p></section>
  {/if}

  <nav class="links">
    <a href="{base}/cards?set={card.setCode}">← 在卡牌資料庫查看「{card.setCode}」全部卡牌</a>
    <a href="{base}/decks">前往牌組編輯器 →</a>
  </nav>
  <p class="foot">PTCG 卡牌資料庫 ｜ <a href="{base}/">ptcg-tw-sim</a> — 寶可夢集換式卡牌中文模擬器與卡牌查詢</p>
</main>

<style>
  .card-page { max-width: 760px; margin: 0 auto; padding: 16px 18px 48px; color: #1d1d1f; font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif; line-height: 1.6; }
  .crumb { font-size: 13px; color: #666; margin-bottom: 10px; }
  .crumb a { color: #c0392b; text-decoration: none; }
  h1 { font-size: 22px; margin: 4px 0 16px; }
  .body { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
  .img { width: 280px; max-width: 100%; height: auto; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
  .info { border-collapse: collapse; flex: 1; min-width: 260px; font-size: 14px; }
  .info th, .info td { border: 1px solid #e3e3e6; padding: 6px 10px; text-align: left; vertical-align: top; }
  .info th { background: #f6f6f8; white-space: nowrap; width: 92px; color: #555; font-weight: 600; }
  .sec { margin-top: 22px; }
  .sec h2 { font-size: 17px; border-left: 4px solid #c0392b; padding-left: 8px; margin-bottom: 10px; }
  .block { background: #f7f7f9; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
  .block-name { font-weight: 700; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .block p { margin: 6px 0 0; font-size: 14px; color: #333; }
  .cost { font-size: 12px; background: #eceaf3; border-radius: 4px; padding: 1px 6px; color: #555; }
  .dmg { margin-left: auto; font-weight: 800; color: #c0392b; }
  .links { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 26px; font-size: 14px; }
  .links a { color: #c0392b; text-decoration: none; }
  .foot { margin-top: 18px; font-size: 12px; color: #666; text-align: center; }   /* ⭐v6.468 #999 對比 2.6 太淡 */
  .foot a { color: #555; }

  /* ⭐v6.468（全站 audit）：「← 首頁」只有 16～21px 高，手機上很難點。用 padding＋等量負 margin 放大可點範圍，
     版面位置一點都不動（純文字連結、沒有底色或框線 ⇒ 桌機看起來也完全一樣）。
     ⚠ 刻意不包 @media：本頁的 @media 數量有守衛在釘（手機／桌機不靠斷點切版），而這條在桌機也無害。 */
  .crumb a { display: inline-block; padding: 10px 8px; margin: -10px -8px; }

  /* ══ v6.475 網頁版（≥1024px）：淺色／深色主題＋版面優化（站長：「除了首頁以外的選項應該也要可以優化」）══
     ・只在 min-width:1024px ⇒ 手機一個像素都不變；上方原本的樣式一個字都沒改（v6.468 守衛釘的 .crumb a 那條也在原位）。
     ・顏色讀 layout 的 --ui-* 色票；整頁底色由 layout 依 THEMED_ROUTES 掛 data-ui-themed。
     ・版面：760 → 1080 寬；卡圖放大到 340px、右側資料表變卡片，招式／特性區塊吃同一組卡片樣式。 */
  @media (min-width: 1024px) {
    .card-page { max-width: 1080px; padding: 24px 24px 56px; color: var(--ui-text); }
    .crumb { color: var(--ui-text-muted); }
    .crumb a, .links a { color: var(--ui-link); }
    h1 { font-size: 26px; color: var(--ui-text); margin: 6px 0 20px; }
    .body {
      display: grid;
      grid-template-columns: 340px minmax(0, 1fr);
      gap: 28px;
      padding: 24px;
      background: var(--ui-bg-elev);
      border: 1px solid var(--ui-border);
      border-radius: 16px;
      box-shadow: var(--ui-shadow);
    }
    .img { width: 340px; border-radius: 14px; box-shadow: 0 6px 22px rgba(0, 0, 0, 0.22); }
    .info { min-width: 0; font-size: 15px; border-radius: 10px; overflow: hidden; }
    .info th, .info td { border-color: var(--ui-border); padding: 9px 14px; }
    .info th { background: var(--ui-bg-sunken); color: var(--ui-text-muted); width: 110px; }
    .info td { color: var(--ui-text); }
    .sec {
      margin-top: 24px;
      padding: 20px 24px;
      background: var(--ui-bg-elev);
      border: 1px solid var(--ui-border);
      border-radius: 16px;
      box-shadow: var(--ui-shadow);
    }
    .sec h2 { margin-top: 0; border-left-color: var(--ui-accent); color: var(--ui-text); }
    .sec p, .block p { color: var(--ui-text); }
    .block { background: var(--ui-bg-sunken); border-radius: 10px; padding: 12px 16px; }
    .cost { background: var(--ui-accent-soft); color: var(--ui-link); }
    .dmg { color: #e0533f; }
    .foot { color: var(--ui-text-muted); }
    .foot a { color: var(--ui-link); }
  }
  /* >>> v6498-mobile-dark */
  /* ⭐v6.498 手機／平板深色主題（站長手機清單第 6 項：深色主題原本只有網頁版 ≥1024px）。
     ・條件：<html data-theme='dark'> 且不是網頁版（沒有 data-ui-wide）⇒ 手機淺色（預設）一個像素都不變，網頁版也不變。
     ・內容：本頁網頁版主題區塊（min-width:1024px）裡「只跟顏色有關」的宣告，原樣換成上面的條件（線寬、版面、尺寸一律不帶）；
       框線簡寫只取顏色（border-color），不會替手機版多出原本沒有的框。顏色讀 layout 的 --ui-* 深色色票。
     ・不用 @media（本頁的 @media 數量／桌機 CSS 指紋有守衛在釘）。 */
  :global(html[data-theme='dark']:not([data-ui-wide])) .card-page { color: var(--ui-text); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .crumb { color: var(--ui-text-muted); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .crumb a,
  :global(html[data-theme='dark']:not([data-ui-wide])) .links a { color: var(--ui-link); }
  :global(html[data-theme='dark']:not([data-ui-wide])) h1 { color: var(--ui-text); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .body { background: var(--ui-bg-elev); border-color: var(--ui-border); box-shadow: var(--ui-shadow); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .img { box-shadow: 0 6px 22px rgba(0, 0, 0, 0.22); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .info th,
  :global(html[data-theme='dark']:not([data-ui-wide])) .info td { border-color: var(--ui-border); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .info th { background: var(--ui-bg-sunken); color: var(--ui-text-muted); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .info td { color: var(--ui-text); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .sec { background: var(--ui-bg-elev); border-color: var(--ui-border); box-shadow: var(--ui-shadow); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .sec h2 { border-left-color: var(--ui-accent); color: var(--ui-text); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .sec p,
  :global(html[data-theme='dark']:not([data-ui-wide])) .block p { color: var(--ui-text); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .block { background: var(--ui-bg-sunken); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .cost { background: var(--ui-accent-soft); color: var(--ui-link); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .dmg { color: #e0533f; }
  :global(html[data-theme='dark']:not([data-ui-wide])) .foot { color: var(--ui-text-muted); }
  :global(html[data-theme='dark']:not([data-ui-wide])) .foot a { color: var(--ui-link); }
  /* <<< v6498-mobile-dark */
</style>
