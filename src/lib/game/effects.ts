/**
 * 訓練家效果登錄表
 *
 * TRAINER_EFFECTS: cardName → 效果函式（即時效果或回傳 pendingSelection）
 * RESOLVERS:       effectKey → 玩家選擇後的繼續函式
 *
 * M2 實裝：常見非互動支援者 + 常見物品（切換/球/藥水）
 * M3/M4 逐步填入更多效果
 */

import type { Card, EnergyType } from '$lib/cards/types';
import type { GameState, PlayerState, CardInstance, PendingSelection, GameAction } from './types';

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
regR('alice-courage', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `艾莉絲的鬥志：丟棄 ${names}`, idx);
  }
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

regR('do-switch', (st, idx, iids, _params, pool) => {
  const prevPlayer = st.players[idx];
  const target = prevPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = prevPlayer.active ? (pool.get(prevPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `→ 將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場`, idx);
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
  pool: Map<string, Card>
): GameState {
  const healAmount = (params?.healAmount as number) ?? 30;
  const discardCount = (params?.discardEnergy as number) ?? 0;
  const iid = iids[0];
  // 附加 log：記錄實際回復的目標與數值（pre-log 僅提示「選擇…寶可夢」，未標明目標）
  const prevPlayer = st.players[idx];
  const prevTarget = prevPlayer.active?.iid === iid
    ? prevPlayer.active
    : prevPlayer.bench.find(c => c.iid === iid);
  if (prevTarget) {
    const name = pool.get(prevTarget.cardId)?.name ?? '?';
    const actualHeal = Math.min(prevTarget.damage, healAmount);
    const parts = [`${name} 回復 ${actualHeal} HP`];
    if (discardCount > 0) parts.push(`丟棄 ${discardCount} 個能量`);
    st = addLog(st, `→ ${parts.join('，')}`, idx);
  }
  return updatePlayer(st, idx, (p) => {
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
regG('好友寶芬', (st, idx, pool) => {
  // 備戰要有空位，且牌庫要有 HP≤70 的基礎寶可夢
  if (st.players[idx].bench.length >= 5) return false;
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.subtype !== 'Other' && !card.evolvesFrom && (card.hp ?? 0) <= 70;
  });
});
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
regG('赫普的包包', (st, idx, pool) => {
  if (st.players[idx].bench.length >= 5) return false;
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.subtype !== 'Other' && !card.evolvesFrom;
  });
});
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

regR('bench-basic-from-deck', (st, idx, iids, _params, pool) => {
  // 公開資訊：放到備戰區本來就對對手可見，順便記到 log 方便追蹤
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `放到備戰區：${names}`, idx);
  } else {
    st = addLog(st, '牌庫搜尋：未選擇任何卡', idx);
  }
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

regR('gust-opp', (st, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const oppPlayer = st.players[oppIdx];
  const target = oppPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = oppPlayer.active ? (pool.get(oppPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `將對手戰鬥場的 ${oldName} 換到備戰區，呼叫 ${newName} 到對手戰鬥場`, idx);
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
regG('超級信號', (st, idx, pool) =>
  st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.name.startsWith('超級') && (card.subtype === 'ex' || card.name.endsWith('ex'));
  })
);
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
  const n = iids.length;
  st = addLog(st, `能量回收器：${n} 張基本能量洗回牌庫`, idx);
  return updatePlayer(st, idx, (p) => {
    const chosen = p.discard.filter(c => iids.includes(c.iid));
    const newDiscard = p.discard.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle([...p.deck, ...chosen]), discard: newDiscard };
  });
});

