// ════════════════════════════════════════════════════════════════════════════
// M5（深淵之瞳）J 標補實裝 — coverage 檢查揪出的 3 張未實裝招式（v5.455）
//
// 來源：scripts/coverage-unimplemented.mjs 掃出現行卡池(H/I/J 標)中招式有 effect
//   文字、但引擎查無 handler（卡名|招式名 無 fallback → 效果靜默失效）的 3 張。
// 官網卡面已逐張確認（Rule 15）：
//   - 薩戮德|後投(19198)、盔甲鳥|鋼鐵利刃(19202)、青銅鐘|金屬障礙(19206)
// ════════════════════════════════════════════════════════════════════════════
import {
  regPre, regPost, regR, addLog, updatePlayer, withPending, ATTACK_PRE_DISCARD_CHOICE,
} from '../_shared';
import type { CardInstance } from '../../types';
import { isBasicEnergyOfType } from '../../engine';

// ── ① 薩戮德｜後投 — 30 + 自己選 1 隻備戰寶可夢也受 30（不計弱抗）──────────
//   卡面：「自己的1隻備戰寶可夢也受到30點傷害。[在備戰區不計算弱點・抵抗力。]」
//   主 30 傷由 base damage 結算；POST 開 bench-choose 讓攻擊方選 1 隻自方備戰受 30。
regPost('薩戮德|後投', (state, aIdx) => {
  const player = state.players[aIdx];
  if (player.bench.length === 0) {
    return addLog(state, '後投：自方無備戰寶可夢，略過自損', aIdx);
  }
  const s = addLog(state, '後投：選 1 隻自方備戰寶可夢，受到 30 點傷害', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'm5j-zarude-backthrow',
    params: { amount: 30 },
  });
});
regR('m5j-zarude-backthrow', (state, aIdx, iids, params) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 30;
  const tid = iids[0];
  return updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => b.iid === tid ? { ...b, damage: (b.damage ?? 0) + amount } : b),
  }));
});

// ── ② 盔甲鳥｜鋼鐵利刃 — 40× 從手牌丟最多 2 張基本【鋼】能量，造成張數×40 ────
//   卡面：「從自己的手牌將最多2張「基本【鋼】能量」卡丟棄，造成其張數×40點傷害。」
ATTACK_PRE_DISCARD_CHOICE.set('盔甲鳥|鋼鐵利刃', {
  min: 0, max: 2, scope: 'hand-energy', energyTypeFilter: 'Metal',
  baseDamage: 0, damagePerEnergy: 40,
});
regPre('盔甲鳥|鋼鐵利刃', (state, aIdx, pool, action) => {
  const player = state.players[aIdx];
  const chosen = action?.discardedEnergyIids;
  // 只認手牌中的「基本【鋼】能量」（基本能量 pokemonType 為 null，必用 isBasicEnergyOfType 名稱辨識）
  const handMetal = player.hand.filter(c => {
    const card = pool.get(c.cardId);
    return !!card && isBasicEnergyOfType(card, 'Metal');
  });
  let toDiscard: CardInstance[] = [];
  if (chosen && chosen.length > 0) {
    const allowed = new Set(handMetal.map(en => en.iid));
    const capped = chosen.filter(id => allowed.has(id)).slice(0, 2);
    const set = new Set(capped);
    toDiscard = handMetal.filter(en => set.has(en.iid));
  }
  let s = state;
  if (toDiscard.length > 0) {
    s = updatePlayer(s, aIdx, p => ({
      ...p,
      hand: p.hand.filter(c => !toDiscard.some(d => d.iid === c.iid)),
      discard: [...p.discard, ...toDiscard],
    }));
    s = addLog(s, `鋼鐵利刃：丟棄手牌 ${toDiscard.length} 張基本【鋼】能量 → ${toDiscard.length * 40} 傷害`, aIdx);
  } else {
    s = addLog(s, '鋼鐵利刃：未丟手牌基本【鋼】能量 → 0 傷害', aIdx);
  }
  return { state: s, damage: toDiscard.length * 40 };
});

// ── ③ 青銅鐘｜金屬障礙 — 120 + 下個對手回合，這隻受進化寶可夢招式傷害 -100 ──
//   卡面：「在下個對手的回合，這隻寶可夢受到進化寶可夢招式的傷害「-100」點。」
//   仿雷電獸|閃光屏障 immuneToEvolutionAttackNextTurn，但為「-100 減傷」非全免：
//   設 evolutionDamageReduceNextTurn=100，engine END_TURN promote 為 ThisTurn，
//   傷害結算時若 attacker 為進化寶可夢則 baseDamage -100（engine.ts）。
regPost('青銅鐘|金屬障礙', (state, aIdx) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  return updatePlayer(
    addLog(state, '金屬障礙：下個對手回合，這隻寶可夢受進化寶可夢招式傷害 -100', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, evolutionDamageReduceNextTurn: 100 } : null,
    }),
  );
});
