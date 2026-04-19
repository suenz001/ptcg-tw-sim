/**
 * PTCG 對戰引擎 — 核心純函式
 *
 * 所有函式都是純函式：接收舊 state 回傳新 state，不做任何副作用。
 * 這讓引擎可以：
 *   - 單元測試
 *   - 動作日誌回放
 *   - M3 多人連線時只需傳送動作序列
 */

import type { Card, EnergyType } from '$lib/cards/types';
import type {
  GameState, GameAction, CardInstance,
  PlayerState, LogEntry, TurnPhase, GamePhase
} from './types';
import { TRAINER_EFFECTS, RESOLVERS, ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, canPlayTrainer } from './effects';

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/** 產生一個輕量隨機 ID */
function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Fisher-Yates 洗牌（回傳新陣列） */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 從 pool 取得 Card 資料（不存在則拋錯） */
function getCard(cardId: string, pool: Map<string, Card>): Card {
  const c = pool.get(cardId);
  if (!c) throw new Error(`Card not found in pool: ${cardId}`);
  return c;
}

/** 建立新的 CardInstance */
function newInstance(cardId: string): CardInstance {
  return { iid: uid(), cardId, damage: 0, energyAttached: [] };
}

/** 把一組 cardId 轉為 CardInstance 陣列（供建立牌組用） */
function deckToInstances(entries: { cardId: string; count: number }[]): CardInstance[] {
  const result: CardInstance[] = [];
  for (const { cardId, count } of entries) {
    for (let i = 0; i < count; i++) result.push(newInstance(cardId));
  }
  return result;
}

/** 從 pool 判斷一張牌是否為「基礎寶可夢」 */
function isBasicPokemon(cardId: string, pool: Map<string, Card>): boolean {
  const c = pool.get(cardId);
  return !!c && c.supertype === 'Pokemon' && c.subtype === 'Basic';
}

/** 從 pool 判斷是否為能量牌 */
function isEnergy(cardId: string, pool: Map<string, Card>): boolean {
  return pool.get(cardId)?.supertype === 'Energy';
}

/** 台灣卡牌中文屬性名稱 → EnergyType（當 pokemonType 欄位遺漏時備用） */
const ZH_ENERGY_TYPE: Record<string, EnergyType> = {
  '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
  '超': 'Psychic', '格': 'Fighting', '惡': 'Darkness', '鋼': 'Metal',
  '妖': 'Fairy', '龍': 'Dragon', '無': 'Colorless',
};

/**
 * 取得一張能量卡提供的能量類型列表。
 * 基礎能量：1 個對應屬性；若 pokemonType 欄位未填，從卡名【X】推斷。
 * 特殊能量：M2 先一律視為 1 Colorless（M4 再完整實裝）。
 */
export function getEnergyProvided(cardId: string, pool: Map<string, Card>): EnergyType[] {
  const c = pool.get(cardId);
  if (!c || c.supertype !== 'Energy') return [];
  if (c.subtype === 'Basic') {
    if (c.pokemonType) return [c.pokemonType];
    // 從卡名解析，例如「基本【惡】能量」→ 'Darkness'
    const m = c.name.match(/【(.+?)】/);
    if (m) {
      const t = ZH_ENERGY_TYPE[m[1]];
      if (t) return [t];
    }
  }
  return ['Colorless']; // special energy fallback
}

/**
 * 計算一隻寶可夢附加的能量總量（按屬性分類）。
 * 回傳 Map<EnergyType, number>
 */
