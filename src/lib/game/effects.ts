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

regR('search-pokemon-to-hand', (st, idx, iids, _params, pool) => {
  // Log 顯示搜到哪張卡（公開資訊：官方規則搜牌庫結果需公開給對手看）
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `搜到：${names} 加入手牌`, idx);
  } else {
    st = addLog(st, '牌庫搜尋：未選擇任何卡', idx);
  }
  return updatePlayer(st, idx, (p) => {
    const chosenInPlayer = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle(remaining), hand: [...p.hand, ...chosenInPlayer] };
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
regR('ultra-ball-discard', (st, idx, iids, _params, pool) => {
  // 記錄丟棄的卡名（公開資訊 — 丟棄到棄牌區本來就公開）
  const toDiscardNow = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (toDiscardNow.length > 0) {
    const names = toDiscardNow.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `高級球：丟棄 ${names}`, idx);
  }
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

// 超級信號 — 從牌庫搜尋 1 張「超級進化寶可夢 ex」加手牌
// ⚠️ 必須只過濾「超級進化 ex」（名字開頭「超級」），普通 ex（桃歹郎ex / 拉帝亞斯ex）不可被搜到
reg('超級信號', (st, idx) => {
  st = addLog(st, '超級信號：從牌庫選 1 張超級進化寶可夢 ex 加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'MegaEx',
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

// 不公印章 — 必須「上回合寶可夢被擊倒」才可使用（簡化：自己獎賞 < 6 即代表曾被擊倒）
// 規則原文：「這張卡必須在上個對手的回合自己的寶可夢【昏厥】了才可使用」
// 嚴格版需追蹤每回合 KO 事件，簡化為「剩餘獎賞 < 6」（對手曾取過獎賞 = 自己寶可夢被擊倒過）
regG('不公印章', (st, idx) => st.players[idx].prizes.length < 6);
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
        ...(defender.active.evolvedFromStack ?? []),
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
      ...(target.evolvedFromStack ?? []),
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
    if (card?.pokemonType !== 'Darkness') return false;
    // Stage 2 判斷：evolvesFrom 存在且該 Stage1 也有 evolvesFrom（含 ex 類型的 Stage2）
    if (!card.evolvesFrom) return false;
    for (const p of pool.values()) {
      if (p.name === card.evolvesFrom && p.supertype === 'Pokemon' && p.evolvesFrom) return true;
    }
    return false;
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
  // Defensive check：target 已有道具則拒絕附加（一隻寶可夢只能附加一個道具）
  const p = st.players[idx];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  const target = all.find(c => c.iid === targetIid);
  if (target?.toolAttached) {
    // 把本道具放回手牌（避免使用者損失道具）
    return updatePlayer(
      addLog(st, '附加失敗：目標寶可夢已有道具，道具回到手牌', idx),
      idx,
      pl => ({ ...pl, hand: [...pl.hand, toolInst] })
    );
  }
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

// 神奇糖果 Guard：手牌中有「Stage2」且場上有其對應 Basic 目標才可打出
regG('神奇糖果', (st, idx, pool) => {
  const p = st.players[idx];
  const isStage2 = (c?: Card) => {
    if (!c || c.supertype !== 'Pokemon' || !c.evolvesFrom) return false;
    for (const x of pool.values()) {
      if (x.name === c.evolvesFrom && x.supertype === 'Pokemon' && x.evolvesFrom) return true;
    }
    return false;
  };
  const stage2sInHand = p.hand.filter(i => isStage2(pool.get(i.cardId)));
  if (stage2sInHand.length === 0) return false;
  const fieldPokes = [...(p.active ? [p.active] : []), ...p.bench];
  // 至少一張 Stage2 有合法 Basic 目標（Stage2→Stage1→Basic 鏈結完整，場上有該 Basic 且可進化）
  return stage2sInHand.some(hand => {
    const s2 = pool.get(hand.cardId)!;
    let basicName: string | undefined;
    for (const c of pool.values()) {
      if (c.name === s2.evolvesFrom && c.supertype === 'Pokemon' && c.evolvesFrom) {
        basicName = c.evolvesFrom;
        break;
      }
    }
    if (!basicName) return false;
    return fieldPokes.some(pk => {
      const bc = pool.get(pk.cardId);
      return bc?.name === basicName && !pk.justPlaced && !pk.evolvedThisTurn;
    });
  });
});

reg('神奇糖果', (st, idx, pool) => {
  const p = st.players[idx];
  // 只列出手牌中的「Stage2」寶可夢（含 Stage2 ex）
  const isStage2 = (c?: Card) => {
    if (!c || c.supertype !== 'Pokemon' || !c.evolvesFrom) return false;
    for (const x of pool.values()) {
      if (x.name === c.evolvesFrom && x.supertype === 'Pokemon' && x.evolvesFrom) return true;
    }
    return false;
  };
  const validIids = p.hand.filter(inst => isStage2(pool.get(inst.cardId))).map(i => i.iid);
  if (validIids.length === 0) return addLog(st, '神奇糖果：手牌中沒有可進化的寶可夢', idx);
  st = addLog(st, '神奇糖果：從手牌選擇要進化的 2 階寶可夢', idx);
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
      const baseBare: CardInstance = {
        ...pk,
        energyAttached: [],
        toolAttached: undefined,
        evolvedFromStack: undefined,
      };
      return {
        ...stage2Inst,
        damage: pk.damage,
        energyAttached: pk.energyAttached,
        toolAttached: pk.toolAttached,
        status: pk.status,
        evolvedFromIid: pk.iid,
        // 神奇糖果跳過 Stage 1，進化鏈只含 Basic
        evolvedFromStack: [...(pk.evolvedFromStack ?? []), baseBare],
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

// ══════════════════════════════════════════════════════════════════════════════
// MC 破空焰ex — 火牌組預組主力（Session 24）
// ══════════════════════════════════════════════════════════════════════════════

// 烈火爆進 — 260 傷害，使用後到離開戰鬥場前無法再用本招
// M2 簡化：用現有 cantAttackThisTurn 旗標代表「下回合無法攻擊」
// （原文是禁用特定招式；完整實作需 disabledAttacks 機制，此為可接受的保守簡化）
regPost('破空焰ex|烈火爆進', (state, aIdx, _pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (p.active) p.active = { ...p.active, cantAttackThisTurn: true };
  players[aIdx] = p;
  return addLog({ ...state, players }, '烈火爆進：下回合無法使用招式（簡化版）。', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 30 B1 — 通用訓練家補實裝（10 張）
// ══════════════════════════════════════════════════════════════════════════════

// 傷藥 — 回 30 HP（物品）
regG('傷藥', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('傷藥', (st, idx) => {
  st = addLog(st, '傷藥：選擇回復 30 HP 的寶可夢', idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'heal-30',
    params: { healAmount: 30, discardEnergy: 0 },
  });
});
regR('heal-30', healResolver);

// 西餐廚師 — 戰鬥寶可夢回 70 HP（支援者）
regG('西餐廚師', (st, idx) => !!st.players[idx].active && st.players[idx].active!.damage > 0);
reg('西餐廚師', (st, idx) => {
  return updatePlayer(addLog(st, '西餐廚師：戰鬥寶可夢回復 70 HP', idx), idx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: Math.max(0, p.active.damage - 70) } };
  });
});

// 真菰 — 全體寶可夢各回 40 HP（支援者）
regG('真菰', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('真菰', (st, idx) => {
  return updatePlayer(addLog(st, '真菰：全體寶可夢各回復 40 HP', idx), idx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: Math.max(0, p.active.damage - 40) } : null,
    bench: p.bench.map(c => ({ ...c, damage: Math.max(0, c.damage - 40) })),
  }));
});

// 白露的真心 — 選 HP≤30 的寶可夢回復全部 HP（支援者）
regG('白露的真心', (st, idx, pool) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    const hp = card?.hp ?? 0;
    return hp > 0 && (hp - c.damage) <= 30;
  });
});
reg('白露的真心', (st, idx, pool) => {
  const p = st.players[idx];
  const validIids: string[] = [];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  for (const c of all) {
    const card = pool.get(c.cardId);
    const hp = card?.hp ?? 0;
    if (hp > 0 && (hp - c.damage) <= 30) validIids.push(c.iid);
  }
  st = addLog(st, '白露的真心：選 1 隻 HP≤30 的寶可夢回復全部 HP', idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'heal-full',
    params: { healAmount: 9999, validIids },
  });
});
regR('heal-full', healResolver);

// 希特隆的機智 — 全體【雷】寶可夢回 60 HP（支援者）
regG('希特隆的機智', (st, idx, pool) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => pool.get(c.cardId)?.pokemonType === 'Lightning' && c.damage > 0);
});
reg('希特隆的機智', (st, idx, pool) => {
  const isLightning = (c: CardInstance) => pool.get(c.cardId)?.pokemonType === 'Lightning';
  return updatePlayer(addLog(st, '希特隆的機智：全體【雷】寶可夢各回復 60 HP', idx), idx, p => ({
    ...p,
    active: p.active && isLightning(p.active) ? { ...p.active, damage: Math.max(0, p.active.damage - 60) } : p.active,
    bench: p.bench.map(c => isLightning(c) ? { ...c, damage: Math.max(0, c.damage - 60) } : c),
  }));
});

