/**
 * M6「綠寶石風暴」— 招式實裝 批次 5（v6.067）：5 招
 * 全部復用中央 helper；卡面文字逐字取自 static/cards/M6.json。
 */
import { regPre, regPost, addLog, discardActiveStadium } from '../_shared';
import {
  recruitBasicToBenchPost, forceOppSwapPost, discardOppActiveEnergyPost,
  selfCantAttackNextPost, flipCoinsWithLog,
} from '../../effects';

// 電擊獸｜呼朋引伴 damage=''：從自己的牌庫選擇最多2張【基礎】寶可夢卡，放置於備戰區。並且重洗牌庫。
//   與既有 毒電嬰｜呼朋引伴 卡面逐字相同 → 共用中央 helper（v6.067 抽出）。
regPost('電擊獸|呼朋引伴', recruitBasicToBenchPost(2, '呼朋引伴'));

// 卡蒂狗｜吼叫 damage=''：將對手的戰鬥寶可夢與備戰寶可夢互換。[由對手選擇放置於戰鬥場的寶可夢。]
//   ⚠「[由對手選擇]」＝ gust 的相反方向，走 forceOppSwapPost（既有 月桂葉｜推倒 同措辭）；
//     helper 內含化隱等免疫 gate（v5.837）。
regPost('卡蒂狗|吼叫', forceOppSwapPost('吼叫'));

// 土地雲｜蓋亞粉碎 damage='110'：將場上的競技場卡丟棄。
//   ⚠ 丟的是「場上的」競技場（不分持有者）→ discardActiveStadium 會依 activeStadiumOwnerIdx 丟到正確棄牌區。
regPost('土地雲|蓋亞粉碎', (state, aIdx) => {
  if (!state.activeStadium) return addLog(state, '蓋亞粉碎：場上沒有競技場卡', aIdx);
  return discardActiveStadium(state, aIdx);
});

// 熔蟻獸｜破壞火 damage='30'：擲1次硬幣若為正面，則選擇1個對手的戰鬥寶可夢身上附加的能量，將其丟棄。
//   ⚠ 卡面是「**選擇**1個」→ 走中央 discardOppActiveEnergyPost（picker 由玩家選 + 免疫 gate，v5.973）。
regPost('熔蟻獸|破壞火', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '破壞火', aIdx);
  if (r.heads !== 1) return addLog(r.state, '破壞火：反面 → 無效果', aIdx);
  return discardOppActiveEnergyPost('破壞火', 'any', 1, 'attack-effect')(r.state, aIdx, pool);
});

// 雷公ex｜力量猛攻 damage='200'：擲1次硬幣若為反面，則在下個自己的回合，這隻寶可夢無法使用招式。
//   ⚠「無法使用招式」＝**全部**招式（cantAttackPending），不是只鎖這一招。
regPost('雷公ex|力量猛攻', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '力量猛攻', aIdx);
  if (r.heads === 1) return addLog(r.state, '力量猛攻：正面 → 無副作用', aIdx);
  const s = addLog(r.state, '力量猛攻：反面 → 下個自己的回合無法使用招式', aIdx);
  return selfCantAttackNextPost()(s, aIdx, pool);
});
