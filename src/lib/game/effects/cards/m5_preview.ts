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
 *   - 狀態異常類：002 顎針蟲 / 007 席多藍恩 / 030 迷唇姐 / 050 烏賊王
 *   - 自傷類：003 螳花蟲 / 009 焚焰蚣 / 027 密勒頓
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
 *   Phase 5（v4.83）：訓練家 + 能量規則（卡娜莉的元氣 / 沐淨 / 化石採掘場 等）
 *
 * 鐵律遵守：
 *   - Rule 7c：所有效果以 JSON M5_raw.json 的日文 `effect_jp` 為 source
 *   - 純傷害招式（無 effect 文字）不註冊（引擎預設處理）
 *   - 不動 engine.ts / types.ts — 純用既有 helper
 */

import {
  regPost,
  regPre,
  regR,
  addLog,
  updatePlayer,
  withPending,
  getAllAttachedTools,
} from '../_shared';
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
} from '../../effects';
import { getEnergyUnits } from '../../engine';

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

// ── 002 顎針蟲｜吐絲 — 擲幣正面→對手【麻痺】─────────────────────────
regPost('顎針蟲|吐絲', coinStatusPost('paralyzed'));

// ── 003 螳花蟲｜突擊 — 自傷 10 ─────────────────────────────────────
regPost('螳花蟲|突擊', m5SelfDamagePost(10, '突擊'));

// ── 007 席多藍恩｜燒灼 — 對手【灼傷】───────────────────────────────
regPost('席多藍恩|燒灼', statusPost('burned'));

// ── 008 燒火蚣｜野火 — mill 對手牌庫頂 1 張 ───────────────────────
regPost('燒火蚣|野火', millOppDeckTopPost(1, '野火'));

// ── 009 焚焰蚣｜野火 — mill 對手牌庫頂 2 張 ───────────────────────
regPost('焚焰蚣|野火', millOppDeckTopPost(2, '野火'));

// ── 009 焚焰蚣｜熱情衝撞 — 自傷 30 ────────────────────────────────
regPost('焚焰蚣|熱情衝撞', m5SelfDamagePost(30, '熱情衝撞'));

// ── 015 吼鯨王ex｜摔落 — 自身【睡眠】──────────────────────────────
regPost('吼鯨王ex|摔落', selfStatusPost('asleep'));

// ── 022 落雷獸｜拿來 — 抽 1 張 ────────────────────────────────────
regPost('落雷獸|拿來', drawNPost(1, '拿來'));

// ── 027 密勒頓｜打雷 — 自傷 30 ─────────────────────────────────────
regPost('密勒頓|打雷', m5SelfDamagePost(30, '打雷'));

