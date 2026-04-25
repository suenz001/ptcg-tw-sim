/**
 * 內建測試牌組
 *
 * 這些是官方預組牌組（MBG / MBD）的固定 60 張構成，
 * 用來在本機對戰時方便測試，不需要手動建立牌組。
 *
 * 牌組會在首次進入遊戲時自動寫入 localStorage，
 * 之後與一般使用者牌組並存。
 */

import type { Deck } from './types';

/** 超級耿鬼ex 預組牌組（MBG，60 張） */
const GENGAR_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_mbg__',
  name: '超級耿鬼ex（預組）',
  entries: [
    // ── 寶可夢 ──
    { cardId: '14129', count: 4 }, // 鬼斯
    { cardId: '14130', count: 2 }, // 鬼斯通
    { cardId: '14151', count: 1 }, // 鬼斯通（全圖插畫）
    { cardId: '14131', count: 2 }, // 超級耿鬼ex
    { cardId: '14132', count: 2 }, // 黑暗鴉
    { cardId: '14133', count: 1 }, // 烏鴉頭頭
    { cardId: '14134', count: 2 }, // 勾魂眼
    { cardId: '14135', count: 1 }, // 阿勃梭魯
    { cardId: '14136', count: 1 }, // 無極汰那
    { cardId: '14137', count: 1 }, // 桃歹郎ex
    { cardId: '14138', count: 1 }, // 米立龍
    // ── 訓練家 ──
    { cardId: '14139', count: 3 }, // 好友寶芬
    { cardId: '14140', count: 4 }, // 高級球
    { cardId: '14141', count: 3 }, // 神奇糖果
    { cardId: '14142', count: 1 }, // 頂尖捕捉器
    { cardId: '14143', count: 1 }, // 寶可夢交替
    { cardId: '14144', count: 1 }, // 超級信號
    { cardId: '14145', count: 1 }, // 夜間擔架
    { cardId: '14146', count: 2 }, // 龐克頭盔（寶可夢道具）
    { cardId: '14147', count: 2 }, // 氣球（寶可夢道具）
    { cardId: '14148', count: 4 }, // 艾莉絲的鬥志
    { cardId: '14149', count: 2 }, // 老大的指令
    { cardId: '14150', count: 4 }, // 莉莉艾的決意
    // ── 能量 ──
    { cardId: '14152', count: 14 }, // 基本【惡】能量
  ],
};

/** 超級蒂安希ex 預組牌組（MBD，60 張） */
const DIANCIE_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_mbd__',
  name: '超級蒂安希ex（預組）',
  entries: [
    // ── 寶可夢 ──
    { cardId: '14105', count: 2 }, // 布魯
    { cardId: '14106', count: 1 }, // 布魯皇
    { cardId: '14107', count: 1 }, // 拉帝亞斯ex
    { cardId: '14108', count: 1 }, // 克雷色利亞
    { cardId: '14109', count: 1 }, // 美洛耶塔
    { cardId: '14127', count: 1 }, // 美洛耶塔（全圖插畫）
    { cardId: '14110', count: 2 }, // 超級蒂安希ex
    { cardId: '14111', count: 1 }, // 謎擬Q
    { cardId: '14112', count: 3 }, // 小仙奶
    { cardId: '14113', count: 3 }, // 霜奶仙
    { cardId: '14114', count: 1 }, // 米立龍
    // ── 訓練家 ──
    { cardId: '14115', count: 1 }, // 不公印章
    { cardId: '14116', count: 1 }, // 能量回收器
    { cardId: '14117', count: 3 }, // 好友寶芬
    { cardId: '14118', count: 4 }, // 高級球
    { cardId: '14119', count: 1 }, // 超級信號
    { cardId: '14120', count: 1 }, // 夜間擔架
    { cardId: '14121', count: 4 }, // 奇跡修正檔
    { cardId: '14122', count: 2 }, // 氣球（寶可夢道具）
    { cardId: '14123', count: 4 }, // 艾莉絲的鬥志
    { cardId: '14124', count: 2 }, // 老大的指令
    { cardId: '14125', count: 4 }, // 莉莉艾的決意
    { cardId: '14126', count: 2 }, // 神秘花園（競技場）
    // ── 能量 ──
    { cardId: '14128', count: 14 }, // 基本【超】能量
  ],
};

/**
 * 竹蘭的烈咬陸鯊EX 牌組（Wave 42 — JP meta 引入）
 *
 * 以日本賽事 meta deck「シロナのガブリアスex」為藍本，
 * 透過 setCode + collectorNumber 對應到台版卡牌資料。
 * 主力：羅絲雷朵「輝煌聲援」+30 加成 + 烈咬陸鯊ex「龍之爆發」高傷一波流。
 */
const CYNTHIA_GARCHOMP_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_cynthia_garchomp__',
  name: '竹蘭的烈咬陸鯊EX',
  entries: [
    // ── 寶可夢（19 張）──
    { cardId: '12702', count: 3 },  // <竹蘭的>烈咬陸鯊ex (SV9a)
    { cardId: '14749', count: 4 },  // 竹蘭的尖牙陸鯊 (M2a)
    { cardId: '14748', count: 4 },  // 竹蘭的圓陸鯊 (M2a)
    { cardId: '12663', count: 3 },  // <竹蘭的>羅絲雷朵 (SV9a)
    { cardId: '16503', count: 3 },  // 竹蘭的毒薔薇 (MC)
    { cardId: '12708', count: 1 },  // <竹蘭的>花岩怪 (SV9a)
    { cardId: '11526', count: 1 },  // 含羞苞 (SV8a)
    // ── 訓練家（34 張）──
    { cardId: '17123', count: 4 },  // 力量蛋白飲 (MC)
    { cardId: '17125', count: 4 },  // 戰鬥鑼 (MC)
    { cardId: '10300', count: 1 },  // 不公印章 (SV5a)
    { cardId: '11672', count: 4 },  // 好友寶芬 (SV8a)
    { cardId: '17133', count: 4 },  // 寶可平板 (MC)
    { cardId: '11676', count: 1 },  // 夜間擔架 (SV8a)
    { cardId: '12718', count: 3 },  // 竹蘭的力量負重 (SV9a · 道具)
    { cardId: '12720', count: 3 },  // 裁判 (SV9a)
    { cardId: '17195', count: 3 },  // 老大的指令 (MC)
    { cardId: '17200', count: 4 },  // 莉莉艾的決意 (MC)
    { cardId: '12844', count: 3 },  // 火箭隊的拉姆達 (SV10)
    // ── 能量（7 張）──
    { cardId: '17215', count: 4 },  // 基本【鬥】能量 (MC)
    { cardId: '18057', count: 3 },  // 硬岩【鬥】能量 (M3 · 特殊能量)
  ],
};

