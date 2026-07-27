/**
 * PTCG 規則型 AI
 *
 * getAIAction(state, pool) → 下一個應執行的 GameAction，或 null（代表無事可做）
 *
 * 策略優先序：
 *  1. 取獎賞卡
 *  2. 解析待選擇（自動選最佳）
 *  3. 送出新出場（被擊倒後）
 *  4. 主階段：進化 → 打基礎備戰 → 附能量 → 打訓練家 → 使用特性 → 攻擊 → 結束
 */

import type { Card, EnergyType } from '$lib/cards/types';
import type { GameState, GameAction, CardInstance, PendingSelection, PlayerState } from './types';
import {
  getAvailableAttacks, getEffectiveAttacks, getEvolvableTargets,
  getPlayableTrainers, getPlayableBasics,
  getUsableAbilities, canRetreat, isBasicPokemonCard,
  canBeInitialActiveCard, isRulePokemon,
  getEffectiveHP, canAffordAttack, isBasicEnergyOfType, getBasicEnergyType,
} from './engine';
// v4.949 Phase 2a：能量分配 role-aware
import { findMainAttackers } from './ai-roles';
import { evaluateSelectionFilter, isKnownSelectionFilter } from './selection-filter'; // v6.013/6.016 P1-1:deck-search/hand-discard/discard-search filter 中央求值器
// v6.038 批次4b：AI 打法表（離線由高勝率對局整理出的策略表）。載入與適用判定都在 ai-playbook.ts，
//   這裡只做**同步查詢**——getAIAction 是同步的，不能在決策路徑做 fetch。
//   ⚠沒有表時所有查詢一律回 0/false，決策與接線前**完全等價**（有守衛以自對局逐步比對證明）。
import { getPlaybook, benchScoreOf } from './ai-playbook';

// ── 主要入口 ──────────────────────────────────────────────────────────────────

