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

import type { CardInstance, SpecialCondition } from '../../types';
import {
  SPECIAL_ENERGY_ATTACH,
  SPECIAL_ENERGY_HP_BONUS,
  SPECIAL_ENERGY_RETREAT_MOD,
  SPECIAL_ENERGY_STATUS_IMMUNE,
  SPECIAL_ENERGY_ON_DAMAGED,
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
  // 牌庫要有卡
  const hasPsychicBasic = p.deck.length > 0;
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

// ── 增強【草】能量（Special Energy） ──────────────────────────────────────────
// 卡面：提供 1 個【草】能量。附於【草】寶可夢時，HP 上限 +20。
// Hook：SPECIAL_ENERGY_HP_BONUS（engine getEffectiveHP 與 effects.ts effectiveHPInline）。
SPECIAL_ENERGY_HP_BONUS.set('增強【草】能量', (holder) => {
  return holder.pokemonType === 'Grass' ? 20 : 0;
});

// ── 磁鐵【鋼】能量（Special Energy） ──────────────────────────────────────────
// 卡面：提供 1 個【鋼】能量。附於【鋼】寶可夢時，撤退所需能量為 0。
// Hook：SPECIAL_ENERGY_RETREAT_MOD（engine RETREAT 計費前覆蓋）。
SPECIAL_ENERGY_RETREAT_MOD.set('磁鐵【鋼】能量', (holder) => {
  if (holder.pokemonType === 'Metal') return { zero: true };
  return {};
});

// ── 扣殺能量（Special Energy） ────────────────────────────────────────────────
// 卡面：提供 1 個【無】能量。只要這張卡附於戰鬥場的寶可夢身上，
//   每當受到攻擊方招式造成的傷害（即使 HP 減為 0），對攻擊方戰鬥寶可夢
//   放置 2 個傷害指示物（共 20 點）。
// 實裝採取「holder 在 dIdx 的戰鬥場時，反彈 20 給 aIdx 戰鬥寶可夢」。
SPECIAL_ENERGY_ON_DAMAGED.set('扣殺能量', (state, dIdx, aIdx, _damage, _pool) => {
  // engine 已限定只在「holder 是戰鬥場 + 受傷 > 0」時呼叫此 hook
  const s = addLog(state, '扣殺能量：對攻擊方戰鬥寶可夢放置 2 個傷害指示物（+20）', dIdx);
  return updatePlayer(s, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + 20 } };
  });
});

// ── 泡沫【水】能量（Special Energy） ──────────────────────────────────────────
// 卡面（M4.json + 官網 https://asia.pokemon-card.com/tw/card-search/detail/18502/）：
//   「附有這張卡的【水】寶可夢不會陷入特殊狀態，並將受到的特殊狀態全部恢復。」
// Hook：SPECIAL_ENERGY_STATUS_IMMUNE（engine 在施加狀態時若 holder 命中則略過）。
// v4.995 修：之前只回 {poisoned, burned} 兩種，違背卡面（應全 5 種特殊狀態都免疫）。
//   玩家回報「附泡沫後仍被睡眠 / 混亂 / 麻痺」是這個 bug 的直接結果。
// 註：卡面後半「將受到的特殊狀態全部恢復」(on-attach 全清) 仍待實裝，
//   要在 ATTACH_ENERGY handler 後加 clearSpecialEnergyProtectedStatuses helper（v4.996+）。
SPECIAL_ENERGY_STATUS_IMMUNE.set('泡沫【水】能量', (holder) => {
  if (holder.pokemonType !== 'Water') return new Set<SpecialCondition>();
  return new Set<SpecialCondition>(['poisoned', 'burned', 'asleep', 'confused', 'paralyzed']);
});