/**
 * 魔靈多龍 牌組（Wave 43 — JP meta 引入）
 *
 * 日本賽事 meta「ヨノワール + ドラパルトex」軸：
 * - 主力：多龍巴魯托ex「幻影奇襲」200 + 對手備戰 2 隻 50 snipe
 * - 引擎：黑夜魔靈「咒詛炸彈」特性（自身昏厥 + 對手 1 隻放 13 counter ≈ 130 傷害）
 * - 輔助：願增猿「腎上腺腦力」（需 惡 能量，轉移傷害）
 *        喵喵ex「殺手鐧捕捉」（上備戰時 tutor 支援者）
 *        吉雉雞ex「扭轉乾坤」（自場寶可夢昏厥後抽 3）
 *
 * v2.14 (Session 38bb)：依 Leon 用新預組檢視器對過的完整卡表修正。
 *   - 寶可夢：多龍奇 2→4、夜巡靈 2→1、彷徨夜靈 2 不變、黑夜魔靈 2→1
 *   - 物品：移除 莉莉艾的珍珠（不在真實卡表）
 *   - 支援者：移除 阿蜜的目光/裁判；加入 鳴依的勉勵 × 1、探險家的嚮導 × 1
 *   - 競技場：移除 月光丘陵；加入 火箭隊的監視塔 × 2（總 3 張）
 *   - 能量：不變（火 3 / 超 3 / 惡 2）
 *   總張數：60 張
 */
const MARRUNE_DRAGAPULT_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_marrune_dragapult__',
  name: '魔靈多龍',
  entries: [
    // ── 寶可夢（20 張）──
    { cardId: '16960', count: 1 },  // 吉雉雞ex (MC) — 扭轉乾坤
    { cardId: '17019', count: 3 },  // 多龍巴魯托ex (MC)
    { cardId: '17018', count: 4 },  // 多龍奇 (MC) — 偵查指令
    { cardId: '17017', count: 4 },  // 多龍梅西亞 (MC)
    { cardId: '11526', count: 1 },  // 含羞苞 (SV8a) — 迷幻花粉
    { cardId: '16780', count: 2 },  // 彷徨夜靈 (MC) — 咒詛炸彈 5 counter
    { cardId: '16779', count: 1 },  // 夜巡靈 (MC)
    { cardId: '18038', count: 2 },  // 喵喵ex (M3) — 殺手鐧捕捉（受火箭隊監視塔影響）
    { cardId: '16781', count: 1 },  // 黑夜魔靈 (MC) — 咒詛炸彈 13 counter
    { cardId: '16829', count: 1 },  // 願增猿 (MC) — 腎上腺腦力
    // ── 訓練家・物品（15 張）──
    { cardId: '17104', count: 1 },  // 不公印章 (MC)
    { cardId: '17141', count: 2 },  // 夜間擔架 (MC)
    { cardId: '18492', count: 1 },  // 特殊紅牌 (M4)
    { cardId: '17126', count: 3 },  // 神奇糖果 (MC)
    { cardId: '17122', count: 4 },  // 高級球 (MC)
    { cardId: '17133', count: 4 },  // 寶可平板 (MC)
    // ── 訓練家・支援者（14 張）──
    { cardId: '18052', count: 1 },  // 鳴依的勉勵 (M3) — 棄牌能量附 Stage2
    { cardId: '17193', count: 1 },  // 白蕾雅 (MC)
    { cardId: '17119', count: 4 },  // 好友寶芬 (MC)
    { cardId: '17195', count: 2 },  // 老大的指令 (MC)
    { cardId: '17167', count: 1 },  // 赤松 (MC)
    { cardId: '17200', count: 4 },  // 莉莉艾的決意 (MC)
    { cardId: '17188', count: 1 },  // 探險家的嚮導 (MC) — 看 top 6 選 2
    // ── 競技場（3 張）──
    { cardId: '11706', count: 1 },  // 阻礙之塔 (SV8a) — 道具無效
    { cardId: '12846', count: 2 },  // 火箭隊的監視塔 (SV10) — 【無】寶可夢特性無效
    // ── 能量（8 張）──
    { cardId: '17216', count: 3 },  // 基本【火】能量 (MC)
    { cardId: '17214', count: 2 },  // 基本【惡】能量 (MC)
    { cardId: '17220', count: 3 },  // 基本【超】能量 (MC)
  ],
};

/**
 * 胡地 牌組（v2.21 原建 — v2.36 修正 土龍節節ex → 土龍節節）
 *
 * 軸心：凱西 → 勇基拉 → 胡地（M1S，特性「精神抽出」+ 招式「手之力量」）
 *        依序進化爬上去；土龍節節（非 ex）作為 Colorless 副線打點（HP 140、
 *        大地粉碎 90、特性「逃跑抽出」— 當戰鬥寶可夢退場時下一隻 drawCards 1）。
 * 引擎：鬥子（MC）+ 小光 + 水蓮的照顧 作為支援者循環；
 *        吉雉雞ex「扭轉乾坤」自場寶可夢昏厥後補手；
 *        謝米/可達鴨作為 bench 支援。
 * ACE SPEC：富裕能量（MC）附在主力胡地上觸發加乘。
 */
const ALAKAZAM_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_alakazam__',
  name: '胡地',
  entries: [
    // ── 寶可夢（21 張）──
    { cardId: '14056', count: 4 },  // 凱西 (M1S)
    { cardId: '14057', count: 4 },  // 勇基拉 (M1S)
    { cardId: '14058', count: 4 },  // 胡地 (M1S) — 特性精神抽出、招式手之力量
    { cardId: '17045', count: 3 },  // 土龍弟弟 (MC)
    { cardId: '11655', count: 3 },  // 土龍節節 (SV8a) — 非 ex 版；4 張效果相同，任選其一
    { cardId: '14692', count: 1 },  // 可達鴨 (M2a) — 特性濕氣
    { cardId: '16255', count: 1 },  // 謝米 (M2a 012/193) — 特性花之帷幔（備戰免招式傷害）
    { cardId: '16960', count: 1 },  // 吉雉雞ex (MC) — 扭轉乾坤
    // ── 訓練家・物品（16 張）──
    { cardId: '17119', count: 4 },  // 好友寶芬 (MC)
    { cardId: '17133', count: 3 },  // 寶可平板 (MC)
    { cardId: '17126', count: 3 },  // 神奇糖果 (MC)
    { cardId: '17141', count: 2 },  // 夜間擔架 (MC)
    { cardId: '14808', count: 2 },  // 改造之錘 (M2a)
    { cardId: '18492', count: 1 },  // 特殊紅牌 (M4)
    { cardId: '18407', count: 1 },  // 奇跡修正檔 (M3)
    // ── 訓練家・支援者（12 張）──
    { cardId: '14395', count: 3 },  // 小光 (M2)
    { cardId: '17189', count: 4 },  // 鬥子 (MC)
    { cardId: '17195', count: 3 },  // 老大的指令 (MC)
    { cardId: '17183', count: 1 },  // 水蓮的照顧 (MC)
    { cardId: '12278', count: 1 },  // 枇琶 (SV8a)
    // ── 競技場（4 張）──
    { cardId: '14397', count: 4 },  // 對戰圓形競技場 (M2)
    // ── 能量（7 張）──
    { cardId: '17211', count: 1 },  // 富裕能量 ACE SPEC (MC)
    { cardId: '18056', count: 4 },  // 感應【超】能量 (M3)
    { cardId: '17220', count: 2 },  // 基本【超】能量 (MC)
  ],
};

