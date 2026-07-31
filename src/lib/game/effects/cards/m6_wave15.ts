// v6.084 M6「綠寶石風暴」實裝 批次 15 —— 依賴「傳說」競技場的連動三卡
//
// ⚠ 卡面逐字取自 static/cards（台灣官方中文），未經簡化。
// ⚠ 三張的條件都是「場上有名稱中有『傳說』的競技場卡」→ 一律走中央述詞
//   hasLegendStadiumInPlay（用 includes('傳說') 而非枚舉三張，未來新卡自動涵蓋）。
//   ⭐ 判準是「場上」= 不分擁有者，對手打出的傳說競技場也算。

import { reg, regPre, regPost, addLog, updatePlayer, drawCards,
         hasLegendStadiumInPlay } from '../_shared';
import { hitBenchAllForCard } from '../../effects';

// ── 1. 蓋歐卡｜狂暴漩渦 100 ────────────────────────────────────────────────
// 卡面：若場上有名稱中有「傳說」的競技場卡，則對手的所有備戰寶可夢也各受到50點傷害。
//        [在備戰區不計算弱點・抵抗力。]
//   ⚠ 備戰傷害走中央 hitBenchAll（內建「不計弱抗」＋太古防壁／太晶等備戰免疫 gate）。
regPre('蓋歐卡|狂暴漩渦', (state) => ({ state, damage: 100 }));
regPost('蓋歐卡|狂暴漩渦', (state, aIdx, pool) => {
  if (!hasLegendStadiumInPlay(state, pool)) {
    return addLog(state, '狂暴漩渦：場上沒有名稱中有「傳說」的競技場卡 → 備戰不受傷害', aIdx);
  }
  return hitBenchAllForCard(state, aIdx, (1 - aIdx) as 0 | 1, 50, pool, '狂暴漩渦');
});

// ── 2. 固拉多｜狂暴大地 100+ ──────────────────────────────────────────────
// 卡面：若場上有名稱中有「傳說」的競技場卡，則增加170點傷害。
regPre('固拉多|狂暴大地', (state, aIdx, pool) => {
  const bonus = hasLegendStadiumInPlay(state, pool) ? 170 : 0;
  return {
    state: addLog(state,
      bonus > 0
        ? '狂暴大地：場上有「傳說」競技場 → 100 + 170 = 270'
        : '狂暴大地：場上沒有「傳說」競技場 → 100',
      aIdx),
    damage: 100 + bonus,
  };
});

// ── 3. 小楓與小南的修行（Supporter）───────────────────────────────────────
// 卡面：從自己的牌庫抽出2張卡。然後，若場上有名稱中有「傳說」的競技場卡，
//        則不丟棄這張「小楓與小南的修行」，而是放回手牌。
//   ⚠ 與 SV5a「管理員」同型（那張是放回牌庫並重洗），本卡是**放回手牌**。
//   ⚠ 引擎的支援者流程是「先進棄牌區、再跑效果」→ 這裡要從棄牌區把自己撈回來。
//     用 trainerInst.iid 精準取回**這一張**（不是同名最後一張），避免場上有多張時撈錯。
reg('小楓與小南的修行', (st, idx, pool, trainerInst) => {
  st = addLog(st, '小楓與小南的修行：抽 2 張', idx);
  st = drawCards(st, idx, 2);
  if (!hasLegendStadiumInPlay(st, pool)) {
    return addLog(st, '小楓與小南的修行：場上沒有「傳說」競技場 → 正常丟棄', idx);
  }
  const selfIid = trainerInst?.iid;
  const p = st.players[idx];
  const foundIdx = selfIid !== undefined
    ? p.discard.findIndex(c => c.iid === selfIid)
    // fail-safe：拿不到 iid 時退回「棄牌區最後一張同名」
    : (() => { for (let i = p.discard.length - 1; i >= 0; i--) {
        if (pool.get(p.discard[i].cardId)?.name === '小楓與小南的修行') return i; } return -1; })();
  if (foundIdx < 0) {
    return addLog(st, '小楓與小南的修行：找不到剛丟棄的自己（略過放回手牌）', idx);
  }
  const inst = p.discard[foundIdx];
  st = updatePlayer(st, idx, pl => ({
    ...pl,
    discard: [...pl.discard.slice(0, foundIdx), ...pl.discard.slice(foundIdx + 1)],
    hand: [...pl.hand, inst],
  }));
  return addLog(st, '小楓與小南的修行：場上有「傳說」競技場 → 不丟棄，放回手牌', idx);
});
