/**
 * v2.65 I 標 Wave 15 — 雜項第八批（25 張）
 *
 * 涵蓋：
 *   - 進化牌庫搜尋簡化 (5 張) — 從牌庫挑 1 張 Pokemon 卡加手牌（玩家手動進化）
 *   - 對手棄手牌 (3 張) — 對手選 N 張對手自己手牌棄
 *   - 場上條件 ×N (5 張)
 *   - 棄能量 + 額外效果 (3 張)
 *   - 自殘 + 狀態 (2 張)
 *   - 自身招式 +N (1 張)
 *   - 看對手牌庫頂 (2 張)
 *   - 其他條件 (3 張)
 *   - 雜 (1 張)
 */

import { regPre, regPost, regR, addLog, updatePlayer, withPending, shuffle, sameEvoName, ATTACK_PRE_DISCARD_CHOICE } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { coinStatusPost, flipCoinsWithLog, statusPost } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 共用 helper
// ══════════════════════════════════════════════════════════════════════════════

// 從牌庫挑 ≤1 張寶可夢加手牌（簡化版進化搜尋）
// v4.963: 基本能量 pokemonType=null fallback helper — 認屬性能量含 name【X】 fallback。
function isEnergyOfType(ec: any, type: string): boolean {
  if (!ec || ec.supertype !== 'Energy') return false;
  if (ec.pokemonType === type) return true;
  const m = (ec.name || '').match(/【(.+?)】/);
  if (!m) return false;
  const zh: Record<string, string> = { '草':'Grass','火':'Fire','水':'Water','雷':'Lightning','超':'Psychic','鬥':'Fighting','惡':'Darkness','鋼':'Metal','妖':'Fairy','龍':'Dragon','無':'Colorless' };
  return zh[m[1]] === type;
}

function deckPickOnePokemonToHandPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫已空`, aIdx);
    const s = addLog(state, `${label}：從牌庫挑 ≤1 張寶可夢加手牌（玩家手動進化；重洗）`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Pokemon',
      minCount: 0, maxCount: 1,
      effectKey: 'wave13-deck-take-any',  // 復用 v2.63 既有 resolver
    });
  };
}

// 對手選 N 張對手自己手牌棄掉
function oppHandDiscardPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.hand.length === 0) return addLog(state, `${label}：對手手牌已空`, aIdx);
    const k = Math.min(n, opp.hand.length);
    const s = addLog(state, `${label}：對手選 ${k} 張對手自己的手牌丟棄`, aIdx);
    return withPending(s, {
      type: 'hand-discard',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: k, maxCount: k,
      effectKey: 'wave15-opp-hand-discard',
      params: { label },
    });
  };
}
regR('wave15-opp-hand-discard', (state, _actorIdx, iids, params, _pool) => {
  // _actorIdx 是對手（被對手控制的玩家）；要把那些卡從那位玩家的 hand 移到 discard
  const label = (params?.label as string | undefined) ?? '勒緊';
  if (iids.length === 0) return addLog(state, `${label}：未棄牌`, _actorIdx);
  const set = new Set(iids);
  return updatePlayer(
    addLog(state, `${label}：對手丟棄 ${iids.length} 張手牌`, _actorIdx),
    _actorIdx, p => {
      const discarded = p.hand.filter(c => set.has(c.iid));
      const remaining = p.hand.filter(c => !set.has(c.iid));
      return { ...p, hand: remaining, discard: [...p.discard, ...discarded] };
    },
  );
});

// 看對手牌庫頂 5 張並排序
function viewOppDeckTopReorderPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.deck.length === 0) return addLog(state, `${label}：對手牌庫已空`, aIdx);
    const realN = Math.min(n, opp.deck.length);
    const top = opp.deck.slice(0, realN);
    const s = addLog(state, `${label}：查看對手牌庫頂 ${realN} 張並重新排序`, aIdx);
    return withPending(s, {
      type: 'reorder-deck-top',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: realN, maxCount: realN,
      effectKey: 'wave15-opp-deck-reorder',
      params: {
        candidateIids: top.map(c => c.iid),
        titleOverride: `${label}：排序對手牌庫頂 ${realN} 張`,
      },
    });
  };
}
regR('wave15-opp-deck-reorder', (state, actorIdx, selectedIids, _params, _pool) => {
  // selectedIids = 玩家排好的 iid 順序（index 0 = top of deck）
  const dIdx = (1 - actorIdx) as 0 | 1;
  return updatePlayer(state, dIdx, p => {
    const set = new Set(selectedIids);
    const top = selectedIids.map(iid => p.deck.find(c => c.iid === iid)!).filter(Boolean);
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: [...top, ...rest] };
  });
});

// 棄自身 N 個能量（從尾端取）
function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) {
      return addLog(state, `${label}：自身無能量可丟棄`, aIdx);
    }
    const k = Math.min(n, att.energyAttached.length);
    const s = addLog(state, `${label}：自身丟棄 ${k} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - k);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - k);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