/**
 * 瑪俐的長毛巨魔ex 牌組（v2.21 — Leon 自選卡表）
 *
 * SVOM 主打組「瑪俐的莫魯貝可&長毛巨魔ex」為軸：
 *   - 瑪俐的搗蛋小妖 → 瑪俐的詐唬魔 → 瑪俐的長毛巨魔ex（Stage2 線）
 *   - 雪童子 → 雪妖女（副軸壓場）
 *   - 願增猿「腎上腺腦力」 + 伊裴爾塔爾 打 spread/tempo
 * ACE SPEC：不公印章（MC）
 * 場地：尖釘鎮道館（SVOM）
 */
const MARNIE_SCRAFTY_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_marnie_scrafty__',
  name: '瑪俐的長毛巨魔ex',
  entries: [
    // ── 寶可夢（20 張）──
    { cardId: '12610', count: 3 },  // <瑪俐的>長毛巨魔ex (SVOM)
    { cardId: '12609', count: 2 },  // <瑪俐的>詐唬魔 (SVOM)
    { cardId: '12608', count: 3 },  // <瑪俐的>搗蛋小妖 (SVOM)
    { cardId: '10445', count: 2 },  // 雪童子 (SV6)
    { cardId: '10447', count: 2 },  // 雪妖女 (SV6)
    { cardId: '16829', count: 3 },  // 願增猿 (MC) — 腎上腺腦力
    { cardId: '11526', count: 1 },  // 含羞苞 (SV8a)
    { cardId: '16951', count: 1 },  // 伊裴爾塔爾 (MC)
    { cardId: '17020', count: 1 },  // 米立龍 (MC)
    { cardId: '14692', count: 1 },  // 可達鴨 (M2a) — 特性濕氣
    { cardId: '17980', count: 1 },  // 謝米 (M3)
    // ── 訓練家・物品（15 張）──
    { cardId: '17119', count: 3 },  // 好友寶芬 (MC)
    { cardId: '17133', count: 4 },  // 寶可平板 (MC)
    { cardId: '17126', count: 3 },  // 神奇糖果 (MC)
    { cardId: '17141', count: 2 },  // 夜間擔架 (MC)
    { cardId: '18492', count: 1 },  // 特殊紅牌 (M4)
    { cardId: '17104', count: 1 },  // 不公印章 ACE SPEC (MC)
    { cardId: '17159', count: 1 },  // 氣球 (MC)
    // ── 訓練家・支援者（12 張）──
    { cardId: '17200', count: 4 },  // 莉莉艾的決意 (MC)
    { cardId: '17205', count: 4 },  // 火箭隊的拉姆達 (MC)
    { cardId: '17195', count: 4 },  // 老大的指令 (MC)
    // ── 競技場（4 張）──
    { cardId: '12624', count: 4 },  // 尖釘鎮道館 (SVOM)
    // ── 能量（9 張）──
    { cardId: '17214', count: 9 },  // 基本【惡】能量 (MC)
  ],
};

/**
 * 火箭隊的超夢ex 牌組（v2.35 — Leon 自選卡表）
 *
 * SV10「火箭隊」系列 meta deck，軸心：
 *   - 火箭隊的團珠蛛（Basic）→ 火箭隊的操陷蛛（Stage1）打能量加速／抽牌
 *   - 火箭隊的超夢ex 主打 ace，由團珠蛛／操陷蛛鋪出的能量組打高傷
 *   - 火箭隊的急凍鳥 作為副 ace（免能量偷勝／水牆）
 *   - 莉莉艾的皮皮ex 做備戰 bench tutor／補資源
 *   - 火箭隊的謎擬Ｑ 作為專門對策或撥亂反正
 * 支援者：火箭隊團伙（雅典娜／蘭斯／坂木／阿波羅／拉姆達）抽牌＆場控迴轉
 * 場地：火箭隊的工廠（SV10，壓制對手補資源）
 * ACE SPEC：極限腰帶（ex 多 +50 傷害）
 */
const ROCKET_MEWTWO_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_rocket_mewtwo__',
  name: '火箭隊的超夢ex',
  entries: [
    // ── 寶可夢（15 張）──
    { cardId: '16761', count: 2 }, // <火箭隊的>超夢ex (MC)
    { cardId: '14675', count: 4 }, // <火箭隊的>團珠蛛 (M2a)
    { cardId: '14676', count: 4 }, // <火箭隊的>操陷蛛 (M2a)
    { cardId: '16812', count: 2 }, // <火箭隊的>謎擬Ｑ (MC)
    { cardId: '14694', count: 2 }, // <火箭隊的>急凍鳥 (M2a)
    { cardId: '16758', count: 1 }, // <莉莉艾的>皮皮ex (MC)
    // ── 訓練家・物品（15 張）──
    { cardId: '17122', count: 4 }, // 高級球 (MC)
    { cardId: '17146', count: 4 }, // 火箭隊的接收器 (MC)
    { cardId: '17138', count: 3 }, // 捕蟲組合 (MC)
    { cardId: '17141', count: 2 }, // 夜間擔架 (MC)
    { cardId: '17133', count: 1 }, // 寶可平板 (MC)
    { cardId: '17109', count: 1 }, // 能量轉移 (MC)
    // ── 寶可夢道具（2 張）──
    { cardId: '11029', count: 1 }, // 勇氣護符 (SV7)
    { cardId: '17162', count: 1 }, // 極限腰帶 ACE SPEC (MC)
    // ── 訓練家・支援者（14 張）──
    { cardId: '17202', count: 2 }, // 火箭隊的雅典娜 (MC)
    { cardId: '17206', count: 3 }, // 火箭隊的蘭斯 (MC)
    { cardId: '17204', count: 3 }, // 火箭隊的坂木 (MC)
    { cardId: '17203', count: 2 }, // 火箭隊的阿波羅 (MC)
    { cardId: '17205', count: 1 }, // 火箭隊的拉姆達 (MC)
    { cardId: '17200', count: 3 }, // 莉莉艾的決意 (MC)
    // ── 競技場（3 張）──
    { cardId: '12847', count: 3 }, // 火箭隊的工廠 (SV10)
    // ── 能量（11 張）──
    { cardId: '17217', count: 7 }, // 基本【草】能量 (MC)
    { cardId: '17213', count: 4 }, // 火箭隊能量 (MC)
  ],
};

