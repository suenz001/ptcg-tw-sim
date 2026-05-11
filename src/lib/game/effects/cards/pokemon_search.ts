/**
 * 搜尋寶可夢類訓練家（球 + 搜尋 Supporter） — 模組化批次 v2.19 (Session 38c0)
 *
 * 原位於 effects.ts L200–L316 + L369–L425：
 *   物品：好友寶芬 / 赫普的包包 / 甜蜜球 / 黑暗球 / 高級球 / 超級信號
 *   Supporter：小剛的發掘（機制同球類—從牌庫搜寶可夢加手牌，放同檔以共用 resolver）
 *
 * 共用 resolver：
 *   - bench-basic-from-deck：搜到的基礎寶可夢放備戰區（好友寶芬 / 赫普的包包）
 *   - search-pokemon-to-hand：搜到的寶可夢加手牌（甜蜜球 / 黑暗球 / 小剛的發掘 / 高級球 / 超級信號）
 *   - ultra-ball-discard：高級球兩階段（先丟手牌、再 withPending 進 deck-search → search-pokemon-to-hand）
 *
 * 這些卡只依賴 _shared 的登錄函式 + 純 helper，無攻擊系統 / 特性 / 道具 / Stadium 連動，
 * byte-exact 搬運。
 */

import {
  reg, regR, regG,
  addLog, addPrivateLog, updatePlayer, withPending, shuffle,
  applyBenchPlaceSideEffects,
  getOwnBenchLimit,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（放備戰區）
// ══════════════════════════════════════════════════════════════════════════════

// 好友寶芬 — 從牌庫選最多 2 隻 HP≤70 基礎寶可夢放備戰
regG('好友寶芬', (st, idx, pool) => {
  // 備戰要有空位，且牌庫要有 HP≤70 的基礎寶可夢
  // v3.78：用 getOwnBenchLimit 支援零之大空洞（5→8 格）
  if (st.players[idx].bench.length >= getOwnBenchLimit(st, idx, pool)) return false;
  return st.players[idx].deck.length > 0;
});
reg('好友寶芬', (st, idx, pool) => {
  // v3.78：slots 改用 getOwnBenchLimit（零之大空洞時可放 8）
  const slots = getOwnBenchLimit(st, idx, pool) - st.players[idx].bench.length;
  const takeMax = Math.min(2, slots);
  st = addLog(st, `好友寶芬：從牌庫選至多 ${takeMax} 隻 HP≤70 基礎寶可夢到備戰區`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic:HP70',
    minCount: 0, maxCount: takeMax,
    effectKey: 'bench-basic-from-deck',
  });
});

// 赫普的包包 — 從牌庫選最多 2 隻「赫普的」基礎寶可夢到備戰
// v2.159：完整實裝「赫普的」前綴限定
//   - gate 至少 1 隻「赫普的」基礎在牌庫
//   - filter 用新 'Basic:NamePrefix=赫普的'（UI 端 filter parser 同步擴展）
//   - resolver 端驗證選的卡符合 prefix（防呆 / AI sim 模式 fallback）
regG('赫普的包包', (st, idx, pool) => {
  // v3.78
  if (st.players[idx].bench.length >= getOwnBenchLimit(st, idx, pool)) return false;
  return st.players[idx].deck.length > 0;
});
reg('赫普的包包', (st, idx, pool) => {
  // v3.78
  const slots = getOwnBenchLimit(st, idx, pool) - st.players[idx].bench.length;
  const takeMax = Math.min(2, slots);
  st = addLog(st, `赫普的包包：從牌庫選至多 ${takeMax} 隻「赫普的」基礎寶可夢到備戰區`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic:NamePrefix=赫普的',
    minCount: 0, maxCount: takeMax,
    effectKey: 'bench-named-basic-from-deck',
    params: { namePrefix: '赫普的' },
  });
});

