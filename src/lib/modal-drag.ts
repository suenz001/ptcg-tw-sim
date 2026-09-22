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
 *   ⭐⭐ v6.425 起分兩種（`ModalClampMode`）：一般視窗預設 `reachable`＝**可以拖到畫面外、只保證把手抓得到**
 *   （站長回報手機上要把視窗拖到角落看對戰紀錄）；浮動按鈕／面板用 `contain`＝下面這段 v6.420 的規則。
 *   —— 以下是 v6.420 `contain` 規則的原始說明 ——
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
 * ⭐v6.425：預設（`reachable`）夾制時，視窗**水平**至少要留這麼多 px 在畫面內（把手橫跨整個寬度 ⇒ 一定抓得到）。
 * `contain` 模式（浮動按鈕／浮動面板）不用它 —— 那一類一律完整留在畫面內。
 */
export const MODAL_MIN_VISIBLE = 72;
/**
 * ⭐v6.425：預設（`reachable`）夾制時，視窗**上緣**最低只能到 `畫面高 − MODAL_HANDLE_KEEP`
 * ⇒ 把手（標題列）最上面這一條永遠露在畫面底部，隨時抓得回來。
 */
export const MODAL_HANDLE_KEEP = 56;

/**
 * 夾制模式：
 * ・`reachable`（預設，v6.425）：視窗可以拖到畫面外，**只保證把手抓得到**
 *   （水平至少留 MODAL_MIN_VISIBLE、上緣 ∈ [0, vh − MODAL_HANDLE_KEEP]）。
 *   站長回報（v6.425）：手機上以前可以把視窗拖到角落看底下的對戰紀錄，v6.420 改成「完整留在畫面內」
 *   之後視窗一定卡在畫面中間、看不到紀錄。v6.420 要防的是「拖走之後**抓不回來**」——只要把手還在畫面內，
 *   隨時可以拖回來按關閉鈕，所以不需要把整個視窗鎖在畫面裡。
 * ・`contain`：完整留在畫面內（v6.420 的規則）。浮動按鈕／浮動面板用：它們沒有「拖回來」的把手語意，
 *   半截出畫面就是點不到。
 */
export type ModalClampMode = 'reachable' | 'contain';

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
  base: ModalRect, off: ModalOffset, vw: number, vh: number, mode: ModalClampMode = 'reachable',
  safeBottom = 0,
  minVisibleW = MODAL_MIN_VISIBLE,
): ModalOffset {
  // 視窗左上角允許落在 [lo, hi]（畫面座標），再換算回位移。
  let loLeft: number, hiLeft: number, hiTop: number;
  if (mode === 'contain') {
    // 視窗比畫面小 ⇒ [0, vw - width]（完全在畫面內）；比畫面大 ⇒ [vw - width, 0]（不露白）。
    loLeft = Math.min(0, vw - base.width);
    hiLeft = Math.max(0, vw - base.width);
    hiTop = Math.max(0, vh - base.height);
  } else {
    // reachable：水平至少留 MODAL_MIN_VISIBLE（視窗比它窄時就是整個視窗）；
    //   下緣可以出畫面，但上緣最低到 vh − MODAL_HANDLE_KEEP（把手那一條永遠露著）。
    // minVisibleW：呼叫端量出來的「把手真正能拖的那一段」所需的露出寬度（≥ MODAL_MIN_VISIBLE）。
    //   ⚠ v6.426 起把手最前面有折疊鈕（按下去不拖曳），再加上視窗 padding，固定 72px 時真正能拖的只剩 16～28px
    //     （fable 審查實測）⇒ 由 action 以「折疊鈕右緣（或把手左緣）＋ 48px」量出來傳進來。
    const keepW = Math.min(Math.max(MODAL_MIN_VISIBLE, minVisibleW || 0), base.width);
    loLeft = keepW - base.width;
    hiLeft = vw - keepW;
    // safeBottom：手機（尤其 PWA）底部的系統手勢區（env(safe-area-inset-bottom)，站內 --safe-bottom），
    //   把手不可以只露在那一條裡（手指點不到）⇒ 露出量要再加上它（fable 審查）。
    hiTop = Math.max(0, vh - Math.min(MODAL_HANDLE_KEEP, base.height) - Math.max(0, safeBottom || 0));
  }
  // ⚠ 垂直**不允許**負值（兩種模式都一樣）：把手與關閉鈕都在視窗頂端，上緣一出畫面就再也抓不回來
  //   （審查者實測：500×900 的視窗被允許拖到 top=-233 之後，從畫面內任何一點都抓不到把手）。
  //   視窗比畫面高時靠**內部捲動**看下半部 —— 站內每個視窗都有 max-height ＋ overflow。
  const loTop = 0;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? lo : Math.min(Math.max(v, lo), hi));
  return {
    x: clamp(off.x, loLeft - base.left, hiLeft - base.left),
    y: clamp(off.y, loTop - base.top, hiTop - base.top),
  };
}