/**
 * 猛雷鼓ex 牌組（v2.35 — Leon 自選卡表）
 *
 * SV5K「豪華浪漫的猛雷鼓ex」系列，軸心：
 *   - 猛雷鼓ex（Basic・3 屬能量「豐盈節奏」，棄基本草／雷／鬥能量一張造傷）
 *   - 厄鬼椪 碧草面具ex（Basic・草・特性「活力果實」：附能量時每回合只 1 次，
 *     自己一隻寶可夢回復 30 HP）作副軸穩盤
 *   - 吉雉雞ex「扭轉乾坤」自場寶可夢昏厥後抽 3 張
 *   - 故勒頓（Basic・鬥）太晶／打點補強
 * ACE SPEC：不公印章（MC）
 * 引擎：赤松 + 莉莉艾的決意 雙支援者循環；寶可裝置3.0 抽牌；寶可夢捕捉器 switch。
 */
const THUNDER_DRUM_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_thunder_drum__',
  name: '猛雷鼓ex',
  entries: [
    // ── 寶可夢（10 張）──
    { cardId: '17025', count: 4 }, // 猛雷鼓ex (MC)
    { cardId: '16553', count: 4 }, // 厄鬼椪 碧草面具ex (MC)
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC)
    { cardId: '17021', count: 1 }, // 故勒頓 (MC)
    // ── 訓練家・物品（20 張）──
    { cardId: '17122', count: 4 }, // 高級球 (MC)
    { cardId: '14812', count: 2 }, // 太晶珠 (M2a)
    { cardId: '17107', count: 2 }, // 能量回收 (MC)
    { cardId: '17131', count: 3 }, // 寶可裝置3.0 (MC)
    { cardId: '17138', count: 4 }, // 捕蟲組合 (MC)
    { cardId: '17136', count: 4 }, // 寶可夢捕捉器 (MC)
    { cardId: '17104', count: 1 }, // 不公印章 ACE SPEC (MC)
    // ── 訓練家・支援者（8 張）──
    { cardId: '17167', count: 4 }, // 赤松 (MC)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC)
    // ── 能量（22 張）──
    { cardId: '17217', count: 12 }, // 基本【草】能量 (MC)
    { cardId: '17218', count: 5 },  // 基本【雷】能量 (MC)
    { cardId: '17215', count: 5 },  // 基本【鬥】能量 (MC)
  ],
};

/**
 * 呆呆王牌組（Leon 自選卡表）
 *
 * 主力：呆呆王｜耀閃挑戰（從牌庫頂丟一張寶可夢，使用其招式）+ 超級袋獸ex
 * 的 使者衝刺 特性 + 拉帝亞斯ex / 吉雉雞ex / 喵喵ex / 莉莉艾的皮皮ex 等
 * Basic ex 副力。夜間學院 強化手牌控制。
 */
const SLOWKING_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_slowking__',
  name: '呆呆王',
  entries: [
    // ── 寶可夢（21 張）──
    { cardId: '18072', count: 4 }, // 呆呆獸 (M-P 憨憨臉)
    { cardId: '10934', count: 3 }, // 呆呆王 (SV7)
    { cardId: '14071', count: 3 }, // 超級袋獸ex (M1S)
    { cardId: '16783', count: 2 }, // 拉帝亞斯ex (MC)
    { cardId: '16758', count: 1 }, // 莉莉艾的皮皮ex (MC)
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC)
    { cardId: '18038', count: 1 }, // 喵喵ex (M3)
    { cardId: '10629', count: 2 }, // 酋雷姆 (SV6a)
    { cardId: '18479', count: 2 }, // 巨金怪 (M4 059/083)
    { cardId: '14740', count: 1 }, // 靈幽馬 (M2a)
    { cardId: '11526', count: 1 }, // 含羞苞 (SV8a)
    // ── 訓練家・物品（17 張）──
    { cardId: '17127', count: 1 }, // 頂尖捕捉器 (MC)
    { cardId: '18407', count: 4 }, // 奇跡修正檔 (M3)
    { cardId: '17141', count: 3 }, // 夜間擔架 (MC)
    { cardId: '17122', count: 4 }, // 高級球 (MC)
    { cardId: '17134', count: 1 }, // 寶可夢交替 (MC)
    { cardId: '17133', count: 4 }, // 寶可平板 (MC)
    // ── 訓練家・支援者（9 張）──
    { cardId: '11689', count: 1 }, // 阿克羅瑪的執著 (SV8a)
    { cardId: '17169', count: 3 }, // 暗碼迷的解讀 (MC)
    { cardId: '17189', count: 1 }, // 鬥子 (MC)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC)
    // ── 競技場（4 張）──
    { cardId: '10646', count: 4 }, // 夜間學院 (SV6a)
    // ── 能量（9 張）──
    { cardId: '18056', count: 4 }, // 感應【超】能量 (M3)
    { cardId: '17220', count: 4 }, // 基本【超】能量 (MC)
    { cardId: '17209', count: 1 }, // 回力鏢能量 (MC)
  ],
};

/**
 * 超級路卡利歐 牌組（Leon 自選卡表）
 *
 * 主力：超級路卡利歐ex｜波動突刺（從棄牌區最多 3 張基本鬥能量附到備戰）
 * 與 超級勇氣 270。利歐路直接進化到 超級路卡利歐ex（跳過普通路卡利歐ex）。
 * 太陽岩 + 月石 做鬥能量搜尋加速。
 */
