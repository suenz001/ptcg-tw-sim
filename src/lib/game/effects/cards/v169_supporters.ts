/**
 * v2.169 — 卡池清掃 Supporter 第 2 波（peek-top / 牌庫搜 / disruption）
 *
 *   - 辛俐 (12228)：top4 → 選 2 加手 + 剩餘洗回
 *   - 杜若 (17174)：top7 → 寶可夢/訓練家各 1 加手 + 剩餘洗回
 *   - 正輝的輸送 (12243)：top8 → 任意寶可夢加手 + 剩餘洗回
 *   - 女服務生 (17171)：top6 → 1 基本能量附自己寶可夢
 *   - 吹火人 (14396)：牌庫搜 ≤7 基本【火】能量加手
 *   - 越橘的一步棋 (14394)：top7 → 1【惡】寶可夢放備戰（不可第 1 回合）
 *   - 弗圖博士的劇本 (12452)：選 1 隻自己寶可夢回手（其他附加全棄）
 *   - 皮拿 (12277)：對手所有寶可夢各 -1 張特殊能量
 *   - 天星隊手下 (12225)：對手戰鬥場 1 張能量放對手牌庫上方
 *   - 奇樹 (11161)：雙方手牌洗回，各抽剩餘獎賞數
 */

import {
  reg, regR, regG,
  addLog, addPrivateLog, updatePlayer, withPending, shuffle,
  getOwnBenchLimit, isOwnFirstTurn,
} from '../_shared';
import type { CardInstance, PlayerState } from '../../types';

// ── 辛俐 — top4 → 選 2 加手 + 剩餘洗回 ─────────────────────────────────────
regG('辛俐', (st, idx) => st.players[idx].deck.length > 0);
reg('辛俐', (st, idx) => {
  const top4 = st.players[idx].deck.slice(0, 4);
  if (top4.length === 0) return addLog(st, '辛俐：牌庫為空', idx);
  st = addLog(st, `辛俐：查看牌庫頂 ${top4.length} 張，選 2 張加手牌（剩餘洗回）`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: Math.min(2, top4.length), maxCount: Math.min(2, top4.length),
    effectKey: 'shinli-pick',
    params: { topIids: top4.map(c => c.iid) },
  });
});
regR('shinli-pick', (st, idx, iids, params, pool) => {
  const topIids = (params?.topIids as string[] | undefined) ?? [];
  return updatePlayer(st, idx, p => {
    const topSet = new Set(topIids);
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    void names;
    const rest = p.deck.filter(c => !topSet.has(c.iid));
    const remaining = p.deck.filter(c => topSet.has(c.iid) && !iids.includes(c.iid));
    return {
      ...p,
      deck: shuffle([...rest, ...remaining]),
      hand: [...p.hand, ...picked],
    };
  });
});