// 蓋伊 — 從牌庫抽 3 張（支援者）
reg('蓋伊', (st, idx) => {
  return updatePlayer(addLog(st, '蓋伊：從牌庫抽 3 張', idx), idx, p => {
    const taken = p.deck.slice(0, 3);
    return { ...p, deck: p.deck.slice(3), hand: [...p.hand, ...taken] };
  });
});

// 裁判 — 雙方洗手牌 + 各抽 4（支援者）
reg('裁判', (st, idx) => {
  st = addLog(st, '裁判：雙方洗手牌各抽 4 張', idx);
  const players = [...st.players] as [PlayerState, PlayerState];
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const hand = newDeck.slice(0, 4);
    p.hand = hand;
    p.deck = newDeck.slice(4);
    players[i] = p;
  }
  return { ...st, players };
});

// 衝浪手 — 切換出場/備戰 + 抽牌至手牌滿 5 張（支援者）
regG('衝浪手', (st, idx) => !!st.players[idx].active && st.players[idx].bench.length > 0);
reg('衝浪手', (st, idx) => {
  st = addLog(st, '衝浪手：選要換入的備戰寶可夢，並抽牌至手牌 5 張', idx);
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'surfer-switch',
  });
});
regR('surfer-switch', (st, idx, iids, _params, _pool) => {
  return updatePlayer(st, idx, p => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    const newActive = { ...p.bench[bIdx], justPlaced: false };
    const newBench = [...p.bench];
    newBench[bIdx] = { ...p.active };
    const drawN = Math.max(0, 5 - p.hand.length);
    const taken = p.deck.slice(0, drawN);
    return {
      ...p, active: newActive, bench: newBench,
      hand: [...p.hand, ...taken], deck: p.deck.slice(drawN),
    };
  });
});

