// v6.590：精確還原的唯一對照表；每個替換必須命中預期次數。
export const MOBILE_UI_V6590_PAIRS = {
  "src/routes/game/+page.svelte": [
    [
      "<svelte:body class:mp-locked={isPortraitMobile && !!game} />",
      "<!-- v6.590：body class 改由上方 effect 實際管理；svelte:body 的 class directive 不會產生 client JS。 -->"
    ],
    [
      "  let orientationLocked = $state(false);",
      "  // >>> v6590-mobile-body-lock\n  const mobileBattleLocked = $derived(isPortraitMobile && !!game);\n  $effect(() => {\n    if (typeof document === 'undefined') return;\n    document.body.classList.toggle('mp-locked', mobileBattleLocked);\n    return () => document.body.classList.remove('mp-locked');\n  });\n  // <<< v6590-mobile-body-lock\n  let orientationLocked = $state(false);"
    ],
    [
      "  $effect(() => {\n    if (!game || typeof window === 'undefined') return;\n    // 進對戰：push dummy state（marker 用 timestamp 確保唯一）",
      "  // v6.590：綁定是否進入盤面；出牌換掉 game 物件不再新增歷史項目。\n  const battleHistoryActive = $derived(!!game);\n  $effect(() => {\n    if (!battleHistoryActive || typeof window === 'undefined') return;\n    // 進對戰：push dummy state（marker 用 timestamp 確保唯一）"
    ],
    [
      "  function recomputeZoom() {\n    if (typeof window === 'undefined') return;",
      "  function recomputeZoom() {\n    if (typeof window === 'undefined') return;\n    // v6.590：手機固定盤面一律原比例；手動解析度仍保存，回桌機時照原設定套用。\n    if (isPortraitMobile) { gameZoom = 1; return; }"
    ],
    [
      "      // 手機 portrait 走另一個元件，不縮放\n      if (isPortraitMobile) { gameZoom = 1; return; }\n",
      ""
    ]
  ],
  "src/routes/game/MobilePortraitBattle.svelte": [
    [
      "    --mp-card-ar: 63 / 88;",
      "    --mp-card-ar: 63 / 88;\n    /* v6.590：只在可用高度不足時壓縮彈性區；一般直式維持原尺寸。655px 包含計時列。 */\n    --mp-shortfall: clamp(0px, calc(655px - (100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px))), 360px);\n    --mp-hand-size: max(48px, calc(96px - var(--mp-shortfall) * 0.16));"
    ],
    [
      "    min-height: 80px;",
      "    min-height: max(8px, calc(80px - var(--mp-shortfall) * 0.25));"
    ],
    [
      "    min-height: 88px;",
      "    min-height: max(24px, calc(88px - var(--mp-shortfall) * 0.25));"
    ],
    [
      "    flex: 1; min-height: 50px; max-height: 120px;",
      "    flex: 1; min-height: max(28px, calc(50px - var(--mp-shortfall) * 0.1)); max-height: 120px;"
    ],
    [
      "    flex: 0 0 96px;",
      "    flex: 0 0 var(--mp-hand-size);"
    ],
    [
      "    width: 64px; height: 86px;",
      "    width: calc((var(--mp-hand-size) - 10px) * 0.7441860465); height: calc(var(--mp-hand-size) - 10px);"
    ],
    [
      "      if (!down) return;\n      const dx = e.clientX - startX;",
      "      if (!down) return;\n      if (e.buttons === 0) { onCancel(); return; }\n      const dx = e.clientX - startX;"
    ],
    [
      "    node.addEventListener('pointerdown', onDown);\n    window.addEventListener('pointermove', onMove);",
      "    // v6.590：取消／失焦不能留下拖曳狀態，也不能吞掉下一次真正的點擊。\n    function onCancel() {\n      down = false; moved = false;\n      node.classList.remove('mp-dragging');\n    }\n    node.addEventListener('pointerdown', onDown);\n    window.addEventListener('pointercancel', onCancel);\n    window.addEventListener('blur', onCancel);\n    window.addEventListener('pointermove', onMove);"
    ],
    [
      "        window.removeEventListener('pointermove', onMove);\n        window.removeEventListener('pointerup', onUp);",
      "        window.removeEventListener('pointercancel', onCancel);\n        window.removeEventListener('blur', onCancel);\n        onCancel();\n        window.removeEventListener('pointermove', onMove);\n        window.removeEventListener('pointerup', onUp);"
    ],
    [
      "    --mp-hand-size: max(48px, calc(96px - var(--mp-shortfall) * 0.16));",
      "    --mp-hand-size: max(48px, calc(96px - var(--mp-shortfall) * 0.16));\n    container: mobile-battle / size;"
    ],
    [
      "    min-height: max(24px, calc(88px - var(--mp-shortfall) * 0.25));",
      "    min-height: max(52px, calc(88px - var(--mp-shortfall) * 0.25));"
    ],
    [
      "    flex: 1; min-width: 0;\n    display: flex; flex-direction: column; gap: 4px;",
      "    flex: 1; min-width: 0;\n    display: flex; flex-direction: column; gap: 4px;\n    max-height: 100%; overflow-y: auto; touch-action: pan-y;"
    ],
    [
      "  /* ── Active 大圖 ─────────────────────────────────────────────────── */",
      "  /* v6.590：短視窗資訊改兩欄，HP仍顯示；過多狀態在卡內捲動，不搶相鄰chips的點擊。 */\n  @container mobile-battle (max-height: 633px) {\n    .mp-active-info { flex-flow: row wrap; align-items: center; gap: 2px 6px; }\n    .mp-active-name { flex: 1 1 110px; min-width: 0; }\n    .mp-hp { flex: 1 0 90px; }\n    .mp-meta { flex: 1 1 auto; }\n  }\n  /* ── Active 大圖 ─────────────────────────────────────────────────── */"
    ],
    [
      "    container: mobile-battle / size;",
      "    container: mobile-battle / size;\n    --mp-field-pad: max(0px, calc(4px - var(--mp-shortfall) * 0.02));"
    ],
    [
      "    min-height: max(52px, calc(88px - var(--mp-shortfall) * 0.25));",
      "    min-height: max(44px, calc(88px - var(--mp-shortfall) * 0.25));"
    ],
    [
      "    padding: 4px 6px;\n    overflow-x: auto;",
      "    padding: var(--mp-field-pad) 6px;\n    overflow-x: auto;"
    ],
    [
      "    padding: 4px 8px;\n    position: relative;",
      "    padding: var(--mp-field-pad) 8px;\n    position: relative;"
    ],
    [
      "    .mp-active-info { flex-flow: row wrap; align-items: center; gap: 2px 6px; }",
      "    .mp .mp-active-info { flex-flow: row wrap; align-items: center; gap: 2px 6px; }"
    ],
    [
      ".mp-log, .mp-chips, .mp-sheet, .chat-panel-messages",
      ".mp-log, .mp-chips, .mp-sheet, .mp-active-info, .chat-panel-messages"
    ],
    [
      "'.mp-row, .mp-hand, .mp-log, .mp-chips, .mp-sheet, ' +",
      "'.mp-row, .mp-hand, .mp-log, .mp-chips, .mp-sheet, .mp-active-info, ' +"
    ]
  ],
  "src/lib/modal-drag.ts": [
    [
      "  minVisibleW = MODAL_MIN_VISIBLE,\n): ModalOffset {",
      "  minVisibleW = MODAL_MIN_VISIBLE,\n  safeTop = 0,\n): ModalOffset {"
    ],
    [
      "  const loTop = 0;",
      "  // v6.590：把手不能進入狀態列；安全區比可用高度大時仍以可達的上緣為準。\n  const loTop = Math.max(0, safeTop || 0);\n  hiTop = Math.max(loTop, hiTop);"
    ],
    [
      "function safeBottomPx(): number {",
      "function safeInsetPx(side: 'top' | 'bottom'): number {"
    ],
    [
      "  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:var(--safe-bottom, 0px);';",
      "  probe.style.cssText = `position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:var(--safe-${side}, 0px);`;"
    ],
    [
      "  let safeB = 0;   // 拖曳開始／重夾時量一次（不在 pointermove 裡量，避免每一格都動 DOM）",
      "  let safeB = 0, safeT = 0;   // v6.590：上下安全區只在拖曳開始／重夾時量，不在 pointermove 量。"
    ],
    [
      "safeB = safeBottomPx();",
      "safeB = safeInsetPx('bottom'); safeT = safeInsetPx('top');"
    ],
    [
      "safeB, minVisW)",
      "safeB, minVisW, safeT)"
    ]
  ]
};
export function revertMobileUiV6590(source, path) {
 let result=source.replace(/\r\n/g,"\n");
 for(const [before,after] of [...(MOBILE_UI_V6590_PAIRS[path] || [])].reverse()){
  if(!after){ const anchor="      // v2.463："; if(result.split(anchor).length!==2)throw Error("v6590 insertion anchor");result=result.replace(anchor,before+anchor);continue; }
  const count=result.split(after).length-1;const expected=before==="safeB = safeBottomPx();" || before==="safeB, minVisW)" ? 4 : 1;
  if(count!==expected)throw Error("v6590 restore count "+path+" "+count+" != "+expected);result=result.split(after).join(before);
 }
 return result;
}
