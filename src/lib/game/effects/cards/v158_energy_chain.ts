/**
 * v2.158 — 通用「逐張附能量到玩家選的目標寶可夢」chain helper
 *
 * 起因：v2.154 / v2.155 / v2.149 的多張卡（金屬製造者 / 玻璃喇叭 / 燃燒充能 / 電電充能 /
 * 樂呵呵之吻 / X啟動）都有「以任意方式附於 N 隻寶可夢」的卡面，但實裝為「自動附到
 * active 或第 1 隻備戰」的簡化版。Leon 要求升級為符合卡面的玩家自選分配。
 *
 * 設計：複用 v2.89 超級路卡利歐ex｜波動突刺已驗證過的 chain pattern：
 *   1. 能量先從 source（deck 或 discard）移到 attacker.discard 暫存
 *      （deck source 同時 reshuffle）
 *   2. 對第 1 張能量開 poke-picker（依 scope）
 *   3. resolver 將該能量從 discard 移到玩家選的目標
 *   4. 若還有剩餘能量 → 遞迴下一個 picker
 *   5. 場上只有 1 個合法目標時自動全附（避免反覆彈 UI）
 *
 * 兩個 effectKey：
 *   - 'v158-energy-chain-start'：完成能量挑選後的入口（玩家已選 picked 能量 iids）
 *   - 'v158-energy-chain-attach'：picker 選完目標後的單張附加（內部 chain 用）
 *
 * params 結構：
 *   - label              : 招式/特性名（log 用）
 *   - source             : 'deck' | 'discard'  能量原本在哪
 *   - scope              : 'bench-only' | 'any-own'  picker 範圍
 *   - filterType?        : 'Grass'|'Lightning'|'Metal'|'Psychic'|'Colorless'|'Any'
 *                          目標寶可夢屬性（用於可附目標 filter，缺省 'Any'）
 *   - leftoverToDeckBottom?: 玩家放棄沒分配的能量去處（true = 洗回牌庫底；預設 = 留在棄牌區）
 *   - reshuffleDeck?     : 是否在搬完能量後重洗 deck（source='deck' 必為 true）
 *
 * 適用招式（v2.158 升級對象）：
 *   - 燃燒充能（火伊布ex）
 *   - 電電充能（電電蟲）— 草+雷各 ≤2；用兩階段呼叫
 *   - 樂呵呵之吻（迷唇娃）— 卡面是「附於 1 隻備戰」 — 玩家選 1 隻
 *   - 金屬製造者（金屬怪 特性，source='deck top-4'）
 *   - 玻璃喇叭（Item，源於 discard）
 *   - X啟動（大吾的巨金怪ex 特性）
 */

