/**
 * v3.08 Deferred Wave C — Group 3 剩餘 4 張最複雜 deferred passive
 *
 * 來源：v3.0 Group 3 Wave 2（v3000_g3_wave2.ts）標 deferred 的 4 張難度最高的特性。
 * 本波依複雜度分 Tier 處理：Tier 1+2（3 張）完整實裝；Tier 3（1 張）保留 deferred。
 *
 * 涵蓋本波 4 張：
 *
 *   Tier 1（簡單，本波實裝）
 *
 *   1. 超甲狂犀｜廣域堡壘（H）
 *      卡面：「只要這隻寶可夢在戰鬥場上，對手從手牌使出支援者卡時，
 *             自己的所有寶可夢不會受到那個效果的影響。」
 *
 *      實作策略：擴充 isImmuneToOppTrainer 路徑（v3060_deferred_wave_b 提供）—
 *        新增 helper isImmuneToOppSupporter(state, defenderIdx, targetInst, pool)
 *        內部 OR：
 *          a. v3.06 個別免疫特性（緊張感 / 融合為雪）— 寶可夢自身的 ability
 *          b. v3.08 廣域堡壘 — 自方戰鬥場有此特性持有者 → 整個自方場上免疫支援者
 *      只擋【支援者】(Supporter)，不擋【物品】(Item) — 卡面文義限定。
 *
 *      涵蓋的 supporter resolvers（共 2 張高頻 Gust 系列已使用 helper）：
 *        - 老大的指令（supporters_gust.ts）— 改 import 為 isImmuneToOppSupporter
 *        - 老大的指令（烏羽）（v168_supporters.ts）— 同上
 *
 *      頂尖捕捉器是 Item 類，繼續用舊 isImmuneToOppTrainer（不擋廣域堡壘）。
 *
 *   2. 美納斯｜平穩境地（H）
 *      卡面：「只要這隻寶可夢在場上，對手的場上寶可夢與那隻寶可夢身上附加的所有卡，
 *             無法放回手牌。」
 *
 *      實作策略：簡化版 Phase 1 — 只擋「對手寶可夢/附加卡 → 對手手牌」這條路徑
 *        （自方寶可夢回自方手牌不受影響）。加入 helper：
 *          oppHasMenasureCalmGround(state, ownerIdx, pool)
 *            = 1-ownerIdx 場上是否有美納斯（場上 active 或 bench）；ownerIdx 是
 *              「正在嘗試把『他的對手』寶可夢/附加卡放回他對手手牌」的玩家。
 *
 *      涵蓋的 hook（5-6 張高頻效果）：
 *        - 念力土偶｜退化光線（v2354_j_mark_batch.ts）— 進化卡回對手手牌
 *        - 超能豔鴕｜奧密之眼（v2760_h_wave3_complex.ts）— 進化卡回對手手牌
 *        - 始祖大鳥｜原始之翼（v2996_g4_wave2.ts）— 進化卡回對手手牌
 *        - 悠哉尾草棒（items_misc.ts）— 對手能量回對手手牌
 *        - 毒粉蛾｜微風吹拂（v2996_g4_wave2.ts）— 對手能量回對手手牌
 *        - returnOppActiveEnergyPost（effects.ts 共用 helper）— 招式 post
 *           涵蓋多張卡：高傲雉雞｜反轉之風 等
 *
 *      Phase 2 deferred：其他零散「對手寶可夢回手」散點（牌庫頂操控、特殊狀態強迫
 *        棄場、招式效果回手）若有遺漏可逐一補上。
 *
 *   Tier 2（中等，本波實裝）
 *
 *   3. 古空棘魚｜潛入記憶（H）
 *      卡面：「只要這隻寶可夢在場上，自己的所有進化寶可夢，
 *             可使用進化前持有的所有招式。需要有足夠使用招式的能量。」
 *
 *      實作策略：擴展 engine.ts 的 getEffectiveAttacks —
 *        - 條件：自方場上（含 active 與 bench）有古空棘魚 +
 *                inst 是進化卡（evolvedFromStack 至少 1 張）
 *        - 動作：把 evolvedFromStack 中每張 cardId 對應的 attacks 全部累加進
 *                effective attacks list，sourceCardName = 進化前卡名 + 'isFromTool'=false
 *        - cost 與 effectKey 沿用各自卡面定義；UI / canAffordAttack 不需改
 *          （getEffectiveAttacks 已被 ATTACK / getAvailableAttacks / UI 三方共用）。
 *
 *      此處只 export helper getAttacksFromEvolvedFromStack — 由 engine.ts 在
 *      getEffectiveAttacks 內呼叫合併到 result list。
 *
 *   Tier 3（最複雜，v3.20 已完整實裝）
 *
 *   4. 洛托姆ex｜多重轉接（I） — [v3.20 IMPLEMENTED]
 *      卡面：「只要這隻寶可夢在場上，名稱中有『洛托姆』的自己的所有寶可夢，
 *             各自身上最多可附有 2 張『寶可夢道具』卡。
 *             （這個特性消除時，將身上多附的『寶可夢道具』卡丟棄。）」
 *
 *      v3.20 實作：
 *        - CardInstance 加 extraTools?: CardInstance[]（最多 1 張，總共 2 張道具）
 *        - tools.ts attach-tool resolver：toolAttached 已滿時，若 holder 為「洛托姆」
 *          家族 + 自方場上有「洛托姆ex 多重轉接」啟用 → push 進 extraTools
 *        - _shared.ts helper：getAllAttachedTools / hasMultiToolRelay /
 *          isLotomFamily / reconcileMultiToolRelay
 *        - engine.ts / effects.ts：所有 KO discard / TOOL_xxx hook iterate /
 *          retreat / END_TURN_DISCARD / 道具拆除器 / 進化保留 等全面 iterate
 *        - reconcile：在每次 applyAction 末尾（enforceBenchLimit 之後）檢查；
 *          若場上沒有洛托姆ex 多重轉接，所有 extraTools 立即丟到棄牌堆
 *          （卡面「特性消除時，將身上多附的道具丟棄」）。
 *
 * 設計：
 *   - Iron Rule 12：本檔不對 effects.ts 內 Map 做 .set()（純 helper / 不註冊
 *     trainer/ability），register function 仍保留（空 body）以保持模板一致；
 *     effects.ts 末端呼叫即可。
 *   - 規則 11：本檔為**全新檔案**，使用 Write 工具 OK；既有檔的修改全走 Python pipeline。
 */

