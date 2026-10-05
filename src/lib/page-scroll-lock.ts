/**
 * ⭐v6.457／v6.458 中央：彈出視窗開著時，後面的整頁要不要跟著捲——全站只有這一份判準。
 *
 * 起因（站長 2026-09-30）：手機版「查詢卡片」（卡牌資料庫 /cards、牌組編輯 /decks 的卡片詳情）時，
 *   ① 在詳情視窗裡滑到底之後再滑 ⇒ 整頁跟著往下捲（捲動鏈 scroll chaining）；
 *   ② 手指在深色遮罩上滑 ⇒ 直接捲背景；③ 放大圖（lightbox）上滑也捲背景。
 *   實測（Playwright 390×844 觸控）：背景 scrollY 485 → 2191。
 *
 * 兩種裝置、兩套規則：
 *   【觸控（hover:none 且 pointer:coarse）】v6.457：開著就整頁鎖死——body 改 position:fixed、top = −原本捲動量，
 *     解鎖時還原並 scrollTo 回原位。**引用計數**：視窗上再疊放大圖（兩層都鎖）時，最後一層關掉才解鎖。
 *   【桌機（滑鼠）】v6.458 站長裁定：「**外面才捲整頁**」——
 *     ・滑鼠在視窗**裡面**（遮罩的任何子元素上）滾輪：只捲視窗裡可以捲的東西；沒得捲（內容不夠長、已捲到底）就什麼都不動，
 *       **絕不**傳到後面的整頁（v6.457 以前內容不夠長時會捲到背景）；
 *     ・滑鼠在**外面**（遮罩本身，或標了 `data-scroll-outside` 的透明背景鈕）滾輪：照常捲整頁。
 *     ・Ctrl＋滾輪（瀏覽器縮放）不擋。
 *
 * 用法：在遮罩元素上 `use:pageScrollLock`（元素存在＝生效、元素移除＝解除）。禁止各頁自己再寫一套 body 鎖或滾輪攔截。
 *   遮罩裡若另有一層「點了會關閉」的透明背景元素（例：牌組編輯戰績視窗的 .ds-backdrop），在它身上標 `data-scroll-outside`。
 */

let lockCount = 0;
let savedY = 0;
let savedStyle: { position: string; top: string; left: string; right: string; width: string; overflow: string } | null = null;

/** 這台裝置要不要鎖（觸控為主的裝置）。SSR／沒有 matchMedia ⇒ 不鎖。 */
export function shouldLockPageScroll(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** 鎖住整頁；回傳解鎖函式（可重複呼叫，只會解一次）。 */
export function lockPageScroll(): () => void {
  if (typeof document === 'undefined' || !shouldLockPageScroll()) return () => {};
  if (lockCount === 0) {
    const b = document.body.style;
    savedY = window.scrollY;
    savedStyle = { position: b.position, top: b.top, left: b.left, right: b.right, width: b.width, overflow: b.overflow };
    b.position = 'fixed';
    b.top = `-${savedY}px`;
    b.left = '0';
    b.right = '0';
    b.width = '100%';
    b.overflow = 'hidden';
    document.documentElement.classList.add('page-scroll-locked');
  }
  lockCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0 && savedStyle) {
      const b = document.body.style;
      b.position = savedStyle.position;
      b.top = savedStyle.top;
      b.left = savedStyle.left;
      b.right = savedStyle.right;
      b.width = savedStyle.width;
      b.overflow = savedStyle.overflow;
      savedStyle = null;
      document.documentElement.classList.remove('page-scroll-locked');
      window.scrollTo({ top: savedY, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  };
}

/** 這個元素現在能不能往 (dx, dy) 方向再捲一點（overflow 是 auto／scroll 而且還沒到底）。 */
function canScrollToward(el: Element, dx: number, dy: number): boolean {
  const cs = getComputedStyle(el);
  if (dy !== 0 && /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
    if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
  }
  if (dx !== 0 && /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
    if (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0) return true;
  }
  return false;
}

/**
 * 桌機滾輪判準（純函式，方便守衛直接驗）：這一下滾輪要不要擋掉（＝不讓它捲到後面的整頁）。
 *   外面（遮罩本身／data-scroll-outside）⇒ 不擋；裡面 ⇒ 沿著祖先往上找，有人還捲得動就不擋（讓它自己捲），全都捲不動就擋。
 */
export function shouldBlockWheel(overlay: Element, target: Element | null, dx: number, dy: number, ctrlKey = false): boolean {
  if (ctrlKey || !target) return false;
  if (target === overlay || target.closest('[data-scroll-outside]')) return false;
  for (let el: Element | null = target; el && el !== overlay; el = el.parentElement) {
    if (canScrollToward(el, dx, dy)) return false;
  }
  return true;
}

/** Svelte action：掛在彈出視窗的遮罩上。 */
export function pageScrollLock(node: HTMLElement) {
  const release = lockPageScroll();
  // ⭐v6.487 可及性：記下打開視窗前的焦點（通常是剛按的那顆按鈕），視窗關掉時還給它 ⇒ 鍵盤使用者不會被丟回頁面最上方。
  //   ⚠ 原本的焦點是輸入框時（例：搜尋框）、而且是觸控裝置 ⇒ 不還（還焦點會把手機鍵盤彈出來）。
  const prevFocus = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
  // 桌機才掛滾輪攔截（觸控裝置整頁已鎖，不需要）；passive:false 才能 preventDefault
  let onWheel: ((e: WheelEvent) => void) | null = null;
  if (typeof window !== 'undefined' && !shouldLockPageScroll()) {
    onWheel = (e: WheelEvent) => {
      if (shouldBlockWheel(node, e.target as Element | null, e.deltaX, e.deltaY, e.ctrlKey)) e.preventDefault();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
  }
  return {
    destroy() {
      release();
      if (onWheel) node.removeEventListener('wheel', onWheel);
      restoreFocusAfterModal(prevFocus, node);
    },
  };
}

/** ⭐v6.487 視窗關閉後把焦點還給打開它的元素（純判斷＋動作，守衛直接測）。回傳有沒有還。 */
export function restoreFocusAfterModal(prev: HTMLElement | null, modal: HTMLElement | null): boolean {
  if (typeof document === 'undefined' || !prev || prev === document.body || !prev.isConnected) return false;
  if (modal && modal.contains(prev)) return false;
  const now = document.activeElement as HTMLElement | null;
  // 焦點已經被別的東西接走（不在 body、不在剛關掉的視窗裡、而且還在頁面上）⇒ 不搶
  if (now && now !== document.body && now.isConnected && !(modal && modal.contains(now))) return false;
  const tag = prev.tagName;
  if ((tag === 'INPUT' || tag === 'TEXTAREA' || prev.isContentEditable) && shouldLockPageScroll()) return false;
  try { prev.focus({ preventScroll: true }); } catch { return false; }
  return document.activeElement === prev;
}

/** 測試用：目前的鎖數。 */
export function _pageScrollLockCount(): number {
  return lockCount;
}
