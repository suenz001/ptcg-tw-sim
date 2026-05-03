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
import type {
  GameState, GameAction, CardInstance,
  PlayerState, LogEntry, TurnPhase, GamePhase
} from './types';
import {
  TRAINER_EFFECTS, RESOLVERS, ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, canPlayTrainer,
  PASSIVE_DAMAGE_REDUCE, PASSIVE_IMMUNITY, PASSIVE_RETALIATION, PASSIVE_ATTACK_BONUS,
  TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE, TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY,
  TOOL_PREVENT_KO, TOOL_ON_KO, TOOL_PRIZE_BONUS, TOOL_ON_DAMAGED,
  TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS,
  TOOL_END_TURN_DISCARD,
  ABILITY_RETREAT_MOD,
  BENCH_PLACE_TRIGGERS, JAMMING_TOWER_STADIUMS, ROCKET_WATCHTOWER_STADIUMS,
  SPECIAL_ENERGY_ATTACH,
  SPECIAL_ENERGY_HP_BONUS, SPECIAL_ENERGY_RETREAT_MOD,
  SPECIAL_ENERGY_STATUS_IMMUNE, SPECIAL_ENERGY_ON_DAMAGED,
  clearActiveEffects,
  clearFestivalVenueProtectedStatuses,
  hasFairyZoneField,
  applyBenchPlaceSideEffects,
  getKyuremElectroplasmaEffectiveCost,
  getOctopusTentacleEffectiveCost,
  getUrsalunaBloodMoonEffectiveCost,
  PASSIVE_PREVENT_KO,
  flipCoinsWithLog,
  promptPlayAbilities,
  ON_PLAY_FROM_HAND_ABILITIES,
  ON_EVOLVE_FROM_HAND_ABILITIES,
} from './effects';

// ── 阻礙之塔（阻礙道具發動）── 輔助判定 ──────────────────────────────────────
// 當場上活動場地卡為 JAMMING_TOWER_STADIUMS 所列競技場卡時，雙方所有【道具】不發動效果。
// 這個閘門會包在所有 TOOL_* 查找上，讓道具的 HP 加成、攻擊 +N、退避減免等全部失效。
function isToolsJammed(state: GameState, pool: Map<string, Card>): boolean {
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
    return !!pk.toolAttached;
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
      ...(inst.toolAttached ? [inst.toolAttached] : []),
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
]);

/**
 * v2.295 「不限次數」主動特性白名單。
 * 卡面明寫「可不限次數使用」的特性列於此，
 * 引擎將跳過每回合 1 次的 abilityUsedThisTurn gate 與標記。
 */
