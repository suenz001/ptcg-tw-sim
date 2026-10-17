// ⭐v6.582「認輸並提議重新開局」的認輸盤面（站長 2026-10-17）
//
// 站長要求：對局控制的「提議重新開局」拆成兩顆按鈕：
//   左：🔄 提議重新開局（原本的，雙方都不算勝敗）
//   右：🏳 認輸並提議重新開局（我方算敗、對方獲勝）
//
// 認輸是單方面的：按下去當下這一局就結束（對手獲勝），跟「投降離開」一樣記成一場正式結果
// （對戰紀錄、套牌戰績照常記）；差別只在人留在房間裡，並同時對對手送出「重新開局」的提議。
// 對手同意 ⇒ 用同一副牌組從擲硬幣重開；拒絕或 30 秒沒回應 ⇒ 停在這一局的結算畫面（認輸不會被收回）。
//
// 唯一判準（Rule 38）：認輸後的盤面只由 buildConcededGame 產生；線上（Oracle／Firestore 兩套房間）與本機 vs AI 都呼叫它。
//   ・純函式：不改傳入的盤面（Rule 72）。
//   ・只有對戰中（phase === 'playing'）才能認輸 ⇒ 開局（擲硬幣／補抽，setup）與已結束的局回 null（審查 P3-3：
//     開局還沒有勝負可言，要重來請用左邊的「提議重新開局」）。

export const CONCEDE_LOG_SUFFIX = '認輸，對手獲勝';

export function concedeWinReason(loserName: string): string {
  return `${loserName} 認輸`;
}

/** 回傳「loserIdx 認輸」之後的盤面；局已結束或座位不合法 ⇒ null */
export function buildConcededGame<G extends { phase?: string; turn?: number; log?: any[]; players?: any[] }>(
  gs: G | null | undefined, loserIdx: number, nowMs: number,
): (G & { phase: 'game-over'; winner: 0 | 1; winReason?: string }) | null {   // ⚠ 型別寫成可選欄位：test-ai-sim-harness 會把「winReason 冒號＋運算式」當成終局原因掃描
  if (!gs || (loserIdx !== 0 && loserIdx !== 1)) return null;
  if (gs.phase !== 'playing') return null;
  const winner = (1 - loserIdx) as 0 | 1;
  const loserName: string = gs.players?.[loserIdx]?.name ?? ('P' + (loserIdx + 1));
  return {
    ...gs,
    phase: 'game-over',
    winner,
    winReason: concedeWinReason(loserName),
    log: [
      ...(gs.log ?? []),
      { turn: gs.turn, playerIndex: null, message: loserName + ' ' + CONCEDE_LOG_SUFFIX, timestamp: nowMs },
    ],
  };
}