// ── 杜若 — top7 → 寶可夢 1 + 訓練家 1 加手 ─────────────────────────────────
//   卡面：查看自己的牌庫上方 7 張卡，從其中選擇寶可夢卡與訓練家卡各 1 張，
//        在給對手看過後加入手牌。將剩餘卡放回牌庫並重洗。
//   v4.915 真正修簡化：原 filter:'Pokemon' / 'Trainer' 是「整個牌庫」filter，
//        picker UI 顯示全牌庫所有寶可夢/訓練家 — 等於牌庫任選，違反卡面「從這 7 張中選」。
//        改用 'Pokemon:TOP_N' / 'Trainer:TOP_N' filter（仿 v3.11 拉普拉斯ex Energy:TOP_N
//        pattern），picker UI 真正只顯示 params.topIids 範圍內的卡。
//   minCount=0：卡面雖寫「各 1 張」，依過往實機慣例允許玩家不選（例如沒想要的卡）。
//        v4.914 強制 minCount=1 走錯方向，這版回到 minCount=0。
regG('杜若', (st, idx) => st.players[idx].deck.length > 0);
reg('杜若', (st, idx) => {
  const top7 = st.players[idx].deck.slice(0, 7);
  if (top7.length === 0) return addLog(st, '杜若：牌庫為空', idx);
  st = addLog(st, `杜若：查看牌庫頂 ${top7.length} 張，選 1 寶可夢加手（可跳過）`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon:TOP_N',
    minCount: 0, maxCount: 1,
    effectKey: 'tora-pokemon',
    params: { topIids: top7.map(c => c.iid) },
  });
});
regR('tora-pokemon', (st, idx, iids, params, pool) => {
  const topIids = (params?.topIids as string[] | undefined) ?? [];
  // 把選到的寶可夢加手牌（保留 topIids 給下一階段過濾）
  const set = new Set(iids);
  if (set.size > 0) {
    const picked = st.players[idx].deck.filter(c => set.has(c.iid));
    // v2.96：卡面「給對手看過」→ 公開卡名
    st = addLog(st, `杜若：搜到寶可夢 ${picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、')}`, idx);
  }
  st = updatePlayer(st, idx, p => {
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: rest, hand: [...p.hand, ...got] };
  });
  // v4.915：訓練家階段也改用 Trainer:TOP_N，picker 只顯示剩餘 top7 內的訓練家
  const remainingTopIids = topIids.filter(id => !set.has(id));
  st = addLog(st, '杜若：再選 1 張訓練家加手（可跳過）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Trainer:TOP_N',
    minCount: 0, maxCount: 1,
    effectKey: 'tora-trainer',
    params: { topIids: remainingTopIids },
  });
});
regR('tora-trainer', (st, idx, iids, params, pool) => {
  const topIids = (params?.topIids as string[] | undefined) ?? [];
  const set = new Set(iids);
  if (set.size > 0) {
    const picked = st.players[idx].deck.filter(c => set.has(c.iid));
    // v2.96：卡面「給對手看過」→ 公開卡名
    st = addLog(st, `杜若：搜到訓練家 ${picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、')}`, idx);
  } else {
    st = addLog(st, '杜若：未選訓練家', idx);
  }
  return updatePlayer(st, idx, p => {
    const topSet = new Set(topIids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !topSet.has(c.iid));
    const remaining = p.deck.filter(c => topSet.has(c.iid) && !set.has(c.iid));
    return {
      ...p,
      deck: shuffle([...rest, ...remaining]),
      hand: [...p.hand, ...got],
    };
  });
});

// ── 正輝的輸送 — top8 → 任意數量寶可夢加手 ────────────────────────────────
regG('正輝的輸送', (st, idx) => st.players[idx].deck.length > 0);
reg('正輝的輸送', (st, idx) => {
  const top8 = st.players[idx].deck.slice(0, 8);
  if (top8.length === 0) return addLog(st, '正輝的輸送：牌庫為空', idx);
  st = addLog(st, `正輝的輸送：查看牌庫頂 ${top8.length} 張，選任意寶可夢加手`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 8,
    effectKey: 'masaki-transport',
    params: { topIids: top8.map(c => c.iid) },
  });
});
regR('masaki-transport', (st, idx, iids, params, pool) => {
  const topIids = (params?.topIids as string[] | undefined) ?? [];
  const set = new Set(iids);
  if (set.size > 0) {
    const picked = st.players[idx].deck.filter(c => set.has(c.iid));
    // v2.96：卡面「給對手看過」→ 公開卡名
    st = addLog(st, `正輝的輸送：搜到 ${picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、')} 加入手牌`, idx);
  } else {
    st = addLog(st, '正輝的輸送：未選擇寶可夢', idx);
  }
  return updatePlayer(st, idx, p => {
    const topSet = new Set(topIids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !topSet.has(c.iid));
    const remaining = p.deck.filter(c => topSet.has(c.iid) && !set.has(c.iid));
    return {
      ...p,
      deck: shuffle([...rest, ...remaining]),
      hand: [...p.hand, ...got],
    };
  });
});

