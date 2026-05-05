/**
 * 胡地 + 瑪俐的長毛巨魔ex 兩組預組卡效果
 *
 * v2.64 (Session ea58)：從 effects.ts Wave 44 (Session 38az, v2.21) 抽離。
 *
 * 胡地牌組：凱西 → 勇基拉 → 胡地（精神抽出特性 + 手之力量招式）、
 *   土龍節節（非 ex）/ 土龍節節ex、謝米。
 * 瑪俐牌組：瑪俐的搗蛋小妖 → 詐唬魔 → 瑪俐的長毛巨魔ex（龐克練肌 + 暗影子彈）。
 *
 * 註：
 *   - 精神抽出 / 龐克練肌 兩個特性都是「進化當回合才能用 1 次」
 *     → engine.ts getUsableAbilities 另加閘門（evolvedThisTurn && !abilityUsedThisTurn）。
 *   - 可達鴨｜濕氣 是被動特性（未實作混亂偏置），暫不註冊。
 *   - 雪妖女｜冰冷之帳（checkup hook）也暫不實裝。
 *
 * 匯入原則：
 *   - 登錄函式 / 登錄表 / 純 helper 從 _shared 拉；
 *   - 跨檔的高階 helper（selfSwapPost / skipDefEffectsPre / countOppPokemon /
 *     koPrizeCount）仍由 effects.ts export，本檔從 '../../effects' 反向 import。
 *     side-effect import 順序（effects.ts → effects/cards/*）保證這時 effects.ts
 *     已經把這些 helper assign 完畢，不會發生 undefined。
 */

import type { EnergyType } from '$lib/cards/types';
import type { CardInstance, PlayerState } from '../../types';
import {
  reg, regR, regG, regPre, regPost, regA,
  type AttackPostFn,
  shuffle, updatePlayer, addLog, drawCards, withPending,
  recordOppKO,
} from '../_shared';
import {
  selfSwapPost, skipDefEffectsPre, countOppPokemon, koPrizeCount,
} from '../../effects';
import { isBasicEnergyOfType } from '../../engine';

// ── 凱西｜瞬間移動攻擊 — 10，可選擇與備戰互換 ────────────────────────────────
regPre('凱西|瞬間移動攻擊', (state, _aIdx, _pool) => ({ state, damage: 10 }));
regPost('凱西|瞬間移動攻擊', selfSwapPost('瞬間移動攻擊'));

// ── 勇基拉｜精神抽出（特性）— 本回合由凱西進化後可用一次：抽 2 張 ─────────────
regA('勇基拉', 0, (st, idx) => {
  return drawCards(addLog(st, '精神抽出：抽 2 張', idx), idx, 2);
});

// ── 胡地｜精神抽出（特性）— 本回合由勇基拉進化後可用一次：抽 3 張 ─────────────
regA('胡地', 0, (st, idx) => {
  return drawCards(addLog(st, '精神抽出：抽 3 張', idx), idx, 3);
});

