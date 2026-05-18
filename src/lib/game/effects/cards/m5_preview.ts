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
import type { AttackPostFn } from '../_shared';
import {
  statusPost,
  coinStatusPost,
  selfStatusPost,
  millOppDeckTopPost,
  drawNPost,
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
// Phase 1 結束。已實裝 14 個招式（涵蓋 13 張不同卡片）。
// 下一波 Phase 2 將處理條件 +N、自身回血、picker 類等較複雜的 ~25 張卡。
// ════════════════════════════════════════════════════════════════════════════
