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
import type { GameState, PlayerState, CardInstance, PendingSelection, GameAction, SpecialCondition } from './types';

// ── 基礎設施 → 從 effects/_shared.ts 匯入 ──────────────────────────────────
//
// v2.05 起，effects 模組的型別 / 登錄表 / 登錄函式 / 共用 helper 集中在
// ./effects/_shared.ts。所有 effects/cards/*.ts 子檔也從同一個地方 import，
// 確保 reg() / regR() / regG() 寫入的是同一份 Map 實例。
// effects.ts 仍保留所有尚未被搬遷的卡牌 reg 呼叫。

import type { EffectFn, ResolveFn, TrainerGuardFn, AttackPreFn, AttackPostFn, PreDiscardSpec } from './effects/_shared';
import {
  // Maps
  TRAINER_EFFECTS, RESOLVERS, TRAINER_GUARDS,
  ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, ATTACK_PRE_DISCARD_CHOICE,
  BENCH_PLACE_TRIGGERS,
  SPECIAL_ENERGY_ATTACH,
  SPECIAL_ENERGY_HP_BONUS, SPECIAL_ENERGY_RETREAT_MOD,
  SPECIAL_ENERGY_STATUS_IMMUNE, SPECIAL_ENERGY_ON_DAMAGED,
  // Register functions
  reg, regR, regG,
  regPre, regPost, regA,
  // Public
  canPlayTrainer,
  // Helpers
  shuffle, updatePlayer, addLog, addPrivateLog,
  drawCards, discardHand, returnHandToDeck,
  withPending,
  clearActiveEffects,
  healResolver,
  sameEvoName,
  applyBenchPlaceSideEffects,
  getEnergyDiscardUnits,
} from './effects/_shared';

// re-export helper 給 engine.ts / 其他 resolver 用
export { applyBenchPlaceSideEffects };

// 為 engine.ts / +page.svelte 的 import 路徑維持相容：re-export
export { TRAINER_EFFECTS, RESOLVERS, TRAINER_GUARDS, canPlayTrainer, clearActiveEffects };
export { ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, ATTACK_PRE_DISCARD_CHOICE, getEnergyDiscardUnits };
// v2.133 PASSIVE_PREVENT_KO 在本檔下方定義，匯出供 engine 使用
// （直接在此先 forward-ref：宣告處放到 v2.133 區塊，之後會由 engine import）
export { BENCH_PLACE_TRIGGERS };
export { SPECIAL_ENERGY_ATTACH, SPECIAL_ENERGY_HP_BONUS, SPECIAL_ENERGY_RETREAT_MOD, SPECIAL_ENERGY_STATUS_IMMUNE, SPECIAL_ENERGY_ON_DAMAGED };
export type { ResolveFn, TrainerGuardFn, AttackPreFn, AttackPostFn, PreDiscardSpec };

// ── 道具（Pokemon Tool）模組 — v2.09 從本檔抽離 ────────────────────────────
// tools.ts 包含 TOOL_* 所有登錄表、每張道具 entry、toolAttachEffect +
// attach-tool resolver、自動登記區塊。這裡 import {...} 同時：
//   (a) 觸發 tools.ts 的 side-effect（所有 reg / TOOL_*.set）
//   (b) 把 TOOL_* 拉進本檔 scope，供下方 effectiveHPInline 等區域 helper 使用
//   (c) 透過 export { ... } 轉發給 engine.ts（engine 從 './effects' import TOOL_*）
import {
  TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE, TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY,
  TOOL_PREVENT_KO, TOOL_ON_KO, TOOL_PRIZE_BONUS, TOOL_ON_DAMAGED,
  TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS,
  TOOL_ATTACH_GATE, TOOL_END_TURN_DISCARD,
} from './effects/cards/tools';
export {
  TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE, TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY,
  TOOL_PREVENT_KO, TOOL_ON_KO, TOOL_PRIZE_BONUS, TOOL_ON_DAMAGED,
  TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS,
  TOOL_ATTACH_GATE, TOOL_END_TURN_DISCARD,
};

// ── 競技場卡（Stadium）模組 — v2.10 從本檔抽離 ─────────────────────────────
// stadiums.ts 包含 3 個 USE_STADIUM 的 pending resolver（神秘花園、夜間學院、
// 月光丘陵）以及 JAMMING_TOWER_STADIUMS / ROCKET_WATCHTOWER_STADIUMS 兩個
// 引擎側 hook 集合（道具無效 / 【無】寶可夢特性無效）。
import { JAMMING_TOWER_STADIUMS, ROCKET_WATCHTOWER_STADIUMS, BENCH_PROTECTION_STADIUMS, PASSIVE_STADIUMS } from './effects/cards/stadiums';
export { JAMMING_TOWER_STADIUMS, ROCKET_WATCHTOWER_STADIUMS, BENCH_PROTECTION_STADIUMS, PASSIVE_STADIUMS };

/**
 * v2.22：對戰圓形競技場（Stadium）— 備戰保護判定
 * 當場上活動場地卡為 BENCH_PROTECTION_STADIUMS（對戰圓形競技場）時，
 * 雙方所有備戰寶可夢不會因對手的招式/特性效果被放置傷害指示物。
 * 所有 snipe-*、cursed-bomb、bench-hit-N、damage-distribute、全體指示物 resolver
 * 在處理備戰目標前先呼叫這個 helper；true → 跳過放置並記 log。
 */
export function isBenchProtected(state: GameState, pool: Map<string, Card>): boolean {
  const s = state.activeStadium;
  if (!s) return false;
  const card = pool.get(s.cardId);
  if (!card) return false;
  return BENCH_PROTECTION_STADIUMS.has(card.name);
}

/**
 * v2.67：計算玩家場上「古代」tag 寶可夢數量（戰鬥場 + 備戰區）。
 * - 依據 card.tags?.includes('古代')（由 scraper + migration 補到 static/cards）
 * - 用於 故勒頓｜原生亂打、覺醒戰鼓…等以古代寶可夢為數量倍率的效果
 * - v2.48 的太晶 tag 屬同類機制；此 helper 可視為同一 pattern 的延伸
 */
export function countAncientOnField(
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
): number {
  const p = state.players[idx];
  const instances = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  let count = 0;
  for (const inst of instances) {
    const card = pool.get(inst.cardId);
    if (card?.tags?.includes('古代')) count++;
  }
  return count;
}

/**
 * v2.46：招式/特性的傷害判定分類
 * - attack-damage：招式的【傷害】（例：殘酷箭、狙擊羽毛、暗影子彈的 30 點、電磁電光）
 *     → 不被對戰圓形擋；會被謝米「花之帷幔」擋（只擋備戰且非規則寶可夢）
 * - attack-effect：招式的【效果】（放傷害指示物，例：悄聲加害、飛來橫禍、幻影奇襲的 6 個指示物）
 *     → 被對戰圓形擋；不被花之帷幔擋
 * - ability-effect：特性的【效果】（放傷害指示物，例：咒詛炸彈）
 *     → 被對戰圓形擋；不被花之帷幔擋
 *
 * 起源：v2.46 Leon 發現「殘酷箭：土龍弟弟 因對戰圓形競技場效果不受傷害」是錯的。
 * 對戰圓形只擋「放置指示物」的效果，不擋招式本身的傷害。因此分離傷害 vs 效果兩個判定。
 * 類似於基本能量 vs 特殊能量當初的拆分原則。
 */
export type DamageKind = 'attack-damage' | 'attack-effect' | 'ability-effect';

/**
 * v2.46：檢查 defender 場上是否有謝米（花之帷幔）。
 * 花之帷幔：自己的所有備戰寶可夢（擁有規則的寶可夢除外）不會受到對手的招式的傷害。
 *   - 只擋「招式的傷害」（attack-damage）
 *   - 不擋招式的效果（放指示物）或特性效果
 *   - 不擋對戰鬥寶可夢的傷害
 *   - 目標若為「擁有規則的寶可夢」（ex/EX）不受保護
 */
export function hasFlowerVeil(
  state: GameState,
  defenderIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const defender = state.players[defenderIdx];
  const cards = [defender.active, ...defender.bench].filter((c): c is CardInstance => !!c);
  for (const c of cards) {
    const card = pool.get(c.cardId);
    if (!card?.abilities) continue;
    for (const a of card.abilities) {
      if (a.name === '花之帷幔') return true;
    }
  }
  return false;
}

/**
 * v2.57：檢查 defender 場上是否有「火箭隊的急凍鳥｜抵抗之幕」特性。
 * 抵抗之幕：只要這隻寶可夢在場上，自己的場上所有【基礎】寶可夢的「火箭隊的寶可夢」，
 *           不會受到對手的寶可夢使用招式的效果的影響。
 *   - 只擋「招式的效果」（attack-effect）— 放指示物、debuff flag、異常狀態等
 *   - 不擋純招式傷害（那是 attack-damage）
 *   - 不擋對手的特性效果（卡面明確說「招式的」）
 *   - 目標條件：Basic stage + 名稱含「火箭隊的」
 */
export function hasRocketVeil(
  state: GameState,
  defenderIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const defender = state.players[defenderIdx];
  const cards = [defender.active, ...defender.bench].filter((c): c is CardInstance => !!c);
  for (const c of cards) {
    const card = pool.get(c.cardId);
    if (!card?.abilities) continue;
    for (const a of card.abilities) {
      if (a.name === '抵抗之幕') return true;
    }
  }
  return false;
}

/** v2.57：判斷 targetCard 是「基礎」且名稱含「火箭隊的」— 抵抗之幕保護對象 */
export function isRocketBasicTarget(targetCard: Card | undefined): boolean {
  if (!targetCard) return false;
  // 基礎寶可夢：subtype === 'Basic'（不含 Stage1/Stage2/Mega 等）
  if (targetCard.subtype !== 'Basic') return false;
  // 名稱含「火箭隊的」（火箭隊的急凍鳥、火箭隊的超夢ex、火箭隊的操陷蛛 等）
  return targetCard.name.includes('火箭隊的');
}

/**
 * v2.57：檢查指定 player 場上是否有「莉莉艾的皮皮ex｜妖精領域」特性。
 * 妖精領域：只要這隻寶可夢在場上，對手的場上的所有【龍】寶可夢的弱點全部改爲【超】屬性。
 *   - engine 在計算弱點時查這個 flag：若 attacker 的一方有皮皮ex 且 defender 是【龍】，
 *     則把 defender 的弱點類型當作 'Psychic' 處理。
 *   - 被火箭監視塔壓制時（皮皮ex 是【妖精】不是【無】），此特性仍生效。
 */
export function hasFairyZoneField(
  state: GameState,
  ownerIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const p = state.players[ownerIdx];
  const cards = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  for (const c of cards) {
    const card = pool.get(c.cardId);
    if (!card?.abilities) continue;
    for (const a of card.abilities) {
      if (a.name === '妖精領域') return true;
    }
  }
  return false;
}

/**
 * v2.46：「對備戰目標」造成傷害/放指示物時，統一檢查是否被卡面/場地擋下。
 *   kind === 'attack-effect' / 'ability-effect' → 查對戰圓形（備戰不放指示物）
 *   kind === 'attack-damage'                   → 查花之帷幔（備戰且非 ex）、太晶（備戰）
 * 回傳：{ blocked: true, reason } 表示被擋下；{ blocked: false } 表示可進行。
 * 注意：actor 的對手 = defender，所以比對特性要對 defenderIdx 做。
 *
 * v2.48：加入太晶規則。太晶寶可夢在【備戰區】不會受到【招式】的【傷害】，
 *        但招式內的「指示物放置」效果（e.g. 幻影奇襲 的 6 counter）不受太晶保護，
 *        所以只在 kind === 'attack-damage' 分支檢查 tags。
 *        Active 的太晶寶可夢不受此保護 — caller 應只在目標為 bench 時呼叫本函式。
 */
export function resolveBenchGuard(
  state: GameState,
  pool: Map<string, Card>,
  actorIdx: 0 | 1,
  targetCard: Card | undefined,
  kind: DamageKind,
): { blocked: true; reason: string } | { blocked: false } {
  if (kind === 'attack-effect' || kind === 'ability-effect') {
    if (isBenchProtected(state, pool)) {
      return { blocked: true, reason: '對戰圓形競技場效果' };
    }
  }
  if (kind === 'attack-effect') {
    // v2.57：火箭隊的急凍鳥「抵抗之幕」— 我方基礎火箭隊寶可夢不受對手【招式的效果】影響。
    // 因 resolveBenchGuard 僅在 target 為 bench 時被呼叫，這裡檢查備戰區上的目標即可。
    const defenderIdx = (1 - actorIdx) as 0 | 1;
    if (hasRocketVeil(state, defenderIdx, pool) && isRocketBasicTarget(targetCard)) {
      return { blocked: true, reason: '火箭隊的急凍鳥 抵抗之幕 效果' };
    }
  }
  if (kind === 'attack-damage') {
    const defenderIdx = (1 - actorIdx) as 0 | 1;
    if (hasFlowerVeil(state, defenderIdx, pool) && !isExCard(targetCard)) {
      return { blocked: true, reason: '謝米 花之帷幔 效果' };
    }
    if (targetCard?.tags?.includes('太晶')) {
      return { blocked: true, reason: '太晶寶可夢 防禦效果' };
    }
    // v2.191 陳舊的羽毛化石（在備戰時不受對手寶可夢招式的傷害）
    // 同太晶 pattern：只在 kind='attack-damage' + target 為 bench 時 block
    // resolveBenchGuard caller 已保證 target 在 bench，這裡只比對 cardName
    if (targetCard?.name === '陳舊的羽毛化石') {
      return { blocked: true, reason: '陳舊的羽毛化石 備戰免傷' };
    }
  }
  return { blocked: false };
}

// SPECIAL_ENERGY_ATTACH 和 AttachEnergyHookFn 已搬到 _shared.ts（v2.66）。

// 已搬遷到 effects/cards/ 下的卡 — side-effect import 觸發 reg() 登錄。
// 未來要加更多搬遷檔時，也只需要在這裡加一行 import。
import './effects/cards/white_lily_akamatsu';
import './effects/cards/draw_supporters';
import './effects/cards/pokemon_search';
// v2.24：物品卡雜項（切換/藥水/棄牌區回收/頂尖捕捉器/不公印章）+ Gust 支援者
import './effects/cards/items_misc';
import './effects/cards/supporters_gust';
// v2.64：胡地 + 瑪俐的長毛巨魔ex 預組卡（Wave 44）
import './effects/cards/abra_mawile_deck';
// v2.65：魔靈多龍牌組 Wave 43（黑夜魔靈咒詛炸彈 / 多龍奇 / 願增猿 / 喵喵ex / 特殊紅牌 / 阿蜜的目光）
import './effects/cards/maroon_dragon_deck';
// v2.66：特殊能量卡 hook（富裕能量 / 感應【超】能量 / 火箭隊能量）
import './effects/cards/energy_cards';
// v2.89：呆呆王 + 超級路卡利歐 兩組預組卡效果（使者衝刺 / 機關槍合擊 / 波動突刺 /
//        超級勇氣 / 月光循環 / 宇宙光束 / 幻影碎 / 暗碼迷的解讀 等）
import './effects/cards/slowking_lucario_deck';
// v2.100：奧利瓦 / 鋁鋼橋龍 / 超級寶石海星 三組預組卡效果
import './effects/cards/mega_decks';
// v2.112：N的索羅亞克 / 火焰雞多龍 / 夠讚狗 / 顫弦蠑螈 / 蒼炎刃鬼 / 超級甲賀忍蛙 六組預組卡效果
import './effects/cards/six_decks';
// v2.135：阿響的火爆獸 / 火箭隊的烏鴉頭頭 兩組預組卡效果（在本檔末尾 inline 註冊）
// v2.149：超級長耳兔 / 蜜集大蛇 / 火伊布 / 祭典樂舞 四組預組卡效果（熟成充能 / 衝衝鼓 / 搜尋寶石 / 祭典樂舞 註解）
import './effects/cards/lopunny_serperior_flareon_festival';
// v2.154：土龍多龍 / 大竺葵 / 太陽伊布 / 巨金怪 / 水牛超級袋獸 / 莉莉艾的皮皮 /
//         超級妙蛙花 / 超級袋獸阿勃梭魯 / 青銅鐘多龍 九組預組卡新效果
//         （日光轉移 / 金屬製造者 / 玻璃喇叭 / 超大冰淇淋；鈷藍指令、捲牆 inline）
import './effects/cards/v154_decks';
// v2.155：補實裝 20 個 preset 主力 ex 招式（audit 漏掃修正後找出的長期漏實裝）
import './effects/cards/v155_attacks';
// v2.158：通用「逐張附能量到玩家選的目標寶可夢」chain helper
//         供燃燒充能 / 電電充能 / 樂呵呵之吻 / 金屬製造者 / 玻璃喇叭 / X啟動 共用
import './effects/cards/v158_energy_chain';
import './effects/cards/v168_supporters';
import './effects/cards/v169_supporters';
import './effects/cards/v172_hij_batch';

// ══════════════════════════════════════════════════════════════════════════════
// 即時支援者 / 互動支援者 — v2.12 搬到 effects/cards/draw_supporters.ts
// 管理員 / 帕底亞的夥伴 / 納莉 / 丹瑜 / 紫竽 / 松葉的信心 / 莉莉艾的決意（v2.24 搬）/
// 枇琶 / 艾莉絲的鬥志 / 探險家的嚮導 / 鳴依的勉勵
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 切換 / 藥水 / 棄牌區回收 / 頂尖捕捉器 / 不公印章
//   v2.24 搬到 effects/cards/items_misc.ts
// 包含：寶可夢交替 / 急進開關 / 好傷藥 / 龍之秘藥 / 夜間擔架 / 能量回收器 /
//       奇跡修正檔 / 頂尖捕捉器 / 不公印章
//       共用 resolver: do-switch / heal-60-discard-1 / heal-120 /
//                      discard-to-hand / energy-retrieval /
//                      miracle-codec-energy / miracle-codec-attach /
//                      top-catcher-opp
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（球 + 小剛的發掘） — v2.19 已抽到 effects/cards/pokemon_search.ts
// 包含：好友寶芬、赫普的包包、甜蜜球、黑暗球、小剛的發掘、高級球、超級信號
//       共用 resolver: bench-basic-from-deck / search-pokemon-to-hand / ultra-ball-discard
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 支援者 — 呼叫對手（Gust 系列）— v2.24 搬到 effects/cards/supporters_gust.ts
// 包含：老大的指令   共用 resolver: gust-opp
// ══════════════════════════════════════════════════════════════════════════════

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

// ATTACK_PRE / ATTACK_POST / regPre / regPost / PreDiscardSpec /
// ATTACK_PRE_DISCARD_CHOICE 已於 v2.64 搬到 ./effects/_shared.ts，
// 本檔於最上方 import 取得並 re-export 給 engine.ts / +page.svelte 繼續使用。

// ══════════════════════════════════════════════════════════════════════════════
// POST 共用 helper：bench 施傷 / KO 處理（v1.58 H13 批次）
// ══════════════════════════════════════════════════════════════════════════════

/** 計算 KO 獎賞張數（與 engine.prizesForKO 對齊；inline 以免 effects→engine 反向依賴） */
export function koPrizeCount(card: Card): number {
  const isEx = card.name.endsWith('ex') || card.name.endsWith('EX');
  if (isEx && card.name.startsWith('超級')) return 3; // Mega ex
  return isEx ? 2 : 1;
}

/**
 * 計算 CardInstance 的有效 HP（含道具 HP 加成 + 場地卡影響，與 engine.getEffectiveHP 對齊）。
 * v2.92：加 `state` 參數以套用場地效果（例：引力山岳 Stage2 -30）。
 * 現有 caller 都在 regPost / regR 內部，都持有 state；傳入即可。
 */
function effectiveHPInline(
  inst: CardInstance,
  pool: Map<string, Card>,
  state?: GameState,
): number {
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
  // v2.175 特殊能量 HP bonus（增強【草】等）— iterate energyAttached
  for (const e of inst.energyAttached) {
    const ec = pool.get(e.cardId);
    if (!ec) continue;
    const fn = SPECIAL_ENERGY_HP_BONUS.get(ec.name);
    if (fn) hp += fn(card);
  }
  // v2.92：引力山岳（Stadium）— 雙方場上所有【2階進化】寶可夢最大 HP -30
  if (state?.activeStadium?.name === '引力山岳' && card.stage === 'Stage2') {
    hp = Math.max(0, hp - 30);
  }
  // v2.113 夠讚狗｜腎上腺力量 — 身上附【惡】能量時最大 HP +100
  // v2.120 修：稜鏡能量附於基礎寶可夢時視為提供全屬性能量（含惡能量），也算數
  if (card.name === '夠讚狗') {
    // 夠讚狗是 Basic，稜鏡能量附它 → 全屬性（含 Darkness）
    const hostIsEvolution = !!card.evolvesFrom || card.stage === 'Stage1' || card.stage === 'Stage2';
    const hasDark = inst.energyAttached.some(e => {
      const ec = pool.get(e.cardId);
      if (!ec || ec.supertype !== 'Energy') return false;
      // 基本能量 Darkness
      if (ec.subtype === 'Basic' && (ec.pokemonType === 'Darkness' || /【惡】/.test(ec.name))) return true;
      // 特殊能量本來屬性即含 Darkness（火箭隊能量、古舊能量等）
      if (ec.pokemonType === 'Darkness') return true;
      // 稜鏡能量 on Basic host → 視為全屬性
      if (ec.name === '稜鏡能量' && !hostIsEvolution) return true;
      // 新衝天能量 on Stage2 host → 全屬性（夠讚狗是 Basic 所以不適用，保留邏輯為他卡參考）
      // 古舊能量 → 單張即全屬性
      if (ec.name === '古舊能量' || ec.name === '夜光能量') return true;
      // 火箭隊能量 → 提供 Psychic/Darkness
      if (ec.name === '火箭隊能量') return true;
      return false;
    });
    if (hasDark) hp += 100;
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
    const hp = effectiveHPInline(c, pool, state);
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
export function hitBenchPickPost(
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
  // v2.22 對戰圓形競技場：針對「對手備戰」的招式效果全部跳過
  if (targetIdx !== actorIdx && isBenchProtected(st, pool)) {
    return addLog(st, `${label}：對戰圓形競技場效果 — 對手備戰不受此效果傷害`, actorIdx);
  }
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
    const hp = effectiveHPInline(c, pool, st);
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
  // v2.46 狙擊羽毛 = 招式【傷害】→ 不受對戰圓形影響；只受花之帷幔（備戰 + 非 ex）擋
  if (!isActive) {
    const g = resolveBenchGuard(st, pool, actorIdx, targetCard, 'attack-damage');
    if (g.blocked) {
      const name = targetCard?.name ?? '?';
      return addLog(st, `狙擊羽毛：${name} 因${g.reason}不受傷害`, actorIdx);
    }
  }

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
      if (sameEvoName(p.name, card.evolvesFrom) && p.supertype === 'Pokemon' && p.evolvesFrom) return true;
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
    // v2.40：卡面僅限基本能量；原本寫 'Energy' 會讓 UI 列出 Special Energy。
    filter: 'BasicEnergy',
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
// 道具卡（Tool Card）附加 — v2.09 搬到 effects/cards/tools.ts
// ══════════════════════════════════════════════════════════════════════════════
// toolAttachEffect helper、reg('氣球'/'龐克頭盔')、regR('attach-tool') 以及
// TOOL_* 所有登錄均已搬遷。見 effects/cards/tools.ts 與本檔頂部的 side-effect
// import './effects/cards/tools'。

// ══════════════════════════════════════════════════════════════════════════════
// 神奇糖果（Rare Candy）
// ══════════════════════════════════════════════════════════════════════════════

// 神奇糖果 Guard：手牌中有「Stage2」且場上有其對應 Basic 目標才可打出
regG('神奇糖果', (st, idx, pool) => {
  const p = st.players[idx];
  const isStage2 = (c?: Card) => {
    if (!c || c.supertype !== 'Pokemon' || !c.evolvesFrom) return false;
    for (const x of pool.values()) {
      if (sameEvoName(x.name, c.evolvesFrom) && x.supertype === 'Pokemon' && x.evolvesFrom) return true;
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
      if (sameEvoName(c.name, s2.evolvesFrom) && c.supertype === 'Pokemon' && c.evolvesFrom) {
        basicName = c.evolvesFrom;
        break;
      }
    }
    if (!basicName) return false;
    return fieldPokes.some(pk => {
      const bc = pool.get(pk.cardId);
      return !!bc && sameEvoName(bc.name, basicName) && !pk.justPlaced && !pk.evolvedThisTurn;
    });
  });
});

reg('神奇糖果', (st, idx, pool) => {
  const p = st.players[idx];
  // 只列出手牌中的「Stage2」寶可夢（含 Stage2 ex）
  const isStage2 = (c?: Card) => {
    if (!c || c.supertype !== 'Pokemon' || !c.evolvesFrom) return false;
    for (const x of pool.values()) {
      if (sameEvoName(x.name, c.evolvesFrom) && x.supertype === 'Pokemon' && x.evolvesFrom) return true;
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
    if (sameEvoName(c.name, stage1Name) && c.evolvesFrom) { basicName = c.evolvesFrom; break; }
  }
  // Fallback: stage2 directly evolvesFrom a basic
  if (!basicName) basicName = stage1Name;

  const fieldPokes = [...(p.active ? [p.active] : []), ...p.bench];
  const validIids = fieldPokes
    .filter(pk => {
      if (pk.justPlaced || pk.evolvedThisTurn) return false;
      const c = pool.get(pk.cardId);
      return !!c && (sameEvoName(c.name, basicName) || sameEvoName(c.name, stage1Name));
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
// 神秘花園（Stadium）→ v2.10 搬到 effects/cards/stadiums.ts
// ══════════════════════════════════════════════════════════════════════════════
// miracle-garden-draw regR 已移至 stadiums.ts

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

// ABILITY_EFFECTS / regA 已於 v2.64 搬到 ./effects/_shared.ts，
// 本檔於最上方 import 並 re-export。

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
    // v2.08：離開戰鬥場清狀態旗標（新上場 active 的中毒已在 newActive 設定）
    newBench[bIdx] = clearActiveEffects(p.active);
    return { ...p, active: newActive, bench: newBench };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MC 破空焰ex — 火牌組預組主力（Session 24）
// ══════════════════════════════════════════════════════════════════════════════

// 烈火爆進 — 260 傷害，使用後本場上的這隻寶可夢無法再使用「烈火爆進」
// v2.159：升級為 blockedAttackNamesNextTurn 鎖招式名（之前用 cantAttackPending 鎖整隻過嚴）
regPost('破空焰ex|烈火爆進', (state, aIdx, _pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (p.active) {
    const cur = p.active.blockedAttackNamesNextTurn ?? [];
    p.active = { ...p.active, blockedAttackNamesNextTurn: [...cur, '烈火爆進'] };
  }
  players[aIdx] = p;
  return addLog({ ...state, players }, '烈火爆進：下回合無法再使用「烈火爆進」', aIdx);
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
    // v2.08：離開戰鬥場清狀態旗標
    newBench[bIdx] = clearActiveEffects(p.active);
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

/**
 * v2.91：檢查指定 CardInstance 是否對「混亂」免疫。
 * 目前只有 呆呆獸｜憨憨臉（卡面：「這隻寶可夢不會【混亂】」）。
 */
function isConfusionImmune(inst: CardInstance | null, pool: Map<string, Card>): boolean {
  if (!inst) return false;
  const card = pool.get(inst.cardId);
  return !!card?.abilities?.some(a => a.name === '憨憨臉');
}

/**
 * v2.92：檢查防禦方（戰鬥寶可夢）是否因附帶「硬岩【鬥】能量」而免疫對手招式效果。
 * 卡面：「附有這張卡的【鬥】寶可夢不會受到對手的寶可夢使用招式的效果的影響。
 *        （已經受到的效果不會消除。）」
 * 規則：
 *   - 已經施加的效果（例如目前的【中毒】）不會因附上此卡而消除 — 僅在效果施加時阻擋。
 *   - 「招式的效果」不含招式本身的傷害（此能量只擋效果）；呼叫端的
 *     regPost/statusPost 會 check 這個 shield 再決定是否施加。
 *   - 僅防禦方卡本體為 pokemonType === 'Fighting' 時才成立（卡面明寫「【鬥】寶可夢」）。
 *
 * v2.138 擴充：加入「薄霧能量」— 卡面「附有的寶可夢不受對手招式效果影響」，無屬性條件。
 *
 * 呼叫時機：defender-targeting POST effect（statusPost、coinStatusPost 等）在施加前檢查。
 */
function hasEffectShield(inst: CardInstance | null, pool: Map<string, Card>): boolean {
  if (!inst) return false;
  // 薄霧能量 — 無屬性條件，附了就免疫
  if (inst.energyAttached.some(e => pool.get(e.cardId)?.name === '薄霧能量')) return true;
  // v2.150 皇帝之勢（帝王拿波ex）— 寶可夢本身的特性，不會受到對手招式效果的影響
  const card = pool.get(inst.cardId);
  if (card?.abilities?.some(a => a.name === '皇帝之勢')) return true;
  // 硬岩【鬥】能量 — 限【鬥】寶可夢
  if (!card || card.pokemonType !== 'Fighting') return false;
  return inst.energyAttached.some(e => {
    const ec = pool.get(e.cardId);
    return ec?.name === '硬岩【鬥】能量';
  });
}

/**
 * v2.175 — Special Energy 狀態免疫判定
 * holder 身上若附有 STATUS_IMMUNE 命中該狀態的特殊能量，回傳 immune（與卡名）。
 */
export function checkSpecialEnergyStatusImmune(
  inst: CardInstance,
  status: SpecialCondition,
  pool: Map<string, Card>,
): { immune: true; energyName: string } | { immune: false } {
  const holderCard = pool.get(inst.cardId);
  if (!holderCard) return { immune: false };
  for (const e of inst.energyAttached) {
    const ec = pool.get(e.cardId);
    if (!ec) continue;
    const fn = SPECIAL_ENERGY_STATUS_IMMUNE.get(ec.name);
    if (!fn) continue;
    const set = fn(holderCard);
    if (set.has(status)) return { immune: true, energyName: ec.name };
  }
  return { immune: false };
}

/** 讓對手戰鬥寶可夢陷入指定狀態的 POST effect */
function statusPost(status: 'poisoned' | 'burned' | 'asleep' | 'confused' | 'paralyzed'): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (!def.active) return state;
    const defName = pool.get(def.active.cardId)?.name ?? '?';
    // v2.91：憨憨臉免疫混亂
    if (status === 'confused' && isConfusionImmune(def.active, pool)) {
      return addLog(state, `${defName}｜憨憨臉：免疫【混亂】`, aIdx);
    }
    // v2.92：硬岩【鬥】能量 — 對手招式效果完全免疫（對防禦方 status 施加）
    if (hasEffectShield(def.active, pool)) {
      return addLog(state, `${defName}｜硬岩【鬥】能量：免疫招式效果`, aIdx);
    }
    // v2.175：泡沫【水】能量 — 對指定狀態免疫
    const immune = checkSpecialEnergyStatusImmune(def.active, status, pool);
    if (immune.immune) {
      const statusLabelImmune: Record<string, string> = {
        poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
      };
      return addLog(state, `${defName}｜${immune.energyName}：免疫【${statusLabelImmune[status]}】`, aIdx);
    }
    const statusLabelMap: Record<string, string> = {
      poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
    };
    def.active = { ...def.active, status };
    players[dIdx] = def;
    return addLog({ ...state, players }, `${defName} 陷入【${statusLabelMap[status]}】`, aIdx);
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
regPost('修建老匠|暴走', (state, aIdx, pool) => {
  // v2.91：憨憨臉免疫混亂
  if (isConfusionImmune(state.players[aIdx].active, pool)) {
    const name = pool.get(state.players[aIdx].active!.cardId)?.name ?? '?';
    return addLog(state, `${name}｜憨憨臉：免疫【混亂】`, aIdx);
  }
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
  return (state, aIdx, pool) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (!att.active) return state;
    const attName = pool.get(att.active.cardId)?.name ?? '?';
    att.active = { ...att.active, damage: att.active.damage + amount };
    players[aIdx] = att;
    return addLog({ ...state, players }, `${attName} 自身受到 ${amount} 點傷害`, aIdx);
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
// 鐵骨土人|蠻力：base 50 + 若希望 +30 + 自傷 30
// v2.159：升級為 modal-choice — 用 ATTACK_PRE_DISCARD_CHOICE 借殼讓 UI 彈出能量挑選
//   作為 binary 選擇（選 0 個 = 不執行；選 ≥1 個 = 執行 +30 自傷 30）
//   雖 base 卡面是「自傷」非「棄能量」，但 UX 上這是「玩家選 yes/no」最簡實現
//   實際邏輯在 PRE 處理：選了 = +30 + 自傷 30；沒選 = 純 50 不自傷
ATTACK_PRE_DISCARD_CHOICE.set('鐵骨土人|蠻力', {
  min: 0, max: null, scope: 'attacker', baseDamage: 0, damagePerEnergy: 0,
});
regPre('鐵骨土人|蠻力', (state, aIdx, _pool, action) => {
  const chosen = action?.discardedEnergyIids ?? [];
  if (chosen.length === 0) {
    return { state: addLog(state, '蠻力：未選增傷 → 50', aIdx), damage: 50 };
  }
  // 玩家選了 ≥1 個 → 執行 +30 + 自傷 30（不真棄能量，僅當作 binary 旗標）
  const s = addLog(state, '蠻力：增傷 +30，自傷 30 → 80', aIdx);
  return { state: s, damage: 80 };
});
regPost('鐵骨土人|蠻力', (state, aIdx, pool, action) => {
  const chosen = action?.discardedEnergyIids ?? [];
  if (chosen.length === 0) return state;
  // 自傷 30（共用既有 helper）
  return selfHitPost(30)(state, aIdx, pool);
});

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

// 覺醒戰鼓 — 抽與自己場上「古代」寶可夢相同數量的卡
// v2.67：改用真正的 card.tags 查詢（v2.48 太晶 tag 同 pattern）。
reg('覺醒戰鼓', (st, idx, pool) => {
  const count = countAncientOnField(st, idx, pool);
  if (count === 0) {
    return addLog(st, '覺醒戰鼓：場上無「古代」寶可夢，抽 0 張', idx);
  }
  st = addLog(st, `覺醒戰鼓：場上 ${count} 隻「古代」寶可夢 → 抽 ${count} 張`, idx);
  return updatePlayer(st, idx, pl => {
    const taken = pl.deck.slice(0, count);
    return { ...pl, deck: pl.deck.slice(count), hand: [...pl.hand, ...taken] };
  });
});

// 賽吉（支援者）— v2.138 完整實裝
// 卡面：從牌庫選 1 張可進化自己場上某隻寶可夢的【1 階】或【2 階】寶可夢，直接進化（無視 justPlaced）。
// 流程：deck-search filter='Evolution'，玩家挑 1 → resolver 找場上能進化的目標自動進化。
//   sim/AI 端 fallback：若候選有多個（對手場上 active+bench 同時可進化），挑 active 為主。
regG('賽吉', (st, idx, pool) => {
  if (st.players[idx].deck.length === 0) return false;
  // 場上至少要有 1 隻能進化的寶可夢（active+bench）
  const all = [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);
  if (all.length === 0) return false;
  // 牌庫有任何進化卡，且該前階在場上
  const ownNames = new Set(all.map(c => pool.get(c.cardId)?.name ?? ''));
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return !!card?.evolvesFrom && ownNames.has(card.evolvesFrom);
  });
});
reg('賽吉', (st, idx, pool) => {
  const player = st.players[idx];
  const all = [player.active, ...player.bench].filter((c): c is CardInstance => !!c);
  const ownNames = new Set(all.map(c => pool.get(c.cardId)?.name ?? ''));
  // filter 用 'Evolution'（已支援）— 但要再 narrow 為「前階在場上」
  // 實作：只列出可實際進化的候選 iid
  const validIids = player.deck.filter(c => {
    const card = pool.get(c.cardId);
    return !!card?.evolvesFrom && ownNames.has(card.evolvesFrom);
  }).map(c => c.iid);
  if (validIids.length === 0) return addLog(st, '賽吉：牌庫無可進化的進化卡', idx);
  st = addLog(st, '賽吉：從牌庫選 1 張可進化自己場上寶可夢的進化卡，直接進化', idx);
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Evolution', minCount: 0, maxCount: 1,
    effectKey: 'sage-evolve',
    params: { validIids },
  });
});
regR('sage-evolve', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(state, '賽吉：未選擇進化卡', aIdx);
  }
  const evoIid = iids[0];
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  // 從牌庫取出進化卡
  const evoIdx = p.deck.findIndex(c => c.iid === evoIid);
  if (evoIdx < 0) return addLog(state, '賽吉：找不到所選進化卡', aIdx);
  const evoInst = p.deck[evoIdx];
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard?.evolvesFrom) return addLog(state, '賽吉：所選非進化卡', aIdx);

  // 找場上能進化的目標 — active 優先
  const tryEvolve = (target: CardInstance | null): CardInstance | null => {
    if (!target) return null;
    if (pool.get(target.cardId)?.name !== evoCard.evolvesFrom) return null;
    return {
      ...evoInst,
      iid: target.iid,
      damage: target.damage,
      energyAttached: target.energyAttached,
      toolAttached: target.toolAttached,
      status: target.status,
      evolvedFromStack: [...(target.evolvedFromStack ?? []), { ...target,
        toolAttached: undefined, energyAttached: [], evolvedFromStack: undefined }],
      evolvedThisTurn: true,
      // 賽吉特殊：覆寫 justPlaced（賽吉允許剛上場立刻進化）
      justPlaced: undefined,
      movedToActiveThisTurn: undefined,
      cantAttackThisTurn: undefined,
      cantAttackPending: undefined,
      cantRetreatNextTurn: undefined,
      cantRetreatPendingSelf: undefined,
      damageBonusThisTurn: undefined,
      damageBonusPending: undefined,
      damageReduceNextHit: undefined,
      blockedAttackNamesThisTurn: undefined,
      blockedAttackNamesNextTurn: undefined,
      abilityUsedThisTurn: undefined,
    };
  };
  let evolvedActive = tryEvolve(p.active);
  if (evolvedActive) {
    p.active = evolvedActive;
  } else {
    const benchIdx = p.bench.findIndex(b => pool.get(b.cardId)?.name === evoCard.evolvesFrom);
    if (benchIdx < 0) return addLog(state, `賽吉：場上無「${evoCard.evolvesFrom}」可進化`, aIdx);
    const evolved = tryEvolve(p.bench[benchIdx]);
    if (!evolved) return addLog(state, '賽吉：進化處理失敗', aIdx);
    p.bench = [...p.bench];
    p.bench[benchIdx] = evolved;
  }
  // 從牌庫移除進化卡 + 重洗
  p.deck = shuffle(p.deck.filter((_, i) => i !== evoIdx));
  players[aIdx] = p;
  s = { ...s, players };
  return addLog(s, `賽吉：將 ${evoCard.name} 進化於場上的「${evoCard.evolvesFrom}」並重洗牌庫`, aIdx);
});

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
  return (state, aIdx, pool) => {
    const heads = Math.random() < 0.5;
    if (!heads) return addLog(state, '反面', aIdx);
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (!def.active) return state;
    // v2.91：憨憨臉免疫混亂
    if (status === 'confused' && isConfusionImmune(def.active, pool)) {
      const name = pool.get(def.active.cardId)?.name ?? '?';
      return addLog(state, `正面！但 ${name}｜憨憨臉：免疫【混亂】`, aIdx);
    }
    // v2.92：硬岩【鬥】能量 — 對手招式效果完全免疫
    if (hasEffectShield(def.active, pool)) {
      const name = pool.get(def.active.cardId)?.name ?? '?';
      return addLog(state, `正面！但 ${name}｜硬岩【鬥】能量：免疫招式效果`, aIdx);
    }
    def.active = { ...def.active, status };
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
  ['堅硬身軀', 20],     // v2.217 鐵殼蛹（J） — 受招式傷害 -20
]);

/**
 * Wave 42：攻擊方場上的被動特性「+N 攻擊傷害」查表。
 * 特性名 → (attackerCard) => 是否對此攻擊者生效 & 加多少傷害。
 * engine 在 weakness 之前、已過 skipWeakRes/skipDefEffects 判斷區塊之外套用（屬於攻擊方效果，不受 skipDefEffects 影響）。
 * 多個來源可疊加（例如場上同時有 2 隻羅絲雷朵），以擁有特性的 Pokemon 張數乘算。
 */
// v2.133：簽名擴充 — 第二參數加入 defenderCard 讓某些被動能依對手卡片資訊判定加成
//   （原本 1-arg 的條目仍兼容；新加入的條目可選擇用第二參數）
export const PASSIVE_ATTACK_BONUS = new Map<string, (attackerCard: Card, defenderCard?: Card) => number>([
  // 竹蘭的羅絲雷朵｜輝煌聲援 — 只要這隻在場上，自己「竹蘭的」寶可夢招式傷害 +30
  ['輝煌聲援', (att) => att.name.includes('竹蘭的') ? 30 : 0],
  // v2.133 電蜘蛛｜複眼 — 自己的「電蜘蛛」攻擊時，對「擁有特性」的對手戰鬥場 +50
  //   只在 attacker 真的是電蜘蛛時觸發（避免另一隻電蜘蛛在備戰也疊加）
  ['複眼', (att, def) => {
    if (att.name !== '電蜘蛛') return 0;
    return (def?.abilities && def.abilities.length > 0) ? 50 : 0;
  }],
  // v2.154 鐵頭殼ex｜鈷藍指令 — 只要場上，自己「未來」寶可夢（鐵頭殼ex 除外）+20 傷害
  //   engine 在 attacker 場上每張卡都會檢查 abilities → 鐵頭殼ex 觸發此項
  //   bonus 套用到 attacker 卡 (att 是攻擊發動者本人，不是 鐵頭殼ex 自己)
  ['鈷藍指令', (att) => {
    if (att.name === '鐵頭殼ex') return 0;  // 鐵頭殼ex 自己除外
    return att.tags?.includes('未來') ? 20 : 0;
  }],
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
// Stadium resolvers → v2.10 搬到 effects/cards/stadiums.ts
// ══════════════════════════════════════════════════════════════════════════════
// night-academy-top / moonlight-hill-heal regR 已移至 stadiums.ts

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
  // v2.217 布里卡隆（J）｜尖刺盔甲 — 受到傷害時，將「自己身上【草】能量數×3」個傷害指示物
  // 放置於攻擊者身上。換算：N 張草能量 → N × 3 × 10 = N × 30 傷害。
  // 注意：是「能量卡張數」而非「能量單位數」（一張能量卡通常 = 1 個能量單位）。
  ['尖刺盔甲', (state, dIdx, pool) => {
    const aIdx = (1 - dIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def) return state;
    const grassCount = def.energyAttached.filter(e => {
      const ec = pool.get(e.cardId);
      if (!ec || ec.supertype !== 'Energy') return false;
      // 基本【草】能量
      if (ec.subtype === 'Basic' && (ec.pokemonType === 'Grass' || /【草】/.test(ec.name))) return true;
      // 特殊能量帶 Grass type（例：可挾持的 special grass energy）
      if (ec.pokemonType === 'Grass') return true;
      return false;
    }).length;
    if (grassCount === 0) return state;
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) {
      const dmg = grassCount * 30;
      att.active = { ...att.active, damage: att.active.damage + dmg };
      players[aIdx] = att;
      const defName = pool.get(def.cardId)?.name ?? '?';
      const attName = pool.get(att.active.cardId)?.name ?? '?';
      return addLog({ ...state, players },
        `尖刺盔甲：${defName} 草能量 ${grassCount} 張 → 對 ${attName} 造成 ${dmg} 傷害（${grassCount}×3 個傷害指示物）`,
        dIdx);
    }
    return state;
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

// 危險光線 — 對手戰鬥寶可夢同時陷入【灼傷】+【混亂】（v2.163 完整實裝）
// 約定：行動類狀態（混亂）放 status 主格；傷害類狀態（灼傷）放 secondaryStatus。
// 引擎 checkup 會掃兩格做毒/灼判定；攻擊前的混亂擲幣只看 status 主格。
regG('危險光線', (st, idx) => !!st.players[(1-idx) as 0|1].active);
reg('危險光線', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const players = [...st.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  if (def.active) {
    const defName = pool.get(def.active.cardId)?.name ?? '?';
    // v2.175：泡沫【水】等 SPECIAL_ENERGY_STATUS_IMMUNE 命中 → 對應狀態忽略
    const immBurn = checkSpecialEnergyStatusImmune(def.active, 'burned', pool);
    const immConf = checkSpecialEnergyStatusImmune(def.active, 'confused', pool);
    if (immBurn.immune && immConf.immune) {
      return addLog(st, `危險光線：${defName} 對【灼傷】【混亂】皆免疫`, idx);
    }
    if (immBurn.immune) {
      def.active = { ...def.active, status: 'confused' };
      players[dIdx] = def;
      const s = addLog({ ...st, players }, `${defName}｜${immBurn.energyName}：免疫【灼傷】`, idx);
      return addLog(s, `危險光線：${defName} 陷入【混亂】`, idx);
    }
    if (immConf.immune) {
      def.active = { ...def.active, status: 'burned' };
      players[dIdx] = def;
      const s = addLog({ ...st, players }, `${defName}｜${immConf.energyName}：免疫【混亂】`, idx);
      return addLog(s, `危險光線：${defName} 陷入【灼傷】`, idx);
    }
    def.active = { ...def.active, status: 'confused', secondaryStatus: 'burned' };
    players[dIdx] = def;
    return addLog({ ...st, players }, `危險光線：${defName} 陷入【灼傷】+【混亂】`, idx);
  }
  players[dIdx] = def;
  return st;
});

// 推理組合 — 卡面：看牌庫頂 3 張，二選一：(A) 以任意順序排列放回頂；(B) 全部翻反洗回底
// v2.164：完整實裝（modal-choice 二選一 → A 路徑開 reorder-deck-top）
regG('推理組合', (st, idx) => st.players[idx].deck.length > 0);
reg('推理組合', (st, idx, _pool) => {
  const topN = Math.min(3, st.players[idx].deck.length);
  st = addLog(st, `推理組合：選擇處理牌庫頂 ${topN} 張的方式`, idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'inference-combination-choice',
    params: {
      label: '推理組合',
      options: [
        { id: 'reorder', text: `①以任意順序排列頂 ${topN} 張，放回牌庫上方` },
        { id: 'shuffle-bottom', text: `②將頂 ${topN} 張翻反並重洗，放回牌庫下方` },
      ],
    },
  });
});
regR('inference-combination-choice', (state, aIdx, iids, _params, _pool) => {
  const choice = iids[0];
  const player = state.players[aIdx];
  const topN = Math.min(3, player.deck.length);
  const topCards = player.deck.slice(0, topN);
  if (choice === 'shuffle-bottom') {
    // (B) 全部翻反洗回底
    state = addLog(state, `推理組合：將牌庫頂 ${topN} 張翻反並重洗放回下方`, aIdx);
    return updatePlayer(state, aIdx, p => {
      const rest = p.deck.slice(topN);
      return { ...p, deck: [...shuffle(rest), ...shuffle(topCards)] };
    });
  }
  // (A) 排序放回頂 — 開 reorder-deck-top picker
  state = addLog(state, `推理組合：排序牌庫頂 ${topN} 張`, aIdx);
  return withPending(state, {
    type: 'reorder-deck-top',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: topN, maxCount: topN,  // 必須全部保留
    effectKey: 'reorder-deck-top-apply',
    params: {
      candidateIids: topCards.map(c => c.iid),
      allowDiscard: false,
      titleOverride: '推理組合：排序牌庫頂',
    },
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
// v2.43 修：卡面寫「寶可夢卡與『基本能量』卡合計最多5張」，原本 filter: 'PokemonOrEnergy'
// （含 Special Energy）違反卡面。改成 PokemonOrBasicEnergy；guard 也比照調整。
regG('釣竿MAX', (st, idx, pool) =>
  st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Pokemon') return true;
    if (card?.supertype === 'Energy' && card.subtype === 'Basic') return true;
    return false;
  })
);
reg('釣竿MAX', (st, idx) => {
  st = addLog(st, '釣竿MAX：從棄牌選最多 5 張寶可夢或基本能量加手牌', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonOrBasicEnergy', minCount: 0, maxCount: 5,
    effectKey: 'discard-to-hand',
  });
});

// 超級能量回收 — 丟 2 手牌 + 棄牌取最多 4 張基本能量
// v2.43 修：guard 原本寫 supertype==='Energy'（含 Special Energy）— 只剩 Special Energy 時
// 仍會讓 UI 顯示「可打出」，但 step2 的 BasicEnergy filter 會讓玩家卡在空選擇上。
regG('超級能量回收', (st, idx, pool) =>
  st.players[idx].hand.length >= 3 &&
  st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  })
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

// 蕾荷 — 卡面：看牌庫頂 5 張，選任意數量丟棄；剩餘以任意順序排列放回牌庫上方
// v2.164：完整實裝（reorder-deck-top with allowDiscard=true）
regG('蕾荷', (st, idx) => st.players[idx].deck.length > 0);
reg('蕾荷', (st, idx, _pool) => {
  const player = st.players[idx];
  const topN = Math.min(5, player.deck.length);
  const topCards = player.deck.slice(0, topN);
  st = addLog(st, `蕾荷：查看牌庫頂 ${topN} 張，選擇丟棄哪些並排序剩餘`, idx);
  return withPending(st, {
    type: 'reorder-deck-top',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: topN,  // 玩家可全丟（保留 0 張）也可全留
    effectKey: 'reorder-deck-top-apply',
    params: {
      candidateIids: topCards.map(c => c.iid),
      allowDiscard: true,
      titleOverride: '蕾荷：丟棄+排序',
    },
  });
});

// ── 共用 resolver：reorder-deck-top-apply ────────────────────────────────────
// 玩家把 selectedIids 視為「保留並排序的 iid 列表」（index 0 = top of deck after apply）
// allowDiscard：未列出的 candidateIid 視為丟棄；否則 safety net 強行附在尾部保留
regR('reorder-deck-top-apply', (state, aIdx, iids, params, pool) => {
  const candidateIids = (params?.candidateIids as string[] | undefined) ?? [];
  const allowDiscard = (params?.allowDiscard as boolean | undefined) ?? false;
  if (candidateIids.length === 0) return state;
  const candidateSet = new Set(candidateIids);
  // 過濾 selectedIids：只保留屬於候選且去重
  const seen = new Set<string>();
  const orderedKeep: string[] = [];
  for (const id of iids) {
    if (candidateSet.has(id) && !seen.has(id)) {
      seen.add(id);
      orderedKeep.push(id);
    }
  }
  const missingIds = candidateIids.filter(id => !seen.has(id));
  const discardIids: string[] = allowDiscard ? missingIds : [];
  // 非允許丟棄時，玩家漏選的 iid 強行附在尾部維持原順序，避免遺失牌
  const safetyAppend: string[] = allowDiscard ? [] : missingIds;
  const finalKeep = [...orderedKeep, ...safetyAppend];

  // 先取得卡名（在 mutate state 前讀 deck top N 對應 cardId）
  const N = candidateIids.length;
  const topByIid = new Map<string, CardInstance>();
  for (const c of state.players[aIdx].deck.slice(0, N)) topByIid.set(c.iid, c);
  const ownerNames = finalKeep.map(id => {
    const c = topByIid.get(id);
    return c ? (pool.get(c.cardId)?.name ?? '?') : '?';
  });
  const discardNames = discardIids.map(id => {
    const c = topByIid.get(id);
    return c ? (pool.get(c.cardId)?.name ?? '?') : '?';
  });

  // 套用：deck 頂 N 張替換成排序後的 keep；discard 加上丟棄的 inst
  let newState = updatePlayer(state, aIdx, p => {
    const remaining = p.deck.slice(N);
    const keepInsts = finalKeep.map(id => topByIid.get(id)).filter((x): x is CardInstance => !!x);
    const discardInsts = discardIids.map(id => topByIid.get(id)).filter((x): x is CardInstance => !!x);
    return { ...p, deck: [...keepInsts, ...remaining], discard: [...p.discard, ...discardInsts] };
  });

  // log（公開 = 數量；私訊 = 順序與被丟棄的卡名）
  const publicBits: string[] = [];
  publicBits.push(`保留並排序牌庫頂 ${finalKeep.length} 張`);
  if (discardIids.length > 0) publicBits.push(`丟棄 ${discardIids.length} 張`);
  const privateBits: string[] = [];
  if (finalKeep.length > 0) privateBits.push(`頂部順序：${ownerNames.join(' → ')}`);
  if (discardNames.length > 0) privateBits.push(`丟棄：${discardNames.join('、')}`);
  const publicMsg = publicBits.join('；');
  if (privateBits.length > 0) {
    return addPrivateLog(newState, `${publicMsg}（${privateBits.join('；')}）`, publicMsg, aIdx);
  }
  return addLog(newState, publicMsg, aIdx);
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

// 吉雉雞ex 扭轉乾坤 — 「上個對手的回合自己的寶可夢昏厥了」才可用，抽 3
//
// v2.15 (Session 38bc)：改用與不公印章相同的判定基準
//   舊版簡化為「棄牌區有寶可夢」，但這在 setup/mulligan 後就永遠成立，條件形同失效。
//   新版用 oppPrizesAtMyLastTurnEnd snapshot vs 目前對手獎賞數：
//     - snap = 上次自己回合結束時對手剩餘獎賞數
//     - 若對手目前獎賞 < snap → 對手在他們剛結束的回合取過獎賞
//     - 取獎賞 = 擊倒了我方寶可夢 → 可用
//   getUsableAbilities 也有對應 guard（engine.ts），UI 上會直接反白按鈕。
regA('吉雉雞ex', 0, (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const snap = st.oppPrizesAtMyLastTurnEnd?.[idx] ?? 6;
  if (st.players[oppIdx].prizes.length >= snap) {
    return addLog(st, '扭轉乾坤：上回合自己沒有寶可夢昏厥，無法使用', idx);
  }
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

// 螺釘地鼠｜狂挖 — 從手牌將這張卡放置於備戰區的那個回合可用 1 次。
//   牌庫選最多 3 張基本【鬥】能量丟棄並重洗。
// v2.126 修：
//   1) 用 deck-search pending 讓玩家選 0~3 張（卡面「最多 3 張」表示可選 0 張）
//   2) filter 改 'Energy:Fighting'（基本能量 pokemonType 常為 undefined，UI 會用 name fallback）
//   3) gate「必須剛從手牌放置」(pk.justPlaced) 在 engine.ts getUsableAbilities 加
regA('螺釘地鼠', 0, (st, idx, pool) => {
  // 牌庫無基本【鬥】能量 → 直接結束（卡面允許 0 張，但實質沒選頭）
  // 基本能量 pokemonType 常為 undefined，從卡名【鬥】判斷才對
  const hasFightE = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
    return card.pokemonType === 'Fighting' || /【鬥】/.test(card.name);
  });
  if (!hasFightE) {
    return addLog(st, '狂挖：牌庫無基本【鬥】能量', idx);
  }
  st = addLog(st, '狂挖：從牌庫選 0~3 張基本【鬥】能量丟棄（之後重洗）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Fighting',
    minCount: 0, maxCount: 3,
    effectKey: 'screwdig-discard-fight-e',
  });
});
regR('screwdig-discard-fight-e', (state, aIdx, selectedIids, _params, pool) => {
  const picks = state.players[aIdx].deck.filter(c => selectedIids.includes(c.iid));
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    deck: shuffle(p.deck.filter(c => !selectedIids.includes(c.iid))),
    discard: [...p.discard, ...picks],
  }));
  const msg = picks.length > 0
    ? `狂挖：丟棄 ${picks.length} 張基本【鬥】能量（${names}），重洗牌庫`
    : '狂挖：未選能量，重洗牌庫';
  return addLog(s, msg, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 33 — 寶可夢道具（Tool）效果登錄表 — v2.09 搬到 effects/cards/tools.ts
// ══════════════════════════════════════════════════════════════════════════════
// TOOL_HP_BONUS / TOOL_ATTACK_BONUS / TOOL_DEFENSE_REDUCE_BY_TYPE /
// TOOL_PREVENT_KO / TOOL_ON_KO / TOOL_PRIZE_BONUS / TOOL_ON_DAMAGED /
// TOOL_RETREAT_MOD / TOOL_BOTH_SIDES_RETREAT_PLUS 以及每張道具的 entry、
// 自動登記 attach effect 區塊，全部移到 effects/cards/tools.ts；由本檔頂部
// 的 side-effect import 觸發登錄。effects.ts 仍 re-export TOOL_* 供 engine 用。

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
export function countOppPokemon(state: GameState, aIdx: 0 | 1, pool: Map<string, Card>, filterFn: (c: Card) => boolean): number {
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
  return (state, aIdx, pool) => {
    // v2.91：憨憨臉免疫混亂
    if (isConfusionImmune(state.players[aIdx].active, pool)) {
      const name = pool.get(state.players[aIdx].active!.cardId)?.name ?? '?';
      return addLog(state, `${name}｜憨憨臉：免疫【混亂】`, aIdx);
    }
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

// 鑰圈兒｜插入抽出 — 丟 1 張手牌後抽 2 張
// v2.159：升級為玩家自選棄哪張（之前簡化為隨機）
regPost('鑰圈兒|插入抽出', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.hand.length === 0) {
    // 沒手牌可棄 → 直接抽 2
    return updatePlayer(addLog(state, '插入抽出：手牌為空 → 直接抽 2 張', aIdx), aIdx, p => {
      const take = Math.min(2, p.deck.length);
      return { ...p, hand: [...p.hand, ...p.deck.slice(0, take)], deck: p.deck.slice(take) };
    });
  }
  // 開 hand-discard picker 讓玩家選 1 張手牌棄
  const s = addLog(state, '插入抽出：選 1 張手牌棄置（之後抽 2 張）', aIdx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'insert-and-draw-discard',
  });
});
regR('insert-and-draw-discard', (st, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const targetIid = iids[0];
  return updatePlayer(st, aIdx, p => {
    const discarded = p.hand.find(c => c.iid === targetIid);
    if (!discarded) return p;
    const dname = pool.get(discarded.cardId)?.name ?? '?';
    const newHand = p.hand.filter(c => c.iid !== targetIid);
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
//   - （已修，無效項目移除）懶人獺｜悠哉「這隻寶可夢下回合無法撤退」 — v1.62 後已用
//     cantRetreatPendingSelf 完整實裝，註解早已過期。v2.160 清掉。
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

// ── E. 懶人獺｜悠哉 — heal 60 + 自己下回合不能撤退（cantRetreatPendingSelf）──
regPost('懶人獺|悠哉', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) {
    const newDmg = Math.max(0, att.active.damage - 60);
    att.active = { ...att.active, damage: newDmg, cantRetreatPendingSelf: true };
  }
  players[aIdx] = att;
  return addLog({ ...state, players }, `悠哉：恢復 60 HP，下個自己的回合無法撤退`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38m v1.63 H 標第 8 波 — coin-heads-multiply 批次（24 張）
// 擲 N 次硬幣，正面出現次數 × k 點傷害。
// ══════════════════════════════════════════════════════════════════════════════

export function coinHeadsMultiplyPre(flips: number, perHead: number, attackName: string): AttackPreFn {
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

// 雄偉牙|地盤崩壞 — 0 傷害，丟對手牌庫頂 1 張；該回合用過「古代」支援者則再 +3 張（共 4 張）
// v2.160：補實裝古代支援者條件（用 v2.160 加的 ancientSupporterPlayedThisTurn flag）
regPre('雄偉牙|地盤崩壞', (state, _aIdx, _pool) => {
  return { state, damage: 0 };
});
regPost('雄偉牙|地盤崩壞', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  // 基礎丟 1 張；本回合用過「古代」支援者再 +3 張
  const ancientUsed = state.players[aIdx].ancientSupporterPlayedThisTurn ?? false;
  const targetCount = ancientUsed ? 4 : 1;
  const take = Math.min(targetCount, p.deck.length);
  if (take === 0) return state;
  const discarded = p.deck.slice(0, take);
  const s = addLog(state,
    ancientUsed
      ? `地盤崩壞：本回合已用過「古代」支援者 → 丟對手牌庫頂 ${take} 張（1 + 3）`
      : `地盤崩壞：丟對手牌庫頂 ${take} 張`,
    aIdx);
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

// 故勒頓|撕裂 — 130（不計算對手戰鬥寶可夢身上的附加效果，Session 33 正式實作）
regPre('故勒頓|撕裂', (state, _aIdx, _pool) => {
  return { state, damage: 130, skipDefEffects: true };
});

// 故勒頓|原生亂打 — 30×自己場上「古代」寶可夢數量
// v2.67：實裝（Leon 回報備戰的猛雷鼓沒被計入）。依據 card.tags.includes('古代')
// 計算戰鬥 + 備戰區的古代寶可夢總數。
regPre('故勒頓|原生亂打', (state, aIdx, pool) => {
  const count = countAncientOnField(state, aIdx, pool);
  const damage = 30 * count;
  const s = addLog(
    state,
    `原生亂打：場上 ${count} 隻「古代」寶可夢 → ${damage} 傷害`,
    aIdx,
  );
  return { state: s, damage };
});

// 夠讚狗ex|瘋狂連鎖 — 130 + 若自身中毒則 +130
regPre('夠讚狗ex|瘋狂連鎖', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  if (att && att.status === 'poisoned') {
    return { state: addLog(state, '瘋狂連鎖：自身中毒 → +130', aIdx), damage: 260 };
  }
  return { state, damage: 130 };
});

// 貓頭夜鷹|鉤爪搜尋 — 70 + 若希望從牌庫任選最多 2 張加手牌（重洗）
// v2.159：升級為 deck-search 讓玩家自選（之前簡化為固定抽 2 張）
regPost('貓頭夜鷹|鉤爪搜尋', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '鉤爪搜尋：牌庫為空', aIdx);
  const max = Math.min(2, player.deck.length);
  const s = addLog(state, `鉤爪搜尋：從牌庫選 ≤${max} 張卡加入手牌（重洗）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Any',
    minCount: 0, maxCount: max,
    effectKey: 'search-to-hand-reshuffle',
  });
});

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

// 朽木妖|終極吸取 — 50 傷害 + 自回血 = 實際造成的傷害量
// v2.160：用 state.lastDealtDamage 讀引擎套用後的實際傷害（含弱抗 / 道具減傷）
regPost('朽木妖|終極吸取', (state, aIdx, pool) => {
  const actual = state.lastDealtDamage ?? 0;
  if (actual <= 0) return addLog(state, '終極吸取：實際傷害為 0，不回血', aIdx);
  // 把 actual 傳給 selfHealPost 自製版本
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (!att.active) return state;
  const attName = pool.get(att.active.cardId)?.name ?? '?';
  const newDmg = Math.max(0, att.active.damage - actual);
  const realHeal = att.active.damage - newDmg;
  att.active = { ...att.active, damage: newDmg };
  players[aIdx] = att;
  return addLog({ ...state, players },
    `終極吸取：${attName} 回復 ${realHeal} HP（=本招式造成的 ${actual} 傷害）`, aIdx);
});

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
  // v2.46 精刺奇襲 = 招式【傷害】→ 不受對戰圓形影響；只受花之帷幔擋（備戰 + 非 ex）
  //   實務上 snipe-60-ex 僅能選對手的 ex/EX，花之帷幔不保護 ex，故通常 pass；
  //   仍呼叫 resolveBenchGuard 以保持判定一致性。
  {
    const g = resolveBenchGuard(st, pool, actorIdx, targetCard, 'attack-damage');
    if (g.blocked) {
      const name = targetCard?.name ?? '?';
      return addLog(st, `精刺奇襲：${name} 因${g.reason}不受傷害`, actorIdx);
    }
  }
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

// v2.216 土龍弟弟|尋找朋友（SVM 12165）— 同名招式但卡名不同
// 卡面：「從自己的牌庫選擇 1 張寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。」
// 由 audit-all-preset-effects.mjs 偵測出 — 阿響的火爆獸 preset 用此卡。
regPre('土龍弟弟|尋找朋友', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('土龍弟弟|尋找朋友', (state, aIdx, _pool) => {
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
  // v2.46 電磁電光 = 招式【傷害】→ 不受對戰圓形影響；只受花之帷幔（備戰 + 非 ex）擋
  if (!isActive) {
    const g = resolveBenchGuard(st, pool, actorIdx, targetCard, 'attack-damage');
    if (g.blocked) {
      const name = targetCard?.name ?? '?';
      return addLog(st, `電磁電光：${name} 因${g.reason}不受傷害`, actorIdx);
    }
  }

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
  // v2.22 對戰圓形競技場：備戰不受對手招式/特性傷害指示物，整體跳過
  const benchBlocked = isBenchProtected(s, pool);
  const newBench: CardInstance[] = [];
  for (const b of defender.bench) {
    if (benchBlocked) { newBench.push(b); continue; }
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
  // v2.22 對戰圓形競技場：備戰不受對手招式/特性傷害指示物
  if (!isActive && isBenchProtected(st, pool)) {
    const name = pool.get(target.cardId)?.name ?? '?';
    return addLog(st, `悄聲加害：${name} 因對戰圓形競技場效果不受傷害指示物`, actorIdx);
  }
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
// v2.126 伊裴爾塔爾｜緊抓 20 — 在下個對手回合，受到此招式的寶可夢無法撤退
regPre('伊裴爾塔爾|緊抓', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('伊裴爾塔爾|緊抓', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  if (!def.active) return state;
  const defName = pool.get(def.active.cardId)?.name ?? '?';
  def.active = { ...def.active, cantRetreatNextTurn: true };
  players[dIdx] = def;
  return addLog({ ...state, players },
    `緊抓：${defName} 在下個對手回合無法撤退`, aIdx);
});

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

// 八爪武師|觸手激怒 — 130 plain；v2.161 補實裝動態能量費用
//   卡面：「若這隻寶可夢身上放置有傷害指示物，則這個招式只需要 1 個【鬥】能量即可使用。」
//   實作：engine canAffordAttack 內呼叫 getOctopusTentacleEffectiveCost helper 改寫 cost。
regPre('八爪武師|觸手激怒', (state, _aIdx, _pool) => ({ state, damage: 130 }));

// canAffordAttack hook — 給 engine 呼叫
export function getOctopusTentacleEffectiveCost(
  attackerInst: CardInstance,
  attackerName: string,
  attackName: string,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '八爪武師') return originalCost;
  if (attackName !== '觸手激怒') return originalCost;
  if (attackerInst.damage <= 0) return originalCost;
  // 身上有傷害指示物 → 改為 1 個【鬥】
  return ['Fighting'];
}

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
    // v2.108：若某方場上有大竺葵繁茂，該方寶可夢身上的「基本【草】能量」算 2 個。
    // 萬葉陣雨 rulesText：「雙方戰鬥寶可夢身上附加的能量的數量 × 30」— 按 Leon 解讀，
    // 繁茂倍率應套用於傷害計算（與日版 ruling 可能不一致，但符合 Leon 期待）。
    function hasBloomOnSide(ownerIdx: 0 | 1): boolean {
      const owner = state.players[ownerIdx];
      const allOwn = [...(owner.active ? [owner.active] : []), ...owner.bench];
      return allOwn.some(c => pool.get(c.cardId)?.abilities?.some(ab => ab.name === '繁茂'));
    }
    function isBasicGrass(ec: Card | undefined): boolean {
      if (!ec || ec.supertype !== 'Energy' || ec.subtype !== 'Basic') return false;
      if (ec.pokemonType === 'Grass') return true;
      const m = ec.name.match(/【(.+?)】/);
      return !!m && m[1] === '草';
    }
    function countWithBloom(inst: CardInstance | null | undefined, ownerIdx: 0 | 1): number {
      if (!inst) return 0;
      const bloom = hasBloomOnSide(ownerIdx);
      let n = 0;
      for (const e of inst.energyAttached) {
        const ec = pool.get(e.cardId);
        if (!ec || ec.supertype !== 'Energy') continue;
        if (bloom && isBasicGrass(ec)) n += 2;
        else n += 1;
      }
      return n;
    }
    const count = countWithBloom(a, aIdx) + countWithBloom(d, dIdx);
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
  // v2.46：caller 透過 kind 指定是招式【傷害】還是【效果】（放傷害指示物）。
  // 未指定時預設 'attack-damage' — 絕大多數 snipe-variable 用途都是招式傷害
  // （殘酷箭、落雷風暴、暗影子彈…），只有飛來橫禍等「放指示物」要顯式傳 'attack-effect'。
  const kind = ((params?.kind as DamageKind) ?? 'attack-damage');
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid || dmg === 0) return st;
  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  // v2.46 統一判定：對戰圓形只擋效果；花之帷幔只擋招式傷害到備戰（且非 ex）
  if (!isActive) {
    const g = resolveBenchGuard(st, pool, actorIdx, targetCard, kind);
    if (g.blocked) {
      const name = targetCard?.name ?? '?';
      return addLog(st, `${label}：${name} 因${g.reason}不受傷害`, actorIdx);
    }
  }
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

// ══════════════════════════════════════════════════════════════════════════════
// Session 38u v1.71 H 標第 16 波 — bench-count × multiplier + 能量/手牌 multiplier（~11 張）
//
// Helpers:
//   selfBenchMultiplyPre(base, per, label) — 自己備戰數 × per
//   oppBenchMultiplyPre(base, per, label) — 對手備戰數 × per
//   bothBenchMultiplyPre(base, per, label) — 雙方備戰數總和 × per
// 特殊：
//   熔岩蝸牛ex|大地灼燒 — 雙方牌庫頂各 1 張丟棄，其中能量張數 × 140
//   薩戮德|叢林鞭打 — 自身能量全部收回手牌 → +80（AI 永遠吃加成）
//   吞食獸|張大嘴 — 若自身能量 > 對手戰鬥能量 → +160
//   三海地鼠ex|三色炮 — 自動從手牌丟最多 3 張能量卡，對 opp active 造成 × 60
//   賽富豪ex|淘金潮 — 自動從手牌丟棄全部基本能量，× 50
//   雪童子|驚嚇 — 20 + 對手手牌隨機 1 張回對手牌庫並重洗
// ══════════════════════════════════════════════════════════════════════════════

function selfBenchMultiplyPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const count = state.players[aIdx].bench.length;
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：自己備戰 ${count} 隻 → ${dmg}`, aIdx), damage: dmg };
  };
}

function oppBenchMultiplyPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const count = state.players[dIdx].bench.length;
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：對手備戰 ${count} 隻 → ${dmg}`, aIdx), damage: dmg };
  };
}

export function bothBenchMultiplyPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const count = state.players[aIdx].bench.length + state.players[dIdx].bench.length;
    const dmg = base + per * count;
    return { state: addLog(state, `${label}：雙方備戰 ${count} 隻 → ${dmg}`, aIdx), damage: dmg };
  };
}

// 裹蜜蟲|朋友之環 — 自己備戰數 × 20
regPre('裹蜜蟲|朋友之環', selfBenchMultiplyPre(0, 20, '朋友之環'));

// 厄鬼椪 碧草面具|鬼返 — 20 + 對手備戰數 × 20
regPre('厄鬼椪 碧草面具|鬼返', oppBenchMultiplyPre(20, 20, '鬼返'));

// 捷拉奧拉|鬥戰雷電 — 20 + 對手備戰數 × 20
regPre('捷拉奧拉|鬥戰雷電', oppBenchMultiplyPre(20, 20, '鬥戰雷電'));

// 骨紋巨聲鱷|閃焰獨唱會 — 60 + 雙方備戰數 × 20
regPre('骨紋巨聲鱷|閃焰獨唱會', bothBenchMultiplyPre(60, 20, '閃焰獨唱會'));

// 太樂巴戈斯ex|聯盟擊 — 後攻第一回合不可使用；否則 自己備戰數 × 30
// 「後攻第一回合」判定：active !== firstPlayerIdx 且 turn === 1 + firstPlayerIdx
regPre('太樂巴戈斯ex|聯盟擊', (state, aIdx, _pool) => {
  const isSecondPlayerFirstTurn =
    aIdx !== state.firstPlayerIdx && state.turn === 1 + state.firstPlayerIdx;
  if (isSecondPlayerFirstTurn) {
    return { state: addLog(state, '聯盟擊：後攻第一回合無法使用，招式失敗', aIdx), damage: 0 };
  }
  const count = state.players[aIdx].bench.length;
  const dmg = count * 30;
  return { state: addLog(state, `聯盟擊：自己備戰 ${count} 隻 → ${dmg}`, aIdx), damage: dmg };
});

// 熔岩蝸牛ex|大地灼燒 — 雙方牌庫頂各 1 張丟棄，其中能量張數 × 140，基礎 140
regPre('熔岩蝸牛ex|大地灼燒', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const topA = state.players[aIdx].deck[0];
  const topB = state.players[dIdx].deck[0];
  let energyCount = 0;
  if (topA) {
    const c = pool.get(topA.cardId);
    if (c?.supertype === 'Energy') energyCount++;
  }
  if (topB) {
    const c = pool.get(topB.cardId);
    if (c?.supertype === 'Energy') energyCount++;
  }
  const dmg = 140 + energyCount * 140;
  return { state: addLog(state, `大地灼燒：雙方牌庫頂丟棄 ${energyCount} 張能量 → ${dmg}`, aIdx), damage: dmg };
});
regPost('熔岩蝸牛ex|大地灼燒', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  let s = state;
  for (const idx of [aIdx, dIdx] as (0 | 1)[]) {
    const p = players[idx];
    if (p.deck.length === 0) continue;
    const top = p.deck[0];
    players[idx] = { ...p, deck: p.deck.slice(1), discard: [...p.discard, top] };
  }
  s = { ...s, players };
  return addLog(s, '大地灼燒：雙方牌庫頂 1 張丟入棄牌區', aIdx);
});

// 薩戮德|叢林鞭打 — 基礎 80，若自身有能量則全部收回手牌 +80（AI 永遠吃加成）
regPre('薩戮德|叢林鞭打', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  const hasEnergy = (att?.energyAttached.length ?? 0) > 0;
  const dmg = 80 + (hasEnergy ? 80 : 0);
  return { state: addLog(state, `叢林鞭打：${hasEnergy ? '收回自身能量 → +80，' : ''}${dmg}`, aIdx), damage: dmg };
});
regPost('薩戮德|叢林鞭打', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  if (!att || att.energyAttached.length === 0) return state;
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const energies = p.active.energyAttached;
    return {
      ...p,
      active: { ...p.active, energyAttached: [] },
      hand: [...p.hand, ...energies],
    };
  });
});

// 吞食獸|張大嘴 — 若自身能量 > 對手出場能量 則 +160，基礎 10
regPre('吞食獸|張大嘴', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const selfE = att?.energyAttached.length ?? 0;
  const defE = def?.energyAttached.length ?? 0;
  const bonus = selfE > defE ? 160 : 0;
  const dmg = 10 + bonus;
  return { state: addLog(state, `張大嘴：自能量 ${selfE} vs 對手 ${defE}${bonus ? ' +160' : ''} → ${dmg}`, aIdx), damage: dmg };
});

// 三海地鼠ex|三色炮 — 自動從手牌丟最多 3 張能量卡，× 60，攻擊對手戰鬥寶可夢
// （備戰區不計算弱抗；AI sim 直接打 active 簡化）
regPre('三海地鼠ex|三色炮', (state, aIdx, pool) => {
  const hand = state.players[aIdx].hand;
  const energyInHand = hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy').slice(0, 3);
  const dmg = energyInHand.length * 60;
  return { state: addLog(state, `三色炮：丟棄 ${energyInHand.length} 張能量 → ${dmg}`, aIdx), damage: dmg };
});
regPost('三海地鼠ex|三色炮', (state, aIdx, pool) => {
  return updatePlayer(state, aIdx, p => {
    const toDiscard: CardInstance[] = [];
    let remaining = 3;
    const newHand: CardInstance[] = [];
    for (const c of p.hand) {
      if (remaining > 0 && pool.get(c.cardId)?.supertype === 'Energy') {
        toDiscard.push(c);
        remaining--;
      } else {
        newHand.push(c);
      }
    }
    return { ...p, hand: newHand, discard: [...p.discard, ...toDiscard] };
  });
});

// 賽富豪ex|淘金潮 — 自動從手牌丟棄全部基本能量，× 50
regPre('賽富豪ex|淘金潮', (state, aIdx, pool) => {
  const count = state.players[aIdx].hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }).length;
  const dmg = count * 50;
  return { state: addLog(state, `淘金潮：丟棄 ${count} 張基本能量 → ${dmg}`, aIdx), damage: dmg };
});
regPost('賽富豪ex|淘金潮', (state, aIdx, pool) => {
  return updatePlayer(state, aIdx, p => {
    const discarded: CardInstance[] = [];
    const kept: CardInstance[] = [];
    for (const c of p.hand) {
      const card = pool.get(c.cardId);
      if (card?.supertype === 'Energy' && card.subtype === 'Basic') discarded.push(c);
      else kept.push(c);
    }
    return { ...p, hand: kept, discard: [...p.discard, ...discarded] };
  });
});

// 雪童子|驚嚇 — 傷害 20（pre 不需），post：對手手牌隨機 1 張回牌庫並重洗
regPost('雪童子|驚嚇', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = addLog(state, '驚嚇：對手手牌隨機 1 張返回牌庫並重洗', aIdx);
  return updatePlayer(s, dIdx, p => {
    if (p.hand.length === 0) return p;
    const idx = Math.floor(Math.random() * p.hand.length);
    const picked = p.hand[idx];
    const newHand = p.hand.filter((_, i) => i !== idx);
    return { ...p, hand: newHand, deck: shuffle([...p.deck, picked]) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38v v1.72 H 標第 17 波 — self-discard-N-energy post-attack（26 張）
//
// Helpers:
//   selfDiscardNEnergyPost(n, label) — 攻擊後自身丟 N 張能量（從後往前取）
//   selfDiscardAllEnergyPost(label)  — 攻擊後自身丟全部能量
//
// 全都對應「選擇 N 個這隻寶可夢身上附加的能量，將其丟棄」／「全部丟棄」的招式後效。
// AI sim 與 UI 預設都自動從後往前丟（最近附加的優先丟），夠用又不影響重要先附能量。
// ══════════════════════════════════════════════════════════════════════════════

function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const attName = pool.get(att.cardId)?.name ?? '?';
    const discardCount = Math.min(n, att.energyAttached.length);
    let s = addLog(state, `${label}：${attName} 丟棄 ${discardCount} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - discardCount);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - discardCount);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const attName = pool.get(att.cardId)?.name ?? '?';
    let s = addLog(state, `${label}：${attName} 丟棄全部能量（${att.energyAttached.length} 個）`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const discarded = p.active.energyAttached;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...discarded] };
    });
  };
}

// ── 1 張自身能量（21 張中的 discard 1 部分） ─────────────────────────────────
regPost('四季鹿|落葉衝撞', selfDiscardNEnergyPost(1, '落葉衝撞'));
regPost('捷拉奧拉|強力伏特', selfDiscardNEnergyPost(1, '強力伏特'));
regPost('猛火猴|高溫打擊', selfDiscardNEnergyPost(1, '高溫打擊'));
regPost('烈焰猴|燃燒殆盡', selfDiscardNEnergyPost(1, '燃燒殆盡'));
regPost('冰鬼護|瘋狂頭', selfDiscardNEnergyPost(1, '瘋狂頭'));
regPost('大電海燕|強力伏特', selfDiscardNEnergyPost(1, '強力伏特'));
regPost('晶光芽|岩石射擊', selfDiscardNEnergyPost(1, '岩石射擊'));
regPost('夜盜火蜥|火花', selfDiscardNEnergyPost(1, '火花'));
regPost('焰后蜥|噴射火焰', selfDiscardNEnergyPost(1, '噴射火焰'));
regPost('炭小侍|噴射火焰', selfDiscardNEnergyPost(1, '噴射火焰'));
regPost('請假王ex|偉大橫掃', selfDiscardNEnergyPost(1, '偉大橫掃'));
regPost('尖牙陸鯊|力量爆破', selfDiscardNEnergyPost(1, '力量爆破'));

// ── 2 張自身能量 ─────────────────────────────────────────────────────────────
regPost('鐵磐岩ex|力量踩踏', selfDiscardNEnergyPost(2, '力量踩踏'));
regPost('巨金怪|潔淨爆破', selfDiscardNEnergyPost(2, '潔淨爆破'));
regPost('煤炭龜|火焰旋渦', selfDiscardNEnergyPost(2, '火焰旋渦'));
regPost('爬地翅|粉碎之翼', selfDiscardNEnergyPost(2, '粉碎之翼'));
regPost('長毛巨魔|擊拳', selfDiscardNEnergyPost(2, '擊拳'));
regPost('鋁鋼龍|鋁鋼光束', selfDiscardNEnergyPost(2, '鋁鋼光束'));
regPost('爆炸頭水牛|粉碎頭擊', selfDiscardNEnergyPost(2, '粉碎頭擊'));
regPost('古劍豹|氣忿利刃', selfDiscardNEnergyPost(2, '氣忿利刃'));

// ── 3 張自身能量 ─────────────────────────────────────────────────────────────
regPost('皮卡丘ex|黃玉伏特', selfDiscardNEnergyPost(3, '黃玉伏特'));

// ── 全部自身能量 ─────────────────────────────────────────────────────────────
regPost('閃電鳥|十萬伏特', selfDiscardAllEnergyPost('十萬伏特'));
regPost('燈火幽靈|燃燒盡', selfDiscardAllEnergyPost('燃燒盡'));
regPost('倫琴貓ex|伏特強襲', selfDiscardAllEnergyPost('伏特強襲'));
regPost('齒輪怪|高級光束', selfDiscardAllEnergyPost('高級光束'));
regPost('蒼炎刃鬼ex|紫水晶激怒', selfDiscardAllEnergyPost('紫水晶激怒'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38w v1.73 H 標第 18 波 — 綜合（coin+discard+status 等，~10 張）
//
// Helpers:
//   coinHeadsOppDiscardEnergyPost(label) — 正面時對手戰鬥寶可夢隨機丟 1 個能量
//   coinTripleHeadsPre(base, b1, b2, b3, label) — 3 硬幣，正面次數 1/2/3 各加 b1/b2/b3
// ══════════════════════════════════════════════════════════════════════════════

function coinHeadsOppDiscardEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const heads = Math.random() < 0.5;
    if (!heads) return addLog(state, `${label}：反面，無追加效果`, aIdx);
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def || def.energyAttached.length === 0) {
      return addLog(state, `${label}：正面！但對手出場無附加能量`, aIdx);
    }
    const defName = pool.get(def.cardId)?.name ?? '?';
    // 從後往前丟 1 張（最近附加優先）
    const last = def.energyAttached[def.energyAttached.length - 1];
    let s = addLog(state, `${label}：正面！丟棄對手 ${defName} 身上 1 張能量`, aIdx);
    return updatePlayer(s, dIdx, p => {
      if (!p.active) return p;
      return {
        ...p,
        active: { ...p.active, energyAttached: p.active.energyAttached.slice(0, -1) },
        discard: [...p.discard, last],
      };
    });
  };
}

function coinTripleHeadsPre(base: number, b1: number, b2: number, b3: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let heads = 0;
    for (let i = 0; i < 3; i++) if (Math.random() < 0.5) heads++;
    const bonus = heads === 3 ? b3 : heads === 2 ? b2 : heads === 1 ? b1 : 0;
    const dmg = base + bonus;
    return { state: addLog(state, `${label}：3 硬幣正面 ${heads} 次 → +${bonus}，合 ${dmg}`, aIdx), damage: dmg };
  };
}

// ── Coin-heads-opp-discard-energy (6 張) ─────────────────────────────────────
regPost('鬼斯|神秘光束', coinHeadsOppDiscardEnergyPost('神秘光束'));
regPost('角金魚|潮旋', coinHeadsOppDiscardEnergyPost('潮旋'));
regPost('伊裴爾塔爾|破壞光束', coinHeadsOppDiscardEnergyPost('破壞光束'));
regPost('鑽角犀獸|破壞之角', coinHeadsOppDiscardEnergyPost('破壞之角'));
regPost('火爆猴|掃腿', coinHeadsOppDiscardEnergyPost('掃腿'));
regPost('火伊布|破壞火', coinHeadsOppDiscardEnergyPost('破壞火'));

// ── 貓鼬斬|連斬 (10+, 3 硬幣正面 1/2/3 次各 +20/+50/+80) ─────────────────────
regPre('貓鼬斬|連斬', coinTripleHeadsPre(10, 20, 50, 80, '連斬'));

// ── 瑪狃拉|冰雹爪 (70, 丟棄自身全部能量，麻痺對手) ───────────────────────────
regPost('瑪狃拉|冰雹爪', (state, aIdx, pool) => {
  let s = selfDiscardAllEnergyPost('冰雹爪')(state, aIdx, pool);
  return statusPost('paralyzed')(s, aIdx, pool);
});

// ── 自爆磁怪|強勁磁場 (80, 混亂 + 下回合無法撤退) ───────────────────────────
regPost('自爆磁怪|強勁磁場', (state, aIdx, pool) => {
  let s = statusPost('confused')(state, aIdx, pool);
  return defCantRetreatNextPost()(s, aIdx, pool);
});

// ── 紅蓮鎧騎|紅蓮引爆：丟棄自身全部火能量 → 對手備戰 1 隻 180 傷害 ───────────
// 有火能量才能觸發；若對手備戰 0 則不進 pendingSelection
regPre('紅蓮鎧騎|紅蓮引爆', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 0 };
  const fireCount = att.energyAttached.filter(e => pool.get(e.cardId)?.pokemonType === 'Fire').length;
  if (fireCount === 0) {
    return { state: addLog(state, '紅蓮引爆：身上無火能量，招式失敗', aIdx), damage: 0 };
  }
  return { state: addLog(state, `紅蓮引爆：丟棄 ${fireCount} 張火能量`, aIdx), damage: 0 };
});
regPost('紅蓮鎧騎|紅蓮引爆', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  const fireEnergies = att.energyAttached.filter(e => pool.get(e.cardId)?.pokemonType === 'Fire');
  if (fireEnergies.length === 0) return state;
  // 先丟棄火能量
  let s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const kept = p.active.energyAttached.filter(e => pool.get(e.cardId)?.pokemonType !== 'Fire');
    return {
      ...p,
      active: { ...p.active, energyAttached: kept },
      discard: [...p.discard, ...fireEnergies],
    };
  });
  // 然後 opp-bench-choose 選 1 隻打 180
  const dIdx = (1 - aIdx) as 0 | 1;
  if (s.players[dIdx].bench.length === 0) {
    return addLog(s, '紅蓮引爆：對手無備戰寶可夢，無法施傷', aIdx);
  }
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: aIdx,
    sourcePlayerIdx: dIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'snipe-variable',
    params: { damage: 180, label: '紅蓮引爆' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38x v1.74 H 標第 19 波 — swap + discard-multiply + KO 綜合（10 張）
//
// Helpers / Resolvers:
//   regR('opp-swap-dmg') — 對手備戰互換到戰鬥場，並對新上場寶可夢施傷（含 KO 串聯）
//   registerSelfDiscardMultiply(key, spec) — ATTACK_PRE_DISCARD_CHOICE + regPre 一鍵註冊
//     scope='attacker'；支援 typeFilter（'all'/'basic'/EnergyType）
// ══════════════════════════════════════════════════════════════════════════════

regR('opp-swap-dmg', (st, actorIdx, iids, params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const oldActive = defender.active;
  if (!oldActive || defender.bench.length === 0) return st;
  const benchIdx = defender.bench.findIndex(c => c.iid === iids[0]);
  if (benchIdx < 0) return st;
  const dmg = (params?.damage as number) ?? 0;
  const label = (params?.label as string) ?? '';
  const newActiveOrig = defender.bench[benchIdx];
  const newActiveCard = pool.get(newActiveOrig.cardId);
  const oldActiveName = pool.get(oldActive.cardId)?.name ?? '?';
  const newActiveName = newActiveCard?.name ?? '?';

  // swap first — v2.08：離開戰鬥場清狀態旗標
  const newBench = [...defender.bench];
  newBench[benchIdx] = clearActiveEffects(oldActive);
  let newDefender = { ...defender, active: { ...newActiveOrig, justPlaced: false }, bench: newBench };
  let s: GameState = { ...st };
  let players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = newDefender;
  s = addLog({ ...s, players }, `${label}：${oldActiveName} 回備戰，${newActiveName} 上場`, null);

  if (dmg <= 0) return s;

  // apply damage to new active
  if (!newDefender.active) return s;
  const newDmg = newDefender.active.damage + dmg;
  const hp = newActiveCard?.hp ?? 0;
  if (hp > 0 && newDmg >= hp) {
    const koList: CardInstance[] = [
      { ...newDefender.active, damage: newDmg },
      ...newDefender.active.energyAttached,
      ...(newDefender.active.toolAttached ? [newDefender.active.toolAttached] : []),
      ...(newDefender.active.evolvedFromStack ?? []),
    ];
    const prizes = isExCard(newActiveCard) ? 2 : 1;
    newDefender = { ...newDefender, active: null, discard: [...newDefender.discard, ...koList] };
    players = [...s.players] as [PlayerState, PlayerState];
    players[dIdx] = newDefender;
    s = addLog({ ...s, players }, `${label}：${newActiveName} 被擊倒！+${prizes} 張獎勵牌`, null);
    if (newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return { ...s, pendingPrizes: prizes };
  }
  newDefender = { ...newDefender, active: { ...newDefender.active, damage: newDmg } };
  players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = newDefender;
  return addLog({ ...s, players }, `${label}：對 ${newActiveName} 造成 ${dmg} 傷害`, actorIdx);
});

// ── swap-opp + dmg (3 張) ────────────────────────────────────────────────────
// 共用 pre：不造成戰鬥寶可夢傷害（傷害在 resolver 中施加）
function oppSwapDmgPost(dmg: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    if (!defender.active || defender.bench.length === 0) {
      return addLog(state, `${label}：對手無備戰寶可夢，無法互換`, aIdx);
    }
    let s = addLog(state, `${label}：選擇對手備戰 1 隻與戰鬥場互換`, aIdx);
    return withPending(s, {
      type: 'opp-bench-choose',
      actorIdx: aIdx,
      sourcePlayerIdx: dIdx,
      minCount: 1,
      maxCount: 1,
      effectKey: 'opp-swap-dmg',
      params: { damage: dmg, label },
    });
  };
}

regPre('大嘴娃|誘導敲詐', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('大嘴娃|誘導敲詐', oppSwapDmgPost(30, '誘導敲詐'));

regPre('裹蜜蟲|蜜糖捕捉器', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('裹蜜蟲|蜜糖捕捉器', oppSwapDmgPost(70, '蜜糖捕捉器'));

regPre('勇士雄鷹|拖出', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('勇士雄鷹|拖出', oppSwapDmgPost(40, '拖出'));

// ── self-discard-multiply (3 張) ─────────────────────────────────────────────
type DiscardMultiplyFilter = 'all' | 'basic' | EnergyType;

function registerSelfDiscardMultiply(
  key: string,
  label: string,
  baseDamage: number,
  per: number,
  max: number,
  typeFilter: DiscardMultiplyFilter = 'all',
) {
  ATTACK_PRE_DISCARD_CHOICE.set(key, {
    min: 0,
    max,
    scope: 'attacker',
    baseDamage,
    damagePerEnergy: per,
  });
  regPre(key, (state, aIdx, pool, action) => {
    const player = state.players[aIdx];
    if (!player.active) return { state, damage: baseDamage };
    const all = player.active.energyAttached;
    const eligible = all.filter(e => {
      if (typeFilter === 'all') return true;
      const c = pool.get(e.cardId);
      if (!c) return false;
      if (typeFilter === 'basic') return c.subtype === 'Basic';
      return c.pokemonType === typeFilter;
    });
    const chosenIids = action?.discardedEnergyIids;
    let discarded: CardInstance[];
    let remaining: CardInstance[];
    if (chosenIids && chosenIids.length > 0) {
      const allowed = new Set(eligible.map(e => e.iid));
      const capped = chosenIids.filter(id => allowed.has(id)).slice(0, max);
      const setIds = new Set(capped);
      discarded = all.filter(e => setIds.has(e.iid));
      remaining = all.filter(e => !setIds.has(e.iid));
    } else {
      const n = Math.min(max, eligible.length);
      const toDiscard = eligible.slice(-n);
      const setIds = new Set(toDiscard.map(e => e.iid));
      discarded = all.filter(e => setIds.has(e.iid));
      remaining = all.filter(e => !setIds.has(e.iid));
    }
    let s = updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: remaining } : null,
      discard: [...p.discard, ...discarded],
    }));
    const dmg = baseDamage + per * discarded.length;
    s = addLog(s, `${label}：丟棄 ${discarded.length} 個能量 → ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  });
}

registerSelfDiscardMultiply('巨鉗螳螂ex|十字破壞', '十字破壞', 0, 120, 2, 'Metal');
registerSelfDiscardMultiply('固拉多|熔岩光芒', '熔岩光芒', 0, 60, 4, 'all');

// 席多藍恩|鋼鐵爆炸 — 丟棄所有自身 Metal 能量 × 50（用大 max 近似 all）
registerSelfDiscardMultiply('席多藍恩|鋼鐵爆炸', '鋼鐵爆炸', 0, 50, 10, 'Metal');

// ── KO 類（2 張） ──────────────────────────────────────────────────────────

// 棄世猴|同命戰鬥 — 雙方戰鬥寶可夢 KO
regPre('棄世猴|同命戰鬥', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('棄世猴|同命戰鬥', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  let players = [...s.players] as [PlayerState, PlayerState];
  let selfPrizes = 0;
  // 先 KO 對手出場
  const def = players[dIdx];
  if (def.active) {
    const card = pool.get(def.active.cardId);
    const ko: CardInstance[] = [
      { ...def.active, damage: (card?.hp ?? 0) },
      ...def.active.energyAttached,
      ...(def.active.toolAttached ? [def.active.toolAttached] : []),
      ...(def.active.evolvedFromStack ?? []),
    ];
    players[dIdx] = { ...def, active: null, discard: [...def.discard, ...ko] };
    selfPrizes += card ? (isExCard(card) ? 2 : 1) : 1;
    s = addLog({ ...s, players }, `同命戰鬥：${card?.name ?? '?'} 被擊倒！+${selfPrizes} 張獎勵牌`, null);
  }
  // 再 KO 自己出場（不算獎勵牌給對手，直接丟棄 — 但 PTCG 規則對方獲得獎勵）
  players = [...s.players] as [PlayerState, PlayerState];
  const att = players[aIdx];
  if (att.active) {
    const card = pool.get(att.active.cardId);
    const ko: CardInstance[] = [
      { ...att.active, damage: (card?.hp ?? 0) },
      ...att.active.energyAttached,
      ...(att.active.toolAttached ? [att.active.toolAttached] : []),
      ...(att.active.evolvedFromStack ?? []),
    ];
    players[aIdx] = { ...att, active: null, discard: [...att.discard, ...ko] };
    const oppPrizes = card ? (isExCard(card) ? 2 : 1) : 1;
    s = addLog({ ...s, players }, `同命戰鬥：${card?.name ?? '?'} 也被擊倒，對手取得 ${oppPrizes} 張獎勵牌`, null);
    // 對手取獎：直接從對手 prizes 移到 hand
    const opponent = players[dIdx];
    const take = Math.min(oppPrizes, opponent.prizes.length);
    if (take > 0) {
      const taken = opponent.prizes.slice(0, take);
      players[dIdx] = { ...opponent, prizes: opponent.prizes.slice(take), hand: [...opponent.hand, ...taken] };
      s = { ...s, players };
      s = addLog(s, `對手取走 ${take} 張獎勵牌`, null);
      // 檢查對手勝利
      if (players[dIdx].prizes.length === 0) {
        return { ...s, phase: 'game-over', winner: dIdx, winReason: '取得所有獎勵牌' };
      }
    }
    if (players[aIdx].bench.length === 0) {
      return { ...s, phase: 'game-over', winner: dIdx, winReason: `${att.name} 沒有可上場的寶可夢` };
    }
  }
  // 攻擊方累計獎勵（由 engine TAKE_PRIZES 處理）
  if (selfPrizes > 0) {
    s = { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + selfPrizes };
    // 判定勝利：若攻擊方 prizes 已剩 <= selfPrizes，遊戲結束（由 TAKE_PRIZES 處理更安全）
  }
  return s;
});

// 雙斧戰龍|斧擊在地 — 若對手戰鬥寶可夢身上附有特殊能量卡，則將那隻寶可夢 KO
regPre('雙斧戰龍|斧擊在地', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('雙斧戰龍|斧擊在地', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active) return state;
  const hasSpecial = def.active.energyAttached.some(e => {
    const c = pool.get(e.cardId);
    return c?.supertype === 'Energy' && c.subtype === 'Special';
  });
  if (!hasSpecial) return addLog(state, '斧擊在地：對手戰鬥寶可夢無特殊能量，無效', aIdx);
  // 直接 KO
  const card = pool.get(def.active.cardId);
  const ko: CardInstance[] = [
    { ...def.active, damage: (card?.hp ?? 0) },
    ...def.active.energyAttached,
    ...(def.active.toolAttached ? [def.active.toolAttached] : []),
    ...(def.active.evolvedFromStack ?? []),
  ];
  const prizes = card ? (isExCard(card) ? 2 : 1) : 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...def, active: null, discard: [...def.discard, ...ko] };
  let s = addLog({ ...state, players }, `斧擊在地：${card?.name ?? '?'} 被特殊能量反噬 KO！+${prizes} 張獎勵牌`, null);
  if (players[dIdx].bench.length === 0) {
    return { ...s, phase: 'game-over', winner: aIdx, winReason: `${def.name} 沒有可上場的寶可夢` };
  }
  return { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + prizes };
});

// ── damage-counter bench ────────────────────────────────────────────────
// 10 點 = 1 個指示物。
// 振翼髮|飛來橫禍 (90 + 2 指示物以「任意方式」放置於對手備戰)
// 卡面："將2個傷害指示物以任意方式放置於對手的備戰寶可夢身上。"
// → 「放置指示物」= 招式【效果】；會被對戰圓形擋，不受花之帷幔擋。
//
// v2.221：升級為 damage-distribute（複用 dragapult-snipe resolver；只允許備戰）—
//   2 個 counter 可任意分配到對手 1~2 隻備戰（同隻 ×2 或不同隻各 ×1）
regPre('振翼髮|飛來橫禍', (state, _aIdx, _pool) => ({ state, damage: 90 }));
regPost('振翼髮|飛來橫禍', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) return state;
  let s = addLog(state, '飛來橫禍：將 2 個傷害指示物自由分配到對手備戰寶可夢', aIdx);
  return withPending(s, {
    type: 'damage-distribute',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 2,
    effectKey: 'dragapult-snipe',
    params: {
      totalCounters: 2, placedCounters: 0, counterDamage: 10,
      label: '飛來橫禍', includeActive: false,
    },
  });
});

// 多龍巴魯托ex|幻影奇襲 (200 + 6 個傷害指示物自由分配到對手備戰寶可夢身上)
// 規則：6 個傷害指示物（每個 10 傷害），玩家可任意分配給任意數量的對手備戰寶可夢。
//
// v2.20 UX 改寫：改用新的 `damage-distribute` pending type。
//   - UI 顯示「已放置 X/60」進度條
//   - 可一次點多隻備戰各 1 counter（或同一隻多次）再統一確認，批次應用
//   - 按一次「確認」後若還有未用 counter 且對手仍有備戰，modal 再開；直到 60/60 或對手清空
//
// 舊版問題：每放 1 個 counter 就強制彈 1 次 modal，放 6 個要按 6 次確認。
regPre('多龍巴魯托ex|幻影奇襲', (state, _aIdx, _pool) => ({ state, damage: 200 }));
regPost('多龍巴魯托ex|幻影奇襲', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) return state;
  const s = addLog(state, '幻影奇襲：將 6 個傷害指示物自由分配到對手備戰寶可夢（可一次多選）', aIdx);
  return withPending(s, {
    type: 'damage-distribute',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 6,
    effectKey: 'dragapult-snipe',
    params: {
      totalCounters: 6,
      placedCounters: 0,
      counterDamage: 10,
      label: '幻影奇襲',
    },
  });
});

// 幻影奇襲 resolver — iids 陣列每出現 1 次 iid = 放 1 個 counter 到該寶可夢。
// 相同 iid 可出現多次（同一隻放多個 counter）。依序處理並在每次放置時檢查 KO。
// 若仍有剩餘 counter 且對手仍有備戰，再起一個 damage-distribute pending。
regR('dragapult-snipe', (st, actorIdx, selectedIids, params, pool) => {
  const totalCounters = (params?.totalCounters as number) ?? 6;
  const placedBefore = (params?.placedCounters as number) ?? 0;
  const counterDamage = (params?.counterDamage as number) ?? 10;
  const label = (params?.label as string) ?? '幻影奇襲';
  const dIdx = (1 - actorIdx) as 0 | 1;

  if (selectedIids.length === 0) return st;
  // v2.22 對戰圓形競技場：備戰完全不受對手招式傷害指示物 → 整批放置取消
  if (isBenchProtected(st, pool)) {
    return addLog(st, `${label}：對戰圓形競技場效果 — 對手備戰不受傷害指示物放置`, actorIdx);
  }

  let s: GameState = st;
  let placedThisBatch = 0;

  // 聚合每隻本批次的 counter 數量，方便產生一條精簡 log（不每個 counter 刷一行）
  const batchTally = new Map<string, number>();
  for (const iid of selectedIids) batchTally.set(iid, (batchTally.get(iid) ?? 0) + 1);

  // 依序施加，每放 1 個 counter 即檢查 KO（因為 KO 後不能再放到已離場的寶可夢）
  for (const iid of selectedIids) {
    const defender = s.players[dIdx];
    const target = defender.bench.find(c => c.iid === iid);
    if (!target) continue; // 若該寶可夢已被此批次稍早的 counter 擊倒，後續 counter 作廢

    const targetCard = pool.get(target.cardId);
    const tHp = targetCard?.hp ?? 0;
    const newDmg = target.damage + counterDamage;
    placedThisBatch++;

    if (tHp > 0 && newDmg >= tHp) {
      // 被這個 counter 擊倒
      const koDiscard: CardInstance[] = [
        { ...target, damage: newDmg },
        ...target.energyAttached,
        ...(target.toolAttached ? [target.toolAttached] : []),
        ...(target.evolvedFromStack ?? []),
      ];
      const prizes = targetCard ? koPrizeCount(targetCard) : 1;
      const players = [...s.players] as [PlayerState, PlayerState];
      players[dIdx] = {
        ...defender,
        discard: [...defender.discard, ...koDiscard],
        bench: defender.bench.filter(c => c.iid !== iid),
      };
      s = { ...s, players, pendingPrizes: (s.pendingPrizes ?? 0) + prizes };
      s = addLog(s,
        `${label}：${targetCard?.name ?? '?'} 累計到第 ${placedBefore + placedThisBatch}/${totalCounters} 個指示物 → 被擊倒！+${prizes} 張獎勵牌`, actorIdx);
    } else {
      const players = [...s.players] as [PlayerState, PlayerState];
      players[dIdx] = {
        ...defender,
        bench: defender.bench.map(c => c.iid === iid ? { ...c, damage: newDmg } : c),
      };
      s = { ...s, players };
    }
  }

  // 批次結束後補 1 條總結 log（未 KO 的部分）
  const summaryParts: string[] = [];
  for (const [iid, cnt] of batchTally) {
    // 尋找最後存活的狀態（可能已被 KO → 跳過，避免跟 KO log 重複）
    const stillThere = s.players[dIdx].bench.find(c => c.iid === iid);
    if (stillThere) {
      const name = pool.get(stillThere.cardId)?.name ?? '?';
      summaryParts.push(`${name}×${cnt}`);
    }
  }
  const placedAfter = placedBefore + placedThisBatch;
  if (summaryParts.length > 0) {
    s = addLog(s,
      `${label}：本批次放置 ${summaryParts.join('、')} → 累計 ${placedAfter}/${totalCounters}`, actorIdx);
  }

  // 還有 counter 要放 + 對手仍有備戰 → 再開 pending
  const nextRemaining = totalCounters - placedAfter;
  if (nextRemaining > 0 && s.players[dIdx].bench.length > 0) {
    return withPending(s, {
      type: 'damage-distribute',
      actorIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: nextRemaining,
      effectKey: 'dragapult-snipe',
      params: {
        totalCounters,
        placedCounters: placedAfter,
        counterDamage,
        label,
      },
    });
  }
  if (nextRemaining > 0) {
    s = addLog(s, `${label}：對手已無備戰寶可夢，剩 ${nextRemaining} 個指示物作廢`, actorIdx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38x+ v1.75 H 標第 20 波 — swap + energy return + count-multiply（10 張）
//
// Helpers:
//   discardOppActiveEnergyPost(label, filter?) — 攻後丟對手戰鬥寶可夢 1 張能量
//     filter: 'any' | 'special'；'special' 僅丟特殊能量
//   returnSelfActiveEnergyPost(n, toHand, label) — 攻後移除自身能量 n 張，toHand=true 放回手牌，否則改附備戰
//   returnOppActiveEnergyPost(n, label) — 攻後將對手戰鬥能量 n 張放回對手手牌
//   countDamagedSelfMultiplyPre(per, label) — pre 傷害 = 自己場上被傷害的寶可夢數 × per
// 特殊：
//   古月鳥|噴吐射擊 — 丟自身全部能量 + opp-poke-choose 120
//   噬沙堡爺ex|重晶石之獄 — 對手所有備戰設置 damage 直到剩 HP=100
// ══════════════════════════════════════════════════════════════════════════════

function discardOppActiveEnergyPost(
  label: string,
  filter: 'any' | 'special' = 'any',
): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    if (!defender.active) return state;
    const defName = pool.get(defender.active.cardId)?.name ?? '?';
    const energies = defender.active.energyAttached;
    if (energies.length === 0) {
      return addLog(state, `${label}：${defName} 沒有可丟的能量`, aIdx);
    }
    // 找最後一個符合 filter 的能量
    let targetIdx = -1;
    for (let i = energies.length - 1; i >= 0; i--) {
      const card = pool.get(energies[i].cardId);
      if (filter === 'special') {
        if (card?.supertype === 'Energy' && card.subtype === 'Special') {
          targetIdx = i;
          break;
        }
      } else {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx < 0) {
      return addLog(state, `${label}：${defName} 無${filter === 'special' ? '特殊' : ''}能量可丟`, aIdx);
    }
    const discarded = energies[targetIdx];
    const newEnergies = [...energies.slice(0, targetIdx), ...energies.slice(targetIdx + 1)];
    const energyName = pool.get(discarded.cardId)?.name ?? '能量';
    let s = addLog(state, `${label}：${defName} 丟棄 1 張${filter === 'special' ? '特殊' : ''}能量（${energyName}）`, aIdx);
    return updatePlayer(s, dIdx, p => {
      if (!p.active) return p;
      return {
        ...p,
        active: { ...p.active, energyAttached: newEnergies },
        discard: [...p.discard, discarded],
      };
    });
  };
}

function returnSelfActiveEnergyPost(n: number, toHand: boolean, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att) return state;
    const attName = pool.get(att.cardId)?.name ?? '?';
    const energies = att.energyAttached;
    if (energies.length === 0) {
      return addLog(state, `${label}：${attName} 沒有可移動的能量`, aIdx);
    }
    const takeCount = Math.min(n, energies.length);
    const moved = energies.slice(energies.length - takeCount);
    const remaining = energies.slice(0, energies.length - takeCount);
    if (toHand) {
      let s = addLog(state, `${label}：${attName} 將 ${takeCount} 張能量放回手牌`, aIdx);
      return updatePlayer(s, aIdx, p => {
        if (!p.active) return p;
        return {
          ...p,
          active: { ...p.active, energyAttached: remaining },
          hand: [...p.hand, ...moved],
        };
      });
    }
    // 改附於備戰：用 gengar-move-energy 單張迴圈；我們取 1 張（n 預設 1 對此類卡）
    if (state.players[aIdx].bench.length === 0) {
      return addLog(state, `${label}：沒有備戰寶可夢，能量留在原位`, aIdx);
    }
    const toMove = moved[0];
    let s = updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.slice(0, -1) } : null,
    }));
    s = addLog(s, `${label}：將能量改附於備戰寶可夢`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'gengar-move-energy',
      params: { energyIid: toMove.iid, energyCardId: toMove.cardId },
    });
  };
}

function returnOppActiveEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    if (!defender.active) return state;
    const defName = pool.get(defender.active.cardId)?.name ?? '?';
    const energies = defender.active.energyAttached;
    if (energies.length === 0) {
      return addLog(state, `${label}：${defName} 沒有能量可放回`, aIdx);
    }
    const takeCount = Math.min(n, energies.length);
    const returned = energies.slice(energies.length - takeCount);
    const remaining = energies.slice(0, energies.length - takeCount);
    let s = addLog(state, `${label}：${defName} 的 ${takeCount} 張能量放回對手手牌`, aIdx);
    return updatePlayer(s, dIdx, p => {
      if (!p.active) return p;
      return {
        ...p,
        active: { ...p.active, energyAttached: remaining },
        hand: [...p.hand, ...returned],
      };
    });
  };
}

function countDamagedSelfMultiplyPre(per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    const all = [p.active, ...p.bench].filter((x): x is CardInstance => !!x);
    const count = all.filter(c => c.damage > 0).length;
    const dmg = count * per;
    return {
      state: addLog(state, `${label}：自己被傷害的寶可夢 ${count} 隻 × ${per} → ${dmg}`, aIdx),
      damage: dmg,
    };
  };
}

// 1. 比克提尼|燒落 — 30 + 丟對手戰鬥場 1 張特殊能量
regPre('比克提尼|燒落', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('比克提尼|燒落', discardOppActiveEnergyPost('燒落', 'special'));

// 2. 大蔥鴨|音速斬 — 30 + 丟對手戰鬥場 1 張特殊能量
regPre('大蔥鴨|音速斬', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('大蔥鴨|音速斬', discardOppActiveEnergyPost('音速斬', 'special'));

// 3. 吼叫尾ex|咬碎 — 120 + 丟對手戰鬥場 1 張能量（任意）
regPre('吼叫尾ex|咬碎', (state, _aIdx, _pool) => ({ state, damage: 120 }));
regPost('吼叫尾ex|咬碎', discardOppActiveEnergyPost('咬碎', 'any'));

// 4. 狡猾天狗|能量閉環 — 140 + 將 1 張自身能量放回手牌
regPre('狡猾天狗|能量閉環', (state, _aIdx, _pool) => ({ state, damage: 140 }));
regPost('狡猾天狗|能量閉環', returnSelfActiveEnergyPost(1, true, '能量閉環'));

// 5. 鐵荊棘ex|伏特旋風 — 140 + 將 1 張自身能量改附於備戰
regPre('鐵荊棘ex|伏特旋風', (state, _aIdx, _pool) => ({ state, damage: 140 }));
regPost('鐵荊棘ex|伏特旋風', returnSelfActiveEnergyPost(1, false, '伏特旋風'));

// 6. 鐵轍跡|路徑輪 — 60 + 將 1 張自身能量改附於備戰
regPre('鐵轍跡|路徑輪', (state, _aIdx, _pool) => ({ state, damage: 60 }));
regPost('鐵轍跡|路徑輪', returnSelfActiveEnergyPost(1, false, '路徑輪'));

// 7. 高傲雉雞|反轉之風 — 70 + 對手戰鬥寶可夢 2 張能量放回對手手牌
regPre('高傲雉雞|反轉之風', (state, _aIdx, _pool) => ({ state, damage: 70 }));
regPost('高傲雉雞|反轉之風', returnOppActiveEnergyPost(2, '反轉之風'));

// 8. 波士可多拉|發怒猛進 — 自己場上身上有傷害指示物的寶可夢數 × 50
regPre('波士可多拉|發怒猛進', countDamagedSelfMultiplyPre(50, '發怒猛進'));

// 9. 古月鳥|噴吐射擊 — 丟自身全部能量；對手 1 隻寶可夢受 120 傷害（備戰不計弱抗）
regPre('古月鳥|噴吐射擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古月鳥|噴吐射擊', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  const attName = pool.get(att.cardId)?.name ?? '?';
  const energyCount = att.energyAttached.length;
  if (energyCount === 0) {
    return addLog(state, `噴吐射擊：${attName} 沒有能量可丟，招式失敗`, aIdx);
  }
  // 丟全部自身能量
  let s = addLog(state, `噴吐射擊：${attName} 丟棄全部 ${energyCount} 張能量`, aIdx);
  s = updatePlayer(s, aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: { ...p.active, energyAttached: [] },
      discard: [...p.discard, ...p.active.energyAttached],
    };
  });
  const dIdx = (1 - aIdx) as 0 | 1;
  // 對手必定有 active（否則攻擊無法進行）
  if (!s.players[dIdx].active && s.players[dIdx].bench.length === 0) return s;
  s = addLog(s, '噴吐射擊：選擇對手任一寶可夢造成 120 傷害', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-variable',
    params: { includeActive: true, damage: 120, label: '噴吐射擊' },
  });
});

// 10. 噬沙堡爺ex|重晶石之獄 — 對手所有備戰設置 damage 直到剩 HP=100
regPre('噬沙堡爺ex|重晶石之獄', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('噬沙堡爺ex|重晶石之獄', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (defender.bench.length === 0) {
    return addLog(state, '重晶石之獄：對手無備戰寶可夢', aIdx);
  }
  const newBench = defender.bench.map(c => {
    const card = pool.get(c.cardId);
    const hp = card?.hp ?? 0;
    if (hp <= 100) return c; // HP 上限即為 100 或以下，不影響
    const targetDamage = hp - 100;
    if (c.damage >= targetDamage) return c; // 已超過上限、不再補
    return { ...c, damage: targetDamage };
  });
  const affected = newBench.filter((c, i) => c.damage !== defender.bench[i].damage).length;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...defender, bench: newBench };
  return addLog({ ...state, players }, `重晶石之獄：對手備戰 ${affected} 隻被放置傷害指示物至剩 HP 100`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38z v1.76 H 標第 21 波 — snipe + stadium discard + peek hand（12 張）
//
// Helpers:
//   oppSnipePost(dmg, label) — 設置 pending 讓玩家選對手任一寶可夢造成 dmg（走 snipe-variable）
//   discardStadiumPost(label, failIfNone?) — 攻後丟棄場上競技場；failIfNone=true 時若無競技場則無效
//   peekOppHandPost(label) — 攻後「查看對手手牌」；目前僅記 log（UI 未來可做 reveal UI）
// ══════════════════════════════════════════════════════════════════════════════

function oppSnipePost(dmg: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const defender = state.players[dIdx];
    // 若對手場上沒有任何寶可夢，跳過（理論不可能）
    if (!defender.active && defender.bench.length === 0) return state;
    const s = addLog(state, `${label}：選擇對手任一寶可夢造成 ${dmg} 傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'snipe-variable',
      params: { includeActive: true, damage: dmg, label },
    });
  };
}

function discardStadiumPost(label: string, failIfNone: boolean = false): AttackPostFn {
  return (state, aIdx, pool) => {
    if (!state.activeStadium) {
      if (failIfNone) return addLog(state, `${label}：場上無競技場，招式效果失敗`, aIdx);
      return addLog(state, `${label}：場上無競技場`, aIdx);
    }
    const stadium = state.activeStadium;
    const stadiumName = pool.get(stadium.cardId)?.name ?? '競技場';
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = { ...players[aIdx], discard: [...players[aIdx].discard, stadium] };
    return addLog({ ...state, players, activeStadium: undefined, stadiumUsedThisTurn: undefined }, `${label}：${stadiumName} 被丟棄`, aIdx);
  };
}

function peekOppHandPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const hand = state.players[dIdx].hand;
    if (hand.length === 0) {
      return addLog(state, `${label}：對手手牌為空`, aIdx);
    }
    const names = hand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    return addLog(state, `${label}：查看對手手牌（${hand.length} 張）— ${names}`, aIdx);
  };
}

// 1-5. 簡單 snipe（對對手任一寶可夢造成 dmg，備戰不計弱抗）
regPre('變隱龍|舌之鞭打', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('變隱龍|舌之鞭打', oppSnipePost(30, '舌之鞭打'));

regPre('雷伊布|直擊彈', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('雷伊布|直擊彈', oppSnipePost(30, '直擊彈'));

regPre('拉帝歐斯|直擊飛行', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('拉帝歐斯|直擊飛行', oppSnipePost(50, '直擊飛行'));

regPre('吉雉雞ex|殘酷箭', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('吉雉雞ex|殘酷箭', oppSnipePost(100, '殘酷箭'));

regPre('閃焰王牌ex|石榴石截擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('閃焰王牌ex|石榴石截擊', oppSnipePost(180, '石榴石截擊'));

// 6. 盔甲鳥|大風暴 — 90 + 丟棄場上競技場卡
regPre('盔甲鳥|大風暴', (state, _aIdx, _pool) => ({ state, damage: 90 }));
regPost('盔甲鳥|大風暴', discardStadiumPost('大風暴', false));

// 7. 無極汰那|世界之末 — 230 + 丟棄場上競技場（無則失敗）
// pre 依競技場存在設定傷害，不存在則 0
regPre('無極汰那|世界之末', (state, aIdx, _pool) => {
  if (!state.activeStadium) {
    return { state: addLog(state, '世界之末：場上無競技場，招式失敗', aIdx), damage: 0 };
  }
  return { state, damage: 230 };
});
regPost('無極汰那|世界之末', discardStadiumPost('世界之末', false));

// 8. 毛辮羊|搗碎 — 30 + 可選丟棄競技場（AI 永遠丟）
regPre('毛辮羊|搗碎', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('毛辮羊|搗碎', discardStadiumPost('搗碎', false));

// 9. 毛毛角羊|搗碎 — 70 + 可選丟棄競技場（AI 永遠丟）
regPre('毛毛角羊|搗碎', (state, _aIdx, _pool) => ({ state, damage: 70 }));
regPost('毛毛角羊|搗碎', discardStadiumPost('搗碎', false));

// 10-11. peek opp hand 類（僅 log，真實 reveal UI 另做）
regPre('咕咕|靜默之翼', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('咕咕|靜默之翼', peekOppHandPost('靜默之翼'));

regPre('催眠貘|不祥視線', (state, _aIdx, _pool) => ({ state, damage: 10 }));
regPost('催眠貘|不祥視線', peekOppHandPost('不祥視線'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38aa v1.77 H 標第 22 波 — heal-any-own + 呼朋引伴 + deck-mill（15 張）
//
// Helpers:
//   healAnyOwnPost(amount, label) — 攻後設置 pending heal-target（重用 'heal-30' resolver）
//   benchBasicFromDeckPost(max, label) — 攻後設置 pending deck-search Basic → bench
//   millSelfDeckTopPost(n, label) — 攻後丟自己牌庫頂 n 張
//   millOppDeckTopPost(n, label) — 攻後丟對手牌庫頂 n 張
// ══════════════════════════════════════════════════════════════════════════════

function healAnyOwnPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    const all = [p.active, ...p.bench].filter((x): x is CardInstance => !!x);
    if (!all.some(c => c.damage > 0)) {
      return addLog(state, `${label}：沒有寶可夢需要療傷`, aIdx);
    }
    let s = addLog(state, `${label}：選擇回復 ${amount} HP 的寶可夢`, aIdx);
    return withPending(s, {
      type: 'heal-target',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: amount === 30 ? 'heal-30' : amount === 120 ? 'heal-120' : 'heal-30',
      params: { healAmount: amount, discardEnergy: 0 },
    });
  };
}

function benchBasicFromDeckPost(max: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const player = state.players[aIdx];
    if (player.bench.length >= 5) return addLog(state, `${label}：備戰區已滿`, aIdx);
    const slots = 5 - player.bench.length;
    const takeMax = Math.min(max, slots);
    let s = addLog(state, `${label}：從牌庫選最多 ${takeMax} 張基礎寶可夢放備戰`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Basic',
      minCount: 0, maxCount: takeMax,
      effectKey: 'bench-basic-from-deck',
    });
  };
}

function millSelfDeckTopPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：自己牌庫為空`, aIdx);
    const taken = p.deck.slice(0, n);
    return updatePlayer(
      addLog(state, `${label}：自己牌庫頂 ${taken.length} 張丟入棄牌區`, aIdx),
      aIdx,
      pl => ({ ...pl, deck: pl.deck.slice(taken.length), discard: [...pl.discard, ...taken] }),
    );
  };
}

function millOppDeckTopPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const p = state.players[dIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：對手牌庫為空`, aIdx);
    const taken = p.deck.slice(0, n);
    return updatePlayer(
      addLog(state, `${label}：對手牌庫頂 ${taken.length} 張丟入棄牌區`, aIdx),
      dIdx,
      pl => ({ ...pl, deck: pl.deck.slice(taken.length), discard: [...pl.discard, ...taken] }),
    );
  };
}

// ── pending heal（2 張） ────────────────────────────────────────────────────
regPre('啃果蟲|營養素', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('啃果蟲|營養素', healAnyOwnPost(30, '營養素'));

regPre('花蓓蓓|療傷', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('花蓓蓓|療傷', healAnyOwnPost(30, '療傷'));

// ── 造傷 + self heal by dealt-damage（2 張；簡化為 base dmg 30）───────────────
regPre('鐵毒蛾|吸納', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('鐵毒蛾|吸納', selfHealPost(30, '吸納'));

regPre('火神蛾|吸血', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('火神蛾|吸血', selfHealPost(30, '吸血'));

// ── 呼朋引伴 / 組成陣形 系列（5 張）───────────────────────────────────────────
regPre('狗仔包|香味', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('狗仔包|香味', benchBasicFromDeckPost(1, '香味'));

regPre('燭光靈|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('燭光靈|呼朋引伴', benchBasicFromDeckPost(1, '呼朋引伴'));

regPre('粉蝶蟲|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('粉蝶蟲|呼朋引伴', benchBasicFromDeckPost(1, '呼朋引伴'));

regPre('大顎蟻|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('大顎蟻|呼朋引伴', benchBasicFromDeckPost(2, '呼朋引伴'));

regPre('列陣兵|組成陣形', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('列陣兵|組成陣形', benchBasicFromDeckPost(2, '組成陣形'));

// ── 牌庫 mill（6 張）─────────────────────────────────────────────────────────
// 自己 mill
regPre('斧牙龍|龍之波動', (state, _aIdx, _pool) => ({ state, damage: 80 }));
regPost('斧牙龍|龍之波動', millSelfDeckTopPost(1, '龍之波動'));

regPre('雙斧戰龍|龍之波動', (state, _aIdx, _pool) => ({ state, damage: 230 }));
regPost('雙斧戰龍|龍之波動', millSelfDeckTopPost(3, '龍之波動'));

regPre('古簡蝸|捲入鞭打', (state, _aIdx, _pool) => ({ state, damage: 130 }));
regPost('古簡蝸|捲入鞭打', millSelfDeckTopPost(3, '捲入鞭打'));

// 對手 mill
regPre('螺釘地鼠|掘掘', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('螺釘地鼠|掘掘', millOppDeckTopPost(1, '掘掘'));

regPre('龍頭地鼠|挖洞爪', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('龍頭地鼠|挖洞爪', millOppDeckTopPost(1, '挖洞爪'));

regPre('三首惡龍ex|粉碎頭', (state, _aIdx, _pool) => ({ state, damage: 200 }));
regPost('三首惡龍ex|粉碎頭', millOppDeckTopPost(3, '粉碎頭'));

regPre('單首龍|踩落', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('單首龍|踩落', millOppDeckTopPost(1, '踩落'));

regPre('雙首暴龍|踩落', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('雙首暴龍|踩落', millOppDeckTopPost(2, '踩落'));

// ── Session 38ab (v1.78) H 標第 23 波：deck/discard search to hand + self-swap ──
// 共同 helper：攻擊後自己切換（備戰選 1 → 與出場互換）
export function selfSwapPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const player = state.players[aIdx];
    if (!player.active || player.bench.length === 0) {
      return addLog(state, `${label}：備戰區沒有寶可夢，無法切換`, aIdx);
    }
    const s = addLog(state, `${label}：選擇換入的備戰寶可夢`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'do-switch',
    });
  };
}

// 從牌庫選 N 張（filter）加手牌（使用 search-to-hand-reshuffle）
function deckSearchToHandPost(max: number, filter: string, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const s = addLog(state, `${label}：從牌庫選最多 ${max} 張（${filter}）加手牌`, aIdx);
    return withPending(s, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter, minCount: 0, maxCount: max,
      effectKey: 'search-to-hand-reshuffle',
    });
  };
}

// ── 自己切換（5 張） ─────────────────────────────────────────────────────────
regPre('原蓋海龜|飛濺迴轉', (state, _aIdx, _pool) => ({ state, damage: 70 }));
regPost('原蓋海龜|飛濺迴轉', selfSwapPost('飛濺迴轉'));

regPre('粉蝶蛹|走來走去', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('粉蝶蛹|走來走去', selfSwapPost('走來走去'));

regPre('醜醜魚|躍起逃走', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('醜醜魚|躍起逃走', selfSwapPost('躍起逃走'));

regPre('沙漠蜻蜓ex|風暴返', (state, _aIdx, _pool) => ({ state, damage: 130 }));
regPost('沙漠蜻蜓ex|風暴返', selfSwapPost('風暴返'));

regPre('鍬農炮蟲|伏特替換', (state, _aIdx, _pool) => ({ state, damage: 90 }));
regPost('鍬農炮蟲|伏特替換', selfSwapPost('伏特替換'));

// ── 牌庫選基本能量到手牌（4 張） ────────────────────────────────────────────
regPre('基拉祈|蓄能量', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('基拉祈|蓄能量', deckSearchToHandPost(2, 'BasicEnergy', '蓄能量'));

regPre('厄鬼椪 碧草面具|步山', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('厄鬼椪 碧草面具|步山', deckSearchToHandPost(2, 'BasicEnergy', '步山'));

regPre('花葉蒂|小使者', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('花葉蒂|小使者', deckSearchToHandPost(3, 'BasicEnergy', '小使者'));

regPre('索財靈|小使者', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('索財靈|小使者', deckSearchToHandPost(2, 'BasicEnergy', '小使者'));

// 伊布|鮮豔捕捉 — 最多 3 張各不同屬性的基本能量
// v2.162：用新 filter 'BasicEnergy:DistinctTypes' 讓 UI 端動態排除已選屬性
regPre('伊布|鮮豔捕捉', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('伊布|鮮豔捕捉', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '鮮豔捕捉：牌庫為空', aIdx);
  const s = addLog(state, '鮮豔捕捉：從牌庫選最多 3 張各不同屬性的基本能量加手牌', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy:DistinctTypes',
    minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// 光電傘蜥|拋物面充電 — 從牌庫選最多 4 張能量卡加手牌（含特殊能量）
//   v2.222 釐清：filter 'Energy' = supertype===Energy（任意基本/特殊能量），
//   無遺漏。舊註解「簡化：4 張 Energy」誤導，實為「正確實裝」。
regPre('光電傘蜥|拋物面充電', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('光電傘蜥|拋物面充電', deckSearchToHandPost(4, 'Energy', '拋物面充電'));

// ── 牌庫選寶可夢到手牌（2 張） ──────────────────────────────────────────────
regPre('幾何雪花|呼喚信號', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('幾何雪花|呼喚信號', deckSearchToHandPost(1, 'Pokemon', '呼喚信號'));

// 卡璞・鳴鳴|召喚雷電 — 最多 2 張【雷】寶可夢
regPre('卡璞・鳴鳴|召喚雷電', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('卡璞・鳴鳴|召喚雷電', deckSearchToHandPost(2, 'Pokemon:Lightning', '召喚雷電'));

// ── 棄牌區選卡到手牌（3 張） ────────────────────────────────────────────────
regPre('呆呆獸|垂尾巴', (state, _aIdx, _p) => ({ state, damage: 0 }));
// 'Pokemon' filter — 棄牌區寶可夢
regPost('呆呆獸|垂尾巴', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon';
  });
  if (cand.length === 0) return addLog(state, '垂尾巴：棄牌區沒有寶可夢', aIdx);
  const s = addLog(state, '垂尾巴：從棄牌區選 1 張寶可夢加手牌', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon', minCount: 1, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

regPre('咚咚鼠|電磁聲納', (state, _aIdx, _p) => ({ state, damage: 0 }));
regPost('咚咚鼠|電磁聲納', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const cand = p.discard.filter(c => pool.get(c.cardId)?.supertype === 'Trainer');
  if (cand.length === 0) return addLog(state, '電磁聲納：棄牌區沒有訓練家卡', aIdx);
  const s = addLog(state, '電磁聲納：從棄牌區選 1 張訓練家卡加手牌', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Trainer', minCount: 1, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

regPre('霏歐納|招喚', (state, _aIdx, _p) => ({ state, damage: 0 }));
regPost('霏歐納|招喚', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Trainer' && card.subtype === 'Supporter';
  });
  if (cand.length === 0) return addLog(state, '招喚：棄牌區沒有支援者卡', aIdx);
  const s = addLog(state, '招喚：從棄牌區選 1 張支援者卡加手牌', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Supporter', minCount: 1, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

// ── 優雅貓|能量攪拌 跳過（太複雜的任意方式改附）────────────────────────────

// ── 狙射樹梟|強力射擊 170 — 若無法丟基本草能量則招式失敗 ────────────────────
regPre('狙射樹梟|強力射擊', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const hasGrassEnergy = p.hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Grass';
  });
  if (!hasGrassEnergy) {
    return { state: addLog(state, '強力射擊：手牌無基本草能量，招式失敗', aIdx), damage: 0 };
  }
  return { state, damage: 170 };
});
regPost('狙射樹梟|強力射擊', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const gidx = p.hand.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Grass';
  });
  if (gidx < 0) return state;
  const energy = p.hand[gidx];
  const s = addLog(state, '強力射擊：丟棄手牌 1 張基本草能量', aIdx);
  return updatePlayer(s, aIdx, pl => ({
    ...pl,
    hand: [...pl.hand.slice(0, gidx), ...pl.hand.slice(gidx + 1)],
    discard: [...pl.discard, energy],
  }));
});

// ── 超甲狂犀|直衝鑽 180 — 丟對手戰鬥寶可夢 1 張能量（任意）──────────────────
regPre('超甲狂犀|直衝鑽', (state, _aIdx, _pool) => ({ state, damage: 180 }));
regPost('超甲狂犀|直衝鑽', discardOppActiveEnergyPost('直衝鑽', 'any'));

// ── 爆焰龜獸|灼燒盡 — 對手戰鬥場是 ex 才生效 ────────────────────────────────
regPre('爆焰龜獸|灼燒盡', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('爆焰龜獸|灼燒盡', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return state;
  const defCard = pool.get(def.cardId);
  if (!defCard || !isExCard(defCard)) {
    return addLog(state, '灼燒盡：對手戰鬥寶可夢非 ex，無效果', aIdx);
  }
  if (def.energyAttached.length === 0) {
    return addLog(state, '灼燒盡：對手戰鬥 ex 寶可夢無附加能量', aIdx);
  }
  const last = def.energyAttached[def.energyAttached.length - 1];
  const defName = defCard.name;
  const s = addLog(state, `灼燒盡：丟棄對手 ${defName} 1 張能量`, aIdx);
  return updatePlayer(s, dIdx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: pl.active.energyAttached.slice(0, -1) },
      discard: [...pl.discard, last],
    };
  });
});

// ── 月亮伊布ex|縞瑪瑙 — 丟自身全部能量 + 獲得 1 張獎賞 ─────────────────────
regPre('月亮伊布ex|縞瑪瑙', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('月亮伊布ex|縞瑪瑙', (state, aIdx, _pool) => {
  let s = state;
  const p = s.players[aIdx];
  if (p.active && p.active.energyAttached.length > 0) {
    const energies = p.active.energyAttached;
    s = addLog(s, `縞瑪瑙：丟棄自身 ${energies.length} 張能量`, aIdx);
    s = updatePlayer(s, aIdx, pl => {
      if (!pl.active) return pl;
      return {
        ...pl,
        active: { ...pl.active, energyAttached: [] },
        discard: [...pl.discard, ...energies],
      };
    });
  }
  if (s.players[aIdx].prizes.length === 0) {
    return addLog(s, '縞瑪瑙：獎賞區已空，無法獲得獎賞', aIdx);
  }
  s = addLog(s, '縞瑪瑙：額外獲得 1 張獎賞', aIdx);
  s = updatePlayer(s, aIdx, pl => {
    const prize = pl.prizes[0];
    return { ...pl, prizes: pl.prizes.slice(1), hand: [...pl.hand, prize] };
  });
  // 若剛好這樣取完 6 張，由 engine 的 prize 檢查勝利條件
  return s;
});

// ── 烈咬陸鯊ex|音波奇襲 — 丟 2 自身能量 + 對手 1 隻任意 120 ──────────────────
regPre('烈咬陸鯊ex|音波奇襲', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('烈咬陸鯊ex|音波奇襲', (state, aIdx, pool) => {
  let s = state;
  // 先丟 2 張自身能量（從後往前）
  const p = s.players[aIdx];
  if (!p.active) return s;
  const take = Math.min(2, p.active.energyAttached.length);
  if (take < 2) {
    return addLog(s, '音波奇襲：自身能量不足 2 張', aIdx);
  }
  const removed = p.active.energyAttached.slice(-2);
  s = addLog(s, '音波奇襲：丟棄自身 2 張能量', aIdx);
  s = updatePlayer(s, aIdx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: pl.active.energyAttached.slice(0, -2) },
      discard: [...pl.discard, ...removed],
    };
  });
  return oppSnipePost(120, '音波奇襲')(s, aIdx, pool);
});

// ── 大電海燕|風暴伏特 160 — 將自身所有能量「以任意方式」改附於備戰寶可夢 ──────
//   v2.220：升級為逐張選擇 — 每張能量可附到不同備戰寶可夢（之前簡化為全部到 1 隻）
//   實作：先把 active 上所有能量拔下來，依張數開 N 次 bench-choose pending，
//        每次 resolver 把當前 1 張能量附到玩家選的備戰，再開下一個 pending；
//        params.remainingEnergies 攜帶剩餘待分配的能量陣列。
regPre('大電海燕|風暴伏特', (state, _aIdx, _pool) => ({ state, damage: 160 }));
regPost('大電海燕|風暴伏特', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (!p.active || p.active.energyAttached.length === 0) {
    return addLog(state, '風暴伏特：自身無能量可改附', aIdx);
  }
  if (p.bench.length === 0) {
    return addLog(state, '風暴伏特：備戰區沒有寶可夢', aIdx);
  }
  const energies = p.active.energyAttached;
  // 先把能量從 active 拔下來（暫存在 pending params 裡）
  let s = updatePlayer(state, aIdx, pl => {
    if (!pl.active) return pl;
    return { ...pl, active: { ...pl.active, energyAttached: [] } };
  });
  s = addLog(s, `風暴伏特：將自身 ${energies.length} 張能量逐一改附於備戰寶可夢`, aIdx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'storm-volt-distribute',
    params: { remainingEnergies: energies, totalCount: energies.length, placedCount: 0 },
  });
});
regR('storm-volt-distribute', (st, idx, iids, params, pool) => {
  const remaining = (params?.remainingEnergies as CardInstance[] | undefined) ?? [];
  const totalCount = (params?.totalCount as number) ?? remaining.length;
  const placedCount = (params?.placedCount as number) ?? 0;
  if (remaining.length === 0) return st;
  const targetIid = iids[0];
  const energy = remaining[0];
  const rest = remaining.slice(1);
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) {
    // 目標不存在（例：被互換到別處）：把剩下的能量直接送到棄牌區避免遺失
    let s = addLog(st, `風暴伏特：目標備戰已不存在，剩餘 ${remaining.length} 張能量送往棄牌區`, idx);
    return updatePlayer(s, idx, pl => ({ ...pl, discard: [...pl.discard, ...remaining] }));
  }
  const targetName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `風暴伏特：將第 ${placedCount + 1}/${totalCount} 張能量改附於 ${targetName}`, idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energy] }
      : c),
  }));
  if (rest.length > 0) {
    return withPending(s, {
      type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'storm-volt-distribute',
      params: { remainingEnergies: rest, totalCount, placedCount: placedCount + 1 },
    });
  }
  return s;
});

// ── （legacy）storm-volt-move resolver — 由「飄浮泡泡 太陽的樣子｜陽光支援」共用 ──
//   陽光支援 卡面：「全部改附於1隻備戰寶可夢身上。」（單一目標，正確簡單版）
regR('storm-volt-move', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  const p = st.players[idx];
  if (!p.active) return st;
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.active.energyAttached;
  const targetName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `陽光支援：將 ${energies.length} 張能量改附於 ${targetName}`, idx);
  return updatePlayer(s, idx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: [] },
      bench: pl.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    };
  });
});

// ── 飄浮泡泡 太陽的樣子|陽光支援 50 — 同上模式（改附於 1 隻備戰）─────────────
regPre('飄浮泡泡 太陽的樣子|陽光支援', (state, _aIdx, _pool) => ({ state, damage: 50 }));
regPost('飄浮泡泡 太陽的樣子|陽光支援', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (!p.active || p.active.energyAttached.length === 0) {
    return addLog(state, '陽光支援：自身無能量可改附', aIdx);
  }
  if (p.bench.length === 0) {
    return addLog(state, '陽光支援：備戰區沒有寶可夢', aIdx);
  }
  const s = addLog(state, `陽光支援：選擇 1 隻備戰寶可夢，將自身能量改附`, aIdx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'storm-volt-move',
  });
});

// 12. 噗隆隆|金屬塗層 — 招式：從棄牌區 1 張基本鋼能量附於自身（auto）
//   實際卡池中此為招式（非特性），登錄為 ATTACK_POST，pre 傷害 0
regPre('噗隆隆|金屬塗層', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('噗隆隆|金屬塗層', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return addLog(state, '金屬塗層：場上無戰鬥寶可夢', aIdx);
  const idx = p.discard.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Metal';
  });
  if (idx < 0) return addLog(state, '金屬塗層：棄牌區沒有基本鋼能量', aIdx);
  const energy = p.discard[idx];
  const attName = pool.get(p.active.cardId)?.name ?? '?';
  let s = addLog(state, `金屬塗層：從棄牌區附加 1 張基本鋼能量到 ${attName}`, aIdx);
  return updatePlayer(s, aIdx, p2 => {
    if (!p2.active) return p2;
    return {
      ...p2,
      discard: [...p2.discard.slice(0, idx), ...p2.discard.slice(idx + 1)],
      active: { ...p2.active, energyAttached: [...p2.active.energyAttached, energy] },
    };
  });
});

// ── Session 38ac (v1.79) H 標第 24 波：棄牌能量附加 + 多目標 snipe ──────────────
// 共同 helper：棄牌區選 N 張特定屬性基本能量 → 選 1 隻自己寶可夢附加
// 兩步：步驟 1 選能量（discard-search），步驟 2 選目標（heal-target 類，任一自己寶可夢）
function discardEnergyAttachPost(
  max: number,
  typeFilter: EnergyType | null,
  label: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const cand = p.discard.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && card.pokemonType !== typeFilter) return false;
      return true;
    });
    if (cand.length === 0) {
      return addLog(state, `${label}：棄牌區沒有符合的基本能量`, aIdx);
    }
    const realMax = Math.min(max, cand.length);
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從棄牌區選 1-${realMax} 張基本能量`, aIdx);
    return withPending(s, {
      type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr, minCount: 1, maxCount: realMax,
      effectKey: 'discard-energy-attach-pick-target',
      params: { label },
    });
  };
}
regR('discard-energy-attach-pick-target', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '棄牌能量附加';
  const p = st.players[idx];
  const allSelf = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  if (allSelf.length === 0) return st;
  // 若場上只有 1 隻寶可夢，直接附加
  if (allSelf.length === 1) {
    const target = allSelf[0];
    const energies = p.discard.filter(c => iids.includes(c.iid));
    const targetName = pool.get(target.cardId)?.name ?? '?';
    let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到 ${targetName}`, idx);
    return updatePlayer(s, idx, pl => {
      const rest = pl.discard.filter(c => !iids.includes(c.iid));
      if (pl.active && pl.active.iid === target.iid) {
        return {
          ...pl,
          discard: rest,
          active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] },
        };
      }
      return {
        ...pl,
        discard: rest,
        bench: pl.bench.map(c => c.iid === target.iid
          ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
          : c),
      };
    });
  }
  // 多隻寶可夢：進第二步
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'discard-energy-attach-commit',
    params: { energyIids: iids, label },
  });
});
regR('discard-energy-attach-commit', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '棄牌能量附加';
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.discard.filter(c => energyIids.includes(c.iid));
  if (energies.length === 0) return st;
  const targetName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到 ${targetName}`, idx);
  return updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => !energyIids.includes(c.iid));
    if (pl.active && pl.active.iid === targetIid) {
      return {
        ...pl,
        discard: rest,
        active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] },
      };
    }
    return {
      ...pl,
      discard: rest,
      bench: pl.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    };
  });
});

// 多目標 snipe：對手任意 N 隻寶可夢各 D 傷害
function multiSnipePost(targetCount: number, damage: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    const all = [d.active, ...d.bench].filter((c): c is CardInstance => !!c);
    if (all.length === 0) return state;
    const realMax = Math.min(targetCount, all.length);
    const s = addLog(state, `${label}：選擇對手 ${realMax} 隻寶可夢各造成 ${damage} 傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: realMax,
      effectKey: 'snipe-multi',
      params: { damage, label },
    });
  };
}
regR('snipe-multi', (st, actorIdx, selectedIids, params, pool) => {
  const dmg = (params?.damage as number) ?? 0;
  const label = (params?.label as string) ?? '多目標攻擊';
  // v2.46：caller 可用 kind 指定是招式傷害還是招式效果。預設 'attack-damage'。
  const kind = ((params?.kind as DamageKind) ?? 'attack-damage');
  const dIdx = (1 - actorIdx) as 0 | 1;
  let s = st;
  let totalPrize = 0;
  let opponentActiveKOed = false;
  for (const iid of selectedIids) {
    const defender = s.players[dIdx];
    const isActive = defender.active?.iid === iid;
    const target = isActive ? defender.active! : defender.bench.find(c => c.iid === iid);
    if (!target) continue;
    const targetCard = pool.get(target.cardId);
    // v2.46 對戰圓形只擋效果；花之帷幔只擋招式傷害到備戰（且非 ex）
    if (!isActive) {
      const g = resolveBenchGuard(s, pool, actorIdx, targetCard, kind);
      if (g.blocked) {
        const name = targetCard?.name ?? '?';
        s = addLog(s, `${label}：${name} 因${g.reason}不受傷害`, actorIdx);
        continue;
      }
    }
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
      totalPrize += p;
      const players = [...s.players] as [PlayerState, PlayerState];
      const newDefender = { ...defender, discard: [...defender.discard, ...ko] };
      if (isActive) { newDefender.active = null; opponentActiveKOed = true; }
      else newDefender.bench = defender.bench.filter(c => c.iid !== iid);
      players[dIdx] = newDefender;
      s = addLog({ ...s, players }, `${label}：${targetCard?.name ?? '?'} 被擊倒！+${p} 張獎勵牌。`, null);
    } else {
      const players = [...s.players] as [PlayerState, PlayerState];
      const newDefender = { ...defender };
      if (isActive) newDefender.active = { ...target, damage: newDmg };
      else newDefender.bench = defender.bench.map(c => c.iid === iid ? { ...c, damage: newDmg } : c);
      players[dIdx] = newDefender;
      s = addLog({ ...s, players }, `${label}：對 ${targetCard?.name ?? '?'} 造成 ${dmg} 傷害`, actorIdx);
    }
  }
  // 檢查 KO 後的狀態
  const defender = s.players[dIdx];
  if (opponentActiveKOed && !defender.active && defender.bench.length === 0) {
    return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
  }
  if (totalPrize > 0) s = { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + totalPrize };
  return s;
});

// ── 棄牌能量附加（6 張） ────────────────────────────────────────────────────
regPre('古劍豹|雪之到來', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古劍豹|雪之到來', discardEnergyAttachPost(2, 'Water', '雪之到來'));

regPre('古玉魚|閃焰到來', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古玉魚|閃焰到來', discardEnergyAttachPost(2, 'Fire', '閃焰到來'));

regPre('古簡蝸|綠葉到來', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古簡蝸|綠葉到來', discardEnergyAttachPost(2, 'Grass', '綠葉到來'));

regPre('古鼎鹿|沙之到來', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('古鼎鹿|沙之到來', discardEnergyAttachPost(2, 'Fighting', '沙之到來'));

regPre('土地雲|真氣之拳', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('土地雲|真氣之拳', (state, aIdx, pool) => {
  // 棄牌選 1 張基本能量附於自身（無屬性限制）
  const p = state.players[aIdx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (cand.length === 0) return addLog(state, '真氣之拳：棄牌區沒有基本能量', aIdx);
  const s = addLog(state, '真氣之拳：從棄牌區選 1 張基本能量', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy', minCount: 1, maxCount: 1,
    effectKey: 'discard-energy-attach-pick-target',
    params: { label: '真氣之拳' },
  });
});

regPre('多麗米亞|能量支援', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('多麗米亞|能量支援', (state, aIdx, pool) => {
  // 棄牌 1 張基本能量 → 附於備戰寶可夢
  const p = state.players[aIdx];
  if (p.bench.length === 0) return addLog(state, '能量支援：備戰區沒有寶可夢', aIdx);
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (cand.length === 0) return addLog(state, '能量支援：棄牌區沒有基本能量', aIdx);
  const s = addLog(state, '能量支援：從棄牌區選 1 張基本能量', aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy', minCount: 1, maxCount: 1,
    effectKey: 'discard-energy-attach-bench-only',
    params: { label: '能量支援' },
  });
});
regR('discard-energy-attach-bench-only', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '棄牌附能';
  const p = st.players[idx];
  if (p.bench.length === 0) return st;
  if (p.bench.length === 1) {
    const target = p.bench[0];
    const energies = p.discard.filter(c => iids.includes(c.iid));
    const tname = pool.get(target.cardId)?.name ?? '?';
    let s = addLog(st, `${label}：將能量附加到備戰 ${tname}`, idx);
    return updatePlayer(s, idx, pl => ({
      ...pl,
      discard: pl.discard.filter(c => !iids.includes(c.iid)),
      bench: pl.bench.map(c => c.iid === target.iid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    }));
  }
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'discard-energy-attach-commit-bench',
    params: { energyIids: iids, label },
  });
});
regR('discard-energy-attach-commit-bench', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '棄牌附能';
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.discard.filter(c => energyIids.includes(c.iid));
  const tname = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到備戰 ${tname}`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => !energyIids.includes(c.iid)),
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
});

// ── 多目標 snipe（1 張）─────────────────────────────────────────────────────
// 甲賀忍蛙ex｜分身連打 — v2.222 移除：v2.129 已在 line 10665 重新實裝為
//   ATTACK_PRE_DISCARD_CHOICE（玩家自選棄能量）+ opp-poke-choose（玩家自選 2 隻
//   對手寶可夢，戰鬥場仍套弱抗、備戰位不計）。舊版 slice(-2) 自動丟最後 2 張+
//   multiSnipePost(2, 120) 不正確（玩家無法選能量、目標、且戰/備抗區待遇相同）。
//   保留舊登錄會讓後者覆蓋，但 dead code 容易誤導，整段移除。

// 酋雷姆｜三重冰霜 — 丟自身全部能量 → 對手 3 隻各 110
regPre('酋雷姆|三重冰霜', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('酋雷姆|三重冰霜', (state, aIdx, pool) => {
  let s = state;
  const p = s.players[aIdx];
  if (!p.active || p.active.energyAttached.length === 0) {
    return addLog(s, '三重冰霜：自身無能量', aIdx);
  }
  const energies = p.active.energyAttached;
  s = addLog(s, `三重冰霜：丟棄自身 ${energies.length} 張能量`, aIdx);
  s = updatePlayer(s, aIdx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: [] },
      discard: [...pl.discard, ...energies],
    };
  });
  return multiSnipePost(3, 110, '三重冰霜')(s, aIdx, pool);
});

// ── 莫魯貝可｜能量車輪 70 — 選 2 張自身【惡】能量 → 改附於 1 隻備戰 ──────────
regPre('莫魯貝可|能量車輪', (state, _aIdx, _pool) => ({ state, damage: 70 }));
regPost('莫魯貝可|能量車輪', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  // 列出自身【惡】能量 iid
  const darkIids = p.active.energyAttached
    .filter(e => {
      const card = pool.get(e.cardId);
      return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Darkness';
    })
    .map(e => e.iid);
  if (darkIids.length < 2) {
    return addLog(state, '能量車輪：自身【惡】能量不足 2 張', aIdx);
  }
  if (p.bench.length === 0) {
    return addLog(state, '能量車輪：備戰區沒有寶可夢', aIdx);
  }
  // 自動挑前 2 個（AI 簡化；人類版應該用 pending，但這邊用簡化路徑）
  const picked = darkIids.slice(0, 2);
  const pickedEnergies = p.active.energyAttached.filter(e => picked.includes(e.iid));
  let s = addLog(state, '能量車輪：將自身 2 張【惡】能量改附於備戰', aIdx);
  s = updatePlayer(s, aIdx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      active: {
        ...pl.active,
        energyAttached: pl.active.energyAttached.filter(e => !picked.includes(e.iid)),
      },
    };
  });
  // 讓玩家選備戰目標
  return withPending(s, {
    type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'energy-wheel-attach',
    params: { energies: pickedEnergies },
  });
});
regR('energy-wheel-attach', (st, idx, iids, params, pool) => {
  const energies = (params?.energies as CardInstance[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tname = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `能量車輪：將 ${energies.length} 張能量附加到 ${tname}`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38ad v1.80 H 標第 25 波 — field discard×multiplier + 特能清除 + coin×energy
//
// Helpers:
//   fieldDiscardMultiplyPre(base, per, max, typeFilter, label) — 可丟場上（含備戰）能量
//   oppDiscardAllSpecialEnergyPost(label) — 清空對手全場特殊能量
//   coinByActiveEnergyPre(base, per, label, scope: 'self'|'both') — 擲硬幣=出場能量數
// 卡牌：
//   來悲粗茶 傾瀉茶 70×（草 max 3 場上）
//   猛雷鼓ex 極降駕 70×（basic 任意 場上）
//   蒼炎刃鬼 火焰咒詛（清除全場特殊能量）
//   厄鬼椪 火灶面具ex 極限火焰 140（若對手進化 +140 並丟全部自身能量）
//   怖納噬草 強力尖刺 80×硬幣正面數（=自身能量數）
//   椰蛋樹 投球時刻 60×硬幣正面數（=雙方出場能量和）
// ══════════════════════════════════════════════════════════════════════════════

type FieldDiscardFilter = 'all' | 'basic' | EnergyType;

function fieldDiscardMultiplyPre(
  baseDamage: number,
  per: number,
  max: number,
  typeFilter: FieldDiscardFilter,
  label: string,
): AttackPreFn {
  return (state, aIdx, pool, action) => {
    const player = state.players[aIdx];
    // 列出場上（含備戰）所有符合條件的能量
    type Loc = { host: 'active' | number; energy: CardInstance };
    const eligible: Loc[] = [];
    const matches = (e: CardInstance): boolean => {
      const c = pool.get(e.cardId);
      if (!c || c.supertype !== 'Energy') return false;
      if (typeFilter === 'all') return true;
      if (typeFilter === 'basic') return c.subtype === 'Basic';
      return c.pokemonType === typeFilter;
    };
    if (player.active) {
      for (const e of player.active.energyAttached) {
        if (matches(e)) eligible.push({ host: 'active', energy: e });
      }
    }
    player.bench.forEach((b, i) => {
      for (const e of b.energyAttached) {
        if (matches(e)) eligible.push({ host: i, energy: e });
      }
    });

    // 決定要丟的 iid 清單
    const chosenIids = action?.discardedEnergyIids;
    let selected: Loc[];
    if (chosenIids && chosenIids.length > 0) {
      const idSet = new Set(chosenIids);
      selected = eligible.filter(l => idSet.has(l.energy.iid)).slice(0, max);
    } else {
      // 自動 fallback：從尾端挑 max 個
      const n = Math.min(max, eligible.length);
      selected = eligible.slice(-n);
    }
    if (selected.length === 0) {
      return { state: addLog(state, `${label}：未丟棄任何能量 → ${baseDamage}`, aIdx), damage: baseDamage };
    }

    // 依 host 分組
    const activeRm = new Set<string>();
    const benchRm = new Map<number, Set<string>>();
    for (const s of selected) {
      if (s.host === 'active') activeRm.add(s.energy.iid);
      else {
        const st = benchRm.get(s.host) ?? new Set<string>();
        st.add(s.energy.iid);
        benchRm.set(s.host, st);
      }
    }

    const discardList = selected.map(s => s.energy);
    let s2 = updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => !activeRm.has(e.iid)) } : null,
      bench: p.bench.map((b, i) => {
        const rm = benchRm.get(i);
        if (!rm || rm.size === 0) return b;
        return { ...b, energyAttached: b.energyAttached.filter(e => !rm.has(e.iid)) };
      }),
      discard: [...p.discard, ...discardList],
    }));
    const dmg = baseDamage + per * selected.length;
    s2 = addLog(s2, `${label}：丟棄 ${selected.length} 個能量 → ${dmg}`, aIdx);
    return { state: s2, damage: dmg };
  };
}

function registerFieldDiscardMultiply(
  key: string,
  label: string,
  baseDamage: number,
  per: number,
  max: number,
  typeFilter: FieldDiscardFilter,
) {
  ATTACK_PRE_DISCARD_CHOICE.set(key, {
    min: 0,
    max,
    scope: 'any-own',
    baseDamage,
    damagePerEnergy: per,
  });
  regPre(key, fieldDiscardMultiplyPre(baseDamage, per, max, typeFilter, label));
}

// 來悲粗茶｜傾瀉茶 — 最多 3 張自己場上【草】能量 × 70
registerFieldDiscardMultiply('來悲粗茶|傾瀉茶', '傾瀉茶', 0, 70, 3, 'Grass');

// 猛雷鼓ex｜極降駕 — 任意張數自己場上基本能量 × 70（以大 max 近似 "任意"）
registerFieldDiscardMultiply('猛雷鼓ex|極降駕', '極降駕', 0, 70, 20, 'basic');

// ── 蒼炎刃鬼｜火焰咒詛 — 將對手全場特殊能量全部丟棄 ───────────────────────
regPre('蒼炎刃鬼|火焰咒詛', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('蒼炎刃鬼|火焰咒詛', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  let removed = 0;
  const removedEnergies: CardInstance[] = [];
  const stripSpecial = (inst: CardInstance): CardInstance => {
    const specials: CardInstance[] = [];
    const kept: CardInstance[] = [];
    for (const e of inst.energyAttached) {
      const c = pool.get(e.cardId);
      if (c && c.supertype === 'Energy' && c.subtype === 'Special') {
        specials.push(e);
      } else {
        kept.push(e);
      }
    }
    removed += specials.length;
    removedEnergies.push(...specials);
    return { ...inst, energyAttached: kept };
  };
  let s = state;
  s = updatePlayer(s, dIdx, p => ({
    ...p,
    active: p.active ? stripSpecial(p.active) : null,
    bench: p.bench.map(stripSpecial),
    discard: [...p.discard, ...removedEnergies],
  }));
  if (removed === 0) {
    return addLog(s, '火焰咒詛：對手全場沒有特殊能量', aIdx);
  }
  return addLog(s, `火焰咒詛：丟棄對手全場 ${removed} 張特殊能量`, aIdx);
});

// ── 厄鬼椪 火灶面具ex｜極限火焰 — 140（若對手是進化寶可夢 +140，並丟自身全部能量）
regPre('厄鬼椪 火灶面具ex|極限火焰', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return { state, damage: 140 };
  const defCard = pool.get(def.cardId);
  const isEvo = !!(defCard?.evolvesFrom);
  if (!isEvo) {
    return { state: addLog(state, '極限火焰：對手非進化寶可夢', aIdx), damage: 140 };
  }
  // 是進化寶可夢：+140 並丟自身全部能量
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 280 };
  let s = addLog(state, `極限火焰：對手為進化寶可夢 → +140（丟自身 ${att.energyAttached.length} 張能量）`, aIdx);
  s = updatePlayer(s, aIdx, p => {
    if (!p.active) return p;
    const ens = p.active.energyAttached;
    return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...ens] };
  });
  return { state: s, damage: 280 };
});

// ── 怖納噬草｜強力尖刺 — 擲與自身能量數同次硬幣，正面 × 80 ──────────────
regPre('怖納噬草|強力尖刺', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 0 };
  const n = countOneEnergy(att, 'all', pool);
  if (n === 0) return { state: addLog(state, '強力尖刺：自身無能量', aIdx), damage: 0 };
  let heads = 0;
  const seq: string[] = [];
  for (let i = 0; i < n; i++) {
    const h = Math.random() < 0.5;
    if (h) heads++;
    seq.push(h ? '正' : '反');
  }
  const dmg = heads * 80;
  const s = addLog(state, `強力尖刺：擲 ${n} 次硬幣 [${seq.join(' ')}] → 正面 ${heads} 次 × 80 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ── 椰蛋樹｜投球時刻 — 擲與雙方出場能量和同次硬幣，正面 × 60 ────────────
regPre('椰蛋樹|投球時刻', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const att = state.players[aIdx].active;
  const def = state.players[dIdx].active;
  const n = (att ? countOneEnergy(att, 'all', pool) : 0) + (def ? countOneEnergy(def, 'all', pool) : 0);
  if (n === 0) return { state: addLog(state, '投球時刻：雙方出場皆無能量', aIdx), damage: 0 };
  let heads = 0;
  const seq: string[] = [];
  for (let i = 0; i < n; i++) {
    const h = Math.random() < 0.5;
    if (h) heads++;
    seq.push(h ? '正' : '反');
  }
  const dmg = heads * 60;
  const s = addLog(state, `投球時刻：擲 ${n} 次硬幣 [${seq.join(' ')}] → 正面 ${heads} 次 × 60 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38ae v1.81 H 標第 26 波 — damage-plus 下回合加傷 + 特性加傷（4 張）
//
// 引擎新增：CardInstance.damageBonusPending / damageBonusThisTurn
//   POST 設 damageBonusPending = N → END_TURN promote 為 damageBonusThisTurn
//   → 下個自己回合招式發動時，base damage +N（weakness 前套用），用完即清
//
// Helpers:
//   setSelfDamageBonusPendingPost(amount, label) — 打完招設下 N
// 卡牌：
//   巨金怪 彗星拳 60（下回合 +60）
//   大電海燕 風力充能 10（下回合 +120）
//   電蜘蛛 複眼（PRE：若對手戰鬥擁有特性則 +50，和 麻麻羅網 疊加）
// ══════════════════════════════════════════════════════════════════════════════

function setSelfDamageBonusPendingPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att) return state;
    const name = pool.get(att.cardId)?.name ?? '?';
    const s = addLog(state, `${label}：${name} 下回合招式傷害 +${amount}`, aIdx);
    return updatePlayer(s, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageBonusPending: (p.active.damageBonusPending ?? 0) + amount } : null,
    }));
  };
}

regPost('巨金怪|彗星拳', setSelfDamageBonusPendingPost(60, '彗星拳'));
regPost('大電海燕|風力充能', setSelfDamageBonusPendingPost(120, '風力充能'));

// 電蜘蛛｜麻麻羅網 — 既有 50 base + coin heads→poison；再疊加 複眼 +50 若對手戰鬥擁有特性
// 原 PRE 保留，在既有基礎上加 dmg 前先檢查 + wrap
const _originalMaMaLuoWangPre = ATTACK_PRE.get('電蜘蛛|麻麻羅網');
if (_originalMaMaLuoWangPre) {
  regPre('電蜘蛛|麻麻羅網', (state, aIdx, pool, action) => {
    const r = _originalMaMaLuoWangPre(state, aIdx, pool, action);
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def || r.damage <= 0) return r;
    const defCard = pool.get(def.cardId);
    if (!defCard?.abilities || defCard.abilities.length === 0) return r;
    const dmg = r.damage + 50;
    const s = addLog(r.state, `複眼：對手擁有特性 → 麻麻羅網 +50 = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Session 38af v1.82 H 標第 27 波 — KO-check / self-damage / 條件 cantAttackPending
//
// 新實裝 6 張（懶人獺 已於 E 區就地修改）：
//   1. 轟鳴月ex｜瘋癲攻擊     — KO 對手戰鬥寶可夢；自己受 200 傷害
//   2. 鐵臂膀ex｜感激放大     — 120 傷害；若 KO 對手，+1 獎勵牌
//   3. 鐵包袱｜冷卻噴射       — 80 傷害；若對手為進化寶可夢，下回合無法使用招式
//   4. 帕底亞 肯泰羅｜障礙踩踏 — 90 傷害；若對手為基礎寶可夢，下回合無法使用招式
//   5. 冰伊布ex｜藍柱石       — 選 1 隻身上放有 ≥6 傷害指示物的對手寶可夢 KO
//
// 機制：
//   - bonusPrizeIfKOPost：post 階段檢查 def.active === null（KO 了）→ +N pendingPrizes
//   - defCantAttackIfSubtypePost：若對手仍存活且符合 subtype → 設 cantAttackPending
//   - 藍柱石：透過 opp-poke-choose pendingSelection（含出場，但需 damage ≥ 60）
// ══════════════════════════════════════════════════════════════════════════════

// 攻擊後若對手出場已 KO（active === null）→ 額外加 N 張獎勵牌
function bonusPrizeIfKOPost(bonus: number, label: string): AttackPostFn {
  return (state, aIdx) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    if (state.players[dIdx].active !== null) return state;
    if (state.pendingPrizes <= 0) return state;
    const s = addLog(state, `${label}：擊倒對手 → 多獲得 ${bonus} 張獎勵牌`, aIdx);
    return { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + bonus };
  };
}

// 攻擊後若對手 Active 仍存活且符合 subtype（Basic/進化）→ 設 cantAttackPending
function defCantAttackIfSubtypePost(
  cond: 'basic' | 'evolved',
  label: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def) return state;
    const card = pool.get(def.cardId);
    if (!card) return state;
    const matches =
      cond === 'basic'
        ? card.subtype === 'Basic'
        : (card.subtype === 'Stage1' || card.subtype === 'Stage2');
    if (!matches) {
      return addLog(state, `${label}：對手不符合條件（${cond === 'basic' ? '基礎' : '進化'}寶可夢），無附加效果`, aIdx);
    }
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...players[dIdx], active: { ...def, cantAttackPending: true } };
    return addLog(
      { ...state, players },
      `${label}：${card.name} 在下個對手回合無法使用招式`,
      aIdx,
    );
  };
}

// 鐵臂膀ex｜感激放大 — 120 傷害，若 KO → +1 獎勵牌
regPost('鐵臂膀ex|感激放大', bonusPrizeIfKOPost(1, '感激放大'));

// 鐵包袱｜冷卻噴射 — 80 傷害，若對手為進化寶可夢 → 下回合無法使用招式
regPost('鐵包袱|冷卻噴射', defCantAttackIfSubtypePost('evolved', '冷卻噴射'));

// 帕底亞 肯泰羅｜障礙踩踏 — 90 傷害，若對手為基礎寶可夢 → 下回合無法使用招式
regPost('帕底亞 肯泰羅|障礙踩踏', defCantAttackIfSubtypePost('basic', '障礙踩踏'));

// 轟鳴月ex｜瘋癲攻擊 — KO 對手戰鬥寶可夢，然後自己受 200 傷害
regPre('轟鳴月ex|瘋癲攻擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('轟鳴月ex|瘋癲攻擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  // (1) KO 對手戰鬥寶可夢（如果還在）
  const def = s.players[dIdx];
  if (def.active) {
    const defCard = pool.get(def.active.cardId);
    const ko: CardInstance[] = [
      { ...def.active, damage: defCard?.hp ?? 0 },
      ...def.active.energyAttached,
      ...(def.active.toolAttached ? [def.active.toolAttached] : []),
      ...(def.active.evolvedFromStack ?? []),
    ];
    const prizes = defCard ? koPrizeCount(defCard) : 1;
    const players = [...s.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...def, active: null, discard: [...def.discard, ...ko] };
    s = addLog({ ...s, players }, `瘋癲攻擊：${defCard?.name ?? '?'} 被擊倒！+${prizes} 張獎勵牌`, null);
    s = { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + prizes };
    if (players[dIdx].bench.length === 0) {
      return { ...s, phase: 'game-over', winner: aIdx, winReason: `${def.name} 沒有可上場的寶可夢` };
    }
  }
  // (2) 自己受 200 傷害（若超過 HP → 自爆 KO，對方取獎）
  const players2 = [...s.players] as [PlayerState, PlayerState];
  const att = { ...players2[aIdx] };
  if (att.active) {
    const attCard = pool.get(att.active.cardId);
    const newDmg = att.active.damage + 200;
    const hp = effectiveHPInline(att.active, pool, s);
    if (hp > 0 && newDmg >= hp) {
      // 自爆 KO
      const ko: CardInstance[] = [
        { ...att.active, damage: newDmg },
        ...att.active.energyAttached,
        ...(att.active.toolAttached ? [att.active.toolAttached] : []),
        ...(att.active.evolvedFromStack ?? []),
      ];
      att.active = null;
      att.discard = [...att.discard, ...ko];
      players2[aIdx] = att;
      const prizes = attCard ? koPrizeCount(attCard) : 1;
      s = addLog({ ...s, players: players2 }, `瘋癲攻擊：${attCard?.name ?? '?'} 反噬昏厥！對手取得 ${prizes} 張獎勵牌`, null);
      const opponent = s.players[dIdx];
      const take = Math.min(prizes, opponent.prizes.length);
      if (take > 0) {
        const taken = opponent.prizes.slice(0, take);
        const finalPlayers = [...s.players] as [PlayerState, PlayerState];
        finalPlayers[dIdx] = { ...opponent, prizes: opponent.prizes.slice(take), hand: [...opponent.hand, ...taken] };
        s = { ...s, players: finalPlayers };
        s = addLog(s, `${opponent.name} 取走 ${take} 張獎勵牌`, null);
        if (finalPlayers[dIdx].prizes.length === 0) {
          return { ...s, phase: 'game-over', winner: dIdx, winReason: '取得所有獎勵牌' };
        }
      }
      if (att.bench.length === 0) {
        return { ...s, phase: 'game-over', winner: dIdx, winReason: `${att.name} 沒有可上場的寶可夢` };
      }
    } else {
      att.active = { ...att.active, damage: newDmg };
      players2[aIdx] = att;
      s = addLog({ ...s, players: players2 }, `瘋癲攻擊：${attCard?.name ?? '?'} 受到 200 傷害`, aIdx);
    }
  }
  return s;
});

// 冰伊布ex｜藍柱石 — 選 1 隻身上放有 ≥6 傷害指示物的對手寶可夢（含出場）→ KO
regPre('冰伊布ex|藍柱石', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('冰伊布ex|藍柱石', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  // 有效目標 = damage >= 60（6 個傷害指示物）
  const heavy = (c: CardInstance): boolean => c.damage >= 60;
  const candidates: CardInstance[] = [];
  if (def.active && heavy(def.active)) candidates.push(def.active);
  for (const b of def.bench) if (heavy(b)) candidates.push(b);
  if (candidates.length === 0) {
    return addLog(state, '藍柱石：對手無受 6 個以上傷害指示物的寶可夢，無效', aIdx);
  }
  if (candidates.length === 1) {
    // 只有一隻符合條件 → 直接 KO，不需 pendingSelection
    const target = candidates[0];
    const isActive = def.active?.iid === target.iid;
    return resolveLanzhushi(state, aIdx, target, isActive, pool);
  }
  // 多個候選 → 以 opp-poke-choose pendingSelection
  let s = addLog(state, `藍柱石：選擇 1 隻身上有 6 個以上傷害指示物的對手寶可夢，將其昏厥`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx,
    sourcePlayerIdx: dIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'lanzhushi-ko',
    params: { minDamage: 60 },
  });
});

// 藍柱石 resolver 共用：直接 KO target
function resolveLanzhushi(
  state: GameState,
  aIdx: 0 | 1,
  target: CardInstance,
  isActive: boolean,
  pool: Map<string, Card>,
): GameState {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  const card = pool.get(target.cardId);
  const ko: CardInstance[] = [
    { ...target, damage: (card?.hp ?? 0) },
    ...target.energyAttached,
    ...(target.toolAttached ? [target.toolAttached] : []),
    ...(target.evolvedFromStack ?? []),
  ];
  const prizes = card ? koPrizeCount(card) : 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const newDef = { ...def, discard: [...def.discard, ...ko] };
  if (isActive) newDef.active = null;
  else newDef.bench = def.bench.filter(b => b.iid !== target.iid);
  players[dIdx] = newDef;
  let s = addLog({ ...state, players }, `藍柱石：${card?.name ?? '?'} 被擊倒！+${prizes} 張獎勵牌`, null);
  if (isActive && newDef.bench.length === 0) {
    return { ...s, phase: 'game-over', winner: aIdx, winReason: `${def.name} 沒有可上場的寶可夢` };
  }
  return { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + prizes };
}

regR('lanzhushi-ko', (st, actorIdx, selectedIids, params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const def = st.players[dIdx];
  const minDmg = Number(params?.minDamage ?? 60);
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  const isActive = def.active?.iid === targetIid;
  const target = isActive ? def.active! : def.bench.find(b => b.iid === targetIid);
  if (!target || target.damage < minDmg) return st;
  return resolveLanzhushi(st, actorIdx, target, isActive, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Session 38ag v1.83 H 標第 28 波 — 抽卡批次 + 狀態補完 + 自傷 + 其他簡單機制
//
// 不新增機制，大多是把剩下符合現有 helper 的卡牌補齊。
// 1) 抽 N 張（22 張）— reuse drawNPost
// 2) 對手狀態（5 張）— reuse statusPost
// 3) 自己狀態（2 張）— selfStatusPost(status)
// 4) 自傷反動（3 張）— reuse selfHitPost
// 5) 其他：丟競技場 1 張、對手牌庫頂丟 1 張、道具防守回轉
// ══════════════════════════════════════════════════════════════════════════════

// ── (1) 抽 N 張 ─────────────────────────────────────────────────────────────
regPost('貓鼬少|呼喚', drawNPost(1, '呼喚'));
regPost('拉魯拉絲|呼喚', drawNPost(1, '呼喚'));
regPost('木棉球|呼喚', drawNPost(1, '呼喚'));
regPost('瑪沙那|呼喚', drawNPost(1, '呼喚'));
regPost('呱呱泡蛙|呼喚', drawNPost(1, '呼喚'));
regPost('火稚雞|呼喚', drawNPost(1, '呼喚'));
regPost('花椰猴|呼喚', drawNPost(1, '呼喚'));
regPost('冷水猴|呼喚', drawNPost(1, '呼喚'));
regPost('爆香猴|呼喚', drawNPost(1, '呼喚'));
regPost('<阿響的>皮丘|麻麻抽出', drawNPost(1, '麻麻抽出'));
regPost('嗡蝠|快速抽出', drawNPost(1, '快速抽出'));

regPost('超級巨牙鯊ex|貪心之牙', drawNPost(2, '貪心之牙'));
regPost('劈斬司令|快速抽出', drawNPost(2, '快速抽出'));
regPost('瑪機雅娜|扣殺抽出', drawNPost(2, '扣殺抽出'));
regPost('龜腳腳|雙重抽出', drawNPost(2, '雙重抽出'));
regPost('拉帝亞斯|吸引', drawNPost(2, '吸引'));
regPost('象徵鳥|雙重抽出', drawNPost(2, '雙重抽出'));
regPost('胡帕|偷盜', drawNPost(2, '偷盜'));
regPost('貓鼬斬ex|扣殺抽出', drawNPost(2, '扣殺抽出'));
regPost('怒鸚哥|叼', drawNPost(2, '叼'));

regPost('青銅鐘|三重抽出', drawNPost(3, '三重抽出'));
regPost('大王燕|叼', drawNPost(3, '叼'));

regPost('高傲雉雞|叼', drawNPost(4, '叼'));

// ── (2) 對手狀態（補完）─────────────────────────────────────────────────────
regPost('狡猾天狗|蠱惑', statusPost('confused'));
regPost('波爾凱尼恩|灼熱', statusPost('burned'));
regPost('滋汁鼴|毒擊', statusPost('poisoned'));
regPost('蔓藤怪|毒粉', statusPost('poisoned'));
regPost('火炎獅|灼燒', statusPost('burned'));

// ── (3) 自己狀態（攻擊者自身）────────────────────────────────────────────────
function selfStatusPost(status: SpecialCondition): AttackPostFn {
  return (state, aIdx, pool) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (!att.active) return state;
    const attName = pool.get(att.active.cardId)?.name ?? '?';
    const statusLabelMap: Record<string, string> = {
      poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
    };
    att.active = { ...att.active, status };
    players[aIdx] = att;
    return addLog({ ...state, players }, `${attName} 陷入【${statusLabelMap[status]}】`, aIdx);
  };
}
regPost('卡比獸|倒下', selfStatusPost('asleep'));
regPost('章魚桶|暴走', selfStatusPost('confused'));

// ── (4) 自傷反動（補完）─────────────────────────────────────────────────────
regPost('龍蝦小兵|猛撞', selfHitPost(10));
regPost('鐵掌力士|狂野壓制', selfHitPost(70));
regPost('毒骷蛙|突擊', selfHitPost(20));

// ── (5) 其他單張簡單機制 ────────────────────────────────────────────────────

// 切割洛托姆｜割除利刃 20 — 將場上競技場卡丟棄
regPost('切割洛托姆|割除利刃', discardStadiumPost('割除利刃', false));

// 花岩怪｜崩山 10 — 將對手牌庫頂 1 張丟棄
regPost('花岩怪|崩山', millOppDeckTopPost(1, '崩山'));

// 頓甲｜防守回轉 120 — 自己丟 2 張能量（作為成本）+ 下回合受招式傷害 -100
// 先登 ATTACK_PRE_DISCARD_CHOICE 讓 UI 彈窗，再在 PRE 執行丟棄與傷害，POST 設置減傷旗標
registerSelfDiscardMultiply('頓甲|防守回轉', '防守回轉', 120, 0, 2, 'all');
regPost('頓甲|防守回轉', selfDmgReducePost(100));

// 古劍豹｜冰柱閉環 120 — 選 1 張自身能量放回手牌
regPost('古劍豹|冰柱閉環', returnSelfActiveEnergyPost(1, true, '冰柱閉環'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 29 (v1.84) — 看對手手牌 + 對手手牌丟棄 + 狀態/自傷批次補完
// ══════════════════════════════════════════════════════════════════════════════

// ── (1) 查看對手手牌（新增 3 張）────────────────────────────────────────────
regPre('妙喵|看透', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('妙喵|看透', peekOppHandPost('看透'));

regPre('小貓怪|好奇心', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('小貓怪|好奇心', peekOppHandPost('好奇心'));

regPre('豆豆鴿|偵察', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('豆豆鴿|偵察', peekOppHandPost('偵察'));

// ── (2) 洛托姆｜粉碎脈衝 — 查看對手手牌，將其中「物品」「道具」卡全部丟棄 ─
regPre('洛托姆|粉碎脈衝', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('洛托姆|粉碎脈衝', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[dIdx];
  if (p.hand.length === 0) return addLog(state, '粉碎脈衝：對手手牌為空', aIdx);
  const handNames = p.hand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `粉碎脈衝：查看對手手牌（${p.hand.length} 張）— ${handNames}`, aIdx);
  const toDiscard = p.hand.filter(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    // 「物品」= Trainer/Item, 「寶可夢道具」= Pokemon/Other (tool)
    const isItem = card.supertype === 'Trainer' && card.subtype === 'Item';
    const isTool = card.supertype === 'Trainer' && card.subtype === 'PokemonTool';
    return isItem || isTool;
  });
  if (toDiscard.length === 0) {
    return addLog(s, '粉碎脈衝：對手手牌無物品或道具卡', aIdx);
  }
  const discardNames = toDiscard.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const toDiscardIids = new Set(toDiscard.map(c => c.iid));
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = {
    ...players[dIdx],
    hand: p.hand.filter(c => !toDiscardIids.has(c.iid)),
    discard: [...p.discard, ...toDiscard],
  };
  return addLog({ ...s, players }, `粉碎脈衝：將對手 ${toDiscard.length} 張物品/道具卡丟棄 — ${discardNames}`, aIdx);
});

// ── (3) statusPost 批次補完 ─────────────────────────────────────────────────
// 混亂類
regPost('光電傘蜥|閃光彈', statusPost('confused'));
regPost('火箭隊的大嘴蝠|奇異之光', statusPost('confused'));
regPost('火箭隊的大嘴蝠|奇異之光', statusPost('confused'));
regPost('超能妙喵|蠱惑', statusPost('confused'));
regPost('超音蝠|超音波', statusPost('confused'));
regPost('死神棺|蠱惑', statusPost('confused'));
regPost('花舞鳥|眩目舞', statusPost('confused'));
regPost('音波龍|恐慌嚎鳴', statusPost('confused'));
regPost('火箭隊的貓老大ex|殘酷斬', statusPost('confused'));
regPost('雙彈瓦斯|充滿瓦斯', statusPost('confused'));

// 中毒類
regPost('天蠍|毒擊', statusPost('poisoned'));
regPost('鉗尾蠍|毒擊', statusPost('poisoned'));
regPost('火箭隊的超音蝠|噴毒', statusPost('poisoned'));
regPost('火箭隊的超音蝠|噴毒', statusPost('poisoned'));
regPost('<莉佳的>臭臭花|噴毒', statusPost('poisoned'));
regPost('哎呀球菇|毒之孢子', statusPost('poisoned'));
regPost('灰塵山|垃圾射擊', statusPost('poisoned'));
regPost('火箭隊的小拉達|險惡門牙', statusPost('poisoned'));
regPost('百足蜈蚣|噴毒', statusPost('poisoned'));

// 睡眠類
regPost('超級雪妖女ex|純粹雪', statusPost('asleep'));
regPost('冰雪龍|冰凍之風', statusPost('asleep'));
regPost('派拉斯特|蘑菇孢子', statusPost('asleep'));
regPost('火箭隊的催眠貘|催眠光線', statusPost('asleep'));
regPost('夢夢蝕|睡眠波動', statusPost('asleep'));

// 灼傷類
regPost('六尾|灼熱', statusPost('burned'));
regPost('炒炒豬|火焰灼燒', statusPost('burned'));
regPost('達摩狒狒|灼燒', statusPost('burned'));
regPost('厄鬼椪 火灶面具|灼燒', statusPost('burned'));
regPost('加熱洛托姆|灼熱', statusPost('burned'));

// ── (4) 自傷反動批次補完（selfHitPost）────────────────────────────────────
regPost('落雷獸|電流攻擊', selfHitPost(10));
regPost('墓仔狗|猛撞', selfHitPost(10));
regPost('萊希拉姆|燃燒閃焰', selfHitPost(60));
regPost('帕底亞 肯泰羅|捨身衝撞', selfHitPost(20));
regPost('利牙魚|突擊', selfHitPost(10));
regPost('火箭隊的團珠蛛|猛撞', selfHitPost(10));
regPost('火箭隊的椰蛋樹|捨身衝撞', selfHitPost(30));
regPost('頑皮熊貓|突擊', selfHitPost(10));
regPost('仆斬將軍|雙刃斬', selfHitPost(50));
regPost('赫普的卡比獸|極限壓制', selfHitPost(80));
regPost('藤藤蛇|突擊', selfHitPost(10));
regPost('小拉達|猛撞', selfHitPost(10));
regPost('泡沫栗鼠|猛撞', selfHitPost(10));
regPost('<莉佳的>走路草|突擊', selfHitPost(10));
regPost('烈焰馬|猛火猛撞', selfHitPost(30));
regPost('超級炎武王ex|深紅炸彈', selfHitPost(60));
regPost('小鋸鱷|撞一下', selfHitPost(10));
regPost('阿羅拉 隆隆岩|百萬噸墜落', selfHitPost(40));
regPost('固拉多|百萬噸墜落', selfHitPost(30));
// v2.22：訓練家寶可夢卡名統一 strip 掉 <> 冠名（pool.ts loadSet 會 normalize）
regPost('派帕的原野水母|撞一下', selfHitPost(10));
regPost('派帕的陸地水母|突擊', selfHitPost(30));
regPost('瑪俐的頭巾混混|狂野衝撞', selfHitPost(30));
regPost('索羅亞|猛撞', selfHitPost(10));
regPost('下石鳥|突擊', selfHitPost(20));
regPost('騎士蝸牛|狂野槍', selfHitPost(30));
regPost('伽勒爾 泥巴魚|飛撲啃咬', selfHitPost(30));
regPost('寶貝龍|突擊', selfHitPost(10));
regPost('故勒頓ex|凱撒衝撞', selfHitPost(60));
regPost('貓鼬斬ex|狂野剪', selfHitPost(30));
regPost('<青木的>勇士雄鷹|勇鳥猛攻', selfHitPost(30));
regPost('刺梭魚|突擊', selfHitPost(10));
regPost('沙基拉斯|猛撞', selfHitPost(20));

// ── (5) Mill 對手牌庫補完 ───────────────────────────────────────────────────
regPost('超級赫拉克羅斯ex|推山', millOppDeckTopPost(2, '推山'));
regPost('鐵骨土人|臂錘', millOppDeckTopPost(1, '臂錘'));
regPost('厄鬼椪 礎石面具|推山', millOppDeckTopPost(1, '推山'));
regPost('火箭隊的幼基拉斯|嚼山', millOppDeckTopPost(1, '嚼山'));
regPost('班基拉斯|斷裂頓足', millOppDeckTopPost(2, '斷裂頓足'));

// ── (6) 自己 mill（將自己的牌庫頂 N 張丟棄）─ 沿用既有 millSelfDeckTopPost ─
regPost('黏美龍|龍之波動', millSelfDeckTopPost(1, '龍之波動'));


// ══════════════════════════════════════════════════════════════════════════════
// Wave 30 (v1.85) — 補完現有 helper 套用 + 新增 helpers（單一/條件/能量×倍率）
// ══════════════════════════════════════════════════════════════════════════════

// ── (A) 既有 coin helper 補完 ───────────────────────────────────────────────
// coinPlusDmg(base, bonus) — 擲 1 次硬幣若正面 +N
regPre('來電汪|嬉鬧', coinPlusDmg(20, 20));

// coinHeadsMultiplyPre(flips, perHead, label)
regPre('變澀蜥|二連撞', coinHeadsMultiplyPre(2, 30, '二連撞'));
regPre('跳跳豬|三重旋轉', coinHeadsMultiplyPre(3, 10, '三重旋轉'));

// coinTailsFailPre(base, label)
regPre('炎兔兒|踹', coinTailsFailPre(30, '踹'));

// coinUntilTailsMultiplyPre(perHead, base, label)
regPre('胖丁|滾球', coinUntilTailsMultiplyPre(20, 0, '滾球'));
regPre('無畏小子|叩叩打擊', coinUntilTailsMultiplyPre(30, 10, '叩叩打擊'));

// coinHeadsSelfImmuneNextPost(label) — 0 dmg + 正面則自己下回合免疫
regPre('銅鏡怪|鐵壁', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('銅鏡怪|鐵壁', coinHeadsSelfImmuneNextPost('鐵壁'));

// ── (B) registerSelfDiscardMultiply 補完（自身丟能量為 cost） ─────────────
// 千面避役｜水射擊 110 — 丟 1 自身能量（cost）
registerSelfDiscardMultiply('千面避役|水射擊', '水射擊', 110, 0, 1, 'all');

// 超級噴火駝ex｜火山流星 280 — 丟 2 自身能量
registerSelfDiscardMultiply('超級噴火駝ex|火山流星', '火山流星', 280, 0, 2, 'all');

// 鋼炮臂蝦｜水之發射器 210 — 丟所有自身能量
registerSelfDiscardMultiply('鋼炮臂蝦|水之發射器', '水之發射器', 210, 0, 99, 'all');

// 雷吉艾斯ex｜冰之牢籠 140 — 丟 2 自身能量 + 對手【麻痺】
registerSelfDiscardMultiply('雷吉艾斯ex|冰之牢籠', '冰之牢籠', 140, 0, 2, 'all');
regPost('雷吉艾斯ex|冰之牢籠', statusPost('paralyzed'));

// ── (C) selfHealPost 補完 ────────────────────────────────────────────────
// 超級妙蛙花ex｜叢林拋擲 240 + 自癒 30
regPost('超級妙蛙花ex|叢林拋擲', selfHealPost(30, '叢林拋擲'));

// 麻麻小魚｜紋絲不動 0 + 自癒 10
regPre('麻麻小魚|紋絲不動', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('麻麻小魚|紋絲不動', selfHealPost(10, '紋絲不動'));

// ── (D) statusPost 多狀態（取主要狀態） ─────────────────────────────────
// 霸王花｜花粉炸彈 30 + 中毒（規則 says 中毒+睡眠，但引擎僅單一 status，取中毒）
regPost('霸王花|花粉炸彈', statusPost('poisoned'));

// ── (E) oppDiscardRandomHand / oppSwapDmgPost / discardOppActiveEnergyPost ──
// 滑滑小子｜拍落 20 + 對手手牌隨機丟 1
regPost('滑滑小子|拍落', oppDiscardRandomHand(1, '拍落'));

// 皮皮｜看我嘛 0 + 選對手備戰 1 隻與戰鬥場互換（無傷）
regPre('皮皮|看我嘛', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('皮皮|看我嘛', oppSwapDmgPost(0, '看我嘛'));

// 鋁鋼龍｜破壞光線 70 + 丟對手戰鬥能量 1 張
regPost('鋁鋼龍|破壞光線', discardOppActiveEnergyPost('破壞光線', 'any'));

// ── (F) selfSwapPost / selfDmgReducePost / selfCantAttackNextPost ──────
// 鐵面忍者｜急速折返 90 + 自己換場
regPost('鐵面忍者|急速折返', selfSwapPost('急速折返'));

// 椰蛋樹｜防守壓制 30 + 下次受傷 -30
regPost('椰蛋樹|防守壓制', selfDmgReducePost(30));

// 巨石丁｜潛力 140 + 自己下回合無法使用招式
regPost('巨石丁|潛力', selfCantAttackNextPost());

// 妙蛙種子｜束縛 10 + 對手下回合無法撤退
regPost('妙蛙種子|束縛', defCantRetreatNextPost());

// ── (G) defIsExPre — 對手為 ex/V → +N ──────────────────────────────────
regPre('火焰鳥|鬥志之翼', defIsExPre(20, 90, '鬥志之翼'));

// ── (H) deck-search 補完 ────────────────────────────────────────────────
// 炭小侍｜集力 0 + 從牌庫選最多 2 張基本能量加手牌
regPre('炭小侍|集力', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('炭小侍|集力', deckSearchToHandPost(2, 'BasicEnergy', '集力'));

// 呆火駝｜呼朋引伴 0 + 從牌庫選最多 2 隻基礎寶可夢放備戰
regPre('呆火駝|呼朋引伴', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('呆火駝|呼朋引伴', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '呼朋引伴：牌庫為空', aIdx);
  if (p.bench.length >= 5) return addLog(state, '呼朋引伴：備戰區已滿', aIdx);
  const s = addLog(state, '呼朋引伴：從牌庫選最多 2 隻基礎寶可夢放備戰', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: Math.min(2, 5 - p.bench.length),
    effectKey: 'bench-basic-from-deck',
  });
});

// ── (I) 條件式 +N 傷害（其他）──────────────────────────────────────────
// 火箭隊的尼多力諾｜角裂 60 + 若對手有傷害指示物 +60
regPre('火箭隊的尼多力諾|角裂', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (def && def.damage > 0) {
    return { state: addLog(state, '角裂：對手帶傷 → +60', aIdx), damage: 120 };
  }
  return { state, damage: 60 };
});

// N的萊希拉姆｜強力激怒 — 自身傷害指示物數 × 20（damage / 10 = 指示物數）
regPre('N的萊希拉姆|強力激怒', (state, aIdx, _pool) => {
  const att = state.players[aIdx].active;
  const counters = att ? Math.floor(att.damage / 10) : 0;
  const dmg = counters * 20;
  const s = addLog(state, `強力激怒：自身傷害指示物 ${counters} × 20 → ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 迷唇姐｜精神強念 — 對手戰鬥寶可夢能量數 × 30
regPre('迷唇姐|精神強念', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const energyCount = def ? def.energyAttached.length : 0;
  const dmg = 30 + energyCount * 30;
  const s = addLog(state, `精神強念：對手能量 ${energyCount} × 30 → ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ── (J) coin + 既有 helper 組合 ────────────────────────────────────────
// 大岩蛇｜綁緊 30 + 擲硬幣正面則對手【麻痺】
regPost('大岩蛇|綁緊', (state, aIdx, pool) => {
  const heads = Math.random() < 0.5;
  if (!heads) return addLog(state, '綁緊：擲硬幣反面 → 無附加效果', aIdx);
  return statusPost('paralyzed')(addLog(state, '綁緊：擲硬幣正面 → 對手【麻痺】', aIdx), aIdx, pool);
});

// 破破袋｜酸液炸彈 10 + 擲硬幣正面則丟對手戰鬥 1 張能量
regPost('破破袋|酸液炸彈', (state, aIdx, pool) => {
  const heads = Math.random() < 0.5;
  if (!heads) return addLog(state, '酸液炸彈：擲硬幣反面 → 無附加效果', aIdx);
  return discardOppActiveEnergyPost('酸液炸彈', 'any')(addLog(state, '酸液炸彈：擲硬幣正面', aIdx), aIdx, pool);
});

// ── (K) 抽卡到 6 張 ──────────────────────────────────────────────────
// 狐大盜｜貪慾狩獵 20 + 從牌庫抽到手牌滿 6
regPost('狐大盜|貪慾狩獵', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const need = Math.max(0, 6 - p.hand.length);
  if (need === 0) return addLog(state, '貪慾狩獵：手牌已滿 6 張', aIdx);
  const drawn = Math.min(need, p.deck.length);
  if (drawn === 0) return addLog(state, '貪慾狩獵：牌庫為空', aIdx);
  const s = addLog(state, `貪慾狩獵：抽到手牌滿 6（補 ${drawn} 張）`, aIdx);
  return drawCards(s, aIdx, drawn);
});


// ══════════════════════════════════════════════════════════════════════════════
// Wave 31 (v1.86) — 抽到 N + 牌庫搜 Item/Tool/Supporter + 同名群聚 + 手牌附能
//                 + 對手 ex snipe + 先丟對手道具 + 多目標 + 單目標 snipe
// ══════════════════════════════════════════════════════════════════════════════

// ── Helper: drawToHandPost — 從牌庫抽卡直到手牌滿 N ────────────────────────
function drawToHandPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    const need = Math.max(0, n - p.hand.length);
    if (need === 0) return addLog(state, `${label}：手牌已滿 ${n} 張`, aIdx);
    const drawn = Math.min(need, p.deck.length);
    if (drawn === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const s = addLog(state, `${label}：抽到手牌滿 ${n}（補 ${drawn} 張）`, aIdx);
    return drawCards(s, aIdx, drawn);
  };
}

// ── Helper: handAttachEnergyPost — 從手牌選基本能量附於自己場上寶可夢 ────
// typeFilter=null 不限屬性；max=99 表示不限上限
function handAttachEnergyPost(
  max: number,
  typeFilter: EnergyType | null,
  label: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const cand = p.hand.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && card.pokemonType !== typeFilter) return false;
      return true;
    });
    if (cand.length === 0) return addLog(state, `${label}：手牌沒有符合的基本能量`, aIdx);
    const realMax = Math.min(max, cand.length);
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從手牌選最多 ${realMax} 張基本能量`, aIdx);
    return withPending(s, {
      type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr,
      minCount: 1, maxCount: realMax,
      effectKey: 'hand-energy-attach-pick-target',
      params: { label, validIids: cand.map(c => c.iid) },
    });
  };
}
regR('hand-energy-attach-pick-target', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '手牌附能';
  const p = st.players[idx];
  const allSelf = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  if (allSelf.length === 0) return st;
  if (allSelf.length === 1) {
    const target = allSelf[0];
    const energies = p.hand.filter(c => iids.includes(c.iid));
    const tname = pool.get(target.cardId)?.name ?? '?';
    let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到 ${tname}`, idx);
    return updatePlayer(s, idx, pl => {
      const restHand = pl.hand.filter(c => !iids.includes(c.iid));
      if (pl.active && pl.active.iid === target.iid) {
        return { ...pl, hand: restHand, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } };
      }
      return {
        ...pl, hand: restHand,
        bench: pl.bench.map(c => c.iid === target.iid
          ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
          : c),
      };
    });
  }
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'hand-energy-attach-commit',
    params: { energyIids: iids, label },
  });
});
regR('hand-energy-attach-commit', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '手牌附能';
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.hand.filter(c => energyIids.includes(c.iid));
  if (energies.length === 0) return st;
  const tname = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到 ${tname}`, idx);
  return updatePlayer(s, idx, pl => {
    const restHand = pl.hand.filter(c => !energyIids.includes(c.iid));
    if (pl.active && pl.active.iid === targetIid) {
      return { ...pl, hand: restHand, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } };
    }
    return {
      ...pl, hand: restHand,
      bench: pl.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    };
  });
});

// ── Helper: deckSameNameBenchPost — 從牌庫選最多 N 張「同名卡」放備戰 ─────
function deckSameNameBenchPost(max: number, cardName: string, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    if (p.bench.length >= 5) return addLog(state, `${label}：備戰區已滿`, aIdx);
    const cand = p.deck.filter(c => pool.get(c.cardId)?.name === cardName);
    if (cand.length === 0) return addLog(state, `${label}：牌庫無「${cardName}」`, aIdx);
    const slots = Math.min(max, 5 - p.bench.length, cand.length);
    const s = addLog(state, `${label}：從牌庫選最多 ${slots} 張「${cardName}」放備戰`, aIdx);
    return withPending(s, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Basic', minCount: 0, maxCount: slots,
      effectKey: 'bench-basic-from-deck',
      params: { validIids: cand.map(c => c.iid), targetName: cardName },
    });
  };
}

// ── Helper: discardSameNameBenchPost — 從棄牌區選最多 N 張「同名卡」放備戰 ─
function discardSameNameBenchPost(max: number, cardName: string, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.bench.length >= 5) return addLog(state, `${label}：備戰區已滿`, aIdx);
    const cand = p.discard.filter(c => pool.get(c.cardId)?.name === cardName);
    if (cand.length === 0) return addLog(state, `${label}：棄牌區無「${cardName}」`, aIdx);
    const slots = Math.min(max, 5 - p.bench.length, cand.length);
    const s = addLog(state, `${label}：從棄牌區選最多 ${slots} 張「${cardName}」放備戰`, aIdx);
    return withPending(s, {
      type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Pokemon', minCount: 0, maxCount: slots,
      effectKey: 'bench-from-discard-samename',
      params: { validIids: cand.map(c => c.iid), targetName: cardName, label },
    });
  };
}
regR('bench-from-discard-samename', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '同名回備戰';
  const targetName = (params?.targetName as string) ?? '';
  const p = st.players[idx];
  const picked = p.discard.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return addLog(st, `${label}：未選擇`, idx);
  const slots = 5 - p.bench.length;
  const take = picked.slice(0, slots).map(c => ({ ...c, damage: 0, energyAttached: [], justPlaced: true } as CardInstance));
  const names = take.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(st, `${label}：從棄牌區放置 ${take.length} 張「${targetName}」到備戰（${names}）`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    bench: [...pl.bench, ...take],
    discard: pl.discard.filter(c => !take.some(t => t.iid === c.iid)),
  }));
});

// ── Helper: snipeAllOppExPost — 對手所有 ex/V 各 N 傷害（不計弱抵與附加效果）
function snipeAllOppExPost(dmg: number, filterType: 'ex' | 'ex-or-v', label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    const all = [d.active, ...d.bench].filter((c): c is CardInstance => !!c);
    const targets = all.filter(c => {
      const card = pool.get(c.cardId);
      if (!card) return false;
      if (isExCard(card)) return true;
      if (filterType === 'ex-or-v' && (card.name.endsWith('V') || card.name.endsWith('VMAX'))) return true;
      return false;
    });
    if (targets.length === 0) return addLog(state, `${label}：對手場上無 ex 寶可夢`, aIdx);
    let s = addLog(state, `${label}：對手 ${targets.length} 隻 ex 寶可夢各 ${dmg} 傷害`, aIdx);
    let totalPrize = 0;
    let oppActiveKOed = false;
    for (const t of targets) {
      const defender = s.players[dIdx];
      const isActive = defender.active?.iid === t.iid;
      const cur = isActive ? defender.active : defender.bench.find(c => c.iid === t.iid);
      if (!cur) continue;
      const card = pool.get(cur.cardId);
      const hp = card?.hp ?? 0;
      const newDmg = cur.damage + dmg;
      if (hp > 0 && newDmg >= hp) {
        const ko: CardInstance[] = [
          { ...cur, damage: newDmg },
          ...cur.energyAttached,
          ...(cur.toolAttached ? [cur.toolAttached] : []),
          ...(cur.evolvedFromStack ?? []),
        ];
        const p = isExCard(card) ? 2 : 1;
        totalPrize += p;
        const players = [...s.players] as [PlayerState, PlayerState];
        const nd = { ...defender, discard: [...defender.discard, ...ko] };
        if (isActive) { nd.active = null; oppActiveKOed = true; }
        else nd.bench = defender.bench.filter(c => c.iid !== t.iid);
        players[dIdx] = nd;
        s = addLog({ ...s, players }, `${label}：${card?.name ?? '?'} 被擊倒！+${p} 張獎勵牌。`, null);
      } else {
        const players = [...s.players] as [PlayerState, PlayerState];
        const nd = { ...defender };
        if (isActive) nd.active = { ...cur, damage: newDmg };
        else nd.bench = defender.bench.map(c => c.iid === t.iid ? { ...c, damage: newDmg } : c);
        players[dIdx] = nd;
        s = addLog({ ...s, players }, `${label}：對 ${card?.name ?? '?'} 造成 ${dmg} 傷害`, aIdx);
      }
    }
    const defender = s.players[dIdx];
    if (oppActiveKOed && !defender.active && defender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: aIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    if (totalPrize > 0) s = { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + totalPrize };
    return s;
  };
}

// ── Helper: defToolDiscardPre — 攻擊前丟對手戰鬥寶可夢道具卡 ──────────────
function defToolDiscardPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def || !def.toolAttached) {
      return { state: addLog(state, `${label}：對手戰鬥寶可夢無道具`, aIdx), damage: base };
    }
    const toolName = pool.get(def.toolAttached.cardId)?.name ?? '?';
    const discarded = def.toolAttached;
    const defName = pool.get(def.cardId)?.name ?? '?';
    let s = addLog(state, `${label}：丟棄 ${defName} 的道具「${toolName}」`, aIdx);
    s = updatePlayer(s, dIdx, pl => {
      if (!pl.active) return pl;
      const { toolAttached: _removed, ...rest } = pl.active;
      return { ...pl, active: rest as CardInstance, discard: [...pl.discard, discarded] };
    });
    return { state: s, damage: base };
  };
}

// ── Helper: damagedMultiSnipePost — 對手身上有傷害指示物的 N 隻各 D 傷害 ──
function damagedMultiSnipePost(targetCount: number, dmg: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    const all = [d.active, ...d.bench].filter((c): c is CardInstance => !!c);
    const damaged = all.filter(c => c.damage > 0);
    if (damaged.length === 0) return addLog(state, `${label}：對手場上無帶傷寶可夢`, aIdx);
    const realMax = Math.min(targetCount, damaged.length);
    const s = addLog(state, `${label}：選擇對手 ${realMax} 隻「帶傷」寶可夢各 ${dmg} 傷害`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: realMax,
      effectKey: 'snipe-multi',
      params: { damage: dmg, label, validIids: damaged.map(c => c.iid) },
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Wave 31 招式登記
// ══════════════════════════════════════════════════════════════════════════════

// ── (A) 抽到 N 張 ──────────────────────────────────────────────────────────
regPre('狙射樹梟|羽毛庫存', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('狙射樹梟|羽毛庫存', drawToHandPost(7, '羽毛庫存'));

regPre('霓虹魚|報恩', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('霓虹魚|報恩', drawToHandPost(6, '報恩'));

regPre('幸福蛋ex|報恩', (state, _aIdx, _pool) => ({ state, damage: 180 }));
regPost('幸福蛋ex|報恩', drawToHandPost(6, '報恩'));

// ── (B) 牌庫搜 Item / Supporter（需搭配 UI 新 filter） ────────────────────
regPre('海地鼠|挖到寶', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('海地鼠|挖到寶', deckSearchToHandPost(1, 'Item', '挖到寶'));

regPre('海刺龍|援軍', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('海刺龍|援軍', deckSearchToHandPost(3, 'Pokemon', '援軍'));

regPre('超音蝠|引路', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('超音蝠|引路', deckSearchToHandPost(1, 'Supporter', '引路'));

// ── (C) 棄牌區能量附加 ──────────────────────────────────────────────────
regPre('莫魯貝可|撿拾附上', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('莫魯貝可|撿拾附上', discardEnergyAttachPost(2, null, '撿拾附上'));

// ── (D) 單目標 + 多目標 snipe ──────────────────────────────────────────
regPre('月亮伊布|出奇一擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('月亮伊布|出奇一擊', multiSnipePost(1, 50, '出奇一擊'));

regPre('鐵頭殼ex|雙刃劍', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('鐵頭殼ex|雙刃劍', multiSnipePost(2, 50, '雙刃劍'));

// 鐵脖頸|自動導向頭擊 — 對手 3 隻有傷害指示物各 50
regPre('鐵脖頸|自動導向頭擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('鐵脖頸|自動導向頭擊', damagedMultiSnipePost(3, 50, '自動導向頭擊'));

// ── (E) 同名群聚（牌庫搜同名） ────────────────────────────────────────
regPre('強顎雞母蟲|群聚', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('強顎雞母蟲|群聚', deckSameNameBenchPost(2, '強顎雞母蟲', '群聚'));

regPre('一家鼠|家族行軍', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('一家鼠|家族行軍', deckSameNameBenchPost(2, '一家鼠', '家族行軍'));

regPre('蟲電寶|並排', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('蟲電寶|並排', deckSameNameBenchPost(3, '蟲電寶', '並排'));

regPre('呱呱泡蛙|群聚', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('呱呱泡蛙|群聚', deckSameNameBenchPost(2, '呱呱泡蛙', '群聚'));

// ── (F) 同名群聚（棄牌區搜同名） ──────────────────────────────────────
regPre('夜巡靈|前往渡魂', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('夜巡靈|前往渡魂', discardSameNameBenchPost(3, '夜巡靈', '前往渡魂'));

// ── (G) 手牌附能（基本能量從手牌） ────────────────────────────────────
regPre('艾姆利多|滿載心田', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('艾姆利多|滿載心田', handAttachEnergyPost(2, 'Psychic', '滿載心田'));

regPre('固拉多|充溢之力', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('固拉多|充溢之力', handAttachEnergyPost(1, 'Fighting', '充溢之力'));

regPre('吉利蛋|幸運貼附', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('吉利蛋|幸運貼附', handAttachEnergyPost(1, null, '幸運貼附'));

regPre('阿羅拉 椰蛋樹ex|熱帶狂燒', (state, _aIdx, _pool) => ({ state, damage: 150 }));
regPost('阿羅拉 椰蛋樹ex|熱帶狂燒', handAttachEnergyPost(99, null, '熱帶狂燒'));

// ── (H) 對手所有 ex/V snipe ─────────────────────────────────────────
regPre('水伊布ex|重磅驟雨', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('水伊布ex|重磅驟雨', snipeAllOppExPost(60, 'ex', '重磅驟雨'));

regPre('沙漠蜻蜓ex|橄欖石音波', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('沙漠蜻蜓ex|橄欖石音波', snipeAllOppExPost(100, 'ex-or-v', '橄欖石音波'));

// ── (I) 攻擊前丟對手道具 ────────────────────────────────────────────
regPre('金魚王|啄落', defToolDiscardPre(50, '啄落'));
regPre('破破舵輪|破壞船錨', defToolDiscardPre(80, '破壞船錨'));

// ══════════════════════════════════════════════════════════════════════════════
// Session 38ak v1.87 H 標第 32 波 — 棄牌到手牌/備戰 + 手牌附能+heal + 自牌庫找基本能量附自 + 手牌 tool×damage + 先丟附加能量 + 條件進化
//
// 新 Helper:
//   • discardSearchToHandPost(max, filter, label) — 從棄牌區選最多 N 張 X 加手牌（重用 discard-to-hand resolver）
//   • deckEnergyAttachSelfPost(typeFilter, label) — 從牌庫選 1 張基本能量附於自己，重洗
//   • selfActiveHandAttachHealPost(heal, label) — 從手牌選 1 張能量附於自己戰鬥寶可夢 + 回 heal HP
//   • benchHandAttachFullHealPost(typeFilter, label) — 從手牌選 1 張基本能量附於備戰 + 將該寶可夢全回復
//
// 新 regPre：
//   • 灰塵山|丟棄 — 宣告時用 hand-discard 選任意數量的「寶可夢道具」卡，×50 傷害
//   • 切割洛托姆|割除衝刺 — 造傷害前丟對手戰鬥寶可夢的 toolAttached + 所有特殊能量
//   • 賽富豪|富裕強襲 — 若本回合從「索財靈」進化，則 +90
// ══════════════════════════════════════════════════════════════════════════════

// (A) 棄牌區選卡到手牌：Pokemon×2
function discardSearchToHandPost(max: number, filter: string, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const cand = p.discard.filter(c => {
      const card = pool.get(c.cardId);
      if (!card) return false;
      if (filter === 'Pokemon') return card.supertype === 'Pokemon';
      if (filter === 'BasicEnergy') return card.supertype === 'Energy' && card.subtype === 'Basic';
      if (filter.startsWith('Energy:')) {
        // v2.121：加 name fallback（基本能量 pokemonType 常為 undefined）
        const t = filter.slice(7);
        if (card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
        if (card.pokemonType === t) return true;
        const zhByType: Record<string, string> = {
          Grass: '草', Fire: '火', Water: '水', Lightning: '雷',
          Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼',
          Dragon: '龍', Colorless: '無',
        };
        return card.name.includes(`【${zhByType[t] ?? ''}】`);
      }
      return true;
    });
    if (cand.length === 0) return addLog(state, `${label}：棄牌區沒有可選的卡`, aIdx);
    const realMax = Math.min(max, cand.length);
    const s = addLog(state, `${label}：從棄牌區選最多 ${realMax} 張加手牌`, aIdx);
    return withPending(s, {
      type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter, minCount: 1, maxCount: realMax,
      effectKey: 'discard-to-hand',
    });
  };
}

// 鐵斑葉|補全之網 — 從棄牌區選最多 2 張寶可夢卡加手牌
regPre('鐵斑葉|補全之網', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('鐵斑葉|補全之網', discardSearchToHandPost(2, 'Pokemon', '補全之網'));

// 破破舵輪|救援船錨 — 從棄牌區選最多 2 張寶可夢卡加手牌
regPre('破破舵輪|救援船錨', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('破破舵輪|救援船錨', discardSearchToHandPost(2, 'Pokemon', '救援船錨'));

// 斯魔茶|上茶 — 從棄牌區選 1 張基本草能量加手牌
regPre('斯魔茶|上茶', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('斯魔茶|上茶', discardSearchToHandPost(1, 'Energy:Grass', '上茶'));

// (B) 刺龍王ex|王之號召 — 從棄牌區選最多 3 張【水】寶可夢卡放備戰（重用 bench-from-discard-samename resolver，validIids=水寶可夢）
regPre('刺龍王ex|王之號召', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('刺龍王ex|王之號召', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.bench.length >= 5) return addLog(state, '王之號召：備戰區已滿', aIdx);
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.pokemonType === 'Water';
  });
  if (cand.length === 0) return addLog(state, '王之號召：棄牌區無【水】寶可夢', aIdx);
  const slots = Math.min(3, 5 - p.bench.length, cand.length);
  const s = addLog(state, `王之號召：從棄牌區選最多 ${slots} 張【水】寶可夢放備戰`, aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon', minCount: 0, maxCount: slots,
    effectKey: 'bench-from-discard-samename',
    params: { validIids: cand.map(c => c.iid), targetName: '【水】寶可夢', label: '王之號召' },
  });
});

// (C) 甲賀忍蛙ex|忍之利刃 — v2.222 移除：v2.129 已在 line 10626 重新實裝為
//   「若希望」可選 0~1 張，舊版 deckSearchToHandPost(1) 強制搜 1 張不正確；
//   保留舊登錄會讓後者覆蓋前者，但這段註解化避免將來誤讀。

// 美錄坦|搬運破爛 — 從牌庫選 1 張寶可夢道具卡加手牌並重洗
regPre('美錄坦|搬運破爛', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('美錄坦|搬運破爛', deckSearchToHandPost(1, 'Tool', '搬運破爛'));

// (D) 穿著熊|力量充能 30 — 從牌庫選 1 張基本能量附於自己，並重洗
function deckEnergyAttachSelfPost(typeFilter: EnergyType | null, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const cand = p.deck.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && card.pokemonType !== typeFilter) return false;
      return true;
    });
    if (cand.length === 0) return addLog(state, `${label}：牌庫無符合的基本能量`, aIdx);
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從牌庫選 1 張基本能量附於自己`, aIdx);
    return withPending(s, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr, minCount: 1, maxCount: 1,
      effectKey: 'deck-energy-attach-self',
      params: { validIids: cand.map(c => c.iid), label },
    });
  };
}
regR('deck-energy-attach-self', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '自牌庫附能';
  const p = st.players[idx];
  if (!p.active) return st;
  const picked = p.deck.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return addLog(st, `${label}：未選擇`, idx);
  const tname = pool.get(p.active.cardId)?.name ?? '?';
  const ename = pool.get(picked[0].cardId)?.name ?? '?';
  let s = addLog(st, `${label}：將 ${ename} 附加到 ${tname}（重洗牌庫）`, idx);
  return updatePlayer(s, idx, pl => {
    if (!pl.active) return pl;
    const newDeck = shuffle(pl.deck.filter(c => !iids.includes(c.iid)));
    return {
      ...pl,
      deck: newDeck,
      active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...picked] },
    };
  });
});
regPre('穿著熊|力量充能', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('穿著熊|力量充能', deckEnergyAttachSelfPost(null, '力量充能'));

// (E) 卡比獸|吃飽先 — 從手牌選 1 張能量附於自己 + 回 60 HP
function selfActiveHandAttachHealPost(heal: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const cand = p.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
    if (cand.length === 0) {
      // 沒能量 → 只回血
      const tname = pool.get(p.active.cardId)?.name ?? '?';
      const newDmg = Math.max(0, p.active.damage - heal);
      const healed = p.active.damage - newDmg;
      if (healed === 0) return addLog(state, `${label}：手牌無能量且 ${tname} 無傷害`, aIdx);
      const s = addLog(state, `${label}：手牌無能量，${tname} 回 ${healed} HP`, aIdx);
      return updatePlayer(s, aIdx, pl => ({ ...pl, active: pl.active ? { ...pl.active, damage: newDmg } : pl.active }));
    }
    const s = addLog(state, `${label}：從手牌選 1 張能量附於自己 + 回 ${heal} HP`, aIdx);
    return withPending(s, {
      type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Energy', minCount: 1, maxCount: 1,
      effectKey: 'self-active-hand-attach-heal',
      params: { heal, label, validIids: cand.map(c => c.iid) },
    });
  };
}
regR('self-active-hand-attach-heal', (st, idx, iids, params, pool) => {
  const heal = (params?.heal as number) ?? 0;
  const label = (params?.label as string) ?? '手牌附能+回血';
  const p = st.players[idx];
  if (!p.active) return st;
  const picked = p.hand.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return st;
  const tname = pool.get(p.active.cardId)?.name ?? '?';
  const ename = pool.get(picked[0].cardId)?.name ?? '?';
  const newDmg = Math.max(0, p.active.damage - heal);
  const healed = p.active.damage - newDmg;
  let s = addLog(st, `${label}：${ename} 附於 ${tname}，並回 ${healed} HP`, idx);
  return updatePlayer(s, idx, pl => {
    if (!pl.active) return pl;
    return {
      ...pl,
      hand: pl.hand.filter(c => !iids.includes(c.iid)),
      active: {
        ...pl.active,
        damage: newDmg,
        energyAttached: [...pl.active.energyAttached, ...picked],
      },
    };
  });
});
regPre('卡比獸|吃飽先', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('卡比獸|吃飽先', selfActiveHandAttachHealPost(60, '吃飽先'));

// (F) 葉伊布|嫩葉之恩 — 從手牌選 1 張基本草能量附於備戰 + 全回復
function benchHandAttachFullHealPost(typeFilter: EnergyType | null, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0) return addLog(state, `${label}：無備戰寶可夢`, aIdx);
    const cand = p.hand.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && card.pokemonType !== typeFilter) return false;
      return true;
    });
    if (cand.length === 0) return addLog(state, `${label}：手牌無符合的基本能量`, aIdx);
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從手牌選 1 張基本能量附於備戰並全回復`, aIdx);
    return withPending(s, {
      type: 'hand-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr, minCount: 1, maxCount: 1,
      effectKey: 'bench-hand-attach-fullheal-pick-energy',
      params: { label, validIids: cand.map(c => c.iid) },
    });
  };
}
regR('bench-hand-attach-fullheal-pick-energy', (st, idx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '附能+全回復';
  const p = st.players[idx];
  if (p.bench.length === 0) return st;
  if (p.bench.length === 1) {
    // 只有 1 隻備戰，自動選定
    return applyBenchAttachFullHeal(st, idx, iids, p.bench[0].iid, label);
  }
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'bench-hand-attach-fullheal-commit',
    params: { energyIids: iids, label, validIids: p.bench.map(c => c.iid) },
  });
});
regR('bench-hand-attach-fullheal-commit', (st, idx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '附能+全回復';
  const energyIids = (params?.energyIids as string[]) ?? [];
  return applyBenchAttachFullHeal(st, idx, energyIids, iids[0], label);
});
function applyBenchAttachFullHeal(st: GameState, idx: 0 | 1, energyIids: string[], targetIid: string, label: string): GameState {
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.hand.filter(c => energyIids.includes(c.iid));
  if (energies.length === 0) return st;
  // 只取 pool 以保留名字 — 由呼叫者傳入 pool 會較好，這裡從 cardId 推名即可
  const newDamage = 0;
  const healed = target.damage;
  let s = addLog(st, `${label}：將 ${energies.length} 張能量附加到備戰，並全回復（回 ${healed} HP）`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => !energyIids.includes(c.iid)),
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, damage: newDamage, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
}
regPre('葉伊布|嫩葉之恩', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('葉伊布|嫩葉之恩', benchHandAttachFullHealPost('Grass', '嫩葉之恩'));

// (G) 灰塵山|丟棄 — 手牌丟任意數量「寶可夢道具」×50 傷害
// 簡化：現行 engine 不支援 pre 階段請 UI 選卡；
// pre 自動把手牌所有「寶可夢道具」卡丟掉並按張數×50 計算 base damage。
// （未來可改為 ATTACK_PRE_DISCARD_CHOICE 擴充 scope='hand-tool' 做選擇性丟）
regPre('灰塵山|丟棄', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const toolIdxs: number[] = [];
  p.hand.forEach((c, i) => {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Trainer' && card.subtype === 'PokemonTool') toolIdxs.push(i);
  });
  if (toolIdxs.length === 0) return { state: addLog(state, '丟棄：手牌無寶可夢道具', aIdx), damage: 0 };
  const damage = toolIdxs.length * 50;
  const discarded = toolIdxs.map(i => p.hand[i]);
  const discardNames = discarded.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `丟棄：丟 ${discarded.length} 張道具（${discardNames}），造成 ${damage} 傷害`, aIdx);
  s = updatePlayer(s, aIdx, pl => ({
    ...pl,
    hand: pl.hand.filter((_, i) => !toolIdxs.includes(i)),
    discard: [...pl.discard, ...discarded],
  }));
  return { state: s, damage };
});

// (H) 切割洛托姆|割除衝刺 30 — 造成傷害前丟對手戰鬥寶可夢 toolAttached + 所有特殊能量
regPre('切割洛托姆|割除衝刺', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return { state, damage: 30 };
  const dname = pool.get(def.cardId)?.name ?? '?';
  let s = state;
  const newDiscards: CardInstance[] = [];
  // 丟 tool
  let newActive = { ...def };
  if (def.toolAttached) {
    const tname = pool.get(def.toolAttached.cardId)?.name ?? '?';
    newDiscards.push(def.toolAttached);
    newActive = { ...newActive, toolAttached: undefined };
    s = addLog(s, `割除衝刺：丟棄 ${dname} 的道具 ${tname}`, aIdx);
  }
  // 丟所有特殊能量
  const keepEnergies: CardInstance[] = [];
  const specialEnergies: CardInstance[] = [];
  for (const e of def.energyAttached) {
    const card = pool.get(e.cardId);
    if (card?.supertype === 'Energy' && card.subtype !== 'Basic') specialEnergies.push(e);
    else keepEnergies.push(e);
  }
  if (specialEnergies.length > 0) {
    newDiscards.push(...specialEnergies);
    newActive = { ...newActive, energyAttached: keepEnergies };
    const enames = specialEnergies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
    s = addLog(s, `割除衝刺：丟棄 ${dname} 的特殊能量 ${specialEnergies.length} 張（${enames}）`, aIdx);
  }
  if (newDiscards.length === 0) return { state: s, damage: 30 };
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = {
    ...players[dIdx],
    active: newActive,
    discard: [...players[dIdx].discard, ...newDiscards],
  };
  s = { ...s, players };
  return { state: s, damage: 30 };
});

// (I) 賽富豪|富裕強襲 30+ — 若本回合從「索財靈」進化，則 +90
regPre('賽富豪|富裕強襲', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return { state, damage: 30 };
  const evolved = p.active.evolvedThisTurn;
  const stack = p.active.evolvedFromStack ?? [];
  const fromName = stack.length > 0 ? pool.get(stack[stack.length - 1].cardId)?.name : undefined;
  if (evolved && fromName === '索財靈') {
    return { state: addLog(state, '富裕強襲：本回合從「索財靈」進化 → +90', aIdx), damage: 120 };
  }
  return { state, damage: 30 };
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 33 — 引擎擴充：skipWeakRes / skipDefEffects 旗標
//
// 本波新增招式旗標（AttackPreFn 回傳 skipWeakRes / skipDefEffects）：
//
//   skipWeakRes    — 傷害不計算弱點（抵抗力目前引擎未實作，此旗標主要作用於弱點）
//   skipDefEffects — 傷害不計算對手戰鬥寶可夢身上的「附加效果」：
//                    被動減傷特性、特定屬性防禦道具、下次被攻擊 -N、條件式完全免疫
//
// 實作對照：engine.ts 傷害管線
//   if (!skipWeakRes)    → 套用弱點 ×2
//   if (!skipDefEffects) → 套用 PASSIVE_DAMAGE_REDUCE / TOOL_DEFENSE_REDUCE_BY_TYPE /
//                          PASSIVE_IMMUNITY / damageReduceNextHit
//
// 注意：並非實卡所有「附加效果」文字都等同於引擎全部防禦機制；此處採取保守實作，
// 將所有 defender-side 的減傷/免疫機制一起納入 skipDefEffects 範圍（符合大多數實戰情境）。
// ══════════════════════════════════════════════════════════════════════════════

/** 固定傷害 + 跳過弱點/抵抗力。 */
function skipWeakResPre(baseDmg: number, _label: string): AttackPreFn {
  return (state, _aIdx, _pool) => ({ state, damage: baseDmg, skipWeakRes: true });
}

/** 固定傷害 + 跳過對手戰鬥寶可夢身上附加效果。 */
export function skipDefEffectsPre(baseDmg: number, _label: string): AttackPreFn {
  return (state, _aIdx, _pool) => ({ state, damage: baseDmg, skipDefEffects: true });
}

/** 固定傷害 + 同時跳過弱點/抵抗力與身上附加效果。 */
function skipBothPre(baseDmg: number, _label: string): AttackPreFn {
  return (state, _aIdx, _pool) => ({ state, damage: baseDmg, skipWeakRes: true, skipDefEffects: true });
}

// ── Wave 33 招式登記 ───────────────────────────────────────────────────────
// 恰雷姆ex｜瑜伽踢 — 190，傷害不計算弱點・抵抗力
regPre('恰雷姆ex|瑜伽踢', skipWeakResPre(190, '瑜伽踢'));

// 厄鬼椪 礎石面具ex｜打爆 — 140，不計算弱點・抵抗力與對手戰鬥寶可夢身上的附加效果
regPre('厄鬼椪 礎石面具ex|打爆', skipBothPre(140, '打爆'));

// 安瓢蟲｜高速星星 — 70，不計算弱點・抵抗力與對手戰鬥寶可夢身上的附加效果
regPre('安瓢蟲|高速星星', skipBothPre(70, '高速星星'));

// 輕身鱈｜音波刀鋒 — 110，不計算對手戰鬥寶可夢身上的附加效果
regPre('輕身鱈|音波刀鋒', skipDefEffectsPre(110, '音波刀鋒'));

// 米立龍ex｜突襲水泵 — 100，不計算對手戰鬥寶可夢身上的附加效果
regPre('米立龍ex|突襲水泵', skipDefEffectsPre(100, '突襲水泵'));

// 頓甲｜打垮 — 40，不計算對手戰鬥寶可夢身上的附加效果
regPre('頓甲|打垮', skipDefEffectsPre(40, '打垮'));

// 堅盾劍怪｜堅硬猛擊 — 120，不計算對手戰鬥寶可夢身上的附加效果
regPre('堅盾劍怪|堅硬猛擊', skipDefEffectsPre(120, '堅硬猛擊'));

// 晶光芽｜岩石投擲 — 10，不計算抵抗力（引擎未實作抵抗力，此處僅註記；以 skipWeakRes 避免日後接入時反悔）
regPre('晶光芽|岩石投擲', skipWeakResPre(10, '岩石投擲'));

// 土地雲｜粗暴橫掃 — 130，不計算抵抗力（同上理由）
regPre('土地雲|粗暴橫掃', skipWeakResPre(130, '粗暴橫掃'));

// 鐵頭殼ex｜雙刃劍 — 已於 Wave 31 以 multiSnipePost 實作；snipe-multi 本身即繞過弱點/附加效果，
// Session 33 不需額外旗標改寫。保留此註記以避免未來重複登記。

// ══════════════════════════════════════════════════════════════════════════════
// Wave 34 — 引擎擴充：CardInstance.movedToActiveThisTurn 旗標
//
// 新增旗標：`movedToActiveThisTurn`（在 RETREAT 與 SEND_NEW_ACTIVE 時設，
// 於擁有者下回合 END_TURN 時 clearTurnFlags 一併清除）。
// 作用：招式效果「在這個回合，若從備戰區將這隻寶可夢放置於戰鬥場，則增加 N 點傷害」。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * base + bonus（若本回合剛從備戰區被放到戰鬥場）。
 * 條件以 attacker.active.movedToActiveThisTurn 判斷。
 */
function movedToActivePre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (att?.movedToActiveThisTurn) {
      return {
        state: addLog(state, `${label}：本回合從備戰區放置戰鬥場 → +${bonus}`, aIdx),
        damage: base + bonus,
      };
    }
    return { state, damage: base };
  };
}

// ── Wave 34 招式登記（4 張） ───────────────────────────────────────────────
// 普隆隆姆ex｜暴衝閃光 — 20+120 = 140
regPre('普隆隆姆ex|暴衝閃光', movedToActivePre(20, 120, '暴衝閃光'));

// 超級長耳兔ex｜疾風直撞 — 60+170 = 230
regPre('超級長耳兔ex|疾風直撞', movedToActivePre(60, 170, '疾風直撞'));

// 烈空坐｜進擊破壞 — 20+90 = 110
regPre('烈空坐|進擊破壞', movedToActivePre(20, 90, '進擊破壞'));

// 凱路迪歐ex｜疾風直撞 — 30+90 = 120
regPre('凱路迪歐ex|疾風直撞', movedToActivePre(30, 90, '疾風直撞'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 35 — 自身回手牌 / 回牌庫 類招式
//
// 對 active 自身結算完傷害後，將 active（含附加能量 / 道具 / evolvedFromStack）
// 一併送回手牌或牌庫，active 設為 null → 引擎會自動觸發 pending SEND_NEW_ACTIVE。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 自身回手牌：active + 所有附加卡全部放回手牌，active=null。
 * 使用時機：post（傷害已結算）。
 */
function selfReturnToHandPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const inst = p.active;
    const returning: CardInstance[] = [
      // 把進化棧底重設為未進化版本（保留最底層 card），其實不必拆棧 —
      // 整疊連附加一起送回手牌即可，但 evolvedFromStack 裡每張都是獨立的 CardInstance，
      // 逐一加入手牌才符合「附加的卡」語義。
      // 主體（含目前 cardId 與 iid）
      { ...inst, damage: 0, energyAttached: [], toolAttached: undefined,
        status: undefined, evolvedFromStack: undefined,
        evolvedThisTurn: undefined, justPlaced: undefined, movedToActiveThisTurn: undefined,
        damageBonusThisTurn: undefined, damageReduceNextHit: undefined,
        abilityUsedThisTurn: undefined, cantAttackThisTurn: undefined, cantAttackPending: undefined,
        cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
        damageBonusPending: undefined },
      ...inst.energyAttached,
      ...(inst.toolAttached ? [inst.toolAttached] : []),
      ...(inst.evolvedFromStack ?? []),
    ];
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = {
      ...p,
      active: null,
      hand: [...p.hand, ...returning],
    };
    return addLog({ ...state, players }, `${label}：將自身（含附加）全部放回手牌`, aIdx);
  };
}

/**
 * 自身回牌庫（重洗）：active + 所有附加卡放回牌庫並 shuffle，active=null。
 */
function selfReturnToDeckPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const inst = p.active;
    const returning: CardInstance[] = [
      { ...inst, damage: 0, energyAttached: [], toolAttached: undefined,
        status: undefined, evolvedFromStack: undefined,
        evolvedThisTurn: undefined, justPlaced: undefined, movedToActiveThisTurn: undefined,
        damageBonusThisTurn: undefined, damageReduceNextHit: undefined,
        abilityUsedThisTurn: undefined, cantAttackThisTurn: undefined, cantAttackPending: undefined,
        cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
        damageBonusPending: undefined },
      ...inst.energyAttached,
      ...(inst.toolAttached ? [inst.toolAttached] : []),
      ...(inst.evolvedFromStack ?? []),
    ];
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = {
      ...p,
      active: null,
      deck: shuffle([...p.deck, ...returning]),
    };
    return addLog({ ...state, players }, `${label}：將自身（含附加）全部放回自己牌庫並重洗`, aIdx);
  };
}

/**
 * 自身回牌庫 + 從牌庫任意選最多 N 張加入手牌。
 * 做法：先把 active 送回牌庫（不洗）→ 觸發 pending deck-search（filter=Any, max=N）→
 * resolver 處理抽完後 shuffle 牌庫。
 */
function selfReturnToDeckThenSearchPost(maxSearch: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    const inst = p.active;
    const returning: CardInstance[] = [
      { ...inst, damage: 0, energyAttached: [], toolAttached: undefined,
        status: undefined, evolvedFromStack: undefined,
        evolvedThisTurn: undefined, justPlaced: undefined, movedToActiveThisTurn: undefined,
        damageBonusThisTurn: undefined, damageReduceNextHit: undefined,
        abilityUsedThisTurn: undefined, cantAttackThisTurn: undefined, cantAttackPending: undefined,
        cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
        damageBonusPending: undefined },
      ...inst.energyAttached,
      ...(inst.toolAttached ? [inst.toolAttached] : []),
      ...(inst.evolvedFromStack ?? []),
    ];
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = {
      ...p,
      active: null,
      // 先「放」回牌庫（不 shuffle）— resolver 做 search → 取到手牌後 shuffle
      deck: [...p.deck, ...returning],
    };
    const afterReturn = addLog({ ...state, players }, `${label}：將自身（含附加）全部放回自己牌庫`, aIdx);
    // deck-search 預設 filter=Any（maxCount 張數上限，由玩家自選）
    return withPending(afterReturn, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 0, maxCount: maxSearch,
      effectKey: 'search-to-hand-reshuffle',
      filter: 'Any',
      params: { label },
    });
  };
}

/**
 * 備戰寶可夢回牌庫：玩家選 1 隻自己備戰寶可夢，連同附加一起回牌庫並重洗。
 * 使用既有 bench-choose pending + 新 resolver `self-bench-return-to-deck`。
 */
function selfBenchReturnToDeckPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0) return addLog(state, `${label}：沒有備戰寶可夢`, aIdx);
    const s = addLog(state, `${label}：選擇 1 隻備戰寶可夢回到牌庫`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'self-bench-return-to-deck',
      params: { label },
    });
  };
}

regR('self-bench-return-to-deck', (st, actorIdx, selectedIids, params, _pool) => {
  const label = (params?.label as string) ?? '回家鐘聲';
  const iid = selectedIids[0];
  const p = st.players[actorIdx];
  const picked = p.bench.find(c => c.iid === iid);
  if (!picked) return st;
  const returning: CardInstance[] = [
    { ...picked, damage: 0, energyAttached: [], toolAttached: undefined,
      status: undefined, evolvedFromStack: undefined,
      evolvedThisTurn: undefined, justPlaced: undefined, movedToActiveThisTurn: undefined,
      damageBonusThisTurn: undefined, damageReduceNextHit: undefined,
      abilityUsedThisTurn: undefined, cantAttackThisTurn: undefined, cantAttackPending: undefined,
      cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
      damageBonusPending: undefined },
    ...picked.energyAttached,
    ...(picked.toolAttached ? [picked.toolAttached] : []),
    ...(picked.evolvedFromStack ?? []),
  ];
  const players = [...st.players] as [PlayerState, PlayerState];
  players[actorIdx] = {
    ...p,
    bench: p.bench.filter(c => c.iid !== iid),
    deck: shuffle([...p.deck, ...returning]),
  };
  return addLog({ ...st, players }, `${label}：備戰寶可夢連附加放回牌庫並重洗`, actorIdx);
});

// ── Wave 35 招式登記 ──────────────────────────────────────────────────────

// 喵喵ex｜夾尾巴逃跑 — 60 + 自身回手牌
regPre('喵喵ex|夾尾巴逃跑', (state, _a, _p) => ({ state, damage: 60 }));
regPost('喵喵ex|夾尾巴逃跑', selfReturnToHandPost('夾尾巴逃跑'));

// 賽富豪｜賽富迴旋 — 100 + 「若希望」自身回牌庫
//   v2.220：升級為 modal-choice — 玩家在 POST 階段選「回 / 不回」
regPre('賽富豪|賽富迴旋', (state, _a, _p) => ({ state, damage: 100 }));
regPost('賽富豪|賽富迴旋', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  const s = addLog(state, '賽富迴旋：選擇是否將自身（含附加）放回牌庫並重洗', aIdx);
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'sigorhof-back-choice',
    params: {
      label: '賽富迴旋',
      options: [
        { id: 'return', text: '①將自身與附加的卡全部放回牌庫並重洗' },
        { id: 'skip', text: '②不返回（保留戰鬥位）' },
      ],
    },
  });
});
regR('sigorhof-back-choice', (state, aIdx, iids, _params, pool) => {
  if (iids[0] === 'return') {
    return selfReturnToDeckPost('賽富迴旋')(state, aIdx, pool);
  }
  return addLog(state, '賽富迴旋：選擇保留戰鬥位（不返回）', aIdx);
});

// 蚊香泳士｜跳躍衝天 — 120+120 = 240 + 自身回牌庫（sim/AI 簡化：總是選擇 +120）
regPre('蚊香泳士|跳躍衝天', (state, aIdx, _p) => {
  return { state: addLog(state, '跳躍衝天：選擇 +120（自身將回牌庫）', aIdx), damage: 240 };
});
regPost('蚊香泳士|跳躍衝天', selfReturnToDeckPost('跳躍衝天'));

// 白蓬蓬｜微風之禮 — 0 傷 + 自身回牌庫 + 從牌庫任選最多 3 張加手牌
regPre('白蓬蓬|微風之禮', (state, _a, _p) => ({ state, damage: 0 }));
regPost('白蓬蓬|微風之禮', selfReturnToDeckThenSearchPost(3, '微風之禮'));

// 風鈴鈴｜回家鐘聲 — 0 傷 + 備戰選 1 隻連附加回牌庫
regPre('風鈴鈴|回家鐘聲', (state, _a, _p) => ({ state, damage: 0 }));
regPost('風鈴鈴|回家鐘聲', selfBenchReturnToDeckPost('回家鐘聲'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 36 — 引擎擴充：player-level noAttacksNextTurn + 跨回合加傷
//
// 引擎新增：
//   - PlayerState.noAttacksNextTurn / noAttacksThisTurn（玩家級，涵蓋新上場寶可夢）
//   - CardInstance.takeExtraDamageNextTurn / takeExtraDamageThisTurn（跨回合目標 +N 受傷）
//
// 搭配的 END_TURN 變化：
//   - 於 aIdx（結束方）promote takeExtraDamageNextTurn → ThisTurn
//   - 於 dIdx（下個行動方）promote noAttacksNextTurn → ThisTurn
//   - 於 dIdx 清除 takeExtraDamageThisTurn、aIdx 清除 noAttacksThisTurn
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ATTACK_POST：對自己（攻擊方）設 noAttacksNextTurn = true。
 * 使用時機：打爆類 AoE 代價招式（雷電在地）。
 */
function playerNoAttacksNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    players[aIdx] = { ...players[aIdx], noAttacksNextTurn: true };
    return addLog({ ...state, players },
      `${label}：自己下個回合所有寶可夢將無法使用招式（含新上場的）`, aIdx);
  };
}

/**
 * ATTACK_POST：對對手戰鬥場設 takeExtraDamageNextTurn = N。
 * 若對手此攻擊被擊倒（active 已 null），旗標自然失效。
 */
function oppTargetTakeExtraNextPost(bonus: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = {
      ...d,
      active: { ...d.active, takeExtraDamageNextTurn: (d.active.takeExtraDamageNextTurn ?? 0) + bonus },
    };
    const nm = players[dIdx].active ? (state.players[dIdx].active ? '對手戰鬥寶可夢' : '?') : '?';
    return addLog({ ...state, players }, `${label}：${nm}下個自己回合受到招式傷害 +${bonus}`, aIdx);
  };
}

// ── Wave 36 招式登記（2 張） ───────────────────────────────────────────────

// 電擊魔獸｜雷電在地 — 220，自己下個回合所有寶可夢皆無法使用招式
regPre('電擊魔獸|雷電在地', (state, _a, _p) => ({ state, damage: 220 }));
regPost('電擊魔獸|雷電在地', playerNoAttacksNextPost('雷電在地'));

// 超音波幼蟲｜刺耳聲 — 0 傷，對手戰鬥寶可夢下個自己（攻擊方）回合受招式 +50
regPre('超音波幼蟲|刺耳聲', (state, _a, _p) => ({ state, damage: 0 }));
regPost('超音波幼蟲|刺耳聲', oppTargetTakeExtraNextPost(50, '刺耳聲'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 37 — 強制對手將戰鬥寶可夢與備戰寶可夢互換（由對手選）
//
// 機制：
//   - ATTACK_POST 觸發 pending 'bench-choose'，actorIdx=defenderIdx（對手自選）
//   - resolver 負責執行 swap，並給新上場的寶可夢設 movedToActiveThisTurn
//   - 變種：互換後對新上場寶可夢造成 N 點傷害（長毛巨魔｜挑釁抓擊）
//   - 若對手備戰為空：post 僅結算原本傷害，不觸發 pending
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ATTACK_POST：強制對手將戰鬥寶可夢與備戰寶可夢互換（由對手選）。
 * 若對手備戰為空 → 無效果（本來 damage 已在 pre 結算）。
 */
function forceOppSwapPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    if (d.bench.length === 0) {
      return addLog(state, `${label}：對手沒有備戰寶可夢可交換`, aIdx);
    }
    const s = addLog(state, `${label}：對手必須將戰鬥寶可夢與備戰寶可夢互換（由對手選擇）`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'force-opp-swap',
      params: { label, attackerIdx: aIdx },
    });
  };
}

/**
 * ATTACK_POST：強制對手 swap 後，對新上場的寶可夢造成 dmg 點傷害（不計弱點 / 抵抗力 / 附加效果）。
 * 若對手備戰為空：直接對現戰鬥寶可夢造成 dmg（因無處可替換，但招式還是要執行傷害部分）。
 */
function forceOppSwapThenDamagePost(dmg: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    if (d.bench.length === 0) {
      // 無備戰可換 → 對原戰鬥寶可夢補 dmg
      const newDmg = d.active.damage + dmg;
      const hp = effectiveHPInline(d.active, _pool, state);
      const nm = _pool.get(d.active.cardId)?.name ?? '?';
      if (hp > 0 && newDmg >= hp) {
        // KO
        const koPile: CardInstance[] = [
          { ...d.active, damage: newDmg },
          ...d.active.energyAttached,
          ...(d.active.toolAttached ? [d.active.toolAttached] : []),
          ...(d.active.evolvedFromStack ?? []),
        ];
        const cardDef = _pool.get(d.active.cardId);
        const morePrizes = cardDef ? koPrizeCount(cardDef) : 1;
        const players = [...state.players] as [PlayerState, PlayerState];
        players[dIdx] = { ...d, active: null, discard: [...d.discard, ...koPile] };
        return addLog({ ...state, players, pendingPrizes: (state.pendingPrizes ?? 0) + morePrizes },
          `${label}：對手無備戰，${nm} 受到 ${dmg} 點傷害後被擊倒（+${morePrizes} 張獎勵牌）`, aIdx);
      }
      const players = [...state.players] as [PlayerState, PlayerState];
      players[dIdx] = { ...d, active: { ...d.active, damage: newDmg } };
      return addLog({ ...state, players },
        `${label}：對手無備戰可交換，${nm} 受到 ${dmg} 點傷害`, aIdx);
    }
    const s = addLog(state, `${label}：對手必須將戰鬥寶可夢與備戰寶可夢互換，然後新上場的寶可夢受到 ${dmg} 點傷害（由對手選）`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'force-opp-swap-then-damage',
      params: { label, attackerIdx: aIdx, dmg },
    });
  };
}

regR('force-opp-swap', (st, actorIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '強制互換';
  const attackerIdx = ((params?.attackerIdx ?? (1 - actorIdx)) as 0 | 1);
  const p = st.players[actorIdx];
  if (!p.active) return st;
  const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
  if (bIdx < 0) return st;
  const oldActiveName = pool.get(p.active.cardId)?.name ?? '?';
  const newActiveName = pool.get(p.bench[bIdx].cardId)?.name ?? '?';
  const newBench = [...p.bench];
  // v2.08：離開戰鬥場清狀態旗標
  newBench[bIdx] = clearActiveEffects(p.active);
  const newActive: CardInstance = { ...p.bench[bIdx], movedToActiveThisTurn: true };
  const players = [...st.players] as [PlayerState, PlayerState];
  players[actorIdx] = { ...p, active: newActive, bench: newBench };
  return addLog({ ...st, players },
    `${label}：${oldActiveName} 退回備戰區，${newActiveName} 上場`, attackerIdx);
});

regR('force-opp-swap-then-damage', (st, actorIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '強制互換';
  const attackerIdx = ((params?.attackerIdx ?? (1 - actorIdx)) as 0 | 1);
  const dmg = Number(params?.dmg ?? 0);
  const p = st.players[actorIdx];
  if (!p.active) return st;
  const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
  if (bIdx < 0) return st;
  const oldActiveName = pool.get(p.active.cardId)?.name ?? '?';
  const swappingIn = p.bench[bIdx];
  const newActiveName = pool.get(swappingIn.cardId)?.name ?? '?';
  const newBench = [...p.bench];
  // v2.08：離開戰鬥場清狀態旗標
  newBench[bIdx] = clearActiveEffects(p.active);

  // 計算傷害（不計弱點 / 抵抗力 / 附加效果）
  const newDmg = swappingIn.damage + dmg;
  const hp = effectiveHPInline(swappingIn, pool, st);
  const players = [...st.players] as [PlayerState, PlayerState];
  let s: GameState = { ...st };

  if (dmg > 0 && hp > 0 && newDmg >= hp) {
    // 新上場寶可夢被擊倒 → 放入棄牌、active=null，攻擊方獲得獎勵
    const koPile: CardInstance[] = [
      { ...swappingIn, damage: newDmg, movedToActiveThisTurn: true },
      ...swappingIn.energyAttached,
      ...(swappingIn.toolAttached ? [swappingIn.toolAttached] : []),
      ...(swappingIn.evolvedFromStack ?? []),
    ];
    const cardDef = pool.get(swappingIn.cardId);
    const morePrizes = cardDef ? koPrizeCount(cardDef) : 1;
    players[actorIdx] = { ...p, active: null, bench: newBench, discard: [...p.discard, ...koPile] };
    s = addLog({ ...s, players },
      `${label}：${oldActiveName} 退回備戰區，${newActiveName} 上場後受到 ${dmg} 點傷害被擊倒（+${morePrizes} 張獎勵牌）`, attackerIdx);
    return { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + morePrizes };
  }

  const newActive: CardInstance = { ...swappingIn, damage: newDmg, movedToActiveThisTurn: true };
  players[actorIdx] = { ...p, active: newActive, bench: newBench };
  s = addLog({ ...s, players },
    `${label}：${oldActiveName} 退回備戰區，${newActiveName} 上場`, attackerIdx);
  if (dmg > 0) {
    s = addLog(s, `${label}：${newActiveName} 受到 ${dmg} 點傷害`, attackerIdx);
  }
  return s;
});

// ── Wave 37 招式登記（4 張） ───────────────────────────────────────────────

// 大狼犬｜踹開 — 50 + 強制對手互換
regPre('大狼犬|踹開', (state, _a, _p) => ({ state, damage: 50 }));
regPost('大狼犬|踹開', forceOppSwapPost('踹開'));

// 月桂葉｜推倒 — 10 + 強制對手互換
regPre('月桂葉|推倒', (state, _a, _p) => ({ state, damage: 10 }));
regPost('月桂葉|推倒', forceOppSwapPost('推倒'));

// 小箭雀｜送回 — 10 + 強制對手互換
regPre('小箭雀|送回', (state, _a, _p) => ({ state, damage: 10 }));
regPost('小箭雀|送回', forceOppSwapPost('送回'));

// 長毛巨魔｜挑釁抓擊 — 0 pre，互換後新上場寶可夢受 160 傷害
regPre('長毛巨魔|挑釁抓擊', (state, _a, _p) => ({ state, damage: 0 }));
regPost('長毛巨魔|挑釁抓擊', forceOppSwapThenDamagePost(160, '挑釁抓擊'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 38 — 攻擊前丟道具卡系列
//
// 已有 helper：defToolDiscardPre(base, label) — 丟對手戰鬥寶可夢的 tool + base 傷。
// 本波新增：
//   • selfToolDiscardOrFailPre — 先丟自身 tool，若無則招式失敗（0 傷）
//   • defToolDiscardParalyzePre — 丟對手 tool，若實際有丟棄則再施加【麻痺】
//
// 本波實裝卡片：
//   • 烈雀｜啄食 (M1L/MC) ─ 10 + 丟對手 tool
//   • 拉達｜削落 (M3) ─ 20 + 丟對手 tool
//   • 燃燒蟲｜啄落 (SV11B) ─ 10 + 丟對手 tool
//   • 派帕的貪心栗鼠｜咬取 (SV9a) ─ 10 + 丟對手 tool
//   • N的電電蟲｜劈哩啪啦短路 (SV9) ─ 30 + 丟對手 tool + 有丟棄則麻痺
//   • 美錄梅塔｜重塑斧 (SV7) ─ 250 + 必須丟自身 tool，無 tool 則失敗
//
// DEFER：安瓢蟲｜繁星花紋 (SV7) — 為【特性】（on-evolve ability），
// 需要新增進化觸發式 ability infra，拆到後續 wave 處理。
// ══════════════════════════════════════════════════════════════════════════════

/** 自身 tool 必須丟棄，否則招式失敗（0 傷）。用於「重塑斧」。 */
function selfToolDiscardOrFailPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active || !p.active.toolAttached) {
      return { state: addLog(state, `${label}：自身無道具可丟棄 → 招式失敗`, aIdx), damage: 0 };
    }
    const attName = pool.get(p.active.cardId)?.name ?? '?';
    const toolName = pool.get(p.active.toolAttached.cardId)?.name ?? '?';
    const discarded = p.active.toolAttached;
    let s = addLog(state, `${label}：丟棄 ${attName} 的道具「${toolName}」`, aIdx);
    s = updatePlayer(s, aIdx, pl => {
      if (!pl.active) return pl;
      const { toolAttached: _removed, ...rest } = pl.active;
      return { ...pl, active: rest as CardInstance, discard: [...pl.discard, discarded] };
    });
    return { state: s, damage: base };
  };
}

/** 丟對手 tool + base 傷，且「若有丟棄」再將對手戰鬥寶可夢【麻痺】。 */
function defToolDiscardParalyzePre(base: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    if (!def || !def.toolAttached) {
      return { state: addLog(state, `${label}：對手戰鬥寶可夢無道具（不觸發麻痺）`, aIdx), damage: base };
    }
    const defName = pool.get(def.cardId)?.name ?? '?';
    const toolName = pool.get(def.toolAttached.cardId)?.name ?? '?';
    const discarded = def.toolAttached;
    let s = addLog(state, `${label}：丟棄 ${defName} 的道具「${toolName}」`, aIdx);
    s = updatePlayer(s, dIdx, pl => {
      if (!pl.active) return pl;
      const { toolAttached: _removed, ...rest } = pl.active;
      return {
        ...pl,
        active: { ...(rest as CardInstance), status: 'paralyzed' },
        discard: [...pl.discard, discarded],
      };
    });
    s = addLog(s, `${defName} 陷入【麻痺】`, aIdx);
    return { state: s, damage: base };
  };
}

// ── Wave 38 招式登記 ──────────────────────────────────────────────────────

// 重用 defToolDiscardPre（對手 tool 丟棄）
regPre('烈雀|啄食', defToolDiscardPre(10, '啄食'));
regPre('拉達|削落', defToolDiscardPre(20, '削落'));
regPre('燃燒蟲|啄落', defToolDiscardPre(10, '啄落'));
regPre('派帕的貪心栗鼠|咬取', defToolDiscardPre(10, '咬取'));

// 丟對手 tool + 有丟棄則麻痺
regPre('N的電電蟲|劈哩啪啦短路', defToolDiscardParalyzePre(30, '劈哩啪啦短路'));

// 必須丟自身 tool，否則招式失敗
regPre('美錄梅塔|重塑斧', selfToolDiscardOrFailPre(250, '重塑斧'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 39 — 玩家級禁卡 / 卡片級能量附加鎖 / 跨回合獎賞加成
//
// 新 Helper（effects.ts）：
//   • oppCantPlayItemNextPost(label)       — 對手下個回合無法從手牌使出物品卡
//   • oppCantPlaySupporterNextPost(label)  — 對手下個回合無法從手牌使出支援者卡
//   • oppCantEvolveNextPost(label)         — 對手下個回合無法從手牌使出寶可夢並完成進化
//   • oppActiveCantAttachEnergyNextPost(label) — 對手戰鬥寶可夢下個回合無法附上從手牌的能量
//   • oppActiveDeferredPrizeNextPost(bonus, label) — 對手戰鬥寶可夢在攻擊方下個回合被 KO 時 +N 張獎勵牌
//   • selfDiscardAllEnergyPost(label)      — 自丟自身 active 所有附加能量
//
// 引擎聯動：
//   - PlayerState.cantPlayItemNextTurn/ThisTurn、cantPlaySupporterNext/This、cantEvolveNext/This
//   - CardInstance.cantAttachEnergyNextTurn/ThisTurn、deferredPrizeBonusNextTurn/ThisTurn
//   - engine.ts PLAY_TRAINER / EVOLVE / ATTACH_ENERGY gate 檢查上述旗標
//   - engine.ts END_TURN：於 nextIdx promote Next → This；於 aIdx 清除 This
//   - engine.ts KO 路徑讀取 deferredPrizeBonusThisTurn 加到 pendingPrizes
//
// 本波實裝（6 張）：
//   • 含羞苞｜癢癢花粉 10 + cantPlayItem
//   • 青銅鐘｜進化妨礙者 30 + cantEvolve
//   • 吼叫尾ex｜絕叫 0 + cantPlaySupporter（v2.219 補「後攻最初回合限定」gate）
//   • 電蜘蛛ex｜雷擊石 180 + 自丟所有能量 + cantPlayItem
//   • 晶光花｜侵蝕碎塊 20 + 中毒 + cantAttachEnergy
//   • 蝶結萌虻｜多餘花粉 30 + deferredPrizeBonus=2
// ══════════════════════════════════════════════════════════════════════════════

function oppCantPlayItemNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...players[dIdx], cantPlayItemNextTurn: true };
    return addLog({ ...state, players }, `${label}：對手下個回合無法從手牌使出物品卡`, aIdx);
  };
}

function oppCantPlaySupporterNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...players[dIdx], cantPlaySupporterNextTurn: true };
    return addLog({ ...state, players }, `${label}：對手下個回合無法從手牌使出支援者卡`, aIdx);
  };
}

function oppCantEvolveNextPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...players[dIdx], cantEvolveNextTurn: true };
    return addLog({ ...state, players }, `${label}：對手下個回合無法從手牌使出寶可夢並完成進化`, aIdx);
  };
}

function oppActiveCantAttachEnergyNextPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    const dName = pool.get(d.active.cardId)?.name ?? '?';
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...d, active: { ...d.active, cantAttachEnergyNextTurn: true } };
    return addLog({ ...state, players }, `${label}：${dName} 下個回合無法附上從手牌使出的能量卡`, aIdx);
  };
}

function oppActiveDeferredPrizeNextPost(bonus: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const d = state.players[dIdx];
    if (!d.active) return state;
    const dName = pool.get(d.active.cardId)?.name ?? '?';
    const players = [...state.players] as [PlayerState, PlayerState];
    players[dIdx] = {
      ...d,
      active: {
        ...d.active,
        deferredPrizeBonusNextTurn: (d.active.deferredPrizeBonusNextTurn ?? 0) + bonus,
      },
    };
    return addLog(
      { ...state, players },
      `${label}：${dName} 若在攻擊方下個回合被擊倒，多 +${bonus} 張獎勵牌`,
      aIdx,
    );
  };
}

// 註：selfDiscardAllEnergyPost 已於 4971 行定義，直接重用。

// ── Wave 39 招式登記 ──────────────────────────────────────────────────────

// 含羞苞｜癢癢花粉 10 + 下回合對手禁物品卡
regPre('含羞苞|癢癢花粉', (s, _a, _p) => ({ state: s, damage: 10 }));
regPost('含羞苞|癢癢花粉', oppCantPlayItemNextPost('癢癢花粉'));

// 青銅鐘｜進化妨礙者 30 + 下回合對手禁進化
regPre('青銅鐘|進化妨礙者', (s, _a, _p) => ({ state: s, damage: 30 }));
regPost('青銅鐘|進化妨礙者', oppCantEvolveNextPost('進化妨礙者'));

// 吼叫尾ex｜絕叫 0 + 下回合對手禁支援者
regPre('吼叫尾ex|絕叫', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('吼叫尾ex|絕叫', oppCantPlaySupporterNextPost('絕叫'));

// 電蜘蛛ex｜雷擊石 180 + 自丟所有能量 + 下回合對手禁物品卡
regPre('電蜘蛛ex|雷擊石', (s, _a, _p) => ({ state: s, damage: 180 }));
regPost('電蜘蛛ex|雷擊石', (state, aIdx, pool) => {
  let s = selfDiscardAllEnergyPost('雷擊石')(state, aIdx, pool);
  s = oppCantPlayItemNextPost('雷擊石')(s, aIdx, pool);
  return s;
});

// 晶光花｜侵蝕碎塊 20 + 中毒 + 下回合對手戰鬥寶可夢無法附能
regPre('晶光花|侵蝕碎塊', (s, _a, _p) => ({ state: s, damage: 20 }));
regPost('晶光花|侵蝕碎塊', (state, aIdx, pool) => {
  let s = statusPost('poisoned')(state, aIdx, pool);
  s = oppActiveCantAttachEnergyNextPost('侵蝕碎塊')(s, aIdx, pool);
  return s;
});

// 蝶結萌虻｜多餘花粉 30 + 跨回合獎賞 +2
regPre('蝶結萌虻|多餘花粉', (s, _a, _p) => ({ state: s, damage: 30 }));
regPost('蝶結萌虻|多餘花粉', oppActiveDeferredPrizeNextPost(2, '多餘花粉'));

// ══════════════════════════════════════════════════════════════════════════════
// Wave 40 — 自身 KO 類特性 / 招式（v1.95）
//
// 共 2 張：
//   1. 彷徨夜靈|咒詛炸彈   — 自身昏厥 + 在對手 1 隻寶可夢身上放 5 個傷害指示物
//   2. 三合一磁怪|過度放電 — 自身昏厥 + 從自己棄牌區選最多 3 張基本【雷】能量
//                            以任意方式附於自己的【雷】寶可夢身上
//                            （sim/AI 簡化：全部附於單一選擇的目標）
//
// 兩張的卡牌資料在部分套牌登記為 abilities[]（→ regA），其餘套牌以 attacks[] 形式
// 登記（名稱前綴 ZWJ U+200C + [特性]）。兩種路徑都需要註冊以確保涵蓋。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 自身 KO 某隻特定 iid 寶可夢 — 含附加卡送棄牌 + 對手即時取獎賞 + 勝負檢查。
 * （自身 KO 時，對手的獎賞不經 pendingPrizes，因攻擊方無法自己取自己 KO 的獎賞。）
 */
export function selfKOInstance(
  state: GameState,
  aIdx: 0 | 1,
  iid: string,
  pool: Map<string, Card>,
  label: string,
): GameState {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[aIdx];
  const isActive = p.active?.iid === iid;
  const target = isActive ? p.active! : p.bench.find(c => c.iid === iid);
  if (!target) return state;
  const tCard = pool.get(target.cardId);
  const tName = tCard?.name ?? '?';
  const ko: CardInstance[] = [
    { ...target, damage: tCard?.hp ?? 999 },
    ...target.energyAttached,
    ...(target.toolAttached ? [target.toolAttached] : []),
    ...(target.evolvedFromStack ?? []),
  ];
  const prizes = tCard ? koPrizeCount(tCard) : 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const newP: PlayerState = {
    ...p,
    discard: [...p.discard, ...ko],
    active: isActive ? null : p.active,
    bench: isActive ? p.bench : p.bench.filter(c => c.iid !== iid),
  };
  players[aIdx] = newP;
  let s: GameState = addLog({ ...state, players }, `${label}：${tName} 昏厥！對手取得 ${prizes} 張獎勵牌`, null);
  // 對手即時取獎賞
  const opp = s.players[dIdx];
  const take = Math.min(prizes, opp.prizes.length);
  if (take > 0) {
    const taken = opp.prizes.slice(0, take);
    const finalPlayers = [...s.players] as [PlayerState, PlayerState];
    finalPlayers[dIdx] = { ...opp, prizes: opp.prizes.slice(take), hand: [...opp.hand, ...taken] };
    s = addLog({ ...s, players: finalPlayers }, `${opp.name} 取走 ${take} 張獎勵牌`, null);
    if (finalPlayers[dIdx].prizes.length === 0) {
      return { ...s, phase: 'game-over', winner: dIdx, winReason: '取得所有獎勵牌' };
    }
  }
  // 自身是否無後繼
  if (isActive && newP.bench.length === 0) {
    return { ...s, phase: 'game-over', winner: dIdx, winReason: `${p.name} 沒有可上場的寶可夢` };
  }
  return s;
}

/** 找本回合已觸發特性且 cardName 符合的 CardInstance iid（regA 內部用）。*/
export function findAbilityUserIid(
  state: GameState,
  aIdx: 0 | 1,
  cardName: string,
  pool: Map<string, Card>,
): string | null {
  const p = state.players[aIdx];
  const all = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  for (const c of all) {
    if (!c.abilityUsedThisTurn) continue;
    const card = pool.get(c.cardId);
    if (card?.name === cardName) return c.iid;
  }
  return null;
}

// ── 咒詛炸彈 resolver ─────────────────────────────────────────────────────
// 流程：opp-poke-choose → 對目標 +N counter（N 由 params.counters 決定，預設 5）→ 自身 KO。
// 若目標被 +N 擊倒，pendingPrizes 照常累積；若自身 KO 後對手 prize 歸零 → 對手勝。
// counters: 5 = 彷徨夜靈（+50 傷害）；13 = 黑夜魔靈（+130 傷害）
regR('cursed-bomb', (st, actorIdx, selectedIids, params, pool) => {
  const label = (params?.label as string) ?? '咒詛炸彈';
  const userIid = params?.userIid as string | undefined;
  const counters = (params?.counters as number) ?? 5;
  const addDmg = counters * 10;
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = selectedIids[0];
  if (!targetIid) return st;
  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  // v2.22 對戰圓形競技場：特性類對備戰的傷害指示物放置無效（仍自 KO 自己）
  if (!isActive && isBenchProtected(st, pool)) {
    const name = pool.get(target.cardId)?.name ?? '?';
    let s = addLog(st, `${label}：${name} 因對戰圓形競技場效果不受傷害指示物`, actorIdx);
    if (userIid) {
      s = selfKOInstance(s, actorIdx, userIid, pool, label);
    }
    return s;
  }
  const targetCard = pool.get(target.cardId);
  const tHp = targetCard?.hp ?? 0;
  const newDmg = target.damage + addDmg;
  let s: GameState = st;
  if (tHp > 0 && newDmg >= tHp) {
    // 目標被放 N 個指示物擊倒
    const koDiscard: CardInstance[] = [
      { ...target, damage: newDmg },
      ...target.energyAttached,
      ...(target.toolAttached ? [target.toolAttached] : []),
      ...(target.evolvedFromStack ?? []),
    ];
    const prizes = targetCard ? koPrizeCount(targetCard) : 1;
    const players = [...s.players] as [PlayerState, PlayerState];
    const newDefender: PlayerState = {
      ...defender,
      discard: [...defender.discard, ...koDiscard],
      active: isActive ? null : defender.active,
      bench: isActive ? defender.bench : defender.bench.filter(c => c.iid !== targetIid),
    };
    players[dIdx] = newDefender;
    s = addLog({ ...s, players },
      `${label}：在 ${targetCard?.name ?? '?'} 身上放 ${counters} 個傷害指示物 → 被擊倒！+${prizes} 張獎勵牌`, actorIdx);
    s = { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + prizes };
    if (isActive && newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
  } else {
    const players = [...s.players] as [PlayerState, PlayerState];
    const newDefender = { ...defender };
    if (isActive) newDefender.active = { ...target, damage: newDmg };
    else newDefender.bench = defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c);
    players[dIdx] = newDefender;
    s = addLog({ ...s, players }, `${label}：在 ${targetCard?.name ?? '?'} 身上放 ${counters} 個傷害指示物`, actorIdx);
  }
  // 自身 KO（不論目標是否被擊倒）
  if (userIid) {
    s = selfKOInstance(s, actorIdx, userIid, pool, label);
  }
  return s;
});

/**
 * 可達鴨｜濕氣 — 內嵌判定（避免循環 import）。
 * 只要任一方場上有可達鴨（active 或 bench），所有「將自己昏厥」類效果
 * （ability / [特性]招式）全部不觸發。
 */
function hasPsyduckDamp(state: GameState, pool: Map<string, Card>): boolean {
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

/** 招式式 [特性]咒詛炸彈 — 攻擊者 = active。counters: 放幾個傷害指示物（預設 5） */
export function cursedBombAttackPost(label: string, counters: number = 5): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    // 可達鴨｜濕氣：自身 KO 類招式被消除（不放指示物也不自 KO）
    if (hasPsyduckDamp(state, pool)) {
      return addLog(state, `${label}：被可達鴨的濕氣消除`, aIdx);
    }
    const userIid = p.active.iid;
    const dIdx = (1 - aIdx) as 0 | 1;
    const dp = state.players[dIdx];
    if (!dp.active && dp.bench.length === 0) {
      return selfKOInstance(addLog(state, `${label}：對手無可選寶可夢`, aIdx),
        aIdx, userIid, pool, label);
    }
    const s = addLog(state, `${label}：選 1 隻對手寶可夢放 ${counters} 個傷害指示物`, aIdx);
    return withPending(s, {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'cursed-bomb',
      params: { label, userIid, includeActive: true, counters },
    });
  };
}

// ── 過度放電 resolver + postFn ────────────────────────────────────────────
// 流程：先自身 KO（active）→ 再 pending discard-search（Energy:Lightning, 1-3）→
//       resolver 選 1 隻自己雷寶可夢附上全部能量。

regR('overvolt-attach-pick-target', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '過度放電';
  const p = st.players[idx];
  const lightningSelf = [p.active, ...p.bench].filter((c): c is CardInstance => {
    if (!c) return false;
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Lightning';
  });
  if (lightningSelf.length === 0) {
    // 全部雷寶可夢已離場 — 能量留在棄牌區
    return addLog(st, `${label}：場上無【雷】寶可夢，能量留在棄牌區`, idx);
  }
  if (lightningSelf.length === 1) {
    const target = lightningSelf[0];
    const energies = p.discard.filter(c => iids.includes(c.iid));
    const tName = pool.get(target.cardId)?.name ?? '?';
    const s = addLog(st, `${label}：將 ${energies.length} 張基本雷能量附加到 ${tName}`, idx);
    return updatePlayer(s, idx, pl => {
      const rest = pl.discard.filter(c => !iids.includes(c.iid));
      if (pl.active && pl.active.iid === target.iid) {
        return { ...pl, discard: rest,
          active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } };
      }
      return { ...pl, discard: rest,
        bench: pl.bench.map(c => c.iid === target.iid
          ? { ...c, energyAttached: [...c.energyAttached, ...energies] } : c) };
    });
  }
  // 多隻雷寶可夢：v2.221 升級為「逐張分配」（之前簡化為全部附到單一目標）
  // 卡面：「以任意方式附於自己的【雷】寶可夢身上」— 每張能量可附到不同雷寶
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'overvolt-attach-commit',
    params: { energyIids: iids, label, totalCount: iids.length, placedCount: 0 },
  });
});

// v2.221：升級為逐張分配（每張可附到不同雷寶可夢；同樣也可全部附到 1 隻）
regR('overvolt-attach-commit', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '過度放電';
  const energyIids = (params?.energyIids as string[]) ?? [];
  const totalCount = (params?.totalCount as number) ?? energyIids.length;
  const placedCount = (params?.placedCount as number) ?? 0;
  if (energyIids.length === 0) return st;
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  if (targetCard?.pokemonType !== 'Lightning') {
    return addLog(st, `${label}：目標非【雷】寶可夢，取消附加`, idx);
  }
  const currentEnergyIid = energyIids[0];
  const restIids = energyIids.slice(1);
  const energy = p.discard.find(c => c.iid === currentEnergyIid);
  if (!energy) return st;
  let s = addLog(st,
    `${label}：將第 ${placedCount + 1}/${totalCount} 張基本雷能量附加到 ${targetCard.name}`, idx);
  s = updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => c.iid !== currentEnergyIid);
    if (pl.active && pl.active.iid === targetIid) {
      return { ...pl, discard: rest,
        active: { ...pl.active, energyAttached: [...pl.active.energyAttached, energy] } };
    }
    return { ...pl, discard: rest,
      bench: pl.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, energy] } : c) };
  });
  if (restIids.length > 0) {
    return withPending(s, {
      type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'overvolt-attach-commit',
      params: { energyIids: restIids, label, totalCount, placedCount: placedCount + 1 },
    });
  }
  return s;
});

function overvoltAttackPost(label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (!p.active) return state;
    // 可達鴨｜濕氣：自身 KO 類招式被消除（不 KO 自己也不找能量）
    if (hasPsyduckDamp(state, pool)) {
      return addLog(state, `${label}：被可達鴨的濕氣消除`, aIdx);
    }
    const userIid = p.active.iid;
    // (1) 自身 KO
    let s = selfKOInstance(state, aIdx, userIid, pool, label);
    if (s.phase === 'game-over') return s;
    // (2) 棄牌區基本雷能量候選
    const cand = s.players[aIdx].discard.filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Lightning';
    });
    if (cand.length === 0) return addLog(s, `${label}：棄牌區無基本雷能量`, aIdx);
    // (3) 場上是否還有雷寶可夢
    const hasLightning = [s.players[aIdx].active, ...s.players[aIdx].bench].some(c => {
      if (!c) return false;
      return pool.get(c.cardId)?.pokemonType === 'Lightning';
    });
    if (!hasLightning) return addLog(s, `${label}：場上無【雷】寶可夢，無法附加`, aIdx);
    // (4) pending discard-search
    const realMax = Math.min(3, cand.length);
    const s2 = addLog(s, `${label}：從棄牌區選 1-${realMax} 張基本雷能量`, aIdx);
    return withPending(s2, {
      type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Energy:Lightning', minCount: 1, maxCount: realMax,
      effectKey: 'overvolt-attach-pick-target',
      params: { label },
    });
  };
}

// ── 註冊 ─────────────────────────────────────────────────────────────────

// 彷徨夜靈｜咒詛炸彈（5 counter）— 正統 ability 路徑
// v2.95：JSON migration 後 abilities[0]={name:'咒詛炸彈'} 穩定存在，attack-style
// ZWJ 變體註冊全部移除（見 v2.95 commit）。
regA('彷徨夜靈', 0, (st, aIdx, pool) => {
  const userIid = findAbilityUserIid(st, aIdx, '彷徨夜靈', pool);
  if (!userIid) return st;
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active && dp.bench.length === 0) {
    return selfKOInstance(addLog(st, '咒詛炸彈：對手無可選寶可夢', aIdx),
      aIdx, userIid, pool, '咒詛炸彈');
  }
  const s = addLog(st, '咒詛炸彈：選 1 隻對手寶可夢放 5 個傷害指示物', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'cursed-bomb',
    params: { label: '咒詛炸彈', userIid, includeActive: true },
  });
});

// 三合一磁怪｜過度放電（自身 KO + 從棄牌選 1-3 張基本【雷】能量附自己【雷】寶可夢）
// v2.95：JSON migration 後從 attack-style 改為正統 ability 路徑。
// 行為對齊原 overvoltAttackPost（維持相同 semantics，不改既有 filter 規則）。
regA('三合一磁怪', 0, (st, aIdx, pool) => {
  const label = '過度放電';
  const userIid = findAbilityUserIid(st, aIdx, '三合一磁怪', pool);
  if (!userIid) return st;
  // 可達鴨｜濕氣：自身 KO 類特性被消除
  if (hasPsyduckDamp(st, pool)) {
    return addLog(st, `${label}：被可達鴨的濕氣消除`, aIdx);
  }
  // (1) 自身 KO
  let s = selfKOInstance(st, aIdx, userIid, pool, label);
  if (s.phase === 'game-over') return s;
  // (2) 棄牌區基本【雷】能量候選
  const cand = s.players[aIdx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Lightning';
  });
  if (cand.length === 0) return addLog(s, `${label}：棄牌區無基本雷能量`, aIdx);
  // (3) 場上是否還有雷寶可夢（self KO 後）
  const hasLightning = [s.players[aIdx].active, ...s.players[aIdx].bench].some(c => {
    if (!c) return false;
    return pool.get(c.cardId)?.pokemonType === 'Lightning';
  });
  if (!hasLightning) return addLog(s, `${label}：場上無【雷】寶可夢，無法附加`, aIdx);
  // (4) pending discard-search
  const realMax = Math.min(3, cand.length);
  const s2 = addLog(s, `${label}：從棄牌區選 1-${realMax} 張基本雷能量`, aIdx);
  return withPending(s2, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Energy:Lightning', minCount: 1, maxCount: realMax,
    effectKey: 'overvolt-attach-pick-target',
    params: { label },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 41 — 訓練家補實裝：
//   珍寶配件 / 能量輸送PRO / 水蓮的照顧 / 寶可夢旋風回收機 /
//   阿克羅瑪的執著 / 百萬噸吹風機
// ══════════════════════════════════════════════════════════════════════════════

// ── 珍寶配件（Item） ── 從牌庫選最多 5 張寶可夢道具加手牌 ────────────────
// 資料結構：道具 supertype='Pokemon' subtype='Other'（與 UI 'Tool' filter 對應）
regG('珍寶配件', (st, idx, pool) => {
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Trainer' && card.subtype === 'PokemonTool';
  });
});
reg('珍寶配件', (st, idx) => {
  st = addLog(st, '珍寶配件：從牌庫選最多 5 張寶可夢道具加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Tool',
    minCount: 0, maxCount: 5,
    effectKey: 'search-generic-to-hand',
  });
});

// 通用 resolver：選到的卡加入手牌、重洗牌庫、log 卡名
regR('search-generic-to-hand', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '牌庫搜尋：未選擇任何卡（牌庫已重洗）', idx);
  }
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.130：對手看不到具體卡名（對手看 「搜到 X 張卡加入手牌」）
  st = addPrivateLog(st,
    `搜到：${names} 加入手牌（牌庫已重洗）`,
    `搜到 ${chosen.length} 張卡加入手牌（牌庫已重洗）`,
    idx);
  return updatePlayer(st, idx, (p) => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const rest = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...picked] };
  });
});

// ── 能量輸送（Item / MC 639）── 從牌庫選 1 張基本能量加手牌（給對手看）+ 重洗
// v2.165：實裝（之前未實裝；火箭隊的烏鴉頭頭 preset 用）
//   卡面：「從自己的牌庫選擇1張基本能量卡，在給對手看過後加入手牌。並且重洗牌庫。」
// 與 能量輸送PRO 差異：本卡只搜 1 張、不需要不同屬性、log 強制公開（卡面要求「給對手看過」）
regG('能量輸送', (st, idx, pool) => {
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
});
reg('能量輸送', (st, idx) => {
  st = addLog(st, '能量輸送：從牌庫選 1 張基本能量加入手牌（給對手看）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'energy-transfer-search',
  });
});
regR('energy-transfer-search', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '能量輸送：未選擇任何能量（牌庫已重洗）', idx);
  }
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const pickedNames = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // 卡面強制公開（給對手看過）— 用 addLog（公開）而非 addPrivateLog
  st = addLog(st, `能量輸送：搜到 ${pickedNames} 加入手牌`, idx);
  return updatePlayer(st, idx, (p) => {
    const pickedIids = new Set(iids);
    const pickedInDeck = p.deck.filter(c => pickedIids.has(c.iid));
    const rest = p.deck.filter(c => !pickedIids.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...pickedInDeck] };
  });
});

// ── 能量輸送PRO（Item） ── 從牌庫選任意張數不同屬性基本能量加手牌 ──────
regG('能量輸送PRO', (st, idx, pool) => {
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
});
reg('能量輸送PRO', (st, idx) => {
  st = addLog(st, '能量輸送PRO：從牌庫選任意張數基本能量加手牌（同屬只取 1 張）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 8,
    effectKey: 'energy-pro-search',
  });
});
regR('energy-pro-search', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '能量輸送PRO：未選擇任何能量（牌庫已重洗）', idx);
  }
  // 依「卡名」去重（基本能量名唯一對應屬性，例：基本【雷】能量）
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const seen = new Set<string>();
  const kept: CardInstance[] = [];
  const dupes: CardInstance[] = [];
  for (const c of chosen) {
    const nm = pool.get(c.cardId)?.name ?? '';
    if (seen.has(nm)) { dupes.push(c); continue; }
    seen.add(nm);
    kept.push(c);
  }
  const keptNames = kept.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addLog(st, `能量輸送PRO：搜到 ${keptNames}（${kept.length} 張）加入手牌`, idx);
  if (dupes.length > 0) {
    st = addLog(st, `（同屬重複 ${dupes.length} 張放回牌庫）`, idx);
  }
  return updatePlayer(st, idx, (p) => {
    const keptIids = new Set(kept.map(c => c.iid));
    const pickedInDeck = p.deck.filter(c => keptIids.has(c.iid));
    const rest = p.deck.filter(c => !keptIids.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...pickedInDeck] };
  });
});

// ── 水蓮的照顧（Supporter） ── 棄牌區選寶可夢（非 rule-box）+ 基本能量合計最多 3 張
regG('水蓮的照顧', (st, idx, pool) => {
  return st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    if (card.supertype === 'Pokemon' && card.subtype !== 'ex') return true;
    if (card.supertype === 'Energy' && card.subtype === 'Basic') return true;
    return false;
  });
});
reg('水蓮的照顧', (st, idx) => {
  st = addLog(st, '水蓮的照顧：從棄牌區選寶可夢（不含 ex）+ 基本能量合計最多 3 張加手牌', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonNonExOrBasicEnergy',
    minCount: 0, maxCount: 3,
    effectKey: 'discard-to-hand',
  });
});

// ── 寶可夢旋風回收機（Item） ── 選 1 自己場上寶可夢 → 本體+附加全放回手牌
regG('寶可夢旋風回收機', (st, idx) => {
  const p = st.players[idx];
  // 只有 active 且備戰空 → 不可打（否則場上就沒有寶可夢）
  // 只要備戰 >= 1（或 active 有且備戰也有），就可用
  if (!p.active && p.bench.length === 0) return false;
  if (p.active && p.bench.length === 0) return false; // 只有 active，回收了就沒了
  if (!p.active && p.bench.length > 0) return true;   // 只有備戰
  return true;                                         // active + bench 皆有
});
reg('寶可夢旋風回收機', (st, idx) => {
  const p = st.players[idx];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  // 若備戰空而只有 active → 不應進入此函式（guard 應攔下）。仍做防禦：只列備戰
  const validIids = (p.bench.length === 0)
    ? []
    : all.map(c => c.iid);
  st = addLog(st, '寶可夢旋風回收機：選 1 隻自己場上的寶可夢放回手牌（含附加卡）', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: '', minCount: 1, maxCount: 1,
    params: { validIids },
    effectKey: 'wind-vortex-return',
  });
});
regR('wind-vortex-return', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  if (!targetIid) return st;
  const p = st.players[idx];
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active! : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tName = pool.get(target.cardId)?.name ?? '?';
  // 重置為純淨狀態（清除傷害、狀態、旗標、能量、道具、進化棧）
  const mainBare: CardInstance = {
    ...target,
    damage: 0,
    energyAttached: [],
    toolAttached: undefined,
    status: undefined,
    evolvedFromStack: undefined,
    evolvedThisTurn: undefined,
    justPlaced: undefined,
    movedToActiveThisTurn: undefined,
    damageBonusThisTurn: undefined,
    damageReduceNextHit: undefined,
    abilityUsedThisTurn: undefined,
    cantAttackThisTurn: undefined,
    cantAttackPending: undefined,
    cantRetreatNextTurn: undefined,
    cantRetreatPendingSelf: undefined,
    damageBonusPending: undefined,
  };
  const returning: CardInstance[] = [
    mainBare,
    ...target.energyAttached,
    ...(target.toolAttached ? [target.toolAttached] : []),
    ...(target.evolvedFromStack ?? []),
  ];
  const s = addLog(st, `寶可夢旋風回收機：將 ${tName} 與附加的 ${returning.length - 1} 張卡放回手牌`, idx);
  return updatePlayer(s, idx, pp => ({
    ...pp,
    active: isActive ? null : pp.active,
    bench: isActive ? pp.bench : pp.bench.filter(c => c.iid !== targetIid),
    hand: [...pp.hand, ...returning],
  }));
});

// ── 阿克羅瑪的執著（Supporter） ── 從牌庫選競技場卡 + 能量卡各 1 張加手牌
regG('阿克羅瑪的執著', (st, idx, pool) => {
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    if (card.supertype === 'Trainer' && card.subtype === 'Stadium') return true;
    if (card.supertype === 'Energy') return true;
    return false;
  });
});
reg('阿克羅瑪的執著', (st, idx) => {
  st = addLog(st, '阿克羅瑪的執著：步驟 1／2 — 從牌庫選 1 張競技場卡加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stadium',
    minCount: 0, maxCount: 1,
    effectKey: 'akuroma-step1-stadium',
  });
});
regR('akuroma-step1-stadium', (st, idx, iids, _params, pool) => {
  let s = st;
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    s = addLog(s, `阿克羅瑪的執著：搜到 ${names}（競技場）加入手牌`, idx);
    s = updatePlayer(s, idx, (p) => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: rest, hand: [...p.hand, ...picked] };
    });
  } else {
    s = addLog(s, '阿克羅瑪的執著：未選擇競技場卡', idx);
  }
  // Step 2
  s = addLog(s, '阿克羅瑪的執著：步驟 2／2 — 從牌庫選 1 張能量卡加手牌', idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy',
    minCount: 0, maxCount: 1,
    effectKey: 'akuroma-step2-energy',
  });
});
regR('akuroma-step2-energy', (st, idx, iids, _params, pool) => {
  let s = st;
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    s = addLog(s, `阿克羅瑪的執著：搜到 ${names}（能量）加入手牌`, idx);
    s = updatePlayer(s, idx, (p) => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: rest, hand: [...p.hand, ...picked] };
    });
  } else {
    s = addLog(s, '阿克羅瑪的執著：未選擇能量卡', idx);
  }
  // 最後重洗牌庫
  return updatePlayer(s, idx, (p) => ({ ...p, deck: shuffle(p.deck) }));
});

// ── 百萬噸吹風機（Item） ── 丟棄對手所有道具 + 特殊能量 + 場上競技場 ────
regG('百萬噸吹風機', (st, idx, pool) => {
  const opp = st.players[(1 - idx) as 0 | 1];
  const allOpp = [...(opp.active ? [opp.active] : []), ...opp.bench];
  const hasTool = allOpp.some(c => c.toolAttached);
  const hasSpecial = allOpp.some(c =>
    c.energyAttached.some(e => pool.get(e.cardId)?.subtype === 'Special')
  );
  const hasStadium = !!st.activeStadium;
  return hasTool || hasSpecial || hasStadium;
});
reg('百萬噸吹風機', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];

  // 收集要丟棄的道具與特殊能量
  const removedTools: CardInstance[] = [];
  const removedSpecials: CardInstance[] = [];
  const toolNames: string[] = [];
  const specialNames: string[] = [];
  const stripOne = (c: CardInstance | null): CardInstance | null => {
    if (!c) return c;
    if (c.toolAttached) {
      removedTools.push(c.toolAttached);
      toolNames.push(pool.get(c.toolAttached.cardId)?.name ?? '?');
    }
    const keptEnergies: CardInstance[] = [];
    for (const e of c.energyAttached) {
      if (pool.get(e.cardId)?.subtype === 'Special') {
        removedSpecials.push(e);
        specialNames.push(pool.get(e.cardId)?.name ?? '?');
      } else {
        keptEnergies.push(e);
      }
    }
    return { ...c, toolAttached: undefined, energyAttached: keptEnergies };
  };
  const newOppActive = stripOne(opp.active);
  const newOppBench = opp.bench.map(b => stripOne(b)).filter((x): x is CardInstance => !!x);
  const players = [...st.players] as [PlayerState, PlayerState];
  players[dIdx] = {
    ...opp,
    active: newOppActive,
    bench: newOppBench,
    discard: [...opp.discard, ...removedTools, ...removedSpecials],
  };
  let s: GameState = { ...st, players };
  if (toolNames.length > 0) {
    s = addLog(s, `百萬噸吹風機：丟棄對手 ${toolNames.length} 張道具（${toolNames.join('、')}）`, idx);
  }
  if (specialNames.length > 0) {
    s = addLog(s, `百萬噸吹風機：丟棄對手 ${specialNames.length} 張特殊能量（${specialNames.join('、')}）`, idx);
  }
  // 丟棄場上的競技場（丟到使用者棄牌區 — MVP 簡化，資料未追蹤擁有者）
  if (s.activeStadium) {
    const stadName = pool.get(s.activeStadium.cardId)?.name ?? '?';
    const players2 = [...s.players] as [PlayerState, PlayerState];
    players2[idx] = { ...players2[idx], discard: [...players2[idx].discard, s.activeStadium] };
    s = { ...s, players: players2, activeStadium: undefined };
    s = addLog(s, `百萬噸吹風機：丟棄場上的競技場 ${stadName}`, idx);
  }
  if (toolNames.length === 0 && specialNames.length === 0) {
    // 若連 stadium 都沒有，由 guard 攔下；進到這裡表示只有 stadium 被丟，已 log 過
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 42 — 「竹蘭的烈咬陸鯊EX」JP meta 牌組實裝（v1.97）
//
// 項目：
//   1. 竹蘭的烈咬陸鯊ex｜螺旋俯衝  — 100 + 抽到滿 6
//   2. 竹蘭的烈咬陸鯊ex｜龍之爆發  — 260 + 自己全丟能量
//   3. 竹蘭的尖牙陸鯊｜王者呼聲    — 特性，搜 1 張「竹蘭的」寶可夢到手牌
//   4. 竹蘭的圓陸鯊｜岩石投擲      — 20 不計算弱點/抵抗力
//   5. 竹蘭的羅絲雷朵｜輝煌聲援    — 被動特性，場上時「竹蘭的」寶可夢招式 +30
//   6. 竹蘭的花岩怪｜激怒咒詛      — 備戰「竹蘭的」×10，skipWeakRes
//   7. 力量蛋白飲（Item）            — 本回合 [鬥] 寶可夢招式 +30（player flag）
//   8. 戰鬥鑼（Item）                 — 搜 1 張 [鬥] 基礎寶可夢 或 基本【鬥】能量到手牌
//   9. 寶可平板（Item）              — 搜 1 張「非擁有規則」寶可夢到手牌
//   10. 竹蘭的力量負重（道具）       — 「竹蘭的」寶可夢 HP +70（已由 TOOL_HP_BONUS 處理）
//   11. 火箭隊的拉姆達（Supporter）  — 搜 1 張訓練家卡到手牌
//   12. 硬岩【鬥】能量（特殊能量）   — 屬性：鬥（免疫效果延後）
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. 螺旋俯衝 — 100 傷害 + 抽到滿 6 ────────────────────────────────────────
// v2.22：卡名統一（pool.ts loadSet strip <>），只登錄純名稱即可
regPost('竹蘭的烈咬陸鯊ex|螺旋俯衝', drawToHandPost(6, '螺旋俯衝'));

// ── 2. 龍之爆發 — 260 傷害 + 自己全部能量丟棄 ─────────────────────────────
regPost('竹蘭的烈咬陸鯊ex|龍之爆發', selfDiscardAllEnergyPost('龍之爆發'));

// ── 3. 竹蘭的尖牙陸鯊｜王者呼聲（特性）──────────────────────────────────────
// 每回合 1 次（ABILITY_USED 一次性規則由 engine 管控）：從牌庫選 1 張「竹蘭的」寶可夢加手牌。
regA('竹蘭的尖牙陸鯊', 0, (st, idx, pool) => {
  const p = st.players[idx];
  const hasTarget = p.deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon'
      && card.name.includes('竹蘭的');
  });
  if (!hasTarget) {
    return addLog(st, '王者呼聲：牌庫沒有「竹蘭的」寶可夢可搜', idx);
  }
  st = addLog(st, '王者呼聲：從牌庫選 1 張「竹蘭的」寶可夢加入手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'CynthiaPokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-generic-to-hand',
  });
});

// ── 4. 竹蘭的圓陸鯊｜岩石投擲 — 20 傷害 skipWeakRes ─────────────────────────
regPre('竹蘭的圓陸鯊|岩石投擲', skipWeakResPre(20, '岩石投擲'));

// ── 5. 輝煌聲援（被動）— 上面 PASSIVE_ATTACK_BONUS 已登記，不需 regA ────────
// 被動特性在 engine 傷害計算時自動掃場觸發，不透過 ABILITY_EFFECTS。

// ── 6. 竹蘭的花岩怪｜激怒咒詛 —————————————————————————————————————
// 基礎傷害 0，對方戰鬥寶可夢每張自己備戰「竹蘭的」寶可夢的傷害指示物 +10；不計算弱點/抵抗力。
// v2.22：卡名統一（pool.ts loadSet strip <>），只登錄純名稱即可
regPre('竹蘭的花岩怪|激怒咒詛', (state, aIdx, pool, _action) => {
  const p = state.players[aIdx];
  let totalMarkers = 0;
  for (const b of p.bench) {
    const card = pool.get(b.cardId);
    if (card?.name.includes('竹蘭的')) {
      // 以 10 為單位計數（傷害指示物每顆 10 HP）
      totalMarkers += Math.floor(b.damage / 10);
    }
  }
  const damage = totalMarkers * 10;
  const s = addLog(state, `激怒咒詛：備戰「竹蘭的」寶可夢傷害指示物合計 ${totalMarkers} 顆 → ${damage} 傷害（不計算弱點/抵抗力）`, aIdx);
  return { state: s, damage, skipWeakRes: true };
});

// ── 7. 力量蛋白飲（Item）— 本回合自己 [鬥] 寶可夢招式傷害 +30 ──────────────
regG('力量蛋白飲', () => true);
reg('力量蛋白飲', (st, idx) => {
  st = addLog(st, '力量蛋白飲：本回合自己的【鬥】寶可夢招式傷害 +30', idx);
  return updatePlayer(st, idx, p => ({
    ...p,
    damageBoostFightingThisTurn: (p.damageBoostFightingThisTurn ?? 0) + 30,
  }));
});

// ── 8. 戰鬥鑼（Item）— 搜 1 張 [鬥] 基礎寶可夢 或 基本【鬥】能量 ───────────
regG('戰鬥鑼', (st, idx, pool) => {
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Fighting') return true;
    if (card.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === 'Fighting') return true;
    return false;
  });
});
reg('戰鬥鑼', (st, idx) => {
  st = addLog(st, '戰鬥鑼：從牌庫選 1 張 [鬥] 基礎寶可夢 或 基本【鬥】能量加入手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'FightingBasicOrFightingEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'search-generic-to-hand',
  });
});

// ── 9. 寶可平板（Item）— 搜 1 張「非擁有規則」寶可夢 ─────────────────────
// 「擁有規則」= ex / VMAX / VSTAR / TAG TEAM 等。MVP 以 subtype==='ex' 或 name 尾 ex/EX 判定。
regG('寶可平板', (st, idx, pool) => {
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Pokemon') return false;
    const isRule = card.subtype === 'ex'
      || card.name.endsWith('ex') || card.name.endsWith('EX');
    return !isRule;
  });
});
reg('寶可平板', (st, idx) => {
  st = addLog(st, '寶可平板：從牌庫選 1 張「非擁有規則」寶可夢加入手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonNonRule',
    minCount: 0, maxCount: 1,
    effectKey: 'search-generic-to-hand',
  });
});

// ── 10. 竹蘭的力量負重（道具）— TOOL_HP_BONUS 提供 +70 HP；
//        attach resolver 由 TOOL_* 自動登記區塊統一註冊 toolAttachEffect。 ────────

// ── 11. 火箭隊的拉姆達（Supporter）— 搜 1 張訓練家卡加手牌 ────────────────
regG('火箭隊的拉姆達', (st, idx, pool) => {
  return st.players[idx].deck.some(c => pool.get(c.cardId)?.supertype === 'Trainer');
});
reg('火箭隊的拉姆達', (st, idx) => {
  st = addLog(st, '火箭隊的拉姆達：從牌庫選 1 張訓練家卡加入手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Trainer',
    minCount: 0, maxCount: 1,
    effectKey: 'search-generic-to-hand',
  });
});

// ── 12. 硬岩【鬥】能量 — 屬性：鬥（已由 engine SPECIAL_ENERGY_TYPES 處理） ──
// 補充：卡面另有「附著此能量的寶可夢不會受到對手寶可夢招式的效果的影響」，
// 這個 effect-immunity 子句目前暫未實裝，後續獨立一波處理（需在 ATTACK_POST / status / flag 套用前判斷）。

// 魔靈多龍牌組 Wave 43（黑夜魔靈 咒詛炸彈 / 多龍奇 / 願增猿 / 喵喵ex / 特殊紅牌 / 阿蜜的目光）
// — v2.65 搬到 effects/cards/maroon_dragon_deck.ts。side-effect import 見本檔頂部。
// BENCH_PLACE_TRIGGERS Map 實例亦一併搬到 _shared，本檔 re-export 給 engine.ts 使用。

// 白蕾雅：已搬遷到 ./effects/cards/white_lily_akamatsu.ts（v2.05）
// 莉莉艾的珍珠（Pokemon Tool）— v2.09 搬到 effects/cards/tools.ts
// Wave 44（胡地 + 瑪俐的長毛巨魔ex 兩組預組）— v2.64 搬到 effects/cards/abra_mawile_deck.ts

// ══════════════════════════════════════════════════════════════════════════════
// v2.22 新增：6 張卡
//   - 改造之錘（Item）—— 丟對手 1 隻寶可夢身上的 1 張特殊能量
//   - 小光（Supporter）—— 依序搜尋 1 基礎/1 一階進化/1 二階進化加手牌
//   - 鬥子（Supporter）—— 搜尋 1 進化寶可夢 + 1 能量加手牌
//   - 對戰圓形競技場（Stadium）—— 被動：備戰免於對手招式/特性放指示物（BENCH_PROTECTION_STADIUMS）
//   - 富裕能量（ACE SPEC Special Energy）—— 從手牌附加時抽 4
//   - 感應【超】能量（Special Energy）—— 附加到【超】寶可夢時搜尋至多 2 隻基礎【超】到備戰
// ══════════════════════════════════════════════════════════════════════════════

// ── 改造之錘（Item） ─────────────────────────────────────────────────────────
// 卡面：從對手任一隻寶可夢身上丟棄 1 張特殊能量。
// Guard：對手場上（含出場 + 備戰）至少 1 隻寶可夢附有特殊能量。
// UI：opp-poke-choose 並用 validIids 只顯示有特殊能量的寶可夢。
// Resolver：把該寶可夢身上「最後一張」特殊能量丟到對手棄牌區。
regG('改造之錘', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  return all.some(pk => pk.energyAttached.some(e => {
    const c = pool.get(e.cardId);
    return c?.supertype === 'Energy' && c.subtype === 'Special';
  }));
});
reg('改造之錘', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  const cand = all.filter(pk => pk.energyAttached.some(e => {
    const c = pool.get(e.cardId);
    return c?.supertype === 'Energy' && c.subtype === 'Special';
  }));
  if (cand.length === 0) return addLog(st, '改造之錘：對手場上沒有特殊能量', idx);
  const s = addLog(st, '改造之錘：選 1 隻對手附有特殊能量的寶可夢丟棄 1 張特殊能量', idx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'reform-hammer-discard',
    params: { includeActive: true, validIids: cand.map(c => c.iid) },
  });
});
regR('reform-hammer-discard', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const targetIid = iids[0];
  if (!targetIid) return st;
  const dp = st.players[dIdx];
  const target = dp.active?.iid === targetIid
    ? dp.active
    : dp.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  // 由後往前找第一張特殊能量
  let spIdx = -1;
  for (let i = target.energyAttached.length - 1; i >= 0; i--) {
    const c = pool.get(target.energyAttached[i].cardId);
    if (c?.supertype === 'Energy' && c.subtype === 'Special') { spIdx = i; break; }
  }
  if (spIdx < 0) {
    const tn = pool.get(target.cardId)?.name ?? '?';
    return addLog(st, `改造之錘：${tn} 身上沒有特殊能量`, idx);
  }
  const removed = target.energyAttached[spIdx];
  const energyName = pool.get(removed.cardId)?.name ?? '特殊能量';
  const targetName = pool.get(target.cardId)?.name ?? '?';
  const s = addLog(st, `改造之錘：丟棄 ${targetName} 身上的特殊能量（${energyName}）`, idx);
  return updatePlayer(s, dIdx, p => {
    const newEnergies = [
      ...target.energyAttached.slice(0, spIdx),
      ...target.energyAttached.slice(spIdx + 1),
    ];
    const updated = { ...target, energyAttached: newEnergies };
    return {
      ...p,
      active: p.active?.iid === targetIid ? updated : p.active,
      bench: p.bench.map(c => c.iid === targetIid ? updated : c),
      discard: [...p.discard, removed],
    };
  });
});

// ── 小光（Supporter） ───────────────────────────────────────────────────────
// 卡面：從你的牌庫搜尋 1 張基礎寶可夢、1 張進化一階寶可夢、1 張進化二階寶可夢，
//      展示給對手後加進手牌，並重洗牌庫。
// 實裝：三段鏈式 deck-search（Basic → Stage1 → Stage2），每段 minCount:0 maxCount:1
//      （牌庫找不到時玩家可以直接 Skip 進下一段）。最後階段結束才 shuffle。
regG('小光', (st, idx) => st.players[idx].deck.length > 0);
reg('小光', (st, idx) => {
  const s = addLog(st, '小光：依序搜尋 1 基礎/1 進化一階/1 進化二階寶可夢加手牌', idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'koharu-phase1',
  });
});
regR('koharu-phase1', (st, idx, iids, _params, pool) => {
  // 第 1 階段：Basic
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `小光（基礎）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '小光（基礎）：未選擇', idx);
  }
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stage1',
    minCount: 0, maxCount: 1,
    effectKey: 'koharu-phase2',
  });
});
regR('koharu-phase2', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `小光（進化一階）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '小光（進化一階）：未選擇', idx);
  }
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Stage2',
    minCount: 0, maxCount: 1,
    effectKey: 'koharu-phase3',
  });
});
regR('koharu-phase3', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `小光（進化二階）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '小光（進化二階）：未選擇', idx);
  }
  // 三階段結束後重洗牌庫
  return updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) }));
});

// ── 鬥子（Supporter） ───────────────────────────────────────────────────────
// 卡面：從你的牌庫搜尋 1 張進化寶可夢 + 1 張能量卡，展示後加進手牌並重洗牌庫。
regG('鬥子', (st, idx) => st.players[idx].deck.length > 0);
reg('鬥子', (st, idx) => {
  const s = addLog(st, '鬥子：搜尋 1 張進化寶可夢 + 1 張能量加手牌', idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Evolution',
    minCount: 0, maxCount: 1,
    effectKey: 'touko-phase1',
  });
});
regR('touko-phase1', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `鬥子（進化寶可夢）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '鬥子（進化寶可夢）：未選擇', idx);
  }
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy',
    minCount: 0, maxCount: 1,
    effectKey: 'touko-phase2',
  });
});
regR('touko-phase2', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `鬥子（能量）：${names} 加入手牌`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: [...p.hand, ...p.deck.filter(c => iids.includes(c.iid))],
      deck: p.deck.filter(c => !iids.includes(c.iid)),
    }));
  } else {
    st = addLog(st, '鬥子（能量）：未選擇', idx);
  }
  return updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) }));
});

// ── 對戰圓形競技場（Stadium） ─────────────────────────────────────────────────
// 純被動：雙方備戰寶可夢不會因對手的招式與特性被放置傷害指示物。
// 放置走 engine PLAY_TRAINER/Stadium 分支；無需 reg(TRAINER_EFFECTS)。
// 被動 gate 在 stadiums.ts 的 BENCH_PROTECTION_STADIUMS 集合，所有 bench-damage resolver
// 都已經在觸發點呼叫 isBenchProtected(state, pool) 跳過傷害放置。

// 富裕能量 / 感應【超】能量 hooks 已搬到 effects/cards/energy_cards.ts（v2.66）。

// ══════════════════════════════════════════════════════════════════════════════
// v2.35：火箭隊的超夢ex / 猛雷鼓ex 兩組預組新卡的 effects
//
// 範圍（Leon 卡表）：
//   【火箭隊的超夢】預組（14+3 張新卡）：
//     Special Energy  : 火箭隊能量
//     Supporter       : 火箭隊的雅典娜 / 蘭斯 / 坂木 / 阿波羅 / 拉姆達
//     Item            : 火箭隊的接收器
//     Stadium         : 火箭隊的工廠
//     Ability         : 操陷蛛｜充能（known gap，純說明 log）
//     Ability         : 急凍鳥｜抵抗之幕（known gap）
//     Ability         : 莉莉艾的皮皮ex｜妖精領域（known gap）
//     Ability         : 超夢ex｜力量抑制者（known gap）
//     Attack          : 超夢ex｜擦除球（base 160 + 丟能 gate stub，丟能在 ATTACK_PRE_DISCARD_CHOICE）
//     Attack          : 團珠蛛｜猛撞（已存在 v1.x，rename key 後仍保留）
//     Attack          : 操陷蛛｜火箭猛攻（30× 丟能，使用 registerFieldDiscardMultiply）
//     Attack          : 急凍鳥｜暗黑冰霜（60，對手有特殊能量 +30 stub）
//     Attack          : 謎擬Ｑ｜扮晶晶酒（v2.57 實裝：自動挑對手太晶最高傷害招式，不遞迴附加效果）
//   【猛雷鼓】預組（6 張新卡）：
//     Item            : 能量回收（擲幣：正 4 張，反 2 張基本能量棄牌→手牌）
//     Item            : 寶可裝置3.0（stub — 無實裝 Tool）
//     Item            : 太晶珠（Tool：太晶寶可夢 HP +30）
//     Item            : 捕蟲組合（top6 → 選最多 2 張草寶可夢/草能量加手牌）
//     Item            : 能量轉移（把 1 張基本能量從自己的寶可夢移到另一隻）
//     Ability         : 厄鬼椪 碧草面具ex｜碧綠之舞（1/回合 — 從手牌附加 1 張基本草能量到草寶可夢）
//
// 說明：
//   - 需要新 UI filter 的已在 +page.svelte / ai.ts 加過（RocketSupporter / RocketBasic /
//     AnyTrainer / GrassBasicOrGrassEnergy）。
//   - 「known gap」條目留 stub（打出時寫 log），未阻塞遊戲主流程。
//     完整實作待日後 session（attack-copy、pass-through ability 需要 engine 擴充）。
// ══════════════════════════════════════════════════════════════════════════════

// 火箭隊能量 hook 已搬到 effects/cards/energy_cards.ts（v2.66）。

// ---- 火箭隊的接收器（Item）- 搜「火箭隊」Supporter 加手牌 ------------------
regG('火箭隊的接收器', (st, idx, pool) =>
  st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Trainer' && card.subtype === 'Supporter'
      && card.name.includes('火箭隊');
  })
);
reg('火箭隊的接收器', (st, idx) => {
  st = addLog(st, '火箭隊的接收器：從牌庫選 1 張「火箭隊」支援者加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'RocketSupporter',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',   // 復用（與 Pokemon 搜尋同機制：加手牌+洗牌）
  });
});

// ---- 火箭隊的雅典娜（Supporter）- 抽到 5（若全場都是火箭隊則抽到 8）----------
reg('火箭隊的雅典娜', (st, idx, pool) => {
  const p = st.players[idx];
  const field = [...(p.active ? [p.active] : []), ...p.bench];
  const allRocket = field.length > 0 && field.every(c => (pool.get(c.cardId)?.name ?? '').includes('火箭隊的'));
  const target = allRocket ? 8 : 5;
  const toDraw = Math.max(0, target - p.hand.length);
  st = addLog(st, `火箭隊的雅典娜：抽到手牌滿 ${target} 張（抽 ${toDraw} 張${allRocket ? '（全場皆為火箭隊寶可夢）' : ''}）`, idx);
  return drawCards(st, idx, toDraw);
});

// ---- 火箭隊的蘭斯（Supporter）- 搜最多 3 張基礎火箭隊寶可夢 ------------------
//   備註：卡面「先攻玩家的最初回合也可使用」— engine 的 isFirstTurn supporter gate
//   會呼叫 canPlaySupporterOnFirstTurn(card) 檢查 rulesText 是否包含
//   「先攻玩家的最初回合」，命中就 bypass。v2.69 起改成由 engine 統一處理，
//   所以這裡不需要對這張卡做任何特例。
regG('火箭隊的蘭斯', (st, idx, pool) =>
  st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon'
      && !card.evolvesFrom && card.name.includes('火箭隊的');
  })
);
reg('火箭隊的蘭斯', (st, idx) => {
  st = addLog(st, '火箭隊的蘭斯：從牌庫選最多 3 張基礎的「火箭隊」寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'RocketBasic',
    minCount: 0, maxCount: 3,
    effectKey: 'search-pokemon-to-hand',
  });
});

// ---- 火箭隊的坂木（Supporter）- 本方自換 + 對方被迫換 -----------------------
// 卡面：將自己的戰鬥場的「火箭隊的寶可夢」與備戰區的「火箭隊的寶可夢」互換。
//       然後，選 1 隻對手備戰寶可夢與對手戰鬥寶可夢互換。
// 實裝：
//   - 若戰鬥位與備戰皆有至少 1 隻火箭隊的寶可夢 → 進入 bench-choose（自方火箭隊備戰）
//     self-swap-rocket resolver 執行後接 opp-bench-choose → gust-opp。
//   - 若條件不齊（如戰鬥位非火箭隊 / 備戰沒有火箭隊）→ 跳過自換步驟直接進對方換。
regG('火箭隊的坂木', (st, idx) => {
  const opp = st.players[(1 - idx) as 0 | 1];
  return opp.bench.length > 0;  // 至少需要對手有備戰
});
reg('火箭隊的坂木', (st, idx, pool) => {
  const p = st.players[idx];
  const activeIsRocket = p.active && (pool.get(p.active.cardId)?.name ?? '').includes('火箭隊的');
  const rocketBench = p.bench.filter(c => (pool.get(c.cardId)?.name ?? '').includes('火箭隊的'));
  st = addLog(st, '火箭隊的坂木：自己戰鬥↔備戰互換火箭隊寶可夢，然後對手備戰↔戰鬥互換', idx);
  if (activeIsRocket && rocketBench.length > 0) {
    // 先自換：選 1 隻備戰火箭隊寶可夢
    return withPending(st, {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'sakaki-self-swap',
      params: { validIids: rocketBench.map(c => c.iid) },
    });
  }
  // 條件不符：直接對方換
  st = addLog(st, '火箭隊的坂木：自方無可互換的火箭隊寶可夢，略過自換', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: (1 - idx) as 0 | 1,
    minCount: 1, maxCount: 1,
    effectKey: 'gust-opp',   // 復用既有 opp-swap resolver
  });
});
regR('sakaki-self-swap', (st, idx, iids, _params, pool) => {
  const pickIid = iids[0];
  if (!pickIid) return st;
  const p = st.players[idx];
  const benchPick = p.bench.find(c => c.iid === pickIid);
  if (!p.active || !benchPick) return st;
  const aName = pool.get(p.active.cardId)?.name ?? '?';
  const bName = pool.get(benchPick.cardId)?.name ?? '?';
  st = addLog(st, `火箭隊的坂木：${aName}（戰鬥）↔ ${bName}（備戰）互換`, idx);
  st = updatePlayer(st, idx, pl => {
    if (!pl.active) return pl;
    const newActive = benchPick;
    // v2.49：離開戰鬥場清狀態旗標（修 sakaki-self-swap 的 bench status leak）
    const cleared = clearActiveEffects(pl.active);
    const newBench = pl.bench.map(c => c.iid === pickIid ? cleared : c);
    return { ...pl, active: newActive, bench: newBench };
  });
  // 再強迫對方換
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: (1 - idx) as 0 | 1,
    minCount: 1, maxCount: 1,
    effectKey: 'gust-opp',
  });
});

// ---- 火箭隊的阿波羅（Supporter）- 上回合火箭隊寶可夢 KO'd 才可用 ------------
// 卡面：這張卡必須在上個對手的回合自己的「火箭隊的寶可夢」【昏厥】了才可使用。
//       雙方手牌放回牌庫重洗。然後抽牌：自己 5 張，對手 3 張。
// v2.70 gate：套用與「不公印章」相同的快照對比手法，但比的是
//   「自己棄牌堆中火箭隊寶可夢數量」而不是「對手獎賞張數」。
//   engine END_TURN 時分別快照：
//     rocketInMyDiscardAtMyLastTurnEnd[aIdx] = 剛結束回合方的棄牌堆中火箭隊寶可夢數
//     rocketInMyDiscardAtMyTurnStart[nextIdx] = 即將開始回合方的棄牌堆中火箭隊寶可夢數
//   gate：turnStart > lastEnd → 對手上個回合我方有火箭隊寶可夢被擊倒（棄牌堆變多）。
//   這樣能避開「自己回合內自 KO」誤觸發（turnStart 已鎖定，自 KO 只影響當下數而不影響快照）。
regG('火箭隊的阿波羅', (st, idx) => {
  const lastEnd = st.rocketInMyDiscardAtMyLastTurnEnd?.[idx] ?? 0;
  const turnStart = st.rocketInMyDiscardAtMyTurnStart?.[idx] ?? 0;
  return turnStart > lastEnd;
});
reg('火箭隊的阿波羅', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '火箭隊的阿波羅：雙方手牌洗回牌庫，自己抽 5 / 對手抽 3', idx);
  // 雙方手牌放回牌庫並重洗
  st = returnHandToDeck(st, idx);
  st = returnHandToDeck(st, oppIdx);
  st = drawCards(st, idx, 5);
  st = drawCards(st, oppIdx, 3);
  return st;
});

// ---- 火箭隊的拉姆達（Supporter）- 搜任意 1 張訓練家加手牌 -------------------
regG('火箭隊的拉姆達', (st, idx, pool) =>
  st.players[idx].deck.some(c => pool.get(c.cardId)?.supertype === 'Trainer')
);
reg('火箭隊的拉姆達', (st, idx) => {
  st = addLog(st, '火箭隊的拉姆達：從牌庫選 1 張訓練家卡加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'AnyTrainer',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',   // resolver 為「加手牌 + 洗牌」，對訓練家同樣適用
  });
});

// ---- 火箭隊的工廠（Stadium）- known gap stub --------------------------------
// 卡面：在這個回合從手牌使出了名稱中有「火箭隊」的支援者卡的玩家，可從自己的牌庫抽出 2 張卡。
// 實裝狀態：未實裝。需要在 engine USE_STADIUM 加分支 + per-player `rocketSupporterPlayedThisTurn`
//   旗標、在 PLAY_TRAINER Supporter 路徑設旗標、END_TURN 清旗標。
// 目前以 stadium「不觸發」通過：Leon 可手動放置／被動佔位（擠掉對方其他場地卡）。

// ---- 碧草面具ex｜碧綠之舞（Ability）- 1/回合 附加基本草能量到自身 + 抽 1 ----
// 卡面原文：「從自己的手牌選擇1張『基本【草】能量』卡，附於這隻寶可夢身上。
//            然後，從自己的牌庫抽出1張卡。」
// 關鍵字「這隻寶可夢」＝發動特性的厄鬼椪 碧草面具ex 自身（非任意【草】寶可夢）。
// v2.53：先加 getUsableAbilities gate（手牌無基本草能量時不顯示特性按鈕）。
// v2.54：修正效果 — 自動附加到觸發源（無選擇 UI），再抽 1 張。
// v2.61：engine 會以第 4 參數 cardInst 傳入觸發源。舊實作在同回合兩隻同名
//   碧草面具ex 先後發動時，find(abilityUsedThisTurn===true) 會命中第一隻，
//   導致 B 發動卻附到 A。改用 cardInst.iid 精確定位，保留 name 掃場作為 fallback。
regA('厄鬼椪 碧草面具ex', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  // 找觸發源（發動特性的寶可夢）— 以 iid 為準
  const allPokes: CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  const src = cardInst
    ? allPokes.find(c => c.iid === cardInst.iid)
    : allPokes.find(c => {
        const card = pool.get(c.cardId);
        return card?.name === '厄鬼椪 碧草面具ex' && c.abilityUsedThisTurn === true;
      });
  if (!src) return st;
  // 手牌需有基本草能量
  const grassEnergyInst = p.hand.find(c => {
    const card = pool.get(c.cardId);
    if (card?.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
    return card.pokemonType === 'Grass' || card.name.includes('【草】');
  });
  if (!grassEnergyInst) return addLog(st, '碧綠之舞：手牌中沒有基本草能量', idx);
  const eName = pool.get(grassEnergyInst.cardId)?.name ?? '基本草能量';
  const sName = pool.get(src.cardId)?.name ?? '厄鬼椪 碧草面具ex';
  // 步驟 1：把能量從手牌直接附到自己身上（無需選擇 UI）
  st = addLog(st, `碧綠之舞：將 ${eName} 附加到 ${sName}`, idx);
  st = updatePlayer(st, idx, pl => {
    const newHand = pl.hand.filter(c => c.iid !== grassEnergyInst.iid);
    const attach = (c: CardInstance): CardInstance =>
      c.iid === src.iid ? { ...c, energyAttached: [...c.energyAttached, grassEnergyInst] } : c;
    return {
      ...pl,
      hand: newHand,
      active: pl.active ? attach(pl.active) : null,
      bench: pl.bench.map(attach),
    };
  });
  // 步驟 2：抽 1 張
  st = addLog(st, '碧綠之舞：從牌庫抽 1 張', idx);
  return drawCards(st, idx, 1);
});

// ---- 操陷蛛｜火箭猛攻 attack（30× 棄能） ----------------------------------
// 從自己的場上選擇任意張基本能量丟棄，傷害 = 30 × 丟棄張數。
registerFieldDiscardMultiply('火箭隊的操陷蛛|火箭猛攻', '火箭猛攻', 0, 30, 20, 'basic');

// ---- 超夢ex｜擦除球 attack（160 + 丟備戰能 ×60） --------------------------
// 卡面原文：160 — 若希望，將最多 2 張自己的備戰寶可夢身上附加的能量卡丟棄，
//            增加其張數×60 點傷害。
// v2.35 stub 對卡面誤解成「丟自己（戰鬥場）的超能量」。v2.57 修：
//   scope='own-bench'（只能丟備戰），min=0 max=2，每張 +60（base 160→最高 280）。
ATTACK_PRE_DISCARD_CHOICE.set('火箭隊的超夢ex|擦除球', {
  min: 0, max: 2, scope: 'own-bench', baseDamage: 160, damagePerEnergy: 60,
});
regPre('火箭隊的超夢ex|擦除球', (state, aIdx, _pool, action) => {
  const player = state.players[aIdx];
  // 只列備戰寶可夢身上的能量
  type Loc = { benchIdx: number; energy: CardInstance };
  const eligible: Loc[] = [];
  player.bench.forEach((b, i) => {
    for (const e of b.energyAttached) eligible.push({ benchIdx: i, energy: e });
  });

  const chosenIids = action?.discardedEnergyIids;
  let selected: Loc[];
  if (chosenIids && chosenIids.length > 0) {
    const idSet = new Set(chosenIids);
    selected = eligible.filter(l => idSet.has(l.energy.iid)).slice(0, 2);
  } else {
    // AI fallback：不丟能（保守，基礎 160 即可）
    selected = [];
  }
  if (selected.length === 0) {
    return { state: addLog(state, '擦除球：未丟棄備戰能量 → 160', aIdx), damage: 160 };
  }

  const benchRm = new Map<number, Set<string>>();
  for (const s of selected) {
    const st = benchRm.get(s.benchIdx) ?? new Set<string>();
    st.add(s.energy.iid);
    benchRm.set(s.benchIdx, st);
  }
  const discardList = selected.map(s => s.energy);
  let s2 = updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map((b, i) => {
      const rm = benchRm.get(i);
      if (!rm || rm.size === 0) return b;
      return { ...b, energyAttached: b.energyAttached.filter(e => !rm.has(e.iid)) };
    }),
    discard: [...p.discard, ...discardList],
  }));
  const dmg = 160 + 60 * selected.length;
  s2 = addLog(s2, `擦除球：丟棄 ${selected.length} 個備戰能量 → ${dmg}`, aIdx);
  return { state: s2, damage: dmg };
});

// ---- 火箭隊的急凍鳥｜暗黑冰霜 ------------------------------------------------
// 卡面原文：60 — 若這隻寶可夢身上附有「火箭隊能量」，則增加 60 點傷害。
// v2.35 的 stub 註解把條件寫成「對手有特殊能量 +30」— 是錯的。
// v2.57 修正：條件是【攻擊者自身附有 "火箭隊能量" 特殊能量】，加成是 +60（60→120）。
regPre('火箭隊的急凍鳥|暗黑冰霜', (state, aIdx, pool) => {
  const atk = state.players[aIdx].active;
  let base = 60;
  if (atk) {
    const hasRocketEnergy = atk.energyAttached.some(e => {
      const card = pool.get(e.cardId);
      return card?.supertype === 'Energy' && card.name === '火箭隊能量';
    });
    if (hasRocketEnergy) base += 60;
  }
  return { state, damage: base };
});

// ---- v2.57：火箭隊的超夢 預組 特性實裝 --------------------------------------
// 操陷蛛｜充能（主動）：1 回合 1 次，從棄牌區選 1 張基本能量附於此寶可夢。
// 實裝方式：regA → discard-search filter=BasicEnergy → 自訂 resolver 附於觸發源。
regA('火箭隊的操陷蛛', 0, (st, idx, pool) => {
  const userIid = findAbilityUserIid(st, idx, '火箭隊的操陷蛛', pool);
  if (!userIid) return st;
  const p = st.players[idx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (cand.length === 0) return addLog(st, '充能：棄牌區沒有基本能量', idx);
  st = addLog(st, '充能：從棄牌區選 1 張基本能量附於此寶可夢', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 1, maxCount: 1,
    effectKey: 'rocket-ariados-attach-self',
    params: { userIid, label: '充能' },
  });
});

regR('rocket-ariados-attach-self', (st, idx, iids, params, pool) => {
  const userIid = params?.userIid as string | undefined;
  const label = (params?.label as string) ?? '充能';
  if (!userIid) return st;
  const p = st.players[idx];
  const energies = p.discard.filter(c => iids.includes(c.iid));
  if (energies.length === 0) return st;
  const target = p.active?.iid === userIid ? p.active : p.bench.find(c => c.iid === userIid);
  if (!target) return st;
  const tname = pool.get(target.cardId)?.name ?? '?';
  const eName = pool.get(energies[0].cardId)?.name ?? '能量';
  const s = addLog(st, `${label}：將 ${eName} 附加到 ${tname}`, idx);
  return updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => !iids.includes(c.iid));
    if (pl.active && pl.active.iid === userIid) {
      return { ...pl, discard: rest,
        active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] } };
    }
    return { ...pl, discard: rest,
      bench: pl.bench.map(c => c.iid === userIid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] } : c) };
  });
});

// ---- 火箭隊的謎擬Ｑ｜扮晶晶酒（copy-attack, v2.57／v2.70） -----------------
// 卡面原文：選擇1個對手的戰鬥場的「太晶」寶可夢持有的招式，作為這個招式使用。
//
// 實裝策略（v2.57 務實版）：
//   AttackPreFn 是同步的，無法在攻擊中途彈 UI 讓玩家挑招式。
//   因此採「自動挑選」路線 — 只考慮對手戰鬥場，若為太晶寶可夢：
//     (1) 挑「印刷傷害最高」的招式（解析前導整數；全 0 則退回第一招）。
//     (2) 非太晶 / 無戰鬥場 → log 並回傳 damage=0。
//
// v2.70 修正（Leon 回報）：萬葉陣雨（= 基礎 30 + 雙方出場能量 × 30）用扮晶晶酒
//   複製只出 30 點傷害，因為舊版只解析「印刷的前導整數」。這版改成：
//   1) 遞迴呼叫被複製招式的 ATTACK_PRE，取回正確 damage + skipWeakRes / skipDefEffects。
//   2) 將被複製的 effectKey 存到 state.pendingCopyAttackKey，好讓下面的 regPost 能
//      轉接呼叫被複製招式的 ATTACK_POST（處理 pendingSelection 類附加效果）。
//   3) 若被複製招式沒有註冊 PRE，維持 v2.57 路徑（解析印刷傷害）。
//   引擎仍會自己走弱點／抵抗／道具 +N 那段流程；這裡只接 PRE/POST 附加效果層。
regPre('火箭隊的謎擬Ｑ|扮晶晶酒', (state, aIdx, pool, action) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppActive = state.players[dIdx].active;
  if (!oppActive) {
    return { state: addLog(state, '扮晶晶酒：對手沒有戰鬥寶可夢', aIdx), damage: 0 };
  }
  const oppCard = pool.get(oppActive.cardId);
  if (!oppCard || !oppCard.tags?.includes('太晶')) {
    const oname = oppCard?.name ?? '?';
    return { state: addLog(state, `扮晶晶酒：${oname} 不是「太晶」寶可夢，無法扮演`, aIdx), damage: 0 };
  }
  const atks = oppCard.attacks ?? [];
  if (atks.length === 0) {
    return { state: addLog(state, `扮晶晶酒：${oppCard.name} 沒有可以扮演的招式`, aIdx), damage: 0 };
  }
  // 解析每招印刷傷害的前導整數（空字串 / 全非數字 → 0）
  const parseDmg = (s: string): number => {
    const m = s.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  // 挑「印刷傷害最高」那招；全為 0 則退回第一招
  let picked = atks[0];
  let pickedDmg = parseDmg(picked.damage);
  for (let i = 1; i < atks.length; i++) {
    const d = parseDmg(atks[i].damage);
    if (d > pickedDmg) {
      picked = atks[i];
      pickedDmg = d;
    }
  }
  // 被複製招式的 effectKey（與 engine.ts 的 effectKey 組法一致）
  const copiedKey = `${oppCard.name}|${picked.name}`;
  let s = addLog(state, `扮晶晶酒：扮演 ${oppCard.name} 的「${picked.name}」`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };

  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    // 遞迴呼叫被複製招式 PRE — 傷害以 PRE 回傳為準（涵蓋 ×能量 / +條件 等動態計算）。
    // 傳 action，好讓某些 PRE 使用 action.targetIid 等資訊（即使 UI 本身不會開新選單）。
    const sub = copiedPre(s, aIdx, pool, action);
    return {
      state: sub.state,
      damage: sub.damage,
      skipWeakRes: sub.skipWeakRes,
      skipDefEffects: sub.skipDefEffects,
    };
  }
  // 被複製招式沒有註冊 PRE → 走 v2.57 舊路徑：解析印刷傷害
  return { state: s, damage: pickedDmg };
});

// POST 轉接：engine 走完傷害施加後，查本招式的 POST → 這邊將 state.pendingCopyAttackKey
// 轉去呼叫被複製招式的 POST（例如 pendingSelection 類附加效果），完成後清除旗標。
regPost('火箭隊的謎擬Ｑ|扮晶晶酒', (state, aIdx, pool) => {
  const key = state.pendingCopyAttackKey;
  const cleared: GameState = { ...state, pendingCopyAttackKey: undefined };
  if (!key) return cleared;
  const copiedPost = ATTACK_POST.get(key);
  if (!copiedPost) return cleared;
  return copiedPost(cleared, aIdx, pool);
});

// ---- Known gap 特性 stubs（log only）--------------------------------------
// 這些特性需要引擎擴充才能完整實裝。目前寫成說明 log，避免預組無法放入編輯器。
// v2.57 進度：操陷蛛 充能 / 急凍鳥 抵抗之幕 / 皮皮ex 妖精領域 / 超夢ex 力量抑制者 → 全部已實裝。
// 力量抑制者為 engine 層 gate（見 engine.ts 的 ATTACK handler + getAvailableAttacks），不在此處 regA。
// 扮晶晶酒為務實 copy-attack（自動挑對手太晶最高傷害招式，不遞迴附加效果）。

// ══════════════════════════════════════════════════════════════════════════════
// 猛雷鼓預組：新物品卡
// ══════════════════════════════════════════════════════════════════════════════

// ---- 能量回收（Item）- 棄牌區選最多 2 張基本能量 → 給對手看 → 加手牌 -------------
// 卡面（MC/SV11W/SVQL 同）：「從自己的棄牌區選擇最多2張基本能量卡，在給對手看過後加入手牌。」
// v2.60 修正：原本錯誤沿用上古版（擲幣：正 4/反 2），實際新版 I/J regulation 已不擲幣。
// 「給對手看」語意在本模擬器中為隱含 — 棄牌區對雙方公開、picker UI 選擇也會留 log。
regG('能量回收', (st, idx, pool) =>
  st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  })
);
reg('能量回收', (st, idx) => {
  st = addLog(st, '能量回收：從棄牌區選最多 2 張基本能量加入手牌（給對手看）', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',  // 只基本能量（v2.40 根源 bug 修正後；不含 Special Energy）
    minCount: 0, maxCount: 2,
    effectKey: 'discard-to-hand',
  });
});

// ---- 寶可裝置3.0（Item）- 查看牌庫頂 7，選 1 張支援者加手牌 ------------------
// v2.56 修正：原 stub 註解誤寫成「附加到自己的寶可夢類 Tool」— 實際卡面是 Item：
//   「查看自己的牌庫上方7張卡，從其中選擇1張支援者卡，在給對手看過後加入手牌。
//    將剩餘卡放回牌庫並重洗。」
// 機制與 米立龍｜集客 幾乎一樣，只是 top 6 → top 7。
regG('寶可裝置3.0', (st, idx) => st.players[idx].deck.length > 0);
reg('寶可裝置3.0', (st, idx) => {
  const p = st.players[idx];
  const top7 = p.deck.slice(0, 7);
  if (top7.length === 0) return addLog(st, '寶可裝置3.0：牌庫為空', idx);
  st = addLog(st, '寶可裝置3.0：查看牌庫頂 7 張，選 1 張支援者加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter:TOP7',
    minCount: 0, maxCount: 1,
    effectKey: 'pokegear-fetch-supporter',
    params: { top7Iids: top7.map(c => c.iid) },
  });
});
regR('pokegear-fetch-supporter', (st, idx, iids, params, _pool) => {
  const top7Iids = (params?.top7Iids as string[]) ?? [];
  return updatePlayer(st, idx, (p) => {
    const top7 = p.deck.filter(c => top7Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top7Iids.includes(c.iid));
    const chosen = top7.filter(c => iids.includes(c.iid));
    const remaining = top7.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck: shuffle([...rest, ...remaining]),
      hand: [...p.hand, ...chosen],
    };
  });
});

// ---- 太晶珠（Item）- 從牌庫搜 1 張「太晶」寶可夢加手牌 -----------------------
// v2.52：修正 — 太晶珠是 **Item**（搜尋牌庫），不是 Tool（HP +30）。
// 之前 v2.48 誤把它登錄成 TOOL_HP_BONUS，實際卡面文字：
//   「從自己的牌庫選擇1張『太晶』寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。」
// = 典型 deck-search → search-pokemon-to-hand 流程（filter: TeraPokemon）。
regG('太晶珠', (st, idx, pool) =>
  st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && !!card.tags?.includes('太晶');
  })
);
reg('太晶珠', (st, idx) => {
  st = addLog(st, '太晶珠：從牌庫選 1 張「太晶」寶可夢卡加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TeraPokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// ---- 捕蟲組合（Item）- 查看牌庫頂 7，選最多 2 張草寶可夢/草能量加手牌 -------
// v2.54 修正：卡面明寫「上方 7 張」（原實裝為 top 6 — 錯誤）。
// v2.55 修正：filter 改用 ':TOP7' 後綴把範圍限定在前 7 張 — v2.54 只改了數字但沒
// 改 filter，UI selectionItems 走 default 分支還是檢索整個牌庫。
// 機制類似 米立龍｜集客（Supporter:TOP6）：peek top N → pick up to 2 → 剩下回底重洗。
regG('捕蟲組合', (st, idx) => st.players[idx].deck.length > 0);
reg('捕蟲組合', (st, idx) => {
  const p = st.players[idx];
  const top7 = p.deck.slice(0, 7);
  if (top7.length === 0) return addLog(st, '捕蟲組合：牌庫為空', idx);
  st = addLog(st, '捕蟲組合：查看牌庫頂 7 張，選最多 2 張基本草寶可夢或基本草能量加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'GrassBasicOrGrassEnergy:TOP7',
    minCount: 0, maxCount: 2,
    effectKey: 'bug-catcher-set',
    params: { top7Iids: top7.map(c => c.iid) },
  });
});
regR('bug-catcher-set', (st, idx, iids, params, pool) => {
  const top7Iids = new Set<string>((params?.top7Iids as string[]) ?? []);
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid) && top7Iids.has(c.iid));
  const chosenIids = new Set(chosen.map(c => c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `捕蟲組合：${names} 加入手牌，其餘放回牌庫底（重洗）`, idx);
  } else {
    st = addLog(st, '捕蟲組合：未選擇任何卡，全部放回牌庫底（重洗）', idx);
  }
  return updatePlayer(st, idx, p => ({
    ...p,
    hand: [...p.hand, ...chosen],
    deck: shuffle(p.deck.filter(c => !chosenIids.has(c.iid))),
  }));
});

// ---- 能量轉移（Item）- 把 1 張基本能量從自己的寶可夢移到另一隻 -------------
// 2 步：先選來源（自己寶可夢身上有基本能量者），再選其身上的基本能量，再選目的地寶可夢。
// 為降低 UI 複雜度，此版簡化為：選來源寶可夢，自動挑第 1 張基本能量；然後選目的地。
regG('能量轉移', (st, idx, pool) => {
  const p = st.players[idx];
  const allField = [...(p.active ? [p.active] : []), ...p.bench];
  if (allField.length < 2) return false;  // 至少 2 隻才有「轉移」空間
  return allField.some(poke => poke.energyAttached.some(e => {
    const card = pool.get(e.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }));
});
reg('能量轉移', (st, idx, pool) => {
  const p = st.players[idx];
  const allField = [...(p.active ? [p.active] : []), ...p.bench];
  const sources = allField.filter(poke => poke.energyAttached.some(e => {
    const card = pool.get(e.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }));
  if (sources.length === 0) return addLog(st, '能量轉移：沒有寶可夢身上有基本能量', idx);
  st = addLog(st, '能量轉移：選擇「移出」基本能量的來源寶可夢', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'energy-switch-src',
    params: {
      validIids: sources.map(c => c.iid),
      titleOverride: '能量轉移：選擇要移出基本能量的寶可夢',
    },
  });
});
regR('energy-switch-src', (st, idx, iids, _params, pool) => {
  const srcIid = iids[0];
  if (!srcIid) return st;
  const p = st.players[idx];
  const srcPoke = p.active?.iid === srcIid ? p.active : p.bench.find(c => c.iid === srcIid);
  if (!srcPoke) return st;
  // 取第 1 張基本能量作為移動對象
  const energyInst = srcPoke.energyAttached.find(e => {
    const card = pool.get(e.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  if (!energyInst) return st;
  const srcName = pool.get(srcPoke.cardId)?.name ?? '?';
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  // 從來源移除 energyInst
  st = updatePlayer(st, idx, pl => {
    const remove = (c: CardInstance) => ({
      ...c, energyAttached: c.energyAttached.filter(e => e.iid !== energyInst.iid)
    });
    let active = pl.active;
    if (active?.iid === srcIid) active = remove(active);
    const bench = pl.bench.map(c => c.iid === srcIid ? remove(c) : c);
    return { ...pl, active, bench };
  });
  st = addLog(st, `能量轉移：從 ${srcName} 取下 ${eName}，選擇目的地寶可夢`, idx);
  // 選目的地（所有自己的寶可夢，排除來源）
  const pp = st.players[idx];
  const allTargets = [...(pp.active ? [pp.active] : []), ...pp.bench]
    .filter(c => c.iid !== srcIid);
  if (allTargets.length === 0) {
    // Fallback：沒別的寶可夢，能量回 hand（維持不空轉）
    st = addLog(st, '能量轉移：沒有其他寶可夢，能量移回手牌', idx);
    return updatePlayer(st, idx, pl => ({ ...pl, hand: [...pl.hand, energyInst] }));
  }
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'energy-switch-dst',
    params: {
      energyInstance: energyInst,
      validIids: allTargets.map(c => c.iid),
      titleOverride: `能量轉移：選擇附加 ${eName} 的目的地寶可夢`,
    },
  });
});
regR('energy-switch-dst', (st, idx, iids, params, pool) => {
  const dstIid = iids[0];
  const energyInst = params?.energyInstance as CardInstance | undefined;
  if (!dstIid || !energyInst) return st;
  const p = st.players[idx];
  const dstPoke = p.active?.iid === dstIid ? p.active : p.bench.find(c => c.iid === dstIid);
  if (!dstPoke) return st;
  const dstName = pool.get(dstPoke.cardId)?.name ?? '?';
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  st = addLog(st, `能量轉移：將 ${eName} 附加到 ${dstName}`, idx);
  return updatePlayer(st, idx, pl => {
    const attach = (c: CardInstance) => ({ ...c, energyAttached: [...c.energyAttached, energyInst] });
    let active = pl.active;
    if (active?.iid === dstIid) active = attach(active);
    const bench = pl.bench.map(c => c.iid === dstIid ? attach(c) : c);
    return { ...pl, active, bench };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// v2.127 — preset 牌組未實裝招式/特性補完（Leon 要求全部實裝）
// 9 張卡：甲賀忍蛙ex MC｜變幻手裏劍 / SV5a｜忍之利刃 + 分身連打、月月熊 赫月｜經驗法則
//   菊草葉｜叫聲、呱頭蛙｜招集之術、巨金怪｜彈回 + 金屬之錘、酋雷姆｜反等離子
// ══════════════════════════════════════════════════════════════════════════════

// ── 1) 甲賀忍蛙ex (MC 208/742)｜變幻手裏劍 100+ — 擲幣正面 +100
regPre('甲賀忍蛙ex|變幻手裏劍', coinPlusDmg(100, 100));

// ── 2) 甲賀忍蛙ex (SV5a)｜忍之利刃 170 — 若希望，從牌庫任選 1 張卡加手牌（重洗）
regPre('甲賀忍蛙ex|忍之利刃', (state, _aIdx, _pool) => ({ state, damage: 170 }));
regPost('甲賀忍蛙ex|忍之利刃', (state, aIdx, pool) => {
  if (state.players[aIdx].deck.length === 0) {
    return addLog(state, '忍之利刃：牌庫已空，跳過搜尋', aIdx);
  }
  const s = addLog(state, '忍之利刃：從牌庫任選 0~1 張卡加手牌（之後重洗）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'any',
    minCount: 0, maxCount: 1,
    effectKey: 'greninja-ninja-blade-search',
  });
});
regR('greninja-ninja-blade-search', (state, aIdx, selectedIids, _params, pool) => {
  const picks = state.players[aIdx].deck.filter(c => selectedIids.includes(c.iid));
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    deck: shuffle(p.deck.filter(c => !selectedIids.includes(c.iid))),
    hand: [...p.hand, ...picks],
  }));
  if (picks.length > 0) {
    const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.130：自牌庫搜尋具體卡名僅給自己看；對手看脫敏版
    s = addPrivateLog(s,
      `忍之利刃：搜到 ${names} 加入手牌，重洗牌庫`,
      `忍之利刃：搜到 ${picks.length} 張卡加入手牌，重洗牌庫`,
      aIdx);
  } else {
    s = addLog(s, '忍之利刃：未選卡，重洗牌庫', aIdx);
  }
  return s;
});

// ── 3) 甲賀忍蛙ex (SV5a)｜分身連打 — 棄 2 個能量 → 對手 2 隻寶可夢各 120 傷
//   卡面：「對手的 2 隻寶可夢各受到 120 點傷害。[在備戰區不計算弱點・抵抗力。]」
//   ＝ 戰鬥場那隻仍計算弱抗；備戰位才不計。
//   v2.129：能量丟棄改用 'units' — 1 張燃火能量（附於進化）= 3 個無能量單位 → 1 張就達標。
ATTACK_PRE_DISCARD_CHOICE.set('甲賀忍蛙ex|分身連打', {
  min: 2, max: null, scope: 'attacker', baseDamage: 0, damagePerEnergy: 0,
  countMode: 'units',
});
regPre('甲賀忍蛙ex|分身連打', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('甲賀忍蛙ex|分身連打', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  const all = [...(d.active ? [d.active] : []), ...d.bench];
  if (all.length === 0) {
    return addLog(state, '分身連打：對手場上無寶可夢', aIdx);
  }
  const maxN = Math.min(2, all.length);
  const s = addLog(state, `分身連打：選對手 ${maxN} 隻寶可夢，各 120 點傷害（戰鬥場計算弱抗、備戰位不計）`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: maxN, maxCount: maxN,
    effectKey: 'clone-strike-multi-hit',
    params: { dmg: 120, label: '分身連打' },
  });
});
// v2.129：通用「對所選任一寶可夢造成 dmg；戰鬥場套弱抗、備戰不計」resolver。
//   完整 KO 流程（取獎、棄牌、game-over check）。
//   也可給未來其他「對 N 隻寶可夢各造成傷害（在備戰區不計算弱抗）」的招式重用。
regR('clone-strike-multi-hit', (st, actorIdx, selectedIids, params, pool) => {
  const baseDmg = (params?.dmg as number) ?? 0;
  const label = (params?.label as string) ?? '招式';
  if (baseDmg <= 0 || selectedIids.length === 0) return st;
  let s = st;
  const attacker = st.players[actorIdx].active;
  const attackerCard = attacker ? pool.get(attacker.cardId) : null;
  for (const iid of selectedIids) {
    const dIdx = (1 - actorIdx) as 0 | 1;
    const defender = s.players[dIdx];
    const isActive = defender.active?.iid === iid;
    const target = isActive ? defender.active! : defender.bench.find(c => c.iid === iid);
    if (!target) continue;
    const targetCard = pool.get(target.cardId);
    // 備戰區守護：對戰圓形 / 花之帷幔 等
    if (!isActive) {
      const g = resolveBenchGuard(s, pool, actorIdx, targetCard, 'attack-damage');
      if (g.blocked) {
        s = addLog(s, `${label}：${targetCard?.name ?? '?'} 因${g.reason}不受傷害`, actorIdx);
        continue;
      }
    }
    // 戰鬥場：套用弱點 ×2；備戰位：不計弱抗（卡面明示）
    let dmg = baseDmg;
    if (isActive
        && attackerCard?.pokemonType
        && targetCard?.weakness?.type
        && attackerCard.pokemonType === targetCard.weakness.type) {
      dmg *= 2;
    }
    const newDmg = target.damage + dmg;
    const hp = effectiveHPInline(target, pool, s);
    const players = [...s.players] as [PlayerState, PlayerState];
    if (hp > 0 && newDmg >= hp) {
      // KO：棄牌遷移 + 累計獎賞 + 移除位置
      const ko: CardInstance[] = [
        { ...target, damage: newDmg },
        ...target.energyAttached,
        ...(target.toolAttached ? [target.toolAttached] : []),
        ...(target.evolvedFromStack ?? []),
      ];
      const prizeCount = isExCard(targetCard) ? 2 : 1;
      const newDef = { ...defender, discard: [...defender.discard, ...ko] };
      if (isActive) newDef.active = null;
      else newDef.bench = defender.bench.filter(c => c.iid !== iid);
      players[dIdx] = newDef;
      s = { ...s, players, pendingPrizes: (s.pendingPrizes ?? 0) + prizeCount };
      s = addLog(s, `${label}：對 ${targetCard?.name ?? '?'}（${isActive ? '戰鬥場' : '備戰位'}）造成 ${dmg} 點傷害 → 被擊倒！+${prizeCount} 張獎勵牌`, actorIdx);
      // 戰鬥場昏厥且對手沒有備戰 → game over
      if (isActive && newDef.bench.length === 0) {
        s = { ...s, phase: 'game-over', winner: actorIdx, winReason: `${defender.name} 沒有可上場的寶可夢` };
        return s;
      }
    } else {
      const newDef = { ...defender };
      if (isActive) newDef.active = { ...target, damage: newDmg };
      else newDef.bench = defender.bench.map(c => c.iid === iid ? { ...c, damage: newDmg } : c);
      players[dIdx] = newDef;
      s = { ...s, players };
      s = addLog(s, `${label}：對 ${targetCard?.name ?? '?'}（${isActive ? '戰鬥場' : '備戰位'}）造成 ${dmg} 點傷害`, actorIdx);
    }
  }
  return s;
});

// ── 4) 月月熊 赫月｜經驗法則 — 從手牌選最多 2 張基本【鬥】能量附給自己（剛上備戰才可用）
//   gate「pk.justPlaced」在 engine.ts getUsableAbilities 加（同螺釘地鼠）。
regA('月月熊 赫月', 0, (st, idx, pool, cardInst) => {
  if (!cardInst) return st;
  const fightInHand = st.players[idx].hand.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic'
      && (card.pokemonType === 'Fighting' || /【鬥】/.test(card.name));
  });
  if (fightInHand.length === 0) {
    return addLog(st, '經驗法則：手牌無基本【鬥】能量', idx);
  }
  const maxN = Math.min(2, fightInHand.length);
  st = addLog(st, `經驗法則：從手牌選 0~${maxN} 張基本【鬥】能量附給這隻寶可夢`, idx);
  return withPending(st, {
    type: 'hand-discard',  // 用 hand-discard 讓玩家從手牌挑（resolver 改寫為附加而非丟棄）
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicFightingEnergy',
    minCount: 0, maxCount: maxN,
    effectKey: 'ursaluna-bm-attach',
    params: { hostIid: cardInst.iid },
  });
});
regR('ursaluna-bm-attach', (state, aIdx, selectedIids, params, pool) => {
  const hostIid = params?.hostIid as string | undefined;
  if (!hostIid) return state;
  const energies = state.players[aIdx].hand.filter(c => selectedIids.includes(c.iid));
  if (energies.length === 0) {
    return addLog(state, '經驗法則：未選能量', aIdx);
  }
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  p.hand = p.hand.filter(c => !selectedIids.includes(c.iid));
  if (p.active?.iid === hostIid) {
    p.active = { ...p.active, energyAttached: [...p.active.energyAttached, ...energies] };
  } else {
    p.bench = p.bench.map(b => b.iid === hostIid
      ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
      : b);
  }
  players[aIdx] = p;
  const names = energies.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  return addLog({ ...state, players }, `經驗法則：附 ${energies.length} 張基本【鬥】能量（${names}）到月月熊 赫月`, aIdx);
});

// ── 5) 菊草葉｜叫聲 — 對手戰鬥位下回合招式 -20（沿用 嘎啦嘎啦|叫聲 的 helper）
regPre('菊草葉|叫聲', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('菊草葉|叫聲', defNextAtkReducePost(20));

// ── 6) 呱頭蛙｜招集之術 — 牌庫選最多 3 張寶可夢加手牌 + 重洗
regPre('呱頭蛙|招集之術', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('呱頭蛙|招集之術', (state, aIdx, _pool) => {
  if (state.players[aIdx].deck.length === 0) {
    return addLog(state, '招集之術：牌庫為空', aIdx);
  }
  const s = addLog(state, '招集之術：從牌庫選 0~3 張寶可夢卡加手牌（之後重洗）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 3,
    effectKey: 'froakie-summon-tactics',
  });
});
regR('froakie-summon-tactics', (state, aIdx, selectedIids, _params, pool) => {
  const picks = state.players[aIdx].deck.filter(c => selectedIids.includes(c.iid));
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    deck: shuffle(p.deck.filter(c => !selectedIids.includes(c.iid))),
    hand: [...p.hand, ...picks],
  }));
  if (picks.length > 0) {
    const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.130：對手看不到具體卡名
    s = addPrivateLog(s,
      `招集之術：搜到 ${picks.length} 張寶可夢加入手牌（${names}），重洗牌庫`,
      `招集之術：搜到 ${picks.length} 張寶可夢加入手牌，重洗牌庫`,
      aIdx);
  } else {
    s = addLog(s, '招集之術：未選卡，重洗牌庫', aIdx);
  }
  return s;
});

// ── 7) 巨金怪 (M4)｜彈回 60 — 對手 active↔備戰互換（由對手選）
regPre('巨金怪|彈回', (state, _aIdx, _pool) => ({ state, damage: 60 }));
regPost('巨金怪|彈回', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  if (!d.active || d.bench.length === 0) {
    return addLog(state, '彈回：對手無備戰可交換', aIdx);
  }
  const s = addLog(state, '彈回：對手必須將戰鬥寶可夢與備戰寶可夢互換（由對手選）', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'force-opp-swap',  // resolver 已實裝（line 8034）
    params: { label: '彈回', attackerIdx: aIdx },
  });
});

// ── 8) 巨金怪 (M4)｜金屬之錘 150+ — 若希望棄 3 個鋼能量 → +150
//   binary 邏輯：棄 3 個 → +150；不棄 → +0。用 ATTACK_PRE_DISCARD_CHOICE max=3 min=0，
//   regPre 內依玩家實際棄的張數決定（恰好 3 → bonus；其他 → 不加）
ATTACK_PRE_DISCARD_CHOICE.set('巨金怪|金屬之錘', {
  min: 0, max: 3, scope: 'attacker', baseDamage: 150, damagePerEnergy: 0,
});
regPre('巨金怪|金屬之錘', (state, aIdx, _pool, action) => {
  const discarded = action?.discardedEnergyIids ?? [];
  if (discarded.length === 3) {
    return { state: addLog(state, '金屬之錘：棄 3 個鋼能量 → +150 傷害', aIdx), damage: 300 };
  }
  return { state, damage: 150 };
});

// v2.133 月月熊 赫月ex｜老練招式（被動）— 「血月」所需【無】能量減少對手已獲得獎賞牌數
//   原本血月 cost = 5×Colorless；對手已取 3 張獎賞 → 改為 2×Colorless。
//   engine.ts canAffordAttack 開頭呼叫此 helper 改寫 cost。
export function getUrsalunaBloodMoonEffectiveCost(
  attackerName: string,
  attackName: string,
  state: GameState,
  pool: Map<string, Card>,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '月月熊 赫月ex') return originalCost;
  if (attackName !== '血月') return originalCost;
  const aIdx = state.activePlayerIndex;
  // 對手已獲得獎賞 = 6 - 對手剩餘獎賞
  const oppPrizes = state.players[(1 - aIdx) as 0 | 1].prizes.length;
  const taken = Math.max(0, 6 - oppPrizes);
  // 從 originalCost 移除 `taken` 個 Colorless
  if (taken === 0) return originalCost;
  const reduced: import('$lib/cards/types').EnergyType[] = [];
  let toRemove = taken;
  for (const c of originalCost) {
    if (c === 'Colorless' && toRemove > 0) { toRemove--; continue; }
    reduced.push(c);
  }
  return reduced;
}

// ── 9) 酋雷姆｜反等離子 — 對手棄牌區有名稱含「阿克羅瑪」的卡時，
//   「三重冰霜」所需能量改為 1 個【無】。engine canAffordAttack 必須 hook。
//   實作：engine.ts 內 attack 成本檢查時呼叫此 helper 改寫 cost。
//   為避免在 effects.ts 改 engine，這裡只 export helper 給 engine import。
export function getKyuremElectroplasmaEffectiveCost(
  attackerName: string,
  attackName: string,
  state: GameState,
  pool: Map<string, Card>,
  originalCost: import('$lib/cards/types').EnergyType[],
): import('$lib/cards/types').EnergyType[] {
  if (attackerName !== '酋雷姆') return originalCost;
  if (attackName !== '三重冰霜') return originalCost;
  // 檢查酋雷姆場上有「反等離子」特性（防範同名卡未來不同特性）
  // 對手棄牌區是否有名稱含「阿克羅瑪」的卡
  const aIdx = state.activePlayerIndex;
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppDiscard = state.players[dIdx].discard;
  const hasAcroma = oppDiscard.some(c => {
    const card = pool.get(c.cardId);
    return card?.name?.includes('阿克羅瑪') ?? false;
  });
  if (hasAcroma) return ['Colorless'];
  return originalCost;
}

// ══════════════════════════════════════════════════════════════════════════════
// v2.133 — 電電蟲 + 超級袋獸厄鬼椪 預組新卡實裝
//   特性 6 個：複眼（已加 PASSIVE_ATTACK_BONUS）/ 勤奮之心 / 老練招式（已加 helper）
//             / 迅速游標 / 藏青浪濤 / 沉雪
//   訓練家/能量 3 個：貴重手推車（Item ACE SPEC）/ 電氣球（Tool）/ 薄霧能量（Special Energy）
// ══════════════════════════════════════════════════════════════════════════════

// ── 皮卡丘ex｜勤奮之心 ─────────────────────────────────────────────────────
// 卡面：HP 全滿時受招式而昏厥 → 不昏厥，剩下 HP=10 留場。
// 簡化版：把皮卡丘ex 自身視為「自帶倖存鍛鍊器但不消耗」。engine 內 wouldBeKO 之後
// 我們在 TOOL_PREVENT_KO 走完之後再加一個 PASSIVE_PREVENT_KO 檢查。
// 由於改 engine 較大，先用以下做法：透過 PASSIVE_PREVENT_KO export 一個查詢函式，
// 由 engine 在 KO 路徑檢查。
export const PASSIVE_PREVENT_KO = new Map<string, (
  holderInst: CardInstance, holderCard: Card, incomingDamage: number
) => { prevent: boolean; leaveHP: number }>();
PASSIVE_PREVENT_KO.set('勤奮之心', (inst, card, _dmg) => {
  // 全血才能觸發（damage === 0）
  if (inst.damage > 0) return { prevent: false, leaveHP: 0 };
  // 一回合限一次：使用 inst.activeIndustryHeartUsedThisGame 作旗標（暫不限）
  // 卡面沒明說「一場限一次」，所以每次滿血被打都觸發。
  return { prevent: true, leaveHP: 10 };
});

// ── 古劍豹｜沉雪 ──────────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌將這張卡放置於備戰區時，可使用 1 次。將場上的競技場卡丟棄。」
// gate：pk.justPlaced（同 狂挖 / 經驗法則 pattern，engine.ts getUsableAbilities 加）
// 簡化：競技場卡丟回觸發方（古劍豹擁有者）的棄牌。引擎內 activeStadium 沒記擁有者，
//   一般 PTCG 規則本來就是「丟回擁有者棄牌」，但因為我們缺資料，只能近似處理。
regA('古劍豹', 0, (st, idx, pool, cardInst) => {
  if (!cardInst) return st;
  if (!st.activeStadium) return addLog(st, '沉雪：場上沒有競技場卡', idx);
  const stadiumCard = pool.get(st.activeStadium.cardId);
  const stadiumInst = st.activeStadium;
  const players = [...st.players] as [PlayerState, PlayerState];
  const me = { ...players[idx] };
  me.discard = [...me.discard, stadiumInst];
  players[idx] = me;
  return addLog(
    { ...st, players, activeStadium: undefined },
    `沉雪：場上的競技場卡「${stadiumCard?.name ?? '?'}」被丟棄`,
    idx,
  );
});

// ── 鐵斑葉ex｜迅速游標 ─────────────────────────────────────────────────────
// 卡面：上備戰時可使用 1 次 → 將這隻寶可夢與戰鬥寶可夢互換 + 任意能量改附給這隻。
// v2.138：完整實裝 — 互換後自動把舊戰鬥場（現備戰）所有能量改附給新戰鬥場（鐵斑葉ex）。
//   卡面寫「任意能量」，玩家理論上可選張數，但實戰絕大多數選「全轉」（多選對自己有利），
//   sim/AI 端用全轉版；UI 玩家若需要更精細控制可以後續加 modal。
//   gate：pk.justPlaced（同 狂挖 / 經驗法則）
regA('鐵斑葉ex', 0, (st, idx, pool, cardInst) => {
  if (!cardInst) return st;
  const player = st.players[idx];
  if (!player.active || player.active.iid === cardInst.iid) {
    return addLog(st, '迅速游標：必須從備戰區發動且戰鬥場有寶可夢', idx);
  }
  const benchIdx = player.bench.findIndex(c => c.iid === cardInst.iid);
  if (benchIdx < 0) return st;
  const oldActiveCard = pool.get(player.active.cardId);
  const newActiveCard = pool.get(cardInst.cardId);
  const players = [...st.players] as [PlayerState, PlayerState];
  const newBench = [...player.bench];
  // 從舊戰鬥場拔出所有能量
  const transferredEnergies = [...player.active.energyAttached];
  const oldActiveCleared = {
    ...clearActiveEffects(player.active),
    energyAttached: [],
  };
  newBench[benchIdx] = oldActiveCleared;
  // 新戰鬥場 = 鐵斑葉ex（從備戰移出），合併原有能量 + 轉移過來的能量
  const newActive: CardInstance = {
    ...player.bench[benchIdx],
    energyAttached: [...player.bench[benchIdx].energyAttached, ...transferredEnergies],
    movedToActiveThisTurn: true,
  };
  players[idx] = { ...player, active: newActive, bench: newBench };
  let s = addLog(
    { ...st, players },
    `迅速游標：${oldActiveCard?.name ?? '?'} 退回備戰區，${newActiveCard?.name ?? '?'} 上場`,
    idx,
  );
  if (transferredEnergies.length > 0) {
    const energyNames = transferredEnergies.map(e => pool.get(e.cardId)?.name ?? '?').join('、');
    s = addLog(s, `迅速游標：將 ${transferredEnergies.length} 張能量（${energyNames}）改附於 ${newActiveCard?.name ?? '?'}`, idx);
  }
  return s;
});

// ── 波盪水ex｜藏青浪濤 — 招式不計算對手戰鬥場附加效果 ─────────────────────
// 既有 regPre('波盪水ex|宣洩吼嘯') 已實裝（line 3114）；補上 skipDefEffects 旗標。
// 為避免雙處同步遺漏，這裡 wrap 既有 PRE：先呼叫舊實作，再覆蓋 skipDefEffects=true。
{
  const oldPre = ATTACK_PRE.get('波盪水ex|宣洩吼嘯');
  if (oldPre) {
    regPre('波盪水ex|宣洩吼嘯', (state, aIdx, pool, action) => {
      const r = oldPre(state, aIdx, pool, action);
      return { ...r, skipDefEffects: true };
    });
  }
}

// ── 貴重手推車 (Item ACE SPEC) — 從牌庫選任意數量基礎寶可夢放備戰並重洗 ────
regG('貴重手推車', (st, idx) => {
  // 牌庫有基礎寶可夢 + 備戰未滿
  const p = st.players[idx];
  if (p.bench.length >= 5) return false;
  return p.deck.length > 0;
});
reg('貴重手推車', (st, idx) => {
  const p = st.players[idx];
  const slots = 5 - p.bench.length;
  if (slots <= 0) return addLog(st, '貴重手推車：備戰區已滿', idx);
  st = addLog(st, `貴重手推車：從牌庫選 0~${slots} 張基礎寶可夢卡放置於備戰區`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic',
    minCount: 0, maxCount: slots,
    effectKey: 'precious-cart-bench',
  });
});
regR('precious-cart-bench', (state, aIdx, selectedIids, _params, pool) => {
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.deck.filter(c => selectedIids.includes(c.iid));
  p.deck = shuffle(p.deck.filter(c => !selectedIids.includes(c.iid)));
  const placedNames: string[] = [];
  for (const pk of picks) {
    if (p.bench.length >= 5) break;
    const card = pool.get(pk.cardId);
    p.bench = [...p.bench, { ...pk, justPlaced: true }];
    placedNames.push(card?.name ?? '?');
  }
  players[aIdx] = p;
  s = { ...s, players };
  if (placedNames.length > 0) {
    s = addLog(s, `貴重手推車：${placedNames.join('、')} 放置於備戰區，重洗牌庫`, aIdx);
    s = applyBenchPlaceSideEffects(s, aIdx, picks.map(c => c.iid), pool);
  } else {
    s = addLog(s, '貴重手推車：未選卡，重洗牌庫', aIdx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// v2.135 — 阿響的火爆獸 + 火箭隊的烏鴉頭頭 兩組 preset 卡效果
//
// 阿響的火爆獸 牌組：
//   • 阿響的火球鼠｜火花 30 + 自棄 1 能量
//   • 阿響的火岩鼠｜烈焰 40（純傷害）+ 旅途牽絆（regA：搜阿響的冒險到手）
//   • 阿響的火爆獸｜拍檔爆破 40 + 棄牌區「阿響的冒險」×60
//   • 阿響的火爆獸｜爆熱炮 160（純傷害）
//   • 阿響的冒險（Supporter）— 搜「阿響的寶可夢 OR 基本火能量」≤3 加手 + 重洗
//   • 比克提尼｜勝利聲援（PASSIVE_ATTACK_BONUS：自方火屬性進化寶可夢 +10）
//   • 烏栗（Supporter）— 二選一：1) 自方戰鬥↔備戰互換，2) 本回合對 ex/V +30
//   • 猛攻手鐲（Tool）— 對對手戰鬥場 ex +30
//   • 聖灰（Item）— 從棄牌區挑最多 5 張寶可夢卡放回牌庫並重洗
//   • 秘密箱 ACE（Item）— 棄 3 手牌，搜物品/道具/支援者/競技場各 1 張到手
//
// 火箭隊的烏鴉頭頭 牌組：
//   • 火箭隊的烏鴉頭頭｜火箭羽毛 60×（手牌火箭隊支援者卡張數，自動全丟）
//   • 火箭隊的烏鴉頭頭｜頭突 100（純傷害）
//   • 火箭隊的黑暗鴉｜誑騙 0 + 牌庫搜支援者到手
//   • 火箭隊的黑暗鴉｜無理取鬧 30（純傷害；封招式效果簡化省略）
//   • 火箭隊的多邊獸｜駭客攻擊 0 + 雙方棄 1 手牌
//   • 火箭隊的多邊獸Ⅱ｜R指令 20×（自方棄牌區火箭隊支援者卡張數）
//   • 洛拍棒（Item）— 牌庫上方 4 張看，挑任意數量支援者加手 + 剩餘洗回
// ══════════════════════════════════════════════════════════════════════════════

// ── 比克提尼｜勝利聲援（被動）────────────────────────────────────────────────
// 自己火屬性進化寶可夢使用招式對對手戰鬥場 +10。透過 PASSIVE_ATTACK_BONUS。
PASSIVE_ATTACK_BONUS.set('勝利聲援', (att) => {
  if (att.pokemonType !== 'Fire') return 0;
  if (!att.evolvesFrom) return 0; // 進化寶可夢必有 evolvesFrom
  return 10;
});

// ── 阿響的火球鼠｜火花 30 + 自棄 1 能量 ─────────────────────────────────────
regPre('阿響的火球鼠|火花', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('阿響的火球鼠|火花', selfDiscardNEnergyPost(1, '火花'));

// ── 阿響的火岩鼠｜烈焰 40（無附加效果，預設處理）── 不需 reg

// ── 阿響的火岩鼠｜旅途牽絆（特性）— 搜「阿響的冒險」到手 ────────────────────
regA('阿響的火岩鼠', 0, (st, idx) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '旅途牽絆：牌庫為空', idx);
  st = addLog(st, '旅途牽絆：從牌庫選 1 張「阿響的冒險」加手牌並重洗', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Card:阿響的冒險',
    minCount: 0, maxCount: 1,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// ── 阿響的火爆獸｜拍檔爆破 40 + 棄牌區「阿響的冒險」×60 ──────────────────────
regPre('阿響的火爆獸|拍檔爆破', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const adventureCount = p.discard.filter(c => pool.get(c.cardId)?.name === '阿響的冒險').length;
  const bonus = adventureCount * 60;
  const damage = 40 + bonus;
  const s = addLog(state, `拍檔爆破：棄牌區有 ${adventureCount} 張「阿響的冒險」→ +${bonus}（合計 ${damage}）`, aIdx);
  return { state: s, damage };
});

// ── 阿響的火爆獸｜爆熱炮 160（無附加效果，預設處理）── 不需 reg

// ── 阿響的冒險（Supporter）— 搜「阿響的寶可夢 OR 基本火能量」≤3 加手牌 ──────
reg('阿響的冒險', (st, idx, pool) => {
  if (st.players[idx].deck.length === 0) {
    return addLog(st, '阿響的冒險：牌庫為空', idx);
  }
  st = addLog(st, '阿響的冒險：從牌庫選最多 3 張「阿響的寶可夢 / 基本火能量」加手牌並重洗', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'RakiPokemonOrFireEnergy',
    minCount: 0, maxCount: 3,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// ── 烏栗（Supporter）— v2.139 完整實裝 modal 二選一 ────────────────────────
// 卡面 2 選項：(1) 自己戰鬥場↔備戰互換  (2) 本回合自己寶可夢招式對 ex/V +30
// gate：只要至少 1 個選項可用即允許使用
regG('烏栗', (st, idx) => {
  // 選項 1 至少需要備戰；選項 2 任何時候都可用 → 永遠 true（除非整個場都空）
  return !!st.players[idx].active;
});
reg('烏栗', (st, idx, _pool) => {
  const benchLen = st.players[idx].bench.length;
  st = addLog(st, '烏栗：選擇 1 個效果使用', idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'unruda-choice',
    params: {
      label: '烏栗',
      options: [
        // 若無備戰可換，選項 1 顯示 disabled
        { id: 'swap', text: '①自方戰鬥↔備戰互換', disabled: benchLen === 0 },
        { id: 'boost', text: '②本回合自方招式對 ex/V +30' },
      ],
    },
  });
});
regR('unruda-choice', (state, aIdx, iids, _params, _pool) => {
  const choice = iids[0];
  if (choice === 'swap') {
    const p = state.players[aIdx];
    if (p.bench.length === 0) {
      return addLog(state, '烏栗：備戰區無寶可夢，互換失敗', aIdx);
    }
    if (p.bench.length === 1) {
      return updatePlayer(addLog(state, '烏栗：自方戰鬥↔備戰互換', aIdx), aIdx, pl => {
        if (!pl.active) return pl;
        const old = pl.active;
        const newActive = pl.bench[0];
        return { ...pl, active: { ...newActive, status: undefined }, bench: [old] };
      });
    }
    state = addLog(state, '烏栗：選 1 隻備戰寶可夢與戰鬥互換', aIdx);
    return withPending(state, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'unruda-swap',
    });
  }
  if (choice === 'boost') {
    const players = [...state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    p.unrudaBonusThisTurn = true;  // v2.139 專屬 flag：對 ex/V +30（engine 檢查）
    players[aIdx] = p;
    return addLog({ ...state, players },
      '烏栗：本回合自方寶可夢招式對對手戰鬥場「ex / V」+30 傷害', aIdx);
  }
  return state;
});
regR('unruda-swap', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  return updatePlayer(state, aIdx, pl => {
    if (!pl.active) return pl;
    const idx = pl.bench.findIndex(c => c.iid === iids[0]);
    if (idx < 0) return pl;
    const newActive = pl.bench[idx];
    const newBench = [...pl.bench];
    newBench.splice(idx, 1);
    newBench.push(pl.active);
    return { ...pl, active: { ...newActive, status: undefined }, bench: newBench };
  });
});

// ── 猛攻手鐲（Tool）— 對對手戰鬥場 ex +30 ───────────────────────────────────
TOOL_ATTACK_BONUS.set('猛攻手鐲', (_a, _ai, defCard) => {
  const isEx = defCard.subtype === 'ex' || defCard.name.endsWith('ex') || defCard.name.endsWith('EX');
  return isEx ? 30 : 0;
});

// ── 聖灰（Item）— 從棄牌區挑最多 5 張寶可夢卡放回牌庫並重洗 ─────────────────
regG('聖灰', (st, idx, pool) => {
  return st.players[idx].discard.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
});
reg('聖灰', (st, idx, pool) => {
  const p = st.players[idx];
  const pokeCount = p.discard.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon').length;
  if (pokeCount === 0) return addLog(st, '聖灰：棄牌區無寶可夢可選', idx);
  st = addLog(st, '聖灰：從棄牌區挑最多 5 張寶可夢放回牌庫並重洗', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 0, maxCount: 5,
    effectKey: 'sacred-ash-discard-to-deck',
  });
});
regR('sacred-ash-discard-to-deck', (state, aIdx, iids, _params, pool) => {
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picked = p.discard.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return addLog(s, '聖灰：未選任何卡', aIdx);
  p.discard = p.discard.filter(c => !iids.includes(c.iid));
  p.deck = shuffle([...p.deck, ...picked]);
  players[aIdx] = p;
  s = { ...s, players };
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  return addLog(s, `聖灰：${names}（${picked.length} 張）放回牌庫並重洗`, aIdx);
});

// ── 秘密箱 ACE（Item）— 棄 3 手牌，搜「物品/道具/支援者/競技場」各 1 張到手 ──
regG('秘密箱', (st, idx) => {
  // 卡面：「必須將自己的 3 張手牌丟棄才可使用」— 手牌（含此卡）需 ≥4 張
  if (st.players[idx].hand.length < 4) return false;
  if (st.players[idx].deck.length === 0) return false;
  return true;
});
reg('秘密箱', (st, idx) => {
  st = addLog(st, '秘密箱：先選 3 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    filter: '', minCount: 3, maxCount: 3,
    effectKey: 'mystery-box-step1',
  });
});
regR('mystery-box-step1', (state, aIdx, iids, _params, pool) => {
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picked = p.hand.filter(c => iids.includes(c.iid));
  p.hand = p.hand.filter(c => !iids.includes(c.iid));
  p.discard = [...p.discard, ...picked];
  players[aIdx] = p;
  s = { ...s, players };
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  s = addLog(s, `秘密箱：丟棄 ${picked.length} 張手牌（${names}）`, aIdx);
  // v2.144 — 改為 4 步串接：物品 → 道具 → 支援者 → 競技場（各最多 1 張）
  s = addLog(s, '秘密箱：第 1 步—從牌庫選 1 張「物品」加手牌（可跳過）', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Item', minCount: 0, maxCount: 1,
    effectKey: 'mystery-box-pick-item',
  });
});

// v2.144 — 秘密箱串接 resolver（不在中途重洗，最後一步才 shuffle）──
regR('mystery-box-pick-item', (state, aIdx, iids, _params, pool) => {
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: remaining };
  });
  if (iids.length > 0) {
    const card = pool.get(s.players[aIdx].hand[s.players[aIdx].hand.length - 1].cardId);
    s = addLog(s, `秘密箱：取得「${card?.name ?? '?'}」（物品）`, aIdx);
  } else {
    s = addLog(s, '秘密箱：跳過物品', aIdx);
  }
  s = addLog(s, '秘密箱：第 2 步—從牌庫選 1 張「寶可夢道具」加手牌（可跳過）', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Tool', minCount: 0, maxCount: 1,
    effectKey: 'mystery-box-pick-tool',
  });
});
regR('mystery-box-pick-tool', (state, aIdx, iids, _params, pool) => {
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: remaining };
  });
  if (iids.length > 0) {
    const card = pool.get(s.players[aIdx].hand[s.players[aIdx].hand.length - 1].cardId);
    s = addLog(s, `秘密箱：取得「${card?.name ?? '?'}」（寶可夢道具）`, aIdx);
  } else {
    s = addLog(s, '秘密箱：跳過寶可夢道具', aIdx);
  }
  s = addLog(s, '秘密箱：第 3 步—從牌庫選 1 張「支援者」加手牌（可跳過）', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Supporter', minCount: 0, maxCount: 1,
    effectKey: 'mystery-box-pick-supporter',
  });
});
regR('mystery-box-pick-supporter', (state, aIdx, iids, _params, pool) => {
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: remaining };
  });
  if (iids.length > 0) {
    const card = pool.get(s.players[aIdx].hand[s.players[aIdx].hand.length - 1].cardId);
    s = addLog(s, `秘密箱：取得「${card?.name ?? '?'}」（支援者）`, aIdx);
  } else {
    s = addLog(s, '秘密箱：跳過支援者', aIdx);
  }
  s = addLog(s, '秘密箱：第 4 步—從牌庫選 1 張「競技場」加手牌（可跳過）', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Stadium', minCount: 0, maxCount: 1,
    effectKey: 'mystery-box-pick-stadium',
  });
});
regR('mystery-box-pick-stadium', (state, aIdx, iids, _params, pool) => {
  // 最後一步：抽完重洗
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, hand: [...p.hand, ...chosen], deck: shuffle(remaining) };
  });
  if (iids.length > 0) {
    const card = pool.get(s.players[aIdx].hand[s.players[aIdx].hand.length - 1].cardId);
    s = addLog(s, `秘密箱：取得「${card?.name ?? '?'}」（競技場）`, aIdx);
  } else {
    s = addLog(s, '秘密箱：跳過競技場', aIdx);
  }
  s = addLog(s, '秘密箱：完成搜尋並重洗牌庫', aIdx);
  return s;
});

// ── 火箭隊的烏鴉頭頭｜火箭羽毛 60× v2.143 完整實裝（玩家自選張數） ──────────
// 卡面：從手牌任意數量「火箭隊」支援者丟棄，造成 ×60 傷害。
// 註冊到 ATTACK_PRE_DISCARD_CHOICE — UI 端宣告招式時彈 modal 給玩家選張數，
// 確認後 action.discardedEnergyIids 帶手牌 iid（v2.143 重用既有欄位，雖名為
// energy 實際裝手牌 iid）。AI 端 fallback：自動全丟（最大化攻擊）。
ATTACK_PRE_DISCARD_CHOICE.set('火箭隊的烏鴉頭頭|火箭羽毛', {
  min: 0,
  max: null,  // 不限上限
  scope: 'hand-rocket-supporter',
  baseDamage: 0,
  damagePerEnergy: 60,
});
regPre('火箭隊的烏鴉頭頭|火箭羽毛', (state, aIdx, pool, action) => {
  const p = state.players[aIdx];
  const chosenIids = action?.discardedEnergyIids;  // 玩家挑選的手牌 iid（PRE_DISCARD_CHOICE 流程）
  let idxs: number[];
  if (chosenIids && chosenIids.length > 0) {
    // 玩家明確指定：用這幾張
    const idSet = new Set(chosenIids);
    idxs = [];
    p.hand.forEach((c, i) => {
      if (idSet.has(c.iid)) {
        const card = pool.get(c.cardId);
        if (card?.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊')) {
          idxs.push(i);
        }
      }
    });
  } else {
    // AI / 未開 modal fallback：自動全丟（最大化攻擊）
    idxs = [];
    p.hand.forEach((c, i) => {
      const card = pool.get(c.cardId);
      if (card?.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊')) {
        idxs.push(i);
      }
    });
  }
  if (idxs.length === 0) {
    return { state: addLog(state, '火箭羽毛：未丟棄任何手牌 → 0 傷害', aIdx), damage: 0 };
  }
  const damage = idxs.length * 60;
  const discarded = idxs.map(i => p.hand[i]);
  const names = discarded.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `火箭羽毛：丟 ${discarded.length} 張（${names}），造成 ${damage} 傷害`, aIdx);
  s = updatePlayer(s, aIdx, pl => ({
    ...pl,
    hand: pl.hand.filter((_, i) => !idxs.includes(i)),
    discard: [...pl.discard, ...discarded],
  }));
  return { state: s, damage };
});

// ── 火箭隊的烏鴉頭頭｜頭突 100（無附加效果） ─── 不需 reg

// ── 火箭隊的黑暗鴉｜誑騙 0 + 搜支援者到手 ───────────────────────────────────
regPre('火箭隊的黑暗鴉|誑騙', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('火箭隊的黑暗鴉|誑騙', deckSearchToHandPost(1, 'Supporter', '誑騙'));

// ── 火箭隊的黑暗鴉|無理取鬧 30 + 鎖對手戰鬥位 1 招式（下回合）── v2.138
// 卡面：選 1 個對手戰鬥寶可夢持有的招式。下回合對手戰鬥位寶可夢無法使用此招式。
// 簡化：sim/AI 端鎖「對手戰鬥位最後 1 個（通常最強）招式」；玩家若要自選可未來加 modal。
//   若對手換戰鬥位，鎖招會自動失效（卡面就是這樣設計）。
regPre('火箭隊的黑暗鴉|無理取鬧', (state, _aIdx, _pool) => ({ state, damage: 30 }));
regPost('火箭隊的黑暗鴉|無理取鬧', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active) return state;
  const defCard = pool.get(def.active.cardId);
  const attacks = defCard?.attacks ?? [];
  if (attacks.length === 0) return state;
  // 取最後 1 招（通常是最強的）— 簡化版
  const lockedName = attacks[attacks.length - 1].name;
  const players = [...state.players] as [PlayerState, PlayerState];
  const newDef = { ...def };
  const cur = newDef.active!.blockedAttackNamesNextTurn ?? [];
  newDef.active = {
    ...newDef.active!,
    blockedAttackNamesNextTurn: [...cur, lockedName],
  };
  players[dIdx] = newDef;
  return addLog({ ...state, players },
    `無理取鬧：${defCard?.name ?? '?'} 下回合無法使用「${lockedName}」`, aIdx);
});

// ── 火箭隊的多邊獸｜駭客攻擊 0 + 雙方棄 1 手牌 ───────────────────────────────
regPre('火箭隊的多邊獸|駭客攻擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('火箭隊的多邊獸|駭客攻擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const p = state.players[aIdx];
  const op = state.players[dIdx];
  if (p.hand.length === 0 && op.hand.length === 0) {
    return addLog(state, '駭客攻擊：雙方手牌皆空', aIdx);
  }
  // 自己自動丟最右一張，對手隨機丟一張
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  if (p.hand.length > 0) {
    const ip = { ...players[aIdx] };
    const lastIdx = ip.hand.length - 1;
    const drop = ip.hand[lastIdx];
    ip.hand = ip.hand.slice(0, lastIdx);
    ip.discard = [...ip.discard, drop];
    players[aIdx] = ip;
    s = { ...s, players };
    s = addLog(s, `駭客攻擊：自己丟棄 ${pool.get(drop.cardId)?.name ?? '?'}`, aIdx);
  }
  // 對手由 ai/UI 自選 — 但簡化也自動丟最右一張
  const players2 = [...s.players] as [PlayerState, PlayerState];
  const o = { ...players2[dIdx] };
  if (o.hand.length > 0) {
    const lastIdx = o.hand.length - 1;
    const drop = o.hand[lastIdx];
    o.hand = o.hand.slice(0, lastIdx);
    o.discard = [...o.discard, drop];
    players2[dIdx] = o;
    s = { ...s, players: players2 };
    s = addLog(s, `駭客攻擊：對手丟棄 ${pool.get(drop.cardId)?.name ?? '?'}`, aIdx);
  }
  return s;
});

// ── 火箭隊的多邊獸Ⅱ｜R指令 20×（自方棄牌區「火箭隊」支援者卡張數） ────────
regPre('火箭隊的多邊獸Ⅱ|R指令', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const count = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊');
  }).length;
  const damage = count * 20;
  const s = addLog(state, `R指令：棄牌區「火箭隊」支援者 ${count} 張 → ${damage} 傷害`, aIdx);
  return { state: s, damage };
});

// ── 洛拍棒（Item）— 牌庫上方 4 張看，挑任意數量支援者加手 + 剩餘洗回 ────────
regG('洛拍棒', (st, idx) => {
  return st.players[idx].deck.length > 0;
});
reg('洛拍棒', (st, idx) => {
  const p = st.players[idx];
  const top4 = p.deck.slice(0, 4);
  if (top4.length === 0) return addLog(st, '洛拍棒：牌庫為空', idx);
  st = addLog(st, `洛拍棒：查看牌庫上方 ${top4.length} 張，選任意數量支援者加手牌`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter:TOP4',
    minCount: 0, maxCount: 4,
    effectKey: 'recall-rod',
    params: { top4Iids: top4.map(c => c.iid) },
  });
});
regR('recall-rod', (state, aIdx, iids, _params, pool) => {
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picked = p.deck.filter(c => iids.includes(c.iid));
  p.hand = [...p.hand, ...picked];
  p.deck = shuffle(p.deck.filter(c => !iids.includes(c.iid)));
  players[aIdx] = p;
  s = { ...s, players };
  if (picked.length > 0) {
    const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    s = addLog(s, `洛拍棒：${names}（${picked.length} 張）加手牌，剩餘洗回牌庫`, aIdx);
  } else {
    s = addLog(s, '洛拍棒：未選卡，剩餘洗回牌庫', aIdx);
  }
  return s;
});

// ── v2.144 道具拆除器（Item）─────────────────────────────────────────────────
// 卡面：選擇最多 2 張雙方場上寶可夢身上附加的「寶可夢道具」卡，將其丟棄。
// 用 modal-choice 列雙方所有 Tool；玩家選 1 張 → resolver 丟掉 → 若還剩 ≥1 張 Tool
// 開第 2 個 modal 讓玩家選第 2 張或結束。
regG('道具拆除器', (st) => {
  const allTools: string[] = [];
  for (const idx of [0, 1] as const) {
    const p = st.players[idx];
    if (p.active?.toolAttached) allTools.push(p.active.toolAttached.iid);
    for (const b of p.bench) if (b.toolAttached) allTools.push(b.toolAttached.iid);
  }
  return allTools.length > 0;
});
function buildToolRemoverOptions(st: GameState, pool: Map<string, Card>) {
  const opts: { id: string; text: string }[] = [];
  for (const idx of [0, 1] as const) {
    const p = st.players[idx];
    const sideLabel = idx === st.activePlayerIndex ? '我方' : '對手';
    const all = [
      ...(p.active ? [{ inst: p.active, pos: '戰鬥' as const }] : []),
      ...p.bench.map(b => ({ inst: b, pos: '備戰' as const })),
    ];
    for (const { inst, pos } of all) {
      if (!inst.toolAttached) continue;
      const ownerName = pool.get(inst.cardId)?.name ?? '?';
      const toolName = pool.get(inst.toolAttached.cardId)?.name ?? '?';
      opts.push({
        id: `${idx}:${inst.iid}`,
        text: `🔧 ${sideLabel} ${pos} ${ownerName} 的「${toolName}」`,
      });
    }
  }
  return opts;
}
reg('道具拆除器', (st, idx, pool) => {
  const opts = buildToolRemoverOptions(st, pool);
  if (opts.length === 0) return addLog(st, '道具拆除器：場上沒有道具卡可丟棄', idx);
  st = addLog(st, '道具拆除器：選 1 張雙方場上的道具卡丟棄（最多可丟 2 張）', idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'tool-remover-pick',
    params: { label: '道具拆除器（第 1 張）', options: opts, picksLeft: 1 },
  });
});
regR('tool-remover-pick', (state, aIdx, iids, params, pool) => {
  if (iids.length === 0) return state;
  const choice = iids[0];
  const [pIdxStr, targetIid] = choice.split(':');
  const pIdx = parseInt(pIdxStr) as 0 | 1;
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];
  const pp = { ...players[pIdx] };
  let removedTool: typeof pp.bench[0]['toolAttached'] = undefined;
  let ownerName = '?';
  if (pp.active?.iid === targetIid) {
    removedTool = pp.active.toolAttached;
    ownerName = pool.get(pp.active.cardId)?.name ?? '?';
    pp.active = { ...pp.active, toolAttached: undefined };
  } else {
    const bIdx = pp.bench.findIndex(b => b.iid === targetIid);
    if (bIdx >= 0) {
      const b = { ...pp.bench[bIdx] };
      removedTool = b.toolAttached;
      ownerName = pool.get(b.cardId)?.name ?? '?';
      b.toolAttached = undefined;
      pp.bench = [...pp.bench];
      pp.bench[bIdx] = b;
    }
  }
  if (!removedTool) return addLog(s, '道具拆除器：找不到目標道具', aIdx);
  pp.discard = [...pp.discard, removedTool];
  players[pIdx] = pp;
  s = { ...s, players };
  const tname = pool.get(removedTool.cardId)?.name ?? '?';
  s = addLog(s, `道具拆除器：丟棄 ${ownerName} 身上的「${tname}」`, aIdx);

  // 若還可以丟第 2 張，且場上還有 Tool → 開第 2 個 modal-choice 讓玩家選或結束
  const picksLeft = (params?.picksLeft as number ?? 1) - 1;
  if (picksLeft >= 1) {
    const opts2 = buildToolRemoverOptions(s, pool);
    if (opts2.length > 0) {
      // 加「結束（不丟第 2 張）」選項
      opts2.push({ id: 'end', text: '✋ 結束（不丟第 2 張）' });
      s = withPending(s, {
        type: 'modal-choice',
        actorIdx: aIdx, sourcePlayerIdx: aIdx,
        minCount: 1, maxCount: 1,
        effectKey: 'tool-remover-pick',
        params: { label: '道具拆除器（第 2 張）', options: opts2, picksLeft: 0 },
      });
    }
  }
  return s;
});
// 'end' choice handler — 沒做事，只是結束 chain
regR('tool-remover-end', (state) => state);