export function countEnergy(
  pokemon: CardInstance,
  pool: Map<string, Card>
): Map<EnergyType, number> {
  const map = new Map<EnergyType, number>();
  for (const e of pokemon.energyAttached) {
    for (const t of getEnergyProvided(e.cardId, pool)) {
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }
  return map;
}

/**
 * 判斷招式能量需求是否滿足。
 * cost[] 中 'Colorless' 可由任何能量代替，其餘必須完全匹配。
 */
export function canAffordAttack(
  pokemon: CardInstance,
  cost: EnergyType[],
  pool: Map<string, Card>
): boolean {
  const available = countEnergy(pokemon, pool);
  const avail = new Map(available); // 可用副本
  const colorlessCost = cost.filter((t) => t === 'Colorless').length;
  const typedCost = cost.filter((t) => t !== 'Colorless');

  // 先扣掉有色需求
  for (const t of typedCost) {
    const have = avail.get(t) ?? 0;
    if (have <= 0) return false;
    avail.set(t, have - 1);
  }
  // 剩餘能量總量要 ≥ 無色需求
  const remaining = [...avail.values()].reduce((a, b) => a + b, 0);
  return remaining >= colorlessCost;
}

/** 判斷一張 ex 卡（name 含 'ex' 後綴）對應獎勵牌數 */
function prizesForKO(card: Card): number {
  // ex / V-STAR 等擊倒獲得 2 張（M4 再細分；M2 先用簡單規則）
  if (card.name.endsWith('ex') || card.name.endsWith('EX')) return 2;
  return 1;
}

/** 建立空玩家狀態 */
function emptyPlayer(name: string): PlayerState {
  return {
    name, hand: [], deck: [], active: null,
    bench: [], discard: [], prizes: [],
    energyAttachedThisTurn: false,
    supporterPlayedThisTurn: false,
    retreatedThisTurn: false,
  };
}

/** 清除 CardInstance 上的回合旗標 */
function clearTurnFlags(c: CardInstance): CardInstance {
  if (!c.justPlaced && !c.evolvedThisTurn) return c;
  const n = { ...c };
  delete n.justPlaced;
  delete n.evolvedThisTurn;
  return n;
}

/** 加一筆 log */
function addLog(
  state: GameState,
  message: string,
  playerIndex: 0 | 1 | null = null
): GameState {
  return {
    ...state,
    log: [...state.log, { turn: state.turn, playerIndex, message }]
  };
}

// ── 遊戲建立 ────────────────────────────────────────────────────────────────

export interface DeckSpec {
  name: string;
  entries: { cardId: string; count: number }[];
}

/**
 * 建立一場新遊戲。
 * 洗牌 → 各抽 7 張 → 若無基礎寶可夢則自動補牌（mulligans）→ 進入 setup 階段（雙方同時）。
 */
export function createGame(
  spec1: DeckSpec,
  spec2: DeckSpec,
  pool: Map<string, Card>
): GameState {
  const p1 = emptyPlayer(spec1.name);
  const p2 = emptyPlayer(spec2.name);

  // 洗牌 + 建牌組
  p1.deck = shuffle(deckToInstances(spec1.entries));
  p2.deck = shuffle(deckToInstances(spec2.entries));

  // 各抽 7 張（記錄 mulligan 次數）
  const m1 = dealOpeningHand(p1, pool);
  const m2 = dealOpeningHand(p2, pool);

  // Mulligan 補抽：對手因為我 mulligan 而多抽 N 張（官方規則簡化：自動補抽，不詢問）
  for (let i = 0; i < m1; i++) {
    const top = p2.deck.shift();
    if (top) p2.hand.push(top);
  }
  for (let i = 0; i < m2; i++) {
    const top = p1.deck.shift();
    if (top) p1.hand.push(top);
  }

  // 擲硬幣決定先手
  const firstPlayerIdx: 0 | 1 = Math.random() < 0.5 ? 0 : 1;

  const state: GameState = {
    id: uid(),
    phase: 'setup',
    turnPhase: 'main',
    activePlayerIndex: firstPlayerIdx,
    firstPlayerIdx,
    players: [p1, p2],
    turn: 1,
    isFirstTurn: true,
    setupDone: [false, false],
    mulliganCounts: [m1, m2],
    log: [],
    pendingPrizes: 0,
  };

  let st = addLog(state, `遊戲開始！${spec1.name} vs ${spec2.name}`, null);
  st = addLog(st, `🪙 擲硬幣：${state.players[firstPlayerIdx].name} 先手`, null);
  if (m1 > 0) st = addLog(st, `${spec1.name} Mulligan ${m1} 次 → ${spec2.name} 多抽 ${m1} 張`, 0);
  if (m2 > 0) st = addLog(st, `${spec2.name} Mulligan ${m2} 次 → ${spec1.name} 多抽 ${m2} 張`, 1);
  return st;
}

/**
 * 抽 7 張起始手牌。若無基礎寶可夢則重新洗牌並再抽（mulligan）。
 * 回傳 mulligan 次數（第一次未成功抽到基礎的重抽次數）。
 */
function dealOpeningHand(player: PlayerState, pool: Map<string, Card>): number {
  let attempts = 0;
  let mulligans = 0;
  do {
    // 把手牌放回牌組重洗
    player.deck = shuffle([...player.deck, ...player.hand]);
    player.hand = [];
    // 抽 7
    for (let i = 0; i < 7; i++) {
      const top = player.deck.shift();
      if (top) player.hand.push(top);
    }
    attempts++;
    if (player.hand.some((c) => isBasicPokemon(c.cardId, pool))) break;
    mulligans++;
  } while (attempts < 10);
  return mulligans;
}

// ── Setup 階段處理 ───────────────────────────────────────────────────────────

function handleSetup(
  state: GameState,
  action: GameAction,
  pool: Map<string, Card>
): GameState {
  // Setup 階段雙方同時行動，從 action.senderIdx 取操作方
  if (
    action.type !== 'PLACE_ACTIVE' &&
    action.type !== 'BENCH_POKEMON' &&
    action.type !== 'FINISH_SETUP'
  ) {
    return state;
  }
  const pIdx = action.senderIdx;
  // 已完成 setup 的玩家不能再操作
  if (state.setupDone[pIdx]) return state;
  const player = { ...state.players[pIdx] };
  const players = [...state.players] as [PlayerState, PlayerState];

  if (action.type === 'PLACE_ACTIVE') {
    const iidx = player.hand.findIndex((c) => c.iid === action.iid);
    if (iidx < 0) return state;
    const card = player.hand[iidx];
    if (!isBasicPokemon(card.cardId, pool)) return state;
    if (player.active) {
      // 把舊的放回手牌
      player.hand = [...player.hand, player.active];
    }
    player.hand = player.hand.filter((_, i) => i !== iidx);
    player.active = card;
    players[pIdx] = player;
    return addLog({ ...state, players }, `${player.name} 選擇了出場寶可夢`, null);
  }

  if (action.type === 'BENCH_POKEMON') {
    if (!player.active) return state; // 必須先選出場
    if (player.bench.length >= 5) return state;
    const iidx = player.hand.findIndex((c) => c.iid === action.iid);
    if (iidx < 0) return state;
    const card = player.hand[iidx];
    if (!isBasicPokemon(card.cardId, pool)) return state;
    player.hand = player.hand.filter((_, i) => i !== iidx);
    player.bench = [...player.bench, card];
    players[pIdx] = player;
    return { ...state, players };
  }

  if (action.type === 'FINISH_SETUP') {
    if (!player.active) return state; // 必須選出場才能完成
    // 設置獎勵牌（各 6 張）
    const prizes: CardInstance[] = [];
    for (let i = 0; i < 6; i++) {
      const top = player.deck.shift();
      if (top) prizes.push(top);
    }
    player.prizes = prizes;
    const newDone = [...state.setupDone] as [boolean, boolean];
    newDone[pIdx] = true;
    players[pIdx] = player;

    let newState: GameState = { ...state, players, setupDone: newDone };
    newState = addLog(newState, `${player.name} 完成準備。`, null);

    if (newDone[0] && newDone[1]) {
      // 雙方都完成 → 進入正式對戰，由擲硬幣決定的先手方先行動
      newState = {
        ...newState,
        phase: 'playing',
        turnPhase: 'main',
        activePlayerIndex: state.firstPlayerIdx,
        isFirstTurn: true,
      };
      newState = addLog(newState, `Setup 完成！${state.players[state.firstPlayerIdx].name} 先手行動中。`, null);
    }
    return newState;
  }

  return state;
}

// ── 自動抽牌（每回合開始時呼叫，回傳 turnPhase='main' 的新 state）────────────

function applyAutoDraw(state: GameState): GameState {
  const aIdx = state.activePlayerIndex;
  const dIdx = (1 - aIdx) as 0 | 1;
  const player = state.players[aIdx];
  if (player.deck.length === 0) {
    return {
      ...state, phase: 'game-over',
      winner: dIdx,
      winReason: `${player.name} 牌組耗盡，無法抽牌`,
      log: [...state.log, { turn: state.turn, playerIndex: null,
        message: `${player.name} 無法抽牌，${state.players[dIdx].name} 獲勝！` }],
    };
  }
  const drawn = player.deck[0];
  const newPlayer = { ...player, deck: player.deck.slice(1), hand: [...player.hand, drawn] };
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = newPlayer;
  return addLog(
    { ...state, players, turnPhase: 'main' },
    `${player.name} 抽了 1 張牌（手牌 ${newPlayer.hand.length} 張）`,
    aIdx
  );
}

// ── 正式對戰動作處理 ─────────────────────────────────────────────────────────

function handlePlaying(
  state: GameState,
  action: GameAction,
  pool: Map<string, Card>
): GameState {
  const aIdx = state.activePlayerIndex;
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const attacker = { ...players[aIdx] };
  const defender = { ...players[dIdx] };

  // ── 若有待選擇，只允許 RESOLVE_SELECTION ────────────────────────────────
  if (state.pendingSelection && action.type !== 'RESOLVE_SELECTION') return state;

  // ── 選擇解析 ──────────────────────────────────────────────────────────────
  if (action.type === 'RESOLVE_SELECTION') {
    if (!state.pendingSelection) return state;
    const { effectKey, actorIdx, params } = state.pendingSelection;
    const endTurnAfter = params?.endTurnAfter === true;
    const resolver = RESOLVERS.get(effectKey);
    let newState: GameState = { ...state, pendingSelection: undefined };
    if (resolver) {
      newState = resolver(newState, actorIdx, action.selectedIids, params, pool);
    }
    // 若為招式觸發的互動效果，解決後進入回合結束（不再有連鎖 pendingSelection 時才設）
    if (endTurnAfter && !newState.pendingSelection) {
      newState = { ...newState, turnPhase: 'end' };
    }
    return newState;
  }

  // ── 從手牌打出基礎寶可夢到備戰區 ─────────────────────────────────────────
  if (action.type === 'PLAY_BASIC') {
    if (state.turnPhase !== 'main') return state;
    if (attacker.bench.length >= 5) return state;
    const hIdx = attacker.hand.findIndex(c => c.iid === action.iid);
    if (hIdx < 0) return state;
    const inst = attacker.hand[hIdx];
    const card = pool.get(inst.cardId);
    if (!card || card.supertype !== 'Pokemon' || card.subtype !== 'Basic') return state;

    const placed = { ...inst, justPlaced: true };
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);
    attacker.bench = [...attacker.bench, placed];
    players[aIdx] = attacker;
    return addLog(
      { ...state, players },
      `${attacker.name} 將 ${card.name} 放到備戰區`,
      aIdx
    );
  }

  // ── 進化 ──────────────────────────────────────────────────────────────────
  if (action.type === 'EVOLVE') {
    if (state.turnPhase !== 'main') return state;
    if (state.isFirstTurn) return state; // 第一回合不能進化

    // 在手牌找進化卡
    const evoHIdx = attacker.hand.findIndex(c => c.iid === action.toIid);
    if (evoHIdx < 0) return state;
    const evoInst = attacker.hand[evoHIdx];
    const evoCard = pool.get(evoInst.cardId);
    if (!evoCard || evoCard.supertype !== 'Pokemon' || !evoCard.evolvesFrom) return state;

    // 在場上（出場或備戰）找基底
    let basePoke: CardInstance | null = null;
    let isActive = false;
    if (attacker.active?.iid === action.fromIid) {
      basePoke = attacker.active; isActive = true;
    } else {
      basePoke = attacker.bench.find(c => c.iid === action.fromIid) ?? null;
    }
    if (!basePoke) return state;
    if (basePoke.justPlaced || basePoke.evolvedThisTurn) return state;

    const baseCard = pool.get(basePoke.cardId);
    if (!baseCard) return state;
    if (evoCard.evolvesFrom !== baseCard.name) return state;

    // 進化：繼承傷害、能量、狀態；進化鏈堆疊保留被進化掉的 cardId
    const prevChain = basePoke.evolvedFromCardIds ?? [];
    const evolved: CardInstance = {
      ...evoInst,
      damage: basePoke.damage,
      energyAttached: basePoke.energyAttached,
      toolAttached: basePoke.toolAttached,
      status: basePoke.status,
      evolvedFromIid: basePoke.iid,
      evolvedFromCardIds: [...prevChain, basePoke.cardId],
      evolvedThisTurn: true,
      justPlaced: false,
    };

    attacker.hand = attacker.hand.filter((_, i) => i !== evoHIdx);
    if (isActive) {
      attacker.active = evolved;
    } else {
      attacker.bench = attacker.bench.map(c => c.iid === action.fromIid ? evolved : c);
    }
    players[aIdx] = attacker;
    return addLog(
      { ...state, players },
      `${attacker.name} 的 ${baseCard.name} 進化為 ${evoCard.name}！`,
      aIdx
    );
  }

  // ── 撤退 ──────────────────────────────────────────────────────────────────
  if (action.type === 'RETREAT') {
    if (state.turnPhase !== 'main') return state;
    if (attacker.retreatedThisTurn) return state;
    if (!attacker.active) return state;
    // 睡眠和麻痺時無法撤退
    if (attacker.active.status === 'asleep' || attacker.active.status === 'paralyzed') return state;
    if (attacker.bench.length === 0) return state;

    const bIdx = attacker.bench.findIndex(c => c.iid === action.newActiveIid);
    if (bIdx < 0) return state;

    const activeCard = pool.get(attacker.active.cardId);
    let retreatCost = activeCard?.retreatCost?.length ?? 0;
    // 氣球道具：減少 2 撤退費
    const retreatTool = attacker.active.toolAttached ? pool.get(attacker.active.toolAttached.cardId) : null;
    if (retreatTool?.name === '氣球') retreatCost = Math.max(0, retreatCost - 2);
    // 被動特性：天空徑線（拉帝亞斯ex）— 基礎寶可夢免費撤退
    const hasSkyPathR = [
      ...(attacker.active ? [attacker.active] : []),
      ...attacker.bench,
    ].some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '天空徑線'));
    if (hasSkyPathR && activeCard?.subtype === 'Basic') retreatCost = 0;
    if (attacker.active.energyAttached.length < retreatCost) return state;

    // 自動丟棄能量（從後方取）
    const discardE = attacker.active.energyAttached.slice(-retreatCost);
    const keepE = attacker.active.energyAttached.slice(0, attacker.active.energyAttached.length - retreatCost);
    const retreatingPoke = { ...attacker.active, energyAttached: keepE };
    const newActive = { ...attacker.bench[bIdx] };
    const newBench = attacker.bench.filter((_, i) => i !== bIdx);
    newBench.push(retreatingPoke);

    attacker.active = newActive;
    attacker.bench = newBench;
    attacker.discard = [...attacker.discard, ...discardE];
    attacker.retreatedThisTurn = true;
    players[aIdx] = attacker;

    const newActiveCard = pool.get(newActive.cardId);
    return addLog(
      { ...state, players },
      `${attacker.name} 的 ${activeCard?.name ?? '?'} 撤退，${newActiveCard?.name ?? '?'} 上場！`,
      aIdx
    );
  }

  // ── 打出訓練家牌（含道具卡 Tool 和競技場 Stadium）──────────────────────────
  if (action.type === 'PLAY_TRAINER') {
    if (state.turnPhase !== 'main') return state;
    const hIdx = attacker.hand.findIndex(c => c.iid === action.iid);
    if (hIdx < 0) return state;
    const trainerInst = attacker.hand[hIdx];
    const trainerCard = pool.get(trainerInst.cardId);
    if (!trainerCard) return state;

    const isTool = trainerCard.supertype === 'Pokemon' && trainerCard.subtype === 'Other';
    const isTrainer = trainerCard.supertype === 'Trainer';
    if (!isTool && !isTrainer) return state;

    // 支援者限制：每回合只能打 1 張
    if (trainerCard.subtype === 'Supporter' && attacker.supporterPlayedThisTurn) return state;

    // 義務性前置檢查：夜間擔架棄牌為空、寶可夢交替備戰為空等情況禁止打出
    if (!canPlayTrainer(trainerCard.name, state, aIdx, pool)) return state;

    // 移出手牌
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);

    if (trainerCard.subtype === 'Stadium') {
      // 競技場：放置到場；前一張競技場去棄牌區
      const prevStadium = state.activeStadium;
      if (prevStadium) attacker.discard = [...attacker.discard, prevStadium];
      players[aIdx] = attacker;
      let newState: GameState = { ...state, players, activeStadium: trainerInst };
      newState = addLog(newState, `${attacker.name} 打出競技場：${trainerCard.name}！`, aIdx);
      const effectFn = TRAINER_EFFECTS.get(trainerCard.name);
      if (effectFn) return effectFn(newState, aIdx, pool, trainerInst);
      return newState;
    }

    if (isTool) {
      // 道具卡：不先棄置，效果 resolver 會將它附加到寶可夢
      players[aIdx] = attacker;
      let newState: GameState = { ...state, players };
      const effectFn = TRAINER_EFFECTS.get(trainerCard.name);
      if (effectFn) return effectFn(newState, aIdx, pool, trainerInst);
      return addLog(newState, `${trainerCard.name}（道具）效果尚未實裝`, aIdx);
    }

    // 一般訓練家（物品 / 支援者）
    attacker.discard = [...attacker.discard, trainerInst];
    if (trainerCard.subtype === 'Supporter') attacker.supporterPlayedThisTurn = true;
    players[aIdx] = attacker;

    let newState: GameState = { ...state, players };

    const effectFn = TRAINER_EFFECTS.get(trainerCard.name);
    if (effectFn) {
      return effectFn(newState, aIdx, pool, trainerInst);
    }
    // 效果尚未實裝
    return addLog(
      newState,
      `${trainerCard.name}（${trainerCard.subtype}）效果尚未實裝，已棄置`,
      aIdx
    );
  }

  // ── 使用競技場效果 ────────────────────────────────────────────────────────
  if (action.type === 'USE_STADIUM') {
    if (state.phase !== 'playing' || state.turnPhase !== 'main') return state;
    if (!state.activeStadium) return state;
    const used = state.stadiumUsedThisTurn ?? [false, false];
    if (used[aIdx]) return state; // 已使用過
    if (state.pendingSelection) return state;

    const stadiumCard = pool.get(state.activeStadium.cardId);
    if (!stadiumCard) return state;

    // 標記已使用
    const newUsed: [boolean, boolean] = [used[0], used[1]];
    newUsed[aIdx] = true;
    let newState: GameState = { ...state, stadiumUsedThisTurn: newUsed };

    if (stadiumCard.name === '神秘花園') {
      const player = newState.players[aIdx];
      const energyInHand = player.hand.filter(inst => {
        const c = pool.get(inst.cardId);
        return c?.supertype === 'Energy';
      });
      if (energyInHand.length === 0) {
        // 無能量可丟，重置旗標
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog(
          { ...state, stadiumUsedThisTurn: revert },
          '神秘花園：手牌中沒有能量牌可丟棄',
          aIdx
        );
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'hand-discard',
          actorIdx: aIdx,
          sourcePlayerIdx: aIdx,
          minCount: 1,
          maxCount: 1,
          filter: 'Energy',
          effectKey: 'miracle-garden-draw',
          params: {},
        },
      };
    }

    return addLog(newState, `使用競技場效果：${stadiumCard.name}`, aIdx);
  }

  // ── 使用主動特性 ───────────────────────────────────────────────────────────
  if (action.type === 'USE_ABILITY') {
    if (state.turnPhase !== 'main') return state;
    if (state.pendingSelection) return state;

    // 找到目標寶可夢（出場或備戰）
    const allPokes: CardInstance[] = [
      ...(attacker.active ? [attacker.active] : []),
      ...attacker.bench,
    ];
    const targetPoke = allPokes.find(c => c.iid === action.iid);
    if (!targetPoke) return state;

    // 檢查是否已用過特性
    if (targetPoke.abilityUsedThisTurn) return state;

    const pokeCard = pool.get(targetPoke.cardId);
    const ability = pokeCard?.abilities?.[action.abilityIndex];
    if (!ability) return state;

    // 集客（米立龍）限制：只有在出場時才能使用
    if (ability.name === '集客' && attacker.active?.iid !== action.iid) return state;

    // 查找 ABILITY_EFFECTS
    const abilityFn = ABILITY_EFFECTS.get(`${pokeCard!.name}|${action.abilityIndex}`);
    if (!abilityFn) return state;

    // 標記已使用
    const markUsed = (c: CardInstance): CardInstance =>
      c.iid === action.iid ? { ...c, abilityUsedThisTurn: true } : c;
    const updatedPlayers = [...state.players] as [PlayerState, PlayerState];
    const updatedP = { ...updatedPlayers[aIdx] };
    updatedP.active = updatedP.active ? markUsed(updatedP.active) : null;
    updatedP.bench = updatedP.bench.map(markUsed);
    updatedPlayers[aIdx] = updatedP;

    let newState: GameState = addLog(
      { ...state, players: updatedPlayers },
      `${attacker.name} 使用了 ${pokeCard!.name} 的特性「${ability.name}」！`,
      aIdx
    );
    return abilityFn(newState, aIdx, pool);
  }

  // ── 抽牌 ──────────────────────────────────────────────────────────────────
  if (action.type === 'DRAW_CARD') {
    if (state.turnPhase !== 'draw') return state;
    if (attacker.deck.length === 0) {
      // 牌組沒牌 → 對手勝
      return {
        ...state, phase: 'game-over',
        winner: dIdx,
        winReason: `${attacker.name} 牌組耗盡，無法抽牌`,
        log: [...state.log, { turn: state.turn, playerIndex: null, message: `${attacker.name} 無法抽牌，${defender.name} 獲勝！` }]
      };
    }
    const drawn = attacker.deck[0];
    attacker.deck = attacker.deck.slice(1);
    attacker.hand = [...attacker.hand, drawn];
    players[aIdx] = attacker;
    return addLog(
      { ...state, players, turnPhase: 'main' },
      `${attacker.name} 抽了 1 張牌（手牌 ${attacker.hand.length} 張）`,
      aIdx
    );
  }

  // ── 附加能量 ──────────────────────────────────────────────────────────────
  if (action.type === 'ATTACH_ENERGY') {
    if (state.turnPhase !== 'main') return state;
    if (attacker.energyAttachedThisTurn) return state; // 每回合限 1 張

    const eIdx = attacker.hand.findIndex((c) => c.iid === action.energyIid);
    if (eIdx < 0) return state;
    const energyCard = attacker.hand[eIdx];
    if (!isEnergy(energyCard.cardId, pool)) return state;

    // 找目標寶可夢（出場或備戰）
    let target: CardInstance | null = null;
    if (attacker.active?.iid === action.targetIid) {
      target = attacker.active;
    } else {
      target = attacker.bench.find((c) => c.iid === action.targetIid) ?? null;
    }
    if (!target) return state;

    // 附加
    target = { ...target, energyAttached: [...target.energyAttached, energyCard] };
    attacker.hand = attacker.hand.filter((_, i) => i !== eIdx);
    attacker.energyAttachedThisTurn = true;

    // 更新 attacker state
    if (attacker.active?.iid === target.iid) attacker.active = target;
    else attacker.bench = attacker.bench.map((c) => (c.iid === target!.iid ? target! : c));

    const targetCard = getCard(target.cardId, pool);
    players[aIdx] = attacker;
    return addLog(
      { ...state, players },
      `${attacker.name} 將能量附加到 ${targetCard.name}`,
      aIdx
    );
  }

  // ── 宣告招式 ──────────────────────────────────────────────────────────────
  if (action.type === 'ATTACK') {
    if (state.turnPhase !== 'main') return state;
    if (state.isFirstTurn && aIdx === state.firstPlayerIdx) return state; // 先手第 1 回合不能攻擊
    if (!attacker.active) return state;
    if (!defender.active) return state;

    const atkNameForStatus = pool.get(attacker.active.cardId)?.name ?? '?';

    // 特殊狀態：睡眠 — 無法攻擊
    if (attacker.active.status === 'asleep') {
      return addLog({ ...state, players, turnPhase: 'end' },
        `${atkNameForStatus} 正在睡眠，無法使用招式！`, aIdx);
    }
    // 特殊狀態：麻痺 — 無法攻擊
    if (attacker.active.status === 'paralyzed') {
      return addLog({ ...state, players, turnPhase: 'end' },
        `${atkNameForStatus} 正在麻痺，無法使用招式！`, aIdx);
    }
    // 特殊狀態：混亂 — 擲硬幣，反面自身受30傷害且攻擊失敗
    if (attacker.active.status === 'confused') {
      const coin = Math.random() < 0.5;
      if (!coin) {
        const selfDmg = (attacker.active.damage ?? 0) + 30;
        players[aIdx] = { ...attacker, active: { ...attacker.active, damage: selfDmg } };
        return addLog({ ...state, players, turnPhase: 'end' },
          `${atkNameForStatus} 陷入混亂，自身受到 30 傷害，攻擊失敗！`, aIdx);
      }
      // 正面：繼續正常攻擊
    }

    // 檢查是否因上回合效果而無法攻擊
    if (attacker.active.cantAttackThisTurn) {
      const atkName = pool.get(attacker.active.cardId)?.name ?? '?';
      players[aIdx] = { ...attacker, active: { ...attacker.active, cantAttackThisTurn: undefined } };
      return addLog(
        { ...state, players, turnPhase: 'end' },
        `${atkName} 因上回合效果，本回合無法使用招式！`,
        aIdx
      );
    }

    const attackerCard = getCard(attacker.active.cardId, pool);
    const attacks = attackerCard.attacks ?? [];
    const attack = attacks[action.attackIndex];
    if (!attack) return state;

    // 確認能量足夠
    if (!canAffordAttack(attacker.active, attack.cost, pool)) return state;

    // ── 招式前置效果（修改傷害 / 丟棄能量等）────────────────────────────────
    const effectKey = `${attackerCard.name}|${attack.name}`;
    const preFn = ATTACK_PRE.get(effectKey);
    let workingState: GameState = { ...state, players };
    let baseDamage = parseInt(attack.damage ?? '0', 10) || 0;
    if (preFn) {
      const preResult = preFn(workingState, aIdx, pool);
      workingState = preResult.state;
      baseDamage = preResult.damage;
    }

    // 弱點（×2）— 只對有實際傷害的招式套用
    const defenderCard = getCard(defender.active.cardId, pool);
    if (baseDamage > 0 && defenderCard.weakness && attackerCard.pokemonType === defenderCard.weakness.type) {
      baseDamage *= 2;
    }

    // 被動特性：鑽石膜（超級蒂安希ex）— 受到招式傷害 -30
    if (baseDamage > 0 && defenderCard.abilities?.some(a => a.name === '鑽石膜')) {
      baseDamage = Math.max(0, baseDamage - 30);
    }

    // 施加傷害
    const defPlayers = [...workingState.players] as [PlayerState, PlayerState];
    const defenderState = { ...defPlayers[dIdx] };
    if (!defenderState.active) return state;
    const newDamage = defenderState.active.damage + baseDamage;
    const defenderHP = defenderCard.hp ?? 0;

    // 被動特性：影藏（超級耿鬼ex）— 惡寶可夢被 ex 擊倒時，獎勵牌 -1
    let prizeAdjust = 0;
    if (baseDamage > 0 && newDamage >= defenderHP) {
      const isExAttacker = attackerCard.name.endsWith('ex') || attackerCard.name.endsWith('EX');
      const isDefenderDark = defenderCard.pokemonType === 'Darkness';
      const defenderHasKageHide = defender.bench.some(c => {
        const bc = pool.get(c.cardId);
        return bc?.abilities?.some(a => a.name === '影藏');
      }) || (defender.active && pool.get(defender.active.cardId)?.abilities?.some(a => a.name === '影藏'));
      if (isExAttacker && isDefenderDark && defenderHasKageHide) {
        prizeAdjust = -1;
      }
    }

    let newState: GameState = addLog(
      workingState,
      `${attacker.name} 的 ${attackerCard.name} 使出「${attack.name}」` +
        (baseDamage > 0 ? `，造成 ${baseDamage} 傷害！` : '！'),
      aIdx
    );

    // 龐克頭盔：防守方出場的【惡】寶可夢附有龐克頭盔時，攻擊者受到 40 傷害反擊
    const defenderStatePre = newState.players[dIdx];
    const defToolCard = defenderStatePre.active?.toolAttached
      ? pool.get(defenderStatePre.active.toolAttached.cardId) : null;
    const defActiveCardPre = defenderStatePre.active ? pool.get(defenderStatePre.active.cardId) : null;
    if (baseDamage > 0 && defToolCard?.name === '龐克頭盔' && defActiveCardPre?.pokemonType === 'Darkness') {
      const atkPlayers = [...newState.players] as [PlayerState, PlayerState];
      const atkP = { ...atkPlayers[aIdx] };
      if (atkP.active) {
        atkP.active = { ...atkP.active, damage: atkP.active.damage + 40 };
        atkPlayers[aIdx] = atkP;
        newState = addLog({ ...newState, players: atkPlayers }, `龐克頭盔：${attackerCard.name} 受到 40 傷害反擊！`, null);
      }
    }

    // 擊倒判定
    if (baseDamage > 0 && defenderHP > 0 && newDamage >= defenderHP) {
      const updatedActive = { ...defenderState.active, damage: newDamage };
      const koDiscard: CardInstance[] = [
        updatedActive,
        ...updatedActive.energyAttached,
        ...(updatedActive.toolAttached ? [updatedActive.toolAttached] : []),
      ];
      defenderState.discard = [...defenderState.discard, ...koDiscard];
      defenderState.active = null;
      const prizes = Math.max(1, prizesForKO(defenderCard) + prizeAdjust);
      defPlayers[dIdx] = defenderState;
      newState = {
        ...newState, players: defPlayers,
        pendingPrizes: prizes, turnPhase: 'end',
      };
      newState = addLog(newState, `${defenderCard.name} 被擊倒！${attacker.name} 取得 ${prizes} 張獎勵牌。`, null);

      // 無備戰寶可夢 → 直接終局，不需送出新寶可夢
      if (defenderState.bench.length === 0) {
        return {
          ...newState,
          phase: 'game-over',
          winner: aIdx,
          winReason: `${defenderState.name} 沒有可上場的寶可夢`,
          log: [
            ...newState.log,
            { turn: newState.turn, playerIndex: null as null, message: `${defenderState.name} 沒有可上場的寶可夢，${attacker.name} 獲勝！` },
          ],
        };
      }
    } else {
      defenderState.active = { ...defenderState.active!, damage: newDamage };
      defPlayers[dIdx] = defenderState;
      newState = { ...newState, players: defPlayers, turnPhase: 'end' };
    }

    // ── 招式後置效果（回復、移動能量、觸發 pendingSelection 等）──────────────
    const postFn = ATTACK_POST.get(effectKey);
    if (postFn) {
      newState = postFn(newState, aIdx, pool);
    }

    return newState;
  }

  // ── 取獎勵牌 ──────────────────────────────────────────────────────────────
  if (action.type === 'TAKE_PRIZES') {
    if (state.pendingPrizes <= 0) return state;
    const count = Math.min(action.count, attacker.prizes.length, state.pendingPrizes);
    const taken = attacker.prizes.slice(0, count);
    attacker.prizes = attacker.prizes.slice(count);
    attacker.hand = [...attacker.hand, ...taken];
    players[aIdx] = attacker;

    let newState: GameState = addLog(
      { ...state, players, pendingPrizes: 0 },
      `${attacker.name} 取得了 ${count} 張獎勵牌（剩餘 ${attacker.prizes.length} 張）`,
      aIdx
    );

    // 勝利條件：獎勵牌全取完
    if (attacker.prizes.length <= 0) {
      return {
        ...newState,
        phase: 'game-over',
        winner: aIdx,
        winReason: `${attacker.name} 取得所有獎勵牌`,
        log: [...newState.log, { turn: newState.turn, playerIndex: null, message: `${attacker.name} 取得所有獎勵牌，獲勝！` }]
      };
    }

    return newState;
  }

  // ── 對手送出新的出場寶可夢（被擊倒後） ──────────────────────────────────
  if (action.type === 'SEND_NEW_ACTIVE') {
    // senderIdx 明確指定時使用（線上模式），否則回落到 aIdx（本機模式）
    const sendingIdx: 0 | 1 = action.senderIdx ?? aIdx;
    const sendingPlayer = { ...players[sendingIdx] };

    if (sendingPlayer.active !== null) return state; // 還有出場寶可夢

    const benchIdx = sendingPlayer.bench.findIndex((c) => c.iid === action.iid);
    if (benchIdx < 0) return state;

    const newActive = sendingPlayer.bench[benchIdx];
    sendingPlayer.bench = sendingPlayer.bench.filter((_, i) => i !== benchIdx);
    sendingPlayer.active = newActive;

    players[sendingIdx] = sendingPlayer;
    const newActiveCard = getCard(newActive.cardId, pool);

    let newState: GameState = addLog(
      { ...state, players },
      `${sendingPlayer.name} 送出了 ${newActiveCard.name}！`,
      sendingIdx
    );

    // 勝利條件：對手無法送出寶可夢（在送出前就要先檢查，這裡是送出後）
    return newState;
  }

  // ── 結束回合 ──────────────────────────────────────────────────────────────
  if (action.type === 'END_TURN') {
    if (state.pendingPrizes > 0) return state;  // 取獎勵前不能結束
    if (defender.active === null) return state; // 對手必須先送出寶可夢

    // 勝利條件：對手備戰區也空了（雙重保險）
    if (defender.bench.length === 0 && defender.active === null) {
      return {
        ...state, phase: 'game-over',
        winner: aIdx,
        winReason: `${defender.name} 沒有可上場的寶可夢`,
      };
    }

    // 特殊狀態：中毒 — 回合結束施加 10 傷害
    const poisonPlayer = { ...players[aIdx] };
    if (poisonPlayer.active?.status === 'poisoned') {
      const poisonedCard = pool.get(poisonPlayer.active.cardId);
      const newDmg = poisonPlayer.active.damage + 10;
      const poisonedHP = poisonedCard?.hp ?? 0;
      if (poisonedHP > 0 && newDmg >= poisonedHP) {
        // 被毒死 → 直接 KO，攻擊方（對手）取獎勵
        const dIdxP = dIdx;
        const koDiscard2: CardInstance[] = [
          { ...poisonPlayer.active, damage: newDmg },
          ...poisonPlayer.active.energyAttached,
          ...(poisonPlayer.active.toolAttached ? [poisonPlayer.active.toolAttached] : []),
        ];
        poisonPlayer.discard = [...poisonPlayer.discard, ...koDiscard2];
        poisonPlayer.active = null;
        players[aIdx] = poisonPlayer;
        const poisonPrizes = prizesForKO(poisonedCard!);
        let poisonState = addLog(
          { ...state, players },
          `${poisonedCard?.name ?? '?'} 被中毒傷害擊倒！${players[dIdxP].name} 取得 ${poisonPrizes} 張獎勵牌。`,
          null
        );
        if (poisonPlayer.bench.length === 0) {
          return {
            ...poisonState, phase: 'game-over',
            winner: dIdxP,
            winReason: `${poisonPlayer.name} 沒有可上場的寶可夢`,
          };
        }
        return { ...poisonState, pendingPrizes: poisonPrizes };
      } else {
        poisonPlayer.active = { ...poisonPlayer.active, damage: newDmg };
        players[aIdx] = poisonPlayer;
        // 將中毒傷害記錄寫入 state（parameters 可重新賦值）
        state = addLog({ ...state, players }, `中毒：${pool.get(poisonPlayer.active.cardId)?.name ?? '?'} 受到 10 傷害！`, null);
      }
    }

    // 特殊狀態：燒傷 — 回合結束施加 20 傷害，然後擲硬幣決定是否解除
    const burnedPlayer = { ...players[aIdx] };
    if (burnedPlayer.active?.status === 'burned') {
      const burnedCard = pool.get(burnedPlayer.active.cardId);
      const newBurnDmg = burnedPlayer.active.damage + 20;
      const burnedHP = burnedCard?.hp ?? 0;
      if (burnedHP > 0 && newBurnDmg >= burnedHP) {
        // 燒傷致死
        const koDiscard3: CardInstance[] = [
          { ...burnedPlayer.active, damage: newBurnDmg },
          ...burnedPlayer.active.energyAttached,
          ...(burnedPlayer.active.toolAttached ? [burnedPlayer.active.toolAttached] : []),
        ];
        burnedPlayer.discard = [...burnedPlayer.discard, ...koDiscard3];
        burnedPlayer.active = null;
        players[aIdx] = burnedPlayer;
        const burnPrizes = prizesForKO(burnedCard!);
        let burnState = addLog({ ...state, players }, `${burnedCard?.name ?? '?'} 被燒傷傷害擊倒！${players[dIdx].name} 取得 ${burnPrizes} 張獎勵牌。`, null);
        if (burnedPlayer.bench.length === 0) {
          return { ...burnState, phase: 'game-over', winner: dIdx, winReason: `${burnedPlayer.name} 沒有可上場的寶可夢` };
        }
        return { ...burnState, pendingPrizes: burnPrizes };
      } else {
        // 燒傷傷害但未倒
        burnedPlayer.active = { ...burnedPlayer.active, damage: newBurnDmg };
        // 擲硬幣：正面解除燒傷
        const burnCoin = Math.random() < 0.5;
        if (burnCoin) {
          burnedPlayer.active = { ...burnedPlayer.active, status: undefined };
        }
        players[aIdx] = burnedPlayer;
        state = addLog({ ...state, players }, `燒傷：${burnedCard?.name ?? '?'} 受到 20 傷害！${burnCoin ? '（正面：燒傷解除）' : '（反面：燒傷持續）'}`, null);
      }
    }

    // 特殊狀態：麻痺 — 自動解除（回合結束後）
    const paraPlayer = { ...players[aIdx] };
    if (paraPlayer.active?.status === 'paralyzed') {
      paraPlayer.active = { ...paraPlayer.active, status: undefined };
      players[aIdx] = paraPlayer;
      state = addLog({ ...state, players }, `${pool.get(paraPlayer.active.cardId)?.name ?? '?'} 的麻痺解除了！`, null);
    }

    // 特殊狀態：睡眠 — 擲硬幣決定是否醒來（在回合結束時檢查）
    const sleepPlayer = { ...players[aIdx] };
    if (sleepPlayer.active?.status === 'asleep') {
      const wakeCoin = Math.random() < 0.5;
      if (wakeCoin) {
        sleepPlayer.active = { ...sleepPlayer.active, status: undefined };
        players[aIdx] = sleepPlayer;
        state = addLog({ ...state, players }, `${pool.get(sleepPlayer.active.cardId)?.name ?? '?'} 醒來了！`, null);
      }
    }

    // 清除當前玩家的回合旗標（justPlaced / evolvedThisTurn / abilityUsedThisTurn）
    const currentPlayer = { ...players[aIdx] };
    currentPlayer.active = currentPlayer.active ? clearTurnFlags(currentPlayer.active) : null;
    currentPlayer.bench = currentPlayer.bench.map(clearTurnFlags);
    // 清除特性使用旗標
    const clearAbilityFlag = (c: CardInstance): CardInstance => {
      if (!c.abilityUsedThisTurn) return c;
      const n = { ...c }; delete n.abilityUsedThisTurn; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearAbilityFlag(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearAbilityFlag);
    players[aIdx] = currentPlayer;

    // 重置次方玩家的回合限制旗標
    const nextIdx = dIdx;
    players[nextIdx] = {
      ...players[nextIdx],
      energyAttachedThisTurn: false,
      supporterPlayedThisTurn: false,
      retreatedThisTurn: false,
    };

    // 重置競技場使用旗標（當前玩家的回合結束時清除其旗標）
    let stadiumUsedThisTurn = state.stadiumUsedThisTurn ?? [false, false] as [boolean, boolean];
    const newStadiumUsed: [boolean, boolean] = [stadiumUsedThisTurn[0], stadiumUsedThisTurn[1]];
    newStadiumUsed[aIdx] = false;

    const newTurn = aIdx === 1 ? state.turn + 1 : state.turn;
    const afterSwitch = addLog(
      {
        ...state,
        players,
        activePlayerIndex: nextIdx,
        turn: newTurn,
        isFirstTurn: false,
        turnPhase: 'draw',
        stadiumUsedThisTurn: newStadiumUsed,
      },
      `回合結束，換 ${players[nextIdx].name} 行動。`,
      null
    );
    // 自動抽牌（每回合開始規定，不需要玩家手動點擊）
    return applyAutoDraw(afterSwitch);
  }

  return state;
}

