/**
 * v2.995 Group 4 Wave 1 — 14 張簡單主動特性實裝
 *
 * 來源：ABILITY_AUDIT_V2_98.md Group 4，挑「規則最直觀」的 14 張先做。
 *
 * 治癒類 (4)：
 *   1. 霜奶仙ex｜甜點之禮            — 自方任 1 隻 +30 HP
 *   2. 壺壺｜發酵果汁                — 身上有【草】能量 → 自方任 1 隻 +30 HP
 *   3. 寶包繭｜飛葉治癒              — 自方戰鬥場 +20 HP
 *   4. 樂天河童｜激動治癒            — 場上有【草】超級進化ex → 自方任 1 隻 +60 HP
 *
 * 狀態類 (3)：
 *   5. 燈罩夜菇｜平靜之光            — 戰鬥場 → 對手戰鬥場【睡眠】
 *   6. 波爾凱尼恩ex｜燒灼蒸汽        — 戰鬥場 → 對手戰鬥場【灼傷】
 *   7. 搖籃百合｜任選黏液            — 擲幣正面 → 三選一（中毒/灼傷/混亂）施加對手戰鬥場
 *
 * 互換類 (4)：
 *   8. 花潔夫人｜媚惑引誘            — 擲幣正面 → 對手戰↔備戰互換 + 新上場混亂
 *   9. 大劍鬼｜激流旋渦              — 自方戰↔備戰互換 + 對手戰↔備戰互換
 *  10. 直衝熊｜激動衝刺              — 備戰 + 自方場有超級進化ex → 與戰鬥場互換
 *  11. 魔幻假面喵｜表演時間          — 備戰 → 與戰鬥場互換
 *
 * 其他 (3)：
 *  12. 凱西｜瞬間移動者              — 戰鬥場 → 自身與附加卡放回牌庫並重洗
 *  13. 大力鱷｜奔流之心              — 自身放 5 個指示物 + 本回合招式 +120
 *  14. 雪絨蛾｜勸誘羽                — 戰鬥場 → 雙方各抽 1
 *
 * 設計原則：
 *   - 每回合 1 次靠 engine 既有 abilityUsedThisTurn gate（per-instance）
 *   - 條件 gate（戰鬥場/備戰位/場上有 X）由 engine.ts getUsableAbilities 補
 *     按鈕未滿足條件時直接不顯示（Iron Rule 9）
 *   - 揭示資訊：所有結果用 addLog（公開 log），治癒/狀態/互換都是場上可見效果
 */

import { tryPromptPromoteActive } from '../_shared';
import { canApplyEffectToTarget } from '../../defense'; // v5.839 換位免疫 gate
import type { CardInstance, GameState, PlayerState } from '../../types';
import {
  regA, regAByName, regR,
  addLog, updatePlayer, withPending, shuffle, drawCards,
  clearActiveEffects,
  healResolver,
} from '../_shared';
import { flipCoinsWithLog, applyStatusToOppActive, energyProvidesType } from '../../effects'; // v5.702 host-aware 草能量述詞
import type { Card } from '$lib/cards/types';

// 導出 sentinel 防止 unused import warnings
export type _v2995Sentinel = PlayerState | GameState | Card | CardInstance;

// ══════════════════════════════════════════════════════════════════════════════
// helper：判斷是否為「【N】屬性的超級進化ex」
//   超級進化ex = name.startsWith('超級') && (subtype === 'ex' || name.endsWith('ex'))
// ══════════════════════════════════════════════════════════════════════════════
function hasMegaExOfType(
  player: PlayerState,
  pool: Map<string, Card>,
  type: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
): boolean {
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    const isMega = card.name.startsWith('超級') && (card.subtype === 'ex' || card.name.endsWith('ex'));
    return isMega && card.pokemonType === type;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 治癒類 — 共用 healResolver（heal-target pending）
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. 霜奶仙ex｜甜點之禮 ─────────────────────────────────────────────────────
// 卡面：「在自己的回合時可使用 1 次。將自己的 1 隻寶可夢恢復『30』HP。」
// gate：每回合 1 次（engine 處理）
regA('霜奶仙ex', 0, (st, idx, _pool, _cardInst) => {
  const p = st.players[idx];
  const hasAnyone = !!p.active || p.bench.length > 0;
  if (!hasAnyone) return addLog(st, '甜點之禮：場上沒有寶可夢可恢復', idx);
  const s = addLog(st, '甜點之禮：選擇 1 隻自己的寶可夢恢復 30 HP', idx);
  return withPending(s, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'sweet-gift-heal-30',
    params: { healAmount: 30 },
  });
});
regR('sweet-gift-heal-30', healResolver);

