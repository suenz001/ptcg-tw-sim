/**
 * v2.68 I 標 Wave 18 — 複製招式類收尾（5 張）
 *
 * 涵蓋：
 *   - 索羅亞克|欺詐：複製對手戰鬥場 1 招（自動挑印刷傷害最高）
 *   - 阿響的樹才怪|試著模仿：擲幣正面 → 同上
 *   - 流氓熊貓|無理取鬧 30：選對手戰鬥場 1 招 → 下回合 defender 無法用
 *   - 九尾|靈怪變化：棄牌庫頂 1，若是支援者則執行該支援者效果
 *   - 火箭隊的貓老大ex|高傲指令：翻對手牌庫頂 10，挑寶可夢 1 招使用（v5.869 玩家選招,非簡化）
 *
 * 設計原理（沿用 N的索羅亞克ex|暗黑底牌 v2.119 模式）：
 *   - PRE 階段查詢「複製目標寶可夢」與「該寶可夢招式」，挑印刷傷害最高
 *   - 設定 state.pendingCopyAttackKey，PRE 轉接到 ATTACK_PRE.get(copiedKey)
 *   - POST 階段轉接到 ATTACK_POST.get(copiedKey) 處理附加效果
 *   - 不繼承被複製招式的 skipWeakRes（弱抗計算用本招式自身屬性）
 */

import { regPre, regPost, addLog, updatePlayer, withPending, shuffle, ATTACK_PRE_DISCARD_CHOICE, revealTopCardsLog } from '../_shared';
import { copyAttackPostDispatch, dispatchCopiedAttack } from '../_shared';
// ⭐v6.337 借招家族中央管線（候選枚舉 + 選招判準只有這一份）
import { copyAttackCandidates, pickCopiedAttack } from '../../copy-attack';
import { ATTACK_PRE, ATTACK_POST, TRAINER_EFFECTS } from '../_shared';
// ⭐ v6.262 支援者效果來源（葉子模組）—— 複製成招式效果時關閉「從手牌使出」才有的免疫
import { runAsCopiedSupporterEffect } from '../../supporter-effect-source';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, GameAction, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { flipCoinsWithLog, lockOppChosenAttackPost } from '../../effects'; // v5.793 無理取鬧玩家選招

