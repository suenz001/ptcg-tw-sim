/**
 * v4.5 Phase 1：統一 defense check 架構檔
 *
 * Defense × Effect-source 矩陣 audit (v4.4999) 發現：
 *   - 既有 4 個 helper 各管一塊（resolveBenchGuard / canApplyAttackEffectToTarget /
 *     isBenchProtected / 各種 inline check）
 *   - 每個 source resolver 都必須自己決定哪些 helper 呼叫 → 容易漏（v3.9 / v4.06 /
 *     v4.19 / v4.4999 全部都是「漏 helper」hotfix 連鎖）
 *   - 光之翼散在 5+ 處 inline，沒統一管理
 *
 * 本檔提供統一入口 `canApplyEffectToTarget()` — 後續所有 source resolver 應呼叫此 helper，
 * 內部分派到對應的既有 helper。Phase 1 純 wrapper（零行為變更）。
 *
 * 詳細規劃見 docs / IRON_RULES.md Rule 16。
 */

import type { GameState, CardInstance } from './types';
import type { Card } from '$lib/cards/types';
import type { DamageKind } from './effects';
import {
  resolveBenchGuard,
  canApplyAttackEffectToTarget,
} from './effects';

/** v4.5 統一 defense 入口的回傳型別 */
export type DefenseCheckResult = { blocked: true; reason: string } | { blocked: false };

/**
 * v4.5 統一 defense check helper — 涵蓋全部 22 條 defense 卡規則。
 *
 * Source resolver 統一呼叫此 helper：
 * ```ts
 *   const guard = canApplyEffectToTarget(state, actorIdx, target, targetCard, 'attack-effect', pool);
 *   if (guard.blocked) {
 *     log('XX：' + guard.reason);
 *     return;
 *   }
 * ```
 *
 * **內部分派**：
 *   - attack-effect → canApplyAttackEffectToTarget (薄霧能量 / 皇帝之勢 / 抵抗之幕 / 全能硬殼 / 化石 等)
 *   - bench target (含 attack-damage/attack-effect/ability-effect 對備戰) → resolveBenchGuard
 *     (對戰圓形 / 球形盾牌 / 花之帷幔 / 藏隱 / 深度下潛 / 羽毛化石 / 太晶 / 中立中心 等)
 *   - ability-effect 對任意位置 → 光之翼 (超級皮可西ex 特性) inline check
 *
 * @param kind 影響類型：
 *   - 'attack-damage'：招式的數值傷害（含 weakness/resistance 計算後的最終傷害）
 *   - 'attack-effect'：招式效果（放指示物、改狀態 等非數值傷害）
 *   - 'ability-effect'：特性效果（必殺手裡劍 / 咒詛炸彈 / 揚沙 / 侵蝕詛咒 等）
 * @param options.isBench caller 已知 target 在 bench 時傳 true（用於決定是否走 resolveBenchGuard）；
 *   不傳則由 helper 內部判斷
 */
export function canApplyEffectToTarget(
  state: GameState,
  actorIdx: 0 | 1,
  target: CardInstance,
  targetCard: Card | undefined,
  kind: DamageKind,
  pool: Map<string, Card>,
  options?: {
    /** target 是否在 bench（caller 知道時應傳）；不傳會內部判斷 */
    isBench?: boolean;
  },
): DefenseCheckResult {
  // 1. 光之翼（超級皮可西ex 特性）— ability-effect 全攔
  //    卡面：「這隻寶可夢不會受到對手的寶可夢特性效果的影響。」
  //    範圍：self only (擁有此特性的寶可夢自身), kind = ability-effect ONLY
  //    v4.5：原本散在 cursed-bomb / 冰冷之帳 / etc. 5+ 處 inline，統一到此
  if (kind === 'ability-effect') {
    if (targetCard?.abilities?.some(a => a.name === '光之翼')) {
      return { blocked: true, reason: '光之翼 免疫對手特性效果' };
    }
  }

  // 2. canApplyAttackEffectToTarget — ATTACK_EFFECT_IMMUNITY map：
  //    - 薄霧能量 (energy-on-target, attack-effect)
  //    - 硬岩【鬥】能量 (energy-on-target, requireType=Fighting)
  //    - 皇帝之勢 (self-ability)
  //    - 抵抗之幕 (field-ability, targetFilter=BasicRocket)
  //    - 全能硬殼 (self-ability, special-case _v3060AttackerHasSE)
  //    - 陳舊的背蓋化石 (fossilOnField short-circuit)
  if (kind === 'attack-effect') {
    const r = canApplyAttackEffectToTarget(state, actorIdx, target, targetCard, pool);
    if (r.blocked) return r;
  }

  // 3. resolveBenchGuard — bench 目標的 defense（caller 已知或內部判定）：
  //    - 對戰圓形競技場 (Stadium, attack-effect + ability-effect)
  //    - 球形盾牌 (蟲甲聖, attack-damage + attack-effect)
  //    - 花之帷幔 (謝米, attack-damage, target 非規則寶可夢)
  //    - 藏隱 (斯魔茶, attack-damage + attack-effect)
  //    - 深度下潛 (小霞的鯉魚王, attack-damage + attack-effect)
  //    - 羽毛化石 (fossilOnField bench, attack-damage + attack-effect)
  //    - 太晶寶可夢 (caller 應只在 attack-damage 呼叫)
  //    - 中立中心競技場 (Stadium, attack-damage, attacker rule)
  //
  //    options.isBench === false 時 caller 已確定 target 在 active → 跳過 bench-only check
  if (options?.isBench !== false) {
    const r = resolveBenchGuard(state, pool, actorIdx, targetCard, kind);
    if (r.blocked) return r;
  }

  return { blocked: false };
}


