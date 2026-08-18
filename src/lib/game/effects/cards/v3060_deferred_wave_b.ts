/**
 * v3.06 Deferred Wave B — 5 張免疫類 passive 特性（Group 1 / Group 3 deferred 收尾）
 *
 * 來源：先前 wave 中標 deferred 的「免疫類」passive 特性，本波集中以最少 hook
 * 擴充方式（複用 PASSIVE_IMMUNITY / ATTACK_EFFECT_IMMUNITY / resolveBenchGuard /
 * hitBenchAll）達成完整實裝，避免發明新引擎機制。
 *
 * 涵蓋本波 5 張：
 *
 *   A. 備戰整體免疫（2 張）
 *      1. 斯魔茶｜藏隱（H）           — 在備戰區時免疫對手寶可夢招式的傷害＋效果
 *      2. 小霞的鯉魚王｜深度下潛（I） — 同上條件
 *
 *      實作方式：
 *        - 在 effects.ts 的 resolveBenchGuard() 內加 self-ability gate；
 *          凡 kind='attack-damage' 或 'attack-effect'，且 targetCard 自身有
 *          『藏隱』/『深度下潛』ability → blocked。
 *        - 在 effects.ts 的 hitBenchAll() inline 加同款 self-ability skip
 *          （與太晶相同 pattern）。
 *        - 走「狙擊備戰」型招式（resolveBenchGuard caller）與「全體備戰傷害」型
 *          招式（hitBenchAll）兩條路徑都涵蓋。
 *
 *   B. 對手物品 / 支援者效果免疫（2 張，Phase 1 範圍）
 *      3. 斧牙龍｜緊張感（H）       — 對手出物品 / 支援者卡時，這隻寶可夢不受該效果
 *      4. 浩大鯨ex｜融合為雪（I）   — 同上
 *
 *      實作方式（Phase 1，影響面最大的 4 張卡）：
 *        - 提供 helper isImmuneToOppTrainer(targetInst, pool) — 判斷指定寶可夢是否
 *          帶『緊張感』或『融合為雪』。
 *        - 在以下 trainer resolver 過濾候選 pool / 移交 target 前 short-circuit：
 *            a. 老大的指令              （Gust 互換對手戰鬥位）
 *            b. 老大的指令（烏羽）      （同上變體）
 *            c. 頂尖捕捉器              （Item 版 Gust）
 *            d. 越橘的一步棋            — 卡面是「自方」放備戰，不影響對手 → 不需 gate
 *               （此處保留註解，未實作 isImmuneToOppTrainer 過濾，因卡面無對對手效果）
 *        - 直接覆蓋 hand-choose / opp-bench-choose 的 validIids，把「帶免疫特性」的
 *          對手寶可夢從候選排除（與『陳舊的鰭之化石被動』相同 pattern；後者
 *          已存在於 supporters_gust.ts L26-30）。
 *
 *      Phase 1 實作對象限定 3 張高頻 trainer（Gust 系列 + Top Catcher）。
 *      其餘對手 Item / Supporter 約 100+ 張，逐張過濾工程量過大故 deferred Phase 2，
 *      並保留 helper export 供未來逐張接入。Deferred 範圍包括但不限：
 *        - 對手手牌操控（卡娜莉 / 沙儷 等）— 不影響「對手寶可夢」自身，無需 gate
 *        - 對手能量棄置類（鎖鏈鎖喉 等）  — 部分已實裝，未來逐個檢視
 *        - 獵人狙擊（指定對手寶可夢）       [Phase 2 deferred]
 *
 *   C. 對手附特殊能量寶可夢免疫（1 張）
 *      5. 肋骨海龜｜全能硬殼（H）   — 不受對手「身上附有特殊能量」的寶可夢招式的
 *                                  傷害＋效果
 *
 *      實作方式：
 *        - PASSIVE_IMMUNITY 加一個 entry『全能硬殼』— ImmunityCheck 從 state.players[aIdx].active
 *          讀 attacker inst，掃 energyAttached 內是否有任一張特殊能量（subtype === 'Special'）。
 *          有 → 免疫該招式傷害（baseDamage = 0）。
 *        - ATTACK_EFFECT_IMMUNITY 加新 kind『attacker-has-special-energy』（self-ability 條件，
 *          但檢查的是「攻擊方身上特殊能量」），canApplyAttackEffectToTarget 內擴展實作。
 *
 * 設計：
 *   - Iron Rule 12：所有對 effects.ts 內 Map 的 .set() 都包進 register* function；
 *     由 effects.ts 自己 body 末端呼叫，避免 TDZ。
 *   - 規則 11：本檔為**全新檔案**，使用 Write 工具 OK；effects.ts 改動透過 Python pipeline。
 */

