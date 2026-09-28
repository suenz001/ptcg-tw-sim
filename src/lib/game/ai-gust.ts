/**
 * ⭐v6.436（AI 對戰強化：老大的指令的保留邏輯）Gust 系支援者（選 1 隻對手備戰寶可夢與戰鬥寶可夢互換）
 *   什麼時候打、拉誰上來 —— **唯一判準**（打不打＝ planGust；拉誰＝ pickGustTarget，兩者共用 gustTargetOutcomes）。
 *
 * 背景：
 *   舊版訓練家階段「支援者一律先打、同是支援者照手牌順序」⇒ 老大的指令只要排在前面就會被打出去，
 *   拉誰上來則是「剩餘 HP 最少」的那隻 —— 不管自己打不打得倒牠、打不打得動牠。
 *   結果兩種浪費：①拉上來也打不倒／打不動，白白用掉這回合的支援者（本來可以打抽牌支援者）；
 *   ②真正能靠它拿獎賞的回合，老大的指令卻因為手牌順序排在後面、支援者額度先被別張用掉。
 *
 * 判準（全部是「自己的招式打下去的結算結果」——引擎實打的 evaluateAttack，與選招同一把尺；對戰無關、不前瞻、不讀對手手牌／牌庫）：
 *   - 基準：不打老大的指令，戰鬥位現在能打出的最好結果（拿到的獎賞張數、對手受到的傷害）。
 *   - 逐一試拉每一隻合法目標（在洗過看不到區域的複本上真的打出老大的指令、選那一隻），再試打自己所有可用招式取最好的。
 *   - **值得打**（二擇一）：
 *       ① 拉上來的最好結果**多拿獎賞**（基準拿不到或拿得比較少；擲幣招要多出至少半張）；
 *       ② 基準**打不動**（拿不到獎賞、也打不出任何傷害），而拉上來打得出傷害。
 *   - 否則**保留**（這回合不打它，把支援者額度留給其他支援者）。
 *   ⚠ 魔靈多龍預組有自己調過的老大的指令用法（配合咒詛炸彈把 ex 壓到 200 線），不走這裡（呼叫端排除）。
 */
import type { Card } from '$lib/cards/types';
import type { GameState, CardInstance } from './types';
import { applyAction } from './engine';
import { cloneState, shuffleHiddenZonesForSim, withIsolatedRandom, bestNowOutcome, betterOutcome, clearlyBetterOutcome } from './ai-eval';
export { bestNowOutcome };   // ⭐v6.437 本體搬到 ai-eval.ts（re-export，既有呼叫端不受影響）
import { GUST_SUPPORTER_NAMES } from './gust-supporters';

/** 一個目標被拉上來之後，自己能打出的最好結果 */
export type GustOutcome = { targetIid: string; prizes: number; oppDamage: number; ko: boolean };

/** 這張手牌是不是 Gust 系支援者（卡名單一來源 gust-supporters.ts） */
export function isGustSupporter(state: GameState, me: 0 | 1, handIid: string, pool: Map<string, Card>): boolean {
  const n = pool.get(state.players[me].hand.find((h) => h.iid === handIid)?.cardId ?? '')?.name;
  return !!n && GUST_SUPPORTER_NAMES.includes(n);
}

/**
 * 盤面停在老大的指令的選擇視窗（opp-bench-choose／gust-opp）時，逐一試選每個合法目標、試打自己的招式。
 * @param pendingState 停在選擇視窗的盤面（真實盤面或複本都可以；這裡一律在複本上試）
 */
export function gustTargetOutcomes(pendingState: GameState, me: 0 | 1, pool: Map<string, Card>): GustOutcome[] {
  const ps = pendingState.pendingSelection;
  if (!ps || ps.effectKey !== 'gust-opp' || ps.actorIdx !== me) return [];
  const opp = pendingState.players[(1 - me) as 0 | 1];
  const valid = (ps.params?.validIids as string[] | undefined);
  const targets: CardInstance[] = opp.bench.filter((b) => !valid || valid.includes(b.iid));
  const out: GustOutcome[] = [];
  for (const t of targets) {
    try {
      const after = withIsolatedRandom(() => {
        const sim = shuffleHiddenZonesForSim(cloneState(pendingState), me);
        return applyAction(sim, { type: 'RESOLVE_SELECTION', selectedIids: [t.iid], pendingToken: sim.pendingSelection?.token }, pool);
      });
      if (!after || after.pendingSelection || after.players[(1 - me) as 0 | 1].active?.iid !== t.iid) continue;   // 沒換成功／還有後續選擇 ⇒ 不估
      const o = bestNowOutcome(after, me, pool);
      out.push({ targetIid: t.iid, ...o });
    } catch { /* 單一目標估失敗就跳過 */ }
  }
  return out;
}

