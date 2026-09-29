/**
 * ⭐⭐ 招式「使用條件」的**唯一登記處**（leaf 模組：只 import 型別，不會成環）
 *
 * v6.350 建立於 effects/_shared.ts；⭐v6.438 搬到這裡，因為借招家族的中央候選枚舉
 * `copy-attack.ts` 也必須問同一份（站長裁定 2026-09-29：大奶罐｜哞哞回轉 卡面
 * 「這個招式必須在上個自己的回合這隻寶可夢使用了「滾動」才可使用。」——**借來用的時候條件不符，不讓借**），
 * 而 `_shared.ts` 本身 import `copy-attack.ts`（withCopyAttackChain），copy-attack 反過來 import `_shared`
 * 會成環（循環 import 下模組層級 const 會 TDZ）。
 * ⇒ 登記表搬到 leaf，`_shared.ts` 原樣 re-export（既有 `regAttackPrecondition` 的 import 路徑不變）。
 *
 * key ＝ `招式來源卡名|招式名` —— 與 engine 組 `effectKey` 的方式**完全相同**
 * （道具招式用道具名、借招用來源卡名）。
 * 回傳阻擋原因字串（會寫進對戰紀錄）；`null` ＝ 可以使用。
 *
 * ⚠⚠ 全站只有這一份，消費點三處共用：
 *   ① engine 的 ATTACK handler（拒絕並寫 log）
 *   ② engine 的 `getAvailableAttacks`（UI 反白）
 *   ③ copy-attack.ts 的 `enumerateCopyAttacks`（借招候選：條件不符的招式不能借）
 * ⚠ 述詞裡的「這隻寶可夢」一律讀 `state.players[aIdx].active` —— 出招的那一隻
 *   （借招時就是借用方，卡面的「這隻寶可夢」在借用時指的正是它）。
 * ⚠ 這是 **per-attack**。「這隻寶可夢的**所有**招式都不能用」那一型
 *   （力量抑制者／啟動限制／懶怠個性）走 engine 的 `selfAttackPreconditionBlock`，兩者不要混。
 */
import type { GameState } from './types';
import type { Card } from '$lib/cards/types';

export type AttackUsePreconditionFn =
  (state: GameState, aIdx: 0 | 1, pool: Map<string, Card>) => string | null;
export const ATTACK_USE_PRECONDITION = new Map<string, AttackUsePreconditionFn>();
export function regAttackPrecondition(key: string, fn: AttackUsePreconditionFn) {
  ATTACK_USE_PRECONDITION.set(key, fn);
}

/**
 * ⭐v6.438「這個招式只可在後攻玩家的最初回合使用。」（吼叫尾ex｜絕叫、甜甜螢｜慢芬香）
 *   v5.739～v6.437 是 engine.ts 私有的 SECOND_PLAYER_FIRST_TURN_ONLY 集合（ATTACK handler 與 getAvailableAttacks 兩處判）——
 *   借招候選問不到 ⇒ 揮指在任何回合都借得到絕叫（fable 審查 v6.438 實測）。
 *   站長裁定（2026-09-29，哞哞回轉）：卡面寫的使用條件，借來用時同樣要成立 ⇒ 搬進本登記表，三個消費點共用。
 * ⚠ 判準用 `turn`（v6.103 修死招）：`isFirstTurn` 是「**先攻方**的第 1 個回合」，輪到後攻方時早已是 false；
 *   `turn` 只在後攻方結束回合時 +1 ⇒「turn === 1 且出招方是後攻方」＝ 後攻玩家的最初回合。
 */
export function secondPlayerFirstTurnOnlyBlock(
  state: GameState, aIdx: 0 | 1, pool: Map<string, Card>, attackName: string,
): string | null {
  const isSecondPlayer = aIdx !== state.firstPlayerIdx;
  if (state.turn === 1 && isSecondPlayer) return null;
  const who = pool.get(state.players[aIdx]?.active?.cardId ?? '')?.name ?? '?';
  return `${who}：「${attackName}」只能在後攻方最初回合使用`;
}
