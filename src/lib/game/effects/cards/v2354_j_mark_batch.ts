/**
 * J 標 v2.354 批次實裝 — P2/P3 低風險卡牌
 *
 * 群組 A  手牌計數攻擊   — 雙劍鞘（劍武備）
 * 群組 B  對手手牌操作   — 多麗米亞（手部造型）、念力土偶（退化光線）
 * 群組 C  全場道具/特殊能量移除 — 超級毒藻龍ex（腐蝕液）
 * 群組 D  跨回合自身效果 — 老翁龍、莉佳的口呆花、大嘴蝠、頓甲
 * 群組 E  牌庫搜尋攻擊   — 樹才怪（考驗之旅）
 * 群組 F  棄牌區附能攻擊 — 咚咚鼠（擺尾發電）
 * 群組 G  主動特性       — 彩粉蝶（大飛翅）、烈箭鷹（穹天狩獵）、莉佳的霸王花ex（動人香氣）
 */

import type { CardInstance, GameState } from '../../types';
import {
  addLog,
  drawCards,
  regA,
  regPost,
  regPre,
  regR,
  shuffle,
  updatePlayer,
  withPending,
} from '../_shared';

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/** 取 CardInstance 的卡片名稱 */
function cardName(pool: Map<string, any>, inst?: CardInstance | null): string {
  return inst ? (pool.get(inst.cardId)?.name ?? '?') : '?';
}

/** 判斷是否為基本【雷】能量 */
function isBasicLightningEnergy(card: any): boolean {
  return (
    card?.supertype === 'Energy' &&
    card?.subtype === 'Basic' &&
    card?.pokemonType === 'Lightning'
  );
}

/** 計算玩家場上所有寶可夢附加能量總數（active + bench） */
function totalEnergyCount(p: { active: CardInstance | null | undefined; bench: CardInstance[] }): number {
  const all: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  return all.reduce((sum, inst) => sum + inst.energyAttached.length, 0);
}

// ── Group A：手牌計數攻擊 ────────────────────────────────────────────────────

// 雙劍鞘｜劍武備：60×
// 卡面：從自己的手牌將任意數量的「獨劍鞘」「雙劍鞘」「堅盾劍怪」給對手看過後，
//        造成其張數×60點傷害。
// 實裝：計算手牌中符合名稱的卡，damage = count × 60（最少 0）。
const SWORD_NAMES = new Set(['獨劍鞘', '雙劍鞘', '堅盾劍怪']);
regPre('雙劍鞘|劍武備', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const matched = p.hand.filter(c => SWORD_NAMES.has(pool.get(c.cardId)?.name ?? ''));
  const dmg = matched.length * 60;
  const names = matched.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const s = matched.length > 0
    ? addLog(state, `劍武備：展示手牌中 ${matched.length} 張（${names}）→ ${dmg} 傷害`, aIdx)
    : addLog(state, '劍武備：手牌中無獨劍鞘/雙劍鞘/堅盾劍怪 → 0 傷害', aIdx);
  return { state: s, damage: dmg };
});

// ── Group B：對手手牌操作 ─────────────────────────────────────────────────────

// 多麗米亞｜手部造型：0 傷
// 卡面：在不看正面的情況下，將對手的手牌丟棄直到張數變為5張為止。
// 實裝：對手手牌超過 5 張時，從手牌頭部隨機移除至剩 5 張（不看正面 = 隨機）。
regPre('多麗米亞|手部造型', (state) => ({ state, damage: 0 }));
regPost('多麗米亞|手部造型', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = state.players[dIdx];
  if (dp.hand.length <= 5) {
    return addLog(state, '手部造型：對手手牌 ≤5 張，無效果', aIdx);
  }
  const removeCount = dp.hand.length - 5;
  // 隨機打亂後取前 removeCount 張作為丟棄目標（不看正面 = 隨機）
  const shuffledHand = shuffle([...dp.hand]);
  const toDiscard = shuffledHand.slice(0, removeCount);
  const remaining = shuffledHand.slice(removeCount);
  const discardSet = new Set(toDiscard.map(c => c.iid));
  let s = addLog(state, `手部造型：將對手手牌丟棄 ${removeCount} 張（剩餘 5 張）`, aIdx);
  return updatePlayer(s, dIdx, p => ({
    ...p,
    hand: p.hand.filter(c => !discardSet.has(c.iid)),
    discard: [...p.discard, ...toDiscard],
  }));
});

