/**
 * v2.68 I 標 Wave 18 — 複製招式類收尾（5 張）
 *
 * 涵蓋：
 *   - 索羅亞克|欺詐：複製對手戰鬥場 1 招（自動挑印刷傷害最高）
 *   - 阿響的樹才怪|試著模仿：擲幣正面 → 同上
 *   - 流氓熊貓|無理取鬧 30：選對手戰鬥場 1 招 → 下回合 defender 無法用
 *   - 九尾|靈怪變化：棄牌庫頂 1，若是支援者則執行該支援者效果
 *   - 火箭隊的貓老大ex|高傲指令：翻對手牌庫頂 10，挑寶可夢 1 招使用（簡化：自動挑最大傷害）
 *
 * 設計原理（沿用 N的索羅亞克ex|暗黑底牌 v2.119 模式）：
 *   - PRE 階段查詢「複製目標寶可夢」與「該寶可夢招式」，挑印刷傷害最高
 *   - 設定 state.pendingCopyAttackKey，PRE 轉接到 ATTACK_PRE.get(copiedKey)
 *   - POST 階段轉接到 ATTACK_POST.get(copiedKey) 處理附加效果
 *   - 不繼承被複製招式的 skipWeakRes（弱抗計算用本招式自身屬性）
 */

import { regPre, regPost, addLog, updatePlayer, withPending, shuffle } from '../_shared';
import { ATTACK_PRE, ATTACK_POST, TRAINER_EFFECTS } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { flipCoinsWithLog } from '../../effects';

