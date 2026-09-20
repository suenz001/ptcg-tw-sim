/**
 * ⭐⭐⭐ v6.410：特性「祭典樂舞」＋競技場卡「祭典會場」的**唯一判準來源**（IRON_RULES Rule 38）。
 *
 * 【為什麼要有這個檔】
 *   v6.202 之前，「本次攻擊是不是祭典樂舞的第一拳」在站內有**兩份**實作：
 *     ・engine.ts  `_isFestivalDanceFirstAttack`
 *     ・effects.ts `_isFestivalDanceFirstAttackLocal`（註解自承是「engine 那份的本地複製，
 *       因為 effects.ts 不能 import engine.ts」）
 *   兩份逐字同型，靠人工同步（v6.202 就同步過一次：兩邊都補上「特性此刻有沒有被消除」）。
 *   這正是**安慰劑型態 11**（判準兩份）：針對其中一份寫的守衛，突變另一份不會翻紅。
 *
 * 【收斂】判準下沉到這個檔。它只 import `./types`（型別）與 `./defense`
 *   （中央述詞 hasEffectiveAbilityByInst），**不直接 import engine.ts／effects.ts**
 *   ⇒ engine 與 effects 兩邊都能 import 同一份。
 *
 * ⚠⚠ 它不是真正的 leaf：`defense.ts` 本身 value-import `./effects`，
 *   所以存在**傳遞式循環**（festival → defense → effects → festival，
 *   以及 festival → defense → effects → effects/cards/tools → engine → festival）。
 *   這與站內早就存在的 engine↔effects↔defense 是**同一類良性循環**：
 *   本檔的 export 全部是函式，只在函式體內被求值 ⇒ 沒有 TDZ 風險。
 *   ⚠⚠ **禁止**任何模組在 module top-level 讀本檔的 export
 *   （例如 `const S = new Set([FESTIVAL_VENUE_STADIUM])` 寫在檔案最外層）——
 *   那會讓循環從良性變成 TDZ 爆炸。守衛 test-v6410 【C8】釘住這一點。
 *
 * 【卡面】特性「祭典樂舞」—— H 標持有者（live 卡池實查）：
 *   **裹蜜蟲、角金魚、金魚王、綿綿泡芙**（共 12 個印刷）。
 *   卡面逐字：「若場上有『祭典會場』，則這隻寶可夢可使用持有的招式2次。
 *   （若對手的戰鬥寶可夢因第1次的招式而【昏厥】了，則在下一隻寶可夢放置後，使用第2次的招式。）」
 *   ⚠⚠ 卡面寫的是「**場上**有祭典會場」，**不是**「自己場上」——對手打出的祭典會場也算。
 *     競技場卡共用站內唯一場地槽 `state.activeStadium` ⇒ 讀它就是對的，別把它「修」成只看自己那一側。
 *
 * ⚠ 本檔**不含**祭典樂舞的狀態機（開窗／中斷／第 2 次招式 pending）——那些留在 engine.ts，
 *   因為它們會改 state 且與回合流程綁死。這裡只放**純述詞**（讀 state、回 boolean）。
 */
import type { GameState } from './types';
import type { Card } from '$lib/cards/types';
import { hasEffectiveAbilityByInst } from './defense';   // v6.196 中央述詞（含「特性此刻是否被消除」）

/** 特性名 —— 卡面逐字。只有這裡寫一次。 */
export const FESTIVAL_DANCE_ABILITY = '祭典樂舞';
/** 競技場卡名 —— 卡面逐字。只有這裡寫一次。 */
export const FESTIVAL_VENUE_STADIUM = '祭典會場';

/**
 * 場上（唯一場地槽）是不是「祭典會場」。
 *
 * ⚠ 原本 engine.ts 有一份 `hasFestivalVenue`，而 `_isFestivalDanceFirstAttack` 與
 *   effects.ts 的本地複製各自又 inline 比對一次卡名 ⇒ 同一個判準三份。全部收斂到這裡。
 */
export function hasFestivalVenue(state: GameState, pool: Map<string, Card>): boolean {
  const stadium = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  return stadium?.name === FESTIVAL_VENUE_STADIUM;
}

/**
 * 這一側的**戰鬥寶可夢**此刻有沒有生效中的「祭典樂舞」特性。
 *
 * ⭐ v6.202：不能只比對特性名 —— 祭典樂舞持有者一定在戰鬥場（是使用招式的那隻）
 *   ⇒ 招式版暗夜羽擊（abilityNullifiedThisTurn）與 passive 振翼髮｜暗夜羽擊都打得到它。
 *   走中央述詞 `hasEffectiveAbilityByInst`（它自己就會先比對特性名）。
 * ⚠ 傳說的熔岩洞打不到本特性：祭典樂舞的成立條件是場上有「祭典會場」，
 *   兩張都是競技場卡、不可能同時在場（唯一場地槽 state.activeStadium）。
 */
export function hasFestivalDanceActive(
  state: GameState, idx: 0 | 1, pool: Map<string, Card>,
): boolean {
  return hasEffectiveAbilityByInst(state, idx, state.players[idx].active, pool, FESTIVAL_DANCE_ABILITY);
}

/**
 * v5.226：「本次攻擊是祭典樂舞**會觸發第二次**的那第一次攻擊」嗎？
 *
 * 用途：attack pipeline 內**保留**一次性旗標（鐵羽毛減傷 / 下回合加傷 / 招致削傷 等）
 * 給第二次攻擊 —— 第一拳不消耗，第二拳才消耗。
 *
 * 條件（四項全中才算）：
 *   ① 攻擊方戰鬥寶可夢有生效中的祭典樂舞特性
 *   ② 場上有「祭典會場」
 *   ③ 本回合還沒記為 used
 *   ④ 本回合還沒用過 second attack
 */
export function isFestivalDanceFirstAttack(
  state: GameState, aIdx: 0 | 1, pool: Map<string, Card>,
): boolean {
  if (!state.players[aIdx].active) return false;
  if (!hasFestivalDanceActive(state, aIdx, pool)) return false;
  if (!hasFestivalVenue(state, pool)) return false;
  if (state.festivalDanceUsedThisTurn?.[aIdx]) return false;
  if (state.festivalDanceSecondAttackUsed?.[aIdx]) return false;
  return true;
}
