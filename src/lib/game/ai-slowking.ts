/**
 * ⭐v6.429 AI 打法：「把招式放到牌庫頂 → 呆呆王｜耀閃挑戰借來用」（站長說明的呆呆王核心打法）。
 *
 * 站長原話（2026-09-27）：「要將某些被學習招式的卡片 如巨金怪 酋雷姆等卡牌 利用夜間學院或是 暗碼迷的解讀等效果
 *   將高傷害或是一次可以攻擊多隻寶可夢的招式放回牌庫頂端，然後使用呆呆王的耀閃挑戰來攻擊」；
 *   「靈幽馬也算好目標」；「超級袋獸使用使者衝刺抽牌後，再利用拉帝亞斯的特性天空徑線撤退換成呆呆王」。
 *
 * 卡面（static/cards）：
 *   呆呆王｜耀閃挑戰：「將自己的牌庫上方1張卡丟棄，若那張卡為寶可夢卡（『擁有規則的寶可夢』除外），
 *     則選擇1個那隻寶可夢持有的招式，作為這個招式使用。」
 *   暗碼迷的解讀：「從自己的牌庫任意選擇2張卡。重洗剩餘牌庫，將所選的卡以任意順序排列，放回牌庫上方。」
 *   夜間學院：「雙方玩家在每個自己的回合時，可使用1次，可選擇1張自己的手牌，放回牌庫上方。」
 *
 * 設計原則（AI 對戰強化的紀律）：
 *   - 好目標不寫死卡名：把候選卡**假想放到牌庫頂**，用引擎試打耀閃挑戰（含借哪一招），分數最高的就是好目標。
 *     巨金怪（單體高傷）、酋雷姆（打 3 隻）、靈幽馬（12 個傷害指示物）誰比較好，由當下盤面算出來。
 *   - 只用自己合法知道的資訊：牌庫頂只認自己擺上去的（deck-top-known.ts）；手牌是自己的；牌庫內容在搜尋時本來就看得到。
 *   - 只對「場上或手上有會用耀閃挑戰的寶可夢」的一方生效；其他牌組的行為一行都不變。
 */
import type { Card } from '$lib/cards/types';
import type { GameState, GameAction, CardInstance } from './types';
import { applyAction, getEffectiveAttacks, getAvailableAttacks, getUsableAbilities, isRulePokemon, canAffordAttack, energyProvidesType } from './engine';
import { evaluateAttack, cloneState, withIsolatedRandom, shuffleHiddenZonesForSim, type AttackActionExtra } from './ai-eval';
import { knownDeckTopIids, recordKnownDeckTop } from './deck-top-known';

/** 借「自己牌庫頂那張」招式的攻擊（目前全池只有這一招）。 */
export const TOP_COPY_ATTACK_NAME = '耀閃挑戰';

const hasTopCopyAttack = (card: Card | undefined): boolean =>
  !!card?.attacks?.some((a) => a.name === TOP_COPY_ATTACK_NAME);

/** 這一方有沒有在走「牌庫頂借招」打法：場上已有會耀閃挑戰的寶可夢，或場上有牠的進化前、手牌／牌庫裡有牠。 */
export function isTopCopyPlayer(state: GameState, me: 0 | 1, pool: Map<string, Card>): boolean {
  const p = state.players[me];
  const field = [p.active, ...p.bench].filter(Boolean) as CardInstance[];
  if (field.some((c) => hasTopCopyAttack(pool.get(c.cardId)))) return true;
  // 牌庫＋獎賞卡（都是看不到的區域）合起來看：等於「自己的牌組清單扣掉看得到的」，玩家本來就知道；
  //   不單看牌庫，免得 AI 知道「呆呆王在獎賞卡裡、不在牌庫」這種真人不知道的事。
  const evolvers = [...p.hand, ...p.deck, ...p.prizes].map((c) => pool.get(c.cardId)).filter(hasTopCopyAttack) as Card[];
  const froms = new Set(evolvers.map((c) => c.evolvesFrom).filter(Boolean));
  return field.some((c) => froms.has(pool.get(c.cardId)?.name));
}

/**
 * 這隻付不付得起耀閃挑戰的能量（fable 審查 v6.429：一律走引擎的中央判定 canAffordAttack ——
 *   能量「個數」與屬性都是 host-aware 的（燃火能量、稜鏡能量…），不可以用「身上幾張能量卡」自己數）。
 */
export function canPayTopCopy(state: GameState, me: 0 | 1, inst: CardInstance, pool: Map<string, Card>): boolean {
  const atk = pool.get(inst.cardId)?.attacks?.find((a) => a.name === TOP_COPY_ATTACK_NAME);
  return !!atk && canAffordAttack(inst, atk.cost ?? [], pool, state, me, atk.name);
}

