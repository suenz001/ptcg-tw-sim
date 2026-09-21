/**
 * ⭐⭐⭐ v6.420：對戰畫面所有浮動視窗的「拖曳 + 邊界夾制」**唯一**來源（Svelte action）。
 *
 * 【為什麼要有這一份】玩家回報：手機上把視窗不小心拖到側邊（有時候會自己彈走）之後
 *   **關不掉、也不能做任何動作** —— 視窗被拖出可視範圍，關閉鈕跟著出去了，
 *   而背景又被 overlay 蓋住 ⇒ 整個畫面卡死，只能重新整理。
 *
 * 【根因有兩個，都在這裡根治】
 *   ① 位移**沒有夾制**：舊寫法直接 `offset = start + delta`，要多遠有多遠。
 *   ② 判準**寫了兩份**：桌機版（game/+page.svelte 的 modalOffset／onModalHeaderPointer*）
 *      與手機直式版（MobilePortraitBattle.svelte 的 sheetOffset／onSheetHeaderPointer*）
 *      各自一份，改一邊另一邊不會跟著動（IRON_RULES Rule 38）。
 *   ⇒ 這一份同時服務兩邊，而且**每個視窗各自持有自己的位移**（舊寫法是同一個
 *     `modalOffset` 被十幾個視窗共用 ⇒ 開了 A 拖過、再開 B 會直接出現在被拖走的位置）。
 *
 * 【夾制規則】（`clampModalOffset`，純函式、可單元測）
 *   **視窗一律完整留在可視範圍內** —— 不是「留一角」。
 *   ⚠⚠ 這條規則是實測改出來的：一開始寫成「至少留 72px 在畫面內」，
 *     Playwright 實測往**右**拖時關閉鈕（在視窗右上角）照樣跑出畫面
 *     ⇒ 玩家還是關不掉。留一角救不了「關閉鈕在另一角」的情形。
 *   ・視窗比畫面小：位移夾在 `[0, vw - width]`／`[0, vh - height]` ⇒ 一個像素都不會露出畫面外。
 *   ・**水平**：視窗比畫面寬時夾在 `[vw - width, 0]` ⇒ 可以左右拖著看，但不會露白。
 *   ・**垂直**：上緣一律 ≥ 0（把手與關閉鈕都在頂端，出畫面就再也抓不回來）；
 *     視窗比畫面高時靠內部捲動看下半部（站內每個視窗都有 max-height ＋ overflow）。
 *   ⇒ 不論視窗多大、關閉鈕在哪一角，**永遠點得到**；而 overlay 會讓出下方畫面（`dragged`），
 *     所以「拖開看下方戰況」的目的仍然達成。
 *
 * 【使用】`<div class="xxx-modal" use:modalDrag={{ handle: '.sel-header' }}>`
 *   ・`handle`：把手的 CSS 選擇器（事件委派，不需要在掛載時就存在）。
 *     省略時用 `DEFAULT_HANDLE_SELECTOR`（站內所有把手的集合）。
 *   ・按在 `button / input / select / textarea / a / [role="button"]` 上時**不拖曳**
 *     （否則關閉鈕、確認鈕會按不到 —— 這正是玩家卡住的另一半原因）。
 *   ・拖曳開始後會給最近的 overlay 祖先加上 `dragged` class
 *     （站內既有約定：背景變透明 + `pointer-events:none` ⇒ 玩家看得到也點得到下方戰況）。
 *   ・視窗重新開啟（action 重新掛載）位移歸零；瀏覽器縮放／轉向時重新夾制。
 */

/**
 * 視窗比畫面大時允許溢出的方向仍然貼齊邊界；這個常數只留給守衛當「可視性下限」的門檻用。
 * ⚠ 夾制本身**不再**用「留一角」的語意（見檔頭），請勿再拿它當夾制量。
 */
export const MODAL_MIN_VISIBLE = 72;

/** 站內所有拖曳把手的集合（新視窗請沿用其中一個 class，不要再發明新的）。 */
export const DEFAULT_HANDLE_SELECTOR =
  '.modal-drag-handle, .sel-header, .mp-sheet-title, .tourn-bracket-head, .forfeit-title';

/** 按在這些元素上時不觸發拖曳（否則按鈕會按不到）。 */
export const DRAG_IGNORE_SELECTOR = 'button, input, select, textarea, a, [role="button"], [data-no-drag]';

/** 只取需要的四個數字，方便單元測（不依賴 DOMRect）。 */
export interface ModalRect { left: number; top: number; width: number; height: number; }
export interface ModalOffset { x: number; y: number; }

/**
 * 夾制位移，保證視窗不會被拖出可視範圍。
 * @param base  位移為 0 時視窗的位置與尺寸
 * @param off   想要套用的位移
 * @param vw/vh 可視範圍
 */
export function clampModalOffset(
  base: ModalRect, off: ModalOffset, vw: number, vh: number,
): ModalOffset {
  // 視窗左上角允許落在 [lo, hi]（畫面座標），再換算回位移。
  // 視窗比畫面小 ⇒ [0, vw - width]（完全在畫面內）；比畫面大 ⇒ [vw - width, 0]（不露白）。
  const loLeft = Math.min(0, vw - base.width);
  const hiLeft = Math.max(0, vw - base.width);
  // ⚠ 垂直**不允許**負值：把手與關閉鈕都在視窗頂端，上緣一出畫面就再也抓不回來
  //   （審查者實測：500×900 的視窗被允許拖到 top=-233 之後，從畫面內任何一點都抓不到把手）。
  //   視窗比畫面高時靠**內部捲動**看下半部 —— 站內每個視窗都有 max-height ＋ overflow。
  const loTop = 0;
  const hiTop = Math.max(0, vh - base.height);
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? lo : Math.min(Math.max(v, lo), hi));
  return {
    x: clamp(off.x, loLeft - base.left, hiLeft - base.left),
    y: clamp(off.y, loTop - base.top, hiTop - base.top),
  };
}

