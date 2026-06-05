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

import { regR, updatePlayer, shuffle, addLog, clearActiveEffects, getOwnBenchLimit,
} from '../_shared';
import { joinCardNames } from '../_shared';
import { tryPromptPromoteActive } from '../_shared';

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
regR('moonlight-hill-heal', (st, idx, iids, _params, pool) => {
  const _md = st.players[idx].hand.filter(c => iids.includes(c.iid));
  st = addLog(st, `月光之丘：丟棄 ${_md.length} 張能量：${joinCardNames(_md, pool)}，全體回 30 HP`, idx);
  return updatePlayer(st, idx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    const healActive = p.active ? { ...p.active, damage: Math.max(0, p.active.damage - 30) } : null;
    const healBench = p.bench.map(c => ({ ...c, damage: Math.max(0, c.damage - 30) }));
    return { ...p, hand: newHand, discard: [...p.discard, ...toDiscard], active: healActive, bench: healBench };
  });
});

// ── v2.172 釀光市（Stadium / I）── 棄牌搜 ≤2 基本【雷】能量加手 ──────────
regR('lighting-city-pick', (st, idx, iids, _params, _pool) => {
  if (iids.length === 0) return addLog(st, '釀光市：未選擇能量', idx);
  const set = new Set(iids);
  return updatePlayer(addLog(st, `釀光市：${iids.length} 張基本【雷】能量加入手牌`, idx), idx, p => {
    const got = p.discard.filter(c => set.has(c.iid));
    const rest = p.discard.filter(c => !set.has(c.iid));
    return { ...p, discard: rest, hand: [...p.hand, ...got] };
  });
});

// ── v2.172 衝浪海灘（Stadium / I）── 戰鬥場【水】↔備戰【水】互換 ──────────
regR('surf-beach-swap', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  if (!targetIid) return st;
  const p = st.players[idx];
  if (!p.active) return st;
  const benchIdx = p.bench.findIndex(c => c.iid === targetIid);
  if (benchIdx < 0) return st;
  const newName = pool.get(p.bench[benchIdx].cardId)?.name ?? '?';
  const oldName = pool.get(p.active.cardId)?.name ?? '?';
  st = addLog(st, `衝浪海灘：${oldName} ↔ ${newName}（戰鬥/備戰互換）`, idx);
  // v5.243：包 tryPromptPromoteActive — 自方換位 ON_PROMOTE_TO_ACTIVE prompt
  return tryPromptPromoteActive(updatePlayer(st, idx, pl => {
    if (!pl.active) return pl;
    const newBench = [...pl.bench];
    // v3.812 Bug fix：bench → active 純位置交換，preserve justPlaced + playedFromHand
    //   PTCG 規則：這回合打出的寶可夢，不論在備戰還是戰鬥位都不能進化（v3.811 範例：呱呱泡蛙
    //   剛被放到備戰 → 衝浪海灘 swap 到戰鬥場 → 居然能進化）。原本 hard-set false 是 bug。
    const newActive = { ...pl.bench[benchIdx], movedToActiveThisTurn: true };
    newBench[benchIdx] = clearActiveEffects(pl.active);
    return { ...pl, active: newActive, bench: newBench };
  }), idx, pool);
});

