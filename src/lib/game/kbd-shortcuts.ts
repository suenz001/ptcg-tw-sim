// ⭐v6.488 電腦版牌桌鍵盤快捷鍵（站長同意的建議 #7；預設關閉，在對戰頁「⚙️ 設定」裡打開）。
//
// 設計原則（Fable 5.1 建議＋站長同意）：
//   ・只做「確認選擇」與「開關對戰紀錄」這類**按錯也沒有損失**的動作；不做攻擊、結束回合等收不回來的動作。
//   ・不另外寫一套遊戲邏輯：快捷鍵等同「替玩家按畫面上那顆按鈕」——找得到、而且是唯一一顆、而且能按，才按。
//     ⇒ 按鈕本身的停用條件（還沒選夠、正在送出中）全部自動適用，不會跟畫面不一致。
//   ・輸入框、下拉選單、可編輯區裡打字時一律不攔；有 Ctrl／Alt／⌘ 時不攔；長按自動重複不算。
//   ・只在有滑鼠的裝置（hover:hover 且 pointer:fine）生效；手機與平板觸控完全不受影響。
// 已有的 Esc（關卡片放大、選單）由對戰頁原本的 onGlobalKey 處理，這裡不重複。

export const KBD_PREF_KEY = 'ptcg_kbd_shortcuts';
export type KbdAction = 'confirm' | 'log';

/** 選擇視窗的「確定」鈕（選擇視窗底部 .sel-footer 的主要按鈕）。 */
export const CONFIRM_SELECTOR = '.sel-footer button.btn-act.primary';
/** 新版／桌墊版對戰紀錄的開關鈕。 */
export const LOG_TOGGLE_SELECTOR = '.log-toggle-btn';

export function kbdEnabled(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KBD_PREF_KEY) === '1'; } catch { return false; }
}
export function setKbdEnabled(on: boolean): void {
  try { if (on) localStorage.setItem(KBD_PREF_KEY, '1'); else localStorage.removeItem(KBD_PREF_KEY); } catch { /* 存不了就只是這次不生效 */ }
}

type KeyLike = { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean };
type TargetLike = { tagName?: string; isContentEditable?: boolean } | null;

/** 這個按鍵對應哪個快捷動作（純函式）；不該攔的回 null。 */
export function kbdActionFor(e: KeyLike, target: TargetLike): KbdAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return null;
  const tag = (target?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return null;
  if (e.key === 'Enter') {
    // 焦點在按鈕／連結／摺疊標題上時，Enter 本來就是按那個東西 ⇒ 不搶
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return null;
    return 'confirm';
  }
  if (e.key === 'l' || e.key === 'L') return 'log';
  return null;
}

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  return !!r && r.width > 0 && r.height > 0;
}

/** 找出「唯一一顆、看得到、可以按」的按鈕；0 顆或超過 1 顆都回 null（寧可不按也不要按錯）。 */
export function uniqueEnabledButton(doc: ParentNode, selector: string): HTMLButtonElement | null {
  const list = Array.from(doc.querySelectorAll<HTMLButtonElement>(selector)).filter((b) => !b.disabled && visible(b));
  return list.length === 1 ? list[0] : null;
}

function finePointer(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { return false; }
}

/** 對戰頁的全域 keydown 呼叫：有處理就 preventDefault 並回 true。 */
export function runKbdShortcut(e: KeyboardEvent, doc: Document = document): boolean {
  if (!kbdEnabled() || !finePointer()) return false;
  const act = kbdActionFor(e, e.target as TargetLike);
  if (!act) return false;
  const btn = uniqueEnabledButton(doc, act === 'confirm' ? CONFIRM_SELECTOR : LOG_TOGGLE_SELECTOR);
  if (!btn) return false;
  e.preventDefault();
  btn.click();
  return true;
}
