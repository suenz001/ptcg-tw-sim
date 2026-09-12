/**
 * v6.345 M6a「30th CELEBRATION」招式實裝 —— 批次 5（18 招｜牌庫／手牌／棄牌區操作）
 *
 * ⚠⚠ 卡面文字逐字取自 `static/cards/M6a.json`（台灣官方中文，`attacks[].effect`），未經簡化。
 *
 * ⭐ 本批只有 暴飛龍ex｜龍之波動 卡面有傷害（240），而它**不需要改寫傷害**
 *   ⇒ 全 18 招一律只登記 `regPost`，傷害讓引擎讀卡面
 *   （v6.333 皮卡丘ex｜打雷 硬寫 220、M6a 印刷卻是 200 的前科；`scripts/test-fixed-damage-base.mjs` 在守）。
 *   18 個鍵已跑過同名印刷碰撞檢查（`__m6a/collide_w5.mjs` + `wave5-keys.json`）：全數 `OK`
 *   （全卡庫同名同招的傷害與效果文字都只有一種），沒有「同名不同印刷」的風險。
 *
 * ⭐⭐⭐ 本批最容易做錯的地方：**「可否選 0」要逐張看卡面措辭，不可以一律 0**
 *   ① 牌庫搜尋 **帶條件**（支援者卡／寶可夢卡／能量卡／競技場卡）
 *      ⇒ 官方允許 fail-to-find「找不到」⇒ `minCount = 0`（v6.104 裁定，中央 `deckSearchToHandPost`）。
 *      ⚠ 「選擇 **1 張**」與「選擇**最多** 2 張」差在 maxCount，**minCount 都是 0**。
 *   ② 牌庫搜尋 **無類別限定**（「任意選擇1張卡」＝索財靈｜走個夠）
 *      ⇒ v6.126 官方裁定**不可以 1 張都不選** ⇒ `minCount = 1`（中央 `deckSearchAnyToHandPost`）。
 *   ③ 「選擇**任意數量**」（皮卡丘ex｜皮卡皮卡大遊行）⇒ 可以選 0，上限＝備戰空位。
 *   ⚠ 牌庫搜尋不論選幾張（含 0 張）**都要重洗牌庫** —— 玩家已經看過整副牌庫。
 *     `search-to-hand-reshuffle` / `recruit-to-bench` 兩支 resolver 內部都已經處理。
 *
 * ⭐⭐ 「在給對手看過後加入手牌」＝**公開揭示**，卡名要進對戰紀錄。
 *   `search-to-hand-reshuffle`（公開分支）／`discard-to-hand` 兩支 resolver 都會 addLog 卡名。
 *   ⚠ 反面：索財靈｜走個夠 卡面**沒有**「在給對手看過後」⇒ `params.privateReveal = true`
 *     （對手只看到張數），與 仙后／桃歹郎｜最後鎖鏈 同一條判準。
 *
 * ⚠⚠ Check T（資訊洩漏）：「查看對手的手牌」在 picker **之前**不可以用公開 log 印出內容。
 *   ・皮卡丘｜窺視 走中央 `peekOppHandPost`（公開 log 只有張數，整副手牌由 UI 揭露區塊顯示）。
 *   ・伊布｜叼去藏 走中央 `peekOppPickToDeckBottomPost`（addPrivateLog：actor 私訊看卡名、公開只有張數）。
 *   `scripts/test-peek-view-leak-inline.mjs` 在守這條（v5.877 突刺目光／舌引 事故）。
 *
 * ⭐ Rule 38：本檔不寫任何判準。需要而站上原本沒有的中央出口一律放在 effects.ts：
 *   `millSelfThenPickOneToHandPost` / `deckSearchAnyToHandPost` / `discardSearchToDeckPost` /
 *   `discardPokemonToBenchPost` / `oppReturnHandAndDrawPost` / `peekOppPickToDeckBottomPost`
 *   （其中 `discardPokemonToBenchPost` 一併把逐字同措辭的 刺龍王ex｜王之號召 收斂過去）。
 */

