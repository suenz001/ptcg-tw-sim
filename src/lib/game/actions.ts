/**
 * Action creators — 方便建立 GameAction 物件的輔助函式。
 * UI 層呼叫這些函式，再把結果傳給 applyAction。
 */

import type { GameAction } from './types';

export const GameActions = {
  placeActive:       (iid: string, senderIdx: 0 | 1): GameAction => ({ type: 'PLACE_ACTIVE', iid, senderIdx }),
  benchPokemon:      (iid: string, senderIdx: 0 | 1): GameAction => ({ type: 'BENCH_POKEMON', iid, senderIdx }),
  finishSetup:       (senderIdx: 0 | 1): GameAction => ({ type: 'FINISH_SETUP', senderIdx }),
  mulliganDrawDecision: (count: number, senderIdx: 0 | 1): GameAction =>
                       ({ type: 'MULLIGAN_DRAW_DECISION', count, senderIdx }),
  // v3.74：玩家確認對方的 mulligan 揭示
  confirmMulliganReveal: (senderIdx: 0 | 1): GameAction =>
                       ({ type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx }),
  // v5.138：mulligan 補抽後加備戰完成
  finishMulliganPostBench: (senderIdx: 0 | 1): GameAction =>
                       ({ type: 'FINISH_MULLIGAN_POST_BENCH', senderIdx }),
  drawCard:          (): GameAction => ({ type: 'DRAW_CARD' }),
  attachEnergy:      (energyIid: string, targetIid: string): GameAction =>
                       ({ type: 'ATTACH_ENERGY', energyIid, targetIid }),
  attack:            (
                       attackIndex: number,
                       discardedEnergyIids?: string[],
                       copyAttackChoice?: { pokeIid: string; attackIndex: number },
                     ): GameAction =>
                       ({
                         type: 'ATTACK',
                         attackIndex,
                         // v3.28 修 bug：原本寫 `&& discardedEnergyIids.length > 0` 會把空陣列丟掉
                         //   結果 binary-yes-no 的「否」傳 [] 序列化後變 undefined → engine 端
                         //   AI fallback 把它當 yes → 強制丟棄能量。改用「!== undefined」區分：
                         //   - undefined（沒傳）→ engine 走 AI fallback
                         //   - [] / [...] 都保留 → engine 用 length 區分 yes/no
                         ...(discardedEnergyIids !== undefined && { discardedEnergyIids }),
                         ...(copyAttackChoice && { copyAttackChoice }),
                       }),
  takePrizes:        (count: number, playerIdx: 0 | 1, senderIdx?: 0 | 1): GameAction =>
                       ({ type: 'TAKE_PRIZES', count, playerIdx,
                          ...(senderIdx !== undefined && { senderIdx }) }),
  sendNewActive:     (iid: string, senderIdx?: 0 | 1): GameAction =>
                       ({ type: 'SEND_NEW_ACTIVE', iid, ...(senderIdx !== undefined && { senderIdx }) }),
  endTurn:           (): GameAction => ({ type: 'END_TURN' }),

  // M2 Phase C
  playBasic:         (iid: string): GameAction => ({ type: 'PLAY_BASIC', iid }),
  // v2.187 化石 Item 作為 HP60【無】基礎寶可夢放到備戰
  playFossil:        (iid: string): GameAction => ({ type: 'PLAY_FOSSIL', iid }),
  // v2.187 場上化石自主丟棄（非昏厥，戰鬥場時走 SEND_NEW_ACTIVE 補位流程）
  discardFossil:     (iid: string): GameAction => ({ type: 'DISCARD_FOSSIL', iid }),
  evolve:            (fromIid: string, toIid: string): GameAction =>
                       ({ type: 'EVOLVE', fromIid, toIid }),
  retreat:           (newActiveIid: string): GameAction =>
                       ({ type: 'RETREAT', newActiveIid }),
  playTrainer:       (iid: string, params?: Record<string, unknown>): GameAction =>
                       ({ type: 'PLAY_TRAINER', iid, params }),
  resolveSelection:  (selectedIids: string[], senderIdx?: 0 | 1): GameAction =>
                       ({ type: 'RESOLVE_SELECTION', selectedIids, ...(senderIdx !== undefined && { senderIdx }) }),
  useStadium:        (): GameAction => ({ type: 'USE_STADIUM' }),
  useAbility:        (iid: string, abilityIndex: number): GameAction =>
                       ({ type: 'USE_ABILITY', iid, abilityIndex }),
  // v3.07 Deferred Wave D — 手牌觸發特性 action creators
  useHandDiscardAbility: (triggerCardName: string, discardIid: string): GameAction =>
                       ({ type: 'USE_HAND_DISCARD_ABILITY', triggerCardName, discardIid }),
  useHandAbility:    (cardIid: string, abilityIndex: number): GameAction =>
                       ({ type: 'USE_HAND_ABILITY', cardIid, abilityIndex }),
} as const;
