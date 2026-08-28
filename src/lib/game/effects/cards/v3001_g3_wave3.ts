/**
 * v3.01 Group 3 Wave 3 — 14 張最複雜 passive 特性（多需新 hook）
 *
 * 來源：ABILITY_AUDIT_V2_98.md Group 3 Wave 3。本波是 Group 3 系列最後一波，
 * 主要實裝「對手不能使出 X」/「對手特性消除」/「寶可夢檢查時放指示物」/
 * 「對手戰鬥寶可夢回備戰時觸發」/「對手手牌進化時觸發」等需要全新 hook 的特性。
 *
 * 實裝分布：
 *   A. 對手不能使出 X 類（3 張，全本波實裝）
 *      1. 大王銅象｜爆大身軀         — 戰鬥場時，對手無法從手牌使出競技場卡
 *      2. 火箭隊的阿柏怪｜瞪眼效用   — 戰鬥場時，對手不可從手牌將「擁有特性的寶可夢」
 *                                     （『火箭隊的寶可夢』除外）放置於場上（含 PLAY_BASIC + EVOLVE）
 *      3. 胖嘟嘟ex｜海之詛咒         — 戰鬥場時，對手無法從手牌使出『物品』卡，
 *                                     也無法附上『寶可夢道具』卡
 *
 *   B. 對手特性消除類（2 張，全本波實裝）
 *      4. 振翼髮｜暗夜羽擊（Passive） — 戰鬥場時，對手戰鬥寶可夢的特性（『暗夜羽擊』除外）全部消除
 *         注：此特性與既有招式「振翼髮｜暗夜羽擊」（M2 / SV5K 招式版本）同名但是
 *           寶可夢上的 Ability。本波處理 ability index=0 的 passive 版。
 *      5. 海兔獸｜黏著束縛           — 在備戰區時，雙方備戰區的【2 階進化】寶可夢的特性全部消除
 *
 *   C. 寶可夢檢查時放指示物類（2 張，全本波實裝；「冰冷之帳」雪妖女已於 v2.70 實裝過）
 *      6. 雪妖女｜冰冷之帳           — 已於 engine.ts L4275 寶可夢檢查段落實裝；本檔不重複
 *      7. 火箭隊的班基拉斯｜揚沙     — 戰鬥場時，每次寶可夢檢查時，對手所有【基礎】寶可夢 +2 指示物
 *
 *   D. 對手戰鬥寶可夢回備戰時觸發類（3 張，本波實裝範圍 = RETREAT 路徑）
 *      8. 熔岩蝸牛｜熔岩地域         — 場上時，對手回合對手戰鬥寶可夢回備戰 → 新上場【灼傷】
 *      9. 夢妖魔ex｜漩渦言靈         — 戰鬥場時，對手回合對手戰鬥寶可夢回備戰 → 新上場【混亂】
 *     10. 火箭隊的三地鼠｜凹洞       — 場上時，對手回合對手戰鬥寶可夢回備戰 → 那隻寶可夢 +2 指示物
 *      [部分 defer]：「對手戰鬥寶可夢回備戰」目前只 hook 在 RETREAT；其他換場路徑
 *      （招式效果 SwitchActive、特性效果 SwitchActive、被吹回 等）暫時不觸發。卡面文字
 *      未限定撤退，但我方 RETREAT 是最常見的場景，其他換場路徑零散需後續逐一補上。
 *
 *   E. 對手手牌進化時觸發類（1 張，本波實裝）
 *     11. 火箭隊的電龍｜黑暗脈衝     — 場上時，對手從手牌進化完成時，那張進化卡 +4 指示物。
 *                                      卡面明文「不重複」=> 場上多隻仍只 +4 一次（per-evolution）。
 *
 * 設計：
 *   - 本檔集中提供 helper（hasOppActiveAbility / hasOppFieldAbility / 等）讓 engine.ts 引用。
 *   - 「對手不能使出 X」inline 在 PLAY_TRAINER / PLAY_BASIC / EVOLVE handler 加 gate。
 *   - 「對手特性消除」inline 在 engine.ts 的 ability availability gate 與 USE_ABILITY dispatch 路徑加 gate。
 *   - 「寶可夢檢查放指示物」inline 在 engine.ts 寶可夢檢查段落（緊接冰冷之帳之後）加 hook。
 *   - 「對手戰鬥寶可夢回備戰」inline 在 engine.ts RETREAT handler 末端加 hook。
 *   - 「對手進化完成」inline 在 engine.ts EVOLVE handler 末端加 hook。
 *   - Iron Rule 12：本檔不對 effects.ts 內 Map 做 .set()（全 inline / helper 路徑），
 *     但仍提供空的 register() function 保持 wave 模板一致，effects.ts 末端呼叫即可。
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import { RULE_BOX_SUBTYPES } from '../../types';
import type { Card } from '$lib/cards/types';
// ⭐v6.213 2 階判定的 per-pool 索引（leaf，只 import type ⇒ 不可能循環）
import { isStage2ByPlainEx } from '../../stage2-index';

// 導出 sentinel 防止 unused import warnings
export type _v3001G3W3Sentinel = PlayerState | GameState | Card | CardInstance;

// ════════════════════════════════════════════════════════════════════════════
// 共用 helper：場上 ability holder 偵測
// ════════════════════════════════════════════════════════════════════════════

/**
 * 玩家 idx 場上（active+bench）任一寶可夢**擁有且此刻生效**的指定 ability。
 *
 * ⭐ v6.196：原本只比對特性名，**完全沒問「這個特性此刻有沒有被消除」** ——
 *   本檔與 v3000 wave2 的所有 field-passive（球形盾牌／熔岩地域／凹洞／黑暗脈衝／
 *   潛者捕捉／奇跡之吻／熔岩波動…）持有者絕大多數是**進化寶可夢**，
 *   【傳說的熔岩洞】「雙方場上所有進化寶可夢的特性全部消除。」在場時仍照樣生效。
 *   統一接上中央述詞 isAbilityHolderEffective（涵蓋 初始化／火箭隊的監視塔／
 *   傳說的熔岩洞／招式版暗夜羽擊／振翼髮 passive／黏著束縛 全部消除來源）。
 * ⚠ 不遞迴：location='bench' 才會走 sticky(黏著束縛)，而 sticky 自身的偵測走
 *   hasAbilityOnBench（本函式的無 gate 版），不會回頭呼叫本函式。
 */
