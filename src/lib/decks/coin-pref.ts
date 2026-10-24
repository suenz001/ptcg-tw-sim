/**
 * ⭐v6.599 牌組的「先後攻偏好」（玩家建議，站長 2026-10-24 裁定）。
 *
 * 玩家在牌組編輯器替每副牌設定「贏得開場擲硬幣時要先攻／後攻／隨機」，
 * 之後在本機／AI 對戰、線上房間、錦標賽報名選這副牌組時自動帶入，玩家仍可手動改。
 *
 * 站長裁定：
 *   - 只有「選牌組的那一刻」帶入；錦標賽只影響新報名（已報名的不回溯）。
 *   - 手動改的偏好**不反存回牌組**（只影響這一場）。
 *
 * ⚠ 沒設定過的牌組（舊牌組、內建預組）＝ undefined ⇒ **完全不改動**入口目前的選擇
 *   （本機／線上原本會記住「上次選的偏好」，不可以因為選了一副沒設定的牌組就被洗成隨機）。
 *
 * 判準只在這一支（Rule 38：牌組編輯器、對戰頁三個入口都呼叫這裡，不各自抄一份）。
 */

/** 牌組可設定的值（與錦標賽報名的三個選項一致；「對手決定」只在一般對戰入口，牌組不提供）。 */
export type DeckCoinPref = 'random' | 'first' | 'second';

export const DECK_COIN_PREF_VALUES: readonly DeckCoinPref[] = ['random', 'first', 'second'];

/** 牌組編輯器下拉選單的顯示文字（'' ＝ 不設定）。 */
export const DECK_COIN_PREF_OPTIONS: readonly { value: '' | DeckCoinPref; label: string }[] = [
  { value: '', label: '不設定（每次自己選）' },
  { value: 'random', label: '🎲 隨機' },
  { value: 'first', label: '⚡ 先攻' },
  { value: 'second', label: '🛡️ 後攻' },
];

/**
 * 消毒：只有三個合法值會被採用，其餘（undefined、舊資料、匯入 JSON 的亂值）一律回 undefined。
 * ⚠ 匯入的 JSON、雲端文件都是未消毒輸入，任何讀取端都要先過這一支。
 */
export function normalizeDeckCoinPref(x: unknown): DeckCoinPref | undefined {
  return typeof x === 'string' && (DECK_COIN_PREF_VALUES as readonly string[]).includes(x)
    ? (x as DeckCoinPref)
    : undefined;
}

/**
 * 選牌組時要帶入的偏好：牌組有設定 ⇒ 回傳該值；沒設定／牌組不存在 ⇒ 回傳 `current`（不改動）。
 * 泛型讓「一般對戰（含 'opponent'）」與「錦標賽（string）」兩種入口都能直接用。
 */
export function deckCoinPrefOr<T extends string>(deck: { coinPref?: unknown } | null | undefined, current: T): T | DeckCoinPref {
  const p = normalizeDeckCoinPref(deck?.coinPref);
  return p ?? current;
}