regR('discard-to-hand', (st, idx, iids, _params, pool) => {
  // 棄牌區 → 手牌：來源是公開的，記錄取回的卡名
  const chosen = st.players[idx].discard.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `從棄牌取回：${names}`, idx);
  }
  return updatePlayer(st, idx, (p) => {
    const picked = p.discard.filter(c => iids.includes(c.iid));
    return { ...p, discard: p.discard.filter(c => !iids.includes(c.iid)), hand: [...p.hand, ...picked] };
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
regR('miracle-codec-energy', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const energyIid = iids[0];
  const player = st.players[idx];
  const energyInst = player.discard.find(c => c.iid === energyIid);
  const energyName = energyInst ? (pool.get(energyInst.cardId)?.name ?? '超能量') : '超能量';
  if (player.bench.length === 0) {
    // 直接附到出場寶可夢
    const activeName = player.active ? (pool.get(player.active.cardId)?.name ?? '出場寶可夢') : '出場寶可夢';
    st = addLog(st, `奇跡修正檔：將 ${energyName} 附加到 ${activeName}`, idx);
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
    params: { energyIid, energyName },
  });
});
regR('miracle-codec-attach', (st, idx, iids, params, pool) => {
  const energyIid = params?.energyIid as string;
  if (!energyIid) return st;
  const targetIid = iids[0];
  const player = st.players[idx];
  const target = player.bench.find(c => c.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '備戰寶可夢') : '備戰寶可夢';
  const energyName = (params?.energyName as string | undefined)
    ?? (() => {
      const e = player.discard.find(c => c.iid === energyIid);
      return e ? (pool.get(e.cardId)?.name ?? '超能量') : '超能量';
    })();
  st = addLog(st, `奇跡修正檔：將 ${energyName} 附加到 ${targetName}`, idx);
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
regR('top-catcher-opp', (st, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const oppPlayer = st.players[oppIdx];
  const target = oppPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = oppPlayer.active ? (pool.get(oppPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `頂尖捕捉器：將對手戰鬥場的 ${oldName} 換到備戰區，呼叫 ${newName} 到對手戰鬥場`, idx);
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

// 不公印章 — 必須「上個對手的回合自己的寶可夢昏厥了」才可使用（= 對手剛結束的回合有取過獎賞）
// 規則原文：「這張卡必須在上個對手的回合自己的寶可夢【昏厥】了才可使用」
// 舊版 bug：用 `players[idx].prizes.length < 6`（= 我有取過獎賞）判定，方向剛好寫反；
// 且沒區分「上一回合」vs「以前曾經」。
// 新版：engine 在每次 END_TURN 時快照對手獎賞張數到 state.oppPrizesAtMyLastTurnEnd[idx]；
// 下次 idx 回合 gate 時，比較 snapshot vs 目前對手獎賞數，只要對手在他們剛結束的回合有取過獎賞
// （= 自己寶可夢被擊倒），opp.prizes.length < snap 就回 true。
regG('不公印章', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const snap = st.oppPrizesAtMyLastTurnEnd?.[idx] ?? 6;
  return st.players[oppIdx].prizes.length < snap;
});
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
  pool: Map<string, Card>,
  action?: Extract<GameAction, { type: 'ATTACK' }>
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

/**
 * 招式宣告時需要玩家選擇丟棄能量的宣告表。
 *
 * - min / max：可丟棄的能量張數範圍（max=null 表示不限上限 / 全部）
 * - scope：'attacker' = 只能丟攻擊方出場寶可夢身上的能量；
 *          'any-own' = 可丟自己場上（含備戰）任何寶可夢身上的能量（例：猛擂鼓 EX）
 * - baseDamage / damagePerEnergy：UI 顯示用的預估傷害公式（實際傷害仍由 regPre 計算）
 *
 * UI 在使用者按下招式按鈕時讀此表；若命中則彈出挑能量 modal，
 * 玩家確認後帶著 discardedEnergyIids 派送 ATTACK action。
 * 若 action 沒帶 iids（例：AI 直接派送），regPre 會退回預設的自動丟棄策略，
 * 保持向後相容。
 */
export interface PreDiscardSpec {
  min: number;
  max: number | null; // null = 不限上限（全部）
  scope: 'attacker' | 'any-own';
  baseDamage: number;
  damagePerEnergy: number;
}

export const ATTACK_PRE_DISCARD_CHOICE = new Map<string, PreDiscardSpec>();

// ══════════════════════════════════════════════════════════════════════════════
// POST 共用 helper：bench 施傷 / KO 處理（v1.58 H13 批次）
// ══════════════════════════════════════════════════════════════════════════════

/** 計算 KO 獎賞張數（與 engine.prizesForKO 對齊；inline 以免 effects→engine 反向依賴） */
function koPrizeCount(card: Card): number {
  const isEx = card.name.endsWith('ex') || card.name.endsWith('EX');
  if (isEx && card.name.startsWith('超級')) return 3; // Mega ex
  return isEx ? 2 : 1;
}

/** 計算 CardInstance 的有效 HP（含道具 HP 加成，與 engine.getEffectiveHP 對齊） */
function effectiveHPInline(inst: CardInstance, pool: Map<string, Card>): number {
  const card = pool.get(inst.cardId);
  if (!card) return 0;
  let hp = card.hp ?? 0;
  if (inst.toolAttached) {
    const tool = pool.get(inst.toolAttached.cardId);
    if (tool) {
      const bonusFn = TOOL_HP_BONUS.get(tool.name);
      if (bonusFn) hp += bonusFn(card);
    }
  }
  return hp;
}

/**
 * 對指定方的「所有備戰寶可夢」施加固定 amount 傷害（bench 不計算弱點/抵抗力）。
 * KO 判定 + 棄牌遷移 + pendingPrizes 累計都在這裡處理。
 * 僅在擊倒的情況下寫 log；非 KO 僅回傳新 state 由 caller 寫總結 log。
 *
 * 注意：bench 被 KO 不會 set pendingSelection；攻擊方累計取獎後照流程進行。
 */
function hitBenchAll(
  state: GameState,
  attackerIdx: 0 | 1,
  targetIdx: 0 | 1,
  amount: number,
  pool: Map<string, Card>,
  attackLabel: string,
): GameState {
  const target = state.players[targetIdx];
  if (target.bench.length === 0 || amount <= 0) return state;

  let morePrizes = 0;
  const newBench: CardInstance[] = [];
  const koDiscards: CardInstance[] = [];
  const koNames: string[] = [];

  for (const c of target.bench) {
    const card = pool.get(c.cardId);
    const newDmg = c.damage + amount;
    const hp = effectiveHPInline(c, pool);
    if (hp > 0 && newDmg >= hp) {
      koDiscards.push({ ...c, damage: newDmg });
      for (const e of c.energyAttached) koDiscards.push(e);
      if (c.toolAttached) koDiscards.push(c.toolAttached);
      for (const prev of c.evolvedFromStack ?? []) koDiscards.push(prev);
      if (card) morePrizes += koPrizeCount(card);
      koNames.push(card?.name ?? '?');
    } else {
      newBench.push({ ...c, damage: newDmg });
    }
  }

  const players = [...state.players] as [PlayerState, PlayerState];
  players[targetIdx] = {
    ...target,
    bench: newBench,
    discard: [...target.discard, ...koDiscards],
  };

  const who = targetIdx === attackerIdx ? '自己' : '對手';
  let s: GameState = { ...state, players };
  s = addLog(s, `${attackLabel}：對${who}所有備戰寶可夢各造成 ${amount} 傷害`, attackerIdx);
  if (koNames.length > 0) {
    s = addLog(s, `${attackLabel}：${koNames.join('、')} 被擊倒，${state.players[attackerIdx].name} 額外取得 ${morePrizes} 張獎勵牌`, null);
    s = { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + morePrizes };
  }
  return s;
}

/**
 * 對指定方的備戰寶可夢挑選 count 隻，各施加 amount 傷害。
 * 透過 pendingSelection（'bench-choose' / 'opp-bench-choose'）讓玩家選擇。
 * 挑選完後由 `bench-hit-N` resolver 施加傷害 / KO 判定。
 *
 * 若備戰數量不足 count，會改為 min(備戰數, count)；為 0 則直接返回（無動作）。
 */
function hitBenchPickPost(
  state: GameState,
  attackerIdx: 0 | 1,
  targetSide: 'self' | 'opp',
  count: number,
  amount: number,
  attackLabel: string,
): GameState {
  const targetIdx = (targetSide === 'opp' ? (1 - attackerIdx) : attackerIdx) as 0 | 1;
  const target = state.players[targetIdx];
  if (target.bench.length === 0 || amount <= 0 || count <= 0) return state;
  const pickCount = Math.min(count, target.bench.length);
  const pendingType: PendingSelection['type'] = targetSide === 'opp' ? 'opp-bench-choose' : 'bench-choose';
  let s = addLog(state, `${attackLabel}：選擇 ${pickCount} 隻${targetSide === 'opp' ? '對手' : '自己'}備戰寶可夢，各造成 ${amount} 傷害`, attackerIdx);
  return withPending(s, {
    type: pendingType,
    actorIdx: attackerIdx,
    sourcePlayerIdx: targetIdx,
    minCount: pickCount,
    maxCount: pickCount,
    effectKey: 'bench-hit-N',
    params: { amount, attackLabel, targetIdx },
  });
}

/**
 * 通用 resolver：對 selectedIids 指到的 bench 寶可夢各施加 params.amount 傷害，
 * 處理 KO + 棄牌遷移 + pendingPrizes 累計。
 * 支援「挑自己備戰」或「挑對手備戰」（sourcePlayerIdx 決定）。
 */
regR('bench-hit-N', (st, actorIdx, selectedIids, params, pool) => {
  const amount = Number(params?.amount ?? 0);
  const label = String(params?.attackLabel ?? '招式');
  const targetIdx = ((params?.targetIdx ?? (1 - actorIdx)) as 0 | 1);
  if (amount <= 0 || selectedIids.length === 0) return st;
  const target = st.players[targetIdx];

  let morePrizes = 0;
  const newBench: CardInstance[] = [];
  const koDiscards: CardInstance[] = [];
  const hitNames: string[] = [];
  const koNames: string[] = [];
  const hitSet = new Set(selectedIids);

  for (const c of target.bench) {
    if (!hitSet.has(c.iid)) { newBench.push(c); continue; }
    const card = pool.get(c.cardId);
    const newDmg = c.damage + amount;
    const hp = effectiveHPInline(c, pool);
    if (hp > 0 && newDmg >= hp) {
      koDiscards.push({ ...c, damage: newDmg });
      for (const e of c.energyAttached) koDiscards.push(e);
      if (c.toolAttached) koDiscards.push(c.toolAttached);
      for (const prev of c.evolvedFromStack ?? []) koDiscards.push(prev);
      if (card) morePrizes += koPrizeCount(card);
      koNames.push(card?.name ?? '?');
    } else {
      newBench.push({ ...c, damage: newDmg });
      hitNames.push(card?.name ?? '?');
    }
  }

  const players = [...st.players] as [PlayerState, PlayerState];
  players[targetIdx] = { ...target, bench: newBench, discard: [...target.discard, ...koDiscards] };

  let s: GameState = { ...st, players };
  if (hitNames.length > 0) {
    s = addLog(s, `${label}：對 ${hitNames.join('、')} 造成 ${amount} 傷害`, actorIdx);
  }
  if (koNames.length > 0) {
    s = addLog(s, `${label}：${koNames.join('、')} 被擊倒，${st.players[actorIdx].name} 額外取得 ${morePrizes} 張獎勵牌`, null);
    s = { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + morePrizes };
  }
  return s;
});

// ── MBD 超級蒂安希ex ──────────────────────────────────────────────────────────

// 花冠射線 — 玩家選擇丟 0~2 個自身能量，造成張數×120 傷害
// UI：ATTACK_PRE_DISCARD_CHOICE 登錄後，按下招式會彈出能量選擇 modal。
// AI / 舊流程（action 未帶 iids）：退回自動丟棄至多 2 個的舊邏輯，保持向後相容。
ATTACK_PRE_DISCARD_CHOICE.set('超級蒂安希ex|花冠射線', {
  min: 0,
  max: 2,
  scope: 'attacker',
  baseDamage: 0,
  damagePerEnergy: 120,
});
regPre('超級蒂安希ex|花冠射線', (state, aIdx, _pool, action) => {
  const player = state.players[aIdx];
  if (!player.active) return { state, damage: 0 };
  const energies = player.active.energyAttached;

  const chosenIids = action?.discardedEnergyIids;
  let discarded: CardInstance[];
  let remaining: CardInstance[];
  if (chosenIids && chosenIids.length > 0) {
    // 限制最多 2 張，且只認得攻擊方出場身上的能量
    const allowed = new Set(energies.map(e => e.iid));
    const capped = chosenIids.filter(id => allowed.has(id)).slice(0, 2);
    const chosenSet = new Set(capped);
    discarded = energies.filter(e => chosenSet.has(e.iid));
    remaining = energies.filter(e => !chosenSet.has(e.iid));
  } else {
    // Fallback：自動丟最多 2 張（舊行為）
    const discardCount = Math.min(2, energies.length);
    discarded = energies.slice(-discardCount);
    remaining = energies.slice(0, energies.length - discardCount);
  }

  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: remaining } : null,
    discard: [...p.discard, ...discarded],
  }));
  const dmg = discarded.length * 120;
  s = addLog(s, `花冠射線：丟棄 ${discarded.length} 個能量，造成 ${dmg} 傷害`, aIdx);
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

regR('gengar-move-energy', (st, idx, iids, params, pool) => {
  const energyIid    = params?.energyIid    as string | undefined;
  const energyCardId = params?.energyCardId as string | undefined;
  if (!energyIid || !energyCardId || iids.length === 0) return st;
  const targetIid = iids[0];
  const target = st.players[idx].bench.find(c => c.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '備戰寶可夢') : '備戰寶可夢';
  const energyName = pool.get(energyCardId)?.name ?? '能量';
  st = addLog(st, `空無強風：將 ${energyName} 附加到 ${targetName}`, idx);
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

regR('cresselia-attach-energy', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const player = st.players[idx];
  if (!player.active) return st;
  const activeName = pool.get(player.active.cardId)?.name ?? '出場寶可夢';
  const chosenInst = player.deck.filter(c => iids.includes(c.iid));
  const names = chosenInst.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addLog(st, `充溢之光：將 ${names} 附加到 ${activeName}`, idx);
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

regR('heal-120-bench', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  const target = st.players[idx].bench.find(c => c.iid === targetIid);
  if (target) {
    const name = pool.get(target.cardId)?.name ?? '?';
    const actualHeal = Math.min(target.damage, 120);
    st = addLog(st, `→ ${name} 回復 ${actualHeal} HP`, idx);
  }
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

regR('attach-tool', (st, idx, picked, params, pool) => {
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
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const toolName = pool.get(toolInst.cardId)?.name ?? '道具';
  st = addLog(st, `🔧 ${toolName} 附加到 ${targetName}`, idx);
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

  // 補 log：記錄基礎→2 階的進化（原本只有構造 logMsg 但未呼叫 addLog）
  const prevPlayer = st.players[idx];
  const stage2InstPrev = prevPlayer.hand.find(i => i.iid === stage2Iid);
  const stage2Name = stage2InstPrev ? (pool.get(stage2InstPrev.cardId)?.name ?? '?') : '?';
  const baseInstPrev = prevPlayer.active?.iid === targetIid
    ? prevPlayer.active
    : prevPlayer.bench.find(b => b.iid === targetIid);
  const baseName = baseInstPrev ? (pool.get(baseInstPrev.cardId)?.name ?? '?') : '?';
  st = addLog(st, `神奇糖果：${baseName} 直接進化為 ${stage2Name}！`, idx);

  return updatePlayer(st, idx, p => {
    const stage2Inst = p.hand.find(i => i.iid === stage2Iid);
    if (!stage2Inst) return p;

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

    return {
      ...p,
      hand: p.hand.filter(i => i.iid !== stage2Iid),
      active: p.active ? evolve(p.active) : null,
      bench: p.bench.map(evolve),
    };
  });
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
    // tails → can't attack next turn (用 pending，將在擁有者下個回合開始時 promote)
    const players = [...state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    if (p.active) p.active = { ...p.active, cantAttackPending: true };
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
  if (p.active) p.active = { ...p.active, cantAttackPending: true };
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

regR('dominance-chain', (st, idx, iids, params, pool) => {
  const validIids = (params?.validIids as string[]) ?? [];
  const targetIid = iids[0];
  if (!validIids.includes(targetIid)) return st;
  const target = st.players[idx].bench.find(c => c.iid === targetIid);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = st.players[idx].active ? (pool.get(st.players[idx].active!.cardId)?.name ?? '?') : '?';
  st = addLog(st, `支配鎖鏈：將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場（中毒）`, idx);
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
// M2 簡化：用 cantAttackPending 旗標代表「下回合無法攻擊」
// （原文是禁用特定招式；完整實作需 disabledAttacks 機制，此為可接受的保守簡化）
regPost('破空焰ex|烈火爆進', (state, aIdx, _pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (p.active) p.active = { ...p.active, cantAttackPending: true };
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
regR('surfer-switch', (st, idx, iids, _params, pool) => {
  const prevPlayer = st.players[idx];
  const target = prevPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = prevPlayer.active ? (pool.get(prevPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `衝浪手：將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場`, idx);
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
regR('hydai-bottom-draw4', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `海岱：${names} 放到牌庫底`, idx);
  }
  return updatePlayer(st, idx, p => {
    const picked = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    const newDeck = [...p.deck, ...picked];
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
// Session 31 H8 — 下回合這隻無法使用招式（cantAttackPending 機制）
// ══════════════════════════════════════════════════════════════════════════════

function selfCantAttackNextPost(): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, cantAttackPending: true };
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
    if (def.active) def.active = { ...def.active, cantAttackPending: true };
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
// Session 38g H13 — bench snipe / spray 批次（13 張）
// 使用 hitBenchAll / hitBenchPickPost helper，bench 不計算弱點・抵抗力已內建
// ══════════════════════════════════════════════════════════════════════════════

// ── P1：對指定方「所有備戰」施加固定傷害（3 張）────────────────────────────
// 穿山王 地震 — 自己所有備戰 10
regPost('穿山王|地震', (state, aIdx, pool) =>
  hitBenchAll(state, aIdx, aIdx, 10, pool, '地震'));
// 焚焰蚣 燃燒熱浪 — 自己所有備戰 30
regPost('焚焰蚣|燃燒熱浪', (state, aIdx, pool) =>
  hitBenchAll(state, aIdx, aIdx, 30, pool, '燃燒熱浪'));
// 電飛鼠 天空波 — 雙方所有備戰各 10
regPost('電飛鼠|天空波', (state, aIdx, pool) => {
  const s1 = hitBenchAll(state, aIdx, aIdx, 10, pool, '天空波');
  return hitBenchAll(s1, aIdx, (1 - aIdx) as 0 | 1, 10, pool, '天空波');
});

// ── P2：選 N 隻備戰各施加固定傷害（5 張）──────────────────────────────────
// 奇麒麟ex 惡劣光束 — 選對手 1 隻備戰 30
regPost('奇麒麟ex|惡劣光束', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'opp', 1, 30, '惡劣光束'));
// 摩托蜥ex 突圍 — 選對手 1 隻備戰 30
regPost('摩托蜥ex|突圍', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'opp', 1, 30, '突圍'));
// 冰伊布ex 冰霜子彈 — 選對手 1 隻備戰 30
regPost('冰伊布ex|冰霜子彈', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'opp', 1, 30, '冰霜子彈'));
// 三首惡龍ex 黑曜石 — 選對手 2 隻備戰各 130
regPost('三首惡龍ex|黑曜石', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'opp', 2, 130, '黑曜石'));
// 麒麟奇 雙向頭擊 — 選自己 1 隻備戰 10
regPost('麒麟奇|雙向頭擊', (state, aIdx, _pool) =>
  hitBenchPickPost(state, aIdx, 'self', 1, 10, '雙向頭擊'));

// ── P3：條件式 +N 傷害（regPre 修改傷害，3 張）────────────────────────────
// 老翁龍 盛怒炮 — 若自己所有備戰都有傷，+120（基礎 100）
regPre('老翁龍|盛怒炮', (state, aIdx, _pool) => {
  const bench = state.players[aIdx].bench;
  const bonus = bench.length > 0 && bench.every(c => c.damage > 0) ? 120 : 0;
  return { state, damage: 100 + bonus };
});
// 洗翠 風速狗 驕傲獠牙 — 若自己備戰任一有傷，+90（基礎 30）
regPre('洗翠 風速狗|驕傲獠牙', (state, aIdx, _pool) => {
  const anyDamaged = state.players[aIdx].bench.some(c => c.damage > 0);
  return { state, damage: 30 + (anyDamaged ? 90 : 0) };
});
// 鐵頭殼 滅絕斬 — 若對手備戰 ≥3 隻，+80（基礎 40）
regPre('鐵頭殼|滅絕斬', (state, aIdx, _pool) => {
  const oppBench = state.players[(1 - aIdx) as 0 | 1].bench.length;
  return { state, damage: 40 + (oppBench >= 3 ? 80 : 0) };
});

// ── P4：條件式 bench 傷害 + stadium 丟棄（1 張）────────────────────────────
// 古鼎鹿 大地斷裂 — 若場上有 Stadium：對手所有備戰 30 + 丟棄 Stadium
regPost('古鼎鹿|大地斷裂', (state, aIdx, pool) => {
  if (!state.activeStadium) return state;
  const stadiumInst = state.activeStadium;
  const stadiumCard = pool.get(stadiumInst.cardId);
  const stadiumOwner = (state.players[0].discard.some(c => c.iid === stadiumInst.iid) ||
                       state.players[1].discard.some(c => c.iid === stadiumInst.iid))
                      ? null : aIdx; // 安全退回：丟到攻擊方 discard
  // 實際上 activeStadium 應該屬於雙方其中一位的 supporterPlayedThisTurn 所放；
  // 為了簡化：丟到攻擊方棄牌區（Stadium 下場無所屬方規則差異）
  let s: GameState = {
    ...state,
    activeStadium: undefined,
    stadiumUsedThisTurn: undefined,
  };
  s = updatePlayer(s, aIdx, p => ({ ...p, discard: [...p.discard, stadiumInst] }));
  s = addLog(s, `大地斷裂：將場地卡 ${stadiumCard?.name ?? '?'} 丟棄`, aIdx);
  return hitBenchAll(s, aIdx, (1 - aIdx) as 0 | 1, 30, pool, '大地斷裂');
});

// ── P5：條件式 選 2 隻對手備戰施加 120（1 張）──────────────────────────────
// 古簡蝸 貪婪危害 — 若自己牌庫 ≤3 張，對手選 2 隻備戰各 120
regPost('古簡蝸|貪婪危害', (state, aIdx, _pool) => {
  if (state.players[aIdx].deck.length > 3) return state;
  return hitBenchPickPost(state, aIdx, 'opp', 2, 120, '貪婪危害');
});

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
regR('super-energy-step2', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `超級能量回收：丟棄 ${names}`, idx);
  }
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
regR('earth-pot-step2', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `大地之容器：丟棄 ${names}`, idx);
  }
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
regG('席藍', (st, idx, pool) =>
  st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && (card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX'));
  })
);
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

// ══════════════════════════════════════════════════════════════════════════════
// Session 33 — 寶可夢道具（Tool）效果登錄表
//
// 設計：每個 tool 的效果都是一小段「在 ATTACK 流程特定時機觸發」的 hook。
// 引擎在 ATTACK handler 查表呼叫，沒註冊的 tool 沒效果。
//
// 觸發點（依序）：
//   1. TOOL_HP_BONUS            — 防守方有效 HP 增加（影響 KO 判定）
//   2. TOOL_ATTACK_BONUS        — 攻擊方 +N 傷害（weakness 後）
//   3. TOOL_DEFENSE_REDUCE_BY_TYPE — 攻擊屬性符合時防守方 -N，觸發後丟棄道具
//   4. TOOL_PREVENT_KO          — 滿血被 KO 時保留 HP，觸發後丟棄道具
//   5. TOOL_ON_KO               — 被 KO 時的額外效果（如抽牌、移能量）
//   6. TOOL_PRIZE_BONUS         — 被 KO 時對手多獲 N 張獎賞
//   7. TOOL_ON_DAMAGED          — 被打到但未 KO 時觸發（如反傷、抽牌）
//   8. TOOL_RETREAT_MOD         — 撤退成本修正
// ══════════════════════════════════════════════════════════════════════════════

export const TOOL_HP_BONUS = new Map<string, (holderCard: Card) => number>();
export const TOOL_ATTACK_BONUS = new Map<string, (
  attackerCard: Card, attackerInst: CardInstance,
  defenderCard: Card, defenderInst: CardInstance
) => number>();
export const TOOL_DEFENSE_REDUCE_BY_TYPE = new Map<string, {
  amount: number;
  types: EnergyType[];
  discardOnTrigger: boolean;
}>();
export const TOOL_PREVENT_KO = new Map<string, (
  holderInst: CardInstance, holderCard: Card, incomingDamage: number
) => { prevent: boolean; leaveHP: number }>();
export const TOOL_ON_KO = new Map<string, (
  state: GameState, dIdx: 0 | 1, aIdx: 0 | 1, pool: Map<string, Card>
) => GameState>();
export const TOOL_PRIZE_BONUS = new Map<string, (holderCard: Card) => number>();
export const TOOL_ON_DAMAGED = new Map<string, (
  state: GameState, dIdx: 0 | 1, aIdx: 0 | 1, damage: number, pool: Map<string, Card>
) => GameState>();
export const TOOL_RETREAT_MOD = new Map<string, (
  holderCard: Card, holderInst: CardInstance
) => { reduceBy?: number; zero?: boolean }>();

// ── HP 加成 ──────────────────────────────────────────────────────────────────
TOOL_HP_BONUS.set('英雄斗篷', () => 100);
TOOL_HP_BONUS.set('勇氣護符', (card) => !card.evolvesFrom ? 50 : 0);
TOOL_HP_BONUS.set('豪華斗篷', (card) => {
  const isRulePoke = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX')
    || !!card.rulesText?.includes('擁有規則');
  return isRulePoke ? 0 : 100;
});
// 驅勁能量 古代/未來：簡化 — 不檢查「古代/未來」標籤，附上就生效（UI 層不會附錯）
TOOL_HP_BONUS.set('驅勁能量 古代', () => 60);

// ── 攻擊加成（我方帶此道具 → 打出時 +N）────────────────────────────────────
TOOL_ATTACK_BONUS.set('極限腰帶', (_a, _ai, defCard) => {
  const isEx = defCard.subtype === 'ex' || defCard.name.endsWith('ex') || defCard.name.endsWith('EX');
  return isEx ? 50 : 0;
});
TOOL_ATTACK_BONUS.set('鎖鏈糬', (_a, atkInst) => atkInst.status === 'poisoned' ? 40 : 0);
TOOL_ATTACK_BONUS.set('驅勁能量 未來', () => 20);

// ── 特定屬性防禦（防守方帶此道具 → 特定屬性攻擊 -60，觸發即丟棄） ─────────
TOOL_DEFENSE_REDUCE_BY_TYPE.set('福祿果', { amount: 60, types: ['Psychic'], discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('巧可果', { amount: 60, types: ['Fire'],    discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('千香果', { amount: 60, types: ['Water'],   discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('刺耳果', { amount: 60, types: ['Darkness'], discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('霹霹果', { amount: 60, types: ['Metal'],   discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('莓榴果', { amount: 60, types: ['Dragon'],  discardOnTrigger: true });

// ── 防 KO（滿血被 KO 時留 10 HP） ─────────────────────────────────────────
TOOL_PREVENT_KO.set('倖存鍛鍊器', (inst, card) => {
  const hp = card.hp ?? 0;
  if (inst.damage === 0 && hp > 10) return { prevent: true, leaveHP: 10 };
  return { prevent: false, leaveHP: 0 };
});

// ── 被 KO 時效果 ───────────────────────────────────────────────────────────
TOOL_ON_KO.set('希望護身符', (state, dIdx) => {
  // 從牌庫抽 3 張（簡化為固定抽頂 3 張；原文為「任意選擇最多 3 張」）
  state = addLog(state, '希望護身符：從牌庫抽 3 張', dIdx);
  return updatePlayer(state, dIdx, p => {
    const taken = p.deck.slice(0, 3);
    return { ...p, deck: shuffle(p.deck.slice(3)), hand: [...p.hand, ...taken] };
  });
});
TOOL_ON_KO.set('沉重接力棒', (state, dIdx, _aIdx, pool) => {
  // 只對【撤退】所需 4 能量的寶可夢生效
  // 注意：此 hook 在 KO 後呼叫，被 KO 的 active 已經進棄牌。要從棄牌找能量。
  // 簡化：移除棄牌區最近丟進去的基本能量（最多 3 張），改附於第一個備戰。
  const player = state.players[dIdx];
  if (player.bench.length === 0) return state;
  // 找棄牌區最後 N 張基本能量（剛剛被 KO 時一起丟進去的）
  const revIds: string[] = [];
  for (let i = player.discard.length - 1; i >= 0 && revIds.length < 3; i--) {
    const c = player.discard[i];
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic') {
      revIds.push(c.iid);
    } else {
      break; // 非能量則停止（只看最上面的批次）
    }
  }
  if (revIds.length === 0) return state;
  const benchTarget = player.bench[0];
  const benchName = benchTarget ? (pool.get(benchTarget.cardId)?.name ?? '備戰寶可夢') : '備戰寶可夢';
  state = addLog(state, `沉重接力棒：將 ${revIds.length} 張基本能量附加到 ${benchName}`, dIdx);
  return updatePlayer(state, dIdx, p => {
    const energies = p.discard.filter(c => revIds.includes(c.iid));
    const newDiscard = p.discard.filter(c => !revIds.includes(c.iid));
    const target = p.bench[0];
    const newBench = [...p.bench];
    newBench[0] = { ...target, energyAttached: [...target.energyAttached, ...energies] };
    return { ...p, discard: newDiscard, bench: newBench };
  });
});

// ── 被擊倒時對手多獲 1 張獎賞 ─────────────────────────────────────────────
TOOL_PRIZE_BONUS.set('豪華斗篷', (card) => {
  const isRulePoke = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX')
    || !!card.rulesText?.includes('擁有規則');
  return isRulePoke ? 0 : 1;
});

// ── 受傷（未 KO）觸發 ──────────────────────────────────────────────────────
TOOL_ON_DAMAGED.set('幸運頭盔', (state, dIdx) => {
  state = addLog(state, '幸運頭盔：抽 2 張', dIdx);
  return updatePlayer(state, dIdx, p => {
    const taken = p.deck.slice(0, 2);
    return { ...p, deck: p.deck.slice(2), hand: [...p.hand, ...taken] };
  });
});
TOOL_ON_DAMAGED.set('奢華炸彈', (state, dIdx, aIdx) => {
  // 反彈 120 傷害到攻擊方，且道具丟棄
  state = updatePlayer(state, dIdx, p => {
    if (!p.active || !p.active.toolAttached) return p;
    const tool = p.active.toolAttached;
    return { ...p, active: { ...p.active, toolAttached: undefined }, discard: [...p.discard, tool] };
  });
  state = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + 120 } };
  });
  return addLog(state, '奢華炸彈：反彈 120 傷害！', null);
});

// ── 撤退成本修正 ──────────────────────────────────────────────────────────
TOOL_RETREAT_MOD.set('緊急滑板', (card, inst) => {
  const hp = card.hp ?? 0;
  const remaining = hp - inst.damage;
  if (remaining <= 30) return { zero: true };
  return { reduceBy: 1 };
});
TOOL_RETREAT_MOD.set('驅勁能量 未來', () => ({ zero: true }));
// 氣球 已有既存 engine 支援（retreat -2），這裡補註冊好保持一致性
TOOL_RETREAT_MOD.set('氣球', () => ({ reduceBy: 2 }));

// ── 重力之玉：雙方撤退 +1（需要 engine 層在計算兩側時查對面 tool） ─────
// 用一個獨立的 flag 標記，engine 計算撤退時若雙方任一 active 帶此 tool，則 +1
export const TOOL_BOTH_SIDES_RETREAT_PLUS = new Set<string>();
TOOL_BOTH_SIDES_RETREAT_PLUS.add('重力之玉');

// ═══════════════════════════════════════════════════════════════════════════
// Session 38h H 標第 5 波 damage-multiply 批次（18 張）
// 通用：counter = Math.floor(inst.damage / 10)；preFn return { state, damage }
// ═══════════════════════════════════════════════════════════════════════════

/** 取得 state 某 side 某 inst 的 damage counter 數（每 10 點 = 1 counter） */
function counterCount(dmg: number): number { return Math.floor(dmg / 10); }

/** 計算自己攻擊方 active 身上的 counter 數 */
function selfActiveCounters(state: GameState, aIdx: 0 | 1): number {
  return counterCount(state.players[aIdx].active?.damage ?? 0);
}
/** 計算對手 active 身上的 counter 數 */
function oppActiveCounters(state: GameState, aIdx: 0 | 1): number {
  const dIdx = (1 - aIdx) as 0 | 1;
  return counterCount(state.players[dIdx].active?.damage ?? 0);
}
/** 計算對手全場（active + bench）所有 counter 和 */
function oppAllCounters(state: GameState, aIdx: 0 | 1): number {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  let sum = counterCount(p.active?.damage ?? 0);
  for (const b of p.bench) if (b) sum += counterCount(b.damage);
  return sum;
}
/** 計算自己場上符合 filterFn 的寶可夢數（active + bench） */
function countOwnPokemon(state: GameState, aIdx: 0 | 1, pool: Map<string, Card>, filterFn: (c: Card) => boolean): number {
  const p = state.players[aIdx];
  let n = 0;
  if (p.active) { const c = pool.get(p.active.cardId); if (c && filterFn(c)) n++; }
  for (const b of p.bench) if (b) { const c = pool.get(b.cardId); if (c && filterFn(c)) n++; }
  return n;
}
/** 計算對手場上符合 filterFn 的寶可夢數 */
function countOppPokemon(state: GameState, aIdx: 0 | 1, pool: Map<string, Card>, filterFn: (c: Card) => boolean): number {
  const dIdx = (1 - aIdx) as 0 | 1;
  return countOwnPokemon(state, dIdx, pool, filterFn);
}

// ── A. 自己身上 damage counter × k（6 張） ─────────────────────────────────

// 醜醜魚｜抓狂 — 10× counter
regPre('醜醜魚|抓狂', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: n * 10 };
});

// 厄鬼椪 火灶面具ex｜憤怒之窯 — 20× counter
regPre('厄鬼椪 火灶面具ex|憤怒之窯', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: n * 20 };
});

// 鋁鋼龍｜激怒之錘 — 80 + 10× counter
regPre('鋁鋼龍|激怒之錘', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: 80 + n * 10 };
});

// 狠辣椒ex｜香料激怒 — 10 + 70× counter
regPre('狠辣椒ex|香料激怒', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: 10 + n * 70 };
});

// 巨蔓藤｜覆蓋 — 150 - 10× counter（自己身上傷害減傷，最少 0）
regPre('巨蔓藤|覆蓋', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: Math.max(0, 150 - n * 10) };
});

// 尖牙籠｜覆蓋 — 130 - 10× counter
regPre('尖牙籠|覆蓋', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  return { state, damage: Math.max(0, 130 - n * 10) };
});

// ── B. 對手戰鬥寶可夢 damage counter × k（6 張） ──────────────────────────

// 冰鬼護｜傷害律動 — 20× opp counter
regPre('冰鬼護|傷害律動', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: n * 20 };
});

// 蘋裹龍｜酸味噴吐 — 20× opp counter
regPre('蘋裹龍|酸味噴吐', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: n * 20 };
});