// 精靈球 — 擲硬幣，正面則從牌庫選 1 張寶可夢加手牌（物品）
reg('精靈球', (st, idx) => {
  const coin = Math.random() < 0.5;
  if (!coin) return addLog(st, '精靈球：反面，什麼都沒發生。', idx);
  st = addLog(st, '精靈球：正面！從牌庫選 1 張寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 寶可夢捕捉器 — 擲硬幣，正面則選對手備戰與戰鬥寶可夢互換（物品）
regG('寶可夢捕捉器', (st, idx) => st.players[(1 - idx) as 0 | 1].bench.length > 0);
reg('寶可夢捕捉器', (st, idx) => {
  const coin = Math.random() < 0.5;
  if (!coin) return addLog(st, '寶可夢捕捉器：反面，什麼都沒發生。', idx);
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '寶可夢捕捉器：正面！選對手備戰與戰鬥寶可夢互換', idx);
  return withPending(st, {
    type: 'opp-bench-choose', actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1, effectKey: 'gust-opp',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H1 — H 標批次實裝：狀態附加類攻擊（~25 張）
// ══════════════════════════════════════════════════════════════════════════════

/** 讓對手戰鬥寶可夢陷入指定狀態的 POST effect */
function statusPost(status: 'poisoned' | 'burned' | 'asleep' | 'confused' | 'paralyzed'): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, status };
    players[dIdx] = def;
    return { ...state, players };
  };
}

// 中毒類
regPost('鬼斯通|毒之氣息', statusPost('poisoned'));
regPost('百足蜈蚣|毒液', statusPost('poisoned'));
regPost('猛惡菇|噴毒', statusPost('poisoned'));
regPost('溶食獸|毒之氣息', statusPost('poisoned'));
regPost('吞食獸|毒液一擊', statusPost('poisoned'));
regPost('破破袋|毒液一擊', statusPost('poisoned'));
regPost('灰塵山|毒液一擊', statusPost('poisoned'));

// 叉字蝠|劇毒牙：強化中毒（2 指示物）— 目前狀態系統不支援變強度中毒，先施加中毒
regPost('叉字蝠|劇毒牙', statusPost('poisoned'));

// 混亂類
regPost('人造細胞卵|腦力震動', statusPost('confused'));
regPost('魔牆人偶|不祥波動', statusPost('confused'));
regPost('優雅貓|擺尾蠱惑', statusPost('confused'));
regPost('奇麒麟|不祥波動', statusPost('confused'));
regPost('願增猿|精神歪曲', statusPost('confused'));
regPost('胡地|奇異駭入', statusPost('confused'));
// 修建老匠|暴走：自己混亂（攻擊者自己中狀態）
regPost('修建老匠|暴走', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) att.active = { ...att.active, status: 'confused' };
  players[aIdx] = att;
  return { ...state, players };
});

// 睡眠類
regPost('雪吞蟲|細雪', statusPost('asleep'));
regPost('蚊香君|催眠術', statusPost('asleep'));
regPost('蚊香泳士|催眠術', statusPost('asleep'));
regPost('美納斯ex|昏睡飛濺', statusPost('asleep'));
regPost('海豹球|細雪', statusPost('asleep'));

// 燒傷類
regPost('焚焰蚣|灼熱', statusPost('burned'));
regPost('熾焰咆哮虎ex|火焰炸彈', statusPost('burned'));

// 混合狀態：九尾|奇異燈火（灼傷+混亂）— 目前狀態系統單一 slot，先給灼傷
regPost('九尾|奇異燈火', statusPost('burned'));

// 麻痺（條件式）
// 托戈德瑪爾|麻麻時機 — 自己剩 1 獎賞卡時才麻痺對手
regPost('托戈德瑪爾|麻麻時機', (state, aIdx) => {
  if (state.players[aIdx].prizes.length !== 1) return state;
  return statusPost('paralyzed')(state, aIdx, new Map());
});
// 闇黑酋雷姆ex|冰河期 — 對手為龍屬時麻痺
regPost('闇黑酋雷姆ex|冰河期', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defCard = state.players[dIdx].active ? pool.get(state.players[dIdx].active!.cardId) : null;
  if (defCard?.pokemonType !== 'Dragon') return state;
  return statusPost('paralyzed')(state, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H2 — 自傷類攻擊（反動）
// ══════════════════════════════════════════════════════════════════════════════

/** 攻擊後自傷 N */
function selfHitPost(amount: number): AttackPostFn {
  return (state, aIdx, _pool) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, damage: att.active.damage + amount };
    players[aIdx] = att;
    return { ...state, players };
  };
}
regPost('燒火蚣|高溫奇襲', selfHitPost(10));
regPost('海地鼠|水炸彈', selfHitPost(20));
regPost('重泥挽馬|十萬馬力', selfHitPost(40));
regPost('蟲滾泥|撞一下', selfHitPost(10));
regPost('龍頭地鼠|狂野衝撞', selfHitPost(50));
regPost('佛烈托斯|鋼鐵衝撞', selfHitPost(40));
regPost('鐵啞鈴|鐵之衝撞', selfHitPost(10));
regPost('光電傘蜥|瘋狂伏特', selfHitPost(20));
regPost('洗翠 卡蒂狗|猛撞', selfHitPost(10));
regPost('轟擂金剛猩|木槌', selfHitPost(50));
regPost('火紅不倒翁|火焰衝撞', selfHitPost(20));
regPost('達摩狒狒|猛火猛撞', selfHitPost(70));
regPost('可可多拉|捨身衝撞', selfHitPost(10));
regPost('可多拉|鋼鐵衝撞', selfHitPost(20));
regPost('卡璞・哞哞|木槌', selfHitPost(30));
regPost('童偶熊|猛撞', selfHitPost(10));
regPost('爆焰龜獸|猛火猛撞', selfHitPost(60));
regPost('卡拉卡拉|突擊', selfHitPost(10));
regPost('齒輪組|鐵之衝撞', selfHitPost(20));
regPost('闇黑酋雷姆ex|闇黑冰霜', selfHitPost(30));
regPost('拳拳蛸|撞一下', selfHitPost(10));
regPost('豐蜜龍|狂野衝撞', selfHitPost(20));
regPost('火神蛾|怒濤羽擊', selfHitPost(50));
regPost('帝牙海獅|百萬噸墜落', selfHitPost(50));
regPost('傘電蜥|突擊', selfHitPost(10));
regPost('獨劍鞘|突擊', selfHitPost(10));
regPost('伊布|突擊', selfHitPost(10));
// 鐵骨土人|蠻力：條件式增傷 + 自傷（簡化：選擇性效果，固定採用增傷+自傷）
regPost('鐵骨土人|蠻力', selfHitPost(30));

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H3 — 對手狀態時 +N 傷害（PRE）
// ══════════════════════════════════════════════════════════════════════════════

function defStatusBonus(base: number, condition: 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed', bonus: number): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const hasStatus = state.players[dIdx].active?.status === condition;
    return { state, damage: base + (hasStatus ? bonus : 0) };
  };
}
regPre('熔岩蟲|炙燒', defStatusBonus(10, 'burned', 40));
regPre('卡璞・蝶蝶|心靈粉碎', defStatusBonus(90, 'confused', 90));
regPre('晶光花|毒液衝擊', defStatusBonus(30, 'poisoned', 100));

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H4 — 簡單訓練家（抽牌、搜尋、回血等）
// ══════════════════════════════════════════════════════════════════════════════