const parseDmg = (s: string): number => {
  const m = (s ?? '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

// ⭐ v6.337：本檔原本有一份 `pickHighestAttack` 與一份 `copyAttackPre`，
//   v2760_h_wave3_complex.ts 又抄了一份逐字相同的 `pickHighestAttack`
//   —— 判準有複本，針對它的守衛必然是安慰劑（IRON_RULES Rule 38）。
//   兩份都刪掉，全部收斂到 `src/lib/game/copy-attack.ts`（候選枚舉 + 選招）
//   與 `_shared.dispatchCopiedAttack`（轉接被借招式）。

// v5.722：收斂到 _shared.copyAttackPostDispatch（傳 action，讓 borrowed regPost 判 yes/no）。
const copyAttackPost = copyAttackPostDispatch;

// ══════════════════════════════════════════════════════════════════════════════
// 1. 索羅亞克｜欺詐 — 選對手戰鬥場 1 招
// ══════════════════════════════════════════════════════════════════════════════
regPre('索羅亞克|欺詐', (state, aIdx, pool, action) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return { state: addLog(state, '欺詐：對手戰鬥場無寶可夢', aIdx), damage: 0 };
  // v6.337：候選枚舉與選招全部走中央管線（卡面「選擇1個對手的戰鬥寶可夢持有的招式」）
  const cands = copyAttackCandidates('索羅亞克|欺詐', state, aIdx, pool);
  const pick = pickCopiedAttack(cands, action);
  if (!pick.candidate) return { state: addLog(state, '欺詐：對手戰鬥場無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${pick.candidate.ownerName}|${pick.candidate.attackName}`;
  const pickMode = pick.byPlayer ? '玩家選擇' : '自動挑印刷最高';
  const sLog = addLog(state, `欺詐：${pickMode}「${copiedKey}」`, aIdx);
  return dispatchCopiedAttack(sLog, aIdx, pool, copiedKey, pick.candidate.damage, action, pick.restChain);
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
  // v6.337：候選枚舉與選招全部走中央管線
  const cands = copyAttackCandidates('阿響的樹才怪|試著模仿', r.state, aIdx, pool);
  const pick = pickCopiedAttack(cands, action);
  if (!pick.candidate) return { state: addLog(r.state, '試著模仿：對手戰鬥場無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${pick.candidate.ownerName}|${pick.candidate.attackName}`;
  const pickMode = pick.byPlayer ? '玩家選擇' : '自動挑印刷最高';
  const sLog = addLog(r.state, `試著模仿：${pickMode}「${copiedKey}」`, aIdx);
  return dispatchCopiedAttack(sLog, aIdx, pool, copiedKey, pick.candidate.damage, action, pick.restChain);
});
regPost('阿響的樹才怪|試著模仿', copyAttackPost);

// ══════════════════════════════════════════════════════════════════════════════
// 3. 流氓熊貓｜無理取鬧 30 — 選對手戰鬥場 1 招, 下回合 defender 無法使用
//   v5.793：玩家選(中央 lockOppChosenAttackPost,同火箭隊黑暗鴉),非簡化
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
      // ⭐⭐⭐ v6.262：卡面「將那個效果**作為這個招式的效果**使用」＝**不是**「從手牌使出支援者卡」。
      //   鰭之守護 / 緊張感 / 融合為雪 / 廣域堡壘 四個免疫的卡面前提都是「對手從手牌使出」，
      //   v6.261 以前直接呼叫 TRAINER_EFFECTS 會把免疫一併繼承 → 化石被錯誤排除。
      const _s0 = s;
      s = runAsCopiedSupporterEffect(() => fn(_s0, aIdx, pool));
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
  // skip sentinel：玩家明確選擇不複製（「若希望」= 不希望）
  const choice = (action as Extract<GameAction, { type: 'ATTACK' }> | undefined)?.copyAttackChoice;
  if (choice?.pokeIid === '__rocket_command_skip__') {
    return { state: addLog(state, '高傲指令：玩家選擇不複製招式（傷害 0）', aIdx), damage: 0 };
  }
  // ⭐ v6.337：候選枚舉與選招走中央管線。
  //   ⚠ 順帶修正一條**違反官方裁定**的排除：舊碼在兩條路徑都把
  //     「火箭隊的貓老大ex|高傲指令」自己排掉，但官方 PTCG_RULES **L2276~2277** 明文
  //     「翻到的 10 張裡有貓老大ex，**可以**選它的高傲指令來使用」。
  //     中央管線改由 `COPY_ATTACK_MAX_DEPTH` 界定遞迴，不再靠排除自己。
  const cands = copyAttackCandidates('火箭隊的貓老大ex|高傲指令', state, aIdx, pool);
  const pick = pickCopiedAttack(cands, action);
  if (!pick.candidate) return { state: addLog(state, '高傲指令：對手牌庫頂無可複製招式', aIdx), damage: 0 };
  const picked = { cardName: pick.candidate.ownerName, attackName: pick.candidate.attackName, damage: pick.candidate.damage };
  const pickMode = pick.byPlayer ? '玩家選擇' : '自動挑印刷最高';
  const copiedKey = `${picked.cardName}|${picked.attackName}`;
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
  // ⭐⭐⭐ v6.337：官方 PTCG_RULES **L2277** 後半句 ——
  //   「此情況應**先**將翻到正面的卡放回牌庫並重洗，**再**處理招式「高傲指令」的效果。」
  //   v6.336 以前重洗寫在 POST，反正借不到另一張高傲指令所以看不出差別；
  //   本版解禁借招鏈之後，重洗如果還留在 POST，第 2 層的高傲指令會看到**同一批沒重洗的 10 張**。
  //   ⇒ 重洗搬到「候選枚舉之後、轉接被借招式之前」。
  const sShuffled = addLog(
    updatePlayer(s, dIdx, p => ({ ...p, deck: shuffle(p.deck) })),
    '高傲指令：對手牌庫重洗', aIdx);
  return dispatchCopiedAttack(sShuffled, aIdx, pool, copiedKey, picked.damage, dispatchAction, pick.restChain);
});
regPost('火箭隊的貓老大ex|高傲指令', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  // ⭐ v6.337：選「否」也必須走 copyAttackPostDispatch —— 它同時負責把借招堆疊清乾淨。
  //   舊寫法直接 return，堆疊會殘留到**下一個 action**（改成陣列後會累積，比舊版更嚴重）。
  if (!_choseYes) {
    return copyAttackPostDispatch(
      addLog(state, '高傲指令：選擇「否」 — 跳過複製對手招式', aIdx), aIdx, pool, action);
  }
  // 重洗已移到 PRE（L2277 的順序要求），這裡只負責轉接被借招式的 POST。
  return copyAttackPostDispatch(state, aIdx, pool, action); // v5.722 傳 action
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 18 統計：5 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
