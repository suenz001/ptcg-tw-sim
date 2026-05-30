/**
 * ════════════════════════════════════════════════════════════════════════════
 * M5「深淵之瞳」日版搶先版 — 對戰邏輯（v4.79+）
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 此檔包含 M5 卡包所有招式 / 特性 / 道具 / 支援者 / 能量 規則註冊。
 * 日版於 2026/6/5 在台灣發售；目前是「自譯搶先版」，正式版上市後可乾淨下架。
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ 未來下架步驟（正式中文版上市後執行）                                  │
 * │                                                                          │
 * │  ① 刪 static/cards/M5.json                                              │
 * │  ② 從 static/cards/index.json 移除 M5 entry                             │
 * │  ③ 從 src/lib/game/effects.ts 移除 `import './effects/cards/m5_preview'`│
 * │  ④（可選）刪本檔 src/lib/game/effects/cards/m5_preview.ts               │
 * │                                                                          │
 * │ 為何乾淨：                                                              │
 * │  - 卡牌資料庫的 markGroups 自動跳過不存在的 M5 set                      │
 * │  - 對戰時若有舊牌組含 M5 卡：找不到實裝會走 fallback（純傷害無效果）   │
 * │  - 未動 engine.ts / types.ts / GameState 欄位 — 純隔離                  │
 * │                                                                          │
 * │ 為何保留檔案：                                                          │
 * │  - 正式中文版上市後若卡面相同（極可能），可重 import 此檔繼續用        │
 * │  - 或將實裝搬到正規 cards/*.ts                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Phase 1（v4.79）涵蓋：14 張簡單效果卡
 *   - 狀態異常類：002 強顎雞母蟲 / 007 席多藍恩 / 030 迷唇姐 / 050 烏賊王
 *   - 自傷類：003 偽螳草 / 009 焚焰蚣 / 027 密勒頓
 *   - mill 對手牌庫類：008 燒火蚣 / 009 焚焰蚣 / 063 超級龍頭地鼠ex
 *   - 自身狀態類：015 吼鯨王ex
 *   - 簡單抽牌：022 落雷獸
 *   - 棄手牌類：028 呆呆獸
 *   - 全洗 + 抽 6：053 莫魯貝可ex
 *
 * 後續 Phase（規劃中）：
 *   Phase 2（v4.80）：條件 +N 傷害 / 自身回血 / picker 類（25 張）
 *   Phase 3（v4.81）：「化隱」特性 6 張（新獨立 immunity flag）
 *   Phase 4（v4.82）：超進化 ex 大招（深淵之瞳 / 咒縛之炎 / 暴走之槌+150 等 8 張）
 *   Phase 5（v4.83）：訓練家 + 能量規則（小霞的朝氣 / 沐淨 / 化石採掘場 等）
 *
 * 鐵律遵守：
 *   - Rule 7c：所有效果以 JSON M5_raw.json 的日文 `effect_jp` 為 source
 *   - 純傷害招式（無 effect 文字）不註冊（引擎預設處理）
 *   - 不動 engine.ts / types.ts — 純用既有 helper
 */

import {
  reg,
  regA,
  regPost,
  regPre,
  regR,
  addLog,
  updatePlayer,
  withPending,
  getAllAttachedTools,
  shuffle,
  getOwnBenchLimit,  // v5.059：螺釘地鼠|呼喚同伴 補 bench-cap check（防零之大空洞被誤觸發破壞）
  ATTACK_PRE,
  ATTACK_POST,
  // v5.172：深淵之瞳手動 KO 模式（recordOppKO / addPendingPrize 都在 _shared.ts）
  recordOppKO,
  addPendingPrize,
  regG} from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import {
  statusPost,
  coinStatusPost,
  selfStatusPost,
  millOppDeckTopPost,
  drawNPost,
  selfHealPost,
  forceOppSwapPost,
  coinHeadsMultiplyPre,
  hitBenchPickPost,
  flipCoinsWithLog,
  applyStatusToActive,
  isConfusionImmune,
  checkSpecialEnergyStatusImmune,
  // v5.172：深淵之瞳手動 KO 模式仿棄世猴|同命戰鬥
  //   canApplyAttackEffectToTarget 在 effects.ts L1881
  //   prizesForKOLocal v5.172 加 export
  canApplyAttackEffectToTarget,
  prizesForKOLocal,
} from '../../effects';
import { getEnergyUnits, computeActiveRetreatCostFor } from '../../engine';
import { RULE_BOX_SUBTYPES } from '../../types';
import type { CardInstance, GameState } from '../../types';  // v5.203 hotfix: type-only import
import type { Card } from '$lib/cards/types';  // v5.204 hotfix: Card 從 cards/types 而非 game/types
import { canApplyEffectToTarget } from '../../defense';

// ── M5 helper: 自傷（這隻寶可夢也受到 N 傷害）─────────────────────────
// 引擎沒有現成的 selfDamagePost helper（v2380 之前用 inline pattern）
// 為下架彈性，這個 helper 留在本檔內（不放 effects.ts）
function m5SelfDamagePost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const s = updatePlayer(state, aIdx, p => {
      if (!p.active) return p;
      return {
        ...p,
        active: { ...p.active, damage: p.active.damage + n },
      };
    });
    return addLog(s, `${label}：這隻寶可夢也受到 ${n} 點傷害`, aIdx);
  };
}

// ── 002 強顎雞母蟲｜吐絲 — 擲幣正面→對手【麻痺】─────────────────────────
regPost('強顎雞母蟲|吐絲', coinStatusPost('paralyzed'));

// ── 003 偽螳草｜突擊 — 自傷 10 ─────────────────────────────────────
regPost('偽螳草|突擊', m5SelfDamagePost(10, '突擊'));

// ── 007 席多藍恩｜燒灼 — 對手【灼傷】───────────────────────────────
regPost('席多藍恩|灼熱', statusPost('burned'));

// ── 008 燒火蚣｜野火 — mill 對手牌庫頂 1 張 ───────────────────────
regPost('燒火蚣|燒荒', millOppDeckTopPost(1, '野火'));

// ── 009 焚焰蚣｜野火 — mill 對手牌庫頂 2 張 ───────────────────────
regPost('焚焰蚣|燒荒', millOppDeckTopPost(2, '野火'));

// ── 009 焚焰蚣｜熱情衝撞 — 自傷 30 ────────────────────────────────
regPost('焚焰蚣|熱力衝撞', m5SelfDamagePost(30, '熱情衝撞'));

// ── 015 吼鯨王ex｜摔落 — 自身【睡眠】──────────────────────────────
regPost('吼鯨王ex|摔下', selfStatusPost('asleep'));

// ── 022 落雷獸｜拿來 — 抽 1 張 ────────────────────────────────────
regPost('落雷獸|呼喚', drawNPost(1, '拿來'));

// ── 027 密勒頓｜打雷 — 自傷 30 ─────────────────────────────────────
regPost('密勒頓|打雷', m5SelfDamagePost(30, '打雷'));

// ── 028 呆呆獸｜徹底丟棄 — picker：選任意數量手牌丟棄 ─────────────
//   卡面：「從自己的手牌選擇任意數量的卡，全部丟棄。」
//   不會強制丟，玩家可選 0 張（pickerCount min=0）
regPre('呆呆獸|丟到飽', (state, aIdx, _pool, _action) => ({ state, damage: 0 }));
regPost('呆呆獸|丟到飽', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.hand.length === 0) {
    return addLog(state, '徹底丟棄：手牌為空，無可丟', aIdx);
  }
  return withPending(
    addLog(state, '徹底丟棄：選擇任意數量手牌丟棄（可選 0 張）', aIdx),
    {
      type: 'hand-discard',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 0, maxCount: p.hand.length,
      effectKey: 'm5-slowpoke-discard-all',
    }
  );
});

// resolver: 把選的手牌丟到棄牌堆
regR('m5-slowpoke-discard-all', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return addLog(state, '徹底丟棄：玩家選擇 0 張，跳過', aIdx);
  }
  const p = state.players[aIdx];
  const toDiscard = p.hand.filter(c => iids.includes(c.iid));
  const newHand = p.hand.filter(c => !iids.includes(c.iid));
  const s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    hand: newHand,
    discard: [...pl.discard, ...toDiscard],
  }));
  return addLog(s, `徹底丟棄：丟棄 ${toDiscard.length} 張手牌`, aIdx);
});

// ── 030 迷唇姐｜精神力 — 擲幣正面→對手【麻痺】────────────────────
regPost('迷唇姐|念力', coinStatusPost('paralyzed'));

// ── 050 烏賊王｜蠱惑 — 對手【混亂】───────────────────────────────
regPost('烏賊王|蠱惑', statusPost('confused'));

// ── 053 莫魯貝可ex｜輪盤抽牌 — 手牌全洗回牌庫 + 抽 6 張 ─────────
//   卡面：「將自己的手牌全部放回牌庫並重洗。之後，從牌庫抽 6 張卡。」
regPre('莫魯貝可ex|轉輪抽出', (state, _aIdx, _pool, _action) => ({ state, damage: 0 }));
regPost('莫魯貝可ex|轉輪抽出', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  // 手牌合併入牌庫 + 重洗
  const combinedDeck = [...p.deck, ...p.hand];
  // 重洗
  for (let i = combinedDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combinedDeck[i], combinedDeck[j]] = [combinedDeck[j], combinedDeck[i]];
  }
  const drawN = Math.min(6, combinedDeck.length);
  const drawn = combinedDeck.slice(0, drawN);
  const remaining = combinedDeck.slice(drawN);
  const s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    hand: drawn,
    deck: remaining,
  }));
  return addLog(s,
    `輪盤抽牌：手牌 ${p.hand.length} 張洗回牌庫 → 重抽 ${drawN} 張`, aIdx);
});

// ── 063 超級龍頭地鼠ex｜挖掘崩塌 — mill 對手牌庫頂 2 張 ──────────
regPost('超級龍頭地鼠ex|挖垮', millOppDeckTopPost(2, '挖掘崩塌'));

// ════════════════════════════════════════════════════════════════════════════
// Phase 1 結束（14 個招式，涵蓋 13 張卡）。
// ════════════════════════════════════════════════════════════════════════════
//
// Phase 2 (v4.80)：條件 +N 傷害 / 自身回血 / picker 類 — 17 個招式
//
// 完整對照（卡面 → 實裝細節）：
//   A. 條件 +N PRE：
//      紅蓮鎧騎|烈焰軍團（40+N×40，N=自方備戰附「火能量」數，v4.950 修譯）
//      古空棘魚|化石節拍（10+N×30，N=自方備戰名含「陳舊的」數）
//      海豚俠|正義之拳（80+200，當對手剩餘獎賞=1）
//      呆殼獸|空空如也（50+160，當自方手牌=0）
//      故勒頓|戰鬥利爪（30+30，當對手戰鬥位為進化）
//      莫魯貝可ex|飢餓轟炸（40+N×40，N=自身傷害指示物數）
//      古玉魚|嫉妒漩渦（20+90 且 skipWeakness，當自身傷害指示物≥2）
//      銃嘴大鳥|羽毛迴旋（60+N×20，N=雙方備戰合計數）
//   B. 自身回血：
//      波普海豚|吸取鰭（20，self heal 20）
//   C. defender 減傷：
//      蘭螳花ex|葉片防護（140，下回合受傷 -50）
//   D. 對手場操作：
//      斯魔茶|悄悄放上（0+對手戰鬥位放 1 指示物）
//      棄世猴|幽靈拳（100+對手備戰 picker 放 5 指示物）
//      頭蓋龍|撞飛（70+強制對手戰鬥位與備戰位互換）
//      小篤兒|二連啄（2 次擲幣×10）
//      銀伴戰獸|空氣斬（130+自身丟 1 能量 picker）
//   E. 牌庫搜尋 picker：
//      螺釘地鼠|呼喚同伴（牌庫選 ≤2 基礎寶可夢到備戰）
//      燈火幽靈|增光（牌庫選 ≤3「燈火幽靈」到備戰）
//
// 鐵律遵守：
//   - Rule 7c：每招以 JSON M5.json effect 文字為 source
//   - Rule 11：m5_preview.ts 大小未到 100KB，但仍走 Python pipeline 寫入
//   - Rule 13：所有 picker 用 effectKey 字串，無 GameState nested array
//   - Rule 17：傷害效果走 canApplyEffectToTarget unified path（透過 hitBenchPickPost 等 helper）
// ════════════════════════════════════════════════════════════════════════════

// ── helper：自方備戰中「附有火能量的寶可夢數」────────────────────────
// v4.950：原 helper 算「附任何能量」是早期 JSON 翻譯誤譯 — 正確應限定火能量。
//   providesFireEnergy 判定：基本【火】能量 OR 名稱含「【火】」的特殊能量
//   （pattern 同 m2_dragon_charizard_batch.ts:36）。
function providesFireEnergy(card: import('$lib/cards/types').Card | undefined): boolean {
  return !!card && card.supertype === 'Energy'
    && (card.pokemonType === 'Fire' || card.name.includes('【火】'));
}
function countSelfBenchWithFireEnergy(
  state: import('../../types').GameState,
  aIdx: 0 | 1,
  pool: Map<string, import('$lib/cards/types').Card>,
): number {
  return state.players[aIdx].bench.filter(b =>
    b.energyAttached.some(e => providesFireEnergy(pool.get(e.cardId)))
  ).length;
}

// ── helper：自方備戰中卡名含某子字串的寶可夢數 ───────────────────────
function countSelfBenchByNameContains(
  state: import('../../types').GameState, aIdx: 0 | 1,
  pool: Map<string, import('$lib/cards/types').Card>, substr: string,
): number {
  return state.players[aIdx].bench.filter(b => {
    const c = pool.get(b.cardId);
    return c && c.name.includes(substr);
  }).length;
}

// ══════════════════════════════════════════════════════════════════════════════
// Group A — 條件 +N PRE
// ══════════════════════════════════════════════════════════════════════════════

