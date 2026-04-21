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
import {
  TRAINER_EFFECTS, RESOLVERS, ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, canPlayTrainer,
  PASSIVE_DAMAGE_REDUCE, PASSIVE_IMMUNITY, PASSIVE_RETALIATION, PASSIVE_ATTACK_BONUS,
  TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE,
  TOOL_PREVENT_KO, TOOL_ON_KO, TOOL_PRIZE_BONUS, TOOL_ON_DAMAGED,
  TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS,
  BENCH_PLACE_TRIGGERS, JAMMING_TOWER_STADIUMS,
  clearActiveEffects,
} from './effects';

// ── 阻礙之塔（阻礙道具發動）── 輔助判定 ──────────────────────────────────────
// 當場上活動球場為 JAMMING_TOWER_STADIUMS 所列球場時，雙方所有【道具】不發動效果。
// 這個閘門會包在所有 TOOL_* 查找上，讓道具的 HP 加成、攻擊 +N、退避減免等全部失效。
function isToolsJammed(state: GameState, pool: Map<string, Card>): boolean {
  const s = state.activeStadium;
  if (!s) return false;
  const card = pool.get(s.cardId);
  if (!card) return false;
  return JAMMING_TOWER_STADIUMS.has(card.name);
}

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

/**
 * 判斷一張 Card 物件是否為「基礎寶可夢」。
 *
 * ⚠️ 重要：不能只看 `subtype === 'Basic'`！
 * ex 基礎寶可夢（如拉帝亞斯ex / 蒂安希ex / 桃歹郎ex）的 `subtype` 是 `'ex'`，
 * 但它們沒有 `evolvesFrom`，規則上屬於基礎寶可夢、可直接出場/放備戰。
 * 正確判斷：supertype === 'Pokemon' 且沒有 evolvesFrom。
 *
 * 例外：道具卡（寶可夢道具）也是 Pokemon supertype 但 subtype === 'Other'，
 * 必須排除掉。
 */
export function isBasicPokemonCard(card: Card | undefined): card is Card {
  if (!card || card.supertype !== 'Pokemon') return false;
  if (card.subtype === 'Other') return false; // 道具卡
  return !card.evolvesFrom;
}

/** 從 pool 判斷一張牌是否為「基礎寶可夢」 */
function isBasicPokemon(cardId: string, pool: Map<string, Card>): boolean {
  return isBasicPokemonCard(pool.get(cardId));
}

/**
 * 判斷一張寶可夢卡是否為「2 階進化」。
 * 同樣不能只看 subtype === 'Stage2'（Stage2 ex 的 subtype 是 'ex'）。
 * 正確：`evolvesFrom` 指向的 Stage1 自己也有 `evolvesFrom`（即進化鏈深度 = 3）。
 */
export function isStage2PokemonCard(card: Card | undefined, pool: Map<string, Card>): boolean {
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  for (const c of pool.values()) {
    if (c.name === card.evolvesFrom && c.supertype === 'Pokemon' && c.evolvesFrom) return true;
  }
  return false;
}

/** 從 pool 判斷是否為能量牌 */
function isEnergy(cardId: string, pool: Map<string, Card>): boolean {
  return pool.get(cardId)?.supertype === 'Energy';
}

/**
 * 計算寶可夢的「有效 HP」— 基礎 HP + 附加道具的 HP 加成。
 * 被 KO 判定、UI 顯示血條都要用這個函式，而非直接讀 card.hp。
 */
export function getEffectiveHP(
  inst: CardInstance | null | undefined,
  pool: Map<string, Card>,
  state?: GameState
): number {
  if (!inst) return 0;
  const card = pool.get(inst.cardId);
  if (!card) return 0;
  let hp = card.hp ?? 0;
  // 阻礙之塔（Stadium）會讓道具 HP 加成失效；若未傳 state 則忽略此檢查
  const jammed = state ? isToolsJammed(state, pool) : false;
  if (inst.toolAttached && !jammed) {
    const tool = pool.get(inst.toolAttached.cardId);
    if (tool) {
      const bonusFn = TOOL_HP_BONUS.get(tool.name);
      if (bonusFn) hp += bonusFn(card);
    }
  }
  return hp;
}

/** 台灣卡牌中文屬性名稱 → EnergyType（當 pokemonType 欄位遺漏時備用） */
// 備註：台灣卡面使用「鬥」（例：基本【鬥】能量），舊卡曾用「格」；兩者同對應 Fighting。
const ZH_ENERGY_TYPE: Record<string, EnergyType> = {
  '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
  '超': 'Psychic', '格': 'Fighting', '鬥': 'Fighting',
  '惡': 'Darkness', '鋼': 'Metal',
  '妖': 'Fairy', '龍': 'Dragon', '無': 'Colorless',
};

/**
 * 取得一張能量卡提供的能量類型列表。
 * 基礎能量：1 個對應屬性；若 pokemonType 欄位未填，從卡名【X】推斷。
 * 特殊能量：M2 先一律視為 1 Colorless（M4 再完整實裝）。
 */
/**
 * 已知特殊能量 → 提供的能量屬性對應表。
 * 未列表的特殊能量依然依舊 fallback 為 1 個 Colorless。
 * 這裡只處理「屬性」——特殊能量的其他效果（例如硬岩的免疫效果）走 effects.ts / engine 層邏輯。
 */