// ── 2. 壺壺｜發酵果汁 ────────────────────────────────────────────────────────
// 卡面：「若這隻寶可夢身上附有【草】能量卡，則在自己的回合時可使用 1 次。
//        將自己的 1 隻寶可夢恢復『30』HP。」
// gate：身上需有 1 張【草】能量（engine button gate 同步檢查）+ 每回合 1 次
regA('壺壺', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  // 找到觸發源（cardInst 對應實例；fallback active）
  const allPokes: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  const src = cardInst
    ? allPokes.find(c => c.iid === cardInst.iid)
    : allPokes.find(c => pool.get(c.cardId)?.name === '壺壺');
  if (!src) return addLog(st, '發酵果汁：找不到壺壺', idx);

  // 檢查身上有【草】能量（v5.702 host-aware：古舊/稜鏡視為草也算，與 engine 可用性 gate 一致）
  const hasGrass = src.energyAttached.some(e => energyProvidesType(src, e, 'Grass', pool));
  if (!hasGrass) return addLog(st, '發酵果汁：身上沒有【草】能量', idx);

  const s = addLog(st, '發酵果汁：選擇 1 隻自己的寶可夢恢復 30 HP', idx);
  return withPending(s, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'fermented-juice-heal-30',
    params: { healAmount: 30 },
  });
});
regR('fermented-juice-heal-30', healResolver);

// ── 3. 寶包繭｜飛葉治癒 ──────────────────────────────────────────────────────
// 卡面：「在自己的回合時可使用 1 次。將自己的戰鬥寶可夢恢復『20』HP。」
// gate：每回合 1 次
//   注意：卡面只能恢復「戰鬥寶可夢」— 直接 mutate 不開 picker
regA('寶包繭', 0, (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  if (!p.active) return addLog(st, '飛葉治癒：戰鬥場沒有寶可夢', idx);
  const name = pool.get(p.active.cardId)?.name ?? '?';
  const before = p.active.damage;
  const actual = Math.min(before, 20);
  const s = addLog(st, `飛葉治癒：${name} 恢復 ${actual} HP`, idx);
  return updatePlayer(s, idx, pl => {
    if (!pl.active) return pl;
    return { ...pl, active: { ...pl.active, damage: Math.max(0, pl.active.damage - 20) } };
  });
});

// ── 4. 樂天河童｜激動治癒 ────────────────────────────────────────────────────
// 卡面：「若自己的場上有【草】屬性的『超級進化寶可夢【ex】』，則在自己的回合時
//        可使用 1 次。將自己的 1 隻寶可夢恢復『60』HP。」
// gate：場上有【草】超級進化ex（engine button gate 同步檢查）+ 每回合 1 次
regAByName('樂天河童', '激動治癒', (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  if (!hasMegaExOfType(p, pool, 'Grass')) {
    return addLog(st, '激動治癒：場上沒有【草】屬性的超級進化【ex】', idx);
  }
  const hasAnyone = !!p.active || p.bench.length > 0;
  if (!hasAnyone) return addLog(st, '激動治癒：場上沒有寶可夢可恢復', idx);
  const s = addLog(st, '激動治癒：選擇 1 隻自己的寶可夢恢復 60 HP', idx);
  return withPending(s, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'rasoten-mega-heal-60',
    params: { healAmount: 60 },
  });
});
regR('rasoten-mega-heal-60', healResolver);

// ══════════════════════════════════════════════════════════════════════════════
// 狀態類
// ══════════════════════════════════════════════════════════════════════════════

// ── 5. 燈罩夜菇｜平靜之光 ────────────────────────────────────────────────────
// 卡面：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用 1 次。
//        將對手的戰鬥寶可夢【睡眠】。」
// gate：cardInst 必須在戰鬥場（engine 加 gate）+ 每回合 1 次
regA('燈罩夜菇', 0, (st, idx, pool, _cardInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active) return addLog(st, '平靜之光：對手戰鬥場沒有寶可夢', idx);
  // v5.444：改走中央 applyStatusToOppActive（ability-effect）— 化隱 / 不眠 / 祭典會場等免疫
  return applyStatusToOppActive(st, idx, 'asleep', pool, { kind: 'ability-effect', label: '平靜之光' });
});

