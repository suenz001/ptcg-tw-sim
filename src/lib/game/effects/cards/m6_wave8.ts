// v6.070 M6「綠寶石風暴」特性實裝 批次 8
//
// ⚠ 每張卡面均逐字取自 static/cards/M6.json 的 `abilities[].effect`，未經簡化。
// ⚠ 同名卡陷阱：M6 這幾張都有「同名但無特性（或不同特性）」的舊版印刷，
//   一律以**特性名**為 key（regA 除外，見各卡註解），或在 handler 內用
//   abilities.some(a => a.name === …) 二次確認，避免 card.name 撞號
//   （[[reference-samename-multiability-namekey-collision]]）。
//
// 本批已在別處以「集合／map 驅動」完成、不在本檔的：
//   ・七夕青鳥｜棉花搬運  → effects.ts FREE_RETREAT_BASIC_ABILITY_NAMES（engine 讀）
//   ・膽小蟲｜懦弱        → effects.ts ABILITY_RETREAT_MOD
//   ・大鋼蛇｜高密度盔甲  → effects.ts PASSIVE_DAMAGE_REDUCE_COND
//   ・穿山王｜反擊針      → 既有 PASSIVE_RETALIATION 以**特性名**為 key，
//                          與 赫普的啪嚓海膽ex｜反擊針 卡面逐字相同 → **不必實作即已生效**。
//                          （守衛 test-m6-wave8.mjs 有實跑驗證，避免「以為會自動生效」的假設。）

import { regA, addLog, updatePlayer, withPending, regR } from '../_shared';
import type { CardInstance } from '../../types';

// ── 弱丁魚ex｜大洋增輝 ─────────────────────────────────────────────────────
// 卡面：若這隻寶可夢在戰鬥場上，則在自己的回合時可使用1次。將這隻寶可夢恢復「50」HP。
//   ⚠「若這隻寶可夢在戰鬥場上」→ 只有位於戰鬥位的那隻能用（備戰的不行）。
//   ⚠ 恢復不可超過已受傷害（damage 不得為負）。
//   「每回合 1 次」由 engine 的 ABILITY_USED 一次性規則管控，handler 不必自行記錄。
regA('弱丁魚ex', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const act = p.active;
  if (!act) return addLog(st, '大洋增輝：戰鬥場上沒有寶可夢', idx);
  // 觸發源必須就是戰鬥位那隻（engine 以 iid 傳入觸發源；備戰的同名卡不得發動）
  if (cardInst && cardInst.iid !== act.iid) {
    return addLog(st, '大洋增輝：這隻寶可夢不在戰鬥場上，無法使用', idx);
  }
  if (!pool.get(act.cardId)?.abilities?.some(a => a.name === '大洋增輝')) {
    return addLog(st, '大洋增輝：戰鬥場的寶可夢沒有這個特性', idx);
  }
  const before = act.damage ?? 0;
  if (before === 0) return addLog(st, '大洋增輝：HP 已全滿，無法恢復', idx);
  const healed = Math.min(50, before);
  return updatePlayer(
    addLog(st, `大洋增輝：弱丁魚ex 恢復 ${healed} HP`, idx),
    idx, pl => (pl.active ? { ...pl, active: { ...pl.active, damage: before - healed } } : pl),
  );
});

// ── 胖嘟嘟｜深海抽出 ───────────────────────────────────────────────────────
// 卡面：在自己的回合時可使用1次。從自己的牌庫抽出1張卡。
//        然後，若希望，選擇1張自己的手牌，放回牌庫下方。
//   ⚠「若希望」→ picker minCount = 0（可以不放）。
//   ⚠「放回牌庫**下方**」→ 接在 deck 陣列尾端，**不重洗**（順序是有意義的隱藏資訊）。
//   ⚠ 手牌是隱藏 zone → 開 picker 前不得在公開 log 寫候選內容／張數（lint Check T）。
regA('胖嘟嘟', 0, (st, idx, pool, cardInst) => {
  const p0 = st.players[idx];
  const holders = [...(p0.active ? [p0.active] : []), ...p0.bench];
  const src: CardInstance | undefined = cardInst
    ? holders.find(c => c.iid === cardInst.iid)
    : holders.find(c => pool.get(c.cardId)?.abilities?.some(a => a.name === '深海抽出'));
  if (!src || !pool.get(src.cardId)?.abilities?.some(a => a.name === '深海抽出')) {
    return addLog(st, '深海抽出：找不到持有此特性的寶可夢', idx);
  }
  // 步驟 1：抽 1 張
  let s = addLog(st, '深海抽出：從牌庫抽 1 張', idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl, hand: [...pl.hand, ...pl.deck.slice(0, 1)], deck: pl.deck.slice(1),
  }));
  // 步驟 2：若希望，選 1 張手牌放回牌庫下方
  if (s.players[idx].hand.length === 0) return s;
  return withPending(s, {
    type: 'hand-discard',            // 手牌選擇 picker（實際去向由 resolver 決定＝牌庫下方）
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: 1,        // 「若希望」→ 可選 0 張
    effectKey: 'm6-wailord-deep-draw-bottom',
    params: { label: '深海抽出' },
  });
});
regR('m6-wailord-deep-draw-bottom', (st, idx, iids) => {
  if (iids.length === 0) return addLog(st, '深海抽出：選擇不放回手牌', idx);
  // v6.009 + lint Check Q：resolver 一律自行 re-validate client 傳來的 iids —— 去重、
  //   確認確實在手牌、且**夾到卡面上限 1 張**（引擎不驗 maxCount，client 送多個就會多放）。
  const uniq = [...new Set(iids)];
  const inHand = new Set(
    st.players[idx].hand.filter(c => uniq.includes(c.iid)).slice(0, 1).map(c => c.iid),
  );
  if (inHand.size === 0) return st;
  return updatePlayer(
    // ⚠ 對手不知道放回去的是哪張（手牌是隱藏資訊）→ log 只寫張數，不寫卡名
    addLog(st, `深海抽出：將 ${inHand.size} 張手牌放回牌庫下方`, idx),
    idx, pl => ({
      ...pl,
      hand: pl.hand.filter(c => !inHand.has(c.iid)),
      // 「放回牌庫下方」＝接在牌庫尾端，且**不重洗**
      deck: [...pl.deck, ...pl.hand.filter(c => inHand.has(c.iid))],
    }),
  );
});
