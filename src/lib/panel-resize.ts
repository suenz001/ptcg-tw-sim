// ⭐v6.495 浮動視窗「玩家自己調整大小、瀏覽器記住」的中央 action（第一個使用者：對戰頁聊天視窗）。
//
// 站長需求（2026-10-06，逐字）：「玩家建議聊天視窗寬度可以對齊步驟對話框，我覺得乾脆讓聊天氣泡的視窗，
//   可以讓玩家自己調整大小長寬好了，並且讓瀏覽器網頁記住玩家的設定」
//
// 作法：
//   ・在視窗的一個角落加一個拉把（grip）。拉把放在「固定錨點的對角」——
//     桌機聊天視窗固定在右下角（right／bottom）⇒ 拉把在左上角，往左上拉變大；
//     手機直式固定在左上（left／top）⇒ 拉把在右下角，往右下拉變大。
//   ・尺寸寫進 inline style 的 width／height（蓋過 CSS 預設值），放開時存進 localStorage。
//   ・載入時讀回並依目前視窗大小夾制（換裝置／縮小視窗也不會跑出畫面）。
//   ・雙擊拉把 ⇒ 恢復預設尺寸並清掉記錄。
//   ・位置夾制交給既有的 use:modalDrag（它有 ResizeObserver，視窗變大後會自己重夾回畫面內）。
//   ⚠ localStorage 一律包 try/catch（無痕模式／被封鎖時照常可用，只是不記住）。

export type PanelGrip = 'tl' | 'br';
export interface PanelResizeOptions {
  /** localStorage key；換 key（例如手機轉向）會改讀另一份記錄 */
  storageKey: string;
  /** 拉把位置：tl＝左上（視窗錨在右下）、br＝右下（視窗錨在左上） */
  grip: PanelGrip;
  minW?: number;
  minH?: number;
  /** 與視窗邊緣保留的空間（px） */
  margin?: number;
}
export interface PanelSize { w: number; h: number }

const DEF_MIN_W = 240;
const DEF_MIN_H = 200;
const DEF_MARGIN = 16;

/** 純函式：把尺寸夾在 [最小值, 視窗可用空間] 之間（取整數）。視窗比最小值還小時以視窗為準。 */
export function clampPanelSize(
  size: PanelSize, viewW: number, viewH: number,
  minW = DEF_MIN_W, minH = DEF_MIN_H, margin = DEF_MARGIN,
): PanelSize {
  const maxW = Math.max(120, viewW - margin * 2);
  const maxH = Math.max(120, viewH - margin * 2);
  const w = Math.round(Math.min(maxW, Math.max(Math.min(minW, maxW), size.w)));
  const h = Math.round(Math.min(maxH, Math.max(Math.min(minH, maxH), size.h)));
  return { w, h };
}

/** 純函式：拉把移動 (dx, dy) 之後的新尺寸（未夾制）。 */
export function resizeByGrip(start: PanelSize, grip: PanelGrip, dx: number, dy: number): PanelSize {
  return grip === 'tl'
    ? { w: start.w - dx, h: start.h - dy }
    : { w: start.w + dx, h: start.h + dy };
}

/** 讀記錄（格式不對／讀不到 ⇒ null）。 */
export function loadPanelSize(key: string): PanelSize | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.w === 'number' && typeof v?.h === 'number' && isFinite(v.w) && isFinite(v.h) && v.w > 0 && v.h > 0) {
      return { w: v.w, h: v.h };
    }
  } catch { /* 無痕模式或格式錯誤 ⇒ 當作沒有記錄 */ }
  return null;
}
function savePanelSize(key: string, s: PanelSize | null): void {
  try {
    if (s) localStorage.setItem(key, JSON.stringify(s));
    else localStorage.removeItem(key);
  } catch { /* 寫不進去就不記住，功能照常 */ }
}

export function panelResize(node: HTMLElement, param: PanelResizeOptions) {
  let opts = param;
  const grip = document.createElement('div');
  grip.className = 'panel-resize-grip';
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-label', '拖曳調整視窗大小（雙擊恢復預設）');
  grip.title = '拖曳調整視窗大小（雙擊恢復預設）';
  node.appendChild(grip);

  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const minW = () => opts.minW ?? DEF_MIN_W;
  const minH = () => opts.minH ?? DEF_MIN_H;
  const margin = () => opts.margin ?? DEF_MARGIN;

  function applyGripSide() {
    grip.dataset.grip = opts.grip;
  }
  function apply(s: PanelSize | null) {
    if (!s) { node.style.removeProperty('width'); node.style.removeProperty('height'); node.style.removeProperty('max-height'); node.style.removeProperty('max-width'); return; }
    const c = clampPanelSize(s, vw(), vh(), minW(), minH(), margin());
    node.style.width = c.w + 'px';
    node.style.height = c.h + 'px';
    // CSS 預設可能有 max-height（手機 55vh）——玩家拉大時要能超過
    node.style.maxHeight = 'none';
    node.style.maxWidth = 'none';
  }
  function restore() {
    applyGripSide();
    apply(loadPanelSize(opts.storageKey));
  }

  let startX = 0, startY = 0, start: PanelSize = { w: 0, h: 0 }, pid: number | null = null;
  function onDown(e: PointerEvent) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = node.getBoundingClientRect();
    start = { w: r.width, h: r.height };
    startX = e.clientX; startY = e.clientY;
    pid = e.pointerId;
    try { grip.setPointerCapture(e.pointerId); } catch { /* 舊瀏覽器 */ }
    node.classList.add('panel-resizing');
  }
  function onMove(e: PointerEvent) {
    if (pid === null || e.pointerId !== pid) return;
    e.preventDefault();
    apply(resizeByGrip(start, opts.grip, e.clientX - startX, e.clientY - startY));
  }
  function onUp(e: PointerEvent) {
    if (pid === null || e.pointerId !== pid) return;
    pid = null;
    try { grip.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    node.classList.remove('panel-resizing');
    const r = node.getBoundingClientRect();
    savePanelSize(opts.storageKey, clampPanelSize({ w: r.width, h: r.height }, vw(), vh(), minW(), minH(), margin()));
  }
  function onDbl(e: MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    savePanelSize(opts.storageKey, null);
    apply(null);
  }
  // 視窗縮小（或手機轉向）⇒ 依新的可用空間重新夾制（不改寫記錄，放大回來時仍是玩家設定的尺寸）
  function onWinResize() { apply(loadPanelSize(opts.storageKey)); }

  grip.addEventListener('pointerdown', onDown);
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onUp);
  grip.addEventListener('dblclick', onDbl);
  window.addEventListener('resize', onWinResize);
  restore();

  return {
    update(next: PanelResizeOptions) {
      const changed = next.storageKey !== opts.storageKey || next.grip !== opts.grip;
      opts = next;
      if (changed) restore();
    },
    destroy() {
      window.removeEventListener('resize', onWinResize);
      grip.remove();
    },
  };
}
