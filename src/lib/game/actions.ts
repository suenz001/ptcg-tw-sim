/**
 * Action creators — 方便建立 GameAction 物件的輔助函式。
 * UI 層呼叫這些函式，再把結果傳給 applyAction。
 */

import type { GameAction } from './types';

export const GameActions = {
  placeActive:    (iid: string): GameAction => ({ type: 'PLACE_ACTIVE', iid }),
  benchPokemon:   (iid: string): GameAction => ({ type: 'BENCH_POKEMON', iid }),
  finishSetup:    (): GameAction => ({ type: 'FINISH_SETUP' }),
  drawCard:       (): GameAction => ({ type: 'DRAW_CARD' }),
  attachEnergy:   (energyIid: string, targetIid: string): GameAction =>
                    ({ type: 'ATTACH_ENERGY', energyIid, targetIid }),
  attack:         (attackIndex: number): GameAction => ({ type: 'ATTACK', attackIndex }),
  takePrizes:     (count: number): GameAction => ({ type: 'TAKE_PRIZES', count }),
  sendNewActive:  (iid: string): GameAction => ({ type: 'SEND_NEW_ACTIVE', iid }),
  endTurn:        (): GameAction => ({ type: 'END_TURN' }),

  // M3/M4 插槽
  playTrainer:    (iid: string, params?: Record<string, unknown>): GameAction =>
                    ({ type: 'PLAY_TRAINER', iid, params }),
  evolve:         (fromIid: string, toIid: string): GameAction =>
                    ({ type: 'EVOLVE', fromIid, toIid }),
  retreat:        (newActiveIid: string): GameAction =>
                    ({ type: 'RETREAT', newActiveIid }),
} as const;
