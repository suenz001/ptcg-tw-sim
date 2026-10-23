// ⭐v6.595 出招前的擲硬幣判定（唯一一份，IRON_RULES Rule 38）
//
// 官方《進階玩家規則教學手冊》「使出招式的順序」（站長 2026-10-23 核對後裁定照官方修正）：
//   1. 宣告招式：不能使用的招式不能宣告（也就不擲任何硬幣）；睡眠／麻痺不能宣告。
//   2. a. 先擲「招式失敗」類硬幣（潑沙、墨汁噴射：attackFailureFlipCountThisTurn）
//      b. 再擲【混亂】：反面 ⇒ 招式沒有使出、自己身上放 3 個傷害指示物
//      （官方 Q&A L604 潑油、L1121 潑膠：先擲那個效果的硬幣，正面才擲混亂）
//   3. 之後才處理招式說明文字（「若希望…」的選擇、借招要借哪一招都屬於這裡）。
//
// 兩步出招：對戰頁遇到「這招出招前要玩家選擇」而且「需要擲上面的硬幣」時，先送 `_gateOnly` 的 ATTACK，
//   引擎做完 1 → 2a → 2b；反面照常失敗、正面記下 attackGatePassed（誰、哪一招、第幾回合）就停下來，
//   對戰頁這時才開選擇視窗；選完送一般的 ATTACK，引擎看到 attackGatePassed 對得上就不重擲。
//   ・宣告了就要出招：attackGatePassed 還在時，引擎只接受「同一招」的 ATTACK（選擇視窗不能取消）。
//   ・不需要擲幣、或這招出招前不用選擇 ⇒ 流程完全不變（一次 ATTACK，不多一次往返）。AI 永遠一次送出（結果相同）。

import type { CardInstance, GameAction, GameState } from './types';

/** 這隻戰鬥寶可夢出招前要不要擲「招式失敗／混亂」的硬幣 */
export function attackNeedsGateFlip(active: Pick<CardInstance, 'status' | 'attackFailureFlipCountThisTurn'> | null | undefined): boolean {
  if (!active) return false;
  return active.status === 'confused' || (active.attackFailureFlipCountThisTurn ?? 0) > 0;
}

/**
 * 還有效的 attackGatePassed：必須是「這一回合、輪到出招的那一方」記下的（審查 P3-1）。
 *   照引擎自己的流程不會留下過期紀錄；但萬一盤面留著一筆（例如休閒對戰中途有一端是舊版 client），
 *   過期的紀錄一律當作不存在 ⇒ 不會鎖住任何人、也不會在下一回合硬開選擇視窗。
 */
export function liveAttackGate(state: Pick<GameState, 'attackGatePassed' | 'turn' | 'activePlayerIndex'> | null | undefined): NonNullable<GameState['attackGatePassed']> | null {
  const g = state?.attackGatePassed;
  if (!g || g.turn !== state!.turn || g.idx !== state!.activePlayerIndex) return null;
  return g;
}

/** 這位玩家是不是正停在「已通過擲幣、等著選擇」；回傳那一招的 attackIndex 或 null */
export function attackGatePendingFor(state: Pick<GameState, 'attackGatePassed' | 'turn' | 'activePlayerIndex'> | null | undefined, idx: number | null | undefined): number | null {
  const g = liveAttackGate(state);
  if (!g || (idx !== 0 && idx !== 1) || g.idx !== idx) return null;
  return g.attackIndex;
}

/** attackGatePassed 是不是這位玩家、這一招（第二步不重擲） */
export function attackGateMatches(state: Pick<GameState, 'attackGatePassed' | 'turn' | 'activePlayerIndex'>, idx: number, attackIndex: number): boolean {
  const g = liveAttackGate(state);
  return !!g && g.idx === idx && g.attackIndex === attackIndex;
}

/** attackGatePassed 還在時，引擎只接受同一招的 ATTACK（不能改出別招、不能結束回合、不能做別的事） */
export function attackGateAllows(state: Pick<GameState, 'attackGatePassed' | 'turn' | 'activePlayerIndex'>, action: GameAction): boolean {
  const g = liveAttackGate(state);
  if (!g) return true;   // 沒有、或是過期的紀錄 ⇒ 不鎖
  return action.type === 'ATTACK' && action.attackIndex === g.attackIndex && !action._gateOnly;
}

/**
 * 對戰頁按下招式時：要先送「出招前擲幣」的第一步（'gate'），還是直接走原本的流程（'normal'）。
 *   needsChoice＝這招出招前要玩家選擇（「若希望…」／借招）。不用選擇的招式 ⇒ 一次 ATTACK，引擎照官方順序擲幣即可。
 */
export function uiAttackStep(
  state: Pick<GameState, 'attackGatePassed' | 'activePlayerIndex' | 'turn'>,
  active: Pick<CardInstance, 'status' | 'attackFailureFlipCountThisTurn'> | null | undefined,
  attackIndex: number,
  needsChoice: boolean,
): 'gate' | 'normal' {
  if (!needsChoice || !attackNeedsGateFlip(active)) return 'normal';
  return attackGatePendingFor(state, state.activePlayerIndex) === attackIndex ? 'normal' : 'gate';
}

/**
 * 對戰頁：引擎記下 attackGatePassed 之後要不要（重新）打開那一招的選擇視窗。
 *   回傳 { attackIndex, tag } ⇒ 打開並記住 tag；null ⇒ 不動作（不是自己、已經開過、別的視窗開著）。
 *   重新整理頁面後 openedTag 是空的 ⇒ 會接回來（宣告了就要出招，不能卡在半路）。
 */
export function gateReopenTarget(
  state: Pick<GameState, 'attackGatePassed' | 'activePlayerIndex' | 'turn' | 'id'> | null | undefined,
  viewer: { canAct: boolean; myIdx: number },
  openedTag: string,
  pickerOpen: boolean,
): { attackIndex: number; tag: string } | null {
  if (!state || !viewer.canAct || state.activePlayerIndex !== viewer.myIdx) return null;
  const ai = attackGatePendingFor(state, state.activePlayerIndex);
  if (ai == null) return null;
  // tag 加上通過擲幣當下的 log 長度（審查 P2-2）：同一回合同一招第二次通過（祭典樂舞）也是新的 tag
  const tag = `${state.id}|${state.turn}|${ai}|${state.attackGatePassed?.at ?? ''}`;
  if (tag === openedTag || pickerOpen) return null;
  return { attackIndex: ai, tag };
}
