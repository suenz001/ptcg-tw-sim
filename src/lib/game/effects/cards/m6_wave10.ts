// v6.072 M6「綠寶石風暴」訓練家實裝 批次 10
//
// ⚠ 訓練家卡面在 static/cards 的 `rulesText` 欄（不是 effect），逐字取用未經簡化。
// ⚠ 卡面寫「在給對手看過後加入手牌」→ **公開** addLog 揭示卡名（Iron Rule 8），
//   與沒寫「給對手看過」的搜尋（用 addPrivateLog）不同。
//
// 本批不在本檔的：
//   ・訂製背心（PokemonTool）→ tools.ts 的 TOOL_DEFENSE_REDUCE_BY_ATTACKER_CARD（新 map）
//   ・小楓與小南的修行 → 依賴「傳說」競技場，等傳說競技場那批一起做
//   ・超級烈空坐帽子 → 道具賦予招式，需新機制
//   ・主持人的帶動 → 與既有 SV9a 同名同文，已自動承接 handler

import { reg, regG, regR, addLog, updatePlayer, withPending, shuffle,
         clearActiveEffects, tryPromptPromoteActive } from '../_shared';

// ── 1. 美味飯糰（Item）────────────────────────────────────────────────────
// 卡面：將自己的戰鬥寶可夢恢復「30」HP。
//        恢復的HP依自己的棄牌區的「美味飯糰」（這張卡除外）每1張增加「30」。
//   ⚠「（這張卡除外）」—— 打出時這張卡是否已在棄牌區，取決於引擎的結算順序。
//     為了不依賴順序，這裡**明確用 iid 排除自己**（handler 收得到 trainerInst）。
//   ⚠ 恢復量不得超過已受傷害（damage 不可為負）。
regG('美味飯糰', (st, idx) => !!st.players[idx].active && (st.players[idx].active!.damage ?? 0) > 0);
reg('美味飯糰', (st, idx, pool, trainerInst) => {
  const p = st.players[idx];
  if (!p.active) return addLog(st, '美味飯糰：戰鬥場上沒有寶可夢', idx);
  const before = p.active.damage ?? 0;
  if (before === 0) return addLog(st, '美味飯糰：戰鬥寶可夢 HP 已全滿', idx);
  const selfIid = trainerInst?.iid;
  const inDiscard = p.discard.filter(c =>
    pool.get(c.cardId)?.name === '美味飯糰' && c.iid !== selfIid).length;
  const heal = Math.min(30 + inDiscard * 30, before);
  return updatePlayer(
    addLog(st, `美味飯糰：棄牌區有 ${inDiscard} 張「美味飯糰」→ 恢復 ${heal} HP`, idx),
    idx, pl => (pl.active ? { ...pl, active: { ...pl.active, damage: before - heal } } : pl),
  );
});

// ── 2. 冒險提燈（Item）────────────────────────────────────────────────────
// 卡面：從自己的牌庫選擇「基本【火】能量」卡與「基本【雷】能量」卡各1張，
//        在給對手看過後加入手牌。並且重洗牌庫。
//   範本 阿克羅瑪的執著（競技場+能量各 1 張）的兩步式流程，逐字同構。
//   ⚠「各 1 張」是 mandatory，但牌庫沒有時要能 Pass → minCount:0。
//   ⚠ 重洗**只在最後一步做一次**（中途重洗會讓第二步的搜尋看到洗過的牌庫）。
regG('冒險提燈', (st, idx) => st.players[idx].deck.length > 0);
reg('冒險提燈', (st, idx) => withPending(
  addLog(st, '冒險提燈：步驟 1／2 — 從牌庫選 1 張「基本【火】能量」加手牌', idx), {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Fire', minCount: 0, maxCount: 1,
    effectKey: 'm6-lantern-step1-fire',
  }));
function lanternTake(st, idx, iids, pool, label) {
  if (iids.length === 0) return addLog(st, `冒險提燈：未選擇${label}`, idx);
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  if (chosen.length === 0) return addLog(st, `冒險提燈：未選擇${label}`, idx);
  const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // 卡面「給對手看過」→ 公開揭示
  const s = addLog(st, `冒險提燈：搜到 ${names} 加入手牌`, idx);
  const set = new Set(chosen.map(c => c.iid));
  return updatePlayer(s, idx, p => ({
    ...p,
    deck: p.deck.filter(c => !set.has(c.iid)),
    hand: [...p.hand, ...p.deck.filter(c => set.has(c.iid))],
  }));
}
regR('m6-lantern-step1-fire', (st, idx, iids, _params, pool) => {
  const s = lanternTake(st, idx, iids, pool, '基本【火】能量');
  return withPending(
    addLog(s, '冒險提燈：步驟 2／2 — 從牌庫選 1 張「基本【雷】能量」加手牌', idx), {
      type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
      filter: 'Energy:Lightning', minCount: 0, maxCount: 1,
      effectKey: 'm6-lantern-step2-lightning',
    });
});
regR('m6-lantern-step2-lightning', (st, idx, iids, _params, pool) => {
  const s = lanternTake(st, idx, iids, pool, '基本【雷】能量');
  // 卡面「並且重洗牌庫」— 最後才洗
  return updatePlayer(s, idx, p => ({ ...p, deck: shuffle(p.deck) }));
});

