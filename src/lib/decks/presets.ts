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
 * 全套 60 張（寶可夢特性/招式、訓練家、競技場、道具）於 v2.01 全部實裝完畢。
 */
const MARRUNE_DRAGAPULT_DECK: Omit<Deck, 'updatedAt'> = {
  id: '__preset_marrune_dragapult__',
  name: '魔靈多龍',
  entries: [
    // ── 寶可夢（20 張）──
    { cardId: '17019', count: 3 },  // 多龍巴魯托ex (MC)
    { cardId: '17018', count: 2 },  // 多龍奇 (MC)
    { cardId: '17017', count: 4 },  // 多龍梅西亞 (MC)
    { cardId: '16781', count: 2 },  // 黑夜魔靈 (MC) — 咒詛炸彈 13 counter
    { cardId: '16780', count: 2 },  // 彷徨夜靈 (MC) — 咒詛炸彈 5 counter（已實裝）
    { cardId: '16779', count: 2 },  // 夜巡靈 (MC)
    { cardId: '16829', count: 1 },  // 願增猿 (MC) — 腎上腺腦力
    { cardId: '11526', count: 1 },  // 含羞苞 (SV8a) — 迷幻花粉
    { cardId: '18038', count: 2 },  // 喵喵ex (M3) — 殺手鐧捕捉
    { cardId: '16960', count: 1 },  // 吉雉雞ex (MC) — 扭轉乾坤
    // ── 訓練家・物品（16 張）──
    { cardId: '17119', count: 4 },  // 好友寶芬 (MC)
    { cardId: '17122', count: 4 },  // 高級球 (MC)
    { cardId: '17133', count: 4 },  // 寶可平板 (MC)
    { cardId: '17126', count: 3 },  // 神奇糖果 (MC)
    { cardId: '17141', count: 2 },  // 夜間擔架 (MC)
    { cardId: '18492', count: 1 },  // 特殊紅牌 (M4)
    { cardId: '17104', count: 1 },  // 不公印章 (MC)
    { cardId: '17163', count: 1 },  // 莉莉艾的珍珠 (MC · 道具)
    // ── 訓練家・支援者（10 張）──
    { cardId: '17200', count: 4 },  // 莉莉艾的決意 (MC)
    { cardId: '17195', count: 2 },  // 老大的指令 (MC)
    { cardId: '17193', count: 1 },  // 白蕾雅 (MC)
    { cardId: '17199', count: 1 },  // 阿蜜的目光 (MC)
    { cardId: '17167', count: 1 },  // 赤松 (MC)
    { cardId: '17182', count: 1 },  // 裁判 (MC)
    // ── 競技場（2 張）──
    { cardId: '11706', count: 1 },  // 阻礙之塔 (SV8a)
    { cardId: '11708', count: 1 },  // 月光丘陵 (SV8a)
    // ── 能量（8 張）──
    { cardId: '17216', count: 3 },  // 基本【火】能量 (MC)
    { cardId: '17220', count: 3 },  // 基本【超】能量 (MC)
    { cardId: '17214', count: 2 },  // 基本【惡】能量 (MC)
  ],
};

/**
 * 所有內建預設牌組
 *
 * v2.13：移除「破空焰ex（火屬 · 自組）」—— 那是 Session 24 自組的嘗試用牌組，
 * 既非官方預組也沒跟上 MC 後的卡片規則，Leon 決定不再內建。
 */
export const PRESET_DECKS: Deck[] = [
  { ...GENGAR_DECK, updatedAt: 0 },
  { ...DIANCIE_DECK, updatedAt: 0 },
  { ...CYNTHIA_GARCHOMP_DECK, updatedAt: 0 },
  { ...MARRUNE_DRAGAPULT_DECK, updatedAt: 0 },
];

/** 預設牌組 ID 集合（用來判斷是否為內建牌組） */
export const PRESET_IDS = new Set(PRESET_DECKS.map(d => d.id));
