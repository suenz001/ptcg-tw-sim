/**
 * v2.42 Bug Fix — 超級沙奈朵ex 兩個招式實裝
 * v3.23 修 bug — 超級交響樂 0 傷害（pokemonType==='Psychic' 對基本能量恆 false）
 * v3.25 改寫 — 盈溢祈願拆成 2-stage 玩家自選 picker（卡面「以任意方式附」必須由玩家選）
 *
 * 卡面：
 *   - 盈溢祈願（[超]，0 傷害）：從牌庫選擇任意數量的『基本【超】能量』卡，以任意方式附於
 *     自己的備戰寶可夢身上。然後，重洗牌庫。
 *   - 超級交響樂（[超]，50×）：造成自己的所有寶可夢身上附加的【超】能量的數量×50 點傷害。
 *
 * v3.25 盈溢祈願流程（兩段 picker，玩家全程自選）：
 *   Stage 1 (deck-search, filter='Energy:Psychic')：
 *     玩家從牌庫挑 0 ~ min(bench.length, 牌庫基本【超】能量數) 張。0 張 = 不附（合法）。
 *   Stage 2 (bench-choose, min=max=N)：
 *     玩家依序挑同數量備戰寶可夢；picker UI 以 Set 保證 N 隻彼此不同（每隻最多 1 顆）。
 *   配對：stage1.picked[i] → stage2.picked[i]（依點選順序），各附 1 顆。
 *   收尾：移除牌庫對應能量、附給對應備戰、重洗牌庫。
 *
 * 鐵律：
 *   - 復用 _shared 的 helper（updatePlayer/shuffle/addLog/withPending/regR）
 *   - 不動 effects.ts 主檔；resolver 透過 regR 註冊到 _shared 內 RESOLVERS Map（無 TDZ）
 *   - bench=0 / 牌庫無【超】能量 / 玩家選 0 張 — 三種邊界皆只 log + 重洗牌庫
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost, regR,
  addLog, updatePlayer, shuffle, withPending,
} from '../_shared';
import { countEnergy } from '../../engine';

// ══════════════════════════════════════════════════════════════════════════════
// 1. 盈溢祈願 — 0 傷害；玩家自選 N 張基本【超】能量 → 自選 N 隻備戰附加（順序配對）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「從牌庫選擇任意數量的『基本【超】能量』卡，以任意方式附於自己的備戰寶可夢身上。
//        然後，重洗牌庫。」
//
// v3.25 改寫：原 v2.42 實裝是「自動附 — 取前 N 張基本【超】能量、依 bench 順序附」，
//   不給玩家選的機會（違反卡面「以任意方式」字樣）。改為兩段 picker：
//
//   Stage 1：玩家從牌庫挑 0 ~ min(bench.length, 牌庫基本【超】能量數) 張基本【超】能量。
//     - filter='Energy:Psychic'（既有 deck-search filter；isBasicEnergyOfType 的
//       Psychic 分支同時涵蓋 pokemonType==='Psychic' 與卡名含【超】兩條 fallback）。
//     - 額外用 params.validIids 雙保險限定候選池為當前 bench/deck 計算出的合法集合。
//     - minCount=0 允許玩家完全不附（卡面「任意數量」含 0）。
//
//   Stage 2：玩家挑同數量的備戰寶可夢（bench-choose；min=max=N）。
//     - bench-choose picker 以 Set 維護 selectedIids，同一 iid 最多只能被選一次
//       → 強制 N 隻彼此不同的備戰，不會重複。
//     - 配對規則：stage1.picked[i] → stage2.picked[i]（依玩家點選順序）。
//
//   收尾：把 stage1 的能量從牌庫移除、依配對附給 stage2 的備戰，最後重洗牌庫。
//
// 邊界：
//   - bench=0 → 無法附加，僅 log + 重洗牌庫（同 v2.42）。
//   - 牌庫無基本【超】能量 → 同樣僅 log + 重洗牌庫。
//   - Stage 1 玩家選 0 張 → log「未選擇」+ 重洗牌庫（不開 Stage 2）。
regPre('超級沙奈朵ex|盈溢祈願', (s) => ({ state: s, damage: 0 }));

// 共用：判定一張卡是否為基本【超】能量（與 v2.42 / v3.23 邏輯一致；保留以利重用）
function isBasicPsy(cardId: string, pool: Map<string, import('$lib/cards/types').Card>): boolean {
  const c = pool.get(cardId);
  if (!c) return false;
  if (c.supertype !== 'Energy' || c.subtype !== 'Basic') return false;
  return c.pokemonType === 'Psychic' || /【超】/.test(c.name);
}

regPost('超級沙奈朵ex|盈溢祈願', (state, aIdx, pool) => {
  const player = state.players[aIdx];

  // 邊界 1：備戰區無寶可夢 → 沒有附加目標，只重洗牌庫。
  if (player.bench.length === 0) {
    const s = updatePlayer(state, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(s, '盈溢祈願：備戰區無寶可夢；牌庫重洗', aIdx);
  }

  // 計算牌庫中可選的基本【超】能量
  const psyEnergies = player.deck.filter(c => isBasicPsy(c.cardId, pool));

  // 邊界 2：牌庫無基本【超】能量 → 重洗 + 結束（仍給玩家可看到牌庫的機會 — 但這裡為了
  //   貼近 v2.42 行為與 picker UX 簡潔，直接 skip 不開 picker）
  if (psyEnergies.length === 0) {
    // v5.495：牌庫非空仍開 view-picker 讓玩家檢視整副牌庫 + 重洗（PTCG 隱藏資訊規則）。
    if (player.deck.length === 0) return addLog(state, '盈溢祈願：牌庫已空', aIdx);
    const sv = addLog(state, '盈溢祈願：牌庫中無基本【超】能量；檢視牌庫後重洗', aIdx);
    return withPending(sv, {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'any', minCount: 0, maxCount: 0,
      effectKey: 'search-to-hand-reshuffle',
      params: { label: '盈溢祈願（檢視牌庫）' },
    });
  }

  // Stage 1 picker：選 0 ~ min(bench.length, psyEnergies.length) 張基本【超】能量
  const maxPick = Math.min(player.bench.length, psyEnergies.length);
  const validIids = psyEnergies.map(c => c.iid);
  const s1 = addLog(
    state,
    `盈溢祈願：從牌庫選 0~${maxPick} 張『基本【超】能量』（之後再選同數量的備戰附加）`,
    aIdx,
  );
  return withPending(s1, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Energy:Psychic',
    minCount: 0,
    maxCount: maxPick,
    effectKey: 'mega-gardevoir-overflow-prayer-stage1',
    params: { validIids },
  });
});

// Stage 1 resolver：玩家確定 N 張能量 → 開 Stage 2 bench-choose（min=max=N）
regR('mega-gardevoir-overflow-prayer-stage1', (state, idx, energyIids, _params, _pool) => {
  // 玩家若選 0 張 → 結束（卡面允許「任意數量」含 0）
  if (energyIids.length === 0) {
    const s = updatePlayer(state, idx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(s, '盈溢祈願：未選擇能量；牌庫重洗', idx);
  }
  const player = state.players[idx];
  // 防呆：若 bench 在 stage1 中途消失（不太可能但保守處理）— 直接重洗結束
  if (player.bench.length === 0) {
    const s = updatePlayer(state, idx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(s, '盈溢祈願：備戰區無寶可夢；牌庫重洗', idx);
  }
  // bench-choose picker — minCount === maxCount === energyIids.length 強制玩家挑 N 隻
  // 不重複的備戰寶可夢；UI 內部以 Set 維護 selectedIids 自動保證不重複。
  const need = energyIids.length;
  const benchIids = player.bench.map(b => b.iid);
  const s = addLog(
    state,
    `盈溢祈願：已挑 ${need} 張【超】能量，請依序選擇 ${need} 隻備戰寶可夢（每隻最多 1 顆，不重複）`,
    idx,
  );
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: idx,
    sourcePlayerIdx: idx,
    minCount: need,
    maxCount: need,
    effectKey: 'mega-gardevoir-overflow-prayer-stage2',
    params: { energyIids, validIids: benchIids },
  });
});

// Stage 2 resolver：依「點選順序」配對 stage1[i] → stage2[i]，附加並重洗牌庫
regR('mega-gardevoir-overflow-prayer-stage2', (state, idx, benchIids, params, pool) => {
  const energyIids = (params?.energyIids as string[] | undefined) ?? [];
  const player = state.players[idx];

  // 防呆：兩端數量不一致 → 直接重洗（理論上不會發生）
  if (energyIids.length === 0 || benchIids.length === 0
      || energyIids.length !== benchIids.length) {
    const s = updatePlayer(state, idx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(s, '盈溢祈願：選擇異常，未附加能量；牌庫重洗', idx);
  }

  // 重新從 deck 撈出對應 CardInstance（依 energyIids 順序）
  // 注意：picker 回傳的 iids 為使用者點選順序，需保留 → 用 indexOf-style 重排
  const energyByIid = new Map(player.deck.filter(c => energyIids.includes(c.iid)).map(c => [c.iid, c]));
  const orderedEnergies: import('../../types').CardInstance[] = [];
  for (const iid of energyIids) {
    const e = energyByIid.get(iid);
    if (e) orderedEnergies.push(e);
  }
  if (orderedEnergies.length !== energyIids.length) {
    // 牌庫中找不到全部 energyIids（理論上不會發生）→ 重洗結束
    const s = updatePlayer(state, idx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(s, '盈溢祈願：能量同步異常，未附加；牌庫重洗', idx);
  }

  // 建配對 log（每對 (能量名 → 備戰名)）
  const pairs: Array<{ eName: string; bName: string; bIid: string; energy: import('../../types').CardInstance }> = [];
  for (let i = 0; i < orderedEnergies.length; i++) {
    const e = orderedEnergies[i];
    const bIid = benchIids[i];
    const benchInst = player.bench.find(b => b.iid === bIid);
    const eName = pool.get(e.cardId)?.name ?? '?';
    const bName = benchInst ? (pool.get(benchInst.cardId)?.name ?? '?') : '?';
    pairs.push({ eName, bName, bIid, energy: e });
  }

  // 主 log + 詳細配對 log
  let s2 = addLog(
    state,
    `盈溢祈願：附加 ${pairs.length} 張基本【超】能量到備戰寶可夢；牌庫重洗`,
    idx,
  );
  for (let i = 0; i < pairs.length; i++) {
    const { eName, bName } = pairs[i];
    s2 = addLog(s2, `  → [${i + 1}] ${eName} → ${bName}`, idx);
  }

  // 套用：移除牌庫對應 energy + 對應 bench iid 各加 1 顆能量 + 洗牌
  const energyIidSet = new Set(energyIids);
  // 為每個 bench iid 建立 attach 列表（順序配對；不同 bench 各拿各的能量）
  const attachByBench = new Map<string, import('../../types').CardInstance[]>();
  for (const { bIid, energy } of pairs) {
    if (!attachByBench.has(bIid)) attachByBench.set(bIid, []);
    attachByBench.get(bIid)!.push(energy);
  }

  s2 = updatePlayer(s2, idx, p => {
    const remainingDeck = p.deck.filter(c => !energyIidSet.has(c.iid));
    const newBench = p.bench.map(b => {
      const toAttach = attachByBench.get(b.iid);
      if (!toAttach || toAttach.length === 0) return b;
      return { ...b, energyAttached: [...b.energyAttached, ...toAttach] };
    });
    return { ...p, deck: shuffle(remainingDeck), bench: newBench };
  });
  return s2;
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 超級交響樂 — 50 × 自己所有寶可夢身上附加的【超】能量數
// ══════════════════════════════════════════════════════════════════════════════
// v4.797：改用 engine.countEnergy（host-aware）— 涵蓋新衝天能量等特殊能量
//   背景：超級沙奈朵 ex 是 Stage2 ex (超級進化)，可附新衝天能量（提供任意屬性 ×2）。
//   v3.23 inline whitelist 沒認新衝天 → 漏算 2【超】。
//   countEnergy 內建 host-aware 處理（同 v4.796 巨型花束修法）。
regPre('超級沙奈朵ex|超級交響樂', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const allOwn: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  let psyCount = 0;
  for (const pk of allOwn) {
    psyCount += countEnergy(pk, pool).get('Psychic') ?? 0;
  }
  const dmg = psyCount * 50;
  return {
    state: addLog(state, `超級交響樂：自方全場【超】能量 ${psyCount} 個（含特殊能量提供的超單位）→ ${dmg}`, aIdx),
    damage: dmg,
  };
});

// 輔助：unused import 防護
export type _v2402Sentinel = PlayerState;