// v2.159：bench-named-basic-from-deck — 同 bench-basic-from-deck 但 resolver 驗證 namePrefix
regR('bench-named-basic-from-deck', (st, idx, iids, params, pool) => {
  const namePrefix = String(params?.namePrefix ?? '');
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  // 驗證每張選的卡：必須是 prefix 開頭 + 基礎寶可夢
  const valid = chosen.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && !card.evolvesFrom
      && (!namePrefix || card.name.startsWith(namePrefix));
  });
  const validIids = valid.map(c => c.iid);
  if (valid.length === 0) {
    return updatePlayer(addLog(st, `${namePrefix ? '「'+namePrefix+'」' : ''}基礎寶可夢搜尋：未選擇符合條件的卡`, idx),
      idx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const names = valid.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addLog(st, `放到備戰區：${names}`, idx);
  st = updatePlayer(st, idx, (p) => {
    const selected = p.deck
      .filter(c => validIids.includes(c.iid))
      .map(c => ({ ...c, justPlaced: true }));
    const remaining = p.deck.filter(c => !validIids.includes(c.iid));
    // v3.78：用 getOwnBenchLimit
    const bench = [...p.bench, ...selected].slice(0, getOwnBenchLimit(st, idx, pool));
    return { ...p, deck: shuffle(remaining), bench };
  });
  return applyBenchPlaceSideEffects(st, idx, validIids, pool);
});

regR('bench-basic-from-deck', (st, idx, iids, _params, pool) => {
  // 公開資訊：放到備戰區本來就對對手可見，順便記到 log 方便追蹤
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `放到備戰區：${names}`, idx);
  } else {
    st = addLog(st, '牌庫搜尋：未選擇任何卡', idx);
  }
  // 把 bench 增加 + deck remove + 重洗
  st = updatePlayer(st, idx, (p) => {
    const selected = p.deck
      .filter(c => iids.includes(c.iid))
      .map(c => ({ ...c, justPlaced: true }));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    // v3.78：用 getOwnBenchLimit 支援零之大空洞（5→8 格）
    const bench = [...p.bench, ...selected].slice(0, getOwnBenchLimit(st, idx, pool));
    return { ...p, deck: shuffle(remaining), bench };
  });
  // v2.119：觸發「放到備戰」的被動場地卡效果（險惡廢墟等）
  return applyBenchPlaceSideEffects(st, idx, iids, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（加手牌）
// ══════════════════════════════════════════════════════════════════════════════

// 甜蜜球 — 從牌庫選 1 隻與對手出場寶可夢同名的寶可夢加手牌
// v2.159 升級為完整實裝（不再簡化）；之前簡化為任意寶可夢，現在限定「與對手出場（戰鬥位+備戰位）寶可夢同名」。
regG('甜蜜球', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const oppNames = new Set<string>();
  if (st.players[dIdx].active) {
    const c = pool.get(st.players[dIdx].active!.cardId);
    if (c) oppNames.add(c.name);
  }
  for (const b of st.players[dIdx].bench) {
    const c = pool.get(b.cardId);
    if (c) oppNames.add(c.name);
  }
  if (oppNames.size === 0) return false;
  return st.players[idx].deck.length > 0;
});
reg('甜蜜球', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const oppNames = new Set<string>();
  if (st.players[dIdx].active) {
    const c = pool.get(st.players[dIdx].active!.cardId);
    if (c) oppNames.add(c.name);
  }
  for (const b of st.players[dIdx].bench) {
    const c = pool.get(b.cardId);
    if (c) oppNames.add(c.name);
  }
  st = addLog(st, `甜蜜球：從牌庫選 1 隻與對手場上同名的寶可夢加手牌（${[...oppNames].join('/')}）`, idx);
  // v2.993：卡面寫「選擇 1 張」mandatory；牌庫無同名寶可夢時允許 Pass
  const hasMatch = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && oppNames.has(card.name);
  });
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon:MatchOppName',
    minCount: hasMatch ? 1 : 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
    params: { matchOppNames: [...oppNames] },
  });
});

// 黑暗球 — 查看牌庫底 7 張，選 1 張寶可夢加手牌
reg('黑暗球', (st, idx, pool) => {
  st = addLog(st, '黑暗球：從牌庫選 1 張寶可夢加手牌', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫底 7 張無寶可夢時允許 Pass
  const bottom7 = st.players[idx].deck.slice(-7);
  const hasPoke = bottom7.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: hasPoke ? 1 : 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

regR('search-pokemon-to-hand', (st, idx, iids, _params, pool) => {
  // v2.96：卡面有「給對手看過」（高級球 / 黑暗球 / 甜蜜球 / 超級信號 / 小剛的發掘 stage2 等共用此 resolver）
  // → 必須公開卡名給對手 log（PTCG 防作弊驗證機制）
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `搜到：${names} 加入手牌`, idx);
  } else {
    st = addLog(st, '牌庫搜尋：未選擇任何卡', idx);
  }
  return updatePlayer(st, idx, (p) => {
    const chosenInPlayer = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle(remaining), hand: [...p.hand, ...chosenInPlayer] };
  });
});

