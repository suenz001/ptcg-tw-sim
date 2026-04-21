/**
 * 抽牌 / 洗牌 / 互動 Supporter 群 — 模組化批次 v2.12 (Session 38b9)
 *
 * 原位於 effects.ts 67-180 行：
 *   - 即時支援者：管理員 / 帕底亞的夥伴 / 納莉 / 丹瑜 / 紫竽 / 松葉的信心 / 枇琶
 *   - 互動支援者：艾莉絲的鬥志（hand-discard → draw-up-to-6）
 *                 探險家的嚮導（TOP6 → 選 2 加手牌，其餘丟棄）
 *
 * v2.14 (Session 38bb)：新增 鳴依的勉勵 — 棄牌基本能量 → 2 階進化寶可夢附加
 *
 * 這些卡都是訓練家（Supporter），只依賴 _shared.ts 匯出的 reg / regR / helper，
 * 不涉及攻擊系統 / 特性 / 道具 / Stadium / 被動減傷等機制，byte-exact 搬運。
 */

import {
  reg, regR, regG,
  addLog, updatePlayer, withPending,
  drawCards, discardHand, returnHandToDeck,
} from '../_shared';
import type { CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';

// 本地複製 engine.ts 的 isStage2PokemonCard 判定，避免 engine ↔ effects 循環 import。
// 規則：evolvesFrom 存在，且該 evolvesFrom（Stage1）本身也有 evolvesFrom（指回 Basic）。
function isStage2PokemonCardLocal(
  card: Card | undefined,
  pool: Map<string, Card>
): boolean {
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  for (const c of pool.values()) {
    if (c.name === card.evolvesFrom && c.supertype === 'Pokemon' && c.evolvesFrom) return true;
  }
  return false;
}

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

// 莉莉艾的決意 — 手牌洗回牌庫，抽 6 張（獎勵牌剩 6 張時抽 8 張）
// v2.24 從 effects.ts 搬遷
reg('莉莉艾的決意', (st, idx) => {
  const prizes = st.players[idx].prizes.length;
  const drawCount = prizes >= 6 ? 8 : 6;
  st = addLog(st, `莉莉艾的決意：手牌洗回牌庫，抽 ${drawCount} 張`, idx);
  st = returnHandToDeck(st, idx);
  return drawCards(st, idx, drawCount);
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

// 鳴依的勉勵 — 自己剩餘獎賞 > 對手剩餘獎賞時可用：
//   從棄牌區選最多 2 張基本能量 → 附於 1 隻自己的 2 階進化寶可夢
//
// 流程：discard-search（BasicEnergy, 1-2）→ heal-target（限 Stage2 iids）→ 附加能量
// 若棄牌區剛好只剩 1 張可選，或場上只有 1 隻 Stage2，會在 resolver 盡量自動化。
regG('鳴依的勉勵', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  if (st.players[idx].prizes.length <= st.players[oppIdx].prizes.length) return false;
  const hasBasicEnergy = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  if (!hasBasicEnergy) return false;
  const p = st.players[idx];
  const allSelf: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  return allSelf.some(c => isStage2PokemonCardLocal(pool.get(c.cardId), pool));
});
reg('鳴依的勉勵', (st, idx, pool) => {
  const p = st.players[idx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  const maxPick = Math.min(2, cand.length);
  st = addLog(st, `鳴依的勉勵：從棄牌選最多 ${maxPick} 張基本能量附於 1 隻【2階進化】寶可夢`, idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 1, maxCount: maxPick,
    effectKey: 'naruei-encourage-pick-target',
  });
});
regR('naruei-encourage-pick-target', (st, idx, iids, _params, pool) => {
  const p = st.players[idx];
  const allSelf: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  const validStage2 = allSelf.filter(c => isStage2PokemonCardLocal(pool.get(c.cardId), pool));
  if (validStage2.length === 0) {
    // 場上沒有 Stage2（理論上 guard 會擋，保險）：能量已從 discard-search 點選，但不附加
    return addLog(st, '鳴依的勉勵：場上沒有 2 階進化寶可夢，取消附加', idx);
  }
  // 場上只有 1 隻 Stage2 → 直接附加
  if (validStage2.length === 1) {
    const target = validStage2[0];
    const energies = p.discard.filter(c => iids.includes(c.iid));
    const targetName = pool.get(target.cardId)?.name ?? '?';
    let s = addLog(st, `鳴依的勉勵：將 ${energies.length} 張基本能量附加到 ${targetName}`, idx);
    return updatePlayer(s, idx, pl => {
      const rest = pl.discard.filter(c => !iids.includes(c.iid));
      if (pl.active && pl.active.iid === target.iid) {
        return {
          ...pl,
          discard: rest,
          active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] },
        };
      }
      return {
        ...pl,
        discard: rest,
        bench: pl.bench.map(c => c.iid === target.iid
          ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
          : c),
      };
    });
  }
  // 多隻 Stage2 → 第二步選目標
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'naruei-encourage-commit',
    params: { energyIids: iids, validIids: validStage2.map(c => c.iid) },
  });
});
regR('naruei-encourage-commit', (st, idx, iids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.discard.filter(c => energyIids.includes(c.iid));
  if (energies.length === 0) return st;
  const targetName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `鳴依的勉勵：將 ${energies.length} 張基本能量附加到 ${targetName}`, idx);
  return updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => !energyIids.includes(c.iid));
    if (pl.active && pl.active.iid === targetIid) {
      return {
        ...pl,
        discard: rest,
        active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] },
      };
    }
    return {
      ...pl,
      discard: rest,
      bench: pl.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    };
  });
});