// ── 主要 applyAction ─────────────────────────────────────────────────────────

/**
 * 主要引擎入口：接收現有 state + 動作 → 回傳新 state。
 * 所有遊戲邏輯都在這裡分派。
 */
export function applyAction(
  state: GameState,
  action: GameAction,
  pool: Map<string, Card>
): GameState {
  if (state.phase === 'game-over') return state;

  if (state.phase === 'setup') {
    return handleSetup(state, action, pool);
  }

  if (state.phase === 'playing') {
    return handlePlaying(state, action, pool);
  }

  return state;
}

// ── 輔助查詢 ─────────────────────────────────────────────────────────────────

/** 列出目前行動玩家可使用的招式（已滿足能量需求的） */
export function getAvailableAttacks(
  state: GameState,
  pool: Map<string, Card>
): number[] {
  if (state.turnPhase !== 'main') return [];
  if (state.isFirstTurn && state.activePlayerIndex === state.firstPlayerIdx) return [];
  const player = state.players[state.activePlayerIndex];
  if (!player.active) return [];
  const card = pool.get(player.active.cardId);
  if (!card?.attacks) return [];
  return card.attacks
    .map((atk, i) => (canAffordAttack(player.active!, atk.cost, pool) ? i : -1))
    .filter((i) => i >= 0);
}

