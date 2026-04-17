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

/** 所有內建預設牌組 */
export const PRESET_DECKS: Deck[] = [
  { ...GENGAR_DECK, updatedAt: 0 },
  { ...DIANCIE_DECK, updatedAt: 0 },
];

/** 預設牌組 ID 集合（用來判斷是否為內建牌組） */
export const PRESET_IDS = new Set(PRESET_DECKS.map(d => d.id));