// 手部修剪器 — 雙方手牌丟至 5 張（對手先丟）
reg('手部修剪器', (st, idx) => {
  st = addLog(st, '手部修剪器：雙方手牌丟至 5 張', idx);
  const players = [...st.players] as [PlayerState, PlayerState];
  for (const i of [((1 - idx) as 0 | 1), idx]) {
    const p = { ...players[i] };
    if (p.hand.length <= 5) { players[i] = p; continue; }
    const discardN = p.hand.length - 5;
    const discarded = p.hand.slice(-discardN);
    p.hand = p.hand.slice(0, 5);
    p.discard = [...p.discard, ...discarded];
    players[i] = p;
  }
  return { ...st, players };
});

// 高級香氛 — 從牌庫選最多 3 張 Stage1 寶可夢加手牌
reg('高級香氛', (st, idx) => {
  st = addLog(st, '高級香氛：從牌庫選最多 3 張 1 階進化寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stage1', minCount: 0, maxCount: 3,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 覺醒戰鼓 — 抽與場上「古代」寶可夢相同數量的卡
// 簡化：我們資料沒「古代」標記，改為抽與自己場上寶可夢總數相同張數
reg('覺醒戰鼓', (st, idx) => {
  const p = st.players[idx];
  const count = (p.active ? 1 : 0) + p.bench.length;
  st = addLog(st, `覺醒戰鼓：抽 ${count} 張（簡化為場上寶可夢數）`, idx);
  return updatePlayer(st, idx, pl => {
    const taken = pl.deck.slice(0, count);
    return { ...pl, deck: pl.deck.slice(count), hand: [...pl.hand, ...taken] };
  });
});

// 賽吉（支援者）— 從牌庫找進化卡直接進化場上寶可夢（簡化：略跳）
// 跳過 — 涉及複雜的進化鏈選擇

// 八朔（支援者）— 自己上回合被擊倒才可用，看牌庫頂 8 選 3
regG('八朔', (st, idx) => {
  // 我們沒追蹤「上回合是否被擊倒」，保守檢查棄牌有寶可夢
  return st.players[idx].discard.some(c => {
    // 簡化為棄牌區有任何卡即允許（實戰中大多滿足）
    return true;
  });
});
reg('八朔', (st, idx) => {
  const top8Iids = st.players[idx].deck.slice(0, 8).map(c => c.iid);
  st = addLog(st, '八朔：從牌庫頂 8 張選最多 3 張加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TOP8', minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
    params: { top8Iids },
  });
});

// 朵拉塞娜（支援者）— 手牌洗回，擲硬幣正面抽 8 反面抽 3
reg('朵拉塞娜', (st, idx) => {
  const coin = Math.random() < 0.5;
  const drawN = coin ? 8 : 3;
  st = addLog(st, `朵拉塞娜：${coin ? '正面' : '反面'}！手牌洗回，抽 ${drawN} 張`, idx);
  return updatePlayer(st, idx, p => {
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const hand = newDeck.slice(0, drawN);
    return { ...p, hand, deck: newDeck.slice(drawN) };
  });
});

// 海岱（支援者）— 手牌選 2 張放牌庫底 + 抽 4（需至少 2 張手牌）
regG('海岱', (st, idx) => st.players[idx].hand.length >= 3);
reg('海岱', (st, idx) => {
  st = addLog(st, '海岱：選 2 張手牌放牌庫底，再抽 4 張', idx);
  return withPending(st, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 2, maxCount: 2, effectKey: 'hydai-bottom-draw4',
  });
});
regR('hydai-bottom-draw4', (st, idx, iids, _params, _pool) => {
  return updatePlayer(st, idx, p => {
    const chosen = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    const newDeck = [...p.deck, ...chosen];
    const taken = newDeck.slice(0, 4);
    return { ...p, hand: [...newHand, ...taken], deck: newDeck.slice(4) };
  });
});

// search-to-hand-reshuffle：從 TOP N 選幾張加手牌（剩餘放回重洗）
regR('search-to-hand-reshuffle', (st, idx, iids, _params, _pool) => {
  return updatePlayer(st, idx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: shuffle(remaining) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H5 — 擲硬幣正面 +N 傷害（PRE）
// ══════════════════════════════════════════════════════════════════════════════

function coinPlusDmg(base: number, bonus: number): AttackPreFn {
  return (state, aIdx) => {
    const heads = Math.random() < 0.5;
    return { state: addLog(state, heads ? `正面！+${bonus}` : '反面', aIdx), damage: base + (heads ? bonus : 0) };
  };
}
regPre('瑪力露麗|嬉鬧', coinPlusDmg(30, 30));
regPre('大炭車|擊飛', coinPlusDmg(20, 40));
regPre('土狼犬|咬盡', coinPlusDmg(30, 20));
regPre('小火焰猴|吹火', coinPlusDmg(20, 20));
regPre('伊布|電光一閃', coinPlusDmg(20, 20));
regPre('啃果蟲|回轉攻擊', coinPlusDmg(10, 20));
regPre('不良蛙|蛙跳', coinPlusDmg(20, 20));
regPre('強顎雞母蟲|伏擊', coinPlusDmg(10, 30));
regPre('炎兔兒|電光一閃', coinPlusDmg(10, 10));
regPre('花療環環|嬉鬧', coinPlusDmg(20, 20));
regPre('潤水鴨|燕返', coinPlusDmg(10, 20));

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H6 — 擲硬幣正面附加狀態（POST）
// ══════════════════════════════════════════════════════════════════════════════

function coinStatusPost(status: 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed'): AttackPostFn {
  return (state, aIdx) => {
    const heads = Math.random() < 0.5;
    if (!heads) return addLog(state, '反面', aIdx);
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, status };
    players[dIdx] = def;
    return addLog({ ...state, players }, `正面！對手${
      status === 'poisoned' ? '中毒' : status === 'burned' ? '燒傷' :
      status === 'asleep' ? '睡眠' : status === 'confused' ? '混亂' : '麻痺'
    }`, aIdx);
  };
}
regPost('火斑喵|擊掌奇襲', coinStatusPost('paralyzed'));
regPost('捷拉奧拉|麻麻關節', coinStatusPost('paralyzed'));
regPost('大舌舔|泰山壓頂', coinStatusPost('paralyzed'));
regPost('呱頭蛙|麻麻水', coinStatusPost('paralyzed'));
regPost('閃電鳥|電磁波', coinStatusPost('paralyzed'));
regPost('電肚蛙|電擊', coinStatusPost('paralyzed'));
regPost('赫拉克羅斯|泰山壓頂', coinStatusPost('paralyzed'));
regPost('電海燕|電擊', coinStatusPost('paralyzed'));
regPost('頑皮熊貓|瞪眼', coinStatusPost('paralyzed'));
regPost('幾何雪花|冰凍光束', coinStatusPost('paralyzed'));
regPost('太陽伊布|念力', coinStatusPost('paralyzed'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H7 — 攻擊時抽牌（POST）
// ══════════════════════════════════════════════════════════════════════════════

function drawPost(n: number): AttackPostFn {
  return (state, aIdx) => updatePlayer(state, aIdx, p => {
    const taken = p.deck.slice(0, n);
    return { ...p, deck: p.deck.slice(n), hand: [...p.hand, ...taken] };
  });
}
regPost('凱路迪歐|快速抽出', drawPost(2));
regPost('古玉魚|吸引', drawPost(2));
regPost('傘電蜥|呼喚', drawPost(1));
regPost('鴨寶寶|雙重抽出', drawPost(2));
regPost('木木梟|叼', drawPost(1));
regPost('電擊獸|呼喚', drawPost(1));
regPost('齒輪兒|吸引', drawPost(1));

// 特殊：手牌洗回 + 抽 N
function discardHandDrawPost(n: number): AttackPostFn {
  return (state, aIdx) => updatePlayer(state, aIdx, p => {
    const newDiscard = [...p.discard, ...p.hand];
    const taken = p.deck.slice(0, n);
    return { ...p, hand: taken, deck: p.deck.slice(n), discard: newDiscard };
  });
}
regPost('猛雷鼓ex|濺射咆哮', discardHandDrawPost(6));

// 手牌洗回牌庫 + 抽 N
regPost('比克提尼|啪噠啪噠', (state, aIdx) => updatePlayer(state, aIdx, p => {
  const newDeck = shuffle([...p.deck, ...p.hand]);
  const taken = newDeck.slice(0, 6);
  return { ...p, hand: taken, deck: newDeck.slice(6) };
}));

// 雙方各抽 N
regPost('花療環環|花流浴', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    const taken = p.deck.slice(0, 3);
    p.hand = [...p.hand, ...taken];
    p.deck = p.deck.slice(3);
    players[i] = p;
  }
  return { ...state, players };
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H8 — 下回合這隻無法使用招式（已有 cantAttackThisTurn 機制）
// ══════════════════════════════════════════════════════════════════════════════

function selfCantAttackNextPost(): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, cantAttackThisTurn: true };
    players[aIdx] = att;
    return { ...state, players };
  };
}
regPost('大力鱷|駭浪', selfCantAttackNextPost());
regPost('瑪力露麗|力量衝撞', selfCantAttackNextPost());
regPost('飛天螳螂|猛擊在地', selfCantAttackNextPost());
regPost('斗笠菇|關節衝擊', selfCantAttackNextPost());
regPost('鐵斑葉ex|稜鏡刀鋒', selfCantAttackNextPost());

// 對手受招後下回合無法攻擊
function defCantAttackNextPost(): AttackPostFn {
  return (state, aIdx) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, cantAttackThisTurn: true };
    players[dIdx] = def;
    return { ...state, players };
  };
}
regPost('雪絨蛾|冰冷寒氣', defCantAttackNextPost());

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H9 — 下一次被攻擊傷害 -N（新機制 damageReduceNextHit）
// ══════════════════════════════════════════════════════════════════════════════

