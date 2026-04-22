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

import { regR, updatePlayer, shuffle, addLog } from '../_shared';

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

// ── 尖釘鎮道館（Stadium）── v2.21 ───────────────────────────────────────────
// 從牌庫選 1 張「瑪俐的」寶可夢加手牌並重洗（雙方玩家每回合 1 次）
regR('spikemuth-marnie-search', (st, idx, iids, _params, pool) => {
  const p = st.players[idx];
  const picked = p.deck.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const s = addLog(st, `尖釘鎮道館：${names || '未選擇'} 加入手牌（重洗牌庫）`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    hand: [...pl.hand, ...picked],
    deck: shuffle(pl.deck.filter(c => !iids.includes(c.iid))),
  }));
});

// ── 阻礙之塔（Stadium）── 引擎側 hook ────────────────────────────────────────
// 用途：engine.ts 在查 TOOL_* 映射前檢查 activeStadium 是否在此集合中。
// 若是則視同「道具無效」，TOOL_* 的效果全部不觸發（含 HP、攻擊、防禦、KO、
// 被 KO、受傷、撤退 cost）。附著動作本身不受影響（可附、可丟）。
export const JAMMING_TOWER_STADIUMS = new Set<string>(['阻礙之塔']);

// ── 火箭隊的監視塔（Stadium）── 引擎側 hook ──────────────────────────────────
// 用途：engine.ts 在觸發寶可夢特性前，檢查 activeStadium 是否在此集合中，
// 且該寶可夢的 pokemonType 為 'Colorless'（台版【無】屬）。若是則該特性不發動：
//   1. 主動特性（USE_ABILITY / getUsableAbilities UI）
//   2. 上備戰時觸發（BENCH_PLACE_TRIGGERS）
//   3. （未實裝）被動特性 — 被動特性散落在 ATTACK_PRE/POST 各自檢查，
//      若日後發現 Colorless 被動特性跟本機制互動有誤，再各自加 isColorlessAbilityBlocked 閘門。
// 卡面文字：「雙方場上所有【無】寶可夢的特性全部消除。」
export const ROCKET_WATCHTOWER_STADIUMS = new Set<string>(['火箭隊的監視塔']);

// ── 對戰圓形競技場（Stadium）── 引擎側 hook ── v2.22 ──────────────────────────
// 卡面文字：「雙方的所有備戰寶可夢，不會因對手的招式與特性的效果而被放置傷害指示物。
//   [會受到招式的傷害。]」
// 實裝範圍：各 bench-snipe resolver（snipe-10/20/30/60/120/variable/multi）、
//   cursed-bomb（自 KO 特性類）、bench-hit-N、damage-distribute（幻影奇襲 類）、
//   applyDamageToAllOpp 全體指示物類——若 activeStadium 為此集合成員且目標為備戰，
//   放置動作直接跳過（僅記一條 log）。
// 註：括號內「會受到招式的傷害」指直接攻擊戰鬥位的招式傷害（weakness/resistance 計算）
//   不受此卡影響；因此 ATTACK pipeline 的 active-hit 不需要閘門。
export const BENCH_PROTECTION_STADIUMS = new Set<string>(['對戰圓形競技場']);

// ── 被動競技場（UI 用）── v2.31 ───────────────────────────────────────────────
// 純被動：放下即生效、效果持續到被換場，無主動觸發動作 → UI 不需顯示「使用競技場」按鈕。
//   - 對戰圓形競技場：備戰保護
//   - 阻礙之塔：雙方道具無效
//   - 火箭隊的監視塔：雙方【無】寶可夢特性無效
// /routes/game/+page.svelte 的 `canUseStadium` 會透過 helper 過濾這組成員。
// 新增純被動場地卡時記得加進來。
export const PASSIVE_STADIUMS = new Set<string>([
  ...BENCH_PROTECTION_STADIUMS,
  ...JAMMING_TOWER_STADIUMS,
  ...ROCKET_WATCHTOWER_STADIUMS,
]);
