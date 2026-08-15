/**
 * v6.191：Gust 系支援者（選 1 隻對手備戰寶可夢與戰鬥寶可夢互換）的**卡名單一來源**。
 *
 * 台灣官方在 M-P 215/M-P 發了冠名版「老大的指令（烏羽）」（I 標），rulesText 與
 * 「老大的指令」逐字相同。站內 reg key 是**卡名**逐字比對，冠名不同 = 兩個 key，
 * 所以新印刷不會自動生效 —— 兩個消費點（effects 註冊、AI 手牌判定）一律讀這份清單。
 *
 * ⚠ 這個檔**不得 import 任何東西**：ai.ts 與卡檔都要用它，任何相依都可能造成
 *   循環 import（循環下模組層級 const 會 TDZ）。
 */
export const GUST_SUPPORTER_NAMES: readonly string[] = [
  '老大的指令',
  '老大的指令（烏羽）',
];