const MEGA_LUCARIO_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_mega_lucario__',
  name: '超級路卡利歐',
  entries: [
    // ── 寶可夢（17 張）──
    { cardId: '16843', count: 2 }, // 太陽岩 (MC)
    { cardId: '16842', count: 2 }, // 月石 (MC)
    { cardId: '14752', count: 3 }, // 超級路卡利歐ex (M2a)
    { cardId: '16850', count: 4 }, // 利歐路 (MC)
    { cardId: '17045', count: 3 }, // 土龍弟弟 (MC) — Leon 指定
    { cardId: '17046', count: 1 }, // 土龍節節ex (MC) — Leon 指定
    { cardId: '11655', count: 2 }, // 土龍節節 (SV8a)
    // ── 訓練家・物品（21 張）──
    { cardId: '17122', count: 3 }, // 高級球 (MC)
    { cardId: '17134', count: 1 }, // 寶可夢交替 (MC)
    { cardId: '17123', count: 4 }, // 力量蛋白飲 (MC)
    { cardId: '17125', count: 4 }, // 戰鬥鑼 (MC)
    { cardId: '17141', count: 2 }, // 夜間擔架 (MC)
    { cardId: '17133', count: 3 }, // 寶可平板 (MC)
    { cardId: '17119', count: 3 }, // 好友寶芬 (MC)
    { cardId: '17162', count: 1 }, // 極限腰帶 ACE SPEC (MC)
    // ── 訓練家・支援者（9 張）──
    { cardId: '17182', count: 2 }, // 裁判 (MC)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC)
    { cardId: '17195', count: 3 }, // 老大的指令 (MC)
    // ── 競技場（2 張）──
    { cardId: '11286', count: 1 }, // 引力山岳 (SV8)
    { cardId: '12937', count: 1 }, // 阻礙之塔 (SV10)
    // ── 能量（11 張）──
    { cardId: '17215', count: 9 }, // 基本【鬥】能量 (MC)
    { cardId: '18057', count: 2 }, // 硬岩【鬥】能量 (M3)
  ],
};

/**
 * 奧利瓦 牌組（Leon 自選卡表，v2.104）
 *
 * 主力：奧利瓦ex（Stage2 草 Mega，油之機關槍 6 次 20 傷 分配 / 芳香射擊 160 + 清狀態）
 * + 厄鬼椪 碧草面具ex 碧綠之舞能量加速 + 活力森林 讓剛出場草寶可夢可進化（Stage1/2 速攻）。
 * 副力：大竺葵（繁茂特性，草能量視為 2 個）+ 吉雉雞ex / 喵喵ex / 奧利紐 支援。
 */
const OLIVA_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_oliva__',
  name: '奧利瓦',
  entries: [
    // ── 寶可夢（20 張）──
    { cardId: '16542', count: 2 }, // 奧利瓦ex (MC 071)
    { cardId: '16541', count: 2 }, // 奧利紐 (MC 070)
    { cardId: '16540', count: 2 }, // 迷你芙 (MC 069)
    { cardId: '17971', count: 2 }, // 大竺葵 (M-P 055)
    { cardId: '16488', count: 2 }, // 月桂葉 (MC 017)
    { cardId: '16487', count: 2 }, // 菊草葉 (MC 016)
    { cardId: '14443', count: 1 }, // 含羞苞 (M-P 037)
    { cardId: '16553', count: 4 }, // 厄鬼椪 碧草面具ex (MC 082)
    { cardId: '18038', count: 2 }, // 喵喵ex (M3 061)
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC 489)
    // ── 訓練家・物品（12 張）──
    { cardId: '17122', count: 4 }, // 高級球 (MC 651)
    { cardId: '17133', count: 2 }, // 寶可平板 (MC 662)
    { cardId: '17104', count: 1 }, // 不公印章 ACE SPEC (MC 633)
    { cardId: '17141', count: 1 }, // 夜間擔架 (MC 670)
    { cardId: '17138', count: 4 }, // 捕蟲組合 (MC 667)
    // ── 訓練家・支援者（12 張）──
    { cardId: '17182', count: 1 }, // 裁判 (MC 711)
    { cardId: '17183', count: 1 }, // 水蓮的照顧 (MC 712)
    { cardId: '17193', count: 1 }, // 白蕾雅 (MC 722)
    { cardId: '17195', count: 2 }, // 老大的指令 (MC 724)
    { cardId: '14424', count: 3 }, // 小光 (M-P 028)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC 729)
    // ── 競技場（4 張）──
    { cardId: '14081', count: 4 }, // 活力森林 (M1S 061)
    // ── 能量（12 張）──
    { cardId: '17217', count: 12 }, // 基本【草】能量 (MC)
  ],
};

/**
 * 鋁鋼橋龍 牌組（Leon 自選卡表，v2.104）
 *
 * 主力：鋁鋼橋龍ex（Stage1 鋼 Mega，合金建造 進化時棄牌搜 2 張基本鋼能量附鋼寶 /
 * 金屬防禦強化 220 + 下回合弱點消除 / 塗層攻擊 120 + 下回合不受基礎招式傷害）。
 * 副力：超級大嘴娃ex（貪心 × 已取獎賞 / 大啃咬 260）+ 土龍系加速 + 稜鏡塔抽牌。
 */
const ALLOY_BRIDGE_DRAGON_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_alloy_bridge_dragon__',
  name: '鋁鋼橋龍',
  entries: [
    // ── 寶可夢（21 張）──
    { cardId: '16994', count: 4 }, // 鋁鋼龍 (MC 523)
    { cardId: '16997', count: 3 }, // 鋁鋼橋龍ex (MC 526)
    { cardId: '14381', count: 1 }, // 鋁鋼橋龍 (M2 063/080) — Leon 指定
    { cardId: '14003', count: 1 }, // 超級大嘴娃ex (M1L 046)
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC 489)
    { cardId: '18038', count: 1 }, // 喵喵ex (M3 061)
    { cardId: '17045', count: 4 }, // 土龍弟弟 (MC 574)
    { cardId: '14465', count: 3 }, // 土龍節節 (M-P 045)
    { cardId: '17046', count: 1 }, // 土龍節節ex (MC 575)
    { cardId: '14799', count: 2 }, // 旋轉洛托姆 (M2a 139) — 風扇呼喚首回合搜無屬
    // ── 訓練家・物品（13 張）──
    { cardId: '17122', count: 4 }, // 高級球 (MC 651)
    { cardId: '17133', count: 4 }, // 寶可平板 (MC 662)
    { cardId: '17104', count: 1 }, // 不公印章 ACE SPEC (MC 633)
    { cardId: '17119', count: 3 }, // 好友寶芬 (MC 648)
    { cardId: '17141', count: 1 }, // 夜間擔架 (MC 670)
    // ── 訓練家・支援者（12 張）──
    { cardId: '17195', count: 4 }, // 老大的指令 (MC 724)
    { cardId: '17182', count: 3 }, // 裁判 (MC 711)
    { cardId: '18496', count: 1 }, // 吉普索 (M4 076) — 棄牌搜鋼能量附鋼寶
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC 729)
    // ── 競技場（4 張）──
    { cardId: '18500', count: 3 }, // 稜鏡塔 (M4 080) — 棄 2 抽 1
    { cardId: '15970', count: 1 }, // 阻礙之塔 (M2a 222) — 雙方道具失效
    // ── 能量（10 張）──
    { cardId: '17219', count: 10 }, // 基本【鋼】能量 (MC)
  ],
};

