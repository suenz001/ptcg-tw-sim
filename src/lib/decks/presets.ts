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

/** 破空焰ex 火屬預組（Session 24 — 自組牌組，卡片來自 MC「超級進化初階牌組100」） */
const CHI_YU_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_fire__',
  name: '破空焰ex（火屬 · 自組）',
  entries: [
    // ── 寶可夢（17 張）──
    { cardId: '16622', count: 3 },  // 破空焰ex（主力 · Basic ex · HP 230 · 烈火爆進 260）
    { cardId: '16597', count: 2 },  // 萊希拉姆ex（副力 · Basic ex · HP 230 · 劈開 50）
    { cardId: '16554', count: 4 },  // 小火龍（Basic · HP 80 · 火之爪 30）
    { cardId: '16555', count: 2 },  // 火恐龍（Stage1 · HP 100 · 高溫爆破 50）
    { cardId: '16593', count: 2 },  // 火神蛾（Stage1 · HP 140）
    { cardId: '16592', count: 2 },  // 燃燒蟲（Basic · HP 70 · 為火神蛾進化來源）
    { cardId: '16607', count: 2 },  // 爆焰龜獸（Basic · HP 120）
    // ── 訓練家（29 張）──
    { cardId: '17122', count: 4 },  // 高級球
    { cardId: '17119', count: 3 },  // 好友寶芬
    { cardId: '17141', count: 3 },  // 夜間擔架
    { cardId: '17111', count: 2 },  // 能量回收器
    { cardId: '17105', count: 2 },  // 好傷藥
    { cardId: '17143', count: 1 },  // 龍之秘藥
    { cardId: '17134', count: 3 },  // 寶可夢交替
    { cardId: '17127', count: 1 },  // 頂尖捕捉器
    { cardId: '17195', count: 2 },  // 老大的指令
    { cardId: '17200', count: 4 },  // 莉莉艾的決意
    { cardId: '17165', count: 3 },  // 艾莉絲的鬥志
    { cardId: '17198', count: 1 },  // 松葉的信心
    // ── 能量（14 張）──
    { cardId: '17216', count: 14 }, // 基本【火】能量
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

/** 所有內建預設牌組 */
export const PRESET_DECKS: Deck[] = [
  { ...GENGAR_DECK, updatedAt: 0 },
  { ...DIANCIE_DECK, updatedAt: 0 },
  { ...CHI_YU_DECK, updatedAt: 0 },
  { ...CYNTHIA_GARCHOMP_DECK, updatedAt: 0 },
];

/** 預設牌組 ID 集合（用來判斷是否為內建牌組） */
export const PRESET_IDS = new Set(PRESET_DECKS.map(d => d.id));