// 麒麟奇｜精神傷害 — 20 + 10× opp counter
regPre('麒麟奇|精神傷害', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: 20 + n * 10 };
});

// 太陽伊布｜精神傷害 — 30 + 10× opp counter
regPre('太陽伊布|精神傷害', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: 30 + n * 10 };
});

// 月月熊 赫月｜瘋狂啃咬 — 100 + 30× opp counter
regPre('月月熊 赫月|瘋狂啃咬', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: 100 + n * 30 };
});

// 猛惡菇｜爆毆 — 50 + 50× opp counter
regPre('猛惡菇|爆毆', (state, aIdx, _pool) => {
  const n = oppActiveCounters(state, aIdx);
  return { state, damage: 50 + n * 50 };
});

// ── C. 自己場上寶可夢計數（3 張） ──────────────────────────────────────────

// 土台龜ex｜森林行進 — 自己場上【草】寶可夢數 × 30
regPre('土台龜ex|森林行進', (state, aIdx, pool) => {
  const n = countOwnPokemon(state, aIdx, pool, c => c.pokemonType === 'Grass');
  return { state, damage: n * 30 };
});

// 奇麒麟｜中級轟鳴 — 自己場上【1階進化】寶可夢數 × 40
regPre('奇麒麟|中級轟鳴', (state, aIdx, pool) => {
  const n = countOwnPokemon(state, aIdx, pool, c => c.subtype === 'Stage1');
  return { state, damage: n * 40 };
});

// 投擲猴｜聯合投擲 — 自己場上【基礎】寶可夢數 × 20
regPre('投擲猴|聯合投擲', (state, aIdx, pool) => {
  const n = countOwnPokemon(state, aIdx, pool, c => c.subtype === 'Basic');
  return { state, damage: n * 20 };
});

// ── D. 其他計數類（3 張） ──────────────────────────────────────────────────

// 索羅亞克｜幻影劫持 — 對手場上 ex 數 × 60
regPre('索羅亞克|幻影劫持', (state, aIdx, pool) => {
  const n = countOppPokemon(state, aIdx, pool, c => c.subtype === 'ex');
  return { state, damage: n * 60 };
});

// 亞克諾姆｜意志強念 — 10 + 對手全場 counter 總和 × 10
regPre('亞克諾姆|意志強念', (state, aIdx, _pool) => {
  const n = oppAllCounters(state, aIdx);
  return { state, damage: 10 + n * 10 };
});

// 水晶燈火靈｜意志統治者 — 對手手牌張數 × 30
regPre('水晶燈火靈|意志統治者', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const n = state.players[dIdx].hand.length;
  return { state, damage: n * 30 };
});

// ═══════════════════════════════════════════════════════════════════════════
// Session 38i H 標第 6 波 damage-multiply 第二批（10 張）
// ═══════════════════════════════════════════════════════════════════════════

// 蒼炎刃鬼ex｜深淵熾火 — 30 + 自己棄牌區能量卡 × 20
regPre('蒼炎刃鬼ex|深淵熾火', (state, aIdx, pool) => {
  const n = state.players[aIdx].discard.filter(c => pool.get(c.cardId)?.supertype === 'Energy').length;
  return { state, damage: 30 + n * 20 };
});

// 鐵蟻ex｜復仇粉碎 — 120 + 對手已獲得獎賞 × 30
//   對手取過的獎賞 = 6 - 對手目前獎賞堆張數
regPre('鐵蟻ex|復仇粉碎', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const taken = 6 - state.players[dIdx].prizes.length;
  return { state, damage: 120 + Math.max(0, taken) * 30 };
});

