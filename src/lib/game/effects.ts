/**
 * 訓練家效果登錄表
 *
 * TRAINER_EFFECTS: cardName → 效果函式（即時效果或回傳 pendingSelection）
 * RESOLVERS:       effectKey → 玩家選擇後的繼續函式
 *
 * M2 實裝：常見非互動支援者 + 常見物品（切換/球/藥水）
 * M3/M4 逐步填入更多效果
 */

import type { Card } from '$lib/cards/types';
import type { GameState, PlayerState, CardInstance, PendingSelection } from './types';

// ── 型別 ─────────────────────────────────────────────────────────────────────

/** 即時或觸發 pendingSelection 的效果函式 */
type EffectFn = (
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>,
  cardInst?: CardInstance
) => GameState;

/** 玩家做完選擇後的繼續處理 */
export type ResolveFn = (
  state: GameState,
  actorIdx: 0 | 1,
  selectedIids: string[],
  params: Record<string, unknown> | undefined,
  pool: Map<string, Card>
) => GameState;

// ── 工具函式 ─────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function updatePlayer(
  state: GameState,
  idx: 0 | 1,
  fn: (p: PlayerState) => PlayerState
): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[idx] = fn(players[idx]);
  return { ...state, players };
}

function addLog(
  state: GameState,
  msg: string,
  playerIdx: 0 | 1 | null = null
): GameState {
  return {
    ...state,
    log: [...state.log, { turn: state.turn, playerIndex: playerIdx, message: msg }],
  };
}

function drawCards(state: GameState, idx: 0 | 1, count: number): GameState {
  return updatePlayer(state, idx, (p) => {
    const n = Math.min(count, p.deck.length);
    if (n <= 0) return p;
    const drawn = p.deck.slice(0, n);
    return { ...p, deck: p.deck.slice(n), hand: [...p.hand, ...drawn] };
  });
}

function discardHand(state: GameState, idx: 0 | 1): GameState {
  return updatePlayer(state, idx, (p) => ({
    ...p,
    discard: [...p.discard, ...p.hand],
    hand: [],
  }));
}

function returnHandToDeck(state: GameState, idx: 0 | 1): GameState {
  return updatePlayer(state, idx, (p) => ({
    ...p,
    deck: shuffle([...p.deck, ...p.hand]),
    hand: [],
  }));
}

function withPending(state: GameState, sel: PendingSelection): GameState {
  return { ...state, pendingSelection: sel };
}

// ── 登錄表 ───────────────────────────────────────────────────────────────────

/** cardName（完全符合）→ 效果函式 */
export const TRAINER_EFFECTS = new Map<string, EffectFn>();

/** effectKey → resolver 函式 */
export const RESOLVERS = new Map<string, ResolveFn>();

/**
 * cardName → 可否打出此訓練家卡的前置檢查。
 * 返回 true 表示可打；false 表示缺少合法目標（例如夜間擔架棄牌區為空）。
 * 未註冊 guard 的卡片預設為可打出（保持向後相容）。
 */
export type TrainerGuardFn = (
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>
) => boolean;
export const TRAINER_GUARDS = new Map<string, TrainerGuardFn>();

function reg(name: string, fn: EffectFn) {
  TRAINER_EFFECTS.set(name, fn);
}

function regR(key: string, fn: ResolveFn) {
  RESOLVERS.set(key, fn);
}

function regG(name: string, fn: TrainerGuardFn) {
  TRAINER_GUARDS.set(name, fn);
}

export function canPlayTrainer(
  cardName: string,
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>
): boolean {
  const guard = TRAINER_GUARDS.get(cardName);
  return guard ? guard(state, actorIdx, pool) : true;
}

// ══════════════════════════════════════════════════════════════════════════════
// 即時支援者（無需互動）
// ══════════════════════════════════════════════════════════════════════════════

// 管理員 — 抽 2 張
reg('管理員', (st, idx) => {
  st = addLog(st, '管理員：抽 2 張', idx);
  return drawCards(st, idx, 2);
});

// 帕底亞的夥伴 — 抽 3 張
reg('帕底亞的夥伴', (st, idx) => {
  st = addLog(st, '帕底亞的夥伴：抽 3 張', idx);
  return drawCards(st, idx, 3);
});

// 納莉 — 抽 4 張（回合結束手牌≥5棄手 M2 省略）
reg('納莉', (st, idx) => {
  st = addLog(st, '納莉：抽 4 張', idx);
  return drawCards(st, idx, 4);
});

// 丹瑜 — 手牌全丟，抽 5 張（先攻第一回合可用）
reg('丹瑜', (st, idx) => {
  st = addLog(st, '丹瑜：手牌全丟，抽 5 張', idx);
  st = discardHand(st, idx);
  return drawCards(st, idx, 5);
});

// 紫竽 — 手牌洗回牌庫，抽 4 張
reg('紫竽', (st, idx) => {
  st = addLog(st, '紫竽：手牌洗回牌庫，抽 4 張', idx);
  st = returnHandToDeck(st, idx);
  return drawCards(st, idx, 4);
});

// 松葉的信心 — 手牌洗回牌庫，抽 5 張
reg('松葉的信心', (st, idx) => {
  st = addLog(st, '松葉的信心：手牌洗回牌庫，抽 5 張', idx);
  st = returnHandToDeck(st, idx);
  return drawCards(st, idx, 5);
});

// 枇琶 — 抽 3 張（簡化，不處理額外效果）
reg('枇琶', (st, idx) => {
  st = addLog(st, '枇琶：抽 3 張', idx);
  return drawCards(st, idx, 3);
});

// ══════════════════════════════════════════════════════════════════════════════
// 互動支援者
// ══════════════════════════════════════════════════════════════════════════════

