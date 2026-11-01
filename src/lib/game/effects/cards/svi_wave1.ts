/**
 * SVI「Trianers Camp」（H 標）— 招式實裝（v6.616）
 *
 * 站長 2026-11-01：「H i j標的話都要收」「只有h i j標要收 收之前，先確認是不是h i j標！」
 * ⇒ 逐張看卡圖左下角：只收卡圖印 H 的 58 張（寶可夢 53＋西餐廚師＋野餐女孩×4）；
 *   印 G 的訓練家與無標記的基本能量不收（官網標記欄位把它們標成 I／J，不可信）。
 * 寶可夢 53 隻：39 隻與站上既有印刷同名同卡面（reg key 是「卡名｜招式名」，進 DB 即自動生效）；
 * 14 隻是站上沒有的卡面（招式不同；逐張看過卡圖），其中有效果的招式只有下面 6 招，
 * **全部**與站上既有卡的措辭逐字相同（`static/cards` attacks[].effect 實查），一律指向既有中央 helper（Rule 38）；
 * 其餘的招式都沒有效果文字（純傷害，引擎讀 attack.damage）。
 *
 * ⭐ 純加效果的招式只註冊 regPost（印刷傷害由引擎讀卡資料）；×N／+N 型才走 regPre。
 * 卡面文字全部逐字取自 static/cards/SVI.json（台灣官方中文）。
 */

import { regPre, regPost } from '../_shared';
import {
  coinStatusPost,              // 「擲1次硬幣若為正面，則將對手的戰鬥寶可夢【X】。」
  chooseOppPokemonDamage,      // 「對手的1隻寶可夢受到N點傷害。[在備戰區不計算弱點・抵抗力。]」
  coinHeadsMultiplyPre,        // 「擲N次硬幣，造成正面出現的次數×M點傷害。」
  defIsExPre,                  // 「若對手的戰鬥寶可夢為「寶可夢【ex】」，則增加N點傷害。」
  discardBasicEnergyToBenchPost, // 「從自己的棄牌區選擇1張基本能量卡，附於備戰寶可夢身上。」
  discardOppActiveEnergyPost,  // 「選擇1個對手的戰鬥寶可夢身上附加的能量，將其丟棄。」
  flipCoinsWithLog,
} from '../../effects';
import { addLog } from '../_shared';

// 1. 瑪力露麗｜泡沫光線 `60`：「擲1次硬幣若為正面，則將對手的戰鬥寶可夢【麻痺】。」
//    ⇒ 與 傑尼龜｜泡沫、強顎雞母蟲｜吐絲 等既有 key 逐字相同。
regPost('瑪力露麗|泡沫光線', coinStatusPost('paralyzed'));

// 2. 布撥｜瞄準電光（無傷害）：「對手的1隻寶可夢受到20點傷害。[在備戰區不計算弱點・抵抗力。]」
//    ⇒ 與 皮卡丘｜瞄準電光（M6a）逐字相同。
regPost('布撥|瞄準電光', (state, aIdx) => chooseOppPokemonDamage(state, aIdx, 20, '瞄準電光'));

// 3. 恰雷姆｜雙重粉碎 `40×`：「擲2次硬幣，造成正面出現的次數×40點傷害。」
//    ⇒ 與 雙首暴龍｜二連擊、力壯雞｜二連踢 逐字相同。
regPre('恰雷姆|雙重粉碎', coinHeadsMultiplyPre(2, 40, '雙重粉碎'));

// 4. 故勒頓｜覺悟之牙 `50+`：「若對手的戰鬥寶可夢為「寶可夢【ex】」，則增加70點傷害。」
//    ⇒ 卡面只寫「寶可夢【ex】」（不含【V】）⇒ alsoV 不傳（同 無極汰那｜汰那爆破）。
regPre('故勒頓|覺悟之牙', defIsExPre(50, 70, '覺悟之牙'));

// 5. 基拉祈｜充溢祈願（無傷害）：「從自己的棄牌區選擇1張基本能量卡，附於備戰寶可夢身上。」
//    ⇒ 與 多麗米亞｜能量支援 逐字相同（v6.616 把那段抽成中央 discardBasicEnergyToBenchPost）。
regPost('基拉祈|充溢祈願', discardBasicEnergyToBenchPost('充溢祈願'));

// 6. 肯泰羅｜破壞之角 `70`：「擲1次硬幣若為正面，則選擇1個對手的戰鬥寶可夢身上附加的能量，將其丟棄。」
//    ⇒ 與 藍鱷｜咬碎、鐵蟻｜咬碎 等逐字相同（正面 → 中央 discardOppActiveEnergyPost：攻擊方選擇＋免疫 gate）。
regPost('肯泰羅|破壞之角', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '破壞之角', aIdx);
  if (!r.heads) return r.state;
  return discardOppActiveEnergyPost('破壞之角', 'any')(addLog(r.state, '破壞之角：正面', aIdx), aIdx, pool);
});