export function getAIAction(
  state: GameState,
  pool: Map<string, Card>,
  myIdx: 0 | 1 = state.activePlayerIndex
): GameAction | null {
  if (state.phase === 'game-over') return null;

  // ── Setup 階段：使用 AI 自己的 index（雙方同時操作） ─────────────────────
  if (state.phase === 'setup') {
    return handleSetupAI(state, pool, myIdx);
  }
  if (state.phase !== 'playing') return null;

  // ── 以下動作無論是否輪到我，只要「是我要做的」就要處理 ───────────────
  // 1a. 待選擇必須優先解析：engine 在 pendingSelection 存在時只接受 RESOLVE_SELECTION。
  // v2.335：若 active 同時為 null（例如招式效果/反彈傷害造成自 KO，但招式還有搜牌 pending），
  //   也必須先完成 pendingSelection，再送新戰鬥寶可夢；否則 AI 會重送 SEND_NEW_ACTIVE 被 engine 拒絕。
  if (state.pendingSelection) {
    if (state.pendingSelection.actorIdx === myIdx) return autoResolveSelection(state, pool);
    return null;
  }

  // 1b. 我作為防守方，active 被擊倒 → 送新出場
  if (state.players[myIdx].active === null && state.players[myIdx].bench.length > 0) {
    return {
      type: 'SEND_NEW_ACTIVE',
      iid: pickBestActive(state.players[myIdx].bench, pool, state).iid,
      senderIdx: myIdx,
    };
  }

  // 2. 取獎賞卡（v2.98：移到 activePlayerIndex gate 之前 — owner 在對手回合也可取）
  const aiPending = state.pendingPrizes?.[myIdx] ?? 0;
  if (aiPending > 0) {
    return { type: 'TAKE_PRIZES', count: aiPending, playerIdx: myIdx };
  }

  // ── 以下只在輪到我時處理 ─────────────────────────────────────────────
  if (state.activePlayerIndex !== myIdx) return null;

  const player = state.players[myIdx];

  // 4. END 階段 → 結束回合
  if (state.turnPhase === 'end') {
    // Bug fix (#21): 席多藍恩打死喵喵ex後 — 若對手 active 為空（尚未送出新寶可夢），
    // 不能 END_TURN，否則 engine 會拒絕並讓 AI 陷入無限迴圈。
    const dIdx = (1 - myIdx) as 0 | 1;
    if (state.players[dIdx].active === null) return null;
    return { type: 'END_TURN' };
  }

  if (state.turnPhase !== 'main') return null;

  // ── 主階段決策 ───────────────────────────────────────────────────────────

  // 進化
  const evoTargets = getEvolvableTargets(state, pool);
  if (evoTargets.length > 0) {
    const t = evoTargets[0];
    return { type: 'EVOLVE', fromIid: t.fromIid, toIid: t.toIids[0] };
  }

  // 打基礎寶可夢到備戰
  // v2.142：原本 < 4 — 對「需要備戰多樣性」的牌組（N索羅亞克 / 火箭隊烏鴉頭頭 等）
  //   太保守。改為 < 5 放滿備戰，但**特別偏好「能進化」或「N/火箭隊冠名」的基礎**，
  //   讓 N 索羅亞克 暗黑底牌 / 火箭羽毛 / R指令 等「依賴備戰多寶可夢」招式更強。
  if (player.bench.length < 5) {
    const basics = getPlayableBasics(state, pool);
    if (basics.length > 0) {
      // 排序：能進化的優先 → 冠名前綴（N的/火箭隊的/竹蘭的等）優先 → HP 高優先
      const handEvolutionTargets = new Set<string>();
      for (const inst of player.hand) {
        const c = pool.get(inst.cardId);
        if (c?.supertype === 'Pokemon' && c.evolvesFrom) handEvolutionTargets.add(c.evolvesFrom);
      }
      // v6.038：打法表的備戰優先序（若這副牌有適用的表）。
      //   ⚠原本的排序只看「能不能進化」「卡名有沒有冠名前綴」「HP 高不高」——
      //     完全不知道「備戰放什麼決定了主攻手能打出什麼」。以 N的索羅亞克ex 為例：
      //     暗黑底牌是複製**備戰區「N的寶可夢」**的招式，備戰有沒有 N的捷克羅姆
      //     決定了它能不能用 2 顆惡能量打出 250（那招原本要 4 顆異色）——
      //     而捷克羅姆 HP130 在舊排序裡贏不過任何一隻高 HP 的基礎。
      const pbForBench = getPlaybook();
      const score = (iid: string): number => {
        const inst = player.hand.find(c => c.iid === iid);
        if (!inst) return 0;
        const card = pool.get(inst.cardId);
        if (!card) return 0;
        let s = card.hp ?? 0;
        if (handEvolutionTargets.has(card.name)) s += 1000; // 大幅優先能進化的
        if (/^(N的|火箭隊的|竹蘭的|阿響的|莉莉艾的|火箭隊)/.test(card.name)) s += 500; // 冠名次優先
        // 打法表分數放在最高位（×10000 蓋過上面所有項），表內未列到的卡加 0 →
        //   **沒有表時整條加法為 +0，排序與接線前逐位相同**。表只負責「拉高它在乎的卡」，
        //   其餘順序仍由原本的通用規則決定（表不需要窮舉整副牌）。
        s += benchScoreOf(pbForBench, card.name) * 10000;
        return s;
      };
      const sorted = [...basics].sort((a, b) => score(b) - score(a));
      return { type: 'PLAY_BASIC', iid: sorted[0] };
    }
  }

  // 附加能量（附到出场宝可梦，若无则附备战）
  // v2.357 修复：
  //   1. 只有在「当前没有任何招式可发」时才附能量，避免招式已够能时继续乱填。
  //   2. 选择能量时优先选「与宝可梦属性匹配」的能量，减少填错属性的问题。
  // v3.43 魔靈多龍：火/超 → 多龍系（滿 1F+1P 為止），惡 → 願增猿（1 顆），其他不填。
  if (!player.energyAttachedThisTurn && player.active) {
    if (isMarruneDragapult(player, pool)) {
      const dragapultAct = dragapultEnergyAction(state, player, pool);
      if (dragapultAct) return dragapultAct;
      // 沒目標 → 跳過附能量（不亂填）
    } else {
    const availableAttacks = getAvailableAttacks(state, pool);
    // 若已有招式可发，不附能量（能量应留给真正需要的宝可梦）
    if (availableAttacks.length > 0) {
      // 有招式可用，跳过填能量
    } else {
      // v4.949 Phase 2a: role-aware 能量分配（保守版）
      //   舊版：在 active 沒招可發時，把能量附給 active。
      //   新版：在 active 沒招可發時，優先找 bench 上有 main-attacker（heuristic
      //         分類為「主打手」的寶可夢，HP≥210 + dmg≥150 + rule-box）→ 附給它；
      //         沒主打手或主打手能量已滿（≥ maxAttackCost）→ 附 active（同舊版）。
      //
      //   效果：bench 上養主打手時不再被忽略；典型情境是 utility active（如 N 的
      //   索羅亞克ex 抽牌位）+ bench 主打手（多龍巴魯托ex），讓能量正確流向打手。
      //
      //   保守設計：findMainAttackers 找不到時 100% fallback 舊行為（附 active）。
      //   heuristic 沒覆蓋的牌組行為完全一致，避免退化風險。
      const allMyPokemon: CardInstance[] = [
        ...(player.active ? [player.active] : []),
        ...player.bench,
      ];
      const mainAttackers = findMainAttackers(allMyPokemon, null, pool);
      // 過濾「能量已滿」的主打手（避免無謂堆能量）
      const needyMains = mainAttackers.filter(inst => {
        // v5.151：朽木妖|詛咒根等鎖能量招式設 cantAttachEnergyThisTurn → 過濾，避免 AI 無限 retry
        if (inst.cantAttachEnergyThisTurn) return false;
        const card = pool.get(inst.cardId);
        if (!card?.attacks?.length) return false;
        const maxCost = Math.max(...card.attacks.map(a => a.cost?.length ?? 0));
        return inst.energyAttached.length < maxCost;
      });
      // 目標：能量最少的主打手 / fallback active
      // v5.151：fallback active 若被鎖能量，視為無 needy target，跳過 attach
      const fallbackActive = player.active && !player.active.cantAttachEnergyThisTurn ? player.active : null;
      const target: CardInstance | null = needyMains.length > 0
        ? needyMains.reduce((min, c) =>
            c.energyAttached.length < min.energyAttached.length ? c : min)
        : fallbackActive;
      if (!target) {
        // v5.151：找不到合法 attach target（active 被鎖+無 needy bench）→ 跳出 attach 邏輯進 trainer
      } else {
      const targetCard = pool.get(target.cardId);
      const targetType = targetCard?.pokemonType;
      // 从手牌中找能量：有匹配属性优先，否则随便拿一张
      const energyCandidates = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
      const energyInHand = energyCandidates.find(c => {
        const ec = pool.get(c.cardId);
        if (!ec) return false;
        // 优先选属性匹配的（target 屬性）
        return ec.pokemonType === targetType ||
          ec.name.includes(`【${targetType}】`);
      }) ?? energyCandidates[0]; // 没有匹配的就用第一张
      // v5.214 Bug 4：target 有 cantAttachEnergyThisTurn (詛咒根等) → 跳過避免 AI 死循環
      //   v5.151 已修 fire/psy/dark/dragapult fallback 3 處，這個主路徑漏修。
      if (energyInHand && !target.cantAttachEnergyThisTurn) {
        return { type: 'ATTACH_ENERGY', energyIid: energyInHand.iid, targetIid: target.iid };
      }
      } // v5.151: close target null check else block
    }
    } // close non-dragapult else
  }

  // 打訓練家（支援者先，再物品）
  const trainerIids = getPlayableTrainers(state, pool);
  if (trainerIids.length > 0) {
    const sorted = [...trainerIids].sort((a, b) => {
      const scoreOf = (iid: string) => {
        const c = pool.get(player.hand.find(h => h.iid === iid)?.cardId ?? '');
        if (c?.subtype === 'Supporter') return 10; // 支援者優先
        if (c?.supertype === 'Energy') return 0;
        return 5;
      };
      return scoreOf(b) - scoreOf(a);
    });
    return { type: 'PLAY_TRAINER', iid: sorted[0] };
  }

  // 使用主動特性（帶代價評估）
  // v2.358：AI 不能無腦用所有可用特性，必須評估「使用是否划算」。
  //   交易（N的索羅亞克ex）= 弃1抽2，淨賺1。
  //   但若：手牌已滿（>=8）或牌庫過淺（<5），使用會造成淨損失或遊戲後期風險，應跳過。
  //   其他抽牌特性同理：手牌 >= 8 或 牌庫即將見底 時應節制。
  const abilities = getUsableAbilities(state, pool);
  if (abilities.length > 0) {
    // 對每個可用特性評分；分數 <= 0 代表不該用
    const scored = abilities.map(ab => {
      const inst = [...(player.active ? [player.active] : []), ...player.bench].find(p => p.iid === ab.iid);
      const card = pool.get(ab.iid);
      let score = 10; // 預設：值得用

      // === 交易（N的索羅亞克ex）====================
      if (ab.abilityName === '交易') {
        // 手牌已滿（>= 8）：抽到也沒空間放，浪費一張
        if (player.hand.length >= 8) score = 0;
        // 牌庫 < 5：後期抽一張少一張，風險太高
        else if (player.deck.length < 5) score = 0;
      }

      // === v3.43 咒詛炸彈（魔靈多龍）— 黑夜魔靈 13 / 彷徨夜靈 5 counter ====
      if (ab.abilityName === '咒詛炸彈') {
        if (!shouldUseCursedBomb(state, myIdx, ab.abilityName, ab.pokemonName, pool)) {
          score = 0; // 沒 KO 目標也沒斷頭目標 → 不亂自爆
        }
      }

      // === v3.99 日光轉移（超級妙蛙花ex）— 妙蛙花優先策略，徹底修無限循環 ===
      // 玩家回報 v3.732 修法不夠：AI 還是會在「active（非草系）⇄ bench 厄鬼椪」之間
      // 來回搬草。根因：heal-target picker 選 damage 最多 = 0 damage 都一樣 = 第一個
      // = active → AI 把草搬到 active，下輪又從 active 搬回 bench。
      //
      // 修法：找超級妙蛙花ex inst，計算其有效草能（× 繁茂倍率），≥ 4 就停。
      // 因為妙蛙花ex 是目標（target），AI 不會把它身上的能量搬走（picker 改為優先
      // 選妙蛙花ex 當 target、避開它當 source），所以「妙蛙花ex grass ≥ 4」是穩定條件。
      if (ab.abilityName === '日光轉移') {
        const isBasicGrass = (eInst: { cardId: string }) => {
          const ec = pool.get(eInst.cardId);
          if (!ec || ec.supertype !== 'Energy' || ec.subtype !== 'Basic') return false;
          return ec.pokemonType === 'Grass' || /【草】/.test(ec.name);
        };
        const countGrass = (p: { energyAttached: { cardId: string }[] } | null) =>
          p ? p.energyAttached.filter(isBasicGrass).length : 0;
        const allMy = [player.active, ...player.bench].filter((c): c is CardInstance => !!c);
        const meAttacker = allMy.find(c => pool.get(c.cardId)?.name === '超級妙蛙花ex');
        const hasBloom = allMy.some(c =>
          pool.get(c.cardId)?.abilities?.some((a: { name: string }) => a.name === '繁茂')
        );
        const multiplier = hasBloom ? 2 : 1;
        const REQUIRED_GRASS = 4;  // 叢林拋擲 cost: GGGG (4 基本草)
        if (meAttacker) {
          const meGrass = countGrass(meAttacker) * multiplier;
          if (meGrass >= REQUIRED_GRASS) {
            // 妙蛙花ex 已滿足招式需求 → 停（picker 邏輯保證草能會搬到妙蛙花ex 而非 active）
            score = 0;
          } else {
            // 還沒滿足 — 檢查其他寶可夢（非妙蛙花）身上有沒有可搬的草能
            const otherGrass = allMy
              .filter(c => c.iid !== meAttacker.iid)
              .reduce((sum, c) => sum + countGrass(c), 0);
            if (otherGrass === 0) score = 0;  // 沒草可搬，再用也只是內耗
          }
        } else {
          // 場上沒妙蛙花ex（罕見場景 — 妙蛙花ex 在場才有此 ability）→ 走 v3.732 原邏輯
          const activeGrass = countGrass(player.active);
          const benchGrass = player.bench.reduce((sum, b) => sum + countGrass(b), 0);
          if (activeGrass >= REQUIRED_GRASS) score = 0;
          else if (benchGrass === 0) score = 0;
        }
      }

      return { ab, score };
    });

    // 選分數最高的可用特性（分數相同則用第一個）
    const best = scored.reduce((a, b) => b.score > a.score ? b : a);
    if (best.score > 0) {
      return { type: 'USE_ABILITY', iid: best.ab.iid, abilityIndex: best.ab.abilityIndex };
    }
  }

  // 攻擊（選傷害最高的）
  const atkIdxs = getAvailableAttacks(state, pool);
  if (atkIdxs.length > 0 && player.active) {
    const card = pool.get(player.active.cardId);
    // v2.214：用 effective list（含工具上寫的招式），attackIndex 對應到合併後 list
    const eff = getEffectiveAttacks(state, player.active, pool);
    // v2.141 評估招式潛在傷害 — 處理「暗黑底牌」這類複製招式
    //   原本只看 attacks[i].damage，但暗黑底牌 damage='' 會被低估為 0。
    //   改為：暗黑底牌時，跨備戰所有 N寶可夢的招式找最強 damage 作為估值。
    const estimateDamage = (atkIdx: number): number => {
      const atk = eff[atkIdx]?.atk;
      if (!atk) return 0;
      const printedDmg = parseInt(atk.damage ?? '0') || 0;
      if (printedDmg > 0) return printedDmg;
      // 暗黑底牌（N的索羅亞克ex）— 估算備戰最強招式
      if (card?.name === 'N的索羅亞克ex' && atk.name === '暗黑底牌') {
        let best = 0;
        for (const b of player.bench) {
          const bc = pool.get(b.cardId);
          if (!bc?.name?.startsWith('N的') || bc.name === 'N的索羅亞克ex') continue;
          for (const a of bc.attacks ?? []) {
            if (a.name === '暗黑底牌') continue;
            const d = parseInt(a.damage ?? '0') || 0;
            if (d > best) best = d;
          }
        }
        return best;
      }
      return 0;
    };
    const best = atkIdxs.reduce((prev, cur) => {
      return estimateDamage(cur) > estimateDamage(prev) ? cur : prev;
    });
    // v3.883：AI 對 PRE_DISCARD_CHOICE 招式自動填 discardedEnergyIids
    //   目前只 special-case 激流水泵（厄鬼椪 水井面具ex）— 對手有 bench + 自身能量 ≥ required
    //   時自動啟用 option（多 120 bench 傷害很值得）。
    //   required: 璀璨結晶 attached → 2 否則 3。
    let aiDiscardedEnergyIids: string[] | undefined;
    const bestAtk = eff[best]?.atk;
    if (bestAtk?.name === '激流水泵' && player.active) {
      const oppBench = state.players[(1 - myIdx) as 0 | 1].bench.length;
      if (oppBench > 0) {
        const atkCard = pool.get(player.active.cardId);
        const isTera = atkCard?.tags?.includes('太晶') ?? false;
        const allTools = [player.active.toolAttached, ...(player.active.extraTools ?? [])].filter(Boolean) as Array<{ cardId: string }>;
        const hasShiny = allTools.some(t => pool.get(t.cardId)?.name === '璀璨結晶');
        const required = (isTera && hasShiny) ? 2 : 3;
        if (player.active.energyAttached.length >= required) {
          aiDiscardedEnergyIids = player.active.energyAttached.slice(0, required).map(e => e.iid);
        }
      }
    }
    return aiDiscardedEnergyIids
      ? { type: 'ATTACK', attackIndex: best, discardedEnergyIids: aiDiscardedEnergyIids }
      : { type: 'ATTACK', attackIndex: best };
  }

  // 結束回合
  return { type: 'END_TURN' };
}

