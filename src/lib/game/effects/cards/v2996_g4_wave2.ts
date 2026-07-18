/**
 * v2.996 Group 4 Wave 2 — 10 張牌庫/手牌/棄牌操作類主動特性實裝
 *
 * 來源：ABILITY_AUDIT_V2_98.md Group 4，挑「操作牌庫/手牌/棄牌」與對手互動的卡。
 *
 * 牌庫搜尋類 (3)：
 *   1. 豆豆鴿｜緊急進化           — HP≤30 → 牌庫挑「高傲雉雞/高傲雉雞ex」直接進化（跳階）+ 重洗
 *   2. 保母曼波｜溫柔鰭           — 戰鬥場 → 棄牌區挑 HP≤70 基礎寶可夢放備戰
 *   3. 始祖大鳥｜原始之翼         — 戰鬥場 → 對手 1 隻進化寶可夢退化 1 層，移除卡放對手手牌
 *
 * 手牌/棄牌操作類 (3)：
 *   4. 烈焰猴｜火焰蹈舞           — 手牌挑【火】+ 【鬥】基本能量各最多 1 張，附給自己場上寶可夢
 *   5. 火箭隊的多邊獸Ｚ｜再構築   — 棄 2 張手牌 → 抽 1
 *   6. 小霞的可達鴨｜重步跳躍     — 備戰 → 牌庫底 1 張入棄牌 + 自身（含附加）入棄牌 + 自身放回牌庫頂
 *
 * 對手操控類 (2)：
 *   7. 哥德小姐｜曲扭未來         — 戰鬥場 → 對手手牌洗回牌庫並重洗 → 對手抽 3
 *   8. 禿鷹娜｜瞄準獵物           — 看對手手牌 → 選 1 張 HP≤70 基礎寶可夢放對手備戰
 *
 * 能量附加類 (2)：
 *   9. 奇樹的電肚蛙ex｜電氣流     — 不限次數！手牌挑【雷】基本能量 → 附給自己的「奇樹的」寶可夢
 *  10. 毒粉蛾｜微風吹拂           — 擲幣正面 → 選 1 個對手戰鬥能量放回對手手牌
 *
 * 設計原則：
 *   - 每回合 1 次靠 engine 既有 abilityUsedThisTurn gate（per-instance）
 *   - 電氣流加進 UNLIMITED_USE_ABILITY_NAMES（engine.ts 補）— 不消耗 1 次/回合
 *   - 條件 gate（戰鬥場/備戰位/手牌資源/牌庫資源…）由 engine.ts getUsableAbilities 補
 *     按鈕未滿足條件時直接不顯示（Iron Rule 9）
 *   - 揭示資訊（Iron Rule 8）：
 *     - 始祖大鳥退化的「進化卡名」公開揭示（卡面行為對手可見）
 *     - 禿鷹娜放對手備戰的卡名公開揭示（卡面寫「放置於對手的備戰區」公開動作）
 *     - 烈焰猴附能量的能量類別公開揭示（手牌→場上是公開動作）
 *     - 火箭隊的多邊獸Ｚ「棄 2 張手牌」棄牌區公開；「抽 1」用 addPrivateLog（自己看到、對手看計數）
 *     - 哥德小姐：對手手牌洗回是公開動作 + 抽 3 用 addPrivateLog（對手看到自己 3 張、玩家看計數）
 *     - 毒粉蛾退能量：能量名公開（對手手牌可見其新增 1 張能量卡）
 *     - 小霞的可達鴨牌庫底丟棄：addPrivateLog（自己看到、對手看計數）
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import { getEffectiveHP } from '../../engine'; // v5.952 剩餘HP用有效HP
import { applyMagearnaHandAttachHeal } from './v3000_g3_wave2';
import { fireOnHandEnergyAttached } from '../_shared'; // v5.662 從手牌附能→對手反應(侵蝕詛咒/麻痺門牙)
import { buildDevolvedInstance } from '../_shared'; // v5.984 中央退化建構
import { canApplyEffectToTarget } from '../../defense'; // v5.984 特性效果免疫 gate(化隱/對戰圓形)
import { evolvedStatusAfter, buildEvolvedInstance } from '../_shared'; // v5.741/v5.742 進化狀態+建構中央
import {
  regA, regR,
  addLog, addPrivateLog, updatePlayer, withPending, shuffle, drawCards,
  getOwnBenchLimit,
} from '../_shared';
import { flipCoinsWithLog } from '../../effects';
import type { Card } from '$lib/cards/types';
// v3.08 美納斯｜平穩境地 — 對手寶可夢/附加卡 → 對手手牌 阻擋 helper
import { oppHasMenasureCalmGround as _v3080OppHasMenasure } from './v3080_deferred_wave_c';

// 導出 sentinel 防止 unused import warnings
export type _v2996Sentinel = PlayerState | GameState | Card | CardInstance;

// ══════════════════════════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════════════════════════

/** 判斷一張卡是否為「基本【屬性】能量」，用 pokemonType 做 strict match。 */
function isBasicEnergyOfType(c: Card | undefined, type: 'Lightning'|'Fire'|'Fighting'|'Grass'): boolean {
  if (!c) return false;
  if (c.supertype !== 'Energy' || c.subtype !== 'Basic') return false;
  if (c.pokemonType === type) return true;
  // fallback：依名稱（兼容資料源命名差異）
  const tagMap: Record<string, string> = {
    Lightning: '【雷】', Fire: '【火】', Fighting: '【鬥】', Grass: '【草】',
  };
  return c.name?.includes(tagMap[type] ?? '') ?? false;
}