// 念力土偶｜退化光線：50 傷 + 對手戰鬥寶可夢退化1階（進化卡回對手手牌）
// 卡面：50 從對手的進化的戰鬥寶可夢身上，移除1張「進化卡」使其退化。
//        將移除的卡放回對手的手牌。
// 實裝：damage = 50；regPost 處理對手 active 退化邏輯。
// ⚠️ 只能對進化寶可夢使用（若對手 active 為基礎，則退化效果不觸發）
regPre('念力土偶|退化光線', (state) => ({ state, damage: 50 }));
regPost('念力土偶|退化光線', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = state.players[dIdx];
  if (!dp.active) return addLog(state, '退化光線：對手無戰鬥寶可夢', aIdx);

  const defCard = pool.get(dp.active.cardId);
  const isEvolved = defCard?.stage === 'Stage1' || defCard?.stage === 'Stage2';
  if (!isEvolved || !dp.active.evolvedFromStack || dp.active.evolvedFromStack.length === 0) {
    return addLog(state, '退化光線：對手戰鬥寶可夢非進化寶可夢，無退化效果', aIdx);
  }

  const defName = defCard?.name ?? '?';
  // 從 evolvedFromStack 取最頂（最近一次進化前的狀態）
  const stack = [...dp.active.evolvedFromStack];
  const prev = stack.pop()!;

  // 把目前 cardId（進化卡）加回對手「手牌」
  const evoCardInst: CardInstance = {
    iid: `${dp.active.iid}_evo_returned_${dp.active.cardId}_${Math.random().toString(36).slice(2, 8)}`,
    cardId: dp.active.cardId,
    energyAttached: [],
    damage: 0,
  };

  // 退化後的寶可夢保留 HP/能量/道具，清除特殊狀態
  const devolvedActive: CardInstance = {
    ...dp.active,
    cardId: prev.cardId,
    evolvedFromStack: stack.length > 0 ? stack : undefined,
    evolvedFromIid: stack.length > 0 ? stack[stack.length - 1].iid : undefined,
    evolvedThisTurn: true, // 退化後本回合不可再進化
    status: undefined,
    secondaryStatus: undefined,
    cantAttackThisTurn: undefined,
    cantAttackPending: undefined,
    cantRetreatNextTurn: undefined,
    damageReduceNextHit: undefined,
  };

  const prevName = pool.get(prev.cardId)?.name ?? '?';
  let s = addLog(state, `退化光線：${defName} 退化為 ${prevName}，進化卡回對手手牌`, aIdx);
  return updatePlayer(s, dIdx, p => ({
    ...p,
    active: devolvedActive,
    hand: [...p.hand, evoCardInst],
  }));
});

// ── Group C：全場道具/特殊能量移除 ──────────────────────────────────────────