// 阿利多斯｜線帶纏繞 — 10 + 對手戰鬥寶可夢撤退能量數 × 30
regPre('阿利多斯|線帶纏繞', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const retreat = def ? (pool.get(def.cardId)?.retreatCost?.length ?? 0) : 0;
  return { state, damage: 10 + retreat * 30 };
});

// 鐵包袱｜瞬風衝激 — 200 - 對手戰鬥寶可夢撤退 × 50
regPre('鐵包袱|瞬風衝激', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const retreat = def ? (pool.get(def.cardId)?.retreatCost?.length ?? 0) : 0;
  return { state, damage: Math.max(0, 200 - retreat * 50) };
});

// 鍬農炮蟲｜串聯加農炮 — 120 + 自己備戰區「蟲電寶」× 80
regPre('鍬農炮蟲|串聯加農炮', (state, aIdx, pool) => {
  const n = state.players[aIdx].bench.filter(b => b && pool.get(b.cardId)?.name === '蟲電寶').length;
  return { state, damage: 120 + n * 80 };
});

// 投羽梟｜團結之翼 — 自己棄牌區持有「團結之翼」招式的寶可夢卡 × 20
regPre('投羽梟|團結之翼', (state, aIdx, pool) => {
  const n = state.players[aIdx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.attacks?.some(a => a.name === '團結之翼');
  }).length;
  return { state, damage: n * 20 };
});

// 搖籃百合｜瘴氣之風 — 對手戰鬥寶可夢特殊狀態數 × 100
//   注意：目前引擎 status 單欄位，實際只能算 0 或 1 個狀態
regPre('搖籃百合|瘴氣之風', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const st = state.players[dIdx].active?.status;
  return { state, damage: (st ? 1 : 0) * 100 };
});

// 海豚俠｜先鋒拳 — 130，攻擊後自己再受 counter × 10 傷害
regPre('海豚俠|先鋒拳', (_state, _aIdx, _pool) => ({ state: _state, damage: 130 }));
regPost('海豚俠|先鋒拳', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  if (n === 0) return state;
  const selfDmg = n * 10;
  const s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + selfDmg } };
  });
  return addLog(s, `先鋒拳：反彈 ${selfDmg} 傷害到自己！`, aIdx);
});

// 波盪水｜蜿蜒割裂 — 在自己身上放 9 個 counter，造成 9 × 20 = 180
//   簡化：固定放 9 個（玩家/AI 的「最多」選擇）
regPre('波盪水|蜿蜒割裂', (state, aIdx, _pool) => {
  const s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + 90 } };
  });
  const s2 = addLog(s, '蜿蜒割裂：在自己身上放置 9 個傷害指示物（+90 傷害）', aIdx);
  return { state: s2, damage: 180 };
});

// 吼叫尾｜大吼大叫 — 對手 bench 1 隻 × (自己 counter × 20)
//   原文「對手的 1 隻寶可夢」，但備戰區不計弱點抵抗；簡化為只打 bench
regPost('吼叫尾|大吼大叫', (state, aIdx, _pool) => {
  const n = selfActiveCounters(state, aIdx);
  const amount = n * 20;
  if (amount === 0) return state;
  return hitBenchPickPost(state, aIdx, 'opp', 1, amount, '大吼大叫');
});

// ═══════════════════════════════════════════════════════════════════════════
// Session 38j H 標第 7 波 雜項（硬幣、混亂、抽卡、下回合減傷）27 張
// ═══════════════════════════════════════════════════════════════════════════

/** 簡易 coin flip +N helper：基礎傷害 + (正面 ? N : 0) */
function coinPlusPre(base: number, bonus: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const heads = Math.random() < 0.5;
    const s = addLog(state, `${attackName}：硬幣 ${heads ? '正面！+' + bonus + ' 傷害' : '反面'}`, aIdx);
    return { state: s, damage: base + (heads ? bonus : 0) };
  };
}

// ── A. 硬幣加傷 (7 張) ─────────────────────────────────────────────────────
regPre('啃果蟲|打滾', coinPlusPre(20, 30, '打滾'));
regPre('炙燙鱷|高溫吐息', coinPlusPre(30, 50, '高溫吐息'));
regPre('電海燕|燕返', coinPlusPre(10, 20, '燕返'));
regPre('銅鏡怪|盾牌攻擊', coinPlusPre(20, 20, '盾牌攻擊'));
regPre('一對鼠|嬉鬧', coinPlusPre(10, 10, '嬉鬧'));
regPre('普隆隆姆|擊飛', coinPlusPre(90, 90, '擊飛'));

// 貓鼠斬｜連斬 — 擲 3 次硬幣，1 正 +20 / 2 正 +50 / 3 正 +80
regPre('貓鼠斬|連斬', (state, aIdx, _pool) => {
  let heads = 0;
  for (let i = 0; i < 3; i++) if (Math.random() < 0.5) heads++;
  const bonus = heads === 3 ? 80 : heads === 2 ? 50 : heads === 1 ? 20 : 0;
  const s = addLog(state, `連斬：擲 3 次硬幣正面 ${heads} 次（+${bonus} 傷害）`, aIdx);
  return { state: s, damage: 10 + bonus };
});

// ── B. 將對手混亂（regPost statusPost('confused')）6 張 ──────────────────
regPost('仙子伊布|魅惑之聲', statusPost('confused'));
regPost('麻花犬ex|奇跡閃耀', statusPost('confused'));
regPost('卡璞・蝶蝶|蠱惑', statusPost('confused'));
regPost('青綿鳥|魅惑之聲', statusPost('confused'));
regPost('月亮伊布ex|月亮幻想', statusPost('confused'));
regPost('電燈怪|錯亂閃光', statusPost('confused')); // 「8 個 counter」細節先不實作

// ── C. 將自己混亂 2 張 ─────────────────────────────────────────────────────
function selfConfusePost(): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, status: 'confused' };
    players[aIdx] = att;
    return addLog({ ...state, players }, `自身陷入【混亂】`, aIdx);
  };
}
regPost('流氓熊貓|暴走', selfConfusePost());
regPost('棄世猴|暴走', selfConfusePost());

// ── D. 抽卡類 7 張 ─────────────────────────────────────────────────────────
function drawNPost(n: number, attackName: string): AttackPostFn {
  return (state, aIdx) => {
    let s = addLog(state, `${attackName}：從牌庫抽 ${n} 張`, aIdx);
    return updatePlayer(s, aIdx, p => {
      const take = Math.min(n, p.deck.length);
      return { ...p, hand: [...p.hand, ...p.deck.slice(0, take)], deck: p.deck.slice(take) };
    });
  };
}
regPost('摩托蜥ex|鋯石之路', drawNPost(5, '鋯石之路'));
regPost('蟲滾泥|呼喚', drawNPost(1, '呼喚'));
regPost('蟲甲聖|三重抽出', drawNPost(3, '三重抽出'));
regPost('斑斑馬|叼', drawNPost(1, '叼'));
regPost('金魚王|快速抽出', drawNPost(2, '快速抽出'));
regPost('時拉比|呼喚', drawNPost(1, '呼喚'));

// 鑰圈兒｜插入抽出 — 丟 1 張手牌後抽 2 張（簡化：丟隨機 1 張）
regPost('鑰圈兒|插入抽出', (state, aIdx, _pool) => {
  let s = addLog(state, '插入抽出：丟 1 張手牌、抽 2 張', aIdx);
  return updatePlayer(s, aIdx, p => {
    if (p.hand.length === 0) {
      const take = Math.min(2, p.deck.length);
      return { ...p, hand: [...p.hand, ...p.deck.slice(0, take)], deck: p.deck.slice(take) };
    }
    const discardIdx = Math.floor(Math.random() * p.hand.length);
    const discarded = p.hand[discardIdx];
    const newHand = p.hand.filter((_, i) => i !== discardIdx);
    const take = Math.min(2, p.deck.length);
    return {
      ...p,
      hand: [...newHand, ...p.deck.slice(0, take)],
      deck: p.deck.slice(take),
      discard: [...p.discard, discarded],
    };
  });
});

// ── E. 自己下回合受招式傷害 -N 4 張 ───────────────────────────────────────
regPost('龍捲雲|暴風障壁', selfDmgReducePost(50));
regPost('盔甲鳥|鋼翼', selfDmgReducePost(30));
regPost('振翼髮|月亮之力', selfDmgReducePost(30));
regPost('仙子伊布ex|魔法魅惑', selfDmgReducePost(100));

// ── F. 丟對手隨機 1 張手牌 2 張 ───────────────────────────────────────────
function oppDiscardRandomHand(n: number, attackName: string): AttackPostFn {
  return (state, aIdx) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    let s = addLog(state, `${attackName}：丟棄對手手牌 ${n} 張`, aIdx);
    return updatePlayer(s, dIdx, p => {
      const pickCount = Math.min(n, p.hand.length);
      if (pickCount === 0) return p;
      let hand = [...p.hand];
      const discarded: CardInstance[] = [];
      for (let i = 0; i < pickCount; i++) {
        const idx = Math.floor(Math.random() * hand.length);
        discarded.push(hand[idx]);
        hand = hand.filter((_, j) => j !== idx);
      }
      return { ...p, hand, discard: [...p.discard, ...discarded] };
    });
  };
}
regPost('功夫鼬|拍落', oppDiscardRandomHand(1, '拍落'));
regPost('太陽伊布ex|精神出局', oppDiscardRandomHand(1, '精神出局'));

// 巨牙鯊｜咬棄 — 擲 3 次硬幣，丟對手正面數量的手牌（不看正面）
regPost('巨牙鯊|咬棄', (state, aIdx, _pool) => {
  let heads = 0;
  for (let i = 0; i < 3; i++) if (Math.random() < 0.5) heads++;
  const s = addLog(state, `咬棄：擲 3 次硬幣正面 ${heads} 次，丟對手 ${heads} 張手牌`, aIdx);
  return oppDiscardRandomHand(heads, '咬棄')(s, aIdx, new Map());
});