// ── 胡地｜手之力量 — 將手牌張數 × 2 個傷害指示物放到對手戰鬥寶可夢（招式效果）─
// 原文：將與自己的手牌的張數×2個的相同數量的傷害指示物，放置於對手的戰鬥寶可夢身上。
// 判斷：「放置傷害指示物」屬於招式效果（非招式傷害），因此 bypass 弱點 / 抗性 /
//      防禦道具（龐克頭盔等）/ 鐵頭盔道具 / 以及各種「受到傷害 -N」的減傷效果。
// 實作：regPre 回傳 damage: 0（不觸發一般戰鬥傷害流程），實際放傷邏輯在 regPost，
//      直接對 defender.active.damage 加值，手動做 KO / 獎賞 / gameover 判定。
regPre('胡地|手之力量', (_state, _aIdx, _pool) => ({ state: _state, damage: 0 }));
regPost('胡地|手之力量', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (!defender.active) return state;
  const handCount = state.players[aIdx].hand.length;
  const counters = handCount * 2;
  const addDmg = counters * 10;
  const defCard = pool.get(defender.active.cardId);
  const newDmg = defender.active.damage + addDmg;
  const defHP = defCard?.hp ?? 0;
  let s = addLog(
    state,
    `手之力量：手牌 ${handCount} 張 → 放置 ${counters} 個傷害指示物於 ${defCard?.name ?? '?'}（共 ${addDmg} 傷害，不計算弱點 / 抗性 / 防禦效果）`,
    aIdx
  );
  if (defHP > 0 && newDmg >= defHP) {
    // KO 流程：出場寶可夢、附加能量、道具、進化底卡全部進棄牌堆
    const koDiscard: CardInstance[] = [
      { ...defender.active, damage: newDmg },
      ...defender.active.energyAttached,
      ...(defender.active.toolAttached ? [defender.active.toolAttached] : []),
      ...(defender.active.evolvedFromStack ?? []),
    ];
    const prizes = defCard ? koPrizeCount(defCard) : 1;
    const players = [...s.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...defender, active: null, discard: [...defender.discard, ...koDiscard] };
    s = addLog(
      { ...s, players },
      `手之力量：${defCard?.name ?? '?'} 被擊倒！+${prizes} 張獎勵牌`,
      aIdx
    );
    s = { ...s, pendingPrizes: (s.pendingPrizes ?? 0) + prizes };
    // v2.246：手之力量是招式 KO
    s = recordOppKO(s, dIdx, defCard, 'attack');
    if (players[dIdx].bench.length === 0) {
      return { ...s, phase: 'game-over', winner: aIdx,
        winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
    return s;
  }
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...defender, active: { ...defender.active, damage: newDmg } };
  return { ...s, players };
});

// ── 土龍弟弟｜交替 — 0 傷害，與備戰互換 ────────────────────────────────────
regPre('土龍弟弟|交替', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('土龍弟弟|交替', selfSwapPost('交替'));

// ── 土龍節節ex｜逆境之尾 — 對手場上每隻寶可夢ex × 60 ────────────────────────
regPre('土龍節節ex|逆境之尾', (state, aIdx, pool) => {
  const n = countOppPokemon(state, aIdx, pool, c =>
    c.supertype === 'Pokemon' && (c.subtype === 'ex' || c.name.endsWith('ex') || c.name.endsWith('EX'))
  );
  return {
    state: addLog(state, `逆境之尾：對手寶可夢ex ${n} 隻 → ${n * 60} 傷害`, aIdx),
    damage: n * 60,
  };
});

// ── 土龍節節ex｜鑽破壞 — 150，不計算對手戰鬥寶可夢身上的附加效果 ─────────────
regPre('土龍節節ex|鑽破壞', skipDefEffectsPre(150, '鑽破壞'));

// ── 土龍節節（非 ex）｜逃跑抽出 — 抽 3 + 自身（含附加 + 前階）回牌庫並重洗 ──
// v2.37：非 ex 版土龍節節特性。一回合一次（引擎 abilityUsedThisTurn gate）：
//   1. 從自己的牌庫抽 3 張；
//   2. 將「這隻土龍節節」與其附加的能量、道具、以及前一階土龍弟弟（含其附加
//      能量/道具，若有）全部放回牌庫並重洗。
// v2.61：engine 以第 4 參數 cardInst 傳入觸發源（以 iid 定位），避免同回合
//   兩隻同名土龍節節先後發動時誤中第一隻。保留 name 掃場作為 fallback。
// active 被清空時由 hasPendingActions 觸發 SEND_NEW_ACTIVE，與撤退後 flow 相同。
regA('土龍節節', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const allPokes: CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  const src = cardInst
    ? allPokes.find(c => c.iid === cardInst.iid)
    : allPokes.find(c => {
        const card = pool.get(c.cardId);
        return card?.name === '土龍節節' && c.abilityUsedThisTurn === true;
      });
  if (!src) return st;
  const isActive = p.active?.iid === src.iid;

  // 步驟 1：抽 3
  st = addLog(st, '逃跑抽出：從牌庫抽 3 張', idx);
  st = drawCards(st, idx, 3);

  // 步驟 2：組出要回牌庫的卡 — 本體（重設狀態）+ 能量 + 道具 + 前階堆疊
  const returning: CardInstance[] = [
    { ...src, damage: 0, energyAttached: [], toolAttached: undefined,
      status: undefined, evolvedFromStack: undefined,
      evolvedThisTurn: undefined, justPlaced: undefined, playedFromHand: undefined, movedToActiveThisTurn: undefined,
      damageBonusThisTurn: undefined, damageReduceNextHit: undefined,
      abilityUsedThisTurn: undefined, cantAttackThisTurn: undefined, cantAttackPending: undefined,
      cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
      damageBonusPending: undefined },
    ...src.energyAttached,
    ...(src.toolAttached ? [src.toolAttached] : []),
    ...(src.evolvedFromStack ?? []),
  ];
  st = addLog(st, '逃跑抽出：土龍節節（含附加 + 前階）放回牌庫並重洗', idx);
  return updatePlayer(st, idx, pl => ({
    ...pl,
    active: isActive ? null : pl.active,
    bench: isActive ? pl.bench : pl.bench.filter(c => c.iid !== src.iid),
    deck: shuffle([...pl.deck, ...returning]),
  }));
});