// 棄自身全能量
function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) {
      return addLog(state, `${label}：自身無能量可丟棄`, aIdx);
    }
    const s = addLog(state, `${label}：自身丟棄全部能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const discarded = p.active.energyAttached;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...discarded] };
    });
  };
}

// 自殘 N HP
function selfHitPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    return updatePlayer(
      addLog(state, `${label}：自身受到 ${amount} 點傷害`, aIdx),
      aIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + amount } : null,
      }),
    );
  };
}

// 對手 1 隻備戰受 N
function snipeOneOppBenchPost(amount: number, label: string, exOnly: boolean = false): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.bench.length === 0) return addLog(state, `${label}：對手備戰區無寶可夢`, aIdx);
    const s = addLog(state, `${label}：選 1 隻對手備戰寶可夢，受到 ${amount} 點傷害${exOnly ? '（限 ex）' : ''}`, aIdx);
    return withPending(s, {
      type: 'opp-bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      filter: exOnly ? 'ex' : undefined,
      minCount: 1, maxCount: 1,
      effectKey: 'wave3a-snipe-bench',
      params: { amount, label },
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 進化牌庫搜尋（5 張）— 全部簡化為「從牌庫挑 1 張寶可夢加手牌」（玩家手動進化）
// ══════════════════════════════════════════════════════════════════════════════
// v5.082：夢妖|覺醒 + 火箭隊的沙基拉斯|爆裂覺醒 移到下面 direct-evolve 區塊（仿伊布|覺醒）。
// v5.083：雙卵細胞球|細胞進化 + 人造細胞卵|細胞覺醒 移到下方 chain picker 區塊。
// EVOLVE_SEARCH 目前為空 — 保留 array 容器避免破壞 import / 結構，未來新卡可加回。
// 火箭隊的尼多娜|惡之覺醒 — v4.38 提升為 2-stage chain（自方【惡】base × deck evolve）
const EVOLVE_SEARCH: Array<[string, number]> = [];
for (const [key, dmg] of EVOLVE_SEARCH) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, deckPickOnePokemonToHandPost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// v5.083：雙卵細胞球|細胞進化 — direct-evolve picker（任一自方場上寶可夢）
// 卡面：「從自己的牌庫選擇1張自己的1隻場上寶可夢進化而來的卡，放置於那隻寶可夢身上完成進化。
//        並且重洗牌庫。」
// pattern：仿惡之覺醒 2-stage（單 base 版本）—
//   Phase A: bench-choose（includeActive=true，無屬性限制）選自方任一場上寶可夢
//   Phase B: deck-search 從牌庫挑該寶可夢的進化卡 → 進化於 base 身上
// ══════════════════════════════════════════════════════════════════════════════
regPre('雙卵細胞球|細胞進化', (s) => ({ state: s, damage: 0 }));
regPost('雙卵細胞球|細胞進化', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const fieldPokemon: CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  // 過濾「牌庫中有對應進化卡」的場上寶可夢（避免選了卻沒得搜 — UX 提示）
  const validIids = fieldPokemon
    .filter(c => {
      const card = pool.get(c.cardId);
      if (!card) return false;
      return p.deck.some(d => {
        const dc = pool.get(d.cardId);
        return dc?.evolvesFrom && sameEvoName(dc.evolvesFrom, card.name);
      });
    })
    .map(c => c.iid);
  if (validIids.length === 0) {
    return updatePlayer(addLog(state, '細胞進化：場上無可進化寶可夢；重洗牌庫', aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const s = addLog(state, '細胞進化：選擇 1 隻自方場上寶可夢進化（可跳過）', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 0, maxCount: 1,
    effectKey: 'twin-cell-evolve-pick-base',
    params: {
      includeActive: true,
      validIids,
      titleOverride: '細胞進化：選擇 1 隻自方場上寶可夢進化（可跳過）',
    },
  });
});
regR('twin-cell-evolve-pick-base', (st, aIdx, iids, _params, pool) => {
  if (iids.length === 0) {
    return updatePlayer(addLog(st, '細胞進化：不選擇任何寶可夢進化；重洗牌庫', aIdx),
      aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const baseIid = iids[0];
  const p = st.players[aIdx];
  const base = p.active?.iid === baseIid ? p.active : p.bench.find(c => c.iid === baseIid);
  if (!base) {
    return updatePlayer(addLog(st, '細胞進化：找不到所選的基礎；重洗牌庫', aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const baseCard = pool.get(base.cardId);
  if (!baseCard) {
    return updatePlayer(addLog(st, '細胞進化：基礎卡資料異常；重洗牌庫', aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const validEvoIids = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
    return sameEvoName(card.evolvesFrom, baseCard.name);
  }).map(c => c.iid);
  if (validEvoIids.length === 0) {
    return updatePlayer(addLog(st, `細胞進化：牌庫中無「${baseCard.name}」的進化卡；重洗牌庫`, aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const s = addLog(st, `細胞進化：從牌庫選「${baseCard.name}」的進化卡（可跳過）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'EvilAwakening:EvolveFrom',  // 復用既有 filter（同樣 base name 搜進化）
    minCount: 0, maxCount: 1,
    effectKey: 'twin-cell-evolve-do',
    params: {
      baseIid, baseName: baseCard.name,
      titleOverride: `細胞進化：從牌庫選「${baseCard.name}」的進化卡（可跳過）`,
    },
  });
});
regR('twin-cell-evolve-do', (st, aIdx, iids, params, pool) => {
  const baseIid = params?.baseIid as string | undefined;
  const baseName = (params?.baseName as string | undefined) ?? '?';
  let s = st;
  if (iids.length > 0 && baseIid) {
    const evoIid = iids[0];
    const p = s.players[aIdx];
    const evoInst = p.deck.find(c => c.iid === evoIid);
    const base = p.active?.iid === baseIid ? p.active : p.bench.find(c => c.iid === baseIid);
    if (evoInst && base) {
      const evoCard = pool.get(evoInst.cardId);
      if (evoCard) {
        const isActive = p.active?.iid === baseIid;
        const prevStack = base.evolvedFromStack ?? [];
        const baseBare: CardInstance = {
          ...base, energyAttached: [], toolAttached: undefined, evolvedFromStack: undefined,
        };
        const evolved: CardInstance = {
          ...evoInst,
          damage: base.damage,
          energyAttached: base.energyAttached,
          toolAttached: base.toolAttached,
          status: base.status,
          evolvedFromIid: base.iid,
          evolvedFromStack: [...prevStack, baseBare],
          evolvedThisTurn: true,
          justPlaced: false, playedFromHand: false,
        };
        s = updatePlayer(s, aIdx, x => ({
          ...x,
          deck: x.deck.filter(c => c.iid !== evoIid),
          active: isActive ? evolved : x.active,
          bench: isActive ? x.bench : x.bench.map(c => c.iid === baseIid ? evolved : c),
        }));
        s = addLog(s, `細胞進化：「${baseName}」進化為「${evoCard.name}」`, aIdx);
      }
    }
  } else {
    s = addLog(s, `細胞進化：玩家不選擇「${baseName}」的進化卡`, aIdx);
  }
  return updatePlayer(addLog(s, '細胞進化：重洗牌庫', aIdx),
    aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
});

// ══════════════════════════════════════════════════════════════════════════════
// v5.083：人造細胞卵|細胞覺醒 — 所有備戰逐一進化（chain）
// 卡面：「從自己的牌庫，選擇自己的所有備戰寶可夢進化而來的卡各1張，放置於各自身上完成進化。
//        並且重洗牌庫。」
// pattern：chain — 逐隻備戰開 deck-search picker，挑該寶可夢進化卡 → 進化 → 進下隻
//   - benchIdx 0..N-1 依序處理；params 紀錄當前 index + baseIid
//   - 收尾：所有備戰處理完 → 重洗牌庫
// ══════════════════════════════════════════════════════════════════════════════
function cellAwakeningStep(
  s: GameState, aIdx: 0 | 1, pool: Map<string, Card>, benchIdx: number,
): GameState {
  const p = s.players[aIdx];
  if (benchIdx >= p.bench.length) {
    // 全部備戰處理完，重洗牌庫
    return updatePlayer(addLog(s, '細胞覺醒：所有備戰處理完，重洗牌庫', aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const base = p.bench[benchIdx];
  const baseCard = pool.get(base.cardId);
  if (!baseCard) return cellAwakeningStep(s, aIdx, pool, benchIdx + 1);
  // 牌庫中有可進化的卡嗎？
  const validEvoIids = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
    return sameEvoName(card.evolvesFrom, baseCard.name);
  }).map(c => c.iid);
  if (validEvoIids.length === 0) {
    s = addLog(s, `細胞覺醒：牌庫中無「${baseCard.name}」的進化卡（跳過）`, aIdx);
    return cellAwakeningStep(s, aIdx, pool, benchIdx + 1);
  }
  s = addLog(s, `細胞覺醒：從牌庫選「${baseCard.name}」的進化卡（可跳過；第 ${benchIdx + 1} 隻備戰）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'EvilAwakening:EvolveFrom',
    minCount: 0, maxCount: 1,
    effectKey: 'cell-awaken-evolve-step',
    params: {
      baseIid: base.iid,
      baseName: baseCard.name,
      benchIdx,
      titleOverride: `細胞覺醒：從牌庫選「${baseCard.name}」的進化卡（可跳過）`,
    },
  });
}
regPre('人造細胞卵|細胞覺醒', (s) => ({ state: s, damage: 0 }));
regPost('人造細胞卵|細胞覺醒', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    return updatePlayer(addLog(state, '細胞覺醒：備戰區無寶可夢；重洗牌庫', aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  return cellAwakeningStep(state, aIdx, pool, 0);
});
regR('cell-awaken-evolve-step', (st, aIdx, iids, params, pool) => {
  const baseIid = params?.baseIid as string | undefined;
  const baseName = (params?.baseName as string | undefined) ?? '?';
  const benchIdx = (params?.benchIdx as number | undefined) ?? 0;
  let s = st;
  if (iids.length > 0 && baseIid) {
    const evoIid = iids[0];
    const p = s.players[aIdx];
    const evoInst = p.deck.find(c => c.iid === evoIid);
    const base = p.bench.find(c => c.iid === baseIid);
    if (evoInst && base) {
      const evoCard = pool.get(evoInst.cardId);
      if (evoCard) {
        const prevStack = base.evolvedFromStack ?? [];
        const baseBare: CardInstance = {
          ...base, energyAttached: [], toolAttached: undefined, evolvedFromStack: undefined,
        };
        const evolved: CardInstance = {
          ...evoInst,
          damage: base.damage,
          energyAttached: base.energyAttached,
          toolAttached: base.toolAttached,
          status: base.status,
          evolvedFromIid: base.iid,
          evolvedFromStack: [...prevStack, baseBare],
          evolvedThisTurn: true,
          justPlaced: false, playedFromHand: false,
        };
        s = updatePlayer(s, aIdx, x => ({
          ...x,
          deck: x.deck.filter(c => c.iid !== evoIid),
          bench: x.bench.map(c => c.iid === baseIid ? evolved : c),
        }));
        s = addLog(s, `細胞覺醒：「${baseName}」進化為「${evoCard.name}」`, aIdx);
      }
    }
  } else {
    s = addLog(s, `細胞覺醒：玩家跳過「${baseName}」`, aIdx);
  }
  // 進下一隻備戰
  return cellAwakeningStep(s, aIdx, pool, benchIdx + 1);
});

// ══════════════════════════════════════════════════════════════════════════════
// v5.082：夢妖|覺醒 + 火箭隊的沙基拉斯|爆裂覺醒 直接進化（仿伊布|覺醒 / 石居蟹|覺醒）
//   卡面：「從自己的牌庫選擇1張從這隻寶可夢進化而來的卡，放置於這隻寶可夢身上完成進化。」
//   舊版 EVOLVE_SEARCH 簡化為「加手」違反卡面（Rule 15）。
//   pattern: filter validIids=deck 中 evolvesFrom=base 名稱的進化卡，resolver 把該卡
//   放戰鬥場完成進化（保留 damage / energy / tool / 推進 evolvedFromStack）+ 重洗牌庫。
// ══════════════════════════════════════════════════════════════════════════════
const DIRECT_EVOLVE_AWAKEN: Array<[string, string, number, string]> = [
  // [attackKey, baseName, damage, effectKey]
  ['夢妖|覺醒',                  '夢妖',             0,  'misdreavus-awaken-evolve'],
  ['火箭隊的沙基拉斯|爆裂覺醒',   '火箭隊的沙基拉斯',  30, 'tr-larvitar-awaken-evolve'],
];
for (const [attackKey, baseName, dmg, effectKey] of DIRECT_EVOLVE_AWAKEN) {
  regPre(attackKey, (s) => ({ state: s, damage: dmg }));
  regPost(attackKey, (state, aIdx, pool) => {
    const player = state.players[aIdx];
    if (!player.active) {
      return addLog(state, `${attackKey.split('|')[1]}：戰鬥場無寶可夢`, aIdx);
    }
    const activeCard = pool.get(player.active.cardId);
    if (activeCard?.name !== baseName) {
      // 戰鬥場已非該 base（例如被招式換走 — 罕見）— 改重洗
      return updatePlayer(
        addLog(state, `${attackKey.split('|')[1]}：戰鬥場已非「${baseName}」，僅重洗牌庫`, aIdx),
        aIdx, p => ({ ...p, deck: shuffle(p.deck) }),
      );
    }
    // 從牌庫挑「evolvesFrom === baseName」的進化卡
    const validIids = player.deck
      .filter(c => pool.get(c.cardId)?.evolvesFrom === baseName)
      .map(c => c.iid);
    const s = addLog(state,
      validIids.length > 0
        ? `${attackKey.split('|')[1]}：從牌庫選 1 張從「${baseName}」進化而來的卡，立即進化於自身`
        : `${attackKey.split('|')[1]}：牌庫內無對應的進化卡（仍進行搜尋並重洗）`,
      aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Evolution',
      minCount: 0, maxCount: 1,
      effectKey,
      params: { validIids, baseName },
    });
  });
  // resolver：把 evolution 直接進化於戰鬥場（仿石居蟹|覺醒 / 伊布|覺醒）
  regR(effectKey, (state, aIdx, iids, params, pool) => {
    const baseN = (params?.baseName as string | undefined) ?? baseName;
    const player = state.players[aIdx];
    if (iids.length === 0 || !player.active) {
      return updatePlayer(state, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
    }
    const evoIid = iids[0];
    const evoIdx = player.deck.findIndex(c => c.iid === evoIid);
    if (evoIdx < 0) {
      return addLog(state, `${attackKey.split('|')[1]}：找不到所選進化卡，僅重洗牌庫`, aIdx);
    }
    const evoInst = player.deck[evoIdx];
    const evoCard = pool.get(evoInst.cardId);
    if (!evoCard?.evolvesFrom || evoCard.evolvesFrom !== baseN) {
      return addLog(state, `${attackKey.split('|')[1]}：所選非從「${baseN}」進化的卡，僅重洗牌庫`, aIdx);
    }
    const activeCard = pool.get(player.active.cardId);
    if (activeCard?.name !== baseN) {
      return addLog(state, `${attackKey.split('|')[1]}：戰鬥場已非「${baseN}」，僅重洗牌庫`, aIdx);
    }
    const base = player.active;
    const evolved: CardInstance = {
      ...evoInst,
      iid: base.iid,
      damage: base.damage,
      energyAttached: base.energyAttached,
      toolAttached: base.toolAttached,
      status: base.status,
      evolvedFromStack: [
        ...(base.evolvedFromStack ?? []),
        // chain entry 不帶 base 的 transient turn flags（同 engine.ts baseBare 修法）
        {
          iid: `${base.iid}_base_${base.cardId}_${Math.random().toString(36).slice(2, 8)}`,
          cardId: base.cardId,
          damage: 0,
          energyAttached: [],
          toolAttached: undefined,
          extraTools: [],
          evolvedFromStack: undefined,
        },
      ],
      evolvedThisTurn: true,
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
    let s = state;
    s = updatePlayer(s, aIdx, p => ({
      ...p,
      active: evolved,
      deck: shuffle(p.deck.filter((_, i) => i !== evoIdx)),
    }));
    return addLog(s, `${attackKey.split('|')[1]}：${evoCard.name} 進化於戰鬥場的「${baseN}」，並重洗牌庫`, aIdx);
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// 1b. 火箭隊的尼多娜｜惡之覺醒（v4.38 完整實裝 — 2-stage × 2-base chain）
// JSON：「選擇最多2隻自己的【惡】寶可夢，從自己的牌庫選擇從那些寶可夢進化而來的卡
//        各1張，放置於各自身上完成進化。並且重洗牌庫。」
// ══════════════════════════════════════════════════════════════════════════════

// helper: 開 Phase A picker（選自方【惡】base，可選 active/bench）
function evilAwakeningPickBase(
  s: GameState, aIdx: 0 | 1, pool: Map<string, Card>,
  baseIdx: 1 | 2, prevBaseIid: string | undefined,
): GameState {
  const p = s.players[aIdx];
  const fieldPokemon: CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  // 過濾【惡】寶可夢 + 排除已選的第 1 隻
  const validIids = fieldPokemon
    .filter(c => {
      if (c.iid === prevBaseIid) return false;
      const card = pool.get(c.cardId);
      return card?.pokemonType === 'Darkness';
    })
    .map(c => c.iid);
  if (validIids.length === 0) {
    const msg = baseIdx === 1 ? '惡之覺醒：場上無自方【惡】寶可夢；重洗牌庫'
                              : '惡之覺醒：無更多自方【惡】可選；重洗牌庫';
    return updatePlayer(addLog(s, msg, aIdx), aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  s = addLog(s, `惡之覺醒：選擇第 ${baseIdx} 隻自方【惡】寶可夢進化（可跳過）`, aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 0, maxCount: 1,
    effectKey: 'evil-awakening-pick-base',
    params: {
      includeActive: true,
      validIids,
      baseIdx,
      prevBaseIid,
      titleOverride: `惡之覺醒：選擇第 ${baseIdx} 隻自方【惡】寶可夢進化（可跳過）`,
    },
  });
}

// Phase A resolver — 玩家選完 base → 開 Phase B 搜 evolution
regR('evil-awakening-pick-base', (st, aIdx, iids, params, pool) => {
  const baseIdx = (params?.baseIdx as 1 | 2) ?? 1;
  const prevBaseIid = params?.prevBaseIid as string | undefined;
  if (iids.length === 0) {
    // 跳過此 base
    if (baseIdx === 1) {
      return updatePlayer(addLog(st, '惡之覺醒：玩家不選擇任何寶可夢進化；重洗牌庫', aIdx),
        aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
    }
    return updatePlayer(addLog(st, '惡之覺醒：第 2 隻跳過；重洗牌庫', aIdx),
      aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const baseIid = iids[0];
  const p = st.players[aIdx];
  const base = p.active?.iid === baseIid ? p.active : p.bench.find(c => c.iid === baseIid);
  if (!base) {
    return updatePlayer(addLog(st, '惡之覺醒：找不到所選的基礎；重洗牌庫', aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const baseCard = pool.get(base.cardId);
  if (!baseCard) {
    return updatePlayer(addLog(st, '惡之覺醒：基礎卡資料異常；重洗牌庫', aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  // 檢查牌庫是否有可搜的進化卡
  const validEvoIids = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
    return sameEvoName(card.evolvesFrom, baseCard.name);
  }).map(c => c.iid);
  if (validEvoIids.length === 0) {
    let s = addLog(st, `惡之覺醒：牌庫中無「${baseCard.name}」的進化卡`, aIdx);
    if (baseIdx === 1) {
      return evilAwakeningPickBase(s, aIdx, pool, 2, baseIid);
    }
    return updatePlayer(addLog(s, '惡之覺醒：重洗牌庫', aIdx),
      aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const s = addLog(st, `惡之覺醒：從牌庫選「${baseCard.name}」的進化卡（可跳過）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'EvilAwakening:EvolveFrom',
    minCount: 0, maxCount: 1,
    effectKey: 'evil-awakening-evolve',
    params: {
      baseIid, baseName: baseCard.name,
      baseIdx, prevBaseIid,
      titleOverride: `惡之覺醒：從牌庫選「${baseCard.name}」的進化卡（可跳過）`,
    },
  });
});

