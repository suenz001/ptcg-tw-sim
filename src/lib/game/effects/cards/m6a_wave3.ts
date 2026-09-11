/**
 * v6.343 M6a「30th CELEBRATION」招式實裝 —— 批次 3（11 招｜能量操作：丟棄／加速／附加）
 *
 * ⚠⚠ 卡面文字逐字取自 `static/cards/M6a.json`（台灣官方中文，`attacks[].effect`），未經簡化。
 *
 * ⭐ 本批的「傷害」全部讓引擎讀卡面 —— 只有「宣告招式時就要玩家選能量丟棄」那 4 招
 *   會落到 `regPre`（`registerSelfDiscardMultiply` 內建 PRE_DISCARD picker ＋ regPre），
 *   其餘 7 招一律**只登記 `regPost`**（v6.333 皮卡丘ex｜打雷 硬寫 220 的前科）。
 *   那 4 鍵已跑過同名印刷碰撞檢查（`__m6a/collide_w3.mjs` + `wave3-keys.json`）：
 *   全卡庫同名同招只有一種傷害與一種效果文字 ⇒ 可以安全寫死 base。
 *
 * ⚠⚠ **皮卡丘ex｜十萬伏特（M6a 047/126，200＋丟光能量）本批不實裝** ——
 *   `ATTACK_POST` 的鍵是「卡名|招式名」，沒有「哪一個印刷」的維度，而
 *   `皮卡丘ex|十萬伏特` 另有 MC 227/764 與 MJ 008 三個印刷是 **120 點、效果欄全空**（H 標，可對戰）。
 *   在這個鍵上掛「丟光全部能量」會讓那三張可對戰的印刷一起被改壞 ——
 *   正是 `scripts/test-v6333-m6a-unmarked.mjs` KNOWN_COLLISIONS 裡列管「新效果列管在待實裝清單」的那一條。
 *   ⇒ 留給站長裁示（要不要新增「讀場上那張卡的卡面」的印刷閘）。
 *
 * ⚠ 能量屬性一律走中央 host-aware 述詞（`energyProvidesType`）或中央 registrar 既有的判準，
 *   **不直讀 `pokemonType`**（現役基本能量卡 `pokemonType` 恒 null）。
 *
 * ⭐ Rule 38：本檔不寫任何判準。需要的三支新中央 helper
 *   （`selfDiscardAllEnergyOfTypePost` / `healOneOwnBenchFullPost` / `discardOneEnergyOfEachTypePost`）
 *   全部放在 `effects.ts` 當中央出口，並把站上既有的同措辭卡
 *   （紅蓮鎧騎｜紅蓮引爆、風妖精｜治癒棉絮）一起收斂過去。
 */

import { regPost } from '../_shared';
import {
  registerSelfDiscardMultiply,      // ATTACK_PRE_DISCARD_CHOICE ＋ regPre 一鍵註冊（宣告時選能量丟棄）
  selfDiscardAllEnergyPost,         // 「將這隻寶可夢身上附加的能量卡全部丟棄。」
  selfDiscardAllEnergyOfTypePost,   // 「將這隻寶可夢身上附加的【X】能量卡全部丟棄，…」
  discardOneEnergyOfEachTypePost,   // 「選擇…【火】【水】【雷】能量各1個，將其丟棄。」
  healOneOwnBenchFullPost,          // 「將自己的1隻備戰寶可夢的HP全部恢復。」
  chooseOppPokemonDamage,           // 「對手的1隻寶可夢受到 N 點傷害。」（含戰鬥場）
  flipCoinsUntilTails,              // 「擲硬幣直到出現反面」（中央，含 20 次安全上限）
  deckEnergyAttachSelfPost,         // 「從自己的牌庫選擇最多 N 張…附於這隻寶可夢身上。並且重洗牌庫。」
  handAttachEnergyPost,             // 「從自己的手牌選擇…以任意方式附於自己的寶可夢身上。」
  discardEnergyAttachPost,          // 「從自己的棄牌區選擇最多 N 張基本能量卡，附於…」
} from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// ① 「選擇 N 個這隻寶可夢身上附加的（【X】）能量，將其丟棄。」（4 招）
//    ⇒ 宣告招式時就要玩家選 ⇒ 中央 registerSelfDiscardMultiply
//      （內部同時登 ATTACK_PRE_DISCARD_CHOICE 讓 UI 彈 picker ＋ regPre 執行丟棄）。
//    ⚠ 參數 (key, 招式名, 傷害, per=0, max=N, 屬性filter, forceAll=false, min=N)：
//      per=0＋min=N ⇒ 中央自動切 countMode='units'（火箭隊能量算 2 個、燃火附進化算 3 個），
//      這是站上「卡面寫『N 個』」的既有判準，不是本批發明的。
//    ⚠ 屬性 filter 的判準沿用中央 registrar 既有那一份（picker 端 host-aware、
//      regPre 端 pokemonType/卡名【X】），與 雷丘｜強力伏特【雷】、鳳王｜紅蓮之翼【火】、
//      四季鹿｜落葉衝撞【草】、紅蓮鎧騎ex｜鎧農炮【火】 完全一致。
// ══════════════════════════════════════════════════════════════════════════════
// 006/103（+105/103）火焰鳥｜火焰旋渦 [Fire,Fire,C] 130：選擇2個這隻寶可夢身上附加的能量，將其丟棄。
//   ⚠ 全站另有 煤炭龜｜火焰旋渦（110）—— 招名相同但**卡名不同** ⇒ 鍵不撞，別抄錯數字。
registerSelfDiscardMultiply('火焰鳥|火焰旋渦', '火焰旋渦', 130, 0, 2, 'all', false, 2);
// 053/103 密勒頓｜閃電猛衝 [L,L,C] 140：選擇2個這隻寶可夢身上附加的【雷】能量，將其丟棄。
registerSelfDiscardMultiply('密勒頓|閃電猛衝', '閃電猛衝', 140, 0, 2, 'Lightning', false, 2);
// 054/103 超夢｜精神驅動 [P,P,C] 120：選擇1個這隻寶可夢身上附加的能量，將其丟棄。
registerSelfDiscardMultiply('超夢|精神驅動', '精神驅動', 120, 0, 1, 'all', false, 1);
// 072/103 故勒頓｜全開猛撞 [F,F,C] 140：選擇2個這隻寶可夢身上附加的【鬥】能量，將其丟棄。
registerSelfDiscardMultiply('故勒頓|全開猛撞', '全開猛撞', 140, 0, 2, 'Fighting', false, 2);