// ── 女服務生 — top6 → 1 基本能量附自己寶可夢 ─────────────────────────────
regG('女服務生', (st, idx) => st.players[idx].deck.length > 0 && (!!st.players[idx].active || st.players[idx].bench.length > 0));
reg('女服務生', (st, idx) => {
  const top6 = st.players[idx].deck.slice(0, 6);
  if (top6.length === 0) return addLog(st, '女服務生：牌庫為空', idx);
  st = addLog(st, `女服務生：查看牌庫頂 ${top6.length} 張，選 1 張基本能量附給自己寶可夢`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'waitress-pick-energy',
    params: { topIids: top6.map(c => c.iid) },
  });
});
regR('waitress-pick-energy', (st, idx, iids, params, pool) => {
  const topIids = (params?.topIids as string[] | undefined) ?? [];
  if (iids.length === 0) {
    // 沒選 → 剩餘洗回
    st = addLog(st, '女服務生：未選擇能量', idx);
    return updatePlayer(st, idx, p => {
      const topSet = new Set(topIids);
      const rest = p.deck.filter(c => !topSet.has(c.iid));
      const remaining = p.deck.filter(c => topSet.has(c.iid));
      return { ...p, deck: shuffle([...rest, ...remaining]) };
    });
  }
  const energyIid = iids[0];
  const inst = st.players[idx].deck.find(c => c.iid === energyIid);
  if (!inst) return st;
  const energyName = pool.get(inst.cardId)?.name ?? '能量';
  st = addLog(st, `女服務生：搜到 ${energyName}，選 1 隻自己寶可夢附加`, idx);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'waitress-attach',
    params: { includeActive: true, energyIid, energyName, topIids },
  });
});
regR('waitress-attach', (st, idx, iids, params, pool) => {
  const targetIid = iids[0];
  const energyIid = params?.energyIid as string | undefined;
  const topIids = (params?.topIids as string[] | undefined) ?? [];
  if (!targetIid || !energyIid) return st;
  const player = st.players[idx];
  const energyInst = player.deck.find(c => c.iid === energyIid);
  if (!energyInst) return st;
  const targetInst = player.active?.iid === targetIid
    ? player.active
    : player.bench.find(c => c.iid === targetIid) ?? null;
  if (!targetInst) return st;
  const energyName = pool.get(energyInst.cardId)?.name ?? '能量';
  const targetName = pool.get(targetInst.cardId)?.name ?? '?';
  st = addLog(st, `女服務生：${energyName} 附給 ${targetName}（剩餘洗回牌庫）`, idx);
  return updatePlayer(st, idx, p => {
    const topSet = new Set(topIids);
    const remaining = p.deck.filter(c => topSet.has(c.iid) && c.iid !== energyIid);
    const restBelow = p.deck.filter(c => !topSet.has(c.iid));
    const newDeck = shuffle([...restBelow, ...remaining]);
    const attachTo = (pk: CardInstance) =>
      pk.iid === targetIid
        ? { ...pk, energyAttached: [...pk.energyAttached, energyInst] }
        : pk;
    return {
      ...p,
      deck: newDeck,
      active: p.active ? attachTo(p.active) : null,
      bench: p.bench.map(attachTo),
    };
  });
});

