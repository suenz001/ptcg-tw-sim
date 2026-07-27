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
import { applyAction, getAvailableAttacks, getEffectiveHP } from './engine';

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
 * ⭐⭐**資訊紅線的中央防線**：模擬前把雙方牌庫洗亂。
 *
 * 現役有 111 個招式會抽牌或查看牌庫（「從自己的牌庫抽出N張」「查看自己的牌庫上方9張」…）。
 * 試打時引擎會**真的翻牌庫**，所以只要估值讀到任何受此影響的結果，AI 就等於偷看了
 * 自己牌庫的順序 —— 這是本站一路守下來的紅線（v5.963／v6.021），而且**不可見**：
 * 不會有錯誤訊息，只會讓 AI 在某些卡上莫名地強。
 *
 * 洗亂之後，模擬在資訊論上等價於一次合法的隨機採樣（牌庫順序本來就不可知），
 * 即使估值端日後寫錯、讀了依賴牌庫的欄位，也讀不到真實順序。
 * ⚠這是**中央**防線：所有模擬入口都必須經過它，不要在個別估值函式裡各自防。
 * ⚠洗亂只在複本上做，絕不碰真實對局的 state。
 */
export function shuffleHiddenZonesForSim(st: GameState): GameState {
  for (const p of st.players) {
    const d = p.deck;
    // Fisher-Yates；此處的 Math.random 已被 withIsolatedRandom 換成隔離 PRNG
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
  }
  return st;
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
      const after = applyAction(
        shuffleHiddenZonesForSim(cloneState(state)), { type: 'ATTACK', attackIndex, actorIdx }, pool);
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
    const hypo = withIsolatedRandom(() => shuffleHiddenZonesForSim(cloneState(state)));
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

// ── 選招評估（批次 4d）─────────────────────────────────────────────────────
/**
 * 一次攻擊的完整評估。所有欄位都是**引擎試打後的盤面差**，不是我解讀卡面得來的：
 * 這一擊讓我拿到幾張獎賞、對手全場多受多少傷、我自己付出什麼代價。
 * 好處是不需要判斷「這張是不是 ex」（獎賞數 ex=2／Mega ex=3／一擊多殺全自動涵蓋），
 * 也不需要讀懂招式敘述裡的副作用文字。
 */
export interface AttackEval extends AttackOutcome {
  /** 這一擊讓我方新增幾張待取獎賞（pendingPrizes 差） */
  prizes: number;
  /** 對手全場（戰鬥位＋備戰）傷害增量 */
  oppDamage: number;
  /** 我方戰鬥位少了幾個能量（丟能量型招式的代價） */
  selfEnergyLost: number;
  /** 我方戰鬥位自身增加的傷害（反衝傷害） */
  selfDamage: number;
  /** 這一擊是否直接贏得對局 */
  gameWon: boolean;
  /** 綜合分數（越大越好） */
  score: number;
}

const DEAD_EVAL: AttackEval = {
  ...DEAD, prizes: 0, oppDamage: 0, selfEnergyLost: 0, selfDamage: 0, gameWon: false, score: -Infinity,
};

/**
 * 這一擊對某方造成的**有效傷害**。
 *
 * ⚠不能只比「場上傷害指示物總和」的前後差 —— 被擊倒的那隻會直接離場，
 *   牠身上的傷害跟著消失，差值反而會塌陷成 0（甚至負數）。第一版就是這樣寫的，
 *   結果「真的擊倒對手」算出來的傷害是 0，分數輸給只是打了 130 但沒擊倒的招，
 *   AI 因此**放棄能擊倒的招**（探針量到漏 KO 20%）。
 *   正確作法：逐隻比對 iid —— 還在場上的算傷害增量，已離場的算牠被打前的剩餘 HP。
 */
function oppEffectiveDamage(
  beforeSt: GameState, afterSt: GameState, oppIdx: 0 | 1, pool: Map<string, Card>,
): number {
  const listOf = (st: GameState) => {
    const p = st.players[oppIdx];
    return [...(p.active ? [p.active] : []), ...p.bench];
  };
  const after = new Map(listOf(afterSt).map((c) => [c.iid, c]));
  let total = 0;
  for (const b of listOf(beforeSt)) {
    const a = after.get(b.iid);
    if (a) total += Math.max(0, (a.damage ?? 0) - (b.damage ?? 0));
    else total += Math.max(0, getEffectiveHP(b, pool, beforeSt) - (b.damage ?? 0));   // 被擊倒＝打掉牠的剩餘 HP
  }
  return total;
}

/**
 * ⚠權重全部是**啟發式**（不是卡面規則）。設計原則只有兩條：
 *   ① 獎賞是勝利條件 → 權重必須壓過任何傷害數字。
 *   ② 其餘各項一律取自引擎事實，我只決定它們的相對份量。
 * 特別注意 overkill：不寫死「印刷傷害小的優先」，而是讓「對備戰的額外傷害」與
 * 「丟掉的能量」自己去比 —— 大招若真的有額外收益（例如順便打備戰）就該選它，
 * 若只是白白多丟能量，小招自然勝出。這比我猜哪個好可靠得多。
 */
const W = { PRIZE: 1000, SELF_ENERGY: 30, SELF_DAMAGE: 0.5, CANT_ATTACK_NEXT: 150 };
/** 一張獎賞卡在評分尺度上的份量。呼叫端做 fallback 估值時要用同一個尺度，否則
 *  「能擊倒」與「傷害高」兩種估值混在一起比會得到亂七八糟的排序。 */
export const PRIZE_SCORE_UNIT = W.PRIZE;

/** 單次試打並回傳完整評估（不平均；平均版見 evaluateAttack）。 */
function evaluateAttackOnce(
  state: GameState,
  actorIdx: 0 | 1,
  attackIndex: number,
  pool: Map<string, Card>,
): AttackEval {
  try {
    const oppIdx = (1 - actorIdx) as 0 | 1;
    const beforeOppActive = state.players[oppIdx].active;
    if (!beforeOppActive) return DEAD_EVAL;
    // ⚠獎賞有**兩條路徑**：沒有正面朝上的獎賞卡時是直接取走（自己的 prizes 堆變短），
    //   只有需要玩家挑的時候才留在 pendingPrizes。第一版只讀 pendingPrizes，實測
    //   「明明擊倒了對手卻算出 prizes=0」，分數因此輸給沒擊倒的招 —— 兩條都要算。
    const beforePending = state.pendingPrizes?.[actorIdx] ?? 0;
    const beforePrizeStack = state.players[actorIdx].prizes.length;
    const beforeSelf = state.players[actorIdx].active;
    const beforeSelfEnergy = beforeSelf?.energyAttached.length ?? 0;
    const beforeSelfDmg = beforeSelf?.damage ?? 0;

    return withIsolatedRandom(() => {
      const after = applyAction(
        shuffleHiddenZonesForSim(cloneState(state)), { type: 'ATTACK', attackIndex, actorIdx }, pool);
      if (!after || after === state) return DEAD_EVAL;

      const gameWon = after.phase === 'game-over' && after.winner === actorIdx;
      const oppNow = after.players[oppIdx].active;
      const ko = !oppNow || oppNow.iid !== beforeOppActive.iid;
      const prizes = Math.max(0, (after.pendingPrizes?.[actorIdx] ?? 0) - beforePending)
        + Math.max(0, beforePrizeStack - after.players[actorIdx].prizes.length);
      const oppDamage = oppEffectiveDamage(state, after, oppIdx, pool);

      const selfNow = after.players[actorIdx].active;
      // 自己被擊倒／換位時能量差沒有意義，記 0 避免誤判成「丟了很多能量」
      const sameSelf = selfNow && beforeSelf && selfNow.iid === beforeSelf.iid;
      const selfEnergyLost = sameSelf
        ? Math.max(0, beforeSelfEnergy - selfNow.energyAttached.length) : 0;
      const selfDamage = sameSelf ? Math.max(0, (selfNow.damage ?? 0) - beforeSelfDmg) : 0;
      // ⚠欄位名一定要查證：正確的是 `cantAttackPending`（攻擊當下設，擁有者下個回合開始時
      //   才 promote 成 cantAttackThisTurn）。我第一版寫成 cantAttackNextTurn／
      //   mustRechargeNextTurn —— 兩個都不存在，TypeScript 不會報錯、值恆為 undefined，
      //   結果是「下回合不能攻擊」這個代價**完全不被計入**而毫無徵兆。守衛已釘死此欄位。
      const cantAttackNext = !!(sameSelf && selfNow.cantAttackPending);

      let score = prizes * W.PRIZE + oppDamage
        - selfEnergyLost * W.SELF_ENERGY
        - selfDamage * W.SELF_DAMAGE
        - (cantAttackNext ? W.CANT_ATTACK_NEXT : 0);
      if (gameWon) score = Number.MAX_SAFE_INTEGER;

      return {
        ok: true, ko, dealt: ko ? Infinity : oppDamage, unresolved: !!after.pendingSelection,
        prizes, oppDamage, selfEnergyLost, selfDamage, gameWon, score,
      };
    });
  } catch {
    return DEAD_EVAL;   // fail-open
  }
}

/**
 * 評估一招，**試打多次取平均**。
 * ⚠為什麼要多次：擲幣類招式單試一次的結果是隨機的，只打一次會把「正面 200／反面 0」
 *   當成確定值 —— 剛好擲到反面就會永遠低估那一招。取平均才是期望值。
 *   次數少（預設 3）是為了瀏覽器效能；這是估計不是精算，註明於此免得日後誤解。
 */
export function evaluateAttack(
  state: GameState,
  actorIdx: 0 | 1,
  attackIndex: number,
  pool: Map<string, Card>,
  samples = 3,
): AttackEval {
  let acc: AttackEval | null = null;
  let okCount = 0, koCount = 0;
  for (let i = 0; i < samples; i++) {
    const r = evaluateAttackOnce(state, actorIdx, attackIndex, pool);
    if (!r.ok) continue;
    okCount++;
    if (r.ko) koCount++;
    acc = acc
      ? { ...r,
          prizes: acc.prizes + r.prizes, oppDamage: acc.oppDamage + r.oppDamage,
          selfEnergyLost: acc.selfEnergyLost + r.selfEnergyLost, selfDamage: acc.selfDamage + r.selfDamage,
          gameWon: acc.gameWon || r.gameWon,
          score: acc.score === Number.MAX_SAFE_INTEGER || r.score === Number.MAX_SAFE_INTEGER
            ? Number.MAX_SAFE_INTEGER : acc.score + r.score,
          unresolved: acc.unresolved || r.unresolved }
      : { ...r };
  }
  if (!acc || okCount === 0) return DEAD_EVAL;
  const avg = (n: number) => n / okCount;
  return {
    ...acc,
    ko: koCount * 2 > okCount,          // 過半數會擊倒才算「能擊倒」
    prizes: avg(acc.prizes), oppDamage: avg(acc.oppDamage),
    selfEnergyLost: avg(acc.selfEnergyLost), selfDamage: avg(acc.selfDamage),
    score: acc.score === Number.MAX_SAFE_INTEGER ? acc.score : avg(acc.score),
  };
}