// ── Setup 階段 AI ─────────────────────────────────────────────────────────────

function handleSetupAI(state: GameState, pool: Map<string, Card>, pIdx: 0 | 1): GameAction | null {
  // v5.158：順序重整 — PTCG 規則：先 setup placement (PLACE_ACTIVE/BENCH/FINISH_SETUP)
  //   才看對手 mulligan reveal + 補抽決定 + mulliganPostBenchOpen flow。
  //   v5.133 修了 UI modal popup gate 但 ai.ts 沒同步，造成 AI 一進 setup 就先
  //   confirm reveal + draw + 設 mulliganPostBenchOpen=true，卻還沒 PLACE_ACTIVE。
  //   Wilson 截圖 AI 卡在 mulligan flow 之後沒進 PLACE_ACTIVE — 順序錯。
  //
  // 修法（STEP 1 → STEP 2）：
  //   STEP 1（setupDone[pIdx]=false）：placement (PLACE_ACTIVE/BENCH/FINISH_SETUP)
  //   STEP 2（setupDone[pIdx]=true） ：mulligan reveal/draw/post-bench flow
  //
  // ──── STEP 2 邏輯（setupDone[pIdx]=true 才執行） ────
  if (state.setupDone[pIdx]) {
    // v3.74：AI 自動確認對方的 mulligan 揭示（無需互動）
    if (!state.mulliganRevealConfirmed[pIdx]) {
      return { type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx: pIdx };
    }
    // Mulligan 補抽決定（v4.923）：AI 一律拿滿（補抽零風險，有的拿沒理由不拿）
    const aiPendingMulli = state.pendingMulliganDraw?.[pIdx] ?? 0;
    if (aiPendingMulli > 0) {
      return { type: 'MULLIGAN_DRAW_DECISION', count: aiPendingMulli, senderIdx: pIdx };
    }
    // v5.138：mulligan 補抽後加備戰 — AI 簡化策略，直接 FINISH（不再加備戰，
    //   因 setup 階段 AI 已盡量放 3 隻備戰，補抽後新基礎策略價值低）。
    if (state.mulliganPostBenchOpen?.[pIdx]) {
      return { type: 'FINISH_MULLIGAN_POST_BENCH', senderIdx: pIdx };
    }
    return null;
  }
  // ──── STEP 1 邏輯（setupDone[pIdx]=false → placement） ────
  const player = state.players[pIdx];

  // 先選出場（選 HP 最高的基礎；含 ex 基礎）
  if (!player.active) {
    // v5.135 / v5.148：mulligan 較多方需等對手先按準備完成 — AI 自己檢查 gate，
    //   blocked 時 return null，避免 engine reject + AI scheduler 不停 retry → log spam。
    //   v5.148：原 v5.135 gate 只擋 oppMul===0；改 myMul > oppMul 涵蓋雙方都 mulligan
    //   時較多方也要等的場景（Wilson 報告 玩家 2 / AI 3 時 AI 仍先放的 bug）。
    {
      const myMul = state.mulliganCounts?.[pIdx] ?? 0;
      const oppIdx = (1 - pIdx) as 0 | 1;
      const oppMul = state.mulliganCounts?.[oppIdx] ?? 0;
      if (myMul > oppMul && !state.setupDone[oppIdx]) {
        return null;
      }
    }
    const basics = player.hand.filter(c => isBasicPokemonCard(pool.get(c.cardId)));
    // v3.43 魔靈多龍：含羞苞優先擺戰鬥場（用癢癢花粉爭取多龍進化時間）
    if (basics.length > 0 && isMarruneDragapult(player, pool)) {
      const sweetVeil = basics.find(c => pool.get(c.cardId)?.name === '含羞苞');
      if (sweetVeil) return { type: 'PLACE_ACTIVE', iid: sweetVeil.iid, senderIdx: pIdx };
    }
    if (basics.length > 0) {
      const best = basics.reduce((a, b) =>
        (pool.get(a.cardId)?.hp ?? 0) >= (pool.get(b.cardId)?.hp ?? 0) ? a : b
      );
      return { type: 'PLACE_ACTIVE', iid: best.iid, senderIdx: pIdx };
    }
    // v3.59：沒有基礎寶可夢時，fallback 用「可作為起始戰鬥寶可夢」的卡（閃焰王牌瞬間爆發力）
    //   官方 QA：「最初抽出的 7 張手牌中沒有【基礎】寶可夢，僅有閃焰王牌，可以因特性
    //   『瞬間爆發力』的效果，將閃焰王牌放置於戰鬥場上並開始對戰」。
    //   之前 AI 卡在這裡 — basics 空 → return null → AI setup 進不下去。
    const initialActives = player.hand.filter(c => canBeInitialActiveCard(pool.get(c.cardId)));
    if (initialActives.length > 0) {
      const best = initialActives.reduce((a, b) =>
        (pool.get(a.cardId)?.hp ?? 0) >= (pool.get(b.cardId)?.hp ?? 0) ? a : b
      );
      return { type: 'PLACE_ACTIVE', iid: best.iid, senderIdx: pIdx };
    }
    // 真的沒有任何能上戰鬥場的卡 — 放棄此回合 setup（理論上 mulligan 階段已 reshuffle 排除此 case）
    return null;
  }

  // 再放備戰 — Setup 放滿手牌中的基礎寶可夢（最多 3 隻），避免 active 被秒殺就輸
  if (player.bench.length < 3) {
    const basics = player.hand.filter(c => isBasicPokemonCard(pool.get(c.cardId)));
    if (basics.length > 0) {
      return { type: 'BENCH_POKEMON', iid: basics[0].iid, senderIdx: pIdx };
    }
  }

  // 完成 setup
  return { type: 'FINISH_SETUP', senderIdx: pIdx };
}

// ── 自動解析選擇 ──────────────────────────────────────────────────────────────