// 超級毒藻龍ex｜腐蝕液：0 傷 + 移除對手全部寶可夢的道具 & 特殊能量
// 卡面：將對手的所有寶可夢身上附加的「寶可夢道具」卡與「特殊能量」卡全部丟棄。
// 實裝：遍歷對手 active + bench，拆除 toolAttached 與所有 Special Energy。
regPre('超級毒藻龍ex|腐蝕液', (state) => ({ state, damage: 0 }));
regPost('超級毒藻龍ex|腐蝕液', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = state.players[dIdx];
  const allOpp: CardInstance[] = [...(dp.active ? [dp.active] : []), ...dp.bench];

  // 收集所有要丟棄的卡
  const toDiscard: CardInstance[] = [];
  for (const inst of allOpp) {
    if (inst.toolAttached) toDiscard.push(inst.toolAttached);
    for (const e of inst.energyAttached) {
      const ec = pool.get(e.cardId);
      if (ec?.supertype === 'Energy' && ec.subtype === 'Special') toDiscard.push(e);
    }
  }

  if (toDiscard.length === 0) {
    return addLog(state, '腐蝕液：對手場上無道具或特殊能量', aIdx);
  }

  const discardIids = new Set(toDiscard.map(c => c.iid));
  let s = addLog(state, `腐蝕液：移除對手場上所有道具 & 特殊能量（${toDiscard.length} 張）`, aIdx);

  return updatePlayer(s, dIdx, p => {
    const strip = (inst: CardInstance): CardInstance => ({
      ...inst,
      toolAttached: discardIids.has(inst.toolAttached?.iid ?? '') ? undefined : inst.toolAttached,
      energyAttached: inst.energyAttached.filter(e => !discardIids.has(e.iid)),
    });
    return {
      ...p,
      active: p.active ? strip(p.active) : null,
      bench: p.bench.map(strip),
      discard: [...p.discard, ...toDiscard],
    };
  });
});

// ── Group D：跨回合自身效果 ──────────────────────────────────────────────────

// 老翁龍｜龍之強襲：120 + 下回合自身無法使用「龍之強襲」
// 卡面：120 在下個自己的回合，這隻寶可夢無法使用「龍之強襲」。
// 實裝：regPost 設 blockedAttackNamesNextTurn = ['龍之強襲']
regPre('老翁龍|龍之強襲', (state) => ({ state, damage: 120 }));
regPost('老翁龍|龍之強襲', (state, aIdx) =>
  updatePlayer(
    addLog(state, '龍之強襲：下回合此寶可夢無法再使用「龍之強襲」', aIdx),
    aIdx,
    p => p.active
      ? { ...p, active: { ...p.active, blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), '龍之強襲'] } }
      : p,
  ),
);

// 莉佳的口呆花｜葉子旋風：70 + 下回合自身無法使用招式
// 卡面：70 在下個自己的回合，這隻寶可夢無法使用招式。
// 實裝：regPost 設 cantAttackPending = true（END_TURN promote 為 cantAttackThisTurn）
regPre('莉佳的口呆花|葉子旋風', (state) => ({ state, damage: 70 }));
regPost('莉佳的口呆花|葉子旋風', (state, aIdx) =>
  updatePlayer(
    addLog(state, '葉子旋風：下回合此寶可夢無法使用招式', aIdx),
    aIdx,
    p => p.active ? { ...p, active: { ...p.active, cantAttackPending: true } } : p,
  ),
);

// 大嘴蝠｜隱密飛行：30 + 下回合不受【基礎】寶可夢招式傷害
// 卡面：30 在下個對手的回合，這隻寶可夢不會受到【基礎】寶可夢招式的傷害。
// 實裝：regPost 設 immuneToBasicAttackNextTurn = true
regPre('大嘴蝠|隱密飛行', (state) => ({ state, damage: 30 }));
regPost('大嘴蝠|隱密飛行', (state, aIdx) =>
  updatePlayer(
    addLog(state, '隱密飛行：下個對手回合，此寶可夢不受【基礎】寶可夢招式傷害', aIdx),
    aIdx,
    p => p.active ? { ...p, active: { ...p.active, immuneToBasicAttackNextTurn: true } } : p,
  ),
);

// 頓甲｜接二連三：20 + 下回合自身招式傷害 +120
// 卡面：20 在下個自己的回合，這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+120」點。
// 實裝：regPost 設 damageBonusPending = 120（END_TURN promote 為 damageBonusThisTurn）
regPre('頓甲|接二連三', (state) => ({ state, damage: 20 }));
regPost('頓甲|接二連三', (state, aIdx) =>
  updatePlayer(
    addLog(state, '接二連三：下回合此寶可夢招式傷害 +120', aIdx),
    aIdx,
    p => p.active ? { ...p, active: { ...p.active, damageBonusPending: 120 } } : p,
  ),
);