/** 場上會耀閃挑戰的寶可夢：戰鬥位優先，其次備戰裡付得起的，再其次能量卡最多的（只用來排序）。 */
export function topCopyUser(state: GameState, me: 0 | 1, pool: Map<string, Card>): CardInstance | null {
  const p = state.players[me];
  if (p.active && hasTopCopyAttack(pool.get(p.active.cardId))) return p.active;
  const bench = p.bench.filter((c) => hasTopCopyAttack(pool.get(c.cardId)));
  if (!bench.length) return null;
  const rank = (c: CardInstance) => (canPayTopCopy(state, me, c, pool) ? 1000 : 0) + c.energyAttached.length;
  return bench.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}

/**
 * 牌庫頂借招打法要附給 tgt 的能量（手牌裡挑一張；沒有合適的回 null）。
 *   - protect（已知牌庫頂值得保護）時，會把牌庫頂弄掉的能量不附（fable 審查 D-1：感應【超】能量附在超寶可夢身上會搜尋並重洗牌庫）。
 *   - 能提供【超】的優先（屬性判定走引擎的中央 energyProvidesType，host-aware）；其次任何能量（耀閃挑戰的另一個是【無】）。
 */
export function pickTopCopyEnergy(
  state: GameState, me: 0 | 1, tgt: CardInstance, pool: Map<string, Card>, protect: boolean,
  resolve: (st: GameState, pool: Map<string, Card>) => GameAction | null,
): CardInstance | null {
  const ens = state.players[me].hand.filter((c) => pool.get(c.cardId)?.supertype === 'Energy')
    .filter((c) => !protect || !wouldDisturbKnownTop(state, me, { type: 'ATTACH_ENERGY', energyIid: c.iid, targetIid: tgt.iid }, pool, resolve));
  return ens.find((c) => energyProvidesType(tgt, c, 'Psychic', pool)) ?? ens[0] ?? null;
}

/** 該寶可夢的「有效招式清單」裡，耀閃挑戰的 index（沒有回 -1）。 */
export function topCopyAttackIndex(state: GameState, inst: CardInstance, pool: Map<string, Card>): number {
  return getEffectiveAttacks(state, inst, pool).findIndex((e) => e.atk.name === TOP_COPY_ATTACK_NAME);
}

/** 牌庫頂這張能不能被借（卡面：寶可夢卡、非「擁有規則的寶可夢」、有招式）。 */
export function isBorrowableTop(card: Card | undefined): boolean {
  return !!card && card.supertype === 'Pokemon' && !isRulePokemon(card) && (card.attacks?.length ?? 0) > 0;
}

/**
 * 已知牌庫頂時，耀閃挑戰借哪一招最好（逐招試打）。牌庫頂未知或借不了 ⇒ null（呼叫端走一般評估）。
 * @returns { score, choice } —— choice 要原封放進 ATTACK 動作的 copyAttackChoice
 */
export function bestKnownTopCopy(
  state: GameState, me: 0 | 1, attackIndex: number, pool: Map<string, Card>,
): { score: number; choice: NonNullable<AttackActionExtra['copyAttackChoice']>; ok: boolean; unresolved: boolean } | null {
  const topIid = knownDeckTopIids(state, me)[0];
  if (!topIid) return null;
  const top = state.players[me].deck[0];
  if (!top || top.iid !== topIid) return null;
  const card = pool.get(top.cardId);
  if (!isBorrowableTop(card)) return null;
  let best: { score: number; choice: { pokeIid: string; attackIndex: number }; ok: boolean; unresolved: boolean } | null = null;
  (card!.attacks ?? []).forEach((_a, j) => {
    const choice = { pokeIid: top.iid, attackIndex: j };
    const ev = evaluateAttack(state, me, attackIndex, pool, 3, { copyAttackChoice: choice });
    if (!ev.ok) return;
    if (!best || ev.score > best.score) best = { score: ev.score, choice, ok: ev.ok, unresolved: ev.unresolved };
  });
  return best;
}

/** 找一張基本【超】能量的卡號（假想補能量用；找不到回 null）。 */
function basicPsychicEnergyId(pool: Map<string, Card>): string | null {
  for (const [id, c] of pool) if (c.supertype === 'Energy' && c.name === '基本【超】能量') return id;
  return null;
}

/**
 * 「把 cardIid 這張（在牌庫或手牌）放到牌庫頂的話，耀閃挑戰能打出多少分」。
 * 假想盤面：會耀閃挑戰的那隻換到戰鬥位；能量不夠就補基本【超】能量到剛好付得起（只用於排序，不是真的附能量）。
 * 分數＝逐招試打的最高分（與出招時的評分同一把尺）；借不了／試不出來 ⇒ -Infinity。
 */
