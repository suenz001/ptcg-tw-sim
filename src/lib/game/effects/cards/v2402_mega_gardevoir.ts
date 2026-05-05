/**
 * v2.42 Bug Fix — 超級沙奈朵ex 兩個招式實裝
 *
 * 問題：超級沙奈朵ex 完全沒有 effect 實裝（既存 codebase 找不到任何 reg/regPre/regPost）
 *   結果：
 *     - 盈溢祈願：damage 字串是 ""（空），引擎 parseInt('','0')=0；effect 不執行 → 不附能量
 *     - 超級交響樂：damage 字串 '50×'，parseInt = 50；無 PRE 實作 → 永遠 50（user 看到 20
 *       是因為對手抵抗力或某些衰減；但本意是 50× 能量數，需主動實作）
 *
 * 卡面：
 *   - 盈溢祈願：[超]，0 傷害；從牌庫附給自己的所有備戰寶可夢各1張「基本【超】能量」卡。並重洗牌庫。
 *   - 超級交響樂：[超]，50×；造成自己的所有寶可夢身上附加的【超】能量的數量×50點傷害。
 *
 * 鐵律：
 *   - 復用 _shared 的 helper（updatePlayer/shuffle/addLog）
 *   - 不動 effects.ts 主檔，獨立檔案 import
 *   - 牌庫不足時依序附前 N 個（與「岩石武裝」/「光環迴響」一致）
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost,
  addLog, updatePlayer, shuffle,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 1. 盈溢祈願 — 0 傷害 + 從牌庫附 1 張基本【超】能量給每隻備戰寶可夢 + 重洗
// ══════════════════════════════════════════════════════════════════════════════
regPre('超級沙奈朵ex|盈溢祈願', (s) => ({ state: s, damage: 0 }));
regPost('超級沙奈朵ex|盈溢祈願', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  if (player.bench.length === 0) {
    return addLog(state, '盈溢祈願：備戰區無寶可夢；牌庫重洗', aIdx);
  }
  // 從牌庫挑出基本【超】能量（pokemonType==='Psychic' 或 名稱含【超】）
  const isBasicPsy = (cardId: string) => {
    const c = pool.get(cardId);
    if (!c) return false;
    if (c.supertype !== 'Energy' || c.subtype !== 'Basic') return false;
    return c.pokemonType === 'Psychic' || /【超】/.test(c.name);
  };
  const psyEnergies = player.deck.filter(c => isBasicPsy(c.cardId));
  if (psyEnergies.length === 0) {
    return addLog(
      updatePlayer(state, aIdx, p => ({ ...p, deck: shuffle(p.deck) })),
      '盈溢祈願：牌庫中無基本【超】能量；牌庫重洗', aIdx,
    );
  }
  // 取前 min(bench.length, 可用能量數) 張，依序附給備戰
  const need = Math.min(player.bench.length, psyEnergies.length);
  const toAttach = psyEnergies.slice(0, need);
  const toAttachIids = new Set(toAttach.map(c => c.iid));
  let s2 = addLog(
    state,
    `盈溢祈願：從牌庫挑 ${need} 張基本【超】能量分別附給 ${need} 隻備戰寶可夢；牌庫重洗`,
    aIdx,
  );
  s2 = updatePlayer(s2, aIdx, p => {
    const remainingDeck = p.deck.filter(c => !toAttachIids.has(c.iid));
    const newBench = p.bench.map((b, i) => {
      if (i < toAttach.length) {
        return { ...b, energyAttached: [...b.energyAttached, toAttach[i]] };
      }
      return b;
    });
    return { ...p, deck: shuffle(remainingDeck), bench: newBench };
  });
  return s2;
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 超級交響樂 — 50 × 自己所有寶可夢身上附加的【超】能量數
// ══════════════════════════════════════════════════════════════════════════════
// 「【超】能量」採取廣義：energy card 的 pokemonType==='Psychic' 即視為【超】
//   （含基本【超】、感應【超】等；若特殊能量 pokemonType 為其他色，
//    本實作不視為【超】，符合多數 ruling）
regPre('超級沙奈朵ex|超級交響樂', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const allOwn: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  let psyCount = 0;
  for (const pk of allOwn) {
    for (const e of pk.energyAttached) {
      const ec = pool.get(e.cardId);
      if (ec?.pokemonType === 'Psychic') psyCount++;
    }
  }
  return { state, damage: psyCount * 50 };
});

// 輔助：unused import 防護
export type _v2402Sentinel = PlayerState;
