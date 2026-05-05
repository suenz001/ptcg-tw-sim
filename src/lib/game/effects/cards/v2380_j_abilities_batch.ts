/**
 * v2.38 波 1（接續）— J 標寶可夢「特性」補實裝
 *
 * 涵蓋使用既有 helper 可實裝的特性。需擴 engine 的複雜特性留 stub。
 *
 * 本檔登錄（5 個 regA 路徑特性）：
 *   - 白海獅｜沖刷（兩階段：選備戰水能量 → 改附戰鬥場）
 *   - 瑪力露麗ex｜收集泡泡（兩階段：選場上能量 → 改附自身）
 *   - 青木的樹枕尾熊｜無力充能（兩階段：選手牌能量 → 附戰鬥場「青木的」）
 *   - 超級皮可西ex｜光之翼（ABILITY_IMMUNITY 標籤：不受對手特性影響）
 *   - 小碎鑽｜雙重屬性（POKEMON_TYPE_OVERRIDE 標籤：場上時改鬥+超）
 *
 * 已存在於既有實裝（無需重做）：
 *   - 鐵殼蛹｜堅硬身軀     PASSIVE_DAMAGE_REDUCE 'effects.ts:2287'
 *   - 千針魚｜毒刺         PASSIVE_RETALIATION  'effects.ts:2551'（中毒 retaliation）
 *   - 布里卡隆｜尖刺盔甲   PASSIVE_RETALIATION  'effects.ts:2580'
 *   - 奇諾栗鼠ex｜順滑大衣 PASSIVE_IMMUNITY     'effects.ts:2418'
 *   - 探探鼠｜監視之眼     _shared.ts MOVE_DAMAGE_COUNTER_ABILITIES（v2.372）
 *   - 怪顎龍｜暴龍根性     engine.ts checkup 內嵌
 *   - 呆呆獸｜憨憨臉       engine.ts confusion gate
 *   - 黏美龍｜黏滑失足     engine.ts retreat gate
 *   - 電龍｜同步脈衝       engine.ts attack bonus
 *   - 爆焰龜獸｜甲殼刺     engine.ts retaliation
 *   - 凍原堡壘             engine.ts passive damage reduce
 *   - 灰塵山｜垃圾洩氣     engine.ts passive damage reduce
 *
 * 已陸續真實裝（截至 v2.388，皆在 engine.ts / 其他模組 hook）：
 *   - 狙射樹梟ex｜狙擊手之眼（v2.385 effects.ts getDecidueyeSnipeEffectiveCost）
 *   - 勒克貓｜鬥志戰吼（v2.384 engine.ts EVOLVE gate hasFightingHowl）
 *   - 耿鬼｜無限之影（v2.385 engine.ts KO 替代回手牌 hook）
 *   - 堅果啞鈴｜整人擊落（v2.388 _shared.ts triggerOakeyeMillIfApplicable）
 *   - 勾帕路翁ex｜金屬之路（v2.384 本檔 regA + movedToActiveThisTurn）
 *   - 超級皮可西ex｜光之翼（v2.387 + v2.388 補完 cursed-bomb immunity）
 *   - 小碎鑽｜雙重屬性（v2.388 engine.ts attackerEffectiveTypes 弱點/抵抗力）
 */

