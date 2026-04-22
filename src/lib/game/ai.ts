/**
 * PTCG 規則型 AI
 *
 * getAIAction(state, pool) → 下一個應執行的 GameAction，或 null（代表無事可做）
 *
 * 策略優先序：
 *  1. 取獎勵牌
 *  2. 解析待選擇（自動選最佳）
 *  3. 送出新出場（被擊倒後）
 *  4. 主階段：進化 → 打基礎備戰 → 附能量 → 打訓練家 → 使用特性 → 攻擊 → 結束
 */

import type { Card } from '$lib/cards/types';
import type { GameState, GameAction, CardInstance, PendingSelection } from './types';
import {
  getAvailableAttacks, getEvolvableTargets,
  getPlayableTrainers, getPlayableBasics,
  getUsableAbilities, canRetreat, isBasicPokemonCard,
} from './engine';

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
  // 1a. 我作為防守方，active 被擊倒 → 送新出場（優先於一切）
  if (state.players[myIdx].active === null && state.players[myIdx].bench.length > 0) {
    return {
      type: 'SEND_NEW_ACTIVE',
      iid: pickBestActive(state.players[myIdx].bench, pool).iid,
      senderIdx: myIdx,
    };
  }

  // 1b. 我要 resolve 的 pendingSelection（對手用老大的指令等，actor 可能是對手）
  if (state.pendingSelection && state.pendingSelection.actorIdx === myIdx) {
    return autoResolveSelection(state, pool);
  }

  // ── 以下只在輪到我時處理 ─────────────────────────────────────────────
  if (state.activePlayerIndex !== myIdx) return null;

  // 2. 取獎勵牌（只有攻擊方會有 pendingPrizes）
  if (state.pendingPrizes > 0) {
    return { type: 'TAKE_PRIZES', count: state.pendingPrizes };
  }

  // 3. 若有對手的 pendingSelection，我什麼都不能做 — 等對手
  if (state.pendingSelection) return null;

  const player = state.players[myIdx];

  // 4. END 階段 → 結束回合
  if (state.turnPhase === 'end') {
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

  // 打基礎寶可夢到備戰 — 盡量放滿 4 隻防止被一波擊倒
  if (player.bench.length < 4) {
    const basics = getPlayableBasics(state, pool);
    if (basics.length > 0) {
      return { type: 'PLAY_BASIC', iid: basics[0] };
    }
  }

  // 附加能量（附到出場寶可夢，若無則附備戰）
  if (!player.energyAttachedThisTurn && player.active) {
    const energyInHand = player.hand.find(c => pool.get(c.cardId)?.supertype === 'Energy');
    if (energyInHand) {
      // 優先附到出場
      return { type: 'ATTACH_ENERGY', energyIid: energyInHand.iid, targetIid: player.active.iid };
    }
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

  // 使用主動特性
  const abilities = getUsableAbilities(state, pool);
  if (abilities.length > 0) {
    return { type: 'USE_ABILITY', iid: abilities[0].iid, abilityIndex: abilities[0].abilityIndex };
  }

  // 攻擊（選傷害最高的）
  const atkIdxs = getAvailableAttacks(state, pool);
  if (atkIdxs.length > 0 && player.active) {
    const card = pool.get(player.active.cardId);
    const best = atkIdxs.reduce((prev, cur) => {
      const pDmg = parseInt(card?.attacks?.[prev]?.damage ?? '0') || 0;
      const cDmg = parseInt(card?.attacks?.[cur]?.damage ?? '0') || 0;
      return cDmg > pDmg ? cur : prev;
    });
    return { type: 'ATTACK', attackIndex: best };
  }

  // 結束回合
  return { type: 'END_TURN' };
}

// ── Setup 階段 AI ─────────────────────────────────────────────────────────────

function handleSetupAI(state: GameState, pool: Map<string, Card>, pIdx: 0 | 1): GameAction | null {
  // Mulligan 補抽決定：AI 一律接受（有的拿沒理由不拿）
  if ((state.pendingMulliganDraw?.[pIdx] ?? 0) > 0) {
    return { type: 'MULLIGAN_DRAW_DECISION', accept: true, senderIdx: pIdx };
  }
  if (state.setupDone[pIdx]) return null;
  const player = state.players[pIdx];

  // 先選出場（選 HP 最高的基礎；含 ex 基礎）
  if (!player.active) {
    const basics = player.hand.filter(c => isBasicPokemonCard(pool.get(c.cardId)));
    if (basics.length === 0) return null;
    const best = basics.reduce((a, b) =>
      (pool.get(a.cardId)?.hp ?? 0) >= (pool.get(b.cardId)?.hp ?? 0) ? a : b
    );
    return { type: 'PLACE_ACTIVE', iid: best.iid, senderIdx: pIdx };
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
        const top6 = new Set<string>((sel.params?.top6Iids as string[]) ?? []);
        if (f === 'TOP6')            return top6.has(c.iid);
        if (f === 'Supporter:TOP6')  return top6.has(c.iid) && card.subtype === 'Supporter';
        if (f === 'Basic')           return isBasicPokemonCard(card);
        if (f === 'Basic:HP70')      return isBasicPokemonCard(card) && (card.hp ?? 0) <= 70;
        if (f === 'Stage1')          return card.supertype === 'Pokemon' && card.subtype === 'Stage1';
        if (f === 'Stage2')          return card.supertype === 'Pokemon' && card.subtype === 'Stage2';
        if (f === 'Evolution')       return card.supertype === 'Pokemon' && !!card.evolvesFrom;
        if (f === 'PsychicBasic')    return card.supertype === 'Pokemon' && card.subtype !== 'Other' && !card.evolvesFrom && card.pokemonType === 'Psychic';
        if (f === 'TOP8') {
          const top8 = new Set<string>((sel.params?.top8Iids as string[]) ?? []);
          return top8.has(c.iid);
        }
        if (f === 'TOP2') {
          const top2 = new Set<string>((sel.params?.top2Iids as string[]) ?? []);
          return top2.has(c.iid);
        }
        if (f === 'Pokemon')         return card.supertype === 'Pokemon' && card.subtype !== 'Other';
        if (f === 'Energy')          return card.supertype === 'Energy';
        if (f === 'BasicEnergy')     return card.supertype === 'Energy' && card.subtype === 'Basic';
        if (f === 'ex')              return card.supertype === 'Pokemon' && card.subtype === 'ex';
        if (f === 'MegaEx')          return card.supertype === 'Pokemon' && card.subtype === 'ex' && card.name.startsWith('超級');
        if (f === 'Item')            return card.supertype === 'Trainer' && card.subtype === 'Item';
        if (f === 'Supporter')       return card.supertype === 'Trainer' && card.subtype === 'Supporter';
        if (f === 'Stadium')         return card.supertype === 'Trainer' && card.subtype === 'Stadium';
        if (f === 'Tool')            return card.supertype === 'Pokemon' && card.subtype === 'Other';
        if (f === 'Trainer')         return card.supertype === 'Trainer';
        // Wave 42 新增 filter
        if (f === 'CynthiaPokemon') {
          return card.supertype === 'Pokemon' && card.subtype !== 'Other' && card.name.includes('竹蘭的');
        }
        if (f === 'FightingBasicOrFightingEnergy') {
          if (card.supertype === 'Pokemon' && card.subtype !== 'Other' && !card.evolvesFrom && card.pokemonType === 'Fighting') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') {
            if (card.pokemonType === 'Fighting') return true;
            if (card.name.includes('【鬥】') || card.name.includes('【格】')) return true;
          }
          return false;
        }
        if (f === 'PokemonNonRule') {
          if (card.supertype !== 'Pokemon' || card.subtype === 'Other') return false;
          const isRule = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX');
          return !isRule;
        }
        // v2.35：火箭隊新增 filter
        if (f === 'RocketSupporter') {
          return card.supertype === 'Trainer' && card.subtype === 'Supporter' && card.name.includes('火箭隊');
        }
        if (f === 'RocketBasic') {
          return card.supertype === 'Pokemon' && card.subtype !== 'Other' && !card.evolvesFrom && card.name.includes('火箭隊的');
        }
        if (f === 'AnyTrainer') {
          return card.supertype === 'Trainer';
        }
        if (f === 'GrassBasicOrGrassEnergy') {
          if (card.supertype === 'Pokemon' && card.subtype !== 'Other' && !card.evolvesFrom && card.pokemonType === 'Grass') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') {
            if (card.pokemonType === 'Grass') return true;
            if (card.name.includes('【草】')) return true;
          }
          return false;
        }
        return true;
      });
      // 優先選 HP 高的寶可夢
      candidates.sort((a, b) => (pool.get(b.cardId)?.hp ?? 0) - (pool.get(a.cardId)?.hp ?? 0));
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
      // 選 HP 剩最少（最危險的）給支援，否則選最多 HP 的
      const pick = bench[0];
      return { type: 'RESOLVE_SELECTION', selectedIids: [pick.iid] };
    }

    // 對手備戰選擇
    case 'opp-bench-choose': {
      const bench = srcPlayer.bench;
      if (bench.length === 0) return { type: 'RESOLVE_SELECTION', selectedIids: [] };
      // 選剩餘 HP 最少的（最容易擊倒）
      const best = bench.reduce((a, b) => {
        const aRem = (pool.get(a.cardId)?.hp ?? 0) - a.damage;
        const bRem = (pool.get(b.cardId)?.hp ?? 0) - b.damage;
        return aRem <= bRem ? a : b;
      });
      return { type: 'RESOLVE_SELECTION', selectedIids: [best.iid] };
    }

    // 對手任意寶可夢選擇（狙擊羽毛）
    case 'opp-poke-choose': {
      const allOpp: CardInstance[] = [
        ...(srcPlayer.active ? [srcPlayer.active] : []),
        ...srcPlayer.bench,
      ];
      const validIidsOP = sel.params?.validIids as string[] | undefined;
      const oppPool = validIidsOP ? allOpp.filter(c => validIidsOP.includes(c.iid)) : allOpp;
      if (oppPool.length === 0) return { type: 'RESOLVE_SELECTION', selectedIids: [] };
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
      if (f === 'Energy') hand = hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
      else if (f === 'BasicEnergy') hand = hand.filter(c => {
        const card = pool.get(c.cardId);
        return card?.supertype === 'Energy' && card.subtype === 'Basic';
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
      // 選傷害最多的（最需要治療的）
      const best = targets.reduce((a, b) => a.damage >= b.damage ? a : b);
      return { type: 'RESOLVE_SELECTION', selectedIids: [best.iid] };
    }

    // 棄牌區搜尋
    case 'discard-search': {
      const f = sel.filter ?? '';
      let discard = actorPlayer.discard.filter(c => {
        const card = pool.get(c.cardId);
        if (!card) return false;
        if (f === 'PokemonOrEnergy') return (card.supertype === 'Pokemon' && card.subtype !== 'Other') || card.supertype === 'Energy';
        if (f === 'PokemonNonExOrBasicEnergy') {
          if (card.supertype === 'Pokemon' && card.subtype !== 'Other' && card.subtype !== 'ex') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') return true;
          return false;
        }
        if (f === 'BasicEnergy')     return card.supertype === 'Energy';
        return true;
      });
      const count = Math.min(sel.maxCount, discard.length);
      return { type: 'RESOLVE_SELECTION', selectedIids: discard.slice(0, count).map(c => c.iid) };
    }

    default:
      return { type: 'RESOLVE_SELECTION', selectedIids: [] };
  }
}

// ── 輔助 ──────────────────────────────────────────────────────────────────────

/** 從備戰區選最佳的送出（HP 最高） */
function pickBestActive(bench: CardInstance[], pool: Map<string, Card>): CardInstance {
  return bench.reduce((a, b) =>
    (pool.get(a.cardId)?.hp ?? 0) >= (pool.get(b.cardId)?.hp ?? 0) ? a : b
  );
}
