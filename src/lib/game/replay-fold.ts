// ⭐v6.564 開始對戰頁「最近的對戰復盤」兩個清單（🌐 線上連線對戰／🏆 我的錦標賽對戰）可以收合（站長 2026-10-13）。
//   預設展開（維持 v6.563 的樣子）；收合狀態只記在這台瀏覽器（localStorage），讀寫失敗（私密模式）就當成預設、不丟例外。

export const REPLAY_FOLD_KEY = 'ptcg_replay_fold_v1';
export type ReplayFoldSection = 'online' | 'tourn';
/** true＝展開 */
export interface ReplayFoldState { online: boolean; tourn: boolean }

export const REPLAY_FOLD_DEFAULT: ReplayFoldState = { online: true, tourn: true };

/** 存的字串 → 狀態（壞掉、缺欄位 ⇒ 該欄用預設展開）。 */
export function parseReplayFold(raw: string | null | undefined): ReplayFoldState {
  try {
    const o = raw ? JSON.parse(raw) : null;
    return {
      online: typeof o?.online === 'boolean' ? o.online : REPLAY_FOLD_DEFAULT.online,
      tourn: typeof o?.tourn === 'boolean' ? o.tourn : REPLAY_FOLD_DEFAULT.tourn,
    };
  } catch { return { ...REPLAY_FOLD_DEFAULT }; }
}

/** 切換某一區，回傳新狀態（不改傳進來的物件）。 */
export function toggleReplayFoldState(s: ReplayFoldState, sec: ReplayFoldSection): ReplayFoldState {
  return { ...s, [sec]: !s[sec] };
}

export function loadReplayFold(): ReplayFoldState {
  try { return parseReplayFold(typeof localStorage !== 'undefined' ? localStorage.getItem(REPLAY_FOLD_KEY) : null); }
  catch { return { ...REPLAY_FOLD_DEFAULT }; }
}
export function saveReplayFold(s: ReplayFoldState): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(REPLAY_FOLD_KEY, JSON.stringify({ online: s.online, tourn: s.tourn })); }
  catch { /* 私密模式：只在這次頁面內有效 */ }
}
