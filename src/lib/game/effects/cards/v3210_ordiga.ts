/**
 * v3.21 — 奧爾迪加（SV8a 189/187, G）+ 化石卡完整補漏
 *
 * 本檔同時涵蓋兩部分：
 *
 * Part A：奧爾迪加（Supporter, G）
 *   卡面：「查看對手的手牌，從其中任意選擇 1 張卡，放回對手的牌庫下方。
 *           然後，對手若希望，從牌庫抽出 1 張卡。」
 *
 *   流程設計（複用既有 pendingSelection / RESOLVER 機制，無需新引擎機制）：
 *
 *     1. supporter 點擊 → reg('奧爾迪加')：開 hand-choose pendingSelection
 *        - actorIdx       = 自己（=出牌者）
 *        - sourcePlayerIdx = 對手（=展示其手牌）
 *        - filter         = undefined（任意 1 張）
 *        - minCount/maxCount = 1
 *        - effectKey      = 'ordiga-pick-one'
 *        UI：自己看到對手手牌全部明牌（hand-choose picker 既有支援
 *             sourcePlayerIdx !== actorIdx）
 *
 *     2. resolver 'ordiga-pick-one'（自己選完那張卡後執行）：
 *        - 把選中的卡從對手手牌移除 → push 到對手 deck 末尾（=「牌庫下方」）
 *        - addLog 公開揭示卡名（卡面語意：自己看過該牌名，對手也明確知道哪張被放回）
 *        - 若對手 deck 為空 → 對手沒法抽卡，直接結束（不開 modal-choice）
 *        - 否則開 modal-choice pendingSelection：
 *            actorIdx       = 對手（=被詢問方）
 *            sourcePlayerIdx = 對手
 *            options        = [yes, no]
 *            effectKey      = 'ordiga-opp-draw-yes-no'
 *          UI：對手會看到 yes/no 模態（既有 UI gate 已透過 actorIdx 自動切換）
 *
 *     3. resolver 'ordiga-opp-draw-yes-no'（對手選完 yes/no 後執行）：
 *        - 'yes' → 對手從牌庫抽 1 張（drawCardsForPlayer 對 oppIdx）
 *        - 'no'  → 加 log「對手選擇不抽」結束
 *
 *   ⚠ 對手互動 yes/no 機制：
 *     - 不需要新 pendingSelection type；直接重用 modal-choice，把 actorIdx 設為對手即可
 *     - UI 既有的 `pendingSelection.actorIdx === myPlayerIndex` gate 會讓對手端自動顯示模態
 *     - 連線對戰時 actorIdx 切換是天然的（actor 收到 picker，非 actor 看到「等待中」字樣）
 *     - 單機對戰時 AI fallback 在 ai.ts 的 modal-choice case 已處理（隨機/預設選項）
 *
 * Part B：化石卡 audit 補漏（v2.187 ~ v3.20 累積發現的 3 個缺漏）
 *
 *   1. 陳舊的羽毛化石（I）—「在備戰區時不會受到對手寶可夢招式的『傷害』與『效果』」
 *      既有：effects.ts L283 resolveBenchGuard 只擋 'attack-damage'
 *      補漏：應該同時擋 'attack-effect'（卡面明寫「效果」）
 *      → 透過 Python pipeline 修 effects.ts 的 resolveBenchGuard 直接補
 *        本檔不重複 helper，避免雙來源。
 *
 *   2. 陳舊的背蓋化石（H）—「不會受到對手寶可夢招式的『效果』影響」
 *      既有：engine.ts ATTACK_POST short-circuit（純 POST 階段附加效果）
 *      漏洞：canApplyAttackEffectToTarget(...) 路徑（直接放指示物 / 自爆 / 多目標）
 *            未檢查背蓋化石 → 走此 helper 的招式效果仍會命中背蓋
 *      補漏：在 effects.ts canApplyAttackEffectToTarget() 開頭加
 *            fossilOnField + 背蓋化石 short-circuit
 *      → 透過 Python pipeline 修 effects.ts 直接補。
 *
 *   3. 陳舊的鰭之化石（J）—「不會受到對手支援者卡的影響」
 *      既有：supporters_gust.ts 兩處（老大的指令）內聯 fossilOnField + 鰭之化石 filter
 *            v3.08 isImmuneToOppSupporter 已實裝（含緊張感 / 融合為雪 / 廣域堡壘）
 *      漏洞：鰭之化石「沒有」整合進 isImmuneToOppSupporter — 即只有 supporters_gust.ts
 *            兩處生效；其他走 isImmuneToOppSupporter 的 supporter resolver 對鰭之化石
 *            無防禦
 *      補漏：把鰭之化石檢查整合進 v3080_deferred_wave_c.ts 的 isImmuneToOppSupporter
 *      → 透過 Python pipeline 修 v3080_deferred_wave_c.ts 直接補（fossilOnField 檢查
 *        即可，無需 ability，所以是新獨立分支）。
 *
 * 設計：
 *   - Iron Rule 11：本檔為**全新檔案**，使用 Write 工具 OK
 *   - Iron Rule 12：本檔對 _shared.ts 的 RESOLVERS 只透過 regR helper 註冊；
 *     對 effects.ts 的 TRAINER_EFFECTS 只透過 reg helper 註冊；
 *     兩個 helper 內部 Map 都在 _shared.ts，是純 leaf module，無 TDZ 風險。
 *
 * 範例 trace（玩家 A 出奧爾迪加）：
 *   - A 出奧爾迪加 → reg fn 呼叫 → withPending(hand-choose, actorIdx=A, sourcePlayerIdx=B)
 *   - A UI 顯示對手 B 的手牌候選 → A 選 1 張 → confirmSelection
 *   - engine RESOLVE_SELECTION → regR('ordiga-pick-one') 執行
 *     → 把該卡從 B.hand → B.deck 末尾；addLog
 *     → withPending(modal-choice, actorIdx=B, options=[yes, no])
 *   - A UI 顯示「等待對手 B 做選擇…」；B UI 顯示 yes/no 模態
 *   - B 點 yes → engine RESOLVE_SELECTION → regR('ordiga-opp-draw-yes-no')
 *     → drawCardsForPlayer(B, 1) → 結束
 *   - 或 B 點 no → log「對手選擇不抽」結束
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  reg, regR,
  addLog, addPrivateLog, updatePlayer, withPending,
  drawCards,
} from '../_shared';

// 導出 sentinel 防止 unused import warnings
export type _v3210Sentinel = PlayerState | GameState | Card | CardInstance;

// ════════════════════════════════════════════════════════════════════════════
// 奧爾迪加（Supporter, G）
// ════════════════════════════════════════════════════════════════════════════

reg('奧爾迪加', (state, idx, _pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = state.players[oppIdx];
  // 邊界：對手手牌為空 → 直接結束（不開 picker；卡面語意「從中選擇」需有牌可選）
  if (opp.hand.length === 0) {
    return addLog(state, '奧爾迪加：對手手牌為空，無法選擇卡 → 效果結束', idx);
  }
  const s = addLog(state, '奧爾迪加：查看對手的手牌，從中選擇 1 張放回對手牌庫下方', idx);
  return withPending(s, {
    type: 'hand-choose',
    actorIdx: idx,                  // 出牌者（自己）來選
    sourcePlayerIdx: oppIdx,         // 從對手手牌中選
    minCount: 1, maxCount: 1,
    effectKey: 'ordiga-pick-one',
    // 不限 filter（任意 1 張）— 卡面「從其中任意選擇 1 張」
  });
});

/**
 * Step 1 resolver：自己選完對手手牌中的 1 張卡後執行。
 *
 * 動作：
 *   1) 把選中的卡從 opp.hand 移除 → push 到 opp.deck 末尾（=「牌庫下方」）
 *   2) addLog 公開該卡名（揭示資訊：卡面文字「查看對手的手牌」，雙方都明知該卡）
 *   3) 開 modal-choice 給對手選 yes/no 是否抽 1 張
 */