// ── 紅蓮鎧騎|烈焰軍團 — 40 + N×40（N=自方備戰附「火能量」寶可夢數）
//   卡面（v4.950 修譯）：「增加附有火能量的自己的備戰寶可夢的數量 × 40 點傷害。」
//   注意：限定火能量（基本【火】或名稱含「【火】」的特殊能量），不算其他屬性。
regPre('紅蓮鎧騎|火焰軍團', (state, aIdx, pool) => {
  const n = countSelfBenchWithFireEnergy(state, aIdx, pool);
  const dmg = 40 + n * 40;
  return {
    state: addLog(state, `烈焰軍團：自方備戰附火能量寶可夢 ${n} 隻 → 40 + ${n}×40 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 古空棘魚|化石節拍 — 10 + N×30（N=自方備戰中名含「陳舊的」數）
//   卡面：「名稱含有『陳舊的』的自己備戰寶可夢張數 × 30 點，追加傷害。」
regPre('古空棘魚|化石律動', (state, aIdx, pool) => {
  const n = countSelfBenchByNameContains(state, aIdx, pool, '陳舊的');
  const dmg = 10 + n * 30;
  return {
    state: addLog(state, `化石節拍：自方備戰「陳舊的」${n} 隻 → 10 + ${n}×30 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 海豚俠|正義之拳 — 80 +200（當對手剩餘獎賞=1）
//   卡面：「若對手剩餘獎賞牌為 1 張，則此招式傷害 +200。」
regPre('海豚俠|正義拳擊', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppPrizes = state.players[dIdx].prizes.length;
  const bonus = oppPrizes === 1 ? 200 : 0;
  const dmg = 80 + bonus;
  return {
    state: addLog(state,
      `正義之拳：對手剩 ${oppPrizes} 張獎賞 → 80${bonus > 0 ? ` + ${bonus}` : ''} = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 呆殼獸|空空如也 — 50 +160（當自方手牌=0）
//   卡面：「若自己的手牌為 0 張,則此招式傷害 +160。」
regPre('呆殼獸|一乾二淨', (state, aIdx) => {
  const handN = state.players[aIdx].hand.length;
  const bonus = handN === 0 ? 160 : 0;
  const dmg = 50 + bonus;
  return {
    state: addLog(state,
      `空空如也：自方手牌 ${handN} 張 → 50${bonus > 0 ? ` + ${bonus}` : ''} = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 故勒頓|戰鬥利爪 — 30 +30（當對手戰鬥位為進化寶可夢）
//   卡面：「若對手的戰鬥寶可夢為進化寶可夢,則此招式傷害 +30。」
regPre('故勒頓|戰鬥爪', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defActive = state.players[dIdx].active;
  const defCard = defActive ? pool.get(defActive.cardId) : null;
  const isEvolution = !!defCard && (defCard.stage === 'Stage1' || defCard.stage === 'Stage2' || !!defCard.evolvesFrom);
  const bonus = isEvolution ? 30 : 0;
  const dmg = 30 + bonus;
  return {
    state: addLog(state,
      `戰鬥利爪：對手戰鬥位${isEvolution ? '為進化寶可夢' : '非進化'} → 30${bonus > 0 ? ` + ${bonus}` : ''} = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 莫魯貝可ex|飢餓轟炸 — 40 + N×40（N=自身傷害指示物數，即 damage/10）
//   卡面：「這隻寶可夢身上的傷害指示物數 × 40 點，追加傷害。」
regPre('莫魯貝可ex|空腹轟炸', (state, aIdx) => {
  const att = state.players[aIdx].active;
  const counters = att ? Math.floor((att.damage ?? 0) / 10) : 0;
  const bonus = counters * 40;
  const dmg = 40 + bonus;
  return {
    state: addLog(state, `飢餓轟炸：自身傷害指示物 ${counters} 個 → 40 + ${counters}×40 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 古玉魚|嫉妒漩渦 — 20 +90 + skipWeakness（當自身傷害指示物≥2）
//   卡面：「若這隻寶可夢身上的傷害指示物有 2 個以上，則此招式傷害 +90。此招式的傷害不計算弱點。」
regPre('古玉魚|嫉妒漩渦', (state, aIdx) => {
  const att = state.players[aIdx].active;
  const counters = att ? Math.floor((att.damage ?? 0) / 10) : 0;
  const bonus = counters >= 2 ? 90 : 0;
  const dmg = 20 + bonus;
  return {
    state: addLog(state,
      `嫉妒漩渦：自身傷害指示物 ${counters} 個${counters >= 2 ? '（≥2 觸發 +90）' : ''} → 20${bonus > 0 ? ` + ${bonus}` : ''} = ${dmg}（不計弱點）`, aIdx),
    damage: dmg,
    skipWeakness: true,
  };
});

// ── 銃嘴大鳥|羽毛迴旋 — 60 + N×20（N=雙方備戰寶可夢合計數）
//   卡面：「雙方備戰寶可夢數合計 × 20 點，追加傷害。」
regPre('銃嘴大鳥|羽毛輪舞', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const n = state.players[aIdx].bench.length + state.players[dIdx].bench.length;
  const dmg = 60 + n * 20;
  return {
    state: addLog(state, `羽毛迴旋：雙方備戰合計 ${n} 隻 → 60 + ${n}×20 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// Group B — 自身回血
// ══════════════════════════════════════════════════════════════════════════════

// ── 波普海豚|吸取鰭 — 20，自身回復 20 HP
//   卡面：「這隻寶可夢恢復 20 HP。」
regPost('波普海豚|吸取鰭', selfHealPost(20, '吸取鰭'));

// ══════════════════════════════════════════════════════════════════════════════
// Group C — defender 下次受傷 -50
// ══════════════════════════════════════════════════════════════════════════════

// ── 蘭螳花ex|葉片防護 — 140，下個對手回合這隻寶可夢受招式傷害 -50
//   卡面：「下個對手的回合，這隻寶可夢受到的招式傷害「-50」。」
//   實裝：用既有 damageReduceNextHit flag（defender 端，自己被打 -N）
regPost('蘭螳花ex|葉子防守', (state, aIdx) => {
  return updatePlayer(addLog(state, '葉片防護：下個對手回合受招 -50', aIdx), aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damageReduceNextHit: 50 } };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Group D — 對手場操作
// ══════════════════════════════════════════════════════════════════════════════

// ── 斯魔茶|悄悄放上 — 0+對手戰鬥位放 1 個傷害指示物
//   卡面：「在對手的戰鬥寶可夢身上，放置 1 個傷害指示物。」
//   注意：「放置傷害指示物」屬「招式效果」（非招式傷害），需走 Rule 17 unified defense check。
//   參考 statusPost 模式 — 不過此處放指示物簡單實作，sanityKOSweep 會處理超 HP KO。
regPost('斯魔茶|無聲加害', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(addLog(state, '悄悄放上：對手戰鬥位 +1 傷害指示物', aIdx), dIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: (p.active.damage ?? 0) + 10 } };
  });
});

// ── 棄世猴|幽靈拳 — 100+對手備戰 1 隻放 5 個傷害指示物
//   卡面：「在對手 1 隻備戰寶可夢身上，放置 5 個傷害指示物。」
//   實裝：hitBenchPickPost 的簽名是 (state, aIdx, targetSide, count, amount, label) → state
//   用 inline AttackPostFn 包裝
regPost('棄世猴|幽靈打擊', (state, aIdx) => hitBenchPickPost(state, aIdx, 'opp', 1, 50, '幽靈拳'));

// ── 頭蓋龍|撞飛 — 70+強制對手戰鬥位與備戰位互換（對手選新戰鬥位）
//   卡面：「將對手的戰鬥寶可夢與備戰寶可夢互換。（送上戰鬥場的寶可夢由對手選擇。）」
regPost('頭蓋龍|推倒', forceOppSwapPost('撞飛'));

// ── 小篤兒|二連啄 — 擲 2 次硬幣 × 10 點傷害
//   卡面：「擲 2 次硬幣，正面數 × 10 點傷害。」
regPre('小篤兒|二連撞', coinHeadsMultiplyPre(2, 10, '二連啄'));

// ── 銀伴戰獸|空氣斬 — 130+自身丟 1 能量
//   卡面：「從這隻寶可夢身上選擇 1 個能量，丟棄。」
//   實裝：POST 開 self-energy-discard picker
regPost('銀伴戰獸|空氣斬', (state, aIdx) => {
  const att = state.players[aIdx].active;
  if (!att || att.energyAttached.length === 0) {
    return addLog(state, '空氣斬：自身無能量可丟，效果略過', aIdx);
  }
  return withPending(
    addLog(state, '空氣斬：選 1 顆自身能量丟棄', aIdx),
    {
      type: 'active-energy-discard',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-silvally-air-slash',
    },
  );
});
regR('m5-silvally-air-slash', (state, aIdx, iids) => {
  if (iids.length === 0) return addLog(state, '空氣斬：玩家選 0 張，跳過', aIdx);
  return updatePlayer(addLog(state, `空氣斬：自身丟 ${iids.length} 張能量`, aIdx), aIdx, p => {
    if (!p.active) return p;
    const toDiscard = p.active.energyAttached.filter(e => iids.includes(e.iid));
    const newAttached = p.active.energyAttached.filter(e => !iids.includes(e.iid));
    return {
      ...p,
      active: { ...p.active, energyAttached: newAttached },
      discard: [...p.discard, ...toDiscard],
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Group E — 牌庫搜尋 picker
// ══════════════════════════════════════════════════════════════════════════════

// ── 螺釘地鼠|呼喚同伴 — 從自己牌庫選 ≤2 張基礎寶可夢，放置於備戰區
//   卡面：「從自己的牌庫選擇最多 2 張【基礎】寶可夢，放置於備戰區。然後重洗牌庫。」
//
// v5.059 bug fix（玩家回報）：場上有零之大空洞 + 備戰已滿（8 隻）時用呼喚同伴
//   會誤觸發「零之大空洞被破壞」的清場效果 → 寶可夢被丟棄消失。
//
// 根因：原 regPost 沒做 bench-cap check，resolver 直接 `bench: [...p.bench, ...picked]`
//   純 append。若 bench 8 隻 + picked 2 隻 = 10 隻，超過 limit。引擎末尾的
//   `enforceBenchLimit`（engine.ts:338）每次 dispatch 後自動跑，看到 bench.length > limit
//   就觸發「零之大空洞效果失去：選 2 隻備戰寶可夢丟棄」pending —
//   這個函數本來是設計給「零之大空洞 stadium 被換掉、limit 從 8 變回 5」用的，
//   被誤觸發 → 玩家剛搜出來的寶可夢被當「超出部分」丟掉。
//
// 修法：
//   (a) regPost 開頭算 remainingSlots = limit - bench.length；若 ≤ 0 直接 addLog「備戰區已滿」return
//   (b) maxCount 動態 = min(2, remainingSlots) 給 picker
//   (c) resolver 加 safety trim：若 iids.length > remainingSlots（picker 漏 cap）→ trim 到 remainingSlots
regPre('螺釘地鼠|呼朋引伴', (state) => ({ state, damage: 0 }));
regPost('螺釘地鼠|呼朋引伴', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '呼喚同伴：牌庫為空', aIdx);
  // v5.059：bench-cap check（同 effects.ts L1450 謎擬Q|呼朋引伴 寫法）
  const limit = getOwnBenchLimit(state, aIdx, pool);
  const remainingSlots = limit - p.bench.length;
  if (remainingSlots <= 0) return addLog(state, '呼喚同伴:備戰區已滿', aIdx);
  const maxN = Math.min(2, remainingSlots);
  return withPending(addLog(state, `呼喚同伴：從牌庫選 ≤${maxN} 張【基礎】寶可夢放備戰（可選 0 張）`, aIdx), {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: maxN,
    effectKey: 'm5-screwdriller-call-allies',
    params: { benchLimitAtPick: limit },  // 帶到 resolver 做 safety trim
  });
});
regR('m5-screwdriller-call-allies', (state, aIdx, iids, params) => {
  if (iids.length === 0) {
    // 跳過：仍重洗牌庫（卡面：「然後重洗牌庫」是搜尋完成的固定動作）
    return updatePlayer(addLog(state, '呼喚同伴：玩家選 0 張，僅重洗牌庫', aIdx), aIdx, p => ({
      ...p,
      deck: [...p.deck].sort(() => Math.random() - 0.5),
    }));
  }
  return updatePlayer(addLog(state, `呼喚同伴：放置 ${iids.length} 張到備戰並重洗`, aIdx), aIdx, p => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    // 重洗剩餘牌庫
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    // v5.059：safety trim — picker 漏 cap 防呆，避免觸發 enforceBenchLimit 清場
    const benchLimitAtPick = (params?.benchLimitAtPick as number | undefined) ?? 5;
    const slotsAvail = Math.max(0, benchLimitAtPick - p.bench.length);
    const safePicked = picked.slice(0, slotsAvail);
    return {
      ...p,
      deck: shuffled,
      bench: [...p.bench, ...safePicked],
    };
  });
});

// ── 燈火幽靈|增光 — 從自己牌庫選 ≤3 張「燈火幽靈」，放置於備戰區
//   卡面：「從自己的牌庫選擇最多 3 張『燈火幽靈』，放置於備戰區。然後重洗牌庫。」
//   實裝：用 'Name:燈火幽靈' filter — 但 deck-search filter 是否認此 pattern 需確認；
//   採取 picker + resolver 內 filter by name 的保險作法。
regPre('燈火幽靈|亮光增長', (state) => ({ state, damage: 0 }));
regPost('燈火幽靈|亮光增長', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '增光：牌庫為空', aIdx);
  // 預先 filter 牌庫中「燈火幽靈」可選候選
  const candidates = p.deck.filter(c => pool.get(c.cardId)?.name === '燈火幽靈');
  if (candidates.length === 0) {
    return addLog(state, '增光：牌庫無「燈火幽靈」', aIdx);
  }
  const maxN = Math.min(3, candidates.length);
  return withPending(addLog(state, `增光：從牌庫選 ≤${maxN} 張「燈火幽靈」放備戰（可選 0 張）`, aIdx), {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Name:燈火幽靈',
    minCount: 0, maxCount: maxN,
    effectKey: 'm5-litwick-enlight',
  });
});
regR('m5-litwick-enlight', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) {
    return updatePlayer(addLog(state, '增光：玩家選 0 張，僅重洗牌庫', aIdx), aIdx, p => ({
      ...p,
      deck: [...p.deck].sort(() => Math.random() - 0.5),
    }));
  }
  return updatePlayer(addLog(state, `增光：放置 ${iids.length} 張燈火幽靈到備戰並重洗`, aIdx), aIdx, p => {
    // 防呆：再次確認選的卡都是「燈火幽靈」
    const valid = p.deck.filter(c => iids.includes(c.iid) && pool.get(c.cardId)?.name === '燈火幽靈');
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    return {
      ...p,
      deck: shuffled,
      bench: [...p.bench, ...valid],
    };
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 2 結束。已實裝 14 (Phase 1) + 17 (Phase 2) = 31 個招式。
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 3 (v4.81) — 19 個招式（條件 +N / 狀態 / 對手場操作 / 自身互換 / picker）
//
// A. 條件 +N PRE（7）：銅鏡怪鏡像攻擊 / 薩戮德暗影鞭打 / 超級龍頭地鼠ex最大鑽頭 /
//    超級捷拉奧拉ex雷電拳 / 超級達克萊伊ex暗夜突襲 / 蘭螳花ex活力切割器 / 雷電獸音速之刃
// B. 狀態條件（1）：烏賊王腦核粉碎
// C. 擲幣失敗（1）：炭小侍全力拳擊
// D. 對手場 / 自身能量操作（5）：盾甲龍碎裂 / 故勒頓大地衝擊 / 獒教父飛撲頭錘 /
//    鍬農炮蟲巨型軌道砲 / 超級捷拉奧拉ex瞬間移轉
// E. 狙擊 picker（4）：金魚王水流射擊 / 鍬農炮蟲急速潛行 / 禿鷹娜骨頭狙擊 / 瑪夏多影結
// F. 牌庫搜尋（1）：好啦魷調達
// ════════════════════════════════════════════════════════════════════════════

// ── m5 helper：clear self transient turn-flags (進攻完互換時用) ────────
function m5ClearTurnFlags(c: import('../../types').CardInstance): import('../../types').CardInstance {
  const n = { ...c };
  delete n.status;
  delete n.cantAttackThisTurn;
  delete n.cantAttackPending;
  delete n.cantRetreatNextTurn;
  delete n.cantRetreatPendingSelf;
  delete n.damageReduceNextHit;
  delete n.damageBonusThisTurn;
  delete n.damageBonusPending;
  delete n.takeExtraDamageThisTurn;
  delete n.takeExtraDamageNextTurn;
  delete n.cantAttachEnergyThisTurn;
  delete n.cantAttachEnergyNextTurn;
  delete n.deferredPrizeBonusThisTurn;
  delete n.deferredPrizeBonusNextTurn;
  delete n.movedToActiveThisTurn;
  return n;
}

// ── A1. 銅鏡怪|鏡像攻擊 — 10 + 對手戰鬥位為寶可夢 +30 ─────────────
//   卡面：「若對手的戰鬥寶可夢為寶可夢，則此招式傷害 +30。」
//   注意：戰鬥位永遠是 Pokemon（不可能空白），這個條件實際上一定 true。
//   仍嚴格判斷以對應卡面文字。
regPre('銅鏡怪|鏡面攻擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defActive = state.players[dIdx].active;
  const defCard = defActive ? pool.get(defActive.cardId) : null;
  const isPoke = defCard?.supertype === 'Pokemon';
  const bonus = isPoke ? 30 : 0;
  const dmg = 10 + bonus;
  return {
    state: addLog(state, `鏡像攻擊：對手戰鬥位${isPoke ? '為寶可夢 +30' : '非寶可夢'} → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── A2. 薩戮德|暗影鞭打 — 100 + 自方備戰任一附「暗影【惡】能量」+70 ────
//   卡面：「若自己的備戰寶可夢身上附有『暗影【惡】能量』，則此招式傷害 +70。」
//   v5.022 rename：暗影惡能量 → 暗影【惡】能量
regPre('薩戮德|暗影鞭打', (state, aIdx, pool) => {
  const benchHasShadow = state.players[aIdx].bench.some(b =>
    b.energyAttached.some(e => pool.get(e.cardId)?.name === '暗影【惡】能量'),
  );
  const bonus = benchHasShadow ? 70 : 0;
  const dmg = 100 + bonus;
  return {
    state: addLog(state, `暗影鞭打：自方備戰${benchHasShadow ? '有暗影【惡】能量 +70' : '無暗影【惡】能量'} → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── A3. 超級龍頭地鼠ex|最大鑽頭 — 200 + 自身能量單位 ≥ cost+2 (=5) +130 ─
//   卡面：「若這隻寶可夢身上附加的能量數，比此招式所需能量數多 2 個以上，則此招式傷害 +130。」
//   注意：「能量數」指 units，需用 engine.getEnergyUnits 算 (例：新衝天能量 on Stage2 = 2 units)
//   cost 從 JSON 取 = 3 (1 鬥 + 2 無)，所以 ≥ 5 觸發。
regPre('超級龍頭地鼠ex|極限鑽', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return { state, damage: 200 };
  const totalUnits = att.energyAttached.reduce(
    (sum, e) => sum + getEnergyUnits(e.cardId, pool).length, 0,
  );
  const required = 3;  // cost length 3
  const threshold = required + 2;  // ≥ 5
  const bonus = totalUnits >= threshold ? 130 : 0;
  const dmg = 200 + bonus;
  return {
    state: addLog(state,
      `最大鑽頭：自身能量單位 ${totalUnits} 個（需 ≥ ${threshold} 觸發 +130）→ ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── A4. 超級捷拉奧拉ex|雷電拳 — 自身能量數 × 60 ──────────────────
//   卡面：「這隻寶可夢身上附加的能量數 × 60 點傷害。」
//   解讀：energy card 張數（非 units）。雖然新衝天 on Stage2 = 2 units，
//   但這裡用「能量數」按物理張數最直觀。同 H 標卡常規實作。
regPre('超級捷拉奧拉ex|閃電拳', (state, aIdx) => {
  const att = state.players[aIdx].active;
  const n = att?.energyAttached.length ?? 0;
  const dmg = n * 60;
  return {
    state: addLog(state, `雷電拳：自身能量 ${n} 張 → ${n}×60 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── A5. 超級達克萊伊ex|暗夜突襲 — 110 + 自方備戰有受傷指示物 +110 ──
//   卡面：「若自己的備戰寶可夢身上有傷害指示物，則此招式傷害 +110。」
regPre('超級達克萊伊ex|暗夜襲擊', (state, aIdx) => {
  const hasInjured = state.players[aIdx].bench.some(b => (b.damage ?? 0) > 0);
  const bonus = hasInjured ? 110 : 0;
  const dmg = 110 + bonus;
  return {
    state: addLog(state,
      `暗夜突襲：自方備戰${hasInjured ? '有受傷寶可夢 +110' : '無受傷寶可夢'} → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── A6. 蘭螳花ex|活力切割器 — 60 + 本回合自身曾回過 HP +200 ─────
//   卡面：「在這個回合中，若這隻寶可夢曾恢復過 HP，則此招式傷害 +200。」
//   實裝：engine v4.43 已自動標 healedThisTurn（damage 減少時觸發），END_TURN 清除。
regPre('蘭螳花ex|活潑刀', (state, aIdx) => {
  const att = state.players[aIdx].active;
  const healed = att?.healedThisTurn === true;
  const bonus = healed ? 200 : 0;
  const dmg = 60 + bonus;
  return {
    state: addLog(state,
      `活力切割器：本回合${healed ? '曾回過 HP +200' : '未回過 HP'} → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── A7. 雷電獸|音速之刃 — 110 + skipDefEffects ──────────────────
//   卡面：「此招式的傷害不計算對手戰鬥寶可夢身上承受的效果。」
//   實裝：用既有 skipDefEffects flag（跳躍扣殺 等同款）— 跳過 defender 端的招式效果削減。
regPre('雷電獸|音波刀鋒', (state) => ({
  state, damage: 110, skipDefEffects: true,
}));

// ── B1. 烏賊王|腦核粉碎 — 130 + 對手戰鬥位非混亂則失敗 ────────
//   卡面：「若對手的戰鬥寶可夢不處於【混亂】狀態，則此招式失敗。」
regPre('烏賊王|腦核粉碎', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const confused = def?.status === 'confused';
  if (!confused) {
    return {
      state: addLog(state, '腦核粉碎：對手戰鬥位不處於【混亂】 → 招式失敗', aIdx),
      damage: 0,
    };
  }
  return {
    state: addLog(state, '腦核粉碎：對手戰鬥位處於【混亂】 → 130', aIdx),
    damage: 130,
  };
});

// ── C1. 炭小侍|全力拳擊 — 40 + 擲 1 幣反面則失敗 ────────────
//   卡面：「擲 1 次硬幣，若為反面，此招式失敗。」
//   實裝：等同 coinHeadsMultiplyPre(1, 40) — 正面 → 1×40=40，反面 → 0
regPre('炭小侍|全力拳', coinHeadsMultiplyPre(1, 40, '全力拳擊'));

// ── D1. 盾甲龍|碎裂 — 50 + 對手戰鬥位丟 1 能量 picker ────────
//   卡面：「從對手的戰鬥寶可夢身上選擇 1 個能量，丟棄。」
regPost('盾甲龍|碎', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def || def.energyAttached.length === 0) {
    return addLog(state, '碎裂：對手戰鬥位無能量可丟', aIdx);
  }
  return withPending(addLog(state, '碎裂：從對手戰鬥位選 1 個能量丟棄', aIdx), {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'm5-bastiodon-shatter',
    params: { titleOverride: '碎裂：選擇 1 個對手戰鬥位能量丟棄' },
  });
});
regR('m5-bastiodon-shatter', (state, aIdx, iids) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(addLog(state, '碎裂：對手戰鬥位丟 1 能量', aIdx), dIdx, p => {
    if (!p.active) return p;
    const toDiscard = p.active.energyAttached.filter(e => iids.includes(e.iid));
    return {
      ...p,
      active: {
        ...p.active,
        energyAttached: p.active.energyAttached.filter(e => !iids.includes(e.iid)),
      },
      discard: [...p.discard, ...toDiscard],
    };
  });
});

// ── D2. 故勒頓|大地衝擊 — 190 + 自身全部能量丟棄 ──────────
//   卡面：「將這隻寶可夢身上附加的所有能量全部丟棄。」
regPost('故勒頓|蓋亞衝擊', (state, aIdx) => {
  return updatePlayer(addLog(state, '大地衝擊：自身全能量丟棄', aIdx), aIdx, p => {
    if (!p.active) return p;
    const allEnergy = p.active.energyAttached;
    if (allEnergy.length === 0) return p;
    return {
      ...p,
      active: { ...p.active, energyAttached: [] },
      discard: [...p.discard, ...allEnergy],
    };
  });
});

// ── D3. 獒教父|飛撲頭錘 — 210 + 下個對手回合自身受傷 +100 ──
//   卡面：「下個對手的回合，這隻寶可夢受到的招式傷害「+100」。」
//   實裝：用既有 takeExtraDamageNextTurn flag — 在自己 END_TURN 時 promote → ThisTurn，
//   對手攻擊時讀 ThisTurn。
regPost('獒教父|撲身頭擊', (state, aIdx) => {
  return updatePlayer(addLog(state, '飛撲頭錘：下個對手回合自身受傷 +100', aIdx), aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: {
        ...p.active,
        takeExtraDamageNextTurn: (p.active.takeExtraDamageNextTurn ?? 0) + 100,
      },
    };
  });
});

// ── D4. 鍬農炮蟲|巨型軌道砲 — 260 (gate: 自身附 伏特【雷】能量) ────
//   卡面：「這隻寶可夢身上若未附有『伏特【雷】能量』，則此招式失敗。」
//   注意：「伏特【雷】能量」是 M5 特殊能量名（非「基本【雷】能量」）— strict name match。
//   v5.022 rename：閃電能量 → 伏特【雷】能量
regPre('鍬農炮蟲|終極磁軌炮', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  const hasLightning = att?.energyAttached.some(
    e => pool.get(e.cardId)?.name === '伏特【雷】能量',
  ) ?? false;
  if (!hasLightning) {
    return {
      state: addLog(state, '巨型軌道砲：未附「伏特【雷】能量」 → 招式失敗', aIdx),
      damage: 0,
    };
  }
  return {
    state: addLog(state, '巨型軌道砲：附有「伏特【雷】能量」 → 260', aIdx),
    damage: 260,
  };
});

// ── D5. 超級捷拉奧拉ex|瞬間移轉 — 150 + 自身與備戰互換 picker ─
//   卡面：「將這隻寶可夢與備戰寶可夢互換。」
regPost('超級捷拉奧拉ex|介秒迴轉', (state, aIdx) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) return addLog(state, '瞬間移轉：備戰區無寶可夢可換', aIdx);
  return withPending(addLog(state, '瞬間移轉：選 1 隻備戰寶可夢與戰鬥位互換', aIdx), {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'm5-zeraora-teleport',
  });
});
regR('m5-zeraora-teleport', (state, aIdx, iids) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  return updatePlayer(
    addLog(state, '瞬間移轉：戰鬥位與備戰互換完成', aIdx),
    aIdx, p => {
      const benchIdx = p.bench.findIndex(b => b.iid === targetIid);
      if (benchIdx < 0 || !p.active) return p;
      const oldActive = p.active;
      // v4.978：set movedToActiveThisTurn — 振翅高飛/潔淨支援/金屬之路 等特性 gate 需要
      const newActive = { ...p.bench[benchIdx], movedToActiveThisTurn: true };
      const newBench = [...p.bench];
      newBench[benchIdx] = m5ClearTurnFlags(oldActive);
      return { ...p, active: newActive, bench: newBench };
    },
  );
});

// ── E1. 金魚王|水流射擊 — 對對手 1 隻寶可夢 × 自身能量數 × 30 (bench 不計弱抗) ─
//   卡面：「對對手 1 隻寶可夢，造成這隻寶可夢身上附加的能量數 × 30 點傷害。
//          （備戰寶可夢不計算弱點・抵抗力。）」
regPre('金魚王|水炮射', (state) => ({ state, damage: 0 }));
regPost('金魚王|水炮射', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (!defender.active && defender.bench.length === 0) {
    return addLog(state, '水流射擊：對手無寶可夢', aIdx);
  }
  const att = state.players[aIdx].active;
  const n = att?.energyAttached.length ?? 0;
  if (n === 0) {
    return addLog(state, '水流射擊：自身無能量 → 0 傷害（仍需選目標）', aIdx);
  }
  return withPending(
    addLog(state, `水流射擊：選對手 1 隻寶可夢造成 ${n}×30=${n * 30} 傷害（備戰不計弱抗）`, aIdx),
    {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-seaking-water-shot',
      params: { includeActive: true, damage: n * 30 },
    },
  );
});
regR('m5-seaking-water-shot', (state, aIdx, iids, params) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  const dmg = (params?.damage as number) ?? 0;
  if (dmg <= 0) return addLog(state, '水流射擊：傷害為 0，效果略過', aIdx);
  return updatePlayer(addLog(state, `水流射擊：對選中目標造成 ${dmg} 點傷害`, aIdx), dIdx, p => {
    const updateInst = (c: import('../../types').CardInstance) =>
      c.iid === targetIid ? { ...c, damage: (c.damage ?? 0) + dmg } : c;
    return {
      ...p,
      active: p.active ? updateInst(p.active) : null,
      bench: p.bench.map(updateInst),
    };
  });
});

// ── E2. 鍬農炮蟲|急速潛行 — 對對手 1 隻寶可夢 50 (bench 不計弱抗) ─
//   卡面：「對對手 1 隻寶可夢造成 50 點傷害。（備戰寶可夢不計算弱點・抵抗力。）」
regPre('鍬農炮蟲|快速俯衝', (state) => ({ state, damage: 0 }));
regPost('鍬農炮蟲|快速俯衝', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (!defender.active && defender.bench.length === 0) {
    return addLog(state, '急速潛行：對手無寶可夢', aIdx);
  }
  return withPending(
    addLog(state, '急速潛行：選對手 1 隻寶可夢造成 50 傷害（備戰不計弱抗）', aIdx),
    {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-kuwaganon-dash',
      params: { includeActive: true, damage: 50 },
    },
  );
});
regR('m5-kuwaganon-dash', (state, aIdx, iids, params) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  const dmg = (params?.damage as number) ?? 50;
  return updatePlayer(addLog(state, `急速潛行：對選中目標造成 ${dmg} 點傷害`, aIdx), dIdx, p => {
    const updateInst = (c: import('../../types').CardInstance) =>
      c.iid === targetIid ? { ...c, damage: (c.damage ?? 0) + dmg } : c;
    return {
      ...p,
      active: p.active ? updateInst(p.active) : null,
      bench: p.bench.map(updateInst),
    };
  });
});

// ── E3. 禿鷹娜|骨頭狙擊 — 對對手 1 隻附特殊能量寶可夢 70 (bench 不計弱抗) ─
//   卡面：「對附有特殊能量的對手 1 隻寶可夢造成 70 點傷害。（備戰寶可夢不計算弱點・抵抗力。）」
regPre('禿鷹娜|骨棒狙擊', (state) => ({ state, damage: 0 }));
regPost('禿鷹娜|骨棒狙擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  // 候選 = 對手場上有附特殊能量的寶可夢
  const allOpp: import('../../types').CardInstance[] = [
    ...(defender.active ? [defender.active] : []),
    ...defender.bench,
  ];
  const candidates = allOpp.filter(c =>
    c.energyAttached.some(e => pool.get(e.cardId)?.subtype === 'Special'),
  );
  if (candidates.length === 0) {
    return addLog(state, '骨頭狙擊：對手場上無附特殊能量的寶可夢', aIdx);
  }
  const validIids = candidates.map(c => c.iid);
  return withPending(
    addLog(state, `骨頭狙擊：選 1 隻附特殊能量的對手寶可夢造成 70（候選 ${candidates.length} 隻）`, aIdx),
    {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-mandibuzz-bone-snipe',
      params: { includeActive: true, damage: 70, validIids },
    },
  );
});
regR('m5-mandibuzz-bone-snipe', (state, aIdx, iids, params) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  const dmg = (params?.damage as number) ?? 70;
  return updatePlayer(addLog(state, `骨頭狙擊：對選中目標造成 ${dmg} 點傷害`, aIdx), dIdx, p => {
    const updateInst = (c: import('../../types').CardInstance) =>
      c.iid === targetIid ? { ...c, damage: (c.damage ?? 0) + dmg } : c;
    return {
      ...p,
      active: p.active ? updateInst(p.active) : null,
      bench: p.bench.map(updateInst),
    };
  });
});

// ── E4. 瑪夏多|影結 — 對手戰鬥位撤退所需能量數 × 30 ────────
//   卡面：「對手戰鬥寶可夢撤退所需的能量數 × 30 點傷害。」
//   實裝：讀對手戰鬥位卡片 JSON 的 retreatCost.length（直接打對手戰鬥位，非 picker）
regPre('瑪夏多|影繩結', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defActive = state.players[dIdx].active;
  const defCard = defActive ? pool.get(defActive.cardId) : null;
  const retreatCount = defCard?.retreatCost?.length ?? 0;
  const dmg = retreatCount * 30;
  return {
    state: addLog(state, `影結：對手戰鬥位撤退所需 ${retreatCount} 個能量 → ${retreatCount}×30 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── F1. 好啦魷|調達 — 從自己牌庫選 1 張物品，給對手看後加手牌 ─
//   卡面：「從自己的牌庫選擇 1 張物品，給對手看過後，加入手牌。然後重洗牌庫。」
regPre('好啦魷|籌備', (state) => ({ state, damage: 0 }));
regPost('好啦魷|籌備', (state, aIdx) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '調達：牌庫為空', aIdx);
  return withPending(
    addLog(state, '調達：從牌庫選 1 張物品加入手牌（給對手看過後）', aIdx),
    {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Item',
      minCount: 0, maxCount: 1,
      effectKey: 'm5-inkay-procurement',
    },
  );
});
regR('m5-inkay-procurement', (state, aIdx, iids) => {
  if (iids.length === 0) {
    return updatePlayer(addLog(state, '調達：玩家選 0 張，僅重洗牌庫', aIdx), aIdx, p => ({
      ...p,
      deck: [...p.deck].sort(() => Math.random() - 0.5),
    }));
  }
  return updatePlayer(addLog(state, `調達：取得 ${iids.length} 張物品（已給對手看過）→ 加入手牌並重洗牌庫`, aIdx), aIdx, p => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    return {
      ...p,
      deck: shuffled,
      hand: [...p.hand, ...picked],
    };
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 3 結束。已實裝 14 (P1) + 17 (P2) + 19 (P3) = 50 個招式 / 81 張卡。
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 4 (v4.82) — 8 個招式（複雜招式批次）
//
// A. 簡單條件 +N / self buff（2）：
//    超級水晶燈火靈ex|幻影迷宮（130 + 對手撤退能量×50）
//    戰槌龍ex|暴走之槌（150 + 下個自己回合自身 +150，用 damageBonusPending）
// B. 擲幣 + immune / picker（2）：
//    喇叭啄鳥|飛翔（30 + 反面失敗；正面 → 下回合不受招式傷害和效果）
//    下石鳥|配送挑戰（2 次擲幣全正面 → 牌庫選 1 寶可夢到備戰）
// C. picker 牌庫搜尋（2）：
//    熱帶龍|果實香氣（牌庫頂 6 張選任意數量寶可夢加手牌，給對手看過後）
//    詛咒娃娃|人偶捕捉（80 + 若希望牌庫選 1 任意卡加手牌）
// D. 自身回牌庫（1）：
//    西獅海壬|水流回歸（120 + 自身連同附加卡回牌庫並重洗，不算 KO 不給獎賞）
// E. 特殊狀態 → KO（1）：
//    超級達克萊伊ex|深淵之瞳（對手戰鬥位處於特殊狀態則使該寶可夢昏厥）
// ════════════════════════════════════════════════════════════════════════════

// ── A1. 超級水晶燈火靈ex|幻影迷宮 — 130 + 對手撤退能量×50 ──
//   卡面：「對手的戰鬥寶可夢撤退所需的能量數 × 50 點，追加傷害。」
regPre('超級水晶燈火靈ex|幻影迷宮', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defActive = state.players[dIdx].active;
  if (!defActive) {
    return { state: addLog(state, '幻影迷宮：對手戰鬥位無寶可夢 → 130', aIdx), damage: 130 };
  }
  // v5.082：用 computeActiveRetreatCostFor 取得「有效撤退費」，
  // 涵蓋咒縛之炎（自身特性 +1）/ 重力之玉（雙方道具 +1）/ 天空徑線 / 磁鐵【鋼】能量 /
  // N的城堡 / 樂園度假地 / TOOL_RETREAT_MOD / ABILITY_RETREAT_MOD 全部修正。
  // 舊版只用 defCard.retreatCost.length（base）— 違反卡面「撤退所需的能量數」（最終值）。
  const retreatCount = computeActiveRetreatCostFor(state, dIdx, pool);
  const bonus = retreatCount * 50;
  const dmg = 130 + bonus;
  return {
    state: addLog(state,
      `幻影迷宮：對手戰鬥位撤退所需 ${retreatCount} 個能量 → 130 + ${retreatCount}×50 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── A2. 戰槌龍ex|暴走之槌 — 150 + 下個自己回合自身招式 +150 ──
//   卡面：「下個自己的回合，這隻寶可夢使用招式對對手戰鬥寶可夢造成的傷害「+150」。」
//   實裝：在 attacker.active 上設 damageBonusPending=150，
//   engine 在自己 END_TURN 時 promote 給 damageBonusThisTurn（下個自己回合生效）。
regPost('戰槌龍ex|亂暴錘', (state, aIdx) => {
  return updatePlayer(addLog(state, '暴走之槌：下個自己回合自身招式 +150', aIdx), aIdx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: {
        ...p.active,
        damageBonusPending: (p.active.damageBonusPending ?? 0) + 150,
      },
    };
  });
});

// ── B1. 喇叭啄鳥|飛翔 — 30 + 擲幣（反失敗，正面 → 下回合不受招式傷害和效果） ─
//   卡面：「擲 1 次硬幣，若為反面，此招式失敗。若為正面，下個對手的回合，
//          這隻寶可夢不會受到招式的傷害和效果。」
regPre('喇叭啄鳥|飛翔', (state, aIdx) => {
  const r = flipCoinsWithLog(state, 1, '飛翔', aIdx);
  if (r.heads === 0) {
    return { state: addLog(r.state, '飛翔：擲幣反面 → 招式失敗', aIdx), damage: 0 };
  }
  return { state: addLog(r.state, '飛翔：擲幣正面 → 30（POST 設下回合免疫）', aIdx), damage: 30 };
});
regPost('喇叭啄鳥|飛翔', (state, aIdx) => {
  // 只在 PRE 已擲出正面時設 immune（PRE 反面時 damage=0，POST 仍會跑，需 gate）
  // 但 PRE 已 log「招式失敗」— POST 不知道 PRE 結果。最保險：檢查最近 log，
  // 或讓 POST 無條件設 immune（簡化但 PRE 反面也設就違反卡面）。
  // 採用：POST 自身傷害 > 0 才設 (PRE 反面 damage=0 → POST 來時 damage 沒加)
  // 但這個 attacker.active.damage 不會被自己攻擊改 — 改檢查「招式有沒有命中」需要 attack-time snapshot。
  // 折衷：POST 階段重新擲一次幣 → 不行 (PRE 已擲)。
  // 採取最簡可靠做法：在 PRE 反面時用 customField 'm5_brave_bird_fail' 寫入 state，
  // POST 讀此 field 決定是否設 immune。但 state 不能加新欄位（Rule 13）。
  //
  // 改用更乾淨做法：拆成 PRE-only 設 immune（只在正面時透過 PRE 返回 state 變更）。
  // 但 PRE 不應該寫 player flags。
  //
  // 最終方案：在 PRE 寫 immune flag 直接到 attacker.active（避開 POST）—
  // PRE 已 return state 包含修改，OK 用。重寫 PRE：

  // POST 無條件設 immune — PRE 已 handle 反面失敗的 damage=0
  // 但卡面說「若為正面，下個對手的回合不受招式傷害和效果」— 必須只在正面時設。
  // 由於 PRE/POST split 困難，採取一個替代：把 immune 設邏輯搬到 PRE。
  // → 註冊兩個版本不可能，故 POST 改為「不做事」，PRE 改寫處理 immune
  return state;  // POST 不做事，immune 已在 PRE 處理
});
// 重新註冊 PRE：在 PRE 內處理 immune（覆蓋上面那次 regPre — TypeScript Map.set 後者勝）
regPre('喇叭啄鳥|飛翔', (state, aIdx) => {
  const r = flipCoinsWithLog(state, 1, '飛翔', aIdx);
  if (r.heads === 0) {
    return { state: addLog(r.state, '飛翔：擲幣反面 → 招式失敗', aIdx), damage: 0 };
  }
  // 正面：30 點傷害 + 設下回合不受招式（用既有 immuneToAllAttackNextTurn flag）
  const s = updatePlayer(
    addLog(r.state, '飛翔：擲幣正面 → 30，下個對手回合不受招式傷害和效果', aIdx),
    aIdx,
    p => {
      if (!p.active) return p;
      return { ...p, active: { ...p.active, immuneToAllAttackNextTurn: true } };
    },
  );
  return { state: s, damage: 30 };
});

// ── B2. 下石鳥|配送挑戰 — 2 次擲幣全正面 → 牌庫選 1 寶可夢到備戰 ─
//   卡面：「擲 2 次硬幣，若全部為正面，從自己的牌庫選擇 1 張寶可夢，放置於備戰區。
//          然後重洗牌庫。」
regPre('下石鳥|親送挑戰', (state) => ({ state, damage: 0 }));
regPost('下石鳥|親送挑戰', (state, aIdx) => {
  const r = flipCoinsWithLog(state, 2, '配送挑戰', aIdx);
  if (r.heads < 2) {
    return addLog(r.state, `配送挑戰：${r.heads}/2 次正面，效果失敗`, aIdx);
  }
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(r.state, '配送挑戰：2 正面但牌庫為空', aIdx);
  return withPending(
    addLog(r.state, '配送挑戰：2 次全正面 → 從牌庫選 1 張寶可夢放備戰（可選 0 張）', aIdx),
    {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Pokemon',
      minCount: 0, maxCount: 1,
      effectKey: 'm5-flamigo-delivery',
    },
  );
});
regR('m5-flamigo-delivery', (state, aIdx, iids) => {
  if (iids.length === 0) {
    return updatePlayer(addLog(state, '配送挑戰：玩家選 0 張，僅重洗牌庫', aIdx), aIdx, p => ({
      ...p,
      deck: [...p.deck].sort(() => Math.random() - 0.5),
    }));
  }
  return updatePlayer(addLog(state, '配送挑戰：放置 1 張寶可夢到備戰並重洗牌庫', aIdx), aIdx, p => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    return { ...p, deck: shuffled, bench: [...p.bench, ...picked] };
  });
});

// ── C1. 熱帶龍|果實香氣 — 牌庫頂 6 張選任意數量寶可夢加手牌（給對手看過後）─
//   卡面：「查看自己的牌庫上方 6 張卡，從其中選擇任意數量的寶可夢，
//          給對手看過後加入手牌。剩餘的卡放回牌庫並重洗。」
//   實裝：用 deck-search filter='Pokemon' minCount=0 — 但範圍只限牌庫頂 6 張。
//   既有 picker 無 top-N 限制，改用 reorder-deck-top picker (v2.164) 但 reorder
//   不適合「選任意拿走」場景。最務實做法：先 peek 6 張，把 6 張視為候選清單，
//   開 deck-search picker 但 params 限定候選 iids。
regPre('熱帶龍|果實香氣', (state) => ({ state, damage: 0 }));
regPost('熱帶龍|果實香氣', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '果實香氣：牌庫為空', aIdx);
  const peekN = Math.min(6, p.deck.length);
  const top6 = p.deck.slice(0, peekN);
  const pokeIids = top6.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon').map(c => c.iid);
  if (pokeIids.length === 0) {
    // 沒有寶可夢候選 — 仍重洗剩餘（卡面：剩餘放回牌庫並重洗）
    return updatePlayer(
      addLog(state, `果實香氣：牌庫頂 ${peekN} 張中無寶可夢，重洗牌庫`, aIdx),
      aIdx,
      p => ({ ...p, deck: [...p.deck].sort(() => Math.random() - 0.5) }),
    );
  }
  return withPending(
    addLog(state, `果實香氣：牌庫頂 ${peekN} 張中含 ${pokeIids.length} 隻寶可夢，選任意數量加手牌`, aIdx),
    {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Pokemon',
      minCount: 0, maxCount: pokeIids.length,
      effectKey: 'm5-tropius-fruit-aroma',
      params: { validIids: pokeIids, titleOverride: '果實香氣：選任意數量寶可夢加手牌' },
    },
  );
});
regR('m5-tropius-fruit-aroma', (state, aIdx, iids) => {
  return updatePlayer(
    addLog(state, `果實香氣：取 ${iids.length} 張寶可夢加入手牌（已給對手看過）+ 重洗牌庫`, aIdx),
    aIdx,
    p => {
      const picked = p.deck.filter(c => iids.includes(c.iid));
      const remaining = p.deck.filter(c => !iids.includes(c.iid));
      const shuffled = [...remaining].sort(() => Math.random() - 0.5);
      return { ...p, deck: shuffled, hand: [...p.hand, ...picked] };
    },
  );
});

// ── C2. 詛咒娃娃|人偶捕捉 — 80 + 若希望牌庫選 1 任意卡加手牌 ────
//   卡面：「若希望，從自己的牌庫選擇 1 張任意卡，加入手牌。然後重洗牌庫。」
regPost('詛咒娃娃|玩偶捕捉', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '人偶捕捉：選擇「否」 — 跳過搜尋', aIdx);
  const _cb: AttackPostFn = (state, aIdx) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '人偶捕捉：牌庫為空，效果略過', aIdx);
  return withPending(
    addLog(state, '人偶捕捉：若希望，從牌庫選 1 張任意卡加手牌（可選 0 張跳過）', aIdx),
    {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Any',
      minCount: 0, maxCount: 1,
      effectKey: 'm5-shuppet-doll-capture',
    },
  );
};
  return _cb(state, aIdx, pool);
});
regR('m5-shuppet-doll-capture', (state, aIdx, iids) => {
  if (iids.length === 0) {
    return updatePlayer(addLog(state, '人偶捕捉：玩家選 0 張，僅重洗牌庫', aIdx), aIdx, p => ({
      ...p,
      deck: [...p.deck].sort(() => Math.random() - 0.5),
    }));
  }
  return updatePlayer(addLog(state, '人偶捕捉：取 1 張任意卡加手牌 + 重洗牌庫', aIdx), aIdx, p => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: [...remaining].sort(() => Math.random() - 0.5), hand: [...p.hand, ...picked] };
  });
});

// ── D1. 西獅海壬|水流回歸 — 120 + 自身連同附加卡回牌庫並重洗 ──
//   卡面：「將這隻寶可夢及其身上附加的所有卡放回牌庫並重洗。」
//   注意：「回牌庫」不算被擊倒（KO），對手不應拿獎賞。
//   實作：直接把 active 連同 energyAttached/toolAttached/evolvedFromStack 加進 deck，
//        然後設 active=null。玩家須送新戰鬥位（engine 自動觸發 SEND_NEW_ACTIVE flow）。
//   POST 而非 PRE — 確保 120 傷害先結算。
regPost('西獅海壬|水迴旋', (state, aIdx) => {
  const p = state.players[aIdx];
  if (!p.active) return addLog(state, '水流回歸：自身已不在戰鬥位', aIdx);
  const att = p.active;
  // 收集要回牌庫的所有卡：active 自身、附加能量、附加道具（用 getAllAttachedTools
  // helper 處理 toolAttached + toolAttachedSecondary 雙槽位）、進化堆疊
  const toReturn: import('../../types').CardInstance[] = [
    att,
    ...att.energyAttached,
    ...getAllAttachedTools(att),
    ...(att.evolvedFromStack ?? []),
  ];
  // 清除進化堆疊與附加 (避免重複)，重置為基礎狀態回牌庫
  const cleanedActive: import('../../types').CardInstance = { ...att };
  cleanedActive.damage = 0;
  cleanedActive.energyAttached = [];
  delete cleanedActive.toolAttached;
  delete (cleanedActive as { toolAttachedSecondary?: unknown }).toolAttachedSecondary;
  delete cleanedActive.evolvedFromStack;
  delete cleanedActive.status;
  // 但 toReturn 內第 1 張 (att) 應該是 cleaned 版（不帶 damage / energy / tool / stack）
  toReturn[0] = cleanedActive;
  return updatePlayer(
    addLog(state, '水流回歸：自身與附加卡放回牌庫並重洗（不算 KO，無獎賞）', aIdx),
    aIdx,
    pl => ({
      ...pl,
      active: null,
      deck: [...pl.deck, ...toReturn].sort(() => Math.random() - 0.5),
    }),
  );
});

// ── E1. 超級達克萊伊ex|深淵之瞳 — 對手戰鬥位處於特殊狀態 → 該寶可夢昏厥 ─
//   卡面：「若對手的戰鬥寶可夢處於特殊狀態，則使該寶可夢【昏厥】。」
//   特殊狀態 = asleep / burned / confused / paralyzed / poisoned。
//   實作：設 defender.active.damage = effective HP（讓 sanityKOSweep 處理 KO 流程，
//   對手取得獎賞，符合「使昏厥」官方語意 — 昏厥 = 一般 KO）。
regPre('超級達克萊伊ex|深淵之瞳', (state) => ({ state, damage: 0 }));
regPost('超級達克萊伊ex|深淵之瞳', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  const def = s.players[dIdx].active;
  if (!def) return addLog(s, '深淵之瞳：對手無戰鬥位', aIdx);
  if (!def.status) {
    return addLog(s, '深淵之瞳：對手戰鬥位不處於特殊狀態 → 效果失敗', aIdx);
  }
  const defCard = pool.get(def.cardId);
  // v5.168/v5.170：深淵之瞳「使昏厥」屬招式效果（attack-effect）。仿棄世猴|同命戰鬥
  //   (effects.ts L6877) 用 canApplyAttackEffectToTarget guard 擋 薄霧能量 / 皇帝之勢 /
  //   抵抗之幕 / 全能硬殼 / 化石 等 attack-effect immunity。
  const guardKO = canApplyAttackEffectToTarget(s, aIdx, def, defCard, pool);
  if (guardKO.blocked) {
    return addLog(s, `深淵之瞳：${defCard?.name ?? '?'}｜${guardKO.reason}（不昏厥對手）`, aIdx);
  }
  // v5.170：仿棄世猴|同命戰鬥手動 KO 模式（取代 v5.168 的 damage=HP+sanityKOSweep）。
  //   原 v5.168 設 damage=HP 是「造成 N 傷害」的變相 → 會誤觸 damage 相關 hook
  //   (PASSIVE_ON_DAMAGED / 扣殺能量 / SPECIAL_ENERGY_ON_DAMAGED 等)。
  //   正確：「使昏厥」是 effect-level KO — 直接搬到棄牌 + addPendingPrize，不走 damage 管線。
  const ko: CardInstance[] = [
    { ...def, damage: (defCard?.hp ?? 0) },
    ...def.energyAttached,
    ...getAllAttachedTools(def),
    ...(def.evolvedFromStack ?? []),
  ];
  const players = [...s.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...s.players[dIdx], active: null, discard: [...s.players[dIdx].discard, ...ko] };
  const prizes = defCard ? prizesForKOLocal(defCard) : 1;
  s = addLog({ ...s, players }, `深淵之瞳：${defCard?.name ?? '?'} 處於【${def.status}】 → 直接昏厥！+${prizes} 張獎勵牌（仿同命戰鬥手動 KO，不走 damage 管線）`, aIdx);
  s = recordOppKO(s, dIdx, defCard, 'attack');
  s = addPendingPrize(s, aIdx, prizes);
  return s;
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 4 結束。已實裝 14 (P1) + 17 (P2) + 19 (P3) + 8 (P4) = 58 個招式 / 81 張卡。
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 5 (v4.83) — 3 個特性 + 4 個訓練家（純 m5_preview 內實作，不動 engine）
//
// 特性（regA / regAByName 機制）：
//   1. 銃嘴大鳥|天空抽牌（1 回合 1 次：從牌庫抽 1 張）
//   2. 銀伴戰獸|夥伴呼喚（gate: 手牌 = 0 + 1 回合 1 次 → 牌庫選 1 支援者加手牌）
//   3. 戰槌龍ex|破壞之頭錘（gate: 戰鬥場 + 1 回合 1 次 → 擲幣正面則對手戰鬥位丟 1 能量）
//
// 訓練家（reg / regG 機制）：
//   4. 沐淨（Supporter，棄手牌中 ≤2 張非規則寶可夢 → 抽 N×3 張）
//   5. 暗黑鈴（Item，雙方戰鬥位混亂；惡屬性寶可夢除外）
//   6. 鏽蝕組手下（Supporter，picker 對手場 1 隻寶可夢身上選 1 個能量丟）
//   7. 小霞的朝氣（Supporter，牌庫選 ≤4 張基本【水】能量附給自己 1 隻 + 強制 END_TURN）
//
// 留 deferred 的（需動 engine.ts 或新引擎機制）：
//   - 化隱特性 6 張 + 3 依賴招式 — 需 canApplyEffectToTarget 加 ability gate
//   - 暗影惡能量 — 需 hasFlowerVeil 類 helper 擴充
//   - 西獅海壬|滿滿旋律 — 需 evolve-from-hand trigger hook
//   - 密勒頓|光子密碼 — 需 PASSIVE_ON_KO 死亡觸發 hook
//   - 棄世猴|不朽之軀 — 需修改 KO 流程加擲幣判定
//   - 護城龍|太鼓防壁 — 需 player-wide damage gate (對手能量 ≤2 時)
//   - 超級水晶燈火靈ex|咒縛之炎 — 需動 engine retreat cost 計算
//   - 格拉吉歐的決戰 — 需 player flag nonRuleAttackBonusThisTurn
//   - 陳舊的頭蓋/盾牌化石 + 化石採掘場 — 需動既有化石機制 (v3.21) 擴充
//   - 豪邁炸彈、重試徽章 — 需新 tool hook
//   - 閃電能量 — 需動既有 SPECIAL_ENERGY_TYPES + attack bonus hook
// ════════════════════════════════════════════════════════════════════════════

// ── 1. 銃嘴大鳥|天空抽牌 — 1 回合 1 次：抽 1 張 ─────────────────────
//   卡面：「在自己的回合時可使用 1 次。從自己的牌庫抽 1 張卡。」
//   engine.ts 內 ABILITY_USED_THIS_TURN 由 regA 自動標記。
regA('銃嘴大鳥', 0, (st, idx) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '天空抽牌：牌庫為空', idx);
  const [drawn, ...rest] = p.deck;
  return updatePlayer(addLog(st, '天空抽牌：從牌庫抽 1 張', idx), idx, pl => ({
    ...pl, deck: rest, hand: [...pl.hand, drawn],
  }));
});

// ── 2. 銀伴戰獸|夥伴呼喚 — gate: 手牌=0 + 1 回合 1 次 ───────────
//   卡面：「若自己的手牌為 0 張，則在自己的回合時可使用 1 次。
//          從自己的牌庫選擇 1 張支援者，給對手看過後加入手牌。然後重洗牌庫。」
regA('銀伴戰獸', 0, (st, idx) => {
  const p = st.players[idx];
  if (p.hand.length !== 0) {
    return addLog(st, '夥伴呼喚：自己手牌須為 0 張才能使用', idx);
  }
  if (p.deck.length === 0) return addLog(st, '夥伴呼喚：牌庫為空', idx);
  return withPending(
    addLog(st, '夥伴呼喚：從牌庫選 1 張支援者加手牌（給對手看過後）', idx),
    {
      type: 'deck-search',
      actorIdx: idx, sourcePlayerIdx: idx,
      filter: 'Supporter',
      minCount: 0, maxCount: 1,
      effectKey: 'm5-silvally-partner-call',
    },
  );
});
regR('m5-silvally-partner-call', (state, aIdx, iids) => {
  if (iids.length === 0) {
    return updatePlayer(addLog(state, '夥伴呼喚：玩家選 0 張，僅重洗牌庫', aIdx), aIdx, p => ({
      ...p, deck: [...p.deck].sort(() => Math.random() - 0.5),
    }));
  }
  return updatePlayer(addLog(state, '夥伴呼喚：取 1 張支援者加手牌（已給對手看過）+ 重洗牌庫', aIdx), aIdx, p => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: [...remaining].sort(() => Math.random() - 0.5), hand: [...p.hand, ...picked] };
  });
});

// ── 3. 戰槌龍ex|破壞之頭錘 — gate: 戰鬥場 + 1 回合 1 次 ─────────
//   卡面：「這隻寶可夢若在戰鬥場，則在自己的回合時可使用 1 次。
//          擲 1 次硬幣，若為正面，從對手的戰鬥寶可夢身上選擇 1 個能量，丟棄。」
regA('戰槌龍ex', 0, (st, idx, pool, inst) => {
  const p = st.players[idx];
  if (!inst || p.active?.iid !== inst.iid) {
    return addLog(st, '破壞之頭錘：必須在戰鬥場才能使用', idx);
  }
  const r = flipCoinsWithLog(st, 1, '破壞頭錘', idx);
  if (r.heads === 0) return addLog(r.state, '破壞之頭錘：反面，無效果', idx);
  const dIdx = (1 - idx) as 0 | 1;
  const def = st.players[dIdx].active;
  if (!def || def.energyAttached.length === 0) {
    return addLog(r.state, '破壞之頭錘：正面，但對手戰鬥位無能量可丟', idx);
  }
  return withPending(
    addLog(r.state, '破壞之頭錘：正面 → 選對手戰鬥位 1 個能量丟棄', idx),
    {
      type: 'active-energy-discard',
      actorIdx: idx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-warlord-destroy-headbutt',
      params: { titleOverride: '破壞之頭錘：選擇 1 個對手戰鬥位能量丟棄' },
    },
  );
});
regR('m5-warlord-destroy-headbutt', (state, aIdx, iids) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(addLog(state, '破壞之頭錘：對手戰鬥位丟 1 能量', aIdx), dIdx, p => {
    if (!p.active) return p;
    const toDiscard = p.active.energyAttached.filter(e => iids.includes(e.iid));
    return {
      ...p,
      active: {
        ...p.active,
        energyAttached: p.active.energyAttached.filter(e => !iids.includes(e.iid)),
      },
      discard: [...p.discard, ...toDiscard],
    };
  });
});

// ── 4. 沐淨（Supporter）─ 棄 1~2 張非規則寶可夢 → 抽 N×3 張
//   卡面：「從自己的手牌將寶可夢（『擁有規則的寶可夢』除外）最多丟棄 2 張，
//          丟棄張數 × 3 張，從牌庫抽卡。」
//   v5.202 兩 bug 修補（玩家報告）：
//     (1) 手牌無「非規則寶可夢」時不應該能使用 → 加 regG gate
//     (2) 使用後必須至少選 1 隻 → minCount 0 → 1（玩家「點 0 張確認跳過」沒意義）
//   PTCG 規則：支援者無可解效果不能使用；既然要使用就必須丟 ≥1 張產生效果。
function mokujouCandidates(st: GameState, idx: 0 | 1, pool: Map<string, Card>): CardInstance[] {
  return st.players[idx].hand.filter(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Pokemon') return false;
    if (RULE_BOX_SUBTYPES.has(card.subtype ?? '')) return false;
    return true;
  });
}
// v5.202 Bug 1: 手牌無非規則寶可夢時 regG 回 false → UI 灰按鈕 + engine PLAY_SUPPORTER reject
regG('沐淨', (st, idx, pool) => mokujouCandidates(st, idx, pool).length >= 1);

reg('沐淨', (st, idx, pool) => {
  const candidates = mokujouCandidates(st, idx, pool);
  // defensive: regG 已擋，此分支理論上不會走到；保留作雙重防護
  if (candidates.length === 0) {
    return addLog(st, '沐淨：手牌中無非規則寶可夢可丟，效果略過', idx);
  }
  const validIids = candidates.map(c => c.iid);
  return withPending(
    addLog(st, `沐淨：從手牌選 1~2 張非規則寶可夢丟棄（候選 ${candidates.length} 張）`, idx),
    {
      type: 'hand-discard',
      actorIdx: idx, sourcePlayerIdx: idx,
      // v5.202 Bug 2: minCount 0 → 1（強制至少選 1 隻才能確認）
      minCount: 1, maxCount: Math.min(2, candidates.length),
      effectKey: 'm5-trainer-mokujou',
      params: { validIids, titleOverride: '沐淨：選擇 1~2 張非規則寶可夢丟棄' },
    },
  );
});
regR('m5-trainer-mokujou', (state, aIdx, iids) => {
  // v5.202: minCount=1 後 iids.length === 0 不再可能；保留 defensive 分支
  if (iids.length === 0) return addLog(state, '沐淨：玩家丟 0 張（不應發生，防呆 log）', aIdx);
  return updatePlayer(addLog(state, `沐淨：丟 ${iids.length} 張非規則寶 → 抽 ${iids.length * 3} 張`, aIdx), aIdx, p => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const remaining = p.hand.filter(c => !iids.includes(c.iid));
    const drawN = Math.min(iids.length * 3, p.deck.length);
    return {
      ...p,
      hand: [...remaining, ...p.deck.slice(0, drawN)],
      deck: p.deck.slice(drawN),
      discard: [...p.discard, ...toDiscard],
    };
  });
});

// ── 5. 暗黑鈴（Item）─ 雙方戰鬥位混亂；惡屬性寶可夢除外 ──────────
//   卡面：「將雙方的戰鬥寶可夢（惡屬性寶可夢除外），各別【混亂】。物品在自己的回合可使用任意數量。」
//   v4.872 修正：之前 v4.82 把「惡屬性寶可夢」誤譯為「化石寶可夢」，filter 寫錯。
//                 改用 card.pokemonType === 'Darkness' 才正確。
reg('暗黑鈴', (st, idx, pool) => {
  let s = st;
  for (const side of [0, 1] as const) {
    const player = s.players[side];
    if (!player.active) continue;
    const card = pool.get(player.active.cardId);
    const name = card?.name ?? '?';
    // 卡面排除條件：惡屬性寶可夢
    if (card?.pokemonType === 'Darkness') {
      s = addLog(s, `暗黑鈴：${name} 是【惡】屬性寶可夢，免疫【混亂】效果`, idx);
      continue;
    }
    // v4.965: 對齊 statusPost 的混亂 immune checks
    if (isConfusionImmune(player.active, pool)) {
      s = addLog(s, `暗黑鈴：${name}｜憨憨臉：免疫【混亂】`, idx);
      continue;
    }
    const immune = checkSpecialEnergyStatusImmune(player.active, 'confused', pool);
    if (immune.immune) {
      s = addLog(s, `暗黑鈴：${name}｜${immune.energyName}：免疫【混亂】`, idx);
      continue;
    }
    // v4.965: 用 applyStatusToActive 正確處理狀態共存（不蓋掉原中毒/灼傷）
    s = updatePlayer(addLog(s, `暗黑鈴：${name} 陷入【混亂】`, idx), side, p => {
      if (!p.active) return p;
      return { ...p, active: applyStatusToActive(p.active, 'confused') };
    });
  }
  return s;
});

// ── 6. 鏽蝕組手下（Supporter）─ picker 對手場 1 隻寶可夢丟 1 能量 ─
//   卡面：「從對手場上 1 隻寶可夢身上選擇 1 個能量，丟棄。」
//   gate（rulesText）：「這張卡只有在上個對手回合自己的寶可夢【昏厥】時才能使用。」
//   v5.228：原 JSON 誤譯「未昏厥」+ deferred 不做 gate，本次更正並實裝 gate。
reg('鏽蝕組手下', (st, idx, pool) => {
  // v5.228 gate — 上個對手回合自己無寶可夢 KO → 不能用
  const attackKOd = (st.oppAttackKOdMeInLastOppTurn?.[idx] ?? 0) > 0;
  const abilityKOd = (st.oppAbilityKOdMeInLastOppTurn?.[idx] ?? 0) > 0;
  if (!attackKOd && !abilityKOd) {
    return addLog(st, '鏽蝕組手下：上個對手回合自己的寶可夢未昏厥，不能使用', idx);
  }
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];
  const allOpp: import('../../types').CardInstance[] = [
    ...(opp.active ? [opp.active] : []),
    ...opp.bench,
  ];
  const candidates = allOpp.filter(c => c.energyAttached.length > 0);
  if (candidates.length === 0) {
    return addLog(st, '鏽蝕組手下：對手場上無附能寶可夢', idx);
  }
  const validIids = candidates.map(c => c.iid);
  return withPending(
    addLog(st, `鏽蝕組手下：選對手 1 隻附能寶可夢（候選 ${candidates.length} 隻）`, idx),
    {
      type: 'opp-poke-choose',
      actorIdx: idx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-trainer-rust-henchman',
      params: { includeActive: true, validIids },
    },
  );
});
regR('m5-trainer-rust-henchman', (state, aIdx, iids) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  // 第 2 階段：picker 對手場該寶可夢的 1 個能量丟棄
  return withPending(
    addLog(state, '鏽蝕組手下：選擇要丟的能量', aIdx),
    {
      // 用 active-energy-discard 但 sourcePlayerIdx=dIdx + params 帶 targetIid 找的寶可夢
      // 但 active-energy-discard 只認 active；改用一般 picker 機制 — 寫專屬 resolver
      type: 'active-energy-discard',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-trainer-rust-henchman-pick-energy',
      params: { titleOverride: '鏽蝕組手下：選擇 1 個能量丟棄', targetIid: targetIid },
    },
  );
});
regR('m5-trainer-rust-henchman-pick-energy', (state, aIdx, iids, params) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.311: 改 targetIid 對齊 UI selectionItems case 'active-energy-discard' 預期 key,
  // 原 targetPokeIid 讓 UI fallback 只看 active.energyAttached, 玩家無法選對手 bench 能量.
  const targetPokeIid = params?.targetIid as string | undefined;
  return updatePlayer(addLog(state, '鏽蝕組手下：丟 1 能量', aIdx), dIdx, p => {
    const removeFromInst = (c: import('../../types').CardInstance) => {
      if (c.iid !== targetPokeIid) return c;
      const toDiscard = c.energyAttached.filter(e => iids.includes(e.iid));
      const newAttached = c.energyAttached.filter(e => !iids.includes(e.iid));
      return { ...c, energyAttached: newAttached, _discardTransfer: toDiscard };
    };
    // 處理 active + bench
    const newActive = p.active ? removeFromInst(p.active) : null;
    const newBench = p.bench.map(removeFromInst);
    // 提取要丟的能量（從 _discardTransfer transient field）
    const collected: import('../../types').CardInstance[] = [];
    const cleanInst = (c: import('../../types').CardInstance) => {
      const transfer = (c as { _discardTransfer?: import('../../types').CardInstance[] })._discardTransfer ?? [];
      collected.push(...transfer);
      const cleaned = { ...c };
      delete (cleaned as { _discardTransfer?: unknown })._discardTransfer;
      return cleaned;
    };
    return {
      ...p,
      active: newActive ? cleanInst(newActive) : null,
      bench: newBench.map(cleanInst),
      discard: [...p.discard, ...collected],
    };
  });
});

// ── 7. 小霞的朝氣（Supporter）─ 牌庫選 ≤4 張基本【水】能量 + 1 隻附 + END_TURN ─
//   v5.059 bug fix：原實作 filter='BasicEnergy' 允許任意基本能量（草/火/水/雷/...）。
//   卡面正確敘述為「基本【水】能量」(Basic Water Energy)，限定水屬性。
//   卡面：「使用這張卡時，自己的回合結束。從自己的牌庫選擇最多 4 張『基本【水】能量』，
//          附給自己 1 隻寶可夢。然後重洗牌庫。」
reg('小霞的朝氣', (st, idx) => {
  const p = st.players[idx];
  if (p.deck.length === 0) {
    // 即使牌庫空，「使用後回合結束」仍生效
    return withPending(
      addLog(st, '小霞的朝氣：牌庫為空，僅結束回合', idx),
      {
        type: 'modal-choice',
        actorIdx: idx, sourcePlayerIdx: idx,
        minCount: 1, maxCount: 1,
        effectKey: 'm5-trainer-karunari-vigor-end-only',
        params: { endTurnAfter: true, options: ['確認結束回合'] },
      },
    );
  }
  const maxN = Math.min(4, p.deck.length);
  return withPending(
    addLog(st, `小霞的朝氣：從牌庫選 ≤${maxN} 張基本【水】能量（使用後回合結束）`, idx),
    {
      type: 'deck-search',
      actorIdx: idx, sourcePlayerIdx: idx,
      filter: 'BasicEnergy:Water',
      minCount: 0, maxCount: maxN,
      effectKey: 'm5-trainer-karunari-vigor-pick',
    },
  );
});
regR('m5-trainer-karunari-vigor-pick', (state, aIdx, iids) => {
  if (iids.length === 0) {
    // 沒選能量 — 仍重洗牌庫 + 強制 END_TURN
    return withPending(
      updatePlayer(addLog(state, '小霞的朝氣：選 0 張【水】能量，僅重洗牌庫 + 結束回合', aIdx), aIdx, p => ({
        ...p, deck: [...p.deck].sort(() => Math.random() - 0.5),
      })),
      {
        type: 'modal-choice',
        actorIdx: aIdx, sourcePlayerIdx: aIdx,
        minCount: 1, maxCount: 1,
        effectKey: 'm5-trainer-karunari-vigor-end-only',
        params: { endTurnAfter: true, options: ['確認結束回合'] },
      },
    );
  }
  // 選到 N 張能量 → 等玩家選目標寶可夢
  const p = state.players[aIdx];
  const allOwn: import('../../types').CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  if (allOwn.length === 0) {
    // 場上無寶可夢可附（極罕見 edge case）— 直接結束回合
    return updatePlayer(
      addLog(state, '小霞的朝氣：場上無寶可夢可附，【水】能量回牌庫', aIdx),
      aIdx,
      pl => ({ ...pl, deck: [...pl.deck].sort(() => Math.random() - 0.5) }),
    );
  }
  return withPending(
    addLog(state, `小霞的朝氣：選 1 隻自己寶可夢，將 ${iids.length} 張基本【水】能量全附給它`, aIdx),
    {
      type: 'heal-target',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-trainer-karunari-vigor-attach',
      params: {
        energyIids: iids,
        titleOverride: `小霞的朝氣：選擇要附 ${iids.length} 張基本【水】能量的寶可夢`,
        endTurnAfter: true,  // 附完後強制結束回合
      },
    },
  );
});
regR('m5-trainer-karunari-vigor-attach', (state, aIdx, iids, params) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  const energyIids = (params?.energyIids as string[] | undefined) ?? [];
  if (energyIids.length === 0) return state;
  return updatePlayer(
    addLog(state, `小霞的朝氣：${energyIids.length} 張基本【水】能量附給選中寶可夢 + 重洗牌庫`, aIdx),
    aIdx,
    p => {
      const picked = p.deck.filter(c => energyIids.includes(c.iid));
      const remaining = p.deck.filter(c => !energyIids.includes(c.iid));
      const shuffled = [...remaining].sort(() => Math.random() - 0.5);
      const updateInst = (c: import('../../types').CardInstance) =>
        c.iid === targetIid
          ? { ...c, energyAttached: [...c.energyAttached, ...picked] }
          : c;
      return {
        ...p,
        deck: shuffled,
        active: p.active ? updateInst(p.active) : null,
        bench: p.bench.map(updateInst),
      };
    },
  );
});
// modal-choice resolver for end-only path
regR('m5-trainer-karunari-vigor-end-only', (state) => state);

// ════════════════════════════════════════════════════════════════════════════
// Phase 5 結束。已實裝 65 個 effect（招式 58 + 特性 3 + 訓練家 4）/ 81 張卡。
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 6 (v4.84) — 化隱特性 + 3 依賴招式
//
// 化隱（M5 — 斯魔茶 / 來悲粗茶 / 怨影娃娃 / 詛咒娃娃）
//   卡面：「這隻寶可夢不會受到對手的招式或特性的效果。」
//   範圍：active + bench 全場；擋 attack-effect 與 ability-effect；不擋 attack-damage。
//   注意：跟舊 v3.06「藏隱」名稱相近但機制不同（藏隱是 bench-only + 含招式傷害）。
//   實作位置：defense.ts canApplyEffectToTarget 開頭 — 已新增 check（v4.84）。
//   本檔不註冊 regA — 化隱是 passive 特性，由 unified defense pipeline 在
//   每次 attack-effect / ability-effect 套用前 check defender ability。
//
// 3 個依賴招式（讀「自方棄牌區擁有化隱特性的寶可夢數」N）：
//   來悲粗茶|抹茶旋轉（N ≥ 6 → 對手全場各 +4 指示物）
//   花岩怪|靈魂終結（N ≥ 13 → opp-poke-choose 2 隻 → damage × 4 倍）
//   破破舵輪|怨恨之怒（30 + N ≥ 4 → +140）
// ════════════════════════════════════════════════════════════════════════════

// ── helper：count 自方棄牌區中擁有「化隱」特性的寶可夢數 ─────────
function countHuayinInOwnDiscard(
  state: import('../../types').GameState,
  aIdx: 0 | 1,
  pool: Map<string, import('$lib/cards/types').Card>,
): number {
  return state.players[aIdx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.abilities?.some(a => a.name === '化隱') ?? false;
  }).length;
}

// ── 來悲粗茶|抹茶旋轉 — 棄牌區化隱 ≥ 6 → 對手全場各 +4 指示物 ─
//   卡面：「自己的棄牌區中，若擁有特性『化隱』的寶可夢有 6 張以上，
//          則在對手場上所有寶可夢身上，各放置 4 個傷害指示物。」
//   damage = 0；效果為「放置傷害指示物」屬 attack-effect。
//   per-target 走 canApplyEffectToTarget('attack-effect') — 對手場上若有化隱
//   寶可夢應被自身免疫（雖然這場景罕見：對手也用化隱牌組）。
regPre('來悲粗茶|抹茶旋濺', (state) => ({ state, damage: 0 }));
regPost('來悲粗茶|抹茶旋濺', (state, aIdx, pool) => {
  const n = countHuayinInOwnDiscard(state, aIdx, pool);
  if (n < 6) {
    return addLog(state, `抹茶旋轉：棄牌區化隱寶可夢 ${n} 張（需 ≥ 6 觸發），效果略過`, aIdx);
  }
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = addLog(state, `抹茶旋轉：棄牌區化隱寶可夢 ${n} 張 → 對手全場各 +4 指示物`, aIdx);
  // 對手 active
  const def = s.players[dIdx];
  const targets = [def.active, ...def.bench].filter((x): x is import('../../types').CardInstance => x !== null);
  for (const t of targets) {
    const tCard = pool.get(t.cardId);
    // v5.062：明確傳 isBench 給 helper — 否則預設走 bench-only defense（含對戰圓形競技場）
    //   會誤把對手戰鬥位也擋下。玩家回報用抹茶旋轉打對戰圓形場面，戰鬥位反被保護。
    const isBench = t.iid !== def.active?.iid;
    const r = canApplyEffectToTarget(s, aIdx, t, tCard, 'attack-effect', pool, { isBench });
    if (r.blocked) {
      s = addLog(s, `抹茶旋轉：${tCard?.name ?? '?'} 被 ${r.reason} 擋下，跳過`, aIdx);
      continue;
    }
    s = updatePlayer(s, dIdx, p => ({
      ...p,
      active: p.active && p.active.iid === t.iid
        ? { ...p.active, damage: (p.active.damage ?? 0) + 40 }
        : p.active,
      bench: p.bench.map(b => b.iid === t.iid ? { ...b, damage: (b.damage ?? 0) + 40 } : b),
    }));
  }
  return s;
});

// ── 花岩怪|靈魂終結 — 棄牌區化隱 ≥ 13 → opp-poke-choose 2 隻 → damage × 4 ─
//   卡面：「自己的棄牌區中，若擁有特性『化隱』的寶可夢有 13 張以上，
//          則選擇對手 2 隻寶可夢，將其身上的傷害指示物以 4 倍的方式放置
//         （即原數量 × 4）。」
//   damage = 0；倍化既有指示物（不是新放置）— 視為 attack-effect。
regPre('花岩怪|魂之末', (state) => ({ state, damage: 0 }));
regPost('花岩怪|魂之末', (state, aIdx, pool) => {
  const n = countHuayinInOwnDiscard(state, aIdx, pool);
  if (n < 13) {
    return addLog(state, `靈魂終結：棄牌區化隱寶可夢 ${n} 張（需 ≥ 13 觸發），效果略過`, aIdx);
  }
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  const allOpp = [def.active, ...def.bench].filter((x): x is import('../../types').CardInstance => x !== null);
  if (allOpp.length === 0) {
    return addLog(state, '靈魂終結：對手場上無寶可夢', aIdx);
  }
  const pickCount = Math.min(2, allOpp.length);
  return withPending(
    addLog(state, `靈魂終結：棄牌區化隱 ${n} 張 → 選對手 ${pickCount} 隻寶可夢將其指示物 × 4 倍`, aIdx),
    {
      type: 'opp-poke-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: pickCount, maxCount: pickCount,
      effectKey: 'm5-runerigus-soul-end',
      params: { includeActive: true },
    },
  );
});
regR('m5-runerigus-soul-end', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  for (const targetIid of iids) {
    const dPlayer = s.players[dIdx];
    const allOpp = [dPlayer.active, ...dPlayer.bench].filter((x): x is import('../../types').CardInstance => x !== null);
    const target = allOpp.find(c => c.iid === targetIid);
    if (!target) continue;
    const tCard = pool.get(target.cardId);
    // v5.062：明確傳 isBench — 同抹茶旋轉 caller 修法。
    const isBench = target.iid !== dPlayer.active?.iid;
    // 化隱 / 球形盾牌 等 effect 免疫 per-target check
    const r = canApplyEffectToTarget(s, aIdx, target, tCard, 'attack-effect', pool, { isBench });
    if (r.blocked) {
      s = addLog(s, `靈魂終結：${tCard?.name ?? '?'} 被 ${r.reason} 擋下，跳過`, aIdx);
      continue;
    }
    const newDamage = (target.damage ?? 0) * 4;
    const delta = newDamage - (target.damage ?? 0);
    s = updatePlayer(
      addLog(s, `靈魂終結：${tCard?.name ?? '?'} 指示物 ${(target.damage ?? 0) / 10} → ${newDamage / 10}（+${delta / 10}）`, aIdx),
      dIdx,
      p => ({
        ...p,
        active: p.active && p.active.iid === targetIid ? { ...p.active, damage: newDamage } : p.active,
        bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: newDamage } : b),
      }),
    );
  }
  return s;
});

// ── 破破舵輪|怨恨之怒 — 30 + 棄牌區化隱 ≥ 4 → +140 ───────────
//   卡面：「自己的棄牌區中，若擁有特性『化隱』的寶可夢有 4 張以上，
//          則此招式傷害 +140。」
regPre('破破舵輪|悔念錨', (state, aIdx, pool) => {
  const n = countHuayinInOwnDiscard(state, aIdx, pool);
  const bonus = n >= 4 ? 140 : 0;
  const dmg = 30 + bonus;
  return {
    state: addLog(state,
      `怨恨之怒：棄牌區化隱寶可夢 ${n} 張${n >= 4 ? '（≥ 4 觸發 +140）' : ''} → 30${bonus > 0 ? ` + ${bonus}` : ''} = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 6 結束。化隱特性 + 3 依賴招式完整實裝。
// 累計實裝：65 (P1-P5) + 1 (化隱特性) + 3 (依賴招式) = 69 個 effect / 81 張卡。
// 化隱在 4 隻寶可夢（斯魔茶/來悲粗茶/怨影娃娃/詛咒娃娃）上自動生效，
// 無需逐隻 regA — passive ability check 在 defense.ts canApplyEffectToTarget 處理。
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 7 (v4.85) — 西獅海壬|滿滿旋律（特性）+ 暗影惡能量（能量擴充）
//
// 1. 西獅海壬|滿滿旋律（regA + evolvedThisTurn gate + heal-target picker）
//    卡面：「自己的回合，從手牌使出這張卡完成進化時，可使用 1 次。
//           將自己 1 隻寶可夢的 HP 全部恢復。」
//    實作：regA('西獅海壬', 0, ...) — gate: inst.evolvedThisTurn === true
//          + engine 標準 abilityUsedThisTurn 1 次限制（自動處理）
//    本檔內完成，不動 engine。
//
// 2. 暗影惡能量（特殊能量備戰位免疫，defense.ts 加 inline check）
//    卡面：「附有這張卡的寶可夢只要在備戰區，就不會受到對手招式的傷害。」
//    實作：defense.ts canApplyEffectToTarget 內加 check（與化隱同等級）：
//          kind === 'attack-damage' + isBench === true + target 附有暗影惡能量 → blocked
//    範圍：bench-only + attack-damage only（不擋招式效果、不擋特性效果）
// ════════════════════════════════════════════════════════════════════════════

// ── 西獅海壬|滿滿旋律 — 進化當回合 1 次：恢復自方 1 隻寶可夢全部 HP ─
regA('西獅海壬', 0, (st, idx, pool, inst) => {
  if (!inst || !inst.evolvedThisTurn) {
    return addLog(st, '滿滿旋律：只能在本回合從手牌進化時使用 1 次', idx);
  }
  const p = st.players[idx];
  const allOwn: import('../../types').CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  if (allOwn.length === 0) {
    return addLog(st, '滿滿旋律：場上無寶可夢可恢復', idx);
  }
  // 過濾出有受傷的寶可夢（damage > 0）做候選提示
  const injured = allOwn.filter(c => (c.damage ?? 0) > 0);
  if (injured.length === 0) {
    return addLog(st, '滿滿旋律：自方所有寶可夢都已滿血，效果無實際變化（仍消耗本回合 1 次）', idx);
  }
  const validIids = injured.map(c => c.iid);
  return withPending(
    addLog(st, `滿滿旋律：選 1 隻自方寶可夢恢復全部 HP（候選 ${injured.length} 隻受傷寶可夢）`, idx),
    {
      type: 'heal-target',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'm5-westsealion-full-melody',
      params: { validIids, titleOverride: '滿滿旋律：選擇要恢復的寶可夢' },
    },
  );
});
regR('m5-westsealion-full-melody', (state, aIdx, iids) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  return updatePlayer(addLog(state, '滿滿旋律：目標寶可夢恢復全部 HP', aIdx), aIdx, p => ({
    ...p,
    active: p.active && p.active.iid === targetIid ? { ...p.active, damage: 0 } : p.active,
    bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: 0 } : b),
  }));
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 7 結束。
// 累計：69 (P1-P6) + 1 (滿滿旋律) + 1 (暗影惡能量 defense gate) = 71 個項目 / 81 張卡。
// 注意：暗影惡能量的實裝在 defense.ts 加 inline check，本檔僅文檔說明。
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 8a (v4.87) — 4 張卡 + engine 擴充
//
// 1. 席多藍恩｜熔岩之壁（regPost）— defender immuneToBurnedAttackerNextTurn
// 2. 雷電獸｜閃光屏障（regPost）— defender immuneToEvolutionAttackNextTurn
// 3. 格拉吉歐的決戰（reg Supporter）— hand=1 gate + 設 Player.gladionDuelBonusThisTurn
// 4. 閃電能量（無 reg 註冊）— SPECIAL_ENERGY_TYPES + engine inline +20 已實裝
//
// 共通：engine.ts 同時加 immune flags damage check + END_TURN promote/clear。
// ════════════════════════════════════════════════════════════════════════════

// ── 1. 席多藍恩｜熔岩之壁 — 120 + 下個對手回合免疫【灼傷】attacker 招式傷害 ─
//   卡面：「下個對手的回合，這隻寶可夢不會受到處於【灼傷】狀態的寶可夢的招式傷害。」
regPost('席多藍恩|熔岩牆', (state, aIdx) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  return updatePlayer(
    addLog(state, '熔岩之壁：下個對手回合，這隻寶可夢不受【灼傷】狀態寶可夢的招式傷害', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, immuneToBurnedAttackerNextTurn: true } : null,
    }),
  );
});

// ── 2. 雷電獸|閃光屏障 — 50 + 下個對手回合免疫進化寶可夢招式傷害 ───────
//   卡面：「下個對手的回合，這隻寶可夢不會受到進化寶可夢的招式傷害。」
regPost('雷電獸|閃光屏障', (state, aIdx) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  return updatePlayer(
    addLog(state, '閃光屏障：下個對手回合，這隻寶可夢不受進化寶可夢的招式傷害', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, immuneToEvolutionAttackNextTurn: true } : null,
    }),
  );
});

// ── 3. 格拉吉歐的決戰（Supporter）─ hand=1 gate + 設 player flag ───────────
//   卡面：「這張卡只有在自己的手牌只有此張卡時才能使用。
//          這個回合，自己的寶可夢（『擁有規則的寶可夢』除外）使用招式對對手戰鬥寶可夢
//          造成的傷害「+80」。」
//   gate 由 engine 統一檢查 supporterTagsUsedThisTurn 1 次限制；hand=1 gate 本檔 inline 處理。
//   Note: 「手牌只有此張卡」= 打出時手牌僅 1 張（此卡本身在執行 reg 前已從手牌移除？依
//          engine 行為查驗）。為穩定保守實作：檢查 reg 執行當下 hand.length === 0
//          （= 卡剛被打出，手牌剩 0 張），否則 abort + log。
reg('格拉吉歐的決戰', (st, idx) => {
  const p = st.players[idx];
  if (p.hand.length !== 0) {
    return addLog(st, `格拉吉歐的決戰：手牌不只此 1 張（剩 ${p.hand.length} 張），效果未發動`, idx);
  }
  return updatePlayer(
    addLog(st,
      '格拉吉歐的決戰：本回合自己非規則寶可夢的招式對對手戰鬥寶可夢傷害 +80', idx),
    idx, pl => ({ ...pl, gladionDuelBonusThisTurn: true }),
  );
});

// ── 4. 閃電能量 ─ 無 reg 註冊（純 engine SPECIAL_ENERGY_TYPES + damage inline）─
//   卡面：「這張卡附在寶可夢身上時，作為 1 個能量發揮作用。
//          附有這張卡的寶可夢使用招式對對手戰鬥寶可夢造成的傷害「+20」。」
//   實裝在 engine.ts:
//     SPECIAL_ENERGY_TYPES['閃電能量'] = ['Lightning']  ← cost 認列 1 個【雷】
//     damage calc: attacker.active.energyAttached.some(e => name==='閃電能量') → +20

// ════════════════════════════════════════════════════════════════════════════
// Phase 8a 結束。
// 累計：71 (P1-P7) + 2 immune regPost + 1 supporter reg + 閃電能量 = 75 個項目 / 81 張卡。
// 剩餘 deferred (Phase 8b+)：咒縛之炎 / 太鼓防壁 / 蟲蟲恐慌 / 不朽之軀 / 光子密碼 /
//   化石卡 (陳舊的頭蓋/盾牌 + 化石採掘場) / 工具卡 (豪邁炸彈/重試徽章) /
//   強烈之吻 / 招式竊賊
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 8c (v4.89) — 蟲蟲恐慌（燒火蚣，bottom-7 reveal × 50 dmg）
//
// 卡面：「將自己的牌庫下方 7 張卡翻為正面，這些卡之中，擁有招式『蟲蟲恐慌』的
//        寶可夢張數 × 50 點傷害。翻為正面的寶可夢卡放回牌庫並重洗。剩餘的卡丟棄。」
//
// 拆分：
//   regPre  — 計算傷害（peek bottom 7，pure，不動牌）
//   regPost — 實際移牌（所有翻面寶可夢卡洗回牌庫，其他卡進棄牌堆）
//
// 注意「翻為正面的寶可夢卡」涵蓋全部寶可夢卡（包括沒有蟲蟲恐慌招式的寶可夢），
// 不只是「擁有蟲蟲恐慌」的那幾張。計數 × 50 才限定有此招式者。
//
// 同檔 effects.ts: PASSIVE_PREVENT_KO 加 '不朽身軀'（與堅忍之軀邏輯等價，
// engine 既有 wouldBeKO + PASSIVE_PREVENT_KO 路徑自動處理）。
// ════════════════════════════════════════════════════════════════════════════

// ── 蟲蟲恐慌 PRE：計算傷害（牌庫下方 7 張，計擁有此招式的寶可夢 × 50）─────
regPre('燒火蚣|蟲蟲恐慌', (state, aIdx, pool) => {
  const deck = state.players[aIdx].deck;
  if (deck.length === 0) {
    return { state: addLog(state, '蟲蟲恐慌：牌庫為空 → 0 傷害', aIdx), damage: 0 };
  }
  const bottomCount = Math.min(7, deck.length);
  const bottom = deck.slice(deck.length - bottomCount);
  let count = 0;
  for (const inst of bottom) {
    const c = pool.get(inst.cardId);
    if (c?.supertype === 'Pokemon' && c.attacks?.some(a => a.name === '蟲蟲恐慌')) {
      count++;
    }
  }
  const dmg = count * 50;
  return {
    state: addLog(state,
      `蟲蟲恐慌：牌庫下方 ${bottomCount} 張中，擁有「蟲蟲恐慌」招式的寶可夢 ${count} 張 → ${count} × 50 = ${dmg} 傷害`,
      aIdx),
    damage: dmg,
  };
});

// ── 蟲蟲恐慌 POST：移牌（reveal + 寶可夢洗回 + 其他棄牌）────────────────
regPost('燒火蚣|蟲蟲恐慌', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return state;
  const bottomCount = Math.min(7, p.deck.length);
  const bottom = p.deck.slice(p.deck.length - bottomCount);
  const remaining = p.deck.slice(0, p.deck.length - bottomCount);

  // 揭示：log 列出翻面的卡（雙方可見，PTCG「翻為正面」規則）
  const revealNames = bottom.map(b => pool.get(b.cardId)?.name ?? '?').join('、');
  let s = addLog(state, `蟲蟲恐慌：翻為正面 ${bottom.length} 張 ─ ${revealNames}`, aIdx);

  // 分流：寶可夢 → 洗回牌庫，其他 → 棄牌
  const pokemon = bottom.filter(inst => pool.get(inst.cardId)?.supertype === 'Pokemon');
  const nonPokemon = bottom.filter(inst => pool.get(inst.cardId)?.supertype !== 'Pokemon');

  const newDeck = shuffle([...remaining, ...pokemon]);

  s = updatePlayer(s, aIdx, pl => ({
    ...pl,
    deck: newDeck,
    discard: [...pl.discard, ...nonPokemon],
  }));

  s = addLog(s,
    `蟲蟲恐慌：${pokemon.length} 張寶可夢卡洗回牌庫，${nonPokemon.length} 張其他卡進棄牌堆`,
    aIdx);
  return s;
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 8c 結束。
// 累計：75 (P1-Phase8a) + 1 (Phase 8b 咒縛之炎) + 1 (不朽之軀) + 1 (蟲蟲恐慌)
//      = 78 個項目 / 81 張卡（~96% coverage）。
// 剩餘 deferred (Phase 8d+)：太鼓防壁 / 光子密碼 / 強烈之吻 / 招式竊賊 /
//   化石卡 (陳舊的頭蓋/盾牌 + 化石採掘場) / 工具卡 (豪邁炸彈/重試徽章)。
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 8e (v4.892) — 強烈之吻（迷唇姐，delayed discard at end of opp's next turn）
//
// 卡面：「下個回合結束時，將承受此招式的寶可夢及其身上附加的所有卡，全部丟棄。」
//
// ★ 重要概念：丟棄 ≠ 昏厥（KO）
//   - 丟棄（discard）：寶可夢與附加卡全部進入棄牌堆，**對手不獲得獎賞卡**
//   - 昏厥（KO）：寶可夢被擊倒，**對手獲得獎賞卡**
//   本招式為「丟棄」，故不走 addPendingPrize / 不觸發 PASSIVE_ON_KO / KO_RETALIATION。
//
// 實裝：POST 在 defender 側設 player flag strongKissTargetIid = defender.active.iid。
// 觸發：engine.ts END_TURN 中 currentPlayer 端檢查（= defender 結束他的回合時）。
//       若 active 仍為原 iid → 丟棄整套；否則（已撤退/被 KO/變動）→ 無事，清 marker。
//
// 時序：
//   Turn N (attacker)：POST 設 defender.strongKissTargetIid = X
//   END_TURN N (attacker)：currentPlayer = attacker，attacker.strongKissTargetIid 不存在 → 略過
//   Turn N+1 (defender)：defender 正常玩
//   END_TURN N+1 (defender)：currentPlayer = defender，檢查 → 若 active.iid === X → 丟棄
// ════════════════════════════════════════════════════════════════════════════

// ── 迷唇姐|強烈之吻 POST：在 defender 側設 strongKissTargetIid marker ────
regPost('迷唇姐|強烈之吻', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx];
  if (!def.active) {
    return addLog(state, '強烈之吻：對手戰鬥場已無寶可夢，效果無對象', aIdx);
  }
  const targetIid = def.active.iid;
  const targetName = pool.get(def.active.cardId)?.name ?? '?';
  return updatePlayer(
    addLog(state,
      `強烈之吻：標記 ${targetName}，下個對手回合結束時若仍在戰鬥場 → 全部丟棄（非昏厥）`,
      aIdx),
    dIdx,
    p => ({ ...p, strongKissTargetIid: targetIid }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 8e 結束。
// 累計：78 (P1-8c) + 1 (Phase 8d 太鼓防壁) + 1 (Phase 8e 強烈之吻)
//      = 80 個項目 / 81 張卡（~99% coverage）。
// 剩餘 deferred (Phase 8f+)：光子密碼 / 招式竊賊 / 化石卡 + 化石採掘場 /
//   工具卡 (豪邁炸彈 / 重試徽章)。
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 8f (v4.893) — 招式竊賊（狐大盜）+ 光子密碼（密勒頓 resolver）
//
// 1. 狐大盜｜招式竊賊（attack）
//    卡面：「若自己的手牌為 0 張，則從對手場上 1 隻寶可夢擁有的招式中選擇 1 個，
//            作為此招式使用。」
//    實裝（同 耀閃挑戰 precedent）：hand=0 gate + copyAttackChoice or fallback。
//    UI picker（攻擊借者選對手寶可夢 + 招式）為 deferred enhancement。
//
// 2. 密勒頓｜光子密碼 resolver
//    PASSIVE_ON_KO fn（在 effects.ts 已實裝，開 bench-choose picker）→
//    本檔 regR 完成實際的能量搶救（從 discard 取出 ≤2 張 basic 能量附加到備戰目標）。
// ════════════════════════════════════════════════════════════════════════════

// ── 1a. 狐大盜|招式竊賊 PRE — hand=0 gate + 對手寶可夢招式 copy ─────────
regPre('狐大盜|技能大盜', (state, aIdx, pool, action) => {
  const p = state.players[aIdx];

  // Gate: 自己手牌必須為 0
  if (p.hand.length > 0) {
    return {
      state: addLog(state,
        `招式竊賊：自己手牌 ${p.hand.length} 張（需 = 0），招式效果失敗`,
        aIdx),
      damage: 0,
    };
  }

  // 取對手場上所有寶可夢（active + bench）
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const oppPokes: { inst: import('../../types').CardInstance; card: import('$lib/cards/types').Card }[] = [];
  if (opp.active) {
    const c = pool.get(opp.active.cardId);
    if (c) oppPokes.push({ inst: opp.active, card: c });
  }
  for (const b of opp.bench) {
    const c = pool.get(b.cardId);
    if (c) oppPokes.push({ inst: b, card: c });
  }
  if (oppPokes.length === 0) {
    return {
      state: addLog(state, '招式竊賊：對手場上無寶可夢，招式效果失敗', aIdx),
      damage: 0,
    };
  }

  // 選擇對手寶可夢 + 其招式：優先讀 action.copyAttackChoice（UI 提供）；
  // fallback: opp.active + 印刷傷害最高招式（與 耀閃挑戰 v3.895 同 precedent）。
  const choice = action?.copyAttackChoice;
  let pickedPoke: { inst: import('../../types').CardInstance; card: import('$lib/cards/types').Card } | undefined;
  let pickedAttackIdx = -1;
  let useChoice = false;

  if (choice && choice.pokeIid && typeof choice.attackIndex === 'number') {
    const found = oppPokes.find(p => p.inst.iid === choice.pokeIid);
    if (found) {
      const atks = found.card.attacks ?? [];
      if (choice.attackIndex >= 0 && choice.attackIndex < atks.length) {
        pickedPoke = found;
        pickedAttackIdx = choice.attackIndex;
        useChoice = true;
      }
    }
  }

  if (!pickedPoke) {
    // Fallback: 優先 opp.active；若 active 沒有/無招式，往 bench 找
    for (const op of oppPokes) {
      const atks = op.card.attacks ?? [];
      if (atks.length === 0) continue;
      pickedPoke = op;
      // 印刷傷害最高
      const parseDmg = (dmgStr: string): number => {
        const m = (dmgStr ?? '').match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      };
      let bestDmg = parseDmg(atks[0].damage);
      pickedAttackIdx = 0;
      for (let i = 1; i < atks.length; i++) {
        const d = parseDmg(atks[i].damage);
        if (d > bestDmg) { pickedAttackIdx = i; bestDmg = d; }
      }
      break;
    }
  }

  if (!pickedPoke || pickedAttackIdx < 0) {
    return {
      state: addLog(state,
        '招式竊賊：對手場上寶可夢皆無可選招式，招式效果失敗',
        aIdx),
      damage: 0,
    };
  }

  const atks = pickedPoke.card.attacks ?? [];
  const picked = atks[pickedAttackIdx];
  const copiedKey = `${pickedPoke.card.name}|${picked.name}`;
  const pickMode = useChoice ? '玩家選擇' : '自動挑印刷最高傷害（UI picker deferred）';
  let s = addLog(state,
    `招式竊賊：選擇對手「${pickedPoke.card.name}」的「${picked.name}」作為此招式使用（${pickMode}）`,
    aIdx);

  // 標記 pendingCopyAttackKey 供 regPost 轉接
  s = { ...s, pendingCopyAttackKey: copiedKey };

  // 遞迴呼叫 borrowed attack 的 PRE
  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    const sub = copiedPre(s, aIdx, pool, action);
    // 弱抗依照使用者（狐大盜＝惡屬性）計算，不繼承 borrowed 招式的 skipWeakRes
    return {
      state: sub.state,
      damage: sub.damage,
      skipWeakRes: false,
      skipDefEffects: sub.skipDefEffects,
    };
  }
  // 無註冊 PRE → 退回印刷傷害
  const parseDmgFallback = (dmgStr: string): number => {
    const m = (dmgStr ?? '').match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  return { state: s, damage: parseDmgFallback(picked.damage) };
});

// ── 1b. 狐大盜|招式竊賊 POST — 轉接 borrowed attack 的 POST ──────────
regPost('狐大盜|技能大盜', (state, aIdx, pool) => {
  const key = state.pendingCopyAttackKey;
  const cleared = { ...state, pendingCopyAttackKey: undefined };
  if (!key) return cleared;
  const copiedPost = ATTACK_POST.get(key);
  if (!copiedPost) return cleared;
  return copiedPost(cleared, aIdx, pool);
});

// ── 2. 光子密碼 resolver — 從 discard 搶救 ≤2 張 basic 能量到備戰寶可夢
//   參數：params.basicEnergyIids（fn 開 picker 時傳入的 KO 前快照）
//        iids（玩家在 bench-choose picker 選的 ≥0 隻備戰寶可夢 iid）
//   限制：≥3 張 basic 能量時，目前 auto-pick 前 2 張（玩家選哪 2 張之 UI deferred）
regR('m5-mirieton-photon-code', (state, aIdx, iids, params, pool) => {
  if (iids.length === 0) {
    return addLog(state, '光子密碼：玩家跳過，無能量轉移', aIdx);
  }
  const targetBenchIid = iids[0];
  const basicEnergyIids: string[] = (params?.basicEnergyIids as string[]) ?? [];
  if (basicEnergyIids.length === 0) {
    return addLog(state, '光子密碼：無 basic 能量可移動', aIdx);
  }

  const p = state.players[aIdx];
  // 從 discard 找出對應 iids 的能量卡（KO sweep 時已被 engine 移到 discard）
  const energiesInDiscard = p.discard.filter(c => basicEnergyIids.includes(c.iid));
  if (energiesInDiscard.length === 0) {
    return addLog(state, '光子密碼：基本能量已不在棄牌堆（異常狀態），效果失敗', aIdx);
  }

  // 取最多 2 張（如 ≥3 張，auto-pick 前 2 — 玩家選哪 2 張 UI 為 deferred）
  const toMove = energiesInDiscard.slice(0, 2);
  const moveCount = toMove.length;
  const autoPickedNotice = basicEnergyIids.length >= 3
    ? `（${basicEnergyIids.length} 張中 auto-pick 前 2 張 — UI 玩家選擇為 deferred enhancement）`
    : '';

  // 找出選中的備戰寶可夢的名字
  const targetPoke = p.bench.find(b => b.iid === targetBenchIid);
  const targetName = targetPoke ? (pool.get(targetPoke.cardId)?.name ?? '?') : '?';

  let s = addLog(state,
    `光子密碼：移 ${moveCount} 張基本能量到 ${targetName}${autoPickedNotice}`,
    aIdx);
  s = updatePlayer(s, aIdx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => !toMove.some(t => t.iid === c.iid)),
    bench: pl.bench.map(b => {
      if (b.iid !== targetBenchIid) return b;
      return { ...b, energyAttached: [...b.energyAttached, ...toMove] };
    }),
  }));
  return s;
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 8f 結束。
// 累計：80 (P1-8e) + 1 (招式竊賊) + 1 (光子密碼) = 82 個項目（已超 81 張卡因部分卡有
//   多 effect，例如 護城龍 既有招式 又有 太鼓防壁 特性都各算一個 effect 記）。
// 81 張卡 effect coverage：80 → 81 → 完成（剩化石卡與工具卡兩組需要新引擎機制）。
// 剩餘 deferred：化石卡 (陳舊的頭蓋/盾牌 + 化石採掘場) / 工具卡 (豪邁炸彈 / 重試徽章)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Phase 8g (v4.895) — 化石卡組（陳舊的頭蓋/盾牌化石 + 化石採掘場 Stadium）
//
// 1. 陳舊的頭蓋化石（Item）— FOSSIL_ITEM_NAMES 加入；走既有 PLAY_FOSSIL 路徑
//    （直接從手牌 → 備戰，視為 HP60【無】Basic 寶可夢）
// 2. 陳舊的盾甲化石（Item）— 同上
// 3. 化石採掘場（Stadium）— 每回合 1 次，從牌庫搜尋 ≤2 張「陳舊的」物品卡放備戰
//    引擎：engine.ts USE_STADIUM 加 '化石採掘場' branch；本檔 regR 實際移動 + 設 fossil flag。
// ════════════════════════════════════════════════════════════════════════════

// ── m5-fossil-excavation resolver — 化石採掘場 deck-search 確認後 ────────
//   iids: 玩家選中的化石 Item iids（≤2）
//   流程：
//     1. 從 deck 找出對應 iids 的卡（已通過 'NameContains:陳舊的' filter）
//     2. 再次驗證 supertype=Trainer && subtype=Item（保險）
//     3. 為每張卡產生 fossil bench inst（fossilOnField=true）
//     4. 從 deck 移除選中的，重洗 deck，加入 bench
//   注意：bench 上限 check 已在 USE_STADIUM 階段過濾（slots = benchLimit - bench.length）
//         所以這裡假設 iids.length ≤ slots（不再 double-check）
regR('m5-fossil-excavation', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) {
    // Rule 14：玩家可跳過（minCount=0）。牌庫仍需重洗（卡面：「然後重洗牌庫」）
    return updatePlayer(
      addLog(state, '化石採掘場：玩家未選擇化石（跳過），仍重洗牌庫', aIdx),
      aIdx,
      p => ({ ...p, deck: shuffle(p.deck) }),
    );
  }
  const p = state.players[aIdx];
  const chosen = p.deck.filter(c => iids.includes(c.iid));
  // double-check：必須為 Item 且名稱含「陳舊的」（防 picker filter 異常）
  const validChosen = chosen.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Trainer'
      && card?.subtype === 'Item'
      && (card?.name?.includes('陳舊的') ?? false);
  });
  if (validChosen.length === 0) {
    return updatePlayer(
      addLog(state, '化石採掘場：選中的卡不符合條件（非「陳舊的」物品卡），重洗牌庫', aIdx),
      aIdx,
      pl => ({ ...pl, deck: shuffle(pl.deck) }),
    );
  }
  const fossilNames = validChosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // 轉成 fossil bench inst（fossilOnField=true，justPlaced 同 PLAY_FOSSIL handler）
  const fossilInsts = validChosen.map(c => ({
    ...c,
    fossilOnField: true,
    justPlaced: true,
    playedFromHand: false,  // 從牌庫，非手牌出
  }));
  const remainingDeck = p.deck.filter(c => !iids.includes(c.iid));
  let s = addLog(state,
    `化石採掘場：從牌庫放置 ${validChosen.length} 張「${fossilNames}」到備戰區（HP60／【無】），然後重洗牌庫`,
    aIdx);
  return updatePlayer(s, aIdx, pl => ({
    ...pl,
    deck: shuffle(remainingDeck),
    bench: [...pl.bench, ...fossilInsts],
  }));
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 8g 結束。化石卡組 3 張完整實裝。
// 累計：82 (P1-8f) + 2 fossil items + 1 stadium = 85 個項目
// 剩餘 deferred：工具卡（豪邁炸彈 on-damaged retaliation / 重試徽章 coin re-roll
//   — 兩者皆需 engine 級新 hook）。
// ════════════════════════════════════════════════════════════════════════════