export function hasAbilityOnSide(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
  abilityName: string,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const owner = state.players[ownerIdx];
  const actIid = owner.active?.iid;
  const all = [...(owner.active ? [owner.active] : []), ...owner.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    if (!card?.abilities?.some(a => a.name === abilityName)) return false;
    const loc: 'active' | 'bench' = (actIid != null && c.iid === actIid) ? 'active' : 'bench';
    return isAbilityHolderEffective(state, c, card, ownerIdx, abilityName, loc, pool);
  });
}

/**
 * ⭐ v6.196：場上「擁有且此刻生效」指定 ability 的**隻數**（疊加型 passive 用）。
 * 卡面寫「只要『這隻』寶可夢在場上…」代表每隻獨立計算，被消除的那幾隻不得計入。
 */
export function countEffectiveAbilityOnSide(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
  abilityName: string,
): number {
  if (!state || ownerIdx == null || !pool) return 0;
  const owner = state.players[ownerIdx];
  const actIid = owner.active?.iid;
  let n = 0;
  for (const c of [...(owner.active ? [owner.active] : []), ...owner.bench]) {
    const card = pool.get(c.cardId);
    if (!card?.abilities?.some(a => a.name === abilityName)) continue;
    const loc: 'active' | 'bench' = (actIid != null && c.iid === actIid) ? 'active' : 'bench';
    if (isAbilityHolderEffective(state, c, card, ownerIdx, abilityName, loc, pool)) n++;
  }
  return n;
}

/**
 * 玩家 idx 戰鬥場上是否「擁有且生效」指定 ability。
 *
 * v5.221：本 helper 統一處理所有「對手戰鬥位特性消除」機制：
 *   - 招式版 暗夜羽擊（abilityNullifiedThisTurn 旗標）
 *   - passive 振翼髮｜暗夜羽擊（isOppActiveAbilityNullifiedByMoonsenne）
 *   - 火箭隊監視塔【無】特性消除（呼叫端自行 wrap）
 *
 * v5.222：改 export，所有「讀對手戰鬥位特性」一律改呼叫此 helper，
 *   禁止 inline check（IRON_RULES.md Rule 18）。
 *   未來新增「對手特性消除」機制只要修這一處，所有 caller 自動受益。
 */
export function hasAbilityOnActive(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
  abilityName: string,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const a = state.players[ownerIdx].active;
  if (!a) return false;
  // v2.362：abilityNullifiedThisTurn 旗標 → 暫時被消除，視為無此特性
  if (a.abilityNullifiedThisTurn) return false;
  const card = pool.get(a.cardId);
  if (!card?.abilities?.some(ab => ab.name === abilityName)) return false;
  // v5.221 (Rule 7c)：passive 振翼髮｜暗夜羽擊 — 對手戰鬥位特性被消除時，
  //   isOppStadiumPlayBlocked (爆大身軀) / isOppEvilEyeBlocking (瞪眼效用) /
  //   isOppItemPlayBlocked (海之詛咒) 全部應視為無效。修 1 處 cover 3 個 helper。
  // ⭐ v6.196：原本只接了「暗夜羽擊」一個來源，漏掉 鐵荊棘ex｜初始化／火箭隊的監視塔／
  //   【傳說的熔岩洞】（爆大身軀=大王銅象 Stage1、瞪眼效用=火箭隊的阿柏怪 Stage1、
  //   海之詛咒=胖嘟嘟ex Stage1+規則、漩渦言靈=夢妖魔ex Stage1+規則 全是進化寶可夢）。
  //   改接中央 isAbilityHolderEffective（它 step1/step2 已含 abilityNullifiedThisTurn +
  //   暗夜羽擊，故行為是嚴格擴充；location='active' 不走 sticky ⇒ 不遞迴）。
  if (!isAbilityHolderEffective(state, a, card, ownerIdx, abilityName, 'active', pool)) return false;
  return true;
}

/**
 * v5.224 統一 helper：寶可夢 inst 的指定 ability 目前是否「實際生效」（不被任何機制消除）?
 *
 * 統一處理所有「特性消除」機制：
 *   1. 招式版暗夜羽擊 — inst.abilityNullifiedThisTurn 旗標（active only）
 *   2. passive 振翼髮｜暗夜羽擊 — 對手戰鬥場有振翼髮 → 自方戰鬥位特性失效
 *   3. 海兔獸｜黏著束縛 — 雙方備戰 2 階寶可夢特性失效
 *   4. 火箭隊的監視塔 — 【無】屬性寶可夢特性失效（caller 自行 wrap）
 *
 * 使用情境：所有「對手場上特性 holder 提供保護」邏輯都應 iterate 每個 holder
 * 並用此 helper 過濾掉被消除的 holder（field-ability 類如花之帷幔/抵抗之幕/球形盾牌；
 * self-ability 類如化隱/全能硬殼/緊張感/融合為雪）。
 *
 * @param holderInst 持有此特性的寶可夢 inst
 * @param holderCard 對應的 Card（caller 已 pool.get）
 * @param holderOwnerIdx 持有者所屬玩家 idx
 * @param abilityName 要檢查的特性名（用於暗夜羽擊豁免）
 * @param location 持有者在 'active' 或 'bench'
 * @returns true → 特性實際生效；false → 特性被消除應跳過
 */