// ── 3. 基利（Supporter）───────────────────────────────────────────────────
// 卡面：從自己的牌庫選擇支援者卡與競技場卡合計最多3張，在給對手看過後加入手牌。
//        並且重洗牌庫。
//   ⚠「合計最多 3 張」＝支援者與競技場**混選**共 3 張（不是各 3 張）→ 單一 picker、
//     filter 要同時涵蓋兩類（'SupporterOrStadium'，已登錄中央 selection-filter）。
regG('基利', (st, idx) => st.players[idx].deck.length > 0);
reg('基利', (st, idx) => withPending(
  addLog(st, '基利：從牌庫選支援者／競技場合計最多 3 張加手牌', idx), {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'SupporterOrStadium', minCount: 0, maxCount: 3,
    effectKey: 'search-generic-to-hand',   // 既有中央 resolver（公開揭示 + 重洗）
  }));

// ── 4. 希嘉娜的信賴（Supporter）──────────────────────────────────────────
// 卡面：將自己的戰鬥寶可夢與備戰寶可夢互換。然後，選擇1個換入備戰區的寶可夢身上
//        附加的能量，改附於新的戰鬥寶可夢身上。
//   範本 急進開關（Item）—— 只差最後一段：急進開關是「**任意數量**的能量卡」，
//   本卡是「**1個**能量」。
//   ⚠「選擇 1 個能量」的既有全站語意＝**選 1 張能量卡**（幸福蛋ex｜幸福切換、
//     能量轉移、白海獅｜沖刷 等都是逐張 modal 選一張），不是「1 個單位」。
//   ⚠ 是「然後」＝互換一定會發生；換下去那隻身上沒能量時只互換、不開能量 picker。
regG('希嘉娜的信賴', (st, idx) => !!st.players[idx].active && st.players[idx].bench.length > 0);
reg('希嘉娜的信賴', (st, idx) => {
  const p = st.players[idx];
  if (!p.active || p.bench.length === 0) {
    return addLog(st, '希嘉娜的信賴：備戰區沒有寶可夢，無法互換', idx);
  }
  return withPending(addLog(st, '希嘉娜的信賴：選擇換入戰鬥場的備戰寶可夢', idx), {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'm6-sigana-swap',
  });
});
regR('m6-sigana-swap', (st, idx, iids, _params, pool) => {
  const p = st.players[idx];
  if (!p.active) return st;
  const prevActiveIid = p.active.iid;
  const target = p.bench.find(c => c.iid === iids[0]);
  if (!target) return st;
  const newName = pool.get(target.cardId)?.name ?? '?';
  const oldName = pool.get(p.active.cardId)?.name ?? '?';
  let s = addLog(st, `希嘉娜的信賴：將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場`, idx);
  s = updatePlayer(s, idx, pl => {
    if (!pl.active) return pl;
    const bIdx = pl.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return pl;
    // v3.812 保留 justPlaced/playedFromHand；v4.978 set movedToActiveThisTurn（特性 gate 需要）
    const newActive = { ...pl.bench[bIdx], movedToActiveThisTurn: true };
    const newBench = [...pl.bench];
    newBench[bIdx] = clearActiveEffects(pl.active);   // 離開戰鬥場清狀態
    return { ...pl, active: newActive, bench: newBench };
  });
  const nowBench = s.players[idx].bench.find(c => c.iid === prevActiveIid);
  if (!nowBench || nowBench.energyAttached.length === 0 || !s.players[idx].active) {
    return tryPromptPromoteActive(addLog(s, '希嘉娜的信賴：換下的寶可夢身上沒有能量可移動', idx), idx, pool);
  }
  // 卡面「選擇 1 個…能量」→ 只能選 1 張（急進開關是任意數量，這裡 max=1）
  return withPending(
    addLog(s, `希嘉娜的信賴：選擇 1 個要從 ${oldName} 移到 ${newName} 的能量`, idx), {
      type: 'active-energy-discard',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'm6-sigana-energy',
      params: { targetIid: prevActiveIid, newActiveIid: s.players[idx].active.iid,
                titleOverride: '希嘉娜的信賴：選擇 1 個要移到新戰鬥寶可夢的能量' },
    });
});
regR('m6-sigana-energy', (st, idx, iids, params, pool) => {
  const fromIid = params?.targetIid as string | undefined;
  const toIid = params?.newActiveIid as string | undefined;
  if (!fromIid || !toIid) return st;
  const p = st.players[idx];
  const src = p.bench.find(c => c.iid === fromIid);
  if (!src || !p.active || p.active.iid !== toIid) {
    return addLog(st, '希嘉娜的信賴：來源／目標寶可夢已不在預期位置（中斷）', idx);
  }
  // v6.009 + lint Check Q：自行 re-validate、去重、夾卡面上限 1 張
  const uniq = [...new Set(iids)];
  const move = src.energyAttached.filter(e => uniq.includes(e.iid)).slice(0, 1);
  if (move.length === 0) return addLog(st, '希嘉娜的信賴：未移動能量', idx);
  const moveSet = new Set(move.map(e => e.iid));
  const s = addLog(st,
    `希嘉娜的信賴：將 ${pool.get(move[0].cardId)?.name ?? '?'} 從 ${pool.get(src.cardId)?.name ?? '?'} 移到 ${pool.get(p.active.cardId)?.name ?? '?'}`, idx);
  return tryPromptPromoteActive(updatePlayer(s, idx, pl => ({
    ...pl,
    active: pl.active ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...move] } : null,
    bench: pl.bench.map(b => b.iid === fromIid
      ? { ...b, energyAttached: b.energyAttached.filter(e => !moveSet.has(e.iid)) } : b),
  })), idx, pool);
});