// 鐵螯龍蝦｜喀嚓喀嚓 — 擲 2 次硬幣，對手牌庫上方正面數的牌丟棄
regPost('鐵螯龍蝦|喀嚓喀嚓', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let heads = 0;
  for (let i = 0; i < 2; i++) if (Math.random() < 0.5) heads++;
  let s = addLog(state, `喀嚓喀嚓：擲 2 次硬幣正面 ${heads} 次，丟對手牌庫頂 ${heads} 張`, aIdx);
  return updatePlayer(s, dIdx, p => {
    const take = Math.min(heads, p.deck.length);
    if (take === 0) return p;
    const discarded = p.deck.slice(0, take);
    return { ...p, deck: p.deck.slice(take), discard: [...p.discard, ...discarded] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38l v1.62 H 標第 7 波 — debuff-target 大批次（40+ 張）
// 機制:
//   (a) 對手下回合無法撤退（cantRetreatNextTurn；engine v1.62 加 RETREAT 檢查 + END_TURN 清除）
//   (b) 自己下回合無法使用招式（既有 selfCantAttackNextPost）
//   (c) 對手下回合無法使用招式（既有 defCantAttackNextPost）
//   (d) 上個對手回合被取走獎賞則傷害 +N（既有 oppPrizesAtMyLastTurnEnd 快照）
//   複合招式（中毒+不撤退、灼傷+不撤退、擲硬幣+自不攻）用 inline 組合
//
// 已知簡化：
//   - 「指定招式名無法使用」（如「閃焰強襲」）統一視為「全部招式無法使用」
//   - 「無法從手牌使出能量/物品/支援者」機制延後（含晶光花、電蜘蛛ex、含羞苞、吼叫尾ex、青銅鐘）
//   - 「自己所有寶可夢下回合都無法攻擊」（電擊魔獸｜雷電在地）延後（需 player-level flag）
//   - 「僅基礎寶可夢/進化寶可夢無法攻擊」（帕底亞肯泰羅、鐵包袱）延後（需 pokemon-filter flag）
//   - 「本次自願 +100 點並下回合不攻擊」（大王銅象｜鼻之金勾臂）延後（需 optional-choice UI）
//   - 懶人獺｜悠哉「這隻寶可夢下回合無法撤退」簡化為僅 heal 60（self-cantRetreat 需 pending flag）
// ══════════════════════════════════════════════════════════════════════════════

// ── 輔助：對手戰鬥寶可夢下回合無法撤退（cantRetreatNextTurn）────────────────
function defCantRetreatNextPost(): AttackPostFn {
  return (state, aIdx) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, cantRetreatNextTurn: true };
    players[dIdx] = def;
    return addLog({ ...state, players }, `對手下次回合無法撤退`, aIdx);
  };
}

// ── A. 對手受招後下回合無法撤退（14 張）────────────────────────────────────
regPost('羅絲雷朵|束縛', defCantRetreatNextPost());
regPost('小鋸鱷|咬緊', defCantRetreatNextPost());
regPost('三海地鼠ex|麻痺控制', defCantRetreatNextPost());
regPost('厄鬼椪 水井面具ex|啜泣', defCantRetreatNextPost());
regPost('勒克貓|咬緊', defCantRetreatNextPost());
regPost('大狼犬|窮追不捨', defCantRetreatNextPost());
regPost('狃拉|逼近', defCantRetreatNextPost());
regPost('黑夜魔靈|影子束縛', defCantRetreatNextPost());
regPost('觸手百合|束縛', defCantRetreatNextPost());
regPost('拖拖蚓ex|岩石封鎖', defCantRetreatNextPost());
regPost('磨牙彩皮魚|咬緊', defCantRetreatNextPost());
regPost('噬沙堡爺ex|流沙地獄', defCantRetreatNextPost());

// 爆焰龜獸｜火焰陣 — 灼傷 + 對手下回合無法撤退
regPost('爆焰龜獸|火焰陣', (state, aIdx, pool) => {
  const s1 = statusPost('burned')(state, aIdx, pool);
  return defCantRetreatNextPost()(s1, aIdx, pool);
});

// 車輪毬｜毒陣 — 中毒 + 對手下回合無法撤退
regPost('車輪毬|毒陣', (state, aIdx, pool) => {
  const s1 = statusPost('poisoned')(state, aIdx, pool);
  return defCantRetreatNextPost()(s1, aIdx, pool);
});

// 桃歹郎｜猛毒連鎖 — 中毒 + 對手下回合無法撤退（非 ex 版本）
regPost('桃歹郎|猛毒連鎖', (state, aIdx, pool) => {
  const s1 = statusPost('poisoned')(state, aIdx, pool);
  return defCantRetreatNextPost()(s1, aIdx, pool);
});

// ── B. 自己下回合無法使用招式（指定招式名統一視為全招式）────────────────
regPost('炎熱喵|閃焰強襲', selfCantAttackNextPost());
regPost('咕咕鴿|噴射之翼', selfCantAttackNextPost());
regPost('高傲雉雞|潛力', selfCantAttackNextPost());
regPost('鐵螯龍蝦|暴亂之錘', selfCantAttackNextPost());
regPost('月月熊 赫月 ex|血月', selfCantAttackNextPost());
regPost('月月熊 赫月ex|血月', selfCantAttackNextPost());  // 兼容去空格寫法
regPost('波普海豚|水流斬', selfCantAttackNextPost());
regPost('海豚俠ex|終極衝擊', selfCantAttackNextPost());
regPost('吉利蛋|潛力', selfCantAttackNextPost());
regPost('大嘴蝠|漆黑利刃', selfCantAttackNextPost());
regPost('願增猿ex|惡劣頭擊', selfCantAttackNextPost());
regPost('閃焰王牌ex|閃焰強襲', selfCantAttackNextPost());
regPost('好勝毛蟹|揮大拳', selfCantAttackNextPost());
regPost('電燈怪|閃電伏特', selfCantAttackNextPost());
regPost('鋁鋼橋龍|鐵之引爆', selfCantAttackNextPost());
regPost('爆炸頭水牛|潛力', selfCantAttackNextPost());
regPost('蒼炎刃鬼|黑煙斬', selfCantAttackNextPost());
regPost('自爆磁怪|電磁炮', selfCantAttackNextPost());
regPost('火伊布ex|紅玉髓', selfCantAttackNextPost());
regPost('鐵毒蛾|高熱光線', selfCantAttackNextPost());
regPost('水伊布ex|海藍寶石', selfCantAttackNextPost());
regPost('雷伊布ex|棕碧璽', selfCantAttackNextPost());
regPost('鐵武者ex|鐳射利刃', selfCantAttackNextPost());
regPost('沙鐵皮ex|大地扣殺', selfCantAttackNextPost());
regPost('月亮伊布|漆黑利刃', selfCantAttackNextPost());
regPost('猛惡菇|暴亂之錘', selfCantAttackNextPost());
regPost('雙劍鞘|猛擊在地', selfCantAttackNextPost());

// 朝北鼻｜力量猛攻 — 擲 1 次硬幣反面，自己下回合無法使用招式（60 dmg baseline）
regPost('朝北鼻|力量猛攻', (state, aIdx, pool) => {
  const tails = Math.random() >= 0.5;
  if (!tails) return state;
  const s = addLog(state, `力量猛攻：擲 1 次硬幣反面，自己下個回合無法使用招式`, aIdx);
  return selfCantAttackNextPost()(s, aIdx, pool);
});

// ── C. 對手受招後下回合無法使用招式 ─────────────────────────────────────────
regPost('豐蜜龍|甜蜜熔化', defCantAttackNextPost());

// ── D. 上個對手回合被取走獎賞則傷害 +N（revenge-dmg-plus）───────────────────
// 鐵斑葉｜復仇刀鋒 100+60
regPre('鐵斑葉|復仇刀鋒', (state, aIdx, _pool) => {
  const snap = state.oppPrizesAtMyLastTurnEnd?.[aIdx] ?? 6;
  const oppIdx = (1 - aIdx) as 0 | 1;
  const tookPrize = state.players[oppIdx].prizes.length < snap;
  const bonus = tookPrize ? 60 : 0;
  const s = tookPrize
    ? addLog(state, `復仇刀鋒：上個對手回合取過獎賞 → +60 傷害`, aIdx)
    : state;
  return { state: s, damage: 100 + bonus };
});
// 普隆隆姆｜捲土重來 30+90
regPre('普隆隆姆|捲土重來', (state, aIdx, _pool) => {
  const snap = state.oppPrizesAtMyLastTurnEnd?.[aIdx] ?? 6;
  const oppIdx = (1 - aIdx) as 0 | 1;
  const tookPrize = state.players[oppIdx].prizes.length < snap;
  const bonus = tookPrize ? 90 : 0;
  const s = tookPrize
    ? addLog(state, `捲土重來：上個對手回合取過獎賞 → +90 傷害`, aIdx)
    : state;
  return { state: s, damage: 30 + bonus };
});
// 古玉魚｜嫉妒業火 50+90
regPre('古玉魚|嫉妒業火', (state, aIdx, _pool) => {
  const snap = state.oppPrizesAtMyLastTurnEnd?.[aIdx] ?? 6;
  const oppIdx = (1 - aIdx) as 0 | 1;
  const tookPrize = state.players[oppIdx].prizes.length < snap;
  const bonus = tookPrize ? 90 : 0;
  const s = tookPrize
    ? addLog(state, `嫉妒業火：上個對手回合取過獎賞 → +90 傷害`, aIdx)
    : state;
  return { state: s, damage: 50 + bonus };
});

// ── E. 懶人獺｜悠哉 — heal 60（自己下回合不撤退部分延後實裝）────────────────
regPost('懶人獺|悠哉', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) {
    const newDmg = Math.max(0, att.active.damage - 60);
    att.active = { ...att.active, damage: newDmg };
  }
  players[aIdx] = att;
  return addLog({ ...state, players }, `悠哉：恢復 60 HP`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38m v1.63 H 標第 8 波 — coin-heads-multiply 批次（24 張）
// 擲 N 次硬幣，正面出現次數 × k 點傷害。
// ══════════════════════════════════════════════════════════════════════════════

function coinHeadsMultiplyPre(flips: number, perHead: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let heads = 0;
    for (let i = 0; i < flips; i++) if (Math.random() < 0.5) heads++;
    const dmg = heads * perHead;
    const s = addLog(state, `${attackName}：擲 ${flips} 次硬幣正面 ${heads} 次 → ${dmg} 傷害`, aIdx);
    return { state: s, damage: dmg };
  };
}

regPre('木棉球|三重旋轉', coinHeadsMultiplyPre(3, 10, '三重旋轉'));
regPre('海豚俠|二連擊', coinHeadsMultiplyPre(2, 90, '二連擊'));
regPre('雙卵細胞球|雙重戲法', coinHeadsMultiplyPre(2, 30, '雙重戲法'));
regPre('長鼻葉|連出巴掌', coinHeadsMultiplyPre(3, 30, '連出巴掌'));
regPre('蘑蘑菇|二連頭錘', coinHeadsMultiplyPre(2, 10, '二連頭錘'));
regPre('佛烈托斯|尖刺加農炮', coinHeadsMultiplyPre(3, 30, '尖刺加農炮'));
regPre('大舌舔|舔舔颶風', coinHeadsMultiplyPre(4, 70, '舔舔颶風'));
regPre('向日種子|種子機關槍', coinHeadsMultiplyPre(4, 10, '種子機關槍'));
regPre('蚊香蝌蚪|擺尾拍打', coinHeadsMultiplyPre(2, 20, '擺尾拍打'));
regPre('蚊香君|連環巴掌', coinHeadsMultiplyPre(2, 30, '連環巴掌'));
regPre('穿山鼠|雙重抓', coinHeadsMultiplyPre(2, 20, '雙重抓'));
regPre('索羅亞|雙重抓', coinHeadsMultiplyPre(2, 20, '雙重抓'));
regPre('喵喵|亂抓', coinHeadsMultiplyPre(3, 20, '亂抓'));
regPre('貓老大|亂抓', coinHeadsMultiplyPre(3, 50, '亂抓'));
regPre('幼棉棉|雙重旋轉', coinHeadsMultiplyPre(2, 10, '雙重旋轉'));
regPre('燈籠魚|雙重伏特', coinHeadsMultiplyPre(2, 20, '雙重伏特'));
regPre('咕咕|三次撞', coinHeadsMultiplyPre(3, 10, '三次撞'));
regPre('爆香猿|雙重粉碎', coinHeadsMultiplyPre(2, 70, '雙重粉碎'));
regPre('猴怪|二連劈', coinHeadsMultiplyPre(2, 10, '二連劈'));
regPre('青銅鐘|雙重衝擊', coinHeadsMultiplyPre(2, 100, '雙重衝擊'));
regPre('一家鼠|連續門牙', coinHeadsMultiplyPre(4, 30, '連續門牙'));
regPre('三海地鼠|三連鞭', coinHeadsMultiplyPre(3, 70, '三連鞭'));
regPre('天然雀|三連撞', coinHeadsMultiplyPre(3, 10, '三連撞'));
regPre('袋獸|迷昏拳', coinHeadsMultiplyPre(2, 90, '迷昏拳'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38n v1.64 H 標第 9 波 — coin 混合三類（16 張）
// (A) coin-tails-fail：擲反面 → 招式失敗（damage=0）
// (B) coin-heads-immune-next：正面 → 下回合免疫（damageReduceNextHit=9999）
// (C) coin-until-tails-multiply：擲到反面為止，正面數 × k
// ══════════════════════════════════════════════════════════════════════════════

// ── (A) coin-tails-fail helper + 4 張 ─────────────────────────────────────
function coinTailsFailPre(base: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const heads = Math.random() < 0.5;
    if (!heads) {
      return { state: addLog(state, `${attackName}：擲硬幣反面 → 招式失敗`, aIdx), damage: 0 };
    }
    return { state: addLog(state, `${attackName}：擲硬幣正面 → ${base} 傷害`, aIdx), damage: base };
  };
}
regPre('單卵細胞球|偷襲', coinTailsFailPre(30, '偷襲'));
regPre('斯魔茶|偷襲', coinTailsFailPre(30, '偷襲'));
regPre('搬運小匠|全力拳', coinTailsFailPre(40, '全力拳'));
regPre('阿羅拉 地鼠|偷襲', coinTailsFailPre(30, '偷襲'));

// ── (B) coin-heads-immune-next helper + 7 張 ──────────────────────────────
// 擲 1 次硬幣若正面，則在下個對手的回合，這隻寶可夢不會受到招式的傷害（簡化：
// damageReduceNextHit = 9999，實質免疫傷害；「效果不受影響」部分暫未處理）
function coinHeadsSelfImmuneNextPost(attackName: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const heads = Math.random() < 0.5;
    if (!heads) return addLog(state, `${attackName}：擲硬幣反面 → 無追加效果`, aIdx);
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, damageReduceNextHit: 9999 };
    players[aIdx] = att;
    return addLog({ ...state, players }, `${attackName}：擲硬幣正面 → 下回合免疫招式傷害`, aIdx);
  };
}
regPost('泥偶小人|鐵壁', coinHeadsSelfImmuneNextPost('鐵壁'));
regPost('泥偶巨人|鐵壁', coinHeadsSelfImmuneNextPost('鐵壁'));
regPost('土龍弟弟|挖洞', coinHeadsSelfImmuneNextPost('挖洞'));
regPost('電電蟲|躍起閃避', coinHeadsSelfImmuneNextPost('躍起閃避'));
regPost('東施喵|喵打滾', coinHeadsSelfImmuneNextPost('喵打滾'));
regPost('飄飄雛|躍起閃避', coinHeadsSelfImmuneNextPost('躍起閃避'));
regPost('七夕青鳥|棉花之翼', coinHeadsSelfImmuneNextPost('棉花之翼'));

// ── (C) coin-until-tails-multiply helper + 5 張 ───────────────────────────
function coinUntilTailsMultiplyPre(perHead: number, base: number, attackName: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let heads = 0;
    // 安全上限 20 次防無限迴圈（理論概率近 0，但保護）
    for (let i = 0; i < 20; i++) {
      if (Math.random() < 0.5) heads++;
      else break;
    }
    const dmg = base + heads * perHead;
    const s = addLog(state, `${attackName}：擲到反面前正面 ${heads} 次 → ${dmg} 傷害`, aIdx);
    return { state: s, damage: dmg };
  };
}
regPre('瑪力露|滾球', coinUntilTailsMultiplyPre(10, 0, '滾球'));
regPre('土狼犬|連續舞步', coinUntilTailsMultiplyPre(10, 0, '連續舞步'));
regPre('普隆隆姆|奔進', coinUntilTailsMultiplyPre(100, 0, '奔進'));
regPre('燈罩夜菇|螺旋衝刺', coinUntilTailsMultiplyPre(30, 60, '螺旋衝刺'));
regPre('索財靈|連續擲幣', coinUntilTailsMultiplyPre(20, 0, '連續擲幣'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38o v1.65 H 標第 10 波 — self-heal 招式（22 張）
// 招式造成傷害後，將自己（戰鬥寶可夢）恢復 N HP。
// ══════════════════════════════════════════════════════════════════════════════

function selfHealPost(amount: number, attackName: string): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (!att.active) return state;
    const before = att.active.damage;
    const healed = Math.min(before, amount);
    if (healed === 0) return state;
    att.active = { ...att.active, damage: before - healed };
    players[aIdx] = att;
    return addLog({ ...state, players }, `${attackName}：恢復 ${healed} HP`, aIdx);
  };
}

regPost('土台龜ex|叢林之錘', selfHealPost(50, '叢林之錘'));
regPost('萌虻|小吸取', selfHealPost(10, '小吸取'));
regPost('波盪水|極光增輝', selfHealPost(20, '極光增輝'));
regPost('向日花怪|超級吸取', selfHealPost(30, '超級吸取'));
regPost('小木靈|寄生種子', selfHealPost(20, '寄生種子'));
regPost('墨海馬|紋絲不動', selfHealPost(30, '紋絲不動'));
regPost('尖牙籠|偷食', selfHealPost(40, '偷食'));
regPost('瑪沙那|冥想', selfHealPost(20, '冥想'));
regPost('薩戮德|綠葉吸取', selfHealPost(20, '綠葉吸取'));
regPost('走鯨|吸取鰭', selfHealPost(20, '吸取鰭'));
regPost('超能豔鴕|螺旋吸取', selfHealPost(30, '螺旋吸取'));
regPost('蛋蛋|吸取', selfHealPost(10, '吸取'));
regPost('波克基古|吸取之吻', selfHealPost(30, '吸取之吻'));
regPost('水伊布|螺旋吸取', selfHealPost(30, '螺旋吸取'));
regPost('蒼炎刃鬼|生命之紗', selfHealPost(30, '生命之紗'));
regPost('新葉喵ex|魔法葉', selfHealPost(30, '魔法葉'));
regPost('陸地水母|超級吸取', selfHealPost(30, '超級吸取'));