import type { Attack, Card } from '$lib/cards/types';
import { isAbilityHolderEffective } from './v3001_g3_wave3'; // v5.985 特性生效性中央述詞
import type { CardInstance, GameState, PlayerState } from '../../types';
import { isImmuneToOppTrainer } from './v3060_deferred_wave_b';

// 導出 sentinel 防止 unused import warnings
export type _v3080Sentinel = PlayerState | GameState | Card | CardInstance | Attack;

// ════════════════════════════════════════════════════════════════════════════
// 1. 超甲狂犀｜廣域堡壘 — 擴展對手 supporter 免疫
// ════════════════════════════════════════════════════════════════════════════

/**
 * 自方戰鬥場是否有「廣域堡壘」持有者（=超甲狂犀 在戰鬥場）。
 *
 * 卡面要求「只要這隻寶可夢在戰鬥場上」— 故只檢查 active，不檢查 bench。
 *
 * @param state       目前 GameState
 * @param defenderIdx 受保護方（自方寶可夢的 owner index）
 * @param pool        卡池
 * @returns true → defenderIdx 整個場上對對手 supporter 免疫
 */
export function hasBroadFortressOnActive(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || defenderIdx == null || !pool) return false;
  const a = state.players[defenderIdx]?.active;
  if (!a) return false;
  const card = pool.get(a.cardId);
  if (!card?.abilities?.some(ab => ab.name === '廣域堡壘')) return false;
  // ⭐ v6.202：原本只擋 abilityNullifiedThisTurn **一種**來源。超甲狂犀 stage='Stage2'
  //   ⇒【傳說的熔岩洞】「雙方場上所有進化寶可夢的特性全部消除」打得到它；
  //   持有者依卡面必在戰鬥場 ⇒ passive 振翼髮｜暗夜羽擊 亦然。改走 v6.196 中央述詞。
  return isAbilityHolderEffective(state, a, card, defenderIdx, '廣域堡壘', 'active', pool);
}