export interface ModalDragOptions {
  /** 把手選擇器（事件委派）。省略＝ DEFAULT_HANDLE_SELECTOR。 */
  handle?: string;
  /**
   * 拖曳時要加上 `dragged` 的祖先選擇器。省略＝自動找最近的 overlay／backdrop。
   * `false` ＝ 不動任何祖先（浮動按鈕／不遮擋畫面的面板用 —— 否則可能誤把無關的祖先變透明）。
   */
  overlay?: string | false;
  /** 關掉拖曳（例如某個視窗刻意固定）。 */
  disabled?: boolean;
  /**
   * 換成「另一個」視窗內容時傳不同的值 ⇒ 位移歸零。
   * ⚠ 同一個 `{#if}` 區塊裡換 picker 時 DOM **不會重建**（action 不會重跑）
   *   ⇒ 不給 `resetKey` 的話，新的 picker 會直接出現在上一個被拖走的位置。
   */
  resetKey?: unknown;
  // ── v6.423：浮動按鈕／浮動面板（聊天 FAB、聊天面板、對手回合按鈕與面板）收斂進來所需 ──
  /**
   * 整個元素都是把手（浮動按鈕本身就是 `<button>`，一般規則會因為「按在按鈕上不拖」而拖不動）。
   * ⚠ 元素**內部**的互動元件仍照 DRAG_IGNORE_SELECTOR 不拖。
   */
  wholeNode?: boolean;
  /**
   * 超過幾 px 才算拖曳（也才開始移動）。省略＝ 3px 判定、從第一個 px 就跟手（v6.420 行為）。
   * 給值時「未超過門檻前完全不動」—— 手機輕觸常有數 px 抖動，否則點一下就被當成拖曳而打不開。
   */
  threshold?: number;
  /** 拖曳相關的 pointer 事件不往上冒（v5.231：浮動按鈕下面就是場上的卡，避免穿透）。 */
  stopPropagation?: boolean;
  /** 掛載時的初始位移（例如從 localStorage 或上一次開啟時的位置還原）；掛載後會夾制一次。 */
  initial?: ModalOffset;
  /** 一次拖曳結束（有真的移動）時通知目前位移 —— 呼叫端自己決定要不要保存。 */
  onEnd?: (off: ModalOffset) => void;
  /**
   * 位移的套用方式。預設 `translate`（CSS translate 屬性）。
   * `margin` ＝ 用 margin-left／margin-top：手機直式的聊天面板必須用這個
   *   （v5.626：iOS 上 position:fixed ＋ transform 會破壞面板內部的捲動）。
   */
  mode?: 'translate' | 'margin';
  /**
   * ⭐v6.425 夾制模式（見 ModalClampMode）。省略＝ `reachable`（可拖到畫面外、把手留在畫面內）。
   * 浮動按鈕／浮動面板請傳 `'contain'`。
   */
  clamp?: ModalClampMode;
  /**
   * ⭐v6.426 折疊鈕（玩家建議、站長同意）：標題列最前面多一顆 ▾／▸，折疊後只剩標題列、背景讓出來（可以看、也可以點下面的對戰畫面）。
   * 省略＝ 一般視窗自動有；`clamp:'contain'`（浮動按鈕／面板）與 `wholeNode` 自動沒有。傳 `false` 可以關掉。
   */
  collapsible?: boolean;
}

