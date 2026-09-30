/**
 * ⭐v6.457 中央：彈出視窗開著時，**手機（觸控）上**鎖住後面的整頁，手指滑動不會捲到背景。
 *
 * 起因（站長 2026-09-30）：手機版「查詢卡片」（卡牌資料庫 /cards、牌組編輯 /decks 的卡片詳情）時，
 *   ① 在詳情視窗裡滑到底之後再滑 ⇒ 整頁跟著往下捲（捲動鏈 scroll chaining）；
 *   ② 手指在深色遮罩上滑 ⇒ 直接捲背景；③ 放大圖（lightbox）上滑也捲背景。
 *   實測（Playwright 390×844 觸控）：背景 scrollY 485 → 2191。
 *
 * 作法（與對戰頁手機直式 body.mp-locked 同一套思路，但這裡是通用 action）：
 *   鎖定時 body 改 position:fixed、top = −原本捲動量 ⇒ 背景完全不能被捲、畫面也不跳；
 *   解鎖時還原 body 樣式並 scrollTo 回原位。**引用計數**：視窗上再疊放大圖（兩層都鎖）時，最後一層關掉才解鎖。
 *
 * ⚠ 只在觸控裝置（hover:none 且 pointer:coarse）鎖；桌機維持站長定的規則——
 *   「滑鼠停在卡片區滾動時只捲卡片，移到卡片區外面才捲得動整個視窗」：
 *   桌機這邊由視窗內容區的 overscroll-behavior:contain 擋掉「捲到底把整頁帶走」，遮罩上滾輪仍捲整頁。
 *
 * 用法：在遮罩元素上 `use:pageScrollLock`（元素存在＝鎖、元素移除＝解鎖）。禁止各頁自己再寫一套 body 鎖。
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

/** Svelte action：掛在彈出視窗的遮罩上。 */
export function pageScrollLock(_node: HTMLElement) {
  const release = lockPageScroll();
  return { destroy: release };
}

/** 測試用：目前的鎖數。 */
export function _pageScrollLockCount(): number {
  return lockCount;
}