// 小剛的發掘（Supporter）— 先選至多 2 隻基礎寶可夢加手牌；若 0 隻不選，則改選 1 隻進化寶可夢加手牌
// 兩段式：
//   第一段 deck-search Basic 0~2 → effectKey: 'brocks-dig-basic'
//   resolver：若選了 ≥1 張 → 加手牌，結束；若選 0 → 開第二段 deck-search Evolution 0~1 → search-pokemon-to-hand
reg('小剛的發掘', (st, idx) => {
  st = addLog(st, '小剛的發掘：從牌庫選最多 2 隻基礎寶可夢加手牌（若不選則可改選 1 隻進化寶可夢）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic',
    minCount: 0, maxCount: 2,
    effectKey: 'brocks-dig-basic',
  });
});

regR('brocks-dig-basic', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    // 玩家選了至少 1 隻基礎寶可夢 → 加手牌，結束
    const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.96：卡面「給對手看過」→ 公開卡名
    st = addLog(st, `小剛的發掘：搜到 ${names} 加入手牌`, idx);
    return updatePlayer(st, idx, (p) => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const remaining = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: shuffle(remaining), hand: [...p.hand, ...picked] };
    });
  }
  // 玩家選了 0 張 → 開第二段：選 1 隻進化寶可夢
  const hasEvolution = st.players[idx].deck.length > 0;
  if (!hasEvolution) {
    st = updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(st, '小剛的發掘：未選基礎寶可夢，且牌庫中無進化寶可夢，結束', idx);
  }
  st = addLog(st, '小剛的發掘：未選基礎寶可夢 → 改選 1 隻進化寶可夢加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Evolution',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（補充）
// ══════════════════════════════════════════════════════════════════════════════

// 高級球 — 丟棄 2 張手牌，搜尋任意寶可夢加手牌
// Guard: 手牌至少 3 張（含本卡）—— 打出後需再丟 2 張
regG('高級球', (st, idx) => st.players[idx].hand.length >= 3);
reg('高級球', (st, idx) => {
  if (st.players[idx].hand.length < 2) {
    return addLog(st, '高級球：手牌不足 2 張，無法使用', idx);
  }
  st = addLog(st, '高級球：選擇 2 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 2, maxCount: 2,
    effectKey: 'ultra-ball-discard',
  });
});
regR('ultra-ball-discard', (st, idx, iids, _params, pool) => {
  // 記錄丟棄的卡名（公開資訊 — 丟棄到棄牌區本來就公開）
  const toDiscardNow = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (toDiscardNow.length > 0) {
    const names = toDiscardNow.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `高級球：丟棄 ${names}`, idx);
  }
  st = updatePlayer(st, idx, (p) => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    return { ...p, hand: p.hand.filter(c => !iids.includes(c.iid)), discard: [...p.discard, ...toDiscard] };
  });
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無寶可夢時允許 Pass
  const hasPoke = st.players[idx].deck.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: hasPoke ? 1 : 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 超級信號 — 從牌庫搜尋 1 張「超級進化寶可夢 ex」加手牌
// ⚠️ 必須只過濾「超級進化 ex」（名字開頭「超級」），普通 ex（桃歹郎ex / 拉帝亞斯ex）不可被搜到
regG('超級信號', (st, idx, pool) =>
  st.players[idx].deck.length > 0
);
reg('超級信號', (st, idx, pool) => {
  st = addLog(st, '超級信號：從牌庫選 1 張超級進化寶可夢 ex 加手牌', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無超級進化 ex 時允許 Pass
  const hasMegaEx = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && (card.name?.startsWith('超級') ?? false) && (card.name?.includes('ex') ?? false);
  });
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'MegaEx',
    minCount: hasMegaEx ? 1 : 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});
