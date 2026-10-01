/**
 * ⭐v6.460 牌組編輯器「我的牌組」拖曳排序 —— 唯一來源（Svelte action）。
 *
 * 【玩家建議（站長 2026-10-01 轉述）】按住整個牌組方塊拉起來，放到想要的位置。
 *
 * 【為什麼 v5.311～v5.319 九版都失敗、這一版怎麼避開】（逐版 commit 訊息的歸納）
 *   ① **拖曳途中就即時重排陣列**（v5.317）⇒ Svelte keyed each 把手指底下那個 <li> 搬到別處，
 *      pointer capture 跟著掉（v5.318 的 stuck）、放手事件送到別的元素（v5.319「黃線出現但放不下」）。
 *      ⇒ 本版**拖曳途中清單一個節點都不動**：原本那一格只變淡，畫面上跟著手指的是一份「浮起來的複本」，
 *        位置用一條插入線表示；**放手時才一次**改順序（呼叫 onMove）。
 *   ② 手機用 pointer 事件：手指一移動瀏覽器就接手捲動、送 pointercancel ⇒ 拖到一半斷掉。
 *      ⇒ 本版觸控走 **touch 事件**：document 上掛 `touchmove {passive:false}`，拖曳啟動後
 *        `preventDefault()` 擋掉捲動（這是瀏覽器保證有效的唯一方式）；滑鼠才走 pointer 事件。
 *   ③ 手機「一碰就換順序／捲動誤觸」（v5.313）。
 *      ⇒ 觸控要**長按 LONG_PRESS_MS 不動**才拿起來；長按前手指移動超過 TOUCH_SLOP 就當成捲動、整個放棄。
 *        滑鼠則是「按住拖超過 MOUSE_SLOP」才算拖曳，否則照常是點擊（選牌組）。
 *   ④ 收尾一定要發生：放手、取消（touchcancel）、Esc、切走分頁、視窗失焦、元件卸載 —— 任何一條都會
 *      還原畫面並拿掉所有暫時的監聽；拖曳後緊接著那一下 click 會被吃掉（不會順便切換到別的牌組）。
 *
 * 【使用】`<aside use:deckSortDrag={{ itemSelector, exclude, onMove }}>`
 *   ・itemSelector：可拖曳的列（必須帶 `data-deck-id`）。事件委派，清單重繪不用重新掛載。
 *   ・exclude：按在這些元素上不啟動拖曳（▲▼、🔍、× 等小按鈕照常按）。
 *   ・onMove(deckId, toIndex)：放手時呼叫一次；toIndex 是「拿掉自己之後」插入的位置（0 起算）。
 *     位置沒變不呼叫。
 */

export const LONG_PRESS_MS = 300;
export const TOUCH_SLOP = 8;
export const MOUSE_SLOP = 5;
export const AUTO_SCROLL_EDGE = 56;
export const AUTO_SCROLL_MAX = 14;

/**
 * 插入槽：中線在 y 之上的列有幾個（0～n）。`mids` 必須由上到下排好。
 *   y 在第一列中線以上 ⇒ 0（放最前面）；在最後一列中線以下 ⇒ n（放最後面）。
 */
export function insertSlot(mids: readonly number[], y: number): number {
  let n = 0;
  for (const m of mids) { if (y > m) n++; else break; }
  return n;
}

/** 插入槽 → 拿掉自己之後的最終位置。from 之後的槽要減 1（自己那一格已經空出來）。 */
export function finalIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/** 純函式：把 ids 中的 id 移到 to（拿掉自己之後的位置）。id 不在、或位置沒變 ⇒ 回原陣列。 */
export function moveIdTo<T extends { id: string }>(arr: readonly T[], id: string, to: number): readonly T[] {
  const from = arr.findIndex((d) => d.id === id);
  if (from < 0) return arr;
  const t = Math.max(0, Math.min(arr.length - 1, Math.floor(to)));
  if (t === from) return arr;
  const out = arr.slice();
  const [it] = out.splice(from, 1);
  out.splice(t, 0, it);
  return out;
}

export interface DeckSortOptions {
  itemSelector: string;
  exclude?: string;
  onMove: (deckId: string, toIndex: number) => void;
}

const STYLE_ID = 'deck-sort-drag-style';
function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  // 長按時不要跳出系統選單／選取文字（iOS callout、Android 選字）。只作用在可拖曳的列。
  st.textContent = '[data-deck-sort-item]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}'
    + 'html.deck-sorting,html.deck-sorting *{cursor:grabbing !important;}';
  document.head.appendChild(st);
}

type Phase = 'idle' | 'pending' | 'active';