/**
 * 超級寶石海星 牌組（Leon 自選卡表，v2.104）
 *
 * 主力：超級寶石海星ex（Stage1 水 Mega，噴射打擊 120 + 選對手備戰 50 /
 * 星雲光束 210 不計弱抵不計附加效果）+ 超級雪妖女ex（怨言 × 對手手牌 × 50 /
 * 純粹雪）。副力：險惡廢墟（上備戰放 2 傷）限制對手 / 願增猿 腎上腺腦力
 * 搬傷害反打 / 古舊能量 KO 減獎 ACE SPEC。
 */
const STARMIE_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_starmie__',
  name: '超級寶石海星',
  entries: [
    // ── 寶可夢（17 張）──
    { cardId: '16657', count: 3 }, // 雪童子 (MC 186)
    { cardId: '10447', count: 2 }, // 雪妖女 (SV6 033)
    { cardId: '14696', count: 2 }, // 超級雪妖女ex (M2a 036)
    { cardId: '18062', count: 3 }, // 海星星 (M-P 066)
    { cardId: '17998', count: 2 }, // 超級寶石海星ex (M3 021)
    { cardId: '16829', count: 3 }, // 願增猿 (MC 358)
    { cardId: '14443', count: 1 }, // 含羞苞 (M-P 037)
    { cardId: '18038', count: 1 }, // 喵喵ex (M3 061)
    // ── 訓練家・物品（16 張）──
    { cardId: '17119', count: 4 }, // 好友寶芬 (MC 648)
    { cardId: '17131', count: 2 }, // 寶可裝置3.0 (MC 660)
    { cardId: '17141', count: 2 }, // 夜間擔架 (MC 670)
    { cardId: '17122', count: 3 }, // 高級球 (MC 651)
    { cardId: '17133', count: 3 }, // 寶可平板 (MC 662)
    { cardId: '17134', count: 1 }, // 寶可夢交替 (MC 663)
    { cardId: '18492', count: 1 }, // 特殊紅牌 (M4 072)
    // ── 訓練家・支援者（15 張）──
    { cardId: '18078', count: 1 }, // 滿充的體貼 (M-P 082) — 超級ex 全回血+能量回手
    { cardId: '17166', count: 2 }, // 青木的手法 (MC 695) — 棄手牌搜 3 類各 1
    { cardId: '17195', count: 3 }, // 老大的指令 (MC 724)
    { cardId: '17167', count: 2 }, // 赤松 (MC 696)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC 729)
    { cardId: '17189', count: 3 }, // 鬥子 (MC 718)
    // ── 競技場（3 張）──
    { cardId: '14020', count: 3 }, // 險惡廢墟 (M1L 063)
    // ── 能量（9 張）──
    { cardId: '17212', count: 1 }, // 古舊能量 ACE SPEC (MC 741)
    { cardId: '17207', count: 1 }, // 燃火能量 (MC 736)
    { cardId: '17221', count: 4 }, // 基本【水】能量 (MC)
    { cardId: '17214', count: 3 }, // 基本【惡】能量 (MC)
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// v2.112 新增 6 組 Leon 自選卡表：N的索羅亞克 / 火焰雞多龍 / 夠讚狗 / 顫弦蠑螈 /
//   蒼炎刃鬼 / 超級甲賀忍蛙
// 套用「同 deck 一致性 + 最新 set 優先 + 低 cn 優先」預選規則，各張 60 張。
// ═══════════════════════════════════════════════════════════════════════════

/** N的索羅亞克 預組（60 張）*/
const N_ZOROARK_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_n_zoroark__',
  name: 'N的索羅亞克',
  entries: [
    { cardId: '16941', count: 4 }, // N的索羅亞克ex (MC 470/742)
    { cardId: '16940', count: 4 }, // N的索羅亞 (MC 469/742)
    { cardId: '14789', count: 2 }, // N的捷克羅姆 (M2a 129/193)
    { cardId: '16590', count: 2 }, // N的達摩狒狒 (MC 119/742)
    { cardId: '16589', count: 2 }, // N的火紅不倒翁 (MC 118/742)
    { cardId: '17016', count: 1 }, // N的萊希拉姆 (MC 545/742)
    { cardId: '16928', count: 1 }, // N的扒手貓 (MC 457/742)
    { cardId: '14671', count: 1 }, // 含羞苞 (M2a 011/193)
    { cardId: '16829', count: 1 }, // 願增猿 (MC 358/742)
    { cardId: '16962', count: 1 }, // 桃歹郎ex (MC 491/742)
    { cardId: '18038', count: 1 }, // 喵喵ex (M3 061/080)
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC 489/742)
    { cardId: '17122', count: 3 }, // 高級球 (MC 651/742)
    { cardId: '18047', count: 3 }, // 寶可平板 (M3 070/080)
    { cardId: '17119', count: 4 }, // 好友寶芬 (MC 648/742)
    { cardId: '17141', count: 1 }, // 夜間擔架 (MC 670/742)
    { cardId: '17106', count: 3 }, // N的ＰＰ提升劑 (MC 635/742)
    { cardId: '18492', count: 1 }, // 特殊紅牌 (M4 072/083)
    { cardId: '17104', count: 1 }, // 不公印章 (MC 633/742)
    { cardId: '17152', count: 1 }, // 鎖鏈糬 (MC 681/742)
    { cardId: '17195', count: 2 }, // 老大的指令 (MC 724/742)
    { cardId: '11282', count: 3 }, // 席藍 (SV8 102/106)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC 729/742)
    { cardId: '17170', count: 1 }, // 阿杏的秘招 (MC 699/742)
    { cardId: '17175', count: 1 }, // 空手道王的演練 (MC 704/742)
    { cardId: '17182', count: 1 }, // 裁判 (MC 711/742)
    { cardId: '14841', count: 2 }, // N的城堡 (M2a 181/193)
    { cardId: '17214', count: 8 }, // 基本【惡】能量 (MC DAR)
  ],
};