/** 是否為 HP ≤ 70 的【基礎】寶可夢卡（用於保母曼波 / 禿鷹娜的篩選）。 */
function isBasicPokemonHPLE70(c: Card | undefined): boolean {
  if (!c) return false;
  if (c.supertype !== 'Pokemon') return false;
  // 基礎寶可夢：subtype === 'Basic'（資料源；爬蟲爬到的化石卡也是 Basic 但不會出現在棄牌的「基礎寶可夢」搜尋裡，
  // 化石卡其實是 Item 但 supertype 標 Pokemon — 此處用既有判斷已足夠：化石卡不是搜尋目標）
  const isBasic = c.subtype === 'Basic' || c.stage === 'Basic';
  if (!isBasic) return false;
  if (typeof c.hp !== 'number') return false;
  return c.hp <= 70;
}

/** 找到觸發特性的源 CardInstance（cardInst 優先；fallback 用 name 找場上）。 */
function findTriggerSource(
  player: PlayerState, pool: Map<string, Card>, name: string, cardInst?: CardInstance
): CardInstance | undefined {
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  if (cardInst) return all.find(c => c.iid === cardInst.iid);
  return all.find(c => pool.get(c.cardId)?.name === name);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 豆豆鴿｜緊急進化
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（H 標 / SV5M）：「若這隻寶可夢的剩餘 HP 為『30』以下，則在自己的回合時可
//   使用 1 次。從自己的牌庫選擇 1 張『高傲雉雞（包含寶可夢【ex】）』，放置於這隻
//   『豆豆鴿』身上完成進化。並且重洗牌庫。」
// 跳階進化 — Basic→Stage2，evolvedFromStack 只放豆豆鴿本體（沒有中間 Stage1 飛翔大鳥）。
// 此特性觸發的進化不算「使出進化」，evolvedThisTurn 仍要設（避免本回合再進化 / 招式）。
// gate：currentHP ≤ 30 + 牌庫有「高傲雉雞」開頭的卡（含 ex）
// ══════════════════════════════════════════════════════════════════════════════
regA('豆豆鴿', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  const src = findTriggerSource(p, pool, '豆豆鴿', cardInst);
  if (!src) return addLog(st, '緊急進化：找不到豆豆鴿', idx);
  const srcCard = pool.get(src.cardId);
  if (!srcCard?.hp) return st;
  const currentHP = getEffectiveHP(src, pool, st) - src.damage;  // v5.952 有效HP-傷害
  if (currentHP > 30) return addLog(st, `緊急進化：剩餘 HP（${currentHP}） > 30，無法使用`, idx);

  // 牌庫有「高傲雉雞」/「高傲雉雞ex」候選
  const validIids = p.deck
    .filter(c => {
      const cc = pool.get(c.cardId);
      return cc?.name?.startsWith('高傲雉雞') ?? false;
    })
    .map(c => c.iid);

  const s = addLog(st,
    validIids.length > 0
      ? '緊急進化：從牌庫選 1 張「高傲雉雞」（含 ex）放置於這隻豆豆鴿身上'
      : '緊急進化：牌庫無對應的「高傲雉雞」（仍重洗牌庫）',
    idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    // 動態：牌庫有候選 → minCount 1（必選），無候選 → minCount 0（直接重洗）
    minCount: validIids.length > 0 ? 1 : 0,
    maxCount: 1,
    effectKey: 'duduge-emergency-evolve',
    params: { validIids, srcIid: src.iid },
  });
});
regR('duduge-emergency-evolve', (st, idx, iids, params, pool) => {
  const p = st.players[idx];
  const srcIid = params?.srcIid as string | undefined;
  if (!srcIid) {
    // 無來源；只重洗
    return updatePlayer(st, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  // iids.length === 0 → 沒選任何卡（候選池為空），只重洗
  if (iids.length === 0) {
    const s = addLog(st, '緊急進化：未選擇進化卡，僅重洗牌庫', idx);
    return updatePlayer(s, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const evoIid = iids[0];
  const evoIdx = p.deck.findIndex(c => c.iid === evoIid);
  if (evoIdx < 0) {
    return updatePlayer(addLog(st, '緊急進化：找不到所選卡，僅重洗牌庫', idx), idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const evoInst = p.deck[evoIdx];
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard?.name?.startsWith('高傲雉雞')) {
    return updatePlayer(addLog(st, '緊急進化：所選非高傲雉雞，僅重洗牌庫', idx), idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  // 找到場上的豆豆鴿 instance（active 或 bench）
  const isActive = p.active?.iid === srcIid;
  const base = isActive ? p.active! : p.bench.find(c => c.iid === srcIid);
  if (!base) {
    return updatePlayer(addLog(st, '緊急進化：找不到豆豆鴿，僅重洗牌庫', idx), idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  // 進化（跳階）：把豆豆鴿放進 evolvedFromStack，cardId 換成高傲雉雞
  const evolved: CardInstance = buildEvolvedInstance(base, evoInst, st, pool);

  let s = updatePlayer(st, idx, pl => {
    const newDeck = shuffle(pl.deck.filter((_, i) => i !== evoIdx));
    return {
      ...pl,
      active: isActive ? evolved : pl.active,
      bench: isActive ? pl.bench : pl.bench.map(c => c.iid === srcIid ? evolved : c),
      deck: newDeck,
    };
  });
  return addLog(s, `緊急進化：${evoCard.name} 進化於豆豆鴿（跳階），並重洗牌庫`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 保母曼波｜溫柔鰭
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（I 標 / SV11B）：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用 1 次。
//   從自己的棄牌區選擇 1 張 HP 為『70』以下的【基礎】寶可夢卡，放置於備戰區。」
// gate：戰鬥場（持有者）+ 備戰未滿（< 5）+ 棄牌區有 HP≤70 基礎寶可夢
// ══════════════════════════════════════════════════════════════════════════════
regA('保母曼波', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  if (!cardInst || p.active?.iid !== cardInst.iid) {
    return addLog(st, '溫柔鰭：保母曼波不在戰鬥場', idx);
  }
  // v3.80：getOwnBenchLimit 支援零之大空洞
  if (p.bench.length >= getOwnBenchLimit(st, idx, pool)) return addLog(st, '溫柔鰭：備戰區已滿', idx);
  const validIids = p.discard
    .filter(c => isBasicPokemonHPLE70(pool.get(c.cardId)))
    .map(c => c.iid);
  if (validIids.length === 0) {
    return addLog(st, '溫柔鰭：棄牌區沒有 HP≤70 的【基礎】寶可夢', idx);
  }
  const s = addLog(st, '溫柔鰭：從棄牌區選 1 張 HP≤70 的【基礎】寶可夢放置於備戰區', idx);
  return withPending(s, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 1, maxCount: 1,
    effectKey: 'mantyke-gentle-fin',
    params: { validIids },
  });
});
regR('mantyke-gentle-fin', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, '溫柔鰭：取消（未選擇）', idx);
  const targetIid = iids[0];
  const p = st.players[idx];
  const inst = p.discard.find(c => c.iid === targetIid);
  if (!inst) return st;
  const card = pool.get(inst.cardId);
  if (!isBasicPokemonHPLE70(card)) {
    return addLog(st, '溫柔鰭：所選不符條件', idx);
  }
  // 放備戰：保留 iid，能量/傷害/狀態都重置（從棄牌召回 = 全新上場）
  const benchInst: CardInstance = {
    ...inst,
    damage: 0,
    energyAttached: [],
    toolAttached: undefined,
    status: undefined,
    secondaryStatus: undefined,
    tertiaryStatus: undefined,
    evolvedFromStack: undefined,
    evolvedFromIid: undefined,
    evolvedThisTurn: undefined,
    abilityUsedThisTurn: undefined,
    justPlaced: true,
    playedFromHand: false,
  };
  const s = addLog(st, `溫柔鰭：將 ${card?.name ?? '?'} 從棄牌區放置於備戰區`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => c.iid !== targetIid),
    bench: [...pl.bench, benchInst],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 始祖大鳥｜原始之翼
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（I 標 / SV11W）：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用 1 次。
//   選擇 1 隻對手的進化寶可夢，移除 1 張『進化卡』使其退化。將移除的卡放回對手的手牌。」
// gate：戰鬥場 + 對手場上至少 1 隻進化寶可夢
// ══════════════════════════════════════════════════════════════════════════════
regA('始祖大鳥', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  if (!cardInst || p.active?.iid !== cardInst.iid) {
    return addLog(st, '原始之翼：始祖大鳥不在戰鬥場', idx);
  }
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 整個效果無效
  if (_v3080OppHasMenasure(st, idx, pool)) {
    return addLog(st, '原始之翼：對手場上有【平穩境地】，效果無效', idx);
  }
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  // 蒐集對手場上「進化」寶可夢（evolvedFromStack 至少 1 個 = 進化過的）
  const allOpp: CardInstance[] = [...(dp.active ? [dp.active] : []), ...dp.bench];
  const validIids = allOpp
    .filter(c => (c.evolvedFromStack?.length ?? 0) >= 1)
    .map(c => c.iid);
  if (validIids.length === 0) {
    return addLog(st, '原始之翼：對手場上沒有進化寶可夢', idx);
  }
  const s = addLog(st, '原始之翼：選擇 1 隻對手的進化寶可夢退化 1 層（卡放回對手手牌）', idx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'archeops-primal-wing',
    params: { validIids },
  });
});
regR('archeops-primal-wing', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const targetIid = iids[0];
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const target = dp.active?.iid === targetIid
    ? dp.active
    : dp.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const stack = target.evolvedFromStack ?? [];
  if (stack.length === 0) return addLog(st, '原始之翼：所選非進化寶可夢，取消', idx);
  // v5.984 Bug3b：特性對「對手」寶可夢施退化＝特性效果 → 須過 ability-effect 免疫 gate
  //   (化隱/對戰圓形/羽毛化石等應擋;比照 v5.974 戰槌龍ex 為特性補 gate)。原缺 gate=免疫目標仍被退化。
  {
    const _g = canApplyEffectToTarget(st, idx, target, pool.get(target.cardId), 'ability-effect', pool,
      { isBench: dp.active?.iid !== targetIid });
    if (_g.blocked) return addLog(st, `原始之翼：${pool.get(target.cardId)?.name ?? '?'}｜${_g.reason}`, idx);
  }
  const removedCardId = target.cardId;
  const newBaseInst = stack[stack.length - 1];
  // v5.984 Bug3a：原手刻 7 旗標(漏 immuneToAttackEffects/takeExtra/weaknessOverride/retaliate 等 40+)
  //   → 收斂中央 buildDevolvedInstance(clearActiveEffects 全清 + 暈眩山谷混亂例外 + 唯一 removed iid)。
  const _dv = buildDevolvedInstance(target, 1, st, pool);
  if (!_dv) return addLog(st, '原始之翼：退化層數不足，取消', idx);
  const handCard: CardInstance = _dv.removedCards[0];
  // 退化規則（PDF §II-C-13）：保留 damage / energy / tool；清狀態 + 跨回合 flag
  const devolved: CardInstance = _dv.devolved;
  const oldName = pool.get(removedCardId)?.name ?? '?';
  const newName = pool.get(newBaseInst.cardId)?.name ?? '?';
  const s = addLog(st, `原始之翼：對手 ${oldName} 退化為 ${newName}（移除卡放回對手手牌）`, idx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl,
    active: pl.active?.iid === targetIid ? devolved : pl.active,
    bench: pl.bench.map(c => c.iid === targetIid ? devolved : c),
    hand: [...pl.hand, handCard],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 烈焰猴｜火焰蹈舞
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（H 標 / SV5a）：「在自己的回合時可使用 1 次。從自己的手牌選擇『基本【火】
//   能量』卡與『基本【鬥】能量』卡最多各 1 張，以任意方式附於自己的寶可夢身上。」
//
// 流程：兩階段 hand-choose（先【火】，再【鬥】）；每張選到 → 開 bench/active picker
//   附給選擇的我方寶可夢。
// gate：手牌至少有【火】或【鬥】基本能量
// ══════════════════════════════════════════════════════════════════════════════
regA('烈焰猴', 0, (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  // 開第一階段：選【火】基本能量（最多 1 張，可不選）
  const fireIids = p.hand
    .filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Fire'))
    .map(c => c.iid);
  const s = addLog(st, '火焰蹈舞：選擇要附加的「基本【火】能量」（最多 1 張，可跳過）', idx);
  return withPending(s, {
    type: 'hand-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: fireIids.length > 0 ? 1 : 0,
    effectKey: 'flame-dance-pick-fire',
    params: { validIids: fireIids },
  });
});
// 第一階段 → 若有選【火】，先開附著 picker；無論選或不選，都串到第二階段【鬥】
regR('flame-dance-pick-fire', (st, idx, iids, _params, pool) => {
  if (iids.length > 0) {
    // 有選【火】能量 → 開 bench/active picker 選附給誰
    const p = st.players[idx];
    const fieldIids = [...(p.active ? [p.active.iid] : []), ...p.bench.map(c => c.iid)];
    const s = addLog(st, '火焰蹈舞：選擇 1 隻自己的寶可夢附加【火】能量', idx);
    return withPending(s, {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'flame-dance-attach-fire',
      params: { validIids: fieldIids, energyIid: iids[0], includeActive: true },
    });
  }
  // 沒選【火】 → 直接跳到【鬥】階段
  return openFlameDanceFightStage(st, idx, pool);
});
regR('flame-dance-attach-fire', (st, idx, iids, params, pool) => {
  const energyIid = params?.energyIid as string | undefined;
  const targetIid = iids[0];
  if (!energyIid || !targetIid) return openFlameDanceFightStage(st, idx, pool);
  const p = st.players[idx];
  const energyInst = p.hand.find(c => c.iid === energyIid);
  if (!energyInst) return openFlameDanceFightStage(st, idx, pool);
  const energyCard = pool.get(energyInst.cardId);
  const eName = energyCard?.name ?? '?';
  // 找目標
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return openFlameDanceFightStage(st, idx, pool);
  const tName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `火焰蹈舞：將 ${eName} 附給 ${tName}`, idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => c.iid !== energyIid),
    active: isActive && pl.active
      ? { ...pl.active, energyAttached: [...pl.active.energyAttached, energyInst] }
      : pl.active,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energyInst] }
      : c),
  }));
  s = applyMagearnaHandAttachHeal(s, idx, [targetIid], pool);  // v5.484 自動治癒
  s = fireOnHandEnergyAttached(s, idx, targetIid, pool);  // v5.662 補對手附能反應(侵蝕詛咒/麻痺門牙)
  return openFlameDanceFightStage(s, idx, pool);
});
function openFlameDanceFightStage(st: GameState, idx: 0 | 1, pool: Map<string, Card>): GameState {
  // 第二階段：選【鬥】基本能量（最多 1 張，可不選）
  // 用 hand-choose + validIids 限制候選只顯示基本【鬥】能量。
  const p = st.players[idx];
  const fightIids = p.hand
    .filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Fighting'))
    .map(c => c.iid);
  if (fightIids.length === 0) {
    return addLog(st, '火焰蹈舞：手牌沒有「基本【鬥】能量」，效果結束', idx);
  }
  return withPending(
    addLog(st, '火焰蹈舞：選擇要附加的「基本【鬥】能量」（最多 1 張，可跳過）', idx),
    {
      type: 'hand-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 0, maxCount: 1,
      effectKey: 'flame-dance-pick-fight',
      params: { validIids: fightIids },
    },
  );
}
regR('flame-dance-pick-fight', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(st, '火焰蹈舞：未選擇【鬥】能量，效果結束', idx);
  }
  // 驗證：選的必須是基本【鬥】能量
  const energyIid = iids[0];
  const p = st.players[idx];
  const energyInst = p.hand.find(c => c.iid === energyIid);
  if (!energyInst) return st;
  const energyCard = pool.get(energyInst.cardId);
  if (!isBasicEnergyOfType(energyCard, 'Fighting')) {
    return addLog(st, '火焰蹈舞：所選非基本【鬥】能量，跳過', idx);
  }
  const fieldIids = [...(p.active ? [p.active.iid] : []), ...p.bench.map(c => c.iid)];
  const s = addLog(st, '火焰蹈舞：選擇 1 隻自己的寶可夢附加【鬥】能量', idx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'flame-dance-attach-fight',
    params: { validIids: fieldIids, energyIid, includeActive: true },
  });
});
regR('flame-dance-attach-fight', (st, idx, iids, params, pool) => {
  const energyIid = params?.energyIid as string | undefined;
  const targetIid = iids[0];
  if (!energyIid || !targetIid) return st;
  const p = st.players[idx];
  const energyInst = p.hand.find(c => c.iid === energyIid);
  if (!energyInst) return st;
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `火焰蹈舞：將 ${eName} 附給 ${tName}`, idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => c.iid !== energyIid),
    active: isActive && pl.active
      ? { ...pl.active, energyAttached: [...pl.active.energyAttached, energyInst] }
      : pl.active,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energyInst] }
      : c),
  }));
  s = applyMagearnaHandAttachHeal(s, idx, [targetIid], pool);  // v5.484 自動治癒
  s = fireOnHandEnergyAttached(s, idx, targetIid, pool);  // v5.662 補對手附能反應(侵蝕詛咒/麻痺門牙)
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 火箭隊的多邊獸Ｚ｜再構築
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（I 標 / SV10）：「在自己的回合，若將自己的 2 張手牌丟棄，則可使用 1 次。
//   從自己的牌庫抽出 1 張卡。」
// gate：手牌 ≥ 2 + 牌庫 ≥ 1
// ══════════════════════════════════════════════════════════════════════════════
regA('火箭隊的多邊獸Ｚ', 0, (st, idx, _pool, _cardInst) => {
  const p = st.players[idx];
  if (p.hand.length < 2) return addLog(st, '再構築：手牌不足 2 張', idx);
  if (p.deck.length < 1) return addLog(st, '再構築：牌庫為空', idx);
  const s = addLog(st, '再構築：選 2 張手牌丟棄 → 抽 1 張', idx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 2, maxCount: 2,
    effectKey: 'rocket-porygonz-rebuild',
  });
});
regR('rocket-porygonz-rebuild', (st, idx, iids, _params, pool) => {
  if (iids.length < 2) return st;
  const p = st.players[idx];
  const picks = p.hand.filter(c => iids.includes(c.iid));
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = updatePlayer(st, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => !iids.includes(c.iid)),
    discard: [...pl.discard, ...picks],
  }));
  s = addLog(s, `再構築：丟棄 ${picks.length} 張手牌（${names}）`, idx);
  // 抽 1 — 用 addPrivateLog（自己看到、對手看計數）
  if (s.players[idx].deck.length === 0) {
    return addLog(s, '再構築：牌庫已空，無法抽卡', idx);
  }
  const drawn = s.players[idx].deck[0];
  const drawnName = pool.get(drawn.cardId)?.name ?? '?';
  s = drawCards(s, idx, 1);
  s = addPrivateLog(s,
    `再構築：抽 1 張 — ${drawnName}`,
    '再構築：抽 1 張',
    idx);
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 小霞的可達鴨｜重步跳躍
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（I 標 / SV9a）：「若這隻寶可夢在備戰區，則在自己的回合時可使用 1 次。
//   將自己的牌庫下方 1 張卡丟棄。然後，將這隻寶可夢身上附加的卡全部丟棄，將這隻
//   寶可夢放回牌庫上方。」
// gate：在備戰區
//
// 流程：
//   1. 牌庫底 1 張入棄牌（addPrivateLog — 對自己揭示；對手只看計數）
//   2. 自身（cardId）+ 附加能量 + 道具 + 進化堆疊 全部入棄牌
//   3. 自身 cardId 放回牌庫頂（不重洗 — 卡面寫「放回牌庫上方」）
//   注意：自身放回牌庫頂用「unshift cardId」— 重抽 iid，讓對手看不到本體 iid。
// ══════════════════════════════════════════════════════════════════════════════
regA('小霞的可達鴨', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  if (!cardInst) return st;
  const bIdx = p.bench.findIndex(c => c.iid === cardInst.iid);
  if (bIdx < 0) return addLog(st, '重步跳躍：這隻寶可夢不在備戰區', idx);

  const me = p.bench[bIdx];
  const myCardId = me.cardId;
  const myName = pool.get(myCardId)?.name ?? '小霞的可達鴨';

  // (1) 牌庫底 1 張入棄牌
  let s = st;
  let bottomDiscard: CardInstance[] = [];
  if (p.deck.length === 0) {
    s = addLog(s, '重步跳躍：牌庫已空，跳過丟棄牌庫底', idx);
  } else {
    const bottomCard = p.deck[p.deck.length - 1];
    const bottomName = pool.get(bottomCard.cardId)?.name ?? '?';
    bottomDiscard = [bottomCard];
    s = addPrivateLog(s,
      `重步跳躍：牌庫底 1 張入棄牌 — ${bottomName}`,
      '重步跳躍：牌庫底 1 張入棄牌',
      idx);
  }

  // (2) 自身 + 附加 全部入棄牌
  const energyDiscard = me.energyAttached;
  const toolDiscard = me.toolAttached ? [me.toolAttached] : [];
  const stackDiscard: CardInstance[] = (me.evolvedFromStack ?? []).map(stk => ({
    iid: stk.iid,
    cardId: stk.cardId,
    damage: 0,
    energyAttached: [],
  }));
  const attachCount = energyDiscard.length + toolDiscard.length + stackDiscard.length;
  s = addLog(s, `重步跳躍：${myName} 身上附加的 ${attachCount} 張卡全部入棄牌`, idx);

  // (3) 自身 cardId 放回牌庫上方（unshift）— 用新 iid 避免衝突
  const returnedInst: CardInstance = {
    iid: `swift-jump-${myCardId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cardId: myCardId,
    damage: 0,
    energyAttached: [],
  };
  s = addLog(s, `重步跳躍：${myName} 放回牌庫上方（不重洗）`, idx);
  s = updatePlayer(s, idx, pl => {
    const newDeck = pl.deck.length === 0
      ? pl.deck
      : pl.deck.slice(0, pl.deck.length - 1);
    return {
      ...pl,
      bench: pl.bench.filter((_, i) => i !== bIdx),
      // 卡片放回牌庫上方
      deck: [returnedInst, ...newDeck],
      discard: [
        ...pl.discard,
        ...bottomDiscard,
        ...energyDiscard,
        ...toolDiscard,
        ...stackDiscard,
      ],
    };
  });
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 哥德小姐｜曲扭未來
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（I 標 / SV11W；MC 再印）：「若這隻寶可夢在戰鬥場上，則在自己的回合時可
//   使用 1 次。對手將對手自己的手牌全部放回牌庫並重洗。然後，對手從牌庫抽出 3 張卡。」
// gate：戰鬥場
// 揭示：手牌洗回牌庫是公開動作；對手抽 3 用 addPrivateLog（對手看到自己 3 張、玩家看計數）
// ══════════════════════════════════════════════════════════════════════════════
regA('哥德小姐', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  if (!cardInst || p.active?.iid !== cardInst.iid) {
    return addLog(st, '曲扭未來：哥德小姐不在戰鬥場', idx);
  }
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  let s = addLog(st, `曲扭未來：對手將手牌（${dp.hand.length} 張）洗回牌庫`, idx);
  s = updatePlayer(s, dIdx, pl => ({
    ...pl,
    deck: shuffle([...pl.deck, ...pl.hand]),
    hand: [],
  }));

  // 對手抽 3 — 用 addPrivateLog 從對手視角揭示（dIdx = 對手 = 抽卡方）
  const oppDeck = s.players[dIdx].deck;
  if (oppDeck.length === 0) {
    return addLog(s, '曲扭未來：對手牌庫為空，無法抽卡', idx);
  }
  const drawCount = Math.min(3, oppDeck.length);
  const drawnCards = oppDeck.slice(0, drawCount);
  const drawnNames = drawnCards.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  s = drawCards(s, dIdx, 3);
  s = addPrivateLog(s,
    `曲扭未來：對手抽 ${drawCount} 張 — ${drawnNames}`,
    `曲扭未來：對手抽 ${drawCount} 張`,
    dIdx);
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 禿鷹娜｜瞄準獵物
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（I 標 / SV11B）：「在自己的回合時可使用 1 次。查看對手的手牌，從其中選擇
//   1 張 HP 為『70』以下的【基礎】寶可夢卡，放置於對手的備戰區。」
// gate：對手手牌有 HP≤70 基礎寶可夢 + 對手備戰未滿（< 5）
//
// 實作：先 addLog 揭示對手手牌（如「能量撢子」pattern）；接著 modal-choice
// 讓玩家從候選 HP≤70 基礎寶可夢挑 1 張；resolver 把選中的卡從對手手牌搬到對手備戰。
// ══════════════════════════════════════════════════════════════════════════════
regA('禿鷹娜', 0, (st, idx, pool, _cardInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  // v3.80：對手 bench 上限同樣考慮零之大空洞（dIdx 視角）
  if (dp.bench.length >= getOwnBenchLimit(st, dIdx, pool)) return addLog(st, '瞄準獵物：對手備戰區已滿', idx);
  if (dp.hand.length === 0) return addLog(st, '瞄準獵物：對手手牌為空', idx);

  // v3.9992：糾正錯誤註解 — 「查看對手手牌」只有「使用招式的玩家」能看到具體卡名；
  //   對手知道自己手牌（無感），但觀戰者不該被揭示。改用 addPrivateLog。
  const handNames = dp.hand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addPrivateLog(st,
    `瞄準獵物：查看對手手牌（${dp.hand.length} 張）— ${handNames}`,
    `瞄準獵物：查看對手手牌（${dp.hand.length} 張）`,
    idx);

  // 候選：HP≤70【基礎】寶可夢
  const candidates = dp.hand.filter(c => isBasicPokemonHPLE70(pool.get(c.cardId)));
  if (candidates.length === 0) {
    return addLog(s, '瞄準獵物：對手手牌無 HP≤70 的【基礎】寶可夢，效果結束', idx);
  }
  s = addLog(s, `瞄準獵物：選 1 張放置於對手備戰區（候選 ${candidates.length} 張）`, idx);
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'mandibuzz-targeting',
    params: {
      label: '瞄準獵物：選擇要放對手備戰的卡',
      options: candidates.map((c, i) => ({
        id: c.iid,
        text: `${i + 1}. ${pool.get(c.cardId)?.name ?? '?'}`,
      })),
    },
  });
});
regR('mandibuzz-targeting', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const targetIid = iids[0];
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const inst = dp.hand.find(c => c.iid === targetIid);
  if (!inst) return st;
  const card = pool.get(inst.cardId);
  if (!isBasicPokemonHPLE70(card)) {
    return addLog(st, '瞄準獵物：所選不符條件', idx);
  }
  // v3.80：對手 bench 上限同樣考慮零之大空洞
  if (dp.bench.length >= getOwnBenchLimit(st, dIdx, pool)) {
    return addLog(st, '瞄準獵物：對手備戰區已滿', idx);
  }
  // 從對手手牌搬到對手備戰
  const benchInst: CardInstance = {
    ...inst,
    damage: 0,
    energyAttached: [],
    toolAttached: undefined,
    status: undefined,
    secondaryStatus: undefined,
    tertiaryStatus: undefined,
    evolvedFromStack: undefined,
    evolvedFromIid: undefined,
    evolvedThisTurn: undefined,
    abilityUsedThisTurn: undefined,
    justPlaced: true,
    playedFromHand: false,
  };
  const s = addLog(st, `瞄準獵物：將對手的 ${card?.name ?? '?'} 放置於對手備戰區`, idx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => c.iid !== targetIid),
    bench: [...pl.bench, benchInst],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 奇樹的電肚蛙ex｜電氣流
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（SV9 / M2a / MC）：「在自己的回合時，可不限次數使用。從自己的手牌選擇 1 張
//   『基本【雷】能量』卡，附於自己的『奇樹的寶可夢』身上。」
//
// 重要：這是**不限次數**特性 — 加進 UNLIMITED_USE_ABILITY_NAMES（engine.ts），
//   不會 set abilityUsedThisTurn。
// gate：手牌有【雷】基本能量 + 場上至少 1 隻「奇樹的」寶可夢
// ══════════════════════════════════════════════════════════════════════════════
regA('奇樹的電肚蛙ex', 0, (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  const lightningIids = p.hand
    .filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Lightning'))
    .map(c => c.iid);
  if (lightningIids.length === 0) return addLog(st, '電氣流：手牌沒有基本【雷】能量', idx);

  const all: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  // v5.184：詛咒根擋手牌附能 — filter 受詛咒根影響的「奇樹的」寶可夢
  const kitreeIids = all
    .filter(c => (pool.get(c.cardId)?.name?.startsWith('奇樹的') ?? false) && !c.cantAttachEnergyThisTurn)
    .map(c => c.iid);
  if (kitreeIids.length === 0) return addLog(st, '電氣流：場上沒有可附能的「奇樹的」寶可夢', idx);

  const s = addLog(st, '電氣流：選 1 張基本【雷】能量', idx);
  return withPending(s, {
    type: 'hand-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'kitree-iron-bundle-flow-pick',
    params: { validIids: lightningIids, kitreeIids },
  });
});
regR('kitree-iron-bundle-flow-pick', (st, idx, iids, params, _pool) => {
  if (iids.length === 0) return st;
  const energyIid = iids[0];
  const kitreeIids = (params?.kitreeIids as string[] | undefined) ?? [];
  const s = addLog(st, '電氣流：選擇要附給的「奇樹的」寶可夢', idx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'kitree-iron-bundle-flow-attach',
    params: { validIids: kitreeIids, energyIid, includeActive: true },
  });
});
regR('kitree-iron-bundle-flow-attach', (st, idx, iids, params, pool) => {
  const energyIid = params?.energyIid as string | undefined;
  const targetIid = iids[0];
  if (!energyIid || !targetIid) return st;
  const p = st.players[idx];
  const energyInst = p.hand.find(c => c.iid === energyIid);
  if (!energyInst) return st;
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  const isActive = p.active?.iid === targetIid;
  const target = isActive ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `電氣流：將 ${eName} 附給 ${tName}`, idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => c.iid !== energyIid),
    active: isActive && pl.active
      ? { ...pl.active, energyAttached: [...pl.active.energyAttached, energyInst] }
      : pl.active,
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energyInst] }
      : c),
  }));
  s = applyMagearnaHandAttachHeal(s, idx, [targetIid], pool);  // v5.484 自動治癒
  s = fireOnHandEnergyAttached(s, idx, targetIid, pool);  // v5.662 補對手附能反應(侵蝕詛咒/麻痺門牙)
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. 毒粉蛾｜微風吹拂
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（M2a 008/193）：「在自己的回合時可使用 1 次。擲 1 次硬幣若為正面，則選擇
//   1 個對手的戰鬥寶可夢身上附加的能量，放回對手的手牌。」
// gate：對手戰鬥位有能量
//
// 流程：
//   step1：擲幣
//   step2：若正面 → active-energy-discard（sourcePlayerIdx=oppIdx，使 src=對手）
//   step3：resolver — 從對手戰鬥位移除選中能量，加到對手手牌（不丟棄！）
// ══════════════════════════════════════════════════════════════════════════════
regA('毒粉蛾', 0, (st, idx, pool, _cardInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active) return addLog(st, '微風吹拂：對手戰鬥場無寶可夢', idx);
  if (dp.active.energyAttached.length === 0) {
    return addLog(st, '微風吹拂：對手戰鬥位沒有能量', idx);
  }
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 整個效果無效（仍消耗每回合 1 次？
  //   保守採卡面解讀「效果不發生」→ 直接 short-circuit、不啟動擲幣，避免浪費觸發）
  if (_v3080OppHasMenasure(st, idx, pool)) {
    return addLog(st, '微風吹拂：對手場上有【平穩境地】，效果無效', idx);
  }
  const r = flipCoinsWithLog(st, 1, '微風吹拂', idx);
  if (r.heads === 0) return addLog(r.state, '微風吹拂：反面，效果無效', idx);

  const s = addLog(r.state, '微風吹拂：正面，選 1 個對手戰鬥位能量放回對手手牌', idx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'dustox-breeze-blow',
    params: { titleOverride: '選擇要放回對手手牌的能量' },
  });
});
regR('dustox-breeze-blow', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const targetIid = iids[0];
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active) return st;
  const energyInst = dp.active.energyAttached.find(e => e.iid === targetIid);
  if (!energyInst) return st;
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  const s = addLog(st, `微風吹拂：將對手戰鬥位的 ${eName} 放回對手手牌`, idx);
  return updatePlayer(s, dIdx, pl => ({
    ...pl,
    active: pl.active
      ? { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => e.iid !== targetIid) }
      : pl.active,
    hand: [...pl.hand, energyInst],
  }));
});
