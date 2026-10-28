// 對戰紀錄追蹤閱讀意圖：DOM 更新後立即補到底，避免下一幀前的 scroll 誤取消跟隨。
export function followBattleLog(node: HTMLElement) {
  let pinned = true;
  let alive = true;
  let height = node.scrollHeight;
  let viewport = node.clientHeight;
  let touchY: number | null = null;
  function rememberSize() { height = node.scrollHeight; viewport = node.clientHeight; }
  function follow() {
    if (!alive || node.clientHeight === 0) return;
    if (pinned) node.scrollTop = node.scrollHeight;
    rememberSize();
  }
  function onScroll() {
    if (!alive || node.clientHeight === 0) return;
    // 容器縮矮或內容長高不是玩家往上閱讀；先延續原本的跟隨意圖。
    if (pinned && (height !== node.scrollHeight || viewport !== node.clientHeight)) {
      follow();
      return;
    }
    pinned = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    rememberSize();
  }
  function onWheel(event: WheelEvent) { if (!event.ctrlKey && node.scrollTop > 0 && event.deltaY < 0) pinned = false; }
  function onTouchStart(event: TouchEvent) { touchY = event.touches.length === 1 ? event.touches[0].clientY : null; }
  function onTouchMove(event: TouchEvent) {
    const y = event.touches.length === 1 ? event.touches[0].clientY : null;
    if (node.scrollTop > 0 && touchY !== null && y !== null && y > touchY + 1) pinned = false;
    touchY = y;
  }
  function onTouchEnd() { touchY = null; }
  node.addEventListener('scroll', onScroll, { passive: true });
  node.addEventListener('wheel', onWheel, { passive: true });
  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchmove', onTouchMove, { passive: true });
  node.addEventListener('touchend', onTouchEnd, { passive: true });
  node.addEventListener('touchcancel', onTouchEnd, { passive: true });
  const mutations = new MutationObserver(follow);
  mutations.observe(node, { childList: true, subtree: true, characterData: true, attributes: true });
  const resize = new ResizeObserver(follow);
  resize.observe(node);
  follow();
  return {
    destroy() {
      alive = false;
      mutations.disconnect();
      resize.disconnect();
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
    }
  };
}
