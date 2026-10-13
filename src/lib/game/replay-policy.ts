// ⭐v6.560 站長裁定（2026-10-13）：「線上對戰的復盤能不能看到對手的手牌和獎賞卡 … 請你先幫我在 admin 監控那邊做一個開關，
//   先預設是看不到對方的，如果有很多玩家反應希望能看到的話，我再去 admin 監控那邊改」
//
// ・設定存在 Firestore `config/cardPolicy` 的 `replayRevealOpp` 欄位（只有明確 true 才算開；沒有或其他值＝關）。
//   掛在卡牌政策同一份文件 ⇒ 玩家端不多一次讀取（比照 v6.472 卡圖來源 thumbSource）。
// ・policy-loader 讀到後寫進 localStorage；本模組載入時同步讀一次，沒有就是預設「看不到」。
// ・只影響「休閒線上對戰」：本機雙人／vs AI 是同一個人，一律全部攤開；錦標賽回放維持原本的全部攤開。
// ・在**存檔當下**套用（遮住的資訊根本不寫進復盤檔），之後改開關不會回頭影響已存的復盤。

export const REPLAY_REVEAL_KEY = 'ptcg_replay_reveal_opp_v1';

let _reveal = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(REPLAY_REVEAL_KEY) === '1'; } catch { return false; }
})();

/** policy-loader 讀到 Firestore 設定時呼叫（只有 true 才開）。 */
export function setReplayRevealOppPref(v: unknown): void {
  _reveal = v === true;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(REPLAY_REVEAL_KEY, _reveal ? '1' : '0'); } catch { /* */ }
}

/** 線上對戰的復盤要不要保留對手的手牌與獎賞卡。 */
export function replayRevealsOpponent(): boolean { return _reveal; }
