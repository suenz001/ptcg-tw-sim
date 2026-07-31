/**
 * M6「綠寶石風暴」— 招式實裝 批次 6（v6.068）：4 招
 * 卡面文字逐字取自 static/cards/M6.json；全部復用中央 helper。
 */
import { regPost, updatePlayer, addLog } from '../_shared';
import { deckSearchToHandPost, selfReturnToHandPost } from '../../effects';

// 鴨嘴火獸｜集力 damage=''：從自己的牌庫選擇最多2張基本能量卡，在給對手看過後加入手牌。並且重洗牌庫。
//   與既有 炭小侍｜集力 卡面逐字相同 → 共用 deckSearchToHandPost（resolver 負責揭示與重洗）。
regPost('鴨嘴火獸|集力', deckSearchToHandPost(2, 'BasicEnergy', '集力'));

// 尼多蘭｜尋找朋友 damage=''：從自己的牌庫選擇1張寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。
//   與既有 木木梟｜尋找朋友 卡面逐字相同（該張用的是 v2359 卡檔內的 local searchToHandFn，
//   本張改走中央 deckSearchToHandPost；守衛同時驗兩張，行為若有差異會被抓出來）。
regPost('尼多蘭|尋找朋友', deckSearchToHandPost(1, 'Pokemon', '尋找朋友'));

// 三蜜蜂｜憑空消失 damage='10'：將這隻寶可夢與附加的卡，全部放回手牌。
//   與既有 喵喵ex｜夾尾巴逃跑 卡面逐字相同 → selfReturnToHandPost
//   （中央版會連同附加的能量／道具一起回手，並走 toBareCard 清掉場上暫時旗標）。
regPost('三蜜蜂|憑空消失', selfReturnToHandPost('憑空消失'));

// 阿利多斯｜隱密針 damage='80'：在下個對手的回合，這隻寶可夢不會受到【基礎】寶可夢招式的傷害。
//   ⚠ 只擋「【基礎】寶可夢」打來的傷害（進化寶可夢照樣打得到），走既有的
//     `immuneToBasicAttackNextTurn` 旗標（範本：超級雷電獸ex｜閃光射線，卡面逐字相同）。
//   ⚠ 只擋**傷害**，不擋效果 —— 與「不會受到招式的傷害與效果」型（immuneToAllAttackNextTurn）不同。
regPost('阿利多斯|隱密針', (state, aIdx) => updatePlayer(
  addLog(state, '隱密針：下個對手回合這隻寶可夢不會受到【基礎】寶可夢招式的傷害', aIdx),
  aIdx, (p) => ({ ...p, active: p.active ? { ...p.active, immuneToBasicAttackNextTurn: true } : null }),
));
