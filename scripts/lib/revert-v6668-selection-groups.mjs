// v6.668 的精確歷史還原（多組選擇「各選 1 張」收斂成同一個視窗），供舊版守衛使用。表由 difflib 產生、驗證逐位元回 fd0903d4（v6.667）。
// 鏈：本版是目前最新一節；revert-v6666 的 revertV6666IfPresent 會先呼叫本檔（一版一節，既有呼叫點一個字都不必改）。
import assert from 'node:assert/strict';
import { normEol } from './eol-agnostic.mjs';

export const V6668_PAIRS = {
  "oracle-admin/admin.html": [
    [
      "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.668';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n",
      "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.667';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n"
    ]
  ],
  "src/lib/game/ai.ts": [
    [
      "      });\n      // >>> v6668-selection-groups\n      // ⭐v6.668 從手牌「最多各 1 張」（烈焰猴／鴨嘴炎獸）：每組各取 1 張\n      if (isGroupsFilter(f)) {\n        const keepH = new Set(sanitizeSelectionSet('hand-discard', f, hand, pool, { params: sel.params }));\n        hand = hand.filter(c => keepH.has(c.iid));\n      }\n      // <<< v6668-selection-groups\n      const count = Math.min(sel.maxCount, hand.length);\n",
      "      });\n      const count = Math.min(sel.maxCount, hand.length);\n"
    ],
    [
      "      if (isKnownSelectionFilter('hand-discard', f)) {\n        hand = hand.filter(c => evaluateSelectionFilter('hand-discard', f, c, pool.get(c.cardId), { params: sel.params }) === true);   // ⭐v6.668 傳 params（'Groups'）\n      } else if (f === 'Energy') hand = hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');\n",
      "      if (isKnownSelectionFilter('hand-discard', f)) {\n        hand = hand.filter(c => evaluateSelectionFilter('hand-discard', f, c, pool.get(c.cardId), {}) === true);\n      } else if (f === 'Energy') hand = hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');\n"
    ],
    [
      "      }\n      // >>> v6668-selection-groups\n      // ⭐v6.668 多組選擇（小光／鬥子／秘密箱…）：照上面的有用度排序，每組各取最前面的 N 張（同一份 sanitizeSelectionSet）\n      if (isGroupsFilter(f)) {\n        const keep = new Set(sanitizeSelectionSet('deck-search', f, candidates, pool, { params: sel.params }));\n        candidates = candidates.filter(c => keep.has(c.iid));\n      }\n      // <<< v6668-selection-groups\n      const count = Math.min(sel.maxCount, candidates.length);\n",
      "      }\n      const count = Math.min(sel.maxCount, candidates.length);\n"
    ],
    [
      "import { activeEnergyDiscardCandidates, damageDistributeCandidates } from './selection-candidates';   // ⭐v6.523 能量 picker 候選與 UI 同一支；⭐v6.543 分配候選\nimport { evaluateSelectionFilter, isKnownSelectionFilter, isMegaExCard, isPokemonExCard, isGroupsFilter, sanitizeSelectionSet } from './selection-filter'; // v6.013/6.016 P1-1:deck-search/hand-discard/discard-search filter 中央求值器\n// v6.038 批次4b：AI 打法表（離線由高勝率對局整理出的策略表）。載入與適用判定都在 ai-playbook.ts，\n",
      "import { activeEnergyDiscardCandidates, damageDistributeCandidates } from './selection-candidates';   // ⭐v6.523 能量 picker 候選與 UI 同一支；⭐v6.543 分配候選\nimport { evaluateSelectionFilter, isKnownSelectionFilter, isMegaExCard, isPokemonExCard } from './selection-filter'; // v6.013/6.016 P1-1:deck-search/hand-discard/discard-search filter 中央求值器\n// v6.038 批次4b：AI 打法表（離線由高勝率對局整理出的策略表）。載入與適用判定都在 ai-playbook.ts，\n"
    ]
  ],
  "src/lib/game/effects.ts": [
    [
      "  });\n  // <<< v6668-selection-groups\n});\n",
      "  });\n});\n"
    ],
    [
      "  s = addLog(s, `秘密箱：丟棄 ${picked.length} 張手牌（${names}）`, aIdx);\n  // >>> v6668-selection-groups\n  // ⭐v6.668：四組同一個視窗自由選（mystery-box-pick-item／tool／supporter／stadium 保留給舊 pending）\n  return openGroupedDeckSearch(s, aIdx, {\n    label: '秘密箱',\n    groups: [\n      { label: '【物品】', filter: 'Item' },\n      { label: '【道具】', filter: 'Tool' },\n      { label: '【支援者】', filter: 'Supporter' },\n      { label: '【競技場】', filter: 'Stadium' },\n    ],\n  });\n",
      "  s = addLog(s, `秘密箱：丟棄 ${picked.length} 張手牌（${names}）`, aIdx);\n  // v2.144 — 改為 4 步串接：物品 → 道具 → 支援者 → 競技場（各最多 1 張）\n  s = addLog(s, '秘密箱：第 1 步—從牌庫選 1 張「物品」加手牌（可跳過）', aIdx);\n  return withPending(s, {\n    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,\n    filter: 'Item', minCount: 0, maxCount: 1,\n    effectKey: 'mystery-box-pick-item',\n  });\n"
    ],
    [
      "regG('鬥子', (st, idx) => st.players[idx].deck.length > 0);\n// >>> v6668-selection-groups\n// ⭐v6.668：同一個視窗自由選（touko-phase1／2 保留給舊 pending）\nreg('鬥子', (st, idx) => openGroupedDeckSearch(st, idx, {\n  label: '鬥子',\n  groups: [\n    { label: '【進化】', filter: 'EvolutionPokemon' },\n    { label: '【能量】', filter: 'Energy' },\n  ],\n}));\n// <<< v6668-selection-groups\nregR('touko-phase1', (st, idx, iids, _params, pool) => {\n",
      "regG('鬥子', (st, idx) => st.players[idx].deck.length > 0);\nreg('鬥子', (st, idx) => {\n  const s = addLog(st, '鬥子：搜尋 1 張進化寶可夢 + 1 張能量加手牌', idx);\n  return withPending(s, {\n    type: 'deck-search',\n    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Evolution',\n    minCount: 0, maxCount: 1,\n    effectKey: 'touko-phase1',\n  });\n});\nregR('touko-phase1', (st, idx, iids, _params, pool) => {\n"
    ],
    [
      "regG('小光', (st, idx) => st.players[idx].deck.length > 0);\n// >>> v6668-selection-groups\n// ⭐v6.668（玩家建議）：改成同一個視窗自由選三組（openGroupedDeckSearch）；下方 koharu-phase1～3 保留給部署當下還停在舊 pending 的對局。\nreg('小光', (st, idx) => openGroupedDeckSearch(st, idx, {\n  label: '小光',\n  groups: [\n    { label: '【基礎】', filter: 'Basic' },\n    { label: '【1階進化】', filter: 'Stage1' },\n    { label: '【2階進化】', filter: 'Stage2' },\n  ],\n}));\n// <<< v6668-selection-groups\nregR('koharu-phase1', (st, idx, iids, _params, pool) => {\n",
      "regG('小光', (st, idx) => st.players[idx].deck.length > 0);\nreg('小光', (st, idx) => {\n  const s = addLog(st, '小光：依序搜尋 1 基礎/1 進化一階/1 進化二階寶可夢加手牌', idx);\n  return withPending(s, {\n    type: 'deck-search',\n    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Basic',\n    minCount: 0, maxCount: 1,\n    effectKey: 'koharu-phase1',\n  });\n});\nregR('koharu-phase1', (st, idx, iids, _params, pool) => {\n"
    ],
    [
      "//      展示給對手後加進手牌，並重洗牌庫。\n// 實裝：⭐v6.668 起同一個視窗自由選三組（openGroupedDeckSearch，每組 0～1 張，最後重洗一次）。\n//      下方 koharu-phase1～3（舊的三段鏈）只保留給部署當下還停在舊 pending 的對局。\nregG('小光', (st, idx) => st.players[idx].deck.length > 0);\n",
      "//      展示給對手後加進手牌，並重洗牌庫。\n// 實裝：三段鏈式 deck-search（Basic → Stage1 → Stage2），每段 minCount:0 maxCount:1\n//      （牌庫找不到時玩家可以直接 Skip 進下一段）。最後階段結束才 shuffle。\nregG('小光', (st, idx) => st.players[idx].deck.length > 0);\n"
    ],
    [
      "regG('阿克羅瑪的執著', (st, idx) => st.players[idx].deck.length > 0);\n// >>> v6668-selection-groups\n// ⭐v6.668：同一個視窗自由選（akuroma-step1／2 保留給舊 pending）\nreg('阿克羅瑪的執著', (st, idx) => openGroupedDeckSearch(st, idx, {\n  label: '阿克羅瑪的執著',\n  groups: [\n    { label: '【競技場】', filter: 'Stadium' },\n    { label: '【能量】', filter: 'Energy' },\n  ],\n}));\n// <<< v6668-selection-groups\nregR('akuroma-step1-stadium', (st, idx, iids, _params, pool) => {\n",
      "regG('阿克羅瑪的執著', (st, idx) => st.players[idx].deck.length > 0);\nreg('阿克羅瑪的執著', (st, idx, pool) => {\n  st = addLog(st, '阿克羅瑪的執著：步驟 1／2 — 從牌庫選 1 張競技場卡加手牌', idx);\n  // v2.993：卡面寫「各 1 張」mandatory；牌庫無競技場時允許 Pass\n  const hasStadium = st.players[idx].deck.some(c => pool.get(c.cardId)?.subtype === 'Stadium');\n  return withPending(st, {\n    type: 'deck-search',\n    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Stadium',\n    minCount: 0, maxCount: 1,\n    effectKey: 'akuroma-step1-stadium',\n  });\n});\nregR('akuroma-step1-stadium', (st, idx, iids, _params, pool) => {\n"
    ],
    [
      "import { withAttackDamageTaken, addToolDiscardLog } from './effects/_shared'; // ⭐v6.256「受到的招式的傷害」唯一中央寫入點\nimport { openGroupedDeckSearch } from './effects/_shared'; // ⭐v6.668 「各選 1 張」多組選擇中央管線\nimport { legendPeakPrizeReduction } from './effects/_shared'; // v6.077 傳說的山頂（【無】被招式傷害KO 獎賞-1）\n",
      "import { withAttackDamageTaken, addToolDiscardLog } from './effects/_shared'; // ⭐v6.256「受到的招式的傷害」唯一中央寫入點\nimport { legendPeakPrizeReduction } from './effects/_shared'; // v6.077 傳說的山頂（【無】被招式傷害KO 獎賞-1）\n"
    ]
  ],
  "src/lib/game/effects/_shared.ts": [
    [
      "// <<< v6534-rocket-holder\n\n\n// >>> v6668-selection-groups\n/**\n * ⭐v6.668「從牌庫選擇 A 卡與 B 卡各 1 張，在給對手看過後加入手牌。並且重洗牌庫。」的中央管線\n *   （小光、鬥子、青木的手法、秘密箱、阿克羅瑪的執著、冒險提燈、杜若）。\n *   玩家建議：原本是一段一段依序選、選過的段落不能改 ⇒ 改成同一個視窗自由選，每組選滿後同組其他卡變暗。\n *   ・組別判準唯一一份：selection-filter 的 selectionGroupIndex／sanitizeSelectionSet（UI 變暗、AI 選卡、engine 消毒閘、這個 resolver 全用它）。\n *   ・每組下限 0：帶條件的搜尋可以宣告找不到（PTCG_RULES L832）。\n *   ・代價（秘密箱丟 3 張、青木丟光手牌）由呼叫端先付，這裡只負責搜尋。\n *   ・topIids：只能從牌庫上方這幾張裡選（杜若「查看牌庫上方7張」）；剩下的卡跟整副牌庫一起重洗（卡面「放回牌庫並重洗」）。\n *   ⚠ 舊的逐段 effectKey（koharu-phase1… 等）保留註冊，部署當下還停在舊 pending 的對局照樣能走完。\n */\nexport const GROUPED_SEARCH_TO_HAND = 'grouped-search-to-hand';\nexport function openGroupedDeckSearch(\n  st: GameState,\n  idx: 0 | 1,\n  opts: { label: string; groups: SelectionGroup[]; topIids?: string[] },\n): GameState {\n  const top = Array.isArray(opts.topIids);\n  const title = top ? `${opts.label}：從牌庫上方 ${opts.topIids!.length} 張選擇` : `${opts.label}：從牌庫選擇`;\n  const s = addLog(st, `${opts.label}：從牌庫選擇${opts.groups.map(g => g.label).join('、')}各 1 張`, idx);\n  return withPending(s, {\n    type: 'deck-search',\n    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: top ? 'Groups:TOP_N' : 'Groups',\n    minCount: 0, maxCount: groupsTotalMax(opts.groups),\n    effectKey: GROUPED_SEARCH_TO_HAND,\n    params: { label: opts.label, groups: opts.groups, titleOverride: title, ...(top ? { topIids: [...opts.topIids!] } : {}) },\n  });\n}\nregR(GROUPED_SEARCH_TO_HAND, (st, idx, iids, params, pool) => {\n  const label = typeof params?.label === 'string' ? params.label : '搜尋';\n  const groups = readSelectionGroups(params as Record<string, unknown> | undefined);\n  const topRaw = params?.topIids;\n  const topSet = Array.isArray(topRaw) ? new Set(topRaw as string[]) : null;\n  const deck = st.players[idx].deck;\n  // 自驗（不信任 payload）：只收牌庫裡的、（杜若）牌庫上方那幾張裡的、每組最多 N 張（首見保留）\n  const seen = new Set<string>();\n  const ordered: CardInstance[] = [];\n  for (const id of Array.isArray(iids) ? iids : []) {\n    if (seen.has(id) || (topSet && !topSet.has(id))) continue;\n    const inst = deck.find(c => c.iid === id);\n    if (!inst) continue;\n    seen.add(id); ordered.push(inst);\n  }\n  const keep = new Set(sanitizeSelectionSet('deck-search', topSet ? 'Groups:TOP_N' : 'Groups', ordered, pool, { params: params as Record<string, unknown> | undefined }));\n  const chosen = ordered.filter(c => keep.has(c.iid));\n  let s = st;\n  if (chosen.length > 0) {\n    // 卡面「在給對手看過後加入手牌」⇒ 公開卡名（附上組別）\n    const names = chosen.map(c => {\n      const card = pool.get(c.cardId);\n      const gi = selectionGroupIndex(groups, c, card);\n      return `${gi >= 0 ? groups[gi].label : ''}${card?.name ?? '?'}`;\n    }).join('、');\n    s = addLog(s, `${label}：給對手看過後加入手牌 ${names}`, idx);\n  } else {\n    s = addLog(s, `${label}：未選擇任何卡`, idx);\n  }\n  const chosenSet = new Set(chosen.map(c => c.iid));\n  return updatePlayer(s, idx, p => ({\n    ...p,\n    hand: [...p.hand, ...chosen],\n    deck: shuffle(p.deck.filter(c => !chosenSet.has(c.iid))),   // 卡面「並且重洗牌庫」：只在最後洗一次\n  }));\n});\n/**\n * ⭐v6.668 附能型「最多各 1 張」（大吾的巨金怪ex｜X啟動、烈焰猴｜火焰蹈舞、鴨嘴炎獸｜拍檔提升）共用：\n *   把 payload 依組別拆開（每組最多 N 張、首見保留、只收 zone 裡真的有的卡）。回傳 byGroup[i]＝第 i 組選到的 iid。\n */\nexport function splitGroupedPick(\n  iids: string[],\n  zone: ReadonlyArray<CardInstance>,\n  params: Record<string, unknown> | undefined,\n  pool: Map<string, Card>,\n  zoneKind: 'deck-search' | 'hand-discard',\n): { picked: string[]; byGroup: string[][] } {\n  const groups = readSelectionGroups(params);\n  const seen = new Set<string>();\n  const ordered: CardInstance[] = [];\n  for (const id of Array.isArray(iids) ? iids : []) {\n    if (seen.has(id)) continue;\n    const inst = zone.find(c => c.iid === id);\n    if (!inst) continue;\n    seen.add(id); ordered.push(inst);\n  }\n  const picked = sanitizeSelectionSet(zoneKind, 'Groups', ordered, pool, { params });\n  const byGroup: string[][] = groups.map(() => []);\n  for (const id of picked) {\n    const inst = ordered.find(c => c.iid === id)!;\n    const gi = selectionGroupIndex(groups, inst, pool.get(inst.cardId));\n    if (gi >= 0) byGroup[gi].push(id);\n  }\n  return { picked, byGroup };\n}\n// <<< v6668-selection-groups\n",
      "// <<< v6534-rocket-holder\n"
    ],
    [
      "// v6.250 險惡廢墟：「場上【基礎】寶可夢」中央述詞同樣來自 selection-filter（同一個 leaf）\nimport { isMegaExCard, isBasicPokemonOnField, isRocketTeamPokemonCard, readSelectionGroups, sanitizeSelectionSet, groupsTotalMax, selectionGroupIndex, type SelectionGroup } from '../selection-filter';\nexport { isRocketTeamPokemonCard };   // ⭐v6.551 定義搬到 selection-filter（leaf），原名 re-export\n",
      "// v6.250 險惡廢墟：「場上【基礎】寶可夢」中央述詞同樣來自 selection-filter（同一個 leaf）\nimport { isMegaExCard, isBasicPokemonOnField, isRocketTeamPokemonCard } from '../selection-filter';\nexport { isRocketTeamPokemonCard };   // ⭐v6.551 定義搬到 selection-filter（leaf），原名 re-export\n"
    ]
  ],
  "src/lib/game/effects/cards/lopunny_serperior_flareon_festival.ts": [
    [
      "});\n// >>> v6668-selection-groups\nregR('metagross-x-start-grouped', (st, idx, iids, params, pool) => {\n  const { byGroup } = splitGroupedPick(iids, st.players[idx].deck, params as Record<string, unknown> | undefined, pool, 'deck-search');\n  return commitMetagrossEnergy(st, idx, byGroup[0]?.[0] ?? null, byGroup[1]?.[0] ?? null, pool);\n});\n// <<< v6668-selection-groups\n\n",
      "});\n\n"
    ],
    [
      "  });\n  // <<< v6668-selection-groups\n});\n",
      "  });\n});\n"
    ],
    [
      "    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Groups',\n    minCount: 0, maxCount: 2,\n    effectKey: 'metagross-x-start-grouped',\n    params: {\n      groups: [{ label: '【超】', filter: 'BasicEnergyOf=Psychic' }, { label: '【鋼】', filter: 'BasicEnergyOf=Metal' }],\n      titleOverride: 'X啟動：從牌庫選擇',\n    },\n  });\n",
      "    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Energy:Psychic',\n    minCount: 0, maxCount: 1,\n    effectKey: 'metagross-x-start-psy',\n    params: { titleOverride: 'X啟動 (1/2)：選 ≤1 張基本【超】能量' },\n  });\n"
    ],
    [
      "  \n  st = addLog(st, 'X啟動：從牌庫選擇基本【超】能量與基本【鋼】能量各最多 1 張，附於自己的【超】或【鋼】寶可夢', idx);\n  // >>> v6668-selection-groups\n  // ⭐v6.668：兩組同一個視窗自由選（metagross-x-start-psy／met 保留給舊 pending）\n  return withPending(st, {\n",
      "  \n  st = addLog(st, 'X啟動：從牌庫搜尋基本【超】能量與基本【鋼】能量各最多 1 張（自動附於【超】或【鋼】寶可夢）', idx);\n  return withPending(st, {\n"
    ],
    [
      "// 流程：\n//   1～2. ⭐v6.668 起同一個視窗選基本【超】與基本【鋼】能量各 0～1 張（多組選擇；舊的兩段 metagross-x-start-psy／met 只留給舊 pending）\n//   3. resolver：v2.158 升級為 startEnergyChain — 玩家逐張選目標（不再簡化附 active）\n",
      "// 流程：\n//   1. 選 1 張基本【超】能量（可跳過）\n//   2. 選 1 張基本【鋼】能量（可跳過）\n//   3. resolver：v2.158 升級為 startEnergyChain — 玩家逐張選目標（不再簡化附 active）\n"
    ],
    [
      "import { openDeckViewReshuffle } from '../_shared';  // v5.963 0-pick 重洗\nimport { splitGroupedPick } from '../_shared';  // ⭐v6.668 多組選擇拆組\nimport { isBasicEnergyOfType } from '../../engine';\n",
      "import { openDeckViewReshuffle } from '../_shared';  // v5.963 0-pick 重洗\nimport { isBasicEnergyOfType } from '../../engine';\n"
    ]
  ],
  "src/lib/game/effects/cards/m6_wave10.ts": [
    [
      "regG('冒險提燈', (st, idx) => st.players[idx].deck.length > 0);\n// >>> v6668-selection-groups\n// ⭐v6.668：兩組同一個視窗自由選（m6-lantern-step1／2 保留給舊 pending）\nreg('冒險提燈', (st, idx) => openGroupedDeckSearch(st, idx, {\n  label: '冒險提燈',\n  groups: [\n    { label: '【火】', filter: 'BasicEnergyOf=Fire' },\n    { label: '【雷】', filter: 'BasicEnergyOf=Lightning' },\n  ],\n}));\n// <<< v6668-selection-groups\nfunction lanternTake(st: GameState, idx: 0 | 1, iids: string[], pool: Map<string, Card>, label: string): GameState {\n",
      "regG('冒險提燈', (st, idx) => st.players[idx].deck.length > 0);\nreg('冒險提燈', (st, idx) => withPending(\n  addLog(st, '冒險提燈：步驟 1／2 — 從牌庫選 1 張「基本【火】能量」加手牌', idx), {\n    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Energy:Fire', minCount: 0, maxCount: 1,\n    effectKey: 'm6-lantern-step1-fire',\n  }));\nfunction lanternTake(st: GameState, idx: 0 | 1, iids: string[], pool: Map<string, Card>, label: string): GameState {\n"
    ],
    [
      "import { reg, regG, regR, addLog, updatePlayer, withPending, shuffle,\n         clearActiveEffects, tryPromptPromoteActive, PENDING_REFRESH_ON_POP, openGroupedDeckSearch } from '../_shared';\nimport { switchRetreatOrderInfo, switchRetreatOrderPending, fireSwitchRetreatAbility } from '../../effects';   // ⭐v6.548 回備戰特性 × 訓練家 的順序（中央）\n",
      "import { reg, regG, regR, addLog, updatePlayer, withPending, shuffle,\n         clearActiveEffects, tryPromptPromoteActive, PENDING_REFRESH_ON_POP } from '../_shared';\nimport { switchRetreatOrderInfo, switchRetreatOrderPending, fireSwitchRetreatAbility } from '../../effects';   // ⭐v6.548 回備戰特性 × 訓練家 的順序（中央）\n"
    ]
  ],
  "src/lib/game/effects/cards/m6_wave14.ts": [
    [
      "});\n\n// >>> v6668-selection-groups\nregR('m6-partner-boost-grouped', (st, idx, iids, params, pool) => {\n  const { picked } = splitGroupedPick(iids, st.players[idx].hand, params as Record<string, unknown> | undefined, pool, 'hand-discard');\n  if (picked.length === 0) return addLog(st, '拍檔提升：未選擇能量', idx);\n  const targetIids = (params?.targetIids as string[]) ?? [];\n  return startEnergyChain(st, idx, picked, {\n    label: '拍檔提升', source: 'hand', scope: 'any-own', filterType: 'Any', targetIids,\n  }, pool);\n});\n// <<< v6668-selection-groups\n\n",
      "});\n\n"
    ],
    [
      "        targetIids: targets.map(t => t.iid),\n        groups: [{ label: '【火】', filter: 'BasicEnergyOf=Fire' }, { label: '【雷】', filter: 'BasicEnergyOf=Lightning' }],\n        titleOverride: '拍檔提升：從手牌選擇',\n        allowSkipZero: true,\n",
      "        targetIids: targets.map(t => t.iid),\n        titleOverride: '拍檔提升：選基本【火】／基本【雷】能量（各最多 1 張，接著選要附給哪隻）',\n        allowSkipZero: true,\n"
    ],
    [
      "      minCount: 0, maxCount: (fireIids.length > 0 ? 1 : 0) + (ltngIids.length > 0 ? 1 : 0),\n      effectKey: 'm6-partner-boost-grouped',   // ⭐v6.668（m6-partner-boost-pick 保留給舊 pending）\n    // v6.125 卡面：「…最多各1張，**以任意方式**附於自己的『電擊魔獸』或者『鴨嘴炎獸』身上。」→ 可 0 張\n",
      "      minCount: 0, maxCount: (fireIids.length > 0 ? 1 : 0) + (ltngIids.length > 0 ? 1 : 0),\n      effectKey: 'm6-partner-boost-pick',\n    // v6.125 卡面：「…最多各1張，**以任意方式**附於自己的『電擊魔獸』或者『鴨嘴炎獸』身上。」→ 可 0 張\n"
    ],
    [
      "      type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,\n      filter: 'Groups',   // ⭐v6.668 多組選擇：【火】【雷】同一個視窗、各最多 1 張（選滿變暗）\n      // ⚠ v6.083：maxCount 依「有幾種屬性」而非總張數 —— 卡面是「各最多 1 張」，\n",
      "      type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,\n      filter: 'Energy',\n      // ⚠ v6.083：maxCount 依「有幾種屬性」而非總張數 —— 卡面是「各最多 1 張」，\n"
    ],
    [
      "\nimport { regAByName, regR, addLog, updatePlayer, withPending, deckWithCardsToBottom, rejectAbilityUse, splitGroupedPick } from '../_shared';\nimport { startEnergyChain } from './v158_energy_chain'; // v6.081 「以任意方式附加」中央 chain\n",
      "\nimport { regAByName, regR, addLog, updatePlayer, withPending, deckWithCardsToBottom, rejectAbilityUse } from '../_shared';\nimport { startEnergyChain } from './v158_energy_chain'; // v6.081 「以任意方式附加」中央 chain\n"
    ]
  ],
  "src/lib/game/effects/cards/mega_decks.ts": [
    [
      "  });\n  // <<< v6668-selection-groups\n});\n",
      "  });\n});\n"
    ],
    [
      "  let s = discardHand(st, idx);\n  s = addLog(s, '青木的手法：丟棄所有手牌', idx);\n  // >>> v6668-selection-groups\n  // ⭐v6.668：三組同一個視窗自由選（aoki-phase1～3 保留給舊 pending）\n  return openGroupedDeckSearch(s, idx, {\n    label: '青木的手法',\n    groups: [\n      { label: '【寶可夢】', filter: 'PokemonCard' },\n      { label: '【支援者】', filter: 'Supporter' },\n      { label: '【基本能量】', filter: 'BasicEnergy' },\n    ],\n  });\n",
      "  let s = discardHand(st, idx);\n  s = addLog(s, '青木的手法：丟棄所有手牌，依序搜尋 1 寶可夢 / 1 支援者 / 1 基本能量', idx);\n  return withPending(s, {\n    type: 'deck-search',\n    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Pokemon',\n    minCount: 0, maxCount: 1,\n    effectKey: 'aoki-phase1',\n  });\n"
    ],
    [
      "  addLog, addPrivateLog, updatePlayer, withPending, shuffle, discardHand,\n  healResolver, getAllAttachedTools, joinCardNames, rejectAbilityUse, openGroupedDeckSearch } from '../_shared';\nimport {\n",
      "  addLog, addPrivateLog, updatePlayer, withPending, shuffle, discardHand,\n  healResolver, getAllAttachedTools, joinCardNames, rejectAbilityUse } from '../_shared';\nimport {\n"
    ]
  ],
  "src/lib/game/effects/cards/v158_energy_chain.ts": [
    [
      "  if (validTargets.length === 0) {\n    // >>> v6668-hand-chain-no-target\n    // ⭐v6.668（審查 P2-1）：來源是手牌而場上沒有可以附的目標（例如全被詛咒根鎖住）⇒ 能量退回手牌。\n    //   卡面是「從手牌選擇…附於」，附不上就什麼都不發生；原本會把手牌的能量丟進棄牌區（卡片平白損失）。\n    if (source === 'hand') {\n      const back = new Set(energyIids);\n      st = updatePlayer(st, aIdx, p => ({\n        ...p,\n        hand: [...p.hand, ...p.discard.filter(c => back.has(c.iid))],\n        discard: p.discard.filter(c => !back.has(c.iid)),\n      }));\n      return addLog(st, `${label}：場上沒有可以附加的寶可夢，${energyIids.length} 張能量留在手牌`, aIdx);\n    }\n    // <<< v6668-hand-chain-no-target\n    // 場上無合法目標 → 能量留在 discard\n",
      "  if (validTargets.length === 0) {\n    // 場上無合法目標 → 能量留在 discard\n"
    ]
  ],
  "src/lib/game/effects/cards/v169_supporters.ts": [
    [
      "  });\n  // <<< v6668-selection-groups\n});\n",
      "  });\n});\n"
    ],
    [
      "  if (top7.length === 0) return addLog(st, '杜若：牌庫為空', idx);\n  st = addLog(st, `杜若：查看牌庫上方 ${top7.length} 張`, idx);\n  // >>> v6668-selection-groups\n  // ⭐v6.668：兩組同一個視窗自由選（只限上方 7 張；tora-pokemon／tora-trainer 保留給舊 pending）\n  return openGroupedDeckSearch(st, idx, {\n    label: '杜若',\n    groups: [\n      { label: '【寶可夢】', filter: 'PokemonCard' },\n      { label: '【訓練家】', filter: 'Trainer' },\n    ],\n    topIids: top7.map(c => c.iid),\n  });\n",
      "  if (top7.length === 0) return addLog(st, '杜若：牌庫為空', idx);\n  st = addLog(st, `杜若：查看牌庫上方 ${top7.length} 張，選 1 寶可夢加手（可跳過）`, idx);\n  return withPending(st, {\n    type: 'deck-search',\n    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Pokemon:TOP_N',\n    minCount: 0, maxCount: 1,\n    effectKey: 'tora-pokemon',\n    params: { topIids: top7.map(c => c.iid) },\n  });\n"
    ],
    [
      "  getOwnBenchLimit, isOwnFirstTurn,\n  deckWithCardsToBottom, openGroupedDeckSearch,\n} from '../_shared';\n",
      "  getOwnBenchLimit, isOwnFirstTurn,\n  deckWithCardsToBottom,\n} from '../_shared';\n"
    ]
  ],
  "src/lib/game/effects/cards/v2996_g4_wave2.ts": [
    [
      "});\n// >>> v6668-selection-groups\nregR('flame-dance-grouped', (st, idx, iids, params, pool) => {\n  const { picked } = splitGroupedPick(iids, st.players[idx].hand, params as Record<string, unknown> | undefined, pool, 'hand-discard');\n  if (picked.length === 0) return addLog(st, '火焰蹈舞：未選擇能量', idx);\n  return startEnergyChain(st, idx, picked, { label: '火焰蹈舞', source: 'hand', scope: 'any-own', filterType: 'Any' }, pool);\n});\n// <<< v6668-selection-groups\n// 第一階段 → 若有選【火】，先開附著 picker；無論選或不選，都串到第二階段【鬥】\n",
      "});\n// 第一階段 → 若有選【火】，先開附著 picker；無論選或不選，都串到第二階段【鬥】\n"
    ],
    [
      "  });\n  // <<< v6668-selection-groups\n});\n",
      "  });\n});\n"
    ],
    [
      "    actorIdx: idx, sourcePlayerIdx: idx,\n    filter: 'Groups',\n    minCount: 0, maxCount: (has('Fire') ? 1 : 0) + (has('Fighting') ? 1 : 0),\n    effectKey: 'flame-dance-grouped',\n    params: { groups, titleOverride: '火焰蹈舞：從手牌選擇', allowSkipZero: true },\n  });\n",
      "    actorIdx: idx, sourcePlayerIdx: idx,\n    minCount: 0, maxCount: fireIids.length > 0 ? 1 : 0,\n    effectKey: 'flame-dance-pick-fire',\n    params: { validIids: fireIids },\n  });\n"
    ],
    [
      "  const s = addLog(st, '火焰蹈舞：從手牌選擇基本【火】能量與基本【鬥】能量最多各 1 張', idx);\n  return withPending(s, {\n    type: 'hand-discard',\n    actorIdx: idx, sourcePlayerIdx: idx,\n    minCount: 0, maxCount: fireIids.length > 0 ? 1 : 0,\n",
      "  const s = addLog(st, '火焰蹈舞：從手牌選擇基本【火】能量與基本【鬥】能量最多各 1 張', idx);\n  return withPending(s, {\n    type: 'hand-choose',\n    actorIdx: idx, sourcePlayerIdx: idx,\n    minCount: 0, maxCount: fireIids.length > 0 ? 1 : 0,\n"
    ],
    [
      "  const p = st.players[idx];\n  const groups = [{ label: '【火】', filter: 'BasicEnergyOf=Fire' }, { label: '【鬥】', filter: 'BasicEnergyOf=Fighting' }];\n  const has = (t: 'Fire' | 'Fighting') => p.hand.some(c => isBasicEnergyOfType(pool.get(c.cardId), t));\n  const s = addLog(st, '火焰蹈舞：從手牌選擇基本【火】能量與基本【鬥】能量最多各 1 張', idx);\n  return withPending(s, {\n",
      "  const p = st.players[idx];\n  // 開第一階段：選【火】基本能量（最多 1 張，可不選）\n  const fireIids = p.hand\n    .filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Fire'))\n    .map(c => c.iid);\n  const s = addLog(st, '火焰蹈舞：選擇要附加的「基本【火】能量」（最多 1 張，可跳過）', idx);\n  return withPending(s, {\n"
    ],
    [
      "regA('烈焰猴', 0, (st, idx, pool, _cardInst) => {\n  // >>> v6668-selection-groups\n  // ⭐v6.668：【火】【鬥】同一個視窗自由選（最多各 1 張），選完逐張選要附給哪隻（中央 startEnergyChain：「以任意方式」）。\n  //   flame-dance-pick-fire／attach-fire／pick-fight 保留給部署當下還停在舊 pending 的對局。\n  //   使用條件（手牌有基本【火】或基本【鬥】能量）在 engine getUsableAbilities。\n  const p = st.players[idx];\n",
      "regA('烈焰猴', 0, (st, idx, pool, _cardInst) => {\n  const p = st.players[idx];\n"
    ],
    [
      "import { buildDevolvedInstance } from '../_shared'; // v5.984 中央退化建構\nimport { splitGroupedPick } from '../_shared'; // ⭐v6.668 多組選擇拆組\nimport { startEnergyChain } from './v158_energy_chain'; // ⭐v6.668 「以任意方式附於」中央 chain\nimport { canApplyEffectToTarget } from '../../defense'; // v5.984 特性效果免疫 gate(化隱/對戰圓形)\n",
      "import { buildDevolvedInstance } from '../_shared'; // v5.984 中央退化建構\nimport { canApplyEffectToTarget } from '../../defense'; // v5.984 特性效果免疫 gate(化隱/對戰圓形)\n"
    ]
  ],
  "src/lib/game/engine.ts": [
    [
      "        if (!hasFireOrFight) return;\n        // >>> v6668-hand-chain-no-target\n        // ⭐v6.668（審查 P2-1）：自己場上至少要有一隻可以從手牌附能的寶可夢（全被詛咒根鎖住 ⇒ 效果完全無法執行 ⇒ 不能按，判準①）\n        if (![player.active, ...player.bench].some(c => !!c && !c.cantAttachEnergyThisTurn)) return;\n        // <<< v6668-hand-chain-no-target\n      }\n",
      "        if (!hasFireOrFight) return;\n      }\n"
    ],
    [
      "  }\n  // ⭐v6.668 沒傳 pool 的舊呼叫端：多組選擇照樣夾總數（不分組也不可以超過上限）\n  if (isGroupsFilter(f) && typeof pending.maxCount === 'number') return out.slice(0, Math.max(0, pending.maxCount));\n  return out;\n",
      "  }\n  return out;\n"
    ],
    [
      "      .filter((c): c is CardInstance => !!c);\n    // >>> v6668-selection-groups\n    // ⭐v6.668 多組選擇（params.groups）的「每組最多 N 張」也在這裡收（同一個 sanitizeSelectionSet）⇒ 要傳 params\n    const _setClean = sanitizeSelectionSet('deck-search', f, insts, pool, { params: pending.params as Record<string, unknown> | undefined });\n    //   多組選擇上面沒有先夾總數（先分組再夾），這裡補夾\n    return isGroupsFilter(f) && typeof pending.maxCount === 'number' ? _setClean.slice(0, Math.max(0, pending.maxCount)) : _setClean;\n    // <<< v6668-selection-groups\n  }\n",
      "      .filter((c): c is CardInstance => !!c);\n    return sanitizeSelectionSet('deck-search', f, insts, pool);\n  }\n"
    ],
    [
      "    // ⭐v6.644：先判上限再收（原本先 push 再比 ⇒ maxCount 0 的「只能檢視」牌庫搜尋照樣收 1 張，可從牌庫拿走 1 張卡）\n    if (typeof pending.maxCount === 'number' && out.length >= pending.maxCount && !isGroupsFilter(pending.filter)) break;   // ⭐v6.668 多組選擇先分組再夾總數（見下方）\n    // <<< v6644-sanitize-cap-first\n",
      "    // ⭐v6.644：先判上限再收（原本先 push 再比 ⇒ maxCount 0 的「只能檢視」牌庫搜尋照樣收 1 張，可從牌庫拿走 1 張卡）\n    if (typeof pending.maxCount === 'number' && out.length >= pending.maxCount) break;\n    // <<< v6644-sanitize-cap-first\n"
    ],
    [
      "    }\n    // >>> v6668-selection-groups\n    // ⭐v6.668 從手牌「最多各 1 張」（filter 'Groups'）：同一份每組上限（首見保留）\n    if (pool && isGroupsFilter(pending.filter)) {\n      const instsH = outH.map(iid => p.hand.find(c => c.iid === iid)).filter((c): c is CardInstance => !!c);\n      //   先分組再夾總數：[火,火,鬥] 不可以先被夾成 [火,火] 再分組成只剩 [火]（鬥被誤丟）\n      const grouped = sanitizeSelectionSet('hand-discard', pending.filter ?? '', instsH, pool, { params: pending.params as Record<string, unknown> | undefined });\n      return typeof pending.maxCount === 'number' ? grouped.slice(0, Math.max(0, pending.maxCount)) : grouped;\n    }\n    // 沒傳 pool 的舊呼叫端：照樣夾總數（與牌庫分支對稱，審查 P3-2）\n    if (isGroupsFilter(pending.filter) && typeof pending.maxCount === 'number') return outH.slice(0, Math.max(0, pending.maxCount));\n    // <<< v6668-selection-groups\n    return outH;\n",
      "    }\n    return outH;\n"
    ],
    [
      "      // ⭐v6.644：先判上限再收（原本先 push 再比 ⇒ maxCount 0 的「只能檢視」照樣收 1 張）\n      if (typeof pending.maxCount === 'number' && outH.length >= pending.maxCount && !isGroupsFilter(pending.filter)) break;   // ⭐v6.668 多組選擇先分組再夾總數（見下方）\n      // <<< v6644-sanitize-cap-first\n",
      "      // ⭐v6.644：先判上限再收（原本先 push 再比 ⇒ maxCount 0 的「只能檢視」照樣收 1 張）\n      if (typeof pending.maxCount === 'number' && outH.length >= pending.maxCount) break;\n      // <<< v6644-sanitize-cap-first\n"
    ],
    [
      "// v6.018 批5：4 卡片述詞 helper + ZH_ENERGY_TYPE 下沉 selection-filter.ts（解循環）；engine re-export 給既有 importer\nimport { isBasicPokemonCard, isBasicPokemonOnField, isRulePokemon, isPokemonExCard, isRuleBoxExOrV, isBasicEnergyOfType, getBasicEnergyType, isMegaExCard, ZH_ENERGY_TYPE, evaluateSelectionFilter, isKnownSelectionFilter, sanitizeSelectionSet, isGroupsFilter } from './selection-filter';\n// v6.176：場上目標型 picker 的候選述詞（UI 與中央消毒閘共用同一份，見 selection-candidates.ts）\n",
      "// v6.018 批5：4 卡片述詞 helper + ZH_ENERGY_TYPE 下沉 selection-filter.ts（解循環）；engine re-export 給既有 importer\nimport { isBasicPokemonCard, isBasicPokemonOnField, isRulePokemon, isPokemonExCard, isRuleBoxExOrV, isBasicEnergyOfType, getBasicEnergyType, isMegaExCard, ZH_ENERGY_TYPE, evaluateSelectionFilter, isKnownSelectionFilter, sanitizeSelectionSet } from './selection-filter';\n// v6.176：場上目標型 picker 的候選述詞（UI 與中央消毒閘共用同一份，見 selection-candidates.ts）\n"
    ]
  ],
  "src/lib/game/selection-candidates.ts": [
    [
      "  if (isKnownSelectionFilter('hand-discard', f)) {\n    out = out.filter(c => evaluateSelectionFilter('hand-discard', f, c, pool?.get(c.cardId), { params }) !== false);   // ⭐v6.668 傳 params（多組選擇 'Groups' 讀 params.groups；其他手牌述詞不讀 ctx）\n  }\n",
      "  if (isKnownSelectionFilter('hand-discard', f)) {\n    out = out.filter(c => evaluateSelectionFilter('hand-discard', f, c, pool?.get(c.cardId), {}) !== false);\n  }\n"
    ]
  ],
  "src/lib/game/selection-filter.ts": [
    [
      "}\n\n// >>> v6668-selection-groups\n/**\n * ⭐v6.668「從牌庫（手牌）選擇 A 卡與 B 卡各 1 張」的多組選擇 —— 判準唯一一份。\n *   玩家建議：小光原本依「基礎 → 1階 → 2階」逐段選，前面選了就不能改 ⇒ 改成同一個視窗自由選，\n *   某組選滿後同組其他卡變暗（再點已選的卡可取消）。\n *   pending.filter ＝ 'Groups'（牌庫／手牌）或 'Groups:TOP_N'（牌庫上方 N 張，杜若），\n *   pending.params.groups ＝ [{ label: '【基礎】', filter: 'Basic', max?: 1 }, …]\n *   ・組內 filter 一律是「只看卡片本身」的 deck-search 述詞（Basic／Stage1／Energy／BasicEnergyOf=Fire…），\n *     沒收錄（回 null）視為不符合 ⇒ fail-closed，不會多給。\n *   ・一張卡屬於「第一個符合的組」（現行 10 張卡的各組互斥，順序不影響結果）。\n *   ・每組下限都是 0：帶條件的搜尋可以宣告找不到（PTCG_RULES L832）；手牌附能卡面是「最多各 1 張」。\n */\nexport interface SelectionGroup { label: string; filter: string; max?: number }\n\nexport function isGroupsFilter(filter: string | undefined | null): boolean {\n  return filter === 'Groups' || filter === 'Groups:TOP_N';\n}\n\n/** 從 pending.params 讀出組別（格式不對的條目丟掉；組內不可再是 Groups，避免遞迴）。 */\nexport function readSelectionGroups(params: Record<string, unknown> | undefined | null): SelectionGroup[] {\n  const raw = params?.groups;\n  if (!Array.isArray(raw)) return [];\n  const out: SelectionGroup[] = [];\n  for (const g of raw) {\n    if (!g || typeof g !== 'object') continue;\n    const { label, filter, max } = g as { label?: unknown; filter?: unknown; max?: unknown };\n    if (typeof filter !== 'string' || filter.length === 0 || filter.startsWith('Groups')) continue;\n    out.push({ label: typeof label === 'string' ? label : filter, filter, ...(typeof max === 'number' ? { max } : {}) });\n  }\n  return out;\n}\n\n/** 一組最多幾張（沒寫＝1；負數或非整數夾成 0 以上的整數）。 */\nexport function groupMax(g: SelectionGroup): number {\n  return typeof g.max === 'number' && Number.isFinite(g.max) ? Math.max(0, Math.floor(g.max)) : 1;\n}\n\n/** 全部組別加起來最多幾張（＝pending.maxCount 的上限）。 */\nexport function groupsTotalMax(groups: ReadonlyArray<SelectionGroup>): number {\n  return groups.reduce((n, g) => n + groupMax(g), 0);\n}\n\n/** 這張卡屬於第幾組；不屬於任何組 ⇒ -1。 */\nexport function selectionGroupIndex(groups: ReadonlyArray<SelectionGroup>, inst: { iid: string }, card: Card | undefined): number {\n  if (!card) return -1;\n  for (let i = 0; i < groups.length; i++) {\n    if (evaluateSelectionFilter('deck-search', groups[i].filter, inst, card, {}) === true) return i;\n  }\n  return -1;\n}\n\n/** 已勾選的卡在各組各佔幾張（UI 的組別計數與「選滿變暗」用）。 */\nexport function selectionGroupCounts(\n  groups: ReadonlyArray<SelectionGroup>,\n  picked: ReadonlyArray<{ iid: string; cardId: string }>,\n  pool: Map<string, Card>,\n): number[] {\n  const used = groups.map(() => 0);\n  for (const it of picked) {\n    const gi = selectionGroupIndex(groups, it, pool.get(it.cardId));\n    if (gi >= 0) used[gi]++;\n  }\n  return used;\n}\n\n/** UI：這張（尚未勾選的）卡現在能不能點 —— 它那一組已經選滿 ⇒ 不能點（變暗）。已勾選的卡永遠可以點（取消）。 */\nexport function selectionGroupBlocked(\n  groups: ReadonlyArray<SelectionGroup>,\n  counts: ReadonlyArray<number>,\n  item: { iid: string; cardId: string },\n  pool: Map<string, Card>,\n): boolean {\n  const gi = selectionGroupIndex(groups, item, pool.get(item.cardId));\n  if (gi < 0) return true;\n  return (counts[gi] ?? 0) >= groupMax(groups[gi]);\n}\n// <<< v6668-selection-groups\n",
      "}\n"
    ],
    [
      "): string[] {\n  // >>> v6668-selection-groups\n  // ⭐v6.668 多組選擇：每組最多 max 張（首見保留）、不屬於任何組的濾掉。UI／AI／engine 消毒閘都走這裡。\n  if (isGroupsFilter(filter)) {\n    const groups = readSelectionGroups(ctx.params);\n    const used = groups.map(() => 0);\n    const out: string[] = [];\n    for (const it of insts) {\n      const gi = selectionGroupIndex(groups, it, pool.get(it.cardId));\n      if (gi < 0 || used[gi] >= groupMax(groups[gi])) continue;\n      used[gi]++; out.push(it.iid);\n    }\n    return out;\n  }\n  // <<< v6668-selection-groups\n  if (zone === 'deck-search' && filter === 'BasicEnergy:DistinctTypes') {\n",
      "): string[] {\n  if (zone === 'deck-search' && filter === 'BasicEnergy:DistinctTypes') {\n"
    ],
    [
      "  pool: Map<string, Card>,\n  ctx: SelectionFilterCtx = {},\n): string[] {\n",
      "  pool: Map<string, Card>,\n): string[] {\n"
    ],
    [
      "    }\n    // >>> v6668-selection-groups\n    // ⭐v6.668 組內用：基本【X】能量（BasicEnergyOf=Fire）。走 isBasicEnergyOfType（基本能量 pokemonType 恒 null，從卡名【X】判）\n    if (filter.startsWith('BasicEnergyOf=')) return isBasicEnergyOfType(card, filter.slice('BasicEnergyOf='.length) as EnergyType);\n    // <<< v6668-selection-groups\n    if (filter.startsWith('Card:')) return card.name === filter.slice(5);\n",
      "    }\n    if (filter.startsWith('Card:')) return card.name === filter.slice(5);\n"
    ],
    [
      "  'Pokemon:Name=', 'Pokemon:Names=', 'NameContains:', 'Card:', 'Basic:NamePrefix=',\n  'Tool:NameContains=', 'Stage1Or2:', 'BasicEnergyOf='] as const;\n\n",
      "  'Pokemon:Name=', 'Pokemon:Names=', 'NameContains:', 'Card:', 'Basic:NamePrefix=',\n  'Tool:NameContains=', 'Stage1Or2:'] as const;\n\n"
    ],
    [
      "  'Item':                (c) => c.supertype === 'Trainer' && c.subtype === 'Item',\n  // >>> v6668-selection-groups\n  // ⭐v6.668 從手牌「最多各 1 張」（烈焰猴｜火焰蹈舞、鴨嘴炎獸｜拍檔提升）：同一份組別判準\n  'Groups':              (c, ctx) => selectionGroupIndex(readSelectionGroups(ctx.params), { iid: '' }, c) >= 0,\n  // <<< v6668-selection-groups\n};\n",
      "  'Item':                (c) => c.supertype === 'Trainer' && c.subtype === 'Item',\n};\n"
    ],
    [
      "  // <<< v6644-top-reveal-filter\n  // >>> v6668-selection-groups\n  // ⭐v6.668「各選 1 張」多組選擇（小光／鬥子／秘密箱…）：同一個選擇視窗裡自由選，判準在下方 selectionGroupIndex（唯一一份）。\n  //   'Groups'＝候選是「符合任一組」的卡；'Groups:TOP_N'＝再限定在牌庫上方 N 張（params.topIids，杜若）。\n  'Groups': (c, ctx, inst) => selectionGroupIndex(readSelectionGroups(ctx.params), inst, c) >= 0,\n  'Groups:TOP_N': (c, ctx, inst) => inTopParam(ctx, 'topIids', inst) && selectionGroupIndex(readSelectionGroups(ctx.params), inst, c) >= 0,\n  // 組內用的單卡述詞：「寶可夢卡」（不限階段、不讀 validIids）\n  'PokemonCard': (c) => c.supertype === 'Pokemon',\n  // <<< v6668-selection-groups\n  // <<< v6543-top-filters-central\n",
      "  // <<< v6644-top-reveal-filter\n  // <<< v6543-top-filters-central\n"
    ]
  ],
  "src/lib/game/selection-ui.ts": [
    [
      "  'lucky-gift-opp',                // 信使鳥｜幸福禮物（對手階段）：若希望\n  // ⭐v6.668 移除 'flame-dance-pick-fire'：烈焰猴｜火焰蹈舞改走多組選擇（flame-dance-grouped，params.allowSkipZero 逐卡宣告），\n  //   沒有任何 withPending 再開這個 key（test-v6125 ④ 死條目）。regR 相容別名仍保留（舊 pending 走得完）。\n  //   'flame-dance-pick-fight' 仍由舊鏈的第二段 openFlameDanceFightStage 開出 ⇒ 保留。\n  'flame-dance-pick-fight',        // 烈焰猴｜火焰蹈舞（鬥側）\n",
      "  'lucky-gift-opp',                // 信使鳥｜幸福禮物（對手階段）：若希望\n  'flame-dance-pick-fire',         // 烈焰猴｜火焰蹈舞：最多各1、任意方式\n  'flame-dance-pick-fight',        // 烈焰猴｜火焰蹈舞（鬥側）\n"
    ]
  ],
  "src/lib/version.ts": [
    [
      " */\nexport const VERSION = '6.668';\n",
      " */\nexport const VERSION = '6.667';\n"
    ]
  ],
  "src/routes/game/+page.svelte": [
    [
      "  .sel-card-wrap.bd-disabled .sel-card:hover{ border-color:#3a3a3a; box-shadow:none; }\n  /* ⭐v6.668 多組選擇：卡片左上角的組別標籤＋提示列的組別計數 */\n  .sel-grp-tag{ position:absolute; top:3px; left:3px; z-index:1; font-size:.62rem; line-height:1.2; padding:1px 4px; border-radius:4px;\n    background:rgba(10,20,40,.85); color:#ffd54a; border:1px solid rgba(255,213,74,.55); pointer-events:none; white-space:nowrap; }\n  .sel-grp-chip{ display:inline-block; font-size:.72rem; padding:0 6px; margin:0 3px 2px 0; border-radius:8px; border:1px solid #4a5a7a; color:#cfd8ea; }\n  .sel-grp-chip.sel-grp-full{ border-color:#5aa86a; color:#9be0a8; }\n  .sel-zoom{ position:absolute; top:.2rem; right:.2rem; z-index:2; background:rgba(0,0,0,.72); border:1px solid #6aaa6a; color:#cfc; font-size:.7rem; line-height:1; padding:.18rem .32rem; border-radius:4px; cursor:pointer; }\n",
      "  .sel-card-wrap.bd-disabled .sel-card:hover{ border-color:#3a3a3a; box-shadow:none; }\n  .sel-zoom{ position:absolute; top:.2rem; right:.2rem; z-index:2; background:rgba(0,0,0,.72); border:1px solid #6aaa6a; color:#cfc; font-size:.7rem; line-height:1; padding:.18rem .32rem; border-radius:4px; cursor:pointer; }\n"
    ],
    [
      "                    {:else}\n                      {#if _grpLabel}<span class=\"sel-grp-tag\">{_grpLabel}</span>{/if}\n                      <img use:retryImg={c.imageUrl} src={cardThumb(c.imageUrl)} alt={c.name} loading=\"lazy\"\n",
      "                    {:else}\n                      <img use:retryImg={c.imageUrl} src={cardThumb(c.imageUrl)} alt={c.name} loading=\"lazy\"\n"
    ],
    [
      "                  <button class=\"sel-card\" disabled={_bdDisabled}\n                    title={_bdDisabled && pendingSelection.effectKey === 'brocks-dig-unified' ? '依小剛的發掘規則，此卡目前不可選（Basic+Evolution 不可混選；Evolution 最多 1）' : ''}\n                    onclick={()=>toggleSelection(item.iid)}>\n",
      "                  <button class=\"sel-card\" disabled={_bdDisabled}\n                    title={_bdDisabled ? '依小剛的發掘規則，此卡目前不可選（Basic+Evolution 不可混選；Evolution 最多 1）' : ''}\n                    onclick={()=>toggleSelection(item.iid)}>\n"
    ],
    [
      "              {#if c || concealed}\n                {@const _bdDisabled = isBrocksDigDisabled(item) || isFishnetDisabled(item) || isGroupPickDisabled(item)}\n                {@const _grpLabel = selGroupLabel(item)}\n                <div class=\"sel-card-wrap\" class:sel-picked={selectionPicked.has(item.iid)} class:sel-concealed={concealed} class:bd-disabled={_bdDisabled}>\n",
      "              {#if c || concealed}\n                {@const _bdDisabled = isBrocksDigDisabled(item) || isFishnetDisabled(item)}\n                <div class=\"sel-card-wrap\" class:sel-picked={selectionPicked.has(item.iid)} class:sel-concealed={concealed} class:bd-disabled={_bdDisabled}>\n"
    ],
    [
      "              選 {pendingSelection.minCount===pendingSelection.maxCount?`${pendingSelection.minCount}`:`${pendingSelection.minCount}～${pendingSelection.maxCount}`} 張\n              {#if selGroups}{#each selGroups as g, gi}<span class=\"sel-grp-chip\" class:sel-grp-full={(selGroupCounts[gi] ?? 0) >= groupMax(g)}>{g.label} {selGroupCounts[gi] ?? 0}/{groupMax(g)}</span>{/each}\n              {:else if pendingSelection.filter&&pendingSelection.filter!=='TOP6'&&!pendingSelection.filter.startsWith('Supporter')}（{describeFilter(pendingSelection.filter)}）{/if}\n              · 已選 {selectionPicked.size}{#if selectedNamesLabel}：<b class=\"sel-picked-names\">{selectedNamesLabel}</b>{/if}\n",
      "              選 {pendingSelection.minCount===pendingSelection.maxCount?`${pendingSelection.minCount}`:`${pendingSelection.minCount}～${pendingSelection.maxCount}`} 張\n              {#if pendingSelection.filter&&pendingSelection.filter!=='TOP6'&&!pendingSelection.filter.startsWith('Supporter')}（{describeFilter(pendingSelection.filter)}）{/if}\n              · 已選 {selectionPicked.size}{#if selectedNamesLabel}：<b class=\"sel-picked-names\">{selectedNamesLabel}</b>{/if}\n"
    ],
    [
      "    }\n    // >>> v6668-selection-groups\n    if (selGroups) {\n      const item = selectionItems.find(it => it.iid === iid);\n      if (item && isGroupPickDisabled(item)) return;\n    }\n    // <<< v6668-selection-groups\n    const next = new Set(selectionPicked);\n",
      "    }\n    const next = new Set(selectionPicked);\n"
    ],
    [
      "    }\n    // >>> v6668-selection-groups\n    if (selGroups && selGroupCounts.some((n, i) => n > groupMax(selGroups[i]))) return false;\n    // <<< v6668-selection-groups\n    if (pendingSelection.type === 'damage-distribute') {\n",
      "    }\n    if (pendingSelection.type === 'damage-distribute') {\n"
    ],
    [
      "  }\n  // >>> v6668-selection-groups\n  // ⭐v6.668 多組選擇（小光／鬥子／秘密箱…「各選 1 張」）：判準全在 selection-filter（selectionGroupIndex／selectionGroupBlocked）。\n  //   這裡只把「目前勾了哪些」交給它算：每組幾張、哪張要變暗。\n  const selGroups = $derived(pendingSelection && isGroupsFilter(pendingSelection.filter)\n    ? readSelectionGroups(pendingSelection.params as Record<string, unknown> | undefined) : null);\n  const selGroupCounts = $derived.by(() => {\n    if (!selGroups) return [] as number[];\n    return selectionGroupCounts(selGroups, selectionItems.filter(it => selectionPicked.has(it.iid)), pool);\n  });\n  function isGroupPickDisabled(item: CardInstance): boolean {\n    if (!selGroups) return false;\n    if (selectionPicked.has(item.iid)) return false;   // 已選 → 允許取消\n    return selectionGroupBlocked(selGroups, selGroupCounts, item, pool);\n  }\n  function selGroupLabel(item: CardInstance): string {\n    if (!selGroups) return '';\n    const gi = selectionGroupIndex(selGroups, item, pool.get(item.cardId));\n    return gi >= 0 ? selGroups[gi].label : '';\n  }\n  // <<< v6668-selection-groups\n  // damage-distribute 本批次加總的 counter 數（= 各 iid 的 count 之和）\n",
      "  }\n  // damage-distribute 本批次加總的 counter 數（= 各 iid 的 count 之和）\n"
    ],
    [
      "  import { evaluateSelectionFilter, isKnownSelectionFilter, isMegaExCard, isPokemonExCard,\n           isBasicEnergyOfType as isBasicEnergyOfTypeCentral,\n           isGroupsFilter, readSelectionGroups, selectionGroupCounts, selectionGroupBlocked, selectionGroupIndex, groupMax } from '$lib/game/selection-filter';   // ⭐v6.668 多組選擇\n  import { selfCheckAbilityRegistry } from '$lib/game/effects/_shared';\n",
      "  import { evaluateSelectionFilter, isKnownSelectionFilter, isMegaExCard, isPokemonExCard,\n           isBasicEnergyOfType as isBasicEnergyOfTypeCentral } from '$lib/game/selection-filter';\n  import { selfCheckAbilityRegistry } from '$lib/game/effects/_shared';\n"
    ]
  ],
  "static/changelog-archive.html": [
    [
      "<details>\n        <summary><span class=\"ver-badge\">v6.626</span> <b>修正公開牌組分享資訊與熱門統計</b><br>改善牌組分享資訊、熱門統計可靠性與手機版顯示。</summary>\n        <div class=\"log-body\"><p>修正分享頁的牌組名稱、筆記與卡圖；合併並行統計查詢，避免短暫故障造成錯誤統計快取，並穩定手機與桌機排行顯示。</p></div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.622</span> <b>抽牌飛入手牌動畫、我方重抽手牌揭示、修正手機起手設置畫面下推</b><br>自己抽牌在中央翻開後會往下飛入手牌；起手無基礎寶可夢重抽時自己也能查看那 7 張牌；修正手機版起手設置結束時畫面往下跳動。</summary>\n",
      "<details>\n        <summary><span class=\"ver-badge\">v6.622</span> <b>抽牌飛入手牌動畫、我方重抽手牌揭示、修正手機起手設置畫面下推</b><br>自己抽牌在中央翻開後會往下飛入手牌；起手無基礎寶可夢重抽時自己也能查看那 7 張牌；修正手機版起手設置結束時畫面往下跳動。</summary>\n"
    ]
  ],
  "static/changelog-bodies.html": [
    [
      "<div class=\"log-body\" data-ver=\"v6.629\">手機與電腦、淺色與深色模式的「＋ 投稿牌組」按鈕統一使用森林綠底白字，讓文字更清楚。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n",
      "<div class=\"log-body\" data-ver=\"v6.629\">手機與電腦、淺色與深色模式的「＋ 投稿牌組」按鈕統一使用森林綠底白字，讓文字更清楚。</div>\n<div class=\"log-body\" data-ver=\"v6.626\"><p>修正分享頁的牌組名稱、筆記與卡圖；合併並行統計查詢，避免短暫故障造成錯誤統計快取，並穩定手機與桌機排行顯示。</p></div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n"
    ],
    [
      "<div class=\"log-body\" data-ver=\"v6.655\"><ul><li><b>統一對戰座位解析</b>：對戰頁雙方頭像預載與名片點擊改由 <code>resolveBattleSeatTarget()</code> 統一解析，錦標賽回放依 <code>matchId</code>、觀戰依實際觀戰房號、正式對戰依真實場次查詢，一般對戰本地復盤顯示本地紀錄名片而不誤查預設房。</li><li><b>後端與測試房雙重防呆</b>：測試房僅當下具備真實玩家 UID 時才查詢對應名片，後端同步阻斷讀取預設測試房殘留座位並優先以驗證報名的賽事紀錄解析帳號，避免 P1 固定顯示管理員名片。</li></ul></div>\n<div class=\"log-body\" data-ver=\"v6.654\"><ul><li><b>對戰中頭像與名片</b>：電腦版與手機直式對戰畫面的「先攻／後攻」旁新增雙方玩家小頭像，點選即可開啟該玩家名片與申請好友。</li><li><b>名片預覽與收合</b>：名片設定右上新增「🪪 名片」鈕可即時預覽自己的名片；錦標賽「🪪 個人」分頁的名片設定支援「▲ 收合設定／▼ 展開設定」並記住狀態，設定好後可折起節省版面。</li><li><b>全卡池搜尋頭像</b>：官方卡牌圓圈頭像「依卡包／卡名」下拉選單最上方新增「ALL 全部卡牌」，打開後直接輸入卡名就能從全卡池搜尋，不必先猜卡包。</li></ul></div>\n",
      "<div class=\"log-body\" data-ver=\"v6.654\"><ul><li><b>對戰中頭像與名片</b>：電腦版與手機直式對戰畫面的「先攻／後攻」旁新增雙方玩家小頭像，點選即可開啟該玩家名片與申請好友。</li><li><b>名片預覽與收合</b>：名片設定右上新增「🪪 名片」鈕可即時預覽自己的名片；錦標賽「🪪 個人」分頁的名片設定支援「▲ 收合設定／▼ 展開設定」並記住狀態，設定好後可折起節省版面。</li><li><b>全卡池搜尋頭像</b>：官方卡牌圓圈頭像「依卡包／卡名」下拉選單最上方新增「ALL 全部卡牌」，打開後直接輸入卡名就能從全卡池搜尋，不必先猜卡包。</li></ul></div>\n"
    ]
  ],
  "static/changelog.html": [
    [
      "      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n",
      "      </details>\n      <details data-ver=\"v6.626\">\n        <summary><span class=\"ver-badge\">v6.626</span> <b>修正公開牌組分享資訊與熱門統計</b><br>改善牌組分享資訊、熱門統計可靠性與手機版顯示。</summary>\n      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n"
    ],
    [
      "        <summary><span class=\"ver-badge\">v6.655</span> <b>修正錦標賽對戰與回放點選 P1 頭像／名片誤載入管理員帳號的問題</b><br>錦標賽觀戰與回放改依實際場次與觀戰房號解析雙方玩家名片，測試房不再讀取預設殘留的 P1 管理員紀錄。</summary>\n      </details>\n",
      "        <summary><span class=\"ver-badge\">v6.655</span> <b>修正錦標賽對戰與回放點選 P1 頭像／名片誤載入管理員帳號的問題</b><br>錦標賽觀戰與回放改依實際場次與觀戰房號解析雙方玩家名片，測試房不再讀取預設殘留的 P1 管理員紀錄。</summary>\n        <div class=\"log-body\"><ul><li><b>統一對戰座位解析</b>：對戰頁雙方頭像預載與名片點擊改由 <code>resolveBattleSeatTarget()</code> 統一解析，錦標賽回放依 <code>matchId</code>、觀戰依實際觀戰房號、正式對戰依真實場次查詢，一般對戰本地復盤顯示本地紀錄名片而不誤查預設房。</li><li><b>後端與測試房雙重防呆</b>：測試房僅當下具備真實玩家 UID 時才查詢對應名片，後端同步阻斷讀取預設測試房殘留座位並優先以驗證報名的賽事紀錄解析帳號，避免 P1 固定顯示管理員名片。</li></ul></div>\n      </details>\n"
    ],
    [
      "      </details>\n      <details data-ver=\"v6.655\">\n        <summary><span class=\"ver-badge\">v6.655</span> <b>修正錦標賽對戰與回放點選 P1 頭像／名片誤載入管理員帳號的問題</b><br>錦標賽觀戰與回放改依實際場次與觀戰房號解析雙方玩家名片，測試房不再讀取預設殘留的 P1 管理員紀錄。</summary>\n",
      "      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.655</span> <b>修正錦標賽對戰與回放點選 P1 頭像／名片誤載入管理員帳號的問題</b><br>錦標賽觀戰與回放改依實際場次與觀戰房號解析雙方玩家名片，測試房不再讀取預設殘留的 P1 管理員紀錄。</summary>\n"
    ],
    [
      "<details open>\n        <summary><span class=\"ver-badge\">v6.668</span> <b>「各選 1 張」的卡改成同一個視窗自由選</b><br>小光、鬥子、秘密箱等「從牌庫選擇 A 卡與 B 卡各 1 張」的卡，不再一段一段依序選，改成同一個視窗一次選完，選錯可以直接取消重選。</summary>\n        <div class=\"log-body\">・每張可選的卡左上角會標出組別（例：小光【基礎】【1階進化】【2階進化】、鬥子【進化】【能量】、秘密箱【物品】【道具】【支援者】【競技場】）；某一組選滿後，同組的其他卡會變暗，再點一次已選的卡就能取消。\n・適用：小光、鬥子、青木的手法、秘密箱、阿克羅瑪的執著、冒險提燈、杜若，以及特性 大吾的巨金怪ex｜X啟動、烈焰猴｜火焰蹈舞、鴨嘴炎獸｜拍檔提升（選完後照舊逐張選要附給哪隻）。\n・規則不變：牌庫沒有的組可以不選；給對手看過後加入手牌、最後重洗牌庫；秘密箱先丟 3 張、青木的手法先丟光手牌；杜若只能從牌庫上方 7 張裡選。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.666</span> <b>修正小尺寸頭像外框邊緣滲入內圓</b><br>修正對戰先後攻列與名片預覽等小尺寸頭像顯示時，外框邊緣細微滲入頭像內圓的情況，同時保留 20 款外圈裝飾與光暈。</summary>\n",
      "<details open>\n        <summary><span class=\"ver-badge\">v6.666</span> <b>修正小尺寸頭像外框邊緣滲入內圓</b><br>修正對戰先後攻列與名片預覽等小尺寸頭像顯示時，外框邊緣細微滲入頭像內圓的情況，同時保留 20 款外圈裝飾與光暈。</summary>\n"
    ]
  ],
  "static/site-version.txt": [
    [
      "6.668\n",
      "6.667\n"
    ]
  ]
};
// 僅以本版獨有的錨點識別版本，避免把早期版本重疊的內容當成新改動。
const V6668_MARKERS = {"oracle-admin/admin.html": [0], "src/lib/game/ai.ts": [0, 1, 2, 3], "src/lib/game/effects.ts": [0, 1, 2, 3, 4, 5, 6], "src/lib/game/effects/_shared.ts": [0], "src/lib/game/effects/cards/lopunny_serperior_flareon_festival.ts": [0, 1, 2, 3, 4], "src/lib/game/effects/cards/m6_wave10.ts": [0, 1], "src/lib/game/effects/cards/m6_wave14.ts": [0, 1, 2, 3, 4], "src/lib/game/effects/cards/mega_decks.ts": [0, 1, 2], "src/lib/game/effects/cards/v158_energy_chain.ts": [0], "src/lib/game/effects/cards/v169_supporters.ts": [0, 1, 2], "src/lib/game/effects/cards/v2996_g4_wave2.ts": [0, 1, 2, 5, 6], "src/lib/game/engine.ts": [0, 1, 2, 3, 4, 5], "src/lib/game/selection-candidates.ts": [0], "src/lib/game/selection-filter.ts": [0, 1, 3, 4, 5, 6], "src/lib/game/selection-ui.ts": [0], "src/lib/version.ts": [0], "src/routes/game/+page.svelte": [0, 1, 3, 4, 5, 6, 7], "static/changelog-archive.html": [0], "static/changelog-bodies.html": [0, 1], "static/changelog.html": [3], "static/site-version.txt": [0]};

export function revertV6668IfPresent(path, source) {
  let text = normEol(String(source));
  const pairs = V6668_PAIRS[path];
  if (!pairs || V6668_MARKERS[path].every((index) => !text.includes(pairs[index][0]))) return text;
  // 依序檢查＋還原（表是由新往舊逐段產生的，後面的錨點可能要前面先還原才出現）
  for (const [index, [from, to]] of pairs.entries()) {
    assert.equal(text.split(from).length, 2, 'v6668 還原錨點變動 ' + path + ' #' + (index + 1));
    text = text.replace(from, () => to);
  }
  return text;
}
