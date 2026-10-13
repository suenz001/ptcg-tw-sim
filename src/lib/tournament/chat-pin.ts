// ⭐v6.562 錦標賽大廳聊天室的「置頂公告」（站長 2026-10-13）。
//   資料來源：伺服器 v1.65 的 GET /api/tourn-chat-pin（admin 在賽事分頁設定）。舊伺服器 404 ⇒ 不顯示。
//   玩家按 X ⇒ 記住「這一則」（id＝公告的更新時間）已隱藏；站長發新的公告（id 變了）會再出現。
//   ⚠ localStorage 可能讀寫失敗（私密模式）⇒ 一律 try/catch，失敗就只在這次頁面內隱藏。

export const CHAT_PIN_URL = '/api/tourn-chat-pin';
export const CHAT_PIN_DISMISS_KEY = 'ptcg_tchat_pin_dismissed_v1';
/** 前端自己節流：聊天室每 3 秒輪詢，公告只要每 30 秒問一次。 */
export const CHAT_PIN_REFRESH_MS = 30 * 1000;

export interface ChatPin { id: string; text: string; at: number }

/** 伺服器回應 → 公告（沒有／格式不對 ⇒ null）。 */
export function parseChatPin(j: unknown): ChatPin | null {
  const o = j as { pinApi?: unknown; pin?: { id?: unknown; text?: unknown; at?: unknown } | null } | null;
  if (!o || o.pinApi !== 1 || !o.pin) return null;
  const text = typeof o.pin.text === 'string' ? o.pin.text.trim() : '';
  const id = typeof o.pin.id === 'string' ? o.pin.id : '';
  if (!text || !id) return null;
  return { id, text, at: Number(o.pin.at) || 0 };
}

/** 這則公告要不要顯示：有公告、而且不是玩家已經按 X 隱藏的那一則。 */
export function chatPinVisible(pin: ChatPin | null, dismissedId: string | null): boolean {
  return !!pin && pin.id !== dismissedId;
}

export function loadDismissedPinId(): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(CHAT_PIN_DISMISS_KEY) : null; } catch { return null; }
}
export function saveDismissedPinId(id: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(CHAT_PIN_DISMISS_KEY, id); } catch { /* 私密模式：只在這次頁面內隱藏 */ }
}
