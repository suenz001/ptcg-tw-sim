/**
 * 三組超級進化預組卡效果（v2.100+ 起陸續實裝）：
 *   - 奧利瓦ex（草系 Stage2 Mega）
 *   - 鋁鋼橋龍ex（鋼系 Stage1 Mega）
 *   - 超級寶石海星ex / 超級雪妖女ex（水系 Mega 混合）
 *
 * 每張卡嚴格按 static/cards/*.json 的 rulesText 實裝；遇到卡面描述需要
 * 新 engine infra 時會在註解寫明、先 deferred、不做簡化版（feedback_effect_implementation_sop）。
 */

import type { CardInstance } from '../../types';
import {
  regPre, regPost,
  addLog, updatePlayer,
} from '../_shared';
import { hitBenchPickPost } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 奧利瓦ex ｜ 芳香射擊（160 + 自身清特殊狀態）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「將這隻寶可夢的特殊狀態全部恢復。」（基礎 160）
regPre('奧利瓦ex|芳香射擊', (s) => ({ state: s, damage: 160 }));
regPost('奧利瓦ex|芳香射擊', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att || !att.status) return state;
  const name = pool.get(att.cardId)?.name ?? '?';
  const newActive: CardInstance = { ...att, status: null };
  const players = [...state.players] as typeof state.players;
  players[aIdx] = { ...state.players[aIdx], active: newActive };
  return addLog({ ...state, players },
    `芳香射擊：${name} 的特殊狀態全部恢復`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級雪妖女ex ｜ 怨言（傷害 = 對手手牌張數 × 50）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「造成對手的手牌的張數×50點傷害。」
regPre('超級雪妖女ex|怨言', (state, aIdx) => {
  const oppHandCount = state.players[(1 - aIdx) as 0 | 1].hand.length;
  const dmg = oppHandCount * 50;
  const s = addLog(state,
    `怨言：對手手牌 ${oppHandCount} 張 → 造成 ${dmg} 點傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級寶石海星ex ｜ 星雲光束（210，不計算弱點/抵抗力/附加效果）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「這個招式的傷害不計算弱點・抵抗力與對手的戰鬥寶可夢身上的附加效果。」
regPre('超級寶石海星ex|星雲光束', (state) => ({
  state,
  damage: 210,
  skipWeakRes: true,
  skipDefEffects: true,
}));

// ══════════════════════════════════════════════════════════════════════════════
// 超級寶石海星ex ｜ 噴射打擊（120 + 選 1 隻對手備戰寶可夢 50 傷）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「對手的1隻備戰寶可夢也受到50點傷害。[在備戰區不計算弱點・抵抗力。]」
regPre('超級寶石海星ex|噴射打擊', (state) => ({ state, damage: 120 }));
regPost('超級寶石海星ex|噴射打擊', (state, aIdx) =>
  hitBenchPickPost(state, aIdx, 'opp', 1, 50, '噴射打擊'));

// ══════════════════════════════════════════════════════════════════════════════
// 超級大嘴娃ex ｜ 貪心（傷害 = 自己已取獎賞數 × 80）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「造成自己已經獲得的獎賞卡的張數×80點傷害。」
// 「已取獎賞」= 6 - 自己剩餘獎賞數。初始 6 張 → 已取 0；取到最後 1 張 → 已取 5。
regPre('超級大嘴娃ex|貪心', (state, aIdx) => {
  const remaining = state.players[aIdx].prizes.length;
  const taken = Math.max(0, 6 - remaining);
  const dmg = taken * 80;
  const s = addLog(state,
    `貪心：自己已取獎賞 ${taken} 張 → 造成 ${dmg} 點傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級大嘴娃ex ｜ 大啃咬（基礎 260；若對手戰鬥位有傷害指示物 → 改為 30）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若對手的戰鬥寶可夢身上放置有傷害指示物，則這個招式的傷害改為『30』點。」
// 反直覺設計：對手越肉、HP 越受創時，大啃咬反而變弱。
regPre('超級大嘴娃ex|大啃咬', (state, aIdx, pool) => {
  const defActive = state.players[(1 - aIdx) as 0 | 1].active;
  const hasDamage = defActive && defActive.damage > 0;
  const dmg = hasDamage ? 30 : 260;
  const defName = defActive ? (pool.get(defActive.cardId)?.name ?? '?') : '?';
  const s = addLog(state,
    hasDamage
      ? `大啃咬：對手 ${defName} 身上有傷害指示物 → 傷害改為 30`
      : `大啃咬：對手 ${defName} 無傷害指示物 → 260 傷害`,
    aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 旋轉洛托姆 ｜ 突擊著地（70，若場上沒有競技場卡則招式失敗）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若場上沒有競技場卡，則這個招式失敗。」
regPre('旋轉洛托姆|突擊著地', (state, aIdx) => {
  if (!state.activeStadium) {
    const s = addLog(state, '突擊著地：場上無競技場卡，招式失敗', aIdx);
    return { state: s, damage: 0 };
  }
  return { state, damage: 70 };
});