// ── 6. 波爾凱尼恩ex｜燒灼蒸汽 ────────────────────────────────────────────────
// 卡面：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用 1 次。
//        將對手的戰鬥寶可夢【灼傷】。」
// gate：cardInst 必須在戰鬥場（engine 加 gate）+ 每回合 1 次
regA('波爾凱尼恩ex', 0, (st, idx, pool, _cardInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active) return addLog(st, '燒灼蒸汽：對手戰鬥場沒有寶可夢', idx);
  // v5.444：改走中央 applyStatusToOppActive（ability-effect）—【化隱】免疫對手特性效果
  //   （原本 inline 直接上灼傷，化隱寶可夢被燒灼蒸汽灼傷的 bug 根因）。
  return applyStatusToOppActive(st, idx, 'burned', pool, { kind: 'ability-effect', label: '燒灼蒸汽' });
});

// ── 7. 搖籃百合｜任選黏液 ────────────────────────────────────────────────────
// 卡面：「在自己的回合時可使用 1 次。擲 1 次硬幣若為正面，則從【中毒】・【灼傷】・
//        【混亂】中選擇 1 種，將對手的戰鬥寶可夢處於那個狀態。」
//
// 流程：
//   step1: 擲幣（公開 log）
//   step2: 若正面 → modal-choice 三選一（poison/burn/confuse）
//   step3: resolver 套用所選狀態
regA('搖籃百合', 0, (st, idx, _pool, _cardInst) => {
  const r = flipCoinsWithLog(st, 1, '任選黏液', idx);
  if (r.heads === 0) {
    return addLog(r.state, '任選黏液：反面，效果無效', idx);
  }
  const s = addLog(r.state, '任選黏液：正面，選擇要施加的狀態', idx);
  return withPending(s, {
    type: 'modal-choice', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'lumineon-slime-pick-status',
    params: {
      label: '任選黏液',
      options: [
        { id: 'poisoned', text: '①【中毒】' },
        { id: 'burned', text: '②【灼傷】' },
        { id: 'confused', text: '③【混亂】' },
      ],
    },
  });
});
regR('lumineon-slime-pick-status', (st, idx, iids, _params, pool) => {
  const choice = iids[0] as 'poisoned' | 'burned' | 'confused';
  if (!choice) return st;
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active) return addLog(st, '任選黏液：對手戰鬥場無寶可夢', idx);
  // v5.444：改走中央 applyStatusToOppActive（ability-effect）— 化隱 / 憨憨臉 / 泡沫能量等免疫
  return applyStatusToOppActive(st, idx, choice, pool, { kind: 'ability-effect', label: '任選黏液' });
});

// ══════════════════════════════════════════════════════════════════════════════
// 互換類
// ══════════════════════════════════════════════════════════════════════════════

