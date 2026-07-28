/**
 * PTCG 對戰引擎 — 核心純函式
 *
 * 所有函式都是純函式：接收舊 state 回傳新 state，不做任何副作用。
 * 這讓引擎可以：
 *   - 單元測試
 *   - 動作日誌回放
 *   - M3 多人連線時只需傳送動作序列
 */

import type { Card, EnergyType, Attack } from '$lib/cards/types';
// v5.988：平穩境地述詞改從 v3001 既有安全 import 取得(移除此處早期反向 import 卡檔 v3080，杜絕 module-init TDZ)
import { BENCH_SCRUB_LOCK_FLAGS, OPP_ATTACK_DEBUFF_FLAGS } from './instance-flags';
import type {
  GameState, GameAction, CardInstance,
  PlayerState, PendingSelection, LogEntry, TurnPhase, GamePhase, ActionRecord, TurnActionLog} from './types';
import { RULE_BOX_SUBTYPES } from './types';
// v6.018 批5：4 卡片述詞 helper + ZH_ENERGY_TYPE 下沉 selection-filter.ts（解循環）；engine re-export 給既有 importer
import { isBasicPokemonCard, isRulePokemon, isBasicEnergyOfType, getBasicEnergyType, ZH_ENERGY_TYPE, evaluateSelectionFilter, isKnownSelectionFilter, sanitizeSelectionSet } from './selection-filter';
export { isBasicPokemonCard, isRulePokemon, isBasicEnergyOfType, getBasicEnergyType };
import {
  TRAINER_EFFECTS, RESOLVERS, ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, canPlayTrainer,
  PASSIVE_DAMAGE_REDUCE, PASSIVE_IMMUNITY, PASSIVE_RETALIATION, PASSIVE_ATTACK_BONUS, PASSIVE_ATTACK_NO_STACK,
  PASSIVE_DAMAGE_REDUCE_COND,
  PASSIVE_DAMAGE_REDUCE_BY_ATTACKER, PASSIVE_COIN_AVOID, PASSIVE_KO_RETALIATION, PASSIVE_ON_KO,
  PASSIVE_ON_DAMAGED, PASSIVE_PREVENT_PRIZE, PASSIVE_ATTACKER_BUFF,
  TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE, TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY,
  TOOL_PREVENT_KO, TOOL_ON_KO, TOOL_PRIZE_BONUS, TOOL_ON_DAMAGED,
  hasFlowerVeil,
  // v5.186：抵抗之幕 attack-time snapshot 仿 v3.892 花之帷幔 pattern
  hasRocketVeil,
  // v5.237：球形盾牌 attack-time snapshot 同 pattern
  hasBugAegislashShield,
  TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS,
  TOOL_END_TURN_DISCARD,
  ABILITY_RETREAT_MOD,
  BENCH_PLACE_TRIGGERS, JAMMING_TOWER_STADIUMS, ROCKET_WATCHTOWER_STADIUMS, BENCH_PROTECTION_STADIUMS,
  SPECIAL_ENERGY_ATTACH,
  SPECIAL_ENERGY_HP_BONUS, SPECIAL_ENERGY_RETREAT_MOD,
  SPECIAL_ENERGY_STATUS_IMMUNE, SPECIAL_ENERGY_ON_DAMAGED,
  OPP_ENERGY_ATTACH_PASSIVE,
  fireOnHandEnergyAttached,
  clearActiveEffects,
  clearFestivalVenueProtectedStatuses,
  clearSpecialEnergyProtectedStatuses,
  hasFairyZoneField,
  getEffectiveWeaknessType,
  getAttackerEffectiveTypes,
  applyBenchPlaceSideEffects,
  getKyuremElectroplasmaEffectiveCost,
  getOctopusTentacleEffectiveCost,
  getUrsalunaBloodMoonEffectiveCost,
  getDecidueyeSnipeEffectiveCost,
  getCorphishPreparationEffectiveCost,
  getSkeledirgeRowdyContestEffectiveCost,
  getAzumarillSparkleSplashEffectiveCost,
  getSonidoTuningResonanceEffectiveCost,
  // v4.976: 鐵螯龍蝦|反撲剪 cost reduction helper
  getIronCrabCounterClipEffectiveCost,
  isLazyTraitBlockingAttack,
  hasShellinkEvolveBypass,
  isAllPowerSoulBlocked,
  PASSIVE_PREVENT_KO,
  COIN_PREVENT_KO_ABILITIES,
  flipCoinsWithLog,
  hasBloomOnField,
  promptPlayAbilities,
  ON_PLAY_FROM_HAND_ABILITIES,
  ON_EVOLVE_FROM_HAND_ABILITIES,
  wouldNeutralCenterBlock,  // v3.67 中立中心 stadium damage block
  applyInherentRetaliation,  // v5.494 化石卡面內建受傷反擊
} from './effects';
import {
  steelixPalaceReduce,
  bronzongShelterReduce,
  gearCoatingReduce,
  curlWallReduce,
} from './effects/cards/v2999_g3_wave1';
// v3.0 Group 3 Wave 2 helpers
import {
  magmarFlowingBurnBonus,
  isBasicWaterEnergy,
  canRelicanthDiverCatchTrigger,
  canTogekissMiracleKissTrigger,
  hasMeloettaExDebut,
  FIRST_TURN_USABLE_ATTACKS,
  magearnaAutoHealAmount,
} from './effects/cards/v3000_g3_wave2';
// v3.08 Deferred Wave C helpers — 古空棘魚｜潛入記憶（進化前招式擴展）
import {
  hasArchaeoglobinDiveMemory,
  getAttacksFromEvolvedFromStack,
} from './effects/cards/v3080_deferred_wave_c';

// v2.341：鐵荊棘ex SV5a 033/066｜初始化
// 「只要這隻寶可夢在戰鬥場上，雙方場上『擁有規則的寶可夢』（『未來』寶可夢除外）的特性全部消除。」
// 實作：使用 Rule Box 檢查（isRuleBox）遮蔽任意特性的發動。
// 觸發時機：在 engine.ts USE_ABILITY handler 的 ability 後檢查。
function isInitializeBlocking(
  state: GameState,
  targetPoke: CardInstance,
  pool: Map<string, Card>
): boolean {
  // v5.528：收斂至中央 isInitializeNullified（v3001）— rule-box + 「未來」除外 + 任一方戰鬥場有「初始化」
  //   的判定只維護在一處，避免各發動點散裝重複（USE_ABILITY / BENCH_PLACE / promptPlayAbilities /
  //   getUsableAbilities / 被動套用點 全部走同一函式）。保留本 wrapper 名稱與 caller 的清楚 log。
  return isInitializeNullified(state, pool.get(targetPoke.cardId), pool);
}

// ── 阻礙之塔（阻礙道具發動）── 輔助判定 ──────────────────────────────────────
// 當場上活動場地卡為 JAMMING_TOWER_STADIUMS 所列競技場卡時，雙方所有【道具】不發動效果。
// 這個閘門會包在所有 TOOL_* 查找上，讓道具的 HP 加成、攻擊 +N、退避減免等全部失效。
export function isToolsJammed(state: GameState, pool: Map<string, Card>): boolean {
  const s = state.activeStadium;
  if (!s) return false;
  const card = pool.get(s.cardId);
  if (!card) return false;
  return JAMMING_TOWER_STADIUMS.has(card.name);
}

// v2.322：蓋諾賽克特｜ACE消弭 — 若對手場上有蓋諾賽克特且附有寶可夢道具，
//   則當前玩家不能從手牌使出 ACE SPEC 卡。
function isAceCancelActive(state: GameState, playerIdx: 0 | 1, pool: Map<string, Card>): boolean {
  const oppIdx = (1 - playerIdx) as 0 | 1;
  const opp = state.players[oppIdx];
  const allOpp = [...(opp.active ? [opp.active] : []), ...opp.bench];
  return allOpp.some(pk => {
    const c = pool.get(pk.cardId);
    if (!c) return false;
    // 必須是蓋諾賽克特（非 ex 版本）且有 ACE消弭 特性
    if (c.name !== '蓋諾賽克特') return false;
    if (!c.abilities?.some(a => a.name === 'ACE消弭')) return false;
    // 必須附有寶可夢道具（且道具未被阻礙之塔無效化 → 阻礙之塔只無效道具效果，不影響特性判定）
    return !!pk.toolAttached || !!(pk.extraTools && pk.extraTools.length > 0);
  });
}

// ── v2.136 零之大空洞：備戰位上限 ──────────────────────────────────────────────
// 場上活動場地卡為「零之大空洞」且自己場上有「太晶」寶可夢時，該玩家備戰可放 8 隻；
// 場地離場 / 失去太晶 → enforceBenchLimit 自動丟備戰至 5。
// 太晶判定：card.tags?.includes('太晶')（v2.48 scraper 把太晶從 attacks 抽到 tags）。
export function getBenchLimit(state: GameState, idx: 0 | 1, pool: Map<string, Card>): number {
  const s = state.activeStadium;
  if (!s) return 5;
  const stadiumCard = pool.get(s.cardId);
  if (stadiumCard?.name !== '零之大空洞') return 5;
  const player = state.players[idx];
  const all = [player.active, ...player.bench].filter((c): c is CardInstance => !!c);
  const hasTera = all.some(c => pool.get(c.cardId)?.tags?.includes('太晶'));
  return hasTera ? 8 : 5;
}

/**
 * v5.055：透過 iid 在 player 的所有 zone（hand/active/bench/discard/deck）找對應 CardInstance，
 * 回傳 cardId 給對手回合動作 panel 用。找不到回 null（不應該發生，但 safety net）。
 */
function findCardIdByIid(state: GameState, idx: 0 | 1, iid: string | undefined | null): string | null {
  if (!iid) return null;
  const p = state.players[idx];
  const all: CardInstance[] = [
    ...(p.hand ?? []),
    ...(p.active ? [p.active] : []),
    ...(p.bench ?? []),
    ...(p.discard ?? []),
    ...(p.deck ?? []),
    ...(p.prizes ?? []),
  ];
  return all.find(c => c.iid === iid)?.cardId ?? null;
}

/**
 * v5.055：把單一 ActionRecord push 到 player.currentTurnActions buffer。
 * 不可變 — 回傳新 state（GameState 是 immutable）。
 */
function pushCurrentTurnAction(state: GameState, idx: 0 | 1, rec: ActionRecord): GameState {
  if (!rec.cardId) return state;
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = players[idx];
  players[idx] = {
    ...p,
    currentTurnActions: [...(p.currentTurnActions ?? []), rec],
  };
  return { ...state, players };
}

/**
 * v5.055：applyAction wrapper — 比對 before/after state，依 action.type 自動 push
 * 對應的 ActionRecord 到 currentTurnActions。只記錄 7 類玩家主動動作（MVP scope）。
 * Rule 9（特性 gate）: 只在 phase === 'playing' 且 state 真的變了才記錄。
 */
function recordTurnAction(
  before: GameState,
  after: GameState,
  action: GameAction,
  pool: Map<string, Card>,
): GameState {
  // state 沒變 = action failed / gate 擋住 → 不記錄
  if (before === after) return after;
  if (after.phase !== 'playing') return after;
  const aIdx = before.activePlayerIndex;

  let rec: ActionRecord | null = null;
  // v5.892：記下「本 action 從手牌打出的那張卡的 iid」。用於 recordDiscardDiff 精準去重
  //   （trainer 打出即自棄是同一實體卡 iid、同一 applyAction），取代原本「用 cardId 跨整個回合去重」
  //   的舊做法——舊做法會誤抑制「本回合打過同 cardId、之後真的又棄掉另一張同 cardId 卡」的棄牌顯示。
  let justPlayedIid: string | undefined;

  if (action.type === 'PLAY_TRAINER') {
    const cardId = findCardIdByIid(before, aIdx, action.iid);
    if (cardId) { rec = { type: 'play_hand', cardId }; justPlayedIid = action.iid; }
  } else if (action.type === 'ATTACH_ENERGY') {
    // 只在能量是從手牌附時記錄（其他來源如「能量回收」走 resolver 不算此路徑）
    const inHand = (before.players[aIdx].hand ?? []).some(c => c.iid === action.energyIid);
    if (inHand) {
      const cardId = findCardIdByIid(before, aIdx, action.energyIid);
      if (cardId) { rec = { type: 'play_hand', cardId }; justPlayedIid = action.energyIid; }
    }
  } else if (action.type === 'PLAY_BASIC') {
    const cardId = findCardIdByIid(before, aIdx, action.iid);
    if (cardId) { rec = { type: 'play_hand', cardId }; justPlayedIid = action.iid; }
  } else if (action.type === 'EVOLVE') {
    // 進化卡是 toIid（手牌內進化卡）
    const cardId = findCardIdByIid(before, aIdx, action.toIid);
    if (cardId) { rec = { type: 'play_hand', cardId }; justPlayedIid = action.toIid; }
  } else if (action.type === 'ATTACK') {
    const active = before.players[aIdx].active;
    if (active) {
      const card = pool.get(active.cardId);
      const atkName = card?.attacks?.[action.attackIndex]?.name;
      rec = { type: 'attack', cardId: active.cardId, extra: atkName };
    }
  } else if (action.type === 'RETREAT') {
    const oldActive = before.players[aIdx].active;
    if (oldActive) {
      const newActiveInst = (before.players[aIdx].bench ?? []).find(c => c.iid === action.newActiveIid);
      const newActiveName = newActiveInst ? pool.get(newActiveInst.cardId)?.name : undefined;
      rec = {
        type: 'retreat',
        cardId: oldActive.cardId,
        extra: newActiveName ? `→ ${newActiveName}` : undefined,
      };
    }
  } else if (action.type === 'USE_ABILITY') {
    const cardId = findCardIdByIid(before, aIdx, action.iid);
    if (cardId) {
      const card = pool.get(cardId);
      const abName = card?.abilities?.[action.abilityIndex]?.name;
      rec = { type: 'use_ability', cardId, extra: abName };
    }
  }

  // v5.055：先 push 主要 action record（如果有）
  let state = rec ? pushCurrentTurnAction(after, aIdx, rec) : after;

  // v5.057：偵測「該 action 引起的棄牌」— 比對 before/after aIdx player 的 discard pile
  //   v5.892：排除「本 action 剛從手牌打出的那張卡」(同一 iid,如 trainer 打出即自棄)避免重複顯示
  state = recordDiscardDiff(before, state, aIdx, justPlayedIid);
  return state;
}

/**
 * v5.057：偵測動作執行者自己 discard pile 該 action 新增的 cards，
 * push 為 type:'discard' record。排除已在 currentTurnActions 內被 play_hand
 * 記錄過的 cardId（i.e. trainer 自己進棄牌不重複顯示）。
 */
function recordDiscardDiff(before: GameState, after: GameState, aIdx: 0 | 1, justPlayedIid?: string): GameState {
  const beforeDiscard = before.players[aIdx].discard ?? [];
  const afterDiscard = after.players[aIdx].discard ?? [];
  if (afterDiscard.length <= beforeDiscard.length) return after;

  const beforeIids = new Set(beforeDiscard.map(c => c.iid));
  const newDiscards = afterDiscard.filter(c => !beforeIids.has(c.iid));
  if (newDiscards.length === 0) return after;

  // v5.892：改用 iid 精準去重——只排除「本 action 剛從手牌打出的那張實體卡」(如 trainer 打出即自棄,
  //   同一 iid、同一 applyAction 進棄牌)。原本「用 cardId 跨整個回合去重」會誤抑制:本回合打過某 cardId
  //   後,之後真的又棄掉「另一張同 cardId 的卡」(例:先附了 1 張水能量,再用稜鏡塔棄另 1 張水能量)。
  const newRecords: ActionRecord[] = [];
  for (const inst of newDiscards) {
    if (justPlayedIid && inst.iid === justPlayedIid) continue;  // 同一張剛打出的卡(hand→discard)不重複記
    newRecords.push({ type: 'discard', cardId: inst.cardId });
  }

  if (newRecords.length === 0) return after;
  const players = [...after.players] as [PlayerState, PlayerState];
  const p = players[aIdx];
  players[aIdx] = {
    ...p,
    currentTurnActions: [...(p.currentTurnActions ?? []), ...newRecords],
  };
  return { ...after, players };
}

/**
 * v5.055→v5.056：activePlayerIndex 切換時把「剛結束玩家」的 currentTurnActions 搬到 turnActionsLog。
 *
 * v5.055 bug：原本用 state.turn 變化偵測，但 PTCG state.turn 是「整個 round」概念
 * （先攻+後攻各 1 回合 = state.turn 1），雙方輪一次才 +1。導致我方整個回合期間
 * 對手剛剛的動作還沒搬進 turnActionsLog，我方按 END_TURN 才一起搬。慢一個玩家回合。
 *
 * v5.056 修法：改用 before.activePlayerIndex !== after.activePlayerIndex 偵測單一玩家
 * 回合切換 — 對手 END_TURN 後立刻搬對手的 currentTurnActions，我方下回合一開始
 * 就能看到對手剛剛的動作。同時只搬「剛結束玩家」（endedIdx = before.activePlayerIndex），
 * 不動我方的 currentTurnActions。
 */
function maybePushTurnLog(before: GameState, after: GameState): GameState {
  if (before.activePlayerIndex === after.activePlayerIndex) return after;
  // activePlayerIndex 改變 = 單一玩家回合結束
  const endedIdx = before.activePlayerIndex;
  const players = [...after.players] as [PlayerState, PlayerState];
  const p = players[endedIdx];
  const current = p.currentTurnActions ?? [];
  if (current.length === 0) return after;
  const history = (p.turnActionsLog ?? []).slice(-4);  // 保留近 4 回合，加新 1 = 5 回合
  players[endedIdx] = {
    ...p,
    turnActionsLog: [...history, { turn: before.turn, actions: current }],
    currentTurnActions: [],
  };
  return { ...after, players };
}

// 當零之大空洞被換掉/失去太晶時，玩家的備戰上限掉回 5；超出的部分要由玩家自選棄置。
// 由 applyAction 末尾呼叫。卡面要求「持有人先丟」— sim 用 activePlayerIndex 順序。
//
// v2.147 — 改為設 pending（玩家自選），不再自動棄尾端。
//   流程：
//     1) 若 state 已有 pendingSelection → 等下次 applyAction 再 trigger（避免 race）
//     2) 找順序中第一個超過上限的玩家 → 設 bench-choose pending（minCount=maxCount=excess）
//     3) 玩家解 pending → resolver 'enforce-bench-limit' 把選的搬棄牌區
//     4) applyAction 末尾再 call enforceBenchLimit；若另一方還超過 → 再開一個 pending
//   結果：兩邊都需棄時自動串接，且持有人（這裡用 activePlayerIndex 近似）先處理。
function enforceBenchLimit(state: GameState, pool: Map<string, Card>): GameState {
  if (state.phase !== 'playing') return state;
  if (state.pendingSelection) return state;  // 已有 pending — 等
  const order: (0 | 1)[] = [state.activePlayerIndex, (1 - state.activePlayerIndex) as 0 | 1];
  for (const idx of order) {
    const limit = getBenchLimit(state, idx, pool);
    const p = state.players[idx];
    if (p.bench.length <= limit) continue;
    const excess = p.bench.length - limit;
    return {
      ...state,
      pendingSelection: {
        type: 'bench-choose',
        actorIdx: idx,
        sourcePlayerIdx: idx,
        filter: '',
        minCount: excess,
        maxCount: excess,
        effectKey: 'enforce-bench-limit',
        params: {
          titleOverride: `零之大空洞效果失去：選 ${excess} 隻備戰寶可夢丟棄（剩 ${limit} 隻）`,
        },
      },
    };
  }
  return state;
}

// v2.147 — enforce-bench-limit resolver：把選的 bench iid 搬到棄牌區。
RESOLVERS.set('enforce-bench-limit', (state, actorIdx, selectedIids, _params, pool) => {
  const p = state.players[actorIdx];
  const drop = p.bench.filter(c => selectedIids.includes(c.iid));
  if (drop.length === 0) return state;
  const keep = p.bench.filter(c => !selectedIids.includes(c.iid));
  const discardAdds: CardInstance[] = [];
  for (const inst of drop) {
    discardAdds.push(
      inst,
      ...inst.energyAttached,
      ...getAllAttachedTools(inst),
      ...(inst.evolvedFromStack ?? []),
    );
  }
  const players = [...state.players] as [PlayerState, PlayerState];
  players[actorIdx] = { ...p, bench: keep, discard: [...p.discard, ...discardAdds] };
  let s: GameState = { ...state, players };
  const dropNames = drop.map(d => pool.get(d.cardId)?.name ?? '?').join('、');
  s = addLog(s, `零之大空洞效果失去：${players[actorIdx].name} 將備戰多餘的 ${drop.length} 隻寶可夢（${dropNames}）丟棄`, actorIdx);
  return s;
});

// ── v5.878 獎賞卡「翻到正面」＋取獎選擇（克雷色利亞｜弦月光芒）────────────────
// 依 iid 取走指定的獎賞卡，含所有副作用：pendingPrizes 更新、私訊 log（本人看卡名/對手看張數）、
// 勝負判定（取完獲勝）、嘉年華補位。抽出成共用 helper，讓「一般前端取」與「有正面獎賞時的
// 選擇取」共用同一套結算，避免兩份邏輯漂移。進入手牌後剝除 faceUp（不再是獎賞卡）。
function takeSpecificPrizes(
  state: GameState,
  ownerIdx: 0 | 1,
  iidsToTake: string[],
  pool: Map<string, Card>
): GameState {
  const owed = getPendingPrize(state, ownerIdx);
  const taker = { ...state.players[ownerIdx] };
  const takeSet = new Set(iidsToTake);
  const taken = taker.prizes.filter(c => takeSet.has(c.iid));
  if (taken.length === 0) return state;
  const takenBare = taken.map(({ faceUp, ...rest }) => rest as CardInstance);  // 剝除 faceUp
  taker.prizes = taker.prizes.filter(c => !takeSet.has(c.iid));
  taker.hand = [...taker.hand, ...takenBare];
  const newPlayers2 = [...state.players] as [PlayerState, PlayerState];
  newPlayers2[ownerIdx] = taker;
  const newPP: [number, number] = [...(state.pendingPrizes ?? [0, 0])] as [number, number];
  newPP[ownerIdx] = Math.max(0, owed - taken.length);

  const takenNames = taken.map(c => cardLink(c.iid, getCard(c.cardId, pool).name)).join('、');
  const newState: GameState = addPrivateLog(
    { ...state, players: newPlayers2, pendingPrizes: newPP },
    `${taker.name} 取得了 ${taken.length} 張獎賞卡：${takenNames}（剩餘 ${taker.prizes.length} 張）`,
    `${taker.name} 取得了 ${taken.length} 張獎賞卡（剩餘 ${taker.prizes.length} 張）`,
    ownerIdx
  );

  // 勝利條件：獎賞卡全取完
  if (taker.prizes.length <= 0) {
    return {
      ...newState,
      phase: 'game-over',
      winner: ownerIdx,
      winReason: `${taker.name} 取得所有獎賞卡`,
      log: [...newState.log, { turn: newState.turn, playerIndex: null, message: `${taker.name} 取得所有獎賞卡，獲勝！`, timestamp: Date.now() }]
    };
  }
  return tryPromoteToMainForFestival(newState, pool);
}

// v5.880 取獎賞逐張 picker（支援多張正面朝上獎賞、手機純文字友善）。
//   每次讓玩家從剩餘獎賞選 1 張取走：正面朝上顯示卡名（可指定）、蓋著的顯示編號。取 1 張後若還需取
//   且仍有正面朝上獎賞 → 再開 picker；沒有正面朝上獎賞了 → 自動取剩餘蓋著的（玩家分辨不出、無資訊差異）。
// v5.890：蓋著的獎賞彼此對玩家無差異(全未知),故不逐張列出 #1/#2/#3 —— 只讓玩家決定
//   「要不要取翻正面的那幾張」,其餘用單一「隨機取一張蓋著的」選項交給系統代抽。
const PRIZE_TAKE_RANDOM_FACEDOWN = '__prize_random_facedown__';
function buildPrizeTakeOptions(prizes: CardInstance[], pool: Map<string, Card>): { id: string; text: string }[] {
  const opts: { id: string; text: string }[] = [];
  for (const pr of prizes) {
    if (pr.faceUp) opts.push({ id: pr.iid, text: `🔆 正面朝上：${getCard(pr.cardId, pool).name}` });
  }
  // 有任何蓋著的獎賞 → 給一個彙總的「隨機取一張蓋著的」選項(系統代抽,不逐張列)。
  if (prizes.some(pr => !pr.faceUp)) {
    opts.push({ id: PRIZE_TAKE_RANDOM_FACEDOWN, text: `🂠 隨機取一張蓋著的獎賞` });
  }
  return opts;
}
function openPrizeTakePicker(state: GameState, ownerIdx: 0 | 1, remaining: number, pool: Map<string, Card>): GameState {
  return {
    ...state,
    pendingSelection: {
      type: 'modal-choice',
      actorIdx: ownerIdx, sourcePlayerIdx: ownerIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'take-prize-choose',
      params: {
        remaining,
        titleOverride: `取獎賞：還需取 ${remaining} 張。可指定翻正面的獎賞,或選「隨機取一張蓋著的」由系統代抽`,
        options: buildPrizeTakeOptions(state.players[ownerIdx].prizes, pool),
      },
    },
  };
}
RESOLVERS.set('take-prize-choose', (state, ownerIdx, selectedIids, params, pool) => {
  const pickedIid = selectedIids[0];
  const remaining = (params?.remaining as number) ?? 1;
  const taker = state.players[ownerIdx];
  // v5.890：選「隨機取一張蓋著的」→ 取第一張蓋著的(彼此無差異=隨機);
  //   否則取玩家指定的那張正面獎賞。防呆:選到不存在 → 取第一張。
  let validIid: string | undefined;
  if (pickedIid === PRIZE_TAKE_RANDOM_FACEDOWN) {
    validIid = taker.prizes.find(c => !c.faceUp)?.iid ?? taker.prizes[0]?.iid;
  } else {
    validIid = taker.prizes.some(c => c.iid === pickedIid) ? pickedIid : taker.prizes[0]?.iid;
  }
  if (!validIid) return state;
  const s = takeSpecificPrizes(state, ownerIdx, [validIid], pool);  // 取這 1 張
  if (s.phase === 'game-over') return s;
  const stillOwe = remaining - 1;
  if (stillOwe <= 0) return s;
  const p = s.players[ownerIdx];
  if (p.prizes.length === 0) return s;
  // 還需取：仍有正面朝上獎賞 → 繼續讓玩家指定；否則自動取剩餘蓋著的
  if (p.prizes.some(c => c.faceUp)) return openPrizeTakePicker(s, ownerIdx, stillOwe, pool);
  const front = p.prizes.slice(0, stillOwe).map(c => c.iid);
  return takeSpecificPrizes(s, ownerIdx, front, pool);
});

// ── 火箭隊的監視塔（【無】寶可夢特性無效）── 輔助判定 ────────────────────────
// 當場上活動場地卡為 ROCKET_WATCHTOWER_STADIUMS 所列競技場卡時，
// 雙方所有【無】屬寶可夢（pokemonType === 'Colorless'）的特性全部消除。
// 包在 USE_ABILITY / getUsableAbilities / BENCH_PLACE_TRIGGERS 三個發動點。
function isColorlessAbilityBlocked(
  state: GameState,
  pokeCard: Card | undefined,
  pool: Map<string, Card>
): boolean {
  if (!pokeCard || pokeCard.pokemonType !== 'Colorless') return false;
  const s = state.activeStadium;
  if (!s) return false;
  const stadiumCard = pool.get(s.cardId);
  if (!stadiumCard) return false;
  return ROCKET_WATCHTOWER_STADIUMS.has(stadiumCard.name);
}

// ── 可達鴨｜濕氣（防自 KO 特性）── 輔助判定 ─────────────────────────────────
// 卡面文字：「只要這隻寶可夢在場上，雙方所有寶可夢的『將自己【昏厥】的效果』的特性，
//           全部消除。」
// 也就是說：只要「任一方」場上有可達鴨（active 或 bench），所有「自身 KO」類特性
// 都不會觸發。目前適用（v2.95 起統一走 ability 路徑）：
//   - 彷徨夜靈｜咒詛炸彈（5 counter）
//   - 黑夜魔靈｜咒詛炸彈（13 counter）
//   - 三合一磁怪｜過度放電（自身 KO 後附能）
// 註：「自爆磁怪 強勁磁場」等招式是扣己方 HP 不屬「將自己昏厥的特性」，不受影響。
export const SELF_KO_ABILITY_NAMES = new Set<string>([
  '咒詛炸彈',
  '過度放電',
]);

/**
 * v2.93：「同名特性一回合共享 1 次」的白名單。
 * 卡面含「在使用了其他的『XX』的回合，這個特性無法使用」字樣的特性才適用。
 * 全卡池掃描後僅有以下兩張（v2.93-2026-04-24）：
 *   - 月光循環（月石 M1L/M2a/MC）
 *   - 使者衝刺（超級袋獸ex M1S 051/080/089）
 *
 * v2.91 首次實裝時我錯把 gate 套到所有特性，導致兩隻同名寶可夢（例：
 * 土龍節節｜逃跑抽出）同回合都想用時第二隻被誤擋。v2.93 以白名單限定修正。
 *
 * 加入新卡時：只有卡面明寫「在使用了其他的『XX』的回合，這個特性無法使用」
 * 才加入本 set；「在自己的回合時可使用 1 次」屬 per-instance 限制（由既有
 * `CardInstance.abilityUsedThisTurn` flag 負責），不在此範圍。
 */
export const SHARED_ONCE_PER_TURN_ABILITY_NAMES = new Set<string>([
  '月光循環',
  '使者衝刺',
  // v2.218 風扇呼喚（旋轉洛托姆）— 卡面：「在這個回合，若已經使出了其他的「風扇呼喚」，
  //   則這個特性無法使用。」多隻洛托姆同回合只能整個玩家側用 1 次。
  '風扇呼喚',
  // v2.471：補上既有 ad-hoc 實作的 shared 特性（防禦性 — 即使實作層忘記寫 gate，engine 也擋）
  '扭轉乾坤',  // 吉雉雞ex — 卡面：「若已經使出其他扭轉乾坤則無法使用」
  '殺手鐧捕捉', // 喵喵ex — 卡面：「若已經使出名稱中有殺手鐧的特性則無法使用」
  // v5.811：補上同樣 name-based「使出其他X則無法使用」每回合限1次特性(先前漏列)。
  '支配鎖鏈',  // 桃歹郎ex
  '音速搜索',  // 大比鳥ex
  '裝酷重抽',  // 怒鸚哥ex
]);

/**
 * v2.295 「不限次數」主動特性白名單。
 * 卡面明寫「可不限次數使用」的特性列於此，
 * 引擎將跳過每回合 1 次的 abilityUsedThisTurn gate 與標記。
 *
 * ⚠️ 鐵律：新增「不限次數」regA 卡時，務必同步加入此 set，否則：
 *   - getUsableAbilities (engine.ts:~6104) 第二次按時 pk.abilityUsedThisTurn=true 會被擋
 *   - USE_ABILITY (engine.ts:~2687) markUsed 會把 abilityUsedThisTurn 設成 true
 *   雙重 gate 導致卡面「不限次數」變成「一次」。effects 端註解寫「不限次數」是不夠的。
 *   v3.65 補上 4 個漏加的（日光轉移 / 火箭腦力 / 沖刷 / 收集泡泡）。
 */
export const UNLIMITED_USE_ABILITY_NAMES = new Set<string>([
  '烈火亂舞', // 炎武王 — 在自己的回合時，可不限次數使用：從手牌選拉1張「基本【火】能量」卡附於自己的寶可夢身上。
  '激動渦輪', // 花舞鳥ex — 場上有【火】超級進化ex 時，可不限次數使用：手牌基本【火】能量附於備戰【火】寶可夢。
  '電氣流',   // v2.996 奇樹的電肚蛙ex — 在自己的回合時，可不限次數使用：手牌基本【雷】能量附於自己的「奇樹的」寶可夢。
  '日光轉移', // v3.65 超級妙蛙花ex — 在自己的回合時，可不限次數使用：移場上某寶可夢的基本【草】能量到另一隻。
  '火箭腦力', // v3.65 火箭隊的以歐路普 — 在自己的回合時，可不限次數使用：移自己「火箭隊的」寶可夢身上的傷害指示物。
  '沖刷',     // v3.65 白海獅 — 在自己的回合時，可不限次數使用：將備戰【水】能量改附戰鬥場。
  '收集泡泡', // v3.65 瑪力露麗ex — 在自己的回合時，可不限次數使用：將場上其他寶可夢身上的能量改附自身。
]);

// v2.94 的 isPassiveOnlyAttackEntry guard 於 v2.95 移除。
// 根因修已完成：scraper 修 ZWJ strip（parse-card.js）+ migration 腳本把全卡池
// 73 個「[特性]XXX」entry 從 attacks[] 搬到 abilities[]（v2.95 同 commit），
// 引擎層不再需要名稱檢查。彷徨夜靈 / 黑夜魔靈 / 三合一磁怪 的自爆特性
// 改走 regA 正統 ability 路徑（ABILITY_EFFECTS key 為 '卡名|0'）。
export function isSelfKOEffectBlocked(
  state: GameState,
  pool: Map<string, Card>
): boolean {
  for (const p of state.players) {
    const allPokes: CardInstance[] = [
      ...(p.active ? [p.active] : []),
      ...p.bench,
    ];
    for (const pk of allPokes) {
      const card = pool.get(pk.cardId);
      if (card?.abilities?.some(a => a.name === '濕氣')) return true;
    }
  }
  return false;
}

// ── 先攻可使用的支援者（bypass 先手第 1 回合禁打支援者）── 輔助判定 ──────────
// PTCG 規則：先攻玩家的第 1 回合不能使用支援者。但部分支援者卡面明寫「這張卡
// 在先攻玩家的最初回合也可使用」或「這張卡可在先攻玩家的最初回合使用」。這些
// 支援者可以 bypass 該 restriction。用 rulesText 偵測（官網兩種寫法都包含
// 「先攻玩家的最初回合」字串，直接用這當 marker）。
//
// 目前已知適用：
//   - 火箭隊的蘭斯（M2a 211/165 / MC 174/189 / SV10 重印）
//   - 丹瑜（SV6 / SV8a / MC 重印）
//   - 可能還有：未來有新卡附此文字會自動適用，不用改 code
export function canPlaySupporterOnFirstTurn(card: Card): boolean {
  if (card.supertype !== 'Trainer' || card.subtype !== 'Supporter') return false;
  return !!card.rulesText && /先攻玩家的最初回合/.test(card.rulesText);
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
 *
 * v2.62 加固：若 subtype 明確是 'Stage1' / 'Stage2'，不論 evolvesFrom 有無
 * 一律**不是**基礎寶可夢。這是防禦 scraper 漏抓 evolvesFrom 的資料壞案例
 * （例：<火箭隊的>操陷蛛 SV10 009/098 在原 JSON 缺 evolvesFrom、卻 subtype
 * 明確是 Stage1 → 若只靠 evolvesFrom 判斷會被誤當成 Basic 而直接上場）。
 */
// isBasicPokemonCard: 已下沉 selection-filter.ts（engine re-export）

/** 從 pool 判斷一張牌是否為「基礎寶可夢」 */
function isBasicPokemon(cardId: string, pool: Map<string, Card>): boolean {
  return isBasicPokemonCard(pool.get(cardId));
}

/**
 * v2.42 新增：是否可在起手對戰準備時放置於戰鬥場（PLACE_ACTIVE）。
 *
 * 卡面：閃焰王牌（M1L 13974，Stage2）—「【特性】瞬間爆發力：進行對戰準備
 *       將寶可夢放置於戰鬥場上時，若手牌有這張卡，則可將這張卡反面朝上
 *       放置於戰鬥場。」
 *
 * 注意：此例外只允許「戰鬥場」(active)；備戰位仍只能放基礎寶可夢。
 *
 * 不使用 type guard（`card is Card`），因為 isBasicPokemonCard 已是 type guard，
 * 串接會導致 TS 把 false branch 推導成 never。改回傳 boolean。
 */
export function canBeInitialActiveCard(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.supertype !== 'Pokemon') return false;
  if (card.subtype === 'Other') return false;
  // 基礎寶可夢
  if (card.subtype !== 'Stage1' && card.subtype !== 'Stage2' && !card.evolvesFrom) return true;
  // 含「瞬間爆發力」特性的寶可夢（閃焰王牌）
  if (card.abilities?.some((ab) => ab.name === '瞬間爆發力')) return true;
  return false;
}

/**
 * v3.66 統一的「擁有規則的寶可夢」判定（規則盒寶可夢 / Rule Box Pokemon）。
 *
 * PTCG 規則：規則盒寶可夢 = ex / V / VMAX / VSTAR / GX / EX / Mega ex / Tag Team GX 等。
 *   被擊倒時對手獲得 2 張獎賞（部分卡 3 張）— 跟一般寶可夢不同。
 *   下個月（2026 年中）PTCG 預計推出新規則盒寶可夢類型，本 helper 預先把判定統一管理。
 *
 * 判定優先序：
 *   1. tags 含 '規則盒' / RULE_BOX_SUBTYPES 中任一字串 — scraper 未來可在新卡標 tag
 *   2. subtype 在 RULE_BOX_SUBTYPES set 中（'ex' / 'V' / 'VMAX' / 'VSTAR' / 'GX' / 'EX' / 'MegaEvolution'）
 *   3. rulesText 含「擁有規則」字串 — fallback，scraper 未來如撈到該字串就會生效
 *   4. 卡名結尾 ex/EX — 防漏網（理論上 subtype 應覆蓋，這是最後保險）
 *
 * 新規則寶可夢類型上線時，只需把新 subtype 字串加進 types.ts 的 RULE_BOX_SUBTYPES set。
 * 不必再追 5 處 inline 判定（v3.66 前的散落 anti-pattern）。
 *
 * ⚠️ 鐵律：日後新寫「ex / 非 ex 區分」邏輯時，務必用本 helper，不要 inline 寫
 *           `subtype === 'ex' || name.endsWith('ex')` — 那會錯過 V/VMAX/VSTAR/GX
 *           以及未來新規則盒類型。grep `card.subtype === 'ex'` 確認沒有新增散落點。
 */
// isRulePokemon: 已下沉 selection-filter.ts（engine re-export）

/** 從 pool 判斷一張牌是否「可作為起始戰鬥寶可夢」（基礎 OR 瞬間爆發力） */
function canBeInitialActive(cardId: string, pool: Map<string, Card>): boolean {
  return canBeInitialActiveCard(pool.get(cardId));
}

// ══════════════════════════════════════════════════════════════════════════════
// v6.051 互動式開局（閃焰王牌｜瞬間爆發力）
//
// 官方 PTCG RULES §17.40.G（規則庫原文）：
//   Q: 在對戰準備時，若最初抽出的7張手牌中沒有[基礎]寶可夢，僅有閃焰王牌，
//      可以因特性「瞬間爆發力」的效果，將閃焰王牌放置於戰鬥場上並開始對戰嗎？  A: 可以。
//   Q: …那麼**可以不將**閃焰王牌放置於戰鬥場上嗎？
//      A: **可以。／這個情況下，可選擇是否將閃焰王牌放置於戰鬥場上。**
// 也就是這是**玩家的選擇**，而引擎原本一律替玩家選了「放上去」，等於剝奪了一個官方選項
// —— 而且它會影響「誰重抽比較多次」，進而影響對手可以多抽幾張。
//
// 其他相關官方明文（同檔）：
//   ・手牌有 1 張以上【基礎】寶可夢時**不可以**重抽 → 選擇權只存在於「無基礎 ∧ 有瞬爆卡」
//   ・重抽不限次數，直到手牌有【基礎】寶可夢為止
//   ・對手可抽「對手重抽次數 − 自己重抽次數」張，且**可選擇**抽或不抽（現行 NET 公式正確）
// Wilson 裁定（官方查無明文的兩點）：
//   ・重抽後又只抽到閃焰王牌 → **可以再選一次**（每輪判準相同、不限次數）
//   ・雙方各自獨立決定、**不互相等待**，也不顯示對手目前的重抽次數
//
// ⚠**風險控制**：只有「雙方牌組任一含此特性」的對局才會走這條新路；其餘對局一個 byte 都不動。
//   本批（v6.051）再收窄到**本機／AI**：線上、再來一局、錦標賽的呼叫端一律傳
//   `forceLegacyOpening: true`，等本機跑穩再逐條打開。
// ══════════════════════════════════════════════════════════════════════════════

/** v6.051 一鍵回滾點：設 false → 所有對局都走 v6.050 以前的同步發牌。 */
export const INTERACTIVE_OPENING_ENABLED = true;

/**
 * 牌組是否含「瞬間爆發力」特性的卡。
 * ⚠**用特性名判定，不要用卡名/卡號**：官方 Q&A §17.6.G 顯示還有另一張同特性的「倫琴貓」
 *   （目前未收錄本站卡池）。用特性名的話，日後補收錄時這條路自動生效。
 */
function deckHasInstantBurst(
  entries: Array<{ cardId: string }>, pool: Map<string, Card>,
): boolean {
  return entries.some(e => pool.get(e.cardId)?.abilities?.some(ab => ab.name === '瞬間爆發力'));
}

/** 一手牌的三態分類。 */
type OpeningHandKind = 'has-basic' | 'burst-only' | 'none';
function classifyOpeningHand(player: PlayerState, pool: Map<string, Card>): OpeningHandKind {
  if (player.hand.some(c => isBasicPokemon(c.cardId, pool))) return 'has-basic';
  if (player.hand.some(c => canBeInitialActive(c.cardId, pool))) return 'burst-only';
  return 'none';
}

/** 把手牌洗回牌庫並重抽 7 張（不做任何判定）。 */
function redrawOpeningHand(player: PlayerState): void {
  player.deck = shuffle([...player.deck, ...player.hand]);
  player.hand = [];
  for (let i = 0; i < 7; i++) {
    const top = player.deck.shift();
    if (top) player.hand.push(top);
  }
}

/**
 * 互動式開局：替某一側推進到「手牌定案」或「停在玩家要做選擇的點」。
 * 純資料操作（直接改傳入的 player 物件，與 dealOpeningHand 同風格），回傳新的累計狀態。
 *
 * @param alreadyDrawn true = 目前手上這 7 張還沒判定過（createGame 剛發完）；
 *                     false = 需要先重抽一手再判（玩家選了 MULLIGAN）
 */
function advanceOpeningHand(
  player: PlayerState,
  pool: Map<string, Card>,
  acc: { mulligans: number; revealedHands: string[][] },
  alreadyDrawn: boolean,
): { kind: 'done' | 'choice'; mulligans: number; revealedHands: string[][] } {
  // v5.378 的 fail-open 保留：牌組完全沒有可上場的卡（非法牌組）→ 再抽也沒用，直接放行避免無限迴圈
  const deckHasPlaceable = [...player.deck, ...player.hand]
    .some(c => canBeInitialActive(c.cardId, pool));
  let first = alreadyDrawn;
  for (let attempts = 0; attempts < 200; attempts++) {
    if (!first) redrawOpeningHand(player);
    first = false;
    const kind = classifyOpeningHand(player, pool);
    if (kind === 'has-basic') return { kind: 'done', ...acc };
    if (kind === 'burst-only') return { kind: 'choice', ...acc };
    // 完全沒有可上場的卡 → 展示手牌後重抽（＝現行自動 mulligan）
    acc.revealedHands.push(player.hand.map(c => c.cardId));
    acc.mulligans += 1;
    if (!deckHasPlaceable) return { kind: 'done', ...acc };
  }
  return { kind: 'done', ...acc };
}

/**
 * 雙方手牌都定案後，一次寫入現行的 mulligan 欄位 —— 寫完之後的世界與 v6.050 以前完全相同
 * （NET 抵銷、揭示、確認、補抽、tryAdvanceToPlaying 全部原封不動）。
 */
export function finalizeOpening(state: GameState): GameState {
  const [m1, m2] = state.mulliganCounts;
  const revealed = state.mulliganRevealedHands ?? { p1: [], p2: [] };
  return {
    ...state,
    openingChoicePending: [false, false],
    openingDone: [true, true],
    openingFinalized: true,
    pendingMulliganDraw: [Math.max(0, m2 - m1), Math.max(0, m1 - m2)],
    mulliganRevealConfirmed: [m2 === 0, m1 === 0],
    mulliganRevealedHands: revealed,
  };
}

/**
 * v6.053 批3：「該座位的開局已定案」的**唯一判準**（含版本 skew 逃生規則）。
 *
 * ⭐`openingDone[i] || setupDone[i]` —— 後半是逃生口，理由如下：
 *   漸進部署期間一定會出現「新 client × 舊 client」同房（PWA 的 Service Worker 會讓舊
 *   chunk 存活好幾天）。舊 client 的引擎沒有 opening gate，它的玩家可以照常
 *   PLACE_ACTIVE（閃焰王牌本來就過得了 `canBeInitialActiveCard`）＋ FINISH_SETUP，
 *   於是推回來的盤面是「setupDone[opp]=true 但 openingDone[opp] 永遠 false」。
 *   若不設逃生口，新端的 `isOpeningInProgress` 會恆為 true、把自己的擺場動作全部擋死，
 *   而 setup 階段**沒有** `_forceAdoptNext` 自癒（那段明文排除 setup）→ 永久卡局。
 *   語義上這也是正確的：對方既然把寶可夢放上戰鬥場並按了準備，就等於做了 KEEP
 *   （他的 mulliganCounts 沒有增加，與 KEEP 完全一致）。
 *
 * ⚠新×新的正常流程不會誤觸發：開局未定案時 FINISH_SETUP 被擋，setupDone 恆為 false。
 */
export function effectiveOpeningDone(state: GameState): [boolean, boolean] {
  const done = state.openingDone ?? [true, true];
  const sd = state.setupDone ?? [false, false];
  return [!!(done[0] || sd[0]), !!(done[1] || sd[1])];
}

/** 互動式開局是否還在進行中（尚未雙方定案）→ 期間擋住 PLACE_ACTIVE / FINISH_SETUP。 */
export function isOpeningInProgress(state: GameState): boolean {
  if (state.openingFlow !== 'interactive') return false;
  const done = effectiveOpeningDone(state);
  return !done[0] || !done[1];
}

/**
 * v6.053 批3：冪等的開局結算。線上是雙端各自 applyAction，可能發生
 * 「雙方同時各做一次選擇」→ 兩端本地都只看到單邊 done → **誰都不會結算**；
 * 合併後才湊齊雙 done，因此收端合併完必須再跑一次這個函式。
 * 冪等靠 `openingFinalized` 旗標保證（結算一次後永不重跑）。
 */
export function ensureOpeningFinalized(state: GameState): GameState {
  if (state.openingFlow !== 'interactive') return state;
  if (state.openingFinalized) return state;
  const done = effectiveOpeningDone(state);
  if (!done[0] || !done[1]) return state;
  return finalizeOpening(state);
}

// ── v2.187 化石機制 ────────────────────────────────────────────────────────
/**
 * 化石 Item 名稱（5 張，全部 supertype=Trainer / subtype=Item，但卡面寫
 * 「可作為 HP60【無】基礎寶可夢放置於場上」）。
 * 命中此 set 的卡，在手牌時可走 PLAY_FOSSIL 上場（變成 fossilOnField=true 的
 * CardInstance），上場後視為一般寶可夢但有專屬規則：
 *   - HP 永遠 60、屬性永遠【無】、subtype Basic
 *   - 不能進化、不能撤退、永不持有 status / secondaryStatus
 *   - 自己回合 main phase 可走 DISCARD_FOSSIL 自主丟棄（非昏厥）
 *   - 被打 KO 走正常昏厥流程（給對手 1 張獎賞）
 */
export const FOSSIL_ITEM_NAMES = new Set<string>([
  '陳舊的根狀化石',
  '陳舊的背蓋化石',
  '陳舊的羽毛化石',
  '陳舊的顎之化石',
  '陳舊的鰭之化石',
  // v4.895 / M5 — 陳舊的頭蓋/盾牌化石（透過 化石採掘場 Stadium 從牌庫放到備戰）
  //   v4.896：原譯「古老的」校正為「陳舊的」與既有 5 張化石（陳舊的根狀/背蓋/羽毛/
  //           顎之/鰭之化石）命名一致。
  '陳舊的頭蓋化石',
  '陳舊的盾甲化石',
]);

export function isFossilItemCard(card: Card | undefined): boolean {
  return !!card && card.supertype === 'Trainer' && card.subtype === 'Item'
    && FOSSIL_ITEM_NAMES.has(card.name);
}

/**
 * v2.191 陳舊的鰭之化石（J）— 「對手從手牌使出支援者卡時，這隻寶可夢不會
 * 受到那個效果的影響。」
 *
 * 在「對手出 supporter 時試圖目標這隻 fossil」的 effect resolver 中呼叫此 helper
 * 過濾掉鰭之化石。例：對手出某張 supporter 強迫指定對手某隻寶可夢做事 →
 * 該寶可夢若是鰭之化石，則該效果對它無效。
 *
 * 目前實際出戰場機會極低（PTCG 常見 supporter 多數不會直接針對對手單一寶可夢）。
 * 預留 helper 給未來 supporter target picker 用（檢查 picker 候選是否包含此化石）。
 */
export function isFinFossilSupporterImmune(inst: CardInstance, pool: Map<string, Card>): boolean {
  if (!inst.fossilOnField) return false;
  return pool.get(inst.cardId)?.name === '陳舊的鰭之化石';
}

// v2.35：進化同名比對（PTCG 規則：ex 和非 ex 同名卡是同一進化階級）
// helper 定義在 effects/_shared.ts；engine / effects 兩邊共用一份。
import { sameEvoName, recordOppKO, isAbilityBlockedByOakEye, getAllAttachedTools, reconcileMultiToolRelay , cardLink, addPrivateLog, addToolDiscardLog, hasStatusInAnySlot, resolveInfiniteShadowKo, toBareCard } from './effects/_shared'; // v5.842 跨三槽狀態讀取
import { migrateCardId } from '../decks/cardIdMigration'; // v5.336：對戰咽喉點再 migrate 舊 M5 jp id
import { addPendingPrize, getPendingPrize, hasAnyPendingPrize, getAbilityFn, hasAbilityFn, discardIllegalRocketEnergy, updatePlayer } from './effects/_shared'; // v6.020：updatePlayer 修 flushDiverCatchQueue TS2304 runtime 炸彈
import { canApplyEffectToTarget, taikoBariBlocksAttackDamage } from './defense';
export { sameEvoName };
// v3.01 Group 3 Wave 3 helpers — 對手不能使出 X / 對手特性消除 / 寶可夢檢查 / 撤退觸發 / 進化觸發
import {
  isOppStadiumPlayBlocked,
  isOppEvilEyeBlocking,
  isOppItemPlayBlocked,
  isAbilityNullifiedByPassive,
  isAbilityHolderEffective,
  hasAnyEffectiveAbility,
  isReturnToHandBlockedByCalmGround as _calmGroundBlocksReturn,
  hasEffectiveCalmGroundOnSide as _hasCalmGround,
  hasEffectiveKageHide,
  isInitializeNullified,
  hasRocketTyranitarSandstorm,
  getOppRetreatTriggers,
  hasRocketAmpharosDarkPulse,
  hasAbilityOnActive,  // v5.222 Plan A: 統一查「對手戰鬥位特性是否生效」
} from './effects/cards/v3001_g3_wave3';

// v3.05 Deferred Wave A — 自身寶可夢從戰鬥場回備戰時觸發類（ON_RETREAT_TO_BENCH）
//   ON_RETREAT_TO_BENCH_ABILITIES：白名單 Set，列出有此觸發機制的特性名（卡面文義「從戰鬥場回到備戰區時，可使用 1 次」）
//   askUseRetreatToBenchAbility：開 modal-choice 詢問玩家是否使用該特性（仿 askUsePlayAbility）
import { ON_RETREAT_TO_BENCH_ABILITIES, isBenchProtected, applyStatusToOppActive } from './effects';
import { askUseRetreatToBenchAbility } from './effects/cards/v3050_deferred_wave_a';
// v5.243：tryPromptPromoteActive 從 _shared.ts (leaf) 經 effects.ts re-export
import { tryPromptPromoteActive } from './effects';

// v3.07 Deferred Wave D — 3 張需要手牌 UI 元件層 hook 的特性
//   ON_DISCARD_FROM_HAND_ABILITIES: trigger holder 卡名 → effect fn
//   ON_HAND_ACTIVATE_ABILITIES: 手牌寶可夢自身 trigger → effect fn
import {
  ON_DISCARD_FROM_HAND_ABILITIES,
  ON_HAND_ACTIVATE_ABILITIES,
} from './effects';
import {
  hasFieldPokemonByName,
  findFieldPokemonByName,
  oppHasStage2,
} from './effects/cards/v3070_deferred_wave_d';

/**
 * 判斷一張寶可夢卡是否為「2 階進化」。
 * 同樣不能只看 subtype === 'Stage2'（Stage2 ex 的 subtype 是 'ex'）。
 * 正確：`evolvesFrom` 指向的 Stage1 自己也有 `evolvesFrom`（即進化鏈深度 = 3）。
 */
export function isStage2PokemonCard(card: Card | undefined, pool: Map<string, Card>): boolean {
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  for (const c of pool.values()) {
    if (sameEvoName(c.name, card.evolvesFrom) && c.supertype === 'Pokemon' && c.evolvesFrom) return true;
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
  // v2.187：化石上場永遠 60HP，且不吃任何 Tool/能量/Stadium 加減
  if (inst.fossilOnField) return 60;
  const card = pool.get(inst.cardId);
  if (!card) return 0;
  let hp = card.hp ?? 0;
  // v5.999：被動「最大HP」特性(雜草魂/生機森巴/大師工藝/腎上腺力量/暴龍根性)被暗夜羽擊/初始化/黏著
  //   束縛壓制時不套用其最大HP加成。state 缺席(部分UI/可用性路徑)→無法判壓制,預設有效(維持現行,避免回歸)。
  const hpAbilityEffective = (i: CardInstance, c: Card, abName: string): boolean => {
    if (!state) return true;
    let oIdx: 0 | 1 | -1 = -1;
    let loc: 'active' | 'bench' = 'bench';
    for (let k = 0 as 0 | 1; k <= 1; k = (k + 1) as 0 | 1) {
      const p = state.players[k];
      if (p.active && p.active.iid === i.iid) { oIdx = k; loc = 'active'; break; }
      if (p.bench.some(b => b.iid === i.iid)) { oIdx = k; loc = 'bench'; break; }
    }
    if (oIdx < 0) return true;
    return isAbilityHolderEffective(state, i, c, oIdx, abName, loc, pool);
  };
  // 阻礙之塔（Stadium）會讓道具 HP 加成失效；若未傳 state 則忽略此檢查
  const jammed = state ? isToolsJammed(state, pool) : false;
  if (!jammed) {
    // v3.20 多重轉接：iterate 所有道具（toolAttached + extraTools）
    for (const t of getAllAttachedTools(inst)) {
      const tool = pool.get(t.cardId);
      if (!tool) continue;
      const bonusFn = TOOL_HP_BONUS.get(tool.name);
      if (bonusFn) hp += bonusFn(card);
    }
  }
  // v2.175 特殊能量 HP bonus（增強【草】等）— iterate energyAttached
  for (const e of inst.energyAttached) {
    const ec = pool.get(e.cardId);
    if (!ec) continue;
    const fn = SPECIAL_ENERGY_HP_BONUS.get(ec.name);
    if (fn) hp += fn(card);
  }
  // v2.92：引力山岳（Stadium）— 雙方場上所有【2階進化】寶可夢最大 HP -30
  const stadiumNameHP = state?.activeStadium ? pool.get(state.activeStadium.cardId)?.name : undefined;
  if (stadiumNameHP === '引力山岳' && card.stage === 'Stage2') {
    hp = Math.max(0, hp - 30);
  }
  // v2.265：激動競技場（Stadium）— 雙方場上所有【基礎】寶可夢最大 HP +30
  //   （化石上場走 line 354 早退、不吃 Stadium 加減；本 hook 對 fossilOnField 不會觸發）
  if (stadiumNameHP === '激動競技場' && card.stage === 'Basic') {
    hp += 30;
  }
  // v2.382：昂主花葉蒂（Stadium, M4）— 雙方場上所有「超級花葉蒂ex」最大 HP +150
  if (stadiumNameHP === '昂主花葉蒂' && card.name === '超級花葉蒂ex') {
    hp += 150;
  }
  // v2.268 wave 2：max HP 修正類被動特性 ─────────────────────────────────
  // 樂天河童｜生機森巴 (SV9 Stage2 140HP) — 「只要這隻寶可夢在場上，
  //   自己場上所有寶可夢的最大 HP 各「+40」。無論有多少隻⋯不重複。」
  //   只查持有者的所屬玩家是否場上有此特性 → 該玩家所有寶可夢 +40。
  //   要查「擁有者所屬玩家」，需要知道 inst 在哪一邊。直接掃 state.players[*]。
  if (state) {
    for (const p of state.players) {
      const allP = [...(p.active ? [p.active] : []), ...p.bench];
      const hasSamba = allP.some(c => {
        const cc = pool.get(c.cardId);
        if (!cc?.abilities?.some(a => a.name === '生機森巴')) return false;
        return hpAbilityEffective(c, cc, '生機森巴');
      });
      if (!hasSamba) continue;
      // 確認 inst 是這位玩家的寶可夢
      if (allP.some(c => c.iid === inst.iid)) { hp += 40; break; }
    }
  }
  // 修建老匠｜大師工藝 (SV11B Stage2 140HP) — 「這隻寶可夢的最大 HP，
  //   依這隻寶可夢身上附加的【鬥】能量每 1 個『+40』。」
  //   依 host 自身 fighting energy 數量加 HP。
  if (card.name === '修建老匠' && hpAbilityEffective(inst, card, '大師工藝')) {
    let fightingCount = 0;
    for (const e of inst.energyAttached) {
      const ec = pool.get(e.cardId);
      if (!ec || ec.supertype !== 'Energy') continue;
      if (ec.subtype === 'Basic' && (ec.pokemonType === 'Fighting' || /【鬥】/.test(ec.name))) fightingCount++;
      else if (ec.pokemonType === 'Fighting') fightingCount++;
    }
    hp += fightingCount * 40;
  }
  // 怖納噬草｜雜草魂 (SV8a Stage1 100HP) — 「這隻寶可夢的最大 HP，
  //   依對手已經獲得的獎賞卡每 1 張『+50』。」
  // v5.897：同名怖納噬草有兩種特性(雜草魂 HP加成 vs 恐慌牢籠 進化混亂,id 14359 M2)。
  //   原本用 card.name==='怖納噬草' 會把 HP 加成錯套到「恐慌牢籠版」→ 玩家回報進化時被加血。
  //   改判「這張卡實際有『雜草魂』特性」才加,恐慌牢籠版不受影響。
  if (state && (card.abilities?.some(a => a.name === '雜草魂') ?? false) && hpAbilityEffective(inst, card, '雜草魂')) {
    // 找出對手側 → 對手獎賞已被「攻擊方」取走，記錄在 state.players[opp].prizes 上
    //   原始獎賞 6 張，prizes.length 為「剩餘張數」，已取 = 6 - prizes.length。
    //   要找「持有者」對手；判斷 inst 屬於哪一邊：
    let ownerIdx: 0 | 1 | -1 = -1;
    for (let i = 0 as 0 | 1; i <= 1; i = (i + 1) as 0 | 1) {
      const p = state.players[i];
      if ((p.active && p.active.iid === inst.iid) || p.bench.some(c => c.iid === inst.iid)) {
        ownerIdx = i; break;
      }
    }
    if (ownerIdx >= 0) {
      const opp = state.players[(1 - ownerIdx) as 0 | 1];
      const oppPrizesTaken = 6 - (opp.prizes?.length ?? 6);
      hp += oppPrizesTaken * 50;
    }
  }
  // v2.122 夠讚狗｜腎上腺力量 — 身上附【惡】能量時最大 HP +100
  //   v2.120 只在 effects.ts 的 internal effectiveHPInline 加了這段，但 UI 的 hpTotal/
  //   hpRemaining 以及實際 KO 判定全走這裡的 getEffectiveHP，導致 HP+100 完全沒真的生效。
  //   搬到這裡 → UI 顯示與 KO 判定一致。
  //   稜鏡能量 on Basic → 視為全屬性能量（含 Darkness）也算數（Leon v2.120 要求）。
  if (card.name === '夠讚狗' && hpAbilityEffective(inst, card, '腎上腺力量')) {
    const hostIsEvolution = !!card.evolvesFrom || card.stage === 'Stage1' || card.stage === 'Stage2';
    const hasDark = inst.energyAttached.some(e => {
      const ec = pool.get(e.cardId);
      if (!ec || ec.supertype !== 'Energy') return false;
      // 基本【惡】能量
      if (ec.subtype === 'Basic' && (ec.pokemonType === 'Darkness' || /【惡】/.test(ec.name))) return true;
      // 特殊能量本身屬性含 Darkness
      if (ec.pokemonType === 'Darkness') return true;
      // 稜鏡能量 on Basic host → 視為全屬性（含 Darkness）
      if (ec.name === '稜鏡能量' && !hostIsEvolution) return true;
      // 古舊 / 夜光能量 → 單張全屬性
      if (ec.name === '古舊能量' || ec.name === '夜光能量') return true;
      // 火箭隊能量 → 提供【超】【惡】
      if (ec.name === '火箭隊能量') return true;
      return false;
    });
    if (hasDark) hp += 100;
  }
  // v2.355 怪顎龍｜暴龍根性 — 身上附有特殊能量卡時最大 HP +150
  // 卡面：「若這隻寶可夢身上附有特殊能量卡，則最大 HP 值是「+150」。」
  // 判定：energyAttached 中有任意一張 supertype=Energy 且 subtype!=='Basic' 的卡
  if (card.name === '怪顎龍' && card.abilities?.some(a => a.name === '暴龍根性') && hpAbilityEffective(inst, card, '暴龍根性')) {
    const hasSpecial = inst.energyAttached.some(e => {
      const ec = pool.get(e.cardId);
      return ec?.supertype === 'Energy' && ec.subtype !== 'Basic';
    });
    if (hasSpecial) hp += 150;
  }
  return hp;
}

/** 台灣卡牌中文屬性名稱 → EnergyType（當 pokemonType 欄位遺漏時備用） */
// 備註：台灣卡面使用「鬥」（例：基本【鬥】能量），舊卡曾用「格」；兩者同對應 Fighting。
// ZH_ENERGY_TYPE: 已下沉 selection-filter.ts（本檔 import 使用）

/**
 * v2.108 共用 helpers — 判定「基本 X 屬性能量」
 * Scraper 對基本能量的 `pokemonType` 欄位通常留空（屬性從卡名【X】推），
 * 所以判斷「基本草能量」時一定要從 name parse，不能信 pokemonType。
 * v2.103 canAffordAttack 的繁茂 check 就是因為只檢查 pokemonType 才整個失效。
 */
// isBasicEnergyOfType: 已下沉 selection-filter.ts（engine re-export）

/**
 * v6.008：取「基本能量卡的屬性」。scraper 對基本能量的 pokemonType 幾乎都留空（現役 68 張基本能量
 *   全部 pokemonType=null）→ 屬性必須從卡名【X】推導。稜鏡充能 / 伊布｜鮮豔捕捉 等「各不同屬性的
 *   基本能量」picker 去重（DistinctTypes）用。回 null=非基本能量或無法判定屬性。
 *   ⚠禁直接讀 card.pokemonType 判基本能量屬性（恒 null → 全被濾掉，玩家「選不了基礎能量」）。
 */
// getBasicEnergyType: 已下沉 selection-filter.ts（engine re-export）

/**
 * v6.010 中央 sanitize 閘（Fable 規劃 P0-1）：RESOLVE_SELECTION 把 client 傳來的 selectedIids 交給
 *   resolver 前先消毒——去掉不在該 pending 對應 zone 的 iid、去重、套 params.validIids 交集、夾到
 *   pending.maxCount。防惡意 client 傳整副牌庫(疊牌)/重複(複製卡)/超量/他 zone 的 iid 作弊。
 *   ⚠語義=sanitize(濾非法項)非 reject(reject 會殘留 pending 造成線上軟鎖,v6.006 災難類)。
 *   ⚠type-aware:distribute(合法用重複編碼計數)/active-energy-discard(能量iid,另有單位邏輯)/
 *     modal-choice(payload 是選項字串非 iid)/reorder-deck-top(來源為 params.candidateIids)一律【原封放行】。
 *   filter 語義(如 BasicEnergy/限ex)本閘不驗,由 resolver 自驗(v6.009)或未來中央 filter evaluator(Stage 2)補。
 */
export function sanitizeSelectedIids(state: GameState, pending: PendingSelection, iids: string[], pool?: Map<string, Card>): string[] {
  if (!Array.isArray(iids) || iids.length === 0) return Array.isArray(iids) ? iids : [];
  const t = pending.type;
  const srcIdx = ((pending.sourcePlayerIdx ?? pending.actorIdx ?? 0) as 0 | 1);
  const p = state.players[srcIdx];
  // v6.010:保守只消毒 deck-search(暗碼迷疊牌/稜鏡去重的實際漏洞面;zone=deck 明確、無合法重複、
  //   無 resolver 讀非牌庫 iid)。hand/場上/heal-target 等通用型別 resolver 讀取語義多變(神奇糖果
  //   heal-target 進化目標走此型)→誤擋風險高,一律【原封放行】,由 resolver 自驗或 Stage 2 filter evaluator 補。
  let zone: { iid: string }[] | undefined;
  if (t === 'deck-search') zone = p?.deck;
  else return iids;   // 非 deck-search 型別 → 原封放行(不改變行為)
  const zoneSet = new Set((zone ?? []).map(c => c.iid));
  const vi = pending.params?.validIids as string[] | undefined;
  const validSet = Array.isArray(vi) ? new Set(vi) : null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const iid of iids) {
    if (seen.has(iid) || !zoneSet.has(iid)) continue;
    if (validSet && !validSet.has(iid)) continue;
    seen.add(iid); out.push(iid);
    if (typeof pending.maxCount === 'number' && out.length >= pending.maxCount) break;
  }
  // v6.018 批5 Stage2:對「已收錄 filter」做語義驗證——把不符卡面 filter 的 client iid 濾掉（稜鏡塞非能量卡等）。
  //   單項三態 fail-open：evaluateSelectionFilter 回 false 才濾，回 null（未收錄/查不到卡）一律保留，不誤殺；
  //   pool 缺席（舊呼叫者/測試未傳）時跳過。閘與 UI/AI 用同一 predicate → 玩家合法候選必過閘。
  const f = pending.filter;
  if (pool && f && isKnownSelectionFilter('deck-search', f)) {
    const bySemantic = out.filter((iid) => {
      const inst = (zone ?? []).find((c) => c.iid === iid) as CardInstance | undefined;
      const card = inst ? pool.get(inst.cardId) : undefined;
      return evaluateSelectionFilter('deck-search', f, { iid }, card, {}) !== false;
    });
    // set-level 去重（BasicEnergy:DistinctTypes 首見保留）；語義=sanitize 非 reject
    const insts = bySemantic
      .map((iid) => (zone ?? []).find((c) => c.iid === iid) as CardInstance | undefined)
      .filter((c): c is CardInstance => !!c);
    return sanitizeSelectionSet('deck-search', f, insts, pool);
  }
  return out;
}

/**
 * v4.963：通用版 — 不限 Basic 能量 + name【X】 fallback。
 *   未來新代碼用此 helper 認「視為提供 X 屬性的能量卡」，避免 scraper pokemonType=null 誤判。
 *   涵蓋：基本【X】能量 + 特殊【X】能量（卡名含【X】如「泡沫【水】能量」）。
 *   不涵蓋：新衝天 / 稜鏡 / 古舊 / 夜光（卡名無【X】），caller 自加 special-case。
 */
export function isEnergyOfType(ec: Card | undefined, type: EnergyType): boolean {
  if (!ec || ec.supertype !== 'Energy') return false;
  if (ec.pokemonType === type) return true;
  const m = ec.name.match(/【(.+?)】/);
  if (!m) return false;
  return ZH_ENERGY_TYPE[m[1]] === type;
}

/**
 * v5.702：單一附加能量「依 host 視為提供某屬性幾個單位」host-aware 單一來源（移自 effects.ts，
 *   放 engine 底層讓 getUsableAbilities 可用性 gate 與 effects 發動 handler 共用同一函式，
 *   修「移動邏輯改 host-aware 但可用性 gate 沒一併改」型不一致）。
 *   稜鏡(Basic=全屬性/進化=僅Colorless)/新衝天(Stage2=全屬性)/燃火/古舊(全屬性)/火箭隊。
 */
export function energyTypeUnitsHostAware(host: { cardId: string }, e: { cardId: string }, type: EnergyType, pool: Map<string, Card>): number {
  const ec = pool.get(e.cardId);
  if (!ec || ec.supertype !== 'Energy') return 0;
  const hostCard = pool.get(host.cardId);
  const hostStage = hostCard?.stage ?? hostCard?.subtype;
  const hostIsEvolution = hostStage === 'Stage1' || hostStage === 'Stage2' || !!hostCard?.evolvesFrom;
  const hostIsStage2 = hostStage === 'Stage2';
  if (ec.name === '新衝天能量') return hostIsStage2 ? 2 : (type === 'Colorless' ? 1 : 0);
  if (ec.name === '稜鏡能量') return !hostIsEvolution ? 1 : (type === 'Colorless' ? 1 : 0);
  if (ec.name === '燃火能量') return type === 'Colorless' ? (hostIsEvolution ? 3 : 1) : 0;
  if (ec.name === '古舊能量') return 1; // 全屬性 ACE SPEC
  if (ec.name === '火箭隊能量') return (type === 'Psychic' || type === 'Darkness') ? 2 : 0;
  return isEnergyOfType(ec, type) ? 1 : 0;
}
/** v5.702：「這張附加能量當下是否視為提供某屬性」host-aware 述詞（選/移/丟「【X】能量」一律走此，禁 isEnergyOfType）。 */
export function energyProvidesType(host: { cardId: string }, e: { cardId: string }, type: EnergyType, pool: Map<string, Card>): boolean {
  return energyTypeUnitsHostAware(host, e, type, pool) > 0;
}

/**
 * v2.108：場上是否有「大竺葵｜繁茂」在 ownerIdx 玩家側？
 * 繁茂：自己所有寶可夢身上的「基本【草】能量」視為各提供 2 個【草】能量
 * （這個特性的效果不會重複，多隻大竺葵也只算一次）。
 */
export function hasBloomAbilityOnField(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card>,
): boolean {
  if (!state || ownerIdx == null) return false;
  // v5.601：繁茂 holder 被振翼髮暗夜羽擊/海兔獸黏著束縛/鐵荊棘ex初始化消除時不算 → 委派中央 hasBloomOnField。
  return hasBloomOnField(state, ownerIdx, pool);
}

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
  '富裕能量': ['Colorless'],     // ACE SPEC — 視為 1【無】能量（附加時抽 4 走 effects）
  '感應【超】能量': ['Psychic'], // 視為 1【超】能量（附加到【超】寶可夢時搜尋基礎【超】，走 effects）
  // v2.35：火箭隊能量 — 只可附於「火箭隊的寶可夢」身上，視為 2 個「2 種屬性」的能量【超】與【惡】。
  // 以 [Psychic, Darkness] 表示 1 超 + 1 惡 = 共 2 單位；非火箭隊寶可夢時由 SPECIAL_ENERGY_ATTACH hook 自棄。
  '火箭隊能量': ['Psychic', 'Darkness'],
  // v2.103 古舊能量（ACE SPEC）— 視為 1 個所有屬性的能量（1 unit 但 types 含全屬性，可付任何 cost slot）
  '古舊能量': ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'],
  // v2.103 燃火能量 — 視為 1 個【無】能量；若附於進化寶可夢則視為 3 個【無】能量（由 canAffordAttack 內 inline 判定）
  '燃火能量': ['Colorless'],
  // v2.113 稜鏡能量 — 1 個【無】；若附於非【基礎】寶可夢則視為 1 個所有屬性（inline）
  '稜鏡能量': ['Colorless'],
  // v2.113 新衝天能量（ACE SPEC）— 1 個【無】；若附於【2 階進化】寶可夢則視為 2 個所有屬性（inline）
  '新衝天能量': ['Colorless'],
  // v2.133 薄霧能量 — 視為 1 個【無】能量。
  //   v2.138 起「附有的寶可夢不受對手招式效果影響」已在 hasEffectShield helper 實裝。
  '薄霧能量': ['Colorless'],
  // v2.195 燃料【火】能量 — 視為 1 個【火】能量。
  //   附加效果（招式效果丟棄時放回手牌）由 ATTACK pipeline 的 fuelFireSnapshotIids
  //   類比 boomerang revive 處理。
  '燃料【火】能量': ['Fire'],
  // v2.330 增強【草】能量 — 視為 1 個【草】能量；HP+20 由 SPECIAL_ENERGY_HP_BONUS hook 處理。
  '增強【草】能量': ['Grass'],
  // v2.330 泡沫【水】能量 — 視為 1 個【水】能量；免疫灼傷/中毒由 SPECIAL_ENERGY_STATUS_IMMUNE hook 處理。
  '泡沫【水】能量': ['Water'],
  // v2.330 磁鐵【鋼】能量 — 視為 1 個【鋼】能量；撤退為 0 由 SPECIAL_ENERGY_RETREAT_MOD hook 處理。
  '磁鐵【鋼】能量': ['Metal'],
  // v4.87 閃電能量（M5）— 視為 1 個【雷】能量；附加者使用招式對對手戰鬥寶可夢 +20 傷害
  //   (+20 buff 由 engine damage calc inline 套用，weakness 前)
  '伏特【雷】能量': ['Lightning'],
  // v5.065 暗影【惡】能量（M5）— 視為 1 個【惡】能量；附加者在備戰位免疫對手招式傷害
  //   (備戰位免疫由 defense.ts canApplyEffectToTarget 1c 處理；惡屬性限定)
  //   起源：v5.022 改名「暗影惡能量」→「暗影【惡】能量」但 SPECIAL_ENERGY_TYPES 表
  //   漏加 entry，導致對戰時 fallback 到 ['Colorless'] → 玩家附了也無法滿足
  //   惡屬性招式能量需求（玩家 v5.064 後回報）。
  '暗影【惡】能量': ['Darkness'],
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
 *
 * v2.120：host-aware — 某些特殊能量（稜鏡能量）根據 host 寶可夢階段提供不同屬性：
 *   稜鏡能量 on Basic → 視為所有屬性（Leon 要求修正 v2.113 反邏輯）
 *   稜鏡能量 on Evolution → 僅無色
 * 新衝天能量 on Stage2 → 視為所有屬性×2；其他 → 無色×1
 * 這些都要反映到 countEnergy，才能讓腎上腺力量等判定「身上有惡能量」正確生效。
 */
export function countEnergy(
  pokemon: CardInstance,
  pool: Map<string, Card>
): Map<EnergyType, number> {
  const hostCard = pool.get(pokemon.cardId);
  const hostStage = hostCard?.stage ?? hostCard?.subtype;
  const hostIsEvolution = hostStage === 'Stage1' || hostStage === 'Stage2' || !!hostCard?.evolvesFrom;
  const hostIsStage2 = hostStage === 'Stage2';
  const ALL_TYPES: EnergyType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'];

  const map = new Map<EnergyType, number>();
  const add = (types: EnergyType[]) => {
    for (const t of types) map.set(t, (map.get(t) ?? 0) + 1);
  };
  for (const e of pokemon.energyAttached) {
    const ec = pool.get(e.cardId);
    if (ec?.name === '稜鏡能量') {
      add(hostIsEvolution ? ['Colorless'] : ALL_TYPES);
      continue;
    }
    if (ec?.name === '新衝天能量') {
      if (hostIsStage2) { add(ALL_TYPES); add(ALL_TYPES); }
      else              { add(['Colorless']); }
      continue;
    }
    if (ec?.name === '燃火能量') {
      // 燃火能量 on 進化 = 3 個【無】；否則 1 個【無】
      if (hostIsEvolution) { add(['Colorless']); add(['Colorless']); add(['Colorless']); }
      else                 { add(['Colorless']); }
      continue;
    }
    add(getEnergyProvided(e.cardId, pool));
  }
  return map;
}

/**
 * 能量「單位」：描述單一個能量在成本檢查時可視為哪些屬性。
 * - 基本能量：1 個單位、types=[對應屬性]（純種）
 * - 硬岩【鬥】/ 感應【超】：1 個單位、types=[對應屬性]
 * - 富裕能量：1 個單位、types=['Colorless']（通吃 Colorless slot；遇到有色需求不可用）
 * - 火箭隊能量：2 個單位、types=['Psychic','Darkness']（任意當作超或惡）
 * - 其他未登記特殊能量 fallback：1 個單位、types=['Colorless']
 *
 * 成本檢查會以 unit 為單位做匹配（每個 unit 最多付 1 個 cost slot），
 * 所以 1 張火箭隊能量能付 2 超、或 2 惡、或 1 超 1 惡，而不是寫死 1 超 + 1 惡。
 */
export type EnergyUnit = { types: EnergyType[] };

export function getEnergyUnits(cardId: string, pool: Map<string, Card>): EnergyUnit[] {
  const c = pool.get(cardId);
  if (!c || c.supertype !== 'Energy') return [];
  if (c.subtype === 'Basic') {
    let t: EnergyType | undefined;
    if (c.pokemonType) t = c.pokemonType;
    else {
      const m = c.name.match(/【(.+?)】/);
      if (m) t = ZH_ENERGY_TYPE[m[1]];
    }
    return t ? [{ types: [t] }] : [];
  }
  // 特殊能量多單位 / 多屬性顯式處理
  if (c.name === '火箭隊能量') {
    // 2 個單位，各可當作【超】或【惡】
    return [
      { types: ['Psychic', 'Darkness'] },
      { types: ['Psychic', 'Darkness'] },
    ];
  }
  // v2.103 古舊能量（ACE SPEC）— 單一 unit，types 含全屬性，可付任何 cost slot
  if (c.name === '古舊能量') {
    return [{ types: SPECIAL_ENERGY_TYPES['古舊能量'] }];
  }
  // 一般特殊能量：依 SPECIAL_ENERGY_TYPES 每個 type 拆成 1 個單純單位
  if (SPECIAL_ENERGY_TYPES[c.name]) {
    return SPECIAL_ENERGY_TYPES[c.name].map((t) => ({ types: [t] }));
  }
  // fallback：1 個 Colorless 單位
  return [{ types: ['Colorless'] }];
}

/**
 * 計算一組附加能量的總「單位數」（用於撤退成本判定）。
 * 基本能量 / 一般特殊能量：1 張 = 1 unit
 * 火箭隊能量：1 張 = 2 units（等同 2 顆無屬性）
 * 未登記能量 fallback：1 張 = 1 unit（getEnergyUnits 回 [{Colorless}]）
 * 找不到卡的保底：1 unit（避免異常讓玩家卡死）。
 *
 * v2.108：加 state + ownerIdx 可選參數；若提供且場上有大竺葵｜繁茂，
 *   則基本【草】能量視為 2 units（撤退支付能量時生效）。
 */
export function totalEnergyUnits(
  attached: CardInstance[],
  pool: Map<string, Card>,
  state?: GameState,
  ownerIdx?: 0 | 1,
  hostInst?: CardInstance,
): number {
  const hasBloom = hasBloomAbilityOnField(state, ownerIdx, pool);
  // v5.125：燃火能量倍率 — 卡面「若附於進化寶可夢身上，則視為提供 3 個【無】能量」。
  //   原 getEnergyUnits 簽名只有 cardId 沒 host 資訊 → 燃火能量走 fallback 1 unit，
  //   撤退用此函式時沒考慮倍率（玩家回報撤退用燃火能量只算 1 個）。
  //   修法：caller 傳 hostInst（如 attacker.active），inline 判斷進化倍率。
  const hostCard = hostInst ? pool.get(hostInst.cardId) : null;
  const hostIsEvolution = !!(hostCard && (hostCard.evolvesFrom
    || hostCard.stage === 'Stage1' || hostCard.stage === 'Stage2'
    || hostCard.subtype === 'Stage1' || hostCard.subtype === 'Stage2'));
  let n = 0;
  for (const e of attached) {
    const ec = pool.get(e.cardId);
    if (hasBloom && isBasicEnergyOfType(ec, 'Grass')) {
      n += 2;
      continue;
    }
    // v5.125 燃火能量倍率
    if (ec?.name === '燃火能量') {
      n += hostIsEvolution ? 3 : 1;
      continue;
    }
    // v5.145 新衝天能量倍率 — 卡面「若附於 2 階進化寶可夢，視為提供 2 個所有屬性能量」
    //   原 SPECIAL_ENERGY_TYPES 只算 1 unit，沒考慮 host stage → 撤退時 Stage2 新衝天只算 1
    if (ec?.name === '新衝天能量') {
      const hostIsStage2 = !!(hostCard && (hostCard.stage === 'Stage2' || hostCard.subtype === 'Stage2'));
      n += hostIsStage2 ? 2 : 1;
      continue;
    }
    const units = getEnergyUnits(e.cardId, pool);
    n += units.length === 0 ? 1 : units.length;
  }
  return n;
}

/**
 * 判斷招式能量需求是否滿足。
 * 以「能量單位」做匹配：每個 unit 最多付 1 個 cost slot。
 * - 'Colorless' cost 可由任何 unit 支付（包括 types=['Psychic'] 的純種單位）。
 * - 有色 cost 必須由 types 中有該色的 unit 支付。
 * 使用回溯確保如「火箭隊能量+基本超」這類混合能量組合能正確分配。
 */
export function canAffordAttack(
  pokemon: CardInstance,
  cost: EnergyType[],
  pool: Map<string, Card>,
  state?: GameState,
  attackerIdx?: 0 | 1,
  attackName?: string,
): boolean {
  // v2.78 鼓擊 — 招式所需 +N【無】
  if (pokemon.attackCostIncreaseColorlessThisTurn && pokemon.attackCostIncreaseColorlessThisTurn > 0) {
    cost = [...cost, ...Array(pokemon.attackCostIncreaseColorlessThisTurn).fill('Colorless' as EnergyType)];
  }
  // v3.77 夜間礦山（Stadium）— 雙方場上所有「太晶」寶可夢使用招式所需的能量 +1【無】
  //   卡面：「雙方場上所有『太晶』寶可夢使用招式所需的能量，各增加 1 個【無】能量。」
  //   條件：state.activeStadium === '夜間礦山' + attacker.tags 含「太晶」
  if (state && state.activeStadium) {
    const stadiumCardForNightMine = pool.get(state.activeStadium.cardId);
    const atkCardForNightMine = pool.get(pokemon.cardId);
    if (stadiumCardForNightMine?.name === '夜間礦山' && atkCardForNightMine?.tags?.includes('太晶')) {
      cost = [...cost, 'Colorless' as EnergyType];
    }
  }
  // v2.127 酋雷姆｜反等離子 — 對手棄牌區若有「阿克羅瑪」相關卡，三重冰霜成本改為 1 顆【無】
  if (state && attackName) {
    const attackerCard = pool.get(pokemon.cardId);
    const attackerName = attackerCard?.name ?? '';
    const overridden = getKyuremElectroplasmaEffectiveCost(attackerName, attackName, state, pool, cost);
    if (overridden !== cost) cost = overridden;
    // v2.133 月月熊 赫月ex｜老練招式 — 「血月」所需【無】減少對手已獲得獎賞數
    // v5.723：老練招式是【無】寶可夢(月月熊赫月ex)的「特性」改寫 cost — 火箭隊的監視塔在場時【無】寶可夢
    //   特性全消除 → cost 不減。音波龍|調諧迴響(下方 overridden8)同屬【無】特性型 cost-modifier，一併 gate。
    //   其餘 cost-modifier 持有者皆非【無】(酋雷姆龍/八爪武師鬥/狙射樹梟草/瑪力露麗超/鐵螯惡水/熾焰咆哮虎火/
    //   好勝毛蟹水)或為招式自帶條件(觸手激怒/反撲剪)，不受監視塔影響。通則:新增【無】寶可夢特性型 cost-modifier
    //   都要走此 isColorlessAbilityBlocked gate。
    const colorlessAbilityNullified = isColorlessAbilityBlocked(state, attackerCard, pool);
    if (!colorlessAbilityNullified) {
      const overridden2 = getUrsalunaBloodMoonEffectiveCost(attackerName, attackName, state, pool, cost);
      if (overridden2 !== cost) cost = overridden2;
    }
    // v2.161 八爪武師｜觸手激怒 — 身上有傷害指示物則只需 1 個【鬥】
    const overridden3 = getOctopusTentacleEffectiveCost(pokemon, attackerName, attackName, cost);
    if (overridden3 !== cost) cost = overridden3;
    // v2.385 狙射樹梟ex｜狙擊手之眼 — 對手手牌 = 4 張時無能量 cost 消除
    if (attackerCard) {
      const overridden4 = getDecidueyeSnipeEffectiveCost(attackerCard, state, cost);
      if (overridden4 !== cost) cost = overridden4;
    }
    // v2.997 好勝毛蟹／輕身鱈｜事先準備 — 招式所需【無】減自方棄牌「海岱」張數
    const overridden5 = getCorphishPreparationEffectiveCost(attackerName, attackName, state, pool, cost);
    if (overridden5 !== cost) cost = overridden5;
    // v2.997 熾焰咆哮虎ex｜喧鬧競技 — 招式所需【無】減對手備戰寶可夢數量
    const overridden6 = getSkeledirgeRowdyContestEffectiveCost(attackerName, attackName, state, pool, cost);
    if (overridden6 !== cost) cost = overridden6;
    // v2.997 瑪力露麗｜亮亮泡 — 自方場上有「太晶」寶可夢時，「捨身衝撞」cost 改為 1【超】
    const overridden7 = getAzumarillSparkleSplashEffectiveCost(attackerName, attackName, state, pool, cost);
    if (overridden7 !== cost) cost = overridden7;
    // v2.997 音波龍｜調諧迴響 — 雙方手牌張數相同時，「恐慌嚎鳴」cost 全部消除
    if (!colorlessAbilityNullified) {  // v5.723：音波龍|調諧迴響是【無】寶可夢特性 → 監視塔在場消除
      const overridden8 = getSonidoTuningResonanceEffectiveCost(attackerName, attackName, state, pool, cost);
      if (overridden8 !== cost) cost = overridden8;
    }
    // v4.976 鐵螯龍蝦｜反撲剪 — 身上有傷害指示物則只需 1 個【惡】
    const overridden9 = getIronCrabCounterClipEffectiveCost(pokemon, attackerName, attackName, cost);
    if (overridden9 !== cost) cost = overridden9;
  }
  // v2.149 璀璨結晶（Tool ACE SPEC）：附有此 Tool 的「太晶」寶可夢使用招式時，
  //   能量需求 -1 個。卡面：「（減少的能量任何屬性皆可。）」
  //   v3.9995 修：原 v2 固定「優先扣 Colorless 否則扣最後 1 個」是簡化實裝（違反 Iron Rule 7）。
  //   例：龍之頭擊 cost=[Fire, Psychic]：原版扣最後 → [Fire]，玩家只有 Psychic 時不能用，
  //     但卡面明寫「任意屬性皆可」應由玩家彈性選擇。
  //   正確邏輯：設旗標，主匹配時嘗試所有 N 種扣法（skipIdx 0..N-1），任一成功即可。
  //   阻礙之塔時道具失效。
  let hasShinyCrystalReduction = false;
  {
    const pokeCardForTool = pool.get(pokemon.cardId);
    const isTera = pokeCardForTool?.tags?.includes('太晶');
    const toolsJammed = state ? isToolsJammed(state, pool) : false;
    if (isTera && !toolsJammed && cost.length > 0) {
      // v3.20 多重轉接：iterate 所有道具
      for (const t of getAllAttachedTools(pokemon)) {
        const toolCard = pool.get(t.cardId);
        if (toolCard?.name === '璀璨結晶') {
          hasShinyCrystalReduction = true;
          break;
        }
      }
    }
  }
  // v2.176 反擊增幅器（PokemonTool）：若自己剩餘獎賞 > 對手，附有此 Tool 的寶可夢
  //   招式所需能量 -1 個【無】。需有 Colorless 才生效（不轉換為其他屬性）。
  //   阻礙之塔時道具失效。
  if (state && attackerIdx !== undefined) {
    const toolsJammed = isToolsJammed(state, pool);
    if (!toolsJammed) {
      const myPrizes = state.players[attackerIdx].prizes.length;
      const oppPrizes = state.players[(1 - attackerIdx) as 0 | 1].prizes.length;
      if (myPrizes > oppPrizes) {
        // v5.919 多重轉接：每張「反擊增幅器」各減 1 個【無】(原 break 只算 1 張,洛托姆等
        //   由「多重轉接」附 2 張時漏第 2 張效果 → 配件秀 CC 費應可減到 0 卻仍需 1 能量而打不出)。
        for (const t of getAllAttachedTools(pokemon)) {
          if (pool.get(t.cardId)?.name !== '反擊增幅器') continue;
          const colorlessIdx = cost.indexOf('Colorless');
          if (colorlessIdx >= 0) {
            cost = [...cost.slice(0, colorlessIdx), ...cost.slice(colorlessIdx + 1)];
          }
        }
      }
    }
  }
  // P2-2 赫普的講究頭帶（PokemonTool）：附有此 Tool 的「赫普的」寶可夢使用招式時，
  //   能量需求 -1 個【無】。需有 Colorless 才生效（不轉換為其他屬性）。
  //   阻礙之塔時道具失效。
  {
    const toolsJammed = state ? isToolsJammed(state, pool) : false;
    if (!toolsJammed) {
      // v3.20 多重轉接：iterate 所有道具
      for (const t of getAllAttachedTools(pokemon)) {
        const toolCard = pool.get(t.cardId);
        if (toolCard?.name !== '赫普的講究頭帶') continue;
        const pokeCardForHeadband = pool.get(pokemon.cardId);
        if (pokeCardForHeadband?.name?.startsWith('赫普的')) {
          const colorlessIdx = cost.indexOf('Colorless');
          if (colorlessIdx >= 0) {
            cost = [...cost.slice(0, colorlessIdx), ...cost.slice(colorlessIdx + 1)];
          }
        }
        break;
      }
    }
  }
  // v2.190 陳舊的根狀化石（戰鬥場）— 對手【基礎】寶可夢使用招式所需的能量增加 1 個【無】
  //   攻擊方寶可夢 stage=Basic（或 isBasicPokemonCard）+ 對手戰鬥場是 fossilOnField=陳舊的根狀化石
  //   → cost 加一個 'Colorless'
  if (state && attackerIdx !== undefined) {
    const dIdx = (1 - attackerIdx) as 0 | 1;
    const defActive = state.players[dIdx].active;
    if (defActive?.fossilOnField) {
      const defCard = pool.get(defActive.cardId);
      if (defCard?.name === '陳舊的根狀化石') {
        const attackerCard = pool.get(pokemon.cardId);
        // v6.047：同 aura 裁定 —— 這是對手的**特性**加在我方寶可夢身上的費用增加，
        //   化隱／光之翼（卡面明寫不受對手特性效果影響）應擋下。薄霧能量只擋招式效果，不擋這裡。
        const _rootGuard = isBasicPokemonCard(attackerCard)
          ? canApplyEffectToTarget(state, dIdx, pokemon, attackerCard, 'ability-effect', pool, { isBench: false })
          : { blocked: false as const };
        if (isBasicPokemonCard(attackerCard) && !_rootGuard.blocked) {
          cost = [...cost, 'Colorless'];
        }
      }
    }
  }
  // v2.103 大竺葵｜繁茂：自己場上有大竺葵時，自己所有寶可夢身上的「基本【草】能量」視為 2 個【草】能量。
  //   「這個特性的效果不會重複」→ 多隻大竺葵也只算一次倍率。
  // v2.108 修：原 check 用 `pokemonType === 'Grass'`，但基本能量的 pokemonType 欄位通常空，
  //   屬性從卡名【草】推。改用 isBasicEnergyOfType 共用 helper。
  const hasBloom = hasBloomAbilityOnField(state, attackerIdx, pool);
  // v2.103 燃火能量：若附於進化寶可夢身上，視為 3 個【無】能量；否則 1 個【無】能量
  const pokeCard = pool.get(pokemon.cardId);
  const pokeStage = pokeCard?.stage ?? pokeCard?.subtype;
  const isEvolution = pokeStage === 'Stage1' || pokeStage === 'Stage2';

  // v2.113 稜鏡/新衝天能量的「任意屬性」types — 當附於對應 stage 時所有顏色可付
  const ALL_TYPES: EnergyType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'];
  // v3.31 revert v3.30：嚴格依 JSON stage 判定。超級進化寶可夢 ex 的 stage 由 JSON 決定：
  //   - stage='Stage2'（超級噴火龍Xex / 超級妙蛙花ex 等）→ 真 2 階，新衝天 給 2 任意屬性
  //   - stage='Stage1'（超級寶石海星ex / 超級呆殼獸ex 等）→ 1 階，新衝天 只給 1 Colorless
  //   - stage='Basic'（超級阿勃梭魯ex 等）→ Basic，新衝天 只給 1 Colorless
  const isStage2 = pokeStage === 'Stage2';

  // 收集所有附加能量的「單位」
  const units: EnergyUnit[] = [];
  for (const e of pokemon.energyAttached) {
    const ec = pool.get(e.cardId);
    // 燃火能量特殊處理：進化寶可夢 → 3 個無屬性 units
    if (ec?.name === '燃火能量') {
      if (isEvolution) {
        units.push({ types: ['Colorless'] }, { types: ['Colorless'] }, { types: ['Colorless'] });
      } else {
        units.push({ types: ['Colorless'] });
      }
      continue;
    }
    // v2.113 稜鏡能量（v2.120 修：原版邏輯寫反）卡面：
    //   「若附於【基礎】寶可夢身上，則視為提供 1 個所有屬性的能量」→ Basic → 全屬性
    //   否則只視為 1 個【無】。
    if (ec?.name === '稜鏡能量') {
      units.push({ types: isEvolution ? ['Colorless'] : ALL_TYPES });
      continue;
    }
    // v2.113 新衝天能量（ACE SPEC）：【2 階進化】寶 → 2 個任意屬性 units；否則 1 個【無】
    if (ec?.name === '新衝天能量') {
      if (isStage2) {
        units.push({ types: ALL_TYPES }, { types: ALL_TYPES });
      } else {
        units.push({ types: ['Colorless'] });
      }
      continue;
    }
    // 大竺葵繁茂：基本【草】能量視為 2 個【草】units（僅在攻擊方有大竺葵時）
    if (hasBloom && isBasicEnergyOfType(ec, 'Grass')) {
      units.push({ types: ['Grass'] }, { types: ['Grass'] });
      continue;
    }
    units.push(...getEnergyUnits(e.cardId, pool));
  }

  // v3.9995：把主匹配包進 inner helper，讓璀璨結晶可外層 loop 嘗試 N 種扣法
  const tryAffordWithCost = (curCost: EnergyType[]): boolean => {
    const colorlessCost = curCost.filter((t) => t === 'Colorless').length;
    const typedCost = curCost.filter((t) => t !== 'Colorless');

    // 單位數量不夠直接失敗
    if (units.length < typedCost.length + colorlessCost) return false;

    // 回溯：依序把每個有色需求配給一個 types 包含該色的 unit；最後檢查剩餘 unit 數 ≥ colorless 需求
    const used = new Array(units.length).fill(false);
    const tryMatch = (i: number): boolean => {
      if (i >= typedCost.length) {
        // 最後檢查剩餘 unit 數量是否足以支付【無】費用。
        // PTCG 規則中【無】費用可由任意屬性的能量支付；
        // 有色需求已在前面的 typedCost 回溯中先行保留並匹配。
        let remaining = 0;
        for (let k = 0; k < units.length; k++) {
          if (!used[k]) remaining++;
        }
        return remaining >= colorlessCost;
      }
      const need = typedCost[i];
      for (let j = 0; j < units.length; j++) {
        if (used[j]) continue;
        if (!units[j].types.includes(need)) continue;
        used[j] = true;
        if (tryMatch(i + 1)) return true;
        used[j] = false;
      }
      return false;
    };
    return tryMatch(0);
  };

  // v3.9995 璀璨結晶：玩家可選擇扣任一 cost slot（任意屬性皆可）
  //   實作：嘗試所有 N 種扣法（skipIdx 0..N-1），任一成功即返 true
  //   例：cost=[Fire, Psychic]，玩家只有 1 Psychic：
  //     - skipIdx=0 → 扣 Fire，剩 [Psychic] vs 1 Psychic → 成功
  //     - skipIdx=1 → 扣 Psychic，剩 [Fire] vs 1 Psychic → 失敗
  //     至少有 1 種成功 → 返 true
  if (hasShinyCrystalReduction && cost.length > 0) {
    for (let skipIdx = 0; skipIdx < cost.length; skipIdx++) {
      const reduced = [...cost.slice(0, skipIdx), ...cost.slice(skipIdx + 1)];
      if (tryAffordWithCost(reduced)) return true;
    }
    return false;
  }
  return tryAffordWithCost(cost);
}

/** 判斷一張 ex 卡（name 含 'ex' 後綴）對應獎賞卡數 */
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
    akyoSecretPlayedThisTurn: false,
    rocketSupporterPlayedThisTurn: false,
    ancientSupporterPlayedThisTurn: false,
    retreatedThisTurn: false,
  };
}

/** 清除 CardInstance 上的回合旗標（於擁有者 END_TURN 執行） */
function clearTurnFlags(c: CardInstance): CardInstance {
  if (!c.justPlaced && !c.evolvedThisTurn && !c.movedToActiveThisTurn && !c.playedFromHand && !c.healedThisTurn) return c;
  const n = { ...c };
  delete n.justPlaced;
  delete n.evolvedThisTurn;
  delete n.movedToActiveThisTurn;
  delete n.playedFromHand;
  delete n.healedThisTurn;  // v4.43：擁有者 END_TURN 時清除「本回合回過血」旗標
  return n;
}

/**
 * v4.43：偵測 prev → next 之間，任何 iid 相同的寶可夢 damage 是否減少。
 * 若是 → 標記 healedThisTurn=true（不清除既有 flag，只增加）。
 *
 * 設計：覆蓋所有回血路徑（招式 / trainer / item / 特性 / stadium 不需個別 instrument）。
 *   邊際：寶可夢進化、KO 重置、換場等情況下 iid 改變 → 不視為 heal（正確）。
 *   邊際：先傷後回最終 damage < prev → 視為 heal（正確）。
 *   邊際：先回後傷最終 damage >= prev → flag 已設過不清，下次擁有者 END_TURN reset（正確）。
 */
export function markHealsByDamageDecrease(prev: GameState, next: GameState): GameState {
  // 建 prev 的 iid → damage 對照表（含雙方 active + bench）
  const prevDamage = new Map<string, number>();
  for (const idx of [0, 1] as const) {
    const pp = prev.players[idx];
    if (pp.active) prevDamage.set(pp.active.iid, pp.active.damage ?? 0);
    for (const b of pp.bench) prevDamage.set(b.iid, b.damage ?? 0);
  }
  // 沒任何 prev 資料 → 跳過（早期初始化階段）
  if (prevDamage.size === 0) return next;
  // v5.947 本 action 因「移動傷害指示物」(非治療)而減傷的來源 iid → 不算 heal
  const movedSet = new Set<string>(next._counterMoveSrcIids ?? []);

  let changed = false;
  const players = [...next.players] as [PlayerState, PlayerState];

  for (const idx of [0, 1] as const) {
    const np = { ...players[idx] };
    let pChanged = false;

    const checkOne = (c: CardInstance): CardInstance => {
      const prevDmg = prevDamage.get(c.iid);
      if (prevDmg === undefined) return c;  // 新進場（換場/進化新 iid）→ 不算 heal
      const newDmg = c.damage ?? 0;
      if (newDmg < prevDmg && !c.healedThisTurn && !movedSet.has(c.iid)) {
        pChanged = true;
        return { ...c, healedThisTurn: true };
      }
      return c;
    };

    if (np.active) {
      const newActive = checkOne(np.active);
      if (newActive !== np.active) { np.active = newActive; }
    }
    const newBench = np.bench.map(checkOne);
    if (newBench.some((b, i) => b !== np.bench[i])) {
      np.bench = newBench;
      pChanged = true;
    }
    if (pChanged) {
      players[idx] = np;
      changed = true;
    }
  }

  const _out = changed ? { ...next, players } : next;
  // v5.947 _counterMoveSrcIids 為 per-action 標記,消費後即清除(避免殘留誤跳過後續真回血)
  if (_out._counterMoveSrcIids !== undefined) { const _o = { ..._out }; delete _o._counterMoveSrcIids; return _o; }
  return _out;
}

/** 加一筆 log */
function addLog(
  state: GameState,
  message: string,
  playerIndex: 0 | 1 | null = null
): GameState {
  // v3.891：自動從 actor active 取 iid 當 sourceIid（log 卡名點擊精準追溯用）
  const sourceIid = playerIndex !== null ? state.players[playerIndex]?.active?.iid : undefined;
  return {
    ...state,
    log: [...state.log, {
      turn: state.turn,
      playerIndex,
      message,
      timestamp: Date.now(),  // v5.068：UI 計算 [mm:ss] 對戰相對時間
      ...(sourceIid && { sourceIid }),
    }]
  };
}

function hasFestivalDanceActive(state: GameState, idx: 0 | 1, pool: Map<string, Card>): boolean {
  const active = state.players[idx].active;
  const card = active ? pool.get(active.cardId) : null;
  return card?.abilities?.some(a => a.name === '祭典樂舞') ?? false;
}

/**
 * v5.226 偵測「本次攻擊是祭典樂舞會觸發第二次的第一次攻擊」。
 * 用於 attack pipeline 內保留一次性 flag（鐵羽毛 / 下回合加傷 等）給第二次攻擊。
 * 條件：攻擊者有祭典樂舞特性 + 場上祭典會場 + 還沒記為 used + 還沒用過 second attack。
 */
function _isFestivalDanceFirstAttack(
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const attacker = state.players[aIdx].active;
  if (!attacker) return false;
  const card = pool.get(attacker.cardId);
  if (!card?.abilities?.some(a => a.name === '祭典樂舞')) return false;
  const stadiumCard = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  if (stadiumCard?.name !== '祭典會場') return false;
  if (state.festivalDanceUsedThisTurn?.[aIdx]) return false;
  if (state.festivalDanceSecondAttackUsed?.[aIdx]) return false;
  return true;
}

function hasFestivalVenue(state: GameState, pool: Map<string, Card>): boolean {
  const stadium = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  return stadium?.name === '祭典會場';
}

function canResumeFestivalDanceSecondAttack(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const oppIdx = (1 - idx) as 0 | 1;
  return state.phase === 'playing'
    && state.turnPhase === 'end'
    && !state.pendingSelection
    && !hasAnyPendingPrize(state)
    && state.players[idx].active !== null
    && state.players[oppIdx].active !== null
    && hasFestivalDanceActive(state, idx, pool)
    && hasFestivalVenue(state, pool);
}

/**
 * v5.201 改寫：祭典樂舞「若場上有『祭典會場』，則這隻寶可夢可使用持有的招式 2 次。」
 *
 * 第 1 次招式剛打完：設 festivalDancePendingSecondAttack pending field 後
 * 立即 call tryPromoteToMainForFestival — atomic 自動執行第 2 次（玩家無機會介入）。
 * 若有 pendingSelection / pendingPrize / 對手 active=null，tryPromoteToMainForFestival
 * 留 flag 等下次 hook（ATTACK / RESOLVE_SELECTION / TAKE_PRIZES / SEND_NEW_ACTIVE）re-try。
 */
function startFestivalDanceSecondAttackWindow(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
  attackIndex: number,  // v5.201：傳入剛打的 attackIndex（用於 auto-second-attack）
): GameState {
  if (state.phase !== 'playing' || state.turnPhase !== 'end') return state;
  if (!hasFestivalDanceActive(state, idx, pool)) return state;
  if (!hasFestivalVenue(state, pool)) return state;

  // v2.381 BUG FIX：第 2 次招式已用過 → 不再開窗（flag2 = SecondAttackUsed）
  if (state.festivalDanceSecondAttackUsed?.[idx]) return state;

  // 第 2 次招式才剛打完（flag1 已 true）→ set flag2 標記「窗已關閉」
  // v5.211：同時清 pending flag（第 2 次成功完成，不再 pending）
  if (state.festivalDanceUsedThisTurn?.[idx]) {
    const used2: [boolean, boolean] = [...(state.festivalDanceSecondAttackUsed ?? [false, false])] as [boolean, boolean];
    used2[idx] = true;
    return { ...state, festivalDanceSecondAttackUsed: used2, festivalDancePendingSecondAttack: null };
  }

  // 第 1 次招式剛打完
  // v5.201 修法：依卡面語義，第 1 跟第 2 次屬同一回合的 atomic 操作 — 玩家中間不能介入。
  //   舊邏輯把 turnPhase 改回 main 讓玩家手動再點，違反卡面「使用持有的招式 2 次」連續性。
  //   新邏輯：設 festivalDancePendingSecondAttack pending field，立即 tryPromoteToMainForFestival；
  //   無 pending → 同步 atomic dispatch；有 pending → 留 flag 等 hook re-try。
  const flag: [boolean, boolean] = [...(state.festivalDanceUsedThisTurn ?? [false, false])] as [boolean, boolean];
  flag[idx] = true;
  const attacker = state.players[idx].active;
  if (!attacker) return { ...state, festivalDanceUsedThisTurn: flag };  // defensive
  let next: GameState = {
    ...state,
    festivalDanceUsedThisTurn: flag,
    festivalDancePendingSecondAttack: {
      idx,
      attackIndex,
      originalCardId: attacker.cardId,
    },
  };
  // v5.211：依玩家反映改為「手動選擇」— 玩家可再用同招式 1 次或跳過攻擊（END_TURN）。
  //   pending 期間其他動作（附能、用支援者、放寶可夢、撤退、進化等）全被 handlePlaying gate 擋掉。
  next = addLog(next, `祭典樂舞：場上有「祭典會場」— 可再用相同招式 1 次或結束回合（其他動作禁止）`, idx);
  return tryPromoteToMainForFestival(next, pool);
}

/**
 * v5.211：祭典樂舞「promote 到 main phase」核心 helper（前身 v5.201 tryPromoteToMainForFestival）。
 *
 * 改動：依玩家反映，第 2 次招式不再 atomic 自動執行 — 玩家可選「再用相同招式」或「跳過攻擊
 * （END_TURN）」。pending 期間其他動作（附能 / 進化 / 用支援者 / 場地 / 道具 / 放寶可夢 /
 * 撤退）由 handlePlaying L2157 gate 擋掉。
 *
 * 觸發點：所有可能解鎖 pending 的 hook 末端（ATTACK 結算 / RESOLVE_SELECTION /
 * TAKE_PRIZES / SEND_NEW_ACTIVE）。
 *
 * 邏輯：
 *   1. 無 pending field → no-op
 *   2. 仍有 pendingSelection / pendingPrize / 對手 active=null → 留 flag 等下次 hook
 *   3. 中斷例外（攻擊者反擊 KO / 身分變化 / 失去祭典特性 / 場地換掉 / 狀態異常）→ 清 flag + log
 *   4. 否則 turnPhase 設 main 讓玩家手動操作（不再 dispatch ATTACK）
 */
export function tryPromoteToMainForFestival(
  state: GameState,
  pool: Map<string, Card>,
): GameState {
  const pending = state.festivalDancePendingSecondAttack;
  if (!pending) return state;

  // (2) 仍有中介事件 → 留 flag
  if (state.phase !== 'playing') return state;
  if (state.pendingSelection) return state;
  if (hasAnyPendingPrize(state)) return state;
  const oppIdx = (1 - pending.idx) as 0 | 1;
  if (!state.players[oppIdx].active) return state;  // 對手還在挑新戰鬥位

  // (3) 中斷例外
  const player = state.players[pending.idx];
  if (!player.active) {
    return abortFestivalSecondAttack(state, '攻擊者反擊被擊倒');
  }
  if (player.active.cardId !== pending.originalCardId) {
    return abortFestivalSecondAttack(state, '攻擊者身分變化（進化解除 / 變身效果）');
  }
  if (!hasFestivalDanceActive(state, pending.idx, pool)) {
    return abortFestivalSecondAttack(state, '已無祭典樂舞特性');
  }
  // v5.447：祭典樂舞被對手特性消除（振翼髮｜暗夜羽擊「對手戰鬥寶可夢的特性全部消除」）
  //   → 不能使用第 2 次。第一拳擊倒對手後對手推出振翼髮，攻擊方祭典樂舞即被壓制。
  //   hasFestivalDanceActive 只看特性是否「存在」，這裡補查是否被 passive 消除。
  {
    const fdCard = pool.get(player.active.cardId);
    if (isAbilityNullifiedByPassive(state, pending.idx, player.active, fdCard, '祭典樂舞', 'active', pool)) {
      return abortFestivalSecondAttack(state, '祭典樂舞特性被對手消除（暗夜羽擊）');
    }
  }
  if (!hasFestivalVenue(state, pool)) {
    return abortFestivalSecondAttack(state, '祭典會場已不在場');
  }
  if (player.active.cantAttackThisTurn) {
    return abortFestivalSecondAttack(state, '本回合無法再次攻擊');
  }
  if (player.active.status === 'asleep' || player.active.status === 'paralyzed') {
    const sName = player.active.status === 'asleep' ? '睡眠' : '麻痺';
    return abortFestivalSecondAttack(state, `狀態異常（${sName}）`);
  }

  // (4) 可進行第 2 次：turnPhase 切 main 讓玩家手動點同招式或 END_TURN
  //   pending flag 保留 — 由 ATTACK 第 2 次成功（startFestival used2 分支清）或 END_TURN（清旗標）負責清除
  let s: GameState = { ...state, turnPhase: 'main' as const };
  s = addLog(s, `祭典樂舞：請使用相同招式或點結束回合跳過第 2 次（其他動作禁止）`, pending.idx);
  return s;
}

function abortFestivalSecondAttack(state: GameState, reason: string): GameState {
  const pending = state.festivalDancePendingSecondAttack;
  if (!pending) return state;
  const cleared: GameState = { ...state, festivalDancePendingSecondAttack: null };
  return addLog(cleared, `祭典樂舞：第 2 次招式中斷（${reason}）`, pending.idx);
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
/** v3.75：擲幣先後攻 — 贏家依其 lobby 偏好決定先攻或後攻；本機/AI 模式可用
 *  options.firstPlayerOverride 直接指定（跳過擲幣動畫）。
 */
export function createGame(
  spec1: DeckSpec,
  spec2: DeckSpec,
  pool: Map<string, Card>,
  options?: {
    /** 直接指定先手方（AI / 本機雙人模式：玩家偏好已可直接換算為先手 idx） */
    firstPlayerOverride?: 0 | 1;
    /** 線上模式雙方偏好；coinWinner 套用自己那邊的偏好決定先攻方 */
    firstChoicePreferences?: [
      'random' | 'first' | 'second' | 'opponent',
      'random' | 'first' | 'second' | 'opponent',
    ];
    /**
     * v6.051：強制走 v6.050 以前的同步開局（即使牌組含閃焰王牌）。
     * 本批只讓「本機／AI」走互動式；線上、再來一局、錦標賽的呼叫端都傳 true，
     * 等本機驗證穩定後再逐條打開（也是出事時的第一層逃生口）。
     */
    forceLegacyOpening?: boolean;
  }
): GameState {
  const p1 = emptyPlayer(spec1.name);
  const p2 = emptyPlayer(spec2.name);

  // v5.336：根因修 — M5 台版上線 (v5.300) 後卡 id 由日版 50xxx 改成台版 19xxx。牌組載入端
  //   (storage.ts/cloud.ts loadDecks) 已自動 migrateDeck，但仍有路徑讓舊 id 漏進對戰
  //   (早期存的本機牌組未 re-save / 匯入 / 其他來源)，使 createGame 以舊 id 建盤；該寶可夢
  //   在卡池解不出 → UI 顯示「？/HP 0/0」，且一旦行動 (攻擊/補場 getCard().name) 立即 throw
  //   「Card not found」→ 整局卡死。此處在本機/AI/Oracle 線上「所有對戰」共同咽喉點 createGame
  //   對雙方 entries 再做一次 migrateCardId，徹底杜絕舊 id 進入 game state。非 M5 id 原樣回傳，
  //   零副作用 (migrateCardId table 只含 M5 81 條 jp→tw)。
  const _e1 = spec1.entries.map(e => ({ ...e, cardId: migrateCardId(e.cardId) }));
  const _e2 = spec2.entries.map(e => ({ ...e, cardId: migrateCardId(e.cardId) }));

  // 洗牌 + 建牌組
  p1.deck = shuffle(deckToInstances(_e1));
  p2.deck = shuffle(deckToInstances(_e2));

  // v6.051：只有「雙方牌組任一含瞬間爆發力」且未被強制 legacy 時，才走互動式開局。
  //   其餘對局（全站絕大多數）完全走下面這段原本的同步發牌，行為 0 diff。
  const _interactiveOpening = INTERACTIVE_OPENING_ENABLED
    && !options?.forceLegacyOpening
    && (deckHasInstantBurst(_e1, pool) || deckHasInstantBurst(_e2, pool));

  // 各抽 7 張（記錄 mulligan 次數 + v3.74 揭示手牌）
  const opening1 = _interactiveOpening ? { mulligans: 0, revealedHands: [] as string[][] } : dealOpeningHand(p1, pool);
  const opening2 = _interactiveOpening ? { mulligans: 0, revealedHands: [] as string[][] } : dealOpeningHand(p2, pool);
  // 互動式：先各發一手，再推進到「定案」或「停在玩家選擇」
  const _openKind: ['done' | 'choice', 'done' | 'choice'] = ['done', 'done'];
  if (_interactiveOpening) {
    for (const [pl, acc, slot] of [[p1, opening1, 0], [p2, opening2, 1]] as const) {
      for (let i = 0; i < 7; i++) { const top = pl.deck.shift(); if (top) pl.hand.push(top); }
      const r = advanceOpeningHand(pl, pool, { mulligans: acc.mulligans, revealedHands: acc.revealedHands }, true);
      acc.mulligans = r.mulligans;
      acc.revealedHands = r.revealedHands;
      _openKind[slot] = r.kind;
    }
  }
  const m1 = opening1.mulligans;
  const m2 = opening2.mulligans;
  // v3.74：mulligan 揭示 — 每方記下每次失敗的 7 張 cardIds 給對方確認
  // v3.741：encode 成 { p1, p2 } object + 每手 '|' join — Firestore 禁止 nested array（同 v2.84）。
  const mulliganRevealedHands = {
    p1: opening1.revealedHands.map(h => h.join('|')),
    p2: opening2.revealedHands.map(h => h.join('|')),
  };
  // 對方沒 mulligan 則自動視為 confirmed（無需確認）
  const mulliganRevealConfirmed: [boolean, boolean] = [m2 === 0, m1 === 0];

  // Mulligan 補抽採「NET 抵銷」：只有次數多的一方的對手可以補抽差額。
  // 例：雙方各 1 次 → 互相抵銷，兩邊都 0；對方 2 次我方 1 次 → 我方補 1、對方 0。
  // pendingMulliganDraw[0] = P1 可補抽張數（= max(0, m2 - m1)）
  // pendingMulliganDraw[1] = P2 可補抽張數（= max(0, m1 - m2)）
  const extraForP1 = Math.max(0, m2 - m1);
  const extraForP2 = Math.max(0, m1 - m2);

  // v3.75：先手決定 — override 直給 / 偏好套用 / 純擲幣 三條路徑
  let firstPlayerIdx: 0 | 1;
  let coinWinnerIdx: 0 | 1 | null = null;
  let appliedPref: 'first' | 'second' | null = null;
  if (options?.firstPlayerOverride !== undefined) {
    // 本機 / AI：玩家偏好已換算
    firstPlayerIdx = options.firstPlayerOverride;
  } else {
    // 線上 / 預設：擲幣
    coinWinnerIdx = Math.random() < 0.5 ? 0 : 1;
    const winnerPref = options?.firstChoicePreferences?.[coinWinnerIdx] ?? 'random';
    if (winnerPref === 'second') {
      firstPlayerIdx = (1 - coinWinnerIdx) as 0 | 1;
      appliedPref = 'second';
    } else if (winnerPref === 'first') {
      firstPlayerIdx = coinWinnerIdx;
      appliedPref = 'first';
    } else if (winnerPref === 'opponent') {
      // v5.476 對手決定：贏擲幣方把先後攻決定權讓給對手(敗方)，用敗方的偏好換算。
      //   敗方也選「對手決定」或「隨機」→ 隨機（勝方先攻；coinWinnerIdx 本就隨機，等同隨機結果）。
      const loserIdx = (1 - coinWinnerIdx) as 0 | 1;
      const loserPref = options?.firstChoicePreferences?.[loserIdx] ?? 'random';
      if (loserPref === 'first') firstPlayerIdx = loserIdx;
      else if (loserPref === 'second') firstPlayerIdx = coinWinnerIdx;
      else firstPlayerIdx = coinWinnerIdx;
      appliedPref = firstPlayerIdx === coinWinnerIdx ? 'first' : 'second';
    } else {
      firstPlayerIdx = coinWinnerIdx;
    }
  }

  const state: GameState = {
    id: uid(),
    createdAt: Date.now(),
    phase: 'setup',
    turnPhase: 'main',
    activePlayerIndex: firstPlayerIdx,
    firstPlayerIdx,
    players: [p1, p2],
    turn: 1,
    isFirstTurn: true,
    setupDone: [false, false],
    mulliganCounts: [m1, m2],
    // v6.051：互動式開局在雙方定案前不先給補抽（finalizeOpening 才算 NET）
    pendingMulliganDraw: _interactiveOpening ? [0, 0] : [extraForP1, extraForP2],
    ...(_interactiveOpening ? {
      openingFlow: 'interactive' as const,
      openingChoicePending: [_openKind[0] === 'choice', _openKind[1] === 'choice'] as [boolean, boolean],
      openingDone: [_openKind[0] === 'done', _openKind[1] === 'done'] as [boolean, boolean],
    } : {}),
    mulliganRevealedHands,
    mulliganRevealConfirmed,
    log: [],
    pendingPrizes: [0, 0],
    oppPrizesAtMyLastTurnEnd: [6, 6],
    oppPrizesAtMyTurnStart: [6, 6],
    oppPrizesAtMainEnd: [6, 6], // v2.245 主回合結束 snapshot（不含 checkup）
    rocketInMyDiscardAtMainEnd: [0, 0], // v2.245 主回合結束 snapshot（火箭隊寶可夢數）
    // v2.246 完整 KO cause tracking
    oppAttackKOdMeThisTurn: [0, 0],
    oppAbilityKOdMeThisTurn: [0, 0],
    oppAttackKOdMyRocketThisTurn: [0, 0],
    oppAbilityKOdMyRocketThisTurn: [0, 0],
    // v5.274 赫普家族
    oppAttackKOdMyHopThisTurn: [0, 0],
    oppAbilityKOdMyHopThisTurn: [0, 0],
    oppDamageKOdMeThisTurn: [0, 0],
    oppDamageKOdMyHopThisTurn: [0, 0],
    oppDamageKOdMyAxiangThisTurn: [0, 0],
    oppAttackKOdMeInLastOppTurn: [0, 0],
    ancientAttackedIidsThisTurn: [[], []],
    ancientAttackedIidsLastSelfTurn: [[], []],
    oppAbilityKOdMeInLastOppTurn: [0, 0],
    oppAttackKOdMyRocketInLastOppTurn: [0, 0],
    oppAbilityKOdMyRocketInLastOppTurn: [0, 0],
    // v5.274 赫普家族 snapshot
    oppAttackKOdMyHopInLastOppTurn: [0, 0],
    oppAbilityKOdMyHopInLastOppTurn: [0, 0],
    oppDamageKOdMeInLastOppTurn: [0, 0],
    oppDamageKOdMyHopInLastOppTurn: [0, 0],
    oppDamageKOdMyAxiangInLastOppTurn: [0, 0],
    stadiumPlayedThisTurn: [false, false],
    // v3.85: 本回合打過「稜鏡塔」flag（給昂主花葉蒂 gate 用）
    prismTowerPlayedThisTurn: [false, false],
    // v5.138: mulligan 補抽後加備戰 flag — 初始 [false, false]
    mulliganPostBenchOpen: [false, false],
  };

  let st = addLog(state, `遊戲開始！${spec1.name} vs ${spec2.name}`, null);
  // v3.824：簡化 log — 直接呈現「贏家 + 結果」，不再揭示「偏好」中間步驟。
  //   - 直接指定（AI / 本機）：「🎯 XX 先手」（沒擲幣，本來就簡短）
  //   - 擲幣：無論贏家偏好是 random 還是 first/second，最終 firstPlayerIdx 都已決定，
  //     直接用「贏家 = firstPlayerIdx ? 選擇先攻 : 選擇後攻」呈現即可。
  //     random 場景由系統隨機決定 firstPlayerIdx，呈現上等同贏家「選擇」對應結果。
  if (coinWinnerIdx === null) {
    st = addLog(st, `🎯 ${state.players[firstPlayerIdx].name} 先手`, null);
  } else {
    const choseFirst = coinWinnerIdx === firstPlayerIdx;
    st = addLog(st, `🪙 擲硬幣：${state.players[coinWinnerIdx].name} 獲勝，選擇${choseFirst ? '先攻' : '後攻'}`, null);
  }
  // Mulligan log：依 NET 抵銷結果寫
  if (m1 > 0 && m2 > 0 && m1 === m2) {
    st = addLog(st, `雙方皆起手無基礎寶可夢（各重抽 ${m1} 次），重抽懲罰互相抵銷，雙方皆不可多抽牌`, null);
  } else if (m1 > 0 && m2 > 0) {
    // 兩邊都有但次數不同 → 差額歸次數少的那一方的對手（= 次數多的一方的對手）
    const winnerIdx = m1 > m2 ? 1 : 0;
    const net = Math.abs(m1 - m2);
    const winnerName = state.players[winnerIdx].name;
    st = addLog(st, `雙方皆起手無基礎寶可夢（${spec1.name} ${m1} 次 / ${spec2.name} ${m2} 次），抵銷後 ${winnerName} 可選擇多抽 ${net} 張`, null);
  } else if (m1 > 0) {
    st = addLog(st, `${spec1.name} 起手無基礎寶可夢，重抽懲罰 ${m1} 次 → ${spec2.name} 可選擇多抽 ${m1} 張`, 0);
  } else if (m2 > 0) {
    st = addLog(st, `${spec2.name} 起手無基礎寶可夢，重抽懲罰 ${m2} 次 → ${spec1.name} 可選擇多抽 ${m2} 張`, 1);
  }
  return st;
}

/**
 * 抽 7 張起始手牌。若無基礎寶可夢則重新洗牌並再抽（mulligan）。
 * 回傳 mulligan 次數（第一次未成功抽到基礎的重抽次數）。
 */
// v3.74 改回傳 {mulligans, revealedHands}：每次 mulligan 失敗前的 7 張 cardIds 給對手確認
function dealOpeningHand(
  player: PlayerState,
  pool: Map<string, Card>,
): { mulligans: number; revealedHands: string[][] } {
  // v5.378：牌組（含手牌）是否「存在」任何可起手上場的卡（基礎寶可夢 / 閃焰王牌瞬間爆發力）。
  //   原本上限 10 次：抽不到就放行 → 進 setup 卻沒有可放戰鬥場的寶可夢 → 直接卡死
  //   （化石牌組運氣差時重現）。改為：牌組確實有可上場卡 → 一直重抽到抽到為止（PTCG 正規
  //   mulligan 本就無上限）；牌組完全沒有可上場卡（理論上非法牌組）→ 抽一次就放行避免無限迴圈。
  const deckHasPlaceable = [...player.deck, ...player.hand]
    .some((c) => canBeInitialActive(c.cardId, pool));
  let attempts = 0;
  let mulligans = 0;
  const revealedHands: string[][] = [];
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
    // v2.42：閃焰王牌「瞬間爆發力」可作為起始戰鬥寶可夢 → 視同基礎，避免被誤判 mulligan
    if (player.hand.some((c) => canBeInitialActive(c.cardId, pool))) break;
    // v3.74：mulligan 失敗 — 把這 7 張 cardIds 記下來給對方看
    revealedHands.push(player.hand.map(c => c.cardId));
    mulligans++;
    // 牌組根本沒有可上場的卡（非法牌組）→ 再抽也不可能抽到，停止避免無限迴圈
    if (!deckHasPlaceable) break;
  } while (attempts < 200);  // v5.378：安全上限（合法牌組幾乎必在數次內抽到，200 純保險）
  return { mulligans, revealedHands };
}

// ── Setup 階段處理 ───────────────────────────────────────────────────────────

// v3.74：setup → playing 推進條件 helper
//   雙方都 setupDone + 雙方都 pendingMulliganDraw=0 + 雙方都 mulliganRevealConfirmed=true
//   滿足才能進 playing phase。在多個 handler 結尾呼叫（FINISH_SETUP / MULLIGAN_DRAW_DECISION /
//   CONFIRM_MULLIGAN_REVEAL）以避免重複條件 check 邏輯。
// v4.494：export 給 +page.svelte 在線上 setup merge 後重新評估（修兩端同時 finish 卡死 bug）
export function tryAdvanceToPlaying(state: GameState): GameState {
  if (state.phase !== 'setup') return state;
  // v5.636：原本 setup 未完成時 console.warn(debug Bug 14)。但伺服器端引擎是「所有對局共用同一份模組」，
  //   去重旗標是模組層級全域 → 多局交錯時 reason 一直變、去重失效 → 大型錦標賽高流量下每個 setup 動作
  //   都狂寫 pm2 log，灌爆 error.log/吃 CPU/塞事件迴圈 → API 卡頓+crash-loop。改成 no-op(gate 行為不變,只是不印)。
  const auditFail = (_reason: string) => state;
  // v6.053 批3：互動式開局未定案 → 絕不推進（保險 gate）。
  //   正常流程走不到這裡（FINISH_SETUP 被擋 → setupDone 到不了雙 true），但版本 skew
  //   或未來新增路徑可能把 setupDone 湊齊，此時 pendingMulliganDraw / 揭示確認尚未結算，
  //   放行等於「該補抽的靜默消失、直接開打」＝公平性 bug（比卡死更難被發現）。
  //   ⚠判準必須與 isOpeningInProgress 同一個（effectiveOpeningDone），否則與逃生規則打架。
  if (isOpeningInProgress(state)) return auditFail('互動式開局尚未定案');
  if (!state.setupDone[0] || !state.setupDone[1]) return auditFail(`setup 未完成: P1=${state.setupDone[0]}, P2=${state.setupDone[1]}`);
  if (state.pendingMulliganDraw[0] !== 0 || state.pendingMulliganDraw[1] !== 0) return auditFail(`pendingMulliganDraw 未處理: [${state.pendingMulliganDraw[0]}, ${state.pendingMulliganDraw[1]}]`);
  if (!state.mulliganRevealConfirmed[0] || !state.mulliganRevealConfirmed[1]) return auditFail(`mulliganRevealConfirmed 未完成: [${state.mulliganRevealConfirmed[0]}, ${state.mulliganRevealConfirmed[1]}]`);
  // v5.138：任一方還在 post-bench 階段（補抽後加備戰中）→ 不進 playing
  if (state.mulliganPostBenchOpen?.[0] || state.mulliganPostBenchOpen?.[1]) return auditFail(`mulliganPostBenchOpen 未完成: [${state.mulliganPostBenchOpen?.[0]}, ${state.mulliganPostBenchOpen?.[1]}]`);
  // v4.24 對戰計時器 — setup→playing 時起算
  const timerStart = Date.now();
  let next: GameState = {
    ...state,
    phase: 'playing',
    turnPhase: 'draw',
    activePlayerIndex: state.firstPlayerIdx,
    isFirstTurn: true,
    gameStartTime: timerStart,
    currentTurnStartTime: timerStart,
    playerTurnTimeMs: [0, 0],
  };
  next = addLog(next, `Setup 完成！${next.players[next.firstPlayerIdx].name} 先手行動中。`, null);
  next = applyAutoDraw(next);
  return next;
}

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
    action.type !== 'MULLIGAN_DRAW_DECISION' &&
    action.type !== 'CONFIRM_MULLIGAN_REVEAL' &&
    action.type !== 'FINISH_MULLIGAN_POST_BENCH' &&  // v5.138
    action.type !== 'OPENING_KEEP' &&                 // v6.051 互動式開局
    action.type !== 'OPENING_MULLIGAN'
  ) {
    return state;
  }
  const pIdx = action.senderIdx;

  // Mulligan 補抽決定 — 可在 setup 任何時候進行（即使已 FINISH_SETUP 也允許，
  // 雙方都要決定才能真正進入 playing；此處允許 setupDone 的玩家繼續處理 mulligan 決定）
  if (action.type === 'MULLIGAN_DRAW_DECISION') {
    const cur = state.pendingMulliganDraw?.[pIdx] ?? 0;
    if (cur <= 0) return state; // 沒有待決定
    // v4.923：玩家可選擇補抽張數（0 ~ cur），不再是 boolean 全抽/不抽。
    //   防呆：Math.floor + Math.max/min clamp，舊客戶端送 undefined → 0（保守不抽）。
    const requested = Math.max(0, Math.min(cur, Math.floor(Number(action.count) || 0)));
    const players = [...state.players] as [PlayerState, PlayerState];
    const player = { ...players[pIdx] };
    if (requested > 0) {
      // 從牌庫頂補抽 requested 張
      const draws = player.deck.slice(0, requested);
      player.deck = player.deck.slice(requested);
      player.hand = [...player.hand, ...draws];
    }
    players[pIdx] = player;
    const newPending = [...state.pendingMulliganDraw] as [number, number];
    newPending[pIdx] = 0;
    // v4.923：細分三種 log 訊息（全抽 / 部分抽 / 不抽）
    let msg: string;
    if (requested === 0) {
      msg = `${player.name} 放棄 ${cur} 張重抽懲罰補抽`;
    } else if (requested === cur) {
      msg = `${player.name} 選擇補抽 ${cur} 張（對手重抽懲罰補償）`;
    } else {
      msg = `${player.name} 選擇補抽 ${requested} 張（可選 ${cur} 張，剩餘 ${cur - requested} 張放棄）`;
    }
    let next: GameState = {
      ...state, players, pendingMulliganDraw: newPending,
    };
    next = addLog(next, msg, pIdx);

    // v5.138：補抽 N>0 → 重新開放 BENCH placement 一次（玩家可加新基礎到備戰），
    //   按 FINISH_MULLIGAN_POST_BENCH 後才進 playing。
    //   補抽 0 張（requested=0）跳過此流程（直接 tryAdvanceToPlaying）。
    if (requested > 0) {
      const newPostBench = [
        ...(next.mulliganPostBenchOpen ?? [false, false]),
      ] as [boolean, boolean];
      newPostBench[pIdx] = true;
      next = { ...next, mulliganPostBenchOpen: newPostBench };
      next = addLog(next, `${player.name} 可選擇將補抽到的基礎寶可夢加入備戰`, pIdx);
    }

    // v3.74：抽 helper — 雙方都完成 setup + mulligan 補抽決定 + 揭示確認 → 進入 playing
    next = tryAdvanceToPlaying(next);
    return next;
  }

  // v5.138：mulligan 補抽後加備戰完成
  if (action.type === 'FINISH_MULLIGAN_POST_BENCH') {
    if (!state.mulliganPostBenchOpen?.[pIdx]) return state;
    const newPostBench = [
      ...(state.mulliganPostBenchOpen ?? [false, false]),
    ] as [boolean, boolean];
    newPostBench[pIdx] = false;
    let next: GameState = { ...state, mulliganPostBenchOpen: newPostBench };
    next = addLog(next, `${state.players[pIdx].name} 完成補抽後備戰設置`, pIdx);
    next = tryAdvanceToPlaying(next);
    return next;
  }

  // v3.74：玩家確認對方的 mulligan 揭示（看完 modal 按確認）
  if (action.type === 'CONFIRM_MULLIGAN_REVEAL') {
    const senderIdx = action.senderIdx;
    if (state.mulliganRevealConfirmed[senderIdx]) return state; // 已確認過，no-op
    const newConfirmed = [...state.mulliganRevealConfirmed] as [boolean, boolean];
    newConfirmed[senderIdx] = true;
    let next: GameState = { ...state, mulliganRevealConfirmed: newConfirmed };
    next = addLog(next, `${state.players[senderIdx].name} 已確認對方的 mulligan 揭示`, senderIdx);
    next = tryAdvanceToPlaying(next);
    return next;
  }

  // ── v6.051 互動式開局：兩個選擇 ────────────────────────────────────────
  if (action.type === 'OPENING_KEEP' || action.type === 'OPENING_MULLIGAN') {
    if (state.phase !== 'setup') return state;
    if (state.openingFlow !== 'interactive') return state;
    if (!state.openingChoicePending?.[pIdx]) return state;   // 沒輪到這一側做選擇
    const _players = [...state.players] as [PlayerState, PlayerState];
    const _p = { ..._players[pIdx], hand: [..._players[pIdx].hand], deck: [..._players[pIdx].deck] };
    const _counts = [...state.mulliganCounts] as [number, number];
    const _revealed = {
      p1: [...(state.mulliganRevealedHands?.p1 ?? [])],
      p2: [...(state.mulliganRevealedHands?.p2 ?? [])],
    };
    const _pending = [...(state.openingChoicePending ?? [false, false])] as [boolean, boolean];
    const _done = [...(state.openingDone ?? [false, false])] as [boolean, boolean];
    let _s = state;

    if (action.type === 'OPENING_KEEP') {
      // 用閃焰王牌開局 —— 這就是 v6.050 以前的唯一行為
      _pending[pIdx] = false; _done[pIdx] = true;
      _s = addLog(_s, `${_p.name} 選擇以「瞬間爆發力」的寶可夢開局`, pIdx);
    } else {
      // 視同沒有【基礎】寶可夢 → 官方規則：先向對手展示手牌，再洗回重抽
      const acc = { mulligans: _counts[pIdx], revealedHands: [] as string[][] };
      acc.revealedHands.push(_p.hand.map(c => c.cardId));
      acc.mulligans += 1;
      const r = advanceOpeningHand(_p, pool, acc, false);
      _counts[pIdx] = r.mulligans;
      const key = pIdx === 0 ? 'p1' : 'p2';
      for (const h of r.revealedHands) _revealed[key].push(h.join('|'));
      _pending[pIdx] = r.kind === 'choice';
      _done[pIdx] = r.kind === 'done';
      _s = addLog(_s,
        `${_p.name} 選擇視同沒有【基礎】寶可夢並重抽手牌（累計重抽 ${_counts[pIdx]} 次）`, pIdx);
    }

    _players[pIdx] = _p;
    let next: GameState = {
      ..._s, players: _players, mulliganCounts: _counts,
      mulliganRevealedHands: _revealed,
      openingChoicePending: _pending, openingDone: _done,
    };
    // 雙方都定案 → 一次寫回現行 mulligan 欄位，之後完全走原本的流程
    if (_done[0] && _done[1]) {
      next = finalizeOpening(next);
      const [f1, f2] = next.mulliganCounts;
      if (f1 > 0 || f2 > 0) {
        next = addLog(next,
          `開局重抽結果：${next.players[0].name} ${f1} 次 / ${next.players[1].name} ${f2} 次`
          + `（可多抽：${next.pendingMulliganDraw[0]} / ${next.pendingMulliganDraw[1]} 張）`, null);
      }
    }
    return next;
  }
  // 互動式開局尚未雙方定案 → 擋住所有 setup 擺場動作（避免搶跑造成盤面不一致）
  if (isOpeningInProgress(state)
      && (action.type === 'PLACE_ACTIVE' || action.type === 'BENCH_POKEMON'
          || action.type === 'FINISH_SETUP')) {
    return state;
  }

  // 已完成 setup 的玩家不能再操作（place/bench/finish）
  // v5.138 例外：mulliganPostBenchOpen=true 時允許 BENCH_POKEMON（其他仍擋）
  if (state.setupDone[pIdx]) {
    if (!(state.mulliganPostBenchOpen?.[pIdx] && action.type === 'BENCH_POKEMON')) {
      return state;
    }
  }
  const player = { ...state.players[pIdx] };
  const players = [...state.players] as [PlayerState, PlayerState];

  if (action.type === 'PLACE_ACTIVE') {
    // v5.134 / v5.135 / v5.148：依 PTCG 規則，mulligan 次數較多的一方需等
    //   對方先放好戰鬥場（按準備完成）。實體賽事規則：mulligan 較少方先擺
    //   戰鬥場 + 備戰 + 確認，較多方依對方手牌資訊判斷是否補抽，故必須等。
    //   v5.148：原 v5.134 gate 只擋 oppMul===0（單方 mulligan 場景），但雙方都
    //   mulligan 時也應比次數 — 較多方等較少方。改 myMul > oppMul 觸發擋。
    {
      const myMul = state.mulliganCounts?.[pIdx] ?? 0;
      const oppIdx = (1 - pIdx) as 0 | 1;
      const oppMul = state.mulliganCounts?.[oppIdx] ?? 0;
      if (myMul > oppMul && !state.setupDone[oppIdx]) {
        return addLog(state,
          `${state.players[pIdx].name} 重抽次數較多（${myMul} > ${oppMul}），需等對手按下準備完成才能設置`, pIdx);
      }
    }
    const iidx = player.hand.findIndex((c) => c.iid === action.iid);
    if (iidx < 0) return state;
    const card = player.hand[iidx];
    // v2.42：起手戰鬥場放置 — 基礎寶可夢，或 含「瞬間爆發力」特性（閃焰王牌）。
    if (!canBeInitialActive(card.cardId, pool)) return state;
    if (player.active) {
      // 把舊的放回手牌（清除 justPlaced 以免帶回手牌後殘留）
      const returning = { ...player.active };
      delete returning.justPlaced;
      delete returning.playedFromHand;
      player.hand = [...player.hand, returning];
    }
    player.hand = player.hand.filter((_, i) => i !== iidx);
    // Setup 放的寶可夢設 justPlaced — 直到該玩家第一次 END_TURN 才能進化
    // 同時重置 damage，防止棄牌區撈回的寶可夢帶舊傷害值上場
    player.active = { ...card, justPlaced: true, damage: 0 };
    players[pIdx] = player;
    return addLog({ ...state, players }, `${player.name} 選擇了出場寶可夢`, null);
  }

  if (action.type === 'BENCH_POKEMON') {
    if (!player.active) return state; // 必須先選出場
    // v2.136 零之大空洞：場上有太晶寶可夢時上限可達 8
    if (player.bench.length >= getBenchLimit(state, pIdx, pool)) return state;
    const iidx = player.hand.findIndex((c) => c.iid === action.iid);
    if (iidx < 0) return state;
    const card = player.hand[iidx];
    if (!isBasicPokemon(card.cardId, pool)) return state;
    player.hand = player.hand.filter((_, i) => i !== iidx);
    // 從手牌上場時一律重置 damage（防止從棄牌區撈回的寶可夢帶著舊傷害值上場，
    // 導致 sanityKOSweep 立即再度 KO — e.g. 夜間擔架撈回已被擊倒的寶可夢）
    player.bench = [...player.bench, { ...card, justPlaced: true, damage: 0 }];
    players[pIdx] = player;
    return { ...state, players };
  }

  if (action.type === 'FINISH_SETUP') {
    if (!player.active) return state; // 必須選出場才能完成
    // 設置獎賞卡（各 6 張）
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

    // v3.74：改用 tryAdvanceToPlaying helper，會自動 check mulliganRevealConfirmed
    newState = tryAdvanceToPlaying(newState);
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
        message: `${player.name} 無法抽牌，${state.players[dIdx].name} 獲勝！`, timestamp: Date.now() }],
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

// v2.132：sanity sweep — 招式 / resolver 結算後，掃雙方 active+bench，找出 damage ≥ HP
//   卻仍留在場上的「zombie」寶可夢，強制移到棄牌、累計獎賞、清空位置。
//   觸發點：Leon 回報幻影奇襲後對手 70HP 土龍弟弟仍在場、damage 200。理論上引擎主流程
//   會 KO，但 postFn / 多目標 resolver / 反擊特性等可能漏掉某條 path。做防呆掃描。
//
//   為避免重複觸發 ON_KO 道具與獎賞動畫，sweep 使用簡化路徑：
//   - 寶可夢 + 附加能量/道具/進化堆 全部丟棄牌區
//   - 累計 prize 到 pendingPrizes（按 prizesForKO 算）
//   - 不觸發 TOOL_PREVENT_KO / TOOL_ON_KO（這些本應在主 KO 路徑處理）
//   - 寫一條 sanity log，方便日後 debug 知道是 fallback 觸發了
// v5.735：非場上區(棄牌/牌庫/手牌/獎賞)的卡不該帶 evolvedFromStack(那是「場上進化堆」專用)。
//   進化體被KO棄牌時,KO 路徑把頂層卡(仍帶 evolvedFromStack)加進棄牌、又把基底層 spread 成扁平棄牌卡
//   → 同一基底「巢狀(在頂層卡內)+扁平」兩份共用同一 iid。之後用夜間擔架/好友寶芬等取回扁平那份放上場,
//   就與棄牌堆裡巢狀那份 iid 碰撞 → 前端 each_key_duplicate 整頁卡死(兮雪 vs 喔拉 比賽回報,dump 證實
//   active 與 discard/stack 同 iid)。收斂:把非場上區每張卡的 evolvedFromStack 攤平回該區、清掉頂層的
//   stack 欄位,並依 iid 去重(扁平與巢狀同 iid 只留一份)。在 sanityKOSweep(各 KO 路徑收斂點)末尾呼叫。
function normalizeNonFieldStacks(state: GameState): GameState {
  let changed = false;
  const fixZone = (zone: CardInstance[]): CardInstance[] => {
    const out: CardInstance[] = [];
    const seen = new Set<string>();
    for (const c of zone) {
      const stack = c.evolvedFromStack;
      const top = stack && stack.length > 0 ? { ...c, evolvedFromStack: undefined } : c;
      if (stack && stack.length > 0) changed = true;
      if (!seen.has(top.iid)) { seen.add(top.iid); out.push(top); } else { changed = true; }
      if (stack) for (const e of stack) {
        const be = e.evolvedFromStack ? { ...e, evolvedFromStack: undefined } : e;
        if (!seen.has(be.iid)) { seen.add(be.iid); out.push(be); } else { changed = true; }
      }
    }
    return out;
  };
  const players = state.players.map(pl => ({
    ...pl,
    discard: fixZone(pl.discard),
    deck: fixZone(pl.deck),
    hand: fixZone(pl.hand),
    prizes: fixZone(pl.prizes),
  })) as [PlayerState, PlayerState];
  return changed ? { ...state, players } : state;
}

// ════════════════════════════════════════════════════════════════════════════
// v5.918 獵斑魚｜潛者捕捉 — 中央 on-KO 能量搶救管線
//   卡面:「每次當自己的【水】寶可夢受到對手的寶可夢招式的傷害而【昏厥】時,可使用1次。
//         【昏厥】的寶可夢身上附加的『基本【水】能量』卡不丟棄,而是全部放回手牌。」
//   涵蓋:戰鬥場(主攻擊KO路徑 inline)+備戰(sanityKOSweep 狙擊/範圍傷害 zombie KO);
//   多隻同時KO→一組一組確認(pendingChainQueue);獵斑魚自身昏厥也觸發(KO當下仍在場偵測得到)。
//   排除:中毒/灼傷checkup、混亂自傷、自主丟棄化石 等「非對手招式傷害」路徑(不呼叫本helper)。

/** 某側一張被招式傷害KO的寶可夢:若該側有「潛者捕捉」且此卡為【水】→回傳身上要保留(不進棄牌)的基本水能量。 */
function diverCatchHeldEnergy(
  state: GameState, ownerIdx: 0 | 1, koInst: CardInstance,
  koCard: Card | null | undefined, pool: Map<string, Card>,
): CardInstance[] {
  if (!canRelicanthDiverCatchTrigger(state, ownerIdx, koCard, pool)) return [];
  return koInst.energyAttached.filter(e => isBasicWaterEnergy(e.cardId, pool));
}

/** 把一張KO寶可夢保留的基本水能量排入待確認佇列(空則no-op)。 */
function enqueueDiverCatch(
  state: GameState, ownerIdx: 0 | 1, koName: string, held: CardInstance[],
): GameState {
  if (!held || held.length === 0) return state;
  return { ...state, _diverCatchQueue: [
    ...(state._diverCatchQueue ?? []), { ownerIdx, koName, heldEnergy: held },
  ] };
}

/** dispatcher 末端:把累積的潛者捕捉確認 flush 成 modal-choice(可選是否回手);多隻→鏈式排隊。 */
function flushDiverCatchQueue(state: GameState, pool: Map<string, Card>): GameState {
  const q0 = state._diverCatchQueue;
  if (!q0 || q0.length === 0) return state;
  // v5.985 美納斯｜平穩境地(官方Q&A明文「不行」)：被回手的是「昏厥寶可夢身上」＝自己場上的能量
  //   → 該側的對手有生效中平穩境地則不得回手。被擋項不開 modal，held 能量直接進該側棄牌堆。
  let state2 = state;
  const q: typeof q0 = [];
  for (const e of q0) {
    if (_calmGroundBlocksReturn(state2, e.ownerIdx, pool)) {
      state2 = updatePlayer(
        addLog(state2, `「潛者捕捉」：對手場上有【平穩境地】，${e.koName} 身上的「基本【水】能量」${e.heldEnergy.length} 張無法放回手牌 → 進棄牌堆`, e.ownerIdx),
        e.ownerIdx, p => ({ ...p, discard: [...p.discard, ...e.heldEnergy] }),
      );
    } else {
      q.push(e);
    }
  }
  state = state2;
  if (q.length === 0) return { ...state, _diverCatchQueue: undefined };
  const modals: PendingSelection[] = q.map(e => ({
    type: 'modal-choice',
    actorIdx: e.ownerIdx,
    sourcePlayerIdx: e.ownerIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'diver-catch-confirm',
    params: {
      label: '潛者捕捉',
      heldEnergy: e.heldEnergy,
      koName: e.koName,
      options: [
        { id: 'yes', text: `是（${e.heldEnergy.length} 張「基本【水】能量」放回手牌）` },
        { id: 'no', text: '否（一併進棄牌堆）' },
      ],
    },
  } as PendingSelection));
  const s = { ...state, _diverCatchQueue: undefined };
  if (s.pendingSelection) {
    // 已有其他 pending(如取獎picker)→潛者捕捉全部排到鏈尾,依序處理
    return { ...s, pendingChainQueue: [ ...(s.pendingChainQueue ?? []), ...modals ] };
  }
  const [first, ...rest] = modals;
  return {
    ...s, pendingSelection: first,
    pendingChainQueue: rest.length ? [ ...(s.pendingChainQueue ?? []), ...rest ] : s.pendingChainQueue,
  };
}

/**
 * v6.037 中央：sanityKOSweep 的擊倒 log 措辭。
 *
 * ⚠原本所有走 sweep 的擊倒一律寫「⚠️ 系統擊倒檢查」——那是**兜底機制的名字**。
 *   對「效果昏厥」型的卡（千面避役｜擊斃、咒詛炸彈、滲透寒氣、浸蝕污泥…）來說，
 *   sweep 就是它們**正常的**結算路徑，玩家卻會看到一行像系統異常的警告，
 *   完全看不出「這是我剛用的招式造成的」。（玩家實際回報「擊斃沒反應」的體感來源之一：
 *   打到自己方的低 HP 寶可夢時，畫面上只有這行看起來像 bug 的訊息。）
 * → 有 _faintReason 就用卡面來源寫；沒有才是真的兜底異常，維持原措辭。
 *   這讓「系統擊倒檢查」回歸它真正的意義，之後看到它就代表**真的有東西沒收斂**。
 */
function koSweepLogLine(
  inst: CardInstance, name: string, where: '戰鬥場' | '備戰位', hp: number, prizes: number,
): string {
  const who = `${cardLink(inst.iid, name)}`;
  if (inst._faintReason) {
    return `${inst._faintReason}：${who} 被昏厥！（${where}）對手獲得 ${prizes} 張獎賞卡`;
  }
  return `⚠️ 系統擊倒檢查：${who} 被擊倒（${where}，傷害 ${inst.damage} ≥ HP ${hp}）+${prizes} 張獎賞卡`;
}

function sanityKOSweep(
  state: GameState,
  attackerIdx: 0 | 1,
  pool: Map<string, Card>,
): GameState {
  const dIdx = (1 - attackerIdx) as 0 | 1;
  let s = state;
  let prizesAcc = 0;
  let anyKO = false;
  // 只掃對手 — 自己 KO（咒詛炸彈等）有專屬流程，不該被這個 fallback 干擾
  const player = { ...s.players[dIdx] };
  // active
  if (player.active) {
    const inst = player.active;
    const card = pool.get(inst.cardId);
    const hp = getEffectiveHP(inst, pool, s);
    if (hp > 0 && inst.damage >= hp) {
      anyKO = true;
      const ko = inst;
      // v5.918 潛者捕捉:被招式KO的【水】寶可夢,若該側有獵斑魚→基本水能量不進棄牌,排隊確認回手
      const heldWaterA = diverCatchHeldEnergy(s, dIdx, ko, card, pool);
      const heldIdsA = new Set(heldWaterA.map(e => e.iid));
      const koDiscard: CardInstance[] = [
        ko, ...ko.energyAttached.filter(e => !heldIdsA.has(e.iid)),
        ...getAllAttachedTools(ko),
        ...(ko.evolvedFromStack ?? []),
      ];
      player.discard = [...player.discard, ...koDiscard];
      player.active = null;
      if (card) prizesAcc += prizesForKO(card);
      s = addLog(s, koSweepLogLine(ko, card?.name ?? '?', '戰鬥場', hp, card ? prizesForKO(card) : 1), null);
      s = enqueueDiverCatch(s, dIdx, card?.name ?? '?', heldWaterA);
      // v2.246：sanity sweep 大多是招式效果產生的 zombie KO，記錄為 attack cause
      s = recordOppKO(s, dIdx, card, 'attack', !ko._faintByEffect);
    }
  }
  // bench
  const newBench: CardInstance[] = [];
  for (const b of player.bench) {
    const inst = b;
    const card = pool.get(inst.cardId);
    const hp = getEffectiveHP(inst, pool, s);
    if (hp > 0 && b.damage >= hp) {
      anyKO = true;
      // v5.918 潛者捕捉:備戰【水】寶可夢被招式KO也觸發(卡面涵蓋戰鬥場或備戰區)
      const heldWaterB = diverCatchHeldEnergy(s, dIdx, b, card, pool);
      const heldIdsB = new Set(heldWaterB.map(e => e.iid));
      const koDiscard: CardInstance[] = [
        b, ...b.energyAttached.filter(e => !heldIdsB.has(e.iid)),
        ...getAllAttachedTools(b),
        ...(b.evolvedFromStack ?? []),
      ];
      player.discard = [...player.discard, ...koDiscard];
      if (card) prizesAcc += prizesForKO(card);
      s = addLog(s, koSweepLogLine(b, card?.name ?? '?', '備戰位', hp, card ? prizesForKO(card) : 1), null);
      s = enqueueDiverCatch(s, dIdx, card?.name ?? '?', heldWaterB);
      // v2.246：sanity sweep 大多是招式效果產生的 zombie KO，記錄為 attack cause
      s = recordOppKO(s, dIdx, card, 'attack', !b._faintByEffect);
    } else {
      newBench.push(b);
    }
  }
  player.bench = newBench;
  if (!anyKO) return normalizeNonFieldStacks(state);
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = player;
  s = addPendingPrize({ ...s, players }, attackerIdx, prizesAcc, pool);
  // 對手 active+bench 都空 → 直接終局
  if (player.active === null && player.bench.length === 0) {
    s = {
      ...s, phase: 'game-over',
      winner: attackerIdx,
      winReason: `${player.name} 沒有可上場的寶可夢`,
    };
  }
  return normalizeNonFieldStacks(s);
}

// ── 正式對戰動作處理 ─────────────────────────────────────────────────────────

// v5.678：回力鏢能量 / 燃料【火】能量 的「被自身招式效果丟棄後歸還」收斂單一來源。
//   回力鏢能量：被自身招式效果丟棄 → 重附回原 active（active iid 未變才回）。
//   燃料【火】能量：被【火】寶可夢招式效果丟棄 → 放回手牌（與寶可夢解綁）。
//   USE_ATTACK 同步流程末端呼叫一次；若招式以 picker 收尾（如銀伴戰獸｜空氣斬「選 1 個自身能量丟棄」），
//   丟棄發生在後續 RESOLVE_SELECTION → 同步 revive 抓不到，故把快照存進 state._pendingAttackEnergyRevive，
//   待 picker 鏈全部解完後在 RESOLVE_SELECTION 再呼叫一次（單一 helper，免兩份邏輯漂移）。
function reviveAttackDiscardedSpecialEnergy(
  state: GameState,
  aIdx: 0 | 1,
  boomIids: string[],
  boomActiveIid: string,
  fuelIids: string[],
  pool: Map<string, Card>,
): GameState {
  let newState = state;
  // 回力鏢能量 → 重附回原 active
  if (boomIids.length > 0) {
    const curAtk = newState.players[aIdx].active;
    const curDiscard = newState.players[aIdx].discard;
    if (curAtk && curAtk.iid === boomActiveIid) {
      const returnSet = new Set(boomIids);
      const toReturn = curDiscard.filter(e => returnSet.has(e.iid));
      if (toReturn.length > 0) {
        const newDiscard = curDiscard.filter(e => !returnSet.has(e.iid));
        const attachedIidSet = new Set(curAtk.energyAttached.map(e => e.iid));
        const actuallyReturn = toReturn.filter(e => !attachedIidSet.has(e.iid));
        if (actuallyReturn.length > 0) {
          const newActive: CardInstance = { ...curAtk, energyAttached: [...curAtk.energyAttached, ...actuallyReturn] };
          const refPlayers = [...newState.players] as [PlayerState, PlayerState];
          refPlayers[aIdx] = { ...refPlayers[aIdx], active: newActive, discard: newDiscard };
          const atkName = pool.get(newActive.cardId)?.name ?? '?';
          newState = addLog({ ...newState, players: refPlayers }, `回力鏢能量：${actuallyReturn.length} 張重新附於 ${atkName}`, aIdx);
        }
      }
    }
  }
  // 燃料【火】能量 → 放回手牌
  if (fuelIids.length > 0) {
    const aPlayer = newState.players[aIdx];
    const returnSet = new Set(fuelIids);
    const toReturn = aPlayer.discard.filter(e => returnSet.has(e.iid));
    if (toReturn.length > 0) {
      const newDiscard = aPlayer.discard.filter(e => !returnSet.has(e.iid));
      const refPlayers = [...newState.players] as [PlayerState, PlayerState];
      refPlayers[aIdx] = { ...refPlayers[aIdx], hand: [...refPlayers[aIdx].hand, ...toReturn], discard: newDiscard };
      newState = addLog({ ...newState, players: refPlayers }, `燃料【火】能量：${toReturn.length} 張因招式效果被丟棄，放回手牌`, aIdx);
    }
  }
  return newState;
}

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

  // ── v2.981 若有任一方待領獎賞，只允許 TAKE_PRIZES / SEND_NEW_ACTIVE / RESOLVE_SELECTION ──
  // 防止 pending prize 期間玩家進行其他 main-phase 動作（攻擊、使用競技場、特性、撤退、附能量等）
  // 這個 gate 確保獎賞流程的順序性 — 獎賞必須先取完才能繼續其他動作
  if (
    hasAnyPendingPrize(state)
    && action.type !== 'TAKE_PRIZES'
    && action.type !== 'SEND_NEW_ACTIVE'
    && action.type !== 'RESOLVE_SELECTION'
  ) return state;

  // ── v5.211 祭典樂舞第 2 次招式 pending — 只允許 ATTACK / END_TURN / mid-flow actions ──
  // 卡面語意：第 1 次後玩家只能「再用相同招式」或「跳過攻擊」（END_TURN）。
  // pending 期間禁止：附能 / 進化 / 用支援者 / 場地 / 道具 / 放寶可夢 / 撤退 / 特性。
  // 例外：RESOLVE_SELECTION / TAKE_PRIZES / SEND_NEW_ACTIVE（mid-flow flush）+ DRAW_CARD（防呆）。
  if (
    state.festivalDancePendingSecondAttack
    && action.type !== 'ATTACK'
    && action.type !== 'END_TURN'
    && action.type !== 'RESOLVE_SELECTION'
    && action.type !== 'TAKE_PRIZES'
    && action.type !== 'SEND_NEW_ACTIVE'
    && action.type !== 'DRAW_CARD'
  ) {
    return addLog(state, '祭典樂舞：第 2 次招式 pending 期間，只能再用相同招式或結束回合', state.activePlayerIndex);
  }

  // ── 選擇解析 ──────────────────────────────────────────────────────────────
  if (action.type === 'RESOLVE_SELECTION') {
    if (!state.pendingSelection) return state;
    const { effectKey, actorIdx, params } = state.pendingSelection;
    const _resolvePreLogLen = state.log.length;
    // v5.431：resolver 內擲幣（選目標後才擲，如群起瞄準）也能觸發重試徽章 — 快照 pre-resolve 供 revert + 記擲幣前旗標
    const _preResolveStateForRetry = state;
    const _coinFlippedBeforeResolve = state.coinFlippedThisAttack === true;
    // Guard：若明確指定 senderIdx，必須等於 actorIdx — 防止對手搶先操作
    if (action.senderIdx != null && action.senderIdx !== actorIdx) return state;
    const endTurnAfter = params?.endTurnAfter === true;
    const resolver = RESOLVERS.get(effectKey);
    let newState: GameState = { ...state, pendingSelection: undefined };
    if (resolver) {
      // v6.010 中央 sanitize 閘:消毒 client selectedIids(去重/zone成員/validIids交集/夾maxCount)後才交 resolver。
      const _cleanIids = sanitizeSelectedIids(state, state.pendingSelection, action.selectedIids, pool);
      newState = resolver(newState, actorIdx, _cleanIids, params, pool);
    }
    // v4.898 重試徽章 — inline handler（無 regR 註冊；直接在此特判）
    // v5.165 重設計：modal popup 時 engine 已 rollback state（傷害未套）；玩家確認後
    //   才正式套用——符合 PTCG 「玩家先決定使否使用徽章再套傷害」精神。
    //   選 'keep'  → 用 stored coinFlips inject 給 regPre 重跑 ATTACK（產生相同 heads/damage）
    //   選 'retry' → 設 retryBadgeUsedThisTurn=true + 重跑 ATTACK（不 inject = 重新 random）
    //   兩條路徑都帶 _retryBadgeAlreadyAsked=true 避免末端再次 trigger modal（無限循環防護）。
    if (effectKey === 'm5-retry-badge-decide') {
      const choice = action.selectedIids[0];
      const preAttackState = params?.preAttackState as GameState | undefined;
      const originalAction = params?.originalAction as Extract<GameAction, { type: 'ATTACK' | 'RESOLVE_SELECTION' }> | undefined;  // v5.326 ATTACK / v5.431 也收 RESOLVE_SELECTION（resolver 內擲幣重試）
      const coinFlips = params?.coinFlips as string[] | undefined;
      if (preAttackState && originalAction) {
        if (choice === 'keep') {
          // v5.262：把 inject 設到 state._retryInjectedFlipsQueue, flipCoinsWithLog 自己 consume.
          //   解決 v5.165/v5.257 「inline caller 沒 forward action._retryInjectedFlips 進 helper」的 bug.
          const injectedAction: GameAction = {
            ...originalAction,
            _retryInjectedFlips: coinFlips,  // legacy (v5.257 helper-based caller 仍 read)
            _retryBadgeAlreadyAsked: true,
          };
          const reverted: GameState = {
            ...preAttackState,
            coinFlippedThisAttack: false,
            _machineGunLastFlips: undefined,
            _retryInjectedFlipsQueue: coinFlips ? [...coinFlips] : undefined,  // v5.262 state queue
          };
          const flipsStr = (coinFlips ?? []).map((f, i) => `第${i + 1}次→${f}`).join('、');
          const withLog = addLog(reverted, `🎲 重試徽章：玩家選擇保留剛才擲幣結果（${flipsStr}），開始套用傷害`, actorIdx);
          return handlePlaying(withLog, injectedAction, pool);
        } else if (choice === 'retry') {
          // 消耗徽章 + 重新擲幣（不 inject = 走原 random path）+ 避免再次 trigger modal
          const revPlayers = [...preAttackState.players] as [PlayerState, PlayerState];
          revPlayers[actorIdx] = {
            ...revPlayers[actorIdx],
            retryBadgeUsedThisTurn: true,
          };
          const reverted: GameState = {
            ...preAttackState,
            players: revPlayers,
            coinFlippedThisAttack: false,
            _machineGunLastFlips: undefined,
          };
          const injectedAction: GameAction = {
            ...originalAction,
            _retryBadgeAlreadyAsked: true,
          };
          const withLog = addLog(reverted, '🎲 重試徽章：消除剛才擲幣結果，重新擲幣！', actorIdx);
          return handlePlaying(withLog, injectedAction, pool);
        }
      }
    }
    // v4.933：resolver 跑完後若 pendingSelection 為空但 chain queue 仍有東西
    //   → pop 一筆設為新 pendingSelection（continue 鏈式 resolve）。
    //   觸發 case：同一 ATTACK 內 TOOL_ON_DAMAGED + ATTACK_POST 各自開 pending，
    //   withPending 將後者排隊；玩家解完前者後接續處理後者。
    if (!newState.pendingSelection && newState.pendingChainQueue && newState.pendingChainQueue.length > 0) {
      const [nextSel, ...restQueue] = newState.pendingChainQueue;
      newState = {
        ...newState,
        pendingSelection: nextSel,
        pendingChainQueue: restQueue.length > 0 ? restQueue : undefined,
      };
    }
    // v5.678：picker 收尾的招式自身丟能量 → 在 picker 鏈全部解完後補跑回力鏢/燃料火 revive（單一 helper）。
    if (!newState.pendingSelection && newState._pendingAttackEnergyRevive) {
      const _rv = newState._pendingAttackEnergyRevive;
      newState = reviveAttackDiscardedSpecialEnergy(newState, _rv.aIdx, _rv.boomIids, _rv.boomActiveIid, _rv.fuelIids, pool);
      newState = { ...newState, _pendingAttackEnergyRevive: undefined };
    }
    // 若為招式觸發的互動效果，解決後進入回合結束（不再有連鎖 pendingSelection 時才設）
    if (endTurnAfter && !newState.pendingSelection) {
      newState = { ...newState, turnPhase: 'end' };
    }
    // v2.132：resolver 也可能 leave zombie（damage ≥ HP 卻沒移到棄牌）— sanity sweep 對手側
    newState = sanityKOSweep(newState, actorIdx, pool);
    newState = tryPromoteToMainForFestival(newState, pool);
    // v5.419 保險絲：保證每次 RESOLVE_SELECTION 讓 log.length 嚴格遞增。線上防舊快照守衛以
    //   log.length 為單調時鐘且只擋「嚴格較短」；多段 picker 若某步 resolver 只開下一個 pending
    //   而沒加 log（post 與 pre 等長），等長舊快照會溜過守衛覆蓋掉剛選好的狀態 → 玩家「按確定後
    //   沒選到」。補一筆 marker 確保時鐘前進，根除整類等長覆蓋（線上 picker 選取被吃掉）。
    if (newState.log.length === _resolvePreLogLen) {
      newState = addLog(newState, newState.pendingSelection ? '（繼續選擇下一步）' : '（選擇已套用）', actorIdx);
    }
    // v5.431：resolver 內擲幣的重試徽章 check（ATTACK 末端看不到 resolver 階段才設的 coinFlippedThisAttack）。
    //   只在「本次 resolve 才擲幣」(非 ATTACK 階段殘留) + 攻擊者無屬性 + 附重試徽章 + 未用過 + 無後續 pending 時觸發。
    //   revert 回 pre-resolve（含原 picker pending），開 m5-retry-badge-decide modal；decide handler 會重跑此 RESOLVE_SELECTION。
    if (
      newState.coinFlippedThisAttack === true
      && !_coinFlippedBeforeResolve
      && action._retryBadgeAlreadyAsked !== true
      && !newState.pendingSelection
      && !isToolsJammed(newState, pool)
    ) {
      const _rbInst = newState.players[actorIdx].active;
      const _rbCard = _rbInst ? pool.get(_rbInst.cardId) : undefined;
      const _rbHasBadge = !!_rbInst && getAllAttachedTools(_rbInst).some(t => pool.get(t.cardId)?.name === '重試徽章');
      if (_rbInst && _rbHasBadge && !newState.players[actorIdx].retryBadgeUsedThisTurn) {
        if (_rbCard?.pokemonType !== 'Colorless') {
          newState = addLog(newState, `🎒 重試徽章：附在 ${_rbCard?.name ?? '?'}（非【無】屬性）→ 本次效果不觸發 (卡面僅對【無】屬性寶可夢生效)`, actorIdx);
        } else {
          const _rbFlips = newState._machineGunLastFlips ?? [];
          let _rev: GameState = { ..._preResolveStateForRetry, coinFlippedThisAttack: false, _machineGunLastFlips: undefined };
          _rev = addLog(_rev, '🎲 重試徽章：本次擲幣可重擲，請選擇', actorIdx);
          newState = {
            ..._rev,
            pendingSelection: {
              type: 'modal-choice', actorIdx, sourcePlayerIdx: actorIdx,
              minCount: 1, maxCount: 1,
              effectKey: 'm5-retry-badge-decide',
              params: {
                label: '重試徽章',
                preAttackState: _preResolveStateForRetry,
                originalAction: action,
                coinFlips: _rbFlips,
                attackName: (typeof params?.attackName === 'string' ? params.attackName : '招式'),
                options: [
                  { id: 'keep', text: '✅ 不重擲（使用剛才擲幣結果，套用效果）' },
                  { id: 'retry', text: '🔄 重擲（消除剛才擲幣結果，重新擲幣）— 本回合 1 次' },
                ],
              },
            },
          };
        }
      }
    }
    return newState;
  }

  // ── 從手牌打出基礎寶可夢到備戰區 ─────────────────────────────────────────
  if (action.type === 'PLAY_BASIC') {
    if (state.turnPhase !== 'main') return state;
    // v2.136 零之大空洞：場上有太晶寶可夢時上限可達 8
    if (attacker.bench.length >= getBenchLimit(state, aIdx, pool)) return state;
    const hIdx = attacker.hand.findIndex(c => c.iid === action.iid);
    if (hIdx < 0) return state;
    const inst = attacker.hand[hIdx];
    const card = pool.get(inst.cardId);
    if (!isBasicPokemonCard(card)) return state;
    // v2.997 海豚俠ex｜全能靈魂 — 「這張卡只可依據海豚俠的特性『全能變身』放置於場上」
    //   block 從手牌正常 PLAY_BASIC（全能變身另路徑放上場時不會走此 handler）
    if (isAllPowerSoulBlocked(card)) {
      return addLog(state,
        `${attacker.name} 的 ${cardLink(inst.iid, card.name)} 因「全能靈魂」效果，無法從手牌放上場（只能由「全能變身」放置）`,
        aIdx);
    }
    // v3.01 Wave 3 — 火箭隊的阿柏怪｜瞪眼效用：對手戰鬥場有 → 我方擁有特性的寶可夢
    //   （『火箭隊的』除外）不能從手牌放置於場上（PLAY_BASIC 路徑）
    if (isOppEvilEyeBlocking(state, aIdx, card, pool)) {
      return addLog(state,
        `${attacker.name} 的 ${cardLink(inst.iid, card.name)} 因對手「瞪眼效用」效果，無法從手牌放置於場上`, aIdx);
    }

    // Bug fix (#17 擔架): 從手牌放出時清除任何殘留的戰鬥狀態
    // (正常流程不應有殘留，但若卡片曾透過擔架從棄牌取回，防禦性清除)
    // v5.993：改 toBareCard 白名單裸化 — 原黑名單漏 abilityUsedThisTurn/cantAttackThisTurn/
    //   healedThisTurn/各 immune* 旗標(擔架/回手類取回的卡帶 stale 旗標重打會外洩)。
    const placed = { ...toBareCard(inst), justPlaced: true, playedFromHand: true };
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);
    attacker.bench = [...attacker.bench, placed];
    players[aIdx] = attacker;
    let afterPlace = addLog(
      { ...state, players },
      `${attacker.name} 將 ${cardLink(placed.iid, card.name)} 放到備戰區`,
      aIdx
    );
    // 觸發「放到備戰區」特性（例：喵喵ex｜殺手鐧捕捉）
    // 火箭隊的監視塔：【無】屬寶可夢的特性全部消除，跳過此觸發
    const placeFn = BENCH_PLACE_TRIGGERS.get(card.name);
    // v5.524：鐵荊棘ex 初始化也消除「放到備戰即觸發」型特性（規則寶可夢，未來除外）
    if (placeFn && !isColorlessAbilityBlocked(afterPlace, card, pool) && !isInitializeBlocking(afterPlace, placed, pool)) {
      afterPlace = placeFn(afterPlace, aIdx, pool);
    }
    // v5.866：險惡廢墟改走 applyAction 出口中央偵測(applyRuggedRuinsBenchPlace),此處不再呼叫
    // v2.320：自動提示「從手牌放置於備戰區時」的特性（如殺手鐧捕捉、狂挖等）
    // v3.76：火箭隊的監視塔在場時，【無】寶可夢的 on-play 特性也要被消除（喵喵ex 殺手鐧捕捉等）
    if (!isColorlessAbilityBlocked(afterPlace, card, pool)) {
      afterPlace = promptPlayAbilities(afterPlace, aIdx, card, placed, pool, false);
    }
    return afterPlace;
  }

  // ── v2.187 化石 Item 作為基礎寶可夢上場 ─────────────────────────────────
  // 規則：化石卡（FOSSIL_ITEM_NAMES）打到備戰區，視為 HP60【無】基礎寶可夢。
  // Leon 確認：險惡廢墟 / bench-place trigger 會觸發、可附 Tool/能量、被 KO 給 1 張獎賞。
  if (action.type === 'PLAY_FOSSIL') {
    if (state.turnPhase !== 'main') return state;
    if (attacker.bench.length >= getBenchLimit(state, aIdx, pool)) return state;
    const hIdx = attacker.hand.findIndex(c => c.iid === action.iid);
    if (hIdx < 0) return state;
    const inst = attacker.hand[hIdx];
    const card = pool.get(inst.cardId);
    if (!isFossilItemCard(card)) return state;
    // v4.936：化石卡是 Item — 必須通過所有 Item 鎖 check（與 PLAY_TRAINER Item 分支同條件）
    //   a. attacker.cantPlayItemThisTurn — 含羞苞癢癢花粉 / 吼叫尾ex 絕叫 / 電蜘蛛ex 雷擊石
    if (attacker.cantPlayItemThisTurn) {
      return addLog(state,
        `${attacker.name} 本回合無法從手牌使出物品卡（化石不可使出）`, aIdx);
    }
    //   b. 對手戰鬥場 威迫目光（班基拉斯特性）— 未被消除時擋 Item
    //   v5.222：改用 hasAbilityOnActive helper (cover 招式版+passive 暗夜羽擊，Rule 18)
    if (hasAbilityOnActive(state, (1 - aIdx) as 0 | 1, pool, '威迫目光')) {
      return addLog(state,
        `${attacker.name} 因對手「威迫目光」效果，無法從手牌使出化石（物品卡）`, aIdx);
    }
    //   c. v3.821：對手戰鬥場 海之詛咒（胖嘟嘟ex特性）— 鎖物品
    //      卡面：「對手無法從手牌使出『物品』卡」— 化石 Item 屬於物品卡
    if (isOppItemPlayBlocked(state, aIdx, pool)) {
      return addLog(state,
        `${attacker.name} 因對手「海之詛咒」效果，無法從手牌使出化石（物品卡）`, aIdx);
    }

    // v5.993：化石上場也 toBareCard 白名單裸化(原完全未清 — 被回收重打會殘留 damage/旗標)。
    const placed: CardInstance = { ...toBareCard(inst), justPlaced: true, fossilOnField: true, playedFromHand: true };
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);
    attacker.bench = [...attacker.bench, placed];
    players[aIdx] = attacker;
    let afterPlace = addLog(
      { ...state, players },
      `${attacker.name} 將 ${card!.name} 作為【基礎】寶可夢放到備戰區（HP60／【無】）`,
      aIdx
    );
    // 化石上場 = 寶可夢上場;v5.866 險惡廢墟改走 applyAction 出口中央偵測,此處不再呼叫
    return afterPlace;
  }

  // ── v2.187 化石自主丟棄（場上化石 → 棄牌區，非昏厥）────────────────────
  // 規則：自己回合 main phase 可走此 action 把場上化石丟掉。對手不抽獎賞。
  // 若被丟棄的是戰鬥場 → 必須從備戰補 1 隻（走 SEND_NEW_ACTIVE pending 流程）。
  if (action.type === 'DISCARD_FOSSIL') {
    if (state.turnPhase !== 'main') return state;
    // 戰鬥場
    if (attacker.active?.iid === action.iid && attacker.active.fossilOnField) {
      const card = pool.get(attacker.active.cardId);
      const fossilName = card?.name ?? '化石';
      // 把化石（含附加的能量、道具）整組丟棄
      const discardEntries: CardInstance[] = [
        { ...attacker.active, fossilOnField: undefined, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined,
          energyAttached: [], toolAttached: undefined, extraTools: [] },
        ...attacker.active.energyAttached,
        ...getAllAttachedTools(attacker.active),
      ];
      attacker.discard = [...attacker.discard, ...discardEntries];
      attacker.active = null;
      players[aIdx] = attacker;
      // active=null 時 UI 會自動偵測並彈備戰選擇器（同昏厥後補位流程，但無獎賞）
      return addLog({ ...state, players },
        `${attacker.name} 將戰鬥場的 ${fossilName} 丟棄到棄牌區（非昏厥）`, aIdx);
    }
    // 備戰
    const bIdx = attacker.bench.findIndex(b => b.iid === action.iid && b.fossilOnField);
    if (bIdx < 0) return state;
    const benchInst = attacker.bench[bIdx];
    const benchCard = pool.get(benchInst.cardId);
    const fossilName = benchCard?.name ?? '化石';
    const discardEntries: CardInstance[] = [
      { ...benchInst, fossilOnField: undefined, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined,
        energyAttached: [], toolAttached: undefined, extraTools: [] },
      ...benchInst.energyAttached,
      ...getAllAttachedTools(benchInst),
    ];
    attacker.discard = [...attacker.discard, ...discardEntries];
    attacker.bench = attacker.bench.filter((_, i) => i !== bIdx);
    players[aIdx] = attacker;
    return addLog({ ...state, players },
      `${attacker.name} 將備戰區的 ${fossilName} 丟棄到棄牌區（非昏厥）`, aIdx);
  }

  // ── 進化 ──────────────────────────────────────────────────────────────────
  if (action.type === 'EVOLVE') {
    if (state.turnPhase !== 'main') return state;
    // Wave 39：玩家級進化鎖（例：青銅鐘｜進化妨礙者）
    if (attacker.cantEvolveThisTurn) return state;

    // 在手牌找進化卡
    const evoHIdx = attacker.hand.findIndex(c => c.iid === action.toIid);
    if (evoHIdx < 0) return state;
    const evoInst = attacker.hand[evoHIdx];
    const evoCard = pool.get(evoInst.cardId);
    if (!evoCard || evoCard.supertype !== 'Pokemon' || !evoCard.evolvesFrom) return state;
    // v5.341 海豚俠ex｜全能靈魂 — 「這張卡只可依據海豚俠的特性『全能變身』放置於場上」。
    //   EVOLVE 路徑也要擋（原本只 PLAY_BASIC 擋；海豚俠ex evolvesFrom=波普海豚 → 會被當一般進化目標）。
    if (isAllPowerSoulBlocked(evoCard)) {
      return addLog(state,
        `${attacker.name} 的 ${evoCard.name} 因「全能靈魂」效果，無法以一般進化放上場（只能由「全能變身」放置）`, aIdx);
    }

    // v3.01 Wave 3 — 火箭隊的阿柏怪｜瞪眼效用：對手戰鬥場有 → 我方擁有特性的寶可夢
    //   （『火箭隊的』除外）不能從手牌進化放置於場上（EVOLVE 路徑）
    if (isOppEvilEyeBlocking(state, aIdx, evoCard, pool)) {
      return addLog(state,
        `${attacker.name} 的 ${evoCard.name} 因對手「瞪眼效用」效果，無法從手牌放置於場上（進化）`, aIdx);
    }

    // 在場上（出場或備戰）找基底
    let basePoke: CardInstance | null = null;
    let isActive = false;
    if (attacker.active?.iid === action.fromIid) {
      basePoke = attacker.active; isActive = true;
    } else {
      basePoke = attacker.bench.find(c => c.iid === action.fromIid) ?? null;
    }
    if (!basePoke) return state;
    const baseCard = pool.get(basePoke.cardId);
    if (!baseCard) return state;
    // v2.149 提升進化（伊布 SV8a 125）：戰鬥場上時可第 1 回合或剛使出時進化
    //   只有 base 在戰鬥場 + base 卡擁有此特性時 bypass isFirstTurn / justPlaced gate
    const hasPushEvolveAbility = isActive && baseCard.abilities?.some(a => a.name === '提升進化');
    // v2.997 小嘴蝸 / 蓋蓋蟲｜刺激進化也 bypass isFirstTurn gate（卡面：「最初回合或剛使出的回合也可進化」）
    const hasShellinkBypassFirst = hasShellinkEvolveBypass(baseCard, state, aIdx, pool);
    // 鬥志戰吼（勒克貓 Stage1 特性）：若對手戰鬥場是【ex】寶可夢，
    //   場上的勒克貓即使「最初回合 / 剛使出 / evolvedThisTurn」都可進化（成倫琴貓）。
    //   進化鏈：小貓怪 (Basic) → 勒克貓 (Stage1, 鬥志戰吼) → 倫琴貓 (Stage2)
    //   判定：baseCard 是勒克貓（場上要進化的）+ 對手戰鬥場是 ex。
    const _oppActiveEarly = state.players[1 - aIdx as 0 | 1]?.active;
    const _oppActiveCardEarly = _oppActiveEarly ? pool.get(_oppActiveEarly.cardId) : undefined;
    const _oppIsExEarly = _oppActiveCardEarly?.subtype === 'ex' || (_oppActiveCardEarly?.name?.endsWith('ex') ?? false);
    const hasFightingHowlEarly = baseCard.name === '勒克貓' && _oppIsExEarly;
    if (state.isFirstTurn && !hasPushEvolveAbility && !hasShellinkBypassFirst && !hasFightingHowlEarly) return state; // 第一回合不能進化
    // v2.102 活力森林（Stadium）— 雙方的所有【草】寶可夢就算在剛使出的回合也可進化成【草】寶可夢。
    //   自己最初回合例外。
    // v2.110：bypass 不只 justPlaced，也 bypass evolvedThisTurn — 允許同回合連鎖進化
    //   整條草進化鏈（例：菊草葉→月桂葉→大竺葵 一回合打完）。只要草→草、活力森林在場。
    // v3.877：state.turn 只在後攻方 END_TURN 才 +1，所以 state.turn===1 同時涵蓋雙方第 1 動作回合。
    //   原本只依賴 state.isFirstTurn gate（只擋先攻方第 1 動作回合）— 後攻方第 1 動作回合 isFirstTurn=false，
    //   bypass 仍會啟動。改加 state.turn > 1 才正確實現「雙方各自最初回合除外」。
    const stadiumName = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
    const vigorousForestException = stadiumName === '活力森林' &&
      baseCard.pokemonType === 'Grass' && evoCard.pokemonType === 'Grass' &&
      state.turn > 1;
    const hasFightingHowl = hasFightingHowlEarly;
    // v2.997 小嘴蝸 / 蓋蓋蟲｜刺激進化 — 自方場上有 partner 時 bypass isFirstTurn + justPlaced + evolvedThisTurn
    const hasShellinkBypass = hasShellinkEvolveBypass(baseCard, state, aIdx, pool);
    // v2.997 isFirstTurn gate 也補入 bypass（line 1658 上方已 return state，此處重新補放行）
    // — 改寫 line 1658 的 gate 較危險；採用「在 line 1674 的 justPlaced gate 加 bypass」
    //   並讓 line 1658 的 isFirstTurn gate 額外考量本特性。
    if ((basePoke.justPlaced || basePoke.evolvedThisTurn) && !vigorousForestException && !hasPushEvolveAbility && !hasFightingHowl && !hasShellinkBypass) return state;
    // v2.149 虹色DNA（伊布ex SV8a 126）：從伊布進化的 ex 可放此寶可夢身上完成進化
    //   標準 sameEvoName 檢查失敗時，若 base 卡有此特性 + evoCard.evolvesFrom='伊布' + evoCard 是 ex → 放行
    const hasPrismaticDNA = baseCard.abilities?.some(a => a.name === '虹色DNA');
    const prismaticDNAException = hasPrismaticDNA &&
      sameEvoName(evoCard.evolvesFrom, '伊布') &&
      evoCard.subtype === 'ex';
    if (!sameEvoName(evoCard.evolvesFrom, baseCard.name) && !prismaticDNAException) return state;

    // 進化：繼承傷害、能量、寶可夢道具；進化鏈堆疊保留被進化掉的 CardInstance（裸殼，附加物轉給頂層）
    // v2.260 Bug #2 修：PDF §I-A-05「進化後特殊狀態全部消除」 — 不再繼承 basePoke.status。
    //   spread `...evoInst` 後 status / secondaryStatus / 跨回合 flag（cantRetreatNextTurn /
    //   damageReduceNextHit / cantAttackThisTurn 等）皆從 evoInst（新進化卡）繼承 default
    //   undefined，等同於「特殊狀態與招式效果全部消除」。
    const prevStack = basePoke.evolvedFromStack ?? [];
    // v4.20：baseBare 是 evolvedFromStack 的歷史記錄項，**不應帶 transient turn flags**。
    //   原 `...basePoke` spread 會把 justPlaced / evolvedThisTurn / playedFromHand /
    //   movedToActiveThisTurn / cantAttackThisTurn / abilityUsedThisTurn / status 等
    //   帶到 chain entry → UI 點放大鏡看 chain link 時錯誤顯示「🆕 本回合才打出」等標籤。
    //   chain entry 只需基本識別欄位（iid / cardId / damage=0 / 清空附加）。
    const baseBare: CardInstance = {
      // evolvedFromStack 裡保存的是「下層卡片實體」，不能與場上的頂層寶可夢共用 iid。
      // 否則 KO/退化/回收後，手牌或牌庫會出現不同卡名但相同 iid，EVOLVE/USE_ABILITY 會錯抓。
      iid: `${basePoke.iid}_base_${basePoke.cardId}_${Math.random().toString(36).slice(2, 8)}`,
      cardId: basePoke.cardId,
      damage: 0,                              // 進化鏈 entry 不保留 damage（保留在頂層 evolved）
      energyAttached: [],
      toolAttached: undefined, extraTools: [],
      evolvedFromStack: undefined,            // 避免遞迴巢狀
      // 注意：所有 transient turn flags（justPlaced/evolvedThisTurn/playedFromHand/
      //   movedToActiveThisTurn/cantAttackThisTurn/abilityUsedThisTurn/status/...）皆不帶
    };
    // v3.77 暈眩山谷（Stadium）— 進化/退化時，【混亂】狀態不會恢復
    //   卡面：「雙方的【混亂】的寶可夢，就算進化・退化，【混亂】也不會恢復。」
    //   只保留 'confused'，其他狀態（睡眠/麻痺/中毒/灼傷）依 PTCG 規則進化即消除。
    const stadiumNameDaze = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
    const preserveConfusion = stadiumNameDaze === '暈眩山谷' && basePoke.status === 'confused';
    const evolved: CardInstance = {
      // v5.993：evoInst 先 toBareCard 白名單裸化 — 進化卡可能從「場上(用過特性/帶旗標)→棄牌→
      //   回牌庫→回手」而來，直接 spread 會繼承 stale abilityUsedThisTurn 等 transient 旗標
      //   (實例:第二隻黑夜魔靈進化當回合咒詛炸彈被擋)。與 _shared buildEvolvedInstance 同步修。
      ...toBareCard(evoInst),
      // 保留場上寶可夢的 iid 作為「這隻寶可夢」的穩定身份。
      // 若使用手牌進化卡的 iid，退化/回牌庫後再進化可能讓場上兩隻寶可夢共享 iid，
      // 造成 USE_ABILITY / 選擇目標等 action 錯抓到另一隻寶可夢。
      iid: basePoke.iid,
      damage: basePoke.damage,
      energyAttached: basePoke.energyAttached,
      toolAttached: basePoke.toolAttached,
      extraTools: basePoke.extraTools,
      // v2.260 Bug #2：不再寫 `status: basePoke.status` — 進化後特殊狀態必須消除（PDF §I-A-05）
      // v3.77：暈眩山谷例外 — 若 base 為【混亂】且場上有此 stadium，保留混亂狀態
      ...(preserveConfusion ? { status: 'confused' as const } : {}),
      evolvedFromIid: basePoke.iid,
      evolvedFromStack: [...prevStack, baseBare],
      evolvedThisTurn: true,
      justPlaced: false,
      // v3.998：清掉 fossilOnField 標籤 — 化石進化成 Stage1 寶可夢後（如陳舊的鰭之化石 → 冰雪龍），
      //   該 inst 已是真寶可夢，不再是化石。否則 UI 把進化後的寶可夢仍當化石處理，
      //   會影響進化判定（冰雪龍 → 冰雪巨龍 無法進化）+ 顯示「🦴 丟棄化石」按鈕（誤丟）。
      fossilOnField: false,
    };

    attacker.hand = attacker.hand.filter((_, i) => i !== evoHIdx);
    if (isActive) {
      attacker.active = evolved;
    } else {
      attacker.bench = attacker.bench.map(c => c.iid === action.fromIid ? evolved : c);
    }
    players[aIdx] = attacker;
    let afterEvolve = addLog(
      { ...state, players },
      `${attacker.name} 的 ${cardLink(evolved.iid, baseCard.name)} 進化為 ${cardLink(evolved.iid, evoCard.name)}！`,
      aIdx
    );
    // v2.320：自動提示「從手牌進化時」的特性（如龐克練肌、精神抽出等）
    // v3.76：火箭隊的監視塔在場時，【無】寶可夢的 on-evolve 特性也要被消除
    if (!isColorlessAbilityBlocked(afterEvolve, evoCard, pool)) {
      afterEvolve = promptPlayAbilities(afterEvolve, aIdx, evoCard, evolved, pool, true);
    }

    // v3.01 Wave 3 — 火箭隊的電龍｜黑暗脈衝：對手場上有 → 該進化卡 +4 指示物
    //   卡面明文「不重複」 → 多隻只 +4 一次（per-evolution）
    if (hasRocketAmpharosDarkPulse(afterEvolve, aIdx, pool)) {
      // v4.56：改用 unified('ability-effect', isBench:?) — 涵蓋對戰圓形/球形盾牌/藏隱/深度下潛/羽毛化石/光之翼
      const updPlayer = afterEvolve.players[aIdx];
      const evolvedOnBench = updPlayer.active?.iid !== evolved.iid;
      const _darkOwnerIdx = (1 - aIdx) as 0 | 1;
      const _darkGuard = canApplyEffectToTarget(afterEvolve, _darkOwnerIdx, evolved, evoCard, 'ability-effect', pool, { isBench: evolvedOnBench });
      if (_darkGuard.blocked) {
        afterEvolve = addLog(afterEvolve,
          `黑暗脈衝：${evoCard.name} ${_darkGuard.reason}（不放指示物）`,
          _darkOwnerIdx);
      } else {
        const updateInst = (inst: CardInstance) => inst.iid === evolved.iid
          ? { ...inst, damage: (inst.damage ?? 0) + 40 } : inst;
        const newPl: PlayerState = {
          ...updPlayer,
          active: updPlayer.active ? updateInst(updPlayer.active) : null,
          bench: updPlayer.bench.map(updateInst),
        };
        const newPlayers: [PlayerState, PlayerState] = [...afterEvolve.players] as [PlayerState, PlayerState];
        newPlayers[aIdx] = newPl;
        afterEvolve = addLog({ ...afterEvolve, players: newPlayers },
          `黑暗脈衝：${evoCard.name} 身上放置 4 個傷害指示物`,
          (1 - aIdx) as 0 | 1);
      }
    }

    return afterEvolve;
  }

  // ── 撤退 ──────────────────────────────────────────────────────────────────
  if (action.type === 'RETREAT') {
    if (state.turnPhase !== 'main') return state;
    if (attacker.retreatedThisTurn) return state;
    if (!attacker.active) return state;
    // v2.187：化石卡卡面明確「無法撤退」
    if (attacker.active.fossilOnField) return state;
    // 睡眠和麻痺時無法撤退
    if (attacker.active.status === 'asleep' || attacker.active.status === 'paralyzed') return state;
    // 招式效果「下個對手回合無法撤退」— cantRetreatNextTurn flag（v1.62）
    if (attacker.active.cantRetreatNextTurn) return state;
    // v2.174 霍米加的演奏 — 對手玩家在我方下個回合的中毒寶可夢無法撤退
    // 套用點：actor 自己的 cantRetreatIfPoisonedThisTurn + active 中毒（含 secondaryStatus）→ 阻擋
    if (attacker.cantRetreatIfPoisonedThisTurn
        && (attacker.active.status === 'poisoned' || attacker.active.secondaryStatus === 'poisoned' || attacker.active.tertiaryStatus === 'poisoned')) {
      return state;
    }

    // v2.360 黏美龍｜黏滑失足 — 對手場上有此特性，撤退前擲幣，反面撤退失敗
    // 規則：「這個特性的效果不會重複」— 只要至少 1 隻黏美龍有此特性即觸發，不疊加。
    {
      const hasStickFoot = [
        ...(defender.active ? [defender.active] : []),
        ...defender.bench,
      ].some(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '黏滑失足'));
      if (hasStickFoot) {
        const r = flipCoinsWithLog(state, 1, '黏滑失足', aIdx);
        if (!r.heads) {
          // v5.638：反面撤退失敗，但仍消耗「本回合撤退」→ 不可重按再擲（修無限重擲 exploit：
          //   原本反面直接 return 未設 retreatedThisTurn，玩家可一直按撤退一直擲到正面）。
          const failSt = addLog(r.state, '黏滑失足：反面 → 撤退所需能量不丟棄，不進行互換', aIdx);
          const fp = [...failSt.players] as [PlayerState, PlayerState];
          fp[aIdx] = { ...fp[aIdx], retreatedThisTurn: true };
          return { ...failSt, players: fp };
        }
        state = r.state; // 正面：繼續正常撤退流程
      }
    }
    if (attacker.bench.length === 0) return state;

    const bIdx = attacker.bench.findIndex(c => c.iid === action.newActiveIid);
    if (bIdx < 0) return state;

    const activeCard = pool.get(attacker.active.cardId);
    // v5.473：撤退費收斂到中央 computeActiveRetreatCostFor（道具/特殊能量/重力之玉/天空徑線/
    //   競技場/ABILITY_RETREAT_MOD/鼓擊 全在中央一處算；改撤退費修正只改中央即可，免漏修）。
    const retreatCost = computeActiveRetreatCostFor(state, aIdx, pool);
    // v2.69：撤退成本用「能量單位」比對，不是卡片張數。火箭隊能量 1 張 = 2 units。
    // v2.108：傳 state+aIdx 讓大竺葵繁茂套上（基本【草】能量 = 2 units）。
    if (totalEnergyUnits(attacker.active.energyAttached, pool, state, aIdx, attacker.active) < retreatCost) return state;

    // v2.63：若撤退需丟 ≥1 個能量，且附加能量包含多種屬性（或不同單位結構的特殊能量），
    // 開 pendingSelection 讓玩家選要丟哪幾個能量；否則沿用自動丟棄。
    // 判定「多屬性」：以每張能量的 type signature（sort 後 join）做 set，size ≥ 2 才問。
    // v2.69：即使單一屬性，只要有多單位能量（火箭隊能量）混合單單位能量，仍需問玩家。
    if (retreatCost > 0 && attacker.active.energyAttached.length > 0) {
      const typeSig = (iid: string): string => {
        const inst = attacker.active!.energyAttached.find(e => e.iid === iid);
        if (!inst) return '';
        const card = pool.get(inst.cardId);
        // v5.324: subtype prefix — 區隔基本 vs 特殊能量, 確保特殊能量(伏特【雷】等)
        //   即使 unit types 跟基本同 (如伏特【雷】= ['Lightning'] = 基本【雷】)
        //   也視為不同 signature → sigs.size >= 2 → 開 picker 讓玩家選, 不會被自動丟掉.
        //   玩家反映: 基本雷 3 + 伏特【雷】 1, 撤退 2 被自動丟 1 基本 + 1 特殊, 應 picker.
        const subtypePrefix = card?.subtype === 'Special' ? 'S:' : 'B:';
        const units = getEnergyUnits(inst.cardId, pool);
        if (units.length === 0) return subtypePrefix + (card?.name ?? 'unknown');
        // 多單位（如火箭隊能量）與單純基本能量視為不同 signature
        return subtypePrefix + units.map(u => [...u.types].sort().join(',')).sort().join('|');
      };
      const sigs = new Set(attacker.active.energyAttached.map(e => typeSig(e.iid)));
      if (sigs.size >= 2) {
        return {
          ...state,
          pendingSelection: {
            type: 'active-energy-discard',
            actorIdx: aIdx,
            sourcePlayerIdx: aIdx,
            // v2.69：改為 units-aware — minCount/maxCount 僅控制卡片張數邊界，
            // 實際「總單位數 ≥ retreatCost」由 UI selectionValid 檢查 params.retreatCost。
            // v5.140：maxCount 改 min(attached.length, retreatCost) — Wilson 反應
            //   picker label「選 1~2 張」+「已選 2」誤導（呱呱泡蛙 retreatCost=1）。
            //   修法精確：最壞情況每張 1 unit，最多需 retreatCost 張，限 attached 上限。
            //   selectionValid (v3.823 essential check) 仍會嚴格擋多丟，但 label 不再誤導。
            minCount: 1,
            maxCount: Math.min(attacker.active.energyAttached.length, retreatCost),
            effectKey: 'retreat-energy-discard',
            params: { newActiveIid: action.newActiveIid, retreatCost },
          },
        };
      }
    }

    // 自動丟棄能量（單屬性 or retreatCost=0，無需詢問）。
    // v2.69：從後方取，累積 units 直到 ≥ retreatCost；火箭隊能量 1 張 = 2 units。
    // v2.108：大竺葵繁茂時，基本【草】能量 1 張 = 2 units。
    const bloomOnR = hasBloomAbilityOnField(state, aIdx, pool);
    // v5.144：判 active 是否進化（給燃火能量倍率用 — 鏡射 totalEnergyUnits v5.125 邏輯）
    const activeCardForR = pool.get(attacker.active.cardId);
    const isActiveEvolutionForR = !!(activeCardForR && (activeCardForR.evolvesFrom
      || activeCardForR.stage === 'Stage1' || activeCardForR.stage === 'Stage2'
      || activeCardForR.subtype === 'Stage1' || activeCardForR.subtype === 'Stage2'));
    // v5.145：判 active 是否 Stage2（給新衝天能量倍率用）
    const isActiveStage2ForR = !!(activeCardForR && (activeCardForR.stage === 'Stage2' || activeCardForR.subtype === 'Stage2'));
    let paidUnits = 0;
    const keepE: CardInstance[] = [];
    const discardE: CardInstance[] = [];
    for (let i = attacker.active.energyAttached.length - 1; i >= 0; i--) {
      const e = attacker.active.energyAttached[i];
      if (paidUnits < retreatCost) {
        discardE.unshift(e);
        const ec = pool.get(e.cardId);
        if (bloomOnR && isBasicEnergyOfType(ec, 'Grass')) {
          paidUnits += 2;
        } else if (ec?.name === '燃火能量' && isActiveEvolutionForR) {
          // v5.144：燃火能量 on 進化寶可夢 = 3 units
          paidUnits += 3;
        } else if (ec?.name === '新衝天能量' && isActiveStage2ForR) {
          // v5.145：新衝天能量 on Stage2 寶可夢 = 2 units
          paidUnits += 2;
        } else {
          const units = getEnergyUnits(e.cardId, pool);
          paidUnits += units.length === 0 ? 1 : units.length;
        }
      } else {
        keepE.unshift(e);
      }
    }
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
    let retreatState: GameState = addLog(
      { ...state, players },
      `${attacker.name} 的 ${cardLink(retreatingPoke.iid, activeCard?.name ?? '?')} 撤退，${cardLink(newActive.iid, newActiveCard?.name ?? '?')} 上場！`,
      aIdx
    );

    // v5.852：撤退觸發(熔岩地域/漩渦言靈/凹洞)改由 applyActionImpl 中央偵測統一處理(涵蓋所有 self-swap)。

    // v3.05 Deferred Wave A — 自身寶可夢從戰鬥場回備戰時觸發類特性（ON_RETREAT_TO_BENCH）
    //   觸發點：retreatingPoke 已從戰鬥場回到 bench；此時詢問玩家是否使用對應特性。
    //   範圍：海豚俠｜全能變身、鋼炮臂蝦｜返回重載 等列在 ON_RETREAT_TO_BENCH_ABILITIES Set 中的特性。
    //   注意：retreatingPoke 在 bench 中（refresh from retreatState 取最新副本）；
    //         需檢查 abilityUsedThisTurn 旗標避免同回合再觸發。
    //   並發保證：modal-choice 期間 engine 鎖其他 action（pendingSelection 已設）→ 不會 race。
    {
      const cur = retreatState.players[aIdx];
      const benchInst = cur.bench.find(c => c.iid === retreatingPoke.iid);
      if (benchInst && !benchInst.abilityUsedThisTurn) {
        const benchCard = pool.get(benchInst.cardId);
        if (benchCard?.abilities) {
          for (let i = 0; i < benchCard.abilities.length; i++) {
            const ab = benchCard.abilities[i];
            if (!ON_RETREAT_TO_BENCH_ABILITIES.has(ab.name)) continue;
            const abilityKey = `${benchCard.name}|${i}`;
            // 確認 ABILITY_EFFECTS 有註冊（避免無對應 fn 也彈 modal）
            // v4.4995：用 helper（by-name 優先 fallback by-index）
            if (!hasAbilityFn(benchCard.name, ab.name, i)) continue;
            // v5.754：回備戰特性也受對手特性消除影響(bench 位→初始化/黏著束縛;暗夜羽擊只擋 active 不影響)
            //   — 同 v5.751/v5.753 的 isAbilityHolderEffective gate。
            if (!isAbilityHolderEffective(retreatState, benchInst, benchCard, aIdx, ab.name, 'bench', pool)) continue;
            // 詢問玩家使用 → 回傳含 pendingSelection 的 state，玩家選 yes 後走 resolver
            retreatState = askUseRetreatToBenchAbility(
              retreatState, aIdx, benchInst, ab.name, abilityKey, benchCard.name);
            // 一次只詢問 1 個（同一隻寶可夢通常只有 1 個觸發特性）
            break;
          }
        }
      }
    }
    // v5.243：自方換位 ON_PROMOTE_TO_ACTIVE prompt — 改用統一 helper
    retreatState = tryPromptPromoteActive(retreatState, aIdx, pool);
    return retreatState;
  }

  // ── 打出訓練家牌（含道具卡 Tool 和競技場 Stadium）──────────────────────────
  if (action.type === 'PLAY_TRAINER') {
    if (state.turnPhase !== 'main') return state;
    const hIdx = attacker.hand.findIndex(c => c.iid === action.iid);
    if (hIdx < 0) return state;
    const trainerInst = attacker.hand[hIdx];
    const trainerCard = pool.get(trainerInst.cardId);
    if (!trainerCard) return state;

    const isTool = trainerCard.supertype === 'Trainer' && trainerCard.subtype === 'PokemonTool';
    const isTrainer = trainerCard.supertype === 'Trainer';
    if (!isTool && !isTrainer) return state;

    // 支援者限制：每回合只能打 1 張
    if (trainerCard.subtype === 'Supporter' && attacker.supporterPlayedThisTurn) return state;
    // 先攻玩家第一回合不能使用支援者（PTCG 2020+ 規則）
    // 卡面「先攻玩家的最初回合也可使用」的支援者可 bypass（例：火箭隊的蘭斯、丹瑜）
    if (
      trainerCard.subtype === 'Supporter' &&
      state.isFirstTurn &&
      aIdx === state.firstPlayerIdx &&
      !canPlaySupporterOnFirstTurn(trainerCard)
    ) return state;
    // Wave 39：玩家級物品 / 支援者鎖（例：含羞苞｜癢癢花粉、吼叫尾ex｜絕叫、電蜘蛛ex｜雷擊石）
    if (trainerCard.subtype === 'Item' && attacker.cantPlayItemThisTurn) return state;
    if (trainerCard.subtype === 'Supporter' && attacker.cantPlaySupporterThisTurn) return state;
    // v2.362 班基拉斯｜威迫目光 — 對手戰鬥場有此特性（且未被消除）時，本方無法使出物品卡
    // v5.222：改用 hasAbilityOnActive helper (Rule 18)
    if (trainerCard.subtype === 'Item'
        && hasAbilityOnActive(state, (1 - aIdx) as 0 | 1, pool, '威迫目光')) {
      return state;
    }
    // v2.322：蓋諾賽克特｜ACE消弭 — 對手有附道具的蓋諾賽克特時，不能打 ACE SPEC
    if (trainerCard.tags?.includes('ACE SPEC') && isAceCancelActive(state, aIdx, pool)) return state;

    // 義務性前置檢查：夜間擔架棄牌為空、寶可夢交替備戰為空等情況禁止打出
    // v3.01 Wave 3 — 對手戰鬥場特性禁止本方打出 trainer
    // ① 大王銅象｜爆大身軀 — 對手戰鬥場有 → 我方無法使出『競技場』卡
    if (trainerCard.subtype === 'Stadium' && state.players[aIdx].cantPlayStadiumThisTurn) {
      return addLog(state, `${trainerCard.name}：本回合被「燒灼大地」效果禁止使出競技場`, aIdx);
    }
    if (trainerCard.subtype === 'Stadium' && isOppStadiumPlayBlocked(state, aIdx, pool)) {
      return addLog(state,
        `${attacker.name} 因對手「爆大身軀」效果，無法從手牌使出競技場卡`, aIdx);
    }
    // ② 胖嘟嘟ex｜海之詛咒 — 對手戰鬥場有 → 我方無法使出『物品』卡也無法附『寶可夢道具』
    if ((trainerCard.subtype === 'Item' || trainerCard.subtype === 'PokemonTool')
        && isOppItemPlayBlocked(state, aIdx, pool)) {
      return addLog(state,
        `${attacker.name} 因對手「海之詛咒」效果，無法從手牌使出物品卡或附上寶可夢道具`, aIdx);
    }

    if (!canPlayTrainer(trainerCard.name, state, aIdx, pool)) return state;

    // 移出手牌
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);

    if (trainerCard.subtype === 'Stadium') {
      // 一回合只能打出一張競技場卡（不論目前場上有無 stadium）
      const played = state.stadiumPlayedThisTurn ?? [false, false];
      // v3.851: 昂主花葉蒂卡面明文「使出了『稜鏡塔』的回合也可放置於場上」
      //   → 繞過「每回合 1 張 Stadium」通則的特例。當本回合已打過稜鏡塔（prismFlag=true）
      //   時，允許再打出昂主花葉蒂（同回合第 2 張 Stadium）。打完後 newPlayed[aIdx]=true 仍生效，
      //   所以玩家不會繼續打第 3 張。
      const prismFlag = state.prismTowerPlayedThisTurn ?? [false, false];
      const isAonzhuExempt = trainerCard.name === '昂主花葉蒂' && prismFlag[aIdx];
      if (played[aIdx] && !isAonzhuExempt) return state;
      // v2.41：PTCG 規則 — 同名競技場不能覆蓋自己
      // 場上已有同名競技場（例：對戰圓形競技場）時，禁止再從手牌打出同名的競技場。
      // 回傳到原 state 之前把已移出手牌的卡放回（線上 Stadium branch 在 `attacker.hand = ...` 之後執行）。
      const prevStadium = state.activeStadium;
      if (prevStadium) {
        const prevCard = pool.get(prevStadium.cardId);
        if (prevCard?.name === trainerCard.name) {
          // 還原手牌：上方已 filter 掉該張，這裡直接 return 原 state（hand 未實際 commit 到 state）
          return addLog(state, `規則：場上已有相同名稱的競技場（${trainerCard.name}），無法重複打出`, aIdx);
        }
      }
      // v2.244 stadium 換新時，舊 stadium 應丟回原擁有者棄牌堆（不一定是 attacker）
      if (prevStadium) {
        const prevOwnerIdx = state.activeStadiumOwnerIdx ?? aIdx;
        if (prevOwnerIdx === aIdx) {
          attacker.discard = [...attacker.discard, prevStadium];
        } else {
          players[prevOwnerIdx] = {
            ...players[prevOwnerIdx],
            discard: [...players[prevOwnerIdx].discard, prevStadium],
          };
        }
      }
      players[aIdx] = attacker;
      const newPlayed: [boolean, boolean] = [played[0], played[1]];
      newPlayed[aIdx] = true;
      // v3.811 Bug fix：新競技場剛打出 → 重置「本回合競技場效果已使用」flag。
      //   PTCG 規則：競技場主動效果是「每回合 1 次」per stadium（非 per player）。
      //   舊邏輯只在 END_TURN reset，導致「先用舊競技場 → 覆蓋新競技場」時新場無法使用。
      //   範例（玩家回報）：先用壯偉碩木進化 → 打出衝浪海灘 → 無法用衝浪海灘交換水寶。
      //   只 reset aIdx 那側（打出競技場的玩家），對手側不變。
      const usedNow = state.stadiumUsedThisTurn ?? [false, false];
      const newUsedReset: [boolean, boolean] = [usedNow[0], usedNow[1]];
      newUsedReset[aIdx] = false;
      // v3.85: 打出稜鏡塔時 set flag，給昂主花葉蒂 gate 用（即使後續被覆蓋本回合仍生效）
      const prevPrismFlag = state.prismTowerPlayedThisTurn ?? [false, false];
      const newPrismFlag: [boolean, boolean] = [prevPrismFlag[0], prevPrismFlag[1]];
      if (trainerCard.name === '稜鏡塔') newPrismFlag[aIdx] = true;
      let newState: GameState = {
        ...state, players,
        activeStadium: trainerInst,
        activeStadiumOwnerIdx: aIdx, // v2.244 標記擁有者
        stadiumPlayedThisTurn: newPlayed,
        stadiumUsedThisTurn: newUsedReset,
        prismTowerPlayedThisTurn: newPrismFlag,
      };
      newState = addLog(newState, `${attacker.name} 打出競技場：${cardLink(trainerInst.iid, trainerCard.name)}！`, aIdx);
      newState = clearFestivalVenueProtectedStatuses(newState, pool);
      const effectFn = TRAINER_EFFECTS.get(trainerCard.name);
      if (effectFn) newState = effectFn(newState, aIdx, pool, trainerInst);
      // v4.497：Stadium 進場改變 getEffectiveHP（例：引力山岳 Stage 2 -30、阻礙之塔取消道具 HP 加成）
      //   PTCG 規則：場地卡進場立即生效，超 HP 寶可夢應同時昏厥。
      //   原本要等下一個 action（attack/ability）才 sanityKOSweep — 玩家回報引力山岳沒立刻 KO。
      //   雙邊各掃一次（stadium 影響雙方場上，prize 各自歸屬）：
      //   - 掃對手 (dIdx)，prize 歸我 aIdx
      //   - 掃我方 (aIdx)，prize 歸對手 1-aIdx（若我自己 Stage 2 也超 HP）
      newState = sanityKOSweep(newState, aIdx, pool);
      if (newState.phase !== 'game-over') {
        newState = sanityKOSweep(newState, (1 - aIdx) as 0 | 1, pool);
      }
      return newState;
    }

    if (isTool) {
      // 道具卡：不先棄置，效果 resolver 會將它附加到寶可夢
      players[aIdx] = attacker;
      let newState: GameState = { ...state, players };
      const effectFn = TRAINER_EFFECTS.get(trainerCard.name);
      if (effectFn) return effectFn(newState, aIdx, pool, trainerInst);
      // v3.04 hotfix: 道具卡 fallback — 沒註冊 effect 也至少把卡放回手牌（不要悶聲刪卡！）
      //   原本邏輯：log「未實裝」→ 卡片消失（attacker.hand 已先移除 trainerInst）。
      //   實際遇到的案例：璀璨結晶 / 反擊增幅器 等 inline-handled 道具，effect 寫在 engine.ts
      //   inline 而非 TRAINER_EFFECTS Map → fallback 觸發 → 卡片直接從手牌消失！
      //   現在的設計：即使沒效果註冊，也把卡放回手牌（玩家可重試或當試錯處理）。
      const restoredAttacker = { ...attacker, hand: [...attacker.hand, trainerInst] };
      const restored = [...newState.players] as [PlayerState, PlayerState];
      restored[aIdx] = restoredAttacker;
      return addLog(
        { ...newState, players: restored },
        `${trainerCard.name}（道具）：找不到 attach 效果註冊，已退回手牌（請通報開發者修補 ATTACH_TOOL_NAMES）`,
        aIdx,
      );
    }

    // 一般訓練家（物品 / 支援者）
    attacker.discard = [...attacker.discard, trainerInst];
    if (trainerCard.subtype === 'Supporter') {
      attacker.supporterPlayedThisTurn = true;
      // v2.57：名稱含「火箭隊」的支援者 → 同時記 rocketSupporterPlayedThisTurn，供「火箭隊的工廠」gate 使用。
      if (trainerCard.name.includes('火箭隊')) {
        attacker.rocketSupporterPlayedThisTurn = true;
      }
      // v2.160：tags 含「古代」的支援者 → 記 ancientSupporterPlayedThisTurn，供「地盤崩壞」條件用
      if ((trainerCard.tags ?? []).includes('古代')) {
        attacker.ancientSupporterPlayedThisTurn = true;
      }
    }
    // v2.78 莊嚴之劍 — 記錄支援者 tags 到 GameState.supporterTagsUsedThisTurn[aIdx]
    let v278SupTagsToAdd: string[] = [];
    if (trainerCard.subtype === 'Supporter' && (trainerCard.tags ?? []).length > 0) {
      v278SupTagsToAdd = trainerCard.tags!;
    }
    players[aIdx] = attacker;

    let newState: GameState = { ...state, players };
    if (v278SupTagsToAdd.length > 0) {
      const cur = newState.supporterTagsUsedThisTurn ?? { p1: [], p2: [] };
      const newSup = {
        p1: aIdx === 0 ? [...cur.p1, ...v278SupTagsToAdd] : cur.p1,
        p2: aIdx === 1 ? [...cur.p2, ...v278SupTagsToAdd] : cur.p2,
      };
      newState = { ...newState, supporterTagsUsedThisTurn: newSup };
    }

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

    // 月光丘陵 — 丟 1 張基本【超】能量 → 全體回 30 HP
    // v2.40 bug fix：原本 gate 用 name.includes('超') + filter: 'Energy' 會把
    // 感應【超】能量等 Special Energy 也列為可選。正確語義只限「基本【超】能量」：
    // supertype=Energy && subtype=Basic && name.includes('【超】')。
    if (stadiumCard.name === '月光丘陵') {
      const p = newState.players[aIdx];
      const energyInHand = p.hand.filter(inst => {
        const c = pool.get(inst.cardId);
        return c?.supertype === 'Energy' && c?.subtype === 'Basic' && !!c?.name?.includes('【超】');
      });
      if (energyInHand.length === 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '月光丘陵：手牌中沒有基本【超】能量', aIdx);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 1, maxCount: 1, filter: 'BasicPsychicEnergy',
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
      // v2.63 root-fix：此前誤用 `{ ...players }` 展開 → 變成 `{0:P,1:P}` 物件（非陣列），
      // 下一個 reducer 的 `[...state.players]` 會 throw / 被誤當空陣列 → 整個 game state 被清空。
      // 必須用 `[...players]` 陣列展開才能保持 tuple 形態。
      const updated = [...newState.players] as [PlayerState, PlayerState];
      const p = { ...updated[aIdx] };
      if (p.active) p.active = { ...p.active, damage: Math.max(0, p.active.damage - 10) };
      p.bench = p.bench.map(c => ({ ...c, damage: Math.max(0, c.damage - 10) }));
      updated[aIdx] = p;
      return addLog({ ...newState, players: updated }, '居民會館：自己寶可夢各回 10 HP', aIdx);
    }

    // v2.57 火箭隊的工廠 — 這回合打過名稱含「火箭隊」的支援者才能用，抽 2 張
    if (stadiumCard.name === '火箭隊的工廠') {
      if (!newState.players[aIdx].rocketSupporterPlayedThisTurn) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '火箭隊的工廠：本回合還沒打出「火箭隊」支援者', aIdx);
      }
      // v2.63 root-fix：`{ ...players }` 會把 tuple 變成 {0:P,1:P} 普通物件，
      // Svelte 5 reactivity 會把 players 重新包成 Proxy，下一輪 reducer 的
      // `[...state.players]` 會拿到空陣列（普通物件非 iterable），整個 UI 就停擺。
      // Leon 回報「按鈕按了沒抽卡」的真相：hand 實際有 +2（localState 有更新），
      // 但下一次任何 action 都回傳 `state`（未修改）→ 在 UI 看起來像什麼都沒發生。
      const updated = [...newState.players] as [PlayerState, PlayerState];
      const p = { ...updated[aIdx] };
      const drawCount = Math.min(2, p.deck.length);
      if (drawCount === 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '火箭隊的工廠：牌庫已空', aIdx);
      }
      const drawn = p.deck.slice(0, drawCount);
      p.hand = [...p.hand, ...drawn];
      p.deck = p.deck.slice(drawCount);
      updated[aIdx] = p;
      return addLog({ ...newState, players: updated }, `火箭隊的工廠：從牌庫抽 ${drawCount} 張`, aIdx);
    }

    // v4.895 化石採掘場（M5）— 雙方每回合 1 次，從牌庫選 ≤2 張「陳舊的」物品卡放備戰，重洗
    // v4.896：filter 由 '古老的' 校正為 '陳舊的'（與既有 5 張化石命名一致 — 7 張全找）
    if (stadiumCard.name === '化石採掘場') {
      const p = newState.players[aIdx];
      const benchLimit = getBenchLimit(newState, aIdx, pool);
      const slots = benchLimit - p.bench.length;
      if (slots <= 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '化石採掘場：備戰區已滿', aIdx);
      }
      if (p.deck.length === 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '化石採掘場：牌庫為空', aIdx);
      }
      const maxN = Math.min(2, slots);
      // Rule 14：即使牌庫無「陳舊的」化石符合，仍開 picker（牌庫透露機制）
      // resolver 端處理實際的「Item + name 含『陳舊的』」filter，並轉換為 fossil bench inst
      return {
        ...newState,
        pendingSelection: {
          type: 'deck-search',
          actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 0, maxCount: maxN,
          filter: 'NameContains:陳舊的',
          effectKey: 'm5-fossil-excavation',
          params: {},
        },
      };
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
      // v5.767：§17.41.F 官方裁定 — 卡面「若丟棄1張能量卡，則可抽卡直到手牌張數＝場上【超】數」。
      //   只有「丟 1 張能量後會實際抽到 ≥1 張」時才可使用，否則白丟能量＝不可使用：
      //     - 丟 1 張後手牌變 (hand-1)，抽到 = 【超】數 → 抽張數 = psychicCount-(hand-1)；
      //       要 ≥1 即 psychicCount ≥ hand（hand 含待丟那張能量）。手牌已 ≥【超】數 → 抽 0 → 不可用(#2)。
      //     - 場上無【超】寶可夢 → psychicCount=0 < hand → 同式擋下(#3)。牌庫沒有卡 → 不可用(#4)。
      const allFieldMG = [...(player.active ? [player.active] : []), ...player.bench];
      const psychicCountMG = allFieldMG.filter(pk => pool.get(pk.cardId)?.pokemonType === 'Psychic').length;
      if (player.deck.length === 0 || psychicCountMG < player.hand.length) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog(
          { ...state, stadiumUsedThisTurn: revert },
          player.deck.length === 0
            ? '神秘花園：牌庫沒有卡可抽，無法使用'
            : '神秘花園：手牌張數已達場上【超】寶可夢數量，丟棄能量也抽不到卡，無法使用',
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

    // v2.102 稜鏡塔 — 棄 2 張手牌 → 抽 1 張
    if (stadiumCard.name === '稜鏡塔') {
      if (newState.players[aIdx].hand.length < 2) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '稜鏡塔：手牌不足 2 張', aIdx);
      }
      if (newState.players[aIdx].deck.length === 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '稜鏡塔：牌庫已空', aIdx);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 2, maxCount: 2, filter: '',
          effectKey: 'prism-tower-draw1', params: {},
        },
      };
    }

    // v2.171 慶祝開場樂 — 雙方每回合 1 次：自己所有寶可夢各回 10 HP，使用後回合結束
    if (stadiumCard.name === '慶祝開場樂') {
      const updated = [...newState.players] as [PlayerState, PlayerState];
      const p = { ...updated[aIdx] };
      const all = [...(p.active ? [p.active] : []), ...p.bench];
      if (!all.some(c => c.damage > 0)) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '慶祝開場樂：沒有寶可夢需要回血', aIdx);
      }
      if (p.active) p.active = { ...p.active, damage: Math.max(0, p.active.damage - 10) };
      p.bench = p.bench.map(c => ({ ...c, damage: Math.max(0, c.damage - 10) }));
      updated[aIdx] = p;
      return addLog({ ...newState, players: updated, turnPhase: 'end' as const },
        '慶祝開場樂：自己所有寶可夢回 10 HP — 此回合結束', aIdx);
    }

    // v2.171 城鎮百貨公司 — 雙方每回合 1 次：從牌庫選 1 張寶可夢道具加手牌並重洗
    if (stadiumCard.name === '城鎮百貨公司') {
      return {
        ...newState,
        pendingSelection: {
          type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 0, maxCount: 1, filter: 'PokemonTool',
          effectKey: 'town-department-tool', params: {},
        },
      };
    }

    // v2.171 深缽鎮 — 雙方每回合 1 次：從牌庫選 1 張【基礎】寶可夢（非規則）放備戰並重洗
    // v5.040：bench >= 5 改 getBenchLimit 支援零之大空洞 + 太晶 (5→8)
    if (stadiumCard.name === '深缽鎮') {
      if (newState.players[aIdx].bench.length >= getBenchLimit(newState, aIdx, pool)) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '深缽鎮：備戰區已滿', aIdx);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 0, maxCount: 1, filter: 'BasicNonRule',
          effectKey: 'deepbasin-place', params: {},
        },
      };
    }

    // v2.211 壯偉碩木（H）— 雙方每回合 1 次：從牌庫選 1 張可進化的【1階】寶可夢
    //   放到對應的場上【基礎】身上完成進化；若進化了，可繼續選 1 張【2階】放上去
    //   完成第二段進化。並重洗牌庫。
    if (stadiumCard.name === '壯偉碩木') {
      // v3.877：state.turn===1 涵蓋雙方各自第 1 動作回合 — 都擋（與活力森林、風扇呼喚一致）
      //   雖然 setup 寶可夢都是 justPlaced 會被 filter 擋掉效果，仍顯式擋以求一致 + 阻止 stadiumUsedThisTurn 浪費。
      if (state.turn === 1) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '壯偉碩木：自己的最初回合無法進化', aIdx);
      }
      // 場上有效 base（非 justPlaced / evolvedThisTurn）
      const ap = newState.players[aIdx];
      const fieldPokemon: CardInstance[] = [
        ...(ap.active ? [ap.active] : []),
        ...ap.bench,
      ];
      const evoBaseNames = new Set<string>();
      const evoBaseIids: string[] = [];
      for (const fp of fieldPokemon) {
        if (fp.justPlaced || fp.evolvedThisTurn) continue;
        const fpCard = pool.get(fp.cardId);
        if (!fpCard) continue;
        evoBaseNames.add(fpCard.name);
        evoBaseIids.push(fp.iid);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 0, maxCount: 1, filter: 'SturdyMightTree:Stage1',
          effectKey: 'sturdy-might-tree-step1',
          params: { baseNames: Array.from(evoBaseNames), baseIids: evoBaseIids },
        },
      };
    }

    // v2.172 釀光市（I）— 雙方每回合 1 次：棄牌搜 ≤2 基本【雷】能量加手牌
    if (stadiumCard.name === '釀光市') {
      const validIids = newState.players[aIdx].discard
        .filter(c => {
          const card = pool.get(c.cardId);
          return card?.supertype === 'Energy' && card.subtype === 'Basic'
            && (card.name?.includes('【雷】') ?? false);
        })
        .map(c => c.iid);
      if (validIids.length === 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '釀光市：棄牌區沒有基本【雷】能量', aIdx);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 0, maxCount: Math.min(2, validIids.length),
          filter: 'BasicEnergy',
          effectKey: 'lighting-city-pick',
          params: { validIids },
        },
      };
    }

    // v2.172 衝浪海灘（I）— 雙方每回合 1 次：戰鬥場【水】↔備戰【水】互換
    if (stadiumCard.name === '衝浪海灘') {
      const player = newState.players[aIdx];
      const activeCard = player.active ? pool.get(player.active.cardId) : null;
      if (!player.active || activeCard?.pokemonType !== 'Water') {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '衝浪海灘：戰鬥場不是【水】寶可夢', aIdx);
      }
      const waterBenchIids = player.bench
        .filter(c => pool.get(c.cardId)?.pokemonType === 'Water')
        .map(c => c.iid);
      if (waterBenchIids.length === 0) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '衝浪海灘：備戰沒有【水】寶可夢', aIdx);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 1, maxCount: 1,
          effectKey: 'surf-beach-swap',
          params: { validIids: waterBenchIids },
        },
      };
    }

    // v2.172 密阿雷市（J）— 雙方每回合 1 次：牌庫搜 1 基礎放備戰，使用後回合結束
    // v5.040：bench >= 5 改 getBenchLimit 支援零之大空洞 + 太晶 (5→8)
    if (stadiumCard.name === '密阿雷市') {
      if (newState.players[aIdx].bench.length >= getBenchLimit(newState, aIdx, pool)) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '密阿雷市：備戰區已滿', aIdx);
      }
      return {
        ...newState,
        pendingSelection: {
          type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
          minCount: 0, maxCount: 1,
          filter: 'Basic',
          effectKey: 'miarey-city-place',
          params: {},
        },
      };
    }

    // 尖釘鎮道館 — 從牌庫選 1 張「瑪俐的」寶可夢加手牌並重洗
    // v2.70：即便牌庫沒有「瑪俐的」寶可夢也要開 UI（玩家可藉此查看牌庫內容），
    //       所以 minCount 設為 0 允許確認無選擇，候選數量不做 gate。
    if (stadiumCard.name === '尖釘鎮道館') {
      return {
        ...newState,
        pendingSelection: {
          type: 'deck-search',
          actorIdx: aIdx,
          sourcePlayerIdx: aIdx,
          minCount: 0,
          maxCount: 1,
          filter: 'MarniePokemon',
          effectKey: 'spikemuth-marnie-search',
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

    const pokeCard = pool.get(targetPoke.cardId);
    const ability = pokeCard?.abilities?.[action.abilityIndex];
    if (!ability) return state;

    // 檢查是否已用過特性（不限次數特性跳過）
    if (targetPoke.abilityUsedThisTurn && !UNLIMITED_USE_ABILITY_NAMES.has(ability.name)) return state;

    // 集客（米立龍）限制：只有在出場時才能使用
    if (ability.name === '集客' && attacker.active?.iid !== action.iid) return state;

    // 精神抽出（勇基拉 / 胡地）/ 龐克練肌（瑪俐的長毛巨魔ex）/ 搜尋寶石（貓頭夜鷹）：
    // 必須「本回合剛進化成此階段」才能使用（evolvedThisTurn）。
    // v5.706：「進化時可用1次」特性(ON_EVOLVE_FROM_HAND_ABILITIES 全 24 個)後端一律 gate evolvedThisTurn
    //   (原僅硬編 5 個，漏合金建造/大力捕捉器/增長繭/亂咬等 19 個→後端可在非剛進化發動)。
    if (ON_EVOLVE_FROM_HAND_ABILITIES.has(ability.name) && !targetPoke.evolvedThisTurn) {
      return state;
    }

    // 腎上腺腦力（願增猿）：身上必須附有至少 1 顆【惡】能量才能使用。
    if (ability.name === '腎上腺腦力' && (countEnergy(targetPoke, pool).get('Darkness') ?? 0) < 1) {
      return state;
    }

    // v5.519 土龍節節｜逃跑抽出 — 官方 Q&A：自己牌庫為 0 張時不能使用（特性需先從牌庫抽 3 張）。
    if (ability.name === '逃跑抽出' && attacker.deck.length === 0) {
      return state;
    }

    // 火箭隊的監視塔：場上此 Stadium 時，【無】屬寶可夢的特性全部消除
    if (isColorlessAbilityBlocked(state, pokeCard, pool)) return state;

    // 初始化（鐵荊棘ex）：遮蔽 rule box 寶可夢的特性
    if (isInitializeBlocking(state, targetPoke, pool)) {
      return addLog(state, `${pokeCard!.name} 的特性「${ability.name}」被初始化消除`, aIdx);
    }

    // 可達鴨｜濕氣：自身 KO 類特性被消除
    if (SELF_KO_ABILITY_NAMES.has(ability.name) && isSelfKOEffectBlocked(state, pool)) {
      return addLog(state, `${pokeCard!.name} 的特性「${ability.name}」被可達鴨的濕氣消除`, aIdx);
    }

    // v2.91 → v2.93 修正：同名特性一回合共享 1 次 — 只對白名單套用
    // 卡面含「在使用了其他的『XX』的回合，此特性無法使用」才屬此類（例：月光循環 / 使者衝刺）。
    // v2.91 原作為全局 gate，導致兩隻土龍節節同回合想用「逃跑抽出」時第二隻被誤擋 — v2.93 以白名單限定。
    if (
      SHARED_ONCE_PER_TURN_ABILITY_NAMES.has(ability.name)
      && attacker.abilityNamesUsedThisTurn?.includes(ability.name)
    ) {
      return state;
    }

    // v2.91 使者衝刺（超級袋獸ex）：戰鬥場限定
    if (ability.name === '使者衝刺' && attacker.active?.iid !== action.iid) {
      return state;
    }

    // v2.91 月光循環（月石）：場上需有「太陽岩」+ 手牌需有 1 張基本【鬥】能量
    if (ability.name === '月光循環') {
      const field = [...(attacker.active ? [attacker.active] : []), ...attacker.bench];
      const hasSunstone = field.some(c => pool.get(c.cardId)?.name === '太陽岩');
      if (!hasSunstone) return state;
      const hasFightEnergy = attacker.hand.some(c => {
        const cc = pool.get(c.cardId);
        return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
          && (cc.name?.includes('【鬥】') ?? false);
      });
      if (!hasFightEnergy) return state;
    }

    // 查找 ABILITY_EFFECTS
    // v4.4995：先查 by-name (新)，fallback by-index (舊)
    const abilityFn = getAbilityFn(pokeCard!.name, ability.name, action.abilityIndex);
    if (!abilityFn) return state;

    // v2.362 振翼髮｜暗夜羽擊 — 若特性被消除，無法使用
    if (targetPoke?.abilityNullifiedThisTurn) {
      return addLog(state, `${pokeCard!.name} 的特性「${ability.name}」已被消除，無法使用`, aIdx);
    }
    // v3.01 Wave 3 — 振翼髮｜暗夜羽擊（passive）/ 海兔獸｜黏著束縛 — dispatch 時也擋
    if (targetPoke && pokeCard) {
      const ownerLoc: 'active' | 'bench' = state.players[aIdx].active?.iid === targetPoke.iid ? 'active' : 'bench';
      if (isAbilityNullifiedByPassive(state, aIdx, targetPoke, pokeCard, ability.name, ownerLoc, pool)) {
        return addLog(state, `${pokeCard.name} 的特性「${ability.name}」被對手特性消除，無法使用`, aIdx);
      }
    }

    // 標記已使用（不限次數特性跳過）
    const updatedPlayers = [...state.players] as [PlayerState, PlayerState];
    const updatedP = { ...updatedPlayers[aIdx] };
    if (!UNLIMITED_USE_ABILITY_NAMES.has(ability.name)) {
      const markUsed = (c: CardInstance): CardInstance =>
        c.iid === action.iid ? { ...c, abilityUsedThisTurn: true } : c;
      updatedP.active = updatedP.active ? markUsed(updatedP.active) : null;
      updatedP.bench = updatedP.bench.map(markUsed);
    }
    // v2.91 → v2.93 修正：只有白名單特性（月光循環/使者衝刺）才記錄到
    // abilityNamesUsedThisTurn；一般特性的「每回合 1 次」由 per-instance
    // 的 abilityUsedThisTurn flag 負責。
    if (SHARED_ONCE_PER_TURN_ABILITY_NAMES.has(ability.name)) {
      updatedP.abilityNamesUsedThisTurn = [
        ...(updatedP.abilityNamesUsedThisTurn ?? []),
        ability.name,
      ];
    }
    updatedPlayers[aIdx] = updatedP;

    let newState: GameState = addLog(
      { ...state, players: updatedPlayers },
      `${attacker.name} 使用了 ${pokeCard!.name} 的特性「${ability.name}」！`,
      aIdx
    );
    // 傳入觸發此特性的 CardInstance（以 iid 辨識），避免 ability 實作用
    // name 掃場而在「同回合多隻同名寶可夢發動」時誤中第一隻。
    return abilityFn(newState, aIdx, pool, targetPoke);
  }

  // ── v3.07 Deferred Wave D — 從手牌棄 1 張卡觸發場上特性 ────────────────────
  //   - 超能妙喵｜誘導之尾：棄「悠哉尾草棒」→ 對手備戰 ↔ 戰鬥位互換
  //   - 火神蛾｜熱浪鱗粉：棄「基本【火】能量」→ 對手戰鬥位灼傷
  //   每回合限 1 次（用 abilityNamesUsedThisTurn 追蹤該特性名）。
  if (action.type === 'USE_HAND_DISCARD_ABILITY') {
    if (state.turnPhase !== 'main') return state;
    if (state.pendingSelection) return state;

    const triggerName = action.triggerCardName;
    const fn = ON_DISCARD_FROM_HAND_ABILITIES.get(triggerName);
    if (!fn) return state;

    // gate: 自方場上有 trigger holder
    if (!hasFieldPokemonByName(attacker, triggerName, pool)) return state;
    const triggerInst = findFieldPokemonByName(attacker, triggerName, pool);
    if (!triggerInst) return state;

    // 取對應的 ability name（取首個有 effect 的特性）
    const triggerCard = pool.get(triggerInst.cardId);
    const triggeredAbilityName = triggerCard?.abilities?.[0]?.name;
    if (!triggeredAbilityName) return state;

    // gate: 該 ability 名稱本回合已用過 → 拒絕
    const usedNames = attacker.abilityNamesUsedThisTurn ?? [];
    if (usedNames.includes(triggeredAbilityName)) return state;

    // gate: discardIid 在手牌
    const handIdx = attacker.hand.findIndex(c => c.iid === action.discardIid);
    if (handIdx < 0) return state;
    const discardInst = attacker.hand[handIdx];
    const discardCard = pool.get(discardInst.cardId);
    if (!discardCard) return state;

    // gate: 各 trigger 名稱對應該卡需符合的條件
    if (triggerName === '超能妙喵') {
      if (discardCard.name !== '悠哉尾草棒') return state;
      if (!defender.active || defender.bench.length === 0) return state;
    } else if (triggerName === '火神蛾') {
      if (discardCard.supertype !== 'Energy' || discardCard.subtype !== 'Basic') return state;
      if (!(discardCard.name?.includes('【火】') ?? false)) return state;
      if (!defender.active) return state;
      if (hasStatusInAnySlot(defender.active, 'burned')) return state; // v5.842 跨三槽:已灼傷(任一槽)則不重複
    }

    // 執行：先把該手牌移入棄牌區 → 標記 → log → call fn
    const newHand = [...attacker.hand];
    newHand.splice(handIdx, 1);
    const newPlayers0: [PlayerState, PlayerState] = [...state.players] as [PlayerState, PlayerState];
    const updatedAttacker: PlayerState = {
      ...attacker,
      hand: newHand,
      discard: [...attacker.discard, discardInst],
      abilityNamesUsedThisTurn: [...usedNames, triggeredAbilityName],
    };
    newPlayers0[aIdx] = updatedAttacker;

    const triggerCardName = pool.get(triggerInst.cardId)?.name ?? triggerName;
    const sLog = addLog(
      { ...state, players: newPlayers0 },
      `${attacker.name} 將「${discardCard.name}」從手牌丟棄，發動 ${triggerCardName} 的特性「${triggeredAbilityName}」！`,
      aIdx
    );
    return fn(sLog, aIdx, pool, triggerInst);
  }

  // ── v3.07 Deferred Wave D — 手牌寶可夢自身為 trigger（USE_HAND_ABILITY） ─────
  //   - 齒輪怪｜緊急迴轉：手牌的這張卡為條件 + 對手場上有 Stage 2 → 放這張卡到備戰
  //   每回合限 1 次（用 abilityNamesUsedThisTurn 追蹤該特性名）。
  if (action.type === 'USE_HAND_ABILITY') {
    if (state.turnPhase !== 'main') return state;
    if (state.pendingSelection) return state;

    const handIdx = attacker.hand.findIndex(c => c.iid === action.cardIid);
    if (handIdx < 0) return state;
    const handInst = attacker.hand[handIdx];
    const handCard = pool.get(handInst.cardId);
    if (!handCard) return state;

    const fn = ON_HAND_ACTIVATE_ABILITIES.get(handCard.name);
    if (!fn) return state;

    const abilityName = handCard.abilities?.[action.abilityIndex]?.name;
    if (!abilityName) return state;

    // gate: 該 ability 名稱本回合已用過 → 拒絕
    const usedNames = attacker.abilityNamesUsedThisTurn ?? [];
    if (usedNames.includes(abilityName)) return state;

    // gate: 各卡名專屬條件
    // v5.898：同名多特性消歧義——齒輪怪有「緊急迴轉」(SV7,放備戰)與「齒輪塗層」(Stage2 被動減傷)兩版,
    //   ON_HAND_ACTIVATE_ABILITIES 以卡名 key→齒輪塗層版(Stage2)也被曝露緊急迴轉(把 Stage2 從手牌放備戰=非法)。
    //   改判「這張卡實際有緊急迴轉特性」才放行。
    if (handCard.name === '齒輪怪') {
      if (!(handCard.abilities?.some(a => a.name === '緊急迴轉') ?? false)) return state;
      if (!oppHasStage2(defender, pool)) return state;
      if (attacker.bench.length >= getBenchLimit(state, aIdx, pool)) return state;
    }

    // 標記 abilityNamesUsedThisTurn → fn 處理 hand → bench
    const newPlayers1: [PlayerState, PlayerState] = [...state.players] as [PlayerState, PlayerState];
    newPlayers1[aIdx] = {
      ...attacker,
      abilityNamesUsedThisTurn: [...usedNames, abilityName],
    };
    const sLog = addLog(
      { ...state, players: newPlayers1 },
      `${attacker.name} 從手牌發動 ${handCard.name} 的特性「${abilityName}」！`,
      aIdx
    );
    return fn(sLog, aIdx, pool, handInst);
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
        log: [...state.log, { turn: state.turn, playerIndex: null, message: `${attacker.name} 無法抽牌，${defender.name} 獲勝！`, timestamp: Date.now() }]
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

    // v5.079：蓋諾賽克特|ACE消弭 — 對手有附道具的蓋諾賽克特時，不能附 ACE SPEC 能量
    //   原 L2699 只擋 PLAY_TRAINER 路徑的 ACE SPEC trainer 卡，沒擋 ATTACH_ENERGY
    //   路徑的 ACE SPEC 能量（新衝天能量 / 古舊能量 / 富裕能量等），玩家回報。
    {
      const energyCardObj = pool.get(energyCard.cardId);
      if (energyCardObj?.tags?.includes('ACE SPEC') && isAceCancelActive(state, aIdx, pool)) {
        return addLog(state,
          `${attacker.name} 因對手「ACE消弭」效果，無法附加 ACE SPEC 能量「${energyCardObj.name}」`,
          aIdx);
      }
    }

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
    let afterAttach: GameState = addLog(
      { ...state, players },
      `${attacker.name} 將能量附加到 ${cardLink(target.iid, targetCard.name)}`,
      aIdx
    );
    // v2.22：特殊能量「附加時」hook（例：富裕能量抽 4、感應【超】能量搜【超】基本）
    const energyName = getCard(energyCard.cardId, pool).name;
    const attachHook = SPECIAL_ENERGY_ATTACH.get(energyName);
    if (attachHook) {
      afterAttach = attachHook(afterAttach, aIdx, target.iid, pool);
    }
    // v5.539：對手附能反應收斂到中央 fireOnHandEnergyAttached（侵蝕詛咒 OPP_ENERGY_ATTACH_PASSIVE
    //   + 麻痺門牙）。所有「從手牌附能」路徑（手動 ATTACH_ENERGY + 特性/招式填能）共用同一函式，
    //   避免特性填能漏觸發（玩家報耿鬼ex侵蝕詛咒對碧綠之舞等沒生效）。白日夢 END_TURN 留在下方。
    afterAttach = fireOnHandEnergyAttached(afterAttach, aIdx as 0 | 1, target.iid, pool);
    // v2.78 引夢貘人｜白日夢 — defender 有 endTurnOnOppAttachEnergyThisTurn → 對手回合結束
    if (target.endTurnOnOppAttachEnergyThisTurn) {
      const newPlayers2 = [...afterAttach.players] as [PlayerState, PlayerState];
      const updateInst = (c: CardInstance): CardInstance => {
        if (c.iid !== target!.iid) return c;
        const n = { ...c };
        delete n.endTurnOnOppAttachEnergyThisTurn;
        return n;
      };
      newPlayers2[aIdx] = {
        ...newPlayers2[aIdx],
        active: newPlayers2[aIdx].active && newPlayers2[aIdx].active!.iid === target.iid ? updateInst(newPlayers2[aIdx].active!) : newPlayers2[aIdx].active,
        bench: newPlayers2[aIdx].bench.map(updateInst),
      };
      afterAttach = addLog({ ...afterAttach, players: newPlayers2 }, '[白日夢]對手附能量於受招式者 → 對手回合結束（一次性，flag 清除）', aIdx);
      return applyAction(afterAttach, { type: 'END_TURN' }, pool);
    }
    // v3.0 瑪機雅娜｜自動治癒 — 戰鬥場上有此卡時，附能量到任何寶可夢 → 該寶可夢恢復 90 HP。
    //   只看 attacher（aIdx）戰鬥位是否為持有者；若是，找到 target 寶可夢 inst 對 damage -90（不低於 0）。
    {
      const healAmt = magearnaAutoHealAmount(afterAttach, aIdx, pool);
      if (healAmt > 0) {
        const newPlayersHeal = [...afterAttach.players] as [PlayerState, PlayerState];
        const updateHeal = (c: CardInstance): CardInstance => {
          if (c.iid !== target!.iid) return c;
          const newDmg = Math.max(0, (c.damage ?? 0) - healAmt);
          return { ...c, damage: newDmg };
        };
        newPlayersHeal[aIdx] = {
          ...newPlayersHeal[aIdx],
          active: newPlayersHeal[aIdx].active && newPlayersHeal[aIdx].active!.iid === target.iid
            ? updateHeal(newPlayersHeal[aIdx].active!) : newPlayersHeal[aIdx].active,
          bench: newPlayersHeal[aIdx].bench.map(updateHeal),
        };
        const targetCardName = pool.get(target.cardId)?.name ?? '?';
        afterAttach = addLog({ ...afterAttach, players: newPlayersHeal },
          `「自動治癒」啟動：${targetCardName} 恢復 ${healAmt} HP`, aIdx);
      }
    }
    // v4.996: 先 sweep 自方場面清除「附泡沫【水】能量後身上既有特殊狀態」（卡面後半句）
    afterAttach = clearSpecialEnergyProtectedStatuses(afterAttach, aIdx, pool);
    return clearFestivalVenueProtectedStatuses(afterAttach, pool);
  }

  // ── 宣告招式 ──────────────────────────────────────────────────────────────
  if (action.type === 'ATTACK') {
    if (state.turnPhase !== 'main') return state;
    // v5.769：每次攻擊開頭清「被KO戰鬥位能量快照」（戲法舞步/反轉之風 KO 分支用）。
    state = { ...state, _koDefenderSnapshot: null };
    // v5.211：祭典樂舞第 2 次必須使用相同招式（卡面「使用持有的招式 2 次」）
    if (state.festivalDancePendingSecondAttack
        && state.festivalDancePendingSecondAttack.idx === aIdx
        && action.attackIndex !== state.festivalDancePendingSecondAttack.attackIndex) {
      return addLog(state, '祭典樂舞：第 2 次必須使用相同招式（或點結束回合跳過）', aIdx);
    }
    // v3.0 美洛耶塔ex｜出道演出 — 此寶可夢可在先手第 1 回合使用招式（解除限制）
    const meloettaBypassFirstTurn = state.isFirstTurn && aIdx === state.firstPlayerIdx
      && hasMeloettaExDebut(attacker.active, pool);
    // v5.214 Bug 3：招式自身標記「在先攻玩家的最初回合也可使用」（信使鳥|急速之禮 / 卡璞・鳴鳴|急速飛行）
    let attackBypassFirstTurn = false;
    if (state.isFirstTurn && aIdx === state.firstPlayerIdx && attacker.active) {
      const atks_ft = getEffectiveAttacks(state, attacker.active, pool);
      const atkName_ft = atks_ft[action.attackIndex]?.atk.name ?? '';
      if (FIRST_TURN_USABLE_ATTACKS.has(atkName_ft)) attackBypassFirstTurn = true;
    }
    if (state.isFirstTurn && aIdx === state.firstPlayerIdx && !meloettaBypassFirstTurn && !attackBypassFirstTurn) return state; // 先手第 1 回合不能攻擊
    if (!attacker.active) return state;
    if (!defender.active) return state;

    // v5.010：bench-fill 招式（呼朋引伴等）defense-in-depth — UI 沒灰透過 sim/AI 仍可送來，
    //   此處擋下避免 resolver `.slice` 截斷把寶可夢丟失。
    {
      const atkCard0 = pool.get(attacker.active.cardId);
      const atkList0 = getEffectiveAttacks(state, attacker.active, pool);
      const atk0 = atkList0[action.attackIndex]?.atk;
      if (atk0 && BENCH_FILL_ATTACK_NAMES.has(atk0.name)) {
        const benchLimit0 = getBenchLimit(state, aIdx, pool);
        if (attacker.bench.length >= benchLimit0) {
          return addLog(state, `${atkCard0?.name ?? '?'}｜${atk0.name}：備戰區已滿，無法使用此招式`, aIdx);
        }
      }
    }

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
    // 特殊狀態：混亂 — 擲硬幣，反面自身受 30 傷害且攻擊失敗
    // v2.182：補上「自傷致 KO」流程 — 30 自傷可能讓寶可夢昏厥（HP ≤ 30 + 已有傷害指示物）
    if (attacker.active.status === 'confused') {
      const flipResult = flipCoinsWithLog(state, 1, '混亂', aIdx);
      state = flipResult.state;
      const coin = flipResult.heads === 1;
      if (!coin) {
        const selfDmg = (attacker.active.damage ?? 0) + (attacker.active.confusionSelfDamageCounters ?? 3) * 10; // v5.679 自傷指示物可被改寫(錯亂閃光=8)
        const atkHP = getEffectiveHP(attacker.active, pool, state);
        const atkCard = pool.get(attacker.active.cardId);
        if (atkHP > 0 && selfDmg >= atkHP) {
          // 混亂自傷致 KO → 對手取獎賞
          const koDiscard: CardInstance[] = [
            { ...attacker.active, damage: selfDmg },
            ...attacker.active.energyAttached,
            ...getAllAttachedTools(attacker.active),
            ...(attacker.active.evolvedFromStack ?? []),
          ];
          const newAttacker: PlayerState = {
            ...attacker,
            discard: [...attacker.discard, ...koDiscard],
            active: null,
          };
          players[aIdx] = newAttacker;
          const koPrizes = atkCard ? prizesForKO(atkCard) : 1;
          // v5.882：取獎收斂到中央 addPendingPrize(與一般 KO 一致):有正面朝上獎賞開逐張 picker 讓
          //   取獎方選、私訊揭示取得的卡名(對手看張數)、取完獎賞勝負判定。原 direct-slice 繞過此三者。
          let s = addLog({ ...state, players, turnPhase: 'end' as const },
            `${atkNameForStatus} 陷入混亂，自身受到 30 傷害並昏厥！`, aIdx);
          s = addPendingPrize(s, dIdx, koPrizes, pool);
          if (s.phase === 'game-over') return s;  // addPendingPrize 內部已判「取完所有獎賞獲勝」
          if (newAttacker.bench.length === 0) {
            return { ...s, phase: 'game-over', winner: dIdx, winReason: `${newAttacker.name} 沒有可上場的寶可夢` };
          }
          return s;  // active=null → UI 自動 popup SEND_NEW_ACTIVE(prize picker 未解時會被 gate 擋到取完)
        }
        // 沒 KO：扣 30 傷然後 turnPhase=end
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
    // v2.997 請假王ex｜懶怠個性 — 對手場上沒有 ex/V 時無法使用招式
    if (isLazyTraitBlockingAttack(attacker.active, state, pool)) {
      const atkName = pool.get(attacker.active.cardId)?.name ?? '?';
      return addLog(
        { ...state, players, turnPhase: 'end' },
        `${atkName} 因「懶怠個性」效果，對手場上沒有寶可夢【ex】・【V】，無法使用招式！`,
        aIdx
      );
    }

    // 潑沙 / 墨汁噴射類：下次使用招式時擲 N 次硬幣，只要有反面則招式失敗。
    if (attacker.active.attackFailureFlipCountThisTurn && attacker.active.attackFailureFlipCountThisTurn > 0) {
      const flipCount = attacker.active.attackFailureFlipCountThisTurn;
      let s = state;
      let hasTails = false;
      for (let i = 1; i <= flipCount; i++) {
        const heads = Math.random() < 0.5;
        if (!heads) hasTails = true;
        s = addLog(s, `干擾命中判定：第 ${i}/${flipCount} 次擲硬幣 — ${heads ? '正面' : '反面'}`, aIdx);
      }
      const nextActive = { ...attacker.active };
      delete nextActive.attackFailureFlipCountThisTurn;
      players[aIdx] = { ...attacker, active: nextActive };
      if (hasTails) {
        return addLog({ ...s, players, turnPhase: 'end' }, '干擾命中判定：出現反面，招式失敗！', aIdx);
      }
      state = addLog({ ...s, players }, '干擾命中判定：全部正面，招式繼續', aIdx);
    }

    // v2.92：單招下回合禁用（例：超級勇氣）
    // 檢查當前招式名是否在 blockedAttackNamesThisTurn 中 → 禁用
    // v2.214：用 effective list（含工具招式）
    {
      const attackIdx = action.attackIndex;
      const eff = getEffectiveAttacks(state, attacker.active, pool);
      const attackDef = eff[attackIdx]?.atk;
      const attackName = attackDef?.name;
      const atkName = pool.get(attacker.active.cardId)?.name ?? '?';
      if (attackName && attacker.active.blockedAttackNamesThisTurn?.includes(attackName)) {
        return addLog(state,
          `${atkName} 因上回合效果，本回合無法使用「${attackName}」`,
          aIdx);
      }

      // v5.967 玩家層級招式冷卻(天仙石)：自己全場任一隻上個自己回合用過此招 → 禁用(卡面「自己的寶可夢」)。
      //   讀中央 attackUsedLastSelfTurn(招式結算自動蓋章、不隨撤退/換位/離場清除)，涵蓋撤退再回、第二張同名卡。
      if (attackName && PLAYER_LEVEL_ATTACK_COOLDOWN.has(attackName)) {
        const _ownP = state.players[aIdx];
        const _usedByOwn = [_ownP.active, ..._ownP.bench].some((c) => c?.attackUsedLastSelfTurn === attackName);
        if (_usedByOwn) {
          return addLog(state,
            `${atkName}：上個自己的回合已使用過「${attackName}」，本回合無法使用`,
            aIdx);
        }
      }

      // v2.219 — 後攻方最初回合限定招式（吼叫尾ex｜絕叫 等）
      // 卡面：「這個招式只可在後攻玩家的最初回合使用。」
      // 條件：state.isFirstTurn && aIdx 是後攻方（!= firstPlayerIdx）
      if (attackName && SECOND_PLAYER_FIRST_TURN_ONLY.has(attackName)) {
        const isSecondPlayer = aIdx !== state.firstPlayerIdx;
        if (!state.isFirstTurn || !isSecondPlayer) {
          return addLog(state,
            `${atkName}：「${attackName}」只能在後攻方最初回合使用`,
            aIdx);
        }
      }
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

    // v2.57 火箭隊的超夢ex｜力量抑制者 — 自己場上「火箭隊的」寶可夢 < 4 時無法使用招式
    {
      const actCard = pool.get(attacker.active.cardId);
      if (actCard?.name === '火箭隊的超夢ex' && actCard.abilities?.some(a => a.name === '力量抑制者')) {
        const allOwn: CardInstance[] = [attacker.active, ...attacker.bench];
        const rocketCount = allOwn.filter(c => pool.get(c.cardId)?.name?.startsWith('火箭隊的')).length;
        if (rocketCount < 4) {
          return addLog(
            state,
            `${actCard.name} 力量抑制者：自己場上「火箭隊的」寶可夢只有 ${rocketCount} 隻（未達 4 隻），無法使用招式`,
            aIdx
          );
        }
      }
    }

    const attackerCard = getCard(attacker.active.cardId, pool);
    // v2.214：合併工具招式（招式學習器 螢石 / 核心記憶碟 等）
    //   - 招式 source 為 tool 時，effectKey 用 tool 名（非 attackerCard 名）
    //   - 阻礙之塔下 tool 失效 → getEffectiveAttacks 已過濾
    const eff = getEffectiveAttacks(state, attacker.active, pool);
    const effEntry = eff[action.attackIndex];
    if (!effEntry) return state;
    const attack = effEntry.atk;
    const sourceName = effEntry.sourceCardName;
    const isToolAttack = effEntry.isFromTool;

    // 確認能量足夠（v2.103 傳 state+aIdx 讓 canAffordAttack 能判定大竺葵繁茂 / 燃火能量倍率）
    // v2.127 多傳 attack.name 讓 canAffordAttack 能判定 酋雷姆｜反等離子 條件式減費
    // v2.78 凍結獠牙 — 全場低能量鎖招（player-level）
    if (state.lowEnergyCantAttackThisTurn?.[aIdx]
        && totalEnergyUnits(attacker.active.energyAttached, pool, state, aIdx, attacker.active) <= 2) {
      // v5.250：必須設 turnPhase='end' 強制進入 end phase，否則 AI 反覆 retry attack 造成無限迴圈
      //   玩家回報：對手用含羞苞癢癢花粉後 AI 想攻擊但能量 ≤ 2 觸發凍結獠牙 lock → 卡住
      return addLog({ ...state, turnPhase: 'end' as const },
        '[凍結獠牙]能量 ≤ 2 的寶可夢無法使用招式（自動進入結束階段）', aIdx);
    }
    if (!canAffordAttack(attacker.active, attack.cost, pool, state, aIdx, attack.name)) return state;

    // v4.898 重試徽章：snapshot pre-ATTACK 狀態（用於玩家選「重擲」時 revert）
    // 並 clear coinFlippedThisAttack flag（flipCoinsWithLog 若被呼叫會設回 true）
    // v5.165：同時 clear _machineGunLastFlips（避免上一招式殘留誤觸 modal 顯示）
    const preAttackStateForRetry: GameState = state;
    // v5.262：ATTACK 開頭 clear coinFlippedThisAttack + _machineGunLastFlips
    //   _retryInjectedFlipsQueue 在「玩家選 keep 重跑」路徑由 keep handler 已設好, 此處 ATTACK 開頭
    //   只清 queue 若不是 retry-replay (action._retryBadgeAlreadyAsked !== true).
    const isRetryReplay = action._retryBadgeAlreadyAsked === true;
    state = {
      ...state,
      coinFlippedThisAttack: false,
      _attackerActiveBonusDone: false,  // v5.517 每次攻擊重置攻擊方加成 guard
      _machineGunLastFlips: undefined,
      // 重跑時保留 queue; 一般攻擊清空殘留 queue (防呆)
      _retryInjectedFlipsQueue: isRetryReplay ? state._retryInjectedFlipsQueue : undefined,
    };
    players[aIdx] = state.players[aIdx];
    players[(1-aIdx) as 0|1] = state.players[(1-aIdx) as 0|1];

    // ── 招式前置效果（修改傷害 / 丟棄能量等）────────────────────────────────
    // v2.214：tool 招式用 tool 名做 key（例：'招式學習器 螢石|螢石'）
    const effectKey = `${sourceName}|${attack.name}`;
    const preFn = ATTACK_PRE.get(effectKey);
    let workingState: GameState = { ...state, players };
    // v3.9994/v3.9995：UX 補強 — 璀璨結晶 cost -1 效果觸發時明確 addLog
    //   v3.9995 措辭調整：說明「玩家可選任意屬性」配對成功
    {
      const attackerCardForLog = pool.get(attacker.active.cardId);
      const isTeraForLog = attackerCardForLog?.tags?.includes('太晶');
      const toolsJammedForLog = isToolsJammed(state, pool);
      if (isTeraForLog && !toolsJammedForLog && attack.cost.length > 0) {
        for (const t of getAllAttachedTools(attacker.active)) {
          const tc = pool.get(t.cardId);
          if (tc?.name === '璀璨結晶') {
            workingState = addLog(workingState, '璀璨結晶：本招式所需能量 -1 個（任意屬性皆可，可彈性選擇免除哪一顆）', aIdx);
            break;
          }
        }
      }
    }
    let baseDamage = parseInt(attack.damage ?? '0', 10) || 0;
    // v2.92：回力鏢能量 revive 快照 — 用於招式效果後把被丟棄的回力鏢能量重附回原本寶可夢。
    // 卡面：「若因附有這張卡的寶可夢使用的招式的效果使這張卡被丟棄，
    //         則在招式的傷害與效果的影響之後，重新附於原本的寶可夢身上。」
    // 實作：snapshot 開打時 attacker.active 上所有「回力鏢能量」的 iids，
    //       regPre/regPost 結束後檢查這些 iids 是否被搬到 attacker 的棄牌區，
    //       若有 & attacker.active iid 未變 → 撤回棄牌、回附到 active.energyAttached。
    const boomerangSnapshotIids: string[] = attacker.active.energyAttached
      .filter(e => pool.get(e.cardId)?.name === '回力鏢能量')
      .map(e => e.iid);
    const boomerangAttackerActiveIid: string = attacker.active.iid;
    // v2.195 燃料【火】能量 revive 快照（卡面：「若因附有這張卡的【火】寶可夢
    // 使用的招式的效果使這張卡被丟棄，則在招式的傷害與效果的影響之後，這張卡
    // 放回手牌。」）
    // 條件：attacker.active 是【火】寶可夢 + 身上有燃料【火】能量。
    // 實作：snapshot 開打前 attacker.active 上所有「燃料【火】能量」iids；
    //       attack 結束後若這些 iid 出現在 attacker.discard，撈回 attacker.hand。
    const fuelFireSnapshotIids: string[] = attackerCard?.pokemonType === 'Fire'
      ? attacker.active.energyAttached
          .filter(e => pool.get(e.cardId)?.name === '燃料【火】能量')
          .map(e => e.iid)
      : [];
    // Session 33 引擎旗標：招式可聲明
    //   skipWeakRes    ：傷害不計算弱點 / 抵抗力（同時跳兩個 — 卡面「不計算弱點・抵抗力」）
    //   skipResistance ：(v4.495) 只跳抵抗力（卡面「不計算抵抗力」— 岩石投擲類）
    //   skipWeakness   ：(v4.495) 只跳弱點（卡面「不計算弱點」— 激怒咒詛類）
    //   skipDefEffects ：傷害不計算對手戰鬥寶可夢身上的「附加效果」
    //                    （含被動減傷特性、防禦道具、下次被攻擊 -N、條件式完全免疫）
    let skipWeakRes = false;
    let skipResistance = false;
    let skipWeakness = false;
    let skipDefEffects = false;
    // v2.992 PASSIVE_ATTACKER_BUFF（波盪水ex 藏青浪濤）— 攻擊者持有特性 → 自動 skipDefEffects
    if (attackerCard?.abilities) {
      for (const ab of attackerCard.abilities) {
        const buf = PASSIVE_ATTACKER_BUFF.get(ab.name);
        if (buf?.skipDefEffects) skipDefEffects = true;
      }
    }
    // v3.892：attack-time snapshot — 紀錄宣告當時對手場上是否有花之帷幔（謝米）。
    //   PTCG 規則「招式效果同時 resolve」— 即使謝米被招式 KO，攻擊宣告當時
    //   花之帷幔有效，備戰仍應免疫此招式傷害。POST 階段 defender.active 可能 KO=null，
    //   故需 snapshot 一個 transient flag 給 hitBenchPickPost / hitBenchAll 讀。
    const attackTimeOppFlowerVeil = hasFlowerVeil(state, dIdx, pool);
    workingState = { ...workingState, _attackTimeOppFlowerVeil: attackTimeOppFlowerVeil };
    // v5.987：美納斯|平穩境地 attack-time snapshot(比照花之帷幔)。宣告當時各玩家是否有生效平穩境地→
    //   即使美納斯被同一招式 KO，此招的回手效果(無限之影/潛者捕捉等)仍依宣告當時判定被擋。
    workingState = { ...workingState, _attackTimeCalmGround: [
      _hasCalmGround(state, 0, pool), _hasCalmGround(state, 1, pool),
    ] as [boolean, boolean] };
    // v5.186：抵抗之幕 同 pattern — 玩家回報多龍巴魯托ex 幻影奇襲 對戰急凍鳥時
    //   急凍鳥被 KO 後 6 個指示物還能放到備戰；規則上同招式 resolve 視為同時，
    //   攻擊宣告當時抵抗之幕生效，備戰「火箭隊的」基礎寶可夢仍應免疫此招式效果。
    const attackTimeOppRocketVeil = hasRocketVeil(state, dIdx, pool);
    workingState = { ...workingState, _attackTimeOppRocketVeil: attackTimeOppRocketVeil };
    // v5.237：球形盾牌 同 pattern — 對手戰鬥位蟲甲聖被幻影奇襲類 AOE 招式 KO 後，
    //   state 已沒蟲甲聖 → hasBugAegislashShield 返 false → 備戰失去保護。
    //   snapshot 攻擊宣告當時是否有球形盾牌 holder，resolveBenchGuard 內 OR fallback 讀。
    const attackTimeOppBugShield = hasBugAegislashShield(state, dIdx, pool);
    workingState = { ...workingState, _attackTimeOppBugShield: attackTimeOppBugShield };
    // v5.325 太古防壁 attack-time 能量快照 — 卡面「能量為 N 個以下」依【發動攻擊宣告時】
    //   攻擊方能量單位數計，不計入招式自身條件丟棄（判例：三重冰霜類自丟能量招式仍以開打前計）。
    const attackTimeAttackerEnergyUnits = totalEnergyUnits(attacker.active.energyAttached, pool, state, aIdx, attacker.active);
    workingState = { ...workingState, _attackTimeAttackerEnergyUnits: attackTimeAttackerEnergyUnits };

    // v3.03：preFn 可額外回傳 breakdown，把內部多步加法（如赫月瘋狂啃咬 7×30+100）
    //        展開為多個 term，UI 顯示更易懂。
    let preBreakdown: { value: number; label: string }[] | undefined;
    if (preFn) {
      const preResult = preFn(workingState, aIdx, pool, action);
      workingState = preResult.state;
      baseDamage = preResult.damage;
      if (preResult.skipWeakRes) skipWeakRes = true;
      if (preResult.skipResistance) skipResistance = true;  // v4.495
      if (preResult.skipWeakness) skipWeakness = true;      // v4.495
      if (preResult.skipDefEffects) skipDefEffects = true;
      if (preResult.breakdown && preResult.breakdown.length > 0) {
        preBreakdown = preResult.breakdown;
      }
    }

    // v3.02 傷害公式累積器 — 每個 modifier 點推一個 term，最後組合成可讀公式。
    //   sign: '=' 為基礎；'+' / '-' 為加減；'×' 為倍率（弱點 ×2 等）。
    //   value 為純數值（非倍率時）；倍率時 value 是倍數本身（×2 → value=2）。
    // v3.03：若 preFn 回傳 breakdown，第一項當 base，後續為 + term；否則沿用單一 base。
    type FormulaTerm = { sign: '=' | '+' | '-' | '×'; value: number; label: string };
    const formula: FormulaTerm[] = [];
    if (preBreakdown && preBreakdown.length > 0) {
      formula.push({ sign: '=', value: preBreakdown[0].value, label: preBreakdown[0].label });
      for (let i = 1; i < preBreakdown.length; i++) {
        formula.push({ sign: '+', value: preBreakdown[i].value, label: preBreakdown[i].label });
      }
    } else {
      formula.push({ sign: '=', value: baseDamage, label: '基礎' });
    }

    // 下回合加傷旗標（巨金怪 彗星拳、大電海燕 風力充能 類）—
    // 由前一個自己回合設下，至本回合起生效 1 次於 base damage 上，weakness 前套用。
    if (baseDamage > 0 && attacker.active.damageBonusThisTurn) {
      const dmgBonus = attacker.active.damageBonusThisTurn;
      baseDamage += dmgBonus;
      const newAtk = { ...attacker.active };
      // v5.226：祭典樂舞第一次攻擊不消耗 flag，留給第二次攻擊同樣套用
      if (!_isFestivalDanceFirstAttack(state, aIdx, pool)) {
        delete newAtk.damageBonusThisTurn;
      }
      players[aIdx] = { ...players[aIdx], active: newAtk };
      workingState = { ...workingState, players };
      const atkName = pool.get(newAtk.cardId)?.name ?? '?';
      workingState = addLog(workingState, `${atkName} 招式傷害 +${dmgBonus}（回合加傷效果）`, aIdx);
      formula.push({ sign: '+', value: dmgBonus, label: '回合加傷' });
    }

    // 攻擊方自身的招式傷害削減旗標（由上回合對手的「吠」/「大聲咆哮」/「叫聲」等效果設置）
    // v3.22 BUG FIX：原本檢查 damageReduceNextHit 與 defender 端共用同一 field，
    //   會讓「自己用 selfDmgReducePost 設給自己下次被打 -N」的旗標被誤消耗 — 對手沒攻擊時，
    //   自己下回合出招就被 attacker-side check 吃掉 → 自己招式 -N（雷電獸 閃光射線 bug）。
    //   現分為兩個獨立 field：damageReduceNextHit (defender 端，自己被打 -N) /
    //   nextOwnAttackPenalty (attacker 端，自己出招 -N，由「叫聲/吠/咆哮」設給對手 active)。
    //   不受 skipDefEffects 影響，弱點計算前套用。
    if (baseDamage > 0 && attacker.active.nextOwnAttackPenalty) {
      const penalty = attacker.active.nextOwnAttackPenalty;
      baseDamage = Math.max(0, baseDamage - penalty);
      const newAtk = { ...attacker.active };
      // v5.226：祭典樂舞第一次攻擊不消耗
      if (!_isFestivalDanceFirstAttack(state, aIdx, pool)) {
        delete newAtk.nextOwnAttackPenalty;
      }
      players[aIdx] = { ...players[aIdx], active: newAtk };
      workingState = { ...workingState, players };
      const atkName2 = pool.get(newAtk.cardId)?.name ?? '?';
      workingState = addLog(workingState, `${atkName2} 招式傷害 -${penalty}（受招致使傷害削減效果）`, aIdx);
      formula.push({ sign: '-', value: penalty, label: '招致削傷' });
    }

    // v4.87 格拉吉歐的決戰（Supporter / M5）— player-level 本回合 +80（非規則寶可夢）
    //   gate: gladionDuelBonusThisTurn 由 reg() 設定，END_TURN 清除
    //   本檢查：attacker 為非規則寶可夢 → +80
    if (baseDamage > 0 && attacker.gladionDuelBonusThisTurn && !isRulePokemon(attackerCard)) {
      baseDamage += 80;
      workingState = addLog(workingState,
        `${attackerCard.name} 招式傷害 +80（格拉吉歐的決戰，非規則寶可夢加成）`, aIdx);
      formula.push({ sign: '+', value: 80, label: '格拉吉歐的決戰' });
    }

    // v4.87 伏特【雷】能量（M5 特殊能量）— 附加者為【雷】屬性寶可夢時 +20
    //   卡面：「附有這張卡的雷屬性寶可夢使用招式對對手戰鬥寶可夢 +20」
    //   v4.871：加 attacker.pokemonType === 'Lightning' gate（非雷屬性附了不生效）
    //   v5.022 修正：原本 `.some()` 只算 1 次 +20 — 玩家回報「附 3 顆 閃電【雷】只 +20」
    //     改 per-card stacking — 卡面「附有這張卡的」雖無「每張」字樣，但 PTCG 規則
    //     歷史對「同類加成型特殊能量」一律 per-card 累計（如銀色鋼能量 +10/張）。
    //   v5.022 順帶 rename '閃電能量' → '伏特【雷】能量'（卡面排版對齊規律）
    if (baseDamage > 0 && attackerCard.pokemonType === 'Lightning') {
      const lightningSECount = attacker.active.energyAttached.filter(e => pool.get(e.cardId)?.name === '伏特【雷】能量').length;
      if (lightningSECount > 0) {
        const bonus = 20 * lightningSECount;
        baseDamage += bonus;
        workingState = addLog(workingState,
          `${attackerCard.name} 招式傷害 +${bonus}（伏特【雷】能量 ${lightningSECount} 張 × 20，【雷】屬性）`, aIdx);
        formula.push({ sign: '+', value: bonus, label: `伏特【雷】能量×${lightningSECount}` });
      }
    }

    // ── v2.97：攻擊方 +N bonus 全部在 weakness 前套用（PTCG 規則） ───────────
    // 先前實作順序錯誤（bonus 於 weakness 後加）導致 Leon 實戰計算不符：
    //   270 × 2 + 60 = 600（錯）；正確 (270 + 60) × 2 = 660
    // 修正：把以下三個 attacker-side bonus 都移到 weakness 前套用。
    //   - TOOL_ATTACK_BONUS（極限腰帶 / 鎖鏈糬 / 驅勁能量 未來）
    //   - PASSIVE_ATTACK_BONUS（羅絲雷朵 輝煌聲援 等）
    //   - damageBoostFightingThisTurn（力量蛋白飲）
    // （damageBonusThisTurn 下回合加傷原本就在 weakness 前，位置不動。）
    const defenderCard = getCard(defender.active.cardId, pool);

    // 道具：我方攻擊 +N（極限腰帶 / 鎖鏈糬 / 驅勁能量 未來 / 猛攻手鐲 / 電氣球 / 活力頭帶 / 赫普的講究頭帶）
    // 阻礙之塔時全部失效。
    // v2.218 加 log — Leon 回報「極限腰帶 +50 沒生效」，加 log 讓未來能判斷
    //   是 fn 沒被呼叫、bonus=0、還是 weakness 順序問題。
    const toolsJammed = isToolsJammed(state, pool);
    if (!toolsJammed && baseDamage > 0) {
      // v3.20 多重轉接：iterate 所有道具
      for (const t of getAllAttachedTools(attacker.active)) {
        const atkTool = pool.get(t.cardId);
        if (!atkTool) continue;
        const fn = TOOL_ATTACK_BONUS.get(atkTool.name);
        if (!fn) continue;
        const bonus = fn(attackerCard, attacker.active, defenderCard, defender.active);
        if (bonus > 0) {
          baseDamage += bonus;
          workingState = addLog(workingState,
            `🔧 ${atkTool.name}：${attackerCard.name} 招式傷害 +${bonus}（${baseDamage - bonus} → ${baseDamage}）`,
            aIdx);
          formula.push({ sign: '+', value: bonus, label: atkTool.name });
        }
      }
    }

    // Wave 42：被動特性 +N 攻擊傷害（攻擊方場上）— 例如 竹蘭的羅絲雷朵｜輝煌聲援 對「竹蘭的」寶可夢 +30
    // P2-3 fix：「大方」等特性，明文「不重複」，需 dedup by ability name。
    // P2-4 fix：火箭隊的監視塔在場時，【無】寶可夢的被動特性應被消除。
    if (baseDamage > 0) {
      const attAll: CardInstance[] = [
        ...(attacker.active ? [attacker.active] : []),
        ...attacker.bench,
      ];
      // v2.42 Bug 修正：原本所有 PASSIVE_ATTACK_BONUS 都 dedup by ability name（一張只算 1 次），
      //   但卡面語意只有「大方」等明確規定不疊加。其他如「輝煌聲援」應隨場上同名張數疊加
      //   （e.g. 2 隻竹蘭的羅絲雷朵 → +60）。改成只 dedup PASSIVE_ATTACK_NO_STACK 中的特性。
      const processedNoStackNames = new Set<string>();
      for (const inst of attAll) {
        const c = pool.get(inst.cardId);
        if (!c?.abilities) continue;
        // P2-4: 監視塔壓制【無】寶可夢的被動特性
        if (isColorlessAbilityBlocked(state, c, pool)) continue;
        for (const ab of c.abilities) {
          const fn = PASSIVE_ATTACK_BONUS.get(ab.name);
          if (!fn) continue;
          if (!isAbilityHolderEffective(state, inst, c, aIdx, ab.name, attacker.active?.iid === inst.iid ? 'active' : 'bench', pool)) continue; // v5.471 holder 特性消除
          // 卡面明文「不重複」的特性 dedup by name；其他特性每隻場上寶可夢都獨立加成
          if (PASSIVE_ATTACK_NO_STACK.has(ab.name) && processedNoStackNames.has(ab.name)) continue;
          // v2.133：簽名擴充 — 把 defenderCard 也傳進去（複眼 等需要看對手卡）
          // v2.278：再擴 state / aIdx / pool — 讓「大將（依對手獎賞數）」「激動力量
          //         （場上有 Darkness Mega ex）」這類依場上局勢的特性能拿到資訊
          const bonus = fn(attackerCard, defenderCard, workingState, aIdx, pool);
          if (bonus > 0) {
            if (PASSIVE_ATTACK_NO_STACK.has(ab.name)) processedNoStackNames.add(ab.name);
            baseDamage += bonus;
            workingState = addLog(workingState, `「${ab.name}」啟動：${attackerCard.name} 招式傷害 +${bonus}`, aIdx);
            formula.push({ sign: '+', value: bonus, label: ab.name });
          }
        }
      }
    }

    // Wave 42：玩家級「本回合自己的【鬥】寶可夢招式傷害 +N」（例：力量蛋白飲）
    // 多次使用會累加（每張 +30）。在 weakness 前套用（PTCG 規則 — v2.97 修正）。
    if (baseDamage > 0 && attackerCard.pokemonType === 'Fighting' && attacker.damageBoostFightingThisTurn) {
      const b = attacker.damageBoostFightingThisTurn;
      baseDamage += b;
      workingState = addLog(workingState, `「力量蛋白飲」啟動：${attackerCard.name} 招式傷害 +${b}`, aIdx);
      formula.push({ sign: '+', value: b, label: '力量蛋白飲' });
    }

    // v2.113 夠讚狗｜腎上腺力量 — 若攻擊方自身（夠讚狗）附有【惡】能量，招式傷害 +100
    // v2.120：改用 countEnergy（host-aware），稜鏡能量在 Basic host 上也算惡能量
    if (baseDamage > 0 && attackerCard.name === '夠讚狗' && !!attacker.active && isAbilityHolderEffective(state, attacker.active, attackerCard, aIdx, '腎上腺力量', 'active', pool)) {
      const hasDark = (countEnergy(attacker.active, pool).get('Darkness') ?? 0) >= 1;
      if (hasDark) {
        baseDamage += 100;
        workingState = addLog(workingState, `「腎上腺力量」啟動：夠讚狗 招式傷害 +100`, aIdx);
        formula.push({ sign: '+', value: 100, label: '腎上腺力量' });
      }
    }

    // v3.76 化朗鎮（Stadium）— 雙方的「赫普的寶可夢」招式對對手戰鬥場 +30
    //   卡面：「雙方的『赫普的寶可夢』使用的招式，對對手的戰鬥寶可夢造成的傷害『+30』點」
    //   只在場上有此競技場 + 攻擊方名稱以「赫普的」開頭 + 有基礎傷害時觸發。
    if (baseDamage > 0 && attackerCard.name.startsWith('赫普的')) {
      const stadiumNameHelo = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
      if (stadiumNameHelo === '化朗鎮') {
        baseDamage += 30;
        workingState = addLog(workingState, `「化朗鎮」啟動：${attackerCard.name} 招式傷害 +30`, aIdx);
        formula.push({ sign: '+', value: 30, label: '化朗鎮' });
      }
    }

    // v2.113 空手道王的演練 — 本回合自己寶可夢招式對對手戰鬥場 ex +40
    if (baseDamage > 0 && attacker.karateKingBonusThisTurn && defenderCard?.subtype === 'ex') {
      baseDamage += 40;
      workingState = addLog(workingState, `「空手道王的演練」啟動：對 ${defenderCard.name}（ex）+40`, aIdx);
      formula.push({ sign: '+', value: 40, label: '空手道王演練' });
    }
    // v2.139 烏栗效果 2 — 本回合自方寶可夢招式對對手戰鬥場 ex/V +30
    if (baseDamage > 0 && attacker.unrudaBonusThisTurn && defenderCard) {
      const isExV = defenderCard.subtype === 'ex'
        || defenderCard.name.endsWith('ex')
        || defenderCard.name.endsWith('EX')
        || defenderCard.name.endsWith('V')
        || defenderCard.name.endsWith('VMAX')
        || defenderCard.name.endsWith('VSTAR');
      if (isExV) {
        baseDamage += 30;
        workingState = addLog(workingState, `「烏栗」啟動：對 ${defenderCard.name}（ex/V）+30`, aIdx);
        formula.push({ sign: '+', value: 30, label: '烏栗' });
      }
    }

    // v5.517：標記本次攻擊已於引擎主管線套過「攻擊方加成」→ 中央 helper(dealAttackDamageToTarget)
    //   對戰鬥位再結算傷害時不重複套(applyAttackerActiveDamageBonuses 的 guard)。
    //   baseDamage>0 才標記，讓 regPre=0(波動突刺等主傷害走中央 helper)的招式仍由中央 helper 補套。
    if (baseDamage > 0) workingState = { ...workingState, _attackerActiveBonusDone: true };

    // 弱點（×2）— 只對有實際傷害的招式套用。skipWeakRes 旗標跳過此計算。
    // v2.57：莉莉艾的皮皮ex｜妖精領域 — 我方場上有皮皮ex 時，對手【龍】寶可夢的弱點改為【超】。
    // 卡面允許「本無弱點」的龍寶可夢被加上【超】弱點。
    // v2.101：鋁鋼橋龍ex｜金屬防禦強化 — 本回合弱點失效（weaknessDisabledThisTurn）
    // v5.562 收斂：弱點屬性 + 攻擊方有效屬性改走共用 helper(與中央 dealAttackDamageToTarget 同一套)
    const _wk = getEffectiveWeaknessType(workingState, aIdx, defender.active, defenderCard, pool);
    const effectiveWeaknessType = _wk.type;
    const weaknessDisabled = _wk.disabled;
    const attackerEffectiveTypes = getAttackerEffectiveTypes(attacker.active, attackerCard, pool);
    // v4.495：弱點 gate 同時 check skipWeakRes (跳兩個) 與 skipWeakness (只跳弱點)
    if (!skipWeakRes && !skipWeakness && !weaknessDisabled && baseDamage > 0 && effectiveWeaknessType
        && attackerEffectiveTypes.includes(effectiveWeaknessType)) {
      baseDamage *= 2;
      formula.push({ sign: '×', value: 2, label: '弱點' });
    }
    // v2.78 密勒頓｜防護代碼 — 若 defender 有 immuneToExAttackTagThisTurn，
    //   且 attacker 是 ex + 帶有對應 tag，傷害變 0
    // v3.67：改用 isRulePokemon helper（涵蓋未來新規則寶可夢類型）
    // v5.124：打爆類「不計算 defender 身上附加效果」應 bypass — 加 !skipDefEffects gate
    // v5.828：卡面「寶可夢【ex】招式」= 任意 ex（不限 tag）。舊實作誤要求 attacker.tags.includes('未來')
    //   → 對一般 ex（無「未來」tag）完全不擋，防護代碼幾乎失效。flag 只設在受保護的「未來」寶可夢身上，
    //   故此處只需判 attacker 是規則寶可夢(ex)。
    if (!skipDefEffects && baseDamage > 0 && defender.active.immuneToExAttackTagThisTurn && isRulePokemon(attackerCard)) {
      workingState = addLog(workingState, `${defenderCard.name}：[防護代碼]免疫【ex】寶可夢招式傷害（${baseDamage} → 0）`, dIdx);
      baseDamage = 0;
    }
    // v2.260 Bug #1：抵抗力計算（PDF §I-A-01 步驟 4）
    //   若受擊方寶可夢卡面抵抗力屬性 === 攻擊方寶可夢屬性 → 套用 resistance.value（"-30" 等）。
    //   skipWeakRes 旗標同時跳過抵抗力計算（PDF §II-B-06「不計算弱點・抵抗力」）。
    //   弱點導致 baseDamage 翻倍後再扣抵抗力；若扣到 ≤0 則結束傷害計算（依 PDF）。
    //   未來若需「消除抵抗力」hook（如太陽岩 抵抗遮蔽），在此處加 effectiveResistance flag。
    const resistanceValue = defenderCard.resistance?.value;  // 形如 "-30"
    const resistanceType = defenderCard.resistance?.type;
    // v2.388 小碎鑽｜雙重屬性 — 抵抗力同步用 attackerEffectiveTypes
    // v4.495：抵抗力 gate 同時 check skipWeakRes (跳兩個) 與 skipResistance (只跳抵抗力)
    if (!skipWeakRes && !skipResistance && baseDamage > 0 && resistanceType && resistanceValue
        && attackerEffectiveTypes.includes(resistanceType)) {
      const resistDelta = parseInt(resistanceValue, 10);  // "-30" → -30
      if (!isNaN(resistDelta)) {
        baseDamage = Math.max(0, baseDamage + resistDelta);
        formula.push({ sign: '-', value: Math.abs(resistDelta), label: '屬性相剋' });
      }
    }
    // v2.101：鋁鋼橋龍｜塗層攻擊 / 超級雷電獸ex｜閃光射線
    //   本回合此卡不受【基礎】寶可夢招式傷害
    // 攻擊方 stage=Basic 且 defender 有 immuneToBasicAttackThisTurn → 傷害歸零（招式仍觸發其他 post 效果）
    // v5.124：打爆類「不計算 defender 身上附加效果」應 bypass — 加 !skipDefEffects gate
    //   玩家回報：厄鬼椪礎石面具ex|打爆 vs 超級雷電獸ex|閃光射線 沒造成傷害
    if (!skipDefEffects && baseDamage > 0
        && defender.active.immuneToBasicAttackThisTurn
        && (attackerCard.stage ?? attackerCard.subtype) === 'Basic'
        // v5.338：皇冠蛋白石「【無】寶可夢除外」— companion 在時，【無】屬攻擊者不擋
        && !(defender.active.basicImmuneColorlessExcept && attackerCard.pokemonType === 'Colorless')) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因塗層攻擊效果，不受【基礎】寶可夢招式傷害`, dIdx);
      baseDamage = 0;
    }
    // v5.885 鐵毒蛾|瘋狂拒絕 — defender 本回合不受「古代」寶可夢(attacker tags 含'古代')招式傷害。
    if (!skipDefEffects && baseDamage > 0
        && defender.active.immuneToAncientAttackThisTurn
        && (attackerCard.tags?.includes('古代'))) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因瘋狂拒絕效果，不受「古代」寶可夢招式傷害`, dIdx);
      baseDamage = 0;
    }

    // v2.174 阿塞蘿拉的惡作劇 — defender 在本回合「不受 ex 招式的傷害與效果」
    // 卡面同時涵蓋 PDF §C-16「不會受到招式的傷害」+ §C-17「不會受到招式的效果的影響」兩者。
    // 故下方同時把 baseDamage 清 0（C-16）並設 skipDefEffects（C-17）— 是故意的耦合，不是 bug。
    // 若未來新加只擋傷害不擋效果（純 C-16）或反之的卡，請拆成兩個獨立旗標。
    // v3.67：改用 isRulePokemon helper（涵蓋未來新規則寶可夢類型）
    const attackerIsEx = isRulePokemon(attackerCard);
    // v5.124：加 !skipDefEffects gate（打爆類 bypass）
    if (!skipDefEffects && baseDamage > 0
        && defender.active.immuneToExAttackThisTurn
        && attackerIsEx) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因阿塞蘿拉的惡作劇效果，不受【ex】招式的傷害與效果`, dIdx);
      baseDamage = 0;        // C-16 部分（傷害變 0）
      skipDefEffects = true; // C-17 部分（跳過步驟 5 受擊方效果）
    }

    // v3.67 中立中心（Stadium）— 非規則 defender 不受對手 ex/V 招式傷害
    //   卡面：「雙方的所有寶可夢（『擁有規則的寶可夢』除外），
    //         不會受到對手的『寶可夢【ex】・【V】』招式的傷害。」
    //   active target 在此處檢查；bench target 在 resolveBenchGuard 內檢查。
    // v5.181: 加 !skipDefEffects gate — 玩家規則理解 中立中心場地視作「寶可夢身上的附加效果」
    //         skipDefEffects 招式 (不計算對方寶可夢身上的附加效果) 應繞過 immunity
    if (baseDamage > 0 && !skipDefEffects && wouldNeutralCenterBlock(workingState, pool, attackerCard, defenderCard)) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因中立中心競技場效果，不受規則寶可夢招式傷害`, dIdx);
      baseDamage = 0;
    }

    // v2.174 鐵之防禦強化 — 自己【鋼】寶可夢本回合受招式 -30
    // v2.360 代歐奇希斯｜精神防護 — 攻擊方擁有特性時，傷害歸零
    // 攻擊方 card 有 abilities（且陣列非空）+ defender 有 immuneToAbilityPokemonThisTurn → 傷害歸零
    // v5.124：加 !skipDefEffects gate
    if (!skipDefEffects && baseDamage > 0
        && defender.active.immuneToAbilityPokemonThisTurn
        // v6.049：攻擊方的特性若已被消除（例：監視塔在場的【無】寶可夢），
        //   它就不是「擁有特性的寶可夢」，精神防護不該擋。
        && hasAnyEffectiveAbility(state, attacker.active, attackerCard, aIdx, 'active', pool)) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因精神防護效果，不受擁有特性的寶可夢招式傷害`, dIdx);
      baseDamage = 0;
    }
    // v2.360 具甲武者｜要害斬 — 完全免疫（傷害歸零 + 跳過防守效果）
    // v5.124：加 !skipDefEffects gate
    if (!skipDefEffects && baseDamage > 0 && defender.active.immuneToAllAttackThisTurn) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因要害斬效果，不受招式的傷害與效果影響`, dIdx);
      baseDamage = 0;
      skipDefEffects = true;
    }
    // v5.441 鐵壁/棉花之翼類 — 只免傷害，招式效果照常（不設 skipDefEffects）。
    if (!skipDefEffects && baseDamage > 0 && defender.active.immuneToAttackDamageThisTurn) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因鐵壁/棉花之翼效果，不受招式傷害（效果照常）`, dIdx);
      baseDamage = 0;
    }

    // v4.87 雷電獸｜閃光屏障（M5）— defender 不受「進化寶可夢」招式傷害
    //   進化判定：stage Stage1/Stage2 或 evolvesFrom 有值
    // v5.124：加 !skipDefEffects gate
    if (!skipDefEffects && baseDamage > 0 && defender.active.immuneToEvolutionAttackThisTurn) {
      const atkStage = attackerCard.stage ?? attackerCard.subtype;
      const isEvolution = atkStage === 'Stage1' || atkStage === 'Stage2' || !!attackerCard.evolvesFrom;
      if (isEvolution) {
        workingState = addLog(workingState,
          `${defenderCard.name} 因閃光屏障效果，不受進化寶可夢招式傷害`, dIdx);
        baseDamage = 0;
      }
    }

    // v5.455 青銅鐘｜金屬障礙（M5）— defender 受「進化寶可夢」招式傷害 -N（非全免）
    if (!skipDefEffects && baseDamage > 0 && defender.active.evolutionDamageReduceThisTurn) {
      const atkStage2 = attackerCard.stage ?? attackerCard.subtype;
      const isEvolution2 = atkStage2 === 'Stage1' || atkStage2 === 'Stage2' || !!attackerCard.evolvesFrom;
      if (isEvolution2) {
        const red = defender.active.evolutionDamageReduceThisTurn;
        const _b = baseDamage;
        baseDamage = Math.max(0, baseDamage - red);
        workingState = addLog(workingState,
          `${defenderCard.name} 因金屬障礙效果，受進化寶可夢招式傷害 -${red}`, dIdx);
        if (_b > baseDamage) formula.push({ sign: '-', value: _b - baseDamage, label: '金屬障礙' }); // v5.899 補公式項
      }
    }

    // v4.87 席多藍恩｜熔岩牆（M5）— defender 不受【灼傷】狀態 attacker 招式傷害
    // v5.124：加 !skipDefEffects gate
    if (!skipDefEffects && baseDamage > 0 && defender.active.immuneToBurnedAttackerThisTurn) {
      const atkBurned = attacker.active.status === 'burned' || attacker.active.secondaryStatus === 'burned' || attacker.active.tertiaryStatus === 'burned';
      if (atkBurned) {
        workingState = addLog(workingState,
          `${defenderCard.name} 因熔岩牆效果，不受【灼傷】狀態寶可夢招式傷害`, dIdx);
        baseDamage = 0;
      }
    }

    // v4.891 護城龍｜太鼓防壁（M5）— defender 側備戰有 護城龍 + 攻擊方能量 ≤2 → 免疫招式傷害
    //   卡面：「只要這隻寶可夢在備戰區，自己場上所有寶可夢不會受到身上附加能量為
    //          2 個以下的對手寶可夢的招式傷害。」
    //   範圍：active target case（本處）+ bench-snipe target case（defense.ts 統一 helper 內）。
    //   v5.209 修法：active target case 同步 defense.ts v5.115 修法，改用 totalEnergyUnits 算
    //   能量「unit 數」而非張數。PTCG 規則「能量 N 個」= N units（大竺葵繁茂 1 張草 = 2 units，
    //   火箭隊能量 1 張 = 2 units，燃火能量於進化卡 = 3 units，新衝天於 2 階 = 2 units）。
    //   原 length 算法漏算所有 multi-unit 倍率能量，玩家用大竺葵繁茂 + 2 張草仍被誤擋。
    // v5.832：太古防壁 active 主管線 — 收斂到中央述詞（與 canApplyEffectToTarget/resolveBenchGuard/hitBenchAll 共用）。
    if (baseDamage > 0 && taikoBariBlocksAttackDamage(workingState, aIdx, pool)) {
      const atkUnits = workingState._attackTimeAttackerEnergyUnits ?? Infinity;
      workingState = addLog(workingState,
        `${defenderCard.name} 因 護城龍｜太鼓防壁 效果，不受附加能量 ${atkUnits} 個（≤2）的對手招式傷害`,
        dIdx);
      baseDamage = 0;
    }

    // v5.544：防守方減傷算術收斂到中央 applyDefenderReductionsBlockA（引擎 + 狙擊/延後型共用）。
    let defenseReduceToolToDiscard: CardInstance | null = null;
    {
      const _ra = applyDefenderReductionsBlockA(
        workingState, state, defender, attacker, defenderCard, attackerCard,
        baseDamage, skipDefEffects, toolsJammed, dIdx, aIdx, formula, pool);
      workingState = _ra.workingState;
      baseDamage = _ra.baseDamage;
      defenseReduceToolToDiscard = _ra.defenseReduceToolToDiscard;
    }
    // 被動特性：條件式完全免疫 — skipDefEffects 跳過
    // v2.250：ImmunityCheck 可回傳 boolean（既有 entry）或 { immune, newState }
    //   （順滑大衣 等需要寫 log 的特性）。後者會 chain 到 workingState。
    // v2.266：火箭隊的監視塔對 Colorless 防守方的 PASSIVE_IMMUNITY 也要擋
    //   （e.g. 奇諾栗鼠ex｜順滑大衣 Colorless 擲幣免疫）。
    if (!skipDefEffects && baseDamage > 0 && defenderCard.abilities
        && !isColorlessAbilityBlocked(state, defenderCard, pool)) {
      for (const ab of defenderCard.abilities) {
if (!isAbilityHolderEffective(state, defender.active, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.471 初始化/暗夜羽擊/監視塔等消除 holder 特性
        const immune = PASSIVE_IMMUNITY.get(ab.name);
        if (!immune) continue;
        const result = immune(attackerCard, baseDamage, workingState, aIdx, pool, defenderCard.name);
        const before = baseDamage;
        if (typeof result === 'boolean') {
          if (result) {
            baseDamage = 0;
            // v3.03：完全免疫（如 順滑大衣 擲幣正面 / 神秘石居 / 抵抗之幕）→ -before(免疫)
            if (before > 0) formula.push({ sign: '-', value: before, label: `${ab.name}（免疫）` });
            break;
          }
        } else {
          // { immune, newState } — 統合 newState（含 log）
          workingState = result.newState;
          if (result.immune) {
            baseDamage = 0;
            if (before > 0) formula.push({ sign: '-', value: before, label: `${ab.name}（免疫）` });
            break;
          }
        }
      }
    }

    // v2.992 被動擲幣免傷（變隱龍 躲藏高手 / 吉雉雞 腎上腺費洛蒙）
    if (!skipDefEffects && baseDamage > 0 && defenderCard.abilities
        && !isColorlessAbilityBlocked(state, defenderCard, pool)) {
      for (const ab of defenderCard.abilities) {
        if (!isAbilityHolderEffective(state, defender.active, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.471 初始化/暗夜羽擊/監視塔等消除 holder 特性
        const coinFn = PASSIVE_COIN_AVOID.get(ab.name);
        if (!coinFn || !defender.active) continue;
        if (!coinFn(defender.active, defenderCard, pool)) continue;
        const r = flipCoinsWithLog(workingState, 1, `${defenderCard.name}｜${ab.name}`, dIdx);
        workingState = addLog(r.state,
          `${defenderCard.name}｜${ab.name}：${r.heads ? '正面 → 免疫此招式傷害！' : '反面 → 受傷害'}`,
          dIdx);
        if (r.heads) {
          // v3.03：擲幣免傷（變隱龍 躲藏高手 / 吉雉雞 腎上腺費洛蒙）→ -before(擲幣避免)
          if (baseDamage > 0) formula.push({ sign: '-', value: baseDamage, label: `${ab.name}（擲幣避免）` });
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
      // v3.20 多重轉接：只移除被觸發的那張，保留其他附在身上的道具
      const removeOne = (a: import('./types').CardInstance): import('./types').CardInstance => {
        if (a.toolAttached?.iid === tool.iid) {
          return { ...a, toolAttached: undefined };
        }
        if (a.extraTools && a.extraTools.length > 0) {
          return { ...a, extraTools: a.extraTools.filter(x => x.iid !== tool.iid) };
        }
        return a;
      };
      defenderState.active = removeOne(defenderState.active);
      defenderState.discard = [...defenderState.discard, tool];
      // v5.518：果實道具(福祿果/巧可果等 discardOnTrigger)觸發減傷後丟棄 → log 顯示丟棄道具名。
      //   workingState 為 running state(下方 L5030 newState 由它承接 → log 會保留)。
      workingState = addToolDiscardLog(workingState, [tool], pool, dIdx);
    }

    // 「下次被攻擊傷害 -N」— 套用後清除旗標（Session 31 新機制）
    // skipDefEffects 跳過，但旗標保持不消耗（視為對方的附加效果，未被觸發）。
    if (!skipDefEffects && baseDamage > 0 && defenderState.active.damageReduceNextHit) {
      const drBefore = baseDamage;
      baseDamage = Math.max(0, baseDamage - defenderState.active.damageReduceNextHit);
      formula.push({ sign: '-', value: drBefore - baseDamage, label: '下次被擊減傷' });
      // v5.226：祭典樂舞第一次攻擊不消耗 — 第二次攻擊也能套用「鐵羽毛」等減傷
      if (!_isFestivalDanceFirstAttack(state, aIdx, pool)) {
        defenderState.active = { ...defenderState.active, damageReduceNextHit: undefined };
      }
    }
    // v5.886 石丸子/鐵甲蛹|變硬 —「不受 N 以下招式的傷害」:所有減傷算完後,最終傷害 ≤ N 則歸 0
    //   (持續整個對手回合,不消耗;非 -N 減傷)。原 damageReduceNextHit=N 對 >N 傷害誤減。
    if (!skipDefEffects && baseDamage > 0
        && defenderState.active.blockAttackDamageIfLTEThisTurn != null
        && baseDamage <= defenderState.active.blockAttackDamageIfLTEThisTurn) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因變硬效果，不受「${defenderState.active.blockAttackDamageIfLTEThisTurn}」以下招式的傷害`, dIdx);
      formula.push({ sign: '-', value: baseDamage, label: `變硬(≤${defenderState.active.blockAttackDamageIfLTEThisTurn}免傷)` });
      baseDamage = 0;
    }
    // v2.385 BUG FIX：移除 v2.384 加的重複「陳舊的顎之化石 -30」hook
    //   （v2.190 line 2903 早已實裝過，v2.384 audit 失誤導致重複扣傷害 60）

    const newDamage = defenderState.active.damage + baseDamage;
    // 有效 HP = 基礎 HP + 道具加成（英雄斗篷/勇氣護符/豪華斗篷/驅勁能量古代）
    const defenderHP = getEffectiveHP(defenderState.active, pool, state);

    // 被動特性：影藏（超級耿鬼ex）— 惡寶可夢被 ex 擊倒時，獎賞卡 -1
    let prizeAdjust = 0;
    if (baseDamage > 0 && newDamage >= defenderHP) {
      const isExAttacker = attackerCard.name.endsWith('ex') || attackerCard.name.endsWith('EX');
      const isDefenderDark = defenderCard.pokemonType === 'Darkness';
      // v5.768：影藏持有者須「處於有效狀態」(§17.42.B) — 收斂中央 hasEffectiveKageHide
      //   （原只查特性名存在，漏 isAbilityHolderEffective → 鐵荊棘ex｜初始化消除超級耿鬼ex特性時仍誤 -1）。
      if (isExAttacker && isDefenderDark && hasEffectiveKageHide(state, dIdx, pool)) {
        prizeAdjust = -1;
      }
    }

    // v2.160：把實際造成傷害寫入 state.lastDealtDamage，供 POST 讀取
    //   （朽木妖｜終極吸取 heal=實際傷害量 等招式依賴此值）
    // v3.02：附傷害公式 — 至少 2 個 term（基礎 + 至少 1 個 modifier）才顯示，
    //        否則只是「100 點傷害」公式為「100(基礎)=100」沒意義
    const composeFormula = (terms: FormulaTerm[], finalValue: number): string => {
      if (terms.length <= 1) return '';  // 只有基礎，無公式可言
      // v3.03：在最後一個 × 之前的 base + 加法區用 [...] 包起，明示先算這段再 ×。
      //   原因：算術優先級會讓讀者誤以為「100+30×2-30=130」，但 PTCG 是
      //         (100+30)×2-30=230 — 加成先加，再 ×弱點，最後 -抵抗。
      //   有 ≥1 個 + term 在 × 之前才加括號（單一 base 的純 ×N 不必要包覆）。
      let lastMulIdx = -1;
      for (let i = 0; i < terms.length; i++) {
        if (terms[i].sign === '×') lastMulIdx = i;
      }
      const renderTerm = (t: FormulaTerm, isFirst: boolean): string => {
        if (isFirst) return `${t.value}(${t.label})`;
        if (t.sign === '×') return `×${t.value}(${t.label})`;
        if (t.sign === '+') return `+${t.value}(${t.label})`;
        if (t.sign === '-') return `-${t.value}(${t.label})`;
        return '';
      };
      // 沒有 × → 線性串接
      if (lastMulIdx < 0) {
        const parts = terms.map((t, i) => renderTerm(t, i === 0));
        return `${parts.join(' ')} = ${finalValue}`;
      }
      // 有 × → 把 0..lastMulIdx-1 包進 [...]，後面照接
      const beforeParts: string[] = [];
      for (let i = 0; i < lastMulIdx; i++) beforeParts.push(renderTerm(terms[i], i === 0));
      const afterParts: string[] = [];
      for (let i = lastMulIdx; i < terms.length; i++) afterParts.push(renderTerm(terms[i], false));
      // 若 × 之前只有 base 一項（純 100×2 弱點型），不必加括號
      if (beforeParts.length <= 1) {
        const parts = terms.map((t, i) => renderTerm(t, i === 0));
        return `${parts.join(' ')} = ${finalValue}`;
      }
      return `[${beforeParts.join(' ')}] ${afterParts.join(' ')} = ${finalValue}`;
    };
    const _formulaStr = composeFormula(formula, baseDamage);
    let newState: GameState = addLog(
      { ...workingState, lastDealtDamage: baseDamage },
      `${attacker.name} 的 ${attackerCard.name} 使出「${attack.name}」` +
        (isToolAttack ? `（工具：${sourceName}）` : '') +
        (baseDamage > 0 ? `，造成 ${baseDamage} 點傷害！` : '！') +
        (baseDamage > 0 && _formulaStr ? `【${_formulaStr}】` : ''),
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

    // v5.775 Phase 2:把 KO+反擊結算包成 resolveKnockouts 閉包（呼叫點不變、行為等價；為日後「改順序」鋪路）。
    //   wouldBeKO/preventedKO 提到外層（下方 postFn 區仍引用），其餘區域變數由閉包捕捉，免逐一傳參。
    //   閉包回傳：GameState=終局（直接回傳該 state）/ null=未終局。
    let wouldBeKO = false;
    let preventedKO = false;
    const resolveKnockouts = (): GameState | null => {
    // 擊倒判定
    wouldBeKO = baseDamage > 0 && defenderHP > 0 && newDamage >= defenderHP;

    // 道具防 KO（倖存鍛鍊器）— 滿血被 KO 時保留少量 HP，道具丟棄（阻礙之塔時失效）
    preventedKO = false;
    if (!toolsJammed && wouldBeKO && defenderState.active) {
      // v3.20 多重轉接：iterate 所有道具找第一個觸發 PREVENT_KO 的
      for (const t of getAllAttachedTools(defenderState.active)) {
        const preventTool = pool.get(t.cardId);
        if (!preventTool) continue;
        const fn = TOOL_PREVENT_KO.get(preventTool.name);
        if (!fn) continue;
        const result = fn(defenderState.active, defenderCard, baseDamage);
        if (!result.prevent) continue;
        const triggered = t;
        const targetDamage = Math.max(0, defenderHP - result.leaveHP);
        let newAct = { ...defenderState.active, damage: targetDamage };
        if (newAct.toolAttached?.iid === triggered.iid) {
          newAct = { ...newAct, toolAttached: undefined };
        } else if (newAct.extraTools) {
          newAct = { ...newAct, extraTools: newAct.extraTools.filter(x => x.iid !== triggered.iid) };
        }
        defenderState.active = newAct;
        defenderState.discard = [...defenderState.discard, triggered];
        defPlayers[dIdx] = defenderState;
        newState = addLog({ ...newState, players: defPlayers, turnPhase: 'end' },
          `${preventTool.name}：${defenderCard.name} 避免昏厥，剩餘 HP ${result.leaveHP}！`, null);
        // v5.518：倖存鍛鍊器卡面「然後將這張卡丟棄」— log 顯示道具已丟棄(玩家報沒顯示)。
        newState = addToolDiscardLog(newState, [triggered], pool, dIdx);
        preventedKO = true;
        break;
      }
    }
    // v2.133 被動防 KO（皮卡丘ex 勤奮之心 等）— 條件由 PASSIVE_PREVENT_KO map 內 fn 決定
    if (!preventedKO && wouldBeKO && defenderState.active && defenderCard.abilities) {
      for (const ab of defenderCard.abilities) {
        const fn = PASSIVE_PREVENT_KO.get(ab.name);
        if (!fn) continue;
        const result = fn(defenderState.active, defenderCard, baseDamage);
        if (result.prevent) {
          // v5.596 擲幣型 prevent-KO(堅忍之軀/不朽身軀)走 flipCoinsWithLog；反面則照常昏厥
          if (COIN_PREVENT_KO_ABILITIES.has(ab.name)) {
            const _cf = flipCoinsWithLog(newState, 1, ab.name, dIdx);
            newState = _cf.state;
            if (_cf.heads === 0) continue;
          }
          const targetDamage = Math.max(0, defenderHP - result.leaveHP);
          defenderState.active = { ...defenderState.active, damage: targetDamage };
          defPlayers[dIdx] = defenderState;
          newState = addLog({ ...newState, players: defPlayers, turnPhase: 'end' },
            `「${ab.name}」啟動：${defenderCard.name} 避免昏厥，剩餘 HP ${result.leaveHP}！`, null);
          preventedKO = true;
          break;
        }
      }
    }

    // v2.385 耿鬼｜無限之影：受招式 KO 時，本體放回手牌（能量 / 道具 / 進化堆仍丟棄）
    //   仍算 KO（給對手獎賞），只改變 defender 本體去向。
    let infiniteShadowReturnsToHand = false;
    // v5.986 平穩境地：被回手的是「被KO方自己」場上的寶可夢 → 其對手側有平穩境地則擋(正常丟棄,獎賞照常)。
    //   (由官方 Q&A②潛者捕捉「不行」類推;無直接 Q&A,已記錄待 Wilson 知悉)
    const _isBlockedByCalmGround = _calmGroundBlocksReturn(newState, dIdx, pool);
    if (!preventedKO && wouldBeKO && defenderCard.abilities?.some(a => a.name === '無限之影') && _isBlockedByCalmGround) {
      newState = addLog(newState,
        `無限之影：對手場上有【平穩境地】，${defenderCard.name} 無法放回手牌 → 正常進棄牌堆（獎賞照常）`,
        dIdx);
    }
    if (!preventedKO && wouldBeKO && defenderCard.abilities?.some(a => a.name === '無限之影') && !_isBlockedByCalmGround) {
      infiniteShadowReturnsToHand = true;
      newState = addLog(newState,
        `無限之影：${defenderCard.name} 因招式傷害昏厥 → 整條進化鏈放回手牌（附加能量/道具仍丟棄），對手仍取得獎賞`,
        dIdx);
    }
    if (!preventedKO && wouldBeKO) {
      // 道具：被 KO 時獎賞加成（豪華斗篷 +1 / 莉莉艾的珍珠 -1 等）— 阻礙之塔時失效
      let prizeTool = 0;
      if (!toolsJammed && defenderState.active) {
        // v3.20 多重轉接：iterate 所有道具
        for (const t of getAllAttachedTools(defenderState.active)) {
          const tool = pool.get(t.cardId);
          if (!tool) continue;
          const fn = TOOL_PRIZE_BONUS.get(tool.name);
          if (fn) prizeTool += fn(defenderCard);
        }
      }

      const updatedActive = { ...defenderState.active, damage: newDamage };
      // v3.0 獵斑魚｜潛者捕捉 — 自方場上有此卡 + 被 KO 的是【水】寶可夢 → 身上「基本【水】能量」回手。
      //   注意：只攔基本水能量，特殊能量仍走棄牌堆。
      let waterEnergyToHand: CardInstance[] = [];
      let nonWaterEnergyAttached: CardInstance[] = updatedActive.energyAttached;
      if (canRelicanthDiverCatchTrigger(newState, dIdx, defenderCard, pool)) {
        waterEnergyToHand = updatedActive.energyAttached.filter(e => isBasicWaterEnergy(e.cardId, pool));
        nonWaterEnergyAttached = updatedActive.energyAttached.filter(e => !isBasicWaterEnergy(e.cardId, pool));
      }
      const koDiscard: CardInstance[] = [
        updatedActive,
        ...nonWaterEnergyAttached,
        ...getAllAttachedTools(updatedActive),
        ...(updatedActive.evolvedFromStack ?? []),
      ];
      // 先記錄被 KO 的道具名以便觸發 ON_KO 後續效果
      // v3.20 多重轉接：所有道具都可能有 ON_KO
      const onKOToolNames = getAllAttachedTools(updatedActive).map(t => pool.get(t.cardId)).filter((c): c is import('$lib/cards/types').Card => !!c);

      if (infiniteShadowReturnsToHand) {
        // v5.934 中央收斂：無限之影 KO 去向改走 resolveInfiniteShadowKo（與備戰狙擊/擴散/延後傷害 KO 共用單一來源）。
        //   本體+進化來源實體卡(evolvedFromStack；神奇糖果情形只含實際疊著的卡→不生出場上沒有的中間進化)
        //   逐張清乾淨放回手牌；附加能量/道具丟棄。此處 defender 必為對手主傷害 KO，故 eligible=true。
        const _isk = resolveInfiniteShadowKo(updatedActive, pool, true);
        defenderState.discard = [...defenderState.discard, ..._isk.toDiscard];
        defenderState.hand = [...defenderState.hand, ..._isk.toHand];
      } else {
        defenderState.discard = [...defenderState.discard, ...koDiscard];
      }
      // v5.464 獵斑魚｜潛者捕捉 — 卡面「可使用」= 玩家確認是否回手。改開確認選單(modal-choice)。
      //   水能量已從 koDiscard 排除(見上 nonWaterEnergyAttached)，此處先 held 在 pending params，
      //   既不進手牌也不進棄牌；待防守方(dIdx)在確認選單選擇：是→回手 / 否→進棄牌。
      //   設於此處(active=null 前)，後續所有 {...newState} 展開都會保留 pendingSelection。
      if (waterEnergyToHand.length > 0) {
        newState = addLog(newState,
          `「潛者捕捉」可發動：${defenderCard?.name ?? '?'} 身上有「基本【水】能量」${waterEnergyToHand.length} 張`, dIdx);
        // v5.918 收斂:改排入中央佇列(與備戰狙擊KO共用),dispatcher 末端 flushDiverCatchQueue 統一開 modal
        newState = enqueueDiverCatch(newState, dIdx, defenderCard?.name ?? '?', waterEnergyToHand);
      }
      // v5.769：移除戰鬥位前，記錄其能量 iid（此刻已在 defenderState.discard）— 供「搬移對手戰鬥位能量」
      //   POST 效果(戲法舞步/反轉之風)在官方順序「效果先於昏厥」下從棄牌區取回。
      newState = { ...newState, _koDefenderSnapshot: { idx: dIdx, inst: updatedActive } };
      defenderState.active = null;
      // Wave 39：蝶結萌虻｜多餘花粉 — 跨回合獎賞加成
      const deferredBonus = (updatedActive.deferredPrizeBonusThisTurn && updatedActive.deferredPrizeBonusThisTurn > 0)
        ? updatedActive.deferredPrizeBonusThisTurn : 0;
      // Wave 43：白蕾雅 — 本回合，攻擊方使用「太晶」寶可夢招式 KO 對手戰鬥位 → +1 獎賞卡。
      // 條件：aIdx 玩家本回合有 teraKoBonusPrizeThisTurn 旗標，且攻擊方 active 為太晶寶可夢。
      // v2.48：scraper 把太晶從 attacks[] 抽出，改查 card.tags 欄位。
      let whiteLilyBonus = 0;
      if (newState.players[aIdx].teraKoBonusPrizeThisTurn) {
        const atkActive = newState.players[aIdx].active;
        const atkCard = atkActive ? pool.get(atkActive.cardId) : null;
        const isTera = !!atkCard?.tags?.includes('太晶');
        if (isTera) whiteLilyBonus = 1;
      }
      // v2.185：巴貝娜與荷蓮娜 — 本回合，攻擊方「N 的」寶可夢招式 KO 對手戰鬥位 → +3 獎賞卡。
      let bagonElenaBonus = 0;
      if (newState.players[aIdx].bagonElenaThisTurn) {
        const atkActive = newState.players[aIdx].active;
        const atkCard = atkActive ? pool.get(atkActive.cardId) : null;
        if (atkCard?.name?.startsWith('N的')) bagonElenaBonus = 3;
      }
      // v2.93a：三首惡龍ex｜貪婪食客 — 若招式 KO 對手【基礎】寶可夢 → +1 獎賞卡
      // 卡面：「若對手的【基礎】寶可夢因這隻寶可夢使用的招式的傷害而【昏厥】了，則多獲得 1 張獎賞卡。」
      // 條件：attacker 必須是擁有「貪婪食客」特性的寶可夢（即場上 active 為三首惡龍ex）；
      //       且被 KO 的對手寶可夢 subtype === 'Basic'。
      let greedyGourmetBonus = 0;
      const atkActiveGG = newState.players[aIdx].active;
      const atkCardGG = atkActiveGG ? pool.get(atkActiveGG.cardId) : null;
      // v5.483：原 subtype==='Basic' 對「基礎 ex」(如喵喵ex subtype='ex')失效 → 只給 base 2 不 +1。
      //   改 isBasicPokemonCard（涵蓋基礎 ex / 火箭隊基礎等）。卡面：對手【基礎】被本招式傷害 KO → +1。
      if (atkCardGG?.abilities?.some(a => a.name === '貪婪食客')
          && isBasicPokemonCard(defenderCard)) {
        greedyGourmetBonus = 1;
      }
      // v2.103 古舊能量（ACE SPEC）— 附有此能量的寶可夢被 KO 時，對方獎賞 -1
      // v2.260 Bug #4：卡面「對戰中，自己的『古舊能量』的這個效果只生效 1 次」
      //   per-player flag ancientEnergyMinusOneUsed[dIdx]：dIdx 玩家的古舊能量已生效則不再 -1
      let ancientEnergyAdjust = 0;
      let ancientEnergyJustUsed = false;
      const koInst = state.players[dIdx].active;
      if (koInst) {
        const usedFlags = state.ancientEnergyMinusOneUsed ?? [false, false];
        if (!usedFlags[dIdx]) {
          const hasAncient = koInst.energyAttached.some(e => pool.get(e.cardId)?.name === '古舊能量');
          if (hasAncient) {
            ancientEnergyAdjust = -1;
            ancientEnergyJustUsed = true;
          }
        }
      }
      // v2.992 PASSIVE_PREVENT_PRIZE（脫殼忍者 脆弱蛻殼）— 若攻擊方符合 predicate 則獎賞改 0
      let preventPrizeAll = false;
      if (defenderCard.abilities) {
        for (const ab of defenderCard.abilities) {
          if (!isAbilityHolderEffective(newState, koInst, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.655 暗夜羽擊/初始化/黏著束縛/監視塔壓制→脆弱蛻殼等防守特性失效
          const fnPP = PASSIVE_PREVENT_PRIZE.get(ab.name);
          if (fnPP && fnPP(attackerCard)) {
            preventPrizeAll = true;
            newState = addLog(newState,
              `「${ab.name}」啟動：${defenderCard.name} 被 ${attackerCard.name} KO，但對手無法獲得獎賞卡`, null);
            break;
          }
        }
      }
      // v3.0 波克基斯｜奇跡之吻 — 攻擊方場上有此卡 → 擲幣 1 次正面 +1 獎賞（不重複）。
      //   只在「對手戰鬥位被 KO」時觸發；本路徑為招式 KO 對手 active，符合卡面條件。
      let togekissBonus = 0;
      if (canTogekissMiracleKissTrigger(newState, aIdx, pool)) {
        const flipResultMK = flipCoinsWithLog(newState, 1, '波克基斯｜奇跡之吻', aIdx);
        newState = flipResultMK.state;
        if (flipResultMK.heads === 1) {
          togekissBonus = 1;
          newState = addLog(newState, `「奇跡之吻」啟動：硬幣正面 → 多獲得 1 張獎賞卡`, aIdx);
        } else {
          newState = addLog(newState, `「奇跡之吻」啟動：硬幣反面 → 不增加獎賞卡`, aIdx);
        }
      }
      // 獎賞卡下限 0（影藏等特性可將獎賞減到 0 張；實務上對手 KO 一隻 1 獎賞的惡寶可夢時效果才會觸發歸零）
      const basePrizes = prizesForKO(defenderCard);
      const prizes = preventPrizeAll ? 0
        : Math.max(0, basePrizes + prizeAdjust + prizeTool + deferredBonus + whiteLilyBonus + bagonElenaBonus + greedyGourmetBonus + ancientEnergyAdjust + togekissBonus);
      // v3.76：揭示 prize 調整來源（讓玩家了解為何獎賞數與預期不同）
      // - prizeTool: 莉莉艾的珍珠 -1 / 豪華斗篷 +1
      // - prizeAdjust: 影藏（惡寶可夢被 ex KO 時 -1）
      // - ancientEnergyAdjust: 古舊能量 -1
      // - deferredBonus / whiteLilyBonus / bagonElenaBonus / greedyGourmetBonus / togekissBonus 已各自有 log
      if (!preventPrizeAll && prizeTool !== 0) {
        newState = addLog(newState, `🔧 道具調整獎賞卡：${prizeTool >= 0 ? '+' : ''}${prizeTool}（如莉莉艾的珍珠 -1 / 豪華斗篷 +1）`, null);
      }
      if (!preventPrizeAll && ancientEnergyAdjust !== 0) {
        // v3.77：明確 log 古舊能量 ACE SPEC 效果，附 KO 寶可夢名 + 計算式
        newState = addLog(newState,
          `⚡ 古舊能量（ACE SPEC）：${defenderCard.name} 附有「古舊能量」 → 對手獎賞卡 ${ancientEnergyAdjust >= 0 ? '+' : ''}${ancientEnergyAdjust} 張（${basePrizes} ${ancientEnergyAdjust < 0 ? '-' : '+'} ${Math.abs(ancientEnergyAdjust)} = ${prizes}）`,
          null);
      }
      defPlayers[dIdx] = defenderState;
      // v2.260 Bug #4：若古舊能量這次有 -1，per-player flag 設為 true（之後不再 -1）
      const newAncientFlags: [boolean, boolean] = ancientEnergyJustUsed
        ? (() => {
            const f = [...(newState.ancientEnergyMinusOneUsed ?? [false, false])] as [boolean, boolean];
            f[dIdx] = true;
            return f;
          })()
        : (newState.ancientEnergyMinusOneUsed ?? [false, false]);
      newState = {
        ...newState, players: defPlayers,
        turnPhase: 'end',
        ancientEnergyMinusOneUsed: newAncientFlags,
      };
      newState = addPendingPrize(newState, aIdx, prizes, pool);
      // v2.246 KO cause tracking — 招式 KO 對手戰鬥位
      newState = recordOppKO(newState, dIdx, defenderCard, 'attack');
      // v2.992 PASSIVE_KO_RETALIATION（沙鈴仙人掌 炸裂針）— KO 時對攻擊者放 N 個指示物
      // v4.56：補光之翼 check — attackerCard 是當前 attacker
      const _v456KoMagicalShine = attackerCard?.abilities?.some(a => a.name === '光之翼') ?? false;
      if (defenderCard.abilities && !_v456KoMagicalShine) {
        for (const ab of defenderCard.abilities) {
          if (!isAbilityHolderEffective(state, defender.active, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.471 初始化/暗夜羽擊/監視塔等消除 holder 特性
          const ret = PASSIVE_KO_RETALIATION.get(ab.name);
          if (!ret) continue;
          const refPlayers = [...newState.players] as [PlayerState, PlayerState];
          if (refPlayers[aIdx].active) {
            const dmg = ret.counters * 10;
            refPlayers[aIdx] = {
              ...refPlayers[aIdx],
              active: { ...refPlayers[aIdx].active!, damage: refPlayers[aIdx].active!.damage + dmg },
            };
            const attName2 = pool.get(refPlayers[aIdx].active!.cardId)?.name ?? '?';
            newState = addLog({ ...newState, players: refPlayers },
              `「${ab.name}」啟動：${attName2} 身上放置 ${ret.counters} 個傷害指示物（+${dmg}）`, dIdx);
          }
        }
      } else if (defenderCard.abilities && _v456KoMagicalShine) {
        const koRetalNames = defenderCard.abilities
          .filter(a => PASSIVE_KO_RETALIATION.has(a.name))
          .map(a => a.name);
        if (koRetalNames.length > 0) {
          newState = addLog(newState,
            `光之翼：${attackerCard?.name ?? '?'} 不受對手特性效果影響（${koRetalNames.join('、')} 無效）`,
            aIdx);
        }
      }
      // v2.992 PASSIVE_ON_KO（桃歹郎 最後鎖鏈 / 願增猿ex 鬆口氣 / v4.893 密勒頓 光子纜線）
      // v4.893：傳 koInst (KO 前的 instance 快照) 給 fn — 部分特性需要讀取 KO 前
      //         的能量列表（如 光子纜線移基本能量到備戰）。
      //         koInst 在本作用域內已於 line 4468 (const koInst = state.players[dIdx].active) 取得。
      if (defenderCard.abilities) {
        for (const ab of defenderCard.abilities) {
          if (!isAbilityHolderEffective(newState, koInst, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.655 同上：被KO觸發特性(鬆口氣/最後鎖鏈等)被壓制時失效
          const fnKO = PASSIVE_ON_KO.get(ab.name);
          if (fnKO) newState = fnKO(newState, dIdx, aIdx, pool, defenderCard, koInst ?? undefined);
        }
      }
      if (deferredBonus > 0) {
        newState = addLog(newState, `${defenderCard.name} 因「多餘花粉」遺留效果，+${deferredBonus} 張獎賞卡`, null);
      }
      if (whiteLilyBonus > 0) {
        newState = addLog(newState, `「白蕾雅」效果發動：太晶寶可夢的招式 KO 對手戰鬥位 +${whiteLilyBonus} 張獎賞卡`, aIdx);
      }
      if (bagonElenaBonus > 0) {
        newState = addLog(newState, `「巴貝娜與荷蓮娜」效果發動：「N 的」寶可夢招式 KO 對手戰鬥位 +${bagonElenaBonus} 張獎賞卡`, aIdx);
      }
      if (prizeAdjust < 0) {
        newState = addLog(newState, `「影藏」啟動：${attacker.name} 取得的獎賞卡減少 1 張`, null);
      }
      if (prizes > 0) {
        newState = addLog(newState, `${cardLink(koInst?.iid, defenderCard.name)} 被擊倒！${attacker.name} 取得 ${prizes} 張獎賞卡。`, null);
      } else {
        newState = addLog(newState, `${cardLink(koInst?.iid, defenderCard.name)} 被擊倒！但 ${attacker.name} 無法取得任何獎賞卡。`, null);
      }

      // 道具：被 KO 時觸發（希望護身符 / 沉重接力棒）— 阻礙之塔時失效
      // v3.20 多重轉接：iterate 所有道具
      // v5.067：傳 updatedActive (koInst) 第 5 參數讓 callback 直接讀 KO 寶可夢的
      //   energyAttached snapshot，不依賴 discard 順序。
      if (!toolsJammed) {
        for (const c of onKOToolNames) {
          const fn = TOOL_ON_KO.get(c.name);
          if (fn) newState = fn(newState, dIdx, aIdx, pool, updatedActive);
        }
      }

      // v5.505 豪邁炸彈（M5 PokemonTool，依賴真實 baseDamage 的受傷反擊）holder 被 KO 時補觸發。
      //   卡面：「附有這張卡的寶可夢（超級進化ex 除外），在戰鬥場受到對手超級進化ex 的招式造成 240 點
      //   以上傷害時，在使用招式的寶可夢身上放置 12 個傷害指示物。之後將這張卡丟棄。」依 PTCG 規則
      //   「受到傷害時」含 KO 情境（同龐克頭盔 v5.080 / 陳舊頭蓋化石 v5.494）。豪邁炸彈因需真實傷害值
      //   判 240，無法走 registerToolOnDamagedAndKO（KO 路徑 damage=0），故只註冊 TOOL_ON_DAMAGED →
      //   上方 TOOL_ON_KO 迴圈不含它 → holder 被 240+ 一擊 KO 時漏觸發（最常見情況）。
      //   holder 已 KO（道具隨 KO 寶可夢進棄牌），此處只需對攻擊方放 12 個指示物（+120）。
      //   gate 與 TOOL_ON_DAMAGED.豪邁炸彈 一致：baseDamage≥240 + 攻擊方為超級進化ex + holder 非超級進化ex。
      if (!toolsJammed && baseDamage >= 240 && onKOToolNames.some(c => c.name === '豪邁炸彈')) {
        const lbAtk = newState.players[aIdx].active;
        const lbAtkCard = lbAtk ? pool.get(lbAtk.cardId) : null;
        const lbAtkIsMega = !!lbAtkCard && lbAtkCard.name.endsWith('ex') && lbAtkCard.name.startsWith('超級');
        const lbDefIsMega = !!defenderCard && defenderCard.name.endsWith('ex') && defenderCard.name.startsWith('超級');
        if (lbAtk && lbAtkIsMega && !lbDefIsMega) {
          const lbPlayers = [...newState.players] as [PlayerState, PlayerState];
          const lbAtkP = { ...lbPlayers[aIdx] };
          if (lbAtkP.active) {
            lbAtkP.active = { ...lbAtkP.active, damage: lbAtkP.active.damage + 120 };
            lbPlayers[aIdx] = lbAtkP;
            newState = addLog({ ...newState, players: lbPlayers },
              `豪邁炸彈（holder 被 KO）：${lbAtkCard?.name ?? '?'} 受到 ${baseDamage} 點超級進化ex 招式傷害（≥240）→ 放 12 個傷害指示物（+120）！`, null);
          }
        }
      }

      // v5.080：龐克頭盔反擊 — 卡面「受到傷害時」依 PTCG 規則含 KO 情境，
      //   原 L5043 PUNK reflect 套用只在「沒 KO」分支跑（else if !preventedKO），
      //   holder 被 KO 時漏觸發。複製套用邏輯到 KO 分支（在 TOOL_ON_KO 之後）。
      //   注意：punkReflectDamage 已在 L4639 預先計算（不論 KO 與否都算 40）。
      //   雙 KO 邊緣案例（反彈把 attacker 也打死）：交給後續 sanityKOSweep 處理。
      if (!toolsJammed && punkReflectDamage > 0) {
        const refPlayers = [...newState.players] as [PlayerState, PlayerState];
        const atkP = { ...refPlayers[aIdx] };
        if (atkP.active) {
          const atkNewDmg = atkP.active.damage + punkReflectDamage;
          atkP.active = { ...atkP.active, damage: atkNewDmg };
          refPlayers[aIdx] = atkP;
          newState = addLog(
            { ...newState, players: refPlayers },
            `🔧 龐克頭盔（holder KO）：${attackerCard.name} 受到 ${punkReflectDamage} 傷害反擊！`,
            null,
          );
        }
        // 套用後 punkReflectDamage 置 0 避免 L5043 非 KO 分支重複套用（雖然 KO/非 KO 互斥但保險）
        punkReflectDamage = 0;
      }

      // v5.081：PASSIVE_RETALIATION + PASSIVE_ON_DAMAGED 補 KO 觸發
      //   卡面「受到對手寶可夢招式的傷害時」依 PTCG 規則含 KO 情境。
      //   原 L5230 / L5241 套用只在「沒 KO」分支跑，holder 被 KO 時漏觸發。
      //   涵蓋特性（PASSIVE_RETALIATION 10 個）：
      //     毒刺/灼熱之軀/反擊/尖刺盔甲/怨恨旋渦/甲殼刺/反擊雞冠/自動用武/反擊針/快掃拳返
      //   + PASSIVE_ON_DAMAGED（警備濁霧）
      //   光之翼擋（attacker 持有時免疫對手特性反擊）— 同非 KO 分支邏輯
      if (!_v456KoMagicalShine && baseDamage > 0 && defenderCard.abilities) {
        for (const ab of defenderCard.abilities) {
          if (!isAbilityHolderEffective(state, defender.active, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.471 初始化/暗夜羽擊/監視塔等消除 holder 特性
          const retal = PASSIVE_RETALIATION.get(ab.name);
          if (retal) newState = retal(newState, dIdx, pool, koInst);
        }
        for (const ab of defenderCard.abilities) {
          const fnOD = PASSIVE_ON_DAMAGED.get(ab.name);
          // v5.980：補 isAbilityHolderEffective gate(holder 特性被消除→不觸發,同上方 RETALIATION loop)。
          if (fnOD && isAbilityHolderEffective(state, defender.active, defenderCard, dIdx, ab.name, 'active', pool)) newState = fnOD(newState, dIdx, aIdx, pool, defenderCard);
        }
      }
      // v5.494：卡面內建受傷反擊（陳舊的頭蓋化石 — 無 abilities，按卡名）。
      //   「受到傷害時」含 KO 情境 → holder 被 KO 仍要對攻擊方放指示物（同龐克頭盔 v5.080）。
      //   傳 defenderCard（active 此時可能已移除）；反殺攻擊方交 sanityKOSweep/反彈檢查。
      if (baseDamage > 0) newState = applyInherentRetaliation(newState, dIdx, defenderCard, pool);
      // v5.980：招式旗標型受傷反擊(還擊斧/等待角擊/殼捲風旋轉/強大猛擊)holder 被一擊 KO 時仍觸發
      //   (受傷時含 KO,同龐克頭盔 v5.080/扣殺能量 v5.156/頭蓋化石 v5.494;旗標在 koInst 快照上,隨離場清)。
      if (baseDamage > 0 && koInst?.retaliateCountersOnNextHit && newState.players[aIdx].active) {
        const _flag = koInst.retaliateCountersOnNextHit;
        const _retalN = _flag === 'mirror' ? Math.floor(baseDamage / 10) : (typeof _flag === 'number' ? _flag : 0);
        if (_retalN > 0) {
          const _rp = [...newState.players] as [PlayerState, PlayerState];
          _rp[aIdx] = { ..._rp[aIdx], active: { ..._rp[aIdx].active!, damage: _rp[aIdx].active!.damage + _retalN * 10 } };
          newState = addLog({ ...newState, players: _rp }, `反擊：對攻擊方放 ${_retalN} 個傷害指示物（${_retalN * 10} 點傷害）`, dIdx);
        }
      }
      // v5.156：SPECIAL_ENERGY_ON_DAMAGED 補 KO 觸發（鏡射 v5.080 / v5.081 模式）
      //   Wilson 截圖確認：扣殺能量 holder 被 KO 時漏觸發 — 卡面「受到對手寶可夢
      //   招式的傷害時」依 PTCG 規則含 KO 情境（卡面無「未昏厥」限制）。
      //   原 L5057 SPECIAL_ENERGY_ON_DAMAGED 只在 else (!preventedKO) 分支跑，
      //   holder 被 KO 時漏觸發。從 koInst.energyAttached 抓 KO 前 snapshot 觸發。
      if (baseDamage > 0 && koInst && koInst.energyAttached.length > 0) {
        for (const e of koInst.energyAttached) {
          const ec = pool.get(e.cardId);
          if (!ec) continue;
          const fn = SPECIAL_ENERGY_ON_DAMAGED.get(ec.name);
          if (fn) newState = fn(newState, dIdx, aIdx, baseDamage, pool);
        }
      }
      // v5.083：花岩怪|怨恨旋渦 field-wide — 「只要這隻寶可夢在場上」涵蓋備戰。
      //   既有 PASSIVE_RETALIATION 主 loop 只 scan defenderCard.abilities，
      //   花岩怪在備戰時觸發不到（玩家回報「完全沒觸發」）。
      //   gate：defender.active.pokemonType === 'Darkness'（自方戰鬥場必為【惡】）。
      //   避免雙重：active 花岩怪自己被打 → 已在 main loop 觸發過此 ability；
      //             這裡只 scan defender.bench 上的花岩怪（持有者在備戰 + active 是其他【惡】）。
      //   光之翼亦擋（同 PASSIVE_RETALIATION 既有準則）。
      if (!_v456KoMagicalShine && baseDamage > 0) {
        const defActiveKO = koInst;  // v5.548 KO 安全：KO 時 active 已 null，用受傷前快照判【惡】field-wide
        const defActiveCardKO = defActiveKO ? pool.get(defActiveKO.cardId) : null;
        if (defActiveCardKO?.pokemonType === 'Darkness') {
          for (const benchInst of newState.players[dIdx].bench) {
            const benchCard = pool.get(benchInst.cardId);
            if (!benchCard?.abilities) continue;
            for (const ab of benchCard.abilities) {
              if (ab.name === '怨恨旋渦') {
                if (!isAbilityHolderEffective(newState, benchInst, benchCard, dIdx, '怨恨旋渦', 'bench', pool)) continue; // v5.656
                const fn = PASSIVE_RETALIATION.get('怨恨旋渦');
                if (fn) newState = fn(newState, dIdx, pool, koInst);
              }
            }
          }
        }
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
      // v2.69 重裝角擊追蹤 — 累計 defender 受到的招式傷害（在 defender 自己 END_TURN 時 reset）
      const accumDmgTaken = (defenderState.active!.damageTakenLastOppTurn ?? 0) + (baseDamage > 0 ? baseDamage : 0);
      defenderState.active = { ...defenderState.active!, damage: newDamage, damageTakenLastOppTurn: accumDmgTaken };
      defPlayers[dIdx] = defenderState;
      newState = { ...newState, players: defPlayers, turnPhase: 'end' };

      // v3.751：抓取攻擊方在 ON_DAMAGED hooks 觸發前的傷害值 — 用於判斷反傷有實際生效
      const atkDamageBeforeRetaliation = newState.players[aIdx].active?.damage ?? 0;

      // 道具：被打到但未 KO 時觸發（幸運頭盔 / 奢華炸彈）— 阻礙之塔時失效
      if (!toolsJammed && baseDamage > 0 && defenderState.active) {
        // v3.20 多重轉接：iterate 所有道具
        for (const t of getAllAttachedTools(defenderState.active)) {
          const tool = pool.get(t.cardId);
          if (!tool) continue;
          const fn = TOOL_ON_DAMAGED.get(tool.name);
          if (fn) newState = fn(newState, dIdx, aIdx, baseDamage, pool);
        }
      }
      // v2.175 特殊能量 ON_DAMAGED（扣殺能量等）— iterate energyAttached
      if (baseDamage > 0 && defenderState.active.energyAttached.length > 0) {
        for (const e of defenderState.active.energyAttached) {
          const ec = pool.get(e.cardId);
          if (!ec) continue;
          const fn = SPECIAL_ENERGY_ON_DAMAGED.get(ec.name);
          if (fn) newState = fn(newState, dIdx, aIdx, baseDamage, pool);
        }
      }

      // v2.301 Bug fix：TOOL_ON_DAMAGED（凸凸頭盔 +20、奢華炸彈 +120）或 SPECIAL_ENERGY
      // 可能把反傷加到攻擊方身上，若此時攻擊方 HP 歸零，sanityKOSweep 只掃 dIdx 不掃 aIdx，
      // 導致攻擊方留在場上「zombie」。在這裡立即偵測並處理攻擊方 KO。
      // v3.751 Bug fix：
      //   1. 改用 getEffectiveHP（夠讚狗｜腎上腺力量 等特性把 HP 推高，原本用 card.hp 會誤判）
      //   2. 加 gate：只在 ON_DAMAGED hooks 實際把傷害推到攻擊方身上時才觸發
      //      （否則之前的「攻擊方進攻時自己被 KO」會誤掛上「反彈傷害」標籤）
      {
        const retaliatedAtk = newState.players[aIdx].active;
        if (retaliatedAtk && retaliatedAtk.damage > atkDamageBeforeRetaliation) {
          const retAtkCard = pool.get(retaliatedAtk.cardId);
          const retAtkEffHP = getEffectiveHP(retaliatedAtk, pool, newState);
          if (retAtkEffHP > 0 && retaliatedAtk.damage >= retAtkEffHP) {
            const retKoDiscard: CardInstance[] = [
              retaliatedAtk,
              ...retaliatedAtk.energyAttached,
              ...getAllAttachedTools(retaliatedAtk),
              ...(retaliatedAtk.evolvedFromStack ?? []),
            ];
            const retKOPrizes = prizesForKO(retAtkCard!);
            const retPlayers = [...newState.players] as [PlayerState, PlayerState];
            retPlayers[aIdx] = {
              ...retPlayers[aIdx],
              active: null,
              discard: [...retPlayers[aIdx].discard, ...retKoDiscard],
            };
            newState = addLog(
              addPendingPrize({ ...newState, players: retPlayers }, dIdx, retKOPrizes, pool),
              `${retAtkCard!.name} 被反彈傷害擊倒！${newState.players[dIdx].name} 取得 ${retKOPrizes} 張獎賞卡。`,
              null,
            );
            // 攻擊方沒有備戰寶可夢 → 直接終局
            if (retPlayers[aIdx].bench.length === 0) {
              return {
                ...newState,
                phase: 'game-over',
                winner: dIdx,
                winReason: `${retPlayers[aIdx].name} 沒有可上場的寶可夢`,
                log: [
                  ...newState.log,
                  { turn: newState.turn, playerIndex: null as null, message: `${retPlayers[aIdx].name} 沒有可上場的寶可夢，${newState.players[dIdx].name} 獲勝！` },
                ],
              };
            }
          }
        }
      }
    }

    // ── 龐克頭盔反彈 40：在防守方狀態已提交後套用，避免被覆蓋 ──────────────────
    if (punkReflectDamage > 0) {
      const refPlayers = [...newState.players] as [PlayerState, PlayerState];
      const atkP = { ...refPlayers[aIdx] };
      if (atkP.active) {
        const atkNewDmg = atkP.active.damage + punkReflectDamage;
        const atkCardForKO = pool.get(atkP.active.cardId);
        const updatedAtk = { ...atkP.active, damage: atkNewDmg };
        atkP.active = updatedAtk;
        refPlayers[aIdx] = atkP;
        newState = addLog(
          { ...newState, players: refPlayers },
          `🔧 龐克頭盔：${attackerCard.name} 受到 ${punkReflectDamage} 傷害反擊！`,
          null,
        );
        // v2.300 Bug fix：反彈傷害打死攻擊方時，需立即 KO 處理（sanityKOSweep 只掃 dIdx，不掃 aIdx）
        // v3.751：改用 getEffectiveHP（同 line 4297 修法）
        const atkEffHP = getEffectiveHP(updatedAtk, pool, newState);
        if (atkEffHP > 0 && atkNewDmg >= atkEffHP) {
          const deadAtk = atkP.active;
          const koDiscard: CardInstance[] = [
            deadAtk,
            ...deadAtk.energyAttached,
            ...getAllAttachedTools(deadAtk),
            ...(deadAtk.evolvedFromStack ?? []),
          ];
          const punkKOPrizes = prizesForKO(atkCardForKO!);
          const punkRefPlayers2 = [...newState.players] as [PlayerState, PlayerState];
          punkRefPlayers2[aIdx] = {
            ...punkRefPlayers2[aIdx],
            active: null,
            discard: [...punkRefPlayers2[aIdx].discard, ...koDiscard],
          };
          // 防守方（dIdx）得到獎賞卡（放進 pendingPrizes 讓 UI 取牌）
          newState = addLog(
            addPendingPrize({ ...newState, players: punkRefPlayers2 }, dIdx, punkKOPrizes, pool),
            `${attackerCard.name} 被龐克頭盔的反彈傷害擊倒！${newState.players[dIdx].name} 取得 ${punkKOPrizes} 張獎賞卡。`,
            null,
          );
          // 若攻擊方場上空了（無備戰）→ 直接終局
          if (punkRefPlayers2[aIdx].bench.length === 0) {
            return {
              ...newState,
              phase: 'game-over',
              winner: dIdx,
              winReason: `${punkRefPlayers2[aIdx].name} 沒有可上場的寶可夢`,
              log: [
                ...newState.log,
                { turn: newState.turn, playerIndex: null as null, message: `${punkRefPlayers2[aIdx].name} 沒有可上場的寶可夢，${newState.players[dIdx].name} 獲勝！` },
              ],
            };
          }
        }
      }
    }
      return null;
    };
    // 呼叫點不變：仍於傷害套用後、postFn 前同步結算 KO（Phase 3 才會移到 postFn 後）。
    const _koEnd = resolveKnockouts();
    if (_koEnd) return _koEnd;

    // ── 招式後置效果（回復、移動能量、觸發 pendingSelection 等）──────────────
    // v2.191 陳舊的背蓋化石（戰鬥場）— 不會受到對手寶可夢使用招式的「效果」影響
    //   傷害正常結算（已在 baseDamage 計算完成），這裡跳過 ATTACK_POST 階段——
    //   絕大多數 POST 是對 defender 的附加效果（中毒、扣能量、丟道具等），
    //   全跳過符合卡面語意。極少數 POST 包含 attacker self-effect（如自附能量）會被誤殺，
    //   屬於可接受的 trade-off（PTCG 常見的 self-effect 通常在 ATTACK_PRE / 招式主流程處理）。
    const defActiveAfterDmg = newState.players[dIdx].active;
    const defCardAfterDmg = defActiveAfterDmg ? pool.get(defActiveAfterDmg.cardId) : null;
    const shellFossilImmune = defActiveAfterDmg?.fossilOnField
      && defCardAfterDmg?.name === '陳舊的背蓋化石';
    if (shellFossilImmune) {
      newState = addLog(newState,
        `陳舊的背蓋化石：免疫招式效果（只擋指向它的效果；玩家層級效果如「物品/支援者鎖」照常生效）`, dIdx);
    }
    // v2.78 純樸 — defender immuneToAttackEffectsThisTurn → skip ATTACK_POST 附加效果
    // v5.238 擴展：
    //   - 飛翔（喇叭啄鳥/咕咕鴿）/ 要害斬（具甲武者）— 卡面「不受招式的傷害和效果」
    //     → immuneToAllAttackThisTurn 同時擋 POST。
    //     玩家回報：飛翔正面後，下回合受胡地手之力量攻擊，傷害指示物仍被放上。
    //   - 阿塞蘿拉的惡作劇 — 卡面「不受【ex】寶可夢的招式的傷害與效果」
    //     → immuneToExAttackThisTurn 在 attacker is ex 時擋 POST。
    //   - 中立中心/精神防護/閃光屏障/塗層攻擊 卡面只擋「傷害」不寫「效果」，POST 不擋。
    const defActiveForPost = newState.players[dIdx].active;
    const postNuetralImmune = defActiveForPost?.immuneToAttackEffectsThisTurn ?? false;
    const postAllImmune = defActiveForPost?.immuneToAllAttackThisTurn ?? false;
    const postExImmune = (defActiveForPost?.immuneToExAttackThisTurn ?? false)
                          && isRulePokemon(attackerCard);
    // v5.333：per-turn 免疫旗標不再整段跳過 POST（會誤殺 self/備戰snipe/對手手牌牌庫/競技場 等
    //   「目標非我方戰鬥位」的效果）。改由 canApplyEffectToTarget per-target guard 精準擋「指向免疫
    //   active」的效果（defense.ts 1b-2 + 各 defender 效果 POST helper 走 guard）。
    //   （陳舊的背蓋化石 shellFossilImmune 暫維持 blanket，範圍窄、另由 canApplyAttackEffectToTarget 補。）
    // v5.930 陳舊的背蓋化石不再 blanket skip 整個 POST(原會誤擋玩家層級 lock 如海之影物品鎖,
    //   且會誤殺攻擊方 self-effect)。POST 照跑;指向此寶可夢的效果由 canApplyAttackEffectToTarget
    //   legacy guard(effects.ts fossil short-circuit)+ 下方 canApplyEffectToTarget 還原 sweep 擋
    //   (背蓋守護在該 guard 函式最前端,凡擋化隱/純樸者必擋此);玩家層級效果(不指向此寶可夢)照常生效。
    //   (defense.ts 605 僅文件登記,非行為碼。)比照 v5.333 純樸/飛翔/阿塞蘿拉 pattern。
    const postFn = ATTACK_POST.get(effectKey);
    // v5.333：以下僅資訊性提示「我方戰鬥寶可夢本回合免疫」；實際擋下由 per-target guard 精準處理
    //   （只擋指向此 active 的傷害/效果，目標非我方戰鬥位的效果照常執行）。
    if (postNuetralImmune) {
      newState = addLog(newState, `${defenderCard?.name ?? '?'} 免疫招式效果（只擋指向它的效果，其他照常）`, dIdx);
    } else if (postAllImmune) {
      newState = addLog(newState, `${defenderCard?.name ?? '?'} 免疫招式傷害與效果（只擋指向它的部分，其他照常）`, dIdx);
    } else if (postExImmune) {
      newState = addLog(newState, `${defenderCard?.name ?? '?'} 免疫【ex】招式傷害與效果（只擋指向它的部分，其他照常）`, dIdx);
    }
    if (postFn) {
      // v2.156：把 action 也傳給 POST，讓「PRE/POST 共享 chosenIids」的 option 招式
      // （如 激流水泵）能在 POST 階段判斷玩家是否棄了能量
      newState = postFn(newState, aIdx, pool, action);
    }
    // v5.344（v5.343 一般化）：集中修「對招式效果免疫的防守 active（薄霧能量 / 硬岩【鬥】能量 /
    //   皇帝之勢 / 抵抗之幕 / 純樸 / 阿塞蘿拉 / 對戰圓形 / 球形盾牌 / 藏隱 / 化石 等，皆由 unified
    //   canApplyEffectToTarget('attack-effect') 認列）仍被招式『新加上』狀態/封退/封招」。
    //   背景：v5.333 只修中央 defCantRetreatNextPost；statusPost 與中央 defCantAttackNextPost 已 guard，
    //   但伊裴爾塔爾|緊抓(inline) / 各卡檔本地 helper / 毒陣・雙狀態類「inline 直接設 status/secondaryStatus」
    //   等仍會繞過。此處在 ATTACK_POST 後集中比對：若防守 active 對招式效果免疫，且『本次』新加了
    //   status / secondaryStatus / cantRetreatNextTurn / cantAttackPending(封招) → 一律還原（薄霧/硬岩卡面
    //   「不會受到對手寶可夢招式的『效果』的影響」；傷害不在此還原，照常結算）。已 guard 的 applier
    //   在免疫時本就不會新增這些欄位 → 此 sweep 對它們 no-op，無副作用。
    {
      const _b = defender.active;
      const _a = newState.players[dIdx].active;
      if (_a && _b && _a.iid === _b.iid) {
        const _gr = canApplyEffectToTarget(newState, aIdx, _a, pool.get(_a.cardId), 'attack-effect', pool);
        if (_gr.blocked) {
          const _da: any = { ..._a };
          const _bAny = _b as any;
          let _reverted = false;
          // 本次「新加」異常狀態 → 還原成攻擊前；只還原「新增/變更為非空狀態」，不還原被治癒清空的。
          // v6.046：補上第三狀態槽（原本只掃 status/secondaryStatus，三槽制下第三槽會漏）。
          for (const _sf of ['status', 'secondaryStatus', 'tertiaryStatus'] as const) {
            if (_da[_sf] && _da[_sf] !== _bAny[_sf]) { _da[_sf] = _bAny[_sf]; _reverted = true; }
          }
          // ⭐v6.046：其餘 debuff 旗標改由 instance-flags 的 OPP_ATTACK_DEBUFF_FLAGS 驅動。
          //   原本這裡**硬編**只還原 cantRetreatNextTurn + cantAttackPending 兩個，其餘 15 個
          //   跨回合 debuff 旗標整類不在名單內 → 玩家回報「附【薄霧能量】仍被強烈之吻丟棄」
          //   （strongKissDiscardPending）就是漏網的一員。改成清單驅動後，新增旗標只要歸類，
          //   這道兜底自動涵蓋（枚舉守衛 test-opp-debuff-immunity 會逼新欄位表態）。
          for (const _f of OPP_ATTACK_DEBUFF_FLAGS) {
            const _av = _da[_f as string];
            const _bv = _bAny[_f as string];
            if (_av !== undefined && _av !== _bv) {
              if (_bv === undefined) delete _da[_f as string]; else _da[_f as string] = _bv;
              _reverted = true;
            }
          }
          if (_reverted) {
            const _players = [...newState.players] as [PlayerState, PlayerState];
            _players[dIdx] = { ..._players[dIdx], active: _da };
            newState = addLog({ ...newState, players: _players },
              `招式效果：${_gr.reason}（${defenderCard?.name ?? '?'} 不受招式效果影響，傷害照常）`, aIdx);
          }
        }
      }
    }
    // v4.991: ATTACK 流程結尾統一 set turnPhase='end' — 修玩家 case 1 卡死。
    //   之前 KO 分支跳過 turnPhase 設定（line 4751 只有「沒 KO」分支 set），
    //   導致 END_TURN handler (line 1330 check turnPhase==='end') 拒絕處理，
    //   玩家取完獎賞 + 對手補位後點「結束」按鈕無效 → 卡死。
    //   game-over case 已在 line 4660 區 return 不會跑到這。
    if (newState.phase === 'playing') {
      newState = { ...newState, turnPhase: 'end' as const };
    }
    // v3.892：清掉 attack-time snapshot transient flag（attack flow 結束）
    // v4.47 P2：若 POST 開了 pendingSelection（油之機關槍 / hitBenchPickPost），
    //   snapshot 必須跨 dispatch 保留到 resolver 跑完（resolver 內 resolveBenchGuard 仍要讀）。
    //   pendingSelection 為空時才清；resolver 結束後若 pending 已消，由 applyAction wrapper
    //   統一清（line 5970 附近，markHealsByDamageDecrease 之後）。
    if (newState._attackTimeOppFlowerVeil !== undefined && !newState.pendingSelection) {
      const cleared = { ...newState };
      delete cleared._attackTimeOppFlowerVeil;
      newState = cleared;
    }
    if (newState._attackTimeCalmGround !== undefined && !newState.pendingSelection) {
      const cleared = { ...newState };
      delete cleared._attackTimeCalmGround;
      newState = cleared;
    }
    // v5.186：抵抗之幕 snapshot 同步清除
    if (newState._attackTimeOppRocketVeil !== undefined && !newState.pendingSelection) {
      const cleared = { ...newState };
      delete cleared._attackTimeOppRocketVeil;
      newState = cleared;
    }
    // v5.237：球形盾牌 snapshot 同步清除
    if (newState._attackTimeOppBugShield !== undefined && !newState.pendingSelection) {
      const cleared = { ...newState };
      delete cleared._attackTimeOppBugShield;
      newState = cleared;
    }
    // v5.325：太古防壁能量快照 同步清除
    if (newState._attackTimeAttackerEnergyUnits !== undefined && !newState.pendingSelection) {
      const cleared = { ...newState };
      delete cleared._attackTimeAttackerEnergyUnits;
      newState = cleared;
    }

    // v2.69 瘋狂炸彈追蹤 — 招式結算後寫入攻擊方 active.attackUsedThisTurn
    {
      const curAtk = newState.players[aIdx].active;
      if (curAtk) {
        const newPlayers = [...newState.players] as [PlayerState, PlayerState];
        newPlayers[aIdx] = { ...newPlayers[aIdx], active: { ...curAtk, attackUsedThisTurn: attack.name } };
        newState = { ...newState, players: newPlayers };
        // v5.911 輪番狂攻:記錄「古代」寶可夢本回合使招的 iid(遊戲層級,存活至 KO 離場後)
        const _atkCard = pool.get(curAtk.cardId);
        if (_atkCard?.tags?.includes('古代')) {
          const _prevAnc = newState.ancientAttackedIidsThisTurn ?? [[], []];
          const _arr = [...(_prevAnc[aIdx] ?? [])];
          if (!_arr.includes(curAtk.iid)) _arr.push(curAtk.iid);
          const _nextAnc: [string[], string[]] = [_prevAnc[0] ?? [], _prevAnc[1] ?? []];
          _nextAnc[aIdx] = _arr;
          newState = { ...newState, ancientAttackedIidsThisTurn: _nextAnc };
        }
      }
    }

    // ── v2.92/v2.195：回力鏢能量 / 燃料【火】能量 revive（v5.678 收斂單一 helper）──
    newState = reviveAttackDiscardedSpecialEnergy(
      newState, aIdx, boomerangSnapshotIids, boomerangAttackerActiveIid, fuelFireSnapshotIids, pool);
    // v5.678：若招式以 picker 收尾（自身丟能量等），丟棄在後續 RESOLVE_SELECTION 才發生，
    //   此處同步 revive 抓不到 → 存快照，待 picker 鏈解完於 RESOLVE_SELECTION 再 revive 一次。
    if (newState.pendingSelection && (boomerangSnapshotIids.length > 0 || fuelFireSnapshotIids.length > 0)) {
      newState = { ...newState, _pendingAttackEnergyRevive: {
        aIdx, boomIids: boomerangSnapshotIids, boomActiveIid: boomerangAttackerActiveIid, fuelIids: fuelFireSnapshotIids } };
    }

    // ── 被動反擊特性（毒刺、灼熱之軀、反擊等）— 只對有實際傷害的招式觸發 ──
    // v2.387：超級皮可西ex｜光之翼 — 攻擊方持有此特性時，免疫對手特性反擊效果。
    // v5.113 KO 重複觸發修：v5.081 已在 KO branch (L4989) 補跑 PASSIVE_RETALIATION，
    //   共用版只在「沒走 KO branch」時跑（即 !wouldBeKO || preventedKO），
    //   否則甲殼刺/毒刺/灼熱之軀等會在 KO 時觸發 2 次（玩家回報）。
    const attackerHasMagicalShine = attackerCard?.abilities?.some(a => a.name === '光之翼') ?? false;
    const _v5113RanInKoBranch = wouldBeKO && !preventedKO;
    if (!_v5113RanInKoBranch && baseDamage > 0 && defenderCard.abilities && !attackerHasMagicalShine) {
      for (const ab of defenderCard.abilities) {
        if (!isAbilityHolderEffective(newState, newState.players[dIdx].active, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.656 非KO分支反擊/受傷觸發 gate
        const retal = PASSIVE_RETALIATION.get(ab.name);
        if (retal) newState = retal(newState, dIdx, pool);
      }
    } else if (!_v5113RanInKoBranch && baseDamage > 0 && defenderCard.abilities && attackerHasMagicalShine) {
      newState = addLog(newState,
        `光之翼：${attackerCard?.name ?? '?'} 不受對手特性效果影響（${defenderCard.abilities.map(a => a.name).join('、')} 無效）`,
        aIdx);
    }
    // v5.494：卡面內建受傷反擊（陳舊的頭蓋化石 — 非 KO 分支；攻擊方反殺交 sanityKOSweep）。
    if (!_v5113RanInKoBranch && baseDamage > 0) newState = applyInherentRetaliation(newState, dIdx, defenderCard, pool);

    // v2.992 PASSIVE_ON_DAMAGED（火箭隊的瓦斯彈 警備濁霧）— 受傷觸發 deck search
    // v5.113 KO 重複觸發修：v5.081 KO branch L4994 已跑過，這裡共用版加 KO gate
    if (!_v5113RanInKoBranch && baseDamage > 0 && defenderCard.abilities && !attackerHasMagicalShine) {
      for (const ab of defenderCard.abilities) {
        if (!isAbilityHolderEffective(newState, newState.players[dIdx].active, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.656 非KO分支反擊/受傷觸發 gate
        const fnOD = PASSIVE_ON_DAMAGED.get(ab.name);
        if (fnOD) newState = fnOD(newState, dIdx, aIdx, pool, defenderCard);
      }
    }

    // v5.083：花岩怪|怨恨旋渦 field-wide — 「只要這隻寶可夢在場上」涵蓋備戰。
    //   既有 PASSIVE_RETALIATION 主 loop 只 scan defenderCard.abilities，
    //   花岩怪在備戰時觸發不到（玩家回報「完全沒觸發」）。
    //   gate：defender.active.pokemonType === 'Darkness'（自方戰鬥場必為【惡】）。
    //   只 scan defender.bench 上的花岩怪（active 花岩怪已在主 loop 觸發過此 ability）。
    //   光之翼亦擋（同 PASSIVE_RETALIATION 既有準則）。
    // v5.113 KO 重複觸發修：v5.083 KO branch L5006 已跑過，這裡共用版加 KO gate
    if (!_v5113RanInKoBranch && baseDamage > 0 && !attackerHasMagicalShine) {
      const defActiveNK = newState.players[dIdx].active;
      const defActiveCardNK = defActiveNK ? pool.get(defActiveNK.cardId) : null;
      if (defActiveCardNK?.pokemonType === 'Darkness') {
        for (const benchInst of newState.players[dIdx].bench) {
          const benchCard = pool.get(benchInst.cardId);
          if (!benchCard?.abilities) continue;
          for (const ab of benchCard.abilities) {
            if (ab.name === '怨恨旋渦') {
              if (!isAbilityHolderEffective(newState, benchInst, benchCard, dIdx, '怨恨旋渦', 'bench', pool)) continue; // v5.656
              const fn = PASSIVE_RETALIATION.get('怨恨旋渦');
              if (fn) newState = fn(newState, dIdx, pool);
            }
          }
        }
      }
    }

    // v2.382：殼捲風旋轉 retaliation — defender 有 retaliateCountersOnNextHit flag
    //   → 對 attacker active 放 N 個指示物（= N×10 damage），消費後清除 flag。
    //   只對有實際傷害的招式觸發（與 PASSIVE_RETALIATION 同準則）。
    if (baseDamage > 0) {
      const dPlayer = newState.players[dIdx];
      const _retalFlag = dPlayer.active?.retaliateCountersOnNextHit;
      // v5.979：'mirror'(藏瑪然特強大猛擊)=放與實際受傷(baseDamage)相同數值;數值型(還擊斧8/等待角擊6/殼捲風旋轉12)=固定 N。
      const retalN = _retalFlag === 'mirror' ? Math.floor(baseDamage / 10) : (typeof _retalFlag === 'number' ? _retalFlag : 0);
      if (retalN > 0) {
        const refPlayers = [...newState.players] as [PlayerState, PlayerState];
        // 套用 retaliation damage 到 attacker active
        if (refPlayers[aIdx].active) {
          refPlayers[aIdx] = {
            ...refPlayers[aIdx],
            active: { ...refPlayers[aIdx].active!, damage: refPlayers[aIdx].active!.damage + retalN * 10 },
          };
        }
        // 消費 flag
        if (refPlayers[dIdx].active) {
          const newAct = { ...refPlayers[dIdx].active! };
          delete newAct.retaliateCountersOnNextHit;
          refPlayers[dIdx] = { ...refPlayers[dIdx], active: newAct };
        }
        newState = addLog(
          { ...newState, players: refPlayers },
          `反擊：對攻擊方放 ${retalN} 個傷害指示物（${retalN * 10} 點傷害）`,
          dIdx,
        );
      }
    }

    // v2.132：sanity sweep — 雙方 active/bench 任何 damage ≥ HP 卻仍在場上者，強制 KO。
    //   觸發點：Leon 用幻影奇襲 200 點打 70HP 土龍弟弟，土龍弟弟被觀察到「damage 200 仍在備戰」。
    //   理論上 KO 流程已在上方處理，但 postFn / 反擊 / 多目標 resolver 可能漏處理某條 path。
    //   做為防呆：每次招式結算後掃過全場，把 zombie 寶可夢移到棄牌（給對手獎賞）。
    newState = sanityKOSweep(newState, aIdx, pool);

    // v2.335：祭典樂舞完整 state-machine：第 1 次招式即使 KO 對手戰鬥位，也要先保留
    // 第 2 次招式權；待獎賞卡與對手新戰鬥寶可夢處理完成後，再回到 main 使用第 2 次招式。
    // v5.201：傳 action.attackIndex 讓 auto-second-attack 知道要重打哪個招式
    newState = startFestivalDanceSecondAttackWindow(newState, aIdx, pool, action.attackIndex);

    // v4.898/v4.899 重試徽章 — ATTACK 末端條件 check（位置已修為 ATTACK handler 內）
    // v5.165 重設計：modal popup 時 engine **rollback state 回 preAttackStateForRetry**，
    //   讓玩家看到 modal 時對手 HP 還未變——確認後 (keep / retry) 才透過 handlePlaying 重跑
    //   ATTACK 正式套傷害。符合 Wilson 反饋與 PTCG 「玩家確認後才結算」精神。
    //   觸發條件：
    //     - state.coinFlippedThisAttack === true（本次 ATTACK 有擲幣）
    //     - attacker active 還存在
    //     - attacker pokemonType === 'Colorless'（卡面「無屬性寶可夢」）
    //     - attacker 身上有 重試徽章 工具
    //     - 攻擊方未在本回合用過 重試徽章
    //     - 無其他 pending selection 占用
    //     - action._retryBadgeAlreadyAsked !== true（避免重跑時無限循環）
    if (
      newState.coinFlippedThisAttack === true
      && newState.players[aIdx].active
      && !newState.players[aIdx].retryBadgeUsedThisTurn
      && action._retryBadgeAlreadyAsked !== true
      && !isToolsJammed(newState, pool)  /* v5.304: 阻礙之塔下道具失效, 重試徽章不發動 */
      /* v5.306: 拿掉 !newState.pendingSelection 守門 — 招式 POST 開了 picker (例如親送挑戰 2 正面後選寶可夢)
         也必須先彈 retry modal 讓玩家決定; retry block 內已用 spread ...preAttackStateForRetry revert state
         + 覆蓋 pendingSelection 為 retry modal, 玩家選 keep 重 run 時 POST 會再次 set picker. */
    ) {
      const atkInst = newState.players[aIdx].active!;
      const atkCard = pool.get(atkInst.cardId);
      const isColorless = atkCard?.pokemonType === 'Colorless';
      const hasRetryBadge = getAllAttachedTools(atkInst).some(t => pool.get(t.cardId)?.name === '重試徽章');
      // v5.265：玩家提示 — 重試徽章可附在任何寶可夢身上, 但效果僅對【無】屬性寶可夢生效.
      //   若 holder 不是【無】, 寫 log 告知玩家此次未觸發 (避免誤以為附加無效).
      if (!isColorless && hasRetryBadge) {
        newState = addLog(newState,
          `🎒 重試徽章：附在 ${atkCard?.name ?? '?'}（非【無】屬性）→ 本次效果不觸發 (卡面僅對【無】屬性寶可夢生效)`,
          aIdx);
      }
      if (isColorless && hasRetryBadge) {
        // v5.165 rollback：擷取 coinFlips 副資料給 modal，把 state revert 回攻擊前
        const coinFlips = newState._machineGunLastFlips ?? [];
        newState = {
          ...preAttackStateForRetry,
          coinFlippedThisAttack: false,
          _machineGunLastFlips: undefined,
          pendingSelection: {
            type: 'modal-choice',
            actorIdx: aIdx, sourcePlayerIdx: aIdx,
            minCount: 1, maxCount: 1,
            effectKey: 'm5-retry-badge-decide',
            params: {
              label: '重試徽章',
              preAttackState: preAttackStateForRetry,
              originalAction: action,
              coinFlips,
              attackName: attack.name,  // v5.263: 動態 attackName 讓 modal 顯示對應招式
              options: [
                { id: 'keep', text: '✅ 不重擲（使用剛才擲幣結果，套用傷害）' },
                { id: 'retry', text: '🔄 重擲（消除剛才擲幣結果，重新擲幣）— 本回合 1 次' },
              ],
            },
          },
        };
      }
    }

    return newState;
  }

  // ── 取獎賞卡 ──────────────────────────────────────────────────────────────
  if (action.type === 'TAKE_PRIZES') {
    // v2.98：playerIdx 指明哪一側取獎；不再依賴 activePlayerIndex（對手回合也可取）
    const ownerIdx = action.playerIdx;
    const owed = getPendingPrize(state, ownerIdx);
    if (owed <= 0) return state;
    const taker = state.players[ownerIdx];
    const count = Math.min(action.count, taker.prizes.length, owed);
    if (count <= 0) return state;
    // v5.878：若存在「正面朝上」的獎賞卡（克雷色利亞｜弦月光芒翻開的），讓玩家選擇要不要取走
    //   那張已知的卡。無正面獎賞 → 維持原本「從前端取」（玩家分辨不出蓋著的獎賞，前端取＝隨機取，
    //   對玩家無差異，正常對局完全不受影響）。
    const faceUpPrize = taker.prizes.find(c => c.faceUp);
    if (faceUpPrize) {
      // v5.880：有正面朝上獎賞 → 逐張 picker 讓玩家指定（可取多張正面的），手機純文字友善。
      return openPrizeTakePicker(state, ownerIdx, count, pool);
    }
    // 無正面獎賞：維持原「從前端取」
    const frontIids = taker.prizes.slice(0, count).map(c => c.iid);
    return takeSpecificPrizes(state, ownerIdx, frontIids, pool);
  }

  // ── 對手送出新的出場寶可夢（被擊倒後） ──────────────────────────────────
  if (action.type === 'SEND_NEW_ACTIVE') {
    // senderIdx 明確指定時使用（線上模式），否則回落到 aIdx（本機模式）
    const sendingIdx: 0 | 1 = action.senderIdx ?? aIdx;
    const sendingPlayer = { ...players[sendingIdx] };

    if (sendingPlayer.active !== null) return state; // 還有出場寶可夢

    const benchIdx = sendingPlayer.bench.findIndex((c) => c.iid === action.iid);
    if (benchIdx < 0) return state;
    // movedToActiveThisTurn 只在「自己的回合」補場時設置（用於疾風直撞等條件招式）。
    // 若是因對手回合 KO 後被迫補場（sendingIdx ≠ activePlayerIndex），則不設，
    // 避免下一自己回合疾風直撞 +170 誤觸發。
    const isOwnTurn = sendingIdx === state.activePlayerIndex;
    // v5.258 defensive: 從 bench → active 時用 clearActiveEffects 清 active-only flags
    //   理論上 bench inst 不該帶 cantAttackPending/cantAttackThisTurn 等 (應在退場時已清),
    //   但若某 swap/retreat resolver 漏走 clearActiveEffects, 新 active 會殘留導致不能攻擊.
    //   重複清不會造成任何 bug (clearActiveEffects 只動 active-only flags, 不動 energy/tool).
    //   保留 movedToActiveThisTurn (本回合補場 flag 是 SEND_NEW_ACTIVE 後才加的).
    // v5.527：bench→active 升場不清任何狀態（PTCG 規則：戰鬥場→備戰清、備戰→戰鬥場不清）。
    //   所有 active→bench 退場路徑均走中央 clearActiveEffects 完整清除（含 m5 換場 v5.527 收斂），
    //   備戰 instance 不會殘留 active-only 鎖 → 升場直接保留全部(含奔流之心 buff)，與撤退一致。
    const benchInst = sendingPlayer.bench[benchIdx];
    const newActive = { ...benchInst, ...(isOwnTurn ? { movedToActiveThisTurn: true } : {}) };
    sendingPlayer.bench = sendingPlayer.bench.filter((_, i) => i !== benchIdx);
    sendingPlayer.active = newActive;

    players[sendingIdx] = sendingPlayer;
    const newActiveCard = getCard(newActive.cardId, pool);

    let newState: GameState = addLog(
      { ...state, players },
      `${sendingPlayer.name} 送出了 ${newActiveCard.name}！`,
      sendingIdx
    );

    // v2.124：偵測 endTurnContinueAfterKO — 表示這是 self-KO 後補戰鬥位
    // → 補完後 re-dispatch END_TURN 並設 endTurnSkipCheckup（避免重跑 checkup 造成重複放傷害），
    // 直接進入 finalize（清旗標 + 切換玩家 + 抽牌）。
    // 錦標賽修正：用 != null（非 !== undefined）— 錦標賽 gameState 存 MongoDB，undefined 會被 round-trip 成 null，
    //   原 !== undefined 對 null 為真 → 誤入 self-KO continue 分支、把 activePlayerIndex 設成 null →
    //   重跑 END_TURN 時 players[null].active 崩潰「Cannot read properties of undefined (reading active)」。
    if (state.endTurnContinueAfterKO != null) {
      const continueIdx = state.endTurnContinueAfterKO;
      let cleared: GameState = {
        ...newState,
        endTurnContinueAfterKO: undefined,
        endTurnSkipCheckup: true,
      };
      // 確保 activePlayerIndex 正確，這樣 END_TURN 處理者是當初被 KO 的那方
      if (cleared.activePlayerIndex !== continueIdx) {
        cleared = { ...cleared, activePlayerIndex: continueIdx };
      }
      return applyAction(cleared, { type: 'END_TURN' }, pool);
    }

    // 勝利條件：對手無法送出寶可夢（在送出前就要先檢查，這裡是送出後）
    return tryPromoteToMainForFestival(newState, pool);
  }

  // ── 結束回合 ──────────────────────────────────────────────────────────────
  if (action.type === 'END_TURN') {
    if (hasAnyPendingPrize(state)) return state;  // 取獎賞前不能結束
    if (defender.active === null) return state; // 對手必須先送出寶可夢

    // 勝利條件：對手備戰區也空了（雙重保險）
    if (defender.bench.length === 0 && defender.active === null) {
      return {
        ...state, phase: 'game-over',
        winner: aIdx,
        winReason: `${defender.name} 沒有可上場的寶可夢`,
      };
    }

    // v2.245：在 checkup *之前* 取「對手主回合結束時」snapshot。
    //   PTCG 規則：寶可夢檢查不屬於任何玩家的回合 → 中毒/灼傷/冰冷之帳等 checkup KO
    //   不算「上個對手的回合自己的寶可夢昏厥」。本 snapshot 用於精確區分主動 KO vs checkup KO。
    //   只在第一次 END_TURN（非 skipCheckup）時更新；re-dispatch 後保留原 snapshot。
    //   雙 snapshot：(a) opp prize 用於 prize-based gate（不公印章/扭轉乾坤/八朔）
    //               (b) 我方棄牌堆火箭隊寶可夢數 用於 rocket-based gate（阿波羅）
    if (!state.endTurnSkipCheckup) {
      const oppIdx = (1 - aIdx) as 0 | 1;
      // (a) opp prize snapshot
      const prevMainEnd = state.oppPrizesAtMainEnd ?? [6, 6] as [number, number];
      const newMainEnd: [number, number] = [prevMainEnd[0], prevMainEnd[1]];
      // 從「對手」視角看：剛結束回合的玩家 aIdx = 對手；對手獎賞 = players[aIdx].prizes.length
      newMainEnd[oppIdx] = players[aIdx].prizes.length;
      // (b) rocket-poke-in-discard snapshot（從即將進入新回合的玩家視角看自己的棄牌堆）
      const countRocket = (pl: PlayerState): number =>
        pl.discard.filter(c => {
          const card = pool.get(c.cardId);
          return card?.supertype === 'Pokemon' && card.name?.startsWith('火箭隊的');
        }).length;
      const prevRocketMainEnd = state.rocketInMyDiscardAtMainEnd ?? [0, 0] as [number, number];
      const newRocketMainEnd: [number, number] = [prevRocketMainEnd[0], prevRocketMainEnd[1]];
      newRocketMainEnd[oppIdx] = countRocket(players[oppIdx]);
      state = {
        ...state,
        oppPrizesAtMainEnd: newMainEnd,
        rocketInMyDiscardAtMainEnd: newRocketMainEnd,
        // v2.246 KO cause tracking — snap thisTurn → InLastOppTurn 並 reset thisTurn
        // 從 oppIdx 視角：剛結束的 aIdx 回合是「上個對手回合」，KO 計數已在過程中累積到 thisTurn
        oppAttackKOdMeInLastOppTurn: state.oppAttackKOdMeThisTurn ?? [0, 0],
        // v5.911 輪番狂攻:promote 古代使招 iid ThisTurn→LastSelfTurn(結束方 aIdx),清 ThisTurn。
        //   保留另一方 LastSelfTurn(其上回合古代紀錄,供其下次故勒頓判定)。
        ancientAttackedIidsLastSelfTurn: (() => {
          const _prev = state.ancientAttackedIidsLastSelfTurn ?? [[], []];
          const _cur = state.ancientAttackedIidsThisTurn ?? [[], []];
          const _next: [string[], string[]] = [_prev[0] ?? [], _prev[1] ?? []];
          _next[aIdx] = _cur[aIdx] ?? [];
          return _next;
        })(),
        ancientAttackedIidsThisTurn: [[], []],
        oppAbilityKOdMeInLastOppTurn: state.oppAbilityKOdMeThisTurn ?? [0, 0],
        oppAttackKOdMyRocketInLastOppTurn: state.oppAttackKOdMyRocketThisTurn ?? [0, 0],
        oppAbilityKOdMyRocketInLastOppTurn: state.oppAbilityKOdMyRocketThisTurn ?? [0, 0],
        // v5.274 赫普家族 snapshot
        oppAttackKOdMyHopInLastOppTurn: state.oppAttackKOdMyHopThisTurn ?? [0, 0],
        oppAbilityKOdMyHopInLastOppTurn: state.oppAbilityKOdMyHopThisTurn ?? [0, 0],
        oppDamageKOdMeInLastOppTurn: state.oppDamageKOdMeThisTurn ?? [0, 0],
        oppDamageKOdMyHopInLastOppTurn: state.oppDamageKOdMyHopThisTurn ?? [0, 0],
        oppDamageKOdMyAxiangInLastOppTurn: state.oppDamageKOdMyAxiangThisTurn ?? [0, 0],
        oppAttackKOdMeThisTurn: [0, 0],
        oppAbilityKOdMeThisTurn: [0, 0],
        oppAttackKOdMyRocketThisTurn: [0, 0],
        oppAbilityKOdMyRocketThisTurn: [0, 0],
        oppAttackKOdMyHopThisTurn: [0, 0],
        oppAbilityKOdMyHopThisTurn: [0, 0],
        oppDamageKOdMeThisTurn: [0, 0],
        oppDamageKOdMyHopThisTurn: [0, 0],
        oppDamageKOdMyAxiangThisTurn: [0, 0],
      };
    }

    // v2.124：把所有寶可夢 checkup（中毒/灼傷/睡眠/麻痺/雪妖女）包在 skipCheckup gate 內。
    // 第一次 END_TURN 跑 checkup；若 self-KO，設 endTurnContinueAfterKO + return；
    // SEND_NEW_ACTIVE 補完戰鬥位後 re-dispatch END_TURN 並設 endTurnSkipCheckup=true，
    // 這樣不會重跑 checkup（避免重複放傷害），直接進到 finalize。
    if (!state.endTurnSkipCheckup) {
    // v2.181 修正：寶可夢檢查階段對「雙方戰鬥寶可夢」都跑中毒/灼傷判定（PTCG 官方規則）。
    //   舊版只跑 players[aIdx]（剛結束回合的玩家），導致對手的中毒/灼傷寶可夢在自己回合
    //   末才扣血、跨回合不扣血 — 違反規則。
    //   - 中毒：每個寶可夢檢查階段（雙方回合結束都觸發）+10
    //   - 灼傷：每個寶可夢檢查階段 +20，再擲幣決定是否解除
    //   順序：先處理 aIdx 方（剛結束回合的玩家），再處理 dIdx 方（對手）。
    //   KO 時 endTurnContinueAfterKO=aIdx 觸發 SEND_NEW_ACTIVE re-dispatch；
    //   re-dispatch 帶 endTurnSkipCheckup=true 跳過剩餘 checkup（罕見的雙方同時 KO 不重跑）。

    // ── 中毒（雙方各檢查一次）─────────────────────────────────────────────
    for (const tIdx of [aIdx, dIdx] as const) {
      const oIdx = (1 - tIdx) as 0 | 1;
      const poisonPlayer = { ...players[tIdx] };
      // v2.163：同時兩狀態（如危險光線）— 中毒可能落在 secondaryStatus 格。
      // v5.295: 加 tertiaryStatus 掃描 (PTCG 規則允許中毒+灼傷+混亂並存)
      if (poisonPlayer.active?.status !== 'poisoned' && poisonPlayer.active?.secondaryStatus !== 'poisoned' && poisonPlayer.active?.tertiaryStatus !== 'poisoned') {
        continue;
      }
      const poisonedCard = pool.get(poisonPlayer.active.cardId);
      const stadiumName = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
      let poisonBonus = 0;
      if (stadiumName === '危險密林' && poisonedCard?.pokemonType !== 'Darkness') poisonBonus += 20;
      // 劇毒支配（桃歹郎）— 「中毒方的對手」active 是劇毒支配時 +50
      // v5.507：須查 isAbilityHolderEffective — 中毒方(我方)振翼髮｜暗夜羽擊在戰鬥場時，
      //   對手 active 的劇毒支配被消除 → 不加 +50（玩家回報暗夜羽擊沒擋住劇毒支配）。
      const oActiveInst = state.players[oIdx].active;
      const oActiveCard = oActiveInst ? pool.get(oActiveInst.cardId) : null;
      const hasDominatingPoisonOnActive = !!oActiveInst && !!oActiveCard
        && (oActiveCard.abilities?.some(a => a.name === '劇毒支配') ?? false)
        && isAbilityHolderEffective(state, oActiveInst, oActiveCard, oIdx, '劇毒支配', 'active', pool);
      if (hasDominatingPoisonOnActive) poisonBonus += 50;
      const poisonBaseDamage = poisonPlayer.active.poisonDamagePerCheckup ?? 10;
      const poisonTotalDmg = poisonBaseDamage + poisonBonus;
      const newDmg = poisonPlayer.active.damage + poisonTotalDmg;
      const poisonedHP = getEffectiveHP(poisonPlayer.active, pool, state);
      // v5.192：致死分支前先 addLog 顯示實際傷害（避免玩家看不到飄字直接跳 KO）
      //   原本致死直接走 KO log，玩家無法確認致死猛毒等強化中毒的實際傷害值
      state = addLog({ ...state, players }, `中毒：${pool.get(poisonPlayer.active.cardId)?.name ?? '?'} 受到 ${poisonTotalDmg} 傷害！`, null);
      if (poisonedHP > 0 && newDmg >= poisonedHP) {
        // 被毒死 → KO；獎賞給「中毒方的對手」(oIdx)
        const koDiscard2: CardInstance[] = [
          { ...poisonPlayer.active, damage: newDmg },
          ...poisonPlayer.active.energyAttached,
          ...getAllAttachedTools(poisonPlayer.active),
          ...(poisonPlayer.active.evolvedFromStack ?? []),
        ];
        poisonPlayer.discard = [...poisonPlayer.discard, ...koDiscard2];
        poisonPlayer.active = null;
        players[tIdx] = poisonPlayer;
        const poisonPrizes = prizesForKO(poisonedCard!);
        // v5.889：取獎收斂到中央 addPendingPrize(與一般 KO / 冰冷之帳一致):有正面朝上獎賞開 picker、
        //   私訊揭示取得的卡名(對手看張數)、取完所有獎賞判勝。原 direct-slice 繞過此三者。
        let poisonState = addLog({ ...state, players }, `${poisonedCard?.name ?? '?'} 被中毒傷害擊倒！`, null);
        poisonState = addPendingPrize(poisonState, oIdx, poisonPrizes, pool);
        players[0] = poisonState.players[0]; players[1] = poisonState.players[1];  // 同步(避免後續 {...state,players} 用 stale players 覆蓋獎賞)
        if (poisonState.phase === 'game-over') return poisonState;  // addPendingPrize 內部已判「取完所有獎賞獲勝」
        if (poisonPlayer.bench.length === 0) {
          return { ...poisonState, phase: 'game-over', winner: oIdx, winReason: `${poisonPlayer.name} 沒有可上場的寶可夢` };
        }
        // SEND_NEW_ACTIVE 由被毒死方（tIdx）補；re-dispatch END_TURN 仍以 aIdx 為 activePlayerIndex
        // v5.764：不 early-return — 設 state 後繼續跑完剩餘 checkup(對手中毒/灼傷、雙方睡眠醒幣、
        //   麻痺解除)。§11 規則:寶可夢檢查須完整結算雙方所有特殊狀態;補位延到狀態區結尾統一處理。
        state = poisonState;
      } else {
        poisonPlayer.active = { ...poisonPlayer.active, damage: newDmg };
        players[tIdx] = poisonPlayer;
        // v5.192：log 已在致死前統一 addLog，此處不再重複（避免雙重 log）
      }
    }

    // ── 灼傷（雙方各檢查一次）─────────────────────────────────────────────
    for (const tIdx of [aIdx, dIdx] as const) {
      const oIdx = (1 - tIdx) as 0 | 1;
      const burnedPlayer = { ...players[tIdx] };
      // v5.295: 加 tertiaryStatus 掃描
      if (burnedPlayer.active?.status !== 'burned' && burnedPlayer.active?.secondaryStatus !== 'burned' && burnedPlayer.active?.tertiaryStatus !== 'burned') {
        continue;
      }
      const burnedCard = pool.get(burnedPlayer.active.cardId);
      // v3.0 鴨嘴炎獸｜熔岩波動 — 對手場上有此卡時，灼傷指示物 +3（=+30 傷害）。
      const burnBonus = magmarFlowingBurnBonus(state, oIdx, pool);
      const burnTotalDmg = 20 + burnBonus;
      const newBurnDmg = burnedPlayer.active.damage + burnTotalDmg;
      const burnedHP = getEffectiveHP(burnedPlayer.active, pool, state);
      if (burnBonus > 0) {
        state = addLog(state, `「熔岩波動」啟動：灼傷傷害 +${burnBonus}`, oIdx);
      }
      // v5.192：致死分支前先 addLog 顯示實際傷害（同中毒）
      if (burnedHP > 0 && newBurnDmg >= burnedHP) {
        state = addLog({ ...state, players }, `燒傷：${burnedCard?.name ?? '?'} 受到 ${burnTotalDmg} 傷害！`, null);
        // 燒傷致死 → KO；獎賞給對手 oIdx
        const koDiscard3: CardInstance[] = [
          { ...burnedPlayer.active, damage: newBurnDmg },
          ...burnedPlayer.active.energyAttached,
          ...getAllAttachedTools(burnedPlayer.active),
          ...(burnedPlayer.active.evolvedFromStack ?? []),
        ];
        burnedPlayer.discard = [...burnedPlayer.discard, ...koDiscard3];
        burnedPlayer.active = null;
        players[tIdx] = burnedPlayer;
        const burnPrizes = prizesForKO(burnedCard!);
        // v5.889：取獎收斂到中央 addPendingPrize(同中毒/一般 KO)。
        let burnState = addLog({ ...state, players }, `${burnedCard?.name ?? '?'} 被燒傷傷害擊倒！`, null);
        burnState = addPendingPrize(burnState, oIdx, burnPrizes, pool);
        players[0] = burnState.players[0]; players[1] = burnState.players[1];
        if (burnState.phase === 'game-over') return burnState;
        if (burnedPlayer.bench.length === 0) {
          return { ...burnState, phase: 'game-over', winner: oIdx, winReason: `${burnedPlayer.name} 沒有可上場的寶可夢` };
        }
        // v5.764：同上 — 不 early-return,繼續跑完剩餘 checkup,補位延到狀態區結尾統一處理。
        state = burnState;
      } else {
        burnedPlayer.active = { ...burnedPlayer.active, damage: newBurnDmg };
        // 擲硬幣：正面解除燒傷
        const burnFlip = flipCoinsWithLog(state, 1, `燒傷判定（${burnedCard?.name ?? '?'}）`, tIdx);
        state = burnFlip.state;
        const burnCoin = burnFlip.heads === 1;
        if (burnCoin) {
          // v2.163/v5.659：燒傷可能在 status / secondaryStatus / tertiaryStatus；只清掉燒傷「實際所在」那格。
          //   原 else-if 同時認 secondary||tertiary 卻一律清 secondaryStatus → 若燒傷在 tertiary 會誤清 secondary
          //   (例:睡眠+中毒+灼傷 → status=睡眠/secondary=中毒/tertiary=灼傷,解燒傷竟清掉中毒、燒傷反而留)。
          if (burnedPlayer.active.status === 'burned') { // status-slot-ok: checkup 燒傷解除三分支,本就依實際所在格清除(v5.659)
            burnedPlayer.active = { ...burnedPlayer.active, status: undefined };
          } else if (burnedPlayer.active.secondaryStatus === 'burned') {
            burnedPlayer.active = { ...burnedPlayer.active, secondaryStatus: undefined };
          } else if (burnedPlayer.active.tertiaryStatus === 'burned') {
            burnedPlayer.active = { ...burnedPlayer.active, tertiaryStatus: undefined };
          }
        }
        players[tIdx] = burnedPlayer;
        state = addLog({ ...state, players }, `燒傷：${burnedCard?.name ?? '?'} 受到 ${burnTotalDmg} 傷害 → ${burnCoin ? '正面：燒傷解除' : '反面：燒傷持續'}`, null);
      }
    }

    // v2.124 順序修正（按 PTCG 官方）：中毒 → 灼傷 → 睡眠 → 麻痺 → 特性
    // v2.181：睡眠 — 雙方 active 都擲幣（PTCG 規則：every Pokémon Checkup, flip coin to wake）
    //          舊版只跑 aIdx，導致對手睡眠寶可夢跨回合不擲幣 — 違反規則。
    for (const tIdx of [aIdx, dIdx] as const) {
      const sleepPlayer = { ...players[tIdx] };
      if (sleepPlayer.active?.status === 'asleep') {
        const sleeperName = pool.get(sleepPlayer.active.cardId)?.name ?? '?';
        const sleepFlip = flipCoinsWithLog(state, 1, `睡眠判定（${sleeperName}）`, tIdx);
        state = sleepFlip.state;
        const wakeCoin = sleepFlip.heads === 1;
        if (wakeCoin) {
          sleepPlayer.active = { ...sleepPlayer.active, status: undefined };
          players[tIdx] = sleepPlayer;
          state = addLog({ ...state, players }, `${sleeperName}：正面 → 醒來了！`, null);
        } else {
          state = addLog({ ...state, players }, `${sleeperName}：反面 → 仍在睡眠`, null);
        }
      }
    }

    // 特殊狀態：麻痺 — 持續到「擁有者下次自己寶可夢檢查」自動解除（PTCG 規則）
    //   只在「擁有麻痺寶可夢的玩家」結束自己回合時解除，所以僅跑 aIdx 是正確的。
    const paraPlayer = { ...players[aIdx] };
    if (paraPlayer.active?.status === 'paralyzed') {
      paraPlayer.active = { ...paraPlayer.active, status: undefined };
      players[aIdx] = paraPlayer;
      state = addLog({ ...state, players }, `${pool.get(paraPlayer.active.cardId)?.name ?? '?'} 的麻痺解除了！`, null);
    }

    // v5.764：checkup 全部狀態(中毒/灼傷/睡眠/麻痺,雙方)結算完畢後,若有任一方戰鬥位因 checkup
    //   致死(active=null) → 此時才統一補位(SEND_NEW_ACTIVE)。原本 poison/burn 致死當下 early-return
    //   會跳過剩餘 checkup,違反 §11(對手中毒/灼傷不結算、雙方睡眠不擲幣醒、麻痺不解除多停一回合)。
    // v5.889：poison/burn 取獎收斂 addPendingPrize 後,若有正面朝上獎賞會開 take-prize-choose picker
    //   (state.pendingSelection 已設,KO 方 active 亦為 null)。下面 return { ...state, endTurnContinueAfterKO }
    //   會「一併帶著 pendingSelection」返回 → pendingSelection gate 擋住 SEND_NEW_ACTIVE 直到玩家解完取獎;
    //   解完後 active 仍 null + endTurnContinueAfterKO 尚在 → SEND_NEW_ACTIVE 補位 → re-dispatch END_TURN
    //   (skipCheckup) 續跑冰冷之帳/揚沙並換回合。無 faceUp 時 addPendingPrize 自動取、pendingSelection 為 null,
    //   走原流程。故此處毋須額外 pendingSelection 分支(加了反而 return 時漏 endTurnContinueAfterKO 斷掉續跑)。
    if (state.players[aIdx].active === null || state.players[dIdx].active === null) {
      return { ...state, endTurnContinueAfterKO: aIdx };
    }
    } // v5.426：status 區（中毒/灼傷/睡眠/麻痺）到此結束（endTurnSkipCheckup gate）。

    // ── checkup 放指示物特性區（冰冷之帳 / 揚沙 等）獨立 gate ──
    // v5.426 修：原本這些特性也包在 endTurnSkipCheckup gate 內，導致中毒/灼傷致死提早 return →
    //   SEND_NEW_ACTIVE re-dispatch END_TURN(skipCheckup=true) 後整段被跳過 → 冰冷之帳/揚沙漏觸發。
    //   改用 endTurnCheckupAbilitiesDone gate：status-KO re-dispatch 時 status 區跳過、本區仍執行一次。
    //   旗標於區首設 true，避免後續 re-dispatch（力之沙漏 / 本區自身 KO 補位）重跑放第二次指示物。
    if (!state.endTurnCheckupAbilitiesDone) {
    state = { ...state, endTurnCheckupAbilitiesDone: true };

    // ── 雪妖女｜冰冷之帳 ─────────────────────────────────────────────────────
    // 卡面：只要這隻寶可夢在場上，每次寶可夢檢查時，在雙方的擁有特性的所有寶可夢
    //       （「雪妖女」除外）身上各放置 1 個傷害指示物。
    // 觸發階段：「寶可夢檢查」= 中毒/灼傷/麻痺/睡眠之後（本段落所在處）。
    // 設計：每隻雪妖女各放 1 個指示物；若場上有 N 隻雪妖女則每個目標放 N 個。
    // v2.70：KO 獎賞兩側都要計算（selfKOInstance 風格直接取獎，不走 pendingPrizes）。
    //        因為：pendingPrizes 會被 activePlayerIndex 方 TAKE_PRIZES，
    //        但 checkup 時 activePlayerIndex 仍是 aIdx，勝方卻可能是任何一方。
    //        改成直接從勝方自己的獎賞堆轉到勝方手牌（與 selfKOInstance 同樣手法）。
    // v6.049：持有者自己的特性若被消除（監視塔/初始化/暗夜羽擊/黏著束縛），冰冷之帳不生效。
    //   卡面「只要這隻寶可夢在場上」是持續型特性 —— 特性被消除就沒有這個效果。
    const countFrosmoth = (pl: PlayerState, ownerIdx: 0 | 1): number => {
      const ok = (c: CardInstance, loc: 'active' | 'bench'): boolean => {
        const cd = pool.get(c.cardId);
        if (cd?.name !== '雪妖女') return false;
        return isAbilityHolderEffective(state, c, cd, ownerIdx, '冰冷之帳', loc, pool);
      };
      let n = 0;
      if (pl.active && ok(pl.active, 'active')) n += 1;
      n += pl.bench.filter(c => ok(c, 'bench')).length;
      return n;
    };
    // v4.08：對戰圓形擋對手特性放置備戰指示物 — 改 per-side 計算
    //   - 戰鬥場：own + opp frosmoth 都生效（戰鬥場無 BENCH_PROTECTION）
    //   - 備戰：對戰圓形啟動 → 對手 frosmoth 對自方備戰的指示物被擋（「對手特性」）；
    //           自家 frosmoth 對自方備戰不擋（「自己特性」）
    const frosmothByOwner: [number, number] = [countFrosmoth(players[0], 0), countFrosmoth(players[1], 1)];
    const frosmothN = frosmothByOwner[0] + frosmothByOwner[1];
    const benchProtected = (() => {
      if (!state.activeStadium) return false;
      const c = pool.get(state.activeStadium.cardId);
      return !!c && BENCH_PROTECTION_STADIUMS.has(c.name);
    })();
    if (frosmothN > 0) {
      // addCounters 不再是常數 — active/bench 用不同 counters，移到 loop 內計算
      // v2.125：嚴格排除「雪妖女」本體 — Leon 提醒「冰冷之帳不對雪妖女自己作用」
      // 用 trim 防 scraper 字串前後空白；同時以 startsWith 排除「雪妖女ex」（若未來有的話）
      // 但「超級雪妖女ex」是不同實體（不擁有冰冷之帳，直接被 abilities.length===0 擋）
      const isFrosmothName = (card: Card | undefined): boolean => {
        const n = (card?.name ?? '').trim();
        return n === '雪妖女';
      };
      // v2.387：超級皮可西ex｜光之翼 — 不受對手寶可夢特性效果影響，
      //   冰冷之帳對其無效（不放指示物）。
      const hasMagicalShine = (card: Card | undefined): boolean => {
        return card?.abilities?.some(a => a.name === '光之翼') ?? false;
      };
      // ⭐v6.049：卡面是「**擁有特性的**所有寶可夢」。原本只看卡片印刷有沒有特性，
      //   完全不管特性有沒有被消除 → 火箭隊的監視塔（「雙方場上所有【無】寶可夢的特性
      //   全部消除」）在場時，【無】寶可夢已經沒有特性了，卻仍被放指示物（玩家回報）。
      //   鐵荊棘ex｜初始化、暗夜羽擊、黏著束縛 同理。改走中央述詞。
      const isFrosmothCheckupTarget = (c: CardInstance, ownerIdx: 0 | 1, loc: 'active' | 'bench'): boolean => {
        const card = pool.get(c.cardId);
        if (!hasAnyEffectiveAbility(state, c, card, ownerIdx, loc, pool)) return false;
        if (isFrosmothName(card)) return false;
        if (hasMagicalShine(card)) return false;  // 光之翼免疫
        return true;
      };
      // v5.083：化隱（斯魔茶 / 來悲粗茶 / 怨影娃娃 / 詛咒娃娃）— 卡面：
      //   「這隻寶可夢不會受到對手的招式或特性的效果。」冰冷之帳是「特性效果」必擋。
      //   per-target gate：化隱寶可夢只受 own frosmoth（自家雪妖女），不受 opp frosmoth。
      //   套用點在下方 dispatch loop 計算 counter 時。
      const hasHuayinAbility = (card: Card | undefined): boolean => {
        return card?.abilities?.some(a => a.name === '化隱') ?? false;
      };
      const affectedNames: string[] = [];
      // [ownerIdx → prizes they owe to opponent]
      const koPrizesByOwner: [number, number] = [0, 0];
      const activeDiedByOwner: [boolean, boolean] = [false, false];
      for (const i of [0, 1] as const) {
        const pl = { ...players[i] };
        const ownFrosmoth = frosmothByOwner[i];
        const oppFrosmoth = frosmothByOwner[(1 - i) as 0 | 1];
        // 戰鬥場：雙方 frosmoth 都生效（卡面註：戰鬥場仍會受到招式的傷害；
        //   特性效果也照常 — 戰鬥場不受對戰圓形保護）
        const activeCounters = ownFrosmoth + oppFrosmoth;
        // 備戰：對戰圓形啟動 → 對手 frosmoth 被擋，只剩自家 frosmoth
        const benchCounters = benchProtected ? ownFrosmoth : (ownFrosmoth + oppFrosmoth);
        // 戰鬥區
        // v5.083：per-target counter — 化隱寶可夢只算自家雪妖女（擋對手雪妖女特性效果）
        if (pl.active && isFrosmothCheckupTarget(pl.active, i, 'active')) {
          const activeCardC = pool.get(pl.active.cardId);
          const effectiveActiveCounters = hasHuayinAbility(activeCardC) ? ownFrosmoth : activeCounters;
          if (effectiveActiveCounters > 0) {
          const newDmg = pl.active.damage + effectiveActiveCounters * 10;
          const card = pool.get(pl.active.cardId);
          const hp = getEffectiveHP(pl.active, pool, state);
          affectedNames.push(`${card?.name ?? '?'}(-${effectiveActiveCounters * 10}${hasHuayinAbility(activeCardC) ? ' 化隱擋對手' : ''})`);
          if (hp > 0 && newDmg >= hp) {
            const koDiscard: CardInstance[] = [
              { ...pl.active, damage: newDmg },
              ...pl.active.energyAttached,
              ...getAllAttachedTools(pl.active),
              ...(pl.active.evolvedFromStack ?? []),
            ];
            pl.discard = [...pl.discard, ...koDiscard];
            koPrizesByOwner[i] += prizesForKO(card!);
            activeDiedByOwner[i] = true;
            pl.active = null;
          } else {
            pl.active = { ...pl.active, damage: newDmg };
          }
          }  // close v5.083 effectiveActiveCounters > 0 block
        }
        // 備戰區 — 對戰圓形啟動時 benchCounters 可能 = ownFrosmoth 或 0
        // v5.083：per-target — 化隱寶可夢只算 ownFrosmoth（擋對手）
        const newBench: CardInstance[] = [];
        for (const b of pl.bench) {
          if (!isFrosmothCheckupTarget(b, i, 'bench')) { newBench.push(b); continue; }
          const benchCardC = pool.get(b.cardId);
          const effBenchCounters = hasHuayinAbility(benchCardC)
            ? (benchProtected ? ownFrosmoth : ownFrosmoth)  // 化隱：擋對手 frosmoth 兩種情境都只算自家
            : benchCounters;
          if (effBenchCounters === 0) { newBench.push(b); continue; }
          const newDmg = b.damage + effBenchCounters * 10;
          const card = pool.get(b.cardId);
          const hp = getEffectiveHP(b, pool, state);
          affectedNames.push(`${card?.name ?? '?'}(-${effBenchCounters * 10}${hasHuayinAbility(benchCardC) ? ' 化隱擋對手' : ''})`);
          if (hp > 0 && newDmg >= hp) {
            const koDiscard: CardInstance[] = [
              { ...b, damage: newDmg },
              ...b.energyAttached,
              ...getAllAttachedTools(b),
              ...(b.evolvedFromStack ?? []),
            ];
            pl.discard = [...pl.discard, ...koDiscard];
            koPrizesByOwner[i] += prizesForKO(card!);
          } else {
            newBench.push({ ...b, damage: newDmg });
          }
        }
        pl.bench = newBench;
        players[i] = pl;
      }
      if (affectedNames.length > 0) {
        state = addLog({ ...state, players },
          `冰冷之帳：${affectedNames.join('、')}`, null);
      }
      // v2.98：累計到 pendingPrizes，由玩家透過 TAKE_PRIZES 各自取走（含對手回合可取）
      for (const i of [0, 1] as const) {
        const owed = koPrizesByOwner[i];
        if (owed <= 0) continue;
        const winnerIdx = (1 - i) as 0 | 1;
        const winner = players[winnerIdx];
        state = addLog({ ...state, players },
          `冰冷之帳：${players[i].name} 有寶可夢被擊倒，${winner.name} 將取得 ${owed} 張獎賞卡。`,
          null);
        state = addPendingPrize(state, winnerIdx, owed, pool);
        // v5.498：addPendingPrize 把獎賞發在 state.players，但本地 players 變數會 stale；
        //   後續 checkup 區塊(力之沙漏/道具自棄)與 finalize(clearTurnFlags) 的 {...state, players}
        //   會用 stale players 覆蓋掉剛發的獎賞 → 玩家「冰冷之帳/揚沙 KO 對手卻沒拿到獎賞」。同步回來。
        players[0] = state.players[0]; players[1] = state.players[1];
      }
      // 勝利條件：任一方戰鬥寶可夢被擊倒 + 備戰已空 → 對手勝
      for (const i of [0, 1] as const) {
        if (activeDiedByOwner[i] && players[i].bench.length === 0 && players[i].active === null) {
          const winnerIdx = (1 - i) as 0 | 1;
          return {
            ...state, phase: 'game-over',
            winner: winnerIdx, winReason: `${players[i].name} 沒有可上場的寶可夢`,
          };
        }
      }
    }

    // v3.01 Wave 3 — 火箭隊的班基拉斯｜揚沙（寶可夢檢查時放指示物）
    {
      for (const ownerIdx of [0, 1] as const) {
        if (!hasRocketTyranitarSandstorm({ ...state, players }, ownerIdx, pool)) continue;
        const oppIdx = (1 - ownerIdx) as 0 | 1;
        const opp = { ...players[oppIdx] };
        const sandstormAffected: string[] = [];
        let sandstormPrizes = 0;
        let sandstormActiveDied = false;

        const isBasicPokemonInst = (inst: CardInstance): boolean => {
          const c = pool.get(inst.cardId);
          if (!c || c.supertype !== 'Pokemon') return false;
          if (c.evolvesFrom) return false;
          if (c.stage && c.stage !== 'Basic') return false;
          return true;
        };

        if (opp.active && isBasicPokemonInst(opp.active)) {
          // v4.51 Phase 2：active 也加 canApplyEffectToTarget（光之翼會擋 active）
          const _sandActGuard = canApplyEffectToTarget(state, ownerIdx, opp.active, pool.get(opp.active.cardId), 'ability-effect', pool, { isBench: false });
          if (_sandActGuard.blocked) {
            sandstormAffected.push(`${pool.get(opp.active.cardId)?.name ?? '?'}(${_sandActGuard.reason})`);
          } else {
          const newDmg = opp.active.damage + 20;
          const card = pool.get(opp.active.cardId);
          const hp = getEffectiveHP(opp.active, pool, state);
          sandstormAffected.push(`${card?.name ?? '?'}(-20)`);
          if (hp > 0 && newDmg >= hp) {
            const koDiscard: CardInstance[] = [
              { ...opp.active, damage: newDmg },
              ...opp.active.energyAttached,
              ...getAllAttachedTools(opp.active),
              ...(opp.active.evolvedFromStack ?? []),
            ];
            opp.discard = [...opp.discard, ...koDiscard];
            sandstormPrizes += prizesForKO(card!);
            sandstormActiveDied = true;
            opp.active = null;
          } else {
            opp.active = { ...opp.active, damage: newDmg };
          }
          }
        }
        // v4.51 Phase 2：改用統一 canApplyEffectToTarget（kind='ability-effect'）— 涵蓋光之翼 + 對戰圓形
        const newOppBench: CardInstance[] = [];
        for (const b of opp.bench) {
          if (!isBasicPokemonInst(b)) { newOppBench.push(b); continue; }
          // defense check per-target
          const _sandTgtCard = pool.get(b.cardId);
          const _sandGuard = canApplyEffectToTarget(state, ownerIdx, b, _sandTgtCard, 'ability-effect', pool, { isBench: true });
          if (_sandGuard.blocked) {
            sandstormAffected.push(`${_sandTgtCard?.name ?? '?'}(${_sandGuard.reason})`);
            newOppBench.push(b);
            continue;
          }
          const newDmg = b.damage + 20;
          const card = pool.get(b.cardId);
          const hp = getEffectiveHP(b, pool, state);
          sandstormAffected.push(`${card?.name ?? '?'}(-20)`);
          if (hp > 0 && newDmg >= hp) {
            const koDiscard: CardInstance[] = [
              { ...b, damage: newDmg },
              ...b.energyAttached,
              ...getAllAttachedTools(b),
              ...(b.evolvedFromStack ?? []),
            ];
            opp.discard = [...opp.discard, ...koDiscard];
            sandstormPrizes += prizesForKO(card!);
          } else {
            newOppBench.push({ ...b, damage: newDmg });
          }
        }
        opp.bench = newOppBench;
        players[oppIdx] = opp;

        if (sandstormAffected.length > 0) {
          state = addLog({ ...state, players },
            `揚沙：${sandstormAffected.join('、')}`, ownerIdx);
        }
        if (sandstormPrizes > 0) {
          state = addLog({ ...state, players },
            `揚沙：${players[oppIdx].name} 有寶可夢被擊倒，${players[ownerIdx].name} 將取得 ${sandstormPrizes} 張獎賞卡。`,
            ownerIdx);
          state = addPendingPrize(state, ownerIdx, sandstormPrizes, pool);
        // v5.498：addPendingPrize 把獎賞發在 state.players，但本地 players 變數會 stale；
        //   後續 checkup 區塊(力之沙漏/道具自棄)與 finalize(clearTurnFlags) 的 {...state, players}
        //   會用 stale players 覆蓋掉剛發的獎賞 → 玩家「冰冷之帳/揚沙 KO 對手卻沒拿到獎賞」。同步回來。
        players[0] = state.players[0]; players[1] = state.players[1];
        }
        if (sandstormActiveDied && players[oppIdx].bench.length === 0 && players[oppIdx].active === null) {
          return {
            ...state, phase: 'game-over',
            winner: ownerIdx, winReason: `${players[oppIdx].name} 沒有可上場的寶可夢`,
          };
        }
      }
    }

    } // v5.426：end of checkup 放指示物特性區（endTurnCheckupAbilitiesDone gate）

    // ── v2.247 力之沙漏（PokemonTool）— 回合結束時，若戰鬥場寶可夢附有此 Tool，
    //   可以從棄牌區將 1 張基本能量附於該寶可夢。改為玩家選擇而非自動附能量。
    //   阻礙之塔時道具失效。
    {
      const aPlayer = players[aIdx];
      const active = aPlayer.active;
      const toolsJammedET = isToolsJammed(state, pool);
      // v3.20 多重轉接：力之沙漏可在 toolAttached 或 extraTools
      const _hasLouTool = active && !toolsJammedET
        && getAllAttachedTools(active).some(t => pool.get(t.cardId)?.name === '力之沙漏');
      if (_hasLouTool && !aPlayer.lourisToolUsedThisTurn) {
        const hasPending = (state as any).pendingSelection;
        if (!hasPending) {
          const hasBasic = aPlayer.discard.some(c => {
            const card = pool.get(c.cardId);
            return card?.supertype === 'Energy' && card.subtype === 'Basic';
          });
          if (hasBasic) {
            // v3.24 set per-turn flag 避免重複觸發
            const newPlayers = [...players] as [PlayerState, PlayerState];
            newPlayers[aIdx] = { ...aPlayer, lourisToolUsedThisTurn: true };
            state = {
              ...state,
              players: newPlayers,
              // v4.955 BUG FIX：力之沙漏暫停 END_TURN 時必須設 endTurnSkipCheckup=true。
              //   理由：本 hook 之前的 snapshot 區塊已 rotate `thisTurn → InLastOppTurn`
              //   並 reset thisTurn=[0,0]；若 re-dispatch END_TURN 時沒設 skipCheckup，
              //   snapshot 區塊會再跑一次 → 用「現在已歸零的 thisTurn」覆蓋掉 InLastOppTurn，
              //   導致對手用扭轉乾坤 / 不公印章 / 八朔 / 寶寶暴龍 勃然大怒 等讀 InLastOppTurn
              //   的 gate / 招式時看到 0 → gate 拒絕觸發。
              //   設 skipCheckup=true 跳過 snapshot rotation AND checkup 重跑（中毒/灼傷扣血
              //   不會重複放）；finalize 區塊會清掉旗標，不影響後續 turn。
              endTurnSkipCheckup: true,
              pendingSelection: {
                type: 'discard-search',
                actorIdx: aIdx,
                sourcePlayerIdx: aIdx,
                filter: 'BasicEnergy',
                minCount: 0,
                maxCount: 1,
                effectKey: 'brailliant-attach',
                params: { endTurnAfter: true },
              },
            };
            return state;
          }
        }
      }
    }

    // ── v2.214 TOOL_END_TURN_DISCARD（招式學習器 螢石 等）─────────────────
    //   卡面：「將附於寶可夢身上的這張卡，在自己的回合結束時丟棄」。
    //   掃自己場上所有附有 TOOL_END_TURN_DISCARD 道具的寶可夢，把該道具搬到棄牌區。
    //   阻礙之塔下道具失效，但「自棄」屬於 tool 自身的 self-clean 規則，仍然執行
    //   （PTCG 官方判例：tool 即便被 nullify 仍會在自己回合結束時離場 — 道具效果不
    //   觸發，但「離場」的時機是道具卡面寫死的固有行為。為一致性此處不加 jam guard）
    {
      const aPlayer = players[aIdx];
      const allMine: CardInstance[] = [
        ...(aPlayer.active ? [aPlayer.active] : []),
        ...aPlayer.bench,
      ];
      let touched = false;
      const newDiscards: CardInstance[] = [];
      const stripIfDiscard = (c: CardInstance): CardInstance => {
        // v3.20 多重轉接：處理 toolAttached 與 extraTools 兩種來源
        let updated: CardInstance = c;
        if (c.toolAttached) {
          const tCard = pool.get(c.toolAttached.cardId);
          if (tCard && TOOL_END_TURN_DISCARD.has(tCard.name)) {
            newDiscards.push(c.toolAttached);
            touched = true;
            updated = { ...updated, toolAttached: undefined };
          }
        }
        if (updated.extraTools && updated.extraTools.length > 0) {
          const keep: CardInstance[] = [];
          for (const t of updated.extraTools) {
            const tCard = pool.get(t.cardId);
            if (tCard && TOOL_END_TURN_DISCARD.has(tCard.name)) {
              newDiscards.push(t);
              touched = true;
            } else {
              keep.push(t);
            }
          }
          if (keep.length !== updated.extraTools.length) {
            updated = { ...updated, extraTools: keep };
          }
        }
        return updated;
      };
      if (touched || aPlayer.active) {
        // intentionally always run map; touched 由內部判斷
      }
      const newActive = aPlayer.active ? stripIfDiscard(aPlayer.active) : null;
      const newBench = aPlayer.bench.map(stripIfDiscard);
      void allMine; // suppressed — only used conceptually
      if (touched) {
        players[aIdx] = {
          ...aPlayer,
          active: newActive,
          bench: newBench,
          discard: [...aPlayer.discard, ...newDiscards],
        };
        // v5.518：收斂走中央 addToolDiscardLog(原 inline 逐張 log)。
        state = addToolDiscardLog({ ...state, players }, newDiscards, pool, aIdx, '自己回合結束');
      }
    }

    // 清除當前玩家的回合旗標（justPlaced / evolvedThisTurn / abilityUsedThisTurn）
    const currentPlayer = { ...players[aIdx] };

    // v4.892 強烈之吻（M5 迷唇姐）— delayed discard at end of opp's next turn
    //   POST 在 attacker 端設了 defender.strongKissTargetIid = X
    //   此處 (defender's END_TURN) 觸發：若 active 仍為 X → 丟棄整套
    //   ★ 重要：丟棄 ≠ 昏厥。不給對手獎賞卡，不觸發 PASSIVE_ON_KO / PASSIVE_KO_RETALIATION。
    // v5.443：改用 instance 級 strongKissDiscardPending（退備戰由 clearActiveEffects 自動清，
    //   故「退備戰再回戰鬥場」不會誤丟棄）。只丟棄「仍在戰鬥場且仍帶旗標」的那隻。
    if (currentPlayer.active?.strongKissDiscardPending) {
      const koInst = currentPlayer.active;
      const cardName = pool.get(koInst.cardId)?.name ?? '?';
      const discards: CardInstance[] = [
        koInst,
        ...koInst.energyAttached,
        ...getAllAttachedTools(koInst),
        ...(koInst.evolvedFromStack ?? []),
      ];
      currentPlayer.active = null;
      currentPlayer.discard = [...currentPlayer.discard, ...discards];
      state = addLog(state,
        `${cardName} 與身上 ${discards.length - 1} 張附加卡因招式效果全部丟棄（非昏厥，對手不獲得獎賞卡）`,
        aIdx);
    }

    currentPlayer.active = currentPlayer.active ? clearTurnFlags(currentPlayer.active) : null;
    currentPlayer.bench = currentPlayer.bench.map(clearTurnFlags);
    // 清除特性使用旗標
    const clearAbilityFlag = (c: CardInstance): CardInstance => {
      if (!c.abilityUsedThisTurn) return c;
      const n = { ...c }; delete n.abilityUsedThisTurn; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearAbilityFlag(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearAbilityFlag);
    // v2.91：清除同名特性使用紀錄（使者衝刺 / 月光循環 類）
    if (currentPlayer.abilityNamesUsedThisTurn) {
      delete currentPlayer.abilityNamesUsedThisTurn;
    }
    // v2.149：清除祭典樂舞 second-attack flag（END_TURN 後重置該玩家側）
    // v2.381：同時清除 festivalDanceSecondAttackUsed（第 2 次招式 spent flag）
    if (state.festivalDanceUsedThisTurn?.[aIdx]) {
      const newFlag: [boolean, boolean] = [...state.festivalDanceUsedThisTurn] as [boolean, boolean];
      newFlag[aIdx] = false;
      state = { ...state, festivalDanceUsedThisTurn: newFlag };
    }
    if (state.festivalDanceSecondAttackUsed?.[aIdx]) {
      const newFlag2: [boolean, boolean] = [...state.festivalDanceSecondAttackUsed] as [boolean, boolean];
      newFlag2[aIdx] = false;
      state = { ...state, festivalDanceSecondAttackUsed: newFlag2 };
    }
    // v5.201：END_TURN 也清 pending field（理論上 tryPromoteToMainForFestival 已清，防呆）
    if (state.festivalDancePendingSecondAttack && state.festivalDancePendingSecondAttack.idx === aIdx) {
      state = { ...state, festivalDancePendingSecondAttack: null };
    }
    // 清除 cantAttackThisTurn：若當前玩家的 active 本回合被招式封鎖過，
    // 回合結束時把罰則消耗完（否則 UI 反白會永久卡住）
    const clearCantAttackThisTurn = (c: CardInstance): CardInstance => {
      if (!c.cantAttackThisTurn) return c;
      const n = { ...c }; delete n.cantAttackThisTurn; return n;
    };
    // v2.78 清除 currentPlayer 各 ThisTurn flag
    const clearV278ThisTurn = (c: CardInstance): CardInstance => {
      let n = c;
      if (c.immuneToAttackEffectsThisTurn) { n = { ...n }; delete n.immuneToAttackEffectsThisTurn; }
      if (c.attackCostIncreaseColorlessThisTurn) { n = { ...n }; delete n.attackCostIncreaseColorlessThisTurn; }
      if (c.retreatCostIncreaseThisTurn) { n = { ...n }; delete n.retreatCostIncreaseThisTurn; }
      if (c.endTurnOnOppAttachEnergyThisTurn) { n = { ...n }; delete n.endTurnOnOppAttachEnergyThisTurn; }
      if (c.immuneToExAttackTagThisTurn) { n = { ...n }; delete n.immuneToExAttackTagThisTurn; }
      if (c.weaknessOverrideTypeThisTurn) { n = { ...n }; delete n.weaknessOverrideTypeThisTurn; }
      return n;
    };
    // v2.78 觸發滲透寒氣等延遲傷害（於擁有者 END_TURN 時應用）
    const applyDamageAtMyEnd = (c: CardInstance): CardInstance => {
      if (!c.damageAtMyNextEndOfTurn || c.damageAtMyNextEndOfTurn <= 0) return c;
      const _newDmgEnd = (c.damage ?? 0) + c.damageAtMyNextEndOfTurn;
      const n = { ...c, damage: _newDmgEnd };
      if (_newDmgEnd >= getEffectiveHP(c, pool, state)) { n._faintByEffect = true; n._faintReason = '滲透寒氣'; } // v5.926 滲透寒氣放指示物致死=效果昏厥（v6.037 帶來源）
      delete n.damageAtMyNextEndOfTurn;
      return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearCantAttackThisTurn(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearCantAttackThisTurn);
    // v2.78 觸發 currentPlayer 側的延遲傷害 + 清除 ThisTurn flags
    if (currentPlayer.active) currentPlayer.active = applyDamageAtMyEnd(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(applyDamageAtMyEnd);
    if (currentPlayer.active) currentPlayer.active = clearV278ThisTurn(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearV278ThisTurn);
    // v2.78 重置 currentPlayer supporterTagsUsedThisTurn
    {
      const cur = state.supporterTagsUsedThisTurn ?? { p1: [], p2: [] };
      const newSup = { p1: cur.p1, p2: cur.p2 };
      if (aIdx === 0) newSup.p1 = [];
      else newSup.p2 = [];
      state = { ...state, supporterTagsUsedThisTurn: newSup };
    }
    // v2.78 凍結獠牙 lowEnergyCantAttack — currentPlayer side this-turn flag clear；對手 next → this
    {
      const curN = state.lowEnergyCantAttackNextTurn ?? [false, false];
      const curT = state.lowEnergyCantAttackThisTurn ?? [false, false];
      const newN: [boolean, boolean] = [curN[0], curN[1]];
      const newT: [boolean, boolean] = [curT[0], curT[1]];
      const dIdxLocal = (1 - aIdx) as 0 | 1;
      // 對手側 next → this（即將進入對手回合，對手 = next player）
      if (newN[dIdxLocal]) { newT[dIdxLocal] = true; newN[dIdxLocal] = false; }
      // currentPlayer 側 this 已過完，清除
      newT[aIdx] = false;
      state = { ...state, lowEnergyCantAttackNextTurn: newN, lowEnergyCantAttackThisTurn: newT };
    }
    // 清除 cantRetreatNextTurn：flag 由上個對手回合設下，作用於本回合；本回合結束時清除
    const clearCantRetreat = (c: CardInstance): CardInstance => {
      if (!c.cantRetreatNextTurn) return c;
      const n = { ...c }; delete n.cantRetreatNextTurn; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearCantRetreat(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearCantRetreat);

    // v5.998：清除 nextOwnAttackPenalty（受招削攻:魔法魅惑/大聲咆哮/叫聲等「受到此招的寶可夢下回合
    //   使用招式傷害-N」）——旗標由上個對手回合設在本方(擁有者)身上、作用於本回合;本回合未出招消耗
    //   則於本回合結束清除,避免殘留超出「在下個對手的回合」時限(v5.997 audit 指出唯一漏清 next-turn debuff)。
    const clearNextOwnAttackPenalty = (c: CardInstance): CardInstance => {
      if (c.nextOwnAttackPenalty === undefined) return c;
      const n = { ...c }; delete n.nextOwnAttackPenalty; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearNextOwnAttackPenalty(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearNextOwnAttackPenalty);

    // v2.69 重裝角擊：清除本回合結束方（aIdx）pokemon 的 damageTakenLastOppTurn
    //   原則：「上個對手回合受到的傷害」於對手下回合（=本方下個回合）重置；
    //   實作：每位玩家自己 END_TURN 時清空自己 pokemon 的 lastOppTurn 累計（接下來
    //   對手回合會從 0 開始累積，下個自己回合即可讀取正確值）。
    const clearDmgTakenLastOppTurn = (c: CardInstance): CardInstance => {
      if (c.damageTakenLastOppTurn === undefined) return c;
      const n = { ...c }; delete n.damageTakenLastOppTurn; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearDmgTakenLastOppTurn(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearDmgTakenLastOppTurn);

    // v2.69 瘋狂炸彈：promote attackUsedThisTurn → attackUsedLastSelfTurn（於擁有者 END_TURN）
    //   若本回合未攻擊（thisTurn = undefined），lastSelfTurn 也清為 undefined（避免長期殘留）
    const promoteAttackUsed = (c: CardInstance): CardInstance => {
      const n = { ...c };
      if (c.attackUsedThisTurn !== undefined) {
        n.attackUsedLastSelfTurn = c.attackUsedThisTurn;
        delete n.attackUsedThisTurn;
      } else if (c.attackUsedLastSelfTurn !== undefined) {
        delete n.attackUsedLastSelfTurn;
      }
      return n;
    };
    if (currentPlayer.active) currentPlayer.active = promoteAttackUsed(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(promoteAttackUsed);

    // v2.69 麻痺門牙：清除本回合結束方 pokemon 的 paralyzeFangPending
    //   設定時機：對手 ATTACK_POST 在我方 (defender) 上設下；於 defender 自己 END_TURN 時清除
    const clearParalyzeFang = (c: CardInstance): CardInstance => {
      if (!c.paralyzeFangPending) return c;
      const n = { ...c }; delete n.paralyzeFangPending; return n;
    };
    if (currentPlayer.active) currentPlayer.active = clearParalyzeFang(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(clearParalyzeFang);

    // v2.69 浸蝕污泥：於 defender 自己 END_TURN 時，將 koAtMyNextEndOfTurn pokemon KO
    //   實作：把 damage 直接設為 HP（讓既有 KO 流程在下一輪招式或 sanityKOSweep 處理）
    //   清除 flag（消費完）
    const triggerSludgeKO = (c: CardInstance): CardInstance => {
      if (!c.koAtMyNextEndOfTurn) return c;
      const n = { ...c, damage: getEffectiveHP(c, pool, state), _faintByEffect: true, _faintReason: '浸蝕污泥' }; // v5.926 浸蝕污泥效果昏厥（v6.037 帶來源）
      delete n.koAtMyNextEndOfTurn;
      return n;
    };
    if (currentPlayer.active) currentPlayer.active = triggerSludgeKO(currentPlayer.active);
    currentPlayer.bench = currentPlayer.bench.map(triggerSludgeKO);

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
      if (c.attackFailureFlipCountPending && c.attackFailureFlipCountPending > 0) {
        n = { ...n, attackFailureFlipCountThisTurn: c.attackFailureFlipCountPending };
        delete n.attackFailureFlipCountPending;
      }
      // Wave 36：清除本回合已消耗完的 takeExtraDamageThisTurn（對手本回合結束 = 本方下回合開始）
      if (c.takeExtraDamageThisTurn) {
        n = { ...n };
        delete n.takeExtraDamageThisTurn;
      }
      // v2.101：清除本回合已消耗完的 weaknessDisabledThisTurn / immuneToBasicAttackThisTurn
      // （owner 是 nextP，攻擊方的 END_TURN = nextP 回合結束 — 即這些 self-buff 已走過完整一個對手回合）
      if (c.weaknessDisabledThisTurn) {
        n = { ...n };
        delete n.weaknessDisabledThisTurn;
      }
      if (c.immuneToBasicAttackThisTurn) {
        n = { ...n };
        delete n.immuneToBasicAttackThisTurn;
        delete n.basicImmuneColorlessExcept;  // v5.338：companion 隨主旗標一起清
      }
      if (c.immuneToAncientAttackThisTurn) {  // v5.885
        n = { ...n };
        delete n.immuneToAncientAttackThisTurn;
      }
      if (c.blockAttackDamageIfLTEThisTurn != null) {  // v5.886
        n = { ...n };
        delete n.blockAttackDamageIfLTEThisTurn;
      }
      // v2.174 阿塞蘿拉的惡作劇 — 同 immune* 系列：對手（攻擊方）END_TURN 時清 ThisTurn
      if (c.immuneToExAttackThisTurn) {
        n = { ...n };
        delete n.immuneToExAttackThisTurn;
      }
      // v2.360 代歐奇希斯｜精神防護 / 具甲武者｜要害斬 — 對手回合結束時清 ThisTurn 旗標
      if (c.immuneToAbilityPokemonThisTurn) {
        n = { ...n };
        delete n.immuneToAbilityPokemonThisTurn;
      }
      if (c.immuneToAllAttackThisTurn) {
        n = { ...n };
        delete n.immuneToAllAttackThisTurn;
      }
      if (c.immuneToAttackDamageThisTurn) {
        n = { ...n };
        delete n.immuneToAttackDamageThisTurn;
      }
      // v4.87 閃光屏障 / 熔岩牆 — clear ThisTurn at opponent's END_TURN (same pattern as immuneToBasicAttackThisTurn)
      if (c.immuneToEvolutionAttackThisTurn) {
        n = { ...n };
        delete n.immuneToEvolutionAttackThisTurn;
      }
      if (c.evolutionDamageReduceThisTurn != null) {
        n = { ...n };
        delete n.evolutionDamageReduceThisTurn;
      }
      if (c.immuneToBurnedAttackerThisTurn) {
        n = { ...n };
        delete n.immuneToBurnedAttackerThisTurn;
      }
      // v2.362 振翼髮｜暗夜羽擊 — 清除上回合已消耗的 abilityNullifiedThisTurn；promote NextTurn → ThisTurn
      if (c.abilityNullifiedThisTurn) {
        n = { ...n };
        delete n.abilityNullifiedThisTurn;
      }
      if (c.abilityNullifiedNextTurn) {
        n = { ...n, abilityNullifiedThisTurn: true };
        delete n.abilityNullifiedNextTurn;
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
      // v2.78 鼓擊 — 撤退費 / 招式 cost +N（next → this）
      if (c.attackCostIncreaseColorlessNextTurn && c.attackCostIncreaseColorlessNextTurn > 0) {
        n = { ...n, attackCostIncreaseColorlessThisTurn: c.attackCostIncreaseColorlessNextTurn };
        delete n.attackCostIncreaseColorlessNextTurn;
      }
      if (c.retreatCostIncreaseNextTurn && c.retreatCostIncreaseNextTurn > 0) {
        n = { ...n, retreatCostIncreaseThisTurn: c.retreatCostIncreaseNextTurn };
        delete n.retreatCostIncreaseNextTurn;
      }
      // v2.78 白日夢
      if (c.endTurnOnOppAttachEnergyNextTurn) {
        n = { ...n, endTurnOnOppAttachEnergyThisTurn: true };
        delete n.endTurnOnOppAttachEnergyNextTurn;
      }
      // v2.78 智揮猩｜掌握弱點
      if (c.weaknessOverrideTypeNextTurn) {
        n = { ...n, weaknessOverrideTypeThisTurn: c.weaknessOverrideTypeNextTurn };
        delete n.weaknessOverrideTypeNextTurn;
      }
      // v2.92：promote blockedAttackNamesNextTurn → blockedAttackNamesThisTurn
      // （超級勇氣：在下個自己的回合，這隻寶可夢無法使用『超級勇氣』）
      if (c.blockedAttackNamesNextTurn && c.blockedAttackNamesNextTurn.length > 0) {
        n = {
          ...n,
          blockedAttackNamesThisTurn: [
            ...(n.blockedAttackNamesThisTurn ?? []),
            ...c.blockedAttackNamesNextTurn,
          ],
        };
        delete n.blockedAttackNamesNextTurn;
      }
      return n;
    };
    // 清除目前玩家 active/bench 上殘留的 damageBonusThisTurn（若攻擊未命中用掉）
    const clearDmgBonusThisTurn = (c: CardInstance): CardInstance => {
      if (!c.damageBonusThisTurn) return c;
      const n = { ...c }; delete n.damageBonusThisTurn; return n;
    };
    // v2.92：於 aIdx 方清除本回合已消耗完的 blockedAttackNamesThisTurn
    const clearBlockedAttackThisTurn = (c: CardInstance): CardInstance => {
      if (!c.blockedAttackNamesThisTurn || c.blockedAttackNamesThisTurn.length === 0) return c;
      const n = { ...c }; delete n.blockedAttackNamesThisTurn; return n;
    };
    // Wave 39：清除 aIdx（擁有者）本回合殘留的 cantAttachEnergyThisTurn
    const clearCantAttachEnergy = (c: CardInstance): CardInstance => {
      if (!c.cantAttachEnergyThisTurn) return c;
      const n = { ...c }; delete n.cantAttachEnergyThisTurn; return n;
    };
    // v2.101：自己 ATTACK_POST 對**自己**設的 NextTurn 旗標，於自己 END_TURN 時 promote 為 ThisTurn。
    //   owner 就是 currentPlayer（aIdx 方）— 不同於 takeExtraDamageNextTurn 之類的 defender-side debuff。
    //   卡面：鋁鋼橋龍ex 金屬防禦強化 / 鋁鋼橋龍 塗層攻擊
    const promoteSelfNextToThis = (c: CardInstance): CardInstance => {
      let n = c;
      if (c.pointySpinThisTurn) {
        n = { ...n };
        delete n.pointySpinThisTurn;
      }
      if (c.pointySpinNextTurn) {
        n = { ...n, pointySpinThisTurn: true };
        delete n.pointySpinNextTurn;
      }
      if (c.weaknessDisabledNextTurn) {
        n = { ...n, weaknessDisabledThisTurn: true };
        delete n.weaknessDisabledNextTurn;
      }
      if (c.immuneToBasicAttackNextTurn) {
        n = { ...n, immuneToBasicAttackThisTurn: true };
        delete n.immuneToBasicAttackNextTurn;
      }
      if (c.immuneToAncientAttackNextTurn) {  // v5.885
        n = { ...n, immuneToAncientAttackThisTurn: true };
        delete n.immuneToAncientAttackNextTurn;
      }
      if (c.blockAttackDamageIfLTENextTurn != null) {  // v5.886
        n = { ...n, blockAttackDamageIfLTEThisTurn: c.blockAttackDamageIfLTENextTurn };
        delete n.blockAttackDamageIfLTENextTurn;
      }
      // v2.174 阿塞蘿拉的惡作劇 — owner END_TURN 時 promote NextTurn → ThisTurn
      if (c.immuneToExAttackNextTurn) {
        n = { ...n, immuneToExAttackThisTurn: true };
        delete n.immuneToExAttackNextTurn;
      }
      // v2.360 代歐奇希斯｜精神防護 / 具甲武者｜要害斬 — owner END_TURN 時 promote NextTurn → ThisTurn
      if (c.immuneToAbilityPokemonNextTurn) {
        n = { ...n, immuneToAbilityPokemonThisTurn: true };
        delete n.immuneToAbilityPokemonNextTurn;
      }
      if (c.immuneToAllAttackNextTurn) {
        n = { ...n, immuneToAllAttackThisTurn: true };
        delete n.immuneToAllAttackNextTurn;
      }
      if (c.immuneToAttackDamageNextTurn) {
        n = { ...n, immuneToAttackDamageThisTurn: true };
        delete n.immuneToAttackDamageNextTurn;
      }
      // v4.87 閃光屏障 / 熔岩牆 — promote NextTurn → ThisTurn at owner's END_TURN
      if (c.immuneToEvolutionAttackNextTurn) {
        n = { ...n, immuneToEvolutionAttackThisTurn: true };
        delete n.immuneToEvolutionAttackNextTurn;
      }
      if (c.evolutionDamageReduceNextTurn != null) {
        n = { ...n, evolutionDamageReduceThisTurn: c.evolutionDamageReduceNextTurn };
        delete n.evolutionDamageReduceNextTurn;
      }
      if (c.immuneToBurnedAttackerNextTurn) {
        n = { ...n, immuneToBurnedAttackerThisTurn: true };
        delete n.immuneToBurnedAttackerNextTurn;
      }
      // v5.658：純樸(免疫對手招式效果)/防護代碼(免疫帶tag的ex招式傷害)— 自設「下個對手回合」防守旗標。
      //   原誤放在 nextP(promotePending)→ 對手回合沒生效、反而自己回合才 promote(空跑證實);移到 owner END_TURN promote。
      if (c.immuneToAttackEffectsNextTurn) {
        n = { ...n, immuneToAttackEffectsThisTurn: true };
        delete n.immuneToAttackEffectsNextTurn;
      }
      if (c.immuneToExAttackTagNextTurn) {
        n = { ...n, immuneToExAttackTagThisTurn: c.immuneToExAttackTagNextTurn };
        delete n.immuneToExAttackTagNextTurn;
      }
      return n;
    };
    if (currentPlayer.active) currentPlayer.active = promoteSelfNextToThis(clearBlockedAttackThisTurn(clearCantAttachEnergy(clearDmgBonusThisTurn(currentPlayer.active))));
    currentPlayer.bench = currentPlayer.bench.map(c => promoteSelfNextToThis(clearBlockedAttackThisTurn(clearCantAttachEnergy(clearDmgBonusThisTurn(c)))));
    // v2.103 燃火能量 — 「將附於寶可夢身上的這張卡，在自己的回合結束時丟棄。」
    //   在 aIdx（自己）的 active + bench 各寶可夢身上移除所有燃火能量 entry，追加到 discard。
    //   此處在 END_TURN 的 aIdx 方處理，符合卡面「自己的回合結束時」。
    {
      const extractBurnSoulEnergies = (c: CardInstance): { kept: CardInstance; removed: CardInstance[] } => {
        const burnSoul = c.energyAttached.filter(e => pool.get(e.cardId)?.name === '燃火能量');
        if (burnSoul.length === 0) return { kept: c, removed: [] };
        const kept = { ...c, energyAttached: c.energyAttached.filter(e => pool.get(e.cardId)?.name !== '燃火能量') };
        return { kept, removed: burnSoul };
      };
      let discardAdds: CardInstance[] = [];
      if (currentPlayer.active) {
        const { kept, removed } = extractBurnSoulEnergies(currentPlayer.active);
        currentPlayer.active = kept;
        discardAdds.push(...removed);
      }
      const newBench: CardInstance[] = [];
      for (const c of currentPlayer.bench) {
        const { kept, removed } = extractBurnSoulEnergies(c);
        newBench.push(kept);
        discardAdds.push(...removed);
      }
      currentPlayer.bench = newBench;
      if (discardAdds.length > 0) {
        currentPlayer.discard = [...currentPlayer.discard, ...discardAdds];
      }
    }
    // v2.228 納莉：「在使用了這張卡的回合結束時，若自己的手牌有 5 張以上，
    //   則將自己的手牌全部丟棄」— END_TURN 時於 aIdx 方檢查並丟棄
    if (currentPlayer.nanuDiscardAtTurnEnd) {
      if (currentPlayer.hand.length >= 5) {
        const discarded = currentPlayer.hand;
        currentPlayer.discard = [...currentPlayer.discard, ...discarded];
        currentPlayer.hand = [];
        state = addLog(state,
          `納莉：回合結束時手牌 ${discarded.length} 張（≥5）→ 全部丟棄`,
          aIdx);
      }
      delete currentPlayer.nanuDiscardAtTurnEnd;
    }
    // Wave 36/39：清除 aIdx（本回合結束方）的玩家級 ThisTurn 旗標（若本回合已消耗完）
    if (
      currentPlayer.noAttacksThisTurn ||
      currentPlayer.cantPlayItemThisTurn ||
      currentPlayer.cantPlaySupporterThisTurn ||
      currentPlayer.cantEvolveThisTurn ||
      currentPlayer.damageBoostFightingThisTurn ||
      currentPlayer.teraKoBonusPrizeThisTurn ||
      currentPlayer.karateKingBonusThisTurn ||
      currentPlayer.unrudaBonusThisTurn ||
      currentPlayer.gladionDuelBonusThisTurn ||
      currentPlayer.retryBadgeUsedThisTurn ||
      currentPlayer.cantRetreatIfPoisonedThisTurn ||
      currentPlayer.bagonElenaThisTurn ||
      currentPlayer.cantPlayStadiumThisTurn
    ) {
      const cp = { ...currentPlayer };
      delete cp.noAttacksThisTurn;
      delete cp.cantPlayItemThisTurn;
      delete cp.cantPlaySupporterThisTurn;
      delete cp.cantEvolveThisTurn;
      delete cp.damageBoostFightingThisTurn;
      delete cp.teraKoBonusPrizeThisTurn;
      delete cp.karateKingBonusThisTurn;
      delete cp.unrudaBonusThisTurn;
      delete cp.gladionDuelBonusThisTurn;
      delete cp.retryBadgeUsedThisTurn;
      delete cp.cantRetreatIfPoisonedThisTurn;
      delete cp.bagonElenaThisTurn;
      delete cp.cantPlayStadiumThisTurn;  // v4.33 燒灼大地 flag 自己回合結束時清除
      players[aIdx] = cp;
    } else {
      players[aIdx] = currentPlayer;
    }
    const nextP = { ...players[nextIdx] };
    if (nextP.active) nextP.active = promotePending(nextP.active);
    nextP.bench = nextP.bench.map(promotePending);
    // ★ 以下 nextP(即將行動者) promote 區塊：限「自己下回合」型 player 旗標 —— 設於【對手(dIdx)】、
    //   在【對手自己回合】生效(noAttacks/cantPlayItem/Supporter/Evolve/Stadium/cantRetreatIfPoisoned)。
    //   ⚠ 禁放「對手回合」型旗標(由設旗標方保護/影響於對手回合，如 鐵之防禦 metalShield)→
    //   那類要在 ender promote、對手回合結束 clear(見下方 players[nextIdx] 賦值後的 metalShield 區塊)。
    //   v5.538 血淚：metalShield 誤放這裡 → 對手攻擊時 -30 從未生效。
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
    // v2.174 promote 霍米加的演奏 旗標（鐵之防禦強化 metalShield 改為「對手回合」型，見下方 players[nextIdx] 賦值之後）
    if (nextP.cantRetreatIfPoisonedNextTurn) {
      nextP.cantRetreatIfPoisonedThisTurn = true;
      delete nextP.cantRetreatIfPoisonedNextTurn;
    }
    // v4.33：promote nextIdx 的 cantPlayStadiumNextTurn → ThisTurn（燒灼大地）
    if (nextP.cantPlayStadiumNextTurn) {
      nextP.cantPlayStadiumThisTurn = true;
      delete nextP.cantPlayStadiumNextTurn;
    }
    players[nextIdx] = {
      ...nextP,
      energyAttachedThisTurn: false,
      supporterPlayedThisTurn: false,
      akyoSecretPlayedThisTurn: false,
      rocketSupporterPlayedThisTurn: false,
      ancientSupporterPlayedThisTurn: false,
      carnelliPlayedThisTurn: false,
      magearnaPlayedThisTurn: false,
      kuceroskPlayedThisTurn: false, // v5.995 勾結觸手條件旗標重置
      talarongPlayedThisTurn: false,
      retreatedThisTurn: false,
      lourisToolUsedThisTurn: false, // v3.24 力之沙漏 per-turn flag reset
    };

    // v5.538 鐵之防禦強化 = 「對手回合」型減傷（保護設旗標方自己的【鋼】寶可夢於對手回合）。
    //   與「自己下回合」型旗標(noAttacks/cantPlay*)不同：由設旗標方在【對手回合】生效。
    //   ① 設旗標方(ender=aIdx)回合結束、對手回合開始 → promote metalShieldNextTurn→ThisTurn。
    //   ② 對手回合結束、設旗標方回合開始(此時 nextIdx=設旗標方) → 清除 metalShieldThisTurn。
    //   原誤放在 nextP「自己下回合」promote 區塊 → 在錯的回合生效，對手攻擊時 -30 沒套（玩家報 -60）。
    if (players[aIdx].metalShieldNextTurn) {
      const ep = { ...players[aIdx], metalShieldThisTurn: players[aIdx].metalShieldNextTurn }; // v5.766：帶 count
      delete ep.metalShieldNextTurn;
      players[aIdx] = ep;
    }
    if (players[nextIdx].metalShieldThisTurn) {
      const np = { ...players[nextIdx] };
      delete np.metalShieldThisTurn;
      players[nextIdx] = np;
    }
    // v5.641 阿蜜的目光（玩家層級「對手回合」型減傷，promote/clear 時機同 metalShield）
    if (players[aIdx].flatDamageReduceNextTurn) {
      const ep = { ...players[aIdx], flatDamageReduceThisTurn: players[aIdx].flatDamageReduceNextTurn };
      delete ep.flatDamageReduceNextTurn;
      players[aIdx] = ep;
    }
    if (players[nextIdx].flatDamageReduceThisTurn) {
      const np2 = { ...players[nextIdx] };
      delete np2.flatDamageReduceThisTurn;
      players[nextIdx] = np2;
    }
    // v5.651 收斂「下個對手回合 -N」(damageReduceNextHit，單體消費型)的回合過期：
    //   此旗標由「擁有者」在自己回合設(防護充能/變硬/躲藏/coin免疫/各受招-N…)，卡面只護「下個對手的回合」。
    //   原本只在被打時消費、無回合過期 → 對手該回合沒攻擊它就殘留到日後某次被打才 -N
    //   （玩家報：蓋諾賽克特ex 上回合沒攻擊卻仍 -30）。nextIdx = 即將開始回合者 = 上個自己回合設旗標的人，
    //   其保護的對手回合(剛結束的 aIdx 回合)已過 → 清除。時機同上方 metalShield/flatDamageReduce 的 nextIdx clear。
    {
      // v5.657：retaliateCountersOnNextHit(殼捲風旋轉/強大猛擊/還擊斧/等待角擊「下個對手回合受招→反擊放指示物」)
      //   與 damageReduceNextHit 同為「擁有者回合設、消費型、卡面是下個對手回合」但無回合過期 → 同樣會殘留到
      //   日後某次被打才誤觸發。一併在此 nextIdx clear(同 v5.651 理由)。
      let _nhTouched = false;
      const _clrNextHit = (ci: CardInstance): CardInstance => {
        if (ci.damageReduceNextHit == null && ci.retaliateCountersOnNextHit == null) return ci;
        _nhTouched = true; const n = { ...ci };
        delete n.damageReduceNextHit;          // v5.651
        delete n.retaliateCountersOnNextHit;   // v5.657
        return n;
      };
      const _npx = players[nextIdx];
      const _na = _npx.active ? _clrNextHit(_npx.active) : _npx.active;
      const _nb = _npx.bench.map(_clrNextHit);
      if (_nhTouched) players[nextIdx] = { ..._npx, active: _na, bench: _nb };
    }

    // 重置競技場使用旗標（當前玩家的回合結束時清除其旗標）
    let stadiumUsedThisTurn = state.stadiumUsedThisTurn ?? [false, false] as [boolean, boolean];
    const newStadiumUsed: [boolean, boolean] = [stadiumUsedThisTurn[0], stadiumUsedThisTurn[1]];
    newStadiumUsed[aIdx] = false;

    // 重置「本回合是否打過競技場」旗標（即將開始回合的 nextIdx 清零）
    const stadiumPlayedThisTurn = state.stadiumPlayedThisTurn ?? [false, false] as [boolean, boolean];
    const newStadiumPlayed: [boolean, boolean] = [stadiumPlayedThisTurn[0], stadiumPlayedThisTurn[1]];
    newStadiumPlayed[nextIdx] = false;

    // v3.85: 重置「本回合打過稜鏡塔」flag（剛結束回合的 aIdx 清零，下次他回合從 0 開始）
    const prismPlayedPrev = state.prismTowerPlayedThisTurn ?? [false, false] as [boolean, boolean];
    const newPrismPlayed: [boolean, boolean] = [prismPlayedPrev[0], prismPlayedPrev[1]];
    newPrismPlayed[aIdx] = false;

    // 快照對手目前獎賞張數（作為「下次我開始回合時」的基準值）—
    // 下回合開始時用此快照 vs 屆時對手獎賞數差，判斷「對手在他們剛結束的回合是否取過獎賞」
    // 用於不公印章等 gate 條件。
    const prevOppSnap = state.oppPrizesAtMyLastTurnEnd ?? [6, 6] as [number, number];
    const newOppSnap: [number, number] = [prevOppSnap[0], prevOppSnap[1]];
    newOppSnap[aIdx] = players[1 - aIdx].prizes.length;

    // 同時快照「下一位 activePlayer 回合開始瞬間」的對手獎賞張數 —
    // 用來區分『對手在他們回合取獎賞』vs『我自己回合內自 KO』。
    // 不公印章 gate：需 oppPrizesAtMyTurnStart[myIdx] < oppPrizesAtMyLastTurnEnd[myIdx]
    // （對手上回合取了獎賞 → TurnStart 比 LastTurnEnd 小）
    const prevTurnStart = state.oppPrizesAtMyTurnStart ?? [6, 6] as [number, number];
    const newTurnStart: [number, number] = [prevTurnStart[0], prevTurnStart[1]];
    // nextIdx 的視角：「對手」= aIdx（剛結束回合的玩家）
    newTurnStart[nextIdx] = players[aIdx].prizes.length;

    // v2.70：快照雙方棄牌堆中「火箭隊的」寶可夢數量，用於火箭隊的阿波羅 gate。
    //   aIdx（剛結束回合方）→ 寫 LastTurnEnd[aIdx]
    //   nextIdx（即將開始回合方）→ 寫 TurnStart[nextIdx]
    // gate：turnStart[me] > lastEnd[me] 表示對手剛結束的回合間我方的火箭隊寶可夢被擊倒
    const countRocketPokeInDiscard = (pl: PlayerState): number =>
      pl.discard.filter(c => {
        const card = pool.get(c.cardId);
        return card?.supertype === 'Pokemon' && card.name?.startsWith('火箭隊的');
      }).length;
    const prevRocketLastEnd = state.rocketInMyDiscardAtMyLastTurnEnd ?? [0, 0] as [number, number];
    const newRocketLastEnd: [number, number] = [prevRocketLastEnd[0], prevRocketLastEnd[1]];
    newRocketLastEnd[aIdx] = countRocketPokeInDiscard(players[aIdx]);
    const prevRocketTurnStart = state.rocketInMyDiscardAtMyTurnStart ?? [0, 0] as [number, number];
    const newRocketTurnStart: [number, number] = [prevRocketTurnStart[0], prevRocketTurnStart[1]];
    newRocketTurnStart[nextIdx] = countRocketPokeInDiscard(players[nextIdx]);

    // v3.79 Bug fix：原本寫死 `aIdx === 1`，假設先攻方一定是 idx=0 → 後攻方（idx=1）
    //   結束時才增加 turn。但 v3.75 加了先後攻偏好後，先攻可能是 idx=1，
    //   會導致「Turn 1 只有先攻動作 / Turn 2 起包含後攻+先攻」的奇怪 turn 計數。
    //   正確邏輯：後攻方（= 非 firstPlayerIdx 那邊）結束回合時才增加 turn，
    //   讓「Turn N = 先攻 → 後攻」的對稱結構與先攻 idx 無關。
    const newTurn = aIdx !== state.firstPlayerIdx ? state.turn + 1 : state.turn;
    // v4.24 對戰計時器 — END_TURN 切換玩家前，累計剛結束回合的時間到 playerTurnTimeMs[aIdx]
    const _timerNowMs = Date.now();
    const _timerPrevStart: number = state.currentTurnStartTime ?? _timerNowMs;
    const _timerElapsed = Math.max(0, _timerNowMs - _timerPrevStart);
    const _timerPrevTimes: [number, number] = state.playerTurnTimeMs ?? [0, 0];
    const _timerNewTimes: [number, number] = [_timerPrevTimes[0], _timerPrevTimes[1]];
    _timerNewTimes[aIdx] += _timerElapsed;
    const afterSwitch = addLog(
      {
        ...state,
        players,
        activePlayerIndex: nextIdx,
        turn: newTurn,
        isFirstTurn: false,
        turnPhase: 'draw',
        stadiumUsedThisTurn: newStadiumUsed,
        stadiumPlayedThisTurn: newStadiumPlayed,
        prismTowerPlayedThisTurn: newPrismPlayed,  // v3.85
        oppPrizesAtMyLastTurnEnd: newOppSnap,
        oppPrizesAtMyTurnStart: newTurnStart,
        rocketInMyDiscardAtMyLastTurnEnd: newRocketLastEnd,
        rocketInMyDiscardAtMyTurnStart: newRocketTurnStart,
        // v2.124：finalize 結束時清掉 endTurnSkipCheckup（避免下次 endTurn 也跳過 checkup）
        endTurnSkipCheckup: undefined,
        endTurnCheckupAbilitiesDone: undefined,  // v5.426 清除特性區旗標
        _pendingAttackEnergyRevive: undefined,  // v5.678 安全清除跨picker revive快照
        // v4.24 對戰計時器
        playerTurnTimeMs: _timerNewTimes,
        currentTurnStartTime: _timerNowMs,
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
 * 備戰區異常狀態守衛（v2.47）
 *
 * PTCG 規則：備戰區的寶可夢不會處於任何異常狀態（睡眠 / 麻痺 / 中毒 / 灼傷 / 混亂）。
 * 若因某處邏輯漏洞（例如某個換場 resolver 忘了呼叫 clearActiveEffects）導致
 * 備戰寶可夢身上殘留 status，這裡做最後一道防線 — 在 applyAction 入口與出口
 * 統一抹除備戰區所有寶可夢的 status 旗標。
 *
 * 此函式為純函式：回傳新 state（有變更時）或原 state（無變更）。
 */
// v5.349：一勞永逸 — 備戰寶可夢不該持有「攻擊/撤退鎖」類 active-only 旗標。
//   bench 寶可夢永遠不能攻擊也不能撤退，這些「下回合不能用某招 / 不能攻擊 / 不能撤退」
//   旗標在備戰區無意義；若某互換/gust/特性 resolver 漏走 clearActiveEffects，會殘留並在
//   該寶可夢回到戰鬥場時誤鎖（玩家回報：雷伊布ex 棕碧璽→烏栗→撤退後不能用招式）。
//   此處在 scrubBenchStatus 中央 sweep（每個 action 後跑、覆蓋所有 active→bench 路徑，
//   含特性/物品/支援者/競技場/gust/未來新增），對所有備戰寶可夢一律強制清除，符合 PTCG
//   規則「寶可夢退到備戰區清除所有狀態」。
//   ⚠ 刻意只清「攻擊/撤退」類鎖（bench 不可能攻擊/撤退）；不碰「受傷」類旗標
//     （takeExtraDamage*/damageReduceNextHit — 備戰仍可被招式打到，語義有效），
//     那類由離場 clearActiveEffects 處理，避免誤清。
// v5.531：BENCH_SCRUB_LOCK_FLAGS 收斂至 instance-flags.ts 單一來源(與 clearActiveEffects 共同維護、不漂移)。
function stripBenchActionLockFlags(b: CardInstance): CardInstance {
  let hit = false;
  for (const k of BENCH_SCRUB_LOCK_FLAGS) {
    if ((b as unknown as Record<string, unknown>)[k] !== undefined) { hit = true; break; }
  }
  if (!hit) return b;
  const nb = { ...b } as unknown as Record<string, unknown>;
  for (const k of BENCH_SCRUB_LOCK_FLAGS) delete (nb as Record<string, unknown>)[k as string];
  return nb as unknown as CardInstance;
}

function scrubBenchStatus(state: GameState): GameState {
  let changed = false;
  const players = state.players.map((p) => {
    let benchChanged = false;
    const newBench = p.bench.map((b0) => {
      let b = b0;
      // v2.187 化石 / v2.47 一般：備戰區不應持有異常狀態
      // v5.855：補第三狀態槽 tertiaryStatus（三狀態制：睡眠+中毒+灼傷 同時）——此中央最後防線原漏清
      //   tertiary,某些換場 resolver(如 AZ的平和)不走 clearActiveEffects、靠此 sweep 兜底時第三槽會洩到備戰。
      if (b.status !== undefined || b.secondaryStatus !== undefined || b.tertiaryStatus !== undefined) {
        b = { ...b, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined };
      }
      // v5.349：備戰區不應持有「攻擊/撤退鎖」類 active-only 旗標
      b = stripBenchActionLockFlags(b);
      if (b !== b0) benchChanged = true;
      return b;
    });
    // v2.187：戰鬥場上的化石也不該持有狀態
    let activeChanged = false;
    let newActive = p.active;
    if (newActive?.fossilOnField && (newActive.status !== undefined || newActive.secondaryStatus !== undefined || newActive.tertiaryStatus !== undefined)) {
      newActive = { ...newActive, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined };
      activeChanged = true;
    }
    if (benchChanged || activeChanged) {
      changed = true;
      return { ...p, bench: newBench, active: newActive };
    }
    return p;
  }) as [PlayerState, PlayerState];
  return changed ? { ...state, players } : state;
}

/**
 * 主要引擎入口：接收現有 state + 動作 → 回傳新 state。
 * 所有遊戲邏輯都在這裡分派。
 */

export type FormulaTerm = { sign: '=' | '+' | '-' | '×'; value: number; label: string };

// ════════════════════════════════════════════════════════════════════════════
// v5.544 中央收斂：防守方「減傷算術」block A（metalShield/化石/takeExtra/PASSIVE_DAMAGE_REDUCE×3/
//   岩石宮殿/守護之鐘/齒輪塗層/全金屬實驗室/石之洞窟/爆炸頭水牛捲牆/垃圾洩氣/凍原堡壘/同步脈衝/
//   防具道具減傷）。引擎主管線 + 中央 dealAttackDamageToTarget（狙擊/延後型打 active）共用同一段，
//   避免狙擊/延後招式漏套防守方減傷（玩家報：玩偶捕捉等走中央函式的招式沒套鐵之防禦/防護充能 -N）。
//   ★ 純算術 + log + 算出要丟棄的減傷道具(defenseReduceToolToDiscard)，不碰 defenderState/KO 邊界。
//   ★ 不含「條件式完全免疫(PASSIVE_IMMUNITY/COIN)」與「damageReduceNextHit 消耗」——前者各自管線已處理、
//     後者在呼叫端套（消耗語意）。skipDefEffects=true 時整段照引擎原樣 gate 跳過。
// ════════════════════════════════════════════════════════════════════════════
export function applyDefenderReductionsBlockA(
  workingState: GameState,
  state: GameState,
  defender: PlayerState,
  attacker: PlayerState,
  defenderCard: Card,
  attackerCard: Card,
  baseDamage: number,
  skipDefEffects: boolean,
  toolsJammed: boolean,
  dIdx: 0 | 1,
  aIdx: 0 | 1,
  formula: FormulaTerm[],
  pool: Map<string, Card>,
): { workingState: GameState; baseDamage: number; defenseReduceToolToDiscard: CardInstance | null } {
    // defender 是【鋼】 + 防守方有 metalShieldThisTurn → 傷害 -30
    if (baseDamage > 0
        && defender.metalShieldThisTurn
        && defenderCard.pokemonType === 'Metal') {
      const mShieldCnt = defender.metalShieldThisTurn ?? 0; // v5.766：每張鐵之防禦強化 -30 累加
      const mShieldAmt = 30 * mShieldCnt;
      const reduced = Math.max(0, baseDamage - mShieldAmt);
      workingState = addLog(workingState,
        `${defenderCard.name} 因鐵之防禦強化效果，受到的傷害 -${mShieldAmt}（${baseDamage} → ${reduced}）`, dIdx);
      formula.push({ sign: '-', value: baseDamage - reduced, label: '鐵之防禦' });
      baseDamage = reduced;
    }

    // v5.641 阿蜜的目光：防守方有 flatDamageReduceThisTurn → 該玩家「所有」寶可夢(含新上場)受招式傷害 -N(無屬性限制)
    if (baseDamage > 0 && defender.flatDamageReduceThisTurn && defender.flatDamageReduceThisTurn > 0) {
      const amt = defender.flatDamageReduceThisTurn;
      const reduced = Math.max(0, baseDamage - amt);
      workingState = addLog(workingState,
        `${defenderCard.name} 因阿蜜的目光效果，受到的傷害 -${amt}（${baseDamage} → ${reduced}）`, dIdx);
      formula.push({ sign: '-', value: baseDamage - reduced, label: '阿蜜的目光' });
      baseDamage = reduced;
    }

    // v2.190 陳舊的顎之化石（戰鬥場）— 對手戰鬥寶可夢使用招式的傷害「-30」
    // defender.active 是 fossilOnField + cardId 對應 陳舊的顎之化石 → 傷害 -30
    if (baseDamage > 0
        && defender.active.fossilOnField
        && defenderCard.name === '陳舊的顎之化石') {
      const reduced = Math.max(0, baseDamage - 30);
      workingState = addLog(workingState,
        `陳舊的顎之化石：受到的傷害 -30（${baseDamage} → ${reduced}）`, dIdx);
      formula.push({ sign: '-', value: baseDamage - reduced, label: '陳舊顎化石' });
      baseDamage = reduced;
    }

    // 跨回合「這隻本回合受招式傷害 +N」旗標（例：超音波幼蟲｜刺耳聲）
    // 由對手上個回合 ATTACK_POST 設於 takeExtraDamageNextTurn → 本回合開始前 promote 為 ThisTurn。
    // 不消耗旗標，本回合結束時在 END_TURN 統一清除。
    // 位置：weakness 後（語意上是 defender-side 的「本回合受傷 +N」debuff，不是 attacker's bonus）。
    if (baseDamage > 0 && defender.active.takeExtraDamageThisTurn) {
      const extra = defender.active.takeExtraDamageThisTurn;
      baseDamage += extra;
      workingState = addLog(workingState, `${defenderCard.name} 受到 +${extra} 傷害（上回合招式遺留效果）`, dIdx);
      formula.push({ sign: '+', value: extra, label: '上回合遺留' });
    }

    // 被動特性：受傷減 N（Passive damage reduction）— skipDefEffects 跳過
    // v2.266：火箭隊的監視塔對 Colorless 防守方的 PASSIVE_DAMAGE_REDUCE 也要擋
    //   （e.g. 毛毛角羊｜柔軟羊毛 Colorless -30）。
    if (!skipDefEffects && baseDamage > 0 && defenderCard.abilities
        && !isColorlessAbilityBlocked(state, defenderCard, pool)) {
      for (const ab of defenderCard.abilities) {
        if (!isAbilityHolderEffective(state, defender.active, defenderCard, dIdx, ab.name, 'active', pool)) continue; // v5.471 初始化/暗夜羽擊/監視塔等消除 holder 特性
        const reduce = PASSIVE_DAMAGE_REDUCE.get(ab.name);
        if (reduce) {
          const before = baseDamage;
          baseDamage = Math.max(0, baseDamage - reduce);
          if (before > baseDamage) formula.push({ sign: '-', value: before - baseDamage, label: ab.name });
        }
        // v2.992 條件式減免（雷吉洛克 岩石盔甲 等）
        const condFn = PASSIVE_DAMAGE_REDUCE_COND.get(ab.name);
        if (condFn && defender.active) {
          const reduceN = condFn(defender.active, defenderCard);
          if (reduceN > 0) {
            const before = baseDamage;
            baseDamage = Math.max(0, baseDamage - reduceN);
            if (before > baseDamage) formula.push({ sign: '-', value: before - baseDamage, label: ab.name });
          }
        }
        // v5.294 依攻擊者屬性條件減傷 (白海獅 厚脂肪 等)
        const atkFn = PASSIVE_DAMAGE_REDUCE_BY_ATTACKER.get(ab.name);
        if (atkFn && defender.active) {
          const reduceN = atkFn(defender.active, defenderCard, attackerCard);
          if (reduceN > 0) {
            const before = baseDamage;
            baseDamage = Math.max(0, baseDamage - reduceN);
            if (before > baseDamage) formula.push({ sign: '-', value: before - baseDamage, label: ab.name });
          }
        }
      }
    }

    // v2.999 Group 3 Wave 1 ：團體 -N 受傷減免（大吾的小碎鑽 / 青銅鐘 / 齒輪怪）
    //   skipDefEffects 跳過；baseDamage>0 才算；同樣遵 火箭隊的監視塔 閘門
    //   （青銅鐘 / 齒輪怪是【鋼】 / 大吾的小碎鑽是【闘】，都非【無】→ 監視塔
    //    對其無效；這列 helper 木木會逐個當成 ability holder 個別閘門）
    if (!skipDefEffects && baseDamage > 0) {
      // 大吾的小碎鑽｜岩石宮殿 — 備戰區時，自方「大吾的」寶可夢受招式傷害 -30
      //   （多隻不重複；大吾的小碎鑽是【闘】…監視塔擋不到，略監視塔閘門）
      const palaceReduce = steelixPalaceReduce(workingState, dIdx, defenderCard, pool);
      if (palaceReduce > 0) {
        const before = baseDamage;
        baseDamage = Math.max(0, baseDamage - palaceReduce);
        workingState = addLog(workingState,
          `「岩石宮殿」：${defenderCard.name} 受傷害 -${palaceReduce}（${before} → ${baseDamage}）`, dIdx);
        formula.push({ sign: '-', value: before - baseDamage, label: '岩石宮殿' });
      }
      // 青銅鐘｜守護之鐘 — 自方寶可夢受傷害 -10
      const bronzongReduce = bronzongShelterReduce(workingState, dIdx, pool);
      if (bronzongReduce > 0) {
        const before = baseDamage;
        baseDamage = Math.max(0, baseDamage - bronzongReduce);
        workingState = addLog(workingState,
          `「守護之鐘」：${defenderCard.name} 受傷害 -${bronzongReduce}（${before} → ${baseDamage}）`, dIdx);
        formula.push({ sign: '-', value: before - baseDamage, label: '守護之鐘' });
      }
      // 齒輪怪｜齒輪塗層 — 自方附【鋼】能量寶可夢受傷害 -20
      const gearReduce = gearCoatingReduce(workingState, dIdx, defender.active, pool);
      if (gearReduce > 0) {
        const before = baseDamage;
        baseDamage = Math.max(0, baseDamage - gearReduce);
        workingState = addLog(workingState,
          `「齒輪塗層」：${defenderCard.name} 受傷害 -${gearReduce}（${before} → ${baseDamage}）`, dIdx);
        formula.push({ sign: '-', value: before - baseDamage, label: '齒輪塗層' });
      }
      // v3.77 全金屬實驗室（Stadium）— 雙方【鋼】寶可夢，受到對手寶可夢招式的傷害 -30
      //   卡面：「雙方的【鋼】寶可夢，受到對手的寶可夢招式的傷害「-30」點。」
      //   條件：場上 stadium === '全金屬實驗室' + defender 的 pokemonType === 'Metal'
      const stadiumNameMetal = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
      if (stadiumNameMetal === '全金屬實驗室' && defenderCard.pokemonType === 'Metal') {
        const before = baseDamage;
        baseDamage = Math.max(0, baseDamage - 30);
        workingState = addLog(workingState,
          `「全金屬實驗室」：${defenderCard.name}（鋼）受傷害 -30（${before} → ${baseDamage}）`, dIdx);
        formula.push({ sign: '-', value: before - baseDamage, label: '全金屬實驗室' });
      }
      // v3.77 石之洞窟（Stadium）— 雙方「大吾的」寶可夢，受到對手寶可夢招式的傷害 -30
      //   卡面：「雙方的所有『大吾的寶可夢』受到對手的寶可夢招式的傷害「-30」點。」
      const stadiumNameSteven = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
      if (stadiumNameSteven === '石之洞窟' && defenderCard.name.startsWith('大吾的')) {
        const before = baseDamage;
        baseDamage = Math.max(0, baseDamage - 30);
        workingState = addLog(workingState,
          `「石之洞窟」：${defenderCard.name}（大吾的）受傷害 -30（${before} → ${baseDamage}）`, dIdx);
        formula.push({ sign: '-', value: before - baseDamage, label: '石之洞窟' });
      }
    }


    // v5.614 爆炸頭水牛｜捲牆 — 收斂到共用 curlWallReduce（依卡名計數≥2，與 effects 備戰版同源；
    //   修「含 SV8 無捲牆版時計數不足、戰鬥位漏減傷」。監視塔消除已內含於 helper）。
    if (!skipDefEffects && baseDamage > 0) {
      const _cw = curlWallReduce(workingState, dIdx, defenderCard, pool);
      if (_cw > 0) {
        const before = baseDamage;
        baseDamage = Math.max(0, baseDamage - _cw);
        if (before > baseDamage) {
          formula.push({ sign: '-', value: before - baseDamage, label: '爆炸頭水牛 捲牆' });
        }
      }
    }

    // v2.217 灰塵山（J）｜垃圾洩氣 — 場上有灰塵山 + 攻擊者戰鬥場附有 PokemonTool → -20
    // 卡面：「只要這隻寶可夢在場上，對手身上附有「寶可夢道具」卡的戰鬥寶可夢使用的招式的傷害「-20」點。」
    // 多隻不疊加（卡面通常如此；保險用 has 而非 count）
    if (!skipDefEffects && baseDamage > 0) {
      const defAll: CardInstance[] = [
        ...(defender.active ? [defender.active] : []),
        ...defender.bench,
      ];
      const hasGarbageMountain = defAll.some(c => {
        const card = pool.get(c.cardId);
        return card?.name === '灰塵山' && card?.abilities?.some(a => a.name === '垃圾洩氣');
      });
      if (hasGarbageMountain && attacker.active && getAllAttachedTools(attacker.active).length > 0) {
        // v3.20 多重轉接：只要附了任一張寶可夢道具就觸發
        const allTools = getAllAttachedTools(attacker.active);
        const toolCard = pool.get(allTools[0].cardId);
        if (toolCard?.subtype === 'PokemonTool') {
          const before = baseDamage;
          baseDamage = Math.max(0, baseDamage - 20);
          workingState = addLog(workingState,
            `垃圾洩氣：${attackerCard.name} 附有寶可夢道具 → 招式傷害 -20`, dIdx);
          formula.push({ sign: '-', value: before - baseDamage, label: '垃圾洩氣' });
        }
      }
    }

    // v2.355 冰雪巨龍｜凍原堡壘 — 防守方場上有冰雪巨龍(凍原堡壘)且防守 active 附有【水】能量 → -50
    // 卡面：「只要這隻寶可夢在場上，對手的招式對自己的戰鬥寶可夢造成的傷害，
    //        若戰鬥寶可夢身上附有【水】能量，則傷害「-50」點。」
    // gate：skipDefEffects 跳過、baseDamage>0 才算
    if (!skipDefEffects && baseDamage > 0) {
      const defAll2: CardInstance[] = [
        ...(defender.active ? [defender.active] : []),
        ...defender.bench,
      ];
      const hasFrozenFortress = defAll2.some(c => {
        const card = pool.get(c.cardId);
        return card?.name === '冰雪巨龍' && card?.abilities?.some(a => a.name === '凍原堡壘');
      });
      if (hasFrozenFortress && defender.active) {
        const hasWater = defender.active.energyAttached.some(e => {
          const ec = pool.get(e.cardId);
          if (!ec || ec.supertype !== 'Energy') return false;
          // 基本【水】能量
          if (ec.subtype === 'Basic' && (ec.pokemonType === 'Water' || /【水】/.test(ec.name ?? ''))) return true;
          // 特殊能量本身屬性含 Water
          if (ec.pokemonType === 'Water') return true;
          // 古舊能量 / 夜光能量 → 全屬性
          if (ec.name === '古舊能量' || ec.name === '夜光能量') return true;
          return false;
        });
        if (hasWater) {
          baseDamage = Math.max(0, baseDamage - 50);
          workingState = addLog(workingState,
            `凍原堡壘：${pool.get(defender.active.cardId)?.name ?? '?'} 附有【水】能量 → 招式傷害 -50`, dIdx);
          formula.push({ sign: '-', value: 50, label: '凍原堡壘' });
        }
      }
    }

    // v2.217 電龍（J）｜同步脈衝 — 自己手牌與對手手牌張數相同 → 招式傷害 +80
    // 卡面：「若自己的手牌與對手的手牌張數相同，則這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+80」點。」
    // gate：only triggers when attacker is 電龍 自己（attacker.active.cardName === 電龍）
    if (baseDamage > 0 && attackerCard.name === '電龍'
        && attackerCard.abilities?.some(a => a.name === '同步脈衝')) {
      const myHand = attacker.hand.length;
      const oppHand = defender.hand.length;
      if (myHand === oppHand) {
        baseDamage += 80;
        workingState = addLog(workingState,
          `同步脈衝：雙方手牌均 ${myHand} 張 → ${attackerCard.name} 招式傷害 +80`, aIdx);
        formula.push({ sign: '+', value: 80, label: '同步脈衝' });
      }
    }

    // 道具：特定屬性防禦（福祿果 / 巧可果 / 千香果 / 刺耳果 / 霹霹果 / 莓榴果 / 渾厚鱗片）
    // 只要觸發就 -N，部分卡會丟棄；不受是否已被其他機制削到 0 影響（規則上 tool 仍消耗）
    // skipDefEffects 跳過，但不觸發道具也不丟棄。阻礙之塔時整個道具效果失效。
    // v2.176：新增 holderTypes filter（渾厚鱗片需 holder 為【龍】）
    //          + TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY（神聖護符）
    let defenseReduceToolToDiscard: CardInstance | null = null;
    if (!toolsJammed && !skipDefEffects) {
      const defenderCardForTool = pool.get(defender.active.cardId);
      // v3.20 多重轉接：iterate 所有道具（toolAttached + extraTools）
      for (const t of getAllAttachedTools(defender.active)) {
        const defTool = pool.get(t.cardId);
        if (!defTool) continue;
        const defense = TOOL_DEFENSE_REDUCE_BY_TYPE.get(defTool.name);
        if (defense && attackerCard.pokemonType && defense.types.includes(attackerCard.pokemonType) && baseDamage > 0) {
          const holderOk = !defense.holderTypes
            || (defenderCardForTool?.pokemonType
                && defense.holderTypes.includes(defenderCardForTool.pokemonType));
          if (holderOk) {
            // v5.899：補 addLog + formula.push,揭示屬性防禦道具(渾厚鱗片/福祿果等)的減傷,
            //   否則傷害公式漏此項 → 玩家看到「100(基礎)+30(猛攻手鐲)=80」誤以為數學錯(缺 -50)。
            //   比照下方 TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY(神聖護符 v5.252)。
            const _before = baseDamage;
            baseDamage = Math.max(0, baseDamage - defense.amount);
            const _actual = _before - baseDamage;
            if (_actual > 0) {
              workingState = addLog(workingState,
                `${defTool.name}：招式傷害 -${_actual}`, dIdx);
              formula.push({ sign: '-', value: _actual, label: defTool.name });
            }
            if (defense.discardOnTrigger) defenseReduceToolToDiscard = t;
          }
        }
        const abilFn = TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY.get(defTool.name);
        // v6.049：卡面「受到對手的**擁有特性的**寶可夢招式的傷害-30」→ 特性被消除就不該減。
        //   gate 放在呼叫端而不是改 map 的 callback 簽名（那支 map 有兩個 caller，改簽名風險較高）。
        const _attackerHasAbility = hasAnyEffectiveAbility(
          workingState, attacker.active, attackerCard, aIdx, 'active', pool);
        if (abilFn && baseDamage > 0 && _attackerHasAbility) {
          const reduce = abilFn(attackerCard);
          if (reduce > 0) {
            baseDamage = Math.max(0, baseDamage - reduce);
            // v5.252：補 addLog + formula 揭示觸發 (例如神聖護符 -30)
            workingState = addLog(workingState,
              `${defTool.name}：${attackerCard.name}（擁有特性）招式傷害 -${reduce}`, dIdx);
            formula.push({ sign: '-', value: reduce, label: defTool.name });
          }
        }
      }
    }
  return { workingState, baseDamage, defenseReduceToolToDiscard };
}

// v5.736：normalize 提升到 applyAction 邊界(每個 action 必經、含 END_TURN 等遞迴 re-dispatch)。
//   v5.735 只掛在 sanityKOSweep,但主攻擊 KO 到 sanityKOSweep 之間有 early return(revive/雙KO/反彈
//   等特殊子路徑)可能繞過 → 仍可能殘留巢狀+扁平重複 iid。改在 applyAction 出口統一 normalize 一次,
//   保證任何路徑產生的非場上區重複 iid / 殘留 evolvedFromStack 在 action 回傳前都被清掉(changed
//   旗標無變動回原 state,不擾渲染/不增 log)。sanityKOSweep 內的呼叫保留為中途冗餘(無害)。
// v5.831：對手戰鬥寶可夢回備戰(撤退/招式自我互換等)→ 觸發類特性統一入口
//   （熔岩地域 灼傷新上場 / 漩渦言靈 混亂新上場 / 凹洞 對回去那隻放指示物）。
//   moverIdx = 執行「戰鬥→備戰」動作者（其 active 剛回備戰）；只在 moverIdx 自己的回合觸發
//   （卡面「在對手的回合」＝ 從特性持有者=1-moverIdx 視角是對手回合）。原僅 engine RETREAT 呼叫，
//   漏對手用招式自我互換（do-switch/self-swap-active-bench/sakaki-self-swap）→ 收斂到本 helper。
export function applyOppActiveReturnedToBenchTriggers(
  state: GameState, moverIdx: 0 | 1,
  retreatingPoke: CardInstance, newActive: CardInstance,
  pool: Map<string, Card>,
): GameState {
  // v5.852：guard 移除——本 helper 現只由 applyActionImpl 中央偵測呼叫，該處已保證 moverIdx=動作前回合方
  //   且其 active 剛回到自己備戰區；招式 self-swap 後回合已翻，不能再用 activePlayerIndex 判。
  const aIdx = moverIdx;
  let retreatState = state;
  const trig = getOppRetreatTriggers(retreatState, aIdx, retreatingPoke, newActive, pool);
  if (trig.burnNewActive || trig.confuseNewActive || trig.countersOnRetreater > 0) {
    const ownerIdx = (1 - aIdx) as 0 | 1;
    if (trig.burnNewActive) {
      retreatState = applyStatusToOppActive(retreatState, ownerIdx, 'burned', pool, { kind: 'ability-effect', label: '熔岩地域' });
    }
    if (trig.confuseNewActive) {
      retreatState = applyStatusToOppActive(retreatState, ownerIdx, 'confused', pool, { kind: 'ability-effect', label: '漩渦言靈' });
    }
    if (trig.countersOnRetreater > 0) {
      const _pitTgtCard = pool.get(retreatingPoke.cardId);
      const _pitGuard = canApplyEffectToTarget(retreatState, ownerIdx, retreatingPoke, _pitTgtCard, 'ability-effect', pool, { isBench: true });
      if (_pitGuard.blocked) {
        retreatState = addLog(retreatState, `凹洞：${_pitTgtCard?.name ?? '?'} ${_pitGuard.reason}（不放指示物）`, ownerIdx);
      } else {
        const upd = retreatState.players[aIdx];
        const benchUpd = upd.bench.map(b => b.iid === retreatingPoke.iid
          ? { ...b, damage: (b.damage ?? 0) + trig.countersOnRetreater * 10 } : b);  // v5.951 凹洞:N個指示物=N×10傷害(原漏×10只扣N滴)
        const newPlayers4: [PlayerState, PlayerState] = [...retreatState.players] as [PlayerState, PlayerState];
        newPlayers4[aIdx] = { ...upd, bench: benchUpd };
        retreatState = addLog({ ...retreatState, players: newPlayers4 },
          `凹洞：${_pitTgtCard?.name ?? '?'} 身上放置 ${trig.countersOnRetreater} 個傷害指示物`, ownerIdx);
      }
    }
  }
  return retreatState;
}

// v5.866 險惡廢墟中央偵測：任何動作後,本回合方新放到自己備戰的寶可夢(iid 不在動作前
//   自己場上=新放置,排除互換/進化保留 iid)統一觸發險惡廢墟(2 指示物)。收斂原散在 6 處
//   (PLAY_BASIC/PLAY_FOSSIL/各搜牌庫放備戰 resolver,多處漏呼叫)的 applyBenchPlaceSideEffects。
//   helper 內部已 no-op(非險惡廢墟在場)+ 濾惡屬性,故僅在該場地生效。
function applyRuggedRuinsBenchPlace(before: GameState, after: GameState, pool: Map<string, Card>): GameState {
  const idx = before.activePlayerIndex;
  if (idx !== 0 && idx !== 1) return after;
  const bp = before.players[idx];
  if (!bp) return after;
  const beforeField = new Set<string>([
    ...(bp.active ? [bp.active.iid] : []),
    ...bp.bench.map(c => c.iid),
  ]);
  const newIids = after.players[idx].bench.filter(c => !beforeField.has(c.iid)).map(c => c.iid);
  if (newIids.length === 0) return after;
  return applyBenchPlaceSideEffects(after, idx, newIids, pool);
}

export function applyAction(
  state: GameState,
  action: GameAction,
  pool: Map<string, Card>
): GameState {
  return applyRuggedRuinsBenchPlace(state, normalizeNonFieldStacks(applyActionImpl(state, action, pool)), pool); // v5.866 險惡廢墟中央
}
function applyActionImpl(
  state: GameState,
  action: GameAction,
  pool: Map<string, Card>
): GameState {
  if (state.phase === 'game-over') return state;

  let next: GameState;
  if (state.phase === 'setup') {
    next = handleSetup(state, action, pool);
  } else if (state.phase === 'playing') {
    next = handlePlaying(state, action, pool);
  } else {
    next = state;
  }

  // v5.852 中央：偵測「當前回合玩家的戰鬥寶可夢自我換到自己備戰區(撤退/寶可夢交替/急進開關/招式互換
  //   /坂木/衝浪海灘 等所有路徑)」，統一觸發對手『戰鬥寶可夢回備戰』類(熔岩地域灼傷/漩渦言靈混亂/凹洞
  //   放指示物)。取代原散落 4 處 inline 呼叫→涵蓋所有 self-swap 站點、杜絕漏網與重複觸發。
  //   判據：active iid 換掉、且舊 active 現在在同一玩家備戰區(=回備戰,非被 KO 進棄牌)。
  //   用 state.activePlayerIndex(動作前回合方)——招式 self-swap 後回合已翻,不可用 next 的。
  {
    const _swAi = state.activePlayerIndex;
    if (_swAi === 0 || _swAi === 1) {
      const _swOld = state.players && state.players[_swAi] && state.players[_swAi].active;
      const _swNew = next.players && next.players[_swAi] && next.players[_swAi].active;
      if (_swOld && _swNew && _swOld.iid !== _swNew.iid
          && (next.players[_swAi].bench || []).some(b => b.iid === _swOld.iid)) {
        next = applyOppActiveReturnedToBenchTriggers(next, _swAi, _swOld, _swNew, pool);
      }
    }
  }

  // v4.43：偵測寶可夢 damage 減少 → 標記 healedThisTurn（用於活潑鮮花 / 活潑針等條件）
  next = markHealsByDamageDecrease(state, next);

  // v5.055：對手回合動作 panel — 比對 before/after 後 push 對應 ActionRecord
  next = recordTurnAction(state, next, action, pool);
  // v5.055：回合切換時把 currentTurnActions 搬到 turnActionsLog（歷史紀錄保留 5 回合）
  next = maybePushTurnLog(state, next);

  // v4.47 P2：花之帷幔 attack-time snapshot 跨 deferred picker 後的最終清理
  //   若 RESOLVE_SELECTION 完成且 pending 已消，但 snapshot 仍殘留（attack 結束邏輯沒進）→ wrapper 統一清
  if (next._attackTimeOppFlowerVeil !== undefined && !next.pendingSelection) {
    const cleared = { ...next };
    delete cleared._attackTimeOppFlowerVeil;
    next = cleared;
  }
  if (next._attackTimeCalmGround !== undefined && !next.pendingSelection) {
    const cleared = { ...next };
    delete cleared._attackTimeCalmGround;
    next = cleared;
  }
  // v5.186：抵抗之幕 snapshot 同步清除（跨 deferred picker 後最終清理）
  if (next._attackTimeOppRocketVeil !== undefined && !next.pendingSelection) {
    const cleared = { ...next };
    delete cleared._attackTimeOppRocketVeil;
    next = cleared;
  }
  // v5.237：球形盾牌 snapshot 同步清除（跨 deferred picker 後最終清理）
  if (next._attackTimeOppBugShield !== undefined && !next.pendingSelection) {
    const cleared = { ...next };
    delete cleared._attackTimeOppBugShield;
    next = cleared;
  }
  // v5.325：太古防壁能量快照 同步清除（跨 deferred picker 後最終清理）
  if (next._attackTimeAttackerEnergyUnits !== undefined && !next.pendingSelection) {
    const cleared = { ...next };
    delete cleared._attackTimeAttackerEnergyUnits;
    next = cleared;
  }

  // v5.335：集中偵測「自方戰鬥寶可夢於自己回合回到自己備戰區」→ 觸發 ON_RETREAT_TO_BENCH 類特性
  //   （海豚俠｜全能變身 / 鋼炮臂蝦｜返回重載）。原本只有 RETREAT handler inline 觸發；衝浪手 /
  //   寶可夢交替 / 急進開關 / 頂尖捕捉器 / 烏栗 等互換 supporter/item/招式 走 swap helper 沒觸發
  //   （玩家回報衝浪手退海豚俠時全能變身不觸發）。此處集中以 before/after 比對覆蓋所有 active→bench
  //   路徑（含未來新增）。gate：playing + 同一玩家回合（END_TURN 換手不算）+ 無 pending
  //   （RETREAT inline 或 swap-site promote prompt 已開 pending 時自動跳過，不重複、不搶 pending）。
  if (next.phase === 'playing' && !next.pendingSelection
      && state.activePlayerIndex === next.activePlayerIndex) {
    const rIdx = next.activePlayerIndex;
    const prevActiveR = state.players[rIdx]?.active ?? null;
    if (prevActiveR) {
      const stillActiveR = next.players[rIdx].active?.iid === prevActiveR.iid;
      const onBenchR = next.players[rIdx].bench.find(b => b.iid === prevActiveR.iid);
      if (!stillActiveR && onBenchR && !onBenchR.abilityUsedThisTurn) {
        const benchCardR = pool.get(onBenchR.cardId);
        if (benchCardR?.abilities) {
          for (let i = 0; i < benchCardR.abilities.length; i++) {
            const abR = benchCardR.abilities[i];
            if (!ON_RETREAT_TO_BENCH_ABILITIES.has(abR.name)) continue;
            if (!hasAbilityFn(benchCardR.name, abR.name, i)) continue;
            // v5.754：回備戰特性消除 gate(bench 位,同 site1)。
            if (!isAbilityHolderEffective(next, onBenchR, benchCardR, rIdx, abR.name, 'bench', pool)) continue;
            next = askUseRetreatToBenchAbility(
              next, rIdx, onBenchR, abR.name, `${benchCardR.name}|${i}`, benchCardR.name);
            break;
          }
        }
      }
    }
  }

  // v2.47 防禦層：備戰寶可夢不應持有異常狀態
  next = scrubBenchStatus(next);

  // v2.136 零之大空洞：每次 dispatch 完，重新計算備戰上限。若場地離場/失去太晶 → 自動丟備戰至 5
  next = enforceBenchLimit(next, pool);

  // v3.20 多重轉接 reconcile：若某方場上沒有「洛托姆ex 多重轉接」啟用，
  //   該方所有寶可夢的 extraTools 全部丟到棄牌堆（卡面「特性消除時，將身上多附的道具丟棄」）。
  next = reconcileMultiToolRelay(next, pool);

  // v4.498：activeStadium 變化 → 雙邊 sanityKOSweep
  //   涵蓋所有 path：PLAY_TRAINER Stadium、ability/招式 discardActiveStadium（敲壞 / 大地斷裂等）。
  // v4.4992：擴大為「每個 action 結束無條件雙邊 sweep」— 涵蓋 tool 移除 / 特性消除等
  //   也會改 effective HP 的 path（v4.498 只 detect stadium iid 不夠廣）。
  //   - sanityKOSweep 內 `if (!anyKO) return state` early return → 沒 zombie 就 no-op
  //   - 雙邊 sweep idempotent — 第二次掃同個 zombie 看到 active=null no-op
  //   - v4.497 PLAY_TRAINER 內 explicit call 保留作為前線；wrapper 是後備
  //   - 不影響 normal attack KO（sanityKOSweep 只處理「damage ≥ effHP 但 active 仍在」zombie）
  //   性能：每個 dispatch 多 2 次 sweep（各 ~6 個寶可夢 HP 比較），可忽略
  if (next.phase === 'playing' && !next.pendingSelection) {
    const aIdxForKO = next.activePlayerIndex;
    next = sanityKOSweep(next, aIdxForKO, pool);
    if (next.phase !== 'game-over') {
      next = sanityKOSweep(next, (1 - aIdxForKO) as 0 | 1, pool);
    }
  }

  // v5.918 潛者捕捉:把本次 dispatch 累積的「基本水能量放回手牌」確認 flush 成 modal 鏈(多隻一組組問)
  if (next.phase === 'playing') {
    next = flushDiverCatchQueue(next, pool);
  }

  // v2.135 防禦層：若任一玩家在 'playing' 階段沒 active 也沒 bench → game-over
  // 漏網的 KO 路徑（self-return-to-hand / self-KO ability / 中毒/灼傷邊緣案例 等）若忘了
  // trigger game-over，sim 會 stuck loop。這裡做最後一道保險。
  // v4.73：移除 !pendingSelection gate — 玩家回報「AI 對方戰鬥場唯一寶可夢昏厥後沒有結束比賽」。
  //   原因：若某條 KO 路徑在 KO 時殘留 pendingSelection（picker 還沒解），此 fallback 被
  //   gate 鎖死、game-over 永遠 fire 不了，遊戲卡住。
  //   修正：active=null + bench=0 是無可挽回的 game-over 狀態，無論 pendingSelection 是否存在
  //   都該強制終局；觸發時順手清 pendingSelection 確保 UI modal 不被擋住。
  if (next.phase === 'playing') {
    for (const idx of [0, 1] as const) {
      const p = next.players[idx];
      if (p.active === null && p.bench.length === 0) {
        const winner = (1 - idx) as 0 | 1;
        next = {
          ...next,
          phase: 'game-over',
          winner,
          winReason: `${p.name} 沒有可上場的寶可夢`,
          // v4.73 清掉殘留 pending 避免 UI 卡 picker
          pendingSelection: undefined,
          log: [
            ...next.log,
            { turn: next.turn, playerIndex: null as null,
              message: `${p.name} 沒有可上場的寶可夢，${next.players[winner].name} 獲勝！` },
          ],
        };
        break;
      }
    }
  }

  // v5.013：祭典會場 sweep — 任何 path 套到「附能量寶可夢」的 status 都會被清掉
  //   20+ 個卡片檔直接寫 status: 'xxx' 繞過 statusPost helper 的 isFestivalVenueStatusProtected
  //   check（玩家回報）。在中央 dispatcher 末端 sweep 一次解決所有路徑（含未來新卡）。
  //   clearFestivalVenueProtectedStatuses 是 idempotent — 無祭典會場時 return state unchanged。
  if (next.phase === 'playing') {
    next = clearFestivalVenueProtectedStatuses(next, pool);
  }

  // v5.017：SPECIAL_ENERGY_STATUS_IMMUNE 雙邊 sweep（泡沫【水】能量 等）
  //   玩家回報：吼鯨王ex（水）附 泡沫【水】能量 用「摔落」自身睡眠，仍睡了。
  //   主修在 selfStatusPost 補 check，但同樣有 20+ 路徑直接 `status: 'xxx'` 繞過
  //   checkSpecialEnergyStatusImmune（與 v5.013 祭典會場同類問題）。
  //   中央 sweep 在 dispatcher 末端雙邊 sweep — 兜底清掉任何漏網 status。
  //   clearSpecialEnergyProtectedStatuses 是 idempotent — 無命中時 return state unchanged。
  if (next.phase === 'playing') {
    next = clearSpecialEnergyProtectedStatuses(next, 0, pool);
    next = clearSpecialEnergyProtectedStatuses(next, 1, pool);
  }

  // v5.919 火箭隊能量:附於非「火箭隊的寶可夢」→丟棄(中央 sweep 涵蓋所有能量移動路徑,非只手動附加)
  if (next.phase === 'playing') {
    next = discardIllegalRocketEnergy(next, 0, pool);
    next = discardIllegalRocketEnergy(next, 1, pool);
  }

  return next;
}

// ── 輔助查詢 ─────────────────────────────────────────────────────────────────

/**
 * v2.214：列出寶可夢實際可施放的招式（自己 + 工具上寫的）。
 *
 * 招式注入機制（招式學習器 螢石 / 核心記憶碟 等）：
 *   - PokemonTool 卡上若有 attacks 欄位（v2.213 scraper 修），表示
 *     「附有此 tool 的寶可夢可施放此招式」。
 *   - 招式列表 = 自己卡的 attacks + 已附加 tool 的 attacks（合併）。
 *   - attackIndex 0~ownCount-1 = 自己的招式；
 *     attackIndex >= ownCount = tool 上的招式（effectKey 用 tool 名）。
 *
 * 阻礙之塔：tool 全部失效 → 工具招式不可用（同 TOOL_*）。
 *
 * 用途：getAvailableAttacks、ATTACK handler、UI、AI 都共用這個合併邏輯，
 *   確保 attackIndex 在所有地方對應到相同招式（防 desync）。
 */
export function getEffectiveAttacks(
  state: GameState,
  inst: CardInstance,
  pool: Map<string, Card>
): { atk: Attack; sourceCardName: string; isFromTool: boolean }[] {
  const card = pool.get(inst.cardId);
  if (!card) return [];
  const result: { atk: Attack; sourceCardName: string; isFromTool: boolean }[] = [];
  for (const atk of card.attacks ?? []) {
    result.push({ atk, sourceCardName: card.name, isFromTool: false });
  }
  // tool 招式 — 阻礙之塔失效時不算
  const toolsJammed = isToolsJammed(state, pool);
  if (!toolsJammed) {
    // v3.20 多重轉接：iterate 所有道具
    for (const t of getAllAttachedTools(inst)) {
      const toolCard = pool.get(t.cardId);
      if (toolCard?.subtype === 'PokemonTool' && toolCard.attacks?.length) {
        for (const atk of toolCard.attacks) {
          result.push({ atk, sourceCardName: toolCard.name, isFromTool: true });
        }
      }
    }
  }
  // v3.08 古空棘魚｜潛入記憶 — 自方場上有古空棘魚 + inst 是進化卡 → 加進化前所有招式
  //   卡面：「自己的所有進化寶可夢，可使用進化前持有的所有招式。需要有足夠使用招式的能量。」
  //   - 識別自方：透過 inst 屬於 active 或 bench 來判斷 ownerIdx；用 active.iid / bench.iid 比對。
  //   - cost 沿用各自卡面定義；canAffordAttack 對 base.attacks 也成立（傳入此 inst.energyAttached）。
  //   - 重名招式不去重（卡面允許「使用進化前持有的所有招式」）。
  let ownerIdx: 0 | 1 | undefined;
  if (state.players[0].active?.iid === inst.iid || state.players[0].bench.some(b => b.iid === inst.iid)) {
    ownerIdx = 0;
  } else if (state.players[1].active?.iid === inst.iid || state.players[1].bench.some(b => b.iid === inst.iid)) {
    ownerIdx = 1;
  }
  if (ownerIdx != null) {
    const ownerPlayer = state.players[ownerIdx];
    if (hasArchaeoglobinDiveMemory(ownerPlayer, pool)) {
      const lowerAttacks = getAttacksFromEvolvedFromStack(inst, pool);
      for (const { atk, sourceCardName } of lowerAttacks) {
        result.push({ atk, sourceCardName, isFromTool: false });
      }
    }
  }
  return result;
}

/**
 * v5.010：bench-fill 招式名清單 — 備戰滿時禁用宣告。
 *   含「呼朋引伴」(31+ 張卡共用同名招式 — 毒電嬰/大嘴娃/火狐狸/伊布/花舞鳥/巨翅飛魚/
 *   電飛鼠/小山豬/N的迷你冰/波波/袋獸/呆火駝/燭光靈/向尾喵/粉蝶蟲/謎擬Q/大顎蟻 等)
 *
 * v5.061：玩家回報 螺釘地鼠|呼喚同伴 在備戰滿時 UI 沒變暗（按鈕仍可點，
 *   點下去才看到「備戰區已滿」log）。Audit 全 JSON 後找出 17 個 bench-fill
 *   類同模式招式（牌庫搜尋/牌庫上方查看 → 把基礎/特定寶可夢放備戰），
 *   regPost 內部 helper 雖有 cap check (v5.041 修過)，但 UI 層只認「呼朋引伴」
 *   一個招式名 → 其他 17 個按鈕都沒變暗 + engine.ts:3592 dispatch 攔截也漏。
 *   v5.061 一次補進 set 解決雙層問題（UI 灰 + dispatch 擋）。
 *
 *   17 個新加：呼喚同伴(螺釘地鼠 M5)、呼喚夥伴(同卡日文版翻譯)、
 *     並排(蟲電寶 SV7)、傳喚之門(人造細胞卵 SV5K)、召集標誌(大吾的天秤偶 SVOD)、
 *     亮光增長(燈火幽靈 M5)、大地之門(哲爾尼亞斯 M1S)、家族行軍(一家鼠 SV8)、
 *     急速信號(電螢蟲 SV6)、戲法傳送門(超級妖火紅狐ex M-P-J)、
 *     招花(莉莉艾的花療環環 MC)、洛托呼喚(洛托姆 M2a)、無伴奏合唱(聒噪鳥 MC)、
 *     硃砂誘餌(米立龍ex SV8)、組成陣形(列陣兵 SV7)、群聚(呱呱泡蛙/強顎雞母蟲)、
 *     邀請之吻(迷唇姐 SV6)、香味(狗仔包 MC)
 *
 *   未來其他「強制把寶可夢放備戰」類招式可加進來。
 */
const BENCH_FILL_ATTACK_NAMES = new Set<string>([
  '呼朋引伴',
  '呼喚同伴',
  '呼喚夥伴',
  '並排',
  '傳喚之門',
  '召集標誌',
  '亮光增長',
  '親送挑戰',
  '大地之門',
  '家族行軍',
  '急速信號',
  '戲法傳送門',
  '招花',
  '洛托呼喚',
  '無伴奏合唱',
  '硃砂誘餌',
  '組成陣形',
  '群聚',
  '邀請之吻',
  '香味',
]);

// v5.739 收斂:後攻方最初回合限定招式(吼叫尾ex｜絕叫、甜甜螢｜慢芬香)。
//   原本在 ATTACK handler 與 getAvailableAttacks 各 inline 一份相同 Set → 漂移風險
//   (同 canRetreat/getRetreatBlockReason 各寫一份的反模式)。提升為模組級單一來源,
//   引擎拒絕(ATTACK)與 UI 反白(getAvailableAttacks)永遠引用同一份,不會分歧。
const SECOND_PLAYER_FIRST_TURN_ONLY = new Set<string>(['絕叫', '慢芬香']);
// v5.967 玩家層級招式冷卻：卡面「若『自己的寶可夢』上個自己的回合使出了X，則無法使用」(非「這隻寶可夢」)。
//   仙子伊布ex｜天仙石 屬此類。舊實作把冷卻鎖在 attacker instance(blockedAttackNamesNextTurn)，會被撤退／
//   換位／第二張同名卡繞過。改在招式禁用 gate 掃自己全場的中央 attackUsedLastSelfTurn(招式結算自動蓋章、
//   不隨離場清除)判定，任一隻上個自己回合用過此招即禁用。
const PLAYER_LEVEL_ATTACK_COOLDOWN = new Set<string>(['天仙石']);

/** 列出目前行動玩家可使用的招式（已滿足能量需求 + 未被狀態/效果封鎖的） */
export function getAvailableAttacks(
  state: GameState,
  pool: Map<string, Card>
): number[] {
  if (state.turnPhase !== 'main') return [];
  // v3.0 美洛耶塔ex｜出道演出 — 此寶可夢可在先手第 1 回合使用招式（解除 UI 限制）
  // v5.214 Bug 3：招式名稱白名單（信使鳥|急速之禮 / 卡璞・鳴鳴|急速飛行）也能用
  if (state.isFirstTurn && state.activePlayerIndex === state.firstPlayerIdx) {
    const player0 = state.players[state.activePlayerIndex];
    if (!hasMeloettaExDebut(player0.active, pool)) {
      // 非美洛耶塔 — 只允許白名單招式 indices
      if (!player0.active) return [];
      const atks_uft = getEffectiveAttacks(state, player0.active, pool);
      const whitelistIdx = atks_uft
        .map((e, i) => FIRST_TURN_USABLE_ATTACKS.has(e.atk.name) ? i : -1)
        .filter(i => i >= 0);
      return whitelistIdx;
    }
  }
  const player = state.players[state.activePlayerIndex];
  if (!player.active) return [];
  // 狀態/效果封鎖：睡眠、麻痺、上回合招式設下的「本回合無法使用招式」
  // （混亂只在攻擊時擲幣判定，這裡仍允許點擊；中毒/燒傷不影響攻擊）
  if (player.active.status === 'asleep') return [];
  if (player.active.status === 'paralyzed') return [];
  if (player.active.cantAttackThisTurn) return [];
  // v2.997 請假王ex｜懶怠個性 — 對手場上沒有 ex/V 時，UI 直接反白
  if (isLazyTraitBlockingAttack(player.active, state, pool)) return [];
  // Wave 36：玩家級封鎖（電擊魔獸｜雷電在地類）
  if (player.noAttacksThisTurn) return [];
  const card = pool.get(player.active.cardId);
  if (!card) return [];
  // v2.57 力量抑制者：自己場上「火箭隊的」寶可夢 < 4 → 禁用所有招式
  if (card.name === '火箭隊的超夢ex' && card.abilities?.some(a => a.name === '力量抑制者')) {
    const allOwn: CardInstance[] = [player.active, ...player.bench];
    const rocketCount = allOwn.filter(c => pool.get(c.cardId)?.name?.startsWith('火箭隊的')).length;
    if (rocketCount < 4) return [];
  }
  // v2.214：合併工具招式（招式學習器 螢石 / 核心記憶碟 等）
  const effective = getEffectiveAttacks(state, player.active, pool);
  if (effective.length === 0) return [];
  return effective
    .map(({ atk }, i) => {
      // v2.92：單招下回合禁用（例：超級勇氣）— UI 層反白禁按
      if (player.active!.blockedAttackNamesThisTurn?.includes(atk.name)) return -1;
      // v2.219：後攻方最初回合限定招式（吼叫尾ex｜絕叫）— UI 層反白
      if (SECOND_PLAYER_FIRST_TURN_ONLY.has(atk.name)) {
        const isSecondPlayer = state.activePlayerIndex !== state.firstPlayerIdx;
        if (!state.isFirstTurn || !isSecondPlayer) return -1;
      }
      // v5.010：bench-fill 類招式（如「呼朋引伴」放基礎寶可夢到備戰）— 備戰滿時禁用
      //   原本只在 regPost 內做檢查（attack 已 fire、log「備戰區已滿」），
      //   但 UI 按鈕沒灰 → 玩家以為能用、點下去攻擊發動了但什麼也沒發生 → 困惑。
      //   此處在 UI 層直接擋下，類似「好友寶芬」item guard 行為。
      if (BENCH_FILL_ATTACK_NAMES.has(atk.name)) {
        const benchLimit = getBenchLimit(state, state.activePlayerIndex, pool);
        if (player.bench.length >= benchLimit) return -1;
      }
      // v2.103：大竺葵繁茂 / 燃火能量倍率（傳 state+activePlayerIndex）
      // v2.127：傳 atk.name 讓 canAffordAttack 能套用 酋雷姆｜反等離子 條件式減費
      return canAffordAttack(player.active!, atk.cost, pool, state, state.activePlayerIndex, atk.name) ? i : -1;
    })
    .filter((i) => i >= 0);
}

/** 判斷是否有待處理的緊急事項（需要先解決才能 END_TURN） */
export function hasPendingActions(state: GameState): boolean {
  return hasAnyPendingPrize(state) ||
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
  // v5.212：祭典樂舞第 2 次招式 pending 期間禁止進化
  if (state.festivalDancePendingSecondAttack
      && state.festivalDancePendingSecondAttack.idx === state.activePlayerIndex) return [];
  const player = state.players[state.activePlayerIndex];

  // v2.264：UI/AI 鏡射 engine 的 cantEvolveThisTurn gate（line 1314）。
  //   缺這層會讓 AI 無限重發 EVOLVE → engine 預設返回原 state → stuck_loop。
  //   sim 抓到的 7 場「青銅鐘多龍 EVOLVE 卡死」根因（青銅鐘｜進化妨礙者 對對手鎖進化）。
  if (player.cantEvolveThisTurn) return [];

  // 手牌中的進化牌（有 evolvesFrom 且非基礎）
  const handEvos = player.hand.filter(inst => {
    const c = pool.get(inst.cardId);
    // v5.342 海豚俠ex｜全能靈魂 — 只能由「全能變身」放上場，不可一般進化 → 手牌不顯示黃框/不可拖曳進化。
    return c?.supertype === 'Pokemon' && c.evolvesFrom && !isAllPowerSoulBlocked(c);
  });
  if (handEvos.length === 0) return [];

  const fieldPokemon: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];

  // v2.109/v2.110：活力森林（Stadium）— 雙方的所有【草】寶可夢就算在剛使出的回合也可進化成【草】寶可夢。
  //   v2.110：bypass 不只 justPlaced 也 bypass evolvedThisTurn，允許同回合連鎖進化整條草鏈
  //   （菊草葉→月桂葉→大竺葵 一回合打完）。只要 base/evo 都是草，活力森林 exception 放行。
  // v3.878：UI 端鏡射 EVOLVE handler 的 state.turn > 1 條件，避免第 1 動作回合 UI 黃框誤導玩家。
  //   原 v3.877 只改 engine handler 不夠 — getEvolvableTargets 是手牌黃框 + 場上「進化」標的 UI 來源。
  const stadiumName = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
  const isForest = stadiumName === '活力森林' && state.turn > 1;

  const result: Array<{ fromIid: string; toIids: string[] }> = [];
  // 鬥志戰吼 UI 鏡射（同 EVOLVE handler 邏輯）：base 是勒克貓 + 對手戰鬥場是 ex → bypass
  const oppActiveUI = state.players[1 - state.activePlayerIndex as 0 | 1]?.active;
  const oppActiveCardUI = oppActiveUI ? pool.get(oppActiveUI.cardId) : undefined;
  const oppIsExUI = oppActiveCardUI?.subtype === 'ex' || (oppActiveCardUI?.name?.endsWith('ex') ?? false);
  for (const fp of fieldPokemon) {
    const fpCard = pool.get(fp.cardId);
    if (!fpCard) continue;
    // v2.149 提升進化（伊布 SV8a 125）：base 在戰鬥場 + 卡有此特性 → bypass isFirstTurn + justPlaced
    const isFpActive = player.active?.iid === fp.iid;
    const hasPushEvolveAbility = isFpActive && fpCard.abilities?.some(a => a.name === '提升進化');
    // v2.997 小嘴蝸 / 蓋蓋蟲｜刺激進化 — bypass isFirstTurn + justPlaced + evolvedThisTurn
    const hasShellinkBypassUI = hasShellinkEvolveBypass(fpCard, state, state.activePlayerIndex, pool);
    // 鬥志戰吼 bypass（base 勒克貓 + 對手 ex）
    const hasFightingHowlBypass = fpCard.name === '勒克貓' && oppIsExUI;
    // isFirstTurn gate（除了提升進化 / 刺激進化 / 鬥志戰吼 bypass）
    if (state.isFirstTurn && !hasPushEvolveAbility && !hasShellinkBypassUI && !hasFightingHowlBypass) continue;
    // 活力森林 bypass 對 base 的要求：base 是草寶可夢
    const forestBypassBase = isForest && fpCard.pokemonType === 'Grass';
    // 原本的 gate：justPlaced OR evolvedThisTurn 擋。活力森林 / 提升進化 / 刺激進化 / 鬥志戰吼 exception 四者都能豁免
    const baseBlocked = fp.justPlaced || fp.evolvedThisTurn;
    if (baseBlocked && !forestBypassBase && !hasPushEvolveAbility && !hasShellinkBypassUI && !hasFightingHowlBypass) continue;
    // v2.149 虹色DNA（伊布ex SV8a 126）：base 有此特性 → 從伊布進化的 ex 可從此 base 進化
    const hasPrismaticDNA = fpCard.abilities?.some(a => a.name === '虹色DNA');
    const validEvos = handEvos.filter(evo => {
      const ec = pool.get(evo.cardId);
      if (!ec) return false;
      // 標準路徑：sameEvoName 比對；虹色DNA 例外：evolvesFrom=伊布 + ex
      const stdMatch = sameEvoName(ec.evolvesFrom, fpCard.name);
      const dnaMatch = hasPrismaticDNA &&
        sameEvoName(ec.evolvesFrom, '伊布') &&
        ec.subtype === 'ex';
      if (!stdMatch && !dnaMatch) return false;
      // 若 base 被擋但進到這裡 → 代表 forest / 提升進化 / 刺激進化 / 鬥志戰吼 bypass 成立
      // v3.56：補 !hasFightingHowlBypass — 之前外層 5802 有鬥志戰吼 bypass，但內層 filter
      //        重新檢查 baseBlocked 時漏掉這個例外，導致勒克貓（evolvedThisTurn=true）外層
      //        通過、內層卻把倫琴貓 evo 全濾掉，UI 不顯示進化選項。
      if (baseBlocked && !hasPushEvolveAbility && !hasShellinkBypassUI && !hasFightingHowlBypass && !(forestBypassBase && ec.pokemonType === 'Grass')) return false;
      // v3.821：對手戰鬥場有瞪眼效用 → 有特性且非「火箭隊的」的進化卡不可放置
      //   與 engine EVOLVE handler line 1869 同條件 — 不擋 filter 會導致 AI 死迴圈
      if (isOppEvilEyeBlocking(state, state.activePlayerIndex, ec, pool)) return false;
      return true;
    });
    if (validEvos.length > 0) {
      result.push({ fromIid: fp.iid, toIids: validEvos.map(e => e.iid) });
    }
  }
  return result;
}

/**
 * v2.277 Wave 3：套用「撤退成本修正類特性」（ABILITY_RETREAT_MOD）。
 *
 * 掃描雙方所有場上寶可夢的 abilities，對每個有登錄到 ABILITY_RETREAT_MOD
 * 的特性呼叫 callback，匯總 zero / reduceBy / addBy，按以下順序套用：
 *   1) 任一 zero 來源 → cost 直接歸零
 *   2) cost = max(0, cost - sum(reduceBy))
 *   3) cost += sum(addBy)
 *
 * 套用點：canRetreat（UI 鏡射）+ RETREAT handler（實際扣除），兩處同步呼叫
 * 確保 UI/engine 一致。
 *
 * 注意：本 helper 不檢查 ROCKET_WATCHTOWER（【無】特性無效）/ 可達鴨濕氣
 * （自 KO 特性無效）— 目前登錄到 ABILITY_RETREAT_MOD 的 5 個特性都不屬這兩類。
 * 若未來新增【無】屬寶可夢的撤退特性，需在此 gate。
 */
function applyAbilityRetreatMod(
  state: GameState,
  retreatingInst: CardInstance,
  retreatingCard: Card | undefined,
  retreatingOwnerIdx: 0 | 1,
  pool: Map<string, Card>,
): { zero: boolean; reduce: number; add: number } {
  if (!retreatingCard) return { zero: false, reduce: 0, add: 0 };
  if (ABILITY_RETREAT_MOD.size === 0) return { zero: false, reduce: 0, add: 0 };

  let zero = false;
  let totalReduce = 0;
  let totalAdd = 0;

  const countEnergyHelper = (inst: CardInstance) => {
    // countEnergy 回傳 Map<EnergyType, number>；ABILITY_RETREAT_MOD callback
    // 簽名為 Map<string, number>，TS 上相容（EnergyType 是 string literal union）
    return countEnergy(inst, pool) as unknown as Map<string, number>;
  };

  for (const ownerIdx of [0, 1] as const) {
    const player = state.players[ownerIdx];
    const allInstances: Array<{ inst: CardInstance; position: 'active' | 'bench' }> = [];
    if (player.active) allInstances.push({ inst: player.active, position: 'active' });
    for (const b of player.bench) allInstances.push({ inst: b, position: 'bench' });

    for (const { inst, position } of allInstances) {
      const card = pool.get(inst.cardId);
      if (!card?.abilities) continue;
      // 火箭隊監視塔：【無】寶可夢特性無效
      if (isColorlessAbilityBlocked(state, card, pool)) continue;
      for (const ab of card.abilities) {
        const fn = ABILITY_RETREAT_MOD.get(ab.name);
        if (!fn) continue;
        // v5.648：特性消除收斂——holder 特性被「初始化 / 招式版暗夜羽擊(abilityNullifiedThisTurn) /
        //   passive 振翼髮｜暗夜羽擊 / 黏著束縛」壓制時，撤退費修正失效。原本只擋火箭隊監視塔【無】特性，
        //   漏了 holder-effective → 對手振翼髮暗夜羽擊在戰鬥場時，我方小火龍「一身輕」仍錯誤免撤退（Wilson 回報）。
        if (!isAbilityHolderEffective(state, inst, card, ownerIdx, ab.name, position, pool)) continue;
        // ⭐v6.047：跨方 aura（阿利多斯｜大網、超級水晶燈火靈ex｜咒縛火焰＝對手撤退費 +1）
        //   要過「不受對手特性效果影響」的 gate。Wilson 裁定：化隱卡面逐字寫「不會受到對手的
        //   招式**與特性**的效果的影響」，aura 也是特性的效果。
        //   ⚠kind 必須是 'ability-effect'：【薄霧能量】卡面只寫「招式的效果」，不擋特性 aura
        //     （官方判例佐證同一方向：附薄霧能量仍會被帝牙海獅｜凍結獠牙鎖住招式）。
        //   ⚠只擋跨方；自己場上的特性給自己減撤退費不受此 gate 影響。
        if (ownerIdx !== retreatingOwnerIdx) {
          const _auraGuard = canApplyEffectToTarget(
            state, ownerIdx, retreatingInst, retreatingCard, 'ability-effect', pool, { isBench: false },
          );
          if (_auraGuard.blocked) continue;
        }
        const r = fn({
          holderInst: inst,
          holderCard: card,
          holderPosition: position,
          holderOwnerIdx: ownerIdx,
          retreatingInst,
          retreatingCard,
          retreatingOwnerIdx,
          state,
          pool,
          countEnergy: countEnergyHelper,
        });
        if (r.zero) zero = true;
        if (r.reduceBy) totalReduce += r.reduceBy;
        if (r.addBy) totalAdd += r.addBy;
      }
    }
  }

  // v5.696：回傳原始 {zero,reduce,add} 分量，由 computeActiveRetreatCostFor 統一把 zero 當「免撤退最後覆蓋」處理
  //   （與天空徑線/N的城堡/磁鐵能量/浮遊石一致：撤退歸 0 蓋過咒縛火焰/大網/鼓擊等 +撤退）。
  return { zero, reduce: totalReduce, add: totalAdd };
}

/**
 * v5.082：計算指定玩家戰鬥場寶可夢的「有效撤退費」（不檢查狀態鎖、能量是否足夠）。
 *
 * 與 getRetreatCost 差異：
 *   - getRetreatCost 只看 state.activePlayerIndex（行動玩家）+ 會檢查狀態鎖（睡眠 / 麻痺 / cantRetreat）
 *     並回 null 表示「不能撤退」。
 *   - computeActiveRetreatCostFor 接受任一 playerIdx + 永遠回數字（即使該玩家 active 沒撤退費也回 0）。
 *
 * 用途：傷害計算需要「對手撤退所需能量」(超級水晶燈火靈ex|幻影迷宮)。
 *
 * 套用所有撤退費修正（與 getRetreatCost 完全鏡射）：
 *   1. base retreatCost.length
 *   2. TOOL_RETREAT_MOD（氣球 / 緊急滑板 等；阻礙之塔失效）
 *   3. TOOL_BOTH_SIDES_RETREAT_PLUS（重力之玉）— 雙方 active 任一帶就 +1
 *   4. 天空徑線（拉帝亞斯ex）— 自己場上基礎寶可夢免費撤退
 *   5. N的城堡 / 樂園度假地 競技場
 *   6. SPECIAL_ENERGY_RETREAT_MOD（磁鐵【鋼】能量）
 *   7. ABILITY_RETREAT_MOD（咒縛之炎 / 一身輕 / 溶化流動 / 鋼之橋 / 森林秘道 / 大網）
 *
 * 改動本函式時務必同步 getRetreatCost（L7081）— 兩處邏輯必須一致。
 */
export function computeActiveRetreatCostFor(
  state: GameState,
  playerIdx: 0 | 1,
  pool: Map<string, Card>,
): number {
  const player = state.players[playerIdx];
  if (!player.active) return 0;
  const card = pool.get(player.active.cardId);
  const baseCost = card?.retreatCost?.length ?? 0;
  // v5.696 收斂：所有「撤退歸 0 / 免撤退」效果(道具/能量/特性zero、天空徑線、N的城堡)統一收成
  //   freeRetreat 旗標，於最後硬覆蓋——蓋過咒縛火焰/大網/重力之玉/鼓擊等 +撤退(Wilson 裁定:撤退0為最後覆蓋)。
  //   reduce/add 分別累加，最後 cost = max(0, base + add - reduce)(單一 floor)；freeRetreat → 0。
  let freeRetreat = false;
  let reduce = 0;
  let add = 0;
  const toolsJammedCanR = isToolsJammed(state, pool);
  // TOOL_RETREAT_MOD（多重轉接 iterate 所有道具）
  if (!toolsJammedCanR && card) {
    for (const t of getAllAttachedTools(player.active)) {
      const tool = pool.get(t.cardId);
      if (!tool) continue;
      const mod = TOOL_RETREAT_MOD.get(tool.name);
      if (!mod) continue;
      const r = mod(card, player.active, getEffectiveHP(player.active, pool, state));
      if (r.zero) freeRetreat = true;
      else if (r.reduceBy) reduce += r.reduceBy;
    }
  }
  // 重力之玉：每張獨立貢獻 +1（卡面「附有這張卡的寶可夢…」每張卡獨立計算）
  // v5.086：原 `boolean || boolean → +1` 違反卡面 — 雙方各 1 張應 +2。改 per-instance count 累加。
  const opp = state.players[(1 - playerIdx) as 0 | 1];
  let gravityCountC = 0;
  if (!toolsJammedCanR) {
    if (player.active) {
      for (const t of getAllAttachedTools(player.active)) {
        if (TOOL_BOTH_SIDES_RETREAT_PLUS.has(pool.get(t.cardId)?.name ?? '')) gravityCountC++;
      }
    }
    if (opp.active) {
      for (const t of getAllAttachedTools(opp.active)) {
        if (TOOL_BOTH_SIDES_RETREAT_PLUS.has(pool.get(t.cardId)?.name ?? '')) gravityCountC++;
      }
    }
  }
  add += gravityCountC;
  // 天空徑線（v5.472：holder 須特性有效，被初始化等消除則失效）
  const skyIdxC = playerIdx as 0 | 1;
  const hasSkyPath = [
    ...(player.active ? [{ c: player.active, loc: 'active' as const }] : []),
    ...player.bench.map(c => ({ c, loc: 'bench' as const })),
  ].some(({ c, loc }) => {
    const cc = pool.get(c.cardId);
    return !!cc?.abilities?.some(a => a.name === '天空徑線')
      && isAbilityHolderEffective(state, c, cc, skyIdxC, '天空徑線', loc, pool);
  });
  if (hasSkyPath && isBasicPokemonCard(card)) freeRetreat = true;
  // 競技場
  const stadiumNameCR = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : undefined;
  // 注意：N的城堡「撤退所需能量全部消除」改為最後硬覆蓋(見函式結尾)，蓋過 +撤退效果，故不在此設 0。
  if (stadiumNameCR === '樂園度假地' && card?.name === '可達鴨') reduce += 1;
  // SPECIAL_ENERGY_RETREAT_MOD（磁鐵【鋼】能量）
  if (card) {
    for (const e of player.active.energyAttached) {
      const ec = pool.get(e.cardId);
      if (!ec) continue;
      const fn = SPECIAL_ENERGY_RETREAT_MOD.get(ec.name);
      if (!fn) continue;
      const r = fn(card, player.active);
      if (r.zero) freeRetreat = true;
      else if (r.reduceBy) reduce += r.reduceBy;
    }
  }
  // ABILITY_RETREAT_MOD（咒縛之炎、一身輕、溶化流動、鋼之橋、森林秘道、大網）
  if (player.active) {
    const am = applyAbilityRetreatMod(state, player.active, card, playerIdx, pool);
    if (am.zero) freeRetreat = true;
    reduce += am.reduce;
    add += am.add;
  }
  // v5.473：鼓擊 — 撤退費 +N（retreatCostIncreaseThisTurn）。原只在 RETREAT handler，本中央函式
  //   與 getRetreatCost 漏 → UI 顯示 + 幻影迷宮傷害漏算鼓擊（重複實作的既存分歧）。收斂進中央。
  if (player.active.retreatCostIncreaseThisTurn && player.active.retreatCostIncreaseThisTurn > 0) {
    add += player.active.retreatCostIncreaseThisTurn;
  }
  // v5.371/v5.537：「撤退所需能量全部消除」型 — 最後硬覆蓋，蓋過咒縛火焰/鼓擊/重力之玉/災禍荒野等 +撤退效果
  //   （Wilson 裁定 + 官方判例）。天空徑線(自己場上基礎寶可夢) / N的城堡(N的寶可夢) 同類，都在這裡硬歸 0。
  if (stadiumNameCR === 'N的城堡' && card?.name?.startsWith('N的')) freeRetreat = true;
  // v5.871 修：官方規則撤退費「增減效果全部套用後，結果<0 才歸 0」＝單一 floor，
  //   不是「先 reduce floor 再 add」。原 max(0, base-reduce)+add 在 reduce>base 時把超出的
  //   減免浪費掉(玩家回報:九尾 retreat1 + 氣球-2 + 對手2隻咒縛火焰+2,原算 max(0,1-2)+2=2,
  //   正解 max(0,1+2-2)=1)。freeRetreat(撤退歸0)仍為最後硬覆蓋。
  let cost = Math.max(0, baseCost + add - reduce);
  if (freeRetreat) cost = 0;
  return cost;
}

/**
 * 目前行動玩家是否可以撤退出場寶可夢。
 */
export function getRetreatCost(state: GameState, pool: Map<string, Card>): number | null {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return null;
  const player = state.players[state.activePlayerIndex];
  if (player.retreatedThisTurn || !player.active || player.bench.length === 0) return null;
  // 睡眠和麻痺時無法撤退（PTCG 規則）
  // v5.075 防禦註解：根據官方規則 https://asia.pokemon-card.com/tw/rules/howtoplay/basic_rules07/
  //   只有【睡眠】跟【麻痺】禁止撤退。【混亂】【中毒】【灼傷】皆可撤退。
  //   若玩家回報「混亂無法撤退」幾乎都是搞混以下兩種：
  //     (a)「強勁磁場」(自爆磁怪) 等招式同時加混亂 + cantRetreatNextTurn → 真正擋鎖在 cantRetreatNextTurn
  //     (b) 能量不足以付撤退費 → getRetreatBlockReason 會顯示「能量不足」
  if (player.active.status === 'asleep' || player.active.status === 'paralyzed') return null;
  // v3.37：「下個對手回合無法撤退」(cantRetreatNextTurn) — 鏡射 RETREAT handler L1870 的擋鎖。
  // 設此旗標的招式（懶人獺 悠哉、束縛纏繞、鬼盜衝撞 等）會讓擁有者下回合開始時無法撤退；
  // 之前只在 RETREAT handler 擋，UI 仍顯示按鈕但點下去無反應，造成玩家以為 bug。
  if (player.active.cantRetreatNextTurn) return null;
  // v2.174 霍米加的演奏：自己的中毒寶可夢本回合無法撤退
  if (player.cantRetreatIfPoisonedThisTurn
      && (player.active.status === 'poisoned' || player.active.secondaryStatus === 'poisoned' || player.active.tertiaryStatus === 'poisoned')) {
    return null;
  }
  // v5.473：撤退費收斂——狀態鎖 guard 留在本函式，數值計算全委派中央 computeActiveRetreatCostFor。
  return computeActiveRetreatCostFor(state, state.activePlayerIndex, pool);
}

export function canRetreat(state: GameState, pool: Map<string, Card>): boolean {
  // v5.738：收斂為「getRetreatBlockReason 回 null 才可撤退」——單一真實來源,徹底消除前端
  //   撤退鈕(canRetreat)與規則描述/引擎 RETREAT handler 不一致。
  //   原 canRetreat 漏查【麻痺/睡眠】【cantRetreatNextTurn】【中毒禁撤退(霍米加)】【已撤退】等
  //   (只查 fossil/祭典/能量)→ 玩家回報「龍王蠍 危害之尾 麻痺對手後對手撤退鈕仍可按」(引擎其實會
  //   擋,但 UI 仍顯示鈕=誤導)。getRetreatBlockReason 已涵蓋全部規則,直接鏡射避免日後再漂移。
  return getRetreatBlockReason(state, pool) === null;
}

/**
 * v3.37：診斷用 — 回傳「為何當前無法撤退」的中文短描述。
 * 回 null 表示可撤退。UI 在 disabled 撤退按鈕的 title 顯示，幫玩家看出 bug 還是規則限制。
 *
 * 規則優先順序與 getRetreatCost / canRetreat 完全鏡射，
 * 改動其中一個務必同步調整這個函式（否則 UI tooltip 與實際行為不一致）。
 */
export function getRetreatBlockReason(state: GameState, pool: Map<string, Card>): string | null {
  if (state.phase !== 'playing') return '對戰未進行中';
  if (state.turnPhase !== 'main') return '當前不在主階段（無法撤退）';
  const player = state.players[state.activePlayerIndex];
  if (!player.active) return '尚未派出戰鬥場寶可夢';
  if (player.active.fossilOnField) return '化石無法撤退（化石不是寶可夢）';
  if (player.bench.length === 0) return '備戰區無寶可夢可換上';
  if (player.retreatedThisTurn) return '本回合已撤退過（PTCG 規則：每回合僅一次撤退）';
  if (player.active.status === 'asleep') return '戰鬥場寶可夢睡眠中（PTCG 規則：無法撤退）';
  if (player.active.status === 'paralyzed') return '戰鬥場寶可夢麻痺中（PTCG 規則：無法撤退）';
  if (player.active.cantRetreatNextTurn) return '對手招式效果鎖定撤退（懶人獺 悠哉 / 束縛 / 鬼盜衝撞 等）';
  if (player.cantRetreatIfPoisonedThisTurn
      && (player.active.status === 'poisoned' || player.active.secondaryStatus === 'poisoned' || player.active.tertiaryStatus === 'poisoned')) {
    return '霍米加的演奏：本回合中毒的戰鬥場寶可夢無法撤退';
  }
  // 計算能量是否足夠（重用 getRetreatCost 的 cost 與 canRetreat 的能量比對）
  const cost = getRetreatCost(state, pool);
  if (cost === null) return '無法計算撤退費（未知原因 — 請回報）';
  const have = totalEnergyUnits(player.active.energyAttached, pool, state, state.activePlayerIndex, player.active);
  if (have < cost) return `能量不足（撤退需 ${cost} 顆，現有 ${have} 顆）`;
  return null;
}

/**
 * 列出手牌中可打出的訓練家牌 iid（考慮支援者限制）。
 */
export function getPlayableTrainers(state: GameState, pool: Map<string, Card>): string[] {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return [];
  if (state.pendingSelection) return [];
  // v5.212：祭典樂舞第 2 次招式 pending 期間禁止使用 trainer 卡（支援者/物品/道具/場地）
  if (state.festivalDancePendingSecondAttack
      && state.festivalDancePendingSecondAttack.idx === state.activePlayerIndex) return [];
  const player = state.players[state.activePlayerIndex];
  return player.hand
    .filter(inst => {
      const c = pool.get(inst.cardId);
      if (!c) return false;
      const isTool = c.supertype === 'Trainer' && c.subtype === 'PokemonTool';
      const isTrainer = c.supertype === 'Trainer';
      if (!isTool && !isTrainer) return false;
      if (c.subtype === 'Supporter' && player.supporterPlayedThisTurn) return false;
      // 先攻玩家第一回合禁用支援者（卡面「先攻最初回合也可使用」bypass）
      if (
        c.subtype === 'Supporter' &&
        state.isFirstTurn &&
        state.activePlayerIndex === state.firstPlayerIdx &&
        !canPlaySupporterOnFirstTurn(c)
      ) return false;
      // 競技場：一回合每位玩家只能打出一張
      //   v3.851 exception: 昂主花葉蒂卡面允許「使出了稜鏡塔的回合也可放置」→ 同回合第 2 張 Stadium
      if (c.subtype === 'Stadium' && (state.stadiumPlayedThisTurn?.[state.activePlayerIndex] ?? false)) {
        const prism = state.prismTowerPlayedThisTurn ?? [false, false];
        const aonzhuOk = c.name === '昂主花葉蒂' && prism[state.activePlayerIndex];
        if (!aonzhuOk) return false;
      }
      // v2.43：PTCG 規則 — 同名競技場不能覆蓋自己。
      // engine play path 也會 block，但 UI 需要在「可打出」清單就濾掉，
      // 否則手牌卡會亮黃框讓使用者誤以為可以拖曳（實際上拖下去會被 engine 擋）。
      if (c.subtype === 'Stadium' && state.activeStadium) {
        const prev = pool.get(state.activeStadium.cardId);
        if (prev?.name === c.name) return false;
      }
      // Wave 43 fix：玩家級物品/支援者鎖也要在可用清單裡濾掉（否則 AI 會挑到被鎖的卡、engine 靜默 no-op → AI 當機）
      if (c.subtype === 'Item' && player.cantPlayItemThisTurn) return false;
      if (c.subtype === 'Supporter' && player.cantPlaySupporterThisTurn) return false;
      // v3.82 fix：對手戰鬥場特性鎖也要在 filter 階段擋下（同樣 AI 死迴圈問題）
      //   - 胖嘟嘟ex｜海之詛咒：對手物品 + 寶可夢道具 鎖
      //   - 大王銅象｜爆大身軀：對手競技場鎖
      //   原本只有 engine.ts PLAY_TRAINER handler 在 line 2292-2301 擋 → 不夠
      //   AI 看不到濾過的清單會反覆挑到被鎖的卡 → engine 退回 → 死迴圈
      if ((c.subtype === 'Item' || c.subtype === 'PokemonTool')
          && isOppItemPlayBlocked(state, state.activePlayerIndex, pool)) return false;
      if (c.subtype === 'Stadium' && state.players[state.activePlayerIndex].cantPlayStadiumThisTurn) return false;
      if (c.subtype === 'Stadium' && isOppStadiumPlayBlocked(state, state.activePlayerIndex, pool)) return false;
      // v2.362 班基拉斯｜威迫目光 — 對手戰鬥場有此特性時，物品卡不可打出
      // v5.222：改用 hasAbilityOnActive helper (Rule 18)
      if (c.subtype === 'Item'
          && hasAbilityOnActive(state, (1 - state.activePlayerIndex) as 0 | 1, pool, '威迫目光')) {
        return false;
      }
      // v2.322：蓋諾賽克特｜ACE消弭 — 對手有附道具的蓋諾賽克特時，不能打 ACE SPEC
      if (c.tags?.includes('ACE SPEC') && isAceCancelActive(state, state.activePlayerIndex, pool)) return false;
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
  // v5.212：祭典樂舞第 2 次招式 pending 期間禁止放基礎寶可夢到備戰
  if (state.festivalDancePendingSecondAttack
      && state.festivalDancePendingSecondAttack.idx === state.activePlayerIndex) return [];
  const player = state.players[state.activePlayerIndex];
  // v2.136 零之大空洞：場上有太晶寶可夢時上限可達 8
  if (player.bench.length >= getBenchLimit(state, state.activePlayerIndex, pool)) return [];
  return player.hand
    .filter(inst => {
      const c = pool.get(inst.cardId);
      if (!isBasicPokemonCard(c)) return false;
      // v3.821：對手戰鬥場有瞪眼效用 → 有特性且非「火箭隊的」的基礎不可放置
      //   與 engine PLAY_BASIC handler line 1751 同條件 — 不擋 filter 會導致 AI 死迴圈
      if (isOppEvilEyeBlocking(state, state.activePlayerIndex, c, pool)) return false;
      return true;
    })
    .map(inst => inst.iid);
}

/**
 * v2.189：列出手牌中可作為基礎寶可夢上場的「化石 Item」。
 * 走 PLAY_FOSSIL action（不走 PLAY_TRAINER），UI 拖曳到備戰格時觸發。
 */
export function getPlayableFossils(state: GameState, pool: Map<string, Card>): string[] {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return [];
  // v5.212：祭典樂舞第 2 次招式 pending 期間禁止放化石
  if (state.festivalDancePendingSecondAttack
      && state.festivalDancePendingSecondAttack.idx === state.activePlayerIndex) return [];
  if (state.pendingSelection) return [];
  const aIdx = state.activePlayerIndex;
  const player = state.players[aIdx];
  if (player.bench.length >= getBenchLimit(state, aIdx, pool)) return [];
  // v4.936：化石卡是 Item — UI/AI filter 必須與 PLAY_FOSSIL handler 同 gate
  //   （否則 AI 一直選化石被退回 → 死迴圈；UI 也會顯示無效拖拽提示）
  //   a. attacker.cantPlayItemThisTurn — 含羞苞癢癢花粉 / 吼叫尾ex / 電蜘蛛ex 等鎖
  if (player.cantPlayItemThisTurn) return [];
  //   b. 對手戰鬥場 威迫目光（班基拉斯特性）— 未被消除時擋 Item
  //   v5.222：改用 hasAbilityOnActive helper (Rule 18)
  if (hasAbilityOnActive(state, (1 - aIdx) as 0 | 1, pool, '威迫目光')) return [];
  //   c. v3.821：對手戰鬥場 海之詛咒（胖嘟嘟ex特性）— 鎖物品
  if (isOppItemPlayBlocked(state, aIdx, pool)) return [];
  return player.hand
    .filter(inst => isFossilItemCard(pool.get(inst.cardId)))
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
  // v5.212：祭典樂舞第 2 次招式 pending 期間禁止使用特性
  if (state.festivalDancePendingSecondAttack
      && state.festivalDancePendingSecondAttack.idx === state.activePlayerIndex) return [];
  const player = state.players[state.activePlayerIndex];
  const allPokes: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  const result: Array<{ iid: string; abilityIndex: number; pokemonName: string; abilityName: string }> = [];
  for (const pk of allPokes) {
    // 不限次數特性（如烈火亂舞）即使 abilityUsedThisTurn 也繼續顯示
    if (pk.abilityUsedThisTurn) {
      const card = pool.get(pk.cardId);
      const hasUnlimited = card?.abilities?.some((ab, i) =>
        UNLIMITED_USE_ABILITY_NAMES.has(ab.name) && hasAbilityFn(card.name, ab.name, i)
      );
      if (!hasUnlimited) continue;
    }
    const card = pool.get(pk.cardId);
    if (!card?.abilities) continue;
    // v2.362 振翼髮｜暗夜羽擊：特性被消除的寶可夢不列入可用清單
    if (pk.abilityNullifiedThisTurn) continue;
    // 火箭隊的監視塔：【無】屬寶可夢的特性全部消除
    if (isColorlessAbilityBlocked(state, card, pool)) continue;
    // v3.01 Wave 3 — 振翼髮｜暗夜羽擊（passive）/ 海兔獸｜黏著束縛 location 標識
    const pkLocation: 'active' | 'bench' = state.players[state.activePlayerIndex].active?.iid === pk.iid ? 'active' : 'bench';
    card.abilities.forEach((ab, abIdx) => {
      // v3.01 Wave 3 — 暗夜羽擊（passive）/ 黏著束縛 特性消除：被消除的特性不列入清單
      if (isAbilityNullifiedByPassive(state, state.activePlayerIndex, pk, card, ab.name, pkLocation, pool)) return;
      // 只列出在 ABILITY_EFFECTS 中有登錄的主動特性
      // v4.4995：用 helper（by-name 優先 fallback by-index）
      if (!hasAbilityFn(card.name, ab.name, abIdx)) return;
      // v2.320：已改為自動提示的特性，不在手動清單中顯示
      if (ON_PLAY_FROM_HAND_ABILITIES.has(ab.name) || ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name)) return;
      // v4.498：ON_RETREAT_TO_BENCH 類特性（海豚俠 全能變身 / 鋼炮臂蝦 返回重載）
      //   卡面：「從戰鬥場回到備戰區時，可使用 1 次」— 只能透過撤退觸發 modal（v3.05 ask… hook）
      //   不該出現在手動「使用特性」清單中，避免玩家在 active 位誤點。
      if (ON_RETREAT_TO_BENCH_ABILITIES.has(ab.name)) return;
      // v4.4995：怨影使者已實裝（regAByName）+ 用 by-name dispatch — 不再撞 key
      // v4.76 修正（Rule 15 違反）：卡面「在這個回合，若從手牌使出了『阿杏的秘招』，則在自己的回合時可使用 1 次」
      //   **沒寫戰鬥場限制**。原 v4.4995 腦補加了 active gate，導致叉字蝠在備戰位時按鈕消失。
      //   PTCG 規則：特性可在 active 或 bench 使用，除非卡面明確限定。
      //   gate: 牌庫不空 + akyoSecretPlayedThisTurn flag = true（不限位置）
      if (ab.name === '怨影使者') {
        if (player.deck.length === 0) return;
        if (!player.akyoSecretPlayedThisTurn) return;  // 本回合需打過阿杏的秘招
      }
      // v5.519 土龍節節｜逃跑抽出 — 官方 Q&A：牌庫為 0 時不能使用（需先抽 3 張）→ 不列入可用清單。
      if (ab.name === '逃跑抽出' && player.deck.length === 0) return;
      // v4.4996：4 組撞 key 卡的另一個 ability — 都是 passive HP 修飾或未實裝，不該顯示「使用特性」按鈕
      //   - 生機森巴 (樂天河童 SV9/MC) — passive +40 HP，自動套用 getEffectiveHP
      //   - 雜草魂 (怖納噬草 SV8a) — passive 對手獎賞×50 HP，自動套用
      //   - 厚脂肪 (白海獅 M2) — v5.294 已實裝 (PASSIVE_DAMAGE_REDUCE_BY_ATTACKER)
      //   - 飢餓衝刺 (莫魯貝可 SV8a) — v5.297 已實裝 (ABILITY_RETREAT_MOD)
      //   regAByName 用 ability name 分流後，這些 ability 走 by-name 沒命中也不會 fallback 跑錯邏輯
      //   （另一個 ability name 的 regA 已遷移到 regAByName，by-index fallback 已不再有衝突 fn）
      // v5.294/v5.297 拿掉 '厚脂肪'/'飢餓衝刺' (兩者都已實裝為 passive, 不需特性按鈕)
      if (ab.name === '生機森巴' || ab.name === '雜草魂') return;
      // v4.4997：audit 補 11 個缺 gate 的特性 — 條件不符時不顯示「使用特性」按鈕（玩家規則）
      // ──────────────────────────────────────────────────────────────────────
      // P0：白海獅 | 沖刷 — 戰鬥場 + 備戰有【水】能量
      // v4.962：name 含【水】fallback — 基本【水】能量的 pokemonType 為 null
      //   (scraper 留空，type 從卡名推斷)，strict pokemonType==='Water' 會誤判。
      if (ab.name === '沖刷') {
        if (!player.active) return;
        // v5.702：host-aware energyProvidesType（與發動 handler 一致）→ 古舊/稜鏡(Basic)等視為水的特殊能量也算
        const hasWaterOnBench = player.bench.some(b =>
          b.energyAttached.some(e => energyProvidesType(b, e, 'Water', pool)));
        if (!hasWaterOnBench) return;
      }
      // P0：瑪力露麗ex | 收集泡泡 — v4.4998 修正：卡面沒要求 active 是瑪力露麗ex
      //   持有者不限位置（active 或 bench），場上其他寶可夢身上有能量即可
      if (ab.name === '收集泡泡') {
        const others = [
          ...(player.active && player.active.iid !== pk.iid ? [player.active] : []),
          ...player.bench.filter(b => b.iid !== pk.iid),
        ];
        if (!others.some(c => c.energyAttached.length > 0)) return;
      }
      // P0：青木的樹枕尾熊 | 無力充能 — 持有者在備戰 + 戰鬥場是「青木的」+ 手牌有能量
      if (ab.name === '無力充能') {
        if (player.active?.iid === pk.iid) return;  // 必須在備戰
        if (!player.active) return;
        const activeName = pool.get(player.active.cardId)?.name ?? '';
        if (!activeName.startsWith('青木的')) return;
        if (!player.hand.some(c => pool.get(c.cardId)?.supertype === 'Energy')) return;
      }
      // P0：勾帕路翁ex | 金屬之路 — 戰鬥場 + movedToActiveThisTurn + 備戰有【鋼】能量
      if (ab.name === '金屬之路') {
        if (player.active?.iid !== pk.iid) return;
        if (!player.active.movedToActiveThisTurn) return;
        // v5.702：host-aware energyProvidesType（與發動 handler 一致）→ 古舊/稜鏡等視為鋼的特殊能量也算
        const hasMetalOnBench = player.bench.some(b =>
          b.energyAttached.some(e => energyProvidesType(b, e, 'Metal', pool)));
        if (!hasMetalOnBench) return;
      }
      // P0：麻麻鰻 | 電氣發電機 — 棄牌區有基本【雷】+ 備戰非空
      if (ab.name === '電氣發電機') {
        const hasBasicLight = player.discard.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
            && (cc.pokemonType === 'Lightning' || cc.name.includes('【雷】'));
        });
        if (!hasBasicLight) return;
        if (player.bench.length === 0) return;
      }
      // P0：阿響的鳳王ex | 金色火焰 — 手牌有基本【火】+ 備戰有「阿響的」
      if (ab.name === '金色火焰') {
        const hasFireE = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
            && (cc.pokemonType === 'Fire' || cc.name.includes('【火】'));
        });
        if (!hasFireE) return;
        const hasAyanoBench = player.bench.some(c => (pool.get(c.cardId)?.name ?? '').startsWith('阿響的'));
        if (!hasAyanoBench) return;
      }
      // P1：妖火紅狐 | 閃焰魔法 — 手牌有基本【火】
      if (ab.name === '閃焰魔法') {
        const hasFireE = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
            && (cc.pokemonType === 'Fire' || cc.name.includes('【火】'));
        });
        if (!hasFireE) return;
      }
      // P1：光電傘蜥 | 頸傘發電 — carnelliPlayedThisTurn
      if (ab.name === '頸傘發電') {
        if (!player.carnelliPlayedThisTurn) return;
      }
      // P1：小木靈 | 怨恨進化 — 手牌有對應進化卡 + v5.192 加「無法在自己的最初回合使用」gate
      if (ab.name === '怨恨進化') {
        // v5.192：state.turn === 1 涵蓋雙方最初回合（先攻 turn 1 / 後攻 turn 1，
        //   因為 turn 只在後攻 END_TURN 才 +1；turn ≥ 2 表示雙方都不再是最初回合）
        if (state.turn === 1) return;
        const thisCard = pool.get(pk.cardId);
        if (!thisCard) return;
        const hasEvo = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Pokemon' && cc.evolvesFrom != null
            && cc.evolvesFrom === thisCard.name;
        });
        if (!hasEvo) return;
      }
      // P1：狂歡浪舞鴨 | 快節奏 — 手牌非空
      if (ab.name === '快節奏') {
        if (player.hand.length === 0) return;
      }
      // P1：奇樹的大電海燕 | 閃光抽出 — 自身有基本【雷】能量
      if (ab.name === '閃光抽出') {
        const hasLightOnSelf = pk.energyAttached.some(e => {
          const ec = pool.get(e.cardId);
          return ec?.supertype === 'Energy' && ec.subtype === 'Basic'
            && (ec.pokemonType === 'Lightning' || (ec?.name?.includes('【雷】') ?? false));
        });
        if (!hasLightOnSelf) return;
      }
      // ──────────────────────────────────────────────────────────────────────
      // 集客：只有出場才能用 + 牌庫不空（v2.229 補資源 gate）
      if (ab.name === '集客') {
        if (player.active?.iid !== pk.iid) return;
        if (player.deck.length === 0) return;
      }
      // 精神抽出 / 龐克練肌 / 合金建造（v2.102）：只有本回合剛進化才能用
      // v5.706：進化觸發特性可用性一律用 ON_EVOLVE_FROM_HAND_ABILITIES 單一來源(與 USE_ABILITY 後端 gate 一致)
      if (ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name) && !pk.evolvedThisTurn) return;
      // v2.229 精神抽出（魔靈多龍系）：除 evolvedThisTurn 外還需牌庫不空（要看 top 5）
      // v2.323：龐克練肌 移除牌庫惡能量 gate（隱藏資訊規則）
      // v2.229 合金建造（鋁鋼橋龍ex）：除 evolvedThisTurn 外還需棄牌區基本【鋼】能量 + 場上【鋼】寶可夢
      //   — Leon v2.228 抓到沒 gate；卡面：「從棄牌區選最多 2 張基本鋼能量附給自己的鋼寶可夢」
      if (ab.name === '合金建造') {
        const hasMetalEInDiscard = player.discard.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
            && (cc.pokemonType === 'Metal' || /【鋼】/.test(cc.name));
        });
        if (!hasMetalEInDiscard) return;
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasMetalPoke = field.some(c => pool.get(c.cardId)?.pokemonType === 'Metal');
        if (!hasMetalPoke) return;
      }
      // v2.126 螺釘地鼠｜狂挖 — 只有「從手牌將這張卡放置於備戰區的那個回合」可用
      //   pk.justPlaced 由 PLAY_BASIC 設、END_TURN 清，所以「下一回合不能用」自然成立
      //   v2.323：移除牌庫鬥能量 gate（隱藏資訊規則）
      if (ab.name === '狂挖') {
        if (!pk.playedFromHand) return;
      }
      // v2.127 月月熊 赫月｜經驗法則 — 同 狂挖 pattern，只有剛從手牌放置於備戰區的回合可用
      //   v2.229 補：手牌需有基本【鬥】能量（Leon v2.228 抓到）
      //   卡面：「從手牌選最多 2 張基本鬥能量附於這隻寶可夢」
      if (ab.name === '經驗法則') {
        if (!pk.playedFromHand) return;
        const hasFightEInHand = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && /【鬥】/.test(cc.name);
        });
        if (!hasFightEInHand) return;
      }
      // v2.133 古劍豹｜沉雪、鐵斑葉ex｜迅速游標、喵喵ex｜殺手鐧捕捉 — 同 playedFromHand gate
      if ((ab.name === '沉雪' || ab.name === '迅速游標' || ab.name === '殺手鐧捕捉') && !pk.playedFromHand) return;
      // v2.93b 拉帝歐斯｜潔淨支援 — 觸發 gate：active 必須是「超級拉帝亞斯ex」+ 本回合移到戰鬥場
      //   且自方備戰至少 1 隻有附加能量。
      if (ab.name === '潔淨支援') {
        if (!player.active) return;
        const activeCard = pool.get(player.active.cardId);
        if (activeCard?.name !== '超級拉帝亞斯ex') return;
        if (!player.active.movedToActiveThisTurn) return;
        if (!player.bench.some(b => b.energyAttached.length > 0)) return;
      }
      // ─── v2.96 補 5 個既實裝但缺 gate 的特性（按下才跳「無法使用」是壞 UX） ─────
      // 振翅高飛（遠古巨蜓ex）：戰鬥場 + 本回合移到戰鬥場 + 牌庫不空
      if (ab.name === '振翅高飛') {
        if (player.active?.iid !== pk.iid) return;
        if (!player.active.movedToActiveThisTurn) return;
        if (player.deck.length === 0) return;
      }
      // 夜間工作（叉字蝠）：在戰鬥場 + 牌庫不空
      if (ab.name === '夜間工作') {
        if (player.active?.iid !== pk.iid) return;
        if (player.deck.length === 0) return;
      }
      // 蒐證（貓鼬探長）：手牌 ≥ 1 + 牌庫 ≥ 1（要互換 1 張手牌與牌庫頂）
      if (ab.name === '蒐證') {
        if (player.hand.length === 0) return;
        if (player.deck.length === 0) return;
      }
      // 搜尋點心（莫魯貝可，v2.95 實裝）：牌庫不空（要看牌庫頂 1 張）
      if (ab.name === '搜尋點心' && player.deck.length === 0) return;
      // 增長繭（甲殼繭）：本回合進化 + 備戰未滿（要從牌庫搜進化形態放備戰）
      // v5.040：bench >= 5 改 getBenchLimit 支援零之大空洞 + 太晶 (5→8)
      if (ab.name === '增長繭') {
        if (!pk.evolvedThisTurn) return;
        if (player.bench.length >= getBenchLimit(state, state.activePlayerIndex, pool)) return;
        if (player.deck.length === 0) return;
      }
      // v2.133 沉雪 額外 gate：場上沒有競技場卡時無意義
      if (ab.name === '沉雪' && !state.activeStadium) return;
      // v2.133 迅速游標 gate：必須從備戰發動（pk 不是 active）
      if (ab.name === '迅速游標' && player.active?.iid === pk.iid) return;
      // 腎上腺腦力（願增猿）：身上 ≥1 顆【惡】能量 && 自己場上 ≥1 隻受傷（damage≥10）
      //   && 對手場上 ≥1 隻寶可夢。v2.123 補後兩個 gate（Leon 反饋：不符條件就不顯按鈕）。
      // v2.371→v2.372：再加「探探鼠｜監視之眼」檢查；改為通用標籤
      //   isAbilityBlockedByOakEye（MOVE_DAMAGE_COUNTER_ABILITIES set），新增同類特性
      //   時只要把名字加進 set 即可自動受 gate 保護。
      if (ab.name === '腎上腺腦力') {
        if ((countEnergy(pk, pool).get('Darkness') ?? 0) < 1) return;
        const selfField = [...(player.active ? [player.active] : []), ...player.bench];
        if (!selfField.some(c => c.damage >= 10)) return;
        const oppIdx = (1 - state.activePlayerIndex) as 0 | 1;
        const opp = state.players[oppIdx];
        if (!opp.active && opp.bench.length === 0) return;
      }
      // ⭐v6.049 探探鼠｜監視之眼（「雙方的所有寶可夢身上放置的傷害指示物，無法改放於
      //   其他寶可夢身上」）**不再隱藏特性按鈕**。Wilson 裁定：監視之眼擋的是「改放指示物」
      //   這個**效果**，被擋住的寶可夢**仍然是擁有特性的寶可夢**，特性照樣可以發動，
      //   只是發動之後效果被擋下而失效（該特性的 regA 入口仍有 gate 會 log 原因）。
      //   原本在這裡 return 會讓按鈕直接消失，玩家看不出「特性還在、只是被擋」。
      // v2.53 碧綠之舞：手牌必須至少有 1 張基本草能量（否則按了只會輸出警告 log，
      // Leon 反饋希望 UI 直接隱藏按鈕，而不是誤按後才提示）。
      // v5.510 熱浪鱗粉（火神蛾）：手牌需有基本【火】能量 + 對手 active 非已灼傷（碧綠之舞 pattern 隱藏按鈕）
      if (ab.name === '熱浪鱗粉') {
        const hasFire = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && (cc.name?.includes('【火】') ?? false);
        });
        const oppA = state.players[(1 - state.activePlayerIndex) as 0 | 1].active;
        if (!hasFire || !oppA || hasStatusInAnySlot(oppA, 'burned')) return; // v5.842 跨三槽:對手已灼傷(任一槽)則隱藏
      }
      // v5.510 誘導之尾（超能妙喵）：手牌需有「悠哉尾草棒」 + 對手 active + 對手備戰≥1
      if (ab.name === '誘導之尾') {
        const hasSlow = player.hand.some(c => pool.get(c.cardId)?.name === '悠哉尾草棒');
        const oppP = state.players[(1 - state.activePlayerIndex) as 0 | 1];
        if (!hasSlow || !oppP.active || oppP.bench.length === 0) return;
      }
      if (ab.name === '碧綠之舞') {
        const hasGrassEnergy = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          if (cc?.supertype !== 'Energy' || cc.subtype !== 'Basic') return false;
          return cc.pokemonType === 'Grass' || cc.name.includes('【草】');
        });
        if (!hasGrassEnergy) return;
      }
      // v2.59 充能（火箭隊的操陷蛛）：棄牌區必須至少有 1 張基本能量。
      // 與碧綠之舞同模式 — 條件未滿足時直接不顯示按鈕，不要讓玩家按了才收到 log。
      if (ab.name === '充能') {
        const hasBasicEnergyInDiscard = player.discard.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic';
        });
        if (!hasBasicEnergyInDiscard) return;
      }
      // v2.117 沸騰鬥志（火焰雞ex）：棄牌區必須有基本能量，否則隱藏按鈕。
      //   與充能同 pattern，避免玩家按下才跳 log（無法取消的壞體驗）。
      if (ab.name === '沸騰鬥志') {
        const hasBasicEnergyInDiscard = player.discard.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic';
        });
        if (!hasBasicEnergyInDiscard) return;
      }
      // v2.117 岩石武裝（龜足巨鎧）：手牌需有基本【鬥】能量 && 場上需有【鬥】寶可夢。
      if (ab.name === '岩石武裝') {
        const hasFightEInHand = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && /【鬥】/.test(cc.name);
        });
        if (!hasFightEInHand) return;
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasFightPoke = field.some(c => pool.get(c.cardId)?.pokemonType === 'Fighting');
        if (!hasFightPoke) return;
      }
      // v2.117 惡棍衝天（顫弦蠑螈）：備戰需有【惡】寶可夢。
      //   v2.324：移除牌庫惡能量 gate（隱藏資訊規則）
      if (ab.name === '惡棍衝天') {
        const hasDarkBench = player.bench.some(b => pool.get(b.cardId)?.pokemonType === 'Darkness');
        if (!hasDarkBench) return;
      }
      // v2.117 必殺手裡劍（超級甲賀忍蛙ex）：須在戰鬥場 && 手牌有基本【水】能量。
      if (ab.name === '必殺手裡劍') {
        if (player.active?.iid !== pk.iid) return;
        const hasWaterInHand = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic' &&
            (cc.pokemonType === 'Water' || /【水】/.test(cc.name));
        });
        if (!hasWaterInHand) return;
      }
      // v2.131 交易（N的索羅亞克ex）：手牌需 ≥1（要棄 1 張）且 牌庫需 ≥1（要抽 2 但卡面用詞是「抽出 2 張卡」— 至少要能抽 1 張）。
      //   卡面只需棄 1 張就能用。我們不卡 deck≥2，因為 PTCG 規則一般是「抽到沒抽為止」。
      if (ab.name === '交易') {
        if (player.hand.length === 0) return;
        if (player.deck.length === 0) return;
      }
      // v2.340 哈克龍｜進化指引：持有者身上需有能量，牌庫需有進化寶可夢。
      if (ab.name === '進化指引') {
        if (pk.energyAttached.length === 0) return;
        const hasEvolution = player.deck.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Pokemon' && (
            cc.stage === 'Stage1' || cc.stage === 'Stage2' ||
            cc.subtype === 'Stage1' || cc.subtype === 'Stage2'
          );
        });
        if (!hasEvolution) return;
      }
      // v2.340 超級快龍ex｜天空搬運：需有備戰可互換。
      if (ab.name === '天空搬運' && player.bench.length === 0) return;
      // v2.340 花舞鳥ex｜激動渦輪：場上有【火】超級進化ex + 手牌火能 + 備戰火寶可夢。
      if (ab.name === '激動渦輪') {
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasFireMegaEx = field.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.name?.startsWith('超級') && cc?.name?.endsWith('ex') && cc?.pokemonType === 'Fire';
        });
        if (!hasFireMegaEx) return;
        const hasFireEnergy = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic' &&
            (cc.pokemonType === 'Fire' || cc.name.includes('【火】'));
        });
        if (!hasFireEnergy) return;
        const hasFireBench = player.bench.some(c => pool.get(c.cardId)?.pokemonType === 'Fire');
        if (!hasFireBench) return;
      }
      // 可達鴨｜濕氣：自身 KO 類特性被消除（不列入可用清單）
      if (SELF_KO_ABILITY_NAMES.has(ab.name) && isSelfKOEffectBlocked(state, pool)) return;

      // v2.91 → v2.93 修正：同名特性共享 1 次 — 只對白名單（月光循環 / 使者衝刺）
      if (
        SHARED_ONCE_PER_TURN_ABILITY_NAMES.has(ab.name)
        && player.abilityNamesUsedThisTurn?.includes(ab.name)
      ) return;

      // v2.91 使者衝刺（超級袋獸ex）：「若這隻寶可夢在戰鬥場上，...」→ 備戰時不顯示
      if (ab.name === '使者衝刺' && player.active?.iid !== pk.iid) return;

      // v2.91 月光循環（月石）：場上需有「太陽岩」+ 手牌需有 1 張基本【鬥】能量
      if (ab.name === '月光循環') {
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasSunstone = field.some(c => pool.get(c.cardId)?.name === '太陽岩');
        if (!hasSunstone) return;
        const hasFightEnergy = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
            && (cc.name?.includes('【鬥】') ?? false);
        });
        if (!hasFightEnergy) return;
      }
      // v2.224 / v3.874 風扇呼喚（旋轉洛托姆）：「只有在自己的最初回合可使用 1 次」
      //   v3.874：state.turn 在「後攻方 END_TURN」才 +1（engine.ts:5737），所以
      //   state.turn=1 涵蓋雙方第 1 個動作回合（雙方最初回合）
      //   state.turn=2 涵蓋雙方第 2 個動作回合（已不是最初回合）
      //   原 v2.224 gate 寫 turn > 2 是基於誤解（以為 turn 1=先攻第1回合 turn 2=後攻第1回合），
      //   實際每 turn 整數涵蓋雙方各一次，必須改 turn > 1。
      //   v2.229 補：牌庫不空（搜空 deck 沒意義）
      if (ab.name === '風扇呼喚') {
        if (state.turn > 1) return;
        if (player.deck.length === 0) return;
      }
      // ─── v2.229 大批主動特性 gate 補完（之前 audit 漏掉，按下才跳 log 的災難） ─────
      // v2.363 桃歹郎ex｜支配鎖鏈：備戰特性，不限戰鬥場；備戰有【惡】寶可夢（非桃歹郎ex）才可用
      // （v2.229 錯誤加入「必須在戰鬥場」gate，已移除）
      if (ab.name === '支配鎖鏈') {
        const validBench = player.bench.filter(c => {
          const cc = pool.get(c.cardId);
          return cc?.pokemonType === 'Darkness' && cc?.name !== '桃歹郎ex';
        });
        if (validBench.length === 0) return;
      }
      // v2.229 普隆隆姆｜轟鳴引擎：手牌需有能量
      if (ab.name === '轟鳴引擎') {
        const hasEnergy = player.hand.some(c => pool.get(c.cardId)?.supertype === 'Energy');
        if (!hasEnergy) return;
      }
      // v2.229 三合一磁怪｜過度放電：棄牌區有基本【雷】能量 + 場上有【雷】寶可夢
      //   （此特性自 KO，所以不檢查可達鴨濕氣 — 已在 SELF_KO 區塊處理）
      if (ab.name === '過度放電') {
        const hasLightningE = player.discard.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && (cc.pokemonType === 'Lightning' || cc.name.includes('【雷】'));
        });
        if (!hasLightningE) return;
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasLightningPoke = field.some(c => pool.get(c.cardId)?.pokemonType === 'Lightning');
        if (!hasLightningPoke) return;
      }
      // v2.229 蜜集大蛇ex｜熟成充能：手牌有基本【草】能量 + 場上有寶可夢
      if (ab.name === '熟成充能') {
        const hasGrassE = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
            && (cc.pokemonType === 'Grass' || /【草】/.test(cc.name));
        });
        if (!hasGrassE) return;
      }
      // v2.229 啪咚猴｜衝衝鼓：戰鬥位是「祭典樂舞」寶可夢 + 牌庫不空
      if (ab.name === '衝衝鼓') {
        if (!player.active) return;
        const activeCard = pool.get(player.active.cardId);
        const isFestival = activeCard?.abilities?.some(a => a.name === '祭典樂舞');
        if (!isFestival) return;
        // v5.456 暗夜羽擊：戰鬥位「祭典樂舞」被對手 passive 消除 → 衝衝鼓不可用
        if (isAbilityNullifiedByPassive(state, state.activePlayerIndex, player.active, activeCard, '祭典樂舞', 'active', pool)) return;
        if (player.deck.length === 0) return;
      }
      // v2.229 貓頭夜鷹｜搜尋寶石：evolvedThisTurn + 場上太晶寶可夢 + 牌庫不空
      if (ab.name === '搜尋寶石') {
        if (!pk.evolvedThisTurn) return;
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasTera = field.some(c => pool.get(c.cardId)?.tags?.includes('太晶'));
        if (!hasTera) return;
        if (player.deck.length === 0) return;
      }
      // v2.229 蓋諾賽克特ex｜金屬信號
      //   v2.324：移除牌庫鋼進化寶可夢 gate（隱藏資訊規則）— 讓玩家可搜尋牌庫
      // (no gate needed — deck content is hidden info)
      // v2.229 大吾的巨金怪ex｜X啟動：場上有【超】或【鋼】寶可夢
      //   v2.324：移除牌庫超/鋼能量 gate（隱藏資訊規則）
      if (ab.name === 'X啟動') {
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasPsyOrMetalPoke = field.some(c => {
          const t = pool.get(c.cardId)?.pokemonType;
          return t === 'Psychic' || t === 'Metal';
        });
        if (!hasPsyOrMetalPoke) return;
      }
      // v2.229 多龍奇｜偵查指令：牌庫不空
      if (ab.name === '偵查指令' && player.deck.length === 0) return;
      // v2.229 超級妙蛙花ex｜日光轉移：場上有寶可夢身上有基本【草】能量
      if (ab.name === '日光轉移') {
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasGrassEnergyOnField = field.some(p =>
          p.energyAttached.some(e => {
            const cc = pool.get(e.cardId);
            return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
              && (cc.pokemonType === 'Grass' || /【草】/.test(cc.name));
          }));
        if (!hasGrassEnergyOnField) return;
      }
      // v2.229 金屬怪｜金屬製造者：牌庫不空 + 場上有【鋼】寶可夢
      if (ab.name === '金屬製造者') {
        if (player.deck.length === 0) return;
        const field = [...(player.active ? [player.active] : []), ...player.bench];
        const hasMetal = field.some(c => pool.get(c.cardId)?.pokemonType === 'Metal');
        if (!hasMetal) return;
      }
      // v2.229 竹蘭的尖牙陸鯊｜王者呼聲
      //   v2.324：移除牌庫竹蘭寶可夢 gate（隱藏資訊規則）— 讓玩家可搜尋牌庫
      // (no gate needed — deck content is hidden info)
      // v2.229 阿響的火岩鼠｜旅途牽絆：牌庫不空
      if (ab.name === '旅途牽絆' && player.deck.length === 0) return;
      // v2.290 烈焰馬｜快走：牌庫不空（要抽 1 張）
      if (ab.name === '快走' && player.deck.length === 0) return;
      // v2.295 烈火亂舞（炎武王）：手牌需有基本【火】能量（且場上有寶可夢可附）
      if (ab.name === '烈火亂舞') {
        const hasFireEInHand = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
            && (cc.pokemonType === 'Fire' || /【火】/.test(cc.name));
        });
        if (!hasFireEInHand) return;
      }
      // ──────────────────────────────────────────────────────────────────────
      // 扭轉乾坤：上個『對手的回合』自己寶可夢昏厥了才可用（同不公印章邏輯）。
      // v2.246 修：精確 KO cause tracking
      //   合法觸發：對手主回合中的「招式 KO」+「主動特性 KO」（咒詛炸彈等）
      //   排除：checkup KO（中毒/灼傷/冰冷之帳）+ 自 KO（自己 main phase 自爆）
      if (ab.name === '扭轉乾坤') {
        const myIdx = state.activePlayerIndex;
        const attackKO = state.oppAttackKOdMeInLastOppTurn?.[myIdx] ?? 0;
        const abilityKO = state.oppAbilityKOdMeInLastOppTurn?.[myIdx] ?? 0;
        if (attackKO + abilityKO === 0) return;
      }
      // ─── v2.995 Group 4 Wave 1 button gates ─────────────────────
      // 凱西｜瞬間移動者 / 燈罩夜菇｜平靜之光 / 波爾凱尼恩ex｜燒灼蒸汽 / 雪絨蛾｜勸誘羽：必須在戰鬥場上
      if (ab.name === '瞬間移動者' || ab.name === '平靜之光' || ab.name === '燒灼蒸汽' || ab.name === '勸誘羽') {
        if (player.active?.iid !== pk.iid) return;
      }
      // 凱西｜瞬間移動者：需備戰至少 1 隻（移除後要能上備戰）
      if (ab.name === '瞬間移動者' && player.bench.length === 0) return;
      // 雪絨蛾｜勸誘羽：雙方牌庫需不空（雙方各抽 1）
      if (ab.name === '勸誘羽') {
        const dIdx = (1 - state.activePlayerIndex) as 0 | 1;
        if (player.deck.length === 0 && state.players[dIdx].deck.length === 0) return;
      }
      // 魔幻假面喵｜表演時間：必須在備戰區 + 戰鬥場有寶可夢
      if (ab.name === '表演時間') {
        if (player.active?.iid === pk.iid) return; // 在戰鬥場不顯示
        if (!player.active) return;
      }
      // 直衝熊｜激動衝刺：備戰區 + 戰鬥場有寶可夢 + 自方場有超級進化ex
      if (ab.name === '激動衝刺') {
        if (player.active?.iid === pk.iid) return;
        if (!player.active) return;
        const allFs = [player.active, ...player.bench];
        const hasMegaEx = allFs.some(c => {
          const cc = pool.get(c.cardId);
          return !!cc && cc.name.startsWith('超級') && (cc.subtype === 'ex' || cc.name.endsWith('ex'));
        });
        if (!hasMegaEx) return;
      }
      // 壺壺｜發酵果汁：身上需有【草】能量
      if (ab.name === '發酵果汁') {
        // v5.702 host-aware：卡面「【草】能量卡」(不限基本)→ 古舊(全屬性)/稜鏡(在 Basic 壺壺上=全屬性)也算
        const hasGrass = pk.energyAttached.some(e => energyProvidesType(pk, e, 'Grass', pool));
        if (!hasGrass) return;
      }
      // 樂天河童｜激動治癒：自方場上需有【草】超級進化ex
      if (ab.name === '激動治癒') {
        const allFs = [...(player.active ? [player.active] : []), ...player.bench];
        const hasGrassMega = allFs.some(c => {
          const cc = pool.get(c.cardId);
          return !!cc && cc.name.startsWith('超級') && (cc.subtype === 'ex' || cc.name.endsWith('ex')) && cc.pokemonType === 'Grass';
        });
        if (!hasGrassMega) return;
      }
      // 大劍鬼｜激流旋渦：自方備戰需有 1 隻可互換（對手互換部分不增設 gate）
      if (ab.name === '激流旋渦') {
        if (!player.active) return;
        if (player.bench.length === 0) return;
      }
      // 寶包繭｜飛葉治癒：戰鬥場有者且受傷（避免按了沒效果）
      if (ab.name === '飛葉治癒') {
        if (!player.active) return;
        if (player.active.damage === 0) return;
      }
      // 霜奶仙ex｜甜點之禮 / 壺壺｜發酵果汁 / 樂天河童｜激動治癒：需場上有受傷的寶可夢（沒受傷按了也沒效果）
      if (ab.name === '甜點之禮' || ab.name === '發酵果汁' || ab.name === '激動治癒') {
        const allFs = [...(player.active ? [player.active] : []), ...player.bench];
        if (!allFs.some(c => c.damage > 0)) return;
      }
      // ─── v2.996 Group 4 Wave 2 button gates ─────────────────────
      // 豆豆鴿｜緊急進化：剩餘 HP ≤ 30 + 牌庫不空（無對應卡時走「僅重洗」分支）
      if (ab.name === '緊急進化') {
        if (!card.hp) return;
        const currentHP = card.hp - pk.damage;
        if (currentHP > 30) return;
        if (player.deck.length === 0) return;
      }
      // 保母曼波｜溫柔鰭：戰鬥場 + 備戰未滿 + 棄牌區有 HP≤70 基礎寶可夢
      // v5.040：bench >= 5 改 getBenchLimit 支援零之大空洞 + 太晶 (5→8)
      if (ab.name === '溫柔鰭') {
        if (player.active?.iid !== pk.iid) return;
        if (player.bench.length >= getBenchLimit(state, state.activePlayerIndex, pool)) return;
        const hasCand = player.discard.some(c => {
          const cc = pool.get(c.cardId);
          if (!cc || cc.supertype !== 'Pokemon') return false;
          const isBasic = cc.subtype === 'Basic' || cc.stage === 'Basic';
          return isBasic && typeof cc.hp === 'number' && cc.hp <= 70;
        });
        if (!hasCand) return;
      }
      // 始祖大鳥｜原始之翼：戰鬥場 + 對手場上至少 1 隻進化寶可夢
      if (ab.name === '原始之翼') {
        if (player.active?.iid !== pk.iid) return;
        const oppIdx = (1 - state.activePlayerIndex) as 0 | 1;
        const opp = state.players[oppIdx];
        const allOpp = [...(opp.active ? [opp.active] : []), ...opp.bench];
        const hasEvo = allOpp.some(c => (c.evolvedFromStack?.length ?? 0) >= 1);
        if (!hasEvo) return;
      }
      // 烈焰猴｜火焰蹈舞：手牌至少有【火】或【鬥】基本能量
      if (ab.name === '火焰蹈舞') {
        const hasFireOrFight = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          if (!cc || cc.supertype !== 'Energy' || cc.subtype !== 'Basic') return false;
          if (cc.pokemonType === 'Fire' || /【火】/.test(cc.name)) return true;
          if (cc.pokemonType === 'Fighting' || /【鬥】/.test(cc.name)) return true;
          return false;
        });
        if (!hasFireOrFight) return;
      }
      // 火箭隊的多邊獸Ｚ｜再構築：手牌 ≥ 2（要丟 2 張）+ 牌庫 ≥ 1（要抽 1 張）
      if (ab.name === '再構築') {
        if (player.hand.length < 2) return;
        if (player.deck.length < 1) return;
      }
      // 小霞的可達鴨｜重步跳躍：在備戰區（不在戰鬥場）
      if (ab.name === '重步跳躍') {
        if (player.active?.iid === pk.iid) return;
      }
      // 哥德小姐｜曲扭未來：戰鬥場
      if (ab.name === '曲扭未來') {
        if (player.active?.iid !== pk.iid) return;
      }
      // 禿鷹娜｜瞄準獵物：對手手牌有 HP≤70 基礎寶可夢 + 對手備戰未滿
      if (ab.name === '瞄準獵物') {
        const oppIdx = (1 - state.activePlayerIndex) as 0 | 1;
        const opp = state.players[oppIdx];
        // v5.040：bench >= 5 改 getBenchLimit 支援零之大空洞 + 太晶 (5→8)
        if (opp.bench.length >= getBenchLimit(state, oppIdx, pool)) return;
        const hasCand = opp.hand.some(c => {
          const cc = pool.get(c.cardId);
          if (!cc || cc.supertype !== 'Pokemon') return false;
          const isBasic = cc.subtype === 'Basic' || cc.stage === 'Basic';
          return isBasic && typeof cc.hp === 'number' && cc.hp <= 70;
        });
        if (!hasCand) return;
      }
      // 奇樹的電肚蛙ex｜電氣流：手牌有【雷】基本能量 + 場上有「奇樹的」寶可夢
      if (ab.name === '電氣流') {
        const hasLightningE = player.hand.some(c => {
          const cc = pool.get(c.cardId);
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic'
            && (cc.pokemonType === 'Lightning' || /【雷】/.test(cc.name));
        });
        if (!hasLightningE) return;
        const allFs = [...(player.active ? [player.active] : []), ...player.bench];
        const hasKitree = allFs.some(c => pool.get(c.cardId)?.name?.startsWith('奇樹的') ?? false);
        if (!hasKitree) return;
      }
      // 毒粉蛾｜微風吹拂：對手戰鬥位有能量
      if (ab.name === '微風吹拂') {
        const oppIdx = (1 - state.activePlayerIndex) as 0 | 1;
        const opp = state.players[oppIdx];
        if (!opp.active) return;
        if (opp.active.energyAttached.length === 0) return;
      }
      result.push({ iid: pk.iid, abilityIndex: abIdx, pokemonName: card.name, abilityName: ab.name });
    });
  }
  return result;
}

// ── v2.63 撤退能量選擇 resolver ────────────────────────────────────────────────
// 當戰鬥寶可夢附加多種屬性能量時，RETREAT action 會開 pendingSelection 改走這裡；
// selectedIids = 玩家挑要丟棄的 N 張能量 iid（N = retreatCost）。
// 把撤退的主流程複製一份但改用「手選」的能量集，再完成上場切換。
RESOLVERS.set('retreat-energy-discard', (state, actorIdx, selectedIids, params, pool) => {
  const newActiveIid = params?.newActiveIid as string | undefined;
  const retreatCost = (params?.retreatCost as number | undefined) ?? 0;
  if (!newActiveIid) return state;

  const players = [...state.players] as [PlayerState, PlayerState];
  const attacker = { ...players[actorIdx] };
  if (!attacker.active) return state;

  // v2.69：驗證「選取能量的總 units ≥ retreatCost」（火箭隊能量 1 張 = 2 units）。
  const picked = new Set(selectedIids);
  if (picked.size === 0) return state;

  // 驗證每個 iid 都存在於 energyAttached
  const allIids = new Set(attacker.active.energyAttached.map(e => e.iid));
  for (const iid of picked) {
    if (!allIids.has(iid)) return state;
  }

  // 計算選中能量的總單位數
  // v2.108：傳 state+actorIdx 讓大竺葵繁茂套上（基本【草】能量 = 2 units）。
  const pickedInsts = attacker.active.energyAttached.filter(e => picked.has(e.iid));
  if (totalEnergyUnits(pickedInsts, pool, state, actorIdx, attacker.active) < retreatCost) return state;

  const bIdx = attacker.bench.findIndex(c => c.iid === newActiveIid);
  if (bIdx < 0) return state;

  const activeCard = pool.get(attacker.active.cardId);

  const discardE = attacker.active.energyAttached.filter(e => picked.has(e.iid));
  const keepE = attacker.active.energyAttached.filter(e => !picked.has(e.iid));

  const retreatingPoke = clearActiveEffects({ ...attacker.active, energyAttached: keepE });
  const newActive = { ...attacker.bench[bIdx], movedToActiveThisTurn: true };
  const newBench = attacker.bench.filter((_, i) => i !== bIdx);
  newBench.push(retreatingPoke);

  attacker.active = newActive;
  attacker.bench = newBench;
  attacker.discard = [...attacker.discard, ...discardE];
  attacker.retreatedThisTurn = true;
  players[actorIdx] = attacker;

  const newActiveCard = pool.get(newActive.cardId);
  const prefix = `${attacker.name} 的 ${activeCard?.name ?? '?'} 撤退`;
  const discardNames = discardE.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const msg = discardE.length > 0
    ? `${prefix}（丟棄：${discardNames}），${newActiveCard?.name ?? '?'} 上場！`
    : `${prefix}，${newActiveCard?.name ?? '?'} 上場！`;

  const afterState: GameState = {
    ...state,
    players,
    log: [...state.log, { turn: state.turn, playerIndex: actorIdx, message: msg, timestamp: Date.now() }],
  };
  // v5.243：撤退能量 picker 版同樣加 ON_PROMOTE_TO_ACTIVE prompt
  return tryPromptPromoteActive(afterState, actorIdx, pool);
});
