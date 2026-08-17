import { isAbilityHolderEffective, hasAnyEffectiveAbility } from './effects/cards/v3001_g3_wave3';
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
/**
 * ⭐ v6.196 中央述詞：「這個**場上實體** inst 身上的特性 abilityName 此刻是否生效？」
 *
 * 供所有「self-ability / field-passive 型 passive」的消費點使用（光之翼／太古防壁…）——
 * 它們原本一律手刻 `card.abilities?.some(a => a.name === 'X')`，**沒有問特性是否被消除**
 * （v6.145 的教訓：中央述詞寫好 ≠ 消費點有接）。玩家回報「【傳說的熔岩洞】沒有消除掉
 * 【護城龍｜太古防壁】」就是這一族：護城龍 stage=Stage2 是進化寶可夢，熔岩洞卡面
 * 「雙方場上所有進化寶可夢的特性全部消除。」⇒ 應消除。
 *
 * location 由 inst 是否等於該玩家 active 自動判定 —— 呼叫端自己算就會漂（active/bench
 * 判錯會讓黏著束縛/暗夜羽擊的範圍失準）。
 * ⚠ 放在 defense.ts 而非 v3001 卡檔：Check O（反向 import 白名單只准縮不准擴）——
 *   defense.ts 早已合法持有 isAbilityHolderEffective，engine/effects 也早已 import defense。
 */
export function hasEffectiveAbilityByInst(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  inst: CardInstance | null | undefined,
  pool: Map<string, Card> | undefined,
  abilityName: string,
): boolean {
  if (!state || ownerIdx == null || !inst || !pool) return false;
  const card = pool.get(inst.cardId);
  if (!card?.abilities?.some(a => a.name === abilityName)) return false;
  const act = state.players[ownerIdx]?.active;
  const loc: 'active' | 'bench' = (act && act.iid === inst.iid) ? 'active' : 'bench';
  return isAbilityHolderEffective(state, inst, card, ownerIdx, abilityName, loc, pool);
}