/** 判斷是否有待處理的緊急事項（需要先解決才能 END_TURN） */
export function hasPendingActions(state: GameState): boolean {
  return state.pendingPrizes > 0 ||
    !!state.pendingSelection ||
    state.players[state.activePlayerIndex].active === null;
}

/**
 * 列出目前行動玩家場上每隻寶可夢可接受哪些進化。
 * 回傳 { fromIid: 場上寶可夢 iid, toIids: 手牌中可進化的卡片 iid[] }[]
 */
export function getEvolvableTargets(
  state: GameState,
  pool: Map<string, Card>
): Array<{ fromIid: string; toIids: string[] }> {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return [];
  if (state.isFirstTurn) return [];
  const player = state.players[state.activePlayerIndex];

  // 手牌中的進化牌（有 evolvesFrom 且非基礎）
  const handEvos = player.hand.filter(inst => {
    const c = pool.get(inst.cardId);
    return c?.supertype === 'Pokemon' && c.evolvesFrom;
  });
  if (handEvos.length === 0) return [];

  const fieldPokemon: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];

  const result: Array<{ fromIid: string; toIids: string[] }> = [];
  for (const fp of fieldPokemon) {
    if (fp.justPlaced || fp.evolvedThisTurn) continue;
    const fpCard = pool.get(fp.cardId);
    if (!fpCard) continue;
    const validEvos = handEvos.filter(evo => pool.get(evo.cardId)?.evolvesFrom === fpCard.name);
    if (validEvos.length > 0) {
      result.push({ fromIid: fp.iid, toIids: validEvos.map(e => e.iid) });
    }
  }
  return result;
}