/** 火焰雞多龍 預組（60 張）*/
const BLAZIKEN_DRAGAPULT_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_blaziken_dragapult__',
  name: '火焰雞多龍',
  entries: [
    { cardId: '17017', count: 4 }, // 多龍梅西亞 (MC 546/742)
    { cardId: '17018', count: 4 }, // 多龍奇 (MC 547/742)
    { cardId: '17019', count: 2 }, // 多龍巴魯托ex (MC 548/742)
    { cardId: '12768', count: 2 }, // 火稚雞 (SV10 018/098)
    { cardId: '12769', count: 1 }, // 力壯雞 (SV10 019/098)
    { cardId: '12086', count: 2 }, // 火焰雞ex (SVM 016/175)
    { cardId: '16829', count: 2 }, // 願增猿 (MC 358/742)
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC 489/742)
    { cardId: '14671', count: 1 }, // 含羞苞 (M2a 011/193)
    { cardId: '18038', count: 1 }, // 喵喵ex (M3 061/080)
    { cardId: '16758', count: 1 }, // 莉莉艾的皮皮ex (MC 287/742)
    { cardId: '14672', count: 1 }, // 謝米 (M2a 012/193)
    { cardId: '17141', count: 2 }, // 夜間擔架 (MC 670/742)
    { cardId: '17119', count: 4 }, // 好友寶芬 (MC 648/742)
    { cardId: '17126', count: 2 }, // 神奇糖果 (MC 655/742)
    { cardId: '14392', count: 1 }, // 高溫燃燒器 (M2 074/080)
    { cardId: '17104', count: 1 }, // 不公印章 (MC 633/742)
    { cardId: '18047', count: 3 }, // 寶可平板 (M3 070/080)
    { cardId: '17122', count: 4 }, // 高級球 (MC 651/742)
    { cardId: '18492', count: 1 }, // 特殊紅牌 (M4 072/083)
    { cardId: '17195', count: 3 }, // 老大的指令 (MC 724/742)
    { cardId: '17167', count: 2 }, // 赤松 (MC 696/742)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC 729/742)
    { cardId: '14395', count: 1 }, // 小光 (M2 077/080)
    { cardId: '14020', count: 1 }, // 險惡廢墟 (M1L 063/063)
    { cardId: '14849', count: 1 }, // 火箭隊的監視塔 (M2a 189/193)
    { cardId: '17216', count: 3 }, // 基本【火】能量 (MC FIR)
    { cardId: '17220', count: 3 }, // 基本【超】能量 (MC PSY)
    { cardId: '17214', count: 2 }, // 基本【惡】能量 (MC DAR)
  ],
};

/** 夠讚狗 預組（60 張）*/
const OKIDOGI_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_okidogi__',
  name: '夠讚狗',
  entries: [
    { cardId: '10478', count: 3 }, // 夠讚狗 (SV6 064/101)
    { cardId: '10607', count: 1 }, // 月月熊 赫月 (SV6a 025/064)
    { cardId: '16843', count: 3 }, // 太陽岩 (MC 372/742)
    { cardId: '16842', count: 2 }, // 月石 (MC 371/742)
    { cardId: '18019', count: 2 }, // 龜足巨鎧 (M3 042/080)
    { cardId: '18018', count: 2 }, // 龜腳腳 (M3 041/080)
    { cardId: '14332', count: 1 }, // 火焰鳥 (M2 014/080)
    { cardId: '10622', count: 1 }, // 蓋諾賽克特 (SV6a 040/064)
    { cardId: '18047', count: 4 }, // 寶可平板 (M3 070/080)
    { cardId: '17125', count: 4 }, // 戰鬥鑼 (MC 654/742)
    { cardId: '17131', count: 2 }, // 寶可裝置3.0 (MC 660/742)
    { cardId: '17141', count: 2 }, // 夜間擔架 (MC 670/742)
    { cardId: '17107', count: 1 }, // 能量回收 (MC 636/742)
    { cardId: '17159', count: 3 }, // 氣球 (MC 688/742)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC 729/742)
    { cardId: '17195', count: 3 }, // 老大的指令 (MC 724/742)
    { cardId: '17182', count: 2 }, // 裁判 (MC 711/742)
    { cardId: '18050', count: 2 }, // 塔拉剛 (M3 073/080)
    { cardId: '17198', count: 1 }, // 松葉的信心 (MC 727/742)
    { cardId: '14397', count: 3 }, // 對戰圓形競技場 (M2 079/080)
    { cardId: '17215', count: 9 }, // 基本【鬥】能量 (MC FIG)
    { cardId: '17210', count: 4 }, // 稜鏡能量 (MC 739/742)
    { cardId: '17212', count: 1 }, // 古舊能量 (MC 741/742)
  ],
};

/** 顫弦蠑螈 預組（60 張）*/
const SALAZZLE_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_salazzle__',
  name: '顫弦蠑螈',
  entries: [
    { cardId: '14374', count: 4 }, // 毒電嬰 (M2 056/080)
    { cardId: '14375', count: 4 }, // 顫弦蠑螈 (M2 057/080)
    { cardId: '16829', count: 3 }, // 願增猿 (MC 358/742)
    { cardId: '13995', count: 1 }, // 超級阿勃梭魯ex (M1L 038/063)
    { cardId: '16962', count: 1 }, // 桃歹郎ex (MC 491/742)
    { cardId: '16961', count: 1 }, // 桃歹郎 (MC 490/742)
    { cardId: '16919', count: 1 }, // 火箭隊的狃拉 (MC 448/742)
    { cardId: '16958', count: 1 }, // 猛惡菇 (MC 487/742)
    { cardId: '13997', count: 1 }, // 伊裴爾塔爾 (M1L 040/063)
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC 489/742)
    { cardId: '18047', count: 4 }, // 寶可平板 (M3 070/080)
    { cardId: '17122', count: 3 }, // 高級球 (MC 651/742)
    { cardId: '17141', count: 2 }, // 夜間擔架 (MC 670/742)
    { cardId: '17109', count: 2 }, // 能量轉移 (MC 638/742)
    { cardId: '18404', count: 2 }, // 能量回收器 (M3 101/080)
    { cardId: '18492', count: 1 }, // 特殊紅牌 (M4 072/083)
    { cardId: '17104', count: 1 }, // 不公印章 (MC 633/742)
    { cardId: '17159', count: 3 }, // 氣球 (MC 688/742)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC 729/742)
    { cardId: '17195', count: 3 }, // 老大的指令 (MC 724/742)
    { cardId: '17166', count: 2 }, // 青木的手法 (MC 695/742)
    { cardId: '17182', count: 1 }, // 裁判 (MC 711/742)
    { cardId: '17176', count: 1 }, // 庫瑟洛斯奇的企圖 (MC 705/742)
    { cardId: '17205', count: 1 }, // 火箭隊的拉姆達 (MC 734/742)
    { cardId: '14849', count: 2 }, // 火箭隊的監視塔 (M2a 189/193)
    { cardId: '17214', count: 10 }, // 基本【惡】能量 (MC DAR)
  ],
};