// ════════════════════════════════════════════════════════════════════════════
// ⭐⭐⭐ v6.253 中央述詞：「特性消除源」的持有者，其該特性此刻是否仍然有效？
//
// 卡面上的特性消除是**持續性效果** ⇒ 來源自己的特性被別人消除掉時，它就不再消除別人。
// 官方 Q&A 的措辭一律是「特性『初始化』**處於生效狀態**的鐵荊棘ex」／
// 「特性『暗夜羽擊』**處於有效狀態**的振翼髮」——
// 見 `PTCG RULES/PTCG_RULES.md` L1935、L2733、L2818（初始化）與 L1594、L2505（暗夜羽擊）。
//
// 站長回報（v6.253）：我方戰鬥場的振翼髮｜暗夜羽擊 已經消除了對手戰鬥場鐵荊棘ex 的
// 全部特性，但我方備戰的拉帝亞斯ex｜天空徑線 仍被「初始化」壓著、無法 0 能量撤退。
// 根因：isInitializeNullified 只問「場上有沒有印著『初始化』的卡」，
//       **沒問那張卡的初始化此刻還算不算數**。海兔獸｜黏著束縛（走無閘的
//       hasAbilityOnBench）完全同型。振翼髮 passive 那一支早在 v6.196 就接上了中央閘，
//       這兩支被漏掉 ⇒ 本版收斂成同一支述詞。
//
// ⚠ 遞迴防護：本述詞會回頭呼叫 isAbilityHolderEffective，而後者 step 0/3 又會回來問
//   消除源。用 re-entrancy 集合擋住「同一個消除源名稱」的自我遞迴，遞迴時回 true
//   （＝視為有效，等同 v6.252 既有行為）⇒ 最壞情況不會比現在差，也不會無窮迴圈。
//   引擎全程同步執行（無 async），module-level 集合不會跨請求交錯。
// ════════════════════════════════════════════════════════════════════════════
const _nullifierVisiting = new Set<string>();
export function isNullifierAbilityEffective(
  state: GameState | undefined,
  holderInst: CardInstance | null | undefined,
  holderCard: Card | null | undefined,
  holderOwnerIdx: 0 | 1 | undefined,
  nullifierName: string,
  location: 'active' | 'bench',
  pool: Map<string, Card> | undefined,
): boolean {
  if (_nullifierVisiting.has(nullifierName)) return true;   // 遞迴 → fail-open（維持 v6.252 行為）
  _nullifierVisiting.add(nullifierName);
  try {
    return isAbilityHolderEffective(state, holderInst, holderCard, holderOwnerIdx, nullifierName, location, pool);
  } finally {
    _nullifierVisiting.delete(nullifierName);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 鐵荊棘ex｜初始化（passive 特性消除 — 規則寶可夢）
//   卡面：「只要這隻寶可夢在戰鬥場上，雙方場上『擁有規則的寶可夢』（『未來』寶可夢除外）
//          的特性全部消除。」
//   與 engine.ts isInitializeBlocking 同邏輯，集中進中央 helper 讓 UI(getUsableAbilities) +
//   所有被動套用點(isAbilityHolderEffective caller) 一律 respect。鐵荊棘ex 本身是「未來」→ 不消除自己。
// ════════════════════════════════════════════════════════════════════════════
export function isInitializeNullified(
  state: GameState | undefined,
  holderCard: Card | null | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || !holderCard || !pool) return false;
  // holder 必須是「擁有規則的寶可夢」(rule box)
  const isRuleBox = (holderCard.subtype != null && RULE_BOX_SUBTYPES.has(holderCard.subtype))
    || (holderCard.tags ?? []).some(t => RULE_BOX_SUBTYPES.has(t));
  if (!isRuleBox) return false;
  // 「未來」寶可夢不受影響（含鐵荊棘ex 自己）
  if ((holderCard.tags ?? []).includes('未來')) return false;
  // 任一方「戰鬥場」有「初始化」(鐵荊棘ex) 持有者
  // ⭐⭐⭐ v6.253：持有者的「初始化」**自己也必須處於生效狀態**（官方 Q&A 逐字如此描述）。
  //   最常見情境：對手戰鬥場的振翼髮｜暗夜羽擊 把鐵荊棘ex 的全部特性消除掉。
  // ⚠ 效能：這一支是 isAbilityHolderEffective 的 step 0，全站最熱的路徑之一 ⇒
  //   **不用 `for (const i of [0,1] as const)`**（那會每次呼叫都配置一個新陣列，實測有感）。
  for (let pIdx = 0 as 0 | 1; pIdx <= 1; pIdx = (pIdx + 1) as 0 | 1) {
    const active = state.players[pIdx].active;
    if (!active) continue;
    const ac = pool.get(active.cardId);
    if (!ac?.abilities?.some(ab => ab.name === '初始化')) continue;   // 便宜早退：卡上沒印就不必問
    if (!isNullifierAbilityEffective(state, active, ac, pIdx, '初始化', 'active', pool)) continue;
    return true;
  }
  return false;
}

/**
 * ⭐v6.049 火箭隊的監視塔（Stadium，卡面：「雙方場上所有【無】寶可夢的特性全部消除。」）
 *
 * 原本這個消除來源**不在中央述詞內**，而是 engine 內另有一個 `isColorlessAbilityBlocked`，
 * 只包在 USE_ABILITY / getUsableAbilities / BENCH_PLACE_TRIGGERS 三個「發動點」。
 * 結果所有**被動**套用點（受傷反擊、免疫、費用修正、以及「是不是擁有特性的寶可夢」判定）
 * 全都看不到它 —— 玩家回報「監視塔在場時，【無】寶可夢仍被雪妖女｜冰冷之帳打」正是其一。
 *
 * ⚠用字面值比對卡名而不是 import `stadiums.ts` 的常數：stadiums.ts 已經 import 本檔上游的
 *   `_shared.ts`，反向 import 會造成循環相依（同 `hasOakEye` 的既有作法）。
 */
function isNullifiedByRocketWatchtower(
  state: GameState | undefined,
  holderInst: CardInstance | null | undefined,
  holderCard: Card | null | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || !holderCard || !pool) return false;
  // ⭐v6.145：化石卡放到場上是「HP60 的【無】屬性【基礎】寶可夢」（卡面 rulesText 明文），
  //   但**卡片本身**的 pokemonType 是 null（它印刷上是 Item）→ 原本判不到，監視塔漏消除化石特性。
  const isColorlessOnField = holderCard.pokemonType === 'Colorless' || !!holderInst?.fossilOnField;
  if (!isColorlessOnField) return false;
  const st = state.activeStadium;
  if (!st) return false;
  return pool.get(st.cardId)?.name === '火箭隊的監視塔';
}

