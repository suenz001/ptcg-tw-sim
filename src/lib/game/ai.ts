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
      const score = (iid: string): number => {
        const inst = player.hand.find(c => c.iid === iid);
        if (!inst) return 0;
        const card = pool.get(inst.cardId);
        if (!card) return 0;
        let s = card.hp ?? 0;
        if (handEvolutionTargets.has(card.name)) s += 1000; // 大幅優先能進化的
        if (/^(N的|火箭隊的|竹蘭的|阿響的|莉莉艾的|火箭隊)/.test(card.name)) s += 500; // 冠名次優先
        return s;
      };
      const sorted = [...basics].sort((a, b) => score(b) - score(a));
      return { type: 'PLAY_BASIC', iid: sorted[0] };
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
    // v2.141 評估招式潛在傷害 — 處理「暗黑底牌」這類複製招式
    //   原本只看 attacks[i].damage，但暗黑底牌 damage='' 會被低估為 0。
    //   改為：暗黑底牌時，跨備戰所有 N寶可夢的招式找最強 damage 作為估值。
    const estimateDamage = (atkIdx: number): number => {
      const atk = card?.attacks?.[atkIdx];
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
        // v2.56 寶可裝置3.0：牌庫頂 7 張中的支援者
        if (f === 'Supporter:TOP7') {
          const top7 = new Set<string>((sel.params?.top7Iids as string[]) ?? []);
          return top7.has(c.iid) && card.subtype === 'Supporter';
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
        if (f === 'FightingBasicOrFightingEnergy') {
          if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Fighting') return true;
          if (card.supertype === 'Energy' && card.subtype === 'Basic') {
            if (card.pokemonType === 'Fighting') return true;
            if (card.name.includes('【鬥】') || card.name.includes('【格】')) return true;
          }
          return false;
        }
        if (f === 'PokemonNonRule') {
          if (card.supertype !== 'Pokemon') return false;
          const isRule = card.subtype === 'ex' || card.name.endsWith('ex') || card.name.endsWith('EX');
          return !isRule;
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
      // 單選：選 HP 剩最少（最危險的）給支援
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
    case 'modal-choice': {
      const opts = (sel.params?.options as Array<{ id: string; text: string; disabled?: boolean }>) ?? [];
      // AI 簡化：選第一個非 disabled 選項
      const first = opts.find(o => !o.disabled) ?? opts[0];
      return { type: 'RESOLVE_SELECTION', selectedIids: first ? [first.id] : [] };
    }

    // v2.164 reorder-deck-top：排序牌庫頂 N 張（推理組合 / 蕾荷）
    case 'reorder-deck-top': {
      const candIids = (sel.params?.candidateIids as string[] | undefined) ?? [];
      // AI 簡化：保留所有候選並維持原順序（即使 allowDiscard 也不丟棄）
      return { type: 'RESOLVE_SELECTION', selectedIids: [...candIids] };
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
