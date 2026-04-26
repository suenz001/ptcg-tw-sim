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

// ── v2.171 城鎮百貨公司（Stadium）── 牌庫搜 1 道具加手牌 ─────────────────
regR('town-department-tool', (st, idx, iids) => {
  return updatePlayer(st, idx, p => {
    const set = new Set(iids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── v2.171 深缽鎮（Stadium）── 牌庫搜 1 基礎非規則寶可夢放備戰 ────────────
regR('deepbasin-place', (st, idx, iids) => {
  return updatePlayer(st, idx, p => {
    if (iids.length === 0) return { ...p, deck: shuffle(p.deck) };
    if (p.bench.length >= 5) return { ...p, deck: shuffle(p.deck) };
    const targetIid = iids[0];
    const inst = p.deck.find(c => c.iid === targetIid);
    if (!inst) return { ...p, deck: shuffle(p.deck) };
    const placed = { ...inst, justPlaced: true };
    const rest = p.deck.filter(c => c.iid !== targetIid);
    return { ...p, deck: shuffle(rest), bench: [...p.bench, placed] };
  });
});

// ── 尖釘鎮道館（Stadium）── v2.21 ───────────────────────────────────────────
// 從牌庫選 1 張「瑪俐的」寶可夢加手牌並重洗（雙方玩家每回合 1 次）
// v2.70：放寬 — 即使牌庫沒有「瑪俐的」寶可夢也能使用（engine 改以 minCount=0
//        開 UI），玩家可藉此檢查牌庫。iids 為空時仍重洗牌庫並記 log。
regR('spikemuth-marnie-search', (st, idx, iids, _params, pool) => {
  const p = st.players[idx];
  const picked = p.deck.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const msg = picked.length === 0
    ? '尖釘鎮道館：未選到「瑪俐的」寶可夢（重洗牌庫）'
    : `尖釘鎮道館：${names} 加入手牌（重洗牌庫）`;
  const s = addLog(st, msg, idx);
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

// ── 靜態被動競技場 ── v2.96 ───────────────────────────────────────────────────
// 卡面開頭是「只要…」「雙方…的…」「雙方場上…」格式的 Stadium，屬於「放下即生效、
// 效果持續到被換場、無主動觸發」的純被動 stadium。玩家不需（也不該）按「使用」按鈕。
//
// 新增規則：加入新 Stadium 時若 rulesText 不含「可使用 1 次」語意，一律 passive。
// 反之有「在自己的回合時，可使用 1 次」才屬主動 stadium（如衝浪海灘 / 釀光市 / 月光丘陵）。
//
// 注意：列在這裡的 stadium 不保證效果已實裝（例：險惡廢墟 / 活力森林 / 激動競技場
// 等被動效果目前未實裝），但至少 UI 不會誤顯示「使用」按鈕。
export const STATIC_PASSIVE_STADIUMS = new Set<string>([
  '引力山岳',       // 2 階進化 HP -30（v2.92 實裝）
  '激動競技場',     // 基礎 HP +30
  '昂主花葉蒂',     // 超級花葉蒂ex HP +150
  '險惡廢墟',       // 上備戰放 2 指示物（惡除外）
  '活力森林',       // 草可剛出場進化
  '暈眩山谷',       // 混亂不因進化恢復
  'N的城堡',         // N 寶可夢撤退 0
  '零之大空洞',     // 太晶備戰 8 隻
  '化朗鎮',         // 赫普寶可夢傷害 +30
  '夜間礦山',       // 太晶能量 +1 無
  '危險密林',       // 中毒指示物 +2
  '全金屬實驗室',   // 鋼寶可夢受傷 -30
  '祭典會場',       // 附能量寶可夢免疫狀態
  '中立中心',       // 非規則盒不受 ex/V 招式傷害
  '石之洞窟',       // 大吾寶可夢受傷 -30
  // 註：本 set 未實裝效果的 stadium 仍會放下成為場地（engine 預設行為），
  // 但不會冒「使用」按鈕。個別被動效果需個別實裝到 engine/effects 層。
]);

// ── 被動競技場（UI 用）── v2.31 ───────────────────────────────────────────────
// 純被動：放下即生效、效果持續到被換場，無主動觸發動作 → UI 不需顯示「使用競技場」按鈕。
//   - BENCH_PROTECTION_STADIUMS：備戰保護（對戰圓形競技場）
//   - JAMMING_TOWER_STADIUMS：雙方道具無效（阻礙之塔）
//   - ROCKET_WATCHTOWER_STADIUMS：雙方【無】寶可夢特性無效（火箭監視塔）
//   - STATIC_PASSIVE_STADIUMS：其他「只要場上即生效」類 stadium（引力山岳等，v2.96 加）
// /routes/game/+page.svelte 的 `canUseStadium` 會透過 helper 過濾這組成員。
// 新增純被動場地卡時記得加到上方 STATIC_PASSIVE_STADIUMS。
export const PASSIVE_STADIUMS = new Set<string>([
  ...BENCH_PROTECTION_STADIUMS,
  ...JAMMING_TOWER_STADIUMS,
  ...ROCKET_WATCHTOWER_STADIUMS,
  ...STATIC_PASSIVE_STADIUMS,
]);
