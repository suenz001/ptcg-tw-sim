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
 *   - 勒克貓｜鬥志戰吼（在 engine.ts EVOLVE gate hasFightingHowl 處理）
 *   - 耿鬼｜無限之影（v2.385 engine.ts KO 替代回手牌 hook）
 *   - 堅果啞鈴｜整人擊落（v2.388 _shared.ts triggerOakeyeMillIfApplicable）
 *   - 勾帕路翁ex｜金屬之路（v2.384 本檔 regA + movedToActiveThisTurn）
 *   - 超級皮可西ex｜光之翼（v2.387 + v2.388 補完 cursed-bomb immunity）
 *   - 小碎鑽｜雙重屬性（v2.388 engine.ts attackerEffectiveTypes 弱點/抵抗力）
 */

import type { CardInstance, PlayerState, GameState } from '../../types';
import { applyMagearnaHandAttachHeal } from './v3000_g3_wave2';
import { fireOnHandEnergyAttached } from '../_shared'; // v5.662 從手牌附能→對手反應(侵蝕詛咒/麻痺門牙)
import { energyProvidesType } from '../../effects'; // v5.682 host-aware「視為提供X屬性」(含古舊/稜鏡等特殊能量)
import type { Card } from '$lib/cards/types';
import {
  regA, regAByName, regR,
  addLog, updatePlayer, withPending, rejectAbilityUse } from '../_shared';

// v4.963: 基本能量 pokemonType=null fallback helper — 認屬性能量含 name【X】 fallback。
function isEnergyOfType(ec: any, type: string): boolean {
  if (!ec || ec.supertype !== 'Energy') return false;
  if (ec.pokemonType === type) return true;
  const m = (ec.name || '').match(/【(.+?)】/);
  if (!m) return false;
  const zh: Record<string, string> = { '草':'Grass','火':'Fire','水':'Water','雷':'Lightning','超':'Psychic','鬥':'Fighting','惡':'Darkness','鋼':'Metal','妖':'Fairy','龍':'Dragon','無':'Colorless' };
  return zh[m[1]] === type;
}