// Phase B resolver — 牌庫挑完 evolution → 做進化（仿壯偉碩木）→ 進下一階段或收尾
regR('evil-awakening-evolve', (st, aIdx, iids, params, pool) => {
  const baseIid = params?.baseIid as string | undefined;
  const baseName = (params?.baseName as string | undefined) ?? '?';
  const baseIdx = (params?.baseIdx as 1 | 2) ?? 1;
  let s = st;
  if (iids.length > 0 && baseIid) {
    const evoIid = iids[0];
    const p = s.players[aIdx];
    const evoInst = p.deck.find(c => c.iid === evoIid);
    const base = p.active?.iid === baseIid ? p.active : p.bench.find(c => c.iid === baseIid);
    if (evoInst && base) {
      const evoCard = pool.get(evoInst.cardId);
      if (evoCard) {
        // 進化邏輯（仿 v172 __sturdyDoEvolveStep1）
        const isActive = p.active?.iid === baseIid;
        const prevStack = base.evolvedFromStack ?? [];
        const baseBare: CardInstance = {
          ...base, energyAttached: [], toolAttached: undefined, evolvedFromStack: undefined,
        };
        const evolved: CardInstance = {
          ...evoInst,
          damage: base.damage,
          energyAttached: base.energyAttached,
          toolAttached: base.toolAttached,
          status: base.status,
          evolvedFromIid: base.iid,
          evolvedFromStack: [...prevStack, baseBare],
          evolvedThisTurn: true,
          justPlaced: false, playedFromHand: false,
        };
        s = updatePlayer(s, aIdx, x => ({
          ...x,
          deck: x.deck.filter(c => c.iid !== evoIid),
          active: isActive ? evolved : x.active,
          bench: isActive ? x.bench : x.bench.map(c => c.iid === baseIid ? evolved : c),
        }));
        s = addLog(s, `惡之覺醒：「${baseName}」進化為「${evoCard.name}」`, aIdx);
      }
    }
  } else {
    s = addLog(s, `惡之覺醒：玩家不選擇「${baseName}」的進化卡`, aIdx);
  }
  // 進下一階段（base 2）或收尾
  if (baseIdx === 1) {
    return evilAwakeningPickBase(s, aIdx, pool, 2, baseIid);
  }
  return updatePlayer(addLog(s, '惡之覺醒：重洗牌庫', aIdx),
    aIdx, x => ({ ...x, deck: shuffle(x.deck) }));
});