regR('ordiga-pick-one', (state, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const opp = state.players[oppIdx];
  const pickedIid = iids[0];
  const pickedInst = opp.hand.find(c => c.iid === pickedIid);
  if (!pickedInst) {
    // 防呆：對手手牌中找不到該 iid（並發或競態？）
    return addLog(state, '奧爾迪加：選擇的卡片未找到，效果中止', idx);
  }
  const pickedCard = pool.get(pickedInst.cardId);
  const pickedName = pickedCard?.name ?? '?';

  // 1) 把該卡從 hand 移除，push 到 deck 末尾（=「牌庫下方」）
  let s = updatePlayer(state, oppIdx, (p) => ({
    ...p,
    hand: p.hand.filter(c => c.iid !== pickedIid),
    deck: [...p.deck, pickedInst],
  }));

  // 2) 揭示：奧爾迪加是「查看對手手牌」效果，雙方都知道哪張被放回 → 用 addLog
  s = addLog(s, `奧爾迪加：將對手的「${pickedName}」放回對手的牌庫下方`, idx);

  // 3) 對手 deck 為空（理論上罕見：剛抽完）→ 不開 yes/no
  const opp2 = s.players[oppIdx];
  if (opp2.deck.length === 0) {
    return addLog(s, '奧爾迪加：對手牌庫為空，無法抽卡 → 效果結束', idx);
  }

  // 4) 開 modal-choice 給「對手」選 yes/no 抽 1 張
  s = addLog(s, '奧爾迪加：等待對手決定是否抽 1 張卡…', idx);
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: oppIdx,                // 對手是當前需做選擇的玩家
    sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'ordiga-opp-draw-yes-no',
    params: {
      label: '奧爾迪加（對手選擇）',
      options: [
        { id: 'yes', text: '①從牌庫抽出 1 張卡' },
        { id: 'no',  text: '②不抽' },
      ],
    },
  });
});