function selfDmgReducePost(n: number): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, damageReduceNextHit: n };
    players[aIdx] = att;
    return addLog({ ...state, players }, `下次受到招式傷害 -${n}`, aIdx);
  };
}
regPost('樹林龜|甲殼衝撞', selfDmgReducePost(20));
regPost('橡實果|硬化', selfDmgReducePost(30));
regPost('巨鉗螳螂ex|鋼翼', selfDmgReducePost(50));
regPost('煤炭龜|甲殼衝撞', selfDmgReducePost(30));
regPost('波士可多拉|防守利爪', selfDmgReducePost(50));
regPost('噗隆隆|硬化', selfDmgReducePost(30));
regPost('飄飄球|膨脹', selfDmgReducePost(10));

// 對手受招後下回合使用招式傷害 -N
function defNextAtkReducePost(n: number): AttackPostFn {
  return (state, aIdx) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, damageReduceNextHit: n };
    players[dIdx] = def;
    return addLog({ ...state, players }, `對手下次使用招式傷害 -${n}`, aIdx);
  };
}
regPost('黑魯加|大聲咆哮', defNextAtkReducePost(100));
regPost('嘎啦嘎啦|叫聲', defNextAtkReducePost(40));

// ══════════════════════════════════════════════════════════════════════════════
// Session 32 H11 — 被動特性：受傷減 N / 免疫
// ══════════════════════════════════════════════════════════════════════════════