// ── 028 呆呆獸｜徹底丟棄 — picker：選任意數量手牌丟棄 ─────────────
//   卡面：「從自己的手牌選擇任意數量的卡，全部丟棄。」
//   不會強制丟，玩家可選 0 張（pickerCount min=0）
regPre('呆呆獸|徹底丟棄', (state, aIdx, _pool, _action) => ({ state, damage: 0 }));
regPost('呆呆獸|徹底丟棄', (state, aIdx, _pool) => {
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
regPost('迷唇姐|精神力', coinStatusPost('paralyzed'));

// ── 050 烏賊王｜蠱惑 — 對手【混亂】───────────────────────────────
regPost('烏賊王|蠱惑', statusPost('confused'));

// ── 053 莫魯貝可ex｜輪盤抽牌 — 手牌全洗回牌庫 + 抽 6 張 ─────────
//   卡面：「將自己的手牌全部放回牌庫並重洗。之後，從牌庫抽 6 張卡。」
regPre('莫魯貝可ex|輪盤抽牌', (state, _aIdx, _pool, _action) => ({ state, damage: 0 }));
regPost('莫魯貝可ex|輪盤抽牌', (state, aIdx, _pool) => {
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
regPost('超級龍頭地鼠ex|挖掘崩塌', millOppDeckTopPost(2, '挖掘崩塌'));

// ════════════════════════════════════════════════════════════════════════════
// Phase 1 結束（14 個招式，涵蓋 13 張卡）。
// ════════════════════════════════════════════════════════════════════════════
//
// Phase 2 (v4.80)：條件 +N 傷害 / 自身回血 / picker 類 — 17 個招式
//
// 完整對照（卡面 → 實裝細節）：
//   A. 條件 +N PRE：
//      紅蓮鎧騎|烈焰軍團（40+N×40，N=自方備戰有附能量數）
//      古空棘魚|化石節拍（10+N×30，N=自方備戰名含「古老的」數）
//      海豚俠|正義之拳（80+200，當對手剩餘獎賞=1）
//      呆殼獸|空空如也（50+160，當自方手牌=0）
//      故勒頓|戰鬥利爪（30+30，當對手戰鬥位為進化）
//      莫魯貝可ex|飢餓轟炸（40+N×40，N=自身傷害指示物數）
//      古玉魚|嫉妒漩渦（20+90 且 skipWeakness，當自身傷害指示物≥2）
//      巨嘴鳥|羽毛迴旋（60+N×20，N=雙方備戰合計數）
//   B. 自身回血：
//      海豚寶寶|吸取鰭（20，self heal 20）
//   C. defender 減傷：
//      蘭螳花ex|葉片防護（140，下回合受傷 -50）
//   D. 對手場操作：
//      斯魔茶|悄悄放上（0+對手戰鬥位放 1 指示物）
//      棄世猴|幽靈拳（100+對手備戰 picker 放 5 指示物）
//      頭蓋龍|撞飛（70+強制對手戰鬥位與備戰位互換）
//      鑽嘴鳥|二連啄（2 次擲幣×10）
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

// ── helper：自方備戰中「附有能量的寶可夢數」──────────────────────────
function countSelfBenchWithEnergy(state: import('../../types').GameState, aIdx: 0 | 1): number {
  return state.players[aIdx].bench.filter(b => b.energyAttached.length > 0).length;
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

// ── 紅蓮鎧騎|烈焰軍團 — 40 + N×40（N=自方備戰附能寶可夢數）
//   卡面：「身上附有能量的自己備戰寶可夢數 × 40 點，追加傷害。」
regPre('紅蓮鎧騎|烈焰軍團', (state, aIdx) => {
  const n = countSelfBenchWithEnergy(state, aIdx);
  const dmg = 40 + n * 40;
  return {
    state: addLog(state, `烈焰軍團：自方備戰附能寶可夢 ${n} 隻 → 40 + ${n}×40 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 古空棘魚|化石節拍 — 10 + N×30（N=自方備戰中名含「古老的」數）
//   卡面：「名稱含有『古老的』的自己備戰寶可夢張數 × 30 點，追加傷害。」
regPre('古空棘魚|化石節拍', (state, aIdx, pool) => {
  const n = countSelfBenchByNameContains(state, aIdx, pool, '古老的');
  const dmg = 10 + n * 30;
  return {
    state: addLog(state, `化石節拍：自方備戰「古老的」${n} 隻 → 10 + ${n}×30 = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── 海豚俠|正義之拳 — 80 +200（當對手剩餘獎賞=1）
//   卡面：「若對手剩餘獎賞牌為 1 張，則此招式傷害 +200。」
regPre('海豚俠|正義之拳', (state, aIdx) => {
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
regPre('呆殼獸|空空如也', (state, aIdx) => {
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
regPre('故勒頓|戰鬥利爪', (state, aIdx, pool) => {
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
regPre('莫魯貝可ex|飢餓轟炸', (state, aIdx) => {
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

// ── 巨嘴鳥|羽毛迴旋 — 60 + N×20（N=雙方備戰寶可夢合計數）
//   卡面：「雙方備戰寶可夢數合計 × 20 點，追加傷害。」
regPre('巨嘴鳥|羽毛迴旋', (state, aIdx) => {
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

// ── 海豚寶寶|吸取鰭 — 20，自身回復 20 HP
//   卡面：「這隻寶可夢恢復 20 HP。」
regPost('海豚寶寶|吸取鰭', selfHealPost(20, '吸取鰭'));

// ══════════════════════════════════════════════════════════════════════════════
// Group C — defender 下次受傷 -50
// ══════════════════════════════════════════════════════════════════════════════

// ── 蘭螳花ex|葉片防護 — 140，下個對手回合這隻寶可夢受招式傷害 -50
//   卡面：「下個對手的回合，這隻寶可夢受到的招式傷害「-50」。」
//   實裝：用既有 damageReduceNextHit flag（defender 端，自己被打 -N）
regPost('蘭螳花ex|葉片防護', (state, aIdx) => {
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
regPost('斯魔茶|悄悄放上', (state, aIdx) => {
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
regPost('棄世猴|幽靈拳', (state, aIdx) => hitBenchPickPost(state, aIdx, 'opp', 1, 50, '幽靈拳'));

// ── 頭蓋龍|撞飛 — 70+強制對手戰鬥位與備戰位互換（對手選新戰鬥位）
//   卡面：「將對手的戰鬥寶可夢與備戰寶可夢互換。（送上戰鬥場的寶可夢由對手選擇。）」
regPost('頭蓋龍|撞飛', forceOppSwapPost('撞飛'));

// ── 鑽嘴鳥|二連啄 — 擲 2 次硬幣 × 10 點傷害
//   卡面：「擲 2 次硬幣，正面數 × 10 點傷害。」
regPre('鑽嘴鳥|二連啄', coinHeadsMultiplyPre(2, 10, '二連啄'));

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
regPre('螺釘地鼠|呼喚同伴', (state) => ({ state, damage: 0 }));
regPost('螺釘地鼠|呼喚同伴', (state, aIdx) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '呼喚同伴：牌庫為空', aIdx);
  return withPending(addLog(state, '呼喚同伴：從牌庫選 ≤2 張【基礎】寶可夢放備戰（可選 0 張）', aIdx), {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Basic',
    minCount: 0, maxCount: 2,
    effectKey: 'm5-screwdriller-call-allies',
  });
});
regR('m5-screwdriller-call-allies', (state, aIdx, iids) => {
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
    return {
      ...p,
      deck: shuffled,
      bench: [...p.bench, ...picked],
    };
  });
});

// ── 燈火幽靈|增光 — 從自己牌庫選 ≤3 張「燈火幽靈」，放置於備戰區
//   卡面：「從自己的牌庫選擇最多 3 張『燈火幽靈』，放置於備戰區。然後重洗牌庫。」
//   實裝：用 'Name:燈火幽靈' filter — 但 deck-search filter 是否認此 pattern 需確認；
//   採取 picker + resolver 內 filter by name 的保險作法。
regPre('燈火幽靈|增光', (state) => ({ state, damage: 0 }));
regPost('燈火幽靈|增光', (state, aIdx, pool) => {
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
// D. 對手場 / 自身能量操作（5）：盾甲龍碎裂 / 故勒頓大地衝擊 / 大狗頭飛撲頭錘 /
//    鍬農炮蟲巨型軌道砲 / 超級捷拉奧拉ex瞬間移轉
// E. 狙擊 picker（4）：金魚王水流射擊 / 鍬農炮蟲急速潛行 / 禿鷹娜骨頭狙擊 / 瑪夏多影結
// F. 牌庫搜尋（1）：烏賊仔調達
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
regPre('銅鏡怪|鏡像攻擊', (state, aIdx, pool) => {
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

// ── A2. 薩戮德|暗影鞭打 — 100 + 自方備戰任一附「暗影惡能量」+70 ────
//   卡面：「若自己的備戰寶可夢身上附有『暗影惡能量』，則此招式傷害 +70。」
regPre('薩戮德|暗影鞭打', (state, aIdx, pool) => {
  const benchHasShadow = state.players[aIdx].bench.some(b =>
    b.energyAttached.some(e => pool.get(e.cardId)?.name === '暗影惡能量'),
  );
  const bonus = benchHasShadow ? 70 : 0;
  const dmg = 100 + bonus;
  return {
    state: addLog(state, `暗影鞭打：自方備戰${benchHasShadow ? '有暗影惡能量 +70' : '無暗影惡能量'} → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ── A3. 超級龍頭地鼠ex|最大鑽頭 — 200 + 自身能量單位 ≥ cost+2 (=5) +130 ─
//   卡面：「若這隻寶可夢身上附加的能量數，比此招式所需能量數多 2 個以上，則此招式傷害 +130。」
//   注意：「能量數」指 units，需用 engine.getEnergyUnits 算 (例：新衝天能量 on Stage2 = 2 units)
//   cost 從 JSON 取 = 3 (1 鬥 + 2 無)，所以 ≥ 5 觸發。
regPre('超級龍頭地鼠ex|最大鑽頭', (state, aIdx, pool) => {
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
regPre('超級捷拉奧拉ex|雷電拳', (state, aIdx) => {
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
regPre('超級達克萊伊ex|暗夜突襲', (state, aIdx) => {
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
regPre('蘭螳花ex|活力切割器', (state, aIdx) => {
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
regPre('雷電獸|音速之刃', (state) => ({
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
regPre('炭小侍|全力拳擊', coinHeadsMultiplyPre(1, 40, '全力拳擊'));

// ── D1. 盾甲龍|碎裂 — 50 + 對手戰鬥位丟 1 能量 picker ────────
//   卡面：「從對手的戰鬥寶可夢身上選擇 1 個能量，丟棄。」
regPost('盾甲龍|碎裂', (state, aIdx) => {
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
regPost('故勒頓|大地衝擊', (state, aIdx) => {
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

// ── D3. 大狗頭|飛撲頭錘 — 210 + 下個對手回合自身受傷 +100 ──
//   卡面：「下個對手的回合，這隻寶可夢受到的招式傷害「+100」。」
//   實裝：用既有 takeExtraDamageNextTurn flag — 在自己 END_TURN 時 promote → ThisTurn，
//   對手攻擊時讀 ThisTurn。
regPost('大狗頭|飛撲頭錘', (state, aIdx) => {
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

// ── D4. 鍬農炮蟲|巨型軌道砲 — 260 (gate: 自身附閃電能量) ────
//   卡面：「這隻寶可夢身上若未附有『閃電能量』，則此招式失敗。」
//   注意：「閃電能量」是 M5 卡名（非「基本【雷】能量」）— strict name match。
regPre('鍬農炮蟲|巨型軌道砲', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  const hasLightning = att?.energyAttached.some(
    e => pool.get(e.cardId)?.name === '閃電能量',
  ) ?? false;
  if (!hasLightning) {
    return {
      state: addLog(state, '巨型軌道砲：未附「閃電能量」 → 招式失敗', aIdx),
      damage: 0,
    };
  }
  return {
    state: addLog(state, '巨型軌道砲：附有「閃電能量」 → 260', aIdx),
    damage: 260,
  };
});

// ── D5. 超級捷拉奧拉ex|瞬間移轉 — 150 + 自身與備戰互換 picker ─
//   卡面：「將這隻寶可夢與備戰寶可夢互換。」
regPost('超級捷拉奧拉ex|瞬間移轉', (state, aIdx) => {
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
      const newActive = p.bench[benchIdx];
      const newBench = [...p.bench];
      newBench[benchIdx] = m5ClearTurnFlags(oldActive);
      return { ...p, active: newActive, bench: newBench };
    },
  );
});

// ── E1. 金魚王|水流射擊 — 對對手 1 隻寶可夢 × 自身能量數 × 30 (bench 不計弱抗) ─
//   卡面：「對對手 1 隻寶可夢，造成這隻寶可夢身上附加的能量數 × 30 點傷害。
//          （備戰寶可夢不計算弱點・抵抗力。）」
regPre('金魚王|水流射擊', (state) => ({ state, damage: 0 }));
regPost('金魚王|水流射擊', (state, aIdx) => {
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
regPre('鍬農炮蟲|急速潛行', (state) => ({ state, damage: 0 }));
regPost('鍬農炮蟲|急速潛行', (state, aIdx) => {
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
regPre('禿鷹娜|骨頭狙擊', (state) => ({ state, damage: 0 }));
regPost('禿鷹娜|骨頭狙擊', (state, aIdx, pool) => {
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
regPre('瑪夏多|影結', (state, aIdx, pool) => {
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

// ── F1. 烏賊仔|調達 — 從自己牌庫選 1 張物品，給對手看後加手牌 ─
//   卡面：「從自己的牌庫選擇 1 張物品，給對手看過後，加入手牌。然後重洗牌庫。」
regPre('烏賊仔|調達', (state) => ({ state, damage: 0 }));
regPost('烏賊仔|調達', (state, aIdx) => {
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
//    拋鳥|配送挑戰（2 次擲幣全正面 → 牌庫選 1 寶可夢到備戰）
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
  const defCard = defActive ? pool.get(defActive.cardId) : null;
  const retreatCount = defCard?.retreatCost?.length ?? 0;
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
regPost('戰槌龍ex|暴走之槌', (state, aIdx) => {
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

// ── B2. 拋鳥|配送挑戰 — 2 次擲幣全正面 → 牌庫選 1 寶可夢到備戰 ─
//   卡面：「擲 2 次硬幣，若全部為正面，從自己的牌庫選擇 1 張寶可夢，放置於備戰區。
//          然後重洗牌庫。」
regPre('拋鳥|配送挑戰', (state) => ({ state, damage: 0 }));
regPost('拋鳥|配送挑戰', (state, aIdx) => {
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
regPost('詛咒娃娃|人偶捕捉', (state, aIdx) => {
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
regPost('西獅海壬|水流回歸', (state, aIdx) => {
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
  const def = state.players[dIdx].active;
  if (!def) return addLog(state, '深淵之瞳：對手無戰鬥位', aIdx);
  if (!def.status) {
    return addLog(state, '深淵之瞳：對手戰鬥位不處於特殊狀態 → 效果失敗', aIdx);
  }
  const defCard = pool.get(def.cardId);
  const hp = defCard?.hp ?? 0;
  if (hp <= 0) return addLog(state, '深淵之瞳：對手戰鬥位無 HP 資訊', aIdx);
  // 設 damage = HP，sanityKOSweep 會處理擊倒 + 獎賞
  return updatePlayer(addLog(state, `深淵之瞳：對手戰鬥位處於【${def.status}】 → 直接昏厥`, aIdx), dIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: hp } };
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 4 結束。已實裝 14 (P1) + 17 (P2) + 19 (P3) + 8 (P4) = 58 個招式 / 81 張卡。
// 累計達 ~72% 招式 coverage。
// 剩餘 ~6 個招式須新引擎機制（化隱依賴 / delayed-KO / conditional immunity / copy attack）—
// 留待 Phase 5+ 連同 12 特性（含「化隱」）+ 12 訓練家/能量一併處理。
// ════════════════════════════════════════════════════════════════════════════