/**
 * 目前行動玩家是否可以撤退出場寶可夢。
 */
export function canRetreat(state: GameState, pool: Map<string, Card>): boolean {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return false;
  const player = state.players[state.activePlayerIndex];
  if (player.retreatedThisTurn || !player.active || player.bench.length === 0) return false;
  // 睡眠和麻痺時無法撤退
  if (player.active.status === 'asleep' || player.active.status === 'paralyzed') return false;
  const card = pool.get(player.active.cardId);
  let cost = card?.retreatCost?.length ?? 0;
  // 氣球道具：減少 2 撤退費
  const tool = player.active.toolAttached ? pool.get(player.active.toolAttached.cardId) : null;
  if (tool?.name === '氣球') cost = Math.max(0, cost - 2);
  // 被動特性：天空徑線（拉帝亞斯ex）— 所有基礎寶可夢免費撤退
  const hasSkyPath = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ].some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '天空徑線'));
  if (hasSkyPath && card?.subtype === 'Basic') cost = 0;
  return player.active.energyAttached.length >= cost;
}

/**
 * 列出手牌中可打出的訓練家牌 iid（考慮支援者限制）。
 */
export function getPlayableTrainers(state: GameState, pool: Map<string, Card>): string[] {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return [];
  if (state.pendingSelection) return [];
  const player = state.players[state.activePlayerIndex];
  return player.hand
    .filter(inst => {
      const c = pool.get(inst.cardId);
      if (!c) return false;
      const isTool = c.supertype === 'Pokemon' && c.subtype === 'Other';
      const isTrainer = c.supertype === 'Trainer';
      if (!isTool && !isTrainer) return false;
      if (c.subtype === 'Supporter' && player.supporterPlayedThisTurn) return false;
      // 義務性檢查：缺合法目標的卡不可打出
      if (!canPlayTrainer(c.name, state, state.activePlayerIndex, pool)) return false;
      return true;
    })
    .map(inst => inst.iid);
}