const parseDmg = (s: string): number => {
  const m = (s ?? '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

// ══════════════════════════════════════════════════════════════════════════════
// 共用 helper：從候選寶可夢中挑「印刷傷害最高」的招式，回傳 (cardName, attackName)
// 排除「self|self」防遞迴
// ══════════════════════════════════════════════════════════════════════════════
function pickHighestAttack(
  candidates: CardInstance[],
  pool: Map<string, Card>,
  selfKey: string,
): { cardName: string; attackName: string; damage: number } | null {
  let best: { cardName: string; attackName: string; damage: number } | null = null;
  for (const c of candidates) {
    const card = pool.get(c.cardId);
    if (!card?.attacks) continue;
    for (const atk of card.attacks) {
      const key = `${card.name}|${atk.name}`;
      if (key === selfKey) continue;
      const d = parseDmg(atk.damage);
      if (!best || d > best.damage) best = { cardName: card.name!, attackName: atk.name!, damage: d };
    }
  }
  return best;
}

// 共用：執行複製招式（PRE 階段）
function copyAttackPre(state: GameState, aIdx: 0|1, pool: Map<string, Card>, copiedKey: string, label: string,
  fallbackDamage: number, action?: any): { state: GameState; damage: number; skipWeakRes?: boolean; skipDefEffects?: boolean } {
  let s = addLog(state, `${label}：複製招式「${copiedKey}」`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };
  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    const sub = copiedPre(s, aIdx, pool, action);
    return { state: sub.state, damage: sub.damage, skipWeakRes: false, skipDefEffects: sub.skipDefEffects };
  }
  return { state: s, damage: fallbackDamage };
}

function copyAttackPost(state: GameState, aIdx: 0|1, pool: Map<string, Card>): GameState {
  const key = state.pendingCopyAttackKey;
  const cleared: GameState = { ...state, pendingCopyAttackKey: undefined };
  if (!key) return cleared;
  const copiedPost = ATTACK_POST.get(key);
  if (!copiedPost) return cleared;
  return copiedPost(cleared, aIdx, pool);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 索羅亞克｜欺詐 — 選對手戰鬥場 1 招
// ══════════════════════════════════════════════════════════════════════════════
regPre('索羅亞克|欺詐', (state, aIdx, pool, action) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return { state: addLog(state, '欺詐：對手戰鬥場無寶可夢', aIdx), damage: 0 };
  const best = pickHighestAttack([da], pool, '索羅亞克|欺詐');
  if (!best) return { state: addLog(state, '欺詐：對手戰鬥場無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${best.cardName}|${best.attackName}`;
  return copyAttackPre(state, aIdx, pool, copiedKey, '欺詐', best.damage, action);
});
regPost('索羅亞克|欺詐', copyAttackPost);

// ══════════════════════════════════════════════════════════════════════════════
// 2. 阿響的樹才怪｜試著模仿 — 擲幣正面 → 複製對手戰鬥場 1 招
// ══════════════════════════════════════════════════════════════════════════════
regPre('阿響的樹才怪|試著模仿', (state, aIdx, pool, action) => {
  const r = flipCoinsWithLog(state, 1, '試著模仿', aIdx);
  if (r.heads === 0) return { state: addLog(r.state, '試著模仿：反面 → 0', aIdx), damage: 0 };
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = r.state.players[dIdx].active;
  if (!da) return { state: addLog(r.state, '試著模仿：正面但對手戰鬥場無寶可夢', aIdx), damage: 0 };
  const best = pickHighestAttack([da], pool, '阿響的樹才怪|試著模仿');
  if (!best) return { state: addLog(r.state, '試著模仿：對手戰鬥場無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${best.cardName}|${best.attackName}`;
  return copyAttackPre(r.state, aIdx, pool, copiedKey, '試著模仿', best.damage, action);
});
regPost('阿響的樹才怪|試著模仿', copyAttackPost);

// ══════════════════════════════════════════════════════════════════════════════
// 3. 流氓熊貓｜無理取鬧 30 — 選對手戰鬥場 1 招, 下回合 defender 無法使用
//   簡化：自動挑印刷傷害最高
// ══════════════════════════════════════════════════════════════════════════════
regPre('流氓熊貓|無理取鬧', (s) => ({ state: s, damage: 30 }));
regPost('流氓熊貓|無理取鬧', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return state;
  const best = pickHighestAttack([da], pool, '');
  if (!best) return addLog(state, '無理取鬧：對手戰鬥場無可禁用招式', aIdx);
  return updatePlayer(
    addLog(state, `無理取鬧：下回合 defender 無法使用「${best.attackName}」（自動挑最高傷害）`, aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), best.attackName],
      } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 九尾｜靈怪變化 — 棄牌庫頂 1, 若是支援者則執行該支援者效果
// ══════════════════════════════════════════════════════════════════════════════
regPre('九尾|靈怪變化', (s) => ({ state: s, damage: 0 }));
regPost('九尾|靈怪變化', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '靈怪變化：牌庫已空', aIdx);
  const top = p.deck[0];
  const topCard = pool.get(top.cardId);
  // 棄牌庫頂
  let s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    deck: pl.deck.slice(1),
    discard: [...pl.discard, top],
  }));
  s = addLog(s, `靈怪變化：棄牌庫頂「${topCard?.name ?? '?'}」`, aIdx);
  // 若是支援者則執行
  if (topCard?.subtype === 'Supporter') {
    const fn = TRAINER_EFFECTS.get(topCard.name ?? '');
    if (fn) {
      s = addLog(s, `靈怪變化：「${topCard.name}」是支援者卡 → 執行其效果`, aIdx);
      s = fn(s, aIdx, pool);
    } else {
      s = addLog(s, `靈怪變化：「${topCard.name}」支援者效果未實裝（跳過）`, aIdx);
    }
  } else {
    s = addLog(s, '靈怪變化：非支援者卡（無附加效果）', aIdx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 火箭隊的貓老大ex｜高傲指令 — 翻對手牌庫頂 10 張, 從中選寶可夢 1 招使用
//   簡化：自動挑「印刷傷害最高」的（不繼承 PRE 旗標）；翻完放回對手牌庫並重洗
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的貓老大ex|高傲指令', (state, aIdx, pool, action) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const top10 = opp.deck.slice(0, 10);
  const pokemonCards: CardInstance[] = top10.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  if (pokemonCards.length === 0) {
    return { state: addLog(state, '高傲指令：對手牌庫頂 10 張無寶可夢', aIdx), damage: 0 };
  }
  const best = pickHighestAttack(pokemonCards, pool, '火箭隊的貓老大ex|高傲指令');
  if (!best) return { state: addLog(state, '高傲指令：對手牌庫頂無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${best.cardName}|${best.attackName}`;
  return copyAttackPre(state, aIdx, pool, copiedKey, '高傲指令', best.damage, action);
});
regPost('火箭隊的貓老大ex|高傲指令', (state, aIdx, pool) => {
  // 重洗對手牌庫（卡面要求「翻到正面的卡放回牌庫並重洗」）
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = updatePlayer(state, dIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  s = addLog(s, '高傲指令：對手牌庫重洗', aIdx);
  return copyAttackPost(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 18 統計：5 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
