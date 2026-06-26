/**
 * v2.168 — 卡池清掃 Supporter 第 1 波（簡單 draw / heal / search）
 *
 * 從卡池找出沒實裝、機制簡單的 Supporter 一次補齊：
 *   - 妮莫 (12231)：抽 3
 *   - 博士的研究 (13951)：棄全手 → 抽 7
 *   - 毅萬與馥好 (11118)：抽 2，若手牌 ≥10 再抽 2
 *   - 千里 (12226)：抽 2，若對手戰鬥場為 ex 再抽 2
 *   - 主持人的帶動 (12719)：抽 2，若對手獎賞 ≤3 再抽 2
 *   - 短褲小子 (12227)：手牌洗回牌庫 → 抽 5
 *   - 寶可夢中心的姐姐 (12573)：選 1 隻寶可夢 +60 HP + 解全狀態
 *   - 由紫 (18053)：選 1 隻【超】寶可夢 +150 HP
 *   - 派帕 (11165)：牌庫選 1 物品 + 1 道具加手牌
 *   - 老大的指令（烏羽）(18351)：對手備戰換戰鬥（同「老大的指令」）
 *
 * 跳過收錄於 SKIPPED_CARDS.md：機制更複雜或需新引擎旗標的卡。
 */

import {
  reg, regR, regG,
  addLog, addPrivateLog, updatePlayer, withPending, shuffle,
  drawCards, healResolver,
} from '../_shared';
// v3.06 對手 trainer 免疫 helper（斧牙龍｜緊張感 / 浩大鯨ex｜融合為雪）
import { isImmuneToOppTrainer as _v3060IsImmuneOppTrainer } from './v3060_deferred_wave_b';
void _v3060IsImmuneOppTrainer;
// v3.08 對手 supporter 免疫綜合 helper（含廣域堡壘）
import { isImmuneToOppSupporter as _v3080IsImmuneOppSupp } from './v3080_deferred_wave_c';

// v2.374：v168 寫於早期，drawCards 接 PlayerState；現行 _shared.drawCards 接 GameState。
// 為避免大規模重構，內嵌一個 PlayerState 版 helper（行為等同 _shared.drawCards 但作用於單一 player）。
function drawCardsP<P extends { hand: any[]; deck: any[] }>(p: P, n: number): P {
  const taken = p.deck.slice(0, n);
  return { ...p, hand: [...p.hand, ...taken], deck: p.deck.slice(n) };
}


// ── 妮莫 — 抽 3 ─────────────────────────────────────────────────────────────
regG('妮莫', (st, idx) => st.players[idx].deck.length > 0);
reg('妮莫', (st, idx) => {
  st = addLog(st, '妮莫：從牌庫抽 3 張', idx);
  return drawCards(st, idx, 3);
});

// ── 博士的研究 — 棄全手 → 抽 7 ─────────────────────────────────────────────
regG('博士的研究', (st, idx) => st.players[idx].deck.length > 0);
reg('博士的研究', (st, idx) => {
  st = addLog(st, '博士的研究：手牌全棄 → 從牌庫抽 7 張', idx);
  return updatePlayer(st, idx, p => {
    const discardedHand = [...p.discard, ...p.hand];
    return drawCardsP({ ...p, hand: [], discard: discardedHand }, 7);
  });
});

// ── 毅萬與馥好 — 抽 2，手牌 ≥10 再抽 2 ────────────────────────────────────
regG('毅萬與馥好', (st, idx) => st.players[idx].deck.length > 0);
reg('毅萬與馥好', (st, idx) => {
  st = addLog(st, '毅萬與馥好：抽 2 張', idx);
  return updatePlayer(st, idx, p => {
    let p2 = drawCardsP(p, 2);
    // 注意：「手牌 ≥10」是抽完 2 張之後再判定
    if (p2.hand.length >= 10) {
      p2 = drawCardsP(p2, 2);
    }
    return p2;
  });
});

// ── 千里 — 抽 2，對手戰鬥場為 ex 再抽 2 ──────────────────────────────────
regG('千里', (st, idx) => st.players[idx].deck.length > 0);
reg('千里', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const oppActive = st.players[dIdx].active;
  const oppCard = oppActive ? pool.get(oppActive.cardId) : null;
  const isEx = oppCard?.subtype === 'ex';
  const draw = isEx ? 4 : 2;
  st = addLog(st, `千里：抽 ${draw} 張${isEx ? '（對手戰鬥場為 ex）' : ''}`, idx);
  return drawCards(st, idx, draw);
});

// ── 主持人的帶動 — 抽 2，對手獎賞 ≤3 再抽 2 ─────────────────────────────
regG('主持人的帶動', (st, idx) => st.players[idx].deck.length > 0);
reg('主持人的帶動', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  const draw = st.players[dIdx].prizes.length <= 3 ? 4 : 2;
  st = addLog(st, `主持人的帶動：抽 ${draw} 張${draw === 4 ? '（對手獎賞 ≤3）' : ''}`, idx);
  return drawCards(st, idx, draw);
});

