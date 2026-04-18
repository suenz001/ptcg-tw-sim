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
reg('夜間擔架', (st, idx) => {
  const discard = st.players[idx].discard;
  if (discard.length === 0) return addLog(st, '夜間擔架：棄牌區為空', idx);
  st = addLog(st, '夜間擔架：從棄牌區選 1 張寶可夢或基本能量加手牌', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonOrEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

// 能量回收器 — 從棄牌區選最多 5 張基本能量卡放回牌庫
reg('能量回收器', (st, idx) => {
  const energies = st.players[idx].discard.filter(() => true); // 在 UI 篩選
  if (energies.length === 0) return addLog(st, '能量回收器：棄牌區為空', idx);
  st = addLog(st, '能量回收器：從棄牌區選最多 5 張基本能量洗回牌庫', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 5,
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
reg('奇跡修正檔', (st, idx) => {
  const hasEnergy = st.players[idx].discard.some(() => true); // 在 UI 過濾 BasicEnergy:Psychic
  if (!hasEnergy) return addLog(st, '奇跡修正檔：棄牌區沒有基本超能量', idx);
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

// 狙擊羽毛 — 丟棄 2 個能量，對對手任意1隻寶可夢造成 120 傷害
// M3 簡化：直接對出場造成 120（不含備戰區選擇）
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
  s = addLog(s, '狙擊羽毛：丟棄 2 個能量，造成 120 傷害', aIdx);
  return { state: s, damage: 120 };
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