// ══════════════════════════════════════════════════════════════════════════════
// 白海獅｜沖刷 — 不限次數，備戰【水】能量改附戰鬥場
// ══════════════════════════════════════════════════════════════════════════════
regAByName('白海獅', '沖刷', (st, idx, pool) => {
  const player = st.players[idx];
  if (!player.active) return rejectAbilityUse(st, '沖刷：戰鬥場無寶可夢', idx);
  // 找備戰寶可夢身上的【水】能量
  // v4.962：用 isWaterTypeEnergy helper 認基本【水】能量（pokemonType=null fallback）
  const sourcesWithWater: { iid: string; energyIid: string }[] = [];
  for (const b of player.bench) {
    for (const e of b.energyAttached) {
      // v5.682：用 host-aware 述詞 → 古舊/稜鏡(Basic)等「視為水」的特殊能量也算可沖刷來源
      if (energyProvidesType(b, e, 'Water', pool)) {
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
  // 取所有水能量
  // v4.963：用通用 isEnergyOfType helper
  const waterEnergies = src.energyAttached.filter(e => energyProvidesType(src, e, 'Water', pool)); // v5.682 host-aware
  if (waterEnergies.length === 0) return addLog(state, '沖刷：來源無【水】能量', aIdx);
  // v2.389 多張水能量 → modal-choice 讓玩家選 1 張；1 張 fast path
  if (waterEnergies.length > 1) {
    const srcName = pool.get(src.cardId)?.name ?? '?';
    return withPending(
      addLog(state, `沖刷：${srcName} 身上有 ${waterEnergies.length} 張【水】能量，選擇 1 張移出`, aIdx),
      {
        type: 'modal-choice',
        actorIdx: aIdx, sourcePlayerIdx: aIdx,
        minCount: 1, maxCount: 1,
        effectKey: 'walrein-rinse-pick-energy',
        params: {
          label: '沖刷',
          sourceIid,
          energyIids: waterEnergies.map(e => e.iid),
          options: waterEnergies.map((e, i) => ({
            id: `${i}`,
            text: `${i + 1}. ${pool.get(e.cardId)?.name ?? '?'}`,
          })),
        },
      },
    );
  }
  return walreinRinseAttach(state, aIdx, sourceIid, waterEnergies[0].iid, pool);
});

// stage 3 resolver — 玩家選完能量後執行附加
regR('walrein-rinse-pick-energy', (state, aIdx, iids, params, pool) => {
  const choiceIdx = parseInt(iids[0] ?? '0', 10);
  const energyIids = (params?.energyIids as string[] | undefined) ?? [];
  const sourceIid = (params?.sourceIid as string | undefined) ?? '';
  const energyIid = energyIids[choiceIdx];
  if (!sourceIid || !energyIid) return state;
  return walreinRinseAttach(state, aIdx, sourceIid, energyIid, pool);
});

function walreinRinseAttach(
  state: GameState,
  aIdx: 0 | 1,
  sourceIid: string,
  energyIid: string,
  pool: Map<string, import('$lib/cards/types').Card>,
): GameState {
  return updatePlayer(
    addLog(state, '沖刷：將 1 張【水】能量改附戰鬥場', aIdx),
    aIdx, p => {
      const src = p.bench.find(b => b.iid === sourceIid);
      if (!src) return p;
      const waterEnergy = src.energyAttached.find(e => e.iid === energyIid);
      if (!waterEnergy) return p;
      return {
        ...p,
        active: p.active ? {
          ...p.active,
          energyAttached: [...p.active.energyAttached, waterEnergy],
        } : null,
        bench: p.bench.map(b => b.iid === sourceIid ? {
          ...b,
          energyAttached: b.energyAttached.filter(e => e.iid !== energyIid),
        } : b),
      };
    },
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 瑪力露麗ex｜收集泡泡 — 不限次數，場上能量改附自身
// v4.4998：卡面「選擇 1 個自己的場上寶可夢身上附加的能量，改附於這隻寶可夢身上」
//   - 持有者不限位置（active 或 bench）
//   - 來源：場上任何其他寶可夢（active+bench，排除自己 = 改附沒意義）
//   - 目標：這隻持有者（用 inst.iid 找）
// ══════════════════════════════════════════════════════════════════════════════
regA('瑪力露麗ex', 0, (st, idx, pool, inst) => {
  if (!inst) return st;
  const player = st.players[idx];
  // 來源：場上其他寶可夢（不含這隻自己）身上有能量
  const others = [
    ...(player.active && player.active.iid !== inst.iid ? [player.active] : []),
    ...player.bench.filter(b => b.iid !== inst.iid),
  ];
  const sources = others.filter(c => c.energyAttached.length > 0).map(c => c.iid);
  if (sources.length === 0) {
    return addLog(st, '收集泡泡：場上其他寶可夢身上無能量可改附', idx);
  }
  const s = addLog(st, '收集泡泡：選 1 隻其他寶可夢，將其 1 個能量改附瑪力露麗ex', idx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'azumarill-bubble',
    params: { validIids: sources, hostIid: inst.iid },
  });
});
// v4.4998：resolver 全面修 — sourceIid 可在 active 或 bench；目標用 hostIid 找
regR('azumarill-bubble', (state, aIdx, iids, params, pool) => {
  const sourceIid = iids[0];
  const hostIid = (params?.hostIid as string | undefined) ?? '';
  if (!sourceIid || !hostIid) return state;
  const player = state.players[aIdx];
  // 來源可在 active 或 bench
  const src = player.active?.iid === sourceIid ? player.active
            : player.bench.find(b => b.iid === sourceIid);
  if (!src || src.energyAttached.length === 0) return state;
  // v2.389 多張能量 → modal-choice；1 張 fast path
  if (src.energyAttached.length > 1) {
    const srcName = pool.get(src.cardId)?.name ?? '?';
    return withPending(
      addLog(state, `收集泡泡：${srcName} 身上有 ${src.energyAttached.length} 張能量，選擇 1 張移出`, aIdx),
      {
        type: 'modal-choice',
        actorIdx: aIdx, sourcePlayerIdx: aIdx,
        minCount: 1, maxCount: 1,
        effectKey: 'azumarill-bubble-pick-energy',
        params: {
          label: '收集泡泡',
          sourceIid,
          hostIid,
          energyIids: src.energyAttached.map(e => e.iid),
          options: src.energyAttached.map((e, i) => ({
            id: `${i}`,
            text: `${i + 1}. ${pool.get(e.cardId)?.name ?? '?'}`,
          })),
        },
      },
    );
  }
  return azumarillBubbleAttach(state, aIdx, sourceIid, src.energyAttached[0].iid, hostIid);
});

regR('azumarill-bubble-pick-energy', (state, aIdx, iids, params, _pool) => {
  const choiceIdx = parseInt(iids[0] ?? '0', 10);
  const energyIids = (params?.energyIids as string[] | undefined) ?? [];
  const sourceIid = (params?.sourceIid as string | undefined) ?? '';
  const hostIid = (params?.hostIid as string | undefined) ?? '';
  const energyIid = energyIids[choiceIdx];
  if (!sourceIid || !energyIid || !hostIid) return state;
  return azumarillBubbleAttach(state, aIdx, sourceIid, energyIid, hostIid);
});

// v4.4998：sourceIid 可在 active 或 bench；hostIid 同樣可在 active 或 bench
function azumarillBubbleAttach(
  state: GameState,
  aIdx: 0 | 1,
  sourceIid: string,
  energyIid: string,
  hostIid: string,
): GameState {
  return updatePlayer(
    addLog(state, '收集泡泡：將 1 個能量改附瑪力露麗ex', aIdx),
    aIdx, p => {
      // 找來源（active 或 bench）
      const srcInActive = p.active?.iid === sourceIid;
      const src = srcInActive ? p.active! : p.bench.find(b => b.iid === sourceIid);
      if (!src) return p;
      const energy = src.energyAttached.find(e => e.iid === energyIid);
      if (!energy) return p;
      // 找目標（active 或 bench）
      const tgtInActive = p.active?.iid === hostIid;
      // 從來源移除 energy
      const newActive = srcInActive && p.active
        ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => e.iid !== energyIid) }
        : p.active;
      const newBench1 = !srcInActive
        ? p.bench.map(b => b.iid === sourceIid
            ? { ...b, energyAttached: b.energyAttached.filter(e => e.iid !== energyIid) }
            : b)
        : p.bench;
      // 附到目標
      const finalActive = tgtInActive && newActive
        ? { ...newActive, energyAttached: [...newActive.energyAttached, energy] }
        : newActive;
      const finalBench = !tgtInActive
        ? newBench1.map(b => b.iid === hostIid
            ? { ...b, energyAttached: [...b.energyAttached, energy] }
            : b)
        : newBench1;
      return { ...p, active: finalActive, bench: finalBench };
    },
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 青木的樹枕尾熊｜無力充能 — 備戰時可使用，從手牌附 1 能量到戰鬥場「青木的」
// ══════════════════════════════════════════════════════════════════════════════
regA('青木的樹枕尾熊', 0, (st, idx, pool, inst) => {
  if (!inst) return st;
  const player = st.players[idx];
  // gate: 持有者必須在備戰
  if (player.active?.iid === inst.iid) {
    return rejectAbilityUse(st, '無力充能：必須在備戰區才能使用', idx);
  }
  // gate: 戰鬥場必須是「青木的」
  if (!player.active) return rejectAbilityUse(st, '無力充能：戰鬥場無寶可夢', idx);
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
    // v3.62 titleOverride：是「附於戰鬥寶可夢」不是丟棄
    params: { titleOverride: '無力充能：選 1 張手牌能量附於戰鬥寶可夢' },
  });
});
regR('koala-feeble-charge', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const tgtIid = state.players[aIdx].active?.iid;
  const attached = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const energy = p.hand.find(c => c.iid === iids[0]);
    if (!energy) return p;
    return {
      ...p,
      hand: p.hand.filter(c => c.iid !== iids[0]),
      active: { ...p.active, energyAttached: [...p.active.energyAttached, energy] },
    };
  });
  // v5.662：補對手附能反應(侵蝕詛咒/麻痺門牙)
  return tgtIid ? fireOnHandEnergyAttached(applyMagearnaHandAttachHeal(attached, aIdx, [tgtIid], pool), aIdx, tgtIid, pool) : attached;
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
  return addLog(st, '雙重屬性：被動效果（場上時改為【鬥】+【超】2 種屬性）— 已實裝於 engine.ts 弱點/抵抗計算（v2.388）', idx);
});


