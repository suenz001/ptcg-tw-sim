/**
 * v6.672 M7「波導探求者」招式實裝 —— 批次 1（卡面與站上既有卡逐字相同的招式）
 *
 * ⚠⚠ 卡面文字逐字取自 `static/cards/M7.json`（台灣官方中文），未經簡化。
 * ⚠⚠ 本批**全部復用既有中央 helper**，不新增任何判準（Rule 38）；
 *   每一招旁邊註明它照的是哪一張「卡面逐字相同」的既有卡（scripts/new-set/audit-new-set.mjs 列出的範本）。
 * ⭐ 純效果招式只登記 regPost，傷害交給引擎讀卡面；要改寫傷害的（擲幣／計數）才登記 regPre，
 *   base 參數與卡面印刷逐字相符（scripts/test-fixed-damage-base.mjs 在守）。
 */

import { regPost, regPre } from '../_shared';
import {
  statusPost, coinStatusPost, selfHealPost, selfHitPost, selfCantAttackNextPost,
  coinTailsFailPre, coinPlusPre, coinHeadsMultiplyPre, coinUntilTailsMultiplyPre,
  drawNPost, chooseOppPokemonDamage, deckSearchToHandPost, recruitBasicToBenchPost,
  defNextAtkReducePost, defActiveEnergyMultiplyPre, oppCountersMultiplyPre, defIsExPre,
  millOppDeckTopPost, millSelfDeckTopPost, forceOppSwapPost, coinHeadsSelfImmuneNextPost,
  returnSelfActiveEnergyPost, skipDefEffectsPre, setSelfDamageOverridePendingPost,
  registerSelfDiscardMultiply, selfHandMultiplyPre,
} from '../../effects';

// ── ① 必中狀態 ──────────────────────────────────────────────────────────────
// 008 蜥蜴王ex｜毒之爪 40：將對手的戰鬥寶可夢【中毒】。（範本：滋汁鼴｜毒擊）
regPost('蜥蜴王ex|毒之爪', statusPost('poisoned'));
// 053 晶光芽｜噴毒 10：將對手的戰鬥寶可夢【中毒】。
regPost('晶光芽|噴毒', statusPost('poisoned'));
// 013 九尾｜灼燒 40：將對手的戰鬥寶可夢【灼傷】。（範本：炒炒豬｜火焰灼燒）
regPost('九尾|灼燒', statusPost('burned'));
// 032 美洛耶塔｜蠱惑 30、036 布莉姆溫｜幻象光線 40：將對手的戰鬥寶可夢【混亂】。（範本：烏賊王｜蠱惑）
regPost('美洛耶塔|蠱惑', statusPost('confused'));
regPost('布莉姆溫|幻象光線', statusPost('confused'));

// ── ② 擲幣狀態 ──────────────────────────────────────────────────────────────
// 015 卡咪龜｜泡沫光線 50：擲1次硬幣若為正面，則將對手的戰鬥寶可夢【麻痺】。（範本：傑尼龜｜泡沫）
regPost('卡咪龜|泡沫光線', coinStatusPost('paralyzed'));

// ── ③ 自我恢復 ──────────────────────────────────────────────────────────────
// 003 大食花｜綠葉吸取 120：將這隻寶可夢恢復「30」HP。（範本：波克基古｜吸取之吻）
regPost('大食花|綠葉吸取', selfHealPost(30, '綠葉吸取'));

// ── ④ 自傷「奮勇戰鬥」：這隻寶可夢也受到20點傷害。（範本：毒骷蛙｜突擊）──────────
//   ⚠ 代價型招式：不實裝＝卡比實體卡強。四張卡同招名、印刷傷害各自交給引擎讀卡面。
regPost('恰雷姆|奮勇戰鬥', selfHitPost(20, '奮勇戰鬥'));
regPost('怪力|奮勇戰鬥', selfHitPost(20, '奮勇戰鬥'));
regPost('戰舞郎|奮勇戰鬥', selfHitPost(20, '奮勇戰鬥'));
regPost('投摔鬼|奮勇戰鬥', selfHitPost(20, '奮勇戰鬥'));