/**
 * v3.08 對手 Supporter 免疫綜合判斷 helper。
 *
 * 判定 targetInst（屬於 defenderIdx 方）是否對「對手從手牌使出的支援者卡」免疫。
 * 由 supporter resolver 在過濾候選池時呼叫。
 *
 * 條件（OR）：
 *   1. v3.06：targetInst 自身具有「緊張感 / 融合為雪」— 該寶可夢個別免疫對手 trainer
 *   2. v3.08：defenderIdx 戰鬥場有「廣域堡壘」(超甲狂犀) — 整個 defenderIdx 場上對 Supporter 免疫
 *
 * @param state       目前 GameState
 * @param defenderIdx targetInst 所屬玩家 index（被保護的「自方」方）
 * @param targetInst  被指定的寶可夢
 * @param pool        卡池
 * @returns true → 該 supporter 不可指定此 targetInst 為目標
 */
export function isImmuneToOppSupporter(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  targetInst: CardInstance | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!pool) return false;
  // v3.21 條件 0：陳舊的鰭之化石（J）— 卡面「不會受到對手的支援者卡的影響」。
  //   之前僅在 supporters_gust.ts 兩處內聯過濾，其他走 isImmuneToOppSupporter
  //   的 supporter resolver 沒涵蓋 → 整合到此 helper 首行。未來新增召叫類 supporter
  //   只要走此 helper 自動 cover 鰭之化石免疫。
  if (targetInst?.fossilOnField) {
    const fossilCard = pool.get(targetInst.cardId);
    if (fossilCard?.name === '陳舊的鰭之化石') return true;
  }
  // 條件 1：v3.06 個別免疫特性
  if (isImmuneToOppTrainer(targetInst, pool)) return true;
  // 條件 2：v3.08 廣域堡壘整體免疫
  if (hasBroadFortressOnActive(state, defenderIdx, pool)) return true;
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 美納斯｜平穩境地 — 對手寶可夢與附加卡無法放回手牌
// ════════════════════════════════════════════════════════════════════════════

/**
 * v5.985 美納斯｜平穩境地 — 「場上卡→手牌」單一中央述詞。
 *
 * 卡面(SV6/SV8a,H)：「只要這隻寶可夢在場上，**對手的**場上寶可夢與那隻寶可夢身上附加的卡，
 *   全部無法放回手牌。」＝以美納斯**持有者**視角保護「持有者的對手方」的場上卡。
 *
 * ⭐判準(Wilson 提供官方 Q&A 裁定，取代 v3.08 反向實作)：
 *   **被放回手牌的那張卡，其「持有者」的對手側若有生效中的平穩境地 → 該回手被擋。**
 *   與「誰發動效果」無關。
 *   - Q：自己的美納斯有效時，可用自己的奧密之眼把對手進化寶可夢退化嗎？→ 不可以
 *     (被回手的是對手的卡；對手的對手＝我方有美納斯 → 擋)
 *   - Q：對手的美納斯生效中，自己【水】寶可夢昏厥時可用潛者捕捉把身上基本【水】能量回手嗎？→ 不行
 *     (被回手的是我方的卡；我方的對手＝對手有美納斯 → 擋)
 *   - Q：對手有平穩境地，丟棄的「燃料火能量」可用其效果從棄牌區回手嗎？→ 可以
 *     (**只保護「場上」的卡**；棄牌區/牌庫→手牌不受限)
 *
 * ⚠舊名 oppHasMenasureCalmGround(傳「發動者」idx、查發動者的對手側)方向相反，已刪除不保留
 *   wrapper——保留舊名必再被誤用。新卡一律走本述詞，傳「被回手卡的持有者 idx」。
 *
 * @param cardOwnerIdx 被放回手牌那張卡的持有者(非發動者)
 * @returns true → 此回手動作被阻擋
 */
// v5.988：平穩境地「場上卡→手牌」述詞移至 v3001_g3_wave3(與其依賴 isAbilityHolderEffective 同檔)，
//   杜絕 engine.ts 反向 import 卡檔造成的模組初始化循環(TDZ)。此處 re-export 供既有卡檔/effects 沿用。
export { hasEffectiveCalmGroundOnSide, isReturnToHandBlockedByCalmGround } from './v3001_g3_wave3';