/** 特性名 → 受招式傷害 -N（被動） */
export const PASSIVE_DAMAGE_REDUCE = new Map<string, number>([
  ['鑽石膜', 30],       // 超級蒂安希ex — 原本 hard-coded 在 engine
  ['堅硬甲殼', 20],     // 草苗龜
  ['密林之軀', 30],     // 巨蔓藤
  ['柔軟羊毛', 30],     // 毛毛角羊
  ['堅堅之軀', 30],     // 浩大鯨
]);

/** 特性名 → 判斷是否完全免疫此攻擊 */
export type ImmunityCheck = (
  attackerCard: Card,
  baseDamage: number,
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>
) => boolean;
export const PASSIVE_IMMUNITY = new Map<string, ImmunityCheck>([
  // 奇麒麟ex 尾甲 — 免疫 Basic ex 招式
  ['尾甲', (att) => att.subtype === 'ex' && !att.evolvesFrom],
  // 厄鬼椪 礎石面具ex 礎石之勢 — 免疫有特性的寶可夢招式
  ['礎石之勢', (att) => !!att.abilities && att.abilities.length > 0],
  // 暴噬龜 鐵壁硬殼 — 免疫 ≥200 傷害
  ['鐵壁硬殼', (_att, baseDamage) => baseDamage >= 200],
  // 堅盾劍怪 神秘之盾 — 免疫 ex/V 招式
  ['神秘之盾', (att) => att.subtype === 'ex' || att.name.endsWith('V') || att.name.endsWith('VMAX')],
]);

// ══════════════════════════════════════════════════════════════════════════════
// Session 32 H12 — 被動特性：受傷反擊（中毒/灼傷/放指示物）
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// Stadium resolvers（USE_STADIUM 觸發的 pending selection）
// ══════════════════════════════════════════════════════════════════════════════

// 夜間學院 — 選 1 張手牌放回牌庫上方
regR('night-academy-top', (st, idx, iids) => {
  return updatePlayer(st, idx, p => {
    const chosen = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    return { ...p, hand: newHand, deck: [...chosen, ...p.deck] };
  });
});

// 月光丘陵 — 丟 1 張超能量 → 全體回 30 HP
regR('moonlight-hill-heal', (st, idx, iids) => {
  return updatePlayer(st, idx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    const healActive = p.active ? { ...p.active, damage: Math.max(0, p.active.damage - 30) } : null;
    const healBench = p.bench.map(c => ({ ...c, damage: Math.max(0, c.damage - 30) }));
    return { ...p, hand: newHand, discard: [...p.discard, ...toDiscard], active: healActive, bench: healBench };
  });
});

/** 特性名 → 受到招式傷害後對攻擊者的反擊（在 engine 裡呼叫）*/
export type RetaliationFn = (
  state: GameState,
  dIdx: 0 | 1,  // 被攻擊者 index
  pool: Map<string, Card>
) => GameState;
export const PASSIVE_RETALIATION = new Map<string, RetaliationFn>([
  // 毒薔薇 / 羅絲雷朵 毒刺 — 攻擊者中毒
  ['毒刺', (state, dIdx) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active && !att.active.status) att.active = { ...att.active, status: 'poisoned' };
    players[aIdx] = att;
    return { ...state, players };
  }],
  // 席多藍恩 灼熱之軀 — 攻擊者灼傷
  ['灼熱之軀', (state, dIdx) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active && !att.active.status) att.active = { ...att.active, status: 'burned' };
    players[aIdx] = att;
    return { ...state, players };
  }],
  // 磨牙彩皮魚 反擊 — 攻擊者放 3 個傷害指示物（= 30 傷害）
  ['反擊', (state, dIdx) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, damage: att.active.damage + 30 };
    players[aIdx] = att;
    return { ...state, players };
  }],
]);

// ══════════════════════════════════════════════════════════════════════════════
// Session 31 H10 — 更多通用訓練家（Item + Supporter）
// ══════════════════════════════════════════════════════════════════════════════

// 寶可生機劑A — 回 150 HP（物品）
regG('寶可生機劑A', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('寶可生機劑A', (st, idx) => {
  st = addLog(st, '寶可生機劑A：選擇回復 150 HP 的寶可夢', idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'heal-150',
    params: { healAmount: 150, discardEnergy: 0 },
  });
});
regR('heal-150', healResolver);

// 危險光線 — 對手戰鬥寶可夢灼傷（簡化：原本是灼傷+混亂但狀態 slot 單一）
regG('危險光線', (st, idx) => !!st.players[(1-idx) as 0|1].active);
reg('危險光線', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  const players = [...st.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  if (def.active) def.active = { ...def.active, status: 'burned' };
  players[dIdx] = def;
  return addLog({ ...st, players }, '危險光線：對手戰鬥寶可夢灼傷', idx);
});