export interface ModalDragOptions {
  /** 把手選擇器（事件委派）。省略＝ DEFAULT_HANDLE_SELECTOR。 */
  handle?: string;
  /** 拖曳時要加上 `dragged` 的祖先選擇器。省略＝自動找最近的 overlay／backdrop。 */
  overlay?: string;
  /** 關掉拖曳（例如某個視窗刻意固定）。 */
  disabled?: boolean;
  /**
   * 換成「另一個」視窗內容時傳不同的值 ⇒ 位移歸零。
   * ⚠ 同一個 `{#if}` 區塊裡換 picker 時 DOM **不會重建**（action 不會重跑）
   *   ⇒ 不給 `resetKey` 的話，新的 picker 會直接出現在上一個被拖走的位置。
   */
  resetKey?: unknown;
}

const OVERLAY_SELECTOR = '[class*="overlay"], [class*="backdrop"]';

/** Svelte action：`use:modalDrag` / `use:modalDrag={{ handle: '.sel-header' }}`。 */
export function modalDrag(node: HTMLElement, param: ModalDragOptions = {}) {
  let opts: ModalDragOptions = { ...param };
  let off: ModalOffset = { x: 0, y: 0 };
  let base: ModalRect | null = null;
  let start: { sx: number; sy: number; ox: number; oy: number; pid: number } | null = null;
  let moved = false;

  const overlayEl = (): HTMLElement | null =>
    (opts.overlay ? node.closest<HTMLElement>(opts.overlay) : node.parentElement?.closest<HTMLElement>(OVERLAY_SELECTOR) ?? null);

  const view = () => ({
    vw: typeof window === 'undefined' ? 0 : window.innerWidth,
    vh: typeof window === 'undefined' ? 0 : window.innerHeight,
  });

  /** 量出「位移為 0 時」的位置（目前 rect 減掉目前位移）。 */
  function measure(): ModalRect {
    const r = node.getBoundingClientRect();
    return { left: r.left - off.x, top: r.top - off.y, width: r.width, height: r.height };
  }

  /**
   * ⚠⚠ 用**獨立的 `translate` 屬性**，不是 `transform`。
   *   站內有兩個視窗本來就靠 `transform` 定位（勝負視窗 `translate(-50%,-50%)` 置中、
   *   進化浮動選單 `translate(-50%,-105%)`）——寫 `style.transform` 會把那個定位蓋掉，
   *   實測（審查者 probe）選單拖 1px 就整個跳位、而且第一次拖曳的夾制基準是錯的。
   *   CSS `translate` 屬性在 `transform` **之前**套用且互相獨立 ⇒ 兩者自然疊加。
   */
  function apply() {
    node.style.translate = off.x === 0 && off.y === 0 ? '' : `${off.x}px ${off.y}px`;
  }

  function onDown(e: PointerEvent) {
    if (opts.disabled) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest(DRAG_IGNORE_SELECTOR)) return;
    if (!t.closest(opts.handle ?? DEFAULT_HANDLE_SELECTOR)) return;
    base = measure();
    start = { sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y, pid: e.pointerId };
    moved = false;
    try { node.setPointerCapture?.(e.pointerId); } catch { /* 某些瀏覽器不支援 */ }
    // ⚠ 放開的事件也掛在 window：pointer capture 失敗（或瀏覽器不支援）時，在視窗**外**放開
    //   node 收不到 pointerup ⇒ `start` 不會清 ⇒ 之後滑鼠只是**滑過**視窗，視窗就會跟著游標走
    //   （審查者實測 75→65px；舊碼同樣缺陷）。
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', onUp, { once: true });
      window.addEventListener('pointercancel', onUp, { once: true });
    }
    e.preventDefault();
  }
  function onMove(e: PointerEvent) {
    if (!start || !base) return;
    const { vw, vh } = view();
    const want = { x: start.ox + (e.clientX - start.sx), y: start.oy + (e.clientY - start.sy) };
    off = clampModalOffset(base, want, vw, vh);
    apply();
    if (!moved && Math.abs(e.clientX - start.sx) + Math.abs(e.clientY - start.sy) > 3) {
      moved = true;
      overlayEl()?.classList.add('dragged');
    }
  }
  function onUp(e: PointerEvent) {
    if (start) { try { node.releasePointerCapture?.(e.pointerId); } catch { /* 同上 */ } }
    start = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
  }
  /** 轉向／縮放後視窗可能整個跑到畫面外 ⇒ 重新夾一次（這是「自己彈走」的最後一道保險）。 */
  function onResize() {
    if (off.x === 0 && off.y === 0) return;
    const { vw, vh } = view();
    base = measure();
    off = clampModalOffset(base, off, vw, vh);
    apply();
  }

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  return {
    update(next: ModalDragOptions = {}) {
      const changed = 'resetKey' in next && next.resetKey !== opts.resetKey;
      opts = { ...next };
      if (changed) {
        off = { x: 0, y: 0 };
        base = null;
        start = null;
        moved = false;
        apply();
        overlayEl()?.classList.remove('dragged');
      }
    },
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
      overlayEl()?.classList.remove('dragged');
    },
  };
}