// ── 對自己所有寶可夢（含戰鬥+備戰）各恢復 N HP ─────────────────────────────
function healAllOwnPost(amount: number, benchOnly: boolean, attackName: string): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    let totalHealed = 0;
    if (!benchOnly && p.active) {
      const healed = Math.min(p.active.damage, amount);
      if (healed > 0) {
        p.active = { ...p.active, damage: p.active.damage - healed };
        totalHealed += healed;
      }
    }
    p.bench = p.bench.map(c => {
      const healed = Math.min(c.damage, amount);
      if (healed > 0) { totalHealed += healed; return { ...c, damage: c.damage - healed }; }
      return c;
    });
    players[aIdx] = p;
    if (totalHealed === 0) return state;
    const target = benchOnly ? '所有備戰' : '所有自己寶可夢';
    return addLog({ ...state, players }, `${attackName}：${target}各恢復 ${amount} HP（累計 ${totalHealed}）`, aIdx);
  };
}
regPost('來悲粗茶ex|抹茶飛濺', healAllOwnPost(30, false, '抹茶飛濺'));
regPost('克雷色利亞|治癒之舞', healAllOwnPost(20, false, '治癒之舞'));
regPost('葉伊布ex|苔紋瑪瑙', healAllOwnPost(100, true, '苔紋瑪瑙'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38p v1.66 H 標第 11 波 — 條件式增傷（20+ 張）
// 均為 regPre 判斷條件，若符合則 base + bonus，否則 base。
// ══════════════════════════════════════════════════════════════════════════════

function isExCard(c: Card | undefined): boolean {
  if (!c) return false;
  // PTCG ex / V 都可 KO 取 2 張；簡化：名字結尾 ex 或 EX
  return c.name.endsWith('ex') || c.name.endsWith('EX');
}
function isEvolvedCard(c: Card | undefined): boolean {
  return c?.subtype === 'Stage1' || c?.subtype === 'Stage2';
}

// 若對手戰鬥寶可夢處於特殊狀態 → +120
regPre('波盪水ex|宣洩吼嘯', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const hasStatus = !!state.players[dIdx].active?.status;
  return { state, damage: 120 + (hasStatus ? 120 : 0) };
});

// 若對手戰鬥寶可夢為 ex/V → +N（多張）
function defIsExPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const card = def ? pool.get(def.cardId) : undefined;
    if (isExCard(card)) {
      return { state: addLog(state, `${label}：對手為 ex/V → +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('泥偶巨人|鬥志之拳', defIsExPre(120, 120, '鬥志之拳'));
regPre('舞天鵝|鬥志之翼', defIsExPre(20, 90, '鬥志之翼'));
regPre('電蜘蛛ex|衝天之線', defIsExPre(110, 110, '衝天之線'));
regPre('火伊布|鬥志猛火', defIsExPre(90, 90, '鬥志猛火'));
regPre('水伊布|鬥志潮旋', defIsExPre(90, 90, '鬥志潮旋'));
regPre('雷伊布|鬥志雷霆', defIsExPre(90, 90, '鬥志雷霆'));
regPre('蒼炎刃鬼|鬥士的巨劍', defIsExPre(100, 100, '鬥士的巨劍'));
regPre('無極汰那|汰那爆破', defIsExPre(10, 80, '汰那爆破'));

// 若對手戰鬥寶可夢為進化寶可夢 → +N
function defIsEvolvedPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const card = def ? pool.get(def.cardId) : undefined;
    if (isEvolvedCard(card)) {
      return { state: addLog(state, `${label}：對手為進化寶可夢 → +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('毒骷蛙|俐落一擊', defIsEvolvedPre(90, 90, '俐落一擊'));
regPre('肯泰羅|俐落一擊', defIsEvolvedPre(50, 50, '俐落一擊'));

// 若對手戰鬥寶可夢為【1階進化】→ +90
regPre('帕底亞 肯泰羅|真氣衝撞', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const card = def ? pool.get(def.cardId) : undefined;
  if (card?.subtype === 'Stage1') {
    return { state: addLog(state, '真氣衝撞：對手為 1 階進化 → +90', aIdx), damage: 180 };
  }
  return { state, damage: 90 };
});

// 若對手戰鬥寶可夢為【超】→ +30
regPre('銅鏡怪|鏡面攻擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const card = def ? pool.get(def.cardId) : undefined;
  if (card?.pokemonType === 'Psychic') {
    return { state: addLog(state, '鏡面攻擊：對手為【超】→ +30', aIdx), damage: 40 };
  }
  return { state, damage: 10 };
});

// 若對手戰鬥寶可夢身上放置有傷害指示物 → +80
regPre('暴噬龜|堅硬嚼碎', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (def && def.damage > 0) {
    return { state: addLog(state, '堅硬嚼碎：對手帶傷 → +80', aIdx), damage: 160 };
  }
  return { state, damage: 80 };
});

// 若對手戰鬥寶可夢【撤退】所需的能量為2個以上 → +110
regPre('烈箭鷹|氣旋競爭', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const card = def ? pool.get(def.cardId) : undefined;
  const retreat = card?.retreatCost?.length ?? 0;
  if (retreat >= 2) {
    return { state: addLog(state, `氣旋競爭：對手撤退 ${retreat} ≥ 2 → +110`, aIdx), damage: 220 };
  }
  return { state, damage: 110 };
});

// 若自己備戰區有【鋼】寶可夢 → +80
function selfBenchHasTypePre(base: number, bonus: number, ptype: EnergyType, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const has = state.players[aIdx].bench.some(b => pool.get(b.cardId)?.pokemonType === ptype);
    if (has) {
      return { state: addLog(state, `${label}：備戰區有【${ptype}】→ +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('破破舵輪|鋼鐵船錨', selfBenchHasTypePre(80, 80, 'Metal', '鋼鐵船錨'));
regPre('龍頭地鼠|鑽粉碎', selfBenchHasTypePre(60, 80, 'Metal', '鑽粉碎'));

// 若對手場上有【水】寶可夢 → +120
regPre('電擊魔獸|漏電關節', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  const has = [d.active, ...d.bench].some(c => c && pool.get(c.cardId)?.pokemonType === 'Water');
  if (has) {
    return { state: addLog(state, '漏電關節：對手場上有【水】→ +120', aIdx), damage: 160 };
  }
  return { state, damage: 40 };
});

// 若自己備戰區有名為 X 的寶可夢 → +N
function selfBenchHasNamePre(base: number, bonus: number, targetName: string, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const has = state.players[aIdx].bench.some(b => pool.get(b.cardId)?.name === targetName);
    if (has) {
      return { state: addLog(state, `${label}：備戰區有「${targetName}」→ +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('大狼犬|群起打獵', selfBenchHasNamePre(30, 90, '大狼犬', '群起打獵'));
regPre('電螢蟲|聯合攻擊', selfBenchHasNamePre(20, 60, '甜甜螢', '聯合攻擊'));

// 若對手戰鬥寶可夢身上附有寶可夢道具 → +80
regPre('大朝北鼻|進擊鐳射', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (def?.toolAttached) {
    return { state: addLog(state, '進擊鐳射：對手附有道具 → +80', aIdx), damage: 160 };
  }
  return { state, damage: 80 };
});

// 若自己剩餘獎賞卡張數 > 對手 → +90（獎賞反擊）
function selfPrizesMorePre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const diff = state.players[aIdx].prizes.length - state.players[dIdx].prizes.length;
    if (diff > 0) {
      return { state: addLog(state, `${label}：獎賞較多 → +${bonus}`, aIdx), damage: base + bonus };
    }
    return { state, damage: base };
  };
}
regPre('摔角鷹人|獎賞反擊', selfPrizesMorePre(50, 90, '獎賞反擊'));
regPre('卡璞・鳴鳴|獎賞反擊', selfPrizesMorePre(90, 90, '獎賞反擊'));

// 若對手剩餘獎賞卡張數 ≤ 4 → +70
regPre('破空焰|爆燃突擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].prizes.length <= 4) {
    return { state: addLog(state, '爆燃突擊：對手獎賞 ≤4 → +70', aIdx), damage: 170 };
  }
  return { state, damage: 100 };
});

// 若自己牌庫剩餘 ≤ 3 → +200
regPre('蟲甲聖|絕地反攻', (state, aIdx, _pool) => {
  if (state.players[aIdx].deck.length <= 3) {
    return { state: addLog(state, '絕地反攻：牌庫 ≤3 → +200', aIdx), damage: 240 };
  }
  return { state, damage: 40 };
});

// 若對手手牌 ≤ 5 → +60
regPre('師父鼬|疾風迴旋', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].hand.length <= 5) {
    return { state: addLog(state, '疾風迴旋：對手手牌 ≤5 → +60', aIdx), damage: 90 };
  }
  return { state, damage: 30 };
});

// 若這隻寶可夢身上附有【雷】能量卡 → +80
regPre('電蜘蛛|麻麻羅網', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 50 };
  const has = att.energyAttached.some(e => pool.get(e.cardId)?.pokemonType === 'Lightning');
  if (has) {
    return { state: addLog(state, '麻麻羅網：附有【雷】能量 → +80', aIdx), damage: 130 };
  }
  return { state, damage: 50 };
});

// 若自己場上的【惡】能量有 3 個以上 → +50
regPre('阿勃梭魯|惡棍墜落', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let count = 0;
  for (const c of [p.active, ...p.bench]) {
    if (!c) continue;
    for (const e of c.energyAttached) {
      if (pool.get(e.cardId)?.pokemonType === 'Darkness') count++;
    }
  }
  if (count >= 3) {
    return { state: addLog(state, `惡棍墜落：【惡】能量 ${count} ≥3 → +50`, aIdx), damage: 70 };
  }
  return { state, damage: 20 };
});

// 若場上有競技場卡 → +60，並丟棄那張競技場卡
regPre('古玉魚|大地熔化', (state, aIdx, _pool) => {
  if (state.activeStadium) {
    return { state: addLog(state, '大地熔化：場上有競技場 → +60', aIdx), damage: 120 };
  }
  return { state, damage: 60 };
});
regPost('古玉魚|大地熔化', (state, aIdx, _pool) => {
  if (!state.activeStadium) return state;
  const stadium = state.activeStadium;
  // 丟到擁有者的棄牌區：以卡 iid 判斷是哪邊打的；若無法判斷則丟到施術方
  // 這裡簡化：嘗試找出擁有者（其中 1 方的 discard 裡有沒有等等，這卡是場上唯一，無法從狀態直接得知擁有者）
  // 傳統作法：engine 有 stadiumOwnerIdx 欄位，這裡沒有，故簡化為丟到 activeStadium 清除+施術方棄牌
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...players[aIdx], discard: [...players[aIdx].discard, stadium] };
  return addLog({ ...state, players, activeStadium: undefined }, '大地熔化：丟棄競技場', aIdx);
});

// 若希望，將場上的競技場卡丟棄 → +120（只在有競技場時才生效）
regPre('轟鳴月ex|災厄風暴', (state, aIdx, _pool) => {
  if (state.activeStadium) {
    return { state: addLog(state, '災厄風暴：丟棄競技場 → +120', aIdx), damage: 220 };
  }
  return { state, damage: 100 };
});
regPost('轟鳴月ex|災厄風暴', (state, aIdx, _pool) => {
  if (!state.activeStadium) return state;
  const stadium = state.activeStadium;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...players[aIdx], discard: [...players[aIdx].discard, stadium] };
  return { ...state, players, activeStadium: undefined };
});

// 眷戀雲｜愛之同感：若自己場上有與對手場上寶可夢相同屬性的寶可夢 → +120
regPre('眷戀雲|愛之同感', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const a = state.players[aIdx], d = state.players[dIdx];
  const oppTypes = new Set<string>();
  for (const c of [d.active, ...d.bench]) {
    if (!c) continue;
    const t = pool.get(c.cardId)?.pokemonType;
    if (t) oppTypes.add(t);
  }
  const match = [a.active, ...a.bench].some(c => {
    if (!c) return false;
    const t = pool.get(c.cardId)?.pokemonType;
    return t ? oppTypes.has(t) : false;
  });
  if (match) {
    return { state: addLog(state, '愛之同感：同屬性在場 → +120', aIdx), damage: 200 };
  }
  return { state, damage: 80 };
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38q v1.67 H 標第 12 波 — other-bucket 簡單機制（8 張）
//   (a) 對手牌庫頂丟棄 N 張 — 巨炭山|山崩、雄偉牙|地盤崩壞
//   (b) 對手出場已灼傷才生效 — 焚焰蚣|焦黑吐息
//   (c) 攻擊 + 自身施加狀態 — 熔岩蟲|熾熱熔岩（既有 statusPost）
//   (d) 簡化：忽略特殊修正，當純傷害 — 故勒頓|撕裂
//   (e) 自身中毒則增傷 — 夠讚狗ex|瘋狂連鎖
//   (f) 攻擊 + 抽 N 張 — 貓頭夜鷹|鉤爪搜尋（簡化：固定抽，不開搜尋 UI）
//   (g) 對對手任一寶可夢造成傷害 — 皮卡丘|電磁電光（10 傷害，opp-poke-choose）
//
// 已知簡化：
//   - 地盤崩壞「古代支援者」附加 +3 張略（engine 未追蹤 supporter 類別）
//   - 撕裂「不計算身上附加效果」略（engine 未實作弱點/抵抗修正）
//   - 鉤爪搜尋簡化為抽 2 張（正式為從牌庫任選最多 2 張）
// ══════════════════════════════════════════════════════════════════════════════

// 巨炭山|山崩 — 150 + 對手牌庫頂 2 張丟棄
regPost('巨炭山|山崩', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  const take = Math.min(2, p.deck.length);
  if (take === 0) return state;
  const discarded = p.deck.slice(0, take);
  const s = addLog(state, `山崩：丟對手牌庫頂 ${take} 張`, aIdx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl, deck: pl.deck.slice(take), discard: [...pl.discard, ...discarded]
  }));
});

// 雄偉牙|地盤崩壞 — 基礎無傷害，丟對手牌庫頂 1 張（古代支援者條件簡化略）
// 注意：本招式 damage 欄為空（無傷害），但需觸發牌庫丟棄
regPre('雄偉牙|地盤崩壞', (state, aIdx, _pool) => {
  return { state, damage: 0 };
});
regPost('雄偉牙|地盤崩壞', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  const take = Math.min(1, p.deck.length);
  if (take === 0) return state;
  const discarded = p.deck.slice(0, take);
  const s = addLog(state, `地盤崩壞：丟對手牌庫頂 ${take} 張`, aIdx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl, deck: pl.deck.slice(take), discard: [...pl.discard, ...discarded]
  }));
});

