/**
 * v3.07 Deferred Wave D — 3 張需要手牌 UI 元件層 hook 的特性
 *
 * 來源：v3.05 Wave A 文檔中標 Phase 2 deferred 的 3 張卡，本波集中實裝。
 * 機制需新增「玩家從手牌主動觸發」這條全新流程（不同於既有的『放置/進化時自動詢問』
 * 也不同於『撤退時自動詢問』）。
 *
 * 涵蓋本波：
 *   1. 超能妙喵｜誘導之尾（H / SV）
 *      - 機制 A：ON_DISCARD_FROM_HAND（手牌棄 1 張指定能量/物品 → 觸發場上對應特性）
 *      - 條件：自方場上有「超能妙喵」+ 自方手牌有「悠哉尾草棒」+ 對手有備戰
 *      - 效果：棄 1 張「悠哉尾草棒」+ 開 opp-bench-choose → 與對手戰鬥位互換
 *
 *   2. 火神蛾｜熱浪鱗粉（I / SV）
 *      - 機制 A：同上
 *      - 條件：自方場上有「火神蛾」+ 自方手牌有「基本【火】能量」+ 對手戰鬥位非已灼傷
 *      - 效果：棄 1 張「基本【火】能量」+ 對手戰鬥位【灼傷】
 *
 *   3. 齒輪怪｜緊急迴轉（H / SV）
 *      - 機制 B：ON_HAND_ACTIVATE（手牌寶可夢自身觸發放上備戰）
 *      - 條件：手牌有此卡 + 對手場上有 Stage 2 寶可夢 + 自方備戰 < 5
 *      - 效果：將這張卡（從手牌）放置於備戰區
 *      - 注意：不是棄手牌型 — 是『手牌寶可夢自身就是 trigger』，齒輪怪自己上場
 *
 * 設計：
 *   - 兩條新 GameAction：USE_HAND_DISCARD_ABILITY / USE_HAND_ABILITY（types.ts 加）
 *   - 兩個新 Map：ON_DISCARD_FROM_HAND_ABILITIES + ON_HAND_ACTIVATE_ABILITIES
 *     （effects.ts 直接 export，由 engine.ts handler 查詢）
 *   - effect fn：本檔以 regular function（非 regA）實作，由 engine.ts 直接 call
 *     — 因為 trigger 不是「對某個場上 inst 用特性」而是「玩家主動消耗手牌觸發場上特性」
 *   - 每回合 1 次限制：用 player.abilityNamesUsedThisTurn 追蹤名稱（已存在的機制）
 *   - 齒輪怪：手牌觸發後該 inst 從手牌進入 bench；不需 abilityUsedThisTurn 旗標
 *     （因為觸發後 inst 已不在手牌，無法重複）
 *
 * Iron Rule 12：本檔不對 effects.ts 內 Map 做 .set()（兩個新 Map 在 effects.ts
 * 自身宣告為 new Map），register function 仍保留以維持模板一致。
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  addLog, updatePlayer, withPending,
  ABILITY_EFFECTS as _ABILITY_EFFECTS_UNUSED,
} from '../_shared';

// 導出 sentinel 防止 unused import warnings
export type _v3070Sentinel = PlayerState | GameState | Card | CardInstance;
const _unused = _ABILITY_EFFECTS_UNUSED; void _unused;

// ════════════════════════════════════════════════════════════════════════════
// Effect fn 型別（手牌觸發專用 — 不同於 regA 的 ABILITY_EFFECTS）
// ════════════════════════════════════════════════════════════════════════════

/**
 * ON_DISCARD_FROM_HAND 效果函式型別。
 * @param state    當前 GameState（已扣除棄牌）
 * @param idx      觸發者方
 * @param pool     卡池
 * @param triggerInst 場上 trigger holder 的 CardInstance（首隻匹配的 active 或 bench）
 */
export type OnDiscardFromHandFn = (
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
  triggerInst: CardInstance,
) => GameState;

/**
 * ON_HAND_ACTIVATE 效果函式型別。
 * @param state    當前 GameState（手牌中此卡尚未移除）
 * @param idx      觸發者方
 * @param pool     卡池
 * @param handInst 此手牌中觸發 inst（待放上備戰的本卡）
 */
export type OnHandActivateFn = (
  state: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
  handInst: CardInstance,
) => GameState;