// ── 8. 花潔夫人｜媚惑引誘 ────────────────────────────────────────────────────
// 卡面：「在自己的回合時可使用 1 次。擲 1 次硬幣若為正面，則選擇 1 隻對手的
//        備戰寶可夢，與戰鬥寶可夢互換。然後，將新上場的寶可夢【混亂】。」
//
// 流程：
//   step1: 擲幣
//   step2: 若正面 → opp-bench-choose（選對手 1 隻備戰）
//   step3: resolver 互換 + 新上場混亂
regA('花潔夫人', 0, (st, idx, _pool, _cardInst) => {
  const r = flipCoinsWithLog(st, 1, '媚惑引誘', idx);
  if (r.heads === 0) {
    return addLog(r.state, '媚惑引誘：反面，效果無效', idx);
  }
  const dIdx = (1 - idx) as 0 | 1;
  const dp = r.state.players[dIdx];
  if (!dp.active) return addLog(r.state, '媚惑引誘：對手戰鬥場無寶可夢', idx);
  if (dp.bench.length === 0) {
    return addLog(r.state, '媚惑引誘：對手備戰區沒有寶可夢可呼叫', idx);
  }
  // v5.995 C-05 方向修正：效果對象是被選的【備戰寶可夢】→ 原戰鬥位免疫不擋（v5.839 舊 gate 方向相反，移除）；
  //   改過濾備戰候選（免疫特性效果的備戰不可被選為互換目標）。
  const _lureIids = dp.bench
    // v6.028：互換不是放指示物 → 對戰圓形不擋
    .filter((c: CardInstance) => !canApplyEffectToTarget(r.state, idx, c, _pool.get(c.cardId), 'ability-effect', _pool, { isBench: true, counterPlacement: false }).blocked)
    .map((c: CardInstance) => c.iid);
  if (_lureIids.length === 0) return addLog(r.state, '媚惑引誘：正面，但對手備戰寶可夢皆不受特性效果影響，無法互換', idx);
  const s = addLog(r.state, '媚惑引誘：正面，選 1 隻對手備戰寶可夢與其戰鬥場互換並混亂', idx);
  return withPending(s, {
    type: 'opp-bench-choose', actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'flowery-lure',
    params: { validIids: _lureIids },
  });
});
regR('flowery-lure', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const targetIid = iids[0];
  const target = dp.bench.find(c => c.iid === targetIid);
  if (!target || !dp.active) return st;
  const newName = pool.get(target.cardId)?.name ?? '?';
  const oldName = pool.get(dp.active.cardId)?.name ?? '?';
  st = addLog(st, `媚惑引誘：對手 ${oldName} 換到備戰，${newName} 上場`, idx);
  st = updatePlayer(st, dIdx, p => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === targetIid);
    if (bIdx < 0) return p;
    const newBench = [...p.bench];
    newBench[bIdx] = clearActiveEffects(p.active);
    // v3.812：preserve justPlaced + playedFromHand（混亂改由中央函式施加）
    return { ...p, active: { ...target }, bench: newBench };
  });
  // v5.444：換上場後再經中央 applyStatusToOppActive 施加【混亂】。
  //   媚惑引誘是【特性】(regA 花潔夫人) → kind='ability-effect'；化隱 / 憨憨臉等免疫
  //   （化隱在備戰也保護，換上來後仍應免疫）。
  return applyStatusToOppActive(st, idx, 'confused', pool, { kind: 'ability-effect', label: '媚惑引誘' });
});

