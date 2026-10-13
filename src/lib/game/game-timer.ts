// ⭐v6.565 對戰計時器的數字（唯一一份；桌機 +page.svelte 算好再傳給手機 MobilePortraitBattle）。
//   站長 2026-10-14：v6.564 留下的兩個小誤差一起修 ——
//   ① 休閒線上雙方時鐘差：盤面上的時間戳改由 engine 用遊戲時鐘（server-clock.ts gameClockNow）寫，
//      畫面端用同一個時鐘的「現在」（nowMs）來減，這支只負責算，不碰時鐘。
//   ② 終局時最後一回合沒算進任何一方：引擎只有 END_TURN 才把回合時間累計進 playerTurnTimeMs，
//      打出致勝一擊／投降／牌庫抽完而結束的那一回合永遠不會累計 ⇒ 總時間 ≠ 雙方累計＋開局準備。
//      終局時把「最後一回合開始 → 對局結束」算給當時的行動方；對局結束的時刻＝對戰紀錄最後一筆的時間戳（同一個時鐘寫的）
//      與呼叫端給的備用時刻（回放那一格的時間）取較晚者；都拿不到就算 0。
//   ⚠ 本檔零 import（只用型別），不會造成循環。

import type { GameState } from './types';

export interface TimerView {
  /** 本回合（終局時＝最後一回合）時間 */
  live: number;
  /** P1／P2 累計（含本回合） */
  p0: number;
  p1: number;
  /** 對局總時間（gameStartTime 起算；engine 在開局準備結束、第一回合開始時才寫 gameStartTime，所以正常情況＝雙方累計之和） */
  total: number;
}

type TimerGame = Pick<GameState, 'phase' | 'activePlayerIndex' | 'gameStartTime' | 'currentTurnStartTime' | 'playerTurnTimeMs' | 'log'>;

/** 對戰紀錄裡最大的時間戳（沒有就 null）。只在終局時呼叫一次，迴圈是 O(n) 且不配置新陣列。 */
export function lastLogTimestamp(log: ReadonlyArray<{ timestamp?: number }> | undefined | null): number | null {
  if (!Array.isArray(log)) return null;
  let best = -Infinity;
  for (const e of log) {
    const t = e?.timestamp;
    if (typeof t === 'number' && Number.isFinite(t) && t > best) best = t;
  }
  return best === -Infinity ? null : best;
}

/**
 * 終局時刻：「紀錄最後一筆」與「備用時刻」取較晚的那個；兩者都必須不早於最後一回合開始（早於＝舊資料／別的時鐘寫的，不可信）。
 *   為什麼取較晚：錦標賽伺服器的投降／閒置判負／時限裁定設成終局時不寫紀錄 ⇒ 紀錄停在最後一個動作，
 *   回放的備用時刻（伺服器的 endedAt）才是真正結束的時候（v6.564 回放終局就是用它，不可以變短）。即時對局不給備用。
 * 非終局一律 null。
 */
export function gameOverEndAt(game: TimerGame | null | undefined, fallbackAt: number | null | undefined): number | null {
  if (!game || game.phase !== 'game-over') return null;
  const start = game.currentTurnStartTime;
  const usable = (t: number | null | undefined): t is number => typeof t === 'number' && Number.isFinite(t) && (start === undefined || t >= start);
  const last = lastLogTimestamp(game.log as ReadonlyArray<{ timestamp?: number }>);
  const a = usable(last) ? last : null;
  const b = usable(fallbackAt) ? fallbackAt : null;
  return a === null ? b : b === null ? a : Math.max(a, b);
}

/**
 * 計時器四個數字。
 * @param nowMs        「現在」（遊戲時鐘；回放時是那一格的時間）
 * @param fallbackEndAt 終局時拿不到紀錄時間戳的備用時刻（回放那一格的時間；即時對局傳 null）
 */
export function computeTimerView(game: TimerGame | null | undefined, nowMs: number, fallbackEndAt: number | null | undefined): TimerView {
  if (!game) return { live: 0, p0: 0, p1: 0, total: 0 };
  const cts = game.currentTurnStartTime;
  const endAt = gameOverEndAt(game, fallbackEndAt);
  // 本回合：進行中＝現在 − 回合開始；終局＝結束 − 最後一回合開始；其他階段（開局準備）＝0
  const live = cts === undefined ? 0
    : game.phase === 'playing' ? Math.max(0, nowMs - cts)
    : game.phase === 'game-over' && endAt !== null ? Math.max(0, endAt - cts)
    : 0;
  const liveOwner = (game.phase === 'playing' || game.phase === 'game-over') ? game.activePlayerIndex : null;
  const stored = game.playerTurnTimeMs ?? [0, 0];
  const p0 = (stored[0] ?? 0) + (liveOwner === 0 ? live : 0);
  const p1 = (stored[1] ?? 0) + (liveOwner === 1 ? live : 0);
  // 總時間：進行中＝現在 − 開局；終局＝（最後一回合開始＋最後一回合）− 開局（拿不到結束時刻就停在最後一回合開始，跟舊版一樣）
  const total = game.gameStartTime === undefined ? 0
    : Math.max(0, (game.phase === 'game-over' ? (cts ?? nowMs) + live : nowMs) - game.gameStartTime);
  return { live, p0, p1, total };
}
