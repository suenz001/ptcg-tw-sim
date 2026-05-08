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
 *   Tier 3（最複雜，標 deferred）
 *
 *   4. 洛托姆ex｜多重轉接（I） — [DEFERRED v3.08]
 *      卡面：「只要這隻寶可夢在場上，名稱中有『洛托姆』的自己的所有寶可夢，
 *             各自身上最多可附有 2 張『寶可夢道具』卡。
 *             （這個特性消除時，將身上多附的『寶可夢道具』卡丟棄。）」
 *
 *      Defer 原因：
 *        - 資料結構：CardInstance.toolAttached 為單一 CardInstance，要支援 2 張
 *          需改為 array 或新增 secondaryToolAttached 欄位
 *        - 影響面廣（grep toolAttached ≈ 200+ 處引用）— 整個 ATTACH_TOOL /
 *          TOOL_ON_DAMAGED / TOOL_PRIZE_BONUS / 取獎賞時 tool 棄牌邏輯 等所有
 *          tool hook 都要改 loop 處理
 *        - 卡面括號內的清理規則「特性消除時棄掉多附的道具」也需新邏輯
 *
 *      留待獨立 wave（v3.09 或之後）做完整資料結構重構與全面 hook 適配。
 *
 * 設計：
 *   - Iron Rule 12：本檔不對 effects.ts 內 Map 做 .set()（純 helper / 不註冊
 *     trainer/ability），register function 仍保留（空 body）以保持模板一致；
 *     effects.ts 末端呼叫即可。
 *   - 規則 11：本檔為**全新檔案**，使用 Write 工具 OK；既有檔的修改全走 Python pipeline。
 */

import type { Attack, Card } from '$lib/cards/types';
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
  if (!card?.abilities) return false;
  // v2.362：abilityNullifiedThisTurn 旗標 → 暫時被消除，視為無此特性
  if (a.abilityNullifiedThisTurn) return false;
  return card.abilities.some(ab => ab.name === '廣域堡壘');
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
 * 「對手場上是否有美納斯（平穩境地）」— 用於阻止『對手寶可夢/附加卡 → 對手手牌』。
 *
 * 命名解釋：ownerIdx 是「執行回手動作的玩家」（=想把『他的對手』寶可夢回手），
 *   檢查 1-ownerIdx（=他的對手）場上是否有美納斯。
 *   舉例：
 *     - 玩家 A 用「奧密之眼」想把對手 B 的進化卡回 B 手 → ownerIdx=A，檢查 B 場上美納斯
 *     - 玩家 A 用「悠哉尾草棒」把對手 B 的能量回 B 手 → ownerIdx=A，檢查 B 場上美納斯
 *
 * 美納斯位置：active 或 bench 任一即可（卡面「在場上」）。
 *
 * @param state    目前 GameState
 * @param ownerIdx 執行回手動作的玩家 index
 * @param pool     卡池
 * @returns true → 此回手動作被阻擋
 */
export function oppHasMenasureCalmGround(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const oppIdx = (1 - ownerIdx) as 0 | 1;
  const opp = state.players[oppIdx];
  if (!opp) return false;
  const all: CardInstance[] = [...(opp.active ? [opp.active] : []), ...opp.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    if (!card?.abilities) return false;
    // v2.362：被消除的特性（如冷風 / 鎮魂歌）— 視為失效
    if (c.abilityNullifiedThisTurn) return false;
    return card.abilities.some(ab => ab.name === '平穩境地');
  });
}

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