/**
 * v6.077 M6 傳說的熔岩洞 —「雙方場上所有**進化**寶可夢的特性全部消除。」
 * 與 0b 火箭隊的監視塔（【無】寶可夢特性消除）完全同型，接在同一個 gate。
 * ⚠ 判準是**階段**不是進化來源：`stage !== 'Basic'` 即為進化寶可夢。
 * ⚠⚠ v6.145：原註解寫「化石放到場上是 Basic → 不消除」，但**程式碼並沒有做這件事** ——
 *   化石卡的 `stage` 是 undefined、`subtype` 是 'Item'，`stage ?? subtype` 取到 'Item' ≠ 'Basic'
 *   → 被當成進化寶可夢誤消除。卡面 rulesText 明文「可作為 HP60 的【無】屬性的【基礎】寶可夢
 *   放置於場上」，所以熔岩洞不該消除化石特性（原始根／羽毛守護／背蓋等）。現已改讀 fossilOnField。
 * ⚠ 用字面值比對卡名，避免從 stadiums.ts 反向 import（同 0b 的理由）。
 */
function isNullifiedByLegendCave(
  state: GameState | undefined,
  holderInst: CardInstance | null | undefined,
  holderCard: Card | null | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || !holderCard || !pool) return false;
  if (holderInst?.fossilOnField) return false;            // 化石在場上是【基礎】→ 不是進化寶可夢
  const stage = holderCard.stage ?? holderCard.subtype;
  if (stage === 'Basic' || stage == null) return false;   // 只消除進化寶可夢
  const st = state.activeStadium;
  if (!st) return false;
  return pool.get(st.cardId)?.name === '傳說的熔岩洞';
}

export function isAbilityHolderEffective(
  state: GameState | undefined,
  holderInst: CardInstance | null | undefined,
  holderCard: Card | null | undefined,
  holderOwnerIdx: 0 | 1 | undefined,
  abilityName: string | undefined,
  location: 'active' | 'bench',
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || !holderInst || !holderCard || holderOwnerIdx == null || !abilityName || !pool) return false;
  // 0. 鐵荊棘ex｜初始化 — 規則寶可夢(未來除外)特性消除
  if (isInitializeNullified(state, holderCard, pool)) return false;
  // 0b. v6.049 火箭隊的監視塔 —【無】寶可夢特性全部消除
  if (isNullifiedByRocketWatchtower(state, holderInst, holderCard, pool)) return false;
  // 0c. v6.077 傳說的熔岩洞 — 雙方場上所有**進化**寶可夢特性全部消除
  if (isNullifiedByLegendCave(state, holderInst, holderCard, pool)) return false;
  // 1. 招式版暗夜羽擊 — 只 active 位置才有此旗標
  if (location === 'active' && holderInst.abilityNullifiedThisTurn) return false;
  // 2. passive 振翼髮｜暗夜羽擊 — 對手戰鬥場有振翼髮 → active 位置的特性失效
  if (location === 'active'
      && isOppActiveAbilityNullifiedByMoonsenne(state, holderOwnerIdx, holderCard, abilityName, pool)) {
    return false;
  }
  // 3. 海兔獸｜黏著束縛 — bench 2 階特性失效
  if (location === 'bench' && isAbilityNullifiedBySticky(state, holderInst, holderCard, true, pool)) {
    return false;
  }
  return true;
}

/**
 * ⭐v6.049「這隻**場上**寶可夢當下是否擁有（任何有效的）特性」— 中央述詞。
 *
 * 給所有卡面寫「**擁有特性的寶可夢**」的判定共用（冰冷之帳／冥府之律／精神防護／
 * 神聖護符／複眼／礎石之勢…）。這些點原本一律裸判 `card.abilities.length > 0`，
 * 也就是**只看卡片印刷**，完全不管特性有沒有被消除。
 *
 * ⚠**只能用在「場上的實例」**。以下情境**不可**使用（誤用會製造新 bug）：
 *   - 賽吉：卡面「（擁有特性的寶可夢除外）」指的是**牌庫裡拿的那張進化卡**——
 *     牌庫不在場上，特性消除只作用於「雙方**場上**」。
 *   - 火箭隊的阿柏怪｜瞪眼效用：判的是**手牌**裡的候選卡。
 *   - 悔念錨／抹茶旋濺／魂之末：判的是**棄牌區**裡的卡。
 *   以上三類判的都是卡片的固有屬性，不是場上狀態。
 *
 * ⚠**「效果被阻擋」≠「沒有特性」**：探探鼠｜監視之眼只是讓「改放傷害指示物」失效，
 *   被它擋住的願增猿**仍然是擁有特性的寶可夢**（Wilson 裁定），
 *   所以這個述詞**不看** `isAbilityBlockedByOakEye`。
 */
export function hasAnyEffectiveAbility(
  state: GameState | undefined,
  inst: CardInstance | null | undefined,
  card: Card | null | undefined,
  ownerIdx: 0 | 1 | undefined,
  location: 'active' | 'bench',
  pool: Map<string, Card> | undefined,
): boolean {
  if (!card?.abilities || card.abilities.length === 0) return false;
  // 缺少場上脈絡時 fail-open 回「有特性」＝維持舊行為，不會比現在更糟
  if (!state || !inst || ownerIdx == null || !pool) return true;
  return card.abilities.some(ab => isAbilityHolderEffective(state, inst, card, ownerIdx, ab.name, location, pool));
}