// ── ⑤ 鎖招：在下個自己的回合，這隻寶可夢無法使用招式。（範本：巨石丁｜潛力）──────
regPost('超級晶光花ex|大迴轉', selfCantAttackNextPost());
regPost('老翁龍|潛力', selfCantAttackNextPost());
// 059 托戈德瑪爾ex｜全力尖刺 180：在下個自己的回合，這隻寶可夢「全力尖刺」的傷害改為「60」點。
//   （同句型範本：步哨鼠｜聚氣「…『必殺門牙』的傷害改為『240』點」⇒ 中央 setSelfDamageOverridePendingPost）
regPost('托戈德瑪爾ex|全力尖刺', setSelfDamageOverridePendingPost(60, '全力尖刺', '全力尖刺'));

// ── ⑥ 擲幣改寫傷害 ──────────────────────────────────────────────────────────
// 010 小嘴蝸｜偷襲 30：擲1次硬幣若為反面，則這個招式失敗。（範本：炎兔兒｜踹）
regPre('小嘴蝸|偷襲', coinTailsFailPre(30, '偷襲'));
// 012 六尾｜連續舞步 20×：擲硬幣直到出現反面，造成正面出現的次數×20點傷害。
//   （範本：皮卡丘｜鐵尾；⚠ 參數順序是 (perHead, base)）
regPre('六尾|連續舞步', coinUntilTailsMultiplyPre(20, 0, '連續舞步'));
// 035 提布莉姆｜二連巴掌 30×：擲2次硬幣，造成正面出現的次數×30點傷害。（範本：變澀蜥｜二連撞）
regPre('提布莉姆|二連巴掌', coinHeadsMultiplyPre(2, 30, '二連巴掌'));
// 040 戰舞郎｜亂踢 10×：擲3次硬幣，造成正面出現的次數×10點傷害。（範本：咕咕｜三次撞）
regPre('戰舞郎|亂踢', coinHeadsMultiplyPre(3, 10, '亂踢'));
// 071 變隱龍｜伏擊 60+：擲1次硬幣若為正面，則增加60點傷害。（同句型：皮卡丘｜嬉鬧 coinPlusPre）
regPre('變隱龍|伏擊', coinPlusPre(60, 60, '伏擊'));
// 006 木守宮｜躲藏：擲1次硬幣若為正面，則在下個對手的回合，這隻寶可夢不會受到招式的傷害與效果的影響。
//   （範本：櫻花寶｜躲藏 coinHeadsSelfImmuneNextPost，'all'＝傷害與效果）
regPost('木守宮|躲藏', coinHeadsSelfImmuneNextPost('躲藏'));

// ── ⑦ 計數傷害（逐字同既有卡）────────────────────────────────────────────────
// 005 遠古巨蜓｜傷害律動 20×：造成對手的戰鬥寶可夢身上放置的傷害指示物的數量×20點傷害。（範本：脫殼忍者｜傷害律動）
regPre('遠古巨蜓|傷害律動', oppCountersMultiplyPre(0, 20, '傷害律動'));
// 027 天然鳥｜精神強念 20+：增加對手的戰鬥寶可夢身上附加的能量的數量×40點傷害。（範本：夢幻｜精神強念；能量以單位計）
regPre('天然鳥|精神強念', defActiveEnergyMultiplyPre(20, 40, 'all', '精神強念'));
// 057 超級路卡利歐Zex｜舞力拳 120+：若對手的戰鬥寶可夢為「寶可夢【ex】」，則增加120點傷害。
//   ⚠ 卡面只寫【ex】（沒有【V】）⇒ alsoV 不傳。
regPre('超級路卡利歐Zex|舞力拳', defIsExPre(120, 120, '舞力拳'));
// 070 貓老大｜貪慾斬 20×：造成自己的手牌的張數×20點傷害。
regPre('貓老大|貪慾斬', selfHandMultiplyPre(0, 20, '貪慾斬'));

