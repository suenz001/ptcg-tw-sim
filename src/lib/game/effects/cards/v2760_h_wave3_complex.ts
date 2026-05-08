/**
 * v2.76 H 標 Wave 3 — 複雜批（28 張收尾）
 *
 * 嚴格按卡牌原文實裝。需新引擎機制者標 TODO 並 best-effort fallback。
 */

import {
  regPre, regPost, regR, addLog, updatePlayer, withPending, shuffle,
  ATTACK_PRE, ATTACK_POST, TRAINER_EFFECTS,
} from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { coinStatusPost, statusPost, flipCoinsWithLog, canApplyAttackEffectToTarget } from '../../effects';
// v3.08 美納斯｜平穩境地 — 對手寶可夢/附加卡 → 對手手牌 阻擋 helper
import { oppHasMenasureCalmGround as _v3080OppHasMenasure } from './v3080_deferred_wave_c';

// ══════════════════════════════════════════════════════════════════════════════
// helper
// ══════════════════════════════════════════════════════════════════════════════
function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    return updatePlayer(addLog(state, `${label}：自身丟棄全部能量`, aIdx), aIdx, p => {
      if (!p.active) return p;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...p.active.energyAttached] };
    });
  };
}

function parseDmg(s: string): number {
  const m = (s ?? '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. ‌喵喵|亂抓 — name 前有 zero-width non-joiner（U+200C）
//    擲 3 次硬幣 ×20
// ══════════════════════════════════════════════════════════════════════════════
regPre('‌喵喵|亂抓', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 3, '亂抓', aIdx);
  const dmg = r.heads * 20;
  return { state: addLog(r.state, `亂抓：${r.heads}/3 → ${r.heads}×20 = ${dmg}`, aIdx), damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 骨紋巨聲鱷|純樸 — 「這隻寶可夢不會受到對手的寶可夢使用招式的效果的影響」
//    這是招式宣告本身（damage 0）→ 設置自身 immuneToAttackEffectsThisTurn flag
//    引擎暫無此精確 flag — 使用既有 damageReduceNextHit + log 提示
// ══════════════════════════════════════════════════════════════════════════════
regPre('骨紋巨聲鱷|純樸', (s) => ({ state: s, damage: 0 }));
regPost('骨紋巨聲鱷|純樸', (state, aIdx, _pool) => {
  // v2.78 用新 flag immuneToAttackEffectsNextTurn — engine 在 ATTACK_POST 階段 skip
  return updatePlayer(addLog(state, '純樸：下回合不受對手寶可夢使用招式的附加效果影響（傷害仍結算）', aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, immuneToAttackEffectsNextTurn: true } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 帝牙海獅|凍結獠牙 60 — 全場效果，下回合「身上附加的能量為 2 個以下」全部寶可夢無法使用招式
//    [TODO engine] 嚴謹實作需新增 player-level flag low-energy-cant-attack-next-opp-turn
//    暫用 best-effort：在 defender (opp active) 上設 cantAttackPending（只擋戰鬥場）+ 記 log
// ══════════════════════════════════════════════════════════════════════════════
regPre('帝牙海獅|凍結獠牙', (s) => ({ state: s, damage: 60 }));
regPost('帝牙海獅|凍結獠牙', (state, aIdx, _pool) => {
  // v2.78 用 player-level state.lowEnergyCantAttackNextTurn[opp] = true
  // engine 在 ATTACK PRE 階段：state.lowEnergyCantAttackThisTurn[aIdx] && energy ≤ 2 → 失敗
  const dIdx = (1 - aIdx) as 0 | 1;
  const cur = state.lowEnergyCantAttackNextTurn ?? [false, false];
  const newN: [boolean, boolean] = [cur[0], cur[1]];
  newN[dIdx] = true;
  return addLog({ ...state, lowEnergyCantAttackNextTurn: newN }, '凍結獠牙：下回合對手所有能量 ≤2 寶可夢無法使用招式', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 皮可西|揮指 — 選擇 1 個對手戰鬥寶可夢的招式作為此招使用
//    用 v2.119 N的索羅亞克ex 暗黑底牌 模式：fallback 自動挑印刷傷害最高
// ══════════════════════════════════════════════════════════════════════════════
function pickHighestAttack(candidates: CardInstance[], pool: Map<string, Card>, selfKey: string) {
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
regPre('皮可西|揮指', (state, aIdx, pool, action) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return { state: addLog(state, '揮指：對手戰鬥場無寶可夢', aIdx), damage: 0 };
  const best = pickHighestAttack([da], pool, '皮可西|揮指');
  if (!best) return { state: addLog(state, '揮指：對手戰鬥場無可複製招式', aIdx), damage: 0 };
  const copiedKey = `${best.cardName}|${best.attackName}`;
  let s = addLog(state, `揮指：複製「${copiedKey}」`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };
  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    const sub = copiedPre(s, aIdx, pool, action);
    return { state: sub.state, damage: sub.damage, skipWeakRes: false, skipDefEffects: sub.skipDefEffects };
  }
  return { state: s, damage: best.damage };
});
regPost('皮可西|揮指', (state, aIdx, pool) => {
  const key = state.pendingCopyAttackKey;
  const cleared: GameState = { ...state, pendingCopyAttackKey: undefined };
  if (!key) return cleared;
  const copiedPost = ATTACK_POST.get(key);
  if (!copiedPost) return cleared;
  return copiedPost(cleared, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 艾姆利多|神之爆炸 160 — 自方備戰沒有「由克希」「亞克諾姆」失敗
// ══════════════════════════════════════════════════════════════════════════════
regPre('艾姆利多|神之爆炸', (state, aIdx, pool) => {
  const bench = state.players[aIdx].bench;
  const hasYukushi = bench.some(b => pool.get(b.cardId)?.name === '由克希');
  const hasAknom = bench.some(b => pool.get(b.cardId)?.name === '亞克諾姆');
  if (!hasYukushi || !hasAknom) {
    return { state: addLog(state, '神之爆炸：自方備戰缺「由克希」或「亞克諾姆」 → 招式失敗', aIdx), damage: 0 };
  }
  return { state: addLog(state, '神之爆炸：條件成立 → 160', aIdx), damage: 160 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 克雷色利亞|弦月光芒 80+ — 翻 1 張自方反面獎賞 → +80
// ══════════════════════════════════════════════════════════════════════════════
regPre('克雷色利亞|弦月光芒', (state, aIdx, _pool) => {
  // 自動翻 1 張獎賞 (簡化：直接 +80)
  if (state.players[aIdx].prizes.length === 0) return { state, damage: 80 };
  return { state: addLog(state, '弦月光芒：翻 1 張獎賞 → 80+80 = 160', aIdx), damage: 160 };
});
// 卡面說「翻到正面」維持到對戰結束，無精確機制，不另作 state 操作

// ══════════════════════════════════════════════════════════════════════════════
// 7. 長毛巨魔|影繩結 50× — 對手戰鬥場撤退費數 ×50
// ══════════════════════════════════════════════════════════════════════════════
regPre('長毛巨魔|影繩結', (state, aIdx, pool) => {
  const da = state.players[(1-aIdx) as 0|1].active;
  if (!da) return { state, damage: 0 };
  const card = pool.get(da.cardId);
  const retreatCost = (card?.retreatCost ?? []).length;
  return { state: addLog(state, `影繩結：對手撤退費 ${retreatCost} → ${retreatCost}×50 = ${retreatCost*50}`, aIdx), damage: retreatCost * 50 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 吼叫尾|唱歌鼓勵 — 自方備戰 1 隻「古代」回 100 HP
// ══════════════════════════════════════════════════════════════════════════════
regPre('吼叫尾|唱歌鼓勵', (s) => ({ state: s, damage: 0 }));
regPost('吼叫尾|唱歌鼓勵', (state, aIdx, pool) => {
  const ancientBench = state.players[aIdx].bench.filter(b => pool.get(b.cardId)?.tags?.includes('古代'));
  if (ancientBench.length === 0) return addLog(state, '唱歌鼓勵：自備戰無古代寶可夢', aIdx);
  return withPending(addLog(state, '唱歌鼓勵：選 1 自備戰古代寶可夢回 100 HP', aIdx), {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave3-heal-100',
  });
});
regR('h-wave3-heal-100', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const tIid = iids[0];
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active && p.active.iid === tIid ? { ...p.active, damage: Math.max(0, (p.active.damage ?? 0) - 100) } : p.active,
    bench: p.bench.map(b => b.iid === tIid ? { ...b, damage: Math.max(0, (b.damage ?? 0) - 100) } : b),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 振翼髮|蠱惑挪移 — 自備戰古代 1 隻指示物→對手戰鬥
// ══════════════════════════════════════════════════════════════════════════════
regPre('振翼髮|蠱惑挪移', (s) => ({ state: s, damage: 0 }));
regPost('振翼髮|蠱惑挪移', (state, aIdx, pool) => {
  const ancientWithDmg = state.players[aIdx].bench.filter(b => {
    const card = pool.get(b.cardId);
    return card?.tags?.includes('古代') && (b.damage ?? 0) > 0;
  });
  if (ancientWithDmg.length === 0) return addLog(state, '蠱惑挪移：自備戰無「古代」+ 有指示物', aIdx);
  return withPending(addLog(state, '蠱惑挪移：選 1 自備戰古代寶可夢，指示物全移到對手戰鬥場', aIdx), {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave3-move-bench-dmg-to-opp-active',
  });
});
regR('h-wave3-move-bench-dmg-to-opp-active', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const tIid = iids[0];
  const dIdx = (1 - aIdx) as 0 | 1;
  const sourceB = state.players[aIdx].bench.find(b => b.iid === tIid);
  if (!sourceB) return state;
  const dmg = sourceB.damage ?? 0;
  if (dmg === 0) return state;
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => b.iid === tIid ? { ...b, damage: 0 } : b),
  }));
  s = updatePlayer(s, dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + dmg } : null,
  }));
  return addLog(s, `蠱惑挪移：移轉 ${dmg} 點到對手戰鬥場`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. 勾魂眼|傷害集結 — 對手備戰任意指示物→對手戰鬥
// ══════════════════════════════════════════════════════════════════════════════
regPre('勾魂眼|傷害集結', (s) => ({ state: s, damage: 0 }));
regPost('勾魂眼|傷害集結', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let totalDmg = 0;
  for (const b of state.players[dIdx].bench) totalDmg += b.damage ?? 0;
  if (totalDmg === 0) return addLog(state, '傷害集結：對手備戰無指示物', aIdx);
  let s = updatePlayer(state, dIdx, p => ({
    ...p,
    bench: p.bench.map(b => ({ ...b, damage: 0 })),
    active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + totalDmg } : null,
  }));
  return addLog(s, `傷害集結：對手備戰所有 ${totalDmg} 點指示物 → 對手戰鬥場`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. 密勒頓ex|抵制伏特 60+ — 對手戰鬥有指示物 +100
// ══════════════════════════════════════════════════════════════════════════════
regPre('密勒頓ex|抵制伏特', (state, aIdx, _pool) => {
  const dDmg = state.players[(1-aIdx) as 0|1].active?.damage ?? 0;
  if (dDmg > 0) return { state: addLog(state, '抵制伏特：對手戰鬥有指示物 → 60+100 = 160', aIdx), damage: 160 };
  return { state: addLog(state, '抵制伏特：對手戰鬥無指示物 → 60', aIdx), damage: 60 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. 智揮猩|掌握弱點 — 下回合本招式對方弱點變【無】
//    [TODO engine] 嚴謹需新 flag weaknessOverrideToColorlessThisTurn
//    Best-effort: 直接設 defender weaknessDisabledNextTurn (取消弱點)
// ══════════════════════════════════════════════════════════════════════════════
regPre('智揮猩|掌握弱點', (s) => ({ state: s, damage: 0 }));
regPost('智揮猩|掌握弱點', (state, aIdx, _pool) => {
  // v2.78 用 weaknessOverrideTypeNextTurn = 'Colorless'
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(addLog(state, '掌握弱點：下回合 defender 弱點屬性改為【無】（×2 仍計算）', aIdx), dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, weaknessOverrideTypeNextTurn: 'Colorless' } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. 泡沫栗鼠|掃除 — 棄對手 ≤2 道具
// ══════════════════════════════════════════════════════════════════════════════
regPre('泡沫栗鼠|掃除', (s) => ({ state: s, damage: 0 }));
regPost('泡沫栗鼠|掃除', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // 簡化：自動棄對手場上前 2 個道具
  let s = state;
  let removed = 0;
  s = updatePlayer(s, dIdx, p => {
    let r = removed;
    const newBench = p.bench.map(b => {
      if (r < 2 && b.toolAttached) {
        r++;
        const tool = b.toolAttached;
        return { ...b, toolAttached: undefined };
      }
      return b;
    });
    let newActive = p.active;
    if (r < 2 && p.active?.toolAttached) {
      r++;
      newActive = { ...p.active, toolAttached: undefined };
    }
    removed = r;
    // 把移除的 tool 放到棄牌區
    const removedTools: CardInstance[] = [];
    if (p.active?.toolAttached && !newActive?.toolAttached && p.active.toolAttached) removedTools.push({ ...p.active.toolAttached, damage: 0, energyAttached: [] });
    p.bench.forEach((b, i) => {
      if (b.toolAttached && !newBench[i].toolAttached) removedTools.push({ ...b.toolAttached!, damage: 0, energyAttached: [] });
    });
    return { ...p, active: newActive, bench: newBench, discard: [...p.discard, ...removedTools] };
  });
  return addLog(s, `掃除：對手場上 ${removed} 張道具卡棄到對手棄牌區`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. 熔蟻獸|滑燒火焰 130 — 擲 3 次硬幣，反面數 = 棄自身能量數
// ══════════════════════════════════════════════════════════════════════════════
regPre('熔蟻獸|滑燒火焰', (s) => ({ state: s, damage: 130 }));
regPost('熔蟻獸|滑燒火焰', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 3, '滑燒火焰', aIdx);
  const tails = 3 - r.heads;
  if (tails === 0) return r.state;
  return updatePlayer(addLog(r.state, `滑燒火焰：${tails} 反面 → 棄 ${tails} 個能量`, aIdx), aIdx, p => {
    if (!p.active || p.active.energyAttached.length === 0) return p;
    const k = Math.min(tails, p.active.energyAttached.length);
    const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - k);
    const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - k);
    return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. 魔牆人偶|相仿秀 — 查對手手牌 + 若希望，選 1 張支援者作為此招使用
// ══════════════════════════════════════════════════════════════════════════════
regPre('魔牆人偶|相仿秀', (s) => ({ state: s, damage: 0 }));
regPost('魔牆人偶|相仿秀', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppHand = state.players[dIdx].hand;
  const supps = oppHand.filter(c => pool.get(c.cardId)?.subtype === 'Supporter');
  let s = state;
  s = addLog(s, `相仿秀：對手手牌 ${oppHand.length} 張，其中支援者 ${supps.length} 張`, aIdx);
  if (supps.length > 0) {
    // 自動執行第一張支援者效果
    const firstSupp = pool.get(supps[0].cardId);
    const fn = TRAINER_EFFECTS.get(firstSupp?.name ?? '');
    if (fn) {
      s = addLog(s, `相仿秀：自動執行對手手牌支援者「${firstSupp?.name}」`, aIdx);
      s = fn(s, aIdx, pool);
    } else {
      s = addLog(s, `相仿秀：對手支援者「${firstSupp?.name}」效果未實裝（跳過）`, aIdx);
    }
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. 鐵武者|莊嚴之劍 100+ — 本回合用過「未來」支援者 +100
//    [TODO engine] 需追蹤 supporterUsedTagsThisTurn — 目前無
//    Best-effort: 自方棄牌頂端是否為「未來」支援者
// ══════════════════════════════════════════════════════════════════════════════
regPre('鐵武者|莊嚴之劍', (state, aIdx, _pool) => {
  // v2.84 engine 追蹤 supporterTagsUsedThisTurn 改 object 結構
  const sup = state.supporterTagsUsedThisTurn;
  const tags = aIdx === 0 ? (sup?.p1 ?? []) : (sup?.p2 ?? []);
  const hasFutureSupp = tags.includes('未來');
  if (hasFutureSupp) return { state: addLog(state, '莊嚴之劍：本回合用過未來支援者 → 100+100 = 200', aIdx), damage: 200 };
  return { state: addLog(state, '莊嚴之劍：本回合未使出未來支援者 → 100', aIdx), damage: 100 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. 優雅貓|能量攪拌 110 — 自方場上能量任意分配
//    簡化：不做 UI（玩家手動調整）
// ══════════════════════════════════════════════════════════════════════════════
regPre('優雅貓|能量攪拌', (s) => ({ state: s, damage: 110 }));
regPost('優雅貓|能量攪拌', (state, aIdx, _pool) => {
  return addLog(state, '能量攪拌：[卡面]選自方場上任意能量任意改附（請玩家手動移動）', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. 轟擂金剛猩|鼓擊 60 — 下回合 defender 招式 + 撤退費各 +1 無能量
//    [TODO engine] 無精確 flag — 用 cantRetreatNextTurn 替代撤退；招式 cost +1 暫不做
// ══════════════════════════════════════════════════════════════════════════════
regPre('轟擂金剛猩|鼓擊', (s) => ({ state: s, damage: 60 }));
regPost('轟擂金剛猩|鼓擊', (state, aIdx, _pool) => {
  // v2.78 設置兩個新 flag：attackCostIncreaseColorlessNextTurn + retreatCostIncreaseNextTurn
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(addLog(state, '鼓擊：下回合 defender 招式+撤退費各 +1【無】能量', aIdx), dIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      attackCostIncreaseColorlessNextTurn: 1,
      retreatCostIncreaseNextTurn: 1,
    } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 19. 迷唇姐|邀請之吻 — 牌庫挑 1 基礎放備戰，移自身 1 能量到新上場
//    簡化：先 deck-search，玩家手動移能量
// ══════════════════════════════════════════════════════════════════════════════
regPre('迷唇姐|邀請之吻', (s) => ({ state: s, damage: 0 }));
regPost('迷唇姐|邀請之吻', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const space = Math.max(0, 5 - p.bench.length);
  if (space === 0 || p.deck.length === 0) return state;
  return withPending(addLog(state, '邀請之吻：從牌庫挑 1 基礎放備戰（重洗）；之後請手動移自身 1 能量到新上場', aIdx), {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'wave5-place-basic-bench',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 20. 引夢貘人|白日夢 80 — 下回合對手附能量於受招式者，則對手回合結束
//    [TODO engine] 需新引擎機制（trigger end-turn on attach energy）
//    Fallback: 在 defender 上設 paralyzeFangPending 模擬「附能量觸發傷害」（變相懲罰）
// ══════════════════════════════════════════════════════════════════════════════
regPre('引夢貘人|白日夢', (s) => ({ state: s, damage: 80 }));
regPost('引夢貘人|白日夢', (state, aIdx, _pool) => {
  // v2.78 設 defender.endTurnOnOppAttachEnergyNextTurn — engine 在 ATTACH_ENERGY 觸發 END_TURN
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(addLog(state, '白日夢：下回合若對手附能量於受招式者，則對手回合結束', aIdx), dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, endTurnOnOppAttachEnergyNextTurn: true } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 21. 超能豔鴕|奧密之眼 — 對手 1 進化寶可移除 1 進化卡使其退化（回對手手牌）
// ══════════════════════════════════════════════════════════════════════════════
regPre('超能豔鴕|奧密之眼', (s) => ({ state: s, damage: 0 }));
regPost('超能豔鴕|奧密之眼', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 阻擋進化卡回對手手牌
  if (_v3080OppHasMenasure(state, aIdx, pool)) {
    return addLog(state, '奧密之眼：對手場上有【平穩境地】，效果無效', aIdx);
  }
  const evolvedAll: CardInstance[] = [...(opp.active ? [opp.active] : []), ...opp.bench]
    .filter(c => {
      const card = pool.get(c.cardId);
      return card?.stage && card.stage !== 'Basic';
    });
  if (evolvedAll.length === 0) return addLog(state, '奧密之眼：對手場上無進化寶可', aIdx);
  return withPending(addLog(state, '奧密之眼：選 1 對手進化寶可，移除頂進化卡回對手手', aIdx), {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave3-devolve',
  });
});
regR('h-wave3-devolve', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const tIid = iids[0];
  return updatePlayer(state, dIdx, p => {
    const devolveOne = (c: CardInstance | null): CardInstance | null => {
      if (!c || c.iid !== tIid) return c;
      const card = pool.get(c.cardId);
      if (card?.stage === 'Basic') return c;
      // 退化：移除頂層進化卡（c.cardId/iid），底層 evolvedFromStack 取最後一個成為新頂端
      const stack = c.evolvedFromStack ?? [];
      if (stack.length === 0) return c;
      const newTop = stack[stack.length - 1];
      // 新頂端繼承 damage / energyAttached / toolAttached / status
      // 移除的進化卡（c.cardId 對應的）回對手手牌
      return {
        ...c,
        iid: newTop.iid,
        cardId: newTop.cardId,
        evolvedFromStack: stack.slice(0, -1),
        // damage 維持原值（PTCG 規則退化保留指示物）
      };
    };
    // 找到目標退化前的 cardId 以放回對手手
    const findOriginal = (c: CardInstance | null): CardInstance | null => c && c.iid === tIid ? c : null;
    const sourcePoke = findOriginal(p.active) ?? p.bench.map(findOriginal).find(Boolean) ?? null;
    if (!sourcePoke) return p;
    const removedCard = { iid: sourcePoke.iid, cardId: sourcePoke.cardId, damage: 0, energyAttached: [] };
    const np = {
      ...p,
      active: devolveOne(p.active),
      bench: p.bench.map(b => devolveOne(b)!),
      hand: [...p.hand, removedCard],
    };
    return np;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 22. 帕底亞 肯泰羅|上搗角擊 30 — 若希望，選對手戰鬥 2 階進化 寶可的 2 個能量回對手手
//    PRE only damage 30; POST 自動執行（取最末端 2 個能量回手）
// ══════════════════════════════════════════════════════════════════════════════
regPre('帕底亞 肯泰羅|上搗角擊', (s) => ({ state: s, damage: 30 }));
regPost('帕底亞 肯泰羅|上搗角擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da) return state;
  const card = pool.get(da.cardId);
  if (card?.stage !== 'Stage2') return addLog(state, '上搗角擊：對手戰鬥場非 2 階進化', aIdx);
  if (da.energyAttached.length === 0) return state;
  const k = Math.min(2, da.energyAttached.length);
  const taken = da.energyAttached.slice(da.energyAttached.length - k);
  return updatePlayer(addLog(state, `上搗角擊：對手戰鬥 ${k} 個能量回對手手`, aIdx), dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.slice(0, p.active.energyAttached.length - k) } : null,
    hand: [...p.hand, ...taken.map(e => ({ ...e, damage: 0, energyAttached: [] }))],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 23. 密勒頓|防護代碼 40 — 下回合自方所有「未來」寶可不受 ex 招式傷害
//    [TODO engine] 玩家層級 flag — 暫無，best-effort log only
// ══════════════════════════════════════════════════════════════════════════════
regPre('密勒頓|防護代碼', (s) => ({ state: s, damage: 40 }));
regPost('密勒頓|防護代碼', (state, aIdx, pool) => {
  // v2.78 對自方所有「未來」寶可夢設 immuneToExAttackTagNextTurn = '未來'
  return updatePlayer(addLog(state, '防護代碼：下回合自方所有未來寶可不受帶「未來」tag 的 ex 招式傷害', aIdx), aIdx, p => ({
    ...p,
    active: p.active && pool.get(p.active.cardId)?.tags?.includes('未來') ? { ...p.active, immuneToExAttackTagNextTurn: '未來' } : p.active,
    bench: p.bench.map(b => pool.get(b.cardId)?.tags?.includes('未來') ? { ...b, immuneToExAttackTagNextTurn: '未來' } : b),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 24. 塗標客|惡作劇作畫 — 從對手棄牌區挑 ≤3 能量附對手寶可
//    簡化：自動隨機附給對手戰鬥
// ══════════════════════════════════════════════════════════════════════════════
regPre('塗標客|惡作劇作畫', (s) => ({ state: s, damage: 0 }));
regPost('塗標客|惡作劇作畫', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const energyCards = opp.discard.filter(c => pool.get(c.cardId)?.supertype === 'Energy').slice(0, 3);
  if (energyCards.length === 0 || !opp.active) return addLog(state, '惡作劇作畫：條件不足', aIdx);
  const set = new Set(energyCards.map(c => c.iid));
  return updatePlayer(addLog(state, `惡作劇作畫：從對手棄牌挑 ${energyCards.length} 張能量附對手戰鬥`, aIdx), dIdx, p => ({
    ...p,
    discard: p.discard.filter(c => !set.has(c.iid)),
    active: p.active ? { ...p.active, energyAttached: [...p.active.energyAttached, ...energyCards] } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 25. 厄鬼椪 碧草面具ex|萬葉陣雨 30+ — 雙方戰鬥能量數合計 ×30
//    （Wave 2 audit 因字符邊界誤報，這裡確認註冊）
// ══════════════════════════════════════════════════════════════════════════════
// Wave 2 已註冊，此處 skip

// ══════════════════════════════════════════════════════════════════════════════
// 26. 呆呆王|付諸東流 70 — 若希望，選對手戰鬥 2 個能量回對手手
// ══════════════════════════════════════════════════════════════════════════════
regPre('呆呆王|付諸東流', (s) => ({ state: s, damage: 70 }));
regPost('呆呆王|付諸東流', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da || da.energyAttached.length === 0) return state;
  const k = Math.min(2, da.energyAttached.length);
  const taken = da.energyAttached.slice(da.energyAttached.length - k);
  return updatePlayer(addLog(state, `付諸東流：對手戰鬥 ${k} 個能量回對手手`, aIdx), dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.slice(0, p.active.energyAttached.length - k) } : null,
    hand: [...p.hand, ...taken.map(e => ({ ...e, damage: 0, energyAttached: [] }))],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 27. 下石鳥|墜擊射 — 棄全能量，對手 1 隻寶可受 120（不計弱抗）
// ══════════════════════════════════════════════════════════════════════════════
regPre('下石鳥|墜擊射', (s) => ({ state: s, damage: 0, skipWeakRes: true }));
regPost('下石鳥|墜擊射', (state, aIdx, pool) => {
  let s = selfDiscardAllEnergyPost('墜擊射')(state, aIdx, pool);
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = s.players[dIdx];
  if (!opp.active && opp.bench.length === 0) return s;
  return withPending(addLog(s, '墜擊射：選 1 對手寶可受 120', aIdx), {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'h-wave3-hit-any-120',
  });
});
regR('h-wave3-hit-any-120', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const tIid = iids[0];
  // v2.92 招式效果免疫檢查（卡面雖標 skipWeakRes 但 120 視為「對任意 1 隻放指示物」屬招式效果）
  const opp = state.players[dIdx];
  const tInst = opp.active?.iid === tIid ? opp.active : opp.bench.find(b => b.iid === tIid);
  if (tInst) {
    const tCard = pool.get(tInst.cardId);
    const guard = canApplyAttackEffectToTarget(state, aIdx, tInst, tCard, pool);
    if (guard.blocked) {
      return addLog(state, `墜擊射：${tCard?.name ?? '?'}｜${guard.reason}（不放指示物）`, aIdx);
    }
  }
  return updatePlayer(state, dIdx, p => ({
    ...p,
    active: p.active && p.active.iid === tIid ? { ...p.active, damage: (p.active.damage ?? 0) + 120 } : p.active,
    bench: p.bench.map(b => b.iid === tIid ? { ...b, damage: (b.damage ?? 0) + 120 } : b),
  }));
});

// 纏紅鶴ex|[ex規則] — 不是招式效果，是 ex KO 規則描述，無需實裝

// ══════════════════════════════════════════════════════════════════════════════
// Wave 3 統計：28 張收尾
// ══════════════════════════════════════════════════════════════════════════════