const SPECIAL_ENERGY_TYPES: Record<string, EnergyType[]> = {
  '硬岩【鬥】能量': ['Fighting'],
};

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
  // 特殊能量：先查表；未登記者 fallback 為 Colorless
  if (SPECIAL_ENERGY_TYPES[c.name]) return SPECIAL_ENERGY_TYPES[c.name];
  return ['Colorless'];
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
export function prizesForKO(card: Card): number {
  const isEx = card.name.endsWith('ex') || card.name.endsWith('EX');
  // 超級進化寶可夢ex（Mega ex）：name 以「超級」開頭且為 ex → 3 張獎賞
  // 例：超級噴火龍Xex / 超級妙蛙花ex / 超級拉帝亞斯ex
  if (isEx && card.name.startsWith('超級')) return 3;
  // 一般 ex / V-STAR 等擊倒獲得 2 張
  if (isEx) return 2;
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

/** 清除 CardInstance 上的回合旗標（於擁有者 END_TURN 執行） */
function clearTurnFlags(c: CardInstance): CardInstance {
  if (!c.justPlaced && !c.evolvedThisTurn && !c.movedToActiveThisTurn) return c;
  const n = { ...c };
  delete n.justPlaced;
  delete n.evolvedThisTurn;
  delete n.movedToActiveThisTurn;
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

  // Mulligan 補抽不再自動完成 — 交給對手（非 mulligan 方）自己決定抽或不抽。
  // pendingMulliganDraw[0] = m2（P2 mulligan → P1 可補抽）
  // pendingMulliganDraw[1] = m1（P1 mulligan → P2 可補抽）

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
    pendingMulliganDraw: [m2, m1],
    log: [],
    pendingPrizes: 0,
    oppPrizesAtMyLastTurnEnd: [6, 6],
  };

  let st = addLog(state, `遊戲開始！${spec1.name} vs ${spec2.name}`, null);
  st = addLog(st, `🪙 擲硬幣：${state.players[firstPlayerIdx].name} 先手`, null);
  if (m1 > 0) st = addLog(st, `${spec1.name} 起手無基礎寶可夢，重抽懲罰 ${m1} 次 → ${spec2.name} 可選擇多抽 ${m1} 張`, 0);
  if (m2 > 0) st = addLog(st, `${spec2.name} 起手無基礎寶可夢，重抽懲罰 ${m2} 次 → ${spec1.name} 可選擇多抽 ${m2} 張`, 1);
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
    action.type !== 'FINISH_SETUP' &&
    action.type !== 'MULLIGAN_DRAW_DECISION'
  ) {
    return state;
  }
  const pIdx = action.senderIdx;

  // Mulligan 補抽決定 — 可在 setup 任何時候進行（即使已 FINISH_SETUP 也允許，
  // 雙方都要決定才能真正進入 playing；此處允許 setupDone 的玩家繼續處理 mulligan 決定）
  if (action.type === 'MULLIGAN_DRAW_DECISION') {
    const cur = state.pendingMulliganDraw?.[pIdx] ?? 0;
    if (cur <= 0) return state; // 沒有待決定
    const players = [...state.players] as [PlayerState, PlayerState];
    const player = { ...players[pIdx] };
    if (action.accept) {
      // 補抽 cur 張
      const draws = player.deck.slice(0, cur);
      player.deck = player.deck.slice(cur);
      player.hand = [...player.hand, ...draws];
    }
    players[pIdx] = player;
    const newPending = [...state.pendingMulliganDraw] as [number, number];
    newPending[pIdx] = 0;
    const msg = action.accept
      ? `${player.name} 選擇補抽 ${cur} 張（對手重抽懲罰補償）`
      : `${player.name} 放棄 ${cur} 張重抽懲罰補抽`;
    let next: GameState = {
      ...state, players, pendingMulliganDraw: newPending,
    };
    next = addLog(next, msg, pIdx);

    // 若雙方 setupDone 都已完成、且雙方 mulligan 決定也已完成 → 進入 playing
    if (next.setupDone[0] && next.setupDone[1]
        && next.pendingMulliganDraw[0] === 0 && next.pendingMulliganDraw[1] === 0
        && next.phase === 'setup') {
      next = {
        ...next,
        phase: 'playing',
        turnPhase: 'main',
        activePlayerIndex: next.firstPlayerIdx,
        isFirstTurn: true,
      };
      next = addLog(next, `Setup 完成！${next.players[next.firstPlayerIdx].name} 先手行動中。`, null);
    }
    return next;
  }

  // 已完成 setup 的玩家不能再操作（place/bench/finish）
  if (state.setupDone[pIdx]) return state;
  const player = { ...state.players[pIdx] };
  const players = [...state.players] as [PlayerState, PlayerState];

  if (action.type === 'PLACE_ACTIVE') {
    const iidx = player.hand.findIndex((c) => c.iid === action.iid);
    if (iidx < 0) return state;
    const card = player.hand[iidx];
    if (!isBasicPokemon(card.cardId, pool)) return state;
    if (player.active) {
      // 把舊的放回手牌（清除 justPlaced 以免帶回手牌後殘留）
      const returning = { ...player.active };
      delete returning.justPlaced;
      player.hand = [...player.hand, returning];
    }
    player.hand = player.hand.filter((_, i) => i !== iidx);
    // Setup 放的寶可夢設 justPlaced — 直到該玩家第一次 END_TURN 才能進化
    player.active = { ...card, justPlaced: true };
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
    // Setup 放的寶可夢設 justPlaced
    player.bench = [...player.bench, { ...card, justPlaced: true }];
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

    // 雙方都完成 setup + 雙方都已決定 mulligan 補抽 → 進入 playing
    const mul = newState.pendingMulliganDraw ?? [0, 0];
    if (newDone[0] && newDone[1] && mul[0] === 0 && mul[1] === 0) {
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
    // Guard：若明確指定 senderIdx，必須等於 actorIdx — 防止對手搶先操作
    if (action.senderIdx !== undefined && action.senderIdx !== actorIdx) return state;
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
    if (!isBasicPokemonCard(card)) return state;

    const placed = { ...inst, justPlaced: true };
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);
    attacker.bench = [...attacker.bench, placed];
    players[aIdx] = attacker;
    let afterPlace = addLog(
      { ...state, players },
      `${attacker.name} 將 ${card.name} 放到備戰區`,
      aIdx
    );
    // 觸發「放到備戰區」特性（例：喵喵ex｜殺手鐧捕捉）
    const placeFn = BENCH_PLACE_TRIGGERS.get(card.name);
    if (placeFn) afterPlace = placeFn(afterPlace, aIdx, pool);
    return afterPlace;
  }

  // ── 進化 ──────────────────────────────────────────────────────────────────
  if (action.type === 'EVOLVE') {
    if (state.turnPhase !== 'main') return state;
    if (state.isFirstTurn) return state; // 第一回合不能進化
    // Wave 39：玩家級進化鎖（例：青銅鐘｜進化妨礙者）
    if (attacker.cantEvolveThisTurn) return state;

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

    // 進化：繼承傷害、能量、狀態；進化鏈堆疊保留被進化掉的 CardInstance（裸殼，附加物轉給頂層）
    const prevStack = basePoke.evolvedFromStack ?? [];
    const baseBare: CardInstance = {
      ...basePoke,
      energyAttached: [],
      toolAttached: undefined,
      evolvedFromStack: undefined, // 避免遞迴巢狀
    };
    const evolved: CardInstance = {
      ...evoInst,
      damage: basePoke.damage,
      energyAttached: basePoke.energyAttached,
      toolAttached: basePoke.toolAttached,
      status: basePoke.status,
      evolvedFromIid: basePoke.iid,
      evolvedFromStack: [...prevStack, baseBare],
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
    // 招式效果「下個對手回合無法撤退」— cantRetreatNextTurn flag（v1.62）
    if (attacker.active.cantRetreatNextTurn) return state;
    if (attacker.bench.length === 0) return state;

    const bIdx = attacker.bench.findIndex(c => c.iid === action.newActiveIid);
    if (bIdx < 0) return state;

    const activeCard = pool.get(attacker.active.cardId);
    let retreatCost = activeCard?.retreatCost?.length ?? 0;
    // 道具撤退修正（氣球 / 緊急滑板 / 驅勁能量 未來）— 阻礙之塔時道具失效
    const toolsJammedR = isToolsJammed(state, pool);
    const retreatTool = (!toolsJammedR && attacker.active.toolAttached) ? pool.get(attacker.active.toolAttached.cardId) : null;
    if (retreatTool && activeCard) {
      const mod = TOOL_RETREAT_MOD.get(retreatTool.name);
      if (mod) {
        const r = mod(activeCard, attacker.active);
        if (r.zero) retreatCost = 0;
        else if (r.reduceBy) retreatCost = Math.max(0, retreatCost - r.reduceBy);
      }
    }
    // 重力之玉：雙方 active 任一帶此道具 → 雙方撤退 +1（阻礙之塔時失效）
    const bothPlusFromSelf = !toolsJammedR && attacker.active.toolAttached
      && TOOL_BOTH_SIDES_RETREAT_PLUS.has(pool.get(attacker.active.toolAttached.cardId)?.name ?? '');
    const bothPlusFromOpp = !toolsJammedR && defender.active?.toolAttached
      && TOOL_BOTH_SIDES_RETREAT_PLUS.has(pool.get(defender.active.toolAttached.cardId)?.name ?? '');
    if (bothPlusFromSelf || bothPlusFromOpp) retreatCost += 1;
    // 被動特性：天空徑線（拉帝亞斯ex）— 基礎寶可夢免費撤退
    const hasSkyPathR = [
      ...(attacker.active ? [attacker.active] : []),
      ...attacker.bench,
    ].some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '天空徑線'));
    if (hasSkyPathR && isBasicPokemonCard(activeCard)) retreatCost = 0;
    if (attacker.active.energyAttached.length < retreatCost) return state;

    // 自動丟棄能量（從後方取）
    const discardE = attacker.active.energyAttached.slice(-retreatCost);
    const keepE = attacker.active.energyAttached.slice(0, attacker.active.energyAttached.length - retreatCost);
    // v2.08：撤退回備戰時清除狀態旗標（灼傷/中毒/睡眠/混亂/麻痺 以及
    // 「離開戰鬥場前不能再用」類招式鎖），符合 PTCG 官方規則。
    const retreatingPoke = clearActiveEffects({ ...attacker.active, energyAttached: keepE });
    // Session 34：設 movedToActiveThisTurn，供「在這個回合若從備戰區放到戰鬥場」條件用
    const newActive = { ...attacker.bench[bIdx], movedToActiveThisTurn: true };
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
    // 先攻玩家第一回合不能使用支援者（PTCG 2020+ 規則）
    if (trainerCard.subtype === 'Supporter' && state.isFirstTurn && aIdx === state.firstPlayerIdx) return state;
    // Wave 39：玩家級物品 / 支援者鎖（例：含羞苞｜癢癢花粉、吼叫尾ex｜絕叫、電蜘蛛ex｜雷擊石）
    if (trainerCard.subtype === 'Item' && attacker.cantPlayItemThisTurn) return state;
    if (trainerCard.subtype === 'Supporter' && attacker.cantPlaySupporterThisTurn) return state;

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

    // 夜間學院 — 選 1 張手牌放回牌庫上方
    if (stadiumCard.name === '夜間學院') {
      if (newState.players[aIdx].hand.length === 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '夜間學院：手牌為空', aIdx);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'hand-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 1, maxCount: 1, filter: '',
          effectKey: 'night-academy-top', params: {},
        },
      };
    }

    // 月光丘陵 — 丟 1 張基本超能量 → 全體回 30 HP
    if (stadiumCard.name === '月光丘陵') {
      const p = newState.players[aIdx];
      const energyInHand = p.hand.filter(inst => {
        const c = pool.get(inst.cardId);
        return c?.supertype === 'Energy' && c?.name?.includes('超');
      });
      if (energyInHand.length === 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '月光丘陵：手牌中沒有超能量', aIdx);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 1, maxCount: 1, filter: 'Energy',
          effectKey: 'moonlight-hill-heal', params: {},
        },
      };
    }

    // 居民會館 — 這回合打過支援者才能用，全體回 10 HP
    if (stadiumCard.name === '居民會館') {
      if (!newState.players[aIdx].supporterPlayedThisTurn) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '居民會館：本回合還沒出支援者', aIdx);
      }
      const updated = { ...newState.players } as [PlayerState, PlayerState];
      const p = { ...updated[aIdx] };
      if (p.active) p.active = { ...p.active, damage: Math.max(0, p.active.damage - 10) };
      p.bench = p.bench.map(c => ({ ...c, damage: Math.max(0, c.damage - 10) }));
      updated[aIdx] = p;
      return addLog({ ...newState, players: updated }, '居民會館：自己寶可夢各回 10 HP', aIdx);
    }

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
    // Wave 39：卡片層級能量附加鎖（例：晶光花｜侵蝕碎塊）
    if (target.cantAttachEnergyThisTurn) return state;

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

    // 檢查是否因上回合效果而無法攻擊（個卡）
    if (attacker.active.cantAttackThisTurn) {
      const atkName = pool.get(attacker.active.cardId)?.name ?? '?';
      players[aIdx] = { ...attacker, active: { ...attacker.active, cantAttackThisTurn: undefined } };
      return addLog(
        { ...state, players, turnPhase: 'end' },
        `${atkName} 因上回合效果，本回合無法使用招式！`,
        aIdx
      );
    }

    // 玩家級「本回合所有寶可夢皆無法使用招式」（例：電擊魔獸｜雷電在地）
    if (attacker.noAttacksThisTurn) {
      const atkName = pool.get(attacker.active.cardId)?.name ?? '?';
      return addLog(
        { ...state, players, turnPhase: 'end' },
        `${attacker.name} 因雷電在地類效果，本回合所有寶可夢無法使用招式（${atkName} 強制結束攻擊階段）！`,
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
    // Session 33 引擎旗標：招式可聲明
    //   skipWeakRes    ：傷害不計算弱點 / 抵抗力
    //   skipDefEffects ：傷害不計算對手戰鬥寶可夢身上的「附加效果」
    //                    （含被動減傷特性、防禦道具、下次被攻擊 -N、條件式完全免疫）
    let skipWeakRes = false;
    let skipDefEffects = false;
    if (preFn) {
      const preResult = preFn(workingState, aIdx, pool, action);
      workingState = preResult.state;
      baseDamage = preResult.damage;
      if (preResult.skipWeakRes) skipWeakRes = true;
      if (preResult.skipDefEffects) skipDefEffects = true;
    }

    // 下回合加傷旗標（巨金怪 彗星拳、大電海燕 風力充能 類）—
    // 由前一個自己回合設下，至本回合起生效 1 次於 base damage 上，weakness 前套用。
    if (baseDamage > 0 && attacker.active.damageBonusThisTurn) {
      const dmgBonus = attacker.active.damageBonusThisTurn;
      baseDamage += dmgBonus;
      const newAtk = { ...attacker.active };
      delete newAtk.damageBonusThisTurn;
      players[aIdx] = { ...players[aIdx], active: newAtk };
      workingState = { ...workingState, players };
      const atkName = pool.get(newAtk.cardId)?.name ?? '?';
      workingState = addLog(workingState, `${atkName} 招式傷害 +${dmgBonus}（下回合加傷效果）`, aIdx);
    }

    // 弱點（×2）— 只對有實際傷害的招式套用。skipWeakRes 旗標跳過此計算。
    const defenderCard = getCard(defender.active.cardId, pool);
    if (!skipWeakRes && baseDamage > 0 && defenderCard.weakness && attackerCard.pokemonType === defenderCard.weakness.type) {
      baseDamage *= 2;
    }

    // 跨回合「這隻本回合受招式傷害 +N」旗標（例：超音波幼蟲｜刺耳聲）
    // 由對手上個回合 ATTACK_POST 設於 takeExtraDamageNextTurn → 本回合開始前 promote 為 ThisTurn。
    // 不消耗旗標，本回合結束時在 END_TURN 統一清除。
    if (baseDamage > 0 && defender.active.takeExtraDamageThisTurn) {
      const extra = defender.active.takeExtraDamageThisTurn;
      baseDamage += extra;
      workingState = addLog(workingState, `${defenderCard.name} 受到 +${extra} 傷害（上回合招式遺留效果）`, dIdx);
    }

    // 道具：我方攻擊 +N（極限腰帶 / 鎖鏈糬 / 驅勁能量 未來）— 阻礙之塔時全部失效
    const toolsJammed = isToolsJammed(state, pool);
    if (!toolsJammed && baseDamage > 0 && attacker.active.toolAttached) {
      const atkTool = pool.get(attacker.active.toolAttached.cardId);
      if (atkTool) {
        const fn = TOOL_ATTACK_BONUS.get(atkTool.name);
        if (fn) {
          const bonus = fn(attackerCard, attacker.active, defenderCard, defender.active);
          if (bonus > 0) baseDamage += bonus;
        }
      }
    }

    // Wave 42：被動特性 +N 攻擊傷害（攻擊方場上）— 例如 <竹蘭的>羅絲雷朵｜輝煌聲援 對「竹蘭的」寶可夢 +30
    // 多隻擁有同特性的寶可夢可疊加（場上每一隻都會算一次）。
    if (baseDamage > 0) {
      const attAll: CardInstance[] = [
        ...(attacker.active ? [attacker.active] : []),
        ...attacker.bench,
      ];
      for (const inst of attAll) {
        const c = pool.get(inst.cardId);
        if (!c?.abilities) continue;
        for (const ab of c.abilities) {
          const fn = PASSIVE_ATTACK_BONUS.get(ab.name);
          if (!fn) continue;
          const bonus = fn(attackerCard);
          if (bonus > 0) {
            baseDamage += bonus;
            workingState = addLog(workingState, `「${ab.name}」啟動：${attackerCard.name} 招式傷害 +${bonus}`, aIdx);
          }
        }
      }
    }

    // Wave 42：玩家級「本回合自己的【鬥】寶可夢招式傷害 +N」（例：力量蛋白飲）
    // 多次使用會累加（每張 +30）。在 weakness 前套用，對對手「戰鬥寶可夢」才算（與卡面一致，engine 層的 baseDamage 本就只對戰鬥寶可夢）。
    if (baseDamage > 0 && attackerCard.pokemonType === 'Fighting' && attacker.damageBoostFightingThisTurn) {
      const b = attacker.damageBoostFightingThisTurn;
      baseDamage += b;
      workingState = addLog(workingState, `「力量蛋白飲」啟動：${attackerCard.name} 招式傷害 +${b}`, aIdx);
    }

    // 被動特性：受傷減 N（Passive damage reduction）— skipDefEffects 跳過
    if (!skipDefEffects && baseDamage > 0 && defenderCard.abilities) {
      for (const ab of defenderCard.abilities) {
        const reduce = PASSIVE_DAMAGE_REDUCE.get(ab.name);
        if (reduce) baseDamage = Math.max(0, baseDamage - reduce);
      }
    }

    // 道具：特定屬性防禦（福祿果 / 巧可果 / 千香果 / 刺耳果 / 霹霹果 / 莓榴果）
    // 只要觸發就 -60 並丟棄，不受是否已被其他機制削到 0 影響（規則上 tool 仍消耗）
    // skipDefEffects 跳過，但不觸發道具也不丟棄。阻礙之塔時整個道具效果失效。
    let defenseReduceToolToDiscard: CardInstance | null = null;
    if (!toolsJammed && !skipDefEffects && defender.active.toolAttached) {
      const defTool = pool.get(defender.active.toolAttached.cardId);
      if (defTool) {
        const defense = TOOL_DEFENSE_REDUCE_BY_TYPE.get(defTool.name);
        if (defense && attackerCard.pokemonType && defense.types.includes(attackerCard.pokemonType) && baseDamage > 0) {
          baseDamage = Math.max(0, baseDamage - defense.amount);
          if (defense.discardOnTrigger) defenseReduceToolToDiscard = defender.active.toolAttached;
        }
      }
    }

    // 被動特性：條件式完全免疫 — skipDefEffects 跳過
    if (!skipDefEffects && baseDamage > 0 && defenderCard.abilities) {
      for (const ab of defenderCard.abilities) {
        const immune = PASSIVE_IMMUNITY.get(ab.name);
        if (immune && immune(attackerCard, baseDamage, state, aIdx, pool)) {
          baseDamage = 0;
          break;
        }
      }
    }

    // 施加傷害
    const defPlayers = [...workingState.players] as [PlayerState, PlayerState];
    const defenderState = { ...defPlayers[dIdx] };
    if (!defenderState.active) return state;

    // 套用防禦道具丟棄（若有觸發）
    if (defenseReduceToolToDiscard) {
      const tool = defenseReduceToolToDiscard;
      defenderState.active = { ...defenderState.active, toolAttached: undefined };
      defenderState.discard = [...defenderState.discard, tool];
    }

    // 「下次被攻擊傷害 -N」— 套用後清除旗標（Session 31 新機制）
    // skipDefEffects 跳過，但旗標保持不消耗（視為對方的附加效果，未被觸發）。
    if (!skipDefEffects && baseDamage > 0 && defenderState.active.damageReduceNextHit) {
      baseDamage = Math.max(0, baseDamage - defenderState.active.damageReduceNextHit);
      defenderState.active = { ...defenderState.active, damageReduceNextHit: undefined };
    }

    const newDamage = defenderState.active.damage + baseDamage;
    // 有效 HP = 基礎 HP + 道具加成（英雄斗篷/勇氣護符/豪華斗篷/驅勁能量古代）
    const defenderHP = getEffectiveHP(defenderState.active, pool, state);

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

    // 龐克頭盔：防守方出場的【惡】寶可夢附有龐克頭盔時，攻擊者受到 40 傷害反擊。
    // 注意：僅計算反彈量，實際套用在下方「防守方狀態提交後」，避免被 defPlayers 覆蓋掉。
    let punkReflectDamage = 0;
    {
      const defenderStatePre = defPlayers[dIdx];
      const defToolCardPre = defenderStatePre.active?.toolAttached
        ? pool.get(defenderStatePre.active.toolAttached.cardId) : null;
      const defActiveCardPre = defenderStatePre.active ? pool.get(defenderStatePre.active.cardId) : null;
      if (!toolsJammed && baseDamage > 0 && defToolCardPre?.name === '龐克頭盔' && defActiveCardPre?.pokemonType === 'Darkness') {
        punkReflectDamage = 40;
      }
    }

    // 擊倒判定
    const wouldBeKO = baseDamage > 0 && defenderHP > 0 && newDamage >= defenderHP;

    // 道具防 KO（倖存鍛鍊器）— 滿血被 KO 時保留少量 HP，道具丟棄（阻礙之塔時失效）
    let preventedKO = false;
    if (!toolsJammed && wouldBeKO && defenderState.active?.toolAttached) {
      const preventTool = pool.get(defenderState.active.toolAttached.cardId);
      if (preventTool) {
        const fn = TOOL_PREVENT_KO.get(preventTool.name);
        if (fn) {
          const result = fn(defenderState.active, defenderCard, baseDamage);
          if (result.prevent) {
            const tool = defenderState.active.toolAttached;
            const targetDamage = Math.max(0, defenderHP - result.leaveHP);
            defenderState.active = {
              ...defenderState.active,
              damage: targetDamage,
              toolAttached: undefined,
            };
            defenderState.discard = [...defenderState.discard, tool];
            defPlayers[dIdx] = defenderState;
            newState = addLog({ ...newState, players: defPlayers, turnPhase: 'end' },
              `${preventTool.name}：${defenderCard.name} 避免昏厥，剩餘 HP ${result.leaveHP}！`, null);
            preventedKO = true;
          }
        }
      }
    }

    if (!preventedKO && wouldBeKO) {
      // 道具：被 KO 時獎賞加成（豪華斗篷 +1 / 莉莉艾的珍珠 -1 等）— 阻礙之塔時失效
      let prizeTool = 0;
      if (!toolsJammed && defenderState.active?.toolAttached) {
        const tool = pool.get(defenderState.active.toolAttached.cardId);
        if (tool) {
          const fn = TOOL_PRIZE_BONUS.get(tool.name);
          if (fn) prizeTool = fn(defenderCard);
        }
      }

      const updatedActive = { ...defenderState.active, damage: newDamage };
      const koDiscard: CardInstance[] = [
        updatedActive,
        ...updatedActive.energyAttached,
        ...(updatedActive.toolAttached ? [updatedActive.toolAttached] : []),
        ...(updatedActive.evolvedFromStack ?? []),
      ];
      // 先記錄被 KO 的道具名以便觸發 ON_KO 後續效果
      const onKOTool = updatedActive.toolAttached ? pool.get(updatedActive.toolAttached.cardId) : null;

      defenderState.discard = [...defenderState.discard, ...koDiscard];
      defenderState.active = null;
      // Wave 39：蝶結萌虻｜多餘花粉 — 跨回合獎賞加成
      const deferredBonus = (updatedActive.deferredPrizeBonusThisTurn && updatedActive.deferredPrizeBonusThisTurn > 0)
        ? updatedActive.deferredPrizeBonusThisTurn : 0;
      // Wave 43：白蕾雅 — 本回合，攻擊方使用「太晶」寶可夢招式 KO 對手戰鬥位 → +1 獎勵牌。
      // 條件：aIdx 玩家本回合有 teraKoBonusPrizeThisTurn 旗標，且攻擊方 active 為太晶寶可夢（attacks 含 name==='太晶'）。
      let whiteLilyBonus = 0;
      if (newState.players[aIdx].teraKoBonusPrizeThisTurn) {
        const atkActive = newState.players[aIdx].active;
        const atkCard = atkActive ? pool.get(atkActive.cardId) : null;
        const isTera = !!atkCard?.attacks?.some(a => a.name === '太晶');
        if (isTera) whiteLilyBonus = 1;
      }
      // 獎賞牌下限 0（影藏等特性可將獎賞減到 0 張；實務上對手 KO 一隻 1 獎賞的惡寶可夢時效果才會觸發歸零）
      const prizes = Math.max(0, prizesForKO(defenderCard) + prizeAdjust + prizeTool + deferredBonus + whiteLilyBonus);
      defPlayers[dIdx] = defenderState;
      newState = {
        ...newState, players: defPlayers,
        pendingPrizes: prizes, turnPhase: 'end',
      };
      if (deferredBonus > 0) {
        newState = addLog(newState, `${defenderCard.name} 因「多餘花粉」遺留效果，+${deferredBonus} 張獎勵牌`, null);
      }
      if (whiteLilyBonus > 0) {
        newState = addLog(newState, `「白蕾雅」效果發動：太晶寶可夢的招式 KO 對手戰鬥位 +${whiteLilyBonus} 張獎勵牌`, aIdx);
      }
      if (prizeAdjust < 0) {
        newState = addLog(newState, `「影藏」啟動：${attacker.name} 取得的獎勵牌減少 1 張`, null);
      }
      if (prizes > 0) {
        newState = addLog(newState, `${defenderCard.name} 被擊倒！${attacker.name} 取得 ${prizes} 張獎勵牌。`, null);
      } else {
        newState = addLog(newState, `${defenderCard.name} 被擊倒！但 ${attacker.name} 無法取得任何獎勵牌。`, null);
      }

      // 道具：被 KO 時觸發（希望護身符 / 沉重接力棒）— 阻礙之塔時失效
      if (!toolsJammed && onKOTool) {
        const fn = TOOL_ON_KO.get(onKOTool.name);
        if (fn) newState = fn(newState, dIdx, aIdx, pool);
      }

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
    } else if (!preventedKO) {
      defenderState.active = { ...defenderState.active!, damage: newDamage };
      defPlayers[dIdx] = defenderState;
      newState = { ...newState, players: defPlayers, turnPhase: 'end' };

      // 道具：被打到但未 KO 時觸發（幸運頭盔 / 奢華炸彈）— 阻礙之塔時失效
      if (!toolsJammed && baseDamage > 0 && defenderState.active.toolAttached) {
        const tool = pool.get(defenderState.active.toolAttached.cardId);
        if (tool) {
          const fn = TOOL_ON_DAMAGED.get(tool.name);
          if (fn) newState = fn(newState, dIdx, aIdx, baseDamage, pool);
        }
      }
    }

    // ── 龐克頭盔反彈 40：在防守方狀態已提交後套用，避免被覆蓋 ──────────────────
    if (punkReflectDamage > 0) {
      const refPlayers = [...newState.players] as [PlayerState, PlayerState];
      const atkP = { ...refPlayers[aIdx] };
      if (atkP.active) {
        atkP.active = { ...atkP.active, damage: atkP.active.damage + punkReflectDamage };
        refPlayers[aIdx] = atkP;
        newState = addLog(
          { ...newState, players: refPlayers },
          `🔧 龐克頭盔：${attackerCard.name} 受到 ${punkReflectDamage} 傷害反擊！`,
          null,
        );
      }
    }

    // ── 招式後置效果（回復、移動能量、觸發 pendingSelection 等）──────────────
    const postFn = ATTACK_POST.get(effectKey);
    if (postFn) {
      newState = postFn(newState, aIdx, pool);
    }

    // ── 被動反擊特性（毒刺、灼熱之軀、反擊等）— 只對有實際傷害的招式觸發 ──
    if (baseDamage > 0 && defenderCard.abilities) {
      for (const ab of defenderCard.abilities) {
        const retal = PASSIVE_RETALIATION.get(ab.name);
        if (retal) newState = retal(newState, dIdx, pool);
      }
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

    // Session 34：設 movedToActiveThisTurn（供「在這個回合若從備戰區放到戰鬥場」條件用）。
    // 注意：SEND_NEW_ACTIVE 通常發生在對手回合（被擊倒後自動補上場）；
    // 設旗標的目的是在「自己下一回合」使用此旗標進行傷害加成判斷 — clearTurnFlags 在
    // 擁有者的 END_TURN 才觸發，所以對被擊倒方而言，下回合使用「暴衝閃光」類仍可判定 true。
    const newActive = { ...sendingPlayer.bench[benchIdx], movedToActiveThisTurn: true };
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

    // 特殊狀態：中毒 — 回合結束施加 10 傷害（危險密林競技場：+20 = 30 指示物）
    // 桃歹郎 劇毒支配 被動：對手中毒時指示物 +5
    const poisonPlayer = { ...players[aIdx] };
    if (poisonPlayer.active?.status === 'poisoned') {
      const poisonedCard = pool.get(poisonPlayer.active.cardId);
      const stadiumName = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
      let poisonBonus = 0;
      if (stadiumName === '危險密林' && poisonedCard?.pokemonType !== 'Darkness') poisonBonus += 20;
      // 對手場上有「桃歹郎 劇毒支配」被動 → +50
      const oppPokes = [
        ...(state.players[dIdx].active ? [state.players[dIdx].active!] : []),
        ...state.players[dIdx].bench,
      ];
      const hasDominatingPoison = oppPokes.some(c => {
        const card = pool.get(c.cardId);
        return card?.abilities?.some(a => a.name === '劇毒支配');
      });
      if (hasDominatingPoison && state.players[dIdx].active &&
          // 只有 defender's active 是「桃歹郎」本體才啟動（劇毒支配只要求對手中毒時加傷）
          state.players[dIdx].active.iid && true) {
        poisonBonus += 50;
      }
      const newDmg = poisonPlayer.active.damage + 10 + poisonBonus;
      const poisonedHP = getEffectiveHP(poisonPlayer.active, pool, state);
      if (poisonedHP > 0 && newDmg >= poisonedHP) {
        // 被毒死 → 直接 KO，攻擊方（對手）取獎勵
        const dIdxP = dIdx;
        const koDiscard2: CardInstance[] = [
          { ...poisonPlayer.active, damage: newDmg },
          ...poisonPlayer.active.energyAttached,
          ...(poisonPlayer.active.toolAttached ? [poisonPlayer.active.toolAttached] : []),
          ...(poisonPlayer.active.evolvedFromStack ?? []),
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
      const burnedHP = getEffectiveHP(burnedPlayer.active, pool, state);
      if (burnedHP > 0 && newBurnDmg >= burnedHP) {
        // 燒傷致死
        const koDiscard3: CardInstance[] = [
          { ...burnedPlayer.active, damage: newBurnDmg },
          ...burnedPlayer.active.energyAttached,
          ...(burnedPlayer.active.toolAttached ? [burnedPlayer.active.toolAttached] : []),
          ...(burnedPlayer.active.evolvedFromStack ?? []),
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
    // 清除 cantAttackThisTurn：若當前玩家的 active 本回合被招式封鎖過，
    // 回合結束時把罰則消耗完（否則 UI 反白會永久卡住）
    const clearCantAttackThisTurn = (c: CardInstance): CardInstance => {
      if (!c.cantAttackThisTurn) return c;
      const n = { ...c }; delete n.cantAttackThisTurn; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearCantAttackThisTurn(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearCantAttackThisTurn);
    // 清除 cantRetreatNextTurn：flag 由上個對手回合設下，作用於本回合；本回合結束時清除
    const clearCantRetreat = (c: CardInstance): CardInstance => {
      if (!c.cantRetreatNextTurn) return c;
      const n = { ...c }; delete n.cantRetreatNextTurn; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearCantRetreat(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearCantRetreat);
    players[aIdx] = currentPlayer;

    // Wave 36：於 aIdx（本回合結束方）自己的卡 promote takeExtraDamageNextTurn → ThisTurn
    // 機制：此旗標由對手（攻擊方）在上個對手回合 ATTACK_POST 設下，經過我方這一回合後,
    //      在對手下個回合開始前（現在）啟用。於對手 END_TURN 時清除。
    const promoteTakeExtra = (c: CardInstance): CardInstance => {
      if (!c.takeExtraDamageNextTurn || c.takeExtraDamageNextTurn <= 0) return c;
      const n: CardInstance = { ...c, takeExtraDamageThisTurn: (c.takeExtraDamageThisTurn ?? 0) + c.takeExtraDamageNextTurn };
      delete n.takeExtraDamageNextTurn;
      return n;
    };
    // Wave 39：於 aIdx 方自己的卡 promote deferredPrizeBonusNextTurn → ThisTurn（同跨回合模型）
    const promoteDeferredPrize = (c: CardInstance): CardInstance => {
      if (!c.deferredPrizeBonusNextTurn || c.deferredPrizeBonusNextTurn <= 0) return c;
      const n: CardInstance = { ...c, deferredPrizeBonusThisTurn: (c.deferredPrizeBonusThisTurn ?? 0) + c.deferredPrizeBonusNextTurn };
      delete n.deferredPrizeBonusNextTurn;
      return n;
    };
    if (currentPlayer.active) currentPlayer.active = promoteDeferredPrize(promoteTakeExtra(currentPlayer.active));
    currentPlayer.bench = currentPlayer.bench.map(c => promoteDeferredPrize(promoteTakeExtra(c)));
    players[aIdx] = currentPlayer;

    // 重置次方玩家的回合限制旗標 + promote cantAttackPending → cantAttackThisTurn
    // + promote damageBonusPending → damageBonusThisTurn
    const nextIdx = dIdx;
    const promotePending = (c: CardInstance): CardInstance => {
      let n = c;
      if (c.cantAttackPending) {
        n = { ...n, cantAttackThisTurn: true };
        delete n.cantAttackPending;
      }
      if (c.damageBonusPending && c.damageBonusPending > 0) {
        n = { ...n, damageBonusThisTurn: (n.damageBonusThisTurn ?? 0) + c.damageBonusPending };
        delete n.damageBonusPending;
      }
      if (c.cantRetreatPendingSelf) {
        n = { ...n, cantRetreatNextTurn: true };
        delete n.cantRetreatPendingSelf;
      }
      // Wave 36：清除本回合已消耗完的 takeExtraDamageThisTurn（對手本回合結束 = 本方下回合開始）
      if (c.takeExtraDamageThisTurn) {
        n = { ...n };
        delete n.takeExtraDamageThisTurn;
      }
      // Wave 39：清除消耗完的 deferredPrizeBonusThisTurn（同跨回合模型）
      if (c.deferredPrizeBonusThisTurn) {
        n = { ...n };
        delete n.deferredPrizeBonusThisTurn;
      }
      // Wave 39：promote 卡片層級 cantAttachEnergyNextTurn → ThisTurn（於 nextIdx 方，即擁有者下個回合開始前）
      if (c.cantAttachEnergyNextTurn) {
        n = { ...n, cantAttachEnergyThisTurn: true };
        delete n.cantAttachEnergyNextTurn;
      }
      return n;
    };
    // 清除目前玩家 active/bench 上殘留的 damageBonusThisTurn（若攻擊未命中用掉）
    const clearDmgBonusThisTurn = (c: CardInstance): CardInstance => {
      if (!c.damageBonusThisTurn) return c;
      const n = { ...c }; delete n.damageBonusThisTurn; return n;
    };
    // Wave 39：清除 aIdx（擁有者）本回合殘留的 cantAttachEnergyThisTurn
    const clearCantAttachEnergy = (c: CardInstance): CardInstance => {
      if (!c.cantAttachEnergyThisTurn) return c;
      const n = { ...c }; delete n.cantAttachEnergyThisTurn; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearCantAttachEnergy(clearDmgBonusThisTurn(currentPlayer.active));
    currentPlayer.bench = currentPlayer.bench.map(c => clearCantAttachEnergy(clearDmgBonusThisTurn(c)));
    // Wave 36/39：清除 aIdx（本回合結束方）的玩家級 ThisTurn 旗標（若本回合已消耗完）
    if (
      currentPlayer.noAttacksThisTurn ||
      currentPlayer.cantPlayItemThisTurn ||
      currentPlayer.cantPlaySupporterThisTurn ||
      currentPlayer.cantEvolveThisTurn ||
      currentPlayer.damageBoostFightingThisTurn ||
      currentPlayer.teraKoBonusPrizeThisTurn
    ) {
      const cp = { ...currentPlayer };
      delete cp.noAttacksThisTurn;
      delete cp.cantPlayItemThisTurn;
      delete cp.cantPlaySupporterThisTurn;
      delete cp.cantEvolveThisTurn;
      delete cp.damageBoostFightingThisTurn;
      delete cp.teraKoBonusPrizeThisTurn;
      players[aIdx] = cp;
    } else {
      players[aIdx] = currentPlayer;
    }
    const nextP = { ...players[nextIdx] };
    if (nextP.active) nextP.active = promotePending(nextP.active);
    nextP.bench = nextP.bench.map(promotePending);
    // Wave 36：promote nextIdx 的 noAttacksNextTurn → noAttacksThisTurn（例：雷電在地）
    if (nextP.noAttacksNextTurn) {
      nextP.noAttacksThisTurn = true;
      delete nextP.noAttacksNextTurn;
    }
    // Wave 39：promote nextIdx 的 cantPlayItem/Supporter/Evolve NextTurn → ThisTurn
    if (nextP.cantPlayItemNextTurn) {
      nextP.cantPlayItemThisTurn = true;
      delete nextP.cantPlayItemNextTurn;
    }
    if (nextP.cantPlaySupporterNextTurn) {
      nextP.cantPlaySupporterThisTurn = true;
      delete nextP.cantPlaySupporterNextTurn;
    }
    if (nextP.cantEvolveNextTurn) {
      nextP.cantEvolveThisTurn = true;
      delete nextP.cantEvolveNextTurn;
    }
    players[nextIdx] = {
      ...nextP,
      energyAttachedThisTurn: false,
      supporterPlayedThisTurn: false,
      retreatedThisTurn: false,
    };

    // 重置競技場使用旗標（當前玩家的回合結束時清除其旗標）
    let stadiumUsedThisTurn = state.stadiumUsedThisTurn ?? [false, false] as [boolean, boolean];
    const newStadiumUsed: [boolean, boolean] = [stadiumUsedThisTurn[0], stadiumUsedThisTurn[1]];
    newStadiumUsed[aIdx] = false;

    // 快照對手目前獎賞張數（作為「下次我開始回合時」的基準值）—
    // 下回合開始時用此快照 vs 屆時對手獎賞數差，判斷「對手在他們剛結束的回合是否取過獎賞」
    // 用於不公印章等 gate 條件。
    const prevOppSnap = state.oppPrizesAtMyLastTurnEnd ?? [6, 6] as [number, number];
    const newOppSnap: [number, number] = [prevOppSnap[0], prevOppSnap[1]];
    newOppSnap[aIdx] = players[1 - aIdx].prizes.length;

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
        oppPrizesAtMyLastTurnEnd: newOppSnap,
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

/** 列出目前行動玩家可使用的招式（已滿足能量需求 + 未被狀態/效果封鎖的） */
export function getAvailableAttacks(
  state: GameState,
  pool: Map<string, Card>
): number[] {
  if (state.turnPhase !== 'main') return [];
  if (state.isFirstTurn && state.activePlayerIndex === state.firstPlayerIdx) return [];
  const player = state.players[state.activePlayerIndex];
  if (!player.active) return [];
  // 狀態/效果封鎖：睡眠、麻痺、上回合招式設下的「本回合無法使用招式」
  // （混亂只在攻擊時擲幣判定，這裡仍允許點擊；中毒/燒傷不影響攻擊）
  if (player.active.status === 'asleep') return [];
  if (player.active.status === 'paralyzed') return [];
  if (player.active.cantAttackThisTurn) return [];
  // Wave 36：玩家級封鎖（電擊魔獸｜雷電在地類）
  if (player.noAttacksThisTurn) return [];
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
    // 雙方都必須有 active 才能結束回合（防守方被擊倒後必須先送新 active）
    state.players[0].active === null ||
    state.players[1].active === null;
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
  // 道具撤退修正（氣球 / 緊急滑板 / 驅勁能量 未來）— 阻礙之塔時道具失效
  const toolsJammedCanR = isToolsJammed(state, pool);
  const tool = (!toolsJammedCanR && player.active.toolAttached) ? pool.get(player.active.toolAttached.cardId) : null;
  if (tool && card) {
    const mod = TOOL_RETREAT_MOD.get(tool.name);
    if (mod) {
      const r = mod(card, player.active);
      if (r.zero) cost = 0;
      else if (r.reduceBy) cost = Math.max(0, cost - r.reduceBy);
    }
  }
  // 重力之玉：雙方 active 任一帶此道具 → 雙方撤退 +1（阻礙之塔時失效）
  const opp = state.players[(1 - state.activePlayerIndex) as 0 | 1];
  const bothPlusFromSelf = !toolsJammedCanR && player.active.toolAttached
    && TOOL_BOTH_SIDES_RETREAT_PLUS.has(pool.get(player.active.toolAttached.cardId)?.name ?? '');
  const bothPlusFromOpp = !toolsJammedCanR && opp.active?.toolAttached
    && TOOL_BOTH_SIDES_RETREAT_PLUS.has(pool.get(opp.active.toolAttached.cardId)?.name ?? '');
  if (bothPlusFromSelf || bothPlusFromOpp) cost += 1;
  // 被動特性：天空徑線（拉帝亞斯ex）— 所有基礎寶可夢免費撤退
  const hasSkyPath = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ].some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '天空徑線'));
  if (hasSkyPath && isBasicPokemonCard(card)) cost = 0;
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
      // 先攻玩家第一回合禁用支援者
      if (c.subtype === 'Supporter' && state.isFirstTurn && state.activePlayerIndex === state.firstPlayerIdx) return false;
      // Wave 43 fix：玩家級物品/支援者鎖也要在可用清單裡濾掉（否則 AI 會挑到被鎖的卡、engine 靜默 no-op → AI 當機）
      if (c.subtype === 'Item' && player.cantPlayItemThisTurn) return false;
      if (c.subtype === 'Supporter' && player.cantPlaySupporterThisTurn) return false;
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
    .filter(inst => isBasicPokemonCard(pool.get(inst.cardId)))
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