// ══════════════════════════════════════════════════════════════════════════════
// 以下 3 個 noop regA — 被動特性（無 UI 互動），實作均在 engine.ts / effects.ts hook
//   保留 regA 註冊讓特性顯示在 UI 卡面詳細頁 + 命中 audit map
//   v4.44：清理 v2.38 時代留下的「stub」誤導 log 訊息，改指向真實實作位置
// ══════════════════════════════════════════════════════════════════════════════

// 狙射樹梟ex｜狙擊手之眼 — 對手手牌 4 張時，無【無】能量 cost
//   實裝：effects.ts:12479 getDecidueyeSnipeEffectiveCost + engine.ts:946 canAffordAttack 鉤住（v2.385）
regA('狙射樹梟ex', 0, (st, idx) => addLog(st,
  '狙擊手之眼：被動效果（對手手牌 4 張時消【無】cost）— 已實裝於 engine.ts canAffordAttack（v2.385）', idx));

// 勒克貓｜鬥志戰吼 — 純被動特性（passive）：對手戰鬥場是【ex】寶可夢時，
//   勒克貓 bypass isFirstTurn / justPlaced / evolvedThisTurn 進化成倫琴貓。
//   實裝在 engine.ts EVOLVE handler (L1769/L1784) + getEvolvableTargets UI helper (L5795/L5802/L5815)。
//   v3.56：之前這裡有錯誤的 regA 註冊（v2.38 stub），會讓 UI 顯示「使用特性」按鈕、玩家按下去
//          變「已用特性」但沒有任何進化發生 — 已移除。鬥志戰吼不需要任何主動 regA。

