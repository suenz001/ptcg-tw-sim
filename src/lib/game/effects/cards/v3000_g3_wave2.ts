/**
 * v3.0 Group 3 Wave 2 — 10 張對手互動 / 特殊機制 passive 特性
 *
 * 來源：ABILITY_AUDIT_V2_98.md Group 3 Wave 2（持續性 passive）
 *
 * 實裝分布：
 *   A. 受傷免疫類（3 張）
 *      1. 蟲甲聖｜球形盾牌    — 場上有此卡 → 自方備戰寶可夢免疫對手招式的傷害與效果（本波實裝）
 *      2. 超甲狂犀｜廣域堡壘  — 戰鬥場上 → 對手支援者效果不影響自方寶可夢
 *         [DEFERRED]：需逐張支援者 resolver 內部加「對自方寶可夢的 effect」精細 gate；
 *           直接禁出整張會違反卡面（卡面允許出，只是不影響自方寶可夢）。
 *      3. 美納斯｜平穩境地    — 場上有此卡 → 對手場上寶可夢與附加卡無法放回手牌
 *         [DEFERRED]：影響面廣（越橘的一步棋 / 親送無人機 / 各種搜尋回手卡），
 *           需在「目標=對手寶可夢/其附加卡 → 放回手牌」的所有 hook 全面加 gate。
 *
 *   B. 狀態強化（1 張）
 *      4. 鴨嘴炎獸｜熔岩波動  — 場上有此卡 → 對手【灼傷】因灼傷放置的指示物 +3 個（本波實裝）
 *         注意：是「對手身上『鴨嘴炎獸』在場時，對手的灼傷寶可夢受到的灼傷傷害 +3 指示物」
 *         即：鴨嘴炎獸（攻擊方）→ 增加對手（被灼傷方）的灼傷傷害。
 *         hook：engine.ts 的灼傷 newBurnDmg 計算處（line 4131），
 *           當 oIdx（=對手，即灼傷加害方）場上有鴨嘴炎獸時，dmg = 50 而非 20。
 *
 *   C. KO 後觸發（2 張）
 *      5. 獵斑魚｜潛者捕捉    — 自方場上有此卡 + 自方【水】寶可夢被招式 KO →
 *         該寶可夢身上「基本【水】能量」放回手牌而非棄牌（本波實裝）
 *         hook：engine.ts 的招式 KO 路徑，在 koDiscard 組裝後過濾出基本水並 push 到 hand。
 *      6. 波克基斯｜奇跡之吻  — 自方場上有此卡 + 對手戰鬥位被 KO →
 *         擲幣 1 次，正面 +1 獎賞（本波實裝；卡面明文「不重複」）
 *         hook：engine.ts 的招式 KO 路徑，於計算 prizes 處加 hook bonus。
 *
 *   D. 規則 / 機制（4 張）
 *      7. 美洛耶塔ex｜出道演出 — 該寶可夢（attacker active）為美洛耶塔ex 時，
 *         先攻最初回合也可使用招式（本波實裝）
 *         hook：engine.ts ATTACK handler + getAvailableAttacks 的「先攻最初回合不能攻擊」
 *           gate，加 helper bypass。
 *      8. 古空棘魚｜潛入記憶  — 場上有此卡 → 自方進化寶可夢可使用「進化前持有的所有招式」
 *         [DEFERRED]：需 getEffectiveAttacks / canAffordAttack / UI 路徑全面合併
 *           evolvedFromStack 之卡片招式集合；招式名顯示與選擇 UI 都要改。
 *      9. 洛托姆ex｜多重轉接  — 場上有此卡 → 自方「洛托姆」可附 2 張道具
 *         [DEFERRED]：CardInstance.toolAttached 為單一物件，要改 array；
 *           整個 ATTACH_TOOL / TOOL_ON_DAMAGED / TOOL_PRIZE_BONUS 等所有 tool hook
 *           都要 loop 處理。資料結構大改動，獨立 wave 處理。
 *     10. 瑪機雅娜｜自動治癒  — 戰鬥場上有此卡 + 從手牌附能量到任何寶可夢 → 被附目標 +90 HP
 *         （本波實裝；hook 在 engine.ts 的 ATTACH_ENERGY 後）
 *
 * 設計：
 *   - 本檔集中提供 helper（hasBugAegislashShield / hasMagmarFlowing 等）讓
 *     engine.ts 引用，避免邏輯散落在多處。
 *   - 「球形盾牌」走 effects.ts resolveBenchGuard 路徑（已有對戰圓形 / 花之帷幔
 *     pattern）以 inline helper 實作。
 *   - 「奇跡之吻」走 PASSIVE_ON_KO 不適用（PASSIVE_ON_KO 是 defenderCard 的 ability，
 *     而波克基斯是 KO 同陣營非 defender），故 inline 在 engine.ts KO loop 中走自方場上掃描。
 *   - 「潛者捕捉」同上，inline 在 engine.ts KO 路徑掃自方場上獵斑魚。
 *   - Iron Rule 12：所有對 effects.ts 內 Map 的 .set() 必須包進 register() function，
 *     由 effects.ts 自己 body 末端呼叫。
 */

