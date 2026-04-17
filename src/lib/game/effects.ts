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
  pool: Map<string, Card>
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

function reg(name: string, fn: EffectFn) {
  TRAINER_EFFECTS.set(name, fn);
}

function regR(key: string, fn: ResolveFn) {
  RESOLVERS.set(key, fn);
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