// ── 9. 大劍鬼｜激流旋渦 ──────────────────────────────────────────────────────
// 卡面：「在自己的回合時可使用 1 次。將自己的戰鬥寶可夢與備戰寶可夢互換。
//        然後，對手將對手自己的戰鬥寶可夢與備戰寶可夢互換。」
//
// 流程：
//   step1: 自方選 1 隻備戰互換
//   step2: 互換後若對手有備戰，開 opp-bench-choose 由對手選 1 隻互換
//   注意：對手選擇時 sourcePlayerIdx 仍是對手（同 除蟲噴霧 pattern），
//        actorIdx 改為對手 dIdx — 由對手做選擇
regA('大劍鬼', 0, (st, idx, _pool, _cardInst) => {
  const p = st.players[idx];
  if (!p.active) return addLog(st, '激流旋渦：戰鬥場沒有寶可夢', idx);
  if (p.bench.length === 0) {
    return addLog(st, '激流旋渦：備戰區沒有寶可夢可互換', idx);
  }
  const s = addLog(st, '激流旋渦：選 1 隻自己的備戰寶可夢與戰鬥場互換', idx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'samurott-vortex-self',
    params: { validIids: p.bench.map(c => c.iid) },
  });
});
regR('samurott-vortex-self', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  const p = st.players[idx];
  if (!p.active || !targetIid) return st;
  const bIdx = p.bench.findIndex(b => b.iid === targetIid);
  if (bIdx < 0) return st;
  const oldActive = clearActiveEffects(p.active);
  // v5.248：補 movedToActiveThisTurn flag
  const newActive = { ...p.bench[bIdx], movedToActiveThisTurn: true };
  const newBench = [...p.bench];
  newBench[bIdx] = oldActive;
  const oldName = pool.get(p.active.cardId)?.name ?? '?';
  const newName = pool.get(newActive.cardId)?.name ?? '?';
  st = addLog(st, `激流旋渦：自方 ${oldName} ↔ ${newName} 互換完成`, idx);
  st = updatePlayer(st, idx, pl => ({ ...pl, active: newActive, bench: newBench }));

  // 接著由對手互換戰↔備戰
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  // v5.248：對手沒備戰可換的兩條 return 出口前先 prompt (此時 pendingSelection 未 set)
  if (!dp.active) return tryPromptPromoteActive(addLog(st, '激流旋渦：對手戰鬥場無寶可夢，跳過', idx), idx, pool);
  if (dp.bench.length === 0) {
    return tryPromptPromoteActive(addLog(st, '激流旋渦：對手備戰區無寶可夢可互換', idx), idx, pool);
  }
  // v5.839：特性換位=ability-effect → 化隱/光之翼免疫者 active 不被強制換位。
  if (dp.active) { const _g = canApplyEffectToTarget(st, idx, dp.active, pool.get(dp.active.cardId), 'ability-effect', pool);
    if (_g.blocked) return tryPromptPromoteActive(addLog(st, `激流旋渦：對手 ${_g.reason}（不被換位）`, idx), idx, pool); }
  st = addLog(st, '激流旋渦：對手選 1 隻自方備戰寶可夢與戰鬥場互換', idx);
  return withPending(st, {
    // 由對手選自己的備戰，所以 actorIdx = dIdx
    type: 'bench-choose', actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'samurott-vortex-opp',
    params: { validIids: dp.bench.map(c => c.iid) },
  });
});
regR('samurott-vortex-opp', (st, _origIdx, iids, _params, pool) => {
  // 由對手做選擇，所以 _origIdx 是對手；要互換的是對手自己的戰鬥/備戰
  const dIdx = _origIdx;
  const targetIid = iids[0];
  const dp = st.players[dIdx];
  if (!dp.active || !targetIid) return st;
  const bIdx = dp.bench.findIndex(b => b.iid === targetIid);
  if (bIdx < 0) return st;
  const oldActive = clearActiveEffects(dp.active);
  const newActive = dp.bench[bIdx];
  const newBench = [...dp.bench];
  newBench[bIdx] = oldActive;
  const oldName = pool.get(dp.active.cardId)?.name ?? '?';
  const newName = pool.get(newActive.cardId)?.name ?? '?';
  st = addLog(st, `激流旋渦：對手 ${oldName} ↔ ${newName} 互換完成`, dIdx);
  // v5.248：對手換場完成後 prompt 大劍鬼方 (= 1 - dIdx) 的上場特性
  //   (大劍鬼方在 samurott-vortex-self 階段已 set movedToActiveThisTurn=true,
  //    helper 內 check 仍 true → 觸發 prompt)
  const sajuIdx = (1 - dIdx) as 0 | 1;
  return tryPromptPromoteActive(
    updatePlayer(st, dIdx, pl => ({ ...pl, active: newActive, bench: newBench })),
    sajuIdx, pool,
  );
});

// ── 10. 直衝熊｜激動衝刺 ─────────────────────────────────────────────────────
// 卡面：「若這隻寶可夢在備戰區，且自己的場上有『超級進化寶可夢【ex】』，則在
//        自己的回合時可使用 1 次。將這隻寶可夢與戰鬥寶可夢互換。」
// gate：cardInst 在備戰 + 自方場有任何屬性超級進化ex（engine 加 gate）+ 每回合 1 次
regA('直衝熊', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  if (!cardInst || !p.active) return st;
  const bIdx = p.bench.findIndex(c => c.iid === cardInst.iid);
  if (bIdx < 0) return addLog(st, '激動衝刺：直衝熊不在備戰區', idx);

  // gate：場上需有超級進化ex
  const all: CardInstance[] = [p.active, ...p.bench];
  const hasMegaEx = all.some(c => {
    const card = pool.get(c.cardId);
    return card?.name?.startsWith('超級')
      && (card?.subtype === 'ex' || (card?.name?.endsWith('ex') ?? false));
  });
  if (!hasMegaEx) return addLog(st, '激動衝刺：場上沒有超級進化【ex】', idx);

  const oldActive = clearActiveEffects(p.active);
  // v5.248：補 movedToActiveThisTurn flag
  const newActive = { ...p.bench[bIdx], movedToActiveThisTurn: true };
  const newBench = [...p.bench];
  newBench[bIdx] = oldActive;
  const oldName = pool.get(p.active.cardId)?.name ?? '?';
  const newName = pool.get(newActive.cardId)?.name ?? '?';
  const s = addLog(st, `激動衝刺：${newName} 上場（與 ${oldName} 互換）`, idx);
  // v5.248：自方換位 ON_PROMOTE_TO_ACTIVE prompt (直衝熊|激動衝刺是特性)
  return tryPromptPromoteActive(
    updatePlayer(s, idx, pl => ({ ...pl, active: newActive, bench: newBench })),
    idx, pool,
  );
});