// Entry：取代簡化版註冊
regPre('火箭隊的尼多娜|惡之覺醒', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的尼多娜|惡之覺醒', (state, aIdx, pool) => {
  return evilAwakeningPickBase(state, aIdx, pool, 1, undefined);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 對手棄手牌（3 張）— 黑眼鱷/混混鱷/流氓鱷｜勒緊
// ══════════════════════════════════════════════════════════════════════════════
const HAND_DISCARD: Array<[string, number, number]> = [  // [key, dmg, n]
  ['黑眼鱷|勒緊', 10, 1],
  ['混混鱷|勒緊', 40, 2],
  ['流氓鱷|勒緊', 60, 2],
];
for (const [key, dmg, n] of HAND_DISCARD) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, oppHandDiscardPost(n, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. 場上條件 ×N（5 張）
// ══════════════════════════════════════════════════════════════════════════════

// 火箭隊的操陷蛛｜火箭猛攻 — 自方場上「火箭隊的寶可夢」數 × 30
regPre('火箭隊的操陷蛛|火箭猛攻', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let count = 0;
  for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
    const card = pool.get(c.cardId);
    if (card?.name?.startsWith('火箭隊的')) count++;
  }
  const dmg = count * 30;
  return { state: addLog(state, `火箭猛攻：場上火箭隊寶可夢 ${count} 隻 → ${count}×30 = ${dmg}`, aIdx), damage: dmg };
});

