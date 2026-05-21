/**
 * Defense 統一架構檔（v4.5 Phase 1 引入，v4.59 補完文件）
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 【為什麼需要這個檔案】
 * ════════════════════════════════════════════════════════════════════════════
 * Defense × Effect-source 矩陣 audit (v4.4999) 發現：
 *   - 既有 4 個 helper 各管一塊（resolveBenchGuard / canApplyAttackEffectToTarget /
 *     isBenchProtected / 各種 inline check）
 *   - 每個 source resolver 都必須自己決定哪些 helper 呼叫 → 容易漏（v3.9 / v4.06 /
 *     v4.19 / v4.4999 全部都是「漏 helper」hotfix 連鎖）
 *   - 光之翼散在 5+ 處 inline，沒統一管理
 *   - v4.54 / v4.57 / v4.58 反覆踩「kind 弄錯」雷（attack-damage 卡誤用 attack-effect helper）
 *
 * 本檔提供統一入口 `canApplyEffectToTarget()` — 所有新 source resolver 必須呼叫此 helper
 * （IRON_RULES.md Rule 17 強制），內部分派到對應的 helper。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 【新 source resolver 怎麼用】
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   import { canApplyEffectToTarget } from '../../defense';
 *
 *   const guard = canApplyEffectToTarget(state, aIdx, target, targetCard, kind, pool, { isBench });
 *   if (guard.blocked) {
 *     return addLog(state, `${label}：${targetCard?.name ?? '?'} ${guard.reason}`, aIdx);
 *   }
 *   // 此處才可以 += damage / 放指示物 / 改狀態 / KO
 *
 * 【kind 對齊 JSON 卡面 cheat sheet】
 *
 *   JSON 卡面寫法                            kind
 *   ─────────────────────────────────────   ────────────────
 *   「N 點傷害」+「備戰不計弱抗」           'attack-damage'
 *   「放置 N 個傷害指示物」                  'attack-effect'
 *   「【睡眠/中毒/灼傷/麻痺/混亂】」         'attack-effect'
 *   「【昏厥】」(招式內)                     'attack-effect'
 *   「將能量卡丟棄/回手」(招式內)            'attack-effect'
 *   特性內任何效果（必殺手裡劍/咒詛炸彈 等） 'ability-effect'
 *
 * 【isBench 判定】
 *   - 已知 target 是 bench 寶可夢 → true
 *   - 已知 target 是 active → false
 *   - 不確定 → 省略（helper 內部 fallback 判斷）
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 【內部 dispatch 順序】 — caller 不用管，這是 defense.ts 內部知識
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. ability-effect → 光之翼（超級皮可西ex 特性，self-only，active+bench 都擋）
 *   2. attack-effect → ATTACK_EFFECT_IMMUNITY map
 *      - 薄霧能量（energy-on-target）
 *      - 硬岩【鬥】能量（energy-on-target, requireType=Fighting）
 *      - 皇帝之勢（self-ability，帝王拿波ex）
 *      - 抵抗之幕（field-ability，targetFilter=BasicRocket）
 *      - 全能硬殼（self-ability + attacker 有特殊能量）
 *      - 陳舊的背蓋化石（fossilOnField short-circuit）
 *   3. bench target (isBench=true) → resolveBenchGuard
 *      - 對戰圓形競技場（Stadium, attack-effect + ability-effect）
 *      - 球形盾牌（蟲甲聖, attack-damage + attack-effect）
 *      - 花之帷幔（謝米, attack-damage, target 非規則寶可夢）
 *      - 藏隱（斯魔茶, attack-damage + attack-effect）
 *      - 深度下潛（小霞的鯉魚王, attack-damage + attack-effect）
 *      - 羽毛化石（fossilOnField bench, attack-damage + attack-effect）
 *      - 太晶寶可夢（attack-damage only, 不擋 effect）
 *      - 中立中心競技場（attack-damage, attacker rule）
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 【舊 callers (~30 處) 為什麼不一起遷移】
 * ════════════════════════════════════════════════════════════════════════════
 * v4.58 audit 確認舊 callers 用法都正確（沒 kind 弄錯）。
 * 動 effects.ts (74 萬 byte 大檔案) 30+ 處 anchor patch 風險不低，純架構統一沒 user-visible 效益。
 * → 留著不動，但舊 helper 已加 @deprecated JSDoc，新 caller 寫到 import 會看到刪除線提醒。
 *
 * 詳細規則見 IRON_RULES.md Rule 17。
 */