// 推理組合 — 看牌庫頂 3，簡化為洗回底
reg('推理組合', (st, idx) => {
  st = addLog(st, '推理組合：牌庫頂 3 張洗回底', idx);
  return updatePlayer(st, idx, p => {
    const top3 = p.deck.slice(0, 3);
    const rest = p.deck.slice(3);
    return { ...p, deck: [...shuffle(rest), ...top3] };
  });
});

// 奇跡耳麥 — 從棄牌取最多 2 張支援者加手牌
regG('奇跡耳麥', (st, idx, pool) =>
  st.players[idx].discard.some(c => pool.get(c.cardId)?.subtype === 'Supporter')
);
reg('奇跡耳麥', (st, idx) => {
  st = addLog(st, '奇跡耳麥：從棄牌選最多 2 張支援者加手牌', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter', minCount: 0, maxCount: 2,
    effectKey: 'discard-to-hand',
  });
});

// 反擊捕捉器 — 自己獎賞多時可用，呼叫對手備戰
regG('反擊捕捉器', (st, idx) =>
  st.players[idx].prizes.length > st.players[(1-idx) as 0|1].prizes.length &&
  st.players[(1-idx) as 0|1].bench.length > 0
);
reg('反擊捕捉器', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '反擊捕捉器：選對手備戰與戰鬥寶可夢互換', idx);
  return withPending(st, {
    type: 'opp-bench-choose', actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1, effectKey: 'gust-opp',
  });
});

// 釣竿MAX — 棄牌取最多 5 張寶可夢或基本能量
regG('釣竿MAX', (st, idx, pool) =>
  st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return (card?.supertype === 'Pokemon' && card?.subtype !== 'Other') || card?.supertype === 'Energy';
  })
);
reg('釣竿MAX', (st, idx) => {
  st = addLog(st, '釣竿MAX：從棄牌選最多 5 張寶可夢或能量加手牌', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonOrEnergy', minCount: 0, maxCount: 5,
    effectKey: 'discard-to-hand',
  });
});

// 超級能量回收 — 丟 2 手牌 + 棄牌取最多 4 張基本能量
regG('超級能量回收', (st, idx, pool) =>
  st.players[idx].hand.length >= 3 &&
  st.players[idx].discard.some(c => pool.get(c.cardId)?.supertype === 'Energy')
);
reg('超級能量回收', (st, idx) => {
  st = addLog(st, '超級能量回收：選 2 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 2, maxCount: 2, effectKey: 'super-energy-step2',
  });
});
regR('super-energy-step2', (st, idx, iids) => {
  st = updatePlayer(st, idx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    return { ...p, hand: p.hand.filter(c => !iids.includes(c.iid)), discard: [...p.discard, ...toDiscard] };
  });
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 0, maxCount: 4,
    effectKey: 'discard-to-hand',
  });
});

