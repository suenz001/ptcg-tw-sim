// v6.672 的精確歷史還原（擴充包 M7「波導探求者」上架），供舊版守衛使用。表由 difflib 產生、驗證逐位元回 7a98371d（v6.671）。
// 鏈：本版是目前最新一節；revert-v6671 的 revertV6671IfPresent 會先呼叫本檔。資料層（index.json／card-set-map.json）另有物件層級還原。
import assert from 'node:assert/strict';
import { normEol } from './eol-agnostic.mjs';

// ── 資料層 ──
export const V6672_M7_IDS = ["20128", "20129", "20130", "20131", "20132", "20133", "20134", "20135", "20136", "20137", "20138", "20139", "20140", "20141", "20142", "20143", "20144", "20145", "20146", "20147", "20148", "20149", "20150", "20151", "20152", "20153", "20154", "20155", "20156", "20157", "20158", "20159", "20160", "20161", "20162", "20163", "20164", "20165", "20166", "20167", "20168", "20169", "20170", "20171", "20172", "20173", "20174", "20175", "20176", "20177", "20178", "20179", "20180", "20181", "20182", "20183", "20184", "20185", "20186", "20187", "20188", "20189", "20190", "20191", "20192", "20193", "20194", "20195", "20196", "20197", "20198", "20199", "20200", "20201", "20202", "20203", "20204", "20205"];
// 同版一起收的官方新印刷：M-P 特典 234～248（15 張，進 M-P-J）、M6a 119／128／129／131（4 張，進 M6a）
export const V6672_EXTRA_IDS = { 'M-P-J': ["20209", "20210", "20211", "20212", "20213", "20214", "20215", "20216", "20217", "20218", "20219", "20220", "20221", "20222", "20223"], 'M6a': ["20206", "20207", "20208", "20224"] };
// v6.671（7a98371d）當時兩筆的張數三欄（git cat-file 實查）
const V6671_COUNTS = {"M-P-J": {"cardCount": 152, "supertypeCounts": {"Pokemon": 114, "Trainer": 20, "Energy": 18}, "count": 152}, "M6a": {"cardCount": 168, "supertypeCounts": {"Pokemon": 155, "Trainer": 5, "Energy": 8}, "count": 168}};
// 本版寫入後的張數（fail-closed 用）
const V6672_NOW_COUNTS = {"M-P-J": 167, "M6a": 172};
/** index.json：拿掉本版插入的 M7 那一筆，M-P-J／M6a 張數三欄回 v6.671（其他筆逐字不動） */
export function revertV6672Index(idx) {
  if (!idx.some((e) => e.code === 'M7')) return idx;
  // fail-closed（複審 P3-1）：兩筆的現值必須正是本版寫入的張數，否則代表之後又動過 ⇒ 由那一版自己的還原先處理
  for (const [code, n] of Object.entries(V6672_NOW_COUNTS)) {
    const e = idx.find((x) => x.code === code);
    assert.ok(e && e.cardCount === n && e.count === n, 'v6672 index 還原：' + code + ' 現值不是本版的 ' + n + ' 張（之後又改過？先接上新版的還原）');
  }
  return idx.filter((e) => e.code !== 'M7').map((e) => (V6671_COUNTS[e.code] ? { ...e, ...V6671_COUNTS[e.code] } : e));
}
/** card-set-map.json：拿掉本版追加的 M7 78 筆＋同版 19 筆（有就全部要在，否則丟錯；沒有＝已是舊版） */
export function revertV6672Map(map) {
  const drop = new Set([...V6672_M7_IDS, ...V6672_EXTRA_IDS['M-P-J'], ...V6672_EXTRA_IDS['M6a']]);
  const hit = Object.keys(map).filter((k) => drop.has(k)).length;
  if (hit === 0) return map;
  assert.equal(hit, drop.size, 'v6672 map 還原：本版新增的 ' + drop.size + ' 筆只找到 ' + hit + ' 筆');
  return Object.fromEntries(Object.entries(map).filter(([k]) => !drop.has(k)));
}
/** 卡表檔：拿掉本版追加在 M-P-J／M6a 尾端的卡（必須正好在尾端、順序一致；沒有＝已是舊版） */
export function revertV6672Cards(code, cards) {
  const ids = V6672_EXTRA_IDS[code];
  if (!ids) return cards;
  const tail = cards.slice(-ids.length).map((c) => String(c.id));
  if (JSON.stringify(tail) !== JSON.stringify(ids)) {
    assert.ok(!cards.some((c) => ids.includes(String(c.id))), 'v6672 ' + code + ' 還原：本版的卡不在尾端');
    return cards;
  }
  return cards.slice(0, -ids.length);
}