// 焚焰蚣|焦黑吐息 — 對手戰鬥寶可夢已灼傷則 180，否則招式失敗（0 傷害）
regPre('焚焰蚣|焦黑吐息', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (def && def.status === 'burned') {
    return { state: addLog(state, '焦黑吐息：對手灼傷 → 180 傷害', aIdx), damage: 180 };
  }
  return { state: addLog(state, '焦黑吐息：對手未灼傷 → 招式失敗', aIdx), damage: 0 };
});

// 熔岩蟲|熾熱熔岩 — 20 + 灼傷
regPost('熔岩蟲|熾熱熔岩', statusPost('burned'));

// 故勒頓|撕裂 — 130（簡化：不特殊處理「不計算身上附加效果」）
regPre('故勒頓|撕裂', (state, _aIdx, _pool) => {
  return { state, damage: 130 };
});

// 夠讚狗ex|瘋狂連鎖 — 130 + 若自身中毒則 +130
regPre('夠讚狗ex|瘋狂連鎖', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  if (att && att.status === 'poisoned') {
    return { state: addLog(state, '瘋狂連鎖：自身中毒 → +130', aIdx), damage: 260 };
  }
  return { state, damage: 130 };
});

// 貓頭夜鷹|鉤爪搜尋 — 70 + 抽 2 張（簡化：固定從牌庫頂抽）
regPost('貓頭夜鷹|鉤爪搜尋', drawNPost(2, '鉤爪搜尋'));

// 皮卡丘|電磁電光 — 對對手任一寶可夢（含備戰）造成 10 傷害
regPre('皮卡丘|電磁電光', (_state, _aIdx, _pool) => {
  return { state: _state, damage: 0 };
});
regPost('皮卡丘|電磁電光', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0 && !defender.active) return state;
  // 若無備戰，直接對出場施加 10
  if (defender.bench.length === 0 && defender.active) {
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + 10;
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
      let s = addLog({ ...state, players }, `電磁電光：10 傷害擊倒 ${defCard?.name ?? '?'}！${state.players[aIdx].name} 取得 ${prizes} 張獎勵牌。`, null);
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
      }
      return { ...s, pendingPrizes: prizes };
    } else {
      const players = [...state.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...defender, active: { ...defender.active!, damage: newDmg } };
      return addLog({ ...state, players }, `電磁電光：對 ${defCard?.name ?? '?'} 造成 10 傷害！`, aIdx);
    }
  }
  // 有備戰，讓玩家選擇
  let s = addLog(state, '電磁電光：選擇對手任一寶可夢造成 10 傷害', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-10',
    params: { includeActive: true },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38r v1.68 H 標第 13 波 — other-bucket 續（9 張）
//   (a) 攻擊 + 自回血 = 基礎傷害 — 朽木妖|終極吸取
//   (b) 丟競技場 — 洗翠 卡蒂狗|全部燒光
//   (c) 灼傷 — 洗翠 風速狗|灼燒
//   (d) 對備戰 ex/V 60 傷害 — 謝米|精刺奇襲
//   (e) 牌庫搜尋 Basic → 備戰 — 聒噪鳥|無伴奏合唱、向尾喵|呼朋引伴
//   (f) 牌庫搜尋 Pokemon → 手牌 — 啃果蟲|尋找朋友
//   (g) 攻擊後自交替 — 藍鱷|逆向噴射
//   (h) 從棄牌區各附 1 張【鬥】能量到備戰 — 重泥挽馬|泥巴庫存
// ══════════════════════════════════════════════════════════════════════════════

// 朽木妖|終極吸取 — 50 傷害 + 自回血 50（簡化：不追實際傷害）
regPost('朽木妖|終極吸取', selfHealPost(50, '終極吸取'));

// 洗翠 卡蒂狗|全部燒光 — 無傷害，丟棄競技場卡
regPre('洗翠 卡蒂狗|全部燒光', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('洗翠 卡蒂狗|全部燒光', (state, aIdx, _pool) => {
  if (!state.activeStadium) return addLog(state, '全部燒光：場上沒有競技場', aIdx);
  const stadium = state.activeStadium;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...players[aIdx], discard: [...players[aIdx].discard, stadium] };
  return addLog({ ...state, players, activeStadium: undefined }, '全部燒光：丟棄競技場', aIdx);
});

// 洗翠 風速狗|灼燒 — 90 + 灼傷
regPost('洗翠 風速狗|灼燒', statusPost('burned'));

// 謝米|精刺奇襲 — 對備戰的 ex/V 60 傷害（不計弱抗）
regPre('謝米|精刺奇襲', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('謝米|精刺奇襲', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  const exBench = defender.bench.filter(c => {
    const card = pool.get(c.cardId);
    return isExCard(card);
  });
  if (exBench.length === 0) {
    return addLog(state, '精刺奇襲：對手備戰區沒有 ex/V 寶可夢', aIdx);
  }
  let s = addLog(state, '精刺奇襲：選對手備戰的 1 隻 ex/V 造成 60 傷害', aIdx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-60-ex',
    params: { validIids: exBench.map(c => c.iid) },
  });
});
regR('snipe-60-ex', (st, actorIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  const target = defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  const newDmg = target.damage + 60;
  const targetHP = targetCard?.hp ?? 0;
  if (targetHP > 0 && newDmg >= targetHP) {
    const koDiscard: CardInstance[] = [
      { ...target, damage: newDmg },
      ...target.energyAttached,
      ...(target.toolAttached ? [target.toolAttached] : []),
      ...(target.evolvedFromStack ?? []),
    ];
    const prizes = isExCard(targetCard) ? 2 : 1;
    const players = [...st.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...defender, bench: defender.bench.filter(c => c.iid !== targetIid),
      discard: [...defender.discard, ...koDiscard] };
    let s = addLog({ ...st, players }, `精刺奇襲：${targetCard?.name ?? '?'} 被擊倒！${st.players[actorIdx].name} 取得 ${prizes} 張獎勵牌。`, null);
    return { ...s, pendingPrizes: prizes };
  }
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...defender, bench: defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c) };
  return addLog({ ...st, players }, `精刺奇襲：對 ${targetCard?.name ?? '?'} 造成 60 傷害！`, actorIdx);
});

// 聒噪鳥|無伴奏合唱 — 從牌庫選最多 3 張 Basic 寶可夢卡放到備戰
regPre('聒噪鳥|無伴奏合唱', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('聒噪鳥|無伴奏合唱', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  const benchRoom = 5 - player.bench.length;
  if (benchRoom <= 0) return addLog(state, '無伴奏合唱：備戰區已滿', aIdx);
  let s = addLog(state, '無伴奏合唱：從牌庫選最多 3 張基礎寶可夢放備戰', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: Math.min(3, benchRoom),
    effectKey: 'bench-basic-from-deck',
  });
});

// 向尾喵|呼朋引伴 — 從牌庫選 1 張基礎寶可夢放備戰
regPre('向尾喵|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('向尾喵|呼朋引伴', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.bench.length >= 5) return addLog(state, '呼朋引伴：備戰區已滿', aIdx);
  let s = addLog(state, '呼朋引伴：從牌庫選 1 張基礎寶可夢放備戰', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'bench-basic-from-deck',
  });
});

// 啃果蟲|尋找朋友 — 從牌庫選 1 張寶可夢加手牌
regPre('啃果蟲|尋找朋友', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('啃果蟲|尋找朋友', (state, aIdx, _pool) => {
  let s = addLog(state, '尋找朋友：從牌庫選 1 張寶可夢加手牌', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 藍鱷|逆向噴射 — 30 傷害 + 自己戰鬥寶可夢與備戰寶可夢互換
regPost('藍鱷|逆向噴射', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (!player.active || player.bench.length === 0) {
    return addLog(state, '逆向噴射：沒有可交替的備戰寶可夢', aIdx);
  }
  let s = addLog(state, '逆向噴射：選擇換入的備戰寶可夢', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'do-switch',
  });
});

// 重泥挽馬|泥巴庫存 — 從棄牌區給所有備戰各附 1 張基本【鬥】能量
regPre('重泥挽馬|泥巴庫存', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('重泥挽馬|泥巴庫存', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const benchLen = player.bench.length;
  if (benchLen === 0) return addLog(state, '泥巴庫存：沒有備戰寶可夢', aIdx);
  // 從棄牌區取出最多 benchLen 張「基本【鬥】能量」（簡化：僅基本 Fighting 能量 subtype 判斷）
  const fightingInDiscard: number[] = [];
  for (let i = 0; i < player.discard.length && fightingInDiscard.length < benchLen; i++) {
    const c = player.discard[i];
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.name.includes('鬥') || card.pokemonType === 'Fighting')) {
      fightingInDiscard.push(i);
    }
  }
  if (fightingInDiscard.length === 0) {
    return addLog(state, '泥巴庫存：棄牌區沒有基本【鬥】能量', aIdx);
  }
  const benchNames = player.bench.map(c => pool.get(c.cardId)?.name ?? '?');
  const used = new Set(fightingInDiscard);
  const energiesToAttach = player.discard.filter((_, i) => used.has(i));
  const remainingDiscard = player.discard.filter((_, i) => !used.has(i));
  // 依序附給每個備戰（能量不足則只附前 N 個）
  const newBench = player.bench.map((b, i) => {
    if (i < energiesToAttach.length) {
      return { ...b, energyAttached: [...b.energyAttached, energiesToAttach[i]] };
    }
    return b;
  });
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...player, bench: newBench, discard: remainingDiscard };
  const attached = energiesToAttach.length;
  const targets = benchNames.slice(0, attached).join('、');
  return addLog({ ...state, players }, `泥巴庫存：從棄牌區附 ${attached} 張【鬥】能量給備戰 (${targets})`, aIdx);
});

regR('snipe-10', (st, actorIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid) return st;

  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;

  const targetCard = pool.get(target.cardId);
  const newDmg = target.damage + 10;
  const targetHP = targetCard?.hp ?? 0;

  if (targetHP > 0 && newDmg >= targetHP) {
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
    let s = addLog({ ...st, players }, `電磁電光：${targetCard?.name ?? '?'} 被擊倒！${st.players[actorIdx].name} 取得 ${prizes} 張獎勵牌。`, null);
    if (isActive && newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return { ...s, pendingPrizes: prizes };
  } else {
    const players = [...st.players] as [PlayerState, PlayerState];
    const newDefender = { ...defender };
    if (isActive) {
      newDefender.active = { ...target, damage: newDmg };
    } else {
      newDefender.bench = defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c);
    }
    players[dIdx] = newDefender;
    return addLog({ ...st, players }, `電磁電光：對 ${targetCard?.name ?? '?'} 造成 10 傷害！`, actorIdx);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38s v1.69 H 標第 14 波 — 傷害指示物直置 + 灼傷補齊（10 張）
//
// 新 helper:
//   applyDamageToAllOpp(state, aIdx, pool, amount, onlyDamaged, label)
//     → 對對手所有（或已有傷害指示物的）寶可夢各 +amount 傷害，處理 KO 串聯
//   setOppActiveHPPre(targetHP, label)
//     → 將對手戰鬥寶可夢的傷害設到 HP - targetHP（即剩餘 HP = targetHP）
//
// 實裝清單:
//   (a) 灼傷補齊（3 張）:呆火鱷|熱灼燒、熔岩蝸牛ex|熾熱熔岩、飄浮泡泡 太陽的樣子|灼熱
//   (b) 單點指示物（1 張）:綿綿泡芙|悄聲加害（20 傷害=2 個指示物）→ opp-poke-choose
//   (c) 全體指示物（2 張）:由克希|痛楚記憶（全體 +20）、伊裴爾塔爾|侵蝕之風（已傷 +20）
//   (d) HP 設定（2 張）:蜈蚣王|偏道一回（剩 10）、恰雷姆ex|氣功指壓（剩 50）
//   (e) 條件失敗（1 張）:古鼎鹿|傲慢衝擊（220，若自身 ≥4 指示物則失敗）
//   (f) 簡化 plain（1 張）:八爪武師|觸手激怒（130；動態能量費用略）
// ══════════════════════════════════════════════════════════════════════════════

/** 對 opp 全體或已傷寶可夢各加 amount 傷害，含 KO 處理 */
function applyDamageToAllOpp(
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
  amount: number,
  onlyDamaged: boolean,
  label: string
): GameState {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  let prizesTotal = 0;
  const players = [...s.players] as [PlayerState, PlayerState];
  let defender = { ...players[dIdx] };

  // 處理 active
  if (defender.active && (!onlyDamaged || defender.active.damage > 0)) {
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + amount;
    const hp = defCard?.hp ?? 0;
    if (hp > 0 && newDmg >= hp) {
      const koDiscard: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...(defender.active.toolAttached ? [defender.active.toolAttached] : []),
        ...(defender.active.evolvedFromStack ?? []),
      ];
      const p = isExCard(defCard) ? 2 : 1;
      prizesTotal += p;
      defender = { ...defender, active: null, discard: [...defender.discard, ...koDiscard] };
      s = addLog(s, `${label}：${defCard?.name ?? '?'} 被擊倒！+${p} 張獎勵牌。`, null);
    } else {
      defender = { ...defender, active: { ...defender.active, damage: newDmg } };
    }
  }

  // 處理 bench（篩選條件後再累積指示物；KO 的收到 discard）
  const newBench: CardInstance[] = [];
  for (const b of defender.bench) {
    if (onlyDamaged && b.damage === 0) { newBench.push(b); continue; }
    const card = pool.get(b.cardId);
    const newDmg = b.damage + amount;
    const hp = card?.hp ?? 0;
    if (hp > 0 && newDmg >= hp) {
      const koDiscard: CardInstance[] = [
        { ...b, damage: newDmg },
        ...b.energyAttached,
        ...(b.toolAttached ? [b.toolAttached] : []),
        ...(b.evolvedFromStack ?? []),
      ];
      const p = isExCard(card) ? 2 : 1;
      prizesTotal += p;
      defender = { ...defender, discard: [...defender.discard, ...koDiscard] };
      s = addLog(s, `${label}：${card?.name ?? '?'}（備戰）被擊倒！+${p} 張獎勵牌。`, null);
      // 不加入 newBench = 移除
    } else {
      newBench.push({ ...b, damage: newDmg });
    }
  }
  defender = { ...defender, bench: newBench };
  players[dIdx] = defender;
  s = { ...s, players };

  if (prizesTotal > 0) {
    // 若 active 被擊倒且備戰空 → 勝利
    if (!defender.active && defender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + prizesTotal };
  }
  return s;
}

/** 將對手戰鬥寶可夢的傷害設為使剩餘 HP = targetHP */
function setOppActiveHPPre(targetHP: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def) return { state, damage: 0 };
    const card = pool.get(def.cardId);
    const hp = card?.hp ?? 0;
    if (hp <= targetHP) {
      return { state: addLog(state, `${label}：對手 HP 已在 ${targetHP} 以下，無效`, aIdx), damage: 0 };
    }
    const needed = hp - targetHP - def.damage;
    if (needed <= 0) {
      return { state: addLog(state, `${label}：對手已有足夠傷害指示物，無效`, aIdx), damage: 0 };
    }
    return { state: addLog(state, `${label}：讓對手剩餘 HP = ${targetHP}（+${needed} 傷害）`, aIdx), damage: needed };
  };
}

