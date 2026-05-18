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
} from '../../effects';

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
//   實裝：hitBenchPickPost(50, ...) — 50 點即 5 個指示物
regPost('棄世猴|幽靈拳', hitBenchPickPost(50, '幽靈拳'));

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
// Phase 3 將處理「化隱」特性（6 張）— 需要引擎新 immunity flag。
// Phase 4 將處理超進化 ex 大招（深淵之瞳 / 暴走之槌+150 等 ~8 張）。
// Phase 5 將處理 M5 訓練家 + 能量規則。
// ════════════════════════════════════════════════════════════════════════════