// ── ⑧ 抽牌／檢索／召喚 ──────────────────────────────────────────────────────
// 023 布撥｜快速抽出 30：從自己的牌庫抽出1張卡。（範本：拉魯拉絲｜呼喚）
regPost('布撥|快速抽出', drawNPost(1, '快速抽出'));
// 001 喇叭芽｜尋找朋友：從自己的牌庫選擇1張寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。（範本：尼多蘭｜尋找朋友）
regPost('喇叭芽|尋找朋友', deckSearchToHandPost(1, 'Pokemon', '尋找朋友'));
// 019 泳圈鼬｜引路：從自己的牌庫選擇1張支援者卡，在給對手看過後加入手牌。並且重洗牌庫。（範本：超音蝠｜引路）
regPost('泳圈鼬|引路', deckSearchToHandPost(1, 'Supporter', '引路'));
// 032 美洛耶塔｜歡迎曲：從自己的牌庫選擇最多3張【基礎】寶可夢卡，放置於備戰區。並且重洗牌庫。
//   （同句型範本：電擊獸｜呼朋引伴「最多2張」⇒ recruitBasicToBenchPost）
regPost('美洛耶塔|歡迎曲', recruitBasicToBenchPost(3, '歡迎曲'));

// ── ⑨ 牌庫丟棄 ──────────────────────────────────────────────────────────────
// 041 大顎蟻｜嚼山 20：將對手的牌庫上方1張卡丟棄。（範本：花岩怪｜崩山）
regPost('大顎蟻|嚼山', millOppDeckTopPost(1, '嚼山'));
// 065 圓陸鯊｜龍之波動 40：將自己的牌庫上方1張卡丟棄。（範本：黏美龍｜龍之波動）
regPost('圓陸鯊|龍之波動', millSelfDeckTopPost(1, '龍之波動'));
// 066 尖牙陸鯊｜龍之波動 90：將自己的牌庫上方2張卡丟棄。（範本：暴飛龍ex｜龍之波動）
regPost('尖牙陸鯊|龍之波動', millSelfDeckTopPost(2, '龍之波動'));

// ── ⑩ 減傷／換位／能量 ──────────────────────────────────────────────────────
// 026 天然雀｜恐怖視線：在下個對手的回合，受到這個招式的寶可夢使用招式的傷害「-30」點。（範本：尼多蘭｜叫聲）
regPost('天然雀|恐怖視線', defNextAtkReducePost(30, '恐怖視線'));
// 014 傑尼龜｜噴水攻擊：對手的1隻寶可夢受到10點傷害。[在備戰區不計算弱點・抵抗力。]
//   ⚠「1隻**寶可夢**」含戰鬥場 ⇒ chooseOppPokemonDamage（範本：皮卡丘｜瞄準電光）
regPost('傑尼龜|噴水攻擊', (state, aIdx) => chooseOppPokemonDamage(state, aIdx, 10, '噴水攻擊'));
// 045 投摔鬼｜巴投 20：將對手的戰鬥寶可夢與備戰寶可夢互換。[由對手選擇放置於戰鬥場的寶可夢。]（範本：頭蓋龍｜推倒）
regPost('投摔鬼|巴投', forceOppSwapPost('巴投'));
// 031 象徵鳥ex｜能量旋風 140：選擇1個這隻寶可夢身上附加的能量，改附於備戰寶可夢身上。（範本：鐵荊棘ex｜伏特旋風）
regPost('象徵鳥ex|能量旋風', returnSelfActiveEnergyPost(1, false, '能量旋風'));
// 067 超級烈咬陸鯊Zex｜音波刀鋒 240：這個招式的傷害不計算對手的戰鬥寶可夢身上的附加效果。（範本：N的捷克羅姆｜撕裂）
regPre('超級烈咬陸鯊Zex|音波刀鋒', skipDefEffectsPre(240, '音波刀鋒'));

// ── ⑪ 選擇 N 個自身能量丟棄（代價）——玩家選丟哪個（picker），與 SELF_DISCARD_UNITS_BATCH 同一支 ──
// 047 列陣兵｜強力攻擊 120：選擇1個這隻寶可夢身上附加的能量，將其丟棄。
registerSelfDiscardMultiply('列陣兵|強力攻擊', '強力攻擊', 120, 0, 1, 'all', false, 1);
// 062 拖拖蚓｜粉碎頭擊 130：選擇2個這隻寶可夢身上附加的能量，將其丟棄。（範本：頓甲｜粉碎頭擊）
registerSelfDiscardMultiply('拖拖蚓|粉碎頭擊', '粉碎頭擊', 130, 0, 2, 'all', false, 2);