/**
 * 影藏（超級耿鬼ex）獎賞減少 — 中央述詞：ownerIdx 玩家場上是否有「處於有效狀態」的影藏持有者。
 * §17.42.B / 卡面：影藏須「處於有效狀態」（鐵荊棘ex｜初始化會消除超級耿鬼ex 這類『規則寶可夢』的
 * 特性 → 影藏失效；招式型特性消除 / abilityNullifiedThisTurn 亦然）。收斂 engine 主傷害 KO 流程與
 * effects.koPrizesAdjusted 兩處對影藏持有者的判定，避免漂移。
 */
export function hasEffectiveKageHide(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const p = state.players[ownerIdx];
  const ok = (inst: CardInstance | null | undefined, loc: 'active' | 'bench'): boolean => {
    if (!inst) return false;
    const c = pool.get(inst.cardId);
    if (!c?.abilities?.some(ab => ab.name === '影藏')) return false;
    return isAbilityHolderEffective(state, inst, c, ownerIdx, '影藏', loc, pool);
  };
  if (ok(p.active, 'active')) return true;
  return p.bench.some(b => ok(b, 'bench'));
}

/** 玩家 idx 備戰是否有指定 ability holder。 */
function hasAbilityOnBench(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
  abilityName: string,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const owner = state.players[ownerIdx];
  return owner.bench.some(c => {
    const card = pool.get(c.cardId);
    return card?.abilities?.some(a => a.name === abilityName);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 本地 isStage2PokemonCard（避免循環 import engine.ts；同 draw_supporters.ts pattern）
// ════════════════════════════════════════════════════════════════════════════

/** 是否為 2 階進化寶可夢（evolvesFrom 指向的卡也有 evolvesFrom）。 */
// ⭐⭐⭐v6.213 純效能：這一支是全站最熱的一點 —— 海兔獸｜黏著束縛的特性消除閘
//   每個 action 平均呼叫 1.42 次，而原碼**對整個卡池（4935 張）線性掃描**，
//   且兩行正規化（迴圈不變量 `a` 也在內）每一輪都重算 ⇒ 實測 634.6 µs/call、
//   佔 engine+AI 總時間 52.7%。改走 per-pool 索引（$lib/game/stage2-index）。
// ⚠ 判準**逐字不變**：`isStage2ByPlainEx` 用的就是原碼那套「只 strip 尾綴 ex 再 trim」，
//   刻意**不**改用 engine 的 sameEvoName（那還會 strip「超級」前綴＝行為變更）。
function isStage2(card: Card | undefined, pool: Map<string, Card>): boolean {
  return isStage2ByPlainEx(card, pool);
}

// ════════════════════════════════════════════════════════════════════════════
// A1. 大王銅象｜爆大身軀
//
// 卡面：「只要這隻寶可夢在戰鬥場上，對手無法從手牌使出競技場卡。」
//
// hook：engine.ts PLAY_TRAINER handler 在 trainerCard.subtype === 'Stadium' 時，
//   先檢查對手戰鬥場是否有「爆大身軀」持有者；若有則阻擋。
// ════════════════════════════════════════════════════════════════════════════

/** 對手戰鬥場是否有「大王銅象｜爆大身軀」（且未被消除）。 */
export function isOppStadiumPlayBlocked(
  state: GameState | undefined,
  aIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (aIdx == null) return false;
  const oppIdx = (1 - aIdx) as 0 | 1;
  return hasAbilityOnActive(state, oppIdx, pool, '爆大身軀');
}

// ════════════════════════════════════════════════════════════════════════════
// A2. 火箭隊的阿柏怪｜瞪眼效用
//
// 卡面：「只要這隻寶可夢在戰鬥場上，對手不可從手牌將擁有特性的寶可夢
//        （『火箭隊的寶可夢』除外）放置於場上。」
//
// 「放置於場上」= 從手牌 PLAY_BASIC（基礎放備戰）+ EVOLVE（從手牌進化也算放置）。
//
// 例外：「火箭隊的」開頭的寶可夢可以放（卡面明文 except）。
//
// hook：engine.ts PLAY_BASIC + EVOLVE handler 開頭加 gate。
// ════════════════════════════════════════════════════════════════════════════

/** 對手戰鬥場是否有「火箭隊的阿柏怪｜瞪眼效用」（且 candidate 不豁免）。 */
export function isOppEvilEyeBlocking(
  state: GameState | undefined,
  aIdx: 0 | 1 | undefined,
  candidateCard: Card | null | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!candidateCard) return false;
  if (aIdx == null) return false;
  // 候選寶可夢無特性 → 不受影響
  if (!candidateCard.abilities || candidateCard.abilities.length === 0) return false;
  // 「火箭隊的」開頭寶可夢 → 例外不擋
  if ((candidateCard.name ?? '').startsWith('火箭隊的')) return false;
  const oppIdx = (1 - aIdx) as 0 | 1;
  return hasAbilityOnActive(state, oppIdx, pool, '瞪眼效用');
}

// ════════════════════════════════════════════════════════════════════════════
// A3. 胖嘟嘟ex｜海之詛咒
//
// 卡面：「只要這隻寶可夢在戰鬥場上，對手無法從手牌使出『物品』卡，
//        也無法附上『寶可夢道具』卡。」
//
// hook：engine.ts PLAY_TRAINER handler 在 subtype === 'Item' 與道具
//   （subtype === 'PokemonTool'）時各加 gate。
// ════════════════════════════════════════════════════════════════════════════

/** 對手戰鬥場是否有「胖嘟嘟ex｜海之詛咒」。 */
export function isOppItemPlayBlocked(
  state: GameState | undefined,
  aIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (aIdx == null) return false;
  const oppIdx = (1 - aIdx) as 0 | 1;
  return hasAbilityOnActive(state, oppIdx, pool, '海之詛咒');
}

// ════════════════════════════════════════════════════════════════════════════
// B4. 振翼髮｜暗夜羽擊（Passive 特性版本，非招式）
//
// 卡面：「只要這隻寶可夢在戰鬥場上，對手的戰鬥寶可夢的特性（『暗夜羽擊』除外）
//        全部消除。」
//
// 注意：此特性與招式「振翼髮｜暗夜羽擊」（用法是擲幣放指示物等）同名。
//   寶可夢卡 abilities 陣列中為 ability，attacks 陣列中為招式 — 名稱碰撞但不衝突。
//
// 例外：對手戰鬥位若**也是擁有「暗夜羽擊」特性的振翼髮**，則特性不被消除（卡面明文 except）。
//
// 範圍：
//   - 持有者：自方戰鬥場有「振翼髮」+ 特性 = 「暗夜羽擊」。
//   - 影響：對手「戰鬥位」寶可夢（不是備戰）的特性全消。
//
// hook：本特性的「特性消除」必須在 engine.ts 兩處生效：
//   1) getUsableAbilities 列表 — 對手戰鬥位寶可夢若被影響，從可用清單剔除（按鈕不顯示）
//   2) USE_ABILITY dispatch — 防止對手強制呼叫 active 寶可夢的 ability
//   3) PASSIVE_ATTACK_BONUS / PASSIVE_DAMAGE_REDUCE 等 passive 路徑也應視為無效
//      （但本波保守處理：active 位置的 passive 影響有限；後續 wave 補）
// ════════════════════════════════════════════════════════════════════════════

/**
 * 對手 active 寶可夢的特性是否被「振翼髮｜暗夜羽擊」消除。
 * defenderActiveCard：對手戰鬥位卡片（要檢查的目標）
 * abilityName：對手要使用 / 觸發的特性名（用於排除「暗夜羽擊」自身）
 * 回傳：true → 特性被消除，不應觸發 / 不應顯示按鈕。
 */
export function isOppActiveAbilityNullifiedByMoonsenne(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  defenderCard: Card | null | undefined,
  abilityName: string | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || defenderIdx == null || !defenderCard || !abilityName || !pool) return false;
  // 「暗夜羽擊」自身豁免（卡面明文 except）
  if (abilityName === '暗夜羽擊') return false;
  // 持有者必須在「對手」戰鬥場上
  const attackerIdx = (1 - defenderIdx) as 0 | 1;
  if (!hasAbilityOnActive(state, attackerIdx, pool, '暗夜羽擊')) return false;
  // 持有者必須是「振翼髮」（某些卡有同名招式所以再次卡名 gate）
  const att = state.players[attackerIdx].active;
  if (!att) return false;
  const attCard = pool.get(att.cardId);
  if (attCard?.name !== '振翼髮') return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// B5. 海兔獸｜黏著束縛
//
// 卡面：「只要這隻寶可夢在備戰區，雙方的備戰區的【2 階進化】寶可夢的特性全部消除。」
//
// 範圍：
//   - 持有者：任一方備戰區有「海兔獸」+ 特性 = 「黏著束縛」。
//   - 影響：雙方「備戰區」（不含戰鬥場）的【2 階進化】寶可夢的特性全部消除。
//   - 海兔獸自身豁免？卡面未明寫 except — 保守不豁免（但海兔獸自己是 Stage 2 嗎？
//     卡面 evolvesFrom = 海兔獸ex 的下一階；查 SV8 海兔獸是 Stage 2，所以
//     場上 1 隻備戰海兔獸 → 它自己也被消除特性 → 但這時自己的「黏著束縛」也失效，
//     形成邏輯循環。PTCG 規則：「特性自我消除」實作上判定為**無循環**（消除後自己
//     不再消除別的，但消除「啟動瞬間」已生效）。本波採「先快照場上海兔獸」approach：
//     先計算「場上有沒有海兔獸 + 黏著束縛」做為靜態 trigger，再 nullify 其他卡。
//     這樣海兔獸自己「黏著束縛」也算被消除（與 PTCG「無循環」結果一致 —
//     另一隻海兔獸的黏著束縛仍生效）。
//
// hook：在 engine.ts 兩處生效（同振翼髮 pattern）：
//   1) getUsableAbilities — 備戰區 Stage 2 寶可夢從可用清單剔除
//   2) ability dispatch / passive 路徑檢查
// ════════════════════════════════════════════════════════════════════════════

/**
 * 寶可夢的特性是否被「海兔獸｜黏著束縛」消除。
 * inst：被檢查的寶可夢實體（必須是某方備戰區）
 * card：對應卡片
 * isOnBench：true → 當前 inst 在備戰區；false → 戰鬥場（戰鬥場不受影響，回 false）
 * 回傳：true → 特性被消除。
 */
export function isAbilityNullifiedBySticky(
  state: GameState | undefined,
  inst: CardInstance | null | undefined,
  card: Card | null | undefined,
  isOnBench: boolean,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || !inst || !card || !pool) return false;
  if (!isOnBench) return false; // 卡面：「備戰區的」2 階進化才被消除
  if (!isStage2(card, pool)) return false;
  // 任一方備戰區有海兔獸 + 黏著束縛
  for (const i of [0, 1] as const) {
    // 便宜早退（無閘版：只看卡上有沒有印這個特性）——維持原本的效能特性
    if (!hasAbilityOnBench(state, i, pool, '黏著束縛')) continue;
    // 進一步確認該備戰位是「海兔獸」（避免同名特性卡片汙染）
    // ⭐⭐⭐ v6.253：並且該隻海兔獸的「黏著束縛」**自己也必須仍然有效**。
    //   海兔獸是【1階進化】⇒【傳說的熔岩洞】（雙方場上所有進化寶可夢的特性全部消除）
    //   在場時它的黏著束縛已被消除，不該再壓制雙方備戰的【2階進化】。
    //   原本走的 hasAbilityOnBench 是刻意的「無閘版」＝完全沒問這件事。
    const benchHas = state.players[i].bench.some(b => {
      const bCard = pool.get(b.cardId);
      if (bCard?.name !== '海兔獸') return false;
      if (!bCard.abilities?.some(a => a.name === '黏著束縛')) return false;
      return isNullifierAbilityEffective(state, b, bCard, i, '黏著束縛', 'bench', pool);
    });
    if (benchHas) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// 統一查詢：傳入要檢查的寶可夢實體 + 特性名 → 是否被任何「特性消除」效果消除？
// 提供給 engine.ts 的 ability availability gate 與 dispatch 路徑共用。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 寶可夢 inst 的指定 ability 是否被任何「對手特性消除類」效果消除？
 * 這個 helper 同時涵蓋「振翼髮｜暗夜羽擊」+「海兔獸｜黏著束縛」+ 未來新加的同類效果。
 * - ownerIdx：inst 所屬玩家
 * - location：'active' | 'bench'
 */
export function isAbilityNullifiedByPassive(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  inst: CardInstance | null | undefined,
  card: Card | null | undefined,
  abilityName: string | undefined,
  location: 'active' | 'bench',
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || ownerIdx == null || !inst || !card || !abilityName || !pool) return false;
  // 鐵荊棘ex｜初始化 — 規則寶可夢(未來除外)特性消除（含被動，UI/被動套用點一律 respect）
  if (isInitializeNullified(state, card, pool)) return true;
  // 振翼髮｜暗夜羽擊 — 對手戰鬥位特性消除
  if (location === 'active') {
    if (isOppActiveAbilityNullifiedByMoonsenne(state, ownerIdx, card, abilityName, pool)) {
      return true;
    }
  }
  // 海兔獸｜黏著束縛 — 雙方備戰 Stage 2 特性消除
  if (location === 'bench') {
    if (isAbilityNullifiedBySticky(state, inst, card, true, pool)) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// C7. 火箭隊的班基拉斯｜揚沙
//
// 卡面：「只要這隻寶可夢在戰鬥場上，每次寶可夢檢查時，在對手的所有【基礎】寶可夢
//        身上各放置 2 個傷害指示物。」
//
// 範圍：
//   - 持有者：自方「戰鬥場」上有「火箭隊的班基拉斯」+ 特性 = 「揚沙」（不是備戰）。
//   - 觸發：寶可夢檢查階段（與冰冷之帳同位置 —— engine.ts L4275 前後）。
//   - 效果：對手所有 stage = Basic（即 evolvesFrom 為空）+ 寶可夢卡 +2 指示物（=20 傷害）。
//   - 火箭隊的班基拉斯自己是 Stage 2，不會誤傷自己（且本特性也只影響對手）。
//
// 疊加：卡面未寫「不重複」— 場上多隻揚沙會疊加（戰鬥場只能 1 隻所以實際上 max 1）。
//   所以實作直接「對手 active+bench 中是 Basic 的全部 +2 個指示物」。
//
// hook：engine.ts 寶可夢檢查段落（冰冷之帳處理之後）加新區塊。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 火箭隊的班基拉斯｜揚沙：玩家 ownerIdx 戰鬥場是否有持有者。
 * 觸發路徑：寶可夢檢查時 caller 對 i=0,1 各 query 一次，true → 對對手所有基礎放 2 指示物。
 */
export function hasRocketTyranitarSandstorm(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const active = state.players[ownerIdx].active;
  if (!active) return false;
  const card = pool.get(active.cardId);
  if (card?.name !== '火箭隊的班基拉斯') return false;
  // ⭐ v6.196：原本只擋 abilityNullifiedThisTurn（招式版暗夜羽擊），漏掉
  //   【傳說的熔岩洞】(火箭隊的班基拉斯 stage=Stage2 進化)／火箭隊的監視塔／初始化／
  //   振翼髮 passive。改走已帶中央 gate 的 hasAbilityOnActive。
  return hasAbilityOnActive(state, ownerIdx, pool, '揚沙');
}

// ════════════════════════════════════════════════════════════════════════════
// D8/D9/D10. 對手戰鬥寶可夢回備戰時觸發類（熔岩蝸牛 / 夢妖魔ex / 火箭隊的三地鼠）
//
// 觸發點：「對手回合，對手戰鬥寶可夢回到備戰區」=> 主要場景是對手 RETREAT。
//   其他場景（招式效果換場、特性效果換場、被吹回 等）暫時 defer，本波只 hook RETREAT。
//
// 三張卡的差異：
//   - 熔岩蝸牛｜熔岩地域（場上即可）— 新上場寶可夢【灼傷】
//   - 夢妖魔ex｜漩渦言靈（戰鬥場 only）— 新上場寶可夢【混亂】
//   - 火箭隊的三地鼠｜凹洞（場上即可）— 「回到備戰的那隻」+2 指示物（注意 target 不一樣）
//
// hook：engine.ts RETREAT handler 末端，當 attacker.retreatedThisTurn 設定後，
//   呼叫此 helper 一次性處理三個效果（場景：自己回合 active 玩家 = aIdx，
//   觸發者 = 對方 (1 - aIdx)；卡面文字「在對手的回合」-> 從觸發者視角，
//   「對手」就是 active player aIdx）。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 三張「對手戰鬥場 → 備戰時觸發」passive 的判定 helper。
 *
 * @param state         撤退前 state
 * @param retreaterIdx  撤退方（= 對方視角中的「對手」）
 * @param retreatingInst 從戰鬥場回備戰的寶可夢實體（撤退者）
 * @param newActiveInst 新上場的寶可夢（被互換上來的）
 * @param pool          卡池
 * @returns { burnNewActive, confuseNewActive, addCountersToRetreater }
 *   呼叫者依此 flag 套用 status / damage 修改。
 */
export function getOppRetreatTriggers(
  state: GameState | undefined,
  retreaterIdx: 0 | 1 | undefined,
  retreatingInst: CardInstance | null | undefined,
  newActiveInst: CardInstance | null | undefined,
  pool: Map<string, Card> | undefined,
): {
  burnNewActive: boolean;
  confuseNewActive: boolean;
  countersOnRetreater: number;
  triggerNames: string[];
} {
  const result = {
    burnNewActive: false,
    confuseNewActive: false,
    countersOnRetreater: 0,
    triggerNames: [] as string[],
  };
  if (!state || retreaterIdx == null || !retreatingInst || !newActiveInst || !pool) return result;
  const oppIdx = (1 - retreaterIdx) as 0 | 1; // 持有者陣營（= 「對手」視角中的我方）

  // 熔岩蝸牛｜熔岩地域 — 場上即可（active+bench）
  if (hasAbilityOnSide(state, oppIdx, pool, '熔岩地域')) {
    result.burnNewActive = true;
    result.triggerNames.push('熔岩地域');
  }
  // 夢妖魔ex｜漩渦言靈 — 戰鬥場 only
  if (hasAbilityOnActive(state, oppIdx, pool, '漩渦言靈')) {
    result.confuseNewActive = true;
    result.triggerNames.push('漩渦言靈');
  }
  // 火箭隊的三地鼠｜凹洞 — 場上即可（active+bench）
  // 卡面：「在那隻寶可夢身上放置 2 個傷害指示物」=「回到備戰的那隻」
  if (hasAbilityOnSide(state, oppIdx, pool, '凹洞')) {
    // 多隻凹洞會疊加（卡面未寫不重複）→ 計數
    // ⭐ v6.196：外層 hasAbilityOnSide 已帶 gate，但內層逐隻計數原本沒有 →
    //   被消除的三地鼠仍會被算進去（熔岩洞在場卻放 4 個）。改走中央計數。
    const n = countEffectiveAbilityOnSide(state, oppIdx, pool, '凹洞');
    result.countersOnRetreater = n * 2;  // 每隻三地鼠 +2 指示物
    if (n > 0) result.triggerNames.push('凹洞');
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// E11. 火箭隊的電龍｜黑暗脈衝
//
// 卡面：「只要這隻寶可夢在場上，每次對手從手牌使出寶可夢完成進化時，
//        在那隻寶可夢身上放置 4 個傷害指示物。無論有多少隻擁有這個特性的寶可夢，
//        這個效果也不會重複。」
//
// 範圍：
//   - 持有者：自方場上（含 active 或 bench）有「火箭隊的電龍」+ 特性 = 「黑暗脈衝」。
//   - 觸發：對手執行 EVOLVE action 完成後（= action.type === 'EVOLVE' handler 末端）。
//   - 效果：剛進化完的卡片（evolved inst）+4 指示物（=40 傷害）。
//   - 卡面明文「不重複」 → 多隻仍只 +4 一次（per-evolution）。
//
// hook：engine.ts EVOLVE handler 末端，於 evolved inst 寫回後檢查此 trigger。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 火箭隊的電龍｜黑暗脈衝：對手場上是否有持有者？回傳 true → 加 4 指示物。
 * 注意 evolverIdx 是「進化動作執行者」（= 持有者視角的『對手』）。
 */
export function hasRocketAmpharosDarkPulse(
  state: GameState | undefined,
  evolverIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || evolverIdx == null || !pool) return false;
  const oppIdx = (1 - evolverIdx) as 0 | 1; // 持有者陣營
  return hasAbilityOnSide(state, oppIdx, pool, '黑暗脈衝');
}

// ════════════════════════════════════════════════════════════════════════════
// v3.01 register pattern（Iron Rule 12）
//
// 本檔目前所有 helper 都是 inline 用法（engine.ts 內 import 後呼叫），沒有對
// effects.ts 內 Map 做 .set()，因此實際上不需要 register 函式。
// 仍提供空的 register 函式以保持 wave 模板一致；effects.ts 仍呼叫此函式即可。
//
// 未來若要加 PASSIVE_ATTACK_BONUS / PASSIVE_DAMAGE_REDUCE_COND 等的 .set()，
// 可在此函式內加；不會踩 v2.999 的 ESM TDZ 坑。
// ════════════════════════════════════════════════════════════════════════════

let _v3001G3W3Registered = false;

export function registerV3001G3W3Passives(): void {
  if (_v3001G3W3Registered) return; // idempotent
  _v3001G3W3Registered = true;
  // 本波無對 effects.ts 內 Map 的 .set() 需要做；helpers 全部走 engine.ts inline import。
}


// ════════════════════════════════════════════════════════════════════════════
// v5.988：美納斯|平穩境地「場上卡→手牌」中央述詞(從 v3080 移入，與 isAbilityHolderEffective 同檔)
// ════════════════════════════════════════════════════════════════════════════
/** v5.987：某側「當下盤面」是否有生效中的平穩境地(active/bench 任一)。供述詞與 attack-time snapshot 共用。 */
export function hasEffectiveCalmGroundOnSide(
  state: GameState | undefined,
  guardIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || guardIdx == null || !pool) return false;
  const gp = state.players[guardIdx];
  if (!gp) return false;
  const check = (inst: CardInstance, loc: 'active' | 'bench'): boolean => {
    const card = pool.get(inst.cardId);
    if (!card?.abilities?.some(ab => ab.name === '平穩境地')) return false;
    // isAbilityHolderEffective 涵蓋初始化/暗夜羽擊/監視塔等全部特性消除路徑
    return isAbilityHolderEffective(state, inst, card, guardIdx, '平穩境地', loc, pool);
  };
  if (gp.active && check(gp.active, 'active')) return true;
  return gp.bench.some(b => check(b, 'bench'));
}

export function isReturnToHandBlockedByCalmGround(
  state: GameState | undefined,
  cardOwnerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!state || cardOwnerIdx == null || !pool) return false;
  // 美納斯必須在「被回手那張卡的持有者」的對手側(卡面「對手的場上寶可夢與其附加卡無法放回手牌」)
  const guardIdx = (1 - cardOwnerIdx) as 0 | 1;
  // v5.987：當下盤面 OR attack-time snapshot(比照花之帷幔)。即使美納斯被同一招式 KO，
  //   只要「宣告當時」在生效，此招式的回手效果仍被擋(PTCG 招式效果同時 resolve)。
  if (hasEffectiveCalmGroundOnSide(state, guardIdx, pool)) return true;
  return state._attackTimeCalmGround?.[guardIdx] === true;
}