// ── 短褲小子 — 手牌洗回牌庫 → 抽 5 ─────────────────────────────────────────
regG('短褲小子', () => true);
reg('短褲小子', (st, idx) => {
  st = addLog(st, '短褲小子：手牌洗回牌庫 → 抽 5 張', idx);
  return updatePlayer(st, idx, p => {
    const newDeck = shuffle([...p.deck, ...p.hand]);
    return drawCardsP({ ...p, hand: [], deck: newDeck }, 5);
  });
});

// 寶可夢中心的姐姐 — v5.728 移除此處重複死碼（生效版在 effects.ts:4327，effectKey
//   pokemon-center-lady-heal → healResolver）；此處自訂 resolver 漏清 tertiaryStatus 已棄用。

// ── 由紫 — 選 1【超】寶可夢 +150 HP ────────────────────────────────────────
regG('由紫', (st, idx, pool) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Psychic' && c.damage > 0;
  });
});
reg('由紫', (st, idx, pool) => {
  // 只有有傷害的【超】寶可夢算數
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  const validIids = all.filter(c => {
    const card = pool.get(c.cardId);
    return card?.pokemonType === 'Psychic' && c.damage > 0;
  }).map(c => c.iid);
  st = addLog(st, '由紫：選 1 隻【超】寶可夢回 150 HP', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'heal-150',  // 共用 healResolver
    params: { healAmount: 150, validIids },
  });
});
// heal-150 已 reg 過 (line 2172)，不重複 reg。

// ── 派帕 — 牌庫選 1 物品卡 + 1 寶可夢道具卡加手牌（重洗）─────────────────
regG('', (st, idx) => st.players[idx].deck.length > 0);
reg('派帕', (st, idx) => {
  // 第 1 階段：選 1 張物品
  st = addLog(st, '派帕：從牌庫選 1 張物品卡', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Item',
    minCount: 0, maxCount: 1,
    effectKey: 'piper-item-pick',
  });
});
regR('piper-item-pick', (st, idx, iids, _params, pool) => {
  // 把選到的物品加手牌；之後串接 PokemonTool 階段（不重洗）
  const set = new Set(iids);
  if (set.size > 0) {
    const picked = st.players[idx].deck.filter(c => set.has(c.iid));
    const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.96：卡面「給對手看過」→ 公開卡名
    st = addLog(st, `派帕：搜到物品 ${names}`, idx);
  } else {
    st = addLog(st, '派帕：未選物品', idx);
  }
  st = updatePlayer(st, idx, p => {
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: rest, hand: [...p.hand, ...got] };
  });
  // 接著進階段 2：選 PokemonTool
  st = addLog(st, '派帕：從牌庫選 1 張寶可夢道具', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonTool',
    minCount: 0, maxCount: 1,
    effectKey: 'piper-tool-pick',
  });
});
regR('piper-tool-pick', (st, idx, iids, _params, pool) => {
  const set = new Set(iids);
  if (set.size > 0) {
    const picked = st.players[idx].deck.filter(c => set.has(c.iid));
    const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.96：卡面「給對手看過」→ 公開卡名
    st = addLog(st, `派帕：搜到道具 ${names}`, idx);
  } else {
    st = addLog(st, '派帕：未選道具', idx);
  }
  return updatePlayer(st, idx, p => {
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 老大的指令（烏羽）— 等同於「老大的指令」 ──────────────────────────────
// 卡面：選擇 1 隻對手的備戰寶可夢，與戰鬥寶可夢互換。
// 重用既有的 'gust-opp' resolver。
// v3.06 緊張感 / 融合為雪 — 對手 trainer 免疫：filter 排除
regG('老大的指令（烏羽）', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  // v3.06 + v3.08：緊張感 / 融合為雪 / 廣域堡壘 — 對手 supporter 免疫過濾
  const valid = st.players[oppIdx].bench.filter(b => !_v3080IsImmuneOppSupp(st, oppIdx, b, pool));
  return valid.length > 0;
});
reg('老大的指令（烏羽）', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  // v3.06 + v3.08：緊張感 / 融合為雪 / 廣域堡壘 — 對手 supporter 免疫過濾
  const validIids = st.players[oppIdx].bench
    .filter(b => !_v3080IsImmuneOppSupp(st, oppIdx, b, pool))
    .map(b => b.iid);
  if (validIids.length === 0) {
    return addLog(st, '老大的指令（烏羽）：對手備戰區沒有可呼叫的寶可夢（緊張感/融合為雪/廣域堡壘 免疫）', idx);
  }
  st = addLog(st, '老大的指令（烏羽）：選擇要呼叫的對手備戰寶可夢', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'gust-opp',  // 重用 supporters_gust.ts 的 resolver
    params: { validIids },
  });
});

void healResolver;  // import 為了確保 heal-150 被註冊（side-effect 已綁好 effectKey）
