/**
 * ⭐v6.600 復盤的「勝敗＋雙方牌組」標示與下載檔名（玩家建議，站長 2026-10-24 裁定）。
 *
 * 站長裁定：
 *   ・我方顯示玩家自己取的牌組名稱（玩家比較喜歡自己取的）；對手顯示牌組原型（伺服器分類，不洩漏牌表）。
 *   ・錦標賽的對手牌組查不到 ⇒ 顯示「未知」可以接受。
 *   ・本機的對戰（本機雙人、vs AI）完全不記錄復盤（v6.563 起就只記線上連線對戰）。
 *
 * 資料都放在 ReplayMeta 的選填欄位（result／myDeckName／oppDeckName）：
 *   ・舊的復盤檔沒有這些欄位 ⇒ 勝敗盡量從「記錄者坐哪一側＋勝者名稱」推回來，推不出來就不顯示；檔名退回舊格式。
 *   ・REPLAY_FORMAT_VERSION 不升：舊版網站讀新檔只是忽略多出來的欄位（升版會讓舊版網站拒收）。
 *
 * 判準只在這一支（Rule 38：復盤清單、下載檔名、對戰頁問對手原型的時機都呼叫這裡；播放畫面本版不顯示）。
 */

export type ReplayResult = 'win' | 'loss' | 'draw';

/** 本機的對戰（本機雙人、vs AI）——站長：完全不需要任何復盤紀錄（不記、不列、存新紀錄時清掉舊的）。 */
export function isLocalReplayKind(kind: unknown): boolean {
  return kind === 'local' || kind === 'ai';
}

/** 牌組名稱的長度上限（存檔時截斷；畫面上長名稱會換行）。 */
export const REPLAY_DECK_NAME_MAX = 40;
/** 對手牌組不明時的顯示字樣（站長同意「未知」）。 */
export const REPLAY_DECK_UNKNOWN = '未知';

type MetaLike = {
  viewerSeat?: unknown; winnerName?: unknown; p1name?: unknown; p2name?: unknown;
  result?: unknown; myDeckName?: unknown; oppDeckName?: unknown; kind?: unknown;
} | null | undefined;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** 存檔前清理牌組名稱：去掉控制字元、壓空白、截長度；空的 ⇒ null。 */
export function cleanReplayDeckName(v: unknown): string | null {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, REPLAY_DECK_NAME_MAX) : null;
}

/**
 * 對局結束當下算勝敗（記錄者的視角）。
 *   winner 是 0／1 ⇒ 跟記錄者同側＝勝、不同側＝敗；winner 不是 0／1 且已經 game-over ⇒ 平手（例：時限到雙方皆判敗、同時取完獎賞）。
 *   記錄者不是 P1／P2（觀戰、admin）或對局沒結束 ⇒ null（不標）。
 */
export function computeReplayResult(finalState: { winner?: unknown; phase?: unknown } | null | undefined, seat: unknown): ReplayResult | null {
  if (seat !== 0 && seat !== 1) return null;
  if (!finalState || finalState.phase !== 'game-over') return null;
  const w = finalState.winner;
  if (w === 0 || w === 1) return w === seat ? 'win' : 'loss';
  return 'draw';
}

/**
 * 顯示用的勝敗：新檔直接讀 meta.result；舊檔從「記錄者坐哪一側＋勝者名稱」推回來
 *   （雙方同名就分不出來 ⇒ null，寧可不標也不標錯）。
 */
export function replayResultOf(meta: MetaLike): ReplayResult | null {
  const r = meta?.result;
  if (r === 'win' || r === 'loss' || r === 'draw') return r;
  const seat = meta?.viewerSeat;
  if (seat !== 0 && seat !== 1) return null;
  const me = str(seat === 0 ? meta?.p1name : meta?.p2name), opp = str(seat === 0 ? meta?.p2name : meta?.p1name);
  const w = str(meta?.winnerName);
  if (!me || !opp || me === opp || !w) return null;
  return w === me ? 'win' : w === opp ? 'loss' : null;
}

export const REPLAY_RESULT_LABEL: Record<ReplayResult, string> = { win: '勝', loss: '敗', draw: '平手' };

/** 勝敗字樣：錦標賽沒有勝者＝時限到雙方皆判敗 ⇒「雙敗」（與「我的錦標賽對戰」清單同一個用詞）；其餘照表。 */
export function replayResultLabel(meta: MetaLike): string {
  const r = replayResultOf(meta);
  if (!r) return '';
  return r === 'draw' && meta?.kind === 'tournament' ? '雙敗' : REPLAY_RESULT_LABEL[r];
}

