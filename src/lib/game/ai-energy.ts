/**
 * ⭐v6.432（AI 對戰強化：每回合都附能量）戰鬥位已經有招可用時，把手上的能量附給**備戰**裡需要能量的寶可夢。
 *
 * 背景（scripts/diag-ai-energy-skip.mjs 實測）：ai.ts 的附能量分支寫著「若已有招式可發，不附能量」（v2.357），
 *   戰鬥位打得出招的回合整回合都不附能量 ⇒ 56 副預組、3,733 個回合收尾裡有 16.2% 是「手上有能量卡、這回合沒附」，
 *   其中 98% 正是因為戰鬥位有招可用；備戰的寶可夢永遠等不到能量，接手的打手上場時一招都打不出來
 *   （呆呆王 vs 瑪俐：自己的回合只有 19% 有招可用）。
 *
 * 規則（全部用自己的公開資訊與引擎的中央判定，不解讀卡面文字、不前瞻）：
 *   - 只附給**備戰**：戰鬥位的行為不變（它已經有招可用；原本就不附）。
 *   - 候選：備戰裡有招式、而且**還有招付不起**的寶可夢（付不付得起一律問 canAffordAttack，host-aware），
 *     被鎖住不能附能量的（cantAttachEnergyThisTurn）排除。
 *   - 排序：主打手 > 副打手 > 其他（ai-roles）→ 這張能量附上去「立刻多付得起幾招」→ 能量屬性對得上（energyProvidesType）
 *     → 身上能量已經比較多的（離上場打得動比較近）。
 *   - 能量卡：每個候選各自挑「附上去多付得起最多招」的那張，其次屬性對得上的，再其次手牌順序。
 *   - 找不到候選 ⇒ 回 null（照舊不附）。
 *   - ⭐（fable 審查 v6.432 A）附上去會被丟掉的能量不附：用引擎在複本上試附一次，能量沒留在目標身上（例：火箭隊能量附在
 *     火箭隊以外的寶可夢會被丟棄）或試跑回合結束後就不在了（例：燃火能量「在自己的回合結束時丟棄」）⇒ 排除。
 *     不解讀卡面文字，只看引擎結算後能量還在不在。
 */
import type { Card, EnergyType } from '$lib/cards/types';
import type { GameState, CardInstance } from './types';
import { applyAction, canAffordAttack, energyProvidesType } from './engine';
import { getCardRole } from './ai-roles';
import { cloneState, shuffleHiddenZonesForSim, withIsolatedRandom } from './ai-eval';

const ROLE_RANK: Record<string, number> = { 'main-attacker': 2, 'sub-attacker': 1 };

/** inst 身上「付得起的招式」有幾招（中央 canAffordAttack）。 */
function affordableCount(state: GameState, me: 0 | 1, inst: CardInstance, pool: Map<string, Card>): number {
  const atks = pool.get(inst.cardId)?.attacks ?? [];
  let n = 0;
  for (const a of atks) if (canAffordAttack(inst, a.cost ?? [], pool, state, me, a.name)) n++;
  return n;
}

export function pickBenchEnergyAttach(
  state: GameState, me: 0 | 1, pool: Map<string, Card>,
): { energyIid: string; targetIid: string } | null {
  const p = state.players[me];
  const energies = p.hand.filter((c) => pool.get(c.cardId)?.supertype === 'Energy');
  if (!energies.length) return null;
  type Pick = { energyIid: string; targetIid: string; key: number[] };
  const picks: Pick[] = [];
  for (const t of p.bench) {
    if (t.cantAttachEnergyThisTurn) continue;
    const atks = pool.get(t.cardId)?.attacks ?? [];
    if (!atks.length) continue;
    const now = affordableCount(state, me, t, pool);
    if (now >= atks.length) continue;   // 每一招都付得起 ⇒ 不需要
    const type = pool.get(t.cardId)?.pokemonType;
    for (const e of energies) {
      const hypo = { ...t, energyAttached: [...t.energyAttached, e] } as CardInstance;
      const gain = affordableCount(state, me, hypo, pool) - now;
      const typeOk = type ? (energyProvidesType(t, e, type as EnergyType, pool) ? 1 : 0) : 0;
      picks.push({ energyIid: e.iid, targetIid: t.iid, key: [ROLE_RANK[getCardRole(t.cardId, null, pool)] ?? 0, gain, typeOk, t.energyAttached.length] });
    }
  }
  // 由好到壞排序（穩定排序：同分維持備戰與手牌順序），第一個「附上去會留下來」的就是答案（試附只做到找到為止）
  picks.sort((a, b) => (lexGreater(a.key, b.key) ? -1 : lexGreater(b.key, a.key) ? 1 : 0));
  for (const pk of picks) {
    if (energyStaysIfAttached(state, me, pk.energyIid, pk.targetIid, pool)) return { energyIid: pk.energyIid, targetIid: pk.targetIid };
  }
  return null;
}

/**
 * 把 energyIid 附到 targetIid 之後，能量會不會留下來。
 *   untilEndOfTurn=true（預設；附給備戰時用）：要留到這回合結束之後——燃火能量這類「回合結束丟棄」的不算。
 *   untilEndOfTurn=false（附給戰鬥位、這回合就要出招時用）：只要附上去當下留得住就算——燃火能量本來就是給這回合用的。
 *   ⚠ 試附在洗過看不到區域的複本上做（中央防線 shuffleHiddenZonesForSim；附能量可能觸發搜尋牌庫），亂數隔離。
 *   附完如果停在自己的選擇視窗（例：感應【超】能量的搜尋），能量已經附上 ⇒ 視為會留下（不再試跑回合結束）。
 *   任何例外 ⇒ 保守當成「不會留下」（不附；等同舊行為）。
 */
export function energyStaysIfAttached(
  state: GameState, me: 0 | 1, energyIid: string, targetIid: string, pool: Map<string, Card>, untilEndOfTurn = true,
): boolean {
  const onTarget = (st: GameState) => {
    const p = st.players[me];
    const t = [p.active, ...p.bench].find((c) => c?.iid === targetIid);
    return !!t && t.energyAttached.some((e) => e.iid === energyIid);
  };
  try {
    return withIsolatedRandom(() => {
      const sim = shuffleHiddenZonesForSim(cloneState(state), me);
      sim.activePlayerIndex = me;
      const a1 = applyAction(sim, { type: 'ATTACH_ENERGY', energyIid, targetIid }, pool);
      if (!a1 || a1 === sim || !onTarget(a1)) return false;
      if (!untilEndOfTurn || a1.pendingSelection) return true;
      const a2 = applyAction(a1, { type: 'END_TURN' }, pool);
      if (!a2 || a2 === a1) return true;   // 回合結束被拒（例：還有必須先處理的事）⇒ 至少附上去了
      return onTarget(a2);
    });
  } catch {
    return false;
  }
}

function lexGreater(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