export function valueAsTop(state: GameState, me: 0 | 1, cardIid: string, pool: Map<string, Card>): number {
  try {
    const user = topCopyUser(state, me, pool);
    if (!user) return -Infinity;
    const sim = cloneState(state);
    sim.pendingSelection = undefined as unknown as GameState['pendingSelection'];
    sim.phase = 'playing';
    sim.turnPhase = 'main';
    sim.activePlayerIndex = me;
    const p = sim.players[me];
    // 目標卡從牌庫或手牌拿出來，放到牌庫頂
    let target: CardInstance | undefined;
    const di = p.deck.findIndex((c) => c.iid === cardIid);
    if (di >= 0) { target = p.deck[di]; p.deck.splice(di, 1); }
    else { const hi = p.hand.findIndex((c) => c.iid === cardIid); if (hi >= 0) { target = p.hand[hi]; p.hand.splice(hi, 1); } }
    if (!target || !isBorrowableTop(pool.get(target.cardId))) return -Infinity;
    p.deck.unshift(target);
    // 會耀閃挑戰的那隻換到戰鬥位
    if (!p.active || p.active.iid !== user.iid) {
      const bi = p.bench.findIndex((c) => c.iid === user.iid);
      if (bi < 0) return -Infinity;
      const old = p.active;
      p.active = p.bench[bi];
      p.bench.splice(bi, 1);
      if (old) p.bench.push(old);
    }
    p.active!.cantAttackThisTurn = undefined;
    // 能量不夠就假想補基本【超】能量到付得起（排序用；付不付得起一律問中央 canAffordAttack）
    const eid = basicPsychicEnergyId(pool);
    for (let i = 0; eid && i < 4 && !canPayTopCopy(sim, me, p.active!, pool); i++) {
      p.active!.energyAttached.push({ iid: `__hypo_e${i}`, cardId: eid, damage: 0, energyAttached: [] } as unknown as CardInstance);
    }
    const s2 = recordKnownDeckTop(sim, me, [target.iid]);
    const idx = topCopyAttackIndex(s2, s2.players[me].active!, pool);
    if (idx < 0 || !getAvailableAttacks(s2, pool).includes(idx)) return -Infinity;
    const r = bestKnownTopCopy(s2, me, idx, pool);
    return r && r.ok ? r.score : -Infinity;
  } catch {
    return -Infinity;
  }
}

/** 從 candidates 裡依 valueAsTop 排序（高→低），只留借得了的。 */
export function rankTopTargets(state: GameState, me: 0 | 1, candidates: CardInstance[], pool: Map<string, Card>): { iid: string; value: number }[] {
  return candidates
    .filter((c) => isBorrowableTop(pool.get(c.cardId)))
    .map((c) => ({ iid: c.iid, value: valueAsTop(state, me, c.iid, pool) }))
    .filter((x) => Number.isFinite(x.value))
    .sort((a, b) => b.value - a.value);
}

/**
 * 暗碼迷的解讀的選擇（2 張，先選＝上方第 2 位、後選＝最上方）。
 * 有會耀閃挑戰的寶可夢在場 ⇒ 最好的目標放最上方、次好的放第 2 張；
 * 只有進化前在場 ⇒ 最上方放能進化的呆呆王（下回合抽到）、第 2 張放最好的目標（以印刷傷害排序）。
 * 回傳 null ⇒ 交回通用選擇器。
 */
export function pickCipherArrange(state: GameState, me: 0 | 1, pool: Map<string, Card>): string[] | null {
  const p = state.players[me];
  if (p.deck.length < 2) return null;
  if (!isTopCopyPlayer(state, me, pool)) {
    // 場上連進化前都沒有：最上方放進化前（下回合抽到、放上備戰），第 2 張放會耀閃挑戰的寶可夢
    const evoCard = p.deck.map((c) => ({ c, card: pool.get(c.cardId) })).find((x) => hasTopCopyAttack(x.card));
    if (!evoCard) return null;
    const basic = p.deck.find((c) => pool.get(c.cardId)?.name === evoCard.card!.evolvesFrom);
    return basic ? [evoCard.c.iid, basic.iid] : null;
  }
  if (topCopyUser(state, me, pool)) {
    const ranked = rankTopTargets(state, me, p.deck, pool);
    if (ranked.length >= 2) return [ranked[1].iid, ranked[0].iid];
    if (ranked.length === 1) {
      const other = p.deck.find((c) => c.iid !== ranked[0].iid)!;
      return [other.iid, ranked[0].iid];
    }
    return null;
  }
  const evo = p.deck.find((c) => hasTopCopyAttack(pool.get(c.cardId)));
  const printed = (c: CardInstance) => Math.max(0, ...(pool.get(c.cardId)?.attacks ?? []).map((a) => parseInt(String(a.damage ?? '').replace(/[^0-9]/g, ''), 10) || 0));
  const target = p.deck.filter((c) => c.iid !== evo?.iid && isBorrowableTop(pool.get(c.cardId))).sort((a, b) => printed(b) - printed(a))[0];
  if (!evo || !target) return null;
  return [target.iid, evo.iid];
}