import type { Card } from '$lib/cards/types';
import {
  regPost,
  addLog,
  returnHandToDeck,        // 「將自己的手牌全部放回牌庫並重洗」中央出口
  addPendingPrize,         // ⭐ 取獎賞唯一出口（含「取完即勝」判定），禁自己動 prizes 陣列
} from '../_shared';
import {
  deckSearchToHandPost,        // 牌庫搜尋（**帶條件**）→ 手牌＋重洗；minCount 0（可宣告找不到）
  deckSearchAnyToHandPost,     // 牌庫搜尋（**任意選擇**，無類別限定）→ 手牌＋重洗；minCount N（v6.126 必選）
  recruitBasicToBenchPost,     // 牌庫搜尋【基礎】寶可夢 → 備戰＋重洗
  discardSearchToHandPost,     // 棄牌區 → 手牌（公開揭示卡名）
  discardSearchToDeckPost,     // 棄牌區 → 牌庫並重洗（公開揭示卡名）
  discardPokemonToBenchPost,   // 棄牌區寶可夢 → 備戰（走 getOwnBenchLimit + placedBenchInstance）
  millSelfDeckTopPost,         // 將自己的牌庫上方 N 張卡丟棄
  millSelfThenPickOneToHandPost, // 丟棄自己牌庫上方 N 張，再從其中選 1 張加手牌
  millOppDeckTopPost,          // 將對手的牌庫上方 N 張卡丟棄
  drawToHandPost,              // 從牌庫抽卡直到手牌滿 N 張
  selfStatusPost,              // 將「這隻寶可夢」附加特殊狀態（自己）
  peekOppHandPost,             // 查看對手的手牌（純檢視；公開 log 只有張數）
  peekOppPickToDeckBottomPost, // 查看對手手牌 → 選 1 張 → 放回對手牌庫下方（不重洗）
  oppReturnHandAndDrawPost,    // 對手手牌全部放回牌庫重洗，然後對手抽 N 張
  flipCoinsWithLog,            // 中央擲幣（含 log；<0.5 = 正面）
  countOwnPokemon,             // 自己場上（戰鬥場＋備戰）符合條件的寶可夢數量
} from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// ① 從自己的牌庫選「帶條件」的卡加入手牌（4 招）
//    卡面共同措辭：「…在給對手看過後加入手牌。並且重洗牌庫。」＝ 公開揭示 + 一定要重洗。
//    ⚠ 全部 minCount = 0：牌庫是隱藏資訊，官方允許宣告「找不到」（v6.104 裁定，
//      `scripts/test-v6104-deck-search-optional.mjs` 在守）。「1 張」與「最多 2 張」只差 maxCount。
// ══════════════════════════════════════════════════════════════════════════════
// 011/103 拉普拉斯｜載著游水 [C] dmg=''：
//   從自己的牌庫選擇1張支援者卡，在給對手看過後加入手牌。並且重洗牌庫。
//   ⚠ 同措辭正對照：小火馬｜蓄能量（1 張基本能量）、幾何雪花｜呼喚信號（1 張寶可夢）。
regPost('拉普拉斯|載著游水', deckSearchToHandPost(1, 'Supporter', '載著游水'));

// 023/103 皮卡丘｜尋找朋友 [C] dmg=''：
//   從自己的牌庫選擇1張寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。
regPost('皮卡丘|尋找朋友', deckSearchToHandPost(1, 'Pokemon', '尋找朋友'));

// 031/103 皮卡丘｜能量尾 [C] dmg=''：
//   從自己的牌庫選擇1張能量卡，在給對手看過後加入手牌。並且重洗牌庫。
//   ⚠ 卡面寫「**能量**卡」（不是「基本能量卡」）⇒ filter 'Energy'＝ supertype==='Energy'，
//     特殊能量也在候選內（v2.235 已確立的判準：光電傘蜥｜拋物面充電 同一支）。
regPost('皮卡丘|能量尾', deckSearchToHandPost(1, 'Energy', '能量尾'));

// 063/103 哲爾尼亞斯｜大地導航 [C] dmg=''：
//   從自己的牌庫選擇最多2張競技場卡，在給對手看過後加入手牌。並且重洗牌庫。
regPost('哲爾尼亞斯|大地導航', deckSearchToHandPost(2, 'Stadium', '大地導航'));

