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
  PlayerState, LogEntry, TurnPhase
} from './types';

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

/**
 * 取得一張能量卡提供的能量類型列表。
 * 基礎能量：1 個對應屬性。
 * 特殊能量：M2 先一律視為 1 Colorless（M4 再完整實裝）。
 */
export function getEnergyProvided(cardId: string, pool: Map<string, Card>): EnergyType[] {
  const c = pool.get(cardId);
  if (!c || c.supertype !== 'Energy') return [];
  if (c.subtype === 'Basic' && c.pokemonType) return [c.pokemonType];
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
  };
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
 * 洗牌 → 各抽 7 張 → 若無基礎寶可夢則自動補牌（mulligans）→ 進入 setup-p1。
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

  // 各抽 7 張（含自動 mulligan）
  dealOpeningHand(p1, pool);
  dealOpeningHand(p2, pool);

  const state: GameState = {
    id: uid(),
    phase: 'setup-p1',
    turnPhase: 'main',
    activePlayerIndex: 0,
    players: [p1, p2],
    turn: 1,
    isFirstTurn: true,
    setupDone: [false, false],
    log: [],
    pendingPrizes: 0,
  };

  return addLog(state, `遊戲開始！${spec1.name} vs ${spec2.name}`, null);
}

/**
 * 抽 7 張起始手牌。若無基礎寶可夢則重新洗牌並再抽（mulligan）。
 * 最多執行 10 次以避免無限循環（理論上不會發生）。
 */
function dealOpeningHand(player: PlayerState, pool: Map<string, Card>): void {
  let attempts = 0;
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
  } while (
    attempts < 10 &&
    !player.hand.some((c) => isBasicPokemon(c.cardId, pool))
  );
}

// ── Setup 階段處理 ───────────────────────────────────────────────────────────

function handleSetup(
  state: GameState,
  action: GameAction,
  pool: Map<string, Card>
): GameState {
  const pIdx = state.phase === 'setup-p1' ? 0 : 1;
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

    if (newDone[0] && newDone[1]) {
      // 雙方都完成 → 進入正式對戰，P1 先手
      newState = {
        ...newState,
        phase: 'playing',
        turnPhase: 'draw',
        activePlayerIndex: 0,
        isFirstTurn: true,
      };
      newState = addLog(newState, 'Setup 完成！遊戲開始，先手玩家行動中。', null);
      // 先手 P1 跳過抽牌（規則：先手第 1 回合不抽牌）
      newState = { ...newState, turnPhase: 'main' };
    } else {
      // P1 完成，換 P2 setup
      newState = { ...newState, phase: 'setup-p2' };
      newState = addLog(newState, `${player.name} 完成準備。`, null);
    }
    return newState;
  }

  return state;
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
  const attacker = { ...players[aIdx], energyAttached: players[aIdx].energyAttached ?? [] };
  const defender = { ...players[dIdx] };

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
    if (state.isFirstTurn && aIdx === 0) return state; // 先手 P1 第 1 回合不能攻擊
    if (!attacker.active) return state;
    if (!defender.active) return state;

    const attackerCard = getCard(attacker.active.cardId, pool);
    const attacks = attackerCard.attacks ?? [];
    const attack = attacks[action.attackIndex];
    if (!attack) return state;

    // 確認能量足夠
    if (!canAffordAttack(attacker.active, attack.cost, pool)) return state;

    // 計算傷害
    let baseDamage = parseInt(attack.damage ?? '0', 10);
    if (isNaN(baseDamage)) baseDamage = 0;

    // 弱點（×2）
    const defenderCard = getCard(defender.active.cardId, pool);
    const weakness = defenderCard.weakness;
    if (weakness && attackerCard.pokemonType === weakness.type) {
      baseDamage *= 2;
    }

    // 施加傷害
    const newDamage = defender.active.damage + baseDamage;
    const defenderHP = defenderCard.hp ?? 0;
    let updatedDefenderActive = { ...defender.active, damage: newDamage };

    let newState: GameState = addLog(
      { ...state, players },
      `${attacker.name} 的 ${attackerCard.name} 使出「${attack.name}」，造成 ${baseDamage} 傷害！`,
      aIdx
    );

    // 擊倒判定
    if (defenderHP > 0 && newDamage >= defenderHP) {
      // 擊倒：傷害寶可夢 + 附加能量 → 墓地
      const koDiscard: CardInstance[] = [updatedDefenderActive, ...updatedDefenderActive.energyAttached];
      defender.discard = [...defender.discard, ...koDiscard];
      defender.active = null;

      const prizes = prizesForKO(defenderCard);
      players[aIdx] = attacker;
      players[dIdx] = defender;
      newState = {
        ...newState,
        players,
        pendingPrizes: prizes,
        turnPhase: 'end', // 攻擊後要取獎勵才能繼續
      };
      newState = addLog(newState, `${defenderCard.name} 被擊倒！${attacker.name} 取得 ${prizes} 張獎勵牌。`, null);
    } else {
      defender.active = updatedDefenderActive;
      players[aIdx] = attacker;
      players[dIdx] = defender;
      newState = { ...newState, players, turnPhase: 'end' };
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
      `${attacker.name} 取得了 ${count} 張獎勵牌（剩餘 ${attacker.prizes.length - count} 張）`,
      aIdx
    );

    // 勝利條件：獎勵牌全取完
    if (attacker.prizes.length - count <= 0) {
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
    // 此時 activePlayerIndex 應已切換到被擊倒方，由他們送出新的寶可夢
    const sendingIdx = aIdx; // 當前行動玩家送出新的寶可夢
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
    if (state.pendingPrizes > 0) return state; // 取獎勵前不能結束
    if (defender.active === null) return state; // 對手必須先送出寶可夢

    // 勝利條件：對手備戰區也空了
    if (defender.bench.length === 0 && defender.active === null) {
      return {
        ...state, phase: 'game-over',
        winner: aIdx,
        winReason: `${defender.name} 沒有可上場的寶可夢`,
      };
    }

    // 切換玩家
    const nextIdx = dIdx;
    const nextPlayer = { ...players[nextIdx], energyAttachedThisTurn: false, supporterPlayedThisTurn: false };
    players[nextIdx] = nextPlayer;

    const newTurn = aIdx === 1 ? state.turn + 1 : state.turn;
    return addLog(
      {
        ...state,
        players,
        activePlayerIndex: nextIdx,
        turn: newTurn,
        isFirstTurn: false,
        turnPhase: 'draw',
      },
      `回合結束，換 ${nextPlayer.name} 行動。`,
      null
    );
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

  if (state.phase === 'setup-p1' || state.phase === 'setup-p2') {
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
  if (state.isFirstTurn && state.activePlayerIndex === 0) return [];
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
    state.players[state.activePlayerIndex].active === null;
}