/** 蒼炎刃鬼 預組（60 張）*/
const CERULEDGE_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_ceruledge__',
  name: '蒼炎刃鬼',
  entries: [
    { cardId: '14691', count: 3 }, // 蒼炎刃鬼ex (M2a 031/193)  v2.113 Leon 修正 4→3
    { cardId: '16616', count: 4 }, // 炭小侍 (MC 145/742)
    { cardId: '16843', count: 2 }, // 太陽岩 (MC 372/742)
    { cardId: '16842', count: 2 }, // 月石 (MC 371/742)
    { cardId: '18038', count: 2 }, // 喵喵ex (M3 061/080)  v2.113 Leon 修正 1→2
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC 489/742)
    { cardId: '9880', count: 1 },  // 螺釘地鼠 (SV5M 039/071)
    { cardId: '17122', count: 4 }, // 高級球 (MC 651/742)
    { cardId: '18047', count: 4 }, // 寶可平板 (M3 070/080)
    { cardId: '17125', count: 3 }, // 戰鬥鑼 (MC 654/742)
    { cardId: '17141', count: 2 }, // 夜間擔架 (MC 670/742)
    { cardId: '11147', count: 1 }, // 完全體攪拌器 (SVK 017/042) ACE SPEC
    { cardId: '17186', count: 4 }, // 丹瑜 (MC 715/742)
    { cardId: '17200', count: 3 }, // 莉莉艾的決意 (MC 729/742)
    { cardId: '17195', count: 2 }, // 老大的指令 (MC 724/742)
    { cardId: '17193', count: 1 }, // 白蕾雅 (MC 722/742)
    { cardId: '18500', count: 2 }, // 稜鏡塔 (M4 080/083)
    { cardId: '17216', count: 6 }, // 基本【火】能量 (MC FIR)
    { cardId: '17215', count: 13 },// 基本【鬥】能量 (MC FIG)
  ],
};

/** 超級甲賀忍蛙 預組（60 張）*/
const MEGA_GRENINJA_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_mega_greninja__',
  name: '超級甲賀忍蛙',
  entries: [
    { cardId: '18440', count: 4 }, // 呱呱泡蛙 (M4 020/083)
    { cardId: '18441', count: 2 }, // 呱頭蛙 (M4 021/083)
    { cardId: '18442', count: 2 }, // 超級甲賀忍蛙ex (M4 022/083)
    { cardId: '10292', count: 1 }, // 甲賀忍蛙ex (SV5a 045/066)  v2.128 改用 SV5a 版（忍之利刃 / 分身連打）— 超級甲賀忍蛙牌組對應的進化前是這隻
    { cardId: '17017', count: 3 }, // 多龍梅西亞 (MC 546/742)
    { cardId: '17018', count: 3 }, // 多龍奇 (MC 547/742)
    { cardId: '17019', count: 1 }, // 多龍巴魯托ex (MC 548/742)
    { cardId: '16960', count: 1 }, // 吉雉雞ex (MC 489/742)
    { cardId: '18038', count: 1 }, // 喵喵ex (M3 061/080)
    { cardId: '14671', count: 1 }, // 含羞苞 (M2a 011/193)
    { cardId: '14672', count: 1 }, // 謝米 (M2a 012/193)
    { cardId: '17119', count: 4 }, // 好友寶芬 (MC 648/742)
    { cardId: '18047', count: 4 }, // 寶可平板 (M3 070/080)
    { cardId: '17122', count: 3 }, // 高級球 (MC 651/742)
    { cardId: '17126', count: 2 }, // 神奇糖果 (MC 655/742)
    { cardId: '18492', count: 1 }, // 特殊紅牌 (M4 072/083)
    { cardId: '17159', count: 2 }, // 氣球 (MC 688/742)
    { cardId: '17200', count: 4 }, // 莉莉艾的決意 (MC 729/742)
    { cardId: '17189', count: 3 }, // 鬥子 (MC 718/742)
    { cardId: '14395', count: 1 }, // 小光 (M2 077/080)
    { cardId: '17195', count: 2 }, // 老大的指令 (MC 724/742)
    { cardId: '17182', count: 1 }, // 裁判 (MC 711/742)
    { cardId: '18495', count: 2 }, // AZ的平和 (M4 075/083)
    { cardId: '14849', count: 2 }, // 火箭隊的監視塔 (M2a 189/193)
    { cardId: '17221', count: 7 }, // 基本【水】能量 (MC WAT)
    { cardId: '9770', count: 1 },  // 新衝天能量 (SV5K 071/071) ACE SPEC
    { cardId: '17207', count: 1 }, // 燃火能量 (MC 736/742)
  ],
};

/**
 * 所有內建預設牌組
 *
 * v2.13：移除「破空焰ex（火屬 · 自組）」—— 那是 Session 24 自組的嘗試用牌組，
 * 既非官方預組也沒跟上 MC 後的卡片規則，Leon 決定不再內建。
 * v2.21：新增「胡地」與「瑪俐的長毛巨魔ex」，並爬入 SVOM / SVOD 兩個初階牌組系列。
 * v2.35：新增「火箭隊的超夢ex」與「猛雷鼓ex」兩組 Leon 自選卡表。
 * v2.89：新增「呆呆王」與「超級路卡利歐」兩組 Leon 自選卡表。
 * v2.104：新增「奧利瓦」/「鋁鋼橋龍」/「超級寶石海星」三組 Leon 自選卡表（Phase A+B+C 22 張 effect 同步實裝）。
 * v2.112：新增「N的索羅亞克」/「火焰雞多龍」/「夠讚狗」/「顫弦蠑螈」/「蒼炎刃鬼」/「超級甲賀忍蛙」六組 Leon 自選卡表。
 */
export const PRESET_DECKS: Deck[] = [
  { ...GENGAR_DECK, updatedAt: 0 },
  { ...DIANCIE_DECK, updatedAt: 0 },
  { ...CYNTHIA_GARCHOMP_DECK, updatedAt: 0 },
  { ...MARRUNE_DRAGAPULT_DECK, updatedAt: 0 },
  { ...ALAKAZAM_DECK, updatedAt: 0 },
  { ...MARNIE_SCRAFTY_DECK, updatedAt: 0 },
  { ...ROCKET_MEWTWO_DECK, updatedAt: 0 },
  { ...THUNDER_DRUM_DECK, updatedAt: 0 },
  { ...SLOWKING_DECK, updatedAt: 0 },
  { ...MEGA_LUCARIO_DECK, updatedAt: 0 },
  { ...OLIVA_DECK, updatedAt: 0 },
  { ...ALLOY_BRIDGE_DRAGON_DECK, updatedAt: 0 },
  { ...STARMIE_DECK, updatedAt: 0 },
  { ...N_ZOROARK_DECK, updatedAt: 0 },
  { ...BLAZIKEN_DRAGAPULT_DECK, updatedAt: 0 },
  { ...OKIDOGI_DECK, updatedAt: 0 },
  { ...SALAZZLE_DECK, updatedAt: 0 },
  { ...CERULEDGE_DECK, updatedAt: 0 },
  { ...MEGA_GRENINJA_DECK, updatedAt: 0 },
];

/** 預設牌組 ID 集合（用來判斷是否為內建牌組） */
export const PRESET_IDS = new Set(PRESET_DECKS.map(d => d.id));
