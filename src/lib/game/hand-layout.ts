// ⭐v6.557 桌機手牌「互疊多少」的唯一判準。
//
// 站長回報（2026-10-13，電腦版玩家）：手牌 19 張時整排擠在畫面中間、互相疊住，兩旁卻還有一大片空間。
// 根因：原本互疊量是寫死的公式「超過 9 張後每多 1 張多疊 7px、最多 58px」，完全不看手牌列實際有多寬
//   ⇒ 寬螢幕照樣疊、窄螢幕反而可能疊不夠（被 overflow:hidden 切掉）。
// 新判準：量手牌列的可用寬度與單張卡寬，剛好放得下就不疊；放不下才疊「剛好塞滿」的量。
//   量不到（第一次 render、SSR、元素還沒掛上）時退回舊公式，行為與舊版相同。

/** 疊到最緊時每張卡至少露出的寬度（px），保證每張都點得到、看得到卡名邊。 */
export const HAND_MIN_VISIBLE_PX = 18;

/** 舊版寫死的公式（量不到寬度時的後備；與 v6.556 以前逐字等價）。 */
export function legacyHandOverlapPx(count: number): number {
  return count <= 9 ? 0 : Math.min(58, (count - 9) * 7);
}

/**
 * 每張卡（第 2 張起）往左疊多少 px。
 * @param count      手牌張數
 * @param cardWidth  單張手牌的實際寬度（px，含邊框）
 * @param availWidth 手牌列扣掉左右 padding 後的可用寬度（px）
 */
export function handOverlapPx(count: number, cardWidth: number, availWidth: number): number {
  const n = Math.floor(Number(count) || 0);
  if (n <= 1) return 0;
  const w = Number(cardWidth), avail = Number(availWidth);
  if (!(w > 0) || !(avail > 0)) return legacyHandOverlapPx(n);
  const need = n * w;
  if (need <= avail) return 0;                       // 放得下 ⇒ 不疊
  const overlap = Math.ceil((need - avail) / (n - 1)); // 剛好塞滿可用寬度
  const maxOverlap = Math.max(0, w - HAND_MIN_VISIBLE_PX);
  return Math.min(overlap, maxOverlap);
}

// ── v6.557 審查 P1：扇形旋轉會把兩端的卡往外甩 ──────────────────────────────────────────
// 經典／桌墊／Fable 版面的手牌有扇形（rotate(--fan-rot) translateY(--fan-lift)，transform-origin 50% 180%），
// 最外側的卡最多轉 ±18°，旋轉後會超出卡片原本的框幾十 px。手牌攤滿整列時要先把這段留出來，否則兩端被
// .hand-scroll 的 overflow:hidden 切掉（Chromium 實測 1920 寬 19 張切掉約 66px）。藍桌墊強制 0°，外擴為 0。

/** 第 i 張（共 n 張）手牌的扇形角度與下沉量——對戰頁 markup 與量測共用這一份。 */
export function handFanPose(i: number, n: number): { rot: number; lift: number } {
  const mid = (n - 1) / 2;
  const step = Math.min(4, 36 / Math.max(1, n));
  return { rot: n > 1 ? (i - mid) * step : 0, lift: Math.abs(i - mid) * (step * 0.6) };
}

/** hover 時卡片再往上推的量（與 .hand-card.hover-peek 的 translateY(-14px) 一致）。 */
export const HAND_HOVER_LIFT_PX = 14;

/**
 * 一張卡經 CSS `transform: rotate(rotDeg) translateY(liftPx)`（以 originX/originY 為原點）之後，
 * 水平方向超出原本框（0～w）的量。hover 上推時的姿勢也一併算進去，取較大者。
 */
export function fanOvershootPx(o: { w: number; h: number; rotDeg: number; liftPx: number; originX: number; originY: number }): { left: number; right: number } {
  const { w, h, rotDeg, liftPx, originX, originY } = o;
  if (!(w > 0) || !(h > 0) || !rotDeg) return { left: 0, right: 0 };
  const t = (rotDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  let minX = 0, maxX = w;
  for (const L of [liftPx || 0, (liftPx || 0) - HAND_HOVER_LIFT_PX]) {
    for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      // CSS 由右往左套用：先 translateY(L)，再以原點旋轉
      const x = px - originX, y = py - originY + L;
      const X = originX + x * c - y * s;
      if (X < minX) minX = X;
      if (X > maxX) maxX = X;
    }
  }
  return { left: Math.max(0, -minX), right: Math.max(0, maxX - w) };
}

/** computed style → border-box 寬高（含小數；不受 transform 影響）。 */
export function borderBoxSize(cs: { boxSizing: string; width: string; height: string; paddingLeft: string; paddingRight: string; paddingTop: string; paddingBottom: string; borderLeftWidth: string; borderRightWidth: string; borderTopWidth: string; borderBottomWidth: string }): { w: number; h: number } {
  const f = (v: string) => parseFloat(v) || 0;
  if (cs.boxSizing === 'border-box') return { w: f(cs.width), h: f(cs.height) };
  return {
    w: f(cs.width) + f(cs.paddingLeft) + f(cs.paddingRight) + f(cs.borderLeftWidth) + f(cs.borderRightWidth),
    h: f(cs.height) + f(cs.paddingTop) + f(cs.paddingBottom) + f(cs.borderTopWidth) + f(cs.borderBottomWidth),
  };
}