/**
 * ⭐ 值不值得打老大的指令 —— 純函式（fable 複審建議：抽出來讓守衛直接餵數字，不必靠擲幣招）。
 *   ⭐v6.437 判準本體搬到 ai-eval.ts 的 clearlyBetterOutcome（「會不會讓這回合的攻擊明顯變差」也用同一把尺，Rule 38）。
 * @param base 不打老大的指令時，戰鬥位現在能打出的最好結果
 * @param best 拉上來之後最好的結果
 */
export function gustWorth(base: { prizes: number; oppDamage: number }, best: { prizes: number; oppDamage: number }): boolean {
  return clearlyBetterOutcome(base, best);
}

/** 從 gustTargetOutcomes 挑最好的目標（沒有 ⇒ null） */
export function bestGustOutcome(outcomes: readonly GustOutcome[]): GustOutcome | null {
  let best: GustOutcome | null = null;
  for (const o of outcomes) if (!best || betterOutcome(o, best)) best = o;
  return best;
}

/**
 * 這回合值不值得打出手上的老大的指令。值得 ⇒ 回傳預計拉上來的目標；不值得（或估不出來）⇒ null（保留）。
 */
// ⭐ 同一回合裡 AI 每打一張訓練家就會重新被呼叫一次；老大的指令保留在手上時，每一步都會重新試算一次（每次數十次試打）。
//   ⇒ 單格快取：整個盤面（去掉對戰紀錄）加上老大的指令那張逐字相同，就直接用上次的結論。
//   看不到內容的區（自己的牌庫、雙方的獎賞卡、對手的手牌與牌庫）只記張數——試打本來就會把它們洗過（shuffleHiddenZonesForSim），
//   結論不依賴其中的順序；其餘欄位（自己的手牌、雙方棄牌區、場上實體、玩家／遊戲層級旗標、競技場）全部原樣進簽章，寧可多算不可算錯。
let _planCache: { sig: string; result: GustOutcome | null } | null = null;
function planSig(state: GameState, me: 0 | 1, gustIid: string): string {
  const { log: _log, ...rest } = state as GameState & { log?: unknown };
  return JSON.stringify([me, gustIid, { ...rest, players: state.players.map((p, i) => ({
    ...p, deck: p.deck.length, prizes: p.prizes.length, hand: i === me ? p.hand : p.hand.length })) }]);
}

export function planGust(state: GameState, me: 0 | 1, pool: Map<string, Card>, gustIid: string): GustOutcome | null {
  const sig = planSig(state, me, gustIid);
  const result = _planCache && _planCache.sig === sig ? _planCache.result : planGustUncached(state, me, pool, gustIid);
  _planCache = { sig, result };
  // ⭐（fable 審查 v6.436 建議 2）記下「決定打出」時預計拉的那一隻，選擇器直接沿用 ——
  //   否則選擇器會再重抽一次試打，擲幣招可能改選另一隻（實測 73 次裡 14 次不一致，最糟拉了一隻拿不到獎賞的），也白算一次。
  _lastWorthPlan = result ? { turn: state.turn, me, gustIid, targetIid: result.targetIid } : null;
  return result;
}

let _lastWorthPlan: { turn: number; me: 0 | 1; gustIid: string; targetIid: string } | null = null;
/**
 * 打出老大的指令之後、停在選擇視窗時：若這張正是 planGust 判定「值得打」的那一張（同一回合、同一方、那張已經不在手上），
 * 回傳當時預計拉的目標；否則 null（呼叫端自己算）。⚠ 目標必須仍是合法選項（呼叫端檢查 validIids）。
 */
export function plannedGustTarget(state: GameState, me: 0 | 1): string | null {
  const p = _lastWorthPlan;
  if (!p || p.turn !== state.turn || p.me !== me) return null;
  if (state.players[me].hand.some((h) => h.iid === p.gustIid)) return null;   // 那張還在手上 ⇒ 不是它打出來的視窗
  return p.targetIid;
}

function planGustUncached(state: GameState, me: 0 | 1, pool: Map<string, Card>, gustIid: string): GustOutcome | null {
  try {
    const base = bestNowOutcome(state, me, pool);
    const pending = withIsolatedRandom(() => {
      const sim = shuffleHiddenZonesForSim(cloneState(state), me);
      sim.activePlayerIndex = me;
      return applyAction(sim, { type: 'PLAY_TRAINER', iid: gustIid }, pool);
    });
    if (!pending?.pendingSelection) return null;
    const best = bestGustOutcome(gustTargetOutcomes(pending, me, pool));
    if (!best) return null;
    return gustWorth(base, best) ? best : null;
  } catch {
    return null;
  }
}