export const UNLIMITED_USE_ABILITY_NAMES = new Set<string>([
  '烈火亂舞', // 炎武王 — 在自己的回合時，可不限次數使用：從手牌選拉1張「基本【火】能量」卡附於自己的寶可夢身上。
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
export function isBasicPokemonCard(card: Card | undefined): card is Card {
  if (!card || card.supertype !== 'Pokemon') return false;
  if (card.subtype === 'Other') return false; // 道具卡
  if (card.subtype === 'Stage1' || card.subtype === 'Stage2') return false; // v2.62 加固
  return !card.evolvesFrom;
}

/** 從 pool 判斷一張牌是否為「基礎寶可夢」 */
function isBasicPokemon(cardId: string, pool: Map<string, Card>): boolean {
  return isBasicPokemonCard(pool.get(cardId));
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
import { sameEvoName, recordOppKO } from './effects/_shared';
export { sameEvoName };

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
  // 阻礙之塔（Stadium）會讓道具 HP 加成失效；若未傳 state 則忽略此檢查
  const jammed = state ? isToolsJammed(state, pool) : false;
  if (inst.toolAttached && !jammed) {
    const tool = pool.get(inst.toolAttached.cardId);
    if (tool) {
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
        return cc?.abilities?.some(a => a.name === '生機森巴');
      });
      if (!hasSamba) continue;
      // 確認 inst 是這位玩家的寶可夢
      if (allP.some(c => c.iid === inst.iid)) { hp += 40; break; }
    }
  }
  // 修建老匠｜大師工藝 (SV11B Stage2 140HP) — 「這隻寶可夢的最大 HP，
  //   依這隻寶可夢身上附加的【鬥】能量每 1 個『+40』。」
  //   依 host 自身 fighting energy 數量加 HP。
  if (card.name === '修建老匠') {
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
  if (state && card.name === '怖納噬草') {
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
  if (card.name === '夠讚狗') {
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
 * v2.108 共用 helpers — 判定「基本 X 屬性能量」
 * Scraper 對基本能量的 `pokemonType` 欄位通常留空（屬性從卡名【X】推），
 * 所以判斷「基本草能量」時一定要從 name parse，不能信 pokemonType。
 * v2.103 canAffordAttack 的繁茂 check 就是因為只檢查 pokemonType 才整個失效。
 */
export function isBasicEnergyOfType(ec: Card | undefined, type: EnergyType): boolean {
  if (!ec || ec.supertype !== 'Energy' || ec.subtype !== 'Basic') return false;
  if (ec.pokemonType === type) return true;
  const m = ec.name.match(/【(.+?)】/);
  if (!m) return false;
  return ZH_ENERGY_TYPE[m[1]] === type;
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
  const owner = state.players[ownerIdx];
  const all = [...(owner.active ? [owner.active] : []), ...owner.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    return card?.abilities?.some(a => a.name === '繁茂');
  });
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
): number {
  const hasBloom = hasBloomAbilityOnField(state, ownerIdx, pool);
  let n = 0;
  for (const e of attached) {
    const ec = pool.get(e.cardId);
    if (hasBloom && isBasicEnergyOfType(ec, 'Grass')) {
      n += 2;
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
  // v2.127 酋雷姆｜反等離子 — 對手棄牌區若有「阿克羅瑪」相關卡，三重冰霜成本改為 1 顆【無】
  if (state && attackName) {
    const attackerCard = pool.get(pokemon.cardId);
    const attackerName = attackerCard?.name ?? '';
    const overridden = getKyuremElectroplasmaEffectiveCost(attackerName, attackName, state, pool, cost);
    if (overridden !== cost) cost = overridden;
    // v2.133 月月熊 赫月ex｜老練招式 — 「血月」所需【無】減少對手已獲得獎賞數
    const overridden2 = getUrsalunaBloodMoonEffectiveCost(attackerName, attackName, state, pool, cost);
    if (overridden2 !== cost) cost = overridden2;
    // v2.161 八爪武師｜觸手激怒 — 身上有傷害指示物則只需 1 個【鬥】
    const overridden3 = getOctopusTentacleEffectiveCost(pokemon, attackerName, attackName, cost);
    if (overridden3 !== cost) cost = overridden3;
  }
  // v2.149 璀璨結晶（Tool ACE SPEC）：附有此 Tool 的「太晶」寶可夢使用招式時，
  //   能量需求 -1 個（任意屬性）。優先扣 Colorless，否則扣最後 1 個。
  //   阻礙之塔時道具失效。
  {
    const pokeCardForTool = pool.get(pokemon.cardId);
    const isTera = pokeCardForTool?.tags?.includes('太晶');
    const toolsJammed = state ? isToolsJammed(state, pool) : false;
    if (isTera && !toolsJammed && pokemon.toolAttached) {
      const toolCard = pool.get(pokemon.toolAttached.cardId);
      if (toolCard?.name === '璀璨結晶' && cost.length > 0) {
        // 優先扣 Colorless（最沒選擇空間的成本元素）
        const colorlessIdx = cost.indexOf('Colorless');
        if (colorlessIdx >= 0) {
          cost = [...cost.slice(0, colorlessIdx), ...cost.slice(colorlessIdx + 1)];
        } else {
          cost = cost.slice(0, -1);  // 扣最後 1 個
        }
      }
    }
  }
  // v2.176 反擊增幅器（PokemonTool）：若自己剩餘獎賞 > 對手，附有此 Tool 的寶可夢
  //   招式所需能量 -1 個【無】。需有 Colorless 才生效（不轉換為其他屬性）。
  //   阻礙之塔時道具失效。
  if (state && pokemon.toolAttached && attackerIdx !== undefined) {
    const toolsJammed = isToolsJammed(state, pool);
    if (!toolsJammed) {
      const toolCard = pool.get(pokemon.toolAttached.cardId);
      if (toolCard?.name === '反擊增幅器') {
        const myPrizes = state.players[attackerIdx].prizes.length;
        const oppPrizes = state.players[(1 - attackerIdx) as 0 | 1].prizes.length;
        if (myPrizes > oppPrizes) {
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
    if (!toolsJammed && pokemon.toolAttached) {
      const toolCard = pool.get(pokemon.toolAttached.cardId);
      if (toolCard?.name === '赫普的講究頭帶') {
        const pokeCardForHeadband = pool.get(pokemon.cardId);
        if (pokeCardForHeadband?.name?.startsWith('赫普的')) {
          const colorlessIdx = cost.indexOf('Colorless');
          if (colorlessIdx >= 0) {
            cost = [...cost.slice(0, colorlessIdx), ...cost.slice(colorlessIdx + 1)];
          }
        }
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
        if (isBasicPokemonCard(attackerCard)) {
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

  const colorlessCost = cost.filter((t) => t === 'Colorless').length;
  const typedCost = cost.filter((t) => t !== 'Colorless');

  // 單位數量不夠直接失敗
  if (units.length < typedCost.length + colorlessCost) return false;

  // 回溯：依序把每個有色需求配給一個 types 包含該色的 unit；最後檢查剩餘 unit 數 ≥ colorless 需求
  const used = new Array(units.length).fill(false);
  const tryMatch = (i: number): boolean => {
    if (i >= typedCost.length) {
    // 最後檢查剩餘 unit 中有多少可以當【無】
    // 只有 types 含 'Colorless' 的 unit 才能滿足 Colorless cost
    // （基本【火】/【水】等 → types=['Fire']，不能當無；硬岩【鬥】→ types=['Fighting']，也不能）
    let remainingColorless = 0;
    for (let k = 0; k < units.length; k++) {
      if (!used[k] && units[k].types.includes('Colorless')) remainingColorless++;
    }
    return remainingColorless >= colorlessCost;
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
    rocketSupporterPlayedThisTurn: false,
    ancientSupporterPlayedThisTurn: false,
    retreatedThisTurn: false,
  };
}

/** 清除 CardInstance 上的回合旗標（於擁有者 END_TURN 執行） */
function clearTurnFlags(c: CardInstance): CardInstance {
  if (!c.justPlaced && !c.evolvedThisTurn && !c.movedToActiveThisTurn && !c.playedFromHand) return c;
  const n = { ...c };
  delete n.justPlaced;
  delete n.evolvedThisTurn;
  delete n.movedToActiveThisTurn;
  delete n.playedFromHand;
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

function hasFestivalDanceActive(state: GameState, idx: 0 | 1, pool: Map<string, Card>): boolean {
  const active = state.players[idx].active;
  const card = active ? pool.get(active.cardId) : null;
  return card?.abilities?.some(a => a.name === '祭典樂舞') ?? false;
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
    && (state.pendingPrizes ?? 0) === 0
    && state.players[idx].active !== null
    && state.players[oppIdx].active !== null
    && hasFestivalDanceActive(state, idx, pool)
    && hasFestivalVenue(state, pool);
}

/**
 * 祭典樂舞：「若場上有『祭典會場』，則這隻寶可夢可使用持有的招式 2 次。
 * （若對手的戰鬥寶可夢因第 1 次的招式而昏厥，則在下一隻寶可夢放置後，使用第 2 次的招式。）」
 *
 * 這裡只負責「第 1 次招式剛結算完」：先預約/消耗本回合的第 2 次招式權。
 * 若沒有待選擇、待取獎勵、待補戰鬥位，立即回到 main；否則由下方
 * maybeResumeFestivalDanceSecondAttack() 在 RESOLVE_SELECTION / TAKE_PRIZES /
 * SEND_NEW_ACTIVE 後續流程完成時回到 main。
 */
function startFestivalDanceSecondAttackWindow(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
): GameState {
  if (state.phase !== 'playing' || state.turnPhase !== 'end') return state;
  if (!hasFestivalDanceActive(state, idx, pool)) return state;
  if (!hasFestivalVenue(state, pool)) return state;
  if (state.festivalDanceUsedThisTurn?.[idx]) return state;

  const flag: [boolean, boolean] = [...(state.festivalDanceUsedThisTurn ?? [false, false])] as [boolean, boolean];
  flag[idx] = true;
  let next: GameState = { ...state, festivalDanceUsedThisTurn: flag };

  if (canResumeFestivalDanceSecondAttack(next, idx, pool)) {
    next = { ...next, turnPhase: 'main' };
    return addLog(next, `祭典樂舞：場上有「祭典會場」— 可再使用 1 次招式`, idx);
  }

  return addLog(next, `祭典樂舞：已保留第 2 次招式，待獎勵牌／新戰鬥寶可夢等處理完成後可使用`, idx);
}

function maybeResumeFestivalDanceSecondAttack(
  state: GameState,
  pool: Map<string, Card>,
): GameState {
  const idx = state.activePlayerIndex;
  if (!state.festivalDanceUsedThisTurn?.[idx]) return state;
  if (!canResumeFestivalDanceSecondAttack(state, idx, pool)) return state;
  const next = { ...state, turnPhase: 'main' as const };
  return addLog(next, `祭典樂舞：處理完成，可使用第 2 次招式`, idx);
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

  // Mulligan 補抽採「NET 抵銷」：只有次數多的一方的對手可以補抽差額。
  // 例：雙方各 1 次 → 互相抵銷，兩邊都 0；對方 2 次我方 1 次 → 我方補 1、對方 0。
  // pendingMulliganDraw[0] = P1 可補抽張數（= max(0, m2 - m1)）
  // pendingMulliganDraw[1] = P2 可補抽張數（= max(0, m1 - m2)）
  const extraForP1 = Math.max(0, m2 - m1);
  const extraForP2 = Math.max(0, m1 - m2);

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
    pendingMulliganDraw: [extraForP1, extraForP2],
    log: [],
    pendingPrizes: 0,
    oppPrizesAtMyLastTurnEnd: [6, 6],
    oppPrizesAtMyTurnStart: [6, 6],
    oppPrizesAtMainEnd: [6, 6], // v2.245 主回合結束 snapshot（不含 checkup）
    rocketInMyDiscardAtMainEnd: [0, 0], // v2.245 主回合結束 snapshot（火箭隊寶可夢數）
    // v2.246 完整 KO cause tracking
    oppAttackKOdMeThisTurn: [0, 0],
    oppAbilityKOdMeThisTurn: [0, 0],
    oppAttackKOdMyRocketThisTurn: [0, 0],
    oppAbilityKOdMyRocketThisTurn: [0, 0],
    oppAttackKOdMeInLastOppTurn: [0, 0],
    oppAbilityKOdMeInLastOppTurn: [0, 0],
    oppAttackKOdMyRocketInLastOppTurn: [0, 0],
    oppAbilityKOdMyRocketInLastOppTurn: [0, 0],
    stadiumPlayedThisTurn: [false, false],
  };

  let st = addLog(state, `遊戲開始！${spec1.name} vs ${spec2.name}`, null);
  st = addLog(st, `🪙 擲硬幣：${state.players[firstPlayerIdx].name} 先手`, null);
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
        turnPhase: 'draw',  // v2.183：改 'draw'，再由 applyAutoDraw 抽牌後設成 'main'
        activePlayerIndex: next.firstPlayerIdx,
        isFirstTurn: true,
      };
      next = addLog(next, `Setup 完成！${next.players[next.firstPlayerIdx].name} 先手行動中。`, null);
      // v2.183 修：PTCG 現行規則先攻方第 1 回合也要抽牌（只是不能攻擊）。
      //   舊版直接 turnPhase='main' 跳過抽牌 — 違反規則。
      next = applyAutoDraw(next);
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
      delete returning.playedFromHand;
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
    // v2.136 零之大空洞：場上有太晶寶可夢時上限可達 8
    if (player.bench.length >= getBenchLimit(state, pIdx, pool)) return state;
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
        turnPhase: 'draw',  // v2.183：改 'draw'，再由 applyAutoDraw 抽牌後設成 'main'
        activePlayerIndex: state.firstPlayerIdx,
        isFirstTurn: true,
      };
      newState = addLog(newState, `Setup 完成！${state.players[state.firstPlayerIdx].name} 先手行動中。`, null);
      // v2.183 修：先攻第 1 回合也要抽牌（PTCG 現行規則）。
      newState = applyAutoDraw(newState);
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
      const koDiscard: CardInstance[] = [
        ko, ...ko.energyAttached,
        ...(ko.toolAttached ? [ko.toolAttached] : []),
        ...(ko.evolvedFromStack ?? []),
      ];
      player.discard = [...player.discard, ...koDiscard];
      player.active = null;
      if (card) prizesAcc += prizesForKO(card);
      s = addLog(s, `⚠️ 系統擊倒檢查：${card?.name ?? '?'} 被擊倒（戰鬥場，傷害 ${ko.damage} ≥ HP ${hp}）+${card ? prizesForKO(card) : 1} 張獎勵牌`, null);
      // v2.246：sanity sweep 大多是招式效果產生的 zombie KO，記錄為 attack cause
      s = recordOppKO(s, dIdx, card, 'attack');
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
      const koDiscard: CardInstance[] = [
        b, ...b.energyAttached,
        ...(b.toolAttached ? [b.toolAttached] : []),
        ...(b.evolvedFromStack ?? []),
      ];
      player.discard = [...player.discard, ...koDiscard];
      if (card) prizesAcc += prizesForKO(card);
      s = addLog(s, `⚠️ 系統擊倒檢查：${card?.name ?? '?'} 被擊倒（備戰位，傷害 ${b.damage} ≥ HP ${hp}）+${card ? prizesForKO(card) : 1} 張獎勵牌`, null);
      // v2.246：sanity sweep 大多是招式效果產生的 zombie KO，記錄為 attack cause
      s = recordOppKO(s, dIdx, card, 'attack');
    } else {
      newBench.push(b);
    }
  }
  player.bench = newBench;
  if (!anyKO) return state;
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = player;
  s = { ...s, players, pendingPrizes: (s.pendingPrizes ?? 0) + prizesAcc };
  // 對手 active+bench 都空 → 直接終局
  if (player.active === null && player.bench.length === 0) {
    s = {
      ...s, phase: 'game-over',
      winner: attackerIdx,
      winReason: `${player.name} 沒有可上場的寶可夢`,
    };
  }
  return s;
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
    // v2.132：resolver 也可能 leave zombie（damage ≥ HP 卻沒移到棄牌）— sanity sweep 對手側
    newState = sanityKOSweep(newState, actorIdx, pool);
    newState = maybeResumeFestivalDanceSecondAttack(newState, pool);
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

    const placed = { ...inst, justPlaced: true, playedFromHand: true };
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);
    attacker.bench = [...attacker.bench, placed];
    players[aIdx] = attacker;
    let afterPlace = addLog(
      { ...state, players },
      `${attacker.name} 將 ${card.name} 放到備戰區`,
      aIdx
    );
    // 觸發「放到備戰區」特性（例：喵喵ex｜殺手鐧捕捉）
    // 火箭隊的監視塔：【無】屬寶可夢的特性全部消除，跳過此觸發
    const placeFn = BENCH_PLACE_TRIGGERS.get(card.name);
    if (placeFn && !isColorlessAbilityBlocked(afterPlace, card, pool)) {
      afterPlace = placeFn(afterPlace, aIdx, pool);
    }
    // v2.119 險惡廢墟：改走統一 helper（同時被 pokemon_search / six_decks 等 resolver 呼叫）
    afterPlace = applyBenchPlaceSideEffects(afterPlace, aIdx, [placed.iid], pool);
    // v2.320：自動提示「從手牌放置於備戰區時」的特性（如殺手鐧捕捉、狂挖等）
    afterPlace = promptPlayAbilities(afterPlace, aIdx, card, placed, pool, false);
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

    const placed: CardInstance = { ...inst, justPlaced: true, fossilOnField: true, playedFromHand: true };
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);
    attacker.bench = [...attacker.bench, placed];
    players[aIdx] = attacker;
    let afterPlace = addLog(
      { ...state, players },
      `${attacker.name} 將 ${card!.name} 作為【基礎】寶可夢放到備戰區（HP60／【無】）`,
      aIdx
    );
    // 化石上場 = 寶可夢上場 → 跑同 PLAY_BASIC 的 bench-place 觸發路徑
    afterPlace = applyBenchPlaceSideEffects(afterPlace, aIdx, [placed.iid], pool);
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
        { ...attacker.active, fossilOnField: undefined, status: undefined, secondaryStatus: undefined,
          energyAttached: [], toolAttached: undefined },
        ...attacker.active.energyAttached,
        ...(attacker.active.toolAttached ? [attacker.active.toolAttached] : []),
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
      { ...benchInst, fossilOnField: undefined, status: undefined, secondaryStatus: undefined,
        energyAttached: [], toolAttached: undefined },
      ...benchInst.energyAttached,
      ...(benchInst.toolAttached ? [benchInst.toolAttached] : []),
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
    if (state.isFirstTurn && !hasPushEvolveAbility) return state; // 第一回合不能進化
    // v2.102 活力森林（Stadium）— 雙方的所有【草】寶可夢就算在剛使出的回合也可進化成【草】寶可夢。
    //   自己最初回合例外（line 775 `state.isFirstTurn` gate 照舊擋）。
    // v2.110：bypass 不只 justPlaced，也 bypass evolvedThisTurn — 允許同回合連鎖進化
    //   整條草進化鏈（例：菊草葉→月桂葉→大竺葵 一回合打完）。只要草→草、活力森林在場。
    const stadiumName = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
    const vigorousForestException = stadiumName === '活力森林' &&
      baseCard.pokemonType === 'Grass' && evoCard.pokemonType === 'Grass';
    if ((basePoke.justPlaced || basePoke.evolvedThisTurn) && !vigorousForestException && !hasPushEvolveAbility) return state;
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
    const baseBare: CardInstance = {
      ...basePoke,
      // evolvedFromStack 裡保存的是「下層卡片實體」，不能與場上的頂層寶可夢共用 iid。
      // 否則 KO/退化/回收後，手牌或牌庫會出現不同卡名但相同 iid，EVOLVE/USE_ABILITY 會錯抓。
      iid: `${basePoke.iid}_base_${basePoke.cardId}_${Math.random().toString(36).slice(2, 8)}`,
      energyAttached: [],
      toolAttached: undefined,
      evolvedFromStack: undefined, // 避免遞迴巢狀
    };
    const evolved: CardInstance = {
      ...evoInst,
      // 保留場上寶可夢的 iid 作為「這隻寶可夢」的穩定身份。
      // 若使用手牌進化卡的 iid，退化/回牌庫後再進化可能讓場上兩隻寶可夢共享 iid，
      // 造成 USE_ABILITY / 選擇目標等 action 錯抓到另一隻寶可夢。
      iid: basePoke.iid,
      damage: basePoke.damage,
      energyAttached: basePoke.energyAttached,
      toolAttached: basePoke.toolAttached,
      // v2.260 Bug #2：不再寫 `status: basePoke.status` — 進化後特殊狀態必須消除（PDF §I-A-05）
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
    let afterEvolve = addLog(
      { ...state, players },
      `${attacker.name} 的 ${baseCard.name} 進化為 ${evoCard.name}！`,
      aIdx
    );
    // v2.320：自動提示「從手牌進化時」的特性（如龐克練肌、精神抽出等）
    afterEvolve = promptPlayAbilities(afterEvolve, aIdx, evoCard, evolved, pool, true);
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
        && (attacker.active.status === 'poisoned' || attacker.active.secondaryStatus === 'poisoned')) {
      return state;
    }
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
    // v2.175 特殊能量 撤退修正（磁鐵【鋼】等）— iterate energyAttached
    if (activeCard) {
      for (const e of attacker.active.energyAttached) {
        const ec = pool.get(e.cardId);
        if (!ec) continue;
        const fn = SPECIAL_ENERGY_RETREAT_MOD.get(ec.name);
        if (!fn) continue;
        const r = fn(activeCard, attacker.active);
        if (r.zero) { retreatCost = 0; break; }
        if (r.reduceBy) retreatCost = Math.max(0, retreatCost - r.reduceBy);
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
    // v2.117 N的城堡（Stadium）：雙方場上所有「N的」寶可夢撤退成本 = 0。
    const stadiumNameForRetreat = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : undefined;
    if (stadiumNameForRetreat === 'N的城堡' && activeCard?.name?.startsWith('N的')) {
      retreatCost = 0;
    }
    // v2.177 樂園度假地（Stadium）：雙方所有「可達鴨」撤退成本 -1。
    if (stadiumNameForRetreat === '樂園度假地' && activeCard?.name === '可達鴨') {
      retreatCost = Math.max(0, retreatCost - 1);
    }
    // v2.277 Wave 3：套用 ABILITY_RETREAT_MOD（一身輕 / 溶化流動 / 鋼之橋 / 森林秘道 / 大網）
    retreatCost = applyAbilityRetreatMod(state, attacker.active, activeCard, aIdx, retreatCost, pool);
    // v2.69：撤退成本用「能量單位」比對，不是卡片張數。火箭隊能量 1 張 = 2 units。
    // v2.108：傳 state+aIdx 讓大竺葵繁茂套上（基本【草】能量 = 2 units）。
    if (totalEnergyUnits(attacker.active.energyAttached, pool, state, aIdx) < retreatCost) return state;

    // v2.63：若撤退需丟 ≥1 個能量，且附加能量包含多種屬性（或不同單位結構的特殊能量），
    // 開 pendingSelection 讓玩家選要丟哪幾個能量；否則沿用自動丟棄。
    // 判定「多屬性」：以每張能量的 type signature（sort 後 join）做 set，size ≥ 2 才問。
    // v2.69：即使單一屬性，只要有多單位能量（火箭隊能量）混合單單位能量，仍需問玩家。
    if (retreatCost > 0 && attacker.active.energyAttached.length > 0) {
      const typeSig = (iid: string): string => {
        const inst = attacker.active!.energyAttached.find(e => e.iid === iid);
        if (!inst) return '';
        const units = getEnergyUnits(inst.cardId, pool);
        if (units.length === 0) return pool.get(inst.cardId)?.name ?? 'unknown';
        // 多單位（如火箭隊能量）與單純基本能量視為不同 signature
        return units.map(u => [...u.types].sort().join(',')).sort().join('|');
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
            minCount: 1,
            maxCount: attacker.active.energyAttached.length,
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
    // v2.322：蓋諾賽克特｜ACE消弭 — 對手有附道具的蓋諾賽克特時，不能打 ACE SPEC
    if (trainerCard.tags?.includes('ACE SPEC') && isAceCancelActive(state, aIdx, pool)) return state;

    // 義務性前置檢查：夜間擔架棄牌為空、寶可夢交替備戰為空等情況禁止打出
    if (!canPlayTrainer(trainerCard.name, state, aIdx, pool)) return state;

    // 移出手牌
    attacker.hand = attacker.hand.filter((_, i) => i !== hIdx);

    if (trainerCard.subtype === 'Stadium') {
      // 一回合只能打出一張競技場卡（不論目前場上有無 stadium）
      const played = state.stadiumPlayedThisTurn ?? [false, false];
      if (played[aIdx]) return state;
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
      let newState: GameState = {
        ...state, players,
        activeStadium: trainerInst,
        activeStadiumOwnerIdx: aIdx, // v2.244 標記擁有者
        stadiumPlayedThisTurn: newPlayed,
      };
      newState = addLog(newState, `${attacker.name} 打出競技場：${trainerCard.name}！`, aIdx);
      newState = clearFestivalVenueProtectedStatuses(newState, pool);
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
    if (stadiumCard.name === '深缽鎮') {
      if (newState.players[aIdx].bench.length >= 5) {
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
      if (state.isFirstTurn && aIdx === state.firstPlayerIdx) {
        const revert: [boolean, boolean] = [used[0], used[1]];
        return addLog({ ...state, stadiumUsedThisTurn: revert }, '壯偉碩木：先攻第 1 回合無法進化', aIdx);
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
    if (stadiumCard.name === '密阿雷市') {
      if (newState.players[aIdx].bench.length >= 5) {
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
    if ((ability.name === '精神抽出' || ability.name === '龐克練肌' || ability.name === '搜尋寶石' || ability.name === '能量舞步' || ability.name === '脫殼') && !targetPoke.evolvedThisTurn) {
      return state;
    }

    // 腎上腺腦力（願增猿）：身上必須附有至少 1 顆【惡】能量才能使用。
    if (ability.name === '腎上腺腦力' && (countEnergy(targetPoke, pool).get('Darkness') ?? 0) < 1) {
      return state;
    }

    // 火箭隊的監視塔：場上此 Stadium 時，【無】屬寶可夢的特性全部消除
    if (isColorlessAbilityBlocked(state, pokeCard, pool)) return state;

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
    const abilityFn = ABILITY_EFFECTS.get(`${pokeCard!.name}|${action.abilityIndex}`);
    if (!abilityFn) return state;

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
    let afterAttach: GameState = addLog(
      { ...state, players },
      `${attacker.name} 將能量附加到 ${targetCard.name}`,
      aIdx
    );
    // v2.22：特殊能量「附加時」hook（例：富裕能量抽 4、感應【超】能量搜【超】基本）
    const energyName = getCard(energyCard.cardId, pool).name;
    const attachHook = SPECIAL_ENERGY_ATTACH.get(energyName);
    if (attachHook) {
      afterAttach = attachHook(afterAttach, aIdx, target.iid, pool);
    }
    return clearFestivalVenueProtectedStatuses(afterAttach, pool);
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
    // 特殊狀態：混亂 — 擲硬幣，反面自身受 30 傷害且攻擊失敗
    // v2.182：補上「自傷致 KO」流程 — 30 自傷可能讓寶可夢昏厥（HP ≤ 30 + 已有傷害指示物）
    if (attacker.active.status === 'confused') {
      const flipResult = flipCoinsWithLog(state, 1, '混亂', aIdx);
      state = flipResult.state;
      const coin = flipResult.heads === 1;
      if (!coin) {
        const selfDmg = (attacker.active.damage ?? 0) + 30;
        const atkHP = getEffectiveHP(attacker.active, pool, state);
        const atkCard = pool.get(attacker.active.cardId);
        if (atkHP > 0 && selfDmg >= atkHP) {
          // 混亂自傷致 KO → 對手取獎賞
          const koDiscard: CardInstance[] = [
            { ...attacker.active, damage: selfDmg },
            ...attacker.active.energyAttached,
            ...(attacker.active.toolAttached ? [attacker.active.toolAttached] : []),
            ...(attacker.active.evolvedFromStack ?? []),
          ];
          const newAttacker: PlayerState = {
            ...attacker,
            discard: [...attacker.discard, ...koDiscard],
            active: null,
          };
          players[aIdx] = newAttacker;
          const koPrizes = atkCard ? prizesForKO(atkCard) : 1;
          const winner = { ...players[dIdx] };
          const take = Math.min(koPrizes, winner.prizes.length);
          if (take > 0) {
            winner.hand = [...winner.hand, ...winner.prizes.slice(0, take)];
            winner.prizes = winner.prizes.slice(take);
          }
          players[dIdx] = winner;
          const s = addLog({ ...state, players, turnPhase: 'end' as const },
            `${atkNameForStatus} 陷入混亂，自身受到 30 傷害並昏厥！${players[dIdx].name} 取得 ${take} 張獎勵牌。`, aIdx);
          if (winner.prizes.length === 0) {
            return { ...s, phase: 'game-over', winner: dIdx, winReason: `${winner.name} 取得所有獎勵牌` };
          }
          if (newAttacker.bench.length === 0) {
            return { ...s, phase: 'game-over', winner: dIdx, winReason: `${newAttacker.name} 沒有可上場的寶可夢` };
          }
          return s;  // active=null → UI 自動 popup SEND_NEW_ACTIVE
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

      // v2.219 — 後攻方最初回合限定招式（吼叫尾ex｜絕叫 等）
      // 卡面：「這個招式只可在後攻玩家的最初回合使用。」
      // 條件：state.isFirstTurn && aIdx 是後攻方（!= firstPlayerIdx）
      const SECOND_PLAYER_FIRST_TURN_ONLY = new Set<string>(['絕叫']);
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
    if (!canAffordAttack(attacker.active, attack.cost, pool, state, aIdx, attack.name)) return state;

    // ── 招式前置效果（修改傷害 / 丟棄能量等）────────────────────────────────
    // v2.214：tool 招式用 tool 名做 key（例：'招式學習器 螢石|螢石'）
    const effectKey = `${sourceName}|${attack.name}`;
    const preFn = ATTACK_PRE.get(effectKey);
    let workingState: GameState = { ...state, players };
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
    if (!toolsJammed && baseDamage > 0 && attacker.active.toolAttached) {
      const atkTool = pool.get(attacker.active.toolAttached.cardId);
      if (atkTool) {
        const fn = TOOL_ATTACK_BONUS.get(atkTool.name);
        if (fn) {
          const bonus = fn(attackerCard, attacker.active, defenderCard, defender.active);
          if (bonus > 0) {
            baseDamage += bonus;
            workingState = addLog(workingState,
              `🔧 ${atkTool.name}：${attackerCard.name} 招式傷害 +${bonus}（${baseDamage - bonus} → ${baseDamage}）`,
              aIdx);
          }
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
      const processedAbNames = new Set<string>();
      for (const inst of attAll) {
        const c = pool.get(inst.cardId);
        if (!c?.abilities) continue;
        for (const ab of c.abilities) {
          if (processedAbNames.has(ab.name)) continue; // P2-3: 不重複
          // P2-4: 監視塔壓制【無】寶可夢的被動特性
          if (isColorlessAbilityBlocked(state, c, pool)) continue;
          const fn = PASSIVE_ATTACK_BONUS.get(ab.name);
          if (!fn) continue;
          // v2.133：簽名擴充 — 把 defenderCard 也傳進去（複眼 等需要看對手卡）
          // v2.278：再擴 state / aIdx / pool — 讓「大將（依對手獎賞數）」「激動力量
          //         （場上有 Darkness Mega ex）」這類依場上局勢的特性能拿到資訊
          const bonus = fn(attackerCard, defenderCard, workingState, aIdx, pool);
          if (bonus > 0) {
            processedAbNames.add(ab.name);
            baseDamage += bonus;
            workingState = addLog(workingState, `「${ab.name}」啟動：${attackerCard.name} 招式傷害 +${bonus}`, aIdx);
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
    }

    // v2.113 夠讚狗｜腎上腺力量 — 若攻擊方自身（夠讚狗）附有【惡】能量，招式傷害 +100
    // v2.120：改用 countEnergy（host-aware），稜鏡能量在 Basic host 上也算惡能量
    if (baseDamage > 0 && attackerCard.name === '夠讚狗') {
      const hasDark = (countEnergy(attacker.active, pool).get('Darkness') ?? 0) >= 1;
      if (hasDark) {
        baseDamage += 100;
        workingState = addLog(workingState, `「腎上腺力量」啟動：夠讚狗 招式傷害 +100`, aIdx);
      }
    }

    // v2.113 空手道王的演練 — 本回合自己寶可夢招式對對手戰鬥場 ex +40
    if (baseDamage > 0 && attacker.karateKingBonusThisTurn && defenderCard?.subtype === 'ex') {
      baseDamage += 40;
      workingState = addLog(workingState, `「空手道王的演練」啟動：對 ${defenderCard.name}（ex）+40`, aIdx);
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
      }
    }

    // 弱點（×2）— 只對有實際傷害的招式套用。skipWeakRes 旗標跳過此計算。
    // v2.57：莉莉艾的皮皮ex｜妖精領域 — 我方場上有皮皮ex 時，對手【龍】寶可夢的弱點改為【超】。
    // 卡面允許「本無弱點」的龍寶可夢被加上【超】弱點。
    // v2.101：鋁鋼橋龍ex｜金屬防禦強化 — 本回合弱點失效（weaknessDisabledThisTurn）
    let effectiveWeaknessType: string | undefined = defenderCard.weakness?.type;
    if (defenderCard.pokemonType === 'Dragon' && hasFairyZoneField(workingState, aIdx, pool)) {
      effectiveWeaknessType = 'Psychic';
    }
    const weaknessDisabled = !!defender.active.weaknessDisabledThisTurn;
    if (!skipWeakRes && !weaknessDisabled && baseDamage > 0 && effectiveWeaknessType && attackerCard.pokemonType === effectiveWeaknessType) {
      baseDamage *= 2;
    }
    // v2.260 Bug #1：抵抗力計算（PDF §I-A-01 步驟 4）
    //   若受擊方寶可夢卡面抵抗力屬性 === 攻擊方寶可夢屬性 → 套用 resistance.value（"-30" 等）。
    //   skipWeakRes 旗標同時跳過抵抗力計算（PDF §II-B-06「不計算弱點・抵抗力」）。
    //   弱點導致 baseDamage 翻倍後再扣抵抗力；若扣到 ≤0 則結束傷害計算（依 PDF）。
    //   未來若需「消除抵抗力」hook（如太陽岩 抵抗遮蔽），在此處加 effectiveResistance flag。
    const resistanceValue = defenderCard.resistance?.value;  // 形如 "-30"
    const resistanceType = defenderCard.resistance?.type;
    if (!skipWeakRes && baseDamage > 0 && resistanceType && resistanceValue && attackerCard.pokemonType === resistanceType) {
      const resistDelta = parseInt(resistanceValue, 10);  // "-30" → -30
      if (!isNaN(resistDelta)) {
        baseDamage = Math.max(0, baseDamage + resistDelta);
      }
    }
    // v2.101：鋁鋼橋龍｜塗層攻擊 — 本回合此卡不受【基礎】寶可夢招式傷害
    // 攻擊方 stage=Basic 且 defender 有 immuneToBasicAttackThisTurn → 傷害歸零（招式仍觸發其他 post 效果）
    if (baseDamage > 0
        && defender.active.immuneToBasicAttackThisTurn
        && (attackerCard.stage ?? attackerCard.subtype) === 'Basic') {
      workingState = addLog(workingState,
        `${defenderCard.name} 因塗層攻擊效果，不受【基礎】寶可夢招式傷害`, dIdx);
      baseDamage = 0;
    }

    // v2.174 阿塞蘿拉的惡作劇 — defender 在本回合「不受 ex 招式的傷害與效果」
    // 卡面同時涵蓋 PDF §C-16「不會受到招式的傷害」+ §C-17「不會受到招式的效果的影響」兩者。
    // 故下方同時把 baseDamage 清 0（C-16）並設 skipDefEffects（C-17）— 是故意的耦合，不是 bug。
    // 若未來新加只擋傷害不擋效果（純 C-16）或反之的卡，請拆成兩個獨立旗標。
    const attackerIsEx = attackerCard.subtype === 'ex'
      || attackerCard.name.endsWith('ex') || attackerCard.name.endsWith('EX');
    if (baseDamage > 0
        && defender.active.immuneToExAttackThisTurn
        && attackerIsEx) {
      workingState = addLog(workingState,
        `${defenderCard.name} 因阿塞蘿拉的惡作劇效果，不受【ex】招式的傷害與效果`, dIdx);
      baseDamage = 0;        // C-16 部分（傷害變 0）
      skipDefEffects = true; // C-17 部分（跳過步驟 5 受擊方效果）
    }

    // v2.174 鐵之防禦強化 — 自己【鋼】寶可夢本回合受招式 -30
    // defender 是【鋼】 + 防守方有 metalShieldThisTurn → 傷害 -30
    if (baseDamage > 0
        && defender.metalShieldThisTurn
        && defenderCard.pokemonType === 'Metal') {
      const reduced = Math.max(0, baseDamage - 30);
      workingState = addLog(workingState,
        `${defenderCard.name} 因鐵之防禦強化效果，受到的傷害 -30（${baseDamage} → ${reduced}）`, dIdx);
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
    }

    // 被動特性：受傷減 N（Passive damage reduction）— skipDefEffects 跳過
    // v2.266：火箭隊的監視塔對 Colorless 防守方的 PASSIVE_DAMAGE_REDUCE 也要擋
    //   （e.g. 毛毛角羊｜柔軟羊毛 Colorless -30）。
    if (!skipDefEffects && baseDamage > 0 && defenderCard.abilities
        && !isColorlessAbilityBlocked(state, defenderCard, pool)) {
      for (const ab of defenderCard.abilities) {
        const reduce = PASSIVE_DAMAGE_REDUCE.get(ab.name);
        if (reduce) baseDamage = Math.max(0, baseDamage - reduce);
      }
    }

    // v2.154 爆炸頭水牛｜捲牆 — 場上有 2 隻以上爆炸頭水牛 + 防守方戰鬥位是【無】基礎 → -60
    //   這是 field-wide buff，不只 defender 自己的 abilities，要掃 defender 整個場上
    //   無論多少隻擁有此特性的寶可夢，效果不重複（最多 -60 一次）
    // v2.266：火箭隊的監視塔（Colorless 特性消除）會擋掉每隻爆炸頭水牛的捲牆 →
    //   filter 內加 isColorlessAbilityBlocked 閘門（爆炸頭水牛本身是 Colorless）。
    //   stadiums.ts line 179-180 的註解就預告過這類「被動特性 × 監視塔」要個別補閘門。
    if (!skipDefEffects && baseDamage > 0) {
      const defAll: CardInstance[] = [
        ...(defender.active ? [defender.active] : []),
        ...defender.bench,
      ];
      const buffaloCount = defAll.filter(c => {
        const card = pool.get(c.cardId);
        if (card?.name !== '爆炸頭水牛') return false;
        if (!card.abilities?.some(a => a.name === '捲牆')) return false;
        // 監視塔擋掉【無】寶可夢的特性（捲牆持有者爆炸頭水牛本身是 Colorless）
        if (isColorlessAbilityBlocked(state, card, pool)) return false;
        return true;
      }).length;
      if (buffaloCount >= 2) {
        // 防守方戰鬥位必須是【無】基礎
        const isColorless = defenderCard.pokemonType === 'Colorless';
        const isBasic = !defenderCard.evolvesFrom && defenderCard.stage !== 'Stage1' && defenderCard.stage !== 'Stage2';
        if (isColorless && isBasic) {
          baseDamage = Math.max(0, baseDamage - 60);
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
      if (hasGarbageMountain && attacker.active?.toolAttached) {
        const toolCard = pool.get(attacker.active.toolAttached.cardId);
        if (toolCard?.subtype === 'PokemonTool') {
          baseDamage = Math.max(0, baseDamage - 20);
          workingState = addLog(workingState,
            `垃圾洩氣：${attackerCard.name} 附有寶可夢道具 → 招式傷害 -20`, dIdx);
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
      }
    }

    // 道具：特定屬性防禦（福祿果 / 巧可果 / 千香果 / 刺耳果 / 霹霹果 / 莓榴果 / 渾厚鱗片）
    // 只要觸發就 -N，部分卡會丟棄；不受是否已被其他機制削到 0 影響（規則上 tool 仍消耗）
    // skipDefEffects 跳過，但不觸發道具也不丟棄。阻礙之塔時整個道具效果失效。
    // v2.176：新增 holderTypes filter（渾厚鱗片需 holder 為【龍】）
    //          + TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY（神聖護符）
    let defenseReduceToolToDiscard: CardInstance | null = null;
    if (!toolsJammed && !skipDefEffects && defender.active.toolAttached) {
      const defTool = pool.get(defender.active.toolAttached.cardId);
      const defenderCardForTool = pool.get(defender.active.cardId);
      if (defTool) {
        // 1. 屬性過濾型（福祿果系 + 渾厚鱗片）
        const defense = TOOL_DEFENSE_REDUCE_BY_TYPE.get(defTool.name);
        if (defense && attackerCard.pokemonType && defense.types.includes(attackerCard.pokemonType) && baseDamage > 0) {
          // v2.176 holderTypes filter：若指定，holder 必須是其中一型
          const holderOk = !defense.holderTypes
            || (defenderCardForTool?.pokemonType
                && defense.holderTypes.includes(defenderCardForTool.pokemonType));
          if (holderOk) {
            baseDamage = Math.max(0, baseDamage - defense.amount);
            if (defense.discardOnTrigger) defenseReduceToolToDiscard = defender.active.toolAttached;
          }
        }
        // 2. v2.176 攻擊方有特性型（神聖護符）— 不丟棄
        const abilFn = TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY.get(defTool.name);
        if (abilFn && baseDamage > 0) {
          const reduce = abilFn(attackerCard);
          if (reduce > 0) {
            baseDamage = Math.max(0, baseDamage - reduce);
          }
        }
      }
    }

    // 被動特性：條件式完全免疫 — skipDefEffects 跳過
    // v2.250：ImmunityCheck 可回傳 boolean（既有 entry）或 { immune, newState }
    //   （順滑大衣 等需要寫 log 的特性）。後者會 chain 到 workingState。
    // v2.266：火箭隊的監視塔對 Colorless 防守方的 PASSIVE_IMMUNITY 也要擋
    //   （e.g. 奇諾栗鼠ex｜順滑大衣 Colorless 擲幣免疫）。
    if (!skipDefEffects && baseDamage > 0 && defenderCard.abilities
        && !isColorlessAbilityBlocked(state, defenderCard, pool)) {
      for (const ab of defenderCard.abilities) {
        const immune = PASSIVE_IMMUNITY.get(ab.name);
        if (!immune) continue;
        const result = immune(attackerCard, baseDamage, workingState, aIdx, pool, defenderCard.name);
        if (typeof result === 'boolean') {
          if (result) { baseDamage = 0; break; }
        } else {
          // { immune, newState } — 統合 newState（含 log）
          workingState = result.newState;
          if (result.immune) { baseDamage = 0; break; }
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

    // v2.160：把實際造成傷害寫入 state.lastDealtDamage，供 POST 讀取
    //   （朽木妖｜終極吸取 heal=實際傷害量 等招式依賴此值）
    let newState: GameState = addLog(
      { ...workingState, lastDealtDamage: baseDamage },
      `${attacker.name} 的 ${attackerCard.name} 使出「${attack.name}」` +
        (isToolAttack ? `（工具：${sourceName}）` : '') +
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
    // v2.133 被動防 KO（皮卡丘ex 勤奮之心 等）— 條件由 PASSIVE_PREVENT_KO map 內 fn 決定
    if (!preventedKO && wouldBeKO && defenderState.active && defenderCard.abilities) {
      for (const ab of defenderCard.abilities) {
        const fn = PASSIVE_PREVENT_KO.get(ab.name);
        if (!fn) continue;
        const result = fn(defenderState.active, defenderCard, baseDamage);
        if (result.prevent) {
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
      // 條件：aIdx 玩家本回合有 teraKoBonusPrizeThisTurn 旗標，且攻擊方 active 為太晶寶可夢。
      // v2.48：scraper 把太晶從 attacks[] 抽出，改查 card.tags 欄位。
      let whiteLilyBonus = 0;
      if (newState.players[aIdx].teraKoBonusPrizeThisTurn) {
        const atkActive = newState.players[aIdx].active;
        const atkCard = atkActive ? pool.get(atkActive.cardId) : null;
        const isTera = !!atkCard?.tags?.includes('太晶');
        if (isTera) whiteLilyBonus = 1;
      }
      // v2.185：巴貝娜與荷蓮娜 — 本回合，攻擊方「N 的」寶可夢招式 KO 對手戰鬥位 → +3 獎勵牌。
      let bagonElenaBonus = 0;
      if (newState.players[aIdx].bagonElenaThisTurn) {
        const atkActive = newState.players[aIdx].active;
        const atkCard = atkActive ? pool.get(atkActive.cardId) : null;
        if (atkCard?.name?.startsWith('N的')) bagonElenaBonus = 3;
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
      // 獎賞牌下限 0（影藏等特性可將獎賞減到 0 張；實務上對手 KO 一隻 1 獎賞的惡寶可夢時效果才會觸發歸零）
      const prizes = Math.max(0, prizesForKO(defenderCard) + prizeAdjust + prizeTool + deferredBonus + whiteLilyBonus + bagonElenaBonus + ancientEnergyAdjust);
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
        pendingPrizes: prizes, turnPhase: 'end',
        ancientEnergyMinusOneUsed: newAncientFlags,
      };
      // v2.246 KO cause tracking — 招式 KO 對手戰鬥位
      newState = recordOppKO(newState, dIdx, defenderCard, 'attack');
      if (deferredBonus > 0) {
        newState = addLog(newState, `${defenderCard.name} 因「多餘花粉」遺留效果，+${deferredBonus} 張獎勵牌`, null);
      }
      if (whiteLilyBonus > 0) {
        newState = addLog(newState, `「白蕾雅」效果發動：太晶寶可夢的招式 KO 對手戰鬥位 +${whiteLilyBonus} 張獎勵牌`, aIdx);
      }
      if (bagonElenaBonus > 0) {
        newState = addLog(newState, `「巴貝娜與荷蓮娜」效果發動：「N 的」寶可夢招式 KO 對手戰鬥位 +${bagonElenaBonus} 張獎勵牌`, aIdx);
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
      {
        const retaliatedAtk = newState.players[aIdx].active;
        if (retaliatedAtk) {
          const retAtkCard = pool.get(retaliatedAtk.cardId);
          const retAtkHP = retAtkCard?.hp ?? 0;
          if (retAtkHP > 0 && retaliatedAtk.damage >= retAtkHP) {
            const retKoDiscard: CardInstance[] = [
              retaliatedAtk,
              ...retaliatedAtk.energyAttached,
              ...(retaliatedAtk.toolAttached ? [retaliatedAtk.toolAttached] : []),
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
              { ...newState, players: retPlayers, pendingPrizes: (newState.pendingPrizes ?? 0) + retKOPrizes },
              `${retAtkCard!.name} 被反彈傷害擊倒！${newState.players[dIdx].name} 取得 ${retKOPrizes} 張獎勵牌。`,
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
        const atkHP = atkCardForKO?.hp ?? 0;
        atkP.active = { ...atkP.active, damage: atkNewDmg };
        refPlayers[aIdx] = atkP;
        newState = addLog(
          { ...newState, players: refPlayers },
          `🔧 龐克頭盔：${attackerCard.name} 受到 ${punkReflectDamage} 傷害反擊！`,
          null,
        );
        // v2.300 Bug fix：反彈傷害打死攻擊方時，需立即 KO 處理（sanityKOSweep 只掃 dIdx，不掃 aIdx）
        if (atkHP > 0 && atkNewDmg >= atkHP) {
          const deadAtk = atkP.active;
          const koDiscard: CardInstance[] = [
            deadAtk,
            ...deadAtk.energyAttached,
            ...(deadAtk.toolAttached ? [deadAtk.toolAttached] : []),
            ...(deadAtk.evolvedFromStack ?? []),
          ];
          const punkKOPrizes = prizesForKO(atkCardForKO!);
          const punkRefPlayers2 = [...newState.players] as [PlayerState, PlayerState];
          punkRefPlayers2[aIdx] = {
            ...punkRefPlayers2[aIdx],
            active: null,
            discard: [...punkRefPlayers2[aIdx].discard, ...koDiscard],
          };
          // 防守方（dIdx）得到獎賞牌（放進 pendingPrizes 讓 UI 取牌）
          newState = addLog(
            { ...newState, players: punkRefPlayers2, pendingPrizes: (newState.pendingPrizes ?? 0) + punkKOPrizes },
            `${attackerCard.name} 被龐克頭盔的反彈傷害擊倒！${newState.players[dIdx].name} 取得 ${punkKOPrizes} 張獎勵牌。`,
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
        `陳舊的背蓋化石：免疫招式的附加效果（傷害仍正常結算）`, dIdx);
    }
    const postFn = !shellFossilImmune ? ATTACK_POST.get(effectKey) : undefined;
    if (postFn) {
      // v2.156：把 action 也傳給 POST，讓「PRE/POST 共享 chosenIids」的 option 招式
      // （如 激流水泵）能在 POST 階段判斷玩家是否棄了能量
      newState = postFn(newState, aIdx, pool, action);
    }

    // ── v2.92：回力鏢能量 revive ─────────────────────────────────────────────
    // 若 regPre/regPost 過程中把回力鏢能量搬到 attacker 的棄牌區，且 attacker.active
    // 仍是同一隻（iid 未變），在「招式的傷害與效果的影響之後」把它們撤回原寶可夢。
    if (boomerangSnapshotIids.length > 0) {
      const curAtk = newState.players[aIdx].active;
      const curDiscard = newState.players[aIdx].discard;
      if (curAtk && curAtk.iid === boomerangAttackerActiveIid) {
        const returnSet = new Set(boomerangSnapshotIids);
        // 目前棄牌區中屬於快照範圍的回力鏢能量（經由招式效果被搬去）
        const toReturn = curDiscard.filter(e => returnSet.has(e.iid));
        if (toReturn.length > 0) {
          const newDiscard = curDiscard.filter(e => !returnSet.has(e.iid));
          // 只挑尚未在 active.energyAttached 中的（避免重複附加）
          const attachedIidSet = new Set(curAtk.energyAttached.map(e => e.iid));
          const actuallyReturn = toReturn.filter(e => !attachedIidSet.has(e.iid));
          const newActive: CardInstance = {
            ...curAtk,
            energyAttached: [...curAtk.energyAttached, ...actuallyReturn],
          };
          const refPlayers = [...newState.players] as [PlayerState, PlayerState];
          refPlayers[aIdx] = { ...refPlayers[aIdx], active: newActive, discard: newDiscard };
          const atkName = pool.get(newActive.cardId)?.name ?? '?';
          newState = addLog(
            { ...newState, players: refPlayers },
            `回力鏢能量：${actuallyReturn.length} 張重新附於 ${atkName}`,
            aIdx,
          );
        }
      }
    }

    // ── v2.195：燃料【火】能量 revive（送回手牌而非寶可夢）─────────────────
    // 卡面：「若因附有這張卡的【火】寶可夢使用的招式的效果使這張卡被丟棄，
    //        則在招式的傷害與效果的影響之後，這張卡放回手牌。」
    // attacker 是【火】（snapshot 階段已 check）+ snapshot iid 出現在 attacker 棄牌
    // → 撈回 attacker 手牌（即使 attacker.active 換了也撈，因為「放回手牌」與寶可夢解綁）
    if (fuelFireSnapshotIids.length > 0) {
      const aPlayer = newState.players[aIdx];
      const returnSet = new Set(fuelFireSnapshotIids);
      const toReturn = aPlayer.discard.filter(e => returnSet.has(e.iid));
      if (toReturn.length > 0) {
        const newDiscard = aPlayer.discard.filter(e => !returnSet.has(e.iid));
        const refPlayers = [...newState.players] as [PlayerState, PlayerState];
        refPlayers[aIdx] = { ...refPlayers[aIdx], hand: [...refPlayers[aIdx].hand, ...toReturn], discard: newDiscard };
        newState = addLog(
          { ...newState, players: refPlayers },
          `燃料【火】能量：${toReturn.length} 張因招式效果被丟棄，放回手牌`,
          aIdx,
        );
      }
    }

    // ── 被動反擊特性（毒刺、灼熱之軀、反擊等）— 只對有實際傷害的招式觸發 ──
    if (baseDamage > 0 && defenderCard.abilities) {
      for (const ab of defenderCard.abilities) {
        const retal = PASSIVE_RETALIATION.get(ab.name);
        if (retal) newState = retal(newState, dIdx, pool);
      }
    }

    // v2.132：sanity sweep — 雙方 active/bench 任何 damage ≥ HP 卻仍在場上者，強制 KO。
    //   觸發點：Leon 用幻影奇襲 200 點打 70HP 土龍弟弟，土龍弟弟被觀察到「damage 200 仍在備戰」。
    //   理論上 KO 流程已在上方處理，但 postFn / 反擊 / 多目標 resolver 可能漏處理某條 path。
    //   做為防呆：每次招式結算後掃過全場，把 zombie 寶可夢移到棄牌（給對手獎賞）。
    newState = sanityKOSweep(newState, aIdx, pool);

    // v2.335：祭典樂舞完整 state-machine：第 1 次招式即使 KO 對手戰鬥位，也要先保留
    // 第 2 次招式權；待獎勵牌與對手新戰鬥寶可夢處理完成後，再回到 main 使用第 2 次招式。
    newState = startFestivalDanceSecondAttackWindow(newState, aIdx, pool);

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

    return maybeResumeFestivalDanceSecondAttack(newState, pool);
  }

  // ── 對手送出新的出場寶可夢（被擊倒後） ──────────────────────────────────
  if (action.type === 'SEND_NEW_ACTIVE') {
    // senderIdx 明確指定時使用（線上模式），否則回落到 aIdx（本機模式）
    const sendingIdx: 0 | 1 = action.senderIdx ?? aIdx;
    const sendingPlayer = { ...players[sendingIdx] };

    if (sendingPlayer.active !== null) return state; // 還有出場寶可夢

    const benchIdx = sendingPlayer.bench.findIndex((c) => c.iid === action.iid);
    if (benchIdx < 0) return state;
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

    // v2.124：偵測 endTurnContinueAfterKO — 表示這是 self-KO 後補戰鬥位
    // → 補完後 re-dispatch END_TURN 並設 endTurnSkipCheckup（避免重跑 checkup 造成重複放傷害），
    // 直接進入 finalize（清旗標 + 切換玩家 + 抽牌）。
    if (state.endTurnContinueAfterKO !== undefined) {
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
    return maybeResumeFestivalDanceSecondAttack(newState, pool);
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
        oppAbilityKOdMeInLastOppTurn: state.oppAbilityKOdMeThisTurn ?? [0, 0],
        oppAttackKOdMyRocketInLastOppTurn: state.oppAttackKOdMyRocketThisTurn ?? [0, 0],
        oppAbilityKOdMyRocketInLastOppTurn: state.oppAbilityKOdMyRocketThisTurn ?? [0, 0],
        oppAttackKOdMeThisTurn: [0, 0],
        oppAbilityKOdMeThisTurn: [0, 0],
        oppAttackKOdMyRocketThisTurn: [0, 0],
        oppAbilityKOdMyRocketThisTurn: [0, 0],
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
      if (poisonPlayer.active?.status !== 'poisoned' && poisonPlayer.active?.secondaryStatus !== 'poisoned') {
        continue;
      }
      const poisonedCard = pool.get(poisonPlayer.active.cardId);
      const stadiumName = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
      let poisonBonus = 0;
      if (stadiumName === '危險密林' && poisonedCard?.pokemonType !== 'Darkness') poisonBonus += 20;
      // 劇毒支配（桃歹郎）— 「中毒方的對手」active 是劇毒支配時 +50
      const oActiveCard = state.players[oIdx].active ? pool.get(state.players[oIdx].active.cardId) : null;
      const hasDominatingPoisonOnActive = oActiveCard?.abilities?.some(a => a.name === '劇毒支配') ?? false;
      if (hasDominatingPoisonOnActive) poisonBonus += 50;
      const newDmg = poisonPlayer.active.damage + 10 + poisonBonus;
      const poisonedHP = getEffectiveHP(poisonPlayer.active, pool, state);
      if (poisonedHP > 0 && newDmg >= poisonedHP) {
        // 被毒死 → KO；獎賞給「中毒方的對手」(oIdx)
        const koDiscard2: CardInstance[] = [
          { ...poisonPlayer.active, damage: newDmg },
          ...poisonPlayer.active.energyAttached,
          ...(poisonPlayer.active.toolAttached ? [poisonPlayer.active.toolAttached] : []),
          ...(poisonPlayer.active.evolvedFromStack ?? []),
        ];
        poisonPlayer.discard = [...poisonPlayer.discard, ...koDiscard2];
        poisonPlayer.active = null;
        players[tIdx] = poisonPlayer;
        const poisonPrizes = prizesForKO(poisonedCard!);
        const winner = { ...players[oIdx] };
        const take = Math.min(poisonPrizes, winner.prizes.length);
        if (take > 0) {
          winner.hand = [...winner.hand, ...winner.prizes.slice(0, take)];
          winner.prizes = winner.prizes.slice(take);
        }
        players[oIdx] = winner;
        const poisonState = addLog(
          { ...state, players },
          `${poisonedCard?.name ?? '?'} 被中毒傷害擊倒！${players[oIdx].name} 取得 ${take} 張獎勵牌。`,
          null
        );
        if (winner.prizes.length === 0) {
          return { ...poisonState, phase: 'game-over', winner: oIdx, winReason: `${winner.name} 取得所有獎勵牌` };
        }
        if (poisonPlayer.bench.length === 0) {
          return { ...poisonState, phase: 'game-over', winner: oIdx, winReason: `${poisonPlayer.name} 沒有可上場的寶可夢` };
        }
        // SEND_NEW_ACTIVE 由被毒死方（tIdx）補；re-dispatch END_TURN 仍以 aIdx 為 activePlayerIndex
        return { ...poisonState, endTurnContinueAfterKO: aIdx };
      } else {
        poisonPlayer.active = { ...poisonPlayer.active, damage: newDmg };
        players[tIdx] = poisonPlayer;
        state = addLog({ ...state, players }, `中毒：${pool.get(poisonPlayer.active.cardId)?.name ?? '?'} 受到 10 傷害！`, null);
      }
    }

    // ── 灼傷（雙方各檢查一次）─────────────────────────────────────────────
    for (const tIdx of [aIdx, dIdx] as const) {
      const oIdx = (1 - tIdx) as 0 | 1;
      const burnedPlayer = { ...players[tIdx] };
      if (burnedPlayer.active?.status !== 'burned' && burnedPlayer.active?.secondaryStatus !== 'burned') {
        continue;
      }
      const burnedCard = pool.get(burnedPlayer.active.cardId);
      const newBurnDmg = burnedPlayer.active.damage + 20;
      const burnedHP = getEffectiveHP(burnedPlayer.active, pool, state);
      if (burnedHP > 0 && newBurnDmg >= burnedHP) {
        // 燒傷致死 → KO；獎賞給對手 oIdx
        const koDiscard3: CardInstance[] = [
          { ...burnedPlayer.active, damage: newBurnDmg },
          ...burnedPlayer.active.energyAttached,
          ...(burnedPlayer.active.toolAttached ? [burnedPlayer.active.toolAttached] : []),
          ...(burnedPlayer.active.evolvedFromStack ?? []),
        ];
        burnedPlayer.discard = [...burnedPlayer.discard, ...koDiscard3];
        burnedPlayer.active = null;
        players[tIdx] = burnedPlayer;
        const burnPrizes = prizesForKO(burnedCard!);
        const burnWinner = { ...players[oIdx] };
        const burnTake = Math.min(burnPrizes, burnWinner.prizes.length);
        if (burnTake > 0) {
          burnWinner.hand = [...burnWinner.hand, ...burnWinner.prizes.slice(0, burnTake)];
          burnWinner.prizes = burnWinner.prizes.slice(burnTake);
        }
        players[oIdx] = burnWinner;
        const burnState = addLog({ ...state, players },
          `${burnedCard?.name ?? '?'} 被燒傷傷害擊倒！${players[oIdx].name} 取得 ${burnTake} 張獎勵牌。`, null);
        if (burnWinner.prizes.length === 0) {
          return { ...burnState, phase: 'game-over', winner: oIdx, winReason: `${burnWinner.name} 取得所有獎勵牌` };
        }
        if (burnedPlayer.bench.length === 0) {
          return { ...burnState, phase: 'game-over', winner: oIdx, winReason: `${burnedPlayer.name} 沒有可上場的寶可夢` };
        }
        return { ...burnState, endTurnContinueAfterKO: aIdx };
      } else {
        burnedPlayer.active = { ...burnedPlayer.active, damage: newBurnDmg };
        // 擲硬幣：正面解除燒傷
        const burnFlip = flipCoinsWithLog(state, 1, `燒傷判定（${burnedCard?.name ?? '?'}）`, tIdx);
        state = burnFlip.state;
        const burnCoin = burnFlip.heads === 1;
        if (burnCoin) {
          // v2.163：燒傷可能在 status 也可能在 secondaryStatus；只清掉燒傷那格。
          if (burnedPlayer.active.status === 'burned') {
            burnedPlayer.active = { ...burnedPlayer.active, status: undefined };
          } else if (burnedPlayer.active.secondaryStatus === 'burned') {
            burnedPlayer.active = { ...burnedPlayer.active, secondaryStatus: undefined };
          }
        }
        players[tIdx] = burnedPlayer;
        state = addLog({ ...state, players }, `燒傷：${burnedCard?.name ?? '?'} 受到 20 傷害 → ${burnCoin ? '正面：燒傷解除' : '反面：燒傷持續'}`, null);
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

    // ── 雪妖女｜冰冷之帳 ─────────────────────────────────────────────────────
    // 卡面：只要這隻寶可夢在場上，每次寶可夢檢查時，在雙方的擁有特性的所有寶可夢
    //       （「雪妖女」除外）身上各放置 1 個傷害指示物。
    // 觸發階段：「寶可夢檢查」= 中毒/灼傷/麻痺/睡眠之後（本段落所在處）。
    // 設計：每隻雪妖女各放 1 個指示物；若場上有 N 隻雪妖女則每個目標放 N 個。
    // v2.70：KO 獎賞兩側都要計算（selfKOInstance 風格直接取獎，不走 pendingPrizes）。
    //        因為：pendingPrizes 會被 activePlayerIndex 方 TAKE_PRIZES，
    //        但 checkup 時 activePlayerIndex 仍是 aIdx，勝方卻可能是任何一方。
    //        改成直接從勝方自己的獎賞堆轉到勝方手牌（與 selfKOInstance 同樣手法）。
    const countFrosmoth = (pl: PlayerState): number => {
      let n = 0;
      if (pl.active && pool.get(pl.active.cardId)?.name === '雪妖女') n += 1;
      n += pl.bench.filter(c => pool.get(c.cardId)?.name === '雪妖女').length;
      return n;
    };
    const frosmothN = countFrosmoth(players[0]) + countFrosmoth(players[1]);
    if (frosmothN > 0) {
      const addCounters = frosmothN; // 每隻雪妖女放 1 個 → 共 N 個指示物 = N*10 傷害
      // v2.125：嚴格排除「雪妖女」本體 — Leon 提醒「冰冷之帳不對雪妖女自己作用」
      // 用 trim 防 scraper 字串前後空白；同時以 startsWith 排除「雪妖女ex」（若未來有的話）
      // 但「超級雪妖女ex」是不同實體（不擁有冰冷之帳，直接被 abilities.length===0 擋）
      const isFrosmothName = (card: Card | undefined): boolean => {
        const n = (card?.name ?? '').trim();
        return n === '雪妖女';
      };
      const isFrosmothCheckupTarget = (c: CardInstance): boolean => {
        const card = pool.get(c.cardId);
        if (!card?.abilities || card.abilities.length === 0) return false;
        if (isFrosmothName(card)) return false;
        return true;
      };
      const affectedNames: string[] = [];
      // [ownerIdx → prizes they owe to opponent]
      const koPrizesByOwner: [number, number] = [0, 0];
      const activeDiedByOwner: [boolean, boolean] = [false, false];
      for (const i of [0, 1] as const) {
        const pl = { ...players[i] };
        // 戰鬥區
        if (pl.active && isFrosmothCheckupTarget(pl.active)) {
          const newDmg = pl.active.damage + addCounters * 10;
          const card = pool.get(pl.active.cardId);
          const hp = getEffectiveHP(pl.active, pool, state);
          affectedNames.push(`${card?.name ?? '?'}(-${addCounters * 10})`);
          if (hp > 0 && newDmg >= hp) {
            const koDiscard: CardInstance[] = [
              { ...pl.active, damage: newDmg },
              ...pl.active.energyAttached,
              ...(pl.active.toolAttached ? [pl.active.toolAttached] : []),
              ...(pl.active.evolvedFromStack ?? []),
            ];
            pl.discard = [...pl.discard, ...koDiscard];
            koPrizesByOwner[i] += prizesForKO(card!);
            activeDiedByOwner[i] = true;
            pl.active = null;
          } else {
            pl.active = { ...pl.active, damage: newDmg };
          }
        }
        // 備戰區
        const newBench: CardInstance[] = [];
        for (const b of pl.bench) {
          if (!isFrosmothCheckupTarget(b)) { newBench.push(b); continue; }
          const newDmg = b.damage + addCounters * 10;
          const card = pool.get(b.cardId);
          const hp = getEffectiveHP(b, pool, state);
          affectedNames.push(`${card?.name ?? '?'}(-${addCounters * 10})`);
          if (hp > 0 && newDmg >= hp) {
            const koDiscard: CardInstance[] = [
              { ...b, damage: newDmg },
              ...b.energyAttached,
              ...(b.toolAttached ? [b.toolAttached] : []),
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
      // 直接取獎：owner i 側寶可夢被 KO → 對手 (1-i) 從自己獎賞堆取牌進手牌
      for (const i of [0, 1] as const) {
        const owed = koPrizesByOwner[i];
        if (owed <= 0) continue;
        const winnerIdx = (1 - i) as 0 | 1;
        const winner = players[winnerIdx];
        state = addLog({ ...state, players },
          `冰冷之帳：${players[i].name} 有寶可夢被擊倒，${winner.name} 取得 ${owed} 張獎勵牌。`,
          null);
        const take = Math.min(owed, winner.prizes.length);
        if (take > 0) {
          const taken = winner.prizes.slice(0, take);
          players[winnerIdx] = {
            ...winner,
            prizes: winner.prizes.slice(take),
            hand: [...winner.hand, ...taken],
          };
          state = addLog({ ...state, players },
            `${winner.name} 取走 ${take} 張獎勵牌（剩餘 ${players[winnerIdx].prizes.length} 張）`,
            null);
        }
        // 勝利條件：勝方獎賞全取完
        if (players[winnerIdx].prizes.length === 0) {
          return {
            ...state, phase: 'game-over',
            winner: winnerIdx, winReason: `${winner.name} 取得所有獎勵牌`,
          };
        }
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

    } // end of `if (!state.endTurnSkipCheckup)` — 寶可夢 checkup 區塊

    // ── v2.192 力之沙漏（PokemonTool）— 回合結束時，若戰鬥場寶可夢附有此 Tool，
    //   從棄牌區附 1 張基本能量到那隻寶可夢。卡面「則可」optional，實作為自動觸發
    //   （從棄牌挑第一張基本能量；極罕見的「不想附」case 不支援）。
    //   阻礙之塔時道具失效。
    {
      const aPlayer = players[aIdx];
      const active = aPlayer.active;
      const toolsJammedET = isToolsJammed(state, pool);
      if (active && !toolsJammedET && active.toolAttached) {
        const toolCard = pool.get(active.toolAttached.cardId);
        if (toolCard?.name === '力之沙漏') {
          // 找棄牌區第一張基本能量
          const eIdx = aPlayer.discard.findIndex(c => {
            const card = pool.get(c.cardId);
            return card?.supertype === 'Energy' && card.subtype === 'Basic';
          });
          if (eIdx >= 0) {
            const energyInst = aPlayer.discard[eIdx];
            const energyCard = pool.get(energyInst.cardId);
            const newDiscard = aPlayer.discard.filter((_, i) => i !== eIdx);
            const newActive = { ...active, energyAttached: [...active.energyAttached, energyInst] };
            players[aIdx] = { ...aPlayer, active: newActive, discard: newDiscard };
            state = addLog({ ...state, players },
              `🔧 力之沙漏：從棄牌區將 ${energyCard?.name ?? '基本能量'} 附加到 ${pool.get(active.cardId)?.name ?? '?'}`,
              aIdx);
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
        if (!c.toolAttached) return c;
        const tCard = pool.get(c.toolAttached.cardId);
        if (!tCard || !TOOL_END_TURN_DISCARD.has(tCard.name)) return c;
        newDiscards.push(c.toolAttached);
        touched = true;
        return { ...c, toolAttached: undefined };
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
        for (const t of newDiscards) {
          const tName = pool.get(t.cardId)?.name ?? '?';
          state = addLog({ ...state, players }, `🔧 ${tName}：自己回合結束，將附加的道具丟棄`, aIdx);
        }
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
    // v2.91：清除同名特性使用紀錄（使者衝刺 / 月光循環 類）
    if (currentPlayer.abilityNamesUsedThisTurn) {
      delete currentPlayer.abilityNamesUsedThisTurn;
    }
    // v2.149：清除祭典樂舞 second-attack flag（END_TURN 後重置該玩家側）
    if (state.festivalDanceUsedThisTurn?.[aIdx]) {
      const newFlag: [boolean, boolean] = [...state.festivalDanceUsedThisTurn] as [boolean, boolean];
      newFlag[aIdx] = false;
      state = { ...state, festivalDanceUsedThisTurn: newFlag };
    }
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
      // v2.101：清除本回合已消耗完的 weaknessDisabledThisTurn / immuneToBasicAttackThisTurn
      // （owner 是 nextP，攻擊方的 END_TURN = nextP 回合結束 — 即這些 self-buff 已走過完整一個對手回合）
      if (c.weaknessDisabledThisTurn) {
        n = { ...n };
        delete n.weaknessDisabledThisTurn;
      }
      if (c.immuneToBasicAttackThisTurn) {
        n = { ...n };
        delete n.immuneToBasicAttackThisTurn;
      }
      // v2.174 阿塞蘿拉的惡作劇 — 同 immune* 系列：對手（攻擊方）END_TURN 時清 ThisTurn
      if (c.immuneToExAttackThisTurn) {
        n = { ...n };
        delete n.immuneToExAttackThisTurn;
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
      if (c.weaknessDisabledNextTurn) {
        n = { ...n, weaknessDisabledThisTurn: true };
        delete n.weaknessDisabledNextTurn;
      }
      if (c.immuneToBasicAttackNextTurn) {
        n = { ...n, immuneToBasicAttackThisTurn: true };
        delete n.immuneToBasicAttackNextTurn;
      }
      // v2.174 阿塞蘿拉的惡作劇 — owner END_TURN 時 promote NextTurn → ThisTurn
      if (c.immuneToExAttackNextTurn) {
        n = { ...n, immuneToExAttackThisTurn: true };
        delete n.immuneToExAttackNextTurn;
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
      currentPlayer.metalShieldThisTurn ||
      currentPlayer.cantRetreatIfPoisonedThisTurn ||
      currentPlayer.bagonElenaThisTurn
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
      delete cp.metalShieldThisTurn;
      delete cp.cantRetreatIfPoisonedThisTurn;
      delete cp.bagonElenaThisTurn;
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
    // v2.174 promote 鐵之防禦強化 / 霍米加的演奏 旗標
    if (nextP.metalShieldNextTurn) {
      nextP.metalShieldThisTurn = true;
      delete nextP.metalShieldNextTurn;
    }
    if (nextP.cantRetreatIfPoisonedNextTurn) {
      nextP.cantRetreatIfPoisonedThisTurn = true;
      delete nextP.cantRetreatIfPoisonedNextTurn;
    }
    players[nextIdx] = {
      ...nextP,
      energyAttachedThisTurn: false,
      supporterPlayedThisTurn: false,
      rocketSupporterPlayedThisTurn: false,
      ancientSupporterPlayedThisTurn: false,
      carnelliPlayedThisTurn: false,
      retreatedThisTurn: false,
    };

    // 重置競技場使用旗標（當前玩家的回合結束時清除其旗標）
    let stadiumUsedThisTurn = state.stadiumUsedThisTurn ?? [false, false] as [boolean, boolean];
    const newStadiumUsed: [boolean, boolean] = [stadiumUsedThisTurn[0], stadiumUsedThisTurn[1]];
    newStadiumUsed[aIdx] = false;

    // 重置「本回合是否打過競技場」旗標（即將開始回合的 nextIdx 清零）
    const stadiumPlayedThisTurn = state.stadiumPlayedThisTurn ?? [false, false] as [boolean, boolean];
    const newStadiumPlayed: [boolean, boolean] = [stadiumPlayedThisTurn[0], stadiumPlayedThisTurn[1]];
    newStadiumPlayed[nextIdx] = false;

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
        stadiumPlayedThisTurn: newStadiumPlayed,
        oppPrizesAtMyLastTurnEnd: newOppSnap,
        oppPrizesAtMyTurnStart: newTurnStart,
        rocketInMyDiscardAtMyLastTurnEnd: newRocketLastEnd,
        rocketInMyDiscardAtMyTurnStart: newRocketTurnStart,
        // v2.124：finalize 結束時清掉 endTurnSkipCheckup（避免下次 endTurn 也跳過 checkup）
        endTurnSkipCheckup: undefined,
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
function scrubBenchStatus(state: GameState): GameState {
  let changed = false;
  const players = state.players.map((p) => {
    let benchChanged = false;
    const newBench = p.bench.map((b) => {
      // v2.187：化石永不持有任何狀態（戰鬥場或備戰）
      if (b.fossilOnField && (b.status !== undefined || b.secondaryStatus !== undefined)) {
        benchChanged = true;
        return { ...b, status: undefined, secondaryStatus: undefined };
      }
      // 一般寶可夢：備戰區不應持有異常狀態（v2.47 規則）
      if (b.status !== undefined || b.secondaryStatus !== undefined) {
        benchChanged = true;
        return { ...b, status: undefined, secondaryStatus: undefined };
      }
      return b;
    });
    // v2.187：戰鬥場上的化石也不該持有狀態
    let activeChanged = false;
    let newActive = p.active;
    if (newActive?.fossilOnField && (newActive.status !== undefined || newActive.secondaryStatus !== undefined)) {
      newActive = { ...newActive, status: undefined, secondaryStatus: undefined };
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
export function applyAction(
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

  // v2.47 防禦層：備戰寶可夢不應持有異常狀態
  next = scrubBenchStatus(next);

  // v2.136 零之大空洞：每次 dispatch 完，重新計算備戰上限。若場地離場/失去太晶 → 自動丟備戰至 5
  next = enforceBenchLimit(next, pool);

  // v2.135 防禦層：若任一玩家在 'playing' 階段沒 active 也沒 bench → game-over
  // 漏網的 KO 路徑（self-return-to-hand / self-KO ability / 中毒/灼傷邊緣案例 等）若忘了
  // trigger game-over，sim 會 stuck loop。這裡做最後一道保險。
  if (next.phase === 'playing' && !next.pendingSelection) {
    for (const idx of [0, 1] as const) {
      const p = next.players[idx];
      if (p.active === null && p.bench.length === 0) {
        const winner = (1 - idx) as 0 | 1;
        next = {
          ...next,
          phase: 'game-over',
          winner,
          winReason: `${p.name} 沒有可上場的寶可夢`,
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
  if (!toolsJammed && inst.toolAttached) {
    const toolCard = pool.get(inst.toolAttached.cardId);
    if (toolCard?.subtype === 'PokemonTool' && toolCard.attacks?.length) {
      for (const atk of toolCard.attacks) {
        result.push({ atk, sourceCardName: toolCard.name, isFromTool: true });
      }
    }
  }
  return result;
}

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
      const SECOND_PLAYER_FIRST_TURN_ONLY = new Set<string>(['絕叫']);
      if (SECOND_PLAYER_FIRST_TURN_ONLY.has(atk.name)) {
        const isSecondPlayer = state.activePlayerIndex !== state.firstPlayerIdx;
        if (!state.isFirstTurn || !isSecondPlayer) return -1;
      }
      // v2.103：大竺葵繁茂 / 燃火能量倍率（傳 state+activePlayerIndex）
      // v2.127：傳 atk.name 讓 canAffordAttack 能套用 酋雷姆｜反等離子 條件式減費
      return canAffordAttack(player.active!, atk.cost, pool, state, state.activePlayerIndex, atk.name) ? i : -1;
    })
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
  const player = state.players[state.activePlayerIndex];

  // v2.264：UI/AI 鏡射 engine 的 cantEvolveThisTurn gate（line 1314）。
  //   缺這層會讓 AI 無限重發 EVOLVE → engine 預設返回原 state → stuck_loop。
  //   sim 抓到的 7 場「青銅鐘多龍 EVOLVE 卡死」根因（青銅鐘｜進化妨礙者 對對手鎖進化）。
  if (player.cantEvolveThisTurn) return [];

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

  // v2.109/v2.110：活力森林（Stadium）— 雙方的所有【草】寶可夢就算在剛使出的回合也可進化成【草】寶可夢。
  //   v2.110：bypass 不只 justPlaced 也 bypass evolvedThisTurn，允許同回合連鎖進化整條草鏈
  //   （菊草葉→月桂葉→大竺葵 一回合打完）。只要 base/evo 都是草，活力森林 exception 放行。
  const stadiumName = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : null;
  const isForest = stadiumName === '活力森林';

  const result: Array<{ fromIid: string; toIids: string[] }> = [];
  for (const fp of fieldPokemon) {
    const fpCard = pool.get(fp.cardId);
    if (!fpCard) continue;
    // v2.149 提升進化（伊布 SV8a 125）：base 在戰鬥場 + 卡有此特性 → bypass isFirstTurn + justPlaced
    const isFpActive = player.active?.iid === fp.iid;
    const hasPushEvolveAbility = isFpActive && fpCard.abilities?.some(a => a.name === '提升進化');
    // isFirstTurn gate（除了提升進化 bypass）
    if (state.isFirstTurn && !hasPushEvolveAbility) continue;
    // 活力森林 bypass 對 base 的要求：base 是草寶可夢
    const forestBypassBase = isForest && fpCard.pokemonType === 'Grass';
    // 原本的 gate：justPlaced OR evolvedThisTurn 擋。活力森林 / 提升進化 exception 兩者都能豁免（per-evo 再確認）
    const baseBlocked = fp.justPlaced || fp.evolvedThisTurn;
    if (baseBlocked && !forestBypassBase && !hasPushEvolveAbility) continue;
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
      // 若 base 被擋但進到這裡 → 代表 forest 或 提升進化 bypass 成立
      if (baseBlocked && !hasPushEvolveAbility && !(forestBypassBase && ec.pokemonType === 'Grass')) return false;
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
  baseCost: number,
  pool: Map<string, Card>,
): number {
  if (!retreatingCard) return baseCost;
  if (ABILITY_RETREAT_MOD.size === 0) return baseCost;

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

  let cost = baseCost;
  if (zero) cost = 0;
  cost = Math.max(0, cost - totalReduce);
  cost = cost + totalAdd;
  return cost;
}

/**
 * 目前行動玩家是否可以撤退出場寶可夢。
 */
export function getRetreatCost(state: GameState, pool: Map<string, Card>): number | null {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return null;
  const player = state.players[state.activePlayerIndex];
  if (player.retreatedThisTurn || !player.active || player.bench.length === 0) return null;
  // 睡眠和麻痺時無法撤退
  if (player.active.status === 'asleep' || player.active.status === 'paralyzed') return null;
  // v2.174 霍米加的演奏：自己的中毒寶可夢本回合無法撤退
  if (player.cantRetreatIfPoisonedThisTurn
      && (player.active.status === 'poisoned' || player.active.secondaryStatus === 'poisoned')) {
    return null;
  }
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
  // v2.119 修：canRetreat() 也要鏡射 N的城堡 hook（原 v2.117 只改了 RETREAT handler 的 cost，
  //   導致 UI canRetreatNow 仍用舊 cost 計算，按鈕不出現）。
  const stadiumNameCR = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : undefined;
  if (stadiumNameCR === 'N的城堡' && card?.name?.startsWith('N的')) cost = 0;
  // v2.177 樂園度假地：可達鴨撤退 -1（UI 鏡射）
  if (stadiumNameCR === '樂園度假地' && card?.name === '可達鴨') cost = Math.max(0, cost - 1);
  // v2.277 Wave 3：套用 ABILITY_RETREAT_MOD（一身輕 / 溶化流動 / 鋼之橋 / 森林秘道 / 大網）
  cost = applyAbilityRetreatMod(state, player.active, card, state.activePlayerIndex, cost, pool);
  return cost;
}

export function canRetreat(state: GameState, pool: Map<string, Card>): boolean {
  const cost = getRetreatCost(state, pool);
  if (cost === null) return false;
  const player = state.players[state.activePlayerIndex];
  // v2.69：以能量單位計算（火箭隊能量 1 張 = 2 units）。
  // v2.108：傳 state+aIdx 讓大竺葵繁茂套上（基本【草】能量 = 2 units）。
  return totalEnergyUnits(player.active!.energyAttached, pool, state, state.activePlayerIndex) >= cost;
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
      if (c.subtype === 'Stadium' && (state.stadiumPlayedThisTurn?.[state.activePlayerIndex] ?? false)) return false;
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
  const player = state.players[state.activePlayerIndex];
  // v2.136 零之大空洞：場上有太晶寶可夢時上限可達 8
  if (player.bench.length >= getBenchLimit(state, state.activePlayerIndex, pool)) return [];
  return player.hand
    .filter(inst => isBasicPokemonCard(pool.get(inst.cardId)))
    .map(inst => inst.iid);
}

/**
 * v2.189：列出手牌中可作為基礎寶可夢上場的「化石 Item」。
 * 走 PLAY_FOSSIL action（不走 PLAY_TRAINER），UI 拖曳到備戰格時觸發。
 */
export function getPlayableFossils(state: GameState, pool: Map<string, Card>): string[] {
  if (state.phase !== 'playing' || state.turnPhase !== 'main') return [];
  if (state.pendingSelection) return [];
  const player = state.players[state.activePlayerIndex];
  if (player.bench.length >= getBenchLimit(state, state.activePlayerIndex, pool)) return [];
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
        UNLIMITED_USE_ABILITY_NAMES.has(ab.name) && ABILITY_EFFECTS.has(`${card.name}|${i}`)
      );
      if (!hasUnlimited) continue;
    }
    const card = pool.get(pk.cardId);
    if (!card?.abilities) continue;
    // 火箭隊的監視塔：【無】屬寶可夢的特性全部消除
    if (isColorlessAbilityBlocked(state, card, pool)) continue;
    card.abilities.forEach((ab, abIdx) => {
      // 只列出在 ABILITY_EFFECTS 中有登錄的主動特性
      if (!ABILITY_EFFECTS.has(`${card.name}|${abIdx}`)) return;
      // v2.320：已改為自動提示的特性，不在手動清單中顯示
      if (ON_PLAY_FROM_HAND_ABILITIES.has(ab.name) || ON_EVOLVE_FROM_HAND_ABILITIES.has(ab.name)) return;
      // 集客：只有出場才能用 + 牌庫不空（v2.229 補資源 gate）
      if (ab.name === '集客') {
        if (player.active?.iid !== pk.iid) return;
        if (player.deck.length === 0) return;
      }
      // 精神抽出 / 龐克練肌 / 合金建造（v2.102）：只有本回合剛進化才能用
      if ((ab.name === '精神抽出' || ab.name === '龐克練肌' || ab.name === '合金建造' || ab.name === '能量舞步' || ab.name === '脫殼') && !pk.evolvedThisTurn) return;
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
      // v2.133 沉雪 額外 gate：場上沒有競技場卡時無意義
      if (ab.name === '沉雪' && !state.activeStadium) return;
      // v2.133 迅速游標 gate：必須從備戰發動（pk 不是 active）
      if (ab.name === '迅速游標' && player.active?.iid === pk.iid) return;
      // 腎上腺腦力（願增猿）：身上 ≥1 顆【惡】能量 && 自己場上 ≥1 隻受傷（damage≥10）
      //   && 對手場上 ≥1 隻寶可夢。v2.123 補後兩個 gate（Leon 反饋：不符條件就不顯按鈕）。
      if (ab.name === '腎上腺腦力') {
        if ((countEnergy(pk, pool).get('Darkness') ?? 0) < 1) return;
        const selfField = [...(player.active ? [player.active] : []), ...player.bench];
        if (!selfField.some(c => c.damage >= 10)) return;
        const oppIdx = (1 - state.activePlayerIndex) as 0 | 1;
        const opp = state.players[oppIdx];
        if (!opp.active && opp.bench.length === 0) return;
      }
      // v2.53 碧綠之舞：手牌必須至少有 1 張基本草能量（否則按了只會輸出警告 log，
      // Leon 反饋希望 UI 直接隱藏按鈕，而不是誤按後才提示）。
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
      // v2.224 風扇呼喚（旋轉洛托姆）：「只有在自己的最初回合可使用 1 次」
      //   先攻最初回合 = turn 1；後攻最初回合 = turn 2。turn > 2 時不論先/後攻
      //   都已過了最初回合，按鈕直接隱藏。
      //   （USE_ABILITY 必然 active player == 持卡方，所以不需另判 firstPlayerIdx）
      //   v2.229 補：牌庫不空（搜空 deck 沒意義）
      if (ab.name === '風扇呼喚') {
        if (state.turn > 2) return;
        if (player.deck.length === 0) return;
      }
      // ─── v2.229 大批主動特性 gate 補完（之前 audit 漏掉，按下才跳 log 的災難） ─────
      // v2.229 桃歹郎ex｜支配鎖鏈：必須在戰鬥場 + 備戰有【惡】寶可夢（非桃歹郎ex）
      if (ab.name === '支配鎖鏈') {
        if (player.active?.iid !== pk.iid) return;
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
          return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && cc.pokemonType === 'Lightning';
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
  if (totalEnergyUnits(pickedInsts, pool, state, actorIdx) < retreatCost) return state;

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
  // log 寫出玩家選擇丟棄了哪幾張能量
  const discardNames = discardE.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
  const msg = discardE.length > 0
    ? `${prefix}（丟棄：${discardNames}），${newActiveCard?.name ?? '?'} 上場！`
    : `${prefix}，${newActiveCard?.name ?? '?'} 上場！`;

  return {
    ...state,
    players,
    log: [...state.log, { turn: state.turn, playerIndex: actorIdx, message: msg }],
  };
});
