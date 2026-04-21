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
// 從牌庫搜最多 2 張基本能量，1 張加手牌、另 1 張附加到己方 1 隻寶可夢身上，然後洗牌庫。
// 兩階段流程：
//   1. deck-search（最多 2 張基本能量，可選 0/1/2 張）→ 'akamatsu-split'
//   2. 若選到 2 張：第 1 張加手牌後，另 1 張進入 'akamatsu-attach' pending（選己方寶可夢）
//      若選到 0 或 1 張：直接加入手牌結束。
regG('赤松', (st, idx, pool) => {
  return st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
});
reg('赤松', (st, idx) => {
  st = addLog(st, '赤松：從牌庫選最多 2 張基本能量（1 張加手牌 + 1 張附加寶可夢）', idx);
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
  // 第 1 張：固定加入手牌
  const p = st.players[idx];
  const first = p.deck.find(c => c.iid === iids[0]);
  const second = iids[1] ? p.deck.find(c => c.iid === iids[1]) : undefined;
  if (!first) return st;
  const firstName = pool.get(first.cardId)?.name ?? '?';
  st = addLog(st, `赤松：將 ${firstName} 加入手牌`, idx);
  st = updatePlayer(st, idx, pl => ({
    ...pl,
    deck: shuffle(pl.deck.filter(c => !iids.includes(c.iid))),
    hand: [...pl.hand, first],
  }));
  if (!second) return st;
  // 第 2 張：暫存到 pending params，讓玩家選要附加給哪隻寶可夢
  const pokes = [st.players[idx].active, ...st.players[idx].bench]
    .filter((c): c is CardInstance => !!c);
  if (pokes.length === 0) {
    // 場上無寶可夢 → 第 2 張也加入手牌作 fallback
    const secondName = pool.get(second.cardId)?.name ?? '?';
    st = addLog(st, `赤松：場上無寶可夢，改將 ${secondName} 一併加入手牌`, idx);
    return updatePlayer(st, idx, pl => ({ ...pl, hand: [...pl.hand, second] }));
  }
  const secondName = pool.get(second.cardId)?.name ?? '?';
  st = addLog(st, `赤松：選 1 隻己方寶可夢附加 ${secondName}`, idx);
  return withPending(st, {
    type: 'heal-target', // 複用 heal-target UI 選自己寶可夢
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'akamatsu-attach',
    params: { energyInstance: second, validIids: pokes.map(c => c.iid) },
  });
});

regR('akamatsu-attach', (st, idx, iids, params, pool) => {
  const energy = params?.energyInstance as CardInstance | undefined;
  const validIids = (params?.validIids as string[]) ?? [];
  const targetIid = iids[0];
  if (!energy || !targetIid || !validIids.includes(targetIid)) {
    // 目標不合法 → 把能量塞回手牌避免卡牌遺失
    if (energy) {
      st = addLog(st, '赤松：目標不合法，能量加入手牌', idx);
      return updatePlayer(st, idx, pl => ({ ...pl, hand: [...pl.hand, energy] }));
    }
    return st;
  }
  const p = st.players[idx];
  const targetPoke = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  const tName = targetPoke ? (pool.get(targetPoke.cardId)?.name ?? '?') : '?';
  const eName = pool.get(energy.cardId)?.name ?? '?';
  st = addLog(st, `赤松：將 ${eName} 附加到 ${tName}`, idx);
  return updatePlayer(st, idx, pl => {
    if (pl.active?.iid === targetIid) {
      return { ...pl, active: { ...pl.active, energyAttached: [...pl.active.energyAttached, energy] } };
    }
    return { ...pl, bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energy] } : c) };
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