// ── 11. 魔幻假面喵｜表演時間 ─────────────────────────────────────────────────
// 卡面：「若這隻寶可夢在備戰區，則在自己的回合時可使用 1 次。
//        將這隻寶可夢與戰鬥寶可夢互換。」
// gate：cardInst 在備戰（engine 加 gate）+ 每回合 1 次
regA('魔幻假面喵', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  if (!cardInst || !p.active) return st;
  const bIdx = p.bench.findIndex(c => c.iid === cardInst.iid);
  if (bIdx < 0) return addLog(st, '表演時間：魔幻假面喵不在備戰區', idx);

  const oldActive = clearActiveEffects(p.active);
  // v5.248：補 movedToActiveThisTurn flag
  const newActive = { ...p.bench[bIdx], movedToActiveThisTurn: true };
  const newBench = [...p.bench];
  newBench[bIdx] = oldActive;
  const oldName = pool.get(p.active.cardId)?.name ?? '?';
  const newName = pool.get(newActive.cardId)?.name ?? '?';
  const s = addLog(st, `表演時間：${newName} 上場（與 ${oldName} 互換）`, idx);
  // v5.248：自方換位 ON_PROMOTE_TO_ACTIVE prompt (魔幻假面喵|表演時間是特性)
  return tryPromptPromoteActive(
    updatePlayer(s, idx, pl => ({ ...pl, active: newActive, bench: newBench })),
    idx, pool,
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 其他
// ══════════════════════════════════════════════════════════════════════════════

// ── 12. 凱西｜瞬間移動者 ─────────────────────────────────────────────────────
// 卡面：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用 1 次。
//        將這隻寶可夢與附加的卡，全部放回自己的牌庫並重洗。」
// gate：cardInst 在戰鬥場（engine 加 gate）+ 每回合 1 次
//
// 注意：自己戰鬥位回去後 active 為 null，需提示玩家上備戰（PTCG 規則：
//   「若戰鬥場昏厥/離場，必須上 1 隻備戰」— engine 既有「forcePromoteAfterKO」邏輯
//   會偵測 active==null 並觸發；不過此特性是「自己主動移除」非 KO，
//   引擎邏輯實測會在 USE_ABILITY 後 checkActiveAlive 觸發 promote 流程）。
regA('凱西', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  if (!p.active) return addLog(st, '瞬間移動者：戰鬥場沒有寶可夢', idx);
  if (cardInst && p.active.iid !== cardInst.iid) {
    return addLog(st, '瞬間移動者：凱西不在戰鬥場上', idx);
  }
  if (p.bench.length === 0) {
    return addLog(st, '瞬間移動者：備戰區沒有寶可夢可上場（規則：移除後將輸掉）', idx);
  }

  const active = p.active;
  const cardId = active.cardId;
  const energyCardIds = active.energyAttached.map((e: CardInstance) => e.cardId);
  const toolCardId = active.toolAttached?.cardId;
  // evolvedFromStack: 進化前的 CardInstance 堆疊（此特性是基礎，理應為空）
  const stackCardIds: string[] = (active.evolvedFromStack ?? []).map((s: CardInstance) => s.cardId);

  // 1) 把所有卡（自身 + 能量 + 道具 + 進化堆）放回牌庫
  // 2) 重洗
  // 3) 戰鬥場改為 null（讓 engine 提示上備戰）
  // 4) 開 bench-choose pending 讓玩家選備戰上場
  const allCardIdsToReturn: string[] = [
    cardId,
    ...stackCardIds,
    ...energyCardIds,
    ...(toolCardId ? [toolCardId] : []),
  ];
  // 為了走「整捆放回牌庫」，建立新 CardInstance（重新賦予 iid 以避免衝突 — 用簡單的時間戳前綴）
  // 由於 newInstance 在 engine 內部、_shared 沒 export，這裡用 cardId-based push
  // 直接用既有 CardInstance shape：iid 隨機 generate（PTCG 規則牌庫卡片 iid 對手不可見，等同新卡）
  const newDeckEntries = allCardIdsToReturn.map(cid => ({
    iid: `tp-${cid}-${Math.random().toString(36).slice(2, 9)}`,
    cardId: cid,
    energyAttached: [],
    damage: 0,
  } as CardInstance));

  const name = pool.get(cardId)?.name ?? '凱西';
  let s = addLog(st, `瞬間移動者：${name} 與附加的卡（${allCardIdsToReturn.length} 張）放回牌庫並重洗`, idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl,
    active: null,
    deck: shuffle([...pl.deck, ...newDeckEntries]),
  }));
  // 開 bench-choose pending 讓玩家上備戰
  const benchIids = s.players[idx].bench.map(c => c.iid);
  s = addLog(s, '瞬間移動者：選擇 1 隻備戰寶可夢上場', idx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'teleporter-promote',
    params: { validIids: benchIids },
  });
});
regR('teleporter-promote', (st, idx, iids, _params, pool) => {
  const p = st.players[idx];
  const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
  if (bIdx < 0) return st;
  // v4.55：設 movedToActiveThisTurn — 觸發疾風直撞/暴衝閃光/進擊破壞 等「本回合備戰→戰鬥場」條件
  const newActive: CardInstance = { ...p.bench[bIdx], movedToActiveThisTurn: true };
  const newBench = [...p.bench];
  newBench.splice(bIdx, 1);
  const name = pool.get(newActive.cardId)?.name ?? '?';
  const s = addLog(st, `瞬間移動者：${name} 上場`, idx);
  // v5.244：自方換位 ON_PROMOTE_TO_ACTIVE prompt（凱西|瞬間移動者是特性）
  return tryPromptPromoteActive(
    updatePlayer(s, idx, pl => ({ ...pl, active: newActive, bench: newBench })),
    idx, pool,
  );
});