// ── 文字檔 ──
export const V6672_PAIRS = {
 "oracle-admin/admin.html": [
  [
   "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.672';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n",
   "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.671';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n"
  ]
 ],
 "src/lib/cards/regulation.ts": [
  [
   "  M6: 'J',   // 綠寶石風暴（2026-08-07）\n  M7: 'J',   // 波導探求者（2026-12-04）\n  // v2.115: MJ 發售於 2026/2/26（J 標啟用 2026/1/16 之後），歸 J 標；\n",
   "  M6: 'J',   // 綠寶石風暴（2026-08-07）\n  // v2.115: MJ 發售於 2026/2/26（J 標啟用 2026/1/16 之後），歸 J 標；\n"
  ]
 ],
 "src/lib/game/ai-energy.ts": [
  [
   "  if (!act || act.cantAttachEnergyThisTurn) return null;\n  const energies = aiAttachableHandEnergies(state, me, pool);   // ⭐v6.672\n  if (!energies.length) return null;\n",
   "  if (!act || act.cantAttachEnergyThisTurn) return null;\n  const energies = p.hand.filter((c) => pool.get(c.cardId)?.supertype === 'Energy');\n  if (!energies.length) return null;\n"
  ],
  [
   "  const p = state.players[me];\n  const energies = aiAttachableHandEnergies(state, me, pool);   // ⭐v6.672\n  if (!energies.length) return null;\n",
   "  const p = state.players[me];\n  const energies = p.hand.filter((c) => pool.get(c.cardId)?.supertype === 'Energy');\n  if (!energies.length) return null;\n"
  ],
  [
   "import type { GameState, CardInstance } from './types';\nimport { applyAction, canAffordAttack, energyProvidesType, getAvailableAttacks, isHandEnergyAttachLocked } from './engine';\n\n/**\n * ⭐v6.672 AI 從手牌附能量的候選（唯一一份）：手牌的能量卡，扣掉這回合被鎖住不能從手牌附上的\n *   （超級阿勃梭魯Zex｜血紅恐懼：特殊能量）。判準走引擎同一支 isHandEnergyAttachLocked ⇒ AI 不會送出必被退回的動作\n *   （否則連兩次無進展會被強制結束回合，審查 P2-5）。\n */\nexport function aiAttachableHandEnergies(state: GameState, me: 0 | 1, pool: Map<string, Card>): CardInstance[] {\n  const p = state.players[me];\n  return p.hand.filter((c) => { const ec = pool.get(c.cardId); return ec?.supertype === 'Energy' && !isHandEnergyAttachLocked(p, ec); });\n}\nimport { getCardRole } from './ai-roles';\n",
   "import type { GameState, CardInstance } from './types';\nimport { applyAction, canAffordAttack, energyProvidesType, getAvailableAttacks } from './engine';\nimport { getCardRole } from './ai-roles';\n"
  ]
 ],
 "src/lib/game/ai-slowking.ts": [
  [
   "): CardInstance | null {\n  const ens = aiAttachableHandEnergies(state, me, pool)   // ⭐v6.672 扣掉被鎖住的特殊能量\n    // v6.432（fable 複審）附上去會被丟掉的能量不附（燃火能量、火箭隊能量給非火箭隊）——與 ai-energy.ts 同一個中央判定。\n",
   "): CardInstance | null {\n  const ens = state.players[me].hand.filter((c) => pool.get(c.cardId)?.supertype === 'Energy')\n    // v6.432（fable 複審）附上去會被丟掉的能量不附（燃火能量、火箭隊能量給非火箭隊）——與 ai-energy.ts 同一個中央判定。\n"
  ],
  [
   "import { knownDeckTopIids, recordKnownDeckTop } from './deck-top-known';\nimport { energyStaysIfAttached, aiAttachableHandEnergies } from './ai-energy';\nimport { copyAttackCandidates } from './copy-attack';   // ⭐v6.435 可借哪幾招的唯一來源\n",
   "import { knownDeckTopIids, recordKnownDeckTop } from './deck-top-known';\nimport { energyStaysIfAttached } from './ai-energy';\nimport { copyAttackCandidates } from './copy-attack';   // ⭐v6.435 可借哪幾招的唯一來源\n"
  ]
 ],
 "src/lib/game/ai.ts": [
  [
   "): GameAction | null {\n  const energies = aiAttachableHandEnergies(state, me, pool);   // ⭐v6.672\n  if (energies.length === 0) return null;\n",
   "): GameAction | null {\n  const energies = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');\n  if (energies.length === 0) return null;\n"
  ],
  [
   "function dragapultEnergyAction(\n  state: GameState, player: PlayerState, pool: Map<string, Card>, me: 0 | 1,\n): GameAction | null {\n",
   "function dragapultEnergyAction(\n  state: GameState, player: PlayerState, pool: Map<string, Card>,\n): GameAction | null {\n"
  ],
  [
   "\n  // >>> v6672-ai-battle-stadium\n  // ⭐v6.672 M7 戰鬥體育場：自己有受傷的非規則寶可夢就使用（純恢復、沒有代價；引擎無對象時會退回）\n  if (state.activeStadium && pool.get(state.activeStadium.cardId)?.name === '戰鬥體育場'\n      && !(state.stadiumUsedThisTurn ?? [false, false])[myIdx] && !state.pendingSelection && !state.festivalDancePendingSecondAttack\n      && [...(player.active ? [player.active] : []), ...player.bench].some(c => c.damage > 0 && !isRulePokemon(pool.get(c.cardId)))) {\n    return { type: 'USE_STADIUM' };\n  }\n  // <<< v6672-ai-battle-stadium\n  // ⭐v6.429 牌庫頂借招：手牌有比牌庫頂更好的借招目標 ⇒ 用夜間學院把它放到牌庫頂\n",
   "\n  // ⭐v6.429 牌庫頂借招：手牌有比牌庫頂更好的借招目標 ⇒ 用夜間學院把它放到牌庫頂\n"
  ],
  [
   "      // 从手牌中找能量：有匹配属性优先，否则随便拿一张\n      const energyCandidates = aiAttachableHandEnergies(state, myIdx, pool);   // ⭐v6.672 扣掉被鎖住的特殊能量（血紅恐懼）\n      const energyInHand = energyCandidates.find(c => {\n",
   "      // 从手牌中找能量：有匹配属性优先，否则随便拿一张\n      const energyCandidates = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');\n      const energyInHand = energyCandidates.find(c => {\n"
  ],
  [
   "    if (isMarruneDragapult(player, pool)) {\n      const dragapultAct = dragapultEnergyAction(state, player, pool, myIdx);\n      if (dragapultAct) return dragapultAct;\n",
   "    if (isMarruneDragapult(player, pool)) {\n      const dragapultAct = dragapultEnergyAction(state, player, pool);\n      if (dragapultAct) return dragapultAct;\n"
  ],
  [
   "import { knownDeckTopIids } from './deck-top-known';\nimport { pickActiveEnergyUnlock, pickBenchEnergyAttach, aiAttachableHandEnergies } from './ai-energy';   // ⭐v6.432 戰鬥位有招可用時也附能量（給備戰）\n// ⭐v6.429 試打時「自己的選擇視窗」交給同一個選擇器解完（批次 B1：選對手 1 隻打的招不再被估成 0 分）。\n",
   "import { knownDeckTopIids } from './deck-top-known';\nimport { pickActiveEnergyUnlock, pickBenchEnergyAttach } from './ai-energy';   // ⭐v6.432 戰鬥位有招可用時也附能量（給備戰）\n// ⭐v6.429 試打時「自己的選擇視窗」交給同一個選擇器解完（批次 B1：選對手 1 隻打的招不再被估成 0 分）。\n"
  ]
 ],
 "src/lib/game/copy-attack.ts": [
  [
   "      return c?.tags?.includes('太晶') ? [opp.active] : [];\n    }\n\n    // ⭐v6.672「選擇1個對手的戰鬥場的『超級進化寶可夢【ex】』持有的招式」（判準走中央 isMegaExCard）\n    case '烏賊王|技能操控': {\n      if (!opp.active) return [];\n      return isMegaExCard(pool.get(opp.active.cardId)) ? [opp.active] : [];\n    }\n",
   "      return c?.tags?.includes('太晶') ? [opp.active] : [];\n    }\n"
  ],
  [
   "  '狐大盜|技能大盜',\n  '烏賊王|技能操控',   // ⭐v6.672 M7：「選擇1個對手的戰鬥場的『超級進化寶可夢【ex】』持有的招式，作為這個招式使用。」\n];\n",
   "  '狐大盜|技能大盜',\n];\n"
  ],
  [
   "\nimport { isRulePokemon, isMegaExCard } from './selection-filter';   // ⭐v6.404（⭐v6.672 加 isMegaExCard：烏賊王｜技能操控） 卡面「擁有規則的寶可夢」中央述詞（leaf）\nimport { isPlayerLevelAttackOnCooldown } from './player-attack-cooldown';   // ⭐v6.435 玩家層級冷卻唯一判準（leaf）\n",
   "\nimport { isRulePokemon } from './selection-filter';   // ⭐v6.404 卡面「擁有規則的寶可夢」中央述詞（leaf）\nimport { isPlayerLevelAttackOnCooldown } from './player-attack-cooldown';   // ⭐v6.435 玩家層級冷卻唯一判準（leaf）\n"
  ]
 ],
 "src/lib/game/effects.ts": [
  [
   "import './effects/cards/mp_j_wave2'; // v6.670 M-P 補漏收錄 批次2（超級席多藍恩ex｜巨重壓、支援者 春紫）\nimport './effects/cards/m7_wave1'; // v6.672 M7「波導探求者」批次1（卡面與既有卡逐字相同的招式）\nimport './effects/cards/m7_wave2'; // v6.672 M7「波導探求者」批次2（新機制招式）\nimport './effects/cards/m7_wave3'; // v6.672 M7「波導探求者」批次3（主動特性、訓練家、血紅恐懼）\nimport './effects/cards/svi_wave1'; // v6.616 SVI「Trianers Camp」招式實裝（6 招，全部純類推既有中央 helper）\n",
   "import './effects/cards/mp_j_wave2'; // v6.670 M-P 補漏收錄 批次2（超級席多藍恩ex｜巨重壓、支援者 春紫）\nimport './effects/cards/svi_wave1'; // v6.616 SVI「Trianers Camp」招式實裝（6 招，全部純類推既有中央 helper）\n"
  ],
  [
   "    if (picked.length === 0) {\n      return { state: addLog(state, `${label}：未展示任何卡 → ${baseDamage} 傷害`, aIdx), damage: baseDamage };\n    }\n",
   "    if (picked.length === 0) {\n      return { state: addLog(state, `${label}：未展示任何卡 → 0 傷害`, aIdx), damage: 0 };\n    }\n"
  ],
  [
   "      : eligible;\n    // ⭐v6.672：卡面有張數上限時夾住（例：「選擇1張」）——送多了只認前 max 張\n    const picked = maxReveal === null ? pickedAll : pickedAll.slice(0, maxReveal);\n    if (picked.length === 0) {\n",
   "      : eligible;\n    if (picked.length === 0) {\n"
  ],
  [
   "    //   強制公開展示並照全額算傷害（意圖反轉 ＋ 隱藏資訊外洩）。\n    const pickedAll = (chosenIids !== undefined)\n      ? eligible.filter(c => allowed.has(c.iid) && chosenIids.includes(c.iid))\n",
   "    //   強制公開展示並照全額算傷害（意圖反轉 ＋ 隱藏資訊外洩）。\n    const picked = (chosenIids !== undefined)\n      ? eligible.filter(c => allowed.has(c.iid) && chosenIids.includes(c.iid))\n"
  ],
  [
   "    if (eligible.length === 0) {\n      return { state: addLog(state, `${label}：${emptyText} → ${baseDamage} 傷害`, aIdx), damage: baseDamage };\n    }\n",
   "    if (eligible.length === 0) {\n      return { state: addLog(state, `${label}：${emptyText} → 0 傷害`, aIdx), damage: 0 };\n    }\n"
  ],
  [
   "  ATTACK_PRE_DISCARD_CHOICE.set(key, {\n    min: 0, max: maxReveal, scope: 'hand-reveal', baseDamage,\n    // damagePerEnergy 只影響 UI 的「預估傷害」；屬性種類型無法用線性倍率表示，\n",
   "  ATTACK_PRE_DISCARD_CHOICE.set(key, {\n    min: 0, max: null, scope: 'hand-reveal', baseDamage: 0,\n    // damagePerEnergy 只影響 UI 的「預估傷害」；屬性種類型無法用線性倍率表示，\n"
  ],
  [
   "  const { key, label, names, supertype, revealLabel, damageOf, describe, emptyText } = opts;\n  const baseDamage = opts.baseDamage ?? 0;\n  const maxReveal = opts.max ?? null;\n  const eligibleOf = (hand: CardInstance[], pool: Map<string, Card>): CardInstance[] =>\n",
   "  const { key, label, names, supertype, revealLabel, damageOf, describe, emptyText } = opts;\n  const eligibleOf = (hand: CardInstance[], pool: Map<string, Card>): CardInstance[] =>\n"
  ],
  [
   "  emptyText: string;\n  /** ⭐v6.672：卡面印刷的基本傷害（例：沼王｜熱血頭擊 20+、浮潛鼬ex｜衝勁螺旋 40+）。\n   *   沒展示或沒有可展示的卡時打這個數字；預設 0（既有兩招的行為不變）。 */\n  baseDamage?: number;\n  /** ⭐v6.672：最多可展示幾張（例：熱血頭擊「選擇1張」）。預設不限（既有兩招的行為不變）。 */\n  max?: number;\n}) {\n",
   "  emptyText: string;\n}) {\n"
  ],
  [
   "  ['烈箭鷹ex', talonflameExAbility_ExcitingDive],\n  // ⭐v6.672 M7：超音波幼蟲｜震顫翅 —— 丟棄這張卡、查看自己的牌庫上方1張卡（回復原樣）。gate 在 engine HAND_ACTIVATE_GATES。\n  ['超音波幼蟲', trapinchShiverWing],\n]);\n",
   "  ['烈箭鷹ex', talonflameExAbility_ExcitingDive],\n]);\n"
  ],
  [
   " */\n// >>> v6672-shiver-wing\n/**\n * ⭐v6.672 M7 超音波幼蟲｜震顫翅：「若手牌有這張卡，則在自己的回合時可使用1次，若使用，則將這張卡丟棄。\n *   查看自己的牌庫上方1張卡，回復原樣。」\n *   ⚠ 丟棄是「使用的代價」⇒ 一定先丟；查看＝只有自己看得到（走 reorder-deck-top 的 1 張檢視，順序不變＝回復原樣）。\n *   ⚠ 公開 log 只寫「查看了牌庫上方 1 張」，不寫卡名（牌庫是隱藏資訊）。\n */\nfunction trapinchShiverWing(state: GameState, idx: 0 | 1, pool: Map<string, Card>, handInst: CardInstance): GameState {\n  let s = updatePlayer(state, idx, p => ({ ...p, hand: p.hand.filter(c => c.iid !== handInst.iid), discard: [...p.discard, handInst] }));\n  s = addLog(s, `震顫翅：將手牌的 ${pool.get(handInst.cardId)?.name ?? '超音波幼蟲'} 丟棄`, idx);\n  const top = s.players[idx].deck[0];\n  if (!top) return addLog(s, '震顫翅：牌庫沒有卡', idx);\n  return withPending(addLog(s, '震顫翅：查看自己的牌庫上方 1 張卡（回復原樣）', idx), {\n    type: 'reorder-deck-top', actorIdx: idx, sourcePlayerIdx: idx,\n    minCount: 1, maxCount: 1,\n    effectKey: 'reorder-deck-top-apply',\n    params: { candidateIids: [top.iid], allowDiscard: false, targetIdx: idx, titleOverride: '震顫翅：查看自己的牌庫上方 1 張卡（確認後放回原處）' },\n  });\n}\n// <<< v6672-shiver-wing\n\nexport const ON_HAND_ACTIVATE_ABILITIES = new Map<\n",
   " */\nexport const ON_HAND_ACTIVATE_ABILITIES = new Map<\n"
  ],
  [
   "  '全滿旋律',     // v5.950 西獅海壬 — 進化(糖果/Stage1)時可用1次:恢復自方1隻全部HP。原漏收→進化不自動彈窗、時好時壞(玩家報)\n  '能量躍遷',     // ⭐v6.672 M7 天然鳥 — 看對手手牌，選 1 張能量卡附於對手的寶可夢身上（m7_wave3.ts）\n]);\n",
   "  '全滿旋律',     // v5.950 西獅海壬 — 進化(糖果/Stage1)時可用1次:恢復自方1隻全部HP。原漏收→進化不自動彈窗、時好時壞(玩家報)\n]);\n"
  ],
  [
   "  ['藏青浪濤', { skipDefEffects: true }],\n  // ⭐v6.672 M7 怪力｜練過的手臂：「這隻寶可夢使用招式的傷害，不計算抵抗力與對手的戰鬥寶可夢身上的附加效果。」\n  //   ⚠ 只有抵抗力（弱點照算）＋附加效果，兩個旗標都要。\n  ['練過的手臂', { skipDefEffects: true, skipResistance: true }],\n]);\n",
   "  ['藏青浪濤', { skipDefEffects: true }],\n]);\n"
  ],
  [
   "/** 攻擊方持有此特性 → 攻擊時自動帶這些 buff */\nexport const PASSIVE_ATTACKER_BUFF = new Map<string, { skipDefEffects?: boolean; skipResistance?: boolean }>([\n  // 波盪水ex(H) | 藏青浪濤 — 自身招式不計算對手戰鬥場附加效果(永遠 skipDefEffects)\n",
   "/** 攻擊方持有此特性 → 攻擊時自動帶這些 buff */\nexport const PASSIVE_ATTACKER_BUFF = new Map<string, { skipDefEffects?: boolean }>([\n  // 波盪水ex(H) | 藏青浪濤 — 自身招式不計算對手戰鬥場附加效果(永遠 skipDefEffects)\n"
  ],
  [
   "  ];\n  const _vp = victimBasePrizes(state, target, tCard, aIdx, pool);   // ⭐v6.672 障眼法\n  const prizes = _vp.prizes;\n  if (_vp.note) state = markBlindKoNoPrize(state, _vp.note, aIdx, state.players[aIdx]?.active?.iid === target.iid);\n  const players = [...state.players] as [PlayerState, PlayerState];\n",
   "  ];\n  const prizes = tCard ? koPrizeCount(tCard) : 1;\n  const players = [...state.players] as [PlayerState, PlayerState];\n"
  ],
  [
   "  if (!fp.active && fp.bench.length === 0) return state;\n  // ⭐v6.672 障眼法：這一方本 action 的昏厥不給獎賞 ⇒ 奇跡之吻的 +1 也不給（呼叫端不必各自傳參數）\n  return applyMiracleKissOnOppActiveKO(state, (1 - faintedIdx) as 0 | 1, pool, preventPrizeAll || blindKoPrevented(state, faintedIdx));\n}\n",
   "  if (!fp.active && fp.bench.length === 0) return state;\n  return applyMiracleKissOnOppActiveKO(state, (1 - faintedIdx) as 0 | 1, pool, preventPrizeAll);\n}\n"
  ],
  [
   "      players2[aIdx] = att;\n      const _vp = victimBasePrizes(s, s.players[aIdx].active, attCard, aIdx, pool);   // ⭐v6.672 障眼法（昏厥前的盤面判）\n      const prizes = _vp.prizes;\n      if (_vp.note) s = markBlindKoNoPrize(s, _vp.note, aIdx, true);\n      s = addLog({ ...s, players: players2 }, `瘋癲攻擊：${attCard?.name ?? '?'} 反噬昏厥！對手將取得 ${prizes} 張獎賞卡`, null);\n",
   "      players2[aIdx] = att;\n      const prizes = attCard ? koPrizeCount(attCard) : 1;\n      s = addLog({ ...s, players: players2 }, `瘋癲攻擊：${attCard?.name ?? '?'} 反噬昏厥！對手將取得 ${prizes} 張獎賞卡`, null);\n"
  ],
  [
   "    if ((state.oppDamageKOdMeThisTurn?.[dIdx] ?? 0) <= 0) return state;\n    // ⭐v6.672 障眼法：卡面「對手也無法獲得獎賞卡」⇒ 加碼的 +N 也不給\n    if (blindKoPrevented(state, dIdx)) return addLog(state, `${label}：對手的寶可夢昏厥，但「障眼法」使這次無法獲得獎賞卡`, aIdx);\n    const s = addLog(state, `${label}：讓對手的寶可夢昏厥 → 多獲得 ${bonus} 張獎賞卡`, aIdx);\n",
   "    if ((state.oppDamageKOdMeThisTurn?.[dIdx] ?? 0) <= 0) return state;\n    const s = addLog(state, `${label}：讓對手的寶可夢昏厥 → 多獲得 ${bonus} 張獎賞卡`, aIdx);\n"
  ],
  [
   "\n// ⭐v6.672 export：M7 鯰魚王｜激烈搖晃（m7_wave2.ts）\nexport function discardStadiumPost(label: string, failIfNone: boolean = false): AttackPostFn {\n  return (state, aIdx, pool) => {\n",
   "\nfunction discardStadiumPost(label: string, failIfNone: boolean = false): AttackPostFn {\n  return (state, aIdx, pool) => {\n"
  ],
  [
   "    active: { ...p.active, energyAttached: p.active.energyAttached.filter(e => !picked.has(e.iid)) },\n    ...(toDeck ? { deck: shuffle([...p.deck, ...toDiscard]) } : { discard: [...p.discard, ...toDiscard] }),\n  }) : p);\n",
   "    active: { ...p.active, energyAttached: p.active.energyAttached.filter(e => !picked.has(e.iid)) },\n    discard: [...p.discard, ...toDiscard],\n  }) : p);\n"
  ],
  [
   "  const defName = pool.get(dp.active.cardId)?.name ?? '?';\n  const toDeck = params?.dest === 'deck';   // ⭐v6.672 放回對手牌庫並重洗（沙漠之風）\n  return updatePlayer(addLog(st, `${label}：${defName} ${toDeck ? '放回牌庫並重洗' : '丟棄'} ${toDiscard.length} 張能量（${names}）`, idx), dIdx, p => p.active ? ({\n    ...p,\n",
   "  const defName = pool.get(dp.active.cardId)?.name ?? '?';\n  return updatePlayer(addLog(st, `${label}：${defName} 丟棄 ${toDiscard.length} 張能量（${names}）`, idx), dIdx, p => p.active ? ({\n    ...p,\n"
  ],
  [
   "  if (!iids.length || !dp.active) return st;\n  // ⭐v6.672 公平性自驗（審查 P2-3）：只收候選內、去重、最多卡面張數（params.count；舊 pending 沒有這欄 ⇒ 不夾）\n  const _valid = Array.isArray(params?.validIids) ? new Set(params!.validIids as string[]) : null;\n  const _cap = typeof params?.count === 'number' ? (params.count as number) : Infinity;\n  const picked = new Set([...new Set(iids)].filter(i => !_valid || _valid.has(i)).slice(0, _cap));\n  const toDiscard = dp.active.energyAttached.filter(e => picked.has(e.iid));\n",
   "  if (!iids.length || !dp.active) return st;\n  const picked = new Set(iids);\n  const toDiscard = dp.active.energyAttached.filter(e => picked.has(e.iid));\n"
  ],
  [
   "        effectKey: 'discard-opp-active-energy-pick',\n        params: { targetIid: defender.active.iid, validIids: matchIids, count: effCount, label, titleOverride: `選擇要${_verbTxt}的對手能量（${label}）`, ...(dest === 'deck' ? { dest } : {}) },\n      },\n",
   "        effectKey: 'discard-opp-active-energy-pick',\n        params: { targetIid: defender.active.iid, validIids: matchIids, label, titleOverride: `選擇要丟棄的對手能量（${label}）` },\n      },\n"
  ],
  [
   "    return withPending(\n      addLog(state, `${label}：選擇要${_verbTxt}的對手的戰鬥寶可夢身上的 ${effCount} 張${_fdesc}能量`, aIdx),\n      {\n",
   "    return withPending(\n      addLog(state, `${label}：選擇要丟棄對手的戰鬥寶可夢身上的 ${effCount} 張${_fdesc}能量`, aIdx),\n      {\n"
  ],
  [
   "        active: { ...p.active, energyAttached: p.active.energyAttached.filter(e => !matchSet.has(e.iid)) },\n        ...(dest === 'deck' ? { deck: shuffle([...p.deck, ...discarded]) } : { discard: [...p.discard, ...discarded] }),\n      }) : p);\n",
   "        active: { ...p.active, energyAttached: p.active.energyAttached.filter(e => !matchSet.has(e.iid)) },\n        discard: [...p.discard, ...discarded],\n      }) : p);\n"
  ],
  [
   "      const names = discarded.map(e => pool.get(e.cardId)?.name ?? '能量').join('、');\n      const s = addLog(state, `${label}：${defName} ${_verbTxt} ${discarded.length} 張${_fdesc}能量（${names}）`, aIdx);\n      return updatePlayer(s, dIdx, p => p.active ? ({\n",
   "      const names = discarded.map(e => pool.get(e.cardId)?.name ?? '能量').join('、');\n      const s = addLog(state, `${label}：${defName} 丟棄 ${discarded.length} 張${_fdesc}能量（${names}）`, aIdx);\n      return updatePlayer(s, dIdx, p => p.active ? ({\n"
  ],
  [
   "    if (!defender.active) return state;\n    const _verbTxt = dest === 'deck' ? '放回牌庫並重洗' : '丟棄';\n    // v5.333：免疫招式效果的 active 不受此效果（C-17 per-target guard）\n",
   "    if (!defender.active) return state;\n    // v5.333：免疫招式效果的 active 不受此效果（C-17 per-target guard）\n"
  ],
  [
   "  kind: 'attack-effect' | 'ability-effect' = 'attack-effect',\n  /** ⭐v6.672：卡面「放回對手的牌庫並重洗」（M7 沙漠蜻蜓｜沙漠之風）⇒ 'deck'。預設 'discard'（既有卡行為不變）。 */\n  dest: 'discard' | 'deck' = 'discard',\n): AttackPostFn {\n",
   "  kind: 'attack-effect' | 'ability-effect' = 'attack-effect',\n): AttackPostFn {\n"
  ],
  [
   "    // v5.469：自損昏厥（不是「受到對手招式傷害」）⇒ 古舊能量等不觸發，維持基本張數。\n    // ⭐v6.672 障眼法：任何原因昏厥都擋（昏厥前的盤面判）\n    const _bnSame = blindKoNoPrizeNote(s, att.active, card, aIdx, pool);\n    const oppPrizes = _bnSame ? 0 : (card ? (prizesForKOLocal(card)) : 1);\n    if (_bnSame) s = markBlindKoNoPrize(s, _bnSame, aIdx, true);\n    s = addLog({ ...s, players }, `同命戰鬥：${card?.name ?? '?'} 也昏厥，對手待取 ${oppPrizes} 張獎賞卡`, null);\n",
   "    // v5.469：自損昏厥（不是「受到對手招式傷害」）⇒ 古舊能量等不觸發，維持基本張數。\n    const oppPrizes = card ? (prizesForKOLocal(card)) : 1;\n    s = addLog({ ...s, players }, `同命戰鬥：${card?.name ?? '?'} 也昏厥，對手待取 ${oppPrizes} 張獎賞卡`, null);\n"
  ],
  [
   "  }\n  // >>> v6672-bench-damage-bonus\n  // ⭐v6.672 M7 水箭龜｜增水泵：「只要這隻寶可夢在場上，自己的【水】寶可夢使用的招式，對對手的備戰寶可夢造成的傷害\n  //   『+30』點。這個特性的效果不會重複。」⇒ 對手**備戰**的招式傷害（全站打備戰都走這一支）＋30，場上幾隻都只 +30。\n  //   ⚠ 攻擊者屬性走中央有效屬性（雙重屬性／同步之軀等）；持有者特性此刻要有效。放指示物（attack-effect）不是傷害 ⇒ 不加。\n  if (!isActive && kind === 'attack-damage' && effDmg > 0) {\n    const _ap = st.players[actorIdx];\n    const _atk = _ap.active;\n    const _atkC = _atk ? pool.get(_atk.cardId) : undefined;\n    if (_atk && hasEffectivePokemonType(st, actorIdx, _atk, _atkC, pool, 'Water')\n        && [_atk, ..._ap.bench].some(x => _v6196HasEffAbilByInst(st, actorIdx, x, pool, '增水泵'))) {\n      effDmg += 30;\n      st = addLog(st, `「增水泵」啟動：${_atkC?.name ?? '?'} 對備戰寶可夢的招式傷害 +30`, actorIdx);\n    }\n  }\n  // <<< v6672-bench-damage-bonus\n  if (isActive && kind === 'attack-damage' && !opts?.noWeakness) {\n",
   "  }\n  if (isActive && kind === 'attack-damage' && !opts?.noWeakness) {\n"
  ],
  [
   "  }\n  // >>> v6672-korrina-full-power\n  // ── ⭐v6.672 可爾妮的全力（本回合自己的「超級進化寶可夢【ex】」對對手戰鬥位 +20 × 對手已獲得的獎賞卡張數）──\n  //   張數在出招當下數（6 − 對手剩餘獎賞張數，與 鐵蟻ex｜復仇粉碎 同一算法）。\n  if (attacker.korrinaFullPowerThisTurn && isMegaExCard(aCard)) {\n    const taken = Math.max(0, 6 - defender.prizes.length);\n    if (taken > 0) {\n      const b = 20 * taken; d += b;\n      s = addLog(s, `「可爾妮的全力」啟動：對手已獲得 ${taken} 張獎賞卡 → ${aCard.name} 招式傷害 +${b}`, aIdx);\n      formula.push({ sign: '+', value: b, label: `可爾妮的全力×${taken}` });\n    }\n  }\n  // <<< v6672-korrina-full-power\n  // ⭐⭐v6.409：**唯一的 clamp 點**（站長裁定：所有加減算完才不能低於 0）。\n",
   "  }\n  // ⭐⭐v6.409：**唯一的 clamp 點**（站長裁定：所有加減算完才不能低於 0）。\n"
  ],
  [
   "//   守衛：scripts/test-coin-until-tails-formula.mjs 以卡面印刷傷害驗全部 flip-until-tails 招式。\n// ⭐v6.672 export：M7 六尾｜連續舞步（m7_wave1.ts）共用同一支，不另抄一份。\nexport function coinUntilTailsMultiplyPre(perHead: number, base: number, attackName: string): AttackPreFn {\n  return (state, aIdx, _pool) => {\n",
   "//   守衛：scripts/test-coin-until-tails-formula.mjs 以卡面印刷傷害驗全部 flip-until-tails 招式。\nfunction coinUntilTailsMultiplyPre(perHead: number, base: number, attackName: string): AttackPreFn {\n  return (state, aIdx, _pool) => {\n"
  ],
  [
   "  ['神秘守護', (att) => isPokemonExCard(att)],\n  // ⭐v6.672 M7 象徵鳥ex｜超級護身：「這隻寶可夢不會受到對手的『超級進化寶可夢【ex】』招式的傷害。」（只擋傷害，不擋效果）\n  ['超級護身', (att) => isMegaExCard(att)],\n]);\n",
   "  ['神秘守護', (att) => isPokemonExCard(att)],\n]);\n"
  ],
  [
   "    s = addLog(s, `${label}：${teraImmunNames.join('、')} 為太晶寶可夢，在備戰位免疫招式傷害`, null);\n  }\n  for (const _bn of reduceLogsBlind) s = markBlindKoNoPrize(s, _bn, targetIdx, false);   // ⭐v6.672 障眼法（只打備戰）\n  if (koNames.length > 0) {\n    // ⭐v6421-ko-prize-taker：獎賞歸被 KO 方的對手（打自己備戰時是對手取，不是攻擊方）\n",
   "    s = addLog(s, `${label}：${teraImmunNames.join('、')} 為太晶寶可夢，在備戰位免疫招式傷害`, null);\n  }\n  if (koNames.length > 0) {\n    // ⭐v6421-ko-prize-taker：獎賞歸被 KO 方的對手（打自己備戰時是對手取，不是攻擊方）\n"
  ],
  [
   "      for (const _d of _isk.toDiscard) koDiscards.push(_d);\n      { const _vp = victimBasePrizes(st, c, card, targetIdx, pool); if (card) morePrizes += _vp.prizes; if (_vp.note) reduceLogsBlind.push(_vp.note); }   // ⭐v6.672 障眼法\n      koNames.push(card?.name ?? '?');\n",
   "      for (const _d of _isk.toDiscard) koDiscards.push(_d);\n      if (card) morePrizes += koPrizeCount(card);\n      koNames.push(card?.name ?? '?');\n"
  ],
  [
   "  //   昏厥時由對手取獎（v6.421）。\n  let morePrizes = 0;\n  const reduceLogsBlind: string[] = [];   // ⭐v6.672 障眼法 log（KO 迴圈結束後一次印）\n  const newBench: CardInstance[] = [];\n  const koDiscards: CardInstance[] = [];\n",
   "  //   昏厥時由對手取獎（v6.421）。\n  let morePrizes = 0;\n  const newBench: CardInstance[] = [];\n  const koDiscards: CardInstance[] = [];\n"
  ],
  [
   "  }\n  for (const _bn of reduceLogsBlind) s = markBlindKoNoPrize(s, _bn, targetIdx, false);   // ⭐v6.672 障眼法（只打備戰）\n  if (koNames.length > 0) {\n",
   "  }\n  if (koNames.length > 0) {\n"
  ],
  [
   "      for (const _d of _isk.toDiscard) koDiscards.push(_d);\n      { const _vp = victimBasePrizes(state, c, card, targetIdx, pool); if (card) morePrizes += _vp.prizes; if (_vp.note) reduceLogsBlind.push(_vp.note); }   // ⭐v6.672 障眼法\n      koNames.push(card?.name ?? '?');\n",
   "      for (const _d of _isk.toDiscard) koDiscards.push(_d);\n      if (card) morePrizes += koPrizeCount(card);\n      koNames.push(card?.name ?? '?');\n"
  ],
  [
   "  let morePrizes = 0;\n  const reduceLogsBlind: string[] = [];   // ⭐v6.672 障眼法 log（KO 迴圈結束後一次印）\n  const newBench: CardInstance[] = [];\n",
   "  let morePrizes = 0;\n  const newBench: CardInstance[] = [];\n"
  ],
  [
   "  if (!koCard) return { prizes: 1, state: s };\n  // >>> v6672-blind-ko-adjusted\n  { const _bn = blindKoNoPrizeNote(s, koInst, koCard, defenderIdx, pool);\n    if (_bn) return { prizes: 0, state: markBlindKoNoPrize(s, _bn, defenderIdx, s.players[defenderIdx]?.active?.iid === koInst.iid), preventPrizeAll: true }; }   // 呼叫端都在移除受害者之前呼叫\n  // <<< v6672-blind-ko-adjusted\n  const base = koPrizeCount(koCard);\n",
   "  if (!koCard) return { prizes: 1, state: s };\n  const base = koPrizeCount(koCard);\n"
  ],
  [
   "\n// >>> v6672-blind-ko-no-prize\n/**\n * ⭐⭐v6.672 M7 九尾｜障眼法：「若自己的手牌為5張，則這隻寶可夢就算【昏厥】，對手也無法獲得獎賞卡。」\n *   ⚠ 卡面**沒有**限定昏厥的原因（招式傷害／效果／寶可夢檢查／自己弄昏厥都算）⇒ 每一條 KO 獎賞路徑都要問這一支，\n *     不可以只接在「受到招式傷害」的分支（那是脆弱蛻殼的卡面）。\n *   ⚠ 「自己的手牌」＝被昏厥那隻的持有者的手牌，昏厥當下數（剛好 5 張）。\n *   ⚠ 特性此刻要有效（中央 isAbilityHolderEffective；位置依實際戰鬥場／備戰）。\n * @returns 擋下時的 log 句子；不擋 ⇒ null\n */\nexport function blindKoNoPrizeNote(\n  state: GameState, victim: CardInstance | null | undefined, victimCard: Card | undefined,\n  ownerIdx: 0 | 1, pool: Map<string, Card>,\n): string | null {\n  if (!victim || !victimCard?.abilities?.some(a => a.name === '障眼法')) return null;\n  const owner = state.players[ownerIdx];\n  if (!owner || owner.hand.length !== 5) return null;\n  const loc: 'active' | 'bench' = owner.bench.some(b => b.iid === victim.iid) ? 'bench' : 'active';\n  if (!isAbilityHolderEffective(state, victim, victimCard, ownerIdx, '障眼法', loc, pool)) return null;\n  return `「障眼法」啟動：${victimCard.name} 昏厥，但持有者手牌剛好 5 張 → 對手無法獲得獎賞卡`;\n}\n/** ⭐v6.672 障眼法擋下獎賞時一律走這支：寫 log ＋（受害者是**戰鬥寶可夢**時）記下「這個 action 內這一方的戰鬥寶可夢昏厥不給獎賞」。\n *   消費點（奇跡之吻「對手的戰鬥寶可夢昏厥時」、KO 加碼）都是針對戰鬥寶可夢 ⇒ 備戰的九尾被擋下不可以連帶擋到別隻（複審 P2-2）。\n *   ⚠ 記號在 applyAction 最外層清除（哨兵 v6672-blind-ko-transient）。 */\nexport function markBlindKoNoPrize(state: GameState, note: string, ownerIdx: 0 | 1, victimWasActive: boolean): GameState {\n  const s = addLog(state, note, null);\n  if (!victimWasActive) return s;\n  const k = ownerIdx === 0 ? 'p1' : 'p2';\n  return { ...s, _blindKoNoPrize: { ...(s._blindKoNoPrize ?? {}), [k]: true } };\n}\nexport function blindKoPrevented(state: GameState, ownerIdx: 0 | 1): boolean {\n  return !!state._blindKoNoPrize?.[ownerIdx === 0 ? 'p1' : 'p2'];\n}\n/** 被昏厥那隻的「基本獎賞張數」（koPrizeCount）再過 障眼法；回傳張數與要補的 log。 */\nexport function victimBasePrizes(\n  state: GameState, victim: CardInstance | null | undefined, victimCard: Card | undefined,\n  ownerIdx: 0 | 1, pool: Map<string, Card>,\n): { prizes: number; note: string | null } {\n  const note = blindKoNoPrizeNote(state, victim, victimCard, ownerIdx, pool);\n  if (note) return { prizes: 0, note };\n  return { prizes: victimCard ? koPrizeCount(victimCard) : 1, note: null };\n}\n// <<< v6672-blind-ko-no-prize\n\n// >>> v6471-ko-prize-modifiers\n",
   "\n// >>> v6471-ko-prize-modifiers\n"
  ],
  [
   "      && hasIronTracksDualCore(state, attackerIdx, attackerActive, attackerCard, pool)) return ['Fighting', 'Metal'];\n  const _printed = attackerCard?.pokemonType ? [attackerCard.pokemonType] : [];\n  // >>> v6672-sync-body\n  // ⭐v6.672 M7 變隱龍｜同步之軀：「只要這隻寶可夢在場上，除了原本的屬性外，還會擁有與自己的所有備戰寶可夢相同的屬性。\n  //   （若有寶可夢擁有2種以上的屬性，則每個屬性皆會擁有。）」⇒ 印刷屬性 ∪ 自己每一隻備戰寶可夢的**有效**屬性。\n  //   ⚠ 防遞迴：備戰裡也有同步之軀的變隱龍時，算它的屬性不再展開同步之軀（兩隻互相引用會無限遞迴）。\n  if (!_syncBodyDepth && attackerCard?.name === '變隱龍' && state && attackerIdx !== undefined\n      && _v6196HasEffAbilByInst(state, attackerIdx, attackerActive, pool, '同步之軀')) {\n    _syncBodyDepth = true;\n    try {\n      const out = new Set<string>(_printed);\n      for (const b of state.players[attackerIdx].bench) {\n        if (b.iid === attackerActive?.iid) continue;\n        for (const t of getAttackerEffectiveTypes(state, attackerIdx, b, pool.get(b.cardId), pool)) out.add(t);\n      }\n      return [...out];\n    } finally { _syncBodyDepth = false; }\n  }\n  // <<< v6672-sync-body\n  return _printed;\n}\n",
   "      && hasIronTracksDualCore(state, attackerIdx, attackerActive, attackerCard, pool)) return ['Fighting', 'Metal'];\n  return attackerCard?.pokemonType ? [attackerCard.pokemonType] : [];\n}\n"
  ],
  [
   "      && _v6196HasEffAbilByInst(state, attackerIdx, attackerActive, pool, '雙重屬性')) return ['Grass', 'Fire'];\n  // >>> v6672-m7-types\n  // ⭐v6.672 M7 托戈德瑪爾ex｜雙重屬性：「只要這隻寶可夢在場上，改為【雷】與【鋼】2種屬性。」（同狠辣椒ex 的寫法，以卡名分流）\n  //   ⚠ 同名的 MC 托戈德瑪爾ex 沒有這個特性 ⇒ 中央述詞會因為卡面沒有該特性而不成立。\n  if (attackerCard?.name === '托戈德瑪爾ex'\n      && _v6196HasEffAbilByInst(state, attackerIdx, attackerActive, pool, '雙重屬性')) return ['Lightning', 'Metal'];\n  // <<< v6672-m7-types\n  if (attackerActive && attackerCard\n",
   "      && _v6196HasEffAbilByInst(state, attackerIdx, attackerActive, pool, '雙重屬性')) return ['Grass', 'Fire'];\n  if (attackerActive && attackerCard\n"
  ],
  [
   " */\nlet _syncBodyDepth = false;   // ⭐v6.672 同步之軀防遞迴（單執行緒、函式內 set／finally 還原）\nexport function getAttackerEffectiveTypes(\n",
   " */\nexport function getAttackerEffectiveTypes(\n"
  ]
 ],
 "src/lib/game/effects/cards/maroon_dragon_deck.ts": [
  [
   "    //   脆弱蛻殼/道具/古舊卡面限「招式傷害」→特性KO不適用,故不走 koPrizesAdjusted、只加 deferred。\n    // ⭐v6.672 障眼法：對手無法獲得獎賞卡（連多餘花粉的 +N 也不給）\n    const _bnM = blindKoNoPrizeNote(s, target, targetCard, (1 - actorIdx) as 0 | 1, pool);\n    const prizes = _bnM ? 0 : (targetCard ? koPrizeCount(targetCard) : 1) + (target.deferredPrizeBonusThisTurn ?? 0);\n    if (_bnM) s = markBlindKoNoPrize(s, _bnM, (1 - actorIdx) as 0 | 1, isActive);\n    const players = [...s.players] as [PlayerState, PlayerState];\n",
   "    //   脆弱蛻殼/道具/古舊卡面限「招式傷害」→特性KO不適用,故不走 koPrizesAdjusted、只加 deferred。\n    const prizes = (targetCard ? koPrizeCount(targetCard) : 1) + (target.deferredPrizeBonusThisTurn ?? 0);\n    const players = [...s.players] as [PlayerState, PlayerState];\n"
  ],
  [
   "  koPrizeCount,\n  blindKoNoPrizeNote, markBlindKoNoPrize,   // ⭐v6.672 障眼法\n  isBenchProtected,\n",
   "  koPrizeCount,\n  isBenchProtected,\n"
  ]
 ],
 "src/lib/game/effects/cards/tools.ts": [
  [
   "  '重試徽章',\n  // ⭐v6.672 M7 牽絆披帶：TOOL_ON_KO handler 在 m7_wave3.ts（要用 isMegaExCard，本檔依 v6.402 不直接呼叫）\n  //   ⇒ 該模組載入時本 Set 已經 spread 完 ⇒ 名稱要顯式列在這裡，附加才有註冊。\n  '牽絆披帶',\n  ...TOOL_HP_BONUS.keys(),\n",
   "  '重試徽章',\n  ...TOOL_HP_BONUS.keys(),\n"
  ],
  [
   " */\nexport const TOOL_ON_KO_BENCH_ALSO = new Set<string>(['希望護身符', '牽絆披帶']);   // ⭐v6.672 牽絆披帶卡面也沒有「在戰鬥場」\n\n",
   " */\nexport const TOOL_ON_KO_BENCH_ALSO = new Set<string>(['希望護身符']);\n\n"
  ]
 ],
 "src/lib/game/effects/cards/v2750_h_wave2_full.ts": [
  [
   "  //   (對戰圓形/薄霧/球形盾牌等該擋)。逐指示物結算 + KO。\n  let s = addLog(state, `${label}：分配 ${totalCounters} 個指示物`, aIdx);\n  // ⭐v6.672：damage-distribute 的 payload 不經中央消毒（VALID_IIDS_GATE_EXEMPT）⇒ resolver 自己夾到卡面個數，\n  //   並只認對手場上的寶可夢（送多、送自己的 iid 都不會多放）。\n  const _oppIids = new Set([state.players[(1 - aIdx) as 0 | 1].active?.iid, ...state.players[(1 - aIdx) as 0 | 1].bench.map(b => b.iid)].filter(Boolean) as string[]);\n  for (const iid of iids.filter(i => _oppIids.has(i)).slice(0, totalCounters)) {\n    s = dealAttackDamageToTarget(s, aIdx, iid, 10, pool, { kind: 'attack-effect', label });\n    if (s.phase === 'game-over') return s;\n",
   "  //   (對戰圓形/薄霧/球形盾牌等該擋)。逐指示物結算 + KO。\n  let s = addLog(state, `詛咒水滴：分配 ${totalCounters} 個指示物`, aIdx);\n  for (const iid of iids) {\n    s = dealAttackDamageToTarget(s, aIdx, iid, 10, pool, { kind: 'attack-effect', label: '詛咒水滴' });\n    if (s.phase === 'game-over') return s;\n"
  ],
  [
   "  const totalCounters = (params?.totalCounters as number | undefined) ?? 4;\n  const label = (params?.label as string | undefined) ?? '詛咒水滴';   // ⭐v6.672 共用（M7 恰雷姆｜瑜伽之力）\n  // v5.440：改走中央 dealAttackDamageToTarget(attack-effect) — 原本完全沒套效果免疫 guard\n",
   "  const totalCounters = (params?.totalCounters as number | undefined) ?? 4;\n  // v5.440：改走中央 dealAttackDamageToTarget(attack-effect) — 原本完全沒套效果免疫 guard\n"
  ]
 ],
 "src/lib/game/effects/cards/v2998_g2.ts": [
  [
   "  const s = addLog(st,\n    `${label}：將對手的 ${placedNames.join('、')} 共 ${placedInsts.length} 張放置於對手備戰區`,\n    idx);\n",
   "  const s = addLog(st,\n    `邀請眨眼：將對手的 ${placedNames.join('、')} 共 ${placedInsts.length} 張放置於對手備戰區`,\n    idx);\n"
  ],
  [
   "  if (placedInsts.length === 0) {\n    return addLog(st, `${label}：所選不符條件`, idx);\n  }\n",
   "  if (placedInsts.length === 0) {\n    return addLog(st, '邀請眨眼：所選不符條件', idx);\n  }\n"
  ],
  [
   "  if (iids.length === 0) {\n    return addLog(st, `${label}：未選擇任何卡，效果結束`, idx);\n  }\n",
   "  if (iids.length === 0) {\n    return addLog(st, '邀請眨眼：未選擇任何卡，效果結束', idx);\n  }\n"
  ],
  [
   "regR('lillie-ribombee-invite-place', (st, idx, iids, _params, pool) => {\n  // ⭐v6.672 共用（M7 花舞鳥｜歡迎舞「最多3張」）：label／張數上限由 params 帶入；沒帶＝邀請眨眼原行為\n  const label = (_params?.label as string | undefined) ?? '邀請眨眼';\n  const capN = typeof _params?.maxPick === 'number' ? (_params.maxPick as number) : Infinity;\n  iids = [...new Set(iids)].slice(0, capN);   // ⭐v6.672 去重（同一 iid 送兩次會在對手備戰複製出同 iid 的寶可夢；審查 P2-4）\n  if (iids.length === 0) {\n",
   "regR('lillie-ribombee-invite-place', (st, idx, iids, _params, pool) => {\n  if (iids.length === 0) {\n"
  ]
 ],
 "src/lib/game/engine.ts": [
  [
   "      // <<< v6347-ability-gates\n      // >>> v6672-ability-gates\n      // ⭐v6.672 M7 主動特性的使用條件（判準①：條件不成立／效果完全無法執行 ⇒ 不給按鈕；USE_ABILITY 以本清單為準）\n      // 大食花｜酸液陷阱「若場上有自己的競技場卡，則在自己的回合時可使用1次。將對手的戰鬥寶可夢【中毒】與【灼傷】。」\n      //   ⚠「自己的競技場卡」＝自己打出的那張（activeStadiumOwnerIdx）；對手已經同時中毒＋灼傷 ⇒ 無事可做（站長 v6.132 裁定同型）。\n      if (ab.name === '酸液陷阱') {\n        if (!state.activeStadium || state.activeStadiumOwnerIdx !== state.activePlayerIndex) return;\n        const oppA = state.players[(1 - state.activePlayerIndex) as 0 | 1].active;\n        if (!oppA) return;\n        if (hasStatusInAnySlot(oppA, 'poisoned') && hasStatusInAnySlot(oppA, 'burned')) return;\n      }\n      // 列陣兵｜團結之陣「若這隻寶可夢在戰鬥場上…從牌庫附給自己的所有名稱中有『列陣兵』的備戰寶可夢各1張『基本【鬥】能量』卡。」\n      //   ⚠ 牌庫內容是隱藏資訊 ⇒ 只看張數；備戰沒有名稱含「列陣兵」的寶可夢 ⇒ 沒有對象。\n      if (ab.name === '團結之陣') {\n        if (player.active?.iid !== pk.iid) return;\n        if (player.deck.length === 0) return;\n        if (!player.bench.some(b => (pool.get(b.cardId)?.name ?? '').includes('列陣兵'))) return;\n      }\n      // 超級路卡利歐Zex｜波導探求者「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用1次。從自己的牌庫選擇1張支援者卡…」\n      if (ab.name === '波導探求者') {\n        if (player.active?.iid !== pk.iid) return;\n        if (player.deck.length === 0) return;\n      }\n      // 貓老大｜招財進寶「若自己的場上有2隻以上持有招式『聚寶功』的寶可夢，則在自己的回合時可使用1次。從自己的牌庫抽出2張卡。」\n      //   ⚠「持有招式」＝卡面印刷的招式（同 古空棘魚 的官方定義：道具／特性給的招式不算持有）。\n      if (ab.name === '招財進寶') {\n        const holders = allPokes.filter(c => pool.get(c.cardId)?.attacks?.some(a => a.name === '聚寶功')).length;\n        if (holders < 2) return;\n        if (player.deck.length === 0) return;\n      }\n      // <<< v6672-ability-gates\n      // v4.4996：4 組撞 key 卡的另一個 ability — 都是 passive HP 修飾或未實裝，不該顯示「使用特性」按鈕\n",
   "      // <<< v6347-ability-gates\n      // v4.4996：4 組撞 key 卡的另一個 ability — 都是 passive HP 修飾或未實裝，不該顯示「使用特性」按鈕\n"
  ],
  [
   "      if (!gate(state, idx, pool, card)) return;\n      out.push({ iid: inst.iid, abilityIndex: i, abilityName: ab.name, cardName: card.name, placesToBench: places });\n    });\n",
   "      if (!gate(state, idx, pool, card)) return;\n      out.push({ iid: inst.iid, abilityIndex: i, abilityName: ab.name, cardName: card.name });\n    });\n"
  ],
  [
   "      if (!gate) return;\n      const places = !HAND_ACTIVATE_NO_PLACEMENT.has(ab.name);\n      if (places && (benchFull || placementBlocked)) return;   // 「放備戰」型的兩道閘（原本在迴圈外，對全部生效）\n      if (isHandAbilityOncePerTurnUsed(me, ab.name, inst.iid)) return;\n",
   "      if (!gate) return;\n      if (isHandAbilityOncePerTurnUsed(me, ab.name, inst.iid)) return;\n"
  ],
  [
   "    //   USE_HAND_ABILITY handler 走同一份本函式 ⇒ 單點修、不會再漂移。\n    const placementBlocked = !!getHandPlacementBlockReason(state, idx, card, pool);\n    card.abilities.forEach((ab, i) => {\n",
   "    //   USE_HAND_ABILITY handler 走同一份本函式 ⇒ 單點修、不會再漂移。\n    if (getHandPlacementBlockReason(state, idx, card, pool)) continue;\n    card.abilities.forEach((ab, i) => {\n"
  ],
  [
   "  if (!me) return out;\n  // ⭐v6.672：「放備戰」型才看備戰上限與放置閘（震顫翅不放到場上）\n  const benchFull = me.bench.length >= getBenchLimit(state, idx, pool);\n  for (const inst of me.hand) {\n",
   "  if (!me) return out;\n  if (me.bench.length >= getBenchLimit(state, idx, pool)) return out;  // 這批全是「放備戰」型\n  for (const inst of me.hand) {\n"
  ],
  [
   "  pool: Map<string, Card>,\n): Array<{ iid: string; abilityIndex: number; abilityName: string; cardName: string; placesToBench: boolean }> {\n  const out: Array<{ iid: string; abilityIndex: number; abilityName: string; cardName: string; placesToBench: boolean }> = [];\n  if (state.phase !== 'playing' || state.turnPhase !== 'main') return out;\n",
   "  pool: Map<string, Card>,\n): Array<{ iid: string; abilityIndex: number; abilityName: string; cardName: string }> {\n  const out: Array<{ iid: string; abilityIndex: number; abilityName: string; cardName: string }> = [];\n  if (state.phase !== 'playing' || state.turnPhase !== 'main') return out;\n"
  ],
  [
   " */\n// >>> v6672-special-energy-hand-lock-pred\n/**\n * ⭐v6.672「這張手牌能量此刻能不能從手牌附上」的玩家層級封鎖（唯一一份；engine ATTACH_ENERGY 與 hand-card-ops 共用）。\n *   目前只有 超級阿勃梭魯Zex｜血紅恐懼 的「無法從手牌附上**特殊**能量卡」。基本能量不受影響。\n */\nexport function isHandEnergyAttachLocked(player: PlayerState, energyCard: Card | undefined): boolean {\n  return !!player.cantAttachSpecialEnergyFromHandThisTurn\n    && energyCard?.supertype === 'Energy' && energyCard.subtype === 'Special';\n}\n// <<< v6672-special-energy-hand-lock-pred\n\nexport function getHandActivatableAbilities(\n",
   " */\nexport function getHandActivatableAbilities(\n"
  ],
  [
   "};\n/** ⭐v6.672：手牌特性裡「不把這張卡放到場上」的（震顫翅）——不套備戰上限／放置閘，畫面標籤也不寫「放備戰」。 */\nexport const HAND_ACTIVATE_NO_PLACEMENT: ReadonlySet<string> = new Set(['震顫翅']);\n\n",
   "};\n\n"
  ],
  [
   "  },\n  // >>> v6672-hand-ability-shiver\n  // ⭐v6.672 M7 超音波幼蟲｜震顫翅：「若手牌有這張卡，則在自己的回合時可使用1次，若使用，則將這張卡丟棄。\n  //   查看自己的牌庫上方1張卡，回復原樣。」⇒ 牌庫 0 張時效果完全無法執行 ⇒ 不能使用（判準①）。\n  //   ⚠ 這一型**不放到場上** ⇒ 不受「備戰已滿」與「從手牌放置到場上」閘限制（見 HAND_ACTIVATE_NO_PLACEMENT）。\n  震顫翅: (s, idx, _pool, handCard) => {\n    if (!(handCard.abilities?.some(a => a.name === '震顫翅') ?? false)) return false;\n    return s.players[idx].deck.length > 0;\n  },\n  // <<< v6672-hand-ability-shiver\n};\n",
   "  },\n};\n"
  ],
  [
   "): GameState {\n  // >>> v6672-blind-ko-transient-in\n  // ⭐v6.672 進來時清掉障眼法記號殘留（舊存檔／外部帶進來的不可影響這個動作）\n  if (state._blindKoNoPrize !== undefined) { const _c0 = { ...state }; delete _c0._blindKoNoPrize; state = _c0; }\n  // <<< v6672-blind-ko-transient-in\n  if (state.phase === 'game-over') return state;\n",
   "): GameState {\n  if (state.phase === 'game-over') return state;\n"
  ],
  [
   "  let raw = applyActionImpl(state, action, pool);\n  // >>> v6672-blind-ko-transient\n  // ⭐v6.672 障眼法的 per-action 記號（_blindKoNoPrize）：只活在這一個動作裡。\n  //   ⚠ 必須在**最外層**清：applyActionImpl 尾段還有 drain／sanityKOSweep 等 KO 出口（複審 P2-1）。\n  //   進來時的殘留由 applyActionImpl 開頭清（見同名哨兵）。\n  if (raw._blindKoNoPrize !== undefined) { const _c1 = { ...raw }; delete _c1._blindKoNoPrize; raw = _c1; }\n  // <<< v6672-blind-ko-transient\n  // ⭐⭐⭐ v6.181 單一「拒絕出口」——「動作被拒絕」與「動作做了一半」從此不可能混淆。\n",
   "  let raw = applyActionImpl(state, action, pool);\n  // ⭐⭐⭐ v6.181 單一「拒絕出口」——「動作被拒絕」與「動作做了一半」從此不可能混淆。\n"
  ],
  [
   "    }\n    // >>> v6672-endturn-promote\n    // ⭐v6.672 血紅恐懼：promote nextIdx 的「無法從手牌附上特殊能量卡」（與上面競技場鎖同型）\n    if (nextP.cantAttachSpecialEnergyFromHandNextTurn) {\n      nextP.cantAttachSpecialEnergyFromHandThisTurn = true;\n      delete nextP.cantAttachSpecialEnergyFromHandNextTurn;\n    }\n    // <<< v6672-endturn-promote\n    // >>> v6356-endturn-promote\n",
   "    }\n    // >>> v6356-endturn-promote\n"
  ],
  [
   "      delete cp.karateKingBonusThisTurn;\n      // >>> v6672-endturn-clear-delete\n      delete cp.cantAttachSpecialEnergyFromHandThisTurn;   // ⭐v6.672 血紅恐懼\n      delete cp.korrinaFullPowerThisTurn;                  // ⭐v6.672 可爾妮的全力\n      // <<< v6672-endturn-clear-delete\n      delete cp.unrudaBonusThisTurn;\n",
   "      delete cp.karateKingBonusThisTurn;\n      delete cp.unrudaBonusThisTurn;\n"
  ],
  [
   "      currentPlayer.bagonElenaThisTurn ||\n      currentPlayer.cantPlayStadiumThisTurn ||\n      // >>> v6672-endturn-clear-cond\n      currentPlayer.cantAttachSpecialEnergyFromHandThisTurn ||\n      currentPlayer.korrinaFullPowerThisTurn\n      // <<< v6672-endturn-clear-cond\n    ) {\n",
   "      currentPlayer.bagonElenaThisTurn ||\n      currentPlayer.cantPlayStadiumThisTurn\n    ) {\n"
  ],
  [
   "        if (!isAbilityHolderEffective(workingState, attacker.active, attackerCard, aIdx, ab.name, 'active', pool)) continue;\n        if (buf.skipDefEffects) skipDefEffects = true;\n        if (buf.skipResistance) skipResistance = true;   // ⭐v6.672 練過的手臂（只跳抵抗力，弱點照算）\n      }\n",
   "        if (!isAbilityHolderEffective(workingState, attacker.active, attackerCard, aIdx, ab.name, 'active', pool)) continue;\n        skipDefEffects = true;\n      }\n"
  ],
  [
   "        const buf = PASSIVE_ATTACKER_BUFF.get(ab.name);\n        if (!buf?.skipDefEffects && !buf?.skipResistance) continue;\n        // ⭐ v6.202：原本**完全沒有** gate。波盪水ex 是「擁有規則的寶可夢」⇒\n",
   "        const buf = PASSIVE_ATTACKER_BUFF.get(ab.name);\n        if (!buf?.skipDefEffects) continue;\n        // ⭐ v6.202：原本**完全沒有** gate。波盪水ex 是「擁有規則的寶可夢」⇒\n"
  ],
  [
   "              `${atkNameForStatus} 陷入混亂，自身受到 30 傷害並昏厥！`, aIdx);\n            if (_bnX) s = markBlindKoNoPrize(s, _bnX, aIdx, true);   // ⭐v6.672 障眼法（log＋奇跡之吻不擲）\n            s = addPendingPrize(s, dIdx, koPrizes, pool);\n",
   "              `${atkNameForStatus} 陷入混亂，自身受到 30 傷害並昏厥！`, aIdx);\n            s = addPendingPrize(s, dIdx, koPrizes, pool);\n"
  ],
  [
   "            players[aIdx] = newAttacker;\n            // ⭐v6.672 障眼法（混亂自傷昏厥也擋；昏厥前的盤面 state 判）\n            const _bnX = blindKoNoPrizeNote(state, state.players[aIdx].active, atkCard, aIdx, pool);\n            const koPrizes = _bnX ? 0 : (atkCard ? prizesForKO(atkCard) : 1);\n            // v5.882：取獎收斂到中央 addPendingPrize(與一般 KO 一致):有正面朝上獎賞開逐張 picker 讓\n",
   "            players[aIdx] = newAttacker;\n            const koPrizes = atkCard ? prizesForKO(atkCard) : 1;\n            // v5.882：取獎收斂到中央 addPendingPrize(與一般 KO 一致):有正面朝上獎賞開逐張 picker 讓\n"
  ],
  [
   "    if (!isEnergy(energyCard.cardId, pool)) return state;\n    // >>> v6672-special-energy-hand-lock\n    // ⭐v6.672 血紅恐懼：本回合無法從手牌附上特殊能量卡（判準只有一份：isHandEnergyAttachLocked，UI 同用）\n    if (isHandEnergyAttachLocked(attacker, pool.get(energyCard.cardId))) return state;\n    // <<< v6672-special-energy-hand-lock\n\n",
   "    if (!isEnergy(energyCard.cardId, pool)) return state;\n\n"
  ],
  [
   "\n    // >>> v6672-battle-stadium\n    // ⭐v6.672 M7 戰鬥體育場「雙方玩家在每個自己的回合時，可使用1次，可將自己的所有寶可夢（「擁有規則的寶可夢」除外）各恢復「20」HP。」\n    //   ⚠ 判準①：沒有任何一隻能恢復（全是擁有規則的寶可夢或都沒受傷）⇒ 不能使用（退回使用權）。\n    //   ⚠ 恢復被擋（生命制約）、恢復量加倍（傳說的海溝）由 markHealsByDamageDecrease 中央處理。\n    if (stadiumCard.name === '戰鬥體育場') {\n      const p0 = newState.players[aIdx];\n      const okHeal = (c: CardInstance) => c.damage > 0 && !isRulePokemon(pool.get(c.cardId));\n      const all = [...(p0.active ? [p0.active] : []), ...p0.bench];\n      if (!all.some(okHeal)) {\n        const revert: [boolean, boolean] = [used[0], used[1]];\n        return addLog({ ...state, stadiumUsedThisTurn: revert }, '戰鬥體育場：沒有可以恢復HP的寶可夢（擁有規則的寶可夢除外）', aIdx);\n      }\n      const heal = (c: CardInstance) => okHeal(c) ? { ...c, damage: Math.max(0, c.damage - 20) } : c;\n      const updated = [...newState.players] as [PlayerState, PlayerState];\n      updated[aIdx] = { ...p0, active: p0.active ? heal(p0.active) : null, bench: p0.bench.map(heal) };\n      return addLog({ ...newState, players: updated }, '戰鬥體育場：自己的寶可夢（擁有規則的寶可夢除外）各恢復 20 HP', aIdx);\n    }\n    // <<< v6672-battle-stadium\n    // 居民會館 — 這回合打過支援者才能用，全體回 10 HP\n",
   "\n    // 居民會館 — 這回合打過支援者才能用，全體回 10 HP\n"
  ],
  [
   "  ) {\n    return addLog(state, `${state.festivalDancePendingSecondAttack.sourceName ?? '祭典樂舞'}：第 2 次招式 pending 期間，只能再用相同招式或結束回合`, state.activePlayerIndex);   // ⭐v6.672 二連打共用\n  }\n",
   "  ) {\n    return addLog(state, '祭典樂舞：第 2 次招式 pending 期間，只能再用相同招式或結束回合', state.activePlayerIndex);\n  }\n"
  ],
  [
   "    const card = pool.get(v.inst.cardId);\n    // ⭐v6.672 障眼法（寶可夢檢查的昏厥也擋；用丟棄前的盤面 koBoard 判）\n    const _bnC = blindKoNoPrizeNote(koBoard, v.inst, card, v.owner, pool);\n    if (_bnC) state = markBlindKoNoPrize(state, _bnC, v.owner, v.loc === 'active');\n    else owed[(1 - v.owner) as 0 | 1] += card ? prizesForKO(card) : 1;\n    state = addLog(state, `${card?.name ?? '?'} 因${causes[v.inst.iid] ?? '寶可夢檢查'}昏厥！`, null);\n",
   "    const card = pool.get(v.inst.cardId);\n    owed[(1 - v.owner) as 0 | 1] += card ? prizesForKO(card) : 1;\n    state = addLog(state, `${card?.name ?? '?'} 因${causes[v.inst.iid] ?? '寶可夢檢查'}昏厥！`, null);\n"
  ],
  [
   "    if (v.loc === 'active' && field(koBoard, v.owner).some(x => !deadIds.has(x.inst.iid))) {\n      // ⭐v6.672 障眼法：奇跡之吻在丟棄前處理 ⇒ 這裡直接傳「這隻不給獎賞」（盤面同 koBoard）\n      const _bnK = !!blindKoNoPrizeNote(koBoard, v.inst, pool.get(v.inst.cardId), v.owner, pool);\n      state = liftEndgameForOnKoV6361(miracleKissOnActiveFaint(state, v.owner, pool, _bnK));\n    }\n",
   "    if (v.loc === 'active' && field(koBoard, v.owner).some(x => !deadIds.has(x.inst.iid))) {\n      state = liftEndgameForOnKoV6361(miracleKissOnActiveFaint(state, v.owner, pool));\n    }\n"
  ],
  [
   "      player.discard = [...player.discard, ...koDiscard];\n      if (card && !_bnB) prizesAcc += prizesForKO(card);\n      s = addLog(s, koSweepLogLine(b, card?.name ?? '?', '備戰位', hp, _bnB ? 0 : (card ? prizesForKO(card) : 1)), null);\n      if (_bnB) s = markBlindKoNoPrize(s, _bnB, dIdx, false);\n      s = enqueueDiverCatch(s, dIdx, card?.name ?? '?', heldWaterB);\n",
   "      player.discard = [...player.discard, ...koDiscard];\n      if (card) prizesAcc += prizesForKO(card);\n      s = addLog(s, koSweepLogLine(b, card?.name ?? '?', '備戰位', hp, card ? prizesForKO(card) : 1), null);\n      s = enqueueDiverCatch(s, dIdx, card?.name ?? '?', heldWaterB);\n"
  ],
  [
   "      ];\n      const _bnB = blindKoNoPrizeNote(s, b, card, dIdx, pool);   // ⭐v6.672 障眼法\n      player.discard = [...player.discard, ...koDiscard];\n",
   "      ];\n      player.discard = [...player.discard, ...koDiscard];\n"
  ],
  [
   "      player.active = null;\n      if (card && !_bnA) prizesAcc += prizesForKO(card);\n      s = addLog(s, koSweepLogLine(ko, card?.name ?? '?', '戰鬥場', hp, _bnA ? 0 : (card ? prizesForKO(card) : 1)), null);\n      if (_bnA) s = markBlindKoNoPrize(s, _bnA, dIdx, true);\n      s = enqueueDiverCatch(s, dIdx, card?.name ?? '?', heldWaterA);\n",
   "      player.active = null;\n      if (card) prizesAcc += prizesForKO(card);\n      s = addLog(s, koSweepLogLine(ko, card?.name ?? '?', '戰鬥場', hp, card ? prizesForKO(card) : 1), null);\n      s = enqueueDiverCatch(s, dIdx, card?.name ?? '?', heldWaterA);\n"
  ],
  [
   "      ];\n      // ⭐v6.672 障眼法（昏厥前的盤面判：player 仍是本次掃描前的快照）\n      const _bnA = blindKoNoPrizeNote(s, ko, card, dIdx, pool);\n      player.discard = [...player.discard, ...koDiscard];\n",
   "      ];\n      player.discard = [...player.discard, ...koDiscard];\n"
  ],
  [
   "  let preventPrizeAll = false;\n  // >>> v6672-blind-ko-main\n  { const _bn = blindKoNoPrizeNote(newState, koInst, defenderCard, dIdx, pool);\n    if (_bn) { preventPrizeAll = true; newState = markBlindKoNoPrize(newState, _bn, dIdx, true); } }\n  // <<< v6672-blind-ko-main\n  if (!preventPrizeAll && defenderCard.abilities) {\n    for (const ab of defenderCard.abilities) {\n",
   "  let preventPrizeAll = false;\n  if (defenderCard.abilities) {\n    for (const ab of defenderCard.abilities) {\n"
  ],
  [
   "  const cleared: GameState = { ...state, festivalDancePendingSecondAttack: null };\n  return addLog(cleared, `${pending.sourceName ?? '祭典樂舞'}：第 2 次招式中斷（${reason}）`, pending.idx);   // ⭐v6.672\n}\n",
   "  const cleared: GameState = { ...state, festivalDancePendingSecondAttack: null };\n  return addLog(cleared, `祭典樂舞：第 2 次招式中斷（${reason}）`, pending.idx);\n}\n"
  ],
  [
   "  let s: GameState = { ...state, turnPhase: 'main' as const };\n  s = addLog(s, `${_daName}：請使用相同招式或點結束回合跳過第 2 次（其他動作禁止）`, pending.idx);\n  return s;\n",
   "  let s: GameState = { ...state, turnPhase: 'main' as const };\n  s = addLog(s, `祭典樂舞：請使用相同招式或點結束回合跳過第 2 次（其他動作禁止）`, pending.idx);\n  return s;\n"
  ],
  [
   "  }\n  if (_daName !== '二連打' && !hasFestivalVenue(state, pool)) {   // ⭐v6.672 二連打不需要祭典會場\n    return abortFestivalSecondAttack(state, '祭典會場已不在場');\n",
   "  }\n  if (!hasFestivalVenue(state, pool)) {\n    return abortFestivalSecondAttack(state, '祭典會場已不在場');\n"
  ],
  [
   "    const fdCard = pool.get(player.active.cardId);\n    if (isAbilityNullifiedByPassive(state, pending.idx, player.active, fdCard, _daName, 'active', pool)) {\n      return abortFestivalSecondAttack(state, `${_daName}特性被對手消除（暗夜羽擊）`);\n    }\n",
   "    const fdCard = pool.get(player.active.cardId);\n    if (isAbilityNullifiedByPassive(state, pending.idx, player.active, fdCard, '祭典樂舞', 'active', pool)) {\n      return abortFestivalSecondAttack(state, '祭典樂舞特性被對手消除（暗夜羽擊）');\n    }\n"
  ],
  [
   "  }\n  // <<< v6672-double-attack-keep\n  // v5.447：祭典樂舞被對手特性消除（振翼髮｜暗夜羽擊「對手戰鬥寶可夢的特性全部消除」）\n",
   "  }\n  // v5.447：祭典樂舞被對手特性消除（振翼髮｜暗夜羽擊「對手戰鬥寶可夢的特性全部消除」）\n"
  ],
  [
   "  }\n  // >>> v6672-double-attack-keep\n  const _daName = doubleAttackSourceName(state, pending.idx, pool);\n  if (_daName === '二連打') {\n    // ⭐v6.672 二連打：特性此刻還有效嗎（中央述詞含全部消除來源）\n    if (!hasDoubleAttackActive(state, pending.idx, pool)) return abortFestivalSecondAttack(state, '二連打特性已無效');\n  } else if (!hasFestivalDanceActive(state, pending.idx, pool)) {\n    return abortFestivalSecondAttack(state, '已無祭典樂舞特性');\n",
   "  }\n  if (!hasFestivalDanceActive(state, pending.idx, pool)) {\n    return abortFestivalSecondAttack(state, '已無祭典樂舞特性');\n"
  ],
  [
   "  //   pending 期間其他動作（附能、用支援者、放寶可夢、撤退、進化等）全被 handlePlaying gate 擋掉。\n  // >>> v6672-double-attack-log\n  next = addLog(next, doubleAttackSourceName(state, idx, pool) === '二連打'\n    ? `二連打：可再用相同招式 1 次或結束回合（其他動作禁止）`\n    : `祭典樂舞：場上有「祭典會場」— 可再用相同招式 1 次或結束回合（其他動作禁止）`, idx);\n  // <<< v6672-double-attack-log\n  return tryPromoteToMainForFestival(next, pool);\n",
   "  //   pending 期間其他動作（附能、用支援者、放寶可夢、撤退、進化等）全被 handlePlaying gate 擋掉。\n  next = addLog(next, `祭典樂舞：場上有「祭典會場」— 可再用相同招式 1 次或結束回合（其他動作禁止）`, idx);\n  return tryPromoteToMainForFestival(next, pool);\n"
  ],
  [
   "      originalCardId: attacker.cardId,\n      sourceName: doubleAttackSourceName(state, idx, pool),   // ⭐v6.672\n    },\n",
   "      originalCardId: attacker.cardId,\n    },\n"
  ],
  [
   "  if (state.phase !== 'playing' || state.turnPhase !== 'end') return state;\n  // >>> v6672-double-attack-window\n  if (!hasDoubleAttackActive(state, idx, pool)) return state;   // ⭐v6.672 祭典樂舞＋祭典會場，或巴布土撥｜二連打\n  // <<< v6672-double-attack-window\n\n",
   "  if (state.phase !== 'playing' || state.turnPhase !== 'end') return state;\n  if (!hasFestivalDanceActive(state, idx, pool)) return state;\n  if (!hasFestivalVenue(state, pool)) return state;\n\n"
  ],
  [
   "    if (overridden9 !== cost) cost = overridden9;\n    // >>> v6672-cheer-cost\n    // ⭐v6.672 M7 摔角鷹人｜振奮聲援：「只要這隻寶可夢在場上，自己的寶可夢使用招式『奮勇戰鬥』所需的能量，減少1個【無】能量。」\n    //   ⚠ 持有者是**場上另一隻**（不是出招者）⇒ 逐隻問中央 hasEffectiveAbilityByInst（特性此刻有效）。\n    //   ⚠ 卡面沒有「效果不會重複」⇒ 場上 N 隻有效的摔角鷹人就減 N 個【無】（【無】扣光為止，不扣有色）。\n    if (attackName === '奮勇戰鬥' && attackerIdx !== undefined) {\n      const _me = state.players[attackerIdx];\n      const holders = [...(_me.active ? [_me.active] : []), ..._me.bench]\n        .filter(x => hasEffectiveAbilityByInst(state, attackerIdx, x, pool, '振奮聲援')).length;\n      for (let k = 0; k < holders; k++) {\n        const ci = cost.lastIndexOf('Colorless' as EnergyType);\n        if (ci < 0) break;\n        cost = [...cost.slice(0, ci), ...cost.slice(ci + 1)];\n      }\n    }\n    // <<< v6672-cheer-cost\n  }\n",
   "    if (overridden9 !== cost) cost = overridden9;\n  }\n"
  ],
  [
   "    // <<< v6669-fishnet-groups\n    // >>> v6672-sanitize-dedupe-cap\n    // ⭐v6.672（審查 P2-3）：有宣告 validIids 的 picker 一律去重＋夾 maxCount（豁免型別已在上面原封放行）。\n    //   原本只做交集 ⇒ 改過的 client 送同一個 iid 兩次、或送超過上限的張數，resolver 照單全收（潛入補給、沙漠之風）。\n    const _seenV = new Set<string>();\n    const _outV = iids.filter((iid) => { if (_seenV.has(iid) || !allowSet.has(iid)) return false; _seenV.add(iid); return true; });\n    return typeof pending.maxCount === 'number' ? _outV.slice(0, Math.max(0, pending.maxCount)) : _outV;\n    // <<< v6672-sanitize-dedupe-cap\n  }\n",
   "    // <<< v6669-fishnet-groups\n    return iids.filter((iid) => allowSet.has(iid));\n  }\n"
  ],
  [
   "import { koTargetAfterAttackDamage, koAttackerAfterRetaliation } from './effects';\nimport { blindKoNoPrizeNote, markBlindKoNoPrize } from './effects';   // ⭐v6.672 九尾｜障眼法（任何原因昏厥都擋，唯一判準）\nimport { miracleKissOnActiveFaint } from './effects';   // ⭐v6.493 奇跡之吻唯一入口（任何原因的戰鬥寶可夢昏厥）   // ⭐v6.490 備戰昏厥共用（受害者被效果換到備戰區後才昏厥）\n",
   "import { koTargetAfterAttackDamage, koAttackerAfterRetaliation } from './effects';\nimport { miracleKissOnActiveFaint } from './effects';   // ⭐v6.493 奇跡之吻唯一入口（任何原因的戰鬥寶可夢昏厥）   // ⭐v6.490 備戰昏厥共用（受害者被效果換到備戰區後才昏厥）\n"
  ],
  [
   "//   下沉到 leaf `./festival`（只 import types 與 defense，兩邊都能 import、無循環）。\nimport { hasFestivalDanceActive, hasFestivalVenue, isFestivalDanceFirstAttack, hasDoubleAttackActive, doubleAttackSourceName } from './festival';   // ⭐v6.672 二連打 共用祭典樂舞狀態機\n// <<< v6410-festival-central-import\n",
   "//   下沉到 leaf `./festival`（只 import types 與 defense，兩邊都能 import、無循環）。\nimport { hasFestivalDanceActive, hasFestivalVenue, isFestivalDanceFirstAttack } from './festival';\n// <<< v6410-festival-central-import\n"
  ]
 ],
 "src/lib/game/festival.ts": [
  [
   "  if (!state.players[aIdx].active) return false;\n  if (!hasDoubleAttackActive(state, aIdx, pool)) return false;   // ⭐v6.672 祭典樂舞＋祭典會場，或二連打\n  if (state.festivalDanceUsedThisTurn?.[aIdx]) return false;\n",
   "  if (!state.players[aIdx].active) return false;\n  if (!hasFestivalDanceActive(state, aIdx, pool)) return false;\n  if (!hasFestivalVenue(state, pool)) return false;\n  if (state.festivalDanceUsedThisTurn?.[aIdx]) return false;\n"
  ],
  [
   "\n// >>> v6672-double-attack-central\n/**\n * ⭐⭐v6.672（站長裁定 2026-11-26：巴布土撥｜二連打「照祭典樂舞的做法」）：\n *   「這隻寶可夢可使用招式2次。（若對手的戰鬥寶可夢因第1次的招式而【昏厥】了，則在下一隻寶可夢放置後，使用第2次的招式。）」\n *   與祭典樂舞**同一個狀態機**（第 2 次只能用同一招、可按結束回合放棄、其他動作禁止、中斷條件相同），\n *   差別只有成立條件：祭典樂舞要場上有「祭典會場」，二連打不用。\n * ⚠ 「能不能打第 2 次」全站只問這一支（engine 開窗、維持窗口、首擊旗標保留）。\n */\nexport const DOUBLE_ATTACK_ABILITY = '二連打';\n\n/** 這一側的戰鬥寶可夢此刻能不能「使用招式2次」（祭典樂舞＋祭典會場，或二連打）。 */\nexport function hasDoubleAttackActive(\n  state: GameState, idx: 0 | 1, pool: Map<string, Card>,\n): boolean {\n  if (hasFestivalDanceActive(state, idx, pool) && hasFestivalVenue(state, pool)) return true;\n  return hasEffectiveAbilityByInst(state, idx, state.players[idx].active, pool, DOUBLE_ATTACK_ABILITY);\n}\n\n/** log 用：讓第 2 次招式成立的是哪一個特性（戰鬥寶可夢卡面上有的那個）。 */\nexport function doubleAttackSourceName(\n  state: GameState, idx: 0 | 1, pool: Map<string, Card>,\n): string {\n  const a = state.players[idx].active;\n  const c = a ? pool.get(a.cardId) : undefined;\n  return c?.abilities?.some((x) => x.name === DOUBLE_ATTACK_ABILITY) ? DOUBLE_ATTACK_ABILITY : FESTIVAL_DANCE_ABILITY;\n}\n// <<< v6672-double-attack-central\n\n/**\n",
   "\n/**\n"
  ]
 ],
 "src/lib/game/hand-card-ops.ts": [
  [
   "    if (handAbilityIids.has(inst.iid)) ops.add('hand-ability');\n    if (handAbilityUseIids.has(inst.iid)) ops.add('hand-ability-use');   // ⭐v6.672 震顫翅\n\n",
   "    if (handAbilityIids.has(inst.iid)) ops.add('hand-ability');\n\n"
  ],
  [
   "        && !(c.tags?.includes('ACE SPEC') && aceCancel)\n        && !isHandEnergyAttachLocked(me, c)   // ⭐v6.672 血紅恐懼（與 engine ATTACH_ENERGY 同一支述詞）\n        && !festivalPending) {\n",
   "        && !(c.tags?.includes('ACE SPEC') && aceCancel)\n        && !festivalPending) {\n"
  ],
  [
   "  const handAbilities = isMyTurn ? getHandActivatableAbilities(state, myIdx, pool) : [];\n  const handAbilityIids = new Set(handAbilities.filter(a => a.placesToBench).map(a => a.iid));\n  const handAbilityUseIids = new Set(handAbilities.filter(a => !a.placesToBench).map(a => a.iid));   // ⭐v6.672\n\n",
   "  const handAbilities = isMyTurn ? getHandActivatableAbilities(state, myIdx, pool) : [];\n  const handAbilityIids = new Set(handAbilities.map(a => a.iid));\n\n"
  ],
  [
   "  ['hand-ability', 'hand-ability'],\n  ['hand-ability-use', 'hand-ability'],\n];\n",
   "  ['hand-ability', 'hand-ability'],\n];\n"
  ],
  [
   "  'hand-ability': 'bench-empty',\n  'hand-ability-use': 'playmat',   // ⭐v6.672 與訓練家同一個釋放區（不佔備戰格）\n};\n",
   "  'hand-ability': 'bench-empty',\n};\n"
  ],
  [
   "  'energy', 'basic', 'basic-setup', 'setup-active', 'setup-active-swap',\n  'fossil', 'tool', 'trainer', 'evolve', 'hand-ability', 'hand-ability-use',\n] as const;\n",
   "  'energy', 'basic', 'basic-setup', 'setup-active', 'setup-active-swap',\n  'fossil', 'tool', 'trainer', 'evolve', 'hand-ability',\n] as const;\n"
  ],
  [
   "  | 'evolve'         // 進化到場上的某隻\n  | 'hand-ability'   // ⭐ 從手牌發動的特性（齒輪怪｜緊急迴轉、烈箭鷹ex｜激動俯衝…）＝把這張卡放到備戰區\n  | 'hand-ability-use';  // ⭐v6.672 從手牌發動、**不**放到場上的特性（超音波幼蟲｜震顫翅）＝拖到桌墊上使用\n\n",
   "  | 'evolve'         // 進化到場上的某隻\n  | 'hand-ability';  // ⭐ 從手牌發動的特性（齒輪怪｜緊急迴轉、烈箭鷹ex｜激動俯衝…）\n\n"
  ],
  [
   "  getBenchLimit,\n  isHandEnergyAttachLocked,   // ⭐v6.672 血紅恐懼\n} from './engine';\n",
   "  getBenchLimit,\n} from './engine';\n"
  ]
 ],
 "src/lib/game/selection-filter.ts": [
  [
   "  'Resistance:Fighting': (c) => c.supertype === 'Pokemon' && c.resistance?.type === 'Fighting',\n  // ⭐v6.672 M7 小卡比獸｜沉沉行進：「【撤退】所需的能量為4個的寶可夢卡」＝卡面印刷的撤退費剛好 4 個（牌庫裡的卡，沒有場上修正）\n  'RetreatCost4': (c) => c.supertype === 'Pokemon' && (c.retreatCost?.length ?? 0) === 4,\n  'ex':           (c) => isPokemonExCard(c),   // ⭐v6.403 收斂：卡面「寶可夢【ex】」唯一判準\n",
   "  'Resistance:Fighting': (c) => c.supertype === 'Pokemon' && c.resistance?.type === 'Fighting',\n  'ex':           (c) => isPokemonExCard(c),   // ⭐v6.403 收斂：卡面「寶可夢【ex】」唯一判準\n"
  ]
 ],
 "src/lib/game/types.ts": [
  [
   "  _surferDeferredDraw?: 0 | 1;\n  /**\n   * ⭐v6.672 九尾｜障眼法：本 action 內「被昏厥但對手無法獲得獎賞卡」的持有方（p1＝0、p2＝1）。\n   *   消費點：奇跡之吻（miracleKissOnActiveFaint）、KO 時多拿獎賞的招式（bonusPrizeIfKOPost）——卡面「對手也無法獲得獎賞卡」連加碼也不給。\n   *   ⚠ Transient：applyActionImpl 出口統一 delete（哨兵 v6672-blind-ko-transient）；寫入只走 effects.ts markBlindKoNoPrize。\n   */\n  _blindKoNoPrize?: { p1?: boolean; p2?: boolean };\n  _counterMoveSrcIids?: string[];  // v5.947 本 action 因「移動/改放傷害指示物」(非治療)而減傷的來源 iid;markHealsByDamageDecrease 跳過不誤標 healedThisTurn\n",
   "  _surferDeferredDraw?: 0 | 1;\n  _counterMoveSrcIids?: string[];  // v5.947 本 action 因「移動/改放傷害指示物」(非治療)而減傷的來源 iid;markHealsByDamageDecrease 跳過不誤標 healedThisTurn\n"
  ],
  [
   "   */\n  /** ⭐v6.672 sourceName：讓第 2 次成立的特性（'祭典樂舞'／'二連打'），log 用；舊資料沒有＝祭典樂舞。 */\n  festivalDancePendingSecondAttack?: { idx: 0 | 1; attackIndex: number; originalCardId: string; sourceName?: string } | null;\n  /**\n",
   "   */\n  festivalDancePendingSecondAttack?: { idx: 0 | 1; attackIndex: number; originalCardId: string } | null;\n  /**\n"
  ],
  [
   "  _lastCoinHeads?: number;\n  /**\n   * ⭐v6.672 M7「若希望，選擇1個…能量，將其丟棄。這個情況下，〔追加效果〕」：regPre 記下「這一次真的付了」的招式 key，\n   * 同招 regPost 讀它決定追加效果、讀完即清（transient；同一次 ATTACK 內 set→read）。\n   * 站長裁定（2026-11-26）：「這個情況下」＝要真的完成前段才有追加效果；身上沒有符合的能量就不能追加。\n   */\n  _attackOptInPaid?: string;\n  /**\n",
   "  _lastCoinHeads?: number;\n  /**\n"
  ],
  [
   "  /**\n   * ⭐v6.672 M7 超級阿勃梭魯Zex｜血紅恐懼：「在下個對手的回合，對手無法從手牌附上特殊能量卡，也無法使出競技場卡。」\n   * 由攻擊方設在對手身上（NextTurn），對手的回合開始時 promote 成 ThisTurn、對手 END_TURN 清除\n   * （與 cantPlayStadiumNextTurn 同一家族、同一個 promote／clear 位置）。玩家層級的封鎖 ⇒ 不受寶可夢的效果免疫影響。\n   */\n  cantAttachSpecialEnergyFromHandNextTurn?: boolean;\n  cantAttachSpecialEnergyFromHandThisTurn?: boolean;\n  /**\n   * ⭐v6.672 M7 可爾妮的全力（支援者）：「在這個回合，自己的『超級進化寶可夢【ex】』使用的招式，\n   * 對對手的戰鬥寶可夢造成的傷害，依對手已經獲得的獎賞卡每1張『+20』點。」本回合有效、END_TURN 清除。\n   * 張數在出招當下才數（打出支援者之後對手又拿獎賞也照當下張數）。\n   */\n  korrinaFullPowerThisTurn?: boolean;\n  /**\n   * ⭐v6.356 蟾蜍王｜撼盪拳（M6a 19982）—— 玩家級「下個自己的回合，每次從手牌使出訓練家卡前\n",
   "  /**\n   * ⭐v6.356 蟾蜍王｜撼盪拳（M6a 19982）—— 玩家級「下個自己的回合，每次從手牌使出訓練家卡前\n"
  ]
 ],
 "src/lib/version.ts": [
  [
   " */\nexport const VERSION = '6.672';\n",
   " */\nexport const VERSION = '6.671';\n"
  ]
 ],
 "src/routes/game/+page.svelte": [
  [
   "        {:else if dragging.kind==='tool'}🔧 拖到寶可夢附加\n        {:else if dragging.kind==='hand-ability'}{dragging.ops.includes('hand-ability-use') ? '⚡ 拖到桌墊發動特性' : '⚡ 拖到備戰空格發動特性'}\n        {/if}\n",
   "        {:else if dragging.kind==='tool'}🔧 拖到寶可夢附加\n        {:else if dragging.kind==='hand-ability'}⚡ 拖到備戰空格發動特性\n        {/if}\n"
  ],
  [
   "              <summary>🔍 對手手牌其餘 {otherHand.length} 張（本次不可選，僅供查看）</summary>\n              <div class=\"full-deck-note\">{pendingSelection.type==='hand-choose' ? '※ 只能選符合這個效果條件的卡；其餘手牌僅揭露供查看，不可選' : '※ 枇琶效果只能丟棄物品卡；其餘手牌（寶可夢 / 支援者 / 能量 / 道具 / 場地）僅揭露，不可選'}</div>\n              <div class=\"full-deck-list\">\n",
   "              <summary>🔍 對手手牌其餘 {otherHand.length} 張（本次不可選，僅供查看）</summary>\n              <div class=\"full-deck-note\">{pendingSelection.type==='hand-choose' ? '※ 相仿秀查看對手手牌後只能選 1 張「支援者」卡複製其效果；其餘手牌僅揭露供查看，不可選' : '※ 枇琶效果只能丟棄物品卡；其餘手牌（寶可夢 / 支援者 / 能量 / 道具 / 場地）僅揭露，不可選'}</div>\n              <div class=\"full-deck-list\">\n"
  ],
  [
   "            {:else if canHandActivate}<span class=\"hand-hint hl\">⚡ 拖到備戰發動特性</span>\n            {:else if canHandUse}<span class=\"hand-hint hl\">⚡ 拖到桌墊發動特性</span>\n            {:else if canEnergy}<span class=\"hand-hint hl\">⚡ 拖曳附加</span>\n",
   "            {:else if canHandActivate}<span class=\"hand-hint hl\">⚡ 拖到備戰發動特性</span>\n            {:else if canEnergy}<span class=\"hand-hint hl\">⚡ 拖曳附加</span>\n"
  ],
  [
   "          {@const canHandActivate = ops.has('hand-ability')}\n          {@const canHandUse = ops.has('hand-ability-use')}\n          {@const dragKind = handCardDragKind(ops)}\n",
   "          {@const canHandActivate = ops.has('hand-ability')}\n          {@const dragKind = handCardDragKind(ops)}\n"
  ],
  [
   "    for (const a of getHandActivatableAbilities(game, myIdx as 0 | 1, pool)) {\n      out.set(a.iid, { abilityName: a.abilityName, abilityIndex: a.abilityIndex, label: a.placesToBench ? `⚡ ${a.abilityName} (放備戰)` : `⚡ ${a.abilityName}` });   // ⭐v6.672\n    }\n",
   "    for (const a of getHandActivatableAbilities(game, myIdx as 0 | 1, pool)) {\n      out.set(a.iid, { abilityName: a.abilityName, abilityIndex: a.abilityIndex, label: `⚡ ${a.abilityName} (放備戰)` });\n    }\n"
  ],
  [
   "      }\n    } else if (op === 'hand-ability-use') {\n      // ⭐v6.672 超音波幼蟲｜震顫翅：從手牌發動、不放到場上 ⇒ 拖到桌墊（與訓練家同一個釋放區）就使用\n      const meta = handActivateAbilities.get(d.iid);\n      if (meta) await dispatch(GameActions.useHandAbility(d.iid, meta.abilityIndex));\n    } else if (op === 'hand-ability' && benchEmpty) {\n",
   "      }\n    } else if (op === 'hand-ability' && benchEmpty) {\n"
  ]
 ],
 "src/routes/game/MobilePortraitBattle.svelte": [
  [
   "        out.push({\n          label: a.placesToBench ? `⚡ ${a.abilityName} (放備戰)` : `⚡ ${a.abilityName}`,   // ⭐v6.672 震顫翅不放備戰\n          action: () => { closeSheet(); onAction(GameActions.useHandAbility(iid, a.abilityIndex)); },\n",
   "        out.push({\n          label: `⚡ ${a.abilityName} (放備戰)`,\n          action: () => { closeSheet(); onAction(GameActions.useHandAbility(iid, a.abilityIndex)); },\n"
  ],
  [
   "    // 機制 A: ON_DISCARD_FROM_HAND — 棄此卡觸發場上 trigger holder 特性\n    if (ops.has('hand-ability') || ops.has('hand-ability-use')) {   // ⭐v6.672 震顫翅\n      // ⚠⚠ v6.099 移除死按鈕：這裡原本硬編兩個「棄此卡 → 觸發 超能妙喵｜誘導之尾 /\n",
   "    // 機制 A: ON_DISCARD_FROM_HAND — 棄此卡觸發場上 trigger holder 特性\n    if (ops.has('hand-ability')) {\n      // ⚠⚠ v6.099 移除死按鈕：這裡原本硬編兩個「棄此卡 → 觸發 超能妙喵｜誘導之尾 /\n"
  ]
 ],
 "static/changelog-archive.html": [
  [
   "<details>\n        <summary><span class=\"ver-badge\">v6.633</span> <b>從牌庫直接進化的效果不能進化出海豚俠ex</b><br>雙卵細胞球「細胞進化」、人造細胞卵「細胞覺醒」、彩粉蝶「進化粉」不能再從牌庫把波普海豚進化成海豚俠ex。</summary>\n        <div class=\"log-body\">海豚俠ex 的特性「全能靈魂」寫明「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上」。之前雙卵細胞球的「細胞進化」、人造細胞卵的「細胞覺醒」、彩粉蝶的「進化粉」這類從牌庫選進化卡直接進化的招式，可以把波普海豚進化成海豚俠ex，與卡面不符；現在這些招式的選卡清單不會再出現海豚俠ex。（上一版已依官方判例修正百變怪「整人變身」不能換上海豚俠ex，這次把同一句卡面的其他效果一起改好。）</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.632</span> <b>依 30th CELEBRATION 官方判例修正 3 個卡牌判定</b><br>依官方最新公布的「30th CELEBRATION」判例逐條比對，修正夢幻ex借用反撲剪、甜甜螢對化隱的弱點計算、百變怪整人變身的候選。</summary>\n",
   "<details>\n        <summary><span class=\"ver-badge\">v6.632</span> <b>依 30th CELEBRATION 官方判例修正 3 個卡牌判定</b><br>依官方最新公布的「30th CELEBRATION」判例逐條比對，修正夢幻ex借用反撲剪、甜甜螢對化隱的弱點計算、百變怪整人變身的候選。</summary>\n"
  ]
 ],
 "static/changelog-bodies.html": [
  [
   "<div class=\"log-body\" data-ver=\"v6.634\">海豚俠ex 的特性「全能靈魂」寫明「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上」。之前這幾個招式選卡時可以把海豚俠ex 直接放上備戰區，與卡面不符；現在選卡清單不會再出現海豚俠ex（查看牌庫上方的招式仍然看得到它，只是不能選）。上一版已修正從牌庫直接進化的招式，這次把放上備戰區的招式一起改好。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n",
   "<div class=\"log-body\" data-ver=\"v6.634\">海豚俠ex 的特性「全能靈魂」寫明「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上」。之前這幾個招式選卡時可以把海豚俠ex 直接放上備戰區，與卡面不符；現在選卡清單不會再出現海豚俠ex（查看牌庫上方的招式仍然看得到它，只是不能選）。上一版已修正從牌庫直接進化的招式，這次把放上備戰區的招式一起改好。</div>\n<div class=\"log-body\" data-ver=\"v6.633\">海豚俠ex 的特性「全能靈魂」寫明「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上」。之前雙卵細胞球的「細胞進化」、人造細胞卵的「細胞覺醒」、彩粉蝶的「進化粉」這類從牌庫選進化卡直接進化的招式，可以把波普海豚進化成海豚俠ex，與卡面不符；現在這些招式的選卡清單不會再出現海豚俠ex。（上一版已依官方判例修正百變怪「整人變身」不能換上海豚俠ex，這次把同一句卡面的其他效果一起改好。）</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n"
  ],
  [
   "<div class=\"log-body\" data-ver=\"v6.659\"><ul><li><b>總勝場統計（排除單機 AI）</b>：計算已結束的真人線上對戰（具正式房號且排除第 1 回合未進場判負）與錦標賽勝場總和（排除輪空／缺席），顯示於頭像上方左側的 <code>⚔️ 總勝 X 勝</code>。</li><li><b>點擊切換顯示與隱藏</b>：於名片編輯器點選「⚔️ 總勝」、「🏛️ 網站賽」、「🎖️ 社群賽」徽章即可直覺切換是否對外展示，即時同步預覽與名片檢視。</li><li><b>下載與分享專屬名片</b>：檢視自己的名片（或預覽）時可點擊「📥 下載名片」儲存高解析圖片，或「🔗 分享名片」複製專屬網址；透過連結開啟名片後可直接點擊「＋ 加好友」（訪客會先引導登入後自動回到名片頁）。</li><li><b>特殊頭像外框展示</b>：支援顯示官方授予管理員、優勝選手或活動紀念等玩家的專屬頭像外框，於名片與對戰先後攻列同步呈現。</li></ul></div>\n<div class=\"log-body\" data-ver=\"v6.658\">修正登入、存檔與排序期間的牌組同步狀態；舊版來源未明的牌組保留本機備份，可下載後匯入。</div>\n",
   "<div class=\"log-body\" data-ver=\"v6.658\">修正登入、存檔與排序期間的牌組同步狀態；舊版來源未明的牌組保留本機備份，可下載後匯入。</div>\n"
  ]
 ],
 "static/changelog.html": [
  [
   "      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n",
   "      </details>\n      <details data-ver=\"v6.633\">\n        <summary><span class=\"ver-badge\">v6.633</span> <b>從牌庫直接進化的效果不能進化出海豚俠ex</b><br>雙卵細胞球「細胞進化」、人造細胞卵「細胞覺醒」、彩粉蝶「進化粉」不能再從牌庫把波普海豚進化成海豚俠ex。</summary>\n      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n"
  ],
  [
   "        <summary><span class=\"ver-badge\">v6.659</span> <b>名片新增總勝場、點擊切換統計、下載圖檔與分享連結</b><br>個人名片新增真人線上總勝場（排除單機 AI）、設定區點一下統計徽章即可切換顯示／隱藏、本人可下載名片圖檔並複製分享連結讓其他人查看與加好友。</summary>\n      </details>\n",
   "        <summary><span class=\"ver-badge\">v6.659</span> <b>名片新增總勝場、點擊切換統計、下載圖檔與分享連結</b><br>個人名片新增真人線上總勝場（排除單機 AI）、設定區點一下統計徽章即可切換顯示／隱藏、本人可下載名片圖檔並複製分享連結讓其他人查看與加好友。</summary>\n        <div class=\"log-body\"><ul><li><b>總勝場統計（排除單機 AI）</b>：計算已結束的真人線上對戰（具正式房號且排除第 1 回合未進場判負）與錦標賽勝場總和（排除輪空／缺席），顯示於頭像上方左側的 <code>⚔️ 總勝 X 勝</code>。</li><li><b>點擊切換顯示與隱藏</b>：於名片編輯器點選「⚔️ 總勝」、「🏛️ 網站賽」、「🎖️ 社群賽」徽章即可直覺切換是否對外展示，即時同步預覽與名片檢視。</li><li><b>下載與分享專屬名片</b>：檢視自己的名片（或預覽）時可點擊「📥 下載名片」儲存高解析圖片，或「🔗 分享名片」複製專屬網址；透過連結開啟名片後可直接點擊「＋ 加好友」（訪客會先引導登入後自動回到名片頁）。</li><li><b>特殊頭像外框展示</b>：支援顯示官方授予管理員、優勝選手或活動紀念等玩家的專屬頭像外框，於名片與對戰先後攻列同步呈現。</li></ul></div>\n      </details>\n"
  ],
  [
   "      </details>\n      <details data-ver=\"v6.659\">\n        <summary><span class=\"ver-badge\">v6.659</span> <b>名片新增總勝場、點擊切換統計、下載圖檔與分享連結</b><br>個人名片新增真人線上總勝場（排除單機 AI）、設定區點一下統計徽章即可切換顯示／隱藏、本人可下載名片圖檔並複製分享連結讓其他人查看與加好友。</summary>\n",
   "      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.659</span> <b>名片新增總勝場、點擊切換統計、下載圖檔與分享連結</b><br>個人名片新增真人線上總勝場（排除單機 AI）、設定區點一下統計徽章即可切換顯示／隱藏、本人可下載名片圖檔並複製分享連結讓其他人查看與加好友。</summary>\n"
  ],
  [
   "<details open>\n        <summary><span class=\"ver-badge\">v6.672</span> <b>新擴充包「波導探求者」上架</b><br>12 月 4 日發售的擴充包「波導探求者」（M7）78 張卡已加入卡牌資料庫，全部卡片效果都已實裝，可以直接組牌、對戰。</summary>\n        <div class=\"log-body\">・新增 78 張（J 標）：超級路卡利歐Zex、超級阿勃梭魯Zex、超級烈咬陸鯊Zex、超級晶光花ex、蜥蜴王ex、浮潛鼬ex、象徵鳥ex、托戈德瑪爾ex 等。\n・新訓練家：牽絆披帶、可爾妮的全力、吉憲的熱血、記者、戰鬥體育場。\n・同時補上官方新公布的 M-P 特典卡 15 張（波導探求者同名卡與基本能量）與「30th CELEBRATION」高編號卡 4 張（杖尾鱗甲龍、超夢ex、夢幻ex、耿鬼ex）。\n・超音波幼蟲｜震顫翅：手牌的這張卡拖到桌墊上就能發動。\n・巴布土撥｜二連打：比照「祭典樂舞」，同一個招式可以再使用第 2 次。\n・卡面寫「這個情況下」的追加效果（例：連擊武道熊師｜水流連打），要真的完成前面的動作才會發生。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.671</span> <b>瑞士輪未到場且已有敗場，自動棄賽</b><br>玩家建議：瑞士輪常常有人輸了之後就不再出現，對手每輪都要空等。改成未到場時若之前已有 1 敗以上，就自動棄賽、後續輪次不再排入配對。</summary>\n",
   "<details open>\n        <summary><span class=\"ver-badge\">v6.671</span> <b>瑞士輪未到場且已有敗場，自動棄賽</b><br>玩家建議：瑞士輪常常有人輸了之後就不再出現，對手每輪都要空等。改成未到場時若之前已有 1 敗以上，就自動棄賽、後續輪次不再排入配對。</summary>\n"
  ]
 ],
 "static/site-version.txt": [
  [
   "6.672\n",
   "6.671\n"
  ]
 ]
};
// 僅以本版獨有的錨點識別版本（含 v6.672 字樣的片段）。
const V6672_MARKERS = {"oracle-admin/admin.html": [0], "src/lib/cards/regulation.ts": [0], "src/lib/game/ai-energy.ts": [0, 1, 2], "src/lib/game/ai-slowking.ts": [0], "src/lib/game/ai.ts": [0, 2, 3], "src/lib/game/copy-attack.ts": [0, 1, 2], "src/lib/game/effects.ts": [0, 2, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42], "src/lib/game/effects/cards/maroon_dragon_deck.ts": [0, 1], "src/lib/game/effects/cards/tools.ts": [0, 1], "src/lib/game/effects/cards/v2750_h_wave2_full.ts": [0, 1], "src/lib/game/effects/cards/v2998_g2.ts": [3], "src/lib/game/engine.ts": [0, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 24, 26, 27, 28, 30, 32, 33, 34, 35, 36, 37, 38, 39, 40], "src/lib/game/festival.ts": [0, 1], "src/lib/game/hand-card-ops.ts": [0, 1, 2, 4, 6, 7], "src/lib/game/selection-filter.ts": [0], "src/lib/game/types.ts": [0, 1, 2, 3], "src/lib/version.ts": [0], "src/routes/game/+page.svelte": [4, 5], "src/routes/game/MobilePortraitBattle.svelte": [0, 1], "static/changelog-archive.html": [0], "static/changelog-bodies.html": [0, 1], "static/changelog.html": [3], "static/site-version.txt": [0]};

export function revertV6672IfPresent(path, source) {
  let text = normEol(String(source));
  const pairs = V6672_PAIRS[path];
  if (!pairs || V6672_MARKERS[path].every((index) => !text.includes(pairs[index][0]))) return text;
  for (const [index, [from, to]] of pairs.entries()) {
    assert.equal(text.split(from).length, 2, 'v6672 還原錨點變動 ' + path + ' #' + (index + 1));
    text = text.replace(from, () => to);
  }
  return text;
}