import type { CardInstance, GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  PASSIVE_IMMUNITY,
  ATTACK_EFFECT_IMMUNITY,
  type ImmunityCheck,
} from '../../effects';
// v6.204：passive 特性生效性中央述詞（v3060 → v3001 是既有合法 import 方向）
import { isAbilityHolderEffective } from './v3001_g3_wave3';

// 導出 sentinel 防止 unused import warnings
export type _v3060Sentinel = GameState | Card | CardInstance;

// ════════════════════════════════════════════════════════════════════════════
// 共用 helper — self-ability 檢查（提供給 effects.ts 的 resolveBenchGuard / hitBenchAll
// inline 使用）
// ════════════════════════════════════════════════════════════════════════════

/**
 * A1/A2 公用：targetCard 身上**目前實際生效**的「在備戰區時免疫」特性名（藏隱 / 深度下潛）。
 * 沒有、或有但已被消除 → null。
 *
 * 卡面（`abilities[].effect` 逐字，static/cards 台灣官方）：
 *   斯魔茶｜藏隱 / 小霞的鯉魚王｜深度下潛 —
 *   「只要這隻寶可夢在備戰區，不會受到對手的寶可夢招式的傷害與效果的影響。」
 *
 * 由 effects.ts 的 resolveBenchGuard / hitBenchAll inline 使用 — caller 已保證目標在備戰區。
 *
 * ⭐⭐⭐ v6.210 特性消除閘 —— 定論寫在這裡（比照 v6.209 岩石宮殿），**後續 audit 看到即可跳過**
 * ──────────────────────────────────────────────────────────────────────────
 * 這兩張與岩石宮殿（v6.209）**同型**：持有者卡面限「在備戰區」，且都是非規則的【基礎】寶可夢。
 * v6.202 曾把它們列進 test-v6202 的豁免表，理由是「結構上不可達」。v6.210 逐字讀卡 ＋
 * **行為端逐一實跑**（`scripts/test-v6210-bench-immunity-ability-nullify-gate.mjs`，
 * 每一種消除來源都建真盤面、跑完整 ATTACK，並附**正對照**證明該來源在同一盤面確實生效）：
 *
 *   持有者共 6 個印刷（全部 live H/I）：
 *     斯魔茶        SV5a 10255 / 10701、SV8a 11542 / 12332（H）
 *       supertype=Pokemon / subtype=stage='Basic' / pokemonType='Grass' / hp=30 / 無 tags
 *     小霞的鯉魚王  MC 16628、SV9a 12683（I）
 *       supertype=Pokemon / subtype=stage='Basic' / pokemonType='Water' / hp=30 /
 *       tags=['訓練家冠名'] ⇒ **非**規則寶可夢（不在 RULE_BOX_SUBTYPES、卡名不以 ex/EX 結尾）
 *
 *   七種消除來源逐一驗證（前六種＝中央閘涵蓋的 blanket 型；第七種是 ability-scoped）：
 *     ❌ 鐵荊棘ex｜初始化       — 只消「擁有規則的寶可夢」；這兩張都非規則寶可夢
 *     ❌ 火箭隊的監視塔         — 只消【無】屬性（或 fossilOnField）；這兩張是【草】/【水】
 *     ❌ 傳說的熔岩洞           — 只消**進化**寶可夢；兩張 stage 皆 'Basic'
 *     ❌ 招式版暗夜羽擊         — 中央閘限 location==='active'；持有者恆在備戰
 *     ❌ passive 振翼髮｜暗夜羽擊 — 同上，限對手**戰鬥場**
 *     ❌ 海兔獸｜黏著束縛       — 只消備戰的【2階進化】；兩張都是【基礎】
 *     ❌ 可達鴨／哥達鴨｜濕氣   — 卡面「雙方所有寶可夢的**將自己【昏厥】的效果的特性**全部消除」，
 *                                 ability-scoped（走 effects.ts 獨立那條、不進中央閘）；
 *                                 藏隱／深度下潛不是「將自己昏厥」類 ⇒ 不適用
 *   ⇒ 「今天七種都打不到」的事實判斷成立。
 *
 * 但「不可達」是一條**依賴其他卡條件**的脆弱不變式（任何一張新卡都可能推翻它），中央閘則是
 * **自我維護**的 ⇒ v6.210 定論：**仍接上中央閘**（沿用既有 `isAbilityHolderEffective`，
 * 與同檔 `isImmuneToOppTrainer` / `attackerHasSpecialEnergy` 一致），今天是保證的 no-op
 * （差分實跑 0 mismatch），明天自動涵蓋新的 blanket 型來源。**豁免表條目已移除。**
 * 絆線守衛：上述測試用「合成持有者」（把斯魔茶改成【無】屬性／2 階／規則寶可夢）反向證明
 * 這一行閘**真的會擋**，避免它退化成永遠 true 的死碼（HEAD 無閘時該測試會紅）。
 *
 * ⚠ 缺場上脈絡（state/inst/ownerIdx/pool 任一沒傳）時 **fail-open**＝維持舊行為「有特性」，
 *   與 `hasAnyEffectiveAbility`（v3001_g3_wave3.ts）同一約定；不會比接閘前更糟。
 */
