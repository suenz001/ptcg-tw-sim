// v6.669 的精確歷史還原（豐收漁網收進中央多組選擇），供舊版守衛使用。表由 difflib 產生、驗證逐位元回 64c7f253（v6.668）。
// 鏈：本版是目前最新一節；revert-v6668 的 revertV6668IfPresent 會先呼叫本檔。
import assert from 'node:assert/strict';
import { normEol } from './eol-agnostic.mjs';

export const V6669_PAIRS = {
  "oracle-admin/admin.html": [
    [
      "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.669';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n",
      "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.668';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n"
    ]
  ],
  "src/lib/game/ai.ts": [
    [
      "      });\n      // >>> v6669-fishnet-groups\n      // ⭐v6.669 棄牌區的多組選擇（豐收漁網）：每組各取前 N 張（同一份 sanitizeSelectionSet）\n      if (isGroupsFilter(f)) {\n        const keepD = new Set(sanitizeSelectionSet('discard-search', f, discard, pool, { params: sel.params }));\n        discard = discard.filter(c => keepD.has(c.iid));\n      }\n      // <<< v6669-fishnet-groups\n      const count = Math.min(sel.maxCount, discard.length);\n",
      "      });\n      const count = Math.min(sel.maxCount, discard.length);\n"
    ],
    [
      "        if (!card) return false;\n        if (isKnownSelectionFilter('discard-search', f)) return evaluateSelectionFilter('discard-search', f, c, card, { params: sel.params }) === true;   // ⭐v6.669 傳 params（'Groups'）\n        if (f === 'PokemonOrEnergy') return (card.supertype === 'Pokemon') || card.supertype === 'Energy';\n",
      "        if (!card) return false;\n        if (isKnownSelectionFilter('discard-search', f)) return evaluateSelectionFilter('discard-search', f, c, card, {}) === true;\n        if (f === 'PokemonOrEnergy') return (card.supertype === 'Pokemon') || card.supertype === 'Energy';\n"
    ]
  ],
  "src/lib/game/effects/_shared.ts": [
    [
      "  pool: Map<string, Card>,\n  zoneKind: 'deck-search' | 'hand-discard' | 'discard-search',   // ⭐v6.669 棄牌區（豐收漁網）\n): { picked: string[]; byGroup: string[][] } {\n",
      "  pool: Map<string, Card>,\n  zoneKind: 'deck-search' | 'hand-discard',\n): { picked: string[]; byGroup: string[][] } {\n"
    ]
  ],
  "src/lib/game/effects/cards/items_misc.ts": [
    [
      "  const p = st.players[idx];\n  // >>> v6669-fishnet-groups\n  // 自驗：有 params.groups（v6.669 起）⇒ 走中央拆組（只收棄牌區、每組最多 3、首見保留）；\n  //   舊 pending（部署當下開出的、沒有 groups）⇒ 維持原本的各型上限 3。\n  let picks: CardInstance[];\n  if (Array.isArray((params as Record<string, unknown> | undefined)?.groups)) {\n    const { picked } = splitGroupedPick(iids, p.discard, params as Record<string, unknown> | undefined, pool, 'discard-search');\n    picks = picked.map(id => p.discard.find(c => c.iid === id)!);\n  } else {\n    const selected = p.discard.filter(c => iids.includes(c.iid));\n    const pokes = selected.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon').slice(0, 3);\n    const energies = selected.filter(c => pool.get(c.cardId)?.supertype === 'Energy').slice(0, 3);\n    picks = [...pokes, ...energies];\n  }\n  // <<< v6669-fishnet-groups\n  const pickSet = new Set(picks.map(c => c.iid));\n",
      "  const p = st.players[idx];\n  const selected = p.discard.filter(c => iids.includes(c.iid));\n  // 防衛性各型上限 3（UI 端 fishnetPickState 已 enforce；此處避免 server/sim 收到超量）\n  const pokes = selected.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon').slice(0, 3);\n  const energies = selected.filter(c => pool.get(c.cardId)?.supertype === 'Energy').slice(0, 3);\n  const picks = [...pokes, ...energies];\n  const pickSet = new Set(picks.map(c => c.iid));\n"
    ],
    [
      "});\nregR('fishnet-unified', (st, idx, iids, params, pool) => {\n  if (iids.length === 0) {\n",
      "});\nregR('fishnet-unified', (st, idx, iids, _params, pool) => {\n  if (iids.length === 0) {\n"
    ],
    [
      "  });\n  // <<< v6669-fishnet-groups\n});\n",
      "  });\n});\n"
    ],
    [
      "    effectKey: 'fishnet-unified',\n    params: {\n      validIids,\n      groups: [\n        { label: '【寶可夢】', filter: 'PokemonOfType=Water', max: 3 },\n        { label: '【能量】', filter: 'BasicEnergyOf=Water', max: 3 },\n      ],\n    },\n  });\n",
      "    effectKey: 'fishnet-unified',\n    params: { validIids },\n  });\n"
    ],
    [
      "    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Groups', minCount: 0, maxCount,\n    effectKey: 'fishnet-unified',\n",
      "    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'WaterPokemonOrBasicWaterEnergy', minCount: 0, maxCount,\n    effectKey: 'fishnet-unified',\n"
    ],
    [
      "  st = addLog(st, '豐收漁網：從棄牌區選【水】寶可夢與基本【水】能量（各最多 3 張）放回牌庫並重洗', idx);\n  // >>> v6669-fishnet-groups\n  // ⭐v6.669：「各 3 張、選滿變暗」改走中央多組選擇（filter 'Groups'＋params.groups，每組 max 3），\n  //   UI 變暗／確認鈕／AI／engine 消毒閘／下方 resolver 都用 selection-filter 同一份判準（原本對戰頁自己寫一套）。\n  return withPending(st, {\n",
      "  st = addLog(st, '豐收漁網：從棄牌區選【水】寶可夢與基本【水】能量（各最多 3 張）放回牌庫並重洗', idx);\n  return withPending(st, {\n"
    ],
    [
      "import { logPickedCards } from '../_shared'; // v6.097 揭示卡名中央來源\nimport { splitGroupedPick } from '../_shared'; // ⭐v6.669 豐收漁網走中央多組選擇\n// v3.06 對手 trainer 免疫 helper（斧牙龍｜緊張感 / 浩大鯨ex｜融合為雪）\n",
      "import { logPickedCards } from '../_shared'; // v6.097 揭示卡名中央來源\n// v3.06 對手 trainer 免疫 helper（斧牙龍｜緊張感 / 浩大鯨ex｜融合為雪）\n"
    ]
  ],
  "src/lib/game/engine.ts": [
    [
      "    const allowSet = new Set(viRaw as string[]);\n    // >>> v6669-fishnet-groups\n    // ⭐v6.669 棄牌區的多組選擇（豐收漁網）：validIids 交集後，再依組別每組最多 N 張（首見保留）、去重、夾總數\n    if (t === 'discard-search' && pool && isGroupsFilter(pending.filter) && p && Array.isArray(p.discard)) {\n      const seenD = new Set<string>();\n      const instsD: CardInstance[] = [];\n      for (const iid of iids) {\n        if (seenD.has(iid) || !allowSet.has(iid)) continue;\n        const inst = p.discard.find(c => c.iid === iid);\n        if (!inst) continue;\n        seenD.add(iid); instsD.push(inst);\n      }\n      const groupedD = sanitizeSelectionSet('discard-search', pending.filter ?? '', instsD, pool, { params: pending.params as Record<string, unknown> | undefined });\n      return typeof pending.maxCount === 'number' ? groupedD.slice(0, Math.max(0, pending.maxCount)) : groupedD;\n    }\n    // <<< v6669-fishnet-groups\n    return iids.filter((iid) => allowSet.has(iid));\n",
      "    const allowSet = new Set(viRaw as string[]);\n    return iids.filter((iid) => allowSet.has(iid));\n"
    ]
  ],
  "src/lib/game/selection-filter.ts": [
    [
      "    // <<< v6668-selection-groups\n    // >>> v6669-fishnet-groups\n    // ⭐v6.669 組內用：印刷屬性為 X 的寶可夢卡（PokemonOfType=Water；與豐收漁網既有 gate 同一判準：card.pokemonType）\n    if (filter.startsWith('PokemonOfType=')) return card.supertype === 'Pokemon' && card.pokemonType === filter.slice('PokemonOfType='.length);\n    // <<< v6669-fishnet-groups\n    if (filter.startsWith('Card:')) return card.name === filter.slice(5);\n",
      "    // <<< v6668-selection-groups\n    if (filter.startsWith('Card:')) return card.name === filter.slice(5);\n"
    ],
    [
      "  'Pokemon:Name=', 'Pokemon:Names=', 'NameContains:', 'Card:', 'Basic:NamePrefix=',\n  'Tool:NameContains=', 'Stage1Or2:', 'BasicEnergyOf=', 'PokemonOfType='] as const;\n\n",
      "  'Pokemon:Name=', 'Pokemon:Names=', 'NameContains:', 'Card:', 'Basic:NamePrefix=',\n  'Tool:NameContains=', 'Stage1Or2:', 'BasicEnergyOf='] as const;\n\n"
    ],
    [
      "  'PokemonNonExOrBasicEnergy': (c) => (c.supertype === 'Pokemon' && !isRulePokemon(c)) || (c.supertype === 'Energy' && c.subtype === 'Basic'),\n  // >>> v6669-fishnet-groups\n  // ⭐v6.669 棄牌區的多組選擇（豐收漁網：【水】寶可夢與基本【水】能量最多各 3 張）：同一份組別判準\n  'Groups': (c, ctx) => selectionGroupIndex(readSelectionGroups(ctx.params), { iid: '' }, c) >= 0,\n  // <<< v6669-fishnet-groups\n  'WaterPokemonOrBasicWaterEnergy': (c) => {\n",
      "  'PokemonNonExOrBasicEnergy': (c) => (c.supertype === 'Pokemon' && !isRulePokemon(c)) || (c.supertype === 'Energy' && c.subtype === 'Basic'),\n  'WaterPokemonOrBasicWaterEnergy': (c) => {\n"
    ]
  ],
  "src/lib/version.ts": [
    [
      " */\nexport const VERSION = '6.669';\n",
      " */\nexport const VERSION = '6.668';\n"
    ]
  ],
  "src/routes/game/+page.svelte": [
    [
      "              {#if c || concealed}\n                {@const _bdDisabled = isBrocksDigDisabled(item) || isGroupPickDisabled(item)}\n                {@const _grpLabel = selGroupLabel(item)}\n",
      "              {#if c || concealed}\n                {@const _bdDisabled = isBrocksDigDisabled(item) || isFishnetDisabled(item) || isGroupPickDisabled(item)}\n                {@const _grpLabel = selGroupLabel(item)}\n"
    ],
    [
      "      if (item && isBrocksDigDisabled(item)) return;\n    }\n    // >>> v6668-selection-groups\n    if (selGroups) {\n",
      "      if (item && isBrocksDigDisabled(item)) return;\n    }\n    if (pendingSelection?.effectKey === 'fishnet-unified') {\n      const item = selectionItems.find(it => it.iid === iid);\n      if (item && isFishnetDisabled(item)) return;\n    }\n    // >>> v6668-selection-groups\n    if (selGroups) {\n"
    ],
    [
      "      if (brocksDigPickState.basicCount > 2) return false;\n    }\n",
      "      if (brocksDigPickState.basicCount > 2) return false;\n    }\n    if (pendingSelection.effectKey === 'fishnet-unified') {\n      if (fishnetPickState.pokeCount > 3 || fishnetPickState.energyCount > 3) return false;\n    }\n"
    ],
    [
      "  }\n  // ⭐v6.669 豐收漁網原本在這裡自己寫一套「各 3 張、選滿變暗」（fishnetPickState／isFishnetDisabled），\n  //   已收進下方中央多組選擇（params.groups，每組 max 3）。\n  // >>> v6668-selection-groups\n",
      "  }\n  // v5.489：豐收漁網 — 同 picker 內分類上限（【水】寶可夢 ≤3、基本【水】能量 ≤3）\n  const fishnetPickState = $derived.by(() => {\n    if (!pendingSelection || pendingSelection.effectKey !== 'fishnet-unified') {\n      return { pokeCount: 0, energyCount: 0 };\n    }\n    let pokeCount = 0, energyCount = 0;\n    for (const iid of selectionPicked) {\n      const item = selectionItems.find(it => it.iid === iid);\n      if (!item) continue;\n      const card = getCard(item.cardId);\n      if (!card) continue;\n      if (card.supertype === 'Pokemon') pokeCount++;\n      else if (card.supertype === 'Energy') energyCount++;\n    }\n    return { pokeCount, energyCount };\n  });\n  function isFishnetDisabled(item: CardInstance): boolean {\n    if (!pendingSelection || pendingSelection.effectKey !== 'fishnet-unified') return false;\n    if (selectionPicked.has(item.iid)) return false;  // 已選 → 允許取消\n    const card = getCard(item.cardId);\n    if (!card) return false;\n    if (card.supertype === 'Pokemon') return fishnetPickState.pokeCount >= 3;   // 寶可夢已選 3 → 擋\n    if (card.supertype === 'Energy') return fishnetPickState.energyCount >= 3;   // 能量已選 3 → 擋\n    return false;\n  }\n  // >>> v6668-selection-groups\n"
    ],
    [
      "          // v6.017（P1-1 批4）：中央 selection filter 求值器（known 走中央、否則落原 inline chain）；UI 為 canonical，零行為變更\n          if (isKnownSelectionFilter('discard-search', f)) return evaluateSelectionFilter('discard-search', f, c, card, { params: pendingSelection.params }) === true;   // ⭐v6.669 傳 params（'Groups'）\n          if (f === 'PokemonOrEnergy') return (card.supertype === 'Pokemon') || card.supertype === 'Energy';\n",
      "          // v6.017（P1-1 批4）：中央 selection filter 求值器（known 走中央、否則落原 inline chain）；UI 為 canonical，零行為變更\n          if (isKnownSelectionFilter('discard-search', f)) return evaluateSelectionFilter('discard-search', f, c, card, {}) === true;\n          if (f === 'PokemonOrEnergy') return (card.supertype === 'Pokemon') || card.supertype === 'Energy';\n"
    ]
  ],
  "static/changelog-archive.html": [
    [
      "<details>\n        <summary><span class=\"ver-badge\">v6.629</span> <b>改善手機牌組投稿按鈕辨識度</b><br>牌組公布欄的投稿按鈕統一使用綠底白字。</summary>\n        <div class=\"log-body\">手機與電腦、淺色與深色模式的「＋ 投稿牌組」按鈕統一使用森林綠底白字，讓文字更清楚。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.626</span> <b>修正公開牌組分享資訊與熱門統計</b><br>改善牌組分享資訊、熱門統計可靠性與手機版顯示。</summary>\n",
      "<details>\n        <summary><span class=\"ver-badge\">v6.626</span> <b>修正公開牌組分享資訊與熱門統計</b><br>改善牌組分享資訊、熱門統計可靠性與手機版顯示。</summary>\n"
    ]
  ],
  "static/changelog-bodies.html": [
    [
      "<div class=\"log-body\" data-ver=\"v6.631\">手機網路不穩時，卡圖有時會「卡住」——既沒有載入完成、也沒有顯示失敗，備戰區就一直空白，要點開查看詳情才會出現。現在畫面上的卡圖若 15 秒還沒載完，會自動改用另一條路徑重新載入；切到其他 App 再回來時，之前一直載不出來的圖也會再試一次。另外修正 iPad 上牌組編輯器的放大鏡、星星（常用卡牌）圖示，以及上方的明暗模式切換圖示稍微偏一邊的問題。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n",
      "<div class=\"log-body\" data-ver=\"v6.631\">手機網路不穩時，卡圖有時會「卡住」——既沒有載入完成、也沒有顯示失敗，備戰區就一直空白，要點開查看詳情才會出現。現在畫面上的卡圖若 15 秒還沒載完，會自動改用另一條路徑重新載入；切到其他 App 再回來時，之前一直載不出來的圖也會再試一次。另外修正 iPad 上牌組編輯器的放大鏡、星星（常用卡牌）圖示，以及上方的明暗模式切換圖示稍微偏一邊的問題。</div>\n<div class=\"log-body\" data-ver=\"v6.629\">手機與電腦、淺色與深色模式的「＋ 投稿牌組」按鈕統一使用森林綠底白字，讓文字更清楚。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n"
    ],
    [
      "<div class=\"log-body\" data-ver=\"v6.656\">卡牌資料庫與牌組編輯器新增稀有卡／一般卡、有特性／無特性篩選。招式費用改用0、1、2等數字，並改善桌機與手機的篩選列對齊及換行。</div>\n<div class=\"log-body\" data-ver=\"v6.655\"><ul><li><b>統一對戰座位解析</b>：對戰頁雙方頭像預載與名片點擊改由 <code>resolveBattleSeatTarget()</code> 統一解析，錦標賽回放依 <code>matchId</code>、觀戰依實際觀戰房號、正式對戰依真實場次查詢，一般對戰本地復盤顯示本地紀錄名片而不誤查預設房。</li><li><b>後端與測試房雙重防呆</b>：測試房僅當下具備真實玩家 UID 時才查詢對應名片，後端同步阻斷讀取預設測試房殘留座位並優先以驗證報名的賽事紀錄解析帳號，避免 P1 固定顯示管理員名片。</li></ul></div>\n",
      "<div class=\"log-body\" data-ver=\"v6.655\"><ul><li><b>統一對戰座位解析</b>：對戰頁雙方頭像預載與名片點擊改由 <code>resolveBattleSeatTarget()</code> 統一解析，錦標賽回放依 <code>matchId</code>、觀戰依實際觀戰房號、正式對戰依真實場次查詢，一般對戰本地復盤顯示本地紀錄名片而不誤查預設房。</li><li><b>後端與測試房雙重防呆</b>：測試房僅當下具備真實玩家 UID 時才查詢對應名片，後端同步阻斷讀取預設測試房殘留座位並優先以驗證報名的賽事紀錄解析帳號，避免 P1 固定顯示管理員名片。</li></ul></div>\n"
    ]
  ],
  "static/changelog.html": [
    [
      "      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n",
      "      </details>\n      <details data-ver=\"v6.629\">\n        <summary><span class=\"ver-badge\">v6.629</span> <b>改善手機牌組投稿按鈕辨識度</b><br>牌組公布欄的投稿按鈕統一使用綠底白字。</summary>\n      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n"
    ],
    [
      "        <summary><span class=\"ver-badge\">v6.656</span> <b>卡牌篩選新增稀有度與特性，改善排列</b><br>查卡與組牌可篩選稀有卡、有無特性，費用改為簡潔數字。</summary>\n      </details>\n",
      "        <summary><span class=\"ver-badge\">v6.656</span> <b>卡牌篩選新增稀有度與特性，改善排列</b><br>查卡與組牌可篩選稀有卡、有無特性，費用改為簡潔數字。</summary>\n        <div class=\"log-body\">卡牌資料庫與牌組編輯器新增稀有卡／一般卡、有特性／無特性篩選。招式費用改用0、1、2等數字，並改善桌機與手機的篩選列對齊及換行。</div>\n      </details>\n"
    ],
    [
      "      </details>\n      <details data-ver=\"v6.656\">\n        <summary><span class=\"ver-badge\">v6.656</span> <b>卡牌篩選新增稀有度與特性，改善排列</b><br>查卡與組牌可篩選稀有卡、有無特性，費用改為簡潔數字。</summary>\n",
      "      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.656</span> <b>卡牌篩選新增稀有度與特性，改善排列</b><br>查卡與組牌可篩選稀有卡、有無特性，費用改為簡潔數字。</summary>\n"
    ],
    [
      "<details open>\n        <summary><span class=\"ver-badge\">v6.669</span> <b>豐收漁網的選擇視窗也標上組別</b><br>豐收漁網改用跟小光、鬥子相同的選擇方式：每張卡標出【寶可夢】或【能量】，某一組選滿 3 張後同組其他卡變暗。</summary>\n        <div class=\"log-body\">・規則不變：從棄牌區選【水】寶可夢與基本【水】能量最多各 3 張，給對手看過後放回牌庫並重洗。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.668</span> <b>「各選 1 張」的卡改成同一個視窗自由選</b><br>小光、鬥子、秘密箱等「從牌庫選擇 A 卡與 B 卡各 1 張」的卡，不再一段一段依序選，改成同一個視窗一次選完，選錯可以直接取消重選。</summary>\n",
      "<details open>\n        <summary><span class=\"ver-badge\">v6.668</span> <b>「各選 1 張」的卡改成同一個視窗自由選</b><br>小光、鬥子、秘密箱等「從牌庫選擇 A 卡與 B 卡各 1 張」的卡，不再一段一段依序選，改成同一個視窗一次選完，選錯可以直接取消重選。</summary>\n"
    ]
  ],
  "static/site-version.txt": [
    [
      "6.669\n",
      "6.668\n"
    ]
  ]
};
// 僅以本版獨有的錨點識別版本。
const V6669_MARKERS = {"oracle-admin/admin.html": [0], "src/lib/game/ai.ts": [0, 1], "src/lib/game/effects/_shared.ts": [0], "src/lib/game/effects/cards/items_misc.ts": [0, 1, 2, 3, 4, 5, 6], "src/lib/game/engine.ts": [0], "src/lib/game/selection-filter.ts": [0, 1, 2], "src/lib/version.ts": [0], "src/routes/game/+page.svelte": [3, 4], "static/changelog-archive.html": [0], "static/changelog-bodies.html": [0, 1], "static/changelog.html": [3], "static/site-version.txt": [0]};

export function revertV6669IfPresent(path, source) {
  let text = normEol(String(source));
  const pairs = V6669_PAIRS[path];
  if (!pairs || V6669_MARKERS[path].every((index) => !text.includes(pairs[index][0]))) return text;
  // 依序檢查＋還原（表是由新往舊逐段產生的，後面的錨點可能要前面先還原才出現）
  for (const [index, [from, to]] of pairs.entries()) {
    assert.equal(text.split(from).length, 2, 'v6669 還原錨點變動 ' + path + ' #' + (index + 1));
    text = text.replace(from, () => to);
  }
  return text;
}
