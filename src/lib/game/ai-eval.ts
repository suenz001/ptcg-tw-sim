/**
 * AI 場面評估 —— 以「引擎試打」為唯一權威（v6.039）。
 *
 * 【為什麼不讓 AI 自己算傷害】
 * 一次攻擊的實際傷害牽涉：弱點×2、抵抗力、道具減傷（渾厚鱗片等）、被動特性、
 * 完全免疫、太晶、擲幣免傷、放置指示物 vs 造成傷害的區別……這些散落在 engine.ts
 * 與數百張卡效果裡。AI 若自己重算一份公式，就變成「同一條規則有兩份實作」——
 * 那正是本專案反覆踩過的坑（改了一邊忘了另一邊，且不會有任何錯誤訊息）。
 * 直接把盤面複製一份、用引擎真的打一次，看到的就是玩家會看到的結果。
 *
 * 【⚠隨機序列必須隔離】
 * applyAction 內部可能擲幣（Math.random）。若不隔離，AI 每「思考」一次就偷走一段
 * 真實對局的隨機序列 —— 表面上看不出來，但會讓固定種子的測試無法重現，也讓
 * 「AI 想得多寡」影響到牌堆與擲幣結果。模擬期間換上獨立 PRNG，結束**一定**還原。
 *
 * 【這不是上帝視角】
 * 只用公開資訊：雙方場上的寶可夢、附加的能量與道具、傷害指示物、競技場。
 * **不讀**任何一方的手牌與牌庫內容 —— 那是 v5.963／v6.021 一路守下來的界線，
 * 把它固化進 AI 等於植入作弊知識。
 */
import type { Card } from '$lib/cards/types';
import type { GameState, CardInstance } from './types';
import { applyAction, getAvailableAttacks } from './engine';

/** 一次試打的結果。dealt 只在「沒擊倒」時有意義（擊倒時傷害多寡不重要）。 */
export interface AttackOutcome {
  /** 引擎有沒有接受這個動作（被拒代表這招當下不能用） */
  ok: boolean;
  /** 對手戰鬥位是否被擊倒 */
  ko: boolean;
  /** 對對手戰鬥位造成的傷害增量 */
  dealt: number;
  /** 打完後是否還停在待選擇（估值可信度較低） */
  unresolved: boolean;
}

const DEAD: AttackOutcome = { ok: false, ko: false, dealt: 0, unresolved: false };

/**
 * 模擬期間隔離 Math.random。
 * ⚠務必用 try/finally 還原 —— 中途 throw 而沒還原的話，整場對局的隨機來源就被
 *   換成這裡的固定 PRNG，症狀是「洗牌怪怪的」而幾乎不可能被聯想到 AI 評估。
 */
let _simSeed = 0x9e3779b9;
export function withIsolatedRandom<T>(fn: () => T): T {
  const orig = Math.random;
  let a = (_simSeed = (_simSeed + 0x6d2b79f5) >>> 0);
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/** 深拷貝盤面。引擎多數 handler 是 immutable，但有就地改 shallow copy 的路徑，一律拷貝才安全。 */
function cloneState(state: GameState): GameState {
  try {
    return typeof structuredClone === 'function'
      ? structuredClone(state)
      : (JSON.parse(JSON.stringify(state)) as GameState);
  } catch {
    return JSON.parse(JSON.stringify(state)) as GameState;
  }
}

/**
 * 試打一招，回傳結果。**永不 throw**（估值失敗一律當作「不能用」，讓 AI 走原路徑）。
 */
export function simulateAttack(
  state: GameState,
  actorIdx: 0 | 1,
  attackIndex: number,
  pool: Map<string, Card>,
): AttackOutcome {
  try {
    const oppIdx = (1 - actorIdx) as 0 | 1;
    const before = state.players[oppIdx].active;
    if (!before) return DEAD;
    return withIsolatedRandom(() => {
      const after = applyAction(cloneState(state), { type: 'ATTACK', attackIndex, actorIdx }, pool);
      if (!after || after === state) return DEAD;
      const now = after.players[oppIdx].active;
      // 擊倒判定用 iid：被擊倒後戰鬥位會變空或換上別隻，兩種都算擊倒
      const ko = !now || now.iid !== before.iid;
      return {
        ok: true,
        ko,
        dealt: ko ? Infinity : Math.max(0, (now.damage ?? 0) - (before.damage ?? 0)),
        unresolved: !!after.pendingSelection,
      };
    });
  } catch {
    return DEAD;   // fail-open：評估掛掉不可以影響對戰
  }
}

/** 這方目前所有可用招式裡，試打結果最好的一個。沒有可用招式回 null。 */
export function bestAttackOutcome(
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>,
): { attackIndex: number; outcome: AttackOutcome } | null {
  let best: { attackIndex: number; outcome: AttackOutcome } | null = null;
  try {
    for (const idx of getAvailableAttacks(state, pool)) {
      const o = simulateAttack(state, actorIdx, idx, pool);
      if (!o.ok) continue;
      if (!best || (o.ko && !best.outcome.ko) || (o.ko === best.outcome.ko && o.dealt > best.outcome.dealt)) {
        best = { attackIndex: idx, outcome: o };
      }
    }
  } catch {
    return null;
  }
  return best;
}

/**
 * 估「把備戰的這隻換到戰鬥位的話，它能打出什麼」。
 *
 * ⚠這是**估計**不是精確模擬：這裡直接把假想盤面的 active 換成候選，並沒有真的走一次
 *   RETREAT（真的走會丟掉撤退費能量、清狀態、設 movedToActiveThisTurn，而且多屬性能量
 *   還會開 picker —— 在這裡解 picker 需要回頭呼叫 ai.ts，會造成模組循環相依，
 *   那是 v5.985 module-init TDZ 事故的成因）。
 *   丟掉的是**原 active** 身上的能量，不影響候選自己的能量，所以用於「換誰上場比較好」
 *   的排序足夠準；不要拿它當「撤退後的精確盤面」用。
 */
export function estimateIfPromoted(
  state: GameState,
  myIdx: 0 | 1,
  candidate: CardInstance,
  pool: Map<string, Card>,
): AttackOutcome {
  try {
    const hypo = cloneState(state);
    const me = hypo.players[myIdx];
    const bIdx = me.bench.findIndex((b) => b.iid === candidate.iid);
    if (bIdx < 0) return DEAD;
    const old = me.active;
    me.active = me.bench[bIdx];
    me.bench = me.bench.filter((_, i) => i !== bIdx);
    if (old) me.bench.push(old);
    hypo.activePlayerIndex = myIdx;
    const best = bestAttackOutcome(hypo, myIdx, pool);
    return best ? best.outcome : DEAD;
  } catch {
    return DEAD;
  }
}
