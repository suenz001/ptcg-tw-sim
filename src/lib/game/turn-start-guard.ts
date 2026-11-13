// ⭐v6.640 回合開始防誤觸：招式按鈕在「輪到自己」剛出現的那一瞬間不接受點擊。
//
// 由來（站長 2026-11-13 轉述玩家回報）：錦標賽 evt_mwcx3he43kc3_r1_m1，對手的土龍節節ex 使出逆境之尾後換回合，
//   玩家說「我都還沒動，系統就自動幫我打出第一招」。伺服器紀錄：輪到他 0.79 秒後就收到「貪心之牙」
//   （等對手時每 0.8 秒輪詢一次，畫面切到自己回合後不到 1 秒就送出，不可能是看完盤面才選的招）。
//   全站送出 ATTACK 的入口逐一查過，沒有程式會自己出招；最可疑的是回合開始那 1.5 秒的「你的回合」橫幅：
//   它蓋住整個畫面、看起來像彈出視窗，但 pointer-events:none ⇒ 想點掉橫幅的那一下會穿透到底下剛出現的招式按鈕。
//   站長選擇的修法：橫幅期間招式鈕不接受點擊（點到時順便關掉橫幅），只改前端、不增加伺服器負擔（Rule 92）。
//
// 唯一判準（Rule 38）：+page.svelte 的 initiateAttack 開頭呼叫它；不要在各個按鈕上各寫一份。

/** 回合開始後多久之內，點招式按鈕不算數（毫秒）。橫幅本身顯示 1500ms，前 1 秒最容易誤觸。 */
export const TURN_START_ATTACK_GUARD_MS = 1000;

/**
 * 現在點招式按鈕是否要擋下。
 * @param myTurnShownAt 畫面切到「自己的回合」的時間（Date.now()）；null＝這次沒有顯示回合橫幅（例如重新整理、背景分頁回來）⇒ 不擋
 * @param now 現在時間
 */
export function attackClickGuarded(myTurnShownAt: number | null, now: number, ms: number = TURN_START_ATTACK_GUARD_MS): boolean {
  if (myTurnShownAt == null || !Number.isFinite(myTurnShownAt) || !Number.isFinite(now)) return false;
  const dt = now - myTurnShownAt;
  return dt >= 0 && dt < ms;
}