export function getBenchImmunityAbilityName(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  targetInst: CardInstance | null | undefined,
  targetCard: Card | undefined,
  pool: Map<string, Card> | undefined,
): string | null {
  if (!targetCard?.abilities) return null;
  for (const a of targetCard.abilities) {
    if (a.name === '藏隱' || a.name === '深度下潛') {
      // v6.210：特性消除閘（見上方定論註解）。持有者卡面限備戰 ⇒ location 固定 'bench'。
      if (state && targetInst && ownerIdx != null && pool
        && !isAbilityHolderEffective(state, targetInst, targetCard, ownerIdx, a.name, 'bench', pool)) continue;
      return a.name;
    }
  }
  return null;
}

// ⚠ v6.210：原本另有一支只回 boolean 的 `hasBenchAttackImmunityAbility`。兩個消費點都改成
//   直接取「目前生效的特性名」（要拿名字組 log），boolean 版變成**零呼叫端** ⇒ 整支刪除
//   （v6.098／v6.099 死入口的教訓：函式還在會讓人以為還有第二條判準，實際上會漂移）。

// ════════════════════════════════════════════════════════════════════════════
// B3/B4 公用 helper — isImmuneToOppTrainer
//
// 卡面：「對手從手牌使出物品卡或者支援者卡時，這隻寶可夢不會受到那個效果的影響。」
//
// 設計：對手 trainer 解算時呼叫此 helper 過濾候選。回傳 true 代表本寶可夢對
//   對手 trainer 效果免疫（不可被指定為目標 / 不受效果）。
//
// 注意：卡面只說「對手出 trainer 卡」，並未禁止對手出該卡 — 玩家仍可使出，
//   只是無法選此寶可夢為目標（或免疫該效果）。Phase 1 由 caller 端 filter
//   候選實作，符合卡面文義。
// ════════════════════════════════════════════════════════════════════════════
export function isImmuneToOppTrainer(
  /** ⭐ v6.204：新增 state/ownerIdx —— 緊張感／融合為雪都是 passive 特性，會被消除。 */
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  targetInst: CardInstance | undefined,
  pool: Map<string, Card>,
): boolean {
  if (!targetInst) return false;
  const card = pool.get(targetInst.cardId);
  if (!card?.abilities) return false;
  // ⭐ v6.204：斧牙龍｜緊張感 = **Stage1**（⇒【傳說的熔岩洞】打得到）；
  //   浩大鯨ex｜融合為雪 = **Stage1 ＋ ex**（⇒ 熔岩洞 ＋ 鐵荊棘ex｜初始化）；
  //   兩者在戰鬥場時另有暗夜羽擊兩型。呼叫端有備戰（頂尖捕捉器/寶可夢捕捉器/反擊捕捉器）
  //   也有戰鬥位（除蟲噴霧）⇒ location 由 inst 與該玩家 active 比對而得。
  if (!state || ownerIdx == null) return false;
  const _act = state.players[ownerIdx]?.active;
  const _loc: 'active' | 'bench' = (_act && _act.iid === targetInst.iid) ? 'active' : 'bench';
  return card.abilities.some(a =>
    (a.name === '緊張感' || a.name === '融合為雪')
    && isAbilityHolderEffective(state, targetInst, card, ownerIdx, a.name, _loc, pool));
}