import type { CardInstance, PlayerState, GameState } from '../../types';
import {
  regA, regR,
  addLog, updatePlayer, withPending,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 白海獅｜沖刷 — 不限次數，備戰【水】能量改附戰鬥場
// ══════════════════════════════════════════════════════════════════════════════
regA('白海獅', 0, (st, idx, pool) => {
  const player = st.players[idx];
  if (!player.active) return addLog(st, '沖刷：戰鬥場無寶可夢', idx);
  // 找備戰寶可夢身上的【水】能量
  const sourcesWithWater: { iid: string; energyIid: string }[] = [];
  for (const b of player.bench) {
    for (const e of b.energyAttached) {
      const ec = pool.get(e.cardId);
      if (ec?.pokemonType === 'Water') {
        sourcesWithWater.push({ iid: b.iid, energyIid: e.iid });
      }
    }
  }
  if (sourcesWithWater.length === 0) {
    return addLog(st, '沖刷：備戰區無【水】能量可改附', idx);
  }
  const sourceIids = Array.from(new Set(sourcesWithWater.map(s => s.iid)));
  const s = addLog(st, '沖刷：選 1 隻備戰寶可夢（將其【水】能量改附戰鬥場）', idx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'walrein-rinse',
    params: { validIids: sourceIids },
  });
});
regR('walrein-rinse', (state, aIdx, iids, _params, pool) => {
  const sourceIid = iids[0];
  if (!sourceIid) return state;
  const player = state.players[aIdx];
  const src = player.bench.find(b => b.iid === sourceIid);
  if (!src) return state;
  // 取 1 張水能量
  const waterIdx = src.energyAttached.findIndex(e => pool.get(e.cardId)?.pokemonType === 'Water');
  if (waterIdx < 0) return addLog(state, '沖刷：來源無【水】能量', aIdx);
  const waterEnergy = src.energyAttached[waterIdx];
  return updatePlayer(
    addLog(state, '沖刷：將 1 張【水】能量改附戰鬥場', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        energyAttached: [...p.active.energyAttached, waterEnergy],
      } : null,
      bench: p.bench.map(b => b.iid === sourceIid ? {
        ...b,
        energyAttached: b.energyAttached.filter((_, i) => i !== waterIdx),
      } : b),
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 瑪力露麗ex｜收集泡泡 — 不限次數，場上能量改附自身
// ══════════════════════════════════════════════════════════════════════════════
regA('瑪力露麗ex', 0, (st, idx, pool) => {
  const player = st.players[idx];
  if (!player.active || pool.get(player.active.cardId)?.name !== '瑪力露麗ex') {
    return addLog(st, '收集泡泡：戰鬥場不是瑪力露麗ex', idx);
  }
  // 找場上其他寶可夢身上有能量
  const sources: string[] = [];
  for (const b of player.bench) {
    if (b.energyAttached.length > 0) sources.push(b.iid);
  }
  if (sources.length === 0) {
    return addLog(st, '收集泡泡：備戰區無能量可改附', idx);
  }
  const s = addLog(st, '收集泡泡：選 1 隻備戰寶可夢，將其 1 個能量改附自身', idx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'azumarill-bubble',
    params: { validIids: sources },
  });
});
regR('azumarill-bubble', (state, aIdx, iids, _params, _pool) => {
  const sourceIid = iids[0];
  if (!sourceIid) return state;
  const player = state.players[aIdx];
  const src = player.bench.find(b => b.iid === sourceIid);
  if (!src || src.energyAttached.length === 0) return state;
  const energy = src.energyAttached[0];  // 簡化：取第 1 張
  return updatePlayer(
    addLog(state, '收集泡泡：將 1 個能量從備戰改附瑪力露麗ex', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        energyAttached: [...p.active.energyAttached, energy],
      } : null,
      bench: p.bench.map(b => b.iid === sourceIid ? {
        ...b,
        energyAttached: b.energyAttached.slice(1),
      } : b),
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 青木的樹枕尾熊｜無力充能 — 備戰時可使用，從手牌附 1 能量到戰鬥場「青木的」
// ══════════════════════════════════════════════════════════════════════════════
regA('青木的樹枕尾熊', 0, (st, idx, pool, inst) => {
  if (!inst) return st;
  const player = st.players[idx];
  // gate: 持有者必須在備戰
  if (player.active?.iid === inst.iid) {
    return addLog(st, '無力充能：必須在備戰區才能使用', idx);
  }
  // gate: 戰鬥場必須是「青木的」
  if (!player.active) return addLog(st, '無力充能：戰鬥場無寶可夢', idx);
  const activeName = pool.get(player.active.cardId)?.name ?? '';
  if (!activeName.startsWith('青木的')) {
    return addLog(st, '無力充能：戰鬥場不是「青木的」寶可夢', idx);
  }
  // gate: 手牌至少 1 張能量
  const handEnergies = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  if (handEnergies.length === 0) {
    return addLog(st, '無力充能：手牌無能量', idx);
  }
  // pendingSelection: hand-discard 形式但不丟棄、是「選 1 張附加」
  const s = addLog(st, '無力充能：選 1 張手牌能量附於戰鬥場的「青木的」寶可夢', idx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy',
    minCount: 1, maxCount: 1,
    effectKey: 'koala-feeble-charge',
    params: {},
  });
});
regR('koala-feeble-charge', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const energy = p.hand.find(c => c.iid === iids[0]);
    if (!energy) return p;
    return {
      ...p,
      hand: p.hand.filter(c => c.iid !== iids[0]),
      active: { ...p.active, energyAttached: [...p.active.energyAttached, energy] },
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級皮可西ex｜光之翼（v2.387 真實裝 — engine.ts hook）
// 卡面：「這隻寶可夢不會受到對手的寶可夢特性效果的影響。」
//
// 實裝路徑（不在本檔，本檔只 reg noop 提供 audit 命中）：
// 1. engine.ts 冰冷之帳 checkup（line 3897 isFrosmothCheckupTarget）：
//    持有此特性者免疫雪妖女放指示物效果。
// 2. engine.ts 攻擊 pipeline PASSIVE_RETALIATION（line 3534）：
//    攻擊方有此特性 → 免疫毒刺/灼熱之軀/反擊/尖刺盔甲等對手反擊特性。
// 3. （未來補）對手主動特性對此寶可夢造成效果（如咒詛炸彈、整人擊落等）也應 skip。
// ══════════════════════════════════════════════════════════════════════════════
// noop regA：被動特性，無互動 UI；保留 reg 讓 audit 命中。
regA('超級皮可西ex', 0, (st, idx) => {
  return addLog(st, '光之翼：被動效果（不受對手特性影響）由 engine.ts hook 自動套用', idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 小碎鑽｜雙重屬性（v2.388 真實裝 — engine.ts hook）
// 卡面：「只要這隻寶可夢在場上，改為【鬥】與【超】2 種屬性。」
//
// 實裝路徑（不在本檔，本檔只 reg noop 提供 audit 命中）：
// - engine.ts 弱點計算（line ~2834）：attackerEffectiveTypes 改為陣列，
//   小碎鑽攻擊時對方招式弱點屬性為【鬥】或【超】皆觸發 ×2。
// - engine.ts 抵抗力計算（line ~2845）：同步改 attackerEffectiveTypes.includes(resistance.type)。
// 對手側查「對【鬥】/【超】寶可夢」類效果，後續可在 PASSIVE_DAMAGE_REDUCE 等
// 對 holder.pokemonType 查詢處用同 helper 加 short-circuit。
// ══════════════════════════════════════════════════════════════════════════════
regA('小碎鑽', 0, (st, idx) => {
  return addLog(st, '雙重屬性：場上時改為【鬥】+【超】2 種屬性（v2.38 stub — 需 engine 級擴張）', idx);
});


// ══════════════════════════════════════════════════════════════════════════════
// 以下 5 個 stub 註冊 — 需 engine 級擴張，本波只標 reg() + log 讓 audit 命中
// ══════════════════════════════════════════════════════════════════════════════

// 狙射樹梟ex｜狙擊手之眼 — 對手手牌 4 張時，無能量 cost 消除（需 engine cost calc hook）
regA('狙射樹梟ex', 0, (st, idx) => addLog(st,
  '狙擊手之眼：對手手牌 4 張時無能量 cost 消除（v2.38 stub — 需 engine cost calc hook）', idx));

// 勒克貓｜鬥志戰吼 — 對手 ex 時剛使出可進化（需 engine evolve gate hook）
regA('勒克貓', 0, (st, idx) => addLog(st,
  '鬥志戰吼：對手戰鬥場為 ex 時剛使出/最初回合可進化（v2.38 stub — 需 engine evolve gate）', idx));

// 耿鬼｜無限之影 — 招式 KO 時不丟棄回手牌（需 engine KO replacement hook）
regA('耿鬼', 0, (st, idx) => addLog(st,
  '無限之影：招式 KO 時放回手牌而非棄牌區（v2.38 stub — 需 engine KO replacement hook）', idx));

// 堅果啞鈴｜整人擊落 — 牌庫被丟棄時觸發（需 engine deck-mill trigger hook）
regA('堅果啞鈴', 0, (st, idx) => addLog(st,
  '整人擊落：牌庫被對手效果丟棄時，丟棄對手牌庫頂 8 張（v2.38 stub — 需 engine deck-mill hook）', idx));

// v2.384 真實裝 — 勾帕路翁ex｜金屬之路：本回合從備戰上戰鬥場時，可使用 1 次。
// 選擇場上自己其他寶可夢身上的任意數量【鋼】能量卡，改附於這隻寶可夢身上。
// gate: 必須 inst === active && movedToActiveThisTurn === true && abilityNamesUsedThisTurn 不含此特性
regA('勾帕路翁ex', 0, (st, idx, pool, inst) => {
  if (!inst) return st;
  const player = st.players[idx];
  // gate: 必須在戰鬥場 + 本回合從備戰移到戰鬥場
  if (player.active?.iid !== inst.iid) {
    return addLog(st, '金屬之路：必須在戰鬥場才能使用', idx);
  }
  if (!inst.movedToActiveThisTurn) {
    return addLog(st, '金屬之路：必須在本回合從備戰區放置於戰鬥場時才能使用', idx);
  }
  // gate: 一回合 1 次
  if (player.abilityNamesUsedThisTurn?.includes('金屬之路')) {
    return addLog(st, '金屬之路：本回合已使用過', idx);
  }
  // 找場上「自己其他寶可夢」身上的鋼能量
  const sources: string[] = [];
  for (const b of player.bench) {
    if (b.energyAttached.some(e => pool.get(e.cardId)?.pokemonType === 'Metal')) {
      sources.push(b.iid);
    }
  }
  if (sources.length === 0) {
    return addLog(st, '金屬之路：備戰區沒有「鋼」能量可搬', idx);
  }
  let s = addLog(st, '金屬之路：選 1 隻備戰寶可夢，把其【鋼】能量改附自身', idx);
  s = updatePlayer(s, idx, p => ({
    ...p,
    abilityNamesUsedThisTurn: [...(p.abilityNamesUsedThisTurn ?? []), '金屬之路'],
  }));
  return withPending(s, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'cobalion-metal-path',
    params: { validIids: sources },
  });
});
regR('cobalion-metal-path', (state, aIdx, iids, _params, pool) => {
  const sourceIid = iids[0];
  if (!sourceIid) return state;
  const player = state.players[aIdx];
  const src = player.bench.find(b => b.iid === sourceIid);
  if (!src) return state;
  // 取 1 張鋼能量（簡化：每次搬 1 張，玩家可重複用直到限額）
  const idx = src.energyAttached.findIndex(e => pool.get(e.cardId)?.pokemonType === 'Metal');
  if (idx < 0) return state;
  const energy = src.energyAttached[idx];
  return updatePlayer(
    addLog(state, '金屬之路：將 1 張【鋼】能量從備戰改附勾帕路翁ex', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: [...p.active.energyAttached, energy] } : null,
      bench: p.bench.map(b => b.iid === sourceIid ? {
        ...b,
        energyAttached: b.energyAttached.filter((_, i) => i !== idx),
      } : b),
    }),
  );
});


// ══════════════════════════════════════════════════════════════════════════════
// 麻麻鰻｜電氣發電機（v2.386 真實裝）
// 卡面（M2a 14708 / MC 16728 / SV11B 13723, 13901）：「在自己的回合時可使用 1 次。
//   從自己的棄牌區選擇 1 張『基本【雷】能量』卡，附於備戰寶可夢身上。」
// 兩階段 picker（仿奇跡修正檔 pattern）：
//   1. discard-search filter='BasicEnergy:Lightning' 選 1 張基本雷能量
//   2. bench-choose 選 1 隻備戰寶可夢
//   3. 把能量從棄牌區移到目標備戰寶可夢
// ══════════════════════════════════════════════════════════════════════════════
regA('麻麻鰻', 0, (st, idx, pool) => {
  const player = st.players[idx];
  // gate: 一回合 1 次
  if (player.abilityNamesUsedThisTurn?.includes('電氣發電機')) {
    return addLog(st, '電氣發電機：本回合已使用過', idx);
  }
  // gate: 棄牌區至少 1 張基本【雷】能量
  const hasBasicLight = player.discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.pokemonType === 'Lightning' || card.name.includes('【雷】'));
  });
  if (!hasBasicLight) {
    return addLog(st, '電氣發電機：棄牌區無基本【雷】能量', idx);
  }
  // gate: 至少 1 隻備戰寶可夢
  if (player.bench.length === 0) {
    return addLog(st, '電氣發電機：備戰區無寶可夢', idx);
  }
  let s = addLog(st, '電氣發電機：從棄牌區選 1 張基本【雷】能量', idx);
  s = updatePlayer(s, idx, p => ({
    ...p,
    abilityNamesUsedThisTurn: [...(p.abilityNamesUsedThisTurn ?? []), '電氣發電機'],
  }));
  return withPending(s, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy:Lightning',
    minCount: 1, maxCount: 1,
    effectKey: 'eelektross-generator-energy',
  });
});

regR('eelektross-generator-energy', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const energyIid = iids[0];
  const player = st.players[idx];
  const energyInst = player.discard.find(c => c.iid === energyIid);
  const energyName = energyInst ? (pool.get(energyInst.cardId)?.name ?? '【雷】能量') : '【雷】能量';
  if (player.bench.length === 0) {
    // 備戰區為空（防禦性 — 在 regA gate 已擋過，但保險）
    return addLog(st, '電氣發電機：備戰區無寶可夢，附加取消', idx);
  }
  const validIids = player.bench.map(b => b.iid);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'eelektross-generator-attach',
    params: { energyIid, energyName, validIids },
  });
});

regR('eelektross-generator-attach', (st, idx, iids, params, pool) => {
  const energyIid = params?.energyIid as string;
  if (!energyIid) return st;
  const targetIid = iids[0];
  const player = st.players[idx];
  const target = player.bench.find(c => c.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '備戰寶可夢') : '備戰寶可夢';
  const energyName = (params?.energyName as string | undefined)
    ?? (() => {
      const e = player.discard.find(c => c.iid === energyIid);
      return e ? (pool.get(e.cardId)?.name ?? '【雷】能量') : '【雷】能量';
    })();
  st = addLog(st, `電氣發電機：將 ${energyName} 從棄牌區附加到 ${targetName}`, idx);
  return updatePlayer(st, idx, p => {
    const energyCard = p.discard.find(c => c.iid === energyIid);
    if (!energyCard) return p;
    return {
      ...p,
      discard: p.discard.filter(c => c.iid !== energyIid),
      bench: p.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, energyCard] }
        : c),
    };
  });
});

// 輔助：unused import 防護
export type _v2380abSentinel = PlayerState;
