/**
 * 白蕾雅 + 赤松（魔靈多龍牌組 Supporter）
 *
 * v2.05 (Session 38b2)：從 effects.ts 抽離，作為模組化首波示範。
 *
 * 這兩張都是訓練家（Supporter），僅依賴：
 *   - 登錄函式：reg / regG / regR
 *   - 純函式：addLog / updatePlayer / withPending / shuffle
 *   - 型別：CardInstance
 *
 * 不涉及攻擊系統（ATTACK_PRE/POST）、特性（ABILITY_EFFECTS）、
 * 道具 / 場地卡 / 被動減傷等機制，因此可以獨立搬出而不影響其他卡。
 */

import type { CardInstance } from '../../types';
import {
  reg, regR, regG,
  addLog, updatePlayer, withPending, shuffle,
} from '../_shared';

// ── 赤松（Supporter） ───────────────────────────────────────────────────────
// 從牌庫搜最多 2 張基本能量；玩家自行決定哪 1 張附加到己方寶可夢、哪 1 張收入手牌。
// 只能搜 1 張能量時（或牌庫只剩 1 張基本能量時），該能量直接附加到寶可夢。
// 洗牌庫。
//
// v2.13 流程重做（Session 38ba）：
//   - 舊版寫死「第 1 張加手牌 / 第 2 張附加」，也不讓玩家決定。官方規則是玩家自選。
//   - 舊版 heal-target 的 UI 標題為「選擇回復的寶可夢」不符情境，改透過
//     `params.titleOverride` 讓 +page.svelte 的 selectionTitle() 顯示對應敘述。
//
// 階段：
//   1. deck-search（基本能量 0/1/2 張）→ 'akamatsu-split'
//   2a. 若 0 張：洗牌庫結束
//   2b. 若 1 張 + 場上有寶可夢：該能量直接進 heal-target 附加流程
//   2c. 若 2 張 + 場上有寶可夢：兩張都先收手牌，再 hand-choose 讓玩家挑 1 張附加
//       （未被挑選的那張自然留在手牌）
//   2d. 場上無寶可夢（罕見邊界）：全部退回手牌當 fallback
regG('赤松', (st, idx, pool) => {
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
});
reg('赤松', (st, idx) => {
  st = addLog(st, '赤松：從牌庫選最多 2 張基本能量（之後自選 1 張附加、另 1 張收手牌）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    // 注意：deck-search filter parser 裡 'Energy:X' 把 X 當成屬性名（Grass/Fire/…）
    // 所以 'Energy:Basic' 會被解讀成「pokemonType === 'Basic'」永遠不中。
    // 要全部基本能量用 'BasicEnergy'（parser 第 653 行的分支）。
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 2,
    effectKey: 'akamatsu-split',
  });
});

regR('akamatsu-split', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(st, '赤松：未選取任何能量（洗回牌庫）', idx);
  }
  const p = st.players[idx];
  const picked = iids
    .map(iid => p.deck.find(c => c.iid === iid))
    .filter((c): c is CardInstance => !!c);
  if (picked.length === 0) return st;

  // 先把選到的能量從牌庫移除、洗牌庫
  st = updatePlayer(st, idx, pl => ({
    ...pl,
    deck: shuffle(pl.deck.filter(c => !iids.includes(c.iid))),
  }));

  const pokes = [st.players[idx].active, ...st.players[idx].bench]
    .filter((c): c is CardInstance => !!c);

  // 場上無寶可夢 → fallback 全部加入手牌
  if (pokes.length === 0) {
    const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `赤松：場上無寶可夢，改將 ${names} 全部加入手牌`, idx);
    return updatePlayer(st, idx, pl => ({ ...pl, hand: [...pl.hand, ...picked] }));
  }

  // 1 張 → 直接附加（不需二階段手牌選擇）
  if (picked.length === 1) {
    const energy = picked[0];
    const eName = pool.get(energy.cardId)?.name ?? '?';
    st = addLog(st, `赤松：選 1 隻己方寶可夢附加 ${eName}`, idx);
    return withPending(st, {
      type: 'heal-target', // 複用 heal-target UI（自己場上寶可夢），標題由 titleOverride 客製
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'akamatsu-attach',
      params: {
        energyInstance: energy,
        validIids: pokes.map(c => c.iid),
        titleOverride: `赤松：選擇要附加 ${eName} 的寶可夢`,
      },
    });
  }

  // 2 張 → 兩張先進手牌，讓玩家用 hand-choose 挑 1 張附加；未挑的那張自然留手牌
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addLog(st, `赤松：${names} 暫時加入手牌，請選 1 張能量附加到寶可夢`, idx);
  st = updatePlayer(st, idx, pl => ({ ...pl, hand: [...pl.hand, ...picked] }));
  return withPending(st, {
    type: 'hand-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'akamatsu-pick-attach',
    params: {
      validIids: picked.map(c => c.iid),
      titleOverride: '赤松：選 1 張能量附加到寶可夢（未選的留在手牌）',
    },
  });
});

