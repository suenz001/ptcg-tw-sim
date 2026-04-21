/**
 * 抽牌 / 洗牌 / 互動 Supporter 群 — 模組化批次 v2.12 (Session 38b9)
 *
 * 原位於 effects.ts 67-180 行：
 *   - 即時支援者：管理員 / 帕底亞的夥伴 / 納莉 / 丹瑜 / 紫竽 / 松葉的信心 / 枇琶
 *   - 互動支援者：艾莉絲的鬥志（hand-discard → draw-up-to-6）
 *                 探險家的嚮導（TOP6 → 選 2 加手牌，其餘丟棄）
 *
 * 這些卡都是訓練家（Supporter），只依賴 _shared.ts 匯出的 reg / regR / helper，
 * 不涉及攻擊系統 / 特性 / 道具 / Stadium / 被動減傷等機制，byte-exact 搬運。
 */

import {
  reg, regR,
  addLog, updatePlayer, withPending,
  drawCards, discardHand, returnHandToDeck,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 即時支援者（無需互動）
// ══════════════════════════════════════════════════════════════════════════════

// 管理員 — 抽 2 張
reg('管理員', (st, idx) => {
  st = addLog(st, '管理員：抽 2 張', idx);
  return drawCards(st, idx, 2);
});

// 帕底亞的夥伴 — 抽 3 張
reg('帕底亞的夥伴', (st, idx) => {
  st = addLog(st, '帕底亞的夥伴：抽 3 張', idx);
  return drawCards(st, idx, 3);
});

// 納莉 — 抽 4 張（回合結束手牌≥5棄手 M2 省略）
reg('納莉', (st, idx) => {
  st = addLog(st, '納莉：抽 4 張', idx);
  return drawCards(st, idx, 4);
});

// 丹瑜 — 手牌全丟，抽 5 張（先攻第一回合可用）
reg('丹瑜', (st, idx) => {
  st = addLog(st, '丹瑜：手牌全丟，抽 5 張', idx);
  st = discardHand(st, idx);
  return drawCards(st, idx, 5);
});

// 紫竽 — 手牌洗回牌庫，抽 4 張
reg('紫竽', (st, idx) => {
  st = addLog(st, '紫竽：手牌洗回牌庫，抽 4 張', idx);
  st = returnHandToDeck(st, idx);
  return drawCards(st, idx, 4);
});

// 松葉的信心 — 手牌洗回牌庫，抽 5 張
reg('松葉的信心', (st, idx) => {
  st = addLog(st, '松葉的信心：手牌洗回牌庫，抽 5 張', idx);
  st = returnHandToDeck(st, idx);
  return drawCards(st, idx, 5);
});

// 枇琶 — 抽 3 張（簡化，不處理額外效果）
reg('枇琶', (st, idx) => {
  st = addLog(st, '枇琶：抽 3 張', idx);
  return drawCards(st, idx, 3);
});

// ══════════════════════════════════════════════════════════════════════════════
// 互動支援者
// ══════════════════════════════════════════════════════════════════════════════

// 艾莉絲的鬥志 — 丟棄 1 張手牌，抽至 6 張
reg('艾莉絲的鬥志', (st, idx) => {
  const hand = st.players[idx].hand;
  if (hand.length === 0) {
    return addLog(st, '艾莉絲的鬥志：手牌為空，無法使用', idx);
  }
  st = addLog(st, '艾莉絲的鬥志：選 1 張手牌丟棄，再抽至 6 張', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'alice-courage',
  });
});
regR('alice-courage', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `艾莉絲的鬥志：丟棄 ${names}`, idx);
  }
  st = updatePlayer(st, idx, (p) => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const hand = p.hand.filter(c => !iids.includes(c.iid));
    return { ...p, hand, discard: [...p.discard, ...toDiscard] };
  });
  const needed = Math.max(0, 6 - st.players[idx].hand.length);
  return drawCards(st, idx, needed);
});

// 探險家的嚮導 — 查看牌庫頂 6 張，選 2 張加手牌，其餘丟棄
reg('探險家的嚮導', (st, idx) => {
  const top6Iids = st.players[idx].deck.slice(0, 6).map(c => c.iid);
  if (top6Iids.length === 0) {
    return addLog(st, '探險家的嚮導：牌庫為空', idx);
  }
  st = addLog(st, '探險家的嚮導：查看牌庫頂 6 張，選最多 2 張', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TOP6',
    minCount: 0, maxCount: 2,
    effectKey: 'explorer-guide',
    params: { top6Iids },
  });
});
regR('explorer-guide', (st, idx, iids, params, _pool) => {
  const top6Iids = (params?.top6Iids as string[]) ?? [];
  return updatePlayer(st, idx, (p) => {
    const top6 = p.deck.filter(c => top6Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top6Iids.includes(c.iid));
    const chosen = top6.filter(c => iids.includes(c.iid));
    const discarded = top6.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck: rest,
      hand: [...p.hand, ...chosen],
      discard: [...p.discard, ...discarded],
    };
  });
});