// 奇樹的霹靂電球｜連鎖伏特 — 20 + 自方場上所有「奇樹的寶可夢」身上雷能量總數 × 20
regPre('奇樹的霹靂電球|連鎖伏特', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let lightning = 0;
  for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
    const card = pool.get(c.cardId);
    if (!card?.name?.startsWith('奇樹的')) continue;
    for (const e of c.energyAttached) {
      if (isEnergyOfType(pool.get(e.cardId), 'Lightning')) lightning++;
    }
  }
  const dmg = 20 + lightning * 20;
  return { state: addLog(state, `連鎖伏特：奇樹寶可雷能量 ${lightning} 個 → 20 + ${lightning}×20 = ${dmg}`, aIdx), damage: dmg };
});

// 洛托姆｜配件秀 — 自方所有寶可夢身上附加的「寶可夢道具」數量 × 30
regPre('洛托姆|配件秀', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let toolCount = 0;
  for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
    if (c.toolAttached) {
      const tool = pool.get(c.toolAttached.cardId);
      if (tool?.subtype === 'Tool' || tool?.subtype === 'PokemonTool') toolCount++;
    }
  }
  const dmg = toolCount * 30;
  return { state: addLog(state, `配件秀：自方寶可道具 ${toolCount} 個 → ${toolCount}×30 = ${dmg}`, aIdx), damage: dmg };
});