// ── 謝米｜親送花朵 — 從牌庫選 1 張基本【草】能量附於我方 1 隻備戰寶可夢 ────────
function deckEnergyAttachBenchPost(typeFilter: EnergyType | null, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const p = state.players[aIdx];
    if (p.bench.length === 0) return addLog(state, `${label}：備戰區沒有寶可夢`, aIdx);
    const cand = p.deck.filter(c => {
      const card = pool.get(c.cardId);
      if (!card || card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
      if (typeFilter && card.pokemonType !== typeFilter) return false;
      return true;
    });
    if (cand.length === 0) return addLog(state, `${label}：牌庫沒有符合的基本能量`, aIdx);
    const filterStr = typeFilter ? `Energy:${typeFilter}` : 'BasicEnergy';
    const s = addLog(state, `${label}：從牌庫選 1 張基本能量附於備戰`, aIdx);
    return withPending(s, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr, minCount: 1, maxCount: 1,
      effectKey: 'deck-energy-attach-bench-pick-energy',
      params: { label, validIids: cand.map(c => c.iid) },
    });
  };
}
regR('deck-energy-attach-bench-pick-energy', (st, idx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '附能到備戰';
  const p = st.players[idx];
  if (p.bench.length === 0) return st;
  if (p.bench.length === 1) {
    return applyDeckAttachBench(st, idx, iids, p.bench[0].iid, label);
  }
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'deck-energy-attach-bench-commit',
    params: { energyIids: iids, label },
  });
});
regR('deck-energy-attach-bench-commit', (st, idx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '附能到備戰';
  const energyIids = (params?.energyIids as string[]) ?? [];
  return applyDeckAttachBench(st, idx, energyIids, iids[0], label);
});
function applyDeckAttachBench(
  st: import('../../types').GameState, idx: 0 | 1, energyIids: string[], targetIid: string, label: string
): import('../../types').GameState {
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const energies = p.deck.filter(c => energyIids.includes(c.iid));
  if (energies.length === 0) return st;
  const s = addLog(st, `${label}：將 ${energies.length} 張能量附加到備戰（重洗牌庫）`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    deck: shuffle(pl.deck.filter(c => !energyIids.includes(c.iid))),
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
}
regPre('謝米|親送花朵', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('謝米|親送花朵', deckEnergyAttachBenchPost('Grass', '親送花朵'));

// ── 瑪俐的搗蛋小妖｜偷盜 — 0 傷害，抽 1 張 ──────────────────────────────
regPre('瑪俐的搗蛋小妖|偷盜', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('瑪俐的搗蛋小妖|偷盜', (state, aIdx, _pool) => {
  return drawCards(addLog(state, '偷盜：抽 1 張', aIdx), aIdx, 1);
});

// ── 瑪俐的長毛巨魔ex｜龐克練肌（特性）─ 進化當回合可用 1 次
//    從牌庫選最多 5 張基本【惡】能量，以任意方式附於自己的「瑪俐的」寶可夢身上（重洗牌庫）
regA('瑪俐的長毛巨魔ex', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const allPokes = [...(p.active ? [p.active] : []), ...p.bench];
  const src = cardInst ? allPokes.find(c => c.iid === cardInst.iid) : p.active;
  if (!src) return addLog(st, '龐克練肌：找不到該寶可夢', idx);

  const cand = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    return isBasicEnergyOfType(card, 'Darkness');
  });
  // v2.323：即使沒有惡能量也要讓玩家執行搜尋（可檢視牌庫 + 重洗）— PTCG 隱藏資訊規則
  const maxN = Math.min(5, cand.length);
  // 找場上所有「瑪俐的」寶可夢
  const mariPokes = allPokes.filter(c => pool.get(c.cardId)?.name?.startsWith('瑪俐的'));
  if (mariPokes.length === 0) return addLog(st, '龐克練肌：場上沒有「瑪俐的」寶可夢', idx);
  if (maxN === 0) {
    // 無惡能量 — 仍展示牌庫搜尋 UI（minCount=0, maxCount=0 → 玩家只能按確認 → 重洗）
    const s = addLog(st, '龐克練肌：搜尋牌庫（重洗牌庫）', idx);
    return withPending(s, {
      type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
      filter: 'Energy:Darkness', minCount: 0, maxCount: 0,
      effectKey: 'punk-training-attach',
      params: { label: '龐克練肌', validIids: [] },
    });
  }
  const s = addLog(st, `龐克練肌：從牌庫選最多 ${maxN} 張基本【惡】能量，以任意方式附於自己的「瑪俐的」寶可夢身上`, idx);
  return withPending(s, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Darkness', minCount: 0, maxCount: maxN,
    effectKey: 'punk-training-attach',
    params: { label: '龐克練肌', validIids: cand.map(c => c.iid) },
  });
});
regR('punk-training-attach', (st, idx, iids, params, pool) => {
  const label = ((params?.label as string | undefined) ?? '龐克練肌');
  const p = st.players[idx];

  const picked = p.deck.filter(c => iids.includes(c.iid));
  // 無論是否選了能量，先重洗牌庫，並將選取的能量暫存 discard（分配時再移入寶可夢）
  let s = updatePlayer(st, idx, pl => ({
    ...pl,
    deck: shuffle(pl.deck.filter(c => !iids.includes(c.iid))),
    discard: [...pl.discard, ...picked],
  }));
  if (picked.length === 0) return addLog(s, `${label}：未選擇能量（重洗牌庫）`, idx);

  // 找場上所有「瑪俐的」寶可夢 iids 作為可附加目標
  const allPokes = [...(s.players[idx].active ? [s.players[idx].active] : []), ...s.players[idx].bench];
  const mariPokes = allPokes.filter(c => pool.get(c.cardId)?.name?.startsWith('瑪俐的'));
  if (mariPokes.length === 0) {
    return addLog(s, `${label}：場上無「瑪俐的」寶可夢，能量留在棄牌區`, idx);
  }

  // 只有 1 隻瑪俐的寶可夢 → 全部直接附上
  if (mariPokes.length === 1) {
    const targetIid = mariPokes[0].iid;
    const tName = pool.get(mariPokes[0].cardId)?.name ?? '?';
    s = addLog(s, `${label}：將 ${picked.length} 張【惡】能量全部附於 ${tName}（重洗牌庫）`, idx);
    return updatePlayer(s, idx, pl => {
      const energyCards = pl.discard.filter(c => iids.includes(c.iid));
      const rest = pl.discard.filter(c => !iids.includes(c.iid));
      if (pl.active?.iid === targetIid) {
        return { ...pl, discard: rest, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energyCards] } };
      }
      return { ...pl, discard: rest, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, energyAttached: [...c.energyAttached, ...energyCards] } : c) };
    });
  }

  // 多隻瑪俐的寶可夢 → 逐張選附加目標
  s = addLog(s, `${label}：請選擇每張【惡】能量的附加目標（重洗牌庫完成）`, idx);
  return withPending(s, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'punk-training-distribute',
    params: {
      label,
      energyIids: picked.map(c => c.iid),
      validIids: mariPokes.map(c => c.iid),
      totalCount: picked.length, placedCount: 0,
    },
  });
});
regR('punk-training-distribute', (st, idx, iids, params, pool) => {
  const label = ((params?.label as string | undefined) ?? '龐克練肌');
  const energyIids = ((params?.energyIids as string[] | undefined) ?? []);
  const totalCount = ((params?.totalCount as number | undefined) ?? energyIids.length);
  const placedCount = ((params?.placedCount as number | undefined) ?? 0);
  if (energyIids.length === 0) return st;

  const currentEnergyIid = energyIids[0];
  const restIids = energyIids.slice(1);
  const targetIid = iids[0];
  const p = st.players[idx];

  // 能量暫存在 discard 中（punk-training-attach 導入）
  const energy = p.discard.find(c => c.iid === currentEnergyIid);
  if (!energy) {
    if (restIids.length === 0) return st;
    const ap2 = [...(st.players[idx].active ? [st.players[idx].active] : []), ...st.players[idx].bench];
    const mn2 = ap2.filter(c => pool.get(c.cardId)?.name?.startsWith('瑪俐的'));
    return withPending(st, {
      type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1, effectKey: 'punk-training-distribute',
      params: { label, energyIids: restIids, validIids: mn2.map(c => c.iid), totalCount, placedCount: placedCount + 1 },
    });
  }

  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  const tCard = target ? pool.get(target.cardId) : null;
  if (!target || !tCard?.name?.startsWith('瑪俐的')) {
    return addLog(st, `${label}：目標不是「瑪俐的」寶可夢，取消附加`, idx);
  }

  const tName = tCard.name;
  let s = addLog(st, `${label}：第 ${placedCount + 1}/${totalCount} 張【惡】能量附於 ${tName}`, idx);
  s = updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => c.iid !== currentEnergyIid);
    if (pl.active?.iid === targetIid) {
      return { ...pl, discard: rest, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, energy] } };
    }
    return { ...pl, discard: rest, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, energyAttached: [...c.energyAttached, energy] } : c) };
  });

  if (restIids.length === 0) return s;

  const ap = [...(s.players[idx].active ? [s.players[idx].active] : []), ...s.players[idx].bench];
  const mn = ap.filter(c => pool.get(c.cardId)?.name?.startsWith('瑪俐的'));
  if (mn.length === 0) return addLog(s, `${label}：場上已無「瑪俐的」寶可夢，剩餘能量留在棄牌區`, idx);
  return withPending(s, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1, effectKey: 'punk-training-distribute',
    params: {
      label, energyIids: restIids,
      validIids: mn.map(c => c.iid),
      totalCount, placedCount: placedCount + 1,
    },
  });
});

// ── 瑪俐的長毛巨魔ex｜暗影子彈 — 180，另對對手 1 隻備戰寶可夢造成 30 傷害 ──────
regPre('瑪俐的長毛巨魔ex|暗影子彈', (state, _aIdx, _pool) => ({ state, damage: 180 }));
regPost('瑪俐的長毛巨魔ex|暗影子彈', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) {
    return addLog(state, '暗影子彈：對手無備戰寶可夢', aIdx);
  }
  const s = addLog(state, '暗影子彈：選 1 隻對手備戰寶可夢造成 30 傷害', aIdx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-variable',
    params: { damage: 30, label: '暗影子彈' },
  });
});

// 改造之錘（Item）在 v2.22 新增區塊，仍留在 effects.ts（不屬於這兩組預組卡）
