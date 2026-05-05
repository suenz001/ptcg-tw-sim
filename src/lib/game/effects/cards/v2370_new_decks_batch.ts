/**
 * v2.37 新牌組批次實裝 — 5 組預設牌組缺失效果補全
 *
 * 涵蓋使用者交付的 5 套新預組（魔靈超級寶石海星 / 寶石猛雷鼓 / 月月熊 赫月 /
 * 岩殿居蟹 / 遠古巨蜓）所需要、且 v2.363 之前尚未補上的寶可夢招式。
 *
 * 不在本檔的部分（已散落於既有實裝，本次無需重做）：
 *   - 雪妖女｜冰冷之帳            engine.ts checkup hook（v2.70 / v2.125）
 *   - 岩殿居蟹｜神秘石居           effects.ts PASSIVE_IMMUNITY（v2.267）
 *   - 純傷害招式（海星星｜水槍 20、雪妖女｜冰霜粉碎 60、蜻蜻蜓｜銳利羽 30、
 *     可達鴨｜衝撞 20、探探鼠｜咬住 10）— 引擎讀 attacks[i].damage 自動處理。
 *
 * 本檔登錄：
 *   A. 石居蟹｜覺醒          0C，自身從牌庫進化為「岩殿居蟹」（覺醒進化招式）
 *   B. 岩殿居蟹｜偉大剪     GCC，120 傷害，不計算對手戰鬥寶可夢身上附加效果
 *   C. 蜻蜻蜓｜吹飛           0C，強制對手將戰鬥寶可夢與備戰互換（由對手選擇）
 *   D. 雷吉奇卡斯｜寶石破壞   CCCC，100；若對手戰鬥場為「太晶」寶可夢則 +230
 *
 * 設計取捨：
 *   - 可達鴨｜濕氣（消除「將自己昏厥的特性」）：屬於極窄條件式特性消除（PTCG 中
 *     僅針對「使用後讓自己昏厥」的特性如桃歹郎ex｜支配鎖鏈），需擴 engine 才能
 *     正確判斷「自我犧牲特性」標記，本波 stub 註解保留，未來實裝。
 *   - 探探鼠｜監視之眼（傷害指示物無法改放）：需新增 ENGINE-level damage-counter
 *     移動 hook（目前 engine 沒有獨立 hook 點），影響範圍小，本波 stub 保留。
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  addLog,
  regPost,
  regPre,
  regR,
  shuffle,
  updatePlayer,
  withPending,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// A. 石居蟹｜覺醒 — 招式驅動「從牌庫直接進化」
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（M2a 013/193）：「從自己的牌庫選擇 1 張從這隻寶可夢進化而來的卡，放置於
//   這隻寶可夢身上完成進化。並且重洗牌庫。」
// cost: ['Colorless']，無傷害。
// ══════════════════════════════════════════════════════════════════════════════
regPre('石居蟹|覺醒', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('石居蟹|覺醒', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  if (!player.active) {
    return addLog(state, '覺醒：戰鬥場無寶可夢', aIdx);
  }
  // 從牌庫挑「evolvesFrom === '石居蟹'」的進化卡（多半是「岩殿居蟹」）
  const validIids = player.deck
    .filter(c => pool.get(c.cardId)?.evolvesFrom === '石居蟹')
    .map(c => c.iid);

  let s = addLog(state,
    validIids.length > 0
      ? '覺醒：從牌庫選 1 張可進化「石居蟹」的進化卡，立即進化於自身'
      : '覺醒：牌庫內無對應的進化卡（仍進行搜尋並重洗）',
    aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Evolution',
    minCount: 0, maxCount: 1,
    effectKey: 'crab-awaken-evolve',
    params: { validIids },
  });
});

regR('crab-awaken-evolve', (state, aIdx, iids, _params, pool) => {
  const player = state.players[aIdx];
  if (iids.length === 0 || !player.active) {
    return updatePlayer(state, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const evoIid = iids[0];
  const evoIdx = player.deck.findIndex(c => c.iid === evoIid);
  if (evoIdx < 0) {
    return addLog(state, '覺醒：找不到所選進化卡，僅重洗牌庫', aIdx);
  }
  const evoInst = player.deck[evoIdx];
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard?.evolvesFrom || evoCard.evolvesFrom !== '石居蟹') {
    return addLog(state, '覺醒：所選非「石居蟹」進化卡，僅重洗牌庫', aIdx);
  }
  const activeCard = pool.get(player.active.cardId);
  if (activeCard?.name !== '石居蟹') {
    return addLog(state, '覺醒：戰鬥場已非石居蟹，僅重洗牌庫', aIdx);
  }

  const base = player.active;
  const evolved: CardInstance = {
    ...evoInst,
    iid: base.iid,
    damage: base.damage,
    energyAttached: base.energyAttached,
    toolAttached: base.toolAttached,
    status: base.status,
    evolvedFromStack: [
      ...(base.evolvedFromStack ?? []),
      {
        ...base,
        iid: `${base.iid}_base_${base.cardId}_${Math.random().toString(36).slice(2, 8)}`,
        toolAttached: undefined,
        energyAttached: [],
        evolvedFromStack: undefined,
      },
    ],
    evolvedThisTurn: true,
    justPlaced: undefined,
    movedToActiveThisTurn: undefined,
    cantAttackThisTurn: undefined,
    cantAttackPending: undefined,
    cantRetreatNextTurn: undefined,
    cantRetreatPendingSelf: undefined,
    damageBonusThisTurn: undefined,
    damageBonusPending: undefined,
    damageReduceNextHit: undefined,
    blockedAttackNamesThisTurn: undefined,
    blockedAttackNamesNextTurn: undefined,
    abilityUsedThisTurn: undefined,
  };

  let s = state;
  s = updatePlayer(s, aIdx, p => ({
    ...p,
    active: evolved,
    deck: shuffle(p.deck.filter((_, i) => i !== evoIdx)),
  }));
  return addLog(s, `覺醒：${evoCard.name} 進化於戰鬥場的石居蟹，並重洗牌庫`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// B. 岩殿居蟹｜偉大剪 — 120 傷害，不計算對手戰鬥寶可夢身上附加效果
// ══════════════════════════════════════════════════════════════════════════════
regPre('岩殿居蟹|偉大剪', (state, _aIdx, _pool) => ({
  state,
  damage: 120,
  skipDefEffects: true,
}));

// ══════════════════════════════════════════════════════════════════════════════
// C. 蜻蜻蜓｜吹飛 — 0 cost C，強制對手將戰鬥/備戰互換（由對手選擇）
// ══════════════════════════════════════════════════════════════════════════════
regPre('蜻蜻蜓|吹飛', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('蜻蜻蜓|吹飛', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  if (!d.active) return state;
  if (d.bench.length === 0) {
    return addLog(state, '吹飛：對手沒有備戰寶可夢可交換', aIdx);
  }
  const s = addLog(state, '吹飛：對手必須將戰鬥寶可夢與備戰寶可夢互換（由對手選擇）', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'force-opp-swap',
    params: { label: '吹飛', attackerIdx: aIdx },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D. 雷吉奇卡斯｜寶石破壞 — 100 + (對手戰鬥場為「太晶」寶可夢時 +230)
// ══════════════════════════════════════════════════════════════════════════════
regPre('雷吉奇卡斯|寶石破壞', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const defCard = def ? pool.get(def.cardId) : undefined;
  const isTera = !!defCard?.tags?.includes('太晶');
  let logged = state;
  if (isTera) {
    logged = addLog(state, '寶石破壞：對手戰鬥場為太晶寶可夢 → +230', aIdx);
  }
  return { state: logged, damage: 100 + (isTera ? 230 : 0) };
});

// stub — 未來實裝（可達鴨｜濕氣、探探鼠｜監視之眼），見檔頭註解
export type _v2370Sentinel = PlayerState;