// 流氓鱷｜咒詛猛擊 — 120 + 對手手牌 ≤3 張時 +120
regPre('流氓鱷|咒詛猛擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const handN = state.players[dIdx].hand.length;
  if (handN <= 3) {
    return { state: addLog(state, `咒詛猛擊：對手手牌 ${handN} 張 ≤3 → 120+120 = 240`, aIdx), damage: 240 };
  }
  return { state: addLog(state, `咒詛猛擊：對手手牌 ${handN} 張 > 3 → 120`, aIdx), damage: 120 };
});

// 劈斬司令｜致命刺擊 — 60 + 對手戰鬥場有指示物時 +60
regPre('劈斬司令|致命刺擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dmgCounter = state.players[dIdx].active?.damage ?? 0;
  if (dmgCounter > 0) {
    return { state: addLog(state, `致命刺擊：對手戰鬥場有 ${dmgCounter} 傷害 → 60+60 = 120`, aIdx), damage: 120 };
  }
  return { state: addLog(state, `致命刺擊：對手無指示物 → 60`, aIdx), damage: 60 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 棄能量 + 額外效果（3 張）
// ══════════════════════════════════════════════════════════════════════════════

// 超級麻麻鰻魚王ex｜災難衝擊 190 — 卡面：「若希望，將2個這隻寶可夢身上附加的【雷】能量丟棄，將對手的戰鬥寶可夢【麻痺】。」
//   v3.26 修：原實裝強制棄 2 雷能量 + 強制麻痺，違反卡面「若希望」。
//   v4.17 重構：binary-yes-no → attacker picker + energyTypeFilter='Lightning' + countMode='units'。
//   - picker 只顯示視為【雷】的能量（含新衝天 on Stage2）
//   - _computeExactRequired '災難衝擊'=2 → 玩家選 0 或恰好 2 units（全或無）
//   - 選 0 → 190 base，不麻痺；選 2 units → 棄 + 麻痺
ATTACK_PRE_DISCARD_CHOICE.set('超級麻麻鰻魚王ex|災難衝擊', {
  min: 0, max: 2, scope: 'attacker',
  baseDamage: 190, damagePerEnergy: 0,
  countMode: 'units',
  energyTypeFilter: 'Lightning',
});
regPre('超級麻麻鰻魚王ex|災難衝擊', (s) => ({ state: s, damage: 190 }));
regPost('超級麻麻鰻魚王ex|災難衝擊', (state, aIdx, pool, action) => {
  const chosenIids = action?.discardedEnergyIids ?? [];
  if (chosenIids.length === 0) {
    return addLog(state, '災難衝擊：未棄能量 → 不麻痺對手', aIdx);
  }
  // exactRequired=2 確保 picker UI 端 units 已 = 2；regPost 只負責丟 + 麻痺
  const att = state.players[aIdx].active;
  if (!att) return state;
  const idSet = new Set(chosenIids);
  const drop = att.energyAttached.filter(e => idSet.has(e.iid));
  if (drop.length === 0) {
    return addLog(state, '災難衝擊：所選能量不在身上 → 不麻痺對手', aIdx);
  }
  let s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: { ...p.active, energyAttached: p.active.energyAttached.filter(e => !idSet.has(e.iid)) },
      discard: [...p.discard, ...drop],
    };
  });
  s = addLog(s, `災難衝擊：棄 ${drop.length} 張視為【雷】的能量 → 對手麻痺`, aIdx);
  // 對手戰鬥場麻痺
  return statusPost('paralyzed')(s, aIdx, pool);
});

