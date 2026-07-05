/**
 * v2.172 — H/I/J 標卡池清掃第 1 波（不需新引擎機制的卡）
 *
 * Leon 指示：「g標的就先不用處理 先把 h i j標處理好」。
 *
 * 本版實裝（10 張）：
 *   - 釀光市 (I, Stadium)：棄牌搜 ≤2 張基本【雷】能量加手
 *   - 衝浪海灘 (I, Stadium)：戰鬥場【水】寶可夢 ↔ 備戰【水】寶可夢互換
 *   - 密阿雷市 (J, Stadium)：牌庫搜 1 張【基礎】寶可夢放備戰，使用後回合結束
 *   - N的謀劃 (I, Supporter)：選擇最多 2 個自己備戰寶可夢身上的能量改附戰鬥場
 *   - 沙儷 (H, Supporter)：手牌寶可夢 ≤2 張回牌庫，再從牌庫搜相同數量寶可夢
 *   - 琉琪亞的展示 (H, Supporter)：對手戰鬥↔備戰換 + 新上場混亂
 *   - 滑稽演員 (I, Supporter)：雙方手牌洗回牌庫，coin → 自抽 5/3 對抽 3/5
 *   - 悟松 (H, Supporter)：雙方手牌洗回，雙方 coin → 各自抽 6/3
 *   - 卡娜莉 (I, Supporter)：棄手牌 1 張前置 + 牌庫搜雷寶 ≤4
 *   - 火箭隊的超級球 (I, Item)：coin 正面=進化「火箭隊的」/反面=基礎「火箭隊的」
 */

import {
  reg, regR, regG, regA,
  addLog, addPrivateLog, updatePlayer, withPending, shuffle, clearActiveEffects, drawCards,
  sameEvoName,
  addPendingPrize, getOwnBenchLimit, revealTopCardsLog} from '../_shared';
import { evolvedStatusAfter, buildEvolvedInstance } from '../_shared'; // v5.741/v5.742 進化狀態+建構中央
import { joinCardNames } from '../_shared';
import { isBasicPokemonCard } from '../../engine';
import { flipCoinsWithLog, applyStatusToOppActive } from '../../effects';
import type { CardInstance, PlayerState } from '../../types';
import type { Card } from '$lib/cards/types';

// ── 釀光市（Stadium / I）─ 雙方每回合 1 次：棄牌搜 ≤2 基本【雷】能量加手
// 注意：Stadium 由 engine USE_STADIUM 處理。這裡只放 resolver。
// engine USE_STADIUM 還沒登錄這個 stadium → 走 default 分支只 log 名稱不觸發 pending。
// 為了避免改 engine（已加 3 個 stadium 在 v2.171），這裡用一個「Stadium 主動觸發」的迂迴：
// 玩家想用釀光市效果時，engine 會 fallback 到 default log；資料層接不上 — 暫時跳過 engine 整合，
// 留 resolver 待之後 engine 同步。為 audit 計，仍 register 名稱。
// 完整實作見 engine.ts 的 USE_STADIUM section（同 v2.171 模式）。

