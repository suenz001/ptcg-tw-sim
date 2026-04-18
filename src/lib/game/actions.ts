/**
 * Action creators — 方便建立 GameAction 物件的輔助函式。
 * UI 層呼叫這些函式，再把結果傳給 applyAction。
 */

import type { GameAction } from './types';

export const GameActions = {
  placeActive:       (iid: string): GameAction => ({ type: 'PLACE_ACTIVE', iid }),
  benchPokemon:      (iid: string): GameAction => ({ type: 'BENCH_POKEMON', iid }),
  finishSetup:       (): GameAction => ({ type: 'FINISH_SETUP' }),
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
} as const;