// 火焰雞｜業火連踢 120 — 棄 2 能量, 對手 1 隻備戰也受到 120
regPre('火焰雞|業火連踢', (s) => ({ state: s, damage: 120 }));
regPost('火焰雞|業火連踢', (state, aIdx, pool) => {
  let s = selfDiscardNEnergyPost(2, '業火連踢')(state, aIdx, pool);
  return snipeOneOppBenchPost(120, '業火連踢')(s, aIdx, pool);
});

// 捷拉奧拉｜閃電急襲 — 棄全能量, 對手備戰區 1 隻 ex 受 210
regPre('捷拉奧拉|閃電急襲', (s) => ({ state: s, damage: 0 }));
regPost('捷拉奧拉|閃電急襲', (state, aIdx, pool) => {
  let s = selfDiscardAllEnergyPost('閃電急襲')(state, aIdx, pool);
  return snipeOneOppBenchPost(210, '閃電急襲', true)(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 自殘 + 狀態（2 張）
// ══════════════════════════════════════════════════════════════════════════════

// 巴布土撥｜怒氣拳 130 — v5.060 補 binary-yes-no（原註解「簡化必中無若希望 UI」漏實裝）
//   卡面：「若希望，這隻寶可夢也受到60點傷害，將對手的戰鬥寶可夢【麻痺】。」
//   Yes → 130 damage + 自殘 60 + 對手麻痺；No → 130 damage 純傷害無麻痺
//   注意：base damage 不變（130 都會打到），yes/no 影響的是自殘+麻痺加值。
ATTACK_PRE_DISCARD_CHOICE.set('巴布土撥|怒氣拳', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 130, damagePerEnergy: 0,
  choicePrompt: '是否讓這隻寶可夢自身受 60 點傷害並將對手的戰鬥寶可夢【麻痺】？',
  choiceYesLabel: '是（自殘 60 + 麻痺對手）',
  choiceNoLabel: '否（僅 130 傷害，不自殘不麻痺）',
});
regPre('巴布土撥|怒氣拳', (s) => ({ state: s, damage: 130 }));
regPost('巴布土撥|怒氣拳', (state, aIdx, pool, action) => {
  // 玩家選「否」（或 length=0）→ 不自殘不麻痺；AI 預設 yes
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return addLog(state, '怒氣拳：選擇「否」 → 純 130 傷害，不自殘不麻痺', aIdx);
  let s = selfHitPost(60, '怒氣拳')(state, aIdx, pool);
  s = statusPost('paralyzed')(s, aIdx, pool);
  return s;
});

// 奇樹的頑皮雷彈｜怦怦炸彈 — 自殘 100, 擲幣正面對手戰鬥昏厥（直接 KO，簡化）
regPre('奇樹的頑皮雷彈|怦怦炸彈', (s) => ({ state: s, damage: 0 }));
regPost('奇樹的頑皮雷彈|怦怦炸彈', (state, aIdx, pool) => {
  let s = selfHitPost(100, '怦怦炸彈')(state, aIdx, pool);
  // 擲幣正面對手戰鬥昏厥（簡化：用 asleep 狀態替代，因引擎無 'fainted' 即時狀態）
  // 此處改用 KO 方式：直接設定對手 active.damage = HP
  const r = flipCoinsWithLog(s, 1, '怦怦炸彈', aIdx);
  s = r.state;
  if (r.heads === 1) {
    const dIdx = (1 - aIdx) as 0 | 1;
    const da = s.players[dIdx].active;
    if (da) {
      const card = pool.get(da.cardId);
      const hp = card?.hp ?? 0;
      s = updatePlayer(s, dIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damage: hp } : null,
      }));
      s = addLog(s, '怦怦炸彈：正面 → 對手戰鬥寶可夢昏厥', aIdx);
    }
  } else {
    s = addLog(s, '怦怦炸彈：反面', aIdx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 自身招式 +N — 步哨鼠｜聚氣（下回合「必殺門牙」傷害改為 240）
// ══════════════════════════════════════════════════════════════════════════════
regPre('步哨鼠|聚氣', (s) => ({ state: s, damage: 0 }));
regPost('步哨鼠|聚氣', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '聚氣：下回合自身招式 +160（針對「必殺門牙」效果為 80 → 240）', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        damageBonusPending: 160,  // +160 → 必殺門牙 80 + 160 = 240（簡化：所有招式都 +160）
      } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 看對手牌庫頂排序（2 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('哥德小童|天眼', (s) => ({ state: s, damage: 0 }));
regPost('哥德小童|天眼', viewOppDeckTopReorderPost(5, '天眼'));

regPre('火箭隊的天罩蟲|攪亂雷達', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的天罩蟲|攪亂雷達', viewOppDeckTopReorderPost(5, '攪亂雷達'));

// ══════════════════════════════════════════════════════════════════════════════
// 8. 其他條件（3 張）
// ══════════════════════════════════════════════════════════════════════════════

// 鐵螯龍蝦｜反撲剪 130 —「若這隻寶可夢身上放置有傷害指示物，則這個招式只需要1個惡能量即可使用」
//   能量 cost reduction 屬於招式 cost 規則，本批簡化為純 130 傷害（玩家自行記憶能量條件）
regPre('鐵螯龍蝦|反撲剪', (s) => ({ state: s, damage: 130 }));

// 酋雷姆ex｜雪爆發 130 — 對手所有備戰各受到對手已獲得獎賞數 ×10
regPre('酋雷姆ex|雪爆發', (s) => ({ state: s, damage: 130 }));
regPost('酋雷姆ex|雪爆發', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppPrizesTaken = 6 - state.players[dIdx].prizes.length;
  const amount = oppPrizesTaken * 10;
  if (amount === 0) return addLog(state, '雪爆發：對手未取獎賞，備戰無傷害', aIdx);
  return updatePlayer(
    addLog(state, `雪爆發：對手備戰各受 ${amount} 點傷害（對手已取獎賞 ${oppPrizesTaken} 張）`, aIdx),
    dIdx, p => ({
      ...p,
      bench: p.bench.map(b => ({ ...b, damage: (b.damage ?? 0) + amount })),
    }),
  );
});

// 巨炭山｜瀝青加農炮 — 棄牌區 ≥10 張基本鬥能量否則失敗 + 對手 1 隻寶可夢 140
regPre('巨炭山|瀝青加農炮', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let fightEnergyCount = 0;
  for (const c of p.discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Fighting' || card.name.includes('【鬥】'))) fightEnergyCount++;
  }
  if (fightEnergyCount < 10) {
    return { state: addLog(state, `瀝青加農炮：棄牌區基本鬥能量僅 ${fightEnergyCount} 張 < 10 → 招式失敗`, aIdx), damage: 0 };
  }
  return { state: addLog(state, `瀝青加農炮：棄牌區基本鬥能量 ${fightEnergyCount} 張 ≥ 10 → 對手 1 隻寶可夢受 140`, aIdx), damage: 0 };
});
regPost('巨炭山|瀝青加農炮', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let fightEnergyCount = 0;
  for (const c of p.discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Fighting' || card.name.includes('【鬥】'))) fightEnergyCount++;
  }
  if (fightEnergyCount < 10) return state;
  // 選對手 1 隻寶可夢（含戰鬥場）
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const total = (opp.active ? 1 : 0) + opp.bench.length;
  if (total === 0) return state;
  const s = addLog(state, '瀝青加農炮：選 1 隻對手寶可夢受 140', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave15-asphalt-cannon',
    params: { amount: 140 },
  });
});
regR('wave15-asphalt-cannon', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 0;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  return updatePlayer(state, dIdx, p => {
    if (p.active && p.active.iid === targetIid) {
      return { ...p, active: { ...p.active, damage: (p.active.damage ?? 0) + amount } };
    }
    return { ...p, bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: (b.damage ?? 0) + amount } : b) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 雜（1 張）— N的象徵鳥｜勝利象徵
//   「使用這個招式時，若自己剩餘獎賞卡的張數為 1 張，則這場對戰己方獲勝。」
// ══════════════════════════════════════════════════════════════════════════════
regPre("N的象徵鳥|勝利象徵", (s) => ({ state: s, damage: 0 }));
regPost('N的象徵鳥|勝利象徵', (state, aIdx, _pool) => {
  const myPrizes = state.players[aIdx].prizes.length;
  if (myPrizes === 1) {
    // v5.090：直接 set phase='game-over' + winner + winReason（鏡射 engine.ts L5025 KO 勝利 pattern）。
    //   原 v2.65 只清空 prizes 但 engine 不會自動 detect 獎賞清空，AI 對手會繼續行動。
    //   卡面：「則這場對戰己方獲勝」應立即終局。
    const winnerName = state.players[aIdx].name;
    const s = addLog(state, '勝利象徵：自方獎賞剩 1 張 → 觸發勝利', aIdx);
    return {
      ...s,
      phase: 'game-over' as const,
      winner: aIdx,
      winReason: '勝利象徵特殊勝利條件達成',
      log: [
        ...s.log,
        { turn: s.turn, playerIndex: null as null, message: `勝利象徵：${winnerName} 觸發特殊勝利條件，獲勝！` },
      ],
    };
  }
  return addLog(state, `勝利象徵：自方獎賞剩 ${myPrizes} 張，未滿足條件`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 15 統計：25 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