// 耿鬼｜無限之影 — 純被動特性（passive）：受【對手】招式傷害昏厥時本體+進化來源實體卡回手牌。
//   實裝：engine.ts 戰鬥位主傷害 KO 流程 + effects.ts resolveInfiniteShadowKo（戰鬥位/備戰狙擊擴散,v5.934）。
//   v5.936：移除原 v2.385 錯誤的 regA stub（會讓 UI 顯示「使用特性」按鈕、按了變「已用特性」卻無任何效果，
//           比照 v3.56 移除鬥志戰吼錯誤 regA）。無限之影是被動,不需任何主動 regA。

// 堅果啞鈴｜整人擊落 — 對手效果使此卡從牌庫丟棄時，對手牌庫頂 8 張丟棄
//   實裝：_shared.ts:382 triggerOakeyeMillIfApplicable + v2360 mill trigger 點呼叫（v2.388）
regA('堅果啞鈴', 0, (st, idx) => addLog(st,
  '整人擊落：被動效果（對手 mill 此卡時，對手牌庫頂 8 張丟棄）— 已實裝於 _shared.ts triggerOakeyeMillIfApplicable（v2.388）', idx));

// v2.384 真實裝 — 勾帕路翁ex｜金屬之路：本回合從備戰上戰鬥場時，可使用 1 次。
// 選擇場上自己其他寶可夢身上的任意數量【鋼】能量卡，改附於這隻寶可夢身上。
// gate: 必須 inst === active && movedToActiveThisTurn === true && abilityNamesUsedThisTurn 不含此特性
regA('勾帕路翁ex', 0, (st, idx, pool, inst) => {
  if (!inst) return st;
  const player = st.players[idx];
  // gate: 必須在戰鬥場 + 本回合從備戰移到戰鬥場
  if (player.active?.iid !== inst.iid) {
    return rejectAbilityUse(st, '金屬之路：必須在戰鬥場才能使用', idx);
  }
  if (!inst.movedToActiveThisTurn) {
    return rejectAbilityUse(st, '金屬之路：必須在本回合從備戰區放置於戰鬥場時才能使用', idx);
  }
  // v2.471 移除 ad-hoc abilityNamesUsedThisTurn gate（誤把 per-instance 寫成 shared）
  // 卡面：「從備戰區放置於戰鬥場時可使用 1 次」 = per-instance + per-trigger（movedToActiveThisTurn）
  // engine 已用 abilityUsedThisTurn 自動處理一回合 1 次
  // v5.907：收斂到 active-energy-discard(scope='all-own') 個別能量 picker——選備戰任意數量【鋼】能量,
  //   改附勾帕路翁ex(active)。共用 swiftcursor-energy-pick(targetIid=active,只從非 target 抽出→只抽備戰)。
  //   原 heal-target + cobalion-metal-path 只搬 1 張鋼、engine 一回合限 1 次→實際只搬得到 1 張(卡面任意數量)。
  const metalEnergyIids: string[] = [];
  for (const b of player.bench) {
    for (const e of b.energyAttached) {
      if (energyProvidesType(b, e, 'Metal', pool)) metalEnergyIids.push(e.iid); // v5.682 host-aware
    }
  }
  if (metalEnergyIids.length === 0) {
    return rejectAbilityUse(st, '金屬之路：備戰區沒有「鋼」能量可搬', idx);
  }
  const s = addLog(st, '金屬之路：選擇備戰寶可夢身上任意數量【鋼】能量，改附勾帕路翁ex（可跨來源自由選、可不選）', idx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: metalEnergyIids.length,
    effectKey: 'swiftcursor-energy-pick',
    params: {
      scope: 'all-own',
      validIids: metalEnergyIids,
      targetIid: player.active.iid,
      label: '金屬之路',
      titleOverride: '金屬之路：選擇【鋼】能量改附勾帕路翁ex',
    },
  });
});
// v5.907：cobalion-metal-path (heal-target + 每次搬 1 張鋼) 已收斂到 active-energy-discard +
//   swiftcursor-energy-pick(見上方 ability)，移除。


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
  // v2.471 移除 ad-hoc abilityNamesUsedThisTurn gate（誤把 per-instance 寫成 shared）
  // 卡面：「在自己的回合時可使用 1 次」 = per-instance；engine 已用 abilityUsedThisTurn 自動處理
  // 場上 N 隻麻麻鰻 → 各可發動 1 次（user 回報 bug）
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
    return rejectAbilityUse(st, '電氣發電機：備戰區無寶可夢', idx);
  }
  // v2.471 移除 abilityNamesUsedThisTurn 寫入（per-instance gate 由 engine 處理）
  const s = addLog(st, '電氣發電機：從棄牌區選 1 張基本【雷】能量', idx);
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