// 艾莉絲的鬥志 — 丟棄 1 張手牌，抽至 6 張
reg('艾莉絲的鬥志', (st, idx) => {
  const hand = st.players[idx].hand;
  if (hand.length === 0) {
    return addLog(st, '艾莉絲的鬥志：手牌為空，無法使用', idx);
  }
  st = addLog(st, '艾莉絲的鬥志：選 1 張手牌丟棄，再抽至 6 張', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'alice-courage',
  });
});
regR('alice-courage', (st, idx, iids, _params, _pool) => {
  st = updatePlayer(st, idx, (p) => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const hand = p.hand.filter(c => !iids.includes(c.iid));
    return { ...p, hand, discard: [...p.discard, ...toDiscard] };
  });
  const needed = Math.max(0, 6 - st.players[idx].hand.length);
  return drawCards(st, idx, needed);
});

// 探險家的嚮導 — 查看牌庫頂 6 張，選 2 張加手牌，其餘丟棄
reg('探險家的嚮導', (st, idx) => {
  const top6Iids = st.players[idx].deck.slice(0, 6).map(c => c.iid);
  if (top6Iids.length === 0) {
    return addLog(st, '探險家的嚮導：牌庫為空', idx);
  }
  st = addLog(st, '探險家的嚮導：查看牌庫頂 6 張，選最多 2 張', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TOP6',
    minCount: 0, maxCount: 2,
    effectKey: 'explorer-guide',
    params: { top6Iids },
  });
});
regR('explorer-guide', (st, idx, iids, params, _pool) => {
  const top6Iids = (params?.top6Iids as string[]) ?? [];
  return updatePlayer(st, idx, (p) => {
    const top6 = p.deck.filter(c => top6Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top6Iids.includes(c.iid));
    const chosen = top6.filter(c => iids.includes(c.iid));
    const discarded = top6.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck: rest,
      hand: [...p.hand, ...chosen],
      discard: [...p.discard, ...discarded],
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 切換
// ══════════════════════════════════════════════════════════════════════════════

function switchEffect(label: string): EffectFn {
  return (st, idx) => {
    const player = st.players[idx];
    if (!player.active || player.bench.length === 0) {
      return addLog(st, `${label}：備戰區沒有寶可夢，無法切換`, idx);
    }
    st = addLog(st, `${label}：選擇換入的備戰寶可夢`, idx);
    return withPending(st, {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'do-switch',
    });
  };
}
reg('寶可夢交替', switchEffect('寶可夢交替'));
reg('急進開關', switchEffect('急進開關'));
// 切換類：備戰必須有寶可夢
regG('寶可夢交替', (st, idx) => st.players[idx].bench.length > 0);
regG('急進開關', (st, idx) => st.players[idx].bench.length > 0);

regR('do-switch', (st, idx, iids, _params, _pool) => {
  return updatePlayer(st, idx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    const newActive = { ...p.bench[bIdx], justPlaced: false };
    const newBench = [...p.bench];
    newBench[bIdx] = { ...p.active };
    return { ...p, active: newActive, bench: newBench };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 藥水 / 回復
// ══════════════════════════════════════════════════════════════════════════════

// 好傷藥 — 回復 60 HP，丟棄 1 個能量
// Guard: 場上至少 1 隻寶可夢「有傷害且身上有能量」
regG('好傷藥', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0 && c.energyAttached.length > 0);
});
reg('好傷藥', (st, idx) => {
  st = addLog(st, '好傷藥：選擇回復 60 HP 的寶可夢（丟棄 1 個能量）', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'heal-60-discard-1',
    params: { healAmount: 60, discardEnergy: 1 },
  });
});

// 龍之秘藥 — 回復 120 HP（簡化，原版有條件）
// Guard: 場上至少 1 隻寶可夢有傷害
regG('龍之秘藥', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('龍之秘藥', (st, idx) => {
  st = addLog(st, '龍之秘藥：選擇回復 120 HP 的寶可夢', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'heal-120',
    params: { healAmount: 120, discardEnergy: 0 },
  });
});

regR('heal-60-discard-1', healResolver);
regR('heal-120', healResolver);

function healResolver(
  st: GameState,
  idx: 0 | 1,
  iids: string[],
  params: Record<string, unknown> | undefined,
  _pool: Map<string, Card>
): GameState {
  const healAmount = (params?.healAmount as number) ?? 30;
  const discardCount = (params?.discardEnergy as number) ?? 0;
  return updatePlayer(st, idx, (p) => {
    const iid = iids[0];
    const isActive = p.active?.iid === iid;
    let target = isActive ? p.active! : p.bench.find(c => c.iid === iid);
    if (!target) return p;

    const newDamage = Math.max(0, target.damage - healAmount);
    const discarded = target.energyAttached.slice(-discardCount);
    const remaining = target.energyAttached.slice(0, target.energyAttached.length - discardCount);
    const healed: CardInstance = { ...target, damage: newDamage, energyAttached: remaining };

    return {
      ...p,
      active: isActive ? healed : p.active,
      bench: isActive ? p.bench : p.bench.map(c => c.iid === iid ? healed : c),
      discard: [...p.discard, ...discarded],
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫
// ══════════════════════════════════════════════════════════════════════════════

// 好友寶芬 — 從牌庫選最多 2 隻 HP≤70 基礎寶可夢放備戰
reg('好友寶芬', (st, idx) => {
  st = addLog(st, '好友寶芬：從牌庫選至多 2 隻 HP≤70 基礎寶可夢到備戰區', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic:HP70',
    minCount: 0, maxCount: 2,
    effectKey: 'bench-basic-from-deck',
  });
});

// 赫普的包包 — 從牌庫選最多 2 隻「赫普的寶可夢」基礎寶可夢到備戰（簡化為任何基礎）
reg('赫普的包包', (st, idx) => {
  st = addLog(st, '赫普的包包：從牌庫選至多 2 隻基礎寶可夢到備戰區', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic',
    minCount: 0, maxCount: 2,
    effectKey: 'bench-basic-from-deck',
  });
});

regR('bench-basic-from-deck', (st, idx, iids, _params, _pool) => {
  return updatePlayer(st, idx, (p) => {
    const selected = p.deck
      .filter(c => iids.includes(c.iid))
      .map(c => ({ ...c, justPlaced: true }));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    const bench = [...p.bench, ...selected].slice(0, 5);
    return { ...p, deck: shuffle(remaining), bench };
  });
});

// 甜蜜球 — 從牌庫選 1 隻與對手出場寶可夢同名的寶可夢（簡化：選任意寶可夢加手牌）
reg('甜蜜球', (st, idx) => {
  st = addLog(st, '甜蜜球：從牌庫選 1 張寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 黑暗球 — 查看牌庫底 7 張，選 1 張寶可夢加手牌
reg('黑暗球', (st, idx) => {
  st = addLog(st, '黑暗球：從牌庫選 1 張寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

regR('search-pokemon-to-hand', (st, idx, iids, _params, _pool) => {
  return updatePlayer(st, idx, (p) => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle(remaining), hand: [...p.hand, ...chosen] };
  });
});

// 小剛的發掘（Supporter）— 從牌庫選至多 2 隻基礎寶可夢 or 1 隻進化寶可夢加手牌
reg('小剛的發掘', (st, idx) => {
  st = addLog(st, '小剛的發掘：從牌庫選最多 2 隻基礎寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic',
    minCount: 0, maxCount: 2,
    effectKey: 'search-pokemon-to-hand',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 支援者 — 抽牌系列
// ══════════════════════════════════════════════════════════════════════════════

// 莉莉艾的決意 — 手牌洗回牌庫，抽 6 張（獎勵牌剩 6 張時抽 8 張）
reg('莉莉艾的決意', (st, idx) => {
  const prizes = st.players[idx].prizes.length;
  const drawCount = prizes >= 6 ? 8 : 6;
  st = addLog(st, `莉莉艾的決意：手牌洗回牌庫，抽 ${drawCount} 張`, idx);
  st = returnHandToDeck(st, idx);
  return drawCards(st, idx, drawCount);
});

// ══════════════════════════════════════════════════════════════════════════════
// 支援者 — 呼叫對手（Gust 系列）
// ══════════════════════════════════════════════════════════════════════════════

// 老大的指令 — 選 1 隻對手備戰寶可夢與其戰鬥寶可夢互換
regG('老大的指令', (st, idx) => st.players[(1 - idx) as 0 | 1].bench.length > 0);
reg('老大的指令', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  if (st.players[oppIdx].bench.length === 0) {
    return addLog(st, '老大的指令：對手備戰區沒有寶可夢', idx);
  }
  st = addLog(st, '老大的指令：選擇要呼叫的對手備戰寶可夢', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'gust-opp',
  });
});

regR('gust-opp', (st, idx, iids, _params, _pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  return updatePlayer(st, oppIdx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    const newBench = [...p.bench];
    newBench[bIdx] = p.active;
    return { ...p, active: { ...p.bench[bIdx], justPlaced: false }, bench: newBench };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（補充）
// ══════════════════════════════════════════════════════════════════════════════

// 高級球 — 丟棄 2 張手牌，搜尋任意寶可夢加手牌
// Guard: 手牌至少 3 張（含本卡）—— 打出後需再丟 2 張
regG('高級球', (st, idx) => st.players[idx].hand.length >= 3);
reg('高級球', (st, idx) => {
  if (st.players[idx].hand.length < 2) {
    return addLog(st, '高級球：手牌不足 2 張，無法使用', idx);
  }
  st = addLog(st, '高級球：選擇 2 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 2, maxCount: 2,
    effectKey: 'ultra-ball-discard',
  });
});
regR('ultra-ball-discard', (st, idx, iids, _params, _pool) => {
  st = updatePlayer(st, idx, (p) => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    return { ...p, hand: p.hand.filter(c => !iids.includes(c.iid)), discard: [...p.discard, ...toDiscard] };
  });
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 超級信號 — 從牌庫搜尋 1 張 ex 寶可夢加手牌（簡化：搜任意寶可夢）
reg('超級信號', (st, idx) => {
  st = addLog(st, '超級信號：從牌庫選 1 張超級進化寶可夢 ex 加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'ex',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 棄牌區回收
// ══════════════════════════════════════════════════════════════════════════════

// 夜間擔架 — 從棄牌區選 1 張寶可夢或基本能量卡加手牌
regG('夜間擔架', (st, idx, pool) => {
  // 棄牌區必須至少有 1 張寶可夢或能量
  return st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' || card?.supertype === 'Energy';
  });
});
reg('夜間擔架', (st, idx) => {
  st = addLog(st, '夜間擔架：從棄牌區選 1 張寶可夢或基本能量加手牌', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonOrEnergy',
    minCount: 1, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

// 能量回收器 — 從棄牌區選最多 5 張基本能量卡放回牌庫（義務性：至少選 1 張）
regG('能量回收器', (st, idx, pool) =>
  st.players[idx].discard.some(c => pool.get(c.cardId)?.supertype === 'Energy')
);
reg('能量回收器', (st, idx, pool) => {
  const energies = st.players[idx].discard.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  const maxN = Math.min(5, energies.length);
  st = addLog(st, `能量回收器：從棄牌區選 1–${maxN} 張基本能量洗回牌庫`, idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 1, maxCount: maxN,
    effectKey: 'energy-retrieval',
  });
});
regR('energy-retrieval', (st, idx, iids, _params, _pool) => {
  return updatePlayer(st, idx, (p) => {
    const chosen = p.discard.filter(c => iids.includes(c.iid));
    const newDiscard = p.discard.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle([...p.deck, ...chosen]), discard: newDiscard };
  });
});

regR('discard-to-hand', (st, idx, iids, _params, _pool) => {
  return updatePlayer(st, idx, (p) => {
    const chosen = p.discard.filter(c => iids.includes(c.iid));
    return { ...p, discard: p.discard.filter(c => !iids.includes(c.iid)), hand: [...p.hand, ...chosen] };
  });
});

// 奇跡修正檔 — 從棄牌區選 1 張基本超能量，附於備戰的超寶可夢身上（兩步）
regG('奇跡修正檔', (st, idx, pool) => {
  // 棄牌區有能量 + 備戰有超屬寶可夢才能打
  const hasEnergy = st.players[idx].discard.some(c => pool.get(c.cardId)?.supertype === 'Energy');
  const hasPsychicBench = st.players[idx].bench.some(b => pool.get(b.cardId)?.pokemonType === 'Psychic');
  return hasEnergy && hasPsychicBench;
});
reg('奇跡修正檔', (st, idx, pool) => {
  st = addLog(st, '奇跡修正檔：從棄牌區選 1 張基本超能量', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 1, maxCount: 1,
    effectKey: 'miracle-codec-energy',
  });
});
regR('miracle-codec-energy', (st, idx, iids, _params, _pool) => {
  if (iids.length === 0) return st;
  const energyIid = iids[0];
  if (st.players[idx].bench.length === 0) {
    // 直接附到出場寶可夢
    return updatePlayer(st, idx, (p) => {
      const energyCard = p.discard.find(c => c.iid === energyIid);
      if (!energyCard || !p.active) return p;
      return {
        ...p,
        discard: p.discard.filter(c => c.iid !== energyIid),
        active: { ...p.active, energyAttached: [...p.active.energyAttached, energyCard] },
      };
    });
  }
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'miracle-codec-attach',
    params: { energyIid },
  });
});
regR('miracle-codec-attach', (st, idx, iids, params, _pool) => {
  const energyIid = params?.energyIid as string;
  if (!energyIid) return st;
  const targetIid = iids[0];
  return updatePlayer(st, idx, (p) => {
    const energyCard = p.discard.find(c => c.iid === energyIid);
    if (!energyCard) return p;
    return {
      ...p,
      discard: p.discard.filter(c => c.iid !== energyIid),
      bench: p.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, energyCard] }
        : c),
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 切換（呼叫對手 + 自己切換）
// ══════════════════════════════════════════════════════════════════════════════

// 頂尖捕捉器 — 選 1 隻對手備戰 → 換到對手場上；再選自己備戰 → 切換自己
regG('頂尖捕捉器', (st, idx) => st.players[(1 - idx) as 0 | 1].bench.length > 0);
reg('頂尖捕捉器', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  if (st.players[oppIdx].bench.length === 0) {
    return addLog(st, '頂尖捕捉器：對手備戰區沒有寶可夢', idx);
  }
  st = addLog(st, '頂尖捕捉器：選擇要呼叫的對手備戰寶可夢', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'top-catcher-opp',
  });
});
regR('top-catcher-opp', (st, idx, iids, _params, _pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  // 切換對手備戰 → 對手出場
  st = updatePlayer(st, oppIdx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    const newBench = [...p.bench];
    newBench[bIdx] = p.active;
    return { ...p, active: { ...p.bench[bIdx], justPlaced: false }, bench: newBench };
  });
  // 若自己也有備戰，選擇自己要換入的寶可夢
  if (st.players[idx].bench.length === 0) return st;
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'do-switch',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 其他
// ══════════════════════════════════════════════════════════════════════════════

// 不公印章 — （省略「上回合寶可夢被擊倒」條件）雙方洗手牌，自己抽 5，對手抽 2
reg('不公印章', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '不公印章：雙方洗手牌重抽（自己 5 張，對手 2 張）', idx);
  st = returnHandToDeck(st, idx);
  st = returnHandToDeck(st, oppIdx);
  st = drawCards(st, idx, 5);
  st = drawCards(st, oppIdx, 2);
  return st;
});

// ══════════════════════════════════════════════════════════════════════════════
// 招式效果
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ATTACK_PRE：招式宣告後、傷害計算前的效果。
 * 接收現在 state 與攻擊方索引，回傳 { state, damage }（damage 為本次招式實際傷害）。
 *
 * ATTACK_POST：傷害施加（含擊倒判定）後的效果。
 * 可觸發 pendingSelection 讓玩家做額外選擇；回傳新 state。
 *
 * 注意：ATTACK 之後 turnPhase 已設為 'end'，
 * POST 設定的 pendingSelection 解析完後 turnPhase 保持 'end'，
 * 玩家確認取獎勵牌後再按 END_TURN 結束回合。
 */

type AttackPreFn = (
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>
) => { state: GameState; damage: number };

type AttackPostFn = (
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>
) => GameState;

export const ATTACK_PRE  = new Map<string, AttackPreFn>();
export const ATTACK_POST = new Map<string, AttackPostFn>();

function regPre(key: string, fn: AttackPreFn)   { ATTACK_PRE.set(key, fn); }
function regPost(key: string, fn: AttackPostFn) { ATTACK_POST.set(key, fn); }

// ── MBD 超級蒂安希ex ──────────────────────────────────────────────────────────

// 花冠射線 — 丟棄最多 2 個能量（自動取最大），造成張數×120 傷害
regPre('超級蒂安希ex|花冠射線', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (!player.active) return { state, damage: 0 };
  const energies = player.active.energyAttached;
  const discardCount = Math.min(2, energies.length);
  const discarded  = energies.slice(-discardCount);
  const remaining  = energies.slice(0, energies.length - discardCount);
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: remaining } : null,
    discard: [...p.discard, ...discarded],
  }));
  const dmg = discardCount * 120;
  s = addLog(s, `花冠射線：丟棄 ${discardCount} 個能量，造成 ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ── MBD 霜奶仙 ────────────────────────────────────────────────────────────────

// 甜點圓陣 — 自己場上寶可夢數量×20
regPre('霜奶仙|甜點圓陣', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const count = (p.active ? 1 : 0) + p.bench.length;
  return { state, damage: count * 20 };
});

// ── MBD 布魯皇 ────────────────────────────────────────────────────────────────

// 致命刺擊 — 若對手戰鬥寶可夢有傷害指示物，+90 傷害
regPre('布魯皇|致命刺擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defenderDamaged = (state.players[dIdx].active?.damage ?? 0) > 0;
  return { state, damage: 90 + (defenderDamaged ? 90 : 0) };
});

// ── MBG 黑暗鴉 ────────────────────────────────────────────────────────────────

// 伏擊 — 擲硬幣，正面 +20
regPre('黑暗鴉|伏擊', (state, aIdx, _pool) => {
  const heads = Math.random() < 0.5;
  const s = addLog(state, `伏擊：硬幣 ${heads ? '正面！+20 傷害' : '反面'}`, aIdx);
  return { state: s, damage: 10 + (heads ? 20 : 0) };
});

// ── MBG 烏鴉頭頭 ──────────────────────────────────────────────────────────────

// 狙擊羽毛 — 丟棄 2 個能量，對對手任意1隻寶可夢造成 120 傷害（含出場）
// PRE：丟棄 2 個能量，回傳 damage=0（傷害由 POST 處理，不對出場造成傷害）
regPre('烏鴉頭頭|狙擊羽毛', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (!player.active) return { state, damage: 0 };
  const energies = player.active.energyAttached;
  if (energies.length < 2) return { state, damage: 0 };
  const discarded = energies.slice(-2);
  const remaining = energies.slice(0, energies.length - 2);
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: remaining } : null,
    discard: [...p.discard, ...discarded],
  }));
  s = addLog(s, '狙擊羽毛：丟棄 2 個能量', aIdx);
  return { state: s, damage: 0 };
});

// POST：選擇對手任意寶可夢，造成 120 傷害
regPost('烏鴉頭頭|狙擊羽毛', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0 && !defender.active) return state;
  if (defender.bench.length === 0 && defender.active) {
    // 無備戰，直接對出場施加 120 傷害
    const defCard = _pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + 120;
    const defHP = defCard?.hp ?? 0;
    if (defHP > 0 && newDmg >= defHP) {
      const koDiscard: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...(defender.active.toolAttached ? [defender.active.toolAttached] : []),
      ];
      const players = [...state.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...koDiscard] };
      const prizes = defCard!.name.endsWith('ex') || defCard!.name.endsWith('EX') ? 2 : 1;
      let s = addLog({ ...state, players }, `狙擊羽毛：120 傷害擊倒 ${defCard?.name ?? '?'}！${state.players[aIdx].name} 取得 ${prizes} 張獎勵牌。`, null);
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
      }
      return { ...s, pendingPrizes: prizes };
    } else {
      const players = [...state.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...defender, active: { ...defender.active!, damage: newDmg } };
      return addLog({ ...state, players }, `狙擊羽毛：對 ${defCard?.name ?? '?'} 造成 120 傷害！`, aIdx);
    }
  }
  // 有備戰，讓玩家選擇目標（含出場）
  let s = addLog(state, '狙擊羽毛：選擇對手任意寶可夢造成 120 傷害', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-120',
    params: { includeActive: true },
  });
});

regR('snipe-120', (st, actorIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid) return st;

  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;

  const targetCard = pool.get(target.cardId);
  const newDmg = target.damage + 120;
  const targetHP = targetCard?.hp ?? 0;

  if (targetHP > 0 && newDmg >= targetHP) {
    // 擊倒目標
    const koDiscard: CardInstance[] = [
      { ...target, damage: newDmg },
      ...target.energyAttached,
      ...(target.toolAttached ? [target.toolAttached] : []),
    ];
    const prizes = targetCard!.name.endsWith('ex') || targetCard!.name.endsWith('EX') ? 2 : 1;
    const players = [...st.players] as [PlayerState, PlayerState];
    const newDefender = { ...defender, discard: [...defender.discard, ...koDiscard] };
    if (isActive) {
      newDefender.active = null;
    } else {
      newDefender.bench = defender.bench.filter(c => c.iid !== targetIid);
    }
    players[dIdx] = newDefender;
    let s = addLog({ ...st, players }, `狙擊羽毛：${targetCard?.name ?? '?'} 被擊倒！${st.players[actorIdx].name} 取得 ${prizes} 張獎勵牌。`, null);
    if (isActive && newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return { ...s, pendingPrizes: prizes };
  } else {
    // 未擊倒
    const players = [...st.players] as [PlayerState, PlayerState];
    const newDefender = { ...defender };
    if (isActive) {
      newDefender.active = { ...target, damage: newDmg };
    } else {
      newDefender.bench = defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c);
    }
    players[dIdx] = newDefender;
    return addLog({ ...st, players }, `狙擊羽毛：對 ${targetCard?.name ?? '?'} 造成 120 傷害！`, actorIdx);
  }
});

// ── MBG 勾魂眼 ────────────────────────────────────────────────────────────────

// 動怒爪 — 自己備戰區有惡屬性2階進化寶可夢，+70
regPre('勾魂眼|動怒爪', (state, aIdx, pool) => {
  const hasStage2Dark = state.players[aIdx].bench.some(c => {
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Darkness' && card?.subtype === 'Stage2';
  });
  return { state, damage: 20 + (hasStage2Dark ? 70 : 0) };
});

// ── MBG 桃歹郎ex ──────────────────────────────────────────────────────────────

// 煩煩爆炸 — 對手已取的獎賞牌數×60
regPre('桃歹郎ex|煩煩爆炸', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const taken = 6 - state.players[dIdx].prizes.length;
  return { state, damage: taken * 60 };
});

// ── MBG 阿勃梭魯 ──────────────────────────────────────────────────────────────

// 吸引 — 抽 2 張（POST，無傷害）
regPost('阿勃梭魯|吸引', (state, aIdx, _pool) => {
  let s = addLog(state, '吸引：從牌庫抽 2 張', aIdx);
  return updatePlayer(s, aIdx, p => {
    const n = Math.min(2, p.deck.length);
    return { ...p, hand: [...p.hand, ...p.deck.slice(0, n)], deck: p.deck.slice(n) };
  });
});

// ── MBD 小仙奶 ────────────────────────────────────────────────────────────────

// 吸取之吻 — 自身回復 10 HP
regPost('小仙奶|吸取之吻', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: Math.max(0, p.active.damage - 10) } };
  });
});

// ── MBG 超級耿鬼ex ────────────────────────────────────────────────────────────

// 空無強風 — 選 1 個自身能量，改附於備戰寶可夢（自動取最後 1 個能量，讓玩家選備戰目標）
regPost('超級耿鬼ex|空無強風', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (!player.active || player.active.energyAttached.length === 0) return state;
  if (player.bench.length === 0) {
    return addLog(state, '空無強風：備戰區沒有寶可夢，能量留在原位', aIdx);
  }
  const energies = player.active.energyAttached;
  const energyToMove = energies[energies.length - 1];
  // 從出場移除能量
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.slice(0, -1) } : null,
  }));
  s = addLog(s, '空無強風：選擇將能量附於哪隻備戰寶可夢', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'gengar-move-energy',
    params: { energyIid: energyToMove.iid, energyCardId: energyToMove.cardId },
  });
});

regR('gengar-move-energy', (st, idx, iids, params, _pool) => {
  const energyIid    = params?.energyIid    as string | undefined;
  const energyCardId = params?.energyCardId as string | undefined;
  if (!energyIid || !energyCardId || iids.length === 0) return st;
  const targetIid = iids[0];
  // 重建能量 CardInstance（基本能量無狀態，iid 與 cardId 即可還原）
  const energyCard: CardInstance = { iid: energyIid, cardId: energyCardId, damage: 0, energyAttached: [] };
  return updatePlayer(st, idx, p => ({
    ...p,
    bench: p.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energyCard] }
      : c),
  }));
});

// ── MBD 克雷色利亞 ────────────────────────────────────────────────────────────

// 充溢之光 — 從牌庫選最多 2 張基本能量，附於自身（POST；無傷害）
regPost('克雷色利亞|充溢之光', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const hasEnergy = player.deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  if (!hasEnergy) return addLog(state, '充溢之光：牌庫中沒有基本能量', aIdx);
  let s = addLog(state, '充溢之光：從牌庫選最多 2 張基本能量附於自身', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Energy',
    minCount: 0, maxCount: 2,
    effectKey: 'cresselia-attach-energy',
  });
});

regR('cresselia-attach-energy', (st, idx, iids, _params, _pool) => {
  if (iids.length === 0) return st;
  return updatePlayer(st, idx, p => {
    if (!p.active) return p;
    const chosen   = p.deck.filter(c => iids.includes(c.iid));
    const newDeck  = p.deck.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck:   shuffle(newDeck),
      active: { ...p.active, energyAttached: [...p.active.energyAttached, ...chosen] },
    };
  });
});

// ── MBD 美洛耶塔 ──────────────────────────────────────────────────────────────

// 治癒旋律 — 選備戰超寶可夢，回復 120 HP（POST；無傷害）
regPost('美洛耶塔|治癒旋律', (state, aIdx, pool) => {
  const bench = state.players[aIdx].bench;
  const psychicBench = bench.filter(c => (pool.get(c.cardId)?.pokemonType) === 'Psychic');
  if (psychicBench.length === 0) {
    return addLog(state, '治癒旋律：備戰區沒有超屬性寶可夢', aIdx);
  }
  let s = addLog(state, '治癒旋律：選擇回復 120 HP 的備戰超寶可夢', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'heal-120-bench',
    params: { validIids: psychicBench.map(c => c.iid) },
  });
});

regR('heal-120-bench', (st, idx, iids, _params, _pool) => {
  const targetIid = iids[0];
  return updatePlayer(st, idx, p => ({
    ...p,
    bench: p.bench.map(c => c.iid === targetIid
      ? { ...c, damage: Math.max(0, c.damage - 120) }
      : c),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 道具卡（Tool Card）附加
// ══════════════════════════════════════════════════════════════════════════════

function toolAttachEffect(toolName: string): EffectFn {
  return (st, idx, _pool, toolInst) => {
    const p = st.players[idx];
    const allInPlay = [...(p.active ? [p.active] : []), ...p.bench];
    const validIids = allInPlay.filter(pk => !pk.toolAttached).map(pk => pk.iid);
    if (validIids.length === 0) return addLog(st, `${toolName}：沒有可附加道具的寶可夢`, idx);
    st = addLog(st, `${toolName}：選擇要附加的寶可夢`, idx);
    return withPending(st, {
      type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1, filter: '',
      effectKey: 'attach-tool',
      params: { toolInst, validIids },
    });
  };
}
reg('氣球', toolAttachEffect('氣球'));
reg('龐克頭盔', toolAttachEffect('龐克頭盔'));

regR('attach-tool', (st, idx, picked, params, _pool) => {
  const targetIid = picked[0];
  const toolInst = params?.toolInst as CardInstance;
  if (!toolInst) return st;
  return updatePlayer(st, idx, p => {
    const attach = (pk: CardInstance): CardInstance =>
      pk.iid === targetIid ? { ...pk, toolAttached: toolInst } : pk;
    return {
      ...p,
      active: p.active ? attach(p.active) : null,
      bench: p.bench.map(attach),
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 神奇糖果（Rare Candy）
// ══════════════════════════════════════════════════════════════════════════════

reg('神奇糖果', (st, idx, pool) => {
  const p = st.players[idx];
  const validIids = p.hand.filter(inst => {
    const c = pool.get(inst.cardId);
    return c?.supertype === 'Pokemon' && c.evolvesFrom && c.subtype !== 'Basic';
  }).map(i => i.iid);
  if (validIids.length === 0) return addLog(st, '神奇糖果：手牌中沒有可進化的寶可夢', idx);
  st = addLog(st, '神奇糖果：從手牌選擇要進化的高階寶可夢', idx);
  return withPending(st, {
    type: 'hand-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, filter: '',
    effectKey: 'rare-candy-choose-target',
    params: { validIids },
  });
});

regR('rare-candy-choose-target', (st, idx, picked, _params, pool) => {
  const stage2Iid = picked[0];
  const p = st.players[idx];
  const stage2Inst = p.hand.find(i => i.iid === stage2Iid);
  if (!stage2Inst) return st;
  const stage2Card = pool.get(stage2Inst.cardId);
  if (!stage2Card?.evolvesFrom) return st;

  // Chain: basic → stage1 (evolvesFrom=basic) → stage2 (evolvesFrom=stage1)
  const stage1Name = stage2Card.evolvesFrom;
  let basicName: string | undefined;
  for (const [, c] of pool) {
    if (c.name === stage1Name && c.evolvesFrom) { basicName = c.evolvesFrom; break; }
  }
  // Fallback: stage2 directly evolvesFrom a basic
  if (!basicName) basicName = stage1Name;

  const fieldPokes = [...(p.active ? [p.active] : []), ...p.bench];
  const validIids = fieldPokes
    .filter(pk => {
      if (pk.justPlaced || pk.evolvedThisTurn) return false;
      const c = pool.get(pk.cardId);
      return c?.name === basicName || c?.name === stage1Name;
    })
    .map(pk => pk.iid);

  if (validIids.length === 0) return addLog(st, '神奇糖果：場上沒有可接受神奇糖果的寶可夢', idx);

  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, filter: '',
    effectKey: 'rare-candy-evolve',
    params: { stage2Iid, validIids },
  });
});

regR('rare-candy-evolve', (st, idx, picked, params, pool) => {
  const targetIid = picked[0];
  const stage2Iid = params?.stage2Iid as string;

  return updatePlayer(st, idx, p => {
    const stage2Inst = p.hand.find(i => i.iid === stage2Iid);
    if (!stage2Inst) return p;
    const stage2Card = pool.get(stage2Inst.cardId);

    const evolve = (pk: CardInstance): CardInstance => {
      if (pk.iid !== targetIid) return pk;
      return {
        ...stage2Inst,
        damage: pk.damage,
        energyAttached: pk.energyAttached,
        toolAttached: pk.toolAttached,
        status: pk.status,
        evolvedFromIid: pk.iid,
        // 神奇糖果跳過 Stage 1，進化鏈只記錄 Basic cardId
        evolvedFromCardIds: [...(pk.evolvedFromCardIds ?? []), pk.cardId],
        evolvedThisTurn: true,
        justPlaced: false,
      };
    };

    const baseCard = pool.get(p.active?.iid === targetIid ? p.active.cardId : (p.bench.find(b => b.iid === targetIid)?.cardId ?? ''));
    const logMsg = `神奇糖果：${baseCard?.name ?? '?'} 直接進化為 ${stage2Card?.name ?? '?'}！`;
    return {
      ...p,
      hand: p.hand.filter(i => i.iid !== stage2Iid),
      active: p.active ? evolve(p.active) : null,
      bench: p.bench.map(evolve),
    };
  });
  // Note: log added outside, but updatePlayer doesn't return state separately
});

// ══════════════════════════════════════════════════════════════════════════════
// 神秘花園（Stadium）
// ══════════════════════════════════════════════════════════════════════════════

// 競技場放置時無即時效果（engine 處理放置邏輯）
// USE_STADIUM 由 engine 中 USE_STADIUM handler 觸發
regR('miracle-garden-draw', (st, idx, picked, _params, pool) => {
  const energyIid = picked[0];
  return updatePlayer(st, idx, p => {
    const eIdx = p.hand.findIndex(i => i.iid === energyIid);
    if (eIdx < 0) return p;
    const energyInst = p.hand[eIdx];
    const newHand = p.hand.filter((_, i) => i !== eIdx);
    const newDiscard = [...p.discard, energyInst];

    // Count Psychic Pokémon in play
    const allField = [...(p.active ? [p.active] : []), ...p.bench];
    const psychicCount = allField.filter(pk => {
      const c = pool.get(pk.cardId);
      return c?.pokemonType === 'Psychic';
    }).length;

    // Draw until hand.length === psychicCount
    const toDraw = Math.max(0, psychicCount - newHand.length);
    const drawn = p.deck.slice(0, Math.min(toDraw, p.deck.length));

    return {
      ...p,
      hand: [...newHand, ...drawn],
      deck: p.deck.slice(drawn.length),
      discard: newDiscard,
    };
  });
});

// ── MBG 無極汰那 ─────────────────────────────────────────────────────────────

// 敲壞 — 丟棄場上競技場
regPost('無極汰那|敲壞', (state, aIdx, _pool) => {
  if (!state.activeStadium) return addLog(state, '敲壞：場上沒有競技場', aIdx);
  const stadiumName = _pool.get(state.activeStadium.cardId)?.name ?? '競技場';
  const aPlayers = [...state.players] as [PlayerState, PlayerState];
  aPlayers[aIdx] = { ...aPlayers[aIdx], discard: [...aPlayers[aIdx].discard, state.activeStadium] };
  return addLog({ ...state, players: aPlayers, activeStadium: undefined, stadiumUsedThisTurn: undefined }, `敲壞：${stadiumName} 被丟棄！`, aIdx);
});

// 力量猛攻 — 擲硬幣，反面則下回合無法使用招式
regPost('無極汰那|力量猛攻', (state, aIdx, _pool) => {
  const coin = Math.random() < 0.5;
  if (!coin) {
    // tails → can't attack next turn
    const players = [...state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    if (p.active) p.active = { ...p.active, cantAttackThisTurn: true };
    players[aIdx] = p;
    return addLog({ ...state, players }, '力量猛攻：反面！下回合無法使用招式。', aIdx);
  }
  return addLog(state, '力量猛攻：正面！', aIdx);
});

// ── MBD 拉帝亞斯ex ──────────────────────────────────────────────────────────

// 無限之刃 — 使用後下回合無法攻擊
regPost('拉帝亞斯ex|無限之刃', (state, aIdx, _pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (p.active) p.active = { ...p.active, cantAttackThisTurn: true };
  players[aIdx] = p;
  return addLog({ ...state, players }, '無限之刃：下回合無法使用招式。', aIdx);
});

// ── MBD 謎擬Q ─────────────────────────────────────────────────────────────────

// 呼朋引伴 — 從牌庫選 1 隻基礎寶可夢放備戰（POST；無傷害）
regPost('謎擬Q|呼朋引伴', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.bench.length >= 5) return addLog(state, '呼朋引伴：備戰區已滿', aIdx);
  const hasBasic = player.deck.some(c => {
    // 過濾在 selection UI 中完成，這裡直接開啟選擇
    return true;
  });
  if (!hasBasic) return addLog(state, '呼朋引伴：牌庫中沒有寶可夢', aIdx);
  let s = addLog(state, '呼朋引伴：從牌庫選 1 隻基礎寶可夢放備戰', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'bench-basic-from-deck', // 複用好友寶芬的 resolver
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 主動特性（USE_ABILITY 觸發）
// ══════════════════════════════════════════════════════════════════════════════

/** pokémonName|abilityIndex → 效果函式 */
export const ABILITY_EFFECTS = new Map<string, EffectFn>();

function regA(pokemonName: string, abilityIndex: number, fn: EffectFn) {
  ABILITY_EFFECTS.set(`${pokemonName}|${abilityIndex}`, fn);
}

// ── 米立龍「集客」──────────────────────────────────────────────────────────────
// 若在戰鬥場上，每回合 1 次：查看牌庫頂 6 張，取 1 張支援者加手牌，其餘洗回。
regA('米立龍', 0, (st, idx) => {
  const p = st.players[idx];
  const top6 = p.deck.slice(0, 6);
  if (top6.length === 0) return addLog(st, '集客：牌庫為空', idx);
  st = addLog(st, '集客：查看牌庫頂 6 張，選 1 張支援者加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter:TOP6',
    minCount: 0, maxCount: 1,
    effectKey: 'fetch-supporter',
    params: { top6Iids: top6.map(c => c.iid) },
  });
});

regR('fetch-supporter', (st, idx, iids, params, _pool) => {
  const top6Iids = (params?.top6Iids as string[]) ?? [];
  return updatePlayer(st, idx, (p) => {
    const top6 = p.deck.filter(c => top6Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top6Iids.includes(c.iid));
    const chosen = top6.filter(c => iids.includes(c.iid));
    const remaining = top6.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck: shuffle([...rest, ...remaining]),
      hand: [...p.hand, ...chosen],
    };
  });
});

// ── 桃歹郎ex「支配鎖鏈」──────────────────────────────────────────────────────
// 每回合 1 次：選備戰的惡屬性寶可夢（桃歹郎ex除外）換到出場，新出場中毒。
regA('桃歹郎ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  const validBench = p.bench.filter(c => {
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Darkness' && card?.name !== '桃歹郎ex';
  });
  if (validBench.length === 0) {
    return addLog(st, '支配鎖鏈：備戰區沒有可切換的惡寶可夢', idx);
  }
  st = addLog(st, '支配鎖鏈：選 1 隻備戰惡屬性寶可夢換出場，並中毒', idx);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'dominance-chain',
    params: { validIids: validBench.map(c => c.iid) },
  });
});

regR('dominance-chain', (st, idx, iids, params, _pool) => {
  const validIids = (params?.validIids as string[]) ?? [];
  const targetIid = iids[0];
  if (!validIids.includes(targetIid)) return st;
  return updatePlayer(st, idx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === targetIid);
    if (bIdx < 0) return p;
    const newActive = { ...p.bench[bIdx], status: 'poisoned' as const, justPlaced: false };
    const newBench = [...p.bench];
    newBench[bIdx] = { ...p.active };
    return { ...p, active: newActive, bench: newBench };
  });
});