// ══ v6.426 折疊鈕 ═════════════════════════════════════════════════════════════════
//   ⚠ 樣式由本模組自己注入一次（全站所有視窗共用；不寫進各頁的 scoped CSS，否則每頁都要抄一份）。
//   ⚠ 視窗的關閉鈕（class 含 close，例如 .zoom-close／.pv-close／.settings-close-dock）折疊後仍顯示，
//     否則折疊狀態下要先展開才能關（fable 審查）。
//   ⚠ 折疊只「藏」不「拆」：用 CSS 隱藏標題列以外的子元素，Svelte 管理的 DOM 一個都不動 ⇒ 展開後狀態完整保留
//     （已經點選的卡、捲動位置都還在）。
export const COLLAPSE_BTN_CLASS = 'modal-collapse-btn';
export const COLLAPSED_CLASS = 'modal-collapsed';
const KEEP_ATTR = 'data-md-keep';
const COLLAPSE_STYLE_ID = 'modal-drag-collapse-style';
const COLLAPSE_CSS = `
.${COLLAPSE_BTN_CLASS}{float:left;flex:0 0 auto;width:24px;height:24px;padding:0;margin:0 8px 0 0;
  display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid rgba(255,255,255,.35);
  background:rgba(0,0,0,.45);color:#fff;font-size:12px;line-height:1;cursor:pointer;touch-action:manipulation;position:relative;z-index:2;}
.${COLLAPSE_BTN_CLASS}:hover{background:rgba(0,0,0,.7);}
.${COLLAPSED_CLASS}{height:auto !important;min-height:0 !important;max-height:none !important;overflow:hidden !important;}
.${COLLAPSED_CLASS} > :not([${KEEP_ATTR}]):not([class*="close"]){display:none !important;}
`;
function ensureCollapseStyle() {
  if (typeof document === 'undefined' || document.getElementById(COLLAPSE_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = COLLAPSE_STYLE_ID;
  st.textContent = COLLAPSE_CSS;
  (document.head || document.documentElement).appendChild(st);
}
/** 這個視窗要不要有折疊鈕（純函式，守衛直接測）。 */
export function modalCollapsible(o: ModalDragOptions): boolean {
  if (o.collapsible === false) return false;
  if (o.collapsible === true) return true;
  return o.clamp !== 'contain' && !o.wholeNode;
}

const OVERLAY_SELECTOR = '[class*="overlay"], [class*="backdrop"]';

/**
 * 量出站內 `--safe-bottom`（底部系統手勢區）目前是幾 px（沒有就是 0）。
 * ⚠ CSS 變數的值常是 `env(safe-area-inset-bottom)` 這種要瀏覽器才算得出來的字串 ⇒ 用一個探針元素量實際高度。
 */
function safeBottomPx(): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:var(--safe-bottom, 0px);';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height || 0;
  probe.remove();
  return h;
}

/** Svelte action：`use:modalDrag` / `use:modalDrag={{ handle: '.sel-header' }}`。 */
export function modalDrag(node: HTMLElement, param: ModalDragOptions = {}) {
  let opts: ModalDragOptions = { ...param };
  let off: ModalOffset = param.initial ? { x: param.initial.x, y: param.initial.y } : { x: 0, y: 0 };
  let base: ModalRect | null = null;
  let start: { sx: number; sy: number; ox: number; oy: number; pid: number } | null = null;
  let moved = false;
  /** 拖曳結束後緊接著的那一個 click 要吃掉（否則浮動按鈕拖完就被當成點擊而打開面板）。 */
  let swallowClick = false;
  let appliedMode: 'translate' | 'margin' = opts.mode ?? 'translate';
  let safeB = 0;   // 拖曳開始／重夾時量一次（不在 pointermove 裡量，避免每一格都動 DOM）
  let collapseBtn: HTMLButtonElement | null = null;
  let collapsed = false;
  let minVisW = MODAL_MIN_VISIBLE;
  /** 往右拖到底時要露出多寬，把手才真的抓得到：折疊鈕右緣（沒有鈕就是把手左緣）距視窗左緣 ＋ 48px。 */
  function measureMinVisible(): number {
    try {
      const nr = node.getBoundingClientRect();
      const lead = collapseBtn ? collapseBtn.getBoundingClientRect().right - nr.left
        : (() => { const h = node.querySelector<HTMLElement>(opts.handle ?? DEFAULT_HANDLE_SELECTOR); return h ? h.getBoundingClientRect().left - nr.left : 0; })();
      return Math.max(MODAL_MIN_VISIBLE, Math.round(lead + 48));
    } catch { return MODAL_MIN_VISIBLE; }
  }

  const overlayEl = (): HTMLElement | null => {
    if (opts.overlay === false) return null;
    return opts.overlay ? node.closest<HTMLElement>(opts.overlay) : node.parentElement?.closest<HTMLElement>(OVERLAY_SELECTOR) ?? null;
  };

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
   * ⚠⚠ 預設用**獨立的 `translate` 屬性**，不是 `transform`。
   *   站內有兩個視窗本來就靠 `transform` 定位（勝負視窗 `translate(-50%,-50%)` 置中、
   *   進化浮動選單 `translate(-50%,-105%)`）——寫 `style.transform` 會把那個定位蓋掉，
   *   實測（審查者 probe）選單拖 1px 就整個跳位、而且第一次拖曳的夾制基準是錯的。
   *   CSS `translate` 屬性在 `transform` **之前**套用且互相獨立 ⇒ 兩者自然疊加。
   * `mode: 'margin'` 時改寫 margin（見 ModalDragOptions.mode）；切換模式時先清掉另一種的殘值。
   */
  function apply() {
    const zero = off.x === 0 && off.y === 0;
    const mode = opts.mode ?? 'translate';
    if (mode !== appliedMode) {
      if (appliedMode === 'margin') { node.style.marginLeft = ''; node.style.marginTop = ''; }
      else node.style.translate = '';
      appliedMode = mode;
    }
    if (mode === 'margin') {
      node.style.marginLeft = zero ? '' : `${off.x}px`;
      node.style.marginTop = zero ? '' : `${off.y}px`;
    } else {
      node.style.translate = zero ? '' : `${off.x}px ${off.y}px`;
    }
  }

  function onDown(e: PointerEvent) {
    if (opts.disabled) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (opts.wholeNode) {
      // 元素本身（例如 <button class="chat-fab">）不算「按在按鈕上」；只有內部的互動元件才不拖
      const ig = t.closest(DRAG_IGNORE_SELECTOR);
      if (ig && ig !== node && node.contains(ig)) return;
    } else {
      if (t.closest(DRAG_IGNORE_SELECTOR)) return;
      if (!t.closest(opts.handle ?? DEFAULT_HANDLE_SELECTOR)) return;
    }
    if (opts.stopPropagation) e.stopPropagation();
    base = measure();
    safeB = safeBottomPx();
    minVisW = measureMinVisible();
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
    // ⚠ wholeNode（按鈕）不可以 preventDefault：那會讓部分瀏覽器不產生後續的 click ⇒ 點不開。
    if (!opts.wholeNode) e.preventDefault();
  }
  function onMove(e: PointerEvent) {
    if (!start || !base) return;
    if (opts.stopPropagation) e.stopPropagation();
    const dist = Math.abs(e.clientX - start.sx) + Math.abs(e.clientY - start.sy);
    const th = opts.threshold ?? 3;
    if (!moved && dist > th) {
      moved = true;
      overlayEl()?.classList.add('dragged');
    }
    // 有指定門檻時，未超過門檻前完全不動（輕觸抖動不位移）
    if (opts.threshold !== undefined && !moved) return;
    const { vw, vh } = view();
    const want = { x: start.ox + (e.clientX - start.sx), y: start.oy + (e.clientY - start.sy) };
    off = clampModalOffset(base, want, vw, vh, opts.clamp ?? 'reachable', safeB, minVisW);
    apply();
  }
  function onUp(e: PointerEvent) {
    if (start) {
      if (opts.stopPropagation) e.stopPropagation();
      try { node.releasePointerCapture?.(e.pointerId); } catch { /* 同上 */ }
      if (moved) {
        swallowClick = true;
        // 萬一這次沒有產生 click（例如在元素外放開），不可以把「下一次真正的點擊」吃掉
        setTimeout(() => { swallowClick = false; }, 0);
        opts.onEnd?.({ x: off.x, y: off.y });
      }
    }
    start = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
  }
  function onClickCapture(e: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  /**
   * 轉向／縮放後視窗可能整個跑到畫面外 ⇒ 重新夾一次（這是「自己彈走」的最後一道保險）。
   * ⭐v6.425：視窗**自己的尺寸**變了也要重夾（ResizeObserver）—— 置中的視窗內容變矮時會自己往下滑，
   *   reachable 模式只留 56px 把手，不重夾的話會連把手都滑出畫面（fable 審查實測：1280×800 拖到底後內容縮 200px ⇒ top 844）。
   */
  function onResize() {
    if (off.x === 0 && off.y === 0) return;
    if (start) return;   // 拖曳中由 onMove 負責
    const { vw, vh } = view();
    base = measure();
    safeB = safeBottomPx();
    const before = off;
    minVisW = measureMinVisible();
    off = clampModalOffset(base, off, vw, vh, opts.clamp ?? 'reachable', safeB, minVisW);
    apply();
    if (before.x !== off.x || before.y !== off.y) opts.onEnd?.({ x: off.x, y: off.y });
  }

  // ── v6.426 折疊鈕 ──
  /** 找標題列所在的「node 直接子元素」（折疊時只留它）。找不到把手就不加折疊鈕。 */
  function handleEl(): HTMLElement | null {
    return node.querySelector<HTMLElement>(opts.handle ?? DEFAULT_HANDLE_SELECTOR);
  }
  function handleChild(h: HTMLElement): HTMLElement | null {
    let c: HTMLElement | null = h;
    while (c && c.parentElement !== node) c = c.parentElement;
    return c;
  }
  function setCollapsed(v: boolean) {
    collapsed = v;
    node.classList.toggle(COLLAPSED_CLASS, v);
    if (collapseBtn) {
      collapseBtn.textContent = v ? '▸' : '▾';
      const label = v ? '展開視窗' : '折疊視窗（只留標題列，看得到下面的對戰畫面）';
      collapseBtn.title = label;
      collapseBtn.setAttribute('aria-label', label);
      collapseBtn.setAttribute('aria-expanded', v ? 'false' : 'true');
    }
    // 折疊時背景讓出來（看得到、也點得到下面的對戰畫面）；展開時若沒拖過就恢復遮罩
    const ov = overlayEl();
    if (ov) {
      if (v) ov.classList.add('dragged');
      else if (off.x === 0 && off.y === 0) ov.classList.remove('dragged');
    }
  }
  function ensureCollapseBtn() {
    if (!modalCollapsible(opts)) {
      if (collapseBtn) { collapseBtn.remove(); collapseBtn = null; }
      if (collapsed) setCollapsed(false);
      return;
    }
    if (collapseBtn && node.contains(collapseBtn)) return;
    const h = handleEl();
    const keep = h ? handleChild(h) : null;
    if (!h || !keep) return;
    ensureCollapseStyle();
    keep.setAttribute(KEEP_ATTR, '');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = COLLAPSE_BTN_CLASS;
    b.setAttribute('data-no-drag', '');
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setCollapsed(!collapsed); });
    // 放在標題列（把手）最前面、float:left ⇒ 標題文字自然排在它右邊，不會疊在一起。
    //   ⚠ 只插進把手元素；Svelte 的 {#if}/{#each} 以自己的錨點插入，不受前面多一個節點影響。
    h.insertBefore(b, h.firstChild);
    collapseBtn = b;
    setCollapsed(collapsed);
  }
  if (typeof document !== 'undefined') ensureCollapseBtn();

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  node.addEventListener('click', onClickCapture, true);
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }
  const ro: ResizeObserver | null = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => onResize()) : null;
  ro?.observe(node);
  // 有初始位移（還原上次的位置）⇒ 先套用，版面排好後再夾一次（換裝置／換方向後舊位置可能在畫面外）
  if (off.x !== 0 || off.y !== 0) {
    apply();
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => onResize());
  }

  return {
    update(next: ModalDragOptions = {}) {
      const changed = 'resetKey' in next && next.resetKey !== opts.resetKey;
      const modeChanged = (next.mode ?? 'translate') !== (opts.mode ?? 'translate');
      opts = { ...next };
      if (changed) {
        off = { x: 0, y: 0 };
        base = null;
        start = null;
        moved = false;
        apply();
        overlayEl()?.classList.remove('dragged');
        if (collapsed) setCollapsed(false);   // v6.426：換成另一個視窗內容 ⇒ 一律展開
      } else if (modeChanged) {
        apply();
      }
      if (typeof document !== 'undefined') ensureCollapseBtn();
    },
    destroy() {
      ro?.disconnect();
      collapseBtn?.remove();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      node.removeEventListener('click', onClickCapture, true);
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