/**
 * 列出手牌中可打出到備戰區的基礎寶可夢 iid。
 */
export function getPlayableBasics(state: GameState, pool: Map<string, Card>): string[] {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return [];
  if (state.pendingSelection) return [];
  const player = state.players[state.activePlayerIndex];
  if (player.bench.length >= 5) return [];
  return player.hand
    .filter(inst => {
      const c = pool.get(inst.cardId);
      return c?.supertype === 'Pokemon' && c.subtype === 'Basic';
    })
    .map(inst => inst.iid);
}

/**
 * 列出目前行動玩家場上可使用的主動特性。
 * 回傳 { iid, abilityIndex, pokemonName, abilityName }[]
 */
export function getUsableAbilities(
  state: GameState,
  pool: Map<string, Card>
): Array<{ iid: string; abilityIndex: number; pokemonName: string; abilityName: string }> {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return [];
  if (state.pendingSelection) return [];
  const player = state.players[state.activePlayerIndex];
  const allPokes: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  const result: Array<{ iid: string; abilityIndex: number; pokemonName: string; abilityName: string }> = [];
  for (const pk of allPokes) {
    if (pk.abilityUsedThisTurn) continue;
    const card = pool.get(pk.cardId);
    if (!card?.abilities) continue;
    card.abilities.forEach((ab, abIdx) => {
      // 只列出在 ABILITY_EFFECTS 中有登錄的主動特性
      if (!ABILITY_EFFECTS.has(`${card.name}|${abIdx}`)) return;
      // 集客：只有出場才能用
      if (ab.name === '集客' && player.active?.iid !== pk.iid) return;
      result.push({ iid: pk.iid, abilityIndex: abIdx, pokemonName: card.name, abilityName: ab.name });
    });
  }
  return result;
}
