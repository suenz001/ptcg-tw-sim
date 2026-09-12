/**
 * v6.346 M6a「30th CELEBRATION」招式實裝 —— 批次 6（8 招｜防禦旗標／減傷／全體傷害／指示物）
 *
 * ⚠⚠ 卡面文字逐字取自 `static/cards/M6a.json`（台灣官方中文，`attacks[].effect`），未經簡化。
 *
 * ⭐ 本批共 15 招，其中 7 招屬於 `effects.ts` 內部 **local helper** 的家族
 *   （coinHeadsSelfImmuneNextPost / bonusPrizeIfKOPost / oppTargetTakeExtraNextPost /
 *    setOppActiveHPPost / skipBothPre / snipeAllOppExPost），依共用規範第 3 節
 *   **登記在 effects.ts 那一區與同型招式並列**，不在本檔另抄一份（Rule 38）。
 *   本檔只放「helper 是 export、可以從卡檔呼叫」的 8 招。
 *
 * ⭐ 全 15 個鍵已跑過同名印刷碰撞檢查（`__m6a/collide_w6.mjs` + `wave6-keys.json`）：全數 `OK`
 *   （全卡庫同名同招的傷害與效果文字都只有一種）⇒ 沒有「同名不同印刷」的風險。
 *   本檔只有 堅果啞鈴｜轟爆尖刺 用 `regPre`（卡面 dmg=''，但戰鬥場那一份要造成 50）；
 *   固拉多｜大地裂破（250）維持只登 `regPost`，傷害讓引擎讀卡面
 *   （v6.333 皮卡丘ex｜打雷 硬寫 220、M6a 印刷卻是 200 的前科；`scripts/test-fixed-damage-base.mjs` 在守）。
 *
 * ⭐⭐⭐ 本批最容易做錯的地方 ①：**「受到 N 點傷害」≠「放置 N 個傷害指示物」**
 *   ・傷害型（卡面「受到◯點傷害」）：戰鬥場那一份走 **mainline**（弱點×2／攻擊方道具全照算），
 *     備戰那一份走中央 `hitBenchAllForCard`（卡面括號「[在備戰區不計算弱點・抵抗力。]」是
 *     規則層既有行為，helper 內已處理）。本檔：大地裂破、轟爆尖刺。
 *   ・指示物型（卡面「放置◯個傷害指示物」）：`snipeCountersPost`，**不計弱抗、不報傷害預估**。
 *     本檔：渾沌傷痛。
 *   ⚠ 用錯會被 `scripts/test-v6238-estimate-deferred-damage-and-magnifier.mjs` 的全卡池
 *     行為掃描抓到（「實際掉血卻不顯示預估」）。
 *
 * ⭐⭐⭐ 本批最容易做錯的地方 ②：**三個「減／加傷」主詞完全不同，務必逐字對齊卡面**
 *   ・「在下個對手的回合，**這隻寶可夢**受到招式的傷害「-N」點。」
 *       ＝ 自己受傷 −N ⇒ `selfDmgReducePost(N)`（凝固 60／盾牌壓制 50）
 *   ・「在下個對手的回合，受到這個招式的寶可夢**使用**招式的傷害「-N」點。」
 *       ＝ 對手打人 −N ⇒ `defNextAtkReducePost(N)`（叫聲 30）
 *   ・「在下個自己的回合，受到這個招式的寶可夢**受到**招式的傷害「+N」點。」
 *       ＝ 對手易傷 +N ⇒ `oppTargetTakeExtraNextPost(N)`（刺耳聲 30；登在 effects.ts）
 *   長期記憶 `reference-defnextatk-vs-self-reduce-subject-v5997` 專記這個坑。
 *   ⚠ 後兩者是**施加在對手身上**的招式效果 ⇒ 一律要過 attack-effect 免疫閘
 *     （中央 helper 內部已含 `canApplyAttackEffectToTarget`；
 *      `scripts/test-opp-debuff-immunity.mjs`、`test-oppdebuff-immunity-converge.mjs` 在守）。
 */

