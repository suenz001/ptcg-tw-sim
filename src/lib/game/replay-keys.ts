/**
 * ⭐ v6.649 回放的鍵盤快捷鍵（R1）：判準唯一一份，對戰頁只負責把動作接到既有的 tReplayGoto／prevTurnStepIndex／nextTurnStepIndex／replayTogglePlay。
 *
 *   ←／→         上一步／下一步
 *   Shift+←／→   上一回合／下一回合（同既有「⏪ 上一回合」「下一回合 ⏩」按鈕）
 *   空白鍵        播放／暫停
 *
 * 不處理（交回瀏覽器原本的行為，也不 preventDefault）：
 *   ・輸入法組字中（isComposing／keyCode 229）、按著 Ctrl／Alt／⌘。
 *   ・焦點在可輸入的地方：input（含時間軸 range）、textarea、select、contenteditable、role=textbox／slider／spinbutton／combobox。
 *   ・焦點在本身就會吃方向鍵的元件（role=tab／radio／menuitem／option／listbox…）⇒ 方向鍵交還。
 *   ・焦點在按鈕／連結 ⇒ 空白鍵交還（瀏覽器會按下那顆按鈕；不可以變成「按了按鈕又切換播放」）；方向鍵按鈕本身不用，照常處理。
 *     例外：回放自己的控制鈕（REPLAY_KEY_OWN_CONTROLS）⇒ 空白鍵仍是播放／暫停（並 preventDefault，不會按下那顆鈕）。
 *   ・Esc 一律不碰（各視窗既有的關閉行為）。
 * 長按（repeat）：方向鍵可以連續走（對戰頁另外節流）；空白鍵只認第一下（避免播放／暫停一直閃），repeat 仍吃掉以免整頁捲動。
 */

export type ReplayKeyAction = 'prev' | 'next' | 'prevTurn' | 'nextTurn' | 'toggle' | 'swallow' | null;

export interface ReplayKeyEventLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
}

/** 可以輸入文字或本身用方向鍵／空白鍵操作的元件 ⇒ 整個交還。 */
export const REPLAY_KEY_EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="searchbox"]';
/** 本身用方向鍵操作的元件 ⇒ 方向鍵交還。 */
export const REPLAY_KEY_ARROW_NATIVE =
  '[role="tab"], [role="tablist"], [role="radio"], [role="radiogroup"], [role="menu"], [role="menuitem"], [role="option"], [role="listbox"], [role="tree"], [role="treeitem"], [role="grid"]';
/** 回放自己的控制鈕（控制列、紀錄欄頂端、定位鈕）：點過之後焦點會停在上面 ⇒ 空白鍵照樣是「播放／暫停」，不去按那顆鈕（審查 P3-4）。 */
export const REPLAY_KEY_OWN_CONTROLS = '.treplay-bar button:not(.treplay-exit):not(.treplay-share):not(.treplay-tick):not(.treplay-faint), .log-replay-head button, .log-locate';
// ↑ v6.650：時間軸記號（回合／昏厥）上的空白鍵照常按下它（跳到那一步），不切換播放
// ↑「✕ 離開」「🔗 複製連結」不算：鍵盤使用者用空白鍵按它們時照常按下（複審建議）
/** 空白鍵會「按下去」的元件 ⇒ 空白鍵交還。 */
export const REPLAY_KEY_SPACE_NATIVE = 'button, a[href], summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="radio"], [role="menuitem"], [role="option"]';

/**
 * 開著時回放不吃鍵盤的視窗／遮罩（卡片放大、獎賞卡、棄牌區、設定、確認視窗……）。
 * ⚠ 新增全螢幕遮罩時要加進來；守衛會掃對戰頁每個帶 *-overlay／*-backdrop／*-mask 的元素，確認它至少有一個 class 在清單裡（或列在 REPLAY_KEY_NON_BLOCKING）。
 */
export const REPLAY_KEY_BLOCKING_OVERLAYS =
  '.zoom-overlay, .selection-overlay, .pv-overlay, .modal-overlay, .lightbox-overlay, .hof-modal-backdrop, .forfeit-modal-backdrop, .float-evo-backdrop, .prize-pick-overlay, .cm-found-backdrop, .tourn-vergate-mask, .coin-overlay, .coin-flip-overlay, [role="dialog"], [aria-modal="true"]';
/** 不擋鍵盤的「遮罩」：卡圖上的附件裝飾、回合橫幅（一閃即逝）、抽牌飛行動畫（pointer-events:none）。守衛用。 */
export const REPLAY_KEY_NON_BLOCKING = ['tt-attach-overlay', 'turn-banner-overlay', 'draw-fly-overlay'];

interface ClosestLike { closest(sel: string): unknown }
const isEl = (t: unknown): t is ClosestLike => !!t && typeof (t as ClosestLike).closest === 'function';

/** 這個按鍵在回放裡要做什麼；null＝不處理（不可 preventDefault）。 */
export function replayKeyAction(e: ReplayKeyEventLike, target: unknown): ReplayKeyAction {
  if (!e || typeof e.key !== 'string') return null;
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = e.key;
  const isArrow = k === 'ArrowLeft' || k === 'ArrowRight';
  const isSpace = k === ' ' || k === 'Spacebar';
  if (!isArrow && !isSpace) return null;
  if (isEl(target)) {
    if (target.closest(REPLAY_KEY_EDITABLE)) return null;
    if (isArrow && target.closest(REPLAY_KEY_ARROW_NATIVE)) return null;
    if (isSpace && target.closest(REPLAY_KEY_SPACE_NATIVE) && !target.closest(REPLAY_KEY_OWN_CONTROLS)) return null;
  }
  if (isSpace) {
    if (e.shiftKey) return null;
    return e.repeat ? 'swallow' : 'toggle';
  }
  if (k === 'ArrowLeft') return e.shiftKey ? 'prevTurn' : 'prev';
  return e.shiftKey ? 'nextTurn' : 'next';
}