// ── 13. 大力鱷｜奔流之心 ─────────────────────────────────────────────────────
// 卡面：「在自己的回合時可使用 1 次。在這隻寶可夢身上放置 5 個傷害指示物。
//        這個情況下，在這個回合，這隻寶可夢使用的招式，對對手的戰鬥寶可夢
//        造成的傷害『+120』點。」
// gate：每回合 1 次（engine 處理）
regA('大力鱷', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  // 找觸發源實例
  const allPokes: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  const src = cardInst
    ? allPokes.find(c => c.iid === cardInst.iid)
    : allPokes.find(c => pool.get(c.cardId)?.name === '大力鱷');
  if (!src) return addLog(st, '奔流之心：找不到大力鱷', idx);
  const name = pool.get(src.cardId)?.name ?? '大力鱷';

  const isActive = p.active?.iid === src.iid;
  const s = addLog(st, `奔流之心：${name} 放置 5 個傷害指示物，本回合招式 +120 傷害`, idx);
  return updatePlayer(s, idx, pl => {
    if (isActive && pl.active) {
      return {
        ...pl,
        active: {
          ...pl.active,
          damage: pl.active.damage + 50,
          damageBonusThisTurn: (pl.active.damageBonusThisTurn ?? 0) + 120,
        },
      };
    }
    return {
      ...pl,
      bench: pl.bench.map(c => c.iid === src.iid
        ? { ...c, damage: c.damage + 50, damageBonusThisTurn: (c.damageBonusThisTurn ?? 0) + 120 }
        : c),
    };
  });
});

// ── 14. 雪絨蛾｜勸誘羽 ───────────────────────────────────────────────────────
// 卡面：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用 1 次。
//        雙方玩家各從牌庫抽出 1 張卡。」
// gate：cardInst 在戰鬥場（engine 加 gate）+ 每回合 1 次
regA('雪絨蛾', 0, (st, idx, _pool, _cardInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  let s = addLog(st, '勸誘羽：雙方各從牌庫抽 1 張卡', idx);
  s = drawCards(s, idx, 1);
  s = drawCards(s, dIdx, 1);
  return s;
});