import type { CardInstance } from '../../types';
import { regPre, regPost } from '../_shared';
import {
  selfClearAllStatusPost,   // ⭐v6.346 新中央出口：「將這隻寶可夢的特殊狀態全部恢復。」（三槽全清）
  applyOppActiveDebuffPost, // 對手戰鬥位 debuff 中央管線（內含 attack-effect 免疫閘）
  selfDmgReducePost,        // 「在下個對手的回合，**這隻寶可夢**受到招式的傷害 -N」
  defNextAtkReducePost,     // 「在下個對手的回合，受到這個招式的寶可夢**使用**招式的傷害 -N」
  hitBenchAllForCard,       // 對指定方「所有備戰」造成招式傷害（備戰不計弱抗＋全套備戰保護／KO 結算）
  selfHitPost,              // 反動自傷（不計弱抗、不觸發對手反擊；自我 KO 由引擎 sanityKOSweep 接住）
  snipeCountersPost,        // 「在對手的1隻寶可夢身上放置 N 個傷害指示物」（attack-effect，不計弱抗）
} from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// ① 自身特殊狀態全部恢復（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 040/103 皮卡丘｜吹吹風 [C] dmg=''：將這隻寶可夢的特殊狀態全部恢復。
//   ⚠⚠ 特殊狀態是**三槽制**（status / secondaryStatus / tertiaryStatus）⇒「全部恢復」三槽都要清，
//     只清主格會讓雙／三重狀態（灼傷+混亂、睡+毒+燒）殘留。
//   ⚠ 逐字同措辭的既有卡：奧利瓦ex｜芳香射擊（160）—— 本版一併收斂到同一支中央出口
//     （它原本的本地實作只清 status 主格，是既有 bug，順帶修正）。
//   ⚠ 主詞是「這隻寶可夢」＝出招的自己 ⇒ 對自己有利，**不**過 canApplyEffectToTarget
//     （免疫閘是擋對手施加的效果；v5.929 背蓋化石誤擋的教訓）。
regPost('皮卡丘|吹吹風', selfClearAllStatusPost('吹吹風'));

// ══════════════════════════════════════════════════════════════════════════════
// ② 改寫受招者的弱點屬性（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 034/103 皮卡丘｜覆蓋伏特 [L] 10：
//   在下個自己的回合結束前，受到這個招式的寶可夢弱點改為【雷】屬性。[弱點以「×2」計算傷害。]
//   ⚠ 逐字同措辭的既有卡：智揮猩｜掌握弱點（改為【無】）⇒ 同一條管線、同一個旗標。
//     旗標 `weaknessOverrideTypeNextTurn` 由 engine END_TURN promote 成 `...ThisTurn`，
//     中央述詞 `getEffectiveWeaknessType` 消費（弱點倍率仍是卡面既有的「×2」）。
//   ⚠ 期限是「下個**自己**的回合結束前」（≠ 本批 ⑤ 的「下個**對手**的回合」）——
//     這正是 NextTurn→ThisTurn promote 模型的語意，不需要第二種旗標。
//   ⚠ 施加在對手身上 ⇒ 走中央 `applyOppActiveDebuffPost`（內含 attack-effect 免疫閘），
//     禁止自己直接寫旗標（v6.046 智揮猩原本就是漏免疫閘被收斂的）。
//   ⚠ 傷害 10 由引擎讀卡面，不寫 regPre。
regPost('皮卡丘|覆蓋伏特', applyOppActiveDebuffPost(
  '覆蓋伏特',
  (a: CardInstance) => ({ ...a, weaknessOverrideTypeNextTurn: 'Lightning' }),
  '覆蓋伏特：下回合 defender 弱點屬性改為【雷】（×2 仍計算）',
));

// ══════════════════════════════════════════════════════════════════════════════
// ③ 自己下個對手回合受到的招式傷害 −N（2 招）
//    卡面共同措辭：「在下個對手的回合，**這隻寶可夢**受到招式的傷害「-N」點。」
//    ⚠ 主詞是「這隻寶可夢」＝出招的自己 ⇒ `selfDmgReducePost`（寫 self.active.damageReduceNextHit）。
//    ⚠ 正對照（逐字同措辭的既有卡）：樹林龜｜甲殼衝撞 -20、橡實果｜硬化 -30、巨鉗螳螂ex｜鋼翼 -50。
// ══════════════════════════════════════════════════════════════════════════════
// 065/103 科斯莫姆｜凝固 [C,C] dmg=''：在下個對手的回合，這隻寶可夢受到招式的傷害「-60」點。
regPost('科斯莫姆|凝固', selfDmgReducePost(60));

// 086/103 藏瑪然特｜盾牌壓制 [M,M,C] 100：在下個對手的回合，這隻寶可夢受到招式的傷害「-50」點。
//   ⚠ 100 由引擎讀卡面，不寫 regPre。
regPost('藏瑪然特|盾牌壓制', selfDmgReducePost(50));