// ════════════════════════════════════════════════════════════════════════════
// 3. 古空棘魚｜潛入記憶 — 自方進化寶可夢可用進化前所有招式
// ════════════════════════════════════════════════════════════════════════════

/**
 * 自方場上（active+bench）是否有「古空棘魚」（持有「潛入記憶」特性）。
 *
 * @param player 自方 PlayerState
 * @param pool   卡池
 */
export function hasArchaeoglobinDiveMemory(
  player: PlayerState | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!player || !pool) return false;
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    if (!card?.abilities) return false;
    // v2.362：abilityNullifiedThisTurn 旗標 → 暫時被消除，視為無此特性
    if (c.abilityNullifiedThisTurn) return false;
    return card.abilities.some(ab => ab.name === '潛入記憶');
  });
}

/**
 * 取得 inst.evolvedFromStack 中所有卡片的 attacks（向下展開到基礎）。
 *
 * 範例：
 *   inst = 沙奈朵ex（Stage 2）
 *   evolvedFromStack = [基拉祈幼蟲(Basic), 奇魯莉安(Stage 1)]
 *   回傳：基拉祈幼蟲的 attacks + 奇魯莉安的 attacks
 *
 * 卡面允許「使用進化前『持有的所有』招式」— 全部累加，不去重（重名時兩套都列）。
 * 各招式的 cost 沿用該卡面定義。
 *
 * @param inst 進化寶可夢 CardInstance
 * @param pool 卡池
 * @returns Array of { atk, sourceCardName }（caller 端用 isFromTool=false 補入）
 */
export function getAttacksFromEvolvedFromStack(
  inst: CardInstance | undefined,
  pool: Map<string, Card> | undefined,
): { atk: Attack; sourceCardName: string }[] {
  if (!inst || !pool) return [];
  const stack = inst.evolvedFromStack ?? [];
  if (stack.length === 0) return [];
  const result: { atk: Attack; sourceCardName: string }[] = [];
  for (const lower of stack) {
    const lowerCard = pool.get(lower.cardId);
    if (!lowerCard?.attacks?.length) continue;
    for (const atk of lowerCard.attacks) {
      result.push({ atk, sourceCardName: lowerCard.name });
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 洛托姆ex｜多重轉接 — [DEFERRED v3.08]
//
// 卡面：「只要這隻寶可夢在場上，名稱中有『洛托姆』的自己的所有寶可夢，
//        各自身上最多可附有 2 張『寶可夢道具』卡。
//        （這個特性消除時，將身上多附的『寶可夢道具』卡丟棄。）」
//
// 為何 deferred：
//   - 資料結構：CardInstance.toolAttached 為單一 CardInstance，要支援 2 張需改為
//     array 或新增 secondaryToolAttached 欄位
//   - 影響面：grep toolAttached 共 200+ 處引用點，需全部 loop 處理
//   - 清理邏輯：特性消除（如 鎮魂歌 / 冷風）時要把多附的道具自動棄
//
// 後續 wave 將處理：
//   1. CardInstance.toolAttached: CardInstance | CardInstance[] | null（型別擴充）
//   2. ATTACH_TOOL handler：增加「洛托姆 系列 + 洛托姆ex 在場 + 已附 1 張」分支
//   3. 各 TOOL_* hook 改 normalize 成 array 處理
//   4. 特性消除掛 hook：自動把多附道具 discard
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// 註冊器 — Iron Rule 12 規範
//
// 本檔為純 helper 模組，無對 effects.ts 內 Map 做 .set()，因此 register 函式為
// 空 body；保留以維持 wave 模板一致性，effects.ts 末端仍 import + 呼叫。
// ════════════════════════════════════════════════════════════════════════════

let _v3080Registered = false;

export function registerV3080DeferredWaveC(): void {
  if (_v3080Registered) return; // idempotent
  _v3080Registered = true;
  // 本波無對 effects.ts 內 Map 的 .set() 需要做。
  // 所有 helper 由 effects.ts / engine.ts / 既有 cards 子檔 直接 import 後使用。
}