// 灼傷補齊
regPost('呆火鱷|熱灼燒', statusPost('burned'));
regPost('熔岩蝸牛ex|熾熱熔岩', statusPost('burned'));
regPre('飄浮泡泡 太陽的樣子|灼熱', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('飄浮泡泡 太陽的樣子|灼熱', statusPost('burned'));

// 綿綿泡芙|悄聲加害 — 對對手 1 隻寶可夢放置 2 個傷害指示物（= 20 傷害，使用現成 snipe-10 邏輯的 20 變種）
regPre('綿綿泡芙|悄聲加害', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('綿綿泡芙|悄聲加害', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0 && !defender.active) return state;
  if (defender.bench.length === 0 && defender.active) {
    // 僅 active 可選，直接施加
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + 20;
    const hp = defCard?.hp ?? 0;
    const players = [...state.players] as [PlayerState, PlayerState];
    if (hp > 0 && newDmg >= hp) {
      const ko: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...(defender.active.toolAttached ? [defender.active.toolAttached] : []),
        ...(defender.active.evolvedFromStack ?? []),
      ];
      const p = isExCard(defCard) ? 2 : 1;
      players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...ko] };
      let s = addLog({ ...state, players }, `悄聲加害：${defCard?.name ?? '?'} 被擊倒！+${p} 張獎勵牌。`, null);
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
      }
      return { ...s, pendingPrizes: p };
    }
    players[dIdx] = { ...defender, active: { ...defender.active, damage: newDmg } };
    return addLog({ ...state, players }, `悄聲加害：對 ${defCard?.name ?? '?'} 造成 20 傷害`, aIdx);
  }
  let s = addLog(state, '悄聲加害：選擇對手任一寶可夢，放置 2 個傷害指示物', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-20',
    params: { includeActive: true },
  });
});

regR('snipe-20', (st, actorIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  const newDmg = target.damage + 20;
  const hp = targetCard?.hp ?? 0;
  if (hp > 0 && newDmg >= hp) {
    const ko: CardInstance[] = [
      { ...target, damage: newDmg },
      ...target.energyAttached,
      ...(target.toolAttached ? [target.toolAttached] : []),
      ...(target.evolvedFromStack ?? []),
    ];
    const p = isExCard(targetCard) ? 2 : 1;
    const players = [...st.players] as [PlayerState, PlayerState];
    const newDefender = { ...defender, discard: [...defender.discard, ...ko] };
    if (isActive) newDefender.active = null;
    else newDefender.bench = defender.bench.filter(c => c.iid !== targetIid);
    players[dIdx] = newDefender;
    let s = addLog({ ...st, players }, `悄聲加害：${targetCard?.name ?? '?'} 被擊倒！+${p} 張獎勵牌。`, null);
    if (isActive && newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return { ...s, pendingPrizes: p };
  }
  const players = [...st.players] as [PlayerState, PlayerState];
  const newDefender = { ...defender };
  if (isActive) newDefender.active = { ...target, damage: newDmg };
  else newDefender.bench = defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c);
  players[dIdx] = newDefender;
  return addLog({ ...st, players }, `悄聲加害：對 ${targetCard?.name ?? '?'} 造成 20 傷害`, actorIdx);
});

// 由克希|痛楚記憶 — 對手所有寶可夢各放置 2 個指示物（= 20 傷害）
regPre('由克希|痛楚記憶', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('由克希|痛楚記憶', (state, aIdx, pool) => {
  return applyDamageToAllOpp(state, aIdx, pool, 20, false, '痛楚記憶');
});

// 伊裴爾塔爾|侵蝕之風 — 對手已傷寶可夢各放置 2 個指示物
regPre('伊裴爾塔爾|侵蝕之風', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('伊裴爾塔爾|侵蝕之風', (state, aIdx, pool) => {
  return applyDamageToAllOpp(state, aIdx, pool, 20, true, '侵蝕之風');
});

// 蜈蚣王|偏道一回 — 將對手戰鬥寶可夢剩餘 HP 變為 10
regPre('蜈蚣王|偏道一回', setOppActiveHPPre(10, '偏道一回'));

// 恰雷姆ex|氣功指壓 — 剩餘 HP 變為 50
regPre('恰雷姆ex|氣功指壓', setOppActiveHPPre(50, '氣功指壓'));

// 古鼎鹿|傲慢衝擊 — 220；若自身 ≥40 傷害（=4 指示物）則失敗
regPre('古鼎鹿|傲慢衝擊', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  if (att && att.damage >= 40) {
    return { state: addLog(state, '傲慢衝擊：自身 ≥4 指示物 → 招式失敗', aIdx), damage: 0 };
  }
  return { state, damage: 220 };
});

// 八爪武師|觸手激怒 — 130 plain（簡化：動態能量費用條件略）
regPre('八爪武師|觸手激怒', (state, _aIdx, _pool) => ({ state, damage: 130 }));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38t v1.70 H 標第 15 波 — attach-energy × multiplier（20 張）
//
// Helper:
//   countEnergy(instance, filter, pool) → 依 filter（'all'/'basic'/'special'/EnergyType）計數
//   selfAttachedEnergyMultiplyPre(base, per, filter, label) — 自身附加能量 × per
//   defActiveEnergyMultiplyPre(base, per, filter, label) — 對手戰鬥寶可夢身上能量 × per
//   oppAllEnergyMultiplyPre(base, per, filter, label) — 對手全場能量 × per
//   selfAllEnergyMultiplyPre(base, per, filter, label) — 自己全場能量 × per
//   bothActiveEnergyMultiplyPre(base, per, label) — 雙方出場能量之和 × per
// ══════════════════════════════════════════════════════════════════════════════

type EnergyFilter = 'all' | 'basic' | 'special' | EnergyType;

function countOneEnergy(inst: CardInstance, filter: EnergyFilter, pool: Map<string, Card>): number {
  let count = 0;
  for (const e of inst.energyAttached) {
    const card = pool.get(e.cardId);
    if (!card || card.supertype !== 'Energy') continue;
    if (filter === 'all') count++;
    else if (filter === 'basic' && card.subtype === 'Basic') count++;
    else if (filter === 'special' && card.subtype === 'Special') count++;
    else if (typeof filter === 'string' && card.pokemonType === filter) count++;
  }
  return count;
}

function selfAttachedEnergyMultiplyPre(base: number, per: number, filter: EnergyFilter, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att) return { state, damage: base };
    const count = countOneEnergy(att, filter, pool);
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：自身能量 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

function defActiveEnergyMultiplyPre(base: number, per: number, filter: EnergyFilter, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const count = def ? countOneEnergy(def, filter, pool) : 0;
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：對手出場能量 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

function oppAllEnergyMultiplyPre(base: number, per: number, filter: EnergyFilter, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    let count = 0;
    for (const p of [d.active, ...d.bench]) {
      if (p) count += countOneEnergy(p, filter, pool);
    }
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：對手全場能量 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

function selfAllEnergyMultiplyPre(base: number, per: number, filter: EnergyFilter, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx];
    let count = 0;
    for (const p of [a.active, ...a.bench]) {
      if (p) count += countOneEnergy(p, filter, pool);
    }
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：自己全場能量 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

function bothActiveEnergyMultiplyPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const a = state.players[aIdx].active;
    const d = state.players[dIdx].active;
    const count = (a ? countOneEnergy(a, 'all', pool) : 0) + (d ? countOneEnergy(d, 'all', pool) : 0);
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：雙方出場能量合計 ${count} → ${dmg}`, aIdx), damage: dmg };
  };
}

// 自身附加（filter）
regPre('奇諾栗鼠|特殊滾滾', selfAttachedEnergyMultiplyPre(0, 70, 'special', '特殊滾滾'));
regPre('巨炭山|機槍瀝青', selfAttachedEnergyMultiplyPre(40, 80, 'Fire', '機槍瀝青'));
regPre('吉雉雞|能量羽毛', selfAttachedEnergyMultiplyPre(0, 30, 'all', '能量羽毛'));
regPre('刺龍王ex|水炮', selfAttachedEnergyMultiplyPre(50, 50, 'Water', '水炮'));
regPre('拉普拉斯ex|力量飛濺', selfAttachedEnergyMultiplyPre(0, 40, 'all', '力量飛濺'));
regPre('帕路奇亞|空間粉碎', selfAttachedEnergyMultiplyPre(0, 40, 'basic', '空間粉碎'));

// 對手戰鬥寶可夢身上
regPre('蟲甲聖|精神強念', defActiveEnergyMultiplyPre(10, 30, 'all', '精神強念'));
regPre('霏歐納|能量壓制', defActiveEnergyMultiplyPre(0, 20, 'all', '能量壓制'));
regPre('勇基拉|精神強念', defActiveEnergyMultiplyPre(10, 30, 'all', '精神強念'));
regPre('胡地|精神強念', defActiveEnergyMultiplyPre(10, 50, 'all', '精神強念'));
regPre('洛托姆|能量短路', defActiveEnergyMultiplyPre(0, 20, 'all', '能量短路'));

// 對手全場
regPre('向日花怪|光返', oppAllEnergyMultiplyPre(0, 60, 'Fire', '光返'));
regPre('蒂安希|漫反射', oppAllEnergyMultiplyPre(0, 40, 'special', '漫反射'));
regPre('塗標客|能量塗鴉', oppAllEnergyMultiplyPre(0, 40, 'all', '能量塗鴉'));
regPre('葉伊布ex|綠葉風暴', oppAllEnergyMultiplyPre(0, 60, 'all', '綠葉風暴'));

// 自己全場
regPre('蜜集大蛇ex|蜜糖風暴', selfAllEnergyMultiplyPre(30, 30, 'Grass', '蜜糖風暴'));

// 雙方出場
regPre('厄鬼椪 碧草面具ex|萬葉陣雨', bothActiveEnergyMultiplyPre(30, 30, '萬葉陣雨'));

// 猛雷鼓|落雷風暴 — 0 base，傷害 = 自身能量 × 30，對對手任意 1 隻（含備戰）
regPre('猛雷鼓|落雷風暴', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  const count = att ? countOneEnergy(att, 'all', pool) : 0;
  // 不在這裡造成傷害給對手出場，由 POST 處理任意目標
  return { state: addLog(state, `落雷風暴：自身能量 ${count} → 對任一 ${count * 30} 傷害（不計弱抗）`, aIdx), damage: 0 };
});
regPost('猛雷鼓|落雷風暴', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  const count = att ? countOneEnergy(att, 'all', pool) : 0;
  const dmg = count * 30;
  if (dmg === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0 && !defender.active) return state;
  if (defender.bench.length === 0 && defender.active) {
    const defCard = pool.get(defender.active.cardId);
    const newDmg = defender.active.damage + dmg;
    const hp = defCard?.hp ?? 0;
    const players = [...state.players] as [PlayerState, PlayerState];
    if (hp > 0 && newDmg >= hp) {
      const ko: CardInstance[] = [
        { ...defender.active, damage: newDmg },
        ...defender.active.energyAttached,
        ...(defender.active.toolAttached ? [defender.active.toolAttached] : []),
        ...(defender.active.evolvedFromStack ?? []),
      ];
      const p = isExCard(defCard) ? 2 : 1;
      players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...ko] };
      let s = addLog({ ...state, players }, `落雷風暴：${defCard?.name ?? '?'} 被擊倒！+${p} 張獎勵牌。`, null);
      if (players[dIdx].bench.length === 0) {
        return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
      }
      return { ...s, pendingPrizes: p };
    }
    players[dIdx] = { ...defender, active: { ...defender.active, damage: newDmg } };
    return addLog({ ...state, players }, `落雷風暴：對 ${defCard?.name ?? '?'} 造成 ${dmg} 傷害`, aIdx);
  }
  let s = addLog(state, `落雷風暴：選擇對手任一寶可夢造成 ${dmg} 傷害`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-variable',
    params: { includeActive: true, damage: dmg, label: '落雷風暴' },
  });
});

regR('snipe-variable', (st, actorIdx, selectedIids, params, pool) => {
  const dmg = (params?.damage as number) ?? 0;
  const label = (params?.label as string) ?? '遠程攻擊';
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid || dmg === 0) return st;
  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  const newDmg = target.damage + dmg;
  const hp = targetCard?.hp ?? 0;
  if (hp > 0 && newDmg >= hp) {
    const ko: CardInstance[] = [
      { ...target, damage: newDmg },
      ...target.energyAttached,
      ...(target.toolAttached ? [target.toolAttached] : []),
      ...(target.evolvedFromStack ?? []),
    ];
    const p = isExCard(targetCard) ? 2 : 1;
    const players = [...st.players] as [PlayerState, PlayerState];
    const newDefender = { ...defender, discard: [...defender.discard, ...ko] };
    if (isActive) newDefender.active = null;
    else newDefender.bench = defender.bench.filter(c => c.iid !== targetIid);
    players[dIdx] = newDefender;
    let s = addLog({ ...st, players }, `${label}：${targetCard?.name ?? '?'} 被擊倒！+${p} 張獎勵牌。`, null);
    if (isActive && newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return { ...s, pendingPrizes: p };
  }
  const players = [...st.players] as [PlayerState, PlayerState];
  const newDefender = { ...defender };
  if (isActive) newDefender.active = { ...target, damage: newDmg };
  else newDefender.bench = defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c);
  players[dIdx] = newDefender;
  return addLog({ ...st, players }, `${label}：對 ${targetCard?.name ?? '?'} 造成 ${dmg} 傷害`, actorIdx);
});
