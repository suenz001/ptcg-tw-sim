/**
 * v2.362 新牌組批次實裝 — 4 組預設牌組缺失效果補全
 *
 * 覆蓋卡牌：
 *   A. 幼基拉斯｜咬碎（20 + 擲幣正面→丟棄對手戰鬥寶可夢 1 張能量）
 *   B. 輕飄飄｜海之影（20 + 下回合對手無法打出物品卡）
 *   C. 振翼髮｜暗夜羽擊（0 + 消除對手戰鬥寶可夢特性至下一個對手回合）
 *   D. 超級巨牙鯊ex｜飢渴下巴（120 + 若自身有傷害指示物 +150）
 *   E. 伊裴爾塔爾｜黑暗羽毛（110，無附加效果）
 *
 * 依賴：
 *   - types.ts：CardInstance.abilityNullifiedNextTurn / abilityNullifiedThisTurn
 *   - engine.ts：促進邏輯（promotePending）、威迫目光物品卡封鎖、特性消除判定
 */

import type { GameState } from '../../types';
import {
  addLog,
  regPost,
  regPre,
  updatePlayer,
} from '../_shared';

// ── A. 幼基拉斯｜咬碎 ────────────────────────────────────────────────────────
// 卡面：20 傷害。擲 1 次硬幣，若正面，丟棄對手戰鬥寶可夢身上 1 張能量。
regPre('幼基拉斯|咬碎', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('幼基拉斯|咬碎', (state, aIdx, pool) => {
  const isHeads = Math.random() < 0.5;
  state = addLog(state, `咬碎：擲硬幣 — ${isHeads ? '正面' : '反面'}`, aIdx);
  if (!isHeads) return state;

  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def || def.energyAttached.length === 0) {
    return addLog(state, '咬碎：對手戰鬥場無能量', aIdx);
  }
  // 丟棄最後一張能量
  const last = def.energyAttached[def.energyAttached.length - 1];
  const eName = pool.get(last.cardId)?.name ?? '能量';
  state = addLog(state, `咬碎：丟棄對手的 ${eName}`, aIdx);
  return updatePlayer(state, dIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      energyAttached: p.active.energyAttached.slice(0, -1),
    } : null,
    discard: [...p.discard, last],
  }));
});

// ── B. 輕飄飄｜海之影 ────────────────────────────────────────────────────────
// 卡面：20 傷害。在對手的下個回合，對手無法從手牌使出物品卡。
// （與含羞苞｜癢癢花粉同機制，共用 cantPlayItemNextTurn 旗標）
regPre('輕飄飄|海之影', (state, _aIdx, _pool) => ({ state, damage: 20 }));
regPost('輕飄飄|海之影', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  return {
    ...addLog(state, '海之影：對手下個回合無法使出物品卡', aIdx),
    players: state.players.map((p, i) =>
      i === dIdx ? { ...p, cantPlayItemNextTurn: true } : p
    ) as [typeof state.players[0], typeof state.players[1]],
  };
});

// ── C. 振翼髮｜暗夜羽擊 ──────────────────────────────────────────────────────
// 卡面：不造成傷害。直到下個對手的回合結束，對手的戰鬥寶可夢的特性無效。
// 實作：在對手戰鬥寶可夢身上設 abilityNullifiedNextTurn；
//   END_TURN 時 promotePending 將 NextTurn → ThisTurn，對手回合中無法使用特性。
regPre('振翼髮|暗夜羽擊', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('振翼髮|暗夜羽擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return addLog(state, '暗夜羽擊：對手無戰鬥寶可夢', aIdx);
  const defName = pool.get(def.cardId)?.name ?? '?';
  state = addLog(state, `暗夜羽擊：${defName} 的特性在下個對手回合無效`, aIdx);
  return updatePlayer(state, dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, abilityNullifiedNextTurn: true } : null,
  }));
});

// ── D. 超級巨牙鯊ex｜飢渴下巴 ───────────────────────────────────────────────
// 卡面：120 傷害。若這隻寶可夢身上有任何傷害指示物，+150 傷害。
regPre('超級巨牙鯊ex|飢渴下巴', (state, aIdx, _pool) => {
  const active = state.players[aIdx].active;
  const bonus = (active?.damage ?? 0) > 0 ? 150 : 0;
  if (bonus > 0) {
    state = addLog(state, '飢渴下巴：自身有傷害指示物 → +150', aIdx);
  }
  return { state, damage: 120 + bonus };
});

// ── E. 伊裴爾塔爾｜黑暗羽毛 ─────────────────────────────────────────────────
// 卡面：110 傷害，無附加效果。
regPre('伊裴爾塔爾|黑暗羽毛', (state, _aIdx, _pool) => ({ state, damage: 110 }));