function autoResolveSelection(state: GameState, pool: Map<string, Card>): GameAction {
  const sel = state.pendingSelection!;
  const actorPlayer = state.players[sel.actorIdx];
  const srcPlayer   = state.players[sel.sourcePlayerIdx];

  switch (sel.type) {
    // 牌庫搜尋
    case 'deck-search': {
      const f = sel.filter ?? '';
      let candidates = srcPlayer.deck.filter(c => {
        const card = pool.get(c.cardId);
        if (!card) return false;
        // v6.013 P1-1批2：中央 selection-filter 求值器優先(已收錄回 boolean;未收錄回 null→走下方 inline
        //   fallback,批次遷移)。這修掉 AI 對 ex/Item/Supporter/Stage1 等原本落 `return true` 全牌庫的漂移。
        const _central = evaluateSelectionFilter('deck-search', f, c, card, { params: sel.params });
        if (_central !== null) return _central;
        const top6 = new Set<string>((sel.params?.top6Iids as string[]) ?? []);
        if (f === 'TOP6')            return top6.has(c.iid);
        if (f === 'Supporter:TOP6')  return top6.has(c.iid) && card.subtype === 'Supporter';
        // v2.56 寶可裝置3.0：牌庫頂 7 張中的支援者
        if (f === 'Supporter:TOP7') {
          const top7 = new Set<string>((sel.params?.top7Iids as string[]) ?? []);
          return top7.has(c.iid) && card.subtype === 'Supporter';
        }
        // v3.11 拉普拉斯ex / 米立龍ex / 人造細胞卵：peek N 限定 filter
        if (f === 'Basic:TOP_N') {
          const topN = new Set<string>((sel.params?.topIids as string[]) ?? []);
          return topN.has(c.iid) && isBasicPokemonCard(card);
        }
        if (f === 'Energy:TOP_N') {
          const topN = new Set<string>((sel.params?.topIids as string[]) ?? []);
          return topN.has(c.iid) && card.supertype === 'Energy';
        }
        // v5.964 女服務生:peek N 中的基本能量(與 +page.svelte 對齊;須在下方 startsWith('BasicEnergy:') 之前)。
        if (f === 'BasicEnergy:TOP_N') {
          const topN = new Set<string>((sel.params?.topIids as string[]) ?? []);
          return topN.has(c.iid) && card.supertype === 'Energy' && card.subtype === 'Basic';
        }
        // v4.915 杜若：peek N 中的寶可夢 / 訓練家
        if (f === 'Pokemon:TOP_N') {
          const topN = new Set<string>((sel.params?.topIids as string[]) ?? []);
          return topN.has(c.iid) && card.supertype === 'Pokemon';
        }
        if (f === 'Trainer:TOP_N') {
          const topN = new Set<string>((sel.params?.topIids as string[]) ?? []);
          return topN.has(c.iid) && card.supertype === 'Trainer';
        }
        // v2.209 配樂之笛：對手牌庫頂 5 張中的基礎寶可夢
        if (f === 'Basic:TOP5') {
          const top5 = new Set<string>((sel.params?.top5Iids as string[]) ?? []);
          return top5.has(c.iid) && isBasicPokemonCard(card);
        }
        // v2.211 壯偉碩木 step 1：1 階寶可夢，evolvesFrom 必須符合場上某基底
        if (f === 'SturdyMightTree:Stage1') {
          if (card.supertype !== 'Pokemon') return false;
          if ((card.stage ?? card.subtype) !== 'Stage1') return false;
          if (!card.evolvesFrom) return false;
          const baseNames = (sel.params?.baseNames as string[] | undefined) ?? [];
          return baseNames.some(n => card.evolvesFrom === n || card.evolvesFrom!.replace(/<|>/g, '') === n);
        }
        // v2.211 壯偉碩木 step 2：2 階寶可夢，evolvesFrom = step1 進化後的卡名
        if (f === 'SturdyMightTree:Stage2') {
          if (card.supertype !== 'Pokemon') return false;
          if ((card.stage ?? card.subtype) !== 'Stage2') return false;
          if (!card.evolvesFrom) return false;
          const fromName = (sel.params?.stage1Name as string | undefined) ?? '';
          return card.evolvesFrom === fromName || card.evolvesFrom.replace(/<|>/g, '') === fromName;
        }
        // v4.38 火箭隊的尼多娜｜惡之覺醒：evolvesFrom 對得上所選 base
        if (f === 'EvilAwakening:EvolveFrom') {
          if (card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
          const baseName = (sel.params?.baseName as string | undefined) ?? '';
          if (card.evolvesFrom === baseName) return true;
          const stripEx = (s: string) => (s.endsWith('ex') ? s.slice(0, -2) : s);
          return stripEx(card.evolvesFrom) === stripEx(baseName);
        }
        // v4.45 小箭雀｜鳥笛：抵抗力為【鬥】屬性的寶可夢
        if (f === 'Resistance:Fighting') {
          return card.supertype === 'Pokemon' && card.resistance?.type === 'Fighting';
        }
        // v2.55 捕蟲組合：牌庫頂 7 張中的基本【草】寶可夢 or 基本【草】能量
        if (f === 'GrassBasicOrGrassEnergy:TOP7') {
          const top7 = new Set<string>((sel.params?.top7Iids as string[]) ?? []);
          if (!top7.has(c.iid)) return false;
          if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Grass') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') {
            if (card.pokemonType === 'Grass') return true;
            if (card.name.includes('【草】')) return true;
          }
          return false;
        }
        if (f === 'Basic')           return isBasicPokemonCard(card);
        if (f === 'Basic:HP70')      return isBasicPokemonCard(card) && (card.hp ?? 0) <= 70;
        // v5.254：BasicPokemon (毒電嬰/大嘴娃/火狐狸 呼朋引伴等同義 filter, UI 端為 +page.svelte:2674)
        if (f === 'BasicPokemon')    return isBasicPokemonCard(card);
        // v2.132：用 stage 欄位（含 ex 進化），不靠 subtype — ex 寶可夢 subtype='ex' 會被排除
        if (f === 'Stage1')          return card.supertype === 'Pokemon' && (card.stage ?? card.subtype) === 'Stage1';
        if (f === 'Stage2')          return card.supertype === 'Pokemon' && (card.stage ?? card.subtype) === 'Stage2';
        if (f === 'Evolution')       return card.supertype === 'Pokemon' && !!card.evolvesFrom;
        if (f === 'PsychicBasic')    return card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Psychic';
        if (f === 'TOP8') {
          const top8 = new Set<string>((sel.params?.top8Iids as string[]) ?? []);
          return top8.has(c.iid);
        }
        if (f === 'TOP2') {
          const top2 = new Set<string>((sel.params?.top2Iids as string[]) ?? []);
          return top2.has(c.iid);
        }
        if (f === 'Pokemon')         return card.supertype === 'Pokemon';
        if (f === 'Energy')          return card.supertype === 'Energy';
        if (f === 'BasicEnergy')     return card.supertype === 'Energy' && card.subtype === 'Basic';
        if (f === 'ex')              return card.supertype === 'Pokemon' && card.subtype === 'ex';
        if (f === 'MegaEx')          return card.supertype === 'Pokemon' && card.subtype === 'ex' && card.name.startsWith('超級');
        if (f === 'TeraPokemon')     return card.supertype === 'Pokemon' && !!card.tags?.includes('太晶');
        if (f === 'Item')            return card.supertype === 'Trainer' && card.subtype === 'Item';
        if (f === 'Supporter')       return card.supertype === 'Trainer' && card.subtype === 'Supporter';
        if (f === 'Stadium')         return card.supertype === 'Trainer' && card.subtype === 'Stadium';
        if (f === 'Tool')            return card.supertype === 'Trainer' && card.subtype === 'PokemonTool';
        if (f === 'Trainer')         return card.supertype === 'Trainer';
        // Wave 42 新增 filter
        if (f === 'CynthiaPokemon') {
          return card.supertype === 'Pokemon' && card.name.includes('竹蘭的');
        }
        // v5.249：莉佳的蔓藤怪|百花齊放
        if (f === 'ErikaPokemon') {
          return card.supertype === 'Pokemon' && card.name.startsWith('莉佳的');
        }
        if (f === 'FightingBasicOrFightingEnergy') {
          if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Fighting') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') {
            if (card.pokemonType === 'Fighting') return true;
            if (card.name.includes('【鬥】') || card.name.includes('【格】')) return true;
          }
          return false;
        }
        if (f === 'PokemonNonRule') {
          // v3.66：改用 isRulePokemon helper
          return card.supertype === 'Pokemon' && !isRulePokemon(card);
        }
        // v2.35：火箭隊新增 filter
        if (f === 'RocketSupporter') {
          return card.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊');
        }
        if (f === 'RocketBasic') {
          return card.supertype === 'Pokemon' && !card.evolvesFrom && card.name.includes('火箭隊的');
        }
        if (f === 'AnyTrainer') {
          return card.supertype === 'Trainer';
        }
        if (f === 'GrassBasicOrGrassEnergy') {
          if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Grass') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') {
            if (card.pokemonType === 'Grass') return true;
            if (card.name.includes('【草】')) return true;
          }
          return false;
        }
        // v2.135：阿響牌組
        if (f === 'RakiPokemonOrFireEnergy') {
          if (card.supertype === 'Pokemon' && card.name.startsWith('阿響的')) return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') {
            if (card.pokemonType === 'Fire' || card.name.includes('【火】')) return true;
          }
          return false;
        }
        // v2.135：洛拍棒（牌庫頂 4 張中的支援者）
        if (f === 'Supporter:TOP4') {
          const top4 = new Set<string>((sel.params?.top4Iids as string[]) ?? []);
          return top4.has(c.iid) && card.subtype === 'Supporter';
        }
        // v2.135：固定卡名搜尋（旅途牽絆 用 'Card:阿響的冒險'）
        if (f.startsWith('Card:')) {
          const want = f.slice(5);
          return card.name === want;
        }
        // v2.321：通用 prefix filters（與 UI +page.svelte 對齊）
        if (f.startsWith('Trainer:')) {
          const sub = f.slice(8); // e.g. 'Supporter', 'Item', 'Stadium', 'PokemonTool'
          return card.supertype === 'Trainer' && card.subtype === sub;
        }
        if (f.startsWith('Pokemon:')) {
          const t = f.slice(8);
          return card.supertype === 'Pokemon' && card.pokemonType === t;
        }
        if (f.startsWith('Energy:')) {
          if (card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
          const t = f.slice(7);
          return card.pokemonType === t || card.name.includes(`【${t}】`);
        }
        if (f.startsWith('Basic:NamePrefix=')) {
          const prefix = f.slice('Basic:NamePrefix='.length);
          return isBasicPokemonCard(card) && card.name.startsWith(prefix);
        }
        if (f.startsWith('Pokemon:NamePrefix=')) {
          const prefix = f.slice('Pokemon:NamePrefix='.length);
          return card.supertype === 'Pokemon' && card.name.startsWith(prefix);
        }
        if (f.startsWith('Pokemon:NameContains=')) {
          const sub = f.slice('Pokemon:NameContains='.length);
          return card.supertype === 'Pokemon' && card.name.includes(sub);
        }
        if (f === 'MarniePokemon') return card.supertype === 'Pokemon' && card.name.startsWith('瑪俐的');
        if (f === 'BasicNonRule') {
          // v3.66：改用 isRulePokemon helper
          return isBasicPokemonCard(card) && !isRulePokemon(card);
        }
        if (f === 'ColorlessPokeHP100') {
          return card.supertype === 'Pokemon' && card.pokemonType === 'Colorless' && (card.hp ?? 999) <= 100;
        }
        // v5.867：基本能量 + 屬性 filter — 與人類端 +page.svelte 對齊,收斂到中央 isBasicEnergyOfType。
        //   先前 AI 缺這些分支 → 'BasicEnergy:Water' 等落到下方 return true(全牌庫候選) → usefulness
        //   排序把基礎寶可夢排最前 → AI 用小霞的朝氣/樂呵呵之吻等從牌庫附能時誤選寶可夢(Wilson 回報)。
        if (f === 'BasicEnergy:DistinctTypes') {
          // 各不同屬性基本能量(伊布|鮮豔捕捉):候選=任意基本能量,實際去重在下方 slice 前。
          return card.supertype === 'Energy' && card.subtype === 'Basic';
        }
        if (f === 'BasicEnergy:Grass+Lightning') {
          return isBasicEnergyOfType(card, 'Grass' as EnergyType) || isBasicEnergyOfType(card, 'Lightning' as EnergyType);
        }
        if (f.startsWith('BasicEnergy:')) {
          const t = f.slice('BasicEnergy:'.length) as EnergyType;
          return isBasicEnergyOfType(card, t);
        }
        return true;
      });
      // v5.617：抓寶可夢優先「現在用得到的」——基礎(可放備戰) > 進化鏈上一階已在場上/手牌(可進化) > 抓了也用不到的高階。
      //   修玩家報：莉佳的蔓藤怪|百花齊放 場上沒喇叭芽/口呆花卻一直抓 Stage2 大食花。非寶可夢候選中性、退回 HP 排序。
      const _fieldHandNames = new Set([
        actorPlayer.active ? pool.get(actorPlayer.active.cardId)?.name : null,
        ...actorPlayer.bench.map(c => pool.get(c.cardId)?.name),
        ...actorPlayer.hand.map(c => pool.get(c.cardId)?.name),
      ].filter((n): n is string => !!n));
      const _usefulness = (inst: CardInstance): number => {
        const card = pool.get(inst.cardId);
        if (!card || card.supertype !== 'Pokemon') return 1;  // 非寶可夢中性
        if (isBasicPokemonCard(card)) return 3;               // 基礎一定放得了
        if (card.evolvesFrom && _fieldHandNames.has(card.evolvesFrom)) return 2;  // 上一階在場/手 → 可進化
        return 0;                                             // 無上一階 → 抓了也用不到
      };
      candidates.sort((a, b) => {
        const su = _usefulness(b) - _usefulness(a);
        if (su !== 0) return su;
        return (pool.get(b.cardId)?.hp ?? 0) - (pool.get(a.cardId)?.hp ?? 0);
      });
      // v5.867：各不同屬性基本能量 — 依 pokemonType 去重(每屬性只留 1 張),確保選到的屬性互異。
      if (f === 'BasicEnergy:DistinctTypes') {
        // v6.008：基本能量 pokemonType 恒 null → 用 getBasicEnergyType（卡名【X】推）判屬性去重，
        //   否則 AI 端也全被濾掉、稜鏡充能等一張都選不到。
        const seenTypes = new Set<string>();
        candidates = candidates.filter(inst => {
          const t = getBasicEnergyType(pool.get(inst.cardId));
          if (!t || seenTypes.has(t)) return false;
          seenTypes.add(t); return true;
        });
      }
      const count = Math.min(sel.maxCount, candidates.length);
      return { type: 'RESOLVE_SELECTION', selectedIids: candidates.slice(0, count).map(c => c.iid) };
    }

    // 備戰選擇（自己）
    case 'bench-choose': {
      const validIids = sel.params?.validIids as string[] | undefined;
      let bench = validIids
        ? actorPlayer.bench.filter(c => validIids.includes(c.iid))
        : actorPlayer.bench;
      if (bench.length === 0) return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      // v2.147 — 多選時（如零之大空洞失效棄置）：依照「價值低」排序選 minCount 隻丟棄
      //   價值低 = 受傷越多 + HP 上限越低 + 不是 ex/超級進化
      const need = Math.max(1, sel.minCount ?? 1);
      if (need > 1) {
        const sorted = [...bench].sort((a, b) => {
          const ca = pool.get(a.cardId);
          const cb = pool.get(b.cardId);
          const remA = (ca?.hp ?? 0) - a.damage;
          const remB = (cb?.hp ?? 0) - b.damage;
          // 越受傷越先丟
          if (remA !== remB) return remA - remB;
          // 等價值再比 HP（HP 低先丟）
          return (ca?.hp ?? 0) - (cb?.hp ?? 0);
        });
        return { type: 'RESOLVE_SELECTION', selectedIids: sorted.slice(0, need).map(c => c.iid) };
      }
      // v3.732 波動突刺 bench picker：
      //   優先順序：① 超級進化 ex (Mega ex) ② ex 寶可夢 ③ 「主攻擊招式 cost 還缺鬥能量」
      if (sel.effectKey === 'pulse-thrust-attach-one') {
        const scoreFightTarget = (inst: import('./types').CardInstance): number => {
          const card = pool.get(inst.cardId);
          if (!card) return 0;
          let s = 0;
          // 超級進化 ex (Mega ex) — 卡名通常含「超級」開頭 + 'ex' 結尾
          const isMegaEx = (card.name?.startsWith('超級') ?? false) && /ex|ＥＸ/i.test(card.name ?? '');
          if (isMegaEx) s += 1000;
          else if (/ex|ＥＸ/i.test(card.name ?? '')) s += 500; // 一般 ex
          // 「主攻擊招式 cost 還缺鬥能量」— 算現有鬥能量 vs 招式 cost 內鬥需求
          const fightCount = inst.energyAttached.filter(e => {
            const ec = pool.get(e.cardId);
            if (!ec || ec.supertype !== 'Energy') return false;
            return ec.pokemonType === 'Fighting' || /【鬥】/.test(ec.name ?? '');
          }).length;
          // 印刷傷害最高的招式
          let maxFightNeed = 0;
          for (const atk of card.attacks ?? []) {
            const fightInCost = (atk.cost ?? []).filter(c => c === 'Fighting').length;
            if (fightInCost > maxFightNeed) maxFightNeed = fightInCost;
          }
          const fightShort = Math.max(0, maxFightNeed - fightCount);
          if (fightShort > 0) s += 100 * fightShort; // 越缺越優先
          return s;
        };
        const sortedByNeed = [...bench].sort((a, b) => scoreFightTarget(b) - scoreFightTarget(a));
        const pick = sortedByNeed[0];
        return { type: 'RESOLVE_SELECTION', selectedIids: [pick.iid] };
      }
      // 單選：選 HP 剩最少（最危險的）給支援
      const pick = bench[0];
      return { type: 'RESOLVE_SELECTION', selectedIids: [pick.iid] };
    }

    // 對手備戰選擇
    case 'opp-bench-choose': {
      // v5.874：尊重 params.validIids + includeActive(對齊 UI +page.svelte:3169 與 opp-poke-choose)。
      //   原直接用 srcPlayer.bench 忽略 validIids → snipe-60-ex(只限ex)/gust-opp(排除化隱)/lucia-show/
      //   wave3a-snipe/頂級球 等設 validIids 的卡,AI 會選到非法目標(打非ex/化隱保護的備戰)。
      const includeActiveOB = sel.params?.includeActive === true;
      const validIidsOB = sel.params?.validIids as string[] | undefined;
      const baseOB = includeActiveOB && srcPlayer.active ? [srcPlayer.active, ...srcPlayer.bench] : srcPlayer.bench;
      const bench = validIidsOB ? baseOB.filter(c => validIidsOB.includes(c.iid)) : baseOB;
      if (bench.length === 0) return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      // v3.43 魔靈多龍 老大指令：抓 ex 且 remainingHP ≤ 200（讓多龍幻影奇襲 KO 取 2 獎賞）
      // 60 內備戰不抓（保留給幻影奇襲分配 KO，省一張老大指令）
      if (sel.effectKey === 'gust-opp') {
        const me = state.players[sel.actorIdx];
        if (isMarruneDragapult(me, pool)) {
          const pick = dragapultGustPick(bench, pool, state);
          if (pick) return { type: 'RESOLVE_SELECTION', selectedIids: [pick.iid] };
        }
      }
      // 選剩餘 HP 最少的（最容易擊倒）
      const best = bench.reduce((a, b) => {
        const aRem = (pool.get(a.cardId)?.hp ?? 0) - a.damage;
        const bRem = (pool.get(b.cardId)?.hp ?? 0) - b.damage;
        return aRem <= bRem ? a : b;
      });
      return { type: 'RESOLVE_SELECTION', selectedIids: [best.iid] };
    }

    // 對手任意寶可夢選擇（狙擊羽毛、願增猿腎上腺腦力等）
    case 'opp-poke-choose': {
      const allOpp: CardInstance[] = [
        ...(srcPlayer.active ? [srcPlayer.active] : []),
        ...srcPlayer.bench,
      ];
      const validIidsOP = sel.params?.validIids as string[] | undefined;
      const oppPool = validIidsOP ? allOpp.filter(c => validIidsOP.includes(c.iid)) : allOpp;
      if (oppPool.length === 0) return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      // v3.43 魔靈多龍 願增猿腎上腺腦力 — 優先壓 KO 線
      if (sel.effectKey === 'adrenal-brain-target') {
        const me = state.players[sel.actorIdx];
        if (isMarruneDragapult(me, pool)) {
          const amount = (sel.params?.amount as number) ?? 30;
          const tgt = dragapultAdrenalTarget(amount, srcPlayer.active, srcPlayer.bench, pool, state);
          if (tgt && oppPool.some(p => p.iid === tgt.iid)) {
            return { type: 'RESOLVE_SELECTION', selectedIids: [tgt.iid] };
          }
        }
      }
      const best = oppPool.reduce((a, b) => {
        const aRem = (pool.get(a.cardId)?.hp ?? 0) - a.damage;
        const bRem = (pool.get(b.cardId)?.hp ?? 0) - b.damage;
        return aRem <= bRem ? a : b;
      });
      return { type: 'RESOLVE_SELECTION', selectedIids: [best.iid] };
    }

    // 手牌丟棄
    // v2.38：sourcePlayerIdx 可以 ≠ actorIdx（例：枇琶 — AI 用枇琶丟玩家手牌物品卡）
    // 所以改用 srcPlayer 的 hand 作為來源，並支援 validIids 過濾。
    case 'hand-discard': {
      const f = sel.filter ?? '';
      const validIidsHD = sel.params?.validIids as string[] | undefined;
      let hand = srcPlayer.hand;
      if (validIidsHD) hand = hand.filter(c => validIidsHD.includes(c.iid));
      // v6.016 批4:中央 selection filter 求值器（修 AI 缺 BasicEnergy:<T>/Energy:<T> 漂移，如妖火紅狐|閃焰魔法丟錯能量）；known 才走中央，否則落原 inline chain
      if (isKnownSelectionFilter('hand-discard', f)) {
        hand = hand.filter(c => evaluateSelectionFilter('hand-discard', f, c, pool.get(c.cardId), {}) === true);
      } else if (f === 'Energy') hand = hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
      else if (f === 'BasicEnergy') hand = hand.filter(c => {
        const card = pool.get(c.cardId);
        return card?.supertype === 'Energy' && card.subtype === 'Basic';
      });
      // v2.40 月光丘陵：只基本【超】能量
      else if (f === 'BasicPsychicEnergy') hand = hand.filter(c => {
        const card = pool.get(c.cardId);
        return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【超】');
      });
      // v2.89 波動突刺：只基本【鬥】能量
      else if (f === 'BasicFightingEnergy') hand = hand.filter(c => {
        const card = pool.get(c.cardId);
        return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【鬥】');
      });
      else if (f === 'Item') hand = hand.filter(c => {
        const card = pool.get(c.cardId);
        return card?.supertype === 'Trainer' && card.subtype === 'Item';
      });
      // 對自己手牌丟棄：優先丟能量，再丟訓練家，最後寶可夢
      // 對對手手牌丟棄（枇琶）：丟高價值物品優先（球 / 研究之類 > 其他）
      const isOppHand = sel.sourcePlayerIdx !== sel.actorIdx;
      hand = [...hand].sort((a, b) => {
        const scoreOf = (c: CardInstance) => {
          const card = pool.get(c.cardId);
          if (isOppHand) {
            // 丟對手物品：優先丟訓練家（預期值較高）；若名字含「球」更優先
            if (card?.supertype === 'Trainer') {
              return card.name.includes('球') ? 4 : 3;
            }
            return 1;
          }
          // 丟自己：能量 > 訓練家 > 寶可夢（留場上資源）
          if (card?.supertype === 'Energy') return 3;
          if (card?.supertype === 'Trainer') return 2;
          return 1;
        };
        return scoreOf(b) - scoreOf(a);
      });
      const count = Math.min(sel.maxCount, hand.length);
      return { type: 'RESOLVE_SELECTION', selectedIids: hand.slice(0, count).map(c => c.iid) };
    }

    // 手牌選擇（不丟棄，如神奇糖果）
    case 'hand-choose': {
      const validIids = sel.params?.validIids as string[] | undefined;
      const hand = validIids
        ? actorPlayer.hand.filter(c => validIids.includes(c.iid))
        : actorPlayer.hand;
      if (hand.length === 0) return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      return { type: 'RESOLVE_SELECTION', selectedIids: [hand[0].iid] };
    }

    // 回復目標
    case 'heal-target': {
      const validIids = sel.params?.validIids as string[] | undefined;
      const allPokes: CardInstance[] = [
        ...(actorPlayer.active ? [actorPlayer.active] : []),
        ...actorPlayer.bench,
      ];
      let targets = validIids ? allPokes.filter(c => validIids.includes(c.iid)) : allPokes;
      if (targets.length === 0) return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      // v3.99 日光轉移特例 — 妙蛙花優先策略避免無限循環
      if (sel.effectKey === 'sunlight-transfer-source' || sel.effectKey === 'sunlight-transfer-target') {
        const isBasicGrass2 = (eInst: { cardId: string }) => {
          const ec = pool.get(eInst.cardId);
          if (!ec || ec.supertype !== 'Energy' || ec.subtype !== 'Basic') return false;
          return ec.pokemonType === 'Grass' || /【草】/.test(ec.name);
        };
        const meAttacker = targets.find(c => pool.get(c.cardId)?.name === '超級妙蛙花ex');
        if (sel.effectKey === 'sunlight-transfer-source') {
          // source 端：避免從妙蛙花ex 抽走能量，選非妙蛙花且有最多草能的（一次抽最多）
          const nonMe = targets.filter(c => !meAttacker || c.iid !== meAttacker.iid);
          if (nonMe.length > 0) {
            const best = nonMe.reduce((a, b) => {
              const aGrass = a.energyAttached.filter(isBasicGrass2).length;
              const bGrass = b.energyAttached.filter(isBasicGrass2).length;
              return aGrass >= bGrass ? a : b;
            });
            return { type: 'RESOLVE_SELECTION', selectedIids: [best.iid] };
          }
          // fallback：只剩妙蛙花ex 有草能（罕見）→ 走原邏輯
        } else {
          // target 端：優先選妙蛙花ex 當接收方（草能集中到主力）
          if (meAttacker) {
            return { type: 'RESOLVE_SELECTION', selectedIids: [meAttacker.iid] };
          }
          // 場上沒妙蛙花ex 但 picker 仍開（理論上不會 — USE_ABILITY 在 ability owner 不在場時無法觸發）
        }
      }
      // 預設：選傷害最多的（最需要治療的）
      const best = targets.reduce((a, b) => a.damage >= b.damage ? a : b);
      return { type: 'RESOLVE_SELECTION', selectedIids: [best.iid] };
    }

    // 棄牌區搜尋
    case 'discard-search': {
      const f = sel.filter ?? '';
      // v6.016 批4:三重結構修復——F2 讀 sourcePlayerIdx（原誤硬讀 actorPlayer.discard→惡作劇作畫等
      //   「從對手棄牌區選卡」招式 AI 送錯 iid 靜默失效）；F1 params.validIids 前置交集（原完全不讀）；
      //   中央求值器補齊缺失 filter（豐收漁網/塔拉剛/電氣發電機等原落 fallthrough 亂撿不符卡面的卡）。
      const validIidsDS = sel.params?.validIids as string[] | undefined;
      let discardBase = srcPlayer.discard;
      if (validIidsDS) discardBase = discardBase.filter(c => validIidsDS.includes(c.iid));
      let discard = discardBase.filter(c => {
        const card = pool.get(c.cardId);
        if (!card) return false;
        if (isKnownSelectionFilter('discard-search', f)) return evaluateSelectionFilter('discard-search', f, c, card, {}) === true;
        if (f === 'PokemonOrEnergy') return (card.supertype === 'Pokemon') || card.supertype === 'Energy';
        if (f === 'PokemonOrBasicEnergy') {
          // v2.43：夜間擔架用 — 寶可夢或基本能量（排除 Special Energy / Pokemon 道具）
          if (card.supertype === 'Pokemon') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') return true;
          return false;
        }
        if (f === 'PokemonNonExOrBasicEnergy') {
          if (card.supertype === 'Pokemon' && card.subtype !== 'ex') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') return true;
          return false;
        }
        // v3.829 fix：變化之書 / 寶寶球 用 filter='Basic'，原本 fallback return true 讓 AI 抓到莉莉艾的決意。
        if (f === 'Basic')           return card.supertype === 'Pokemon' && !card.evolvesFrom
                                            && card.subtype !== 'Stage1' && card.subtype !== 'Stage2';
        // v2.40 修正：原本 supertype === 'Energy' 是 bug（= 所有能量，會選到 Special Energy）
        if (f === 'BasicEnergy')     return card.supertype === 'Energy' && card.subtype === 'Basic';
        if (f === 'BasicPsychicEnergy') {
          return card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【超】');
        }
        // v2.89 波動突刺：只基本【鬥】能量
        if (f === 'BasicFightingEnergy') {
          return card.supertype === 'Energy' && card.subtype === 'Basic' && card.name.includes('【鬥】');
        }
        // v2.135：聖灰
        if (f === 'Pokemon') return card.supertype === 'Pokemon';
        return true;
      });
      const count = Math.min(sel.maxCount, discard.length);
      return { type: 'RESOLVE_SELECTION', selectedIids: discard.slice(0, count).map(c => c.iid) };
    }

    // v2.139 modal-choice：兩/多選一文字選單（烏栗等）
    // v2.201 擴展：偵測 params.stepper（泰姆猜 HP 等）— AI 直接送 init 值
    // v2.257 擴展：effectKey 專屬 heuristic（高溫燃燒器：價值排序丟棄目標）
    case 'modal-choice': {
      const stepper = sel.params?.stepper as { min: number; max: number; step: number; init: number } | undefined;
      if (stepper) {
        // AI 簡化：直接送出 init（卡牌設計 init 通常為「中位數合理猜測」）
        // 泰姆 case 為避免 AI 直接答對，effect 側已將 init 設為「常見 HP 中位數 100」而非實際 HP
        return { type: 'RESOLVE_SELECTION', selectedIids: [String(stepper.init)] };
      }
      const opts = (sel.params?.options as Array<{ id: string; text: string; disabled?: boolean }>) ?? [];

      // v2.257 高溫燃燒器專屬：按價值排序選擇丟棄目標
      //   id 格式：'tool:<iid>' / 'energy:<iid>:<eid>' / 'stadium'
      //   優先順序：對手戰鬥位特殊能量 > 備戰位特殊能量 > 場地卡 > 戰鬥位 Tool > 備戰位 Tool
      //   理由：特殊能量通常是攻擊核心（如稜鏡/火箭隊/太晶能量），戰鬥位的直接削弱當下回合對手攻擊力。
      if (sel.effectKey === 'heat-burner-pick') {
        const dIdx = (1 - sel.sourcePlayerIdx) as 0 | 1;
        const oppActiveIid = state.players[dIdx].active?.iid;
        type Opt = { id: string; text: string; disabled?: boolean };
        const energyActive: Opt[] = [];
        const energyBench: Opt[] = [];
        const stadiums: Opt[] = [];
        const toolActive: Opt[] = [];
        const toolBench: Opt[] = [];
        for (const o of opts) {
          if (o.disabled) continue;
          if (o.id === 'stadium') stadiums.push(o);
          else if (o.id.startsWith('energy:')) {
            const targetIid = o.id.split(':')[1];
            (targetIid === oppActiveIid ? energyActive : energyBench).push(o);
          } else if (o.id.startsWith('tool:')) {
            const targetIid = o.id.split(':')[1];
            (targetIid === oppActiveIid ? toolActive : toolBench).push(o);
          }
        }
        const ordered = [...energyActive, ...energyBench, ...stadiums, ...toolActive, ...toolBench];
        const pick = ordered[0] ?? opts.find(o => !o.disabled) ?? opts[0];
        return { type: 'RESOLVE_SELECTION', selectedIids: pick ? [pick.id] : [] };
      }

      // v3.711 hotfix: 腎上腺腦力 modal-choice picker 被砍 (見 maroon_dragon_deck.ts)，
      //   原 v3.71 在這裡的 dragapultAdrenalCount handler 已 dead code 移除。
      //   若舊存檔仍有 pending → fallback 走下方「第一個非 disabled」自然解決。

      // 預設：選第一個非 disabled 選項
      const first = opts.find(o => !o.disabled) ?? opts[0];
      return { type: 'RESOLVE_SELECTION', selectedIids: first ? [first.id] : [] };
    }

    // v2.164 reorder-deck-top：排序牌庫頂 N 張（推理組合 / 蕾荷）
    case 'reorder-deck-top': {
      const candIids = (sel.params?.candidateIids as string[] | undefined) ?? [];
      // AI 簡化：保留所有候選並維持原順序（即使 allowDiscard 也不丟棄）
      return { type: 'RESOLVE_SELECTION', selectedIids: [...candIids] };
    }

    // v5.188 AI 處理 energy-distribute (龐克練肌 / 烈火亂舞 / 充溢之力 / 熱帶狂燒 / 滿載心田 等)
    //   原本 AI 沒此 case → 走 default → selectedIids: [] → resolver 早 return → 能量不附
    //   修：round-robin 平均分配能量到 validIids（簡化策略，不挑最佳目標）
    //   selectedIids 長度 = totalCount，每個元素 = 該張能量要附給哪一隻 validIid
    case 'energy-distribute': {
      const validIids = (sel.params?.validIids as string[] | undefined) ?? [];
      const totalCount = (sel.params?.totalCount as number | undefined) ?? sel.maxCount;
      if (validIids.length === 0 || totalCount <= 0) {
        return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      }
      // round-robin：把 totalCount 個 counter 平均散在 validIids 上
      // （AI 簡化：不挑「最該附能的主打手」— 先求能跑完 chain，後續優化見 TODO）
      const out: string[] = [];
      for (let i = 0; i < totalCount; i++) {
        out.push(validIids[i % validIids.length]);
      }
      return { type: 'RESOLVE_SELECTION', selectedIids: out };
    }

    // v3.43 魔靈多龍 幻影奇襲 (200 + 6 個傷害指示物自由分配對手備戰)
    case 'damage-distribute': {
      const totalCounters = (sel.params?.totalCounters as number) ?? 6;
      const placedBefore = (sel.params?.placedCounters as number) ?? 0;
      const counterDamage = (sel.params?.counterDamage as number) ?? 10;
      const remaining = totalCounters - placedBefore;
      const benchPool = srcPlayer.bench;
      if (benchPool.length === 0 || remaining <= 0) {
        return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      }
      const ids = dragapultDistribute6Counters(benchPool, remaining, counterDamage, pool, state);
      return { type: 'RESOLVE_SELECTION', selectedIids: ids };
    }

    case 'active-energy-discard': {
      // v5.800：丟/移對手能量或回手(sourcePlayerIdx≠actor)=對 AI 有利→取滿 maxCount；
      //   丟自己能量(成本，sourcePlayerIdx=actor)→只取 minCount。
      const _validE = sel.params?.validIids as string[] | undefined;
      const _srcAct = srcPlayer.active;
      let _cand = _srcAct ? _srcAct.energyAttached.map(e => e.iid) : [];
      if (_validE) _cand = _cand.filter(iid => _validE.includes(iid));
      if (_cand.length === 0) return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      const _isOpp = sel.sourcePlayerIdx !== sel.actorIdx;
      // v5.949 unitTarget 模式(如噴射旋風):選 maxCount 張(k≤N,guard 已保證單位≥N→合法);否則原邏輯。
      const _uT = sel.params?.unitTarget as number | undefined;
      const _want = (_uT != null) ? (sel.maxCount ?? 1) : (_isOpp ? (sel.maxCount ?? 1) : (sel.minCount ?? 0));
      return { type: 'RESOLVE_SELECTION', selectedIids: _cand.slice(0, Math.min(_want, _cand.length)) };
    }
    default:
      return { type: 'RESOLVE_SELECTION', selectedIids: [] };
  }
}