/** 有沒有任何牌組資訊（舊檔都沒有 ⇒ 畫面不多一行、檔名維持舊格式）。 */
export function replayHasDeckInfo(meta: MetaLike): boolean {
  return !!(str(meta?.myDeckName) || str(meta?.oppDeckName));
}

/** 清單／復盤畫面的牌組行：「我：沙奈朵ex vs 對手：密勒頓ex」；沒有任何牌組資訊 ⇒ ''。 */
export function replayDeckLine(meta: MetaLike): string {
  if (!replayHasDeckInfo(meta)) return '';
  return `我：${str(meta?.myDeckName) ?? REPLAY_DECK_UNKNOWN} vs 對手：${str(meta?.oppDeckName) ?? REPLAY_DECK_UNKNOWN}`;
}

/** 檔名片段：去掉 Windows／macOS 不能用的字元與空白，截 16 字（沿用 v6.560 的規則）。 */
export function replayFileSafe(s: string | null | undefined): string {
  return String(s ?? '?').replace(/[\\/:*?"<>|\s\u0000-\u001f]+/g, '_').slice(0, 16) || '_';   // 片段一律接在「復盤-」或「-」後面，不會出現在檔名開頭
}

/**
 * ⭐v6.600（審查 P2-1）對戰頁什麼時候可以問伺服器「對手的牌組原型」。
 *   伺服器 /api/rooms-archetypes 的快取只用房號當 key、存 5 分鐘 ⇒ 同一個房號 5 分鐘內再開一局，可能拿到上一局的原型，
 *   而復盤會把它永久存下來。不改伺服器的解法：等這一局開打超過 5 分鐘（＋10 秒餘裕）才問——
 *   那時伺服器回的任何快取都一定是這一局開打後才算的（status=playing、phase=playing 時才會寫快取）。
 *   代價：開打 5 分鐘內就結束的對局（投降、速攻）對手顯示「未知」。
 */
export const REPLAY_ARCH_FRESH_MS = 310_000;
export function canAskOppArchetype(o: { opp: string | null; busy: boolean; tries: number; oracle: boolean; roomCode: string; seat: unknown; gameStartTime: unknown; now: number; clockSynced: boolean }): boolean {
  if (o.opp || o.busy || o.tries >= 6 || !o.oracle || !o.roomCode) return false;
  if (!o.clockSynced) return false;   // 複審 P3：還沒跟伺服器對時（重新整理後、自己第一次送出動作前）⇒ 本機時鐘可能偏很多，先不問
  if (o.seat !== 0 && o.seat !== 1) return false;
  const t0 = o.gameStartTime;
  return typeof t0 === 'number' && t0 > 0 && o.now - t0 >= REPLAY_ARCH_FRESH_MS;
}
/** 伺服器回應 → 對手（另一側）的原型名稱；查不到 ⇒ null。房號一律大寫。 */
export function oppArchetypeFrom(rooms: Record<string, { p1: string | null; p2: string | null }> | null | undefined, roomCode: string, seat: 0 | 1): string | null {
  const r = rooms ? rooms[String(roomCode).toUpperCase()] : null;
  const name = r ? (seat === 0 ? r.p2 : r.p1) : null;
  return typeof name === 'string' && name ? name : null;
}

/**
 * 下載檔名。
 *   新格式：復盤-勝-我的牌組-vs-對手牌組-20261024-2130.ptcgreplay
 *     ・勝敗不明 ⇒ 省略那一段；對手牌組不明 ⇒ 用對手的玩家名稱（檔名裡放「未知」看不出是哪一場）。
 *   沒有任何牌組資訊、也沒有勝敗（舊檔、觀戰者下載）⇒ 舊格式：復盤-P1名-vs-P2名-時間。
 */
export function replayFileName(meta: MetaLike, ymd: string): string {
  const res = replayResultOf(meta);
  if (!replayHasDeckInfo(meta)) {
    if (!res) return `復盤-${replayFileSafe(str(meta?.p1name))}-vs-${replayFileSafe(str(meta?.p2name))}-${ymd}.ptcgreplay`;
  }
  const seat = meta?.viewerSeat;
  const meName = str(seat === 1 ? meta?.p2name : meta?.p1name), oppName = str(seat === 1 ? meta?.p1name : meta?.p2name);
  const mine = str(meta?.myDeckName) ?? meName;
  const theirs = str(meta?.oppDeckName) ?? oppName;
  return `復盤${res ? '-' + replayResultLabel(meta) : ''}-${replayFileSafe(mine)}-vs-${replayFileSafe(theirs)}-${ymd}.ptcgreplay`;
}