import type { CardInstance, GameState } from '../../types';
import type { Card } from '$lib/cards/types';

// 導出 sentinel 防止 unused import warnings（與 v2999 同模式）
export type _v3000G3W2Sentinel = GameState | Card | CardInstance;

// ════════════════════════════════════════════════════════════════════════════
// 共用 helper：場上 ability holder 偵測
// ════════════════════════════════════════════════════════════════════════════

/**
 * 是否「玩家 idx 場上（active+bench）」有任何寶可夢具有指定 ability 名稱。
 * 用於團體 buff/debuff 的「場上有 1+」型條件判斷。
 */
function hasAbilityOnSide(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
  abilityName: string,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const owner = state.players[ownerIdx];
  const all = [...(owner.active ? [owner.active] : []), ...owner.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    return card?.abilities?.some(a => a.name === abilityName);
  });
}

/** 玩家 idx 戰鬥場上是否為指定 ability 名稱的持有者。 */
function hasAbilityOnActive(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
  abilityName: string,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const a = state.players[ownerIdx].active;
  if (!a) return false;
  const card = pool.get(a.cardId);
  return !!card?.abilities?.some(ab => ab.name === abilityName);
}

// ════════════════════════════════════════════════════════════════════════════
// A1. 蟲甲聖｜球形盾牌
//
// 卡面：「只要這隻寶可夢在場上，自己的所有備戰寶可夢不會受到對手的寶可夢招式
//        的傷害與效果的影響。」
//
// 範圍：
//   - 持有者：場上（active 或 bench）有任一蟲甲聖。
//   - 受惠：自方所有「備戰」寶可夢（active 不在保護範圍）。
//   - 擋下類型：對手【招式】的【傷害】+【效果】(放指示物 / 異常狀態 / 拔能量 / 等)。
//   - 不擋：特性效果（如咒詛炸彈）— 卡面明文限制「招式」。
//
// hook：engine.ts 的 resolveBenchGuard 加分支（kind='attack-damage' 或 'attack-effect'
//   時皆檢查），在 defenderIdx 場上有球形盾牌 → blocked。
// ════════════════════════════════════════════════════════════════════════════
export function hasBugAegislashShield(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  return hasAbilityOnSide(state, defenderIdx, pool, '球形盾牌');
}

// ════════════════════════════════════════════════════════════════════════════
// B4. 鴨嘴炎獸｜熔岩波動
//
// 卡面：「只要這隻寶可夢在場上，對手的【灼傷】的寶可夢因【灼傷】而放置的傷害
//        指示物的數量增加 3 個。」
//
// 範圍：
//   - 持有者：擁有此特性的玩家場上（=灼傷加害方視角）有任一鴨嘴炎獸。
//   - 受影響：對手身上正在進行灼傷寶可夢檢查時。
//   - 額外：+3 個指示物 = +30 傷害（基礎 20 → 50）。
//
// hook：engine.ts 的「灼傷 newBurnDmg = damage + 20」計算處；
//   當 oIdx（=對手 / 灼傷加害方）場上有鴨嘴炎獸時，回傳 +30 額外傷害。
//
// 疊加：v5.188 玩家回報應該疊加 — 卡面「只要『這隻』寶可夢在場上...指示物的數量增加 3 個」
//   「這隻」表示每隻獨立計算，2 隻 = +6 指示物 = +60 傷害，與灰塵山「不重複」明文無關。
//   修法：count 場上鴨嘴炎獸數量 × 30 (= 3 個指示物)
// ════════════════════════════════════════════════════════════════════════════
export function magmarFlowingBurnBonus(
  state: GameState | undefined,
  oppIdx: 0 | 1 | undefined,  // 灼傷加害方（鴨嘴炎獸的擁有者）
  pool: Map<string, Card> | undefined,
): number {
  if (!state || oppIdx == null || !pool) return 0;
  const owner = state.players[oppIdx];
  const all = [...(owner.active ? [owner.active] : []), ...owner.bench];
  let count = 0;
  for (const c of all) {
    const card = pool.get(c.cardId);
    if (card?.abilities?.some(a => a.name === '熔岩波動')) count++;
  }
  return count * 30;
}