// ── 輔助 ──────────────────────────────────────────────────────────────────────

/**
 * 從備戰區選最佳的送出。
 * v2.357 修正：
 * - Zoroark ex 應該**優先**送上場（暗黑底牌需要它在 active 才能複製備戰招式）
 * - 那些高能量需求的（N's 萊希拉姆 / 達摩狒狒）不該輕易上 active，因為它們
 *   沒能量就打不了招式，且 HP 高並不構成選擇它們的理由
 * - 優先順序：Zoroark ex > 能發招式的 > HP 最高的普通寶可夢
 */
function pickBestActive(bench: CardInstance[], pool: Map<string, Card>, state?: GameState): CardInstance {
  if (!bench.length) return bench[0]; // fallback

  // 輔助：檢查某只寶可夢是否「當前就能發招式」
  const canAttackNow = (inst: CardInstance): boolean => {
    const card = pool.get(inst.cardId);
    if (!card?.attacks?.length) return false;
    for (const atk of card.attacks) {
      if (canAffordAttack(inst, atk.cost, pool, state, state?.activePlayerIndex, atk.name)) {
        return true;
      }
    }
    return false;
  };

  // Zoroark ex：暗黑底牌需要它在 active，應該優先送上場
  const zoroarkEx = bench.find(b => pool.get(b.cardId)?.name === 'N的索羅亞克ex');
  if (zoroarkEx) return zoroarkEx;

  // 能發招式的，選 HP 最高的
  const canAtk = bench.filter(b => canAttackNow(b));
  if (canAtk.length > 0) {
    return canAtk.reduce((a, b) =>
      getEffectiveHP(a, pool, state) >= getEffectiveHP(b, pool, state) ? a : b
    );
  }

  // 都不能發招式：選 HP 最高的普通寶可夢
  return bench.reduce((a, b) =>
    getEffectiveHP(a, pool, state) >= getEffectiveHP(b, pool, state) ? a : b
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// v3.43 魔靈多龍 preset 牌組策略特製
//
// 戰術核心：「斷頭線」— 把對手主威脅推進「我方下次攻擊一發 KO」的距離。
// 三條 KO 線：
//   - 多龍巴魯托ex|幻影奇襲：戰鬥場 200 傷害；備戰 6 顆指示物（最多 60 傷害任意分配）
//   - 黑夜魔靈|咒詛炸彈：對手任意 1 隻 +130 傷害（自爆換 KO 或斷頭線）
//   - 彷徨夜靈|咒詛炸彈：對手任意 1 隻 +50 傷害（同上 縮小版）
// 配合卡：
//   - 老大指令：抓對手備戰已壓到 200 線內的 ex 到戰鬥場（讓多龍 KO 取 2 獎賞）
//   - 願增猿|腎上腺腦力：把己方多龍承受的傷害挪到對手身上（壓 KO 線）
//   - 含羞苞|癢癢花粉：前期戰鬥場用，封對手物品卡爭取進化時間
// ══════════════════════════════════════════════════════════════════════════════

/** 偵測玩家是否使用「魔靈多龍」preset 牌組。
 *  指紋：同時擁有「多龍巴魯托ex」+「黑夜魔靈」+「含羞苞」。
 *  火焰雞多龍 preset 沒有黑夜魔靈與含羞苞 → 不會誤判。 */
function isMarruneDragapult(player: PlayerState, pool: Map<string, Card>): boolean {
  const all = [
    ...(player.active ? [player.active] : []),
    ...player.bench, ...player.hand, ...player.deck, ...player.discard, ...player.prizes,
  ];
  let hasDragapult = false, hasNightmare = false, hasSweetVeil = false;
  for (const c of all) {
    const n = pool.get(c.cardId)?.name;
    if (!n) continue;
    if (n === '多龍巴魯托ex') hasDragapult = true;
    else if (n === '黑夜魔靈') hasNightmare = true;
    else if (n === '含羞苞') hasSweetVeil = true;
    if (hasDragapult && hasNightmare && hasSweetVeil) return true;
  }
  return false;
}

// v3.71：用 getEffectiveHP 含 Tool/Stadium/passive 加成
//   原本只取 card.hp - damage 會在對手裝英雄斗篷(+100)/激動競技場(+30)等場景算錯 KO 線。
//   減傷類效果（莓榴果 -60 對龍、damageReduceNextHit -N 等）不在 HP 計算內。
function _remHP(inst: CardInstance, pool: Map<string, Card>, state?: GameState): number {
  return Math.max(0, getEffectiveHP(inst, pool, state) - inst.damage);
}

function _isEx(inst: CardInstance, pool: Map<string, Card>): boolean {
  const n = pool.get(inst.cardId)?.name ?? '';
  return /ex|ＥＸ/i.test(n);
}

// v3.71：對手側「不會被放置傷害指示物」的免疫檢查
//   對戰圓形競技場 (Stadium, M2 I) - bench-only immunity
//   探探鼠｜監視之眼 (ability, M4 J) - 全場 immunity
function _hasOppCounterImmunity(
  state: GameState, myIdx: 0 | 1, pool: Map<string, Card>,
  scope: 'bench' | 'active' | 'all',
): boolean {
  if (scope !== 'active') {
    const stName = state.activeStadium ? pool.get(state.activeStadium.cardId)?.name : undefined;
    if (stName === '對戰圓形競技場') return true;
  }
  const dIdx = (1 - myIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const allOpp = [...(opp.active ? [opp.active] : []), ...opp.bench];
  for (const c of allOpp) {
    const card = pool.get(c.cardId);
    // v4.921 火箭隊的監視塔 gate：探探鼠 Colorless 在此 stadium 下特性失效
    if (card?.abilities?.some(a => a.name === '監視之眼')) {
      const sCard = state.activeStadium ? pool.get(state.activeStadium.cardId) : undefined;
      const blocked = sCard?.name === '火箭隊的監視塔' && card.pokemonType === 'Colorless';
      if (!blocked) return true;
    }
  }
  return false;
}

// v3.71：多龍巴魯托ex 是否在場且能量 1F+1P 滿足幻影奇襲 200
function _canDragapultPhantomStrike(state: GameState, myIdx: 0 | 1, pool: Map<string, Card>): boolean {
  const me = state.players[myIdx];
  const allMine = [...(me.active ? [me.active] : []), ...me.bench];
  return allMine.some(c => {
    if (pool.get(c.cardId)?.name !== '多龍巴魯托ex') return false;
    let fire = 0, psy = 0;
    for (const e of c.energyAttached) {
      const ec = pool.get(e.cardId);
      if (!ec) continue;
      if (ec.pokemonType === 'Fire' || ec.name.includes('【火】')) fire++;
      if (ec.pokemonType === 'Psychic' || ec.name.includes('【超】')) psy++;
    }
    return fire >= 1 && psy >= 1;
  });
}

// v3.71：手上是否有「老大的指令」
function _hasGustInHand(player: PlayerState, pool: Map<string, Card>): boolean {
  return player.hand.some(c => pool.get(c.cardId)?.name === '老大的指令');
}

/** 魔靈多龍 — 能量分配特化：
 *  火/超能量只填多龍奇 / 多龍巴魯托ex（滿 1 火 + 1 超 後不再填）
 *  惡能量只填願增猿（已有 ≥1 顆惡能量則不再填）
 *  其他寶可夢一律不填能量
 *  回傳要 attach 的 action，沒目標 → null（不附能量）
 */
function dragapultEnergyAction(
  state: GameState, player: PlayerState, pool: Map<string, Card>,
): GameAction | null {
  const energies = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  if (energies.length === 0) return null;
  const allMine = [...(player.active ? [player.active] : []), ...player.bench];

  const countOn = (inst: CardInstance, kind: 'Fire'|'Psychic'|'Darkness'): number => {
    let n = 0;
    for (const e of inst.energyAttached) {
      const ec = pool.get(e.cardId);
      if (!ec) continue;
      if (kind === 'Fire' && (ec.pokemonType === 'Fire' || ec.name.includes('【火】'))) n++;
      else if (kind === 'Psychic' && (ec.pokemonType === 'Psychic' || ec.name.includes('【超】'))) n++;
      else if (kind === 'Darkness' && (ec.pokemonType === 'Darkness' || ec.name.includes('【惡】'))) n++;
    }
    return n;
  };

  for (const eInst of energies) {
    const eCard = pool.get(eInst.cardId);
    if (!eCard) continue;
    const isFire = eCard.pokemonType === 'Fire' || eCard.name.includes('【火】');
    const isPsy  = eCard.pokemonType === 'Psychic' || eCard.name.includes('【超】');
    const isDark = eCard.pokemonType === 'Darkness' || eCard.name.includes('【惡】');

    if (isFire || isPsy) {
      // 火/超 → 多龍系（多龍奇 / 多龍巴魯托ex），1 火 + 1 超 為止
      // 優先填戰鬥場上的多龍系（即將攻擊），次之備戰
      const dragons = [
        ...allMine.filter(p => pool.get(p.cardId)?.name === '多龍巴魯托ex'),
        ...allMine.filter(p => pool.get(p.cardId)?.name === '多龍奇'),
      ];
      for (const t of dragons) {
        if (t.cantAttachEnergyThisTurn) continue;  // v5.151 詛咒根等鎖能量
        const f = countOn(t, 'Fire'), p = countOn(t, 'Psychic');
        if (f >= 1 && p >= 1) continue; // 已滿 1F+1P
        if (isFire && f < 1) return { type: 'ATTACH_ENERGY', energyIid: eInst.iid, targetIid: t.iid };
        if (isPsy  && p < 1) return { type: 'ATTACH_ENERGY', energyIid: eInst.iid, targetIid: t.iid };
      }
    } else if (isDark) {
      // 惡 → 願增猿（1 顆即可，腎上腺腦力觸發條件）
      for (const t of allMine) {
        if (pool.get(t.cardId)?.name !== '願增猿') continue;
        if (t.cantAttachEnergyThisTurn) continue;  // v5.151 詛咒根等鎖能量
        if (countOn(t, 'Darkness') >= 1) continue;
        return { type: 'ATTACH_ENERGY', energyIid: eInst.iid, targetIid: t.iid };
      }
    }
  }

  // v3.71 P2b fallback：多龍巴魯托ex 在 active 且能量 0 → 附任意能量打噴射頭擊 (1C, 70)
  //   情境：剛上場 active；手上只有 C 能量。不附 = 空在 active；附 1 顆 = 至少 70 點輸出。
  //   v5.151：active 被鎖能量（詛咒根等）→ skip 防無限 retry
  if (player.active && pool.get(player.active.cardId)?.name === '多龍巴魯托ex'
      && player.active.energyAttached.length === 0
      && !player.active.cantAttachEnergyThisTurn
      && energies.length > 0) {
    return { type: 'ATTACH_ENERGY', energyIid: energies[0].iid, targetIid: player.active.iid };
  }
  return null;
}

// v3.71 強化：咒詛炸彈 gate
//   1. 直接 KO（對手任意 effectiveHP-damage <= 自身 dmg）
//   2. 壓 KO 線（炸完後要能被「下一個動作」KO）：
//      - 黑夜魔靈 13: 炸完 <=200 + 必須有可發幻影奇襲的多龍 + (active 或 bench+老大指令在手)
//      - 彷徨夜靈 5:  炸完 <=60  + 必須有可發幻影奇襲的多龍 + bench 不被 immune
//   P1a 阻擋：對手 active immune (監視之眼) → 整個失效
//   P1b 阻擋：bench immune (對戰圓形) → 炸 bench 目標全部 skip
function shouldUseCursedBomb(
  state: GameState, myIdx: 0 | 1, _abilityName: string, pokemonName: string,
  pool: Map<string, Card>,
): boolean {
  const counters = pokemonName === '黑夜魔靈' ? 13 : 5;
  const dmg = counters * 10;
  const oppIdx = (1 - myIdx) as 0 | 1;
  const opp = state.players[oppIdx];
  const oppActive = opp.active;
  const allOpp = [...(oppActive ? [oppActive] : []), ...opp.bench];

  if (_hasOppCounterImmunity(state, myIdx, pool, 'active')) return false;
  const benchImmune = _hasOppCounterImmunity(state, myIdx, pool, 'bench');

  // 1. 直接 KO
  for (const t of allOpp) {
    const rem = _remHP(t, pool, state);
    if (rem <= 0) continue;
    const isActiveTgt = oppActive && t.iid === oppActive.iid;
    if (benchImmune && !isActiveTgt) continue;
    if (rem <= dmg) return true;
  }

  // 2. 壓 KO 線：先 check 多龍可攻擊
  if (!_canDragapultPhantomStrike(state, myIdx, pool)) return false;
  const me = state.players[myIdx];
  const hasGust = _hasGustInHand(me, pool);

  for (const t of allOpp) {
    const rem = _remHP(t, pool, state);
    if (rem <= 0) continue;
    const isActiveTgt = oppActive && t.iid === oppActive.iid;
    if (benchImmune && !isActiveTgt) continue;
    const newRem = rem - dmg;
    if (newRem <= 0) continue;

    // 黑夜魔靈 13 → 壓到 200 線
    if (counters === 13 && newRem <= 200) {
      if (isActiveTgt) return true;
      if (hasGust) return true;
    }
    // 彷徨夜靈 5 → 壓到 60 線（只在 bench）
    if (counters === 5 && newRem <= 60 && !isActiveTgt) return true;
  }
  return false;
}

/** 魔靈多龍 — 6 顆指示物分配演算法（damage-distribute auto-resolve）。
 *  對手備戰每隻按「能用最少 counter KO」優先送 KO；剩餘 counter 砸 ex 壓到 200；
 *  最後殘餘平均砸最大威脅。
 *  回傳 selectedIids 陣列（同 iid 出現 N 次 = 該寶可夢吃 N 個 counter）。
 */
function dragapultDistribute6Counters(
  bench: CardInstance[], totalCounters: number, counterDamage: number,
  pool: Map<string, Card>, state?: GameState,
): string[] {
  const tracker = bench.map(b => ({
    iid: b.iid,
    rem: _remHP(b, pool, state),
    isEx: _isEx(b, pool),
    hp: getEffectiveHP(b, pool, state),
  }));
  const result: string[] = [];
  let counters = totalCounters;

  // 第 1 階：能用最少 counter KO 的優先（KO 線最近）
  while (counters > 0) {
    const cands = tracker.filter(t => t.rem > 0 && t.rem <= counters * counterDamage);
    if (cands.length === 0) break;
    const target = cands.reduce((a, b) => a.rem <= b.rem ? a : b);
    const need = Math.ceil(target.rem / counterDamage);
    for (let i = 0; i < need && counters > 0; i++) { result.push(target.iid); counters--; }
    target.rem = 0;
  }

  // 第 2 階：剩餘 counter 找 ex 壓到 200（為老大指令鋪路）
  while (counters > 0) {
    const exCands = tracker.filter(t => t.rem > 200 && t.isEx);
    if (exCands.length === 0) break;
    const target = exCands.reduce((a, b) => a.rem >= b.rem ? a : b);
    const need = Math.ceil((target.rem - 200) / counterDamage);
    const use = Math.min(need, counters);
    for (let i = 0; i < use; i++) { result.push(target.iid); counters--; }
    target.rem -= use * counterDamage;
  }

  // 第 3 階：殘餘 counter 砸 HP 最高的（最大威脅）
  while (counters > 0) {
    const cands = tracker.filter(t => t.rem > 0);
    if (cands.length === 0) break;
    const target = cands.reduce((a, b) => a.hp >= b.hp ? a : b);
    result.push(target.iid);
    target.rem = Math.max(0, target.rem - counterDamage);
    counters--;
  }
  return result;
}

// v3.71：老大指令 picker — 用 effectiveHP（含對手 ex 戴英雄斗篷等）
function dragapultGustPick(
  bench: CardInstance[], pool: Map<string, Card>, state?: GameState,
): CardInstance | null {
  const exTargets = bench.filter(b => {
    const rem = _remHP(b, pool, state);
    return rem > 0 && rem <= 200 && _isEx(b, pool);
  });
  if (exTargets.length === 0) return null;
  return exTargets.reduce((a, b) => _remHP(a, pool, state) <= _remHP(b, pool, state) ? a : b);
}

// v3.71：腎上腺腦力選對手目標（amount 由 adrenal-brain-count picker 預先決定）
function dragapultAdrenalTarget(
  amount: number, oppActive: CardInstance | null, oppBench: CardInstance[],
  pool: Map<string, Card>, state?: GameState,
): CardInstance | null {
  const allOpp = [...(oppActive ? [oppActive] : []), ...oppBench];
  if (allOpp.length === 0) return null;

  const koTargets = allOpp.filter(p => _remHP(p, pool, state) > 0 && _remHP(p, pool, state) <= amount);
  if (koTargets.length > 0) {
    return koTargets.reduce((a, b) => _remHP(a, pool, state) >= _remHP(b, pool, state) ? a : b);
  }

  for (const p of allOpp) {
    const rem = _remHP(p, pool, state);
    if (rem <= 0) continue;
    const isActiveTgt = oppActive && p.iid === oppActive.iid;
    const newRem = rem - amount;
    if (isActiveTgt && newRem <= 200 && newRem > 0) return p;
    if (!isActiveTgt && newRem <= 60 && newRem > 0) return p;
  }

  return allOpp.reduce((a, b) => {
    const ah = getEffectiveHP(a, pool, state);
    const bh = getEffectiveHP(b, pool, state);
    return ah >= bh ? a : b;
  });
}

// v3.711 hotfix：腎上腺腦力卡面「最多3個」是上限不是玩家選擇 — 全搬機制無 picker。
//   v3.71 加的 dragapultAdrenalCount 已 dead code 刪除。

