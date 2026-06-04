/**
 * v2.63 I 標 Wave 13 — 雜項第六批（35 張）
 */

import type { CardInstance, PlayerState } from '../../types';
import { regPre, regPost, regR, addLog, updatePlayer, withPending, shuffle, ATTACK_PRE_DISCARD_CHOICE,
  getOwnBenchLimit,
} from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import { flipCoinsWithLog, dealAttackDamageToTarget } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════════════════════════
function selfHealPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    if (!a) return state;
    const before = a.damage ?? 0;
    if (before === 0) return addLog(state, `${label}：自身無傷害可回復`, aIdx);
    const after = Math.max(0, before - amount);
    return updatePlayer(
      addLog(state, `${label}：自身回復 ${before - after} HP`, aIdx),
      aIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damage: after } : null,
      }),
    );
  };
}

// 從牌庫挑 1 張指定屬性基本能量附自方寶可夢
function deckSearchBasicEnergyAttachOnePost(
  type: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
  label: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    const energyIid = player.deck.find(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Energy' && card.subtype === 'Basic'
        && card.pokemonType === type;
    })?.iid;
    if (!energyIid) {
      return updatePlayer(
        addLog(state, `${label}：牌庫中無對應基本能量；重洗`, aIdx),
        aIdx, p => ({ ...p, deck: shuffle(p.deck) }),
      );
    }
    const s = addLog(state, `${label}：從牌庫挑 1 張基本能量附給自方寶可夢（重洗）`, aIdx);
    return withPending(s, {
      type: 'heal-target',  // 用 heal-target 讓玩家挑要附給誰
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'wave13-deck-energy-attach',
      params: { energyIid, label },
    });
  };
}

regR('wave13-deck-energy-attach', (state, aIdx, iids, params, pool) => {
  if (iids.length === 0) return state;
  const energyIid = params?.energyIid as string | undefined;
  const label = (params?.label as string | undefined) ?? '神樂';
  if (!energyIid) return state;
  const targetIid = iids[0];
  return updatePlayer(
    addLog(state, `${label}：將能量附給選定的寶可夢；重洗牌庫`, aIdx),
    aIdx, p => {
      const energy = p.deck.find(c => c.iid === energyIid);
      if (!energy) return p;
      const newDeck = shuffle(p.deck.filter(c => c.iid !== energyIid));
      const newActive = p.active && p.active.iid === targetIid
        ? { ...p.active, energyAttached: [...p.active.energyAttached, energy] }
        : p.active;
      const newBench = p.bench.map(b => b.iid === targetIid
        ? { ...b, energyAttached: [...b.energyAttached, energy] }
        : b);
      return { ...p, deck: newDeck, active: newActive, bench: newBench };
    },
  );
});

// 從牌庫挑 ≤N 寶可夢加手（filter）
function deckSearchPokemonToHandPost(
  filterStr: string, max: number, effectKeyName: string, label: string,
): AttackPostFn {
  return (state, aIdx, _pool) => {
    const player = state.players[aIdx];
    if (player.deck.length === 0) return addLog(state, `${label}：牌庫已空`, aIdx);
    const s = addLog(state, `${label}：從牌庫挑 0~${max} 張卡加手牌（重洗）`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr,
      minCount: 0, maxCount: max,
      effectKey: effectKeyName,
    });
  };
}

regR('wave13-deck-take-any', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return updatePlayer(addLog(state, '搜尋未選擇；重洗', aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  return updatePlayer(
    addLog(state, `從牌庫挑 ${iids.length} 張卡加手牌；重洗`, aIdx),
    aIdx, p => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const rest = p.deck.filter(c => !iids.includes(c.iid));
      return { ...p, deck: shuffle(rest), hand: [...p.hand, ...picked] };
    },
  );
});