// ══════════════════════════════════════════════════════════════════════════════
// ④ 受招者下回合「使用招式」的傷害 −N（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 073/103 尼多蘭｜叫聲 [C] dmg=''：
//   在下個對手的回合，受到這個招式的寶可夢使用招式的傷害「-30」點。
//   ⚠⚠ 主詞是「受到這個招式的寶可夢**使用**招式的傷害 -30」＝ debuff **對手的攻擊力**
//     ⇒ `defNextAtkReducePost`（寫 opp.active.nextOwnAttackPenalty），
//     **不是** selfDmgReducePost（那是「自己受傷 -N」，共用欄位會誤消耗，v3.22 的舊 bug）。
//   ⚠ 逐字同措辭的既有卡：嘎啦嘎啦｜叫聲 -40、黑魯加｜大聲咆哮 -100。
//   ⚠ 施加在對手身上 ⇒ helper 內已含 attack-effect 免疫閘（化隱／純樸／薄霧能量／皇帝之勢…）。
regPost('尼多蘭|叫聲', defNextAtkReducePost(30, '叫聲'));

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 全體／備戰「受到 N 點傷害」（2 招）—— ⭐ 傷害型，不是指示物型
// ══════════════════════════════════════════════════════════════════════════════
// 068/103 固拉多｜大地裂破 [F,F,F,F,F] 250：
//   自己的所有備戰寶可夢也各受到20點傷害。[在備戰區不計算弱點・抵抗力。]
//   ⚠⚠ 打的是「**自己的**」備戰（targetIdx = aIdx），不是對手 —— 方向寫反會變成單方面爆發。
//   ⚠ 逐字同措辭的既有卡：穿山王｜地震（自己所有備戰 10）、焚焰蚣｜燃燒熱浪（自己所有備戰 30）。
//   ⚠ 自傷 bench 路徑不套「對手側」的備戰保護（球形盾牌／藏隱／太古防壁…），helper 內已用
//     `attackerIdx !== targetIdx` 分流處理。
//   ⚠ 250 由引擎讀卡面，不寫 regPre。
regPost('固拉多|大地裂破', (state, aIdx, pool) =>
  hitBenchAllForCard(state, aIdx, aIdx, 20, pool, '大地裂破'));

// 083/103 堅果啞鈴｜轟爆尖刺 [M,M] dmg=''：
//   對手的所有寶可夢各受到50點傷害。這隻寶可夢也受到130點傷害。[在備戰區不計算弱點・抵抗力。]
//   ⭐ 照既有同措辭的 雪絨蛾｜冰凍羽擊（v5.168 重設計版）／急凍鳥｜冰雹（m6a_wave1）：
//     ・對手**戰鬥場**的 50 交給 **mainline ATTACK**（regPre 給 damage；弱點×2／抵抗力／
//       攻擊方道具・特性加成全部照算）——卡面只說「在備戰區」不計弱抗，戰鬥場要算。
//     ・對手**備戰**的 50 走中央 `hitBenchAllForCard`（raw 50 + 備戰保護 + KO／獎賞結算）。
//   ⚠ 「這隻寶可夢也受到130點傷害」是**反動自傷** ⇒ `selfHitPost`（不計弱抗、不觸發對手反擊）。
//     堅果啞鈴 HP 130 ⇒ 必定自我昏厥，由引擎攻擊後的 sanityKOSweep 接住（既有行為）。
//   ⚠ 順序照卡面：先打對手全體，再自傷。中途若已 game-over 就不再自傷。
//   ⚠ regPre 寫死 50 已跑過同名印刷碰撞檢查（`__m6a/collide_w6.mjs`）：全卡庫只有 1 個印刷。
regPre('堅果啞鈴|轟爆尖刺', (s) => ({ state: s, damage: 50 }));
regPost('堅果啞鈴|轟爆尖刺', (state, aIdx, pool) => {
  const s = hitBenchAllForCard(state, aIdx, (1 - aIdx) as 0 | 1, 50, pool, '轟爆尖刺');
  if (s.phase === 'game-over') return s;
  return selfHitPost(130, '轟爆尖刺')(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 放置傷害指示物（1 招）—— ⭐ 指示物型，不是傷害型
// ══════════════════════════════════════════════════════════════════════════════
// 076/103 耿鬼ex｜渾沌傷痛 [D,D] dmg=''：在對手的1隻寶可夢身上放置13個傷害指示物。
//   ⚠ 逐字同措辭的既有卡：綿綿泡芙／納噬草｜悄聲加害（2 個）、勾魂眼｜不祥之眼（5 個）。
//   ⚠ 1 個傷害指示物 = 10 點（helper 內部換算 130），但語意是 **attack-effect**：
//     化隱／對戰圓形擋、太晶不擋、**不計弱點・抵抗力**、**不報傷害預估**。
//   ⚠ 「1隻**寶可夢**」含戰鬥場 ⇒ picker 的 includeActive = true（helper 內已設）；
//     對手沒有備戰時直接打戰鬥場（仍走中央 dealAttackDamageToTarget）。
regPost('耿鬼ex|渾沌傷痛', snipeCountersPost(13, '渾沌傷痛'));
