<style>
  /*   ⭐v6.505 全站版面統一 第 2 步：對戰演練／錦標賽大廳的頁首與模式卡片比照其他頁（站長 2026-10-07 選定
    「以電腦版現有綠色系為基準」「拿掉頁面內的 ← 首頁（手機有底部導覽列、電腦有頂端列）」）。

    為什麼是獨立元件、只有樣式：
    ・對戰頁（game/+page.svelte）不能再加 @media（多支守衛釘住數量），桌機 CSS 有逐位元比對守衛（test-v6441），
      大廳淺色規則由 scripts/gen-lobby-light.py 掃描對戰頁樣式「機械產生」（test-v6477 S5 比對）——
      寫在對戰頁裡會牽動這三件事。放在這裡：對戰頁只多一行 import 與一個標籤。
    ・全部規則都帶 html:not([data-battle-view]) ⇒ 牌桌畫面（對戰／觀戰／回放）一個像素都不動。
    ・手機／網頁版用 layout 掛的 <html data-ui-wide>（≥1024px）分，與其他頁同一個開關。
    ・顏色一律讀 layout 的 --ui-* 色票 ⇒ 深色／淺色主題自動跟著換。
    ・模式卡片的選擇器加 body、類別重複三次（body .mode-card.mode-card.mode-card）：要蓋過 v6.477 產生器那兩條
      html[data-theme='light']:not([data-battle-view]) .mode-card／.mode-card.online（含 Svelte 範圍類別，特異度到 0,5,1）。
  ⚠ 說明寫在樣式區塊的註解裡（不用 HTML 註解）：模板層若只有註解，test-v6297 的中央剝除器護欄會判定「註解吃掉了整個模板」。 */
  /* ⭐v6.507：頁首改用共用元件 $lib/ui/PageHeader.svelte（卡片樣式在元件裡；「← 首頁」「← 回到首頁」已從標記拿掉）
     ⇒ 原本這裡「收起 ← 首頁」與「h1 變卡片」四條規則已經沒有對象，刪除。 */
  /* 手機：頁首卡片頂端與其他頁一致（12px＋安全區） */
  :global(html:not([data-battle-view]):not([data-ui-wide]) main.lobby) {
    margin-top: var(--safe-top, 0px);
    padding-top: 12px !important;   /* 對戰頁手機分支是 padding: 0.8rem !important */
  }
  :global(html:not([data-battle-view]) main.tourn-lobby) { margin-top: calc(1rem + var(--safe-top, 0px)); }
  :global(html:not([data-battle-view]):not([data-ui-wide]) main.tourn-lobby) { margin-top: var(--safe-top, 0px); }
  /* ⭐v6.507 網頁版：頁首卡片離頂端列 24px（與牌組編輯器、卡牌資料庫、公布欄一致；main 本身已有 24px 上內距） */
  :global(html:not([data-battle-view])[data-ui-wide] main.lobby) { margin-top: 0; }

  /* 模式選擇卡片：與首頁功能卡同一種白卡（深色主題時是深色卡） */
  :global(html:not([data-battle-view]) body .lobby .mode-card.mode-card.mode-card) {
    background: var(--ui-bg-elev);
    border: 1px solid var(--ui-border);
    border-radius: 14px;
    box-shadow: var(--ui-shadow);
    color: var(--ui-text);
  }
  :global(html:not([data-battle-view]) body .lobby .mode-card.mode-card.mode-card:hover:not(:disabled)) {
    background: var(--ui-bg-elev);
    border-color: var(--ui-accent);
    box-shadow: var(--ui-shadow-hover);
  }
  :global(html:not([data-battle-view]) body .lobby .mode-card.mode-card.mode-card .mode-title) { color: var(--ui-text); }
  :global(html:not([data-battle-view]) body .lobby .mode-card.mode-card.mode-card .mode-desc) { color: var(--ui-text-muted); }

  /* ⭐v6.506 全站版面統一 第 3 步：大廳的主要／次要按鈕與輸入框比照其他頁（綠色主色、白底框線輸入框）。
     選擇器同樣加 body 與重複類別，蓋過 v6.477 產生器的淺色規則。 */
  :global(html:not([data-battle-view]) body .lobby .btn-primary.btn-primary.btn-primary) { background: var(--ui-accent); color: var(--ui-accent-contrast); border: 1px solid var(--ui-accent); border-radius: 10px; }
  :global(html:not([data-battle-view]) body .lobby .btn-primary.btn-primary.btn-primary:hover:not(:disabled)) { background: var(--ui-accent); filter: brightness(1.08); }
  :global(html:not([data-battle-view]) body .lobby .btn-secondary.btn-secondary.btn-secondary) { background: var(--ui-bg-elev); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 10px; }
  :global(html:not([data-battle-view]) body .lobby .btn-secondary.btn-secondary.btn-secondary:hover:not(:disabled)) { background: var(--ui-accent-soft); border-color: var(--ui-accent); }
  :global(html:not([data-battle-view]) body .lobby .name-input.name-input.name-input),
  :global(html:not([data-battle-view]) body .lobby .deck-select.deck-select.deck-select) { background: var(--ui-input-bg); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 8px; }
</style>