// ══════════════════════════════════════════════════════════════════════════════
// ② 從自己的牌庫「任意選擇」（無類別限定）加入手牌（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 067/103 索財靈｜走個夠 [C] dmg=''：
//   擲1次硬幣若為正面，則從自己的牌庫任意選擇1張卡加入手牌。並且重洗牌庫。
//   ⭐⭐ 「任意選擇」無類別限定 ⇒ v6.126 官方裁定**不可以 1 張都不選** ⇒ minCount = 1。
//   ⚠ 卡面**沒有**「在給對手看過後」⇒ 私下揭示（privateReveal，中央 helper 內已處理）。
//   ⚠ 反面時整個效果不發動 ⇒ **不**重洗牌庫（根本沒看過牌庫）。
regPost('索財靈|走個夠', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '走個夠', aIdx);
  if (r.heads !== 1) return addLog(r.state, '走個夠：反面 — 不搜尋牌庫', aIdx);
  return deckSearchAnyToHandPost(1, '走個夠')(r.state, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 從自己的牌庫把【基礎】寶可夢放備戰（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 047/103 皮卡丘ex｜皮卡皮卡大遊行 [C] dmg=''：
//   從自己的牌庫選擇任意數量的【基礎】寶可夢卡，放置於備戰區。並且重洗牌庫。
//   ⚠ 「**任意數量**」⇒ 上限只受備戰空位限制（不是固定 N），可以選 0 張。
//     傳 99 讓中央 helper 自己取 `Math.min(99, 備戰空位)` —— 備戰上限走 getOwnBenchLimit
//     （零之大空洞＋太晶 = 8），禁硬編 5。
//   ⚠ 同措辭正對照：毒電嬰｜呼朋引伴、電擊獸｜呼朋引伴（都是「最多N張」版本，共用同一支）。
regPost('皮卡丘ex|皮卡皮卡大遊行', recruitBasicToBenchPost(99, '皮卡皮卡大遊行'));

// ══════════════════════════════════════════════════════════════════════════════
// ④ 丟棄自己的牌庫上方 N 張（2 招）
// ══════════════════════════════════════════════════════════════════════════════
// 088/103 暴飛龍ex｜龍之波動 [R,W] 240：將自己的牌庫上方2張卡丟棄。
//   ⚠ 本批唯一有傷害的招式 —— 但**不需要改寫傷害** ⇒ 只登 regPost，240 由引擎讀卡面。
//   ⚠ 牌庫不足 2 張時丟到沒有為止（中央 helper 的 slice 自然截斷），不可當掉。
regPost('暴飛龍ex|龍之波動', millSelfDeckTopPost(2, '龍之波動'));

// 052/103 莫魯貝可｜選點心 [C] dmg=''：
//   將自己的牌庫上方3張卡丟棄，從其中選擇1張卡，在給對手看過後加入手牌。
//   ⚠⚠ 兩段順序不可顛倒：**先真的丟進棄牌區**（公開可見），再從「剛丟的那 3 張」挑 1 張。
//     ⇒ picker 候選必須用 validIids 綁死在剛丟的那幾張，不是整個棄牌區（中央 helper 已處理）。
//   ⚠ 這 3 張已經攤開＝**已知資訊**，卡面又是「選擇1張」（沒有「最多／任意」）⇒ minCount = 1；
//     v6.104「minCount 必須永遠 0」那條只管**牌庫**搜尋（隱藏資訊），這裡不適用。
regPost('莫魯貝可|選點心', millSelfThenPickOneToHandPost(3, '選點心'));

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 棄牌區操作（3 招）
// ══════════════════════════════════════════════════════════════════════════════
// 042/103 皮卡丘｜存起來 [C] dmg=''：
//   從自己的棄牌區選擇最多2張基本能量卡，在給對手看過後加入手牌。
//   ⚠ 棄牌區是**公開資訊** ⇒ 不適用牌庫的 fail-to-find；依 2026-08-07 站長裁定，
//     純「最多N張」措辭（沒有「任意數量／若希望／任意方式／任意選擇」）維持**必選 ≥1**
//     （中央 `discardSearchToHandPost` 的 minCount = 1；`discard-to-hand` 已列在
//      `scripts/test-v6125-optional-picker-skip.mjs` 的 MANDATORY_BY_SITE_RULE）。
//   ⚠ 同措辭正對照：鐵斑葉｜補全之網、破破舵輪｜救援船錨（最多 2 張寶可夢）。
regPost('皮卡丘|存起來', discardSearchToHandPost(2, 'BasicEnergy', '存起來'));

// 082/103 帝牙盧卡｜反轉時間 [C] dmg=''：
//   從自己的棄牌區選擇寶可夢卡與基本能量卡合計最多3張，在給對手看過後放回牌庫並重洗。
//   ⭐⭐ 「**合計**最多3張」＝**一個** picker、兩種卡型混選、總數上限 3
//     ⇒ filter 用既有的混選述詞 'PokemonOrBasicEnergy'（selection-filter.ts 已收錄），
//       **不是**開兩個 picker、也不是各自 3 張。
//   ⚠ 逐字同措辭的既有卡：聖灰(I)「從棄牌區挑最多 5 張寶可夢放回牌庫並重洗」
//     ⇒ 共用同一支 resolver（本版把它的 log 標籤參數化，effectKey 不變）。
regPost('帝牙盧卡|反轉時間', discardSearchToDeckPost(
  3, 'PokemonOrBasicEnergy', '反轉時間',
  (c: Card) => c.supertype === 'Pokemon' || (c.supertype === 'Energy' && c.subtype === 'Basic'),
));

// 088/103 暴飛龍ex｜轟鳴呼聲 [C] dmg=''：
//   從自己的棄牌區選擇最多3張【龍】寶可夢卡，放置於備戰區。
//   ⚠ 是從**棄牌區**放備戰（不是牌庫），而且卡面**沒有**「並且重洗牌庫」⇒ 不重洗。
//   ⚠ 備戰上限走 getOwnBenchLimit、放場實例走 placedBenchInstance（中央 helper／resolver 內）。
//   ⚠ 逐字同措辭的既有卡：刺龍王ex｜王之號召（最多3張【水】寶可夢）—— 本版已收斂到同一支。
regPost('暴飛龍ex|轟鳴呼聲', discardPokemonToBenchPost(
  3, '轟鳴呼聲', (c: Card) => c.pokemonType === 'Dragon', '【龍】寶可夢',
));

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 抽卡到手牌滿 N 張（2 招）
//    ⚠ 手牌已經 ≥N 時**一張都不抽**（中央 `drawToHandPost` 的 `Math.max(0, n - hand.length)`），
//      不是抽 0 張、也不是報錯。牌庫不足時抽到沒有為止。
// ══════════════════════════════════════════════════════════════════════════════
// 081/103 基拉祈ex｜實現願望 [C] dmg=''：從牌庫抽卡直到自己的手牌滿7張為止。
regPost('基拉祈ex|實現願望', drawToHandPost(7, '實現願望'));

// 037/103 皮卡丘｜南國氛圍 [C,C] dmg=''：
//   將這隻寶可夢【睡眠】。從牌庫抽卡直到自己的手牌滿6張為止。
//   ⚠⚠ 順序照卡面：**先睡眠、再抽卡**（兩段各自獨立，任一段條件不足都不影響另一段）。
//   ⚠ 「這隻寶可夢」＝出招的自己 ⇒ `selfStatusPost`（它內部已含 泡沫能量／祭典會場 的免疫閘），
//     不是 `statusPost`（那支是打對手的）。
regPost('皮卡丘|南國氛圍', (state, aIdx, pool) => {
  const s = selfStatusPost('asleep')(state, aIdx, pool);
  return drawToHandPost(6, '南國氛圍')(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑦ 查看對手的手牌（2 招）
//    ⚠⚠ Check T：picker 之前不可以用**公開** log 印出對手手牌內容（會洩漏隱藏區）。
// ══════════════════════════════════════════════════════════════════════════════
// 020/103 皮卡丘｜窺視 [C] dmg=''：查看對手的手牌。
//   ⚠ 只有「查看」沒有後續動作 ⇒ 中央 `peekOppHandPost`（純檢視 picker，maxCount 0）。
regPost('皮卡丘|窺視', peekOppHandPost('窺視'));

// 094/103 伊布｜叼去藏 [C] dmg=''：
//   查看對手的手牌，從其中選擇1張物品卡，放回對手的牌庫下方。
//   ⚠ 「查看對手的手牌」是**無條件**的玩家權益：對手手牌沒有物品卡時仍要讓玩家看完整副手牌
//     （中央 helper 開 maxCount 0 的純檢視 picker），不可因為「沒得選」就整招跳過。
//   ⚠ 卡面「選擇1張」沒有「最多／若希望」⇒ 有物品卡時必選 1 張。
//   ⚠ 「放回牌庫**下方**」沒有「重洗」⇒ keep-order（v6.124 中央 deckWithCardsToBottom）。
//   ⚠ 同措辭正對照：能量撢子(Item)「查看對手的手牌，從其中選擇1張能量卡，放回對手的牌庫下方」。
regPost('伊布|叼去藏', peekOppPickToDeckBottomPost(
  'Item', '叼去藏',
  (c: Card) => c.supertype === 'Trainer' && c.subtype === 'Item', '物品卡',
));

// ══════════════════════════════════════════════════════════════════════════════
// ⑧ 手牌洗回牌庫（2 招）
// ══════════════════════════════════════════════════════════════════════════════
// 078/103 滑滑小子｜挑毛病 [D] dmg=''：
//   對手將對手自己的手牌全部放回牌庫並重洗。然後，對手從牌庫抽出4張卡。
//   ⚠ 主詞是**對手**（不是雙方）⇒ `oppReturnHandAndDrawPost`，不是 `bothReturnHandAndDrawPost`。
//   ⚠ 這是**玩家層級**效果（不作用於某隻寶可夢）⇒ **不**過 canApplyEffectToTarget
//     （v5.929 背蓋化石誤擋玩家層級效果的教訓）。
//   ⚠ 對手牌庫不足 4 張時抽到沒有為止，不可當掉。
regPost('滑滑小子|挑毛病', oppReturnHandAndDrawPost(4, '挑毛病'));

// 087/103 賽富豪｜歡慶 [M] dmg=''：
//   若自己的手牌為30張，則獲得2張自己的獎賞卡。然後，將自己的手牌全部放回牌庫並重洗。
//   ⚠ 條件是「**剛好** 30 張」（卡面「為30張」，不是「30張以上」）⇒ `=== 30`。
//   ⚠⚠ 「然後，將自己的手牌全部放回牌庫並重洗」是**句號後的獨立句**，
//     不在「若…則…」的射程內 ⇒ **無論手牌是不是 30 張都要洗回去**
//     （與本批 滑滑小子｜挑毛病「…並重洗。然後，對手從牌庫抽出4張卡。」同一種句構）。
//   ⚠⚠ 取獎賞一律走中央 `addPendingPrize`（v5.466 自動給獎賞 + 私密 log + 「取完即勝」判定），
//     **禁止**自己動 `players[].prizes` 陣列。取完獎賞若已勝利就立刻 return（不再洗手牌）。
//   ⚠ 獎賞卡會先進手牌，再一起洗回牌庫 —— 這就是卡面的順序（PTCG_RULES.md L551：
//     獎賞與其他效果同時發生時先取獎賞）。
regPost('賽富豪|歡慶', (state, aIdx, pool) => {
  let s = state;
  const handCount = s.players[aIdx].hand.length;
  if (handCount === 30) {
    s = addLog(s, '歡慶：自己的手牌為 30 張 — 獲得 2 張自己的獎賞卡', aIdx);
    s = addPendingPrize(s, aIdx, 2, pool);
    if (s.phase === 'game-over') return s;
  } else {
    s = addLog(s, `歡慶：自己的手牌為 ${handCount} 張（不是 30 張）— 不獲得獎賞卡`, aIdx);
  }
  s = addLog(s, '歡慶：將自己的手牌全部放回牌庫並重洗', aIdx);
  return returnHandToDeck(s, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑨ 丟棄對手的牌庫上方（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 100/103 一家鼠｜一同咬 [C] dmg=''：
//   擲與自己的場上「一家鼠」的數量相同次數的硬幣，
//   將對手的牌庫上方與正面出現的次數×2張相同數量的卡丟棄。
//   ⚠ 擲幣次數 ＝ 自己場上（**戰鬥場＋備戰**）名稱為「一家鼠」的寶可夢數量
//     ⇒ 走中央 `countOwnPokemon`，不是只看戰鬥場、也不是只看備戰。
//   ⚠ 卡面**沒有**「包含『寶可夢【ex】』」那種括號 ⇒ 只數卡名完全相同的「一家鼠」
//     （對照：皮卡丘｜皮卡連鎖 卡面有那個括號才多收 `XXXex`）。
//   ⚠ 丟棄張數 ＝ 正面次數 **× 2**（不是正面次數）。牌庫不足時丟到沒有為止。
//   ⚠ 出招的自己就是「一家鼠」，理論上數量至少 1；仍保留 n <= 0 的防呆（借招／異常狀態）。
regPost('一家鼠|一同咬', (state, aIdx, pool) => {
  const n = countOwnPokemon(state, aIdx, pool, (c: Card) => c.name === '一家鼠');
  if (n <= 0) return addLog(state, '一同咬：自己的場上沒有「一家鼠」，不擲硬幣', aIdx);
  const r = flipCoinsWithLog(state, n, '一同咬', aIdx);
  const discardN = r.heads * 2;
  if (discardN <= 0) return addLog(r.state, `一同咬：${r.heads}/${n} 次正面 — 沒有卡要丟棄`, aIdx);
  const s = addLog(r.state,
    `一同咬：${r.heads}/${n} 次正面 × 2 → 將對手的牌庫上方 ${discardN} 張卡丟棄`, aIdx);
  return millOppDeckTopPost(discardN, '一同咬')(s, aIdx, pool);
});