// ── 火箭隊的超級球（Item / I）── coin → 進化/基礎「火箭隊的」搜
regG('火箭隊的超級球', (st, idx) => st.players[idx].deck.length > 0);
reg('火箭隊的超級球', (st, idx, pool) => {
  const rfb = flipCoinsWithLog(st, 1, '火箭隊的超級球', idx);
  st = rfb.state;
  const heads = rfb.heads === 1;
  const validIids = st.players[idx].deck
    .filter(c => {
      const card = pool.get(c.cardId);
      if (!card?.name?.startsWith('火箭隊的')) return false;
      if (card.supertype !== 'Pokemon') return false;
      const isEvo = !!card.evolvesFrom;
      return heads ? isEvo : !isEvo;
    })
    .map(c => c.iid);
  st = addLog(st, `火箭隊的超級球：從牌庫選 1 張${heads ? '進化' : '基礎'}「火箭隊的」寶可夢加手（候選 ${validIids.length} 張）`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    // v2.993：卡面寫「選 1 張」mandatory；候選 0 張時允許 Pass
    minCount: validIids.length > 0 ? 1 : 0, maxCount: 1,
    effectKey: 'rocket-superball-pick',
    params: { validIids },
  });
});
regR('rocket-superball-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '火箭隊的超級球：未選擇（牌庫已重洗）', idx);
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.96：卡面「給對手看過」→ 公開卡名
  st = addLog(st, `火箭隊的超級球：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const set = new Set(iids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── N的謀劃（Supporter / I）── 選 ≤2 個備戰能量改附戰鬥場
regG('N的謀劃', (st, idx) => {
  if (!st.players[idx].active) return false;
  return st.players[idx].bench.some(c => c.energyAttached.length > 0);
});
reg('N的謀劃', (st, idx) => {
  // 卡面：選擇最多 2 個自己「備戰」寶可夢身上附加的能量，改附於戰鬥場寶可夢。
  // v5.663：原本用 bench-choose 只讓玩家選「備戰寶可夢」，再自動取該寶可夢的「末張」能量改附
  //   → 多屬性備戰(如同時有【惡】【水】)時系統幫玩家選(末張)，違反卡面「選擇能量」(玩家報)。
  //   改用中央 active-energy-discard 能量 picker(scope='all-own', validIids 限備戰能量, maxCount=2)，
  //   讓玩家自己挑哪幾張能量；resolver 把選中能量移到戰鬥場。
  const benchEnergyIids = st.players[idx].bench.flatMap(c => c.energyAttached.map(e => e.iid));
  if (benchEnergyIids.length === 0 || !st.players[idx].active) {
    return addLog(st, 'N的謀劃：備戰無能量或無戰鬥位 → 無效果', idx);
  }
  st = addLog(st, 'N的謀劃：選擇最多 2 個備戰寶可夢身上的能量，改附到戰鬥場', idx);
  return withPending(st, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: 2,
    effectKey: 'n-plot-energy-move',
    params: { scope: 'all-own', validIids: benchEnergyIids, titleOverride: 'N的謀劃：選最多 2 個備戰能量改附戰鬥場' },
  });
});
regR('n-plot-energy-move', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, 'N的謀劃：未選擇能量 → 結束', idx);
  const sel = new Set(iids.slice(0, 2));  // 卡面上限 2 個
  const p0 = st.players[idx];
  // 從備戰各 owner 收集選中的能量(只取備戰上的，戰鬥場自身能量不在 validIids 不會被選)
  const moved = p0.bench.flatMap(b => b.energyAttached.filter(e => sel.has(e.iid)));
  if (moved.length === 0 || !p0.active) return addLog(st, 'N的謀劃：無有效能量 → 結束', idx);
  st = updatePlayer(st, idx, p => {
    if (!p.active) return p;
    return {
      ...p,
      bench: p.bench.map(b => ({ ...b, energyAttached: b.energyAttached.filter(e => !sel.has(e.iid)) })),
      active: { ...p.active, energyAttached: [...p.active.energyAttached, ...moved] },
    };
  });
  const activeName = st.players[idx].active ? (pool.get(st.players[idx].active!.cardId)?.name ?? '?') : '?';
  const names = moved.map(e => pool.get(e.cardId)?.name ?? '能量').join('、');
  return addLog(st, `N的謀劃：將 ${names}（${moved.length} 個）改附 ${activeName}`, idx);
});

// ── 沙儷（Supporter / H）── 手牌寶可夢 ≤2 回牌庫 + 牌庫搜寶可夢相同數量
regG('沙儷', (st, idx, pool) => {
  return st.players[idx].hand.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
});
reg('沙儷', (st, idx, pool) => {
  const handPokeIids = st.players[idx].hand
    .filter(c => pool.get(c.cardId)?.supertype === 'Pokemon')
    .map(c => c.iid);
  st = addLog(st, '沙儷：從手牌選最多 2 張寶可夢放回牌庫', idx);
  return withPending(st, {
    type: 'hand-discard',  // 借用 hand-discard UI（其實放回牌庫，resolver 處理）
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: Math.min(2, handPokeIids.length),
    filter: 'Pokemon',
    effectKey: 'sari-return-then-search',
    // v3.62 titleOverride：說明「放回牌庫」而非預設的中性 title
    params: { validIids: handPokeIids, titleOverride: '沙儷：選最多 2 張寶可夢放回牌庫' },
  });
});
regR('sari-return-then-search', (st, idx, iids, _params, pool) => {
  // 手牌的選中寶可夢回牌庫
  const set = new Set(iids);
  const returned = st.players[idx].hand.filter(c => set.has(c.iid));
  const returnCount = returned.length;
  if (returnCount > 0) {
    const names = returned.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `沙儷：${names} 放回牌庫`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: p.hand.filter(c => !set.has(c.iid)),
      deck: [...p.deck, ...returned],  // 暫加底，下一階段重洗
    }));
  } else {
    st = addLog(st, '沙儷：未選擇寶可夢回牌庫', idx);
  }
  if (returnCount === 0) {
    // 沒放回也要重洗（卡面流程）
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '沙儷：重洗牌庫', idx);
  }
  // 接：從牌庫搜相同數量寶可夢加手牌
  st = addLog(st, `沙儷：從牌庫選最多 ${returnCount} 張寶可夢加手牌`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: returnCount,
    effectKey: 'sari-search',
  });
});
regR('sari-search', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '沙儷：未選擇寶可夢（牌庫已重洗）', idx);
  }
  const set = new Set(iids);
  const picked = st.players[idx].deck.filter(c => set.has(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.96：卡面「給對手看過」→ 公開卡名
  st = addLog(st, `沙儷：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 琉琪亞的展示（Supporter / H）── 對手戰↔備戰換 + 新上場混亂
// v5.073：改用 isBasicPokemonCard helper — 原本 subtype === 'Basic' 會把基礎 ex
//   寶可夢全部漏掉（基礎 ex 的 subtype='ex'，不是 'Basic'；資料源 319 張）。
//   卡面寫「【基礎】寶可夢」未排除 ex，正確判定 = supertype Pokemon + !evolvesFrom + 非 Stage1/2。
regG('琉琪亞的展示', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  // 對手必須有戰鬥場 + 至少 1 隻基礎備戰（含基礎 ex）
  if (!st.players[dIdx].active) return false;
  return st.players[dIdx].bench.some(c => isBasicPokemonCard(pool.get(c.cardId)));
});
reg('琉琪亞的展示', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const validIids = dp.bench
    .filter(c => isBasicPokemonCard(pool.get(c.cardId)))
    .map(c => c.iid);
  if (validIids.length === 0 || !dp.active) {
    return addLog(st, '琉琪亞的展示：對手備戰無基礎寶可夢', idx);
  }
  st = addLog(st, '琉琪亞的展示：選 1 隻對手備戰基礎寶可夢，與其戰鬥場互換並混亂', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'lucia-show',
    params: { validIids },
  });
});
regR('lucia-show', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const targetIid = iids[0];
  const dp = st.players[dIdx];
  const target = dp.bench.find(c => c.iid === targetIid);
  if (!target || !dp.active) return st;
  const newName = pool.get(target.cardId)?.name ?? '?';
  const oldName = pool.get(dp.active.cardId)?.name ?? '?';
  st = addLog(st, `琉琪亞的展示：對手 ${oldName} 換到備戰，${newName} 上場並混亂`, idx);
  st = updatePlayer(st, dIdx, p => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === targetIid);
    if (bIdx < 0) return p;
    const newBench = [...p.bench];
    newBench[bIdx] = clearActiveEffects(p.active);
    return {
      ...p,
      // v3.812：preserve justPlaced + playedFromHand（被強制換到戰鬥場不該重置剛打出 flag）
      active: { ...target },
      bench: newBench,
    };
  });
  // v5.675 收斂：換場後混亂走中央（琉琪亞的展示是訓練家卡=item-effect，不被化隱擋，但補憨憨臉免疫）。
  //   新上場 active 無既有狀態，helper 直接放置於 status 主格。
  return applyStatusToOppActive(st, idx, 'confused', pool, { kind: 'item-effect', label: '琉琪亞的展示' });
});

// ── 滑稽演員（Supporter / I）── 雙方手洗回 + coin: heads 5/3 / tails 3/5
regG('滑稽演員', () => true);
reg('滑稽演員', (st, idx) => {
  const rhx = flipCoinsWithLog(st, 1, '滑稽演員', idx);
  st = rhx.state;
  const heads = rhx.heads === 1;
  st = addLog(st, '滑稽演員：雙方手牌洗回牌庫', idx);
  const players = [...st.players] as [PlayerState, PlayerState];
  const dIdx = (1 - idx) as 0 | 1;
  // 雙方手→牌庫並重洗
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    p.deck = shuffle([...p.deck, ...p.hand]);
    p.hand = [];
    players[i] = p;
  }
  // 抽卡：coin heads → self 5 / opp 3；tails → self 3 / opp 5
  const selfDraw = heads ? 5 : 3;
  const oppDraw = heads ? 3 : 5;
  const me = { ...players[idx] };
  const meTake = me.deck.slice(0, Math.min(selfDraw, me.deck.length));
  me.hand = meTake;
  me.deck = me.deck.slice(meTake.length);
  players[idx] = me;
  const op = { ...players[dIdx] };
  const opTake = op.deck.slice(0, Math.min(oppDraw, op.deck.length));
  op.hand = opTake;
  op.deck = op.deck.slice(opTake.length);
  players[dIdx] = op;
  return addLog({ ...st, players }, `滑稽演員：自方抽 ${meTake.length} / 對方抽 ${opTake.length}`, idx);
});