// ════════════════════════════════════════════════════════════════════════════
// C5. 獵斑魚｜潛者捕捉
//
// 卡面：「每次當自己的【水】寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，
//        可使用 1 次。【昏厥】的寶可夢身上附加的『基本【水】能量』卡不丟棄，
//        而是全部放回手牌。」
//
// 範圍：
//   - 持有者：自方場上（含 active 或 bench）有任一獵斑魚。
//   - 受惠：被招式 KO 的自方寶可夢，且該寶可夢屬性為【水】。
//   - 動作：身上「基本【水】能量」(基本能量 + pokemonType=Water + name 含『水』)
//          從 koDiscard 移到 hand。
//
// hook：engine.ts KO 路徑，在 koDiscard 組裝後攔截過濾基本水。
//
// 疊加：卡面「每次當…可使用 1 次」— 是觸發頻率限制，不是「場上多隻只 1 次」。
//   每次招式 KO 都觸發（每次都把全部基本水回手）；此 helper 不需 NO_STACK。
// ════════════════════════════════════════════════════════════════════════════

/** 篩選：cardId 對應的卡是否為「基本【水】能量」。 */
export function isBasicWaterEnergy(cardId: string, pool: Map<string, Card>): boolean {
  const c = pool.get(cardId);
  if (!c) return false;
  if (c.supertype !== 'Energy') return false;
  if (c.subtype !== 'Basic') return false;
  // 基本能量的 pokemonType === 'Water' 即可（卡名通常是「基本【水】能量」）
  return c.pokemonType === 'Water';
}

/** 自方場上是否有「獵斑魚｜潛者捕捉」可觸發 — defender 屬性必須是【水】。 */
export function canRelicanthDiverCatchTrigger(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  defenderCard: Card | null | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || defenderIdx == null || !defenderCard || !pool) return false;
  // defender 必須是【水】寶可夢
  if (defenderCard.pokemonType !== 'Water') return false;
  return hasAbilityOnSide(state, defenderIdx, pool, '潛者捕捉');
}

// ════════════════════════════════════════════════════════════════════════════
// C6. 波克基斯｜奇跡之吻
//
// 卡面：「只要這隻寶可夢在場上，每次當對手的戰鬥寶可夢【昏厥】時，自己擲 1 次硬幣。
//        若為正面，則多獲得 1 張獎賞卡。無論有多少隻擁有這個特性的寶可夢，
//        這個效果也不會重複。」
//
// 範圍：
//   - 持有者：自方場上（含 active 或 bench）有任一波克基斯。
//   - 觸發：對手「戰鬥位」寶可夢被任何方式 KO（招式 / 灼傷 / 中毒 等都算）。
//     注意：嚴格按卡面「對手的戰鬥寶可夢昏厥」— 對手備戰被 KO（罕見）不觸發。
//   - 效果：擲幣，正面 +1 獎賞。
//   - 卡面明文「不重複」→ 場上多隻仍擲 1 次。
//
// 本 helper 只判斷「是否觸發 + 持有者陣營 idx」；engine 自行擲幣 + 加獎賞。
//
// hook：engine.ts 招式 KO 路徑（也可在灼傷 / 毒 KO 路徑加，但本波先做招式 KO；
//   其他 KO 路徑由後續 wave 補）。
// ════════════════════════════════════════════════════════════════════════════
export function canTogekissMiracleKissTrigger(
  state: GameState | undefined,
  attackerIdx: 0 | 1 | undefined,  // 攻擊方（波克基斯的擁有者；KO 對手戰鬥位的人）
  pool: Map<string, Card> | undefined,
): boolean {
  return hasAbilityOnSide(state, attackerIdx, pool, '奇跡之吻');
}

