/**
 * v6.114 大廳「對戰中房間」場面預覽 —— 單一中央管線。
 *
 * 玩家許願：「希望可以在對戰房間外面顯示裡面對戰的卡組，例如雙方戰鬥區跟備戰區目前放的
 * 寶可夢，這樣想觀戰特定卡組學習的時候比較方便找。」
 *
 * 為什麼要有這個檔案（而不是在 +page.svelte 就地讀 gameState）：
 *   1. 公平性單一守門點。大廳拿到的房間資料（測試站是整份 room doc）裡面有雙方手牌、
 *      牌庫、獎賞卡內容。UI 只能吃這裡吐出來的 preview 物件，永遠碰不到隱藏區。
 *      本函式一律「白名單建構」（逐欄位挑出來組新物件），不是「複製後 delete 掉私有欄位」——
 *      後者只要來源多一個欄位就會靜默外洩。
 *   2. 批 2 正式站（Oracle）會加一個伺服器端摘要端點，回傳的形狀就是這裡的 LobbyFieldPreview，
 *      UI 端不必再改一次。
 */

/** 單邊的場面摘要 —— 全部都是 PTCG 規則上的公開資訊。 */
export interface LobbyFieldSide {
  /** 戰鬥區寶可夢（進化堆最上面那張）的 cardId；空場為 null */
  activeCardId: string | null;
  /** 備戰區寶可夢的 cardId（依場上順序） */
  benchCardIds: string[];
  /** 剩餘獎賞卡「張數」—— 只有數量，沒有內容 */
  prizesLeft: number;
}

/**
 * per-player 欄位一律用 { p1, p2 } 物件，不要用 T[][]。
 * Firestore 不支援巢狀陣列，一旦這個形狀未來被寫進房間文件就整份寫不進去（v6.056 事故）。
 * 目前本型別是純讀不寫，但形狀先訂對，避免以後有人順手拿去存。
 */
export interface LobbyFieldPreview {
  turn: number;
  sides: { p1: LobbyFieldSide; p2: LobbyFieldSide };
}

/** 從單一 player 物件抽出公開摘要（白名單）。 */
function pickSide(p: unknown): LobbyFieldSide {
  const pl = (p ?? {}) as Record<string, unknown>;
  const active = pl.active as Record<string, unknown> | null | undefined;
  const bench = Array.isArray(pl.bench) ? (pl.bench as Record<string, unknown>[]) : [];
  const prizes = Array.isArray(pl.prizes) ? (pl.prizes as unknown[]) : [];
  return {
    activeCardId: typeof active?.cardId === 'string' ? active.cardId : null,
    benchCardIds: bench
      .filter((b) => typeof b?.cardId === 'string')
      .map((b) => String(b.cardId)),
    prizesLeft: prizes.length,
  };
}

/**
 * 從一份房間資料建立場面預覽；任何一個前提不成立就回 null（UI 不顯示這一行）。
 *
 * setup 階段一律回 null：對戰畫面裡 oppHidden = (game.phase === 'setup')，
 * 也就是開局放置期間雙方互相看不到對方場面。房間在這個階段 status 已經是 playing，
 * 若大廳照畫，玩家只要另開一個分頁看大廳，就能偷看對手還沒揭示的備戰區 —— 這是真的洩漏。
 *
 * 只給「對戰中」的房間用。等待中（lobby）的房間永遠不呼叫本函式：
 * 雙方已選牌組但還沒開打，先看到對方牌組再決定要不要加入＝牌組狙擊。
 * （伺服器 GET /api/rooms 特意把 seats.deckEntries projection 掉，就是同一個理由。）
 */
export function buildLobbyFieldPreview(room: unknown): LobbyFieldPreview | null {
  const gs = (room as Record<string, unknown> | null | undefined)?.gameState as
    | Record<string, unknown>
    | null
    | undefined;
  if (!gs) return null;
  if (gs.phase !== 'playing') return null; // setup / game-over 都不預覽
  const players = gs.players;
  if (!Array.isArray(players) || players.length < 2) return null;
  const p1 = pickSide(players[0]);
  const p2 = pickSide(players[1]);
  // 雙方都空場（資料還沒同步完）就不要畫一排空格
  if (
    !p1.activeCardId && !p2.activeCardId &&
    p1.benchCardIds.length === 0 && p2.benchCardIds.length === 0
  ) {
    return null;
  }
  return {
    turn: typeof gs.turn === 'number' && gs.turn > 0 ? gs.turn : 1,
    sides: { p1, p2 },
  };
}

/**
 * 卡圖 URL：大廳頁還沒載入卡片資料庫（pool 是進對戰後才依牌組載入的），
 * 所以這裡不查卡名，直接由 cardId 合成台灣官方卡圖網址。
 *
 * 全站 live 卡片（index.json 列出的卡包）共 4358 張，其中 4353 張的 imageUrl
 * 就是「tw + id 補零到 8 位」。下面這張表是僅有的例外，由 test-v6114-lobby-preview.mjs
 * 掃描 static/cards 逐張比對把關 —— 以後新卡若又出現例外而沒補進表裡，測試會紅燈。
 */
export const CARD_IMG_EXCEPTIONS: Readonly<Record<string, string>> = Object.freeze({
  // M-P 促銷：官方只提供港版圖
  '18965': 'https://asia.pokemon-card.com/hk/card-img/hk00018965.png',
  '18969': 'https://asia.pokemon-card.com/hk/card-img/hk00018969.png',
  // M6 傳說競技場三張：不同編號共用同一張官方卡圖
  '19624': 'https://asia.pokemon-card.com/tw/card-img/tw00019621.png',
  '19625': 'https://asia.pokemon-card.com/tw/card-img/tw00019622.png',
  '19626': 'https://asia.pokemon-card.com/tw/card-img/tw00019623.png',
});

export function lobbyCardImageUrl(cardId: string): string {
  const ex = CARD_IMG_EXCEPTIONS[cardId];
  if (ex) return ex;
  const n = Number(cardId);
  if (!Number.isFinite(n) || n <= 0) return '';
  return 'https://asia.pokemon-card.com/tw/card-img/tw' + String(n).padStart(8, '0') + '.png';
}