/** 取得擁有「對手 trainer 免疫」特性的名稱（log 文案用） */
export function getOppTrainerImmunityAbilityName(
  /** ⭐ v6.204：與 isImmuneToOppTrainer 同步（本函式目前全 src 零呼叫端）。 */
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  targetInst: CardInstance | undefined,
  pool: Map<string, Card>,
): string | null {
  if (!targetInst || !state || ownerIdx == null) return null;
  const card = pool.get(targetInst.cardId);
  if (!card?.abilities) return null;
  const _act = state.players[ownerIdx]?.active;
  const _loc: 'active' | 'bench' = (_act && _act.iid === targetInst.iid) ? 'active' : 'bench';
  for (const a of card.abilities) {
    if (a.name === '緊張感' || a.name === '融合為雪') {
      if (!isAbilityHolderEffective(state, targetInst, card, ownerIdx, a.name, _loc, pool)) continue;
      return a.name;
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// C5. 肋骨海龜｜全能硬殼
//
// 卡面：「這隻寶可夢不會受到對手的身上附有特殊能量卡的寶可夢招式的傷害與效果的影響。」
//
// 範圍：
//   - 持有者：肋骨海龜（在戰鬥場才會被對手戰鬥位寶可夢攻擊到，PASSIVE_IMMUNITY 路徑）。
//   - 條件：對手戰鬥位寶可夢身上附有任一張「特殊能量卡」（subtype === 'Special'）。
//   - 擋下：該招式的傷害（baseDamage = 0）+ 招式效果（透過 ATTACK_EFFECT_IMMUNITY）。
//
// hook 1：PASSIVE_IMMUNITY『全能硬殼』— 用 state.players[aIdx].active 取 attacker inst，
//        檢查 energyAttached 內是否有 special energy。
// hook 2：ATTACK_EFFECT_IMMUNITY『全能硬殼』+ kind='attacker-has-special-energy'
//        — canApplyAttackEffectToTarget 在 effects.ts 內擴展檢查邏輯。
// ════════════════════════════════════════════════════════════════════════════

/** 攻擊方戰鬥位是否身上附有任一張特殊能量卡。 */
export function attackerHasSpecialEnergy(
  state: GameState,
  aIdx: 0 | 1,
  pool: Map<string, Card>,
): boolean {
  const attacker = state.players[aIdx]?.active;
  if (!attacker) return false;
  return attacker.energyAttached.some(e => {
    const ec = pool.get(e.cardId);
    return ec?.supertype === 'Energy' && ec.subtype === 'Special';
  });
}

const armoredOmastarShellCheck: ImmunityCheck = (
  _attackerCard,
  _baseDamage,
  state,
  aIdx,
  pool,
  _defenderName,
) => attackerHasSpecialEnergy(state, aIdx, pool);

// ════════════════════════════════════════════════════════════════════════════
// 註冊器 — Iron Rule 12 規範：對 effects.ts 內 Map 做 .set() 必須在 effects.ts
//   body 末端透過 register fn lazy 觸發。
// ════════════════════════════════════════════════════════════════════════════
let _registered = false;

export function registerV3060DeferredWaveBPassives(): void {
  if (_registered) return;
  _registered = true;

  // C5. 肋骨海龜｜全能硬殼 — PASSIVE_IMMUNITY entry
  PASSIVE_IMMUNITY.set('全能硬殼', armoredOmastarShellCheck);

  // C5. 肋骨海龜｜全能硬殼 — ATTACK_EFFECT_IMMUNITY entry
  // 用既有 'self-ability' kind 不夠（self-ability 是檢查 targetCard 自身 ability，
  // 條件單純）— 但全能硬殼條件還包含「attacker 身上特殊能量」。我們用既有
  // 'self-ability' kind 註冊（此 ability 是 targetCard 自身的），但
  // canApplyAttackEffectToTarget 預設只看 ability 是否存在 → 會誤判（任何時候都免疫）。
  //
  // 解法：保持 self-ability kind，但在 canApplyAttackEffectToTarget 那邊加特例
  //   if (name === '全能硬殼') 額外檢查 attacker 特殊能量。
  // 已在 effects.ts 的 canApplyAttackEffectToTarget 內 inline 加 special-case；
  // 這裡仍註冊 entry 以維持 declarative 風格 + 讓 audit 工具掃描得到。
  ATTACK_EFFECT_IMMUNITY.set('全能硬殼', { kind: 'self-ability' });
}