import type { GameState, CardInstance } from './types';
import type { Card } from '$lib/cards/types';
import type { DamageKind } from './effects';
import {
  resolveBenchGuard,
  canApplyAttackEffectToTarget,
  // v4.975: resolveActiveAttackGuard 內部需要這兩個 helper
  wouldNeutralCenterBlock,
  isRulePokemon,
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

  // 1b. 化隱（v4.84 / M5 — 斯魔茶 / 來悲粗茶 / 怨影娃娃 / 詛咒娃娃）
  //     卡面：「這隻寶可夢不會受到對手的招式或特性的效果。」
  //     範圍：active + bench 全場；擋 attack-effect + ability-effect；不擋 attack-damage。
  //     注意：跟舊 v3.06「藏隱」名稱相近但機制不同（藏隱是 bench-only + 含招式傷害）。
  if (kind === 'attack-effect' || kind === 'ability-effect') {
    if (targetCard?.abilities?.some(a => a.name === '化隱')) {
      return { blocked: true, reason: '化隱 免疫對手招式效果與特性效果' };
    }
  }

  // 1c. 暗影惡能量（v4.85 / M5 — 特殊能量，備戰位免疫對手招式傷害；惡屬性寶可夢限定）
  //     卡面：「附有這張卡的惡屬性寶可夢只要在備戰區，就不會受到對手招式的傷害。」
  //     範圍：bench-only + attack-damage only；不擋 attack-effect、不擋 ability-effect。
  //     v4.871 修正：加 target 屬性 gate — 僅當 targetCard.pokemonType === 'Darkness'
  //                   時才觸發（之前非惡屬性附了也免疫，違反卡面）。
  //     檢測：iterate target.energyAttached → pool 查名稱 === '暗影惡能量'
  //     注意：caller 必須傳 options.isBench === true 才會觸發（active 時不觸發）。
  if (kind === 'attack-damage' && options?.isBench === true && targetCard?.pokemonType === 'Darkness') {
    const hasShadowDark = target.energyAttached.some(e => {
      const ec = pool.get(e.cardId);
      return ec?.name === '暗影惡能量';
    });
    if (hasShadowDark) {
      return { blocked: true, reason: '暗影惡能量 備戰免疫對手招式傷害（惡屬性限定）' };
    }
  }

  // 1d. 太鼓防壁（v4.891 / M5 — 護城龍 passive bench-aura defense）
  //     卡面：「只要這隻寶可夢在備戰區，自己場上所有寶可夢不會受到身上附加能量為
  //            2 個以下的對手寶可夢的招式傷害。」
  //     範圍：attack-damage only；對 active 由 engine.ts 主路徑 inline check 處理；
  //            對 bench (snipe) 由本處統一 helper check 處理。
  //     gate：defender 側 bench 有 護城龍 + 攻擊方 active 能量卡張數 ≤ 2。
  if (kind === 'attack-damage') {
    const defIdx = (1 - actorIdx) as 0 | 1;
    const defender = state.players[defIdx];
    const hasTaikoBari = defender.bench.some(b => {
      const c = pool.get(b.cardId);
      return c?.abilities?.some(a => a.name === '太鼓防壁');
    });
    if (hasTaikoBari) {
      const attacker = state.players[actorIdx];
      if (attacker.active && attacker.active.energyAttached.length <= 2) {
        return { blocked: true, reason: `太鼓防壁 免疫附加能量 ${attacker.active.energyAttached.length} 張（≤2）的對手招式傷害` };
      }
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

  // 4. v4.975：active target 招式傷害 — 統一 8 個 active-side immune flag
  //    （飛翔 / 要害斬 / 阿塞蘿拉 / 中立中心 / 精神防護 / 閃光屏障 / 熔岩之壁 / 防護代碼 / 塗層攻擊）
  //    僅在 isBench === false 時觸發（caller 明確指明 target 在 active）。
  //    engine.ts 主路徑已 inline 跑這些 check（zero-behavior change 在那邊）；
  //    本 step 是給多目標 resolver（如 clone-strike-multi-hit）統一用。
  if (kind === 'attack-damage' && options?.isBench === false) {
    const defenderSide = state.players[(1 - actorIdx) as 0 | 1];
    // 防呆：caller 傳 isBench=false 但 target 已不在 active（例如 loop 中 active 被 KO）
    if (defenderSide.active && defenderSide.active.iid === target.iid) {
      const attackerInst = state.players[actorIdx].active;
      const attackerCard = attackerInst ? pool.get(attackerInst.cardId) : undefined;
      const r = resolveActiveAttackGuard(state, actorIdx, attackerCard, target, targetCard, pool);
      if (r.blocked) return r;
    }
  }

  return { blocked: false };
}


/**
 * v4.975: 統一 active target 招式傷害守護 helper。
 * 
 * **為什麼需要**：engine.ts 主路徑（約 line 3870-4000）已 inline check 11 個 active-side
 * immune flag（飛翔/要害斬/阿塞蘿拉/中立中心/精神防護/閃光屏障/熔岩之壁/防護代碼/
 * 塗層攻擊/太鼓防壁/弱點失效），但**多目標 / snipe resolver**（如 clone-strike-multi-hit
 * = 分身連打 / 大吼大叫 / 三色炮）完全繞過這段，導致玩家回報「飛翔正面後仍受分身連打傷害」bug。
 * 
 * 此 helper 集中這些 flag check，給多目標 resolver 用：
 *   - 透過 canApplyEffectToTarget（kind='attack-damage' + isBench=false）自動呼叫
 *   - 或直接呼叫（如果 caller 需要拆細 control flow）
 * 
 * **不取代 engine 主路徑** — engine 主路徑 v2.x 累積長期 stable，本 helper 邏輯一致即可
 * （短期接受 code duplication 換取穩定性，未來 Phase 3 可重構主路徑也用此 helper）。
 * 
 * **太鼓防壁** 已在 canApplyEffectToTarget step 1d（attack-damage 全範圍）統一處理，
 * 此 helper 不重複 check（避免 double-block）。
 * 
 * @param state 目前狀態（用於讀 attacker.status 判定灼傷）
 * @param actorIdx 攻擊方 player index
 * @param attackerCard 攻擊方寶可夢卡面 — 缺失時不擋（保守，e.g. 場地扣血類非招式來源）
 * @param defender 受擊方 CardInstance（含 flag fields）
 * @param defenderCard 受擊方卡面（用於中立中心 isRulePokemon 判定）
 * @param pool 卡片 pool（用於中立中心 + 太鼓防壁查詢場地/特性）
 */
export function resolveActiveAttackGuard(
  state: GameState,
  actorIdx: 0 | 1,
  attackerCard: Card | undefined,
  defender: CardInstance,
  defenderCard: Card | undefined,
  pool: Map<string, Card>,
): DefenseCheckResult {
  // attackerCard 缺失（非招式來源 damage，如 場地扣血 / 中毒 tick）→ 不擋
  if (!attackerCard) return { blocked: false };

  // 1. 防護代碼（密勒頓）— defender 有 immuneToExAttackTag + attacker 是 ex + 有對應 tag
  const exTag = defender.immuneToExAttackTagThisTurn;
  if (exTag && isRulePokemon(attackerCard) && attackerCard.tags?.includes(exTag)) {
    return { blocked: true, reason: `防護代碼免疫帶「${exTag}」tag 的 ex 招式傷害` };
  }

  // 2. 塗層攻擊（鋁鋼橋龍）— 不受【基礎】寶可夢招式
  if (defender.immuneToBasicAttackThisTurn) {
    const stage = attackerCard.stage ?? attackerCard.subtype;
    if (stage === 'Basic') {
      return { blocked: true, reason: '塗層攻擊免疫【基礎】寶可夢招式傷害' };
    }
  }

  // 3. 阿塞蘿拉的惡作劇 — 不受 ex 招式（卡面同時涵蓋傷害+效果；本 helper 只負責傷害部分）
  if (defender.immuneToExAttackThisTurn && isRulePokemon(attackerCard)) {
    return { blocked: true, reason: '阿塞蘿拉的惡作劇免疫 ex 招式傷害' };
  }

  // 4. 中立中心競技場 — 非規則 defender 不受對手 ex/V 招式
  if (wouldNeutralCenterBlock(state, pool, attackerCard, defenderCard)) {
    return { blocked: true, reason: '中立中心競技場免疫規則寶可夢招式傷害' };
  }

  // 5. 精神防護（代歐奇希斯）— 不受擁有特性的寶可夢招式（attacker 有 abilities 陣列非空）
  if (defender.immuneToAbilityPokemonThisTurn && attackerCard.abilities && attackerCard.abilities.length > 0) {
    return { blocked: true, reason: '精神防護免疫擁有特性的寶可夢招式傷害' };
  }

  // 6. 要害斬（具甲武者）/ 飛翔（喇叭啄鳥）等 — 完全免疫（傷害+效果）
  if (defender.immuneToAllAttackThisTurn) {
    return { blocked: true, reason: '完全免疫招式（要害斬 / 飛翔 等效果）' };
  }

  // 7. 閃光屏障（雷電獸 M5）— 不受進化寶可夢招式
  if (defender.immuneToEvolutionAttackThisTurn) {
    const stage = attackerCard.stage ?? attackerCard.subtype;
    const isEvo = stage === 'Stage1' || stage === 'Stage2' || !!attackerCard.evolvesFrom;
    if (isEvo) {
      return { blocked: true, reason: '閃光屏障免疫進化寶可夢招式傷害' };
    }
  }

  // 8. 熔岩之壁（席多藍恩 M5）— 不受【灼傷】attacker 招式
  if (defender.immuneToBurnedAttackerThisTurn) {
    const attacker = state.players[actorIdx].active;
    if (attacker && (attacker.status === 'burned' || attacker.secondaryStatus === 'burned')) {
      return { blocked: true, reason: '熔岩之壁免疫【灼傷】寶可夢招式傷害' };
    }
  }

  // 注意：太鼓防壁（active path）由 canApplyEffectToTarget step 1d 統一處理（全 attack-damage 範圍）
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