export function deckSortDrag(node: HTMLElement, param: DeckSortOptions) {
  let opts = param;
  ensureStyle();

  let phase: Phase = 'idle';
  let mode: 'mouse' | 'touch' = 'mouse';
  let item: HTMLElement | null = null;
  let deckId = '';
  let startX = 0, startY = 0, lastX = 0, lastY = 0;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  // 拖曳啟動時的快照（頁面座標 ＝ client + scroll，捲動途中也算得對）
  let mids: number[] = [];
  let tops: number[] = [];
  let bottoms: number[] = [];
  let fromIdx = -1;
  let grabOffsetY = 0;
  let listLeft = 0, listWidth = 0;
  let ghost: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  let srcPrevOpacity = '';
  let raf = 0;
  let suppressClick = false;

  const items = (): HTMLElement[] => Array.from(node.querySelectorAll<HTMLElement>(opts.itemSelector));

  function pickItem(target: EventTarget | null): HTMLElement | null {
    const el = target as Element | null;
    if (!el || !el.closest) return null;
    if (opts.exclude && el.closest(opts.exclude)) return null;
    const it = el.closest(opts.itemSelector) as HTMLElement | null;
    if (!it || !node.contains(it) || !it.dataset.deckId) return null;
    return it;
  }

  function activate() {
    if (!item) return;
    const list = items();
    fromIdx = list.indexOf(item);
    if (fromIdx < 0) { reset(); return; }
    const sy = window.scrollY;
    mids = []; tops = []; bottoms = [];
    for (const el of list) {
      const r = el.getBoundingClientRect();
      tops.push(r.top + sy); bottoms.push(r.bottom + sy); mids.push(r.top + r.height / 2 + sy);
    }
    const r0 = item.getBoundingClientRect();
    grabOffsetY = lastY - r0.top;
    listLeft = r0.left; listWidth = r0.width;
    // 浮起來的複本（清單本身一個節點都不動）
    //   ⚠ 外面包一層「清單本身的淺複本」：頁面的樣式是 scoped 的（例 `.deck-list li`），
    //     單獨把 <li> 丟到 body 會失去祖先選擇器、版面跑掉。
    const liClone = item.cloneNode(true) as HTMLElement;
    liClone.removeAttribute('data-deck-sort-item');
    liClone.style.opacity = '1';
    const parent = item.parentElement;
    ghost = (parent ? parent.cloneNode(false) : document.createElement('ul')) as HTMLElement;
    ghost.appendChild(liClone);
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('data-deck-sort-ghost', '');
    Object.assign(ghost.style, {
      position: 'fixed', left: r0.left + 'px', top: r0.top + 'px', width: r0.width + 'px', height: r0.height + 'px',
      margin: '0', zIndex: '10000', pointerEvents: 'none', boxSizing: 'border-box',
      background: '#ffffff', borderRadius: '6px', boxShadow: '0 8px 22px rgba(0,0,0,.28)',
      transform: 'scale(1.03)', opacity: '0.96', listStyle: 'none', padding: '0', display: 'block', overflow: 'hidden',
    } as Partial<CSSStyleDeclaration>);
    // 字型也是從祖先繼承的 ⇒ 照抄原列的計算後字型與顏色，複本才會跟原本一模一樣大
    try { const cs = getComputedStyle(item); ghost.style.font = cs.font; ghost.style.color = cs.color; ghost.style.lineHeight = cs.lineHeight; } catch { /* 量不到就算了 */ }
    document.body.appendChild(ghost);
    line = document.createElement('div');
    line.setAttribute('data-deck-sort-line', '');
    Object.assign(line.style, {
      position: 'fixed', left: listLeft + 'px', width: listWidth + 'px', height: '3px', marginTop: '-1.5px',
      background: '#2a7de1', borderRadius: '2px', zIndex: '9999', pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(line);
    srcPrevOpacity = item.style.opacity;
    item.style.opacity = '0.35';
    document.documentElement.classList.add('deck-sorting');
    phase = 'active';
    try { (navigator as Navigator & { vibrate?: (n: number) => boolean }).vibrate?.(15); } catch { /* 不支援就算了 */ }
    paint();
    raf = requestAnimationFrame(autoScroll);
  }

  function currentSlot(): number {
    return insertSlot(mids, lastY + window.scrollY);
  }

  function paint() {
    if (phase !== 'active' || !ghost || !line) return;
    ghost.style.top = (lastY - grabOffsetY) + 'px';
    const slot = currentSlot();
    const sy = window.scrollY;
    // 插入線畫在「槽」的位置：兩列中間（第一列上緣之上／最後一列下緣之下）
    const n = mids.length;
    let yPage: number;
    if (slot <= 0) yPage = tops[0] - 2;
    else if (slot >= n) yPage = bottoms[n - 1] + 2;
    else yPage = (bottoms[slot - 1] + tops[slot]) / 2;
    line.style.top = (yPage - sy) + 'px';
    // 放回原位（不會改順序）時不畫線，免得看起來像會動
    const fi = finalIndex(fromIdx, slot);
    line.style.display = fi === fromIdx ? 'none' : 'block';
  }

  function autoScroll() {
    if (phase !== 'active') return;
    const h = window.innerHeight;
    let dy = 0;
    if (lastY < AUTO_SCROLL_EDGE) dy = -Math.ceil(AUTO_SCROLL_MAX * (1 - lastY / AUTO_SCROLL_EDGE));
    else if (lastY > h - AUTO_SCROLL_EDGE) dy = Math.ceil(AUTO_SCROLL_MAX * (1 - (h - lastY) / AUTO_SCROLL_EDGE));
    if (dy) { window.scrollBy(0, dy); paint(); }
    raf = requestAnimationFrame(autoScroll);
  }

  function finish(commit: boolean) {
    const wasActive = phase === 'active';
    let target = -1;
    if (wasActive && commit) target = finalIndex(fromIdx, currentSlot());
    const id = deckId, from = fromIdx;
    reset();
    // 放手後「由這次放手產生」的那一下 click 不算選牌組：滑鼠的 click 緊接在 pointerup 之後同步派發
    //   ⇒ 只吃到下一個 macrotask 為止；觸控的合成 click 已由 touchend 的 preventDefault 擋掉，這裡再給極短的保險。
    //   ⚠ 不可以抓長（v6.460 實測 600ms 會吃掉玩家放手後馬上點別的牌組那一下）。
    if (wasActive) { suppressClick = true; setTimeout(() => { suppressClick = false; }, mode === 'touch' ? 80 : 0); }
    if (wasActive && commit && target >= 0 && target !== from) {
      try { opts.onMove(id, target); } catch (e) { console.error('[deck-sort] onMove 失敗', e); }
    }
  }

  function reset() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (ghost) { ghost.remove(); ghost = null; }
    if (line) { line.remove(); line = null; }
    if (item) item.style.opacity = srcPrevOpacity;
    document.documentElement.classList.remove('deck-sorting');
    removeGlobal();
    phase = 'idle'; item = null; deckId = ''; fromIdx = -1; mids = []; tops = []; bottoms = [];
  }

  // ── 全域監聽（只在按下之後掛，收尾一定拿掉）──────────────────────────────
  let globalOn = false;
  function addGlobal() {
    if (globalOn) return; globalOn = true;
    if (mode === 'mouse') {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onCancel);
    } else {
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onCancel);
      document.addEventListener('contextmenu', onContextMenu, true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onCancel);
    document.addEventListener('visibilitychange', onVis);
  }
  function removeGlobal() {
    if (!globalOn) return; globalOn = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('touchcancel', onCancel);
    document.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('blur', onCancel);
    document.removeEventListener('visibilitychange', onVis);
  }
  function onCancel() { finish(false); }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') finish(false); }
  function onVis() { if (document.visibilityState === 'hidden') finish(false); }
  function onContextMenu(e: Event) { if (phase !== 'idle') e.preventDefault(); }

  // ── 滑鼠（pointer 事件，只收 mouse／pen）────────────────────────────────
  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'touch' || e.button !== 0 || phase !== 'idle') return;
    const it = pickItem(e.target);
    if (!it) return;
    item = it; deckId = it.dataset.deckId || '';
    mode = 'mouse';
    startX = lastX = e.clientX; startY = lastY = e.clientY;
    phase = 'pending';
    addGlobal();
  }
  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    lastX = e.clientX; lastY = e.clientY;
    if (phase === 'pending') {
      if (Math.hypot(lastX - startX, lastY - startY) >= MOUSE_SLOP) { e.preventDefault(); activate(); }
      return;
    }
    if (phase === 'active') { e.preventDefault(); paint(); }
  }
  function onPointerUp(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    finish(true);
  }

  // ── 觸控（touch 事件；長按才拿起來）─────────────────────────────────────
  function onTouchStart(e: TouchEvent) {
    if (phase !== 'idle') { if (e.touches.length > 1) finish(false); return; }
    if (e.touches.length !== 1) return;
    const it = pickItem(e.target);
    if (!it) return;
    const t = e.touches[0];
    item = it; deckId = it.dataset.deckId || '';
    mode = 'touch';
    startX = lastX = t.clientX; startY = lastY = t.clientY;
    phase = 'pending';
    addGlobal();
    pressTimer = setTimeout(() => { pressTimer = null; if (phase === 'pending') activate(); }, LONG_PRESS_MS);
  }
  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    lastX = t.clientX; lastY = t.clientY;
    if (phase === 'pending') {
      // 長按還沒成立就移動 ⇒ 玩家是在捲動，整個放棄（不擋捲動）
      if (Math.hypot(lastX - startX, lastY - startY) > TOUCH_SLOP) reset();
      return;
    }
    if (phase === 'active') { if (e.cancelable) e.preventDefault(); paint(); }
  }
  function onTouchEnd(e: TouchEvent) {
    if (phase === 'active' && e.cancelable) e.preventDefault();   // 擋掉放手後合成的 click
    finish(true);
  }

  function onClickCapture(e: MouseEvent) {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('click', onClickCapture, true);

  return {
    update(p: DeckSortOptions) { opts = p; },
    destroy() {
      finish(false);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('click', onClickCapture, true);
    },
  };
}