// 從牌庫挑 ≤N 寶可夢放備戰
function deckSearchPokemonToBenchPost(
  filterStr: string, max: number, effectKeyName: string, label: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    // v3.80：支援零之大空洞
    const benchSpace = Math.max(0, getOwnBenchLimit(state, aIdx, pool) - player.bench.length);
    if (benchSpace === 0) return addLog(state, `${label}：備戰已滿`, aIdx);
    if (player.deck.length === 0) return addLog(state, `${label}：牌庫已空`, aIdx);
    const realMax = Math.min(max, benchSpace);
    const s = addLog(state, `${label}：從牌庫挑 0~${realMax} 張寶可夢放備戰（重洗）`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: filterStr,
      minCount: 0, maxCount: realMax,
      effectKey: effectKeyName,
    });
  };
}

// 復用 v2.55 wave5-place-basic-bench resolver

// 對手特定隻數備戰各 N
function snipeNOppBenchAutoPost(amount: number, count: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.bench.length === 0) return addLog(state, `${label}：對手備戰區無寶可夢`, aIdx);
    const realCount = Math.min(count, opp.bench.length);
    if (realCount === 1) {
      // 1 隻：用既有 wave3a-snipe-bench resolver 給玩家選
      const s = addLog(state, `${label}：選 1 隻對手備戰寶可夢，受到 ${amount} 點傷害`, aIdx);
      return withPending(s, {
        type: 'opp-bench-choose',
        actorIdx: aIdx, sourcePlayerIdx: dIdx,
        minCount: 1, maxCount: 1,
        effectKey: 'wave3a-snipe-bench',
        params: { amount, label },
      });
    }
    // 多隻：用本檔 wave13-snipe-multi-opp-bench
    const s = addLog(state, `${label}：選 ${realCount} 隻對手備戰寶可夢，各受到 ${amount} 點傷害`, aIdx);
    return withPending(s, {
      type: 'opp-bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: realCount, maxCount: realCount,
      effectKey: 'wave13-snipe-multi-opp-bench',
      params: { amount, label },
    });
  };
}

regR('wave13-snipe-multi-opp-bench', (state, aIdx, iids, params, pool) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 0;
  const label = (params?.label as string | undefined) ?? '狙擊';
  if (amount === 0) return state;
  // v5.437：改走中央函式（補免疫/KO/受傷反擊）。備戰目標不計弱抗（中央函式 isActive gate 自動）。
  let s = addLog(state, `${label}：${iids.length} 隻備戰各受到 ${amount} 點傷害`, aIdx);
  for (const iid of iids) {
    s = dealAttackDamageToTarget(s, aIdx, iid, amount, pool, { kind: 'attack-damage', label });
    if (s.phase === 'game-over') return s;
  }
  return s;
});

// 自方備戰各 +N（不選擇）
function selfAllBenchAddDamagePost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    return updatePlayer(
      addLog(state, `${label}：自方備戰寶可夢各受到 ${amount} 點傷害`, aIdx),
      aIdx, p => ({
        ...p,
        bench: p.bench.map(b => ({ ...b, damage: (b.damage ?? 0) + amount })),
      }),
    );
  };
}

// 自方 1 隻備戰受 N
function selfBenchPickHitPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const player = state.players[aIdx];
    if (player.bench.length === 0) return state;
    const s = addLog(state, `${label}：選 1 隻自方備戰寶可夢，受到 ${amount} 點傷害`, aIdx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'wave13-self-bench-hit',
      params: { amount, label },
    });
  };
}

regR('wave13-self-bench-hit', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 0;
  const targetIid = iids[0];
  return updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: (b.damage ?? 0) + amount } : b),
  }));
});