// 大地之容器 — 丟 1 手牌 + 搜最多 2 張基本能量
regG('大地之容器', (st, idx) => st.players[idx].hand.length >= 2);
reg('大地之容器', (st, idx) => {
  st = addLog(st, '大地之容器：選 1 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'earth-pot-step2',
  });
});
regR('earth-pot-step2', (st, idx, iids) => {
  st = updatePlayer(st, idx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    return { ...p, hand: p.hand.filter(c => !iids.includes(c.iid)), discard: [...p.discard, ...toDiscard] };
  });
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 0, maxCount: 2,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// MJ 超級球 — 看牌庫頂 7 選 1 寶可夢加手牌
reg('超級球', (st, idx) => {
  st = addLog(st, '超級球：從牌庫選 1 張寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 黑連（支援者）— 抽 3
reg('黑連', (st, idx) => updatePlayer(addLog(st, '黑連：抽 3 張', idx), idx, p => {
  const taken = p.deck.slice(0, 3);
  return { ...p, deck: p.deck.slice(3), hand: [...p.hand, ...taken] };
}));

// 野餐女孩 — 擲硬幣 正面抽 4 反面抽 2
reg('野餐女孩', (st, idx) => {
  const heads = Math.random() < 0.5;
  const n = heads ? 4 : 2;
  st = addLog(st, '野餐女孩：' + (heads ? '正面' : '反面') + ' 抽 ' + n + ' 張', idx);
  return updatePlayer(st, idx, p => {
    const taken = p.deck.slice(0, n);
    return { ...p, deck: p.deck.slice(n), hand: [...p.hand, ...taken] };
  });
});

// 仙后 — 手牌只有這 1 張才可用，搜 2 張任意卡
regG('仙后', (st, idx) => st.players[idx].hand.length === 1);
reg('仙后', (st, idx) => {
  st = addLog(st, '仙后：從牌庫選最多 2 張卡加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: '', minCount: 0, maxCount: 2,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// 庫瑟洛斯奇的企圖 — 對手手牌丟至 3 張
reg('庫瑟洛斯奇的企圖', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '庫瑟洛斯奇的企圖：對手手牌丟至 3 張', idx);
  return updatePlayer(st, oppIdx, p => {
    if (p.hand.length <= 3) return p;
    const discardN = p.hand.length - 3;
    const discarded = p.hand.slice(-discardN);
    return { ...p, hand: p.hand.slice(0, 3), discard: [...p.discard, ...discarded] };
  });
});

// 席藍 — 搜最多 3 張 ex 寶可夢加手牌
reg('席藍', (st, idx) => {
  st = addLog(st, '席藍：從牌庫選最多 3 張寶可夢 ex 加手牌', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'ex', minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// 寇沙 — 手牌洗回，抽比放回多 1 張
reg('寇沙', (st, idx) => {
  const drawN = st.players[idx].hand.length + 1;
  st = addLog(st, '寇沙：手牌洗回，抽 ' + drawN + ' 張', idx);
  return updatePlayer(st, idx, p => {
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const taken = newDeck.slice(0, drawN);
    return { ...p, hand: taken, deck: newDeck.slice(drawN) };
  });
});

// 秋明 — 對手中毒時，手牌洗回，抽 7
regG('秋明', (st, idx) => st.players[(1-idx) as 0|1].active?.status === 'poisoned');
reg('秋明', (st, idx) => {
  st = addLog(st, '秋明：手牌洗回，抽 7 張', idx);
  return updatePlayer(st, idx, p => {
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const taken = newDeck.slice(0, 7);
    return { ...p, hand: taken, deck: newDeck.slice(7) };
  });
});

// 蕾荷 — 牌庫頂 5 張丟棄（簡化：不支援選擇排序）
reg('蕾荷', (st, idx) => {
  st = addLog(st, '蕾荷：牌庫頂 5 張丟棄', idx);
  return updatePlayer(st, idx, p => {
    const top5 = p.deck.slice(0, 5);
    return { ...p, deck: p.deck.slice(5), discard: [...p.discard, ...top5] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 32 H13 — 主動特性
// ══════════════════════════════════════════════════════════════════════════════

// 水晶燈火靈 勸誘亮光 — 每回合 1 次，雙方各抽 1
regA('水晶燈火靈', 0, (st, idx) => {
  st = addLog(st, '水晶燈火靈 勸誘亮光：雙方各抽 1 張', idx);
  const players = [...st.players] as [PlayerState, PlayerState];
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    const taken = p.deck.slice(0, 1);
    p.hand = [...p.hand, ...taken];
    p.deck = p.deck.slice(1);
    players[i] = p;
  }
  return { ...st, players };
});

// 賽富豪ex 紅利硬幣 — 每回合 1 次，抽 1；若在戰鬥場再抽 1
regA('賽富豪ex', 0, (st, idx, pool) => {
  return updatePlayer(addLog(st, '賽富豪ex 紅利硬幣：抽牌', idx), idx, p => {
    // 若賽富豪ex 在戰鬥場抽 2，備戰只抽 1
    const isActive = !!p.active && pool.get(p.active.cardId)?.name === '賽富豪ex';
    const draw = isActive ? 2 : 1;
    const taken = p.deck.slice(0, draw);
    return { ...p, hand: [...p.hand, ...taken], deck: p.deck.slice(draw) };
  });
});

// 吉雉雞ex 扭轉乾坤 — 上回合寶可夢被擊倒才可用，抽 3
// 簡化：我們沒追蹤「上回合是否被擊倒」，改為「棄牌區有寶可夢」時允許
regA('吉雉雞ex', 0, (st, idx, pool) => {
  const hasDiscardedPoke = st.players[idx].discard.some(c =>
    pool.get(c.cardId)?.supertype === 'Pokemon'
  );
  if (!hasDiscardedPoke) return addLog(st, '扭轉乾坤：棄牌區沒有寶可夢', idx);
  return updatePlayer(addLog(st, '吉雉雞ex 扭轉乾坤：抽 3 張', idx), idx, p => {
    const taken = p.deck.slice(0, 3);
    return { ...p, hand: [...p.hand, ...taken], deck: p.deck.slice(3) };
  });
});

// 愛管侍 悉心治癒 — 放置到備戰時可用，戰鬥寶可夢回 30 + 解除 1 個特殊狀態
// 我們沒「放置觸發」機制；改為主動（正常回合可用）
regA('愛管侍', 0, (st, idx) => {
  return updatePlayer(addLog(st, '愛管侍 悉心治癒：戰鬥寶可夢回 30 HP + 解除異常狀態', idx), idx, p => {
    if (!p.active) return p;
    const newActive = {
      ...p.active,
      damage: Math.max(0, p.active.damage - 30),
      status: undefined,
    };
    return { ...p, active: newActive };
  });
});

// 普隆隆姆 轟鳴引擎 — 丟 1 能量 → 抽至手牌 6 張
// 簡化：固定丟 1 能量（若有）
regA('普隆隆姆', 0, (st, idx, pool) => {
  const energyInHand = st.players[idx].hand.filter(c =>
    pool.get(c.cardId)?.supertype === 'Energy'
  );
  if (energyInHand.length === 0) return addLog(st, '轟鳴引擎：手牌沒有能量', idx);
  const toDiscard = energyInHand[0];
  return updatePlayer(addLog(st, '普隆隆姆 轟鳴引擎：丟 1 能量 → 抽至 6 張', idx), idx, p => {
    const newHand = p.hand.filter(c => c.iid !== toDiscard.iid);
    const drawN = Math.max(0, 6 - newHand.length);
    const taken = p.deck.slice(0, drawN);
    return {
      ...p,
      hand: [...newHand, ...taken],
      deck: p.deck.slice(drawN),
      discard: [...p.discard, toDiscard],
    };
  });
});

// 鐵蟻ex 突然削退 — 放置時可用，丟對手牌庫頂 1 張
// 簡化：主動觸發
regA('鐵蟻ex', 0, (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '鐵蟻ex 突然削退：丟對手牌庫頂 1 張', idx);
  return updatePlayer(st, oppIdx, p => {
    const top = p.deck.slice(0, 1);
    return { ...p, deck: p.deck.slice(1), discard: [...p.discard, ...top] };
  });
});

// 螺釘地鼠 狂挖 — 放置時可用，丟最多 3 張基本鬥能量
regA('螺釘地鼠', 0, (st, idx, pool) => {
  const fighting = st.players[idx].deck.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.pokemonType === 'Fighting';
  }).slice(0, 3);
  st = addLog(st, '狂挖：丟最多 3 張基本鬥能量到棄牌', idx);
  if (fighting.length === 0) return st;
  return updatePlayer(st, idx, p => {
    const fIids = new Set(fighting.map(c => c.iid));
    const newDeck = p.deck.filter(c => !fIids.has(c.iid));
    return { ...p, deck: shuffle(newDeck), discard: [...p.discard, ...fighting] };
  });
});