// ════════════════════════════════════════════════════════════════════════════
// 1. 超能妙喵｜誘導之尾（H）
//
// 卡面：「在自己的回合，若從自己的手牌將 1 張『悠哉尾草棒』丟棄，則可使用 1 次。
//   選擇 1 隻對手的備戰寶可夢，與戰鬥寶可夢互換。」
//
// 引擎流程（USE_HAND_DISCARD_ABILITY engine handler）：
//   1) gate: 自方場上有「超能妙喵」+ discardIid 在 hand + 該卡名 = 「悠哉尾草棒」
//   2) 對手有 active + 對手 bench.length >= 1
//   3) 把 discardIid 從 hand 移到 discard
//   4) call ON_DISCARD_FROM_HAND_ABILITIES.get('超能妙喵')(state, idx, pool, triggerInst)
//   5) mark abilityNamesUsedThisTurn 入「誘導之尾」（每回合 1 次）
// ════════════════════════════════════════════════════════════════════════════
export const supercatExpAbility_LureTail: OnDiscardFromHandFn = (st, idx, _pool, _triggerInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];
  // 已在 engine handler gate 過；此處 fail-safe
  if (!opp.active || opp.bench.length === 0) {
    return addLog(st, '誘導之尾：對手場上無可互換目標', idx);
  }
  const s = addLog(st, '誘導之尾：選 1 隻對手備戰寶可夢與戰鬥場互換', idx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: idx,
    sourcePlayerIdx: dIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'gust-opp', // 復用既有 resolver（把選中的對手備戰換到對手戰鬥場）
  });
};

// ════════════════════════════════════════════════════════════════════════════
// 2. 火神蛾｜熱浪鱗粉（I）
//
// 卡面：「在自己的回合，若從自己的手牌將 1 張『基本【火】能量』卡丟棄，則可使用 1 次。
//   將對手的戰鬥寶可夢【灼傷】。」
//
// 引擎流程：
//   1) gate: 自方場上有「火神蛾」+ discardIid 在 hand + 該卡 = 基本【火】能量
//   2) 對手有 active + active.status !== 'burned'（避免重覆觸發已灼傷者；卡面雖無
//      但既有 PTCG 規則「相同狀態不疊加」，重蓋灼傷無意義 → gate 阻擋按鈕）
//   3) 棄 discardIid → 對手 active 灼傷
// ════════════════════════════════════════════════════════════════════════════
export const volcaronaAbility_HeatScale: OnDiscardFromHandFn = (st, idx, pool, _triggerInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];
  if (!opp.active) {
    return addLog(st, '熱浪鱗粉：對手戰鬥場無寶可夢', idx);
  }
  const targetName = pool.get(opp.active.cardId)?.name ?? '?';
  const s = addLog(st, `熱浪鱗粉：${targetName} 陷入【灼傷】`, idx);
  return updatePlayer(s, dIdx, pl =>
    pl.active ? { ...pl, active: { ...pl.active, status: 'burned' } } : pl
  );
};

// ════════════════════════════════════════════════════════════════════════════
// 3. 齒輪怪｜緊急迴轉（H）
//
// 卡面：「在自己的回合，若手牌有這張卡，且對手的場上有【2 階進化】寶可夢，
//   則可使用 1 次。將這張卡放置於備戰區。」
//
// 注意：齒輪怪本身是 Stage 1 進化（evolvesFrom = 齒輪小子），但此特性把它直接從
// 手牌放上備戰，等同基礎寶可夢的 PLAY_BASIC 路徑（特殊例外 — 卡面文義允許）。
// 此處我們把該手牌 inst 直接搬到 bench，並標記 justPlaced（防止本回合進化／攻擊路徑
// 異常）。playedFromHand 設 true 以與正常 PLAY_BASIC 一致。
//
// 引擎流程（USE_HAND_ABILITY engine handler）：
//   1) gate: cardIid 在 hand + 該卡名 = 「齒輪怪」+ 對手場上有 Stage 2
//      + 自方 bench.length < benchLimit
//   2) 從 hand 取出 → bench append（重新生成乾淨 inst flags 不必要 — 沿用 inst）
//   3) mark abilityNamesUsedThisTurn 入「緊急迴轉」（每回合 1 次）
// ════════════════════════════════════════════════════════════════════════════
export const klingerAbility_EmergencyRotate: OnHandActivateFn = (st, idx, pool, handInst) => {
  const p = st.players[idx];
  // 從 hand 中取出此 inst（呼叫端已 gate；此處 fail-safe）
  const handIdx = p.hand.findIndex(c => c.iid === handInst.iid);
  if (handIdx < 0) {
    return addLog(st, '緊急迴轉：找不到此卡（手牌異常）', idx);
  }
  const cardName = pool.get(handInst.cardId)?.name ?? '齒輪怪';
  // 把 inst 從 hand 搬到 bench；保留 evolvedFromXXX 為空（直接上場非進化）。
  // 設 playedFromHand=true 與 justPlaced=true（與 PLAY_BASIC 對齊）。
  const placed: CardInstance = {
    ...handInst,
    energyAttached: handInst.energyAttached ?? [],
    damage: 0,
    status: undefined,
    secondaryStatus: undefined,
    tertiaryStatus: undefined,
    toolAttached: undefined,
    evolvedFromStack: undefined,
    evolvedFromIid: undefined,
    evolvedThisTurn: undefined,
    abilityUsedThisTurn: undefined,
    movedToActiveThisTurn: undefined,
    playedFromHand: true,
    justPlaced: true,
  };
  const s = addLog(st, `緊急迴轉：將 ${cardName} 從手牌放置於備戰區`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => c.iid !== handInst.iid),
    bench: [...pl.bench, placed],
  }));
};