// ── 悟松（Supporter / H）── 雙方手洗回，各 coin → 抽 6/3
regG('悟松', () => true);
reg('悟松', (st, idx) => {
  st = addLog(st, '悟松：雙方手牌洗回牌庫，雙方各擲硬幣決定抽 6 或 3', idx);
  const players = [...st.players] as [PlayerState, PlayerState];
  for (const i of [0, 1] as const) {
    const p = { ...players[i] };
    p.deck = shuffle([...p.deck, ...p.hand]);
    p.hand = [];
    const rws = flipCoinsWithLog(st, 1, '悟松', idx);
    st = rws.state;
    const heads = rws.heads === 1;
    const drawN = heads ? 6 : 3;
    const taken = p.deck.slice(0, Math.min(drawN, p.deck.length));
    p.hand = taken;
    p.deck = p.deck.slice(taken.length);
    players[i] = p;
    st = addLog({ ...st, players }, `悟松：${p.name} 擲 ${heads ? '正面 → 抽 6' : '反面 → 抽 3'}（實際 ${taken.length} 張）`, null);
  }
  return { ...st, players };
});

// ── 卡娜莉（Supporter / I）── 棄手牌 1 張 + 牌庫搜【雷】寶可夢 ≤4
regG('卡娜莉', (st, idx, pool) => {
  // 必須 ≥2 張手牌（卡娜莉本身 + 至少 1 張可棄）+ 牌庫至少 1 張雷寶
  if (st.players[idx].hand.length < 2) return false;
  return st.players[idx].deck.length > 0;
});
reg('卡娜莉', (st, idx) => {
  st = updatePlayer(st, idx, p => ({ ...p, carnelliPlayedThisTurn: true }));
  st = addLog(st, '卡娜莉：先棄 1 張手牌（除自身外）', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    filter: '',
    effectKey: 'kanari-discard-then-search',
  });
});
regR('kanari-discard-then-search', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const set = new Set(iids);
  const _kd = st.players[idx].hand.filter(c => set.has(c.iid));
  st = updatePlayer(st, idx, p => {
    const discarded = p.hand.filter(c => set.has(c.iid));
    const newHand = p.hand.filter(c => !set.has(c.iid));
    return { ...p, hand: newHand, discard: [...p.discard, ...discarded] };
  });
  st = addLog(st, `卡娜莉：手牌已棄（${joinCardNames(_kd, pool)}），從牌庫選最多 4 張【雷】寶可夢加手`, idx);
  const validIids = st.players[idx].deck
    .filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Pokemon' && card.pokemonType === 'Lightning';
    })
    .map(c => c.iid);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: Math.min(4, validIids.length),
    effectKey: 'kanari-pick',
    params: { validIids },
  });
});
regR('kanari-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '卡娜莉：未選擇（牌庫已重洗）', idx);
  const set = new Set(iids);
  const picked = st.players[idx].deck.filter(c => set.has(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.96：卡面「給對手看過」→ 公開卡名
  st = addLog(st, `卡娜莉：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 捷朵（Supporter / J）── 抽 = 對手場上「超級進化寶可夢ex」數量
// 「超級進化 ex」= name.startsWith('超級') && ex（與 prizesForKO 同邏輯）
regG('捷朵', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    const isEx = card.name.endsWith('ex') || card.name.endsWith('EX');
    return isEx && card.name.startsWith('超級');
  });
});
reg('捷朵', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  const megaCount = all.filter(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    const isEx = card.name.endsWith('ex') || card.name.endsWith('EX');
    return isEx && card.name.startsWith('超級');
  }).length;
  st = addLog(st, `捷朵：對手場上有 ${megaCount} 隻超級進化ex → 抽 ${megaCount} 張`, idx);
  if (megaCount === 0) return st;
  return updatePlayer(st, idx, p => {
    const taken = p.deck.slice(0, Math.min(megaCount, p.deck.length));
    return { ...p, deck: p.deck.slice(taken.length), hand: [...p.hand, ...taken] };
  });
});

// ── 瑪琪艾兒（Supporter / J）── 看對手手牌 + 抽 = 對手手牌中寶可夢數
regG('瑪琪艾兒', (st, idx) => st.players[(1 - idx) as 0|1].hand.length > 0);
reg('瑪琪艾兒', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const oppHand = st.players[dIdx].hand;
  const handNames = oppHand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const pokeCount = oppHand.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon').length;
  // v3.9992：揭示對手手牌改 addPrivateLog
  st = addPrivateLog(st,
    `瑪琪艾兒：查看對手手牌（${oppHand.length} 張）— ${handNames}`,
    `瑪琪艾兒：查看對手手牌（${oppHand.length} 張）`,
    idx);
  st = addLog(st, `瑪琪艾兒：對手手牌寶可夢 ${pokeCount} 張 → 抽 ${pokeCount} 張`, idx);
  // v2.360：設旗標供 妙喵｜拍檔攻擊 判斷本回合是否出過瑪琪艾兒
  st = updatePlayer(st, idx, p => ({ ...p, magearnaPlayedThisTurn: true }));
  if (pokeCount === 0) return st;
  return updatePlayer(st, idx, p => {
    const taken = p.deck.slice(0, Math.min(pokeCount, p.deck.length));
    return { ...p, deck: p.deck.slice(taken.length), hand: [...p.hand, ...taken] };
  });
});

// ── 可怕的哥哥（Supporter / I）── 對手 1 寶可夢 -1 道具 -1 特殊能量
regG('可怕的哥哥', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  return all.some(pk => {
    const hasTool = !!pk.toolAttached;
    const hasSpecial = pk.energyAttached.some(e => {
      const ec = pool.get(e.cardId);
      return ec?.supertype === 'Energy' && ec.subtype === 'Special';
    });
    return hasTool || hasSpecial;
  });
});
reg('可怕的哥哥', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  const cand = all.filter(pk => {
    const hasTool = !!pk.toolAttached;
    const hasSpecial = pk.energyAttached.some(e => {
      const ec = pool.get(e.cardId);
      return ec?.supertype === 'Energy' && ec.subtype === 'Special';
    });
    return hasTool || hasSpecial;
  });
  if (cand.length === 0) return addLog(st, '可怕的哥哥：對手無可拆道具/特殊能量', idx);
  st = addLog(st, '可怕的哥哥：選 1 隻對手寶可夢，丟 1 道具 + 1 特殊能量', idx);
  return withPending(st, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'creepy-bro-strip',
    params: { includeActive: true, validIids: cand.map(c => c.iid) },
  });
});
// ── 鐵之防禦強化（Item / I）── 下個對手回合自己【鋼】寶可夢受招式 -30
// 設於自己 PlayerState 的 metalShieldNextTurn；於 nextIdx END_TURN promote 為 ThisTurn。
// 在攻擊計算（engine line 2147~）defender 是【鋼】 + defendingPlayer 持 ThisTurn → -30。
regG('鐵之防禦強化', () => true);
reg('鐵之防禦強化', (st, idx) => {
  st = addLog(st, '鐵之防禦強化：下個對手回合，自己所有【鋼】寶可夢受招式 -30', idx);
  return updatePlayer(st, idx, p => ({ ...p, metalShieldNextTurn: (p.metalShieldNextTurn ?? 0) + 1 })); // v5.766：累加(2 張=-60,§17.40.E)
});

// ── 阿塞蘿拉的惡作劇（Supporter / I）── 對手獎賞 ≤2 才可用，1 寶可夢下回合不受 ex 招式
regG('阿塞蘿拉的惡作劇', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  if (st.players[dIdx].prizes.length > 2) return false;
  return !!st.players[idx].active || st.players[idx].bench.length > 0;
});
reg('阿塞蘿拉的惡作劇', (st, idx) => {
  st = addLog(st, '阿塞蘿拉的惡作劇：選 1 隻自己寶可夢，下個對手回合不受 ex 招式', idx);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'acerola-prank',
    params: { includeActive: true },
  });
});
regR('acerola-prank', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  if (!targetIid) return st;
  const target = st.players[idx].active?.iid === targetIid
    ? st.players[idx].active
    : st.players[idx].bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const targetName = pool.get(target.cardId)?.name ?? '?';
  st = addLog(st, `阿塞蘿拉的惡作劇：${targetName} 下個對手回合不受 ex 招式`, idx);
  return updatePlayer(st, idx, p => {
    const apply = (pk: CardInstance) => pk.iid === targetIid
      ? { ...pk, immuneToExAttackNextTurn: true }
      : pk;
    return {
      ...p,
      active: p.active ? apply(p.active) : null,
      bench: p.bench.map(apply),
    };
  });
});

// ── 霍米加的演奏（Supporter / J）── 下個對手回合，對手中毒寶可夢無法撤退
// 設於對手 PlayerState 的 cantRetreatIfPoisonedNextTurn；於對手 END_TURN promote 為 ThisTurn。
regG('霍米加的演奏', () => true);
reg('霍米加的演奏', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '霍米加的演奏：下個對手回合，對手【中毒】寶可夢無法撤退', idx);
  return updatePlayer(st, dIdx, p => ({ ...p, cantRetreatIfPoisonedNextTurn: true }));
});

regR('creepy-bro-strip', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const targetIid = iids[0];
  if (!targetIid) return st;
  const dp = st.players[dIdx];
  const target = dp.active?.iid === targetIid
    ? dp.active
    : dp.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const targetName = pool.get(target.cardId)?.name ?? '?';
  // 找 1 張特殊能量 + 1 張道具
  const discardAdd: CardInstance[] = [];
  let removedTool: CardInstance | undefined;
  let toolName = '';
  if (target.toolAttached) {
    removedTool = target.toolAttached;
    toolName = pool.get(removedTool.cardId)?.name ?? '道具';
    discardAdd.push(removedTool);
  }
  let specialIdx = -1;
  for (let i = target.energyAttached.length - 1; i >= 0; i--) {
    const ec = pool.get(target.energyAttached[i].cardId);
    if (ec?.supertype === 'Energy' && ec.subtype === 'Special') { specialIdx = i; break; }
  }
  let energyName = '';
  if (specialIdx >= 0) {
    const removed = target.energyAttached[specialIdx];
    energyName = pool.get(removed.cardId)?.name ?? '特殊能量';
    discardAdd.push(removed);
  }
  const bits: string[] = [];
  if (toolName) bits.push(`丟 ${toolName}`);
  if (energyName) bits.push(`丟 ${energyName}`);
  st = addLog(st, `可怕的哥哥：${targetName}：${bits.length ? bits.join('，') : '無可丟'}`, idx);
  return updatePlayer(st, dIdx, p => {
    const apply = (pk: CardInstance) => {
      if (pk.iid !== targetIid) return pk;
      const newEnergies = specialIdx >= 0
        ? [
            ...pk.energyAttached.slice(0, specialIdx),
            ...pk.energyAttached.slice(specialIdx + 1),
          ]
        : pk.energyAttached;
      return {
        ...pk,
        toolAttached: undefined,
        energyAttached: newEnergies,
      };
    };
    return {
      ...p,
      active: p.active ? apply(p.active) : null,
      bench: p.bench.map(apply),
      discard: [...p.discard, ...discardAdd],
    };
  });
});

// ── 巴貝娜與荷蓮娜（Supporter / I）── v2.185 ──────────────────────────────────
// 卡面：「這張卡必須自己的場上有『N的達摩狒狒』『N的索羅亞克【ex】』『N的雙倍多多冰』
//        『N的齒輪怪』『N的萊希拉姆』『N的捷克羅姆』，才可使用。
//        在這個回合，若對手的戰鬥寶可夢因自己的『N的寶可夢』使用的招式的傷害而【昏厥】了，
//        則多獲得 3 張獎賞卡。」
//
// 實裝：
//   - Gate（regG）：場上（active+bench）必須**全部**有這 6 種寶可夢
//   - Effect（reg）：設 player-level flag `bagonElenaThisTurn = true`
//   - +3 獎賞 hook 在 engine.ts ATTACK KO 區塊（同白蕾雅 pattern）
//   - END_TURN 清旗標
const REQUIRED_N_NAMES = [
  'N的達摩狒狒',
  'N的索羅亞克ex',
  'N的雙倍多多冰',
  'N的齒輪怪',
  'N的萊希拉姆',
  'N的捷克羅姆',
];
regG('巴貝娜與荷蓮娜', (st, idx, pool) => {
  const p = st.players[idx];
  const onField = new Set(
    [...(p.active ? [p.active] : []), ...p.bench]
      .map(c => pool.get(c.cardId)?.name)
      .filter((n): n is string => !!n)
  );
  return REQUIRED_N_NAMES.every(n => onField.has(n));
});
reg('巴貝娜與荷蓮娜', (st, idx, _pool) => {
  st = addLog(st, '巴貝娜與荷蓮娜：本回合自己的「N 的」寶可夢招式 KO 對手戰鬥場時 +3 獎賞', idx);
  return updatePlayer(st, idx, p => ({ ...p, bagonElenaThisTurn: true }));
});

// 寶可夢中心的姐姐 — v5.728 移除此處重複死碼（生效版在 effects.ts:4327）。

// ── 馬志士的交易（Supporter / I）─ 對手互動 picker（v2.200 首次實裝） ─────────
// 卡面：詢問對手是否希望「雙方玩家各自獲得 1 張獎賞卡」。
//   - 若對手希望，雙方玩家各自獲得 1 張獎賞卡。
//   - 若不希望，自己（出卡方）從牌庫抽出 4 張卡。
//
// Option C 設計（Leon 在 v2.200 對話確認 online 模式優先）：
//   - actorIdx = oppIdx（對手做決定）
//   - online：對手畫面自動彈 modal-choice，出卡方畫面顯示「等待對手選擇中…」
//   - local（單機雙人）：modal 顯示給當前視角（active），等於「我幫對手選」— 接受
//     此 trade-off 換取流程不中斷（v2.198 對話確認）
//   - AI（對手是 AI）：AI loop 自動 dispatch RESOLVE_SELECTION，預設選 first option；
//     options 順序：先 'no'（拒絕）= 對 AI 自己有利的 default，再 'yes'（接受）。
//
// 為什麼 actorIdx ≠ idx 在現有 UI 已 work：
//   1. selection-modal 顯示守門（+page.svelte:2929）：online 限 actorIdx===myPlayerIndex；
//      local 跟視角；AI 限 actorIdx===human。已支援。
//   2. confirmSelection 帶 senderIdx=myPlayerIndex（+page.svelte:1781）— engine
//      RESOLVE_SELECTION 守門（engine.ts:1175）拒絕非 actor 的 sender，防搶 resolve。
//   3. AI tickAI shouldAct 看 pendingSelection.actorIdx===ai（+page.svelte:713）— 已正確。
//
// gate：簡單 — 對手獎賞 ≥ 1 才有意義（卡面允許 0 但無效果，懶得做精確 gate）。
// 實際 PTCG 規則沒寫禁止；資料層保險 gate = 出卡方獎賞 ≥ 1（避免雙方都已 prizes=0
// 的詭異 corner case，理論上不會發生因為先取完獎賞的人應已勝利）。
regG('馬志士的交易', () => true);
reg('馬志士的交易', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const oppName = st.players[oppIdx].name;
  const myName = st.players[idx].name;
  st = addLog(st, `馬志士的交易：${myName} 詢問 ${oppName} 是否「雙方各取 1 張獎賞卡」`, idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: oppIdx,                 // 對手做決定（Option C 核心）
    sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'masters-trade-decide',
    params: {
      // options 順序：先 no 後 yes
      // - online：人類對手會看 text 後選擇（順序不影響）
      // - AI 對手：AI 預設 first option = 'no'（不讓人類玩家輕易拿獎賞卡）
      options: [
        { id: 'no',  text: `❌ 拒絕（${myName} 從牌庫抽 4 張）` },
        { id: 'yes', text: '✅ 接受（雙方各取 1 張獎賞卡）' },
      ],
    },
  });
});
regR('masters-trade-decide', (st, oppIdx, iids, _params, pool) => {
  const choice = iids[0];
  const proposerIdx = (1 - oppIdx) as 0 | 1;
  const proposerName = st.players[proposerIdx].name;
  const oppName = st.players[oppIdx].name;
  if (choice === 'yes') {
    // v3.80 Rule 10：雙方各取 1 張獎賞 — 改用 addPendingPrize 讓兩位玩家都按「取得」
    st = addLog(st, `馬志士的交易：${oppName} 接受 — 雙方各待取 1 張獎賞卡`, oppIdx);
    if (st.players[proposerIdx].prizes.length > 0) {
      st = addPendingPrize(st, proposerIdx, 1, pool);
    }
    if (st.players[oppIdx].prizes.length > 0) {
      st = addPendingPrize(st, oppIdx, 1, pool);
    }
    // 勝負條件由 TAKE_PRIZES handler 在玩家點按鈕後檢查（既有機制）
    if (false) {
      return { ...st, phase: 'game-over' as const, winner: proposerIdx,
        winReason: `${proposerName} 取得所有獎賞卡` };
    }
    if (st.players[oppIdx].prizes.length === 0) {
      return { ...st, phase: 'game-over' as const, winner: oppIdx,
        winReason: `${oppName} 取得所有獎賞卡` };
    }
    return st;
  }
  // 拒絕 → 提案方抽 4 張
  st = addLog(st, `馬志士的交易：${oppName} 拒絕 — ${proposerName} 從牌庫抽 4 張`, oppIdx);
  return updatePlayer(st, proposerIdx, p => {
    const taken = p.deck.slice(0, 4);
    return { ...p, deck: p.deck.slice(taken.length), hand: [...p.hand, ...taken] };
  });
});

// ── 泰姆（Supporter / H）─ 對手猜 HP（v2.201 第 2 張對手互動 picker） ───────
// 卡面：從自己的手牌選 1 張寶可夢卡，向對手宣言名稱後翻反面放置。對手回答 HP。
//   - 若正確 → 對手抽 4 張
//   - 若不正確 → 自己抽 4 張
//   - 然後將放置的卡放回自己的手牌（即無真正消耗）。
//
// Step 1 — 出卡方（actor=自己）從手牌挑 1 張寶可夢卡：
//   pending type='hand-choose'（已存在於 types.ts:360 — 「從手牌選擇但不丟棄」）
//   filter='Pokemon'：UI 只 highlight 寶可夢卡可選
// Step 2 — 對手（actor=oppIdx）猜 HP：
//   pending type='modal-choice' + params.stepper（v2.201 新增）
//   stepper：min=30, max=340, step=10，init=100（中位數合理猜測，AI 拿 init = 不直接答對）
//   猜對與否由 resolver 比對 params.correctHP（從 step 1 picked card 抽出）。
//
// 為什麼 init=100 而非實際 HP：
//   - 真人對手：猜 HP 是策略性互動，預設值不應該洩漏答案
//   - AI 對手：v2.201 AI handler 拿 init 直接送 → AI 永遠猜 100，多數時候錯（出卡方抽 4）
//   - 對手贏錢：對手準確答對才能抽 4 — 這是卡牌「考你 PTCG 知識」的設計意圖
regG('泰姆', (st, idx, pool) => {
  // 手牌至少 1 張寶可夢卡才能用
  return st.players[idx].hand.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
});
reg('泰姆', (st, idx, pool) => {
  // hand-choose 的 validIids 只放手牌中的寶可夢 — UI 會把這些 iid highlight 為可選
  const pokeIids = st.players[idx].hand
    .filter(c => pool.get(c.cardId)?.supertype === 'Pokemon')
    .map(c => c.iid);
  st = addLog(st, '泰姆：選 1 張手牌寶可夢卡，讓對手猜 HP', idx);
  return withPending(st, {
    type: 'hand-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'tym-step1-pick-poke',
    params: {
      validIids: pokeIids,
      titleOverride: '泰姆：選 1 張寶可夢卡（讓對手猜 HP）',
    },
  });
});
regR('tym-step1-pick-poke', (st, idx, iids, _params, pool) => {
  const pickedIid = iids[0];
  if (!pickedIid) return st;
  const player = st.players[idx];
  const picked = player.hand.find(c => c.iid === pickedIid);
  if (!picked) return st;
  const card = pool.get(picked.cardId);
  if (!card || card.supertype !== 'Pokemon') {
    return addLog(st, '泰姆：選擇的不是寶可夢卡，效果失敗', idx);
  }
  const hp = card.hp ?? 0;
  if (hp <= 0) {
    return addLog(st, `泰姆：${card.name} 沒有有效 HP 資料，效果失敗`, idx);
  }
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, `泰姆：${player.name} 宣告「${card.name}」— 等待 ${st.players[oppIdx].name} 猜 HP`, idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: oppIdx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'tym-step2-guess-hp',
    params: {
      label: `泰姆：${player.name} 宣告了「${card.name}」— 請猜這隻寶可夢的 HP`,
      stepper: { min: 30, max: 340, step: 10, init: 100 },
      correctHP: hp,
      pickedCardName: card.name,
    },
  });
});
regR('tym-step2-guess-hp', (st, oppIdx, iids, params, _pool) => {
  const guess = parseInt(iids[0] ?? '0', 10);
  const correctHP = (params?.correctHP as number) ?? 0;
  const cardName = (params?.pickedCardName as string) ?? '?';
  const proposerIdx = (1 - oppIdx) as 0 | 1;
  const proposerName = st.players[proposerIdx].name;
  const oppName = st.players[oppIdx].name;
  const drawIdx: 0 | 1 = guess === correctHP ? oppIdx : proposerIdx;
  const drawName = st.players[drawIdx].name;
  if (guess === correctHP) {
    st = addLog(st,
      `泰姆：${oppName} 猜「${cardName}」HP=${guess} — 正確！${oppName} 從牌庫抽 4 張`,
      oppIdx);
  } else {
    st = addLog(st,
      `泰姆：${oppName} 猜「${cardName}」HP=${guess}（正確 ${correctHP}）— 不正確！${proposerName} 從牌庫抽 4 張`,
      oppIdx);
  }
  return updatePlayer(st, drawIdx, p => {
    const taken = p.deck.slice(0, 4);
    return { ...p, deck: p.deck.slice(taken.length), hand: [...p.hand, ...taken] };
  });
});

// ── 配樂之笛（Item / H）─ peek 對手牌庫頂 5 張，選任意數量基礎寶可夢放對手備戰 ─
// 卡面：將對手的牌庫上方 5 張卡翻到正面，從其中選擇任意數量的【基礎】寶可夢卡，
//   放置於對手的備戰區。將剩餘卡放回牌庫並重洗。
//
// v2.209 實裝設計：
//   - 出卡方（idx）看對手（1-idx）牌庫頂 5 張
//   - actor=idx, sourcePlayerIdx=oppIdx（看對手牌庫）
//   - filter='Basic:TOP5' — UI / AI 已加（v2.209 新增）
//   - minCount=0（沒基礎寶可夢時可選 0 張）
//   - resolver 把選中的放對手備戰（受備戰上限 getBenchLimit）
//   - 剩餘 top 5 全部洗回對手牌庫（包含未選中的基礎、未選中的進化、未選中的訓練家等）
//   - 整個牌庫重洗（fast path 與 resolver 都用 shuffle([...deck.slice(5), ...top5])，
//     重組完整 deck 後 shuffle，符合卡面「將剩餘卡放回牌庫並重洗」）
//
// gate：對手牌庫至少 1 張 + 對手備戰未滿（否則放不下）
regG('配樂之笛', (st, idx, pool) => {
  const oppIdx2 = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx2];
  // v5.040：原本 hardcode 5「保險用 5」實際違反 PTCG 規則 — 零之大空洞 + 對手有太晶
  //         寶可夢時對手備戰上限 8。改用 getBenchLimit 精確判定。
  return opp.deck.length > 0 && opp.bench.length < getOwnBenchLimit(st, oppIdx2, pool);
});
reg('配樂之笛', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  const top5 = opp.deck.slice(0, 5);
  const top5Iids = top5.map(c => c.iid);
  st = addLog(st, '配樂之笛：將對手牌庫上方 5 張翻到正面，選任意數量基礎寶可夢放對手備戰', idx);
  // v5.719：卡面「翻到正面」= 公開揭示，列出全部 5 張卡名（含非基礎/沒被選的），玩家才看得到「沒翻到的是哪些」。
  st = revealTopCardsLog(st, idx, top5, pool, '配樂之笛');
  // 算對手能放幾隻（受備戰上限）
  const limit = getOwnBenchLimit(st, oppIdx, pool);
  const space = Math.max(0, limit - opp.bench.length);
  const basicsInTop5 = top5.filter(c => isBasicPokemonCard(pool.get(c.cardId)));
  const placeableN = Math.min(space, basicsInTop5.length); // 實際可放幾隻基礎
  // v5.704：一律開 deck-search picker（比照米立龍集客 / 寶可裝置3.0），即使無基礎寶可夢
  //   (placeableN===0) 也讓玩家看完翻開的對手牌庫頂 5 張再確認（選 0）。原 maxN===0 早退會
  //   直接洗回 → 玩家看不到揭示資訊（翻對手牌庫是重要情報）。filter='Basic:TOP5' 限定只基礎可勾；
  //   maxCount 至少 1 確保 picker 開啟（無基礎時 0 可勾，玩家確認 0 → resolver 洗回）。
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    filter: 'Basic:TOP5',
    minCount: 0, maxCount: Math.max(1, placeableN),
    effectKey: 'melody-flute-place',
    params: {
      top5Iids,
      titleOverride: placeableN > 0
        ? `配樂之笛：${st.players[oppIdx].name} 牌庫頂 5 張中的基礎寶可夢（選 0–${placeableN} 隻放對手備戰）`
        : `配樂之笛：${st.players[oppIdx].name} 牌庫頂 5 張（無基礎寶可夢可放，看過後確認洗回）`,
    },
  });
});
regR('melody-flute-place', (st, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  const top5 = opp.deck.slice(0, 5);
  const chosenSet = new Set(iids);
  const chosen = top5.filter(c => chosenSet.has(c.iid));
  const rest = top5.filter(c => !chosenSet.has(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `配樂之笛：將 ${names} 放到 ${opp.name} 的備戰區`, idx);
  } else {
    st = addLog(st, '配樂之笛：未選擇任何寶可夢，全部洗回對手牌庫', idx);
  }
  return updatePlayer(st, oppIdx, p => ({
    ...p,
    bench: [...p.bench, ...chosen.map(c => ({ ...c, justPlaced: true }))],
    // 新 deck = 原 deck 去除 top 5 後 + 剩餘 top 5（rest）→ shuffle
    // chosen 已搬到 bench，rest 洗回 deck 剩餘卡的後段
    deck: shuffle([...p.deck.slice(top5.length), ...rest]),
  }));
});

// ── 壯偉碩木 resolver（Stadium / H, v2.211）── ─────────────────────────────
// USE_STADIUM 在 engine.ts 開 step1 pending（filter='SturdyMightTree:Stage1'）
// → 玩家從牌庫挑 1 張可進化的 Stage1 卡
// → resolver 找匹配 base、做 EVOLVE、洗牌庫，並開 step2 pending
// → step2 玩家從牌庫挑 1 張可進化此 Stage1 的 Stage2 卡（可選 0 = 跳過）
// → resolver 做 EVOLVE、洗牌庫
//
// gate 已在 engine 處理（先攻第 1 回合不能進化、justPlaced/evolvedThisTurn 排除）
// 兩段都 minCount:0（玩家可中途放棄）
// v3.813: 把 step1 進化邏輯抽出 helper（disambiguator 路徑共用）
function __sturdyDoEvolveStep1(
  st: import('../../types').GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
  base: CardInstance,
  evoInst: CardInstance,
  evoCard: Card,
): import('../../types').GameState {
  const p = st.players[idx];
  const baseCard = pool.get(base.cardId)!;
  const isActive = p.active?.iid === base.iid;
  const prevStack = base.evolvedFromStack ?? [];
  const baseBare: CardInstance = { ...base, energyAttached: [], toolAttached: undefined, evolvedFromStack: undefined };
  const evolved: CardInstance = buildEvolvedInstance(base, evoInst, st, pool);
  st = updatePlayer(st, idx, x => ({
    ...x,
    deck: x.deck.filter(c => c.iid !== evoInst.iid),
    active: isActive ? evolved : x.active,
    bench: isActive ? x.bench : x.bench.map(c => c.iid === base.iid ? evolved : c),
  }));
  st = addLog(st, `壯偉碩木：${baseCard.name} 進化為 ${evoCard.name}`, idx);
  const hasStage2 = st.players[idx].deck.length > 0;
  if (!hasStage2) {
    return updatePlayer(addLog(st, '壯偉碩木：牌庫為空', idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  return withPending(st, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: 1, filter: 'SturdyMightTree:Stage2',
    effectKey: 'sturdy-might-tree-step2',
    params: {
      stage1Iid: evolved.iid,
      stage1Name: evoCard.name,
    },
  });
}

regR('sturdy-might-tree-step1', (st, idx, iids, _params, pool) => {
  const p = st.players[idx];
  const pickedIid = iids[0];
  if (!pickedIid) {
    return updatePlayer(addLog(st, '壯偉碩木：未選擇 → 重洗牌庫', idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const evoInst = p.deck.find(c => c.iid === pickedIid);
  if (!evoInst) return st;
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard || !evoCard.evolvesFrom) {
    return addLog(st, '壯偉碩木：選擇無效（非進化卡）', idx);
  }
  // v3.813: 找場上所有 match base；0/1 沿用原流程，≥2 隻開 disambiguator picker
  const fieldPokemon: CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  const evolvesFromName = evoCard.evolvesFrom;
  const matchedBases = fieldPokemon.filter(fp => {
    if (fp.justPlaced || fp.evolvedThisTurn) return false;
    const fpCard = pool.get(fp.cardId);
    return !!(fpCard && sameEvoName(evolvesFromName, fpCard.name));
  });
  if (matchedBases.length === 0) {
    return addLog(st, '壯偉碩木：場上無對應的基礎寶可夢可進化', idx);
  }
  if (matchedBases.length >= 2) {
    return withPending(st, {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'sturdy-might-tree-pick-base',
      params: {
        includeActive: true,
        validIids: matchedBases.map(b => b.iid),
        evoIid: pickedIid,
        titleOverride: `壯偉碩木：選擇要使用 ${evoCard.name} 進化的基礎寶可夢`,
      },
    });
  }
  return __sturdyDoEvolveStep1(st, idx, pool, matchedBases[0], evoInst, evoCard);
});

// v3.813: 新 disambiguator resolver
regR('sturdy-might-tree-pick-base', (st, idx, iids, params, pool) => {
  const baseIid = iids[0];
  const evoIid = params?.evoIid as string | undefined;
  if (!baseIid || !evoIid) {
    return updatePlayer(addLog(st, '壯偉碩木：步驟異常 → 重洗牌庫', idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const p = st.players[idx];
  const base = p.active?.iid === baseIid ? p.active
             : (p.bench.find(c => c.iid === baseIid) ?? null);
  if (!base) {
    return updatePlayer(addLog(st, '壯偉碩木：找不到所選的基礎 → 重洗牌庫', idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const evoInst = p.deck.find(c => c.iid === evoIid);
  if (!evoInst) {
    return updatePlayer(addLog(st, '壯偉碩木：找不到所選的進化卡 → 重洗牌庫', idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard || !evoCard.evolvesFrom) {
    return updatePlayer(addLog(st, '壯偉碩木：進化卡資料異常 → 重洗牌庫', idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  return __sturdyDoEvolveStep1(st, idx, pool, base, evoInst, evoCard);
});

regR('sturdy-might-tree-step2', (st, idx, iids, params, pool) => {
  const p = st.players[idx];
  const stage1Iid = params?.stage1Iid as string | undefined;
  const stage1Name = (params?.stage1Name as string | undefined) ?? '?';
  const pickedIid = iids[0];
  if (!pickedIid) {
    return updatePlayer(addLog(st, `壯偉碩木：未選擇【2階】 → 重洗牌庫`, idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  if (!stage1Iid) {
    return addLog(st, '壯偉碩木：缺少 step1 進化目標，效果取消', idx);
  }
  const evoInst = p.deck.find(c => c.iid === pickedIid);
  if (!evoInst) {
    return updatePlayer(addLog(st, `壯偉碩木：找不到選的卡，重洗牌庫`, idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard || !evoCard.evolvesFrom || !sameEvoName(evoCard.evolvesFrom, stage1Name)) {
    return updatePlayer(addLog(st, `壯偉碩木：選擇的卡無法從 ${stage1Name} 進化`, idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  // 找場上 stage1Iid（可能在 active 或 bench）
  const stage1 = p.active?.iid === stage1Iid ? p.active
               : p.bench.find(c => c.iid === stage1Iid);
  if (!stage1) {
    return updatePlayer(addLog(st, `壯偉碩木：找不到 step1 進化的寶可夢`, idx),
      idx, x => ({ ...x, deck: shuffle(x.deck) }));
  }
  const isActive = p.active?.iid === stage1Iid;
  const prevStack = stage1.evolvedFromStack ?? [];
  const stage1Bare: CardInstance = { ...stage1, energyAttached: [], toolAttached: undefined, evolvedFromStack: undefined };
  const evolved: CardInstance = buildEvolvedInstance(stage1, evoInst, st, pool);
  st = updatePlayer(st, idx, x => ({
    ...x,
    deck: shuffle(x.deck.filter(c => c.iid !== pickedIid)),  // 完成所有進化後重洗
    active: isActive ? evolved : x.active,
    bench: isActive ? x.bench : x.bench.map(c => c.iid === stage1Iid ? evolved : c),
  }));
  return addLog(st, `壯偉碩木：${stage1Name} 進化為 ${evoCard.name}（重洗牌庫）`, idx);
});

// ── 火箭隊的妨礙機器人（Item / I, v2.212）───────────────────────────────────
// 卡面：選擇 1 張對手的反面朝上的獎賞卡，並在不看正面的情況下，從對手的手牌
//   選擇 1 張，查看各自的正面。若希望，令對手互換所選的卡。
//   （在對戰結束前，那張獎賞卡維持正面朝上。）
//
// 設計：
//   - 出卡方（idx）盲選 1 張對手獎賞 + 1 張對手手牌 — 因為都是反面，玩家無法
//     做有意義的位置選擇 → 引擎隨機抽 1 張獎賞 + 1 張手牌（pos 由 RNG 決定）。
//   - 翻面後，出卡方看到兩張卡的內容，由出卡方決定是否互換。
//   - 互換 → 把獎賞卡放到對手手牌、把選中手牌放回獎賞區（同 index 互換）。
//
// 為何不做「玩家點位置」UI：
//   - 卡面說「不看正面」→ 玩家點位置只是儀式感，沒有資訊優勢
//   - 隨機抽就符合「盲選」精神（位置等價）
// v5.879：卡面「在對戰結束前，那張獎賞卡維持正面朝上」已實作 — 選中的對手獎賞（互換時為換進
//   獎賞格的手牌）設 faceUp，維持到對戰結束、對雙方公開，該玩家取獎時可選要不要取那張已知卡
//   （沿用 v5.878 克雷色利亞｜弦月光芒的 faceUp 機制與 engine TAKE_PRIZES 取獎選擇）。
//
// gate：對手獎賞 ≥1 + 對手手牌 ≥1（任一空就完全沒效果）
regG('火箭隊的妨礙機器人', (st, idx) => {
  const opp = st.players[(1 - idx) as 0 | 1];
  return opp.prizes.length > 0 && opp.hand.length > 0;
});
reg('火箭隊的妨礙機器人', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = st.players[oppIdx];
  // 隨機抽 1 張獎賞（位置）+ 1 張手牌（位置）
  const prizeIndex = Math.floor(Math.random() * opp.prizes.length);
  const handIndex = Math.floor(Math.random() * opp.hand.length);
  const prizeInst = opp.prizes[prizeIndex];
  const handInst = opp.hand[handIndex];
  const prizeName = pool.get(prizeInst.cardId)?.name ?? '?';
  const handName = pool.get(handInst.cardId)?.name ?? '?';
  st = addLog(st, `火箭隊的妨礙機器人：盲選 ${opp.name} 的 1 張獎賞卡 + 1 張手牌`, idx);
  st = addLog(st, `→ 翻開：獎賞卡=「${prizeName}」、手牌=「${handName}」`, idx);
  // v5.879：卡面「在對戰結束前，那張獎賞卡維持正面朝上」— 將選中的對手獎賞設 faceUp（維持到
  //   對戰結束、對雙方公開、顯示於獎賞區）。若稍後互換，resolver 會把換進獎賞格的那張改設 faceUp。
  st = updatePlayer(st, oppIdx, p => ({
    ...p,
    prizes: p.prizes.map((c, i) => (i === prizeIndex ? { ...c, faceUp: true } : c)),
  }));
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'tr-disrupt-bot-swap-decide',
    params: {
      label: `火箭隊的妨礙機器人：${opp.name} 的獎賞卡=「${prizeName}」／手牌=「${handName}」 — 是否互換？`,
      prizeIid: prizeInst.iid,
      handIid: handInst.iid,
      prizeName,
      handName,
      options: [
        { id: 'no',  text: '❌ 不互換' },
        { id: 'yes', text: '✅ 互換（對手獎賞 ↔ 對手手牌）' },
      ],
    },
  });
});
regR('tr-disrupt-bot-swap-decide', (st, idx, iids, params, _pool) => {
  const choice = iids[0];
  const oppIdx = (1 - idx) as 0 | 1;
  const oppName = st.players[oppIdx].name;
  const prizeIid = params?.prizeIid as string | undefined;
  const handIid = params?.handIid as string | undefined;
  const prizeName = (params?.prizeName as string | undefined) ?? '?';
  const handName = (params?.handName as string | undefined) ?? '?';
  if (choice !== 'yes') {
    return addLog(st, `火箭隊的妨礙機器人：選擇不互換 ${oppName} 的獎賞卡與手牌`, idx);
  }
  if (!prizeIid || !handIid) {
    return addLog(st, '火箭隊的妨礙機器人：缺少互換目標 iid，效果取消', idx);
  }
  const opp = st.players[oppIdx];
  const prizeIndex = opp.prizes.findIndex(c => c.iid === prizeIid);
  const handIndex = opp.hand.findIndex(c => c.iid === handIid);
  if (prizeIndex < 0 || handIndex < 0) {
    return addLog(st, '火箭隊的妨礙機器人：互換目標已不存在，效果取消', idx);
  }
  const prizeInst = opp.prizes[prizeIndex];
  const handInst = opp.hand[handIndex];
  // 互換：手牌 → 獎賞區（同 index）、獎賞 → 手牌（append 到末端）。
  // v5.879：那個「獎賞格」維持正面朝上 → 換進去的手牌設 faceUp；換出去進手牌的原獎賞剝除 faceUp。
  st = updatePlayer(st, oppIdx, p => {
    const newPrizes = [...p.prizes];
    newPrizes[prizeIndex] = { ...handInst, faceUp: true };
    const newHand = p.hand.filter((_, i) => i !== handIndex);
    const { faceUp: _fu, ...prizeBare } = prizeInst;
    newHand.push(prizeBare);
    return { ...p, prizes: newPrizes, hand: newHand };
  });
  return addLog(st,
    `火箭隊的妨礙機器人：互換 ${oppName} 的獎賞卡「${prizeName}」與手牌「${handName}」（該獎賞格維持正面朝上）`, idx);
});

// ── 烈焰馬｜快走（特性 / I-mark: SV9a 12672, SV9a 12727, MC 16561）────────────────────
// 效果：「在自己的回合時可使用1次。從自己的牌庫抽出1張卡。」
// 條件：自己的回合、牌庫至少 1 張
regA('烈焰馬', 0, (st, idx) => {
  return drawCards(addLog(st, '快走：從牌庫抽出 1 張卡', idx), idx, 1);
});
