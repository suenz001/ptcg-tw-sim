/**
 * Action creators — 方便建立 GameAction 物件的輔助函式。
 * UI 層呼叫這些函式，再把結果傳給 applyAction。
 */

import type { GameAction } from './types';

export const GameActions = {
  placeActive:       (iid: string, senderIdx: 0 | 1): GameAction => ({ type: 'PLACE_ACTIVE', iid, senderIdx }),
  benchPokemon:      (iid: string, senderIdx: 0 | 1): GameAction => ({ type: 'BENCH_POKEMON', iid, senderIdx }),
  finishSetup:       (senderIdx: 0 | 1): GameAction => ({ type: 'FINISH_SETUP', senderIdx }),
  drawCard:          (): GameAction => ({ type: 'DRAW_CARD' }),
  attachEnergy:      (energyIid: string, targetIid: string): GameAction =>
                       ({ type: 'ATTACH_ENERGY', energyIid, targetIid }),
  attack:            (attackIndex: number): GameAction => ({ type: 'ATTACK', attackIndex }),
  takePrizes:        (count: number): GameAction => ({ type: 'TAKE_PRIZES', count }),
  sendNewActive:     (iid: string, senderIdx?: 0 | 1): GameAction =>
                       ({ type: 'SEND_NEW_ACTIVE', iid, ...(senderIdx !== undefined && { senderIdx }) }),
  endTurn:           (): GameAction => ({ type: 'END_TURN' }),

  // M2 Phase C
  playBasic:         (iid: string): GameAction => ({ type: 'PLAY_BASIC', iid }),
  evolve:            (fromIid: string, toIid: string): GameAction =>
                       ({ type: 'EVOLVE', fromIid, toIid }),
  retreat:           (newActiveIid: string): GameAction =>
                       ({ type: 'RETREAT', newActiveIid }),
  playTrainer:       (iid: string, params?: Record<string, unknown>): GameAction =>
                       ({ type: 'PLAY_TRAINER', iid, params }),
  resolveSelection:  (selectedIids: string[]): GameAction =>
                       ({ type: 'RESOLVE_SELECTION', selectedIids }),
  useStadium:        (): GameAction => ({ type: 'USE_STADIUM' }),
  useAbility:        (iid: string, abilityIndex: number): GameAction =>
                       ({ type: 'USE_ABILITY', iid, abilityIndex }),
} as const;