// ════════════════════════════════════════════════════════════════════════════
// 公開的 trigger holder 偵測 helpers（engine.ts gate / +page.svelte UI 用）
// ════════════════════════════════════════════════════════════════════════════

/** 場上是否有指定卡名的寶可夢（active 或 bench） */
export function hasFieldPokemonByName(player: PlayerState, name: string, pool: Map<string, Card>): boolean {
  const all = [...(player.active ? [player.active] : []), ...player.bench];
  return all.some(c => pool.get(c.cardId)?.name === name);
}

/** 找場上首隻指定卡名的寶可夢（給 effect fn 用） */
export function findFieldPokemonByName(player: PlayerState, name: string, pool: Map<string, Card>): CardInstance | undefined {
  if (player.active && pool.get(player.active.cardId)?.name === name) return player.active;
  return player.bench.find(c => pool.get(c.cardId)?.name === name);
}

/** 對手場上是否有 Stage 2 寶可夢（齒輪怪 gate 用） */
export function oppHasStage2(opp: PlayerState, pool: Map<string, Card>): boolean {
  const all = [...(opp.active ? [opp.active] : []), ...opp.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Pokemon') return false;
    // Stage 2 偵測：v3.07 採用 stage 欄位（若存在）或回退到 evolvesFrom 鏈深度。
    // 大多數 PTCG card schema 用 c.subtype === 'Stage 2' / 'Stage2' 或 c.stage 欄位。
    // 此處盡量寬容：任何 subtype 含 'Stage 2'/'Stage2'/'2 階'/'二階' 字串視為 Stage 2。
    const sub = (card.subtype ?? '') as string;
    if (typeof sub === 'string') {
      if (sub.includes('Stage 2') || sub.includes('Stage2') || sub.includes('2 階')
          || sub.includes('二階') || sub === '2階進化') {
        return true;
      }
    }
    // 回退判定：有 evolvesFrom 且該前進化卡也有 evolvesFrom（即兩階以上深度）
    if (card.evolvesFrom) {
      // 在 pool 中尋找一張名稱 = card.evolvesFrom 的卡，看其是否亦為進化（Stage 1）
      // pool 是 cardId → Card；需用 name 反查。為效能（hot path），用 iterator 找。
      for (const v of pool.values()) {
        if (v.name === card.evolvesFrom && v.evolvesFrom) {
          return true; // 此卡的前進化也有前進化 → 此卡為 Stage 2
        }
      }
    }
    return false;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// register pattern（Iron Rule 12）
//
// 本檔的兩個新 Map ON_DISCARD_FROM_HAND_ABILITIES / ON_HAND_ACTIVATE_ABILITIES
// 在 effects.ts 自身宣告（用 new Map() with entries），不在這裡 .set()。
// effect fn 由 effects.ts import 後直接放進 Map literal — 無循環依賴問題
// （effects.ts 是 leaf-ish，cards/* 都 import 它的 _shared 副本，不會 TDZ）。
//
// 仍提供空的 register 函式以維持 wave 模板一致；effects.ts 在自己 body 末端呼叫。
// ════════════════════════════════════════════════════════════════════════════

let _v3070Registered = false;

export function registerV3070DeferredWaveD(): void {
  if (_v3070Registered) return; // idempotent
  _v3070Registered = true;
  // 本波無對 effects.ts 內 Map 的 .set()；fn 由 effects.ts import 寫入 Map literal。
}