/**
 * v4.5 Phase 1：Defense 卡 declarative documentation table
 *
 * 標註每張 defense 卡屬於哪個 helper 管理 + 規則範圍 + Phase 2/3 todo。
 * 本表純文件用途，Phase 2/3 可能轉成真的 dispatch table。
 *
 * 22 條 defense 規則來自 v4.4999 完成的全面 audit。
 */
export const DEFENSE_RULES_DOC = [
  // === A. Bench 全體保護（從場地 / 持有者廣播到自方所有備戰）===
  {
    card: '對戰圓形競技場',
    type: 'stadium',
    blocks: ['attack-effect', 'ability-effect'],
    scope: 'bench (雙方)',
    via: 'resolveBenchGuard / isBenchProtected',
    note: '卡面：雙方備戰不會因招式與特性的效果而被放傷害指示物（會受招式傷害）',
  },
  {
    card: '球形盾牌',
    type: 'self-ability (蟲甲聖)',
    blocks: ['attack-damage', 'attack-effect'],
    scope: 'bench (自方)',
    via: 'resolveBenchGuard / hasBugAegislashShield',
    note: '卡面：自方所有備戰不受對手寶可夢招式的傷害與效果（不含特性）',
  },
  {
    card: '花之帷幔',
    type: 'self-ability (謝米)',
    blocks: ['attack-damage'],
    scope: 'bench (自方, 非規則寶可夢)',
    via: 'resolveBenchGuard / hasFlowerVeil + attack-time snapshot (v3.892)',
    note: '卡面：自方備戰（除擁有規則的寶可夢外）不受對手招式的傷害',
  },
  {
    card: '抵抗之幕',
    type: 'field-ability (火箭隊的急凍鳥)',
    blocks: ['attack-effect'],
    scope: 'both (基礎+火箭隊)',
    via: 'canApplyAttackEffectToTarget (field-ability, BasicRocket)',
    note: '卡面：自方場上所有基礎「火箭隊的」寶可夢不受對手寶可夢招式的效果',
  },

  // === B. 持有者 bench 自保 ===
  {
    card: '藏隱',
    type: 'self-ability (斯魔茶)',
    blocks: ['attack-damage', 'attack-effect'],
    scope: 'bench (持有者自身)',
    via: 'resolveBenchGuard / _v3060BenchImmAbil',
    note: '卡面：在備戰區時不受對手寶可夢招式的傷害與效果',
  },
  {
    card: '深度下潛',
    type: 'self-ability (小霞的鯉魚王)',
    blocks: ['attack-damage', 'attack-effect'],
    scope: 'bench (持有者自身)',
    via: 'resolveBenchGuard / _v3060BenchImmAbil',
    note: '同藏隱',
  },

  // === C. 攻方寶可夢 active 自保 ===
  {
    card: '薄霧能量',
    type: 'self-energy (特殊能量)',
    blocks: ['attack-effect'],
    scope: 'both',
    via: 'canApplyAttackEffectToTarget (energy-on-target)',
  },
  {
    card: '硬岩【鬥】能量',
    type: 'self-energy (特殊能量)',
    blocks: ['attack-effect'],
    scope: 'both (僅 Fighting)',
    via: 'canApplyAttackEffectToTarget (energy-on-target, requireType=Fighting)',
  },
  {
    card: '皇帝之勢',
    type: 'self-ability (超級巨金怪ex)',
    blocks: ['attack-effect'],
    scope: 'both',
    via: 'canApplyAttackEffectToTarget (self-ability)',
  },
  {
    card: '光之翼',
    type: 'self-ability (超級皮可西ex)',
    blocks: ['ability-effect'],
    scope: 'both',
    via: 'canApplyEffectToTarget inline (v4.5 統一)',
    note: '原本散在 cursed-bomb / 冰冷之帳 等 5+ 處 inline',
  },
  {
    card: '純樸',
    type: 'attack-set-flag (鴨嘴炎獸 招式效果)',
    blocks: ['attack-effect'],
    scope: 'self only',
    via: 'TODO: immuneToEffectThisTurn flag (P2 deferred)',
    note: '招式 POST 設旗標 → 下回合自身免效果（未確認是否實裝）',
  },
  {
    card: '全能硬殼',
    type: 'self-ability (肋骨海龜)',
    blocks: ['attack-effect (with attacker SE)'],
    scope: 'self only',
    via: 'canApplyAttackEffectToTarget (self-ability + _v3060AttackerHasSE)',
    note: 'attack-damage 部分漏實裝（Phase 2 / P1 deferred）',
  },
  {
    card: '礎石之勢',
    type: 'self-ability (噬沙堡爺ex)',
    blocks: ['attack-damage (with attacker ability)'],
    scope: 'self only',
    via: 'TODO: inline main attack flow (P1 deferred)',
    note: '卡面：不受擁有特性的對手寶可夢招式的傷害',
  },
  {
    card: '神秘之盾 / 神秘石居 / 神秘守護 / 尾甲',
    type: 'self-ability (條件 0-damage)',
    blocks: ['attack-damage (vs ex/V)'],
    scope: 'self only',
    via: 'TODO: PASSIVE_DAMAGE_REDUCE 或 inline (P1 deferred)',
  },
  {
    card: '腎上腺費洛蒙',
    type: 'self-ability (沙奈朵, ON_DAMAGED 反擊)',
    blocks: ['attack-damage (擲幣)'],
    scope: 'self only',
    via: 'ON_DAMAGED hook (非本 audit 範圍)',
  },

  // === D. 道具防禦類 ===
  {
    card: '福祿果',
    type: 'self-tool',
    blocks: ['attack-effect'],
    scope: 'self only',
    via: 'TODO: canApplyAttackEffectToTarget tool-on-target (P1 deferred)',
    note: '附有此卡的寶可夢不受招式效果（受阻礙之塔影響）',
  },
  {
    card: '巧可果',
    type: 'self-tool',
    blocks: ['attack-effect'],
    scope: 'self only',
    via: 'TODO: 同福祿果',
  },

  // === E. 化石類 ===
  {
    card: '陳舊的羽毛化石',
    type: 'fossilOnField (Item)',
    blocks: ['attack-damage', 'attack-effect'],
    scope: 'bench only',
    via: 'resolveBenchGuard inline (effects.ts:352)',
  },
  {
    card: '陳舊的背蓋化石',
    type: 'fossilOnField (Item)',
    blocks: ['attack-effect'],
    scope: 'both (active + bench)',
    via: 'canApplyAttackEffectToTarget short-circuit (effects.ts:1857)',
  },

  // === F. 招式啟動類（暫時 immune flag）===
  {
    card: '躲藏 / 變硬 / 鐵壁 等',
    type: 'attack-set-flag (immuneToAllAttackThisTurn)',
    blocks: ['attack-damage'],
    scope: 'active only',
    via: 'engine.ts:3812 immuneToAllAttackThisTurn',
  },
  {
    card: '塗層攻擊 (鋁鋼橋龍)',
    type: 'attack-set-flag (immuneToBasicAttackThisTurn)',
    blocks: ['attack-damage (vs 基礎)'],
    scope: 'active only',
    via: 'engine.ts:3771 immuneToBasicAttackThisTurn',
  },

  // === 其他 stadium 防禦 ===
  {
    card: '中立中心競技場',
    type: 'stadium',
    blocks: ['attack-damage'],
    scope: 'both (attacker rule, defender 非 rule)',
    via: 'resolveBenchGuard + engine.ts:3796 wouldNeutralCenterBlock',
  },
] as const;