// ════════════════════════════════════════════════════════════════════════════
// D7. 美洛耶塔ex｜出道演出
//
// 卡面：「這隻寶可夢在先攻玩家的最初回合也可使用招式。」
//
// 範圍：
//   - 持有者：「這隻寶可夢」=美洛耶塔ex 自己（即攻擊發動者必須是美洛耶塔ex）。
//   - 解除：先攻第一回合不能攻擊的引擎限制（state.isFirstTurn && aIdx === firstPlayerIdx）。
//
// hook：engine.ts ATTACK handler 與 getAvailableAttacks 的 first-turn gate，
//   增加 bypass：attacker.active 是美洛耶塔ex 且擁有「出道演出」特性 → 解除限制。
// ════════════════════════════════════════════════════════════════════════════
// v5.214 Bug 3：招式名稱白名單 — 卡面標記「這個招式在先攻玩家的最初回合也可使用」
//   audit 全卡池共 2 招：信使鳥|急速之禮 + 卡璞・鳴鳴|急速飛行。
//   engine.ts ATTACK + getAvailableAttacks 雙路徑檢查此白名單，bypass first-turn gate。
export const FIRST_TURN_USABLE_ATTACKS = new Set<string>([
  '急速之禮',    // 信使鳥
  '急速飛行',    // 卡璞・鳴鳴
  '早熟進化',    // 蛋蛋（v5.460 audit 補；卡面「這個招式可在先攻玩家的最初回合使用」）
  '急速信號',    // 電螢蟲（v5.460 audit 補；同上標記，亦在 BENCH_FILL_ATTACK_NAMES）
]);

export function hasMeloettaExDebut(
  inst: CardInstance | null | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!inst || !pool) return false;
  const card = pool.get(inst.cardId);
  if (!card) return false;
  // 卡面「這隻寶可夢」= 美洛耶塔ex 自己（其他 attacker 不適用）
  if (!card.abilities?.some(a => a.name === '出道演出')) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// D10. 瑪機雅娜｜自動治癒
//
// 卡面：「只要這隻寶可夢在戰鬥場上，每次從自己的手牌將能量卡附於寶可夢身上時，
//        將那隻寶可夢恢復『90』HP。」
//
// 範圍：
//   - 持有者：自方戰鬥場上有瑪機雅娜（自動治癒）。注意：戰鬥場 only，不是全場。
//   - 觸發：自己（持有者陣營）從手牌附能量到任何寶可夢（含瑪機雅娜本人 / active / bench）
//   - 效果：被附能量的寶可夢恢復 90 HP（damage 減 90，但不低於 0）。
//
// 注意：卡面「從自己的手牌」→ 不是「從棄牌堆 / 牌庫」附加。能量輸送 / 能量回收 等
//   把能量從別處附加的招式不算（但本 helper 已由 ATTACH_ENERGY action 觸發點限定）。
//
// hook：engine.ts ATTACH_ENERGY handler 末端，附完能量後呼叫此 helper 算回血量。
// ════════════════════════════════════════════════════════════════════════════
export function magearnaAutoHealAmount(
  state: GameState | undefined,
  attacherIdx: 0 | 1 | undefined,  // 從手牌附能量的玩家
  pool: Map<string, Card> | undefined,
): number {
  // 戰鬥場上必須是瑪機雅娜（自動治癒）才生效
  return hasAbilityOnActive(state, attacherIdx, pool, '自動治癒') ? 90 : 0;
}

// ════════════════════════════════════════════════════════════════════════════
// v3.0 register pattern（Iron Rule 12）
//
// 本檔目前的 helpers 都是 inline 用法（engine.ts 內 import 後呼叫），
// 沒有對 effects.ts 內 Map 做 .set() — 因此實際上不需要 register 函式，
// 但仍提供一個空的 register 函式以保持 wave 模板一致；effects.ts 仍呼叫此函式
// 即可（本波無 .set() 需要做，函式體為空）。
//
// 未來若要加 PASSIVE_ATTACK_BONUS / PASSIVE_DAMAGE_REDUCE_COND 等的 .set()，
// 可在此函式內加；不會踩 v2.999 的 ESM TDZ 坑。
// ════════════════════════════════════════════════════════════════════════════

let _v3000G3W2Registered = false;

export function registerV3000G3W2Passives(): void {
  if (_v3000G3W2Registered) return; // idempotent
  _v3000G3W2Registered = true;
  // 本波無對 effects.ts 內 Map 的 .set() 需要做；helpers 全部走 engine.ts inline import。
}
