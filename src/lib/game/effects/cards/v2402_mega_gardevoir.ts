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
  // v3.22 加 log：列出每隻備戰是否實際附到能量，方便用戶 debug「漏掉一隻」回報。
  // 卡面：「附給自己的所有備戰寶可夢各 1 張」— 嚴格只指備戰，不含 active。
  // 若 bench.length === 4 且 deck 有 ≥ 4 張基本【超】能量 → need=4 → 4 隻全部附。
  const need = Math.min(player.bench.length, psyEnergies.length);
  const toAttach = psyEnergies.slice(0, need);
  const toAttachIids = new Set(toAttach.map(c => c.iid));
  // 預先組裝詳細 log（在 updatePlayer 前算好，以免 callback 內 ref 不一致）
  const benchNames = player.bench.map((b) => {
    const cardName = pool.get(b.cardId)?.name ?? '?';
    return cardName;
  });
  const detailLines: string[] = [];
  for (let i = 0; i < player.bench.length; i++) {
    if (i < toAttach.length) {
      detailLines.push(`  → 備戰[${i+1}] ${benchNames[i]} +1 基本【超】能量`);
    } else {
      detailLines.push(`  → 備戰[${i+1}] ${benchNames[i]} 未附（牌庫能量不足）`);
    }
  }
  let s2 = addLog(
    state,
    `盈溢祈願：備戰 ${player.bench.length} 隻 / 牌庫【超】能量 ${psyEnergies.length} 張 → 附 ${need} 張；牌庫重洗`,
    aIdx,
  );
  for (const line of detailLines) {
    s2 = addLog(s2, line, aIdx);
  }
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
// v3.23 修 bug：原本用 pokemonType==='Psychic' 判定，但 JSON 內 *所有能量* pokemonType
//   都是 'None'（基本能量從卡名解析、特殊能量看 SPECIAL_ENERGY_TYPES 表），所以該檢查
//   永遠 false → psyCount=0 → 永遠 0 傷害！
//
// 卡面：「造成自己的所有寶可夢身上附加的【超】能量的數量×50 點傷害」— 廣義包含：
//   - 基本【超】能量（名稱含【超】）
//   - 感應【超】能量（特殊能量但提供【超】type）
//   - 火箭隊能量（提供【超】+【惡】，計 1 unit）
//   - 古舊能量（全屬性）
//   - 稜鏡能量（附進化卡時全屬性，這裡簡化為 false 避免條件式複雜）
//
// 改用 cardName check（既能涵蓋基本【超】，也能涵蓋常見特殊能量；不到 SPECIAL_ENERGY_TYPES
// 因為跨 effects.ts → engine.ts 循環 import 風險，採取 inline list 簡化）
regPre('超級沙奈朵ex|超級交響樂', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const allOwn: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  // 提供【超】type 的能量名稱集合（簡化版本）
  const PSY_PROVIDERS = new Set([
    '感應【超】能量',  // 特殊能量，提供 1【超】
    '火箭隊能量',      // 特殊能量，提供 1【超】+1【惡】
    '古舊能量',        // ACE SPEC，全屬性
  ]);
  let psyCount = 0;
  for (const pk of allOwn) {
    for (const e of pk.energyAttached) {
      const ec = pool.get(e.cardId);
      if (!ec) continue;
      // 基本能量：卡名含【超】（最常見的「基本【超】能量」）
      if (ec.supertype === 'Energy' && ec.subtype === 'Basic') {
        if (/【超】/.test(ec.name)) psyCount++;
        continue;
      }
      // 特殊能量：白名單檢查
      if (ec.supertype === 'Energy' && PSY_PROVIDERS.has(ec.name)) psyCount++;
    }
  }
  return { state, damage: psyCount * 50 };
});

// 輔助：unused import 防護
export type _v2402Sentinel = PlayerState;