// ── Group E：牌庫搜尋攻擊 ────────────────────────────────────────────────────

// 樹才怪｜考驗之旅：0 傷 + 從牌庫選最多 2 張「變化之書」加手牌
// 卡面：從自己的牌庫選擇最多2張「變化之書」，在給對手看過後加入手牌。並且重洗牌庫。
// 實裝：0 傷 + deck-search 過濾名稱 → search-to-hand-reshuffle
regPre('樹才怪|考驗之旅', (state) => ({ state, damage: 0 }));
regPost('樹才怪|考驗之旅', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const cand = p.deck.filter(c => pool.get(c.cardId)?.name === '變化之書');
  if (cand.length === 0) {
    return addLog(state, '考驗之旅：牌庫中無「變化之書」', aIdx);
  }
  const realMax = Math.min(2, cand.length);
  const s = addLog(state, `考驗之旅：從牌庫選最多 ${realMax} 張「變化之書」加手牌（重洗）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Any',
    minCount: 0,
    maxCount: realMax,
    effectKey: 'j-2354-morphbk-search',
    params: { validIids: cand.map(c => c.iid), label: '考驗之旅' },
  });
});
regR('j-2354-morphbk-search', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '考驗之旅';
  const validIids = new Set((params?.validIids as string[]) ?? []);
  // 只接受真正是「變化之書」的選擇
  const validPicks = iids.filter(id => validIids.has(id));
  return updatePlayer(
    addLog(state, `${label}：取得 ${validPicks.length} 張「變化之書」加手牌（重洗）`, aIdx),
    aIdx,
    p => {
      const picked = p.deck.filter(c => validPicks.includes(c.iid));
      const rest = p.deck.filter(c => !validPicks.includes(c.iid));
      return { ...p, hand: [...p.hand, ...picked], deck: shuffle(rest) };
    },
  );
});

// ── Group F：棄牌區附能攻擊 ──────────────────────────────────────────────────

// 咚咚鼠｜擺尾發電：0 傷 + 從棄牌區選基本【雷】能量附於自己的【雷】寶可夢
// 卡面：從自己的棄牌區選擇最多與對手的所有寶可夢身上附加的能量的數量相同數量的
//        「基本【雷】能量」卡，以任意方式附於自己的【雷】寶可夢身上。
// 實裝：N = 對手全場能量總數；discard-search(基本雷, 0~N)；
//        若自己只有1隻雷寶可夢 → 直接附加；多隻 → heal-target 選目標
// ⚠️ 簡化：多隻【雷】寶可夢時，全部附到同一隻選擇的目標寶可夢
regPre('咚咚鼠|擺尾發電', (state) => ({ state, damage: 0 }));
regPost('咚咚鼠|擺尾發電', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = state.players[dIdx];

  // 計算上限 N = 對手全場能量總數
  const oppEnergyTotal = totalEnergyCount(dp);
  if (oppEnergyTotal === 0) {
    return addLog(state, '擺尾發電：對手場上無附加能量，無法選取', aIdx);
  }

  // 自己棄牌區中的基本【雷】能量
  const cand = p.discard.filter(c => isBasicLightningEnergy(pool.get(c.cardId)));
  if (cand.length === 0) {
    return addLog(state, '擺尾發電：棄牌區無基本【雷】能量', aIdx);
  }

  // 自己場上的【雷】寶可夢（active + bench）
  const lightningPokes = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ].filter(inst => pool.get(inst.cardId)?.pokemonType === 'Lightning');

  if (lightningPokes.length === 0) {
    return addLog(state, '擺尾發電：場上無【雷】寶可夢可附加', aIdx);
  }

  const realMax = Math.min(oppEnergyTotal, cand.length);
  const s = addLog(
    state,
    `擺尾發電：從棄牌選最多 ${realMax} 張基本【雷】能量附於【雷】寶可夢（上限 N=${oppEnergyTotal}）`,
    aIdx,
  );
  return withPending(s, {
    type: 'discard-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Energy:Lightning',
    minCount: 0,
    maxCount: realMax,
    effectKey: 'j-2354-raichu-charge-pick',
    params: {
      label: '擺尾發電',
      validIids: cand.map(c => c.iid),
      lightningPokeIids: lightningPokes.map(c => c.iid),
    },
  });
});

/**
 * 選完棄牌區基本【雷】能量後：
 * - 若只有 1 隻【雷】寶可夢 → 直接附加
 * - 若有多隻 → heal-target 選目標（全部附到同一隻）
 */
regR('j-2354-raichu-charge-pick', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '擺尾發電';
  if (iids.length === 0) return addLog(state, `${label}：未選擇`, aIdx);

  const lightningPokeIids = (params?.lightningPokeIids as string[]) ?? [];
  const p = state.players[aIdx];

  // 實際選中的能量（留在 discard 中）
  const picked = p.discard.filter(c => iids.includes(c.iid));
  if (picked.length === 0) return addLog(state, `${label}：能量不存在`, aIdx);

  // 只剩 1 隻【雷】寶可夢 → 自動附加
  if (lightningPokeIids.length === 1) {
    const targetIid = lightningPokeIids[0];
    const all = [...(p.active ? [p.active] : []), ...p.bench];
    const target = all.find(c => c.iid === targetIid);
    if (!target) return addLog(state, `${label}：目標不存在`, aIdx);
    const tname = cardName(pool, target);
    const pickedSet = new Set(picked.map(c => c.iid));
    let s = addLog(state, `${label}：將 ${picked.length} 張基本【雷】能量附加到 ${tname}`, aIdx);
    return updatePlayer(s, aIdx, pl => {
      const attach = (inst: CardInstance): CardInstance =>
        inst.iid === targetIid
          ? { ...inst, energyAttached: [...inst.energyAttached, ...picked] }
          : inst;
      return {
        ...pl,
        discard: pl.discard.filter(c => !pickedSet.has(c.iid)),
        active: pl.active ? attach(pl.active) : null,
        bench: pl.bench.map(attach),
      };
    });
  }

  // 多隻【雷】寶可夢 → heal-target 選目標
  const s = addLog(state, `${label}：選擇要附加 ${picked.length} 張基本【雷】能量的【雷】寶可夢`, aIdx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'j-2354-raichu-charge-commit',
    params: { energyIids: iids, label, validIids: lightningPokeIids },
  });
});

/** heal-target 選完後：從棄牌區取出能量，附加到選定【雷】寶可夢 */
regR('j-2354-raichu-charge-commit', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '擺尾發電';
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];
  if (!targetIid || energyIids.length === 0) return state;

  const p = state.players[aIdx];
  const pickedSet = new Set(energyIids);
  const energies = p.discard.filter(c => pickedSet.has(c.iid));
  if (energies.length === 0) return state;

  const all = [...(p.active ? [p.active] : []), ...p.bench];
  const target = all.find(c => c.iid === targetIid);
  if (!target) return state;

  const tname = cardName(pool, target);
  let s = addLog(state, `${label}：將 ${energies.length} 張基本【雷】能量附加到 ${tname}`, aIdx);
  return updatePlayer(s, aIdx, pl => {
    const attach = (inst: CardInstance): CardInstance =>
      inst.iid === targetIid
        ? { ...inst, energyAttached: [...inst.energyAttached, ...energies] }
        : inst;
    return {
      ...pl,
      discard: pl.discard.filter(c => !pickedSet.has(c.iid)),
      active: pl.active ? attach(pl.active) : null,
      bench: pl.bench.map(attach),
    };
  });
});

// ── Group G：主動特性 ────────────────────────────────────────────────────────

// 彩粉蝶｜大飛翅（特性，1 回 1 次）
// 卡面：在自己的回合時可使用1次。對手將對手自己的手牌全部翻回反面並重洗，
//        放回牌庫下方。然後，對手從牌庫抽出4張卡。
// 實裝：opp.hand 洗亂後附到 opp.deck 尾端，再 drawCards(dIdx, 4)
regA('彩粉蝶', 0, (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (dp.hand.length === 0 && dp.deck.length === 0) {
    return addLog(st, '大飛翅：對手手牌與牌庫均為空', idx);
  }
  let s = st;
  if (dp.hand.length > 0) {
    // 洗亂手牌後放到牌庫下方
    const shuffledHand = shuffle([...dp.hand]);
    s = updatePlayer(s, dIdx, p => ({
      ...p,
      hand: [],
      deck: [...p.deck, ...shuffledHand],
    }));
    s = addLog(s, `大飛翅：對手 ${shuffledHand.length} 張手牌洗亂後放回牌庫下方`, idx);
  } else {
    s = addLog(s, '大飛翅：對手手牌為空，跳過放回牌庫', idx);
  }
  // 對手從牌庫抽 4 張
  const drawCount = Math.min(4, s.players[dIdx].deck.length);
  if (drawCount > 0) {
    s = drawCards(s, dIdx, drawCount);
    s = addLog(s, `大飛翅：對手抽 ${drawCount} 張`, idx);
  } else {
    s = addLog(s, '大飛翅：對手牌庫已空，無法抽牌', idx);
  }
  return s;
});

// 烈箭鷹｜穹天狩獵（特性，1 回 1 次）
// 卡面：在自己的回合時可使用1次。擲1次硬幣若為正面，則在不看正面的情況下，
//        從對手的手牌選擇1張，將其丟棄。
// 實裝：Math.random() 決定正反；正面 → 隨機丟棄 1 張對手手牌
regA('烈箭鷹', 0, (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  const isHeads = Math.random() < 0.5;
  let s = addLog(st, `穹天狩獵：擲硬幣 — ${isHeads ? '正面' : '反面'}`, idx);
  if (!isHeads) return addLog(s, '穹天狩獵：反面，無效果', idx);

  const dp = s.players[dIdx];
  if (dp.hand.length === 0) return addLog(s, '穹天狩獵：正面，但對手手牌為空', idx);

  // 隨機選 1 張（不看正面）
  const randIdx = Math.floor(Math.random() * dp.hand.length);
  const discarded = dp.hand[randIdx];
  s = addLog(s, '穹天狩獵：正面，盲選 1 張對手手牌丟棄', idx);
  return updatePlayer(s, dIdx, p => ({
    ...p,
    hand: p.hand.filter((_, i) => i !== randIdx),
    discard: [...p.discard, discarded],
  }));
});

// 莉佳的霸王花ex｜動人香氣（特性，1 回 1 次）
// 卡面：在自己的回合時可使用1次。將自己的所有寶可夢各恢復「30」HP。
// 實裝：active + bench 全部 damage = max(0, damage - 30)
regA('莉佳的霸王花ex', 0, (st, idx, pool) => {
  const p = st.players[idx];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  const canHeal = all.some(inst => inst.damage >= 10); // 至少有 1 隻有傷害才有意義
  let healCount = 0;
  let s = addLog(st, '動人香氣：回復自己所有寶可夢各 30 HP', idx);
  return updatePlayer(s, idx, pl => {
    const heal = (inst: CardInstance): CardInstance => {
      if (inst.damage <= 0) return inst;
      const maxHp = pool.get(inst.cardId)?.hp ?? 0;
      const healed = Math.max(0, inst.damage - 30);
      return { ...inst, damage: healed };
    };
    return {
      ...pl,
      active: pl.active ? heal(pl.active) : null,
      bench: pl.bench.map(heal),
    };
  });
});