import type { Card } from '$lib/cards/types';
import type { CardInstance, GameState, PlayerState } from '../../types';
import {
  reg, regR, regG, regA, // ts: 雖然這檔不直接 reg 卡片，但仍 export resolver 給其他檔用
  shuffle, addLog, withPending, updatePlayer,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// pokemonType helpers — 判斷寶可夢屬性是否符合 filter
// ══════════════════════════════════════════════════════════════════════════════

type SingleType = 'Grass' | 'Lightning' | 'Metal' | 'Psychic'
  | 'Fire' | 'Water' | 'Fighting' | 'Darkness' | 'Dragon' | 'Colorless';
type EnergyTypeFilter = SingleType | 'Any' | SingleType[];

function pokemonMatchesType(card: Card | undefined, filter: EnergyTypeFilter): boolean {
  if (!card) return false;
  if (filter === 'Any') return true;
  if (Array.isArray(filter)) return filter.includes(card.pokemonType as SingleType);
  return card.pokemonType === filter;
}

// ══════════════════════════════════════════════════════════════════════════════
// 核心 helper：直接呼叫版（給其他模組複用，不透過 RESOLVE_SELECTION）
// ══════════════════════════════════════════════════════════════════════════════
//
// 用法：
//   1. 玩家先用 deck-search/discard-search picker 選 energyIids
//   2. resolver 內呼叫 startEnergyChain(state, aIdx, energyIids, opts, pool)
//   3. helper 處理：能量 source 移動、找合法目標、開 chain picker（或 1 目標自動全附）
//
// 對於非 deck/discard 的特殊 source（如 metagross X啟動 — 從 deck 取特定 iid）
// 呼叫方需自己先把能量搬到 attacker.discard，然後 source 傳 'discard'。
//
export interface EnergyChainOpts {
  label: string;
  source: 'deck' | 'discard';
  scope: 'bench-only' | 'any-own';
  filterType?: EnergyTypeFilter;
}

export function startEnergyChain(
  st: GameState,
  aIdx: 0 | 1,
  energyIids: string[],
  opts: EnergyChainOpts,
  pool: Map<string, Card>,
): GameState {
  const { label, source, scope } = opts;
  const filterType = opts.filterType ?? 'Any';
  const reshuffleDeck = source === 'deck';

  // 玩家未選任何能量 → 結束（仍要 reshuffle deck 若是 deck source）
  if (energyIids.length === 0) {
    if (reshuffleDeck) {
      st = updatePlayer(st, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
    }
    return addLog(st, `${label}：未選擇能量`, aIdx);
  }

  // 把選的能量從 source 取出，先放到 attacker.discard 暫存
  st = updatePlayer(st, aIdx, p => {
    const pickSet = new Set(energyIids);
    if (source === 'deck') {
      const picked = p.deck.filter(c => pickSet.has(c.iid));
      const remaining = p.deck.filter(c => !pickSet.has(c.iid));
      return { ...p, deck: shuffle(remaining), discard: [...p.discard, ...picked] };
    }
    // source === 'discard' 已在 discard 中，無需移動
    return p;
  });

  // 找場上合法目標（依 scope + filterType）
  const player = st.players[aIdx];
  const candidates: CardInstance[] = [];
  if (scope === 'any-own') {
    if (player.active) candidates.push(player.active);
  }
  for (const b of player.bench) candidates.push(b);
  const validTargets = candidates.filter(c => pokemonMatchesType(pool.get(c.cardId), filterType));

  if (validTargets.length === 0) {
    // 場上無合法目標 → 能量留在 discard
    const ftDesc = filterType === 'Any' ? '寶可夢' :
      Array.isArray(filterType) ? filterType.join('/') + ' 寶可夢' :
      filterType + ' 寶可夢';
    return addLog(st,
      `${label}：場上無可附目標（${ftDesc}），${energyIids.length} 張能量留在棄牌區`,
      aIdx);
  }

  // 場上只有 1 個合法目標 → 全附避免反覆彈 UI
  if (validTargets.length === 1) {
    const target = validTargets[0];
    const tname = pool.get(target.cardId)?.name ?? '?';
    st = updatePlayer(st, aIdx, p => {
      const energies = p.discard.filter(c => energyIids.includes(c.iid));
      const remDiscard = p.discard.filter(c => !energyIids.includes(c.iid));
      const attach = (poke: CardInstance) => poke.iid === target.iid
        ? { ...poke, energyAttached: [...poke.energyAttached, ...energies] }
        : poke;
      return {
        ...p,
        discard: remDiscard,
        active: p.active ? attach(p.active) : p.active,
        bench: p.bench.map(attach),
      };
    });
    return addLog(st, `${label}：場上僅有 1 個合法目標 → 全 ${energyIids.length} 張能量附到 ${tname}`, aIdx);
  }

  // 多個合法目標 → 對第 1 張能量開 picker
  const firstEnergy = energyIids[0];
  const remainingEnergies = energyIids.slice(1);
  // 查出第 1 張能量的卡名，用於 UI 標頭
  const firstEnergyInDiscard = st.players[aIdx].discard.find(c => c.iid === firstEnergy);
  const firstEnergyCardName = firstEnergyInDiscard ? (pool.get(firstEnergyInDiscard.cardId)?.name ?? '能量') : '能量';
  st = addLog(st, `${label}：選擇要附第 1 張能量的目標寶可夢（共 ${energyIids.length} 張待附）`, aIdx);
  return withPending(st, {
    type: scope === 'bench-only' ? 'bench-choose' : 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v158-energy-chain-attach',
    params: {
      label, scope, filterType,
      currentEnergy: firstEnergy,
      remainingEnergies,
      titleOverride: `${label}：將「${firstEnergyCardName}」附到哪一隻寶可夢？`,
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Entry：玩家完成能量挑選後 picker resolve → 啟動 chain（薄殼，呼叫 helper）
// ══════════════════════════════════════════════════════════════════════════════
//
// 呼叫方應 withPending({
//   type: 'deck-search'|'discard-search',
//   filter: ...能量 filter...,
//   minCount: 0, maxCount: N,
//   effectKey: 'v158-energy-chain-start',
//   params: { label, source, scope, filterType? }
// })
//
regR('v158-energy-chain-start', (st, aIdx, energyIids, params, pool) => {
  return startEnergyChain(st, aIdx, energyIids, {
    label: String(params?.label ?? '招式'),
    source: (params?.source as 'deck' | 'discard') ?? 'deck',
    scope: (params?.scope as 'bench-only' | 'any-own') ?? 'any-own',
    filterType: params?.filterType as EnergyTypeFilter | undefined,
  }, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Chain step：picker 選完目標 → 附 1 張能量；若還有剩餘 → 遞迴下一個 picker
// ══════════════════════════════════════════════════════════════════════════════
regR('v158-energy-chain-attach', (st, aIdx, iids, params, pool) => {
  const label = String(params?.label ?? '招式');
  const scope = (params?.scope as 'bench-only' | 'any-own') ?? 'any-own';
  const filterType = (params?.filterType as EnergyTypeFilter | undefined) ?? 'Any';
  const currentEnergy = String(params?.currentEnergy ?? '');
  const remainingEnergies = (params?.remainingEnergies as string[]) ?? [];
  const targetIid = iids[0];

  // 場上找目標
  const player = st.players[aIdx];
  const target = player.active?.iid === targetIid
    ? player.active
    : player.bench.find(c => c.iid === targetIid);
  const energyInst = player.discard.find(c => c.iid === currentEnergy);

  if (!target || !energyInst) {
    // 防呆：目標或能量已不存在
    return addLog(st, `${label}：目標或能量遺失，略過此張`, aIdx);
  }

  // 檢查 filter（玩家不應選不合法的目標，但仍校驗）
  const tcard = pool.get(target.cardId);
  if (!pokemonMatchesType(tcard, filterType)) {
    return addLog(st, `${label}：${tcard?.name ?? '?'} 不符屬性 filter，略過此張`, aIdx);
  }

  // 把能量從 discard 移到目標
  st = updatePlayer(st, aIdx, p => {
    const newDiscard = p.discard.filter(c => c.iid !== currentEnergy);
    const attach = (poke: CardInstance) => poke.iid === targetIid
      ? { ...poke, energyAttached: [...poke.energyAttached, energyInst] }
      : poke;
    return {
      ...p,
      discard: newDiscard,
      active: p.active ? attach(p.active) : p.active,
      bench: p.bench.map(attach),
    };
  });
  st = addLog(st, `${label}：1 張能量附到 ${tcard?.name ?? '?'}`, aIdx);

  // 還有剩餘能量 → 開下一個 picker
  if (remainingEnergies.length === 0) return st;

  // 重新計算合法目標（因為前面附完可能不變但仍 defensive）
  const candidates: CardInstance[] = [];
  if (scope === 'any-own') {
    if (st.players[aIdx].active) candidates.push(st.players[aIdx].active!);
  }
  for (const b of st.players[aIdx].bench) candidates.push(b);
  const validTargets = candidates.filter(c => pokemonMatchesType(pool.get(c.cardId), filterType));

  if (validTargets.length === 0) {
    return addLog(st, `${label}：場上已無合法目標，剩 ${remainingEnergies.length} 張能量留在棄牌區`, aIdx);
  }
  if (validTargets.length === 1) {
    const onlyTarget = validTargets[0];
    const oname = pool.get(onlyTarget.cardId)?.name ?? '?';
    st = updatePlayer(st, aIdx, p => {
      const energies = p.discard.filter(c => remainingEnergies.includes(c.iid));
      const remDiscard = p.discard.filter(c => !remainingEnergies.includes(c.iid));
      const attach = (poke: CardInstance) => poke.iid === onlyTarget.iid
        ? { ...poke, energyAttached: [...poke.energyAttached, ...energies] }
        : poke;
      return {
        ...p,
        discard: remDiscard,
        active: p.active ? attach(p.active) : p.active,
        bench: p.bench.map(attach),
      };
    });
    return addLog(st, `${label}：場上僅剩 1 個合法目標 → 剩 ${remainingEnergies.length} 張能量全附到 ${oname}`, aIdx);
  }

  // 多目標 → 對下一張開 picker（chain）
  const next = remainingEnergies[0];
  const rest = remainingEnergies.slice(1);
  // 查出下一張能量的卡名，用於 UI 標頭
  const nextEnergyInDiscard = st.players[aIdx].discard.find(c => c.iid === next);
  const nextEnergyCardName = nextEnergyInDiscard ? (pool.get(nextEnergyInDiscard.cardId)?.name ?? '能量') : '能量';
  st = addLog(st, `${label}：選擇下一張能量目標（剩 ${remainingEnergies.length} 張待附）`, aIdx);
  return withPending(st, {
    type: scope === 'bench-only' ? 'bench-choose' : 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v158-energy-chain-attach',
    params: {
      label, scope, filterType,
      currentEnergy: next,
      remainingEnergies: rest,
      titleOverride: `${label}：將「${nextEnergyCardName}」附到哪一隻寶可夢？`,
    },
  });
});

// 防止「unused import」warning（reg/regG/regA 被 import 是為了未來可能加掛點）
void reg; void regG; void regA;
