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
import type { Card } from '$lib/cards/types';

// 導出 sentinel 防止 unused import warnings
export type _v3001G3W3Sentinel = PlayerState | GameState | Card | CardInstance;

// ════════════════════════════════════════════════════════════════════════════
// 共用 helper：場上 ability holder 偵測
// ════════════════════════════════════════════════════════════════════════════

/** 玩家 idx 場上（active+bench）任一寶可夢具有指定 ability 名稱。 */
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
  if (isOppActiveAbilityNullifiedByMoonsenne(state, ownerIdx, card, abilityName, pool)) return false;
  return true;
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
function isStage2(card: Card | undefined, pool: Map<string, Card>): boolean {
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  for (const c of pool.values()) {
    // 簡化版 sameEvoName：直接比對名稱去 ex 後綴版（與 engine 同邏輯）
    const a = (card.evolvesFrom ?? '').replace(/ex$/, '').trim();
    const b = (c.name ?? '').replace(/ex$/, '').trim();
    if (a === b && c.supertype === 'Pokemon' && c.evolvesFrom) return true;
  }
  return false;
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
    if (hasAbilityOnBench(state, i, pool, '黏著束縛')) {
      // 進一步確認該備戰位是「海兔獸」（避免同名特性卡片汙染）
      const benchHas = state.players[i].bench.some(b => {
        const bCard = pool.get(b.cardId);
        return bCard?.name === '海兔獸'
          && bCard.abilities?.some(a => a.name === '黏著束縛');
      });
      if (benchHas) return true;
    }
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
  if (active.abilityNullifiedThisTurn) return false;
  const card = pool.get(active.cardId);
  if (card?.name !== '火箭隊的班基拉斯') return false;
  return !!card.abilities?.some(a => a.name === '揚沙');
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
    let n = 0;
    const owner = state.players[oppIdx];
    if (owner.active) {
      const c = pool.get(owner.active.cardId);
      if (c?.abilities?.some(a => a.name === '凹洞')) n += 1;
    }
    for (const b of owner.bench) {
      const c = pool.get(b.cardId);
      if (c?.abilities?.some(a => a.name === '凹洞')) n += 1;
    }
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