// 二階段：hand-choose 後挑出要附加的能量，再進 heal-target 選寶可夢
regR('akamatsu-pick-attach', (st, idx, iids, _params, pool) => {
  const energyIid = iids[0];
  if (!energyIid) return st;
  const energy = st.players[idx].hand.find(c => c.iid === energyIid);
  if (!energy) return st;
  const pokes = [st.players[idx].active, ...st.players[idx].bench]
    .filter((c): c is CardInstance => !!c);
  if (pokes.length === 0) {
    // 邊界：選擇途中寶可夢離場（實際不會發生，pending 阻塞其他行動）— 保守 fallback
    return addLog(st, '赤松：場上無寶可夢可附加，能量留在手牌', idx);
  }
  const eName = pool.get(energy.cardId)?.name ?? '?';
  st = addLog(st, `赤松：選 1 隻己方寶可夢附加 ${eName}（未選能量留手牌）`, idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'akamatsu-attach',
    params: {
      energyIid,  // ← 告訴 resolver 從手牌取
      validIids: pokes.map(c => c.iid),
      titleOverride: `赤松：選擇要附加 ${eName} 的寶可夢`,
    },
  });
});

regR('akamatsu-attach', (st, idx, iids, params, pool) => {
  const validIids = (params?.validIids as string[]) ?? [];
  const targetIid = iids[0];
  // 兩種輸入方式：1 張流程用 energyInstance、2 張流程用 energyIid（從手牌取）
  const energyInstance = params?.energyInstance as CardInstance | undefined;
  const energyIid = params?.energyIid as string | undefined;

  // 從手牌取能量（2 張流程）
  let energy: CardInstance | undefined = energyInstance;
  if (!energy && energyIid) {
    energy = st.players[idx].hand.find(c => c.iid === energyIid);
    if (energy) {
      st = updatePlayer(st, idx, pl => ({
        ...pl,
        hand: pl.hand.filter(c => c.iid !== energyIid),
      }));
    }
  }

  if (!energy || !targetIid || !validIids.includes(targetIid)) {
    if (energy) {
      st = addLog(st, '赤松：目標不合法，能量加入手牌', idx);
      return updatePlayer(st, idx, pl => ({ ...pl, hand: [...pl.hand, energy!] }));
    }
    return st;
  }
  const p = st.players[idx];
  const targetPoke = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  const tName = targetPoke ? (pool.get(targetPoke.cardId)?.name ?? '?') : '?';
  const eName = pool.get(energy.cardId)?.name ?? '?';
  st = addLog(st, `赤松：將 ${eName} 附加到 ${tName}`, idx);
  const energyFinal = energy; // TS narrow
  return updatePlayer(st, idx, pl => {
    if (pl.active?.iid === targetIid) {
      return { ...pl, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, energyFinal] } };
    }
    return { ...pl, bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energyFinal] } : c) };
  });
});

// ── 白蕾雅（Supporter） ─────────────────────────────────────────────────────
// 原文：
//   這張卡只有在對手剩餘獎賞卡的張數為 2 張時才可使用。
//   在這個回合，若對手的戰鬥寶可夢因自己的「太晶」寶可夢使用的招式的傷害而【昏厥】了，
//   則多獲得 1 張獎賞卡。
// 實裝：
//   - regG：對手獎勵牌恰為 2 張時才可打出。
//   - reg ：設 PlayerState.teraKoBonusPrizeThisTurn=true。engine.ts KO 路徑 (attacker 側)
//           檢查本旗標 + 攻擊方 active 是否為「太晶寶可夢」(card.attacks 含 name==='太晶')
//           → prizes +1。END_TURN 於 aIdx 清除旗標。
regG('白蕾雅', (st, idx) => {
  const opp = st.players[1 - idx];
  return opp.prizes.length === 2;
});
reg('白蕾雅', (st, idx) => {
  const opp = st.players[1 - idx];
  if (opp.prizes.length !== 2) {
    return addLog(st, '白蕾雅：對手剩餘獎勵牌不是 2 張，無法使用', idx);
  }
  st = addLog(st, '白蕾雅：本回合若太晶寶可夢招式 KO 對手戰鬥寶可夢 +1 張獎勵牌', idx);
  return updatePlayer(st, idx, pl => ({ ...pl, teraKoBonusPrizeThisTurn: true }));
});
