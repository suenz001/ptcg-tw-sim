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

import { regPre, regPost, addLog, updatePlayer, withPending, shuffle, ATTACK_PRE_DISCARD_CHOICE, revealTopCardsLog } from '../_shared';
import { copyAttackPostDispatch } from '../_shared';
import { ATTACK_PRE, ATTACK_POST, TRAINER_EFFECTS } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, GameAction, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { flipCoinsWithLog, lockOppChosenAttackPost } from '../../effects'; // v5.793 無理取鬧玩家選招

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

// v5.722：收斂到 _shared.copyAttackPostDispatch（傳 action，讓 borrowed regPost 判 yes/no）。
const copyAttackPost = copyAttackPostDispatch;

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
  // v5.178：讀 action.copyAttackChoice (UI 端 picker 帶) 讓玩家自選
  const choice = (action as { copyAttackChoice?: { pokeIid: string; attackIndex: number } } | undefined)?.copyAttackChoice;
  let best: { cardName: string; attackName: string; damage: number } | null = null;
  if (choice && choice.pokeIid === da.iid && choice.attackIndex >= 0) {
    const daCard = pool.get(da.cardId);
    const atk = daCard?.attacks?.[choice.attackIndex];
    if (daCard && atk && atk.name && atk.name !== '試著模仿') {
      const m = (atk.damage ?? '').match(/^(\d+)/);
      best = { cardName: daCard.name!, attackName: atk.name, damage: m ? parseInt(m[1], 10) : 0 };
    }
  }
  if (!best) best = pickHighestAttack([da], pool, '阿響的樹才怪|試著模仿');
  if (!best) return { state: addLog(r.state, '試著模仿：對手戰鬥場無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${best.cardName}|${best.attackName}`;
  const pickMode = choice ? '玩家選擇' : '自動挑印刷最高';
  const sLog = addLog(r.state, `試著模仿：${pickMode}「${copiedKey}」`, aIdx);
  return copyAttackPre(sLog, aIdx, pool, copiedKey, '試著模仿', best.damage, action);
});
regPost('阿響的樹才怪|試著模仿', copyAttackPost);

// ══════════════════════════════════════════════════════════════════════════════
// 3. 流氓熊貓｜無理取鬧 30 — 選對手戰鬥場 1 招, 下回合 defender 無法使用
//   簡化：自動挑印刷傷害最高
// ══════════════════════════════════════════════════════════════════════════════
regPre('流氓熊貓|無理取鬧', (s) => ({ state: s, damage: 30 }));
// v5.793：原『自動挑最高傷害』違卡面「選擇」→ 改用中央 lockOppChosenAttackPost(玩家選,同火箭隊黑暗鴉)。
regPost('流氓熊貓|無理取鬧', lockOppChosenAttackPost('無理取鬧'));

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
// JSON：「將對手的牌庫上方10張卡翻到正面。若希望，選擇1個其中的寶可夢持有的招式，
//        作為這個招式使用。將翻到正面的卡放回牌庫並重洗。」
// v4.39：UI initiateAttack 攔截 → rocketCommandPicker 讓玩家選 (pokeIid, attackIndex)
//   - skip sentinel '__rocket_command_skip__' → 0 damage（不複製，符合「若希望」）
//   - 有效 choice 且 pokeIid 在 top10 → 用該招式（race 保護 — 若 deck 變動 fallback 自動）
//   - mismatch / 缺失 → fallback 自動挑印刷最高
//   - borrowed 招式有 binary-yes-no PRE_DISCARD_CHOICE → 注入 sentinel 視為「希望」
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的貓老大ex|高傲指令', (state, aIdx, pool, action) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const top10 = opp.deck.slice(0, 10);
  // v5.719：卡面「將對手的牌庫上方 10 張卡翻到正面」= 公開揭示，列出翻開的卡名。
  state = revealTopCardsLog(state, aIdx, top10, pool, '高傲指令');
  const pokemonCards: CardInstance[] = top10.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  if (pokemonCards.length === 0) {
    return { state: addLog(state, '高傲指令：對手牌庫頂 10 張無寶可夢', aIdx), damage: 0 };
  }
  // v4.39：讀玩家選擇
  const choice = (action as Extract<GameAction, { type: 'ATTACK' }> | undefined)?.copyAttackChoice;
  // skip sentinel：玩家明確選擇不複製（「若希望」= 不希望）
  if (choice?.pokeIid === '__rocket_command_skip__') {
    return { state: addLog(state, '高傲指令：玩家選擇不複製招式（傷害 0）', aIdx), damage: 0 };
  }
  let picked: { cardName: string; attackName: string; damage: number } | null = null;
  let useChoice = false;
  if (choice && choice.pokeIid && choice.attackIndex >= 0) {
    const inst = pokemonCards.find(c => c.iid === choice.pokeIid);
    if (inst) {
      const card = pool.get(inst.cardId);
      const atk = card?.attacks?.[choice.attackIndex];
      if (card && atk && card.name && atk.name && `${card.name}|${atk.name}` !== '火箭隊的貓老大ex|高傲指令') {
        const m = (atk.damage ?? '').match(/^(\d+)/);
        const dmg = m ? parseInt(m[1], 10) : 0;
        picked = { cardName: card.name, attackName: atk.name, damage: dmg };
        useChoice = true;
      }
    }
  }
  if (!picked) {
    picked = pickHighestAttack(pokemonCards, pool, '火箭隊的貓老大ex|高傲指令');
  }
  if (!picked) return { state: addLog(state, '高傲指令：對手牌庫頂無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${picked.cardName}|${picked.attackName}`;
  const pickMode = useChoice ? '玩家選擇' : '自動挑印刷最高';
  const s = addLog(state, `高傲指令：${pickMode}「${picked.cardName}」的「${picked.attackName}」`, aIdx);
  // borrowed 招式 binary-yes-no PRE_DISCARD_CHOICE → 注入 sentinel 視為「希望」（仿耀閃挑戰）
  const copiedSpec = ATTACK_PRE_DISCARD_CHOICE.get(copiedKey);
  let dispatchAction: typeof action = action;
  // v5.720：同耀閃挑戰——只在玩家未選(action 無 discardedEnergyIids)才 fallback「希望」；玩家選了(含否)就尊重。
  if (copiedSpec?.scope === 'binary-yes-no' && action?.discardedEnergyIids === undefined) {
    dispatchAction = {
      ...(action ?? { type: 'ATTACK', attackIndex: 0 } as Extract<GameAction, { type: 'ATTACK' }>),
      discardedEnergyIids: ['__rocket_command_borrowed_yes__'],
    };
  }
  return copyAttackPre(s, aIdx, pool, copiedKey, '高傲指令', picked.damage, dispatchAction);
});
regPost('火箭隊的貓老大ex|高傲指令', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '高傲指令：選擇「否」 — 跳過複製對手招式', aIdx);
  const _cb: AttackPostFn = (state, aIdx, pool) => {
  // 重洗對手牌庫（卡面要求「翻到正面的卡放回牌庫並重洗」）
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = updatePlayer(state, dIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  s = addLog(s, '高傲指令：對手牌庫重洗', aIdx);
  return copyAttackPostDispatch(s, aIdx, pool, action); // v5.722 傳 action
};
  return _cb(state, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 18 統計：5 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