/** 夜間學院的選擇：手牌裡最好的借招目標；沒有就交回通用選擇器（null）。 */
export function pickNightAcademyCard(state: GameState, me: 0 | 1, pool: Map<string, Card>): string | null {
  if (!isTopCopyPlayer(state, me, pool)) return null;
  const ranked = rankTopTargets(state, me, state.players[me].hand, pool);
  return ranked[0]?.iid ?? null;
}

/**
 * 要不要現在用夜間學院：場上的競技場是夜間學院、這回合還沒用、會耀閃挑戰的寶可夢在戰鬥位且付得起，
 * 而手牌裡有比「目前已知牌庫頂」更好的目標（牌庫頂未知 ⇒ 只要手牌有目標就用）。
 */
export function shouldUseNightAcademy(state: GameState, me: 0 | 1, pool: Map<string, Card>): boolean {
  const stadium = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  if (stadium?.name !== '夜間學院') return false;
  if (state.stadiumUsedThisTurn?.[me]) return false;
  if (!isTopCopyPlayer(state, me, pool)) return false;
  const p = state.players[me];
  if (!p.active || !hasTopCopyAttack(pool.get(p.active.cardId))) return false;
  const idx = topCopyAttackIndex(state, p.active, pool);
  if (idx < 0 || !getAvailableAttacks(state, pool).includes(idx)) return false;
  const bestHand = rankTopTargets(state, me, p.hand, pool)[0];
  if (!bestHand) return false;
  const topIid = knownDeckTopIids(state, me)[0];
  if (!topIid) return true;
  const cur = valueAsTop(state, me, topIid, pool);
  return bestHand.value > cur;
}

/** 已知牌庫頂是不是「值得保護」的借招目標（有的話，別讓抽牌／洗牌把它弄掉）。 */
export function hasValuableKnownTop(state: GameState, me: 0 | 1, pool: Map<string, Card>): boolean {
  const topIid = knownDeckTopIids(state, me)[0];
  if (!topIid) return false;
  const top = state.players[me].deck[0];
  return !!top && top.iid === topIid && isBorrowableTop(pool.get(top.cardId)) && !!topCopyUser(state, me, pool);
}

/**
 * 這個動作會不會把「已知的好牌庫頂」弄掉（抽走、洗牌…）。試跑動作，自己的選擇視窗交給 resolve 解完，再驗證已知牌庫頂。
 * ⚠ 試跑在隔離亂數裡做，不影響真正對局的亂數序列。
 */
export function wouldDisturbKnownTop(
  state: GameState, me: 0 | 1, action: GameAction, pool: Map<string, Card>,
  resolve: (st: GameState, pool: Map<string, Card>) => GameAction | null,
): boolean {
  const before = knownDeckTopIids(state, me);
  if (!before.length) return false;
  try {
    return withIsolatedRandom(() => {
      // fable 審查 A-3：試跑也要先過中央防線（自己的已知牌庫頂保留，其餘牌庫與對手牌庫打亂）
      let st = applyAction(shuffleHiddenZonesForSim(cloneState(state), me), action, pool);
      for (let i = 0; i < 6 && st.pendingSelection && st.pendingSelection.actorIdx === me; i++) {
        const a = resolve(st, pool);
        if (!a) break;
        const nx = applyAction(st, a, pool);
        if (nx === st) break;
        st = nx;
      }
      const after = knownDeckTopIids(st, me);
      return after[0] !== before[0];
    });
  } catch {
    return false;
  }
}

/** 使用後會從自己牌庫抽牌的特性（試跑看牌庫有沒有變少）。用來在擺牌庫頂之前先把抽牌做完。 */
export function drawingAbilitiesNow(state: GameState, me: 0 | 1, pool: Map<string, Card>): { iid: string; abilityIndex: number }[] {
  const out: { iid: string; abilityIndex: number }[] = [];
  try {
    for (const a of getUsableAbilities(state, pool)) {
      const act: GameAction = { type: 'USE_ABILITY', iid: a.iid, abilityIndex: a.abilityIndex };
      const drew = withIsolatedRandom(() => {
        const nx = applyAction(shuffleHiddenZonesForSim(cloneState(state), me), act, pool);   // A-3：過中央防線
        return nx.players[me].deck.length < state.players[me].deck.length && nx.players[me].hand.length > state.players[me].hand.length - 1;
      });
      if (drew) out.push({ iid: a.iid, abilityIndex: a.abilityIndex });
    }
  } catch { /* fail-open */ }
  return out;
}
