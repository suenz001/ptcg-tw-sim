/**
 * J 標 v2.355 批次實裝 — P2/P3 卡牌效果
 *
 * 群組 A  代歐奇希斯  — 精神強念（80+20×opp energy）
 * 群組 B  哲爾尼亞斯  — 大地之門（deck搜超系基礎→備戰）、光明角擊（120+自鎖）
 * 群組 C  冰雪巨龍    — 冰冷寒氣（150+對手下回封招）
 *                       凍原堡壘 field-passive 在 engine.ts 實裝
 * 群組 D  雷吉艾斯ex  — 冰之牢籠補丁（加 regPre 自棄 2 能量；statusPost 已在 effects.ts）
 * 群組 E  具甲武者    — 潛力（150+自身下回封招）
 * 群組 F  鑰圈兒      — 記憶之鎖（30+modal-choice 鎖對手 1 招，如無理取鬧）
 * 群組 G  怪顎龍      — 亂暴（160+擲幣到反面，mill對手牌庫頂N張）
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import {
  addLog,
  regPost,
  regPre,
  regR,
  updatePlayer,
  withPending,
  countAttachedEnergyAsUnits,
} from '../_shared';

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/** 取 CardInstance 的卡片名稱 */
function cardName(pool: Map<string, any>, inst?: CardInstance | null): string {
  return inst ? (pool.get(inst.cardId)?.name ?? '?') : '?';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 A：代歐奇希斯｜精神強念
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 代歐奇希斯｜精神強念：80 + 對手戰鬥寶可夢身上附加的能量數量×20
// 卡面：「80+ 增加對手的戰鬥寶可夢身上附加的能量的數量×20點傷害。」
// 注意：蟲甲聖/勇基拉/胡地 有各自的精神強念（不同公式），本條目只針對代歐奇希斯。
// v4.959：用 countAttachedEnergyAsUnits — 認新衝天能量 on Stage2 = 2 個。
regPre('代歐奇希斯|精神強念', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defActive = state.players[dIdx].active;
  const count = defActive ? countAttachedEnergyAsUnits(defActive, pool) : 0;
  const dmg = 80 + count * 20;
  return {
    state: addLog(state, `精神強念：對手戰鬥位附加 ${count} 個能量 → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 B：哲爾尼亞斯
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 哲爾尼亞斯｜大地之門：0傷，從牌庫選最多3張【超】基礎寶可夢放備戰，重洗牌庫
// 卡面：「從自己的牌庫選擇最多3張【超】屬性的【基礎】寶可夢卡，放置於備戰區。並且重洗牌庫。」
// 實裝：deck-search（filter:Pokemon + validIids過濾超基礎）→ bench-basic-from-deck resolver
regPre('哲爾尼亞斯|大地之門', (state) => ({ state, damage: 0 }));
regPost('哲爾尼亞斯|大地之門', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const slots = 5 - p.bench.length;
  if (slots <= 0) return addLog(state, '大地之門：備戰區已滿（5隻）', aIdx);

  // 從牌庫過濾出【超】屬性的基礎寶可夢
  const cand = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    return (
      card?.supertype === 'Pokemon' &&
      card.stage === 'Basic' &&
      card.pokemonType === 'Psychic'
    );
  });
  // v3.853: 即使 cand=0 也仍開 picker — 讓玩家查看牌庫剩餘卡（Iron Rule 14）

  const realMax = Math.min(3, slots, cand.length);
  const s = addLog(state, `大地之門：從牌庫選最多 ${realMax} 張【超】基礎寶可夢放備戰`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Pokemon',    // UI 過濾為寶可夢
    minCount: 0,
    maxCount: realMax,
    effectKey: 'bench-basic-from-deck',   // 已存在的 resolver（pokemon_search.ts）
    params: {
      label: '大地之門',
      validIids: cand.map(c => c.iid),   // 限制只能選這些超基礎
    },
  });
});

// 哲爾尼亞斯｜光明角擊：120，下回合此寶可夢無法使用「光明角擊」
// 卡面：「120 在下個自己的回合，這隻寶可夢無法使用「光明角擊」。」
// 實裝：regPost 設 blockedAttackNamesNextTurn: ['光明角擊'] 於自身（promoteSelfNextToThis 升級）
regPre('哲爾尼亞斯|光明角擊', (state) => ({ state, damage: 120 }));
regPost('哲爾尼亞斯|光明角擊', (state, aIdx, pool) => {
  return updatePlayer(
    addLog(state, '光明角擊：下回合此寶可夢無法使用「光明角擊」', aIdx),
    aIdx,
    p => {
      if (!p.active) return p;
      const cur = p.active.blockedAttackNamesNextTurn ?? [];
      return {
        ...p,
        active: {
          ...p.active,
          blockedAttackNamesNextTurn: [...cur, '光明角擊'],
        },
      };
    },
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 C：冰雪巨龍｜冰冷寒氣
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 冰雪巨龍｜冰冷寒氣：150，下個對手回合，受到此招式的寶可夢無法使用招式
// 卡面：「150 在下個對手的回合，受到這個招式的寶可夢無法使用招式。」
// 實裝：regPost 設 cantAttackPending: true 於對手戰鬥位
// ※ 凍原堡壘（field-passive -50 for own water pokemon）實裝於 engine.ts
regPre('冰雪巨龍|冰冷寒氣', (state) => ({ state, damage: 150 }));
regPost('冰雪巨龍|冰冷寒氣', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active) return state;
  const defName = cardName(pool, def.active);
  return updatePlayer(
    addLog(state, `冰冷寒氣：${defName} 下個對手回合無法使用招式`, aIdx),
    dIdx,
    p => p.active ? { ...p, active: { ...p.active, cantAttackPending: true } } : p,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 D：雷吉艾斯ex｜冰之牢籠（補丁）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 雷吉艾斯ex｜冰之牢籠：140，丟棄自身 2 個能量，麻痺對手戰鬥位寶可夢
// 卡面：「140 將2個這隻寶可夢身上附加的能量丟棄，將對手的戰鬥寶可夢【麻痺】。」
// 補丁說明：effects.ts 已有 regPost 設麻痺，此處補上 regPre 自棄 2 個附加能量。
//   能量丟棄為攻擊成本（PRE），必定執行（非可選）。
//   若附加能量 < 2，有多少丟多少（容錯處理）。
regPre('雷吉艾斯ex|冰之牢籠', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (!p.active) return { state, damage: 140 };

  const all = p.active.energyAttached;
  // 丟棄前 2 個（若不足 2 則全棄）
  const discardCount = Math.min(2, all.length);
  const toDiscard = all.slice(0, discardCount);
  const remaining = all.slice(discardCount);

  const s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    active: pl.active
      ? { ...pl.active, energyAttached: remaining }
      : pl.active,
    discard: [...pl.discard, ...toDiscard],
  }));

  return {
    state: addLog(s, `冰之牢籠：丟棄自身 ${discardCount} 個能量`, aIdx),
    damage: 140,
  };
});
// ※ regPost（麻痺）已在 effects.ts 實裝：
//   regPost('雷吉艾斯ex|冰之牢籠', statusPost('paralyzed'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 E：具甲武者｜潛力
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 具甲武者｜潛力：150，下個自己的回合此寶可夢無法使用招式
// 卡面：「150 在下個自己的回合，這隻寶可夢無法使用招式。」
// 實裝：regPost 設 cantAttackPending: true 於自身（同 莉佳的口呆花|葉子旋風）
//   cantAttackPending 於 OPP END_TURN → promote 為 cantAttackThisTurn → 自己下回合封招
regPre('具甲武者|潛力', (state) => ({ state, damage: 150 }));
regPost('具甲武者|潛力', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '潛力：下個自己的回合此寶可夢無法使用招式', aIdx),
    aIdx,
    p => p.active ? { ...p, active: { ...p.active, cantAttackPending: true } } : p,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 F：鑰圈兒｜記憶之鎖
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 鑰圈兒｜記憶之鎖：30，選擇對手 1 個招式，下回合對手無法使用
// 卡面：「30 選擇1個對手的戰鬥寶可夢持有的招式。在下個對手的回合，
//        受到這個招式的寶可夢無法使用被選擇的招式。」
// 實裝：同 火箭隊的黑暗鴉｜無理取鬧 pattern（blockedAttackNamesNextTurn on 對手 active）
//   - 1 招：fast path 直接鎖
//   - 多招：modal-choice 讓玩家選
regPre('鑰圈兒|記憶之鎖', (state) => ({ state, damage: 30 }));
regPost('鑰圈兒|記憶之鎖', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active) return state;

  const defCard = pool.get(def.active.cardId);
  const attacks = defCard?.attacks ?? [];
  if (attacks.length === 0) return state;

  // 只有 1 招：fast path（無需 modal）
  if (attacks.length === 1) {
    const lockedName = attacks[0].name;
    const players = [...state.players] as [PlayerState, PlayerState];
    const cur = def.active.blockedAttackNamesNextTurn ?? [];
    players[dIdx] = {
      ...def,
      active: {
        ...def.active,
        blockedAttackNamesNextTurn: [...cur, lockedName],
      },
    };
    return addLog(
      { ...state, players },
      `記憶之鎖：${defCard?.name ?? '?'} 下回合無法使用「${lockedName}」`,
      aIdx,
    );
  }

  // 多招：開 modal-choice 讓玩家選
  const s = addLog(
    state,
    `記憶之鎖：選擇 1 個對手 ${defCard?.name ?? '?'} 持有的招式鎖住`,
    aIdx,
  );
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'j-2355-memory-lock',
    params: {
      label: '記憶之鎖',
      options: attacks.map((a: any, i: number) => ({
        id: `${i}`,
        text: `${i + 1}. ${a.name}`,
      })),
      defenderName: defCard?.name ?? '?',
      attackNames: attacks.map((a: any) => a.name),
    },
  });
});

// resolver：玩家選完後鎖招
regR('j-2355-memory-lock', (st, aIdx, iids, params, _pool) => {
  const choiceIdx = parseInt(iids[0] ?? '0', 10);
  const attackNames = (params?.attackNames as string[] | undefined) ?? [];
  const lockedName = attackNames[choiceIdx];
  const defenderName = (params?.defenderName as string | undefined) ?? '?';
  if (!lockedName) return st;

  const dIdx = (1 - aIdx) as 0 | 1;
  const def = st.players[dIdx];
  // 對手可能已換戰鬥位 → 放棄鎖招
  if (!def.active) {
    return addLog(st, '記憶之鎖：對手戰鬥位已變動，鎖招失效', aIdx);
  }

  const players = [...st.players] as [PlayerState, PlayerState];
  const cur = def.active.blockedAttackNamesNextTurn ?? [];
  players[dIdx] = {
    ...def,
    active: {
      ...def.active,
      blockedAttackNamesNextTurn: [...cur, lockedName],
    },
  };
  return addLog(
    { ...st, players },
    `記憶之鎖：${defenderName} 下回合無法使用「${lockedName}」`,
    aIdx,
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 G：怪顎龍｜亂暴
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 怪顎龍｜亂暴：160，擲硬幣直到出現反面，丟棄對手牌庫頂「正面次數」張卡
// 卡面：「160 擲硬幣直到出現反面，將對手的牌庫上方與正面出現的次數相同數量的卡丟棄。」
// 實裝：regPost 模擬擲幣迴圈（Math.random < 0.5 = 正面），mill 對手牌庫頂 N 張
// ※ 不需 regPre（引擎自動讀卡面 damage 160）
regPost('怪顎龍|亂暴', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;

  // 擲幣到反面，累計正面次數
  let heads = 0;
  while (Math.random() < 0.5) heads++;

  if (heads === 0) {
    return addLog(state, '亂暴：第 1 次擲幣就反面 → 不丟棄對手牌庫', aIdx);
  }

  const opp = state.players[dIdx];
  const millCount = Math.min(heads, opp.deck.length);
  if (millCount === 0) {
    return addLog(state, `亂暴：正面 ${heads} 次，但對手牌庫已空`, aIdx);
  }

  const toDiscard = opp.deck.slice(0, millCount);
  const s = updatePlayer(state, dIdx, p => ({
    ...p,
    deck: p.deck.slice(millCount),
    discard: [...p.discard, ...toDiscard],
  }));
  return addLog(
    s,
    `亂暴：擲幣 ${heads} 次正面 → 丟棄對手牌庫頂 ${millCount} 張`,
    aIdx,
  );
});
