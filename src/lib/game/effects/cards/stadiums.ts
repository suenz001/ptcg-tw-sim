/**
 * 競技場卡（Stadium）效果
 *
 * v2.10 (Session 38b7)：從 effects.ts 抽離，模組化第 3 波。
 *
 * PTCG 場地卡的效果在 engine / effects 兩側分工：
 *   1. USE_STADIUM action —— engine.ts 的 USE_STADIUM handler 直接處理放置與
 *      部分場地卡的即時效果（如 居民會館：補 1 張；危險密林：engine 側中毒額外 +20）。
 *      若需要互動選擇（選能量、選手牌），engine 會觸發 pendingSelection 並交由
 *      下方的 regR() resolver 處理最終狀態變更。
 *   2. 場上狀態 hook —— engine.ts 查 state.activeStadium.name 決定副作用範圍。
 *      例如 JAMMING_TOWER_STADIUMS 所列的場地卡在場上時，雙方所有【道具】效果停擺。
 *
 * 這個檔案只負責 USE_STADIUM 的 resolver + engine 側 hook 資料集。
 * engine.ts 裡的 USE_STADIUM handler 本身仍保留原處（牽涉放置、丟棄、
 * stadiumUsedThisTurn 旗標等引擎層狀態）。
 */

import { regR, updatePlayer } from '../_shared';

// ── 神秘花園（Stadium）──────────────────────────────────────────────────────
// 丟 1 張超能量 → 抽到手牌數 = 己方場上超屬寶可夢數量
regR('miracle-garden-draw', (st, idx, picked, _params, pool) => {
  const energyIid = picked[0];
  return updatePlayer(st, idx, p => {
    const eIdx = p.hand.findIndex(i => i.iid === energyIid);
    if (eIdx < 0) return p;
    const energyInst = p.hand[eIdx];
    const newHand = p.hand.filter((_, i) => i !== eIdx);
    const newDiscard = [...p.discard, energyInst];

    // Count Psychic Pokémon in play
    const allField = [...(p.active ? [p.active] : []), ...p.bench];
    const psychicCount = allField.filter(pk => {
      const c = pool.get(pk.cardId);
      return c?.pokemonType === 'Psychic';
    }).length;

    // Draw until hand.length === psychicCount
    const toDraw = Math.max(0, psychicCount - newHand.length);
    const drawn = p.deck.slice(0, Math.min(toDraw, p.deck.length));

    return {
      ...p,
      hand: [...newHand, ...drawn],
      deck: p.deck.slice(drawn.length),
      discard: newDiscard,
    };
  });
});

// ── 夜間學院（Stadium）──────────────────────────────────────────────────────
// 選 1 張手牌放回牌庫上方
regR('night-academy-top', (st, idx, iids) => {
  return updatePlayer(st, idx, p => {
    const chosen = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    return { ...p, hand: newHand, deck: [...chosen, ...p.deck] };
  });
});

// ── 月光丘陵（Stadium）──────────────────────────────────────────────────────
// 丟 1 張超能量 → 全體回 30 HP
regR('moonlight-hill-heal', (st, idx, iids) => {
  return updatePlayer(st, idx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    const healActive = p.active ? { ...p.active, damage: Math.max(0, p.active.damage - 30) } : null;
    const healBench = p.bench.map(c => ({ ...c, damage: Math.max(0, c.damage - 30) }));
    return { ...p, hand: newHand, discard: [...p.discard, ...toDiscard], active: healActive, bench: healBench };
  });
});

// ── 阻礙之塔（Stadium）── 引擎側 hook ────────────────────────────────────────
// 用途：engine.ts 在查 TOOL_* 映射前檢查 activeStadium 是否在此集合中。
// 若是則視同「道具無效」，TOOL_* 的效果全部不觸發（含 HP、攻擊、防禦、KO、
// 被 KO、受傷、撤退 cost）。附著動作本身不受影響（可附、可丟）。
export const JAMMING_TOWER_STADIUMS = new Set<string>(['阻礙之塔']);
