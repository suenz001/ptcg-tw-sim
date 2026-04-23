/**
 * 特殊能量卡（Special Energy）模組 — 模組化 v2.66
 *
 * 從 effects.ts 抽出所有 SPECIAL_ENERGY_ATTACH hook 到此檔：
 *   - 富裕能量（ACE SPEC）：附加時抽 4 張
 *   - 感應【超】能量：附加到【超】寶可夢時搜牌庫放基礎【超】到備戰（至多 2 隻）
 *   - 火箭隊能量：附加到非「火箭隊的」寶可夢時自動丟棄（gate）
 *
 * SPECIAL_ENERGY_ATTACH map 已移至 _shared.ts；engine.ts 透過 effects.ts re-export 取用。
 */

import type { CardInstance } from '../../types';
import {
  SPECIAL_ENERGY_ATTACH,
  addLog, drawCards, updatePlayer, withPending,
} from '../_shared';

// ── 富裕能量（ACE SPEC Special Energy） ─────────────────────────────────────
// 卡面：提供 1 個【無】能量。從手牌附加到你的任 1 隻寶可夢時，抽 4 張卡。
// Hook：SPECIAL_ENERGY_ATTACH，engine ATTACH_ENERGY 附加後呼叫。
SPECIAL_ENERGY_ATTACH.set('富裕能量', (st, idx) => {
  const s = addLog(st, '富裕能量：從牌庫抽 4 張', idx);
  return drawCards(s, idx, 4);
});

// ── 感應【超】能量（Special Energy） ────────────────────────────────────────
// 卡面：提供 1 個【超】能量。從手牌附加到你的【超】寶可夢時，
//      可從牌庫搜尋至多 2 張基礎【超】寶可夢放備戰並重洗牌庫。
// Hook：SPECIAL_ENERGY_ATTACH；先驗證 target 是【超】才進 pending。
SPECIAL_ENERGY_ATTACH.set('感應【超】能量', (st, idx, targetIid, pool) => {
  const p = st.players[idx];
  const target = p.active?.iid === targetIid
    ? p.active
    : p.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  if (targetCard?.pokemonType !== 'Psychic') {
    // 附加到非【超】寶可夢時不觸發搜索效果
    return st;
  }
  // 備戰空位
  const benchSlots = 5 - p.bench.length;
  if (benchSlots <= 0) {
    return addLog(st, '感應【超】能量：備戰區已滿，略過搜尋', idx);
  }
  // 牌庫要有基礎【超】寶可夢
  const hasPsychicBasic = p.deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon'
      && !card.evolvesFrom && card.pokemonType === 'Psychic';
  });
  if (!hasPsychicBasic) {
    return addLog(st, '感應【超】能量：牌庫沒有基礎【超】寶可夢', idx);
  }
  const takeMax = Math.min(2, benchSlots);
  const s = addLog(st, `感應【超】能量：從牌庫選至多 ${takeMax} 隻基礎【超】寶可夢到備戰區`, idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PsychicBasic',
    minCount: 0, maxCount: takeMax,
    effectKey: 'bench-basic-from-deck',
  });
});

// ── 火箭隊能量（Special Energy） ─────────────────────────────────────────────
// 卡面文字：這張卡只可附於「火箭隊的寶可夢」身上，若附於「火箭隊的寶可夢」以外的
//   寶可夢身上，則將其丟棄。只要這張卡附於寶可夢身上，視為提供 2 個【超】【惡】2 種
//   屬性的能量。
// 實裝：
//   - 屬性：engine.ts SPECIAL_ENERGY_TYPES 已加 ['Psychic','Darkness'] = 2 單位。
//   - Gate：若 target 名稱不含「火箭隊的」→ 把已附加的火箭隊能量從 target 移到棄牌區。
SPECIAL_ENERGY_ATTACH.set('火箭隊能量', (st, idx, targetIid, pool) => {
  const p = st.players[idx];
  const target = p.active?.iid === targetIid
    ? p.active
    : p.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  const targetName = targetCard?.name ?? '?';
  if (targetName.includes('火箭隊的')) return st; // 合法附加
  // 非火箭隊寶可夢 → 已附加的火箭隊能量丟棄
  const rocketEnergyInst = target.energyAttached.find(e => pool.get(e.cardId)?.name === '火箭隊能量');
  if (!rocketEnergyInst) return st;
  const s = addLog(st, `火箭隊能量：${targetName} 不是「火箭隊的寶可夢」，火箭隊能量丟棄`, idx);
  return updatePlayer(s, idx, pl => {
    const removeFromEnergy = (c: CardInstance) => ({
      ...c, energyAttached: c.energyAttached.filter(e => e.iid !== rocketEnergyInst.iid)
    });
    let active = pl.active;
    if (active?.iid === targetIid) active = removeFromEnergy(active);
    const bench = pl.bench.map(c => c.iid === targetIid ? removeFromEnergy(c) : c);
    return { ...pl, active, bench, discard: [...pl.discard, rocketEnergyInst] };
  });
});