// 擲幣 immune
function coinHeadsImmunePost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    const heads = r.heads === 1;
    let s = addLog(r.state, `${label}：${heads ? '正面 → 下回合 immune' : '反面'}`, aIdx);
    if (!heads) return s;
    return updatePlayer(s, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageReduceNextHit: 9999 } : null,
    }));
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 本回合回血條件 +N (2 張)
// JSON：「在這個回合，若這隻寶可夢恢復了HP，則增加 N 點傷害。」
// v4.43：舊版 Math.random() 50% 啟發式 → 改為查 active.healedThisTurn 旗標
// 該旗標由 engine markHealsByDamageDecrease 在 applyAction 結尾自動偵測（damage 減少 → 設旗標）
// 自動覆蓋所有回血路徑：招式 helper / trainer / item / 特性 / stadium
// ══════════════════════════════════════════════════════════════════════════════
regPre('霸王花|活潑鮮花', (state, aIdx, _pool) => {
  const active = state.players[aIdx].active;
  const healed = !!active?.healedThisTurn;
  const dmg = 60 + (healed ? 120 : 0);
  const s = addLog(state, `活潑鮮花：${healed ? '本回合曾恢復 HP → +120' : '本回合未恢復 HP'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

regPre('沙鈴仙人掌|活潑針', (state, aIdx, _pool) => {
  const active = state.players[aIdx].active;
  const healed = !!active?.healedThisTurn;
  const dmg = 20 + (healed ? 100 : 0);
  const s = addLog(state, `活潑針：${healed ? '本回合曾恢復 HP → +100' : '本回合未恢復 HP'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 自身能量轉移備戰 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
// 龍捲雲|暴風 100 + 自身 1 基本能量改附備戰
regPre('龍捲雲|暴風', (s) => ({ state: s, damage: 100 }));
regPost('龍捲雲|暴風', (state, aIdx, pool) => {
  // v3.13 修：原本自動附給第 1 隻備戰，違反卡面「玩家選擇備戰目標」。
  //   改用 bench-choose picker 讓玩家挑目標備戰寶可夢。
  const a = state.players[aIdx].active;
  if (!a || a.energyAttached.length === 0) return state;
  // 找尾端 1 個基本能量
  let basicIdx = -1;
  for (let i = a.energyAttached.length - 1; i >= 0; i--) {
    const c = pool.get(a.energyAttached[i].cardId);
    if (c?.supertype === 'Energy' && c.subtype === 'Basic') {
      basicIdx = i;
      break;
    }
  }
  if (basicIdx < 0) return addLog(state, '暴風：自身無基本能量可移', aIdx);
  const player = state.players[aIdx];
  if (player.bench.length === 0) return addLog(state, '暴風：備戰區無寶可夢', aIdx);
  // bench 只有 1 隻 → 自動附（auto-pick），免去無意義的 picker
  if (player.bench.length === 1) {
    const energy = a.energyAttached[basicIdx];
    const targetIid = player.bench[0].iid;
    return updatePlayer(
      addLog(state, '暴風：將自身 1 基本能量改附給唯一備戰寶可夢', aIdx),
      aIdx, p => {
        if (!p.active) return p;
        const newEnergies = [...p.active.energyAttached.slice(0, basicIdx), ...p.active.energyAttached.slice(basicIdx + 1)];
        return {
          ...p,
          active: { ...p.active, energyAttached: newEnergies },
          bench: p.bench.map(b => b.iid === targetIid
            ? { ...b, energyAttached: [...b.energyAttached, energy] }
            : b),
        };
      },
    );
  }
  // 多隻備戰 → 玩家選目標
  return withPending(
    addLog(state, '暴風：請選擇備戰寶可夢以接收 1 基本能量', aIdx),
    {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'v313-storm-move-energy',
      params: { basicIdx, label: '暴風' },
    },
  );
});

// v3.13 resolver: 把自身 active.energyAttached[basicIdx] 移到玩家選的備戰目標
regR('v313-storm-move-energy', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) return state;
  const basicIdx = params?.basicIdx as number | undefined;
  const label = (params?.label as string | undefined) ?? '能量轉移';
  if (basicIdx == null) return state;
  const targetIid = iids[0];
  return updatePlayer(
    addLog(state, `${label}：能量轉移到選定的備戰寶可夢`, aIdx),
    aIdx, p => {
      if (!p.active || basicIdx >= p.active.energyAttached.length) return p;
      const energy = p.active.energyAttached[basicIdx];
      const newEnergies = [...p.active.energyAttached.slice(0, basicIdx), ...p.active.energyAttached.slice(basicIdx + 1)];
      return {
        ...p,
        active: { ...p.active, energyAttached: newEnergies },
        bench: p.bench.map(b => b.iid === targetIid
          ? { ...b, energyAttached: [...b.energyAttached, energy] }
          : b),
      };
    },
  );
});

// 波爾凱尼恩ex|高溫旋風 160 + 自身 1 能量改附備戰
regPre('波爾凱尼恩ex|高溫旋風', (s) => ({ state: s, damage: 160 }));
regPost('波爾凱尼恩ex|高溫旋風', (state, aIdx, _pool) => {
  // v3.13 修：原本自動附給第 1 隻備戰，違反卡面「玩家選擇備戰目標」。
  //   改用 bench-choose picker 讓玩家挑目標。
  const a = state.players[aIdx].active;
  if (!a || a.energyAttached.length === 0) return state;
  const player = state.players[aIdx];
  if (player.bench.length === 0) return addLog(state, '高溫旋風：備戰區無寶可夢', aIdx);
  // 取尾端 1 能量（沿用原 helper 抓最後一張的行為）
  const lastIdx = a.energyAttached.length - 1;
  if (player.bench.length === 1) {
    // auto-pick（免去無意義的 picker）
    const energy = a.energyAttached[lastIdx];
    const targetIid = player.bench[0].iid;
    return updatePlayer(
      addLog(state, '高溫旋風：將自身 1 能量改附給唯一備戰寶可夢', aIdx),
      aIdx, p => {
        if (!p.active) return p;
        const newEnergies = p.active.energyAttached.slice(0, -1);
        return {
          ...p,
          active: { ...p.active, energyAttached: newEnergies },
          bench: p.bench.map(b => b.iid === targetIid
            ? { ...b, energyAttached: [...b.energyAttached, energy] }
            : b),
        };
      },
    );
  }
  return withPending(
    addLog(state, '高溫旋風：請選擇備戰寶可夢以接收 1 能量', aIdx),
    {
      type: 'bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'v313-storm-move-energy',  // 共用 v313-storm-move-energy resolver
      params: { basicIdx: lastIdx, label: '高溫旋風' },
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 查看自己牌庫頂 1 可選棄 (2 張)
// 簡化：自動 50% 機率棄掉
// ══════════════════════════════════════════════════════════════════════════════
// 燭光靈|光照燃燒 — 卡面：「查看自己的牌庫上方1張卡，回復原樣。若希望，將那張卡丟棄。」
//   v3.26 修：原強制棄牌庫頂，違反卡面「若希望」。借殼 binary-yes-no。
//   注意：簡化未實裝「先給玩家看牌庫頂再決定」（會洩漏牌庫頂），
//   只做 yes/no 問答；玩家若選「否」則保留牌庫頂、選「是」則丟棄牌庫頂。
ATTACK_PRE_DISCARD_CHOICE.set('燭光靈|光照燃燒', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否將自己的牌庫上方 1 張卡丟棄？',
  choiceYesLabel: '是（將牌庫頂丟棄）',
  choiceNoLabel: '否（保留牌庫頂）',
});
regPre('燭光靈|光照燃燒', (s) => ({ state: s, damage: 0 }));
regPost('燭光靈|光照燃燒', (state, aIdx, _pool, action) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '光照燃燒：牌庫已空', aIdx);
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return addLog(state, '光照燃燒：選「否」 → 保留牌庫頂', aIdx);
  }
  return updatePlayer(
    addLog(state, '光照燃燒：選「是」 → 丟棄牌庫頂 1 張', aIdx),
    aIdx, p => ({
      ...p,
      deck: p.deck.slice(1),
      discard: [...p.discard, p.deck[0]],
    }),
  );
});

// 岩狗狗|挖回 — 卡面：「查看自己的牌庫上方1張卡，回復原樣。若希望，將那張卡丟棄。」
//   v3.26 修：與光照燃燒相同 pattern。借殼 binary-yes-no。
ATTACK_PRE_DISCARD_CHOICE.set('岩狗狗|挖回', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否將自己的牌庫上方 1 張卡丟棄？',
  choiceYesLabel: '是（將牌庫頂丟棄）',
  choiceNoLabel: '否（保留牌庫頂）',
});
regPre('岩狗狗|挖回', (s) => ({ state: s, damage: 0 }));
regPost('岩狗狗|挖回', (state, aIdx, _pool, action) => {
  const player = state.players[aIdx];
  if (player.deck.length === 0) return addLog(state, '挖回：牌庫已空', aIdx);
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return addLog(state, '挖回：選「否」 → 保留牌庫頂', aIdx);
  }
  return updatePlayer(
    addLog(state, '挖回：選「是」 → 丟棄牌庫頂 1 張', aIdx),
    aIdx, p => ({
      ...p,
      deck: p.deck.slice(1),
      discard: [...p.discard, p.deck[0]],
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 對手 2 隻備戰各 N (1 張) — 竹蘭的美納斯|水分岔
// ══════════════════════════════════════════════════════════════════════════════
regPre('竹蘭的美納斯|水分岔', (s) => ({ state: s, damage: 60 }));
regPost('竹蘭的美納斯|水分岔', snipeNOppBenchAutoPost(30, 2, '水分岔'));

// ══════════════════════════════════════════════════════════════════════════════
// 5. 自方 1 隻備戰受 N (1 張) — 雷電獸|閃光衝擊
// ══════════════════════════════════════════════════════════════════════════════
regPre('雷電獸|閃光衝擊', (s) => ({ state: s, damage: 120 }));
regPost('雷電獸|閃光衝擊', selfBenchPickHitPost(40, '閃光衝擊'));

// ══════════════════════════════════════════════════════════════════════════════
// 6. 對手 1 隻備戰 N (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('雷電斑馬|電氣子彈', (s) => ({ state: s, damage: 100 }));
regPost('雷電斑馬|電氣子彈', snipeNOppBenchAutoPost(30, 1, '電氣子彈'));

regPre('赫普的鋼鎧鴉|穿通', (s) => ({ state: s, damage: 50 }));
regPost('赫普的鋼鎧鴉|穿通', snipeNOppBenchAutoPost(50, 1, '穿通'));

// ══════════════════════════════════════════════════════════════════════════════
// 7. 自方所有備戰各 N (1 張) — 赫普的沙螺蟒|大地裂破
// ══════════════════════════════════════════════════════════════════════════════
regPre('赫普的沙螺蟒|大地裂破', (s) => ({ state: s, damage: 140 }));
regPost('赫普的沙螺蟒|大地裂破', selfAllBenchAddDamagePost(20, '大地裂破'));

// ══════════════════════════════════════════════════════════════════════════════
// 8. 厄鬼椪 X 面具|X 之神樂 (3 張) — 牌庫挑 1 基本能量附自方
// ══════════════════════════════════════════════════════════════════════════════
regPre('厄鬼椪 碧草面具|草之神樂', (s) => ({ state: s, damage: 0 }));
regPost('厄鬼椪 碧草面具|草之神樂', deckSearchBasicEnergyAttachOnePost('Grass', '草之神樂'));

regPre('厄鬼椪 火灶面具|火之神樂', (s) => ({ state: s, damage: 0 }));
regPost('厄鬼椪 火灶面具|火之神樂', deckSearchBasicEnergyAttachOnePost('Fire', '火之神樂'));

regPre('厄鬼椪 水井面具|水之神樂', (s) => ({ state: s, damage: 0 }));
regPost('厄鬼椪 水井面具|水之神樂', deckSearchBasicEnergyAttachOnePost('Water', '水之神樂'));

// ══════════════════════════════════════════════════════════════════════════════
// 9. 牌庫挑寶可夢加手 (3 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('扒手貓|邪惡邀請', (s) => ({ state: s, damage: 0 }));
regPost('扒手貓|邪惡邀請', deckSearchPokemonToHandPost('Pokemon:Darkness', 3, 'wave13-deck-take-any', '邪惡邀請'));

regPre('小霞的拉普拉斯|一起游水', (s) => ({ state: s, damage: 0 }));
regPost('小霞的拉普拉斯|一起游水', deckSearchPokemonToHandPost('Pokemon:NamePrefix=小霞的', 3, 'wave13-deck-take-any', '一起游水'));

regPre('夢夢蝕|夢境呼喚', (s) => ({ state: s, damage: 0 }));
regPost('夢夢蝕|夢境呼喚', deckSearchPokemonToHandPost('Card:真菰', 60, 'wave13-deck-take-any', '夢境呼喚'));

// ══════════════════════════════════════════════════════════════════════════════
// 10. 牌庫挑寶可夢放備戰 (3 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('莉莉艾的花療環環|招花', (s) => ({ state: s, damage: 0 }));
regPost('莉莉艾的花療環環|招花', deckSearchPokemonToBenchPost('Basic:NamePrefix=莉莉艾的', 5, 'wave5-place-basic-bench', '招花'));

regPre('大吾的天秤偶|召集標誌', (s) => ({ state: s, damage: 0 }));
regPost('大吾的天秤偶|召集標誌', deckSearchPokemonToBenchPost('Basic:NamePrefix=大吾的', 2, 'wave5-place-basic-bench', '召集標誌'));

regPre('電飛鼠|呼朋引伴', (s) => ({ state: s, damage: 0 }));
regPost('電飛鼠|呼朋引伴', deckSearchPokemonToBenchPost('Basic', 2, 'wave5-place-basic-bench', '呼朋引伴'));

// ══════════════════════════════════════════════════════════════════════════════
// 11. 牌庫挑物品/能量加手 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('嗡蝠|搬運破爛', (s) => ({ state: s, damage: 0 }));
regPost('嗡蝠|搬運破爛', deckSearchPokemonToHandPost('Tool', 1, 'wave13-deck-take-any', '搬運破爛'));

regPre('牙牙|集力', (s) => ({ state: s, damage: 0 }));
regPost('牙牙|集力', deckSearchPokemonToHandPost('BasicEnergy', 2, 'wave13-deck-take-any', '集力'));

// ══════════════════════════════════════════════════════════════════════════════
// 12. 自方備戰【鬥】寶可夢指示物 ×20 (1 張) — 龐岩怪|復仇加農炮
// ══════════════════════════════════════════════════════════════════════════════
regPre('龐岩怪|復仇加農炮', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  let counters = 0;
  for (const b of player.bench) {
    const card = pool.get(b.cardId);
    if (card?.pokemonType === 'Fighting') {
      counters += Math.floor((b.damage ?? 0) / 10);
    }
  }
  const dmg = counters * 20;
  const s = addLog(state, `復仇加農炮：自方備戰【鬥】寶可夢指示物 ${counters} 個 → ${counters}×20 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. 對手選 3 張自己的手牌回牌庫 — 詛咒娃娃|詛咒言語
// 卡面：「對手選擇3張對手自己的手牌，放回牌庫並重洗。」
// v5.115：原 v2.63 簡化用隨機選 3 張，違反卡面「對手選擇」字樣。
//   修法：opponent picker (actorIdx=dIdx, hand-discard min=max=pickCount)
//   → resolver 'curse-doll-curse-words' 把 picked iids 從對手手牌移到牌庫並重洗。
// ══════════════════════════════════════════════════════════════════════════════
regPre('詛咒娃娃|詛咒言語', (s) => ({ state: s, damage: 0 }));
regPost('詛咒娃娃|詛咒言語', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  if (opp.hand.length === 0) return addLog(state, '詛咒言語：對手手牌為空', aIdx);
  const pickCount = Math.min(3, opp.hand.length);
  const s = addLog(state, `詛咒言語：請對手選擇 ${pickCount} 張自己的手牌放回牌庫並重洗`, aIdx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: pickCount, maxCount: pickCount,
    effectKey: 'curse-doll-curse-words',
    params: { titleOverride: `詛咒言語：選擇 ${pickCount} 張自己的手牌放回牌庫（並重洗）` },
  });
});

// v5.115 curse-doll-curse-words resolver — 對手選擇的手牌 → 放回牌庫並重洗
regR('curse-doll-curse-words', (state, idx, iids, _params, _pool) => {
  // idx 是 actor = dIdx（被作用的對手，自己選自己的牌）
  if (iids.length === 0) return addLog(state, '詛咒言語：未選擇任何手牌（取消）', idx);
  const iidSet = new Set(iids);
  const next = updatePlayer(state, idx, p => {
    const picked = p.hand.filter(c => iidSet.has(c.iid));
    const remaining = p.hand.filter(c => !iidSet.has(c.iid));
    return { ...p, hand: remaining, deck: shuffle([...p.deck, ...picked]) };
  });
  return addLog(next, `詛咒言語：對手選擇 ${iids.length} 張手牌放回牌庫並重洗`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. 擲幣狀態（敏捷蟲、音波龍、竹蘭的醜醜魚）
// ══════════════════════════════════════════════════════════════════════════════
// 敏捷蟲|酸液炸彈 50, 擲幣正面棄對手1能量
regPre('敏捷蟲|酸液炸彈', (s) => ({ state: s, damage: 50 }));
regPost('敏捷蟲|酸液炸彈', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '酸液炸彈', aIdx);
  const heads = r.heads === 1;
  let s = r.state;
  if (!heads) return s;
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def || def.energyAttached.length === 0) return s;
  return updatePlayer(
    addLog(s, '酸液炸彈：棄對手戰鬥場 1 張能量', aIdx),
    dIdx, p => {
      if (!p.active) return p;
      const lastIdx = p.active.energyAttached.length - 1;
      const remaining = p.active.energyAttached.slice(0, lastIdx);
      const discarded = p.active.energyAttached[lastIdx];
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, discarded] };
    },
  );
});

// 音波龍|高速移動 40 + 擲幣正面 → immune
regPre('音波龍|高速移動', (s) => ({ state: s, damage: 40 }));
regPost('音波龍|高速移動', coinHeadsImmunePost('高速移動'));

// 竹蘭的醜醜魚|搖搖游水 10 + 擲幣正面 → immune
regPre('竹蘭的醜醜魚|搖搖游水', (s) => ({ state: s, damage: 10 }));
regPost('竹蘭的醜醜魚|搖搖游水', coinHeadsImmunePost('搖搖游水'));

// ══════════════════════════════════════════════════════════════════════════════
// 15. 對手 1 隻寶可夢狙擊（不計弱抗，含 active+bench）(1 張)
// 象徵鳥|意念移物 0 + 對手 1 隻寶可夢 70 不計弱抗
// ══════════════════════════════════════════════════════════════════════════════
regPre('象徵鳥|意念移物', (s) => ({ state: s, damage: 0 }));
regPost('象徵鳥|意念移物', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const targets: string[] = [];
  if (opp.active) targets.push(opp.active.iid);
  for (const b of opp.bench) targets.push(b.iid);
  if (targets.length === 0) return state;
  const s = addLog(state, '意念移物：選 1 隻對手寶可夢，受到 70 點傷害（不計弱抗）', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave6-snipe-any-opp-flat',  // 復用 v2.56 resolver
    params: { amount: 70, label: '意念移物', kind: 'attack-damage', noWeakness: true, validIids: targets },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. 「下回合自身招式 +N」(2 張)
// 美洛耶塔ex|回聲 30 + 下回合「回聲」+80
// 桃歹郎|糬猛攻 20 + 下回合「糬猛攻」+50
// 簡化：用 damageBonusNextTurn 旗標（既有 damageBonusThisTurn 為 next-turn promote 機制）
// ══════════════════════════════════════════════════════════════════════════════
regPre('美洛耶塔ex|回聲', (s) => ({ state: s, damage: 30 }));
regPost('美洛耶塔ex|回聲', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '回聲：下回合「回聲」+80', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageBonusPending: 80 } : null,
    }),
  );
});

regPre('桃歹郎|糬猛攻', (s) => ({ state: s, damage: 20 }));
regPost('桃歹郎|糬猛攻', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '糬猛攻：下回合「糬猛攻」+50', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageBonusPending: 50 } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. 「下回合不受 N 以下招式」(2 張) — 簡化為下回合 -N 大量
// 石丸子|變硬 (≤40 → damageReduceNextHit=40)
// 鐵甲蛹|變硬 (≤60 → damageReduceNextHit=60)
// 注意：嚴格來說「不會受到 ≤N 招式的傷害」是 if dmg≤N → 0；
// 簡化為 -N reduction 是合理近似（實際情況差不多）
// ══════════════════════════════════════════════════════════════════════════════
regPre('石丸子|變硬', (s) => ({ state: s, damage: 0 }));
regPost('石丸子|變硬', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '變硬：自身下回合受招式 -40（≤40 不會受到傷害的近似）', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageReduceNextHit: 40 } : null,
    }),
  );
});

regPre('鐵甲蛹|變硬', (s) => ({ state: s, damage: 0 }));
regPost('鐵甲蛹|變硬', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '變硬：自身下回合受招式 -60（≤60 不會受到傷害的近似）', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damageReduceNextHit: 60 } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. 萊希拉姆ex|火爆發 130+ 對手已得獎賞 ×50 + 自身棄 1 能量
// ══════════════════════════════════════════════════════════════════════════════
regPre('萊希拉姆ex|火爆發', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const taken = 6 - state.players[dIdx].prizes.length;
  const dmg = 130 + taken * 50;
  const s = addLog(state, `火爆發：對手已得獎賞 ${taken} 張 → 130 + ${taken}×50 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});
regPost('萊希拉姆ex|火爆發', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  if (!a || a.energyAttached.length === 0) return state;
  return updatePlayer(
    addLog(state, '火爆發：自身丟棄 1 個能量', aIdx),
    aIdx, p => {
      if (!p.active) return p;
      const lastIdx = p.active.energyAttached.length - 1;
      const discarded = p.active.energyAttached[lastIdx];
      return {
        ...p,
        active: { ...p.active, energyAttached: p.active.energyAttached.slice(0, lastIdx) },
        discard: [...p.discard, discarded],
      };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 19. 頭巾混混|無賴攻擊 — 擲與自方惡寶可夢同次硬幣，正面數 ×60
// ══════════════════════════════════════════════════════════════════════════════
regPre('頭巾混混|無賴攻擊', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  let darkCount = 0;
  for (const pk of all) {
    if (pool.get(pk.cardId)?.pokemonType === 'Darkness') darkCount++;
  }
  const rda = flipCoinsWithLog(state, darkCount, '無賴攻擊', aIdx);
  const heads = rda.heads;
  const dmg = heads * 60;
  const s = addLog(rda.state, `無賴攻擊：自方惡寶可夢 ${darkCount} 隻 → 擲 ${darkCount} 次 → ${heads} 正面 = ${heads}×60 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 20. 火箭隊的地鼠|狂潛 — 擲到反棄對手牌庫頂 N
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的地鼠|狂潛', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的地鼠|狂潛', (state, aIdx, _pool) => {
  let heads = 0;
  let s0 = state;
  for (let i = 0; i < 20; i++) {
    const r = flipCoinsWithLog(s0, 1, '狂潛', aIdx);
    s0 = r.state;
    if (r.heads === 1) heads++;
    else break;
  }
  let s = addLog(s0, `狂潛：擲到反面為止 → ${heads} 次正面`, aIdx);
  if (heads === 0) return s;
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(s, dIdx, p => {
    const discardCount = Math.min(heads, p.deck.length);
    const discarded = p.deck.slice(0, discardCount);
    return { ...p, deck: p.deck.slice(discardCount), discard: [...p.discard, ...discarded] };
  });
});

// 輔助：unused import 防護
export type _v2630Sentinel = PlayerState;
type _APT = AttackPostFn;
