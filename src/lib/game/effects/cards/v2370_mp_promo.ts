/**
 * v4.952 — M-P 特典卡 (J 標) 實裝：古歷 + 超級妖火紅狐ex
 *
 * 來源（依鐵律 7c）：當時 TW 官網未發布，先依 HK 官網實裝。
 * v6.193：台版卡面補齊後，站長裁定刪掉港版重複收錄的兩筆（18965／18969），
 *   保留台版 —— 古歷 (id=18564, Supporter)／超級妖火紅狐ex (id=18560, Pokemon/Stage2/ex)。
 *   ⚠ 這裡的註冊是**卡名**為 key，與 id 無關，刪 id 不影響本檔任何一行程式。
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import {
  addLog,
  reg,
  regG,
  regPost,
  regPre,
  updatePlayer,
  withPending,
} from '../_shared';
import { getOwnBenchLimit } from '../_shared';
import { applyStatusToOppActive } from '../../effects';

// ─────────────────────────────────────────────────────────────────────────────
// 古歷（Supporter）— 將雙方的所有寶可夢各恢復「50」HP
// ─────────────────────────────────────────────────────────────────────────────

/** 雙方所有寶可夢（active + bench）各扣 amount damage（不低於 0）。 */
function healAllOnField(state: GameState, amount: number): GameState {
  const newPlayers = state.players.map(p => {
    const healInst = (i: CardInstance): CardInstance => ({
      ...i,
      damage: Math.max(0, i.damage - amount),
    });
    return {
      ...p,
      active: p.active ? healInst(p.active) : null,
      bench: p.bench.map(healInst),
    } as PlayerState;
  }) as [PlayerState, PlayerState];
  return { ...state, players: newPlayers };
}

// v6.089：卡面「將雙方的所有寶可夢各恢復50HP」→ 雙方全場皆滿血時恢復 0，完全沒效果。
//   照傷藥等 20+ 張治療卡的既有守衛形態 gate（範圍含雙方）。
regG('古歷', (st, idx) => {
  const sides = [st.players[0], st.players[1]];
  return sides.some(p => [...(p.active ? [p.active] : []), ...p.bench].some(c => c.damage > 0));
});
reg('古歷', (state, aIdx) => {
  const s = healAllOnField(state, 50);
  return addLog(s, '古歷：雙方所有寶可夢各恢復 50 HP', aIdx);
});

// ─────────────────────────────────────────────────────────────────────────────
// 超級妖火紅狐ex — 戲法傳送門 / 奇異燈火
// ─────────────────────────────────────────────────────────────────────────────

// ── 戲法傳送門 (Fire) ────────────────────────────────────────────────────────
// 卡面：查看自己的牌庫上方 9 張卡，從其中選擇任意數量的寶可夢卡，放置於備戰區。
//       將剩餘卡放回牌庫並重洗。
// 實作（per Rule 21）：filter 'Pokemon:TOP9' + params.top9Iids。重用既有
//       'bench-basic-from-deck' resolver（不傳 targetName 時不過濾）。
regPre('超級妖火紅狐ex|戲法傳送門', (state) => ({ state, damage: 0 }));
regPost('超級妖火紅狐ex|戲法傳送門', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '戲法傳送門：牌庫為空', aIdx);
  const benchLimit = getOwnBenchLimit(state, aIdx, pool);
  const benchSpace = benchLimit - p.bench.length;
  if (benchSpace <= 0) return addLog(state, '戲法傳送門：備戰區已滿', aIdx);

  const top9 = p.deck.slice(0, Math.min(9, p.deck.length));
  const top9Iids = top9.map(c => c.iid);
  const maxPick = Math.min(top9.length, benchSpace);

  return withPending(
    addLog(state, `戲法傳送門：查看牌庫頂 ${top9.length} 張，選任意數量寶可夢放備戰`, aIdx),
    {
      type: 'deck-search',
      actorIdx: aIdx,
      sourcePlayerIdx: aIdx,
      filter: 'Pokemon:TOP9',
      // per Rule 14：minCount: 0（允許 Pass，玩家可看牌庫剩餘資訊）
      minCount: 0,
      maxCount: maxPick,
      effectKey: 'bench-basic-from-deck',
      params: {
        top9Iids,
        titleOverride: `戲法傳送門：從牌庫頂 ${top9.length} 張選任意數量寶可夢放備戰`,
      },
    },
  );
});

// ── 奇異燈火 (Fire+Colorless+Colorless, 200dmg) ─────────────────────────────
// 卡面：將對手的戰鬥寶可夢【灼傷】與【混亂】。
// 邏輯：套灼傷 + 混亂兩種特殊狀態；混亂 是 action 類狀態（主格），
//       灼傷 是 damage 類狀態（若主格已被佔走則放 secondaryStatus）。
regPre('超級妖火紅狐ex|奇異燈火', (state) => ({ state, damage: 200 }));
// 卡面：灼傷與混亂 —— 收斂到中央 applyStatusToOppActive（逐狀態各一次），統一免疫檢查＋三狀態欄雙格共存，取代原手寫 slot literal。
regPost('超級妖火紅狐ex|奇異燈火', (state, aIdx, pool) => {
  let s = applyStatusToOppActive(state, aIdx, 'burned', pool, { kind: 'attack-effect', label: '奇異燈火' });
  s = applyStatusToOppActive(s, aIdx, 'confused', pool, { kind: 'attack-effect', label: '奇異燈火' });
  return s;
});