/**
 * Step 2 resolver：對手選完 yes/no 後執行。
 *
 * 注意：此 resolver 的 `idx` 參數 = 出牌的 actor（=對手 oppIdx 自己）；
 *   因為 RESOLVE_SELECTION 統一以 pendingSelection.actorIdx 派發 idx 給 resolver。
 *   所以這裡 idx 已經是「對手」(=opp 視角為 self)；對應抽卡時直接用 idx 即可。
 */
regR('ordiga-opp-draw-yes-no', (state, idx, iids, _params, _pool) => {
  // idx 此時為「對手」(因 actorIdx=oppIdx)；卡面要對手抽
  const choice = iids[0];
  if (choice === 'yes') {
    // 對手抽 1 張（drawCards 已在 _shared.ts；牌庫空時自然 no-op）
    let s = addLog(state, '奧爾迪加：對手選擇從牌庫抽出 1 張卡', idx);
    s = drawCards(s, idx, 1);
    // 抽到的具體卡是私密 — 卡面只說「抽 1 張」，對手抽到什麼是隱私
    void addPrivateLog;
    return s;
  }
  // 對手選 no
  return addLog(state, '奧爾迪加：對手選擇不抽卡 → 效果結束', idx);
});

// ════════════════════════════════════════════════════════════════════════════
// Part B 化石補漏：本檔不直接寫補丁（避免雙來源混亂）
//
// 化石補漏實際透過 Python pipeline 改既有檔（effects.ts / v3080_deferred_wave_c.ts）：
//
//   1. 羽毛化石 effects.ts L289（resolveBenchGuard）
//      原：if (kind === 'attack-damage') { ... 羽毛化石 block }
//      改：把羽毛化石 block 移到 (kind === 'attack-damage' || kind === 'attack-effect')
//
//   2. 背蓋化石 effects.ts canApplyAttackEffectToTarget（L1728+）
//      開頭加 short-circuit：
//        if (target.fossilOnField && pool.get(target.cardId)?.name === '陳舊的背蓋化石')
//          return { blocked: true, reason: '陳舊的背蓋化石 免疫招式效果' };
//
//   3. 鰭之化石 v3080_deferred_wave_c.ts isImmuneToOppSupporter（L145+）
//      開頭加 short-circuit：
//        if (targetInst?.fossilOnField && pool.get(targetInst.cardId)?.name === '陳舊的鰭之化石')
//          return true;
//
//      連帶清掉 supporters_gust.ts 兩處重複的 fossilOnField + 鰭之化石 filter
//      （已被 isImmuneToOppSupporter 吸收）— 但因不影響行為，保留亦可（防禦性
//      重複），改 v3.21 不動 supporters_gust.ts 以縮小 diff 面。
// ════════════════════════════════════════════════════════════════════════════

// register 函式：本檔的 reg / regR 都用 helper 註冊（_shared.ts Map），
// 在 module top-level 呼叫無 TDZ 風險（Rule 12 例外）。
// 本檔對 effects.ts 的 Map 沒有 .set() 呼叫，故 register 函式 body 為空，
// 僅維持 wave 模板一致以便 effects.ts 末端統一 import + 呼叫。

let _v3210Registered = false;

export function registerV3210Ordiga(): void {
  if (_v3210Registered) return; // idempotent
  _v3210Registered = true;
  // reg / regR 已在 module top-level 完成註冊（_shared.ts 屬於 leaf module，
  // 無循環依賴 / TDZ 風險）。本函式僅作為 effects.ts 末端 import 入口的 sentinel。
}