// ══════════════════════════════════════════════════════════════════════════════
// ② 「將這隻寶可夢身上附加的能量卡**全部**丟棄。」（2 招）
//    ⇒ 不需要玩家選 ⇒ 只登 regPost，傷害讀卡面（與 閃電鳥｜十萬伏特、齒輪怪｜高級光束、
//      蒼炎刃鬼ex｜紫水晶激怒、竹蘭的烈咬陸鯊ex｜龍之爆發 同一支中央 helper）。
// ══════════════════════════════════════════════════════════════════════════════
// 084/103 索爾迦雷歐｜流星閃衝 [M,M,C,C] 220：將這隻寶可夢身上附加的能量卡全部丟棄。
regPost('索爾迦雷歐|流星閃衝', selfDiscardAllEnergyPost('流星閃衝'));

// 007/103 鳳王｜神聖之息 [Fire,Fire] dmg=''：
//   將這隻寶可夢身上附加的能量卡全部丟棄。將自己的1隻備戰寶可夢的HP全部恢復。
//   ⚠ 順序照卡面：**先丟光能量、再回復**。
//   ⚠ 「HP全部恢復」＝傷害指示物清成 0（不是恢復固定點數），且主詞是「**備戰**」寶可夢
//     ⇒ 與 風妖精｜治癒棉絮 逐字同措辭，共用同一支中央 helper（本版一併收斂）。
//   ⚠ 卡面**沒有**寫「若沒有備戰寶可夢則失敗」⇒ 沒有備戰（或備戰都沒受傷）時
//     只執行前半段丟能量，不可當掉、也不可讓整招失敗。
regPost('鳳王|神聖之息', (state, aIdx, pool) => {
  const s = selfDiscardAllEnergyPost('神聖之息')(state, aIdx, pool);
  return healOneOwnBenchFullPost('神聖之息')(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 「將這隻寶可夢身上附加的【X】能量卡全部丟棄，對手的1隻寶可夢受到 N 點傷害。」（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 045/103 皮卡丘｜雷電落 [L,L,L] dmg=''：
//   將這隻寶可夢身上附加的【雷】能量卡全部丟棄，對手的1隻寶可夢受到90點傷害。[在備戰區不計算弱點・抵抗力。]
//   ⚠ 卡面 damage 欄是空的 ⇒ **不登記 regPre**（登了會憑空多打一份主線傷害）。
//   ⚠ 90 點是「受到◯點傷害」= 傷害型（不是指示物型）；主詞是「1隻**寶可夢**」（含戰鬥場）
//     ⇒ 走 chooseOppPokemonDamage（opp-poke-choose ＋ 中央 dealAttackDamageToTarget）。
//     括號「在備戰區不計算弱點・抵抗力」是該中央管線的既有行為，不需要也不可以再加旗標。
//   ⚠ 順序照卡面：**先丟再打**（丟能量是立即的，打擊是 picker 解掉之後）。
//   ⚠ 同措辭正對照：投羽梟｜羽毛射擊（丟光全部能量 → 對手 1 隻寶可夢 90）。
regPost('皮卡丘|雷電落', (state, aIdx, pool) => {
  const s = selfDiscardAllEnergyOfTypePost('Lightning', '雷電落')(state, aIdx, pool);
  return chooseOppPokemonDamage(s, aIdx, 90, '雷電落');
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ 「選擇這隻寶可夢身上附加的【火】【水】【雷】能量各1個，將其丟棄。」（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 097/103 洛奇亞｜元素爆破 [Fire,Water,Lightning] 250
//   ⚠ 「各1個」≠「任選3個」：三種屬性**各剛好 1 個**。中央 `PreDiscardSpec` 只有單一
//     `energyTypeFilter`，表達不了「三種各 1」⇒ 本招改走 POST 的中央能量 picker
//     （`active-energy-discard`，逐屬性一段）。傷害 250 是卡面印刷、與丟棄無關，
//     所以**不需要** regPre，也就沒有把 PRE_DISCARD 的共用 UI 改壞的風險。
//   ⚠ 屬性判定 host-aware（`energyProvidesType`）：古舊／稜鏡（Basic host）等「視為該屬性」
//     的特殊能量可以拿來充當其中一格 —— 與 紅蓮鎧騎｜紅蓮引爆 的既有判準一致。
regPost('洛奇亞|元素爆破', discardOneEnergyOfEachTypePost(['Fire', 'Water', 'Lightning'], '元素爆破'));

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 附能量型（3 招）—— 三種來源、三種散佈方式，**不可混用**
// ══════════════════════════════════════════════════════════════════════════════
// 036/103 皮卡丘｜充電衝刺 [C] dmg=''：
//   擲硬幣直到出現反面，從自己的牌庫選擇最多與正面出現的次數相同數量的「基本【雷】能量」卡，
//   附於這隻寶可夢身上。並且重洗牌庫。
//   ⚠ 目標是「**這隻**寶可夢」（固定）⇒ deckEnergyAttachSelfPost，不是能量鏈（沒有分配的餘地）。
//   ⚠ 擲幣走中央 flipCoinsUntilTails（含 20 次安全上限；固定擲幣的乾跑/AI/測試不會無限迴圈）。
//   ⚠ 「最多」⇒ minCount=0，玩家可以少拿或不拿；0 次正面時仍要「重洗牌庫」。
//   ⚠ 同措辭正對照：卡比獸｜大胃王（同一句型，只差它不限屬性）。
regPost('皮卡丘|充電衝刺', (state, aIdx, pool) => {
  const r = flipCoinsUntilTails(state, aIdx, '充電衝刺', 20);
  return deckEnergyAttachSelfPost('Lightning', '充電衝刺', { max: r.heads })(r.state, aIdx, pool);
});

// 048/103（+127/103）皮卡丘ex｜劈哩劈哩夜狂歡 [L] dmg=''：
//   從自己的手牌選擇任意數量的基本能量卡，以任意方式附於自己的寶可夢身上。
//   ⚠ 「**以任意方式**附於自己的寶可夢身上」＝可分散到多隻 ⇒ 中央 startEnergyChain
//     （handAttachEnergyPost 內部就是走 v158-energy-chain-start，source='hand'）。
//   ⚠ 「任意數量」⇒ optional=true（可以 1 張都不選）。
//   ⚠ 逐字同措辭正對照：阿羅拉 椰蛋樹ex｜熱帶狂燒（差別只在它卡面有 150 傷害）。
regPost('皮卡丘ex|劈哩劈哩夜狂歡', handAttachEnergyPost(99, null, '劈哩劈哩夜狂歡', true));

// 054/103 超夢｜賦予力量 [P] dmg=''：
//   從自己的棄牌區選擇最多2張基本能量卡，附於自己的1隻寶可夢身上。
//   ⚠ 卡面是「附於自己的**1隻**寶可夢身上」＝全部附同一隻（singleTarget），
//     **不是**「以任意方式」（莫魯貝可｜撿拾附上 那一型才可分散）——兩者是不同的規則。
//   ⚠ 範圍是「自己的1隻**寶可夢**」（含戰鬥場），不是 花舞鳥｜能量支援 的「1隻**備戰**寶可夢」。
//   ⚠ 卡面沒有「任意數量／以任意方式／若希望」⇒ optional=false（依 v6.125 的既有判準，
//     與 花舞鳥｜能量支援、怒鸚哥ex｜幹勁十足 相同）。
regPost('超夢|賦予力量', discardEnergyAttachPost(2, null, '賦予力量', false, true));