// v5.832：護城龍｜太古防壁 中央述詞 — 防守方(1-attackerIdx)備戰有護城龍 且 攻擊方能量單位≤2
//   → 該攻擊對防守方所有寶可夢(active+bench)不造成招式傷害。能量依攻擊宣告時 host-aware 快照
//   (_attackTimeAttackerEnergyUnits,含火箭隊/繁茂/燃火等 multi-unit;缺席退回 Infinity=不擋)。
//   統一給 engine active 主管線 / canApplyEffectToTarget / resolveBenchGuard / hitBenchAll 共用，
//   杜絕各自 inline copy 漏網（hitBenchAll 天空波/大地斷裂 曾漏）。
export function taikoBariBlocksAttackDamage(
  state: GameState, attackerIdx: 0 | 1, pool: Map<string, Card>,
): boolean {
  const defIdx = (1 - attackerIdx) as 0 | 1;
  // ⭐ v6.196：原本只比對特性名，**沒問特性此刻有沒有被消除** → 玩家回報
  //   「【傳說的熔岩洞】沒有消除掉【護城龍】的太古防壁」。護城龍 stage=Stage2（進化寶可夢），
  //   熔岩洞卡面「雙方場上所有進化寶可夢的特性全部消除。」⇒ 應消除；
  //   海兔獸｜黏著束縛（備戰區【2階進化】特性全消）同樣應消除它。改走中央述詞。
  const hasTaikoBari = state.players[defIdx].bench.some(
    b => hasEffectiveAbilityByInst(state, defIdx, b, pool, '太古防壁'),
  );
  if (!hasTaikoBari) return false;
  return (state._attackTimeAttackerEnergyUnits ?? Infinity) <= 2;
}

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
    /**
     * v5.279: 跳過 stadium-level 防護 (對戰圓形/中立中心).
     * 用於非「放指示物」類招式效果 (例: 挪動一下移動能量, 換位).
     * 卡面對戰圓形只擋「放傷害指示物」, 不擋移動能量這種招式效果.
     * v6.028：新 caller 請改用語意更精確的 counterPlacement（本旗標保留給既有 caller）。
     */
    skipStadium?: boolean;
    /**
     * v6.028【對戰圓形競技場的範圍界定】
     * 卡面：「雙方的所有備戰寶可夢，不會因對手的招式與特性的效果而【被放置傷害指示物】。」
     * → 它**只**擋「放置/移轉傷害指示物」，不擋換位、退化、丟道具/能量、回手/回牌庫、效果 KO 等。
     *
     * 本旗標讓 caller 表態「我這個效果是不是在放指示物」：
     *   true  = 是放指示物 → 對戰圓形應擋（行為與舊版相同）
     *   false = 不是放指示物 → 對戰圓形不擋（修正誤擋）
     *   未傳  = **保守視同 true（照擋）**。刻意設計成 fail-closed：漏標時維持舊行為（誤擋），
     *           玩家會看到「不受…影響」的 log 而回報；反之 fail-open 會變成無聲的公平性漏洞
     *           （攻方多打一次效果卻沒人發現）——本專案已多次因靜默 fail 吃虧。
     * ⚠只影響對戰圓形/中立中心這類 stadium 分支；球形盾牌、藏隱、化隱、太晶等各自的
     *   卡面範圍不同，完全不讀此旗標。
     */
    counterPlacement?: boolean;
  },
): DefenseCheckResult {
  // 1. 光之翼（超級皮可西ex 特性）— ability-effect 全攔
  //    卡面：「這隻寶可夢不會受到對手的寶可夢特性效果的影響。」
  //    範圍：self only (擁有此特性的寶可夢自身), kind = ability-effect ONLY
  //    v4.5：原本散在 cursed-bomb / 冰冷之帳 / etc. 5+ 處 inline，統一到此
  if (kind === 'ability-effect') {
    // ⭐ v6.196：光之翼持有者是【超級皮可西ex】(stage=Stage1 進化 + ex 規則寶可夢)
    //   → 【傳說的熔岩洞】(進化全消) 與【鐵荊棘ex｜初始化】(規則寶可夢全消) 都應消除它。
    //   原本只比對特性名 ⇒ 同 太古防壁 的漏 gate。改走中央述詞（location 自動判定）。
    const _msIdx = (1 - actorIdx) as 0 | 1;
    if (hasEffectiveAbilityByInst(state, _msIdx, target, pool, '光之翼')) {
      return { blocked: true, reason: '光之翼 免疫對手特性效果' };
    }
  }

  // 1b. 化隱（v4.84 / M5 — 斯魔茶 / 來悲粗茶 / 怨影娃娃 / 詛咒娃娃）
  //     卡面：「這隻寶可夢不會受到對手的招式或特性的效果。」
  //     範圍：active + bench 全場；擋 attack-effect + ability-effect；不擋 attack-damage。
  //     注意：跟舊 v3.06「藏隱」名稱相近但機制不同（藏隱是 bench-only + 含招式傷害）。
  if (kind === 'attack-effect' || kind === 'ability-effect') {
    if (targetCard?.abilities?.some(a => a.name === '化隱')) {
      // v5.224：target 在對手戰鬥場時若被振翼髮暗夜羽擊壓制 → 化隱失效
      const dIdxHy = (1 - actorIdx) as 0 | 1;
      const defActHy = state.players[dIdxHy].active;
      const locHy: 'active' | 'bench' = (defActHy && defActHy.iid === target.iid) ? 'active' : 'bench';
      if (isAbilityHolderEffective(state, target, targetCard, dIdxHy, '化隱', locHy, pool)) {
        return { blocked: true, reason: '化隱 免疫對手招式效果與特性效果' };
      }
    }
  }

  // 1b-2. v5.333：per-turn 招式免疫旗標納入 per-target guard（原本只靠 engine ATTACK_POST
  //   blanket short-circuit 整段跳過，會誤殺「目標非我方戰鬥位」的效果 — self/備戰snipe/
  //   對手手牌牌庫/競技場 等）。改為精準：只擋「指向持有此旗標的寶可夢」的招式傷害/效果。
  //   - immuneToAllAttackThisTurn（飛翔/要害斬/躲藏「不受傷害與效果」）→ 擋 attack-damage + attack-effect
  //   - immuneToAttackEffectsThisTurn（純樸「不受效果」）→ 只擋 attack-effect
  //   - immuneToExAttackThisTurn（阿塞蘿拉的惡作劇「不受 ex 招式傷害與效果」）→ attacker 為規則寶可夢時擋兩者
  if (kind === 'attack-damage' || kind === 'attack-effect') {
    if (target.immuneToAllAttackThisTurn) {
      return { blocked: true, reason: '免疫招式的傷害與效果（飛翔/要害斬/躲藏類）' };
    }
    // v5.441 鐵壁/棉花之翼類 — 只免「招式傷害」(attack-damage)，招式效果照常。
    if (kind === 'attack-damage' && target.immuneToAttackDamageThisTurn) {
      return { blocked: true, reason: '免疫招式的傷害（鐵壁/棉花之翼類，效果照常）' };
    }
    if (target.immuneToExAttackThisTurn) {
      const atkActive = state.players[actorIdx].active;
      const atkCard = atkActive ? pool.get(atkActive.cardId) : undefined;
      if (atkCard && isRulePokemon(atkCard)) {
        return { blocked: true, reason: '免疫【ex】招式的傷害與效果（阿塞蘿拉的惡作劇）' };
      }
    }
  }
  if (kind === 'attack-effect' && target.immuneToAttackEffectsThisTurn) {
    return { blocked: true, reason: '免疫招式的效果（純樸類）' };
  }

  // 1b-3. v5.828：防護代碼(immuneToExAttackTagThisTurn)/塗層攻擊·閃光射線(immuneToBasicAttackThisTurn)
  //   — per-instance 本回合「招式傷害」免疫，隨寶可夢存在於 active 或 bench（END_TURN promote 同套
  //   active+bench；防護代碼卡面涵蓋自己「所有」未來寶可夢=含備戰）。原僅 engine 主管線(active) +
  //   resolveActiveAttackGuard（本函式 step4 isBench===false）查 → 對 BENCH 目標的 ex/基礎 狙擊漏免疫。
  //   移到此層與其他 per-turn 旗標並列，涵蓋 active+bench。皆傷害型（卡面「不受…招式的傷害」），不擋 attack-effect。
  if (kind === 'attack-damage') {
    const _atkInstPT = state.players[actorIdx].active;
    const _atkCardPT = _atkInstPT ? pool.get(_atkInstPT.cardId) : undefined;
    if (_atkCardPT) {
      // 防護代碼 — 任意 ex（不限 tag）
      if (target.immuneToExAttackTagThisTurn && isRulePokemon(_atkCardPT)) {
        return { blocked: true, reason: '防護代碼免疫【ex】寶可夢招式傷害' };
      }
      // 塗層攻擊/閃光射線 — 【基礎】寶可夢招式傷害（皇冠蛋白石【無】除外）
      if (target.immuneToBasicAttackThisTurn) {
        const _stagePT = _atkCardPT.stage ?? _atkCardPT.subtype;
        const _clessPT = target.basicImmuneColorlessExcept && _atkCardPT.pokemonType === 'Colorless';
        if (_stagePT === 'Basic' && !_clessPT) {
          return { blocked: true, reason: '塗層攻擊免疫【基礎】寶可夢招式傷害' };
        }
      }
      // v5.885 瘋狂拒絕 — 不受「古代」寶可夢(attacker tags 含'古代')招式傷害
      if (target.immuneToAncientAttackThisTurn && (_atkCardPT.tags?.includes('古代'))) {
        return { blocked: true, reason: '瘋狂拒絕免疫「古代」寶可夢招式傷害' };
      }
    }
  }

  // 1c. 暗影【惡】能量（v4.85 / M5 — 特殊能量，備戰位免疫對手招式傷害；惡屬性寶可夢限定）
  //     卡面：「附有這張卡的惡屬性寶可夢只要在備戰區，就不會受到對手招式的傷害。」
  //     範圍：bench-only + attack-damage only；不擋 attack-effect、不擋 ability-effect。
  //     v4.871：加 target 屬性 gate — 僅當 targetCard.pokemonType === 'Darkness'
  //                   時才觸發（之前非惡屬性附了也免疫，違反卡面）。
  //     v5.022：rename '暗影惡能量' → '暗影【惡】能量'（卡面排版對齊既有特殊能量規律）
  //     檢測：iterate target.energyAttached → pool 查名稱 === '暗影【惡】能量'
  //     注意：caller 必須傳 options.isBench === true 才會觸發（active 時不觸發）。
  if (kind === 'attack-damage' && options?.isBench === true && targetCard?.pokemonType === 'Darkness') {
    const hasShadowDark = target.energyAttached.some(e => {
      const ec = pool.get(e.cardId);
      return ec?.name === '暗影【惡】能量';
    });
    if (hasShadowDark) {
      return { blocked: true, reason: '暗影【惡】能量 備戰免疫對手招式傷害（惡屬性限定）' };
    }
  }

  // 1d. 太鼓防壁（v4.891 / M5 — 護城龍 passive bench-aura defense）
  //     卡面：「只要這隻寶可夢在備戰區，自己場上所有寶可夢不會受到身上附加能量為
  //            2 個以下的對手寶可夢的招式傷害。」
  //     範圍：attack-damage only；對 active 由 engine.ts 主路徑 inline check 處理；
  //            對 bench (snipe) 由本處統一 helper check 處理。
  //     gate：defender 側 bench 有 護城龍 + 攻擊方 active 能量卡張數 ≤ 2。
  // 1d. 太古防壁（護城龍）— v5.832 收斂到中央述詞（active+bench 全 attack-damage 範圍）。
  if (kind === 'attack-damage' && taikoBariBlocksAttackDamage(state, actorIdx, pool)) {
    const energyUnits = state._attackTimeAttackerEnergyUnits ?? Infinity;
    return { blocked: true, reason: `太鼓防壁 免疫能量 ${energyUnits} 個（≤2）的對手招式傷害` };
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
  //
  //    v5.062 防呆：caller 沒傳 isBench 時，用 target.iid 自動判 — 若 target 是
  //    對手 active，跳過 bench-only defense（避免對戰圓形競技場/球形盾牌 等
  //    bench-only 規則誤套用到戰鬥位目標）。
  //    起源：m5_preview.ts 抹茶旋濺/靈魂終結 caller 沒傳 isBench，對手戰鬥位被
  //    對戰圓形誤擋 → 抹茶旋濺打不到戰鬥位 ( v5.062 玩家回報 bug)。
  //    這個 internal-fallback 設計成「caller 漏傳時自動正確判斷」，但 caller
  //    若明確傳 isBench: false/true 仍以 caller 為主。
  let effectiveIsBench = options?.isBench;
  if (effectiveIsBench === undefined) {
    const defIdx = (1 - actorIdx) as 0 | 1;
    const defActive = state.players[defIdx].active;
    if (defActive && defActive.iid === target.iid) {
      effectiveIsBench = false;
    }
  }
  if (effectiveIsBench !== false) {
    const r = resolveBenchGuard(state, pool, actorIdx, targetCard, kind, { targetInst: target, counterPlacement: options?.counterPlacement });
    if (r.blocked) {
      // v5.279: skipStadium=true 時跳過「對戰圓形」(stadium-level), 其他個別寶可夢級防護維持
      const isStadiumReason = r.reason === '對戰圓形競技場效果' || r.reason === '中立中心競技場 效果';
      if (!(options?.skipStadium && isStadiumReason)) return r;
    }
  }

  // 4. v4.975：active target 招式傷害 — 統一 8 個 active-side immune flag
  //    （飛翔 / 要害斬 / 阿塞蘿拉 / 中立中心 / 精神防護 / 閃光屏障 / 熔岩牆 / 防護代碼 / 塗層攻擊）
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
 * v5.555 收斂：招式效果動「對手戰鬥位寶可夢」前的免疫閘門（單一來源）。
 *
 * inline 招式效果（戲法舞步搬能量 / 反轉之風能量回手 等）在「搬移／丟棄／改附對手戰鬥位
 * 能量・改狀態」前必呼叫，走 canApplyEffectToTarget('attack-effect') 收斂全部招式效果免疫
 * 來源（薄霧能量 / 硬岩【鬥】能量 / 純樸 / 化隱 / 阿塞蘿拉 / 飛翔等 per-turn 旗標…）。
 *
 * 背景：此類 inline 開 pendingSelection 在 ATTACK_POST sweep 之後才結算，sweep 還原機制
 * （只還原 status/封退/封招、不還原能量）救不到 → 必須在效果發動前 gate。
 *
 * blocked=true 時 caller 應 `return addLog(state, '<招式>：' + r.reason, aIdx)` 不做效果。
 */
export function isOppActiveImmuneToAttackEffect(
  state: GameState,
  actorIdx: 0 | 1,
  pool: Map<string, Card>,
): DefenseCheckResult {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return { blocked: false };
  return canApplyEffectToTarget(state, actorIdx, da, pool.get(da.cardId), 'attack-effect', pool, { isBench: false });
}


/**
 * v4.975: 統一 active target 招式傷害守護 helper。
 * 
 * **為什麼需要**：engine.ts 主路徑（約 line 3870-4000）已 inline check 11 個 active-side
 * immune flag（飛翔/要害斬/阿塞蘿拉/中立中心/精神防護/閃光屏障/熔岩牆/防護代碼/
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

  // 1. 防護代碼（密勒頓）— 卡面「寶可夢【ex】招式」=任意 ex（不限 tag；v5.828 修）；
  //    flag 只設在受保護的「未來」寶可夢身上，故只需判 attacker 是規則寶可夢(ex)。
  if (defender.immuneToExAttackTagThisTurn && isRulePokemon(attackerCard)) {
    return { blocked: true, reason: '防護代碼免疫【ex】寶可夢招式傷害' };
  }

  // 2. 塗層攻擊（鋁鋼橋龍）— 不受【基礎】寶可夢招式
  if (defender.immuneToBasicAttackThisTurn) {
    const stage = attackerCard.stage ?? attackerCard.subtype;
    // v5.338：皇冠蛋白石「【無】寶可夢除外」— companion 在時，【無】屬攻擊者放行
    const colorlessExcept = defender.basicImmuneColorlessExcept && attackerCard.pokemonType === 'Colorless';
    if (stage === 'Basic' && !colorlessExcept) {
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
  // v6.049：攻擊方特性被消除（監視塔/初始化/暗夜羽擊/黏著束縛）時就不是「擁有特性的寶可夢」
  if (defender.immuneToAbilityPokemonThisTurn
      && hasAnyEffectiveAbility(state, state.players[actorIdx].active, attackerCard, actorIdx, 'active', pool)) {
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

  // 8. 熔岩牆（席多藍恩 M5）— 不受【灼傷】attacker 招式
  if (defender.immuneToBurnedAttackerThisTurn) {
    const attacker = state.players[actorIdx].active;
    if (attacker && (attacker.status === 'burned' || attacker.secondaryStatus === 'burned' || attacker.tertiaryStatus === 'burned')) {
      return { blocked: true, reason: '熔岩牆免疫【灼傷】寶可夢招式傷害' };
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
    // v6.028 對齊卡面：只擋「放置/移轉傷害指示物」那一類效果，不是所有招式/特性效果。
    //   由 canApplyEffectToTarget 的 counterPlacement 旗標區分（未傳=保守照擋）。
    blocks: ['attack-effect(僅放指示物)', 'ability-effect(僅放指示物)'],
    scope: 'bench (雙方)',
    via: 'resolveBenchGuard / isBenchProtected + counterPlacement 旗標',
    note: '卡面：雙方備戰不會因招式與特性的效果而被放傷害指示物（會受招式傷害）。'
        + 'v6.028 前誤擋換位/退化/丟道具/bounce/效果KO（玩家回報：對戰圓形在場時鐵掌力士抓不到備戰）',
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