// ── 吹火人 — 牌庫搜 ≤7 基本【火】能量加手 ──────────────────────────────────
regG('', (st, idx) => st.players[idx].deck.length > 0);
// v5.292 修吹火人: filter='BasicEnergy' 沒限定屬性, picker line 2518 不讀 validIids,
//        玩家可選任意基本能量. 改 'BasicEnergy:Fire' 由 picker line 2662 startsWith
//        分支處理, isBasicEnergyOfType(card, 'Fire') 雙重檢查 (pokemonType==='Fire' OR name 含「【火】」).
reg('吹火人', (st, idx, pool) => {
  const candCount = st.players[idx].deck
    .filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Energy' && card.subtype === 'Basic' && card.name?.includes('【火】');
    }).length;
  st = addLog(st, `吹火人：從牌庫選最多 7 張基本【火】能量加手（候選 ${candCount} 張）`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy:Fire',
    minCount: 0, maxCount: 7,
    effectKey: 'firebreather-pick',
  });
});
regR('firebreather-pick', (st, idx, iids, _params, pool) => {
  const set = new Set(iids);
  if (set.size === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '吹火人：未選擇（牌庫已重洗）', idx);
  }
  const picked = st.players[idx].deck.filter(c => set.has(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.96：卡面「給對手看過」→ 公開卡名
  st = addLog(st, `吹火人：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 越橘的一步棋 — top7 → 1 惡寶可夢放備戰，剩餘洗回（不可第 1 回合）──────
regG('越橘的一步棋', (st, idx, pool) => {
  // v5.608：卡面「無法在自己的最初回合使用」→ 用 isOwnFirstTurn(turn===1,涵蓋後攻方第1回合)。
  //   原 st.isFirstTurn 只擋先攻方第1回合 → 後攻方第1回合(isFirstTurn=false,turn仍1)誤放行。
  if (isOwnFirstTurn(st)) return false;
  // v3.78：支援零之大空洞
  if (st.players[idx].bench.length >= getOwnBenchLimit(st, idx, pool)) return false;
  return st.players[idx].deck.length > 0;
});
reg('越橘的一步棋', (st, idx) => {
  const top7 = st.players[idx].deck.slice(0, 7);
  if (top7.length === 0) return addLog(st, '越橘的一步棋：牌庫為空', idx);
  st = addLog(st, `越橘的一步棋：查看牌庫頂 ${top7.length} 張，選 1 張【惡】寶可夢放備戰`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    // v2.42 修正：原本 'Pokemon:Type=Darkness' UI 沒有對應 case → 落到 generic Pokemon:
    //          parser 切出 t='Type=Darkness' 比對 pokemonType 永遠 false → 永遠空清單。
    //          改用專屬 'DarknessPokemon:TOP7'：UI 既限定 top7 又只列【惡】寶可夢。
    filter: 'DarknessPokemon:TOP7',
    minCount: 0, maxCount: 1,
    effectKey: 'lingonberry-pick',
    // 同時保留 topIids（resolver 用於識別 top7 範圍洗回剩餘）+ 新格式 top7Iids（UI 過濾用）
    params: { topIids: top7.map(c => c.iid), top7Iids: top7.map(c => c.iid) },
  });
});
regR('lingonberry-pick', (st, idx, iids, params, pool) => {
  const topIids = (params?.topIids as string[] | undefined)
    ?? (params?.top7Iids as string[] | undefined) ?? [];
  if (iids.length === 0) {
    st = addLog(st, '越橘的一步棋：未選擇', idx);
    return updatePlayer(st, idx, p => {
      const topSet = new Set(topIids);
      const rest = p.deck.filter(c => !topSet.has(c.iid));
      const remaining = p.deck.filter(c => topSet.has(c.iid));
      return { ...p, deck: shuffle([...rest, ...remaining]) };
    });
  }
  const targetIid = iids[0];
  const inst = st.players[idx].deck.find(c => c.iid === targetIid);
  if (!inst) return st;
  // 後置驗證：必須是【惡】
  const card = pool.get(inst.cardId);
  if (card?.pokemonType !== 'Darkness') {
    st = addLog(st, '越橘的一步棋：選擇的寶可夢屬性不符（非【惡】），效果終止', idx);
    return updatePlayer(st, idx, p => {
      const topSet = new Set(topIids);
      const rest = p.deck.filter(c => !topSet.has(c.iid));
      const remaining = p.deck.filter(c => topSet.has(c.iid));
      return { ...p, deck: shuffle([...rest, ...remaining]) };
    });
  }
  const name = pool.get(inst.cardId)?.name ?? '?';
  st = addLog(st, `越橘的一步棋：${name} 放置到備戰區，剩餘洗回牌庫`, idx);
  return updatePlayer(st, idx, p => {
    // v3.78：支援零之大空洞
    if (p.bench.length >= getOwnBenchLimit(st, idx, pool)) return p;
    const topSet = new Set(topIids);
    const rest = p.deck.filter(c => !topSet.has(c.iid));
    const remaining = p.deck.filter(c => topSet.has(c.iid) && c.iid !== targetIid);
    return {
      ...p,
      deck: shuffle([...rest, ...remaining]),
      bench: [...p.bench, { ...inst, justPlaced: true }],
    };
  });
});

// ── 弗圖博士的劇本 — 選 1 自己寶可夢回手（其他附加全棄）──────────────────
regG('弗圖博士的劇本', (st, idx) => !!st.players[idx].active || st.players[idx].bench.length > 0);
reg('弗圖博士的劇本', (st, idx) => {
  st = addLog(st, '弗圖博士的劇本：選 1 隻自己場上寶可夢回手（其他附加卡全棄）', idx);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'fortu-script',
    params: { includeActive: true },
  });
});
regR('fortu-script', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  if (!targetIid) return st;
  const player = st.players[idx];
  const target = player.active?.iid === targetIid
    ? player.active
    : player.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  // 收集 evolvedFromStack（裡面也是寶可夢卡）+ 該寶可夢自身（baseInst） → 全部回手
  // 附加的能量 / 道具 / 特殊狀態 → 全棄到棄牌堆
  const targetName = pool.get(target.cardId)?.name ?? '?';
  const evoStack = target.evolvedFromStack ?? [];
  const energies = target.energyAttached;
  const tool = target.toolAttached;
  // 寶可夢回手（重置 damage, status, energyAttached, toolAttached, evolvedFromStack）
  const cleanInsts: CardInstance[] = [
    { ...target, damage: 0, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined, energyAttached: [], toolAttached: undefined, evolvedFromStack: undefined, evolvedFromIid: undefined, justPlaced: false, playedFromHand: false, evolvedThisTurn: false },
    ...evoStack.map(e => ({ ...e, damage: 0, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined, energyAttached: [], toolAttached: undefined, evolvedFromStack: undefined })),
  ];
  const discardInsts: CardInstance[] = [...energies, ...(tool ? [tool] : [])];
  st = addLog(st, `弗圖博士的劇本：${targetName}（含進化鏈 ${evoStack.length} 張）回手；附加能量 ${energies.length} 張 / 道具 ${tool ? 1 : 0} 張全部棄牌`, idx);
  return updatePlayer(st, idx, p => {
    if (player.active?.iid === targetIid) {
      return {
        ...p,
        active: null,
        hand: [...p.hand, ...cleanInsts],
        discard: [...p.discard, ...discardInsts],
      };
    } else {
      return {
        ...p,
        bench: p.bench.filter(c => c.iid !== targetIid),
        hand: [...p.hand, ...cleanInsts],
        discard: [...p.discard, ...discardInsts],
      };
    }
  });
});

// ── 皮拿 — 對手所有寶可夢各 -1 張特殊能量 ─────────────────────────────────
regG('皮拿', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  return all.some(pk => pk.energyAttached.some(e => {
    const c = pool.get(e.cardId);
    return c?.supertype === 'Energy' && c.subtype === 'Special';
  }));
});
reg('皮拿', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '皮拿：對手所有寶可夢各丟棄 1 張特殊能量', idx);
  return updatePlayer(st, dIdx, p => {
    const discardAdd: CardInstance[] = [];
    const stripOne = (pk: CardInstance): CardInstance => {
      // 由後往前找第 1 張特殊能量
      for (let i = pk.energyAttached.length - 1; i >= 0; i--) {
        const c = pool.get(pk.energyAttached[i].cardId);
        if (c?.supertype === 'Energy' && c.subtype === 'Special') {
          discardAdd.push(pk.energyAttached[i]);
          return {
            ...pk,
            energyAttached: [
              ...pk.energyAttached.slice(0, i),
              ...pk.energyAttached.slice(i + 1),
            ],
          };
        }
      }
      return pk;
    };
    return {
      ...p,
      active: p.active ? stripOne(p.active) : null,
      bench: p.bench.map(stripOne),
      discard: [...p.discard, ...discardAdd],
    };
  });
});

// ── 天星隊手下 — 對手戰鬥場 1 張能量放對手牌庫上方 ───────────────────────
regG('天星隊手下', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  return !!st.players[dIdx].active && st.players[dIdx].active!.energyAttached.length > 0;
});
reg('天星隊手下', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active || dp.active.energyAttached.length === 0) return addLog(st, '天星隊手下：對手戰鬥場無能量', idx);
  // 選 1 張能量
  const energyOptions = dp.active.energyAttached.map((e, i) => ({
    id: `${i}`,
    text: `${pool.get(e.cardId)?.name ?? '能量'}`,
  }));
  st = addLog(st, '天星隊手下：選 1 個對手戰鬥場能量放對手牌庫上方', idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'starlight-grunt-bounce',
    params: { label: '天星隊手下', options: energyOptions },
  });
});
regR('starlight-grunt-bounce', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const choiceIdx = parseInt(iids[0] ?? '-1', 10);
  if (isNaN(choiceIdx) || choiceIdx < 0) return st;
  const dp = st.players[dIdx];
  if (!dp.active || choiceIdx >= dp.active.energyAttached.length) return st;
  const removed = dp.active.energyAttached[choiceIdx];
  const energyName = pool.get(removed.cardId)?.name ?? '能量';
  st = addLog(st, `天星隊手下：對手 ${energyName} 從戰鬥場放回牌庫上方`, idx);
  return updatePlayer(st, dIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: {
        ...p.active,
        energyAttached: [
          ...p.active.energyAttached.slice(0, choiceIdx),
          ...p.active.energyAttached.slice(choiceIdx + 1),
        ],
      },
      deck: [removed, ...p.deck],  // 牌庫上方
    };
  });
});

// ── 奇樹 — 雙方手牌洗回，各抽剩餘獎賞數 ───────────────────────────────────
regG('奇樹', () => true);
reg('奇樹', (st, idx) => {
  st = addLog(st, '奇樹：雙方手牌全部翻反並重洗放回牌庫，各抽剩餘獎賞數', idx);
  const players = [...st.players] as [PlayerState, PlayerState];
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    const newDeck = shuffle([...p.deck, ...p.hand]);
    const drawN = Math.min(p.prizes.length, newDeck.length);
    p.hand = newDeck.slice(0, drawN);
    p.deck = newDeck.slice(drawN);
    players[i] = p;
  }
  return { ...st, players };
});
