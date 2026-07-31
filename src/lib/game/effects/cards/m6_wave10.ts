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

import { reg, regG, regR, addLog, updatePlayer, withPending, shuffle } from '../_shared';

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