// ── v2.172 密阿雷市（Stadium / J）── 牌庫搜 1 基礎放備戰 + 回合結束 ──────
regR('miarey-city-place', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer({ ...st, turnPhase: 'end' as const }, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '密阿雷市：未選擇 — 此回合結束', idx);
  }
  const targetIid = iids[0];
  const inst = st.players[idx].deck.find(c => c.iid === targetIid);
  if (!inst) return st;
  const name = pool.get(inst.cardId)?.name ?? '?';
  st = addLog(st, `密阿雷市：${name} 放置到備戰區，重洗牌庫 — 此回合結束`, idx);
  st = updatePlayer(st, idx, p => {
    if (p.bench.length >= getOwnBenchLimit(st, idx, pool)) return { ...p, deck: shuffle(p.deck) };
    const placed = { ...inst, justPlaced: true };
    const rest = p.deck.filter(c => c.iid !== targetIid);
    return { ...p, deck: shuffle(rest), bench: [...p.bench, placed] };
  });
  return { ...st, turnPhase: 'end' as const };
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
regR('deepbasin-place', (st, idx, iids, _params, pool) => {
  return updatePlayer(st, idx, p => {
    if (iids.length === 0) return { ...p, deck: shuffle(p.deck) };
    if (p.bench.length >= getOwnBenchLimit(st, idx, pool)) return { ...p, deck: shuffle(p.deck) };
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
// v4.45：以下每張 stadium 都已實裝（comment 註明版本與 hook 點），不再有「stub」項目。
// 新增 passive stadium 時，必須先寫 hook、跑測試，再把名字 commit 進此 set。
export const STATIC_PASSIVE_STADIUMS = new Set<string>([
  '引力山岳',       // v2.92 已實裝 — 2 階進化 HP -30（engine.ts getEffectiveHP）
  '激動競技場',     // v2.265 已實裝 — 基礎 HP +30（engine.ts getEffectiveHP）
  '昂主花葉蒂',     // v2.382 已實裝 — 超級花葉蒂ex HP +150（engine.ts getEffectiveHP 鏡射 effects.ts）
  '險惡廢墟',       // v2.119 已實裝 — 上備戰放 2 指示物（_shared.ts:736-769 helper, engine.ts:1866 + 各 search resolver 呼叫）
  '活力森林',       // v2.102 已實裝 — 草可剛出場進化（engine.ts:1995-2012 EVOLVE bypass + 6214-6220 UI helper）
  '暈眩山谷',       // v3.77 已實裝 — 進化時混亂保留（engine.ts EVOLVE handler）
  'N的城堡',         // 已實裝 — N 寶可夢撤退 0
  '零之大空洞',     // 已實裝 — 太晶備戰 8 隻
  '化朗鎮',         // v3.76 已實裝 — 赫普寶可夢招式傷害 +30（engine.ts attack pipeline）
  '夜間礦山',       // v3.77 已實裝 — 太晶寶可夢 attack cost +1 無（engine.ts canAffordAttack）
  '危險密林',       // 已實裝 — 中毒指示物 +20 傷害 / turn（engine.ts:4964 checkup）
  '全金屬實驗室',   // v3.77 已實裝 — 鋼寶可夢受傷 -30（engine.ts attack pipeline）
  '祭典會場',       // 已實裝 — 附能量寶可夢免疫狀態（statusPost guard）
  '中立中心',       // v3.67 已實裝 — 非規則寶可夢不受對手 ex/V 招式傷害（NEUTRAL_CENTER_STADIUMS in effects.ts）
  '石之洞窟',       // v3.77 已實裝 — 「大吾的」寶可夢受傷 -30（engine.ts attack pipeline）
  '樂園度假地',     // v2.177 已實裝 — 可達鴨撤退 -1
]);

// ── 被動競技場（UI 用）── v2.31 ───────────────────────────────────────────────
// 純被動：放下即生效、效果持續到被換場，無主動觸發動作 → UI 不需顯示「使用競技場」按鈕。
//   - BENCH_PROTECTION_STADIUMS：備戰保護（對戰圓形競技場）
//   - JAMMING_TOWER_STADIUMS：雙方道具無效（阻礙之塔）
//   - ROCKET_WATCHTOWER_STADIUMS：雙方【無】寶可夢特性無效（火箭監視塔）
//   - STATIC_PASSIVE_STADIUMS：其他「只要場上即生效」類 stadium（引力山岳等，v2.96 加）
// /routes/game/+page.svelte 的 `canUseStadium` 會透過 helper 過濾這組成員。
// 新增純被動場地卡時記得加到上方 STATIC_PASSIVE_STADIUMS。
/**
 * v3.68 ⚠️ 新鐵律：加入 PASSIVE_STADIUMS 的成員「名字在 set 內」≠「效果已實裝」。
 *   必須在註冊 stadium 同時，於下列 hook 點 至少一處 加對應邏輯：
 *     - engine.ts attack damage pipeline（受傷 +/- N 類）
 *     - engine.ts checkup（中毒/灼傷 加成類）
 *     - effects.ts attack pipeline 內條件（特定屬性 +N 傷害）
 *     - effects.ts retreat cost / evolve gate / energy attach 等其他 hook
 *   每條成員後面 comment 必須註明「實裝於 [檔案:行] / hook X」，避免變成 stub。
 *
 *   反例：v3.67 之前的中立中心 — 名字在 set 但沒對應 hook，玩家放下後完全無效果。
 *   下次新增 passive stadium：先寫 hook、跑測試，再把名字 commit 進 set。
 */
export const PASSIVE_STADIUMS = new Set<string>([
  ...BENCH_PROTECTION_STADIUMS,
  ...JAMMING_TOWER_STADIUMS,
  ...ROCKET_WATCHTOWER_STADIUMS,
  ...STATIC_PASSIVE_STADIUMS,
]);
