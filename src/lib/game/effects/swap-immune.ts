/**
 * ⭐v6.527「特性：選擇 1 隻對手的備戰寶可夢，與戰鬥寶可夢互換」的中央判準（唯一一份）。
 *
 * 官方 Q&A（深淵之瞳，大力捕捉器）：可以選擇不受特性效果影響（化隱／光之翼）的備戰寶可夢，但不會互換。
 * 站長 2026-10-11 裁定：挑戰角擊／媚惑引誘「改成跟大力捕捉器一樣」；垃圾洩氣也不影響化隱／光之翼的攻擊方
 *   （「化隱 光之翼不會受到對手特性影響」）。
 * 同一原理、卡面同型的母親的誘引（與大力捕捉器逐字相同、只多擲幣）與繁星花紋（多一個剩餘 HP 條件）一起收斂。
 *
 * 用法：
 *   ① 發動端：oppBenchSwapTargets ⇒ { validIids（全部合乎卡面條件的備戰）, immuneIids（其中不受特性效果影響的） }
 *      ⇒ 放進 pending 的 params（UI 會標「🛡 不受影響」、AI 有其他目標時不選它們）。
 *   ② resolver：immuneSwapPick ⇒ 選到不受影響的那隻 ⇒ 回傳「據實 log、不互換」後的盤面；否則回 null 照常互換。
 * ⚠ 互換位置不是放置傷害指示物 ⇒ counterPlacement:false（對戰圓形競技場不擋，v6.028）。
 */
import type { GameState, CardInstance } from '../types';
import type { Card } from '$lib/cards/types';
import { canApplyEffectToTarget } from '../defense';
import { addLog } from './_shared';

/** 這隻對手備戰寶可夢不受 actorIdx 一側的特性效果影響嗎？ */
export function benchImmuneToOppAbility(st: GameState, actorIdx: number, b: CardInstance, pool: Map<string, Card>): boolean {
  return canApplyEffectToTarget(st, actorIdx as 0 | 1, b, pool.get(b.cardId), 'ability-effect', pool, { isBench: true, counterPlacement: false }).blocked;
}

/**
 * 發動端：對手備戰中「合乎卡面條件」的全部可選（extra 為卡面額外條件，例如剩餘 HP ≤ 90），以及其中不受影響的。
 */
export function oppBenchSwapTargets(
  st: GameState, actorIdx: number, pool: Map<string, Card>, extra?: (b: CardInstance) => boolean,
): { validIids: string[]; immuneIids: string[] } {
  const opp = st.players[1 - actorIdx];
  const cands = opp.bench.filter(b => (extra ? extra(b) : true));
  return {
    validIids: cands.map(b => b.iid),
    immuneIids: cands.filter(b => benchImmuneToOppAbility(st, actorIdx, b, pool)).map(b => b.iid),
  };
}

/**
 * resolver：選到 params.immuneIids 裡的那隻 ⇒ 不互換（據實 log）；否則回 null（呼叫端照常互換）。
 *   沒帶 immuneIids 的呼叫端（老大的指令等支援者）⇒ 一律回 null，行為不變。
 */
export function immuneSwapPick(
  st: GameState, actorIdx: number, iids: readonly string[], params: unknown, pool: Map<string, Card>, label?: string,
): GameState | null {
  const immune = (params as { immuneIids?: unknown } | undefined)?.immuneIids;
  const pick = iids[0];
  if (!Array.isArray(immune) || pick == null || !immune.includes(pick)) return null;
  const b = st.players[1 - actorIdx].bench.find(x => x.iid === pick);
  const name = b ? (pool.get(b.cardId)?.name ?? '該寶可夢') : '該寶可夢';
  return addLog(st, `${label ? label + '：' : ''}${name} 不受對手特性的效果影響，不會互換`, actorIdx as 0 | 1);
}
